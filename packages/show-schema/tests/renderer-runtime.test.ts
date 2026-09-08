import { describe, expect, it } from "vitest";

import * as showSchema from "../src/index";
import * as rendererSchema from "../src/renderer-event";

type RuntimeSchemaExports = {
  parseRendererEvent?: (value: unknown) => unknown;
  parseRendererToControllerEvent?: (value: unknown) => unknown;
};

const cue = {
  id: "cue-reset",
  atMs: 90_000,
  target: "main",
  kind: "editor-action",
  payload: {
    action: { type: "reset" },
    displayKeys: ["Esc", "reset"],
    semanticLabel: "restore original poem",
    critical: true,
  },
} as const;

function runtimeExports(module: object): Required<RuntimeSchemaExports> {
  const exports = module as RuntimeSchemaExports;
  expect(exports.parseRendererEvent).toBeTypeOf("function");
  expect(exports.parseRendererToControllerEvent).toBeTypeOf("function");
  return exports as Required<RuntimeSchemaExports>;
}

describe("Task 9 renderer runtime schema", () => {
  it("exports both runtime parsers from the package root and renderer subpath", () => {
    runtimeExports(showSchema);
    runtimeExports(rendererSchema);
  });

  it("accepts only closed operator actions and correlated presentation acknowledgements", () => {
    const { parseRendererToControllerEvent } = runtimeExports(rendererSchema);
    const operator = {
      schema: 1,
      type: "operator-action",
      action: "start",
    } as const;
    const presentation = {
      schema: 1,
      type: "presentation-ack",
      generationId: 2,
      loopId: "fixture-90s-reset-2",
      cueId: "cue-reset",
    } as const;

    expect(parseRendererToControllerEvent(operator)).toEqual(operator);
    expect(parseRendererToControllerEvent(presentation)).toEqual(presentation);
    expect(() =>
      parseRendererToControllerEvent({ ...presentation, generationId: 0 }),
    ).toThrow();
    expect(() =>
      parseRendererToControllerEvent({ ...operator, shell: "pwsh" }),
    ).toThrowError(/unrecognized|unknown/i);

    for (const action of ["start", "restart-loop", "stop-show"]) {
      expect(
        parseRendererToControllerEvent({
          schema: 1,
          type: "operator-action",
          action,
        }),
      ).toEqual({ schema: 1, type: "operator-action", action });
    }
    expect(() =>
      parseRendererToControllerEvent({
        schema: 1,
        type: "operator-action",
        action: "open-shell",
      }),
    ).toThrow();
  });

  it("accepts only strict site sound mix events", () => {
    const { parseRendererEvent, parseRendererToControllerEvent } = runtimeExports(rendererSchema);
    const adjustment = {
      schema: 1,
      type: "sound-mix-adjust",
      target: "wind",
      deltaDb: -1,
    } as const;
    const status = {
      schema: 1,
      type: "sound-mix-status",
      windGainDb: -6,
      instrumentGainDb: 2,
      persistence: "saved",
      pendingTargets: ["wind", "instrument"],
    } as const;

    expect(parseRendererToControllerEvent(adjustment)).toEqual(adjustment);
    expect(parseRendererEvent(status)).toEqual(status);

    for (const invalid of [
      { ...adjustment, target: "master" },
      { ...adjustment, deltaDb: 0 },
      { ...adjustment, deltaDb: 2 },
      { ...adjustment, extra: true },
    ]) {
      expect(() => parseRendererToControllerEvent(invalid)).toThrow();
    }
    for (const invalid of [
      { ...status, windGainDb: -25 },
      { ...status, instrumentGainDb: 6.5 },
      { ...status, persistence: "pending" },
      { ...status, pendingTargets: ["wind", "wind"] },
      { ...status, pendingTargets: ["instrument", "wind"] },
      { ...status, extra: true },
    ]) {
      expect(() => parseRendererEvent(invalid)).toThrow();
    }
  });

  it("requires positive safe generations and bounded control-free correlation ids", () => {
    const { parseRendererToControllerEvent } = runtimeExports(rendererSchema);
    const presentation = {
      schema: 1,
      type: "presentation-ack",
      generationId: 1,
      loopId: "loop-1",
      cueId: "cue-1",
    } as const;

    for (const generationId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity]) {
      expect(() =>
        parseRendererToControllerEvent({ ...presentation, generationId }),
      ).toThrow();
    }
    for (const invalidId of ["", "x".repeat(257), "界".repeat(86), "line\nbreak"]) {
      expect(() =>
        parseRendererToControllerEvent({ ...presentation, loopId: invalidId }),
      ).toThrow();
      expect(() =>
        parseRendererToControllerEvent({ ...presentation, cueId: invalidId }),
      ).toThrow();
    }
  });

  it("parses strict generation-aware run cues without changing raw G2 cues", () => {
    const { parseRendererEvent } = runtimeExports(rendererSchema);
    const event = {
      schema: 1,
      type: "run-cue",
      generationId: 3,
      loopId: "loop-3",
      requiresPresentationAck: true,
      cue,
    } as const;

    expect(parseRendererEvent(event)).toEqual(event);
    expect(parseRendererEvent(cue)).toEqual(cue);
    expect(() => parseRendererEvent({ ...event, unexpected: true })).toThrowError(
      /unrecognized|unknown/i,
    );
    expect(() =>
      parseRendererEvent({ ...event, cue: { ...cue, kind: "shell" } }),
    ).toThrow();
    expect(() =>
      parseRendererEvent({ ...event, requiresPresentationAck: "yes" }),
    ).toThrow();
  });

  it("accepts only the closed run states and requires a stable safe-ready reason", () => {
    const { parseRendererEvent } = runtimeExports(rendererSchema);
    const states = [
      "booting",
      "ready",
      "running",
      "safe-cruise",
      "black-recovering",
      "shutting-down",
      "stopped",
    ] as const;

    for (const state of states) {
      const event = { schema: 1, type: "run-status", generationId: 4, state };
      expect(parseRendererEvent(event)).toEqual(event);
      expect(() => parseRendererEvent({ ...event, reason: "not-allowed" })).toThrow();
    }

    const stopPending = {
      schema: 1,
      type: "run-status",
      generationId: 4,
      state: "running",
      reason: "operator-stop-pending",
    } as const;
    expect(parseRendererEvent(stopPending)).toEqual(stopPending);

    expect(
      parseRendererEvent({
        schema: 1,
        type: "run-status",
        generationId: 4,
        state: "safe-ready",
        reason: "janvim-restart-limit",
      }),
    ).toEqual({
      schema: 1,
      type: "run-status",
      generationId: 4,
      state: "safe-ready",
      reason: "janvim-restart-limit",
    });
    expect(() =>
      parseRendererEvent({
        schema: 1,
        type: "run-status",
        generationId: 4,
        state: "safe-ready",
      }),
    ).toThrow();
    for (const reason of ["UPPER", "leading-", "two--hyphens", "x".repeat(65)]) {
      expect(() =>
        parseRendererEvent({
          schema: 1,
          type: "run-status",
          generationId: 4,
          state: "safe-ready",
          reason,
        }),
      ).toThrow();
    }
    expect(() =>
      parseRendererEvent({
        schema: 1,
        type: "run-status",
        generationId: 4,
        state: "unknown",
      }),
    ).toThrow();
  });
});
