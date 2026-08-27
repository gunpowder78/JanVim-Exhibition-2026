import type { MotionMode, SceneElements } from "./model";

export function createReadyPage(
  root: HTMLElement,
  options: { seed: string; motion: MotionMode },
): SceneElements {
  root.className = "secondary-screen";
  root.dataset.motion = options.motion;
  root.dataset.scene = "ready";
  root.dataset.seed = options.seed;

  const surface = document.createElement("article");
  surface.className = "show-surface";

  const header = document.createElement("header");
  header.className = "show-header";
  const identity = document.createElement("p");
  identity.textContent = "JANVIM / EXHIBITION 2026";
  const replayMode = document.createElement("p");
  replayMode.textContent = "OFFLINE · DETERMINISTIC REPLAY";
  header.append(identity, replayMode);

  const workspace = document.createElement("div");
  workspace.className = "show-workspace";

  const promptRegion = document.createElement("section");
  promptRegion.className = "show-panel show-panel--prompt";
  promptRegion.dataset.region = "prompt";
  const promptLabel = document.createElement("p");
  promptLabel.className = "show-panel__label";
  promptLabel.textContent = "PROMPT / 提示构成";
  const promptContent = document.createElement("div");
  promptContent.className = "prompt-composer";
  promptContent.dataset.promptContent = "";
  promptRegion.append(promptLabel, promptContent);

  const resultRegion = document.createElement("section");
  resultRegion.className = "show-panel show-panel--result";
  resultRegion.dataset.region = "result";
  const resultLabel = document.createElement("p");
  resultLabel.className = "show-panel__label";
  resultLabel.textContent = "RESULT / 预生成回放";
  const responseContent = document.createElement("div");
  responseContent.className = "response-stream";
  responseContent.dataset.responseContent = "";
  const acceptance = document.createElement("p");
  acceptance.className = "acceptance-state";
  acceptance.dataset.acceptance = "";
  resultRegion.append(resultLabel, responseContent, acceptance);

  workspace.append(promptRegion, resultRegion);

  const keyRegion = document.createElement("footer");
  keyRegion.className = "key-overlay";
  keyRegion.dataset.region = "key-overlay";
  const keyLabel = document.createElement("p");
  keyLabel.className = "show-panel__label";
  keyLabel.textContent = "EDITOR ACTION / 同源操作";
  const keyOverlay = document.createElement("ol");
  keyOverlay.className = "key-overlay__list";
  keyRegion.append(keyLabel, keyOverlay);

  const p1Layer = document.createElement("aside");
  p1Layer.className = "p1-layer";
  p1Layer.dataset.region = "p1";
  p1Layer.setAttribute("aria-hidden", "true");

  const ready = document.createElement("section");
  ready.className = "ready-page";
  ready.dataset.region = "ready";
  const readyTitle = document.createElement("h1");
  readyTitle.textContent = "SECONDARY SHOW SURFACE";
  const readyStatus = document.createElement("p");
  readyStatus.textContent = "CONTROLLER STANDBY / WAITING FOR CONTROLLER CHECKS";
  ready.append(readyTitle, readyStatus);

  surface.append(header, workspace, keyRegion, p1Layer, ready);
  root.replaceChildren(surface);

  return { ready, promptContent, responseContent, acceptance, keyOverlay, p1Layer };
}
