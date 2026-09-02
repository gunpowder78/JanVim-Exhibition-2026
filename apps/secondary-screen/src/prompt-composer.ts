import type { PromptCue, PromptPayload } from "./model";

export class PromptComposer {
  private state: PromptPayload = {};

  public constructor(private readonly root: HTMLElement) {}

  public render(cue: PromptCue): void {
    this.state = { ...this.state, ...cue.payload };
    this.root.replaceChildren();
    const { title, poem, text, constraints, forbidden } = this.state;

    if (title !== undefined) {
      const heading = document.createElement("h2");
      heading.className = "prompt-composer__title";
      heading.textContent = title;
      this.root.append(heading);
    }

    if (poem !== undefined) {
      const fragment = document.createElement("blockquote");
      fragment.className = "prompt-composer__poem";
      fragment.textContent = poem;
      this.root.append(fragment);
    }

    if (text !== undefined) {
      const finalPrompt = document.createElement("p");
      finalPrompt.className = "prompt-composer__final";
      finalPrompt.textContent = text;
      this.root.append(finalPrompt);
    }

    appendList(this.root, "CONSTRAINTS", constraints);
    appendList(this.root, "REJECT", forbidden);
  }

  public clear(): void {
    this.state = {};
    this.root.replaceChildren();
  }
}

function appendList(root: HTMLElement, label: string, items: string[] | undefined): void {
  if (items === undefined || items.length === 0) {
    return;
  }

  const group = document.createElement("section");
  group.className = "prompt-composer__group";
  const heading = document.createElement("h3");
  heading.textContent = label;
  const list = document.createElement("ul");
  for (const item of items) {
    const listItem = document.createElement("li");
    listItem.textContent = item;
    list.append(listItem);
  }
  group.append(heading, list);
  root.append(group);
}
