import { describe, expect, it, vi } from "vitest";

import type { DeterministicShowLoopState } from "../src/main.ts";
import {
  OneLoopDriver,
  type OneLoopRuntime,
  type OneLoopTimerAdapter,
  type OneLoopTimerHandle,
} from "../src/one-loop-driver.ts";

interface ScheduledCallback {
  id: number;
  delayMs: number;
  callback: () => void;
}

class FakeTimers implements OneLoopTimerAdapter {
  private readonly intervals = new Map<number, ScheduledCallback>();
  private readonly timeouts = new Map<number, ScheduledCallback>();
  private nextId = 1;
  private now = 0;

  public setInterval(callback: () => void, delayMs: number): number {
    const scheduled = { id: this.nextId, delayMs, callback };
    this.nextId += 1;
    this.intervals.set(scheduled.id, scheduled);
    return scheduled.id;
  }

  public clearInterval(id: OneLoopTimerHandle): void {
    if (typeof id === "number") this.intervals.delete(id);
  }

  public setTimeout(callback: () => void, delayMs: number): number {
    const scheduled = { id: this.nextId, delayMs, callback };
    this.nextId += 1;
    this.timeouts.set(scheduled.id, scheduled);
    return scheduled.id;
  }

  public clearTimeout(id: OneLoopTimerHandle): void {
    if (typeof id === "number") this.timeouts.delete(id);
  }

  public nowMonotonic(): number {
    return this.now;
  }

  public setNow(value: number): void {
    this.now = value;
  }

  public intervalAt(delayMs: number): () => Promise<void> {
    const scheduled = [...this.intervals.values()].find((entry) => entry.delayMs === delayMs);
    if (scheduled === undefined) throw new Error(`no interval scheduled at ${delayMs} ms`);
    return async () => {
      await scheduled.callback();
    };
  }

  public async fireInterval(delayMs: number): Promise<void> {
    await this.intervalAt(delayMs)();
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

function createDriverHarness(
  loopDurationMs: number,
  options: {
    afterAdvance?: (runtime: OneLoopRuntime) => void;
    advanceError?: Error;
  } = {},
) {
  const timers = new FakeTimers();
  const runtime: OneLoopRuntime = {
    state: "ready" as DeterministicShowLoopState,
    completedLoops: 0,
    start: vi.fn(() => {
      runtime.state = "running";
      return true;
    }),
    stop: vi.fn(() => {
      runtime.state = "stopped";
    }),
    advance: vi.fn(async () => {
      if (options.advanceError !== undefined) throw options.advanceError;
      options.afterAdvance?.(runtime);
      return 0;
    }),
  };
  const completed = vi.fn();
  const failed = vi.fn();
  const driver = new OneLoopDriver({
    runtime,
    timers,
    clock: { nowMonotonic: () => timers.nowMonotonic() },
    loopDurationMs,
    onComplete: completed,
    onFailure: failed,
  });
  return { timers, runtime, completed, failed, driver };
}

function createDeferredAdvanceHarness(loopDurationMs: number) {
  let release!: () => void;
  const advanceReleased = new Promise<void>((resolve) => {
    release = resolve;
  });
  const harness = createDriverHarness(loopDurationMs);
  harness.runtime.advance = vi.fn(async () => {
    await advanceReleased;
    harness.runtime.completedLoops = 1;
    return 1;
  });
  return {
    ...harness,
    completeOneLoopAndReleaseAdvance: release,
  };
}

describe("one-loop driver", () => {
  it("stops immediately after one reset and never overlaps advance", async () => {
    const timers = new FakeTimers();
    let release!: () => void;
    const firstAdvance = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runtime: OneLoopRuntime = {
      state: "ready" as DeterministicShowLoopState,
      completedLoops: 0,
      start: () => {
        runtime.state = "running";
        return true;
      },
      stop: vi.fn(() => {
        runtime.state = "stopped";
      }),
      advance: vi.fn(async () => {
        await firstAdvance;
        runtime.completedLoops = 1;
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
    expect(timers.diagnostics()).toEqual({ intervals: 0, timeouts: 0 });
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
    expect(harness.timers.diagnostics()).toEqual({ intervals: 0, timeouts: 0 });
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

    expect(harness.completed).toHaveBeenCalledTimes(1);
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

  it("reports bounded failures for advance errors, early stops, and invalid loop counts", async () => {
    const advanceFailure = createDriverHarness(90_000, {
      advanceError: new Error("advance failed"),
    });
    advanceFailure.driver.start();
    await advanceFailure.timers.fireInterval(16);
    expect(advanceFailure.failed).toHaveBeenCalledWith("loop-advance-failed");

    const earlyStop = createDriverHarness(90_000, {
      afterAdvance: (runtime) => {
        runtime.state = "stopped";
      },
    });
    earlyStop.driver.start();
    await earlyStop.timers.fireInterval(16);
    expect(earlyStop.failed).toHaveBeenCalledWith("loop-stopped-before-reset");

    const invalidCount = createDriverHarness(90_000, {
      afterAdvance: (runtime) => {
        runtime.completedLoops = 2;
      },
    });
    invalidCount.driver.start();
    await invalidCount.timers.fireInterval(16);
    expect(invalidCount.failed).toHaveBeenCalledWith("loop-count-invalid");
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
    expect(harness.runtime.stop).toHaveBeenCalledTimes(1);
  });
});
