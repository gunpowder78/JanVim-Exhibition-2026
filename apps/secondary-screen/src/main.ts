import type {
  RendererEvent,
  RendererToControllerEvent,
} from "@janvim-exhibition/show-schema";

import { sampleRendererFrameRate } from "./frame-rate-monitor";
import { SecondarySceneController } from "./scene-controller";
import "./styles.css";

type SecondaryShowBridge = {
  onShowEvent: (listener: (event: RendererEvent) => void) => () => void;
  sendRendererEvent: (event: RendererToControllerEvent) => void;
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
    const unsubscribe = bridge.onShowEvent((event) => {
      scene.applyEvent(event);
    });
    const disposeScene = scene.bindRendererEvents({
      sendRendererEvent: (event) => bridge.sendRendererEvent(event),
      requestFrame: (callback) => window.requestAnimationFrame(callback),
      cancelFrame: (id) => window.cancelAnimationFrame(id),
    });
    window.addEventListener(
      "beforeunload",
      () => {
        unsubscribe();
        disposeScene();
      },
      { once: true },
    );
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
