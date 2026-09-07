import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const modulePath = join(process.cwd(), "deployment", "operator", "lib", "Exhibition.Deployment.psm1");
const psQuote = (value: string) => `'${value.replaceAll("'", "''")}'`;

function observeStartup(unavailableReads: number, wrongImage = false, unavailableStart = false) {
  return spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", `
    $ErrorActionPreference='Stop'
    Import-Module ${psQuote(modulePath)} -Force
    $pwsh=(Get-Command pwsh.exe -CommandType Application)[0].Source
    $child=Start-Process -FilePath $pwsh -WindowStyle Hidden -ArgumentList @('-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 30') -PassThru
    $originalHandle=$child.SafeHandle
    $global:startupTarget=$child.Id
    $global:startupReads=0
    $global:startupWaits=[Collections.Generic.List[int]]::new()
    function global:Start-Sleep { param([int]$Milliseconds) $global:startupWaits.Add($Milliseconds) }
    Update-TypeData -TypeName System.Diagnostics.Process -MemberType ScriptProperty -MemberName Path -Force -Value {
      if ($this.Id -eq $global:startupTarget) {
        $global:startupReads++
        if ($global:startupReads -le ${unavailableReads}) { return $null }
        ${wrongImage ? "return 'C:\\different\\application.exe'" : ""}
      }
      return $this.MainModule.FileName
    }
    ${unavailableStart ? "Update-TypeData -TypeName System.Diagnostics.Process -MemberType ScriptProperty -MemberName StartTime -Force -Value { throw 'startup-time-unavailable' }" : ""}
    try {
      $identity=$null; $failure=$null
      try { $identity=Get-DeploymentProcessIdentity -Process $child -ExpectedExecutable $pwsh } catch { $failure=$_.Exception.Message }
      [ordered]@{
        identityMatches=($null -ne $identity -and $identity.pid -eq $child.Id -and $identity.executable -eq $pwsh)
        reads=$global:startupReads
        waits=$global:startupWaits.ToArray()
        stillAlive=(-not $child.HasExited)
        originalHandleStillValid=(-not $originalHandle.IsInvalid -and -not $originalHandle.IsClosed)
        failure=$failure
      } | ConvertTo-Json -Compress
    } finally {
      Remove-TypeData -TypeName System.Diagnostics.Process
      if (-not $child.HasExited) { $child.Kill(); [void]$child.WaitForExit(2000) }
      $child.Dispose()
    }
  `], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
}

describe("deployment child startup metadata", () => {
  it("waits briefly for the image path while retaining the original child handle", () => {
    const result = observeStartup(3);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      identityMatches: true,
      reads: 4,
      waits: [50, 50, 50],
      stillAlive: true,
      originalHandleStillValid: true,
      failure: null,
    });
  });

  it("fails closed after the finite startup budget when the image remains unavailable", () => {
    const result = observeStartup(100);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      identityMatches: false,
      reads: 40,
      waits: Array(39).fill(50),
      stillAlive: true,
      originalHandleStillValid: true,
      failure: "deployment-process-identity-unavailable",
    });
  });

  it("rejects a different image immediately without waiting or trusting the requested path", () => {
    const result = observeStartup(0, true);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      identityMatches: false,
      reads: 1,
      waits: [],
      stillAlive: true,
      originalHandleStillValid: true,
      failure: "deployment-process-executable-mismatch",
    });
  });

  it("still rejects a different image before an unavailable start time can mask the mismatch", () => {
    const result = observeStartup(0, true, true);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      identityMatches: false,
      reads: 1,
      waits: [],
      failure: "deployment-process-executable-mismatch",
    });
  });

  it("cleans up the original started child after missing identity without stopping a bystander", () => {
    const launcher = join(process.cwd(), "deployment", "operator", "Start-Exhibition.ps1");
    const result = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", `
      $ErrorActionPreference='Stop'
      $tokens=$null; $errors=$null
      $ast=[Management.Automation.Language.Parser]::ParseFile(${psQuote(launcher)},[ref]$tokens,[ref]$errors)
      $functions=@($ast.FindAll({param($entry) $entry -is [Management.Automation.Language.FunctionDefinitionAst] -and $entry.Name -ceq 'Stop-DeploymentStartedChild'},$true))
      if ($functions.Count -ne 1) { throw 'started-child-cleanup-function-missing' }
      Invoke-Expression $functions[0].Extent.Text
      Import-Module ${psQuote(modulePath)} -Force
      $pwsh=(Get-Command pwsh.exe -CommandType Application)[0].Source
      $target=Start-Process -FilePath $pwsh -WindowStyle Hidden -ArgumentList @('-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 30') -PassThru
      $bystander=Start-Process -FilePath $pwsh -WindowStyle Hidden -ArgumentList @('-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 30') -PassThru
      $targetHandle=$target.SafeHandle
      $bystanderHandle=$bystander.SafeHandle
      $global:unidentifiedTarget=$target.Id
      function global:Start-Sleep { param([int]$Milliseconds) }
      Update-TypeData -TypeName System.Diagnostics.Process -MemberType ScriptProperty -MemberName Path -Force -Value {
        if ($this.Id -eq $global:unidentifiedTarget) { return $null }
        return $this.MainModule.FileName
      }
      try {
        $identityFailure=$null
        try { $null=Get-DeploymentProcessIdentity -Process $target -ExpectedExecutable $pwsh } catch { $identityFailure=$_.Exception.Message }
        $stopped=Stop-DeploymentStartedChild -Process $target -TimeoutMs 50
        [ordered]@{identityFailure=$identityFailure;stopped=$stopped;targetExited=$target.HasExited;bystanderAlive=(-not $bystander.HasExited)} | ConvertTo-Json -Compress
      } finally {
        Remove-TypeData -TypeName System.Diagnostics.Process
        foreach ($child in @($target,$bystander)) {
          if (-not $child.HasExited) { $child.Kill(); [void]$child.WaitForExit(2000) }
          $child.Dispose()
        }
      }
    `], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      identityFailure: "deployment-process-identity-unavailable",
      stopped: true,
      targetExited: true,
      bystanderAlive: true,
    });
  });
});
