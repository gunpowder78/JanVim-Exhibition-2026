import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import console from "node:console";
import dgram from "node:dgram";
import { randomUUID } from "node:crypto";
import { cp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import test from "node:test";
import { clearTimeout, setTimeout } from "node:timers";
import { analyzeWav } from "./analyze-wav.mjs";
import { recordedStop, requireRecordedSilence } from "./recorded-stop.mjs";

const REHEARSAL_PARENT = "D:/VirtualData/JanVim-Exhibition-Rehearsals";
const REPOSITORY_ROOT = path.resolve(".");
const RUN_SCRIPT = path.join(REPOSITORY_ROOT, "sound", "run.mjs");
const START_SCRIPT = path.join(REPOSITORY_ROOT, "sound", "start-sound.ps1");
const STOP_SCRIPT = path.join(REPOSITORY_ROOT, "sound", "stop-sound.ps1");
const UNRELATED_CWD = "C:/Windows/System32";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const freshRunRoot = (label) => path.join(REHEARSAL_PARENT, `sound-${label}-${randomUUID()}`);

function spawnCaptured(executable, args, cwd = REPOSITORY_ROOT) {
  const child = spawn(executable, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout = (stdout + chunk).slice(-65536);
  });
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-65536);
  });
  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal, stderr, stdout }));
  });
  return {
    child,
    completion,
    get stderr() {
      return stderr;
    },
    get stdout() {
      return stdout;
    },
  };
}

async function terminateOwnedTree(handle) {
  if (handle.child.exitCode !== null || handle.child.signalCode !== null) return;
  const killer = spawnCaptured(
    "taskkill.exe",
    ["/PID", String(handle.child.pid), "/T", "/F"],
    REPOSITORY_ROOT,
  );
  await Promise.race([killer.completion, delay(2500)]);
}

async function waitForJson(filePath, handle, timeoutMs = 30000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    try {
      return JSON.parse(await readFile(filePath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    if (handle.child.exitCode !== null || handle.child.signalCode !== null) {
      const result = await handle.completion;
      throw new Error(`process exited before ${path.basename(filePath)}: ${JSON.stringify(result)}`);
    }
    await delay(50);
  }
  throw new Error(`timed out waiting for ${filePath}`);
}

async function readEvents(runRoot) {
  try {
    const text = await readFile(path.join(runRoot, "events.ndjson"), "utf8");
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function waitForEvent(runRoot, handle, predicate, timeoutMs = 15000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const found = (await readEvents(runRoot)).find(predicate);
    if (found) return found;
    if (handle.child.exitCode !== null || handle.child.signalCode !== null) {
      const result = await handle.completion;
      throw new Error(`process exited before event: ${JSON.stringify(result)}`);
    }
    await delay(50);
  }
  throw new Error("timed out waiting for supervisor event");
}

async function waitForCompletion(handle, timeoutMs = 30000) {
  let timer;
  try {
    return await Promise.race([
      handle.completion,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("process completion timed out")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function startNodeRun(runRoot, duration, runScript = RUN_SCRIPT) {
  return spawnCaptured(process.execPath, [
    runScript,
    "--mode",
    "silent",
    "--duration",
    String(duration),
    "--output",
    runRoot,
  ]);
}

function oscString(value) {
  const bytes = Buffer.byteLength(value, "ascii") + 1;
  const result = Buffer.alloc(Math.ceil(bytes / 4) * 4);
  result.write(value, "ascii");
  return result;
}

function unsafeOsc(pathName, args) {
  const tags = oscString(`,${args.map((argument) => argument.type).join("")}`);
  const encoded = args.map(({ type, value }) => {
    if (type === "s") return oscString(value);
    const result = Buffer.alloc(type === "d" ? 8 : 4);
    if (type === "i") result.writeInt32BE(value);
    else if (type === "d") result.writeDoubleBE(value);
    else result.writeFloatBE(value);
    return result;
  });
  return Buffer.concat([oscString(pathName), tags, ...encoded]);
}

async function sendPacket(packet) {
  const socket = dgram.createSocket("udp4");
  try {
    await new Promise((resolve, reject) => {
      socket.send(packet, 57140, "127.0.0.1", (error) => (error ? reject(error) : resolve()));
    });
  } finally {
    socket.close();
  }
}

function receiverNow(ready) {
  const epochNow = performance.timeOrigin + performance.now();
  return ready.receiver.clock + (epochNow - ready.receiver.epochMilliseconds) / 1000;
}

async function assertPortsReusable() {
  const sockets = [];
  try {
    for (const port of [57140, 57141]) {
      const socket = dgram.createSocket({ type: "udp4", reuseAddr: false });
      sockets.push(socket);
      await new Promise((resolve, reject) => {
        socket.once("error", reject);
        socket.bind({ address: "127.0.0.1", exclusive: true, port }, resolve);
      });
    }
  } finally {
    for (const socket of sockets) socket.close();
  }
}

async function powershellJson(script) {
  const handle = spawnCaptured("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
  const result = await waitForCompletion(handle, 5000);
  assert.equal(result.exitCode, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
}

const psQuote = (value) => `'${String(value).replaceAll("'", "''")}'`;

async function pinDirectChild(rootPid, predicate) {
  const processes = await powershellJson(`
    @(Get-CimInstance Win32_Process | Where-Object ParentProcessId -eq ${rootPid} |
      Select-Object @{n='pid';e={[int]$_.ProcessId}},@{n='parentPid';e={[int]$_.ParentProcessId}},
        @{n='started';e={$_.CreationDate.ToUniversalTime().ToString('o')}},
        @{n='executable';e={$_.ExecutablePath}},@{n='commandLine';e={$_.CommandLine}}) |
      ConvertTo-Json -Compress
  `);
  const list = Array.isArray(processes) ? processes : [processes];
  const selected = list.find(predicate);
  assert.ok(selected, `no matching direct child of ${rootPid}: ${JSON.stringify(list)}`);
  return selected;
}

async function stopPinnedProcess(identity) {
  const script = `
    $p = Get-CimInstance Win32_Process -Filter "ProcessId = ${identity.pid}"
    if ($null -eq $p) { exit 2 }
    $started = $p.CreationDate.ToUniversalTime().ToString('o')
    if ($started -ne ${psQuote(identity.started)} -or
        $p.ExecutablePath -ne ${psQuote(identity.executable)} -or
        [int]$p.ParentProcessId -ne ${identity.parentPid}) { exit 3 }
    Stop-Process -Id ${identity.pid} -Force
  `;
  const handle = spawnCaptured("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
  const result = await waitForCompletion(handle, 5000);
  assert.equal(result.exitCode, 0, result.stderr);
}

async function runFreshProof(label) {
  const runRoot = freshRunRoot(label);
  const handle = startNodeRun(runRoot, 2);
  try {
    await waitForJson(path.join(runRoot, "ready.json"), handle);
    const result = await waitForCompletion(handle, 20000);
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    const summary = await waitForJson(path.join(runRoot, "summary.json"), handle);
    assert.equal(summary.clean, true);
    return runRoot;
  } finally {
    await terminateOwnedTree(handle);
  }
}

for (const omitMixerStop of [false, true]) {
test(omitMixerStop
  ? "omitted service mixer stop fails recorded silence before voice cleanup despite unused padding"
  : "silent sender reaches policy and SynthDefs, rejects probes, and fades to silence", async () => {
  const observedStart = performance.now();
  const runRoot = freshRunRoot("integration");
  let runScript = RUN_SCRIPT;
  if (omitMixerStop) {
    const variantRoot = freshRunRoot("omitted-stop-source");
    await cp(path.join(REPOSITORY_ROOT, "sound"), variantRoot, { recursive: true, errorOnExist: true });
    const servicePath = path.join(variantRoot, "service.scd");
    const source = await readFile(servicePath, "utf8");
    const stopStatement = "mixer !? { mixer.set(\\stop, 1) };";
    assert.equal(source.split(stopStatement).length, 2, "mutation must omit exactly the service mixer stop");
    await writeFile(servicePath, source.replace(stopStatement, "/* TEST NEGATIVE CONTROL: mixer stop omitted */"));
    runScript = path.join(variantRoot, "run.mjs");
  }
  const handle = startNodeRun(runRoot, 9, runScript);
  try {
    const ready = await waitForJson(path.join(runRoot, "ready.json"), handle);
    assert.equal(ready.mode, "silent");
    assert.equal(ready.service.hardwareOutput, false);
    assert.equal(ready.languageCreation.pid, ready.language.pid);
    assert.ok(ready.language.executable.toLowerCase().endsWith("\\sclang.exe"));
    assert.ok(ready.serviceHost, "owned lifetime host must have an explicit READY identity");
    assert.equal(ready.language.parentPid, ready.serviceHost.pid);
    assert.ok(ready.serviceHost.executable.toLowerCase().endsWith("\\pwsh.exe"));
    assert.ok(ready.receiver.capturedBeforeInspection);
    const startEvent = await waitForEvent(
      runRoot,
      handle,
      (event) => event.source === "service" && event.type === "SOUND_EVENT" && event.body.type === "start",
    );

    const now = receiverNow(ready);
    const common = [
      { type: "s", value: ready.session },
      { type: "i", value: 2_000_000_000 },
    ];
    const probes = [
      unsafeOsc("/janvim/sound/v1/heartbeat", [...common, { type: "d", value: now - 1 }]),
      unsafeOsc("/janvim/sound/v1/heartbeat", [
        { type: "s", value: "ffffffffffffffffffffffffffffffff" },
        { type: "i", value: 2_000_000_000 },
        { type: "d", value: now },
      ]),
      unsafeOsc("/janvim/sound/v1/heartbeat", [
        { type: "i", value: 7 },
        { type: "i", value: 2_000_000_000 },
        { type: "d", value: now },
      ]),
      unsafeOsc("/janvim/sound/v1/heartbeat", [
        ...common,
        { type: "d", value: now },
        { type: "f", value: 0.5 },
      ]),
      unsafeOsc("/janvim/sound/v1/cursor", [
        ...common,
        { type: "d", value: now },
        { type: "f", value: Number.NaN },
        { type: "f", value: 0.5 },
        { type: "f", value: 0.5 },
      ]),
    ];
    for (const packet of probes) await sendPacket(packet);

    const statsEvent = await waitForEvent(
      runRoot,
      handle,
      (event) =>
        event.source === "service" &&
        event.type === "SOUND_STATS" &&
        event.body.rejected >= 5 &&
        event.body.acceptedPlucks > 0 &&
        event.body.acceptedFlocks > 0,
      12000,
    );
    assert.ok(statsEvent.body.maxPlucks <= 8);

    await waitForEvent(
      runRoot,
      handle,
      (event) =>
        event.source === "sender" &&
        event.type === "cue" &&
        event.body.elapsed >= 6.25 &&
        event.body.kinds.includes("cursor") &&
        event.body.kinds.includes("flock"),
      5000,
    );
    const stopRequest = spawnCaptured(process.execPath, [RUN_SCRIPT, "--stop", runRoot]);
    const stopRequestResult = await waitForCompletion(stopRequest, 5000);
    assert.equal(stopRequestResult.exitCode, 0, stopRequestResult.stdout + stopRequestResult.stderr);

    const stopEvent = await waitForEvent(
      runRoot,
      handle,
      (event) => event.source === "service" && event.type === "SOUND_EVENT" && event.body.type === "stop",
      12000,
    );
    const postStopBefore = await waitForEvent(
      runRoot,
      handle,
      (event) =>
        event.source === "service" &&
        event.type === "SOUND_STATS" &&
        event.elapsedSeconds >= stopEvent.elapsedSeconds,
      5000,
    );
    await sendPacket(
      unsafeOsc("/janvim/sound/v1/cursor", [
        { type: "s", value: ready.session },
        { type: "i", value: 2_000_000_001 },
        { type: "d", value: receiverNow(ready) },
        { type: "f", value: 0.5 },
        { type: "f", value: 0.5 },
        { type: "f", value: 1 },
      ]),
    );

    const result = await waitForCompletion(handle, 25000);
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    assert.ok((performance.now() - observedStart) / 1000 < 30, "completed run kept Node alive");
    const summary = await waitForJson(path.join(runRoot, "summary.json"), handle);
    assert.equal(summary.clean, true);
    assert.ok(summary.resource.maxPlucks > 0 && summary.resource.maxPlucks <= 8);
    assert.ok(summary.resource.maxWorkingSet.serviceHost > 0, "owned lifetime host must be sampled");
    const resourceSamples = (await readFile(path.join(runRoot, "resources.ndjson"), "utf8"))
      .trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.ok(resourceSamples.some(({children}) =>
      children.some(({pid, role}) => role === "sclang" && pid === ready.language.pid) &&
      children.some(({pid, role}) => role === "serviceHost" && pid === ready.serviceHost.pid)));

    const events = await readEvents(runRoot);
    const postStopStats = events.filter(
      (event) =>
        event.source === "service" &&
        event.type === "SOUND_STATS" &&
        event.elapsedSeconds >= postStopBefore.elapsedSeconds,
    );
    assert.ok(postStopStats.length >= 2);
    const postStopAfter = postStopStats.at(-1);
    const postStopAcceptedDelta = {
      acceptedFlocks:
        postStopAfter.body.acceptedFlocks - postStopBefore.body.acceptedFlocks,
      acceptedPlucks:
        postStopAfter.body.acceptedPlucks - postStopBefore.body.acceptedPlucks,
    };
    assert.deepEqual(postStopAcceptedDelta, { acceptedFlocks: 0, acceptedPlucks: 0 });
    const readyEvent = events.find(
      (event) => event.source === "service" && event.type === "SOUND_READY",
    );
    assert.ok(readyEvent);
    const senderStops = events.filter(
      (event) =>
        event.source === "sender" && event.type === "packet" && event.body.kind === "stop",
    );
    assert.ok(senderStops.length >= 1 && senderStops.length <= 3);
    assert.deepEqual(
      senderStops.map((event) => event.body.seq),
      senderStops.map((event) => event.body.seq).toSorted((left, right) => left - right),
    );
    const senderFinished = events.find(
      (event) => event.source === "sender" && event.type === "finished",
    );
    assert.ok(senderFinished.body.attemptWindowMilliseconds <= 300);
    assert.ok(!events.some((event) => event.type === "clockReply"));
    assert.ok(!events.some((event) => event.type === "resourceSampleError"));
    assert.equal(await readFile(path.join(runRoot, "sender.stderr.log"), "utf8"), "");

    const wav = await readFile(ready.capturePath);
    const toFrame = (seconds) => Math.round(seconds * 48000) / 48000;
    const startOffset = startEvent.elapsedSeconds - readyEvent.elapsedSeconds;
    const captureEvidence = events.find((event) => event.type === "SOUND_CAPTURE")?.body;
    const stopCapture = recordedStop(wav, captureEvidence);
    if (omitMixerStop) {
      assert.throws(() => requireRecordedSilence(stopCapture), /recorded post-fade audio is not silent/);
      assert.ok(stopCapture.segments[1].peak > 0.001);
      assert.ok(captureEvidence.allocatedFrames - captureEvidence.recordedFrames > 4800,
        "negative control must retain unused allocation padding");
      const padding = analyzeWav(wav, [{name: "padding",
        start: (captureEvidence.allocatedFrames - 4800) / 48000,
        end: captureEvidence.allocatedFrames / 48000}]);
      assert.equal(padding.segments[0].peak, 0);
    } else {
      requireRecordedSilence(stopCapture);
    }
    const capture = analyzeWav(wav, [
      { name: "pluck", start: toFrame(startOffset + 0.5), end: toFrame(startOffset + 2.75) },
      { name: "wind", start: toFrame(startOffset + 3.4), end: toFrame(startOffset + 5.75) },
      { name: "mixed", start: toFrame(startOffset + 6.4), end: toFrame(startOffset + 8.75) },
      {
        name: "postStop",
        start: stopCapture.segments[1].start,
        end: stopCapture.segments[1].end,
      },
    ]);
    for (const name of ["pluck", "wind", "mixed"]) {
      assert.ok(capture.segments.find((segment) => segment.name === name).peak > 0.001, name);
    }
    if (!omitMixerStop) assert.equal(capture.segments.find((segment) => segment.name === "postStop").peak, 0);
    const pcm16Ceiling = 0.2 + 1 / 32768;
    assert.ok(
      capture.channels.every(
        (channel) => channel.peak <= pcm16Ceiling && channel.clippedSamples === 0,
      ),
    );
    await writeFile(
      path.join(runRoot, "probe-evidence.json"),
      `${JSON.stringify({
        invalidRejected: statsEvent.body.rejected,
        postStopAcceptedAfter: {
          acceptedFlocks: postStopAfter.body.acceptedFlocks,
          acceptedPlucks: postStopAfter.body.acceptedPlucks,
        },
        postStopAcceptedBefore: {
          acceptedFlocks: postStopBefore.body.acceptedFlocks,
          acceptedPlucks: postStopBefore.body.acceptedPlucks,
        },
        postStopAcceptedDelta,
        postStopObservationReason:
          "actual UDP cursor between stopped-policy and final-cleanup statistics",
        stopReason: stopEvent.body.reason,
        postStopPeak: capture.segments.find((segment) => segment.name === "postStop").peak,
        captureEvidence,
        stopCapture,
        omitMixerStop,
        runScript,
        startAcceptedAt: startEvent.elapsedSeconds,
        stopAcceptedAt: stopEvent.elapsedSeconds,
      }, null, 2)}\n`,
    );
    console.log(`INTEGRATION_EVIDENCE ${JSON.stringify({ capture, runRoot, stats: statsEvent.body })}`);
  } finally {
    await terminateOwnedTree(handle);
  }
});
}

test("language interruption reclaims the pinned orphan and permits a fresh launch", async () => {
  const runRoot = freshRunRoot("language-interrupt");
  const handle = startNodeRun(runRoot, 30);
  try {
    await waitForJson(path.join(runRoot, "ready.json"), handle);
    const language = (await waitForJson(path.join(runRoot, "ready.json"), handle)).language;
    const interruptedAt = performance.now();
    await stopPinnedProcess(language);
    await assert.rejects(assertPortsReusable(), /EADDRINUSE/,
      "post-READY interruption must retain the audio process through its DSP lease/fade");
    const result = await waitForCompletion(handle, 20000);
    assert.notEqual(result.exitCode, 0, result.stdout + result.stderr);
    const summary = await waitForJson(path.join(runRoot, "summary.json"), handle);
    assert.equal(summary.reason, "languageExit");
    assert.equal(summary.orphanReclaimed, true);
    const cleanupMilliseconds = performance.now() - interruptedAt;
    assert.ok(cleanupMilliseconds >= 3500 && cleanupMilliseconds < 8000,
      `post-READY interruption cleanup took ${cleanupMilliseconds} ms`);
    await assertPortsReusable();
    const freshRunRoot = await runFreshProof("after-language-interrupt");
    console.log(`LANGUAGE_INTERRUPTION_EVIDENCE ${JSON.stringify({ cleanupMilliseconds, freshRunRoot, language, runRoot })}`);
  } finally {
    await terminateOwnedTree(handle);
  }
});

test("sender interruption lets the DSP lease expire, cleans up, and permits a fresh launch", async () => {
  const runRoot = freshRunRoot("sender-interrupt");
  const handle = startNodeRun(runRoot, 30);
  try {
    await waitForJson(path.join(runRoot, "ready.json"), handle);
    const sender = await pinDirectChild(
      handle.child.pid,
      (candidate) => candidate.commandLine?.includes("--internal-sender"),
    );
    await stopPinnedProcess(sender);
    const result = await waitForCompletion(handle, 20000);
    assert.notEqual(result.exitCode, 0, result.stdout + result.stderr);
    const summary = await waitForJson(path.join(runRoot, "summary.json"), handle);
    assert.equal(summary.reason, "senderExit");
    assert.equal(summary.serviceReason, "heartbeatTimeout");
    await assertPortsReusable();
    const freshRunRoot = await runFreshProof("after-sender-interrupt");
    console.log(`SENDER_INTERRUPTION_EVIDENCE ${JSON.stringify({ freshRunRoot, runRoot, sender })}`);
  } finally {
    await terminateOwnedTree(handle);
  }
});

test("PowerShell start and stop wrappers work from an unrelated cwd with no preloaded state", async () => {
  const runRoot = freshRunRoot("wrappers");
  const start = spawnCaptured(
    "pwsh.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      START_SCRIPT,
      "-RunRoot",
      runRoot,
      "-Duration",
      "30",
    ],
    UNRELATED_CWD,
  );
  try {
    const ready = await waitForJson(path.join(runRoot, "ready.json"), start);
    assert.equal(ready.mode, "silent");
    assert.equal(
      ready.nodeExecutable.toLowerCase(),
      "c:\\users\\hxj\\appdata\\local\\hermes\\node\\node.exe",
    );
    const stop = spawnCaptured(
      "pwsh.exe",
      ["-NoProfile", "-NonInteractive", "-File", STOP_SCRIPT, "-RunRoot", runRoot],
      UNRELATED_CWD,
    );
    const stopResult = await waitForCompletion(stop, 5000);
    assert.equal(stopResult.exitCode, 0, stopResult.stdout + stopResult.stderr);
    const startResult = await waitForCompletion(start, 20000);
    assert.equal(startResult.exitCode, 0, startResult.stdout + startResult.stderr);
    const summary = await waitForJson(path.join(runRoot, "summary.json"), start);
    assert.equal(summary.reason, "requested");
    await assertPortsReusable();
    console.log(`WRAPPER_EVIDENCE ${JSON.stringify({ nodeExecutable: ready.nodeExecutable, runRoot })}`);
  } finally {
    await terminateOwnedTree(start);
  }
});
