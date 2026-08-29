import { describe, expect, it } from "vitest";

import {
  closePlacedJanVimWindow,
  type RunWindowCloseHelper,
  type WindowCloseHelperResult,
  type WindowCloseInvocation,
  type WindowCloseReceipt,
  type WindowCloseRunLimits,
} from "../src/window-closer.ts";
import type { WindowPlacementReceipt } from "../src/window-placer.ts";

const helperPath = "D:\\show\\scripts\\close-janvim-window.ps1";

const placement: WindowPlacementReceipt = {
  schema: 1,
  pid: 4242,
  matchedWindowCount: 1,
  hwnd: "0x000000000000ABcd",
  visible: true,
  owned: false,
  requested: { x: 0, y: 0, width: 1920, height: 1080 },
  actual: { x: 0, y: 0, width: 1920, height: 1080 },
};

function receipt(): WindowCloseReceipt {
  return {
    schema: 1,
    pid: placement.pid,
    hwnd: placement.hwnd,
    ownershipVerified: true,
    topLevel: true,
    closePosted: true,
  };
}

function helperResult(
  stdout: string,
  overrides: Partial<WindowCloseHelperResult> = {},
): WindowCloseHelperResult {
  return {
    exitCode: 0,
    stdout,
    stderr: "",
    ...overrides,
  };
}

function runReturning(result: WindowCloseHelperResult): RunWindowCloseHelper {
  return async () => result;
}

describe("exact JanVim HWND close adapter", () => {
  it("invokes only the exact close helper with the retained PID and byte-identical HWND", async () => {
    const calls: Array<{
      invocation: WindowCloseInvocation;
      limits: WindowCloseRunLimits;
    }> = [];
    const expectedReceipt = receipt();

    const actual = await closePlacedJanVimWindow({
      placement,
      helperPath,
      runHelper: async (invocation, limits) => {
        calls.push({ invocation, limits });
        return helperResult(`${JSON.stringify(expectedReceipt)}\r\n`);
      },
    });

    expect(actual).toEqual(expectedReceipt);
    expect(calls).toEqual([
      {
        invocation: {
          file: "pwsh",
          args: [
            "-NoProfile",
            "-NonInteractive",
            "-File",
            helperPath,
            "-ChildProcessId",
            "4242",
            "-Hwnd",
            "0x000000000000ABcd",
          ],
        },
        limits: { timeoutMs: 2_000, maxOutputBytes: 4_096 },
      },
    ]);
  });

  it.each([
    ["malformed JSON", "not-json"],
    ["an empty line", "\n"],
    ["a leading blank line", `\n${JSON.stringify(receipt())}\n`],
    [
      "more than one receipt line",
      `${JSON.stringify(receipt())}\n${JSON.stringify(receipt())}\n`,
    ],
  ])("rejects %s instead of accepting non-strict stdout", async (_case, stdout) => {
    await expect(
      closePlacedJanVimWindow({
        placement,
        helperPath,
        runHelper: runReturning(helperResult(stdout)),
      }),
    ).rejects.toThrow();
  });

  it.each([
    ["wrong schema", { ...receipt(), schema: 2 }],
    ["missing closePosted", {
      schema: 1,
      pid: placement.pid,
      hwnd: placement.hwnd,
      ownershipVerified: true,
      topLevel: true,
    }],
    ["an extra field", { ...receipt(), title: "JanVim" }],
    ["unverified ownership", { ...receipt(), ownershipVerified: false }],
    ["a non-top-level window", { ...receipt(), topLevel: false }],
    ["an unposted close", { ...receipt(), closePosted: false }],
  ])("rejects a receipt with %s", async (_case, invalidReceipt) => {
    await expect(
      closePlacedJanVimWindow({
        placement,
        helperPath,
        runHelper: runReturning(helperResult(JSON.stringify(invalidReceipt))),
      }),
    ).rejects.toThrow();
  });

  it.each([
    ["PID", { ...receipt(), pid: placement.pid + 1 }],
    ["HWND spelling", { ...receipt(), hwnd: "0x000000000000abcd" }],
    ["HWND padding", { ...receipt(), hwnd: "0x00000000000ABcd" }],
  ])("rejects an exact %s mismatch", async (_case, mismatchedReceipt) => {
    await expect(
      closePlacedJanVimWindow({
        placement,
        helperPath,
        runHelper: runReturning(helperResult(JSON.stringify(mismatchedReceipt))),
      }),
    ).rejects.toThrow();
  });

  it("rejects an executor timeout", async () => {
    await expect(
      closePlacedJanVimWindow({
        placement,
        helperPath,
        runHelper: async () => {
          throw new Error("executor-timeout");
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects a nonzero helper exit", async () => {
    await expect(
      closePlacedJanVimWindow({
        placement,
        helperPath,
        runHelper: runReturning(
          helperResult(JSON.stringify(receipt()), { exitCode: 1, stderr: "helper failed" }),
        ),
      }),
    ).rejects.toThrow();
  });

  it("rejects stdout overflow by UTF-8 byte length", async () => {
    const overflow = "\u00e9".repeat(2_049);

    await expect(
      closePlacedJanVimWindow({
        placement,
        helperPath,
        runHelper: runReturning(helperResult(overflow)),
      }),
    ).rejects.toThrow();
  });

  it("rejects stderr overflow by UTF-8 byte length", async () => {
    const overflow = "\u00e9".repeat(2_049);

    await expect(
      closePlacedJanVimWindow({
        placement,
        helperPath,
        runHelper: runReturning(
          helperResult(JSON.stringify(receipt()), { stderr: overflow }),
        ),
      }),
    ).rejects.toThrow();
  });

  it("rejects non-exact helper paths before execution", async () => {
    let callCount = 0;
    const runHelper: RunWindowCloseHelper = async () => {
      callCount += 1;
      return helperResult(JSON.stringify(receipt()));
    };

    await expect(
      closePlacedJanVimWindow({
        placement,
        helperPath: "scripts\\close-janvim-window.ps1",
        runHelper,
      }),
    ).rejects.toThrow();
    await expect(
      closePlacedJanVimWindow({
        placement,
        helperPath: "D:\\show\\scripts\\place-janvim-window.ps1",
        runHelper,
      }),
    ).rejects.toThrow();
    expect(callCount).toBe(0);
  });

  it("never retries with a title, process name, keystroke, coordinate, or window search", async () => {
    const invocations: WindowCloseInvocation[] = [];

    await expect(
      closePlacedJanVimWindow({
        placement,
        helperPath,
        runHelper: async (invocation) => {
          invocations.push(invocation);
          return helperResult("", { exitCode: 1 });
        },
      }),
    ).rejects.toThrow();

    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.args.join(" ")).not.toMatch(
      /MainWindowTitle|WindowTitle|ProcessName|SendKeys|AppActivate|keystroke|coordinate|EnumWindows|(?:^|\s)-[XY](?:\s|$)/i,
    );
  });
});
