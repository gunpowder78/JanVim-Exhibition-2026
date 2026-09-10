import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

const helper = resolve("scripts/place-janvim-window.ps1");
const nativeType = /public static class (JanVimExhibitionWindowV\d+)/u
  .exec(readFileSync(helper, "utf8"))![1];

// Execute the real post-placement branch; only the desktop APIs are replaced.
// No real foreground change or wall-clock wait is needed for these cases.
function runPlacement(allowed: boolean, wrongMonitor = false, maximize = true) {
  const script = `
    $ErrorActionPreference='Stop'
    Add-Type -TypeDefinition @'
using System;
public static class ${nativeType} {
 public struct RECT { public int Left,Top,Right,Bottom; }
 public struct MONITORINFO { public int Size; public RECT Monitor,Work; public uint Flags; }
 public static int Calls=0;
 public static bool IsZoomed(IntPtr h) { return true; }
 public static IntPtr MonitorFromWindow(IntPtr h,uint flags) { return new IntPtr(10); }
 public static bool GetMonitorInfo(IntPtr h,ref MONITORINFO info) {
  info.Monitor=new RECT { Left=${wrongMonitor ? 1920 : 0},Top=0,Right=1920,Bottom=1080 };
  info.Work=info.Monitor; return true;
 }
 public static bool SetForegroundWindow(IntPtr h) {
  if(h.ToInt64()!=123) throw new Exception("wrong target HWND");
  Calls++; return ${allowed};
 }
}
'@
    $ast=[Management.Automation.Language.Parser]::ParseFile('${helper.replaceAll("'", "''")}',[ref]$null,[ref]$null)
    $branches=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.IfStatementAst] -and $n.Extent.Text.StartsWith('if ($Maximize)')},$true))
    $Maximize=$${maximize}; $window=[IntPtr]123
    $X=0; $Y=0; $Width=1920; $Height=1080; $receipt=[ordered]@{}
    $failure=$null
    try { . ([scriptblock]::Create($branches[-1].Extent.Text)) } catch { $failure=$_.Exception.Message }
    @{receipt=$receipt;calls=[${nativeType}]::Calls;failure=$failure} | ConvertTo-Json -Depth 5 -Compress
  `;
  const result = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}

it("activates the exact maximized JanVim window once after validating its display", () => {
  const result = runPlacement(true);
  expect(result.failure).toBeNull();
  expect(result.calls).toBe(1);
  expect(result.receipt.foregroundActivationAccepted).toBe(true);
});

it("records Windows foreground refusal without failing the running exhibition or retrying", () => {
  const result = runPlacement(false);
  expect(result.failure).toBeNull();
  expect(result.calls).toBe(1);
  expect(result.receipt.foregroundActivationAccepted).toBe(false);
});

it("never activates a window placed on the wrong monitor", () => {
  const result = runPlacement(true, true);
  expect(result.failure).toBe("janvim-maximized-on-wrong-monitor");
  expect(result.calls).toBe(0);
});

it("leaves non-maximized diagnostic placement focus unchanged", () => {
  expect(runPlacement(true, false, false).calls).toBe(0);
});
