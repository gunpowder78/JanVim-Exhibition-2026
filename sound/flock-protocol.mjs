import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { TextDecoder } from "node:util";

const MAX_FRAME_BYTES = 1024;
const INT32_MAX = 0x7fffffff;
const sourceId = value => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
const token = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const int32 = value => Number.isInteger(value) && value > 0 && value <= INT32_MAX;
const bounded = (value, maximum) => Number.isFinite(value) && value >= 0 && value <= maximum;
const exactKeys = (value, keys) => value !== null && Object.keys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key));
const DATA_KEYS = ["version", "command", "sourceId", "seq", "epoch", "sampledAtMs", "state"];
const SAMPLE_KEYS = [...DATA_KEYS, "energy", "centroidX"];
// Keep BOM visible so it cannot silently become valid JSON.
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

// A bounded, nonrecursive JSON tokenizer. Decode keys before duplicate checks;
// JSON.parse alone would silently keep the last spelling of an escaped duplicate.
function parseFlatJson(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_FRAME_BYTES) return null;
  try {
    const text = utf8.decode(bytes);
    if (text.includes("\r") || text.includes("\n")) return null;
    const string = /"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y;
    const primitive = /(?:-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null)/y;
    let index = 0;
    const space = () => { while (text[index] === " " || text[index] === "\t") index++; };
    const read = regex => {
      regex.lastIndex = index;
      const match = regex.exec(text);
      if (!match) throw new SyntaxError("rejected");
      index = regex.lastIndex;
      return JSON.parse(match[0]);
    };
    const fields = Object.create(null);
    space();
    if (text[index++] !== "{") return null;
    space();
    if (text[index] !== "}") {
      for (;;) {
        const key = read(string);
        if (Object.hasOwn(fields, key)) return null;
        space();
        if (text[index++] !== ":") return null;
        space();
        fields[key] = read(text[index] === '"' ? string : primitive);
        space();
        if (text[index] !== ",") break;
        index++;
        space();
      }
    }
    if (text[index++] !== "}") return null;
    space();
    return index === text.length ? { ...fields } : null;
  } catch {
    return null;
  }
}

// Inputs are frame payloads, without CR/LF; credentials never leave this function.
export function parseFlockAttach(bytes, expectedToken) {
  if (!token(expectedToken)) return null;
  const frame = parseFlatJson(bytes);
  if (!exactKeys(frame, ["version", "command", "token", "sourceId"]) ||
      frame.version !== 1 || frame.command !== "attach-flock" ||
      !token(frame.token) || !sourceId(frame.sourceId) ||
      !timingSafeEqual(Buffer.from(frame.token, "hex"), Buffer.from(expectedToken, "hex"))) return null;
  return { sourceId: frame.sourceId };
}

export function parseFlockFrame(bytes) {
  const frame = parseFlatJson(bytes);
  if (!exactKeys(frame, frame?.state === "sample" ? SAMPLE_KEYS : DATA_KEYS) ||
      frame.version !== 1 || frame.command !== "flock" || !sourceId(frame.sourceId) ||
      !int32(frame.seq) || !int32(frame.epoch) || !bounded(frame.sampledAtMs, 3600000) ||
      !["sample", "empty", "unavailable"].includes(frame.state) ||
      (frame.state === "sample" && ![frame.energy, frame.centroidX].every(v => bounded(v, 1)))) return null;
  return frame;
}

// One push is one transport callback. Returning false from onFrame is terminal,
// allowing a schema/role rejection to stop this same callback immediately.
export function createFlockFramer({ onFrame, onReject }) {
  const pending = Buffer.alloc(MAX_FRAME_BYTES);
  let length = 0;
  let cr = false;
  let rejected = false;
  const reject = () => {
    if (!rejected) {
      rejected = true;
      length = 0;
      cr = false;
      onReject();
    }
    return false;
  };
  return {
    push(chunk) {
      if (rejected) return false;
      if (!Buffer.isBuffer(chunk) || chunk.length > 65536) return reject();
      let frames = 0;
      for (const byte of chunk) {
        if (byte === 10) {
          if (++frames > 64) return reject();
          const frame = Buffer.from(pending.subarray(0, length));
          length = 0;
          cr = false;
          try { utf8.decode(frame); } catch { return reject(); }
          if (onFrame(frame) === false) return reject();
        } else {
          if (cr) return reject();
          if (byte === 13) cr = true;
          else {
            if (length === MAX_FRAME_BYTES) return reject();
            pending[length++] = byte;
          }
        }
      }
      return true;
    },
  };
}
