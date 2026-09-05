import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import console from "node:console";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { recordedStop, requireRecordedSilence } from "./recorded-stop.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const parent = "D:/VirtualData/JanVim-Exhibition-Rehearsals";
const fixture = path.join(root, "nvim/tests/real_cursor_fixture.lua");
const poem = "白日依山尽\n黄河入海流";
const sha256 = text => createHash("sha256").update(text).digest("hex");
const fresh = label => path.join(parent, `sound-chain-${label}-${randomUUID()}`);

function launch(executable, args, env = {}) {
  const child = spawn(executable, args, { cwd: root, env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", chunk => { output = (output + chunk).slice(-65536); });
  }
  const completion = new Promise(resolve => {
    child.once("error", error => resolve({ exitCode: -1, output: String(error) }));
    child.once("close", exitCode => resolve({ exitCode, output }));
  });
  return { child, completion, output: () => output };
}

async function waitUntil(label, predicate, timeoutMs = 5000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await delay(40);
  }
  assert.fail(`deadline exceeded: ${label}`);
}

async function jsonWhenReady(file, handle, timeoutMs = 30000) {
  return waitUntil(path.basename(file), async () => {
    try { return JSON.parse(await readFile(file, "utf8")); }
    catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      assert.equal(handle.child.exitCode, null, handle.output());
      return false;
    }
  }, timeoutMs);
}

async function eventsAt(runRoot) {
  return (await readFile(path.join(runRoot, "events.ndjson"), "utf8"))
    .split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

async function completed(handle, timeoutMs = 25000) {
  await waitUntil("owned process exit", () => handle.child.exitCode !== null ||
    handle.child.signalCode !== null, timeoutMs);
  const result = await handle.completion;
  assert.equal(result.exitCode, 0, result.output);
  return result;
}

async function cleanup(handle) {
  if (!handle || handle.child.exitCode !== null || handle.child.signalCode !== null) return;
  const killer = launch("taskkill.exe", ["/PID", String(handle.child.pid), "/T", "/F"]);
  await completed(killer, 5000);
}

// Missing observer/age forwarding, wrong byte-to-cell mapping, simulated input,
// reset notes, a broken audio Stop, or audio entering the ACK chain must fail here.
test("actual Lua actions reach production sound silently and unavailable sound preserves text/ACK/reset", { timeout: 120000 }, async () => {
  assert.equal(await access(fixture).then(() => true, () => false), true,
    "actual headless Lua chain fixture must exist (no coordinate substitute)");
  // npm run typecheck is an explicit prerequisite; missing compiled modules fail, never skip.
  const { BridgeServer } = await import("../../apps/controller/dist/src/bridge-server.js");
  const { createShowSoundClient } = await import("../../apps/controller/dist/src/show-sound-client.js");
  const version = launch("nvim", ["--version"]);
  assert.match((await completed(version)).output, /^NVIM v0\.10\.1\r?\n/);
  const results = [];
  for (const available of [true, false]) {
    const runRoot = fresh(available ? "production" : "unavailable");
    const evidenceRoot = available ? runRoot : fresh("unavailable-evidence");
    const token = randomUUID();
    const bridge = new BridgeServer({ token, acknowledgementTimeoutMs: 2500 });
    const observations = [];
    const acknowledgements = [];
    const diagnostics = [];
    const client = createShowSoundClient({ soundRunRoot: runRoot,
      runId: "real-lua-proof", controllerRunId: "real-lua-proof-controller",
      diagnostic: reason => diagnostics.push(reason) });
    const unsubscribe = bridge.onCursor((event, timing) => {
      assert.ok(observations.length < 128, "bounded observation evidence");
      observations.push({ event, timing, deliveredAtMs: performance.now() });
      client.observe(event, timing); // Preserve REAL Bridge age metadata verbatim.
    });
    let sound;
    let nvim;
    let ready;
    const checkpoints = [];
    let loopId = "loop-1";
    const dispatch = async (cueId, action, expectedText) => {
      const ack = await bridge.dispatch({ schema: 1, token, loopId, cueId, action });
      assert.equal(ack.outcome, "applied", JSON.stringify(ack));
      assert.equal(ack.bufferSha256, sha256(expectedText), cueId);
      acknowledgements.push(ack);
      return ack;
    };
    const stableNotes = async label => {
      if (!available) { await delay(1250); return; }
      // Allow the one pending fresh sample to settle, then compare two receiver
      // snapshots across an idle interval. Existing pluck tails may continue.
      await delay(550);
      const beforeEvents = await eventsAt(runRoot);
      const before = await waitUntil(`${label} first receiver stats`, async () =>
        (await eventsAt(runRoot)).slice(beforeEvents.length).find(e => e.type === "SOUND_STATS"), 6500);
      // Production stats are emitted every five seconds. Wait for evidence, not
      // an assumed one-second telemetry cadence.
      const after = await waitUntil(`${label} later receiver stats`, async () =>
        (await eventsAt(runRoot)).find(e => e.type === "SOUND_STATS" &&
          e.elapsedSeconds > before.elapsedSeconds), 6500);
      assert.ok(after.elapsedSeconds > before.elapsedSeconds);
      if (label === "prepare-stationary") assert.equal(before.body.acceptedPlucks, 0);
      if (label === "reset") assert.equal(before.body.acceptedPlucks,
        checkpoints.at(-1).after.body.acceptedPlucks, "reset emitted a new note");
      assert.equal(after.body.acceptedPlucks, before.body.acceptedPlucks, `${label}: NEW note while idle`);
      checkpoints.push({ label, before, after });
    };
    try {
      if (available) {
        sound = launch("pwsh.exe", ["-NoProfile", "-NonInteractive", "-File",
          path.join(root, "sound/start-sound.ps1"), "-Input", "RealCursor",
          "-Duration", "60", "-RunRoot", runRoot]); // No -Listen; existing caps unchanged.
        ready = await jsonWhenReady(path.join(runRoot, "ready.json"), sound);
        assert.equal(ready.mode, "silent");
        assert.equal(ready.service.hardwareOutput, false);
        await waitUntil("production sender start", async () => (await eventsAt(runRoot))
          .find(e => e.type === "SOUND_EVENT" && e.body.type === "start"));
      } else {
        // A fresh absent receipt is the real production failure path, not a mock client.
        await mkdir(evidenceRoot);
      }
      const address = await bridge.listen();
      nvim = launch("nvim", ["-u", "NONE", "-i", "NONE", "--noplugin", "--headless", "-l", fixture], {
        JANVIM_EXHIBITION_NVIM_ROOT: path.join(root, "nvim"),
        JANVIM_EXHIBITION_PORT: String(address.port), JANVIM_EXHIBITION_TOKEN: token,
        JANVIM_EXHIBITION_CURSOR_OBSERVER: "1",
      });
      await bridge.waitForAgent(3000);
      client.start();
      client.beginLoop(1, loopId);
      await delay(550);
      await dispatch("prepare", { type: "prepare", poem, expectedSha256: sha256(poem) }, poem);
      await dispatch("stationary-h", { type: "move", keys: "h", repeat: 1 }, poem);
      assert.equal(observations.length, 0);
      await stableNotes("prepare-stationary");
      const move = await dispatch("move-cells", { type: "move", keys: "l", repeat: 1 }, poem);
      assert.deepEqual(move.cursor, { row: 0, col: 3 }); // ACK byte column.
      assert.deepEqual([observations[0]?.event.row, observations[0]?.event.cellCol], [0, 2]);
      await delay(200);
      const inserted = "白文山水天地玄日依山尽\n黄河入海流";
      await dispatch("insert-cells", { type: "insert", text: "文山水天地玄", charsPerSecond: 5 }, inserted);
      assert.ok(observations.some(({ event }) => event.cueId === "insert-cells" && event.cellCol === 4));
      assert.ok(observations.some(({ event }) => event.cueId === "insert-cells" && event.cellCol === 12));
      await stableNotes("after-insert-stationary");
      const countBeforeReset = observations.length;
      client.reset();
      await dispatch("reset", { type: "reset" }, poem);
      await dispatch("reset-stationary", { type: "move", keys: "h", repeat: 1 }, poem);
      assert.equal(observations.length, countBeforeReset, "reset cannot manufacture cursor movement");
      await stableNotes("reset");
      loopId = "loop-2";
      client.beginLoop(1, loopId);
      await delay(200);
      await dispatch("resume-move", { type: "move", keys: "l", repeat: 1 }, poem);
      await delay(200);
      const resumed = "白星辰日月盈昃日依山尽\n黄河入海流";
      await dispatch("resume-insert", { type: "insert", text: "星辰日月盈昃", charsPerSecond: 5 }, resumed);
      // Actual recent movement establishes nonzero audio 0.25..0.1 seconds before Stop.
      client.stop("operator-stop");
      // Real late Lua traffic continues after the client latch, without synthetic samples.
      await dispatch("late-move", { type: "move", keys: "h", repeat: 1 }, resumed);
      await delay(200);
      await dispatch("late-insert", { type: "insert", text: "止", charsPerSecond: 5 },
        "白星辰日月止盈昃日依山尽\n黄河入海流");
      client.beginLoop(2, "late-loop");
      client.start();
      client.reset();
      await dispatch("final-reset", { type: "reset" }, poem);
      await dispatch("shutdown", { type: "shutdown" }, poem);
      const luaResult = await completed(nvim);
      const snapshots = luaResult.output.split(/\r?\n/).filter(line => line.startsWith("REAL_CURSOR_BUFFER "))
        .map(line => JSON.parse(line.slice("REAL_CURSOR_BUFFER ".length)));
      assert.equal(snapshots.length, acknowledgements.length, luaResult.output);
      assert.equal(snapshots.find(s => s.cueId === "insert-cells").text, inserted);
      assert.equal(snapshots.find(s => s.cueId === "reset").text, poem);
      assert.equal(snapshots.find(s => s.cueId === "final-reset").text, poem);
      assert.ok(observations.every(({ timing }) => Number.isFinite(timing.ageMs) && timing.ageMs >= 0 && timing.ageMs <= 500));
      assert.ok(observations.some(({ timing }) => timing.ageMs > 0), "real source delivery age was lost");
      let acoustic;
      if (available) {
        const soundResult = await completed(sound);
        const summary = await jsonWhenReady(path.join(runRoot, "summary.json"), sound);
        assert.equal(summary.clean, true);
        assert.equal(summary.reason, "requested");
        assert.ok(summary.resource.maxPlucks > 0 && summary.resource.maxPlucks <= 8);
        assert.deepEqual(diagnostics, []);
        const events = await eventsAt(runRoot);
        const stats = events.filter(e => e.type === "SOUND_STATS");
        assert.ok(stats.some(e => e.body.acceptedPlucks > 0), "no received production plucks");
        assert.ok(stats.every(e => e.body.acceptedFlocks === 0), "simulated flock leaked into real input");
        assert.ok(!events.some(e => e.type === "cue" && e.body.kinds.includes("flock")));
        const stopIndex = events.findIndex(e => e.type === "SOUND_EVENT" && e.body.type === "stop");
        assert.ok(stopIndex >= 0);
        const stoppedStats = events.slice(stopIndex).filter(e => e.type === "SOUND_STATS");
        assert.ok(stoppedStats.length >= 2);
        assert.ok(stoppedStats.every(e => e.body.acceptedPlucks === stoppedStats[0].body.acceptedPlucks), "late cursor revived Stop");
        const resetCount = checkpoints.find(c => c.label === "reset").after.body.acceptedPlucks;
        assert.ok(stoppedStats[0].body.acceptedPlucks > resetCount, "loop after reset did not resume sound");
        const captureEvidence = events.find(e => e.type === "SOUND_CAPTURE")?.body;
        acoustic = recordedStop(await readFile(ready.capturePath), captureEvidence);
        requireRecordedSilence(acoustic);
        await writeFile(path.join(evidenceRoot, "chain-sound-output.log"), soundResult.output);
      } else {
        assert.deepEqual(diagnostics, ["sound-receipt-or-connect-failed"]);
      }
      const proof = { available, runRoot, acknowledgements, observations, snapshots, checkpoints, diagnostics, acoustic };
      await writeFile(path.join(evidenceRoot, "chain-proof.json"), JSON.stringify(proof, null, 2));
      await writeFile(path.join(evidenceRoot, "chain-nvim-output.log"), luaResult.output);
      console.log(`REAL_CURSOR_CHAIN_EVIDENCE ${JSON.stringify({ available, evidenceRoot,
        acks: acknowledgements.length, observed: observations.length, acoustic })}`);
      results.push({ acknowledgements, snapshots });
    } finally {
      await mkdir(evidenceRoot, { recursive: true });
      await writeFile(path.join(evidenceRoot, "chain-attempt.json"), JSON.stringify({
        acknowledgements, observations, checkpoints, diagnostics }, null, 2));
      if (nvim) await writeFile(path.join(evidenceRoot, "chain-nvim-output.log"), nvim.output());
      console.log(`REAL_CURSOR_CHAIN_ATTEMPT ${evidenceRoot}`);
      client.stop("fixture-cleanup");
      unsubscribe();
      await bridge.close();
      await cleanup(nvim);
      await cleanup(sound);
    }
  }
  assert.deepEqual(results[1], results[0], "unavailable sound changed actual Lua text/ACK/reset");
});
