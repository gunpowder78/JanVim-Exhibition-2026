import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { expect, it } from "vitest";

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

it("adapts the Electron millisecond lease to a verified full-precision process identity", () => {
  const launcher = join(process.cwd(), "deployment", "operator", "Start-Exhibition.ps1");
  const modulePath = join(process.cwd(), "deployment", "operator", "lib", "Exhibition.Deployment.psm1");
  const result = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", `
    $ErrorActionPreference='Stop'
    $tokens=$null; $errors=$null
    $ast=[Management.Automation.Language.Parser]::ParseFile(${quote(launcher)},[ref]$tokens,[ref]$errors)
    $functions=@($ast.FindAll({param($entry) $entry -is [Management.Automation.Language.FunctionDefinitionAst] -and $entry.Name -ceq 'Get-DeploymentControllerIdentity'},$true))
    if ($functions.Count -ne 1) { throw 'controller-lease-adapter-missing' }
    Invoke-Expression $functions[0].Extent.Text
    Import-Module ${quote(modulePath)} -Force
    $pwsh=(Get-Command pwsh.exe -CommandType Application)[0].Source
    $child=Start-Process -FilePath $pwsh -WindowStyle Hidden -ArgumentList @('-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 30') -PassThru
    $originalHandle=$child.SafeHandle
    try {
      $started=$child.StartTime.ToUniversalTime()
      $leaseStamp=$started.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'",[Globalization.CultureInfo]::InvariantCulture)
      $lease=[pscustomobject]@{pid=$child.Id;startedAtUtc=$leaseStamp}
      $identity=Get-DeploymentControllerIdentity -LeaseController $lease -ExpectedExecutable $pwsh
      $rejections=[Collections.Generic.List[string]]::new()
      foreach ($case in @(
        @{name='next-millisecond';value=[pscustomobject]@{pid=$child.Id;startedAtUtc=$started.AddMilliseconds(1).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'")};image=$pwsh},
        @{name='previous-millisecond';value=[pscustomobject]@{pid=$child.Id;startedAtUtc=$started.AddMilliseconds(-1).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'")};image=$pwsh},
        @{name='wrong-image';value=$lease;image='C:\\different\\electron.exe'},
        @{name='seconds-only';value=[pscustomobject]@{pid=$child.Id;startedAtUtc=$started.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'")};image=$pwsh},
        @{name='string-pid';value=[pscustomobject]@{pid=[string]$child.Id;startedAtUtc=$leaseStamp};image=$pwsh},
        @{name='extra-property';value=[pscustomobject]@{pid=$child.Id;startedAtUtc=$leaseStamp;unexpected=$true};image=$pwsh}
      )) {
        try { $null=Get-DeploymentControllerIdentity -LeaseController $case.value -ExpectedExecutable $case.image }
        catch { $rejections.Add($case.name) }
      }
      [ordered]@{
        samePid=($identity.pid -eq $child.Id)
        preservedExactStart=($identity.startedAtUtc -ceq $started.ToString('o'))
        exactIdentityVerified=(Test-DeploymentProcessIdentity -Identity $identity)
        leaseHasMilliseconds=($leaseStamp -cmatch '\\.\\d{3}Z$')
        rejections=$rejections.ToArray()
        childStillAlive=(-not $child.HasExited)
      } | ConvertTo-Json -Compress
    } finally {
      if (-not $child.HasExited) { $child.Kill(); [void]$child.WaitForExit(2000) }
      $child.Dispose()
    }
  `], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    samePid: true,
    preservedExactStart: true,
    exactIdentityVerified: true,
    leaseHasMilliseconds: true,
    rejections: ["next-millisecond", "previous-millisecond", "wrong-image", "seconds-only", "string-pid", "extra-property"],
    childStillAlive: true,
  });
});
