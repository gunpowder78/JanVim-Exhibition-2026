// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import type { Cue } from "../../../packages/show-schema/src/index.ts";
import { ResponseStream } from "../src/response-stream.ts";

type TokenStreamCue = Cue & { kind: "token-stream" };

const tokenCue = (
  id: string,
  text: string,
  acceptance?: { accepted: true; summary: string },
): TokenStreamCue => ({
  id,
  atMs: 0,
  target: "secondary",
  kind: "token-stream",
  payload: {
    text,
    ...acceptance,
  },
});

const makeStream = (): {
  output: HTMLElement;
  status: HTMLElement;
  stream: ResponseStream;
} => {
  const output = document.createElement("div");
  const status = document.createElement("p");
  return { output, status, stream: new ResponseStream(output, status) };
};

describe("response stream", () => {
  it("replays manifest chunks exactly in cue order without random splitting", () => {
    const { output, stream } = makeStream();

    stream.push(tokenCue("token-1", "诗句成为证据"));
    stream.push(tokenCue("token-2", "，证据生成论点。"));

    expect(
      Array.from(output.querySelectorAll("[data-token-cue-id]"), (node) => node.textContent),
    ).toEqual(["诗句成为证据", "，证据生成论点。"]);
    expect(output.textContent).toBe("诗句成为证据，证据生成论点。");
  });

  it("marks the accepted chunk while preserving all response text", () => {
    const { output, status, stream } = makeStream();
    stream.push(tokenCue("token-draft", "草稿。"));

    stream.push(tokenCue("token-accepted", "最终段落。", { accepted: true, summary: "采纳并写回" }));

    expect(output.textContent).toBe("草稿。最终段落。");
    expect(status.dataset.accepted).toBe("true");
    expect(status.textContent).toBe("采纳并写回");
  });

  it("clears chunks and acceptance markers at reset", () => {
    const { output, status, stream } = makeStream();
    stream.push(tokenCue("token-accepted", "上一轮", { accepted: true, summary: "已采纳" }));

    stream.clear();

    expect(output.textContent).toBe("");
    expect(status.textContent).toBe("");
    expect(status.dataset.accepted).toBeUndefined();
  });
});
