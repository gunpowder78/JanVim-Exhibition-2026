import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const modulePath = resolve("deployment/operator/lib/Exhibition.Deployment.psm1");
const launcher = resolve("deployment/operator/Start-Exhibition.ps1");

it("formal site defaults create a continuous launch plan", () => {
  const result = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", `
    $ErrorActionPreference='Stop'; Import-Module ${quote(modulePath)} -Force
    $defaults=Read-ExhibitionSiteDefaults -Path ${quote(resolve("deployment/config/site-defaults.json"))}
    $plan=New-ExhibitionLaunchPlan -PackageRoot $defaults.packageRoot -DisplayMapPath 'D:\\fixture\\display-map.json' -DurationSeconds $defaults.durationSeconds
    $plan.durationSeconds | ConvertTo-Json -Compress
  `], { encoding: "utf8", timeout: 5000, windowsHide: true });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toBe(0);
});

it.each([0, 3600])("deployment waits until explicit exit for continuous mode, keeps rehearsal deadline: %s", duration => {
  const result = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", `
    $ErrorActionPreference='Stop'
    $ast=[Management.Automation.Language.Parser]::ParseFile(${quote(launcher)},[ref]$null,[ref]$null)
    $node=$ast.Find({param($n) $n -is [Management.Automation.Language.IfStatementAst] -and $n.Extent.Text.StartsWith('if ($plan.durationSeconds -eq 0)')},$true)
    if($null -eq $node){throw 'continuous-wait-branch-missing'}
    $plan=@{durationSeconds=${duration}}
    $showProcess=[pscustomobject]@{waits=[Collections.Generic.List[int]]::new()}
    $showProcess | Add-Member ScriptMethod WaitForExit { if($args.Count -eq 0){$this.waits.Add(-1)}else{$this.waits.Add([int]$args[0]);return $true} }
    . ([scriptblock]::Create($node.Extent.Text))
    @($showProcess.waits) | ConvertTo-Json -Compress -AsArray
  `], { encoding: "utf8", timeout: 5000, windowsHide: true });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual([duration === 0 ? -1 : 3720000]);
});
