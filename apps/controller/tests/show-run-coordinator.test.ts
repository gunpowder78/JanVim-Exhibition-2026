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
    return entry.id;
  }

  public clearTimeout(id: OneLoopTimerHandle): void {
    if (typeof id === "number") this.timeouts.delete(id);
  }

  public async fireInterval(delayMs: number): Promise<void> {
    const entry = [...this.intervals.values()].find(
      (candidate) => candidate.delayMs === delayMs,
    );
    if (entry === undefined) throw new Error(`no interval scheduled at ${delayMs} ms`);
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
  private readonly eventListeners = new Set<
    (event: RendererToControllerEvent) => void
  >();
  private readonly destroyedListeners = new Set<() => void>();

  public constructor(private readonly trace: string[]) {}

  public send(event: RunCueEvent | RunStatusEvent): void {
    if (this.rejectStatusSends && event.type === "run-status") {
      throw new Error("renderer is already destroyed");
    }
    this.sent.push(event);
    if (event.type === "run-status") this.trace.push(`status:${event.state}`);
  }

  public onEvent(listener: (event: RendererToControllerEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  public onDestroyed(listener: () => void): () => void {
    this.destroyedListeners.add(listener);
    return () => this.destroyedListeners.delete(listener);
  }

  public emit(event: RendererToControllerEvent): void {
    for (const listener of [...this.eventListeners]) listener(event);
  }

  public destroy(): void {
    for (const listener of [...this.destroyedListeners]) listener();
  }

  public close(): void {
    this.closeCalls += 1;
    this.trace.push("surface-close");
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
  public editorCommandPending = false;
  public connections = 1;
  public naturalExit: "natural" | "still-running" = "natural";
  public forcedExit = true;
  public prepareHash = ORIGINAL_POEM_SHA256;
  public resetHash = ORIGINAL_POEM_SHA256;
  private generationId: number;
  private readonly faultListeners = new Set<
    (fault: "agent-disconnected" | "critical-ack-failed" | "janvim-exited") => void
  >();
  private readonly primaryListeners = new Set<
    (event: PrimaryCueCompletionEvent) => void
  >();

  public constructor(
    generationId: number,
    private readonly trace: string[],
    private readonly block: (phase: string) => Promise<void>,
  ) {
    this.generationId = generationId;
    this.sessionId = `session-${generationId}`;
    this.runtime = {
      state: "ready",
      completedLoops: 0,
      start: vi.fn(() => {
        this.runtime.state = "running";
        return true;
      }),
      advance: vi.fn(async () => 0),
      stop: vi.fn(() => {
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

  public async startBridge(): Promise<void> {
    this.trace.push(`start-bridge:${this.generationId}`);
    await this.block("start-bridge");
  }

  public async launchJanVim(): Promise<void> {
    this.trace.push(`launch-janvim:${this.generationId}`);
    await this.block("launch-janvim");
  }

  public async placeJanVim(): Promise<void> {
    this.trace.push(`place-janvim:${this.generationId}`);
    await this.block("place-janvim");
  }

  public async awaitAgent(): Promise<void> {
    this.trace.push(`await-agent:${this.generationId}`);
    await this.block("await-agent");
  }

  public async prepareOriginalPoem(): Promise<{ bufferSha256: string }> {
    this.trace.push(`prepare-original:${this.generationId}`);
    await this.block("prepare-original");
    return { bufferSha256: this.prepareHash };
  }

  public createLoop(
    loopId: string,
    surface: ShowSecondarySurface,
    reserveNextLoopId?: () => string,
  ): OneLoopRuntime {
    this.loopId = loopId;
    this.loopSurface = surface;
    this.reserveNextLoopId = reserveNextLoopId;
    return this.runtime;
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

  public emitPrimary(event: PrimaryCueCompletionEvent): void {
    for (const listener of [...this.primaryListeners]) listener(event);
  }

  public emitFault(
    fault: "agent-disconnected" | "critical-ack-failed" | "janvim-exited",
  ): void {
    for (const listener of [...this.faultListeners]) listener(fault);
  }

  public diagnostics(): {
      connections: number;
    pendingCommands: number;
    editorCommandPending: boolean;
  } {
    return {
      connections: this.connections,
      pendingCommands: Number(this.editorCommandPending),
      editorCommandPending: this.editorCommandPending,
    };
  }

  public async resetToOriginal(loopId: string): Promise<{ bufferSha256: string }> {
    this.trace.push(`reset-original:${loopId}`);
    return { bufferSha256: this.resetHash };
  }

  public async sendAgentShutdown(timeoutMs: 2_000, retryLimit: 1): Promise<void> {
    this.trace.push(`agent-shutdown:${timeoutMs}:${retryLimit}`);
    await this.block("agent-shutdown");
  }

  public async closePlacedWindow(
    timeoutMs: 2_000,
    maxOutputBytes: 4_096,
  ): Promise<void> {
    this.trace.push(`close-window:${timeoutMs}:${maxOutputBytes}`);
  }

  public async waitForJanVimExit(
    timeoutMs: 5_000,
  ): Promise<"natural" | "still-running"> {
    this.trace.push(`wait-natural:${timeoutMs}`);
    return this.naturalExit;
  }

  public terminateExactJanVim(): void {
    this.trace.push("terminate-exact");
  }

  public async waitForForcedExit(timeoutMs: 5_000): Promise<boolean> {
    this.trace.push(`wait-forced:${timeoutMs}`);
    return this.forcedExit;
  }

  public async closeBridge(timeoutMs: 5_000): Promise<void> {
    this.trace.push(`close-bridge:${timeoutMs}`);
  }

  public dispose(): void {
    this.trace.push("session-dispose");
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
  sessionConnections?: number[];
}

function createHarness(options: HarnessOptions = {}) {
  const trace: string[] = [];
  const logs: Array<Record<string, unknown>> = [];
  const timers = new FakeTimers();
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
    openSecondary: async (generationId) => {
      trace.push(`open-secondary:${generationId}`);
      const recoveryOpen = surfaces.length > 0;
      if (recoveryOpen) await options.recoveryOpenGate?.promise;
      if (recoveryOpen && options.recoveryOpenFailure === true) {
        throw new Error("injected secondary recovery failure");
      }
      const surface = new FakeSurface(trace);
      surfaces.push(surface);
      await block("open-secondary");
      return surface;
    },
    createSession: (generationId) => {
      const sessionIndex = sessions.length;
      const session = new FakeSession(generationId, trace, async (phase) => {
        await block(phase);
        if (sessionIndex > 0 && phase === "start-bridge") {
          await options.recoverySessionGate?.promise;
        }
      });
      session.prepareHash =
        options.prepareHashes?.[sessionIndex] ??
        options.prepareHash ??
        ORIGINAL_POEM_SHA256;
      session.connections = options.sessionConnections?.[sessionIndex] ?? 1;
      sessions.push(session);
      return session;
    },
    createDriver: (driverOptionsInput) => {
      driverOptions.push(driverOptionsInput);
      const driver = new MultiLoopDriver(driverOptionsInput);
      drivers.push(driver);
      return driver;
    },
    timers,
    createTelemetry: () => {
      const telemetry = new RunTelemetry();
      telemetries.push(telemetry);
      return telemetry;
    },
    createResourceSampler: () => {
      const sampler = new ResourceSampler({
        adapter: {
          sample: async (pid) => ({ rssBytes: pid * 1_000, handleCount: pid }),
        },
        timers,
      });
      sampler.start({ controller: 11, renderer: 22, janvim: 33 });
      samplers.push(sampler);
      return sampler;
    },
    sampleNetwork: async () => {
      networkSamples += 1;
      if (networkSamples === 1) await block("sample-network");
      if (networkSamples > 1) {
        await options.boundaryNetworkDeferrals?.[networkSamples - 2]?.promise;
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
      evidence.push({ result, diagnostics });
    },
    writeTerminalMarker: async (result) => {
      trace.push(`terminal:${result.reason}`);
    },
    flushLogs: async () => {
      trace.push("flush-logs");
    },
    nextLoopId: (generationId, loopNumber) => {
      const loopId = `g${generationId}-loop-${loopNumber}`;
      loopIds.push(loopId);
      return loopId;
    },
    nowMs: () => timers.now,
    log: (event) => logs.push(event),
  };

  const coordinator = new ShowRunCoordinator(dependencies);
  return {
    coordinator,
    trace,
    logs,
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
  session.loopSurface.send({
    schema: 1,
    type: "run-cue",
    generationId,
    loopId,
    requiresPresentationAck: true,
    cue: resetCue(),
  });

  harness.timers.now = dispatchedAtMs + 5;
  session.emitPrimary({
    generationId,
    loopId,
    cueId: "cue-reset",
    bufferSha256: ORIGINAL_POEM_SHA256,
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

describe("show run coordinator", () => {
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

    harness.timers.now = 100;
    session.loopSurface?.send({
      schema: 1,
      type: "run-cue",
      generationId: 1,
      loopId,
      requiresPresentationAck: true,
      cue: resetCue(),
    });
    expect(harness.surfaces[0]!.sent.at(-1)).toMatchObject({
      type: "run-cue",
      generationId: 1,
      loopId,
      cue: { id: "cue-reset" },
    });

    harness.timers.now = 112;
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

    harness.timers.now = 120;
    session.emitPrimary({
      generationId: 1,
      loopId,
      cueId: "cue-reset",
      bufferSha256: ORIGINAL_POEM_SHA256,
    });
    session.runtime.completedLoops = 1;
    session.reserveNextLoopId?.();
    harness.timers.now = 130;
    await harness.timers.fireInterval(16);
    await settle();

    expect(harness.coordinator.diagnostics().loops[0]).toMatchObject({
      loopId,
      completedPrimaryCueCount: 1,
      presentedSecondaryCueCount: 1,
      primaryCompletionLatencyMs: { count: 1, p50Ms: 20, p95Ms: 20, maxMs: 20 },
      secondaryPresentLatencyMs: { count: 1, p50Ms: 12, p95Ms: 12, maxMs: 12 },
      finalVisibleDriftMs: 8,
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
        p50Ms: 6,
        p95Ms: 6,
        maxMs: 6,
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

  it("lets an in-flight bounded startup step retire before shutdown touches its session", async () => {
    const harness = createHarness({ mode: "Show", blockedPhase: "start-bridge" });
    const boot = harness.coordinator.boot();
    await settle();
    expect(harness.trace).toEqual([
      "validate",
      "open-secondary:1",
      "start-bridge:1",
    ]);

    const shutdown = harness.coordinator.requestEmergencyStop("sigint");
    await settle();
    expect(harness.coordinator.diagnostics().state).toBe("shutting-down");
    expect(harness.trace).not.toContain("agent-shutdown:2000:1");

    harness.blocker?.resolve();
    await expect(boot).resolves.toEqual({
      ready: false,
      reason: "controller-stopping",
    });
    await expect(shutdown).resolves.toBeUndefined();
    expect(harness.trace.indexOf("start-bridge:1")).toBeLessThan(
      harness.trace.indexOf("agent-shutdown:2000:1"),
    );
    expect(harness.coordinator.diagnostics().state).toBe("stopped");
  });
});
