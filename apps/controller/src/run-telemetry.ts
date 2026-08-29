import type { Cue } from "@janvim-exhibition/show-schema";

const MAX_ENDPOINT_SAMPLES = 512;

export type LatencySummary = {
  count: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
};

export type CueCorrelation = {
  generationId: number;
  loopId: string;
  cueId: string;
};

export type LoopTelemetrySummary = {
  loopId: string;
  startedAtMs: number;
  endedAtMs: number;
  dispatchedCueCount: number;
  completedPrimaryCueCount: number;
  presentedSecondaryCueCount: number;
  secondaryPresentLatencyMs: LatencySummary;
  primaryCompletionLatencyMs: LatencySummary;
  primaryInstantAckLatencyMs: LatencySummary;
  primaryInsertOverheadMs: LatencySummary;
  finalVisibleDriftMs: number;
  resetBufferSha256: string;
  tickLatenessMs: number;
  advanceOverrunMs: number;
};

export type LoopFinishInput = {
  loopId: string;
  generationId: number;
  resetCueId: string;
  expectedPoemSha256: string;
  endedAtMs: number;
  tickLatenessMs: number;
  advanceOverrunMs: number;
};

type Endpoint = "primary" | "secondary";

interface EndpointRecord {
  key: CueCorrelation;
  cue: Cue;
  dispatchedAtMs: number;
  acknowledgedAtMs?: number;
  bufferSha256?: string;
}

interface ActiveLoopTelemetry {
  loopId: string;
  startedAtMs: number;
  generationId?: number;
  endpointSamples: number;
  dispatchedCues: Set<string>;
  primary: Map<string, EndpointRecord>;
  secondary: Map<string, EndpointRecord>;
}

export function plannedEditorDurationMs(cue: Cue): number {
  if (cue.kind !== "editor-action" || cue.payload.action.type !== "insert") return 0;

  const { charsPerSecond, text } = cue.payload.action;
  if (!Number.isFinite(charsPerSecond) || charsPerSecond < 0) {
    throw new Error("insert characters per second must be finite and non-negative");
  }
  if (charsPerSecond === 0) return 0;

  const characterDelayMs = Math.max(1, Math.floor(1_000 / charsPerSecond));
  return [...text].length * characterDelayMs;
}

export function summarizeLatencies(values: readonly number[]): LatencySummary {
  for (const value of values) assertLatency(value);
  if (values.length === 0) {
    return { count: 0, p50Ms: null, p95Ms: null, maxMs: null };
  }

  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    p50Ms: nearestRank(sorted, 0.5),
    p95Ms: nearestRank(sorted, 0.95),
    maxMs: sorted[sorted.length - 1] ?? null,
  };
}

export class RunTelemetry {
  private active: ActiveLoopTelemetry | undefined;

  public beginLoop(loopId: string, startedAtMs: number): void {
    if (this.active !== undefined) throw new Error("loop telemetry is already active");
    if (loopId.length === 0) throw new Error("loop ID must not be empty");
    assertTime(startedAtMs);
    this.active = {
      loopId,
      startedAtMs,
      endpointSamples: 0,
      dispatchedCues: new Set<string>(),
      primary: new Map<string, EndpointRecord>(),
      secondary: new Map<string, EndpointRecord>(),
    };
  }

  public recordDispatch(
    endpoint: Endpoint,
    key: CueCorrelation,
    cue: Cue,
    atMs: number,
  ): void {
    const active = this.requireActive();
    this.validateCorrelation(active, key, cue.id);
    assertTime(atMs);
    if (atMs < active.startedAtMs) throw new Error("dispatch latency cannot be negative");

    const records = active[endpoint];
    const id = correlationId(key);
    if (records.has(id)) throw new Error(`duplicate ${endpoint} dispatch correlation`);
    if (active.endpointSamples >= MAX_ENDPOINT_SAMPLES) {
      throw new Error(`endpoint sample limit of ${MAX_ENDPOINT_SAMPLES} exceeded`);
    }

    records.set(id, { key: { ...key }, cue, dispatchedAtMs: atMs });
    active.endpointSamples += 1;
    active.dispatchedCues.add(id);
  }

  public recordPrimaryCompletion(
    key: CueCorrelation,
    atMs: number,
    bufferSha256: string,
  ): void {
    const active = this.requireActive();
    this.validateCorrelation(active, key);
    const record = this.requireRecord(active.primary, key, "primary dispatch");
    if (record.acknowledgedAtMs !== undefined) throw new Error("duplicate primary completion ACK");
    assertEndpointLatency(record.dispatchedAtMs, atMs);
    record.acknowledgedAtMs = atMs;
    record.bufferSha256 = bufferSha256;
  }

  public recordSecondaryPresentation(key: CueCorrelation, atMs: number): void {
    const active = this.requireActive();
    this.validateCorrelation(active, key);
    const record = this.requireRecord(active.secondary, key, "secondary dispatch");
    if (record.acknowledgedAtMs !== undefined) {
      throw new Error("duplicate secondary presentation ACK");
    }
    assertEndpointLatency(record.dispatchedAtMs, atMs);
    record.acknowledgedAtMs = atMs;
  }

  public finishLoop(input: LoopFinishInput): LoopTelemetrySummary {
    const active = this.requireActive();
    try {
      this.validateFinish(active, input);
      const resetKey = correlationId({
        generationId: input.generationId,
        loopId: input.loopId,
        cueId: input.resetCueId,
      });
      const primaryReset = active.primary.get(resetKey);
      const secondaryReset = active.secondary.get(resetKey);
      assertResetRecord(primaryReset, "primary");
      assertResetRecord(secondaryReset, "secondary");
      if (primaryReset.acknowledgedAtMs === undefined) {
        throw new Error("primary reset completion ACK is missing");
      }
      if (secondaryReset.acknowledgedAtMs === undefined) {
        throw new Error("secondary reset presentation ACK is missing");
      }
      if (primaryReset.bufferSha256 !== input.expectedPoemSha256) {
        throw new Error("reset buffer hash does not match the original poem");
      }

      const primaryCompletionLatencies: number[] = [];
      const primaryInstantLatencies: number[] = [];
      const primaryInsertOverheads: number[] = [];
      for (const record of active.primary.values()) {
        if (record.acknowledgedAtMs === undefined) continue;
        const latencyMs = record.acknowledgedAtMs - record.dispatchedAtMs;
        primaryCompletionLatencies.push(latencyMs);
        const plannedDurationMs = plannedEditorDurationMs(record.cue);
        if (
          record.cue.kind === "editor-action" &&
          record.cue.payload.action.type === "insert"
        ) {
          primaryInsertOverheads.push(Math.max(0, latencyMs - plannedDurationMs));
        } else if (plannedDurationMs === 0) {
          primaryInstantLatencies.push(latencyMs);
        }
      }

      const secondaryPresentLatencies: number[] = [];
      for (const record of active.secondary.values()) {
        if (record.acknowledgedAtMs !== undefined) {
          secondaryPresentLatencies.push(record.acknowledgedAtMs - record.dispatchedAtMs);
        }
      }

      return {
        loopId: input.loopId,
        startedAtMs: active.startedAtMs,
        endedAtMs: input.endedAtMs,
        dispatchedCueCount: active.dispatchedCues.size,
        completedPrimaryCueCount: primaryCompletionLatencies.length,
        presentedSecondaryCueCount: secondaryPresentLatencies.length,
        secondaryPresentLatencyMs: summarizeLatencies(secondaryPresentLatencies),
        primaryCompletionLatencyMs: summarizeLatencies(primaryCompletionLatencies),
        primaryInstantAckLatencyMs: summarizeLatencies(primaryInstantLatencies),
        primaryInsertOverheadMs: summarizeLatencies(primaryInsertOverheads),
        finalVisibleDriftMs: Math.abs(
          primaryReset.acknowledgedAtMs - secondaryReset.acknowledgedAtMs,
        ),
        resetBufferSha256: primaryReset.bufferSha256,
        tickLatenessMs: input.tickLatenessMs,
        advanceOverrunMs: input.advanceOverrunMs,
      };
    } finally {
      this.active = undefined;
    }
  }

  private requireActive(): ActiveLoopTelemetry {
    if (this.active === undefined) throw new Error("no loop telemetry is active");
    return this.active;
  }

  private validateCorrelation(
    active: ActiveLoopTelemetry,
    key: CueCorrelation,
    expectedCueId?: string,
  ): void {
    if (!Number.isSafeInteger(key.generationId) || key.generationId <= 0) {
      throw new Error("generation ID must be a positive safe integer");
    }
    if (key.loopId !== active.loopId) throw new Error("correlation loop does not match active loop");
    if (expectedCueId !== undefined && key.cueId !== expectedCueId) {
      throw new Error("correlation cue does not match dispatched cue");
    }
    if (active.generationId === undefined) active.generationId = key.generationId;
    if (key.generationId !== active.generationId) {
      throw new Error("correlation generation does not match active generation");
    }
  }

  private validateFinish(active: ActiveLoopTelemetry, input: LoopFinishInput): void {
    assertTime(input.endedAtMs);
    assertLatency(input.tickLatenessMs);
    assertLatency(input.advanceOverrunMs);
    if (input.endedAtMs < active.startedAtMs) throw new Error("loop duration cannot be negative");
    if (input.loopId !== active.loopId) throw new Error("finish loop does not match active loop");
    if (active.generationId === undefined || input.generationId !== active.generationId) {
      throw new Error("finish generation does not match active generation");
    }
  }

  private requireRecord(
    records: Map<string, EndpointRecord>,
    key: CueCorrelation,
    label: string,
  ): EndpointRecord {
    const record = records.get(correlationId(key));
    if (record === undefined) throw new Error(`${label} correlation is missing`);
    return record;
  }
}

function nearestRank(sorted: readonly number[], percentile: number): number {
  const index = Math.ceil(percentile * sorted.length) - 1;
  const value = sorted[index];
  if (value === undefined) throw new Error("nearest-rank percentile requires a sample");
  return value;
}

function assertTime(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("monotonic time must be finite and non-negative");
  }
}

function assertLatency(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("latency must be finite and non-negative");
  }
}

function assertEndpointLatency(dispatchedAtMs: number, acknowledgedAtMs: number): void {
  assertTime(acknowledgedAtMs);
  if (acknowledgedAtMs < dispatchedAtMs) throw new Error("endpoint latency cannot be negative");
}

function correlationId(key: CueCorrelation): string {
  return JSON.stringify([key.generationId, key.loopId, key.cueId]);
}

function assertResetRecord(
  record: EndpointRecord | undefined,
  endpoint: Endpoint,
): asserts record is EndpointRecord {
  if (record === undefined) throw new Error(`${endpoint} reset dispatch is missing`);
  if (record.cue.kind !== "editor-action" || record.cue.payload.action.type !== "reset") {
    throw new Error(`${endpoint} reset boundary cue is not a reset action`);
  }
}
