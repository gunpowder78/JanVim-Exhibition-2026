import { Buffer } from "node:buffer";

const MAX_PACKET_BYTES = 512;
const INT32_MIN = -0x80000000;
const INT32_MAX = 0x7fffffff;
const ALLOWED_PATHS = new Set([
  "/janvim/sound/v1/start",
  "/janvim/sound/v1/heartbeat",
  "/janvim/sound/v1/cursor",
  "/janvim/sound/v1/flock",
  "/janvim/sound/v1/flock-live",
  "/janvim/sound/v1/flock-mute",
  "/janvim/sound/v1/stop",
]);

function paddedStringLength(length) {
  return Math.ceil((length + 1) / 4) * 4;
}

function validateAsciiString(value) {
  if (typeof value !== "string") {
    throw new TypeError("OSC string value must be a string");
  }
  if (value.length > MAX_PACKET_BYTES) {
    throw new RangeError("OSC string cannot fit in a bounded packet");
  }

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0 || code > 0x7f) {
      throw new RangeError("OSC strings must be non-NUL ASCII");
    }
  }
}

function encodeOscString(value) {
  const result = Buffer.alloc(paddedStringLength(value.length));
  result.write(value, 0, "ascii");
  return result;
}

function validateArgument(argument) {
  if (argument === null || typeof argument !== "object") {
    throw new TypeError("OSC arguments must be typed objects");
  }

  const { type, value } = argument;
  if (type === "s") {
    validateAsciiString(value);
    return { type, value, byteLength: paddedStringLength(value.length) };
  }

  if (type === "i") {
    if (!Number.isInteger(value) || value < INT32_MIN || value > INT32_MAX) {
      throw new RangeError("OSC int arguments must fit signed int32");
    }
    return { type, value, byteLength: 4 };
  }

  if (type === "f") {
    if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value))) {
      throw new RangeError("OSC float arguments must be finite float32 values");
    }
    return { type, value, byteLength: 4 };
  }

  if (type === "d") {
    if (!Number.isFinite(value)) {
      throw new RangeError("OSC double arguments must be finite numbers");
    }
    return { type, value, byteLength: 8 };
  }

  throw new TypeError("Unsupported OSC argument type");
}

function encodeArgument(argument) {
  if (argument.type === "s") return encodeOscString(argument.value);

  const result = Buffer.alloc(argument.byteLength);
  if (argument.type === "i") result.writeInt32BE(argument.value);
  else if (argument.type === "f") result.writeFloatBE(argument.value);
  else result.writeDoubleBE(argument.value);
  return result;
}

export function encodeMessage(path, args) {
  if (typeof path !== "string" || !ALLOWED_PATHS.has(path)) {
    throw new RangeError("OSC path is not allowed");
  }
  if (!Array.isArray(args)) {
    throw new TypeError("OSC args must be an array");
  }

  const pathLength = paddedStringLength(path.length);
  const typeTagLength = paddedStringLength(args.length + 1);
  if (pathLength + typeTagLength + args.length * 4 > MAX_PACKET_BYTES) {
    throw new RangeError("OSC packet exceeds 512 bytes");
  }

  const validated = args.map(validateArgument);
  const byteLength = validated.reduce(
    (total, argument) => total + argument.byteLength,
    pathLength + typeTagLength,
  );
  if (byteLength > MAX_PACKET_BYTES) {
    throw new RangeError("OSC packet exceeds 512 bytes");
  }

  const encodedTypeTags = encodeOscString(
    `,${validated.map((argument) => argument.type).join("")}`,
  );
  return Buffer.concat(
    [encodeOscString(path), encodedTypeTags, ...validated.map(encodeArgument)],
    byteLength,
  );
}
