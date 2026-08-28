import type { RendererEvent } from "@janvim-exhibition/show-schema";

import { sampleRendererFrameRate } from "./frame-rate-monitor";
import { SecondarySceneController } from "./scene-controller";
import "./styles.css";

type SecondaryShowBridge = {
  onShowEvent: (listener: (event: RendererEvent) => void) => () => void;
  requestStart: () => void;
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

  const bridge = window.janvimExhibition;
  if (bridge !== undefined) {
    bridge.onShowEvent((event) => {
      scene.applyEvent(event);
    });
    scene.bindStartRequest(() => bridge.requestStart());
  }

  void sampleRendererFrameRate({
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (id) => window.cancelAnimationFrame(id),
    setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimer: (id) => window.clearTimeout(id),
  }).then((fps) => {
    if (fps !== null) scene.reportMeasuredFrameRate(fps);
  });
}
