import { describe, expect, it, vi } from "vitest";

import {
  ResourceSampler,
  type ProcessSampleAdapter,
  type ResourceSamplerTimerAdapter,
  type ResourceSamplerTimerHandle,
  type ResourceSummary,
} from "../src/resource-sampler.ts";

interface ScheduledInterval {
  id: number;
  delayMs: number;
  callback: () => unknown;
}

class FakeTimers implements ResourceSamplerTimerAdapter {
  private readonly intervals = new Map<number, ScheduledInterval>();
  private nextId = 1;
  public readonly setDelays: number[] = [];
  public readonly cleared: ResourceSamplerTimerHandle[] = [];
  public rejectClear = false;

  public setInterval(callback: () => void, delayMs: number): number {
    const interval = { id: this.nextId, delayMs, callback };
    this.nextId += 1;
    this.intervals.set(interval.id, interval);
    this.setDelays.push(delayMs);
    return interval.id;
  }

  public clearInterval(id: ResourceSamplerTimerHandle): void {
    this.cleared.push(id);
    if (this.rejectClear) throw new Error("injected interval clear failure");
    if (typeof id === "number") this.intervals.delete(id);
  }

  public async fireInterval(delayMs = 5_000): Promise<void> {
    const interval = [...this.intervals.values()].find((entry) => entry.delayMs === delayMs);
    if (interval === undefined) throw new Error(`no interval scheduled at ${delayMs} ms`);
    await interval.callback();
  }

  public activeCount(): number {
    return this.intervals.size;
  }
}

const PIDS = { controller: 11, renderer: 22, janvim: 33 } as const;

function expectEmptyAggregate(summary: ResourceSummary, role: keyof typeof PIDS): void {
  expect(summary[role]).toEqual({
    rssBytes: { count: 0, min: null, max: null, final: null },
    handleCount: { count: 0, min: null, max: null, final: null },
  });
}

function samplerSnapshot(sampler: ResourceSampler): ResourceSummary {
  const inspectable = sampler as unknown as { snapshot(): ResourceSummary };
  return inspectable.snapshot();
}

async function settle(): Promise<void> {
  for (let index = 0; index < 16; index += 1) await Promise.resolve();
}

describe("resource sampler", () => {
  it("disposes an unstarted sampler synchronously and idempotently", () => {
    const timers = new FakeTimers();
    const adapter: ProcessSampleAdapter = {
      sample: vi.fn(async () => ({ rssBytes: 1, handleCount: 1 })),
    };
    const sampler = new ResourceSampler({ adapter, timers });

    expect(() => sampler.dispose()).not.toThrow();
    expect(() => sampler.dispose()).not.toThrow();
    expect(sampler.diagnostics()).toEqual({
      timerCount: 0,
      sampleInFlight: false,
    });
    expect(adapter.sample).not.toHaveBeenCalled();
    expect(() => sampler.start(PIDS)).toThrow(/disposed/i);
  });

  it("disposes a nonsettling sample without a final sample or late mutation", async () => {
    const timers = new FakeTimers();
    let resolveSample!: (sample: { rssBytes: number; handleCount: number }) => void;
    const blockedSample = new Promise<{ rssBytes: number; handleCount: number }>(
      (resolve) => {
        resolveSample = resolve;
      },
    );
    const adapter: ProcessSampleAdapter = {
      sample: vi.fn(() => blockedSample),
    };
    const sampler = new ResourceSampler({ adapter, timers });
    sampler.start(PIDS);
    expect(adapter.sample).toHaveBeenCalledTimes(1);
    expect(sampler.diagnostics()).toEqual({
      timerCount: 1,
      sampleInFlight: true,
    });

    sampler.dispose();

    expect(timers.activeCount()).toBe(0);
    expect(timers.cleared).toHaveLength(1);
    expect(sampler.diagnostics()).toEqual({
      timerCount: 0,
      sampleInFlight: false,
    });
    const disposedSnapshot = samplerSnapshot(sampler);
    for (const role of Object.keys(PIDS) as Array<keyof typeof PIDS>) {
      expectEmptyAggregate(disposedSnapshot, role);
    }
    await expect(sampler.sampleBoundary()).resolves.toBeUndefined();

    resolveSample({ rssBytes: 999_999, handleCount: 999 });
    await settle();

    expect(adapter.sample).toHaveBeenCalledTimes(1);
    expect(samplerSnapshot(sampler)).toEqual(disposedSnapshot);
    expect(sampler.diagnostics()).toEqual({
      timerCount: 0,
      sampleInFlight: false,
    });
  });

  it("commits disposal state before a timer-clear failure", async () => {
    const timers = new FakeTimers();
    timers.rejectClear = true;
    let resolveSample!: (sample: { rssBytes: number; handleCount: number }) => void;
    const blockedSample = new Promise<{ rssBytes: number; handleCount: number }>(
      (resolve) => {
        resolveSample = resolve;
      },
    );
    const adapter: ProcessSampleAdapter = {
      sample: vi.fn(() => blockedSample),
    };
    const sampler = new ResourceSampler({ adapter, timers });
    sampler.start(PIDS);

    expect(() => sampler.dispose()).toThrow(/interval clear failure/i);
    expect(() => sampler.dispose()).not.toThrow();
    expect(sampler.diagnostics()).toEqual({
      timerCount: 0,
      sampleInFlight: false,
    });
    await timers.fireInterval();
    expect(adapter.sample).toHaveBeenCalledTimes(1);

    resolveSample({ rssBytes: 123, handleCount: 45 });
    await settle();
    const snapshot = samplerSnapshot(sampler);
    for (const role of Object.keys(PIDS) as Array<keyof typeof PIDS>) {
      expectEmptyAggregate(snapshot, role);
    }
  });

  it("samples start, five-second ticks, boundaries, and finish using aggregates only", async () => {
    const timers = new FakeTimers();
    const counts = new Map<number, number>();
    const adapter: ProcessSampleAdapter = {
      sample: vi.fn(async (pid) => {
        const count = (counts.get(pid) ?? 0) + 1;
        counts.set(pid, count);
        return { rssBytes: pid * 1_000 + count, handleCount: count };
      }),
    };
    const sampler = new ResourceSampler({ adapter, timers });

    sampler.start(PIDS);
    expect(timers.setDelays).toEqual([5_000]);
    expect(sampler.diagnostics().timerCount).toBe(1);
    await sampler.sampleBoundary();

    for (let index = 0; index < 100; index += 1) {
      await timers.fireInterval();
      expect(sampler.diagnostics().timerCount).toBeLessThanOrEqual(1);
    }
    await sampler.sampleBoundary();
    const summary = await sampler.finish();

    expect(summary).toEqual({
      controller: {
        rssBytes: { count: 103, min: 11_001, max: 11_103, final: 11_103 },
        handleCount: { count: 103, min: 1, max: 103, final: 103 },
      },
      renderer: {
        rssBytes: { count: 103, min: 22_001, max: 22_103, final: 22_103 },
        handleCount: { count: 103, min: 1, max: 103, final: 103 },
      },
      janvim: {
        rssBytes: { count: 103, min: 33_001, max: 33_103, final: 33_103 },
        handleCount: { count: 103, min: 1, max: 103, final: 103 },
      },
      sampleIncomplete: false,
    });
    expect(adapter.sample).toHaveBeenCalledTimes(103 * 3);
    expect(timers.activeCount()).toBe(0);
    expect(timers.cleared).toHaveLength(1);
    expect(sampler.diagnostics()).toEqual({ timerCount: 0, sampleInFlight: false });
    expect(
      Object.values(sampler as unknown as Record<string, unknown>).some(Array.isArray),
    ).toBe(false);
  });

  it("coalesces overlapping callbacks and never runs concurrent OS queries", async () => {
    const timers = new FakeTimers();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    let concurrent = 0;
    let maxConcurrent = 0;
    const adapter: ProcessSampleAdapter = {
      sample: vi.fn(async () => {
        calls += 1;
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        if (calls === 1) await blocked;
        concurrent -= 1;
        return { rssBytes: 100 + calls, handleCount: 10 + calls };
      }),
    };
    const sampler = new ResourceSampler({ adapter, timers });
    sampler.start(PIDS);

    const overlapping = Array.from({ length: 10 }, async () => timers.fireInterval());
    expect(calls).toBe(1);
    expect(sampler.diagnostics()).toEqual({ timerCount: 1, sampleInFlight: true });
    release();
    await Promise.all(overlapping);

    expect(calls).toBe(3);
    expect(maxConcurrent).toBe(1);
    await sampler.finish();
    expect(calls).toBe(6);
    expect(maxConcurrent).toBe(1);
  });

  it("rejects invalid PIDs and a second start without allocating another timer", () => {
    const adapter: ProcessSampleAdapter = {
      sample: vi.fn(async () => ({ rssBytes: 1, handleCount: 1 })),
    };
    for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const timers = new FakeTimers();
      const sampler = new ResourceSampler({ adapter, timers });
      expect(() => sampler.start({ ...PIDS, renderer: invalid })).toThrow(/pid/i);
      expect(timers.activeCount()).toBe(0);
    }

    const timers = new FakeTimers();
    const sampler = new ResourceSampler({ adapter, timers });
    sampler.start(PIDS);
    expect(() => sampler.start(PIDS)).toThrow(/started/i);
    expect(timers.activeCount()).toBe(1);
  });

  it("marks invalid samples and process lookup failures incomplete without retaining values", async () => {
    const timers = new FakeTimers();
    const adapter: ProcessSampleAdapter = {
      sample: vi.fn(async (pid) => {
        if (pid === PIDS.renderer) return { rssBytes: -1, handleCount: -1 };
        if (pid === PIDS.janvim) throw new Error("process exited");
        return { rssBytes: 500, handleCount: 50 };
      }),
    };
    const sampler = new ResourceSampler({ adapter, timers });
    sampler.start(PIDS);
    await sampler.sampleBoundary();

    await expect(sampler.finish()).resolves.toMatchObject({ sampleIncomplete: true });
    const summary = await sampler.finish();
    expect(summary.controller).toEqual({
      rssBytes: { count: 2, min: 500, max: 500, final: 500 },
      handleCount: { count: 2, min: 50, max: 50, final: 50 },
    });
    expectEmptyAggregate(summary, "renderer");
    expectEmptyAggregate(summary, "janvim");
    expect(timers.activeCount()).toBe(0);
    expect(timers.cleared).toHaveLength(1);
    expect(sampler.diagnostics()).toEqual({ timerCount: 0, sampleInFlight: false });
  });
});
