import fs from "node:fs";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  parseShowRunEvidence,
  writeShowRunEvidenceAtomic,
  type LoopEvidence,
  type ShowRunEvidenceRecord,
} from "../src/show-run-evidence.ts";
import type { LatencySummary } from "../src/run-telemetry.ts";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const POEM_SHA256 = "d".repeat(64);
const CORE_SHA256 =
  "224b3457d89fbc6cf946359683632f29f9262bae08b6f0d2e3043a3a7a6d83b3";
const PROTECTED_PATHS = [
  "D:\\VirtualData\\TempCache\\janvim-root-export-quarantine-20260826-110433-6473a2d7ebbc4524b66c61c07e540504",
  "D:\\VirtualData\\TempCache\\janvim-task5-cached-d42e9769283e47dc8b98cf94baee739d",
  "D:\\VirtualData\\TempCache\\janvim-task5-physical-cached-e9735e8d02e34ff4a4ac8836f8e22dcb",
] as const;

function latencySummary(
  count = 3,
  p50Ms: number | null = 20,
  p95Ms: number | null = 40,
  maxMs: number | null = 50,
): LatencySummary {
  return { count, p50Ms, p95Ms, maxMs };
}

function scalarAggregate(
  count = 2,
  min: number | null = 100,
  max: number | null = 120,
  final: number | null = 110,
) {
  return { count, min, max, final };
}

function loopEvidence(
  loopNumber: number,
  finalVisibleDriftMs: number,
  overrides: Partial<LoopEvidence> = {},
): LoopEvidence {
  const startedAtMs = (loopNumber - 1) * 90_000;
  return {
    loopId: `loop-${loopNumber}`,
    startedAtMs,
    endedAtMs: startedAtMs + 90_000,
    dispatchedCueCount: 4,
    completedPrimaryCueCount: 3,
    presentedSecondaryCueCount: 3,
    secondaryPresentLatencyMs: latencySummary(3, 20, 40, 50),
    primaryCompletionLatencyMs: latencySummary(3, 45, 1_300, 1_300),
    primaryInstantAckLatencyMs: latencySummary(2, 30, 50, 50),
    primaryInsertOverheadMs: latencySummary(1, 60, 60, 60),
    finalVisibleDriftMs,
    resetBufferSha256: POEM_SHA256,
    tickLatenessMs: 4,
    advanceOverrunMs: 2,
    generationId: loopNumber,
    retryCount: loopNumber === 2 ? 1 : 0,
    skipCount: 0,
    recoveryCount: loopNumber === 2 ? 1 : 0,
    resources: {
      controller: {
        rssBytes: scalarAggregate(2, 100_000, 120_000, 110_000),
        handleCount: scalarAggregate(2, 20, 24, 22),
      },
      renderer: {
        rssBytes: scalarAggregate(2, 200_000, 240_000, 230_000),
        handleCount: scalarAggregate(2, 30, 36, 34),
      },
      janvim: {
        rssBytes: scalarAggregate(2, 300_000, 360_000, 350_000),
        handleCount: scalarAggregate(2, 40, 48, 46),
      },
      sampleIncomplete: false,
    },
    countsAtStart: {
      listeners: 4,
      timers: 2,
      connections: 1,
      pendingCommands: 0,
    },
    countsAtEnd: {
      listeners: 4,
      timers: 2,
      connections: 1,
      pendingCommands: 0,
    },
    ...overrides,
  };
}

function validEvidenceRecord(
  overrides: Partial<ShowRunEvidenceRecord> = {},
): ShowRunEvidenceRecord {
  return {
    schema: 1,
    runId: "show-run-001",
    controllerRunId: "controller-run-001",
    mode: "Soak3",
    acceptanceScope: "monitor-simulation",
    physicalProjectorsTested: false,
    display: {
      mapSha256: HASH_A,
      primary: {
        id: "111",
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workingArea: { x: 0, y: 0, width: 1920, height: 1040 },
        scaleFactor: 1,
        rotation: 0,
        geometrySha256:
          "b2bc82d7bea454184acfb21ae9139e97c32aefb994443034423653e85f9c83cc",
      },
      secondary: {
        id: "222",
        bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
        workingArea: { x: 1920, y: 0, width: 1920, height: 1040 },
        scaleFactor: 1,
        rotation: 0,
        geometrySha256:
          "2ebac5faac6c5f34562d1e91088736c9e70943c9c42846616a418db904319928",
      },
    },
    artifact: {
      tag: "v0.10.1-gmk.4",
      commit: "e95633101d93f8448b0f906e918b5d836ab95273",
      layoutEngine: "orthogonal",
      lockSha256: HASH_B,
      coreBytes: 18_866_688,
      coreSha256: CORE_SHA256,
    },
    content: {
      revision: "20260829-0001",
      manifestBytes: 4096,
      manifestSha256: HASH_C,
      poemBytes: 2048,
      poemSha256: POEM_SHA256,
      configSha256: HASH_A,
      mediaManifest: { present: false },
    },
    offlineSnapshots: [
      {
        sampledAtMs: 0,
        activeExternalDefaultRoutes: 0,
        connectedExternalProfiles: 0,
        offline: true,
      },
      {
        sampledAtMs: 90_000,
        activeExternalDefaultRoutes: 0,
        connectedExternalProfiles: 0,
        offline: true,
      },
      {
        sampledAtMs: 180_000,
        activeExternalDefaultRoutes: 0,
        connectedExternalProfiles: 0,
        offline: true,
      },
      {
        sampledAtMs: 270_000,
        activeExternalDefaultRoutes: 0,
        connectedExternalProfiles: 0,
        offline: true,
      },
      {
        sampledAtMs: 270_100,
        activeExternalDefaultRoutes: 0,
        connectedExternalProfiles: 0,
        offline: true,
      },
    ],
    offlineVerified: true,
    loops: [loopEvidence(1, 50), loopEvidence(2, 60), loopEvidence(3, 70)],
    aggregate: {
      completedLoops: 3,
      offlineSampleCount: 5,
      onlineSampleCount: 0,
      totalRetries: 1,
      totalSkips: 0,
      totalRecoveries: 1,
      cumulativeVisibleDriftMs: 180,
      secondaryPresentLatencyMs: latencySummary(9, 20, 60, 70),
      primaryCompletionLatencyMs: latencySummary(9, 50, 1_500, 1_500),
      primaryInstantAckLatencyMs: latencySummary(6, 30, 55, 60),
      primaryInsertOverheadMs: latencySummary(3, 60, 70, 80),
      acceptanceOutcome: "pass",
    },
    recoveries: [
      {
        generationId: 2,
        domain: "secondary",
        attempt: 1,
        delayMs: 1_000,
        outcome: "recovered",
        reason: "renderer-exit",
      },
    ],
    shutdown: {
      requestedBy: "soak-complete",
      agentShutdown: "acknowledged",
      hwndClose: "posted",
      janvimExit: "natural",
      bridgeClose: "closed",
      leaseRemoved: true,
    },
    loggingIncomplete: false,
    operatorNotes: ["Offline monitor rehearsal."],
    ...overrides,
  };
}

function validShowRecord(): ShowRunEvidenceRecord {
  const record = validEvidenceRecord();
  return {
    ...record,
    mode: "Show",
    aggregate: { ...record.aggregate, acceptanceOutcome: "diagnostic" },
    shutdown: { ...record.shutdown, requestedBy: "operator-stop" },
  };
}

function cloneRecord(record = validEvidenceRecord()): ShowRunEvidenceRecord {
  return structuredClone(record);
}

function setCumulativeDrift(record: ShowRunEvidenceRecord, value: number): void {
  record.loops = record.loops.map((loop, index) => ({
    ...loop,
    finalVisibleDriftMs: index === 0 ? value : 0,
  }));
  record.aggregate.cumulativeVisibleDriftMs = value;
}

function setAggregateP95(
  record: ShowRunEvidenceRecord,
  field:
    | "secondaryPresentLatencyMs"
    | "primaryCompletionLatencyMs"
    | "primaryInstantAckLatencyMs"
    | "primaryInsertOverheadMs",
  value: number,
): void {
  record.aggregate[field] = {
    ...record.aggregate[field],
    p95Ms: value,
    maxMs: value,
  };
}

function recoveryEvidence(index: number) {
  const attempt = ((index % 3) + 1) as 1 | 2 | 3;
  const delayMs = ({ 1: 1_000, 2: 2_000, 3: 4_000 } as const)[attempt];
  return {
    generationId: index + 1,
    domain: "secondary" as const,
    attempt,
    delayMs,
    outcome: "recovered" as const,
    reason: `recovery-${index + 1}`,
  };
}

function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, item]) => [key, reverseObjectKeys(item)]),
  );
}

describe("strict show-run evidence schema", () => {
  it("round-trips the minimal passing Soak3 record with three unique loops and five offline snapshots", () => {
    const record = validEvidenceRecord();

    const parsed = parseShowRunEvidence(record);

    expect(parsed).toEqual(record);
    expect(new Set(parsed.loops.map((loop) => loop.loopId)).size).toBe(3);
    expect(parsed.offlineSnapshots).toHaveLength(5);
    expect(parsed.offlineSnapshots.every((snapshot) => snapshot.offline)).toBe(true);
  });

  it("preserves the 96-byte controller invocation identity without widening run IDs", () => {
    const controllerRunId = "c".repeat(96);
    expect(
      parseShowRunEvidence(validEvidenceRecord({ controllerRunId }))
        .controllerRunId,
    ).toBe(controllerRunId);
    expect(() =>
      parseShowRunEvidence(
        validEvidenceRecord({ controllerRunId: "c".repeat(97) }),
      ),
    ).toThrow();
    expect(() =>
      parseShowRunEvidence(validEvidenceRecord({ runId: "r".repeat(65) })),
    ).toThrow();
  });

  it("rejects the wrong Soak3 loop or snapshot cardinality and duplicate loop IDs", () => {
    for (const loopCount of [2, 4]) {
      const record = cloneRecord();
      record.loops = [
        loopEvidence(1, 50),
        loopEvidence(2, 60),
        loopEvidence(3, 70),
        loopEvidence(4, 0),
      ].slice(0, loopCount);
      expect(() => parseShowRunEvidence(record), `${loopCount} loops`).toThrow();
    }

    for (const snapshotCount of [4, 6]) {
      const record = cloneRecord();
      const extra = {
        ...record.offlineSnapshots[4]!,
        sampledAtMs: 270_200,
      };
      record.offlineSnapshots = [...record.offlineSnapshots, extra].slice(
        0,
        snapshotCount,
      );
      record.aggregate.offlineSampleCount = snapshotCount;
      expect(
        () => parseShowRunEvidence(record),
        `${snapshotCount} snapshots`,
      ).toThrow();
    }

    const duplicate = cloneRecord();
    duplicate.loops = duplicate.loops.map((loop, index) => ({
      ...loop,
      loopId: index === 2 ? duplicate.loops[0]!.loopId : loop.loopId,
    }));
    expect(() => parseShowRunEvidence(duplicate)).toThrow();
  });

  it("retains at most three Show loop summaries and eight network snapshots", () => {
    const threeLoops = validShowRecord();
    expect(parseShowRunEvidence(threeLoops).loops).toHaveLength(3);

    const fourLoops = cloneRecord(threeLoops);
    fourLoops.loops = [...fourLoops.loops, loopEvidence(4, 20)];
    fourLoops.aggregate.completedLoops = 4;
    fourLoops.aggregate.cumulativeVisibleDriftMs = 200;
    expect(() => parseShowRunEvidence(fourLoops)).toThrow();

    const eightSnapshots = cloneRecord(threeLoops);
    eightSnapshots.offlineSnapshots = [
      ...eightSnapshots.offlineSnapshots,
      ...[1, 2, 3].map((offset) => ({
        sampledAtMs: 270_100 + offset,
        activeExternalDefaultRoutes: 0,
        connectedExternalProfiles: 0,
        offline: true as const,
      })),
    ];
    eightSnapshots.aggregate.offlineSampleCount = 8;
    expect(parseShowRunEvidence(eightSnapshots).offlineSnapshots).toHaveLength(8);

    const nineSnapshots = cloneRecord(eightSnapshots);
    nineSnapshots.offlineSnapshots = [
      ...nineSnapshots.offlineSnapshots,
      {
        sampledAtMs: 270_200,
        activeExternalDefaultRoutes: 0,
        connectedExternalProfiles: 0,
        offline: true,
      },
    ];
    nineSnapshots.aggregate.offlineSampleCount = 9;
    expect(() => parseShowRunEvidence(nineSnapshots)).toThrow();
  });

  it("rejects unknown keys at every strict object boundary", () => {
    const topLevel = { ...validEvidenceRecord(), unexpected: true };
    expect(() => parseShowRunEvidence(topLevel)).toThrow();

    const nested = cloneRecord();
    (nested.loops[0]!.countsAtStart as Record<string, unknown>).unexpected = 1;
    expect(() => parseShowRunEvidence(nested)).toThrow();

    const nestedUnion = cloneRecord();
    nestedUnion.content.mediaManifest = {
      present: false,
      bytes: 1,
    } as ShowRunEvidenceRecord["content"]["mediaManifest"];
    expect(() => parseShowRunEvidence(nestedUnion)).toThrow();
  });

  it("rejects negative, unsafe, and otherwise impossible counts", () => {
    const mutations: Array<[string, (record: ShowRunEvidenceRecord) => void]> = [
      ["negative aggregate count", (record) => { record.aggregate.totalRetries = -1; }],
      [
        "unsafe aggregate count",
        (record) => { record.aggregate.offlineSampleCount = Number.MAX_SAFE_INTEGER + 1; },
      ],
      ["negative cue count", (record) => { record.loops[0]!.dispatchedCueCount = -1; }],
      ["zero generation", (record) => { record.loops[0]!.generationId = 0; }],
      ["negative runtime count", (record) => { record.loops[0]!.countsAtEnd.timers = -1; }],
      [
        "unsafe resource count",
        (record) => {
          record.loops[0]!.resources.controller.rssBytes.count =
            Number.MAX_SAFE_INTEGER + 1;
        },
      ],
      [
        "negative network count",
        (record) => { record.offlineSnapshots[0]!.connectedExternalProfiles = -1; },
      ],
      ["unsafe byte count", (record) => { record.content.poemBytes = Infinity; }],
      [
        "more completions than dispatches",
        (record) => { record.loops[0]!.completedPrimaryCueCount = 5; },
      ],
      ["end before start", (record) => { record.loops[0]!.endedAtMs = -1; }],
    ];

    for (const [name, mutate] of mutations) {
      const record = cloneRecord();
      mutate(record);
      expect(() => parseShowRunEvidence(record), name).toThrow();
    }

    const showCategoryMismatch = cloneRecord(validShowRecord());
    showCategoryMismatch.aggregate.primaryCompletionLatencyMs.count = 10;
    expect(
      () => parseShowRunEvidence(showCategoryMismatch),
      "Show aggregate primary category count",
    ).toThrow();
  });

  it("rejects internally inconsistent latency and resource summaries", () => {
    const mutations: Array<[string, (record: ShowRunEvidenceRecord) => void]> = [
      [
        "zero latency count with values",
        (record) => {
          record.loops[0]!.secondaryPresentLatencyMs.count = 0;
        },
      ],
      [
        "positive latency count without values",
        (record) => {
          record.aggregate.primaryCompletionLatencyMs = latencySummary(
            1,
            null,
            null,
            null,
          );
        },
      ],
      [
        "descending latency percentiles",
        (record) => {
          record.aggregate.secondaryPresentLatencyMs = latencySummary(3, 50, 40, 60);
        },
      ],
      [
        "zero resource count with values",
        (record) => {
          record.loops[0]!.resources.renderer.handleCount.count = 0;
        },
      ],
      [
        "descending resource range",
        (record) => {
          record.loops[0]!.resources.janvim.rssBytes = scalarAggregate(
            2,
            400,
            300,
            350,
          );
        },
      ],
    ];

    for (const [name, mutate] of mutations) {
      const record = cloneRecord();
      mutate(record);
      expect(() => parseShowRunEvidence(record), name).toThrow();
    }
  });

  it("rejects endpoint and process sample counts that contradict their producers", () => {
    const mutations: Array<[string, (record: ShowRunEvidenceRecord) => void]> = [
      [
        "loop primary endpoint count",
        (record) => {
          record.loops[0]!.primaryCompletionLatencyMs.count = 2;
        },
      ],
      [
        "loop secondary endpoint count",
        (record) => {
          record.loops[0]!.secondaryPresentLatencyMs.count = 2;
        },
      ],
      [
        "loop primary category count",
        (record) => {
          record.loops[0]!.primaryInstantAckLatencyMs.count = 1;
        },
      ],
      [
        "aggregate endpoint count",
        (record) => {
          record.aggregate.secondaryPresentLatencyMs.count = 8;
        },
      ],
      [
        "paired process sample count",
        (record) => {
          record.loops[0]!.resources.controller.handleCount.count = 1;
        },
      ],
    ];

    for (const [name, mutate] of mutations) {
      const record = cloneRecord();
      mutate(record);
      expect(() => parseShowRunEvidence(record), name).toThrow();
    }
  });

  it("enforces aggregate, retry-delay, and per-snapshot consistency", () => {
    const wrongTotals = cloneRecord();
    wrongTotals.aggregate.totalRetries = 2;
    expect(() => parseShowRunEvidence(wrongTotals)).toThrow();

    const wrongDrift = cloneRecord();
    wrongDrift.aggregate.cumulativeVisibleDriftMs = 179;
    expect(() => parseShowRunEvidence(wrongDrift)).toThrow();

    const wrongDelay = cloneRecord();
    wrongDelay.recoveries[0]!.delayMs = 2_000;
    expect(() => parseShowRunEvidence(wrongDelay)).toThrow();

    const contradictorySnapshot = cloneRecord();
    contradictorySnapshot.offlineSnapshots[0]!.activeExternalDefaultRoutes = 1;
    expect(() => parseShowRunEvidence(contradictorySnapshot)).toThrow();
  });

  it("caps retained recoveries at 32 and operator notes at 16", () => {
    const atLimits = cloneRecord(validShowRecord());
    atLimits.recoveries = Array.from({ length: 32 }, (_, index) =>
      recoveryEvidence(index),
    );
    atLimits.aggregate.totalRecoveries = 32;
    atLimits.operatorNotes = Array.from({ length: 16 }, (_, index) =>
      `note-${index + 1}`,
    );
    expect(parseShowRunEvidence(atLimits).recoveries).toHaveLength(32);
    expect(parseShowRunEvidence(atLimits).operatorNotes).toHaveLength(16);

    const tooManyRecoveries = cloneRecord(atLimits);
    tooManyRecoveries.recoveries = [
      ...tooManyRecoveries.recoveries,
      recoveryEvidence(32),
    ];
    tooManyRecoveries.aggregate.totalRecoveries = 33;
    expect(() => parseShowRunEvidence(tooManyRecoveries)).toThrow();

    const tooManyNotes = cloneRecord(atLimits);
    tooManyNotes.operatorNotes = [...tooManyNotes.operatorNotes, "note-17"];
    expect(() => parseShowRunEvidence(tooManyNotes)).toThrow();
  });

  it("measures each operator note using its UTF-8 byte length", () => {
    const exactly4096Bytes = cloneRecord();
    exactly4096Bytes.operatorNotes = ["界".repeat(1_365) + "a"];
    expect(parseShowRunEvidence(exactly4096Bytes).operatorNotes).toEqual(
      exactly4096Bytes.operatorNotes,
    );

    const bytes4097 = cloneRecord();
    bytes4097.operatorNotes = ["界".repeat(1_365) + "ab"];
    expect(() => parseShowRunEvidence(bytes4097)).toThrow();
  });

  it("keeps offlineVerified and aggregate sample counts consistent", () => {
    const online = cloneRecord();
    online.offlineSnapshots[2] = {
      ...online.offlineSnapshots[2]!,
      activeExternalDefaultRoutes: 1,
      offline: false,
    };
    online.aggregate.offlineSampleCount = 4;
    online.aggregate.onlineSampleCount = 1;
    expect(() => parseShowRunEvidence(online)).toThrow();

    online.offlineVerified = false;
    online.aggregate.acceptanceOutcome = "diagnostic";
    expect(parseShowRunEvidence(online).offlineVerified).toBe(false);

    const falseDespiteAllOffline = cloneRecord();
    falseDespiteAllOffline.offlineVerified = false;
    falseDespiteAllOffline.aggregate.acceptanceOutcome = "diagnostic";
    expect(() => parseShowRunEvidence(falseDespiteAllOffline)).toThrow();

    const wrongSampleCounts = cloneRecord();
    wrongSampleCounts.aggregate.offlineSampleCount = 4;
    expect(() => parseShowRunEvidence(wrongSampleCounts)).toThrow();
  });

  it("requires monitor scope to be nonphysical and projector scope to be physical", () => {
    const monitorClaimingProjectors = cloneRecord();
    monitorClaimingProjectors.physicalProjectorsTested = true;
    expect(() => parseShowRunEvidence(monitorClaimingProjectors)).toThrow();

    const projectorWithoutProjectors = cloneRecord();
    projectorWithoutProjectors.acceptanceScope = "physical-projectors";
    expect(() => parseShowRunEvidence(projectorWithoutProjectors)).toThrow();

    projectorWithoutProjectors.physicalProjectorsTested = true;
    expect(parseShowRunEvidence(projectorWithoutProjectors).acceptanceScope).toBe(
      "physical-projectors",
    );
  });

  it("applies strict pass thresholds while leaving raw primary completion ungated", () => {
    const belowDriftBoundary = cloneRecord();
    setCumulativeDrift(belowDriftBoundary, 249.999);
    expect(parseShowRunEvidence(belowDriftBoundary).aggregate.acceptanceOutcome).toBe(
      "pass",
    );

    const atDriftBoundary = cloneRecord();
    setCumulativeDrift(atDriftBoundary, 250);
    expect(() => parseShowRunEvidence(atDriftBoundary)).toThrow();

    for (const field of [
      "secondaryPresentLatencyMs",
      "primaryInstantAckLatencyMs",
      "primaryInsertOverheadMs",
    ] as const) {
      const belowLatencyBoundary = cloneRecord();
      setAggregateP95(belowLatencyBoundary, field, 99.999);
      expect(
        parseShowRunEvidence(belowLatencyBoundary).aggregate.acceptanceOutcome,
        `${field} below threshold`,
      ).toBe("pass");

      const atLatencyBoundary = cloneRecord();
      setAggregateP95(atLatencyBoundary, field, 100);
      expect(
        () => parseShowRunEvidence(atLatencyBoundary),
        `${field} at threshold`,
      ).toThrow();
    }

    const slowRawCompletion = cloneRecord();
    setAggregateP95(slowRawCompletion, "primaryCompletionLatencyMs", 1_000_000);
    expect(parseShowRunEvidence(slowRawCompletion).aggregate.acceptanceOutcome).toBe(
      "pass",
    );
  });

  it("requires passing records to contain measured threshold summaries", () => {
    for (const field of [
      "secondaryPresentLatencyMs",
      "primaryCompletionLatencyMs",
      "primaryInstantAckLatencyMs",
      "primaryInsertOverheadMs",
    ] as const) {
      const record = cloneRecord();
      record.aggregate[field] = latencySummary(0, null, null, null);
      expect(() => parseShowRunEvidence(record), field).toThrow();
    }
  });

  it("requires every passing reset hash to match the content poem hash", () => {
    const missing = cloneRecord() as unknown as {
      loops: Array<Partial<LoopEvidence>>;
    };
    delete missing.loops[0]!.resetBufferSha256;
    expect(() => parseShowRunEvidence(missing)).toThrow();

    const mismatch = cloneRecord();
    mismatch.loops[1]!.resetBufferSha256 = HASH_A;
    expect(() => parseShowRunEvidence(mismatch)).toThrow();

    mismatch.aggregate.acceptanceOutcome = "fail";
    expect(parseShowRunEvidence(mismatch).aggregate.acceptanceOutcome).toBe("fail");
  });

  it("requires complete successful shutdown, logging, resources, and offline proof for pass", () => {
    const mutations: Array<[string, (record: ShowRunEvidenceRecord) => void]> = [
      ["agent shutdown", (record) => { record.shutdown.agentShutdown = "timed-out"; }],
      ["HWND close", (record) => { record.shutdown.hwndClose = "failed"; }],
      ["JanVim exit", (record) => { record.shutdown.janvimExit = "forced"; }],
      ["bridge close", (record) => { record.shutdown.bridgeClose = "timed-out"; }],
      ["lease", (record) => { record.shutdown.leaseRemoved = false; }],
      ["fatal request", (record) => { record.shutdown.requestedBy = "fatal-fault"; }],
      ["logging", (record) => { record.loggingIncomplete = true; }],
      [
        "resources",
        (record) => { record.loops[0]!.resources.sampleIncomplete = true; },
      ],
    ];

    for (const [name, mutate] of mutations) {
      const record = cloneRecord();
      mutate(record);
      expect(() => parseShowRunEvidence(record), name).toThrow();
    }
  });

  it("rejects secrets and every protected source or user-config path in nested evidence", () => {
    const prohibited = [
      "sensitive-show-token-2026",
      "fixture-secret-token",
      "ab".repeat(24),
      `bridge diagnostic contained ${"cd".repeat(24)} before redaction`,
      "D:\\github\\JanVim",
      "D:\\github\\JanVim\\src\\main.rs",
      "C:\\Users\\operator\\AppData\\Local\\nvim\\init.lua",
      ...PROTECTED_PATHS,
      ...PROTECTED_PATHS.map((path) => `${path}\\child\\incident.json`),
    ];

    for (const value of prohibited) {
      const record = cloneRecord();
      record.operatorNotes = [value];
      expect(() => parseShowRunEvidence(record), value).toThrow();
    }

    const nestedReason = cloneRecord();
    nestedReason.recoveries[0]!.reason =
      "failure at C:\\Users\\operator\\AppData\\Local\\nvim\\lua\\init.lua";
    expect(() => parseShowRunEvidence(nestedReason)).toThrow();

    const productPrefixNearMatch = cloneRecord();
    productPrefixNearMatch.operatorNotes = [
      "Evidence writer lives in D:\\github\\JanVim-Exhibition-2026.",
    ];
    expect(parseShowRunEvidence(productPrefixNearMatch).operatorNotes).toEqual(
      productPrefixNearMatch.operatorNotes,
    );
  });
});

describe("atomic show-run evidence writer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes canonical pretty JSON through one exclusive same-directory temp, flush, close, and rename", async () => {
    const root = mkdtempSync(join(tmpdir(), "show-run-evidence-"));
    try {
      const path = join(root, "show-run-001.json");
      const record = validEvidenceRecord();
      const input = reverseObjectKeys(record);
      const openSpy = vi.spyOn(fs, "openSync");
      const fsyncSpy = vi.spyOn(fs, "fsyncSync");
      const closeSpy = vi.spyOn(fs, "closeSync");
      const renameSpy = vi.spyOn(fs, "renameSync");

      await writeShowRunEvidenceAtomic(path, input);

      expect(openSpy).toHaveBeenCalledTimes(1);
      const [temporaryPath, flags, mode] = openSpy.mock.calls[0]!;
      expect(typeof temporaryPath).toBe("string");
      expect(dirname(String(temporaryPath))).toBe(root);
      expect(basename(String(temporaryPath))).toMatch(
        /^\.show-run-evidence-\d+-[0-9a-f-]{36}\.tmp$/,
      );
      expect(flags).toBe("wx");
      expect(mode).toBe(0o600);
      expect(fsyncSpy).toHaveBeenCalledTimes(1);
      expect(closeSpy).toHaveBeenCalledTimes(1);
      expect(renameSpy).toHaveBeenCalledTimes(1);
      expect(renameSpy).toHaveBeenCalledWith(temporaryPath, path);
      expect(fsyncSpy.mock.invocationCallOrder[0]!).toBeLessThan(
        closeSpy.mock.invocationCallOrder[0]!,
      );
      expect(closeSpy.mock.invocationCallOrder[0]!).toBeLessThan(
        renameSpy.mock.invocationCallOrder[0]!,
      );
      expect(readFileSync(path, "utf8")).toBe(
        `${JSON.stringify(record, null, 2)}\n`,
      );
      expect(readdirSync(root)).toEqual(["show-run-001.json"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("validates before opening and leaves unrelated temp files untouched", async () => {
    const root = mkdtempSync(join(tmpdir(), "show-run-evidence-invalid-"));
    try {
      const path = join(root, "invalid.json");
      const decoy = join(root, ".show-run-evidence-decoy.tmp");
      writeFileSync(decoy, "decoy", "utf8");
      const invalid = cloneRecord();
      invalid.operatorNotes = ["界".repeat(1_365) + "ab"];
      const openSpy = vi.spyOn(fs, "openSync");

      await expect(writeShowRunEvidenceAtomic(path, invalid)).rejects.toThrow();

      expect(openSpy).not.toHaveBeenCalled();
      expect(existsSync(path)).toBe(false);
      expect(readFileSync(decoy, "utf8")).toBe("decoy");
      expect(readdirSync(root)).toEqual([".show-run-evidence-decoy.tmp"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses an existing destination without opening or changing either file", async () => {
    const root = mkdtempSync(join(tmpdir(), "show-run-evidence-existing-"));
    try {
      const path = join(root, "show-run-001.json");
      const decoy = join(root, ".show-run-evidence-decoy.tmp");
      writeFileSync(path, "sentinel", "utf8");
      writeFileSync(decoy, "decoy", "utf8");
      const openSpy = vi.spyOn(fs, "openSync");
      const renameSpy = vi.spyOn(fs, "renameSync");

      await expect(
        writeShowRunEvidenceAtomic(path, validEvidenceRecord()),
      ).rejects.toThrow(/already-exists/i);

      expect(openSpy).not.toHaveBeenCalled();
      expect(renameSpy).not.toHaveBeenCalled();
      expect(readFileSync(path, "utf8")).toBe("sentinel");
      expect(readFileSync(decoy, "utf8")).toBe("decoy");
      expect(readdirSync(root).sort()).toEqual([
        ".show-run-evidence-decoy.tmp",
        "show-run-001.json",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("removes only its exact temp and preserves a raced destination when rename fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "show-run-evidence-rename-"));
    try {
      const path = join(root, "show-run-001.json");
      const decoy = join(root, ".show-run-evidence-decoy.tmp");
      writeFileSync(decoy, "decoy", "utf8");
      let writerTemporaryPath = "";
      const renameSpy = vi
        .spyOn(fs, "renameSync")
        .mockImplementation((source, destination) => {
          writerTemporaryPath = String(source);
          writeFileSync(destination, "raced-destination", "utf8");
          throw new Error("fixture-rename-failure");
        });

      await expect(
        writeShowRunEvidenceAtomic(path, validEvidenceRecord()),
      ).rejects.toThrow(/fixture-rename-failure/);

      expect(renameSpy).toHaveBeenCalledTimes(1);
      expect(writerTemporaryPath).not.toBe("");
      expect(existsSync(writerTemporaryPath)).toBe(false);
      expect(readFileSync(path, "utf8")).toBe("raced-destination");
      expect(readFileSync(decoy, "utf8")).toBe("decoy");
      expect(readdirSync(root).sort()).toEqual([
        ".show-run-evidence-decoy.tmp",
        "show-run-001.json",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
