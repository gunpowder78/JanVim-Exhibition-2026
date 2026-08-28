import { describe, expect, it, vi } from "vitest";

import type {
  AgentAck,
  AgentCommand,
  ControllerStatusEvent,
  RendererEvent,
} from "@janvim-exhibition/show-schema";

import type { RuntimeDisplay } from "../src/display-router.ts";
import type { G2ShutdownEvidence } from "../src/g2-evidence.ts";
import type { DeterministicShowLoop, ShowController } from "../src/main.ts";
import type { OneLoopDriver, OneLoopTimerHandle } from "../src/one-loop-driver.ts";
import {
  G2RuntimeComposition,
  type G2BridgeHandle,
  type G2JanVimHandle,
  type G2RuntimeDependencies,
  type G2SecondaryHandle,
} from "../src/runtime-composition.ts";
import type { WindowPlacementReceipt } from "../src/window-placer.ts";

class FakeCompositionTimers {
  private readonly timeouts = new Map<
    number,
    { id: number; delayMs: number; callback: () => void }
  >();
  private nextId = 1;

  public setTimeout(callback: () => void, delayMs: number): number {
    const timeout = { id: this.nextId, delayMs, callback };
    this.nextId += 1;
    this.timeouts.set(timeout.id, timeout);
    return timeout.id;
  }

  public clearTimeout(id: OneLoopTimerHandle): void {
    if (typeof id === "number") this.timeouts.delete(id);
  }

  public timeoutDelays(): number[] {
    return [...this.timeouts.values()].map((timeout) => timeout.delayMs);
  }

  public async fireTimeout(delayMs: number): Promise<void> {
    const timeout = [...this.timeouts.values()].find((entry) => entry.delayMs === delayMs);
    if (timeout === undefined) throw new Error(`no timeout scheduled at ${delayMs} ms`);
    this.timeouts.delete(timeout.id);
    await timeout.callback();
    await Promise.resolve();
  }
}

type FailureStage = "validate" | "route-displays" | "place-janvim" | "prepare-loop";

interface HarnessOptions {
  failAt?: FailureStage;
  reason?: string;
  evidenceWriteFails?: boolean;
  bridgeCloseNeverSettles?: boolean;
  bridgeCloseRejects?: boolean;
}

const primary: RuntimeDisplay = {
  displayId: 111,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  scaleFactor: 1,
};
const secondaryDisplay: RuntimeDisplay = {
  displayId: 222,
  bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
  scaleFactor: 1,
};
const placementReceipt: WindowPlacementReceipt = {
  schema: 1,
  pid: 5150,
  matchedWindowCount: 1,
  hwnd: "0x000000000000141E",
  visible: true,
  owned: false,
  requested: { ...primary.bounds },
  actual: { ...primary.bounds },
};

function createCompositionHarness(calls: string[], options: HarnessOptions = {}) {
  const timers = new FakeCompositionTimers();
  const statuses: ControllerStatusEvent[] = [];
  const logEvents: Array<Record<string, unknown>> = [];
  let controller: ShowController | undefined;
  let childCloseListener: ((exitCode: number | null) => void) | undefined;
  let secondaryDestroyedListener: (() => void) | undefined;
  let driverCallbacks:
    | { onComplete(): void; onFailure(reason: string): void }
    | undefined;
  let shutdownClassification: Omit<G2ShutdownEvidence, "processExitCode"> = {
    natural: false,
    reason: "janvim-shutdown-summary-invalid",
    stdoutBytes: 4096,
    stderrBytes: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
  };
  let statusCountAtStart = 0;

  const child: G2JanVimHandle = {
    pid: 5150,
    onClose: (listener) => {
      childCloseListener = listener;
      return vi.fn(() => {
        if (childCloseListener === listener) childCloseListener = undefined;
      });
    },
    kill: vi.fn(() => true),
  };
  const secondary: G2SecondaryHandle = {
    send: vi.fn((event: RendererEvent) => {
      if ("type" in event && event.type === "controller-status") {
        statuses.push(event);
        if (event.state !== "booting") calls.push(`status-${event.state}`);
      }
    }),
    onDestroyed: (listener) => {
      secondaryDestroyedListener = listener;
      return vi.fn();
    },
    close: vi.fn(),
  };
  const bridge: G2BridgeHandle = {
    host: "127.0.0.1",
    port: 32123,
    token: "controller-token-2026",
    waitForAgent: vi.fn(async (_timeoutMs: 10_000) => {
      calls.push("wait-agent");
    }),
    dispatch: vi.fn(async (_command: AgentCommand): Promise<AgentAck> => {
      throw new Error("dispatch is not used by the composition fake");
    }),
    close: vi.fn(() =>
      options.bridgeCloseNeverSettles === true
        ? new Promise<void>(() => undefined)
        : options.bridgeCloseRejects === true
          ? Promise.reject(new Error("bridge close failed"))
          : Promise.resolve(),
    ),
  };
  const loop = {
    state: "booting",
    completedLoops: 0,
    prepare: vi.fn(async () => {
      calls.push("prepare-loop");
      if (options.failAt === "prepare-loop") return false;
      loop.state = "ready";
      return true;
    }),
  } as unknown as DeterministicShowLoop;
  const driver = {
    start: vi.fn(() => {
      calls.push("start-driver");
      return true;
    }),
    stop: vi.fn(),
    diagnostics: vi.fn(() => ({ running: false, advancing: false, maxDriftMs: 7 })),
  } as unknown as OneLoopDriver;
  const finalizeEvidence = vi.fn(async () => {
    if (options.evidenceWriteFails === true) {
      throw new Error("evidence write failed");
    }
  });

  const dependencies: G2RuntimeDependencies = {
    validate: async () => {
      calls.push("validate");
      return options.failAt === "validate"
        ? { ok: false, reason: options.reason ?? "artifact-invalid" }
        : { ok: true };
    },
    routeDisplays: async () => {
      calls.push("route-displays");
      return options.failAt === "route-displays"
        ? { state: "ready", reason: options.reason ?? "display-map-unconfirmed" }
        : { state: "mapped", primary, secondary: secondaryDisplay };
    },
    openSecondary: async () => {
      calls.push("open-secondary");
      return secondary;
    },
    bindStart: (boundController) => {
      calls.push("bind-start");
      controller = boundController;
      return vi.fn();
    },
    startBridge: async () => {
      calls.push("start-bridge");
      return bridge;
    },
    startJanVim: async () => {
      calls.push("start-janvim");
      return { ok: true, child };
    },
    placeJanVim: async () => {
      calls.push("place-janvim");
      return options.failAt === "place-janvim"
        ? { ok: false, reason: options.reason ?? "window-rectangle-mismatch" }
        : { ok: true, receipt: placementReceipt };
    },
    createLoop: () => loop,
    createDriver: (_loop, callbacks) => {
      driverCallbacks = callbacks;
      return driver;
    },
    timers,
    log: (event) => logEvents.push(event),
    classifyShutdown: vi.fn(async (exitCode) => ({
      processExitCode: exitCode,
      ...shutdownClassification,
    })),
    finalizeEvidence,
  };
  const composition = new G2RuntimeComposition(dependencies);

  return {
    composition,
    timers,
    statuses,
    child,
    bridge,
    secondary,
    driver,
    finalizeEvidence,
    startLocally: () => {
      if (controller === undefined) throw new Error("Start was not bound");
      statusCountAtStart = statuses.length;
      return controller.requestStart({ schema: 1, source: "local-ready-page" });
    },
    exitChild: (code: number | null) => {
      if (childCloseListener === undefined) throw new Error("child close listener is not bound");
      childCloseListener(code);
    },
    destroySecondary: () => {
      if (secondaryDestroyedListener === undefined) {
        throw new Error("secondary destroy listener is not bound");
      }
      secondaryDestroyedListener();
    },
    completeLoop: () => {
      if (driverCallbacks === undefined) throw new Error("driver callbacks are not bound");
      loop.completedLoops = 1;
      driverCallbacks.onComplete();
    },
    failDriver: (reason: string) => {
      if (driverCallbacks === undefined) throw new Error("driver callbacks are not bound");
      driverCallbacks.onFailure(reason);
    },
    setShutdownClassification: (value: {
      natural: boolean;
      reason: string;
    }) => {
      shutdownClassification = { ...shutdownClassification, ...value };
    },
    cleanupCount: () =>
      logEvents.filter((event) => event.event === "g2-runtime-cleanup").length,
    get logEvents() {
      return logEvents;
    },
    readyStatusCountAfterStart: () =>
      statuses
        .slice(statusCountAtStart)
        .filter((status) => status.state === "ready").length,
  };
}

describe("G2 runtime composition", () => {
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
    expect(harness.statuses[0]).toMatchObject({
      type: "controller-status",
      state: "booting",
    });
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
    if (stage === "place-janvim" || stage === "prepare-loop") {
      expect(harness.statuses.at(-1)).toMatchObject({
        type: "controller-status",
        state: "blocked",
        reason,
      });
    }
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
    expect(harness.finalizeEvidence).not.toHaveBeenCalled();
  });

  it("logs the stable reason when validation fails before evidence is available", async () => {
    const harness = createCompositionHarness([], {
      failAt: "validate",
      reason: "runtime-input-invalid",
    });

    await harness.composition.boot();
    await harness.composition.completion;

    expect(harness.logEvents).toContainEqual({
      event: "g2-runtime-cleanup",
      ok: false,
      failureReason: "runtime-input-invalid",
      completedLoops: 0,
      maxDriftMs: 0,
      placementRecorded: false,
    });
  });

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
    expect(harness.child.kill).not.toHaveBeenCalled();
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
    expect(harness.finalizeEvidence).toHaveBeenCalledWith({
      result: { ok: true },
      placement: placementReceipt,
      completedLoops: 1,
      maxDriftMs: 7,
      resetRestoredPoem: true,
      shutdown: {
        processExitCode: 0,
        natural: true,
        reason: "frontend-shutdown-graceful",
        stdoutBytes: 4096,
        stderrBytes: 0,
        stdoutTruncated: false,
        stderrTruncated: false,
      },
    });
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
    expect(harness.driver.stop).toHaveBeenCalledTimes(1);
    expect(harness.bridge.close).toHaveBeenCalledTimes(1);
    expect(harness.secondary.close).toHaveBeenCalledTimes(1);
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
    expect(harness.child.kill).toHaveBeenCalledTimes(1);
    expect(harness.finalizeEvidence).toHaveBeenCalledTimes(1);
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

  it("turns evidence write failure into a failed run", async () => {
    const harness = createCompositionHarness([], { evidenceWriteFails: true });
    await harness.composition.boot();
    harness.startLocally();
    harness.completeLoop();
    harness.setShutdownClassification({
      natural: true,
      reason: "frontend-shutdown-graceful",
    });
    harness.exitChild(0);
    await expect(harness.composition.completion).resolves.toEqual({
      ok: false,
      reason: "g2-evidence-write-failed",
    });
    expect(harness.finalizeEvidence).toHaveBeenCalledTimes(1);
  });

  it("bounds a non-settling Bridge close and fails an otherwise passed run", async () => {
    const harness = createCompositionHarness([], { bridgeCloseNeverSettles: true });
    await harness.composition.boot();
    harness.startLocally();
    harness.completeLoop();
    harness.setShutdownClassification({
      natural: true,
      reason: "frontend-shutdown-graceful",
    });
    harness.exitChild(0);
    await Promise.resolve();

    expect(harness.timers.timeoutDelays()).toContain(5_000);
    await harness.timers.fireTimeout(5_000);

    await expect(harness.composition.completion).resolves.toEqual({
      ok: false,
      reason: "g2-bridge-close-timeout",
    });
    expect(harness.secondary.close).toHaveBeenCalledTimes(1);
    expect(harness.logEvents).toContainEqual({ event: "g2-bridge-close-timeout" });
  });

  it("fails an otherwise passed run when Bridge close rejects", async () => {
    const harness = createCompositionHarness([], { bridgeCloseRejects: true });
    await harness.composition.boot();
    harness.startLocally();
    harness.completeLoop();
    harness.setShutdownClassification({
      natural: true,
      reason: "frontend-shutdown-graceful",
    });
    harness.exitChild(0);

    await expect(harness.composition.completion).resolves.toEqual({
      ok: false,
      reason: "g2-bridge-close-failed",
    });
    expect(harness.finalizeEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        result: { ok: false, reason: "g2-bridge-close-failed" },
      }),
    );
    expect(harness.logEvents).toContainEqual({ event: "g2-bridge-close-failed" });
  });
});
