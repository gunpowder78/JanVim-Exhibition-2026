import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseShowManifest, type Cue } from "@janvim-exhibition/show-schema";
import {
  RunTelemetry,
  plannedEditorDurationMs,
  summarizeLatencies,
  type CueCorrelation,
  type LoopFinishInput,
} from "../src/run-telemetry.ts";

const fixtureManifest = parseShowManifest(
  JSON.parse(
    readFileSync(join(process.cwd(), "content", "fixture", "show.manifest.json"), "utf8"),
  ),
);
const fixtureInsertCue = fixtureManifest.cues.find((cue) => cue.id === "cue-insert");
if (fixtureInsertCue === undefined) throw new Error("fixture insert cue is missing");

const ORIGINAL_POEM_SHA256 = "a".repeat(64);
const MODIFIED_BUFFER_SHA256 = "b".repeat(64);

function insertCue(text: string, charsPerSecond: number, id = "insert"): Cue {
  return {
    id,
    atMs: 0,
    target: "main",
    kind: "editor-action",
    payload: {
      action: { type: "insert", text, charsPerSecond },
      displayKeys: ["i", text],
      semanticLabel: "insert text",
      critical: true,
    },
  };
}

function resetCue(id = "reset"): Cue {
  return {
    id,
    atMs: 90_000,
    target: "both",
    kind: "editor-action",
    payload: {
      action: { type: "reset" },
      displayKeys: ["Esc"],
      semanticLabel: "reset poem",
      critical: true,
    },
  };
}

function visualCue(id: string): Cue {
  return {
    id,
    atMs: 0,
    target: "secondary",
    kind: "prompt",
    payload: { text: id },
  };
}

function correlation(
  cueId: string,
  loopId = "loop-1",
  generationId = 7,
): CueCorrelation {
  return { generationId, loopId, cueId };
}

function finishInput(
  loopId = "loop-1",
  generationId = 7,
  resetCueId = "reset",
): LoopFinishInput {
  return {
    loopId,
    generationId,
    resetCueId,
    expectedPoemSha256: ORIGINAL_POEM_SHA256,
    endedAtMs: 3_000,
    tickLatenessMs: 15,
    advanceOverrunMs: 20,
  };
}

function recordResetEndpoints(
  telemetry: RunTelemetry,
  options: {
    loopId?: string;
    generationId?: number;
    primaryAtMs?: number;
    secondaryAtMs?: number;
    resetBufferSha256?: string;
  } = {},
): void {
  const loopId = options.loopId ?? "loop-1";
  const generationId = options.generationId ?? 7;
  const key = correlation("reset", loopId, generationId);
  const cue = resetCue();
  telemetry.recordDispatch("primary", key, cue, 2_000);
  telemetry.recordDispatch("secondary", key, cue, 2_000);
  telemetry.recordPrimaryCompletion(
    key,
    options.primaryAtMs ?? 2_050,
    options.resetBufferSha256 ?? ORIGINAL_POEM_SHA256,
  );
  telemetry.recordSecondaryPresentation(key, options.secondaryAtMs ?? 2_060);
}

describe("run telemetry calculations", () => {
  it("uses nearest-rank percentiles without mutating the input", () => {
    const values = [100, 1, 4, 2, 3];
    expect(summarizeLatencies(values)).toEqual({
      count: 5,
      p50Ms: 3,
      p95Ms: 100,
      maxMs: 100,
    });
    expect(values).toEqual([100, 1, 4, 2, 3]);
    expect(summarizeLatencies([])).toEqual({
      count: 0,
      p50Ms: null,
      p95Ms: null,
      maxMs: null,
    });
  });

  it("rejects non-finite or negative latency values", () => {
    for (const invalid of [Number.NaN, Infinity, -Infinity, -1]) {
      expect(() => summarizeLatencies([1, invalid])).toThrow(/latency/i);
    }
  });

  it("uses Unicode code points and the exact deterministic insert cadence", () => {
    expect(plannedEditorDurationMs(insertCue("𠀀诗a", 24))).toBe(3 * 41);
    expect(plannedEditorDurationMs(insertCue("zero", 0))).toBe(0);

    if (
      fixtureInsertCue.kind !== "editor-action" ||
      fixtureInsertCue.payload.action.type !== "insert"
    ) {
      throw new Error("fixture insert cue does not contain an insert action");
    }
    expect([...fixtureInsertCue.payload.action.text]).toHaveLength(28);
    expect(plannedEditorDurationMs(fixtureInsertCue)).toBe(28 * Math.floor(1_000 / 24));
    expect(plannedEditorDurationMs(fixtureInsertCue)).toBe(1_148);
  });

  it("keeps raw completion, instant ACK, and insert overhead in separate families", () => {
    const telemetry = new RunTelemetry();
    telemetry.beginLoop("loop-1", 900);
    const insertKey = correlation("cue-insert");
    telemetry.recordDispatch("primary", insertKey, fixtureInsertCue, 1_000);
    telemetry.recordPrimaryCompletion(insertKey, 2_258, MODIFIED_BUFFER_SHA256);
    recordResetEndpoints(telemetry, { primaryAtMs: 2_350, secondaryAtMs: 2_380 });

    const summary = telemetry.finishLoop({
      ...finishInput(),
      endedAtMs: 2_400,
      tickLatenessMs: 12,
      advanceOverrunMs: 34,
    });

    expect(summary).toEqual({
      loopId: "loop-1",
      startedAtMs: 900,
      endedAtMs: 2_400,
      dispatchedCueCount: 2,
      completedPrimaryCueCount: 2,
      presentedSecondaryCueCount: 1,
      secondaryPresentLatencyMs: { count: 1, p50Ms: 380, p95Ms: 380, maxMs: 380 },
      primaryCompletionLatencyMs: {
        count: 2,
        p50Ms: 350,
        p95Ms: 1_258,
        maxMs: 1_258,
      },
      primaryInstantAckLatencyMs: { count: 1, p50Ms: 350, p95Ms: 350, maxMs: 350 },
      primaryInsertOverheadMs: { count: 1, p50Ms: 110, p95Ms: 110, maxMs: 110 },
      finalVisibleDriftMs: 30,
      resetBufferSha256: ORIGINAL_POEM_SHA256,
      tickLatenessMs: 12,
      advanceOverrunMs: 34,
    });
  });

  it("reports reset endpoint drift per loop so the three-loop aggregate is their sum", () => {
    const telemetry = new RunTelemetry();
    const summaries = [10, 20, 30].map((driftMs, index) => {
      const loopId = `loop-${index + 1}`;
      const generationId = index + 1;
      telemetry.beginLoop(loopId, 0);
      recordResetEndpoints(telemetry, {
        loopId,
        generationId,
        primaryAtMs: 2_100,
        secondaryAtMs: 2_100 + driftMs,
      });
      return telemetry.finishLoop({
        ...finishInput(loopId, generationId),
        endedAtMs: 2_200,
      });
    });

    expect(summaries.map((summary) => summary.finalVisibleDriftMs)).toEqual([10, 20, 30]);
    expect(summaries.reduce((sum, summary) => sum + summary.finalVisibleDriftMs, 0)).toBe(60);
  });

  it("rejects duplicate correlation entries and a 513th endpoint sample", () => {
    const telemetry = new RunTelemetry();
    telemetry.beginLoop("loop-1", 0);
    const key = correlation("insert");
    const cue = insertCue("x", 24);
    telemetry.recordDispatch("primary", key, cue, 10);
    expect(() => telemetry.recordDispatch("primary", key, cue, 10)).toThrow(/duplicate/i);
    telemetry.recordPrimaryCompletion(key, 20, MODIFIED_BUFFER_SHA256);
    expect(() => telemetry.recordPrimaryCompletion(key, 21, MODIFIED_BUFFER_SHA256)).toThrow(
      /duplicate/i,
    );

    const capped = new RunTelemetry();
    capped.beginLoop("loop-cap", 0);
    for (let index = 0; index < 512; index += 1) {
      const id = `visual-${index}`;
      capped.recordDispatch("secondary", correlation(id, "loop-cap"), visualCue(id), index);
    }
    expect(() =>
      capped.recordDispatch(
        "secondary",
        correlation("visual-512", "loop-cap"),
        visualCue("visual-512"),
        512,
      ),
    ).toThrow(/512|limit/i);
  });

  it("rejects negative endpoint latency, stale generations, and wrong loops", () => {
    const telemetry = new RunTelemetry();
    telemetry.beginLoop("loop-1", 0);
    const key = correlation("insert");
    telemetry.recordDispatch("primary", key, insertCue("x", 24), 100);
    expect(() => telemetry.recordPrimaryCompletion(key, 99, MODIFIED_BUFFER_SHA256)).toThrow(
      /latency|monotonic/i,
    );
    expect(() =>
      telemetry.recordDispatch(
        "secondary",
        correlation("visual", "loop-1", 6),
        visualCue("visual"),
        101,
      ),
    ).toThrow(/generation/i);
    expect(() =>
      telemetry.recordDispatch(
        "secondary",
        correlation("visual", "wrong-loop", 7),
        visualCue("visual"),
        101,
      ),
    ).toThrow(/loop/i);
    expect(() => telemetry.recordPrimaryCompletion(key, Number.NaN, MODIFIED_BUFFER_SHA256)).toThrow(
      /time|finite/i,
    );
  });

  it("fails closed when either reset endpoint is missing or the reset hash differs", () => {
    const missingPrimary = new RunTelemetry();
    missingPrimary.beginLoop("loop-1", 0);
    const resetKey = correlation("reset");
    missingPrimary.recordDispatch("primary", resetKey, resetCue(), 2_000);
    missingPrimary.recordDispatch("secondary", resetKey, resetCue(), 2_000);
    missingPrimary.recordSecondaryPresentation(resetKey, 2_060);
    expect(() => missingPrimary.finishLoop(finishInput())).toThrow(/primary.*reset|reset.*primary/i);

    const missingSecondary = new RunTelemetry();
    missingSecondary.beginLoop("loop-1", 0);
    missingSecondary.recordDispatch("primary", resetKey, resetCue(), 2_000);
    missingSecondary.recordDispatch("secondary", resetKey, resetCue(), 2_000);
    missingSecondary.recordPrimaryCompletion(resetKey, 2_050, ORIGINAL_POEM_SHA256);
    expect(() => missingSecondary.finishLoop(finishInput())).toThrow(
      /secondary.*reset|reset.*secondary/i,
    );

    const wrongHash = new RunTelemetry();
    wrongHash.beginLoop("loop-1", 0);
    recordResetEndpoints(wrongHash, { resetBufferSha256: MODIFIED_BUFFER_SHA256 });
    expect(() => wrongHash.finishLoop(finishInput())).toThrow(/hash/i);
  });

  it("rejects duplicate reset ACKs, stale finish generations, and a non-reset boundary cue", () => {
    const duplicate = new RunTelemetry();
    duplicate.beginLoop("loop-1", 0);
    recordResetEndpoints(duplicate);
    expect(() =>
      duplicate.recordSecondaryPresentation(correlation("reset"), 2_061),
    ).toThrow(/duplicate/i);
    expect(() => duplicate.finishLoop(finishInput("loop-1", 8))).toThrow(/generation/i);

    const notReset = new RunTelemetry();
    notReset.beginLoop("loop-1", 0);
    const key = correlation("insert");
    notReset.recordDispatch("primary", key, insertCue("x", 24), 2_000);
    notReset.recordDispatch("secondary", key, insertCue("x", 24), 2_000);
    notReset.recordPrimaryCompletion(key, 2_010, ORIGINAL_POEM_SHA256);
    notReset.recordSecondaryPresentation(key, 2_011);
    expect(() => notReset.finishLoop(finishInput("loop-1", 7, "insert"))).toThrow(/reset/i);
  });

  it("rejects a finish before the latest endpoint chronology and allows equality", () => {
    const withResetAtThreeSeconds = (): RunTelemetry => {
      const telemetry = new RunTelemetry();
      telemetry.beginLoop("loop-1", 1_000);
      recordResetEndpoints(telemetry, {
        primaryAtMs: 3_000,
        secondaryAtMs: 3_000,
      });
      return telemetry;
    };

    const beforeResetAcks = withResetAtThreeSeconds();
    expect(() =>
      beforeResetAcks.finishLoop({ ...finishInput(), endedAtMs: 2_999 }),
    ).toThrow(/finish|endpoint|chronology/i);

    const equalResetAcks = withResetAtThreeSeconds();
    expect(() =>
      equalResetAcks.finishLoop({ ...finishInput(), endedAtMs: 3_000 }),
    ).not.toThrow();

    const beforeUnacknowledgedDispatch = withResetAtThreeSeconds();
    beforeUnacknowledgedDispatch.recordDispatch(
      "secondary",
      correlation("late-visual"),
      visualCue("late-visual"),
      3_100,
    );
    expect(() =>
      beforeUnacknowledgedDispatch.finishLoop({
        ...finishInput(),
        endedAtMs: 3_099,
      }),
    ).toThrow(/finish|endpoint|chronology/i);

    const recordLaterPrimaryCompletion = (telemetry: RunTelemetry): void => {
      const key = correlation("late-primary");
      telemetry.recordDispatch(
        "primary",
        key,
        insertCue("x", 0, "late-primary"),
        3_100,
      );
      telemetry.recordPrimaryCompletion(key, 3_200, MODIFIED_BUFFER_SHA256);
    };
    const beforeLaterCompletion = withResetAtThreeSeconds();
    recordLaterPrimaryCompletion(beforeLaterCompletion);
    expect(() =>
      beforeLaterCompletion.finishLoop({ ...finishInput(), endedAtMs: 3_199 }),
    ).toThrow(/finish|endpoint|chronology/i);

    const equalLaterCompletion = withResetAtThreeSeconds();
    recordLaterPrimaryCompletion(equalLaterCompletion);
    expect(() =>
      equalLaterCompletion.finishLoop({ ...finishInput(), endedAtMs: 3_200 }),
    ).not.toThrow();
  });
});
