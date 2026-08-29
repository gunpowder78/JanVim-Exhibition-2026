import { win32 } from "node:path";

import type { WindowPlacementReceipt } from "./window-placer";

export type WindowCloseReceipt = {
  schema: 1;
  pid: number;
  hwnd: string;
  ownershipVerified: true;
  topLevel: true;
  closePosted: true;
};

export interface WindowCloseInvocation {
  file: "pwsh";
  args: string[];
}

export interface WindowCloseHelperResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface WindowCloseRunLimits {
  timeoutMs: 2_000;
  maxOutputBytes: 4_096;
}

export type RunWindowCloseHelper = (
  invocation: WindowCloseInvocation,
  limits: WindowCloseRunLimits,
) => Promise<WindowCloseHelperResult>;

const HELPER_PROCESS_TIMEOUT_MS = 2_000;
const MAX_OUTPUT_BYTES = 4_096;
const RECEIPT_KEYS = [
  "closePosted",
  "hwnd",
  "ownershipVerified",
  "pid",
  "schema",
  "topLevel",
] as const;

export async function closePlacedJanVimWindow(input: {
  placement: WindowPlacementReceipt;
  helperPath: string;
  runHelper: RunWindowCloseHelper;
}): Promise<WindowCloseReceipt> {
  if (
    !win32.isAbsolute(input.helperPath) ||
    win32.basename(input.helperPath).toLowerCase() !== "close-janvim-window.ps1"
  ) {
    throw new Error("Window close helper path is invalid");
  }

  const invocation: WindowCloseInvocation = {
    file: "pwsh",
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      input.helperPath,
      "-ChildProcessId",
      String(input.placement.pid),
      "-Hwnd",
      input.placement.hwnd,
    ],
  };
  const result = await input.runHelper(invocation, {
    timeoutMs: HELPER_PROCESS_TIMEOUT_MS,
    maxOutputBytes: MAX_OUTPUT_BYTES,
  });

  if (
    Buffer.byteLength(result.stdout, "utf8") > MAX_OUTPUT_BYTES ||
    Buffer.byteLength(result.stderr, "utf8") > MAX_OUTPUT_BYTES
  ) {
    throw new Error("Window close helper output exceeded its limit");
  }
  if (result.exitCode !== 0) {
    throw new Error("Window close helper failed");
  }

  const parsed = parseSingleJsonLine(result.stdout);
  if (!isExactWindowCloseReceipt(parsed, input.placement)) {
    throw new Error("Window close receipt is invalid");
  }
  return parsed;
}

function parseSingleJsonLine(stdout: string): unknown {
  let line = stdout;
  if (line.endsWith("\r\n")) {
    line = line.slice(0, -2);
  } else if (line.endsWith("\n")) {
    line = line.slice(0, -1);
  }

  if (line.length === 0 || line.trim() !== line || line.includes("\r") || line.includes("\n")) {
    throw new Error("Window close receipt must be exactly one JSON line");
  }
  return JSON.parse(line) as unknown;
}

function isExactWindowCloseReceipt(
  value: unknown,
  placement: WindowPlacementReceipt,
): value is WindowCloseReceipt {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;

  const keys = Object.keys(value).sort();
  if (keys.length !== RECEIPT_KEYS.length) return false;
  if (keys.some((key, index) => key !== RECEIPT_KEYS[index])) return false;

  const receipt = value as Record<string, unknown>;
  return (
    receipt.schema === 1 &&
    Number.isSafeInteger(receipt.pid) &&
    receipt.pid === placement.pid &&
    receipt.hwnd === placement.hwnd &&
    receipt.ownershipVerified === true &&
    receipt.topLevel === true &&
    receipt.closePosted === true
  );
}
