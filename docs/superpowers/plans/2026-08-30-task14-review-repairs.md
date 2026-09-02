# Task 14 Whole-Diff Review Repairs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all thirteen blocking findings from the complete Task 9 implementation review so automated gates and the operator-paused G3 monitor checkpoint can resume without weakening deterministic, offline, bounded, or fail-closed behavior.

**Architecture:** Preserve the existing Task 9 state machine and adapters while tightening publication, generation ownership, transactional construction, fake-clock deadlines, evidence acceptance, frozen launch identity, and operator contracts. Each task starts from a focused failing test, makes the smallest owning-module change, receives an independent scoped review, and commits independently; the original Task 14 gate remains the only path to G3.

**Tech Stack:** TypeScript 5.9, Node.js 22.23.0, Vitest 3, Electron 38, PowerShell 7, Zod, Windows file/process APIs.

**Spec:** `docs/specs/2026-08-28-dual-projector-generative-performance-design.md` and `docs/superpowers/plans/2026-08-29-task9-recovery-offline-soak.md`

## Global Constraints

- Execute only in `D:\github\JanVim-Exhibition-2026\.worktrees\task1` on branch `feat/task1-workflow`; repair base is `38d3f9d098d18bad5eaa35087c2321c374664229`.
- Never modify the JanVim product repository, its `.nvimlog`, the three protected incident directories, user Neovim configuration, source poem, or source media.
- Consume JanVim only as the immutable packaged artifact. Required core identity is 18,866,688 bytes and SHA-256 `224b3457d89fbc6cf946359683632f29f9262bae08b6f0d2e3043a3a7a6d83b3`.
- Required artifact-lock SHA-256 is `4f20b82db6807975799b68a5aea85679e67c75d99dbffe4a71bc5b35fc57b90d`.
- Keep `show/display-map.json` at `mappingStatus: "unconfirmed"`. Do not perform physical display, network, or fault actions in this plan.
- Preserve one controller-owned monotonic clock, exact cue correlation, no global keyboard injection, no coordinate clicking, and no live network generation.
- Every wait, retry, listener set, boundary slot, module graph, event file, log, and cleanup path remains finite.
- Every production behavior change begins with a focused RED test using fake time where time is involved.
- Do not rewrite or squash accepted commits. Each task creates one additive commit with the exact message listed below.
- After every implementation commit, generate the SDD review package and obtain an independent scoped review before starting the next task.
- The rejected recovery-evidence timestamp finding stays rejected. Do not add timestamps or rolling-window fields to `ShowRunEvidenceRecord`.
- Restart Loop remains actionable only in `safe-ready`. Monitor simulation can never satisfy physical-projector G4.

## File Responsibility Map

- `apps/controller/src/show-run-evidence.ts` owns exact Task 9 evidence identity, schema acceptance, and exclusive final publication.
- `apps/controller/src/run-lease.ts` owns exclusive initial lease publication and generation compare-and-swap.
- `apps/secondary-screen/src/scene-controller.ts` owns renderer generation monotonicity and presentation ACK cancellation.
- `apps/controller/src/main.ts` owns exact renderer IPC admission and preserved G2 reset ordering.
- `apps/controller/src/show-run-coordinator.ts` owns state, transactions, deadlines, boundary capacity, recovery invalidation, acceptance propagation, and shutdown.
- `apps/controller/src/show-runtime-adapters.ts` owns real Task 9 secondary/session lifecycle, evidence construction, and immutable runtime inputs.
- `apps/controller/src/g2-runtime-adapters.ts` owns the preserved G2 runtime snapshot boundary.
- `apps/controller/src/bridge-server.ts` owns immediate authenticated-agent disconnect notification.
- `apps/controller/src/run-telemetry.ts` owns monotonic endpoint chronology.
- `apps/controller/src/runtime-adapter-common.ts` owns immutable byte snapshots shared by G2 and Task 9.
- `scripts/verify-electron-module-graph.mjs` owns the bounded canonical emitted module graph.
- `scripts/start-show.ps1` owns read-only offline preflight, held launch claims, exact helper bounds, watchdog durability, and external process exit.
- `docs/operations/rehearsal-runbook.md` owns copy/paste operator procedures; `tests/recovery.test.ts` enforces its structure.

---

### Task 1: Publish evidence and initial leases exclusively

**Review batch:** B1 — Critical

**Files:**
- Modify: `apps/controller/src/show-run-evidence.ts`
- Modify: `apps/controller/tests/show-run-evidence.test.ts`
- Modify: `apps/controller/src/run-lease.ts`
- Modify: `apps/controller/tests/run-lease.test.ts`

**Interfaces:**
- Consumes: strict `ShowRunEvidenceRecord` parsing and strict `RunLease` parsing.
- Produces: unchanged public signatures `writeShowRunEvidenceAtomic(path, value): Promise<void>` and `writeRunLeaseAtomic(path, lease): Promise<void>`, now with exclusive absent-destination publication.

- [ ] **Step 1: Write the raced-destination RED tests**

In both writer test files, intercept the exclusive publication primitive after the fully flushed same-directory temporary file exists, create a competitor destination containing `competitor-bytes`, and require rejection without modifying those bytes:

```ts
await expect(writer(destination, validValue)).rejects.toThrow(/already-exists|exclusive/i);
expect(readFileSync(destination, "utf8")).toBe("competitor-bytes");
expect(readdirSync(root).sort()).toEqual(["destination.json"]);
```

For the lease test, keep the named-pipe lock cooperative but create the competitor outside that lock. Assert only one initial writer can publish and the losing writer removes only its own temporary path. Replace the existing mock that treats all hard-linked destinations as permanently unreplaceable with a real generation replacement assertion after the initial temporary link has been removed.

- [ ] **Step 2: Run the focused tests and capture RED**

```powershell
npm test -- apps/controller/tests/show-run-evidence.test.ts apps/controller/tests/run-lease.test.ts
```

Expected: the evidence or lease race overwrites `competitor-bytes`, or the test proves the current check-then-rename sequence has no exclusive final operation.

- [ ] **Step 3: Implement exclusive publication from a flushed same-directory temporary file**

Use a hard-link create as the absent-destination primitive. Map `EEXIST` to the existing writer-specific already-exists error, unlink the caller-owned temporary name after the destination link exists, and never remove the destination in cleanup:

```ts
async function publishTemporaryExclusively(
  temporaryPath: string,
  destinationPath: string,
): Promise<void> {
  try {
    await fs.link(temporaryPath, destinationPath);
  } catch (error) {
    if (hasErrorCode(error, "EEXIST")) {
      throw new Error("run-lease-already-exists");
    }
    throw error;
  }
  await fs.rm(temporaryPath);
}
```

Use the synchronous equivalent in `show-run-evidence.ts`. Keep `replaceRunLeaseGenerationAtomic` as a separate complete-generation compare-and-swap path; do not make an initial hard link survive as an extra filename.

- [ ] **Step 4: Run focused GREEN and publication regressions**

```powershell
npm test -- apps/controller/tests/show-run-evidence.test.ts apps/controller/tests/run-lease.test.ts
npm run typecheck
git diff --check
```

Expected: all tests pass; each successful directory contains only the final file; raced competitor bytes are unchanged.

- [ ] **Step 5: Commit Task 1**

```powershell
git add apps/controller/src/show-run-evidence.ts apps/controller/tests/show-run-evidence.test.ts apps/controller/src/run-lease.ts apps/controller/tests/run-lease.test.ts
git commit -m "fix: publish show identity files exclusively"
```

---

### Task 2: Bind secondary events to the live generation and renderer

**Review batch:** B2 — Critical

**Files:**
- Modify: `apps/secondary-screen/src/scene-controller.ts`
- Modify: `apps/secondary-screen/tests/scene-controller.test.ts`
- Modify: `apps/controller/src/main.ts`
- Modify: `apps/controller/tests/controller-main.test.ts`
- Modify: `apps/controller/src/show-runtime-adapters.ts`
- Modify: `apps/controller/tests/show-runtime-adapters.test.ts`

**Interfaces:**
- Consumes: `RunStatusEvent.generationId`, `RunCueEvent.generationId`, and Electron IPC event sender.
- Produces: optional exact-sender argument on `bindLocalRendererEvents`; Task 9 passes the current `webContents` while G2 retains its existing local-URL behavior.

- [ ] **Step 1: Write renderer generation RED tests**

Drive generation 1 through the first animation frame, advance with a generation 2 status, then flush all frames and send a late generation 1 prompt:

```ts
controller.applyEvent(runCue(1, "loop-1", promptCue, true));
frames.runNext();
controller.applyEvent(runStatus(2, "black-recovering"));
frames.runAll();
controller.applyEvent(runCue(1, "loop-1", stalePrompt, false));
expect(rendererEvents.filter((event) => event.type === "presentation-ack")).toEqual([]);
expect(root.textContent).not.toContain("stale generation text");
```

Also assert a first valid generation 2 cue is rendered and ACKed after two frames.

- [ ] **Step 2: Write exact-sender and exhaustive-disposal RED tests**

Register two fake `webContents` values with the same local URL. Require Start, Stop, and presentation ACK from the old sender to be rejected after replacement, while the current sender is accepted. Inject a throw from each first cleanup hook in separate cases and assert close-listener removal, IPC removal, web-guard disposal, event-set clearing, and window close are each attempted exactly once.

- [ ] **Step 3: Run focused tests and capture RED**

```powershell
npm test -- apps/secondary-screen/tests/scene-controller.test.ts apps/controller/tests/controller-main.test.ts apps/controller/tests/show-runtime-adapters.test.ts
```

Expected: a stale ACK or DOM mutation occurs, same-URL old sender is admitted, or cleanup stops after the first exception.

- [ ] **Step 4: Implement monotonic generation ownership and exact sender admission**

Add `activeGenerationId` to `SecondarySceneController`. For Task 9 status/cue events, reject lower generations before any DOM change; when a higher generation arrives, cancel both pending frame handles before adopting it. Capture the adopted generation in `schedulePresentationAck` and recheck it on both frame callbacks.

Extend the local IPC event shape and binding without weakening URL checks:

```ts
export interface LocalStartIpcEvent {
  sender?: unknown;
  senderFrame: { url: string } | null;
}

export function bindLocalRendererEvents(
  ipcMain: IpcMainAdapter,
  readyPageUrl: string,
  onEvent: (event: RendererToControllerEvent) => void,
  expectedSender?: unknown,
): () => void;
```

When `expectedSender` is present, require identity equality with `event.sender`. Pass `window.webContents` from `openShowSecondary`. Implement cleanup as a fixed list of guarded actions, remember the first error, execute every action once, then rethrow the first error.

- [ ] **Step 5: Run focused GREEN and G2 regressions**

```powershell
npm test -- apps/secondary-screen/tests/scene-controller.test.ts apps/controller/tests/controller-main.test.ts apps/controller/tests/show-runtime-adapters.test.ts apps/controller/tests/g2-runtime-adapters.test.ts tests/first-loop.test.ts
npm run typecheck
git diff --check
```

- [ ] **Step 6: Commit Task 2**

```powershell
git add apps/secondary-screen/src/scene-controller.ts apps/secondary-screen/tests/scene-controller.test.ts apps/controller/src/main.ts apps/controller/tests/controller-main.test.ts apps/controller/src/show-runtime-adapters.ts apps/controller/tests/show-runtime-adapters.test.ts
git commit -m "fix: bind secondary events to the live generation"
```

---

### Task 3: Restore primary-ACK-first G2 reset order

**Review batch:** B3 — Important

**Files:**
- Modify: `apps/controller/src/main.ts`
- Modify: `apps/controller/tests/controller-main.test.ts`
- Modify: `tests/first-loop.test.ts`

**Interfaces:**
- Consumes: the existing `DeterministicShowLoop` reset cue and strict JanVim reset ACK.
- Produces: unchanged public loop interface with primary ACK before secondary reset/render and next-loop readiness.

- [ ] **Step 1: Write reset-order RED tests**

Use a deferred JanVim reset dispatch and record the trace:

```ts
const advance = loop.advance();
expect(trace).toEqual(["agent:reset"]);
resetAck.resolve(validOriginalPoemAck);
await advance;
expect(trace).toEqual(["agent:reset", "renderer:reset", "next-loop-ready"]);
```

In the failure case, reject the dispatch or return a wrong poem hash and assert `renderer:reset` and `next-loop-ready` never occur and the loop enters safe black.

- [ ] **Step 2: Run the reset tests and capture RED**

```powershell
npm test -- apps/controller/tests/controller-main.test.ts tests/first-loop.test.ts
```

Expected: `renderer:reset` occurs before the deferred primary ACK or still occurs after a failed ACK.

- [ ] **Step 3: Move secondary reset after strict ACK validation**

In `DeterministicShowLoop.applyReset`, dispatch and validate the primary reset first. Call `renderer.apply(cue)` only after outcome, loop ID, cue ID, and original poem hash all pass. Rotate/start the next loop only after that renderer call.

- [ ] **Step 4: Run focused GREEN and Task 9 loop regressions**

```powershell
npm test -- apps/controller/tests/controller-main.test.ts tests/first-loop.test.ts apps/controller/tests/show-run-coordinator.test.ts apps/controller/tests/show-runtime-adapters.test.ts
npm run typecheck
git diff --check
```

- [ ] **Step 5: Commit Task 3**

```powershell
git add apps/controller/src/main.ts apps/controller/tests/controller-main.test.ts tests/first-loop.test.ts
git commit -m "fix: preserve G2 reset acknowledgement order"
```

---

### Task 4: Make coordinator logging nonthrowing

**Review batch:** B4 — Important

**Files:**
- Modify: `apps/controller/src/show-run-coordinator.ts`
- Modify: `apps/controller/tests/show-run-coordinator.test.ts`

**Interfaces:**
- Consumes: `ShowRunCoordinatorDependencies.log(event): void`.
- Produces: one internal nonthrowing `log(event): void` boundary; no state-machine action depends on log success.

- [ ] **Step 1: Write throwing-logger RED matrix**

Run the same scenario with a normal logger and a logger that throws on every call. Cover invalid renderer input, startup failure cleanup, generation invalidation, recovery delay/outcome, and shutdown phase/failure. Assert identical terminal result, state, generation, cleanup trace, and zero timers:

```ts
const baseline = await runSafetyScenario(() => undefined);
const throwing = await runSafetyScenario(() => {
  throw new Error("fixture logger failure");
});
expect(throwing.result).toEqual(baseline.result);
expect(throwing.safetyTrace).toEqual(baseline.safetyTrace);
expect(throwing.diagnostics.counts.timers).toBe(0);
```

- [ ] **Step 2: Run coordinator tests and capture RED**

```powershell
npm test -- apps/controller/tests/show-run-coordinator.test.ts
```

Expected: at least one direct `dependencies.log` call interrupts invalidation, startup cleanup, or recovery.

- [ ] **Step 3: Route every log through one guarded method**

Add:

```ts
private log(event: Record<string, unknown>): void {
  try {
    this.dependencies.log(event);
  } catch {
    // Logging is diagnostic; coordinator safety remains authoritative.
  }
}
```

Replace every direct coordinator call to `dependencies.log` with `this.log`. Keep bounded reason buckets and failure classifications unchanged.

- [ ] **Step 4: Run focused GREEN**

```powershell
npm test -- apps/controller/tests/show-run-coordinator.test.ts tests/recovery.test.ts
npm run typecheck
git diff --check
```

- [ ] **Step 5: Commit Task 4**

```powershell
git add apps/controller/src/show-run-coordinator.ts apps/controller/tests/show-run-coordinator.test.ts
git commit -m "fix: isolate show safety from logging failures"
```

---

### Task 5: Construct listeners and loops transactionally

**Review batch:** B5 — Important

**Files:**
- Modify: `apps/controller/src/show-run-coordinator.ts`
- Modify: `apps/controller/tests/show-run-coordinator.test.ts`

**Interfaces:**
- Consumes: surface/session listener registration, loop ID factory, telemetry, resource sampler, session runtime, driver factory, and driver start.
- Produces: all-or-nothing listener sets and loop construction; failed construction leaves no active loop, timer, listener, count, or reserved ID.

- [ ] **Step 1: Write listener rollback RED tests**

Make `surface.onEvent` succeed and `surface.onDestroyed` throw; then invert the failing registration for `session.onFault` and `session.onPrimaryCompletion`. Require the earlier disposer to run once and diagnostics to report zero listeners.

```ts
expect(() => bindFixture()).toThrow(/fixture registration failure/i);
expect(firstDisposer).toHaveBeenCalledTimes(1);
expect(coordinator.diagnostics().counts.listeners).toBe(0);
```

- [ ] **Step 2: Write loop-construction rollback RED matrix**

Inject one failure at each stage: `nextLoopId`, `createTelemetry`, `beginLoop`, `createResourceSampler`, `session.createLoop`, `createDriver`, and `driver.start`. For every row require one failed completion, reverse-order cleanup of created resources, zero active timer/listener counts, `currentLoopId: null`, and no increment to `startedLoops` or `completedLoops`.

- [ ] **Step 3: Run focused tests and capture RED**

```powershell
npm test -- apps/controller/tests/show-run-coordinator.test.ts
```

Expected: a partial disposer leaks, `startedLoops` increments, or sampler/driver state survives one injected construction failure.

- [ ] **Step 4: Implement staged construction and reverse rollback**

Register listeners into a local disposer array and publish to the coordinator set only after all registrations succeed. Build loop components into local variables, with rollback actions pushed immediately after each resource becomes live:

```ts
const rollback: Array<() => void | Promise<void>> = [];
try {
  const loopId = this.dependencies.nextLoopId(generationId, loopNumber);
  const telemetry = this.dependencies.createTelemetry();
  telemetry.beginLoop(loopId, this.dependencies.nowMs());
  const sampler = this.dependencies.createResourceSampler();
  rollback.push(() => sampler.finish());
  const runtime = session.createLoop(loopId, telemetrySurface, reserveNextLoopId);
  const driver = this.dependencies.createDriver(driverOptions);
  rollback.push(() => driver.stop());
  // Publish coordinator fields only after construction succeeds.
} catch (error) {
  await runRollbackInReverse(rollback);
  throw error;
}
```

For synchronous entry points, start bounded cleanup without retaining closures and enter the existing terminal-failure path. Increment `startedLoops` only after `driver.start()` returns true.

- [ ] **Step 5: Run focused GREEN and resource regressions**

```powershell
npm test -- apps/controller/tests/show-run-coordinator.test.ts apps/controller/tests/resource-sampler.test.ts apps/controller/tests/multi-loop-driver.test.ts tests/recovery.test.ts
npm run typecheck
git diff --check
```

- [ ] **Step 6: Commit Task 5**

```powershell
git add apps/controller/src/show-run-coordinator.ts apps/controller/tests/show-run-coordinator.test.ts
git commit -m "fix: construct show loops and listeners transactionally"
```

---

### Task 6: Bound coordinator phases and loop-boundary work

**Review batch:** B6 — Critical

**Files:**
- Modify: `apps/controller/src/show-run-coordinator.ts`
- Modify: `apps/controller/tests/show-run-coordinator.test.ts`
- Modify: `apps/controller/tests/resource-sampler.test.ts` only if the focused RED proves sampler settlement cannot be observed through its current public contract.

**Interfaces:**
- Consumes: injected fake timers and every asynchronous dependency promise.
- Produces: coordinator-owned startup, boundary, cleanup, and finalization deadlines; one in-flight boundary operation plus one finite terminal/coalesced slot.

- [ ] **Step 1: Write fake-clock phase-deadline RED matrix**

Return a never-settling promise in turn from validation, startup network sample, secondary open, each held-session cleanup phase, resource finish, shutdown network sample, log flush, evidence finalization, and terminal marker write. Advance only the fake clock past the fixed coordinator deadline. Require `completion` to settle failed, state `stopped`, no late state mutation after resolving the deferred promise, and zero coordinator timers.

```ts
const completion = coordinator.completion;
await clock.fireTimeout(deadlineForPhase(phase));
await expect(completion).resolves.toMatchObject({ ok: false });
expect(coordinator.diagnostics()).toMatchObject({
  state: "stopped",
  counts: { timers: 0 },
});
```

- [ ] **Step 2: Write bounded-boundary RED**

Hold the first resource or network boundary promise, deliver a later boundary callback, then request Stop. Assert there is one boundary failure classification, no additional loop/cue construction, no unbounded promise closure chain, and completion settles after the fake boundary deadline. Expose only a numeric diagnostic such as `pendingBoundaryWork` capped at 1; do not retain raw boundary payload arrays.

- [ ] **Step 3: Run focused tests and capture RED**

```powershell
npm test -- apps/controller/tests/show-run-coordinator.test.ts apps/controller/tests/resource-sampler.test.ts
```

Expected: Stop or completion remains pending, a later boundary queues behind the hung promise, or timer diagnostics stay nonzero.

- [ ] **Step 4: Implement one reusable fake-clock deadline primitive**

Use coordinator timers, an `AbortController` where the dependency accepts a signal, tracked handles, a fixed phase label, and a late-value disposer. Define exact outer bounds: `STARTUP_PHASE_TIMEOUT_MS = 35_000`, `BOUNDARY_PHASE_TIMEOUT_MS = 10_000`, `CLEANUP_PHASE_TIMEOUT_MS = 10_000` per cleanup operation, and `FINALIZATION_PHASE_TIMEOUT_MS = 10_000` per finalization operation:

```ts
private runBoundedPhase<T>(
  phase: string,
  timeoutMs: number,
  action: (signal: AbortSignal) => Promise<T>,
  onLateValue?: (value: T) => void,
): Promise<T>;
```

Apply it outside adapter-provided bounds to startup, held cleanup, boundary resources/network, shutdown sampling/logging/evidence/marker, and waits on captured startup/recovery operations. A timeout records one bounded failure and continues the shutdown ladder.

- [ ] **Step 5: Replace `boundaryQueue` with finite state**

Keep at most `boundaryOperation` and one scalar terminal request. If another boundary arrives while work is in flight, stop the driver, set the single terminal reason `loop-boundary-overlap`, and do not capture the later boundary. On operation settlement or timeout, consume the terminal reason once and clear all references.

- [ ] **Step 6: Run focused GREEN and 100-loop regression**

```powershell
npm test -- apps/controller/tests/show-run-coordinator.test.ts apps/controller/tests/resource-sampler.test.ts apps/controller/tests/multi-loop-driver.test.ts tests/recovery.test.ts
npm run typecheck
git diff --check
```

- [ ] **Step 7: Commit Task 6**

```powershell
git add apps/controller/src/show-run-coordinator.ts apps/controller/tests/show-run-coordinator.test.ts apps/controller/tests/resource-sampler.test.ts
git commit -m "fix: bound coordinator phases and loop boundaries"
```

---

### Task 7: Invalidate failed resources before recovery publication

**Review batch:** B7 — Critical

**Files:**
- Modify: `apps/controller/src/show-run-coordinator.ts`
- Modify: `apps/controller/tests/show-run-coordinator.test.ts`
- Modify: `apps/controller/src/show-runtime-adapters.ts`
- Modify: `apps/controller/tests/show-runtime-adapters.test.ts`
- Modify: `apps/controller/src/bridge-server.ts`
- Modify: `apps/controller/tests/bridge-server.test.ts`
- Modify: `tests/recovery.test.ts`

**Interfaces:**
- Consumes: coordinator generation, abort signals, real secondary/session lifecycle, run-lease generation CAS, and bridge authentication state.
- Produces: `BridgeServer.onAgentDisconnected(listener): () => void` with at most eight listeners; recovery never publishes or starts from a failed/aborted resource generation.

- [ ] **Step 1: Write coordinator fault-state RED tests**

Inject a current-generation secondary or session fault while the coordinator is `booting`, `ready`, `safe-cruise`, and `black-recovering`. Assert the failed surface/session is cleared before any start attempt, no dead resource receives a cue, and every path ends either with a fully prepared fresh `ready/running` generation or a non-actionable cleanup hold.

Hold old-session cleanup and prove `safe-ready` is not sent and Restart Loop is rejected until cleanup settles:

```ts
oldSession.cleanupGate = deferred<void>();
oldSession.emitFault("janvim-exited");
await settlePromises();
expect(statusStates).not.toContain("safe-ready");
expect(coordinator.handleRendererEvent(restartEvent)).toBe(false);
oldSession.cleanupGate.resolve();
await settlePromises();
expect(statusStates.at(-1)).toBe("safe-ready");
```

Exhaust the secondary budget on the fourth loss and assert the destroyed surface is closed/cleared; the subsequent operator restart opens a fresh surface rather than reusing it.

- [ ] **Step 2: Write real-adapter lifecycle RED tests**

Using the existing real Task 9 harness, prove these ordered traces:

- replacement secondary has a distinct `webContents` and renderer PID;
- retained-session lease generation CAS completes before reset dispatch and new loop publication;
- full replacement closes/settles the old child, removes the exact old lease, then creates the new bridge, child, HWND, lease, prepare ACK, and loop;
- no old/new child, bridge, HWND, or lease overlaps;
- a held bridge listen, artifact verification, placement, lease write, or prepare operation released after abort/timeout cannot publish an active late resource;
- if exact child settlement or lease removal is unproven, no replacement launches and the lease remains for operator intervention.

Assert trace ordering directly:

```ts
expect(index("remove-old-lease")).toBeLessThan(index("new-bridge-listen"));
expect(index("replace-lease-generation")).toBeLessThan(index("agent:reset"));
expect(newWindow.webContents).not.toBe(oldWindow.webContents);
expect(activeLeaseCount).toBeLessThanOrEqual(1);
```

- [ ] **Step 3: Write deferred-prepare and idle-disconnect RED tests**

Start `PreparedRuntime` with a deferred `runtime.prepare()`, call `stop()`, resolve preparation true, and require final state `stopped` with no call to `runtime.start()`. Connect/authenticate a real bridge socket without dispatching a command, close it, and require exactly one immediate disconnect callback with zero pending timers/listeners.

- [ ] **Step 4: Run focused tests and capture RED**

```powershell
npm test -- apps/controller/tests/show-run-coordinator.test.ts apps/controller/tests/show-runtime-adapters.test.ts apps/controller/tests/bridge-server.test.ts tests/recovery.test.ts
```

Expected: an out-of-running fault is ignored, `safe-ready` is published before cleanup, a deferred prepare revives stopped state, or an idle authenticated disconnect is invisible until dispatch.

- [ ] **Step 5: Centralize generation invalidation and cleanup-before-actionability**

Add one coordinator path that disarms the operator, increments generation, aborts current work, stops the driver, disposes listeners, clears active loop/reservations, and detaches failed surface/session references before selecting recovery. Expand only the state transitions needed for current-resource failure handling; keep Restart Loop admitted exclusively from fully cleaned `safe-ready`.

Close and clear the old secondary before reserving the next retry. If the budget is exhausted, retain no destroyed surface. Publish a replacement surface/session into coordinator fields only after the bounded phase returns and generation/state checks still pass.

- [ ] **Step 6: Make real adapter publication lifecycle-aware**

Give `RuntimeShowSession` and `PreparedRuntime` a monotonic lifecycle epoch. Every deferred continuation captures the epoch and rechecks active state before changing fields or starting runtime work:

```ts
const epoch = this.lifecycleEpoch;
const prepared = await this.runtime.prepare();
if (this.visibleState === "stopped" || epoch !== this.lifecycleEpoch) return false;
if (!prepared || !this.runtime.start()) {
  this.visibleState = "safe-black";
  return false;
}
```

After an abort that races a host publication, perform exact compensating cleanup before returning and never assign the late object as active. Await lease-generation CAS before reset/publication. Do not remove an unproven lease.

- [ ] **Step 7: Emit authenticated disconnect immediately**

Add `MAX_AGENT_DISCONNECT_LISTENERS = 8` and a bounded listener set to `BridgeServer`; the ninth registration throws before insertion. On cleanup of the current authenticated `agentSocket`, clear the socket, reject pending commands, then notify a snapshot of disconnect listeners once. Clear this set during server close. `RuntimeShowSession` registers one listener after bridge creation and removes it during bridge/session disposal; the callback emits `agent-disconnected` even with zero pending commands.

- [ ] **Step 8: Run focused GREEN and composed recovery regression**

```powershell
npm test -- apps/controller/tests/show-run-coordinator.test.ts apps/controller/tests/show-runtime-adapters.test.ts apps/controller/tests/bridge-server.test.ts tests/recovery.test.ts
npm run typecheck
npm run lint
git diff --check
```

- [ ] **Step 9: Commit Task 7**

```powershell
git add apps/controller/src/show-run-coordinator.ts apps/controller/tests/show-run-coordinator.test.ts apps/controller/src/show-runtime-adapters.ts apps/controller/tests/show-runtime-adapters.test.ts apps/controller/src/bridge-server.ts apps/controller/tests/bridge-server.test.ts tests/recovery.test.ts
git commit -m "fix: invalidate failed show resources before recovery"
```

---

### Task 8: Reject impossible telemetry chronology

**Review batch:** B8 — Important

**Files:**
- Modify: `apps/controller/src/run-telemetry.ts`
- Modify: `apps/controller/tests/run-telemetry.test.ts`

**Interfaces:**
- Consumes: endpoint dispatch/ACK timestamps and `LoopFinishInput.endedAtMs`.
- Produces: `finishLoop` accepts equality with the latest endpoint and rejects any earlier finish.

- [ ] **Step 1: Write endpoint chronology RED**

Record primary and secondary reset endpoints at 3,000 ms. Require a 2,999 ms finish to throw and a 3,000 ms finish to pass. Repeat with a non-reset completion later than both reset endpoints to prove all recorded dispatch/ACK endpoints participate.

```ts
expect(() => telemetry.finishLoop({ ...finishInput(), endedAtMs: 2_999 }))
  .toThrow(/finish|endpoint|chronology/i);
expect(() => equalTelemetry.finishLoop({ ...finishInput(), endedAtMs: 3_000 }))
  .not.toThrow();
```

- [ ] **Step 2: Run telemetry tests and capture RED**

```powershell
npm test -- apps/controller/tests/run-telemetry.test.ts
```

Expected: the 2,999 ms finish is currently accepted.

- [ ] **Step 3: Validate against the latest dispatch or acknowledgement**

During `validateFinish`, compute the maximum of `startedAtMs`, every primary/secondary `dispatchedAtMs`, and every defined `acknowledgedAtMs`. Throw `loop finish precedes recorded endpoint chronology` when `endedAtMs` is lower. Equality is valid.

- [ ] **Step 4: Run focused GREEN**

```powershell
npm test -- apps/controller/tests/run-telemetry.test.ts apps/controller/tests/show-run-coordinator.test.ts tests/recovery.test.ts
npm run typecheck
git diff --check
```

- [ ] **Step 5: Commit Task 8**

```powershell
git add apps/controller/src/run-telemetry.ts apps/controller/tests/run-telemetry.test.ts
git commit -m "fix: reject impossible loop endpoint chronology"
```

---

### Task 9: Bind exact artifact identity and propagate acceptance failure

**Review batch:** B9 — Critical

**Files:**
- Modify: `apps/controller/src/show-run-evidence.ts`
- Modify: `apps/controller/tests/show-run-evidence.test.ts`
- Modify: `apps/controller/src/show-run-coordinator.ts`
- Modify: `apps/controller/tests/show-run-coordinator.test.ts`
- Modify: `apps/controller/src/show-runtime-adapters.ts`
- Modify: `apps/controller/tests/show-runtime-adapters.test.ts`
- Modify: `apps/controller/src/show-electron-command.ts` only if its existing `result.ok ? 0 : 1` mapping needs no signature change beyond coordinator result.
- Modify: `apps/controller/tests/show-electron-command.test.ts`
- Modify: `tests/recovery.test.ts`

**Interfaces:**
- Consumes: exact frozen artifact identity and complete Task 9 acceptance gates.
- Produces: `TASK9_ARTIFACT_IDENTITY` and `EvidenceAcceptance = "pass" | "fail" | "diagnostic"` exported from `show-run-evidence.ts`, plus `finalizeEvidence(...): Promise<EvidenceAcceptance>`.

- [ ] **Step 1: Write exact artifact identity RED tests**

Build otherwise-valid evidence with one changed `lockSha256` and then one changed `coreBytes`. Both must fail parsing:

```ts
expect(() => parseShowRunEvidence({
  ...valid,
  artifact: { ...valid.artifact, lockSha256: "a".repeat(64) },
})).toThrow(/artifact|lock/i);
expect(() => parseShowRunEvidence({
  ...valid,
  artifact: { ...valid.artifact, coreBytes: 18_866_687 },
})).toThrow(/artifact|bytes/i);
```

- [ ] **Step 2: Write acceptance propagation RED matrix**

For each passing gate, make only that gate fail: 250 ms drift, secondary P95 100 ms, instant-primary P95 100 ms, insertion-overhead P95 100 ms, missing measured summary, incomplete/empty per-process resource samples, count growth, shutdown phase failure, lease retained, online sample, and incomplete logging. Require one parseable evidence record with `acceptanceOutcome: "fail"`, coordinator result `{ ok: false, reason: "acceptance-failed" }`, intentional-failure terminal marker, and Electron exit code 1. Keep a valid run passing with exit 0.

For Soak3 termination before three complete loops, require no invalid strict `show-run.json` write attempt, but still require a failed coordinator result, failed terminal marker, and Electron exit 1.

- [ ] **Step 3: Run focused tests and capture RED**

```powershell
npm test -- apps/controller/tests/show-run-evidence.test.ts apps/controller/tests/show-run-coordinator.test.ts apps/controller/tests/show-runtime-adapters.test.ts apps/controller/tests/show-electron-command.test.ts tests/recovery.test.ts
```

Expected: arbitrary lock hash/core size parses, one failed gate throws during evidence parsing instead of preserving failed evidence, or completion remains successful.

- [ ] **Step 4: Export and share the exact Task 9 identity**

Define and freeze:

```ts
export const TASK9_ARTIFACT_IDENTITY = Object.freeze({
  lockSha256: "4f20b82db6807975799b68a5aea85679e67c75d99dbffe4a71bc5b35fc57b90d",
  coreBytes: 18_866_688,
  coreSha256: "224b3457d89fbc6cf946359683632f29f9262bae08b6f0d2e3043a3a7a6d83b3",
});
```

Use literals/refinements in `artifactSchema` and use the same exported identity when Task 9 adapters validate/build evidence. Do not generalize this Task 9-specific parser.

- [ ] **Step 5: Compute all pass gates before parsing and writing**

Extract a pure `evaluateShowAcceptance` that checks every schema pass requirement, including exact mode loop/sample counts, all gated P95 values, complete process resources, stable runtime counts, reset hashes, offline state, shutdown, lease removal, and logging. Build `fail` evidence when any gate fails so the strict parser accepts and preserves it. Return `diagnostic` only for `DiagnosticConnected`.

If Soak3 has fewer than three completed loops, return `fail` without constructing or writing a strict record.

- [ ] **Step 6: Downgrade result before terminal publication**

Change the coordinator dependency:

```ts
export type EvidenceAcceptance = "pass" | "fail" | "diagnostic";
finalizeEvidence(
  result: ShowRunResult,
  diagnostics: CoordinatorDiagnostics,
): Promise<EvidenceAcceptance>;
```

After bounded finalization, turn a requested success plus `fail` into `{ ok: false, reason: "acceptance-failed" }` before writing the terminal marker and resolving completion. A diagnostic result does not claim acceptance but retains the command's intentional exit classification.

- [ ] **Step 7: Run focused GREEN and launcher identity regressions**

```powershell
npm test -- apps/controller/tests/show-run-evidence.test.ts apps/controller/tests/show-run-coordinator.test.ts apps/controller/tests/show-runtime-adapters.test.ts apps/controller/tests/show-electron-command.test.ts tests/recovery.test.ts tests/start-show.test.ts
npm run typecheck
npm run lint
git diff --check
```

- [ ] **Step 8: Commit Task 9**

```powershell
git add apps/controller/src/show-run-evidence.ts apps/controller/tests/show-run-evidence.test.ts apps/controller/src/show-run-coordinator.ts apps/controller/tests/show-run-coordinator.test.ts apps/controller/src/show-runtime-adapters.ts apps/controller/tests/show-runtime-adapters.test.ts apps/controller/src/show-electron-command.ts apps/controller/tests/show-electron-command.test.ts tests/recovery.test.ts
git commit -m "fix: propagate strict show acceptance outcomes"
```

---

### Task 10: Freeze the complete launch graph

**Review batch:** B10 — Important

**Files:**
- Modify: `apps/controller/src/runtime-adapter-common.ts`
- Modify: `apps/controller/tests/runtime-adapter-common.test.ts`
- Modify: `apps/controller/src/g2-runtime-adapters.ts`
- Modify: `apps/controller/tests/g2-runtime-adapters.test.ts`
- Modify: `apps/controller/src/show-runtime-adapters.ts`
- Modify: `apps/controller/tests/show-runtime-adapters.test.ts`
- Modify: `scripts/verify-electron-module-graph.mjs`
- Modify: `tests/electron-build-smoke.test.ts`
- Modify: `scripts/start-show.ps1`
- Modify: `tests/start-show.test.ts`

**Interfaces:**
- Consumes: bounded frozen snapshots, emitted `electron-main.js` imports, and launcher `Open-FrozenInputClaims`.
- Produces: verifier JSON with a bounded canonical local graph manifest; launcher retains read-only claims for every launch-critical file through all watchdog attempts.

- [ ] **Step 1: Write runtime-core snapshot RED tests**

Validate G2 and Task 9, mutate only `runtime\janvim\janvim-core.exe` after validation and before launch/finalization, and require fail-closed `runtime-core-changed-during-run` before spawn or evidence pass. Assert the core snapshot records exact 18,866,688 bytes and approved SHA-256 in production fixtures.

- [ ] **Step 2: Write actual-entry graph RED tests**

In the smoke fixture, make both adapter entries valid but add a nested `.ts` import reachable only from `electron-main.js`. Require verifier failure. Also test graph escape, missing local module, duplicate canonical path, and module count 257.

Require successful output shaped as:

```json
{
  "schema": 1,
  "status": "compiled-electron-main-graph-verified",
  "files": [
    {
      "relativePath": "apps/controller/dist/src/electron-main.js",
      "bytes": 1,
      "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  ]
}
```

The real values differ; tests validate strict shape, canonical sorting, unique paths, bounds, and hashes.

- [ ] **Step 3: Write launcher mutation RED matrix**

Extend the launcher fixture so the fake controller attempts to replace each of these after preflight and between watchdog attempts: Electron executable, `electron-main.js`, one transitive module, graph verifier, runtime verifier, close helper, and `janvim-core.exe`. Require the write to be blocked by a held read claim or detected before relaunch, with no execution of changed bytes.

- [ ] **Step 4: Run focused tests and capture RED**

```powershell
npm test -- apps/controller/tests/runtime-adapter-common.test.ts apps/controller/tests/g2-runtime-adapters.test.ts apps/controller/tests/show-runtime-adapters.test.ts tests/electron-build-smoke.test.ts tests/start-show.test.ts
```

Expected: core mutation is not part of one adapter snapshot, the verifier misses an electron-main-only import, or a launch-critical file remains replaceable during watchdog lifetime.

- [ ] **Step 5: Include core bytes in G2 and Task 9 snapshots**

Add `runtime-core` to the fixed snapshot file list with exact expected size/hash from the parsed strict lock. Ensure both launch and final evidence paths call `assertFrozenSnapshotUnchanged` on a snapshot that includes that file. Preserve immutable copied buffers and the 32-file per-snapshot bound.

- [ ] **Step 6: Traverse and serialize the actual Electron graph**

Start graph traversal at `apps/controller/dist/src/electron-main.js`. Resolve only canonical `.js/.mjs/.cjs` relative imports below the controller dist root, reject TypeScript extensions/escapes/missing files, cap at 256 modules, and emit sorted `relativePath/bytes/sha256` records. Do not dynamically import `electron-main.js`; static verification must not start Electron. Existing safe adapter imports may remain only as a loadability supplement.

- [ ] **Step 7: Hold every launch claim before the watchdog loop**

Snapshot and open read-share-only claims for the graph verifier and runtime verifier before invoking them. Parse the graph manifest strictly, then open claims for Electron executable, Electron command/entry, every transitive graph file, close helper, JanVim core, and existing content/display/config inputs. A changed file between snapshot and claim fails its expected hash. Retain all claims in the existing outer `try/finally` until the launcher exits after success, failure, or retry exhaustion.

- [ ] **Step 8: Run focused GREEN and build**

```powershell
npm test -- apps/controller/tests/runtime-adapter-common.test.ts apps/controller/tests/g2-runtime-adapters.test.ts apps/controller/tests/show-runtime-adapters.test.ts tests/electron-build-smoke.test.ts tests/start-show.test.ts
npm run typecheck
npm run build
git diff --check
```

- [ ] **Step 9: Commit Task 10**

```powershell
git add apps/controller/src/runtime-adapter-common.ts apps/controller/tests/runtime-adapter-common.test.ts apps/controller/src/g2-runtime-adapters.ts apps/controller/tests/g2-runtime-adapters.test.ts apps/controller/src/show-runtime-adapters.ts apps/controller/tests/show-runtime-adapters.test.ts scripts/verify-electron-module-graph.mjs tests/electron-build-smoke.test.ts scripts/start-show.ps1 tests/start-show.test.ts
git commit -m "fix: freeze the complete show launch graph"
```

---

### Task 11: Classify offline default routes exactly

**Review batch:** B11 — Important

**Files:**
- Modify: `scripts/start-show.ps1`
- Modify: `tests/start-show.test.ts`
- Modify: `apps/controller/src/show-runtime-adapters.ts`
- Modify: `apps/controller/tests/show-runtime-adapters.test.ts`

**Interfaces:**
- Consumes: bounded read-only `Get-NetRoute` and `Get-NetConnectionProfile` snapshots.
- Produces: active default-route count based only on exact `0.0.0.0/0` and `::/0` prefixes, never interface aliases.

- [ ] **Step 1: Write route-classification RED matrix**

Use isolated fake NetTCPIP/NetConnection modules to cover:

```ts
const cases = [
  { prefix: "10.0.0.0/8", state: "Alive", blocked: false },
  { prefix: "0.0.0.0/0", state: "Alive", alias: "Loopback Pseudo-Interface 1", blocked: true },
  { prefix: "::/0", state: "Alive", alias: "任意本地化名称", blocked: true },
  { prefix: "0.0.0.0/0", state: "Dead", blocked: false },
] as const;
```

Any connected profile with Subnet, LocalNetwork, or Internet connectivity still fails `OfflineRequired`. `DiagnosticConnected` launches but cannot produce pass acceptance.

- [ ] **Step 2: Run launcher and adapter tests to capture RED**

```powershell
npm test -- tests/start-show.test.ts apps/controller/tests/show-runtime-adapters.test.ts
```

Expected: an alive non-default route fails, an alias-named default route is ignored, or IPv6 default is not counted.

- [ ] **Step 3: Filter exact prefixes without alias trust**

In both bounded PowerShell snapshot scripts, project `State` and `DestinationPrefix`, then count only records whose state is `Alive` and prefix is exactly one of the two default prefixes. Remove every loopback/interface-alias regular expression from route classification. Keep route/profile caps and read-only commands unchanged.

- [ ] **Step 4: Run focused GREEN and source-safety checks**

```powershell
npm test -- tests/start-show.test.ts apps/controller/tests/show-runtime-adapters.test.ts tests/offline-package.test.ts
npm run typecheck
git diff --check
```

- [ ] **Step 5: Commit Task 11**

```powershell
git add scripts/start-show.ps1 tests/start-show.test.ts apps/controller/src/show-runtime-adapters.ts apps/controller/tests/show-runtime-adapters.test.ts
git commit -m "fix: classify offline default routes exactly"
```

---

### Task 12: Enforce the helper deadline and durable watchdog attempts

**Review batch:** B12 — Important

**Files:**
- Modify: `scripts/start-show.ps1`
- Modify: `tests/start-show.test.ts`
- Modify: `tests/window-close-helper.test.ts` only if its fixture needs to expose the launcher's separate helper and child-settlement waits.

**Interfaces:**
- Consumes: exact close helper, 5,000 ms exact-child settlement, and 1,000/2,000/4,000 ms watchdog delays.
- Produces: exact 2,000 ms close-helper deadline and fixed bounded `watchdog-attempts.jsonl` written/flushed before each delay/relaunch.

- [ ] **Step 1: Write close-helper deadline RED**

Make the exact helper sleep for 3,000 ms while the JanVim child remains alive. Require helper timeout classification before natural-child settlement starts, no force action against an unproven identity, retained lease, and incident exit. Keep a separate test where a fast helper is followed by the allowed 5,000 ms child wait.

- [ ] **Step 2: Write durable watchdog RED**

On three unexpected exits followed by a successful fourth invocation, parse `watchdog-attempts.jsonl` and require exactly three ordered records. The next fake controller invocation must observe the preceding record already present, proving flush occurs before delay/relaunch:

```ts
expect(events.map((event) => [event.attempt, event.delayMs])).toEqual([
  [1, 1_000],
  [2, 2_000],
  [3, 4_000],
]);
expect(events.every((event) => event.runId === fixture.runId)).toBe(true);
expect(statSync(fixture.watchdogAttempts).size).toBeLessThanOrEqual(4_096);
```

Also require retry exhaustion to remain finite and reject a pre-existing conflicting event file.

- [ ] **Step 3: Run launcher tests and capture RED**

```powershell
npm test -- tests/start-show.test.ts tests/window-close-helper.test.ts
```

Expected: helper is allowed 5,000 ms or successful retry history exists only in memory.

- [ ] **Step 4: Split helper and settlement constants**

Pass exactly 2,000 ms and 4,096 output bytes to `Invoke-BoundedProcess` for `close-janvim-window.ps1`. Keep `Process.WaitForExit(5000)` as a distinct natural/forced child settlement operation.

- [ ] **Step 5: Persist each retry before sleeping**

Create `watchdog-attempts.jsonl` exclusively only when the first unexpected exit needs a retry. Append at most three strict token-free records containing schema, run ID, failed controller run ID/PID/exit code, attempt, delay, and bounded monotonic observation. Flush the held stream to disk before `Start-Sleep`. Include the path in conflict checks and the outer cleanup, but do not delete it after a later success.

- [ ] **Step 6: Run focused GREEN**

```powershell
npm test -- tests/start-show.test.ts tests/window-close-helper.test.ts tests/g2-launcher.test.ts tests/offline-package.test.ts
git diff --check
```

- [ ] **Step 7: Commit Task 12**

```powershell
git add scripts/start-show.ps1 tests/start-show.test.ts tests/window-close-helper.test.ts
git commit -m "fix: record bounded watchdog attempts before relaunch"
```

---

### Task 13: Make the operator command contract executable

**Review batch:** B13 — Important

**Files:**
- Modify: `docs/operations/rehearsal-runbook.md`
- Modify: `tests/recovery.test.ts`

**Interfaces:**
- Consumes: public `start-g2-rehearsal.ps1` and `start-show.ps1` parameter contracts plus token-free exact process evidence.
- Produces: copy/paste PowerShell blocks for Capture, Confirm, ValidateOnly, Soak3, Show, secondary fault, JanVim fault, and controller fault; no raw internal Electron flags.

- [ ] **Step 1: Write command-block RED contract tests**

Parse fenced `powershell` blocks by runbook section. Require complete public invocations:

```ts
expect(command("Display Capture and Confirmation", "capture")).toContain(
  "start-g2-rehearsal.ps1 -Mode Capture -RehearsalRoot $root -DisplayMapPath $map",
);
expect(command("Display Capture and Confirmation", "confirm")).toMatch(
  /-Mode Confirm .* -PrimaryDisplayId \$primaryDisplayId .* -SecondaryDisplayId \$secondaryDisplayId/u,
);
for (const mode of ["ValidateOnly", "Soak3", "Show"]) {
  expect(command(mode, "launch")).toContain(
    "start-show.ps1 -Mode " + mode + " -RehearsalRoot $root -DisplayMapPath $map -RunId $runId",
  );
}
expect(runbook).not.toContain("--show-mode");
```

Require `OfflineRequired` for Soak3/Show, explicit `DiagnosticConnected` only for the documented connected validation, and no direct invocation of `electron-main.js`.

- [ ] **Step 2: Write exact-fault command RED contracts**

Require the secondary command to parse the fixed controller log for current run/controller/generation and stop only `-Id $rendererPid`. Require the JanVim command to parse the strict token-free lease, verify PID start time, HWND, relative executable, byte size, and SHA-256, then stop only `-Id $janvimPid`. Require the controller fault command to use the exact current controller PID/run identity. Reject process-name matching, title search, wildcard kill, `taskkill /IM`, global keyboard injection, and arbitrary shell command fields.

- [ ] **Step 3: Run documentation contract test and capture RED**

```powershell
npm test -- tests/recovery.test.ts
```

Expected: current prose contains shorthand/raw `--show-mode` instructions and lacks complete public command arguments.

- [ ] **Step 4: Replace shorthand with complete public PowerShell blocks**

Start the runbook with one bounded external-root setup block:

```powershell
$repo = (Get-Location).Path
$runId = "g3-monitor-$([DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))"
$root = "D:\VirtualData\JanVim-Exhibition-Rehearsals\$runId"
$map = "$root\display-map.json"
```

Use `pwsh -NoProfile -File "$repo\scripts\start-g2-rehearsal.ps1"` for Capture/Confirm and `pwsh -NoProfile -File "$repo\scripts\start-show.ps1"` for ValidateOnly/Soak3/Show with every required named argument. Keep each section's precondition, action, visible result, machine evidence, and finite failure branch.

- [ ] **Step 5: Add exact-identity fault blocks**

Use strict JSON/property checks and `Get-Process -Id` only for the recorded PID. Recompute JanVim executable size/hash below the immutable artifact root before `Stop-Process -Id $janvimPid`. The commands must never read JanVim product source, user config, protected incident directories, or source content.

- [ ] **Step 6: Run focused GREEN and markdown safety scan**

```powershell
npm test -- tests/recovery.test.ts tests/start-show.test.ts
$forbidden = rg -n -- "--show-mode|taskkill /IM|SendKeys|process-name|title search" docs/operations/rehearsal-runbook.md
if ($LASTEXITCODE -eq 0) { throw "forbidden operator instruction: $forbidden" }
if ($LASTEXITCODE -ne 1) { throw "runbook safety scan failed with exit $LASTEXITCODE" }
npm run lint
git diff --check
```

Expected: tests pass and `rg` returns no forbidden operator instruction.

- [ ] **Step 7: Commit Task 13**

```powershell
git add docs/operations/rehearsal-runbook.md tests/recovery.test.ts
git commit -m "docs: make show rehearsal commands executable"
```

---

## Repair Completion Gate

After Task 13 has an independent clean review:

1. Request one fresh whole-repair review over `38d3f9d..HEAD`, deduplicate any cross-task finding, and resolve each new Critical/Important finding with a new focused RED before proceeding.
2. Run the original Task 14 Step 3 commands from a clean worktree: `npm ci`, typecheck, lint, full test, build, runtime verification, core hash, diff check, and status check.
3. Compare the JanVim product repository status byte-for-byte with the baseline `?? .nvimlog` plus terminating newline without reading or changing that file.
4. Confirm `show/display-map.json` remains `unconfirmed` and core SHA-256 remains exact.
5. Only then pause for a fresh external monitor map and operator-observed G3. Do not perform network disconnect or exact-PID fault injection without the operator present.

The minor double-accounting finding in `multi-loop-driver.ts` is explicitly nonblocking and excluded from Tasks 1–13. It may receive a separate RED/commit after the mandatory safety gate, but cannot delay Task 14 or be folded into an unrelated repair.
