import type { Cue, CueTarget } from "@janvim-exhibition/show-schema";

export type MotionMode = "full" | "reduced";

export interface SecondarySceneOptions {
  seed: string;
  prefersReducedMotion: boolean;
  measuredFps: number;
}

export interface PromptPayload {
  title?: string;
  poem?: string;
  text?: string;
  constraints?: string[];
  forbidden?: string[];
}

export type VisualCue = Exclude<Cue, { kind: "editor-action" }>;

interface RendererCueBase {
  id: string;
  atMs: number;
  target: CueTarget;
}

export type PromptCue = RendererCueBase & {
  kind: "prompt";
  payload: PromptPayload;
};

export type TokenStreamCue = RendererCueBase & {
  kind: "token-stream";
  payload:
    | { text: string; accepted?: false }
    | { text?: string; accepted: true; summary: string };
};

export interface SceneElements {
  ready: HTMLElement;
  promptContent: HTMLElement;
  responseContent: HTMLElement;
  acceptance: HTMLElement;
  keyOverlay: HTMLOListElement;
  p1Layer: HTMLElement;
}
