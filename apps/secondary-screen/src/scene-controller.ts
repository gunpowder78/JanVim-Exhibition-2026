import type { Cue } from "@janvim-exhibition/show-schema";

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

export class SecondarySceneController {
  private readonly prompt: PromptComposer;
  private readonly response: ResponseStream;
  private readonly keyOverlay: KeyOverlay;
  private readonly ready: HTMLElement;
  private readonly p1Layer: HTMLElement;

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
    this.p1Layer = elements.p1Layer;
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

  private showRunningScene(): void {
    this.ready.hidden = true;
    this.root.dataset.scene = "running";
  }

  private reset(): void {
    this.prompt.clear();
    this.response.clear();
    this.keyOverlay.clear();
    delete this.p1Layer.dataset.skippedCue;
    delete this.root.dataset.responseComplete;
    this.ready.hidden = false;
    this.root.dataset.scene = "ready";
  }
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
