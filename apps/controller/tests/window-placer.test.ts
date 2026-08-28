import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";

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

const windowsIt = process.platform === "win32" ? it : it.skip;

const windowFixture = String.raw`
param([Parameter(Mandatory = $true)][string]$StopPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class JanVimWindowFixture
{
    public delegate bool EnumWindowsProc(IntPtr window, IntPtr state);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr CreateWindowEx(
        uint exStyle,
        string className,
        string windowName,
        uint style,
        int x,
        int y,
        int width,
        int height,
        IntPtr parent,
        IntPtr menu,
        IntPtr instance,
        IntPtr parameter
    );

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool DestroyWindow(IntPtr window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetClientRect(IntPtr window, out RECT rectangle);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    public static extern IntPtr GetWindow(IntPtr window, uint command);

    [DllImport("user32.dll")]
    public static extern IntPtr GetParent(IntPtr window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr state);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongW")]
    public static extern int SetWindowLong(IntPtr window, int index, int value);
}
'@

$overlappedVisible = [uint32]0x10CF0000
$render = [JanVimWindowFixture]::CreateWindowEx(
    0, 'STATIC', 'fixture-render-window', $overlappedVisible,
    -30000, -30000, 640, 360,
    [IntPtr]::Zero, [IntPtr]::Zero, [IntPtr]::Zero, [IntPtr]::Zero
)
$eventTarget = [JanVimWindowFixture]::CreateWindowEx(
    [uint32]0x080800A0, 'STATIC', '', 0,
    0, 0, 0, 0,
    [IntPtr]::Zero, [IntPtr]::Zero, [IntPtr]::Zero, [IntPtr]::Zero
)
if ($render -eq [IntPtr]::Zero -or $eventTarget -eq [IntPtr]::Zero) {
    throw 'fixture-window-creation-failed'
}
[void][JanVimWindowFixture]::SetWindowLong($eventTarget, -16, [int]-1879048192)

$renderClient = [JanVimWindowFixture+RECT]::new()
$eventClient = [JanVimWindowFixture+RECT]::new()
$enumerated = [System.Collections.Generic.HashSet[IntPtr]]::new()
$enumCallback = [JanVimWindowFixture+EnumWindowsProc]{
    param([IntPtr]$window, [IntPtr]$state)
    [void]$enumerated.Add($window)
    return $true
}
[void][JanVimWindowFixture]::EnumWindows($enumCallback, [IntPtr]::Zero)
if (-not [JanVimWindowFixture]::GetClientRect($render, [ref]$renderClient) -or
    -not [JanVimWindowFixture]::GetClientRect($eventTarget, [ref]$eventClient) -or
    $renderClient.Right -le 0 -or $renderClient.Bottom -le 0 -or
    -not [JanVimWindowFixture]::IsWindowVisible($render) -or
    [JanVimWindowFixture]::GetWindow($render, [uint32]4) -ne [IntPtr]::Zero -or
    ($eventClient.Right -gt 0 -and $eventClient.Bottom -gt 0) -or
    -not [JanVimWindowFixture]::IsWindowVisible($eventTarget) -or
    [JanVimWindowFixture]::GetWindow($eventTarget, [uint32]4) -ne [IntPtr]::Zero -or
    [JanVimWindowFixture]::GetParent($eventTarget) -ne [IntPtr]::Zero -or
    -not $enumerated.Contains($eventTarget)) {
    throw "fixture-client-boundary-invalid:render=$($renderClient.Right)x$($renderClient.Bottom):event=$($eventClient.Right)x$($eventClient.Bottom)"
}

$timer = [System.Windows.Forms.Timer]::new()
$timer.Interval = 50
$lifetime = [Diagnostics.Stopwatch]::StartNew()
$timer.Add_Tick({
    if ((Test-Path -LiteralPath $StopPath) -or $lifetime.ElapsedMilliseconds -ge 30000) {
        $timer.Stop()
        [System.Windows.Forms.Application]::ExitThread()
    }
})

try {
    [Console]::Out.WriteLine('READY')
    [Console]::Out.Flush()
    $timer.Start()
    [System.Windows.Forms.Application]::Run()
}
finally {
    $timer.Dispose()
    [void][JanVimWindowFixture]::DestroyWindow($eventTarget)
    [void][JanVimWindowFixture]::DestroyWindow($render)
}
`;

const staleInteropWindowPlacement = String.raw`
param(
    [Parameter(Mandatory = $true)]
    [string]$HelperPath,

    [Parameter(Mandatory = $true)]
    [int]$FixtureProcessId
)

Add-Type -TypeDefinition @'
public static class JanVimExhibitionWindow
{
}
'@

$placement = @{
    ChildProcessId = $FixtureProcessId
    X = -30000
    Y = -30000
    Width = 640
    Height = 360
    TimeoutMs = 2000
}

& $HelperPath @placement
`;

function waitForReady(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`fixture-ready-timeout: ${stdout}\n${stderr}`));
    }, 5_000);
    const onStdout = (chunk: Buffer): void => {
      stdout += chunk.toString("utf8");
      if (stdout.includes("READY")) {
        cleanup();
        resolve();
      }
    };
    const onStderr = (chunk: Buffer): void => {
      stderr += chunk.toString("utf8");
    };
    const onExit = (code: number | null): void => {
      cleanup();
      reject(new Error(`fixture-exited-before-ready:${String(code)}: ${stdout}\n${stderr}`));
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("exit", onExit);
    };
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.once("exit", onExit);
  });
}

async function closeFixture(
  child: ChildProcessWithoutNullStreams,
  stopPath: string,
): Promise<void> {
  if (child.exitCode !== null) return;
  writeFileSync(stopPath, "stop", "utf8");
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill();
      resolve();
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

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

  windowsIt(
    "places the render window when the same PID also owns a visible zero-area helper HWND",
    async () => {
      const fixtureRoot = mkdtempSync(join(tmpdir(), "janvim-window-fixture-"));
      const fixturePath = join(fixtureRoot, "window-fixture.ps1");
      const stopPath = join(fixtureRoot, "stop");
      writeFileSync(fixturePath, windowFixture, "utf8");
      const fixture = spawn(
        "pwsh",
        ["-NoProfile", "-File", fixturePath, "-StopPath", stopPath],
        {
          stdio: "pipe",
          windowsHide: false,
        },
      );

      try {
        await waitForReady(fixture);
        const helperPath = join(process.cwd(), "scripts", "place-janvim-window.ps1");
        const result = spawnSync(
          "pwsh",
          [
            "-NoProfile",
            "-File",
            helperPath,
            "-ChildProcessId",
            String(fixture.pid),
            "-X",
            "-30000",
            "-Y",
            "-30000",
            "-Width",
            "640",
            "-Height",
            "360",
            "-TimeoutMs",
            "2000",
          ],
          { encoding: "utf8", timeout: 15_000, windowsHide: true },
        );

        expect(
          result.status,
          `${result.error?.message ?? ""}\n${result.stdout}\n${result.stderr}`,
        ).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({
          schema: 1,
          pid: fixture.pid,
          matchedWindowCount: 1,
          visible: true,
          owned: false,
          actual: { x: -30000, y: -30000, width: 640, height: 360 },
        });
      } finally {
        await closeFixture(fixture, stopPath);
        rmSync(fixtureRoot, { recursive: true, force: true });
      }
    },
    25_000,
  );

  windowsIt(
    "loads the current window interop after an earlier version was cached in the runspace",
    async () => {
      const fixtureRoot = mkdtempSync(join(tmpdir(), "janvim-window-stale-interop-fixture-"));
      const fixturePath = join(fixtureRoot, "window-fixture.ps1");
      const invocationPath = join(fixtureRoot, "stale-interop-placement.ps1");
      const stopPath = join(fixtureRoot, "stop");
      writeFileSync(fixturePath, windowFixture, "utf8");
      writeFileSync(invocationPath, staleInteropWindowPlacement, "utf8");
      const fixture = spawn(
        "pwsh",
        ["-NoProfile", "-File", fixturePath, "-StopPath", stopPath],
        {
          stdio: "pipe",
          windowsHide: false,
        },
      );

      try {
        await waitForReady(fixture);
        const helperPath = join(process.cwd(), "scripts", "place-janvim-window.ps1");
        const result = spawnSync(
          "pwsh",
          [
            "-NoProfile",
            "-File",
            invocationPath,
            "-HelperPath",
            helperPath,
            "-FixtureProcessId",
            String(fixture.pid),
          ],
          { encoding: "utf8", timeout: 15_000, windowsHide: true },
        );

        expect(
          result.status,
          `${result.error?.message ?? ""}\n${result.stdout}\n${result.stderr}`,
        ).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({
          pid: fixture.pid,
          matchedWindowCount: 1,
          actual: { x: -30000, y: -30000, width: 640, height: 360 },
        });
      } finally {
        await closeFixture(fixture, stopPath);
        rmSync(fixtureRoot, { recursive: true, force: true });
      }
    },
    25_000,
  );

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
