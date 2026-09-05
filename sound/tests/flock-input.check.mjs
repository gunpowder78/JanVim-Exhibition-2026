import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";
import { parseFlockAttach, parseFlockFrame, createFlockFramer } from "../flock-protocol.mjs";
import { createFlockInput, createFlockAdmission } from "../flock-input.mjs";

// Synthetic protocol fixtures only: no JianShan GPU or human hearing evidence.
const sourceId = "a".repeat(32);
const token = "b".repeat(64);
const bytes = value => Buffer.from(JSON.stringify(value));
const sample = (extra = {}) => ({
  version: 1, command: "flock", sourceId, seq: 1, epoch: 1,
  sampledAtMs: 0, state: "sample", energy: 0.7, centroidX: 0.2, ...extra,
});
const silent = (state = "empty", extra = {}) => ({
  version: 1, command: "flock", sourceId, seq: 1, epoch: 1, sampledAtMs: 0, state, ...extra,
});
const live = (extra = {}) => ({
  kind: "flock-live", epoch: 1, revision: 1, energy: 0.7, centroid: 0.2,
  expiresAtMs: 1500, ...extra,
});
function fixture(origin = 1000) {
  let now = origin;
  const disabled = [];
  const input = createFlockInput({ nowMs: () => now, onDisable: reason => disabled.push(reason) });
  assert.equal(input.attach(sourceId), true);
  return { input, disabled, at: value => { now = value; } };
}
function framed() {
  const frames = [];
  const rejected = [];
  const framer = createFlockFramer({ onFrame: frame => frames.push(frame), onReject: () => rejected.push(true) });
  return { framer, frames, rejected };
}
const take = input => input.take({ showAuthorized: true });

// Break: renewing at accept/take, forgetting consumed targets, or using > at expiry.
test("490ms old input retains only 10ms and consumed target expires without another packet", () => {
  const { input, at } = fixture();
  at(1590);
  assert.equal(input.accept(sample({ sampledAtMs: 100 })), true);
  assert.deepEqual(take(input), live({ expiresAtMs: 1600 }));
  assert.deepEqual(input.snapshot(), { epoch: 1, revision: 1, closed: false, expiresAtMs: 1600 });
  at(1599);
  assert.equal(take(input), null);
  at(1600);
  assert.deepEqual(take(input), { kind: "flock-mute", epoch: 1, revision: 2 });
  assert.deepEqual(input.snapshot(), { epoch: 1, revision: 2, closed: false, expiresAtMs: null });
  assert.equal(take(input), null);
});

test("input queued until its exact original deadline never publishes live", () => {
  const { input, at } = fixture();
  at(1590);
  assert.equal(input.accept(sample({ sampledAtMs: 100 })), true);
  at(1600);
  assert.deepEqual(take(input), { kind: "flock-mute", epoch: 1, revision: 2 });
  assert.equal(take(input), null);
});

test("final admission accepts an actual receiver event at 1599 and rejects it at 1600", () => {
  const { input, at } = fixture();
  at(1590);
  assert.equal(input.accept(sample({ sampledAtMs: 100 })), true);
  const event = take(input);
  for (const [now, want] of [[1599, true], [1600, false], [1601, false]]) {
    const admission = createFlockAdmission({ nowMs: () => now });
    admission.update(input.snapshot());
    assert.equal(admission.accept(event), want, `final time ${now}`);
  }
});

test("accept uses age [0,500) including fractional milliseconds", () => {
  for (const [now, sampledAtMs, want] of [[1000, 0, true], [1000, 0.001, false],
    [1499.999, 0, true], [1500, 0, false], [1500.001, 0, false]]) {
    const { input, at } = fixture();
    at(now);
    assert.equal(input.accept(sample({ sampledAtMs })), want);
  }
});

// Break: a replay queue or resetting the publication clock on epoch change/mute.
test("pending input coalesces and live publication stays at 20Hz across epochs", () => {
  const { input, at } = fixture();
  assert.equal(input.accept(sample()), true);
  assert.deepEqual(take(input), live());
  at(1010);
  assert.equal(input.accept(sample({ seq: 2, sampledAtMs: 10, energy: 0.1 })), true);
  assert.equal(take(input), null);
  at(1020);
  assert.equal(input.accept(sample({ seq: 3, epoch: 2, sampledAtMs: 20, energy: 0.9 })), true);
  assert.equal(take(input), null);
  at(1049.999);
  assert.equal(take(input), null);
  at(1050);
  assert.deepEqual(take(input), live({ epoch: 2, revision: 3, energy: 0.9, expiresAtMs: 1520 }));
  at(1100);
  assert.equal(take(input), null);
});

test("empty and unavailable mute immediately with no numeric payload or phantom heartbeat", () => {
  for (const state of ["empty", "unavailable"]) {
    const { input, at, disabled } = fixture();
    assert.equal(input.accept(sample()), true);
    take(input);
    at(1001);
    assert.equal(input.accept(silent(state, { seq: 2, sampledAtMs: 1 })), true);
    assert.deepEqual(take(input), { kind: "flock-mute", epoch: 1, revision: 2 });
    for (const time of [1001, 1100, 1501, 3000]) {
      at(time);
      assert.equal(take(input), null);
      assert.equal(input.snapshot().expiresAtMs, null);
    }
    assert.deepEqual(disabled, []);
  }
});

test("idle Show drops buffered live and cannot replay it after authorization resumes", () => {
  const { input, at } = fixture();
  assert.equal(input.accept(sample()), true);
  assert.deepEqual(input.take({ showAuthorized: false }), { kind: "flock-mute", epoch: 1, revision: 2 });
  assert.equal(take(input), null);
  at(1050);
  assert.equal(input.accept(sample({ seq: 2, sampledAtMs: 50 })), true);
  assert.deepEqual(take(input), live({ revision: 3, expiresAtMs: 1550 }));
  assert.deepEqual(input.take({ showAuthorized: false }), { kind: "flock-mute", epoch: 1, revision: 4 });
  assert.equal(take(input), null);
});

test("unattached and muted policies emit no service heartbeat or synthetic live event", () => {
  let now = 1000;
  const input = createFlockInput({ nowMs: () => now, onDisable: () => assert.fail("unexpected disable") });
  assert.equal(input.accept(sample()), false);
  for (now of [1000, 1250, 1500, 9000]) {
    assert.equal(take(input), null);
    assert.equal(input.take({ showAuthorized: false }), null);
  }
  assert.equal(input.attach(sourceId), true);
  assert.equal(take(input), null);
  assert.equal(input.accept(sample()), true);
  assert.deepEqual(input.take(), { kind: "flock-mute", epoch: 1, revision: 2 });
});

test("close is terminal, invalidates queued live, and calls only onDisable once", () => {
  for (const reason of ["source-disconnect", "show-stop", "show-timeout"]) {
    const { input, disabled } = fixture();
    assert.equal(input.accept(sample()), true);
    const queued = take(input);
    input.close(reason);
    assert.deepEqual(input.snapshot(), { epoch: 1, revision: 2, closed: true, expiresAtMs: null });
    const admission = createFlockAdmission({ nowMs: () => 1000 });
    admission.update(input.snapshot());
    assert.equal(admission.accept(queued), false);
    const mute = take(input);
    assert.deepEqual(mute, { kind: "flock-mute", epoch: 1, revision: 2 });
    assert.equal(admission.accept(mute), true);
    assert.equal(input.attach("c".repeat(32)), false);
    assert.equal(input.accept(sample({ seq: 2, epoch: 2 })), false);
    input.close("again");
    assert.equal(take(input), null);
    assert.deepEqual(disabled, [reason]);
  }
});

test("only one strict source identity attaches and rejected replacements leave owner intact", () => {
  const input = createFlockInput({ nowMs: () => 1000, onDisable: () => {} });
  for (const id of [null, 1, "a".repeat(31), "a".repeat(33), "A".repeat(32), "g".repeat(32), sourceId + "\n"]) {
    assert.equal(input.attach(id), false);
  }
  assert.equal(input.attach(sourceId), true);
  assert.equal(input.attach(sourceId), false);
  assert.equal(input.attach("c".repeat(32)), false);
  assert.equal(input.accept(sample({ sourceId: "c".repeat(32) })), false);
  assert.equal(input.accept(sample()), true);
  assert.deepEqual(take(input), live());
});

// Break: updating sequence/time/epoch before full validation or failing to invalidate member resets.
test("initial epoch must be 1 and invalid input never advances ordering or replaces a valid target", () => {
  const { input, at } = fixture();
  at(1100);
  assert.equal(input.accept(sample({ epoch: 2, seq: 8, sampledAtMs: 100 })), false);
  assert.equal(input.accept(sample({ sampledAtMs: 100 })), true);
  const snapshot = input.snapshot();
  for (const extra of [{ seq: 1 }, { seq: 0 }, { seq: 1.5 }, { seq: NaN },
    { seq: 9, energy: NaN }, { seq: 9, energy: Infinity }, { seq: 9, centroidX: -0.1 },
    { seq: 9, sampledAtMs: 99 }, { seq: 9, sampledAtMs: 101 }, { seq: 9, epoch: 0 },
    { seq: 9, extra: true }, { seq: 9, state: "empty" }, { seq: 9, sampledAtMs: NaN }]) {
    assert.equal(input.accept(sample({ sampledAtMs: 100, ...extra })), false);
    assert.deepEqual(input.snapshot(), snapshot);
  }
  assert.equal(input.accept(sample({ seq: 2, sampledAtMs: 100, epoch: 2, energy: 0.9 })), true);
  assert.equal(input.accept(sample({ seq: 3, sampledAtMs: 100, epoch: 1 })), false);
  assert.deepEqual(take(input), live({ epoch: 2, revision: 2, energy: 0.9, expiresAtMs: 1600 }));
});

test("sample/member reset clears older queued state at admission before a newer sample is published", () => {
  const { input, at } = fixture();
  assert.equal(input.accept(sample()), true);
  const old = take(input);
  at(1010);
  assert.equal(input.accept(sample({ seq: 2, epoch: 2, sampledAtMs: 10 })), true);
  assert.equal(take(input), null);
  const admission = createFlockAdmission({ nowMs: () => 1010 });
  admission.update(input.snapshot());
  assert.equal(admission.accept(old), false);
});

test("20 structurally valid expired frames disable once while a valid frame clears the count", () => {
  const { input, at, disabled } = fixture();
  at(1600);
  for (let seq = 1; seq <= 19; seq++) assert.equal(input.accept(sample({ seq })), false);
  assert.deepEqual(disabled, []);
  assert.equal(input.accept(sample({ seq: 20, sampledAtMs: 600 })), true);
  take(input);
  at(2100);
  for (let seq = 21; seq <= 39; seq++) assert.equal(input.accept(sample({ seq, sampledAtMs: 600 })), false);
  assert.deepEqual(disabled, []);
  assert.equal(input.accept(sample({ seq: 40, sampledAtMs: 600, energy: NaN })), false);
  assert.deepEqual(disabled, []);
  assert.equal(input.accept(sample({ seq: 41, sampledAtMs: 600 })), false);
  assert.equal(disabled.length, 1);
  assert.equal(input.snapshot().closed, true);
  assert.equal(take(input).kind, "flock-mute");
  assert.equal(input.accept(sample({ seq: 42, sampledAtMs: 1100 })), false);
  assert.equal(disabled.length, 1);
});

test("producer sequence/epoch overflow disables without wrap and revision is independent of seq", () => {
  for (const field of ["seq", "epoch"]) {
    const { input, disabled } = fixture();
    assert.equal(input.accept(sample({ seq: 2147483647 })), true);
    assert.deepEqual(take(input), live());
    assert.equal(input.accept(sample({ seq: 2147483647, [field]: 2147483648 })), false);
    assert.equal(input.snapshot().closed, true);
    assert.equal(take(input).kind, "flock-mute");
    assert.equal(disabled.length, 1);
    assert.equal(input.accept(sample()), false);
  }
});

test("sample time includes one hour but rejects values outside the frozen range", () => {
  const { input, at } = fixture();
  at(3601000);
  assert.equal(input.accept(sample({ sampledAtMs: 3600000 })), true);
  assert.deepEqual(take(input), live({ expiresAtMs: 3601500 }));
  assert.equal(input.accept(sample({ seq: 2, sampledAtMs: 3600000.001 })), false);
  assert.equal(input.accept(sample({ seq: 2, sampledAtMs: -1 })), false);
  assert.equal(input.snapshot().expiresAtMs, 3601500);
  at(3601500);
  assert.equal(take(input).kind, "flock-mute");
});

test("nonfinite or regressing local clock disables and invalidates pending work", () => {
  for (const bad of [NaN, Infinity, -Infinity, 999]) {
    const { input, at, disabled } = fixture();
    assert.equal(input.accept(sample()), true);
    at(bad);
    assert.equal(take(input).kind, "flock-mute");
    assert.equal(input.snapshot().closed, true);
    at(1100);
    assert.equal(input.accept(sample({ seq: 2, sampledAtMs: 100 })), false);
    assert.equal(disabled.length, 1);
  }
});

test("snapshot checks consumed target expiry before downstream watermark publication", () => {
  const { input, at } = fixture();
  assert.equal(input.accept(sample()), true);
  const old = take(input);
  at(1500);
  assert.deepEqual(input.snapshot(), { epoch: 1, revision: 2, closed: false, expiresAtMs: null });
  const admission = createFlockAdmission({ nowMs: () => 1500 });
  admission.update(input.snapshot());
  assert.equal(admission.accept(old), false);
  assert.deepEqual(take(input), { kind: "flock-mute", epoch: 1, revision: 2 });
});

test("mutating returned events or snapshots cannot rewrite retained original expiry", () => {
  const { input, at } = fixture();
  assert.equal(input.accept(sample()), true);
  take(input).expiresAtMs = 9999;
  input.snapshot().revision = 9999;
  at(1500);
  assert.deepEqual(take(input), { kind: "flock-mute", epoch: 1, revision: 2 });
});

// Break: renewing final expiry, throttling mute, replaying a revision, or regressing watermark.
test("admission independently limits live to 20Hz and immediately accepts a newer mute", () => {
  let now = 1000;
  const admission = createFlockAdmission({ nowMs: () => now });
  assert.equal(admission.accept(live()), true);
  assert.equal(admission.accept(live()), false);
  now = 1049.999;
  assert.equal(admission.accept(live({ revision: 2 })), false);
  assert.equal(admission.accept({ kind: "flock-mute", epoch: 1, revision: 3 }), true);
  now = 1050;
  assert.equal(admission.accept(live({ epoch: 2, revision: 4 })), true);
  assert.equal(admission.accept(live({ revision: 2 })), false);
});

test("admission watermark invalidates same-epoch queues and cannot regress or reopen after close", () => {
  const admission = createFlockAdmission({ nowMs: () => 1000 });
  const newer = { epoch: 1, revision: 2, closed: false, expiresAtMs: 1500 };
  admission.update(newer);
  newer.revision = 1;
  admission.update({ epoch: 1, revision: 1, closed: false, expiresAtMs: 1500 });
  assert.equal(admission.accept(live()), false);
  admission.update({ epoch: 2, revision: 3, closed: true, expiresAtMs: null });
  admission.update({ epoch: 3, revision: 4, closed: false, expiresAtMs: 1500 });
  assert.equal(admission.accept(live({ epoch: 3, revision: 4 })), false);
  assert.equal(admission.accept({ kind: "flock-mute", epoch: 2, revision: 3 }), true);
});

test("admission rejects malformed/future/stale events without poisoning newer valid work", () => {
  for (const extra of [{ energy: NaN }, { centroid: Infinity }, { energy: -0.1 }, { centroid: 1.1 },
    { revision: 0 }, { revision: 2147483648 }, { revision: 1.1 }, { epoch: 0 },
    { epoch: 2147483648 }, { expiresAtMs: NaN }, { expiresAtMs: 1500.001 },
    { expiresAtMs: 1000 }, { kind: "heartbeat" }, { extra: true }]) {
    const admission = createFlockAdmission({ nowMs: () => 1000 });
    assert.equal(admission.accept(live(extra)), false);
    assert.equal(admission.accept(live()), true);
  }
});

test("admission matches snapshot expiry exactly and never admits live for a mute watermark", () => {
  const admission = createFlockAdmission({ nowMs: () => 1000 });
  admission.update({ epoch: 1, revision: 1, closed: false, expiresAtMs: 1400 });
  assert.equal(admission.accept(live()), false);
  assert.equal(admission.accept(live({ expiresAtMs: 1400 })), true);
  admission.update({ epoch: 1, revision: 2, closed: false, expiresAtMs: null });
  assert.equal(admission.accept(live({ revision: 2 })), false);
  assert.equal(admission.accept({ kind: "flock-mute", epoch: 1, revision: 2 }), true);
});

test("admission clock anomaly latches live rejection", () => {
  let now = 1000;
  const admission = createFlockAdmission({ nowMs: () => now });
  assert.equal(admission.accept(live()), true);
  now = 999;
  assert.equal(admission.accept(live({ revision: 2 })), false);
  now = 1100;
  assert.equal(admission.accept(live({ revision: 3 })), false);
});

// Break: permissive schemas, lossy UTF-8, JSON.parse duplicate collapse, or capability confusion.
test("strict attach accepts only exact fieldset and lowercase fixed-width matching credentials", () => {
  const attach = { version: 1, command: "attach-flock", token, sourceId };
  assert.deepEqual(parseFlockAttach(bytes(attach), token), { sourceId });
  for (const extra of [{ token: "c".repeat(64) }, { token: "b".repeat(63) },
    { token: "b".repeat(65) }, { token: "B".repeat(64) }, { sourceId: "A".repeat(32) },
    { sourceId: "a".repeat(31) }, { sourceId: "a".repeat(33) }, { version: "1" },
    { sourceId: sourceId + "\n" }, { token: token + "\n" },
    { command: "attach" }, { extra: true }]) {
    assert.equal(parseFlockAttach(bytes({ ...attach, ...extra }), token), null);
  }
  for (const expected of [null, "B".repeat(64), "b".repeat(63), token + "\n"]) {
    assert.equal(parseFlockAttach(bytes(attach), expected), null);
  }
  for (const key of Object.keys(attach)) {
    const incomplete = { ...attach };
    delete incomplete[key];
    assert.equal(parseFlockAttach(bytes(incomplete), token), null);
  }
  const duplicate = Buffer.from(JSON.stringify(attach).replace('"token":', '"to\\u006ben":"wrong","token":'));
  assert.equal(parseFlockAttach(duplicate, token), null);
});

test("codec accepts only the frozen sample and non-sample fieldsets without coercion", () => {
  for (const frame of [sample(), sample({ energy: 0, centroidX: 1, sampledAtMs: 3600000 }), silent(), silent("unavailable")]) {
    assert.deepEqual(parseFlockFrame(bytes(frame)), frame);
    for (const key of Object.keys(frame)) {
      const incomplete = { ...frame };
      delete incomplete[key];
      assert.equal(parseFlockFrame(bytes(incomplete)), null, `missing ${key}`);
    }
  }
  for (const extra of [{ state: "empty" }, { state: "unavailable" }, { state: "other" },
    { seq: 0 }, { seq: 2147483648 }, { seq: 1.1 }, { seq: "1" }, { epoch: 0 },
    { epoch: 2147483648 }, { version: true }, { sourceId: "A".repeat(32) }, { sourceId: sourceId + "\n" },
    { sampledAtMs: -1 }, { sampledAtMs: 3600000.001 }, { energy: null },
    { energy: 1.001 }, { centroidX: -0.001 }, { centroidX: {} }, { energy: [] },
    { command: "stop" }, { extra: true }]) assert.equal(parseFlockFrame(bytes(sample(extra))), null);
  assert.equal(parseFlockFrame(bytes(silent("empty", { energy: 0, centroidX: 0 }))), null);
});

test("codec rejects malformed UTF-8, nested JSON, literal and escaped duplicates, and non-JSON numbers", () => {
  const valid = JSON.stringify(sample());
  for (const raw of ["[]", "null", valid + "{}", "\uFEFF" + valid, valid + "\n", valid + "\r",
    valid.replace('"seq":1', '"seq":0,"seq":1'),
    valid.replace('"seq":1', '"s\\u0065q":0,"seq":1'),
    valid.replace('"energy":0.7', '"energy":1e999'),
    valid.replace('"energy":0.7', '"energy":NaN'),
    valid.replace('"energy":0.7', '"energy":Infinity'),
    valid.replace('"energy":0.7', '"energy":01'),
    valid.replace('"energy":0.7', '"energy":.7'),
    valid.replace('"energy":0.7', '"energy":0.7,'),
    valid.replace('"energy":0.7', '"energy":{"energy":0.7}')]) {
    assert.equal(parseFlockFrame(Buffer.from(raw)), null, raw);
  }
  for (const bad of [Buffer.from([0xc3, 0x28]), Buffer.from([0xc0, 0xaf]), Buffer.from([0xed, 0xa0, 0x80])]) {
    assert.equal(parseFlockFrame(Buffer.concat([Buffer.from(valid.slice(0, -1)), bad, Buffer.from("}")])), null);
  }
  assert.deepEqual(parseFlockFrame(Buffer.from(valid.replace('"seq":1', '"s\\u0065q":1'))), sample());
});

test("codec caps data bytes and framer permits exactly cap bytes plus a split pending CR", () => {
  const base = bytes(sample());
  const full = Buffer.concat([base, Buffer.alloc(1024 - base.length, 0x20)]);
  assert.deepEqual(parseFlockFrame(full), sample());
  assert.equal(parseFlockFrame(Buffer.concat([full, Buffer.from(" ")])), null);
  const { framer, frames, rejected } = framed();
  assert.equal(framer.push(full.subarray(0, 700)), true);
  assert.equal(framer.push(Buffer.concat([full.subarray(700), Buffer.from("\r")])), true);
  assert.equal(frames.length, 0);
  assert.equal(framer.push(Buffer.from("\n")), true);
  assert.deepEqual(frames, [full]);
  assert.deepEqual(rejected, []);
});

test("cap plus two or a non-LF after pending CR rejects once and stops all later parsing", () => {
  for (const suffix of ["xx", "\rx", "\r\r"]) {
    const { framer, frames, rejected } = framed();
    assert.equal(framer.push(Buffer.alloc(1024, 0x20)), true);
    assert.equal(framer.push(Buffer.from(suffix)), false);
    assert.equal(framer.push(Buffer.from("\n{}\n")), false);
    assert.deepEqual(frames, []);
    assert.deepEqual(rejected, [true]);
  }
});

test("framer bounds bytes rather than decoded characters and safely splits UTF-8", () => {
  const { framer, frames } = framed();
  const encoded = Buffer.from("é\n");
  assert.equal(framer.push(encoded.subarray(0, 1)), true);
  assert.equal(framer.push(encoded.subarray(1)), true);
  assert.deepEqual(frames, [Buffer.from("é")]);
  const huge = framed();
  assert.equal(huge.framer.push(Buffer.from("é".repeat(513) + "\n")), false);
  assert.equal(huge.frames.length, 0);
});

test("framer processes at most 64 frames per callback and never drains the 65th", () => {
  const allowed = framed();
  assert.equal(allowed.framer.push(Buffer.from("{}\n".repeat(64))), true);
  assert.equal(allowed.frames.length, 64);
  assert.equal(allowed.framer.push(Buffer.from("{}\n")), true);
  assert.equal(allowed.frames.length, 65);
  const over = framed();
  assert.equal(over.framer.push(Buffer.from("{}\n".repeat(65))), false);
  assert.equal(over.frames.length, 64);
  assert.equal(over.framer.push(Buffer.from("{}\n")), false);
  assert.equal(over.frames.length, 64);
  assert.deepEqual(over.rejected, [true]);
});

test("framer accepts 65536 callback bytes but rejects 65537 before processing any", () => {
  const chunk = Buffer.from((" ".repeat(1023) + "\n").repeat(64));
  const allowed = framed();
  assert.equal(allowed.framer.push(chunk), true);
  assert.equal(allowed.frames.length, 64);
  const over = framed();
  assert.equal(over.framer.push(Buffer.concat([chunk, Buffer.from(" ")])), false);
  assert.equal(over.frames.length, 0);
  assert.deepEqual(over.rejected, [true]);
});

test("framer stops immediately when consumer rejects a frame and owns emitted bytes", () => {
  let count = 0;
  let rejects = 0;
  const framer = createFlockFramer({ onFrame: () => { count++; return false; }, onReject: () => { rejects++; } });
  assert.equal(framer.push(Buffer.from("{}\n{}\n")), false);
  assert.equal(count, 1);
  assert.equal(rejects, 1);
  const stored = framed();
  const chunk = Buffer.from("{}\n");
  stored.framer.push(chunk);
  chunk.fill(0);
  assert.deepEqual(stored.frames, [Buffer.from("{}")]);
});

test("framer rejects malformed UTF-8 before consumer invocation and cannot resume", () => {
  const { framer, frames, rejected } = framed();
  assert.equal(framer.push(Buffer.from([0xc3])), true);
  assert.equal(framer.push(Buffer.from([0x28, 0x0a, 0x7b, 0x7d, 0x0a])), false);
  assert.deepEqual(frames, []);
  assert.deepEqual(rejected, [true]);
  assert.equal(framer.push(Buffer.from("{}\n")), false);
});

test("admission ignores malformed snapshots without invalidating the current valid target", () => {
  for (const extra of [{ epoch: 0 }, { revision: -1 }, { revision: 2147483648 },
    { closed: "false" }, { expiresAtMs: NaN }, { expiresAtMs: -1 }, { extra: true }]) {
    const admission = createFlockAdmission({ nowMs: () => 1000 });
    admission.update({ epoch: 1, revision: 1, closed: false, expiresAtMs: 1500 });
    admission.update({ epoch: 1, revision: 2, closed: false, expiresAtMs: 1500, ...extra });
    assert.equal(admission.accept(live()), true, JSON.stringify(extra));
  }
});
