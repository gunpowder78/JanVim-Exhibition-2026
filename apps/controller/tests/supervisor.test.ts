import { describe, expect, it } from "vitest";

import {
  CriticalProcessSupervisor,
  type CriticalProcess,
  type SupervisorTimerAdapter,
} from "../src/supervisor.ts";
import {
  BoundedLog,
  DEFAULT_LOG_FILE_BYTES,
  DEFAULT_LOG_TOTAL_BYTES,
  type LogStorage,
} from "../src/bounded-log.ts";

class FakeTimer implements SupervisorTimerAdapter {
  public readonly scheduled: Array<{ id: number; delayMs: number; callback: () => void }> = [];
  public readonly cleared: number[] = [];
  private nextId = 1;

  public set(callback: () => void, delayMs: number): number {
    const id = this.nextId;
    this.nextId += 1;
    this.scheduled.push({ id, delayMs, callback });
    return id;
  }

  public clear(id: number): void {
    this.cleared.push(id);
  }

  public runNext(): void {
    const next = this.scheduled.shift();
    if (next === undefined) throw new Error("no scheduled restart");
    next.callback();
  }
}

function makeSupervisor() {
  let now = 0;
  let loopNumber = 0;
  const timer = new FakeTimer();
  const restarts: CriticalProcess[] = [];
  const freshLoops: string[] = [];
  const safeReasons: string[] = [];
  const supervisor = new CriticalProcessSupervisor({
    clock: { nowMonotonic: () => now },
    timer,
    restartProcess: (process) => restarts.push(process),
    generateLoopId: () => {
      loopNumber += 1;
      return `fresh-loop-${loopNumber}`;
    },
    beginFreshLoop: (loopId) => freshLoops.push(loopId),
    enterSafeReady: (reason) => safeReasons.push(reason),
  });
  return {
    supervisor,
    timer,
    restarts,
    freshLoops,
    safeReasons,
    setNow: (value: number) => {
      now = value;
    },
  };
}

class MemoryLogStorage implements LogStorage {
  public readonly files = new Map<string, string>();

  public append(path: string, text: string): void {
    this.files.set(path, (this.files.get(path) ?? "") + text);
  }

  public size(path: string): number {
    return Buffer.byteLength(this.files.get(path) ?? "", "utf8");
  }

  public exists(path: string): boolean {
    return this.files.has(path);
  }

  public rename(from: string, to: string): void {
    const value = this.files.get(from);
    if (value === undefined) return;
    this.files.set(to, value);
    this.files.delete(from);
  }

  public remove(path: string): void {
    this.files.delete(path);
  }
}

describe("critical process supervisor", () => {
  it("uses bounded 1/2/4 second restart backoff and stops on the fourth crash in ten minutes", () => {
    const fixture = makeSupervisor();
    const expectedDelays = [1_000, 2_000, 4_000];

    for (const expectedDelay of expectedDelays) {
      fixture.supervisor.reportCrash("janvim");
      expect(fixture.timer.scheduled.at(-1)?.delayMs).toBe(expectedDelay);
      fixture.timer.runNext();
    }

    expect(fixture.restarts).toEqual(["janvim", "janvim", "janvim"]);
    fixture.supervisor.reportCrash("janvim");
    expect(fixture.supervisor.state).toBe("safe-ready");
    expect(fixture.safeReasons).toEqual(["janvim-restart-limit"]);
    expect(fixture.timer.scheduled).toHaveLength(0);
  });

  it("discards the partial loop and starts a fresh loop before every restart", () => {
    const fixture = makeSupervisor();
    fixture.supervisor.reportCrash("secondary");
    fixture.timer.runNext();

    expect(fixture.freshLoops).toEqual(["fresh-loop-1"]);
    expect(fixture.restarts).toEqual(["secondary"]);
    expect(fixture.supervisor.state).toBe("ready");
  });

  it("resets the restart budget after ten minutes and clears pending timers on stop", () => {
    const fixture = makeSupervisor();
    fixture.supervisor.reportCrash("janvim");
    fixture.timer.runNext();
    fixture.setNow(600_001);
    fixture.supervisor.reportCrash("janvim");
    expect(fixture.timer.scheduled.at(-1)?.delayMs).toBe(1_000);

    const pendingId = fixture.timer.scheduled.at(-1)?.id;
    fixture.supervisor.stop();
    expect(fixture.timer.cleared).toContain(pendingId);
    expect(fixture.supervisor.diagnostics().pendingRestarts).toBe(0);
  });
});

describe("bounded structured log", () => {
  it("pins production limits to four 8 MiB files totaling at most 32 MiB", () => {
    expect(DEFAULT_LOG_FILE_BYTES).toBe(8 * 1024 * 1024);
    expect(DEFAULT_LOG_TOTAL_BYTES).toBe(32 * 1024 * 1024);
  });

  it("redacts tokens and rotates without exceeding the configured total", () => {
    const storage = new MemoryLogStorage();
    const token = "sensitive-show-token-2026";
    const log = new BoundedLog({
      storage,
      basePath: "show.log",
      secrets: [token],
      maxFileBytes: 100,
      maxTotalBytes: 300,
    });

    for (let index = 0; index < 12; index += 1) {
      log.write({ event: "bridge", index, token, nested: { authorization: token } });
    }

    const combined = [...storage.files.values()].join("");
    const total = [...storage.files.keys()].reduce((sum, path) => sum + storage.size(path), 0);
    expect(combined).not.toContain(token);
    expect(combined).toContain("[REDACTED]");
    expect(total).toBeLessThanOrEqual(300);
    expect(storage.files.size).toBeLessThanOrEqual(3);
  });

  it("rejects one entry larger than a log file instead of growing without bound", () => {
    const log = new BoundedLog({
      storage: new MemoryLogStorage(),
      basePath: "show.log",
      secrets: [],
      maxFileBytes: 32,
      maxTotalBytes: 64,
    });

    expect(() => log.write({ message: "x".repeat(100) })).toThrow(/entry exceeds/i);
  });
});
