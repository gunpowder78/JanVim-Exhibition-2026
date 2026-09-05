import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import dgram from "node:dgram";
import { EventEmitter } from "node:events";
import net from "node:net";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { setTimeout } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";
import { createContext, Script } from "node:vm";
import * as run from "../run.mjs";
import { createRealInput } from "../real-input.mjs";
import { createFlockInput } from "../flock-input.mjs";

const sourceId = "ab".repeat(16);
const identity = { runId: "show-1", controllerRunId: "ctl-1" };
const heartbeat = (seq = 1, elapsedMs = 0) => ({ command: "heartbeat", ...identity,
  seq, elapsedMs, generationId: 1, loopId: "loop-1" });
const sample = (seq = 1, sampledAtMs = 0, extra = {}) => ({ version: 1, command: "flock",
  sourceId, seq, epoch: 1, sampledAtMs, state: "sample", energy: 0.75, centroidX: 0.25, ...extra });
const encode = value => `${JSON.stringify(value)}\n`;
const rejectedAck = '{"version":1,"ok":false,"reason":"rejected"}\n';
const successAck = '{"version":1,"ok":true,"input":"jianshan-flock-ndjson-v1"}\n';

async function bounded(promise, ms = 1500) {
  const controller = new globalThis.AbortController();
  try {
    return await Promise.race([promise, delay(ms, null, { signal: controller.signal })
      .then(() => { throw new Error(`operation exceeded ${ms}ms`); })]);
  } finally { controller.abort(); }
}
async function connect(t, receipt) {
  const socket = net.createConnection({ host: receipt.host, port: receipt.port });
  socket.on("error", () => {});
  t.after(() => socket.destroy());
  await bounded(new Promise((resolve, reject) => {
    socket.once("connect", resolve); socket.once("error", reject);
  }));
  return socket;
}
async function reply(socket, value) {
  const pending = bounded(new Promise(resolve => socket.once("data", chunk => resolve(chunk.toString()))));
  socket.write(typeof value === "string" || Buffer.isBuffer(value) ? value : encode(value));
  return pending;
}
const closed = socket => socket.destroyed ? Promise.resolve() : bounded(new Promise(resolve => socket.once("close", resolve)));

async function fixture(t, enabled = true, descriptorFailure = false) {
  const runRoot = await run.prepareRunRoot(null);
  let ms = 10000;
  const stops = [];
  const disabled = [];
  let control;
  const realInput = createRealInput({ nowMs: () => ms, onStop: reason => stops.push(reason) });
  const flockInput = enabled ? createFlockInput({ nowMs: () => ms, onDisable: reason => {
    disabled.push(reason); control?.disableFlock(reason);
  } }) : null;
  if (descriptorFailure) await mkdir(path.join(runRoot, "flock-input.json"));
  control = await run.startControlServer(runRoot, () => stops.push("manual"), { realInput, flockInput });
  t.after(async () => { await control.close(); await rm(runRoot, { recursive: true, force: true }); });
  const attachBird = async () => {
    assert.ok(control.flockReceipt, "enabled listener publishes the independent descriptor");
    const bird = await connect(t, control.flockReceipt);
    assert.equal(await reply(bird, { version: 1, command: "attach-flock", token: control.flockReceipt.token, sourceId }), successAck);
    return bird;
  };
  const attachShow = async () => {
    const show = await connect(t, control.receipt);
    assert.equal(await reply(show, { command: "attach", token: control.receipt.token, ...identity }),
      '{"ok":true,"input":"real-cursor"}\n');
    show.write(encode({ ...heartbeat(), token: control.receipt.token }));
    await delay(20);
    return show;
  };
  return { control, runRoot, stops, disabled, realInput, flockInput, attachBird, attachShow, at: value => { ms = value; } };
}

test("flock ingress CLI requires the exact explicit real-cursor opt-in", () => {
  assert.deepEqual(run.parseCli(["--input", "real-cursor", "--flock-input", "enabled"]),
    { command: "run", duration: 45, mode: "silent", output: null, input: "real-cursor", flockInput: "enabled" });
  for (const args of [["--flock-input", "enabled"], ["--input", "simulated", "--flock-input", "enabled"],
    ["--input", "real-cursor", "--flock-input", "disabled"],
    ["--input", "real-cursor", "--flock-input", "enabled", "--flock-input", "enabled"]]) {
    assert.throws(() => run.parseCli(args), /invalid/);
  }
});

test("default real mode has no bird descriptor and rejects bird ownership", async t => {
  const f = await fixture(t, false);
  assert.equal(f.control.flockReceipt, undefined);
  await assert.rejects(stat(path.join(f.runRoot, "flock-input.json")), { code: "ENOENT" });
  const probe = await connect(t, f.control.receipt);
  assert.equal(await reply(probe, { version: 1, command: "attach-flock", token: f.control.receipt.token, sourceId }), '{"ok":false}\n');
  assert.deepEqual(f.stops, []);
});

test("one independent bird owner shares the existing listener and cannot be replaced", async t => {
  const f = await fixture(t);
  const show = await f.attachShow();
  const bird = await f.attachBird();
  const descriptor = JSON.parse(await readFile(path.join(f.runRoot, "flock-input.json"), "utf8"));
  assert.deepEqual(Object.keys(descriptor).sort(), ["active", "host", "port", "protocol", "token", "version"]);
  assert.deepEqual({ ...descriptor, token: "redacted" }, { version: 1, active: true, host: "127.0.0.1",
    port: f.control.receipt.port, protocol: "jianshan-flock-ndjson-v1", token: "redacted" });
  assert.match(descriptor.token, /^[0-9a-f]{64}$/);
  assert.notEqual(descriptor.token, f.control.receipt.token);
  if (process.platform !== "win32") assert.equal((await stat(path.join(f.runRoot, "flock-input.json"))).mode & 0o777, 0o600);
  const second = await connect(t, descriptor);
  assert.equal(await reply(second, { version: 1, command: "attach-flock", token: descriptor.token, sourceId }), rejectedAck);
  await closed(second);
  bird.write(encode(sample()));
  await delay(20);
  assert.equal(f.flockInput.take({ showAuthorized: true }).kind, "flock-live");
  assert.equal(show.destroyed, false);
  assert.deepEqual(f.stops, []);
  bird.destroy(); await delay(20);
  const replacement = await connect(t, descriptor);
  assert.equal(await reply(replacement, { version: 1, command: "attach-flock", token: descriptor.token, sourceId }), rejectedAck);
  await f.control.close();
  assert.equal(JSON.parse(await readFile(path.join(f.runRoot, "flock-input.json"), "utf8")).active, false);
});

test("bird token cannot authenticate Stop heartbeat or cursor and malformed bird closes only bird", async t => {
  for (const command of ["stop", "heartbeat", "cursor", "malformed"]) {
    const f = await fixture(t);
    const show = await f.attachShow();
    const bird = await f.attachBird();
    const probe = await connect(t, f.control.receipt);
    assert.equal(await reply(probe, { command: "stop", token: f.control.flockReceipt.token }), rejectedAck);
    const payload = command === "malformed" ? '{"version":1,"version":1}\n'
      : encode({ ...heartbeat(2), command, token: f.control.flockReceipt.token });
    assert.equal(await reply(bird, payload), rejectedAck);
    await closed(bird);
    assert.equal(show.destroyed, false);
    assert.deepEqual(f.stops, []);
    assert.equal(f.realInput.isShowAuthorized(), true);
    assert.equal(f.flockInput.snapshot().closed, true);
    await f.control.close();
  }
});

test("valid freshness/order drops retain bird owner but strict malformed UTF8 and callback limits close it", async t => {
  const f = await fixture(t);
  const bird = await f.attachBird();
  bird.write(encode(sample()) + encode(sample()) + encode(sample(2, 100)));
  await delay(20);
  assert.equal(bird.destroyed, false);
  assert.equal(f.flockInput.take({ showAuthorized: true }).revision, 1);
  bird.write(Buffer.from([0xc0, 0xaf, 10]));
  await closed(bird);
  assert.deepEqual(f.stops, []);
  const overflow = await fixture(t);
  const owner = await overflow.attachBird();
  owner.write(Array.from({ length: 65 }, (_, i) => encode(sample(i + 1))).join(""));
  await closed(owner);
  assert.equal(overflow.flockInput.snapshot().closed, true);
});

test("attach deadline is absolute despite dribbling bytes and capacity stays eight total", async t => {
  const f = await fixture(t);
  const sockets = [];
  for (let i = 0; i < 8; i++) sockets.push(await connect(t, f.control.receipt));
  const excess = await connect(t, f.control.receipt);
  await closed(excess);
  const started = performance.now();
  const ended = closed(sockets[0]);
  for (let i = 0; i < 5; i++) { sockets[0].write(" "); await delay(170); }
  await ended;
  assert.ok(performance.now() - started < 1350, "dribble must not renew the 1000ms attach deadline");
  assert.deepEqual(f.stops, []);
});

test("descriptor failure disables optional bird while Show remains attachable", async t => {
  const diagnostics = [];
  const capture = t.mock.method(process.stderr, "write", chunk => {
    assert.ok(diagnostics.length < 2 && Buffer.byteLength(chunk) <= 256, "bounded descriptor diagnostic");
    diagnostics.push(String(chunk));
    return true;
  });
  let f;
  try { f = await fixture(t, true, true); }
  finally { capture.mock.restore(); }
  assert.ok(diagnostics.length === 1 &&
    diagnostics[0] === "sound flock ingress: descriptor unavailable; optional input disabled\n",
  "expected exactly one fixed redacted descriptor diagnostic");
  assert.equal(f.control.flockReceipt, undefined);
  assert.equal(f.flockInput.snapshot().closed, true);
  await f.attachShow();
  assert.deepEqual(f.stops, []);
});

test("terminal flock before listener publication cannot create an active descriptor", async t => {
  const root = await run.prepareRunRoot(null);
  let control;
  t.after(async () => { await control?.close(); await rm(root, { recursive: true, force: true }); });
  const realInput = createRealInput({ nowMs: () => 1000, onStop: () => {} });
  const flockInput = createFlockInput({ nowMs: () => 1000, onDisable: () => {} });
  flockInput.close("show-stop");
  control = await run.startControlServer(root, () => {}, { realInput, flockInput });
  assert.equal(control.flockReceipt.active, false);
  await control.close();
  assert.equal(JSON.parse(await readFile(path.join(root, "flock-input.json"), "utf8")).active, false);
});

test("Stop followed by queued input closes bird and emits only the successful control ACK", async t => {
  const f = await fixture(t);
  await f.attachShow();
  const bird = await f.attachBird();
  const stop = await connect(t, f.control.receipt);
  const received = [];
  stop.on("data", chunk => received.push(chunk.toString()));
  stop.write(encode({ command: "stop", token: f.control.receipt.token }) + encode(sample()));
  await closed(stop);
  await closed(bird);
  assert.equal(received.join(""), '{"ok":true}\n');
  assert.equal(f.control.flockReceipt.active, false);
  assert.equal(f.flockInput.snapshot().closed, true);
  assert.deepEqual(f.flockInput.take({ showAuthorized: true }).kind, "flock-mute");
});

test("clock reply preserves original deadline, emits watermark without events, and applies Show lease first", async () => {
  assert.equal(typeof run.takeInputReply, "function", "supervisor uses the tested input/clock boundary");
  let now = 1000;
  const stops = [];
  const realInput = createRealInput({ nowMs: () => now, onStop: r => stops.push(r) });
  const flockInput = createFlockInput({ nowMs: () => now, onDisable: () => {} });
  flockInput.attach(sourceId);
  flockInput.accept(sample());
  let reply = run.takeInputReply(realInput, flockInput);
  assert.equal(reply.flockEvent.kind, "flock-mute", "service heartbeat cannot authorize flock");
  realInput.attach(identity); realInput.accept(heartbeat());
  now = 1490; flockInput.accept(sample(2));
  reply = run.takeInputReply(realInput, flockInput);
  assert.equal(reply.flockEvent.expiresAtMs, 1500);
  assert.equal(reply.flockSnapshot.expiresAtMs, 1500);
  assert.equal(run.takeInputReply(realInput, flockInput).flockEvent, null);
  now = 1500;
  reply = run.takeInputReply(realInput, flockInput);
  assert.equal(reply.flockEvent.kind, "flock-mute");
  assert.equal(reply.flockSnapshot.expiresAtMs, null);
  now = 3000; flockInput.accept(sample(3, 2000));
  reply = run.takeInputReply(realInput, flockInput);
  assert.deepEqual(stops, ["producer-timeout"]);
  assert.equal(reply.flockEvent.kind, "flock-mute", "bird cannot keep Show alive");
});

async function productionClockHandler(realInput, flockInput, nowMs) {
  // Execute the actual supervisor registration, including its takeRealInput
  // branch. No SC/process launch or alternate implementation of that branch.
  const source = await readFile(path.resolve("sound/run.mjs"), "utf8");
  const registrations = source.match(/ {4}sender\.child\.on\("message", \(message\) => \{[\s\S]+?\r?\n {4}\}\);(?=\r?\n {4}sendIpc\(sender\.child, \{)/g);
  assert.equal(registrations?.length, 1, "expected the actual supervisor sender-message registration");
  const sender = { child: new EventEmitter() };
  let reply;
  const context = createContext({ sender, realInput, flockInput, takeInputReply: run.takeInputReply,
    performance: { timeOrigin: 100000, now: () => nowMs() - 100000 },
    receiverAnchor: { clock: 10, epochMilliseconds: 101000 },
    sendIpc: (child, value) => {
      assert.equal(child, sender.child);
      assert.equal(reply, undefined, "one response per request");
      reply = JSON.parse(JSON.stringify(value)); // Same plain JSON boundary as real IPC.
    },
  });
  new Script(registrations[0]).runInContext(context, { timeout: 1000 });
  const emit = new Script('sender.child.emit("message", request)');
  let requestId = 0;
  return (takeRealInput = false) => {
    reply = undefined;
    context.request = { type: "clock", requestId: ++requestId, ...(takeRealInput ? { takeRealInput: true } : {}) };
    emit.runInContext(context, { timeout: 1000 });
    assert.equal(reply.requestId, requestId);
    return reply;
  };
}

test("production startup timestamp request preserves pending heartbeat cursor and flock until first input pull", async () => {
  let now = 101000;
  const realInput = createRealInput({ nowMs: () => now, onStop: () => assert.fail("unexpected Show Stop") });
  const flockInput = createFlockInput({ nowMs: () => now, onDisable: () => assert.fail("unexpected bird disable") });
  assert.equal(realInput.attach(identity), true);
  assert.equal(realInput.accept(heartbeat()), true);
  assert.equal(realInput.accept({ ...heartbeat(2), command: "cursor", x: 0.2, y: 0.4, motion: 0.8 }), true);
  assert.equal(flockInput.attach(sourceId), true);
  assert.equal(flockInput.accept(sample()), true);
  const clock = await productionClockHandler(realInput, flockInput, () => now);
  now = 101100;
  const startup = clock(); // The start packet requests only a timestamp.
  now = 101490;
  const pulled = clock(true);
  assert.deepEqual(pulled.events, [
    { kind: "heartbeat", expiresAtMs: 101500 },
    { kind: "cursor", x: 0.2, y: 0.4, motion: 0.8, expiresAtMs: 101500 },
  ], "startup timestamp request must not consume pending real input");
  assert.deepEqual(pulled.flockEvent, { kind: "flock-live", epoch: 1, revision: 1,
    energy: 0.75, centroid: 0.25, expiresAtMs: 101500 });
  assert.equal(startup.events, undefined);
  assert.equal(startup.flockEvent, undefined);
  assert.equal(startup.value, 10.1);
  assert.equal(startup.sampledAtMs, 101100);
  assert.deepEqual(startup.flockSnapshot, { epoch: 1, revision: 1, closed: false, expiresAtMs: 101500 });
  const consumed = clock(true);
  assert.deepEqual(consumed.events, []);
  assert.equal(consumed.flockEvent, null, "first input pull consumes the one existing pending slot exactly once");
});

test("production timestamp snapshots expire pending flock without consuming its mute", async () => {
  let now = 101000;
  const realInput = createRealInput({ nowMs: () => now, onStop: () => assert.fail("unexpected Show Stop") });
  const flockInput = createFlockInput({ nowMs: () => now, onDisable: () => assert.fail("unexpected bird disable") });
  realInput.attach(identity); realInput.accept(heartbeat());
  flockInput.attach(sourceId); flockInput.accept(sample());
  const clock = await productionClockHandler(realInput, flockInput, () => now);
  now = 101500;
  const expired = clock();
  assert.deepEqual(expired.flockSnapshot, { epoch: 1, revision: 2, closed: false, expiresAtMs: null });
  now = 101600;
  clock();
  assert.deepEqual(clock(true).flockEvent, { kind: "flock-mute", epoch: 1, revision: 2 },
    "timestamp inspection must leave expiry mute pending for the input pull");
  assert.equal(clock(true).flockEvent, null);
});

function readOsc(packet) {
  let offset = 0;
  const string = () => {
    const end = packet.indexOf(0, offset);
    assert.ok(end >= offset);
    const value = packet.toString("ascii", offset, end);
    offset = Math.ceil((end + 1) / 4) * 4;
    return value;
  };
  const address = string();
  const tags = string();
  const values = [...tags.slice(1)].map(tag => {
    if (tag === "s") return string();
    assert.ok(["i", "f", "d"].includes(tag));
    const value = tag === "i" ? packet.readInt32BE(offset) : tag === "f" ? packet.readFloatBE(offset) : packet.readDoubleBE(offset);
    offset += tag === "d" ? 8 : 4;
    return value;
  });
  return { address, tags, values };
}

async function senderScenario(t, runFile = path.resolve("sound/run.mjs")) {
  const receiver = dgram.createSocket({ type: "udp4", reuseAddr: false });
  await bounded(new Promise((resolve, reject) => {
    receiver.once("error", reject); receiver.bind({ address: "127.0.0.1", port: 57140, exclusive: true }, resolve);
  }));
  t.after(() => receiver.close());
  // Supervisor timeOrigin=100000; sender timeOrigin=99000. Their raw now()
  // values differ by 1000ms but their monotonic epoch milliseconds agree.
  // Override only the child clock; use the real sender/admission/OSC and UDP.
  const preload = `import { performance } from 'node:perf_hooks';
    let now = 2000;
    Object.defineProperty(performance, 'timeOrigin', {value: 99000});
    Object.defineProperty(performance, 'now', {value: () => now});
    process.on('message', m => { if (Number.isFinite(m.testNowMs)) now = m.testNowMs; });
    process.once('newListener', name => { if (name === 'message') process.send({type:'testReady'}); });`;
  const child = spawn(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(preload)}`,
    runFile, "--internal-sender"], { stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await bounded(new Promise(resolve => { if (child.exitCode !== null || child.signalCode !== null) resolve(); else child.once("exit", resolve); }));
  });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; assert.ok(stderr.length <= 4096); });
  const packets = [];
  receiver.on("message", packet => {
    const decoded = readOsc(packet);
    assert.ok(packets.length < 20);
    packets.push(decoded);
    if (decoded.address.endsWith("/start")) child.send({ type: "ackStart" });
    if (decoded.address.endsWith("/stop")) child.send({ type: "ackStop" });
  });
  let pulls = 0;
  let pending = false;
  let overlap = false;
  const live = (revision, expiresAtMs, epoch = 1) => ({ kind: "flock-live", epoch, revision,
    energy: 0.75, centroid: 0.25, expiresAtMs });
  const snapshot = (revision, expiresAtMs, epoch = 1) => ({ epoch, revision, closed: false, expiresAtMs });
  const replies = [
    { at: 1490, delivered: 1500, flockEvent: live(1, 101500), flockSnapshot: snapshot(1, 101500) },
    { at: 1990, delivered: 1990, flockEvent: live(2, 102000), flockSnapshot: snapshot(2, 102000) },
    { at: 2050, delivered: 2050, flockEvent: null, flockSnapshot: snapshot(4, null, 2) },
    { at: 2100, delivered: 2100, flockEvent: live(3, 102500), flockSnapshot: snapshot(3, 102500) },
    { at: 2150, delivered: 2150, flockEvent: { kind: "flock-mute", epoch: 2, revision: 5 }, flockSnapshot: snapshot(5, null, 2) },
    { at: 2200, delivered: 2200, flockEvent: live(6, 102700, 3), flockSnapshot: snapshot(6, 102700, 3) },
  ];
  const finished = bounded(new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", code => { if (code !== 0) reject(new Error(`sender exit ${code}: ${stderr}`)); });
    child.on("message", message => {
      if (message.type === "testReady") child.send({ type: "initialize", input: "real-cursor", flockInput: "enabled", duration: 30, session: "01".repeat(16) });
      if (message.type === "finished") resolve(message);
      if (message.type !== "clock") return;
      if (pending) overlap = true;
      pending = true;
      const row = message.takeRealInput ? replies[pulls++] : null;
      if (pulls >= 6) child.send({ type: "stop" });
      setTimeout(() => {
        pending = false;
        if (!child.connected) return;
        child.send({ type: "clock", requestId: message.requestId,
          value: row ? 10 + (row.at - 1000) / 1000 : 12,
          sampledAtMs: 100000 + (row?.at ?? (pulls ? 2200 : 1000)),
          testNowMs: 1000 + (row?.delivered ?? (pulls ? 2200 : 1000)),
          events: [], flockEvent: row?.flockEvent ?? null, flockSnapshot: row?.flockSnapshot });
      }, 5);
    });
  }), 5000);
  await finished.catch(error => { throw new Error(`${error.message}; pulls=${pulls}; packets=${packets.map(p => p.address)}`, { cause: error }); });
  assert.equal(stderr, "");
  assert.equal(overlap, false);
  const lives = packets.filter(packet => packet.address.endsWith("/flock-live"));
  assert.equal(lives.length, 1, "expired, stale watermark and postStop input must not send live UDP");
  assert.equal(lives[0].tags, ",sidiiffd");
  assert.equal(lives[0].values[4], 2, "only the 490ms-old second revision is live");
  assert.equal(lives[0].values[7], 11, "original expiry must not become sentAt+0.5");
  const mutes = packets.filter(packet => packet.address.endsWith("/flock-mute"));
  assert.equal(mutes.length, 1);
  assert.deepEqual(mutes[0].values.slice(3), [2, 5]);
  assert.equal(packets.some(packet => packet.address.endsWith("/flock")), false);
}

test("production sender rejects queued 500ms input, preserves 490ms deadline and observes eventless watermark before replay", senderScenario);

test("sender mutation checks catch renewed SC deadline and removed final admission", async t => {
  for (const [name, before, after, failure] of [
    ["renew-deadline", "clock.value + (event.expiresAtMs - clock.sampledAtMs) / 1000", "sentAt + 0.5", /original expiry/],
    ["remove-admission", "!admitFlock?.accept(event)", "false", /expired, stale watermark and postStop/],
  ]) {
    await t.test(name, async sub => {
      const root = await run.prepareRunRoot(null);
      sub.after(() => rm(root, { recursive: true, force: true }));
      for (const file of ["osc.mjs", "real-input.mjs", "flock-input.mjs", "flock-protocol.mjs"]) {
        await copyFile(path.resolve("sound", file), path.join(root, file));
      }
      const source = await readFile(path.resolve("sound/run.mjs"), "utf8");
      const mutant = source.replace(before, after);
      assert.notEqual(mutant, source, "mutation must alter the external fixture");
      await writeFile(path.join(root, "run.mjs"), mutant);
      await assert.rejects(senderScenario(sub, path.join(root, "run.mjs")), failure);
    });
  }
});

async function until(read, accept, label, ms = 1500) {
  const deadline = performance.now() + ms;
  let value;
  while (performance.now() < deadline) {
    value = await read();
    if (accept(value)) return value;
    await delay(10);
  }
  assert.fail(`${label}: ${JSON.stringify(value)}`);
}

test("silent production supervisor joins TCP and unique sender to SC; expiry gates wind and bird never renews Show", { timeout: 60000 }, async t => {
  const evidence = await run.prepareRunRoot(null);
  const runRoot = path.join(evidence, "run");
  // The native lifetime host owns this entire bounded integration process tree.
  const handle = await run.spawnManagedChild({ executable: process.execPath,
    args: [path.resolve("sound/run.mjs"), "--mode", "silent", "--duration", "12", "--input", "real-cursor", "--flock-input", "enabled", "--output", runRoot],
    cwd: path.resolve("."), ownedLifetime: true, timeoutMs: 50000,
    stdoutPath: path.join(evidence, "supervisor.stdout.log"), stderrPath: path.join(evidence, "supervisor.stderr.log"),
    maxLogBytes: 65536, maxStreamBytes: 131072 });
  const query = dgram.createSocket("udp4");
  const readJson = name => readFile(path.join(runRoot, name), "utf8").then(JSON.parse).catch(error => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  t.after(async () => {
    query.close();
    await handle.terminate();
    await bounded(handle.completion, 8000);
  });
  await bounded(new Promise(resolve => query.bind({ address: "127.0.0.1", port: 0 }, resolve)));
  const receipt = await until(() => readJson("control.json"), Boolean, "control creation", 10000);
  await delay(100);
  const descriptor = await readJson("flock-input.json");
  assert.ok(descriptor?.active, "explicit production launch must create bird descriptor");
  const ready = await until(() => readJson("ready.json"), Boolean, "production READY", 33000);
  assert.equal(ready.service.hardwareOutput, false);
  assert.equal(ready.session, ready.service.session, "SC fifth argument must not shift session identity");
  const tree = async () => {
    let receive;
    try {
      const reply = new Promise((resolve, reject) => {
        receive = (packet, remote) => {
          if (remote.address === "127.0.0.1" && remote.port === 57141) {
            try { const message = readOsc(packet); if (message.address === "/g_queryTree.reply") resolve(message.values); }
            catch (error) { reject(error); }
          }
        };
        query.on("message", receive);
        query.send(Buffer.from("2f675f717565727954726565000000002c6969000000000000000001", "hex"), 57141, "127.0.0.1", error => { if (error) reject(error); });
      });
      const fields = await bounded(reply, 1000);
      assert.equal(fields[0], 1);
      let offset = 1;
      const nodes = [];
      const visit = (depth = 0) => {
        assert.ok(depth < 8 && nodes.length < 64);
        const id = fields[offset++]; const count = fields[offset++];
        if (count >= 0) {
          assert.ok(count < 64);
          for (let i = 0; i < count; i++) visit(depth + 1);
        } else {
          assert.equal(count, -1);
          const name = fields[offset++]; const controls = {}; const countControls = fields[offset++];
          assert.ok(countControls >= 0 && countControls < 32);
          for (let i = 0; i < countControls; i++) controls[fields[offset++]] = fields[offset++];
          nodes.push({ id, name, controls });
        }
      };
      visit();
      assert.equal(offset, fields.length);
      assert.ok(nodes.every(node => node.name !== "jvOutput"));
      return nodes;
    } finally { query.off("message", receive); }
  };
  const show = await connect(t, receipt);
  assert.equal(await reply(show, { command: "attach", token: receipt.token, ...identity }), '{"ok":true,"input":"real-cursor"}\n');
  show.write(encode({ ...heartbeat(), token: receipt.token }) + encode({ ...heartbeat(2), command: "cursor",
    token: receipt.token, x: 0.5, y: 0.5, motion: 1 }));
  const bird = await connect(t, descriptor);
  assert.equal(await reply(bird, { version: 1, command: "attach-flock", token: descriptor.token, sourceId }), successAck);
  const origin = performance.now();
  bird.write(encode(sample()));
  const live = await until(tree, nodes => nodes.some(node => node.name === "jvWind" && node.controls.gate === 1), "real sender live wind");
  const wind = live.find(node => node.name === "jvWind");
  const expired = await until(tree, nodes => nodes.some(node => node.id === wind.id && node.controls.gate === 0), "no-new-data original deadline releases wind", 1000);
  assert.ok(expired.some(node => node.name === "jvPluck"), "cursor pluck survives wind-only expiry");
  let seq = 2;
  for (let i = 0; i < 18 && !bird.destroyed; i++) {
    bird.write(encode(sample(seq++, performance.now() - origin, { epoch: 2 })));
    await delay(100);
  }
  await closed(bird);
  const fading = await tree();
  assert.ok(fading.some(node => node.name === "jvMix" && node.controls.stop === 1), "Show lease is terminal despite fresh bird traffic");
  const result = await bounded(handle.completion, 12000);
  assert.equal(result.exitCode, 0);
  const summary = await readJson("summary.json");
  assert.equal(summary.clean, true);
  const log = await readFile(path.join(runRoot, "events.ndjson"), "utf8");
  const records = log.trim().split("\n").map(JSON.parse);
  assert.ok(records.some(record => record.type === "stopRequested" && record.body.source === "producer-timeout"));
  assert.ok(records.some(record => record.source === "sender" && record.body.kinds?.includes("flock-live")));
  assert.equal(log.includes(descriptor.token) || log.includes(receipt.token), false, "private tokens never enter event log");
  assert.equal((await readJson("flock-input.json")).active, false);
  t.diagnostic(`silent production TCP/sender/SC evidence: ${evidence}`);
});
