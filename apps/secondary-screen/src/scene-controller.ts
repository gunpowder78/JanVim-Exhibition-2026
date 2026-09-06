import type {
  ControllerStatusEvent,
  Cue,
  OperatorAction,
  RendererEvent,
  RendererToControllerEvent,
  RunCueEvent,
  RunStatusEvent,
  SoundMixStatusEvent,
  SoundMixTarget,
} from "@janvim-exhibition/show-schema";

import { KeyOverlay } from "./key-overlay";
import type {
  PromptCue,
  PromptPayload,
  SecondarySceneOptions,
  TokenStreamCue,
  VisualCue,
} from "./model";
import { PromptComposer } from "./prompt-composer";
import { createReadyPage } from "./ready-page";
import { ResponseStream } from "./response-stream";

export type { SecondarySceneOptions } from "./model";

export interface SecondaryRendererRuntime {
  sendRendererEvent(event: RendererToControllerEvent): void;
  requestFrame(callback: () => void): number;
  cancelFrame(id: number): void;
}

export class SecondarySceneController {
  private readonly prompt: PromptComposer;
  private readonly response: ResponseStream;
  private readonly keyOverlay: KeyOverlay;
  private readonly ready: HTMLElement;
  private readonly readyStatus: HTMLElement;
  private readonly startButton: HTMLButtonElement;
  private readonly restartButton: HTMLButtonElement;
  private readonly stopButton: HTMLButtonElement;
  private readonly stopShortcutHint: HTMLElement;
  private readonly soundMixControls: HTMLElement;
  private readonly soundMixPersistence: HTMLElement;
  private readonly windMix: import("./model").SoundMixRowElements;
  private readonly instrumentMix: import("./model").SoundMixRowElements;
  private readonly p1Layer: HTMLElement;
  private readonly pendingOperatorActions = new Set<OperatorAction>();
  private runtime?: SecondaryRendererRuntime;
  private releaseRuntimeListeners?: () => void;
  private firstPresentationFrame?: number;
  private secondPresentationFrame?: number;
  private presentationEpoch = 0;
  private activeGenerationId?: number;
  private statusKey = "";
  private soundMixStatus?: SoundMixStatusEvent;
  private readonly pendingSoundMixTargets = new Set<SoundMixTarget>();
  private soundMixControlsArmed = false;

  public constructor(
    private readonly root: HTMLElement,
    options: SecondarySceneOptions,
  ) {
    const motion = options.prefersReducedMotion || options.measuredFps < 30 ? "reduced" : "full";
    const elements = createReadyPage(root, { seed: options.seed, motion });
    this.prompt = new PromptComposer(elements.promptContent);
    this.response = new ResponseStream(elements.responseContent, elements.acceptance);
    this.keyOverlay = new KeyOverlay(elements.keyOverlay);
    this.ready = elements.ready;
    this.readyStatus = elements.readyStatus;
    this.startButton = elements.startButton;
    this.restartButton = elements.restartButton;
    this.stopButton = elements.stopButton;
    this.stopShortcutHint = elements.stopShortcutHint;
    this.soundMixControls = elements.soundMixControls;
    this.soundMixPersistence = elements.soundMixPersistence;
    this.windMix = elements.windMix;
    this.instrumentMix = elements.instrumentMix;
    this.p1Layer = elements.p1Layer;
  }

  public applyEvent(event: RendererEvent): void {
    if (isControllerStatusEvent(event)) {
      this.applyStatus(event);
      return;
    }
    if ("type" in event) {
      if (event.type === "sound-mix-status") {
        this.applySoundMixStatus(event);
        return;
      }
      if (event.type === "run-status") {
        if (!this.adoptGeneration(event.generationId)) return;
        this.applyRunStatus(event);
        return;
      }
      if (event.type === "run-cue") {
        if (!this.adoptGeneration(event.generationId)) return;
        this.apply(event.cue);
        if (event.requiresPresentationAck) this.schedulePresentationAck(event);
      }
      return;
    }
    this.apply(event);
  }

  public bindRendererEvents(runtime: SecondaryRendererRuntime): () => void {
    if (this.runtime !== undefined) {
      throw new Error("Secondary renderer runtime is already bound");
    }
    this.runtime = runtime;

    const start = (): void => this.emitOperatorAction("start", this.startButton);
    const restart = (): void =>
      this.emitOperatorAction("restart-loop", this.restartButton);
    const stop = (): void => this.emitOperatorAction("stop-show", this.stopButton);
    const windDown = (): void => this.emitSoundMixAdjustment("wind", -1);
    const windUp = (): void => this.emitSoundMixAdjustment("wind", 1);
    const instrumentDown = (): void => this.emitSoundMixAdjustment("instrument", -1);
    const instrumentUp = (): void => this.emitSoundMixAdjustment("instrument", 1);
    this.startButton.addEventListener("click", start);
    this.restartButton.addEventListener("click", restart);
    this.stopButton.addEventListener("click", stop);
    this.windMix.minusButton.addEventListener("click", windDown);
    this.windMix.plusButton.addEventListener("click", windUp);
    this.instrumentMix.minusButton.addEventListener("click", instrumentDown);
    this.instrumentMix.plusButton.addEventListener("click", instrumentUp);
    this.releaseRuntimeListeners = () => {
      this.startButton.removeEventListener("click", start);
      this.restartButton.removeEventListener("click", restart);
      this.stopButton.removeEventListener("click", stop);
      this.windMix.minusButton.removeEventListener("click", windDown);
      this.windMix.plusButton.removeEventListener("click", windUp);
      this.instrumentMix.minusButton.removeEventListener("click", instrumentDown);
      this.instrumentMix.plusButton.removeEventListener("click", instrumentUp);
    };

    let bound = true;
    return () => {
      if (!bound) return;
      bound = false;
      this.dispose();
    };
  }

  public dispose(): void {
    this.cancelPresentationAck();
    this.releaseRuntimeListeners?.();
    this.releaseRuntimeListeners = undefined;
    this.runtime = undefined;
    this.pendingOperatorActions.clear();
    this.pendingSoundMixTargets.clear();
    this.soundMixControlsArmed = false;
    this.startButton.disabled = true;
    this.restartButton.disabled = true;
    this.stopButton.disabled = true;
    this.renderSoundMix();
  }

  public apply(cue: Cue): void {
    if (cue.kind === "editor-action") {
      if (cue.payload.action.type === "reset") {
        this.reset();
        return;
      }

      this.showRunningScene();
      this.keyOverlay.push(cue);
      return;
    }

    if (cue.target === "main") {
      return;
    }

    switch (cue.kind) {
      case "prompt":
        this.showRunningScene();
        this.prompt.render(toPromptCue(cue));
        return;
      case "token-stream": {
        const tokenCue = toTokenStreamCue(cue);
        if (tokenCue !== null) {
          this.showRunningScene();
          this.response.push(tokenCue);
          if (cue.payload.complete === true) {
            this.root.dataset.responseComplete = "true";
          }
        }
        return;
      }
      case "formula":
      case "matrix":
      case "image":
        this.p1Layer.dataset.skippedCue = cue.id;
        return;
      case "key-overlay":
        return;
      case "fade":
        this.ready.hidden = true;
        this.root.dataset.scene = "black";
        return;
    }
  }

  public reportMeasuredFrameRate(fps: number): void {
    if (Number.isFinite(fps) && fps < 30) {
      this.root.dataset.motion = "reduced";
    }
  }

  private applyStatus(event: ControllerStatusEvent): void {
    this.root.dataset.controllerState = event.state;
    this.soundMixControlsArmed = false;
    this.renderSoundMix();

    switch (event.state) {
      case "booting":
        this.readyStatus.textContent = "CONTROLLER BOOTING / CHECKING RUNTIME";
        this.setOperatorState(`g2:${event.state}`, { start: false });
        return;
      case "ready":
        this.readyStatus.textContent = "CONTROLLER READY / LOCAL START ARMED";
        this.ready.hidden = false;
        this.root.dataset.scene = "ready";
        this.setOperatorState(`g2:${event.state}`, { start: true });
        return;
      case "running":
        this.readyStatus.textContent = "SHOW RUNNING / 90s REHEARSAL";
        this.setOperatorState(`g2:${event.state}`, {});
        return;
      case "blocked":
        this.readyStatus.textContent = `BLOCKED / ${event.reason}`;
        this.ready.hidden = false;
        this.root.dataset.scene = "ready";
        this.setOperatorState(`g2:${event.state}:${event.reason}`, {});
        return;
      case "complete-awaiting-close":
        this.readyStatus.textContent = "RESET COMPLETE / CLOSE JANVIM WITH ALT+F4";
        this.ready.hidden = false;
        this.root.dataset.scene = "ready";
        this.setOperatorState(`g2:${event.state}`, {});
        return;
    }
  }

  private applyRunStatus(event: RunStatusEvent): void {
    this.root.dataset.controllerState = event.state;
    this.soundMixControlsArmed = event.state === "ready" || event.state === "running";
    this.renderSoundMix();
    const key = `run:${event.generationId}:${event.state}:${event.reason ?? ""}`;

    switch (event.state) {
      case "booting":
        this.ready.hidden = false;
        this.root.dataset.scene = "ready";
        this.readyStatus.textContent = "SHOW BOOTING / CHECKING FROZEN INPUTS";
        this.setOperatorState(key, { start: false });
        return;
      case "ready":
        this.ready.hidden = false;
        this.root.dataset.scene = "ready";
        this.readyStatus.textContent = "SHOW READY / LOCAL START ARMED";
        this.setOperatorState(key, { start: true });
        return;
      case "running":
        this.ready.hidden = true;
        this.root.dataset.scene = "running";
        this.readyStatus.textContent = "SHOW RUNNING / STOP QUEUES AT RESET";
        this.setOperatorState(key, { stop: true });
        return;
      case "safe-cruise":
        this.readyStatus.textContent = "SAFE CRUISE / HOLDING LAST PRIMARY FRAME";
        this.setOperatorState(key, { stop: true });
        return;
      case "black-recovering":
        this.ready.hidden = false;
        this.root.dataset.scene = "black";
        this.readyStatus.textContent = "BLACK RECOVERY / REBUILDING LOCAL SURFACE";
        this.setOperatorState(key, { stop: true });
        return;
      case "safe-ready":
        this.ready.hidden = false;
        this.root.dataset.scene = "ready";
        this.readyStatus.textContent = `SAFE READY / ${event.reason}`;
        this.setOperatorState(key, { restart: true, stop: true });
        return;
      case "shutting-down":
        this.ready.hidden = false;
        this.root.dataset.scene = "black";
        this.readyStatus.textContent = "SHOW SHUTTING DOWN / CONTROLS DISARMED";
        this.setOperatorState(key, {});
        return;
      case "stopped":
        this.ready.hidden = false;
        this.root.dataset.scene = "ready";
        this.readyStatus.textContent = "SHOW STOPPED / SAFE TO LEAVE";
        this.setOperatorState(key, {});
        return;
    }
  }

  private setOperatorState(
    statusKey: string,
    visible: { start?: boolean; restart?: boolean; stop?: boolean },
  ): void {
    if (this.statusKey !== statusKey) {
      this.statusKey = statusKey;
      this.pendingOperatorActions.clear();
    }
    this.setButtonState(this.startButton, "start", visible.start === true);
    this.setButtonState(
      this.restartButton,
      "restart-loop",
      visible.restart === true,
    );
    this.setButtonState(this.stopButton, "stop-show", visible.stop === true);
    this.stopShortcutHint.hidden = visible.stop !== true;
  }

  private setButtonState(
    button: HTMLButtonElement,
    action: OperatorAction,
    visible: boolean,
  ): void {
    button.hidden = !visible;
    button.disabled = !visible || this.pendingOperatorActions.has(action);
  }

  private emitOperatorAction(
    action: OperatorAction,
    button: HTMLButtonElement,
  ): void {
    if (
      this.runtime === undefined ||
      button.hidden ||
      button.disabled ||
      this.pendingOperatorActions.has(action)
    ) {
      return;
    }
    this.pendingOperatorActions.add(action);
    button.disabled = true;
    this.runtime.sendRendererEvent({
      schema: 1,
      type: "operator-action",
      action,
    });
  }

  private applySoundMixStatus(event: SoundMixStatusEvent): void {
    this.soundMixStatus = event;
    this.pendingSoundMixTargets.clear();
    for (const target of event.pendingTargets) this.pendingSoundMixTargets.add(target);
    this.soundMixControls.hidden = false;
    this.renderSoundMix();
  }

  private emitSoundMixAdjustment(target: SoundMixTarget, deltaDb: -1 | 1): void {
    const status = this.soundMixStatus;
    if (this.runtime === undefined || status === undefined || !this.soundMixControlsArmed ||
        this.pendingSoundMixTargets.has(target)) return;
    this.pendingSoundMixTargets.add(target);
    this.renderSoundMix();
    this.runtime.sendRendererEvent({
      schema: 1,
      type: "sound-mix-adjust",
      target,
      deltaDb,
    });
  }

  private renderSoundMix(): void {
    const status = this.soundMixStatus;
    if (status === undefined) return;
    this.soundMixPersistence.textContent = status.persistence === "saved" ? "SAVED" : "SAVE ERR";
    this.soundMixPersistence.dataset.mixPersistence = status.persistence;
    this.renderSoundMixRow("wind", status.windGainDb, this.windMix);
    this.renderSoundMixRow("instrument", status.instrumentGainDb, this.instrumentMix);
  }

  private renderSoundMixRow(
    target: SoundMixTarget,
    gainDb: number,
    row: import("./model").SoundMixRowElements,
  ): void {
    row.value.textContent = `${gainDb > 0 ? "+" : ""}${gainDb} dB`;
    const blocked = !this.soundMixControlsArmed || this.pendingSoundMixTargets.has(target);
    row.minusButton.disabled = blocked;
    row.plusButton.disabled = blocked;
  }

  private schedulePresentationAck(event: RunCueEvent): void {
    const runtime = this.runtime;
    const generationId = this.activeGenerationId;
    if (runtime === undefined || generationId !== event.generationId) return;
    this.cancelPresentationAck();
    const epoch = this.presentationEpoch;

    this.firstPresentationFrame = runtime.requestFrame(() => {
      if (
        epoch !== this.presentationEpoch ||
        this.runtime !== runtime ||
        this.activeGenerationId !== generationId
      ) {
        return;
      }
      this.firstPresentationFrame = undefined;
      this.secondPresentationFrame = runtime.requestFrame(() => {
        if (
          epoch !== this.presentationEpoch ||
          this.runtime !== runtime ||
          this.activeGenerationId !== generationId
        ) {
          return;
        }
        this.secondPresentationFrame = undefined;
        runtime.sendRendererEvent({
          schema: 1,
          type: "presentation-ack",
          generationId,
          loopId: event.loopId,
          cueId: event.cue.id,
        });
      });
    });
  }

  private adoptGeneration(generationId: number): boolean {
    if (
      this.activeGenerationId !== undefined &&
      generationId < this.activeGenerationId
    ) {
      return false;
    }
    if (
      this.activeGenerationId === undefined ||
      generationId > this.activeGenerationId
    ) {
      this.cancelPresentationAck();
      this.activeGenerationId = generationId;
    }
    return true;
  }

  private cancelPresentationAck(): void {
    this.presentationEpoch += 1;
    if (this.firstPresentationFrame !== undefined) {
      this.runtime?.cancelFrame(this.firstPresentationFrame);
      this.firstPresentationFrame = undefined;
    }
    if (this.secondPresentationFrame !== undefined) {
      this.runtime?.cancelFrame(this.secondPresentationFrame);
      this.secondPresentationFrame = undefined;
    }
  }

  private showRunningScene(): void {
    this.ready.hidden = true;
    this.root.dataset.scene = "running";
  }

  private reset(): void {
    this.cancelPresentationAck();
    this.prompt.clear();
    this.response.clear();
    this.keyOverlay.clear();
    delete this.p1Layer.dataset.skippedCue;
    delete this.root.dataset.responseComplete;
    this.ready.hidden = false;
    this.root.dataset.scene = "ready";
  }
}

function isControllerStatusEvent(event: RendererEvent): event is ControllerStatusEvent {
  return "type" in event && event.type === "controller-status";
}

function toPromptCue(cue: VisualCue): PromptCue {
  const source = cue.payload;
  const payload: PromptPayload = {};

  if (typeof source.title === "string") payload.title = source.title;
  if (typeof source.poem === "string") payload.poem = source.poem;
  if (typeof source.text === "string") payload.text = source.text;
  if (Array.isArray(source.constraints)) {
    payload.constraints = source.constraints.filter((item): item is string => typeof item === "string");
  }
  if (Array.isArray(source.forbidden)) {
    payload.forbidden = source.forbidden.filter((item): item is string => typeof item === "string");
  }

  return { id: cue.id, atMs: cue.atMs, target: cue.target, kind: "prompt", payload };
}

function toTokenStreamCue(cue: VisualCue): TokenStreamCue | null {
  const text = typeof cue.payload.text === "string" ? cue.payload.text : undefined;
  const acceptedSummary =
    cue.payload.accepted === true && typeof cue.payload.summary === "string"
      ? cue.payload.summary
      : undefined;

  if (acceptedSummary !== undefined) {
    return {
      id: cue.id,
      atMs: cue.atMs,
      target: cue.target,
      kind: "token-stream",
      payload:
        text === undefined
          ? { accepted: true, summary: acceptedSummary }
          : { text, accepted: true, summary: acceptedSummary },
    };
  }

  if (text === undefined) {
    return null;
  }

  return {
    id: cue.id,
    atMs: cue.atMs,
    target: cue.target,
    kind: "token-stream",
    payload: { text, accepted: false },
  };
}
