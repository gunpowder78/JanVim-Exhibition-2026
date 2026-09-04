import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, win32 } from "node:path";
import {
  spawn,
  spawnSync,
  type ChildProcess,
  type SpawnSyncReturns,
} from "node:child_process";

import { afterAll, describe, expect, it } from "vitest";

import {
  parseShowRunEvidence,
  TASK9_ARTIFACT_IDENTITY,
} from "../apps/controller/src/show-run-evidence.ts";
import {
  hashDisplayGeometryV2,
  hashDisplayTopology,
} from "../apps/controller/src/display-routing-contract.ts";

const repositoryRoot = process.cwd();
const productionScript = join(repositoryRoot, "scripts", "start-show.ps1");
const rehearsalParent = "D:\\VirtualData\\JanVim-Exhibition-Rehearsals";
const productRoot = "D:\\github\\JanVim";
const userNvimRoot = "C:\\Users\\operator\\AppData\\Local\\nvim";
const protectedRoots = [
  "D:\\VirtualData\\TempCache\\janvim-root-export-quarantine-20260826-110433-6473a2d7ebbc4524b66c61c07e540504",
  "D:\\VirtualData\\TempCache\\janvim-task5-cached-d42e9769283e47dc8b98cf94baee739d",
  "D:\\VirtualData\\TempCache\\janvim-task5-physical-cached-e9735e8d02e34ff4a4ac8836f8e22dcb",
] as const;
const reviewedElectronReleaseIdentityStart =
  "# JANVIM_REVIEWED_ELECTRON_RELEASE_IDENTITY_BEGIN";
const reviewedElectronReleaseIdentityEnd =
  "# JANVIM_REVIEWED_ELECTRON_RELEASE_IDENTITY_END";
const launcherFixtureRuntimeImports = [
  "electron",
  "node:child_process",
  "node:fs",
  "node:path",
  "node:url",
] as const;

let fakeElectronTemplateRoot: string | undefined;
let fakeElectronTemplate: string | undefined;
let fakeNodeTemplateRoot: string | undefined;
let fakeNodeTemplate: string | undefined;

function fakeElectronExecutableTemplate(): string {
  if (fakeElectronTemplate !== undefined) return fakeElectronTemplate;
  fakeElectronTemplateRoot = mkdtempSync(
    join(tmpdir(), "janvim-show-electron-template-"),
  );
  fakeElectronTemplate = join(fakeElectronTemplateRoot, "electron.exe");
  copyFileSync(process.execPath, fakeElectronTemplate);
  return fakeElectronTemplate;
}

function fakeNodeExecutableTemplate(): string {
  if (fakeNodeTemplate !== undefined) return fakeNodeTemplate;
  fakeNodeTemplateRoot = mkdtempSync(join(tmpdir(), "janvim-show-node-template-"));
  const publishRoot = join(fakeNodeTemplateRoot, "publish");
  const projectPath = join(fakeNodeTemplateRoot, "FakeNode.csproj");
  fakeNodeTemplate = join(publishRoot, "FakeNode.exe");
  const source = String.raw`
using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
using System.Threading;

public static class JanVimShowFakeNode
{
    private static void ScheduleNodeMutationAfterExit()
    {
        if (Environment.GetEnvironmentVariable("SHOW_TEST_NODE_MUTATION") != "attempt-after-graph-verifier") {
            return;
        }
        ProcessStartInfo startInfo = new ProcessStartInfo();
        startInfo.FileName = "pwsh";
        startInfo.UseShellExecute = false;
        startInfo.CreateNoWindow = true;
        startInfo.ArgumentList.Add("-NoProfile");
        startInfo.ArgumentList.Add("-NonInteractive");
        startInfo.ArgumentList.Add("-File");
        startInfo.ArgumentList.Add(Environment.GetEnvironmentVariable("SHOW_TEST_NODE_MUTATION_HELPER"));
        startInfo.ArgumentList.Add(Process.GetCurrentProcess().Id.ToString());
        startInfo.ArgumentList.Add(Environment.ProcessPath);
        startInfo.ArgumentList.Add(Environment.GetEnvironmentVariable("SHOW_TEST_NODE_MUTATION_LOG"));
        Process mutator = Process.Start(startInfo);
        if (mutator == null) throw new InvalidOperationException("node mutator failed to start");
        mutator.Dispose();
    }

    private static void AttemptParserPackageMutation()
    {
        if (Environment.GetEnvironmentVariable("SHOW_TEST_PARSER_PACKAGE_MUTATION") != "attempt-before-graph-verifier") {
            return;
        }
        string packagePath = Environment.GetEnvironmentVariable("SHOW_TEST_PARSER_PACKAGE_MANIFEST");
        string mutationLog = Environment.GetEnvironmentVariable("SHOW_TEST_PARSER_PACKAGE_MUTATION_LOG");
        try {
            string original = File.ReadAllText(packagePath);
            string modified = original.Replace("\"type\": \"commonjs\"", "\"type\": \"module\"", StringComparison.Ordinal);
            if (String.Equals(original, modified, StringComparison.Ordinal)) return;
            File.WriteAllText(packagePath, modified);
            File.AppendAllText(mutationLog, "replaced" + Environment.NewLine);
        }
        catch (Exception error) {
            File.AppendAllText(
                mutationLog,
                "blocked:" + unchecked((uint)error.HResult).ToString("X8") + Environment.NewLine
            );
        }
    }

    private static void AttemptParserMutation()
    {
        if (Environment.GetEnvironmentVariable("SHOW_TEST_PARSER_MUTATION") != "attempt-before-graph-verifier") {
            return;
        }
        string parserPath = Environment.GetEnvironmentVariable("SHOW_TEST_PARSER_IMPLEMENTATION");
        string mutationLog = Environment.GetEnvironmentVariable("SHOW_TEST_PARSER_MUTATION_LOG");
        try {
            string original = File.ReadAllText(parserPath);
            string modified = original.Replace("original", "modified", StringComparison.Ordinal);
            if (String.Equals(original, modified, StringComparison.Ordinal)) return;
            File.WriteAllText(parserPath, modified);
            File.AppendAllText(mutationLog, "replaced" + Environment.NewLine);
        }
        catch (Exception error) {
            File.AppendAllText(
                mutationLog,
                "blocked:" + unchecked((uint)error.HResult).ToString("X8") + Environment.NewLine
            );
        }
    }

    private static int ExecuteFakeParser()
    {
        ProcessStartInfo startInfo = new ProcessStartInfo();
        startInfo.FileName = Environment.GetEnvironmentVariable("SHOW_TEST_REAL_NODE");
        startInfo.UseShellExecute = false;
        startInfo.CreateNoWindow = true;
        startInfo.RedirectStandardOutput = true;
        startInfo.RedirectStandardError = true;
        startInfo.ArgumentList.Add(Environment.GetEnvironmentVariable("SHOW_TEST_PARSER_IMPLEMENTATION"));
        using Process parser = Process.Start(startInfo);
        if (parser == null) return 93;
        if (!parser.WaitForExit(5000)) {
            parser.Kill(true);
            parser.WaitForExit();
            return 93;
        }
        string stdout = parser.StandardOutput.ReadToEnd();
        string stderr = parser.StandardError.ReadToEnd();
        return parser.ExitCode == 0 && stdout.Length == 0 && stderr.Length == 0 ? 0 : 93;
    }

    public static int Main(string[] arguments)
    {
        if (arguments.Length != 1) return 91;
        if (Path.GetFileName(arguments[0]).Equals("verify-electron-module-graph.mjs", StringComparison.Ordinal)) {
            AttemptParserPackageMutation();
            AttemptParserMutation();
            int parserExit = ExecuteFakeParser();
            if (parserExit != 0) return parserExit;
            string root = Environment.CurrentDirectory;
            string[] relativePaths = new[] {
                "apps/controller/dist/main/electron-main.js"
            };
            object[] files = new object[relativePaths.Length];
            for (int index = 0; index < relativePaths.Length; index++) {
                string relativePath = relativePaths[index];
                string path = Path.Combine(root, relativePath.Replace('/', Path.DirectorySeparatorChar));
                byte[] bytes = File.ReadAllBytes(path);
                files[index] = new {
                    relativePath,
                    bytes = bytes.LongLength,
                    sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant()
                };
            }
            string graphOutput = JsonSerializer.Serialize(new {
                schema = 2,
                status = "compiled-electron-main-bundle-verified",
                files,
                runtimeImports = new[] {
                    "electron",
                    "node:child_process",
                    "node:fs",
                    "node:path",
                    "node:url"
                }
            });
            string graphOutputOverride = Environment.GetEnvironmentVariable("SHOW_TEST_GRAPH_OUTPUT_OVERRIDE");
            if (!String.IsNullOrWhiteSpace(graphOutputOverride)) {
                graphOutput = File.ReadAllText(graphOutputOverride);
            }
            string sequenceLog = Environment.GetEnvironmentVariable("SHOW_TEST_SEQUENCE_LOG");
            if (!String.IsNullOrWhiteSpace(sequenceLog)) {
                File.AppendAllText(sequenceLog, "graph-verify" + Environment.NewLine);
            }
            Console.Out.WriteLine(graphOutput);
            Console.Out.Flush();
            if (Environment.GetEnvironmentVariable("SHOW_TEST_GRAPH_MUTATION") == "same-size-after-output") {
                string mutationTarget = Environment.GetEnvironmentVariable("SHOW_TEST_GRAPH_MUTATION_TARGET");
                byte[] changedBytes = File.ReadAllBytes(mutationTarget);
                if (changedBytes.Length < 1) return 92;
                changedBytes[0] ^= 0xff;
                File.WriteAllBytes(mutationTarget, changedBytes);
                if (!String.IsNullOrWhiteSpace(sequenceLog)) {
                    File.AppendAllText(sequenceLog, "graph-mutated" + Environment.NewLine);
                }
            }
            ScheduleNodeMutationAfterExit();
            return 0;
        }
        if (arguments[0] != "--version") return 91;
        string behavior = Environment.GetEnvironmentVariable("SHOW_TEST_NODE_BEHAVIOR") ?? "normal";
        if (behavior == "noisy") {
            Console.Out.Write(new string('x', 8192));
            return 0;
        }
        if (behavior == "hang") {
            Thread.Sleep(5000);
            return 0;
        }
        Console.Out.WriteLine(Environment.GetEnvironmentVariable("SHOW_TEST_NODE_VERSION") ?? "v22.23.0");
        return 0;
    }
}
`;
  writeFileSync(
    projectPath,
    [
      '<Project Sdk="Microsoft.NET.Sdk">',
      "  <PropertyGroup>",
      "    <OutputType>Exe</OutputType>",
      "    <TargetFramework>net9.0</TargetFramework>",
      "    <RuntimeIdentifier>win-x64</RuntimeIdentifier>",
      "    <PublishSingleFile>true</PublishSingleFile>",
      "    <SelfContained>false</SelfContained>",
      "    <DebugType>None</DebugType>",
      "  </PropertyGroup>",
      "</Project>",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(join(fakeNodeTemplateRoot, "Program.cs"), source, "utf8");
  const compile = spawnSync(
    "dotnet",
    [
      "publish",
      projectPath,
      "--configuration",
      "Release",
      "--output",
      publishRoot,
      "--nologo",
      "--verbosity",
      "quiet",
      "-p:RestoreIgnoreFailedSources=true",
    ],
    {
      encoding: "utf8",
      timeout: 30_000,
      windowsHide: true,
    },
  );
  if (compile.status !== 0 || !existsSync(fakeNodeTemplate)) {
    throw new Error(`fake Node compilation failed: ${output(compile)}`);
  }
  return fakeNodeTemplate;
}

afterAll(() => {
  if (fakeElectronTemplateRoot !== undefined) {
    rmSync(fakeElectronTemplateRoot, { recursive: true, force: true });
  }
  if (fakeNodeTemplateRoot !== undefined) {
    rmSync(fakeNodeTemplateRoot, { recursive: true, force: true });
  }
});

type ShowMode = "ValidateOnly" | "Soak3" | "Show";
type NetworkPolicy = "OfflineRequired" | "DiagnosticConnected";

interface WatchdogAttemptRecord {
  schema: number;
  runId: string;
  failedControllerRunId: string;
  failedControllerPid: number;
  failedControllerExitCode: number;
  attempt: number;
  delayMs: number;
  observedAtMonotonicMs: number;
}

interface InvocationRecord {
  atMs: number;
  controllerPid: number;
  arguments: string[];
  observedWatchdogAttempts: WatchdogAttemptRecord[];
}

interface LauncherFixture {
  root: string;
  script: string;
  externalRoot: string;
  externalMap: string;
  runId: string;
  invocationLog: string;
  sequenceLog: string;
  closeLog: string;
  closeLifecycleLog: string;
  leaseMutationLog: string;
  inputMutationLog: string;
  launchMutationLog: string;
  parserMutationLog: string;
  parserPackageMutationLog: string;
  parserExecutionLog: string;
  nodeMutationLog: string;
  terminalMarker: string;
  leasePath: string;
  evidencePath: string;
  incidentPath: string;
  watchdogAttempts: string;
  electronCommand: string;
  electronExecutable: string;
  nodeExecutable: string;
  compiledEntry: string;
  graphVerifier: string;
  parserImplementation: string;
  parserPackageManifest: string;
  verifyRuntime: string;
  closeHelper: string;
  showConfig: string;
  poem: string;
  manifest: string;
  contentLock: string;
  contentProfiles: string;
  artifactLock: string;
  janvimExecutable: string;
  checkedInMap: string;
  displayLayout: string;
  cleanup(): void;
}

interface RunOptions {
  additionalNodePath?: string;
  behavior?:
    | "matching-success"
    | "matching-failure"
    | "wrong-marker"
    | "wrong-marker-types"
    | "wrong-marker-identifier-types"
    | "matching-success-no-evidence"
    | "matching-success-wrong-evidence"
    | "matching-success-wrong-display-evidence"
    | "matching-success-wrong-artifact-evidence"
    | "matching-success-wrong-content-evidence"
    | "matching-success-partial-evidence"
    | "crash-then-success"
    | "crash-three-then-success"
    | "crash"
    | "lease-then-success"
    | "marker-and-lease-success"
    | "marker-and-lease-failure"
    | "mismatched-lease"
    | "unprovable-lease"
    | "configuration-required-clean"
    | "configuration-required-terminal"
    | "configuration-required-evidence"
    | "configuration-required-lease"
    | "configuration-required-incident"
    | "configuration-required-watchdog";
  controllerExit?: number;
  controllerOutputBytes?: number;
  closeOutputBytes?: number;
  closeHelperSleepMs?: number;
  closeReceipt?: "valid" | "ownership-false" | "coercible-booleans";
  closeLeaseMutation?: "none" | "attempt-replace";
  inputMutation?: "none" | "attempt-display-map-append";
  launchMutation?:
    | "none"
    | "electron-executable"
    | "node-executable"
    | "electron-main"
    | "graph-verifier"
    | "runtime-verifier"
    | "close-helper"
    | "runtime-core"
    | "display-map"
    | "display-layout"
    | "typescript-parser"
    | "typescript-package-metadata";
  parserMutation?: "none" | "attempt-before-graph-verifier";
  parserPackageMutation?: "none" | "attempt-before-graph-verifier";
  nodeMutation?: "none" | "attempt-after-graph-verifier";
  graphOutput?: string;
  graphMutation?: "none" | "same-size-after-output";
  nodeVersion?: string;
  nodeBehavior?: "normal" | "noisy" | "hang";
  verifyExit?: number;
  routeCount?: number;
  routeCountAfterFirstCheck?: number;
  routeCounts?: readonly number[];
  routeBehavior?: "normal" | "hang";
  routeDestinationPrefix?: string;
  routeInterfaceAlias?: string;
  routeNextHop?: string;
  routeState?: "Alive" | "Dead";
  profileCount?: number;
  profileInterfaceAlias?: string;
  profileIpv4Connectivity?:
    | "Disconnected"
    | "NoTraffic"
    | "Subnet"
    | "LocalNetwork"
    | "Internet";
  profileIpv6Connectivity?:
    | "Disconnected"
    | "NoTraffic"
    | "Subnet"
    | "LocalNetwork"
    | "Internet";
  janvimPid?: number;
  janvimStartedAtUtc?: string;
  janvimExecutableRelativePath?: string;
  janvimExecutableSha256?: string;
  janvimHwnd?: string;
  evidenceUnassignedDisplayCount?: number;
  controllerSleepMs?: number;
  timeoutMs?: number;
}

const fakeElectron = String.raw`
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$RemainingArguments
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$RemainingArguments = @($env:SHOW_TEST_CONTROLLER_ARGUMENTS | ConvertFrom-Json)
$controllerSleepMilliseconds = [int]$env:SHOW_TEST_CONTROLLER_SLEEP_MS
if ($controllerSleepMilliseconds -gt 0) {
    Start-Sleep -Milliseconds $controllerSleepMilliseconds
}

function Get-ShowFlag {
    param([Parameter(Mandatory = $true)][string]$Name)
    $prefix = "--$Name="
    $matches = @($RemainingArguments | Where-Object { $_.StartsWith($prefix, [StringComparison]::Ordinal) })
    if ($matches.Count -ne 1) {
        throw "fake-electron-flag-invalid:$Name"
    }
    return $matches[0].Substring($prefix.Length)
}

$self = Get-CimInstance Win32_Process -Filter "ProcessId=$PID"
$controllerPid = [int]$self.ParentProcessId
$controller = Get-Process -Id $controllerPid -ErrorAction Stop
$controllerStartedAtUtc = $controller.StartTime.ToUniversalTime().ToString('o')
$observedWatchdogAttempts = @()
if (Test-Path -LiteralPath $env:SHOW_TEST_WATCHDOG_ATTEMPTS -PathType Leaf) {
    $journalStream = $null
    $journalReader = $null
    try {
        $journalStream = [IO.File]::Open(
            $env:SHOW_TEST_WATCHDOG_ATTEMPTS,
            [IO.FileMode]::Open,
            [IO.FileAccess]::Read,
            [IO.FileShare]::ReadWrite
        )
        if ($journalStream.Length -gt 4096) {
            throw 'fake-watchdog-attempts-too-large'
        }
        $journalReader = [IO.StreamReader]::new(
            $journalStream,
            [Text.UTF8Encoding]::new($false, $true)
        )
        $journalText = $journalReader.ReadToEnd()
    }
    finally {
        if ($null -ne $journalReader) {
            $journalReader.Dispose()
        }
        elseif ($null -ne $journalStream) {
            $journalStream.Dispose()
        }
    }
    $observedWatchdogAttempts = @(
        $journalText -split '\r?\n' |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
            ForEach-Object { $_ | ConvertFrom-Json -Depth 8 }
    )
}
$record = [ordered]@{
    atMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    controllerPid = $controllerPid
    arguments = @($RemainingArguments)
    observedWatchdogAttempts = @($observedWatchdogAttempts)
}
Add-Content -LiteralPath $env:SHOW_TEST_INVOCATION_LOG -Value ($record | ConvertTo-Json -Compress -Depth 8)
Add-Content -LiteralPath $env:SHOW_TEST_SEQUENCE_LOG -Value 'electron'
$invocationCount = @([IO.File]::ReadAllLines($env:SHOW_TEST_INVOCATION_LOG)).Count
if ($env:SHOW_TEST_LAUNCH_MUTATION -cne 'none' -and $invocationCount -eq 1) {
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = 'pwsh'
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    foreach ($argument in @(
        '-NoProfile',
        '-NonInteractive',
        '-File',
        $env:SHOW_TEST_LAUNCH_MUTATION_HELPER
    )) {
        $startInfo.ArgumentList.Add($argument)
    }
    $mutator = [Diagnostics.Process]::Start($startInfo)
    $mutator.Dispose()
}

$runId = Get-ShowFlag -Name 'run-id'
$controllerRunId = Get-ShowFlag -Name 'controller-run-id'
$rehearsalRoot = Get-ShowFlag -Name 'rehearsal-root'
$terminalPath = Join-Path $rehearsalRoot 'controller-terminal.json'
$leasePath = Join-Path $rehearsalRoot 'run-lease.json'
$evidencePath = Join-Path $rehearsalRoot 'show-run.json'
$incidentPath = Join-Path $rehearsalRoot 'controller-incident.json'
if ($env:SHOW_TEST_INPUT_MUTATION -ceq 'attempt-display-map-append') {
    try {
        [IO.File]::AppendAllText((Get-ShowFlag -Name 'display-map'), ' ')
        Add-Content -LiteralPath $env:SHOW_TEST_INPUT_MUTATION_LOG -Value 'appended'
    }
    catch {
        $leafError = $_.Exception
        while ($null -ne $leafError.InnerException) {
            $leafError = $leafError.InnerException
        }
        $hresult = [uint32]([long]$leafError.HResult -band 0xffffffffL)
        Add-Content -LiteralPath $env:SHOW_TEST_INPUT_MUTATION_LOG -Value ('blocked:{0:X8}' -f $hresult)
    }
}

function Write-TerminalMarker {
    param(
        [Parameter(Mandatory = $true)][int]$ControllerProcessId,
        [Parameter(Mandatory = $true)][string]$Outcome,
        [Parameter(Mandatory = $true)][string]$Reason
    )
    $value = [ordered]@{
        schema = 1
        runId = $runId
        controllerRunId = $controllerRunId
        controllerPid = $ControllerProcessId
        outcome = $Outcome
        reason = $Reason
    }
    [IO.File]::WriteAllText($terminalPath, (($value | ConvertTo-Json -Depth 8) + [Environment]::NewLine))
}

function Get-LegacyDisplayGeometrySha256 {
    param([Parameter(Mandatory = $true)][pscustomobject]$Display)

    $bounds = $Display.bounds
    $displayIdJson = ConvertTo-Json -Compress -InputObject ([string]$Display.displayId)
    $scaleText = ([double]$Display.scaleFactor).ToString(
        'R',
        [Globalization.CultureInfo]::InvariantCulture
    ).ToLowerInvariant()
    $scaleText = $scaleText -replace 'e\+', 'e'
    $scaleText = $scaleText -replace 'e(-?)0+([0-9]+)$', 'e$1$2'
    $canonical = '[{0},{1},{2},{3},{4},{5}]' -f @(
        $displayIdJson,
        [long]$bounds.x,
        [long]$bounds.y,
        [long]$bounds.width,
        [long]$bounds.height,
        $scaleText
    )
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($canonical)
        return [Convert]::ToHexString($sha256.ComputeHash($bytes)).ToLowerInvariant()
    }
    finally {
        $sha256.Dispose()
    }
}

function New-CompatibilityDisplayEvidence {
    param([Parameter(Mandatory = $true)][pscustomobject]$Display)

    return [ordered]@{
        id = $Display.displayId
        bounds = $Display.bounds
        workingArea = $Display.workingArea
        scaleFactor = $Display.scaleFactor
        rotation = $Display.rotation
        geometrySha256 = Get-LegacyDisplayGeometrySha256 -Display $Display
    }
}

function Write-ShowEvidence {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('none', 'controller', 'display', 'artifact', 'content', 'partial')]
        [string]$Mutation
    )

    $showMode = Get-ShowFlag -Name 'show-mode'
    if ($showMode -ceq 'validateonly') {
        return
    }
    $repositoryRoot = $env:SHOW_TEST_REPOSITORY_ROOT
    $displayMapPath = Get-ShowFlag -Name 'display-map'
    $lockPath = Join-Path $repositoryRoot 'janvim-artifact.lock.json'
    $manifestPath = Join-Path $repositoryRoot 'content\fixture\show.manifest.json'
    $poemPath = Join-Path $repositoryRoot 'content\fixture\poem.txt'
    $configPath = Join-Path $repositoryRoot 'show\janvim-show.toml'
    $lock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $displayMap = Get-Content -LiteralPath $displayMapPath -Raw | ConvertFrom-Json
    $emptyLatency = [ordered]@{ count = 0; p50Ms = $null; p95Ms = $null; maxMs = $null }
    $emptyScalar = [ordered]@{ count = 0; min = $null; max = $null; final = $null }
    $emptyProcess = [ordered]@{ rssBytes = $emptyScalar; handleCount = $emptyScalar }
    $emptyResources = [ordered]@{
        controller = $emptyProcess
        renderer = $emptyProcess
        janvim = $emptyProcess
        sampleIncomplete = $true
    }
    $emptyCounts = [ordered]@{ listeners = 0; timers = 0; connections = 0; pendingCommands = 0 }
    $poemHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $poemPath).Hash.ToLowerInvariant()
    $loops = @()
    $offlineSnapshots = @(
        [ordered]@{
            sampledAtMs = 0
            activeExternalDefaultRoutes = 0
            connectedExternalProfiles = 0
            offline = $true
        }
    )
    if ($showMode -ceq 'soak3') {
        $loops = @(1..3 | ForEach-Object {
            $index = $_
            [ordered]@{
                loopId = "$runId-loop-$index"
                startedAtMs = ($index - 1) * 90000
                endedAtMs = $index * 90000
                dispatchedCueCount = 0
                completedPrimaryCueCount = 0
                presentedSecondaryCueCount = 0
                secondaryPresentLatencyMs = $emptyLatency
                primaryCompletionLatencyMs = $emptyLatency
                primaryInstantAckLatencyMs = $emptyLatency
                primaryInsertOverheadMs = $emptyLatency
                finalVisibleDriftMs = 0
                resetBufferSha256 = $poemHash
                tickLatenessMs = 0
                advanceOverrunMs = 0
                generationId = 1
                retryCount = 0
                skipCount = 0
                recoveryCount = 0
                resources = $emptyResources
                countsAtStart = $emptyCounts
                countsAtEnd = $emptyCounts
            }
        })
        $offlineSnapshots = @(0, 90000, 180000, 270000, 270100 | ForEach-Object {
            [ordered]@{
                sampledAtMs = $_
                activeExternalDefaultRoutes = 0
                connectedExternalProfiles = 0
                offline = $true
            }
        })
    }
    $completedLoops = if ($showMode -ceq 'soak3') { 3 } else { 0 }
    $offlineSampleCount = if ($showMode -ceq 'soak3') { 5 } else { 1 }
    $displayMapSha256 = if ($Mutation -ceq 'display') {
        '0' * 64
    }
    else {
        (Get-FileHash -Algorithm SHA256 -LiteralPath $displayMapPath).Hash.ToLowerInvariant()
    }
    $routing = $null
    if ([long]$displayMap.schema -eq 2) {
        $softIds = if ($displayMap.mode -ceq 'production-3') {
            @('SCREEN-1', 'SCREEN-2', 'SCREEN-3')
        }
        else {
            @('SCREEN-1')
        }
        $selectedRoles = @($softIds | ForEach-Object {
            $softId = $_
            $matches = @($displayMap.bindings | Where-Object { $_.softId -ceq $softId })
            if ($matches.Count -ne 1) {
                throw 'fake-schema2-binding-invalid'
            }
            $binding = $matches[0]
            [ordered]@{
                softId = $binding.softId
                displayId = $binding.displayId
                bounds = $binding.bounds
                workingArea = $binding.workingArea
                scaleFactor = $binding.scaleFactor
                rotation = $binding.rotation
                geometrySha256 = $binding.geometrySha256
            }
        })
        $primaryBinding = @($displayMap.bindings | Where-Object { $_.softId -ceq 'SCREEN-1' })[0]
        $display = [ordered]@{
            mapSha256 = $displayMapSha256
            primary = New-CompatibilityDisplayEvidence -Display $primaryBinding
        }
        if ($displayMap.mode -ceq 'production-3') {
            $secondaryBinding = @($displayMap.bindings | Where-Object { $_.softId -ceq 'SCREEN-2' })[0]
            $display.secondary = New-CompatibilityDisplayEvidence -Display $secondaryBinding
        }
        [string[]]$skippedRoleValues = @()
        if ($displayMap.mode -ceq 'single-display-preview') {
            $skippedRoleValues = @('SCREEN-2', 'SCREEN-3')
        }
        $routing = [ordered]@{
            mode = $displayMap.mode
            layoutSha256 = $displayMap.layoutSha256
            mapSha256 = $displayMapSha256
            topologySha256 = $displayMap.topologySha256
            selectedRoles = $selectedRoles
            skippedRoles = $skippedRoleValues
            unassignedDisplayCount = if ([string]::IsNullOrWhiteSpace($env:SHOW_TEST_EVIDENCE_UNASSIGNED_COUNT)) {
                @($displayMap.unassignedDisplays).Count
            }
            else {
                [int]$env:SHOW_TEST_EVIDENCE_UNASSIGNED_COUNT
            }
            standbyUsed = $displayMap.mode -ceq 'production-3'
            topologyStopped = $false
        }
        $acceptanceScope = if ($displayMap.mode -ceq 'single-display-preview') {
            'single-display-preview'
        }
        else {
            'monitor-simulation'
        }
    }
    else {
        $display = [ordered]@{
            mapSha256 = $displayMapSha256
            primary = [ordered]@{
                id = $displayMap.primary.displayId
                bounds = $displayMap.primary.bounds
                workingArea = $displayMap.primary.bounds
                scaleFactor = $displayMap.primary.scaleFactor
                rotation = 0
                geometrySha256 = $displayMap.primary.geometrySha256
            }
            secondary = [ordered]@{
                id = $displayMap.secondary.displayId
                bounds = $displayMap.secondary.bounds
                workingArea = $displayMap.secondary.bounds
                scaleFactor = $displayMap.secondary.scaleFactor
                rotation = 0
                geometrySha256 = $displayMap.secondary.geometrySha256
            }
        }
        $acceptanceScope = 'monitor-simulation'
    }
    $evidence = [ordered]@{
        schema = 2
        runId = $runId
        controllerRunId = if ($Mutation -ceq 'controller') { 'wrong-controller-run' } else { $controllerRunId }
        mode = if ($showMode -ceq 'show') { 'Show' } else { 'Soak3' }
        acceptanceScope = $acceptanceScope
        physicalProjectorsTested = $false
        display = $display
        artifact = [ordered]@{
            tag = $lock.tag
            commit = $lock.commit
            layoutEngine = $lock.layoutEngine
            lockSha256 = if ($Mutation -ceq 'artifact') { '1' * 64 } else { (Get-FileHash -Algorithm SHA256 -LiteralPath $lockPath).Hash.ToLowerInvariant() }
            coreBytes = $lock.coreBytes
            coreSha256 = $lock.coreSha256
        }
        content = [ordered]@{
            revision = $manifest.contentRevision
            manifestBytes = (Get-Item -LiteralPath $manifestPath).Length
            manifestSha256 = if ($Mutation -ceq 'content') { '2' * 64 } else { (Get-FileHash -Algorithm SHA256 -LiteralPath $manifestPath).Hash.ToLowerInvariant() }
            poemBytes = (Get-Item -LiteralPath $poemPath).Length
            poemSha256 = $poemHash
            configSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $configPath).Hash.ToLowerInvariant()
            mediaManifest = [ordered]@{ present = $false }
        }
        offlineSnapshots = $offlineSnapshots
        offlineVerified = $showMode -ceq 'soak3'
        loops = $loops
        aggregate = [ordered]@{
            completedLoops = $completedLoops
            offlineSampleCount = $offlineSampleCount
            onlineSampleCount = 0
            resourceIncompleteLoopCount = if ($showMode -ceq 'soak3') { 3 } else { 0 }
            runtimeCountGrowthLoopCount = 0
            totalRetries = 0
            totalSkips = 0
            totalRecoveries = 0
            cumulativeVisibleDriftMs = 0
            secondaryPresentLatencyMs = $emptyLatency
            primaryCompletionLatencyMs = $emptyLatency
            primaryInstantAckLatencyMs = $emptyLatency
            primaryInsertOverheadMs = $emptyLatency
            acceptanceOutcome = if ($showMode -ceq 'show') { 'diagnostic' } else { 'fail' }
        }
        recoveries = @()
        shutdown = [ordered]@{
            requestedBy = if ($showMode -ceq 'show') { 'operator-stop' } else { 'soak-complete' }
            agentShutdown = 'acknowledged'
            hwndClose = 'posted'
            janvimExit = 'natural'
            bridgeClose = 'closed'
            leaseRemoved = $true
        }
        loggingIncomplete = $false
        operatorNotes = @()
    }
    if ($null -ne $routing) {
        $evidence.routing = $routing
    }
    if ($Mutation -ceq 'partial') {
        $evidence.Remove('shutdown')
    }
    [IO.File]::WriteAllText($evidencePath, (($evidence | ConvertTo-Json -Depth 8) + [Environment]::NewLine))
}

function Write-RunLease {
    param(
        [Parameter(Mandatory = $true)][bool]$Mismatch,
        [Parameter(Mandatory = $true)][bool]$Unprovable
    )
    $pidValue = if ($Unprovable) { 2147483000 } else { [int]$env:SHOW_TEST_JANVIM_PID }
    $startedValue = if ($Mismatch) {
        ([DateTimeOffset]::Parse($env:SHOW_TEST_JANVIM_STARTED_AT_UTC)).UtcDateTime.AddTicks(1).ToString('o')
    }
    else {
        $env:SHOW_TEST_JANVIM_STARTED_AT_UTC
    }
    $lease = [ordered]@{
        schema = 1
        runId = $runId
        controllerRunId = $controllerRunId
        generationId = 1
        controller = [ordered]@{
            pid = $controllerPid
            startedAtUtc = $controllerStartedAtUtc
        }
        janvim = [ordered]@{
            pid = $pidValue
            startedAtUtc = $startedValue
            hwnd = $env:SHOW_TEST_JANVIM_HWND
            executableRelativePath = $env:SHOW_TEST_JANVIM_EXECUTABLE_RELATIVE_PATH
            executableSha256 = $env:SHOW_TEST_JANVIM_EXECUTABLE_SHA256
        }
    }
    [IO.File]::WriteAllText($leasePath, (($lease | ConvertTo-Json -Depth 8) + [Environment]::NewLine))
}

$behavior = [string]$env:SHOW_TEST_BEHAVIOR
switch ($behavior) {
    'matching-success' {
        Write-ShowEvidence -Mutation 'none'
        Write-TerminalMarker -ControllerProcessId $controllerPid -Outcome 'intentional-success' -Reason 'operator-stop'
        exit 0
    }
    'matching-failure' {
        Write-ShowEvidence -Mutation 'none'
        Write-TerminalMarker -ControllerProcessId $controllerPid -Outcome 'intentional-failure' -Reason 'startup-failed'
        exit 7
    }
    'matching-success-no-evidence' {
        Write-TerminalMarker -ControllerProcessId $controllerPid -Outcome 'intentional-success' -Reason 'operator-stop'
        exit 0
    }
    'matching-success-wrong-evidence' {
        Write-ShowEvidence -Mutation 'controller'
        Write-TerminalMarker -ControllerProcessId $controllerPid -Outcome 'intentional-success' -Reason 'operator-stop'
        exit 0
    }
    'matching-success-wrong-display-evidence' {
        Write-ShowEvidence -Mutation 'display'
        Write-TerminalMarker -ControllerProcessId $controllerPid -Outcome 'intentional-success' -Reason 'operator-stop'
        exit 0
    }
    'matching-success-wrong-artifact-evidence' {
        Write-ShowEvidence -Mutation 'artifact'
        Write-TerminalMarker -ControllerProcessId $controllerPid -Outcome 'intentional-success' -Reason 'operator-stop'
        exit 0
    }
    'matching-success-wrong-content-evidence' {
        Write-ShowEvidence -Mutation 'content'
        Write-TerminalMarker -ControllerProcessId $controllerPid -Outcome 'intentional-success' -Reason 'operator-stop'
        exit 0
    }
    'matching-success-partial-evidence' {
        Write-ShowEvidence -Mutation 'partial'
        Write-TerminalMarker -ControllerProcessId $controllerPid -Outcome 'intentional-success' -Reason 'operator-stop'
        exit 0
    }
    'wrong-marker' {
        Write-TerminalMarker -ControllerProcessId ($controllerPid + 1) -Outcome 'intentional-success' -Reason 'operator-stop'
        exit 0
    }
    'wrong-marker-types' {
        $value = [ordered]@{
            schema = '1'
            runId = $runId
            controllerRunId = $controllerRunId
            controllerPid = [string]$controllerPid
            outcome = 'intentional-success'
            reason = 'operator-stop'
        }
        [IO.File]::WriteAllText($terminalPath, (($value | ConvertTo-Json -Depth 8) + [Environment]::NewLine))
        exit 0
    }
    'wrong-marker-identifier-types' {
        Write-ShowEvidence -Mutation 'none'
        $value = [ordered]@{
            schema = 1
            runId = @($runId)
            controllerRunId = @($controllerRunId)
            controllerPid = $controllerPid
            outcome = 'intentional-success'
            reason = 'operator-stop'
        }
        [IO.File]::WriteAllText($terminalPath, (($value | ConvertTo-Json -Depth 8) + [Environment]::NewLine))
        exit 0
    }
    'lease-then-success' {
        if ($invocationCount -eq 1) {
            Write-RunLease -Mismatch $false -Unprovable $false
            exit 9
        }
        Write-ShowEvidence -Mutation 'none'
        Write-TerminalMarker -ControllerProcessId $controllerPid -Outcome 'intentional-success' -Reason 'operator-stop'
        exit 0
    }
    'crash-then-success' {
        if ($invocationCount -eq 1) {
            exit 9
        }
        Write-ShowEvidence -Mutation 'none'
        Write-TerminalMarker -ControllerProcessId $controllerPid -Outcome 'intentional-success' -Reason 'operator-stop'
        exit 0
    }
    'crash-three-then-success' {
        if ($invocationCount -le 3) {
            exit 9
        }
        Write-ShowEvidence -Mutation 'none'
        Write-TerminalMarker -ControllerProcessId $controllerPid -Outcome 'intentional-success' -Reason 'operator-stop'
        exit 0
    }
    'marker-and-lease-success' {
        Write-RunLease -Mismatch $false -Unprovable $false
        Write-TerminalMarker -ControllerProcessId $controllerPid -Outcome 'intentional-success' -Reason 'operator-stop'
        exit 0
    }
    'marker-and-lease-failure' {
        Write-RunLease -Mismatch $false -Unprovable $false
        Write-TerminalMarker -ControllerProcessId $controllerPid -Outcome 'intentional-failure' -Reason 'startup-failed'
        exit 7
    }
    'mismatched-lease' {
        Write-RunLease -Mismatch $true -Unprovable $false
        exit 9
    }
    'unprovable-lease' {
        Write-RunLease -Mismatch $false -Unprovable $true
        exit 9
    }
    'configuration-required-clean' {
        exit 2
    }
    'configuration-required-terminal' {
        Write-TerminalMarker -ControllerProcessId $controllerPid -Outcome 'intentional-failure' -Reason 'display-configuration-required'
        exit 2
    }
    'configuration-required-evidence' {
        Write-ShowEvidence -Mutation 'none'
        exit 2
    }
    'configuration-required-lease' {
        Write-RunLease -Mismatch $false -Unprovable $true
        exit 2
    }
    'configuration-required-incident' {
        [IO.File]::WriteAllText($incidentPath, '{"schema":1}' + [Environment]::NewLine)
        exit 2
    }
    'configuration-required-watchdog' {
        [IO.File]::WriteAllText($env:SHOW_TEST_WATCHDOG_ATTEMPTS, '{"schema":1}' + [Environment]::NewLine)
        exit 2
    }
    default {
        exit [int]$env:SHOW_TEST_CONTROLLER_EXIT
    }
}
`;

const fakeLaunchMutationHelper = String.raw`
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Start-Sleep -Milliseconds 500
$replacement = "$($env:SHOW_TEST_LAUNCH_MUTATION_TARGET).changed-$PID"
try {
    [IO.File]::Copy($env:SHOW_TEST_LAUNCH_MUTATION_TARGET, $replacement, $false)
    [IO.File]::AppendAllText(
        $replacement,
        ([Environment]::NewLine + 'changed-launch-bytes' + [Environment]::NewLine)
    )
    [IO.File]::Move($replacement, $env:SHOW_TEST_LAUNCH_MUTATION_TARGET, $true)
    Add-Content -LiteralPath $env:SHOW_TEST_LAUNCH_MUTATION_LOG -Value 'replaced'
}
catch {
    if (Test-Path -LiteralPath $replacement -PathType Leaf) {
        [IO.File]::Delete($replacement)
    }
    $leafError = $_.Exception
    while ($null -ne $leafError.InnerException) {
        $leafError = $leafError.InnerException
    }
    $hresult = [uint32]([long]$leafError.HResult -band 0xffffffffL)
    Add-Content -LiteralPath $env:SHOW_TEST_LAUNCH_MUTATION_LOG -Value ('blocked:{0:X8}' -f $hresult)
}
`;

const fakeNodeMutationHelper = String.raw`
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][int]$ParentProcessId,
    [Parameter(Mandatory = $true)][string]$Target,
    [Parameter(Mandatory = $true)][string]$Log
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Wait-Process -Id $ParentProcessId -Timeout 5 -ErrorAction SilentlyContinue
$replacement = "$Target.changed-$PID"
try {
    [IO.File]::Copy($Target, $replacement, $false)
    [IO.File]::AppendAllText(
        $replacement,
        ([Environment]::NewLine + 'changed-node-bytes' + [Environment]::NewLine)
    )
    [IO.File]::Move($replacement, $Target, $true)
    Add-Content -LiteralPath $Log -Value 'replaced'
}
catch {
    if (Test-Path -LiteralPath $replacement -PathType Leaf) {
        [IO.File]::Delete($replacement)
    }
    $leafError = $_.Exception
    while ($null -ne $leafError.InnerException) {
        $leafError = $leafError.InnerException
    }
    $hresult = [uint32]([long]$leafError.HResult -band 0xffffffffL)
    Add-Content -LiteralPath $Log -Value ('blocked:{0:X8}' -f $hresult)
}
`;

const fakeCloseHelper = String.raw`
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][int]$ChildProcessId,
    [Parameter(Mandatory = $true)][string]$Hwnd
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$record = [ordered]@{ pid = $ChildProcessId; hwnd = $Hwnd }
Add-Content -LiteralPath $env:SHOW_TEST_CLOSE_LOG -Value ($record | ConvertTo-Json -Compress)
$started = [ordered]@{
    event = 'started'
    atMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
}
Add-Content -LiteralPath $env:SHOW_TEST_CLOSE_LIFECYCLE_LOG -Value ($started | ConvertTo-Json -Compress)
$sleepMilliseconds = [int]$env:SHOW_TEST_CLOSE_HELPER_SLEEP_MS
if ($sleepMilliseconds -gt 0) {
    Start-Sleep -Milliseconds $sleepMilliseconds
}
$completed = [ordered]@{
    event = 'completed'
    atMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
}
Add-Content -LiteralPath $env:SHOW_TEST_CLOSE_LIFECYCLE_LOG -Value ($completed | ConvertTo-Json -Compress)
if ($env:SHOW_TEST_CLOSE_LEASE_MUTATION -eq 'attempt-replace') {
    try {
        [IO.File]::WriteAllText($env:SHOW_TEST_LEASE_PATH, '{"schema":0}')
        Add-Content -LiteralPath $env:SHOW_TEST_LEASE_MUTATION_LOG -Value 'replaced'
    }
    catch {
        $leafError = $_.Exception
        while ($null -ne $leafError.InnerException) {
            $leafError = $leafError.InnerException
        }
        $hresult = [uint32]([long]$leafError.HResult -band 0xffffffffL)
        Add-Content -LiteralPath $env:SHOW_TEST_LEASE_MUTATION_LOG -Value ('blocked:{0:X8}' -f $hresult)
    }
}
$outputBytes = [int]$env:SHOW_TEST_CLOSE_OUTPUT_BYTES
if ($outputBytes -gt 0) {
    [Console]::Out.Write(('x' * $outputBytes))
    exit 0
}
$coercibleBooleans = $env:SHOW_TEST_CLOSE_RECEIPT -eq 'coercible-booleans'
$receipt = [ordered]@{
    schema = 1
    pid = $ChildProcessId
    hwnd = $Hwnd
    ownershipVerified = if ($coercibleBooleans) { 1 } else { $env:SHOW_TEST_CLOSE_RECEIPT -ne 'ownership-false' }
    topLevel = if ($coercibleBooleans) { 'true' } else { $true }
    closePosted = if ($coercibleBooleans) { 1 } else { $true }
}
$receipt | ConvertTo-Json -Compress
`;

const fakeNetTcpIpModule = String.raw`
function Get-NetRoute {
    [CmdletBinding()]
    param([string]$DestinationPrefix, [string]$AddressFamily)
    Add-Content -LiteralPath $env:SHOW_TEST_SEQUENCE_LOG -Value 'net-route'
    if ($env:SHOW_TEST_ROUTE_BEHAVIOR -ceq 'hang') {
        Start-Sleep -Seconds 30
    }
    $routeCalls = @([IO.File]::ReadAllLines($env:SHOW_TEST_SEQUENCE_LOG) | Where-Object { $_ -eq 'net-route' }).Count
    $counts = @($env:SHOW_TEST_ROUTE_COUNTS | ConvertFrom-Json)
    $countIndex = [Math]::Min($routeCalls - 1, $counts.Count - 1)
    $count = [int]$counts[$countIndex]
    for ($index = 1; $index -le $count; $index++) {
        [pscustomobject]@{
            DestinationPrefix = $env:SHOW_TEST_ROUTE_DESTINATION_PREFIX
            NextHop = $env:SHOW_TEST_ROUTE_NEXT_HOP
            InterfaceAlias = $env:SHOW_TEST_ROUTE_INTERFACE_ALIAS
            State = $env:SHOW_TEST_ROUTE_STATE
        }
    }
}
Export-ModuleMember -Function Get-NetRoute
`;

const fakeNetConnectionModule = String.raw`
function Get-NetConnectionProfile {
    [CmdletBinding()]
    param()
    Add-Content -LiteralPath $env:SHOW_TEST_SEQUENCE_LOG -Value 'net-profile'
    $count = [int]$env:SHOW_TEST_PROFILE_COUNT
    for ($index = 1; $index -le $count; $index++) {
        [pscustomobject]@{
            InterfaceAlias = $env:SHOW_TEST_PROFILE_INTERFACE_ALIAS
            IPv4Connectivity = $env:SHOW_TEST_PROFILE_IPV4_CONNECTIVITY
            IPv6Connectivity = $env:SHOW_TEST_PROFILE_IPV6_CONNECTIVITY
        }
    }
}
Export-ModuleMember -Function Get-NetConnectionProfile
`;

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function confirmedDisplayMap(): {
  schema: number;
  mappingStatus: string;
  expectedDisplayCount: number;
  primary: {
    displayId: string;
    bounds: { x: number; y: number; width: number; height: number };
    scaleFactor: number;
    geometrySha256: string;
  };
  secondary: {
    displayId: string;
    bounds: { x: number; y: number; width: number; height: number };
    scaleFactor: number;
    geometrySha256: string;
  };
} {
  return {
    schema: 1,
    mappingStatus: "confirmed",
    expectedDisplayCount: 2,
    primary: {
      displayId: "engineering-projector",
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      scaleFactor: 1,
      geometrySha256:
        "ed24f468fe1ffa1ac164127498b7cb1c07a9c7d4b99252b6e9b2f64a0a156492",
    },
    secondary: {
      displayId: "nut-projector",
      bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
      scaleFactor: 1,
      geometrySha256:
        "5e96e591638bf441176bd640064a390a07f71cce65b439bdd27152cd7d1209e6",
    },
  };
}

type Schema2PhysicalDisplay = {
  displayId: string;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  workingArea: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  rotation: 0 | 90 | 180 | 270;
  geometrySha256: string;
};

type Schema2DisplayMapFixture = {
  schema: number;
  mappingStatus: string;
  mode: "production-3" | "single-display-preview";
  layoutSha256: string;
  capturedAtUtc: string;
  topologySha256: string;
  bindings: Array<Schema2PhysicalDisplay & { softId: string }>;
  unassignedDisplays: Schema2PhysicalDisplay[];
};

function schema2PhysicalDisplay(
  displayId: string,
  label: string,
  x: number,
  scaleFactor = 1,
  rotation: 0 | 90 | 180 | 270 = 0,
): Schema2PhysicalDisplay {
  const display = {
    displayId,
    label,
    bounds: { x, y: 0, width: 1920, height: 1080 },
    workingArea: { x, y: 0, width: 1920, height: 1040 },
    scaleFactor,
    rotation,
  };
  return { ...display, geometrySha256: hashDisplayGeometryV2(display) };
}

function schema2DisplayMap(
  displayLayoutPath: string,
  mode: "production-3" | "single-display-preview" = "production-3",
): Schema2DisplayMapFixture {
  const physical = [
    schema2PhysicalDisplay("display-A", "Projector A", 0),
    schema2PhysicalDisplay("display-B", "Projector B", 1920, 1.25, 90),
    schema2PhysicalDisplay("display-C", "Projector C", 3840, 1, 180),
  ];
  const bindings = (mode === "production-3" ? physical : physical.slice(0, 1)).map(
    (display, index) => ({ ...display, softId: `SCREEN-${index + 1}` }),
  );
  const unassignedDisplays =
    mode === "production-3"
      ? [schema2PhysicalDisplay("display-Z", "Operator monitor", 5760, 1.5, 270)]
      : [];
  return {
    schema: 2,
    mappingStatus: "confirmed",
    mode,
    layoutSha256: sha256(displayLayoutPath),
    capturedAtUtc: "2026-09-04T00:00:00.000Z",
    topologySha256: hashDisplayTopology([...bindings, ...unassignedDisplays]),
    bindings,
    unassignedDisplays,
  };
}

function writeText(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, "utf8");
}

function copyFixtureFile(sourceRelative: string, root: string): string {
  const source = join(repositoryRoot, sourceRelative);
  const destination = join(root, sourceRelative);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  return destination;
}

function patchCopiedLauncherReleaseIdentity(
  script: string,
  compiledEntry: string,
): void {
  const source = readFileSync(script, "utf8");
  const start = source.indexOf(reviewedElectronReleaseIdentityStart);
  const end = source.indexOf(reviewedElectronReleaseIdentityEnd);
  if (start < 0 || end < 0) return;
  if (
    start !== source.lastIndexOf(reviewedElectronReleaseIdentityStart) ||
    end !== source.lastIndexOf(reviewedElectronReleaseIdentityEnd) ||
    end <= start
  ) {
    throw new Error("launcher release identity markers are ambiguous");
  }
  const replacement = [
    reviewedElectronReleaseIdentityStart,
    "$reviewedElectronMainRelativePath = 'apps/controller/dist/main/electron-main.js'",
    `$reviewedElectronMainBytes = ${statSync(compiledEntry).size}L`,
    `$reviewedElectronMainSha256 = '${sha256(compiledEntry)}'`,
    "$reviewedElectronMainRuntimeImports = @(",
    ...launcherFixtureRuntimeImports.map((specifier) => `    '${specifier}'`),
    ")",
    reviewedElectronReleaseIdentityEnd,
  ].join("\r\n");
  writeText(
    script,
    source.slice(0, start) +
      replacement +
      source.slice(end + reviewedElectronReleaseIdentityEnd.length),
  );
}

function patchCopiedContentLockIdentity(script: string, contentLock: string): void {
  const source = readFileSync(script, "utf8");
  const bytes = statSync(contentLock).size;
  const digest = sha256(contentLock);
  const changed = source
    .replace(/\$expectedContentLockBytes\s*=\s*\d+L/u, `$expectedContentLockBytes = ${bytes}L`)
    .replace(
      /\$expectedContentLockSha256\s*=\s*'[0-9a-f]{64}'/u,
      `$expectedContentLockSha256 = '${digest}'`,
    );
  if (changed === source) throw new Error("fixture content lock identity was not patched");
  writeText(script, changed);
}

function makeLauncherFixture(): LauncherFixture {
  if (!existsSync(productionScript)) {
    throw new Error(`production launcher missing: ${productionScript}`);
  }
  const root = mkdtempSync(join(tmpdir(), "janvim show launcher-"));
  const runId = `show-launcher-${randomUUID()}`;
  const externalRoot = win32.join(rehearsalParent, runId);
  const externalMap = win32.join(externalRoot, "display-map.json");
  const script = join(root, "scripts", "start-show.ps1");
  const invocationLog = join(root, "electron-invocations.ndjson");
  const sequenceLog = join(root, "sequence.log");
  const closeLog = join(root, "close-invocations.ndjson");
  const closeLifecycleLog = join(root, "close-lifecycle.ndjson");
  const leaseMutationLog = join(root, "lease-mutation.log");
  const inputMutationLog = join(root, "input-mutation.log");
  const launchMutationLog = join(root, "launch-mutation.log");
  const parserMutationLog = join(root, "parser-mutation.log");
  const parserPackageMutationLog = join(root, "parser-package-mutation.log");
  const parserExecutionLog = join(root, "parser-execution.log");
  const nodeMutationLog = join(root, "node-mutation.log");
  const terminalMarker = win32.join(externalRoot, "controller-terminal.json");
  const leasePath = win32.join(externalRoot, "run-lease.json");
  const evidencePath = win32.join(externalRoot, "show-run.json");
  const incidentPath = win32.join(externalRoot, "controller-incident.json");
  const watchdogAttempts = win32.join(externalRoot, "watchdog-attempts.jsonl");
  const electronCommand = join(root, "node_modules", ".bin", "electron.cmd");
  const electronExecutable = join(
    root,
    "node_modules",
    "electron",
    "dist",
    "electron.exe",
  );
  const nodeExecutable = join(root, "bin", "node.exe");
  const compiledEntry = join(
    root,
    "apps",
    "controller",
    "dist",
    "main",
    "electron-main.js",
  );
  const graphVerifier = join(root, "scripts", "verify-electron-module-graph.mjs");
  const parserImplementation = join(
    root,
    "node_modules",
    "typescript",
    "lib",
    "typescript.js",
  );
  const parserPackageManifest = join(
    root,
    "node_modules",
    "typescript",
    "package.json",
  );
  const verifyRuntime = join(root, "scripts", "verify-runtime.ps1");
  const closeHelper = join(root, "scripts", "close-janvim-window.ps1");
  const checkedInMap = join(root, "show", "display-map.json");
  const janvimExecutable = join(root, "runtime", "janvim", "janvim-core.exe");

  for (const directory of [
    dirname(script),
    dirname(electronCommand),
    dirname(electronExecutable),
    dirname(compiledEntry),
    dirname(janvimExecutable),
    join(root, "bin"),
    join(root, "psmodules", "NetTCPIP"),
    join(root, "psmodules", "NetConnection"),
  ]) {
    mkdirSync(directory, { recursive: true });
  }
  copyFileSync(productionScript, script);
  writeText(join(root, "AGENTS.md"), "# JanVim Exhibition 2026 agent instructions\n");
  writeText(janvimExecutable, "immutable fake runtime payload\n");
  writeText(checkedInMap, '{"schema":1,"mappingStatus":"unconfirmed"}\n');
  const showConfig = copyFixtureFile("show/janvim-show.toml", root);
  const displayLayout = copyFixtureFile("show/display-layout.json", root);
  const poem = copyFixtureFile("content/fixture/poem.txt", root);
  const manifest = copyFixtureFile("content/fixture/show.manifest.json", root);
  const contentLock = copyFixtureFile("content/p0.1/content-lock.json", root);
  const contentProfiles = join(root, "content", "p0.1", "profiles");
  cpSync(join(repositoryRoot, "content", "p0.1", "profiles"), contentProfiles, {
    recursive: true,
  });
  copyFixtureFile("runtime/user-root/plugin-lab/config/init.lua", root);
  const artifactLock = copyFixtureFile("janvim-artifact.lock.json", root);
  copyFixtureFile("scripts/verify-electron-module-graph.mjs", root);
  writeText(
    parserPackageManifest,
    `${JSON.stringify(
      {
        name: "typescript-launcher-fixture",
        version: "6.0.3-fixture",
        type: "commonjs",
        fixtureIdentity: "original",
      },
      null,
      2,
    )}\n`,
  );
  writeText(
    parserImplementation,
    [
      'const { appendFileSync } = require("node:fs");',
      'appendFileSync(process.env.SHOW_TEST_PARSER_EXECUTION_LOG, "original\\n");',
      'appendFileSync(process.env.SHOW_TEST_SEQUENCE_LOG, "parser-executed:original\\n");',
      'module.exports = Object.freeze({ fixtureIdentity: "original" });',
      "",
    ].join("\n"),
  );
  const fixtureLock = JSON.parse(
    readFileSync(artifactLock, "utf8"),
  ) as Record<string, unknown>;
  fixtureLock.coreBytes = statSync(janvimExecutable).size;
  fixtureLock.coreSha256 = sha256(janvimExecutable);
  writeText(artifactLock, `${JSON.stringify(fixtureLock, null, 2)}\n`);

  writeText(
    verifyRuntime,
    [
      "$ErrorActionPreference = 'Stop'",
      "Add-Content -LiteralPath $env:SHOW_TEST_SEQUENCE_LOG -Value 'verify'",
      "exit [int]$env:SHOW_TEST_VERIFY_EXIT",
      "",
    ].join("\r\n"),
  );
  writeText(
    electronCommand,
    [
      "@echo off",
      'echo electron-wrapper>>"%SHOW_TEST_SEQUENCE_LOG%"',
      "exit /b 97",
      "",
    ].join("\r\n"),
  );
  linkSync(fakeElectronExecutableTemplate(), electronExecutable);
  copyFixtureFile("apps/controller/package.json", root);
  writeText(
    compiledEntry,
    [
      'import { spawnSync } from "node:child_process";',
      'import { appendFileSync } from "node:fs";',
      'import { join } from "node:path";',
      'import { fileURLToPath } from "node:url";',
      'const controllerDirectory = fileURLToPath(new URL(".", import.meta.url));',
      "const controllerOutputBytes = Number(process.env.SHOW_TEST_CONTROLLER_OUTPUT_BYTES ?? 0);",
      "if (controllerOutputBytes > 0) {",
      '  process.stdout.write("o".repeat(controllerOutputBytes));',
      '  process.stderr.write("e".repeat(controllerOutputBytes));',
      "}",
      "const result = spawnSync(",
      '  "pwsh",',
      "  [",
      '    "-NoProfile",',
      '    "-NonInteractive",',
      '    "-File",',
      '    join(controllerDirectory, "..", "..", "..", "..", "node_modules", ".bin", "fake-electron.ps1"),',
      "  ],",
      "  {",
      '    encoding: "utf8",',
      "    env: {",
      "      ...process.env,",
      "      SHOW_TEST_CONTROLLER_ARGUMENTS: JSON.stringify(process.argv.slice(2)),",
      "    },",
      "    windowsHide: true,",
      "  },",
      ");",
      "if (result.error !== undefined) {",
      '  appendFileSync(process.env.SHOW_TEST_SEQUENCE_LOG, `fake-error:${result.error.message}\\n`);',
      "}",
      "if (result.stderr) {",
      '  appendFileSync(process.env.SHOW_TEST_SEQUENCE_LOG, `fake-stderr:${result.stderr.replace(/\\r?\\n/g, " | ")}\\n`);',
      "}",
      "process.exit(result.status ?? 98);",
      "",
    ].join("\n"),
  );
  patchCopiedLauncherReleaseIdentity(script, compiledEntry);
  writeText(join(root, "node_modules", ".bin", "fake-electron.ps1"), fakeElectron);
  writeText(closeHelper, fakeCloseHelper);
  writeText(
    join(root, "scripts", "attempt-launch-mutation.ps1"),
    fakeLaunchMutationHelper,
  );
  writeText(
    join(root, "scripts", "attempt-node-mutation.ps1"),
    fakeNodeMutationHelper,
  );
  copyFileSync(fakeNodeExecutableTemplate(), nodeExecutable);
  writeText(
    join(root, "psmodules", "NetTCPIP", "NetTCPIP.psm1"),
    fakeNetTcpIpModule,
  );
  writeText(
    join(root, "psmodules", "NetTCPIP", "NetTCPIP.psd1"),
    "@{ RootModule='NetTCPIP.psm1'; ModuleVersion='999.0.0'; FunctionsToExport=@('Get-NetRoute') }\n",
  );
  writeText(
    join(root, "psmodules", "NetConnection", "NetConnection.psm1"),
    fakeNetConnectionModule,
  );
  writeText(
    join(root, "psmodules", "NetConnection", "NetConnection.psd1"),
    "@{ RootModule='NetConnection.psm1'; ModuleVersion='999.0.0'; FunctionsToExport=@('Get-NetConnectionProfile') }\n",
  );
  mkdirSync(externalRoot, { recursive: false });
  writeText(externalMap, `${JSON.stringify(confirmedDisplayMap(), null, 2)}\n`);

  return {
    root,
    script,
    externalRoot,
    externalMap,
    runId,
    invocationLog,
    sequenceLog,
    closeLog,
    closeLifecycleLog,
    leaseMutationLog,
    inputMutationLog,
    launchMutationLog,
    parserMutationLog,
    parserPackageMutationLog,
    parserExecutionLog,
    nodeMutationLog,
    terminalMarker,
    leasePath,
    evidencePath,
    incidentPath,
    watchdogAttempts,
    electronCommand,
    electronExecutable,
    nodeExecutable,
    compiledEntry,
    graphVerifier,
    parserImplementation,
    parserPackageManifest,
    verifyRuntime,
    closeHelper,
    showConfig,
    poem,
    manifest,
    contentLock,
    contentProfiles,
    artifactLock,
    janvimExecutable,
    checkedInMap,
    displayLayout,
    cleanup: () => {
      if (
        win32.dirname(externalRoot).toLowerCase() !==
        rehearsalParent.toLowerCase()
      ) {
        throw new Error("refusing to clean unexpected rehearsal path");
      }
      rmSync(externalRoot, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function launcherArguments(
  fixture: LauncherFixture,
  mode: ShowMode,
  networkPolicy: NetworkPolicy = "OfflineRequired",
): string[] {
  return [
    "-Mode",
    mode,
    "-RehearsalRoot",
    fixture.externalRoot,
    "-DisplayMapPath",
    fixture.externalMap,
    "-RunId",
    fixture.runId,
    "-NetworkPolicy",
    networkPolicy,
  ];
}

function runLauncher(
  fixture: LauncherFixture,
  args: readonly string[],
  options: RunOptions = {},
): SpawnSyncReturns<string> {
  const inheritedModulePath = Object.entries(process.env).find(
    ([name]) => name.toLowerCase() === "psmodulepath",
  )?.[1];
  const modulePath = [
    join(fixture.root, "psmodules"),
    inheritedModulePath ?? "",
  ].filter(Boolean).join(";");
  const childEnvironment = { ...process.env };
  for (const name of Object.keys(childEnvironment)) {
    if (name.toLowerCase() === "psmodulepath") delete childEnvironment[name];
    if (name.toLowerCase() === "path") delete childEnvironment[name];
  }
  childEnvironment.PSModulePath = modulePath;
  const executableExtensions = [
    "",
    ...(process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
      .split(";")
      .filter(Boolean),
  ];
  const inheritedPathWithoutNode = (process.env.PATH ?? "")
    .split(";")
    .filter(Boolean)
    .filter((pathEntry) => {
      const directory = pathEntry.replace(/^"|"$/gu, "");
      return !executableExtensions.some((extension) =>
        existsSync(join(directory, `node${extension}`)),
      );
    });
  childEnvironment.PATH = [
    dirname(fixture.nodeExecutable),
    options.additionalNodePath,
    ...inheritedPathWithoutNode,
  ].filter((value): value is string => Boolean(value)).join(";");
  const launchMutation = options.launchMutation ?? "none";
  const launchMutationTarget = {
    none: fixture.compiledEntry,
    "electron-executable": fixture.electronExecutable,
    "node-executable": fixture.nodeExecutable,
    "electron-main": fixture.compiledEntry,
    "graph-verifier": fixture.graphVerifier,
    "runtime-verifier": fixture.verifyRuntime,
    "close-helper": fixture.closeHelper,
    "runtime-core": fixture.janvimExecutable,
    "display-map": fixture.externalMap,
    "display-layout": fixture.displayLayout,
    "typescript-parser": fixture.parserImplementation,
    "typescript-package-metadata": fixture.parserPackageManifest,
  }[launchMutation];
  const graphOutputOverride = join(fixture.root, "graph-output-override.json");
  if (options.graphOutput !== undefined) {
    writeText(graphOutputOverride, options.graphOutput);
  }
  return spawnSync(
    "pwsh",
    ["-NoProfile", "-NonInteractive", "-File", fixture.script, ...args],
    {
      cwd: fixture.root,
      encoding: "utf8",
      timeout: options.timeoutMs ?? 15_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      env: {
        ...childEnvironment,
        SHOW_TEST_BEHAVIOR: options.behavior ?? "crash",
        SHOW_TEST_REPOSITORY_ROOT: fixture.root,
        SHOW_TEST_CLOSE_OUTPUT_BYTES: String(options.closeOutputBytes ?? 0),
        SHOW_TEST_CLOSE_HELPER_SLEEP_MS: String(
          options.closeHelperSleepMs ?? 0,
        ),
        SHOW_TEST_CLOSE_RECEIPT: options.closeReceipt ?? "valid",
        SHOW_TEST_CLOSE_LEASE_MUTATION:
          options.closeLeaseMutation ?? "none",
        SHOW_TEST_INPUT_MUTATION: options.inputMutation ?? "none",
        SHOW_TEST_INPUT_MUTATION_LOG: fixture.inputMutationLog,
        SHOW_TEST_LAUNCH_MUTATION: launchMutation,
        SHOW_TEST_LAUNCH_MUTATION_TARGET: launchMutationTarget,
        SHOW_TEST_LAUNCH_MUTATION_LOG: fixture.launchMutationLog,
        SHOW_TEST_LAUNCH_MUTATION_HELPER: join(
          fixture.root,
          "scripts",
          "attempt-launch-mutation.ps1",
        ),
        SHOW_TEST_GRAPH_OUTPUT_OVERRIDE:
          options.graphOutput === undefined ? "" : graphOutputOverride,
        SHOW_TEST_GRAPH_MUTATION: options.graphMutation ?? "none",
        SHOW_TEST_GRAPH_MUTATION_TARGET: fixture.compiledEntry,
        SHOW_TEST_NODE_MUTATION: options.nodeMutation ?? "none",
        SHOW_TEST_NODE_MUTATION_HELPER: join(
          fixture.root,
          "scripts",
          "attempt-node-mutation.ps1",
        ),
        SHOW_TEST_NODE_MUTATION_LOG: fixture.nodeMutationLog,
        SHOW_TEST_PARSER_MUTATION: options.parserMutation ?? "none",
        SHOW_TEST_PARSER_IMPLEMENTATION: fixture.parserImplementation,
        SHOW_TEST_PARSER_MUTATION_LOG: fixture.parserMutationLog,
        SHOW_TEST_PARSER_PACKAGE_MUTATION:
          options.parserPackageMutation ?? "none",
        SHOW_TEST_PARSER_PACKAGE_MANIFEST: fixture.parserPackageManifest,
        SHOW_TEST_PARSER_PACKAGE_MUTATION_LOG:
          fixture.parserPackageMutationLog,
        SHOW_TEST_PARSER_EXECUTION_LOG: fixture.parserExecutionLog,
        SHOW_TEST_REAL_NODE: process.execPath,
        SHOW_TEST_CONTROLLER_EXIT: String(options.controllerExit ?? 9),
        SHOW_TEST_CONTROLLER_OUTPUT_BYTES: String(
          options.controllerOutputBytes ?? 0,
        ),
        SHOW_TEST_CONTROLLER_SLEEP_MS: String(options.controllerSleepMs ?? 0),
        SHOW_TEST_NODE_VERSION: options.nodeVersion ?? "v22.23.0",
        SHOW_TEST_NODE_BEHAVIOR: options.nodeBehavior ?? "normal",
        SHOW_TEST_VERIFY_EXIT: String(options.verifyExit ?? 0),
        SHOW_TEST_ROUTE_COUNT: String(options.routeCount ?? 0),
        SHOW_TEST_ROUTE_COUNT_AFTER_FIRST_CHECK: String(
          options.routeCountAfterFirstCheck ?? options.routeCount ?? 0,
        ),
        SHOW_TEST_ROUTE_COUNTS: JSON.stringify(
          options.routeCounts ?? [
            options.routeCount ?? 0,
            options.routeCountAfterFirstCheck ?? options.routeCount ?? 0,
          ],
        ),
        SHOW_TEST_ROUTE_BEHAVIOR: options.routeBehavior ?? "normal",
        SHOW_TEST_ROUTE_DESTINATION_PREFIX:
          options.routeDestinationPrefix ?? "0.0.0.0/0",
        SHOW_TEST_ROUTE_INTERFACE_ALIAS:
          options.routeInterfaceAlias ?? "Ethernet",
        SHOW_TEST_ROUTE_NEXT_HOP: options.routeNextHop ?? "10.0.0.1",
        SHOW_TEST_ROUTE_STATE: options.routeState ?? "Alive",
        SHOW_TEST_PROFILE_COUNT: String(options.profileCount ?? 0),
        SHOW_TEST_PROFILE_INTERFACE_ALIAS:
          options.profileInterfaceAlias ?? "Ethernet",
        SHOW_TEST_PROFILE_IPV4_CONNECTIVITY:
          options.profileIpv4Connectivity ?? "Internet",
        SHOW_TEST_PROFILE_IPV6_CONNECTIVITY:
          options.profileIpv6Connectivity ?? "NoTraffic",
        SHOW_TEST_INVOCATION_LOG: fixture.invocationLog,
        SHOW_TEST_SEQUENCE_LOG: fixture.sequenceLog,
        SHOW_TEST_CLOSE_LOG: fixture.closeLog,
        SHOW_TEST_CLOSE_LIFECYCLE_LOG: fixture.closeLifecycleLog,
        SHOW_TEST_WATCHDOG_ATTEMPTS: fixture.watchdogAttempts,
        SHOW_TEST_LEASE_PATH: fixture.leasePath,
        SHOW_TEST_LEASE_MUTATION_LOG: fixture.leaseMutationLog,
        SHOW_TEST_JANVIM_PID: String(options.janvimPid ?? 2147483000),
        SHOW_TEST_JANVIM_STARTED_AT_UTC:
          options.janvimStartedAtUtc ?? "2026-08-30T00:00:00.5000000Z",
        SHOW_TEST_JANVIM_EXECUTABLE_RELATIVE_PATH:
          options.janvimExecutableRelativePath ?? "janvim-core.exe",
        SHOW_TEST_JANVIM_EXECUTABLE_SHA256:
          options.janvimExecutableSha256 ?? "0".repeat(64),
        SHOW_TEST_JANVIM_HWND:
          options.janvimHwnd ?? "0x0000000000001234",
        SHOW_TEST_EVIDENCE_UNASSIGNED_COUNT:
          options.evidenceUnassignedDisplayCount === undefined
            ? ""
            : String(options.evidenceUnassignedDisplayCount),
      },
    },
  );
}

function invocations(fixture: LauncherFixture): InvocationRecord[] {
  if (!existsSync(fixture.invocationLog)) return [];
  return readFileSync(fixture.invocationLog, "utf8")
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as InvocationRecord);
}

function watchdogAttemptRecords(
  fixture: LauncherFixture,
): WatchdogAttemptRecord[] {
  if (!existsSync(fixture.watchdogAttempts)) return [];
  return readFileSync(fixture.watchdogAttempts, "utf8")
    .split(/\r?\n/u)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as WatchdogAttemptRecord);
}

function closeLifecycleRecords(
  fixture: LauncherFixture,
): Array<{ event: string; atMs: number }> {
  if (!existsSync(fixture.closeLifecycleLog)) return [];
  return readFileSync(fixture.closeLifecycleLog, "utf8")
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { event: string; atMs: number });
}

function flag(arguments_: readonly string[], name: string): string {
  const prefix = `--${name}=`;
  const matches = arguments_.filter((value) => value.startsWith(prefix));
  if (matches.length !== 1) throw new Error(`flag ${name} count ${matches.length}`);
  return matches[0]!.slice(prefix.length);
}

function output(result: SpawnSyncReturns<string>): string {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

interface GraphFileRecord {
  relativePath: string;
  bytes: number;
  sha256: string;
}

interface GraphManifest {
  schema: number;
  status: string;
  files: GraphFileRecord[];
  runtimeImports: string[];
}

function graphFileRecord(path: string, relativePath: string): GraphFileRecord {
  return {
    relativePath,
    bytes: statSync(path).size,
    sha256: sha256(path),
  };
}

function validGraphManifest(fixture: LauncherFixture): GraphManifest {
  return {
    schema: 2,
    status: "compiled-electron-main-bundle-verified",
    files: [
      graphFileRecord(
        fixture.compiledEntry,
        "apps/controller/dist/main/electron-main.js",
      ),
    ],
    runtimeImports: [...launcherFixtureRuntimeImports],
  };
}

function changedGraphOutput(
  fixture: LauncherFixture,
  change: (manifest: GraphManifest) => unknown,
): string {
  return JSON.stringify(change(validGraphManifest(fixture)));
}

function rawGraphManifestParts(fixture: LauncherFixture): {
  file: GraphFileRecord;
  runtimeImports: string;
} {
  const manifest = validGraphManifest(fixture);
  return {
    file: manifest.files[0]!,
    runtimeImports: JSON.stringify(manifest.runtimeImports),
  };
}

const duplicateGraphOutputCases = [
  {
    label: "duplicate top-level schema",
    output: (fixture: LauncherFixture) => {
      const { file, runtimeImports } = rawGraphManifestParts(fixture);
      return `{"schema":2,"schema":2,"status":"compiled-electron-main-bundle-verified","files":[${JSON.stringify(file)}],"runtimeImports":${runtimeImports}}`;
    },
  },
  {
    label: "duplicate nested file hash",
    output: (fixture: LauncherFixture) => {
      const { file, runtimeImports } = rawGraphManifestParts(fixture);
      return `{"schema":2,"status":"compiled-electron-main-bundle-verified","files":[{"relativePath":${JSON.stringify(file.relativePath)},"bytes":${file.bytes},"sha256":${JSON.stringify(file.sha256)},"sha256":${JSON.stringify(file.sha256)}}],"runtimeImports":${runtimeImports}}`;
    },
  },
  {
    label: "duplicate top-level runtime imports",
    output: (fixture: LauncherFixture) => {
      const { file, runtimeImports } = rawGraphManifestParts(fixture);
      return `{"schema":2,"status":"compiled-electron-main-bundle-verified","files":[${JSON.stringify(file)}],"runtimeImports":${runtimeImports},"runtimeImports":${runtimeImports}}`;
    },
  },
] as const;

interface InvalidGraphOutputCase {
  label: string;
  reason:
    | "electron-module-graph-invalid"
    | "electron-module-release-identity-mismatch";
  output(fixture: LauncherFixture): string;
}

const invalidGraphOutputCases: readonly InvalidGraphOutputCase[] = [
  {
    label: "malformed JSON",
    reason: "electron-module-graph-invalid",
    output: () => '{"schema":',
  },
  {
    label: "non-object top level",
    reason: "electron-module-graph-invalid",
    output: () => "[]",
  },
  {
    label: "missing top-level field",
    reason: "electron-module-graph-invalid",
    output: (fixture) =>
      changedGraphOutput(fixture, ({ schema: _schema, ...manifest }) => manifest),
  },
  {
    label: "extra top-level field",
    reason: "electron-module-graph-invalid",
    output: (fixture) =>
      changedGraphOutput(fixture, (manifest) => ({ ...manifest, extra: true })),
  },
  {
    label: "string schema",
    reason: "electron-module-graph-invalid",
    output: (fixture) =>
      changedGraphOutput(fixture, (manifest) => ({ ...manifest, schema: "1" })),
  },
  {
    label: "wrong schema",
    reason: "electron-module-graph-invalid",
    output: (fixture) =>
      changedGraphOutput(fixture, (manifest) => ({ ...manifest, schema: 1 })),
  },
  {
    label: "non-string status",
    reason: "electron-module-graph-invalid",
    output: (fixture) =>
      changedGraphOutput(fixture, (manifest) => ({ ...manifest, status: 1 })),
  },
  {
    label: "wrong status",
    reason: "electron-module-graph-invalid",
    output: (fixture) =>
      changedGraphOutput(fixture, (manifest) => ({ ...manifest, status: "wrong" })),
  },
  {
    label: "non-array files",
    reason: "electron-module-graph-invalid",
    output: (fixture) =>
      changedGraphOutput(fixture, (manifest) => ({
        ...manifest,
        files: manifest.files[0],
      })),
  },
  {
    label: "non-object file",
    reason: "electron-module-graph-invalid",
    output: (fixture) =>
      changedGraphOutput(fixture, (manifest) => ({ ...manifest, files: [1] })),
  },
  {
    label: "missing file field",
    reason: "electron-module-graph-invalid",
    output: (fixture) =>
      changedGraphOutput(fixture, (manifest) => {
        const { sha256: _sha256, ...file } = manifest.files[0]!;
        return { ...manifest, files: [file, ...manifest.files.slice(1)] };
      }),
  },
  {
    label: "extra file field",
    reason: "electron-module-graph-invalid",
    output: (fixture) =>
      changedGraphOutput(fixture, (manifest) => ({
        ...manifest,
        files: [{ ...manifest.files[0]!, extra: true }, ...manifest.files.slice(1)],
      })),
  },
  {
    label: "non-string relative path",
    reason: "electron-module-graph-invalid",
    output: (fixture) =>
      changedGraphOutput(fixture, (manifest) => ({
        ...manifest,
        files: [
          { ...manifest.files[0]!, relativePath: 1 },
          ...manifest.files.slice(1),
        ],
      })),
  },
  {
    label: "path escape",
    reason: "electron-module-graph-invalid",
    output: (fixture) => {
      const escaped = join(fixture.root, "escaped.js");
      writeText(escaped, "export const escaped = true;\n");
      return changedGraphOutput(fixture, (manifest) => ({
        ...manifest,
        files: [
          graphFileRecord(
            escaped,
            "apps/controller/dist/src/../../../../escaped.js",
          ),
          ...manifest.files,
        ],
      }));
    },
  },
  {
    label: "non-canonical relative spelling",
    reason: "electron-module-graph-invalid",
    output: (fixture) =>
      changedGraphOutput(fixture, (manifest) => ({
        ...manifest,
        files: [
          {
            ...manifest.files[0]!,
            relativePath: "apps/controller/dist/src/./electron-main.js",
          },
          ...manifest.files.slice(1),
        ],
      })),
  },
  {
    label: "unsupported local extension",
    reason: "electron-module-graph-invalid",
    output: (fixture) => {
      const unsupported = join(
        fixture.root,
        "apps",
        "controller",
        "dist",
        "src",
        "unsupported.ts",
      );
      writeText(unsupported, "export const unsupported = true;\n");
      return changedGraphOutput(fixture, (manifest) => ({
        ...manifest,
        files: [
          manifest.files[0]!,
          manifest.files[2]!,
          graphFileRecord(
            unsupported,
            "apps/controller/dist/main/unsupported.ts",
          ),
        ],
      }));
    },
  },
  {
    label: "missing local file",
    reason: "electron-module-graph-invalid",
    output: (fixture) =>
      changedGraphOutput(fixture, (manifest) => ({
        ...manifest,
        files: [
          manifest.files[0]!,
          {
            relativePath: "apps/controller/dist/src/missing.js",
            bytes: 1,
            sha256: "a".repeat(64),
          },
          manifest.files[2]!,
        ],
      })),
  },
  {
    label: "unsorted files",
    reason: "electron-module-graph-invalid",
    output: (fixture) =>
      changedGraphOutput(fixture, (manifest) => ({
        ...manifest,
        files: [manifest.files[1]!, manifest.files[0]!, manifest.files[2]!],
      })),
  },
  {
    label: "duplicate path",
    reason: "electron-module-graph-invalid",
    output: (fixture) =>
      changedGraphOutput(fixture, (manifest) => ({
        ...manifest,
        files: [manifest.files[0]!, manifest.files[0]!, manifest.files[2]!],
      })),
  },
  {
    label: "zero files",
    reason: "electron-module-graph-invalid",
    output: (fixture) =>
      changedGraphOutput(fixture, (manifest) => ({ ...manifest, files: [] })),
  },
  {
    label: "257 files",
    reason: "electron-module-graph-invalid",
    output: (fixture) =>
      changedGraphOutput(fixture, (manifest) => ({
        ...manifest,
        files: Array.from({ length: 257 }, () => manifest.files[0]!),
      })),
  },
  {
    label: "string bytes",
    reason: "electron-module-graph-invalid",
    output: (fixture) =>
      changedGraphOutput(fixture, (manifest) => ({
        ...manifest,
        files: [
          { ...manifest.files[0]!, bytes: String(manifest.files[0]!.bytes) },
          ...manifest.files.slice(1),
        ],
      })),
  },
  {
    label: "zero bytes",
    reason: "electron-module-graph-invalid",
    output: (fixture) =>
      changedGraphOutput(fixture, (manifest) => ({
        ...manifest,
        files: [{ ...manifest.files[0]!, bytes: 0 }, ...manifest.files.slice(1)],
      })),
  },
  {
    label: "fractional bytes",
    reason: "electron-module-graph-invalid",
    output: (fixture) =>
      changedGraphOutput(fixture, (manifest) => ({
        ...manifest,
        files: [{ ...manifest.files[0]!, bytes: 1.5 }, ...manifest.files.slice(1)],
      })),
  },
  {
    label: "oversized bytes",
    reason: "electron-module-graph-invalid",
    output: (fixture) =>
      changedGraphOutput(fixture, (manifest) => ({
        ...manifest,
        files: [
          { ...manifest.files[0]!, bytes: 16 * 1024 * 1024 + 1 },
          ...manifest.files.slice(1),
        ],
      })),
  },
  {
    label: "non-string hash",
    reason: "electron-module-graph-invalid",
    output: (fixture) =>
      changedGraphOutput(fixture, (manifest) => ({
        ...manifest,
        files: [{ ...manifest.files[0]!, sha256: 1 }, ...manifest.files.slice(1)],
      })),
  },
  {
    label: "uppercase hash",
    reason: "electron-module-graph-invalid",
    output: (fixture) =>
      changedGraphOutput(fixture, (manifest) => ({
        ...manifest,
        files: [
          { ...manifest.files[0]!, sha256: manifest.files[0]!.sha256.toUpperCase() },
          ...manifest.files.slice(1),
        ],
      })),
  },
  {
    label: "wrong byte count",
    reason: "electron-module-release-identity-mismatch",
    output: (fixture) =>
      changedGraphOutput(fixture, (manifest) => ({
        ...manifest,
        files: [
          { ...manifest.files[0]!, bytes: manifest.files[0]!.bytes + 1 },
          ...manifest.files.slice(1),
        ],
      })),
  },
  {
    label: "wrong hash",
    reason: "electron-module-release-identity-mismatch",
    output: (fixture) =>
      changedGraphOutput(fixture, (manifest) => ({
        ...manifest,
        files: [
          { ...manifest.files[0]!, sha256: "0".repeat(64) },
          ...manifest.files.slice(1),
        ],
      })),
  },
  {
    label: "missing electron entry",
    reason: "electron-module-graph-invalid",
    output: (fixture) =>
      changedGraphOutput(fixture, (manifest) => ({
        ...manifest,
        files: manifest.files.slice(1),
      })),
  },
  {
    label: "missing runtime imports",
    reason: "electron-module-graph-invalid",
    output: (fixture) =>
      changedGraphOutput(
        fixture,
        ({ runtimeImports: _runtimeImports, ...manifest }) => manifest,
      ),
  },
  {
    label: "non-array runtime imports",
    reason: "electron-module-graph-invalid",
    output: (fixture) =>
      changedGraphOutput(fixture, (manifest) => ({
        ...manifest,
        runtimeImports: "electron",
      })),
  },
  {
    label: "empty runtime imports",
    reason: "electron-module-graph-invalid",
    output: (fixture) =>
      changedGraphOutput(fixture, (manifest) => ({
        ...manifest,
        runtimeImports: [],
      })),
  },
  {
    label: "unsorted runtime imports",
    reason: "electron-module-graph-invalid",
    output: (fixture) =>
      changedGraphOutput(fixture, (manifest) => ({
        ...manifest,
        runtimeImports: ["node:fs", "electron"],
      })),
  },
  {
    label: "duplicate runtime import",
    reason: "electron-module-graph-invalid",
    output: (fixture) =>
      changedGraphOutput(fixture, (manifest) => ({
        ...manifest,
        runtimeImports: ["electron", "electron"],
      })),
  },
  {
    label: "unsupported runtime import",
    reason: "electron-module-graph-invalid",
    output: (fixture) =>
      changedGraphOutput(fixture, (manifest) => ({
        ...manifest,
        runtimeImports: ["electron", "zod"],
      })),
  },
];

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = (): void => {
      clearTimeout(timeout);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

async function cleanupWhenUnlocked(
  fixture: LauncherFixture,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      fixture.cleanup();
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EBUSY" || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function startFakeJanVim(fixture: LauncherFixture): Promise<{
  child: ChildProcess;
  pid: number;
  startedAtUtc: string;
  executableSha256: string;
}> {
  copyFileSync("C:\\Windows\\System32\\PING.EXE", fixture.janvimExecutable);
  const executableSha256 = sha256(fixture.janvimExecutable);
  const lock = JSON.parse(
    readFileSync(fixture.artifactLock, "utf8"),
  ) as Record<string, unknown>;
  lock.coreBytes = statSync(fixture.janvimExecutable).size;
  lock.coreSha256 = executableSha256;
  writeText(fixture.artifactLock, `${JSON.stringify(lock, null, 2)}\n`);

  const child = spawn(
    fixture.janvimExecutable,
    ["-n", "30", "127.0.0.1"],
    { stdio: "ignore", windowsHide: true },
  );
  if (child.pid === undefined) throw new Error("fake JanVim PID unavailable");
  const probe = spawnSync(
    "pwsh",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$p=Get-Process -Id ${child.pid} -ErrorAction Stop;[ordered]@{startedAtUtc=$p.StartTime.ToUniversalTime().ToString('o');path=$p.Path}|ConvertTo-Json -Compress`,
    ],
    { encoding: "utf8", timeout: 5_000, windowsHide: true },
  );
  if (probe.status !== 0) {
    child.kill();
    throw new Error(`fake JanVim probe failed: ${output(probe)}`);
  }
  const identity = JSON.parse(probe.stdout.trim()) as {
    startedAtUtc: string;
    path: string;
  };
  expect(win32.resolve(identity.path).toLowerCase()).toBe(
    win32.resolve(fixture.janvimExecutable).toLowerCase(),
  );
  return {
    child,
    pid: child.pid,
    startedAtUtc: identity.startedAtUtc,
    executableSha256,
  };
}

describe("offline show launcher and external watchdog", () => {
  it.each(["production-3", "single-display-preview"] as const)(
    "accepts an independently validated schema-2 %s map",
    (mode) => {
      const fixture = makeLauncherFixture();
      try {
        writeText(
          fixture.externalMap,
          `${JSON.stringify(schema2DisplayMap(fixture.displayLayout, mode), null, 2)}\n`,
        );
        const result = runLauncher(
          fixture,
          launcherArguments(fixture, "ValidateOnly"),
          { behavior: "matching-success" },
        );

        expect(result.status, output(result)).toBe(0);
        expect(invocations(fixture)).toHaveLength(1);
      } finally {
        fixture.cleanup();
      }
    },
    30_000,
  );

  it("accepts bounded current unassigned-display evidence independently of captured extras", () => {
    const fixture = makeLauncherFixture();
    try {
      writeText(
        fixture.externalMap,
        `${JSON.stringify(schema2DisplayMap(fixture.displayLayout), null, 2)}\n`,
      );
      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "Show"),
        {
          behavior: "matching-success",
          evidenceUnassignedDisplayCount: 0,
        },
      );

      expect(result.status, output(result)).toBe(0);
      expect(invocations(fixture)).toHaveLength(1);
      const evidence = JSON.parse(
        readFileSync(fixture.evidencePath, "utf8"),
      ) as { routing: { unassignedDisplayCount: number } };
      expect(evidence.routing.unassignedDisplayCount).toBe(0);
    } finally {
      fixture.cleanup();
    }
  }, 30_000);

  it.each(["ValidateOnly", "Show"] as const)(
    "preserves one clean controller exit 2 as configuration-required in %s",
    (mode) => {
      const fixture = makeLauncherFixture();
      try {
        writeText(
          fixture.externalMap,
          `${JSON.stringify(schema2DisplayMap(fixture.displayLayout), null, 2)}\n`,
        );
        const result = runLauncher(fixture, launcherArguments(fixture, mode), {
          behavior: "configuration-required-clean",
          timeoutMs: 15_000,
        });
        const receipt = JSON.parse(
          result.stdout.trim().split(/\r?\n/u).at(-1) ?? "{}",
        ) as Record<string, unknown>;

        expect(result.status, output(result)).toBe(2);
        expect(invocations(fixture)).toHaveLength(1);
        expect(receipt).toMatchObject({
          schema: 1,
          mode,
          runId: fixture.runId,
          exitCode: 2,
          termination: "configuration-required",
        });
        for (const path of [
          fixture.terminalMarker,
          fixture.evidencePath,
          fixture.leasePath,
          fixture.incidentPath,
          fixture.watchdogAttempts,
        ]) {
          expect(existsSync(path), path).toBe(false);
        }
      } finally {
        fixture.cleanup();
      }
    },
    30_000,
  );

  it.each([
    ["terminal", "configuration-required-terminal"],
    ["evidence", "configuration-required-evidence"],
    ["lease", "configuration-required-lease"],
    ["incident", "configuration-required-incident"],
    ["watchdog", "configuration-required-watchdog"],
  ] as const)(
    "converts dirty configuration-required exit 2 with %s state into integrity exit 70",
    (_state, behavior) => {
      const fixture = makeLauncherFixture();
      try {
        const result = runLauncher(
          fixture,
          launcherArguments(fixture, "Show"),
          { behavior, timeoutMs: 15_000 },
        );

        expect(result.status, output(result)).toBe(70);
        expect(invocations(fixture)).toHaveLength(1);
      } finally {
        fixture.cleanup();
      }
    },
    30_000,
  );

  it("rejects duplicate properties and every bounded schema-2 map contract before Electron", () => {
    const cases: Array<{
      name: string;
      mutate: (fixture: LauncherFixture, map: Schema2DisplayMapFixture) => void;
    }> = [
      {
        name: "duplicate JSON property",
        mutate: (fixture, map) => {
          const text = JSON.stringify(map).replace('{"schema":2', '{"schema":2,"schema":2');
          writeText(fixture.externalMap, `${text}\n`);
        },
      },
      {
        name: "unknown field",
        mutate: (fixture, map) => {
          writeText(fixture.externalMap, `${JSON.stringify({ ...map, extra: true })}\n`);
        },
      },
      {
        name: "UTF-8 display ID cap",
        mutate: (fixture, map) => {
          map.bindings[0]!.displayId = "界".repeat(86);
          writeText(fixture.externalMap, `${JSON.stringify(map)}\n`);
        },
      },
      {
        name: "UTF-8 label cap",
        mutate: (fixture, map) => {
          map.bindings[0]!.label = "界".repeat(171);
          writeText(fixture.externalMap, `${JSON.stringify(map)}\n`);
        },
      },
      {
        name: "unsafe rectangle",
        mutate: (fixture, map) => {
          map.bindings[0]!.bounds.x = Number.MAX_SAFE_INTEGER + 1;
          writeText(fixture.externalMap, `${JSON.stringify(map)}\n`);
        },
      },
      {
        name: "invalid scale",
        mutate: (fixture, map) => {
          map.bindings[0]!.scaleFactor = 0;
          writeText(fixture.externalMap, `${JSON.stringify(map)}\n`);
        },
      },
      {
        name: "invalid rotation",
        mutate: (fixture, map) => {
          map.bindings[0]!.rotation = 45 as 0;
          writeText(fixture.externalMap, `${JSON.stringify(map)}\n`);
        },
      },
      {
        name: "more than sixteen displays",
        mutate: (fixture, map) => {
          map.unassignedDisplays = Array.from({ length: 14 }, (_, index) =>
            schema2PhysicalDisplay(`extra-${index}`, `Extra ${index}`, 6000 + index * 100),
          );
          writeText(fixture.externalMap, `${JSON.stringify(map)}\n`);
        },
      },
      {
        name: "duplicate active role",
        mutate: (fixture, map) => {
          map.bindings[1]!.softId = "SCREEN-1";
          writeText(fixture.externalMap, `${JSON.stringify(map)}\n`);
        },
      },
      {
        name: "duplicate physical display",
        mutate: (fixture, map) => {
          map.bindings[1]!.displayId = map.bindings[0]!.displayId;
          writeText(fixture.externalMap, `${JSON.stringify(map)}\n`);
        },
      },
      {
        name: "wrong mode cardinality",
        mutate: (fixture, map) => {
          map.bindings.pop();
          writeText(fixture.externalMap, `${JSON.stringify(map)}\n`);
        },
      },
      {
        name: "wrong layout hash",
        mutate: (fixture, map) => {
          map.layoutSha256 = "0".repeat(64);
          writeText(fixture.externalMap, `${JSON.stringify(map)}\n`);
        },
      },
      {
        name: "wrong geometry hash",
        mutate: (fixture, map) => {
          map.bindings[0]!.geometrySha256 = "0".repeat(64);
          writeText(fixture.externalMap, `${JSON.stringify(map)}\n`);
        },
      },
      {
        name: "wrong topology hash",
        mutate: (fixture, map) => {
          map.topologySha256 = "0".repeat(64);
          writeText(fixture.externalMap, `${JSON.stringify(map)}\n`);
        },
      },
      {
        name: "scalar layout roles",
        mutate: (fixture, map) => {
          const layout = JSON.parse(readFileSync(fixture.displayLayout, "utf8")) as Record<string, unknown>;
          layout.roles = (layout.roles as unknown[])[0];
          writeText(fixture.displayLayout, `${JSON.stringify(layout)}\n`);
          map.layoutSha256 = sha256(fixture.displayLayout);
          writeText(fixture.externalMap, `${JSON.stringify(map)}\n`);
        },
      },
      {
        name: "scalar layout modes",
        mutate: (fixture, map) => {
          const layout = JSON.parse(readFileSync(fixture.displayLayout, "utf8")) as Record<string, unknown>;
          layout.modes = (layout.modes as unknown[])[0];
          writeText(fixture.displayLayout, `${JSON.stringify(layout)}\n`);
          map.layoutSha256 = sha256(fixture.displayLayout);
          writeText(fixture.externalMap, `${JSON.stringify(map)}\n`);
        },
      },
      {
        name: "scalar layout active roles",
        mutate: (fixture, map) => {
          const layout = JSON.parse(readFileSync(fixture.displayLayout, "utf8")) as {
            modes: Array<Record<string, unknown>>;
          };
          layout.modes[0]!.activeRoles = "SCREEN-1,SCREEN-2,SCREEN-3";
          writeText(fixture.displayLayout, `${JSON.stringify(layout)}\n`);
          map.layoutSha256 = sha256(fixture.displayLayout);
          writeText(fixture.externalMap, `${JSON.stringify(map)}\n`);
        },
      },
      {
        name: "scalar layout skipped roles",
        mutate: (fixture, map) => {
          const layout = JSON.parse(readFileSync(fixture.displayLayout, "utf8")) as {
            modes: Array<Record<string, unknown>>;
          };
          layout.modes[1]!.skippedRoles = "SCREEN-2,SCREEN-3";
          writeText(fixture.displayLayout, `${JSON.stringify(layout)}\n`);
          map.layoutSha256 = sha256(fixture.displayLayout);
          writeText(fixture.externalMap, `${JSON.stringify(map)}\n`);
        },
      },
      {
        name: "scalar map bindings",
        mutate: (fixture, map) => {
          writeText(
            fixture.externalMap,
            `${JSON.stringify({ ...map, bindings: map.bindings[0] })}\n`,
          );
        },
      },
      {
        name: "scalar map unassigned displays",
        mutate: (fixture, map) => {
          writeText(
            fixture.externalMap,
            `${JSON.stringify({
              ...map,
              unassignedDisplays: map.unassignedDisplays[0],
            })}\n`,
          );
        },
      },
      {
        name: "oversized map",
        mutate: (fixture) => {
          writeFileSync(fixture.externalMap, Buffer.alloc(64 * 1024 + 1, 0x20));
        },
      },
      {
        name: "oversized layout",
        mutate: (fixture, map) => {
          writeFileSync(fixture.displayLayout, Buffer.alloc(16 * 1024 + 1, 0x20));
          map.layoutSha256 = sha256(fixture.displayLayout);
          writeText(fixture.externalMap, `${JSON.stringify(map)}\n`);
        },
      },
    ];

    for (const testCase of cases) {
      const fixture = makeLauncherFixture();
      try {
        const map = schema2DisplayMap(fixture.displayLayout);
        testCase.mutate(fixture, map);
        const result = runLauncher(
          fixture,
          launcherArguments(fixture, "ValidateOnly"),
          { behavior: "matching-success" },
        );
        expect(result.status, `${testCase.name}: ${output(result)}`).not.toBe(0);
        expect(invocations(fixture), testCase.name).toHaveLength(0);
      } finally {
        fixture.cleanup();
      }
    }
  }, 120_000);

  it("interprets one pinned bounded content lock instead of one manifest hash", () => {
    const source = readFileSync(productionScript, "utf8");
    expect(source).toMatch(/\$expectedContentLockSha256\s*=\s*'[0-9a-f]{64}'/u);
    expect(source).toMatch(/content\\p0\.1\\content-lock\.json/u);
    expect(source).toMatch(/content-lock-hash-mismatch/u);
    expect(source).toMatch(/active-manifest-not-allowlisted/u);
    expect(source).toMatch(/content-profile-reset-invalid/u);
    expect(source).not.toMatch(/\$expectedManifestSha256\s*=/u);
  });

  it.each([
    "p0-baseline",
    "songfeng-source",
    "river-channel",
    "tower-codebook",
  ])("validates the locked %s profile before Electron", (profile) => {
    const fixture = makeLauncherFixture();
    try {
      copyFileSync(
        join(fixture.contentProfiles, profile, "show.manifest.json"),
        fixture.manifest,
      );
      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "ValidateOnly"),
        { behavior: "matching-success" },
      );
      expect(result.status, output(result)).toBe(0);
      expect(invocations(fixture)).toHaveLength(1);
    } finally {
      fixture.cleanup();
    }
  }, 30_000);

  it.each([
    ["changed lock", "content-lock-hash-mismatch", "lock"],
    ["unlisted active manifest", "active-manifest-not-allowlisted", "active"],
    ["changed selected paper", "content-profile-paper-invalid", "paper"],
    ["changed selected source manifest", "content-profile-manifest-invalid", "source"],
    ["oversize lock", "content-lock-invalid", "oversize"],
  ] as const)("rejects %s before Electron", (_label, reason, mutation) => {
    const fixture = makeLauncherFixture();
    try {
      if (mutation === "lock") {
        writeFileSync(fixture.contentLock, `${readFileSync(fixture.contentLock, "utf8")} `);
      } else if (mutation === "active") {
        writeFileSync(fixture.manifest, `${readFileSync(fixture.manifest, "utf8")} `);
      } else if (mutation === "paper") {
        const paper = join(fixture.contentProfiles, "p0-baseline", "paper.md");
        writeFileSync(paper, `${readFileSync(paper, "utf8")}changed`);
      } else if (mutation === "source") {
        const source = join(fixture.contentProfiles, "p0-baseline", "show.manifest.json");
        writeFileSync(source, `${readFileSync(source, "utf8")} `);
      } else {
        writeFileSync(fixture.contentLock, Buffer.alloc(32 * 1024 + 1, 0x20));
      }
      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "ValidateOnly"),
        { behavior: "matching-success" },
      );
      expect(result.status, output(result)).not.toBe(0);
      expect(output(result)).toContain(reason);
      expect(invocations(fixture)).toHaveLength(0);
    } finally {
      fixture.cleanup();
    }
  }, 30_000);

  it("rejects a newly locked profile whose final reset is not at the loop boundary", () => {
    const fixture = makeLauncherFixture();
    try {
      const profilePath = join(
        fixture.contentProfiles,
        "songfeng-source",
        "show.manifest.json",
      );
      const manifest = JSON.parse(readFileSync(profilePath, "utf8")) as {
        cues: Array<{ atMs: number }>;
      };
      manifest.cues.at(-1)!.atMs = 89_999;
      const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
      writeText(profilePath, manifestText);
      writeText(fixture.manifest, manifestText);

      const lock = JSON.parse(readFileSync(fixture.contentLock, "utf8")) as {
        profiles: Array<{
          id: string;
          manifest: { bytes: number; sha256: string };
        }>;
      };
      const record = lock.profiles.find(({ id }) => id === "songfeng-source");
      if (record === undefined) throw new Error("songfeng lock record missing");
      record.manifest.bytes = statSync(profilePath).size;
      record.manifest.sha256 = sha256(profilePath);
      writeText(fixture.contentLock, `${JSON.stringify(lock, null, 2)}\n`);
      patchCopiedContentLockIdentity(fixture.script, fixture.contentLock);

      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "ValidateOnly"),
        { behavior: "matching-success" },
      );
      expect(result.status, output(result)).not.toBe(0);
      expect(output(result)).toContain("content-profile-reset-invalid");
      expect(invocations(fixture)).toHaveLength(0);
    } finally {
      fixture.cleanup();
    }
  }, 30_000);

  it("rejects a newly locked profile whose final reset is not presented on both screens", () => {
    const fixture = makeLauncherFixture();
    try {
      const profilePath = join(
        fixture.contentProfiles,
        "songfeng-source",
        "show.manifest.json",
      );
      const manifest = JSON.parse(readFileSync(profilePath, "utf8")) as {
        cues: Array<{ target: string }>;
      };
      manifest.cues.at(-1)!.target = "main";
      const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
      writeText(profilePath, manifestText);
      writeText(fixture.manifest, manifestText);

      const lock = JSON.parse(readFileSync(fixture.contentLock, "utf8")) as {
        profiles: Array<{
          id: string;
          manifest: { bytes: number; sha256: string };
        }>;
      };
      const record = lock.profiles.find(({ id }) => id === "songfeng-source");
      if (record === undefined) throw new Error("songfeng lock record missing");
      record.manifest.bytes = statSync(profilePath).size;
      record.manifest.sha256 = sha256(profilePath);
      writeText(fixture.contentLock, `${JSON.stringify(lock, null, 2)}\n`);
      patchCopiedContentLockIdentity(fixture.script, fixture.contentLock);

      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "ValidateOnly"),
        { behavior: "matching-success" },
      );
      expect(result.status, output(result)).not.toBe(0);
      expect(output(result)).toContain("content-profile-reset-invalid");
      expect(invocations(fixture)).toHaveLength(0);
    } finally {
      fixture.cleanup();
    }
  }, 30_000);

  it("contains only the approved offline and exact-process command surface", () => {
    expect(existsSync(productionScript)).toBe(true);
    const source = readFileSync(productionScript, "utf8");
    for (const forbidden of [
      /\b(?:npm|npx)\b/iu,
      /Invoke-WebRequest|Start-BitsTransfer|\bcurl(?:\.exe)?\b|\bwget\b/iu,
      /Invoke-RestMethod|\b(?:winget|choco|scoop)\b/iu,
      /\bgit\s+(?:add|commit|checkout|clean|reset|restore|switch|push|merge|rebase|rm|mv)/iu,
      /\$env:(?:Path|PSModulePath)\s*=/iu,
      /Disable-NetAdapter|Enable-NetAdapter|Set-NetFirewallRule|New-NetFirewallRule|Remove-NetFirewallRule|netsh/iu,
      /powercfg|Set-ExecutionPolicy/iu,
      /Invoke-Expression|\bcmd(?:\.exe)?\s+\/c/iu,
      /taskkill(?:\.exe)?\s+\/IM|Stop-Process\s+-Name/iu,
      /Get-Process[^\r\n]*-Name|\.ProcessName|MainWindowTitle/iu,
      /Get-Process[^\r\n|]*\|[^\r\n]*Stop-Process/iu,
      /SendInput|keybd_event|SendKeys/iu,
      /Remove-Item[^\r\n]*-Recurse[^\r\n]*(?:repository|source|runtime)/iu,
      /Get-Content[^\r\n]*AppData\\Local\\nvim/iu,
    ]) {
      expect(source).not.toMatch(forbidden);
    }
    expect(source).toMatch(/Get-NetRoute/);
    expect(source).toMatch(/Get-NetConnectionProfile/);
    expect(source).toMatch(/Start-Process/);
    expect(source).toMatch(/-WindowStyle\s+Hidden/);
    expect(source).toMatch(/-ArgumentList\s+\$[A-Za-z0-9_]+/);
    expect(source).not.toMatch(/ReadToEndAsync|ReadAllText/u);
    expect(source).not.toMatch(/Get-FileHash/u);
    expect(source).not.toMatch(/Stop-Process/u);
    expect(source).not.toMatch(/Remove-Item/u);
    expect(source).toMatch(/CopyToAsync/u);
    expect(source).toMatch(/SetFileInformationByHandle/u);
    expect(source).toMatch(/\$restartDelaysMilliseconds\s*=\s*@\(1000,\s*2000,\s*4000\)/u);
  });

  it("preflights one strict main bundle and the exact frozen toolchain before launch", () => {
    const fixture = makeLauncherFixture();
    try {
      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "ValidateOnly"),
        { behavior: "matching-success" },
      );
      const diagnostic = existsSync(fixture.sequenceLog)
        ? readFileSync(fixture.sequenceLog, "utf8")
        : "sequence-log-missing";
      expect(result.status, `${output(result)}\n${diagnostic}`).toBe(0);
      expect(invocations(fixture)).toHaveLength(1);
      expect(existsSync(fixture.watchdogAttempts)).toBe(false);
      const sequence = readFileSync(fixture.sequenceLog, "utf8").trim().split(/\r?\n/u);
      expect(sequence.indexOf("graph-verify")).toBeGreaterThanOrEqual(0);
      expect(sequence.indexOf("verify")).toBeGreaterThanOrEqual(0);
      expect(sequence.indexOf("verify")).toBeGreaterThan(
        sequence.indexOf("graph-verify"),
      );
      expect(sequence.indexOf("electron")).toBeGreaterThan(sequence.indexOf("verify"));
      expect(sequence).not.toContain("electron-wrapper");
    } finally {
      fixture.cleanup();
    }
  }, 30_000);

  it("rejects a verifier-consistent identifier-alias bundle outside the reviewed release before Electron", () => {
    const fixture = makeLauncherFixture();
    try {
      writeText(
        fixture.compiledEntry,
        [
          'import "electron";',
          'import "node:child_process";',
          'import "node:fs";',
          'import "node:path";',
          'import "node:url";',
          'const firstName = "getBuiltinModule";',
          'const secondName = "createRequire";',
          'process[firstName]("module")[secondName](import.meta.url)("zod");',
          "",
        ].join("\n"),
      );

      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "ValidateOnly"),
        { behavior: "matching-success" },
      );
      const sequence = existsSync(fixture.sequenceLog)
        ? readFileSync(fixture.sequenceLog, "utf8").trim().split(/\r?\n/u)
        : [];

      expect(result.status, output(result)).not.toBe(0);
      expect(output(result)).toContain(
        "electron-module-release-identity-mismatch",
      );
      expect(sequence).toContain("graph-verify");
      expect(sequence).not.toContain("verify");
      expect(sequence).not.toContain("electron");
      expect(invocations(fixture)).toHaveLength(0);
    } finally {
      fixture.cleanup();
    }
  }, 15_000);

  it.each([
    [
      "missing allowed import",
      ["electron", "node:child_process", "node:fs", "node:path"],
      "electron-module-release-identity-mismatch",
    ],
    [
      "reordered allowed imports",
      ["electron", "node:fs", "node:child_process", "node:path", "node:url"],
      "electron-module-graph-invalid",
    ],
    [
      "extra allowed import",
      [
        "electron",
        "node:child_process",
        "node:crypto",
        "node:fs",
        "node:path",
        "node:url",
      ],
      "electron-module-release-identity-mismatch",
    ],
  ] as const)(
    "rejects release runtime identity with %s before Electron",
    (_label, runtimeImports, reason) => {
      const fixture = makeLauncherFixture();
      try {
        const result = runLauncher(
          fixture,
          launcherArguments(fixture, "ValidateOnly"),
          {
            behavior: "matching-success",
            graphOutput: changedGraphOutput(fixture, (manifest) => ({
              ...manifest,
              runtimeImports,
            })),
          },
        );

        expect(result.status, output(result)).not.toBe(0);
        expect(output(result)).toContain(reason);
        expect(invocations(fixture)).toHaveLength(0);
      } finally {
        fixture.cleanup();
      }
    },
    15_000,
  );

  it.each([
    [
      "different byte count",
      (candidate: Buffer) => Buffer.concat([candidate, Buffer.from("\n")]),
    ],
    [
      "same bytes with different hash",
      (candidate: Buffer) => {
        const changed = Buffer.from(candidate);
        changed[changed.length - 1] = 0x20;
        return changed;
      },
    ],
  ] as const)(
    "rejects verifier-consistent candidate with %s from the reviewed release before Electron",
    (_label, changeCandidate) => {
      const fixture = makeLauncherFixture();
      try {
        const changedCandidate = changeCandidate(
          readFileSync(fixture.compiledEntry),
        );
        writeFileSync(fixture.compiledEntry, changedCandidate);
        const result = runLauncher(
          fixture,
          launcherArguments(fixture, "ValidateOnly"),
          { behavior: "matching-success" },
        );

        expect(result.status, output(result)).not.toBe(0);
        expect(output(result)).toContain(
          "electron-module-release-identity-mismatch",
        );
        expect(invocations(fixture)).toHaveLength(0);
      } finally {
        fixture.cleanup();
      }
    },
    15_000,
  );

  it("claims the TypeScript parser before graph verification executes its bytes", () => {
    const fixture = makeLauncherFixture();
    const originalParserSha256 = sha256(fixture.parserImplementation);
    try {
      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "ValidateOnly"),
        {
          behavior: "matching-success",
          parserMutation: "attempt-before-graph-verifier",
        },
      );
      const mutationDiagnostic = existsSync(fixture.parserMutationLog)
        ? readFileSync(fixture.parserMutationLog, "utf8").trim()
        : "parser-mutation-log-missing";
      const parserExecutions = existsSync(fixture.parserExecutionLog)
        ? readFileSync(fixture.parserExecutionLog, "utf8")
          .trim()
          .split(/\r?\n/u)
          .filter(Boolean)
        : [];
      const sequence = existsSync(fixture.sequenceLog)
        ? readFileSync(fixture.sequenceLog, "utf8").trim().split(/\r?\n/u)
        : [];

      expect.soft(result.status, output(result)).toBe(0);
      expect.soft(mutationDiagnostic).toMatch(/^blocked:800700(?:05|20)$/u);
      expect.soft(sha256(fixture.parserImplementation)).toBe(originalParserSha256);
      expect.soft(parserExecutions).toEqual(["original"]);
      expect.soft(sequence).not.toContain("parser-executed:modified");
      expect.soft(sequence.indexOf("graph-verify")).toBeGreaterThan(
        sequence.indexOf("parser-executed:original"),
      );
    } finally {
      fixture.cleanup();
    }
  }, 15_000);

  it("claims TypeScript package metadata before it governs graph parser execution", () => {
    const fixture = makeLauncherFixture();
    const originalParserSha256 = sha256(fixture.parserImplementation);
    const originalPackageSha256 = sha256(fixture.parserPackageManifest);
    try {
      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "ValidateOnly"),
        {
          behavior: "matching-success",
          parserPackageMutation: "attempt-before-graph-verifier",
        },
      );
      const mutationDiagnostic = existsSync(fixture.parserPackageMutationLog)
        ? readFileSync(fixture.parserPackageMutationLog, "utf8").trim()
        : "parser-package-mutation-log-missing";
      const parserExecutions = existsSync(fixture.parserExecutionLog)
        ? readFileSync(fixture.parserExecutionLog, "utf8")
          .trim()
          .split(/\r?\n/u)
          .filter(Boolean)
        : [];
      const sequence = existsSync(fixture.sequenceLog)
        ? readFileSync(fixture.sequenceLog, "utf8").trim().split(/\r?\n/u)
        : [];

      expect.soft(result.status, output(result)).toBe(0);
      expect.soft(mutationDiagnostic).toMatch(/^blocked:800700(?:05|20)$/u);
      expect.soft(sha256(fixture.parserPackageManifest)).toBe(
        originalPackageSha256,
      );
      expect.soft(sha256(fixture.parserImplementation)).toBe(
        originalParserSha256,
      );
      expect.soft(parserExecutions).toEqual(["original"]);
      expect.soft(sequence.indexOf("graph-verify")).toBeGreaterThan(
        sequence.indexOf("parser-executed:original"),
      );
    } finally {
      fixture.cleanup();
    }
  }, 15_000);

  it("freezes the exact resolved Node executable before version and graph verification", () => {
    const fixture = makeLauncherFixture();
    const originalNodeSha256 = sha256(fixture.nodeExecutable);
    try {
      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "ValidateOnly"),
        {
          behavior: "matching-success",
          nodeMutation: "attempt-after-graph-verifier",
          controllerSleepMs: 1_000,
        },
      );
      const mutationDiagnostic = existsSync(fixture.nodeMutationLog)
        ? readFileSync(fixture.nodeMutationLog, "utf8").trim()
        : "node-mutation-log-missing";
      const sequence = existsSync(fixture.sequenceLog)
        ? readFileSync(fixture.sequenceLog, "utf8").trim().split(/\r?\n/u)
        : [];

      expect.soft(result.status, output(result)).toBe(0);
      expect.soft(mutationDiagnostic).toMatch(/^blocked:800700(?:05|20)$/u);
      expect.soft(sha256(fixture.nodeExecutable)).toBe(originalNodeSha256);
      expect.soft(sequence.indexOf("graph-verify")).toBeGreaterThanOrEqual(0);
      expect.soft(sequence.indexOf("electron")).toBeGreaterThan(
        sequence.indexOf("graph-verify"),
      );
    } finally {
      fixture.cleanup();
    }
  }, 15_000);

  it("rejects two distinct Node application paths before version or graph verification", () => {
    const fixture = makeLauncherFixture();
    const alternateNodeDirectory = join(fixture.root, "alternate-node");
    mkdirSync(alternateNodeDirectory);
    copyFileSync(
      fixture.nodeExecutable,
      join(alternateNodeDirectory, "node.exe"),
    );
    try {
      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "ValidateOnly"),
        {
          additionalNodePath: alternateNodeDirectory,
          behavior: "matching-success",
        },
      );
      const sequence = existsSync(fixture.sequenceLog)
        ? readFileSync(fixture.sequenceLog, "utf8").trim().split(/\r?\n/u)
        : [];

      expect(result.status, output(result)).not.toBe(0);
      expect(output(result)).toContain("node-command-ambiguous");
      expect(sequence).not.toContain("parser-executed:original");
      expect(sequence).not.toContain("graph-verify");
      expect(sequence).not.toContain("electron");
      expect(invocations(fixture)).toHaveLength(0);
    } finally {
      fixture.cleanup();
    }
  }, 15_000);

  it.each(invalidGraphOutputCases)(
    "rejects graph verifier output before Electron: $label",
    ({ output: graphOutput, reason }) => {
      const fixture = makeLauncherFixture();
      try {
        const result = runLauncher(
          fixture,
          launcherArguments(fixture, "ValidateOnly"),
          {
            behavior: "matching-success",
            graphOutput: graphOutput(fixture),
          },
        );
        const diagnostic = output(result);
        const sequence = existsSync(fixture.sequenceLog)
          ? readFileSync(fixture.sequenceLog, "utf8").trim().split(/\r?\n/u)
          : [];

        expect(result.status, diagnostic).not.toBe(0);
        expect(diagnostic).toContain(reason);
        expect(invocations(fixture)).toHaveLength(0);
        expect(sequence).not.toContain("electron");
      } finally {
        fixture.cleanup();
      }
    },
    15_000,
  );

  it.each(duplicateGraphOutputCases)(
    "rejects raw graph manifest with $label before Electron",
    ({ output: graphOutput }) => {
      const fixture = makeLauncherFixture();
      try {
        const result = runLauncher(
          fixture,
          launcherArguments(fixture, "ValidateOnly"),
          {
            behavior: "matching-success",
            graphOutput: graphOutput(fixture),
          },
        );
        const sequence = existsSync(fixture.sequenceLog)
          ? readFileSync(fixture.sequenceLog, "utf8").trim().split(/\r?\n/u)
          : [];

        expect(result.status, output(result)).not.toBe(0);
        expect(output(result)).toContain("electron-module-graph-invalid");
        expect(invocations(fixture)).toHaveLength(0);
        expect(sequence).not.toContain("electron");
      } finally {
        fixture.cleanup();
      }
    },
    15_000,
  );

  it("rejects a same-size graph file mutation after verifier output before claim opening", () => {
    const fixture = makeLauncherFixture();
    const originalSize = statSync(fixture.compiledEntry).size;
    const originalSha256 = sha256(fixture.compiledEntry);
    try {
      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "ValidateOnly"),
        {
          behavior: "matching-success",
          graphMutation: "same-size-after-output",
        },
      );
      const diagnostic = output(result);
      const sequence = existsSync(fixture.sequenceLog)
        ? readFileSync(fixture.sequenceLog, "utf8").trim().split(/\r?\n/u)
        : [];

      expect(result.status, diagnostic).not.toBe(0);
      expect(diagnostic).toContain("frozen-input-claim-failed");
      expect(invocations(fixture)).toHaveLength(0);
      expect(sequence).toContain("graph-verify");
      expect(sequence).toContain("graph-mutated");
      expect(sequence).not.toContain("verify");
      expect(sequence).not.toContain("electron");
      expect(statSync(fixture.compiledEntry).size).toBe(originalSize);
      expect(sha256(fixture.compiledEntry)).not.toBe(originalSha256);
    } finally {
      fixture.cleanup();
    }
  }, 15_000);

  it("rejects a noisy Node version probe through the bounded-process path", () => {
    const fixture = makeLauncherFixture();
    try {
      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "ValidateOnly"),
        { nodeBehavior: "noisy" },
      );
      expect(result.status).not.toBe(0);
      expect(output(result)).toContain("node-version-check-failed");
      expect(invocations(fixture)).toHaveLength(0);
    } finally {
      fixture.cleanup();
    }
  }, 15_000);

  it("times out a hanging Node version probe before the outer launcher bound", async () => {
    const fixture = makeLauncherFixture();
    const startedAt = Date.now();
    try {
      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "ValidateOnly"),
        { nodeBehavior: "hang", timeoutMs: 10_000 },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).not.toBe(0);
      expect(output(result)).toContain("node-version-check-failed");
      expect(Date.now() - startedAt).toBeLessThan(9_000);
      expect(invocations(fixture)).toHaveLength(0);
    } finally {
      await cleanupWhenUnlocked(fixture, 8_000);
    }
  }, 15_000);

  it("rejects an inexact Node version, missing build, invalid marker, and verifier failure before Electron", () => {
    const cases: Array<(fixture: LauncherFixture) => RunOptions> = [
      () => ({ nodeVersion: "v22.23.1" }),
      (fixture) => {
        rmSync(fixture.compiledEntry);
        return {};
      },
      (fixture) => {
        rmSync(fixture.electronExecutable);
        return {};
      },
      (fixture) => {
        writeText(join(fixture.root, "AGENTS.md"), "not the exhibition repository\n");
        return {};
      },
      () => ({ verifyExit: 9 }),
    ];
    for (const arrange of cases) {
      const fixture = makeLauncherFixture();
      try {
        const result = runLauncher(
          fixture,
          launcherArguments(fixture, "ValidateOnly"),
          arrange(fixture),
        );
        expect(result.status).not.toBe(0);
        expect(invocations(fixture)).toHaveLength(0);
      } finally {
        fixture.cleanup();
      }
    }
  }, 15_000);

  it("rejects repository, product, user-config, protected, checked-in, and mismatched paths", () => {
    const paths = [
      [repositoryRoot, join(repositoryRoot, "display-map.json")],
      [productRoot, win32.join(productRoot, "display-map.json")],
      [userNvimRoot, win32.join(userNvimRoot, "display-map.json")],
      ...protectedRoots.map((root) => [root, win32.join(root, "display-map.json")]),
    ];
    for (const [root, map] of paths) {
      const fixture = makeLauncherFixture();
      try {
        const args = launcherArguments(fixture, "ValidateOnly");
        args[3] = root;
        args[5] = map;
        args[7] = win32.basename(root);
        const result = runLauncher(fixture, args);
        expect(result.status).not.toBe(0);
        expect(invocations(fixture)).toHaveLength(0);
      } finally {
        fixture.cleanup();
      }
    }

    const checkedIn = makeLauncherFixture();
    try {
      const args = launcherArguments(checkedIn, "ValidateOnly");
      args[5] = checkedIn.checkedInMap;
      expect(runLauncher(checkedIn, args).status).not.toBe(0);
      expect(invocations(checkedIn)).toHaveLength(0);
    } finally {
      checkedIn.cleanup();
    }
  }, 15_000);

  it("rejects a rehearsal path whose ancestor is a directory junction", () => {
    const fixture = makeLauncherFixture();
    const pathFixtureRoot = mkdtempSync(join(tmpdir(), "janvim show reparse-"));
    try {
      const canonicalAnchor = join(pathFixtureRoot, "canonical rehearsal anchor");
      const junctionAnchor = join(pathFixtureRoot, "junction rehearsal anchor");
      mkdirSync(canonicalAnchor);
      symlinkSync(canonicalAnchor, junctionAnchor, "junction");

      const controlledParent = win32.join(junctionAnchor, "rehearsals");
      const controlledRoot = win32.join(controlledParent, fixture.runId);
      const controlledMap = win32.join(controlledRoot, "display-map.json");
      mkdirSync(controlledRoot, { recursive: true });
      writeText(controlledMap, `${JSON.stringify(confirmedDisplayMap(), null, 2)}\n`);

      const originalParent = `$rehearsalParent = '${rehearsalParent}'`;
      const replacementParent = `$rehearsalParent = '${controlledParent.replaceAll("'", "''")}'`;
      const source = readFileSync(fixture.script, "utf8");
      expect(source).toContain(originalParent);
      writeText(fixture.script, source.replace(originalParent, replacementParent));

      const result = runLauncher(
        fixture,
        [
          "-Mode",
          "ValidateOnly",
          "-RehearsalRoot",
          controlledRoot,
          "-DisplayMapPath",
          controlledMap,
          "-RunId",
          fixture.runId,
          "-NetworkPolicy",
          "OfflineRequired",
        ],
        { behavior: "matching-success" },
      );
      expect(result.status, output(result)).not.toBe(0);
      expect(invocations(fixture)).toHaveLength(0);
    } finally {
      rmSync(pathFixtureRoot, { recursive: true, force: true });
      fixture.cleanup();
    }
  }, 20_000);

  it("rejects a frozen JanVim runtime reached through a directory junction", () => {
    const fixture = makeLauncherFixture();
    const pathFixtureRoot = mkdtempSync(join(tmpdir(), "janvim runtime reparse-"));
    try {
      const runtimeRoot = dirname(fixture.janvimExecutable);
      const canonicalRuntime = join(pathFixtureRoot, "canonical janvim runtime");
      const canonicalExecutable = join(canonicalRuntime, "janvim-core.exe");
      mkdirSync(canonicalRuntime);
      copyFileSync(fixture.janvimExecutable, canonicalExecutable);
      rmSync(runtimeRoot, { recursive: true, force: true });
      symlinkSync(canonicalRuntime, runtimeRoot, "junction");

      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "ValidateOnly"),
        { behavior: "matching-success" },
      );
      expect(result.status, output(result)).not.toBe(0);
      expect(invocations(fixture)).toHaveLength(0);
    } finally {
      fixture.cleanup();
      rmSync(pathFixtureRoot, { recursive: true, force: true });
    }
  }, 20_000);

  it("rejects unknown parameters, an existing terminal marker, and frozen content mutations", () => {
    const unknown = makeLauncherFixture();
    try {
      const result = runLauncher(unknown, [
        ...launcherArguments(unknown, "ValidateOnly"),
        "-UnexpectedParameter",
        "value",
      ]);
      expect(result.status).not.toBe(0);
      expect(invocations(unknown)).toHaveLength(0);
    } finally {
      unknown.cleanup();
    }

    for (const mutate of [
      (fixture: LauncherFixture) => writeText(fixture.terminalMarker, "{}\n"),
      (fixture: LauncherFixture) => writeText(fixture.poem, "mutated poem\n"),
      (fixture: LauncherFixture) => writeText(fixture.showConfig, "layout_engine='dynamic'\n"),
      (fixture: LauncherFixture) => {
        const lock = JSON.parse(readFileSync(fixture.artifactLock, "utf8")) as {
          schema: number | string;
        };
        lock.schema = "1";
        writeText(fixture.artifactLock, `${JSON.stringify(lock, null, 2)}\n`);
      },
      (fixture: LauncherFixture) =>
        writeText(fixture.externalMap, '{"schema":"1","mappingStatus":"confirmed"}\n'),
      (fixture: LauncherFixture) =>
        writeText(fixture.externalMap, '{"schema":1,"mappingStatus":"unconfirmed"}\n'),
      (fixture: LauncherFixture) => {
        const map = confirmedDisplayMap();
        map.secondary.geometrySha256 = "0".repeat(64);
        writeText(fixture.externalMap, `${JSON.stringify(map, null, 2)}\n`);
      },
    ]) {
      const fixture = makeLauncherFixture();
      try {
        mutate(fixture);
        const result = runLauncher(
          fixture,
          launcherArguments(fixture, "ValidateOnly"),
        );
        expect(result.status).not.toBe(0);
        expect(invocations(fixture)).toHaveLength(0);
      } finally {
        fixture.cleanup();
      }
    }
  }, 15_000);

  it("rejects a pre-existing watchdog journal before controller launch without replacing it", () => {
    const fixture = makeLauncherFixture();
    const preexisting = '{"schema":999,"sentinel":"preexisting"}\n';
    try {
      writeText(fixture.watchdogAttempts, preexisting);
      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "Show"),
        { behavior: "matching-success" },
      );

      expect(result.status, output(result)).not.toBe(0);
      expect(output(result)).toContain(
        "conflicting-show-state:watchdog-attempts.jsonl",
      );
      expect(invocations(fixture)).toHaveLength(0);
      expect(readFileSync(fixture.watchdogAttempts, "utf8")).toBe(preexisting);
    } finally {
      fixture.cleanup();
    }
  }, 15_000);

  it("rejects an oversized frozen config before unbounded hashing", () => {
    const fixture = makeLauncherFixture();
    try {
      writeText(fixture.showConfig, "x".repeat(65_537));
      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "ValidateOnly"),
      );
      expect(result.status).not.toBe(0);
      expect(output(result)).toContain("show-config-size-invalid");
      expect(invocations(fixture)).toHaveLength(0);
    } finally {
      fixture.cleanup();
    }
  }, 15_000);

  it.each([
    ["alive non-default", "10.0.0.0/8", "Alive", "Ethernet", false],
    [
      "alive IPv4 default with a loopback-looking alias",
      "0.0.0.0/0",
      "Alive",
      "Loopback Pseudo-Interface 1",
      true,
    ],
    ["alive IPv6 default with a localized alias", "::/0", "Alive", "任意本地化名称", true],
    ["dead IPv4 default", "0.0.0.0/0", "Dead", "Ethernet", false],
  ] as const)(
    "classifies the %s route by exact prefix and state",
    (_label, routeDestinationPrefix, routeState, routeInterfaceAlias, blocked) => {
      const fixture = makeLauncherFixture();
      try {
        const result = runLauncher(
          fixture,
          launcherArguments(fixture, "ValidateOnly"),
          {
            behavior: "matching-success",
            routeCount: 1,
            profileCount: 0,
            routeDestinationPrefix,
            routeState,
            routeInterfaceAlias,
          },
        );
        if (blocked) {
          expect(result.status, output(result)).not.toBe(0);
          expect(invocations(fixture)).toHaveLength(0);
        } else {
          expect(result.status, output(result)).toBe(0);
          expect(invocations(fixture)).toHaveLength(1);
        }
      } finally {
        fixture.cleanup();
      }
    },
    20_000,
  );

  it.each([
    ["IPv4 Subnet", "Subnet", "NoTraffic"],
    ["IPv4 LocalNetwork", "LocalNetwork", "NoTraffic"],
    ["IPv4 Internet", "Internet", "NoTraffic"],
    ["IPv6 Subnet", "NoTraffic", "Subnet"],
    ["IPv6 LocalNetwork", "NoTraffic", "LocalNetwork"],
    ["IPv6 Internet", "NoTraffic", "Internet"],
  ] as const)(
    "rejects a profile with %s connectivity under OfflineRequired",
    (_label, profileIpv4Connectivity, profileIpv6Connectivity) => {
      const fixture = makeLauncherFixture();
      try {
        const result = runLauncher(
          fixture,
          launcherArguments(fixture, "ValidateOnly"),
          {
            behavior: "matching-success",
            routeCount: 0,
            profileCount: 1,
            profileInterfaceAlias: "任意本地化名称",
            profileIpv4Connectivity,
            profileIpv6Connectivity,
          },
        );
        expect(result.status, output(result)).not.toBe(0);
        expect(invocations(fixture)).toHaveLength(0);
      } finally {
        fixture.cleanup();
      }
    },
    20_000,
  );

  it("terminates a hung network snapshot before any show process starts", () => {
    const fixture = makeLauncherFixture();
    const startedAt = Date.now();
    try {
      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "ValidateOnly"),
        { routeBehavior: "hang", timeoutMs: 8_000 },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).not.toBe(0);
      expect(Date.now() - startedAt).toBeLessThan(7_000);
      expect(invocations(fixture)).toHaveLength(0);
    } finally {
      fixture.cleanup();
    }
  }, 15_000);

  it("fails closed when a network snapshot exceeds its route result cap", () => {
    const fixture = makeLauncherFixture();
    try {
      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "ValidateOnly"),
        {
          behavior: "matching-success",
          routeCount: 1_025,
          routeInterfaceAlias: "Loopback Pseudo-Interface 1",
        },
      );
      expect(result.status).not.toBe(0);
      expect(output(result)).toContain("network-snapshot-failed");
      expect(invocations(fixture)).toHaveLength(0);
    } finally {
      fixture.cleanup();
    }
  }, 15_000);

  it("fails closed when a network snapshot exceeds its profile result cap", () => {
    const fixture = makeLauncherFixture();
    try {
      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "ValidateOnly"),
        {
          behavior: "matching-success",
          profileCount: 257,
          profileIpv4Connectivity: "NoTraffic",
        },
      );
      expect(result.status).not.toBe(0);
      expect(output(result)).toContain("network-snapshot-failed");
      expect(invocations(fixture)).toHaveLength(0);
    } finally {
      fixture.cleanup();
    }
  }, 15_000);

  it("rechecks OfflineRequired immediately before runtime verification", () => {
    const fixture = makeLauncherFixture();
    try {
      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "ValidateOnly"),
        {
          behavior: "matching-success",
          routeCounts: [0, 1],
        },
      );
      expect(result.status).not.toBe(0);
      expect(invocations(fixture)).toHaveLength(0);
      const sequence = readFileSync(fixture.sequenceLog, "utf8").trim().split(/\r?\n/u);
      const routeChecks = sequence
        .map((value, index) => (value === "net-route" ? index : -1))
        .filter((index) => index >= 0);
      expect(routeChecks).toHaveLength(2);
      expect(sequence).not.toContain("verify");
      expect(sequence).not.toContain("electron");
    } finally {
      fixture.cleanup();
    }
  }, 15_000);

  it("rechecks OfflineRequired immediately before Electron launch", () => {
    const fixture = makeLauncherFixture();
    try {
      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "ValidateOnly"),
        {
          behavior: "matching-success",
          routeCounts: [0, 0, 1],
        },
      );
      expect(result.status).not.toBe(0);
      expect(invocations(fixture)).toHaveLength(0);
      const sequence = readFileSync(fixture.sequenceLog, "utf8").trim().split(/\r?\n/u);
      const routeChecks = sequence.filter((value) => value === "net-route");
      expect(routeChecks).toHaveLength(3);
      expect(sequence).toContain("verify");
      expect(sequence).not.toContain("electron");
    } finally {
      fixture.cleanup();
    }
  }, 15_000);

  it("allows DiagnosticConnected but forwards a non-accepting diagnostic policy", () => {
    const fixture = makeLauncherFixture();
    try {
      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "ValidateOnly", "DiagnosticConnected"),
        { routeCount: 1, profileCount: 1, behavior: "matching-success" },
      );
      const diagnostic = existsSync(fixture.sequenceLog)
        ? readFileSync(fixture.sequenceLog, "utf8")
        : "sequence-log-missing";
      expect(result.status, `${output(result)}\n${diagnostic}`).toBe(0);
      const records = invocations(fixture);
      expect(records).toHaveLength(1);
      expect(records[0]!.arguments).toContain(
        "--network-policy=diagnostic-connected",
      );
    } finally {
      fixture.cleanup();
    }
  }, 10_000);

  it("runs ValidateOnly once and propagates its exact nonzero exit", () => {
    const fixture = makeLauncherFixture();
    try {
      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "ValidateOnly"),
        { controllerExit: 9 },
      );
      expect(result.status).toBe(9);
      expect(invocations(fixture)).toHaveLength(1);
      expect(existsSync(fixture.incidentPath)).toBe(false);
      expect(existsSync(fixture.watchdogAttempts)).toBe(false);
    } finally {
      fixture.cleanup();
    }
  }, 15_000);

  it.each([
    ["Soak3", "matching-success", 0, "intentional-success"],
    ["Show", "matching-failure", 7, "intentional-failure"],
  ] as const)(
    "treats matching %s terminal evidence as a single %s exit",
    (mode, behavior, expectedExit, expectedOutcome) => {
      const fixture = makeLauncherFixture();
      try {
        const result = runLauncher(
          fixture,
          launcherArguments(fixture, mode),
          { behavior },
        );
        const evidenceDiagnostic = existsSync(fixture.evidencePath)
          ? readFileSync(fixture.evidencePath, "utf8")
          : "show-run-evidence-missing";
        const incidentDiagnostic = existsSync(fixture.incidentPath)
          ? readFileSync(fixture.incidentPath, "utf8")
          : "controller-incident-missing";
        expect(
          result.status,
          `${output(result)}\n${evidenceDiagnostic}\n${incidentDiagnostic}`,
        ).toBe(expectedExit);
        const schemaProbe = JSON.parse(evidenceDiagnostic) as {
          artifact: {
            lockSha256: string;
            coreBytes: number;
            coreSha256: string;
          };
        };
        Object.assign(schemaProbe.artifact, TASK9_ARTIFACT_IDENTITY);
        expect(parseShowRunEvidence(schemaProbe).controllerRunId).toBe(
          flag(invocations(fixture)[0]!.arguments, "controller-run-id"),
        );
        const records = invocations(fixture);
        expect(records).toHaveLength(1);
        expect(existsSync(fixture.watchdogAttempts)).toBe(false);
        const args = records[0]!.arguments;
        expect(args).toContain(`--show-mode=${mode.toLowerCase()}`);
        expect(args).not.toEqual(expect.arrayContaining([expect.stringMatching(/^--g2-mode=/)]));
        expect(flag(args, "run-id")).toBe(fixture.runId);
        const controllerRunId = flag(args, "controller-run-id");
        expect(controllerRunId).toMatch(/^[A-Za-z0-9._-]{1,96}$/);
        expect(args).toEqual([
          `--show-mode=${mode.toLowerCase()}`,
          `--rehearsal-root=${fixture.externalRoot}`,
          `--display-map=${fixture.externalMap}`,
          `--run-id=${fixture.runId}`,
          `--controller-run-id=${controllerRunId}`,
          "--network-policy=offline-required",
        ]);
        const marker = JSON.parse(readFileSync(fixture.terminalMarker, "utf8")) as {
          outcome: string;
        };
        expect(marker.outcome).toBe(expectedOutcome);
      } finally {
        fixture.cleanup();
      }
    },
    15_000,
  );

  it("does not retain hidden controller stdout or stderr in the launcher or a file", () => {
    const fixture = makeLauncherFixture();
    try {
      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "Show"),
        {
          behavior: "matching-success",
          controllerOutputBytes: 131_072,
        },
      );
      expect(result.status, output(result)).toBe(0);
      expect(Buffer.byteLength(output(result), "utf8")).toBeLessThan(4_096);
      expect(existsSync(join(fixture.root, "controller.stdout.log"))).toBe(false);
      expect(existsSync(join(fixture.root, "controller.stderr.log"))).toBe(false);
    } finally {
      fixture.cleanup();
    }
  }, 15_000);

  it.each([
    ["matching-success-no-evidence", false],
    ["matching-success-wrong-evidence", true],
    ["matching-success-wrong-display-evidence", true],
    ["matching-success-wrong-artifact-evidence", true],
    ["matching-success-wrong-content-evidence", true],
    ["matching-success-partial-evidence", true],
  ] as const)(
    "rejects intentional terminal evidence without matching durable run identity: %s",
    (behavior, evidenceWritten) => {
      const fixture = makeLauncherFixture();
      try {
        const result = runLauncher(
          fixture,
          launcherArguments(fixture, "Show"),
          { behavior },
        );
        expect(result.status, output(result)).toBe(70);
        expect(invocations(fixture)).toHaveLength(1);
        expect(existsSync(fixture.terminalMarker)).toBe(true);
        expect(existsSync(fixture.evidencePath)).toBe(evidenceWritten);
        const incident = JSON.parse(
          readFileSync(fixture.incidentPath, "utf8"),
        ) as { reason: string };
        expect(incident.reason).toBe("show-run-evidence-invalid");
      } finally {
        fixture.cleanup();
      }
    },
    15_000,
  );

  it("holds every verified frozen input against writes throughout the controller run", () => {
    const fixture = makeLauncherFixture();
    const displayMapSha256 = sha256(fixture.externalMap);
    try {
      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "Show"),
        {
          behavior: "matching-success",
          inputMutation: "attempt-display-map-append",
        },
      );
      const mutationDiagnostic = existsSync(fixture.inputMutationLog)
        ? readFileSync(fixture.inputMutationLog, "utf8")
        : "input-mutation-log-missing";
      expect(result.status, `${output(result)}\n${mutationDiagnostic}`).toBe(0);
      expect(invocations(fixture)).toHaveLength(1);
      expect(mutationDiagnostic.trim()).toMatch(/^blocked:80070020$/u);
      expect(sha256(fixture.externalMap)).toBe(displayMapSha256);
    } finally {
      fixture.cleanup();
    }
  }, 15_000);

  it.each([
    ["electron executable", "electron-executable", (fixture: LauncherFixture) => fixture.electronExecutable],
    ["resolved Node executable", "node-executable", (fixture: LauncherFixture) => fixture.nodeExecutable],
    ["electron-main.js", "electron-main", (fixture: LauncherFixture) => fixture.compiledEntry],
    ["graph verifier", "graph-verifier", (fixture: LauncherFixture) => fixture.graphVerifier],
    ["TypeScript parser", "typescript-parser", (fixture: LauncherFixture) => fixture.parserImplementation],
    ["TypeScript package metadata", "typescript-package-metadata", (fixture: LauncherFixture) => fixture.parserPackageManifest],
    ["runtime verifier", "runtime-verifier", (fixture: LauncherFixture) => fixture.verifyRuntime],
    ["close helper", "close-helper", (fixture: LauncherFixture) => fixture.closeHelper],
    ["JanVim core", "runtime-core", (fixture: LauncherFixture) => fixture.janvimExecutable],
  ] as const)(
    "holds the %s claim across the watchdog relaunch gap",
    (_label, launchMutation, targetPath) => {
      const fixture = makeLauncherFixture();
      const target = targetPath(fixture);
      const originalSha256 = sha256(target);
      try {
        const result = runLauncher(
          fixture,
          launcherArguments(fixture, "Show"),
          {
            behavior: "crash-then-success",
            launchMutation,
            timeoutMs: 15_000,
          },
        );
        const mutationDiagnostic = existsSync(fixture.launchMutationLog)
          ? readFileSync(fixture.launchMutationLog, "utf8").trim()
          : "launch-mutation-log-missing";
        const parserExecutions = existsSync(fixture.parserExecutionLog)
          ? readFileSync(fixture.parserExecutionLog, "utf8")
            .trim()
            .split(/\r?\n/u)
            .filter(Boolean)
          : [];
        expect(result.status, `${output(result)}\n${mutationDiagnostic}`).toBe(0);
        expect(invocations(fixture)).toHaveLength(2);
        expect(mutationDiagnostic).toMatch(/^blocked:800700(?:05|20)$/u);
        expect(sha256(target)).toBe(originalSha256);
        expect(parserExecutions).toEqual(["original"]);
      } finally {
        fixture.cleanup();
      }
    },
    20_000,
  );

  it.each([
    ["display map", "display-map"],
    ["display layout", "display-layout"],
  ] as const)(
    "holds the schema-2 %s claim across the watchdog relaunch gap",
    (_label, launchMutation) => {
      const fixture = makeLauncherFixture();
      try {
        writeText(
          fixture.externalMap,
          `${JSON.stringify(schema2DisplayMap(fixture.displayLayout), null, 2)}\n`,
        );
        const target =
          launchMutation === "display-map"
            ? fixture.externalMap
            : fixture.displayLayout;
        const originalSha256 = sha256(target);
        const result = runLauncher(
          fixture,
          launcherArguments(fixture, "Show"),
          {
            behavior: "crash-then-success",
            launchMutation,
            timeoutMs: 15_000,
          },
        );
        const mutationDiagnostic = existsSync(fixture.launchMutationLog)
          ? readFileSync(fixture.launchMutationLog, "utf8").trim()
          : "launch-mutation-log-missing";
        const incidentDiagnostic = existsSync(fixture.incidentPath)
          ? readFileSync(fixture.incidentPath, "utf8").trim()
          : "incident-missing";
        const evidenceDiagnostic = existsSync(fixture.evidencePath)
          ? readFileSync(fixture.evidencePath, "utf8").trim()
          : "evidence-missing";

        expect(
          result.status,
          `${output(result)}\n${mutationDiagnostic}\n${incidentDiagnostic}\n${evidenceDiagnostic}`,
        ).toBe(0);
        expect(invocations(fixture)).toHaveLength(2);
        expect(mutationDiagnostic).toMatch(/^blocked:800700(?:05|20)$/u);
        expect(sha256(target)).toBe(originalSha256);
      } finally {
        fixture.cleanup();
      }
    },
    30_000,
  );

  it("does not trust a terminal marker with the wrong controller PID", () => {
    const fixture = makeLauncherFixture();
    try {
      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "Show"),
        { behavior: "wrong-marker" },
      );
      expect(result.status).not.toBe(0);
      expect(invocations(fixture)).toHaveLength(1);
      expect(existsSync(fixture.incidentPath)).toBe(true);
    } finally {
      fixture.cleanup();
    }
  }, 15_000);

  it("does not coerce numeric strings in terminal evidence", () => {
    const fixture = makeLauncherFixture();
    try {
      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "Show"),
        { behavior: "wrong-marker-types" },
      );
      expect(result.status).not.toBe(0);
      expect(invocations(fixture)).toHaveLength(1);
      expect(existsSync(fixture.incidentPath)).toBe(true);
    } finally {
      fixture.cleanup();
    }
  }, 15_000);

  it("does not coerce single-element identifier arrays in terminal evidence", () => {
    const fixture = makeLauncherFixture();
    try {
      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "Show"),
        { behavior: "wrong-marker-identifier-types" },
      );
      expect(result.status, output(result)).toBe(70);
      expect(invocations(fixture)).toHaveLength(1);
      const incident = JSON.parse(
        readFileSync(fixture.incidentPath, "utf8"),
      ) as { reason: string };
      expect(incident.reason).toBe("controller-terminal-invalid");
    } finally {
      fixture.cleanup();
    }
  }, 15_000);

  it("treats every terminal marker accompanied by a live lease as an incident", async () => {
    for (const behavior of [
      "marker-and-lease-success" as const,
      "marker-and-lease-failure" as const,
    ]) {
      const fixture = makeLauncherFixture();
      const janvim = await startFakeJanVim(fixture);
      try {
        const result = runLauncher(
          fixture,
          launcherArguments(fixture, "Show"),
          {
            behavior,
            janvimPid: janvim.pid,
            janvimStartedAtUtc: janvim.startedAtUtc,
            janvimExecutableSha256: janvim.executableSha256,
          },
        );
        expect(result.status, output(result)).toBe(70);
        expect(invocations(fixture)).toHaveLength(1);
        expect(existsSync(fixture.closeLog)).toBe(false);
        expect(existsSync(fixture.leasePath)).toBe(true);
        expect(await waitForExit(janvim.child, 100)).toBe(false);
        expect(existsSync(fixture.incidentPath)).toBe(true);
      } finally {
        janvim.child.kill();
        await waitForExit(janvim.child, 2_000);
        fixture.cleanup();
      }
    }
  }, 30_000);

  it("durably records each eligible retry before the next controller observes it", () => {
    const fixture = makeLauncherFixture();
    try {
      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "Show"),
        { behavior: "crash-three-then-success", timeoutMs: 35_000 },
      );
      const records = invocations(fixture);
      const retryDiagnostic = [
        output(result),
        existsSync(fixture.watchdogAttempts)
          ? readFileSync(fixture.watchdogAttempts, "utf8")
          : "watchdog-attempts-missing",
        existsSync(fixture.sequenceLog)
          ? readFileSync(fixture.sequenceLog, "utf8")
          : "sequence-log-missing",
      ].join("\n");

      expect(result.status, retryDiagnostic).toBe(0);
      expect(records).toHaveLength(4);
      expect(existsSync(fixture.watchdogAttempts)).toBe(true);

      const serialized = readFileSync(fixture.watchdogAttempts, "utf8");
      const events = watchdogAttemptRecords(fixture);
      expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(4_096);
      expect(serialized.endsWith("\n")).toBe(true);
      expect(events).toHaveLength(3);
      expect(events.map((event) => [event.attempt, event.delayMs])).toEqual([
        [1, 1_000],
        [2, 2_000],
        [3, 4_000],
      ]);
      for (const [index, event] of events.entries()) {
        expect(Object.keys(event)).toEqual([
          "schema",
          "runId",
          "failedControllerRunId",
          "failedControllerPid",
          "failedControllerExitCode",
          "attempt",
          "delayMs",
          "observedAtMonotonicMs",
        ]);
        expect(event.schema).toBe(1);
        expect(event.runId).toBe(fixture.runId);
        expect(event.failedControllerRunId).toBe(
          flag(records[index]!.arguments, "controller-run-id"),
        );
        expect(event.failedControllerPid).toBe(records[index]!.controllerPid);
        expect(event.failedControllerExitCode).toBe(9);
        expect(Number.isInteger(event.observedAtMonotonicMs)).toBe(true);
        expect(event.observedAtMonotonicMs).toBeGreaterThanOrEqual(0);
        expect(event.observedAtMonotonicMs).toBeLessThanOrEqual(600_000);
        if (index > 0) {
          expect(event.observedAtMonotonicMs).toBeGreaterThan(
            events[index - 1]!.observedAtMonotonicMs,
          );
        }
      }
      expect(records.map((record) => record.observedWatchdogAttempts)).toEqual([
        [],
        events.slice(0, 1),
        events.slice(0, 2),
        events,
      ]);
      expect(serialized).not.toMatch(
        /token|secret|command|environment|stdout|stderr|content/iu,
      );

      writeFileSync(fixture.watchdogAttempts, "", { flag: "a" });
      expect(watchdogAttemptRecords(fixture)).toEqual(events);
    } finally {
      fixture.cleanup();
    }
  }, 45_000);

  it("relaunches unexpected exits after 1000/2000/4000 ms and then stops", () => {
    const fixture = makeLauncherFixture();
    try {
      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "Show"),
        { behavior: "crash", timeoutMs: 20_000 },
      );
      expect(result.status).not.toBe(0);
      const records = invocations(fixture);
      const retryDiagnostic = [
        output(result),
        existsSync(fixture.watchdogAttempts)
          ? readFileSync(fixture.watchdogAttempts, "utf8")
          : "watchdog-attempts-missing",
        existsSync(fixture.sequenceLog)
          ? readFileSync(fixture.sequenceLog, "utf8")
          : "sequence-log-missing",
      ].join("\n");
      expect(records, retryDiagnostic).toHaveLength(4);
      const deltas = records.slice(1).map((record, index) =>
        record.atMs - records[index]!.atMs,
      );
      expect(deltas[0]).toBeGreaterThanOrEqual(950);
      expect(deltas[0]).toBeLessThan(4_000);
      expect(deltas[1]).toBeGreaterThanOrEqual(1_950);
      expect(deltas[1]).toBeLessThan(5_000);
      expect(deltas[2]).toBeGreaterThanOrEqual(3_950);
      expect(deltas[2]).toBeLessThan(7_500);
      const controllerRunIds = records.map((record) =>
        flag(record.arguments, "controller-run-id"),
      );
      expect(new Set(controllerRunIds).size).toBe(4);
      for (const record of records) {
        expect(record.arguments.join("\n")).not.toMatch(/checkpoint|resume|loop-id/iu);
      }
      expect(existsSync(fixture.incidentPath)).toBe(true);
      expect(existsSync(fixture.watchdogAttempts)).toBe(true);
      const events = watchdogAttemptRecords(fixture);
      expect(events.map((event) => [event.attempt, event.delayMs])).toEqual([
        [1, 1_000],
        [2, 2_000],
        [3, 4_000],
      ]);
      expect(events).toHaveLength(3);
      expect(Buffer.byteLength(readFileSync(fixture.watchdogAttempts))).toBeLessThanOrEqual(
        4_096,
      );
      writeFileSync(fixture.watchdogAttempts, "", { flag: "a" });
    } finally {
      fixture.cleanup();
    }
  }, 25_000);

  it("times out a 3000 ms close helper at 2000 ms without settling or forcing the child", async () => {
    const fixture = makeLauncherFixture();
    const janvim = await startFakeJanVim(fixture);
    try {
      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "Show"),
        {
          behavior: "lease-then-success",
          closeHelperSleepMs: 3_000,
          janvimPid: janvim.pid,
          janvimStartedAtUtc: janvim.startedAtUtc,
          janvimExecutableSha256: janvim.executableSha256,
          timeoutMs: 22_000,
        },
      );
      const lifecycle = closeLifecycleRecords(fixture);

      expect(result.error).toBeUndefined();
      expect(result.status, output(result)).toBe(70);
      expect(invocations(fixture)).toHaveLength(1);
      expect(lifecycle.map((record) => record.event)).toEqual(["started"]);
      expect(Date.now() - lifecycle[0]!.atMs).toBeGreaterThanOrEqual(1_800);
      expect(Date.now() - lifecycle[0]!.atMs).toBeLessThan(3_000);
      expect(existsSync(fixture.leasePath)).toBe(true);
      expect(await waitForExit(janvim.child, 100)).toBe(false);
      expect(existsSync(fixture.watchdogAttempts)).toBe(false);
      const incident = JSON.parse(
        readFileSync(fixture.incidentPath, "utf8"),
      ) as { reason: string };
      expect(incident.reason).toBe("run-lease-unprovable");
    } finally {
      janvim.child.kill();
      await waitForExit(janvim.child, 2_000);
      fixture.cleanup();
    }
  }, 35_000);

  it("keeps the fast helper separate from the 5000 ms child wait before exact force-stop", async () => {
    const fixture = makeLauncherFixture();
    const janvim = await startFakeJanVim(fixture);
    try {
      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "Show"),
        {
          behavior: "lease-then-success",
          janvimPid: janvim.pid,
          janvimStartedAtUtc: janvim.startedAtUtc,
          janvimExecutableSha256: janvim.executableSha256,
          timeoutMs: 20_000,
        },
      );
      const leaseDiagnostic = existsSync(fixture.leasePath)
        ? readFileSync(fixture.leasePath, "utf8")
        : "lease-missing";
      const retryDiagnostic = existsSync(fixture.watchdogAttempts)
        ? readFileSync(fixture.watchdogAttempts, "utf8")
        : "watchdog-attempts-missing";
      const sequenceDiagnostic = existsSync(fixture.sequenceLog)
        ? readFileSync(fixture.sequenceLog, "utf8")
        : "sequence-log-missing";
      expect(
        result.status,
        `${output(result)}\n${leaseDiagnostic}\n${retryDiagnostic}\n${sequenceDiagnostic}`,
      ).toBe(0);
      const invocationRecords = invocations(fixture);
      expect(invocationRecords).toHaveLength(2);
      const closeRecords = readFileSync(fixture.closeLog, "utf8")
        .trim()
        .split(/\r?\n/u)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { pid: number; hwnd: string });
      expect(closeRecords).toEqual([
        { pid: janvim.pid, hwnd: "0x0000000000001234" },
      ]);
      const lifecycle = closeLifecycleRecords(fixture);
      expect(lifecycle.map((record) => record.event)).toEqual([
        "started",
        "completed",
      ]);
      expect(invocationRecords[1]!.atMs - lifecycle[1]!.atMs).toBeGreaterThanOrEqual(
        5_800,
      );
      expect(invocationRecords[1]!.atMs - lifecycle[1]!.atMs).toBeLessThan(
        12_000,
      );
      expect(await waitForExit(janvim.child, 2_000)).toBe(true);
      expect(existsSync(fixture.leasePath)).toBe(false);
      expect(watchdogAttemptRecords(fixture)).toHaveLength(1);
    } finally {
      if (!(await waitForExit(janvim.child, 100))) janvim.child.kill();
      fixture.cleanup();
    }
  }, 25_000);

  it("rechecks OfflineRequired immediately before invoking the exact close helper", async () => {
    const fixture = makeLauncherFixture();
    const janvim = await startFakeJanVim(fixture);
    try {
      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "Show"),
        {
          behavior: "lease-then-success",
          routeCounts: [0, 0, 0, 1],
          janvimPid: janvim.pid,
          janvimStartedAtUtc: janvim.startedAtUtc,
          janvimExecutableSha256: janvim.executableSha256,
          timeoutMs: 20_000,
        },
      );
      expect(result.status, output(result)).toBe(70);
      expect(invocations(fixture)).toHaveLength(1);
      expect(existsSync(fixture.closeLog)).toBe(false);
      expect(existsSync(fixture.leasePath)).toBe(true);
      expect(await waitForExit(janvim.child, 100)).toBe(false);
      expect(existsSync(fixture.incidentPath)).toBe(true);
    } finally {
      janvim.child.kill();
      await waitForExit(janvim.child, 2_000);
      fixture.cleanup();
    }
  }, 25_000);

  it("holds the proven lease exclusively across close, kill, and exact deletion", async () => {
    const fixture = makeLauncherFixture();
    const janvim = await startFakeJanVim(fixture);
    try {
      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "Show"),
        {
          behavior: "lease-then-success",
          closeLeaseMutation: "attempt-replace",
          janvimPid: janvim.pid,
          janvimStartedAtUtc: janvim.startedAtUtc,
          janvimExecutableSha256: janvim.executableSha256,
          timeoutMs: 20_000,
        },
      );
      const mutationDiagnostic = existsSync(fixture.leaseMutationLog)
        ? readFileSync(fixture.leaseMutationLog, "utf8").trim()
        : "mutation-log-missing";
      expect(result.status, `${output(result)}\n${mutationDiagnostic}`).toBe(0);
      expect(mutationDiagnostic).toBe("blocked:80070020");
      expect(invocations(fixture)).toHaveLength(2);
      expect(await waitForExit(janvim.child, 2_000)).toBe(true);
      expect(existsSync(fixture.leasePath)).toBe(false);
    } finally {
      if (!(await waitForExit(janvim.child, 100))) janvim.child.kill();
      fixture.cleanup();
    }
  }, 25_000);

  it("bounds close-helper output and rejects a false ownership receipt", async () => {
    for (const closeOptions of [
      { closeOutputBytes: 8_192 },
      { closeReceipt: "ownership-false" as const },
    ]) {
      const fixture = makeLauncherFixture();
      const janvim = await startFakeJanVim(fixture);
      try {
        const result = runLauncher(
          fixture,
          launcherArguments(fixture, "Show"),
          {
            behavior: "lease-then-success",
            janvimPid: janvim.pid,
            janvimStartedAtUtc: janvim.startedAtUtc,
            janvimExecutableSha256: janvim.executableSha256,
            timeoutMs: 20_000,
            ...closeOptions,
          },
        );
        expect(result.status).not.toBe(0);
        expect(invocations(fixture)).toHaveLength(1);
        expect(existsSync(fixture.closeLog)).toBe(true);
        expect(existsSync(fixture.leasePath)).toBe(true);
        expect(await waitForExit(janvim.child, 100)).toBe(false);
        expect(existsSync(fixture.incidentPath)).toBe(true);
      } finally {
        janvim.child.kill();
        await waitForExit(janvim.child, 2_000);
        fixture.cleanup();
      }
    }
  }, 35_000);

  it("rejects coercible non-boolean close ownership fields", async () => {
    const fixture = makeLauncherFixture();
    const janvim = await startFakeJanVim(fixture);
    try {
      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "Show"),
        {
          behavior: "lease-then-success",
          closeReceipt: "coercible-booleans",
          janvimPid: janvim.pid,
          janvimStartedAtUtc: janvim.startedAtUtc,
          janvimExecutableSha256: janvim.executableSha256,
          timeoutMs: 20_000,
        },
      );
      expect(result.status).toBe(70);
      expect(invocations(fixture)).toHaveLength(1);
      expect(existsSync(fixture.leasePath)).toBe(true);
      expect(await waitForExit(janvim.child, 100)).toBe(false);
      expect(existsSync(fixture.incidentPath)).toBe(true);
    } finally {
      janvim.child.kill();
      await waitForExit(janvim.child, 2_000);
      fixture.cleanup();
    }
  }, 25_000);

  it("leaves a mismatched lease and child untouched for operator intervention", async () => {
    const fixture = makeLauncherFixture();
    const janvim = await startFakeJanVim(fixture);
    try {
      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "Show"),
        {
          behavior: "mismatched-lease",
          janvimPid: janvim.pid,
          janvimStartedAtUtc: janvim.startedAtUtc,
          janvimExecutableSha256: janvim.executableSha256,
          timeoutMs: 20_000,
        },
      );
      expect(result.status).not.toBe(0);
      expect(invocations(fixture)).toHaveLength(1);
      expect(existsSync(fixture.closeLog)).toBe(false);
      expect(existsSync(fixture.leasePath)).toBe(true);
      expect(await waitForExit(janvim.child, 100)).toBe(false);
      expect(existsSync(fixture.incidentPath)).toBe(true);
    } finally {
      janvim.child.kill();
      await waitForExit(janvim.child, 2_000);
      fixture.cleanup();
    }
  }, 25_000);

  it("does not close, kill, delete, or relaunch an unprovable lease", () => {
    const fixture = makeLauncherFixture();
    try {
      const result = runLauncher(
        fixture,
        launcherArguments(fixture, "Show"),
        { behavior: "unprovable-lease" },
      );
      expect(result.status).not.toBe(0);
      expect(invocations(fixture)).toHaveLength(1);
      expect(existsSync(fixture.closeLog)).toBe(false);
      expect(existsSync(fixture.leasePath)).toBe(true);
      expect(existsSync(fixture.incidentPath)).toBe(true);
    } finally {
      fixture.cleanup();
    }
  }, 15_000);
});
