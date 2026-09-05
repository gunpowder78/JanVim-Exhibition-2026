import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import dgram from "node:dgram";
import test from "node:test";
import { clearTimeout, setTimeout } from "node:timers";

import { encodeMessage } from "../osc.mjs";

const STOP_PATH = "/janvim/sound/v1/stop";
const START_PATH = "/janvim/sound/v1/start";

test("flock-live preserves the original double deadline and ordered wire fields", () => {
  const packet = encodeMessage("/janvim/sound/v1/flock-live", [
    { type: "s", value: "abc" }, { type: "i", value: 7 },
    { type: "d", value: 10.49 }, { type: "i", value: 2 },
    { type: "i", value: 19 }, { type: "f", value: 0.75 },
    { type: "f", value: 0.25 }, { type: "d", value: 10.5 },
  ]);
  // Hand-derived: 28-byte address, 12-byte tags, then 40 bytes of values.
  assert.equal(packet.subarray(0, 28).toString("ascii"), "/janvim/sound/v1/flock-live\0");
  assert.equal(packet.subarray(28, 40).toString("hex"), "2c7369646969666664000000");
  assert.equal(packet.subarray(40, 44).toString("hex"), "61626300");
  assert.equal(packet.readInt32BE(44), 7);
  assert.equal(packet.readDoubleBE(48), 10.49);
  assert.equal(packet.readInt32BE(56), 2);
  assert.equal(packet.readInt32BE(60), 19);
  assert.equal(packet.readFloatBE(64), 0.75);
  assert.equal(packet.readFloatBE(68), 0.25);
  assert.equal(packet.readDoubleBE(72), 10.5);
  assert.equal(packet.length, 80);
});

test("flock-mute adds only epoch and revision to the common wire fields", () => {
  const packet = encodeMessage("/janvim/sound/v1/flock-mute", [
    { type: "s", value: "abc" }, { type: "i", value: 8 },
    { type: "d", value: 10.5 }, { type: "i", value: 2 },
    { type: "i", value: 20 },
  ]);
  assert.equal(packet.subarray(0, 28).toString("ascii"), "/janvim/sound/v1/flock-mute\0");
  assert.equal(packet.subarray(28, 36).toString("hex"), "2c73696469690000");
  assert.equal(packet.subarray(36, 40).toString("hex"), "61626300");
  assert.equal(packet.readInt32BE(40), 8);
  assert.equal(packet.readDoubleBE(44), 10.5);
  assert.equal(packet.readInt32BE(52), 2);
  assert.equal(packet.readInt32BE(56), 20);
  assert.equal(packet.length, 60);
});

test("the additive paths preserve every legacy path and reject lookalike paths", () => {
  for (const name of ["start", "heartbeat", "cursor", "flock", "stop"]) {
    assert.doesNotThrow(() => encodeMessage(`/janvim/sound/v1/${name}`, []));
  }
  for (const name of ["flock-live/", "flock-muted", "Flock-live", "flock-live/stop"]) {
    assert.throws(() => encodeMessage(`/janvim/sound/v1/${name}`, []), /not allowed/);
  }
});

test("encodes a no-argument packet from hand-derived OSC bytes", () => {
  const packet = encodeMessage(STOP_PATH, []);

  assert.equal(
    packet.toString("hex"),
    "2f6a616e76696d2f736f756e642f76312f73746f700000002c000000",
  );
  assert.equal(packet.subarray(-4).toString("hex"), "2c000000");
});

test("pads OSC strings and emits ordered type tags", () => {
  const packet = encodeMessage(START_PATH, [
    { type: "s", value: "abc" },
    { type: "i", value: 0x01020304 },
    { type: "f", value: 1.5 },
    { type: "d", value: -2.25 },
  ]);

  assert.equal(packet.subarray(24, 32).toString("hex"), "2c73696664000000");
  assert.equal(packet.subarray(32, 36).toString("hex"), "61626300");
  assert.equal(packet.readInt32BE(36), 0x01020304);
  assert.equal(packet.readFloatBE(40), 1.5);
  assert.equal(packet.readDoubleBE(44), -2.25);
  assert.equal(packet.byteLength, 52);
});

test("accepts signed int32 endpoints and rejects integer overflow", () => {
  const packet = encodeMessage(STOP_PATH, [
    { type: "i", value: -0x80000000 },
    { type: "i", value: 0x7fffffff },
  ]);

  assert.equal(packet.readInt32BE(28), -0x80000000);
  assert.equal(packet.readInt32BE(32), 0x7fffffff);
  assert.throws(() =>
    encodeMessage(STOP_PATH, [{ type: "i", value: -0x80000001 }]),
  );
  assert.throws(() =>
    encodeMessage(STOP_PATH, [{ type: "i", value: 0x80000000 }]),
  );
  assert.throws(() =>
    encodeMessage(STOP_PATH, [{ type: "i", value: 1.25 }]),
  );
});

test("encodes float64 values without narrowing", () => {
  const value = Math.PI;
  const packet = encodeMessage(STOP_PATH, [{ type: "d", value }]);
  const expected = Buffer.alloc(8);
  expected.writeDoubleBE(value);

  assert.deepEqual(packet.subarray(-8), expected);
  assert.equal(packet.readDoubleBE(packet.byteLength - 8), value);
});

test("rejects unknown paths, malformed arguments, and non-finite numbers", () => {
  assert.throws(() => encodeMessage("/other", []));
  assert.throws(() => encodeMessage(STOP_PATH, "not-an-array"));
  assert.throws(() => encodeMessage(STOP_PATH, [null]));
  assert.throws(() => encodeMessage(STOP_PATH, [{ type: "x", value: 1 }]));
  assert.throws(() =>
    encodeMessage(STOP_PATH, [{ type: "f", value: Number.NaN }]),
  );
  assert.throws(() =>
    encodeMessage(STOP_PATH, [{ type: "f", value: Number.POSITIVE_INFINITY }]),
  );
  assert.throws(() =>
    encodeMessage(STOP_PATH, [{ type: "f", value: Number.MAX_VALUE }]),
  );
  assert.throws(() =>
    encodeMessage(STOP_PATH, [{ type: "d", value: Number.NEGATIVE_INFINITY }]),
  );
});

test("rejects NUL and non-ASCII OSC strings", () => {
  assert.throws(() =>
    encodeMessage(STOP_PATH, [{ type: "s", value: "a\0b" }]),
  );
  assert.throws(() =>
    encodeMessage(STOP_PATH, [{ type: "s", value: "cafe\u0301" }]),
  );
  assert.throws(() =>
    encodeMessage(STOP_PATH, [{ type: "s", value: 42 }]),
  );
});

test("enforces the 512-byte packet ceiling at the padded boundary", () => {
  const packet = encodeMessage(START_PATH, [
    { type: "s", value: "a".repeat(483) },
  ]);

  assert.equal(packet.byteLength, 512);
  assert.throws(() =>
    encodeMessage(START_PATH, [{ type: "s", value: "a".repeat(484) }]),
  );
});

test("produces a datagram received unchanged on localhost", async () => {
  const receiver = dgram.createSocket("udp4");
  const sender = dgram.createSocket("udp4");
  const packet = encodeMessage(STOP_PATH, []);

  try {
    await new Promise((resolve, reject) => {
      receiver.once("error", reject);
      receiver.bind(0, "127.0.0.1", resolve);
    });

    const received = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("UDP receipt timed out")), 2000);
      receiver.once("message", (message, remote) => {
        clearTimeout(timer);
        resolve({ message, remote });
      });
    });

    const address = receiver.address();
    await new Promise((resolve, reject) => {
      sender.send(packet, address.port, "127.0.0.1", (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    const result = await received;
    assert.deepEqual(result.message, packet);
    assert.equal(result.remote.address, "127.0.0.1");
  } finally {
    sender.close();
    receiver.close();
  }
});
