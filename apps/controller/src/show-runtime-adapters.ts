import { execFile as nodeExecFile, spawn as nodeSpawn } from "node:child_process";
import {
  createHash,
  randomBytes as nodeRandomBytes,
  randomUUID,
} from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, win32 } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import {
  parseShowManifest,
  type AgentAck,
  type AgentCommand,
  type Cue,
  type RendererEvent,
  type RendererToControllerEvent,
  type ShowManifest,
} from "@janvim-exhibition/show-schema";

import {
  FileLogStorage,
  RunLogBudget,
  type LogStorage,
  type RunLogStream,
} from "./bounded-log.js";
import { BridgeServer } from "./bridge-server.js";
import {
  createSecondaryWindowPlan,
  routeDisplays,
  type DisplayRoute,
  type Rectangle,
  type RuntimeDisplay,
} from "./display-router.js";
import type {
  G2BrowserWindowConstructor,
  G2BrowserWindowAdapter,
  G2BridgeServerAdapter,
  G2ExecFileAdapter,
  G2RuntimeAdapterHost,
  G2SpawnedChild,
} from "./g2-runtime-adapters.js";
import {
  G2_PROTECTED_ROOTS,
  G2_REHEARSAL_PARENT,
} from "./g2-command.js";
import { launchJanVimProcess } from "./janvim-process.js";
import type {
  JanVimProcessDependencies,
  SpawnAdapter,
} from "./janvim-process.js";
import {
  bindLocalRendererEvents,
  DeterministicShowLoop,
  type DeterministicShowLoopState,
} from "./main.js";
import { MultiLoopDriver } from "./multi-loop-driver.js";
import type {
  OneLoopRuntime,
  OneLoopTimerAdapter,
  OneLoopTimerHandle,
} from "./one-loop-driver.js";
import { SHOW_EVENT_CHANNEL } from "./preload.js";
import { parseConfirmedRehearsalDisplayMap } from "./rehearsal-display-map.js";
import { ResourceSampler } from "./resource-sampler.js";
import {
  assertFrozenSnapshotUnchanged,
  installLocalOnlyWebGuards,
  readFrozenRuntimeSnapshot,
  resolveBelowRoot,
  type FrozenRuntimeSnapshot,
} from "./runtime-adapter-common.js";
import {
  removeRunLeaseAfterSettlement,
  replaceRunLeaseGenerationAtomic,
  writeRunLeaseAtomic,
  type RunLease,
} from "./run-lease.js";
import { RunTelemetry } from "./run-telemetry.js";
import type { ShowCommand } from "./show-command.js";
import type {
  RunShowCommand,
  ShowElectronCommandAdapters,
} from "./show-electron-command.js";
import type {
  NetworkSnapshotEvidence,
  ShowRunEvidenceRecord,
} from "./show-run-evidence.js";
import {
  evaluateShowAcceptance,
  TASK9_ARTIFACT_IDENTITY,
  writeShowRunEvidenceAtomic,
} from "./show-run-evidence.js";
import {
  ShowRunCoordinator,
  type CoordinatorDiagnostics,
  type PrimaryCueCompletionEvent,
  type PrimaryEditorDispatchEvent,
  type ShowRunResult,
  type ShowRunSession,
  type ShowSecondarySurface,
} from "./show-run-coordinator.js";
import { placeJanVimWindow, type WindowPlacementReceipt } from "./window-placer.js";
import { closePlacedJanVimWindow } from "./window-closer.js";

const JANVIM_PRODUCT_ROOT = "D:\\github\\JanVim";
const P1_SKIP_COUNT = 3;
const RUN_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const LOOP_ID_MAX_BYTES = 64;
const LOOP_ID_HASH_CHARACTERS = 12;
const NETWORK_SNAPSHOT_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  "$routes=@(Get-NetRoute -ErrorAction Stop|Select-Object -First 1025|ForEach-Object{[pscustomobject]@{State=[string]$_.State;DestinationPrefix=[string]$_.DestinationPrefix}})",
  "if($routes.Count -gt 1024){throw 'network-route-cap-exceeded'}",
  "$activeExternalRoutes=@($routes|Where-Object{$_.State -ceq 'Alive' -and ($_.DestinationPrefix -ceq '0.0.0.0/0' -or $_.DestinationPrefix -ceq '::/0')}).Count",
  "$profiles=@(Get-NetConnectionProfile -ErrorAction Stop|Select-Object -First 257|ForEach-Object{[pscustomobject]@{IPv4Connectivity=[string]$_.IPv4Connectivity;IPv6Connectivity=[string]$_.IPv6Connectivity}})",
  "if($profiles.Count -gt 256){throw 'network-profile-cap-exceeded'}",
  "$connectedExternalProfiles=@($profiles|Where-Object{$_.IPv4Connectivity -cin @('Subnet','LocalNetwork','Internet') -or $_.IPv6Connectivity -cin @('Subnet','LocalNetwork','Internet')}).Count",
  "[ordered]@{schema=1;activeExternalDefaultRoutes=$activeExternalRoutes;connectedExternalProfiles=$connectedExternalProfiles}|ConvertTo-Json -Compress",
].join(";");
const PROCESS_SAMPLE_SCRIPT = [
  "& { param([int]$ProcessId)",
  "$sample=Get-Process -Id $ProcessId -ErrorAction Stop",
  "[ordered]@{schema=1;rssBytes=[int64]$sample.WorkingSet64;handleCount=[int64]$sample.HandleCount}|ConvertTo-Json -Compress",
  "} @args",
].join(";");
const PROCESS_IDENTITY_SCRIPT = [
  "& { param([int]$ProcessId)",
  "$sample=Get-Process -Id $ProcessId -ErrorAction Stop",
  "$started=$sample.StartTime.ToUniversalTime().ToString('o')",
  "[ordered]@{schema=1;startedAtUtc=$started}|ConvertTo-Json -Compress",
  "} @args",
].join(";");

export interface ShowControllerProcessAdapter {
  readonly pid: number;
  readonly startedAtUtc: string;
  on(event: "SIGINT", listener: () => void): void;
  removeListener(event: "SIGINT", listener: () => void): void;
}

export interface ShowElectronAppAdapter {
  on(
    event: "before-quit",
    listener: (event: { preventDefault(): void }) => void,
  ): void;
  removeListener(
    event: "before-quit",
    listener: (event: { preventDefault(): void }) => void,
  ): void;
}

export interface ShowRuntimeDisplay {
  displayId: string | number;
  bounds: Rectangle;
  workingArea: Rectangle;
  scaleFactor: number;
  rotation: 0 | 90 | 180 | 270;
}

export interface ShowRuntimeAdapterHost
  extends Omit<G2RuntimeAdapterHost, "BrowserWindow" | "screen"> {
  BrowserWindow: G2BrowserWindowConstructor;
  screen: { getAllDisplays(): readonly unknown[] };
  controllerProcess: ShowControllerProcessAdapter;
  electronApp: ShowElectronAppAdapter;
  sampleProcess?(pid: number): Promise<{ rssBytes: number; handleCount: number }>;
  inspectProcessStartedAtUtc?(pid: number): Promise<string>;
  realpath?(path: string): string;
  writeRunLease?(path: string, lease: RunLease): Promise<void>;
  replaceRunLease?(
    path: string,
    expected: RunLease,
    nextGenerationId: number,
  ): Promise<RunLease>;
  removeRunLease?(path: string, lease: RunLease): Promise<boolean>;
  // Custom publication hosts must check the signal immediately before commit.
  writeShowEvidence?(
    path: string,
    value: unknown,
    signal: AbortSignal,
  ): Promise<void>;
  writeTerminalMarker?(
    path: string,
    value: unknown,
    signal: AbortSignal,
  ): Promise<void>;
  secondaryEntryUrl?: string;
  bridgeHost?: string;
  logStorage?: LogStorage;
}

type ArtifactLock = z.infer<typeof artifactLockSchema>;

interface ValidatedShowInputs {
  readonly command: ShowCommand;
  readonly snapshot: FrozenRuntimeSnapshot;
  readonly lock: ArtifactLock;
  readonly manifest: ShowManifest;
  readonly poem: Buffer;
  readonly displayMap: ReturnType<typeof parseConfirmedRehearsalDisplayMap>;
  readonly displayRoute: Extract<DisplayRoute, { state: "mapped" }>;
  readonly liveDisplays: readonly ShowRuntimeDisplay[];
  readonly startupNetworkSnapshot: NetworkSnapshotEvidence;
}

interface NormalizedShowHost {
  readonly source: ShowRuntimeAdapterHost;
  readonly repositoryRoot: string;
  readonly readFile: (path: string) => Buffer;
  readonly realpath: (path: string) => string;
  readonly execFile: G2ExecFileAdapter;
  readonly nowMonotonic: () => number;
  readonly randomBytes: (size: number) => Buffer;
  readonly runWithDeadline: <T>(
    timeoutMs: number,
    operation: () => Promise<T>,
  ) => Promise<T>;
  readonly logStorage: LogStorage;
  readonly timers: OneLoopTimerAdapter;
  readonly baseEnvironment: NodeJS.ProcessEnv;
  readonly spawn: SpawnAdapter;
  readonly verifyArtifact: JanVimProcessDependencies["verifyArtifact"];
  readonly createBridge: (token: string) => ShowBridgeAdapter;
  readonly sampleProcess: (
    pid: number,
  ) => Promise<{ rssBytes: number; handleCount: number }>;
  readonly inspectProcessStartedAtUtc: (pid: number) => Promise<string>;
  readonly writeShowEvidence: (
    path: string,
    value: unknown,
    signal: AbortSignal,
  ) => Promise<void>;
  readonly writeTerminalMarker: (
    path: string,
    value: unknown,
    signal: AbortSignal,
  ) => Promise<void>;
  readonly writeRunLease: (path: string, lease: RunLease) => Promise<void>;
  readonly replaceRunLease: (
    path: string,
    expected: RunLease,
    nextGenerationId: number,
  ) => Promise<RunLease>;
  readonly removeRunLease: (path: string, lease: RunLease) => Promise<boolean>;
}

export function createShowRuntimeAdapters(
  source: ShowRuntimeAdapterHost,
): ShowElectronCommandAdapters {
  const host = normalizeShowHost(source);
  const lifecycle = new EmergencyLifecycleHub(
    source.controllerProcess,
    source.electronApp,
  );

  return {
    validate: async (command) => {
      const inputs = await validateShowInputs(host, command);
      assertFrozenSnapshotUnchanged(inputs.snapshot);
    },
    createCoordinator: (command) => createCoordinator(host, command, lifecycle),
    bindEmergencyLifecycle: (listener) => lifecycle.bind(listener),
  };
}

export function createShowLoopId(
  runId: string,
  generationId: number,
  loopNumber: number,
): string {
  if (
    !RUN_ID_PATTERN.test(runId) ||
    !Number.isSafeInteger(generationId) ||
    generationId <= 0 ||
    !Number.isSafeInteger(loopNumber) ||
    loopNumber <= 0
  ) {
    throw new Error("show-loop-identity-invalid");
  }
  const suffix = `-g${generationId}-l${loopNumber}`;
  const direct = `${runId}${suffix}`;
  if (Buffer.byteLength(direct, "utf8") <= LOOP_ID_MAX_BYTES) return direct;

  const digest = createHash("sha256")
    .update(runId, "utf8")
    .digest("hex")
    .slice(0, LOOP_ID_HASH_CHARACTERS);
  const prefixLength =
    LOOP_ID_MAX_BYTES - suffix.length - LOOP_ID_HASH_CHARACTERS - 1;
  if (prefixLength < 1) throw new Error("show-loop-identity-too-large");
  return `${runId.slice(0, prefixLength)}-${digest}${suffix}`;
}

export function controllerStartedAtUtc(creationTimeMs: number | null): string {
  if (
    !Number.isSafeInteger(creationTimeMs) ||
    creationTimeMs === null ||
    creationTimeMs <= 0
  ) {
    throw new Error("controller-process-creation-time-invalid");
  }
  try {
    return new Date(creationTimeMs).toISOString();
  } catch {
    throw new Error("controller-process-creation-time-invalid");
  }
}

function createCoordinator(
  host: NormalizedShowHost,
  command: RunShowCommand,
  lifecycle: EmergencyLifecycleHub,
): ShowRunCoordinator {
  const paths = showRuntimePaths(host.repositoryRoot, command.rehearsalRoot);
  const logger = new RuntimeLogger(
    host.logStorage,
    resolveBelowRoot(command.rehearsalRoot, "show-run.log"),
    showLogSecrets(host.repositoryRoot),
  );
  let inputs: ValidatedShowInputs | undefined;
  let startupNetworkPending = false;
  let activeRendererPid: number | undefined;
  let activeJanVimPid: number | undefined;

  const requireInputs = (): ValidatedShowInputs => {
    if (inputs === undefined) throw new Error("show-inputs-not-validated");
    assertFrozenSnapshotUnchanged(inputs.snapshot);
    return inputs;
  };

  const coordinator = new ShowRunCoordinator({
    mode: command.mode,
    originalPoemSha256: "b699de273f5bbaedb08241495f52ce863d3e8e1851275ce3b6251484d75190a8",
    validate: async () => {
      inputs = await validateShowInputs(host, command);
      startupNetworkPending = true;
      for (const feature of ["formula", "image", "matrix"] as const) {
        if (!inputs.manifest.cues.some((cue) => cue.kind === feature)) {
          logger.writeJson("controller", {
            type: "p1-skip",
            feature,
            reason: "fixture-asset-absent",
          });
        }
      }
    },
    openSecondary: async (generationId, signal) => {
      const current = requireInputs();
      const surface = await openShowSecondary({
        host,
        command,
        generationId,
        signal,
        display: current.displayRoute.secondary,
        entryUrl: fixedEntryUrl(host.repositoryRoot),
        preloadPath: resolveBelowRoot(
          host.repositoryRoot,
          "apps\\controller\\dist\\preload\\preload.cjs",
        ),
        logger,
        lifecycle,
      });
      activeRendererPid = surface.rendererPid;
      return surface;
    },
    createSession: (generationId) => {
      const current = requireInputs();
      const session = new RuntimeShowSession({
        host,
        command,
        generationId,
        inputs: current,
        paths,
        logger,
        onPid: (pid) => {
          activeJanVimPid = pid;
        },
      });
      return session;
    },
    createDriver: (options) => new MultiLoopDriver(options),
    timers: host.timers,
    createTelemetry: () => new RunTelemetry(),
    createResourceSampler: () => {
      if (
        activeRendererPid === undefined ||
        activeJanVimPid === undefined ||
        !Number.isSafeInteger(host.source.controllerProcess.pid)
      ) {
        throw new Error("show-resource-pids-unavailable");
      }
      const sampler = new ResourceSampler({
        adapter: { sample: (pid) => host.sampleProcess(pid) },
        timers: host.timers,
      });
      sampler.start({
        controller: host.source.controllerProcess.pid,
        renderer: activeRendererPid,
        janvim: activeJanVimPid,
      });
      return sampler;
    },
    sampleNetwork: async () => {
      const current = requireInputs();
      if (startupNetworkPending) {
        startupNetworkPending = false;
        return { ...current.startupNetworkSnapshot };
      }
      return sampleNetwork(host);
    },
    finalizeEvidence: async (result, diagnostics, signal) => {
      if (
        command.mode === "Soak3" &&
        diagnostics.aggregate.completedLoops < 3
      ) {
        return "fail";
      }
      const current = requireInputs();
      const evidence = buildShowEvidence(
        command,
        current,
        result,
        diagnostics,
        logger,
      );
      const acceptance = evaluateShowAcceptance(evidence, {
        requestedResultOk: result.ok,
        diagnosticConnected: command.networkPolicy === "DiagnosticConnected",
      });
      evidence.aggregate.acceptanceOutcome = acceptance;
      await host.writeShowEvidence(
        paths.evidence,
        evidence,
        signal,
      );
      return acceptance;
    },
    writeTerminalMarker: async (result, signal) => {
      await host.writeTerminalMarker(
        paths.terminalMarker,
        {
          schema: 1,
          runId: command.runId,
          controllerRunId: command.controllerRunId,
          controllerPid: host.source.controllerProcess.pid,
          outcome: result.ok ? "intentional-success" : "intentional-failure",
          reason: result.reason,
        },
        signal,
      );
    },
    flushLogs: async () => undefined,
    nextLoopId: (generationId, loopNumber) =>
      createShowLoopId(command.runId, generationId, loopNumber),
    nowMs: host.nowMonotonic,
    log: (event) => logger.writeJson("controller", event),
  });

  return coordinator;
}

function normalizeShowHost(source: ShowRuntimeAdapterHost): NormalizedShowHost {
  if (!win32.isAbsolute(source.repositoryRoot)) {
    throw new Error("Show repository root must be an absolute Windows path");
  }
  if (source.bridgeHost !== undefined && source.bridgeHost !== "127.0.0.1") {
    throw new Error("Show bridge must use IPv4 loopback");
  }
  const repositoryRoot = win32.resolve(source.repositoryRoot);
  const expectedEntryUrl = fixedEntryUrl(repositoryRoot);
  if (
    source.secondaryEntryUrl !== undefined &&
    source.secondaryEntryUrl !== expectedEntryUrl
  ) {
    throw new Error("Secondary entry URL differs from the frozen local entry");
  }
  const readFile = source.readFile ?? ((path: string) => readFileSync(path));
  const execFile = source.execFile ?? executeFileBounded;
  return {
    source,
    repositoryRoot,
    readFile,
    realpath: source.realpath ?? ((path) => realpathSync.native(path)),
    execFile,
    nowMonotonic: source.nowMonotonic ?? (() => performance.now()),
    randomBytes: source.randomBytes ?? nodeRandomBytes,
    runWithDeadline: source.runWithDeadline ?? runWithDeadline,
    logStorage: source.logStorage ?? new FileLogStorage(),
    timers: source.timers ?? realTimers,
    baseEnvironment: source.baseEnvironment ?? process.env,
    spawn:
      source.spawn ??
      (((file, args, options) =>
        nodeSpawn(file, [...args], options)) as SpawnAdapter),
    verifyArtifact:
      source.verifyArtifact ??
      (async (lockPath, executablePath) => {
        try {
          const lock = artifactLockSchema.parse(
            JSON.parse(readFile(lockPath).toString("utf8")),
          );
          const executable = readFile(executablePath);
          return executable.byteLength === lock.coreBytes &&
            hash(executable) === lock.coreSha256
            ? { ok: true as const }
            : { ok: false as const, reason: "core-hash-mismatch" };
        } catch {
          return {
            ok: false as const,
            reason: "artifact-verification-failed",
          };
        }
      }),
    createBridge: (token) =>
      (source.createBridge?.(token) ??
        new BridgeServer({ token })) as ShowBridgeAdapter,
    sampleProcess:
      source.sampleProcess ??
      ((pid) => sampleProcessWithPowerShell(execFile, repositoryRoot, pid)),
    inspectProcessStartedAtUtc:
      source.inspectProcessStartedAtUtc ??
      ((pid) => inspectProcessStartedAtUtc(execFile, repositoryRoot, pid)),
    writeShowEvidence:
      source.writeShowEvidence ??
      ((path, value, signal) => {
        signal.throwIfAborted();
        return writeShowRunEvidenceAtomic(path, value);
      }),
    writeTerminalMarker:
      source.writeTerminalMarker ?? writeTerminalMarkerAtomic,
    writeRunLease: source.writeRunLease ?? writeRunLeaseAtomic,
    replaceRunLease:
      source.replaceRunLease ?? replaceRunLeaseGenerationAtomic,
    removeRunLease: source.removeRunLease ?? removeRunLeaseAfterSettlement,
  };
}

async function validateShowInputs(
  host: NormalizedShowHost,
  command: ShowCommand,
): Promise<ValidatedShowInputs> {
  assertCanonicalShowBoundaries(host, command);
  const paths = showRuntimePaths(host.repositoryRoot, command.rehearsalRoot);
  if (!pathsEqual(command.displayMapPath, paths.displayMap)) {
    throw new Error("Show display map path is not the fixed rehearsal map");
  }

  const verification = await host.execFile(
    "pwsh",
    ["-NoProfile", "-NonInteractive", "-File", paths.verifyRuntimeScript],
    {
      cwd: host.repositoryRoot,
      timeoutMs: 30_000,
      maxStdoutBytes: 8_192,
      maxStderrBytes: 8_192,
    },
  );
  if (
    verification.exitCode !== 0 ||
    Buffer.byteLength(verification.stdout, "utf8") > 8_192 ||
    Buffer.byteLength(verification.stderr, "utf8") > 8_192
  ) {
    throw new Error("runtime-verification-failed");
  }

  const snapshot = readFrozenRuntimeSnapshot({
    readFile: host.readFile,
    files: [
      { label: "artifact-lock", path: paths.artifactLock },
      { label: "show-config", path: paths.showConfig },
      { label: "show-manifest", path: paths.manifest },
      { label: "poem", path: paths.poem },
      { label: "plugin-lab-init", path: paths.pluginLabInit },
      { label: "display-map", path: paths.displayMap },
      {
        label: "runtime-core",
        path: paths.janvimExecutable,
        expectedSize: TASK9_ARTIFACT_IDENTITY.coreBytes,
        expectedSha256: TASK9_ARTIFACT_IDENTITY.coreSha256,
      },
    ],
  });
  const file = (label: string): Buffer => {
    const match = snapshot.files.find((entry) => entry.label === label);
    if (match === undefined) throw new Error(`Missing frozen input: ${label}`);
    return Buffer.from(match.bytes);
  };

  const artifactLockFile = snapshot.files.find(
    (entry) => entry.label === "artifact-lock",
  );
  if (
    artifactLockFile === undefined ||
    artifactLockFile.sha256 !== TASK9_ARTIFACT_IDENTITY.lockSha256
  ) {
    throw new Error("artifact-lock-hash-mismatch");
  }

  const lock = artifactLockSchema.parse(
    JSON.parse(file("artifact-lock").toString("utf8")),
  );
  if (hash(file("show-config")) !== lock.configSha256) {
    throw new Error("show-config-hash-mismatch");
  }
  if (hash(file("plugin-lab-init")) !== lock.pluginLabConfigSha256) {
    throw new Error("plugin-lab-config-hash-mismatch");
  }
  const manifest = parseShowManifest(
    JSON.parse(file("show-manifest").toString("utf8")),
  );
  const poem = file("poem");
  if (hash(poem) !== manifest.poemSha256) {
    throw new Error("poem-hash-mismatch");
  }
  const displayMap = parseConfirmedRehearsalDisplayMap(
    JSON.parse(file("display-map").toString("utf8")),
  );
  const liveDisplays = normalizeShowDisplays(host.source.screen.getAllDisplays());
  const displayRoute = routeDisplays(liveDisplays, displayMap);
  if (displayRoute.state !== "mapped") {
    throw new Error(displayRoute.reason);
  }

  const artifactVerification = await host.verifyArtifact(
    paths.artifactLock,
    paths.janvimExecutable,
  );
  if (!artifactVerification.ok) {
    throw new Error(
      artifactVerification.reason,
    );
  }

  const startupNetworkSnapshot = await sampleNetwork(host);
  if (
    command.networkPolicy === "OfflineRequired" &&
    !startupNetworkSnapshot.offline
  ) {
    throw new Error("offline-required-network-active");
  }

  return {
    command,
    snapshot,
    lock,
    manifest,
    poem,
    displayMap,
    displayRoute,
    liveDisplays,
    startupNetworkSnapshot,
  };
}

function assertCanonicalShowBoundaries(
  host: NormalizedShowHost,
  command: ShowCommand,
): void {
  const repositoryRoot = canonicalShowPath(
    host,
    host.repositoryRoot,
    "repository root",
  );
  const rehearsalParent = canonicalShowPath(
    host,
    G2_REHEARSAL_PARENT,
    "rehearsal parent",
  );
  const rehearsalRoot = canonicalShowPath(
    host,
    command.rehearsalRoot,
    "rehearsal root",
  );
  const displayMap = canonicalShowPath(
    host,
    command.displayMapPath,
    "display map",
  );

  if (
    !pathsEqual(win32.dirname(rehearsalRoot), rehearsalParent) ||
    win32.basename(rehearsalRoot) !== command.runId
  ) {
    throw new Error(
      "Show rehearsal canonical path is not one direct rehearsal child",
    );
  }
  if (
    !pathsEqual(win32.dirname(displayMap), rehearsalRoot) ||
    win32.basename(displayMap).toLowerCase() !== "display-map.json"
  ) {
    throw new Error("Show display-map canonical path escaped the rehearsal root");
  }

  const lexicalForbiddenRoots = [
    repositoryRoot,
    JANVIM_PRODUCT_ROOT,
    ...G2_PROTECTED_ROOTS,
    ...userNvimRoots(host.baseEnvironment),
  ];
  const forbiddenRoots = new Set<string>();
  for (const root of lexicalForbiddenRoots) {
    forbiddenRoots.add(normalizeCanonicalWindowsPath(root));
    try {
      forbiddenRoots.add(canonicalShowPath(host, root, "forbidden root"));
    } catch {
      // Optional forbidden roots need not exist; their lexical boundary remains active.
    }
  }
  for (const candidate of [rehearsalRoot, displayMap]) {
    if (
      [...forbiddenRoots].some((root) => isAtOrBelow(candidate, root)) ||
      containsUserNvimConfig(candidate)
    ) {
      throw new Error("Show rehearsal real path targets a forbidden root");
    }
  }
}

function canonicalShowPath(
  host: NormalizedShowHost,
  path: string,
  label: string,
): string {
  try {
    return normalizeCanonicalWindowsPath(host.realpath(path));
  } catch {
    throw new Error(`Show ${label} real path is unavailable`);
  }
}

function normalizeCanonicalWindowsPath(path: string): string {
  let normalized = path;
  if (normalized.startsWith("\\\\?\\UNC\\")) {
    normalized = `\\\\${normalized.slice(8)}`;
  } else if (normalized.startsWith("\\\\?\\")) {
    normalized = normalized.slice(4);
  }
  if (!win32.isAbsolute(normalized)) {
    throw new Error("Show canonical path is not absolute");
  }
  return win32.resolve(normalized);
}

function userNvimRoots(environment: NodeJS.ProcessEnv): readonly string[] {
  const entry = (name: string): string | undefined =>
    Object.entries(environment).find(
      ([key, value]) => key.toUpperCase() === name && value !== undefined,
    )?.[1];
  const localAppData = entry("LOCALAPPDATA");
  const userProfile = entry("USERPROFILE");
  return [
    ...(localAppData === undefined ? [] : [win32.join(localAppData, "nvim")]),
    ...(userProfile === undefined
      ? []
      : [win32.join(userProfile, "AppData", "Local", "nvim")]),
  ];
}

async function sampleNetwork(
  host: NormalizedShowHost,
): Promise<NetworkSnapshotEvidence> {
  const result = await host.execFile(
    "pwsh",
    ["-NoProfile", "-NonInteractive", "-Command", NETWORK_SNAPSHOT_SCRIPT],
    {
      cwd: host.repositoryRoot,
      timeoutMs: 2_000,
      maxStdoutBytes: 16_384,
      maxStderrBytes: 16_384,
    },
  );
  if (
    result.exitCode !== 0 ||
    Buffer.byteLength(result.stdout, "utf8") > 16_384 ||
    Buffer.byteLength(result.stderr, "utf8") > 16_384
  ) {
    throw new Error("network-snapshot-failed");
  }
  const parsed = networkSnapshotSchema.parse(JSON.parse(result.stdout));
  return {
    sampledAtMs: host.nowMonotonic(),
    activeExternalDefaultRoutes: parsed.activeExternalDefaultRoutes,
    connectedExternalProfiles: parsed.connectedExternalProfiles,
    offline:
      parsed.activeExternalDefaultRoutes === 0 &&
      parsed.connectedExternalProfiles === 0,
  };
}

function buildShowEvidence(
  command: RunShowCommand,
  inputs: ValidatedShowInputs,
  result: ShowRunResult,
  diagnostics: CoordinatorDiagnostics,
  logger: RuntimeLogger,
): ShowRunEvidenceRecord {
  assertFrozenSnapshotUnchanged(inputs.snapshot);
  const file = (label: string) => {
    const match = inputs.snapshot.files.find((entry) => entry.label === label);
    if (match === undefined) throw new Error(`Missing frozen input: ${label}`);
    return match;
  };
  const liveRole = (id: string): ShowRuntimeDisplay => {
    const display = inputs.liveDisplays.find(
      (candidate) => String(candidate.displayId) === id,
    );
    if (display === undefined) throw new Error("show-live-display-missing");
    return display;
  };
  const primaryLive = liveRole(inputs.displayMap.primary.displayId);
  const secondaryLive = liveRole(inputs.displayMap.secondary.displayId);
  const offlineSnapshots = diagnostics.offlineSnapshots.map((snapshot) => ({
    ...snapshot,
  }));
  const offlineSampleCount = diagnostics.aggregate.offlineSampleCount;
  const onlineSampleCount = diagnostics.aggregate.onlineSampleCount;
  const offlineVerified =
    command.networkPolicy === "OfflineRequired" &&
    offlineSampleCount + onlineSampleCount > 0 &&
    onlineSampleCount === 0;
  const shutdownFailures = new Set(diagnostics.shutdown.failures);
  const shutdown = {
    requestedBy: requestedBy(diagnostics.shutdown.requestedReason ?? result.reason),
    agentShutdown: shutdownFailures.has("agent-shutdown-failed")
      ? ("failed" as const)
      : ("acknowledged" as const),
    hwndClose: shutdownFailures.has("hwnd-close-failed")
      ? ("failed" as const)
      : ("posted" as const),
    janvimExit: !diagnostics.shutdown.childSettled
      ? ("unsettled" as const)
      : diagnostics.shutdown.forcedTermination
        ? ("forced" as const)
        : ("natural" as const),
    bridgeClose:
      !diagnostics.shutdown.bridgeClosed ||
      shutdownFailures.has("bridge-close-failed")
      ? ("failed" as const)
      : ("closed" as const),
    leaseRemoved: diagnostics.shutdown.leaseRemoved,
  };
  const loops = diagnostics.loops.map((loop, index) => ({
    ...loop,
    retryCount:
      index === diagnostics.loops.length - 1
        ? diagnostics.aggregate.automaticRecoveryRetryCount
        : 0,
    skipCount:
      command.mode === "Soak3" && index === 0 ? P1_SKIP_COUNT : 0,
    recoveryCount:
      index === diagnostics.loops.length - 1
        ? diagnostics.aggregate.recoveryEventCount
        : 0,
  }));
  const loggingIncomplete = logger.snapshot().incomplete;
  return {
    schema: 2,
    runId: command.runId,
    controllerRunId: command.controllerRunId,
    mode: command.mode,
    acceptanceScope: "monitor-simulation",
    physicalProjectorsTested: false,
    display: {
      mapSha256: file("display-map").sha256,
      primary: {
        id: inputs.displayMap.primary.displayId,
        bounds: { ...primaryLive.bounds },
        workingArea: { ...primaryLive.workingArea },
        scaleFactor: primaryLive.scaleFactor,
        rotation: primaryLive.rotation,
        geometrySha256: inputs.displayMap.primary.geometrySha256,
      },
      secondary: {
        id: inputs.displayMap.secondary.displayId,
        bounds: { ...secondaryLive.bounds },
        workingArea: { ...secondaryLive.workingArea },
        scaleFactor: secondaryLive.scaleFactor,
        rotation: secondaryLive.rotation,
        geometrySha256: inputs.displayMap.secondary.geometrySha256,
      },
    },
    artifact: {
      tag: "v0.10.1-gmk.4",
      commit: "e95633101d93f8448b0f906e918b5d836ab95273",
      layoutEngine: "orthogonal",
      ...TASK9_ARTIFACT_IDENTITY,
    },
    content: {
      revision: inputs.manifest.contentRevision,
      manifestBytes: file("show-manifest").size,
      manifestSha256: file("show-manifest").sha256,
      poemBytes: file("poem").size,
      poemSha256: inputs.manifest.poemSha256,
      configSha256: file("show-config").sha256,
      mediaManifest: { present: false },
    },
    offlineSnapshots,
    offlineVerified,
    loops,
    aggregate: {
      completedLoops: diagnostics.aggregate.completedLoops,
      offlineSampleCount,
      onlineSampleCount,
      resourceIncompleteLoopCount:
        diagnostics.aggregate.resourceIncompleteLoopCount,
      runtimeCountGrowthLoopCount:
        diagnostics.aggregate.runtimeCountGrowthLoopCount,
      totalRetries: diagnostics.aggregate.automaticRecoveryRetryCount,
      totalSkips: P1_SKIP_COUNT,
      totalRecoveries: diagnostics.aggregate.recoveryEventCount,
      cumulativeVisibleDriftMs:
        diagnostics.aggregate.cumulativeVisibleDriftMs,
      secondaryPresentLatencyMs: {
        ...diagnostics.aggregate.secondaryPresentLatencyMs,
      },
      primaryCompletionLatencyMs: {
        ...diagnostics.aggregate.primaryCompletionLatencyMs,
      },
      primaryInstantAckLatencyMs: {
        ...diagnostics.aggregate.primaryInstantAckLatencyMs,
      },
      primaryInsertOverheadMs: {
        ...diagnostics.aggregate.primaryInsertOverheadMs,
      },
      acceptanceOutcome: "fail",
    },
    recoveries: diagnostics.recoveries.map((recovery) => ({ ...recovery })),
    shutdown,
    loggingIncomplete,
    operatorNotes: [
      "P0 fixture omits formula, image, and matrix assets; each is a bounded P1 skip.",
      "Acceptance scope remains monitor simulation until physical-projector rehearsal.",
    ],
  };
}

function requestedBy(
  reason: string,
): ShowRunEvidenceRecord["shutdown"]["requestedBy"] {
  if (reason === "soak-complete") return "soak-complete";
  if (reason === "operator-stop") return "operator-stop";
  if (reason === "emergency-sigint") return "sigint";
  if (reason === "emergency-window-close") return "window-close";
  if (reason === "emergency-electron-quit") return "electron-quit";
  return "fatal-fault";
}

function showRuntimePaths(repositoryRoot: string, rehearsalRoot: string) {
  return {
    artifactLock: resolveBelowRoot(repositoryRoot, "janvim-artifact.lock.json"),
    verifyRuntimeScript: resolveBelowRoot(
      repositoryRoot,
      "scripts\\verify-runtime.ps1",
    ),
    janvimExecutable: resolveBelowRoot(
      repositoryRoot,
      "runtime\\janvim\\janvim-core.exe",
    ),
    janvimRoot: resolveBelowRoot(repositoryRoot, "runtime\\janvim"),
    privateUserRoot: resolveBelowRoot(repositoryRoot, "runtime\\user-root"),
    showConfig: resolveBelowRoot(repositoryRoot, "show\\janvim-show.toml"),
    manifest: resolveBelowRoot(
      repositoryRoot,
      "content\\fixture\\show.manifest.json",
    ),
    poem: resolveBelowRoot(repositoryRoot, "content\\fixture\\poem.txt"),
    pluginLabInit: resolveBelowRoot(
      repositoryRoot,
      "runtime\\user-root\\plugin-lab\\config\\init.lua",
    ),
    windowPlacementScript: resolveBelowRoot(
      repositoryRoot,
      "scripts\\place-janvim-window.ps1",
    ),
    windowCloseScript: resolveBelowRoot(
      repositoryRoot,
      "scripts\\close-janvim-window.ps1",
    ),
    displayMap: resolveBelowRoot(rehearsalRoot, "display-map.json"),
    runLease: resolveBelowRoot(rehearsalRoot, "run-lease.json"),
    evidence: resolveBelowRoot(rehearsalRoot, "show-run.json"),
    terminalMarker: resolveBelowRoot(
      rehearsalRoot,
      "controller-terminal.json",
    ),
  };
}

function fixedEntryUrl(repositoryRoot: string): string {
  const path = resolveBelowRoot(
    repositoryRoot,
    "apps\\secondary-screen\\dist\\index.html",
  );
  return pathToFileURL(path).href;
}

function normalizeShowDisplays(values: readonly unknown[]): ShowRuntimeDisplay[] {
  return values.map((value) => {
    if (value === null || typeof value !== "object") {
      throw new Error("Electron display is invalid");
    }
    const record = value as {
      id?: string | number;
      displayId?: string | number;
      bounds?: Rectangle;
      workArea?: Rectangle;
      workingArea?: Rectangle;
      scaleFactor?: number;
      rotation?: number;
    };
    const displayId = record.displayId ?? record.id;
    const workingArea = record.workingArea ?? record.workArea;
    if (
      displayId === undefined ||
      record.bounds === undefined ||
      workingArea === undefined ||
      record.scaleFactor === undefined ||
      !isRotation(record.rotation)
    ) {
      throw new Error("Electron display snapshot is incomplete");
    }
    return {
      displayId,
      bounds: { ...record.bounds },
      workingArea: { ...workingArea },
      scaleFactor: record.scaleFactor,
      rotation: record.rotation,
    };
  });
}

type ShowWebContentsAdapter = G2BrowserWindowAdapter["webContents"] & {
  getOSProcessId(): number;
};

type ShowBrowserWindowAdapter = Omit<
  G2BrowserWindowAdapter,
  "webContents"
> & {
  webContents: ShowWebContentsAdapter;
};

interface ShowBridgeAdapter extends G2BridgeServerAdapter {
  onAgentDisconnected(listener: () => void): () => void;
  diagnostics?(): {
    activeConnections: number;
    authenticatedConnections: number;
    pendingCommands: number;
    pendingTimers: number;
    sessionListeners: number;
    readyWaiters: number;
    agentDisconnectListeners?: number;
  };
}

class RuntimeLogger {
  private budget: RunLogBudget;
  private readonly secrets: string[] = [];
  private incomplete = false;

  public constructor(
    private readonly storage: LogStorage,
    private readonly basePath: string,
    initialSecrets: readonly string[] = [],
  ) {
    for (const secret of initialSecrets) this.appendSecret(secret);
    this.budget = this.createBudget();
  }

  public addSecret(secret: string): void {
    if (secret.length === 0 || this.secrets.includes(secret)) return;
    this.incomplete ||= this.budget.snapshot().incomplete;
    this.appendSecret(secret);
    this.budget = this.createBudget();
  }

  public writeJson(stream: RunLogStream, value: Record<string, unknown>): boolean {
    const written = this.budget.writeJson(stream, value);
    if (!written) this.incomplete = true;
    return written;
  }

  public write(stream: RunLogStream, value: Uint8Array | string): boolean {
    const written = this.budget.write(stream, value);
    if (!written) this.incomplete = true;
    return written;
  }

  public createChildStreamSink(
    stream: Extract<RunLogStream, "janvim-stdout" | "janvim-stderr">,
  ): RedactingChildStreamSink {
    return new RedactingChildStreamSink(this.secrets, (value) =>
      this.write(stream, value),
    );
  }

  public snapshot(): ReturnType<RunLogBudget["snapshot"]> {
    const snapshot = this.budget.snapshot();
    return {
      ...snapshot,
      incomplete: this.incomplete || snapshot.incomplete,
    };
  }

  private createBudget(): RunLogBudget {
    return new RunLogBudget({
      storage: this.storage,
      basePath: this.basePath,
      secrets: this.secrets,
    });
  }

  private appendSecret(secret: string): void {
    if (secret.length === 0 || this.secrets.includes(secret)) return;
    if (secret.length > 4_096 || this.secrets.length >= 32) {
      throw new Error("runtime log secret limit reached");
    }
    this.secrets.push(secret);
  }
}

function showLogSecrets(repositoryRoot: string): readonly string[] {
  const paths = [
    repositoryRoot,
    JANVIM_PRODUCT_ROOT,
    ...G2_PROTECTED_ROOTS,
  ];
  return [
    ...paths.flatMap((path) => [path, path.replaceAll("\\", "/")]),
    "AppData\\Local\\nvim",
    "AppData/Local/nvim",
  ];
}

class RedactingChildStreamSink {
  private readonly patterns: readonly { value: string; folded: string }[];
  private pending = "";
  private ended = false;
  private complete = true;

  public constructor(
    secrets: readonly string[],
    private readonly write: (value: string) => boolean,
  ) {
    this.patterns = [...new Set(secrets)]
      .filter((value) => value.length > 0)
      .map((value) => ({ value, folded: value.toLowerCase() }))
      .sort((left, right) => right.value.length - left.value.length);
  }

  public append(value: Uint8Array): boolean {
    if (this.ended) return false;
    this.pending += Buffer.from(
      value.buffer,
      value.byteOffset,
      value.byteLength,
    ).toString("utf8");
    return this.drain(false);
  }

  public finish(): boolean {
    if (this.ended) return this.complete;
    this.ended = true;
    return this.drain(true);
  }

  private drain(flush: boolean): boolean {
    const folded = this.pending.toLowerCase();
    const retainedCharacters = flush
      ? 0
      : this.retainedSuffixLength(folded);
    const safeCharacters = flush
      ? this.pending.length
      : Math.max(0, this.pending.length - retainedCharacters);
    if (safeCharacters === 0) return this.complete;

    let cursor = 0;
    let output = "";
    while (cursor < safeCharacters) {
      const match = this.patterns.find((pattern) =>
        folded.startsWith(pattern.folded, cursor),
      );
      if (match !== undefined) {
        output += "[REDACTED]";
        cursor += match.value.length;
      } else {
        output += this.pending[cursor]!;
        cursor += 1;
      }
    }
    this.pending = this.pending.slice(cursor);
    if (output.length > 0 && !this.write(output)) this.complete = false;
    return this.complete;
  }

  private retainedSuffixLength(folded: string): number {
    let retained = 0;
    for (const pattern of this.patterns) {
      const maximum = Math.min(pattern.folded.length - 1, folded.length);
      for (let length = maximum; length > retained; length -= 1) {
        if (folded.endsWith(pattern.folded.slice(0, length))) {
          retained = length;
          break;
        }
      }
    }
    return retained;
  }
}

class EmergencyLifecycleHub {
  private listener:
    | ((reason: "sigint" | "window-close" | "electron-quit") => void)
    | undefined;

  public constructor(
    private readonly controllerProcess: ShowControllerProcessAdapter,
    private readonly electronApp: ShowElectronAppAdapter,
  ) {}

  public bind(
    listener: (reason: "sigint" | "window-close" | "electron-quit") => void,
  ): () => void {
    if (this.listener !== undefined) {
      throw new Error("show emergency lifecycle is already bound");
    }
    this.listener = listener;
    const onSigint = (): void => {
      this.listener?.("sigint");
    };
    const onBeforeQuit = (event: { preventDefault(): void }): void => {
      event.preventDefault();
      this.listener?.("electron-quit");
    };
    this.controllerProcess.on("SIGINT", onSigint);
    try {
      this.electronApp.on("before-quit", onBeforeQuit);
    } catch (error) {
      this.controllerProcess.removeListener("SIGINT", onSigint);
      this.listener = undefined;
      throw error;
    }

    let bound = true;
    return () => {
      if (!bound) return;
      bound = false;
      this.listener = undefined;
      let cleanupError: unknown;
      try {
        this.controllerProcess.removeListener("SIGINT", onSigint);
      } catch (error) {
        cleanupError = error;
      }
      try {
        this.electronApp.removeListener("before-quit", onBeforeQuit);
      } catch (error) {
        cleanupError ??= error;
      }
      if (cleanupError !== undefined) throw cleanupError;
    };
  }

  public notifyWindowClose(): void {
    this.listener?.("window-close");
  }
}

async function openShowSecondary(input: {
  host: NormalizedShowHost;
  command: RunShowCommand;
  generationId: number;
  signal: AbortSignal;
  display: RuntimeDisplay;
  entryUrl: string;
  preloadPath: string;
  logger: RuntimeLogger;
  lifecycle: EmergencyLifecycleHub;
}): Promise<ShowSecondarySurface> {
  if (input.signal.aborted) throw new Error("secondary-open-aborted");
  const plan = createSecondaryWindowPlan(
    input.display.bounds,
    input.preloadPath,
    input.entryUrl,
  );
  const window = new input.host.source.BrowserWindow(
    plan.browserWindowOptions as unknown as Record<string, unknown>,
  ) as unknown as ShowBrowserWindowAdapter;
  const disposeGuards = installLocalOnlyWebGuards({
    webContents: window.webContents,
    entryUrl: input.entryUrl,
  });
  const eventListeners = new Set<(event: RendererToControllerEvent) => void>();
  const destroyedListeners = new Set<() => void>();
  let intentionalClose = false;
  const onWindowClose = (): void => {
    if (!intentionalClose) input.lifecycle.notifyWindowClose();
  };
  const closeEvents = window as unknown as {
    on(event: "close", listener: () => void): void;
    removeListener(event: "close", listener: () => void): void;
  };
  closeEvents.on("close", onWindowClose);
  const disposeIpc = bindLocalRendererEvents(
    input.host.source.ipcMain,
    input.entryUrl,
    (event) => {
      for (const listener of [...eventListeners]) listener(event);
    },
    window.webContents,
  );
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    intentionalClose = true;
    let cleanupError: unknown;
    let hasCleanupError = false;
    const cleanupActions: readonly (() => void)[] = [
      () => closeEvents.removeListener("close", onWindowClose),
      disposeIpc,
      disposeGuards,
      () => {
        eventListeners.clear();
        destroyedListeners.clear();
      },
      () => {
        if (!window.isDestroyed()) window.close();
      },
    ];
    for (const action of cleanupActions) {
      try {
        action();
      } catch (error) {
        if (!hasCleanupError) {
          cleanupError = error;
          hasCleanupError = true;
        }
      }
    }
    if (hasCleanupError) throw cleanupError;
  };
  const onClosed = (): void => {
    const listeners = intentionalClose ? [] : [...destroyedListeners];
    try {
      dispose();
    } catch {
      // A closed surface cannot retain guards even if one host cleanup hook fails.
    }
    for (const listener of listeners) listener();
  };
  window.once("closed", onClosed);

  try {
    await input.host.runWithDeadline(15_000, () => window.loadURL(input.entryUrl));
    if (input.signal.aborted) throw new Error("secondary-open-aborted");
  } catch (error) {
    try {
      dispose();
    } catch {
      // Preserve the original load/abort classification.
    }
    if (!window.isDestroyed()) window.destroy();
    throw error;
  }

  const rendererPid = window.webContents.getOSProcessId();
  if (!Number.isSafeInteger(rendererPid) || rendererPid <= 0) {
    if (!window.isDestroyed()) window.destroy();
    throw new Error("secondary-renderer-pid-invalid");
  }
  input.logger.writeJson("controller", {
    type: "secondary-opened",
    runId: input.command.runId,
    controllerRunId: input.command.controllerRunId,
    generationId: input.generationId,
    rendererPid,
  });

  return {
    rendererPid,
    send: (event) => {
      if (!window.isDestroyed()) {
        window.webContents.send(SHOW_EVENT_CHANNEL, event);
      }
    },
    onEvent: (listener) => {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    onDestroyed: (listener) => {
      destroyedListeners.add(listener);
      return () => destroyedListeners.delete(listener);
    },
    close: () => {
      dispose();
    },
    diagnostics: () => ({
      listeners: eventListeners.size + destroyedListeners.size,
    }),
  };
}

class RuntimeShowSession implements ShowRunSession {
  public readonly sessionId: string;
  private generationId: number;
  private bridge: ShowBridgeAdapter | undefined;
  private bridgeToken: string | undefined;
  private bridgePort: number | undefined;
  private child: G2SpawnedChild | undefined;
  private childStartedAtUtc: string | undefined;
  private placement: WindowPlacementReceipt | undefined;
  private lease: RunLease | undefined;
  private leaseRemoved = false;
  private disposed = false;
  private lifecycleEpoch = 0;
  private shutdownRequested = false;
  private childClosed = false;
  private resolveChildExit!: () => void;
  private readonly childExit: Promise<void>;
  private leaseOperation: Promise<void> = Promise.resolve();
  private readonly faultListeners = new Set<
    (fault: "agent-disconnected" | "critical-ack-failed" | "janvim-exited") => void
  >();
  private readonly primaryListeners = new Set<
    (event: PrimaryCueCompletionEvent) => void
  >();
  private detachChildStreams: (() => void) | undefined;
  private finishChildStreams: (() => void) | undefined;
  private disposeBridgeDisconnect: (() => void) | undefined;

  public constructor(
    private readonly options: {
      host: NormalizedShowHost;
      command: RunShowCommand;
      generationId: number;
      inputs: ValidatedShowInputs;
      paths: ReturnType<typeof showRuntimePaths>;
      logger: RuntimeLogger;
      onPid(pid: number): void;
    },
  ) {
    this.generationId = options.generationId;
    this.sessionId = `${options.command.controllerRunId}-session-${options.generationId}`;
    this.childExit = new Promise<void>((resolve) => {
      this.resolveChildExit = resolve;
    });
  }

  public currentGenerationId(): number {
    return this.generationId;
  }

  public async rebindGeneration(
    generationId: number,
    signal: AbortSignal,
  ): Promise<void> {
    const epoch = this.captureLifecycle(signal, "session-rebind-aborted");
    if (!Number.isSafeInteger(generationId) || generationId <= this.generationId) {
      throw new Error("session-generation-must-increase");
    }
    const lease = this.lease;
    if (lease !== undefined) {
      const operation = this.leaseOperation.then(async () => {
        const replacement = await this.options.host.replaceRunLease(
          this.options.paths.runLease,
          lease,
          generationId,
        );
        if (!this.isCurrentLifecycle(epoch, signal)) {
          const removed = await this.options.host.removeRunLease(
            this.options.paths.runLease,
            replacement,
          );
          if (!removed) this.lease = replacement;
          this.leaseRemoved = removed;
          throw new Error("session-rebind-aborted");
        }
        this.lease = replacement;
      });
      this.leaseOperation = operation;
      await operation;
    }
    this.requireCurrentLifecycle(epoch, signal, "session-rebind-aborted");
    this.generationId = generationId;
  }

  public async startBridge(signal: AbortSignal): Promise<void> {
    const epoch = this.captureLifecycle(signal, "bridge-start-aborted");
    if (this.bridge !== undefined) throw new Error("bridge-already-started");
    const token = this.options.host.randomBytes(24).toString("hex");
    const bridge = this.options.host.createBridge(token);
    let bridgePublished = false;
    let address: Awaited<ReturnType<ShowBridgeAdapter["listen"]>>;
    try {
      address = await this.options.host.runWithDeadline(5_000, () => bridge.listen());
    } catch (error) {
      return await this.failBridgeStart(bridge, error);
    }
    if (address.host !== "127.0.0.1" || !this.isCurrentLifecycle(epoch, signal)) {
      return await this.failBridgeStart(
        bridge,
        new Error(
          !this.isCurrentLifecycle(epoch, signal)
            ? "bridge-start-aborted"
            : "bridge-not-ipv4-loopback",
        ),
      );
    }
    let disposeDisconnect: () => void;
    try {
      disposeDisconnect = bridge.onAgentDisconnected(() => {
        if (
          !bridgePublished ||
          this.bridge !== bridge ||
          !this.isCurrentLifecycle(epoch)
        ) {
          return;
        }
        for (const listener of [...this.faultListeners]) {
          listener("agent-disconnected");
        }
      });
    } catch (error) {
      return await this.failBridgeStart(bridge, error);
    }
    if (!this.isCurrentLifecycle(epoch, signal)) {
      return await this.failBridgeStart(
        bridge,
        new Error("bridge-start-aborted"),
        disposeDisconnect,
      );
    }
    this.bridge = bridge;
    this.disposeBridgeDisconnect = disposeDisconnect;
    this.bridgeToken = token;
    this.bridgePort = address.port;
    this.options.logger.addSecret(token);
    bridgePublished = true;
  }

  public async launchJanVim(signal: AbortSignal): Promise<void> {
    const epoch = this.captureLifecycle(signal, "janvim-launch-aborted");
    assertFrozenSnapshotUnchanged(this.options.inputs.snapshot);
    const token = this.bridgeToken;
    const port = this.bridgePort;
    if (token === undefined || port === undefined) {
      throw new Error("janvim-bridge-unavailable");
    }
    const baseEnvironment = privateChildEnvironment(
      this.options.host.baseEnvironment,
    );
    const launch = await launchJanVimProcess(
      {
        artifactLockPath: this.options.paths.artifactLock,
        executablePath: this.options.paths.janvimExecutable,
        workingDirectory: this.options.paths.janvimRoot,
        arguments: [
          "--config",
          this.options.paths.showConfig,
          this.options.paths.poem,
        ],
        privateUserRoot: this.options.paths.privateUserRoot,
        bridgePort: port,
        bridgeToken: token,
      },
      {
        baseEnvironment,
        verifyArtifact: this.options.host.verifyArtifact,
        spawn: this.options.host.spawn,
      },
    );
    if (!launch.started) throw new Error(launch.reason);
    const child = launch.child as G2SpawnedChild;
    if (!this.isCurrentLifecycle(epoch, signal)) {
      await this.cleanupUnpublishedChild(child);
      throw new Error("janvim-launch-aborted");
    }
    this.child = child;
    this.options.onPid(child.pid);
    child.once("close", () => {
      this.childClosed = true;
      this.detachChildStreams?.();
      this.detachChildStreams = undefined;
      this.finishChildStreams?.();
      this.finishChildStreams = undefined;
      this.resolveChildExit();
      this.beginLeaseRemoval();
      if (!this.shutdownRequested) {
        for (const listener of [...this.faultListeners]) listener("janvim-exited");
      }
    });
    this.childStartedAtUtc = await this.options.host.inspectProcessStartedAtUtc(child.pid);
    if (this.childClosed) {
      throw new Error("janvim-exited-during-identity-inspection");
    }
    if (!this.isCurrentLifecycle(epoch, signal)) {
      await this.terminateExactJanVim();
      throw new Error("janvim-launch-aborted");
    }
    if (child.stdout === null || child.stderr === null) {
      await this.terminateExactJanVim();
      throw new Error("janvim-child-output-unavailable");
    }
    const stdoutSink = this.options.logger.createChildStreamSink(
      "janvim-stdout",
    );
    const stderrSink = this.options.logger.createChildStreamSink(
      "janvim-stderr",
    );
    const onStdout = (chunk: Buffer): void => {
      stdoutSink.append(chunk);
    };
    const onStderr = (chunk: Buffer): void => {
      stderrSink.append(chunk);
    };
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    this.detachChildStreams = () => {
      child.stdout?.off("data", onStdout);
      child.stderr?.off("data", onStderr);
    };
    this.finishChildStreams = () => {
      stdoutSink.finish();
      stderrSink.finish();
    };
    if (!this.isCurrentLifecycle(epoch, signal)) {
      await this.terminateExactJanVim();
      throw new Error("janvim-launch-aborted");
    }
  }

  public async placeJanVim(signal: AbortSignal): Promise<void> {
    const epoch = this.captureLifecycle(signal, "janvim-placement-aborted");
    const child = this.child;
    if (child === undefined) throw new Error("janvim-child-unavailable");
    const placement = await placeJanVimWindow({
      helperPath: this.options.paths.windowPlacementScript,
      target: {
        pid: child.pid,
        bounds: this.options.inputs.displayRoute.primary.bounds,
      },
      runHelper: async (invocation, limits) =>
        this.options.host.execFile(invocation.file, invocation.args, {
          cwd: this.options.host.repositoryRoot,
          timeoutMs: limits.timeoutMs,
          maxStdoutBytes: limits.maxOutputBytes,
          maxStderrBytes: limits.maxOutputBytes,
        }),
    });
    if (!placement.ok) throw new Error(placement.reason);
    if (!this.isCurrentLifecycle(epoch, signal)) {
      await this.closePlacement(placement.receipt).catch(() => undefined);
      throw new Error("janvim-placement-aborted");
    }
    const childStartedAtUtc = this.childStartedAtUtc;
    if (childStartedAtUtc === undefined) {
      throw new Error("janvim-process-creation-time-unavailable");
    }
    this.placement = placement.receipt;
    const lease: RunLease = {
      schema: 1,
      runId: this.options.command.runId,
      controllerRunId: this.options.command.controllerRunId,
      generationId: this.generationId,
      controller: {
        pid: this.options.host.source.controllerProcess.pid,
        startedAtUtc: this.options.host.source.controllerProcess.startedAtUtc,
      },
      janvim: {
        pid: child.pid,
        startedAtUtc: childStartedAtUtc,
        hwnd: placement.receipt.hwnd,
        executableRelativePath: "janvim-core.exe",
        executableSha256: TASK9_ARTIFACT_IDENTITY.coreSha256,
      },
    };
    await this.options.host.writeRunLease(this.options.paths.runLease, lease);
    if (!this.isCurrentLifecycle(epoch, signal)) {
      const removed = await this.options.host.removeRunLease(
        this.options.paths.runLease,
        lease,
      );
      this.leaseRemoved = removed;
      if (!removed) this.lease = lease;
      throw new Error("janvim-placement-aborted");
    }
    this.lease = lease;
    if (this.childClosed) this.beginLeaseRemoval();
  }

  public async awaitAgent(signal: AbortSignal): Promise<void> {
    const epoch = this.captureLifecycle(signal, "agent-wait-aborted");
    const bridge = this.requireBridge();
    await bridge.waitForAgent(10_000);
    this.requireCurrentLifecycle(epoch, signal, "agent-wait-aborted");
  }

  public async prepareOriginalPoem(
    signal: AbortSignal,
  ): Promise<{ bufferSha256: string }> {
    const epoch = this.captureLifecycle(signal, "prepare-original-aborted");
    const acknowledgement = await this.dispatch({
      schema: 1,
      token: this.requireToken(),
      loopId: `${this.options.command.runId}-g${this.generationId}-prepare`,
      cueId: `${this.options.command.runId}-original`,
      action: {
        type: "prepare",
        poem: this.options.inputs.poem.toString("utf8"),
        expectedSha256: this.options.inputs.manifest.poemSha256,
      },
    });
    this.requireCurrentLifecycle(epoch, signal, "prepare-original-aborted");
    if (
      acknowledgement.outcome !== "applied" &&
      acknowledgement.outcome !== "duplicate"
    ) {
      throw new Error("prepare-original-rejected");
    }
    if (acknowledgement.bufferSha256 !== this.options.inputs.manifest.poemSha256) {
      throw new Error("prepare-original-hash-mismatch");
    }
    return { bufferSha256: acknowledgement.bufferSha256 };
  }

  public createLoop(
    loopId: string,
    surface: ShowSecondarySurface,
    reserveNextLoopId: () => string,
    onPrimaryEditorDispatch: (event: PrimaryEditorDispatchEvent) => void,
  ): OneLoopRuntime {
    this.requireActive();
    let currentLoopId = loopId;
    const generationId = this.generationId;
    const editorCues = new Map(
      this.options.inputs.manifest.cues
        .filter(
          (cue): cue is Extract<Cue, { kind: "editor-action" }> =>
            cue.kind === "editor-action",
        )
        .map((cue) => [cue.id, cue]),
    );
    let reportedLoopId = loopId;
    const reportedEditorCueIds = new Set<string>();
    const reportPrimaryEditorDispatch = (command: AgentCommand): void => {
      const cue = editorCues.get(command.cueId);
      if (cue === undefined || cue.payload.action.type !== command.action.type) return;
      if (command.loopId !== reportedLoopId) {
        reportedLoopId = command.loopId;
        reportedEditorCueIds.clear();
      }
      if (reportedEditorCueIds.has(cue.id)) return;
      reportedEditorCueIds.add(cue.id);
      onPrimaryEditorDispatch({
        generationId,
        loopId: command.loopId,
        cueId: cue.id,
        cue,
      });
    };
    const runtime = new DeterministicShowLoop({
      manifest: { ...this.options.inputs.manifest, loopId },
      poem: this.options.inputs.poem.toString("utf8"),
      token: this.requireToken(),
      clock: { nowMonotonic: this.options.host.nowMonotonic },
      renderer: {
        apply: (cue) => {
          surface.send({
            schema: 1,
            type: "run-cue",
            generationId,
            loopId: currentLoopId,
            requiresPresentationAck:
              cue.target === "secondary" || cue.target === "both",
            cue,
          });
        },
        showReady: (nextLoopId) => {
          currentLoopId = nextLoopId;
        },
      },
      agent: {
        dispatch: async (command) => {
          reportPrimaryEditorDispatch(command);
          const acknowledgement = await this.dispatch(command);
          if (
            acknowledgement.outcome === "failed" ||
            acknowledgement.outcome === "rejected"
          ) {
            for (const listener of [...this.faultListeners]) {
              listener("critical-ack-failed");
            }
          } else if (
            command.action.type !== "prepare" &&
            command.action.type !== "status" &&
            command.action.type !== "shutdown"
          ) {
            const completion: PrimaryCueCompletionEvent = {
              generationId,
              loopId: command.loopId,
              cueId: command.cueId,
              bufferSha256: acknowledgement.bufferSha256,
            };
            for (const listener of [...this.primaryListeners]) {
              listener(completion);
            }
          }
          return acknowledgement;
        },
      },
      generateLoopId: reserveNextLoopId,
    });
    return new PreparedRuntime(runtime);
  }

  public onFault(
    listener: (
      fault: "agent-disconnected" | "critical-ack-failed" | "janvim-exited",
    ) => void,
  ): () => void {
    this.faultListeners.add(listener);
    return () => this.faultListeners.delete(listener);
  }

  public onPrimaryCompletion(
    listener: (event: PrimaryCueCompletionEvent) => void,
  ): () => void {
    this.primaryListeners.add(listener);
    return () => this.primaryListeners.delete(listener);
  }

  public diagnostics(): {
    connections: number;
    pendingCommands: number;
    editorCommandPending: boolean;
    leaseRemoved: boolean;
  } {
    const diagnostics = this.bridge?.diagnostics?.();
    return {
      connections: diagnostics?.authenticatedConnections ?? 0,
      pendingCommands: diagnostics?.pendingCommands ?? 0,
      editorCommandPending: (diagnostics?.pendingCommands ?? 0) > 0,
      leaseRemoved: this.leaseRemoved,
    };
  }

  public async resetToOriginal(
    loopId: string,
    signal: AbortSignal,
  ): Promise<{ bufferSha256: string }> {
    const epoch = this.captureLifecycle(signal, "show-reset-aborted");
    await this.leaseOperation;
    this.requireCurrentLifecycle(epoch, signal, "show-reset-aborted");
    const cueId = `${loopId}-reset`;
    const acknowledgement = await this.dispatch({
      schema: 1,
      token: this.requireToken(),
      loopId,
      cueId,
      action: { type: "reset" },
    });
    this.requireCurrentLifecycle(epoch, signal, "show-reset-aborted");
    if (
      (acknowledgement.outcome !== "applied" &&
        acknowledgement.outcome !== "duplicate") ||
      acknowledgement.loopId !== loopId ||
      acknowledgement.cueId !== cueId ||
      acknowledgement.bufferSha256 !== this.options.inputs.manifest.poemSha256
    ) {
      throw new Error("show-reset-acknowledgement-invalid");
    }
    return { bufferSha256: acknowledgement.bufferSha256 };
  }

  public async sendAgentShutdown(
    timeoutMs: 2_000,
    retryLimit: 1,
  ): Promise<void> {
    this.requireActive();
    this.shutdownRequested = true;
    const loopId = `${this.options.command.runId}-shutdown`;
    const cueId = `${loopId}-agent`;
    let failure: unknown;
    for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
      try {
        const acknowledgement = await this.options.host.runWithDeadline(
          timeoutMs,
          () =>
            this.dispatch({
              schema: 1,
              token: this.requireToken(),
              loopId,
              cueId,
              action: { type: "shutdown" },
            }),
        );
        if (
          acknowledgement.loopId !== loopId ||
          acknowledgement.cueId !== cueId ||
          (acknowledgement.outcome !== "applied" &&
            acknowledgement.outcome !== "duplicate")
        ) {
          throw new Error("show-shutdown-acknowledgement-invalid");
        }
        return;
      } catch (error) {
        failure = error;
      }
    }
    throw failure instanceof Error ? failure : new Error("show-shutdown-failed");
  }

  public async closePlacedWindow(
    timeoutMs: 2_000,
    maxOutputBytes: 4_096,
  ): Promise<void> {
    const placement = this.placement;
    if (placement === undefined) throw new Error("show-window-placement-unavailable");
    await this.closePlacement(placement, timeoutMs, maxOutputBytes);
    if (this.placement === placement) this.placement = undefined;
  }

  public async waitForJanVimExit(
    timeoutMs: 5_000,
  ): Promise<"natural" | "still-running"> {
    try {
      await this.options.host.runWithDeadline(timeoutMs, () => this.childExit);
      await this.leaseOperation;
      return "natural";
    } catch {
      return "still-running";
    }
  }

  public async terminateExactJanVim(): Promise<void> {
    this.shutdownRequested = true;
    const child = this.child;
    const expectedStartedAtUtc = this.childStartedAtUtc;
    if (child === undefined || expectedStartedAtUtc === undefined) {
      throw new Error("janvim-process-identity-unavailable");
    }
    if (this.childClosed) return;
    const observedStartedAtUtc = await this.options.host.inspectProcessStartedAtUtc(
      child.pid,
    );
    if (observedStartedAtUtc !== expectedStartedAtUtc) {
      throw new Error("janvim-process-identity-changed");
    }
    if (this.childClosed) return;
    if (child.kill?.() !== true) {
      throw new Error("janvim-exact-termination-rejected");
    }
  }

  public async waitForForcedExit(timeoutMs: 5_000): Promise<boolean> {
    try {
      await this.options.host.runWithDeadline(timeoutMs, () => this.childExit);
      await this.leaseOperation;
      return this.childClosed;
    } catch {
      return false;
    }
  }

  public async closeBridge(timeoutMs: 5_000): Promise<void> {
    const bridge = this.bridge;
    if (bridge === undefined) return;
    this.disposeBridgeDisconnect?.();
    this.disposeBridgeDisconnect = undefined;
    await this.options.host.runWithDeadline(timeoutMs, () => bridge.close());
    if (this.bridge === bridge) this.bridge = undefined;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.lifecycleEpoch += 1;
    this.disposeBridgeDisconnect?.();
    this.disposeBridgeDisconnect = undefined;
    this.detachChildStreams?.();
    this.detachChildStreams = undefined;
    this.finishChildStreams?.();
    this.finishChildStreams = undefined;
    this.faultListeners.clear();
    this.primaryListeners.clear();
  }

  private async dispatch(command: AgentCommand): Promise<AgentAck> {
    try {
      return await this.requireBridge().dispatch(command);
    } catch (error) {
      for (const listener of [...this.faultListeners]) {
        listener("agent-disconnected");
      }
      throw error;
    }
  }

  private requireBridge(): ShowBridgeAdapter {
    if (this.bridge === undefined) throw new Error("show-bridge-unavailable");
    return this.bridge;
  }

  private async failBridgeStart(
    bridge: ShowBridgeAdapter,
    startupError: unknown,
    disposeDisconnect?: () => void,
  ): Promise<never> {
    this.bridge = bridge;
    if (disposeDisconnect !== undefined) {
      this.disposeBridgeDisconnect = disposeDisconnect;
      try {
        disposeDisconnect();
        if (this.disposeBridgeDisconnect === disposeDisconnect) {
          this.disposeBridgeDisconnect = undefined;
        }
      } catch {
        // Retain the disposer so later bounded session cleanup can retry it.
      }
    }
    try {
      await this.options.host.runWithDeadline(5_000, () => bridge.close());
      if (this.disposeBridgeDisconnect === disposeDisconnect) {
        this.disposeBridgeDisconnect = undefined;
      }
      if (this.bridge === bridge) this.bridge = undefined;
    } catch {
      // Keep the exact bridge owned so bounded session cleanup can retry it.
    }
    throw startupError;
  }

  private requireToken(): string {
    if (this.bridgeToken === undefined) throw new Error("show-token-unavailable");
    return this.bridgeToken;
  }

  private requireActive(): void {
    if (this.disposed) throw new Error("show-session-disposed");
  }

  private captureLifecycle(signal: AbortSignal, reason: string): number {
    this.requireActive();
    if (signal.aborted) throw new Error(reason);
    return this.lifecycleEpoch;
  }

  private isCurrentLifecycle(epoch: number, signal?: AbortSignal): boolean {
    return !this.disposed && this.lifecycleEpoch === epoch && signal?.aborted !== true;
  }

  private requireCurrentLifecycle(
    epoch: number,
    signal: AbortSignal,
    reason: string,
  ): void {
    if (!this.isCurrentLifecycle(epoch, signal)) throw new Error(reason);
  }

  private async closePlacement(
    placement: WindowPlacementReceipt,
    timeoutMs: 2_000 = 2_000,
    maxOutputBytes: 4_096 = 4_096,
  ): Promise<void> {
    await closePlacedJanVimWindow({
      placement,
      helperPath: this.options.paths.windowCloseScript,
      runHelper: async (invocation, limits) => {
        if (
          limits.timeoutMs !== timeoutMs ||
          limits.maxOutputBytes !== maxOutputBytes
        ) {
          throw new Error("show-window-close-limits-changed");
        }
        return this.options.host.execFile(invocation.file, invocation.args, {
          cwd: this.options.host.repositoryRoot,
          timeoutMs: limits.timeoutMs,
          maxStdoutBytes: limits.maxOutputBytes,
          maxStderrBytes: limits.maxOutputBytes,
        });
      },
    });
  }

  private async cleanupUnpublishedChild(child: G2SpawnedChild): Promise<void> {
    let closed = false;
    let resolveExit!: () => void;
    const exited = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });
    child.once("close", () => {
      closed = true;
      resolveExit();
    });
    const expectedStartedAtUtc = await this.options.host.inspectProcessStartedAtUtc(
      child.pid,
    );
    const observedStartedAtUtc = await this.options.host.inspectProcessStartedAtUtc(
      child.pid,
    );
    if (!closed && observedStartedAtUtc === expectedStartedAtUtc) child.kill?.();
    if (!closed) {
      await this.options.host.runWithDeadline(5_000, () => exited).catch(() => undefined);
    }
    if (closed) {
      this.childClosed = true;
      this.resolveChildExit();
    }
  }

  private beginLeaseRemoval(): void {
    const lease = this.lease;
    if (lease === undefined || this.leaseRemoved) return;
    this.leaseOperation = this.leaseOperation.catch(() => undefined).then(async () => {
      if (this.leaseRemoved || this.lease === undefined) return;
      this.leaseRemoved = await this.options.host.removeRunLease(
        this.options.paths.runLease,
        this.lease,
      );
    });
  }
}

class PreparedRuntime implements OneLoopRuntime {
  private visibleState: DeterministicShowLoopState = "ready";
  private preparation: Promise<boolean> | undefined;
  private lifecycleEpoch = 0;

  public constructor(private readonly runtime: DeterministicShowLoop) {}

  public get state(): DeterministicShowLoopState {
    return this.visibleState;
  }

  public get completedLoops(): number {
    return this.runtime.completedLoops;
  }

  public start(): boolean {
    if (this.visibleState !== "ready" || this.preparation !== undefined) {
      return false;
    }
    const epoch = this.lifecycleEpoch;
    this.visibleState = "running";
    this.preparation = this.runtime.prepare().then((prepared) => {
      if (this.lifecycleEpoch !== epoch || this.visibleState === "stopped") {
        this.runtime.stop();
        return false;
      }
      if (!prepared || !this.runtime.start()) {
        this.visibleState = "safe-black";
        return false;
      }
      this.visibleState = this.runtime.state;
      return true;
    });
    return true;
  }

  public async advance(): Promise<number> {
    const epoch = this.lifecycleEpoch;
    const prepared = await this.preparation;
    if (this.lifecycleEpoch !== epoch) {
      this.runtime.stop();
      return 0;
    }
    if (prepared !== true) {
      this.visibleState = "safe-black";
      return 0;
    }
    const advanced = await this.runtime.advance();
    if (this.lifecycleEpoch !== epoch) {
      this.runtime.stop();
      return 0;
    }
    this.visibleState = this.runtime.state;
    return advanced;
  }

  public stop(): void {
    this.lifecycleEpoch += 1;
    this.runtime.stop();
    this.visibleState = "stopped";
  }
}

function privateChildEnvironment(
  baseEnvironment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const environment = { ...baseEnvironment };
  const denied = new Set([
    "MYVIMRC",
    "VIMINIT",
    "EXINIT",
    "NVIM_APPNAME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
  ]);
  for (const name of Object.keys(environment)) {
    if (denied.has(name.toUpperCase())) delete environment[name];
  }
  return environment;
}

async function runWithDeadline<T>(
  timeoutMs: number,
  operation: () => Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("show-runtime-operation-timeout")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function executeFileBounded(
  file: string,
  args: readonly string[],
  limits: {
    cwd?: string;
    timeoutMs: number;
    maxStdoutBytes: number;
    maxStderrBytes: number;
  },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    nodeExecFile(
      file,
      [...args],
      {
        cwd: limits.cwd,
        timeout: limits.timeoutMs,
        maxBuffer: Math.max(limits.maxStdoutBytes, limits.maxStderrBytes),
        encoding: "utf8",
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const errorCode = error?.code;
        resolve({
          exitCode:
            error === null ? 0 : typeof errorCode === "number" ? errorCode : 1,
          stdout: truncateUtf8(String(stdout), limits.maxStdoutBytes),
          stderr: truncateUtf8(String(stderr), limits.maxStderrBytes),
        });
      },
    );
  });
}

async function sampleProcessWithPowerShell(
  execFile: G2ExecFileAdapter,
  repositoryRoot: string,
  pid: number,
): Promise<{ rssBytes: number; handleCount: number }> {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error("process sample PID is invalid");
  }
  const result = await execFile(
    "pwsh",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      PROCESS_SAMPLE_SCRIPT,
      String(pid),
    ],
    {
      cwd: repositoryRoot,
      timeoutMs: 2_000,
      maxStdoutBytes: 4_096,
      maxStderrBytes: 4_096,
    },
  );
  if (
    result.exitCode !== 0 ||
    Buffer.byteLength(result.stdout, "utf8") > 4_096 ||
    Buffer.byteLength(result.stderr, "utf8") > 4_096
  ) {
    throw new Error("process-sample-failed");
  }
  return processSampleSchema.parse(JSON.parse(result.stdout));
}

async function inspectProcessStartedAtUtc(
  execFile: G2ExecFileAdapter,
  repositoryRoot: string,
  pid: number,
): Promise<string> {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error("process identity PID is invalid");
  }
  const result = await execFile(
    "pwsh",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      PROCESS_IDENTITY_SCRIPT,
      String(pid),
    ],
    {
      cwd: repositoryRoot,
      timeoutMs: 2_000,
      maxStdoutBytes: 4_096,
      maxStderrBytes: 4_096,
    },
  );
  if (
    result.exitCode !== 0 ||
    Buffer.byteLength(result.stdout, "utf8") > 4_096 ||
    Buffer.byteLength(result.stderr, "utf8") > 4_096
  ) {
    throw new Error("process-identity-sample-failed");
  }
  return processIdentitySchema.parse(JSON.parse(result.stdout)).startedAtUtc;
}

async function writeTerminalMarkerAtomic(
  path: string,
  value: unknown,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const marker = terminalMarkerSchema.parse(value);
  const serialized = `${JSON.stringify(marker, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > 4_096) {
    throw new Error("controller-terminal-marker-too-large");
  }
  if (existsSync(path)) throw new Error("controller-terminal-marker-already-exists");
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = join(
    dirname(path),
    `.controller-terminal-${process.pid}-${randomUUID()}.tmp`,
  );
  let descriptor: number | undefined;
  let ownsTemporary = false;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    ownsTemporary = true;
    writeFileSync(descriptor, serialized, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    signal.throwIfAborted();
    if (existsSync(path)) {
      throw new Error("controller-terminal-marker-already-exists");
    }
    renameSync(temporaryPath, path);
    ownsTemporary = false;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (ownsTemporary) rmSync(temporaryPath, { force: true });
  }
}

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maxBytes) return value;
  return bytes.subarray(0, maxBytes).toString("utf8");
}

const realTimers: OneLoopTimerAdapter = {
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (id: OneLoopTimerHandle) =>
    clearInterval(id as ReturnType<typeof setInterval>),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (id: OneLoopTimerHandle) =>
    clearTimeout(id as ReturnType<typeof setTimeout>),
};

function isRotation(value: unknown): value is 0 | 90 | 180 | 270 {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

function hash(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function pathsEqual(left: string, right: string): boolean {
  return win32.resolve(left).toLowerCase() === win32.resolve(right).toLowerCase();
}

function isAtOrBelow(candidate: string, root: string): boolean {
  const resolvedCandidate = win32.resolve(candidate).toLowerCase();
  const resolvedRoot = win32.resolve(root).replace(/[\\]+$/u, "").toLowerCase();
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(`${resolvedRoot}\\`)
  );
}

function containsUserNvimConfig(path: string): boolean {
  return /\\appdata\\local\\nvim(?:\\|$)/iu.test(win32.resolve(path));
}

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const artifactLockSchema = z
  .object({
    schema: z.literal(1),
    sourceRepository: z.literal("D:/github/JanVim"),
    tag: z.literal("v0.10.1-gmk.4"),
    commit: z.literal("e95633101d93f8448b0f906e918b5d836ab95273"),
    archive: z.string().min(1),
    archiveBytes: z.number().int().positive(),
    archiveSha256: hashSchema,
    checksum: z.string().min(1),
    checksumSha256: hashSchema,
    core: z.literal("janvim-core.exe"),
    coreBytes: z.literal(TASK9_ARTIFACT_IDENTITY.coreBytes),
    coreSha256: z.literal(TASK9_ARTIFACT_IDENTITY.coreSha256),
    runtimeLua: z.string().min(1),
    runtimeLuaSha256: hashSchema,
    artifactConfig: z.string().min(1),
    artifactConfigSha256: hashSchema,
    config: z.literal("show/janvim-show.toml"),
    configSha256: hashSchema,
    layoutEngine: z.literal("orthogonal"),
    role: z.literal("primary-projector"),
    provenanceKind: z.string().min(1),
    provenanceReference: z.string().min(1),
    provenanceRecord: z.string().min(1),
    provenanceSha256: hashSchema,
    evidenceRecord: z.string().min(1),
    evidenceSha256: hashSchema,
    pluginLabConfig: z.literal(
      "runtime/user-root/plugin-lab/config/init.lua",
    ),
    pluginLabConfigSha256: hashSchema,
  })
  .strict();

const networkSnapshotSchema = z
  .object({
    schema: z.literal(1),
    activeExternalDefaultRoutes: z.number().int().nonnegative(),
    connectedExternalProfiles: z.number().int().nonnegative(),
  })
  .strict();

const processSampleSchema = z
  .object({
    schema: z.literal(1),
    rssBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    handleCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict()
  .transform(({ rssBytes, handleCount }) => ({ rssBytes, handleCount }));
const processIdentitySchema = z
  .object({
    schema: z.literal(1),
    startedAtUtc: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u)
      .refine((value) => Number.isFinite(Date.parse(value))),
  })
  .strict();

const terminalMarkerSchema = z
  .object({
    schema: z.literal(1),
    runId: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
    controllerRunId: z.string().regex(/^[A-Za-z0-9._-]{1,96}$/),
    controllerPid: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    outcome: z.enum(["intentional-success", "intentional-failure"]),
    reason: z.string().regex(/^[a-z0-9-]{1,128}$/),
  })
  .strict();
