# JanVim Parent-Exit Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect a terminated JanVim frontend before inherited pipes close, clean its show-owned
Neovim backend through the authenticated parameter-free shutdown path, and resume only from a
fully settled original-poem generation.

**Architecture:** `RuntimeShowSession` treats child `exit` as the immediate fault signal and child
`close` as the final process-tree/output settlement signal. The exhibition Lua connection delays
shutdown transport closure until its ACK write completes and performs one fixed self-exit only when
its captured JanVim parent PID is no longer alive.

**Tech Stack:** Windows 11, Node.js 22.23.0 child processes, Electron 44.0.0, TypeScript 7.0.2,
Vitest 4.1.11, Neovim 0.10.1 Lua/libuv, PowerShell 7.

**Spec:** `docs/superpowers/specs/2026-09-01-janvim-parent-exit-recovery-design.md`

## Global Constraints

- Work only in `D:\github\JanVim-Exhibition-2026\.worktrees\task1` on
  `feat/task1-workflow`.
- Do not modify the JanVim product repository, immutable JanVim artifact, user Neovim
  configuration, source poem/media, or any protected incident directory.
- Preserve the parameter-free schema-1 `shutdown` action and reject every unknown field or user
  command string.
- `exit` invalidates the cue generation; `close` alone proves backend/stream settlement and permits
  lease removal.
- A replacement generation cannot start before old-session settlement, the 1/2/4-second bounded
  restart delay, and an original-poem prepare ACK with the frozen hash.
- Every production behavior begins with a focused failing test. Use a fake clock/event emitter; do
  not wall-clock wait for a show loop.
- Stage only the paths listed by each task; never use `git add -A`.
- The prepared Plugin Lab runtime copy is ignored and may be synchronized only after committed Lua
  source tests pass. Its update must not change the immutable JanVim artifact hash.
- Monitor evidence remains `physicalProjectorsTested: false`; this plan cannot establish G4.

---

### Task 1: Flush shutdown ACK and exit only an orphaned show backend

**Files:**

- Modify: `nvim/tests/agent_spec.lua`
- Modify: `nvim/lua/janvim_exhibition/init.lua`

**Interfaces:**

- Consumes: the existing parameter-free `shutdown` action and `Agent.new({ close_connection })`.
- Produces: `Connection:complete_requested_shutdown()` and these injectable setup options:
  `parent_pid: integer`, `parent_alive(pid): boolean`, `schedule(fn): void`, and
  `exit_backend(): void`.
- In production, `parent_pid` is captured once with `uv.os_getppid()`, liveness is exactly
  `uv.kill(pid, 0) == 0`, and `exit_backend` is the fixed `vim.cmd("qaall!")` operation.

- [ ] **Step 1: Add a failing connection-level test for ACK-before-exit**

Extend the existing fake TCP fixture in `nvim/tests/agent_spec.lua` so writes are retained with
their callbacks instead of completing every callback immediately. Add a test named
`shutdown flushes its ack before one orphan backend exit` with this observable sequence:

```lua
local writes = {}
local exit_count = 0
local connection = exhibition.setup({
  port = 32123,
  token = TOKEN,
  uv = fake_uv,
  schedule_wrap = function(callback) return callback end,
  schedule = function(callback) callback() end,
  parent_pid = 7628,
  parent_alive = function(pid)
    equal(pid, 7628)
    return false
  end,
  exit_backend = function()
    exit_count = exit_count + 1
  end,
})

fake_tcp.reader(nil, vim.json.encode(command("cue-shutdown", { type = "shutdown" })) .. "\n")
equal(#writes, 2) -- hello plus shutdown ACK
equal(exit_count, 0)
expect(not fake_tcp.closed, "transport closed before the ACK write completed")

writes[2].callback(nil)
equal(exit_count, 1)
expect(fake_tcp.closed, "transport remained open after the ACK write completed")

writes[2].callback(nil)
equal(exit_count, 1)
connection:close()
```

The fake timer remains finite and the fake TCP `write` method stores
`{ payload = payload, callback = callback }`. Decode `writes[2].payload` and assert literal fields
`schema = 1`, `cueId = "cue-shutdown"`, and `outcome = "applied"`; do not derive the expectation
through the protocol encoder.

- [ ] **Step 2: Add a failing parent-alive control test**

Add `shutdown keeps a live-parent backend for normal HWND teardown` using the same real connection
path with `parent_alive = function() return true end`. Complete the ACK write and assert the
transport closes exactly once while `exit_count` remains zero. Retain the existing test that
rejects `{ type = "shutdown", command = ":qa!" }` before any close or exit callback.

- [ ] **Step 3: Run Lua tests and verify the RED failure**

Run:

```powershell
pwsh -NoProfile -File .\scripts\run-lua-tests.ps1
```

Expected: the orphan test fails because current `close_connection` closes the transport during
dispatch, before the shutdown ACK write callback, and no fixed orphan-backend exit exists. Confirm
all earlier tests reached execution; a Lua syntax/load error is not an acceptable RED result.

- [ ] **Step 4: Implement deferred authenticated shutdown in `init.lua`**

Capture and validate the fixed lifecycle dependencies during `M.setup`:

```lua
local parent_pid = options.parent_pid or uv.os_getppid()
assert(type(parent_pid) == "number" and parent_pid % 1 == 0 and parent_pid > 0,
  "JanVim parent PID is required")

local parent_alive = options.parent_alive or function(pid)
  local ok, result = pcall(uv.kill, pid, 0)
  return ok and result == 0
end
local schedule = options.schedule or vim.schedule
local exit_backend = options.exit_backend or function()
  vim.cmd("qaall!")
end
```

Store `parent_pid`, `parent_alive`, `schedule`, `exit_backend`, `shutdown_requested = false`, and
`backend_exit_scheduled = false` on `Connection`. Change the production `close_connection`
injection passed to `actions.new` so it sets only `self.shutdown_requested = true`.

Add this idempotent method:

```lua
function Connection:complete_requested_shutdown()
  if not self.shutdown_requested then
    return false
  end
  self:close_transport()
  local ok, alive = pcall(self.parent_alive, self.parent_pid)
  if ok and alive == false and not self.backend_exit_scheduled then
    self.backend_exit_scheduled = true
    self.schedule(function()
      pcall(self.exit_backend)
    end)
  end
  return true
end
```

In the TCP ACK write callback, after clearing `busy`, keep the current write-error branch. On a
successful write, call `complete_requested_shutdown()` and call `pump()` only when it returns
false. Do not add a PID, command string, or exit flag to the protocol.

- [ ] **Step 5: Run focused Lua verification and mutation checks**

Run:

```powershell
pwsh -NoProfile -File .\scripts\run-lua-tests.ps1
```

Expected: all Lua tests pass. Mentally verify these mutations are caught: closing during dispatch,
exiting while the parent is alive, exiting twice, treating a failed liveness check as dead, and
accepting a user-provided shutdown command.

- [ ] **Step 6: Commit the Lua lifecycle behavior**

```powershell
git diff --check
git add -- nvim/lua/janvim_exhibition/init.lua nvim/tests/agent_spec.lua
git diff --cached --check
git commit -m "fix: settle orphaned show backend"
```

---

### Task 2: Trigger recovery on frontend `exit` and settle only on `close`

**Files:**

- Modify: `apps/controller/src/g2-runtime-adapters.ts:120-126`
- Modify: `apps/controller/src/show-runtime-adapters.ts:1454-1681`
- Modify: `apps/controller/tests/show-runtime-adapters.test.ts:665-681,1047-1055,1432-1436,2362-2411`
- Modify: `tests/recovery.test.ts:697-705,833-835`

**Interfaces:**

- Consumes: Node child-process `exit` followed independently by `close`, the existing
  `ShowRunSession.onFault("janvim-exited")`, and `cleanupHeldSession`.
- Produces: `G2SpawnedChild.once/off("exit", listener)` plus independent test-harness operations
  `emitJanVimExit(childIndex)` and `emitJanVimClose(childIndex)`.
- Keeps: the existing `childExit` promise as full `close` settlement, bounded stream finalization,
  and lease removal.

- [ ] **Step 1: Split the fake frontend events without touching production code**

In `createStartupHarness`, make `FakeChild.kill()` emit both real events in order:

```ts
queueMicrotask(() => {
  this.emit("exit", 1, null);
  this.emit("close", 1);
});
```

The successful fake HWND-close branch performs the same ordered pair on its exact
`matchingChild`; it does not emit against the initial child unconditionally.

Change the harness fault helpers to:

```ts
emitJanVimExit: (childIndex = children.length - 1) => {
  const target = children[childIndex];
  if (target === undefined) throw new Error("JanVim child fixture is missing");
  target.emit("exit", 1, null);
},
emitJanVimClose: (childIndex = children.length - 1) => {
  const target = children[childIndex];
  if (target === undefined) throw new Error("JanVim child fixture is missing");
  target.emit("close", 1);
},
```

Delete a fake PID from `activeChildPids` on its first `exit`, while retaining stream/lease cleanup
on `close`. Update the composed fixture in `tests/recovery.test.ts` to emit `exit` before `close`
for its normal fake kill and HWND-close paths.

- [ ] **Step 2: Add the failing delayed-`close` recovery test**

Replace the existing full-replacement test with the stricter name
`invalidates on frontend exit but waits for backend close before replacement`. Use
`createStartupHarness({ closeChildOnWindowClose: false })`, boot and start, then:

```ts
harness.emitJanVimExit(0);
await settlePromises();

expect(coordinator.diagnostics()).toMatchObject({
  state: "black-recovering",
  generationId: 2,
  currentLoopId: null,
});
expect(harness.spawnInvocationCount()).toBe(1);
expect(harness.trace).toContain("agent:shutdown");

harness.emitJanVimClose(0);
await settlePromises();
expect(harness.timers.activeTimeouts(1_000)).toBe(1);
expect(harness.spawnInvocationCount()).toBe(1);

await harness.timers.fireTimeout(1_000);
await settlePromises();
expect(harness.spawnInvocationCount()).toBe(2);
expect(coordinator.diagnostics()).toMatchObject({ state: "running", generationId: 2 });
```

Retain the existing literal order assertions: old lease removal precedes new bridge listen, which
precedes new spawn, placement, lease write, and original-poem prepare. Retain the maximum active
resource assertion of one child, bridge, HWND, and lease.

- [ ] **Step 3: Run the focused TypeScript test and verify the RED failure**

Run:

```powershell
npm test -- apps/controller/tests/show-runtime-adapters.test.ts
```

Expected: the new test fails immediately after `emitJanVimExit(0)` because the current runtime has
no `exit` listener and remains `running` generation 1. A TypeScript fixture error is not an
acceptable RED result.

- [ ] **Step 4: Extend the exact spawned-child interface**

Add these overloads to `G2SpawnedChild` while retaining the existing `close` overloads:

```ts
once(
  event: "exit",
  listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void,
): this;
off(
  event: "exit",
  listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void,
): this;
```

Do not broaden the adapter to arbitrary event names.

- [ ] **Step 5: Separate frontend exit observation from full close settlement**

Add `private childExited = false` to `RuntimeShowSession` and one private idempotent method:

```ts
private observeChildExit(): void {
  if (this.childExited) return;
  this.childExited = true;
  if (!this.shutdownRequested) {
    for (const listener of [...this.faultListeners]) listener("janvim-exited");
  }
}
```

Immediately after publishing `this.child`, register:

```ts
child.once("exit", () => this.observeChildExit());
child.once("close", () => {
  this.observeChildExit();
  if (this.childClosed) return;
  this.childClosed = true;
  this.detachChildStreams?.();
  this.detachChildStreams = undefined;
  this.finishChildStreams?.();
  this.finishChildStreams = undefined;
  this.resolveChildExit();
  this.beginLeaseRemoval();
});
```

The `close` fallback covers conforming adapters that coalesce event delivery, but idempotency
prevents a second fault. Do not resolve `childExit`, finalize streams, or remove the lease from the
`exit` handler.

- [ ] **Step 6: Run focused and composed recovery tests**

Run:

```powershell
npm test -- apps/controller/tests/show-runtime-adapters.test.ts tests/recovery.test.ts
npm run typecheck
```

Expected: both test files and typecheck pass with no warning. Confirm the delayed-`close` test would
fail if either the `exit` listener or the `close` settlement guard were removed.

- [ ] **Step 7: Commit the controller lifecycle behavior**

```powershell
git diff --check
git add -- apps/controller/src/g2-runtime-adapters.ts `
  apps/controller/src/show-runtime-adapters.ts `
  apps/controller/tests/show-runtime-adapters.test.ts `
  tests/recovery.test.ts
git diff --cached --check
git commit -m "fix: recover on JanVim frontend exit"
```

---

### Task 3: Synchronize the show-only runtime and run every automated gate

**Files:**

- Source: `nvim/lua/janvim_exhibition/init.lua`
- Mechanical ignored copy:
  `runtime/user-root/plugin-lab/local/janvim-exhibition/lua/janvim_exhibition/init.lua`
- Verify only: all repository tests/build outputs and `janvim-artifact.lock.json`

**Interfaces:**

- Consumes: committed Tasks 1 and 2.
- Produces: a prepared runtime whose show-only Lua bytes match committed source while the immutable
  `janvim-core.exe` SHA-256 remains
  `224b3457d89fbc6cf946359683632f29f9262bae08b6f0d2e3043a3a7a6d83b3`.

- [ ] **Step 1: Synchronize only the reviewed Lua file**

```powershell
$source = '.\nvim\lua\janvim_exhibition\init.lua'
$target = '.\runtime\user-root\plugin-lab\local\janvim-exhibition\lua\janvim_exhibition\init.lua'
Copy-Item -LiteralPath $source -Destination $target -Force

$sourceHash = (Get-FileHash -Algorithm SHA256 $source).Hash.ToLowerInvariant()
$targetHash = (Get-FileHash -Algorithm SHA256 $target).Hash.ToLowerInvariant()
if ($sourceHash -cne $targetHash) { throw 'prepared-agent-copy-mismatch' }
"agent source/runtime sha256: $sourceHash"
```

Do not copy any JanVim product source, user configuration, poem, media, or whole directory.

- [ ] **Step 2: Verify the immutable runtime boundary**

```powershell
pwsh -NoProfile -File .\scripts\verify-runtime.ps1
$coreHash = (Get-FileHash -Algorithm SHA256 `
  '.\runtime\janvim\janvim-core.exe').Hash.ToLowerInvariant()
if ($coreHash -cne '224b3457d89fbc6cf946359683632f29f9262bae08b6f0d2e3043a3a7a6d83b3') {
  throw 'immutable-janvim-core-hash-changed'
}
```

Expected: runtime verification exits 0 and the core hash remains exact.

- [ ] **Step 3: Run the complete repository gates**

```powershell
npm ci
npm run typecheck
npm run lint
npm test
npm run build
pwsh -NoProfile -File .\scripts\run-lua-tests.ps1
pwsh -NoProfile -File .\scripts\verify-runtime.ps1
git diff --check
git status --short --branch
```

Expected: all commands exit 0; the tracked worktree is clean after the two implementation commits;
the ignored prepared runtime copy is byte-identical to committed Lua source.

- [ ] **Step 4: Request an independent code review**

Invoke `superpowers:requesting-code-review`. Give the reviewer the approved design, this plan, the
failed rehearsal evidence summary, both implementation commits, and exact gate output. Require
explicit Critical/Important/Minor findings and a merge-readiness verdict. Apply any accepted finding
through `superpowers:receiving-code-review`, with a new RED test before every behavior change.

---

### Task 4: Repeat the JanVim fault subgate with fresh offline evidence

**Files:**

- External evidence only: the exact fresh roots assigned to `$showId` and `$validateId` in Step 1
  beneath `D:\VirtualData\JanVim-Exhibition-Rehearsals`
- Read only: `docs/operations/rehearsal-runbook.md`, block `fault-janvim`

**Interfaces:**

- Consumes: clean reviewed build, confirmed display IDs `1502331611` (primary) and `3192275084`
  (secondary), and the unchanged exact-identity fault block.
- Produces: fresh ValidateOnly receipt, Show terminal/evidence records, one bounded JanVim recovery,
  and explicit human observations. It does not modify tracked files.

- [ ] **Step 1: Create separate fresh Show and connected-validation roots**

```powershell
$repo = 'D:\github\JanVim-Exhibition-2026\.worktrees\task1'
$parent = 'D:\VirtualData\JanVim-Exhibition-Rehearsals'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$showId = "g3-janvim-fault-$stamp"
$validateId = "$showId-validate"

foreach ($id in @($showId, $validateId)) {
  $root = Join-Path $parent $id
  $map = Join-Path $root 'display-map.json'
  pwsh -NoProfile -File "$repo\scripts\start-g2-rehearsal.ps1" `
    -Mode Capture -RehearsalRoot $root -DisplayMapPath $map
  if ($LASTEXITCODE -ne 0) { throw "display-capture-failed:$id" }
  pwsh -NoProfile -File "$repo\scripts\start-g2-rehearsal.ps1" `
    -Mode Confirm -RehearsalRoot $root -DisplayMapPath $map `
    -PrimaryDisplayId '1502331611' -SecondaryDisplayId '3192275084'
  if ($LASTEXITCODE -ne 0) { throw "display-confirm-failed:$id" }
}

"Show run ID: $showId"
"Validate run ID: $validateId"
```

- [ ] **Step 2: Run connected diagnostic validation only**

```powershell
$validateRoot = Join-Path $parent $validateId
$validateMap = Join-Path $validateRoot 'display-map.json'
$validateReceipt = Join-Path $parent "$validateId.launcher-output.log"
pwsh -NoProfile -File "$repo\scripts\start-show.ps1" `
  -Mode ValidateOnly -RehearsalRoot $validateRoot -DisplayMapPath $validateMap `
  -RunId $validateId -NetworkPolicy DiagnosticConnected 2>&1 |
  Tee-Object -FilePath $validateReceipt
if ($LASTEXITCODE -ne 0) { throw 'connected-validation-failed' }
```

Expected: one schema-1 ValidateOnly receipt with `exitCode: 0`. Do not use this diagnostic root for
Show.

- [ ] **Step 3: Preload the exact runbook block while connected**

In operator window B, retain the exact `$showId` printed by Step 1 and run:

```powershell
$repo = 'D:\github\JanVim-Exhibition-2026\.worktrees\task1'
$parent = 'D:\VirtualData\JanVim-Exhibition-Rehearsals'
$runId = $showId
$root = Join-Path $parent $runId
$runbook = Join-Path $repo 'docs\operations\rehearsal-runbook.md'
$expectedRunbookHash = '042e1ccfd521176ecadeb490036054c5b0a2da34033872d3a36ca3470e372d9c'

$actualRunbookHash =
  (Get-FileHash -Algorithm SHA256 $runbook).Hash.ToLowerInvariant()
if ($actualRunbookHash -cne $expectedRunbookHash) {
  throw 'runbook-hash-mismatch'
}

$lines = [IO.File]::ReadAllLines($runbook)
$start = [Array]::IndexOf($lines, '# block: fault-janvim')
if ($start -lt 0) { throw 'fault-janvim-marker-missing' }
$end = -1
for ($index = $start + 1; $index -lt $lines.Count; $index += 1) {
  if ($lines[$index] -ceq '```') {
    $end = $index
    break
  }
}
if ($end -lt 0) { throw 'fault-janvim-fence-missing' }

$code = [string]::Join(
  [Environment]::NewLine,
  $lines[$start..($end - 1)]
)
$tokens = $null
$parseErrors = $null
[void][Management.Automation.Language.Parser]::ParseInput(
  $code,
  [ref]$tokens,
  [ref]$parseErrors
)
if ($parseErrors.Count -ne 0) { throw 'fault-janvim-parse-failed' }
if (
  ([regex]::Matches($code, 'Stop-Process\b')).Count -ne 1 -or
  ([regex]::Matches($code, 'Stop-Process\s+-Id\s+\$janvimPid')).Count -ne 1
) {
  throw 'fault-janvim-stop-target-invalid'
}

$faultJanVim = [scriptblock]::Create($code)
'JanVim fault block loaded but not executed.'
```

Do not execute `$faultJanVim` while connected.

- [ ] **Step 4: Disconnect networking and run Show**

In operator window A, after physically disconnecting Wi-Fi/Ethernet:

```powershell
$runId = $showId
$root = Join-Path $parent $runId
$map = Join-Path $root 'display-map.json'
$receipt = Join-Path $parent "$runId.launcher-output.log"
pwsh -NoProfile -File "$repo\scripts\start-show.ps1" `
  -Mode Show -RehearsalRoot $root -DisplayMapPath $map `
  -RunId $runId -NetworkPolicy OfflineRequired 2>&1 |
  Tee-Object -FilePath $receipt
$showExitCode = $LASTEXITCODE
```

Click Start Show once. During the initial prompt and before the first editor write, execute exactly
`& $faultJanVim` in operator window B. Do not close either surface during the recovery interval.

- [ ] **Step 5: Observe one complete recovered loop and stop normally**

Require all of these observations before clicking Stop Show after the recovered loop reset:

- the old JanVim frontend disappears and one replacement window returns;
- the secondary remains artwork-safe with no terminal or desktop exposure;
- the replacement begins with the complete original poem;
- no old-generation text writes back;
- the fresh loop writes once and resets to the original poem without residue.

Reconnect only after operator window A returns.

- [ ] **Step 6: Verify durable evidence and process cleanup**

Parse `controller-terminal.json` and `show-run.json`. Require:

- launcher and terminal success with reason `operator-stop`;
- `offlineVerified: true` and zero online samples;
- at least one completed post-recovery loop;
- exactly one retained `recoveries` entry for domain `janvim`, attempt 1, delay 1000, outcome
  `recovered`, and a generation greater than 1;
- original-poem reset SHA-256
  `b699de273f5bbaedb08241495f52ce863d3e8e1851275ce3b6251484d75190a8`;
- no incident, no run lease, no runtime-count growth, and no process whose creation identity belongs
  to the retry;
- `acceptanceScope: monitor-simulation` and `physicalProjectorsTested: false`.

If any item fails, preserve the root unchanged and return to systematic debugging. If all machine
and human checks pass, mark only the JanVim recovery subgate complete; the independent normal Stop
Show run and G4 remain pending.
