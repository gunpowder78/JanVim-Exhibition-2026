import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { dirname, join } from "node:path";

import { z } from "zod";

import { hashDisplayGeometry, type Rectangle } from "./display-router.js";
import { G2_PROTECTED_ROOTS } from "./g2-command.js";
import type { ResourceSummary } from "./resource-sampler.js";
import type {
  LatencySummary,
  LoopTelemetrySummary,
} from "./run-telemetry.js";

export const TASK9_ARTIFACT_IDENTITY = Object.freeze({
  lockSha256:
    "9cb5f25c91d8fd7186465de0f90e6ddde8b4a54fadee431d907992a797e54a7c",
  coreBytes: 18_869_248,
  coreSha256:
    "3fc76259677185c619db2a76e302b9588df0bdd3e58600ed30a5ea08b4194f54",
} as const);

export type EvidenceAcceptance = "pass" | "fail" | "diagnostic";

export type NetworkSnapshotEvidence = {
  sampledAtMs: number;
  activeExternalDefaultRoutes: number;
  connectedExternalProfiles: number;
  offline: boolean;
};

export type RuntimeCountEvidence = {
  listeners: number;
  timers: number;
  connections: number;
  pendingCommands: number;
};

export type LoopEvidence = LoopTelemetrySummary & {
  generationId: number;
  retryCount: number;
  skipCount: number;
  recoveryCount: number;
  resources: ResourceSummary;
  countsAtStart: RuntimeCountEvidence;
  countsAtEnd: RuntimeCountEvidence;
};

export type ShutdownEvidence = {
  requestedBy:
    | "soak-complete"
    | "operator-stop"
    | "sigint"
    | "window-close"
    | "electron-quit"
    | "fatal-fault";
  agentShutdown: "acknowledged" | "timed-out" | "failed";
  hwndClose: "posted" | "timed-out" | "failed";
  janvimExit: "natural" | "forced" | "unsettled";
  bridgeClose: "closed" | "timed-out" | "failed";
  leaseRemoved: boolean;
};

export type RunAggregateEvidence = {
  completedLoops: number;
  offlineSampleCount: number;
  onlineSampleCount: number;
  resourceIncompleteLoopCount: number;
  runtimeCountGrowthLoopCount: number;
  totalRetries: number;
  totalSkips: number;
  totalRecoveries: number;
  cumulativeVisibleDriftMs: number;
  secondaryPresentLatencyMs: LatencySummary;
  primaryCompletionLatencyMs: LatencySummary;
  primaryInstantAckLatencyMs: LatencySummary;
  primaryInsertOverheadMs: LatencySummary;
  acceptanceOutcome: EvidenceAcceptance;
};

export type ShowRunEvidenceRecord = {
  schema: 2;
  runId: string;
  controllerRunId: string;
  mode: "Soak3" | "Show";
  acceptanceScope: "monitor-simulation" | "physical-projectors";
  physicalProjectorsTested: boolean;
  display: {
    mapSha256: string;
    primary: {
      id: string;
      bounds: Rectangle;
      workingArea: Rectangle;
      scaleFactor: number;
      rotation: number;
      geometrySha256: string;
    };
    secondary: {
      id: string;
      bounds: Rectangle;
      workingArea: Rectangle;
      scaleFactor: number;
      rotation: number;
      geometrySha256: string;
    };
  };
  artifact: {
    tag: "v0.10.1-gmk.4.punctuation.2";
    commit: "abbd5a5b942b202e7fe4324bcd3ddab47c672cb9";
    layoutEngine: "orthogonal";
    lockSha256: typeof TASK9_ARTIFACT_IDENTITY.lockSha256;
    coreBytes: typeof TASK9_ARTIFACT_IDENTITY.coreBytes;
    coreSha256: typeof TASK9_ARTIFACT_IDENTITY.coreSha256;
  };
  content: {
    revision: string;
    manifestBytes: number;
    manifestSha256: string;
    poemBytes: number;
    poemSha256: string;
    configSha256: string;
    mediaManifest:
      | { present: false }
      | { present: true; bytes: number; sha256: string };
  };
  offlineSnapshots: readonly NetworkSnapshotEvidence[];
  offlineVerified: boolean;
  loops: readonly LoopEvidence[];
  aggregate: RunAggregateEvidence;
  recoveries: readonly {
    generationId: number;
    domain: "secondary" | "janvim" | "controller";
    attempt: 1 | 2 | 3;
    delayMs: 1_000 | 2_000 | 4_000;
    outcome: "recovered" | "safe-ready" | "failed";
    reason: string;
  }[];
  shutdown: ShutdownEvidence;
  loggingIncomplete: boolean;
  operatorNotes: readonly string[];
};

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const PUBLISHED_TEMP_CLEANUP_ATTEMPTS = 3;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const RUN_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const CONTROLLER_RUN_ID_PATTERN = /^[A-Za-z0-9._-]{1,96}$/;
const JANVIM_PRODUCT_ROOT = "D:\\github\\JanVim";
const USER_NVIM_CONFIG_FRAGMENT = "AppData\\Local\\nvim";
const SECRET_TEXT_PATTERN =
  /(?:bridge|secret|sensitive)[a-z0-9._ -]{0,64}token|password\s*[:=]|authorization\s*[:=]|bearer\s+[a-z0-9._-]+/i;
const GENERATED_BRIDGE_TOKEN_PATTERN =
  /(?:^|[^0-9a-f])[0-9a-f]{48}(?:$|[^0-9a-f])/i;

const hashSchema = z.string().regex(HASH_PATTERN);
const safeNonnegativeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .max(MAX_SAFE_INTEGER);
const safePositiveIntegerSchema = z
  .number()
  .int()
  .positive()
  .max(MAX_SAFE_INTEGER);
const finiteNonnegativeSchema = z.number().nonnegative().finite();
const safeCoordinateSchema = z
  .number()
  .int()
  .min(Number.MIN_SAFE_INTEGER)
  .max(MAX_SAFE_INTEGER);

const rectangleSchema = z
  .object({
    x: safeCoordinateSchema,
    y: safeCoordinateSchema,
    width: safePositiveIntegerSchema,
    height: safePositiveIntegerSchema,
  })
  .strict();

const displayRoleSchema = z
  .object({
    id: z.string().min(1).max(256),
    bounds: rectangleSchema,
    workingArea: rectangleSchema,
    scaleFactor: z.number().positive().finite(),
    rotation: z.union([
      z.literal(0),
      z.literal(90),
      z.literal(180),
      z.literal(270),
    ]),
    geometrySha256: hashSchema,
  })
  .strict()
  .superRefine((role, context) => {
    const expectedHash = hashDisplayGeometry({
      displayId: role.id,
      bounds: role.bounds,
      scaleFactor: role.scaleFactor,
    });
    if (role.geometrySha256 !== expectedHash) {
      context.addIssue({
        code: "custom",
        path: ["geometrySha256"],
        message: "display geometry hash mismatch",
      });
    }
  });

const displaySchema = z
  .object({
    mapSha256: hashSchema,
    primary: displayRoleSchema,
    secondary: displayRoleSchema,
  })
  .strict()
  .refine((display) => display.primary.id !== display.secondary.id, {
    path: ["secondary", "id"],
    message: "display IDs must be distinct",
  });

const artifactSchema = z
  .object({
    tag: z.literal("v0.10.1-gmk.4.punctuation.2"),
    commit: z.literal("abbd5a5b942b202e7fe4324bcd3ddab47c672cb9"),
    layoutEngine: z.literal("orthogonal"),
    lockSha256: z.literal(TASK9_ARTIFACT_IDENTITY.lockSha256),
    coreBytes: z.literal(TASK9_ARTIFACT_IDENTITY.coreBytes),
    coreSha256: z.literal(TASK9_ARTIFACT_IDENTITY.coreSha256),
  })
  .strict();

const mediaManifestSchema = z.discriminatedUnion("present", [
  z.object({ present: z.literal(false) }).strict(),
  z
    .object({
      present: z.literal(true),
      bytes: safePositiveIntegerSchema,
      sha256: hashSchema,
    })
    .strict(),
]);

const contentSchema = z
  .object({
    revision: z.string().min(1).max(128),
    manifestBytes: safePositiveIntegerSchema,
    manifestSha256: hashSchema,
    poemBytes: safePositiveIntegerSchema,
    poemSha256: hashSchema,
    configSha256: hashSchema,
    mediaManifest: mediaManifestSchema,
  })
  .strict();

const networkSnapshotSchema = z
  .object({
    sampledAtMs: finiteNonnegativeSchema,
    activeExternalDefaultRoutes: safeNonnegativeIntegerSchema,
    connectedExternalProfiles: safeNonnegativeIntegerSchema,
    offline: z.boolean(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const measuredOffline =
      snapshot.activeExternalDefaultRoutes === 0 &&
      snapshot.connectedExternalProfiles === 0;
    if (snapshot.offline !== measuredOffline) {
      context.addIssue({
        code: "custom",
        path: ["offline"],
        message: "offline flag contradicts measured network counts",
      });
    }
  });

const latencySummarySchema = z
  .object({
    count: safeNonnegativeIntegerSchema,
    p50Ms: finiteNonnegativeSchema.nullable(),
    p95Ms: finiteNonnegativeSchema.nullable(),
    maxMs: finiteNonnegativeSchema.nullable(),
  })
  .strict()
  .superRefine((summary, context) => {
    const values = [summary.p50Ms, summary.p95Ms, summary.maxMs];
    if (summary.count === 0) {
      if (values.some((value) => value !== null)) {
        context.addIssue({
          code: "custom",
          message: "empty latency summary must contain only null endpoints",
        });
      }
      return;
    }
    if (
      summary.p50Ms === null ||
      summary.p95Ms === null ||
      summary.maxMs === null
    ) {
      context.addIssue({
        code: "custom",
        message: "measured latency summary requires every endpoint",
      });
      return;
    }
    if (
      summary.p50Ms > summary.p95Ms ||
      summary.p95Ms > summary.maxMs
    ) {
      context.addIssue({
        code: "custom",
        message: "latency summary endpoints must be monotonic",
      });
    }
  });

const scalarAggregateSchema = z
  .object({
    count: safeNonnegativeIntegerSchema,
    min: safeNonnegativeIntegerSchema.nullable(),
    max: safeNonnegativeIntegerSchema.nullable(),
    final: safeNonnegativeIntegerSchema.nullable(),
  })
  .strict()
  .superRefine((summary, context) => {
    const values = [summary.min, summary.max, summary.final];
    if (summary.count === 0) {
      if (values.some((value) => value !== null)) {
        context.addIssue({
          code: "custom",
          message: "empty resource aggregate must contain only null values",
        });
      }
      return;
    }
    if (summary.min === null || summary.max === null || summary.final === null) {
      context.addIssue({
        code: "custom",
        message: "sampled resource aggregate requires every value",
      });
      return;
    }
    if (
      summary.min > summary.max ||
      summary.final < summary.min ||
      summary.final > summary.max
    ) {
      context.addIssue({
        code: "custom",
        message: "resource aggregate values are inconsistent",
      });
    }
  });

const processAggregateSchema = z
  .object({
    rssBytes: scalarAggregateSchema,
    handleCount: scalarAggregateSchema,
  })
  .strict()
  .superRefine((aggregate, context) => {
    if (aggregate.rssBytes.count !== aggregate.handleCount.count) {
      context.addIssue({
        code: "custom",
        message: "RSS and handle aggregates must contain the same samples",
      });
    }
  });

const resourceSummarySchema = z
  .object({
    controller: processAggregateSchema,
    renderer: processAggregateSchema,
    janvim: processAggregateSchema,
    sampleIncomplete: z.boolean(),
  })
  .strict();

const runtimeCountSchema = z
  .object({
    listeners: safeNonnegativeIntegerSchema,
    timers: safeNonnegativeIntegerSchema,
    connections: safeNonnegativeIntegerSchema,
    pendingCommands: safeNonnegativeIntegerSchema,
  })
  .strict();

const loopEvidenceSchema = z
  .object({
    loopId: z.string().regex(RUN_ID_PATTERN),
    startedAtMs: finiteNonnegativeSchema,
    endedAtMs: finiteNonnegativeSchema,
    dispatchedCueCount: safeNonnegativeIntegerSchema,
    completedPrimaryCueCount: safeNonnegativeIntegerSchema,
    presentedSecondaryCueCount: safeNonnegativeIntegerSchema,
    secondaryPresentLatencyMs: latencySummarySchema,
    primaryCompletionLatencyMs: latencySummarySchema,
    primaryInstantAckLatencyMs: latencySummarySchema,
    primaryInsertOverheadMs: latencySummarySchema,
    finalVisibleDriftMs: finiteNonnegativeSchema,
    resetBufferSha256: hashSchema,
    tickLatenessMs: finiteNonnegativeSchema,
    advanceOverrunMs: finiteNonnegativeSchema,
    generationId: safePositiveIntegerSchema,
    retryCount: safeNonnegativeIntegerSchema,
    skipCount: safeNonnegativeIntegerSchema,
    recoveryCount: safeNonnegativeIntegerSchema,
    resources: resourceSummarySchema,
    countsAtStart: runtimeCountSchema,
    countsAtEnd: runtimeCountSchema,
  })
  .strict()
  .superRefine((loop, context) => {
    if (loop.endedAtMs < loop.startedAtMs) {
      context.addIssue({
        code: "custom",
        path: ["endedAtMs"],
        message: "loop end precedes loop start",
      });
    }
    if (loop.completedPrimaryCueCount > loop.dispatchedCueCount) {
      context.addIssue({
        code: "custom",
        path: ["completedPrimaryCueCount"],
        message: "primary completions exceed dispatched cues",
      });
    }
    if (loop.presentedSecondaryCueCount > loop.dispatchedCueCount) {
      context.addIssue({
        code: "custom",
        path: ["presentedSecondaryCueCount"],
        message: "secondary presentations exceed dispatched cues",
      });
    }
    if (
      loop.primaryCompletionLatencyMs.count !==
      loop.completedPrimaryCueCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["primaryCompletionLatencyMs", "count"],
        message: "primary latency count contradicts primary completions",
      });
    }
    if (
      loop.secondaryPresentLatencyMs.count !==
      loop.presentedSecondaryCueCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["secondaryPresentLatencyMs", "count"],
        message: "secondary latency count contradicts presentations",
      });
    }
    if (
      loop.primaryInstantAckLatencyMs.count +
        loop.primaryInsertOverheadMs.count !==
      loop.primaryCompletionLatencyMs.count
    ) {
      context.addIssue({
        code: "custom",
        path: ["primaryInstantAckLatencyMs", "count"],
        message: "primary latency category counts contradict completions",
      });
    }
  });

const runAggregateSchema = z
  .object({
    completedLoops: safeNonnegativeIntegerSchema,
    offlineSampleCount: safeNonnegativeIntegerSchema,
    onlineSampleCount: safeNonnegativeIntegerSchema,
    resourceIncompleteLoopCount: safeNonnegativeIntegerSchema,
    runtimeCountGrowthLoopCount: safeNonnegativeIntegerSchema,
    totalRetries: safeNonnegativeIntegerSchema,
    totalSkips: safeNonnegativeIntegerSchema,
    totalRecoveries: safeNonnegativeIntegerSchema,
    cumulativeVisibleDriftMs: finiteNonnegativeSchema,
    secondaryPresentLatencyMs: latencySummarySchema,
    primaryCompletionLatencyMs: latencySummarySchema,
    primaryInstantAckLatencyMs: latencySummarySchema,
    primaryInsertOverheadMs: latencySummarySchema,
    acceptanceOutcome: z.enum(["pass", "fail", "diagnostic"]),
  })
  .strict()
  .superRefine((aggregate, context) => {
    if (
      aggregate.primaryInstantAckLatencyMs.count +
        aggregate.primaryInsertOverheadMs.count !==
      aggregate.primaryCompletionLatencyMs.count
    ) {
      context.addIssue({
        code: "custom",
        path: ["primaryInstantAckLatencyMs", "count"],
        message: "aggregate primary latency category counts contradict completions",
      });
    }
  });

const recoveryEvidenceSchema = z
  .object({
    generationId: safePositiveIntegerSchema,
    domain: z.enum(["secondary", "janvim", "controller"]),
    attempt: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    delayMs: z.union([z.literal(1_000), z.literal(2_000), z.literal(4_000)]),
    outcome: z.enum(["recovered", "safe-ready", "failed"]),
    reason: z
      .string()
      .min(1)
      .max(4_096)
      .refine(
        (value) => Buffer.byteLength(value, "utf8") <= 4_096,
        "recovery reason must be at most 4096 UTF-8 bytes",
      ),
  })
  .strict()
  .superRefine((recovery, context) => {
    const expectedDelay = { 1: 1_000, 2: 2_000, 3: 4_000 } as const;
    if (recovery.delayMs !== expectedDelay[recovery.attempt]) {
      context.addIssue({
        code: "custom",
        path: ["delayMs"],
        message: "recovery delay does not match its attempt",
      });
    }
  });

const shutdownSchema = z
  .object({
    requestedBy: z.enum([
      "soak-complete",
      "operator-stop",
      "sigint",
      "window-close",
      "electron-quit",
      "fatal-fault",
    ]),
    agentShutdown: z.enum(["acknowledged", "timed-out", "failed"]),
    hwndClose: z.enum(["posted", "timed-out", "failed"]),
    janvimExit: z.enum(["natural", "forced", "unsettled"]),
    bridgeClose: z.enum(["closed", "timed-out", "failed"]),
    leaseRemoved: z.boolean(),
  })
  .strict();

const operatorNoteSchema = z
  .string()
  .max(4_096)
  .refine(
    (value) => Buffer.byteLength(value, "utf8") <= 4_096,
    "operator note must be at most 4096 UTF-8 bytes",
  );

const showRunEvidenceSchema = z
  .object({
    schema: z.literal(2),
    runId: z.string().regex(RUN_ID_PATTERN),
    controllerRunId: z.string().regex(CONTROLLER_RUN_ID_PATTERN),
    mode: z.enum(["Soak3", "Show"]),
    acceptanceScope: z.enum(["monitor-simulation", "physical-projectors"]),
    physicalProjectorsTested: z.boolean(),
    display: displaySchema,
    artifact: artifactSchema,
    content: contentSchema,
    offlineSnapshots: z.array(networkSnapshotSchema).max(8),
    offlineVerified: z.boolean(),
    loops: z.array(loopEvidenceSchema).max(3),
    aggregate: runAggregateSchema,
    recoveries: z.array(recoveryEvidenceSchema).max(32),
    shutdown: shutdownSchema,
    loggingIncomplete: z.boolean(),
    operatorNotes: z.array(operatorNoteSchema).max(16),
  })
  .strict()
  .superRefine((record, context) => {
    const addIssue = (path: Array<string | number>, message: string): void => {
      context.addIssue({ code: "custom", path, message });
    };

    const loopIds = new Set(record.loops.map((loop) => loop.loopId));
    if (loopIds.size !== record.loops.length) {
      addIssue(["loops"], "loop IDs must be unique");
    }

    for (let index = 1; index < record.offlineSnapshots.length; index += 1) {
      if (
        record.offlineSnapshots[index]!.sampledAtMs <=
        record.offlineSnapshots[index - 1]!.sampledAtMs
      ) {
        addIssue(
          ["offlineSnapshots", index, "sampledAtMs"],
          "network snapshots must be strictly chronological",
        );
      }
    }

    const retainedOfflineSamples = record.offlineSnapshots.filter(
      (snapshot) => snapshot.offline,
    ).length;
    const retainedOnlineSamples =
      record.offlineSnapshots.length - retainedOfflineSamples;
    const aggregateNetworkSamples =
      record.aggregate.offlineSampleCount + record.aggregate.onlineSampleCount;
    if (!Number.isSafeInteger(aggregateNetworkSamples)) {
      addIssue(["aggregate"], "aggregate network sample count is unsafe");
    }
    const maximumLifecycleNetworkSamples =
      record.aggregate.completedLoops > MAX_SAFE_INTEGER - 2
        ? MAX_SAFE_INTEGER
        : record.aggregate.completedLoops + 2;
    if (aggregateNetworkSamples > maximumLifecycleNetworkSamples) {
      addIssue(
        ["aggregate"],
        "run-wide network samples exceed the completed lifecycle",
      );
    }
    if (
      record.aggregate.resourceIncompleteLoopCount >
        record.aggregate.completedLoops ||
      record.aggregate.runtimeCountGrowthLoopCount >
        record.aggregate.completedLoops
    ) {
      addIssue(
        ["aggregate"],
        "run-wide loop violations exceed completed loops",
      );
    }

    const loopRetries = sum(record.loops.map((loop) => loop.retryCount));
    const loopSkips = sum(record.loops.map((loop) => loop.skipCount));
    const loopRecoveries = sum(record.loops.map((loop) => loop.recoveryCount));
    const retainedResourceIncompleteLoops = record.loops.filter(
      (loop) => resourceSampleIncomplete(loop.resources),
    ).length;
    const retainedRuntimeCountGrowthLoops = record.loops.filter((loop) =>
      runtimeCountsGrew(loop.countsAtStart, loop.countsAtEnd),
    ).length;
    const retainedDrift = sum(
      record.loops.map((loop) => loop.finalVisibleDriftMs),
    );
    const endpointSummaryFields = [
      "secondaryPresentLatencyMs",
      "primaryCompletionLatencyMs",
      "primaryInstantAckLatencyMs",
      "primaryInsertOverheadMs",
    ] as const;

    if (record.mode === "Soak3") {
      if (record.loops.length !== 3) {
        addIssue(["loops"], "Soak3 requires exactly three loop summaries");
      }
      if (
        record.offlineSnapshots.length !== 5 &&
        !(
          record.aggregate.acceptanceOutcome === "fail" &&
          record.offlineSnapshots.length === 4
        )
      ) {
        addIssue(
          ["offlineSnapshots"],
          "Soak3 requires exactly five network snapshots",
        );
      }
      if (record.aggregate.completedLoops !== 3) {
        addIssue(
          ["aggregate", "completedLoops"],
          "Soak3 aggregate must report exactly three completed loops",
        );
      }
      if (
        record.aggregate.offlineSampleCount !== retainedOfflineSamples ||
        record.aggregate.onlineSampleCount !== retainedOnlineSamples
      ) {
        addIssue(
          ["aggregate"],
          "Soak3 network aggregate must match its five snapshots",
        );
      }
      if (
        record.aggregate.resourceIncompleteLoopCount !==
          retainedResourceIncompleteLoops ||
        record.aggregate.runtimeCountGrowthLoopCount !==
          retainedRuntimeCountGrowthLoops
      ) {
        addIssue(
          ["aggregate"],
          "Soak3 loop-violation aggregates must match its three loops",
        );
      }
      if (
        record.aggregate.totalRetries !== loopRetries ||
        record.aggregate.totalSkips !== loopSkips ||
        record.aggregate.totalRecoveries !== loopRecoveries
      ) {
        addIssue(
          ["aggregate"],
          "Soak3 counters must equal the three loop summaries",
        );
      }
      if (record.aggregate.cumulativeVisibleDriftMs !== retainedDrift) {
        addIssue(
          ["aggregate", "cumulativeVisibleDriftMs"],
          "Soak3 cumulative drift must equal the three loop drifts",
        );
      }
      for (const field of endpointSummaryFields) {
        const loopSampleCount = sum(
          record.loops.map((loop) => loop[field].count),
        );
        if (record.aggregate[field].count !== loopSampleCount) {
          addIssue(
            ["aggregate", field, "count"],
            "Soak3 endpoint count must equal the three loop summaries",
          );
        }
      }
    } else {
      if (record.aggregate.completedLoops < record.loops.length) {
        addIssue(
          ["aggregate", "completedLoops"],
          "Show completed-loop total cannot be below retained loops",
        );
      }
      if (
        record.aggregate.offlineSampleCount < retainedOfflineSamples ||
        record.aggregate.onlineSampleCount < retainedOnlineSamples
      ) {
        addIssue(
          ["aggregate"],
          "Show network totals cannot be below retained snapshots",
        );
      }
      if (
        record.aggregate.resourceIncompleteLoopCount <
          retainedResourceIncompleteLoops ||
        record.aggregate.runtimeCountGrowthLoopCount <
          retainedRuntimeCountGrowthLoops
      ) {
        addIssue(
          ["aggregate"],
          "Show loop-violation totals cannot be below retained loops",
        );
      }
      if (
        record.aggregate.totalRetries < loopRetries ||
        record.aggregate.totalSkips < loopSkips ||
        record.aggregate.totalRecoveries < loopRecoveries
      ) {
        addIssue(
          ["aggregate"],
          "Show totals cannot be below retained loop counters",
        );
      }
      if (record.aggregate.cumulativeVisibleDriftMs < retainedDrift) {
        addIssue(
          ["aggregate", "cumulativeVisibleDriftMs"],
          "Show cumulative drift cannot be below retained loop drift",
        );
      }
      for (const field of endpointSummaryFields) {
        const retainedSampleCount = sum(
          record.loops.map((loop) => loop[field].count),
        );
        if (record.aggregate[field].count < retainedSampleCount) {
          addIssue(
            ["aggregate", field, "count"],
            "Show endpoint total cannot be below retained loop summaries",
          );
        }
      }
    }

    if (record.recoveries.length > record.aggregate.totalRecoveries) {
      addIssue(
        ["recoveries"],
        "retained recovery events exceed the aggregate total",
      );
    }

    const expectedOfflineVerified =
      record.aggregate.acceptanceOutcome !== "diagnostic" &&
      aggregateNetworkSamples > 0 &&
      record.aggregate.offlineSampleCount > 0 &&
      record.aggregate.onlineSampleCount === 0;
    if (record.offlineVerified !== expectedOfflineVerified) {
      addIssue(
        ["offlineVerified"],
        "offlineVerified contradicts run-wide network evidence",
      );
    }

    if (
      record.physicalProjectorsTested !==
      (record.acceptanceScope === "physical-projectors")
    ) {
      addIssue(
        ["physicalProjectorsTested"],
        "projector claim contradicts the acceptance scope",
      );
    }

    if (record.aggregate.acceptanceOutcome !== "pass") return;
    for (const failure of showAcceptanceFailures(record)) {
      addIssue(failure.path, failure.message);
    }
  });

type AcceptanceFailure = {
  path: Array<string | number>;
  message: string;
};

const RUNTIME_COUNT_FIELDS = [
  "listeners",
  "timers",
  "connections",
  "pendingCommands",
] as const;

function showAcceptanceFailures(
  record: ShowRunEvidenceRecord,
): AcceptanceFailure[] {
  const failures: AcceptanceFailure[] = [];
  const fail = (path: Array<string | number>, message: string): void => {
    failures.push({ path, message });
  };

  if (
    record.artifact.lockSha256 !== TASK9_ARTIFACT_IDENTITY.lockSha256 ||
    record.artifact.coreBytes !== TASK9_ARTIFACT_IDENTITY.coreBytes ||
    record.artifact.coreSha256 !== TASK9_ARTIFACT_IDENTITY.coreSha256
  ) {
    fail(["artifact"], "passing evidence requires the exact Task 9 artifact");
  }

  const expectedRetainedLoops = Math.min(record.aggregate.completedLoops, 3);
  const expectedRetainedSnapshots = Math.min(
    record.aggregate.completedLoops + 2,
    record.mode === "Soak3" ? 5 : 8,
  );
  const aggregateNetworkSamples =
    record.aggregate.offlineSampleCount + record.aggregate.onlineSampleCount;
  const cardinalityAccepted =
    record.aggregate.completedLoops > 0 &&
    record.loops.length === expectedRetainedLoops &&
    record.offlineSnapshots.length === expectedRetainedSnapshots &&
    aggregateNetworkSamples === record.aggregate.completedLoops + 2 &&
    (record.mode !== "Soak3" || record.aggregate.completedLoops === 3);
  if (!cardinalityAccepted) {
    fail(
      ["loops"],
      "passing evidence requires the exact mode loop and sample cardinality",
    );
  }

  if (
    !record.offlineVerified ||
    record.offlineSnapshots.length === 0 ||
    record.offlineSnapshots.some((snapshot) => !snapshot.offline) ||
    record.aggregate.onlineSampleCount !== 0
  ) {
    fail(["offlineVerified"], "passing evidence requires offline verification");
  }
  if (record.aggregate.cumulativeVisibleDriftMs >= 250) {
    fail(
      ["aggregate", "cumulativeVisibleDriftMs"],
      "passing cumulative visible drift must be below 250 ms",
    );
  }
  if (record.aggregate.resourceIncompleteLoopCount !== 0) {
    fail(
      ["aggregate", "resourceIncompleteLoopCount"],
      "passing evidence cannot contain a resource-incomplete loop",
    );
  }
  if (record.aggregate.runtimeCountGrowthLoopCount !== 0) {
    fail(
      ["aggregate", "runtimeCountGrowthLoopCount"],
      "passing evidence cannot contain runtime count growth",
    );
  }

  const measuredSummaries: Array<
    [keyof RunAggregateEvidence, LatencySummary, boolean]
  > = [
    [
      "secondaryPresentLatencyMs",
      record.aggregate.secondaryPresentLatencyMs,
      true,
    ],
    [
      "primaryCompletionLatencyMs",
      record.aggregate.primaryCompletionLatencyMs,
      false,
    ],
    [
      "primaryInstantAckLatencyMs",
      record.aggregate.primaryInstantAckLatencyMs,
      true,
    ],
    [
      "primaryInsertOverheadMs",
      record.aggregate.primaryInsertOverheadMs,
      true,
    ],
  ];
  for (const [field, summary, gated] of measuredSummaries) {
    if (summary.count === 0 || summary.p95Ms === null) {
      fail(
        ["aggregate", field],
        "passing evidence requires a measured P95 summary",
      );
    } else if (gated && summary.p95Ms >= 100) {
      fail(
        ["aggregate", field, "p95Ms"],
        "passing P95 must be below 100 ms",
      );
    }
  }

  for (let index = 0; index < record.loops.length; index += 1) {
    const loop = record.loops[index]!;
    if (loop.resetBufferSha256 !== record.content.poemSha256) {
      fail(
        ["loops", index, "resetBufferSha256"],
        "passing reset hash must match the content poem hash",
      );
    }
    if (loop.resources.sampleIncomplete) {
      fail(
        ["loops", index, "resources", "sampleIncomplete"],
        "passing evidence requires complete resource samples",
      );
    }
    for (const role of ["controller", "renderer", "janvim"] as const) {
      if (
        loop.resources[role].rssBytes.count === 0 ||
        loop.resources[role].handleCount.count === 0
      ) {
        fail(
          ["loops", index, "resources", role],
          "passing evidence requires resource samples for every process",
        );
      }
    }
    for (const field of RUNTIME_COUNT_FIELDS) {
      if (loop.countsAtEnd[field] > loop.countsAtStart[field]) {
        fail(
          ["loops", index, "countsAtEnd", field],
          "passing evidence cannot contain runtime count growth",
        );
      }
    }
  }

  const expectedShutdownReason =
    record.mode === "Soak3" ? "soak-complete" : "operator-stop";
  if (
    record.shutdown.agentShutdown !== "acknowledged" ||
    record.shutdown.hwndClose !== "posted" ||
    record.shutdown.janvimExit !== "natural" ||
    record.shutdown.bridgeClose !== "closed" ||
    !record.shutdown.leaseRemoved ||
    record.shutdown.requestedBy !== expectedShutdownReason
  ) {
    fail(
      ["shutdown"],
      "passing evidence requires the complete successful shutdown ladder",
    );
  }
  if (record.loggingIncomplete) {
    fail(
      ["loggingIncomplete"],
      "passing evidence requires complete bounded logging",
    );
  }
  return failures;
}

export function evaluateShowAcceptance(
  record: ShowRunEvidenceRecord,
  options: {
    requestedResultOk: boolean;
    diagnosticConnected: boolean;
  },
): EvidenceAcceptance {
  if (options.diagnosticConnected) return "diagnostic";
  if (!options.requestedResultOk) return "fail";
  return showAcceptanceFailures(record).length === 0 ? "pass" : "fail";
}

export function parseShowRunEvidence(value: unknown): ShowRunEvidenceRecord {
  const record = showRunEvidenceSchema.parse(value) as ShowRunEvidenceRecord;
  assertNoProhibitedSerializedContent(record);
  return record;
}

export async function writeShowRunEvidenceAtomic(
  path: string,
  value: unknown,
): Promise<void> {
  const record = parseShowRunEvidence(value);
  const serialized = `${JSON.stringify(record, null, 2)}\n`;
  if (fs.existsSync(path)) throw new Error("show-run-evidence-already-exists");

  const temporaryPath = join(
    dirname(path),
    `.show-run-evidence-${process.pid}-${randomUUID()}.tmp`,
  );
  let descriptor: number | undefined;
  let ownsTemporary = false;
  try {
    descriptor = fs.openSync(temporaryPath, "wx", 0o600);
    ownsTemporary = true;
    fs.writeFileSync(descriptor, serialized, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    if (fs.existsSync(path)) {
      throw new Error("show-run-evidence-already-exists");
    }
    linkTemporaryExclusivelySync(temporaryPath, path);
    ownsTemporary = false;
    removePublishedTemporaryWithRetrySync(temporaryPath);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (ownsTemporary) fs.rmSync(temporaryPath, { force: true });
  }
}

function linkTemporaryExclusivelySync(
  temporaryPath: string,
  destinationPath: string,
): void {
  try {
    fs.linkSync(temporaryPath, destinationPath);
  } catch (error) {
    if (hasErrorCode(error, "EEXIST")) {
      throw new Error("show-run-evidence-already-exists");
    }
    throw error;
  }
}

function removePublishedTemporaryWithRetrySync(temporaryPath: string): void {
  for (let attempt = 1; attempt <= PUBLISHED_TEMP_CLEANUP_ATTEMPTS; attempt += 1) {
    try {
      fs.rmSync(temporaryPath);
      return;
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) return;
      if (attempt === PUBLISHED_TEMP_CLEANUP_ATTEMPTS) {
        throw new Error(
          "show-run-evidence-committed-but-cleanup-failed",
        );
      }
    }
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === code
  );
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function resourceSampleIncomplete(resources: ResourceSummary): boolean {
  return (
    resources.sampleIncomplete ||
    (["controller", "renderer", "janvim"] as const).some(
      (role) =>
        resources[role].rssBytes.count === 0 ||
        resources[role].handleCount.count === 0,
    )
  );
}

function runtimeCountsGrew(
  countsAtStart: RuntimeCountEvidence,
  countsAtEnd: RuntimeCountEvidence,
): boolean {
  return RUNTIME_COUNT_FIELDS.some(
    (field) => countsAtEnd[field] > countsAtStart[field],
  );
}

function assertNoProhibitedSerializedContent(
  record: ShowRunEvidenceRecord,
): void {
  const pending: unknown[] = [record];
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === "string") {
      if (
        SECRET_TEXT_PATTERN.test(value) ||
        GENERATED_BRIDGE_TOKEN_PATTERN.test(value) ||
        containsPathRoot(value, JANVIM_PRODUCT_ROOT) ||
        containsPathRoot(value, USER_NVIM_CONFIG_FRAGMENT) ||
        G2_PROTECTED_ROOTS.some((root) => containsPathRoot(value, root))
      ) {
        throw new Error("show-run-evidence-prohibited-content");
      }
      continue;
    }
    if (value === null || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    for (const [key, child] of Object.entries(value)) {
      if (/token|secret|password|authorization/i.test(key)) {
        throw new Error("show-run-evidence-prohibited-content");
      }
      pending.push(child);
    }
  }
}

function containsPathRoot(value: string, root: string): boolean {
  const normalizedValue = value.replaceAll("/", "\\").toLowerCase();
  const normalizedRoot = root.replaceAll("/", "\\").toLowerCase();
  let start = normalizedValue.indexOf(normalizedRoot);
  while (start >= 0) {
    const next = normalizedValue[start + normalizedRoot.length];
    if (
      next === undefined ||
      next === "\\" ||
      (!/[a-z0-9_-]/i.test(next) && next !== "-")
    ) {
      return true;
    }
    start = normalizedValue.indexOf(normalizedRoot, start + 1);
  }
  return false;
}
