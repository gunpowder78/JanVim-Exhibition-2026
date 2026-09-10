import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const launcher = resolve("deployment/operator/Start-Exhibition.ps1");

function run(reasons: string[], large = false, formatted = false) {
  const root = mkdtempSync(join(tmpdir(), "janvim-window-startup-"));
  try {
    if (formatted) {
      const fixture = join(root, "place-jianshan-window.ps1");
      writeFileSync(fixture, `throw ${quote(reasons[0]!)}\n`);
      const error = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-File", fixture], {
        encoding: "utf8", timeout: 5000, windowsHide: true,
      });
      expect(error.status).toBe(1);
      expect(error.stderr).toContain(reasons[0]);
      reasons = [error.stderr, ...reasons.slice(1)];
    }
    const result = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", `
      $ErrorActionPreference='Stop'
      $ast=[Management.Automation.Language.Parser]::ParseFile(${quote(launcher)},[ref]$null,[ref]$null)
      $function=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-DeploymentWindowPlacement'},$true)
      if($null -eq $function){throw 'placement-recovery-function-missing'}
      . ([scriptblock]::Create($function.Extent.Text))
      $state=@{ calls=0; now=0; failure='' }
      $scenarioReasons=ConvertFrom-Json ${quote(JSON.stringify(reasons))} -NoEnumerate
      $invoke={
        $reason=$scenarioReasons[[Math]::Min($state.calls,$scenarioReasons.Count-1)]
        $state.calls++; $state.now+=20000
        if($reason -eq 'deployment-child-timeout'){throw $reason}
        [pscustomobject]@{ExitCode=([int]($reason -ne 'pass')); Stdout='window-result'; Stderr=($reason + ('x' * ${large ? 40000 : 0}))}
      }
      try { $null=Invoke-DeploymentWindowPlacement -RunRoot ${quote(root)} -InvokePlacement $invoke -Wait {param($ms) $state.now+=$ms} }
      catch { $state.failure=$_.Exception.Message }
      Write-Output ('RESULT=' + ($state | ConvertTo-Json -Compress))
    `], { encoding: "utf8", timeout: 10_000, windowsHide: true });
    expect(result.status, result.stderr).toBe(0);
    const line = result.stdout.split(/\r?\n/).find(value => value.startsWith("RESULT="));
    expect(line).toBeDefined();
    return {
      state: JSON.parse(line!.slice(7)),
      files: Object.fromEntries(readdirSync(root).map(name => [name, readFileSync(join(root, name), "utf8")])),
    };
  } finally {
    if (!resolve(root).startsWith(resolve(tmpdir()) + "\\")) throw new Error("unsafe-test-root");
    rmSync(root, { recursive: true, force: true });
  }
}

it("accepts first placement and retains bounded diagnostic output", () => {
  const result = run(["pass"], true);
  expect(result.state).toEqual({ calls: 1, now: 20000, failure: "" });
  expect(result.files["jianshan-placement-1-Stderr.txt"]!.length).toBe(32768);
  expect(result.files["jianshan-placement-1-Stdout.txt"]).toBe("window-result");
});

it.each(["jianshan-window-not-found", "jianshan-window-final-state-invalid", "deployment-child-timeout"])("recovers transient %s with the same placement action and a fake wait", reason => {
  const result = run([reason, "pass"]);
  expect(result.state).toEqual({ calls: 2, now: 40500, failure: "" });
  expect(result.files["jianshan-placement-2-Stdout.txt"]).toBe("window-result");
  expect(result.files["jianshan-placement-1-Stderr.txt"]).toContain(reason);
});

it("stops at three attempts and preserves the final reason", () => {
  const result = run(["jianshan-window-not-found"]);
  expect(result.state).toEqual({ calls: 3, now: 61000, failure: "jianshan-window-placement-failed:jianshan-window-not-found" });
  expect(Object.keys(result.files)).toHaveLength(6);
});

it("recognizes the real PowerShell -File exception with path and repeated reason", () => {
  expect(run(["jianshan-window-not-found", "pass"], false, true).state).toEqual({
    calls: 2, now: 40500, failure: "",
  });
});

it.each(["deployment-child-cleanup-incomplete", "jianshan-process-identity-mismatch", "jianshan-window-count-invalid", "unexpected-error", "jianshan-window-not-found jianshan-process-identity-mismatch"])("fails immediately without retry on %s", reason => {
  const result = run([reason, "pass"]);
  expect(result.state.calls).toBe(1);
  expect(result.state.failure).toContain("jianshan-window-placement-failed");
  expect(result.files["jianshan-placement-1-Stderr.txt"]).toBe(reason);
});

it.each([false, true])("reports a retryable timeout only when the old helper exited: %s", exited => {
  const result = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", `
    $ErrorActionPreference='Stop'
    $ast=[Management.Automation.Language.Parser]::ParseFile(${quote(launcher)},[ref]$null,[ref]$null)
    $function=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-DeploymentProcessCaptured'},$true)
    $branch=$function.Find({param($n) $n -is [Management.Automation.Language.IfStatementAst] -and $n.Extent.Text.StartsWith('if (-not $process.WaitForExit($TimeoutMs))')},$true)
    $TimeoutMs=20000
    $process=[pscustomobject]@{calls=0; waits=[Collections.Generic.List[int]]::new()}
    $process | Add-Member ScriptMethod Kill {param($tree) throw 'simulated-kill-denied'}
    $process | Add-Member ScriptMethod WaitForExit {param($ms) $this.calls++; $this.waits.Add($ms); return ($this.calls -gt 1 -and $${exited})}
    try { . ([scriptblock]::Create($branch.Extent.Text)); throw 'missing-timeout-failure' }
    catch { [pscustomobject]@{reason=$_.Exception.Message; waits=@($process.waits)} | ConvertTo-Json -Compress }
  `], { encoding: "utf8", timeout: 5000, windowsHide: true });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    reason: exited ? "deployment-child-timeout" : "deployment-child-cleanup-incomplete",
    waits: [20000, 2000],
  });
});
