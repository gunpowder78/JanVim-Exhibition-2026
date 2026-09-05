import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash, randomBytes } from "node:crypto";
import dgram from "node:dgram";
import { readFile, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createContext, Script } from "node:vm";
import { prepareRunRoot, spawnManagedChild } from "../run.mjs";
import { analyzeWav } from "./analyze-wav.mjs";
import { recordedStop, requireRecordedSilence } from "./recorded-stop.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const epochNow = () => performance.timeOrigin + performance.now();
const encode = value => `${JSON.stringify(value)}\n`;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const queryPacket = Buffer.from("2f675f717565727954726565000000002c6969000000000000000001", "hex");

async function bounded(promise, ms = 1500) {
  const abort = new globalThis.AbortController();
  try {
    return await Promise.race([promise, delay(ms, null, { signal: abort.signal })
      .then(() => { throw new Error(`operation exceeded ${ms}ms`); })]);
  } finally { abort.abort(); }
}

async function until(read, accept, label, ms = 1500, deadline = performance.now() + ms) {
  while (performance.now() < deadline) {
    const value = await read();
    if (performance.now() >= deadline) break;
    if (accept(value)) return value;
    await delay(20);
  }
  assert.fail(`deadline exceeded: ${label}`);
}

// Run the actual shared helper with an isolated clock, never patched global timers.
function pollingFixture() {
  const clock = { now: 0 };
  const context = createContext({ assert,
    performance: { now: () => clock.now, timeOrigin: 100000 },
    delay: async ms => { clock.now += ms; },
  });
  new Script(until.toString()).runInContext(context, { timeout: 1000 });
  return { clock, context };
}

for (const completedAt of [600, 350, 349]) {
  test(`poll deadline ${completedAt < 350 ? "accepts before" : "rejects at or after"} 350ms: read completes at ${completedAt}ms`, async () => {
    const { clock, context } = pollingFixture();
    const result = context.until(async () => {
      clock.now = completedAt;
      return { gate: 0 };
    }, value => value.gate === 0, "explicit mute", 350);
    if (completedAt < 350) assert.equal((await result).gate, 0);
    else await assert.rejects(result, /deadline exceeded: explicit mute/);
  });
}

for (const phase of ["empty", "unavailable"]) {
  test(`poll deadline for ${phase} is anchored before the invalidation call`, async () => {
    const { clock, context } = pollingFixture();
    const source = await readFile(path.join(root, "sound/tests/flock-chain.check.mjs"), "utf8");
    const blocks = source.match(/^ {8}const invalidatedAt[\s\S]+?(?=^ {8}if \(phase === "stale"\))/gm);
    assert.equal(blocks?.length, 1, "execute the actual integration invalidation/wait block");
    Object.assign(context, { phase, epochNow: () => 100000 + clock.now,
      bird: {}, flockFrame: () => ({}),
      send: () => { clock.now = 200; }, // Invalidation itself consumes part of the budget.
      tree: async () => { clock.now = 500; return [{ name: "jvWind", controls: { gate: 0 } }]; },
      wind: node => node.name === "jvWind",
    });
    const result = new Script(`(async () => { ${blocks[0]} })()`)
      .runInContext(context, { timeout: 1000 });
    await assert.rejects(result, /deadline exceeded: .* wind gate released/);
  });
}

// Read-only query of the actual owned server. Never inject sound OSC from this test.
async function nodeTree(socket) {
  let receive;
  try {
    const packet = await bounded(new Promise((resolve, reject) => {
      receive = (bytes, remote) => {
        if (remote.address === "127.0.0.1" && remote.port === 57141) resolve(bytes);
      };
      socket.on("message", receive);
      socket.send(queryPacket, 57141, "127.0.0.1", error => { if (error) reject(error); });
    }), 1000);
    assert.ok(packet.length <= 16384, "bounded tree reply");
    let offset = 0;
    const string = () => {
      const end = packet.indexOf(0, offset);
      assert.ok(end >= offset);
      const value = packet.toString("utf8", offset, end);
      offset = Math.ceil((end + 1) / 4) * 4;
      return value;
    };
    assert.equal(string(), "/g_queryTree.reply");
    const tags = string();
    const values = [...tags.slice(1)].map(tag => {
      if (tag === "s") return string();
      assert.ok(["i", "f"].includes(tag));
      const value = tag === "i" ? packet.readInt32BE(offset) : packet.readFloatBE(offset);
      offset += 4;
      return value;
    });
    assert.equal(offset, packet.length);
    assert.equal(values[0], 1, "include controls");
    let index = 1;
    let visited = 0;
    const nodes = [];
    const visit = (depth = 0) => {
      assert.ok(depth < 8 && ++visited <= 64, "bounded node tree");
      const id = values[index++];
      const children = values[index++];
      if (children >= 0) {
        assert.ok(children <= 64);
        for (let child = 0; child < children; child++) visit(depth + 1);
      } else {
        assert.equal(children, -1);
        const name = values[index++];
        const count = values[index++];
        assert.ok(count >= 0 && count < 32);
        const controls = {};
        for (let control = 0; control < count; control++) controls[values[index++]] = values[index++];
        nodes.push({ id, name, controls });
      }
    };
    visit();
    assert.equal(index, values.length);
    assert.ok(nodes.every(node => node.name !== "jvOutput"), "no hardware output node");
    assert.ok(nodes.filter(node => node.name === "jvWind").length <= 2, "at most two live/releasing winds");
    assert.ok(nodes.filter(node => node.name === "jvPluck").length <= 8, "at most eight plucks");
    return nodes;
  } finally { socket.off("message", receive); }
}

async function attach(t, receipt, frame, expected) {
  const socket = net.createConnection({ host: receipt.host, port: receipt.port });
  socket.on("error", () => {});
  t.after(() => socket.destroy());
  await bounded(new Promise((resolve, reject) => {
    socket.once("connect", resolve); socket.once("error", reject);
  }), 1000);
  let receive;
  try {
    const ack = bounded(new Promise((resolve, reject) => {
      let bytes = Buffer.alloc(0);
      receive = chunk => {
        bytes = Buffer.concat([bytes, chunk]);
        if (bytes.length > 258) return reject(new Error("bounded attach ACK exceeded"));
        if (bytes.includes(10)) resolve(bytes.toString("utf8"));
      };
      socket.on("data", receive);
    }), 1000);
    socket.write(encode(frame));
    assert.equal(await ack, expected, "exact attach ACK");
  } finally { socket.off("data", receive); }
  return socket;
}

// Breaks caught: missing TCP→sender→SC wiring, fake energy=0 mute, expiry renewal,
// muted cursor/global mixer, disconnect taking Show down, or late input reviving Stop.
// Both producers below are SYNTHETIC fixtures. The separate real-cursor-chain test
// covers actual Lua/Bridge/client behavior. This file makes no GPU/hearing claim.
for (const disconnect of [false, true]) {
  test(`synthetic Show/flock production PCM chain: ${disconnect ? "disconnect preserves cursor" : "empty unavailable stale expiry and terminal Stop"}`,
    { timeout: 110000 }, async t => {
      const evidence = await prepareRunRoot(null);
      const runRoot = path.join(evidence, "run");
      t.diagnostic(`synthetic producer PCM evidence: ${evidence}; no GPU, HP or hearing claim`);
      const args = [path.join(root, "sound/run.mjs"), "--mode", "silent",
        "--duration", "65", "--input", "real-cursor", "--flock-input", "enabled", "--output", runRoot];
      const handle = await spawnManagedChild({ executable: process.execPath, args, cwd: root,
        ownedLifetime: true, timeoutMs: 100000, maxLogBytes: 65536, maxStreamBytes: 131072,
        stdoutPath: path.join(evidence, "supervisor.stdout.log"),
        stderrPath: path.join(evidence, "supervisor.stderr.log") });
      const query = dgram.createSocket("udp4");
      await bounded(new Promise(resolve => query.bind({ address: "127.0.0.1", port: 0 }, resolve)));
      let pumping = true;
      let pump = Promise.resolve();
      let pumpError;
      t.after(async () => {
        pumping = false;
        await pump;
        query.close();
        await handle.terminate();
        await bounded(handle.completion, 8000);
      });
      const json = async (name, publishing = false) => {
        try { return JSON.parse(await readFile(path.join(runRoot, name), "utf8")); }
        catch (error) {
          if (error.code === "ENOENT" || (publishing && error instanceof SyntaxError)) return null;
          throw error;
        }
      };
      const ready = await until(() => json("ready.json", true), Boolean, "actual READY", 33000);
      assert.equal(path.resolve(ready.runRoot), path.resolve(runRoot));
      assert.equal(ready.mode, "silent");
      assert.equal(ready.service.hardwareOutput, false);
      assert.equal(ready.session, ready.service.session);
      const receipt = await json("control.json");
      const descriptor = await json("flock-input.json");
      assert.equal(descriptor.active, true);
      assert.equal(descriptor.protocol, "jianshan-flock-ndjson-v1");
      assert.equal(descriptor.port, receipt.port);
      assert.ok(/^[0-9a-f]{64}$/.test(descriptor.token) && descriptor.token !== receipt.token,
        "independent private flock credential");
      const identity = { runId: "synthetic-task4", controllerRunId: "synthetic-task4-controller" };
      const show = await attach(t, receipt, { command: "attach", token: receipt.token, ...identity },
        '{"ok":true,"input":"real-cursor"}\n');
      const showOrigin = performance.now();
      const sourceId = randomBytes(16).toString("hex");
      const bird = await attach(t, descriptor, { version: 1, command: "attach-flock", token: descriptor.token, sourceId },
        '{"version":1,"ok":true,"input":"jianshan-flock-ndjson-v1"}\n');
      const birdOrigin = performance.now();
      let showSeq = 0;
      let birdSeq = 0;
      let live = false;
      let cursors = false;
      let birdEpoch = 1;
      let lastSampledAtMs = 0;
      const send = (socket, value) => {
        if (socket.destroyed) return;
        assert.ok(socket.writableLength <= 4096, "bounded synthetic producer pending bytes");
        socket.write(encode(value));
      };
      const showFrame = command => ({ command, token: receipt.token, ...identity,
        seq: ++showSeq, elapsedMs: performance.now() - showOrigin, generationId: 1, loopId: "loop-1",
        ...(command === "cursor" ? { x: 0.5, y: 0.5, motion: 1 } : {}) });
      const flockFrame = (state = "sample", sampledAtMs = performance.now() - birdOrigin) => ({
        version: 1, command: "flock", sourceId, seq: ++birdSeq, epoch: birdEpoch, sampledAtMs, state,
        ...(state === "sample" ? { energy: 0.85, centroidX: 0.25 } : {}) });
      pump = (async () => {
        for (let tick = 0; pumping && tick < 800; tick++) {
          send(show, showFrame("heartbeat"));
          if (cursors && tick % 2 === 0) send(show, showFrame("cursor"));
          if (live) {
            lastSampledAtMs = performance.now() - birdOrigin;
            send(bird, flockFrame("sample", lastSampledAtMs));
          }
          await delay(100);
        }
        assert.equal(pumping, false, "bounded fixture lifetime");
      })().catch(error => { pumpError = error; });
      const observations = [];
      const windows = [];
      const tree = async () => {
        if (pumpError) throw pumpError;
        assert.ok(observations.length < 1200, "bounded node evidence");
        const nodes = await nodeTree(query);
        observations.push({ atMs: epochNow(), nodes });
        return nodes;
      };
      const wind = node => node.name === "jvWind";
      const pluck = node => node.name === "jvPluck";
      const window = async (name, audible) => {
        const startMs = epochNow();
        await delay(500);
        windows.push({ name, audible, startMs: startMs + 150, endMs: epochNow() - 150 });
      };
      const phases = disconnect ? ["disconnect"] : ["empty", "unavailable", "expiry", "stale"];
      for (const phase of phases) {
        live = true;
        await until(tree, nodes => nodes.some(wind), `${phase} fresh wind`);
        await window(`${phase}-wind-only`, true);
        cursors = true;
        await until(tree, nodes => nodes.some(pluck), `${phase} mixed voices`);
        const before = await tree();
        // Refresh immediately before explicit mute: it must gate ahead of expiry.
        lastSampledAtMs = performance.now() - birdOrigin;
        send(bird, flockFrame("sample", lastSampledAtMs));
        live = false;
        const invalidatedAt = performance.now();
        const invalidatedAtMs = performance.timeOrigin + invalidatedAt;
        if (phase === "empty" || phase === "unavailable") send(bird, flockFrame(phase));
        if (phase === "disconnect") bird.end();
        await until(tree, nodes => nodes.filter(wind).every(node => node.controls.gate === 0),
          `${phase} wind gate released`, phase === "empty" || phase === "unavailable" ? 350 : 1000,
          phase === "empty" || phase === "unavailable" ? invalidatedAt + 350 : undefined);
        if (phase === "stale") {
          await delay(550);
          for (let index = 0; index < 3; index++) {
            send(bird, flockFrame("sample", lastSampledAtMs));
            await delay(100);
          }
        }
        await until(tree, nodes => !nodes.some(wind) && nodes.some(node => pluck(node) &&
          !before.some(old => old.id === node.id)), `${phase} NEW cursor pluck with no wind`);
        await window(`${phase}-cursor-only`, true);
        assert.equal(show.destroyed, false, "bird invalidation leaves Show attached");
        cursors = false;
        await until(tree, nodes => !nodes.some(node => wind(node) || pluck(node)), `${phase} voices finish`, 2600);
        await delay(150); // Limiter/LeakDC tail, no product timing changed.
        await window(`${phase}-muted`, false);
        windows.at(-1).invalidatedAtMs = invalidatedAtMs;
        assert.ok((await tree()).some(node => node.name === "jvMix" && node.controls.stop === 0),
          "independent mute never stops the mixer");
      }
      live = !disconnect;
      cursors = true;
      await until(tree, nodes => nodes.some(pluck) && (disconnect || nodes.some(wind)), "active preStop voices");
      await delay(500);
      // Queue Stop and late Show frames in one actual TCP write. Submit a new
      // bird epoch immediately too, before awaiting ACK/connection destruction.
      assert.equal(show.destroyed, false);
      if (!disconnect) assert.equal(bird.destroyed, false);
      const stopAck = bounded(new Promise(resolve => show.once("data", chunk => resolve(chunk.toString()))));
      birdEpoch++;
      show.write(encode({ command: "stop", token: receipt.token }) +
        encode(showFrame("heartbeat")) + encode(showFrame("cursor")));
      if (!disconnect) send(bird, flockFrame());
      assert.equal(await stopAck, '{"ok":true}\n');
      await until(tree, nodes => nodes.some(node => node.name === "jvMix" && node.controls.stop === 1), "terminal mixer Stop");
      await delay(700);
      send(show, showFrame("heartbeat"));
      send(show, showFrame("cursor"));
      if (!disconnect) send(bird, flockFrame());
      pumping = false;
      await pump;
      if (pumpError) throw pumpError;
      const result = await bounded(handle.completion, 15000);
      assert.equal(result.exitCode, 0);
      assert.equal(result.limitReason, null);
      const summary = await json("summary.json");
      assert.equal(summary.clean, true);
      assert.equal(summary.reason, "requested");
      assert.ok(summary.resource.maxPlucks > 0 && summary.resource.maxPlucks <= 8);
      assert.equal((await json("flock-input.json")).active, false);
      const log = await readFile(path.join(runRoot, "events.ndjson"), "utf8");
      const events = log.trim().split(/\r?\n/).map(JSON.parse);
      const stopIndex = events.findIndex(event => event.type === "SOUND_EVENT" && event.body.type === "stop");
      assert.ok(stopIndex >= 0);
      const stats = events.filter(event => event.type === "SOUND_STATS");
      const stopped = events.slice(stopIndex).filter(event => event.type === "SOUND_STATS");
      assert.ok(stopped.length >= 2);
      assert.ok(stopped[0].body.acceptedPlucks >= phases.length * 3 && stopped[0].body.acceptedFlocks > 0,
        "actual receiver policy accepted both producer layers");
      assert.ok(stopped.every(event => event.body.acceptedPlucks === stopped[0].body.acceptedPlucks &&
        event.body.acceptedFlocks === stopped[0].body.acceptedFlocks), "late frames cannot increment stopped policy counters");
      assert.ok(events.some(event => event.source === "sender" && event.body.kinds?.includes("flock-live")));
      assert.ok(events.some(event => event.source === "sender" && event.body.kinds?.includes("flock-mute")));
      const captureEvidence = events.find(event => event.type === "SOUND_CAPTURE")?.body;
      const wav = await readFile(ready.capturePath);
      const stopPcm = recordedStop(wav, captureEvidence);
      requireRecordedSilence(stopPcm);
      const readyEvent = events.find(event => event.type === "SOUND_READY");
      const stopMs = ready.receiver.epochMilliseconds +
        (events[stopIndex].elapsedSeconds - readyEvent.elapsedSeconds) * 1000;
      // Capture's real Stop marker anchors earlier windows. 150ms interior guards
      // absorb 20Hz marker/IPC observation granularity; exact 490/500ms tests are
      // fake-clock policy + production sender tests, not these acoustic windows.
      const frameAt = ms => Math.round(captureEvidence.stopFrame + (ms - stopMs) * 48);
      const segments = windows.map(value => {
        const startFrame = frameAt(value.startMs);
        const endFrame = frameAt(value.endMs);
        assert.ok(startFrame >= 0 && endFrame < captureEvidence.recordedFrames &&
          endFrame < captureEvidence.voicesFreedAfterFrame, "measure acquired PCM before voice cleanup");
        return { name: value.name, start: startFrame / 48000, end: endFrame / 48000 };
      });
      const pcm = analyzeWav(wav, segments);
      for (const [index, segment] of pcm.segments.entries()) {
        if (windows[index].audible) assert.ok(segment.channels.every(channel => channel.peak > 0.001), `${segment.name}: nonzero stereo PCM`);
        else assert.equal(segment.peak, 0, `${segment.name}: no fake zero-energy wind or replay`);
      }
      assert.ok(pcm.channels.every(channel => channel.clippedSamples === 0));
      for (const file of ["sclang.stderr.log", "sender.stderr.log"]) {
        assert.equal((await readFile(path.join(runRoot, file), "utf8")).trim(), "", `unexpected ${file}`);
      }
      const sources = {};
      for (const file of ["sound/run.mjs", "sound/flock-input.mjs", "sound/flock-protocol.mjs", "sound/real-input.mjs",
        "sound/osc.mjs", "sound/policy.scd", "sound/service.scd", "sound/synths.scd", "sound/tests/flock-chain.check.mjs"]) {
        sources[file] = hash(await readFile(path.join(root, file)));
      }
      const proof = { producer: "SYNTHETIC Show and flock fixtures; actual supervisor/TCP/sender/SC",
        executable: process.execPath, args, runRoot: ready.runRoot, descriptorPath: path.join(ready.runRoot, "flock-input.json"),
        phases, windows, pcm, stopPcm, captureEvidence, stats, observations, sources,
        maxObservedWindNodes: Math.max(...observations.map(value => value.nodes.filter(wind).length)),
        resource: summary.resource, captureSha256: hash(wav), captureBytes: (await stat(ready.capturePath)).size };
      const proofText = JSON.stringify(proof, null, 2);
      assert.ok(![log, proofText].some(text => text.includes(descriptor.token) || text.includes(receipt.token)),
        "no credentials in shared evidence");
      await writeFile(path.join(evidence, "flock-chain-proof.json"), proofText);
    });
}
