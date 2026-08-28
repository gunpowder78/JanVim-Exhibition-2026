import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { z } from "zod";

import {
  hashDisplayGeometry,
  type DisplayMapRole,
  type Rectangle,
} from "./display-router.js";

export const CHILD_STREAM_LIMIT_BYTES = 8 * 1024 * 1024;
export const CHILD_TAIL_BYTES = 8 * 1024;

export interface JanVimShutdownSummary {
  processExitCode: number | null;
  stdoutTail: string;
  stderrBytes: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export interface G2ShutdownEvidence {
  processExitCode: number | null;
  natural: boolean;
  reason: string;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export interface G2EvidenceRecord {
  schema: 1;
  runId: string;
  outcome: "passed" | "failed";
  failureReason: string | null;
  acceptanceScope: "two-real-monitors-projector-simulation";
  physicalProjectorsTested: false;
  displayMap: {
    path: string;
    sha256: string;
    primary: DisplayMapRole;
    secondary: DisplayMapRole;
  };
  artifact: {
    tag: string;
    commit: string;
    archiveBytes: number;
    archiveSha256: string;
    coreBytes: number;
    coreSha256: string;
    configSha256: string;
    layoutEngine: "dynamic" | "orthogonal";
  };
  content: {
    manifestSha256: string;
    poemSha256: string;
    contentRevision: string;
  };
  placement: {
    pid: number;
    requested: Rectangle;
    actual: Rectangle;
    matchedWindowCount: 1;
  } | null;
  loop: {
    requestedLoops: 1;
    completedLoops: 0 | 1;
    durationMs: number;
    maxDriftMs: number;
    resetRestoredPoem: boolean;
  };
  shutdown: G2ShutdownEvidence | null;
  operatorNotes: string[];
}

export type ChildOutputSink = (chunk: Uint8Array) => void;

export class BoundedChildOutput {
  private tailBytes = Buffer.alloc(0);
  public bytesObserved = 0;
  public bytesWritten = 0;
  public truncated = false;

  public constructor(
    private readonly maxBytes: number = CHILD_STREAM_LIMIT_BYTES,
    private readonly maxTailBytes: number = CHILD_TAIL_BYTES,
    private readonly sink: ChildOutputSink = () => undefined,
  ) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new Error("Child output limit must be a positive safe integer");
    }
    if (!Number.isSafeInteger(maxTailBytes) || maxTailBytes <= 0) {
      throw new Error("Child output tail limit must be a positive safe integer");
    }
  }

  public append(value: Uint8Array): void {
    const chunk = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    this.bytesObserved += chunk.byteLength;
    this.retainTail(chunk);

    const remaining = Math.max(0, this.maxBytes - this.bytesWritten);
    const writableBytes = Math.min(remaining, chunk.byteLength);
    if (writableBytes > 0) {
      const writable = chunk.subarray(0, writableBytes);
      this.sink(writable);
      this.bytesWritten += writable.byteLength;
    }
    if (writableBytes < chunk.byteLength) this.truncated = true;
  }

  public get tail(): string {
    let decoded = this.tailBytes.toString("utf8");
    while (Buffer.byteLength(decoded, "utf8") > this.maxTailBytes) {
      decoded = decoded.slice(1);
    }
    return decoded;
  }

  private retainTail(chunk: Buffer): void {
    if (chunk.byteLength >= this.maxTailBytes) {
      this.tailBytes = Buffer.from(chunk.subarray(chunk.byteLength - this.maxTailBytes));
      return;
    }
    const combined = Buffer.concat([this.tailBytes, chunk]);
    this.tailBytes =
      combined.byteLength <= this.maxTailBytes
        ? combined
        : Buffer.from(combined.subarray(combined.byteLength - this.maxTailBytes));
  }
}

export function classifyJanVimShutdown(
  summary: JanVimShutdownSummary,
): { natural: boolean; reason: string } {
  const natural =
    summary.processExitCode === 0 &&
    summary.stderrBytes === 0 &&
    !summary.stdoutTruncated &&
    !summary.stderrTruncated &&
    /\bwindow_exit_reason=CloseRequested\b/.test(summary.stdoutTail) &&
    /\bneovim_exit_class=frontend_shutdown_graceful\b/.test(summary.stdoutTail) &&
    /\bneovim_raw_status=code:0\b/.test(summary.stdoutTail);
  return natural
    ? { natural: true, reason: "frontend-shutdown-graceful" }
    : { natural: false, reason: "janvim-shutdown-summary-invalid" };
}

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const stableReasonSchema = z.string().regex(/^[a-z0-9-]{1,64}$/);
const rectangleSchema = z
  .object({
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();
const displayRoleSchema = z
  .object({
    displayId: z.string().min(1),
    bounds: rectangleSchema,
    scaleFactor: z.number().positive().finite(),
    geometrySha256: hashSchema,
  })
  .strict()
  .superRefine((role, context) => {
    if (hashDisplayGeometry(role) !== role.geometrySha256) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["geometrySha256"],
        message: "display geometry hash mismatch",
      });
    }
  });
const displayMapEvidenceSchema = z
  .object({
    path: z.string().min(1),
    sha256: hashSchema,
    primary: displayRoleSchema,
    secondary: displayRoleSchema,
  })
  .strict()
  .refine((map) => map.primary.displayId !== map.secondary.displayId, {
    message: "evidence display IDs must be distinct",
  });
const artifactEvidenceSchema = z
  .object({
    tag: z.string().min(1).max(128),
    commit: z.string().regex(/^[0-9a-f]{40}$/),
    archiveBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    archiveSha256: hashSchema,
    coreBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    coreSha256: hashSchema,
    configSha256: hashSchema,
    layoutEngine: z.enum(["dynamic", "orthogonal"]),
  })
  .strict();
const contentEvidenceSchema = z
  .object({
    manifestSha256: hashSchema,
    poemSha256: hashSchema,
    contentRevision: z.string().min(1).max(128),
  })
  .strict();
const placementEvidenceSchema = z
  .object({
    pid: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    requested: rectangleSchema,
    actual: rectangleSchema,
    matchedWindowCount: z.literal(1),
  })
  .strict();
const loopEvidenceSchema = z
  .object({
    requestedLoops: z.literal(1),
    completedLoops: z.union([z.literal(0), z.literal(1)]),
    durationMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    maxDriftMs: z.number().nonnegative().finite(),
    resetRestoredPoem: z.boolean(),
  })
  .strict();
const shutdownEvidenceSchema = z
  .object({
    processExitCode: z.number().int().nonnegative().nullable(),
    natural: z.boolean(),
    reason: stableReasonSchema,
    stdoutBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    stderrBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    stdoutTruncated: z.boolean(),
    stderrTruncated: z.boolean(),
  })
  .strict();
const operatorNoteSchema = z.string().refine(
  (value) => Buffer.byteLength(value, "utf8") <= 512,
  "operator note must be at most 512 UTF-8 bytes",
);
const rectanglesEqual = (left: Rectangle, right: Rectangle): boolean =>
  left.x === right.x &&
  left.y === right.y &&
  left.width === right.width &&
  left.height === right.height;
const g2EvidenceSchema = z
  .object({
    schema: z.literal(1),
    runId: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
    outcome: z.enum(["passed", "failed"]),
    failureReason: stableReasonSchema.nullable(),
    acceptanceScope: z.literal("two-real-monitors-projector-simulation"),
    physicalProjectorsTested: z.literal(false),
    displayMap: displayMapEvidenceSchema,
    artifact: artifactEvidenceSchema,
    content: contentEvidenceSchema,
    placement: placementEvidenceSchema.nullable(),
    loop: loopEvidenceSchema,
    shutdown: shutdownEvidenceSchema.nullable(),
    operatorNotes: z.array(operatorNoteSchema).max(32),
  })
  .strict()
  .superRefine((record, context) => {
    if (record.outcome === "failed" && record.failureReason === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["failureReason"],
        message: "failed evidence requires a failure reason",
      });
    }
    if (record.outcome !== "passed") return;
    if (record.failureReason !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["failureReason"],
        message: "passed evidence cannot have a failure reason",
      });
    }
    if (record.placement === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["placement"],
        message: "passed evidence requires placement",
      });
    } else {
      if (!rectanglesEqual(record.placement.requested, record.displayMap.primary.bounds)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["placement", "requested"],
          message: "passed evidence requested placement must match the primary display",
        });
      }
      if (!rectanglesEqual(record.placement.actual, record.displayMap.primary.bounds)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["placement", "actual"],
          message: "passed evidence actual placement must match the primary display",
        });
      }
    }
    if (record.loop.completedLoops !== 1 || !record.loop.resetRestoredPoem) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["loop"],
        message: "passed evidence requires one restored loop",
      });
    }
    if (
      record.shutdown === null ||
      !record.shutdown.natural ||
      record.shutdown.reason !== "frontend-shutdown-graceful" ||
      record.shutdown.processExitCode !== 0 ||
      record.shutdown.stderrBytes !== 0 ||
      record.shutdown.stdoutTruncated ||
      record.shutdown.stderrTruncated
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["shutdown"],
        message: "passed evidence requires the exact natural shutdown invariants",
      });
    }
  });

export function writeG2Evidence(path: string, value: unknown): void {
  const record = g2EvidenceSchema.parse(value) as G2EvidenceRecord;
  if (existsSync(path)) throw new Error("g2-evidence-already-exists");
  const temporaryPath = join(
    dirname(path),
    `.g2-evidence-${process.pid}-${randomUUID()}.tmp`,
  );
  let descriptor: number | undefined;
  let ownsTemporary = false;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    ownsTemporary = true;
    writeFileSync(descriptor, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    if (existsSync(path)) throw new Error("g2-evidence-already-exists");
    renameSync(temporaryPath, path);
    ownsTemporary = false;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (ownsTemporary) rmSync(temporaryPath, { force: true });
  }
}
