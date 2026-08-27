export type CriticalProcess = "janvim" | "secondary";
export type SupervisorState = "ready" | "running" | "recovering" | "safe-ready" | "stopped";

export interface SupervisorTimerAdapter {
  set(callback: () => void, delayMs: number): number;
  clear(id: number): void;
}

export interface SupervisorDependencies {
  clock: { nowMonotonic: () => number };
  timer: SupervisorTimerAdapter;
  restartProcess: (process: CriticalProcess) => void;
  generateLoopId: () => string;
  beginFreshLoop: (loopId: string) => void;
  enterSafeReady: (reason: string) => void;
}

const RESTART_WINDOW_MS = 10 * 60 * 1_000;
const RESTART_DELAYS_MS = [1_000, 2_000, 4_000] as const;

export class CriticalProcessSupervisor {
  private readonly history = new Map<CriticalProcess, number[]>();
  private readonly pending = new Map<CriticalProcess, number>();
  public state: SupervisorState = "ready";

  public constructor(private readonly dependencies: SupervisorDependencies) {}

  public markRunning(): void {
    if (this.state === "ready") this.state = "running";
  }

  public reportCrash(process: CriticalProcess): void {
    if (this.state === "stopped" || this.state === "safe-ready" || this.pending.has(process)) {
      return;
    }

    const now = this.dependencies.clock.nowMonotonic();
    const recent = (this.history.get(process) ?? []).filter(
      (timestamp) => now - timestamp < RESTART_WINDOW_MS,
    );
    this.history.set(process, recent);

    if (recent.length >= RESTART_DELAYS_MS.length) {
      this.enterSafeReady(`${process}-restart-limit`);
      return;
    }

    const delayMs = RESTART_DELAYS_MS[recent.length]!;
    recent.push(now);
    this.state = "recovering";
    const timerId = this.dependencies.timer.set(() => {
      this.pending.delete(process);
      if (this.state === "stopped" || this.state === "safe-ready") return;

      try {
        const freshLoopId = this.dependencies.generateLoopId();
        this.dependencies.beginFreshLoop(freshLoopId);
        this.dependencies.restartProcess(process);
        this.state = "ready";
      } catch {
        this.enterSafeReady(`${process}-restart-failed`);
      }
    }, delayMs);
    this.pending.set(process, timerId);
  }

  public stop(): void {
    if (this.state === "stopped") return;
    this.clearPending();
    this.state = "stopped";
  }

  public diagnostics(): { pendingRestarts: number; trackedCrashTimestamps: number } {
    let trackedCrashTimestamps = 0;
    for (const timestamps of this.history.values()) trackedCrashTimestamps += timestamps.length;
    return { pendingRestarts: this.pending.size, trackedCrashTimestamps };
  }

  private enterSafeReady(reason: string): void {
    this.clearPending();
    this.state = "safe-ready";
    this.dependencies.enterSafeReady(reason);
  }

  private clearPending(): void {
    for (const timerId of this.pending.values()) this.dependencies.timer.clear(timerId);
    this.pending.clear();
  }
}
