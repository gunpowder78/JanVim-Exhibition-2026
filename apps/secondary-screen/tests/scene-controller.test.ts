// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type {
  Cue,
  CueKind,
  CueTarget,
  EditorAction,
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

describe("secondary scene controller", () => {
  it("keeps the ready page honest until controller checks complete", () => {
    const { root } = makeController();
    const readyText = root.querySelector("[data-region='ready']")?.textContent ?? "";

    expect(readyText).toContain("WAITING FOR CONTROLLER CHECKS");
    expect(readyText).not.toContain("LOCAL CONTENT READY");
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
    controller.apply(fixtureCue("cue-prepare"));

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
      "尝试生成首轮信息论文本。",
    );
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

  it("routes a main-targeted canonical editor cue into the secondary Key Overlay", () => {
    const { root, controller } = makeController();

    controller.apply(fixtureCue("cue-move"));

    const item = root.querySelector("[data-cue-id='cue-move']");
    expect(item?.textContent).toContain("gg /");
    expect(item?.textContent).toContain("move to acceptance range");
    expect(item?.textContent).toContain("cue-move");
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
