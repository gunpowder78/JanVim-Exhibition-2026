// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import type { Cue, EditorAction } from "../../../packages/show-schema/src/index.ts";
import { KeyOverlay } from "../src/key-overlay.ts";

const editorCue = (
  id: string,
  displayKeys: string[],
  semanticLabel = "跳至下一论证节点",
  action: EditorAction = { type: "move", keys: "j", repeat: displayKeys.length },
): Cue & { kind: "editor-action" } => ({
  id,
  atMs: 0,
  target: "both",
  kind: "editor-action",
  payload: {
    action,
    displayKeys,
    semanticLabel,
    critical: true,
  },
});

describe("key overlay", () => {
  it("keeps display keys, semantic purpose, and cue identity in one item", () => {
    const root = document.createElement("ol");
    const overlay = new KeyOverlay(root);

    overlay.push(editorCue("cue-cross-column", Array.from({ length: 12 }, () => "j")));

    const item = root.querySelector<HTMLElement>("[data-cue-id='cue-cross-column']");
    expect(item).not.toBeNull();
    expect(item?.textContent).toContain("j × 12");
    expect(item?.textContent).toContain("跳至下一论证节点");
    expect(item?.textContent).toContain("cue-cross-column");
  });

  it("keeps only the six most recent cue items", () => {
    const root = document.createElement("ol");
    const overlay = new KeyOverlay(root);

    for (let index = 1; index <= 7; index += 1) {
      overlay.push(editorCue(`cue-${index}`, ["j"]));
    }

    expect(root.querySelectorAll("[data-cue-id]")).toHaveLength(6);
    expect(root.querySelector("[data-cue-id='cue-1']")).toBeNull();
    expect(root.querySelector("[data-cue-id='cue-7']")).not.toBeNull();
  });

  it("explains every closed-set editor action as a physical operation", () => {
    const cases: Array<{ action: EditorAction; expected: string }> = [
      { action: { type: "move", keys: "j", repeat: 12 }, expected: "移动展演光标 12 步" },
      { action: { type: "insert", text: "生成段落", charsPerSecond: 20 }, expected: "写入 4 个字符" },
      { action: { type: "select", rangeId: "verse-1" }, expected: "选择命名范围 verse-1" },
      { action: { type: "replace", rangeId: "verse-1", text: "论文" }, expected: "替换命名范围 verse-1" },
      { action: { type: "escape" }, expected: "返回普通模式" },
      { action: { type: "reset" }, expected: "重建展演缓冲区" },
    ];

    for (const [index, fixture] of cases.entries()) {
      const root = document.createElement("ol");
      const overlay = new KeyOverlay(root);
      overlay.push(editorCue(`cue-action-${index}`, ["j"], "动作目的", fixture.action));

      expect(root.querySelector("[data-role='physical-action']")?.textContent).toBe(
        fixture.expected,
      );
    }
  });

  it("clears every item at a loop boundary", () => {
    const root = document.createElement("ol");
    const overlay = new KeyOverlay(root);
    overlay.push(editorCue("cue-before-reset", ["j"]));

    overlay.clear();

    expect(root.querySelectorAll("[data-cue-id]")).toHaveLength(0);
  });
});
