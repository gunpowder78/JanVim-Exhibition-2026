import type { DeterministicShowLoopState } from "./main.js";

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
    this.intervalId = this.options.timers.setInterval(() => this.tick(), 16);
    this.deadlineId = this.options.timers.setTimeout(
      () => this.fail("loop-deadline-exceeded"),
      this.options.loopDurationMs + 10_000,
    );
    return true;
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
      } else if (
        !Number.isInteger(this.options.runtime.completedLoops) ||
        this.options.runtime.completedLoops < 0 ||
        this.options.runtime.completedLoops > 1
      ) {
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
