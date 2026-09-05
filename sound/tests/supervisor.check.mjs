import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import dgram from "node:dgram";
import net from "node:net";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import test from "node:test";
import { clearTimeout, setTimeout } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const REHEARSAL_PARENT = "D:/VirtualData/JanVim-Exhibition-Rehearsals";

test("PowerShell launcher forwards explicit flock ingress and rejects simulated or duplicate flags", async t => {
  const { prepareRunRoot } = await import("../run.mjs");
  const root = await prepareRunRoot(null);
  t.after(() => rm(root, { recursive: true, force: true }));
  await copyFile(path.resolve("sound/start-sound.ps1"), path.join(root, "start-sound.ps1"));
  await writeFile(path.join(root, "run.mjs"), 'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
  const launch = args => runProcess("pwsh.exe",
    ["-NoProfile", "-NonInteractive", "-File", path.join(root, "start-sound.ps1"), ...args], { timeoutMs: 5000 });
  const enabled = await launch(["-Input", "RealCursor", "-FlockIngress"]);
  assert.equal(enabled.exitCode, 0, enabled.stderr);
  assert.deepEqual(JSON.parse(enabled.stdout), ["--mode", "silent", "--duration", "45", "--input", "real-cursor", "--flock-input", "enabled"]);
  for (const args of [["-FlockIngress"], ["-Input", "RealCursor", "-FlockIngress", "-FlockIngress"]]) {
    const result = await launch(args);
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.stdout, "");
  }
});

const runProcess = (executable, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs ?? 15000);
    child.stdout.on("data", (chunk) => {
      stdout = (stdout + chunk).slice(-16384);
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-16384);
    });
    child.once("error", reject);
    child.once("close", (exitCode, signal) => {
      clearTimeout(timeout);
      resolve({ exitCode, signal, stderr, stdout, timedOut });
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

test("real cursor CLI is opt-in and explicit simulation preserves the old return shape", async () => {
  const { parseCli } = await import("../run.mjs");
  assert.deepEqual(parseCli(["--input", "real-cursor"]), {
    command: "run", duration: 45, mode: "silent", output: null, input: "real-cursor",
  });
  assert.deepEqual(parseCli(["--input", "simulated"]), parseCli([]));
  for (const args of [["--input"], ["--input", "real"],
    ["--input", "real-cursor", "--input", "simulated"]]) {
    assert.throws(() => parseCli(args), /invalid/i);
  }
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

test("delayed stop clocks and no acknowledgment cannot outlive the 300 ms send deadline", async (t) => {
  const receiver = dgram.createSocket({ type: "udp4", reuseAddr: false });
  await new Promise((resolve, reject) => {
    receiver.once("error", reject);
    receiver.bind({ address: "127.0.0.1", exclusive: true, port: 57140 }, resolve);
  });
  t.after(() => receiver.close());

  const child = spawn(process.execPath, [path.resolve("sound/run.mjs"), "--internal-sender"], {
    cwd: path.resolve("."),
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  });

  const datagrams = [];
  const stopReports = [];
  let stopping = false;
  let stopClockRequests = 0;
  let stopStarted;
  const finished = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("sender did not finish")), 2500);
    child.once("error", reject);
    child.on("message", (message) => {
      if (message.type === "clock") {
        const wait = stopping ? (stopClockRequests++ === 0 ? 150 : 350) : 0;
        setTimeout(() => {
          if (child.connected) {
            child.send({ requestId: message.requestId, type: "clock", value: 1 });
          }
        }, wait);
      } else if (message.type === "packet" && message.kind === "stop") {
        stopReports.push(message);
      } else if (message.type === "finished") {
        clearTimeout(timeout);
        resolve({ message, receivedAt: performance.now() });
      }
    });
  });
  receiver.on("message", (packet) => {
    datagrams.push({ packet, receivedAt: performance.now() });
    if (datagrams.length === 1) {
      child.send({ type: "ackStart" });
      stopping = true;
      stopStarted = performance.now();
      child.send({ type: "stop" });
    }
  });
  child.send({ duration: 30, session: "0123456789abcdef0123456789abcdef", type: "initialize" });

  const result = await finished;
  assert.ok(result.message.attemptWindowMilliseconds <= 300, result.message);
  assert.ok(result.receivedAt - stopStarted < 450, result);
  assert.equal(stopReports.length, 1);
  const datagramsAtFinish = datagrams.length;
  await delay(450);
  assert.equal(datagrams.length, datagramsAtFinish, "a delayed clock reply sent a late packet");
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

  assert.deepEqual(Object.keys(control.receipt).sort(),
    ["active", "host", "port", "runRoot", "token", "version"]);

  assert.equal(
    await sendControlRequest({ ...control.receipt, token: "0".repeat(64) }),
    false,
  );
  assert.equal(stops, 0);
  assert.equal(await requestStop(runRoot), true);
  assert.equal(stops, 1);
  await assert.rejects(() => sendControlRequest(control.receipt), /connect|closed|refused/i);
});

test("real sender pulls one clock/features reply at a time, drops stale IPC, and never runs simulation", async (t) => {
  const receiver = dgram.createSocket({ type: "udp4", reuseAddr: false });
  await new Promise((resolve, reject) => {
    receiver.once("error", reject);
    receiver.bind({ address: "127.0.0.1", exclusive: true, port: 57140 }, resolve);
  });
  t.after(() => receiver.close());
  const child = spawn(process.execPath, [path.resolve("sound/run.mjs"), "--internal-sender"], {
    stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true,
  });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); });
  const packets = [];
  receiver.on("message", packet => {
    const name = packet.toString("ascii", 0, packet.indexOf(0)).split("/").at(-1);
    packets.push({ name, at: performance.now(),
      ...(name === "cursor" ? { x: packet.readFloatBE(packet.length - 12) } : {}) });
    if (name === "start") child.send({ type: "ackStart" });
    if (name === "stop") child.send({ type: "ackStop" });
  });
  let pulls = 0;
  let pending = false;
  let overlap = false;
  const finished = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("real sender did not finish")), 4500);
    child.on("message", message => {
      if (message.type === "finished") { clearTimeout(timer); resolve(); }
      if (message.type !== "clock") return;
      if (pending) overlap = true;
      pending = true;
      const now = performance.timeOrigin + performance.now();
      let events = [];
      if (message.takeRealInput) {
        pulls += 1;
        if (pulls >= 2) events = [{ kind: "cursor", x: pulls === 2 ? 0.125 : 0.75,
          y: 0.4, motion: 0.8, expiresAtMs: now + 500 }];
      }
      setTimeout(() => {
        pending = false;
        if (child.connected) child.send({ type: "clock", requestId: message.requestId,
          value: 1, sampledAtMs: now, events });
      }, message.takeRealInput && pulls === 2 ? 600 : 0);
    });
  });
  child.send({ duration: 1.4, input: "real-cursor", session: "0123456789abcdef0123456789abcdef", type: "initialize" });
  await finished;
  assert.ok(pulls >= 3, "sender must request actual input instead of running its timeline");
  assert.equal(overlap, false, "IPC requests accumulated while a reply was delayed");
  assert.equal(packets.some(p => p.name === "flock"), false);
  const cursors = packets.filter(p => p.name === "cursor");
  assert.ok(cursors.length > 0);
  assert.ok(cursors.every(packet => packet.x === 0.75), "the delayed sample was sent with a renewed age");
  assert.ok(cursors[0].at - packets[0].at >= 600, "expired reply was admitted");
  for (let index = 1; index < cursors.length; index += 1) {
    assert.ok(cursors[index].at - cursors[index - 1].at >= 120, "sender exceeded eight Hz");
  }
});

async function openControlStream(t, receipt) {
  const socket = net.createConnection({ host: receipt.host, port: receipt.port });
  t.after(() => socket.destroy());
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => socket.destroy(new Error("control connection timed out")), 1500);
    socket.once("connect", () => { clearTimeout(timer); resolve(); });
    socket.once("error", error => { clearTimeout(timer); reject(error); });
  });
  return socket;
}

function controlReply(socket, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("missing control reply")), 1500);
    socket.once("data", chunk => {
      clearTimeout(timer);
      resolve(chunk.toString());
    });
    socket.write(typeof message === "string" ? message : `${JSON.stringify(message)}\n`);
  });
}

test("real control stream authenticates before policy, bounds frames, retains one owner, and preserves manual Stop", async (t) => {
  const { prepareRunRoot, sendControlRequest, startControlServer } = await import("../run.mjs");
  const { createRealInput } = await import("../real-input.mjs");
  const runRoot = await prepareRunRoot(null);
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  let ms = 0;
  const stopped = [];
  const policy = createRealInput({ nowMs: () => ms, onStop: r => stopped.push(r) });
  const seen = [];
  const realInput = {
    attach: identity => { seen.push(identity); return policy.attach(identity); },
    accept: frame => { seen.push(frame); return policy.accept(frame); },
    close: reason => policy.close(reason),
  };
  let manualStops = 0;
  const control = await startControlServer(runRoot, () => { manualStops += 1; }, { realInput });
  t.after(() => control.close());
  assert.equal(control.receipt.input, "real-cursor");
  const attach = { command: "attach", token: control.receipt.token, runId: "show-1", controllerRunId: "ctl-1" };
  const bad = await openControlStream(t, control.receipt);
  assert.equal(await controlReply(bad, { ...attach, token: "0".repeat(64) }), '{"ok":false}\n');
  assert.deepEqual(seen, []);
  const owner = await openControlStream(t, control.receipt);
  const encoded = JSON.stringify(attach);
  owner.write(encoded.slice(0, 10));
  assert.equal(await controlReply(owner, `${encoded.slice(10)}\n`), '{"ok":true,"input":"real-cursor"}\n');
  const other = await openControlStream(t, control.receipt);
  assert.equal(await controlReply(other, attach), '{"ok":false}\n');
  assert.equal(await sendControlRequest({ ...control.receipt, token: "0".repeat(64) }), false);
  assert.deepEqual(stopped, []);
  const base = { ...attach, command: "heartbeat", seq: 1, elapsedMs: 0, generationId: 1, loopId: "loop-1" };
  const note = { ...base, command: "cursor", seq: 2, x: 0.2, y: 0.4, motion: 0.8 };
  owner.write(`${JSON.stringify(base)}\n${JSON.stringify(note)}\n`);
  await delay(30);
  assert.equal(policy.take().filter(e => e.kind === "cursor").length, 1);
  assert.ok(seen.every(frame => !Object.hasOwn(frame, "token")));
  await delay(1100); // attached streams outlive the legacy one-shot timeout
  ms = 1150;
  owner.write(`${JSON.stringify({ ...base, seq: 3, elapsedMs: 1150 })}\n`);
  await delay(30);
  assert.equal(owner.destroyed, false);
  assert.equal(policy.take().filter(e => e.kind === "heartbeat").length, 1);
  for (const payload of ["x".repeat(1025), JSON.stringify({ ...attach, text: "private" }) + "\n"]) {
    const probe = await openControlStream(t, control.receipt);
    assert.equal(await controlReply(probe, payload), '{"ok":false}\n');
  }
  assert.equal(await sendControlRequest(control.receipt), true);
  assert.equal(manualStops, 1);
  await control.close();
  assert.equal(JSON.parse(await readFile(path.join(runRoot, "control.json"), "utf8")).active, false);
  assert.deepEqual(policy.take(), []);
});

test("owner disconnect closes real input permanently; rejected frames cannot extend the lease", async (t) => {
  const { prepareRunRoot, startControlServer } = await import("../run.mjs");
  const { createRealInput } = await import("../real-input.mjs");
  for (const disconnect of [true, false]) {
    const runRoot = await prepareRunRoot(null);
    t.after(() => rm(runRoot, { recursive: true, force: true }));
    const stopped = [];
    const origin = performance.now();
    const input = createRealInput({ nowMs: () => performance.now() - origin, onStop: r => stopped.push(r) });
    const control = await startControlServer(runRoot, () => {}, { realInput: input });
    t.after(() => control.close());
    const owner = await openControlStream(t, control.receipt);
    const attach = { command: "attach", token: control.receipt.token, runId: "show-1", controllerRunId: "ctl-1" };
    assert.equal(await controlReply(owner, attach), '{"ok":true,"input":"real-cursor"}\n');
    if (disconnect) owner.destroy();
    else {
      await delay(1200);
      owner.write(`${JSON.stringify({ ...attach, command: "heartbeat", seq: 1 })}\n`);
    }
    await delay(disconnect ? 50 : 1000);
    assert.deepEqual(stopped, [disconnect ? "source-disconnect" : "producer-timeout"]);
    const second = await openControlStream(t, control.receipt);
    assert.equal(await controlReply(second, attach), '{"ok":false}\n');
    await control.close();
  }
});

test("initial control receipt failure closes the locally acquired listener", async (t) => {
  const { prepareRunRoot } = await import("../run.mjs");
  const runRoot = await prepareRunRoot(null);
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  await mkdir(path.join(runRoot, "control.json"));
  const moduleUrl = pathToFileURL(path.resolve("sound/run.mjs")).href;
  const script = `
    const { startControlServer } = await import(${JSON.stringify(moduleUrl)});
    try {
      await startControlServer(${JSON.stringify(runRoot)}, () => {});
      process.exitCode = 2;
    } catch {
      process.stdout.write("INITIAL_RECEIPT_FAILURE_HANDLED\\n");
    }
  `;

  const result = await runProcess(process.execPath, ["--input-type=module", "-e", script], {
    cwd: path.resolve("."),
    timeoutMs: 1000,
  });

  assert.equal(result.timedOut, false, result);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "INITIAL_RECEIPT_FAILURE_HANDLED\n");
});

test("accepted-stop receipt failure is tracked without escaping control cleanup", async (t) => {
  const { prepareRunRoot, sendControlRequest, startControlServer } =
    await import("../run.mjs");
  const runRoot = await prepareRunRoot(null);
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  let stops = 0;
  const control = await startControlServer(runRoot, () => {
    stops += 1;
  });
  t.after(() => control.close());
  const receiptPath = path.join(runRoot, "control.json");
  await rm(receiptPath);
  await mkdir(receiptPath);

  assert.equal(await sendControlRequest(control.receipt), true);
  await control.close();
  assert.equal(stops, 1);
  assert.ok(control.persistenceError instanceof Error);
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
