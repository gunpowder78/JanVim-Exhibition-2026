import assert from "node:assert/strict";
import test from "node:test";

const identity = { runId: "show-1", controllerRunId: "ctl-1" };
const heartbeat = (seq = 1, elapsedMs = 0, extra = {}) => ({
  command: "heartbeat", ...identity, seq, elapsedMs, generationId: 1, loopId: "loop-1", ...extra,
});
const cursor = (seq = 2, elapsedMs = 0, extra = {}) => ({
  ...heartbeat(seq, elapsedMs), command: "cursor", x: 0.2, y: 0.4, motion: 0.8, ...extra,
});
async function fixture() {
  const { createRealInput } = await import("../real-input.mjs");
  let ms = 0;
  const stopped = [];
  const input = createRealInput({ nowMs: () => ms, onStop: r => stopped.push(r) });
  return { input, stopped, at: value => { ms = value; } };
}
const notes = events => events.filter(event => event.kind === "cursor");

test("real input permits one attachment and expires at exactly two seconds", async () => {
  const { createRealInput } = await import("../real-input.mjs");
  let ms = 0;
  const stopped = [];
  const input = createRealInput({ nowMs: () => ms, onStop: r => stopped.push(r) });
  assert.equal(input.attach({runId:"show-1",controllerRunId:"ctl-1"}), true);
  assert.equal(input.attach({runId:"show-2",controllerRunId:"ctl-2"}), false);
  ms = 2000;
  input.take();
  assert.deepEqual(stopped, ["producer-timeout"]);
  assert.equal(input.accept(heartbeat(1, 2000)), false);
  input.close();
  assert.deepEqual(input.take(), []);
  assert.deepEqual(stopped, ["producer-timeout"]);
});

test("before attach only bounded service heartbeats are due; attach needs a producer heartbeat", async () => {
  const { input, at } = await fixture();
  assert.equal(input.accept(cursor()), false);
  for (const ms of [0, 250, 500, 9000]) {
    at(ms);
    assert.ok(input.take().every(event => event.kind === "heartbeat"));
    assert.deepEqual(input.take(), []);
  }
  assert.equal(input.attach(identity), true);
  at(9250);
  assert.deepEqual(input.take(), []);
  assert.equal(input.accept(cursor(1, 250)), false);
});

test("latest cursor replaces earlier samples, emits once, and cannot exceed eight Hz", async () => {
  const { input, at } = await fixture();
  input.attach(identity);
  input.accept(heartbeat());
  assert.equal(input.accept(cursor()), true);
  assert.equal(input.accept(cursor(3, 0, { x: 0.9 })), true);
  assert.deepEqual(notes(input.take()).map(({ x, y, motion }) => ({ x, y, motion })),
    [{ x: 0.9, y: 0.4, motion: 0.8 }]);
  at(124);
  input.accept(cursor(4, 124));
  assert.deepEqual(notes(input.take()), []);
  at(125);
  assert.equal(notes(input.take()).length, 1);
  assert.deepEqual(notes(input.take()), []);
  at(1000);
  input.accept(heartbeat(5, 1000));
  input.accept(cursor(6, 1000));
  assert.equal(notes(input.take()).length, 1);
  assert.deepEqual(notes(input.take()), []);
});

test("source age and retained age discard samples over 500 ms; elapsed cannot regress or run ahead", async () => {
  const { input, at } = await fixture();
  at(10000);
  input.attach(identity);
  input.accept(heartbeat());
  input.accept(cursor());
  at(10500);
  assert.equal(notes(input.take()).length, 1);
  assert.equal(input.accept(cursor(3, 0)), true);
  at(10501);
  assert.deepEqual(notes(input.take()), []);
  assert.equal(input.accept(cursor(4, 0)), false);
  assert.equal(input.accept(heartbeat(4, 0)), false);
  assert.equal(input.accept(heartbeat(4, 502)), false);
  assert.equal(input.accept(heartbeat(4, 500)), true);
  assert.equal(input.accept(cursor(5, 499)), false);
});

test("only fresh valid heartbeats renew the producer lease, never cursor traffic or rejected input", async () => {
  const { input, stopped, at } = await fixture();
  input.attach(identity);
  input.accept(heartbeat());
  at(1500);
  assert.equal(input.accept(heartbeat(2, 1500)), true);
  assert.equal(input.take().filter(e => e.kind === "heartbeat").length, 1);
  at(1999);
  assert.equal(input.accept(cursor(3, 1999)), true);
  assert.deepEqual(input.take().filter(e => e.kind === "heartbeat"), []);
  at(3499);
  assert.equal(input.accept(heartbeat(4, 3499, { runId: "wrong" })), false);
  assert.equal(input.accept(cursor(4, 3499)), true);
  assert.deepEqual(stopped, []);
  at(3500);
  input.take();
  assert.deepEqual(stopped, ["producer-timeout"]);
});

test("idle, loop, and newer generation heartbeats clear samples without stopping sound", async () => {
  const { input, stopped } = await fixture();
  input.attach(identity);
  assert.equal(input.accept(heartbeat(1, 0, { loopId: "idle" })), true);
  assert.equal(input.accept(cursor(2, 0, { loopId: "idle" })), false);
  assert.equal(input.accept(heartbeat(2)), true);
  assert.equal(input.accept(cursor(3)), true);
  assert.equal(input.accept(heartbeat(4, 0, { loopId: "loop-2" })), true);
  assert.deepEqual(notes(input.take()), []);
  assert.equal(input.accept(cursor(5)), false);
  assert.equal(input.accept(cursor(5, 0, { loopId: "loop-2" })), true);
  assert.equal(input.accept(cursor(6, 0, { generationId: 2 })), false);
  assert.equal(input.accept(heartbeat(6, 0, { generationId: 2 })), true);
  assert.deepEqual(notes(input.take()), []);
  assert.equal(input.accept(heartbeat(7)), false);
  assert.equal(input.accept(cursor(7)), false);
  assert.equal(input.accept(cursor(7, 0, { generationId: 2 })), true);
  assert.equal(notes(input.take()).length, 1);
  assert.deepEqual(stopped, []);
});

test("strict schema, Show ID bounds, int32 sequence, identity and generation reject without consuming seq", async () => {
  const { input } = await fixture();
  for (const invalid of [null, {}, { ...identity, text: "private" },
    { ...identity, runId: "x".repeat(65) }, { ...identity, runId: "界" },
    { ...identity, runId: "show-1\n" }, { ...identity, controllerRunId: "ctl-1\n" },
    { ...identity, controllerRunId: "x".repeat(97) }]) assert.equal(input.attach(invalid), false);
  input.attach(identity);
  for (const extra of [{ seq: 0 }, { seq: 2147483648 }, { seq: 1.5 },
    { generationId: 0 }, { generationId: 2147483648 }, { generationId: 1.5 },
    { elapsedMs: -1 }, { elapsedMs: Infinity }, { elapsedMs: 3600001 },
    { loopId: "x".repeat(65) }, { loopId: "bad space" }, { loopId: "界" }, { loopId: "loop-1\n" },
    { controllerRunId: "wrong" }, { text: "private" }, { x: 0 }]) {
    assert.equal(input.accept(heartbeat(1, 0, extra)), false, JSON.stringify(extra));
  }
  assert.equal(input.accept(heartbeat()), true);
  assert.equal(input.accept(heartbeat()), false);
  for (const extra of [{ x: -0.1 }, { y: 1.1 }, { motion: NaN }, { text: "private" },
    { token: "private" }, { x: undefined }, { command: "flock" }]) {
    assert.equal(input.accept(cursor(2, 0, extra)), false);
  }
  assert.equal(input.accept(cursor()), true);
  const boundary = await fixture();
  const ids = { runId: "x".repeat(64), controllerRunId: "x".repeat(96) };
  assert.equal(boundary.input.attach(ids), true);
  assert.equal(boundary.input.accept(heartbeat(2147483647, 0,
    { ...ids, loopId: "x".repeat(64), generationId: 2147483647 })), true);
});

test("source elapsed accepts the one-hour boundary with a continuously renewed fake-clock lease", async () => {
  const { input, at } = await fixture();
  input.attach(identity);
  for (let seconds = 0; seconds <= 3600; seconds += 1) {
    at(seconds * 1000);
    assert.equal(input.accept(heartbeat(seconds + 1, seconds * 1000)), true);
  }
  assert.equal(input.accept(cursor(3602, 3600000)), true);
  assert.equal(notes(input.take()).length, 1);
});

test("source close latches Stop and cannot be replaced or revived", async () => {
  const { input, stopped } = await fixture();
  input.attach(identity);
  input.accept(heartbeat());
  input.accept(cursor());
  input.close();
  input.close();
  assert.deepEqual(input.take(), []);
  assert.equal(input.attach(identity), false);
  assert.equal(input.accept(heartbeat(3)), false);
  assert.deepEqual(stopped, ["source-disconnect"]);
});

test("final sender admission discards delayed IPC and independently limits cursor to eight Hz", async () => {
  const { createRealAdmission } = await import("../real-input.mjs");
  let ms = 0;
  const admit = createRealAdmission({ nowMs: () => ms });
  const event = { kind: "cursor", x: 0.2, y: 0.4, motion: 0.8, expiresAtMs: 500 };
  assert.equal(admit(event), true);
  ms = 124;
  assert.equal(admit(event), false);
  ms = 125;
  assert.equal(admit(event), true);
  ms = 501;
  assert.equal(admit(event), false);
  assert.equal(admit({ kind: "heartbeat", expiresAtMs: 500 }), false);
  assert.equal(admit({ kind: "flock", expiresAtMs: 700 }), false);
});
