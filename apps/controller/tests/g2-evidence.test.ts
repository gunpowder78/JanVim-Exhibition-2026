import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  BoundedChildOutput,
  CHILD_STREAM_LIMIT_BYTES,
  CHILD_TAIL_BYTES,
  classifyJanVimShutdown,
  writeG2Evidence,
  type G2EvidenceRecord,
} from "../src/g2-evidence.ts";

function validEvidenceRecord(
  overrides: Partial<G2EvidenceRecord> = {},
): G2EvidenceRecord {
  return {
    schema: 1,
    runId: "g2-run-001",
    outcome: "passed",
    failureReason: null,
    acceptanceScope: "two-real-monitors-projector-simulation",
    physicalProjectorsTested: false,
    displayMap: {
      path: "D:\\rehearsal\\display-map.json",
      sha256: "a".repeat(64),
      primary: {
        displayId: "111",
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        scaleFactor: 1,
        geometrySha256:
          "b2bc82d7bea454184acfb21ae9139e97c32aefb994443034423653e85f9c83cc",
      },
      secondary: {
        displayId: "222",
        bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
        scaleFactor: 1,
        geometrySha256:
          "2ebac5faac6c5f34562d1e91088736c9e70943c9c42846616a418db904319928",
      },
    },
    artifact: {
      tag: "v0.10.1-gmk.4.punctuation.2",
      commit: "abbd5a5b942b202e7fe4324bcd3ddab47c672cb9",
      archiveBytes: 100_000_000,
      archiveSha256: "b".repeat(64),
      coreBytes: 18_869_248,
      coreSha256: "c".repeat(64),
      configSha256: "d".repeat(64),
      layoutEngine: "dynamic",
    },
    content: {
      manifestSha256: "9a39ee522e556860053468854b0858bc1fafd8b7a1ca08ddff57d0371b717b35",
      poemSha256: "b699de273f5bbaedb08241495f52ce863d3e8e1851275ce3b6251484d75190a8",
      contentRevision: "20260828-0002",
    },
    placement: {
      pid: 5150,
      requested: { x: 0, y: 0, width: 1920, height: 1080 },
      actual: { x: 0, y: 0, width: 1920, height: 1080 },
      matchedWindowCount: 1,
    },
    loop: {
      requestedLoops: 1,
      completedLoops: 1,
      durationMs: 90_000,
      maxDriftMs: 12,
      resetRestoredPoem: true,
    },
    shutdown: {
      processExitCode: 0,
      natural: true,
      reason: "frontend-shutdown-graceful",
      stdoutBytes: 4096,
      stderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
    },
    operatorNotes: ["Two real monitors; projectors not available."],
    ...overrides,
  };
}

describe("G2 child output and shutdown evidence", () => {
  it("accepts only the natural CloseRequested zero-status summary", () => {
    expect(
      classifyJanVimShutdown({
        processExitCode: 0,
        stdoutTail:
          "surface-ready window_exit_reason=CloseRequested " +
          "neovim_exit_class=frontend_shutdown_graceful neovim_raw_status=code:0",
        stderrBytes: 0,
        stdoutTruncated: false,
        stderrTruncated: false,
      }),
    ).toEqual({ natural: true, reason: "frontend-shutdown-graceful" });

    for (const summary of [
      {
        processExitCode: 0,
        stdoutTail: "window_exit_reason=BackendStopped neovim_raw_status=code:0",
        stderrBytes: 0,
        stdoutTruncated: false,
        stderrTruncated: false,
      },
      {
        processExitCode: 1,
        stdoutTail:
          "window_exit_reason=CloseRequested " +
          "neovim_exit_class=frontend_shutdown_graceful neovim_raw_status=code:0",
        stderrBytes: 0,
        stdoutTruncated: false,
        stderrTruncated: false,
      },
      {
        processExitCode: 0,
        stdoutTail:
          "window_exit_reason=CloseRequested " +
          "neovim_exit_class=frontend_shutdown_graceful neovim_raw_status=code:0",
        stderrBytes: 1,
        stdoutTruncated: false,
        stderrTruncated: false,
      },
    ]) {
      expect(classifyJanVimShutdown(summary)).toEqual({
        natural: false,
        reason: "janvim-shutdown-summary-invalid",
      });
    }
  });

  it("caps each child stream at eight MiB and keeps a bounded observed tail", () => {
    expect(CHILD_STREAM_LIMIT_BYTES).toBe(8 * 1024 * 1024);
    expect(CHILD_TAIL_BYTES).toBe(8 * 1024);
    const written: Buffer[] = [];
    const sink = vi.fn((chunk: Uint8Array) => written.push(Buffer.from(chunk)));
    const capture = new BoundedChildOutput(
      CHILD_STREAM_LIMIT_BYTES,
      CHILD_TAIL_BYTES,
      sink,
    );
    capture.append(Buffer.alloc(CHILD_STREAM_LIMIT_BYTES + 1, 0x61));
    capture.append(Buffer.from("XYZ", "utf8"));

    expect(capture.bytesObserved).toBe(CHILD_STREAM_LIMIT_BYTES + 4);
    expect(capture.bytesWritten).toBe(CHILD_STREAM_LIMIT_BYTES);
    expect(capture.truncated).toBe(true);
    expect(Buffer.concat(written)).toHaveLength(CHILD_STREAM_LIMIT_BYTES);
    expect(capture.tail.endsWith("XYZ")).toBe(true);
    expect(Buffer.byteLength(capture.tail, "utf8")).toBeLessThanOrEqual(CHILD_TAIL_BYTES);
  });
});

describe("G2 evidence writer", () => {
  it("atomically writes a complete token-free monitor rehearsal record", () => {
    const root = mkdtempSync(join(tmpdir(), "g2-evidence-"));
    try {
      const path = join(root, "g2-run-001.json");
      const record = validEvidenceRecord({
        runId: "g2-run-001",
        loop: {
          requestedLoops: 1,
          completedLoops: 1,
          durationMs: 90_000,
          maxDriftMs: 12,
          resetRestoredPoem: true,
        },
      });
      writeG2Evidence(path, record);
      expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(record);
      expect(readFileSync(path, "utf8")).not.toContain("fixture-secret-token");
      expect(
        readdirSync(root).filter((name) => name.startsWith(".g2-evidence-")),
      ).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects unknown token material and impossible passed records before writing", () => {
    const root = mkdtempSync(join(tmpdir(), "g2-evidence-invalid-"));
    try {
      const withToken = {
        ...validEvidenceRecord(),
        token: "fixture-secret-token",
      };
      expect(() => writeG2Evidence(join(root, "token.json"), withToken)).toThrow();
      const withoutPlacement = validEvidenceRecord({
        outcome: "passed",
        failureReason: null,
        placement: null,
      });
      expect(() =>
        writeG2Evidence(join(root, "missing-placement.json"), withoutPlacement),
      ).toThrow();
      const { content: _content, ...withoutContentIdentity } = validEvidenceRecord();
      expect(() =>
        writeG2Evidence(join(root, "missing-content-identity.json"), withoutContentIdentity),
      ).toThrow();
      for (const [name, impossible] of [
        ["missing-shutdown", validEvidenceRecord({ shutdown: null })],
        [
          "missing-reset",
          validEvidenceRecord({
            loop: {
              requestedLoops: 1,
              completedLoops: 0,
              durationMs: 90_000,
              maxDriftMs: 0,
              resetRestoredPoem: false,
            },
          }),
        ],
      ] as const) {
        expect(() =>
          writeG2Evidence(join(root, `${name}.json`), impossible),
        ).toThrow();
      }
      const nestedUnknown = validEvidenceRecord({
        artifact: {
          ...validEvidenceRecord().artifact,
          token: "fixture-secret-token",
        } as G2EvidenceRecord["artifact"],
      });
      expect(() =>
        writeG2Evidence(join(root, "nested-token.json"), nestedUnknown),
      ).toThrow();
      const oversizedNote = validEvidenceRecord({ operatorNotes: ["界".repeat(171)] });
      expect(() => writeG2Evidence(join(root, "note.json"), oversizedNote)).toThrow();
      expect(readdirSync(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects passed evidence that contradicts primary placement or natural shutdown", () => {
    const root = mkdtempSync(join(tmpdir(), "g2-evidence-cross-field-"));
    try {
      const valid = validEvidenceRecord();
      const impossibleRecords: Array<[string, G2EvidenceRecord]> = [
        [
          "wrong-requested-placement",
          validEvidenceRecord({
            placement: {
              ...valid.placement!,
              requested: { x: 1, y: 0, width: 1920, height: 1080 },
            },
          }),
        ],
        [
          "wrong-actual-placement",
          validEvidenceRecord({
            placement: {
              ...valid.placement!,
              actual: { x: 0, y: 1, width: 1920, height: 1080 },
            },
          }),
        ],
        [
          "nonzero-exit",
          validEvidenceRecord({ shutdown: { ...valid.shutdown!, processExitCode: 1 } }),
        ],
        [
          "wrong-natural-reason",
          validEvidenceRecord({ shutdown: { ...valid.shutdown!, reason: "other-natural-exit" } }),
        ],
        [
          "stderr-observed",
          validEvidenceRecord({ shutdown: { ...valid.shutdown!, stderrBytes: 1 } }),
        ],
        [
          "stdout-truncated",
          validEvidenceRecord({ shutdown: { ...valid.shutdown!, stdoutTruncated: true } }),
        ],
        [
          "stderr-truncated",
          validEvidenceRecord({ shutdown: { ...valid.shutdown!, stderrTruncated: true } }),
        ],
      ];

      for (const [name, record] of impossibleRecords) {
        expect(() => writeG2Evidence(join(root, `${name}.json`), record)).toThrow();
      }
      expect(readdirSync(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("never overwrites an existing run record", () => {
    const root = mkdtempSync(join(tmpdir(), "g2-evidence-existing-"));
    try {
      const path = join(root, "g2-run-001.json");
      writeFileSync(path, "sentinel", "utf8");
      expect(() => writeG2Evidence(path, validEvidenceRecord())).toThrow(/already-exists/i);
      expect(readFileSync(path, "utf8")).toBe("sentinel");
      expect(readdirSync(root)).toEqual(["g2-run-001.json"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
