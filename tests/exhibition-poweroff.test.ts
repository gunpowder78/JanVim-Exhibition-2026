import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const modulePath = resolve("deployment/operator/lib/Exhibition.Deployment.psm1").replaceAll("'", "''");
const marker = { schema: 1, runId: "joint-show-fresh", controllerRunId: "ctl-fresh", controllerPid: 4321, outcome: "intentional-success", reason: "operator-stop-poweroff" };
function run(value: unknown, flags = "-ShowExitCode 0 -SoundClean $true -ChildrenExited $true") {
  const json = JSON.stringify(value).replaceAll("'", "''");
  return spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", `
    $ErrorActionPreference='Stop'
    Import-Module '${modulePath}' -Force
    & (Get-Module Exhibition.Deployment) {
      $script:powerCalls=@()
      function script:Start-Process {
        param($FilePath,$ArgumentList,$WindowStyle,[switch]$Wait,[switch]$PassThru)
        $script:powerCalls+=@{file=$FilePath;args=$ArgumentList;style=$WindowStyle;wait=$Wait.IsPresent}
        $process=[pscustomobject]@{ExitCode=0}
        $process | Add-Member ScriptMethod WaitForExit { param($timeout) if($timeout -ne 5000){throw 'unbounded-shutdown-wait'}; return $true }
        $process | Add-Member ScriptMethod Dispose {}
        $process
      }
    }
    $failed=$false
    try { Invoke-ExhibitionPowerOff -TerminalMarker ('${json}' | ConvertFrom-Json) -ExpectedRunId 'joint-show-fresh' -ExpectedControllerPid 4321 ${flags} | Out-Null } catch { $failed=$true }
    $calls=@(& (Get-Module Exhibition.Deployment) { $script:powerCalls })
    @{failed=$failed;calls=$calls} | ConvertTo-Json -Depth 8 -Compress
  `], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
}
describe("exhibition power-off after complete cleanup", () => {
  it("requests Windows power-off only after the current shortcut stop completed cleanly", () => {
    const result=run(marker);
    expect(result.status, result.stderr).toBe(0);
    const record=JSON.parse(result.stdout);
    expect(record.failed).toBe(false);
    expect(record.calls).toEqual([{file: `${process.env.SystemRoot}\\System32\\shutdown.exe`,args:["/s","/t","0"],style:"Hidden",wait:false}]);
  });
  it.each(["operator-stop", "soak-complete"])("does not power off for %s", reason => {
    const result=run({...marker,reason});
    expect(JSON.parse(result.stdout)).toEqual({failed:false,calls:[]});
  });
  it.each([
    "-ShowExitCode 1 -SoundClean $true -ChildrenExited $true",
    "-ShowExitCode 0 -SoundClean $false -ChildrenExited $true",
    "-ShowExitCode 0 -SoundClean $true -ChildrenExited $false",
  ])("refuses power-off when cleanup is incomplete: %s", flags => {
    expect(JSON.parse(run(marker,flags).stdout)).toEqual({failed:true,calls:[]});
  });
  it.each([
    {...marker,runId:"joint-show-stale"}, {...marker,controllerPid:9999},
    {...marker,outcome:"intentional-failure"}, {...marker,extra:true},
  ])("refuses stale, failed, or malformed terminal evidence: %j", value => {
    expect(JSON.parse(run(value).stdout)).toEqual({failed:true,calls:[]});
  });
});
