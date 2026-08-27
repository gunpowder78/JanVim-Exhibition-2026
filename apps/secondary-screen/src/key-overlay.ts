import type { Cue } from "@janvim-exhibition/show-schema";

type EditorActionCue = Extract<Cue, { kind: "editor-action" }>;

export class KeyOverlay {
  public constructor(private readonly root: HTMLOListElement) {}

  public push(cue: EditorActionCue): void {
    const item = document.createElement("li");
    item.dataset.cueId = cue.id;
    item.className = "key-overlay__item";

    const keys = document.createElement("kbd");
    keys.className = "key-overlay__keys";
    keys.textContent = formatDisplayKeys(cue);

    const physicalAction = document.createElement("span");
    physicalAction.dataset.role = "physical-action";
    physicalAction.textContent = describePhysicalAction(cue.payload.action);

    const semanticLabel = document.createElement("span");
    semanticLabel.className = "key-overlay__semantic";
    semanticLabel.textContent = cue.payload.semanticLabel;

    const cueId = document.createElement("code");
    cueId.className = "key-overlay__cue-id";
    cueId.textContent = cue.id;

    item.append(keys, physicalAction, semanticLabel, cueId);
    this.root.append(item);

    while (this.root.childElementCount > 6) {
      this.root.firstElementChild?.remove();
    }
  }

  public clear(): void {
    this.root.replaceChildren();
  }
}

function describePhysicalAction(action: EditorActionCue["payload"]["action"]): string {
  switch (action.type) {
    case "move":
      return `移动展演光标 ${action.repeat} 步`;
    case "insert":
      return `写入 ${Array.from(action.text).length} 个字符`;
    case "select":
      return `选择命名范围 ${action.rangeId}`;
    case "replace":
      return `替换命名范围 ${action.rangeId}`;
    case "escape":
      return "返回普通模式";
    case "reset":
      return "重建展演缓冲区";
  }
}

function formatDisplayKeys(cue: EditorActionCue): string {
  const keys = cue.payload.displayKeys;
  if (keys.length === 1 && cue.payload.action.type === "move" && cue.payload.action.repeat > 1) {
    return `${keys[0]} × ${cue.payload.action.repeat}`;
  }

  const groups: Array<{ key: string; count: number }> = [];
  for (const key of keys) {
    const current = groups.at(-1);
    if (current?.key === key) {
      current.count += 1;
    } else {
      groups.push({ key, count: 1 });
    }
  }

  return groups
    .map(({ key, count }) => (count > 1 ? `${key} × ${count}` : key))
    .join(" ");
}
