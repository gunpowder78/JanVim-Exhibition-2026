import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import process from "node:process";
import { readFile, stat } from "node:fs/promises";
import * as runtime from "../run.mjs";

test("only explicit real-cursor runs may select duration zero (until Stop)", () => {
  assert.equal(runtime.parseCli(["--input", "real-cursor", "--duration", "0"]).duration, 0);
  assert.throws(() => runtime.parseCli(["--duration", "0"]), /duration/);
  for (const value of ["-1", "NaN", "Infinity", "3601", "0.5"]) {
    assert.throws(() => runtime.parseCli(["--input", "real-cursor", "--duration", value]), /duration/);
  }
});

test("fake elapsed time crosses one hour and one day without ending the continuous sender", () => {
  for (const elapsed of [0, 3599.75, 3600, 3720, 86400, 604800]) {
    assert.equal(runtime.durationExpired(0, elapsed), false);
  }
  assert.equal(runtime.durationExpired(3600, 3599.75), false);
  assert.equal(runtime.durationExpired(3600, 3600), true);
  assert.equal(runtime.durationExpired(45, 45), true);
});

test("continuous service and sender receive no elapsed deadline; timed rehearsal retains its margins", () => {
  assert.deepEqual(runtime.runTiming(0), {
    serviceDuration: 0, senderDuration: 0, serviceTimeoutMs: 0, senderTimeoutMs: 0,
  });
  assert.deepEqual(runtime.runTiming(3600), {
    serviceDuration: 3600, senderDuration: 3599.75, serviceTimeoutMs: 3645000, senderTimeoutMs: 3610000,
  });
  assert.deepEqual(runtime.runTiming(45), {
    serviceDuration: 50, senderDuration: 45, serviceTimeoutMs: 95000, senderTimeoutMs: 55000,
  });
});

test("continuous managed child survives normal output beyond the log and lifetime byte budgets", async t => {
  const root = await runtime.prepareRunRoot(null);
  const child = await runtime.spawnManagedChild({
    executable: process.execPath, cwd: root,
    args: ["-e", 'process.stdout.write("a".repeat(47)+"\\n"); setTimeout(()=>process.stdout.write("b".repeat(47)+"\\n"),1100);'],
    timeoutMs: 0, maxLineBytes: 64, maxLogBytes: 32, maxStreamBytes: 64,
    stdoutPath: path.join(root, "stdout.log"), stderrPath: path.join(root, "stderr.log"),
  });
  t.after(() => child.terminate());
  const result = await child.completion;
  assert.equal(result.limitReason, null);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdoutBytes, 96);
  assert.equal((await stat(path.join(root, "stdout.log"))).size, 32);
});

test("continuous managed child still rejects a burst above its stream budget", async t => {
  const root = await runtime.prepareRunRoot(null);
  const child = await runtime.spawnManagedChild({
    executable: process.execPath, cwd: root,
    args: ["-e", 'process.stdout.write("a".repeat(80)+"\\n");setInterval(()=>{},1000);'],
    timeoutMs: 0, maxLineBytes: 128, maxLogBytes: 32, maxStreamBytes: 64,
    stdoutPath: path.join(root, "stdout.log"), stderrPath: path.join(root, "stderr.log"),
  });
  t.after(() => child.terminate());
  assert.equal((await child.completion).limitReason, "stdoutStream");
});

test("owned Windows child accepts continuous lifetime and still exits with its own process", async t => {
  const root = await runtime.prepareRunRoot(null);
  const child = await runtime.spawnManagedChild({
    executable: process.execPath, cwd: root, ownedLifetime: true,
    args: ["-e", 'process.stdout.write("continuous-owner-test\\n");'],
    timeoutMs: 0,
    stdoutPath: path.join(root, "stdout.log"), stderrPath: path.join(root, "stderr.log"),
  });
  t.after(() => child.terminate());
  const result = await child.completion;
  assert.equal(result.exitCode, 0, await readFile(path.join(root, "stderr.log"), "utf8"));
  assert.equal(result.limitReason, null);
  assert.match(await readFile(path.join(root, "stdout.log"), "utf8"), /continuous-owner-test/);
});
