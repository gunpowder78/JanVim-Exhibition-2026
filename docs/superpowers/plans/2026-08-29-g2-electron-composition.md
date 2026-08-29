# G2 Electron Composition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Connect the existing deterministic show modules to one bounded real Electron/JanVim 90-second rehearsal on two physical monitors.

**Architecture:** Keep Electron side effects in a thin entry and place orchestration in injected, headless-testable modules. Use an external capture/confirm display map for monitor rehearsal, retain the checked-in projector map as unconfirmed, and stop after one reset before waiting a finite interval for JanVim's natural frontend shutdown.

**Tech Stack:** Node.js 22.23.0, TypeScript 6, Electron 44, Vite 8, Vitest 4, Zod 4, PowerShell 7, Windows Win32 window helper, Neovim 0.10.1, immutable JanVim v0.10.1-gmk.4 artifact.

**Spec:** docs/superpowers/specs/2026-08-29-g2-electron-composition-design.md

## Global Constraints

- Work only in the existing feat/task1-workflow worktree at D:\github\JanVim-Exhibition-2026\.worktrees\task1.
- Do not modify D:\github\JanVim, user Neovim configuration, source poem/media, or these three
  exact protected trees from the four-day delivery plan:
  - D:\VirtualData\TempCache\janvim-root-export-quarantine-20260826-110433-6473a2d7ebbc4524b66c61c07e540504
  - D:\VirtualData\TempCache\janvim-task5-cached-d42e9769283e47dc8b98cf94baee739d
  - D:\VirtualData\TempCache\janvim-task5-physical-cached-e9735e8d02e34ff4a4ac8836f8e22dcb
- Consume only the artifact locked to tag v0.10.1-gmk.4 and commit e95633101d93f8448b0f906e918b5d836ab95273.
- Keep show/display-map.json unconfirmed; monitor identities belong only in the external rehearsal directory.
- All renderer assets and show content remain local; no runtime network request or model call is allowed.
- The only show clock is performance.now(). Automated tests use fake clocks and never wait 90 wall-clock seconds.
- Run exactly one fixture loop. Tick every 16 ms without overlap, fail at loopDurationMs + 10,000, wait 60 seconds for manual frontend close, then allow five seconds for exact-child cleanup.
- Controller logs use existing 8-MiB-per-file and 32-MiB-total limits. JanVim stdout and stderr are each capped at 8 MiB. Never log the bridge token.
- Editor actions travel only through BridgeServer and the closed Lua action schema. Never add global keyboard injection, coordinate clicking, arbitrary Ex, shell, eval, or Lua payloads.
- Before every production behavior, add a real failing test and observe the expected failure.
- Required final verification is npm ci, npm run typecheck, npm test, npm run lint, npm run build, verify-runtime.ps1, the runtime core SHA-256, and git diff --check.

## File Structure

- packages/show-schema/src/index.ts: shared strict RendererEvent and controller-status schema.
- apps/secondary-screen/src/model.ts: renderer-facing event and ready-control element types.
- apps/secondary-screen/src/ready-page.ts: disabled-by-default local Start control.
- apps/secondary-screen/src/scene-controller.ts: status rendering and one-shot local Start binding.
- apps/secondary-screen/src/main.ts: wire preload events and requestStart without adding APIs.
- apps/controller/src/rehearsal-display-map.ts: deterministic capture catalog and explicit confirmation.
- apps/controller/src/one-loop-driver.ts: non-overlapping 16-ms advancement, one-loop cutoff, deadline.
- apps/controller/src/runtime-composition.ts: ShowController/bridge/JanVim/loop lifecycle composition.
- apps/controller/src/g2-evidence.ts: bounded child-output classification and atomic run record.
- apps/controller/src/g2-command.ts: strict command-line modes and path validation.
- apps/controller/src/g2-runtime-adapters.ts: real filesystem, process, Electron, bridge, placement, and log adapters.
- apps/controller/src/electron-command.ts: headless-testable Capture, Confirm, ValidateOnly, and Run dispatch.
- apps/controller/src/electron-lifecycle.ts: headless-testable one-shot app lifecycle.
- apps/controller/src/electron-main.ts: sole top-level Electron lifecycle entry.
- scripts/start-g2-rehearsal.ps1: bounded operator entry for Capture, Confirm, ValidateOnly, and Run.
- docs/operations/g2-monitor-rehearsal.md: exact operator procedure and acceptance record.

---

### Task 1: Add a strict renderer status event and one-shot local Start control

**Files:**
- Modify: packages/show-schema/src/index.ts
- Modify: packages/show-schema/tests/protocol.test.ts
- Modify: apps/controller/src/preload.ts
- Modify: apps/controller/tests/preload-contract.test.ts
- Modify: apps/secondary-screen/src/model.ts
- Modify: apps/secondary-screen/src/ready-page.ts
- Modify: apps/secondary-screen/src/scene-controller.ts
- Modify: apps/secondary-screen/src/main.ts
- Modify: apps/secondary-screen/tests/scene-controller.test.ts

**Interfaces:**
- Produces: ControllerStatusEvent, RendererEvent, parseRendererEvent(value).
- Produces: SecondarySceneController.applyEvent(event) and bindStartRequest(request).
- Preserves: preload global keys are exactly onShowEvent and requestStart.

- [ ] **Step 1: Write failing shared-schema tests**

Add literal behavior tests to packages/show-schema/tests/protocol.test.ts:

~~~~typescript
it("accepts only bounded controller status events", () => {
  expect(
    parseRendererEvent({ schema: 1, type: "controller-status", state: "ready" }),
  ).toEqual({ schema: 1, type: "controller-status", state: "ready" });

  expect(() =>
    parseRendererEvent({
      schema: 1,
      type: "controller-status",
      state: "blocked",
      reason: "x".repeat(65),
    }),
  ).toThrow();
  expect(() =>
    parseRendererEvent({ schema: 1, type: "controller-status", state: "unknown" }),
  ).toThrow();
});
~~~~

Import parseRendererEvent from the production schema module.

- [ ] **Step 2: Run the schema test and observe RED**

Run:

~~~~powershell
npm test -- packages/show-schema/tests/protocol.test.ts
~~~~

Expected: FAIL because parseRendererEvent is not exported.

- [ ] **Step 3: Implement the strict shared event union**

In packages/show-schema/src/index.ts, add:

~~~~typescript
export type ControllerStatusEvent = {
  schema: 1;
  type: "controller-status";
  state: "booting" | "ready" | "running" | "blocked" | "complete-awaiting-close";
  reason?: string;
};

export type RendererEvent = Cue | ControllerStatusEvent;

const controllerStatusSchema = z
  .object({
    schema: z.literal(1),
    type: z.literal("controller-status"),
    state: z.enum(["booting", "ready", "running", "blocked", "complete-awaiting-close"]),
    reason: z.string().regex(/^[a-z0-9-]{1,64}$/).optional(),
  })
  .strict()
  .superRefine((event, context) => {
    if (event.state === "blocked" && event.reason === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "blocked status requires a stable reason",
      });
    }
    if (event.state !== "blocked" && event.reason !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "reason is only valid for blocked status",
      });
    }
  });

export function parseRendererEvent(value: unknown): RendererEvent {
  if (
    value !== null &&
    typeof value === "object" &&
    "type" in value &&
    value.type === "controller-status"
  ) {
    return controllerStatusSchema.parse(value) as ControllerStatusEvent;
  }
  return manifestCueSchema.parse(value) as Cue;
}
~~~~

- [ ] **Step 4: Run the schema test and observe GREEN**

Run the Step 2 command.

Expected: protocol test file passes with no warnings.

- [ ] **Step 5: Write failing preload and ready-control tests**

In apps/controller/tests/preload-contract.test.ts, assert onShowEvent accepts a valid status and drops a malformed status. In apps/secondary-screen/tests/scene-controller.test.ts, add:

~~~~typescript
it("arms one local Start request only after controller-ready status", () => {
  const root = document.createElement("main");
  const scene = new SecondarySceneController(root, options);
  let requests = 0;
  const unbind = scene.bindStartRequest(() => {
    requests += 1;
  });
  const button = root.querySelector<HTMLButtonElement>("[data-action='start-show']");

  expect(button?.disabled).toBe(true);
  button?.click();
  expect(requests).toBe(0);

  scene.applyEvent({ schema: 1, type: "controller-status", state: "ready" });
  expect(button?.disabled).toBe(false);
  button?.click();
  button?.click();
  expect(requests).toBe(1);
  expect(button?.disabled).toBe(true);

  scene.applyEvent({ schema: 1, type: "controller-status", state: "complete-awaiting-close" });
  expect(button?.disabled).toBe(true);
  unbind();
});
~~~~

- [ ] **Step 6: Run renderer/preload tests and observe RED**

Run:

~~~~powershell
npm test -- apps/controller/tests/preload-contract.test.ts apps/secondary-screen/tests/scene-controller.test.ts
~~~~

Expected: FAIL because status parsing, Start elements, applyEvent, and bindStartRequest do not exist.

- [ ] **Step 7: Implement preload and ready control**

Change SecondaryPreloadApi.onShowEvent to receive RendererEvent and parse with parseRendererEvent.
Extend SceneElements with readyStatus and startButton. In createReadyPage, create:

~~~~typescript
const startButton = document.createElement("button");
startButton.type = "button";
startButton.dataset.action = "start-show";
startButton.textContent = "START 90s REHEARSAL";
startButton.disabled = true;
ready.append(readyTitle, readyStatus, startButton);
~~~~

In SecondarySceneController, retain the elements and implement:

~~~~typescript
public applyEvent(event: RendererEvent): void {
  if ("type" in event && event.type === "controller-status") {
    this.applyStatus(event);
    return;
  }
  this.apply(event);
}

public bindStartRequest(request: () => void): () => void {
  const listener = (): void => {
    if (this.startButton.disabled) return;
    this.startButton.disabled = true;
    request();
  };
  this.startButton.addEventListener("click", listener);
  return () => this.startButton.removeEventListener("click", listener);
}
~~~~

Map status to fixed text and enable the button only for ready. In secondary main, subscribe with
scene.applyEvent and bind requestStart from the existing preload API.

- [ ] **Step 8: Run Task 1 tests and full typecheck**

Run:

~~~~powershell
npm test -- packages/show-schema/tests/protocol.test.ts apps/controller/tests/preload-contract.test.ts apps/secondary-screen/tests/scene-controller.test.ts
npm run typecheck
~~~~

Expected: all selected tests and typecheck pass.

- [ ] **Step 9: Commit Task 1**

~~~~powershell
git add packages/show-schema/src/index.ts packages/show-schema/tests/protocol.test.ts apps/controller/src/preload.ts apps/controller/tests/preload-contract.test.ts apps/secondary-screen/src/model.ts apps/secondary-screen/src/ready-page.ts apps/secondary-screen/src/scene-controller.ts apps/secondary-screen/src/main.ts apps/secondary-screen/tests/scene-controller.test.ts
git commit -m "feat: add the armed secondary start control"
~~~~

### Task 2: Capture and explicitly confirm an external rehearsal display map

**Files:**
- Create: apps/controller/src/rehearsal-display-map.ts
- Create: apps/controller/tests/rehearsal-display-map.test.ts

**Interfaces:**
- Consumes: RuntimeDisplay, DisplayMapConfig, and hashDisplayGeometry from display-router.ts.
- Produces: RehearsalDisplayCatalog.
- Produces: captureRehearsalDisplays(displays) and confirmRehearsalDisplayMap(catalog, primaryId, secondaryId).

- [ ] **Step 1: Write failing map behavior tests**

Create apps/controller/tests/rehearsal-display-map.test.ts:

~~~~typescript
import { describe, expect, it } from "vitest";
import {
  captureRehearsalDisplays,
  confirmRehearsalDisplayMap,
  parseConfirmedRehearsalDisplayMap,
  parseRehearsalDisplayCatalog,
} from "../src/rehearsal-display-map.ts";

const displays = [
  { displayId: 111, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
  { displayId: 222, bounds: { x: 1920, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
];

it("captures without guessing roles and confirms only explicit distinct IDs", () => {
  const catalog = captureRehearsalDisplays(displays);
  expect(catalog.mappingStatus).toBe("unconfirmed");
  expect(catalog.displays.map((display) => display.displayId)).toEqual(["111", "222"]);
  expect(catalog.displays.map((display) => display.geometrySha256)).toEqual([
    "b2bc82d7bea454184acfb21ae9139e97c32aefb994443034423653e85f9c83cc",
    "2ebac5faac6c5f34562d1e91088736c9e70943c9c42846616a418db904319928",
  ]);

  const confirmed = confirmRehearsalDisplayMap(catalog, "111", "222");
  expect(confirmed).toMatchObject({
    schema: 1,
    mappingStatus: "confirmed",
    expectedDisplayCount: 2,
    primary: { displayId: "111" },
    secondary: { displayId: "222" },
  });
  expect(() => confirmRehearsalDisplayMap(catalog, "111", "111")).toThrow(
    /distinct/i,
  );
});

it("rejects capture unless exactly two valid displays are present", () => {
  expect(() => captureRehearsalDisplays(displays.slice(0, 1))).toThrow(/exactly two/i);
  expect(() =>
    captureRehearsalDisplays([{ ...displays[0]!, scaleFactor: 0 }, displays[1]!]),
  ).toThrow(/invalid/i);
  expect(() =>
    captureRehearsalDisplays([displays[0]!, { ...displays[1]!, displayId: 111 }]),
  ).toThrow(/distinct/i);
});

it("strictly parses external catalogs and rejects forged geometry", () => {
  const catalog = captureRehearsalDisplays(displays);
  expect(parseRehearsalDisplayCatalog(catalog)).toEqual(catalog);
  expect(() =>
    parseRehearsalDisplayCatalog({ ...catalog, unexpected: true }),
  ).toThrow();

  const confirmed = confirmRehearsalDisplayMap(catalog, "111", "222");
  expect(parseConfirmedRehearsalDisplayMap(confirmed)).toEqual(confirmed);
  expect(() =>
    parseConfirmedRehearsalDisplayMap({
      ...confirmed,
      primary: { ...confirmed.primary, geometrySha256: "0".repeat(64) },
    }),
  ).toThrow(/hash/i);
});
~~~~

- [ ] **Step 2: Run the map test and observe RED**

Run:

~~~~powershell
npm test -- apps/controller/tests/rehearsal-display-map.test.ts
~~~~

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement deterministic capture and explicit confirmation**

Create apps/controller/src/rehearsal-display-map.ts with:

~~~~typescript
export interface RehearsalDisplayCatalog {
  schema: 1;
  mappingStatus: "unconfirmed";
  expectedDisplayCount: 2;
  displays: DisplayMapRole[];
}

export function captureRehearsalDisplays(
  displays: readonly RuntimeDisplay[],
): RehearsalDisplayCatalog {
  if (displays.length !== 2) throw new Error("Capture requires exactly two displays");
  const normalized = displays
    .map((display) => ({
      displayId: String(display.displayId),
      bounds: { ...display.bounds },
      scaleFactor: display.scaleFactor,
    }))
    .sort((left, right) => left.displayId.localeCompare(right.displayId));
  for (const display of normalized) {
    if (
      display.displayId.length === 0 ||
      !Number.isFinite(display.scaleFactor) ||
      display.scaleFactor <= 0 ||
      display.bounds.width <= 0 ||
      display.bounds.height <= 0
    ) {
      throw new Error("Captured display is invalid");
    }
  }
  if (new Set(normalized.map((display) => display.displayId)).size !== 2) {
    throw new Error("Captured display IDs must be distinct");
  }
  return {
    schema: 1,
    mappingStatus: "unconfirmed",
    expectedDisplayCount: 2,
    displays: normalized.map((display) => ({
      ...display,
      geometrySha256: hashDisplayGeometry(display),
    })),
  };
}

export function confirmRehearsalDisplayMap(
  catalog: RehearsalDisplayCatalog,
  primaryId: string,
  secondaryId: string,
): DisplayMapConfig {
  if (primaryId === secondaryId) throw new Error("Display IDs must be distinct");
  const primary = catalog.displays.find((display) => display.displayId === primaryId);
  const secondary = catalog.displays.find((display) => display.displayId === secondaryId);
  if (primary === undefined || secondary === undefined) {
    throw new Error("Confirmed IDs must exist in the captured catalog");
  }
  return {
    schema: 1,
    mappingStatus: "confirmed",
    expectedDisplayCount: 2,
    primary: { ...primary, geometrySha256: hashDisplayGeometry(primary) },
    secondary: { ...secondary, geometrySha256: hashDisplayGeometry(secondary) },
  };
}
~~~~

Add strict parsers so external JSON never enters routing as an unchecked cast:

~~~~typescript
const rectangleSchema = z
  .object({
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();
const displayRoleSchema = z
  .object({
    displayId: z.string().min(1),
    bounds: rectangleSchema,
    scaleFactor: z.number().positive().finite(),
    geometrySha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()
  .superRefine((role, context) => {
    if (hashDisplayGeometry(role) !== role.geometrySha256) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["geometrySha256"],
        message: "display geometry hash mismatch",
      });
    }
  });
const catalogSchema = z
  .object({
    schema: z.literal(1),
    mappingStatus: z.literal("unconfirmed"),
    expectedDisplayCount: z.literal(2),
    displays: z.array(displayRoleSchema).length(2),
  })
  .strict()
  .refine((catalog) => catalog.displays[0]!.displayId !== catalog.displays[1]!.displayId, {
    message: "captured display IDs must be distinct",
  });
const confirmedMapSchema = z
  .object({
    schema: z.literal(1),
    mappingStatus: z.literal("confirmed"),
    expectedDisplayCount: z.literal(2),
    primary: displayRoleSchema,
    secondary: displayRoleSchema,
  })
  .strict()
  .refine((map) => map.primary.displayId !== map.secondary.displayId, {
    message: "confirmed display IDs must be distinct",
  });

export function parseRehearsalDisplayCatalog(value: unknown): RehearsalDisplayCatalog {
  return catalogSchema.parse(value) as RehearsalDisplayCatalog;
}

export function parseConfirmedRehearsalDisplayMap(value: unknown): DisplayMapConfig {
  return confirmedMapSchema.parse(value) as DisplayMapConfig;
}
~~~~

- [ ] **Step 4: Run Task 2 tests**

Run:

~~~~powershell
npm test -- apps/controller/tests/rehearsal-display-map.test.ts apps/controller/tests/display-router.test.ts
npm run typecheck
~~~~

Expected: selected tests and typecheck pass.

- [ ] **Step 5: Commit Task 2**

~~~~powershell
git add apps/controller/src/rehearsal-display-map.ts apps/controller/tests/rehearsal-display-map.test.ts
git commit -m "feat: confirm external rehearsal display maps"
~~~~

### Task 3: Add a fake-clock-tested one-loop driver

**Files:**
- Create: apps/controller/src/one-loop-driver.ts
- Create: apps/controller/tests/one-loop-driver.test.ts

**Interfaces:**
- Consumes: an object with start(), advance(), stop(), and completedLoops.
- Produces: OneLoopDriver.start(), stop(), diagnostics().
- Produces callbacks: onComplete and onFailure with stable reasons loop-deadline-exceeded,
  loop-advance-failed, loop-runtime-safe-black, loop-stopped-before-reset, or loop-count-invalid.
- Produces: maxDriftMs measured as the greatest of one executed tick's positive interval
  lateness and one `advance()` call's positive execution overrun against 16 ms. Re-anchor after
  every executed tick so Windows timer quantization is not accumulated across the run; sample
  `advance()` settlement so even a terminal in-flight wait remains visible.

- [ ] **Step 1: Write failing one-loop tests**

Create apps/controller/tests/one-loop-driver.test.ts with a fake timer that records interval and
deadline callbacks:

~~~~typescript
it("stops immediately after one reset and never overlaps advance", async () => {
  const timers = new FakeTimers();
  let completedLoops = 0;
  let release!: () => void;
  const firstAdvance = new Promise<void>((resolve) => {
    release = resolve;
  });
  const runtime: OneLoopRuntime = {
    state: "ready" as DeterministicShowLoopState,
    completedLoops,
    start: () => {
      runtime.state = "running";
      return true;
    },
    stop: vi.fn(() => {
      runtime.state = "stopped";
    }),
    advance: vi.fn(async () => {
      await firstAdvance;
      completedLoops = 1;
      runtime.completedLoops = completedLoops;
      return 1;
    }),
  };
  const completed = vi.fn();
  const failed = vi.fn();
  const driver = new OneLoopDriver({
    runtime,
    timers,
    clock: { nowMonotonic: () => timers.nowMonotonic() },
    loopDurationMs: 90_000,
    onComplete: completed,
    onFailure: failed,
  });

  expect(driver.start()).toBe(true);
  const tick = timers.intervalAt(16);
  const pending = tick();
  void tick();
  expect(runtime.advance).toHaveBeenCalledTimes(1);
  release();
  await pending;
  expect(completed).toHaveBeenCalledTimes(1);
  expect(failed).not.toHaveBeenCalled();
  expect(runtime.stop).toHaveBeenCalledTimes(1);
  expect(driver.diagnostics()).toEqual({
    running: false,
    advancing: false,
    maxDriftMs: 0,
  });
});

it("fails at exactly loop duration plus ten seconds", async () => {
  const harness = createDriverHarness(90_000);
  harness.driver.start();
  await harness.timers.fireTimeout(100_000);
  expect(harness.failed).toHaveBeenCalledWith("loop-deadline-exceeded");
  expect(harness.runtime.stop).toHaveBeenCalledTimes(1);
});

it("records maximum positive drift against the 16-ms monotonic schedule", async () => {
  const harness = createDriverHarness(90_000);
  harness.driver.start();
  harness.timers.setNow(25);
  await harness.timers.fireInterval(16);
  expect(harness.driver.diagnostics().maxDriftMs).toBe(9);
});

it("does not accumulate Windows timer quantization across completed ticks", async () => {
  const harness = createDriverHarness(90_000);
  harness.driver.start();
  for (const now of [31, 62, 93]) {
    harness.timers.setNow(now);
    await harness.timers.fireInterval(16);
  }
  expect(harness.driver.diagnostics().maxDriftMs).toBe(15);
});

it("records a terminal in-flight advance overrun without requiring another tick", async () => {
  const harness = createDeferredAdvanceHarness(90_000);
  harness.driver.start();
  harness.timers.setNow(16);
  const pendingAdvance = harness.timers.fireInterval(16);
  harness.timers.setNow(1_316);
  harness.completeOneLoopAndReleaseAdvance();
  await pendingAdvance;
  expect(harness.driver.diagnostics().maxDriftMs).toBe(1_284);
});

it("fails immediately when the deterministic loop enters safe black", async () => {
  const harness = createDriverHarness(90_000, {
    afterAdvance: (runtime) => {
      runtime.state = "safe-black";
    },
  });
  harness.driver.start();
  await harness.timers.fireInterval(16);
  expect(harness.failed).toHaveBeenCalledWith("loop-runtime-safe-black");
  expect(harness.runtime.stop).toHaveBeenCalledTimes(1);
});

it("does not report completion when the deadline wins an in-flight advance", async () => {
  const harness = createDeferredAdvanceHarness(90_000);
  harness.driver.start();
  const pendingAdvance = harness.timers.fireInterval(16);
  await harness.timers.fireTimeout(100_000);
  harness.completeOneLoopAndReleaseAdvance();
  await pendingAdvance;
  expect(harness.failed).toHaveBeenCalledTimes(1);
  expect(harness.failed).toHaveBeenCalledWith("loop-deadline-exceeded");
  expect(harness.completed).not.toHaveBeenCalled();
});
~~~~

- [ ] **Step 2: Run and observe RED**

Run:

~~~~powershell
npm test -- apps/controller/tests/one-loop-driver.test.ts
~~~~

Expected: FAIL because OneLoopDriver does not exist.

- [ ] **Step 3: Implement the driver**

Create apps/controller/src/one-loop-driver.ts:

~~~~typescript
export type OneLoopTimerHandle = number | object;

export interface OneLoopTimerAdapter {
  setInterval(callback: () => void, delayMs: number): OneLoopTimerHandle;
  clearInterval(id: OneLoopTimerHandle): void;
  setTimeout(callback: () => void, delayMs: number): OneLoopTimerHandle;
  clearTimeout(id: OneLoopTimerHandle): void;
}

export type OneLoopFailureReason =
  | "loop-deadline-exceeded"
  | "loop-advance-failed"
  | "loop-runtime-safe-black"
  | "loop-stopped-before-reset"
  | "loop-count-invalid";

export interface OneLoopRuntime {
  state: DeterministicShowLoopState;
  completedLoops: number;
  start(): boolean;
  advance(): Promise<number>;
  stop(): void;
}

export class OneLoopDriver {
  private intervalId?: OneLoopTimerHandle;
  private deadlineId?: OneLoopTimerHandle;
  private advancing = false;
  private terminal = false;
  private expectedTickMs = 0;
  private maxDriftMs = 0;

  public constructor(
    private readonly options: {
      runtime: OneLoopRuntime;
      timers: OneLoopTimerAdapter;
      clock: { nowMonotonic(): number };
      loopDurationMs: number;
      onComplete(): void;
      onFailure(reason: OneLoopFailureReason): void;
    },
  ) {}

  public start(): boolean {
    if (this.intervalId !== undefined || this.terminal || !this.options.runtime.start()) {
      return false;
    }
    this.expectedTickMs = this.options.clock.nowMonotonic() + 16;
    this.intervalId = this.options.timers.setInterval(() => void this.tick(), 16);
    this.deadlineId = this.options.timers.setTimeout(
      () => this.fail("loop-deadline-exceeded"),
      this.options.loopDurationMs + 10_000,
    );
    return true;
  }

  private async tick(): Promise<void> {
    if (this.advancing || this.terminal) return;
    const now = this.options.clock.nowMonotonic();
    this.recordDrift(now);
    this.expectedTickMs = now + 16;
    this.advancing = true;
    try {
      try {
        await this.options.runtime.advance();
      } finally {
        if (!this.terminal) this.recordDrift(this.options.clock.nowMonotonic());
      }
      if (this.terminal) return;
      if (this.options.runtime.completedLoops === 1) {
        this.finish();
        this.options.onComplete();
      } else if (this.options.runtime.completedLoops > 1) {
        this.fail("loop-count-invalid");
      } else if (this.options.runtime.state === "safe-black") {
        this.fail("loop-runtime-safe-black");
      } else if (this.options.runtime.state !== "running") {
        this.fail("loop-stopped-before-reset");
      }
    } catch {
      this.fail("loop-advance-failed");
    } finally {
      this.advancing = false;
    }
  }

  private recordDrift(now: number): void {
    this.maxDriftMs = Math.max(this.maxDriftMs, Math.max(0, now - this.expectedTickMs));
  }

  public stop(): void {
    if (this.terminal) return;
    this.finish();
  }

  public diagnostics(): { running: boolean; advancing: boolean; maxDriftMs: number } {
    return {
      running: !this.terminal && this.intervalId !== undefined,
      advancing: this.advancing,
      maxDriftMs: this.maxDriftMs,
    };
  }

  private finish(): void {
    if (this.terminal) return;
    this.terminal = true;
    if (this.intervalId !== undefined) {
      this.options.timers.clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    if (this.deadlineId !== undefined) {
      this.options.timers.clearTimeout(this.deadlineId);
      this.deadlineId = undefined;
    }
    this.options.runtime.stop();
  }

  private fail(reason: OneLoopFailureReason): void {
    if (this.terminal) return;
    this.finish();
    this.options.onFailure(reason);
  }
}
~~~~

- [ ] **Step 4: Run Task 3 tests**

Run:

~~~~powershell
npm test -- apps/controller/tests/one-loop-driver.test.ts tests/first-loop.test.ts
npm run typecheck
~~~~

Expected: selected tests and typecheck pass.

- [ ] **Step 5: Commit Task 3**

~~~~powershell
git add apps/controller/src/one-loop-driver.ts apps/controller/tests/one-loop-driver.test.ts
git commit -m "feat: bound G2 to one deterministic loop"
~~~~

### Task 4: Compose ShowController, bridge, JanVim, and one-loop lifecycle

**Files:**
- Create: apps/controller/src/runtime-composition.ts
- Create: apps/controller/tests/runtime-composition.test.ts

**Interfaces:**
- Consumes: ShowController, DeterministicShowLoop, OneLoopDriver, DisplayRoute, RendererEvent, and
  WindowPlacementReceipt.
- Produces: G2RuntimeComposition.boot(), completion, and idempotent async stop().
- Produces: G2RuntimeDependencies high-level adapter contract used by the real Electron layer.
- Produces: G2RunResult = { ok: true } or { ok: false; reason: string }.

- [ ] **Step 1: Write the failing startup-order test**

Create apps/controller/tests/runtime-composition.test.ts. Use fakes only; do not import Electron.

~~~~typescript
it("arms Start only after validation, placement, agent connection, and prepare ACK", async () => {
  const calls: string[] = [];
  const harness = createCompositionHarness(calls);

  await expect(harness.composition.boot()).resolves.toEqual({ ready: true });
  expect(calls).toEqual([
    "validate",
    "route-displays",
    "open-secondary",
    "bind-start",
    "start-bridge",
    "start-janvim",
    "place-janvim",
    "wait-agent",
    "prepare-loop",
    "status-ready",
  ]);
  expect(harness.startLocally()).toBe(true);
  expect(calls.slice(-2)).toEqual(["start-driver", "status-running"]);
});

it.each([
  ["validate", "artifact-invalid"],
  ["route-displays", "display-map-unconfirmed"],
  ["place-janvim", "window-rectangle-mismatch"],
  ["prepare-loop", "agent-prepare-failed"],
] as const)("never starts the timeline after %s failure", async (stage, reason) => {
  const harness = createCompositionHarness([], { failAt: stage, reason });
  await expect(harness.composition.boot()).resolves.toEqual({ ready: false, reason });
  expect(harness.driver.start).not.toHaveBeenCalled();
  expect(harness.statuses.at(-1)).toMatchObject({
    type: "controller-status",
    state: "blocked",
    reason,
  });
});

it("cleans a pre-secondary validation failure immediately", async () => {
  const harness = createCompositionHarness([], {
    failAt: "validate",
    reason: "runtime-verification-failed",
  });
  await expect(harness.composition.boot()).resolves.toEqual({
    ready: false,
    reason: "runtime-verification-failed",
  });
  await expect(harness.composition.completion).resolves.toEqual({
    ok: false,
    reason: "runtime-verification-failed",
  });
  expect(harness.timers.timeoutDelays()).not.toContain(15_000);
  expect(harness.cleanupCount()).toBe(1);
});
~~~~

Add these lifecycle tests in the same file:

~~~~typescript
it("fails when the exact child exits before reset", async () => {
  const harness = createCompositionHarness([]);
  await harness.composition.boot();
  harness.startLocally();
  harness.exitChild(0);
  await expect(harness.composition.completion).resolves.toEqual({
    ok: false,
    reason: "janvim-exited-before-reset",
  });
  expect(harness.cleanupCount()).toBe(1);
});

it("holds a post-open boot failure for 15 seconds, then cleans up", async () => {
  const harness = createCompositionHarness([], {
    failAt: "place-janvim",
    reason: "window-rectangle-mismatch",
  });
  await harness.composition.boot();
  expect(harness.timers.timeoutDelays()).toContain(15_000);
  await harness.timers.fireTimeout(15_000);
  expect(harness.child.kill).toHaveBeenCalledTimes(1);
  harness.exitChild(null);
  await expect(harness.composition.completion).resolves.toEqual({
    ok: false,
    reason: "window-rectangle-mismatch",
  });
});

it("waits 60 seconds after reset, then kills only the retained child once", async () => {
  const harness = createCompositionHarness([]);
  await harness.composition.boot();
  harness.startLocally();
  harness.completeLoop();
  expect(harness.timers.timeoutDelays()).toContain(60_000);
  await harness.timers.fireTimeout(60_000);
  expect(harness.child.kill).toHaveBeenCalledTimes(1);
  expect(harness.timers.timeoutDelays()).toContain(5_000);
  await harness.timers.fireTimeout(5_000);
  await expect(harness.composition.completion).resolves.toEqual({
    ok: false,
    reason: "janvim-close-timeout",
  });
});

it("keeps the close-timeout reason when the killed child closes during cleanup", async () => {
  const harness = createCompositionHarness([]);
  await harness.composition.boot();
  harness.startLocally();
  harness.completeLoop();
  await harness.timers.fireTimeout(60_000);
  harness.exitChild(null);
  await expect(harness.composition.completion).resolves.toEqual({
    ok: false,
    reason: "janvim-close-timeout",
  });
  expect(harness.child.kill).toHaveBeenCalledTimes(1);
});

it("accepts natural child exit only after one completed reset", async () => {
  const harness = createCompositionHarness([]);
  await harness.composition.boot();
  harness.startLocally();
  harness.completeLoop();
  expect(harness.statuses.at(-1)).toMatchObject({
    type: "controller-status",
    state: "complete-awaiting-close",
  });
  expect(harness.readyStatusCountAfterStart()).toBe(0);
  harness.setShutdownClassification({
    natural: true,
    reason: "frontend-shutdown-graceful",
  });
  harness.exitChild(0);
  await expect(harness.composition.completion).resolves.toEqual({ ok: true });
  await harness.composition.stop();
  await harness.composition.stop();
  expect(harness.cleanupCount()).toBe(1);
});

it("fails when the secondary window is destroyed", async () => {
  const harness = createCompositionHarness([]);
  await harness.composition.boot();
  harness.destroySecondary();
  expect(harness.child.kill).toHaveBeenCalledTimes(1);
  harness.exitChild(null);
  await expect(harness.composition.completion).resolves.toEqual({
    ok: false,
    reason: "secondary-window-destroyed",
  });
});

it("fails closed when the one-loop driver reports safe black", async () => {
  const harness = createCompositionHarness([]);
  await harness.composition.boot();
  harness.startLocally();
  harness.failDriver("loop-runtime-safe-black");
  expect(harness.child.kill).toHaveBeenCalledTimes(1);
  harness.exitChild(null);
  await expect(harness.composition.completion).resolves.toEqual({
    ok: false,
    reason: "loop-runtime-safe-black",
  });
  expect(harness.cleanupCount()).toBe(1);
});

it("lets only the first terminal signal resolve and clean up", async () => {
  const harness = createCompositionHarness([]);
  await harness.composition.boot();
  harness.startLocally();
  harness.failDriver("loop-runtime-safe-black");
  harness.exitChild(0);
  harness.destroySecondary();
  await expect(harness.composition.completion).resolves.toEqual({
    ok: false,
    reason: "loop-runtime-safe-black",
  });
  expect(harness.cleanupCount()).toBe(1);
});

it("turns an early explicit stop into one bounded cleanup", async () => {
  const harness = createCompositionHarness([]);
  await harness.composition.boot();
  const stopping = harness.composition.stop();
  expect(harness.child.kill).toHaveBeenCalledTimes(1);
  harness.exitChild(null);
  await stopping;
  await expect(harness.composition.completion).resolves.toEqual({
    ok: false,
    reason: "controller-stopped",
  });
  await harness.composition.stop();
  expect(harness.cleanupCount()).toBe(1);
});
~~~~

- [ ] **Step 2: Run and observe RED**

Run:

~~~~powershell
npm test -- apps/controller/tests/runtime-composition.test.ts
~~~~

Expected: FAIL because runtime-composition.ts does not exist.

- [ ] **Step 3: Define the composition contract**

Use these exact core interfaces:

~~~~typescript
export type G2RunResult = { ok: true } | { ok: false; reason: string };

export interface G2BridgeHandle {
  host: "127.0.0.1";
  port: number;
  token: string;
  waitForAgent(timeoutMs: 10_000): Promise<void>;
  dispatch(command: AgentCommand): Promise<AgentAck>;
  close(): Promise<void>;
}

export interface G2JanVimHandle {
  pid: number;
  onClose(listener: (exitCode: number | null) => void): () => void;
  kill(): boolean;
}

export interface G2SecondaryHandle {
  send(event: RendererEvent): void;
  onDestroyed(listener: () => void): () => void;
  close(): void;
}

export interface G2RuntimeDependencies {
  validate(): Promise<{ ok: true } | { ok: false; reason: string }>;
  routeDisplays(): Promise<DisplayRoute>;
  openSecondary(display: RuntimeDisplay): Promise<G2SecondaryHandle>;
  bindStart(controller: ShowController): () => void;
  startBridge(): Promise<G2BridgeHandle>;
  startJanVim(bridge: G2BridgeHandle): Promise<
    { ok: true; child: G2JanVimHandle } | { ok: false; reason: string }
  >;
  placeJanVim(pid: number, bounds: Rectangle): Promise<
    { ok: true; receipt: WindowPlacementReceipt } | { ok: false; reason: string }
  >;
  createLoop(bridge: G2BridgeHandle, secondary: G2SecondaryHandle): DeterministicShowLoop;
  createDriver(
    loop: DeterministicShowLoop,
    callbacks: { onComplete(): void; onFailure(reason: string): void },
  ): OneLoopDriver;
  timers: {
    setTimeout(callback: () => void, delayMs: number): OneLoopTimerHandle;
    clearTimeout(id: OneLoopTimerHandle): void;
  };
  log(event: Record<string, unknown>): void;
  classifyShutdown(exitCode: number | null): Promise<{ natural: boolean; reason: string }>;
}
~~~~

- [ ] **Step 4: Implement ShowController-based boot and lifecycle**

Implement G2RuntimeComposition with a single cleanup promise. stop() returns that promise, is safe
to await repeatedly, and never starts a second child-cleanup path. Map ShowController dependencies
as follows:

~~~~typescript
this.controller = new ShowController({
  validateManifestsAndHashes: () => this.dependencies.validate(),
  routeDisplays: () => this.dependencies.routeDisplays(),
  openSecondaryReady: async (display) => {
    this.secondary = await this.dependencies.openSecondary(display);
    this.disposeStart = this.dependencies.bindStart(this.controller);
    this.disposeSecondary = this.secondary.onDestroyed(() => {
      void this.fail("secondary-window-destroyed");
    });
  },
  startBridge: async () => {
    this.bridge = await this.dependencies.startBridge();
    return this.bridge;
  },
  startJanVim: async () => {
    const result = await this.dependencies.startJanVim(this.requiredBridge());
    if (!result.ok) return result;
    this.child = result.child;
    this.disposeChildClose = result.child.onClose((code) => void this.onChildClose(code));
    return { ok: true, pid: result.child.pid };
  },
  placeJanVimWindow: async (pid, bounds) => {
    const result = await this.dependencies.placeJanVim(pid, bounds);
    if (result.ok) this.placementReceipt = result.receipt;
    return result;
  },
  awaitAgentStatus: async () => {
    try {
      await this.requiredBridge().waitForAgent(10_000);
      this.loop = this.dependencies.createLoop(
        this.requiredBridge(),
        this.requiredSecondary(),
      );
      return (await this.loop.prepare())
        ? { ok: true }
        : { ok: false, reason: "agent-prepare-failed" };
    } catch {
      return { ok: false, reason: "agent-not-ready" };
    }
  },
  holdReady: (reason) => this.holdBlocked(reason),
  beginMonotonicLoop: () => this.beginLoop(),
});
~~~~

Implement blocked handling explicitly; do not leave the 15-second behavior to the Electron entry:

~~~~typescript
private holdBlocked(reason: string): void {
  if (this.secondary === undefined) {
    void this.fail(reason);
    return;
  }
  this.secondary.send({
    schema: 1,
    type: "controller-status",
    state: "blocked",
    reason,
  });
  this.blockedTimerId ??= this.dependencies.timers.setTimeout(
    () => void this.fail(reason),
    15_000,
  );
}
~~~~

boot sends booting before delegating to ShowController. After boot returns ready, send ready.
beginLoop creates and starts OneLoopDriver; if start returns false, fail with loop-start-failed,
otherwise send running. onComplete captures driver diagnostics, sends complete-awaiting-close, and
starts exactly one 60-second timer. onChildClose runs only from the wrapped child `close` event,
after stdout and stderr have settled, and resolves success only when one loop completed and shutdown
is natural. At the 60-second deadline, latch manualCloseExpired before calling kill once on the
retained child and start the five-second cleanup timer. A close event after that latch always
resolves janvim-close-timeout; it can never be reclassified as success. If no close event arrives,
the five-second timer resolves the same failure. cleanup clears timers/listeners and closes
bridge/window exactly once. For every other failure after a child exists, cleanup calls kill once
on that retained object and waits for its close event or one five-second timer before resolving the
original failure reason. A pre-secondary boot failure cleans up immediately; a post-secondary boot
failure remains visible for exactly 15 seconds and then begins that bounded cleanup.

- [ ] **Step 5: Run Task 4 tests**

Run:

~~~~powershell
npm test -- apps/controller/tests/runtime-composition.test.ts apps/controller/tests/controller-main.test.ts tests/first-loop.test.ts
npm run typecheck
~~~~

Expected: selected tests and typecheck pass.

- [ ] **Step 6: Commit Task 4**

~~~~powershell
git add apps/controller/src/runtime-composition.ts apps/controller/tests/runtime-composition.test.ts
git commit -m "feat: compose the bounded G2 runtime"
~~~~

### Task 5: Classify natural JanVim shutdown and write complete bounded evidence

**Files:**
- Create: apps/controller/src/g2-evidence.ts
- Create: apps/controller/tests/g2-evidence.test.ts
- Modify: apps/controller/src/runtime-composition.ts
- Modify: apps/controller/tests/runtime-composition.test.ts

**Interfaces:**
- Produces: BoundedChildOutput, classifyJanVimShutdown(summary), writeG2Evidence(path, record).
- Consumes: exact artifact lock, confirmed display map, placement receipt, loop metrics, child result.

- [ ] **Step 1: Write failing shutdown/evidence tests**

Create apps/controller/tests/g2-evidence.test.ts:

~~~~typescript
it("accepts only the natural CloseRequested zero-status summary", () => {
  expect(
    classifyJanVimShutdown({
      processExitCode: 0,
      stdoutTail:
        "surface-ready window_exit_reason=CloseRequested " +
        "neovim_exit_class=frontend_shutdown_graceful neovim_raw_status=code:0",
      stderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
    }),
  ).toEqual({ natural: true, reason: "frontend-shutdown-graceful" });

  expect(
    classifyJanVimShutdown({
      processExitCode: 0,
      stdoutTail: "window_exit_reason=BackendStopped neovim_raw_status=code:0",
      stderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
    }),
  ).toEqual({ natural: false, reason: "janvim-shutdown-summary-invalid" });
});

it("caps each child stream at eight MiB and keeps a bounded tail", () => {
  const capture = new BoundedChildOutput(8 * 1024 * 1024, 8 * 1024);
  capture.append(Buffer.alloc(8 * 1024 * 1024 + 1, 0x61));
  expect(capture.bytesWritten).toBe(8 * 1024 * 1024);
  expect(capture.truncated).toBe(true);
  expect(Buffer.byteLength(capture.tail, "utf8")).toBeLessThanOrEqual(8 * 1024);
});
~~~~

Add this atomic writer test:

~~~~typescript
it("atomically writes a complete token-free monitor rehearsal record", () => {
  const root = mkdtempSync(join(tmpdir(), "g2-evidence-"));
  const path = join(root, "g2-run-001.json");
  const record = validEvidenceRecord({
    runId: "g2-run-001",
    loop: {
      requestedLoops: 1,
      completedLoops: 1,
      durationMs: 90_000,
      maxDriftMs: 12,
      resetRestoredPoem: true,
    },
  });
  writeG2Evidence(path, record);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(record);
  expect(readFileSync(path, "utf8")).not.toContain("fixture-secret-token");
  expect(
    readdirSync(root).filter((name) => name.startsWith(".g2-evidence-")),
  ).toEqual([]);
  rmSync(root, { recursive: true, force: true });
});

it("rejects unknown token material and impossible passed records before writing", () => {
  const root = mkdtempSync(join(tmpdir(), "g2-evidence-invalid-"));
  const withToken = {
    ...validEvidenceRecord(),
    token: "fixture-secret-token",
  };
  expect(() => writeG2Evidence(join(root, "token.json"), withToken)).toThrow();
  const withoutPlacement = validEvidenceRecord({
    outcome: "passed",
    failureReason: null,
    placement: null,
  });
  expect(() =>
    writeG2Evidence(join(root, "missing-placement.json"), withoutPlacement),
  ).toThrow();
  expect(readdirSync(root)).toEqual([]);
  rmSync(root, { recursive: true, force: true });
});
~~~~

- [ ] **Step 2: Run and observe RED**

Run:

~~~~powershell
npm test -- apps/controller/tests/g2-evidence.test.ts
~~~~

Expected: FAIL because g2-evidence.ts does not exist.

- [ ] **Step 3: Implement output caps and shutdown classifier**

Use exact constants:

~~~~typescript
export const CHILD_STREAM_LIMIT_BYTES = 8 * 1024 * 1024;
export const CHILD_TAIL_BYTES = 8 * 1024;

export interface G2ShutdownEvidence {
  processExitCode: number | null;
  natural: boolean;
  reason: string;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export function classifyJanVimShutdown(
  summary: JanVimShutdownSummary,
): { natural: boolean; reason: string } {
  const natural =
    summary.processExitCode === 0 &&
    summary.stderrBytes === 0 &&
    !summary.stdoutTruncated &&
    !summary.stderrTruncated &&
    /\bwindow_exit_reason=CloseRequested\b/.test(summary.stdoutTail) &&
    /\bneovim_exit_class=frontend_shutdown_graceful\b/.test(summary.stdoutTail) &&
    /\bneovim_raw_status=code:0\b/.test(summary.stdoutTail);
  return natural
    ? { natural: true, reason: "frontend-shutdown-graceful" }
    : { natural: false, reason: "janvim-shutdown-summary-invalid" };
}
~~~~

BoundedChildOutput writes only the remaining bytes to its sink, retains the last 8 KiB, counts all
observed bytes separately from written bytes, and marks truncation.

- [ ] **Step 4: Implement the evidence schema and atomic writer**

Define G2EvidenceRecord with schema 1 and these required top-level fields. Placement and shutdown
are nullable only so an early failed Run still leaves a bounded factual record; a passed record
must have both:

~~~~typescript
{
  schema: 1;
  runId: string;
  outcome: "passed" | "failed";
  failureReason: string | null;
  acceptanceScope: "two-real-monitors-projector-simulation";
  physicalProjectorsTested: false;
  displayMap: { path: string; sha256: string; primary: DisplayMapRole; secondary: DisplayMapRole };
  artifact: { tag: string; commit: string; archiveBytes: number; archiveSha256: string; coreBytes: number; coreSha256: string; configSha256: string; layoutEngine: "dynamic" | "orthogonal" };
  placement: { pid: number; requested: Rectangle; actual: Rectangle; matchedWindowCount: 1 } | null;
  loop: { requestedLoops: 1; completedLoops: number; durationMs: number; maxDriftMs: number; resetRestoredPoem: boolean };
  shutdown: { processExitCode: number | null; natural: boolean; reason: string; stdoutBytes: number; stderrBytes: number; stdoutTruncated: boolean; stderrTruncated: boolean } | null;
  operatorNotes: string[];
}
~~~~

Build this from strict nested Zod schemas. Validate runId against
/^[A-Za-z0-9._-]{1,64}$/, bound operatorNotes to 32 entries of at most 512 UTF-8 bytes, require
completedLoops to be 0 or 1, and add a superRefine rule requiring placement, completedLoops 1,
resetRestoredPoem true, and natural shutdown whenever outcome is passed. Strict schemas must reject
every unknown field, including token.

writeG2Evidence rejects an existing destination, writes UTF-8 JSON to a same-directory unique
temporary file, fsyncs/closes it, renames it to the final path, and removes only that owned
temporary file on failure. Use the following write sequence rather than a direct write to the
final path:

~~~~typescript
export function writeG2Evidence(path: string, value: unknown): void {
  const record = g2EvidenceSchema.parse(value);
  if (existsSync(path)) throw new Error("g2-evidence-already-exists");
  const temporaryPath = join(
    dirname(path),
    `.g2-evidence-${process.pid}-${randomUUID()}.tmp`,
  );
  let descriptor: number | undefined;
  let ownsTemporary = false;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    ownsTemporary = true;
    writeFileSync(descriptor, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    if (existsSync(path)) throw new Error("g2-evidence-already-exists");
    renameSync(temporaryPath, path);
    ownsTemporary = false;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (ownsTemporary) rmSync(temporaryPath, { force: true });
  }
}
~~~~

- [ ] **Step 5: Integrate evidence completion into composition**

Extend runtime dependencies with an explicit snapshot; do not rely on adapter-global hidden state:

~~~~typescript
export interface G2EvidenceFinalization {
  result: G2RunResult;
  placement: WindowPlacementReceipt | null;
  completedLoops: 0 | 1;
  maxDriftMs: number;
  resetRestoredPoem: boolean;
  shutdown: G2ShutdownEvidence | null;
}

classifyShutdown(exitCode: number | null): Promise<G2ShutdownEvidence>;
finalizeEvidence(input: G2EvidenceFinalization): Promise<void>;
~~~~

This replaces Task 4's narrower classifyShutdown return type.

Invoke it once for every terminal Run result after manifest/artifact/display-map validation has
succeeded and before completion resolves. A pre-validation failure cannot truthfully populate the
validated artifact/map fields, so it emits only the bounded controller failure event and launcher
result. Pass null placement or shutdown only for the corresponding later failure. After a child
close event, await settled bounded stdout/stderr captures, classify them, and pass that exact
shutdown snapshot. If the 5-second post-kill deadline expires without close, pass processExitCode
null and natural false. Track validation success explicitly in the composition so this rule is not
inferred from which fields happen to be present. Add:

~~~~typescript
it("turns evidence write failure into a failed run", async () => {
  const harness = createCompositionHarness([], { evidenceWriteFails: true });
  await harness.composition.boot();
  harness.startLocally();
  harness.completeLoop();
  harness.exitChild(0);
  await expect(harness.composition.completion).resolves.toEqual({
    ok: false,
    reason: "g2-evidence-write-failed",
  });
  expect(harness.finalizeEvidence).toHaveBeenCalledTimes(1);
});
~~~~

Also extend Task 4's first-terminal-signal test to assert finalizeEvidence is called once despite
the competing child and secondary signals.

- [ ] **Step 6: Run Task 5 tests**

Run:

~~~~powershell
npm test -- apps/controller/tests/g2-evidence.test.ts apps/controller/tests/runtime-composition.test.ts
npm run typecheck
~~~~

Expected: selected tests and typecheck pass.

- [ ] **Step 7: Commit Task 5**

~~~~powershell
git add apps/controller/src/g2-evidence.ts apps/controller/tests/g2-evidence.test.ts apps/controller/src/runtime-composition.ts apps/controller/tests/runtime-composition.test.ts
git commit -m "feat: record bounded G2 shutdown evidence"
~~~~

### Task 6: Parse G2 commands and construct real runtime adapters

**Files:**
- Create: apps/controller/src/g2-command.ts
- Create: apps/controller/tests/g2-command.test.ts
- Create: apps/controller/src/g2-runtime-adapters.ts
- Create: apps/controller/tests/g2-runtime-adapters.test.ts
- Modify: apps/controller/src/window-placer.ts
- Modify: apps/controller/tests/window-placer.test.ts

**Interfaces:**
- Produces: G2Command union for Capture, Confirm, ValidateOnly, Run.
- Produces: parseG2Command(argv, repositoryRoot).
- Produces: createG2RuntimeDependencies(command, electronAdapters).
- Produces: createElectronCommandAdapters(electron) with atomic external JSON I/O and finite
  command deadlines.
- Produces: successful placeJanVimWindow results containing the validated WindowPlacementReceipt.

- [ ] **Step 1: Write failing command/path tests**

Create apps/controller/tests/g2-command.test.ts:

~~~~typescript
it("parses one exact mode and rejects repository-local rehearsal evidence", () => {
  expect(
    parseG2Command(
      [
        "--g2-mode=run",
        "--rehearsal-root=D:\\VirtualData\\JanVim-Exhibition-Rehearsals\\g2-001",
        "--display-map=D:\\VirtualData\\JanVim-Exhibition-Rehearsals\\g2-001\\display-map.json",
        "--run-id=g2-001",
      ],
      "D:\\show",
    ),
  ).toMatchObject({ mode: "Run", runId: "g2-001" });

  expect(() =>
    parseG2Command(
      [
        "--g2-mode=run",
        "--rehearsal-root=D:\\show\\evidence",
        "--display-map=D:\\show\\evidence\\display-map.json",
        "--run-id=g2-001",
      ],
      "D:\\show",
    ),
  ).toThrow(/external/i);
});
~~~~

Cover duplicate flags, relative paths, a root outside the dedicated rehearsal parent, using the
rehearsal parent itself, a display-map basename other than display-map.json, missing IDs for
Confirm, same IDs, each exact protected root and one descendant, D:\github\JanVim, invalid run
IDs, a run ID that differs from the rehearsal-root basename, and unexpected arguments.

- [ ] **Step 2: Run command tests and observe RED**

Run:

~~~~powershell
npm test -- apps/controller/tests/g2-command.test.ts
~~~~

Expected: FAIL because g2-command.ts does not exist.

- [ ] **Step 3: Implement strict command parsing**

Use a closed union:

~~~~typescript
export type G2Command =
  | { mode: "Capture"; rehearsalRoot: string; displayMapPath: string }
  | {
      mode: "Confirm";
      rehearsalRoot: string;
      displayMapPath: string;
      primaryDisplayId: string;
      secondaryDisplayId: string;
    }
  | { mode: "ValidateOnly"; rehearsalRoot: string; displayMapPath: string; runId: string }
  | { mode: "Run"; rehearsalRoot: string; displayMapPath: string; runId: string };
~~~~

Accept each flag once, reject unknown flags, resolve with win32.resolve, require rehearsalRoot
to be one direct child below D:\VirtualData\JanVim-Exhibition-Rehearsals. Also require it outside
repositoryRoot and D:\github\JanVim, and reject each protected root and all descendants
case-insensitively. Require displayMapPath to be a direct child of rehearsalRoot with basename
display-map.json. Use path-boundary comparison so D:\github\JanVim-Exhibition-2026 is not mistaken
for D:\github\JanVim:

~~~~typescript
const PROTECTED_ROOTS = [
  "D:\\VirtualData\\TempCache\\janvim-root-export-quarantine-20260826-110433-6473a2d7ebbc4524b66c61c07e540504",
  "D:\\VirtualData\\TempCache\\janvim-task5-cached-d42e9769283e47dc8b98cf94baee739d",
  "D:\\VirtualData\\TempCache\\janvim-task5-physical-cached-e9735e8d02e34ff4a4ac8836f8e22dcb",
] as const;
const REHEARSAL_PARENT = "D:\\VirtualData\\JanVim-Exhibition-Rehearsals";

function isAtOrBelow(candidate: string, root: string): boolean {
  const resolvedCandidate = win32.resolve(candidate).toLowerCase();
  const resolvedRoot = win32.resolve(root).replace(/[\\]+$/, "").toLowerCase();
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}\\`);
}
~~~~

After resolving, require `win32.dirname(rehearsalRoot)` to equal REHEARSAL_PARENT and require
`win32.dirname(displayMapPath)` to equal rehearsalRoot, using case-insensitive equality. For
ValidateOnly and Run, require runId to equal `win32.basename(rehearsalRoot)` exactly.

- [ ] **Step 4: Run command tests and observe GREEN**

Run the Step 2 command.

- [ ] **Step 5: Write failing real-adapter boundary tests**

In apps/controller/tests/g2-runtime-adapters.test.ts, inject filesystem/process/Electron fakes and
assert:

~~~~typescript
it("validates bytes before opening a window or spawning JanVim", async () => {
  const calls: string[] = [];
  const adapters = createAdapterHarness(calls, { verifyExitCode: 1 });
  await expect(adapters.dependencies.validate()).resolves.toEqual({
    ok: false,
    reason: "runtime-verification-failed",
  });
  expect(calls).toEqual(["verify-runtime"]);
});

it("spawns the locked executable with only show config, fixture poem, and private environment", async () => {
  const harness = createAdapterHarness([]);
  harness.baseEnvironment.MYVIMRC = "C:\\Users\\operator\\_vimrc";
  harness.baseEnvironment.VIMINIT = "source user.vim";
  harness.baseEnvironment.EXINIT = "source legacy.ex";
  harness.baseEnvironment.NVIM_APPNAME = "AstroNvim";
  harness.baseEnvironment.XDG_CONFIG_HOME = "C:\\Users\\operator\\.config";
  harness.baseEnvironment.XDG_DATA_HOME = "C:\\Users\\operator\\.local\\share";
  harness.baseEnvironment.XDG_STATE_HOME = "C:\\Users\\operator\\.local\\state";
  const bridge = await harness.dependencies.startBridge();
  const result = await harness.dependencies.startJanVim(bridge);
  expect(result).toMatchObject({ ok: true, child: { pid: 4242 } });
  expect(harness.spawnCall).toMatchObject({
    file: "D:\\show\\runtime\\janvim\\janvim-core.exe",
    args: [
      "--config",
      "D:\\show\\show\\janvim-show.toml",
      "D:\\show\\content\\fixture\\poem.txt",
    ],
  });
  expect(harness.spawnCall.env.JANVIM_USER_ROOT).toBe(
    "D:\\show\\runtime\\user-root",
  );
  expect(harness.spawnCall.env).not.toHaveProperty("MYVIMRC");
  expect(harness.spawnCall.env).not.toHaveProperty("VIMINIT");
  expect(harness.spawnCall.env).not.toHaveProperty("EXINIT");
  expect(harness.spawnCall.env).not.toHaveProperty("NVIM_APPNAME");
  expect(harness.spawnCall.env).not.toHaveProperty("XDG_CONFIG_HOME");
  expect(harness.spawnCall.env).not.toHaveProperty("XDG_DATA_HOME");
  expect(harness.spawnCall.env).not.toHaveProperty("XDG_STATE_HOME");
});
~~~~

Add these boundary assertions:

~~~~typescript
it("bounds verifier execution and opens only the guarded local renderer", async () => {
  const harness = createAdapterHarness([]);
  await harness.dependencies.validate();
  expect(harness.verifyInvocation).toMatchObject({
    timeoutMs: 30_000,
    maxStdoutBytes: 8_192,
    maxStderrBytes: 8_192,
  });
  await harness.dependencies.openSecondary(harness.secondaryDisplay);
  expect(harness.loadedUrl).toMatch(/^file:\/\/\//);
  expect(harness.secondaryLoadDeadlineMs).toBe(15_000);
  expect(harness.navigationGuardInstalled).toBe(true);
  expect(harness.requestFilter.urls).toEqual([
    "http://*/*",
    "https://*/*",
    "ws://*/*",
    "wss://*/*",
  ]);
  for (const url of [
    "http://example.invalid/a",
    "https://example.invalid/a",
    "ws://example.invalid/a",
    "wss://example.invalid/a",
  ]) {
    expect(harness.dispatchBeforeRequest(url)).toEqual({ cancel: true });
  }
});

it("places the exact child and returns its validated receipt for evidence", async () => {
  const harness = createAdapterHarness([]);
  const result = await harness.dependencies.placeJanVim(4242, {
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
  });
  expect(result).toMatchObject({
    ok: true,
    receipt: {
      pid: 4242,
      matchedWindowCount: 1,
      actual: { x: 0, y: 0, width: 1920, height: 1080 },
    },
  });
  expect(harness.placementInvocation).toMatchObject({
    pid: 4242,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  });
});

it("keeps the bridge on IPv4 loopback and redacts its token", async () => {
  const harness = createAdapterHarness([]);
  const bridge = await harness.dependencies.startBridge();
  expect(bridge.host).toBe("127.0.0.1");
  expect(harness.bridgeListenDeadlineMs).toBe(5_000);
  harness.log({ token: bridge.token, message: bridge.token });
  expect(harness.logText).not.toContain(bridge.token);
  expect(harness.logText).toContain("[REDACTED]");
});

it("finalizes evidence from the verified lock, confirmed map, and explicit snapshot", async () => {
  const harness = createAdapterHarness([]);
  await harness.dependencies.finalizeEvidence(validFinalizationSnapshot());
  expect(harness.evidenceRecord).toMatchObject({
    schema: 1,
    acceptanceScope: "two-real-monitors-projector-simulation",
    physicalProjectorsTested: false,
    displayMap: {
      path: "D:\\rehearsal\\display-map.json",
      sha256: harness.confirmedMapSha256,
    },
    artifact: {
      tag: "v0.10.1-gmk.4",
      commit: "e95633101d93f8448b0f906e918b5d836ab95273",
      coreBytes: 18_866_688,
      coreSha256: "224b3457d89fbc6cf946359683632f29f9262bae08b6f0d2e3043a3a7a6d83b3",
      layoutEngine: "orthogonal",
    },
  });
  expect(JSON.stringify(harness.evidenceRecord)).not.toContain(harness.bridgeToken);
  expect(JSON.stringify(harness.evidenceRecord)).not.toContain("C:\\Users\\operator");
});
~~~~

- [ ] **Step 6: Run adapter tests and observe RED**

Run:

~~~~powershell
npm test -- apps/controller/tests/g2-runtime-adapters.test.ts
~~~~

Expected: FAIL because g2-runtime-adapters.ts does not exist.

- [ ] **Step 7: Implement real adapters from existing modules**

createG2RuntimeDependencies must:

- call scripts/verify-runtime.ps1 through an injected execFile adapter with -NoProfile and
  -NonInteractive, 30,000 ms, and 8-KiB output limits;
- parse the confirmed map with the Task 2 parser and route screen.getAllDisplays() through
  routeDisplays;
- open apps/secondary-screen/dist/index.html using openSecondaryReadyWindow and the built
  apps/controller/dist/preload/preload.cjs; on that window's session install an onBeforeRequest
  filter for http://*/*, https://*/*, ws://*/*, and wss://*/* that always returns { cancel: true };
  bound local loadURL to 15,000 ms, destroy that exact window on timeout, and dispose both the
  request filter and navigation guard exactly once when the handle closes;
- create BridgeServer with randomBytes(24).toString("hex") and bound listen() to 5,000 ms;
- call launchJanVimProcess with the lock, exact runtime executable, show config, fixture poem,
  runtime/user-root, and inherited environment plus only the three JanVim show variables; remove
  MYVIMRC, VIMINIT, EXINIT, NVIM_APPNAME, XDG_CONFIG_HOME, XDG_DATA_HOME, and XDG_STATE_HOME from
  the copied base environment before buildJanVimChildEnvironment adds the show variables;
- call placeJanVimWindow with scripts/place-janvim-window.ps1 and a bounded execFile adapter;
- create DeterministicShowLoop from the parsed manifest, poem, bridge, secondary sender, and
  performance.now(); map renderer.apply(cue) to secondary.send(cue), but map renderer.showReady to
  a bounded structured log event only, because controller status—not loop rotation—owns the Start
  button and a reset must never re-arm it;
- create OneLoopDriver with real timer adapters;
- attach BoundedChildOutput to child stdout/stderr and BoundedLog to controller events; write only
  `$rehearsalRoot\janvim.stdout.log`, `$rehearsalRoot\janvim.stderr.log`,
  `$rehearsalRoot\controller.ndjson`, and `$rehearsalRoot\g2-run.json`, each with exclusive-create
  semantics so a Run never overwrites prior evidence.

createElectronCommandAdapters must parse every catalog read through
parseRehearsalDisplayCatalog, use same-directory `wx` temporary files for Capture and Confirm,
honor mustNotExist versus replace explicitly, and implement runWithDeadline with one timer that is
always cleared:

~~~~typescript
async function runWithDeadline<T>(
  timeoutMs: number,
  operation: () => Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("g2-command-timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
~~~~

It receives repositoryRoot computed from `app.getAppPath()` by the Electron entry; no adapter path
may derive from process.cwd(). The evidence finalizer re-reads and validates the lock and confirmed
map after runtime verification, hashes the exact display-map bytes, copies the immutable artifact
identity, uses the selected engine from the locked show config, and merges only the explicit Task 5 snapshot.
It never serializes the bridge token, private user root, inherited environment, or user paths.

Use an explicit environment copy and explicit denylist before calling the existing environment
builder:

~~~~typescript
const privateBaseEnvironment = { ...electronAdapters.baseEnvironment };
for (const key of [
  "MYVIMRC",
  "VIMINIT",
  "EXINIT",
  "NVIM_APPNAME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
] as const) {
  delete privateBaseEnvironment[key];
}
~~~~

Wrap the returned Node child so G2JanVimHandle.onClose uses `child.once("close", listener)`, not
the earlier `exit` event. Keep stdout and stderr captures open until that close event, then expose
their settled byte counts, tails, and truncation flags to classifyShutdown. The wrapper's kill
method calls kill once on that exact retained child object and never looks up a process by name.

Install the network request guard with the Electron 44 session API:

~~~~typescript
const remoteFilter = {
  urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"],
};
window.webContents.session.webRequest.onBeforeRequest(
  remoteFilter,
  (_details, callback) => callback({ cancel: true }),
);
const disposeRemoteFilter = (): void => {
  window.webContents.session.webRequest.onBeforeRequest(null);
};
~~~~

Change WindowPlacementValidation to:

~~~~typescript
export type WindowPlacementValidation =
  | { ok: true; receipt: WindowPlacementReceipt }
  | { ok: false; reason: string };
~~~~

Return { ok: true, receipt } only after validateWindowPlacementReceipt succeeds. Update existing
exact success assertions in window-placer.test.ts first so they fail against { ok: true }, then
implement this return shape. ShowController continues to consume only the structural ok field.

- [ ] **Step 8: Run Task 6 tests**

Run:

~~~~powershell
npm test -- apps/controller/tests/g2-command.test.ts apps/controller/tests/g2-runtime-adapters.test.ts apps/controller/tests/janvim-process.test.ts apps/controller/tests/window-placer.test.ts apps/controller/tests/display-router.test.ts
npm run typecheck
~~~~

Expected: selected tests and typecheck pass.

- [ ] **Step 9: Commit Task 6**

~~~~powershell
git add apps/controller/src/g2-command.ts apps/controller/tests/g2-command.test.ts apps/controller/src/g2-runtime-adapters.ts apps/controller/tests/g2-runtime-adapters.test.ts apps/controller/src/window-placer.ts apps/controller/tests/window-placer.test.ts
git commit -m "feat: add real G2 runtime adapters"
~~~~

### Task 7: Add the headless command dispatcher and sole Electron lifecycle entry

**Files:**
- Create: apps/controller/src/electron-command.ts
- Create: apps/controller/src/electron-lifecycle.ts
- Create: apps/controller/src/electron-main.ts
- Create: apps/controller/tests/electron-command.test.ts
- Create: apps/controller/tests/electron-lifecycle.test.ts
- Modify: apps/controller/package.json
- Modify: apps/controller/tests/preload-contract.test.ts

**Interfaces:**
- Consumes: G2Command, display-map capture/confirm, runtime dependencies, G2RuntimeComposition.
- Produces: runElectronCommand(command, adapters) from electron-command.ts.
- Produces: runElectronLifecycle(app, run) from electron-lifecycle.ts.
- Produces: top-level Electron app lifecycle only from electron-main.ts.

- [ ] **Step 1: Write failing lifecycle tests**

Create apps/controller/tests/electron-command.test.ts around injected
screen/filesystem/composition adapters. The test imports electron-command.ts and never imports
electron-main.ts or electron:

~~~~typescript
it("captures an unconfirmed catalog and quits without opening windows", async () => {
  const harness = createElectronHarness({ mode: "Capture" });
  await expect(runElectronCommand(harness.command, harness.adapters)).resolves.toBe(0);
  expect(harness.written.mappingStatus).toBe("unconfirmed");
  expect(harness.openedWindows).toBe(0);
  expect(harness.spawnedProcesses).toBe(0);
});

it("fails Capture at its 15-second deadline", async () => {
  const harness = createElectronHarness({
    mode: "Capture",
    deadlineExceeded: true,
  });
  await expect(runElectronCommand(harness.command, harness.adapters)).resolves.toBe(1);
  expect(harness.deadlineRequests).toEqual([15_000]);
  expect(harness.openedWindows).toBe(0);
  expect(harness.spawnedProcesses).toBe(0);
});

it("confirms only explicit captured IDs using a same-directory atomic replace", async () => {
  const harness = createElectronHarness({
    mode: "Confirm",
    primaryDisplayId: "111",
    secondaryDisplayId: "222",
  });
  await expect(runElectronCommand(harness.command, harness.adapters)).resolves.toBe(0);
  expect(harness.written).toMatchObject({
    mappingStatus: "confirmed",
    primary: { displayId: "111" },
    secondary: { displayId: "222" },
  });
  expect(harness.atomicRenameCount).toBe(1);
});

it("runs exactly one composition instance", async () => {
  const harness = createElectronHarness({ mode: "Run" });
  await expect(runElectronCommand(harness.command, harness.adapters)).resolves.toBe(0);
  expect(harness.compositionBootCount).toBe(1);
  expect(harness.cleanupCount).toBe(1);
});
~~~~

Add:

~~~~typescript
it("validates runtime and live display routing without opening or spawning", async () => {
  const harness = createElectronHarness({ mode: "ValidateOnly" });
  await expect(runElectronCommand(harness.command, harness.adapters)).resolves.toBe(0);
  expect(harness.validateCount).toBe(1);
  expect(harness.routeDisplaysCount).toBe(1);
  expect(harness.openedWindows).toBe(0);
  expect(harness.spawnedProcesses).toBe(0);
});

it("returns nonzero after composition cleanup on run failure", async () => {
  const harness = createElectronHarness({
    mode: "Run",
    completion: { ok: false, reason: "janvim-close-timeout" },
  });
  await expect(runElectronCommand(harness.command, harness.adapters)).resolves.toBe(1);
  expect(harness.cleanupCount).toBe(1);
});

it("awaits blocked boot cleanup before returning nonzero", async () => {
  const harness = createElectronHarness({
    mode: "Run",
    boot: { ready: false, reason: "window-rectangle-mismatch" },
    completion: { ok: false, reason: "window-rectangle-mismatch" },
  });
  const pending = runElectronCommand(harness.command, harness.adapters);
  await Promise.resolve();
  expect(harness.completionAwaited).toBe(true);
  harness.resolveCompletion();
  await expect(pending).resolves.toBe(1);
  expect(harness.cleanupCount).toBe(1);
});
~~~~

- [ ] **Step 2: Run and observe RED**

Run:

~~~~powershell
npm test -- apps/controller/tests/electron-command.test.ts
~~~~

Expected: FAIL because electron-command.ts does not exist.

- [ ] **Step 3: Implement bounded command dispatch**

Create electron-command.ts and keep runElectronCommand free of top-level effects:

~~~~typescript
export interface ElectronCommandAdapters {
  runWithDeadline<T>(timeoutMs: number, operation: () => Promise<T>): Promise<T>;
  getAllDisplays(): readonly RuntimeDisplay[];
  readCatalog(path: string): Promise<RehearsalDisplayCatalog>;
  writeJsonAtomic(
    path: string,
    value: unknown,
    options: { mustNotExist: true } | { replace: true },
  ): Promise<void>;
  createRuntimeDependencies(
    command: Extract<G2Command, { mode: "ValidateOnly" | "Run" }>,
  ): G2RuntimeDependencies;
  createComposition(dependencies: G2RuntimeDependencies): Pick<
    G2RuntimeComposition,
    "boot" | "completion" | "stop"
  >;
}

export async function runElectronCommand(
  command: G2Command,
  adapters: ElectronCommandAdapters,
): Promise<number> {
  if (command.mode === "Capture") {
    try {
      await adapters.runWithDeadline(15_000, async () => {
        const catalog = captureRehearsalDisplays(adapters.getAllDisplays());
        await adapters.writeJsonAtomic(command.displayMapPath, catalog, {
          mustNotExist: true,
        });
      });
      return 0;
    } catch {
      return 1;
    }
  }
  if (command.mode === "Confirm") {
    const catalog = await adapters.readCatalog(command.displayMapPath);
    const confirmed = confirmRehearsalDisplayMap(
      catalog,
      command.primaryDisplayId,
      command.secondaryDisplayId,
    );
    await adapters.writeJsonAtomic(command.displayMapPath, confirmed, { replace: true });
    return 0;
  }
  const dependencies = adapters.createRuntimeDependencies(command);
  if (command.mode === "ValidateOnly") {
    const validation = await dependencies.validate();
    if (!validation.ok) return 1;
    const route = await dependencies.routeDisplays();
    return route.state === "mapped" ? 0 : 1;
  }
  const composition = adapters.createComposition(dependencies);
  try {
    const boot = await composition.boot();
    if (!boot.ready) {
      await composition.completion;
      return 1;
    }
    const result = await composition.completion;
    return result.ok ? 0 : 1;
  } finally {
    await composition.stop();
  }
}
~~~~

- [ ] **Step 4: Write and implement the one-shot app lifecycle through RED/GREEN**

First create apps/controller/tests/electron-lifecycle.test.ts:

~~~~typescript
it("runs once and never creates a window through activation", async () => {
  const app = new FakeElectronApp();
  const run = vi.fn(async () => 0);
  const pending = runElectronLifecycle(app, run);
  app.emit("activate");
  app.resolveReady();
  await expect(pending).resolves.toBe(0);
  app.emit("activate");
  app.emit("window-all-closed");
  expect(run).toHaveBeenCalledTimes(1);
  expect(app.exitCount).toBe(1);
  expect(app.exitedWith).toBe(0);
  expect(app.createdWindowCount).toBe(0);
});
~~~~

Run:

~~~~powershell
npm test -- apps/controller/tests/electron-lifecycle.test.ts
~~~~

Expected: FAIL because electron-lifecycle.ts does not exist. Then create it:

~~~~typescript
export interface ElectronAppLifecycleAdapter {
  whenReady(): Promise<void>;
  on(event: "activate" | "window-all-closed", listener: () => void): void;
  exit(exitCode?: number): void;
}

export async function runElectronLifecycle(
  app: ElectronAppLifecycleAdapter,
  run: () => Promise<number>,
): Promise<number> {
  app.on("activate", () => {});
  app.on("window-all-closed", () => {});
  await app.whenReady();
  let exitCode: number;
  try {
    exitCode = await run();
  } catch {
    exitCode = 1;
  }
  app.exit(exitCode);
  return exitCode;
}
~~~~

Run the lifecycle test again and expect PASS.

- [ ] **Step 5: Write the failing package-entry contract**

Update apps/controller/tests/preload-contract.test.ts before creating the entry:

~~~~typescript
it("points the controller package at the sole compiled Electron entry", () => {
  const packageJson = JSON.parse(
    readFileSync(join(repositoryRoot, "apps/controller/package.json"), "utf8"),
  ) as { main: string };
  expect(packageJson.main).toBe("dist/src/electron-main.js");
  expect(
    existsSync(join(repositoryRoot, "apps/controller/src/electron-main.ts")),
  ).toBe(true);
});
~~~~

Run:

~~~~powershell
npm test -- apps/controller/tests/preload-contract.test.ts
~~~~

Expected: FAIL because package main is still dist/src/main.js and electron-main.ts does not exist.

- [ ] **Step 6: Implement the sole top-level Electron entry and package target**

Create electron-main.ts with no exported domain logic:

~~~~typescript
import { resolve } from "node:path";

import { app, BrowserWindow, ipcMain, screen } from "electron";

import { parseG2Command } from "./g2-command.js";
import { runElectronCommand } from "./electron-command.js";
import { runElectronLifecycle } from "./electron-lifecycle.js";
import { createElectronCommandAdapters } from "./g2-runtime-adapters.js";

void runElectronLifecycle(
  app,
  async () => {
    try {
      const repositoryRoot = resolve(app.getAppPath(), "..", "..");
      const command = parseG2Command(process.argv.slice(2), repositoryRoot);
      return await runElectronCommand(
        command,
        createElectronCommandAdapters({
          BrowserWindow,
          ipcMain,
          screen,
          repositoryRoot,
        }),
      );
    } catch {
      return 1;
    }
  },
);
~~~~

Change apps/controller/package.json:

~~~~json
"main": "dist/src/electron-main.js"
~~~~

App lifecycle behavior remains covered through the pure lifecycle function rather than source-text
matching.

- [ ] **Step 7: Run Task 7 tests and build**

Run:

~~~~powershell
npm test -- apps/controller/tests/electron-command.test.ts apps/controller/tests/electron-lifecycle.test.ts apps/controller/tests/preload-contract.test.ts
npm run typecheck
npm run build
if (-not (Test-Path -LiteralPath .\apps\controller\dist\src\electron-main.js)) { throw 'electron-main build output missing' }
if (-not (Test-Path -LiteralPath .\apps\controller\dist\preload\preload.cjs)) { throw 'preload build output missing' }
~~~~

Expected: tests, typecheck, and build pass; dist/src/electron-main.js and preload.cjs exist.

- [ ] **Step 8: Commit Task 7**

~~~~powershell
git add apps/controller/src/electron-command.ts apps/controller/src/electron-lifecycle.ts apps/controller/src/electron-main.ts apps/controller/tests/electron-command.test.ts apps/controller/tests/electron-lifecycle.test.ts apps/controller/package.json apps/controller/tests/preload-contract.test.ts
git commit -m "feat: add the real Electron G2 entry"
~~~~

### Task 8: Add the bounded PowerShell operator launcher and runbook

**Files:**
- Create: scripts/start-g2-rehearsal.ps1
- Create: tests/g2-launcher.test.ts
- Create: docs/operations/g2-monitor-rehearsal.md

**Interfaces:**
- Consumes: built Electron package, G2 command flags, verified runtime, external rehearsal root.
- Produces: operator commands for Capture, Confirm, ValidateOnly, Run and propagates exact exit code.

- [ ] **Step 1: Write failing launcher behavior tests**

Create tests/g2-launcher.test.ts. Stage the production script in a temporary exhibition fixture
with AGENTS.md, a fake node_modules/.bin/electron.cmd, built-entry sentinel, and fake
verify-runtime.ps1. Run the real PowerShell script and assert:

~~~~typescript
it("forwards one closed command without touching the checked-in display map", () => {
  const fixture = makeLauncherFixture();
  const result = runLauncher(fixture, [
    "-Mode",
    "Capture",
    "-RehearsalRoot",
    fixture.externalRoot,
    "-DisplayMapPath",
    fixture.externalMap,
  ]);
  expect(result.status).toBe(0);
  expect(readFileSync(fixture.invocationLog, "utf8")).toContain("--g2-mode=capture");
  expect(readFileSync(fixture.checkedInMap, "utf8")).toBe(fixture.checkedInMapBefore);
  expect(JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)!)).toMatchObject({
    schema: 1,
    mode: "Capture",
    exitCode: 0,
    displayMapPath: fixture.externalMap,
    runId: null,
  });
});

it.each([
  ["relative rehearsal root", ["-RehearsalRoot", "relative"]],
  ["same confirm IDs", ["-Mode", "Confirm", "-PrimaryDisplayId", "1", "-SecondaryDisplayId", "1"]],
  ["protected path", ["-RehearsalRoot", protectedPath]],
] as const)("rejects %s before Electron invocation", (_label, extraArgs) => {
  const fixture = makeLauncherFixture();
  const result = runLauncher(fixture, extraArgs);
  expect(result.status).not.toBe(0);
  expect(existsSync(fixture.invocationLog)).toBe(false);
});
~~~~

Also assert Run invokes verify-runtime first, a failed verifier prevents Electron, Electron exit code
is propagated, and no source/runtime path is deleted or moved.

- [ ] **Step 2: Run launcher tests and observe RED**

Run:

~~~~powershell
npm test -- tests/g2-launcher.test.ts
~~~~

Expected: FAIL because start-g2-rehearsal.ps1 does not exist.

- [ ] **Step 3: Implement the launcher**

Use this parameter surface:

~~~~powershell
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Capture', 'Confirm', 'ValidateOnly', 'Run')]
    [string]$Mode,

    [Parameter(Mandatory = $true)]
    [string]$RehearsalRoot,

    [Parameter(Mandatory = $true)]
    [string]$DisplayMapPath,

    [string]$PrimaryDisplayId,
    [string]$SecondaryDisplayId,

    [ValidatePattern('^[A-Za-z0-9._-]{1,64}$')]
    [string]$RunId
)
~~~~

Set ErrorActionPreference Stop and StrictMode Latest. Resolve repository root from PSScriptRoot and
require the JanVim Exhibition AGENTS marker. Validate all paths with GetFullPath, reject paths
inside the repository, D:\github\JanVim, or any of the three exact protected roots and their
descendants listed in Global Constraints. Reuse the path-boundary rule from Task 6 rather than a
plain StartsWith comparison. Require RehearsalRoot to be one direct child below
D:\VirtualData\JanVim-Exhibition-Rehearsals, and DisplayMapPath to be its direct child named
display-map.json. Capture requires a nonexistent map and may create only that exact external
RehearsalRoot directory; the other modes require the directory and map to exist. Confirm requires
two nonempty distinct IDs. ValidateOnly and Run require RunId equal to the RehearsalRoot basename.

For ValidateOnly and Run, invoke:

~~~~powershell
& pwsh -NoProfile -NonInteractive -File $verifyRuntime
if ($LASTEXITCODE -ne 0) {
    throw "runtime-verification-failed:$LASTEXITCODE"
}
~~~~

Then invoke the worktree-local node_modules/.bin/electron.cmd with the controller package and
closed long-form flags. Do not use Start-Process. Build the invocation without string evaluation
and return the exact Electron exit code:

~~~~powershell
$electronCommand = Join-Path $repositoryRoot 'node_modules\.bin\electron.cmd'
$controllerPackage = Join-Path $repositoryRoot 'apps\controller'
$electronArguments = @(
    $controllerPackage
    "--g2-mode=$($Mode.ToLowerInvariant())"
    "--rehearsal-root=$resolvedRehearsalRoot"
    "--display-map=$resolvedDisplayMapPath"
)
if ($Mode -eq 'Confirm') {
    $electronArguments += "--primary-display-id=$PrimaryDisplayId"
    $electronArguments += "--secondary-display-id=$SecondaryDisplayId"
}
if ($Mode -in @('ValidateOnly', 'Run')) {
    $electronArguments += "--run-id=$RunId"
}

& $electronCommand @electronArguments
$electronExitCode = $LASTEXITCODE
[pscustomobject]@{
    schema = 1
    mode = $Mode
    exitCode = $electronExitCode
    displayMapPath = $resolvedDisplayMapPath
    runId = if ($RunId) { $RunId } else { $null }
} | ConvertTo-Json -Compress
exit $electronExitCode
~~~~

- [ ] **Step 4: Write the operator runbook**

docs/operations/g2-monitor-rehearsal.md contains this exact setup and the four mode invocations:

~~~~powershell
Set-Location 'D:\github\JanVim-Exhibition-2026\.worktrees\task1'
$runId = "g2-monitor-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
$rehearsalRoot = Join-Path 'D:\VirtualData\JanVim-Exhibition-Rehearsals' $runId
$displayMapPath = Join-Path $rehearsalRoot 'display-map.json'

pwsh -NoProfile -File .\scripts\start-g2-rehearsal.ps1 -Mode Capture -RehearsalRoot $rehearsalRoot -DisplayMapPath $displayMapPath

Get-Content -Raw -LiteralPath $displayMapPath
$primaryDisplayId = Read-Host 'Enter the Electron ID physically verified as the primary monitor'
$secondaryDisplayId = Read-Host 'Enter the Electron ID physically verified as the secondary monitor'
pwsh -NoProfile -File .\scripts\start-g2-rehearsal.ps1 -Mode Confirm -RehearsalRoot $rehearsalRoot -DisplayMapPath $displayMapPath -PrimaryDisplayId $primaryDisplayId -SecondaryDisplayId $secondaryDisplayId

pwsh -NoProfile -File .\scripts\start-g2-rehearsal.ps1 -Mode ValidateOnly -RehearsalRoot $rehearsalRoot -DisplayMapPath $displayMapPath -RunId $runId

pwsh -NoProfile -File .\scripts\start-g2-rehearsal.ps1 -Mode Run -RehearsalRoot $rehearsalRoot -DisplayMapPath $displayMapPath -RunId $runId
~~~~

For each mode, document the launcher's final one-line JSON result and expected exit code. Also
document the six G2 observations verbatim from the approved design, local Start click, Alt+F4 only
after reset, and the exact `$rehearsalRoot\g2-run.json`, `controller.ndjson`,
`janvim.stdout.log`, and `janvim.stderr.log` paths. Warn that monitor success is not
physical-projector acceptance. Tell the operator to choose and physically set the secondary
monitor orientation before Capture, keep orientation/resolution/scale unchanged through Run, and
restart from a new Capture root after any display change. The commands never modify
show/display-map.json.

- [ ] **Step 5: Run Task 8 tests**

Run:

~~~~powershell
npm test -- tests/g2-launcher.test.ts
npm run typecheck
pwsh -NoProfile -File .\scripts\start-g2-rehearsal.ps1 -Mode ValidateOnly -RehearsalRoot D:\VirtualData\JanVim-Exhibition-Rehearsals\g2-validation-20260829 -DisplayMapPath D:\VirtualData\JanVim-Exhibition-Rehearsals\g2-validation-20260829\display-map.json -RunId g2-validation-20260829
~~~~

Expected: launcher tests pass. ValidateOnly exits nonzero until a confirmed external map exists,
with no JanVim or BrowserWindow process started.

- [ ] **Step 6: Commit Task 8**

~~~~powershell
git add scripts/start-g2-rehearsal.ps1 tests/g2-launcher.test.ts docs/operations/g2-monitor-rehearsal.md
git commit -m "feat: add the bounded G2 rehearsal launcher"
~~~~

### Task 9: Run all gates and prepare the human G2 checkpoint

**Files:**
- Modify only if verification reveals a directly related defect, always through a new failing test.
- External evidence: the `$rehearsalRoot` generated by the Task 8 runbook under
  D:\VirtualData\JanVim-Exhibition-Rehearsals.

**Interfaces:**
- Consumes every previous task.
- Produces a clean verified branch and exact operator commands; physical G2 remains a human gate.

- [ ] **Step 1: Run repository and runtime verification**

~~~~powershell
npm ci
npm run typecheck
npm test
npm run lint
npm run build
pwsh -NoProfile -File .\scripts\verify-runtime.ps1
$core = Get-Item -LiteralPath .\runtime\janvim\janvim-core.exe
$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $core.FullName
[pscustomobject]@{
    Bytes = $core.Length
    Sha256 = $hash.Hash.ToLowerInvariant()
}
git diff --check
git status --short
~~~~

Expected:

- 0 failing tests;
- typecheck, lint, and build exit 0;
- runtime-verified reports layoutEngine orthogonal;
- core bytes are 18866688;
- core SHA-256 is 224b3457d89fbc6cf946359683632f29f9262bae08b6f0d2e3043a3a7a6d83b3;
- no runtime files are tracked;
- worktree is clean after all task commits.

- [ ] **Step 2: Capture the live Electron display catalog**

Choose a new run ID and execute the runbook Capture command. Expected: an external unconfirmed
catalog with exactly two Electron IDs, bounds 0,0,1920,1080 and 1920,0,1920,1080, and scale 1 for
the current monitor setup. No show window or JanVim process starts.

- [ ] **Step 3: Stop for explicit physical-map confirmation**

Present the captured IDs and geometry to the user. Do not run Confirm by guessing. After the user
names primary and secondary IDs, execute the runbook Confirm and ValidateOnly commands. Expected:
confirmed map hashes validate and ValidateOnly exits 0 without starting JanVim.

- [ ] **Step 4: Run one real 90-second G2 loop**

Execute Run. The user clicks the local Start button only after it enables, observes all six G2
criteria, and closes JanVim with Alt+F4 after reset. Read the generated evidence and raw logs.

- [ ] **Step 5: Decide G2 from evidence**

G2 passes only if evidence reports completedLoops 1, resetRestoredPoem true, natural shutdown true,
zero stderr, matching placement, and the user confirms all six observations. Otherwise record the
stable failure reason and return to the failing-test task that owns it. Do not begin Task 9 recovery
or final projector acceptance while G2 is failed.

- [ ] **Step 6: Commit only a factual checked-in note if the repository runbook requires it**

The external evidence remains outside Git. If a checked-in factual note is added, include its file
explicitly and commit:

~~~~powershell
git add docs/operations/g2-monitor-rehearsal.md
git commit -m "docs: record the monitor G2 rehearsal result"
~~~~

Skip this commit when the runbook itself is unchanged; never create an empty commit.
