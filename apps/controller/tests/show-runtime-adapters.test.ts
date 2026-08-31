import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { EventEmitter } from "node:events";
import { join, win32 } from "node:path";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import type { AgentAck, AgentCommand } from "@janvim-exhibition/show-schema";

import type { LogStorage } from "../src/bounded-log.ts";
import type {
  OneLoopRuntime,
  OneLoopTimerAdapter,
  OneLoopTimerHandle,
} from "../src/one-loop-driver.ts";
import type { RunLease } from "../src/run-lease.ts";
import type { ShowCommand } from "../src/show-command.ts";
import type {
  ShowRunCoordinatorDependencies,
  ShowSecondarySurface,
} from "../src/show-run-coordinator.ts";
import { parseShowRunEvidence } from "../src/show-run-evidence.ts";
import {
  controllerStartedAtUtc,
  createShowLoopId,
  createShowRuntimeAdapters,
  type ShowRuntimeAdapterHost,
} from "../src/show-runtime-adapters.ts";

const fixtureRoot = process.cwd();
const artifactLock = readFileSync(
  join(fixtureRoot, "janvim-artifact.lock.json"),
);
const showConfig = readFileSync(
  join(fixtureRoot, "show", "janvim-show.toml"),
);
const manifest = readFileSync(
  join(fixtureRoot, "content", "fixture", "show.manifest.json"),
);
const poem = readFileSync(
  join(fixtureRoot, "content", "fixture", "poem.txt"),
);
const pluginLabInit = readFileSync(
  join(
    fixtureRoot,
    "runtime",
    "user-root",
    "plugin-lab",
    "config",
    "init.lua",
  ),
);
const janVimCore = readFileSync(
  join(fixtureRoot, "runtime", "janvim", "janvim-core.exe"),
);

const repositoryRoot = "D:\\show";
const rehearsalRoot =
  "D:\\VirtualData\\JanVim-Exhibition-Rehearsals\\show-001";
const displayMapPath = `${rehearsalRoot}\\display-map.json`;

const confirmedMap = {
  schema: 1,
  mappingStatus: "confirmed",
  expectedDisplayCount: 2,
  primary: {
    displayId: "111",
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    scaleFactor: 1,
    geometrySha256:
      "b2bc82d7bea454184acfb21ae9139e97c32aefb994443034423653e85f9c83cc",
  },
  secondary: {
    displayId: "222",
    bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
    scaleFactor: 1,
    geometrySha256:
      "2ebac5faac6c5f34562d1e91088736c9e70943c9c42846616a418db904319928",
  },
} as const;

const displays = [
  {
    id: 111,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    scaleFactor: 1,
    rotation: 0,
  },
  {
    id: 222,
    bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
    workArea: { x: 1920, y: 0, width: 1920, height: 1040 },
    scaleFactor: 1,
    rotation: 0,
  },
] as const;

class MemoryLogStorage implements LogStorage {
  public readonly files = new Map<string, string>();

  public append(path: string, text: string): void {
    this.files.set(path, (this.files.get(path) ?? "") + text);
  }

  public size(path: string): number {
    return Buffer.byteLength(this.files.get(path) ?? "", "utf8");
  }

  public exists(path: string): boolean {
    return this.files.has(path);
  }

  public rename(from: string, to: string): void {
    const value = this.files.get(from);
    if (value === undefined) return;
    this.files.set(to, value);
    this.files.delete(from);
  }

  public remove(path: string): void {
    this.files.delete(path);
  }
}

class FailFirstLogStorage extends MemoryLogStorage {
  private failNextAppend = true;

  public override append(path: string, text: string): void {
    if (this.failNextAppend) {
      this.failNextAppend = false;
      throw new Error("injected first show-log write failure");
    }
    super.append(path, text);
  }
}

interface ScheduledCallback {
  id: number;
  delayMs: number;
  callback: () => unknown;
}

class ManualTimers implements OneLoopTimerAdapter {
  private readonly intervals = new Map<number, ScheduledCallback>();
  private readonly timeouts = new Map<number, ScheduledCallback>();
  private nextId = 1;
  private nowMs = 100;
  private readOffsetMs = 0;

  public setInterval(callback: () => void, delayMs: number): number {
    const scheduled = { id: this.nextId++, delayMs, callback };
    this.intervals.set(scheduled.id, scheduled);
    return scheduled.id;
  }

  public clearInterval(id: OneLoopTimerHandle): void {
    if (typeof id === "number") this.intervals.delete(id);
  }

  public setTimeout(callback: () => void, delayMs: number): number {
    const scheduled = { id: this.nextId++, delayMs, callback };
    this.timeouts.set(scheduled.id, scheduled);
    return scheduled.id;
  }

  public clearTimeout(id: OneLoopTimerHandle): void {
    if (typeof id === "number") this.timeouts.delete(id);
  }

  public nowMonotonic(): number {
    const value = this.nowMs + this.readOffsetMs;
    this.readOffsetMs += 0.001;
    return value;
  }

  public advanceBy(milliseconds: number): void {
    this.nowMs += milliseconds;
    this.readOffsetMs = 0;
  }

  public async fireInterval(delayMs: number): Promise<void> {
    const scheduled = [...this.intervals.values()].find(
      (candidate) => candidate.delayMs === delayMs,
    );
    if (scheduled === undefined) {
      throw new Error(`no interval scheduled at ${delayMs} ms`);
    }
    await scheduled.callback();
  }

  public async fireTimeout(delayMs: number): Promise<void> {
    const scheduled = [...this.timeouts.values()].find(
      (candidate) => candidate.delayMs === delayMs,
    );
    if (scheduled === undefined) {
      throw new Error(`no timeout scheduled at ${delayMs} ms`);
    }
    this.timeouts.delete(scheduled.id);
    await scheduled.callback();
  }

  public activeTimeouts(delayMs: number): number {
    return [...this.timeouts.values()].filter(
      (candidate) => candidate.delayMs === delayMs,
    ).length;
  }
}

function publicationGate(): {
  promise: Promise<void>;
  resolve(): void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

type DeferredHostOperation =
  | "bridge-listen"
  | "artifact-verification"
  | "placement"
  | "lease-write"
  | "prepare"
  | "lease-generation-replace";

async function settlePromises(): Promise<void> {
  for (let index = 0; index < 32; index += 1) await Promise.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
  for (let index = 0; index < 32; index += 1) await Promise.resolve();
}

function showCommand(mode: ShowCommand["mode"] = "ValidateOnly"): ShowCommand {
  return {
    mode,
    rehearsalRoot,
    displayMapPath,
    runId: "show-001",
    controllerRunId: "controller-001",
    networkPolicy: "OfflineRequired",
  };
}

type FakeNetworkConnectivity =
  | "Disconnected"
  | "NoTraffic"
  | "Subnet"
  | "LocalNetwork"
  | "Internet";

interface FakeNetworkRoute {
  AddressFamily: "IPv4" | "IPv6";
  DestinationPrefix: string;
  InterfaceAlias: string;
  NextHop: string;
  State: "Alive" | "Dead";
}

interface FakeNetworkProfile {
  InterfaceAlias: string;
  IPv4Connectivity: FakeNetworkConnectivity;
  IPv6Connectivity: FakeNetworkConnectivity;
}

const fakeNetworkSnapshotHost = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Import-Module -Name 'Microsoft.PowerShell.Utility' -ErrorAction Stop
$PSModuleAutoLoadingPreference = 'None'
Set-StrictMode -Version Latest
$payloadBytes = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
$payloadText = [Text.UTF8Encoding]::new($false, $true).GetString($payloadBytes)
$payload = $payloadText | ConvertFrom-Json -Depth 8

function Get-NetRoute {
    [CmdletBinding()]
    param(
        [string]$AddressFamily,
        [string]$DestinationPrefix
    )

    foreach ($route in @($payload.routes)) {
        if (
            $PSBoundParameters.ContainsKey('AddressFamily') -and
            [string]$route.AddressFamily -cne $AddressFamily
        ) {
            continue
        }
        if (
            $PSBoundParameters.ContainsKey('DestinationPrefix') -and
            [string]$route.DestinationPrefix -cne $DestinationPrefix
        ) {
            continue
        }
        [pscustomobject]@{
            AddressFamily = [string]$route.AddressFamily
            DestinationPrefix = [string]$route.DestinationPrefix
            InterfaceAlias = [string]$route.InterfaceAlias
            NextHop = [string]$route.NextHop
            State = [string]$route.State
        }
    }
}

function Get-NetConnectionProfile {
    [CmdletBinding()]
    param()

    foreach ($profile in @($payload.profiles)) {
        [pscustomobject]@{
            InterfaceAlias = [string]$profile.InterfaceAlias
            IPv4Connectivity = [string]$profile.IPv4Connectivity
            IPv6Connectivity = [string]$profile.IPv6Connectivity
        }
    }
}

$scriptBytes = [Convert]::FromBase64String($env:SHOW_TEST_NETWORK_SCRIPT_BASE64)
$scriptText = [Text.UTF8Encoding]::new($false, $true).GetString($scriptBytes)
& ([scriptblock]::Create($scriptText))
`;

function executeFakeNetworkSnapshot(
  script: string,
  routes: readonly FakeNetworkRoute[],
  profiles: readonly FakeNetworkProfile[],
): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync(
    "pwsh",
    ["-NoProfile", "-NonInteractive", "-Command", fakeNetworkSnapshotHost],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        SHOW_TEST_NETWORK_SCRIPT_BASE64: Buffer.from(script, "utf8").toString(
          "base64",
        ),
      },
      input: Buffer.from(
        JSON.stringify({ routes, profiles }),
        "utf8",
      ).toString("base64"),
      maxBuffer: 1024 * 1024,
      timeout: 5_000,
      windowsHide: true,
    },
  );
  if (result.error !== undefined && result.error.code !== "ETIMEDOUT") {
    throw result.error;
  }
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr:
      result.error?.code === "ETIMEDOUT"
        ? `${result.stderr ?? ""}\nfake-network-snapshot-timeout`
        : (result.stderr ?? ""),
  };
}

function createValidationHarness(options: {
  secondaryEntryUrl?: string;
  bridgeHost?: string;
  routes?: readonly FakeNetworkRoute[];
  profiles?: readonly FakeNetworkProfile[];
  realpathOverrides?: Readonly<Record<string, string>>;
  artifactLockBytes?: Buffer;
} = {}) {
  const trace: string[] = [];
  const files = new Map<string, Buffer>([
    [
      win32.join(repositoryRoot, "janvim-artifact.lock.json"),
      options.artifactLockBytes ?? artifactLock,
    ],
    [win32.join(repositoryRoot, "show", "janvim-show.toml"), showConfig],
    [
      win32.join(repositoryRoot, "content", "fixture", "show.manifest.json"),
      manifest,
    ],
    [win32.join(repositoryRoot, "content", "fixture", "poem.txt"), poem],
    [
      win32.join(
        repositoryRoot,
        "runtime",
        "user-root",
        "plugin-lab",
        "config",
        "init.lua",
      ),
      pluginLabInit,
    ],
    [displayMapPath, Buffer.from(`${JSON.stringify(confirmedMap)}\n`, "utf8")],
    [
      win32.join(repositoryRoot, "runtime", "janvim", "janvim-core.exe"),
      Buffer.from(janVimCore),
    ],
  ]);
  const logStorage = new MemoryLogStorage();
  const processListeners = new Set<() => void>();
  const appListeners = new Set<(event: { preventDefault(): void }) => void>();

  class ForbiddenBrowserWindow {
    public constructor() {
      trace.push("browser-window");
      throw new Error("validation must not open a window");
    }
  }

  const host = {
    repositoryRoot,
    BrowserWindow: ForbiddenBrowserWindow,
    ipcMain: {
      on: vi.fn(),
      removeListener: vi.fn(),
    },
    screen: {
      getAllDisplays: () => {
        trace.push("display-snapshot");
        return displays;
      },
    },
    controllerProcess: {
      pid: 7001,
      startedAtUtc: "2026-08-30T00:00:00.000Z",
      on: (_event: "SIGINT", listener: () => void) => {
        processListeners.add(listener);
      },
      removeListener: (_event: "SIGINT", listener: () => void) => {
        processListeners.delete(listener);
      },
    },
    electronApp: {
      on: (
        _event: "before-quit",
        listener: (event: { preventDefault(): void }) => void,
      ) => {
        appListeners.add(listener);
      },
      removeListener: (
        _event: "before-quit",
        listener: (event: { preventDefault(): void }) => void,
      ) => {
        appListeners.delete(listener);
      },
    },
    baseEnvironment: {
      PATH: "C:\\Windows\\System32",
      USERPROFILE: "C:\\Users\\operator",
    },
    readFile: (path: string) => {
      const resolved = win32.resolve(path);
      trace.push(`read:${resolved}`);
      const value = files.get(resolved);
      if (value === undefined) throw new Error(`missing fake file: ${resolved}`);
      return Buffer.from(value);
    },
    realpath: (path: string) =>
      options.realpathOverrides?.[win32.resolve(path)] ?? win32.resolve(path),
    execFile: async (
      file: string,
      args: readonly string[],
      limits: {
        timeoutMs: number;
        maxStdoutBytes: number;
        maxStderrBytes: number;
      },
    ) => {
      expect(file).toBe("pwsh");
      if (args.some((argument) => argument.endsWith("verify-runtime.ps1"))) {
        trace.push("verify-runtime");
        expect(limits).toMatchObject({
          timeoutMs: 30_000,
          maxStdoutBytes: 8_192,
          maxStderrBytes: 8_192,
        });
        return { exitCode: 0, stdout: "verified\n", stderr: "" };
      }
      if (args.some((argument) => argument.includes("Get-NetRoute"))) {
        trace.push("network-snapshot");
        expect(args).toContain("-NoProfile");
        expect(args).toContain("-NonInteractive");
        expect(limits).toMatchObject({
          timeoutMs: 2_000,
          maxStdoutBytes: 16_384,
          maxStderrBytes: 16_384,
        });
        const commandIndex = args.indexOf("-Command");
        const script = args[commandIndex + 1];
        if (commandIndex < 0 || script === undefined) {
          throw new Error("network snapshot command fixture is incomplete");
        }
        return executeFakeNetworkSnapshot(
          script,
          options.routes ?? [],
          options.profiles ?? [],
        );
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    },
    verifyArtifact: async (lockPath: string, executablePath: string) => {
      trace.push(`verify-artifact:${lockPath}:${executablePath}`);
      return { ok: true as const };
    },
    spawn: () => {
      trace.push("spawn");
      throw new Error("validation must not spawn JanVim");
    },
    randomBytes: () => Buffer.from("ab".repeat(24), "hex"),
    createBridge: () => {
      trace.push("bridge");
      throw new Error("validation must not open a bridge");
    },
    runWithDeadline: async <T>(
      _timeoutMs: number,
      operation: () => Promise<T>,
    ): Promise<T> => operation(),
    logStorage,
    nowMonotonic: () => 100,
    nowUtc: () => "2026-08-30T00:00:01.000Z",
    sampleProcess: async () => ({ rssBytes: 1, handleCount: 1 }),
    writeRunLease: async () => undefined,
    replaceRunLease: async (_path: string, lease: unknown) => lease,
    removeRunLease: async () => true,
    writeShowEvidence: async () => undefined,
    writeTerminalMarker: async () => undefined,
    ...(options.secondaryEntryUrl === undefined
      ? {}
      : { secondaryEntryUrl: options.secondaryEntryUrl }),
    ...(options.bridgeHost === undefined
      ? {}
      : { bridgeHost: options.bridgeHost }),
  } as unknown as ShowRuntimeAdapterHost;

  return {
    adapters: createShowRuntimeAdapters(host),
    trace,
    processListeners,
    appListeners,
    replaceRuntimeCoreBytes: (value: Uint8Array) => {
      files.set(
        win32.join(repositoryRoot, "runtime", "janvim", "janvim-core.exe"),
        Buffer.from(value),
      );
    },
  };
}

function createStartupHarness(options: {
  logStorage?: MemoryLogStorage;
  artifactLockBytes?: Buffer;
  closeChildOnWindowClose?: boolean;
  processStartTimes?: readonly string[];
  failAwaitAgent?: boolean;
  missingChildStream?: "stdout" | "stderr";
  deferLaunchArtifactVerification?: boolean;
  deferInitialIdentityInspection?: boolean;
  deferLoopPrepare?: boolean;
  deferredHostOperation?: {
    name: DeferredHostOperation;
    invocation: number;
    gate: ReturnType<typeof publicationGate>;
  };
  removeRunLeaseResult?: boolean;
  replaceRunLeaseFailure?: boolean;
  closeChildAfterSecondIdentityInspection?: boolean;
  cleanupFailures?: readonly (
    | "close-listener"
    | "ipc"
    | "web-guard"
  )[];
  cleanupThrows?: readonly {
    action: "close-listener" | "ipc" | "web-guard";
    value: unknown;
  }[];
  rejectFirstEditorCueId?: string;
  writeShowEvidence?: (
    path: string,
    value: unknown,
    signal?: AbortSignal,
  ) => Promise<void>;
  writeTerminalMarker?: (
    path: string,
    value: unknown,
    signal?: AbortSignal,
  ) => Promise<void>;
} = {}) {
  const trace: string[] = [];
  const hostOperationCalls = new Map<DeferredHostOperation, number>();
  const waitForHostOperation = async (
    name: DeferredHostOperation,
  ): Promise<void> => {
    const invocation = (hostOperationCalls.get(name) ?? 0) + 1;
    hostOperationCalls.set(name, invocation);
    trace.push(`${name}:${invocation}:start`);
    if (
      options.deferredHostOperation?.name === name &&
      options.deferredHostOperation.invocation === invocation
    ) {
      await options.deferredHostOperation.gate.promise;
    }
    trace.push(`${name}:${invocation}:complete`);
  };
  const files = new Map<string, Buffer>([
    [
      win32.join(repositoryRoot, "janvim-artifact.lock.json"),
      options.artifactLockBytes ?? artifactLock,
    ],
    [win32.join(repositoryRoot, "show", "janvim-show.toml"), showConfig],
    [
      win32.join(repositoryRoot, "content", "fixture", "show.manifest.json"),
      manifest,
    ],
    [win32.join(repositoryRoot, "content", "fixture", "poem.txt"), poem],
    [
      win32.join(
        repositoryRoot,
        "runtime",
        "user-root",
        "plugin-lab",
        "config",
        "init.lua",
      ),
      pluginLabInit,
    ],
    [displayMapPath, Buffer.from(`${JSON.stringify(confirmedMap)}\n`, "utf8")],
    [
      win32.join(repositoryRoot, "runtime", "janvim", "janvim-core.exe"),
      Buffer.from(janVimCore),
    ],
  ]);
  const logStorage = options.logStorage ?? new MemoryLogStorage();
  const timers = new ManualTimers();
  let childKilled = false;
  let releaseLaunchArtifactVerification!: () => void;
  const launchArtifactVerificationGate = new Promise<void>((resolve) => {
    releaseLaunchArtifactVerification = resolve;
  });
  let releaseInitialIdentityInspection!: () => void;
  const initialIdentityInspectionGate = new Promise<void>((resolve) => {
    releaseInitialIdentityInspection = resolve;
  });
  const loopPrepareGate = publicationGate();
  const activeChildPids = new Set<number>();
  let maxActiveChildren = 0;
  class FakeChild extends EventEmitter {
    public readonly stdout =
      options.missingChildStream === "stdout" ? null : new PassThrough();
    public readonly stderr =
      options.missingChildStream === "stderr" ? null : new PassThrough();

    public constructor(public readonly pid: number) {
      super();
      this.once("close", () => activeChildPids.delete(this.pid));
    }

    public readonly kill = vi.fn(() => {
      trace.push("kill-janvim");
      childKilled = true;
      queueMicrotask(() => this.emit("close", 1));
      return true;
    });
  }
  const child = new FakeChild(8003);
  const children = [child];
  const leases: Array<{ path: string; lease: RunLease }> = [];
  const activeLeases = new Set<RunLease>();
  let maxActiveLeases = 0;
  const activeHwndPids = new Set<number>();
  let maxActiveHwnds = 0;
  let activeBridges = 0;
  let maxActiveBridges = 0;
  const bridgeDisconnectListeners: Array<Set<() => void>> = [];
  const sent: Array<{ channel: string; payload: unknown }> = [];
  const sampledPids: number[] = [];
  const evidenceAttempts: Array<{ path: string; value: unknown }> = [];
  const evidenceWrites: Array<{ path: string; value: unknown }> = [];
  const terminalWrites: Array<{ path: string; value: unknown }> = [];
  const processListeners = new Set<() => void>();
  const appListeners = new Set<(event: { preventDefault(): void }) => void>();
  const ipcListeners = new Map<
    string,
    (
      event: { sender?: unknown; senderFrame: { url: string } | null },
      payload: unknown,
    ) => void
  >();
  const cleanupAttempts = {
    closeListenerRemoval: 0,
    ipcRemoval: 0,
    webGuardDisposal: 0,
    windowClose: 0,
  };
  let browserOptions: Record<string, unknown> | undefined;
  let loadedUrl: string | undefined;
  let spawnCall:
    | {
        file: string;
        args: readonly string[];
        options: {
          cwd: string;
          env: NodeJS.ProcessEnv;
          shell: false;
          windowsHide: false;
          stdio: "pipe";
        };
      }
    | undefined;
  let placement:
    | {
        pid: number;
        bounds: { x: number; y: number; width: number; height: number };
      }
    | undefined;
  let lastWindow: FakeBrowserWindow | undefined;
  let requestFilter: { urls: string[] } | undefined;
  let beforeRequest:
    | ((
        details: { url: string },
        callback: (result: { cancel: boolean }) => void,
      ) => void)
    | undefined;
  let windowOpenHandler:
    | ((details: { url: string }) => { action: "deny" })
    | undefined;
  let processIdentityInspection = 0;
  let artifactVerification = 0;
  let prepareDispatches = 0;
  let spawnCount = 0;
  let timeoutFiveSecondOperations = false;
  const rejectedEditorCueIds = new Set<string>();

  class FakeWebContents extends EventEmitter {
    public constructor(private readonly rendererPid: number) {
      super();
    }

    public readonly session = {
      webRequest: {
        onBeforeRequest: (
          filter: { urls: string[] } | null,
          listener?: (
            details: { url: string },
            callback: (result: { cancel: boolean }) => void,
          ) => void,
        ) => {
          if (filter === null) {
            requestFilter = undefined;
            beforeRequest = undefined;
            return;
          }
          requestFilter = filter;
          beforeRequest = listener;
        },
      },
    };
    public readonly send = vi.fn((channel: string, payload: unknown) => {
      sent.push({ channel, payload });
      if (
        payload !== null &&
        typeof payload === "object" &&
        "type" in payload &&
        payload.type === "run-cue" &&
        "requiresPresentationAck" in payload &&
        payload.requiresPresentationAck === true &&
        "generationId" in payload &&
        typeof payload.generationId === "number" &&
        "loopId" in payload &&
        typeof payload.loopId === "string" &&
        "cue" in payload &&
        payload.cue !== null &&
        typeof payload.cue === "object" &&
        "id" in payload.cue &&
        typeof payload.cue.id === "string"
      ) {
        const listener = [...ipcListeners.values()][0];
        listener?.(
          { sender: this, senderFrame: { url: loadedUrl! } },
          {
            schema: 1,
            type: "presentation-ack",
            generationId: payload.generationId,
            loopId: payload.loopId,
            cueId: payload.cue.id,
          },
        );
      }
    });
    public readonly setWindowOpenHandler = vi.fn(
      (handler: (details: { url: string }) => { action: "deny" }) => {
        windowOpenHandler = handler;
      },
    );
    public readonly getOSProcessId = vi.fn(() => this.rendererPid);

    public override removeListener(
      eventName: string | symbol,
      listener: (...args: unknown[]) => void,
    ): this {
      if (eventName === "will-navigate") {
        cleanupAttempts.webGuardDisposal += 1;
        const injected = options.cleanupThrows?.find(
          (failure) => failure.action === "web-guard",
        );
        if (injected !== undefined) throw injected.value;
        if (options.cleanupFailures?.includes("web-guard") === true) {
          throw new Error("injected web-guard cleanup failure");
        }
      }
      return super.removeListener(eventName, listener);
    }
  }

  const webContentsHistory: FakeWebContents[] = [];

  class FakeBrowserWindow extends EventEmitter {
    public readonly webContents: FakeWebContents;
    private destroyed = false;

    public constructor(options: Record<string, unknown>) {
      super();
      this.webContents = new FakeWebContents(8002 + webContentsHistory.length);
      webContentsHistory.push(this.webContents);
      trace.push("browser-window");
      browserOptions = options;
      lastWindow = this;
    }

    public async loadURL(url: string): Promise<void> {
      trace.push("load-secondary");
      loadedUrl = url;
    }

    public close(): void {
      cleanupAttempts.windowClose += 1;
      this.emit("close");
      this.destroyed = true;
      this.emit("closed");
    }

    public destroy(): void {
      this.destroyed = true;
      this.emit("closed");
    }

    public isDestroyed(): boolean {
      return this.destroyed;
    }

    public override removeListener(
      eventName: string | symbol,
      listener: (...args: unknown[]) => void,
    ): this {
      if (eventName === "close") {
        cleanupAttempts.closeListenerRemoval += 1;
        const injected = options.cleanupThrows?.find(
          (failure) => failure.action === "close-listener",
        );
        if (injected !== undefined) throw injected.value;
        if (options.cleanupFailures?.includes("close-listener") === true) {
          throw new Error("injected close-listener cleanup failure");
        }
      }
      return super.removeListener(eventName, listener);
    }
  }

  const valueAfter = (args: readonly string[], flag: string): number => {
    const index = args.indexOf(flag);
    return Number(args[index + 1]);
  };
  const host = {
    repositoryRoot,
    BrowserWindow: FakeBrowserWindow,
    ipcMain: {
      on: (
        channel: string,
        listener: (
          event: { sender?: unknown; senderFrame: { url: string } | null },
          payload: unknown,
        ) => void,
      ) => {
        ipcListeners.set(channel, listener);
      },
      removeListener: (channel: string) => {
        cleanupAttempts.ipcRemoval += 1;
        const injected = options.cleanupThrows?.find(
          (failure) => failure.action === "ipc",
        );
        if (injected !== undefined) throw injected.value;
        if (options.cleanupFailures?.includes("ipc") === true) {
          throw new Error("injected IPC cleanup failure");
        }
        ipcListeners.delete(channel);
      },
    },
    screen: {
      getAllDisplays: () => {
        trace.push("display-snapshot");
        return displays;
      },
    },
    controllerProcess: {
      pid: 8001,
      startedAtUtc: "2026-08-30T00:00:00.000Z",
      on: (_event: "SIGINT", listener: () => void) => {
        processListeners.add(listener);
      },
      removeListener: (_event: "SIGINT", listener: () => void) => {
        processListeners.delete(listener);
      },
    },
    electronApp: {
      on: (
        _event: "before-quit",
        listener: (event: { preventDefault(): void }) => void,
      ) => {
        appListeners.add(listener);
      },
      removeListener: (
        _event: "before-quit",
        listener: (event: { preventDefault(): void }) => void,
      ) => {
        appListeners.delete(listener);
      },
    },
    baseEnvironment: {
      PATH: "C:\\Windows\\System32",
      USERPROFILE: "C:\\Users\\operator",
      MYVIMRC: "C:\\Users\\operator\\_vimrc",
      VIMINIT: "source user.vim",
      NVIM_APPNAME: "user-config",
      XDG_CONFIG_HOME: "C:\\Users\\operator\\.config",
    },
    readFile: (path: string) => {
      const resolved = win32.resolve(path);
      trace.push(`read:${resolved}`);
      const value = files.get(resolved);
      if (value === undefined) throw new Error(`missing fake file: ${resolved}`);
      return Buffer.from(value);
    },
    realpath: (path: string) => win32.resolve(path),
    execFile: async (
      file: string,
      args: readonly string[],
      limits: {
        timeoutMs: number;
        maxStdoutBytes: number;
        maxStderrBytes: number;
      },
    ) => {
      expect(file).toBe("pwsh");
      if (args.some((argument) => argument.endsWith("verify-runtime.ps1"))) {
        trace.push("verify-runtime");
        return { exitCode: 0, stdout: "verified\n", stderr: "" };
      }
      if (args.some((argument) => argument.includes("Get-NetRoute"))) {
        trace.push("network-snapshot");
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            schema: 1,
            activeExternalDefaultRoutes: 0,
            connectedExternalProfiles: 0,
          }),
          stderr: "",
        };
      }
      if (args.some((argument) => argument.endsWith("place-janvim-window.ps1"))) {
        expect(limits).toMatchObject({ timeoutMs: 12_000 });
        await waitForHostOperation("placement");
        placement = {
          pid: valueAfter(args, "-ChildProcessId"),
          bounds: {
            x: valueAfter(args, "-X"),
            y: valueAfter(args, "-Y"),
            width: valueAfter(args, "-Width"),
            height: valueAfter(args, "-Height"),
          },
        };
        activeHwndPids.add(placement.pid);
        maxActiveHwnds = Math.max(maxActiveHwnds, activeHwndPids.size);
        trace.push("place-window");
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            schema: 1,
            pid: placement.pid,
            matchedWindowCount: 1,
            hwnd: "0x0000000000001F43",
            visible: true,
            owned: false,
            requested: placement.bounds,
            actual: placement.bounds,
          }),
          stderr: "",
        };
      }
      if (args.some((argument) => argument.endsWith("close-janvim-window.ps1"))) {
        trace.push("close-window");
        const pid = valueAfter(args, "-ChildProcessId");
        const hwnd = args[args.indexOf("-Hwnd") + 1];
        activeHwndPids.delete(pid);
        if (options.closeChildOnWindowClose !== false) {
          const matchingChild = children.find((candidate) => candidate.pid === pid);
          queueMicrotask(() => matchingChild?.emit("close", 0));
        }
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            schema: 1,
            pid,
            hwnd,
            ownershipVerified: true,
            topLevel: true,
            closePosted: true,
          }),
          stderr: "",
        };
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    },
    verifyArtifact: async () => {
      trace.push("verify-artifact");
      artifactVerification += 1;
      await waitForHostOperation("artifact-verification");
      if (
        options.deferLaunchArtifactVerification === true &&
        artifactVerification === 2
      ) {
        trace.push("launch-artifact-verification-deferred");
        await launchArtifactVerificationGate;
      }
      return { ok: true as const };
    },
    spawn: (
      file: string,
      args: readonly string[],
      options: {
        cwd: string;
        env: NodeJS.ProcessEnv;
        shell: false;
        windowsHide: false;
        stdio: "pipe";
      },
    ) => {
      trace.push("spawn-janvim");
      spawnCall = { file, args, options };
      const spawnedChild =
        spawnCount === 0 ? child : new FakeChild(8003 + children.length);
      spawnCount += 1;
      if (!children.includes(spawnedChild)) children.push(spawnedChild);
      activeChildPids.add(spawnedChild.pid);
      maxActiveChildren = Math.max(maxActiveChildren, activeChildPids.size);
      return spawnedChild;
    },
    inspectProcessStartedAtUtc: async (pid: number) => {
      expect(children.some((candidate) => candidate.pid === pid)).toBe(true);
      trace.push("inspect-janvim-start");
      const startedAtUtc =
        options.processStartTimes?.[processIdentityInspection] ??
        "2026-08-30T00:00:00.500Z";
      if (
        options.deferInitialIdentityInspection === true &&
        processIdentityInspection === 0
      ) {
        await initialIdentityInspectionGate;
      }
      if (
        options.closeChildAfterSecondIdentityInspection === true &&
        processIdentityInspection === 1
      ) {
        queueMicrotask(() => child.emit("close", 0));
      }
      processIdentityInspection += 1;
      return startedAtUtc;
    },
    randomBytes: () => Buffer.from("ab".repeat(24), "hex"),
    createBridge: (token: string) => {
      const bridgeIndex = bridgeDisconnectListeners.length;
      const disconnectListeners = new Set<() => void>();
      bridgeDisconnectListeners.push(disconnectListeners);
      let listening = false;
      let closed = false;
      return {
        listen: async () => {
          expect(token).toBe("ab".repeat(24));
          trace.push(`bridge-listen:${bridgeIndex + 1}:start`);
          await waitForHostOperation("bridge-listen");
          listening = true;
          activeBridges += 1;
          maxActiveBridges = Math.max(maxActiveBridges, activeBridges);
          trace.push("bridge-listen");
          trace.push(`bridge-listen:${bridgeIndex + 1}:complete`);
          return {
            host: "127.0.0.1" as const,
            port: 32123 + bridgeIndex,
            family: "IPv4",
          };
        },
        waitForAgent: async (timeoutMs: number) => {
          expect(timeoutMs).toBe(10_000);
          trace.push("await-agent");
          if (options.failAwaitAgent === true) {
            throw new Error("injected agent-ready failure");
          }
        },
        dispatch: async (command: AgentCommand): Promise<AgentAck> => {
          trace.push(`agent:${command.action.type}`);
          if (command.action.type === "prepare") {
            prepareDispatches += 1;
            await waitForHostOperation("prepare");
            if (options.deferLoopPrepare === true && prepareDispatches === 2) {
              trace.push("loop-prepare-deferred");
              await loopPrepareGate.promise;
            }
          }
          if (
            command.cueId === options.rejectFirstEditorCueId &&
            !rejectedEditorCueIds.has(command.cueId)
          ) {
            rejectedEditorCueIds.add(command.cueId);
            throw new Error("injected editor dispatch rejection");
          }
          return {
            schema: 1,
            loopId: command.loopId,
            cueId: command.cueId,
            outcome: "applied",
            mode: "n",
            cursor: { row: 0, col: 0 },
            bufferSha256:
              command.action.type === "prepare"
                ? command.action.expectedSha256
                : "b699de273f5bbaedb08241495f52ce863d3e8e1851275ce3b6251484d75190a8",
          };
        },
        onAgentDisconnected: (listener: () => void) => {
          disconnectListeners.add(listener);
          return () => disconnectListeners.delete(listener);
        },
        close: async () => {
          trace.push("bridge-close");
          if (!closed && listening) activeBridges -= 1;
          closed = true;
          disconnectListeners.clear();
        },
        diagnostics: () => ({
          activeConnections: closed ? 0 : 1,
          authenticatedConnections: closed ? 0 : 1,
          pendingCommands: 0,
          pendingTimers: 0,
          sessionListeners: closed ? 0 : 3,
          readyWaiters: 0,
        }),
      };
    },
    runWithDeadline: async <T>(
      timeoutMs: number,
      operation: () => Promise<T>,
    ): Promise<T> => {
      const pending = operation();
      if (childKilled && timeoutMs === 5_000) {
        void pending.catch(() => undefined);
        return undefined as T;
      }
      if (timeoutFiveSecondOperations && timeoutMs === 5_000) {
        void pending.catch(() => undefined);
        throw new Error("injected five-second timeout");
      }
      return pending;
    },
    logStorage,
    nowMonotonic: () => timers.nowMonotonic(),
    timers,
    nowUtc: () => "2026-08-30T00:00:01.000Z",
    sampleProcess: async (pid: number) => {
      sampledPids.push(pid);
      return { rssBytes: pid * 10, handleCount: pid };
    },
    writeRunLease: async (path: string, lease: RunLease) => {
      await waitForHostOperation("lease-write");
      trace.push("write-lease");
      leases.push({ path, lease });
      activeLeases.add(lease);
      maxActiveLeases = Math.max(maxActiveLeases, activeLeases.size);
    },
    replaceRunLease: async (
      path: string,
      lease: RunLease,
      nextGenerationId: number,
    ) => {
      trace.push("replace-lease-generation:start");
      await waitForHostOperation("lease-generation-replace");
      if (options.replaceRunLeaseFailure === true) {
        trace.push("replace-lease-generation:rejected");
        throw new Error("injected lease generation replacement failure");
      }
      const replacement = { ...lease, generationId: nextGenerationId };
      activeLeases.delete(lease);
      activeLeases.add(replacement);
      trace.push("replace-lease-generation:complete");
      return replacement;
    },
    removeRunLease: async (_path: string, lease: RunLease) => {
      trace.push("remove-lease");
      if (options.removeRunLeaseResult === false) return false;
      activeLeases.delete(lease);
      return true;
    },
    writeShowEvidence:
      options.writeShowEvidence ??
      (async (path: string, value: unknown) => {
        trace.push("write-evidence");
        evidenceAttempts.push({ path, value });
        evidenceWrites.push({ path, value: parseShowRunEvidence(value) });
      }),
    writeTerminalMarker:
      options.writeTerminalMarker ??
      (async (path: string, value: unknown) => {
        trace.push("write-terminal");
        terminalWrites.push({ path, value });
      }),
  } as unknown as ShowRuntimeAdapterHost;

  return {
    adapters: createShowRuntimeAdapters(host),
    timers,
    trace,
    logStorage,
    leases,
    sent,
    sampledPids,
    evidenceAttempts,
    evidenceWrites,
    terminalWrites,
    processListeners,
    appListeners,
    ipcListeners,
    cleanupAttempts,
    child,
    children,
    webContentsHistory,
    get browserOptions() {
      return browserOptions;
    },
    get loadedUrl() {
      return loadedUrl;
    },
    get spawnCall() {
      return spawnCall;
    },
    get placement() {
      return placement;
    },
    get webContents() {
      return lastWindow?.webContents;
    },
    dispatchRequest: (url: string) => {
      let result: { cancel: boolean } | undefined;
      beforeRequest?.({ url }, (value) => {
        result = value;
      });
      return result;
    },
    dispatchNavigation: (url: string) => {
      const preventDefault = vi.fn();
      lastWindow?.webContents.emit("will-navigate", { preventDefault }, url);
      return preventDefault.mock.calls.length;
    },
    dispatchWindowOpen: (url: string) => windowOpenHandler?.({ url }),
    get requestFilter() {
      return requestFilter;
    },
    emitSigint: () => {
      for (const listener of [...processListeners]) listener();
    },
    emitElectronQuit: () => {
      const preventDefault = vi.fn();
      for (const listener of [...appListeners]) listener({ preventDefault });
      return preventDefault.mock.calls.length;
    },
    emitWindowClose: () => {
      lastWindow?.emit("close");
    },
    destroySecondary: () => {
      lastWindow?.destroy();
    },
    emitAgentDisconnect: (bridgeIndex = bridgeDisconnectListeners.length - 1) => {
      const listeners = bridgeDisconnectListeners[bridgeIndex];
      if (listeners === undefined) throw new Error("bridge disconnect fixture is missing");
      for (const listener of [...listeners]) listener();
    },
    bridgeDisconnectListenerCount: (
      bridgeIndex = bridgeDisconnectListeners.length - 1,
    ) => bridgeDisconnectListeners[bridgeIndex]?.size ?? 0,
    emitJanVimExit: (childIndex = children.length - 1) => {
      const target = children[childIndex];
      if (target === undefined) throw new Error("JanVim child fixture is missing");
      target.emit("close", 1);
    },
    activeResourceCounts: () => ({
      bridges: activeBridges,
      children: activeChildPids.size,
      hwnds: activeHwndPids.size,
      leases: activeLeases.size,
    }),
    maxActiveResourceCounts: () => ({
      bridges: maxActiveBridges,
      children: maxActiveChildren,
      hwnds: maxActiveHwnds,
      leases: maxActiveLeases,
    }),
    hostOperationInvocationCount: (name: DeferredHostOperation) =>
      hostOperationCalls.get(name) ?? 0,
    spawnInvocationCount: () => spawnCount,
    enableFiveSecondTimeouts: () => {
      timeoutFiveSecondOperations = true;
    },
    releaseLaunchArtifactVerification,
    releaseInitialIdentityInspection,
    releaseLoopPrepare: loopPrepareGate.resolve,
    replaceRuntimeCoreBytes: (value: Uint8Array) => {
      files.set(
        win32.join(repositoryRoot, "runtime", "janvim", "janvim-core.exe"),
        Buffer.from(value),
      );
    },
  };
}

async function bootAndStartRuntimeHarness(
  harness: ReturnType<typeof createStartupHarness>,
) {
  const coordinator = harness.adapters.createCoordinator(showCommand("Show"));
  await expect(coordinator.boot()).resolves.toEqual({ ready: true });
  expect(
    coordinator.handleRendererEvent({
      schema: 1,
      type: "operator-action",
      action: "start",
    }),
  ).toBe(true);
  await settlePromises();
  expect(coordinator.diagnostics().state).toBe("running");
  return coordinator;
}

describe("real Task 9 show runtime adapters", () => {
  it("reports one exact editor cue before bridge dispatch across a bounded retry", async () => {
    const harness = createStartupHarness({ rejectFirstEditorCueId: "cue-insert" });
    const coordinator = harness.adapters.createCoordinator(showCommand("Show"));
    const dependencies = (
      coordinator as unknown as { dependencies: ShowRunCoordinatorDependencies }
    ).dependencies;
    await dependencies.validate();
    const session = dependencies.createSession(1);
    const signal = new AbortController().signal;
    await session.startBridge(signal);
    await session.launchJanVim(signal);
    await session.placeJanVim(signal);
    await session.awaitAgent(signal);
    const primaryDispatches: Array<{
      generationId: number;
      loopId: string;
      cueId: string;
      cue: unknown;
    }> = [];
    const runtime = session.createLoop(
      "runtime-loop-1",
      {
        rendererPid: 8002,
        send: () => undefined,
        onEvent: () => () => undefined,
        onDestroyed: () => () => undefined,
        close: () => undefined,
        diagnostics: () => ({ listeners: 0 }),
      },
      () => "runtime-loop-2",
      (event) => {
        primaryDispatches.push(event);
        harness.trace.push(`primary-dispatch:${event.cueId}`);
      },
    );

    expect(runtime.start()).toBe(true);
    await settlePromises();
    expect(runtime.state).toBe("running");
    for (const deltaMs of [5_001, 7_001, 33_001, 10_001]) {
      harness.timers.advanceBy(deltaMs);
      await runtime.advance();
    }

    expect(primaryDispatches).toEqual([
      expect.objectContaining({
        generationId: 1,
        loopId: "runtime-loop-1",
        cueId: "cue-insert",
        cue: expect.objectContaining({
          id: "cue-insert",
          kind: "editor-action",
          payload: expect.objectContaining({ action: expect.objectContaining({ type: "insert" }) }),
        }),
      }),
    ]);
    expect(harness.trace.filter((event) => event === "agent:insert")).toHaveLength(2);
    expect(harness.trace.indexOf("primary-dispatch:cue-insert")).toBeLessThan(
      harness.trace.indexOf("agent:insert"),
    );
  });

  it.each([
    [["close-listener"], "injected close-listener cleanup failure"],
    [["ipc"], "injected IPC cleanup failure"],
    [["web-guard"], "injected web-guard cleanup failure"],
    [
      ["close-listener", "ipc", "web-guard"],
      "injected close-listener cleanup failure",
    ],
  ] as const)(
    "attempts every secondary cleanup once when %j throws",
    async (cleanupFailures, firstError) => {
      const harness = createStartupHarness({ cleanupFailures });
      const coordinator = harness.adapters.createCoordinator(showCommand("Show"));
      const dependencies = (
        coordinator as unknown as {
          dependencies: ShowRunCoordinatorDependencies;
        }
      ).dependencies;
      await dependencies.validate();
      const surface: ShowSecondarySurface = await dependencies.openSecondary(
        1,
        new AbortController().signal,
      );
      surface.onEvent(() => undefined);
      surface.onDestroyed(() => undefined);

      expect(() => surface.close()).toThrowError(firstError);
      expect(() => surface.close()).not.toThrow();
      expect(harness.cleanupAttempts).toEqual({
        closeListenerRemoval: 1,
        ipcRemoval: 1,
        webGuardDisposal: 1,
        windowClose: 1,
      });
      expect(surface.diagnostics()).toEqual({ listeners: 0 });
    },
  );

  it.each([undefined, null] as const)(
    "preserves a first cleanup throw of %s before a later Error",
    async (firstThrownValue) => {
      const harness = createStartupHarness({
        cleanupThrows: [
          { action: "close-listener", value: firstThrownValue },
          { action: "ipc", value: new Error("later IPC cleanup failure") },
        ],
      });
      const coordinator = harness.adapters.createCoordinator(showCommand("Show"));
      const dependencies = (
        coordinator as unknown as {
          dependencies: ShowRunCoordinatorDependencies;
        }
      ).dependencies;
      await dependencies.validate();
      const surface: ShowSecondarySurface = await dependencies.openSecondary(
        1,
        new AbortController().signal,
      );
      surface.onEvent(() => undefined);
      surface.onDestroyed(() => undefined);

      let didThrow = false;
      let caughtValue: unknown;
      try {
        surface.close();
      } catch (error) {
        didThrow = true;
        caughtValue = error;
      }

      expect(() => surface.close()).not.toThrow();
      expect(harness.cleanupAttempts).toEqual({
        closeListenerRemoval: 1,
        ipcRemoval: 1,
        webGuardDisposal: 1,
        windowClose: 1,
      });
      expect(surface.diagnostics()).toEqual({ listeners: 0 });
      expect(didThrow).toBe(true);
      expect(caughtValue).toBe(firstThrownValue);
    },
  );

  it("uses only a valid native Electron process creation timestamp for leases", () => {
    expect(controllerStartedAtUtc(1_788_048_000_123)).toBe(
      "2026-08-30T00:00:00.123Z",
    );
    for (const value of [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => controllerStartedAtUtc(value)).toThrow(/creation|time/i);
    }
  });

  it("keeps the production controller graph application-offline", () => {
    const controllerSourceRoot = join(fixtureRoot, "apps", "controller", "src");
    const sources = readdirSync(controllerSourceRoot)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => ({
        name,
        text: readFileSync(join(controllerSourceRoot, name), "utf8"),
      }));
    const prohibitedNodeModules = [
      "node:dgram",
      "node:dns",
      "node:http",
      "node:https",
      "node:tls",
    ];

    for (const { name, text } of sources) {
      const nodeImports = Array.from(
        text.matchAll(/\bfrom\s+["'](node:[^"']+)["']/gu),
        (match) => match[1]!,
      );
      for (const specifier of nodeImports) {
        expect(
          prohibitedNodeModules.some(
            (module) => specifier === module || specifier.startsWith(`${module}/`),
          ),
          `${name} imports ${specifier}`,
        ).toBe(false);
      }
      expect(text, `${name} contains an outbound client API`).not.toMatch(
        /\bfetch\s*\(|\bnew\s+WebSocket\b|\bcreateConnection\s*\(|\bdownloadURL\b|\bwill-download\b/u,
      );
      expect(text, `${name} enables a child shell`).not.toMatch(/\bshell\s*:\s*true\b/u);
    }

    const netImporters = sources
      .filter(({ text }) => /\bfrom\s+["']node:net["']/u.test(text))
      .map(({ name }) => name)
      .sort();
    expect(netImporters).toEqual(["bridge-server.ts", "run-lease.ts"]);
    const bridgeSource = sources.find(({ name }) => name === "bridge-server.ts")!.text;
    expect(bridgeSource).toContain('const LISTEN_HOST = "127.0.0.1"');
    const leaseSource = sources.find(({ name }) => name === "run-lease.ts")!.text;
    expect(leaseSource).toContain("server.listen({");
    expect(leaseSource).toContain("path: endpoint");
    expect(leaseSource).not.toMatch(/\bconnect\s*\(|\bcreateConnection\s*\(/u);

    const adapterSource = sources.find(
      ({ name }) => name === "show-runtime-adapters.ts",
    )!.text;
    expect(
      Array.from(
        adapterSource.matchAll(/["']-Command["']\s*,\s*([A-Z_]+)/gu),
        (match) => match[1],
      ),
    ).toEqual([
      "NETWORK_SNAPSHOT_SCRIPT",
      "PROCESS_SAMPLE_SCRIPT",
      "PROCESS_IDENTITY_SCRIPT",
    ]);
  });

  it("derives unique evidence-safe loop IDs from maximum-length run identities", () => {
    const firstRun = `${"r".repeat(63)}a`;
    const secondRun = `${"r".repeat(63)}b`;
    const first = createShowLoopId(firstRun, 1, 1);
    const second = createShowLoopId(secondRun, 1, 1);

    expect(first).toMatch(/^[A-Za-z0-9._-]{1,64}$/);
    expect(Buffer.byteLength(first, "utf8")).toBeLessThanOrEqual(64);
    expect(second).not.toBe(first);
    expect(createShowLoopId(firstRun, 2, 1)).not.toBe(first);
    expect(createShowLoopId(firstRun, 1, 2)).not.toBe(first);
    expect(createShowLoopId("show-001", 3, 2)).toBe("show-001-g3-l2");
    expect(() => createShowLoopId("../show", 1, 1)).toThrow();
    expect(() => createShowLoopId(firstRun, 0, 1)).toThrow();
  });

  it("constructs the real default host without performing validation I/O", () => {
    const trace: string[] = [];
    class NoIoBrowserWindow {
      public constructor() {
        trace.push("window");
      }
    }
    const host = {
      repositoryRoot: "D:\\show space#percent%",
      secondaryEntryUrl:
        "file:///D:/show%20space%23percent%25/apps/secondary-screen/dist/index.html",
      BrowserWindow: NoIoBrowserWindow,
      ipcMain: {
        on: () => trace.push("ipc-on"),
        removeListener: () => trace.push("ipc-off"),
      },
      screen: {
        getAllDisplays: () => {
          trace.push("screen");
          return [];
        },
      },
      controllerProcess: {
        pid: 8001,
        startedAtUtc: "2026-08-30T00:00:00.000Z",
        on: () => trace.push("process-on"),
        removeListener: () => trace.push("process-off"),
      },
      electronApp: {
        on: () => trace.push("app-on"),
        removeListener: () => trace.push("app-off"),
      },
    } as unknown as ShowRuntimeAdapterHost;

    expect(() => createShowRuntimeAdapters(host)).not.toThrow();
    expect(trace).toEqual([]);
  });

  it("validates frozen show inputs, the exact artifact, live routing, and offline state headlessly", async () => {
    const harness = createValidationHarness();

    await expect(harness.adapters.validate(showCommand())).resolves.toBeUndefined();

    expect(harness.trace).toEqual([
      "verify-runtime",
      "read:D:\\show\\janvim-artifact.lock.json",
      "read:D:\\show\\show\\janvim-show.toml",
      "read:D:\\show\\content\\fixture\\show.manifest.json",
      "read:D:\\show\\content\\fixture\\poem.txt",
      "read:D:\\show\\runtime\\user-root\\plugin-lab\\config\\init.lua",
      "read:D:\\VirtualData\\JanVim-Exhibition-Rehearsals\\show-001\\display-map.json",
      "read:D:\\show\\runtime\\janvim\\janvim-core.exe",
      "display-snapshot",
      "verify-artifact:D:\\show\\janvim-artifact.lock.json:D:\\show\\runtime\\janvim\\janvim-core.exe",
      "network-snapshot",
      "read:D:\\show\\janvim-artifact.lock.json",
      "read:D:\\show\\show\\janvim-show.toml",
      "read:D:\\show\\content\\fixture\\show.manifest.json",
      "read:D:\\show\\content\\fixture\\poem.txt",
      "read:D:\\show\\runtime\\user-root\\plugin-lab\\config\\init.lua",
      "read:D:\\VirtualData\\JanVim-Exhibition-Rehearsals\\show-001\\display-map.json",
      "read:D:\\show\\runtime\\janvim\\janvim-core.exe",
    ]);
    expect(janVimCore.byteLength).toBe(18_866_688);
    expect(createHash("sha256").update(janVimCore).digest("hex")).toBe(
      "224b3457d89fbc6cf946359683632f29f9262bae08b6f0d2e3043a3a7a6d83b3",
    );
    expect(harness.processListeners).toHaveLength(0);
    expect(harness.appListeners).toHaveLength(0);
  });

  it("rejects a structurally valid artifact lock whose exact file hash changed", async () => {
    const changedLock = Buffer.from(
      artifactLock
        .toString("utf8")
        .replace('"archiveBytes": 31345595', '"archiveBytes": 31345594'),
      "utf8",
    );
    const harness = createValidationHarness({ artifactLockBytes: changedLock });

    await expect(harness.adapters.validate(showCommand())).rejects.toThrow(
      /artifact.*lock.*hash/i,
    );
    expect(harness.trace).not.toContain("network-snapshot");
    expect(harness.trace.some((event) => event.startsWith("verify-artifact:"))).toBe(
      false,
    );
  });

  it.each([
    ["exhibition repository", repositoryRoot],
    ["JanVim product repository", "D:\\github\\JanVim"],
    ["user Neovim configuration", "C:\\Users\\operator\\AppData\\Local\\nvim"],
    [
      "protected incident root",
      "D:\\VirtualData\\TempCache\\janvim-root-export-quarantine-20260826-110433-6473a2d7ebbc4524b66c61c07e540504",
    ],
  ])("rejects a rehearsal junction into the %s before runtime I/O", async (_label, target) => {
    const harness = createValidationHarness({
      realpathOverrides: {
        [win32.resolve(rehearsalRoot)]: target,
        [win32.resolve(displayMapPath)]: win32.join(target, "display-map.json"),
      },
    });

    await expect(harness.adapters.validate(showCommand())).rejects.toThrow(
      /canonical|reparse|real path|rehearsal/i,
    );
    expect(harness.trace).not.toContain("verify-runtime");
  });

  it("rejects a rehearsal junction into a different sibling run", async () => {
    const siblingRoot = win32.join(
      "D:\\VirtualData\\JanVim-Exhibition-Rehearsals",
      "show-002",
    );
    const harness = createValidationHarness({
      realpathOverrides: {
        [win32.resolve(rehearsalRoot)]: siblingRoot,
        [win32.resolve(displayMapPath)]: win32.join(
          siblingRoot,
          "display-map.json",
        ),
      },
    });

    await expect(harness.adapters.validate(showCommand())).rejects.toThrow(
      /canonical|reparse|rehearsal/i,
    );
    expect(harness.trace).not.toContain("verify-runtime");
  });

  it("boots the approved secondary, bridge, private JanVim child, HWND, and token-free lease in order", async () => {
    const harness = createStartupHarness();
    const coordinator = harness.adapters.createCoordinator(showCommand("Soak3"));

    await expect(coordinator.boot()).resolves.toEqual({ ready: true });

    const ordered = [
      "verify-runtime",
      "display-snapshot",
      "network-snapshot",
      "browser-window",
      "load-secondary",
      "bridge-listen",
      "verify-artifact",
      "spawn-janvim",
      "inspect-janvim-start",
      "place-window",
      "write-lease",
      "await-agent",
      "agent:prepare",
    ];
    let prior = -1;
    for (const event of ordered) {
      const index = harness.trace.indexOf(event, prior + 1);
      expect(index, `${event} missing from ${harness.trace.join(",")}`).toBeGreaterThan(
        prior,
      );
      prior = index;
    }
    expect(harness.loadedUrl).toBe(
      "file:///D:/show/apps/secondary-screen/dist/index.html",
    );
    expect(harness.browserOptions).toMatchObject({
      frame: false,
      fullscreen: true,
      x: 1920,
      y: 0,
      width: 1920,
      height: 1080,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: "D:\\show\\apps\\controller\\dist\\preload\\preload.cjs",
      },
    });
    expect(harness.spawnCall).toEqual({
      file: "D:\\show\\runtime\\janvim\\janvim-core.exe",
      args: [
        "--config",
        "D:\\show\\show\\janvim-show.toml",
        "D:\\show\\content\\fixture\\poem.txt",
      ],
      options: {
        cwd: "D:\\show\\runtime\\janvim",
        env: {
          PATH: "C:\\Windows\\System32",
          USERPROFILE: "C:\\Users\\operator",
          JANVIM_USER_ROOT: "D:\\show\\runtime\\user-root",
          JANVIM_EXHIBITION_PORT: "32123",
          JANVIM_EXHIBITION_TOKEN: "ab".repeat(24),
        },
        shell: false,
        windowsHide: false,
        stdio: "pipe",
      },
    });
    expect(harness.placement).toEqual({
      pid: 8003,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    });
    expect(harness.leases).toHaveLength(1);
    expect(harness.leases[0]).toEqual({
      path: `${rehearsalRoot}\\run-lease.json`,
      lease: {
        schema: 1,
        runId: "show-001",
        controllerRunId: "controller-001",
        generationId: 1,
        controller: {
          pid: 8001,
          startedAtUtc: "2026-08-30T00:00:00.000Z",
        },
        janvim: {
          pid: 8003,
          startedAtUtc: "2026-08-30T00:00:00.500Z",
          hwnd: "0x0000000000001F43",
          executableRelativePath: "janvim-core.exe",
          executableSha256:
            "224b3457d89fbc6cf946359683632f29f9262bae08b6f0d2e3043a3a7a6d83b3",
        },
      },
    });
    expect(JSON.stringify(harness.leases)).not.toContain("ab".repeat(24));

    const controllerLog = [...harness.logStorage.files.entries()]
      .filter(([path]) => path.includes(".controller"))
      .map(([, value]) => value)
      .join("");
    const events = controllerLog
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events).toContainEqual({
      type: "secondary-opened",
      runId: "show-001",
      controllerRunId: "controller-001",
      generationId: 1,
      rendererPid: 8002,
    });
    expect(events.filter((event) => event.type === "p1-skip")).toEqual([
      { type: "p1-skip", feature: "formula", reason: "fixture-asset-absent" },
      { type: "p1-skip", feature: "image", reason: "fixture-asset-absent" },
      { type: "p1-skip", feature: "matrix", reason: "fixture-asset-absent" },
    ]);
    expect([...harness.logStorage.files.keys()].join("\n")).not.toMatch(
      /generation|g1/i,
    );
  });

  it("rejects a runtime-core byte change after validation before spawn", async () => {
    const harness = createStartupHarness();
    const coordinator = harness.adapters.createCoordinator(showCommand("Show"));
    const dependencies = (
      coordinator as unknown as { dependencies: ShowRunCoordinatorDependencies }
    ).dependencies;
    await dependencies.validate();
    const session = dependencies.createSession(1);
    const changedCore = Buffer.from(janVimCore);
    changedCore[0] = changedCore[0]! ^ 0xff;
    harness.replaceRuntimeCoreBytes(changedCore);
    const signal = new AbortController().signal;
    await session.startBridge(signal);

    await expect(session.launchJanVim(signal)).rejects.toThrow(
      "runtime-core-changed-during-run",
    );
    expect(harness.spawnInvocationCount()).toBe(0);
  });

  it("rejects a runtime-core byte change after validation before evidence passes", async () => {
    const harness = createStartupHarness();
    const coordinator = harness.adapters.createCoordinator(showCommand("Show"));
    const dependencies = (
      coordinator as unknown as { dependencies: ShowRunCoordinatorDependencies }
    ).dependencies;
    await dependencies.validate();
    const changedCore = Buffer.from(janVimCore);
    changedCore[changedCore.byteLength - 1] =
      changedCore[changedCore.byteLength - 1]! ^ 0xff;
    harness.replaceRuntimeCoreBytes(changedCore);

    await expect(
      dependencies.finalizeEvidence(
        { ok: true, reason: "soak-complete" },
        coordinator.diagnostics(),
        new AbortController().signal,
      ),
    ).rejects.toThrow("runtime-core-changed-during-run");
    expect(harness.evidenceAttempts).toHaveLength(0);
  });

  it("does not revive a stopped runtime when deferred loop preparation settles", async () => {
    const harness = createStartupHarness({ deferLoopPrepare: true });
    const coordinator = harness.adapters.createCoordinator(showCommand("Show"));
    await expect(coordinator.boot()).resolves.toEqual({ ready: true });

    expect(
      coordinator.handleRendererEvent({
        schema: 1,
        type: "operator-action",
        action: "start",
      }),
    ).toBe(true);
    await settlePromises();
    expect(harness.trace).toContain("loop-prepare-deferred");

    const driver = (
      coordinator as unknown as {
        driver?: {
          options: {
            runtime: OneLoopRuntime & { runtime: OneLoopRuntime };
          };
        };
      }
    ).driver;
    if (driver === undefined) throw new Error("active driver fixture is missing");
    const preparedRuntime = driver.options.runtime;
    const deterministicRuntime = preparedRuntime.runtime;
    const runtimeStart = vi.spyOn(deterministicRuntime, "start");

    await coordinator.requestEmergencyStop("sigint");
    await expect(coordinator.completion).resolves.toEqual({
      ok: false,
      reason: "emergency-sigint",
    });
    expect(preparedRuntime.state).toBe("stopped");
    expect(deterministicRuntime.state).toBe("stopped");

    harness.releaseLoopPrepare();
    await settlePromises();
    expect(preparedRuntime.state).toBe("stopped");
    expect(deterministicRuntime.state).toBe("stopped");
    expect(runtimeStart).not.toHaveBeenCalled();
  });

  it("opens a distinct secondary and awaits retained-lease generation CAS before reset and publication", async () => {
    const generationGate = publicationGate();
    const harness = createStartupHarness({
      deferredHostOperation: {
        name: "lease-generation-replace",
        invocation: 1,
        gate: generationGate,
      },
    });
    const coordinator = await bootAndStartRuntimeHarness(harness);
    const oldWebContents = harness.webContentsHistory[0]!;
    const oldRendererPid = oldWebContents.getOSProcessId();

    try {
      harness.destroySecondary();
      await settlePromises();
      expect(coordinator.diagnostics()).toMatchObject({
        state: "black-recovering",
        generationId: 2,
      });
      expect(harness.timers.activeTimeouts(1_000)).toBe(1);

      await harness.timers.fireTimeout(1_000);
      await settlePromises();
      const newWebContents = harness.webContentsHistory[1]!;
      expect(newWebContents).not.toBe(oldWebContents);
      expect(newWebContents.getOSProcessId()).not.toBe(oldRendererPid);
      expect(harness.trace).not.toContain("agent:reset");
      expect(coordinator.diagnostics()).toMatchObject({
        state: "black-recovering",
        generationId: 2,
        currentLoopId: null,
      });

      generationGate.resolve();
      await settlePromises();
      const casComplete = harness.trace.indexOf("replace-lease-generation:complete");
      const reset = harness.trace.indexOf("agent:reset");
      expect(casComplete).toBeGreaterThan(-1);
      expect(casComplete).toBeLessThan(reset);
      expect(coordinator.diagnostics()).toMatchObject({
        state: "running",
        generationId: 2,
      });
    } finally {
      generationGate.resolve();
      await settlePromises();
      await coordinator.requestEmergencyStop("sigint");
    }
  });

  it("removes the exact known lease after a rejected retained-generation CAS", async () => {
    const harness = createStartupHarness({ replaceRunLeaseFailure: true });
    const coordinator = await bootAndStartRuntimeHarness(harness);

    harness.destroySecondary();
    await settlePromises();
    await harness.timers.fireTimeout(1_000);
    await settlePromises();

    expect(harness.trace).toEqual(
      expect.arrayContaining([
        "replace-lease-generation:start",
        "replace-lease-generation:rejected",
        "close-window",
        "remove-lease",
        "bridge-close",
      ]),
    );
    expect(harness.activeResourceCounts()).toEqual({
      bridges: 0,
      children: 0,
      hwnds: 0,
      leases: 0,
    });
    expect(coordinator.diagnostics()).toMatchObject({
      state: "safe-ready",
      generationId: 2,
      reason: "secondary-recovery-failed",
    });

    expect(
      coordinator.handleRendererEvent({
        schema: 1,
        type: "operator-action",
        action: "restart-loop",
      }),
    ).toBe(true);
    await settlePromises();
    await coordinator.requestEmergencyStop("sigint");
  });

  it("settles the exact old session before publishing a non-overlapping full replacement", async () => {
    const harness = createStartupHarness();
    const coordinator = await bootAndStartRuntimeHarness(harness);
    const oldChild = harness.children[0]!;
    const oldLease = harness.leases[0]!.lease;

    harness.emitJanVimExit(0);
    await settlePromises();
    expect(coordinator.diagnostics()).toMatchObject({
      state: "black-recovering",
      generationId: 2,
    });
    await harness.timers.fireTimeout(1_000);
    await settlePromises();

    const newChild = harness.children[1]!;
    expect(newChild).not.toBe(oldChild);
    expect(newChild.pid).not.toBe(oldChild.pid);
    const removeOldLease = harness.trace.indexOf("remove-lease");
    const newBridgeListen = harness.trace.indexOf("bridge-listen:2:start");
    const newSpawn = harness.trace.indexOf("spawn-janvim", newBridgeListen);
    const newPlacement = harness.trace.indexOf("place-window", newSpawn);
    const newLease = harness.trace.indexOf("write-lease", newPlacement);
    const newPrepare = harness.trace.indexOf("agent:prepare", newLease);
    expect(removeOldLease).toBeGreaterThan(-1);
    expect(removeOldLease).toBeLessThan(newBridgeListen);
    expect(newBridgeListen).toBeLessThan(newSpawn);
    expect(newSpawn).toBeLessThan(newPlacement);
    expect(newPlacement).toBeLessThan(newLease);
    expect(newLease).toBeLessThan(newPrepare);
    expect(harness.leases[0]!.lease).toBe(oldLease);
    expect(harness.maxActiveResourceCounts()).toEqual({
      bridges: 1,
      children: 1,
      hwnds: 1,
      leases: 1,
    });
    expect(harness.activeResourceCounts()).toEqual({
      bridges: 1,
      children: 1,
      hwnds: 1,
      leases: 1,
    });
    expect(coordinator.diagnostics()).toMatchObject({
      state: "running",
      generationId: 2,
    });

    await coordinator.requestEmergencyStop("sigint");
  });

  it("routes an idle authenticated bridge disconnect into immediate session invalidation", async () => {
    const harness = createStartupHarness();
    const coordinator = harness.adapters.createCoordinator(showCommand("Show"));
    await expect(coordinator.boot()).resolves.toEqual({ ready: true });
    expect(harness.bridgeDisconnectListenerCount()).toBe(1);

    harness.emitAgentDisconnect();
    expect(coordinator.diagnostics()).toMatchObject({
      state: "black-recovering",
      generationId: 2,
      currentLoopId: null,
    });

    await coordinator.requestEmergencyStop("sigint");
    expect(harness.bridgeDisconnectListenerCount()).toBe(0);
  });

  it("does not launch a replacement when exact old-lease removal is unproven", async () => {
    const harness = createStartupHarness({ removeRunLeaseResult: false });
    const coordinator = await bootAndStartRuntimeHarness(harness);

    harness.emitJanVimExit(0);
    await settlePromises();

    expect(coordinator.diagnostics()).toMatchObject({
      state: "safe-ready",
      generationId: 2,
      reason: "recovery-old-session-unsettled",
    });
    expect(harness.trace.filter((entry) => entry === "bridge-listen")).toHaveLength(1);
    expect(harness.spawnInvocationCount()).toBe(1);
    expect(harness.activeResourceCounts()).toEqual({
      bridges: 0,
      children: 0,
      hwnds: 0,
      leases: 1,
    });

    await coordinator.requestEmergencyStop("sigint");
    expect(harness.activeResourceCounts().leases).toBe(1);
  });

  it.each([
    ["bridge listen", "bridge-listen", 1],
    ["artifact verification", "artifact-verification", 2],
    ["placement", "placement", 1],
    ["lease write", "lease-write", 1],
    ["prepare", "prepare", 1],
  ] as const)(
    "compensates a late %s publication after lifecycle abort",
    async (_label, name, invocation) => {
      const gate = publicationGate();
      const harness = createStartupHarness({
        deferredHostOperation: { name, invocation, gate },
      });
      const coordinator = harness.adapters.createCoordinator(showCommand("Show"));
      const boot = coordinator.boot();
      await settlePromises();
      expect(harness.hostOperationInvocationCount(name)).toBe(invocation);

      harness.enableFiveSecondTimeouts();
      const shutdown = coordinator.requestEmergencyStop("sigint");
      await expect(boot).resolves.toEqual({
        ready: false,
        reason: "controller-stopping",
      });
      await shutdown;
      const stopped = coordinator.diagnostics();

      gate.resolve();
      await settlePromises();

      expect(coordinator.diagnostics()).toEqual(stopped);
      expect(coordinator.diagnostics().state).toBe("stopped");
      expect(harness.activeResourceCounts()).toEqual({
        bridges: 0,
        children: 0,
        hwnds: 0,
        leases: 0,
      });
    },
  );

  it("writes strictly parseable Soak3 evidence with the three bounded P1 skips", async () => {
    const harness = createStartupHarness();
    const coordinator = harness.adapters.createCoordinator(showCommand("Soak3"));
    await expect(coordinator.boot()).resolves.toEqual({ ready: true });
    const listener = [...harness.ipcListeners.values()][0];
    listener!(
      {
        sender: harness.webContents,
        senderFrame: { url: harness.loadedUrl! },
      },
      { schema: 1, type: "operator-action", action: "start" },
    );
    await settlePromises();
    expect(coordinator.diagnostics().state).toBe("running");

    const cueDeltasMs = [5_001, 7_001, 33_001, 10_001, 23_001, 12_001];
    for (let loopNumber = 1; loopNumber <= 3; loopNumber += 1) {
      for (const [cueIndex, deltaMs] of cueDeltasMs.entries()) {
        harness.timers.advanceBy(deltaMs);
        try {
          await harness.timers.fireInterval(16);
        } catch (error) {
          throw new Error(
            `loop ${loopNumber} cue ${cueIndex + 1}: ${JSON.stringify(
              coordinator.diagnostics(),
            )}`,
            { cause: error },
          );
        }
        await settlePromises();
        if (
          coordinator.diagnostics().state !== "running" &&
          !(loopNumber === 3 && cueIndex === cueDeltasMs.length - 1)
        ) {
          throw new Error(
            `runtime stopped after loop ${loopNumber} cue ${cueIndex + 1}: ${[
              ...harness.logStorage.files.values(),
            ].join("\n")}`,
          );
        }
      }
    }

    const completion = await coordinator.completion;
    expect(harness.evidenceAttempts).toHaveLength(1);
    expect(() =>
      parseShowRunEvidence(harness.evidenceAttempts[0]!.value),
    ).not.toThrow();
    expect(
      completion,
      JSON.stringify({ diagnostics: coordinator.diagnostics(), trace: harness.trace }),
    ).toEqual({
      ok: true,
      reason: "soak-complete",
    });
    expect(harness.evidenceWrites).toHaveLength(1);
    const evidence = harness.evidenceWrites[0]!.value as ReturnType<
      typeof parseShowRunEvidence
    >;
    expect(evidence.schema).toBe(2);
    expect(evidence.loops).toHaveLength(3);
    expect(evidence.aggregate).toMatchObject({
      offlineSampleCount: 5,
      onlineSampleCount: 0,
      resourceIncompleteLoopCount: 0,
      runtimeCountGrowthLoopCount: 0,
    });
    expect(evidence.aggregate.totalSkips).toBe(3);
    expect(
      evidence.loops.reduce((total, loop) => total + loop.skipCount, 0),
    ).toBe(3);
    expect(evidence.offlineSnapshots).toHaveLength(5);
  });

  it("carries aged-out run-wide failures from CoordinatorDiagnostics into schema-2 acceptance", async () => {
    const harness = createStartupHarness();
    const coordinator = await bootAndStartRuntimeHarness(harness);
    const dependencies = (
      coordinator as unknown as { dependencies: ShowRunCoordinatorDependencies }
    ).dependencies;

    try {
      const cueDeltasMs = [5_001, 7_001, 33_001, 10_001, 23_001, 12_001];
      for (let loopNumber = 1; loopNumber <= 3; loopNumber += 1) {
        for (const deltaMs of cueDeltasMs) {
          harness.timers.advanceBy(deltaMs);
          await harness.timers.fireInterval(16);
          await settlePromises();
        }
        expect(coordinator.diagnostics().completedLoops).toBe(loopNumber);
      }

      const diagnostics = structuredClone(coordinator.diagnostics());
      const lastSnapshot = diagnostics.offlineSnapshots.at(-1)!;
      diagnostics.completedLoops = 8;
      diagnostics.aggregate.completedLoops = 8;
      diagnostics.aggregate.offlineSampleCount = 9;
      diagnostics.aggregate.onlineSampleCount = 1;
      diagnostics.aggregate.resourceIncompleteLoopCount = 1;
      diagnostics.aggregate.runtimeCountGrowthLoopCount = 1;
      diagnostics.offlineSnapshots = [
        ...diagnostics.offlineSnapshots,
        ...Array.from(
          { length: 8 - diagnostics.offlineSnapshots.length },
          (_, index) => ({
            ...lastSnapshot,
            sampledAtMs: lastSnapshot.sampledAtMs + index + 1,
          }),
        ),
      ];
      diagnostics.shutdown = {
        requestedReason: "operator-stop",
        failures: [],
        childSettled: true,
        leaseRemoved: true,
        forcedTermination: false,
      };

      await expect(
        dependencies.finalizeEvidence(
          { ok: true, reason: "operator-stop" },
          diagnostics,
          new AbortController().signal,
        ),
      ).resolves.toBe("fail");
      expect(harness.evidenceWrites).toHaveLength(1);
      const evidence = harness.evidenceWrites[0]!.value as ReturnType<
        typeof parseShowRunEvidence
      >;
      expect(evidence).toMatchObject({
        schema: 2,
        offlineVerified: false,
        aggregate: {
          offlineSampleCount: 9,
          onlineSampleCount: 1,
          resourceIncompleteLoopCount: 1,
          runtimeCountGrowthLoopCount: 1,
          acceptanceOutcome: "fail",
        },
      });
      expect(evidence.offlineSnapshots).toHaveLength(8);
      expect(
        evidence.offlineSnapshots.every((snapshot) => snapshot.offline),
      ).toBe(true);
    } finally {
      await coordinator.requestEmergencyStop("sigint");
      await coordinator.completion;
    }
  });

  it("keeps an early log failure sticky after the bridge token is installed", async () => {
    const harness = createStartupHarness({
      logStorage: new FailFirstLogStorage(),
    });
    const coordinator = harness.adapters.createCoordinator(showCommand("Show"));
    await expect(coordinator.boot()).resolves.toEqual({ ready: true });

    await coordinator.requestEmergencyStop("sigint");
    await coordinator.completion;

    expect(harness.evidenceWrites).toHaveLength(1);
    const evidence = harness.evidenceWrites[0]!.value as ReturnType<
      typeof parseShowRunEvidence
    >;
    expect(evidence.loggingIncomplete).toBe(true);
    expect(evidence.aggregate.acceptanceOutcome).toBe("fail");
  });

  it("accepts only exact local renderer IPC, samples the three OS PIDs, and redacts child streams", async () => {
    const harness = createStartupHarness();
    const coordinator = harness.adapters.createCoordinator(showCommand("Soak3"));
    await expect(coordinator.boot()).resolves.toEqual({ ready: true });
    const listener = [...harness.ipcListeners.values()][0];
    expect(listener).toBeTypeOf("function");

    listener!(
      {
        sender: { id: "replaced-renderer" },
        senderFrame: { url: harness.loadedUrl! },
      },
      { schema: 1, type: "operator-action", action: "start" },
    );
    listener!(
      {
        sender: harness.webContents,
        senderFrame: { url: harness.loadedUrl! },
      },
      { schema: 1, type: "operator-action", action: "start", extra: true },
    );
    listener!(
      {
        sender: harness.webContents,
        senderFrame: { url: "https://example.invalid/show" },
      },
      { schema: 1, type: "operator-action", action: "start" },
    );
    expect(coordinator.diagnostics().state).toBe("ready");
    expect(harness.sampledPids).toEqual([]);

    listener!(
      {
        sender: harness.webContents,
        senderFrame: { url: harness.loadedUrl! },
      },
      { schema: 1, type: "operator-action", action: "start" },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(coordinator.diagnostics().state).toBe("running");
    expect(harness.sampledPids.slice(0, 3)).toEqual([8001, 8002, 8003]);

    const token = "ab".repeat(24);
    harness.child.stdout!.write(Buffer.from(`stdout ${token}\n`, "utf8"));
    harness.child.stderr!.write(Buffer.from(`stderr ${token}\n`, "utf8"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    const logFiles = [...harness.logStorage.files.entries()];
    const stdout = logFiles
      .filter(([path]) => path.includes(".janvim-stdout"))
      .map(([, value]) => value)
      .join("");
    const stderr = logFiles
      .filter(([path]) => path.includes(".janvim-stderr"))
      .map(([, value]) => value)
      .join("");
    expect(stdout).toContain("stdout [REDACTED]");
    expect(stderr).toContain("stderr [REDACTED]");
    expect(`${stdout}${stderr}`).not.toContain(token);
    expect(logFiles.map(([path]) => path).join("\n")).not.toMatch(
      /generation|g1/i,
    );
    await coordinator.requestEmergencyStop("electron-quit");
    await coordinator.completion;
  });

  it("redacts bridge tokens split at every child stream chunk boundary", async () => {
    const harness = createStartupHarness();
    const coordinator = harness.adapters.createCoordinator(showCommand("Show"));
    await expect(coordinator.boot()).resolves.toEqual({ ready: true });
    const token = "ab".repeat(24);

    for (let split = 1; split < token.length; split += 1) {
      harness.child.stdout!.emit(
        "data",
        Buffer.from(`split-${split}:${token.slice(0, split)}`, "utf8"),
      );
      harness.child.stdout!.emit(
        "data",
        Buffer.from(`${token.slice(split)}\n`, "utf8"),
      );
    }

    await coordinator.requestEmergencyStop("electron-quit");
    await coordinator.completion;
    const stdout = [...harness.logStorage.files.entries()]
      .filter(([path]) => path.includes(".janvim-stdout"))
      .map(([, value]) => value)
      .join("");
    expect(stdout).not.toContain(token);
    expect(stdout.match(/\[REDACTED\]/g)).toHaveLength(token.length - 1);
  });

  it("redacts prohibited source and user-config paths across child stream chunks", async () => {
    const harness = createStartupHarness();
    const coordinator = harness.adapters.createCoordinator(showCommand("Show"));
    await expect(coordinator.boot()).resolves.toEqual({ ready: true });
    const prohibited = [
      "d:\\SHOW\\apps\\controller\\src\\main.ts",
      "D:\\github\\JanVim\\src\\lib.rs",
      "C:\\Users\\operator\\AppData\\Local\\nvim\\init.lua",
      "D:\\VirtualData\\TempCache\\janvim-root-export-quarantine-20260826-110433-6473a2d7ebbc4524b66c61c07e540504\\trace.log",
    ];

    for (const [index, value] of prohibited.entries()) {
      const split = Math.floor(value.length / 2);
      harness.child.stderr!.emit(
        "data",
        Buffer.from(`path-${index}:${value.slice(0, split)}`, "utf8"),
      );
      harness.child.stderr!.emit(
        "data",
        Buffer.from(`${value.slice(split)}\n`, "utf8"),
      );
    }

    await coordinator.requestEmergencyStop("electron-quit");
    await coordinator.completion;
    const stderr = [...harness.logStorage.files.entries()]
      .filter(([path]) => path.includes(".janvim-stderr"))
      .map(([, value]) => value)
      .join("");
    for (const value of prohibited) {
      expect(stderr.toLowerCase()).not.toContain(value.toLowerCase());
    }
    expect(stderr.match(/\[REDACTED\]/g)).toHaveLength(prohibited.length);
  });

  it.each([
    [
      "alive non-default",
      {
        AddressFamily: "IPv4",
        DestinationPrefix: "10.0.0.0/8",
        InterfaceAlias: "Ethernet",
        NextHop: "0.0.0.0",
        State: "Alive",
      },
      false,
    ],
    [
      "alive IPv4 default with a loopback-looking alias",
      {
        AddressFamily: "IPv4",
        DestinationPrefix: "0.0.0.0/0",
        InterfaceAlias: "Loopback Pseudo-Interface 1",
        NextHop: "10.0.0.1",
        State: "Alive",
      },
      true,
    ],
    [
      "alive IPv6 default with a localized alias",
      {
        AddressFamily: "IPv6",
        DestinationPrefix: "::/0",
        InterfaceAlias: "任意本地化名称",
        NextHop: "fe80::1",
        State: "Alive",
      },
      true,
    ],
    [
      "dead IPv4 default",
      {
        AddressFamily: "IPv4",
        DestinationPrefix: "0.0.0.0/0",
        InterfaceAlias: "Ethernet",
        NextHop: "10.0.0.1",
        State: "Dead",
      },
      false,
    ],
  ] as const)(
    "classifies the fake-exec %s route by exact prefix and state",
    async (_label, route, blocked) => {
      const harness = createValidationHarness({ routes: [route] });
      const validation = harness.adapters.validate(showCommand());

      if (blocked) {
        await expect(validation).rejects.toThrow(/offline|required|network/i);
      } else {
        await expect(validation).resolves.toBeUndefined();
      }
    },
  );

  it.each([
    ["IPv4 Subnet", "Subnet", "NoTraffic"],
    ["IPv4 LocalNetwork", "LocalNetwork", "NoTraffic"],
    ["IPv4 Internet", "Internet", "NoTraffic"],
    ["IPv6 Subnet", "NoTraffic", "Subnet"],
    ["IPv6 LocalNetwork", "NoTraffic", "LocalNetwork"],
    ["IPv6 Internet", "NoTraffic", "Internet"],
  ] as const)(
    "rejects a fake-exec profile with %s connectivity",
    async (_label, IPv4Connectivity, IPv6Connectivity) => {
      const harness = createValidationHarness({
        profiles: [
          {
            InterfaceAlias: "任意本地化名称",
            IPv4Connectivity,
            IPv6Connectivity,
          },
        ],
      });

      await expect(harness.adapters.validate(showCommand())).rejects.toThrow(
        /offline|required|network/i,
      );
    },
  );

  it.each([
    [
      "route",
      {
        routes: Array.from({ length: 1_025 }, () => ({
          AddressFamily: "IPv4" as const,
          DestinationPrefix: "0.0.0.0/0",
          InterfaceAlias: "Ethernet",
          NextHop: "10.0.0.1",
          State: "Alive" as const,
        })),
      },
    ],
    [
      "profile",
      {
        profiles: Array.from({ length: 257 }, () => ({
          InterfaceAlias: "Ethernet",
          IPv4Connectivity: "Internet" as const,
          IPv6Connectivity: "NoTraffic" as const,
        })),
      },
    ],
  ] as const)(
    "fails closed when the fake-exec %s snapshot exceeds its finite cap",
    async (_label, network) => {
      const harness = createValidationHarness(network);

      await expect(
        harness.adapters.validate({
          ...showCommand(),
          networkPolicy: "DiagnosticConnected",
        }),
      ).rejects.toThrow(/network.*snapshot/i);
    },
  );

  it("rejects online validation unless the explicit diagnostic policy is selected", async () => {
    const offlineRequired = createValidationHarness({
      routes: [
        {
          AddressFamily: "IPv4",
          DestinationPrefix: "0.0.0.0/0",
          InterfaceAlias: "Ethernet",
          NextHop: "10.0.0.1",
          State: "Alive",
        },
      ],
      profiles: [
        {
          InterfaceAlias: "Ethernet",
          IPv4Connectivity: "Internet",
          IPv6Connectivity: "NoTraffic",
        },
      ],
    });
    await expect(
      offlineRequired.adapters.validate(showCommand()),
    ).rejects.toThrow(/offline|required|network/i);

    const diagnostic = createValidationHarness({
      routes: [
        {
          AddressFamily: "IPv6",
          DestinationPrefix: "::/0",
          InterfaceAlias: "任意本地化名称",
          NextHop: "fe80::1",
          State: "Alive",
        },
      ],
      profiles: [
        {
          InterfaceAlias: "任意本地化名称",
          IPv4Connectivity: "NoTraffic",
          IPv6Connectivity: "Internet",
        },
      ],
    });
    await expect(
      diagnostic.adapters.validate({
        ...showCommand(),
        networkPolicy: "DiagnosticConnected",
      }),
    ).resolves.toBeUndefined();
  });

  it("keeps DiagnosticConnected evidence explicitly non-accepting", async () => {
    const harness = createStartupHarness();
    const coordinator = harness.adapters.createCoordinator({
      ...showCommand("Show"),
      networkPolicy: "DiagnosticConnected",
    });
    const dependencies = (
      coordinator as unknown as { dependencies: ShowRunCoordinatorDependencies }
    ).dependencies;
    await dependencies.validate();

    await expect(
      dependencies.finalizeEvidence(
        { ok: true, reason: "operator-stop" },
        coordinator.diagnostics(),
        new AbortController().signal,
      ),
    ).resolves.toBe("diagnostic");
    expect(harness.evidenceWrites).toHaveLength(1);
    expect(harness.evidenceWrites[0]).toMatchObject({
      value: {
        aggregate: { acceptanceOutcome: "diagnostic" },
      },
    });
  });

  it("rejects a changed local entry and non-loopback bridge before runtime I/O", () => {
    expect(() =>
      createValidationHarness({
        secondaryEntryUrl: "file:///D:/show/apps/secondary-screen/dist/other.html",
      }),
    ).toThrow(/entry|frozen|local/i);
    expect(() =>
      createValidationHarness({ bridgeHost: "0.0.0.0" }),
    ).toThrow(/loopback|bridge/i);
  });

  it("blocks every remote web path and binds each emergency source exactly once", async () => {
    const harness = createStartupHarness();
    const reasons: string[] = [];
    const dispose = harness.adapters.bindEmergencyLifecycle((reason) => {
      reasons.push(reason);
    });
    expect(harness.processListeners).toHaveLength(1);
    expect(harness.appListeners).toHaveLength(1);

    const coordinator = harness.adapters.createCoordinator(showCommand("Soak3"));
    await expect(coordinator.boot()).resolves.toEqual({ ready: true });
    expect(harness.requestFilter).toEqual({
      urls: [
        "http://*/*",
        "https://*/*",
        "ws://*/*",
        "wss://*/*",
      ],
    });
    for (const url of [
      "http://example.invalid/a",
      "https://example.invalid/a",
      "ws://example.invalid/a",
      "wss://example.invalid/a",
    ]) {
      expect(harness.dispatchRequest(url)).toEqual({ cancel: true });
      expect(harness.dispatchNavigation(url)).toBe(1);
      expect(harness.dispatchWindowOpen(url)).toEqual({ action: "deny" });
    }
    expect(harness.dispatchNavigation(harness.loadedUrl!)).toBe(0);

    harness.emitSigint();
    harness.emitWindowClose();
    expect(harness.emitElectronQuit()).toBe(1);
    expect(reasons).toEqual(["sigint", "window-close", "electron-quit"]);

    dispose();
    dispose();
    expect(harness.processListeners).toHaveLength(0);
    expect(harness.appListeners).toHaveLength(0);
    harness.emitSigint();
    harness.emitWindowClose();
    harness.emitElectronQuit();
    expect(reasons).toEqual(["sigint", "window-close", "electron-quit"]);
  });

  it("writes evidence and the terminal marker only after the exact bounded shutdown ladder", async () => {
    const harness = createStartupHarness();
    const coordinator = harness.adapters.createCoordinator(showCommand("Show"));
    await expect(coordinator.boot()).resolves.toEqual({ ready: true });

    await coordinator.requestEmergencyStop("sigint");
    await expect(coordinator.completion).resolves.toEqual({
      ok: false,
      reason: "emergency-sigint",
    });

    const ordered = [
      "agent:shutdown",
      "close-window",
      "remove-lease",
      "bridge-close",
      "network-snapshot",
      "write-evidence",
      "write-terminal",
    ];
    let prior = harness.trace.indexOf("agent:prepare");
    for (const event of ordered) {
      const index = harness.trace.indexOf(event, prior + 1);
      expect(index, `${event} missing from ${harness.trace.join(",")}`).toBeGreaterThan(
        prior,
      );
      prior = index;
    }
    expect(harness.evidenceAttempts).toHaveLength(1);
    expect(() =>
      parseShowRunEvidence(harness.evidenceAttempts[0]!.value),
    ).not.toThrow();
    expect(harness.evidenceWrites).toHaveLength(1);
    expect(harness.evidenceWrites[0]).toMatchObject({
      path: `${rehearsalRoot}\\show-run.json`,
      value: {
        schema: 2,
        runId: "show-001",
        controllerRunId: "controller-001",
        mode: "Show",
        physicalProjectorsTested: false,
        shutdown: {
          requestedBy: "sigint",
          agentShutdown: "acknowledged",
          hwndClose: "posted",
          janvimExit: "natural",
          bridgeClose: "closed",
          leaseRemoved: true,
        },
      },
    });
    expect(harness.terminalWrites).toEqual([
      {
        path: `${rehearsalRoot}\\controller-terminal.json`,
        value: {
          schema: 1,
          runId: "show-001",
          controllerRunId: "controller-001",
          controllerPid: 8001,
          outcome: "intentional-failure",
          reason: "emergency-sigint",
        },
      },
    ]);
    const serialized = JSON.stringify({
      evidence: harness.evidenceWrites,
      marker: harness.terminalWrites,
    });
    expect(serialized).not.toContain("ab".repeat(24));
    expect(serialized).not.toContain("C:\\Users\\operator");
  });

  it("forwards the bounded signal and prevents an aborted evidence publication", async () => {
    const gate = publicationGate();
    const committed: unknown[] = [];
    let observedSignal: AbortSignal | undefined;
    const harness = createStartupHarness({
      writeShowEvidence: async (_path, value, signal) => {
        observedSignal = signal;
        await gate.promise;
        signal?.throwIfAborted();
        committed.push(value);
      },
    });
    const coordinator = harness.adapters.createCoordinator(showCommand("Show"));
    await expect(coordinator.boot()).resolves.toEqual({ ready: true });

    void coordinator.requestEmergencyStop("sigint");
    await settlePromises();
    expect(harness.timers.activeTimeouts(10_000)).toBe(1);
    await harness.timers.fireTimeout(10_000);
    await expect(coordinator.completion).resolves.toEqual({
      ok: false,
      reason: "emergency-sigint",
    });
    expect(committed).toHaveLength(0);

    gate.resolve();
    await settlePromises();
    expect(committed).toHaveLength(0);
    expect(observedSignal).toBeDefined();
    expect(observedSignal!.aborted).toBe(true);
  });

  it("forwards the bounded signal and prevents an aborted marker publication", async () => {
    const gate = publicationGate();
    const committed: unknown[] = [];
    let observedSignal: AbortSignal | undefined;
    const harness = createStartupHarness({
      writeTerminalMarker: async (_path, value, signal) => {
        observedSignal = signal;
        await gate.promise;
        signal?.throwIfAborted();
        committed.push(value);
      },
    });
    const coordinator = harness.adapters.createCoordinator(showCommand("Show"));
    await expect(coordinator.boot()).resolves.toEqual({ ready: true });

    void coordinator.requestEmergencyStop("sigint");
    await settlePromises();
    expect(harness.timers.activeTimeouts(10_000)).toBe(1);
    await harness.timers.fireTimeout(10_000);
    await expect(coordinator.completion).resolves.toEqual({
      ok: false,
      reason: "emergency-sigint",
    });
    expect(committed).toHaveLength(0);

    gate.resolve();
    await settlePromises();
    expect(committed).toHaveLength(0);
    expect(observedSignal).toBeDefined();
    expect(observedSignal!.aborted).toBe(true);
  });

  it("keeps an early failed Soak3 out of acceptance evidence while marking terminal failure", async () => {
    const harness = createStartupHarness({ failAwaitAgent: true });
    const coordinator = harness.adapters.createCoordinator(showCommand("Soak3"));

    await expect(coordinator.boot()).resolves.toEqual({
      ready: false,
      reason: "startup-failed",
    });
    await coordinator.requestEmergencyStop("electron-quit");
    await expect(coordinator.completion).resolves.toEqual({
      ok: false,
      reason: "emergency-electron-quit",
    });

    expect(harness.evidenceAttempts).toHaveLength(0);
    expect(harness.evidenceWrites).toHaveLength(0);
    expect(harness.terminalWrites).toEqual([
      {
        path: `${rehearsalRoot}\\controller-terminal.json`,
        value: {
          schema: 1,
          runId: "show-001",
          controllerRunId: "controller-001",
          controllerPid: 8001,
          outcome: "intentional-failure",
          reason: "emergency-electron-quit",
        },
      },
    ]);
  });

  it("skips incomplete Soak3 evidence when artifact validation fails before inputs exist", async () => {
    const changedLock = Buffer.from(
      artifactLock
        .toString("utf8")
        .replace('"archiveBytes": 31345595', '"archiveBytes": 31345594'),
      "utf8",
    );
    const harness = createStartupHarness({ artifactLockBytes: changedLock });
    const coordinator = harness.adapters.createCoordinator(showCommand("Soak3"));

    await expect(coordinator.boot()).resolves.toEqual({
      ready: false,
      reason: "startup-failed",
    });
    await coordinator.requestEmergencyStop("electron-quit");
    await expect(coordinator.completion).resolves.toEqual({
      ok: false,
      reason: "emergency-electron-quit",
    });

    expect(harness.evidenceAttempts).toHaveLength(0);
    expect(harness.evidenceWrites).toHaveLength(0);
    expect(coordinator.diagnostics().shutdown.failures).not.toContain(
      "evidence-write-failed",
    );
  });

  it("refuses missing-stdio cleanup after the spawned PID identity changes", async () => {
    const harness = createStartupHarness({
      missingChildStream: "stdout",
      processStartTimes: [
        "2026-08-30T00:00:00.500Z",
        "2026-08-30T00:00:09.500Z",
      ],
      closeChildAfterSecondIdentityInspection: true,
    });
    const coordinator = harness.adapters.createCoordinator(showCommand("Show"));

    await expect(coordinator.boot()).resolves.toEqual({
      ready: false,
      reason: "startup-failed",
    });
    await coordinator.requestEmergencyStop("electron-quit");
    await coordinator.completion;

    expect(
      harness.trace.filter((event) => event === "inspect-janvim-start"),
    ).toHaveLength(2);
    expect(harness.child.kill).not.toHaveBeenCalled();
  });

  it("refuses abort cleanup when the spawned PID changes before initial inspection", async () => {
    const harness = createStartupHarness({
      deferLaunchArtifactVerification: true,
      processStartTimes: [
        "2026-08-30T00:00:00.500Z",
        "2026-08-30T00:00:09.500Z",
      ],
      closeChildAfterSecondIdentityInspection: true,
    });
    const coordinator = harness.adapters.createCoordinator(showCommand("Show"));
    const boot = coordinator.boot();
    await settlePromises();
    expect(harness.trace).toContain("launch-artifact-verification-deferred");

    const shutdown = coordinator.requestEmergencyStop("sigint");
    harness.releaseLaunchArtifactVerification();
    await boot;
    await shutdown;
    await coordinator.completion;

    expect(
      harness.trace.filter((event) => event === "inspect-janvim-start"),
    ).toHaveLength(2);
    expect(harness.child.kill).not.toHaveBeenCalled();
  });

  it("rechecks child identity when startup aborts after initial inspection", async () => {
    const harness = createStartupHarness({
      deferInitialIdentityInspection: true,
    });
    const coordinator = harness.adapters.createCoordinator(showCommand("Show"));
    const boot = coordinator.boot();
    await settlePromises();
    expect(harness.trace).toContain("inspect-janvim-start");

    const shutdown = coordinator.requestEmergencyStop("sigint");
    harness.releaseInitialIdentityInspection();
    await boot;
    await shutdown;
    await coordinator.completion;

    const inspections = harness.trace
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => event === "inspect-janvim-start");
    const termination = harness.trace.indexOf("kill-janvim");
    expect(inspections).toHaveLength(2);
    expect(termination).toBeGreaterThan(inspections[1]!.index);
  });

  it("refuses forced termination when the retained JanVim creation time no longer matches", async () => {
    const harness = createStartupHarness({
      closeChildOnWindowClose: false,
      processStartTimes: [
        "2026-08-30T00:00:00.500Z",
        "2026-08-30T00:00:09.500Z",
      ],
    });
    const coordinator = harness.adapters.createCoordinator(showCommand("Show"));
    await expect(coordinator.boot()).resolves.toEqual({ ready: true });
    harness.enableFiveSecondTimeouts();

    await coordinator.requestEmergencyStop("sigint");
    await coordinator.completion;

    expect(
      harness.trace.filter((event) => event === "inspect-janvim-start"),
    ).toHaveLength(2);
    expect(harness.child.kill).not.toHaveBeenCalled();
    expect(harness.evidenceWrites[0]).toMatchObject({
      value: {
        shutdown: {
          janvimExit: "unsettled",
          leaseRemoved: false,
        },
      },
    });
  });
});
