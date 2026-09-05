import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import console from "node:console";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import test from "node:test";
import { clearTimeout, setTimeout } from "node:timers";

const REHEARSAL_ROOT = "D:/VirtualData/JanVim-Exhibition-Rehearsals";
const REPOSITORY_ROOT = process.cwd();
const SOUND_ROOT = path.join(REPOSITORY_ROOT, "sound");
const TEST_ROOT = path.join(SOUND_ROOT, "tests");
const LAUNCHER = path.join(SOUND_ROOT, "sclang-launch.psm1");

const psLiteral = (value) => `'${value.replaceAll("'", "''")}'`;

const parseRecords = (output, prefix) => output
  .split(/\r?\n/u)
  .filter((line) => line.startsWith(`${prefix} `))
  .map((line) => JSON.parse(line.slice(prefix.length + 1)));

const runIsolatedSclang = ({ scriptPath, workingDirectory, environment }) => {
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `Import-Module ${psLiteral(LAUNCHER)} -Force`,
    `$result = Invoke-JanVimIsolatedSclang -ScriptPath ${psLiteral(scriptPath)} -ScriptArguments @('0123456789abcdef0123456789abcdef','silent','1','') -UdpPort 57140 -TimeoutMilliseconds 15000 -KillTimeoutMilliseconds 2000 -MaxCaptureCharacters 131072 -WorkingDirectory ${psLiteral(workingDirectory)}`,
    "if ($result.StdOut) { Write-Output $result.StdOut.TrimEnd() }",
    "if ($result.StdErr) { [Console]::Error.WriteLine($result.StdErr.TrimEnd()) }",
    "exit $result.ExitCode",
  ].join("; ");

  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
      cwd: REPOSITORY_ROOT,
      env: { ...process.env, ...environment },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.once("error", reject);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("startup ownership fixture exceeded 20 seconds"));
    }, 20_000);
    child.once("close", (status, signal) => {
      clearTimeout(timer);
      resolve({ elapsedMilliseconds: performance.now() - started, signal, status, stderr, stdout });
    });
  });
};

async function runFixture(mode) {
  await mkdir(REHEARSAL_ROOT, { recursive: true });
  const evidenceRoot = await mkdtemp(path.join(REHEARSAL_ROOT, `attended-sc-${mode}-`));
  const fixtureSoundRoot = path.join(evidenceRoot, "sound");
  const fixtureTestRoot = path.join(fixtureSoundRoot, "tests");
  const statePath = path.join(evidenceRoot, "helper-first.marker");
  const helperLogPath = path.join(evidenceRoot, "helper.ndjson");
  await mkdir(fixtureTestRoot, { recursive: true });
  await writeFile(helperLogPath, "", "utf8");
  for (const name of ["service.scd", "policy.scd", "synths.scd"]) {
    await copyFile(path.join(SOUND_ROOT, name), path.join(fixtureSoundRoot, name));
  }
  await copyFile(
    path.join(TEST_ROOT, "server-port-owner-fixture.ps1"),
    path.join(fixtureSoundRoot, "server-port-owner.ps1"),
  );
  for (const name of ["fake-scsynth.mjs", "service-fake-server.scd"]) {
    await copyFile(path.join(TEST_ROOT, name), path.join(fixtureTestRoot, name));
  }

  const result = await runIsolatedSclang({
    scriptPath: path.join(fixtureTestRoot, "service-fake-server.scd"),
    workingDirectory: fixtureTestRoot,
    environment: {
      JANVIM_SOUND_FAKE_MODE: "owned",
      JANVIM_SOUND_OWNER_FIXTURE_LOG: helperLogPath,
      JANVIM_SOUND_OWNER_FIXTURE_MODE: mode,
      JANVIM_SOUND_OWNER_FIXTURE_STATE: statePath,
    },
  });
  const helperEvents = (await readFile(helperLogPath, "utf8"))
    .split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
  await writeFile(path.join(evidenceRoot, "result.json"), `${JSON.stringify({ result, helperEvents }, null, 2)}\n`);
  return { ...result, evidenceRoot, helperEvents };
}

const ownershipFailures = (result) => parseRecords(result.stdout, "SOUND_EVENT")
  .filter(({ type }) => type === "ownershipCheckFailure");

const assertBoundedFailureRecord = (result, origin, status) => {
  const failures = ownershipFailures(result);
  assert.equal(failures.length, 1, `expected one terminal diagnostic\n${result.stdout}`);
  assert.equal(failures[0].origin, origin);
  assert.equal(failures[0].status, status);
  assert.equal(failures[0].phase, "starting");
  assert.ok(Number.isInteger(failures[0].helperPid) && failures[0].helperPid > 0);
  assert.ok(Number.isInteger(failures[0].serverPid) && failures[0].serverPid > 0);
  assert.ok(Number.isInteger(failures[0].generation) && failures[0].generation > 0);
  assert.ok(Number.isInteger(failures[0].elapsedMilliseconds));
  const line = result.stdout.split(/\r?\n/u)
    .find((candidate) => candidate.startsWith("SOUND_EVENT ") && candidate.includes("ownershipCheckFailure"));
  assert.ok(Buffer.byteLength(line, "utf8") <= 512, "terminal diagnostic exceeded 512 bytes");
};

test("a correct ownership callback at two seconds is admitted during startup", { timeout: 25_000 }, async () => {
  const result = await runFixture("startup-delay-owned");
  assert.equal(result.status, 0, `delayed owned startup failed\n${result.stdout}\n${result.stderr}`);
  assert.equal(result.signal, null);
  assert.equal(parseRecords(result.stdout, "SOUND_READY").length, 1);
  assert.deepEqual(parseRecords(result.stdout, "SOUND_COMPLETE"), [{ reason: "duration", clean: true }]);
  assert.deepEqual(ownershipFailures(result), []);
  assert.equal(result.helperEvents[0].first, true);
  console.log(`STARTUP_OWNERSHIP_EVIDENCE ${JSON.stringify({ mode: "startup-delay-owned", evidenceRoot: result.evidenceRoot, elapsedMilliseconds: result.elapsedMilliseconds })}`);
});

test("a nonreturning startup helper expires once and a late callback cannot reactivate service", { timeout: 25_000 }, async () => {
  const result = await runFixture("startup-hang");
  assert.notEqual(result.status, 0);
  assert.equal(result.signal, null);
  assert.ok(result.elapsedMilliseconds >= 2_800 && result.elapsedMilliseconds < 10_000,
    `startup timeout was not near the three-second budget: ${result.elapsedMilliseconds}ms`);
  assert.equal(parseRecords(result.stdout, "SOUND_READY").length, 0);
  assert.deepEqual(parseRecords(result.stdout, "SOUND_COMPLETE"), [
    { reason: "ownershipCheckFailed", clean: false },
  ]);
  assertBoundedFailureRecord(result, "deadlineExpired", 4);
  console.log(`STARTUP_OWNERSHIP_EVIDENCE ${JSON.stringify({ mode: "startup-hang", evidenceRoot: result.evidenceRoot, elapsedMilliseconds: result.elapsedMilliseconds })}`);
});

test("a wrong startup identity remains rejected with one helper-exit diagnostic", { timeout: 25_000 }, async () => {
  const result = await runFixture("wrong-identity");
  assert.notEqual(result.status, 0);
  assert.equal(result.signal, null);
  assert.equal(parseRecords(result.stdout, "SOUND_READY").length, 0);
  assert.deepEqual(parseRecords(result.stdout, "SOUND_COMPLETE"), [
    { reason: "serverPortOccupied", clean: true },
  ]);
  assertBoundedFailureRecord(result, "helperExit", 3);
  console.log(`STARTUP_OWNERSHIP_EVIDENCE ${JSON.stringify({ mode: "wrong-identity", evidenceRoot: result.evidenceRoot, elapsedMilliseconds: result.elapsedMilliseconds })}`);
});

test("cleanup keeps the default 1.5-second ownership deadline", { timeout: 25_000 }, async () => {
  const result = await runFixture("cleanup-delay-owned");
  assert.notEqual(result.status, 0);
  assert.equal(result.signal, null);
  assert.equal(parseRecords(result.stdout, "SOUND_READY").length, 1);
  assert.deepEqual(parseRecords(result.stdout, "SOUND_COMPLETE"), [{ reason: "duration", clean: false }]);
  assert.deepEqual(ownershipFailures(result), []);
  assert.ok(result.helperEvents.some(({ first }) => !first), "cleanup never invoked the delayed helper");
  assert.ok(result.elapsedMilliseconds < 12_000, `cleanup exceeded its finite bound: ${result.elapsedMilliseconds}ms`);
  console.log(`STARTUP_OWNERSHIP_EVIDENCE ${JSON.stringify({ mode: "cleanup-delay-owned", evidenceRoot: result.evidenceRoot, elapsedMilliseconds: result.elapsedMilliseconds })}`);
});
