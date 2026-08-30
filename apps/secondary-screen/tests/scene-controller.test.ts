// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type {
  Cue,
  CueKind,
  CueTarget,
  EditorAction,
  RendererEvent,
  RendererToControllerEvent,
  RunCueEvent,
  ShowManifest,
} from "../../../packages/show-schema/src/index.ts";
import { SecondarySceneController } from "../src/scene-controller.ts";

type VisualKind = Exclude<CueKind, "editor-action">;

const fixtureManifest = JSON.parse(
  readFileSync(join(process.cwd(), "content/fixture/show.manifest.json"), "utf8"),
) as ShowManifest;

const fixtureCue = (id: string): Cue => {
  const cue = fixtureManifest.cues.find((candidate) => candidate.id === id);
  if (cue === undefined) {
    throw new Error(`missing fixture cue: ${id}`);
  }
  return cue;
};

const visualCue = (
  id: string,
  kind: VisualKind,
  payload: Record<string, unknown>,
  target: CueTarget = "secondary",
): Cue => ({ id, atMs: 0, target, kind, payload });

const editorCue = (
  id: string,
  action: EditorAction,
  displayKeys: string[],
  semanticLabel: string,
): Cue & { kind: "editor-action" } => ({
  id,
  atMs: 0,
  target: "both",
  kind: "editor-action",
  payload: { action, displayKeys, semanticLabel, critical: true },
});

const promptCue = (): Cue =>
  visualCue("prompt-1", "prompt", {
    title: "诗句转译实验",
    poem: "孤舟读取夜色",
    text: "把诗句转译为可检验的论点。",
    constraints: ["保留诗文碎片", "形成可检验论点"],
    forbidden: ["不调用现场网络"],
  });

const tokenCue = (
  id: string,
  text: string,
  accepted = false,
): Cue =>
  visualCue(id, "token-stream", {
    text,
    ...(accepted ? { accepted: true, summary: "采纳并写回" } : {}),
  });

const makeController = (
  options: { seed?: string; prefersReducedMotion?: boolean; measuredFps?: number } = {},
): { root: HTMLElement; controller: SecondarySceneController } => {
  const root = document.createElement("main");
  const controller = new SecondarySceneController(root, {
    seed: options.seed ?? "fixture-seed",
    prefersReducedMotion: options.prefersReducedMotion ?? false,
    measuredFps: options.measuredFps ?? 60,
  });
  return { root, controller };
};

class FakeAnimationFrames {
  private readonly callbacks = new Map<number, () => void>();
  private readonly order: number[] = [];
  private nextId = 1;

  public readonly requestFrame = (callback: () => void): number => {
    const id = this.nextId;
    this.nextId += 1;
    this.callbacks.set(id, callback);
    this.order.push(id);
    return id;
  };

  public readonly cancelFrame = (id: number): void => {
    this.callbacks.delete(id);
  };

  public runNext(): void {
    while (this.order.length > 0) {
      const id = this.order.shift()!;
      const callback = this.callbacks.get(id);
      this.callbacks.delete(id);
      if (callback === undefined) continue;
      callback();
      return;
    }
    throw new Error("no pending animation frame");
  }

  public runAll(): void {
    while (this.callbacks.size > 0) this.runNext();
  }

  public pending(): number {
    return this.callbacks.size;
  }
}

type Task9SceneController = SecondarySceneController & {
  bindRendererEvents?: (runtime: {
    sendRendererEvent(event: RendererToControllerEvent): void;
    requestFrame(callback: () => void): number;
    cancelFrame(id: number): void;
  }) => () => void;
  dispose?: () => void;
};

function bindTask9Runtime(
  controller: SecondarySceneController,
  frames: FakeAnimationFrames,
  sent: RendererToControllerEvent[],
): () => void {
  const task9 = controller as Task9SceneController;
  expect(task9.bindRendererEvents).toBeTypeOf("function");
  return task9.bindRendererEvents!({
    sendRendererEvent: (event) => sent.push(event),
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame,
  });
}

describe("secondary scene controller", () => {
  it("keeps the ready page honest until controller checks complete", () => {
    const { root } = makeController();
    const readyText = root.querySelector("[data-region='ready']")?.textContent ?? "";

    expect(readyText).toContain("WAITING FOR CONTROLLER CHECKS");
    expect(readyText).not.toContain("LOCAL CONTENT READY");
  });

  it("emits each closed operator action once in its allowed run state", () => {
    const { root, controller } = makeController();
    const frames = new FakeAnimationFrames();
    const sent: RendererToControllerEvent[] = [];
    const unbind = bindTask9Runtime(controller, frames, sent);
    const start = root.querySelector<HTMLButtonElement>("[data-action='start-show']");
    const restart = root.querySelector<HTMLButtonElement>("[data-action='restart-loop']");
    const stop = root.querySelector<HTMLButtonElement>("[data-action='stop-show']");

    expect(start).toBeInstanceOf(HTMLButtonElement);
    expect(restart).toBeInstanceOf(HTMLButtonElement);
    expect(stop).toBeInstanceOf(HTMLButtonElement);
    expect(start?.disabled).toBe(true);
    expect(restart?.hidden).toBe(true);
    expect(stop?.hidden).toBe(true);
    start?.click();
    expect(sent).toEqual([]);

    controller.applyEvent({
      schema: 1,
      type: "run-status",
      generationId: 1,
      state: "ready",
    });
    expect(start?.hidden).toBe(false);
    expect(start?.disabled).toBe(false);
    start?.click();
    start?.click();
    expect(sent).toEqual([
      { schema: 1, type: "operator-action", action: "start" },
    ]);

    controller.applyEvent({
      schema: 1,
      type: "run-status",
      generationId: 1,
      state: "running",
    });
    expect(restart?.hidden).toBe(true);
    expect(stop?.hidden).toBe(false);
    expect(stop?.disabled).toBe(false);
    stop?.click();
    stop?.click();

    controller.applyEvent({
      schema: 1,
      type: "run-status",
      generationId: 2,
      state: "safe-ready",
      reason: "janvim-restart-limit",
    });
    expect(start?.hidden).toBe(true);
    expect(restart?.hidden).toBe(false);
    expect(stop?.hidden).toBe(false);
    expect(restart?.disabled).toBe(false);
    expect(stop?.disabled).toBe(false);
    restart?.click();
    restart?.click();

    expect(sent).toEqual([
      { schema: 1, type: "operator-action", action: "start" },
      { schema: 1, type: "operator-action", action: "stop-show" },
      { schema: 1, type: "operator-action", action: "restart-loop" },
    ]);

    unbind();
    unbind();
  });

  it("acknowledges a contextual cue only after two animation frames", () => {
    const { root, controller } = makeController();
    const frames = new FakeAnimationFrames();
    const sent: RendererToControllerEvent[] = [];
    bindTask9Runtime(controller, frames, sent);
    const event: RunCueEvent = {
      schema: 1,
      type: "run-cue",
      generationId: 3,
      loopId: "loop-3",
      requiresPresentationAck: true,
      cue: promptCue(),
    };

    controller.applyEvent(event);
    expect(root.querySelector("[data-prompt-content]")?.textContent).toContain(
      "孤舟读取夜色",
    );
    expect(sent).toEqual([]);
    expect(frames.pending()).toBe(1);

    frames.runNext();
    expect(sent).toEqual([]);
    expect(frames.pending()).toBe(1);

    frames.runNext();
    expect(sent).toEqual([
      {
        schema: 1,
        type: "presentation-ack",
        generationId: 3,
        loopId: "loop-3",
        cueId: "prompt-1",
      },
    ]);
    expect(frames.pending()).toBe(0);
  });

  it("rejects stale generations and presents the first cue owned by the current generation", () => {
    const { root, controller } = makeController();
    const frames = new FakeAnimationFrames();
    const sent: RendererToControllerEvent[] = [];
    bindTask9Runtime(controller, frames, sent);
    const stalePrompt = visualCue("stale-prompt", "prompt", {
      text: "stale generation text",
    });
    const currentPrompt = visualCue("current-prompt", "prompt", {
      text: "current generation text",
    });

    controller.applyEvent({
      schema: 1,
      type: "run-cue",
      generationId: 1,
      loopId: "loop-1",
      requiresPresentationAck: true,
      cue: promptCue(),
    });
    frames.runNext();
    controller.applyEvent({
      schema: 1,
      type: "run-status",
      generationId: 2,
      state: "black-recovering",
    });
    frames.runAll();
    controller.applyEvent({
      schema: 1,
      type: "run-status",
      generationId: 1,
      state: "ready",
    });
    controller.applyEvent({
      schema: 1,
      type: "run-cue",
      generationId: 1,
      loopId: "loop-1",
      requiresPresentationAck: false,
      cue: stalePrompt,
    });

    expect(sent.filter((event) => event.type === "presentation-ack")).toEqual(
      [],
    );
    expect(root.dataset.controllerState).toBe("black-recovering");
    expect(root.dataset.scene).toBe("black");
    expect(root.textContent).not.toContain("stale generation text");

    controller.applyEvent({
      schema: 1,
      type: "run-cue",
      generationId: 2,
      loopId: "loop-2",
      requiresPresentationAck: true,
      cue: currentPrompt,
    });
    expect(root.textContent).toContain("current generation text");
    expect(sent).toEqual([]);

    frames.runNext();
    expect(sent).toEqual([]);
    frames.runNext();
    expect(sent).toEqual([
      {
        schema: 1,
        type: "presentation-ack",
        generationId: 2,
        loopId: "loop-2",
        cueId: "current-prompt",
      },
    ]);
  });

  it("keeps the G2 ready page on the same closed Start action", () => {
    const { root, controller } = makeController();
    const frames = new FakeAnimationFrames();
    const sent: RendererToControllerEvent[] = [];
    bindTask9Runtime(controller, frames, sent);

    controller.applyEvent({
      schema: 1,
      type: "controller-status",
      state: "ready",
    });
    const start = root.querySelector<HTMLButtonElement>("[data-action='start-show']");
    expect(start?.disabled).toBe(false);
    start?.click();
    start?.click();

    expect(sent).toEqual([
      { schema: 1, type: "operator-action", action: "start" },
    ]);
  });

  it("never acknowledges raw G2 cues or contextual cues that do not require it", () => {
    const { controller } = makeController();
    const frames = new FakeAnimationFrames();
    const sent: RendererToControllerEvent[] = [];
    bindTask9Runtime(controller, frames, sent);

    controller.applyEvent(promptCue());
    controller.applyEvent({
      schema: 1,
      type: "run-cue",
      generationId: 1,
      loopId: "loop-1",
      requiresPresentationAck: false,
      cue: tokenCue("no-ack", "不要求 ACK。"),
    });

    expect(frames.pending()).toBe(0);
    expect(sent).toEqual([]);
  });

  it("cancels both presentation-frame phases on reset or dispose", () => {
    const resetFixture = makeController();
    const resetFrames = new FakeAnimationFrames();
    const resetSent: RendererToControllerEvent[] = [];
    bindTask9Runtime(resetFixture.controller, resetFrames, resetSent);
    resetFixture.controller.applyEvent({
      schema: 1,
      type: "run-cue",
      generationId: 1,
      loopId: "loop-1",
      requiresPresentationAck: true,
      cue: promptCue(),
    });
    resetFrames.runNext();
    expect(resetFrames.pending()).toBe(1);

    resetFixture.controller.apply(editorCue("reset", { type: "reset" }, ["Reset"], "reset"));
    expect(resetFrames.pending()).toBe(0);
    resetFrames.runAll();
    expect(resetSent).toEqual([]);

    const disposeFixture = makeController();
    const disposeFrames = new FakeAnimationFrames();
    const disposeSent: RendererToControllerEvent[] = [];
    const unbind = bindTask9Runtime(
      disposeFixture.controller,
      disposeFrames,
      disposeSent,
    );
    disposeFixture.controller.applyEvent({
      schema: 1,
      type: "run-cue",
      generationId: 2,
      loopId: "loop-2",
      requiresPresentationAck: true,
      cue: promptCue(),
    });
    expect(disposeFrames.pending()).toBe(1);

    const disposable = disposeFixture.controller as Task9SceneController;
    expect(disposable.dispose).toBeTypeOf("function");
    disposable.dispose?.();
    expect(disposeFrames.pending()).toBe(0);
    disposeFrames.runAll();
    expect(disposeSent).toEqual([]);
    unbind();
  });

  it("renders only the stable blocked reason and never arms Start", () => {
    const { root, controller } = makeController();
    const statusController = controller as SecondarySceneController & {
      applyEvent?: (event: RendererEvent) => void;
    };
    expect(statusController.applyEvent).toBeTypeOf("function");

    statusController.applyEvent?.({
      schema: 1,
      type: "controller-status",
      state: "blocked",
      reason: "agent-not-ready",
    });

    expect(root.querySelector("[data-ready-status]")?.textContent).toBe(
      "BLOCKED / agent-not-ready",
    );
    expect(root.querySelector<HTMLButtonElement>("[data-action='start-show']")?.disabled).toBe(
      true,
    );
  });

  it("keeps fixed Prompt and Result region nodes while token text grows", () => {
    const { root, controller } = makeController();
    const promptRegion = root.querySelector("[data-region='prompt']");
    const resultRegion = root.querySelector("[data-region='result']");
    expect(promptRegion).not.toBeNull();
    expect(resultRegion).not.toBeNull();

    controller.apply(promptCue());
    controller.apply(tokenCue("token-1", "诗句成为证据。"));
    controller.apply(tokenCue("token-2", "证据生成论点。"));

    expect(root.querySelector("[data-region='prompt']")).toBe(promptRegion);
    expect(root.querySelector("[data-region='result']")).toBe(resultRegion);
    expect(promptRegion?.textContent).toContain("孤舟读取夜色");
    expect(promptRegion?.textContent).toContain("把诗句转译为可检验的论点。");
    expect(promptRegion?.textContent).toContain("保留诗文碎片");
    expect(promptRegion?.textContent).toContain("不调用现场网络");
    expect(resultRegion?.textContent).toContain("诗句成为证据。证据生成论点。");
    expect(root.dataset.motion).toBe("full");
  });

  it("merges the canonical staged prompt without erasing the poem layer", () => {
    const { root, controller } = makeController();
    controller.apply(fixtureCue("cue-prompt"));

    const promptText = root.querySelector("[data-prompt-content]")?.textContent ?? "";
    expect(promptText).toContain("白日依山尽");
    expect(promptText).toContain("第一轮生成");
    expect(promptText).toContain("启动工程闭环：从诗句派生信息论表达。");
  });

  it("produces identical DOM text for the same seed and cue sequence", () => {
    const render = (): string => {
      const { root, controller } = makeController({ seed: "locked-seed-2026" });
      controller.apply(promptCue());
      controller.apply(tokenCue("token-1", "确定性生成。", true));
      return root.textContent ?? "";
    };

    const first = render();
    const second = render();
    expect(first).toContain("确定性生成。");
    expect(second).toBe(first);
  });

  it("applies the canonical acceptance-only cue without duplicating or losing result text", () => {
    const { root, controller } = makeController();
    controller.apply(fixtureCue("cue-result"));

    controller.apply(fixtureCue("cue-accept"));

    expect(root.querySelector("[data-response-content]")?.textContent).toBe(
      "若把诗句视为离散信源，层楼不是终点，而是观察窗口的扩展。",
    );
    expect(root.dataset.responseComplete).toBe("true");
    expect(root.querySelector("[data-acceptance]")?.getAttribute("data-accepted")).toBe("true");
    expect(root.querySelector("[data-acceptance]")?.textContent).toBe(
      "准备写回第一段生成文本。",
    );
  });

  it("routes display keys, semantic purpose, and cue id from one editor cue", () => {
    const { root, controller } = makeController();

    controller.apply(
      editorCue(
        "editor-write-1",
        { type: "insert", text: "生成段落", charsPerSecond: 20 },
        ["i"],
        "插入生成段落",
      ),
    );

    const item = root.querySelector("[data-cue-id='editor-write-1']");
    expect(item?.textContent).toContain("i");
    expect(item?.textContent).toContain("插入生成段落");
    expect(item?.textContent).toContain("editor-write-1");
  });

  it("routes the main-targeted canonical write-back cue into the secondary Key Overlay", () => {
    const { root, controller } = makeController();

    controller.apply(fixtureCue("cue-insert"));

    const item = root.querySelector("[data-cue-id='cue-insert']");
    expect(item?.textContent).toContain("i");
    expect(item?.textContent).toContain("insert generated segment");
    expect(item?.textContent).toContain("cue-insert");
  });

  it("does not fabricate overlay items from standalone key-overlay cues", () => {
    const { root, controller } = makeController();

    controller.apply(visualCue("fake-keys", "key-overlay", { text: "j" }));

    expect(root.querySelectorAll("[data-cue-id]")).toHaveLength(0);
  });

  it("reduces transitions for reduced-motion or low-frame-rate renderers without dropping text", () => {
    const cases = [
      { prefersReducedMotion: true, measuredFps: 60 },
      { prefersReducedMotion: false, measuredFps: 20 },
    ];

    for (const options of cases) {
      const { root, controller } = makeController(options);
      controller.apply(promptCue());
      controller.apply(tokenCue("token-visible", "文本必须保留。"));

      expect(root.dataset.motion).toBe("reduced");
      expect(root.querySelector("[data-region='prompt']")?.textContent).toContain("孤舟读取夜色");
      expect(root.querySelector("[data-region='result']")?.textContent).toContain("文本必须保留。");
    }
  });

  it("downgrades a running renderer after a low-FPS sample without changing text", () => {
    const { root, controller } = makeController({ measuredFps: 60 });
    controller.apply(promptCue());
    controller.apply(tokenCue("token-before-fps", "保留运行中文本。"));
    const textBeforeSample = root.textContent;

    controller.reportMeasuredFrameRate(20);

    expect(root.dataset.motion).toBe("reduced");
    expect(root.textContent).toBe(textBeforeSample);
  });

  it("skips missing P1 assets without blocking Prompt and Response", () => {
    const { root, controller } = makeController();
    controller.apply(visualCue("formula-missing", "formula", {}));
    controller.apply(visualCue("matrix-missing", "matrix", {}));
    controller.apply(visualCue("image-missing", "image", {}));

    controller.apply(promptCue());
    controller.apply(tokenCue("token-after-p1", "P0 主线继续。"));

    expect(root.querySelector("[data-region='prompt']")?.textContent).toContain("孤舟读取夜色");
    expect(root.querySelector("[data-region='result']")?.textContent).toContain("P0 主线继续。");
  });

  it("drops a malformed token payload without poisoning the following valid chunk", () => {
    const { root, controller } = makeController();
    controller.apply(visualCue("token-invalid", "token-stream", { text: 42 }));

    controller.apply(tokenCue("token-valid", "有效文本。"));

    expect(root.querySelector("[data-response-content]")?.textContent).toBe("有效文本。");
  });

  it("ignores cues targeted only at the main projector", () => {
    const { root, controller } = makeController();
    controller.apply(visualCue("main-prompt", "prompt", { poem: "不应出现" }, "main"));
    controller.apply(visualCue("main-token", "token-stream", { text: "不应出现" }, "main"));

    expect(root.querySelector("[data-prompt-content]")?.textContent).toBe("");
    expect(root.querySelector("[data-response-content]")?.textContent).toBe("");
  });

  it("enters black on fade without discarding state before reset", () => {
    const { root, controller } = makeController();
    controller.apply(promptCue());
    controller.apply(tokenCue("token-before-fade", "黑场前文本。"));

    controller.apply(visualCue("fade-1", "fade", { durationMs: 360 }));

    expect(root.dataset.scene).toBe("black");
    expect(root.querySelector("[data-prompt-content]")?.textContent).toContain("孤舟读取夜色");
    expect(root.querySelector("[data-response-content]")?.textContent).toBe("黑场前文本。");
  });

  it("reset removes previous prompt, tokens, keys, and acceptance state", () => {
    const { root, controller } = makeController();
    controller.apply(promptCue());
    controller.apply(tokenCue("token-accepted", "上一轮结果。", true));
    controller.apply(
      editorCue("editor-before-reset", { type: "move", keys: "j", repeat: 2 }, ["j", "j"], "移动"),
    );

    controller.apply(editorCue("reset-1", { type: "reset" }, ["Reset"], "恢复原诗"));

    expect(root.querySelector("[data-prompt-content]")?.textContent).toBe("");
    expect(root.querySelector("[data-response-content]")?.textContent).toBe("");
    expect(root.querySelectorAll("[data-cue-id]")).toHaveLength(0);
    expect(root.querySelector("[data-acceptance]")?.getAttribute("data-accepted")).toBeNull();
    expect(root.dataset.scene).toBe("ready");
  });
});
