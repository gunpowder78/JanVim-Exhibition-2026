import type { TokenStreamCue } from "./model";

export class ResponseStream {
  public constructor(
    private readonly output: HTMLElement,
    private readonly status: HTMLElement,
  ) {}

  public push(cue: TokenStreamCue): void {
    if (cue.payload.text !== undefined) {
      const chunk = document.createElement("span");
      chunk.className = "response-stream__chunk";
      chunk.dataset.tokenCueId = cue.id;
      chunk.textContent = cue.payload.text;
      this.output.append(chunk);
    }

    if (cue.payload.accepted === true) {
      this.status.dataset.accepted = "true";
      this.status.textContent = cue.payload.summary;
    }
  }

  public clear(): void {
    this.output.replaceChildren();
    this.status.replaceChildren();
    delete this.status.dataset.accepted;
  }
}
