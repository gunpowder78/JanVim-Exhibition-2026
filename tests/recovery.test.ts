import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type {
  Cue,
  RendererToControllerEvent,
  RunCueEvent,
  RunStatusEvent,
} from "@janvim-exhibition/show-schema";
import { MultiLoopDriver } from "../apps/controller/src/multi-loop-driver.ts";
import type {
  OneLoopRuntime,
  OneLoopTimerAdapter,
  OneLoopTimerHandle,
} from "../apps/controller/src/one-loop-driver.ts";
import { ResourceSampler } from "../apps/controller/src/resource-sampler.ts";
import { RunTelemetry } from "../apps/controller/src/run-telemetry.ts";
import { parseShowCommand } from "../apps/controller/src/show-command.ts";
import {
  ShowRunCoordinator,
  type PrimaryCueCompletionEvent,
  type ShowRunCoordinatorDependencies,
  type ShowRunSession,
  type ShowSecondarySurface,
} from "../apps/controller/src/show-run-coordinator.ts";
import { parseShowRunEvidence } from "../apps/controller/src/show-run-evidence.ts";
import { RestartBudget } from "../apps/controller/src/supervisor.ts";

const repositoryRoot = process.cwd();
const runbookPath = join(repositoryRoot, "docs", "operations", "rehearsal-runbook.md");
const incidentTemplatePath = join(
  repositoryRoot,
  "docs",
  "operations",
  "incident-log-template.md",
);
const originalPoemSha256 = "a".repeat(64);

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

function resetCue(): Cue {
  return {
    id: "reset",
    atMs: 90_000,
    target: "both",
    kind: "editor-action",
    payload: {
      action: { type: "reset" },
      displayKeys: ["Esc"],
      semanticLabel: "return to original poem",
      critical: true,
    },
  };
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

async function completeLoop(
  host: ReturnType<typeof createHost>,
  loopNumber: number,
  driftMs: number,
): Promise<void> {
  const diagnostics = host.coordinator.diagnostics();
  const loopId = diagnostics.currentLoopId;
  const session = host.sessions.at(-1);
  if (loopId === null || session?.loopSurface === undefined) throw new Error("active loop is missing");
  const generationId = diagnostics.generationId;
  host.clock.now = loopNumber * 1_000;
  session.loopSurface.send({
    schema: 1,
    type: "run-cue",
    generationId,
    loopId,
    requiresPresentationAck: true,
    cue: resetCue(),
  });
  host.clock.now += 5;
  session.emitPrimary({ generationId, loopId, cueId: "reset", bufferSha256: originalPoemSha256 });
  host.clock.now += driftMs;
  expect(host.coordinator.handleRendererEvent({
    schema: 1,
    type: "presentation-ack",
    generationId,
    loopId,
    cueId: "reset",
  })).toBe(true);
  session.runtime.completedLoops = loopNumber;
  session.reserveNextLoopId?.();
  host.clock.now += 20;
  await host.clock.fireInterval(16);
  await settle();
}

function strictEvidenceAtDrift(cumulativeVisibleDriftMs: number): unknown {
  const hashA = "b".repeat(64);
  const hashB = "c".repeat(64);
  const hashC = "d".repeat(64);
  const latency = (count: number, p50Ms: number, p95Ms: number, maxMs: number) => ({
    count,
    p50Ms,
    p95Ms,
    maxMs,
  });
  const scalar = { count: 2, min: 100, max: 120, final: 110 };
  const loop = (index: number, finalVisibleDriftMs: number) => ({
    loopId: `loop-${index}`,
    startedAtMs: (index - 1) * 90_000,
    endedAtMs: index * 90_000,
    dispatchedCueCount: 4,
    completedPrimaryCueCount: 3,
    presentedSecondaryCueCount: 3,
    secondaryPresentLatencyMs: latency(3, 20, 40, 50),
    primaryCompletionLatencyMs: latency(3, 45, 1_300, 1_300),
    primaryInstantAckLatencyMs: latency(2, 30, 50, 50),
    primaryInsertOverheadMs: latency(1, 60, 60, 60),
    finalVisibleDriftMs,
    resetBufferSha256: originalPoemSha256,
    tickLatenessMs: 4,
    advanceOverrunMs: 2,
    generationId: index,
    retryCount: index === 2 ? 1 : 0,
    skipCount: 0,
    recoveryCount: index === 2 ? 1 : 0,
    resources: {
      controller: { rssBytes: scalar, handleCount: scalar },
      renderer: { rssBytes: scalar, handleCount: scalar },
      janvim: { rssBytes: scalar, handleCount: scalar },
      sampleIncomplete: false,
    },
    countsAtStart: { listeners: 4, timers: 2, connections: 1, pendingCommands: 0 },
    countsAtEnd: { listeners: 4, timers: 2, connections: 1, pendingCommands: 0 },
  });
  return {
    schema: 1,
    runId: "recovery-001",
    controllerRunId: "recovery-controller-001",
    mode: "Soak3",
    acceptanceScope: "monitor-simulation",
    physicalProjectorsTested: false,
    display: {
      mapSha256: hashA,
      primary: {
        id: "111",
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workingArea: { x: 0, y: 0, width: 1920, height: 1040 },
        scaleFactor: 1,
        rotation: 0,
        geometrySha256: "b2bc82d7bea454184acfb21ae9139e97c32aefb994443034423653e85f9c83cc",
      },
      secondary: {
        id: "222",
        bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
        workingArea: { x: 1920, y: 0, width: 1920, height: 1040 },
        scaleFactor: 1,
        rotation: 0,
        geometrySha256: "2ebac5faac6c5f34562d1e91088736c9e70943c9c42846616a418db904319928",
      },
    },
    artifact: {
      tag: "v0.10.1-gmk.4",
      commit: "e95633101d93f8448b0f906e918b5d836ab95273",
      layoutEngine: "orthogonal",
      lockSha256: hashB,
      coreBytes: 18_866_688,
      coreSha256: "224b3457d89fbc6cf946359683632f29f9262bae08b6f0d2e3043a3a7a6d83b3",
    },
    content: {
      revision: "20260829-0001",
      manifestBytes: 4096,
      manifestSha256: hashC,
      poemBytes: 2048,
      poemSha256: originalPoemSha256,
      configSha256: hashA,
      mediaManifest: { present: false },
    },
    offlineSnapshots: [0, 90_000, 180_000, 270_000, 270_100].map((sampledAtMs) => ({
      sampledAtMs,
      activeExternalDefaultRoutes: 0,
      connectedExternalProfiles: 0,
      offline: true,
    })),
    offlineVerified: true,
    loops: [loop(1, cumulativeVisibleDriftMs), loop(2, 0), loop(3, 0)],
    aggregate: {
      completedLoops: 3,
      offlineSampleCount: 5,
      onlineSampleCount: 0,
      totalRetries: 1,
      totalSkips: 0,
      totalRecoveries: 1,
      cumulativeVisibleDriftMs,
      secondaryPresentLatencyMs: latency(9, 20, 60, 70),
      primaryCompletionLatencyMs: latency(9, 50, 1_500, 1_500),
      primaryInstantAckLatencyMs: latency(6, 30, 55, 60),
      primaryInsertOverheadMs: latency(3, 60, 70, 80),
      acceptanceOutcome: "pass",
    },
    recoveries: [{
      generationId: 2,
      domain: "secondary",
      attempt: 1,
      delayMs: 1_000,
      outcome: "recovered",
      reason: "renderer-exit",
    }],
    shutdown: {
      requestedBy: "soak-complete",
      agentShutdown: "acknowledged",
      hwndClose: "posted",
      janvimExit: "natural",
      bridgeClose: "closed",
      leaseRemoved: true,
    },
    loggingIncomplete: false,
    operatorNotes: ["Offline monitor rehearsal."],
  };
}

describe("Task 9 recovery operations", () => {
  it("requires bounded, observable operator documents", () => {
    const runbook = readFileSync(runbookPath, "utf8");
    const incidentTemplate = readFileSync(incidentTemplatePath, "utf8");

    for (const section of [
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
    ]) {
      expect(runbook).toContain(`## ${section}`);
    }

    for (const field of [
      "Maximum events: 32",
      "Maximum bytes per note: 4096",
      "Run ID",
      "Controller run ID",
      "Generation ID",
      "Monotonic timestamp",
      "Wall timestamp",
      "Mode/state",
      "Exact process identities",
      "Fault/retry/domain",
      "Offline snapshot",
      "Artifact/content/display hashes",
      "Operator action",
      "Recovery result",
      "Media hashes",
      "Follow-up owner",
      "Independent photo/video backup path",
      "SHA-256",
    ]) {
      expect(incidentTemplate).toContain(field);
    }

    expect(incidentTemplate).toMatch(/secrets.*not recorded/is);
    expect(incidentTemplate).toMatch(/poem text.*not recorded/is);
    expect(incidentTemplate).toMatch(/user config paths.*not recorded/is);
    expect(incidentTemplate).toMatch(/arbitrary shell commands.*not recorded/is);
    expect(incidentTemplate).not.toMatch(/bridge token/i);
    expect(incidentTemplate).not.toMatch(/keyboard injection/i);
    expect(incidentTemplate).not.toMatch(/title matching/i);
    expect(incidentTemplate).not.toMatch(/source-repository mutation/i);
    for (const forbiddenField of [
      "Bridge token",
      "Arbitrary command",
      "Keyboard injection",
      "Title matching",
      "User config path",
      "Source-repository mutation",
    ]) {
      expect(incidentTemplate).not.toContain(`| ${forbiddenField} |`);
    }
  });

  it("composes the strict dispatcher, fake-clock Soak3, telemetry, resources, and evidence threshold", async () => {
    const host = createHost();
    await bootAndStart(host);

    await completeLoop(host, 1, 83);
    await completeLoop(host, 2, 83);
    await completeLoop(host, 3, 83);

    await expect(host.coordinator.completion).resolves.toEqual({ ok: true, reason: "soak-complete" });
    const diagnostics = host.coordinator.diagnostics();
    expect(diagnostics).toMatchObject({
      state: "stopped",
      completedLoops: 3,
      aggregate: { cumulativeVisibleDriftMs: 249 },
      counts: { listeners: 0, timers: 0, connections: 0, pendingCommands: 0 },
    });
    expect(diagnostics.loops.map((loop) => loop.resetBufferSha256)).toEqual([
      originalPoemSha256,
      originalPoemSha256,
      originalPoemSha256,
    ]);
    expect(diagnostics.loops.every((loop) => loop.resources.controller.rssBytes.count > 0)).toBe(true);
    expect(diagnostics.offlineSnapshots.every((snapshot) => snapshot.offline)).toBe(true);
    expect(host.evidence).toHaveLength(1);
    expect(host.terminalWrites).toBe(1);

    expect(parseShowRunEvidence(strictEvidenceAtDrift(249)).aggregate.acceptanceOutcome).toBe("pass");
    expect(() => parseShowRunEvidence(strictEvidenceAtDrift(250))).toThrow();

    const budget = new RestartBudget();
    expect([budget.reserve(0), budget.reserve(1), budget.reserve(2)]).toEqual([
      { allowed: true, attempt: 1, delayMs: 1_000 },
      { allowed: true, attempt: 2, delayMs: 2_000 },
      { allowed: true, attempt: 3, delayMs: 4_000 },
    ]);
    expect(budget.reserve(3)).toEqual({ allowed: false, reason: "restart-limit" });
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

  it("fully replaces causal JanVim faults and reaches safe-ready after the fourth bounded failure", async () => {
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

    const host = createHost({ mode: "Show" });
    await bootAndStart(host);
    for (const delayMs of [1_000, 2_000, 4_000] as const) {
      host.sessions.at(-1)!.emitFault("janvim-exited");
      await settle();
      await host.clock.fireTimeout(delayMs);
      await settle();
      expect(host.coordinator.diagnostics().state).toBe("running");
    }
    host.sessions.at(-1)!.emitFault("janvim-exited");
    await settle();
    expect(host.coordinator.diagnostics()).toMatchObject({
      state: "safe-ready",
      reason: "janvim-restart-limit",
      recoveries: [
        expect.objectContaining({ delayMs: 1_000 }),
        expect.objectContaining({ delayMs: 2_000 }),
        expect.objectContaining({ delayMs: 4_000 }),
      ],
    });
    await host.coordinator.requestEmergencyStop("sigint");
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

    const host = createHost({ mode: "Show" });
    await bootAndStart(host);
    for (let loopNumber = 1; loopNumber <= 100; loopNumber += 1) {
      if (loopNumber === 100) {
        expect(host.coordinator.handleRendererEvent({ schema: 1, type: "operator-action", action: "stop-show" })).toBe(true);
      }
      await completeLoop(host, loopNumber, 1);
    }
    await expect(host.coordinator.completion).resolves.toEqual({ ok: true, reason: "operator-stop" });
    const diagnostics = host.coordinator.diagnostics();
    expect(diagnostics).toMatchObject({
      state: "stopped",
      aggregate: { completedLoops: 100, cumulativeVisibleDriftMs: 100 },
      counts: { listeners: 0, timers: 0, connections: 0, pendingCommands: 0 },
    });
    expect(diagnostics.loops).toHaveLength(3);
    expect(JSON.stringify(diagnostics)).not.toMatch(/rssSamples|acknowledg(e)?ments/i);
    expect(host.evidence).toHaveLength(1);
    expect(host.terminalWrites).toBe(1);
    expect(diagnostics.offlineSnapshots.every((snapshot) => snapshot.offline)).toBe(true);
    expect(host.logs.some((event) => /dns|http|https|ws|wss/i.test(JSON.stringify(event)))).toBe(false);
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
