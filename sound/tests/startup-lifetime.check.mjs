import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import console from "node:console";
import dgram from "node:dgram";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { createContext, Script } from "node:vm";
import { prepareRunRoot, spawnManagedChild } from "../run.mjs";

async function bounded(promise, milliseconds = 5000) {
  const controller = new globalThis.AbortController();
  try {
    return await Promise.race([promise, delay(milliseconds, null, { signal: controller.signal })
      .then(() => { throw new Error("lifetime completion exceeded bound"); })]);
  } finally { controller.abort(); }
}

async function reusable(port) {
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: false });
  try {
    await new Promise((resolve, reject) => {
      socket.once("error", reject);
      socket.bind({ address: "127.0.0.1", port, exclusive: true }, resolve);
    });
  } finally { socket.close(); }
}

// Execute the actual production-generated PowerShell, replacing only OS reads
// with a finite identity graph. No SC, actual endpoint lookup or process kill.
async function inspectFixture(t, scenario = "owned") {
  const source = await readFile(path.resolve("sound/run.mjs"), "utf8");
  const functions = source.match(/async function inspectReadyProcesses\([\s\S]+?(?=async function inspectProcess)/g);
  assert.equal(functions?.length, 1, "one actual production inspection function");
  let queries;
  const runRoot = await prepareRunRoot(null);
  const context = createContext({ SERVER_PORT: 57141, path, process: { pid: 100 },
    runPowerShellJson: async (script, timeoutMs) => {
      assert.equal(timeoutMs, 5000, "production inspection keeps its finite deadline");
      const prelude = `
        $ErrorActionPreference = 'Stop'
        $scenario = '${scenario}'
        $queries = [Collections.Generic.List[int]]::new()
        $hits = @{}
        function Get-NetUDPEndpoint {
          param([int]$LocalPort)
          if ($LocalPort -ne 57141) { throw 'wrong fixture endpoint' }
          if ($scenario -eq 'no-owner') { return }
          [pscustomobject]@{ LocalAddress='127.0.0.1'; OwningProcess=101 }
          if ($scenario -eq 'two-owners') { [pscustomobject]@{ LocalAddress='127.0.0.1'; OwningProcess=999 } }
        }
        function Get-CimInstance {
          param([string]$ClassName, [string]$Filter)
          if ($ClassName -ne 'Win32_Process' -or $Filter -notmatch '^ProcessId = ([0-9]+)$') { throw 'unexpected fixture query' }
          $identityPid = [int]$Matches[1]
          $queries.Add($identityPid)
          if ($queries.Count -gt 35) { throw 'inspection exceeded depth plus three fresh role queries' }
          $hits[$identityPid] = 1 + $hits[$identityPid]
          $parents = @{101=102;102=103;103=104;104=100;100=900}
          if ($scenario -eq 'missing-ready-ancestor') { $parents[101]=103 }
          if ($scenario -eq 'missing-language-ancestor') { $parents[102]=104 }
          if ($scenario -eq 'depth-cap') { $parents[101]=900 }
          $parentPid = if ($parents.ContainsKey($identityPid)) { $parents[$identityPid] }
            elseif ($identityPid -ge 900 -and $identityPid -lt 930) { $identityPid+1 } else { 0 }
          $row = [pscustomobject]@{ ProcessId=$identityPid; ParentProcessId=$parentPid;
            CreationDate=([DateTime]::SpecifyKind([DateTime]'2026-09-05', [DateTimeKind]::Utc).AddMilliseconds($hits[$identityPid]));
            ExecutablePath=if ($identityPid -eq 101) { 'C:/owned/scsynth.exe' } else { 'C:/owned/fixture.exe' } }
          if ($scenario -eq 'wrong-owner-executable' -and $identityPid -eq 101) { $row.ExecutablePath='C:/foreign/node.exe' }
          if ($hits[$identityPid] -gt 1) {
            if (($scenario -eq 'missing-ready' -and $identityPid -eq 102) -or
                ($scenario -eq 'missing-language' -and $identityPid -eq 103) -or
                ($scenario -eq 'missing-host' -and $identityPid -eq 104)) { return }
            if (($scenario -eq 'wrong-ready-pid' -and $identityPid -eq 102) -or
                ($scenario -eq 'wrong-language-pid' -and $identityPid -eq 103) -or
                ($scenario -eq 'wrong-host-pid' -and $identityPid -eq 104)) { $row.ProcessId=999 }
            if (($scenario -eq 'wrong-language-parent' -and $identityPid -eq 103) -or
                ($scenario -eq 'wrong-host-parent' -and $identityPid -eq 104)) { $row.ParentProcessId=999 }
          }
          $row
        }
      `;
      const invocation = `${prelude}
        try {
          $inspection = & { ${script} }
          [ordered]@{inspection=($inspection | ConvertFrom-Json); queries=@($queries)} | ConvertTo-Json -Depth 8 -Compress
        } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
      `;
      const child = await spawnManagedChild({ executable: "pwsh.exe", args: ["-NoProfile", "-NonInteractive", "-Command", invocation],
        cwd: runRoot, timeoutMs, maxLogBytes: 32768, maxStreamBytes: 32768,
        stdoutPath: path.join(runRoot, "inspection.stdout.log"), stderrPath: path.join(runRoot, "inspection.stderr.log") });
      t.after(() => child.terminate());
      const result = await bounded(child.completion, 6500);
      assert.equal(result.limitReason, null, "fake deterministic inspection must not hit a watchdog");
      const stderr = await readFile(path.join(runRoot, "inspection.stderr.log"), "utf8");
      if (result.exitCode !== 0) throw new Error(stderr.trim());
      assert.equal(stderr, "");
      const parsed = JSON.parse(await readFile(path.join(runRoot, "inspection.stdout.log"), "utf8"));
      queries = parsed.queries;
      return parsed.inspection;
    },
  });
  new Script(functions[0]).runInContext(context, { timeout: 1000 });
  return { run: () => new Script("inspectReadyProcesses(103, 102, 104)").runInContext(context, { timeout: 1000 }),
    queries: () => queries, runRoot };
}

test("production startup ancestry stops at owned host while fresh role identities remain independent", async t => {
  const fixture = await inspectFixture(t);
  const result = await fixture.run();
  assert.deepEqual(fixture.queries(), [101, 102, 103, 104, 102, 103, 104],
    "external ancestors must never be queried after the known owned service host");
  assert.deepEqual(result.ancestry.map(row => row.pid), [101, 102, 103, 104]);
  for (const [role, index] of [["ready", 1], ["language", 2], ["host", 3]]) {
    assert.notEqual(result[role].started, result.ancestry[index].started, `${role} must be queried afresh`);
  }
  t.diagnostic(`production PowerShell inspection evidence: ${fixture.runRoot}`);
});

test("production startup ancestry preserves every negative ownership admission", async t => {
  for (const scenario of ["missing-ready", "missing-language", "missing-host", "wrong-ready-pid",
    "wrong-language-pid", "wrong-host-pid", "wrong-language-parent", "wrong-host-parent",
    "missing-ready-ancestor", "missing-language-ancestor", "wrong-owner-executable", "no-owner", "two-owners"]) {
    await t.test(scenario, async sub => {
      const fixture = await inspectFixture(sub, scenario);
      await assert.rejects(fixture.run(), /incomplete identity|private endpoint ancestry|private endpoint does not have one owner/);
    });
  }
});

test("production startup ancestry still caps a foreign chain at 32 before rejecting it", async t => {
  const fixture = await inspectFixture(t, "depth-cap");
  await assert.rejects(fixture.run(), /private endpoint ancestry/);
  assert.equal(fixture.queries().length, 35, "32 ancestors plus three separate fresh role queries");
  assert.deepEqual(fixture.queries().slice(-3), [102, 103, 104]);
});

for (const [exitCode, complete] of [[0, false], [1, false], [0, true]]) {
  test(`post-READY exit ${exitCode} ${complete ? "with COMPLETE avoids extra grace" : "without COMPLETE preserves DSP fade grace"}`, async () => {
    const runRoot = await prepareRunRoot(null);
    let leaf;
    let resolveReady;
    const ready = new Promise((resolve) => { resolveReady = resolve; });
    // No audio: the detached leaf keeps an endpoint and inherited streams alive.
    // Exit is requested only after the real launcher's READY/COMPLETE path runs.
    const leafCode = `const d=require('node:dgram').createSocket('udp4');
      d.bind(0,'127.0.0.1',()=>process.send({pid:process.pid,port:d.address().port}));
      d.on('message',()=>process.send('exit'));
      setTimeout(()=>process.exit(),15000);`;
    const languageCode = `const {spawn}=require('node:child_process');
      const c=spawn(process.execPath,['-e',${JSON.stringify(leafCode)}],
        {stdio:['ignore','inherit','inherit','ipc'],detached:true,windowsHide:true});
      c.on('message',value=>{
        if(value==='exit') process.exit(${exitCode});
        console.log('LEAF '+JSON.stringify(value));
        console.log('SOUND_READY {}');
        if(${complete}) console.log('SOUND_COMPLETE {}');
        console.log('FIXTURE_ARMED');
      });
      setTimeout(()=>process.exit(2),15000);`;
    const owned = await spawnManagedChild({ executable: process.execPath,
      args: ["-e", languageCode], cwd: runRoot, ownedLifetime: true, timeoutMs: 18000,
      stdoutPath: path.join(runRoot, "grace.stdout.log"), stderrPath: path.join(runRoot, "grace.stderr.log"),
      onStdoutLine: (line) => {
        if (line.startsWith("LEAF ")) leaf = JSON.parse(line.slice(5));
        if (line === "FIXTURE_ARMED") resolveReady();
      },
    });
    try {
      await bounded(ready);
      await delay(200); // allow the launcher's stdin reader to consume R / C
      const trigger = dgram.createSocket("udp4");
      const started = performance.now();
      try {
        await new Promise((resolve, reject) => trigger.send("exit", leaf.port, "127.0.0.1",
          (error) => error ? reject(error) : resolve()));
      } finally { trigger.close(); }
      // Confirm language loss, not merely that the fixture received a request.
      await (async () => {
        const deadline = performance.now() + 1000;
        while (performance.now() < deadline) {
          try { process.kill(owned.identity.pid, 0); }
          catch (error) { assert.equal(error.code, "ESRCH"); return; }
          await delay(10);
        }
        assert.fail("fixture language did not exit within one second");
      })();
      if (!complete) {
        await delay(3100);
        assert.doesNotThrow(() => process.kill(leaf.pid, 0), "descendant must survive DSP lease and fade grace");
        await assert.rejects(reusable(leaf.port), /EADDRINUSE/);
      }
      const result = await bounded(owned.completion, complete ? 2500 : 4000);
      const elapsedMs = performance.now() - started;
      assert.equal(result.exitCode, exitCode);
      assert.equal(result.limitReason, null, "cleanup must not depend on the test watchdog");
      assert.ok(complete ? elapsedMs < 2500 : elapsedMs >= 3500 && elapsedMs < 8000, `exit cleanup took ${elapsedMs} ms`);
      assert.throws(() => process.kill(leaf.pid, 0), /ESRCH/);
      await reusable(leaf.port);
      console.log(`EXIT_GRACE_EVIDENCE ${JSON.stringify({exitCode,complete,elapsedMs,runRoot,leaf})}`);
    } finally {
      await owned.terminate();
      await bounded(owned.completion);
    }
  });
}

// These children have no audio code. The leaf holds an ephemeral UDP endpoint and
// inherited output handles, reproducing the Windows startup orphan's effects.
for (const phase of ["before READY", "during identity inspection", "pinned startup failure"]) {
  test(`owned startup lifetime closes descendants after language loss ${phase}`, async () => {
    const runRoot = await prepareRunRoot(null);
    let leaf;
    let resolveLeaf;
    const leafReady = new Promise((resolve) => { resolveLeaf = resolve; });
    const leafCode = `const d = require('node:dgram').createSocket('udp4');
      d.bind(0, '127.0.0.1', () => console.log('LEAF ' + JSON.stringify({pid:process.pid,port:d.address().port})));
      setTimeout(() => process.exit(), 15000);`;
    const languageCode = `const {spawn} = require('node:child_process');
      spawn(process.execPath, ['-e', ${JSON.stringify(leafCode)}], {stdio:'inherit',windowsHide:true,detached:true});
      setTimeout(() => process.exit(), 15000);`;
    const owned = await spawnManagedChild({
      args: ["-e", languageCode], cwd: runRoot, executable: process.execPath,
      ownedLifetime: true, timeoutMs: 18000,
      stdoutPath: path.join(runRoot, "lifetime.stdout.log"),
      stderrPath: path.join(runRoot, "lifetime.stderr.log"),
      onStdoutLine: (line) => {
        if (line.startsWith("LEAF ")) { leaf = JSON.parse(line.slice(5)); resolveLeaf(); }
      },
    });
    try {
      await bounded(leafReady);
      // Retain a live OS process identity before the interruption. The launcher
      // supplies the language identity from its creation handle, before resume.
      const languagePid = owned.identity?.pid ?? owned.child.pid;
      if (phase !== "before READY") await delay(100);
      await assert.rejects(reusable(leaf.port), /EADDRINUSE/);
      const killer = spawn("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command",
        `Stop-Process -Id ${languagePid} -Force`], { stdio: "ignore", windowsHide: true });
      await bounded(new Promise((resolve) => killer.once("exit", resolve)));
      if (phase === "during identity inspection") await delay(200);
      if (phase === "pinned startup failure") await owned.terminate();
      await bounded(owned.completion, 3500);
      await reusable(leaf.port);
      assert.ok(owned.identity?.started && owned.identity?.executable,
        "live creation time and executable identity must be retained before resume");
      assert.equal(path.resolve(owned.identity.executable).toLowerCase(), process.execPath.toLowerCase());
      assert.equal(owned.identity.parentPid, owned.child.pid, "owned child is the host, identity is its created language");
      assert.notEqual(owned.identity.pid, owned.child.pid);
      console.log(`STARTUP_LIFETIME_EVIDENCE ${JSON.stringify({phase,runRoot,identity:owned.identity,leaf})}`);
    } finally {
      // Only the newly created disposable fixture leaf; never an endpoint owner lookup.
      if (leaf) { try { process.kill(leaf.pid); } catch (error) { assert.equal(error.code, "ESRCH"); } }
      await owned.terminate();
      await bounded(owned.completion);
    }
  });
}

test("owned lifetime closes descendants if its launcher is interrupted", async () => {
  const runRoot = await prepareRunRoot(null);
  let resolveLine;
  const line = new Promise((resolve) => { resolveLine = resolve; });
  const owned = await spawnManagedChild({
    executable: process.execPath, args: ["-e", "console.log('RUNNING');setTimeout(()=>{},15000)"],
    cwd: runRoot, ownedLifetime: true, timeoutMs: 18000,
    stdoutPath: path.join(runRoot, "launcher.stdout.log"), stderrPath: path.join(runRoot, "launcher.stderr.log"),
    onStdoutLine: (value) => { if (value === "RUNNING") resolveLine(); },
  });
  try {
    await bounded(line);
    assert.ok(owned.identity, "launcher must retain the creation identity");
    owned.child.kill();
    await bounded(owned.completion, 3500);
    assert.throws(() => process.kill(owned.identity.pid, 0), /ESRCH/);
  } finally { await owned.terminate(); }
});

for (const [label, before, after] of [
  ["job setup rejected", "flags = 0x2000", "flags = 0xFFFFFFFF"],
  ["job-list attribute unsupported", "(IntPtr)0x2000D", "(IntPtr)0x2FFFF"],
]) {
  test(`owned creation fails closed when ${label}`, async () => {
    const runRoot = await prepareRunRoot(null);
    for (const name of ["run.mjs", "osc.mjs", "real-input.mjs", "flock-input.mjs", "flock-protocol.mjs", "owned-process.ps1", "owned-process.cs"]) {
      await copyFile(path.resolve("sound", name), path.join(runRoot, name));
    }
    const nativePath = path.join(runRoot, "owned-process.cs");
    const source = await readFile(nativePath, "utf8");
    assert.equal(source.split(before).length, 2);
    await writeFile(nativePath, source.replace(before, after));
    const { spawnManagedChild: launch } = await import(pathToFileURL(path.join(runRoot, "run.mjs")));
    const lines = [];
    const child = await launch({ executable: process.execPath,
      args: ["-e", "console.log('MUST_NOT_RUN')"], cwd: runRoot, ownedLifetime: true,
      timeoutMs: 5000, stdoutPath: path.join(runRoot, "failed.stdout.log"),
      stderrPath: path.join(runRoot, "failed.stderr.log"), onStdoutLine: (line) => lines.push(line),
    });
    const result = await bounded(child.completion);
    assert.notEqual(result.exitCode, 0);
    assert.equal(child.identity, null, "no process can be created before the job configuration succeeds");
    assert.ok(!lines.includes("MUST_NOT_RUN"));
    assert.match(await readFile(path.join(runRoot, "failed.stderr.log"), "utf8"), /Win32Exception/);
    console.log(`JOB_FAIL_CLOSED_EVIDENCE ${JSON.stringify({label,runRoot,result})}`);
  });
}

test("unsupported owned IPC fails before starting a child", async () => {
  const runRoot = await prepareRunRoot(null);
  await assert.rejects(spawnManagedChild({ executable: process.execPath, args: ["-e", "process.exit()"],
    ownedLifetime: true, ipc: true, cwd: runRoot, timeoutMs: 5000,
    stdoutPath: path.join(runRoot, "must-not-exist.stdout.log"),
    stderrPath: path.join(runRoot, "must-not-exist.stderr.log"),
  }), /owned lifetime requires Windows without IPC/);
  await assert.rejects(readFile(path.join(runRoot, "must-not-exist.stdout.log")), /ENOENT/);
});

// Exercise runSupervisor's real READY/inspection/catch paths with a disposable
// language/server stand-in. Only the executable/SC argument and OS-inspection
// boundaries are replaced in a private source copy; lifetime/cleanup is real.
for (const phase of ["before READY", "during inspection", "after pinning", "cleanup error after pinning"]) {
  test(`supervisor startup failure ${phase} closes its owned tree and writes a summary`, async () => {
    const sourceRoot = await prepareRunRoot(null);
    const output = `${sourceRoot}-run`;
    for (const name of ["run.mjs", "osc.mjs", "real-input.mjs", "flock-input.mjs", "flock-protocol.mjs", "owned-process.ps1", "owned-process.cs"]) {
      await copyFile(path.resolve("sound", name), path.join(sourceRoot, name));
    }
    const leafCode = `const d=require('node:dgram').createSocket('udp4');
      d.bind(0,'127.0.0.1',()=>process.send({pid:process.pid,port:d.address().port}));
      setTimeout(()=>process.exit(),15000);`;
    const languageCode = `const {spawn}=require('node:child_process');
      const c=spawn(process.execPath,['-e',${JSON.stringify(leafCode)}],
        {stdio:['ignore','inherit','inherit','ipc'],detached:true,windowsHide:true});
      c.on('message',leaf=>{
        console.log('FIXTURE_LEAF '+JSON.stringify(leaf));
        if(${JSON.stringify(phase)}==='before READY') process.exit(1);
        console.log('SOUND_READY '+JSON.stringify({clock:1,languagePort:57140,serverPort:57141,
          hardwareOutput:false,session:'0123456789abcdef0123456789abcdef',serverPid:leaf.pid}));
        if(${JSON.stringify(phase)}==='during inspection') setTimeout(()=>process.exit(1),20);
      });
      setTimeout(()=>process.exit(1),15000);`;
    const runPath = path.join(sourceRoot, "run.mjs");
    let source = await readFile(runPath, "utf8");
    source = source.replace(/const SCLANG = [^;]+;/, "const SCLANG = process.execPath;");
    const serviceInvocation = /const session = randomBytes\(16\)\.toString\("hex"\);\s+const serviceArgs = \[[\s\S]+?\r?\n {4}\];(?=\s+service = await spawnManagedChild\()/g;
    assert.equal([...source.matchAll(serviceInvocation)].length, 1,
      "expected exactly one explicit SC session/serviceArgs source block before fixture replacement");
    source = source.replace(serviceInvocation,
      `const session = "0123456789abcdef0123456789abcdef";
       const serviceArgs = ["-e", ${JSON.stringify(languageCode)}];`);
    source = source.replace(/async function inspectReadyProcesses\([\s\S]+?(?=async function inspectProcess)/,
      phase === "during inspection"
        ? "async function inspectReadyProcesses() { await delay(400); throw new Error('fixture inspection failure'); }\n\n"
        : "async function inspectReadyProcesses(languagePid, readyServerPid) { const language=await inspectProcess(languagePid); const owner=await inspectProcess(readyServerPid); return {language,owner,ready:owner,ancestry:[owner,language]}; }\n\n");
    if (phase.includes("pinning")) {
      source = source.replace("const inspectionCompletedEpochMilliseconds =",
        `${phase.startsWith("cleanup")
          ? "sender = { terminate: async () => { throw new Error('fixture sender cleanup failure'); } };"
          : "process.kill(service.identity.pid); await service.processExit;"}
         throw new Error('fixture pinned startup failure');
         const inspectionCompletedEpochMilliseconds =`);
    }
    await writeFile(runPath, source);
    const supervisor = await spawnManagedChild({ executable: process.execPath,
      args: [runPath, "--mode", "silent", "--duration", "1", "--output", output],
      cwd: sourceRoot, timeoutMs: 13000,
      stdoutPath: path.join(sourceRoot, "supervisor.stdout.log"), stderrPath: path.join(sourceRoot, "supervisor.stderr.log"),
    });
    try {
      const result = await bounded(supervisor.completion, 12000);
      assert.notEqual(result.exitCode, 0);
      assert.equal(result.limitReason, null, "supervisor cleanup must not rely on the test watchdog");
      const summary = JSON.parse(await readFile(path.join(output, "summary.json"), "utf8"));
      assert.equal(summary.clean, false);
      const leaf = JSON.parse((await readFile(path.join(output, "sclang.stdout.log"), "utf8"))
        .split(/\r?\n/).find((line) => line.startsWith("FIXTURE_LEAF ")).slice(13));
      await reusable(leaf.port);
      assert.throws(() => process.kill(leaf.pid, 0), /ESRCH/);
      assert.ok(summary.actualDurationSeconds < 10);
      console.log(`SUPERVISOR_STARTUP_EVIDENCE ${JSON.stringify({phase,sourceRoot,output,leaf,summary})}`);
    } finally { await supervisor.terminate(); }
  });
}
