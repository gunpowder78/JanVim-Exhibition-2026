import { describe, expect, it, vi } from "vitest";

import {
  MultiLoopDriver,
  type MultiLoopBoundary,
} from "../src/multi-loop-driver.ts";
import {
  type OneLoopRuntime,
  type OneLoopTimerAdapter,
  type OneLoopTimerHandle,
} from "../src/one-loop-driver.ts";

interface ScheduledCallback {
  id: number;
  delayMs: number;
  callback: () => unknown;
}

class FakeTimers implements OneLoopTimerAdapter {
  private readonly intervals = new Map<number, ScheduledCallback>();
  private readonly timeouts = new Map<number, ScheduledCallback>();
  private nextId = 1;
  private now = 0;
  public readonly intervalSetDelays: number[] = [];
  public readonly timeoutSetDelays: number[] = [];
  public readonly clearedIntervals: OneLoopTimerHandle[] = [];
  public readonly clearedTimeouts: OneLoopTimerHandle[] = [];

  public setInterval(callback: () => void, delayMs: number): number {
    const scheduled = { id: this.nextId, delayMs, callback };
    this.nextId += 1;
    this.intervals.set(scheduled.id, scheduled);
    this.intervalSetDelays.push(delayMs);
    return scheduled.id;
  }

  public clearInterval(id: OneLoopTimerHandle): void {
    this.clearedIntervals.push(id);
    if (typeof id === "number") this.intervals.delete(id);
  }

  public setTimeout(callback: () => void, delayMs: number): number {
    const scheduled = { id: this.nextId, delayMs, callback };
    this.nextId += 1;
    this.timeouts.set(scheduled.id, scheduled);
    this.timeoutSetDelays.push(delayMs);
    return scheduled.id;
  }

  public clearTimeout(id: OneLoopTimerHandle): void {
    this.clearedTimeouts.push(id);
    if (typeof id === "number") this.timeouts.delete(id);
  }

  public nowMonotonic(): number {
    return this.now;
  }

  public setNow(value: number): void {
    this.now = value;
  }

  public async fireInterval(delayMs = 16): Promise<void> {
    const scheduled = [...this.intervals.values()].find((entry) => entry.delayMs === delayMs);
    if (scheduled === undefined) throw new Error(`no interval scheduled at ${delayMs} ms`);
    await scheduled.callback();
  }

  public async fireTimeout(delayMs: number): Promise<void> {
    const scheduled = [...this.timeouts.values()].find((entry) => entry.delayMs === delayMs);
    if (scheduled === undefined) throw new Error(`no timeout scheduled at ${delayMs} ms`);
    this.timeouts.delete(scheduled.id);
    await scheduled.callback();
  }

  public diagnostics(): { intervals: number; timeouts: number } {
    return { intervals: this.intervals.size, timeouts: this.timeouts.size };
  }
}

interface HarnessOptions {
  loopDurationMs?: number;
  loopLimit?: 3 | null;
  afterAdvance?: (runtime: OneLoopRuntime) => void | Promise<void>;
}

function createHarness(options: HarnessOptions = {}) {
  const timers = new FakeTimers();
  const runtime: OneLoopRuntime = {
    state: "ready",
    completedLoops: 0,
    start: vi.fn(() => {
      runtime.state = "running";
      return true;
    }),
    advance: vi.fn(async () => {
      await options.afterAdvance?.(runtime);
      return 0;
    }),
    stop: vi.fn(() => {
      runtime.state = "stopped";
    }),
  };
  const boundaries: MultiLoopBoundary[] = [];
  const onLoopBoundary = vi.fn((boundary: MultiLoopBoundary) => boundaries.push(boundary));
  const onComplete = vi.fn();
  const onFailure = vi.fn();
  const driver = new MultiLoopDriver({
    runtime,
    timers,
    clock: { nowMonotonic: () => timers.nowMonotonic() },
    loopDurationMs: options.loopDurationMs ?? 90_000,
    loopLimit: options.loopLimit === undefined ? 3 : options.loopLimit,
    onLoopBoundary,
    onComplete,
    onFailure,
  });
  return {
    timers,
    runtime,
    boundaries,
    onLoopBoundary,
    onComplete,
    onFailure,
    driver,
  };
}

async function completeLoops(
  harness: ReturnType<typeof createHarness>,
  completionTimesMs: number[],
): Promise<void> {
  for (const nowMs of completionTimesMs) {
    harness.timers.setNow(nowMs);
    await harness.timers.fireInterval();
  }
}

describe("multi-loop driver", () => {
  it("runs exactly three non-overlapping loops in Soak3 mode", async () => {
    const harness = createHarness({
      afterAdvance: (runtime) => {
        runtime.completedLoops += 1;
      },
    });

    expect(harness.driver.start()).toBe(true);
    await completeLoops(harness, [16, 32, 48]);

    expect(harness.boundaries).toEqual([
      {
        loopNumber: 1,
        completedAtMs: 16,
        tickLatenessMs: 0,
        advanceOverrunMs: 0,
      },
      {
        loopNumber: 2,
        completedAtMs: 32,
        tickLatenessMs: 0,
        advanceOverrunMs: 0,
      },
      {
        loopNumber: 3,
        completedAtMs: 48,
        tickLatenessMs: 0,
        advanceOverrunMs: 0,
      },
    ]);
    expect(harness.onComplete).toHaveBeenCalledTimes(1);
    expect(harness.onFailure).not.toHaveBeenCalled();
    expect(harness.runtime.stop).toHaveBeenCalledTimes(1);
    expect(harness.timers.diagnostics()).toEqual({ intervals: 0, timeouts: 0 });
    expect(harness.driver.diagnostics()).toEqual({
      running: false,
      advancing: false,
      observedLoops: 3,
      timers: 0,
      tickLatenessMs: 0,
      advanceOverrunMs: 0,
    });
  });

  it("continues beyond the fourth reset in Show mode", async () => {
    const harness = createHarness({
      loopLimit: null,
      afterAdvance: (runtime) => {
        runtime.completedLoops += 1;
      },
    });

    expect(harness.driver.start()).toBe(true);
    await completeLoops(harness, [16, 32, 48, 64]);

    expect(harness.boundaries.map((boundary) => boundary.loopNumber)).toEqual([1, 2, 3, 4]);
    expect(harness.onComplete).not.toHaveBeenCalled();
    expect(harness.runtime.stop).not.toHaveBeenCalled();
    expect(harness.driver.diagnostics()).toMatchObject({
      running: true,
      observedLoops: 4,
      timers: 2,
    });
  });

  it("clears and rearms one bounded deadline after every loop", async () => {
    const harness = createHarness({
      loopLimit: null,
      afterAdvance: (runtime) => {
        runtime.completedLoops += 1;
      },
    });

    harness.driver.start();
    expect(harness.timers.timeoutSetDelays).toEqual([100_000]);

    await completeLoops(harness, [16, 32]);
    expect(harness.timers.timeoutSetDelays).toEqual([100_000, 100_000, 100_000]);
    expect(harness.timers.clearedTimeouts).toHaveLength(2);
    expect(harness.timers.diagnostics()).toEqual({ intervals: 1, timeouts: 1 });

    await harness.timers.fireTimeout(100_000);
    expect(harness.onFailure).toHaveBeenCalledWith("loop-deadline-exceeded");
    expect(harness.runtime.stop).toHaveBeenCalledTimes(1);
    expect(harness.timers.diagnostics()).toEqual({ intervals: 0, timeouts: 0 });
  });

  it("suppresses overlapping ticks while advance is in flight", async () => {
    let release!: () => void;
    const pendingAdvance = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = createHarness({
      loopLimit: null,
      afterAdvance: async () => pendingAdvance,
    });
    harness.driver.start();
    harness.timers.setNow(16);

    const firstTick = harness.timers.fireInterval();
    harness.timers.setNow(32);
    await harness.timers.fireInterval();
    expect(harness.runtime.advance).toHaveBeenCalledTimes(1);
    expect(harness.driver.diagnostics().advancing).toBe(true);

    release();
    await firstTick;
    expect(harness.driver.diagnostics().advancing).toBe(false);
  });

  it("fails closed when the runtime skips a loop count", async () => {
    const harness = createHarness({
      afterAdvance: (runtime) => {
        runtime.completedLoops = 2;
      },
    });
    harness.driver.start();
    harness.timers.setNow(16);
    await harness.timers.fireInterval();

    expect(harness.onFailure).toHaveBeenCalledWith("loop-count-skipped");
    expect(harness.onLoopBoundary).not.toHaveBeenCalled();
    expect(harness.onComplete).not.toHaveBeenCalled();
    expect(harness.runtime.stop).toHaveBeenCalledTimes(1);
  });

  it("fails closed on safe-black, early stop, or a rejected advance", async () => {
    for (const [state, reason] of [
      ["safe-black", "loop-runtime-safe-black"],
      ["stopped", "loop-stopped-before-reset"],
    ] as const) {
      const harness = createHarness({
        afterAdvance: (runtime) => {
          runtime.state = state;
        },
      });
      harness.driver.start();
      harness.timers.setNow(16);
      await harness.timers.fireInterval();
      expect(harness.onFailure).toHaveBeenCalledWith(reason);
      expect(harness.runtime.stop).toHaveBeenCalledTimes(1);
    }

    const advanceFailure = createHarness({
      afterAdvance: () => {
        throw new Error("advance rejected");
      },
    });
    advanceFailure.driver.start();
    advanceFailure.timers.setNow(16);
    await advanceFailure.timers.fireInterval();
    expect(advanceFailure.onFailure).toHaveBeenCalledWith("loop-advance-failed");
    expect(advanceFailure.runtime.stop).toHaveBeenCalledTimes(1);
  });

  it("queues one idempotent stop and executes it only at the next reset", async () => {
    const harness = createHarness({
      loopLimit: null,
      afterAdvance: (runtime) => {
        runtime.completedLoops += 1;
      },
    });
    harness.driver.start();

    expect(harness.driver.requestStopAtBoundary()).toBe(true);
    expect(harness.driver.requestStopAtBoundary()).toBe(false);
    expect(harness.runtime.stop).not.toHaveBeenCalled();
    expect(harness.driver.diagnostics().running).toBe(true);

    await completeLoops(harness, [16]);
    expect(harness.boundaries.map((boundary) => boundary.loopNumber)).toEqual([1]);
    expect(harness.onComplete).toHaveBeenCalledTimes(1);
    expect(harness.runtime.stop).toHaveBeenCalledTimes(1);
    expect(harness.driver.requestStopAtBoundary()).toBe(false);
  });

  it("clears its interval and deadline exactly once on explicit stop", () => {
    const harness = createHarness();
    harness.driver.start();
    expect(harness.driver.diagnostics().timers).toBe(2);

    harness.driver.stop();
    harness.driver.stop();

    expect(harness.timers.clearedIntervals).toHaveLength(1);
    expect(harness.timers.clearedTimeouts).toHaveLength(1);
    expect(harness.runtime.stop).toHaveBeenCalledTimes(1);
    expect(harness.onComplete).not.toHaveBeenCalled();
    expect(harness.onFailure).not.toHaveBeenCalled();
    expect(harness.driver.diagnostics().timers).toBe(0);
  });

  it("re-anchors tick lateness instead of accumulating timer quantization", async () => {
    const harness = createHarness({ loopLimit: null });
    harness.driver.start();

    await completeLoops(harness, [31, 62, 93]);

    expect(harness.driver.diagnostics()).toMatchObject({
      tickLatenessMs: 15,
      advanceOverrunMs: 0,
    });
  });

  it("records terminal advance overrun separately from tick lateness", async () => {
    let release!: () => void;
    const pendingAdvance = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = createHarness({
      loopLimit: null,
      afterAdvance: async (runtime) => {
        await pendingAdvance;
        runtime.completedLoops = 1;
      },
    });
    harness.driver.start();
    expect(harness.driver.requestStopAtBoundary()).toBe(true);
    harness.timers.setNow(16);
    const terminalTick = harness.timers.fireInterval();

    harness.timers.setNow(1_316);
    release();
    await terminalTick;

    expect(harness.boundaries).toEqual([
      {
        loopNumber: 1,
        completedAtMs: 1_316,
        tickLatenessMs: 0,
        advanceOverrunMs: 1_284,
      },
    ]);
    expect(harness.onComplete).toHaveBeenCalledTimes(1);
    expect(harness.driver.diagnostics()).toEqual({
      running: false,
      advancing: false,
      observedLoops: 1,
      timers: 0,
      tickLatenessMs: 0,
      advanceOverrunMs: 1_284,
    });
  });
});
