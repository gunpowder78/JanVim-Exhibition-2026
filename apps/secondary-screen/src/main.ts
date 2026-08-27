import type { Cue } from "@janvim-exhibition/show-schema";

import { sampleRendererFrameRate } from "./frame-rate-monitor";
import { SecondarySceneController } from "./scene-controller";
import "./styles.css";

type SecondaryShowBridge = {
  onShowEvent: (listener: (cue: Cue) => void) => () => void;
};

declare global {
  interface Window {
    janvimExhibition?: SecondaryShowBridge;
  }
}

const root = document.querySelector<HTMLElement>("#root");
if (root !== null) {
  const scene = new SecondarySceneController(root, {
    seed: "secondary-ready-v1",
    prefersReducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    measuredFps: 60,
  });

  window.janvimExhibition?.onShowEvent((cue) => {
    scene.apply(cue);
  });

  void sampleRendererFrameRate({
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (id) => window.cancelAnimationFrame(id),
    setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimer: (id) => window.clearTimeout(id),
  }).then((fps) => {
    if (fps !== null) scene.reportMeasuredFrameRate(fps);
  });
}
