# JanVim Parent-Exit Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect a terminated JanVim frontend before inherited pipes close, clean its show-owned
Neovim backend through the authenticated parameter-free shutdown path, and resume only from a
fully settled original-poem generation.

**Architecture:** `RuntimeShowSession` treats child `exit` as the immediate fault signal and child
`close` as the final process-tree/output settlement signal. The exhibition Lua connection delays
shutdown transport closure until its ACK write completes. It checks only its captured JanVim parent
PID, rechecks live or uncertain results every 100 ms at most 20 times, and performs one fixed
self-exit only after a probe confirms the parent is no longer alive.

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
  `parent_pid: integer`, `parent_alive(pid): boolean | nil`, `schedule(fn): void`, and
  `exit_backend(): void`.
- In production, `parent_pid` is captured once with `uv.os_getppid()`. Liveness is `true` only
  when `uv.kill(pid, 0)` returns `0`, `false` only when its error name is exactly `ESRCH`, and
  `nil` for every other result or thrown probe error. `exit_backend` is the fixed
  `vim.cmd("qall!")` operation.

- [x] **Step 1: Add a failing connection-level test for ACK-before-exit**

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

- [x] **Step 2: Add a failing parent-alive control test**

Add `shutdown keeps a live-parent backend for normal HWND teardown` using the same real connection
path with `parent_alive = function() return true end`. Complete the ACK write and assert the
transport closes exactly once while `exit_count` remains zero. Retain the existing test that
rejects `{ type = "shutdown", command = ":qa!" }` before any close or exit callback.

- [x] **Step 3: Run Lua tests and verify the RED failure**

Run:

```powershell
pwsh -NoProfile -File .\scripts\run-lua-tests.ps1
```

Expected: the orphan test fails because current `close_connection` closes the transport during
dispatch, before the shutdown ACK write callback, and no fixed orphan-backend exit exists. Confirm
all earlier tests reached execution; a Lua syntax/load error is not an acceptable RED result.

- [x] **Step 4: Implement deferred authenticated shutdown in `init.lua`**

Capture and validate the fixed lifecycle dependencies during `M.setup`:

```lua
local parent_pid = options.parent_pid or uv.os_getppid()
assert(type(parent_pid) == "number" and parent_pid % 1 == 0 and parent_pid > 0,
  "JanVim parent PID is required")

local parent_alive = options.parent_alive or function(pid)
  local ok, result, _, error_name = pcall(uv.kill, pid, 0)
  if not ok then return nil end
  if result == 0 then return true end
  if result == nil and error_name == "ESRCH" then return false end
  return nil
end
local schedule = options.schedule or vim.schedule
local exit_backend = options.exit_backend or function()
  vim.cmd("qall!")
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

- [x] **Step 5: Run focused Lua verification and mutation checks**

Run:

```powershell
pwsh -NoProfile -File .\scripts\run-lua-tests.ps1
```

Expected: all Lua tests pass. Mentally verify these mutations are caught: closing during dispatch,
exiting while the parent is alive, exiting twice, treating a failed liveness check as dead, and
accepting a user-provided shutdown command.

- [x] **Step 6: Commit the Lua lifecycle behavior**

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

- [x] **Step 1: Split the fake frontend events without touching production code**

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

- [x] **Step 2: Add the failing delayed-`close` recovery test**

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

- [x] **Step 3: Run the focused TypeScript test and verify the RED failure**

Run:

```powershell
npm test -- apps/controller/tests/show-runtime-adapters.test.ts
```

Expected: the new test fails immediately after `emitJanVimExit(0)` because the current runtime has
no `exit` listener and remains `running` generation 1. A TypeScript fixture error is not an
acceptable RED result.

- [x] **Step 4: Extend the exact spawned-child interface**

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

- [x] **Step 5: Separate frontend exit observation from full close settlement**

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

- [x] **Step 6: Run focused and composed recovery tests**

Run:

```powershell
npm test -- apps/controller/tests/show-runtime-adapters.test.ts tests/recovery.test.ts
npm run typecheck
```

Expected: both test files and typecheck pass with no warning. Confirm the delayed-`close` test would
fail if either the `exit` listener or the `close` settlement guard were removed.

- [x] **Step 7: Commit the controller lifecycle behavior**

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

- [x] **Step 1: Synchronize only the reviewed Lua file**

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

- [x] **Step 2: Verify the immutable runtime boundary**

```powershell
pwsh -NoProfile -File .\scripts\verify-runtime.ps1
$coreHash = (Get-FileHash -Algorithm SHA256 `
  '.\runtime\janvim\janvim-core.exe').Hash.ToLowerInvariant()
if ($coreHash -cne '224b3457d89fbc6cf946359683632f29f9262bae08b6f0d2e3043a3a7a6d83b3') {
  throw 'immutable-janvim-core-hash-changed'
}
```

Expected: runtime verification exits 0 and the core hash remains exact.

- [x] **Step 3: Run the complete repository gates**

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

- [x] **Step 4: Request an independent code review**

Invoke `superpowers:requesting-code-review`. Give the reviewer the approved design, this plan, the
failed rehearsal evidence summary, both implementation commits, and exact gate output. Require
explicit Critical/Important/Minor findings and a merge-readiness verdict. Apply any accepted finding
through `superpowers:receiving-code-review`, with a new RED test before every behavior change.

---

### Task 3A: Bound the Windows parent-retirement race found by physical fault injection

The fresh run `g3-janvim-fault-20260901-035135` proved that the frontend `exit` and authenticated
shutdown ACK can precede Windows reporting the captured parent PID as absent. The one-shot Lua
probe therefore left the exact Neovim backend alive, correctly blocked child `close`, and produced
`old-session-unsettled` rather than an unsafe replacement. The owner approved this bounded
amendment on 2026-09-01.

- [x] Add deterministic RED tests for live-then-`ESRCH`, duplicate deferred callbacks, exactly 20
  live rechecks, and uncertain/throwing probes that later confirm `ESRCH`.
- [x] Inject `defer(callback, 100)` with production `vim.defer_fn`; start only one probe chain after
  the shutdown ACK, decrement a literal 20-recheck budget, and keep the fixed backend exit
  idempotent.
- [x] Treat only confirmed `alive == false` as permission to exit. Every other result consumes one
  finite recheck and exhaustion remains fail-closed.
- [x] Synchronize only `nvim/lua/janvim_exhibition/init.lua` to the ignored prepared runtime, rerun
  all repository gates, request independent review, and repeat Task 4 from new external roots.

---

### Task 3B: Correct the fixed Neovim backend-exit command found by the repeated fault rehearsal

The fresh offline run `g3-janvim-fault-20260901-045910` again reached recovery but retained its
Neovim backend and failed with `old-session-unsettled`. A real-Neovim minimal reproduction proved
that the plan-prescribed `qaall!` text is not an Ex command (`E492`). The surrounding `pcall`
correctly prevented an uncontrolled Lua exception, but also made the misspelling visible only as a
backend that never exited. The valid hard-coded command is `qall!`.

- [x] Add a deterministic RED test that uses the production default `exit_backend`, captures its
  exact `vim.cmd` argument, and requires literal `qall!` after confirmed parent absence.
- [x] Change only the hard-coded default command from `qaall!` to `qall!`; retain ACK ordering,
  parent proof, finite rechecks, one-shot scheduling, and parameter-free protocol behavior.
- [x] Run the Lua suite and one real headless-Neovim callback proving `qall!` exits with code 0;
  synchronize the prepared runtime and invalidate its generated Lua bytecode cache before the next
  rehearsal.
- [x] Rerun all repository gates, request independent review, and repeat Task 4 once from fresh
  external evidence roots after the operator is available.

---

### Task 3C: Correct the operator JanVim HWND identity proof

**Files:**

- Modify: `.gitattributes`
- Modify: `docs/operations/rehearsal-runbook.md`
- Modify: `tests/recovery.test.ts`

The fresh offline run `g3-janvim-fault-20260901-122615` reached the exact JanVim fault block but
failed closed with `janvim-hwnd-identity-mismatch`. All prior PID, creation-time, path, byte-size,
and SHA-256 checks passed. The later normal Stop Show succeeded with `hwndClose: posted`,
`janvimExit: natural`, and `leaseRemoved: true`, proving the leased HWND remained live and owned
through shutdown. The fault block had selected a second window via `Process.MainWindowHandle`,
despite the established placement rule that filters JanVim's zero-area helper window.

- [x] Add a behavioral RED test that executes the real runbook block with two windows owned by one
  exact PID: a helper exposed as `MainWindowHandle` and a distinct valid leased HWND. Require the
  deliberate stop to target the leased window owner; confirm the old block fails with
  `janvim-hwnd-identity-mismatch` and stops no PID.
- [x] Replace only the `MainWindowHandle` comparison with direct Win32 `IsWindow` and
  `GetWindowThreadProcessId` proof for the lease HWND. Retain every process, creation-time, path,
  byte-size, hash, and single exact-PID stop check, and keep all mismatches fail closed before
  `Stop-Process`.
- [x] Confirm the same behavioral test is GREEN and stops only the expected exact JanVim PID.
- [x] Pin the byte-hashed runbook to LF; require a fresh interop type before `Add-Type`, its presence
  afterward, the complete reviewed source, and the exact Win32 invocation topology parsed from the
  real block AST. Prove a destroyed HWND, a live HWND owned by another PID, and a preloaded
  same-name type all fail closed without recording a stop.
- [x] Run all repository gates, request independent review, and update the pinned runbook SHA-256.
- [x] Repeat Task 4 from new external evidence roots.

---

### Task 3D: Harden the controller's cold offline network snapshot

**Files:**

- Modify: `apps/controller/src/show-runtime-adapters.ts`
- Modify: `apps/controller/tests/show-runtime-adapters.test.ts`
- Modify: `scripts/start-show.ps1`
- Modify: `tests/electron-build-smoke.test.ts`
- Modify: `docs/superpowers/specs/2026-09-01-janvim-parent-exit-recovery-design.md`

The fresh offline attempt `g3-p0-final-20260901-162225-fault` exited with code 70 before either
show surface appeared and before the operator fault action ran. Its controller log records
`network-snapshot-failed` during startup cleanup. The launcher's hardened five-second network
snapshot had already passed, while the controller still relied on module auto-loading inside a
two-second child-process bound.

- [x] Add a RED adapter contract requiring the controller snapshot to load `NetTCPIP` and
  `NetConnection` explicitly, suppress non-data streams, use strict mode, and retain a finite
  five-second child-process bound. Confirm the old implementation fails on its two-second bound.
- [x] Align only the controller snapshot preamble and timeout with the already proven launcher
  sampler; retain route/profile caps, output caps, exact offline classification, and fail-closed
  behavior.
- [x] Rebuild the Electron main bundle and advance the launcher's reviewed byte-size/SHA-256 pair
  to that exact build; retain the smoke test that rejects every other bundle identity.
- [x] Run all repository gates, request independent review, and repeat Task 4 from an entirely new
  set of external evidence roots. Preserve the failed root and do not reuse its paired normal root.

---

### Task 4: Repeat the JanVim fault subgate with fresh offline evidence

**Files:**

- External evidence only: the exact fresh roots assigned to `$showId` and `$validateId` in Step 1
  beneath `D:\VirtualData\JanVim-Exhibition-Rehearsals`
- Read only: `docs/operations/rehearsal-runbook.md`, block `fault-janvim`

**Interfaces:**

- Consumes: clean reviewed build, confirmed display IDs `1502331611` (primary) and `3192275084`
  (secondary), and the reviewed exact-identity fault block.
- Produces: fresh ValidateOnly receipt, Show terminal/evidence records, one bounded JanVim recovery,
  and explicit human observations. It does not modify tracked files.

- [x] **Step 1: Create separate fresh Show and connected-validation roots**

  The accepted run used the frozen handoff
  `D:\VirtualData\JanVim-Exhibition-Rehearsals\_g3-p0-final-offline-current.json`. The handoff names
  the fixed Show ID `g3-p0-final-offline-20260902-013534-fault`, its separate validation ID, the
  exact display map, receipt paths, and reviewed hashes. Operator windows must each read this same
  handoff; PowerShell variables such as `$showId` are never assumed to cross window boundaries.

- [x] **Step 2: Run connected diagnostic validation only**

  `g3-p0-final-offline-20260902-013534-validate` returned one schema-1 receipt with `exitCode: 0`.
  The current Windows display geometry was frozen separately from all failed and prior rehearsal
  roots.

- [x] **Step 3: Validate the exact runbook fault wrapper while connected**

  The frozen fault wrapper parsed without errors, required runbook SHA-256
  `8a9e5f7b70a2bf473bf787353d65c7353ef4dbdaec70c814b2e67d619d8c2a17`, required exactly one
  `Stop-Process -Id $janvimPid`, and failed closed with `offline-show-lease-not-ready` before the Show
  lease existed. The wrapper reads its Run ID and roots from the handoff rather than session state.

- [x] **Step 4: Disconnect networking, inject the exact JanVim fault, and stop normally**

  The launch wrapper rejected a connected preflight without creating a receipt or consuming the
  fresh root. With Wi-Fi, Ethernet, and tunnel routes disconnected, the operator started Show,
  injected the exact-identity JanVim fault during the initial prompt, observed recovery, and stopped
  through the local control surface. Window A returned `OFFLINE_SHOW_EXIT_CODE:0`.

- [x] **Step 5: Confirm one complete recovered loop by human observation**

  The operator explicitly confirmed all four required observations on 2026-09-02:

  - exactly one replacement JanVim window returned;
  - the secondary remained an artwork-safe surface with no terminal or desktop exposure;
  - the replacement began from the complete original poem;
  - one write-back completed and reset without residual generated text.

- [x] **Step 6: Verify durable evidence and process cleanup**

  The frozen verifier returned `outcome: pass` for
  `g3-p0-final-offline-20260902-013534-fault`: two completed post-recovery loops, recovery generation
  2, four offline samples, zero online samples, and reset SHA-256
  `b699de273f5bbaedb08241495f52ce863d3e8e1851275ce3b6251484d75190a8`. It also proved terminal
  reason `operator-stop`, exactly one JanVim recovery at attempt 1 after 1000 ms, no incident, no run
  lease, no runtime-count growth, no owned process residue, `acceptanceScope: monitor-simulation`,
  and `physicalProjectorsTested: false`.

The parent-exit recovery plan and the dual-monitor P0 acceptance are complete. The original G4
physical-projector rehearsal remains a separate display-hardware activity and is intentionally not
claimed by this monitor-simulation evidence.
