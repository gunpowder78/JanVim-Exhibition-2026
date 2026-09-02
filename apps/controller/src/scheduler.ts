import type { Cue, ShowManifest } from "@janvim-exhibition/show-schema";

export type MonotonicClock = {
  nowMonotonic: () => number;
  nowWall?: () => number;
};

export type ShowState =
  | "booting"
  | "ready"
  | "running"
  | "awaiting-editor-ack"
  | "safe-black"
  | "resetting"
  | "stopped";

type SchedulerEvent = {
  cue: Cue;
  loopId: string;
};

export type SchedulerConfig = {
  manifest: ShowManifest;
  clock: MonotonicClock;
  catchUpWindowMs?: number;
  initialLoopId?: string;
};

const DEFAULT_CATCH_UP_WINDOW_MS = 250;

export class Scheduler {
  private readonly manifest: ShowManifest;
  private readonly clock: MonotonicClock;
  private readonly catchUpWindowMs: number;
  private loopStartMonotonic: number;
  private nextCueIndex = 0;
  private loopId: string;
  private isPaused = false;
  private readonly issuedInRound = new Set<string>();

  public state: ShowState = "ready";

  constructor(config: SchedulerConfig) {
    this.manifest = config.manifest;
    this.clock = config.clock;
    this.catchUpWindowMs = config.catchUpWindowMs ?? DEFAULT_CATCH_UP_WINDOW_MS;
    this.loopId = config.initialLoopId ?? `loop-${Date.now()}`;
    this.loopStartMonotonic = this.clock.nowMonotonic();
  }

  public startLoop(loopId?: string): void {
    this.loopId = loopId ?? this.loopId;
    this.state = "running";
    this.loopStartMonotonic = this.clock.nowMonotonic();
    this.nextCueIndex = 0;
    this.issuedInRound.clear();
    this.isPaused = false;
  }

  public pause(): void {
    if (this.state !== "ready" && this.state !== "safe-black") {
      throw new Error(`pause not allowed in state ${this.state}`);
    }

    this.isPaused = true;
  }

  public resume(): void {
    if (this.state !== "ready" && this.state !== "safe-black") {
      throw new Error(`resume not allowed in state ${this.state}`);
    }

    this.isPaused = false;
  }

  public enterSafeBlack(): void {
    if (this.state !== "running") {
      throw new Error(`safe-black transition not allowed in state ${this.state}`);
    }
    this.state = "safe-black";
  }

  public enterBooting(): void {
    this.state = "booting";
  }

  public enterResetting(): void {
    this.state = "resetting";
  }

  public enterReady(): void {
    this.state = "ready";
    this.isPaused = false;
  }

  public enterStopped(): void {
    this.state = "stopped";
  }

  public get isRunning(): boolean {
    return this.state === "running" || this.state === "awaiting-editor-ack";
  }

  public get currentLoopId(): string {
    return this.loopId;
  }

  public get issuedCount(): number {
    return this.issuedInRound.size;
  }

  public takeDueCues(): SchedulerEvent[] {
    if (!this.isRunning || this.isPaused) {
      return [];
    }

    const elapsed = this.clock.nowMonotonic() - this.loopStartMonotonic;
    const events: SchedulerEvent[] = [];

    while (this.nextCueIndex < this.manifest.cues.length) {
      const cue = this.manifest.cues[this.nextCueIndex];
      const isEditorCue = cue.kind === "editor-action";
      const shouldDispatch = elapsed >= cue.atMs;

      if (!shouldDispatch) {
        break;
      }

      if (this.issuedInRound.has(cue.id)) {
        this.nextCueIndex += 1;
        continue;
      }

      const lag = elapsed - cue.atMs;
      if (!isEditorCue && lag > this.catchUpWindowMs) {
        this.nextCueIndex += 1;
        continue;
      }

      this.nextCueIndex += 1;
      this.issuedInRound.add(cue.id);
      events.push({
        cue,
        loopId: this.loopId,
      });
    }

    return events;
  }
}
