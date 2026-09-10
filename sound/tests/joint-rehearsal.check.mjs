import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { clearTimeout, setTimeout } from "node:timers";

const REPOSITORY_ROOT = path.resolve(".");
const PRODUCTION_SCRIPT = path.join(REPOSITORY_ROOT, "sound", "joint-rehearsal.ps1");
const REHEARSAL_PARENT = path.resolve("D:/VirtualData/JanVim-Exhibition-Rehearsals");
const MAX_OUTPUT_BYTES = 32 * 1024;

const startSoundFixture = String.raw`[CmdletBinding()]
param(
    [switch] $Listen,
    [double] $Duration,
    [string] $RunRoot,
    [Alias('Input')][string] $SoundInput,
    [switch] $FlockIngress,
    [ValidateSet('LegacyPluckV1', 'StoneAndSignalV2')][string] $InstrumentProfile = 'LegacyPluckV1',
    [string] $NodeExecutable
)
$record = [ordered]@{
    launcher = 'start-sound'
    listen = [bool]$Listen
    duration = $Duration
    runRoot = $RunRoot
    input = $SoundInput
    flockIngress = [bool]$FlockIngress
}
if (-not [string]::IsNullOrWhiteSpace($NodeExecutable)) { $record.nodeExecutable = $NodeExecutable }
if ($InstrumentProfile -ne 'LegacyPluckV1') { $record.instrumentProfile = $InstrumentProfile }
[IO.File]::AppendAllText($env:JOINT_CAPTURE, (($record | ConvertTo-Json -Compress) + [Environment]::NewLine))
if ($env:JOINT_SOUND_EXIT) { exit [int]$env:JOINT_SOUND_EXIT }
exit 0
`;

const stopSoundFixture = String.raw`[CmdletBinding()]
param([Parameter(Mandatory)][string] $RunRoot, [string] $NodeExecutable)
$record = [ordered]@{ launcher = 'stop-sound'; runRoot = $RunRoot }
if (-not [string]::IsNullOrWhiteSpace($NodeExecutable)) { $record.nodeExecutable = $NodeExecutable }
[IO.File]::AppendAllText($env:JOINT_CAPTURE, (($record | ConvertTo-Json -Compress) + [Environment]::NewLine))
Write-Output 'STOP_REQUESTED'
if ($env:JOINT_STOP_EXIT) { exit [int]$env:JOINT_STOP_EXIT }
exit 0
`;

const startShowFixture = String.raw`[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('ValidateOnly', 'Soak3', 'Show')][string] $Mode,
    [Parameter(Mandatory)][string] $RehearsalRoot,
    [Parameter(Mandatory)][string] $DisplayMapPath,
    [Parameter(Mandatory)][string] $RunId,
    [Parameter(Mandatory)][ValidateSet('OfflineRequired', 'DiagnosticConnected')][string] $NetworkPolicy,
    [ValidateSet('Operator', 'Automatic')][string] $StartPolicy = 'Operator',
    [string] $SoundRunRoot,
    [string] $NodeExecutable
)
$record = [ordered]@{
    launcher = 'start-show'
    mode = $Mode
    rehearsalRoot = $RehearsalRoot
    displayMapPath = $DisplayMapPath
    runId = $RunId
    networkPolicy = $NetworkPolicy
    startPolicy = $StartPolicy
    soundRunRoot = $SoundRunRoot
}
if (-not [string]::IsNullOrWhiteSpace($NodeExecutable)) { $record.nodeExecutable = $NodeExecutable }
[IO.File]::AppendAllText($env:JOINT_CAPTURE, (($record | ConvertTo-Json -Compress) + [Environment]::NewLine))
if ($Mode -eq 'ValidateOnly' -and $env:JOINT_VALIDATE_EXIT) { exit [int]$env:JOINT_VALIDATE_EXIT }
exit 0
`;

async function runProcess(executable, args, { cwd, env = {}, timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let exceeded = false;
    let timedOut = false;
    const append = (current, chunk) => {
      const next = Buffer.concat([current, chunk]);
      if (next.length > MAX_OUTPUT_BYTES) {
        exceeded = true;
        child.kill();
        return next.subarray(0, MAX_OUTPUT_BYTES);
      }
      return next;
    };
    child.stdout.on("data", chunk => { stdout = append(stdout, chunk); });
    child.stderr.on("data", chunk => { stderr = append(stderr, chunk); });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.once("error", reject);
    child.once("close", (exitCode, signal) => {
      clearTimeout(timeout);
      resolve({
        exceeded,
        exitCode,
        signal,
        stderr: stderr.toString("utf8"),
        stdout: stdout.toString("utf8"),
        timedOut,
      });
    });
  });
}

async function makeFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "janvim-joint-check-"));
  const sound = path.join(root, "sound");
  const scripts = path.join(root, "scripts");
  const capture = path.join(root, "launcher-calls.ndjson");
  await mkdir(sound);
  await mkdir(scripts);
  try {
    await copyFile(PRODUCTION_SCRIPT, path.join(sound, "joint-rehearsal.ps1"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(path.join(sound, "joint-rehearsal.ps1"), "# Missing behavior under TDD.\n");
  }
  await copyFile(
    path.join(REPOSITORY_ROOT, "sound", "node-runtime.ps1"),
    path.join(sound, "node-runtime.ps1"),
  );
  await writeFile(path.join(sound, "start-sound.ps1"), startSoundFixture);
  await writeFile(path.join(sound, "stop-sound.ps1"), stopSoundFixture);
  await writeFile(path.join(scripts, "start-show.ps1"), startShowFixture);
  t.after(() => rm(root, { recursive: true, force: true }));
  return {
    capture,
    root,
    script: path.join(sound, "joint-rehearsal.ps1"),
    run: (args, options = {}) => runProcess(
      "pwsh.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", path.join(sound, "joint-rehearsal.ps1"), ...args],
      { cwd: options.cwd ?? root, env: { JOINT_CAPTURE: capture, ...options.env } },
    ),
  };
}

function valueFromOutput(output, label) {
  const match = new RegExp(`^${label} (.+)$`, "mu").exec(output);
  assert.ok(match, `Prepare should publish explicit ${label}`);
  return match[1].trim();
}

function derivedPaths(sessionFile, sessionId) {
  return {
    sessionFile,
    sessionRoot: path.join(REHEARSAL_PARENT, `joint-session-${sessionId}`),
    showRoot: path.join(REHEARSAL_PARENT, `joint-show-${sessionId}`),
    soundRoot: path.join(REHEARSAL_PARENT, `joint-sound-${sessionId}`),
    validateRoot: path.join(REHEARSAL_PARENT, `joint-validate-${sessionId}`),
  };
}

function assertOwnedTestRoot(candidate) {
  assert.equal(path.dirname(candidate).toLowerCase(), REHEARSAL_PARENT.toLowerCase());
  assert.match(path.basename(candidate), /^joint-(?:session|show|sound|validate)-/);
}

async function removePrepared(prepared) {
  for (const candidate of [prepared.sessionRoot, prepared.showRoot, prepared.soundRoot, prepared.validateRoot]) {
    assertOwnedTestRoot(candidate);
    await rm(candidate, { recursive: true, force: true });
  }
}

async function prepareSession(t, fixture, { duration, mapBytes } = {}) {
  const displayMap = path.join(fixture.root, `synthetic-display-${randomUUID()}.json`);
  const bytes = mapBytes ?? Buffer.from('{"synthetic":"display-map"}\r\n', "utf8");
  await writeFile(displayMap, bytes);
  const args = ["-Action", "Prepare", "-DisplayMapPath", displayMap];
  if (duration !== undefined) args.push("-Duration", String(duration));
  const result = await fixture.run(args);
  assert.equal(result.timedOut, false, "Prepare must finish inside the child timeout");
  assert.equal(result.exceeded, false, "Prepare output must remain bounded");
  assert.equal(result.exitCode, 0, `Prepare should create a fresh operator session: ${result.stderr}`);
  const sessionFile = valueFromOutput(result.stdout, "SESSION_FILE");
  const session = JSON.parse(await readFile(sessionFile, "utf8"));
  const prepared = { ...derivedPaths(sessionFile, session.sessionId), session, mapBytes: bytes };
  t.after(() => removePrepared(prepared));
  return prepared;
}

async function captureRecords(fixture) {
  try {
    return (await readFile(fixture.capture, "utf8"))
      .split(/\r?\n/u)
      .filter(Boolean)
      .map(line => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeReady(prepared, { summary = false } = {}) {
  await mkdir(prepared.soundRoot);
  const soundSession = "0123456789abcdef0123456789abcdef";
  await writeFile(path.join(prepared.soundRoot, "ready.json"), JSON.stringify({
    version: 1,
    runRoot: prepared.soundRoot,
    duration: prepared.session.duration,
    mode: "silent",
    nodePid: process.pid,
    nodeExecutable: process.execPath,
    session: soundSession,
    service: { hardwareOutput: false, session: soundSession },
    privateFixtureToken: "ready-secret-must-not-print",
  }));
  await writeFile(path.join(prepared.soundRoot, "control.json"), JSON.stringify({
    version: 1,
    active: !summary,
    host: "127.0.0.1",
    port: 57199,
    runRoot: prepared.soundRoot,
    input: "real-cursor",
    token: "a".repeat(64),
  }));
  await writeFile(path.join(prepared.soundRoot, "flock-input.json"), JSON.stringify({
    version: 1,
    active: !summary,
    host: "127.0.0.1",
    port: 57200,
    protocol: "jianshan-flock-ndjson-v1",
    token: "b".repeat(64),
  }));
  if (summary) {
    await writeFile(path.join(prepared.soundRoot, "summary.json"), JSON.stringify({
      version: 1,
      runRoot: prepared.soundRoot,
      clean: true,
      reason: "requestedStop",
      credentialFixture: "summary-secret-must-not-print",
    }));
  }
}

test("Prepare creates unique external roots, copies map bytes, and leaves planned sound roots fresh", async t => {
  const fixture = await makeFixture(t);
  const first = await prepareSession(t, fixture);
  assert.deepEqual(Object.keys(first.session).sort(), ["duration", "sessionId", "version"]);
  assert.equal(first.session.version, 1);
  assert.equal(first.session.duration, 600);
  assert.equal(path.resolve(first.sessionFile), path.join(first.sessionRoot, "session.json"));
  assert.deepEqual(await readFile(path.join(first.showRoot, "display-map.json")), first.mapBytes);
  assert.deepEqual(await readFile(path.join(first.validateRoot, "display-map.json")), first.mapBytes);
  await assert.rejects(access(first.soundRoot), { code: "ENOENT" });

  const marker = path.join(first.showRoot, "preserve-me.txt");
  await writeFile(marker, "old-root-is-immutable");
  const second = await prepareSession(t, fixture, { duration: 321 });
  assert.notEqual(second.session.sessionId, first.session.sessionId);
  assert.equal(await readFile(marker, "utf8"), "old-root-is-immutable");
  assert.equal(second.session.duration, 321);
});

test("continuous session preserves zero duration through Prepare, Sound and READY validation", async t => {
  const fixture = await makeFixture(t);
  const selected = await prepareSession(t, fixture, { duration: 0 });
  assert.equal(selected.session.duration, 0);
  const sound = await fixture.run(["-Action", "Sound", "-SessionFile", selected.sessionFile]);
  assert.equal(sound.exitCode, 0, sound.stderr);
  assert.equal((await captureRecords(fixture))[0].duration, 0);
  await writeReady(selected);
  const show = await fixture.run(["-Action", "Show", "-SessionFile", selected.sessionFile]);
  assert.equal(show.exitCode, 0, show.stderr);
});

test("Sound uses the selected session rather than newest state, stays silent by default, and forwards explicit Listen", async t => {
  const fixture = await makeFixture(t);
  const selected = await prepareSession(t, fixture, { duration: 73 });
  await prepareSession(t, fixture, { duration: 99 });

  const silent = await fixture.run(["-Action", "Sound", "-SessionFile", selected.sessionFile]);
  assert.equal(silent.exitCode, 0, `Sound should delegate successfully: ${silent.stderr}`);
  const listening = await fixture.run(["-Action", "Sound", "-SessionFile", selected.sessionFile, "-Listen"]);
  assert.equal(listening.exitCode, 0, `explicit Listen should delegate successfully: ${listening.stderr}`);
  const candidate = await fixture.run(["-Action", "Sound", "-SessionFile", selected.sessionFile,
    "-Listen", "-InstrumentProfile", "StoneAndSignalV2"]);
  assert.equal(candidate.exitCode, 0, `candidate profile should delegate successfully: ${candidate.stderr}`);
  const caseVariant = await fixture.run(["-Action", "Sound", "-SessionFile", selected.sessionFile,
    "-Listen", "-InstrumentProfile", "stoneandsignalv2"]);
  assert.equal(caseVariant.exitCode, 0, "ValidateSet's accepted casing must preserve the selected candidate");

  assert.deepEqual(await captureRecords(fixture), [
    { launcher: "start-sound", listen: false, duration: 73, runRoot: selected.soundRoot, input: "RealCursor", flockIngress: true },
    { launcher: "start-sound", listen: true, duration: 73, runRoot: selected.soundRoot, input: "RealCursor", flockIngress: true },
    { launcher: "start-sound", listen: true, duration: 73, runRoot: selected.soundRoot, input: "RealCursor", flockIngress: true,
      instrumentProfile: "StoneAndSignalV2" },
    { launcher: "start-sound", listen: true, duration: 73, runRoot: selected.soundRoot, input: "RealCursor", flockIngress: true,
      instrumentProfile: "StoneAndSignalV2" },
  ]);
});

test("actions are independent of cwd and reject missing, malformed, oversized, escaped, or credential-bearing sessions", async t => {
  const fixture = await makeFixture(t);
  const selected = await prepareSession(t, fixture);
  const foreignCwd = await mkdtemp(path.join(os.tmpdir(), "janvim-joint-cwd-"));
  t.after(() => rm(foreignCwd, { recursive: true, force: true }));
  const cwdResult = await fixture.run(["-Action", "Status", "-SessionFile", selected.sessionFile], { cwd: foreignCwd });
  assert.equal(cwdResult.exitCode, 0, `Status should resolve repository launchers independently of cwd: ${cwdResult.stderr}`);
  assert.match(cwdResult.stdout, /SOUND_STATUS NOT_STARTED/u);

  const id = `20260906T120000000Z-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const sessionRoot = path.join(REHEARSAL_PARENT, `joint-session-${id}`);
  const sessionFile = path.join(sessionRoot, "session.json");
  await mkdir(sessionRoot, { recursive: false });
  t.after(() => rm(sessionRoot, { recursive: true, force: true }));
  const cases = [
    { name: "missing", path: sessionFile, pattern: /session.*missing/i },
    { name: "malformed", content: "{not-json", pattern: /session.*invalid/i },
    { name: "oversized", content: "x".repeat(4097), pattern: /session.*size/i },
    {
      name: "credential-bearing",
      content: JSON.stringify({ version: 1, sessionId: id, duration: 600, token: "session-secret-must-not-print" }),
      pattern: /session.*schema/i,
      secret: "session-secret-must-not-print",
    },
  ];
  for (const item of cases) {
    if (item.content !== undefined) await writeFile(sessionFile, item.content);
    const result = await fixture.run(["-Action", "Status", "-SessionFile", item.path ?? sessionFile]);
    assert.notEqual(result.exitCode, 0, `${item.name} session must be rejected`);
    assert.match(result.stderr, item.pattern, `${item.name} failure should identify the missing behavior`);
    if (item.secret) assert.equal(`${result.stdout}${result.stderr}`.includes(item.secret), false);
  }

  const escaped = path.join(fixture.root, "escaped-session.json");
  await writeFile(escaped, JSON.stringify({ version: 1, sessionId: id, duration: 600 }));
  const escapedResult = await fixture.run(["-Action", "Status", "-SessionFile", escaped]);
  assert.notEqual(escapedResult.exitCode, 0, "session paths outside the rehearsal parent must be rejected");
  assert.match(escapedResult.stderr, /session.*path/i);
});

test("Prepare rejects missing and oversized display-map inputs before creating a session", async t => {
  const fixture = await makeFixture(t);
  const missing = path.join(fixture.root, "missing-display-map.json");
  const missingResult = await fixture.run(["-Action", "Prepare", "-DisplayMapPath", missing]);
  assert.notEqual(missingResult.exitCode, 0, "Prepare must reject a missing display map");
  assert.match(missingResult.stderr, /display map.*missing/i);

  const oversized = path.join(fixture.root, "oversized-display-map.json");
  await writeFile(oversized, Buffer.alloc(65_537, 0x20));
  const oversizedResult = await fixture.run(["-Action", "Prepare", "-DisplayMapPath", oversized]);
  assert.notEqual(oversizedResult.exitCode, 0, "Prepare must bound display-map bytes");
  assert.match(oversizedResult.stderr, /display map.*size/i);
  assert.equal((await captureRecords(fixture)).length, 0);
});

test("Prepare copies an empty bounded map unchanged and leaves schema validation to the launcher", async t => {
  const fixture = await makeFixture(t);
  const selected = await prepareSession(t, fixture, { mapBytes: Buffer.alloc(0) });
  assert.equal((await stat(path.join(selected.validateRoot, "display-map.json"))).size, 0);
  assert.equal((await stat(path.join(selected.showRoot, "display-map.json"))).size, 0);
});

test("Show is blocked before READY and after a terminal summary", async t => {
  const fixture = await makeFixture(t);
  const beforeReady = await prepareSession(t, fixture);
  const early = await fixture.run(["-Action", "Show", "-SessionFile", beforeReady.sessionFile]);
  assert.notEqual(early.exitCode, 0, "Show must not launch before current sound READY");
  assert.match(early.stderr, /sound.*not ready/i);
  assert.deepEqual(await captureRecords(fixture), []);

  const ended = await prepareSession(t, fixture);
  await writeReady(ended, { summary: true });
  const terminal = await fixture.run(["-Action", "Show", "-SessionFile", ended.sessionFile]);
  assert.notEqual(terminal.exitCode, 0, "Show must not accept an ended sound session");
  assert.match(terminal.stderr, /sound.*ended|terminal/i);
  assert.deepEqual(await captureRecords(fixture), []);
});

test("Show propagates exact roots, network policy, and start policy", async t => {
  const fixture = await makeFixture(t);
  const selected = await prepareSession(t, fixture);
  await writeReady(selected);

  const connected = await fixture.run(["-Action", "Show", "-SessionFile", selected.sessionFile]);
  assert.equal(connected.exitCode, 0, `Show should follow successful validation: ${connected.stderr}`);
  const offline = await fixture.run([
    "-Action", "Show",
    "-SessionFile", selected.sessionFile,
    "-OfflineRequired",
    "-StartPolicy", "Automatic",
  ]);
  assert.equal(offline.exitCode, 0, `explicit OfflineRequired should launch: ${offline.stderr}`);
  const records = await captureRecords(fixture);
  assert.equal(records.length, 4);
  for (const [index, networkPolicy] of ["DiagnosticConnected", "OfflineRequired"].entries()) {
    const validate = records[index * 2];
    const show = records[index * 2 + 1];
    assert.deepEqual(validate, {
      launcher: "start-show",
      mode: "ValidateOnly",
      rehearsalRoot: selected.validateRoot,
      displayMapPath: path.join(selected.validateRoot, "display-map.json"),
      runId: path.basename(selected.validateRoot),
      networkPolicy,
      startPolicy: "Operator",
      soundRunRoot: selected.soundRoot,
    });
    assert.deepEqual(show, {
      launcher: "start-show",
      mode: "Show",
      rehearsalRoot: selected.showRoot,
      displayMapPath: path.join(selected.showRoot, "display-map.json"),
      runId: path.basename(selected.showRoot),
      networkPolicy,
      startPolicy: index === 0 ? "Operator" : "Automatic",
      soundRunRoot: selected.soundRoot,
    });
  }
});

test("Sound, Show, and StopSound forward one explicit absolute Node executable", async t => {
  const fixture = await makeFixture(t);
  const selected = await prepareSession(t, fixture);
  await writeReady(selected);

  const sound = await fixture.run([
    "-Action", "Sound",
    "-SessionFile", selected.sessionFile,
    "-NodeExecutable", process.execPath,
  ]);
  assert.equal(sound.exitCode, 0, sound.stderr);
  const show = await fixture.run([
    "-Action", "Show",
    "-SessionFile", selected.sessionFile,
    "-NodeExecutable", process.execPath,
  ]);
  assert.equal(show.exitCode, 0, show.stderr);
  const stop = await fixture.run([
    "-Action", "StopSound",
    "-SessionFile", selected.sessionFile,
    "-NodeExecutable", process.execPath,
  ]);
  assert.equal(stop.exitCode, 0, stop.stderr);

  const records = await captureRecords(fixture);
  assert.equal(records.length, 4);
  assert.deepEqual(records.map(record => record.launcher), [
    "start-sound",
    "start-show",
    "start-show",
    "stop-sound",
  ]);
  assert.ok(records.every(record => record.nodeExecutable === process.execPath));
});

test("joint actions reject a relative explicit Node path before delegation", async t => {
  const fixture = await makeFixture(t);
  const selected = await prepareSession(t, fixture);
  const result = await fixture.run([
    "-Action", "Sound",
    "-SessionFile", selected.sessionFile,
    "-NodeExecutable", "runtime\\node\\node.exe",
  ]);
  assert.notEqual(result.exitCode, 0);
  assert.deepEqual(await captureRecords(fixture), []);
});

test("non-Show actions reject the automatic start policy", async t => {
  const fixture = await makeFixture(t);
  const result = await fixture.run([
    "-Action", "Status",
    "-SessionFile", path.join(fixture.root, "missing-session.json"),
    "-StartPolicy", "Automatic",
  ]);
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /startpolicy.*only.*show|start policy.*only.*show/iu);
  assert.deepEqual(await captureRecords(fixture), []);
});

test("Show propagates ValidateOnly failure and never invokes Show", async t => {
  const fixture = await makeFixture(t);
  const selected = await prepareSession(t, fixture);
  await writeReady(selected);
  const result = await fixture.run(
    ["-Action", "Show", "-SessionFile", selected.sessionFile],
    { env: { JOINT_VALIDATE_EXIT: "23" } },
  );
  assert.equal(result.exitCode, 23, "ValidateOnly child exit code must propagate");
  const records = await captureRecords(fixture);
  assert.equal(records.length, 1, "failed validation must prevent a Show child launch");
  assert.equal(records[0].mode, "ValidateOnly");
});

test("Status reveals only public readiness paths and reports terminal state without credentials", async t => {
  const fixture = await makeFixture(t);
  const selected = await prepareSession(t, fixture);
  await writeReady(selected);
  const ready = await fixture.run(["-Action", "Status", "-SessionFile", selected.sessionFile]);
  assert.equal(ready.exitCode, 0, ready.stderr);
  assert.match(ready.stdout, /SOUND_STATUS READY/u);
  assert.match(ready.stdout, new RegExp(selected.soundRoot.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&"), "u"));
  assert.match(ready.stdout, new RegExp(path.join(selected.soundRoot, "flock-input.json").replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&"), "u"));
  for (const secret of ["ready-secret-must-not-print", "a".repeat(64), "b".repeat(64)]) {
    assert.equal(`${ready.stdout}${ready.stderr}`.includes(secret), false, "Status must not print credentials");
  }

  await writeFile(path.join(selected.soundRoot, "summary.json"), JSON.stringify({
    version: 1,
    runRoot: selected.soundRoot,
    clean: true,
    reason: "requestedStop",
    credentialFixture: "summary-secret-must-not-print",
  }));
  const ended = await fixture.run(["-Action", "Status", "-SessionFile", selected.sessionFile]);
  assert.equal(ended.exitCode, 0, ended.stderr);
  assert.match(ended.stdout, /SOUND_STATUS ENDED clean=True reason=requestedStop/u);
  assert.equal(ended.stdout.includes("FLOCK_INPUT_PATH"), false, "terminal sessions must not advertise a live flock path");
  assert.equal(ended.stdout.includes("summary-secret-must-not-print"), false);
});

test("StopSound targets only the selected sound root and distinguishes request from clean completion", async t => {
  const fixture = await makeFixture(t);
  const selected = await prepareSession(t, fixture);
  await prepareSession(t, fixture);
  const result = await fixture.run(["-Action", "StopSound", "-SessionFile", selected.sessionFile]);
  assert.equal(result.exitCode, 0, `StopSound should propagate a successful stop request: ${result.stderr}`);
  assert.deepEqual(await captureRecords(fixture), [{ launcher: "stop-sound", runRoot: selected.soundRoot }]);
  assert.match(result.stdout, /existing Stop Show button/u);
  assert.match(result.stdout, /clean completion (?:is )?not yet verified/iu);
});
