import { describe, expect, it, vi } from "vitest";

import type {
  Cue,
  RendererToControllerEvent,
  RunCueEvent,
  RunStatusEvent,
} from "@janvim-exhibition/show-schema";
import {
  MultiLoopDriver,
  type MultiLoopDriverOptions,
} from "../src/multi-loop-driver.ts";
import type {
  OneLoopRuntime,
  OneLoopTimerAdapter,
  OneLoopTimerHandle,
} from "../src/one-loop-driver.ts";
import {
  ResourceSampler,
  type ResourceSamplerTimerHandle,
} from "../src/resource-sampler.ts";
import { RunTelemetry } from "../src/run-telemetry.ts";
import {
  ShowRunCoordinator,
  type PrimaryCueCompletionEvent,
  type ShowRunCoordinatorDependencies,
  type ShowRunResult,
  type ShowRunSession,
  type ShowSecondarySurface,
} from "../src/show-run-coordinator.ts";

const ORIGINAL_POEM_SHA256 = "a".repeat(64);
const WRONG_POEM_SHA256 = "b".repeat(64);
const LOOP_DURATION_MS = 90_000;

type InjectedShutdownFailure =
  | "driver-stop"
  | "agent-shutdown"
  | "close-window"
  | "wait-natural"
  | "terminate-exact"
  | "wait-forced"
  | "close-bridge"
  | "session-dispose"
  | "session-diagnostics"
  | "surface-close"
  | "network-snapshot"
  | "flush-logs"
  | "finalize-evidence"
  | "terminal-marker";

type ListenerRegistrationFailure =
  | "surface.onEvent"
  | "surface.onDestroyed"
  | "session.onFault"
  | "session.onPrimaryCompletion";

type LoopConstructionFailure =
  | "nextLoopId"
  | "createTelemetry"
  | "beginLoop"
  | "createResourceSampler"
  | "session.createLoop"
  | "createDriver"
  | "driver.start-false"
  | "driver.start-throw";

type Deferred = {
  promise: Promise<void>;
  resolve(): void;
};

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function waitForAbortable(
  operation: Promise<void>,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (signal === undefined) {
    await operation;
    return;
  }
  if (signal.aborted) throw new Error("operation aborted");
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      action();
    };
    const abort = (): void => finish(() => reject(new Error("operation aborted")));
    signal.addEventListener("abort", abort, { once: true });
    void operation.then(
      () => finish(resolve),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

async function settle(): Promise<void> {
  for (let index = 0; index < 64; index += 1) await Promise.resolve();
}

interface ScheduledCallback {
  id: number;
  delayMs: number;
  callback: () => unknown;
}

class FakeTimers implements OneLoopTimerAdapter {
  private readonly intervals = new Map<number, ScheduledCallback>();
  private readonly timeouts = new Map<number, ScheduledCallback>();
  private nextId = 1;
  public now = 0;
  public readonly timeoutDelays: number[] = [];
  public rejectTimeoutClear = false;

  public setInterval(callback: () => void, delayMs: number): number {
    const entry = { id: this.nextId++, delayMs, callback };
    this.intervals.set(entry.id, entry);
    return entry.id;
  }

  public clearInterval(id: OneLoopTimerHandle | ResourceSamplerTimerHandle): void {
    if (typeof id === "number") this.intervals.delete(id);
  }

  public setTimeout(callback: () => void, delayMs: number): number {
    const entry = { id: this.nextId++, delayMs, callback };
    this.timeouts.set(entry.id, entry);
    this.timeoutDelays.push(delayMs);
    return entry.id;
  }

  public clearTimeout(id: OneLoopTimerHandle): void {
    if (this.rejectTimeoutClear) throw new Error("injected timer clear failure");
    if (typeof id === "number") this.timeouts.delete(id);
  }

  public async fireInterval(delayMs: number): Promise<void> {
    const entry = [...this.intervals.values()].find(
      (candidate) => candidate.delayMs === delayMs,
    );
    if (entry === undefined) throw new Error(`no interval scheduled at ${delayMs} ms`);
    await entry.callback();
  }

  public async fireTimeout(delayMs: number): Promise<void> {
    const entry = [...this.timeouts.values()].find(
      (candidate) => candidate.delayMs === delayMs,
    );
    if (entry === undefined) throw new Error(`no timeout scheduled at ${delayMs} ms`);
    this.timeouts.delete(entry.id);
    await entry.callback();
  }

  public active(delayMs?: number): number {
    const intervals = [...this.intervals.values()].filter(
      (entry) => delayMs === undefined || entry.delayMs === delayMs,
    ).length;
    const timeouts = [...this.timeouts.values()].filter(
      (entry) => delayMs === undefined || entry.delayMs === delayMs,
    ).length;
    return intervals + timeouts;
  }
}

class FakeSurface implements ShowSecondarySurface {
  public readonly rendererPid = 2026;
  public readonly sent: Array<RunCueEvent | RunStatusEvent> = [];
  public closeCalls = 0;
  public rejectStatusSends = false;
  public rejectClose = false;
  public registrationFailure: ListenerRegistrationFailure | undefined;
  private readonly eventListeners = new Set<
    (event: RendererToControllerEvent) => void
  >();
  private readonly destroyedListeners = new Set<() => void>();
  private readonly capturedEventListeners: Array<
    (event: RendererToControllerEvent) => void
  > = [];
  private readonly capturedDestroyedListeners: Array<() => void> = [];

  public constructor(private readonly trace: string[]) {}

  public send(event: RunCueEvent | RunStatusEvent): void {
    if (this.rejectStatusSends && event.type === "run-status") {
      throw new Error("renderer is already destroyed");
    }
    this.sent.push(event);
    if (event.type === "run-status") this.trace.push(`status:${event.state}`);
  }

  public onEvent(listener: (event: RendererToControllerEvent) => void): () => void {
    if (this.registrationFailure === "surface.onEvent") {
      throw new Error("fixture registration failure: surface.onEvent");
    }
    this.eventListeners.add(listener);
    this.capturedEventListeners.push(listener);
    return () => {
      this.trace.push("dispose-surface-event-listener");
      this.eventListeners.delete(listener);
    };
  }

  public onDestroyed(listener: () => void): () => void {
    if (this.registrationFailure === "surface.onDestroyed") {
      throw new Error("fixture registration failure: surface.onDestroyed");
    }
    this.destroyedListeners.add(listener);
    this.capturedDestroyedListeners.push(listener);
    return () => {
      this.trace.push("dispose-surface-destroyed-listener");
      this.destroyedListeners.delete(listener);
    };
  }

  public emit(event: RendererToControllerEvent): void {
    for (const listener of [...this.eventListeners]) listener(event);
  }

  public destroy(): void {
    for (const listener of [...this.destroyedListeners]) listener();
  }

  public capturedEventListener(index = 0): (event: RendererToControllerEvent) => void {
    const listener = this.capturedEventListeners[index];
    if (listener === undefined) throw new Error("captured renderer listener is missing");
    return listener;
  }

  public capturedDestroyedListener(index = 0): () => void {
    const listener = this.capturedDestroyedListeners[index];
    if (listener === undefined) throw new Error("captured destroy listener is missing");
    return listener;
  }

  public close(): void {
    this.closeCalls += 1;
    this.trace.push("surface-close");
    if (this.rejectClose) throw new Error("injected surface close failure");
  }

  public diagnostics(): { listeners: number } {
    return {
      listeners: this.eventListeners.size + this.destroyedListeners.size,
    };
  }
}

class FakeSession implements ShowRunSession {
  public readonly sessionId: string;
  public readonly runtime: OneLoopRuntime;
  public loopSurface: ShowSecondarySurface | undefined;
  public loopId: string | undefined;
  public reserveNextLoopId: (() => string) | undefined;
  public primaryEditorDispatch:
    | ((event: { generationId: number; loopId: string; cueId: string; cue: Extract<Cue, { kind: "editor-action" }> }) => void)
    | undefined;
  public editorCommandPending = false;
  public connections = 1;
  public naturalExit: "natural" | "still-running" = "natural";
  public forcedExit = true;
  public prepareHash = ORIGINAL_POEM_SHA256;
  public resetHash = ORIGINAL_POEM_SHA256;
  public runtimeStartFailure: "return-false" | "throw" | undefined;
  public registrationFailure: ListenerRegistrationFailure | undefined;
  public loopConstructionFailure: LoopConstructionFailure | undefined;
  public releaseLoopReferencesOnStop = false;
  public readonly abortedPhases: string[] = [];
  public leaseRemoved = false;
  private disposed = false;
  private generationId: number;
  private readonly faultListeners = new Set<
    (fault: "agent-disconnected" | "critical-ack-failed" | "janvim-exited") => void
  >();
  private readonly primaryListeners = new Set<
    (event: PrimaryCueCompletionEvent) => void
  >();
  private readonly capturedFaultListeners: Array<
    (fault: "agent-disconnected" | "critical-ack-failed" | "janvim-exited") => void
  > = [];
  private readonly capturedPrimaryListeners: Array<
    (event: PrimaryCueCompletionEvent) => void
  > = [];

  public constructor(
    generationId: number,
    private readonly trace: string[],
    private readonly block: (phase: string) => Promise<void>,
    private readonly failPhase: (phase: InjectedShutdownFailure) => boolean,
  ) {
    this.generationId = generationId;
    this.sessionId = `session-${generationId}`;
    this.runtime = {
      state: "ready",
      completedLoops: 0,
      start: vi.fn(() => {
        if (
          this.loopConstructionFailure === "driver.start-false" ||
          this.loopConstructionFailure === "driver.start-throw"
        ) {
          this.reserveNextLoopId?.();
          if (this.loopConstructionFailure === "driver.start-throw") {
            throw new Error("injected loop construction failure: driver.start");
          }
          return false;
        }
        if (this.runtimeStartFailure === "throw") {
          throw new Error("injected runtime start failure");
        }
        if (this.runtimeStartFailure === "return-false") return false;
        this.runtime.state = "running";
        return true;
      }),
      advance: vi.fn(async () => 0),
      stop: vi.fn(() => {
        this.trace.push("runtime-stop");
        if (this.loopConstructionFailure !== undefined) {
          this.trace.push("rollback:runtime.stop");
        }
        if (this.releaseLoopReferencesOnStop) {
          this.loopId = undefined;
          this.loopSurface = undefined;
          this.reserveNextLoopId = undefined;
          this.primaryEditorDispatch = undefined;
        }
        if (this.failPhase("driver-stop")) {
          throw new Error("injected driver stop failure");
        }
        this.runtime.state = "stopped";
      }),
    };
  }

  public currentGenerationId(): number {
    return this.generationId;
  }

  public rebindGeneration(generationId: number): void {
    this.generationId = generationId;
    this.trace.push(`rebind-generation:${generationId}`);
  }

  public async startBridge(signal?: AbortSignal): Promise<void> {
    this.trace.push(`start-bridge:${this.generationId}`);
    await this.waitForPhase("start-bridge", signal);
  }

  public async launchJanVim(signal?: AbortSignal): Promise<void> {
    this.trace.push(`launch-janvim:${this.generationId}`);
    await this.waitForPhase("launch-janvim", signal);
  }

  public async placeJanVim(signal?: AbortSignal): Promise<void> {
    this.trace.push(`place-janvim:${this.generationId}`);
    await this.waitForPhase("place-janvim", signal);
  }

  public async awaitAgent(signal?: AbortSignal): Promise<void> {
    this.trace.push(`await-agent:${this.generationId}`);
    await this.waitForPhase("await-agent", signal);
  }

  public async prepareOriginalPoem(
    signal?: AbortSignal,
  ): Promise<{ bufferSha256: string }> {
    this.trace.push(`prepare-original:${this.generationId}`);
    await this.waitForPhase("prepare-original", signal);
    return { bufferSha256: this.prepareHash };
  }

  private async waitForPhase(
    phase: string,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const operation = this.block(phase);
    if (signal === undefined) {
      await operation;
      return;
    }
    if (signal.aborted) {
      this.abortedPhases.push(phase);
      throw new Error(`aborted phase: ${phase}`);
    }
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (action: () => void): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        action();
      };
      const abort = (): void => {
        this.abortedPhases.push(phase);
        finish(() => reject(new Error(`aborted phase: ${phase}`)));
      };
      signal.addEventListener("abort", abort, { once: true });
      void operation.then(
        () => finish(resolve),
        (error: unknown) => finish(() => reject(error)),
      );
    });
  }

  public createLoop(
    loopId: string,
    surface: ShowSecondarySurface,
    reserveNextLoopId?: () => string,
    primaryEditorDispatch?: (event: {
      generationId: number;
      loopId: string;
      cueId: string;
      cue: Extract<Cue, { kind: "editor-action" }>;
    }) => void,
  ): OneLoopRuntime {
    if (this.loopConstructionFailure !== undefined) {
      this.trace.push("loop-stage:session.createLoop");
    }
    if (this.loopConstructionFailure === "session.createLoop") {
      throw new Error("injected loop construction failure: session.createLoop");
    }
    this.loopId = loopId;
    this.loopSurface = surface;
    this.reserveNextLoopId = reserveNextLoopId;
    this.primaryEditorDispatch = primaryEditorDispatch;
    return this.runtime;
  }

  public emitPrimaryEditorDispatch(event: {
    generationId: number;
    loopId: string;
    cueId: string;
    cue: Extract<Cue, { kind: "editor-action" }>;
  }): void {
    this.primaryEditorDispatch?.(event);
  }

  public onFault(
    listener: (
      fault: "agent-disconnected" | "critical-ack-failed" | "janvim-exited",
    ) => void,
  ): () => void {
    if (this.registrationFailure === "session.onFault") {
      throw new Error("fixture registration failure: session.onFault");
    }
    this.faultListeners.add(listener);
    this.capturedFaultListeners.push(listener);
    return () => {
      this.trace.push("dispose-session-fault-listener");
      this.faultListeners.delete(listener);
    };
  }

  public onPrimaryCompletion(
    listener: (event: PrimaryCueCompletionEvent) => void,
  ): () => void {
    if (this.registrationFailure === "session.onPrimaryCompletion") {
      throw new Error("fixture registration failure: session.onPrimaryCompletion");
    }
    this.primaryListeners.add(listener);
    this.capturedPrimaryListeners.push(listener);
    return () => {
      this.trace.push("dispose-session-primary-listener");
      this.primaryListeners.delete(listener);
    };
  }

  public emitPrimary(event: PrimaryCueCompletionEvent): void {
    for (const listener of [...this.primaryListeners]) listener(event);
  }

  public emitFault(
    fault: "agent-disconnected" | "critical-ack-failed" | "janvim-exited",
  ): void {
    for (const listener of [...this.faultListeners]) listener(fault);
  }

  public capturedFaultListener(index = 0): (
    fault: "agent-disconnected" | "critical-ack-failed" | "janvim-exited",
  ) => void {
    const listener = this.capturedFaultListeners[index];
    if (listener === undefined) throw new Error("captured fault listener is missing");
    return listener;
  }

  public capturedPrimaryListener(
    index = 0,
  ): (event: PrimaryCueCompletionEvent) => void {
    const listener = this.capturedPrimaryListeners[index];
    if (listener === undefined) throw new Error("captured primary listener is missing");
    return listener;
  }

  public diagnostics(): {
      connections: number;
    pendingCommands: number;
    editorCommandPending: boolean;
    leaseRemoved: boolean;
  } {
    if (this.disposed && this.failPhase("session-diagnostics")) {
      throw new Error("injected session diagnostics failure");
    }
    return {
      connections: this.connections,
      pendingCommands: Number(this.editorCommandPending),
      editorCommandPending: this.editorCommandPending,
      leaseRemoved: this.leaseRemoved,
    };
  }

  public async resetToOriginal(
    loopId: string,
    signal?: AbortSignal,
  ): Promise<{ bufferSha256: string }> {
    this.trace.push(`reset-original:${loopId}`);
    if (signal?.aborted === true) throw new Error("aborted reset-original");
    return { bufferSha256: this.resetHash };
  }

  public async sendAgentShutdown(timeoutMs: 2_000, retryLimit: 1): Promise<void> {
    this.trace.push(`agent-shutdown:${timeoutMs}:${retryLimit}`);
    await this.block("agent-shutdown");
    if (this.failPhase("agent-shutdown")) {
      throw new Error("injected agent shutdown failure");
    }
  }

  public async closePlacedWindow(
    timeoutMs: 2_000,
    maxOutputBytes: 4_096,
  ): Promise<void> {
    this.trace.push(`close-window:${timeoutMs}:${maxOutputBytes}`);
    if (this.failPhase("close-window")) {
      throw new Error("injected window close failure");
    }
  }

  public async waitForJanVimExit(
    timeoutMs: 5_000,
  ): Promise<"natural" | "still-running"> {
    this.trace.push(`wait-natural:${timeoutMs}`);
    if (this.failPhase("wait-natural")) {
      throw new Error("injected natural wait failure");
    }
    if (this.naturalExit === "natural") this.leaseRemoved = true;
    return this.naturalExit;
  }

  public async terminateExactJanVim(): Promise<void> {
    this.trace.push("terminate-exact");
    if (this.failPhase("terminate-exact")) {
      throw new Error("injected exact terminate failure");
    }
  }

  public async waitForForcedExit(timeoutMs: 5_000): Promise<boolean> {
    this.trace.push(`wait-forced:${timeoutMs}`);
    if (this.failPhase("wait-forced")) {
      throw new Error("injected forced wait failure");
    }
    if (this.forcedExit) this.leaseRemoved = true;
    return this.forcedExit;
  }

  public async closeBridge(timeoutMs: 5_000): Promise<void> {
    this.trace.push(`close-bridge:${timeoutMs}`);
    if (this.failPhase("close-bridge")) {
      throw new Error("injected bridge close failure");
    }
  }

  public dispose(): void {
    this.trace.push("session-dispose");
    this.disposed = true;
    if (this.failPhase("session-dispose")) {
      throw new Error("injected session dispose failure");
    }
    this.faultListeners.clear();
    this.primaryListeners.clear();
  }
}

interface HarnessOptions {
  mode?: "Soak3" | "Show";
  blockedPhase?: string;
  prepareHash?: string;
  boundaryNetworkDeferrals?: Deferred[];
  prepareHashes?: string[];
  recoveryOpenFailure?: boolean;
  recoveryOpenGate?: Deferred;
  recoverySessionGate?: Deferred;
  recoverySessionPhase?:
    | "start-bridge"
    | "launch-janvim"
    | "place-janvim"
    | "await-agent"
    | "prepare-original";
  sessionConnections?: number[];
  runtimeStartFailures?: Array<"return-false" | "throw" | undefined>;
  shutdownFailures?: Set<InjectedShutdownFailure>;
  forcedExit?: boolean;
  timerClearFailure?: boolean;
  logger?: (event: Record<string, unknown>) => void;
  loopConstructionFailure?: LoopConstructionFailure;
  rollbackDriverStopFailure?: boolean;
}

function createHarness(options: HarnessOptions = {}) {
  const trace: string[] = [];
  const logs: Array<Record<string, unknown>> = [];
  const logAttempts: Array<Record<string, unknown>> = [];
  const timers = new FakeTimers();
  timers.rejectTimeoutClear = options.timerClearFailure ?? false;
  const blocker = options.blockedPhase === undefined ? undefined : deferred();
  const surfaces: FakeSurface[] = [];
  const sessions: FakeSession[] = [];
  const drivers: MultiLoopDriver[] = [];
  const driverOptions: MultiLoopDriverOptions[] = [];
  const telemetries: RunTelemetry[] = [];
  const samplers: ResourceSampler[] = [];
  const loopIds: string[] = [];
  const evidence: Array<{
    result: ShowRunResult;
    diagnostics: ReturnType<ShowRunCoordinator["diagnostics"]>;
  }> = [];
  let networkSamples = 0;

  const block = async (phase: string): Promise<void> => {
    if (options.blockedPhase === phase) await blocker?.promise;
  };

  const dependencies: ShowRunCoordinatorDependencies = {
    mode: options.mode ?? "Soak3",
    originalPoemSha256: ORIGINAL_POEM_SHA256,
    validate: async () => {
      trace.push("validate");
      await block("validate");
    },
    openSecondary: async (generationId, signal) => {
      trace.push(`open-secondary:${generationId}`);
      const recoveryOpen = surfaces.length > 0;
      if (recoveryOpen && options.recoveryOpenGate !== undefined) {
        await waitForAbortable(options.recoveryOpenGate.promise, signal);
      }
      if (recoveryOpen && options.recoveryOpenFailure === true) {
        throw new Error("injected secondary recovery failure");
      }
      const surface = new FakeSurface(trace);
      surface.rejectClose = options.shutdownFailures?.has("surface-close") ?? false;
      surfaces.push(surface);
      try {
        await waitForAbortable(block("open-secondary"), signal);
      } catch (error) {
        surface.close();
        throw error;
      }
      return surface;
    },
    createSession: (generationId) => {
      const sessionIndex = sessions.length;
      const session = new FakeSession(
        generationId,
        trace,
        async (phase) => {
          await block(phase);
          if (
            sessionIndex > 0 &&
            phase === (options.recoverySessionPhase ?? "start-bridge")
          ) {
            await options.recoverySessionGate?.promise;
          }
        },
        (phase) => options.shutdownFailures?.has(phase) ?? false,
      );
      session.prepareHash =
        options.prepareHashes?.[sessionIndex] ??
        options.prepareHash ??
        ORIGINAL_POEM_SHA256;
      session.connections = options.sessionConnections?.[sessionIndex] ?? 1;
      session.runtimeStartFailure = options.runtimeStartFailures?.[sessionIndex];
      session.loopConstructionFailure = options.loopConstructionFailure;
      session.releaseLoopReferencesOnStop =
        options.loopConstructionFailure !== undefined;
      session.forcedExit = options.forcedExit ?? true;
      sessions.push(session);
      return session;
    },
    createDriver: (driverOptionsInput) => {
      if (options.loopConstructionFailure !== undefined) {
        trace.push("loop-stage:createDriver");
      }
      if (options.loopConstructionFailure === "createDriver") {
        throw new Error("injected loop construction failure: createDriver");
      }
      driverOptions.push(driverOptionsInput);
      const driver = new MultiLoopDriver(driverOptionsInput);
      if (options.loopConstructionFailure !== undefined) {
        const start = driver.start.bind(driver);
        vi.spyOn(driver, "start").mockImplementation(() => {
          trace.push("loop-stage:driver.start");
          return start();
        });
        const stop = driver.stop.bind(driver);
        vi.spyOn(driver, "stop").mockImplementation(() => {
          trace.push("rollback:driver.stop");
          if (options.rollbackDriverStopFailure === true) {
            throw new Error("injected rollback failure: driver.stop");
          }
          stop();
        });
      }
      drivers.push(driver);
      return driver;
    },
    timers,
    createTelemetry: () => {
      if (options.loopConstructionFailure !== undefined) {
        trace.push("loop-stage:createTelemetry");
      }
      if (options.loopConstructionFailure === "createTelemetry") {
        throw new Error("injected loop construction failure: createTelemetry");
      }
      const telemetry = new RunTelemetry();
      if (options.loopConstructionFailure !== undefined) {
        const beginLoop = telemetry.beginLoop.bind(telemetry);
        vi.spyOn(telemetry, "beginLoop").mockImplementation((...arguments_) => {
          trace.push("loop-stage:beginLoop");
          if (options.loopConstructionFailure === "beginLoop") {
            throw new Error("injected loop construction failure: beginLoop");
          }
          return beginLoop(...arguments_);
        });
      }
      telemetries.push(telemetry);
      return telemetry;
    },
    createResourceSampler: () => {
      if (options.loopConstructionFailure !== undefined) {
        trace.push("loop-stage:createResourceSampler");
      }
      if (options.loopConstructionFailure === "createResourceSampler") {
        throw new Error(
          "injected loop construction failure: createResourceSampler",
        );
      }
      const sampler = new ResourceSampler({
        adapter: {
          sample: async (pid) => ({ rssBytes: pid * 1_000, handleCount: pid }),
        },
        timers,
      });
      sampler.start({ controller: 11, renderer: 22, janvim: 33 });
      if (options.loopConstructionFailure !== undefined) {
        const finish = sampler.finish.bind(sampler);
        vi.spyOn(sampler, "finish").mockImplementation(() => {
          trace.push("rollback:sampler.finish");
          return finish();
        });
      }
      samplers.push(sampler);
      return sampler;
    },
    sampleNetwork: async () => {
      networkSamples += 1;
      if (networkSamples === 1) await block("sample-network");
      if (networkSamples > 1) {
        await options.boundaryNetworkDeferrals?.[networkSamples - 2]?.promise;
      }
      if (
        networkSamples > 1 &&
        options.shutdownFailures?.has("network-snapshot") === true
      ) {
        throw new Error("injected network snapshot failure");
      }
      return {
        sampledAtMs: timers.now,
        activeExternalDefaultRoutes: 0,
        connectedExternalProfiles: 0,
        offline: true,
      };
    },
    finalizeEvidence: async (result, diagnostics) => {
      trace.push(`finalize:${result.reason}`);
      if (options.shutdownFailures?.has("finalize-evidence") === true) {
        throw new Error("injected evidence failure");
      }
      evidence.push({ result, diagnostics });
    },
    writeTerminalMarker: async (result) => {
      trace.push(`terminal:${result.reason}`);
      if (options.shutdownFailures?.has("terminal-marker") === true) {
        throw new Error("injected terminal marker failure");
      }
    },
    flushLogs: async () => {
      trace.push("flush-logs");
      if (options.shutdownFailures?.has("flush-logs") === true) {
        throw new Error("injected flush failure");
      }
    },
    nextLoopId: (generationId, loopNumber) => {
      if (options.loopConstructionFailure !== undefined) {
        trace.push(`loop-stage:nextLoopId:${loopNumber}`);
      }
      if (options.loopConstructionFailure === "nextLoopId") {
        throw new Error("injected loop construction failure: nextLoopId");
      }
      const loopId = `g${generationId}-loop-${loopNumber}`;
      loopIds.push(loopId);
      return loopId;
    },
    nowMs: () => timers.now,
    log: (event) => {
      logAttempts.push(event);
      options.logger?.(event);
      logs.push(event);
      if (event.type === "generation-invalidate") trace.push("generation-invalidate");
      if (event.type === "recovery-delay") {
        trace.push(`recovery-delay:${String(event.delayMs)}`);
      }
      if (event.type === "shutdown-phase") {
        trace.push(`shutdown-phase:${String(event.phase)}`);
      }
    },
  };

  const coordinator = new ShowRunCoordinator(dependencies);
  return {
    coordinator,
    trace,
    logs,
    logAttempts,
    timers,
    blocker,
    surfaces,
    sessions,
    drivers,
    driverOptions,
    telemetries,
    samplers,
    loopIds,
    evidence,
    get networkSamples() {
      return networkSamples;
    },
  };
}

function resetCue(): Cue {
  return {
    id: "cue-reset",
    atMs: LOOP_DURATION_MS,
    target: "both",
    kind: "editor-action",
    payload: {
      action: { type: "reset" },
      displayKeys: ["Esc"],
      semanticLabel: "return to baseline",
      critical: true,
    },
  };
}

function noncriticalCue(id: string): Cue {
  return {
    id,
    atMs: 1,
    target: "secondary",
    kind: "prompt",
    payload: { text: id },
  };
}

function startEvent(): RendererToControllerEvent {
  return { schema: 1, type: "operator-action", action: "start" };
}

function stopEvent(): RendererToControllerEvent {
  return { schema: 1, type: "operator-action", action: "stop-show" };
}

async function bootReady(harness: ReturnType<typeof createHarness>): Promise<void> {
  await expect(harness.coordinator.boot()).resolves.toEqual({ ready: true });
  expect(harness.coordinator.diagnostics().state).toBe("ready");
}

async function startRunning(harness: ReturnType<typeof createHarness>): Promise<void> {
  await bootReady(harness);
  expect(harness.coordinator.handleRendererEvent(startEvent())).toBe(true);
  expect(harness.coordinator.diagnostics().state).toBe("running");
}

function bindSurfaceForTest(
  coordinator: ShowRunCoordinator,
  surface: ShowSecondarySurface,
): void {
  const fixture = coordinator as unknown as {
    bindSurface(value: ShowSecondarySurface, generationId: number): void;
  };
  fixture.bindSurface(surface, 1);
}

function bindSessionForTest(
  coordinator: ShowRunCoordinator,
  session: ShowRunSession,
): void {
  const fixture = coordinator as unknown as {
    bindSession(value: ShowRunSession, generationId: number): void;
  };
  fixture.bindSession(session, 1);
}

function constructionState(coordinator: ShowRunCoordinator): {
  activeLoop: unknown;
  pendingNextLoop: unknown;
  driver: unknown;
} {
  return coordinator as unknown as {
    activeLoop: unknown;
    pendingNextLoop: unknown;
    driver: unknown;
  };
}

async function completeResetBoundary(
  harness: ReturnType<typeof createHarness>,
  loopNumber: number,
  visibleDriftMs = 2,
): Promise<void> {
  const diagnostics = harness.coordinator.diagnostics();
  const loopId = diagnostics.currentLoopId;
  if (loopId === null) throw new Error("active loop ID is missing");
  const session = harness.sessions.at(-1);
  if (session?.loopSurface === undefined) throw new Error("loop surface is missing");

  const generationId = diagnostics.generationId;
  const dispatchedAtMs = loopNumber * 1_000;
  harness.timers.now = dispatchedAtMs;
  session.emitPrimaryEditorDispatch({
    generationId,
    loopId,
    cueId: "cue-reset",
    cue: resetCue(),
  });

  harness.timers.now = dispatchedAtMs + 5;
  session.emitPrimary({
    generationId,
    loopId,
    cueId: "cue-reset",
    bufferSha256: ORIGINAL_POEM_SHA256,
  });

  session.loopSurface.send({
    schema: 1,
    type: "run-cue",
    generationId,
    loopId,
    requiresPresentationAck: true,
    cue: resetCue(),
  });

  harness.timers.now = dispatchedAtMs + 5 + visibleDriftMs;
  expect(
    harness.coordinator.handleRendererEvent({
      schema: 1,
      type: "presentation-ack",
      generationId,
      loopId,
      cueId: "cue-reset",
    }),
  ).toBe(true);

  session.runtime.completedLoops = loopNumber;
  session.reserveNextLoopId?.();
  harness.timers.now = dispatchedAtMs + 20;
  await harness.timers.fireInterval(16);
  await settle();
}

type LoggerSafetyScenario =
  | "invalid-renderer-input"
  | "startup-failure-cleanup"
  | "generation-invalidation"
  | "recovery-delay-and-outcome"
  | "shutdown-phase-and-failure";

const LOGGER_SAFETY_SCENARIOS: ReadonlyArray<{
  name: LoggerSafetyScenario;
  expectedLogTypes: readonly string[];
}> = [
  { name: "invalid-renderer-input", expectedLogTypes: ["ignored-event"] },
  { name: "startup-failure-cleanup", expectedLogTypes: ["startup-cleanup"] },
  {
    name: "generation-invalidation",
    expectedLogTypes: ["generation-invalidate"],
  },
  {
    name: "recovery-delay-and-outcome",
    expectedLogTypes: ["recovery-delay", "recovery-outcome"],
  },
  {
    name: "shutdown-phase-and-failure",
    expectedLogTypes: ["shutdown-phase", "shutdown-failure"],
  },
];

function safetyCleanupTrace(trace: readonly string[]): string[] {
  return trace.filter(
    (entry) =>
      entry !== "generation-invalidate" &&
      !entry.startsWith("recovery-delay:") &&
      !entry.startsWith("shutdown-phase:"),
  );
}

async function runLoggerSafetyScenario(
  scenario: LoggerSafetyScenario,
  logger: (event: Record<string, unknown>) => void,
) {
  const common = { mode: "Show" as const, logger };
  let harness: ReturnType<typeof createHarness>;

  switch (scenario) {
    case "invalid-renderer-input":
      harness = createHarness(common);
      await bootReady(harness);
      expect(harness.coordinator.handleRendererEvent({ type: "invalid" })).toBe(false);
      await harness.coordinator.requestEmergencyStop("sigint");
      break;
    case "startup-failure-cleanup":
      harness = createHarness({ ...common, prepareHash: WRONG_POEM_SHA256 });
      await expect(harness.coordinator.boot()).resolves.toEqual({
        ready: false,
        reason: "original-poem-hash-mismatch",
      });
      expect(harness.coordinator.handleRendererEvent(stopEvent())).toBe(true);
      await harness.coordinator.completion;
      break;
    case "generation-invalidation":
      harness = createHarness(common);
      await startRunning(harness);
      harness.sessions[0]!.emitFault("janvim-exited");
      await settle();
      await harness.coordinator.requestEmergencyStop("sigint");
      break;
    case "recovery-delay-and-outcome":
      harness = createHarness(common);
      await startRunning(harness);
      harness.sessions[0]!.emitFault("janvim-exited");
      await settle();
      await harness.timers.fireTimeout(1_000);
      await settle();
      await harness.coordinator.requestEmergencyStop("sigint");
      break;
    case "shutdown-phase-and-failure":
      harness = createHarness({
        ...common,
        shutdownFailures: new Set(["agent-shutdown"]),
      });
      await startRunning(harness);
      await harness.coordinator.requestEmergencyStop("sigint");
      break;
  }

  return {
    result: await harness.coordinator.completion,
    diagnostics: harness.coordinator.diagnostics(),
    safetyCleanupTrace: safetyCleanupTrace(harness.trace),
    logAttempts: harness.logAttempts,
  };
}

describe("show run coordinator", () => {
  it("rolls back a surface listener when the second registration throws", () => {
    const harness = createHarness();
    const surface = new FakeSurface(harness.trace);
    surface.registrationFailure = "surface.onDestroyed";

    expect(() => bindSurfaceForTest(harness.coordinator, surface)).toThrow(
      /fixture registration failure/i,
    );

    expect(
      harness.trace.filter(
        (entry) => entry === "dispose-surface-event-listener",
      ),
    ).toHaveLength(1);
    expect(surface.diagnostics().listeners).toBe(0);
    expect(harness.coordinator.diagnostics().counts.listeners).toBe(0);
  });

  it("publishes no surface disposer when the first registration throws", () => {
    const harness = createHarness();
    const surface = new FakeSurface(harness.trace);
    surface.registrationFailure = "surface.onEvent";

    expect(() => bindSurfaceForTest(harness.coordinator, surface)).toThrow(
      /fixture registration failure/i,
    );

    expect(
      harness.trace.filter((entry) => entry.startsWith("dispose-surface-")),
    ).toHaveLength(0);
    expect(surface.diagnostics().listeners).toBe(0);
    expect(harness.coordinator.diagnostics().counts.listeners).toBe(0);
  });

  it("rolls back a session listener when the second registration throws", () => {
    const harness = createHarness();
    const session = new FakeSession(
      1,
      harness.trace,
      async () => undefined,
      () => false,
    );
    session.registrationFailure = "session.onPrimaryCompletion";

    expect(() => bindSessionForTest(harness.coordinator, session)).toThrow(
      /fixture registration failure/i,
    );

    expect(
      harness.trace.filter(
        (entry) => entry === "dispose-session-fault-listener",
      ),
    ).toHaveLength(1);
    expect(harness.coordinator.diagnostics().counts.listeners).toBe(0);
  });

  it("publishes no session disposer when the first registration throws", () => {
    const harness = createHarness();
    const session = new FakeSession(
      1,
      harness.trace,
      async () => undefined,
      () => false,
    );
    session.registrationFailure = "session.onFault";

    expect(() => bindSessionForTest(harness.coordinator, session)).toThrow(
      /fixture registration failure/i,
    );

    expect(
      harness.trace.filter((entry) => entry.startsWith("dispose-session-")),
    ).toHaveLength(0);
    expect(harness.coordinator.diagnostics().counts.listeners).toBe(0);
  });

  it.each([
    {
      failure: "nextLoopId" as const,
      stages: ["loop-stage:nextLoopId:1"],
      rollback: [],
    },
    {
      failure: "createTelemetry" as const,
      stages: ["loop-stage:nextLoopId:1", "loop-stage:createTelemetry"],
      rollback: [],
    },
    {
      failure: "beginLoop" as const,
      stages: [
        "loop-stage:nextLoopId:1",
        "loop-stage:createTelemetry",
        "loop-stage:beginLoop",
      ],
      rollback: [],
    },
    {
      failure: "createResourceSampler" as const,
      stages: [
        "loop-stage:nextLoopId:1",
        "loop-stage:createTelemetry",
        "loop-stage:beginLoop",
        "loop-stage:createResourceSampler",
      ],
      rollback: [],
    },
    {
      failure: "session.createLoop" as const,
      stages: [
        "loop-stage:nextLoopId:1",
        "loop-stage:createTelemetry",
        "loop-stage:beginLoop",
        "loop-stage:createResourceSampler",
        "loop-stage:session.createLoop",
      ],
      rollback: ["rollback:sampler.finish"],
    },
    {
      failure: "createDriver" as const,
      stages: [
        "loop-stage:nextLoopId:1",
        "loop-stage:createTelemetry",
        "loop-stage:beginLoop",
        "loop-stage:createResourceSampler",
        "loop-stage:session.createLoop",
        "loop-stage:createDriver",
      ],
      rollback: ["rollback:runtime.stop", "rollback:sampler.finish"],
    },
    {
      failure: "driver.start-false" as const,
      stages: [
        "loop-stage:nextLoopId:1",
        "loop-stage:createTelemetry",
        "loop-stage:beginLoop",
        "loop-stage:createResourceSampler",
        "loop-stage:session.createLoop",
        "loop-stage:createDriver",
        "loop-stage:driver.start",
        "loop-stage:nextLoopId:2",
      ],
      rollback: [
        "rollback:driver.stop",
        "rollback:runtime.stop",
        "rollback:sampler.finish",
      ],
      rollbackDriverStopFailure: true,
    },
    {
      failure: "driver.start-throw" as const,
      stages: [
        "loop-stage:nextLoopId:1",
        "loop-stage:createTelemetry",
        "loop-stage:beginLoop",
        "loop-stage:createResourceSampler",
        "loop-stage:session.createLoop",
        "loop-stage:createDriver",
        "loop-stage:driver.start",
        "loop-stage:nextLoopId:2",
      ],
      rollback: [
        "rollback:driver.stop",
        "rollback:runtime.stop",
        "rollback:sampler.finish",
      ],
      rollbackDriverStopFailure: false,
    },
  ])(
    "rolls back the $failure construction stage without publishing loop state",
    async ({ failure, stages, rollback, rollbackDriverStopFailure }) => {
      const harness = createHarness({
        mode: "Show",
        loopConstructionFailure: failure,
        rollbackDriverStopFailure,
      });
      await bootReady(harness);

      let accepted: boolean | undefined;
      expect(() => {
        accepted = harness.coordinator.handleRendererEvent(startEvent());
      }).not.toThrow();
      expect(accepted).toBe(false);
      expect(
        harness.trace.filter((entry) => entry.startsWith("loop-stage:")),
      ).toEqual(stages);
      expect(
        harness.trace.filter((entry) => entry.startsWith("rollback:")),
      ).toEqual(rollback);

      const unpublished = constructionState(harness.coordinator);
      expect(unpublished.activeLoop).toBeUndefined();
      expect(unpublished.pendingNextLoop).toBeUndefined();
      expect(unpublished.driver).toBeUndefined();
      expect(harness.coordinator.diagnostics()).toMatchObject({
        currentLoopId: null,
        startedLoops: 0,
        completedLoops: 0,
        counts: { listeners: 0, timers: 0 },
      });
      expect(harness.timers.active()).toBe(0);
      expect(harness.sessions[0]).toMatchObject({
        loopId: undefined,
        loopSurface: undefined,
        reserveNextLoopId: undefined,
        primaryEditorDispatch: undefined,
      });

      await expect(harness.coordinator.completion).resolves.toEqual({
        ok: false,
        reason: "loop-start-failed",
      });
      expect(harness.evidence).toHaveLength(1);
      expect(
        harness.trace.filter((entry) => entry === "terminal:loop-start-failed"),
      ).toHaveLength(1);
      expect(harness.coordinator.diagnostics()).toMatchObject({
        state: "stopped",
        currentLoopId: null,
        startedLoops: 0,
        completedLoops: 0,
        counts: { listeners: 0, timers: 0 },
      });
    },
  );

  it.each(LOGGER_SAFETY_SCENARIOS)(
    "keeps $name safety identical when diagnostics throw",
    async ({ name, expectedLogTypes }) => {
      const baseline = await runLoggerSafetyScenario(name, () => undefined);
      const throwing = await runLoggerSafetyScenario(name, () => {
        throw new Error("fixture logger failure");
      });

      expect(baseline.logAttempts.map((event) => event.type)).toEqual(
        expect.arrayContaining(expectedLogTypes),
      );
      expect(throwing.logAttempts.length).toBeGreaterThan(0);
      expect(throwing.result).toEqual(baseline.result);
      expect(throwing.diagnostics).toEqual(baseline.diagnostics);
      expect(throwing.diagnostics.state).toBe(baseline.diagnostics.state);
      expect(throwing.diagnostics.generationId).toBe(
        baseline.diagnostics.generationId,
      );
      expect(throwing.safetyCleanupTrace).toEqual(baseline.safetyCleanupTrace);
      expect(throwing.diagnostics.counts.timers).toBe(0);
      expect(throwing.diagnostics.transitions.length).toBeLessThanOrEqual(32);
      expect(throwing.diagnostics.recoveries.length).toBeLessThanOrEqual(32);
      expect(throwing.diagnostics.shutdown.failures.length).toBeLessThanOrEqual(16);
    },
  );

  it("records reset primary dispatch before ACK completion and secondary reset without a duplicate primary endpoint", async () => {
    const harness = createHarness();
    await startRunning(harness);
    const session = harness.sessions[0]!;
    const loopId = harness.coordinator.diagnostics().currentLoopId!;
    const cue = resetCue();

    expect(session.primaryEditorDispatch).toBeTypeOf("function");

    harness.timers.now = 100;
    session.emitPrimaryEditorDispatch({ generationId: 1, loopId, cueId: cue.id, cue });
    harness.timers.now = 105;
    session.emitPrimary({
      generationId: 1,
      loopId,
      cueId: cue.id,
      bufferSha256: ORIGINAL_POEM_SHA256,
    });
    harness.timers.now = 105;
    session.loopSurface?.send({
      schema: 1,
      type: "run-cue",
      generationId: 1,
      loopId,
      requiresPresentationAck: true,
      cue,
    });
    harness.timers.now = 107;
    expect(
      harness.coordinator.handleRendererEvent({
        schema: 1,
        type: "presentation-ack",
        generationId: 1,
        loopId,
        cueId: cue.id,
      }),
    ).toBe(true);

    session.runtime.completedLoops = 1;
    session.reserveNextLoopId?.();
    harness.timers.now = 120;
    await harness.timers.fireInterval(16);
    await settle();

    expect(harness.coordinator.diagnostics()).toMatchObject({
      state: "running",
      completedLoops: 1,
    });
    expect(
      harness.logs.some(
        (event) =>
          event.type === "ignored-event" && event.reason === "primary-correlation-missing",
      ),
    ).toBe(false);
  });

  it("keeps startup strictly ordered and rejects Start until the final prepare ACK", async () => {
    const phases = [
      "validate",
      "open-secondary",
      "start-bridge",
      "launch-janvim",
      "place-janvim",
      "await-agent",
      "prepare-original",
    ] as const;
    const expectedTrace = [
      "validate",
      "open-secondary:1",
      "start-bridge:1",
      "launch-janvim:1",
      "place-janvim:1",
      "await-agent:1",
      "prepare-original:1",
      "status:ready",
    ];

    for (let index = 0; index < phases.length; index += 1) {
      const harness = createHarness({ blockedPhase: phases[index] });
      const boot = harness.coordinator.boot();
      await settle();

      expect(harness.trace).toEqual(expectedTrace.slice(0, index + 1));
      expect(harness.coordinator.diagnostics()).toMatchObject({
        state: "booting",
        generationId: 1,
        currentLoopId: null,
      });
      expect(harness.coordinator.handleRendererEvent(startEvent())).toBe(false);
      expect(harness.timers.active(16)).toBe(0);
      expect(harness.driverOptions).toHaveLength(0);

      harness.blocker?.resolve();
      await expect(boot).resolves.toEqual({ ready: true });
      expect(harness.trace).toEqual(expectedTrace);
    }
  });

  it("treats the startup network sample as a validation gate", async () => {
    const harness = createHarness({ blockedPhase: "sample-network" });
    const boot = harness.coordinator.boot();
    await settle();

    expect(harness.trace).toEqual(["validate"]);
    expect(harness.networkSamples).toBe(1);
    expect(harness.surfaces).toHaveLength(0);
    expect(harness.sessions).toHaveLength(0);
    expect(harness.coordinator.handleRendererEvent(startEvent())).toBe(false);
    expect(harness.timers.active()).toBe(0);

    harness.blocker?.resolve();
    await expect(boot).resolves.toEqual({ ready: true });
    expect(harness.trace).toEqual([
      "validate",
      "open-secondary:1",
      "start-bridge:1",
      "launch-janvim:1",
      "place-janvim:1",
      "await-agent:1",
      "prepare-original:1",
      "status:ready",
    ]);
  });

  it("holds a stable safe-ready reason and enters bounded cleanup on a wrong prepare hash", async () => {
    const harness = createHarness({ prepareHash: WRONG_POEM_SHA256 });

    await expect(harness.coordinator.boot()).resolves.toEqual({
      ready: false,
      reason: "original-poem-hash-mismatch",
    });

    expect(harness.coordinator.diagnostics()).toMatchObject({
      state: "safe-ready",
      reason: "original-poem-hash-mismatch",
      currentLoopId: null,
    });
    expect(harness.driverOptions).toHaveLength(0);
    expect(harness.timers.active(16)).toBe(0);
    expect(harness.trace).toContain("status:safe-ready");
    expect(harness.logs).toContainEqual(
      expect.objectContaining({
        type: "startup-cleanup",
        reason: "original-poem-hash-mismatch",
      }),
    );
  });

  it("starts once and bounds duplicate or out-of-context operator events", async () => {
    const harness = createHarness();
    await bootReady(harness);

    const listenerCount = harness.coordinator.diagnostics().counts.listeners;
    expect(harness.coordinator.handleRendererEvent(startEvent())).toBe(true);
    const running = harness.coordinator.diagnostics();
    expect(running).toMatchObject({
      state: "running",
      generationId: 1,
      currentLoopId: "g1-loop-1",
      startedLoops: 1,
      completedLoops: 0,
    });
    expect(harness.telemetries).toHaveLength(1);
    expect(harness.driverOptions).toHaveLength(1);
    expect(harness.driverOptions[0]).toMatchObject({
      loopDurationMs: LOOP_DURATION_MS,
      loopLimit: 3,
    });
    expect(harness.timers.active()).toBe(3);

    const unknownAck = {
      schema: 1,
      type: "presentation-ack",
      generationId: 1,
      loopId: "unknown-loop",
      cueId: "unknown-cue",
    } as const;
    for (let index = 0; index < 5; index += 1) {
      expect(harness.coordinator.handleRendererEvent(startEvent())).toBe(false);
      expect(
        harness.coordinator.handleRendererEvent({
          schema: 1,
          type: "operator-action",
          action: "restart-loop",
        }),
      ).toBe(false);
      expect(harness.coordinator.handleRendererEvent(unknownAck)).toBe(false);
    }

    expect(harness.telemetries).toHaveLength(1);
    expect(harness.driverOptions).toHaveLength(1);
    expect(harness.timers.active()).toBe(3);
    expect(harness.coordinator.diagnostics().counts.listeners).toBe(listenerCount);
    expect(
      harness.logs.filter((event) => event.type === "ignored-event"),
    ).toEqual([
      expect.objectContaining({ reason: "start-not-ready" }),
      expect.objectContaining({ reason: "restart-while-running" }),
      expect.objectContaining({ reason: "presentation-correlation-missing" }),
    ]);
  });

  it("correlates one critical cue on both endpoints using only the controller clock", async () => {
    const harness = createHarness();
    await startRunning(harness);
    const session = harness.sessions[0]!;
    const loopId = harness.coordinator.diagnostics().currentLoopId!;
    const cue = resetCue();

    harness.timers.now = 100;
    session.emitPrimaryEditorDispatch({
      generationId: 1,
      loopId,
      cueId: cue.id,
      cue,
    });

    harness.timers.now = 120;
    session.emitPrimary({
      generationId: 1,
      loopId,
      cueId: cue.id,
      bufferSha256: ORIGINAL_POEM_SHA256,
    });
    session.loopSurface?.send({
      schema: 1,
      type: "run-cue",
      generationId: 1,
      loopId,
      requiresPresentationAck: true,
      cue,
    });
    expect(harness.surfaces[0]!.sent.at(-1)).toMatchObject({
      type: "run-cue",
      generationId: 1,
      loopId,
      cue: { id: "cue-reset" },
    });

    harness.timers.now = 132;
    expect(
      harness.coordinator.handleRendererEvent({
        schema: 1,
        type: "presentation-ack",
        generationId: 1,
        loopId,
        cueId: "cue-reset",
      }),
    ).toBe(true);
    expect(session.runtime.completedLoops).toBe(0);
    expect(harness.coordinator.diagnostics().completedLoops).toBe(0);

    expect(
      harness.coordinator.handleRendererEvent({
        schema: 1,
        type: "presentation-ack",
        generationId: 1,
        loopId,
        cueId: "cue-reset",
      }),
    ).toBe(false);
    expect(
      harness.coordinator.handleRendererEvent({
        schema: 1,
        type: "presentation-ack",
        generationId: 2,
        loopId,
        cueId: "cue-reset",
      }),
    ).toBe(false);

    session.runtime.completedLoops = 1;
    session.reserveNextLoopId?.();
    harness.timers.now = 140;
    await harness.timers.fireInterval(16);
    await settle();

    expect(harness.coordinator.diagnostics().loops[0]).toMatchObject({
      loopId,
      completedPrimaryCueCount: 1,
      presentedSecondaryCueCount: 1,
      primaryCompletionLatencyMs: { count: 1, p50Ms: 20, p95Ms: 20, maxMs: 20 },
      secondaryPresentLatencyMs: { count: 1, p50Ms: 12, p95Ms: 12, maxMs: 12 },
      finalVisibleDriftMs: 12,
      resetBufferSha256: ORIGINAL_POEM_SHA256,
    });
  });

  it("gives the runtime a coordinator-owned next-loop allocator", async () => {
    const harness = createHarness({ mode: "Show" });
    await startRunning(harness);
    const session = harness.sessions[0]!;

    expect(session.reserveNextLoopId).toEqual(expect.any(Function));
    expect(session.reserveNextLoopId?.()).toBe("g1-loop-2");
    expect(session.reserveNextLoopId?.()).toBe("g1-loop-2");
    expect(harness.loopIds).toEqual(["g1-loop-1", "g1-loop-2"]);
  });

  it("commits deferred boundary evidence in loop order", async () => {
    const firstBoundary = deferred();
    const secondBoundary = deferred();
    const harness = createHarness({
      mode: "Show",
      boundaryNetworkDeferrals: [firstBoundary, secondBoundary],
    });
    await startRunning(harness);

    await completeResetBoundary(harness, 1);
    await completeResetBoundary(harness, 2);
    secondBoundary.resolve();
    await settle();
    expect(harness.coordinator.diagnostics().loops).toEqual([]);

    firstBoundary.resolve();
    await settle();
    expect(harness.coordinator.diagnostics().loops.map((loop) => loop.loopId)).toEqual([
      "g1-loop-1",
      "g1-loop-2",
    ]);
  });

  it("runs exactly three Soak3 reset boundaries and performs one normal shutdown", async () => {
    const harness = createHarness({ mode: "Soak3" });
    await startRunning(harness);

    await completeResetBoundary(harness, 1, 10);
    await completeResetBoundary(harness, 2, 20);
    await completeResetBoundary(harness, 3, 30);
    await expect(harness.coordinator.completion).resolves.toEqual({
      ok: true,
      reason: "soak-complete",
    });

    const diagnostics = harness.coordinator.diagnostics();
    expect(diagnostics).toMatchObject({
      state: "stopped",
      completedLoops: 3,
      currentLoopId: null,
      aggregate: {
        completedLoops: 3,
        cumulativeVisibleDriftMs: 60,
      },
      counts: { listeners: 0, timers: 0, connections: 0, pendingCommands: 0 },
    });
    expect(diagnostics.loops).toHaveLength(3);
    expect(diagnostics.loops.map((loop) => loop.loopId)).toEqual([
      "g1-loop-1",
      "g1-loop-2",
      "g1-loop-3",
    ]);
    expect(diagnostics.loops.map((loop) => loop.resetBufferSha256)).toEqual([
      ORIGINAL_POEM_SHA256,
      ORIGINAL_POEM_SHA256,
      ORIGINAL_POEM_SHA256,
    ]);
    expect(harness.loopIds).toHaveLength(3);
    expect(harness.driverOptions).toHaveLength(1);
    expect(harness.evidence).toHaveLength(1);
    expect(harness.networkSamples).toBe(5);

    const shutdownTrace = harness.trace.filter(
      (entry) =>
        entry.startsWith("agent-shutdown") ||
        entry.startsWith("close-window") ||
        entry.startsWith("wait-natural") ||
        entry.startsWith("close-bridge") ||
        entry === "session-dispose" ||
        entry === "surface-close" ||
        entry === "flush-logs" ||
        entry.startsWith("finalize") ||
        entry.startsWith("terminal"),
    );
    expect(shutdownTrace).toEqual([
      "agent-shutdown:2000:1",
      "close-window:2000:4096",
      "wait-natural:5000",
      "close-bridge:5000",
      "session-dispose",
      "surface-close",
      "flush-logs",
      "finalize:soak-complete",
      "terminal:soak-complete",
    ]);

    expect(harness.coordinator.handleRendererEvent(startEvent())).toBe(false);
    expect(harness.coordinator.handleRendererEvent(stopEvent())).toBe(false);
    expect(harness.driverOptions).toHaveLength(1);
  });

  it("retains bounded aggregates across 100 Show loops and queues Stop at boundary 100", async () => {
    const harness = createHarness({ mode: "Show" });
    await startRunning(harness);
    const baselineListeners = harness.coordinator.diagnostics().counts.listeners;

    for (let loopNumber = 1; loopNumber <= 100; loopNumber += 1) {
      if (loopNumber === 100) {
        expect(harness.coordinator.handleRendererEvent(stopEvent())).toBe(true);
        expect(harness.coordinator.handleRendererEvent(stopEvent())).toBe(false);
        expect(harness.coordinator.diagnostics()).toMatchObject({
          state: "running",
          stopQueued: true,
          completedLoops: 99,
        });
      }
      await completeResetBoundary(harness, loopNumber, 1);
      if (loopNumber < 100) {
        expect(harness.coordinator.diagnostics().counts.listeners).toBe(
          baselineListeners,
        );
        expect(harness.timers.active()).toBe(3);
      }
    }

    await expect(harness.coordinator.completion).resolves.toEqual({
      ok: true,
      reason: "operator-stop",
    });
    const diagnostics = harness.coordinator.diagnostics();
    expect(diagnostics.state).toBe("stopped");
    expect(diagnostics.aggregate).toMatchObject({
      completedLoops: 100,
      dispatchedCueCount: 100,
      completedPrimaryCueCount: 100,
      presentedSecondaryCueCount: 100,
      cumulativeVisibleDriftMs: 100,
      secondaryPresentLatencyMs: {
        count: 100,
        p50Ms: 1,
        p95Ms: 1,
        maxMs: 1,
      },
      primaryCompletionLatencyMs: {
        count: 100,
        p50Ms: 5,
        p95Ms: 5,
        maxMs: 5,
      },
      primaryInstantAckLatencyMs: {
        count: 100,
        p50Ms: 5,
        p95Ms: 5,
        maxMs: 5,
      },
      primaryInsertOverheadMs: {
        count: 0,
        p50Ms: null,
        p95Ms: null,
        maxMs: null,
      },
    });
    expect(diagnostics.loops.map((loop) => loop.loopId)).toEqual([
      "g1-loop-98",
      "g1-loop-99",
      "g1-loop-100",
    ]);
    expect(harness.loopIds).toHaveLength(100);
    expect(harness.driverOptions[0]?.loopLimit).toBeNull();
    expect(JSON.stringify(diagnostics)).not.toMatch(/checkpoint/i);
    expect(harness.evidence).toHaveLength(1);
  });

  it("stops immediately from ready and keeps every observed transition inside the closed model", async () => {
    const harness = createHarness({ mode: "Show" });
    expect(harness.coordinator.diagnostics()).toMatchObject({
      state: "booting",
      generationId: 1,
    });
    expect(harness.coordinator.handleRendererEvent(startEvent())).toBe(false);
    await bootReady(harness);

    expect(harness.coordinator.handleRendererEvent(stopEvent())).toBe(true);
    await expect(harness.coordinator.completion).resolves.toEqual({
      ok: true,
      reason: "operator-stop",
    });

    const diagnostics = harness.coordinator.diagnostics();
    expect(diagnostics.transitions).toEqual([
      { from: "booting", to: "ready" },
      { from: "ready", to: "shutting-down", reason: "operator-stop" },
      { from: "shutting-down", to: "stopped", reason: "operator-stop" },
    ]);
    const states = new Set([
      "booting",
      "ready",
      "running",
      "safe-cruise",
      "black-recovering",
      "safe-ready",
      "shutting-down",
      "stopped",
    ]);
    for (const transition of diagnostics.transitions) {
      expect(states.has(transition.from)).toBe(true);
      expect(states.has(transition.to)).toBe(true);
    }

    expect(harness.coordinator.handleRendererEvent(startEvent())).toBe(false);
    expect(harness.coordinator.handleRendererEvent(stopEvent())).toBe(false);
    await harness.coordinator.requestEmergencyStop("sigint");
    expect(harness.coordinator.diagnostics()).toEqual(diagnostics);
  });

  it("reaches every allowed transition through public event sources and no others", async () => {
    const observed = new Set<string>();
    const collect = (harness: ReturnType<typeof createHarness>): void => {
      for (const transition of harness.coordinator.diagnostics().transitions) {
        observed.add(`${transition.from}->${transition.to}`);
      }
    };

    const readyStop = createHarness({ mode: "Show" });
    await bootReady(readyStop);
    readyStop.coordinator.handleRendererEvent(stopEvent());
    await readyStop.coordinator.completion;
    collect(readyStop);

    const safeStop = createHarness({
      mode: "Show",
      prepareHashes: [WRONG_POEM_SHA256],
    });
    await safeStop.coordinator.boot();
    safeStop.coordinator.handleRendererEvent(stopEvent());
    await safeStop.coordinator.completion;
    collect(safeStop);

    const bootStop = createHarness({ mode: "Show", blockedPhase: "validate" });
    const blockedBoot = bootStop.coordinator.boot();
    await settle();
    const bootShutdown = bootStop.coordinator.requestEmergencyStop("sigint");
    bootStop.blocker?.resolve();
    await Promise.all([blockedBoot, bootShutdown]);
    collect(bootStop);

    const runningStop = createHarness({ mode: "Show" });
    await startRunning(runningStop);
    await runningStop.coordinator.requestEmergencyStop("sigint");
    collect(runningStop);

    const cruiseStop = createHarness({ mode: "Show" });
    await startRunning(cruiseStop);
    cruiseStop.surfaces[0]!.destroy();
    await cruiseStop.coordinator.requestEmergencyStop("sigint");
    collect(cruiseStop);

    const secondaryRecovered = createHarness({ mode: "Show" });
    await startRunning(secondaryRecovered);
    const retainedSessionId = secondaryRecovered.sessions[0]!.sessionId;
    secondaryRecovered.surfaces[0]!.destroy();
    await settle();
    await secondaryRecovered.timers.fireTimeout(1_000);
    await settle();
    expect(secondaryRecovered.coordinator.diagnostics().state).toBe("running");
    expect(secondaryRecovered.sessions).toHaveLength(1);
    expect(secondaryRecovered.sessions[0]!.sessionId).toBe(retainedSessionId);
    await secondaryRecovered.coordinator.requestEmergencyStop("sigint");
    collect(secondaryRecovered);

    const secondaryFailed = createHarness({
      mode: "Show",
      recoveryOpenFailure: true,
    });
    await startRunning(secondaryFailed);
    secondaryFailed.surfaces[0]!.destroy();
    await settle();
    await secondaryFailed.timers.fireTimeout(1_000);
    await settle();
    expect(secondaryFailed.coordinator.diagnostics().state).toBe("safe-ready");
    secondaryFailed.coordinator.handleRendererEvent(stopEvent());
    await secondaryFailed.coordinator.completion;
    collect(secondaryFailed);

    const cruiseHeld = createHarness({
      mode: "Show",
      sessionConnections: [0],
    });
    await startRunning(cruiseHeld);
    cruiseHeld.surfaces[0]!.destroy();
    await settle();
    expect(cruiseHeld.coordinator.diagnostics().state).toBe("safe-ready");
    cruiseHeld.coordinator.handleRendererEvent(stopEvent());
    await cruiseHeld.coordinator.completion;
    collect(cruiseHeld);

    const sessionRecovered = createHarness({ mode: "Show" });
    await startRunning(sessionRecovered);
    sessionRecovered.sessions[0]!.emitFault("agent-disconnected");
    await settle();
    await sessionRecovered.timers.fireTimeout(1_000);
    await settle();
    expect(sessionRecovered.coordinator.diagnostics().state).toBe("running");
    expect(sessionRecovered.sessions).toHaveLength(2);
    await sessionRecovered.coordinator.requestEmergencyStop("sigint");
    collect(sessionRecovered);

    const sessionFailed = createHarness({
      mode: "Show",
      prepareHashes: [ORIGINAL_POEM_SHA256, WRONG_POEM_SHA256],
    });
    await startRunning(sessionFailed);
    sessionFailed.sessions[0]!.emitFault("critical-ack-failed");
    await settle();
    await sessionFailed.timers.fireTimeout(1_000);
    await settle();
    expect(sessionFailed.coordinator.diagnostics().state).toBe("safe-ready");
    sessionFailed.coordinator.handleRendererEvent(stopEvent());
    await sessionFailed.coordinator.completion;
    collect(sessionFailed);

    const blackStop = createHarness({
      mode: "Show",
      recoverySessionGate: deferred(),
    });
    await startRunning(blackStop);
    blackStop.sessions[0]!.emitFault("janvim-exited");
    expect(blackStop.coordinator.diagnostics().state).toBe("black-recovering");
    await blackStop.coordinator.requestEmergencyStop("electron-quit");
    blackStop.blocker?.resolve();
    collect(blackStop);

    const operatorRestart = createHarness({
      mode: "Show",
      prepareHashes: [WRONG_POEM_SHA256, ORIGINAL_POEM_SHA256],
    });
    await operatorRestart.coordinator.boot();
    expect(
      operatorRestart.coordinator.handleRendererEvent({
        schema: 1,
        type: "operator-action",
        action: "restart-loop",
      }),
    ).toBe(true);
    await settle();
    expect(operatorRestart.coordinator.diagnostics().state).toBe("running");
    await operatorRestart.coordinator.requestEmergencyStop("sigint");
    collect(operatorRestart);

    expect([...observed].sort()).toEqual(
      [
        "booting->ready",
        "booting->safe-ready",
        "booting->shutting-down",
        "ready->running",
        "ready->shutting-down",
        "running->safe-cruise",
        "running->black-recovering",
        "running->shutting-down",
        "safe-cruise->black-recovering",
        "safe-cruise->safe-ready",
        "safe-cruise->shutting-down",
        "black-recovering->ready",
        "black-recovering->running",
        "black-recovering->safe-ready",
        "black-recovering->shutting-down",
        "safe-ready->ready",
        "safe-ready->shutting-down",
        "shutting-down->stopped",
      ].sort(),
    );
  });

  it("does not let a destroyed secondary status send prevent emergency cleanup", async () => {
    const harness = createHarness({ mode: "Show" });
    await startRunning(harness);
    const surface = harness.surfaces[0]!;
    surface.rejectStatusSends = true;

    expect(() => surface.destroy()).not.toThrow();
    expect(harness.coordinator.diagnostics().state).toBe("safe-cruise");
    await expect(harness.coordinator.requestEmergencyStop("window-close")).resolves.toBe(
      undefined,
    );
    await expect(harness.coordinator.completion).resolves.toEqual({
      ok: false,
      reason: "emergency-window-close",
    });
    expect(harness.coordinator.diagnostics().state).toBe("stopped");
    expect(harness.trace.filter((entry) => entry.startsWith("agent-shutdown"))).toEqual([
      "agent-shutdown:2000:1",
    ]);
  });

  it("shares one shutdown promise across concurrent terminal signals", async () => {
    const harness = createHarness({ mode: "Show", blockedPhase: "agent-shutdown" });
    await startRunning(harness);

    const first = harness.coordinator.requestEmergencyStop("sigint");
    const second = harness.coordinator.requestEmergencyStop("window-close");
    const third = harness.coordinator.requestEmergencyStop("electron-quit");
    await settle();
    expect(harness.coordinator.diagnostics().state).toBe("shutting-down");
    expect(harness.trace.filter((entry) => entry.startsWith("agent-shutdown"))).toEqual([
      "agent-shutdown:2000:1",
    ]);

    harness.blocker?.resolve();
    await expect(Promise.all([first, second, third])).resolves.toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    await expect(harness.coordinator.completion).resolves.toEqual({
      ok: false,
      reason: "emergency-sigint",
    });
    expect(harness.evidence).toHaveLength(1);
    expect(harness.coordinator.diagnostics().transitions.filter(
      (transition) => transition.to === "shutting-down",
    )).toHaveLength(1);
  });

  it("aborts an in-flight startup step before shutdown touches its session", async () => {
    const harness = createHarness({ mode: "Show", blockedPhase: "start-bridge" });
    const boot = harness.coordinator.boot();
    await settle();
    expect(harness.trace).toEqual([
      "validate",
      "open-secondary:1",
      "start-bridge:1",
    ]);

    const shutdown = harness.coordinator.requestEmergencyStop("sigint");
    await expect(boot).resolves.toEqual({
      ready: false,
      reason: "controller-stopping",
    });
    await expect(shutdown).resolves.toBeUndefined();
    expect(harness.sessions[0]!.abortedPhases).toEqual(["start-bridge"]);
    expect(harness.trace.indexOf("start-bridge:1")).toBeLessThan(
      harness.trace.indexOf("agent-shutdown:2000:1"),
    );
    expect(harness.coordinator.diagnostics().state).toBe("stopped");

    const stopped = harness.coordinator.diagnostics();
    harness.blocker?.resolve();
    await settle();
    expect(harness.coordinator.diagnostics()).toEqual(stopped);
  });

  it("invalidates the generation before stopping or disposing every recoverable fault", async () => {
    const faults = [
      "secondary-destroyed",
      "agent-disconnected",
      "critical-ack-failed",
      "janvim-exited",
    ] as const;

    for (const fault of faults) {
      const harness = createHarness({ mode: "Show" });
      await startRunning(harness);
      harness.trace.length = 0;

      if (fault === "secondary-destroyed") {
        harness.surfaces[0]!.destroy();
      } else {
        harness.sessions[0]!.emitFault(fault);
      }

      const lifecycle = harness.trace.filter(
        (entry) =>
          entry === "generation-invalidate" ||
          entry === "runtime-stop" ||
          entry.startsWith("dispose-surface") ||
          entry.startsWith("dispose-session") ||
          entry.startsWith("agent-shutdown") ||
          entry.startsWith("close-window") ||
          entry.startsWith("wait-natural") ||
          entry.startsWith("close-bridge"),
      );
      expect(lifecycle[0], fault).toBe("generation-invalidate");
      expect(lifecycle.indexOf("runtime-stop"), fault).toBeGreaterThan(0);
      for (const entry of lifecycle.filter((item) => item.startsWith("dispose-"))) {
        expect(lifecycle.indexOf(entry), `${fault}:${entry}`).toBeGreaterThan(
          lifecycle.indexOf("runtime-stop"),
        );
      }

      await harness.coordinator.requestEmergencyStop("sigint");
    }
  });

  it("bounds every late callback from an invalidated generation without state mutation", async () => {
    const harness = createHarness({ mode: "Show" });
    await startRunning(harness);
    const surface = harness.surfaces[0]!;
    const session = harness.sessions[0]!;
    const oldRendererEvent = surface.capturedEventListener();
    const oldDestroyed = surface.capturedDestroyedListener();
    const oldPrimary = session.capturedPrimaryListener();
    const oldFault = session.capturedFaultListener();
    const oldDriverFailure = harness.driverOptions[0]!.onFailure;
    const oldLoopId = harness.coordinator.diagnostics().currentLoopId!;
    harness.logs.length = 0;

    session.emitFault("agent-disconnected");
    const before = harness.coordinator.diagnostics();
    expect(before).toMatchObject({ state: "black-recovering", generationId: 2 });

    oldRendererEvent({
      schema: 1,
      type: "presentation-ack",
      generationId: 1,
      loopId: oldLoopId,
      cueId: "cue-reset",
    });
    oldDestroyed();
    oldPrimary({
      generationId: 1,
      loopId: oldLoopId,
      cueId: "cue-reset",
      bufferSha256: ORIGINAL_POEM_SHA256,
    });
    oldFault("janvim-exited");
    oldDriverFailure("late-retry-timer");

    expect(harness.coordinator.diagnostics()).toEqual(before);
    expect(
      harness.logs.filter(
        (event) => event.type === "ignored-event" && event.reason === "stale-generation",
      ),
    ).toHaveLength(1);

    await harness.coordinator.requestEmergencyStop("sigint");
  });

  it("recovers only the secondary after one bounded delay without replaying the old cue", async () => {
    const harness = createHarness({ mode: "Show" });
    await startRunning(harness);
    const session = harness.sessions[0]!;
    const retainedSessionId = session.sessionId;
    const oldLoopId = harness.coordinator.diagnostics().currentLoopId!;
    session.loopSurface?.send({
      schema: 1,
      type: "run-cue",
      generationId: 1,
      loopId: oldLoopId,
      requiresPresentationAck: false,
      cue: noncriticalCue("old-cue"),
    });
    harness.trace.length = 0;

    harness.surfaces[0]!.destroy();
    await settle();
    expect(harness.coordinator.diagnostics()).toMatchObject({
      state: "black-recovering",
      generationId: 2,
      currentLoopId: null,
    });
    expect(harness.surfaces).toHaveLength(1);
    expect(harness.timers.active(1_000)).toBe(1);
    expect(harness.trace.slice(0, 3)).toEqual([
      "generation-invalidate",
      "runtime-stop",
      "dispose-surface-event-listener",
    ]);
    expect(harness.trace.indexOf("surface-close")).toBeLessThan(
      harness.trace.indexOf("recovery-delay:1000"),
    );

    await harness.timers.fireTimeout(1_000);
    await settle();
    expect(harness.coordinator.diagnostics()).toMatchObject({
      state: "running",
      generationId: 2,
      currentLoopId: "g2-loop-1",
    });
    expect(harness.coordinator.diagnostics().recoveries).toEqual([
      expect.objectContaining({
        generationId: 2,
        domain: "secondary",
        attempt: 1,
        delayMs: 1_000,
        outcome: "recovered",
        reason: "secondary-recovered",
      }),
    ]);
    expect(harness.sessions).toHaveLength(1);
    expect(harness.sessions[0]!.sessionId).toBe(retainedSessionId);
    expect(harness.trace.indexOf("open-secondary:2")).toBeLessThan(
      harness.trace.indexOf("rebind-generation:2"),
    );
    expect(harness.trace.indexOf("rebind-generation:2")).toBeLessThan(
      harness.trace.indexOf("reset-original:recovery-reset-g2"),
    );
    expect(
      harness.surfaces[1]!.sent.some(
        (event) => event.type === "run-cue" && event.cue.id === "old-cue",
      ),
    ).toBe(false);

    await harness.coordinator.requestEmergencyStop("sigint");
  });

  it("escalates a bad secondary reset hash to full session replacement", async () => {
    const harness = createHarness({ mode: "Show" });
    await startRunning(harness);
    const oldSession = harness.sessions[0]!;
    oldSession.resetHash = WRONG_POEM_SHA256;

    harness.surfaces[0]!.destroy();
    await settle();
    await harness.timers.fireTimeout(1_000);
    await settle();

    expect(harness.coordinator.diagnostics().state).toBe("black-recovering");
    expect(harness.sessions).toHaveLength(1);
    expect(harness.timers.active(1_000)).toBe(1);
    expect(harness.trace).toContain("agent-shutdown:2000:1");
    expect(harness.trace).toContain("close-window:2000:4096");

    await harness.timers.fireTimeout(1_000);
    await settle();
    expect(harness.sessions).toHaveLength(2);
    expect(harness.sessions[1]!.sessionId).not.toBe(oldSession.sessionId);
    expect(harness.coordinator.diagnostics()).toMatchObject({
      state: "running",
      generationId: 2,
      currentLoopId: "g2-loop-1",
    });
    expect(harness.coordinator.diagnostics().recoveries).toEqual([
      expect.objectContaining({
        generationId: 2,
        domain: "secondary",
        attempt: 1,
        delayMs: 1_000,
        outcome: "failed",
        reason: "reset-hash-mismatch",
      }),
      expect.objectContaining({
        generationId: 2,
        domain: "janvim",
        attempt: 1,
        delayMs: 1_000,
        outcome: "recovered",
        reason: "session-recovered",
      }),
    ]);

    await harness.coordinator.requestEmergencyStop("sigint");
  });

  it("fully replaces the session for every causal JanVim fault", async () => {
    const faults = [
      "agent-disconnected",
      "critical-ack-failed",
      "janvim-exited",
      "secondary-with-editor-pending",
    ] as const;

    for (const fault of faults) {
      const harness = createHarness({ mode: "Show" });
      await startRunning(harness);
      const oldSession = harness.sessions[0]!;
      harness.trace.length = 0;

      if (fault === "secondary-with-editor-pending") {
        oldSession.editorCommandPending = true;
        harness.surfaces[0]!.destroy();
      } else {
        oldSession.emitFault(fault);
      }
      await settle();

      expect(harness.coordinator.diagnostics()).toMatchObject({
        state: "black-recovering",
        generationId: 2,
        currentLoopId: null,
      });
      expect(harness.timers.active(1_000)).toBe(1);
      expect(harness.trace).toEqual(
        expect.arrayContaining([
          "generation-invalidate",
          "runtime-stop",
          "agent-shutdown:2000:1",
          "close-window:2000:4096",
          "wait-natural:5000",
          "close-bridge:5000",
          "session-dispose",
          "recovery-delay:1000",
        ]),
      );
      expect(harness.sessions).toHaveLength(1);

      await harness.timers.fireTimeout(1_000);
      await settle();
      expect(harness.sessions).toHaveLength(2);
      expect(harness.sessions[1]!.sessionId).not.toBe(oldSession.sessionId);
      expect(harness.coordinator.diagnostics()).toMatchObject({
        state: "running",
        generationId: 2,
        currentLoopId: "g2-loop-1",
      });
      expect(harness.trace.indexOf("start-bridge:2")).toBeLessThan(
        harness.trace.indexOf("prepare-original:2"),
      );
      if (fault === "secondary-with-editor-pending") {
        expect(harness.surfaces).toHaveLength(2);
      }

      await harness.coordinator.requestEmergencyStop("sigint");
    }
  });

  it("turns every recovery driver start failure into one terminal shutdown", async () => {
    for (const failure of ["return-false", "throw"] as const) {
      const harness = createHarness({
        mode: "Show",
        runtimeStartFailures: [undefined, failure],
      });
      await startRunning(harness);

      harness.sessions[0]!.emitFault("janvim-exited");
      await settle();
      await harness.timers.fireTimeout(1_000);
      await settle();

      await expect(harness.coordinator.completion).resolves.toEqual({
        ok: false,
        reason: "loop-start-failed",
      });
      expect(harness.coordinator.diagnostics()).toMatchObject({
        state: "stopped",
        aggregate: { recoveryEventCount: 1 },
        shutdown: { requestedReason: "loop-start-failed" },
      });
      expect(harness.coordinator.diagnostics().recoveries).toEqual([
        expect.objectContaining({
          domain: "janvim",
          outcome: "failed",
          reason: "session-restart-failed",
        }),
      ]);
      expect(harness.evidence).toHaveLength(1);
    }
  });

  it("uses independent 1/2/4-second rolling recovery budgets", async () => {
    const harness = createHarness({ mode: "Show" });
    await startRunning(harness);

    for (const delayMs of [1_000, 2_000, 4_000] as const) {
      harness.sessions.at(-1)!.emitFault("janvim-exited");
      await settle();
      expect(harness.timers.active(delayMs)).toBe(1);
      await harness.timers.fireTimeout(delayMs);
      await settle();
      expect(harness.coordinator.diagnostics().state).toBe("running");
    }

    harness.surfaces.at(-1)!.destroy();
    await settle();
    expect(harness.timers.active(1_000)).toBe(1);
    await harness.timers.fireTimeout(1_000);
    await settle();
    expect(harness.coordinator.diagnostics().state).toBe("running");

    harness.sessions.at(-1)!.emitFault("janvim-exited");
    await settle();
    expect(harness.coordinator.diagnostics()).toMatchObject({
      state: "safe-ready",
      reason: "janvim-restart-limit",
      aggregate: {
        automaticRecoveryRetryCount: 2,
        recoveryEventCount: 4,
      },
    });
    expect(harness.coordinator.diagnostics().recoveries).toEqual([
      expect.objectContaining({ domain: "janvim", attempt: 1, delayMs: 1_000 }),
      expect.objectContaining({ domain: "janvim", attempt: 2, delayMs: 2_000 }),
      expect.objectContaining({ domain: "janvim", attempt: 3, delayMs: 4_000 }),
      expect.objectContaining({ domain: "secondary", attempt: 1, delayMs: 1_000 }),
    ]);
    expect(harness.coordinator.diagnostics().recoveries).toHaveLength(4);
    expect(harness.timers.active(1_000)).toBe(0);
    expect(harness.timers.active(2_000)).toBe(0);
    expect(harness.timers.active(4_000)).toBe(0);

    harness.coordinator.handleRendererEvent(stopEvent());
    await harness.coordinator.completion;

    const rolling = createHarness({ mode: "Show" });
    await startRunning(rolling);
    for (const [index, delayMs] of [1_000, 2_000, 4_000].entries()) {
      rolling.timers.now = index;
      rolling.sessions.at(-1)!.emitFault("agent-disconnected");
      await settle();
      await rolling.timers.fireTimeout(delayMs);
      await settle();
    }
    rolling.timers.now = 600_003;
    rolling.sessions.at(-1)!.emitFault("agent-disconnected");
    await settle();
    expect(rolling.coordinator.diagnostics().state).toBe("black-recovering");
    expect(rolling.timers.active(1_000)).toBe(1);
    await rolling.timers.fireTimeout(1_000);
    await settle();
    expect(rolling.coordinator.diagnostics().state).toBe("running");
    await rolling.coordinator.requestEmergencyStop("sigint");
  });

  it("retains only the latest 32 recovery events without losing aggregate totals", async () => {
    const harness = createHarness({ mode: "Show" });
    await startRunning(harness);

    for (let index = 0; index < 33; index += 1) {
      harness.timers.now = index * 600_001;
      harness.sessions.at(-1)!.emitFault("janvim-exited");
      await settle();
      await harness.timers.fireTimeout(1_000);
      await settle();
    }

    const diagnostics = harness.coordinator.diagnostics();
    expect(diagnostics.aggregate).toMatchObject({
      automaticRecoveryRetryCount: 0,
      recoveryEventCount: 33,
    });
    expect(diagnostics.recoveries).toHaveLength(32);
    expect(diagnostics.recoveries[0]).toMatchObject({ generationId: 3 });
    expect(diagnostics.recoveries.at(-1)).toMatchObject({ generationId: 34 });

    await harness.coordinator.requestEmergencyStop("sigint");
  });

  it("lets one explicit Restart Loop reset only the exhausted recovery domain", async () => {
    const options: HarnessOptions = { mode: "Show" };
    const harness = createHarness(options);
    await startRunning(harness);

    for (const delayMs of [1_000, 2_000, 4_000] as const) {
      harness.sessions.at(-1)!.emitFault("janvim-exited");
      await settle();
      await harness.timers.fireTimeout(delayMs);
      await settle();
    }
    harness.sessions.at(-1)!.emitFault("janvim-exited");
    await settle();
    expect(harness.coordinator.diagnostics()).toMatchObject({
      state: "safe-ready",
      reason: "janvim-restart-limit",
    });

    const operatorGate = deferred();
    options.recoverySessionGate = operatorGate;
    const restart = {
      schema: 1,
      type: "operator-action",
      action: "restart-loop",
    } as const;
    expect(harness.coordinator.handleRendererEvent(restart)).toBe(true);
    expect(harness.coordinator.handleRendererEvent(restart)).toBe(false);
    expect(harness.coordinator.handleRendererEvent(startEvent())).toBe(false);
    expect(harness.coordinator.diagnostics().state).toBe("safe-ready");

    operatorGate.resolve();
    await settle();
    expect(harness.coordinator.diagnostics()).toMatchObject({
      state: "running",
      generationId: 6,
      currentLoopId: "g6-loop-1",
    });

    harness.sessions.at(-1)!.emitFault("janvim-exited");
    await settle();
    expect(harness.coordinator.diagnostics().state).toBe("black-recovering");
    expect(harness.timers.active(1_000)).toBe(1);
    await harness.timers.fireTimeout(1_000);
    await settle();
    expect(harness.coordinator.diagnostics().state).toBe("running");
    await harness.coordinator.requestEmergencyStop("sigint");

    const black = createHarness({ mode: "Show" });
    await startRunning(black);
    black.sessions[0]!.emitFault("agent-disconnected");
    expect(black.coordinator.handleRendererEvent(stopEvent())).toBe(true);
    await expect(black.coordinator.completion).resolves.toEqual({
      ok: true,
      reason: "operator-stop",
    });

    const safe = createHarness({ mode: "Show", prepareHash: WRONG_POEM_SHA256 });
    await safe.coordinator.boot();
    expect(safe.coordinator.handleRendererEvent(stopEvent())).toBe(true);
    await expect(safe.coordinator.completion).resolves.toEqual({
      ok: true,
      reason: "operator-stop",
    });
  });

  it("continues the bounded shutdown ladder after every injected phase failure", async () => {
    const cases: Array<[InjectedShutdownFailure, string]> = [
      ["driver-stop", "driver-stop-failed"],
      ["agent-shutdown", "agent-shutdown-failed"],
      ["close-window", "hwnd-close-failed"],
      ["wait-natural", "wait-natural-failed"],
      ["terminate-exact", "terminate-exact-failed"],
      ["wait-forced", "wait-forced-failed"],
      ["close-bridge", "bridge-close-failed"],
      ["session-dispose", "session-dispose-failed"],
      ["session-diagnostics", "session-diagnostics-failed"],
      ["surface-close", "surface-close-failed"],
      ["network-snapshot", "network-snapshot-failed"],
      ["flush-logs", "flush-logs-failed"],
      ["finalize-evidence", "evidence-write-failed"],
      ["terminal-marker", "terminal-marker-failed"],
    ];

    for (const [phase, classification] of cases) {
      const harness = createHarness({
        mode: "Show",
        shutdownFailures: new Set([phase]),
      });
      await startRunning(harness);
      if (
        phase === "terminate-exact" ||
        phase === "wait-forced"
      ) {
        harness.sessions[0]!.naturalExit = "still-running";
      }

      await expect(
        Promise.resolve().then(() =>
          harness.coordinator.requestEmergencyStop("electron-quit"),
        ),
        phase,
      ).resolves.toBeUndefined();
      await expect(harness.coordinator.completion, phase).resolves.toEqual({
        ok: false,
        reason: "emergency-electron-quit",
      });
      const diagnostics = harness.coordinator.diagnostics();
      expect(diagnostics.state, phase).toBe("stopped");
      expect(diagnostics.shutdown.failures, phase).toContain(classification);
      expect(diagnostics.shutdown.failures.length, phase).toBeLessThanOrEqual(16);
      expect(harness.trace, phase).toContain("close-bridge:5000");
      expect(harness.trace, phase).toContain("surface-close");
      expect(harness.trace, phase).toContain("flush-logs");
      expect(
        harness.trace.some((entry) => entry.startsWith("finalize:")),
        phase,
      ).toBe(true);
      expect(
        harness.trace.some((entry) => entry.startsWith("terminal:")),
        phase,
      ).toBe(true);
    }
  });

  it("records exact forced settlement and downgrades an incomplete normal stop", async () => {
    const forced = createHarness({ mode: "Show" });
    await startRunning(forced);
    forced.sessions[0]!.naturalExit = "still-running";
    await forced.coordinator.requestEmergencyStop("sigint");
    expect(forced.trace).toEqual(
      expect.arrayContaining([
        "agent-shutdown:2000:1",
        "close-window:2000:4096",
        "wait-natural:5000",
        "terminate-exact",
        "wait-forced:5000",
        "close-bridge:5000",
      ]),
    );
    expect(forced.coordinator.diagnostics().shutdown).toMatchObject({
      failures: [],
      childSettled: true,
      leaseRemoved: true,
    });

    const unsettled = createHarness({ mode: "Show", forcedExit: false });
    await bootReady(unsettled);
    unsettled.sessions[0]!.naturalExit = "still-running";
    expect(unsettled.coordinator.handleRendererEvent(stopEvent())).toBe(true);
    await expect(unsettled.coordinator.completion).resolves.toEqual({
      ok: false,
      reason: "shutdown-incomplete",
    });
    expect(unsettled.coordinator.diagnostics().shutdown).toMatchObject({
      childSettled: false,
      leaseRemoved: false,
    });
    expect(unsettled.coordinator.diagnostics().shutdown.failures).toContain(
      "janvim-unsettled",
    );
  });

  it("suppresses faults, stale ACKs, and operator races during one shutdown", async () => {
    const harness = createHarness({ mode: "Show", blockedPhase: "agent-shutdown" });
    await startRunning(harness);
    const surface = harness.surfaces[0]!;
    const session = harness.sessions[0]!;
    const oldDestroyed = surface.capturedDestroyedListener();
    const oldEvent = surface.capturedEventListener();
    const oldFault = session.capturedFaultListener();
    const oldDriverFailure = harness.driverOptions[0]!.onFailure;
    const oldLoopId = harness.coordinator.diagnostics().currentLoopId!;

    const shutdown = harness.coordinator.requestEmergencyStop("sigint");
    const sameShutdown = harness.coordinator.requestEmergencyStop("window-close");
    expect(sameShutdown).toBe(shutdown);
    const terminalState = harness.coordinator.diagnostics();
    expect(terminalState.state).toBe("shutting-down");

    oldDestroyed();
    oldFault("janvim-exited");
    oldDriverFailure("late-retry-timer");
    oldEvent({
      schema: 1,
      type: "presentation-ack",
      generationId: 1,
      loopId: oldLoopId,
      cueId: "cue-reset",
    });
    expect(harness.coordinator.handleRendererEvent(stopEvent())).toBe(false);
    expect(
      harness.coordinator.handleRendererEvent({
        schema: 1,
        type: "operator-action",
        action: "restart-loop",
      }),
    ).toBe(false);
    await settle();

    expect(harness.coordinator.diagnostics()).toEqual(terminalState);
    expect(harness.sessions).toHaveLength(1);
    expect(harness.surfaces).toHaveLength(1);
    expect(harness.timers.active(1_000)).toBe(0);
    expect(harness.trace.filter((entry) => entry.startsWith("agent-shutdown"))).toEqual([
      "agent-shutdown:2000:1",
    ]);

    harness.blocker?.resolve();
    await expect(Promise.all([shutdown, sameShutdown])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(harness.coordinator.diagnostics().state).toBe("stopped");
    expect(harness.evidence).toHaveLength(1);
  });

  it("never relaunches while the old child or lease remains unsettled", async () => {
    for (const failures of [
      new Set<InjectedShutdownFailure>(),
      new Set<InjectedShutdownFailure>(["wait-forced"]),
    ]) {
      const harness = createHarness({
        mode: "Show",
        forcedExit: false,
        shutdownFailures: failures,
      });
      await startRunning(harness);
      harness.sessions[0]!.naturalExit = "still-running";

      harness.sessions[0]!.emitFault("janvim-exited");
      await settle();
      expect(harness.coordinator.diagnostics()).toMatchObject({
        state: "safe-ready",
        reason: "recovery-old-session-unsettled",
      });
      expect(harness.sessions).toHaveLength(1);
      expect(harness.timers.active(1_000)).toBe(0);
      expect(harness.sessions[0]!.leaseRemoved).toBe(false);

      harness.coordinator.handleRendererEvent(stopEvent());
      await harness.coordinator.completion;
    }
  });

  it("serializes recovery cleanup with a concurrent emergency shutdown", async () => {
    const harness = createHarness({ mode: "Show", blockedPhase: "agent-shutdown" });
    await startRunning(harness);
    harness.sessions[0]!.emitFault("agent-disconnected");
    await settle();
    expect(harness.trace.filter((entry) => entry.startsWith("agent-shutdown"))).toEqual([
      "agent-shutdown:2000:1",
    ]);

    const shutdown = harness.coordinator.requestEmergencyStop("sigint");
    await settle();
    expect(harness.trace.filter((entry) => entry.startsWith("agent-shutdown"))).toEqual([
      "agent-shutdown:2000:1",
    ]);

    harness.blocker?.resolve();
    await expect(shutdown).resolves.toBeUndefined();
    expect(harness.trace.filter((entry) => entry.startsWith("agent-shutdown"))).toEqual([
      "agent-shutdown:2000:1",
    ]);
    expect(harness.sessions).toHaveLength(1);
    expect(harness.coordinator.diagnostics().state).toBe("stopped");
  });

  it("bounds every unresolved recovery startup phase and aborts its side effects", async () => {
    const phases = [
      "start-bridge",
      "launch-janvim",
      "place-janvim",
      "await-agent",
      "prepare-original",
    ] as const;

    for (const phase of phases) {
      const recoveryGate = deferred();
      const harness = createHarness({
        mode: "Show",
        recoverySessionGate: recoveryGate,
        recoverySessionPhase: phase,
      });
      await startRunning(harness);

      harness.sessions[0]!.emitFault("janvim-exited");
      await settle();
      await harness.timers.fireTimeout(1_000);
      await settle();

      expect(harness.timers.active(10_000), phase).toBe(1);
      await harness.timers.fireTimeout(10_000);
      await settle();
      expect(harness.coordinator.diagnostics(), phase).toMatchObject({
        state: "safe-ready",
        reason: "session-recovery-failed",
        aggregate: { recoveryEventCount: 1 },
      });
      expect(harness.logs, phase).toContainEqual({
        type: "recovery-phase-timeout",
        phase,
        timeoutMs: 10_000,
      });
      expect(harness.sessions[1]!.abortedPhases, phase).toEqual([phase]);

      const beforeLateSettlement = harness.coordinator.diagnostics();
      recoveryGate.resolve();
      await settle();
      expect(harness.coordinator.diagnostics(), phase).toEqual(
        beforeLateSettlement,
      );

      harness.coordinator.handleRendererEvent(stopEvent());
      await harness.coordinator.completion;
    }
  });

  it("cancels an unresolved recovery phase before awaiting shutdown cleanup", async () => {
    const recoveryGate = deferred();
    const harness = createHarness({
      mode: "Show",
      recoverySessionGate: recoveryGate,
    });
    await startRunning(harness);

    harness.sessions[0]!.emitFault("janvim-exited");
    await settle();
    await harness.timers.fireTimeout(1_000);
    await settle();
    expect(harness.timers.active(10_000)).toBe(1);

    await expect(
      harness.coordinator.requestEmergencyStop("sigint"),
    ).resolves.toBeUndefined();
    expect(harness.coordinator.diagnostics().state).toBe("stopped");
    expect(harness.timers.active(10_000)).toBe(0);
    expect(harness.sessions[1]!.abortedPhases).toEqual(["start-bridge"]);

    const stopped = harness.coordinator.diagnostics();
    recoveryGate.resolve();
    await settle();
    expect(harness.coordinator.diagnostics()).toEqual(stopped);
  });

  it("keeps a failed deadline cancellation visible until its stale timer fires", async () => {
    const recoveryGate = deferred();
    const harness = createHarness({
      mode: "Show",
      recoverySessionGate: recoveryGate,
      timerClearFailure: true,
    });
    await startRunning(harness);

    harness.sessions[0]!.emitFault("janvim-exited");
    await settle();
    await harness.timers.fireTimeout(1_000);
    await settle();
    expect(harness.timers.active(10_000)).toBe(1);

    await harness.coordinator.requestEmergencyStop("sigint");
    expect(harness.coordinator.diagnostics()).toMatchObject({
      state: "stopped",
      counts: { timers: 1 },
      shutdown: {
        failures: expect.arrayContaining([
          "recovery-phase-timer-clear-failed",
        ]),
      },
    });
    expect(harness.timers.active(10_000)).toBe(1);

    const stoppedGeneration = harness.coordinator.diagnostics().generationId;
    await harness.timers.fireTimeout(10_000);
    await settle();
    expect(harness.coordinator.diagnostics()).toMatchObject({
      state: "stopped",
      generationId: stoppedGeneration,
      counts: { timers: 0 },
    });
    recoveryGate.resolve();
    await settle();
  });

  it("contains recovery driver-stop and shutdown timer-clear exceptions", async () => {
    const driverFailure = createHarness({
      mode: "Show",
      shutdownFailures: new Set(["driver-stop"]),
    });
    await startRunning(driverFailure);
    expect(() =>
      driverFailure.sessions[0]!.emitFault("critical-ack-failed"),
    ).not.toThrow();
    await settle();
    expect(driverFailure.coordinator.diagnostics().generationId).toBe(2);
    expect(driverFailure.timers.active(1_000)).toBe(1);
    await driverFailure.timers.fireTimeout(1_000);
    await settle();
    expect(driverFailure.coordinator.diagnostics().state).toBe("running");
    await driverFailure.coordinator.requestEmergencyStop("sigint");

    const timerFailure = createHarness({ mode: "Show", timerClearFailure: true });
    await startRunning(timerFailure);
    timerFailure.sessions[0]!.emitFault("agent-disconnected");
    await settle();
    expect(timerFailure.timers.active(1_000)).toBe(1);
    await expect(
      Promise.resolve().then(() =>
        timerFailure.coordinator.requestEmergencyStop("sigint"),
      ),
    ).resolves.toBeUndefined();
    expect(timerFailure.coordinator.diagnostics().shutdown.failures).toContain(
      "recovery-timer-clear-failed",
    );
    expect(timerFailure.coordinator.diagnostics().state).toBe("stopped");
  });

  it("publishes shutting-down only after generation invalidation", async () => {
    const harness = createHarness({ mode: "Show" });
    await startRunning(harness);
    await harness.coordinator.requestEmergencyStop("sigint");

    const shuttingStatus = harness.surfaces[0]!.sent.find(
      (event) => event.type === "run-status" && event.state === "shutting-down",
    );
    expect(shuttingStatus).toMatchObject({ generationId: 2 });
  });
});
