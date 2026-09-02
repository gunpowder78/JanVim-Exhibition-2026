# Task 9 Recovery, Offline Operation, and Three-Loop Soak Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a restartable, offline, continuously looping P0 show runtime with bounded recovery,
normal operator controls, exact JanVim shutdown, and honest three-loop desktop-soak evidence while
preserving the verified G2 one-loop path.

**Architecture:** A new `ShowRunCoordinator` owns the only run state machine, monotonic clock,
generation invalidation, recovery budgets, telemetry, and shutdown ladder. Each generation uses a
fresh bridge/JanVim session and a replaceable secondary surface; `start-show.ps1` adds only the
out-of-process controller watchdog and offline preflight. G2 remains a separate compatibility mode.

**Tech Stack:** Windows 11 PowerShell, Node.js `22.23.0`, npm `12.0.2`, Electron `44.0.0`,
TypeScript `6.0.3`, Vitest `4.1.11`, Zod `4.4.3`, Neovim `0.10.1`, IPv4 loopback NDJSON.

**Spec:** `docs/superpowers/specs/2026-08-29-task9-recovery-offline-soak-design.md`

## Global Constraints

- Work only in `D:\github\JanVim-Exhibition-2026\.worktrees\task1` on
  `feat/task1-workflow`; never implement on `main`.
- Never modify `D:\github\JanVim`, any JanVim worktree, user Neovim configuration, source poem,
  source media, or the three protected incident directories named in `AGENTS.md`.
- Consume only JanVim tag `v0.10.1-gmk.4`, commit
  `e95633101d93f8448b0f906e918b5d836ab95273`, core SHA-256
  `224b3457d89fbc6cf946359683632f29f9262bae08b6f0d2e3043a3a7a6d83b3`.
- Keep `show/display-map.json` unconfirmed. Monitor IDs and all Task 9 rehearsal evidence remain
  under `D:\VirtualData\JanVim-Exhibition-Rehearsals\<run-id>`.
- Keep Electron main as the only show clock. Do not add global key injection, coordinate clicking,
  title/process-name window matching, remote URLs, online services, or firewall/adapter mutation.
- Add no package dependency. Preserve exact package versions and lockfile version 3.
- Every production behavior begins with a test that fails for the intended reason. Automated timing
  tests use an injected fake monotonic clock and no wall-clock 90-second wait.
- Recovery budgets are exactly 1/2/4 seconds, maximum three attempts per domain in a rolling ten
  minutes; the fourth failure enters safe-ready.
- Command, helper, bridge-close, child-close, and force-settle waits are finite. Log files are at
  most 8 MiB each and all run logs together at most 32 MiB.
- Renderer presentation ACK is a double-`requestAnimationFrame` application proxy, not a claim
  about projector photons.
- Monitor acceptance always records `physicalProjectorsTested: false`; it cannot complete G4.
- Stage only paths named in the current task. Never use `git add -A`.

## File responsibility map

| File | Responsibility |
|---|---|
| `packages/show-schema/src/renderer-event.ts` | Strict main↔renderer Task 9 envelopes and closed operator/presentation events. |
| `packages/show-schema/src/index.ts` | Existing agent protocol plus closed `shutdown` control action. |
| `apps/controller/src/preload.ts` | Exactly two validated renderer bridge methods. |
| `apps/secondary-screen/src/scene-controller.ts` | Apply contextual run events, controls, and presentation ACK scheduling. |
| `apps/controller/src/supervisor.ts` | Pure rolling restart budget and generation gate; no resource ownership. |
| `apps/controller/src/multi-loop-driver.ts` | Non-overlapping continuous/Soak3 driver with per-loop deadlines. |
| `apps/controller/src/run-telemetry.ts` | ACK, visible-drift, insertion-overhead, and percentile calculations. |
| `apps/controller/src/resource-sampler.ts` | Bounded five-second RSS summaries and real handle counts. |
| `apps/controller/src/bounded-log.ts` | Shared 8-MiB-file/32-MiB-run quota across all streams. |
| `apps/controller/src/show-run-evidence.ts` | Strict Task 9 record validation and atomic exclusive write. |
| `apps/controller/src/run-lease.ts` | Token-free exact controller/JanVim PID, creation-time, HWND, and hash lease. |
| `apps/controller/src/window-closer.ts` | Exact PID/HWND helper invocation and receipt validation. |
| `scripts/close-janvim-window.ps1` | Verify retained HWND ownership and send only `WM_CLOSE`. |
| `apps/controller/src/show-run-coordinator.ts` | Sole run/recovery/shutdown state machine. |
| `apps/controller/src/runtime-adapter-common.ts` | Shared frozen-input, guarded-secondary, child/session primitives. |
| `apps/controller/src/show-runtime-adapters.ts` | Real Electron/bridge/JanVim adapters for the Task 9 coordinator. |
| `apps/controller/src/show-command.ts` | Strict ValidateOnly/Soak3/Show command parsing and path boundaries. |
| `apps/controller/src/show-electron-command.ts` | Execute Task 9 modes and bind operator/signal lifecycle. |
| `scripts/start-show.ps1` | Offline preflight, exact Electron launch, and controller-death watchdog. |
| `tests/recovery.test.ts` | Full fake-clock failure/recovery and bounded resource integration. |
| `docs/operations/rehearsal-runbook.md` | Exact startup, stop, offline, fault, evidence, and fallback procedure. |
| `docs/operations/incident-log-template.md` | Bounded human incident record template. |

---

### Task 1: Add closed Task 9 renderer and agent-control schemas

**Files:**
- Modify: `packages/show-schema/src/index.ts`
- Modify: `packages/show-schema/src/renderer-event.ts`
- Modify: `packages/show-schema/tests/protocol.test.ts`
- Create: `packages/show-schema/tests/renderer-runtime.test.ts`

**Interfaces:**
- Consumes: existing `Cue`, `AgentCommand`, `AgentAck`, and strict Zod conventions.
- Produces:
  - `type OperatorAction = "start" | "restart-loop" | "stop-show"`
  - `type RendererToControllerEvent`
  - `type RunCueEvent`
  - `type RunStatusEvent`
  - `parseRendererToControllerEvent(value: unknown): RendererToControllerEvent`
  - `parseRendererEvent(value: unknown): RendererEvent` extended with Task 9 envelopes
  - `AgentCommand` control action `{ type: "shutdown" }`, not a manifest `EditorAction`

- [ ] **Step 1: Write the failing closed-agent-control tests**

Add these cases to `packages/show-schema/tests/protocol.test.ts`:

```ts
it("accepts only the parameter-free shutdown control action", () => {
  const command = {
    schema: 1,
    token,
    loopId: "loop-1",
    cueId: "loop-1-shutdown",
    action: { type: "shutdown" },
  };
  expect(parseAgentCommand(command, "127.0.0.1")).toEqual(command);
  expect(() =>
    parseAgentCommand({ ...command, action: { type: "shutdown", command: ":qa" } }, "127.0.0.1"),
  ).toThrow();
});
```

Also assert that a show manifest containing `editor-action: { type: "shutdown" }` remains rejected.

- [ ] **Step 2: Write the failing renderer-runtime schema tests**

Create `packages/show-schema/tests/renderer-runtime.test.ts` with exact examples:

```ts
const operator = {
  schema: 1,
  type: "operator-action",
  action: "start",
} as const;

const presentation = {
  schema: 1,
  type: "presentation-ack",
  generationId: 2,
  loopId: "fixture-90s-reset-2",
  cueId: "cue-reset",
} as const;

expect(parseRendererToControllerEvent(operator)).toEqual(operator);
expect(parseRendererToControllerEvent(presentation)).toEqual(presentation);
expect(() => parseRendererToControllerEvent({ ...presentation, generationId: 0 })).toThrow();
expect(() => parseRendererToControllerEvent({ ...operator, shell: "pwsh" })).toThrow();
```

Add strict `run-cue` and `run-status` cases. `run-cue` must contain `schema: 1`, positive safe-integer
`generationId`, bounded `loopId`, a parsed `cue`, and `requiresPresentationAck`. `run-status` must
accept only the coordinator state union and require a stable lower-case reason for `safe-ready`.

- [ ] **Step 3: Run the tests to verify RED**

Run:

```powershell
npm test -- packages/show-schema/tests/protocol.test.ts packages/show-schema/tests/renderer-runtime.test.ts
```

Expected: FAIL because shutdown is rejected and Task 9 exports do not exist.

- [ ] **Step 4: Implement the minimal strict unions**

In `renderer-event.ts`, add the exact public shapes:

```ts
export type OperatorAction = "start" | "restart-loop" | "stop-show";

export type RendererToControllerEvent =
  | { schema: 1; type: "operator-action"; action: OperatorAction }
  | {
      schema: 1;
      type: "presentation-ack";
      generationId: number;
      loopId: string;
      cueId: string;
    };

export type RunCueEvent = {
  schema: 1;
  type: "run-cue";
  generationId: number;
  loopId: string;
  requiresPresentationAck: boolean;
  cue: Cue;
};

export type RunStatusEvent = {
  schema: 1;
  type: "run-status";
  generationId: number;
  state:
    | "booting"
    | "ready"
    | "running"
    | "safe-cruise"
    | "black-recovering"
    | "safe-ready"
    | "shutting-down"
    | "stopped";
  reason?: string;
};
```

Use `.strict()`, `Number.isSafeInteger`-equivalent Zod checks, IDs of 1–256 UTF-8 bytes without
control characters, and the existing cue schema. Extend `RendererEvent`, but retain raw G2 cues and
`controller-status` unchanged.

In `index.ts`, add shutdown only to the agent command action schema/type:

```ts
type AgentControlAction = { type: "prepare"; poem: string; expectedSha256: string }
  | { type: "status" }
  | { type: "shutdown" };
```

- [ ] **Step 5: Run focused and type verification**

```powershell
npm test -- packages/show-schema/tests/protocol.test.ts packages/show-schema/tests/renderer-runtime.test.ts
npm run typecheck
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit Task 1**

```powershell
git add packages/show-schema/src/index.ts packages/show-schema/src/renderer-event.ts packages/show-schema/tests/protocol.test.ts packages/show-schema/tests/renderer-runtime.test.ts
git commit -m "feat: close Task 9 runtime messages"
```

---

### Task 2: Add the two-method preload, operator controls, and presentation ACK

**Files:**
- Modify: `apps/controller/src/preload.ts`
- Modify: `apps/controller/src/main.ts`
- Modify: `apps/controller/tests/preload-contract.test.ts`
- Modify: `apps/controller/tests/controller-main.test.ts`
- Modify: `apps/secondary-screen/src/main.ts`
- Modify: `apps/secondary-screen/src/ready-page.ts`
- Modify: `apps/secondary-screen/src/scene-controller.ts`
- Modify: `apps/secondary-screen/src/model.ts`
- Modify: `apps/secondary-screen/src/styles.css`
- Modify: `apps/secondary-screen/tests/scene-controller.test.ts`

**Interfaces:**
- Consumes: Task 1 `RendererToControllerEvent`, `RunCueEvent`, `RunStatusEvent` parsers.
- Produces:
  - `SecondaryPreloadApi.onShowEvent`
  - `SecondaryPreloadApi.sendRendererEvent`
  - `RENDERER_EVENT_CHANNEL = "janvim-exhibition:renderer-event"`
  - `bindLocalRendererEvents(...)` with strict local-file sender validation
  - double-frame presentation ACK for Task 9 contextual cues

- [ ] **Step 1: Write failing preload contract tests**

Replace the old Start-only expectation with exactly two API keys and strict outbound parsing:

```ts
expect(Object.keys(api).sort()).toEqual(["onShowEvent", "sendRendererEvent"]);
api.sendRendererEvent({ schema: 1, type: "operator-action", action: "start" });
expect(ipc.sent).toEqual([{
  channel: RENDERER_EVENT_CHANNEL,
  payload: { schema: 1, type: "operator-action", action: "start" },
}]);
expect(() => api.sendRendererEvent({ type: "shell", command: "pwsh" } as never)).toThrow();
```

Assert `onShowEvent` still drops malformed main-to-renderer payloads and unsubscribes idempotently.

- [ ] **Step 2: Write failing controller sender tests**

In `controller-main.test.ts`, require `bindLocalRendererEvents` to reject a correct payload from an
HTTPS sender, reject unknown fields, and deliver a local strict Start action once:

```ts
registered?.(
  { senderFrame: { url: readyPageUrl } },
  { schema: 1, type: "operator-action", action: "start" },
);
expect(onEvent).toHaveBeenCalledTimes(1);
```

- [ ] **Step 3: Write failing secondary controls and double-frame tests**

Create fake frame queues in `scene-controller.test.ts`. Apply a `run-cue` requiring ACK, verify no
ACK before either callback, then run two callbacks and expect exactly:

```ts
{
  schema: 1,
  type: "presentation-ack",
  generationId: 3,
  loopId: "loop-3",
  cueId: "cue-reset",
}
```

Assert ready exposes Start, safe-ready exposes Restart Loop and Stop Show, running hides immediate
restart, repeated button clicks emit one action, and reset clears the prior cue state.

- [ ] **Step 4: Run focused tests to verify RED**

```powershell
npm test -- apps/controller/tests/preload-contract.test.ts apps/controller/tests/controller-main.test.ts apps/secondary-screen/tests/scene-controller.test.ts
```

Expected: FAIL on the old `requestStart` API and missing Task 9 controls/ACK.

- [ ] **Step 5: Implement the two-method preload and strict main binding**

Implement:

```ts
export interface SecondaryPreloadApi {
  onShowEvent(listener: (event: RendererEvent) => void): () => void;
  sendRendererEvent(event: RendererToControllerEvent): void;
}
```

Parse before `ipc.send`; main parses again and requires the exact local `file:` URL. Adapt the G2
Start binding to accept only `{ type: "operator-action", action: "start" }`, preserving its one-shot
behavior.

- [ ] **Step 6: Implement controls and double-frame acknowledgement**

Add Start, Restart Loop, and Stop Show buttons to `SceneElements`. Use this exact scheduling shape:

```ts
requestFrame(() => {
  requestFrame(() => {
    sendRendererEvent({
      schema: 1,
      type: "presentation-ack",
      generationId: event.generationId,
      loopId: event.loopId,
      cueId: event.cue.id,
    });
  });
});
```

Track and cancel both pending frame handles on reset/dispose. Raw G2 cues continue through the old
path and never emit Task 9 presentation ACK.

- [ ] **Step 7: Run focused and build verification**

```powershell
npm test -- apps/controller/tests/preload-contract.test.ts apps/controller/tests/controller-main.test.ts apps/secondary-screen/tests/scene-controller.test.ts
npm run typecheck
npm run build
git diff --check
```

- [ ] **Step 8: Commit Task 2**

```powershell
git add apps/controller/src/preload.ts apps/controller/src/main.ts apps/controller/tests/preload-contract.test.ts apps/controller/tests/controller-main.test.ts apps/secondary-screen/src/main.ts apps/secondary-screen/src/ready-page.ts apps/secondary-screen/src/scene-controller.ts apps/secondary-screen/src/model.ts apps/secondary-screen/src/styles.css apps/secondary-screen/tests/scene-controller.test.ts
git commit -m "feat: add closed show operator controls"
```

---

### Task 3: Replace the unused callback supervisor with pure restart and generation policies

**Files:**
- Modify: `apps/controller/src/supervisor.ts`
- Modify: `apps/controller/tests/supervisor.test.ts`

**Interfaces:**
- Consumes: injected monotonic `nowMs` values only.
- Produces:

```ts
export type RestartDecision =
  | { allowed: true; attempt: 1 | 2 | 3; delayMs: 1_000 | 2_000 | 4_000 }
  | { allowed: false; reason: "restart-limit" };

export class RestartBudget {
  reserve(nowMs: number): RestartDecision;
  diagnostics(nowMs: number): { attemptsInWindow: number };
}

export class GenerationGate {
  current(): number;
  invalidate(): number;
  isCurrent(generationId: number): boolean;
}
```

- [ ] **Step 1: Write failing restart-budget tests**

Assert decisions at `nowMs = 0, 1, 2` return delays 1000/2000/4000; the fourth returns
`restart-limit`; at `600_003` all earlier timestamps have expired and the next delay is 1000.
Reject non-finite, negative, or decreasing monotonic values.

- [ ] **Step 2: Write failing generation tests**

```ts
const gate = new GenerationGate();
expect(gate.current()).toBe(1);
const old = gate.current();
expect(gate.invalidate()).toBe(2);
expect(gate.isCurrent(old)).toBe(false);
expect(gate.isCurrent(2)).toBe(true);
```

Invalidate at `Number.MAX_SAFE_INTEGER` must throw instead of wrapping.

- [ ] **Step 3: Run test to verify RED**

```powershell
npm test -- apps/controller/tests/supervisor.test.ts
```

Expected: FAIL because the pure policy interfaces do not exist.

- [ ] **Step 4: Implement the pure policies**

Use exact constants:

```ts
const RESTART_WINDOW_MS = 10 * 60 * 1_000;
const RESTART_DELAYS_MS = [1_000, 2_000, 4_000] as const;
```

`RestartBudget` owns only bounded timestamps; it creates no timers and restarts no process.
`GenerationGate` starts at 1 and increments before coordinator cleanup.

- [ ] **Step 5: Run verification**

```powershell
npm test -- apps/controller/tests/supervisor.test.ts
npm run typecheck
git diff --check
```

- [ ] **Step 6: Commit Task 3**

```powershell
git add apps/controller/src/supervisor.ts apps/controller/tests/supervisor.test.ts
git commit -m "refactor: isolate bounded restart policy"
```

---

### Task 4: Add a non-overlapping multi-loop driver

**Files:**
- Create: `apps/controller/src/multi-loop-driver.ts`
- Create: `apps/controller/tests/multi-loop-driver.test.ts`

**Interfaces:**
- Consumes: the existing `OneLoopRuntime` shape and an injected timer/clock adapter.
- Produces:

```ts
export interface MultiLoopBoundary {
  loopNumber: number;
  completedAtMs: number;
  tickLatenessMs: number;
  advanceOverrunMs: number;
}

export interface MultiLoopDriverOptions {
  runtime: OneLoopRuntime;
  timers: OneLoopTimerAdapter;
  clock: { nowMonotonic(): number };
  loopDurationMs: number;
  loopLimit: 3 | null;
  onLoopBoundary(boundary: MultiLoopBoundary): void;
  onComplete(): void;
  onFailure(reason: string): void;
}

export class MultiLoopDriver {
  constructor(options: MultiLoopDriverOptions);
  start(): boolean;
  requestStopAtBoundary(): boolean;
  stop(): void;
  diagnostics(): {
    running: boolean;
    advancing: boolean;
    observedLoops: number;
    timers: number;
    tickLatenessMs: number;
    advanceOverrunMs: number;
  };
}
```

- [ ] **Step 1: Write failing Soak3 and Show-mode tests**

Use fake timers. For `loopLimit: 3`, increment `runtime.completedLoops` once per fake reset and assert
three boundary callbacks, one complete callback, one runtime stop, and zero timers. For
`loopLimit: null`, assert the fourth boundary continues running.

- [ ] **Step 2: Write failing deadline, stop, and overlap tests**

Assert:

- each completed loop clears and rearms one `loopDurationMs + 10_000` deadline;
- an in-flight `advance()` suppresses overlapping ticks;
- a loop-count jump from 0 to 2 fails `loop-count-skipped`;
- safe-black and early stop fail closed;
- `requestStopAtBoundary()` is idempotent and stops only after the next reset;
- an explicit `stop()` clears interval/deadline once.

- [ ] **Step 3: Write failing separate-diagnostics tests**

At fake times 31/62/93 ms, assert tick lateness remains 15 ms rather than accumulating. Hold one
`advance()` from 16 to 1316 ms and assert `advanceOverrunMs === 1284` without changing the tick metric.

- [ ] **Step 4: Run test to verify RED**

```powershell
npm test -- apps/controller/tests/multi-loop-driver.test.ts
```

Expected: FAIL because the module is missing.

- [ ] **Step 5: Implement the driver**

Use one 16-ms interval, one per-loop deadline, and this boundary invariant:

```ts
if (runtime.completedLoops === observedLoops + 1) {
  observedLoops += 1;
  onLoopBoundary(snapshot());
  if (stopRequested || (loopLimit !== null && observedLoops === loopLimit)) finish();
  else rearmDeadline();
} else if (runtime.completedLoops !== observedLoops) {
  fail("loop-count-skipped");
}
```

Re-anchor expected tick after each executed tick. Record `advance()` settlement separately, including
the terminal settlement.

- [ ] **Step 6: Run verification**

```powershell
npm test -- apps/controller/tests/multi-loop-driver.test.ts apps/controller/tests/one-loop-driver.test.ts
npm run typecheck
git diff --check
```

- [ ] **Step 7: Commit Task 4**

```powershell
git add apps/controller/src/multi-loop-driver.ts apps/controller/tests/multi-loop-driver.test.ts
git commit -m "feat: drive bounded multi-loop runs"
```

---

### Task 5: Add exact timing telemetry and bounded resource sampling

**Files:**
- Create: `apps/controller/src/run-telemetry.ts`
- Create: `apps/controller/src/resource-sampler.ts`
- Create: `apps/controller/tests/run-telemetry.test.ts`
- Create: `apps/controller/tests/resource-sampler.test.ts`

**Interfaces:**
- Consumes: the coordinator's injected monotonic clock, parsed `Cue` values, correlated primary and
  secondary ACKs, retained controller/renderer/JanVim PIDs, and actual coordinator diagnostics.
- Produces:

```ts
export type LatencySummary = {
  count: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
};

export type CueCorrelation = {
  generationId: number;
  loopId: string;
  cueId: string;
};

export type LoopTelemetrySummary = {
  loopId: string;
  startedAtMs: number;
  endedAtMs: number;
  dispatchedCueCount: number;
  completedPrimaryCueCount: number;
  presentedSecondaryCueCount: number;
  secondaryPresentLatencyMs: LatencySummary;
  primaryCompletionLatencyMs: LatencySummary;
  primaryInstantAckLatencyMs: LatencySummary;
  primaryInsertOverheadMs: LatencySummary;
  finalVisibleDriftMs: number;
  resetBufferSha256: string;
  tickLatenessMs: number;
  advanceOverrunMs: number;
};

export type LoopFinishInput = {
  loopId: string;
  generationId: number;
  resetCueId: string;
  expectedPoemSha256: string;
  endedAtMs: number;
  tickLatenessMs: number;
  advanceOverrunMs: number;
};

export function plannedEditorDurationMs(cue: Cue): number;
export function summarizeLatencies(values: readonly number[]): LatencySummary;

export class RunTelemetry {
  beginLoop(loopId: string, startedAtMs: number): void;
  recordDispatch(endpoint: "primary" | "secondary", key: CueCorrelation, cue: Cue, atMs: number): void;
  recordPrimaryCompletion(key: CueCorrelation, atMs: number, bufferSha256: string): void;
  recordSecondaryPresentation(key: CueCorrelation, atMs: number): void;
  finishLoop(input: LoopFinishInput): LoopTelemetrySummary;
}

export interface ProcessSampleAdapter {
  sample(pid: number): Promise<{ rssBytes: number; handleCount: number }>;
}

export type ScalarAggregate = {
  count: number;
  min: number | null;
  max: number | null;
  final: number | null;
};

export type ResourceSummary = {
  controller: { rssBytes: ScalarAggregate; handleCount: ScalarAggregate };
  renderer: { rssBytes: ScalarAggregate; handleCount: ScalarAggregate };
  janvim: { rssBytes: ScalarAggregate; handleCount: ScalarAggregate };
  sampleIncomplete: boolean;
};

export class ResourceSampler {
  start(pids: { controller: number; renderer: number; janvim: number }): void;
  sampleBoundary(): Promise<void>;
  finish(): Promise<ResourceSummary>;
  diagnostics(): { timerCount: 0 | 1; sampleInFlight: boolean };
}
```

- Bounds: at most 512 endpoint samples per loop, exactly three process roles, one five-second timer,
  one in-flight OS sample, and aggregate `{ count, min, max, final }` values only.

- [ ] **Step 1: Write failing percentile and planned-duration tests**

In `run-telemetry.test.ts`, require nearest-rank percentiles and finite nonnegative values:

```ts
expect(summarizeLatencies([1, 2, 3, 4, 100])).toEqual({
  count: 5,
  p50Ms: 3,
  p95Ms: 100,
  maxMs: 100,
});
expect(plannedEditorDurationMs(insertCue("𠀀诗a", 24))).toBe(3 * 41);
expect(plannedEditorDurationMs(insertCue("zero", 0))).toBe(0);
```

Also use the fixture's actual 28-Unicode-character insertion at 24 characters/second and assert
`28 * floor(1000 / 24) === 1148`; do not round it to the prose approximation of 1166 ms. Reject
NaN, infinity, negative latency, duplicate correlation keys, and a 513th sample.

- [ ] **Step 2: Write failing endpoint and visible-drift tests**

With a fake monotonic clock, dispatch an insert at 1000 ms and complete it at 2258 ms. Assert raw
primary completion is 1258 ms and insertion overhead is `max(0, 1258 - 1148) === 110` ms. Keep raw
completion in its own family; never put insert completion into the instant-ACK family.

For each reset boundary, pair one primary reset ACK and one secondary double-frame presentation ACK
with the same generation/loop/cue key. Assert per-loop visible drift is their absolute endpoint
difference and a three-loop aggregate uses the sum, not max or scheduler drift. Missing either
endpoint, stale generation, wrong loop, duplicate ACK, or reset hash mismatch must fail closed.

- [ ] **Step 3: Write failing bounded sampler tests**

Use fake timers and an async fake OS adapter. Require samples at start, every 5000 ms, explicit loop
boundaries, and finish. After 100 interval firings, assert no raw sample array exists, each role has
only count/min/max/final RSS and handle summaries, `timerCount <= 1`, and overlapping timer callbacks
coalesce instead of creating concurrent queries. Reject zero/negative PID, negative RSS/handle
counts, and a process lookup failure with a bounded `sampleIncomplete` flag.

- [ ] **Step 4: Run focused tests to verify RED**

```powershell
npm test -- apps/controller/tests/run-telemetry.test.ts apps/controller/tests/resource-sampler.test.ts
```

Expected: FAIL because both modules are absent.

- [ ] **Step 5: Implement exact calculations and bounded state**

Count Unicode code points with `[...text].length`. For positive insert speed use
`Math.max(1, Math.floor(1000 / charsPerSecond))`; explicit zero speed has zero planned duration.
Use nearest-rank index `Math.ceil(percentile * count) - 1` on a copied sorted array. Clear all
per-loop correlation maps after `finishLoop`.

`ResourceSampler` must use the injected timer and OS adapter, retain only aggregate scalars, and
always clear its one interval in `finish()`, including when sampling rejects.

- [ ] **Step 6: Run focused and type verification**

```powershell
npm test -- apps/controller/tests/run-telemetry.test.ts apps/controller/tests/resource-sampler.test.ts
npm run typecheck
git diff --check
```

- [ ] **Step 7: Commit Task 5**

```powershell
git add apps/controller/src/run-telemetry.ts apps/controller/src/resource-sampler.ts apps/controller/tests/run-telemetry.test.ts apps/controller/tests/resource-sampler.test.ts
git commit -m "feat: measure bounded show telemetry"
```

---

### Task 6: Share the run log quota and write strict Task 9 evidence

**Files:**
- Modify: `apps/controller/src/bounded-log.ts`
- Modify: `apps/controller/tests/supervisor.test.ts`
- Create: `apps/controller/src/show-run-evidence.ts`
- Create: `apps/controller/tests/show-run-evidence.test.ts`

**Interfaces:**
- Consumes: Task 5 loop/resource summaries, confirmed external display-map snapshot, frozen artifact
  and content identities, offline snapshots, recovery events, and shutdown classification.
- Produces:

```ts
export type RunLogStream = "controller" | "recovery" | "janvim-stdout" | "janvim-stderr";

export class RunLogBudget {
  write(stream: RunLogStream, value: Uint8Array | string): boolean;
  writeJson(stream: RunLogStream, value: Record<string, unknown>): boolean;
  snapshot(): { totalBytes: number; fileCount: number; incomplete: boolean };
}

export type NetworkSnapshotEvidence = {
  sampledAtMs: number;
  activeExternalDefaultRoutes: number;
  connectedExternalProfiles: number;
  offline: boolean;
};

export type RuntimeCountEvidence = {
  listeners: number;
  timers: number;
  connections: number;
  pendingCommands: number;
};

export type LoopEvidence = LoopTelemetrySummary & {
  generationId: number;
  retryCount: number;
  skipCount: number;
  recoveryCount: number;
  resources: ResourceSummary;
  countsAtStart: RuntimeCountEvidence;
  countsAtEnd: RuntimeCountEvidence;
};

export type ShutdownEvidence = {
  requestedBy: "soak-complete" | "operator-stop" | "sigint" | "window-close" | "electron-quit" | "fatal-fault";
  agentShutdown: "acknowledged" | "timed-out" | "failed";
  hwndClose: "posted" | "timed-out" | "failed";
  janvimExit: "natural" | "forced" | "unsettled";
  bridgeClose: "closed" | "timed-out" | "failed";
  leaseRemoved: boolean;
};

export type RunAggregateEvidence = {
  completedLoops: number;
  offlineSampleCount: number;
  onlineSampleCount: number;
  totalRetries: number;
  totalSkips: number;
  totalRecoveries: number;
  cumulativeVisibleDriftMs: number;
  secondaryPresentLatencyMs: LatencySummary;
  primaryCompletionLatencyMs: LatencySummary;
  primaryInstantAckLatencyMs: LatencySummary;
  primaryInsertOverheadMs: LatencySummary;
  acceptanceOutcome: "pass" | "fail" | "diagnostic";
};

export type ShowRunEvidenceRecord = {
  schema: 1;
  runId: string;
  controllerRunId: string;
  mode: "Soak3" | "Show";
  acceptanceScope: "monitor-simulation" | "physical-projectors";
  physicalProjectorsTested: boolean;
  display: {
    mapSha256: string;
    primary: { id: string; bounds: Rectangle; workingArea: Rectangle; scaleFactor: number; rotation: number; geometrySha256: string };
    secondary: { id: string; bounds: Rectangle; workingArea: Rectangle; scaleFactor: number; rotation: number; geometrySha256: string };
  };
  artifact: {
    tag: "v0.10.1-gmk.4";
    commit: "e95633101d93f8448b0f906e918b5d836ab95273";
    layoutEngine: "orthogonal";
    lockSha256: string;
    coreBytes: number;
    coreSha256: "224b3457d89fbc6cf946359683632f29f9262bae08b6f0d2e3043a3a7a6d83b3";
  };
  content: {
    revision: string;
    manifestBytes: number;
    manifestSha256: string;
    poemBytes: number;
    poemSha256: string;
    configSha256: string;
    mediaManifest: { present: false } | { present: true; bytes: number; sha256: string };
  };
  offlineSnapshots: readonly NetworkSnapshotEvidence[];
  offlineVerified: boolean;
  loops: readonly LoopEvidence[];
  aggregate: RunAggregateEvidence;
  recoveries: readonly {
    generationId: number;
    domain: "secondary" | "janvim" | "controller";
    attempt: 1 | 2 | 3;
    delayMs: 1_000 | 2_000 | 4_000;
    outcome: "recovered" | "safe-ready" | "failed";
    reason: string;
  }[];
  shutdown: ShutdownEvidence;
  loggingIncomplete: boolean;
  operatorNotes: readonly string[];
};

export function parseShowRunEvidence(value: unknown): ShowRunEvidenceRecord;
export function writeShowRunEvidenceAtomic(path: string, value: unknown): Promise<void>;
```

- [ ] **Step 1: Write failing shared-quota tests**

Retain the existing `BoundedLog` tests, then add a `RunLogBudget` test using 100-byte files and a
300-byte run. Alternate all four streams and restarted-child writes. Assert every physical file is
at most 100 bytes, combined bytes are at most 300, names come only from the four fixed stream names
plus bounded numeric rotations, and file count never grows after 1000 writes.

Assert the configured production constants remain exactly 8 MiB per file and 32 MiB per run.
Oversized records and storage errors set `incomplete: true` and return false without throwing into
recovery/shutdown. Replace every supplied secret before byte accounting and writing.

- [ ] **Step 2: Write failing strict Soak3 evidence tests**

Build a minimal valid record with exactly three unique loop IDs, all required hashes, real display
bounds/scale, five offline snapshots (startup, three boundaries, shutdown), reset hashes, endpoint summaries, resource maxima, actual
timer/listener/connection/pending counts, recovery events, and shutdown classification. Assert
round-trip parsing preserves it.

Then reject, one mutation at a time:

- two or four Soak3 loops, duplicate loop IDs, or more than three stored Show loops;
- negative/impossible counts, missing reset hash, a 33rd retained recovery event, or unknown key;
- `offlineVerified: true` with any online snapshot;
- `physicalProjectorsTested: true` with monitor scope, or projector scope with false;
- a passing aggregate when cumulative visible drift is `>= 250`, secondary presentation,
  primary-instant, or primary-insert-overhead P95 is `>= 100`, reset hashes disagree, shutdown
  failed, or logging is incomplete; raw primary completion latency remains recorded but ungated;
- a supplied bridge token, `D:\github\JanVim`, an `AppData\Local\nvim` path, or any of the three
  protected incident paths anywhere in serialized evidence.

- [ ] **Step 3: Write failing atomic-writer tests**

Use a temporary directory. Require a same-directory exclusive temporary file, flush/close, and one
rename to the absent destination. Existing destination, rename failure, validation failure, and a
4097-byte operator note must leave the destination unchanged and remove only the writer's exact
temporary file.

- [ ] **Step 4: Run focused tests to verify RED**

```powershell
npm test -- apps/controller/tests/supervisor.test.ts apps/controller/tests/show-run-evidence.test.ts
```

Expected: FAIL on the missing shared budget and evidence module.

- [ ] **Step 5: Implement the shared quota and strict schema**

Give `RunLogBudget` one shared byte ledger and fixed per-stream rotation slots. Child stdout/stderr
must later be piped through `write`; never allocate a filename from generation or restart count.
Cap retained recovery events at 32, operator notes at 16, and every note at 4096 UTF-8 bytes. Soak3
stores exactly five offline snapshots; Show stores run-wide offline/online counts and only the latest
eight snapshots, 32 recovery events, and `loops.slice(-3)`.

The evidence writer parses before opening files, writes canonical pretty JSON plus one newline with
exclusive creation, and refuses overwrite. Evidence acceptance thresholds use strict `< 100` and
`< 250`, matching the approved design.

- [ ] **Step 6: Run focused and type verification**

```powershell
npm test -- apps/controller/tests/supervisor.test.ts apps/controller/tests/show-run-evidence.test.ts
npm run typecheck
git diff --check
```

- [ ] **Step 7: Commit Task 6**

```powershell
git add apps/controller/src/bounded-log.ts apps/controller/tests/supervisor.test.ts apps/controller/src/show-run-evidence.ts apps/controller/tests/show-run-evidence.test.ts
git commit -m "feat: bound run logs and soak evidence"
```

---

### Task 7: Add exact HWND close and token-free orphan leases

**Files:**
- Create: `apps/controller/src/window-closer.ts`
- Create: `apps/controller/tests/window-closer.test.ts`
- Create: `apps/controller/src/run-lease.ts`
- Create: `apps/controller/tests/run-lease.test.ts`
- Create: `scripts/close-janvim-window.ps1`
- Create: `tests/window-close-helper.test.ts`

**Interfaces:**
- Consumes: the retained `WindowPlacementReceipt`, frozen runtime root/hash, exact process creation
  times, a bounded helper executor, and one external rehearsal-root lease path.
- Produces:

```ts
export type WindowCloseReceipt = {
  schema: 1;
  pid: number;
  hwnd: string;
  ownershipVerified: true;
  topLevel: true;
  closePosted: true;
};

export async function closePlacedJanVimWindow(input: {
  placement: WindowPlacementReceipt;
  helperPath: string;
  runHelper: RunWindowCloseHelper;
}): Promise<WindowCloseReceipt>;

export type RunLease = {
  schema: 1;
  runId: string;
  controllerRunId: string;
  generationId: number;
  controller: { pid: number; startedAtUtc: string };
  janvim: {
    pid: number;
    startedAtUtc: string;
    hwnd: string;
    executableRelativePath: "janvim-core.exe";
    executableSha256: string;
  };
};

export function writeRunLeaseAtomic(path: string, lease: RunLease): Promise<void>;
export function replaceRunLeaseGenerationAtomic(
  path: string,
  expected: RunLease,
  nextGenerationId: number,
): Promise<RunLease>;
export function verifyRunLeaseIdentity(
  lease: RunLease,
  expected: LeaseVerificationInput,
): Promise<"identical" | "not-identical" | "unprovable">;
export function removeRunLeaseAfterSettlement(path: string, lease: RunLease): Promise<boolean>;
```

- [ ] **Step 1: Write failing Node close-adapter tests**

Require invocation of only:

```text
pwsh -NoProfile -NonInteractive -File <exact helper> -ChildProcessId <pid> -Hwnd <receipt hwnd>
```

The executor limits are exactly 2000 ms and 4096 stdout/stderr bytes. Reject malformed JSON,
different PID/HWND, extra fields, `ownershipVerified !== true`, timeout, nonzero exit, and output
overflow. Assert no fallback invocation contains a title, process name, keystroke, or coordinate.

- [ ] **Step 2: Write failing helper behavior tests**

Launch a test-owned top-level window process and discover its exact PID/HWND in the fixture. Run the
helper and assert a strict receipt plus one `WM_CLOSE`. Run negative cases with a wrong PID, child
HWND, invisible/destroyed HWND, and foreign HWND; all must fail without closing either process.

Also inspect the script source and reject `SendKeys`, `AppActivate`, title enumeration, process-name
lookup, `Stop-Process`, wildcard selection, or any message other than hexadecimal `0x0010`.

- [ ] **Step 3: Write failing lease identity tests**

With a fake process/window adapter, require all of PID, creation time, runtime-relative executable
path, current executable SHA-256, and HWND ownership to match. Any mismatch returns
`not-identical`; access denied or missing creation-time evidence returns `unprovable`. Neither result
authorizes termination.

Assert the JSON contains no bridge token, absolute runtime path, user-root path, title, or process
name. Initial creation cannot overwrite an existing lease. Generation replacement is allowed only
as an atomic compare-and-swap against the exact expected lease while controller/JanVim identities
stay byte-for-byte equal and the generation strictly increases. Removal succeeds only when the file
still parses to the exact same run/generation/process identity and the JanVim PID has settled.

- [ ] **Step 4: Run tests to verify RED**

```powershell
npm test -- apps/controller/tests/window-closer.test.ts apps/controller/tests/run-lease.test.ts tests/window-close-helper.test.ts
```

Expected: FAIL because the modules and helper are absent.

- [ ] **Step 5: Implement the close helper and adapter**

In PowerShell, guard `Add-Type` so repeated loading cannot reproduce `TYPE_ALREADY_EXISTS`. Call
only `IsWindow`, `GetWindowThreadProcessId`, `GetParent`, `GetWindow(GW_OWNER)`, `IsWindowVisible`,
and `PostMessage(WM_CLOSE)`. Parse HWND as an unsigned pointer and verify exact ownership/top-level
visibility before posting. Emit one compressed JSON receipt and no other stdout.

The Node adapter must compare the receipt against the retained placement receipt byte-for-byte at
the semantic field level; it performs no new window search.

- [ ] **Step 6: Implement lease parsing, atomicity, and identity tri-state**

Use strict bounded schemas and a same-directory exclusive temporary file. Compare creation times at
the adapter's native precision; do not round to seconds. Hash the exact resolved
`runtime/janvim/janvim-core.exe` and prove the resolved relative path remains below that runtime.
For a generation update, re-read and compare the complete expected lease immediately before the
atomic replace; a mismatch fails without replacing. Keep the lease until the exact child has settled.

- [ ] **Step 7: Run focused and type verification**

```powershell
npm test -- apps/controller/tests/window-closer.test.ts apps/controller/tests/run-lease.test.ts tests/window-close-helper.test.ts apps/controller/tests/window-placer.test.ts
npm run typecheck
git diff --check
```

- [ ] **Step 8: Commit Task 7**

```powershell
git add apps/controller/src/window-closer.ts apps/controller/tests/window-closer.test.ts apps/controller/src/run-lease.ts apps/controller/tests/run-lease.test.ts scripts/close-janvim-window.ps1 tests/window-close-helper.test.ts
git commit -m "feat: close and lease the exact JanVim window"
```

---

### Task 8: Build the coordinator state machine and happy path

**Files:**
- Create: `apps/controller/src/show-run-coordinator.ts`
- Create: `apps/controller/tests/show-run-coordinator.test.ts`

**Interfaces:**
- Consumes: Tasks 3–7 policy/driver/telemetry/evidence units through injected interfaces; it owns
  their lifecycle but performs no direct Electron, filesystem, process, or PowerShell calls.
- Produces:

```ts
export type ShowCoordinatorState =
  | "booting"
  | "ready"
  | "running"
  | "safe-cruise"
  | "black-recovering"
  | "safe-ready"
  | "shutting-down"
  | "stopped";

export type ShowRunResult =
  | { ok: true; reason: "soak-complete" | "operator-stop" }
  | { ok: false; reason: string };

export interface ShowSecondarySurface {
  readonly rendererPid: number;
  send(event: RunCueEvent | RunStatusEvent): void;
  onEvent(listener: (event: RendererToControllerEvent) => void): () => void;
  onDestroyed(listener: () => void): () => void;
  close(): void;
  diagnostics(): { listeners: number };
}

export interface ShowRunSession {
  readonly sessionId: string;
  currentGenerationId(): number;
  rebindGeneration(generationId: number): void;
  startBridge(): Promise<void>;
  launchJanVim(): Promise<void>;
  placeJanVim(): Promise<void>;
  awaitAgent(): Promise<void>;
  prepareOriginalPoem(): Promise<{ bufferSha256: string }>;
  createLoop(loopId: string, surface: ShowSecondarySurface): OneLoopRuntime;
  onFault(listener: (fault: "agent-disconnected" | "critical-ack-failed" | "janvim-exited") => void): () => void;
  diagnostics(): { connections: number; pendingCommands: number; editorCommandPending: boolean };
  resetToOriginal(loopId: string): Promise<{ bufferSha256: string }>;
  sendAgentShutdown(timeoutMs: 2_000, retryLimit: 1): Promise<void>;
  closePlacedWindow(timeoutMs: 2_000, maxOutputBytes: 4_096): Promise<void>;
  waitForJanVimExit(timeoutMs: 5_000): Promise<"natural" | "still-running">;
  terminateExactJanVim(): void;
  waitForForcedExit(timeoutMs: 5_000): Promise<boolean>;
  closeBridge(timeoutMs: 5_000): Promise<void>;
  dispose(): void;
}

export interface ShowRunCoordinatorDependencies {
  mode: "Soak3" | "Show";
  originalPoemSha256: string;
  validate(): Promise<void>;
  openSecondary(generationId: number): Promise<ShowSecondarySurface>;
  createSession(generationId: number): ShowRunSession;
  createDriver(options: MultiLoopDriverOptions): MultiLoopDriver;
  timers: OneLoopTimerAdapter;
  createTelemetry(): RunTelemetry;
  createResourceSampler(): ResourceSampler;
  sampleNetwork(): Promise<NetworkSnapshotEvidence>;
  finalizeEvidence(result: ShowRunResult, diagnostics: CoordinatorDiagnostics): Promise<void>;
  writeTerminalMarker(result: ShowRunResult): Promise<void>;
  flushLogs(): Promise<void>;
  nextLoopId(generationId: number, loopNumber: number): string;
  nowMs(): number;
  log(event: Record<string, unknown>): void;
}

export class ShowRunCoordinator {
  readonly completion: Promise<ShowRunResult>;
  boot(): Promise<{ ready: true } | { ready: false; reason: string }>;
  handleRendererEvent(value: unknown): boolean;
  requestEmergencyStop(reason: "sigint" | "window-close" | "electron-quit"): Promise<void>;
  diagnostics(): CoordinatorDiagnostics;
}
```

- [ ] **Step 1: Write failing closed-transition tests**

Table-drive every allowed transition from the approved design and reject every other pair. Assert
`generationId` starts at 1, states never leave the closed union, and `stopped` is terminal. The
transition helper stays private to the coordinator; tests drive public events rather than exporting
a second state machine.

- [ ] **Step 2: Write the failing startup-order test**

Use deferred fake dependencies and require the exact sequence:

```text
validate
open-secondary:1
start-bridge:1
launch-janvim:1
place-janvim:1
await-agent:1
prepare-original:1
status:ready
```

At every deferred phase assert no later phase ran, no loop timer exists, and Start is rejected.
Return a wrong prepare hash and assert `safe-ready` with a stable reason, no driver, and bounded
cleanup entry rather than `ready`.

- [ ] **Step 3: Write failing Start/idempotency tests**

After ready, deliver one strict local Start action. Require a fresh loop ID, one telemetry begin,
one driver, and `running`. Duplicate Start, presentation ACK with unknown key, and Restart Loop while
running are ignored and logged once per bounded reason bucket; they create no listener or timer.

- [ ] **Step 4: Write failing Soak3 and Show boundary tests**

For Soak3, fake three reset boundaries. Require three unique summaries, original-poem reset hash on
every loop, then exactly one transition to `shutting-down` and a successful `soak-complete` result
after normal shutdown. A fourth boundary is impossible.

For Show, run 100 fake boundaries. Require continuous fresh loop IDs, bounded aggregate telemetry,
only the latest three summaries, constant listener/timer counts, and no state checkpoint. Deliver
Stop Show during loop 100 and assert it is queued once, completes reset 100, and only then begins
shutdown. Stop Show in ready begins shutdown immediately.

- [ ] **Step 5: Write failing presentation-correlation tests**

Dispatch a critical cue to both endpoints, then pass primary and renderer ACKs through the
coordinator. Require exact generation/loop/cue correlation and Task 5 timestamps from the one
controller clock. Duplicate and stale ACKs do not advance the driver. A presentation ACK cannot
stand in for a JanVim semantic completion ACK.

- [ ] **Step 6: Run test to verify RED**

```powershell
npm test -- apps/controller/tests/show-run-coordinator.test.ts
```

Expected: FAIL because the coordinator module is absent.

- [ ] **Step 7: Implement startup, operator routing, and boundary ownership**

Implement one private `transition(next, reason?)` with a static allowed-transition map. Bind each
surface listener once and keep each disposer. Capture the generation in every callback. Only the
coordinator calls `nowMs`, creates loop IDs, starts drivers, or decides when a loop boundary is
complete.

The all-success shutdown call path should invoke the injected phase methods in the exact order that
Task 9 will harden; do not duplicate a temporary alternate shutdown route. Store one shutdown
promise so Soak3 and Show share it.

- [ ] **Step 8: Run focused and type verification**

```powershell
npm test -- apps/controller/tests/show-run-coordinator.test.ts apps/controller/tests/multi-loop-driver.test.ts apps/controller/tests/run-telemetry.test.ts
npm run typecheck
git diff --check
```

- [ ] **Step 9: Commit Task 8**

```powershell
git add apps/controller/src/show-run-coordinator.ts apps/controller/tests/show-run-coordinator.test.ts
git commit -m "feat: coordinate continuous show loops"
```

---

### Task 9: Add generation-safe recovery and the bounded shutdown ladder

**Files:**
- Modify: `apps/controller/src/show-run-coordinator.ts`
- Modify: `apps/controller/tests/show-run-coordinator.test.ts`

**Existing session methods whose recovery/timeout semantics are completed here:**

```ts
export interface ShowRunSession {
  // Task 8 startup/loop methods remain.
  resetToOriginal(loopId: string): Promise<{ bufferSha256: string }>;
  sendAgentShutdown(timeoutMs: 2_000, retryLimit: 1): Promise<void>;
  closePlacedWindow(timeoutMs: 2_000, maxOutputBytes: 4_096): Promise<void>;
  waitForJanVimExit(timeoutMs: 5_000): Promise<"natural" | "still-running">;
  terminateExactJanVim(): void;
  waitForForcedExit(timeoutMs: 5_000): Promise<boolean>;
  closeBridge(timeoutMs: 5_000): Promise<void>;
  dispose(): void;
}

export type RecoverableFault =
  | "secondary-destroyed"
  | "agent-disconnected"
  | "critical-ack-failed"
  | "janvim-exited";
```

- [ ] **Step 1: Write failing generation-invalidation tests**

For every fault callback, record an ordered trace and assert `generation-invalidate` is first,
before driver stop, listener disposal, bridge close, window close, process wait, or restart delay.
Resolve old ACKs, double-frame callbacks, process-close listeners, and retry timers afterward; each
must produce at most one bounded stale-generation diagnostic and must not mutate the current state.

- [ ] **Step 2: Write failing secondary-only recovery tests**

With no editor command pending, destroy the secondary during a noncritical cue. Require:

```text
running -> safe-cruise -> black-recovering
invalidate -> stop-driver -> close-old-secondary -> delay(1s)
open-secondary(new generation) -> reset-healthy-janvim -> verify-original-hash
fresh-loop-id -> ready -> running
```

The JanVim PID/bridge/session ID remain unchanged, but `rebindGeneration(newGenerationId)` updates
the dispatch guard and external lease before reset. The old cue is never replayed. A failed reset
hash escalates to full session replacement rather than automatic continuation.

- [ ] **Step 3: Write failing full-session recovery tests**

Table-drive agent disconnect, critical ACK failure, secondary loss while
`editorCommandPending === true`, and unexpected JanVim exit. Require old driver/commands to stop,
old session to use the exact bounded cleanup path, and a completely new bridge/child/HWND/nofile
buffer/loop ID. Automatic resume occurs only after the original poem hash is returned.

Assert the domain-specific restart sequence is exactly 1000/2000/4000 ms within a rolling ten
minutes. The fourth failure enters `safe-ready`, schedules no timer, and exposes one stable reason.
After ten minutes, the next automatic failure starts again at 1000 ms. Secondary and JanVim budgets
do not consume one another.

- [ ] **Step 4: Write failing operator recovery tests**

In `safe-ready`, one Restart Loop action authorizes one new generation and resets the exhausted
domain's automatic budget only after explicit operator input. Repeated clicks while recovery is in
flight are ignored. Stop Show is always accepted in ready/black/safe-ready. Restart Loop is rejected
while running and never jumps into the middle of a manifest.

- [ ] **Step 5: Write failing idempotent shutdown-ladder tests**

Call Stop, SIGINT, window-close, and Electron quit concurrently. Require one shared promise and this
single ordered ladder:

```text
disarm-operator
invalidate-generation
stop-driver-and-queued-editor-work
agent-shutdown(timeout=2000,retry=1)
exact-hwnd-close(timeout=2000,maxOutput=4096)
wait-natural-child(timeout=5000)
terminate-exact-child-if-needed
wait-forced-settle(timeout=5000)
close-bridge(timeout=5000)
dispose-secondary-listeners-timers
flush-logs-and-write-evidence
stopped
```

Table-drive rejection/timeout/throw at every stage. Every case continues through later cleanup,
records a bounded classification, removes the lease only after exact-child settlement, and resolves
once. No branch uses title matching, global input, process-name kill, or an unbounded promise.

- [ ] **Step 6: Write failing fault-during-shutdown tests**

Deliver child close, renderer destroyed, stale ACK, and repeated operator events while shutting
down. They may enrich classification but cannot start recovery or a second cleanup. If forced
settlement cannot be proven, leave the lease and fail evidence; do not report success.

- [ ] **Step 7: Run focused tests to verify RED**

```powershell
npm test -- apps/controller/tests/show-run-coordinator.test.ts
```

Expected: FAIL on missing recovery and timeout behavior.

- [ ] **Step 8: Implement recovery with pure budgets and captured generations**

Invalidate first, then synchronously disarm event sources before awaiting cleanup. Allocate a fresh
session and fresh loop ID for every full recovery. Secondary-only recovery may retain the healthy
session but must still reset and hash-check the original poem before resuming. Use injected timers
for all delays and deadlines.

- [ ] **Step 9: Implement one best-effort bounded shutdown promise**

Each phase catches and classifies its own failure, then advances. The only force action is the
retained exact child handle after identity is still proven. Final evidence is successful only if
required reset/offline/threshold/shutdown facts are all true.

- [ ] **Step 10: Run focused and type verification**

```powershell
npm test -- apps/controller/tests/show-run-coordinator.test.ts apps/controller/tests/supervisor.test.ts apps/controller/tests/window-closer.test.ts apps/controller/tests/run-lease.test.ts
npm run typecheck
git diff --check
```

- [ ] **Step 11: Commit Task 9**

```powershell
git add apps/controller/src/show-run-coordinator.ts apps/controller/tests/show-run-coordinator.test.ts
git commit -m "feat: recover and stop show generations safely"
```

---

### Task 10: Extract shared real-runtime primitives without changing G2

**Files:**
- Create: `apps/controller/src/runtime-adapter-common.ts`
- Create: `apps/controller/tests/runtime-adapter-common.test.ts`
- Modify: `apps/controller/src/g2-runtime-adapters.ts`
- Modify: `apps/controller/tests/g2-runtime-adapters.test.ts`

**Interfaces:**
- Consumes: existing G2 host adapters and exact frozen files; no new global/environment inputs.
- Produces reusable primitives for Task 11:

```ts
export function readFrozenRuntimeSnapshot(input: FrozenRuntimeInput): FrozenRuntimeSnapshot;
export function assertFrozenSnapshotUnchanged(snapshot: FrozenRuntimeSnapshot): void;
export function installLocalOnlyWebGuards(input: LocalWebGuardInput): () => void;
export function createBoundedChildStreamSink(input: ChildStreamSinkInput): ChildStreamSink;
export function resolveBelowRoot(root: string, relativePath: string): string;
```

- [ ] **Step 1: Pin G2 characterization before refactoring**

Extend `g2-runtime-adapters.test.ts` to snapshot the current validation/read order, exact local entry
URL, web-request cancellation set, JanVim argv/environment allowlist, placement receipt, one-loop
manual-close behavior, child-output classification, and evidence fields. Run it green before adding
the new module:

```powershell
npm test -- apps/controller/tests/g2-runtime-adapters.test.ts apps/controller/tests/runtime-composition.test.ts tests/first-loop.test.ts
```

- [ ] **Step 2: Write failing common-primitive tests**

Require frozen snapshots to include bytes/hash/size for lock, manifest, poem, config, and runtime
core, then reject any changed second read. Require path resolution to reject absolute paths,
`..`, alternate data streams, device paths, product/source roots, protected roots, and symlink escape.

For web guards, allow only the exact local secondary `file:` entry and cancel HTTP, HTTPS, WS, WSS,
navigation, and new-window attempts. For the child stream sink, alternate stdout/stderr writes and
prove it delegates to the shared run quota without retaining chunks.

- [ ] **Step 3: Run the new test to verify RED**

```powershell
npm test -- apps/controller/tests/runtime-adapter-common.test.ts
```

Expected: FAIL because the common module is absent.

- [ ] **Step 4: Extract the minimal helpers and adapt G2**

Move only byte-for-byte-equivalent path/frozen-read/web-guard/output logic out of
`g2-runtime-adapters.ts`. Keep G2's command parser, `G2RuntimeComposition`, one-loop driver, manual
Alt+F4 deadline, status messages, evidence schema, and public adapter types unchanged. Parameterize
the output sink so G2 retains its existing child-tail evidence while Task 9 can use `RunLogBudget`.

- [ ] **Step 5: Prove G2 compatibility and common behavior**

```powershell
npm test -- apps/controller/tests/runtime-adapter-common.test.ts apps/controller/tests/g2-runtime-adapters.test.ts apps/controller/tests/runtime-composition.test.ts tests/first-loop.test.ts tests/g2-launcher.test.ts
npm run typecheck
npm run build
git diff --check
```

Expected: all pass, and the G2 characterization snapshot is unchanged.

- [ ] **Step 6: Commit Task 10**

```powershell
git add apps/controller/src/runtime-adapter-common.ts apps/controller/tests/runtime-adapter-common.test.ts apps/controller/src/g2-runtime-adapters.ts apps/controller/tests/g2-runtime-adapters.test.ts
git commit -m "refactor: share frozen show runtime guards"
```

---

### Task 11: Wire the real Task 9 command, adapters, and Electron entry

**Files:**
- Create: `apps/controller/src/show-command.ts`
- Create: `apps/controller/tests/show-command.test.ts`
- Create: `apps/controller/src/show-electron-command.ts`
- Create: `apps/controller/tests/show-electron-command.test.ts`
- Create: `apps/controller/src/show-runtime-adapters.ts`
- Create: `apps/controller/tests/show-runtime-adapters.test.ts`
- Modify: `apps/controller/src/electron-main.ts`
- Modify: `scripts/verify-electron-module-graph.mjs`
- Modify: `tests/electron-build-smoke.test.ts`

**Interfaces:**
- Consumes: the Task 8–10 coordinator/common runtime and the existing real G2 adapter host.
- Produces a separate explicit Task 9 path; it never changes the meaning of `--g2-mode`.

```ts
export type ShowCommand = {
  mode: "ValidateOnly" | "Soak3" | "Show";
  rehearsalRoot: string;
  displayMapPath: string;
  runId: string;
  controllerRunId: string;
  networkPolicy: "OfflineRequired" | "DiagnosticConnected";
};

export function parseShowCommand(argv: readonly string[], repositoryRoot: string): ShowCommand;
export async function runShowElectronCommand(
  command: ShowCommand,
  adapters: ShowElectronCommandAdapters,
): Promise<number>;
export function createShowRuntimeAdapters(host: ShowRuntimeAdapterHost): ShowElectronCommandAdapters;
```

- [ ] **Step 1: Write failing strict-command tests**

Accept only these exact flags:

```text
--show-mode=validateonly|soak3|show
--rehearsal-root=<one direct external rehearsal child>
--display-map=<that root>\display-map.json
--run-id=<root basename>
--controller-run-id=<bounded unique invocation id>
--network-policy=offline-required|diagnostic-connected
```

Reject missing, duplicate, unknown, mixed G2/Task 9, relative, repository, product, user-config,
protected-root, wrong-parent, wrong-basename, and mismatched-run paths. Resolve paths before checking
containment. `controllerRunId` is 1–96 ASCII `[A-Za-z0-9._-]` bytes and is not a filename source.

- [ ] **Step 2: Write failing headless dispatch tests**

ValidateOnly must verify all immutable inputs, confirmed live display routing, application offline
guards, and the current host snapshot, while opening zero windows, bridges, or JanVim children.

Soak3 and Show each create one coordinator, await `boot()` and `completion`, then await idempotent
cleanup before returning. Bind SIGINT, window-close, and Electron quit once and dispose handlers at
terminal settlement. A failed boot still awaits cleanup and returns nonzero.

- [ ] **Step 3: Write failing real-adapter startup tests**

With fake filesystem/Electron/process/PowerShell hosts, assert the approved startup order and:

- exact frozen lock/tag/commit/core hash and unchanged manifest/poem/config bytes;
- confirmed external display map and live geometry match;
- one guarded local secondary BrowserWindow on the secondary display;
- IPv4 `127.0.0.1` bridge only, a private prepared Plugin Lab root, and no inherited user config;
- one exact JanVim child, PID-bound placement, retained HWND receipt, and token-free lease;
- child stdout/stderr piped into `RunLogBudget`, never generation-named files;
- resource sampling uses current controller PID, `webContents.getOSProcessId()`, and retained JanVim
  PID;
- one token-free fixed-shape `secondary-opened` log event records controller run, generation, and
  exact renderer OS PID for deliberate rehearsal fault injection;
- fixture formula/image/matrix absence is recorded as bounded P1 skips and does not block P0.

- [ ] **Step 4: Write failing application-offline tests**

Attempt HTTP, HTTPS, WS, WSS, remote navigation, `window.open`, malformed renderer IPC, non-loopback
bridge binding, and a changed local entry URL; require rejection before I/O. Inject a fixed bounded
PowerShell network-snapshot executor and require samples at startup, every loop boundary, and
shutdown.

Statically inspect production controller imports. Permit `node:net` only in the loopback
`BridgeServer`; reject DNS, HTTP, HTTPS, fetch, remote socket clients, download helpers, or shell
strings built from renderer/user text.

- [ ] **Step 5: Run focused tests to verify RED**

```powershell
npm test -- apps/controller/tests/show-command.test.ts apps/controller/tests/show-electron-command.test.ts apps/controller/tests/show-runtime-adapters.test.ts tests/electron-build-smoke.test.ts
```

Expected: FAIL because the Task 9 command/adapters do not exist.

- [ ] **Step 6: Implement strict parsing and mode dispatch**

Select the command family from the presence of exactly one of `--g2-mode` or `--show-mode`; reject
both or neither. Keep the existing G2 parser/dispatcher intact. ValidateOnly calls no coordinator
factory. Soak3 configures loop limit 3; Show configures no run limit.

- [ ] **Step 7: Compose real coordinator dependencies**

Use Task 10 primitives for frozen files and web guards, existing `BridgeServer`, JanVim launcher,
window placer, Task 7 close/lease, Task 5 telemetry/resources, and Task 6 logs/evidence. A fixed
two-second `pwsh -NoProfile -NonInteractive -Command <constant read-only snapshot>` adapter may call
only `Get-NetRoute` and `Get-NetConnectionProfile`; cap output at 16 KiB and parse a strict schema.

Write `controller-terminal.json` only after bounded cleanup, with schema/run/controller identity and
terminal classification. It is a fixed-name, token-free, exclusive marker used by the launcher to
distinguish intentional exit from controller death; it is not a substitute for show evidence.

- [ ] **Step 8: Extend the serialized Electron module-graph verifier**

Import both G2 and Task 9 built graphs and assert no TypeScript source extension remains in emitted
imports. Update the smoke-test name and require both graphs to load without opening a window.

- [ ] **Step 9: Run focused, G2, and build verification**

```powershell
npm test -- apps/controller/tests/show-command.test.ts apps/controller/tests/show-electron-command.test.ts apps/controller/tests/show-runtime-adapters.test.ts apps/controller/tests/g2-command.test.ts apps/controller/tests/electron-command.test.ts apps/controller/tests/g2-runtime-adapters.test.ts tests/electron-build-smoke.test.ts
npm run typecheck
npm run build
git diff --check
```

- [ ] **Step 10: Commit Task 11**

```powershell
git add apps/controller/src/show-command.ts apps/controller/tests/show-command.test.ts apps/controller/src/show-electron-command.ts apps/controller/tests/show-electron-command.test.ts apps/controller/src/show-runtime-adapters.ts apps/controller/tests/show-runtime-adapters.test.ts apps/controller/src/electron-main.ts scripts/verify-electron-module-graph.mjs tests/electron-build-smoke.test.ts
git commit -m "feat: wire the real Task 9 show runtime"
```

---

### Task 12: Add the offline launcher and external controller watchdog

**Files:**
- Create: `scripts/start-show.ps1`
- Create: `tests/start-show.test.ts`

**Launcher contract:**

```powershell
pwsh -NoProfile -File .\scripts\start-show.ps1 `
  -Mode ValidateOnly|Soak3|Show `
  -RehearsalRoot <external-direct-child> `
  -DisplayMapPath <same-root\display-map.json> `
  -RunId <root-basename> `
  -NetworkPolicy OfflineRequired|DiagnosticConnected
```

- [ ] **Step 1: Write failing preflight and boundary tests**

Copy the launcher into a temporary exhibition-shaped fixture as `g2-launcher.test.ts` does. Require
exact Node `v22.23.0`, existing built Electron command/entry, `AGENTS.md` marker, runtime verifier,
confirmed external map, content/config hashes, and strict paths before process launch.

Reject every repository/product/user-config/protected target, checked-in `show/display-map.json`,
unknown parameter, existing conflicting terminal marker, missing build, or verifier mismatch. Assert
the source has no `npm`, package install, download, Git mutation, recursive source delete, global
PATH assignment, user Neovim access, firewall command, adapter enable/disable, or power-setting
mutation.

- [ ] **Step 2: Write failing offline-snapshot tests**

Provide fake read-only `Get-NetRoute` and `Get-NetConnectionProfile` modules through the test
process's isolated `PSModulePath`. In OfflineRequired, reject an alive non-loopback default route or
connected external profile before Electron. In DiagnosticConnected, launch but pass
`--network-policy=diagnostic-connected`; later evidence cannot claim offline acceptance.

Assert the launcher never invokes `Disable-NetAdapter`, `Enable-NetAdapter`, `Set-NetFirewallRule`,
`New-NetFirewallRule`, `Remove-NetFirewallRule`, `netsh`, or a write-capable network command.

- [ ] **Step 3: Write failing mode/argument and intentional-exit tests**

Use a fake `electron.cmd` that logs arguments. Require a fresh bounded `controllerRunId` on every
launch, hidden controller process creation, exact Task 9 flags, no G2 flag, and no shell-constructed
argument string. ValidateOnly runs once and never watchdog-restarts.

For Soak3/Show, a zero exit plus matching strict `controller-terminal.json` is intentional and
returns immediately. A nonzero exit with a matching terminal marker is also intentional failure and
must not restart. A stale/wrong-PID/wrong-controller-run marker is not trusted.

- [ ] **Step 4: Write failing watchdog-budget tests**

Make the fake controller exit without a terminal marker. Assert relaunch delays are exactly
1000/2000/4000 ms and only three relaunches occur in ten minutes; the next unexpected exit writes
one bounded incident and stops. The behavior test may spend seven real seconds; no production
delay-bypass flag or environment backdoor is allowed.

Each relaunch gets a new `controllerRunId` and starts at explicit ready. No half-loop checkpoint or
old controller state is passed.

- [ ] **Step 5: Write failing orphan-cleanup tests**

Cover three lease states after unexpected controller exit:

1. no lease: relaunch is allowed because no active JanVim identity was published;
2. exact provable lease: independently verify JanVim PID creation time, resolved relative executable
   path/hash, and HWND ownership, invoke the exact close helper, wait five seconds, then use
   `Stop-Process -Id <exact pid>` only if the same identity remains, and wait five more seconds;
3. mismatched or unprovable lease: do not close, kill, delete the lease, or relaunch; write a fixed
   bounded incident and require operator intervention.

Assert there is no title/process-name query, wildcard kill, `taskkill /IM`, broad `Get-Process |
Stop-Process`, or cleanup outside the exact external lease/log files.

- [ ] **Step 6: Run launcher tests to verify RED**

```powershell
npm test -- tests/start-show.test.ts
```

Expected: FAIL because `scripts/start-show.ps1` is absent.

- [ ] **Step 7: Implement strict preflight and read-only offline checks**

Resolve and compare every path with `OrdinalIgnoreCase`; validate before creating files. Invoke the
existing runtime verifier and exact built Electron command, never npm. Use `Start-Process
-WindowStyle Hidden -PassThru` with an argument array and wait on that exact process.

- [ ] **Step 8: Implement the finite watchdog and lease cleanup**

Keep at most three monotonic crash timestamps, fixed delay constants, and fixed incident/log names.
Re-read and re-prove lease identity immediately before close and immediately before exact-PID force
termination. If any proof changes, stop. Cap helper waits/output and all child waits as specified.

- [ ] **Step 9: Run focused launcher and source-safety verification**

```powershell
npm test -- tests/start-show.test.ts tests/window-close-helper.test.ts tests/g2-launcher.test.ts tests/offline-package.test.ts
git diff --check
```

- [ ] **Step 10: Commit Task 12**

```powershell
git add scripts/start-show.ps1 tests/start-show.test.ts
git commit -m "feat: launch the show offline with a bounded watchdog"
```

---

### Task 13: Close recovery integration and operational documentation

**Files:**
- Create: `tests/recovery.test.ts`
- Create: `docs/operations/rehearsal-runbook.md`
- Create: `docs/operations/incident-log-template.md`

**Purpose:** Exercise the composed Task 9 runtime with fake time and make every human operation have
an observable success condition and a finite fallback. This task adds no P1 media/content behavior.

- [ ] **Step 1: Write the composed fake-clock recovery test**

Build one in-memory host around the real schema, coordinator, multi-loop driver, restart budgets,
telemetry, resource sampler, evidence parser, and strict command dispatcher. Use a fake monotonic
clock and deferred endpoints; never wait for a 90-second wall clock.

Cover these complete traces:

- normal offline Soak3: exactly three loops, three original-poem reset hashes, one normal shutdown,
  cumulative visible drift 249 ms accepted and 250 ms rejected;
- secondary loss outside an editor action: safe-cruise, black replacement, healthy-session reset,
  and fresh loop;
- secondary loss with editor pending, agent disconnect, critical ACK failure, and JanVim exit: full
  generation replacement with no later old editor cue;
- three 1/2/4-second recoveries and fourth-failure safe-ready;
- new controller invocation after crash: explicit ready, no checkpoint and no automatic Start;
- unavailable formula/image/matrix P1 assets: bounded skips while P0 completes;
- disconnected network: no DNS/HTTP/HTTPS/WS/WSS attempt and all offline samples true;
- SIGINT/window-close/Stop races and timeout at every shutdown phase: one bounded cleanup.

After 100 Show loops assert constant listener/timer/connection bounds, no retained raw RSS or ACK
arrays, at most three loop summaries, fixed log files, and no duplicate write-back. Resolve all stale
promises after terminal settlement and assert no state change.

- [ ] **Step 2: Write documentation contract assertions before the files exist**

In the same test, require the runbook to contain exact sections for preflight, display capture and
confirmation, physical network disconnect, ValidateOnly, Soak3, Show, Start, Restart Loop, Stop
Show, secondary fault, JanVim fault, controller fault, exact shutdown, evidence review, G2 fallback,
and physical-projector G4 deferral.

Require the incident template to bound events/notes and include run/controller/generation IDs,
monotonic and wall timestamps, mode/state, exact process identities, fault/retry/domain, offline
snapshot, artifact/content/display hashes, operator action, recovery result, media hashes, and
follow-up owner. Reject fields for bridge token, arbitrary command, keyboard injection, title
matching, user config, or source-repository mutation.

- [ ] **Step 3: Run the integration test and inspect failures**

```powershell
npm test -- tests/recovery.test.ts
```

Expected on first run: FAIL because the operational documents are absent; any runtime assertion
failure must be fixed in the smallest owning Task 3–12 module with a new focused RED test before
changing production behavior.

- [ ] **Step 4: Write the rehearsal runbook**

For every operation, use the structure `precondition -> exact command/action -> visible result ->
machine evidence -> bounded failure branch`. Include:

- use `start-g2-rehearsal.ps1` Capture/Confirm for a fresh external map; never confirm the checked-in
  map;
- manually disconnect Wi-Fi/Ethernet; the launcher only observes and never changes networking;
- monitor simulation records `physicalProjectorsTested: false` and cannot pass G4;
- read the exact secondary renderer PID from the fixed controller log before a deliberate fault;
- read the exact JanVim PID/HWND/hash identity from the token-free lease before a deliberate fault;
- normal Stop uses the button; Alt+F4 remains only the frozen G2 manual acceptance flow;
- if Task 9 fails, stop and run the preserved G2 short loop rather than adding P1 behavior.

- [ ] **Step 5: Write the bounded incident template**

Use a strict checklist and one bounded table (maximum 32 events, 4096 bytes per note). Explicitly
state that secrets, poem text, user config paths, and arbitrary shell commands are not recorded.
Include independent photo/video backup path and SHA-256 fields without embedding media in Git.

- [ ] **Step 6: Run integration, full focused, and documentation verification**

```powershell
npm test -- tests/recovery.test.ts apps/controller/tests/show-run-coordinator.test.ts apps/controller/tests/show-runtime-adapters.test.ts tests/start-show.test.ts
npm run typecheck
npm run lint
git diff --check
```

- [ ] **Step 7: Commit Task 13**

```powershell
git add tests/recovery.test.ts docs/operations/rehearsal-runbook.md docs/operations/incident-log-template.md
git commit -m "test: close Task 9 recovery operations"
```

---

### Task 14: Run automated gates and the human G3 monitor checkpoint

**Files:**
- No source file is expected to change.
- External only: `D:\VirtualData\JanVim-Exhibition-Rehearsals\<new-run-id>\...`

**Stop rule:** Automated success is not human acceptance. Pause for the operator at each observation
step. A monitor pass is G3 desktop evidence only and must say `physicalProjectorsTested: false`.

- [ ] **Step 1: Invoke verification and review workflows**

Use `superpowers:requesting-code-review` on the complete Task 9 diff. Resolve every correctness,
safety, finite-bound, G2-regression, and evidence-integrity finding with the relevant focused RED
test. Then invoke `superpowers:verification-before-completion` before making any pass claim.

- [ ] **Step 2: Record clean-boundary baselines**

```powershell
git status --short
git -C D:\github\JanVim status --short
(Get-Content -Raw .\show\display-map.json | ConvertFrom-Json).mappingStatus
Get-FileHash -Algorithm SHA256 .\runtime\janvim\janvim-core.exe
```

Require the exhibition worktree to contain only expected Task 9 changes before their commits, keep
the product repository status byte-for-byte unchanged from this read-only baseline, require the
checked-in map to remain `unconfirmed`, and require core SHA-256 exactly
`224b3457d89fbc6cf946359683632f29f9262bae08b6f0d2e3043a3a7a6d83b3`.

- [ ] **Step 3: Run the repository gates from a clean worktree**

```powershell
npm ci
npm run typecheck
npm run lint
npm test
npm run build
pwsh -NoProfile -File .\scripts\verify-runtime.ps1
Get-FileHash -Algorithm SHA256 .\runtime\janvim\janvim-core.exe
git diff --check
git status --short
```

All commands must exit 0; the final status must be clean. Re-read product-repository status and
compare it with Step 2. Do not read or write the three protected incident directories or user
Neovim configuration during verification.

- [ ] **Step 4: Create and confirm a fresh external monitor map**

Choose a new `g3-monitor-<UTC timestamp>` direct child under the rehearsal parent. With both real
monitors in the intended final orientation, run:

```powershell
$runId = 'g3-monitor-<UTC timestamp>'
$root = "D:\VirtualData\JanVim-Exhibition-Rehearsals\$runId"
$map = "$root\display-map.json"
pwsh -NoProfile -File .\scripts\start-g2-rehearsal.ps1 -Mode Capture -RehearsalRoot $root -DisplayMapPath $map
```

Read the captured catalog, ask the operator to identify the real primary and secondary IDs, then
run Confirm with those exact IDs. Do not infer the mapping from Windows numbering or reuse a prior
map. Record both displays' bounds, working area, resolution, scale, orientation, and geometry hash
externally.

- [ ] **Step 5: Run ValidateOnly before disconnecting**

```powershell
pwsh -NoProfile -File .\scripts\start-show.ps1 -Mode ValidateOnly -RehearsalRoot $root -DisplayMapPath $map -RunId $runId -NetworkPolicy DiagnosticConnected
```

Require exit 0, zero BrowserWindows/JanVim children, immutable hashes valid, and live geometry
matching the confirmed external map. This diagnostic run is not offline evidence.

- [ ] **Step 6: Perform the human offline Soak3 observation**

Have the operator physically disconnect Wi-Fi/Ethernet and confirm Windows shows no connected
external profile. Then run:

```powershell
pwsh -NoProfile -File .\scripts\start-show.ps1 -Mode Soak3 -RehearsalRoot $root -DisplayMapPath $map -RunId $runId -NetworkPolicy OfflineRequired
```

Ask the operator to click Start once and watch all three complete 90-second loops. Obtain explicit
confirmation for: causal secondary-before-primary ordering, one write per loop, unclipped inserted
text, original poem after each reset, no residual generated text, no desktop/terminal exposure, and
stable secondary controls. If any observation is missed, repeat with a new external run root; do not
retroactively approve it.

- [ ] **Step 7: Validate Soak3 machine and human evidence**

Parse the strict evidence with the built schema and require exactly three loops, cumulative visible
drift `< 250 ms`, critical secondary/instant-primary/insertion-overhead P95 `< 100 ms`, reset hashes
equal the frozen poem, offline samples all disconnected, bounded resources/logs, natural bounded
shutdown, and `physicalProjectorsTested: false`.

Hash the operator's photo/video files, copy them under the external rehearsal root, and write an
exclusive human-observation sidecar that binds the machine-evidence SHA-256 and records each answer.
Never place these IDs or media in Git.

- [ ] **Step 8: Perform separate forced-secondary and forced-JanVim runs**

Reconnect only as needed to prepare a fresh external run root/map, then physically disconnect again
for each run. In Show mode:

1. At a documented noncritical safe point, read the exact renderer OS PID from the bounded
   controller log and terminate only that PID. Confirm safe-cruise/black recovery, a new secondary,
   original-poem reset, fresh loop ID, and no duplicate editor command.
2. In a separate run at the next documented safe point, read the exact JanVim PID/HWND/hash lease
   and terminate only that exact PID. Confirm bounded full replacement, fresh bridge/session/loop,
   original poem, and automatic resume only after prepare ACK.

For each, confirm the 1/2/4 budget diagnostics, resource bounds, offline evidence, and no stale-cue
effect. Do not use process-name kill, title search, or global keyboard injection.

- [ ] **Step 9: Exercise normal Stop Show**

In a final Show run, click Stop Show while running. Confirm the current loop reaches its reset safe
boundary, controls disarm, agent shutdown is requested, the exact retained HWND receives WM_CLOSE,
JanVim settles naturally or through the recorded exact-PID fallback, and no terminal/desktop is
exposed. Verify terminal evidence and lease removal after settlement.

- [ ] **Step 10: Decide the G3 monitor gate honestly**

G3 desktop passes only if automated gates, offline Soak3, both forced recoveries, normal Stop, strict
machine records, and explicit human observations all pass. On pass, freeze P0 behavior and report
that G4 remains open. On any failure, create a bounded external incident, retain the last runnable
G2 path, and return to the smallest owning task with a new failing test.

Do not begin formal content expansion, packaging, or claim final completion in this plan. Two real
physical projectors, a new three-loop/offline/recovery rehearsal, packaging, and G4 records remain
mandatory under Tasks 10–11 of the four-day delivery plan.
