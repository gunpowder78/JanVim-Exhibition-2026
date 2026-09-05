import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import dgram from "node:dgram";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { clearTimeout, setTimeout } from "node:timers";
import { randomUUID } from "node:crypto";

const REHEARSAL_PARENT = "D:/VirtualData/JanVim-Exhibition-Rehearsals";

const runProcess = (executable, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill(), options.timeoutMs ?? 15000);
    child.stdout.on("data", (chunk) => {
      stdout = (stdout + chunk).slice(-16384);
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-16384);
    });
    child.once("error", reject);
    child.once("close", (exitCode, signal) => {
      clearTimeout(timeout);
      resolve({ exitCode, signal, stderr, stdout });
    });
  });

test("CLI defaults to a 45-second silent run", async () => {
  const { parseCli } = await import("../run.mjs");

  assert.deepEqual(parseCli([]), {
    command: "run",
    duration: 45,
    mode: "silent",
    output: null,
  });
});

test("CLI accepts only the bounded run and stop forms", async () => {
  const { parseCli } = await import("../run.mjs");
  const output = path.join(REHEARSAL_PARENT, `sound-cli-${randomUUID()}`);

  assert.deepEqual(
    parseCli(["--mode", "listen", "--duration", "3600", "--output", output]),
    { command: "run", duration: 3600, mode: "listen", output },
  );
  assert.deepEqual(parseCli(["--stop", output]), { command: "stop", runRoot: output });

  for (const argv of [
    ["--mode", "loud"],
    ["--duration", "0"],
    ["--duration", "3600.1"],
    ["--duration", "1e2"],
    ["--duration", "NaN"],
    ["--output", "relative"],
    ["--unknown", "value"],
    ["--stop", output, "--mode", "silent"],
  ]) {
    assert.throws(() => parseCli(argv), /invalid/i, argv.join(" "));
  }
});

test("run roots are fresh direct children of the external rehearsal parent", async (t) => {
  const { prepareRunRoot } = await import("../run.mjs");
  await mkdir(REHEARSAL_PARENT, { recursive: true });
  const explicit = path.join(REHEARSAL_PARENT, `sound-explicit-${randomUUID()}`);
  const outside = path.join(path.dirname(REHEARSAL_PARENT), `sound-outside-${randomUUID()}`);
  const created = [];
  t.after(async () => {
    for (const directory of created) await rm(directory, { recursive: true, force: true });
  });

  const defaultRoot = await prepareRunRoot(null);
  created.push(defaultRoot);
  assert.equal(path.dirname(defaultRoot), path.normalize(REHEARSAL_PARENT));
  assert.match(path.basename(defaultRoot), /^sound-\d{8}T\d{9}Z-[0-9a-f]{12}$/);

  assert.equal(await prepareRunRoot(explicit), path.normalize(explicit));
  created.push(explicit);
  await assert.rejects(() => prepareRunRoot(explicit), /fresh|exists/i);
  await assert.rejects(() => prepareRunRoot(outside), /external rehearsal parent/i);
});

test("fake-clock timeline skips missed cues instead of bursting after a stall", async () => {
  const { createTimeline } = await import("../run.mjs");
  const timeline = createTimeline(9);

  assert.deepEqual(timeline.due(0.25), [
    { kind: "heartbeat" },
    { kind: "cursor", motion: 0.6, x: 0.37, y: 0.7 },
  ]);
  assert.deepEqual(timeline.due(0.25), []);
  assert.deepEqual(timeline.due(3.25), [
    { kind: "heartbeat" },
    { centroid: 0.61, energy: 0.16, kind: "flock" },
  ]);
  assert.deepEqual(timeline.due(6.25), [
    { kind: "heartbeat" },
    { kind: "cursor", motion: 0.49, x: 0.16, y: 0.29 },
    { centroid: 0.72, energy: 0.75, kind: "flock" },
  ]);
  assert.deepEqual(timeline.due(9), []);
});

test("control listener rejects a wrong token and closes after the exact stop", async (t) => {
  const { prepareRunRoot, requestStop, sendControlRequest, startControlServer } =
    await import("../run.mjs");
  const runRoot = await prepareRunRoot(null);
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  let stops = 0;
  const control = await startControlServer(runRoot, () => {
    stops += 1;
  });
  t.after(() => control.close());

  assert.equal(
    await sendControlRequest({ ...control.receipt, token: "0".repeat(64) }),
    false,
  );
  assert.equal(stops, 0);
  assert.equal(await requestStop(runRoot), true);
  assert.equal(stops, 1);
  await assert.rejects(() => sendControlRequest(control.receipt), /connect|closed|refused/i);
});

test("managed child launch failure rejects promptly and leaves bounded logs", async (t) => {
  const { prepareRunRoot, spawnManagedChild } = await import("../run.mjs");
  const runRoot = await prepareRunRoot(null);
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  const stdoutPath = path.join(runRoot, "missing.stdout.log");
  const stderrPath = path.join(runRoot, "missing.stderr.log");

  await assert.rejects(
    () =>
      spawnManagedChild({
        args: [],
        cwd: runRoot,
        executable: path.join(runRoot, "does-not-exist.exe"),
        stderrPath,
        stdoutPath,
        timeoutMs: 1000,
      }),
    /ENOENT|spawn/i,
  );
  assert.equal((await stat(stdoutPath)).size, 0);
  assert.equal((await stat(stderrPath)).size, 0);
});

test("managed child enforces line, stream, and log byte limits", async (t) => {
  const { prepareRunRoot, spawnManagedChild } = await import("../run.mjs");
  const runRoot = await prepareRunRoot(null);
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  const stdoutPath = path.join(runRoot, "bounded.stdout.log");
  const stderrPath = path.join(runRoot, "bounded.stderr.log");
  const managed = await spawnManagedChild({
    args: ["-e", 'process.stdout.write("x".repeat(1024)); setInterval(() => {}, 1000)'],
    cwd: runRoot,
    executable: process.execPath,
    maxLineBytes: 64,
    maxLogBytes: 80,
    maxStreamBytes: 128,
    stderrPath,
    stdoutPath,
    timeoutMs: 2000,
  });

  const result = await managed.completion;
  assert.equal(result.limitReason, "stdoutLine");
  assert.ok(result.stdoutBytes <= 1024);
  assert.equal((await stat(stdoutPath)).size, 80);
  assert.equal((await readFile(stderrPath)).length, 0);
});

test("occupied language port fails without terminating its occupant", async (t) => {
  const runRoot = path.join(REHEARSAL_PARENT, `sound-port-${randomUUID()}`);
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  const occupant = dgram.createSocket({ type: "udp4", reuseAddr: false });
  t.after(() => occupant.close());
  await new Promise((resolve, reject) => {
    occupant.once("error", reject);
    occupant.bind({ address: "127.0.0.1", exclusive: true, port: 57140 }, resolve);
  });

  const result = await runProcess(
    process.execPath,
    [
      path.resolve("sound/run.mjs"),
      "--mode",
      "silent",
      "--duration",
      "1",
      "--output",
      runRoot,
    ],
    { cwd: path.resolve("."), timeoutMs: 12000 },
  );

  assert.notEqual(result.exitCode, 0, result.stdout + result.stderr);
  assert.equal(occupant.address().port, 57140);
  const summary = JSON.parse(await readFile(path.join(runRoot, "summary.json"), "utf8"));
  assert.equal(summary.clean, false);
  assert.match(summary.reason, /language|service|startup/i);
});
