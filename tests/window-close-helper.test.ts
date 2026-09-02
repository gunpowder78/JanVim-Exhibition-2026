import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
  type SpawnSyncReturns,
} from "node:child_process";

import { describe, expect, it } from "vitest";

const windowsIt = process.platform === "win32" ? it : it.skip;
const helperPath = join(process.cwd(), "scripts", "close-janvim-window.ps1");

type FixtureReady = {
  schema: 1;
  pid: number;
  hwnd: string;
  childHwnd: string;
  invisibleHwnd: string;
  ownedHwnd: string;
  destroyedHwnd: string;
};

type RunningFixture = {
  child: ChildProcessWithoutNullStreams;
  closeCountPath: string;
  ready: FixtureReady;
  stopPath: string;
};

const windowFixture = String.raw`
param(
    [Parameter(Mandatory = $true)]
    [string]$CloseCountPath,

    [Parameter(Mandatory = $true)]
    [string]$StopPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class JanVimCloseWindowFixtureNative
{
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindow(IntPtr window);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll")]
    public static extern IntPtr GetParent(IntPtr window);

    [DllImport("user32.dll")]
    public static extern IntPtr GetWindow(IntPtr window, uint command);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindowVisible(IntPtr window);
}
'@

$script:closeCount = 0
$script:closeCountPath = $CloseCountPath
$script:stopPath = $StopPath
$script:lifetime = [Diagnostics.Stopwatch]::StartNew()
[IO.File]::WriteAllText($CloseCountPath, '0')

$form = [Windows.Forms.Form]::new()
$form.ShowInTaskbar = $true
$form.StartPosition = [Windows.Forms.FormStartPosition]::Manual
$form.Location = [Drawing.Point]::new(-30000, -30000)
$form.Size = [Drawing.Size]::new(320, 180)

$childControl = [Windows.Forms.Panel]::new()
$childControl.Dock = [Windows.Forms.DockStyle]::Fill
$form.Controls.Add($childControl)

$ownedForm = [Windows.Forms.Form]::new()
$ownedForm.ShowInTaskbar = $false
$ownedForm.StartPosition = [Windows.Forms.FormStartPosition]::Manual
$ownedForm.Location = [Drawing.Point]::new(-30000, -30000)
$ownedForm.Size = [Drawing.Size]::new(160, 90)

$invisibleForm = [Windows.Forms.Form]::new()
$invisibleForm.ShowInTaskbar = $false

$form.Add_FormClosing({
    $script:closeCount += 1
    [IO.File]::WriteAllText($script:closeCountPath, [string]$script:closeCount)
})
$form.Add_FormClosed({
    [Windows.Forms.Application]::ExitThread()
})

$timer = [Windows.Forms.Timer]::new()
$timer.Interval = 50
$timer.Add_Tick({
    if ((Test-Path -LiteralPath $script:stopPath) -or
        $script:lifetime.ElapsedMilliseconds -ge 30000) {
        $timer.Stop()
        [Windows.Forms.Application]::ExitThread()
    }
})

$destroyedForm = $null
try {
    $timer.Start()
    $form.Show()
    $ownedForm.Show($form)
    [Windows.Forms.Application]::DoEvents()

    $topHandle = $form.Handle
    $childHandle = $childControl.Handle
    $ownedHandle = $ownedForm.Handle
    $invisibleHandle = $invisibleForm.Handle

    $destroyedForm = [Windows.Forms.Form]::new()
    $destroyedHandle = $destroyedForm.Handle
    $destroyedForm.Dispose()

    $windowPid = [uint32]0
    [void][JanVimCloseWindowFixtureNative]::GetWindowThreadProcessId(
        $topHandle,
        [ref]$windowPid
    )
    if (-not [JanVimCloseWindowFixtureNative]::IsWindow($topHandle) -or
        $windowPid -ne [uint32]$PID -or
        -not [JanVimCloseWindowFixtureNative]::IsWindowVisible($topHandle) -or
        [JanVimCloseWindowFixtureNative]::GetParent($topHandle) -ne [IntPtr]::Zero -or
        [JanVimCloseWindowFixtureNative]::GetWindow($topHandle, [uint32]4) -ne [IntPtr]::Zero -or
        -not [JanVimCloseWindowFixtureNative]::IsWindow($childHandle) -or
        [JanVimCloseWindowFixtureNative]::GetParent($childHandle) -eq [IntPtr]::Zero -or
        -not [JanVimCloseWindowFixtureNative]::IsWindow($ownedHandle) -or
        -not [JanVimCloseWindowFixtureNative]::IsWindowVisible($ownedHandle) -or
        [JanVimCloseWindowFixtureNative]::GetWindow($ownedHandle, [uint32]4) -eq [IntPtr]::Zero -or
        -not [JanVimCloseWindowFixtureNative]::IsWindow($invisibleHandle) -or
        [JanVimCloseWindowFixtureNative]::IsWindowVisible($invisibleHandle) -or
        [JanVimCloseWindowFixtureNative]::IsWindow($destroyedHandle)) {
        throw "fixture-window-contract-invalid:topVisible=$([JanVimCloseWindowFixtureNative]::IsWindowVisible($topHandle)):topParent=$([JanVimCloseWindowFixtureNative]::GetParent($topHandle)):topOwner=$([JanVimCloseWindowFixtureNative]::GetWindow($topHandle, [uint32]4)):childParent=$([JanVimCloseWindowFixtureNative]::GetParent($childHandle)):ownedVisible=$([JanVimCloseWindowFixtureNative]::IsWindowVisible($ownedHandle)):ownedOwner=$([JanVimCloseWindowFixtureNative]::GetWindow($ownedHandle, [uint32]4)):invisibleVisible=$([JanVimCloseWindowFixtureNative]::IsWindowVisible($invisibleHandle)):destroyedIsWindow=$([JanVimCloseWindowFixtureNative]::IsWindow($destroyedHandle))"
    }

    $ready = [ordered]@{
        schema = 1
        pid = [int]$PID
        hwnd = ('0x{0:X16}' -f $topHandle.ToInt64())
        childHwnd = ('0x{0:X16}' -f $childHandle.ToInt64())
        invisibleHwnd = ('0x{0:X16}' -f $invisibleHandle.ToInt64())
        ownedHwnd = ('0x{0:X16}' -f $ownedHandle.ToInt64())
        destroyedHwnd = ('0x{0:X16}' -f $destroyedHandle.ToInt64())
    }
    [Console]::Out.WriteLine(($ready | ConvertTo-Json -Compress))
    [Console]::Out.Flush()

    [Windows.Forms.Application]::Run()
}
finally {
    $timer.Stop()
    $timer.Dispose()
    if ($null -ne $destroyedForm) {
        $destroyedForm.Dispose()
    }
    $invisibleForm.Dispose()
    $ownedForm.Dispose()
    $childControl.Dispose()
    $form.Dispose()
}
`;

const repeatedLoadProbe = String.raw`
param(
    [Parameter(Mandatory = $true)]
    [string]$HelperPath,

    [Parameter(Mandatory = $true)]
    [int]$FixtureProcessId,

    [Parameter(Mandatory = $true)]
    [string]$ChildHwnd
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$attempts = 0
foreach ($attempt in 1..2) {
    try {
        [void](& $HelperPath -ChildProcessId $FixtureProcessId -Hwnd $ChildHwnd)
        throw 'helper-unexpectedly-succeeded'
    }
    catch {
        if ($_.Exception.Message -eq 'helper-unexpectedly-succeeded') {
            throw
        }
        $errorName = ([string]$_.FullyQualifiedErrorId -split ',', 2)[0]
        if ($errorName -eq 'TYPE_ALREADY_EXISTS') {
            throw 'add-type-was-not-guarded'
        }
        $attempts += 1
    }
}

[ordered]@{ attempts = $attempts } | ConvertTo-Json -Compress
`;

function isRunning(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode === null && child.signalCode === null;
}

function waitForExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<boolean> {
  if (!isRunning(child)) return Promise.resolve(true);

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = (): void => {
      clearTimeout(timeout);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

function waitForReady(child: ChildProcessWithoutNullStreams): Promise<FixtureReady> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`fixture-ready-timeout:\n${stdout}\n${stderr}`));
    }, 5_000);
    const cleanup = (): void => {
      clearTimeout(timeout);
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("exit", onExit);
    };
    const onStdout = (chunk: Buffer): void => {
      stdout += chunk.toString("utf8");
      const newline = stdout.indexOf("\n");
      if (newline < 0) return;

      const line = stdout.slice(0, newline).trim();
      try {
        const parsed = JSON.parse(line) as FixtureReady;
        if (
          parsed.schema !== 1 ||
          parsed.pid !== child.pid ||
          !/^0x[0-9A-F]{16}$/.test(parsed.hwnd) ||
          !/^0x[0-9A-F]{16}$/.test(parsed.childHwnd) ||
          !/^0x[0-9A-F]{16}$/.test(parsed.invisibleHwnd) ||
          !/^0x[0-9A-F]{16}$/.test(parsed.ownedHwnd) ||
          !/^0x[0-9A-F]{16}$/.test(parsed.destroyedHwnd)
        ) {
          throw new Error(`fixture-ready-invalid:${line}`);
        }
        cleanup();
        resolve(parsed);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    const onStderr = (chunk: Buffer): void => {
      stderr += chunk.toString("utf8");
    };
    const onExit = (code: number | null): void => {
      cleanup();
      reject(new Error(`fixture-exited-before-ready:${String(code)}:\n${stdout}\n${stderr}`));
    };

    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.once("exit", onExit);
  });
}

async function startFixture(root: string, name: string): Promise<RunningFixture> {
  const fixturePath = join(root, `${name}-window-fixture.ps1`);
  const closeCountPath = join(root, `${name}-close-count.txt`);
  const stopPath = join(root, `${name}-stop`);
  writeFileSync(fixturePath, windowFixture, "utf8");

  const child = spawn(
    "pwsh",
    [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      fixturePath,
      "-CloseCountPath",
      closeCountPath,
      "-StopPath",
      stopPath,
    ],
    { stdio: "pipe", windowsHide: false },
  );

  try {
    const ready = await waitForReady(child);
    return { child, closeCountPath, ready, stopPath };
  } catch (error) {
    child.kill();
    await waitForExit(child, 2_000);
    throw error;
  }
}

async function stopFixture(fixture: RunningFixture): Promise<void> {
  if (!isRunning(fixture.child)) return;
  writeFileSync(fixture.stopPath, "stop", "utf8");
  if (await waitForExit(fixture.child, 2_000)) return;
  fixture.child.kill();
  await waitForExit(fixture.child, 2_000);
}

function runHelper(pid: number, hwnd: string): SpawnSyncReturns<string> {
  return spawnSync(
    "pwsh",
    [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      helperPath,
      "-ChildProcessId",
      String(pid),
      "-Hwnd",
      hwnd,
    ],
    { encoding: "utf8", timeout: 5_000, windowsHide: true },
  );
}

async function expectBothFixturesOpen(
  first: RunningFixture,
  second: RunningFixture,
): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(isRunning(first.child)).toBe(true);
  expect(isRunning(second.child)).toBe(true);
  expect(readFileSync(first.closeCountPath, "utf8")).toBe("0");
  expect(readFileSync(second.closeCountPath, "utf8")).toBe("0");
}

describe("exact HWND close PowerShell helper", () => {
  windowsIt(
    "posts one WM_CLOSE to the exact fixture-owned top-level window and emits one strict receipt",
    async () => {
      const fixtureRoot = mkdtempSync(join(tmpdir(), "janvim-close-helper-success-"));
      let fixture: RunningFixture | undefined;

      try {
        fixture = await startFixture(fixtureRoot, "target");
        const result = runHelper(fixture.ready.pid, fixture.ready.hwnd);
        const expectedReceipt = {
          schema: 1,
          pid: fixture.ready.pid,
          hwnd: fixture.ready.hwnd,
          ownershipVerified: true,
          topLevel: true,
          closePosted: true,
        };

        expect(
          result.status,
          `${result.error?.message ?? ""}\n${result.stdout}\n${result.stderr}`,
        ).toBe(0);
        expect(result.error).toBeUndefined();
        expect(result.stderr).toBe("");
        expect(result.stdout).toMatch(/^\{[^\r\n]+\}\r?\n?$/);
        expect(result.stdout.trim()).toBe(JSON.stringify(expectedReceipt));
        expect(JSON.parse(result.stdout)).toStrictEqual(expectedReceipt);
        expect(Object.keys(JSON.parse(result.stdout) as object)).toEqual([
          "schema",
          "pid",
          "hwnd",
          "ownershipVerified",
          "topLevel",
          "closePosted",
        ]);

        expect(await waitForExit(fixture.child, 5_000)).toBe(true);
        expect(readFileSync(fixture.closeCountPath, "utf8")).toBe("1");
      } finally {
        if (fixture !== undefined) await stopFixture(fixture);
        rmSync(fixtureRoot, { recursive: true, force: true });
      }
    },
    15_000,
  );

  windowsIt(
    "rejects every ineligible fixture HWND without closing either fixture process",
    async () => {
      const fixtureRoot = mkdtempSync(join(tmpdir(), "janvim-close-helper-negative-"));
      const fixtures: RunningFixture[] = [];

      try {
        const first = await startFixture(fixtureRoot, "first");
        fixtures.push(first);
        const second = await startFixture(fixtureRoot, "second");
        fixtures.push(second);

        const cases = [
          { name: "wrong PID", pid: second.ready.pid, hwnd: first.ready.hwnd },
          { name: "child HWND", pid: first.ready.pid, hwnd: first.ready.childHwnd },
          {
            name: "destroyed HWND",
            pid: first.ready.pid,
            hwnd: first.ready.destroyedHwnd,
          },
          {
            name: "invisible HWND",
            pid: first.ready.pid,
            hwnd: first.ready.invisibleHwnd,
          },
          { name: "owned HWND", pid: first.ready.pid, hwnd: first.ready.ownedHwnd },
          { name: "foreign HWND", pid: first.ready.pid, hwnd: second.ready.hwnd },
        ];

        for (const testCase of cases) {
          const result = runHelper(testCase.pid, testCase.hwnd);
          expect(result.error, testCase.name).toBeUndefined();
          expect(result.status, `${testCase.name}: ${result.stderr}`).not.toBe(0);
          expect(result.stdout, testCase.name).toBe("");
          expect(result.stderr.length, testCase.name).toBeGreaterThan(0);
          await expectBothFixturesOpen(first, second);
        }
      } finally {
        for (const fixture of fixtures) await stopFixture(fixture);
        rmSync(fixtureRoot, { recursive: true, force: true });
      }
    },
    20_000,
  );

  windowsIt(
    "can be loaded twice in one PowerShell runspace without TYPE_ALREADY_EXISTS",
    async () => {
      const fixtureRoot = mkdtempSync(join(tmpdir(), "janvim-close-helper-reload-"));
      const probePath = join(fixtureRoot, "repeated-load-probe.ps1");
      let fixture: RunningFixture | undefined;
      writeFileSync(probePath, repeatedLoadProbe, "utf8");

      try {
        fixture = await startFixture(fixtureRoot, "target");
        const result = spawnSync(
          "pwsh",
          [
            "-NoProfile",
            "-NonInteractive",
            "-File",
            probePath,
            "-HelperPath",
            helperPath,
            "-FixtureProcessId",
            String(fixture.ready.pid),
            "-ChildHwnd",
            fixture.ready.childHwnd,
          ],
          { encoding: "utf8", timeout: 5_000, windowsHide: true },
        );

        expect(
          result.status,
          `${result.error?.message ?? ""}\n${result.stdout}\n${result.stderr}`,
        ).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout.trim()).toBe('{"attempts":2}');
        expect(readFileSync(fixture.closeCountPath, "utf8")).toBe("0");
        expect(isRunning(fixture.child)).toBe(true);
      } finally {
        if (fixture !== undefined) await stopFixture(fixture);
        rmSync(fixtureRoot, { recursive: true, force: true });
      }
    },
    15_000,
  );

  it("imports only the exact close APIs and contains no search, selection, or alternate message path", () => {
    expect(existsSync(helperPath), "close helper must exist").toBe(true);
    const source = readFileSync(helperPath, "utf8");
    const nativeMethods = Array.from(
      source.matchAll(/public\s+static\s+extern\s+\w+\s+(\w+)\s*\(/g),
      (match) => match[1],
    );
    const importedLibraries = Array.from(
      source.matchAll(/\[DllImport\("([^"]+)"/g),
      (match) => match[1],
    );

    expect(nativeMethods).toEqual([
      "IsWindow",
      "GetWindowThreadProcessId",
      "GetParent",
      "GetWindow",
      "IsWindowVisible",
      "PostMessage",
    ]);
    expect(importedLibraries).toEqual(Array(6).fill("user32.dll"));
    expect(source).not.toMatch(/EntryPoint\s*=/i);
    expect(source).toContain("TYPE_ALREADY_EXISTS");
    expect(source).toMatch(/-as\s+\[type\]/i);
    expect(source).toMatch(/\[UInt64\]::TryParse\(/);
    expect(source).not.toMatch(/\[Int64\]::(?:Parse|TryParse)\(/);
    expect(source).toMatch(/\$gwOwner\s*=\s*\[uint32\]4/i);
    expect(source).toMatch(/\$wmClose\s*=\s*\[uint32\]0x0010/i);
    expect(source).toMatch(
      /::PostMessage\(\s*\$window,\s*\$wmClose,\s*\[IntPtr\]::Zero,\s*\[IntPtr\]::Zero\s*\)/s,
    );
    expect(source.match(/\b0x[0-9a-f]+\b/gi)).toEqual(["0x0010"]);

    expect(source).not.toMatch(
      /SendKeys|AppActivate|EnumWindows|EnumDesktopWindows|FindWindow|GetWindowText|MainWindowTitle|WindowTitle|Get-Process|ProcessName|GetProcessById|Win32_Process|Stop-Process/i,
    );
    expect(source).not.toMatch(/-(?:like|notlike)\b|Where-Object|Get-ChildItem/i);
    expect(source).not.toContain("*");
  });
});
