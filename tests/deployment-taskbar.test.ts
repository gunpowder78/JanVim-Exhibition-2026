import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

const modulePath = resolve("deployment/operator/lib/Exhibition.Taskbar.psm1");
const launcherPath = resolve("deployment/operator/Start-Exhibition.ps1");

function run(body: string) {
  expect(existsSync(modulePath), "taskbar lifecycle helper must exist").toBe(true);
  // Only Win32 is replaced. Real hide/restore ownership and bounded checks run.
  const script = `
    $ErrorActionPreference='Stop'
    Add-Type -TypeDefinition @'
using System;
public static class ExhibitionTaskbarV1 {
 public static bool Primary=true,Secondary=true,RefuseHide=false;
 public static int Calls=0;
 public static IntPtr[] GetTaskbars() { return new[]{new IntPtr(11),new IntPtr(22)}; }
 public static bool IsWindowVisible(IntPtr h) { return h.ToInt64()==11?Primary:Secondary; }
 public static bool ShowWindowAsync(IntPtr h,int command) {
  if(h.ToInt64()!=11 && h.ToInt64()!=22) throw new Exception("non-taskbar-target");
  if(command!=0 && command!=4) throw new Exception("activation-or-invalid-command");
  Calls++;
  if(command==0 && RefuseHide && h.ToInt64()==22) return false;
  if(h.ToInt64()==11) Primary=command!=0; else Secondary=command!=0;
  return true;
 }
}
'@
    Import-Module '${modulePath.replaceAll("'", "''")}' -Force
    $state=@{RestoreRequired=$false}; $waits=0; $failure=$null
    $fakeWait={param($milliseconds) $script:waits++}
    ${body}
    @{primary=[ExhibitionTaskbarV1]::Primary;secondary=[ExhibitionTaskbarV1]::Secondary;
      calls=[ExhibitionTaskbarV1]::Calls;restoreRequired=$state.RestoreRequired;
      failure=$failure;waits=$waits} | ConvertTo-Json -Compress
  `;
  const result = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8", timeout: 10_000, windowsHide: true });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}

it("hides both taskbars once and retains restoration ownership", () => {
  const result = run(`Enter-ExhibitionTaskbar -State $state -Wait $fakeWait | Out-Null
    Enter-ExhibitionTaskbar -State $state -Wait $fakeWait | Out-Null`);
  expect(result).toMatchObject({primary: false, secondary: false, calls: 2, restoreRequired: true});
});

it.each([false, true])("restores after the show exits, including failure=%s", (fail) => {
  const result = run(`try {
    Enter-ExhibitionTaskbar -State $state -Wait $fakeWait | Out-Null
    ${fail ? "throw 'show-failure'" : ""}
  } catch {$failure=$_.Exception.Message} finally {
    Exit-ExhibitionTaskbar -State $state -Wait $fakeWait | Out-Null
  }
  Exit-ExhibitionTaskbar -State $state -Wait $fakeWait | Out-Null`);
  expect(result).toMatchObject({primary: true, secondary: true, calls: 4, restoreRequired: false,
    failure: fail ? "show-failure" : null});
});

it("does not restore another run's taskbar when this launch never acquired ownership", () => {
  const result = run(`Exit-ExhibitionTaskbar -State $state -Wait $fakeWait | Out-Null`);
  expect(result.calls).toBe(0);
});

it("restores partial hiding after a bounded failed hide, without real sleeps", () => {
  const result = run(`[ExhibitionTaskbarV1]::RefuseHide=$true
    try {Enter-ExhibitionTaskbar -State $state -Wait $fakeWait | Out-Null}
    catch {$failure=$_.Exception.Message}
    finally {Exit-ExhibitionTaskbar -State $state -Wait $fakeWait | Out-Null}`);
  expect(result).toMatchObject({primary: true, secondary: true, restoreRequired: false});
  expect(result.failure).toBe("taskbar-visibility-not-applied");
  expect(result.calls).toBe(4);
  expect(result.waits).toBeLessThanOrEqual(10);
});

it("emergency restoration works without a previous run or saved session", () => {
  const result = run(`[ExhibitionTaskbarV1]::Primary=$false
    [ExhibitionTaskbarV1]::Secondary=$false
    Set-ExhibitionTaskbarVisibility -Visible $true -Wait $fakeWait | Out-Null`);
  expect(result).toMatchObject({primary: true, secondary: true, calls: 2});
});

it.each([false, true])("the real launcher's finally restores only its own run, acquired=%s", (acquired) => {
  const result = run(`
    ${acquired ? "Enter-ExhibitionTaskbar -State $state -Wait $fakeWait | Out-Null" : ""}
    $taskbarState=$state; $showProcess=$null; $jianshanProcess=$null; $soundProcess=$null
    $launchMutex=$null; $runRoot='unused-test-evidence'
    function Set-Content { param($LiteralPath,$Encoding,[Parameter(ValueFromPipeline=$true)]$Value) }
    $errors=$null
    $ast=[Management.Automation.Language.Parser]::ParseFile('${launcherPath.replaceAll("'", "''")}',[ref]$null,[ref]$errors)
    if($errors.Count -gt 0) {throw 'launcher-parse-failed'}
    $outer=@($ast.EndBlock.Statements | Where-Object {$_ -is [Management.Automation.Language.TryStatementAst]})
    . ([scriptblock]::Create(($outer[-1].Finally.Statements.Extent.Text -join [Environment]::NewLine)))
  `);
  expect(result).toMatchObject({primary: true, secondary: true, restoreRequired: false, calls: acquired ? 4 : 0});
});
