import { win32 } from "node:path";

import type { Rectangle } from "./display-router";

export interface PlacementTarget {
  pid: number;
  bounds: Rectangle;
}

export interface WindowPlacementReceipt {
  schema: 1;
  pid: number;
  matchedWindowCount: number;
  hwnd: string;
  visible: boolean;
  owned: boolean;
  requested: Rectangle;
  actual: Rectangle;
}

export interface WindowPlacementInvocation {
  file: "pwsh";
  args: string[];
}

export type WindowPlacementValidation = { ok: true } | { ok: false; reason: string };

export interface WindowPlacementHelperResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface WindowPlacementRunLimits {
  timeoutMs: 12_000;
  maxOutputBytes: 4_096;
}

export type RunWindowPlacementHelper = (
  invocation: WindowPlacementInvocation,
  limits: WindowPlacementRunLimits,
) => Promise<WindowPlacementHelperResult>;

const MAX_RECEIPT_BYTES = 4_096;
const HELPER_PROCESS_TIMEOUT_MS = 12_000;

export function createWindowPlacementInvocation(input: {
  helperPath: string;
  target: PlacementTarget;
}): WindowPlacementInvocation {
  if (!Number.isSafeInteger(input.target.pid) || input.target.pid <= 0) {
    throw new Error("Child PID must be a positive integer");
  }
  if (!isRectangle(input.target.bounds)) {
    throw new Error("Target rectangle is invalid");
  }
  if (!win32.isAbsolute(input.helperPath) || win32.basename(input.helperPath).toLowerCase() !== "place-janvim-window.ps1") {
    throw new Error("Window placement helper path is invalid");
  }

  const bounds = input.target.bounds;
  return {
    file: "pwsh",
    args: [
      "-NoProfile",
      "-File",
      input.helperPath,
      "-ChildProcessId",
      String(input.target.pid),
      "-X",
      String(bounds.x),
      "-Y",
      String(bounds.y),
      "-Width",
      String(bounds.width),
      "-Height",
      String(bounds.height),
      "-TimeoutMs",
      "10000",
    ],
  };
}

export function validateWindowPlacementReceipt(
  receipt: unknown,
  target: PlacementTarget,
): WindowPlacementValidation {
  if (!isWindowPlacementReceipt(receipt)) {
    return { ok: false, reason: "receipt-invalid" };
  }
  if (receipt.schema !== 1 || receipt.pid !== target.pid) {
    return { ok: false, reason: "pid-mismatch" };
  }
  if (receipt.matchedWindowCount !== 1) {
    return { ok: false, reason: "window-count-mismatch" };
  }
  if (!receipt.visible || receipt.owned || receipt.hwnd.length === 0) {
    return { ok: false, reason: "window-not-eligible" };
  }
  if (!rectanglesEqual(receipt.requested, target.bounds)) {
    return { ok: false, reason: "requested-rectangle-mismatch" };
  }
  if (!isRectangle(receipt.actual) || !withinTolerance(receipt.actual, target.bounds, 2)) {
    return { ok: false, reason: "window-rectangle-mismatch" };
  }
  return { ok: true };
}

export async function placeJanVimWindow(input: {
  helperPath: string;
  target: PlacementTarget;
  runHelper: RunWindowPlacementHelper;
}): Promise<WindowPlacementValidation> {
  const invocation = createWindowPlacementInvocation(input);
  let result: WindowPlacementHelperResult;
  try {
    result = await input.runHelper(invocation, {
      timeoutMs: HELPER_PROCESS_TIMEOUT_MS,
      maxOutputBytes: MAX_RECEIPT_BYTES,
    });
  } catch {
    return { ok: false, reason: "window-helper-execution-failed" };
  }

  if (Buffer.byteLength(result.stderr, "utf8") > MAX_RECEIPT_BYTES) {
    return { ok: false, reason: "window-helper-output-too-large" };
  }
  if (result.exitCode !== 0) {
    return { ok: false, reason: "window-helper-failed" };
  }
  if (Buffer.byteLength(result.stdout, "utf8") > MAX_RECEIPT_BYTES) {
    return { ok: false, reason: "receipt-too-large" };
  }

  let receipt: unknown;
  try {
    receipt = JSON.parse(result.stdout);
  } catch {
    return { ok: false, reason: "receipt-invalid" };
  }
  return validateWindowPlacementReceipt(receipt, input.target);
}

function withinTolerance(actual: Rectangle, expected: Rectangle, tolerance: number): boolean {
  const actualRight = actual.x + actual.width;
  const actualBottom = actual.y + actual.height;
  const expectedRight = expected.x + expected.width;
  const expectedBottom = expected.y + expected.height;
  return (
    Math.abs(actual.x - expected.x) <= tolerance &&
    Math.abs(actual.y - expected.y) <= tolerance &&
    Math.abs(actualRight - expectedRight) <= tolerance &&
    Math.abs(actualBottom - expectedBottom) <= tolerance
  );
}

function rectanglesEqual(left: Rectangle, right: Rectangle): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function isRectangle(value: unknown): value is Rectangle {
  return (
    value !== null &&
    typeof value === "object" &&
    "x" in value &&
    "y" in value &&
    "width" in value &&
    "height" in value &&
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    typeof value.width === "number" &&
    typeof value.height === "number" &&
    Number.isSafeInteger(value.x) &&
    Number.isSafeInteger(value.y) &&
    Number.isSafeInteger(value.width) &&
    Number.isSafeInteger(value.height) &&
    value.width > 0 &&
    value.height > 0
  );
}

function isWindowPlacementReceipt(value: unknown): value is WindowPlacementReceipt {
  if (value === null || typeof value !== "object") return false;
  if (!("schema" in value) || !("pid" in value) || !("matchedWindowCount" in value)) {
    return false;
  }
  if (!("hwnd" in value) || !("visible" in value) || !("owned" in value)) return false;
  if (!("requested" in value) || !("actual" in value)) return false;

  return (
    value.schema === 1 &&
    Number.isSafeInteger(value.pid) &&
    typeof value.pid === "number" &&
    value.pid > 0 &&
    Number.isSafeInteger(value.matchedWindowCount) &&
    typeof value.matchedWindowCount === "number" &&
    value.matchedWindowCount >= 0 &&
    typeof value.hwnd === "string" &&
    typeof value.visible === "boolean" &&
    typeof value.owned === "boolean" &&
    isRectangle(value.requested) &&
    isRectangle(value.actual)
  );
}
