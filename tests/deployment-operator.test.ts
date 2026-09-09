import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { afterAll, describe, expect, it } from "vitest";

const root = process.cwd();
const modulePath = join(
  root,
  "deployment",
  "operator",
  "lib",
  "Exhibition.Deployment.psm1",
);
const defaultsPath = join(root, "deployment", "config", "site-defaults.json");
const tempRoot = mkdtempSync(join(tmpdir(), "janvim-deployment-operator-"));

it("pins the same controller identity in outer preflight and inner show launcher", () => {
  const verifier = readFileSync(join(root, "deployment/operator/Verify-Deployment.ps1"), "utf8");
  const launcher = readFileSync(join(root, "scripts/start-show.ps1"), "utf8");
  const outer = /-Path \$electron -Bytes (\d+)\s+`\s+-Sha256 '([a-f0-9]{64})'/.exec(verifier);
  const innerBytes = /\$reviewedElectronMainBytes = (\d+)L/.exec(launcher);
  const innerHash = /\$reviewedElectronMainSha256 = '([a-f0-9]{64})'/.exec(launcher);
  expect(outer).not.toBeNull();
  expect(innerBytes?.[1]).toBe(outer?.[1]);
  expect(innerHash?.[1]).toBe(outer?.[2]);
});

afterAll(() => {
  const resolved = resolve(tempRoot);
  if (!resolved.startsWith(resolve(tmpdir()))) throw new Error("unsafe-test-root");
  rmSync(resolved, { recursive: true, force: true });
});

function psQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function invoke(body: string) {
  return spawnSync(
    "pwsh",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$ErrorActionPreference='Stop'; Import-Module ${psQuote(modulePath)} -Force; ${body}`,
    ],
    { encoding: "utf8", timeout: 10_000, windowsHide: true },
  );
}

function binding(softId: "SCREEN-1" | "SCREEN-2" | "SCREEN-3", index: number) {
  return {
    softId,
    displayId: String(100 + index),
    label: `Display ${index}`,
    bounds: { x: (index - 1) * 1920, y: 0, width: 1920, height: 1080 },
    workingArea: { x: (index - 1) * 1920, y: 0, width: 1920, height: 1040 },
    scaleFactor: 1,
    rotation: 0,
    geometrySha256: String(index).repeat(64),
  };
}

function validMap() {
  return {
    schema: 2,
    mappingStatus: "confirmed",
    mode: "production-3",
    layoutSha256: "a".repeat(64),
    capturedAtUtc: "2026-09-07T00:00:00.000Z",
    topologySha256: "b".repeat(64),
    bindings: [binding("SCREEN-1", 1), binding("SCREEN-2", 2), binding("SCREEN-3", 3)],
    unassignedDisplays: [],
  };
}

function writeJson(name: string, value: unknown): string {
  const path = join(tempRoot, name);
  writeFileSync(path, `${JSON.stringify(value)}\n`, "utf8");
  return path;
}

describe("attended deployment operator module", () => {
  it("accepts only one confirmed production SCREEN-3 and returns its bounds", () => {
    const mapPath = writeJson("valid-display-map.json", validMap());
    const result = invoke(
      `$value=Read-ProductionDisplayMap -Path ${psQuote(mapPath)}; $value | ConvertTo-Json -Depth 8 -Compress`,
    );

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      mapPath,
      screen3: {
        displayId: "103",
        x: 3840,
        y: 0,
        width: 1920,
        height: 1080,
      },
    });
  });

  it.each([
    ["missing SCREEN-3", () => {
      const value = validMap();
      value.bindings = value.bindings.slice(0, 2);
      return value;
    }],
    ["duplicate SCREEN-3", () => {
      const value = validMap();
      value.bindings[1]!.softId = "SCREEN-3";
      return value;
    }],
    ["schema 1", () => ({ ...validMap(), schema: 1 })],
    ["preview mode", () => ({ ...validMap(), mode: "single-display-preview" })],
    ["unknown root field", () => ({ ...validMap(), unexpected: true })],
    ["unknown binding field", () => {
      const value = validMap();
      return {
        ...value,
        bindings: value.bindings.map((entry, index) =>
          index === 2 ? { ...entry, unexpected: true } : entry,
        ),
      };
    }],
    ["zero width", () => {
      const value = validMap();
      value.bindings[2]!.bounds.width = 0;
      return value;
    }],
    ["unsafe bounds", () => {
      const value = validMap();
      value.bindings[2]!.bounds.x = Number.MAX_SAFE_INTEGER;
      return value;
    }],
  ])("rejects %s", (label, makeValue) => {
    const path = writeJson(`invalid-${label.replaceAll(" ", "-")}.json`, makeValue());
    const result = invoke(`Read-ProductionDisplayMap -Path ${psQuote(path)}`);
    expect(result.status, `${label}: ${result.stdout}${result.stderr}`).not.toBe(0);
  });

  it("rejects display-map JSON above 64 KiB", () => {
    const path = join(tempRoot, "oversized-map.json");
    writeFileSync(path, "x".repeat(65_537), "utf8");
    const result = invoke(`Read-ProductionDisplayMap -Path ${psQuote(path)}`);
    expect(result.status).not.toBe(0);
  });

  it("builds the minimal ordered 3,600-second automatic launch plan", () => {
    const packageRoot = "D:\\github\\JanVim-Exhibition-Deploy";
    const mapPath = "D:\\VirtualData\\JanVim-Exhibition-Rehearsals\\site-config\\display-map.json";
    const result = invoke(
      `New-ExhibitionLaunchPlan -PackageRoot ${psQuote(packageRoot)} -DisplayMapPath ${psQuote(mapPath)} -DurationSeconds 3600 | ConvertTo-Json -Depth 8 -Compress`,
    );

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema: 1,
      packageRoot,
      displayMapPath: mapPath,
      durationSeconds: 3600,
      listen: true,
      startPolicy: "Automatic",
      components: [
        { name: "sound" },
        { name: "jianshan" },
        { name: "show" },
      ],
    });
  });

  it("rejects active ownership secrets and paths outside the rehearsal parent", () => {
    const identity = {
      pid: 1234,
      startedAtUtc: "2026-09-07T00:00:00.0000000Z",
      executable: "D:\\github\\JanVim-Exhibition-Deploy\\runtime\\node\\node.exe",
    };
    const valid = {
      schema: 1,
      runRoot: "D:\\VirtualData\\JanVim-Exhibition-Rehearsals\\deployment-20260907-a",
      sessionFile:
        "D:\\VirtualData\\JanVim-Exhibition-Rehearsals\\joint-session-a\\session.json",
      soundWrapper: identity,
      jianshan: { ...identity, pid: 1235 },
      showWrapper: { ...identity, pid: 1236 },
      controller: null,
    };
    const secretPath = writeJson("active-secret.json", { ...valid, token: "secret" });
    const escapedPath = writeJson("active-escaped.json", {
      ...valid,
      runRoot: "C:\\Temp\\escaped",
    });

    expect(
      invoke(`Read-ActiveDeploymentPointer -Path ${psQuote(secretPath)}`).status,
    ).not.toBe(0);
    expect(
      invoke(`Read-ActiveDeploymentPointer -Path ${psQuote(escapedPath)}`).status,
    ).not.toBe(0);
  });

  it("atomically round-trips only the bounded non-secret active pointer", () => {
    const pointerPath = join(tempRoot, "active-deployment.json");
    const identity = {
      pid: 1234,
      startedAtUtc: "2026-09-07T00:00:00.0000000Z",
      executable: "D:\\github\\JanVim-Exhibition-Deploy\\tools\\node\\node.exe",
    };
    const pointer = {
      schema: 1,
      runRoot:
        "D:\\VirtualData\\JanVim-Exhibition-Rehearsals\\deployment-20260907-a",
      sessionFile:
        "D:\\VirtualData\\JanVim-Exhibition-Rehearsals\\joint-session-a\\session.json",
      soundWrapper: identity,
      jianshan: { ...identity, pid: 1235 },
      showWrapper: null,
      controller: null,
    };
    const result = invoke(
      `$value=${psQuote(JSON.stringify(pointer))}|ConvertFrom-Json -DateKind String; ` +
        `Write-ActiveDeploymentPointerAtomic -Path ${psQuote(pointerPath)} -Value $value; ` +
        `$read=Read-ActiveDeploymentPointer -Path ${psQuote(pointerPath)}; ` +
        `Remove-ActiveDeploymentPointer -Path ${psQuote(pointerPath)}; ` +
        `[pscustomobject]@{value=$read;removed=(-not(Test-Path -LiteralPath ${psQuote(pointerPath)}))}|ConvertTo-Json -Depth 8 -Compress`,
    );

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ value: pointer, removed: true });
  });

  it("proves and stops only an exact PID/start-time/executable identity", () => {
    const result = invoke(
      `$pwsh=(Get-Command pwsh.exe -CommandType Application -ErrorAction Stop)[0].Source; ` +
        `$child=Start-Process -FilePath $pwsh -ArgumentList @('-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 30') -PassThru; ` +
        `$identity=$null; try { ` +
        `$identity=Get-DeploymentProcessIdentity -Process $child -ExpectedExecutable $pwsh; ` +
        `$exact=Test-DeploymentProcessIdentity -Identity $identity; ` +
        `$wrong=[pscustomobject]@{pid=$identity.pid;startedAtUtc='2026-09-07T00:00:00.0000000Z';executable=$identity.executable}; ` +
        `$wrongAccepted=Test-DeploymentProcessIdentity -Identity $wrong; ` +
        `$stopped=Stop-DeploymentProcessExact -Identity $identity -TimeoutMs 2000 -CloseFirst; ` +
        `[pscustomobject]@{exact=$exact;wrongAccepted=$wrongAccepted;stopped=$stopped;stillLive=(Test-DeploymentProcessIdentity -Identity $identity)}|ConvertTo-Json -Compress ` +
        `} finally { if ($null -ne $identity -and (Test-DeploymentProcessIdentity -Identity $identity)) { [Diagnostics.Process]::GetProcessById($identity.pid).Kill() } }`,
    );

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      exact: true,
      wrongAccepted: false,
      stopped: true,
      stillLive: false,
    });
  });

  it("acts on the same process object whose exact identity was validated", () => {
    const moduleSource = readFileSync(modulePath, "utf8");
    const exactStart = moduleSource.indexOf("function Get-DeploymentExactProcess");
    const exactEnd = moduleSource.indexOf(
      "function Test-DeploymentProcessIdentity",
      exactStart,
    );
    const exactFunction = moduleSource.slice(exactStart, exactEnd);
    const start = moduleSource.indexOf("function Stop-DeploymentProcessExact");
    const end = moduleSource.indexOf("Export-ModuleMember", start);
    const stopFunction = moduleSource.slice(start, end);

    expect(exactFunction).toContain("$candidate.SafeHandle");
    expect(exactFunction.indexOf("$candidate.SafeHandle")).toBeLessThan(
      exactFunction.indexOf("$candidate.StartTime"),
    );
    expect(stopFunction).toContain(
      "$candidate = Get-DeploymentExactProcess -Identity $Identity",
    );
    expect(stopFunction).not.toContain("[Diagnostics.Process]::GetProcessById");
  });

  it("accepts the measured mini PC WASAPI endpoint in site defaults", () => {
    const path = writeJson("mini-pc-site-defaults.json", {
      ...JSON.parse(readFileSync(defaultsPath, "utf8")),
      audioOutputDevice: "Windows WASAPI : Speakers (Realtek High Definition Audio)",
    });
    const result = invoke(
      `Read-ExhibitionSiteDefaults -Path ${psQuote(path)} | ConvertTo-Json -Compress`,
    );

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      audioOutputDevice: "Windows WASAPI : Speakers (Realtek High Definition Audio)",
      durationSeconds: 3600,
    });
  });

  it.each([
    ["old Senary endpoint", "Windows WASAPI : Headphones (Senary Audio)"],
    ["HDMI television", "Windows WASAPI : 2 - Mi TV (AMD High Definition Audio Device)"],
    ["different API", "Windows WDM-KS : Speakers (Realtek HD Audio output)"],
    ["implicit default", ""],
    ["wrong case", "windows wasapi : Speakers (Realtek High Definition Audio)"],
    ["non-string endpoint", ["Windows WASAPI : Speakers (Realtek High Definition Audio)"]],
  ])("rejects %s as the reviewed mini PC audio endpoint", (label, audioOutputDevice) => {
    const path = writeJson(`audio-${label.replaceAll(" ", "-")}.json`, {
      ...JSON.parse(readFileSync(defaultsPath, "utf8")),
      audioOutputDevice,
    });
    const result = invoke(`Read-ExhibitionSiteDefaults -Path ${psQuote(path)}`);

    expect(result.status, `${result.stdout}${result.stderr}`).not.toBe(0);
    expect(result.stderr).toContain("site-defaults-invalid");
  });

  it("checks in exact non-secret site defaults and all three operator entry points", () => {
    expect(JSON.parse(readFileSync(defaultsPath, "utf8"))).toEqual({
      schema: 1,
      packageRoot: "D:\\github\\JanVim-Exhibition-Deploy",
      rehearsalParent: "D:\\VirtualData\\JanVim-Exhibition-Rehearsals",
      siteConfigRoot:
        "D:\\VirtualData\\JanVim-Exhibition-Rehearsals\\site-config",
      audioOutputDevice: "Windows WASAPI : Speakers (Realtek High Definition Audio)",
      durationSeconds: 3600,
    });
    for (const name of [
      "Start-Exhibition.ps1",
      "Stop-Exhibition.ps1",
      "Configure-Displays.ps1",
    ]) {
      expect(existsSync(join(root, "deployment", "operator", name)), name).toBe(true);
    }
  });

  it("starts the golden 002 sound child with the accepted real cursor profile", () => {
    const launcher = join(root, "deployment", "operator", "Start-Exhibition.ps1");
    const result = invoke([
      "$source=Get-Content -LiteralPath " + psQuote(launcher) + " -Raw",
      "$start=$source.IndexOf('# Deployment stage: sound',[StringComparison]::Ordinal)",
      "$end=$source.IndexOf('[void](Wait-DeploymentFile',$start,[StringComparison]::Ordinal)",
      "if($start -lt 0 -or $end -le $start){throw 'sound-stage-not-found'}",
      "function Start-DeploymentChild { param($FilePath,$Arguments,$WorkingDirectory) [pscustomobject]@{file=$FilePath;arguments=$Arguments;directory=$WorkingDirectory} }",
      "function Get-DeploymentProcessIdentity { param($Process,$ExpectedExecutable) @{pid=1} }",
      "$packageRoot='D:\\github\\JanVim-Exhibition-Deploy'; $powerShell='pwsh.exe'",
      "$joint='joint-rehearsal.ps1'; $sessionFile='fresh-session.json'; $node='node.exe'",
      "$plan=@{durationSeconds=3600}",
      "Invoke-Expression $source.Substring($start,$end-$start)",
      "$soundProcess | ConvertTo-Json -Depth 4 -Compress",
    ].join("\n"));

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      file: "pwsh.exe",
      directory: "D:\\github\\JanVim-Exhibition-Deploy\\app",
      arguments: [
        "-NoLogo", "-NoProfile", "-NonInteractive", "-File", "joint-rehearsal.ps1",
        "-Action", "Sound", "-SessionFile", "fresh-session.json",
        "-Listen", "-InstrumentProfile", "StoneAndSignalV2", "-NodeExecutable", "node.exe",
      ],
    });
  });

  it("keeps the attended launcher sequence explicit and cleanup identity-scoped", () => {
    const start = readFileSync(
      join(root, "deployment", "operator", "Start-Exhibition.ps1"),
      "utf8",
    );
    const stop = readFileSync(
      join(root, "deployment", "operator", "Stop-Exhibition.ps1"),
      "utf8",
    );
    const orderedMarkers = [
      "Deployment stage: verify",
      "Deployment stage: prepare",
      "Deployment stage: sound",
      "Deployment stage: jianshan-config",
      "Deployment stage: jianshan-place",
      "Deployment stage: show",
    ];
    let cursor = -1;
    for (const marker of orderedMarkers) {
      const next = start.indexOf(marker);
      expect(next, marker).toBeGreaterThan(cursor);
      cursor = next;
    }
    expect(start).toContain("'-StartPolicy', 'Automatic'");
    expect(start).toContain("'-Listen'");
    expect(start).toContain("'-TimeoutMs', '10000'");
    expect(start).not.toContain("'-TimeoutMs', '15000'");
    expect(start).toContain("show-stop-shortcut-unavailable");
    expect(stop).toContain("Read-ActiveDeploymentPointer");
    expect(stop).toContain("Stop-DeploymentProcessExact");
    for (const source of [start, stop]) {
      expect(source).not.toMatch(/Get-Process\s+-Name/iu);
      expect(source).not.toMatch(/Stop-Process\s+-Name/iu);
      expect(source).not.toMatch(/taskkill/iu);
    }
  });

  it.each([
    ["zero arguments for the native application", []],
    ["literal arguments for wrapper processes", ["argument with spaces", "semicolon;literal", 'quote"value']],
  ])("starts a deployment child with %s", (label, arguments_) => {
    const proofPath = join(tempRoot, `${label.replaceAll(" ", "-")}.json`);
    const preloadPath = join(tempRoot, "record-child-arguments.cjs");
    writeFileSync(preloadPath, [
      'const fs = require("node:fs");',
      "fs.writeFileSync(process.env.JANVIM_DEPLOY_TEST_RESULT, JSON.stringify({",
      "  arguments: process.argv.slice(1), directory: process.cwd(),",
      "}));",
      "process.exit(0);",
    ].join("\n"), "utf8");
    const launcher = join(root, "deployment", "operator", "Start-Exhibition.ps1");
    const childArguments = arguments_.length === 0 ? [] : [preloadPath, ...arguments_];
    const argumentsExpression = `@(${childArguments.map(psQuote).join(",")})`;
    const preloadOption = `--require="${preloadPath.replaceAll("\\", "/")}"`;
    const result = invoke(
      `$parseTokens=$null; $parseErrors=$null; ` +
        `$ast=[Management.Automation.Language.Parser]::ParseFile(${psQuote(launcher)},[ref]$parseTokens,[ref]$parseErrors); ` +
        `if ($parseErrors.Count -ne 0) { throw 'launcher-parse-failed' }; ` +
        `$functions=@($ast.FindAll({param($entry) $entry -is [Management.Automation.Language.FunctionDefinitionAst] -and $entry.Name -ceq 'Start-DeploymentChild'},$true)); ` +
        `if ($functions.Count -ne 1) { throw 'child-function-not-unique' }; ` +
        `Invoke-Expression $functions[0].Extent.Text; ` +
        `$child=Start-DeploymentChild -FilePath ${psQuote(process.execPath)} ` +
        `-Arguments ${argumentsExpression} -WorkingDirectory ${psQuote(tempRoot)} ` +
        `-Environment @{NODE_OPTIONS=${psQuote(preloadOption)};JANVIM_DEPLOY_TEST_RESULT=${psQuote(proofPath)}}; ` +
        `try { if (-not $child.WaitForExit(5000)) { throw 'child-timeout' }; ` +
        `[pscustomobject]@{exitCode=$child.ExitCode}|ConvertTo-Json -Compress ` +
        `} finally { if (-not $child.HasExited) { $child.Kill($true); [void]$child.WaitForExit(2000) }; $child.Dispose() }`,
    );

    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ exitCode: 0 });
    expect(JSON.parse(readFileSync(proofPath, "utf8"))).toEqual({
      arguments: childArguments,
      directory: tempRoot,
    });
  });

  it("rejects a package-root reparse point before importing package code", () => {
    for (const name of [
      "Start-Exhibition.ps1",
      "Stop-Exhibition.ps1",
      "Configure-Displays.ps1",
    ]) {
      const source = readFileSync(
        join(root, "deployment", "operator", name),
        "utf8",
      );
      const rootCheck = source.indexOf("$rootItem = Get-Item -LiteralPath $packageRoot -Force");
      const moduleImport = source.indexOf("Import-Module");
      expect(rootCheck, name).toBeGreaterThan(0);
      expect(rootCheck, name).toBeLessThan(moduleImport);
      expect(source.slice(rootCheck, moduleImport), name).toContain(
        "[IO.FileAttributes]::ReparsePoint",
      );
    }
  });
});
