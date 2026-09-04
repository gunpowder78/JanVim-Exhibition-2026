import type {
  RendererToControllerEvent,
  RunCueEvent,
  RunStatusEvent,
} from "@janvim-exhibition/show-schema";

import type { ShowSecondarySurface } from "./show-run-coordinator.js";

const MAX_GROUP_LISTENERS = 8;

export interface ShowSurfaceGroupChild {
  onDestroyed(listener: () => void): () => void;
  close(): void;
  diagnostics(): { listeners: number };
}

export interface ShowNarrativeSurface
  extends ShowSecondarySurface,
    ShowSurfaceGroupChild {
  hide(): void;
  show(): void;
}

export interface ShowPreviewSafetySurface extends ShowSurfaceGroupChild {
  hide(): void;
  show(): void;
}

export interface ShowSurfaceGroupOptions {
  narrative: ShowNarrativeSurface;
  standby?: ShowSurfaceGroupChild;
  previewSafety?: ShowPreviewSafetySurface;
}

export class ShowSurfaceGroup implements ShowSecondarySurface {
  public readonly rendererPid: number;
  private readonly narrative: ShowNarrativeSurface;
  private readonly standby: ShowSurfaceGroupChild | undefined;
  private readonly previewSafety: ShowPreviewSafetySurface | undefined;
  private readonly eventDisposers = new Set<() => void>();
  private readonly destroyedListeners = new Set<() => void>();
  private childDisposers: Array<() => void> = [];
  private previewStarted = false;
  private previewSafetyVisible = false;
  private lossObserved = false;
  private lossDelivered = false;
  private lossDeliveryQueued = false;
  private closed = false;

  public constructor(options: ShowSurfaceGroupOptions) {
    if (
      options.previewSafety !== undefined &&
      options.standby !== undefined
    ) {
      throw new Error("Preview surface group cannot own a standby window");
    }
    if (
      options.standby === options.narrative ||
      options.previewSafety === options.narrative ||
      (options.previewSafety !== undefined &&
        options.previewSafety === options.standby)
    ) {
      throw new Error("Show surface group children must be distinct");
    }

    this.narrative = options.narrative;
    this.standby = options.standby;
    this.previewSafety = options.previewSafety;
    this.rendererPid = options.narrative.rendererPid;

    const children: readonly ShowSurfaceGroupChild[] = [
      this.narrative,
      ...(this.standby === undefined ? [] : [this.standby]),
      ...(this.previewSafety === undefined ? [] : [this.previewSafety]),
    ];
    const staged: Array<() => void> = [];
    try {
      for (const child of children) {
        staged.push(child.onDestroyed(() => this.observeChildLoss()));
      }
    } catch (error) {
      runAll(staged.reverse());
      throw error;
    }
    this.childDisposers = staged;
  }

  public send(event: RunCueEvent | RunStatusEvent): void {
    if (this.closed) return;
    if (this.previewSafety === undefined || event.type !== "run-status") {
      this.narrative.send(event);
      return;
    }

    if (!this.previewStarted) {
      if (event.state !== "running") {
        this.narrative.send(event);
        return;
      }
      try {
        this.narrative.send(event);
        this.narrative.hide();
        this.previewStarted = true;
      } catch (error) {
        this.enterPreviewSafetyFallback();
        throw error;
      }
      return;
    }

    if (event.state === "running") {
      this.narrative.send(event);
      if (!this.previewSafetyVisible) return;
      this.previewSafety.hide();
      this.previewSafetyVisible = false;
      return;
    }

    if (!this.previewSafetyVisible) {
      this.previewSafety.show();
      this.previewSafetyVisible = true;
    }
    this.narrative.send(event);
  }

  private enterPreviewSafetyFallback(): void {
    this.previewStarted = true;
    runAll([
      () => this.narrative.hide(),
      () => {
        if (this.previewSafetyVisible) return;
        this.previewSafety!.show();
        this.previewSafetyVisible = true;
      },
    ]);
  }

  public onEvent(
    listener: (event: RendererToControllerEvent) => void,
  ): () => void {
    if (this.closed) return () => undefined;
    if (this.eventDisposers.size >= MAX_GROUP_LISTENERS) {
      throw new Error("Show surface group event listener limit reached");
    }
    const disposeNarrative = this.narrative.onEvent(listener);
    let active = true;
    const dispose = (): void => {
      if (!active) return;
      active = false;
      this.eventDisposers.delete(dispose);
      disposeNarrative();
    };
    this.eventDisposers.add(dispose);
    return dispose;
  }

  public onDestroyed(listener: () => void): () => void {
    if (this.closed || this.lossDelivered) return () => undefined;
    if (this.destroyedListeners.size >= MAX_GROUP_LISTENERS) {
      throw new Error("Show surface group destruction listener limit reached");
    }
    this.destroyedListeners.add(listener);
    let active = true;
    const dispose = (): void => {
      if (!active) return;
      active = false;
      this.destroyedListeners.delete(listener);
    };
    if (this.lossObserved) this.queueLatchedLossDelivery();
    return dispose;
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.lossDelivered = true;
    this.lossDeliveryQueued = false;

    const actions: Array<() => void> = [];
    actions.push(...this.takeChildDisposers());
    actions.push(...this.takeEventDisposers());
    this.destroyedListeners.clear();
    actions.push(() => this.narrative.close());
    if (this.standby !== undefined) {
      actions.push(() => this.standby!.close());
    }
    if (this.previewSafety !== undefined) {
      actions.push(() => this.previewSafety!.close());
    }
    const result = runAll(actions);
    if (result.threw) throw result.error;
  }

  public diagnostics(): { listeners: number } {
    return {
      listeners:
        this.childDisposers.length +
        this.eventDisposers.size +
        this.destroyedListeners.size,
    };
  }

  private observeChildLoss(): void {
    if (this.closed || this.lossObserved) return;
    this.lossObserved = true;
    runAll(this.takeChildDisposers());
    if (this.destroyedListeners.size > 0) this.deliverLoss();
  }

  private queueLatchedLossDelivery(): void {
    if (
      this.closed ||
      this.lossDelivered ||
      this.lossDeliveryQueued
    ) {
      return;
    }
    this.lossDeliveryQueued = true;
    queueMicrotask(() => {
      this.lossDeliveryQueued = false;
      if (!this.closed && this.lossObserved && !this.lossDelivered) {
        this.deliverLoss();
      }
    });
  }

  private deliverLoss(): void {
    if (this.closed || this.lossDelivered) return;
    this.lossDelivered = true;
    const listeners = [...this.destroyedListeners];
    this.destroyedListeners.clear();
    const result = runAll(listeners);
    if (result.threw) throw result.error;
  }

  private takeChildDisposers(): Array<() => void> {
    const disposers = this.childDisposers;
    this.childDisposers = [];
    return disposers;
  }

  private takeEventDisposers(): Array<() => void> {
    const disposers = [...this.eventDisposers];
    this.eventDisposers.clear();
    return disposers;
  }
}

function runAll(actions: readonly (() => void)[]): {
  threw: boolean;
  error?: unknown;
} {
  let threw = false;
  let firstError: unknown;
  for (const action of actions) {
    try {
      action();
    } catch (error) {
      if (!threw) {
        threw = true;
        firstError = error;
      }
    }
  }
  return threw ? { threw: true, error: firstError } : { threw: false };
}
