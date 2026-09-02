import type {
  OneLoopRuntime,
  OneLoopTimerAdapter,
  OneLoopTimerHandle,
} from "./one-loop-driver.js";

const TICK_INTERVAL_MS = 16;
const LOOP_DEADLINE_ALLOWANCE_MS = 10_000;

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
  private intervalId: OneLoopTimerHandle | undefined;
  private deadlineId: OneLoopTimerHandle | undefined;
  private advancing = false;
  private terminal = false;
  private stopRequested = false;
  private observedLoops = 0;
  private expectedTickMs = 0;
  private tickLatenessMs = 0;
  private advanceOverrunMs = 0;

  public constructor(private readonly options: MultiLoopDriverOptions) {}

  public start(): boolean {
    if (this.intervalId !== undefined || this.terminal || !this.options.runtime.start()) {
      return false;
    }

    this.expectedTickMs = this.options.clock.nowMonotonic() + TICK_INTERVAL_MS;
    this.intervalId = this.options.timers.setInterval(() => this.tick(), TICK_INTERVAL_MS);
    this.rearmDeadline();
    return true;
  }

  public requestStopAtBoundary(): boolean {
    if (this.intervalId === undefined || this.terminal || this.stopRequested) return false;
    this.stopRequested = true;
    return true;
  }

  public stop(): void {
    this.finish();
  }

  public diagnostics(): {
    running: boolean;
    advancing: boolean;
    observedLoops: number;
    timers: number;
    tickLatenessMs: number;
    advanceOverrunMs: number;
  } {
    return {
      running: !this.terminal && this.intervalId !== undefined,
      advancing: this.advancing,
      observedLoops: this.observedLoops,
      timers: Number(this.intervalId !== undefined) + Number(this.deadlineId !== undefined),
      tickLatenessMs: this.tickLatenessMs,
      advanceOverrunMs: this.advanceOverrunMs,
    };
  }

  private async tick(): Promise<void> {
    if (this.advancing || this.terminal) return;

    const startedAtMs = this.options.clock.nowMonotonic();
    this.tickLatenessMs = Math.max(
      this.tickLatenessMs,
      Math.max(0, startedAtMs - this.expectedTickMs),
    );
    this.expectedTickMs = startedAtMs + TICK_INTERVAL_MS;
    this.advancing = true;

    let advanceFailed = false;
    let completedAtMs = startedAtMs;
    try {
      try {
        await this.options.runtime.advance();
      } catch {
        advanceFailed = true;
      } finally {
        completedAtMs = this.options.clock.nowMonotonic();
        this.advanceOverrunMs = Math.max(
          this.advanceOverrunMs,
          Math.max(0, completedAtMs - startedAtMs - TICK_INTERVAL_MS),
        );
      }

      if (this.terminal) return;
      if (advanceFailed) {
        this.fail("loop-advance-failed");
        return;
      }
      if (this.options.runtime.state === "safe-black") {
        this.fail("loop-runtime-safe-black");
        return;
      }
      if (this.options.runtime.state !== "running") {
        this.fail("loop-stopped-before-reset");
        return;
      }

      if (this.options.runtime.completedLoops === this.observedLoops + 1) {
        this.observedLoops += 1;
        this.options.onLoopBoundary({
          loopNumber: this.observedLoops,
          completedAtMs,
          tickLatenessMs: this.tickLatenessMs,
          advanceOverrunMs: this.advanceOverrunMs,
        });
        if (this.terminal) return;

        if (
          this.stopRequested ||
          (this.options.loopLimit !== null && this.observedLoops === this.options.loopLimit)
        ) {
          this.complete();
        } else {
          this.rearmDeadline();
        }
      } else if (this.options.runtime.completedLoops !== this.observedLoops) {
        this.fail("loop-count-skipped");
      }
    } finally {
      this.advancing = false;
    }
  }

  private rearmDeadline(): void {
    if (this.deadlineId !== undefined) {
      this.options.timers.clearTimeout(this.deadlineId);
      this.deadlineId = undefined;
    }
    if (this.terminal) return;

    this.deadlineId = this.options.timers.setTimeout(
      () => this.fail("loop-deadline-exceeded"),
      this.options.loopDurationMs + LOOP_DEADLINE_ALLOWANCE_MS,
    );
  }

  private complete(): void {
    if (this.terminal) return;
    this.finish();
    this.options.onComplete();
  }

  private fail(reason: string): void {
    if (this.terminal) return;
    this.finish();
    this.options.onFailure(reason);
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
}
