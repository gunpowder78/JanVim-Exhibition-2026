import type { AgentAck, Cue } from "@janvim-exhibition/show-schema";

export type ShowState =
  | "booting"
  | "ready"
  | "running"
  | "awaiting-editor-ack"
  | "safe-black"
  | "resetting"
  | "stopped";

export type MonotonicClock = {
  nowMonotonic: () => number;
};

export interface CueDispatcherDeps {
  clock: MonotonicClock;
  onVisualCue: (cue: Cue) => void;
  onEditorCue: (cue: Cue) => void;
  onSafeBlack: (reason: string) => void;
  onLoopReset: (nextLoopId: string) => void;
  generateLoopId: () => string;
  initialLoopId?: string;
}

type PendingEditor = {
  cue: Cue & { kind: "editor-action" };
  retryCount: number;
  deadlineMs: number;
};

const ACK_TIMEOUT_MS = 2_000;

export class CueDispatcher {
  private readonly clock: MonotonicClock;
  private readonly onVisualCue: (cue: Cue) => void;
  private readonly onEditorCue: (cue: Cue) => void;
  private readonly onSafeBlack: (reason: string) => void;
  private readonly onLoopReset: (nextLoopId: string) => void;
  private readonly generateLoopId: () => string;
  private readonly dispatchedInLoop = new Set<string>();
  private pendingEditor?: PendingEditor;

  public state: ShowState = "ready";
  public currentLoopId: string;

  constructor(deps: CueDispatcherDeps) {
    this.clock = deps.clock;
    this.onVisualCue = deps.onVisualCue;
    this.onEditorCue = deps.onEditorCue;
    this.onSafeBlack = deps.onSafeBlack;
    this.onLoopReset = deps.onLoopReset;
    this.generateLoopId = deps.generateLoopId;
    this.currentLoopId = deps.initialLoopId ?? `loop-${Date.now()}`;
  }

  public start(): void {
    this.state = "running";
  }

  public stop(): void {
    this.state = "stopped";
  }

  public dispatch(cue: Cue): void {
    if (this.state === "safe-black" || this.state === "stopped") {
      return;
    }

    const key = `${this.currentLoopId}:${cue.id}`;
    if (this.dispatchedInLoop.has(key)) {
      return;
    }

    if (cue.kind === "editor-action") {
      if (this.state !== "running" && this.state !== "ready" && this.state !== "awaiting-editor-ack") {
        return;
      }
      if (this.state === "awaiting-editor-ack" && this.pendingEditor?.cue.id !== cue.id) {
        return;
      }
      if (this.state === "awaiting-editor-ack" && this.pendingEditor?.cue.id === cue.id) {
        return;
      }

      this.dispatchedInLoop.add(key);

      const action = cue.payload.action.type;
      if (action === "reset") {
        this.state = "resetting";
        this.onEditorCue(cue);
        this.rotateLoop();
        return;
      }

      this.pendingEditor = {
        cue,
        retryCount: 0,
        deadlineMs: this.clock.nowMonotonic() + ACK_TIMEOUT_MS,
      };
      this.state = "awaiting-editor-ack";
      this.onEditorCue(cue);
      return;
    }

    this.dispatchedInLoop.add(key);
    this.onVisualCue(cue);
  }

  public tick(): void {
    if (!this.pendingEditor || this.state !== "awaiting-editor-ack") {
      return;
    }

    const now = this.clock.nowMonotonic();
    if (now < this.pendingEditor.deadlineMs) {
      return;
    }

    if (this.pendingEditor.retryCount === 0) {
      if (now >= this.pendingEditor.deadlineMs + ACK_TIMEOUT_MS) {
        this.pendingEditor = undefined;
        this.state = "safe-black";
        this.onSafeBlack("editor cue acknowledged with timeout");
        return;
      }

      this.pendingEditor = {
        ...this.pendingEditor,
        retryCount: 1,
        deadlineMs: this.pendingEditor.deadlineMs + ACK_TIMEOUT_MS,
      };
      this.onEditorCue(this.pendingEditor.cue);
      return;
    }

    this.pendingEditor = undefined;
    this.state = "safe-black";
    this.onSafeBlack("editor cue acknowledged with timeout");
  }

  public ack(ack: AgentAck): void {
    if (this.state !== "awaiting-editor-ack" || !this.pendingEditor) {
      return;
    }

    if (ack.loopId !== this.currentLoopId || ack.cueId !== this.pendingEditor.cue.id) {
      return;
    }

    if (ack.outcome === "failed") {
      this.pendingEditor = undefined;
      this.state = "safe-black";
      this.onSafeBlack("editor cue returned failed");
      return;
    }

    this.pendingEditor = undefined;
    this.state = "running";
  }

  public rotateLoop(): void {
    this.pendingEditor = undefined;
    this.dispatchedInLoop.clear();
    const loopId = this.generateNextLoopId(this.currentLoopId);
    this.currentLoopId = loopId;
    this.state = "ready";
    this.onLoopReset(this.currentLoopId);
  }

  private generateNextLoopId(currentLoopId: string): string {
    let candidate = this.generateLoopId();
    if (candidate !== currentLoopId) {
      return candidate;
    }

    for (let i = 0; i < 8; i += 1) {
      candidate = this.generateLoopId();
      if (candidate !== currentLoopId) {
        return candidate;
      }
    }

    return `${currentLoopId}-next`;
  }
}
