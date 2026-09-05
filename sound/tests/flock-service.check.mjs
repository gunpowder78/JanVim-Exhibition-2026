import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import dgram from "node:dgram";
import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { encodeMessage } from "../osc.mjs";
import { spawnManagedChild } from "../run.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const sound = path.join(root, "sound");
const session = "0123456789abcdef0123456789abcdef";
const int = (value) => ({ type: "i", value });
const float = (value) => ({ type: "f", value });
const double = (value) => ({ type: "d", value });
const string = (value) => ({ type: "s", value });

async function bounded(promise, ms = 1000) {
  const controller = new globalThis.AbortController();
  try {
    return await Promise.race([promise, delay(ms, null, { signal: controller.signal })
      .then(() => { throw new Error(`operation exceeded ${ms}ms`); })]);
  } finally { controller.abort(); }
}

async function until(read, accept, label, ms = 1000) {
  const deadline = performance.now() + ms;
  let value;
  while (performance.now() < deadline) {
    value = await read();
    if (accept(value)) return value;
    await delay(10);
  }
  assert.fail(`${label}: ${JSON.stringify(value)}`);
}

// Only the query packet below goes directly to the owned scsynth endpoint.
// All behavior changes go through the real service's OSC/policy/actions.
const treeQuery = Buffer.from("2f675f717565727954726565000000002c6969000000000000000001", "hex");
function readOsc(packet) {
  let offset = 0;
  function readString() {
    const end = packet.indexOf(0, offset);
    assert.ok(end >= offset, "unterminated OSC reply");
    const value = packet.toString("utf8", offset, end);
    offset = Math.ceil((end + 1) / 4) * 4;
    return value;
  }
  const address = readString();
  const tags = readString();
  const values = [...tags.slice(1)].map((tag) => {
    if (tag === "s") return readString();
    assert.ok(["i", "f", "d"].includes(tag), `unexpected reply tag ${tag}`);
    const value = tag === "i" ? packet.readInt32BE(offset)
      : tag === "f" ? packet.readFloatBE(offset) : packet.readDoubleBE(offset);
    offset += tag === "d" ? 8 : 4;
    return value;
  });
  assert.equal(offset, packet.length, "complete OSC reply consumed");
  return { address, values };
}

async function bind(socket, port = 0) {
  await bounded(new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.bind({ address: "127.0.0.1", port, exclusive: true }, resolve);
  }));
}

async function portsAvailable() {
  for (const port of [57140, 57141]) {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: false });
    try { await bind(socket, port); } finally { socket.close(); }
  }
}

async function launch(extra = []) {
  await portsAvailable();
  const evidenceRoot = path.join(root, ".superpowers/sdd/2026-09-05-janvim-flock-ingress-v1/service-evidence");
  await mkdir(evidenceRoot, { recursive: true });
  const evidence = await mkdtemp(path.join(evidenceRoot, "task-2-"));
  const events = [];
  let anchor;
  const handle = await spawnManagedChild({
    executable: "C:/Program Files/SuperCollider-3.14.1/sclang.exe",
    args: ["-a", "-l", path.join(sound, "sclang-conf.yaml"),
      "--include-path", "C:/Program Files/SuperCollider-3.14.1/SCClassLibrary",
      "--include-path", path.join(sound, "sclang-isolation"), "-u", "57140",
      path.join(sound, "service.scd"), session, "silent", "20", "", ...extra],
    cwd: root, ownedLifetime: true, timeoutMs: 45000,
    maxLogBytes: 65536, maxStreamBytes: 65536,
    stdoutPath: path.join(evidence, "sclang.stdout.log"),
    stderrPath: path.join(evidence, "sclang.stderr.log"),
    onStdoutLine: (line, at) => {
      if (line.startsWith("SOUND_")) {
        assert.ok(events.length < 64, "bounded service evidence");
        const split = line.indexOf(" ");
        const event = { name: line.slice(0, split), data: JSON.parse(line.slice(split + 1)), at };
        events.push(event);
        if (event.name === "SOUND_READY") anchor = event;
      }
    },
  });
  const socket = dgram.createSocket("udp4");
  await bind(socket);
  let seq = 0;
  let revision = 0;
  const now = () => anchor.data.clock + (performance.now() - anchor.at) / 1000;
  const send = async (name, fields = [], sentAt = now()) => {
    const packet = encodeMessage(`/janvim/sound/v1/${name}`, [string(session), int(++seq), double(sentAt), ...fields]);
    await bounded(new Promise((resolve, reject) => socket.send(packet, 57140, "127.0.0.1",
      (error) => error ? reject(error) : resolve())));
  };
  const live = async (energy = 0.75, lifetime = 0.5) => {
    const at = now();
    await send("flock-live", [int(1), int(++revision), float(energy), float(0.25), double(at + lifetime)], at);
    return at + lifetime;
  };
  const mute = () => send("flock-mute", [int(1), int(++revision)]);
  const tree = async () => {
    let receive;
    try {
      const reply = new Promise((resolve, reject) => {
        receive = (packet, remote) => {
          if (remote.port !== 57141 || remote.address !== "127.0.0.1") return;
          try {
            const message = readOsc(packet);
            if (message.address === "/g_queryTree.reply") resolve(message.values);
          } catch (error) { reject(error); }
        };
        socket.on("message", receive);
        socket.send(treeQuery, 57141, "127.0.0.1", (error) => { if (error) reject(error); });
      });
      const fields = await bounded(reply, 500);
      assert.equal(fields[0], 1, "tree reply includes synth controls");
      let cursor = 1;
      const nodes = [];
      function visit(depth = 0) {
        assert.ok(depth < 8 && nodes.length < 64, "bounded owned node tree");
        const id = fields[cursor++];
        const count = fields[cursor++];
        if (count >= 0) {
          assert.ok(count < 64, "bounded group size");
          for (let index = 0; index < count; index += 1) visit(depth + 1);
        } else {
          assert.equal(count, -1);
          const name = fields[cursor++];
          const controls = {};
          const countControls = fields[cursor++];
          assert.ok(countControls >= 0 && countControls < 32);
          for (let index = 0; index < countControls; index += 1) controls[fields[cursor++]] = fields[cursor++];
          nodes.push({ id, name, controls });
        }
      }
      visit();
      assert.equal(cursor, fields.length);
      assert.ok(nodes.every(({ name }) => name !== "jvOutput"), "silent service has no hardware output synth");
      return nodes;
    } finally { socket.off("message", receive); }
  };
  return { handle, events, evidence, now, send, live, mute, tree,
    winds: async () => (await tree()).filter(({ name }) => name === "jvWind"),
    ready: async () => {
      await until(async () => {
        if (events.some(({ name }) => name === "SOUND_COMPLETE")) {
          assert.fail(`service completed before READY: ${JSON.stringify(events)}`);
        }
        return anchor;
      }, Boolean, "service READY", 33000);
      assert.equal(anchor.data.hardwareOutput, false);
      await send("start");
      await until(tree, (nodes) => nodes.some(({ name, controls }) => name === "jvMix" && controls.armed === 1), "mixer armed");
    },
    stop: async () => {
      await send("stop");
      await until(async () => events, (list) => list.some(({ name, data }) => name === "SOUND_EVENT" && data.type === "stop"), "stop event");
    },
    complete: async () => {
      const result = await bounded(handle.completion, 12000);
      assert.equal(result.exitCode, 0, JSON.stringify({ result, events, evidence }));
      assert.equal(result.limitReason, null);
      assert.ok(events.some(({ name, data }) => name === "SOUND_COMPLETE" && data.clean === true));
      await portsAvailable();
    },
    cleanup: async () => { socket.close(); await handle.terminate(); await bounded(handle.completion, 6500); },
  };
}

test("silent flock-v1 service gates wind independently, bounds flaps, and preserves whole Stop fade", { timeout: 60000 }, async (t) => {
  const service = await launch(["flock-v1"]);
  try {
    await service.ready();
    await service.live();
    const first = (await until(service.winds, (nodes) => nodes.length === 1, "first live wind"))[0];
    assert.equal(first.controls.gate, 1);
    await service.send("cursor", [float(0.5), float(0.5), float(1)]);
    await service.mute();
    await until(service.winds, (nodes) => nodes.length === 1 && nodes[0].controls.gate === 0, "explicit mute releases existing gate");
    await service.live();
    const pair = await until(service.winds, (nodes) => nodes.length === 2, "active plus releasing pair");
    const replacement = pair.find(({ id }) => id !== first.id);
    assert.equal(replacement.controls.gate, 1);
    await until(service.winds, (nodes) => nodes.length === 1 && nodes[0].id === replacement.id, "old wind frees alone", 450);
    await service.live(0.25);
    const updated = await until(service.winds, (nodes) => nodes.length === 1 && nodes[0].controls.energy === 0.25, "old onFree must retain replacement");
    assert.equal(updated[0].id, replacement.id);
    assert.ok((await service.tree()).some(({ name }) => name === "jvPluck"), "pluck survives wind mute and release");

    // The known active source plus one releasing source fill both seats.
    await service.mute();
    await service.live();
    await until(service.winds, (nodes) => nodes.length === 2, "second releasing pair");
    await service.mute();
    for (let index = 0; index < 6; index += 1) {
      const before = await service.winds();
      await service.live();
      const nodes = await service.winds();
      assert.ok(nodes.length <= 2, "rapid flaps cannot allocate a third wind");
      // An async query can outlast the existing 0.3s release. Assert the drop
      // only when both releasing identities survived across this live/query.
      if (before.length === 2 && before.every(({ controls }) => controls.gate === 0) && nodes.length === 2 &&
          nodes.every(({ id }) => before.some(node => node.id === id))) {
        assert.ok(nodes.every(({ controls }) => controls.gate === 0), "full seats drop live without replay");
      }
      await service.mute();
      await until(service.winds, (remaining) => {
        assert.ok(remaining.length <= 2, "mute cannot exceed two wind nodes");
        return remaining.every(({ controls }) => controls.gate === 0);
      }, "every flap mutes all remaining winds");
    }
    await until(service.winds, (nodes) => nodes.length === 0, "releasing seats reclaimed", 550);
    await delay(70);
    assert.equal((await service.winds()).length, 0, "no delayed replay after a seat frees");

    await service.send("heartbeat");
    await service.send("cursor", [float(0.5), float(0.5), float(1)]);
    const expiry = await service.live(0.75, 0.24);
    const expiring = (await until(service.winds, (nodes) => nodes.length === 1, "expiry fixture wind"))[0];
    const expired = await until(service.winds, (nodes) => nodes.length === 1 && nodes[0].controls.gate === 0, "SC tick releases without new packet", 500);
    assert.equal(expired[0].id, expiring.id);
    assert.ok(service.now() >= expiry, "gate does not release before original deadline");
    assert.ok((await service.tree()).some(({ name }) => name === "jvPluck"), "pluck continues after deadline mute");
    await until(service.winds, (nodes) => nodes.length === 0, "existing 0.3s release frees wind", 500);

    await service.send("heartbeat");
    await service.live();
    const stopWind = (await until(service.winds, (nodes) => nodes.length === 1, "Stop fixture wind"))[0];
    await service.stop();
    await delay(700); // Past both wind's original deadline and its 0.3s release.
    await service.live(); // Terminal service responders have already been removed.
    const fading = await service.tree();
    assert.ok(fading.some(({ name, controls }) => name === "jvMix" && controls.stop === 1), "mixer remains alive in the 1.5s fade");
    assert.ok(fading.some(({ id, controls }) => id === stopWind.id && controls.gate === 1), "global Stop does not substitute a 0.3s wind release");
    assert.equal(fading.filter(({ name }) => name === "jvWind").length, 1, "postStop live cannot create replacement");
    await service.complete();
    t.diagnostic(`real silent SC node evidence: ${service.evidence}; no GPU or hearing claim`);
  } finally { await service.cleanup(); }
});

test("four-argument silent service ignores ingress paths and preserves legacy flock", { timeout: 60000 }, async (t) => {
  const service = await launch();
  try {
    await service.ready();
    await service.live();
    await delay(80);
    assert.equal((await service.winds()).length, 0, "new live path disabled");
    await service.send("flock", [float(0.75), float(0.25)]);
    const legacy = (await until(service.winds, (nodes) => nodes.length === 1, "legacy flock creates wind"))[0];
    await service.mute();
    await delay(600);
    const nodes = await service.winds();
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].id, legacy.id);
    assert.equal(nodes[0].controls.gate, 1, "new mute path disabled; legacy has no 500ms deadline");
    await service.stop();
    await service.complete();
    t.diagnostic(`four-argument compatibility evidence: ${service.evidence}`);
  } finally { await service.cleanup(); }
});

test("service rejects an unsupported fifth mode before READY", { timeout: 15000 }, async (t) => {
  const service = await launch(["flock-v2"]);
  try {
    const result = await bounded(service.handle.completion, 10000);
    assert.equal(result.exitCode, 2);
    assert.equal(result.limitReason, null);
    assert.ok(!service.events.some(({ name }) => name === "SOUND_READY"));
    assert.ok(service.events.some(({ name, data }) => name === "SOUND_COMPLETE" && data.reason === "invalidArguments"));
    await portsAvailable();
    t.diagnostic(`unsupported-mode evidence: ${service.evidence}`);
  } finally { await service.cleanup(); }
});
