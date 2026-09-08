import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
const helperPath = join(process.cwd(), "scripts", "place-jianshan-window.ps1");

type FixtureReady = {
  schema: 1;
  pid: number;
  startedAtUtc: string;
  hwnds: string[];
};

type RunningFixture = {
  child: ChildProcessWithoutNullStreams;
  ready: FixtureReady;
  stopPath: string;
};

const fixtureSource = String.raw`
param(
    [Parameter(Mandatory = $true)][string]$StopPath,
    [ValidateRange(0, 2)][int]$WindowCount = 1
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Windows.Forms

$forms = [Collections.Generic.List[Windows.Forms.Form]]::new()
$timer = [Windows.Forms.Timer]::new()
$timer.Interval = 25
$timer.Add_Tick({
    if (Test-Path -LiteralPath $StopPath) {
        $timer.Stop()
        [Windows.Forms.Application]::ExitThread()
    }
})

try {
    foreach ($index in 1..$WindowCount) {
        if ($WindowCount -eq 0) { break }
        $form = [Windows.Forms.Form]::new()
        $form.Text = "JianShan placement fixture $index"
        $form.ShowInTaskbar = $true
        $form.StartPosition = [Windows.Forms.FormStartPosition]::Manual
        $form.Location = [Drawing.Point]::new(40 + (40 * $index), 40 + (40 * $index))
        $form.ClientSize = [Drawing.Size]::new(480, 320)
        $form.Show()
        $forms.Add($form)
    }
    [Windows.Forms.Application]::DoEvents()
    $process = [Diagnostics.Process]::GetCurrentProcess()
    $ready = [ordered]@{
        schema = 1
        pid = [int]$PID
        startedAtUtc = $process.StartTime.ToUniversalTime().ToString('o')
        hwnds = @($forms | ForEach-Object { '0x{0:X16}' -f $_.Handle.ToInt64() })
    }
    [Console]::Out.WriteLine(($ready | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
    $timer.Start()
    [Windows.Forms.Application]::Run()
}
finally {
    $timer.Stop()
    $timer.Dispose()
    foreach ($form in $forms) { $form.Dispose() }
}
`;

function isRunning(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode === null && child.signalCode === null;
}

function waitForExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<boolean> {
  if (!isRunning(child)) return Promise.resolve(true);
  return new Promise((resolvePromise) => {
    const onExit = (): void => {
      clearTimeout(timeout);
      resolvePromise(true);
    };
    const timeout = setTimeout(() => {
      child.off("exit", onExit);
      resolvePromise(false);
    }, timeoutMs);
    child.once("exit", onExit);
  });
}

function waitForReady(child: ChildProcessWithoutNullStreams): Promise<FixtureReady> {
  return new Promise((resolvePromise, reject) => {
    let stdout = "";
    let stderr = "";
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
      try {
        const parsed = JSON.parse(stdout.slice(0, newline)) as FixtureReady;
        if (
          parsed.schema !== 1 ||
          parsed.pid !== child.pid ||
          !/^\d{4}-\d{2}-\d{2}T/u.test(parsed.startedAtUtc) ||
          !Array.isArray(parsed.hwnds)
        ) {
          throw new Error("fixture-ready-invalid");
        }
        cleanup();
        resolvePromise(parsed);
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
      reject(new Error(`fixture-exited:${String(code)}:${stderr}`));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`fixture-ready-timeout:${stdout}:${stderr}`));
    }, 5_000);
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.once("exit", onExit);
  });
}

async function startFixture(
  root: string,
  name: string,
  windowCount: 0 | 1 | 2,
): Promise<RunningFixture> {
  const scriptPath = join(root, `${name}.ps1`);
  const stopPath = join(root, `${name}.stop`);
  writeFileSync(scriptPath, fixtureSource, "utf8");
  const child = spawn(
    "pwsh",
    [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      scriptPath,
      "-StopPath",
      stopPath,
      "-WindowCount",
      String(windowCount),
    ],
    { stdio: "pipe", windowsHide: false },
  );
  try {
    return { child, ready: await waitForReady(child), stopPath };
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

function runHelper(
  fixture: RunningFixture,
  options: { startedAtUtc?: string; timeoutMs?: number } = {},
): SpawnSyncReturns<string> {
  return spawnSync(
    "pwsh",
    [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      helperPath,
      "-ChildProcessId",
      String(fixture.ready.pid),
      "-ExpectedStartedAtUtc",
      options.startedAtUtc ?? fixture.ready.startedAtUtc,
      "-X",
      "80",
      "-Y",
      "80",
      "-Width",
      "640",
      "-Height",
      "480",
      "-TimeoutMs",
      String(options.timeoutMs ?? 10_000),
    ],
    { encoding: "utf8", timeout: 15_000, windowsHide: true },
  );
}

describe("exact JianShan window placement helper", () => {
  windowsIt(
    "makes the one exact process-owned window borderless fullscreen and interactive topmost",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "janvim-place-jianshan-success-"));
      let fixture: RunningFixture | undefined;
      try {
        fixture = await startFixture(root, "target", 1);
        const result = runHelper(fixture);
        expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout).toMatch(/^\{[^\r\n]+\}\r?\n?$/u);
        expect(JSON.parse(result.stdout)).toMatchObject({
          schema: 1,
          pid: fixture.ready.pid,
          matchedWindowCount: 1,
          requested: { x: 80, y: 80, width: 640, height: 480 },
          actual: { x: 80, y: 80, width: 640, height: 480 },
          fullscreen: true,
          borderless: true,
          maximized: false,
          topmost: true,
          clickThrough: false,
          noActivate: false,
        });
        expect(isRunning(fixture.child)).toBe(true);
      } finally {
        if (fixture !== undefined) await stopFixture(fixture);
        rmSync(root, { recursive: true, force: true });
      }
    },
    20_000,
  );

  windowsIt(
    "rejects wrong identity, no window, and multiple windows without terminating fixtures",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "janvim-place-jianshan-negative-"));
      const fixtures: RunningFixture[] = [];
      try {
        const target = await startFixture(root, "target", 1);
        const empty = await startFixture(root, "empty", 0);
        const multiple = await startFixture(root, "multiple", 2);
        fixtures.push(target, empty, multiple);

        const wrongIdentity = runHelper(target, {
          startedAtUtc: new Date(
            Date.parse(target.ready.startedAtUtc) + 1_000,
          ).toISOString(),
          timeoutMs: 500,
        });
        expect(wrongIdentity.status).not.toBe(0);
        expect(wrongIdentity.stdout).toBe("");

        const noWindow = runHelper(empty, { timeoutMs: 500 });
        expect(noWindow.status).not.toBe(0);
        expect(noWindow.stdout).toBe("");

        const twoWindows = runHelper(multiple, { timeoutMs: 500 });
        expect(twoWindows.status).not.toBe(0);
        expect(twoWindows.stdout).toBe("");

        expect(fixtures.every(({ child }) => isRunning(child))).toBe(true);
      } finally {
        for (const fixture of fixtures) await stopFixture(fixture);
        rmSync(root, { recursive: true, force: true });
      }
    },
    20_000,
  );

  windowsIt(
    "honors a 100 ms no-window timeout without touching the process",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "janvim-place-jianshan-timeout-"));
      let fixture: RunningFixture | undefined;
      try {
        fixture = await startFixture(root, "empty", 0);
        const started = Date.now();
        const result = runHelper(fixture, { timeoutMs: 100 });
        expect(result.status).not.toBe(0);
        expect(result.stdout).toBe("");
        expect(Date.now() - started).toBeLessThan(5_000);
        expect(isRunning(fixture.child)).toBe(true);
      } finally {
        if (fixture !== undefined) await stopFixture(fixture);
        rmSync(root, { recursive: true, force: true });
      }
    },
    15_000,
  );

  it("imports only the bounded placement APIs and no input simulation", () => {
    expect(existsSync(helperPath), "placement helper must exist").toBe(true);
    const source = existsSync(helperPath) ? requireSource() : "";
    const nativeMethods = Array.from(
      source.matchAll(/public\s+static\s+extern\s+\w+\s+(\w+)\s*\(/gu),
      (match) => match[1],
    );
    expect(nativeMethods).toEqual([
      "EnumWindows",
      "GetWindowThreadProcessId",
      "IsWindowVisible",
      "GetWindow",
      "GetClientRect",
      "GetWindowRect",
      "GetWindowLongPtrW",
      "SetWindowLongPtrW",
      "SetWindowPos",
      "ShowWindowAsync",
    ]);
    expect(source).not.toMatch(
      /SendKeys|AppActivate|SendInput|SendMessage|PostMessage|WM_KEY|mouse_event|keybd_event|SetCursorPos|FindWindow|MainWindowHandle/iu,
    );
  });
});

function requireSource(): string {
  return readFileSync(helperPath, "utf8");
}
