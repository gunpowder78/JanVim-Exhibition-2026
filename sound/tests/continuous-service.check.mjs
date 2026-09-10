import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import process from "node:process";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { prepareRunRoot, requestStop, spawnManagedChild } from "../run.mjs";

test("continuous silent SC service waits for explicit Stop and cleans its owned tree", { timeout: 55000 }, async t => {
  const evidence = await prepareRunRoot(null);
  const runRoot = path.join(evidence, "continuous-service");
  let ready = false;
  const child = await spawnManagedChild({
    executable: process.execPath,
    args: [path.resolve("sound/run.mjs"), "--mode", "silent", "--input", "real-cursor", "--duration", "0", "--output", runRoot],
    cwd: process.cwd(), timeoutMs: 45000,
    stdoutPath: path.join(evidence, "supervisor.stdout.log"), stderrPath: path.join(evidence, "supervisor.stderr.log"),
    onStdoutLine: line => { if (line.startsWith("SOUND_RUN_READY ")) ready = true; },
  });
  t.after(() => child.terminate());
  for (let attempt = 0; attempt < 350 && !ready && child.child.exitCode === null; attempt++) await delay(100);
  assert.equal(ready, true, await readFile(path.join(evidence, "supervisor.stderr.log"), "utf8"));
  await delay(2000);
  assert.equal(child.child.exitCode, null, "zero duration must not schedule an immediate SC or Node timeout");
  assert.equal(await requestStop(runRoot), true);
  const result = await child.completion;
  assert.equal(result.exitCode, 0, await readFile(path.join(evidence, "supervisor.stderr.log"), "utf8"));
  const summary = JSON.parse(await readFile(path.join(runRoot, "summary.json"), "utf8"));
  assert.equal(summary.clean, true);
  assert.equal(summary.reason, "requested");
  assert.equal(summary.capturePath, null, "continuous mode must not allocate an unbounded recording");
  assert.ok(summary.actualDurationSeconds >= 2);
  await assert.rejects(() => requestStop(runRoot), /invalid control receipt/);
});
