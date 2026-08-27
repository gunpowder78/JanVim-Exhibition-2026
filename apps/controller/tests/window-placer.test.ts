import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createWindowPlacementInvocation,
  placeJanVimWindow,
  validateWindowPlacementReceipt,
  type PlacementTarget,
  type WindowPlacementReceipt,
} from "../src/window-placer.ts";

const target: PlacementTarget = {
  pid: 4242,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
};

function receipt(overrides: Partial<WindowPlacementReceipt> = {}): WindowPlacementReceipt {
  return {
    schema: 1,
    pid: target.pid,
    matchedWindowCount: 1,
    hwnd: "0x0000000000012345",
    visible: true,
    owned: false,
    requested: target.bounds,
    actual: { x: 1, y: -1, width: 1918, height: 1082 },
    ...overrides,
  };
}

describe("JanVim PID window placement contract", () => {
  it("passes only the just-created child PID and target rectangle as separate arguments", () => {
    const invocation = createWindowPlacementInvocation({
      helperPath: "D:\\show\\scripts\\place-janvim-window.ps1",
      target,
    });

    expect(invocation.file).toBe("pwsh");
    expect(invocation.args).toEqual([
      "-NoProfile",
      "-File",
      "D:\\show\\scripts\\place-janvim-window.ps1",
      "-ChildProcessId",
      "4242",
      "-X",
      "0",
      "-Y",
      "0",
      "-Width",
      "1920",
      "-Height",
      "1080",
      "-TimeoutMs",
      "10000",
    ]);
    expect(invocation.args.join(" ")).not.toMatch(/title|processname|windowname/i);
  });

  it("rejects invalid PIDs and rectangles before invoking PowerShell", () => {
    expect(() =>
      createWindowPlacementInvocation({
        helperPath: "D:\\show\\scripts\\place-janvim-window.ps1",
        target: { ...target, pid: 0 },
      }),
    ).toThrow(/pid/i);
    expect(() =>
      createWindowPlacementInvocation({
        helperPath: "D:\\show\\scripts\\place-janvim-window.ps1",
        target: { ...target, bounds: { ...target.bounds, width: 0 } },
      }),
    ).toThrow(/rectangle/i);
  });

  it("accepts one visible unowned HWND for the exact PID within two pixels", () => {
    expect(validateWindowPlacementReceipt(receipt(), target)).toEqual({ ok: true });
  });

  it("rejects PID mismatch, multiple HWNDs, owned popups, and out-of-bounds receipts", () => {
    expect(validateWindowPlacementReceipt(receipt({ pid: 9999 }), target)).toEqual({
      ok: false,
      reason: "pid-mismatch",
    });
    expect(validateWindowPlacementReceipt(receipt({ matchedWindowCount: 2 }), target)).toEqual({
      ok: false,
      reason: "window-count-mismatch",
    });
    expect(validateWindowPlacementReceipt(receipt({ owned: true }), target)).toEqual({
      ok: false,
      reason: "window-not-eligible",
    });
    expect(
      validateWindowPlacementReceipt(
        receipt({ actual: { x: 100, y: 0, width: 1920, height: 1080 } }),
        target,
      ),
    ).toEqual({ ok: false, reason: "window-rectangle-mismatch" });
  });

  it("rejects malformed helper JSON as data instead of throwing", () => {
    expect(validateWindowPlacementReceipt(null, target)).toEqual({
      ok: false,
      reason: "receipt-invalid",
    });
    expect(
      validateWindowPlacementReceipt(
        { ...receipt(), actual: null },
        target,
      ),
    ).toEqual({ ok: false, reason: "receipt-invalid" });
  });

  it("executes the fixed helper invocation and validates its bounded JSON receipt", async () => {
    const invocations: unknown[] = [];
    const result = await placeJanVimWindow({
      helperPath: "D:\\show\\scripts\\place-janvim-window.ps1",
      target,
      runHelper: async (invocation, limits) => {
        invocations.push(invocation);
        expect(limits).toEqual({ timeoutMs: 12_000, maxOutputBytes: 4_096 });
        return { exitCode: 0, stdout: `${JSON.stringify(receipt())}\n`, stderr: "" };
      },
    });

    expect(result).toEqual({ ok: true });
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({
      file: "pwsh",
      args: expect.arrayContaining(["-ChildProcessId", "4242", "-TimeoutMs", "10000"]),
    });
  });

  it("fails closed for helper errors, malformed JSON, and oversized output", async () => {
    const helperPath = "D:\\show\\scripts\\place-janvim-window.ps1";
    await expect(
      placeJanVimWindow({
        helperPath,
        target,
        runHelper: async () => ({ exitCode: 1, stdout: "", stderr: "not found" }),
      }),
    ).resolves.toEqual({ ok: false, reason: "window-helper-failed" });
    await expect(
      placeJanVimWindow({
        helperPath,
        target,
        runHelper: async () => ({ exitCode: 0, stdout: "not-json", stderr: "" }),
      }),
    ).resolves.toEqual({ ok: false, reason: "receipt-invalid" });
    await expect(
      placeJanVimWindow({
        helperPath,
        target,
        runHelper: async () => ({ exitCode: 0, stdout: "x".repeat(4_097), stderr: "" }),
      }),
    ).resolves.toEqual({ ok: false, reason: "receipt-too-large" });
  });

  it("uses only bounded PID-based Win32 APIs in the PowerShell helper", () => {
    const source = readFileSync(
      join(process.cwd(), "scripts", "place-janvim-window.ps1"),
      "utf8",
    );

    for (const required of [
      "EnumWindows",
      "GetWindowThreadProcessId",
      "IsWindowVisible",
      "GetWindow",
      "SetWindowPos",
      "ShowWindowAsync",
      "GetWindowRect",
      "TimeoutMs",
      "Stopwatch",
    ]) {
      expect(source).toContain(required);
    }
    expect(source).not.toMatch(
      /SendKeys|keybd_event|mouse_event|SetCursorPos|MainWindowTitle|ProcessName|Get-Process/i,
    );
  });
});
