import { Buffer } from "node:buffer";
import { appendFileSync } from "node:fs";
import process from "node:process";
import { setTimeout } from "node:timers";
import dgram from "node:dgram";

const mode = process.env.JANVIM_SOUND_FAKE_MODE ?? "owned";
const logPath = process.env.JANVIM_SOUND_FAKE_LOG;

const log = (event) => {
  if (logPath) appendFileSync(logPath, `${JSON.stringify(event)}\n`, "utf8");
};

const oscString = (value) => {
  const bytes = Buffer.from(`${value}\0`, "utf8");
  const padded = Buffer.alloc(Math.ceil(bytes.length / 4) * 4);
  bytes.copy(padded);
  return padded;
};

const oscMessage = (address, fields = []) => {
  const typeTags = oscString(`,${fields.map(({ type }) => type).join("")}`);
  const values = fields.map(({ type, value }) => {
    if (type === "s") return oscString(value);
    const bytes = Buffer.alloc(type === "d" ? 8 : 4);
    if (type === "i") bytes.writeInt32BE(value);
    if (type === "f") bytes.writeFloatBE(value);
    if (type === "d") bytes.writeDoubleBE(value);
    return bytes;
  });
  return Buffer.concat([oscString(address), typeTags, ...values]);
};

const oscAddress = (packet) => {
  const end = packet.indexOf(0);
  return packet.toString("utf8", 0, end < 0 ? packet.length : end);
};

const oscCommand = (packet) => {
  const address = oscAddress(packet);
  if (address) return address;
  return packet.length >= 4 && packet.readInt32BE(0) === 15 ? "/n_set" : address;
};

const oscPackets = (packet) => {
  if (oscAddress(packet) !== "#bundle") return [packet];
  const packets = [];
  let offset = 16;
  while (offset < packet.length) {
    const byteLength = packet.readInt32BE(offset);
    const nested = packet.subarray(offset + 4, offset + 4 + byteLength);
    packets.push(...oscPackets(nested));
    offset += 4 + byteLength;
  }
  return packets;
};

const readIntAt = (packet, index) => {
  const addressBytes = Math.ceil((packet.indexOf(0) + 1) / 4) * 4;
  const tagsEnd = packet.indexOf(0, addressBytes);
  const valuesOffset = Math.ceil((tagsEnd + 1) / 4) * 4;
  const tags = packet.toString("ascii", addressBytes + 1, tagsEnd);
  if (tags[index] !== "i") throw new Error(`expected integer OSC field, got ${tags[index]}`);
  return packet.readInt32BE(valuesOffset + index * 4);
};

if (mode === "foreign-sleeper") {
  log({ event: "sleeping", pid: process.pid });
  setTimeout(() => process.exit(0), 15_000);
} else {
  const socket = dgram.createSocket("udp4");
  let bufferAllocated = false;
  let cleanupStarted = false;
  let failSent = false;

  const handlePacket = (packet, remote) => {
    const address = oscCommand(packet);
    log({ event: "packet", address });

    if (address === "/n_set" && mode === "cleanup-hang") {
      cleanupStarted = true;
      log({ event: "cleanup-started", atMilliseconds: Date.now() });
    } else if (address === "/status") {
      socket.send(
        oscMessage("/status.reply", [
          { type: "i", value: 1 },
          { type: "i", value: 0 },
          { type: "i", value: 0 },
          { type: "i", value: 1 },
          { type: "i", value: 0 },
          { type: "f", value: 0 },
          { type: "f", value: 0 },
          { type: "d", value: 48_000 },
          { type: "d", value: 48_000 },
        ]),
        remote.port,
        remote.address,
      );
    } else if (address === "/notify") {
      socket.send(
        oscMessage("/done", [
          { type: "s", value: "/notify" },
          { type: "i", value: 0 },
          { type: "i", value: 1 },
        ]),
        remote.port,
        remote.address,
      );
    } else if (address === "/b_alloc") {
      bufferAllocated = true;
      log({ event: "buffer-allocated", frames: readIntAt(packet, 1) });
    } else if (address === "/b_write" && mode === "write-fail") {
      log({ event: "write-fail-sent" });
      socket.send(
        oscMessage("/fail", [
          { type: "s", value: "/b_write" },
          { type: "s", value: "fixture capture write failure" },
        ]),
        remote.port,
        remote.address,
      );
    } else if (address === "/sync") {
      if (mode === "cleanup-hang" && cleanupStarted) return;
      const reply = () =>
        socket.send(
          oscMessage("/synced", [{ type: "i", value: readIntAt(packet, 0) }]),
          remote.port,
          remote.address,
        );
      if (mode === "delayed-fail" && bufferAllocated && !failSent) {
        failSent = true;
        log({ event: "fail-sent" });
        socket.send(oscMessage("/fail"), remote.port, remote.address);
        setTimeout(reply, 300);
      } else {
        reply();
      }
    } else if (
      address === "/quit" &&
      mode !== "delayed-fail" &&
      mode !== "cleanup-hang"
    ) {
      socket.close(() => process.exit(0));
    }
  };

  socket.on("message", (packet, remote) => {
    oscPackets(packet).forEach((message) => handlePacket(message, remote));
  });

  socket.bind(57141, "127.0.0.1", () => log({ event: "bound", pid: process.pid }));
  setTimeout(() => process.exit(0), 15_000);
}
