import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const root = process.cwd();
const temporary = mkdtempSync(join(tmpdir(), "janvim-preflight-"));
const launcher = readFileSync(join(root, "deployment/operator/Start-Exhibition.ps1"), "utf8");
const verification = launcher.slice(launcher.indexOf("# Deployment stage: verify"), launcher.indexOf("# Deployment stage: display-map"));
const quote = (text: string) => `'${text.replaceAll("'", "''")}'`;
afterAll(() => rmSync(temporary, { recursive: true, force: true }));

describe("deployment preflight cold-start budget", () => {
  it.each([0, 1])("uses only the resolved per-run map and stops on resolver exit %i", (resolverExit) => {
    const stage = launcher.slice(launcher.indexOf("# Deployment stage: display-map"), launcher.indexOf("    $plan = New-ExhibitionLaunchPlan"));
    const result = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", `
      $ErrorActionPreference='Stop'; Set-StrictMode -Version Latest
      $packageRoot='D:\\fake-package'; $runRoot=${quote(temporary)}; $displayMapPath='D:\\saved-map.json'
      function Invoke-DeploymentProcessCaptured {
        param($FilePath,$Arguments,[int]$TimeoutMs)
        if ('--display-config-mode=resolve' -cnotin $Arguments -or $TimeoutMs -gt 20000) { throw 'headless-resolution-contract-invalid' }
        if ('--saved-display-map=D:\\saved-map.json' -cnotin $Arguments) { throw 'saved-override-not-forwarded' }
        [pscustomobject]@{ExitCode=${resolverExit};Stdout='resolved';Stderr=''}
      }
      function Read-ProductionDisplayMap {
        param($Path)
        if ($Path -cne (Join-Path $runRoot 'display-map.json')) { throw 'stale-saved-map-used' }
        'per-run-map-accepted'
      }
      ${stage}
      $display
    `], { encoding: "utf8", timeout: 5_000, windowsHide: true });
    expect(result.status, result.stderr).toBe(resolverExit);
    if (resolverExit === 0) expect(result.stdout).toContain("per-run-map-accepted");
    else expect(result.stderr).toContain("deployment-display-resolution-failed");
  });

  it.each(["connected", "absent", "probe-error"])("continues exhibition preflight when the optional camera is %s", (cameraState) => {
    const source = readFileSync(join(root, "deployment/operator/Verify-Deployment.ps1"), "utf8");
    const cameraCheck = source.slice(source.indexOf("Write-VerificationProgress -Stage 'camera-pnp'"), source.indexOf("Write-VerificationProgress -Stage 'display-driver'"));
    const result = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", `
      $ErrorActionPreference='Stop'; Set-StrictMode -Version Latest
      function Write-VerificationProgress { param($Stage,$Status) }
      function Import-Module { param($Name) }
      function Get-PnpDevice {
        ${cameraState === "probe-error" ? "throw 'PnP unavailable'" : cameraState === "connected" ? "[pscustomobject]@{Class='Camera';Status='OK';FriendlyName='USB Camera'}" : "@()"}
      }
      function Add-Check {
        param($Name,[bool]$Passed,$Detail)
        if (-not $Passed) { throw 'optional-camera-blocked-startup' }
      }
      ${cameraCheck}
      'camera-preflight-accepted'
    `], { encoding: "utf8", timeout: 5_000, windowsHide: true });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("camera-preflight-accepted");
  });

  it.each([[90_000, true], [130_000, false]] as const)("bounds the actual manifest probe at simulated %i ms", (elapsedMs, accepted) => {
    const source = readFileSync(join(root, "deployment/operator/Verify-Deployment.ps1"), "utf8");
    const manifestProbe = source.slice(source.indexOf("$manifestResult = Invoke-Captured"), source.indexOf("$manifestReceipt ="));
    const result = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", `
      $ErrorActionPreference='Stop'
      $node='fake-node'; $manifestTool='fake-manifest'; $packageRoot='fake-package'
      function Invoke-Captured {
        param($FilePath,$Arguments,[int]$TimeoutMs)
        if (${elapsedMs} -gt $TimeoutMs) { throw 'deployment-probe-timeout' }
        [pscustomobject]@{ExitCode=0;Stdout='';Stderr=''}
      }
      ${manifestProbe}
      'manifest-accepted'
    `], { encoding: "utf8", timeout: 5_000, windowsHide: true });
    if (accepted) {
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("manifest-accepted");
    } else {
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("deployment-probe-timeout");
    }
  });

  it.each([5_000, 90_000])("allows valid preflight taking %i ms without a wall-clock wait", (elapsedMs) => {
    const result = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", `
      $ErrorActionPreference='Stop'
      $powerShell='fake-pwsh'; $verify='fake-verifier'; $runRoot=${quote(temporary)}
      function Invoke-DeploymentProcessCaptured {
        param($FilePath,$Arguments,[int]$TimeoutMs)
        if ($TimeoutMs -lt ${elapsedMs}) { throw 'deployment-child-timeout' }
        if ($TimeoutMs -gt 240000) { throw 'preflight-budget-too-large' }
        [pscustomobject]@{ExitCode=0;Stdout='DEPLOYMENT_VERIFY_PASS';Stderr=''}
      }
      ${verification}
      'preflight-accepted'
    `], { encoding: "utf8", timeout: 5_000, windowsHide: true });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("preflight-accepted");
  });

  it.each(["timeout", "invalid"])("still rejects %s before any show starts", (reason) => {
    const result = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", `
      $ErrorActionPreference='Stop'
      $powerShell='fake-pwsh'; $verify='fake-verifier'; $runRoot=${quote(temporary)}
      function Invoke-DeploymentProcessCaptured {
        param($FilePath,$Arguments,[int]$TimeoutMs)
        ${reason === "timeout" ? "if ($TimeoutMs -le 240000) { throw 'deployment-child-timeout' }" : ""}
        [pscustomobject]@{ExitCode=1;Stdout='';Stderr='identity-invalid'}
      }
      ${verification}
      'incorrectly-accepted'
    `], { encoding: "utf8", timeout: 5_000, windowsHide: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(reason === "timeout" ? "deployment-child-timeout" : "deployment-verification-failed");
    expect(result.stdout).not.toContain("incorrectly-accepted");
  });

  it("persists completed checks before the next check can hang, with finite output", () => {
    const verifier = join(root, "deployment/operator/Verify-Deployment.ps1");
    const progress = join(temporary, "progress.jsonl");
    const result = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", `
      $ErrorActionPreference='Stop'; Set-StrictMode -Version Latest
      $tokens=$null; $errors=$null
      $ast=[Management.Automation.Language.Parser]::ParseFile(${quote(verifier)},[ref]$tokens,[ref]$errors)
      $function=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Write-VerificationProgress'},$true)
      if ($null -eq $function) { throw 'verification-progress-missing' }
      Invoke-Expression $function.Extent.Text
      $ProgressPath=${quote(progress)}; $script:progressEntries=0
      $script:verificationClock=[pscustomobject]@{ElapsedMilliseconds=90000}
      Write-VerificationProgress -Stage 'manifest' -Status 'passed'
      if (-not (Test-Path -LiteralPath $ProgressPath)) { throw 'progress-not-flushed' }
      try { 1..40 | ForEach-Object { Write-VerificationProgress -Stage 'next' -Status 'started' } } catch { $_.Exception.Message }
    `], { encoding: "utf8", timeout: 5_000, windowsHide: true });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("verification-progress-limit");
    const entries = readFileSync(progress, "utf8").trim().split(/\r?\n/u).map(line => JSON.parse(line));
    expect(entries).toHaveLength(32);
    expect(entries[0]).toMatchObject({ stage: "manifest", status: "passed", elapsedMs: 90_000 });
  });
});
