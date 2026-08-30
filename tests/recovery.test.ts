import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join, win32 } from "node:path";
import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import type {
  AgentAck,
  AgentCommand,
  RendererToControllerEvent,
  RunCueEvent,
  RunStatusEvent,
} from "@janvim-exhibition/show-schema";
import {
  DEFAULT_LOG_FILE_BYTES,
  DEFAULT_LOG_TOTAL_BYTES,
  RunLogBudget,
  type LogStorage,
  type RunLogStream,
} from "../apps/controller/src/bounded-log.ts";
import { MultiLoopDriver } from "../apps/controller/src/multi-loop-driver.ts";
import type {
  OneLoopRuntime,
  OneLoopTimerAdapter,
  OneLoopTimerHandle,
} from "../apps/controller/src/one-loop-driver.ts";
import { ResourceSampler } from "../apps/controller/src/resource-sampler.ts";
import { RunTelemetry } from "../apps/controller/src/run-telemetry.ts";
import type { RunLease } from "../apps/controller/src/run-lease.ts";
import {
  parseShowCommand,
  type ShowCommand,
} from "../apps/controller/src/show-command.ts";
import {
  ShowRunCoordinator,
  type PrimaryCueCompletionEvent,
  type ShowRunCoordinatorDependencies,
  type ShowRunSession,
  type ShowSecondarySurface,
} from "../apps/controller/src/show-run-coordinator.ts";
import { parseShowRunEvidence } from "../apps/controller/src/show-run-evidence.ts";
import {
  createShowRuntimeAdapters,
  type ShowRuntimeAdapterHost,
} from "../apps/controller/src/show-runtime-adapters.ts";

const repositoryRoot = process.cwd();
const runbookPath = join(repositoryRoot, "docs", "operations", "rehearsal-runbook.md");
const incidentTemplatePath = join(
  repositoryRoot,
  "docs",
  "operations",
  "incident-log-template.md",
);
const originalPoemSha256 = "a".repeat(64);
const fixturePoemSha256 =
  "b699de273f5bbaedb08241495f52ce863d3e8e1851275ce3b6251484d75190a8";
const composedRepositoryRoot = "D:\\show";
const composedRehearsalRoot =
  "D:\\VirtualData\\JanVim-Exhibition-Rehearsals\\recovery-composed";
const composedDisplayMapPath = `${composedRehearsalRoot}\\display-map.json`;
const fixtureArtifactLock = readFileSync(
  join(repositoryRoot, "janvim-artifact.lock.json"),
);
const fixtureShowConfig = readFileSync(
  join(repositoryRoot, "show", "janvim-show.toml"),
);
const fixtureManifest = readFileSync(
  join(repositoryRoot, "content", "fixture", "show.manifest.json"),
);
const fixturePoem = readFileSync(
  join(repositoryRoot, "content", "fixture", "poem.txt"),
);
const fixturePluginInit = readFileSync(
  join(
    repositoryRoot,
    "runtime",
    "user-root",
    "plugin-lab",
    "config",
    "init.lua",
  ),
);

async function settle(): Promise<void> {
  for (let index = 0; index < 64; index += 1) await Promise.resolve();
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  return { promise: new Promise<void>((settlePromise) => { resolve = settlePromise; }), resolve };
}

type Scheduled = { id: number; delayMs: number; callback: () => unknown };

class FakeClock implements OneLoopTimerAdapter {
  public now = 0;
  private nextId = 1;
  private readonly intervals = new Map<number, Scheduled>();
  private readonly timeouts = new Map<number, Scheduled>();

  public nowMonotonic(): number {
    return this.now;
  }

  public advanceBy(delayMs: number): void {
    this.now += delayMs;
  }

  public setInterval(callback: () => void, delayMs: number): number {
    const entry = { id: this.nextId++, delayMs, callback };
    this.intervals.set(entry.id, entry);
    return entry.id;
  }

  public clearInterval(id: OneLoopTimerHandle): void {
    if (typeof id === "number") this.intervals.delete(id);
  }

  public setTimeout(callback: () => void, delayMs: number): number {
    const entry = { id: this.nextId++, delayMs, callback };
    this.timeouts.set(entry.id, entry);
    return entry.id;
  }

  public clearTimeout(id: OneLoopTimerHandle): void {
    if (typeof id === "number") this.timeouts.delete(id);
  }

  public async fireTimeout(delayMs: number): Promise<void> {
    const entry = [...this.timeouts.values()].find((candidate) => candidate.delayMs === delayMs);
    if (entry === undefined) throw new Error(`timeout ${delayMs} was not scheduled`);
    this.timeouts.delete(entry.id);
    await entry.callback();
  }

  public async fireInterval(delayMs: number): Promise<void> {
    const entry = [...this.intervals.values()].find((candidate) => candidate.delayMs === delayMs);
    if (entry === undefined) throw new Error(`interval ${delayMs} was not scheduled`);
    await entry.callback();
  }

  public active(delayMs?: number): number {
    return [...this.intervals.values(), ...this.timeouts.values()].filter(
      (entry) => delayMs === undefined || entry.delayMs === delayMs,
    ).length;
  }
}

class MemorySurface implements ShowSecondarySurface {
  public readonly rendererPid = 2026;
  public readonly sent: Array<RunCueEvent | RunStatusEvent> = [];
  private readonly events = new Set<(event: RendererToControllerEvent) => void>();
  private readonly destroyed = new Set<() => void>();

  public send(event: RunCueEvent | RunStatusEvent): void {
    this.sent.push(event);
  }

  public onEvent(listener: (event: RendererToControllerEvent) => void): () => void {
    this.events.add(listener);
    return () => this.events.delete(listener);
  }

  public onDestroyed(listener: () => void): () => void {
    this.destroyed.add(listener);
    return () => this.destroyed.delete(listener);
  }

  public emit(event: RendererToControllerEvent): void {
    for (const listener of [...this.events]) listener(event);
  }

  public destroy(): void {
    for (const listener of [...this.destroyed]) listener();
  }

  public close(): void {}

  public diagnostics(): { listeners: number } {
    return { listeners: this.events.size + this.destroyed.size };
  }
}

async function waitForAbort(operation: Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new Error("operation aborted");
  await new Promise<void>((resolve, reject) => {
    const abort = (): void => reject(new Error("operation aborted"));
    signal.addEventListener("abort", abort, { once: true });
    void operation.then(
      () => {
        signal.removeEventListener("abort", abort);
        resolve();
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

class MemorySession implements ShowRunSession {
  public readonly sessionId: string;
  public readonly runtime: OneLoopRuntime = {
    state: "ready",
    completedLoops: 0,
    start: () => {
      this.runtime.state = "running";
      return true;
    },
    advance: async () => 0,
    stop: () => {
      this.runtime.state = "stopped";
    },
  };
  public editorCommandPending = false;
  public loopSurface: MemorySurface | undefined;
  public reserveNextLoopId: (() => string) | undefined;
  public resetCalls = 0;
  public leaseRemoved = false;
  public readonly shutdownCalls: string[] = [];
  private generationId: number;
  private readonly faults = new Set<
    (fault: "agent-disconnected" | "critical-ack-failed" | "janvim-exited") => void
  >();
  private readonly primary = new Set<(event: PrimaryCueCompletionEvent) => void>();

  public constructor(
    generationId: number,
    private readonly recoveryGate: Promise<void> | undefined,
    private readonly shutdownGate: Promise<void> | undefined,
    private readonly shutdownFailures: ReadonlySet<string>,
  ) {
    this.generationId = generationId;
    this.sessionId = `session-${generationId}`;
  }

  public currentGenerationId(): number {
    return this.generationId;
  }

  public rebindGeneration(generationId: number): void {
    this.generationId = generationId;
  }

  public async startBridge(signal: AbortSignal): Promise<void> {
    if (this.generationId > 1 && this.recoveryGate !== undefined) {
      await waitForAbort(this.recoveryGate, signal);
    }
  }

  public async launchJanVim(_signal: AbortSignal): Promise<void> {}
  public async placeJanVim(_signal: AbortSignal): Promise<void> {}
  public async awaitAgent(_signal: AbortSignal): Promise<void> {}

  public async prepareOriginalPoem(_signal: AbortSignal): Promise<{ bufferSha256: string }> {
    return { bufferSha256: originalPoemSha256 };
  }

  public createLoop(
    _loopId: string,
    surface: ShowSecondarySurface,
    reserveNextLoopId: () => string,
  ): OneLoopRuntime {
    this.loopSurface = surface as MemorySurface;
    this.reserveNextLoopId = reserveNextLoopId;
    return this.runtime;
  }

  public onFault(
    listener: (fault: "agent-disconnected" | "critical-ack-failed" | "janvim-exited") => void,
  ): () => void {
    this.faults.add(listener);
    return () => this.faults.delete(listener);
  }

  public onPrimaryCompletion(listener: (event: PrimaryCueCompletionEvent) => void): () => void {
    this.primary.add(listener);
    return () => this.primary.delete(listener);
  }

  public emitFault(fault: "agent-disconnected" | "critical-ack-failed" | "janvim-exited"): void {
    for (const listener of [...this.faults]) listener(fault);
  }

  public emitPrimary(event: PrimaryCueCompletionEvent): void {
    for (const listener of [...this.primary]) listener(event);
  }

  public diagnostics() {
    return {
      connections: 1,
      pendingCommands: Number(this.editorCommandPending),
      editorCommandPending: this.editorCommandPending,
      leaseRemoved: this.leaseRemoved,
    };
  }

  public async resetToOriginal(_loopId: string, _signal: AbortSignal): Promise<{ bufferSha256: string }> {
    this.resetCalls += 1;
    return { bufferSha256: originalPoemSha256 };
  }

  public async sendAgentShutdown(_timeoutMs = 2_000, _retryLimit = 1): Promise<void> {
    this.shutdownCalls.push("agent-shutdown");
    if (this.shutdownGate !== undefined) await this.shutdownGate;
    if (this.shutdownFailures.has("agent-shutdown")) throw new Error("timeout");
  }
  public async closePlacedWindow(_timeoutMs = 2_000, _maxOutputBytes = 4_096): Promise<void> {
    this.shutdownCalls.push("close-window");
    if (this.shutdownFailures.has("close-window")) throw new Error("timeout");
  }
  public async waitForJanVimExit(_timeoutMs = 5_000): Promise<"natural" | "still-running"> {
    this.shutdownCalls.push("wait-janvim");
    if (this.shutdownFailures.has("wait-janvim")) throw new Error("timeout");
    if (
      this.shutdownFailures.has("terminate-exact") ||
      this.shutdownFailures.has("wait-forced")
    ) {
      return "still-running";
    }
    this.leaseRemoved = true;
    return "natural";
  }
  public async terminateExactJanVim(): Promise<void> {
    this.shutdownCalls.push("terminate-exact");
    if (this.shutdownFailures.has("terminate-exact")) throw new Error("timeout");
  }
  public async waitForForcedExit(_timeoutMs = 5_000): Promise<boolean> {
    this.shutdownCalls.push("wait-forced");
    if (this.shutdownFailures.has("wait-forced")) throw new Error("timeout");
    this.leaseRemoved = true;
    return true;
  }
  public async closeBridge(_timeoutMs = 5_000): Promise<void> {
    this.shutdownCalls.push("close-bridge");
    if (this.shutdownFailures.has("close-bridge")) throw new Error("timeout");
  }
  public dispose(): void {
    this.faults.clear();
    this.primary.clear();
  }
}

function createHost(options: {
  mode?: "Soak3" | "Show";
  recoveryGate?: Promise<void>;
  shutdownGate?: Promise<void>;
  shutdownFailures?: ReadonlySet<string>;
} = {}) {
  const clock = new FakeClock();
  const surfaces: MemorySurface[] = [];
  const sessions: MemorySession[] = [];
  const evidence: ReturnType<ShowRunCoordinator["diagnostics"]>[] = [];
  const logs: Record<string, unknown>[] = [];
  let terminalWrites = 0;
  const command = parseShowCommand(
    [
      `--show-mode=${(options.mode ?? "Soak3").toLowerCase()}`,
      "--rehearsal-root=D:\\VirtualData\\JanVim-Exhibition-Rehearsals\\recovery-001",
      "--display-map=D:\\VirtualData\\JanVim-Exhibition-Rehearsals\\recovery-001\\display-map.json",
      "--run-id=recovery-001",
      "--controller-run-id=recovery-controller-001",
      "--network-policy=offline-required",
    ],
    "D:\\show",
  );
  const dependencies: ShowRunCoordinatorDependencies = {
    mode: command.mode === "Soak3" ? "Soak3" : "Show",
    originalPoemSha256,
    validate: async () => undefined,
    openSecondary: async () => {
      const surface = new MemorySurface();
      surfaces.push(surface);
      return surface;
    },
    createSession: (generationId) => {
      const session = new MemorySession(
        generationId,
        options.recoveryGate,
        options.shutdownGate,
        options.shutdownFailures ?? new Set(),
      );
      sessions.push(session);
      return session;
    },
    createDriver: (driverOptions) => new MultiLoopDriver(driverOptions),
    timers: clock,
    createTelemetry: () => new RunTelemetry(),
    createResourceSampler: () => {
      const sampler = new ResourceSampler({
        adapter: { sample: async (pid) => ({ rssBytes: pid * 1_000, handleCount: pid }) },
        timers: clock,
      });
      sampler.start({ controller: 11, renderer: 22, janvim: 33 });
      return sampler;
    },
    sampleNetwork: async () => ({
      sampledAtMs: clock.now,
      activeExternalDefaultRoutes: 0,
      connectedExternalProfiles: 0,
      offline: true,
    }),
    finalizeEvidence: async (_result, diagnostics) => {
      evidence.push(diagnostics);
    },
    writeTerminalMarker: async () => {
      terminalWrites += 1;
    },
    flushLogs: async () => undefined,
    nextLoopId: (generationId, loopNumber) => `g${generationId}-loop-${loopNumber}`,
    nowMs: () => clock.nowMonotonic(),
    log: (event) => logs.push(event),
  };
  return {
    clock,
    coordinator: new ShowRunCoordinator(dependencies),
    evidence,
    logs,
    sessions,
    surfaces,
    get terminalWrites() {
      return terminalWrites;
    },
  };
}

async function bootAndStart(host: ReturnType<typeof createHost>): Promise<void> {
  await expect(host.coordinator.boot()).resolves.toEqual({ ready: true });
  expect(host.coordinator.handleRendererEvent({ schema: 1, type: "operator-action", action: "start" })).toBe(true);
}

const confirmedDisplayMap = {
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

const composedDisplays = [
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

type ExternalProtocol = "dns" | "http" | "https" | "ws" | "wss";
type NetworkBoundaryEvent = {
  kind: "exec-file" | "load-url" | "spawn" | "web-request";
  value: string;
};

function createComposedHost(options: {
  resetPrimaryDelaysMs?: readonly number[];
} = {}) {
  const clock = new FakeClock();
  const logStorage = new MemoryLogStorage();
  const trace: string[] = [];
  const sent: Array<{ channel: string; payload: unknown }> = [];
  const rendererEvents: RendererToControllerEvent[] = [];
  const agentCommands: AgentCommand[] = [];
  const evidenceAttempts: unknown[] = [];
  const evidenceValues: ReturnType<typeof parseShowRunEvidence>[] = [];
  const terminalValues: unknown[] = [];
  const leases: RunLease[] = [];
  const networkAttempts: ExternalProtocol[] = [];
  const networkBoundaryEvents: NetworkBoundaryEvent[] = [];
  const ipcListeners = new Map<
    string,
    (event: { senderFrame: { url: string } | null }, payload: unknown) => void
  >();
  const processListeners = new Set<() => void>();
  const appListeners = new Set<(event: { preventDefault(): void }) => void>();
  let loadedUrl: string | undefined;
  let currentWindow: ComposedBrowserWindow | undefined;
  let beforeRequest:
    | ((
        details: { url: string },
        callback: (result: { cancel: boolean }) => void,
      ) => void)
    | undefined;
  let runtimeNetworkBoundaryStart = 0;
  let resetIndex = 0;

  const recordPotentialAttempt = (
    kind: NetworkBoundaryEvent["kind"],
    value: string,
  ): void => {
    networkBoundaryEvents.push({ kind, value });
    for (const protocol of ["http", "https", "ws", "wss"] as const) {
      if (value.toLowerCase().includes(`${protocol}://`)) {
        networkAttempts.push(protocol);
      }
    }
    if (/\bdns(?:\.|:|\/)/iu.test(value)) networkAttempts.push("dns");
  };

  const routeRendererEvent = (payload: RendererToControllerEvent): void => {
    const listener = [...ipcListeners.values()][0];
    if (listener === undefined || loadedUrl === undefined) {
      throw new Error("composed renderer is not bound");
    }
    rendererEvents.push(structuredClone(payload));
    listener({ senderFrame: { url: loadedUrl } }, payload);
  };

  class ComposedWebContents extends EventEmitter {
    public readonly session = {
      webRequest: {
        onBeforeRequest: (
          _filter: { urls: string[] } | null,
          _listener?: (
            details: { url: string },
            callback: (result: { cancel: boolean }) => void,
          ) => void,
        ) => {
          if (_filter === null) {
            beforeRequest = undefined;
            return;
          }
          beforeRequest = (details, callback) => {
            recordPotentialAttempt("web-request", details.url);
            _listener?.(details, callback);
          };
        },
      },
    };

    public send(channel: string, payload: unknown): void {
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
        routeRendererEvent({
          schema: 1,
          type: "presentation-ack",
          generationId: payload.generationId,
          loopId: payload.loopId,
          cueId: payload.cue.id,
        });
      }
    }

    public setWindowOpenHandler(
      _handler: (details: { url: string }) => { action: "deny" },
    ): void {}

    public getOSProcessId(): number {
      return 8_002;
    }
  }

  class ComposedBrowserWindow extends EventEmitter {
    public readonly webContents = new ComposedWebContents();
    private destroyed = false;

    public constructor(_options: Record<string, unknown>) {
      super();
      currentWindow = this;
      trace.push("browser-window");
    }

    public async loadURL(url: string): Promise<void> {
      recordPotentialAttempt("load-url", url);
      loadedUrl = url;
      trace.push("load-secondary");
    }

    public close(): void {
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
  }

  const child = new (class extends EventEmitter {
    public readonly pid = 8_003;
    public readonly stdout = new PassThrough();
    public readonly stderr = new PassThrough();
    public kill(): boolean {
      queueMicrotask(() => this.emit("close", 1));
      return true;
    }
  })();

  const files = new Map<string, Buffer>([
    [win32.join(composedRepositoryRoot, "janvim-artifact.lock.json"), fixtureArtifactLock],
    [win32.join(composedRepositoryRoot, "show", "janvim-show.toml"), fixtureShowConfig],
    [
      win32.join(composedRepositoryRoot, "content", "fixture", "show.manifest.json"),
      fixtureManifest,
    ],
    [win32.join(composedRepositoryRoot, "content", "fixture", "poem.txt"), fixturePoem],
    [
      win32.join(
        composedRepositoryRoot,
        "runtime",
        "user-root",
        "plugin-lab",
        "config",
        "init.lua",
      ),
      fixturePluginInit,
    ],
    [
      composedDisplayMapPath,
      Buffer.from(`${JSON.stringify(confirmedDisplayMap)}\n`, "utf8"),
    ],
  ]);
  const valueAfter = (args: readonly string[], flag: string): number => {
    const index = args.indexOf(flag);
    return Number(args[index + 1]);
  };

  const host = {
    repositoryRoot: composedRepositoryRoot,
    BrowserWindow: ComposedBrowserWindow,
    ipcMain: {
      on: (
        channel: string,
        listener: (
          event: { senderFrame: { url: string } | null },
          payload: unknown,
        ) => void,
      ) => ipcListeners.set(channel, listener),
      removeListener: (channel: string) => ipcListeners.delete(channel),
    },
    screen: { getAllDisplays: () => composedDisplays },
    controllerProcess: {
      pid: 8_001,
      startedAtUtc: "2026-08-30T00:00:00.000Z",
      on: (_event: "SIGINT", listener: () => void) => processListeners.add(listener),
      removeListener: (_event: "SIGINT", listener: () => void) =>
        processListeners.delete(listener),
    },
    electronApp: {
      on: (
        _event: "before-quit",
        listener: (event: { preventDefault(): void }) => void,
      ) => appListeners.add(listener),
      removeListener: (
        _event: "before-quit",
        listener: (event: { preventDefault(): void }) => void,
      ) => appListeners.delete(listener),
    },
    baseEnvironment: { PATH: "C:\\Windows\\System32" },
    readFile: (path: string) => {
      const value = files.get(win32.resolve(path));
      if (value === undefined) throw new Error(`missing composed file: ${path}`);
      return Buffer.from(value);
    },
    realpath: (path: string) => win32.resolve(path),
    execFile: async (
      file: string,
      args: readonly string[],
      _limits: { timeoutMs: number; maxStdoutBytes: number; maxStderrBytes: number },
    ) => {
      expect(file).toBe("pwsh");
      recordPotentialAttempt("exec-file", args.join(" "));
      if (args.some((argument) => argument.endsWith("verify-runtime.ps1"))) {
        trace.push("verify-runtime");
        return { exitCode: 0, stdout: "verified\n", stderr: "" };
      }
      if (args.some((argument) => argument.includes("Get-NetRoute"))) {
        trace.push("network-snapshot");
        clock.advanceBy(1);
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
        const requested = {
          x: valueAfter(args, "-X"),
          y: valueAfter(args, "-Y"),
          width: valueAfter(args, "-Width"),
          height: valueAfter(args, "-Height"),
        };
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            schema: 1,
            pid: valueAfter(args, "-ChildProcessId"),
            matchedWindowCount: 1,
            hwnd: "0x0000000000001F43",
            visible: true,
            owned: false,
            requested,
            actual: requested,
          }),
          stderr: "",
        };
      }
      if (args.some((argument) => argument.endsWith("close-janvim-window.ps1"))) {
        queueMicrotask(() => child.emit("close", 0));
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            schema: 1,
            pid: valueAfter(args, "-ChildProcessId"),
            hwnd: args[args.indexOf("-Hwnd") + 1],
            ownershipVerified: true,
            topLevel: true,
            closePosted: true,
          }),
          stderr: "",
        };
      }
      throw new Error(`unexpected composed command: ${args.join(" ")}`);
    },
    verifyArtifact: async () => ({ ok: true as const }),
    spawn: (
      file: string,
      args: readonly string[],
      spawnOptions: { env: NodeJS.ProcessEnv },
    ) => {
      recordPotentialAttempt(
        "spawn",
        `${file} ${args.join(" ")} ${JSON.stringify(spawnOptions.env)}`,
      );
      return child;
    },
    inspectProcessStartedAtUtc: async () => "2026-08-30T00:00:00.500Z",
    randomBytes: () => Buffer.from("ab".repeat(24), "hex"),
    createBridge: (token: string) => ({
      listen: async () => {
        return { host: "127.0.0.1" as const, port: 32_123, family: "IPv4" };
      },
      waitForAgent: async () => undefined,
      dispatch: async (command: AgentCommand): Promise<AgentAck> => {
        agentCommands.push(structuredClone(command));
        if (command.action.type === "reset") {
          clock.advanceBy(options.resetPrimaryDelaysMs?.[resetIndex] ?? 0);
          resetIndex += 1;
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
              : fixturePoemSha256,
        };
      },
      close: async () => undefined,
      diagnostics: () => ({
        activeConnections: 1,
        authenticatedConnections: 1,
        pendingCommands: 0,
        pendingTimers: 0,
        sessionListeners: 3,
        readyWaiters: 0,
      }),
    }),
    runWithDeadline: async <T>(_timeoutMs: number, operation: () => Promise<T>) =>
      operation(),
    logStorage,
    nowMonotonic: () => clock.nowMonotonic(),
    timers: clock,
    nowUtc: () => "2026-08-30T00:00:01.000Z",
    sampleProcess: async (pid: number) => ({ rssBytes: pid * 10, handleCount: pid }),
    writeRunLease: async (_path: string, lease: RunLease) => {
      leases.push(lease);
    },
    replaceRunLease: async (
      _path: string,
      lease: RunLease,
      generationId: number,
    ) => ({ ...lease, generationId }),
    removeRunLease: async () => true,
    writeShowEvidence: async (_path: string, value: unknown) => {
      evidenceAttempts.push(structuredClone(value));
      evidenceValues.push(parseShowRunEvidence(value));
    },
    writeTerminalMarker: async (_path: string, value: unknown) => {
      terminalValues.push(structuredClone(value));
    },
  } as unknown as ShowRuntimeAdapterHost;

  const adapters = createShowRuntimeAdapters(host);
  return {
    adapters,
    clock,
    logStorage,
    trace,
    sent,
    rendererEvents,
    agentCommands,
    evidenceAttempts,
    evidenceValues,
    terminalValues,
    leases,
    networkAttempts,
    get runtimeNetworkBoundaryEvents() {
      return networkBoundaryEvents.slice(runtimeNetworkBoundaryStart);
    },
    ipcListeners,
    get loadedUrl() {
      return loadedUrl;
    },
    probeRemoteRequest: (url: string) => {
      let result: { cancel: boolean } | undefined;
      beforeRequest?.({ url }, (value) => {
        result = value;
      });
      return result;
    },
    clearNetworkAttempts: () => networkAttempts.splice(0),
    beginRuntimeNetworkObservation: () => {
      runtimeNetworkBoundaryStart = networkBoundaryEvents.length;
    },
    emitRenderer: routeRendererEvent,
    destroySecondary: () => currentWindow?.destroy(),
  };
}

function composedCommand(mode: "Soak3" | "Show"): ShowCommand & { mode: typeof mode } {
  const command = parseShowCommand(
    [
      `--show-mode=${mode.toLowerCase()}`,
      `--rehearsal-root=${composedRehearsalRoot}`,
      `--display-map=${composedDisplayMapPath}`,
      "--run-id=recovery-composed",
      "--controller-run-id=recovery-composed-controller",
      "--network-policy=offline-required",
    ],
    composedRepositoryRoot,
  );
  if (command.mode !== mode) throw new Error("strict command mode mismatch");
  return command as ShowCommand & { mode: typeof mode };
}

const cueDeltasMs = [5_001, 7_001, 33_001, 10_001, 23_001, 12_001] as const;
const forbiddenNetworkProbeUrls = [
  "http://attempt-recorder.invalid/probe",
  "https://dns.attempt-recorder.invalid/probe",
  "ws://attempt-recorder.invalid/probe",
  "wss://attempt-recorder.invalid/probe",
] as const;

function expectNoExternalNetworkAttempts(
  host: ReturnType<typeof createComposedHost>,
): void {
  expect(host.networkAttempts).toEqual([]);
}

function probeCancelledForbiddenNetworkAttempts(
  host: ReturnType<typeof createComposedHost>,
): void {
  for (const url of forbiddenNetworkProbeUrls) {
    expect(host.probeRemoteRequest(url), url).toEqual({ cancel: true });
  }
}

async function startComposedRun(
  host: ReturnType<typeof createComposedHost>,
  mode: "Soak3" | "Show",
) {
  const coordinator = host.adapters.createCoordinator(composedCommand(mode));
  await expect(coordinator.boot()).resolves.toEqual({ ready: true });
  expectNoExternalNetworkAttempts(host);
  probeCancelledForbiddenNetworkAttempts(host);
  expect(host.networkAttempts).toEqual(["http", "https", "dns", "ws", "wss"]);
  host.clearNetworkAttempts();
  host.beginRuntimeNetworkObservation();
  host.emitRenderer({ schema: 1, type: "operator-action", action: "start" });
  await settle();
  expect(coordinator.diagnostics().state).toBe("running");
  return coordinator;
}

async function advanceComposedLoop(
  host: ReturnType<typeof createComposedHost>,
  queueStopBeforeReset = false,
): Promise<void> {
  for (const [index, deltaMs] of cueDeltasMs.entries()) {
    if (queueStopBeforeReset && index === cueDeltasMs.length - 1) {
      host.emitRenderer({ schema: 1, type: "operator-action", action: "stop-show" });
    }
    host.clock.advanceBy(deltaMs);
    await host.clock.fireInterval(16);
    await settle();
  }
}

function controllerLogEvents(storage: MemoryLogStorage): Record<string, unknown>[] {
  return [...storage.files.entries()]
    .filter(([path]) => path.includes(".controller"))
    .flatMap(([, contents]) => contents.trim().split("\n"))
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function markdownSections(markdown: string): Map<string, string> {
  const matches = [...markdown.matchAll(/^## (.+)$/gmu)];
  return new Map(
    matches.map((match, index) => {
      const start = match.index! + match[0].length;
      const end = matches[index + 1]?.index ?? markdown.length;
      return [match[1]!, markdown.slice(start, end).trim()];
    }),
  );
}

function markdownCells(row: string): string[] {
  return row
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function rawMetricArrayPaths(value: unknown, path = "root"): string[] {
  if (Array.isArray(value)) {
    const result = /(?:raw|rss|ack)/iu.test(path) ? [path] : [];
    return result.concat(
      value.flatMap((item, index) => rawMetricArrayPaths(item, `${path}[${index}]`)),
    );
  }
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) =>
    rawMetricArrayPaths(item, `${path}.${key}`),
  );
}

function assertDefaultLogBudgetBounds(storage: MemoryLogStorage): void {
  expect(DEFAULT_LOG_FILE_BYTES).toBe(8 * 1024 * 1024);
  expect(DEFAULT_LOG_TOTAL_BYTES).toBe(32 * 1024 * 1024);
  const budget = new RunLogBudget({
    storage,
    basePath: "D:\\logs\\bounded-show.log",
    secrets: [],
  });
  const chunk = "x".repeat(4 * 1024 * 1024);
  const streams: RunLogStream[] = [
    "controller",
    "recovery",
    "janvim-stdout",
    "janvim-stderr",
  ];
  for (let index = 0; index < 12; index += 1) {
    expect(budget.write(streams[index % streams.length]!, chunk)).toBe(true);
  }
  const sizes = [...storage.files.keys()].map((path) => storage.size(path));
  expect(Math.max(...sizes)).toBeLessThanOrEqual(DEFAULT_LOG_FILE_BYTES);
  expect(sizes.reduce((total, bytes) => total + bytes, 0)).toBeLessThanOrEqual(
    DEFAULT_LOG_TOTAL_BYTES,
  );
  expect([...storage.files.keys()].some((path) => /\.1$/u.test(path))).toBe(true);
  expect(storage.files.size).toBeLessThanOrEqual(16);
  expect(budget.snapshot()).toEqual({
    totalBytes: sizes.reduce((total, bytes) => total + bytes, 0),
    fileCount: storage.files.size,
    incomplete: false,
  });
}

function assertRuntimeLogBounds(storage: MemoryLogStorage): void {
  const entries = [...storage.files.entries()];
  expect(entries.length).toBeGreaterThan(0);
  for (const [path] of entries) {
    expect(path).toMatch(
      /show-run\.log\.(?:controller|recovery|janvim-stdout|janvim-stderr)(?:\.[1-3])?$/u,
    );
    expect(storage.size(path)).toBeLessThanOrEqual(DEFAULT_LOG_FILE_BYTES);
  }
  expect(
    entries.reduce((total, [path]) => total + storage.size(path), 0),
  ).toBeLessThanOrEqual(DEFAULT_LOG_TOTAL_BYTES);
  expect(entries.length).toBeLessThanOrEqual(16);
}

describe("Task 9 recovery operations", () => {
  it("requires bounded, observable operator documents", () => {
    const runbook = readFileSync(runbookPath, "utf8");
    const incidentTemplate = readFileSync(incidentTemplatePath, "utf8");

    const requiredSections = [
      "Preflight",
      "Display Capture and Confirmation",
      "Physical Network Disconnect",
      "ValidateOnly",
      "Soak3",
      "Show",
      "Start",
      "Restart Loop",
      "Stop Show",
      "Secondary Fault",
      "JanVim Fault",
      "Controller Fault",
      "Exact Shutdown",
      "Evidence Review",
      "G2 Fallback",
      "Physical-Projector G4 Deferral",
    ] as const;
    const runbookSections = markdownSections(runbook);
    expect([...runbookSections.keys()]).toEqual(requiredSections);
    for (const section of requiredSections) {
      const body = runbookSections.get(section)!;
      const clauses = [...body.matchAll(
        /(Precondition|Exact command\/action|Visible result|Machine evidence|Bounded failure branch) ->/gu,
      )];
      expect(
        clauses.map((clause) => clause[1]),
        `${section} must contain the five ordered operational clauses`,
      ).toEqual([
        "Precondition",
        "Exact command/action",
        "Visible result",
        "Machine evidence",
        "Bounded failure branch",
      ]);
      clauses.forEach((clause, index) => {
        const start = clause.index! + clause[0].length;
        const end = clauses[index + 1]?.index ?? body.length;
        expect(
          body.slice(start, end).trim(),
          `${section} clause ${clause[1]} must not be empty`,
        ).not.toBe("");
      });
    }

    const sectionContracts = {
      "Display Capture and Confirmation": [
        "`start-g2-rehearsal.ps1 Capture`",
        "`start-g2-rehearsal.ps1 Confirm`",
        "fresh external map",
        "checked-in display map remains unconfirmed",
      ],
      "Physical Network Disconnect": [
        "manually disconnect Wi-Fi and Ethernet",
        "launcher only observes network state and never changes networking",
      ],
      "Stop Show": [
        "Stop Show button",
        "Alt+F4 is only the frozen G2 manual acceptance flow",
      ],
      "Secondary Fault": [
        "exact current secondary renderer PID",
        "fixed controller log",
        "approved deliberate renderer fault against that exact identity",
      ],
      "JanVim Fault": [
        "exact JanVim PID, HWND, start identity, and executable hash",
        "token-free lease",
        "approved deliberate fault only against that exact JanVim identity",
      ],
      "G2 Fallback": [
        "preserved frozen G2 short loop",
        "do not add P1 effects, media, or new content",
      ],
      "Physical-Projector G4 Deferral": [
        "physicalProjectorsTested: false",
        "do not convert two-monitor evidence into G4",
        "two physical projectors",
      ],
    } as const;
    for (const [section, contracts] of Object.entries(sectionContracts)) {
      const body = runbookSections.get(section)!;
      for (const contract of contracts) expect(body).toContain(contract);
    }

    const incidentSections = markdownSections(incidentTemplate);
    expect([...incidentSections.keys()]).toEqual([
      "Strict Checklist",
      "Bounded Event Table",
    ]);
    const checklist = incidentSections.get("Strict Checklist")!;
    const checklistItems = [...checklist.matchAll(/^- \[ \] (.+)$/gmu)].map(
      (match) => match[1]!,
    );
    expect(checklistItems.slice(0, 2)).toEqual([
      "Maximum events: 32",
      "Maximum bytes per note: 4096",
    ]);
    for (const requiredField of [
      "Run ID:",
      "Controller run ID:",
      "Generation ID:",
      "Monotonic timestamp:",
      "Wall timestamp:",
      "Mode/state:",
      "Exact process identities:",
      "Fault/retry/domain:",
      "Offline snapshot:",
      "Artifact/content/display hashes:",
      "Operator action:",
      "Recovery result:",
      "Media hashes:",
      "Independent photo/video backup path:",
      "SHA-256:",
      "Follow-up owner:",
    ]) {
      expect(
        checklistItems.some((item) => item.startsWith(requiredField)),
        `missing checklist field ${requiredField}`,
      ).toBe(true);
    }

    const tableSection = incidentSections.get("Bounded Event Table")!;
    const tableLines = tableSection
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("|") && line.endsWith("|"));
    const separatorLines = tableLines.filter((line) =>
      markdownCells(line).every((cell) => /^:?-{3,}:?$/u.test(cell)),
    );
    expect(separatorLines).toHaveLength(1);
    expect(tableLines).toHaveLength(34);
    const tableHeaders = markdownCells(tableLines[0]!);
    expect(tableHeaders).toEqual([
      "# (1-32)",
      "Monotonic timestamp",
      "Wall timestamp",
      "Run/controller/generation IDs",
      "Mode/state",
      "Exact process identities",
      "Fault/retry/domain",
      "Offline snapshot",
      "Artifact/content/display hashes",
      "Operator action",
      "Recovery result",
      "Media hashes and independent photo/video backup path + SHA-256",
      "Notes (<=4096 bytes)",
      "Follow-up owner",
    ]);
    const eventRows = tableLines.slice(2);
    expect(eventRows).toHaveLength(32);
    eventRows.forEach((row, index) => {
      const cells = markdownCells(row);
      expect(cells, `event row ${index + 1} column count`).toHaveLength(
        tableHeaders.length,
      );
      expect(cells[0]).toBe(String(index + 1));
    });

    const structuralFields = [...checklistItems, ...tableHeaders].map((field) =>
      field.toLowerCase(),
    );
    for (const forbiddenField of [
      "bridge token",
      "arbitrary command",
      "keyboard injection",
      "title matching",
      "user config",
      "source-repository mutation",
    ]) {
      expect(
        structuralFields.some((field) => field.includes(forbiddenField)),
        `${forbiddenField} must not be a checklist or table field`,
      ).toBe(false);
    }

    for (const statement of [
      "Secrets are not recorded.",
      "Poem text is not recorded.",
      "User config paths are not recorded.",
      "Arbitrary shell commands are not recorded.",
      "Bridge token is not recorded.",
      "Arbitrary command is not recorded.",
      "Keyboard injection is not recorded.",
      "Title matching is not recorded.",
      "User config path is not recorded.",
      "Source-repository mutation is not recorded.",
    ]) {
      expect(incidentTemplate).toContain(statement);
    }
  });

  it("rejects forbidden post-clear WebRequests with the accepted-run assertion", async () => {
    const host = createComposedHost();
    const coordinator = host.adapters.createCoordinator(composedCommand("Show"));
    await expect(coordinator.boot()).resolves.toEqual({ ready: true });

    expectNoExternalNetworkAttempts(host);
    probeCancelledForbiddenNetworkAttempts(host);
    expect(host.networkAttempts).toEqual(["http", "https", "dns", "ws", "wss"]);
    host.clearNetworkAttempts();
    host.beginRuntimeNetworkObservation();

    probeCancelledForbiddenNetworkAttempts(host);
    expect(host.networkAttempts).toEqual(["http", "https", "dns", "ws", "wss"]);
    expect(() => expectNoExternalNetworkAttempts(host)).toThrowError();

    host.clearNetworkAttempts();
    await coordinator.requestEmergencyStop("sigint");
  });

  it("composes the strict dispatcher, fake-clock Soak3, telemetry, resources, and evidence threshold", async () => {
    const acceptedHost = createComposedHost({
      resetPrimaryDelaysMs: [83, 83, 83],
    });
    const acceptedCoordinator = await startComposedRun(acceptedHost, "Soak3");
    for (let loopNumber = 1; loopNumber <= 3; loopNumber += 1) {
      await advanceComposedLoop(acceptedHost);
    }

    const acceptedCompletion = await acceptedCoordinator.completion;
    expect(
      acceptedCompletion,
      JSON.stringify({
        diagnostics: acceptedCoordinator.diagnostics(),
        trace: acceptedHost.trace,
        logs: controllerLogEvents(acceptedHost.logStorage),
      }),
    ).toEqual({
      ok: true,
      reason: "soak-complete",
    });
    expect(acceptedHost.evidenceValues).toHaveLength(1);
    expect(acceptedHost.evidenceAttempts).toHaveLength(1);
    expect(acceptedHost.terminalValues).toHaveLength(1);
    const acceptedEvidence = acceptedHost.evidenceValues[0]!;
    expect(parseShowRunEvidence(acceptedHost.evidenceAttempts[0])).toEqual(
      acceptedEvidence,
    );
    expect(acceptedEvidence).toMatchObject({
      mode: "Soak3",
      physicalProjectorsTested: false,
      offlineVerified: true,
      aggregate: {
        completedLoops: 3,
        totalSkips: 3,
        cumulativeVisibleDriftMs: 249,
        acceptanceOutcome: "pass",
      },
      shutdown: {
        agentShutdown: "acknowledged",
        hwndClose: "posted",
        janvimExit: "natural",
        bridgeClose: "closed",
        leaseRemoved: true,
      },
    });
    expect(acceptedEvidence.loops.map((loop) => loop.resetBufferSha256)).toEqual([
      fixturePoemSha256,
      fixturePoemSha256,
      fixturePoemSha256,
    ]);
    const acceptedRunCues = acceptedHost.sent.flatMap(({ payload }) =>
      payload !== null &&
      typeof payload === "object" &&
      "type" in payload &&
      payload.type === "run-cue"
        ? [payload as RunCueEvent]
        : [],
    );
    const fixtureCueIds = (
      JSON.parse(fixtureManifest.toString("utf8")) as {
        cues: Array<{ id: string }>;
      }
    ).cues.map((cue) => cue.id);
    expect(
      acceptedRunCues.map((event) => ({
        generationId: event.generationId,
        loopId: event.loopId,
        cueId: event.cue.id,
      })),
    ).toEqual(
      Array.from({ length: 3 }, (_, loopIndex) =>
        fixtureCueIds.map((cueId) => ({
          generationId: 1,
          loopId: `recovery-composed-g1-l${loopIndex + 1}`,
          cueId,
        })),
      ).flat(),
    );
    expect(
      acceptedHost.rendererEvents
        .filter((event) => event.type === "presentation-ack")
        .map((event) => ({
          generationId: event.generationId,
          loopId: event.loopId,
          cueId: event.cueId,
        })),
    ).toEqual(
      acceptedRunCues
        .filter((event) => event.requiresPresentationAck)
        .map((event) => ({
          generationId: event.generationId,
          loopId: event.loopId,
          cueId: event.cue.id,
        })),
    );
    expect(
      acceptedEvidence.loops.every(
        (loop) => loop.resources.controller.rssBytes.count > 0,
      ),
    ).toBe(true);
    expect(
      acceptedEvidence.offlineSnapshots.every((snapshot) => snapshot.offline),
    ).toBe(true);

    const p1Skips = controllerLogEvents(acceptedHost.logStorage).filter(
      (event) => event.type === "p1-skip",
    );
    const fixtureCueKinds = new Set(
      (
        JSON.parse(fixtureManifest.toString("utf8")) as {
          cues: Array<{ kind: string }>;
        }
      ).cues.map((cue) => cue.kind),
    );
    expect(
      ["formula", "image", "matrix"].filter((kind) => fixtureCueKinds.has(kind)),
    ).toEqual([]);
    expect(p1Skips).toEqual([
      { type: "p1-skip", feature: "formula", reason: "fixture-asset-absent" },
      { type: "p1-skip", feature: "image", reason: "fixture-asset-absent" },
      { type: "p1-skip", feature: "matrix", reason: "fixture-asset-absent" },
    ]);
    expect(acceptedEvidence.loops.map((loop) => loop.skipCount)).toEqual([3, 0, 0]);
    const acceptedWriteBacks = acceptedHost.agentCommands.filter(
      (command) =>
        command.action.type === "insert" || command.action.type === "reset",
    );
    expect(acceptedWriteBacks).toHaveLength(6);
    expect(
      new Set(acceptedWriteBacks.map((command) => `${command.loopId}:${command.cueId}`))
        .size,
    ).toBe(6);
    expect(
      acceptedHost.runtimeNetworkBoundaryEvents.filter(
        (event) => event.kind === "exec-file" && event.value.includes("Get-NetRoute"),
      ),
    ).toHaveLength(4);
    expectNoExternalNetworkAttempts(acceptedHost);

    const rejectedHost = createComposedHost({
      resetPrimaryDelaysMs: [84, 83, 83],
    });
    const rejectedCoordinator = await startComposedRun(rejectedHost, "Soak3");
    for (let loopNumber = 1; loopNumber <= 3; loopNumber += 1) {
      await advanceComposedLoop(rejectedHost);
    }
    await expect(rejectedCoordinator.completion).resolves.toEqual({
      ok: true,
      reason: "soak-complete",
    });
    expect(rejectedHost.evidenceValues).toHaveLength(1);
    expect(parseShowRunEvidence(rejectedHost.evidenceAttempts[0])).toEqual(
      rejectedHost.evidenceValues[0],
    );
    expect(rejectedHost.evidenceValues[0]!.aggregate).toMatchObject({
      completedLoops: 3,
      cumulativeVisibleDriftMs: 250,
      acceptanceOutcome: "fail",
    });
    expect(rejectedHost.terminalValues).toHaveLength(1);
    expect(
      rejectedHost.runtimeNetworkBoundaryEvents.filter(
        (event) => event.kind === "exec-file" && event.value.includes("Get-NetRoute"),
      ),
    ).toHaveLength(4);
    expectNoExternalNetworkAttempts(rejectedHost);
  });

  it("safe-cruises a secondary loss and replaces only the secondary with a fresh loop", async () => {
    const host = createHost({ mode: "Show" });
    await bootAndStart(host);
    const oldSession = host.sessions[0]!;
    const oldLoopId = host.coordinator.diagnostics().currentLoopId!;
    oldSession.loopSurface?.send({
      schema: 1,
      type: "run-cue",
      generationId: 1,
      loopId: oldLoopId,
      requiresPresentationAck: false,
      cue: { id: "old-cue", atMs: 1, target: "secondary", kind: "prompt", payload: { text: "old" } },
    });

    host.surfaces[0]!.destroy();
    expect(host.coordinator.diagnostics().state).toBe("safe-cruise");
    await settle();
    expect(host.coordinator.diagnostics().state).toBe("black-recovering");
    await host.clock.fireTimeout(1_000);
    await settle();

    expect(host.coordinator.diagnostics()).toMatchObject({
      state: "running",
      generationId: 2,
      currentLoopId: "g2-loop-1",
      recoveries: [expect.objectContaining({ domain: "secondary", delayMs: 1_000 })],
    });
    expect(host.sessions).toEqual([oldSession]);
    expect(oldSession.resetCalls).toBe(1);
    expect(host.surfaces[1]!.sent.some((event) => event.type === "run-cue" && event.cue.id === "old-cue")).toBe(false);
    await host.coordinator.requestEmergencyStop("sigint");
  });

  it("fully replaces causal faults and enforces independent rolling restart budgets", async () => {
    for (const fault of [
      "agent-disconnected",
      "critical-ack-failed",
      "janvim-exited",
      "secondary-with-editor-pending",
    ] as const) {
      const host = createHost({ mode: "Show" });
      await bootAndStart(host);
      const oldSession = host.sessions[0]!;
      if (fault === "secondary-with-editor-pending") {
        oldSession.editorCommandPending = true;
        host.surfaces[0]!.destroy();
      } else {
        oldSession.emitFault(fault);
      }
      await settle();
      expect(host.coordinator.diagnostics().state).toBe("black-recovering");
      await host.clock.fireTimeout(1_000);
      await settle();
      expect(host.coordinator.diagnostics()).toMatchObject({
        state: "running",
        generationId: 2,
        currentLoopId: "g2-loop-1",
      });
      expect(host.sessions).toHaveLength(2);
      await host.coordinator.requestEmergencyStop("sigint");
    }

    const budgetHost = createHost({ mode: "Show" });
    await bootAndStart(budgetHost);
    budgetHost.sessions.at(-1)!.emitFault("janvim-exited");
    await settle();
    await budgetHost.clock.fireTimeout(1_000);
    await settle();
    expect(budgetHost.coordinator.diagnostics().state).toBe("running");

    budgetHost.surfaces.at(-1)!.destroy();
    await settle();
    expect(budgetHost.coordinator.diagnostics().state).toBe("black-recovering");
    await budgetHost.clock.fireTimeout(1_000);
    await settle();
    expect(budgetHost.coordinator.diagnostics().state).toBe("running");

    for (const delayMs of [2_000, 4_000] as const) {
      budgetHost.sessions.at(-1)!.emitFault("janvim-exited");
      await settle();
      await budgetHost.clock.fireTimeout(delayMs);
      await settle();
      expect(budgetHost.coordinator.diagnostics().state).toBe("running");
    }
    expect(
      budgetHost.coordinator.diagnostics().recoveries.map((recovery) => ({
        domain: recovery.domain,
        attempt: recovery.attempt,
        delayMs: recovery.delayMs,
      })),
    ).toEqual([
      { domain: "janvim", attempt: 1, delayMs: 1_000 },
      { domain: "secondary", attempt: 1, delayMs: 1_000 },
      { domain: "janvim", attempt: 2, delayMs: 2_000 },
      { domain: "janvim", attempt: 3, delayMs: 4_000 },
    ]);
    budgetHost.sessions.at(-1)!.emitFault("janvim-exited");
    await settle();
    expect(budgetHost.coordinator.diagnostics()).toMatchObject({
      state: "safe-ready",
      reason: "janvim-restart-limit",
    });
    await budgetHost.coordinator.requestEmergencyStop("sigint");

    const rollingHost = createHost({ mode: "Show" });
    await bootAndStart(rollingHost);
    for (const delayMs of [1_000, 2_000, 4_000] as const) {
      rollingHost.sessions.at(-1)!.emitFault("janvim-exited");
      await settle();
      await rollingHost.clock.fireTimeout(delayMs);
      await settle();
      expect(rollingHost.coordinator.diagnostics().state).toBe("running");
      rollingHost.clock.advanceBy(1);
    }
    rollingHost.clock.advanceBy(600_000);
    rollingHost.sessions.at(-1)!.emitFault("janvim-exited");
    await settle();
    expect(rollingHost.coordinator.diagnostics().state).toBe("black-recovering");
    await rollingHost.clock.fireTimeout(1_000);
    await settle();
    expect(rollingHost.coordinator.diagnostics()).toMatchObject({
      state: "running",
      recoveries: [
        expect.objectContaining({ domain: "janvim", attempt: 1, delayMs: 1_000 }),
        expect.objectContaining({ domain: "janvim", attempt: 2, delayMs: 2_000 }),
        expect.objectContaining({ domain: "janvim", attempt: 3, delayMs: 4_000 }),
        expect.objectContaining({ domain: "janvim", attempt: 1, delayMs: 1_000 }),
      ],
    });
    await rollingHost.coordinator.requestEmergencyStop("sigint");
  });

  it("has no crash checkpoint, bounds stale promises, network attempts, or retained state across 100 Show loops", async () => {
    const crashedController = createHost({ mode: "Show" });
    await expect(crashedController.coordinator.boot()).resolves.toEqual({ ready: true });
    expect(crashedController.coordinator.diagnostics()).toMatchObject({ state: "ready", currentLoopId: null });
    expect(JSON.stringify(crashedController.coordinator.diagnostics())).not.toMatch(/checkpoint/i);

    const recovery = deferred();
    const staleHost = createHost({ mode: "Show", recoveryGate: recovery.promise });
    await bootAndStart(staleHost);
    staleHost.sessions[0]!.emitFault("janvim-exited");
    await settle();
    await staleHost.clock.fireTimeout(1_000);
    await settle();
    expect(staleHost.clock.active(10_000)).toBe(1);
    await staleHost.coordinator.requestEmergencyStop("window-close");
    const settled = staleHost.coordinator.diagnostics();
    recovery.resolve();
    await settle();
    expect(staleHost.coordinator.diagnostics()).toEqual(settled);

    const host = createComposedHost();
    const coordinator = await startComposedRun(host, "Show");
    const runningCounts = coordinator.diagnostics().counts;
    const boundaryCounts = new Map<number, typeof runningCounts>();
    for (let loopNumber = 1; loopNumber <= 100; loopNumber += 1) {
      await advanceComposedLoop(host, loopNumber === 100);
      if (loopNumber < 100) {
        const diagnosticsAtBoundary = coordinator.diagnostics();
        expect(diagnosticsAtBoundary).toMatchObject({
          state: "running",
          completedLoops: loopNumber,
        });
        boundaryCounts.set(loopNumber, diagnosticsAtBoundary.counts);
        expect(diagnosticsAtBoundary.counts).toEqual(runningCounts);
      }
      const writeBacksAtBoundary = host.agentCommands.filter(
        (command) =>
          command.action.type === "insert" || command.action.type === "reset",
      );
      expect(writeBacksAtBoundary).toHaveLength(loopNumber * 2);
      expect(
        writeBacksAtBoundary.filter((command) => command.action.type === "insert"),
      ).toHaveLength(loopNumber);
      expect(
        writeBacksAtBoundary.filter((command) => command.action.type === "reset"),
      ).toHaveLength(loopNumber);
      expect(
        new Set(
          writeBacksAtBoundary.map(
            (command) => `${command.loopId}:${command.cueId}`,
          ),
        ).size,
      ).toBe(writeBacksAtBoundary.length);
      assertRuntimeLogBounds(host.logStorage);
      expectNoExternalNetworkAttempts(host);
    }
    const completion = await coordinator.completion;
    expect(
      completion,
      JSON.stringify({ diagnostics: coordinator.diagnostics(), trace: host.trace }),
    ).toEqual({
      ok: true,
      reason: "operator-stop",
    });
    expect(boundaryCounts.size).toBe(99);
    const diagnostics = coordinator.diagnostics();
    expect(diagnostics).toMatchObject({
      state: "stopped",
      aggregate: { completedLoops: 100 },
      counts: { listeners: 0, timers: 0, connections: 0, pendingCommands: 0 },
    });
    expect(diagnostics.loops).toHaveLength(3);
    expect(host.evidenceValues).toHaveLength(1);
    expect(host.terminalValues).toHaveLength(1);
    const evidence = host.evidenceValues[0]!;
    expect(evidence.aggregate.completedLoops).toBe(100);
    expect(evidence.loops).toHaveLength(3);
    for (const loop of evidence.loops) {
      expect(loop.countsAtStart).toEqual(runningCounts);
      expect(loop.countsAtEnd).toEqual(runningCounts);
      const loopNumber = Number(/-l(\d+)$/u.exec(loop.loopId)?.[1]);
      expect(Number.isSafeInteger(loopNumber)).toBe(true);
      boundaryCounts.set(loopNumber, loop.countsAtEnd);
    }
    expect([...boundaryCounts.keys()].sort((left, right) => left - right)).toEqual(
      Array.from({ length: 100 }, (_, index) => index + 1),
    );
    expect([...boundaryCounts.values()]).toHaveLength(100);
    for (const counts of boundaryCounts.values()) {
      expect(counts).toEqual(runningCounts);
    }
    expect(rawMetricArrayPaths(evidence)).toEqual([]);
    expect(evidence.offlineSnapshots.every((snapshot) => snapshot.offline)).toBe(
      true,
    );
    expect(
      host.runtimeNetworkBoundaryEvents.filter(
        (event) => event.kind === "exec-file" && event.value.includes("Get-NetRoute"),
      ),
    ).toHaveLength(101);
    expectNoExternalNetworkAttempts(host);
    assertRuntimeLogBounds(host.logStorage);
    assertDefaultLogBudgetBounds(new MemoryLogStorage());
  });

  it("coalesces Stop, SIGINT, and window-close while continuing one bounded cleanup after phase timeouts", async () => {
    const gate = deferred();
    const host = createHost({ mode: "Show", shutdownGate: gate.promise });
    await bootAndStart(host);
    const sigint = host.coordinator.requestEmergencyStop("sigint");
    const windowClose = host.coordinator.requestEmergencyStop("window-close");
    expect(windowClose).toBe(sigint);
    expect(host.coordinator.handleRendererEvent({ schema: 1, type: "operator-action", action: "stop-show" })).toBe(false);
    await settle();
    expect(host.sessions[0]!.shutdownCalls).toEqual(["agent-shutdown"]);
    gate.resolve();
    await expect(Promise.all([sigint, windowClose])).resolves.toEqual([undefined, undefined]);
    expect(host.evidence).toHaveLength(1);
    expect(host.terminalWrites).toBe(1);

    for (const phase of [
      "agent-shutdown",
      "close-window",
      "wait-janvim",
      "terminate-exact",
      "wait-forced",
      "close-bridge",
    ]) {
      const timedOut = createHost({ mode: "Show", shutdownFailures: new Set([phase]) });
      await bootAndStart(timedOut);
      await timedOut.coordinator.requestEmergencyStop("electron-quit");
      expect(timedOut.coordinator.diagnostics().state, phase).toBe("stopped");
      expect(timedOut.sessions[0]!.shutdownCalls, phase).toContain("close-bridge");
      expect(timedOut.evidence, phase).toHaveLength(1);
      expect(timedOut.terminalWrites, phase).toBe(1);
    }
  });
});
