import {
  parseRendererToControllerEvent,
  type Cue,
  type RendererToControllerEvent,
  type RunCueEvent,
  type RunStatusEvent,
} from "@janvim-exhibition/show-schema";

import {
  type MultiLoopBoundary,
  type MultiLoopDriver,
  type MultiLoopDriverOptions,
} from "./multi-loop-driver.js";
import type {
  OneLoopRuntime,
  OneLoopTimerAdapter,
} from "./one-loop-driver.js";
import type {
  ResourceSampler,
  ResourceSummary,
} from "./resource-sampler.js";
import type {
  NetworkSnapshotEvidence,
  RuntimeCountEvidence,
} from "./show-run-evidence.js";
import type {
  CueCorrelation,
  LatencySummary,
  LoopTelemetrySummary,
  RunTelemetry,
} from "./run-telemetry.js";

const SHOW_LOOP_DURATION_MS = 90_000;
const MAX_RETAINED_SHOW_LOOPS = 3;
const MAX_RETAINED_NETWORK_SNAPSHOTS = 8;
const MAX_TRANSITIONS = 32;
const MAX_IGNORED_REASON_BUCKETS = 32;

export type ShowCoordinatorState =
  | "booting"
  | "ready"
  | "running"
  | "safe-cruise"
  | "black-recovering"
  | "safe-ready"
  | "shutting-down"
  | "stopped";

export type ShowRunResult =
  | { ok: true; reason: "soak-complete" | "operator-stop" }
  | { ok: false; reason: string };

export type PrimaryCueCompletionEvent = CueCorrelation & {
  bufferSha256: string;
};

export interface ShowSecondarySurface {
  readonly rendererPid: number;
  send(event: RunCueEvent | RunStatusEvent): void;
  onEvent(listener: (event: RendererToControllerEvent) => void): () => void;
  onDestroyed(listener: () => void): () => void;
  close(): void;
  diagnostics(): { listeners: number };
}

export interface ShowRunSession {
  readonly sessionId: string;
  currentGenerationId(): number;
  rebindGeneration(generationId: number): void;
  startBridge(): Promise<void>;
  launchJanVim(): Promise<void>;
  placeJanVim(): Promise<void>;
  awaitAgent(): Promise<void>;
  prepareOriginalPoem(): Promise<{ bufferSha256: string }>;
  createLoop(
    loopId: string,
    surface: ShowSecondarySurface,
    reserveNextLoopId: () => string,
  ): OneLoopRuntime;
  onFault(
    listener: (
      fault: "agent-disconnected" | "critical-ack-failed" | "janvim-exited",
    ) => void,
  ): () => void;
  onPrimaryCompletion(
    listener: (event: PrimaryCueCompletionEvent) => void,
  ): () => void;
  diagnostics(): {
    connections: number;
    pendingCommands: number;
    editorCommandPending: boolean;
  };
  resetToOriginal(loopId: string): Promise<{ bufferSha256: string }>;
  sendAgentShutdown(timeoutMs: 2_000, retryLimit: 1): Promise<void>;
  closePlacedWindow(timeoutMs: 2_000, maxOutputBytes: 4_096): Promise<void>;
  waitForJanVimExit(timeoutMs: 5_000): Promise<"natural" | "still-running">;
  terminateExactJanVim(): void;
  waitForForcedExit(timeoutMs: 5_000): Promise<boolean>;
  closeBridge(timeoutMs: 5_000): Promise<void>;
  dispose(): void;
}

export interface ShowRunCoordinatorDependencies {
  mode: "Soak3" | "Show";
  originalPoemSha256: string;
  validate(): Promise<void>;
  openSecondary(generationId: number): Promise<ShowSecondarySurface>;
  createSession(generationId: number): ShowRunSession;
  createDriver(options: MultiLoopDriverOptions): MultiLoopDriver;
  timers: OneLoopTimerAdapter;
  createTelemetry(): RunTelemetry;
  createResourceSampler(): ResourceSampler;
  sampleNetwork(): Promise<NetworkSnapshotEvidence>;
  finalizeEvidence(
    result: ShowRunResult,
    diagnostics: CoordinatorDiagnostics,
  ): Promise<void>;
  writeTerminalMarker(result: ShowRunResult): Promise<void>;
  flushLogs(): Promise<void>;
  nextLoopId(generationId: number, loopNumber: number): string;
  nowMs(): number;
  log(event: Record<string, unknown>): void;
}

export type CoordinatorTransition = {
  from: ShowCoordinatorState;
  to: ShowCoordinatorState;
  reason?: string;
};

export type CoordinatorLoopSummary = LoopTelemetrySummary & {
  generationId: number;
  resources: ResourceSummary;
  countsAtStart: RuntimeCountEvidence;
  countsAtEnd: RuntimeCountEvidence;
};

export type CoordinatorAggregate = {
  completedLoops: number;
  dispatchedCueCount: number;
  completedPrimaryCueCount: number;
  presentedSecondaryCueCount: number;
  cumulativeVisibleDriftMs: number;
  maxTickLatenessMs: number;
  maxAdvanceOverrunMs: number;
  secondaryPresentLatencyMs: LatencySummary;
  primaryCompletionLatencyMs: LatencySummary;
  primaryInstantAckLatencyMs: LatencySummary;
  primaryInsertOverheadMs: LatencySummary;
};

export type CoordinatorDiagnostics = {
  state: ShowCoordinatorState;
  generationId: number;
  reason?: string;
  currentLoopId: string | null;
  startedLoops: number;
  completedLoops: number;
  stopQueued: boolean;
  counts: RuntimeCountEvidence;
  aggregate: CoordinatorAggregate;
  loops: readonly CoordinatorLoopSummary[];
  offlineSnapshots: readonly NetworkSnapshotEvidence[];
  transitions: readonly CoordinatorTransition[];
};

const ALLOWED_TRANSITIONS: Readonly<
  Record<ShowCoordinatorState, ReadonlySet<ShowCoordinatorState>>
> = {
  booting: new Set(["ready", "safe-ready", "shutting-down"]),
  ready: new Set(["running", "shutting-down"]),
  running: new Set([
    "safe-cruise",
    "black-recovering",
    "shutting-down",
  ]),
  "safe-cruise": new Set([
    "black-recovering",
    "safe-ready",
    "shutting-down",
  ]),
  "black-recovering": new Set([
    "ready",
    "running",
    "safe-ready",
    "shutting-down",
  ]),
  "safe-ready": new Set(["ready", "shutting-down"]),
  "shutting-down": new Set(["stopped"]),
  stopped: new Set(),
};

type ActiveLoop = {
  generationId: number;
  loopId: string;
  loopNumber: number;
  telemetry: RunTelemetry;
  sampler: ResourceSampler;
  countsAtStart?: RuntimeCountEvidence;
  resetCueId?: string;
};

export class ShowRunCoordinator {
  public readonly completion: Promise<ShowRunResult>;
  private resolveCompletion!: (result: ShowRunResult) => void;
  private state: ShowCoordinatorState = "booting";
  private generationId = 1;
  private stateReason: string | undefined;
  private bootAttempted = false;
  private operatorArmed = false;
  private surface: ShowSecondarySurface | undefined;
  private session: ShowRunSession | undefined;
  private driver: MultiLoopDriver | undefined;
  private activeLoop: ActiveLoop | undefined;
  private pendingNextLoop:
    | { generationId: number; loopNumber: number; loopId: string }
    | undefined;
  private currentLoopId: string | null = null;
  private startedLoops = 0;
  private completedLoops = 0;
  private stopQueued = false;
  private recoveryInFlight = false;
  private shutdownPromise: Promise<void> | undefined;
  private startupOperation: Promise<unknown> | undefined;
  private boundaryQueue: Promise<void> = Promise.resolve();
  private readonly surfaceDisposers = new Set<() => void>();
  private readonly sessionDisposers = new Set<() => void>();
  private readonly ignoredReasonBuckets = new Set<string>();
  private readonly transitions: CoordinatorTransition[] = [];
  private readonly loops: CoordinatorLoopSummary[] = [];
  private readonly offlineSnapshots: NetworkSnapshotEvidence[] = [];
  private readonly aggregate: CoordinatorAggregate = {
    completedLoops: 0,
    dispatchedCueCount: 0,
    completedPrimaryCueCount: 0,
    presentedSecondaryCueCount: 0,
    cumulativeVisibleDriftMs: 0,
    maxTickLatenessMs: 0,
    maxAdvanceOverrunMs: 0,
    secondaryPresentLatencyMs: emptyLatencySummary(),
    primaryCompletionLatencyMs: emptyLatencySummary(),
    primaryInstantAckLatencyMs: emptyLatencySummary(),
    primaryInsertOverheadMs: emptyLatencySummary(),
  };

  public constructor(
    private readonly dependencies: ShowRunCoordinatorDependencies,
  ) {
    this.completion = new Promise<ShowRunResult>((resolve) => {
      this.resolveCompletion = resolve;
    });
  }

  public async boot(): Promise<
    { ready: true } | { ready: false; reason: string }
  > {
    if (this.bootAttempted) {
      return { ready: false, reason: "controller-already-booted" };
    }
    this.bootAttempted = true;
    const capturedGeneration = this.generationId;

    try {
      await this.runStartupOperation(() => this.dependencies.validate());
      if (!this.isBootGeneration(capturedGeneration)) {
        return { ready: false, reason: "controller-stopping" };
      }
      this.retainNetworkSnapshot(
        await this.runStartupOperation(() => this.dependencies.sampleNetwork()),
      );
      if (!this.isBootGeneration(capturedGeneration)) {
        return { ready: false, reason: "controller-stopping" };
      }

      const surface = await this.runStartupOperation(() =>
        this.dependencies.openSecondary(capturedGeneration),
      );
      if (!this.isBootGeneration(capturedGeneration)) {
        surface.close();
        return { ready: false, reason: "controller-stopping" };
      }
      this.surface = surface;
      this.bindSurface(surface, capturedGeneration);

      const session = this.dependencies.createSession(capturedGeneration);
      this.session = session;
      this.bindSession(session, capturedGeneration);
      await this.runStartupOperation(() => session.startBridge());
      if (!this.isBootGeneration(capturedGeneration)) {
        return { ready: false, reason: "controller-stopping" };
      }
      await this.runStartupOperation(() => session.launchJanVim());
      if (!this.isBootGeneration(capturedGeneration)) {
        return { ready: false, reason: "controller-stopping" };
      }
      await this.runStartupOperation(() => session.placeJanVim());
      if (!this.isBootGeneration(capturedGeneration)) {
        return { ready: false, reason: "controller-stopping" };
      }
      await this.runStartupOperation(() => session.awaitAgent());
      if (!this.isBootGeneration(capturedGeneration)) {
        return { ready: false, reason: "controller-stopping" };
      }
      const prepared = await this.runStartupOperation(() =>
        session.prepareOriginalPoem(),
      );
      if (!this.isBootGeneration(capturedGeneration)) {
        return { ready: false, reason: "controller-stopping" };
      }
      if (prepared.bufferSha256 !== this.dependencies.originalPoemSha256) {
        return await this.holdStartupFailure(
          "original-poem-hash-mismatch",
          session,
        );
      }

      this.operatorArmed = true;
      this.transition("ready");
      this.sendStatus();
      return { ready: true };
    } catch {
      if (this.state === "shutting-down" || this.state === "stopped") {
        return { ready: false, reason: "controller-stopping" };
      }
      return await this.holdStartupFailure("startup-failed", this.session);
    }
  }

  public handleRendererEvent(value: unknown): boolean {
    let event: RendererToControllerEvent;
    try {
      event = parseRendererToControllerEvent(value);
    } catch {
      this.ignore("renderer-event-invalid");
      return false;
    }
    return this.handleCurrentRendererEvent(event);
  }

  public requestEmergencyStop(
    reason: "sigint" | "window-close" | "electron-quit",
  ): Promise<void> {
    if (this.state === "stopped") return Promise.resolve();
    return this.beginShutdown({ ok: false, reason: `emergency-${reason}` });
  }

  public diagnostics(): CoordinatorDiagnostics {
    return {
      state: this.state,
      generationId: this.generationId,
      ...(this.stateReason === undefined ? {} : { reason: this.stateReason }),
      currentLoopId: this.currentLoopId,
      startedLoops: this.startedLoops,
      completedLoops: this.completedLoops,
      stopQueued: this.stopQueued,
      counts: this.runtimeCounts(),
      aggregate: cloneAggregate(this.aggregate),
      loops: this.loops.map((loop) => cloneLoopSummary(loop)),
      offlineSnapshots: this.offlineSnapshots.map((snapshot) => ({ ...snapshot })),
      transitions: this.transitions.map((transition) => ({ ...transition })),
    };
  }

  private isBootGeneration(generationId: number): boolean {
    return this.state === "booting" && this.generationId === generationId;
  }

  private async runStartupOperation<T>(action: () => Promise<T>): Promise<T> {
    const operation = action();
    this.startupOperation = operation;
    try {
      return await operation;
    } finally {
      if (this.startupOperation === operation) this.startupOperation = undefined;
    }
  }

  private async holdStartupFailure(
    reason: string,
    session: ShowRunSession | undefined,
  ): Promise<{ ready: false; reason: string }> {
    if (this.state === "booting") this.transition("safe-ready", reason);
    this.operatorArmed = true;
    this.sendStatus();
    this.dependencies.log({ type: "startup-cleanup", reason });
    if (session !== undefined) await this.cleanupHeldSession(session);
    return { ready: false, reason };
  }

  private async cleanupHeldSession(session: ShowRunSession): Promise<void> {
    await bestEffort(() => session.sendAgentShutdown(2_000, 1));
    await bestEffort(() => session.closePlacedWindow(2_000, 4_096));
    const exit = await bestEffortResult(
      () => session.waitForJanVimExit(5_000),
      "still-running" as const,
    );
    if (exit === "still-running") {
      bestEffortSync(() => session.terminateExactJanVim());
      await bestEffort(() => session.waitForForcedExit(5_000));
    }
    await bestEffort(() => session.closeBridge(5_000));
    this.disposeSessionListeners();
    bestEffortSync(() => session.dispose());
    if (this.session === session) this.session = undefined;
  }

  private bindSurface(
    surface: ShowSecondarySurface,
    generationId: number,
  ): void {
    this.disposeSurfaceListeners();
    const eventDisposer = surface.onEvent((event) => {
      if (!this.isCurrentGeneration(generationId)) {
        this.ignore("stale-generation");
        return;
      }
      this.handleCurrentRendererEvent(event);
    });
    const destroyedDisposer = surface.onDestroyed(() => {
      if (!this.isCurrentGeneration(generationId)) {
        this.ignore("stale-generation");
        return;
      }
      this.handleSecondaryDestroyed();
    });
    this.surfaceDisposers.add(eventDisposer);
    this.surfaceDisposers.add(destroyedDisposer);
  }

  private bindSession(session: ShowRunSession, generationId: number): void {
    this.disposeSessionListeners();
    const faultDisposer = session.onFault((fault) => {
      if (!this.isCurrentGeneration(generationId)) {
        this.ignore("stale-generation");
        return;
      }
      this.handleSessionFault(fault);
    });
    const primaryDisposer = session.onPrimaryCompletion((event) => {
      if (!this.isCurrentGeneration(generationId)) {
        this.ignore("stale-generation");
        return;
      }
      this.handlePrimaryCompletion(event);
    });
    this.sessionDisposers.add(faultDisposer);
    this.sessionDisposers.add(primaryDisposer);
  }

  private handleCurrentRendererEvent(event: RendererToControllerEvent): boolean {
    if (event.type === "presentation-ack") {
      return this.handlePresentationAck(event);
    }

    switch (event.action) {
      case "start":
        if (this.state !== "ready" || !this.operatorArmed) {
          this.ignore("start-not-ready");
          return false;
        }
        return this.startRun();
      case "restart-loop":
        if (this.state === "running") {
          this.ignore("restart-while-running");
          return false;
        }
        if (
          this.state !== "safe-ready" ||
          this.recoveryInFlight ||
          !this.operatorArmed
        ) {
          this.ignore("restart-not-available");
          return false;
        }
        this.recoveryInFlight = true;
        this.operatorArmed = false;
        void this.restartFromSafeReady();
        return true;
      case "stop-show":
        return this.handleStopAction();
    }
  }

  private handleStopAction(): boolean {
    if (this.state === "running") {
      if (this.stopQueued || this.driver === undefined) {
        this.ignore("stop-already-queued");
        return false;
      }
      if (!this.driver.requestStopAtBoundary()) {
        this.ignore("stop-not-queueable");
        return false;
      }
      this.stopQueued = true;
      return true;
    }
    if (
      this.state === "ready" ||
      this.state === "safe-ready" ||
      this.state === "safe-cruise" ||
      this.state === "black-recovering"
    ) {
      void this.beginShutdown({ ok: true, reason: "operator-stop" });
      return true;
    }
    this.ignore("stop-not-available");
    return false;
  }

  private startRun(): boolean {
    const surface = this.surface;
    const session = this.session;
    if (surface === undefined || session === undefined) {
      this.ignore("start-resources-missing");
      return false;
    }

    this.operatorArmed = false;
    const generationId = this.generationId;
    const active = this.createActiveLoop(1, generationId);
    const telemetrySurface = this.createTelemetrySurface(surface, generationId);
    const runtime = session.createLoop(
      active.loopId,
      telemetrySurface,
      () => this.reserveNextLoopId(generationId),
    );
    const driver = this.dependencies.createDriver({
      runtime,
      timers: this.dependencies.timers,
      clock: { nowMonotonic: () => this.dependencies.nowMs() },
      loopDurationMs: SHOW_LOOP_DURATION_MS,
      loopLimit: this.dependencies.mode === "Soak3" ? 3 : null,
      onLoopBoundary: (boundary) =>
        this.receiveLoopBoundary(generationId, boundary),
      onComplete: () => this.handleDriverComplete(generationId),
      onFailure: (reason) => this.handleDriverFailure(generationId, reason),
    });
    this.driver = driver;
    this.transition("running");
    this.sendStatus();
    if (!driver.start()) {
      this.receiveTerminalFailure("loop-start-failed");
      return false;
    }
    active.countsAtStart = this.runtimeCounts();
    return true;
  }

  private createActiveLoop(
    loopNumber: number,
    generationId: number,
    reservedLoopId?: string,
  ): ActiveLoop {
    const loopId =
      reservedLoopId ??
      this.dependencies.nextLoopId(generationId, loopNumber);
    const telemetry = this.dependencies.createTelemetry();
    telemetry.beginLoop(loopId, this.dependencies.nowMs());
    const active: ActiveLoop = {
      generationId,
      loopId,
      loopNumber,
      telemetry,
      sampler: this.dependencies.createResourceSampler(),
    };
    this.activeLoop = active;
    this.currentLoopId = loopId;
    this.startedLoops += 1;
    return active;
  }

  private reserveNextLoopId(generationId: number): string {
    const active = this.activeLoop;
    if (
      this.state !== "running" ||
      !this.isCurrentGeneration(generationId) ||
      active === undefined ||
      active.generationId !== generationId
    ) {
      throw new Error("next loop ID requested outside the active generation");
    }

    const loopNumber = active.loopNumber + 1;
    const terminalRotation =
      (this.dependencies.mode === "Soak3" && loopNumber > 3) ||
      this.stopQueued;
    if (terminalRotation) return `${active.loopId}-terminal`;

    const pending = this.pendingNextLoop;
    if (pending !== undefined) {
      if (
        pending.generationId !== generationId ||
        pending.loopNumber !== loopNumber
      ) {
        throw new Error("next loop ID reservation is inconsistent");
      }
      return pending.loopId;
    }

    const loopId = this.dependencies.nextLoopId(generationId, loopNumber);
    if (loopId.length === 0 || loopId === active.loopId) {
      throw new Error("next loop ID must be fresh and non-empty");
    }
    this.pendingNextLoop = { generationId, loopNumber, loopId };
    return loopId;
  }

  private createTelemetrySurface(
    surface: ShowSecondarySurface,
    generationId: number,
  ): ShowSecondarySurface {
    return {
      rendererPid: surface.rendererPid,
      send: (event) => {
        if (event.type === "run-cue") {
          if (!this.recordCueDispatch(event, generationId)) return;
        }
        surface.send(event);
      },
      onEvent: (listener) => surface.onEvent(listener),
      onDestroyed: (listener) => surface.onDestroyed(listener),
      close: () => surface.close(),
      diagnostics: () => surface.diagnostics(),
    };
  }

  private recordCueDispatch(event: RunCueEvent, generationId: number): boolean {
    const active = this.activeLoop;
    if (
      this.state !== "running" ||
      !this.isCurrentGeneration(generationId) ||
      event.generationId !== generationId ||
      active === undefined ||
      event.loopId !== active.loopId ||
      event.cue.id.length === 0
    ) {
      this.ignore("cue-correlation-invalid");
      return false;
    }

    const key: CueCorrelation = {
      generationId,
      loopId: active.loopId,
      cueId: event.cue.id,
    };
    const dispatchedAtMs = this.dependencies.nowMs();
    const reachesPrimary = cueReachesPrimary(event.cue);
    const reachesSecondary =
      event.requiresPresentationAck || cueReachesSecondary(event.cue);
    try {
      if (reachesPrimary) {
        active.telemetry.recordDispatch(
          "primary",
          key,
          event.cue,
          dispatchedAtMs,
        );
      }
      if (reachesSecondary) {
        active.telemetry.recordDispatch(
          "secondary",
          key,
          event.cue,
          dispatchedAtMs,
        );
      }
      if (
        event.cue.kind === "editor-action" &&
        event.cue.payload.action.type === "reset"
      ) {
        active.resetCueId = event.cue.id;
      }
      return true;
    } catch {
      this.ignore("cue-correlation-duplicate");
      return false;
    }
  }

  private handlePrimaryCompletion(event: PrimaryCueCompletionEvent): void {
    const active = this.activeLoop;
    if (
      this.state !== "running" ||
      active === undefined ||
      event.generationId !== this.generationId ||
      event.loopId !== active.loopId
    ) {
      this.ignore("primary-correlation-missing");
      return;
    }
    try {
      active.telemetry.recordPrimaryCompletion(
        event,
        this.dependencies.nowMs(),
        event.bufferSha256,
      );
    } catch {
      this.ignore("primary-correlation-missing");
    }
  }

  private handlePresentationAck(
    event: Extract<RendererToControllerEvent, { type: "presentation-ack" }>,
  ): boolean {
    const active = this.activeLoop;
    if (
      this.state !== "running" ||
      active === undefined ||
      event.generationId !== this.generationId ||
      event.loopId !== active.loopId
    ) {
      this.ignore(
        event.generationId === this.generationId
          ? "presentation-correlation-missing"
          : "stale-generation",
      );
      return false;
    }
    try {
      active.telemetry.recordSecondaryPresentation(
        event,
        this.dependencies.nowMs(),
      );
      return true;
    } catch (error) {
      this.ignore(
        error instanceof Error && /duplicate/i.test(error.message)
          ? "presentation-duplicate"
          : "presentation-correlation-missing",
      );
      return false;
    }
  }

  private receiveLoopBoundary(
    generationId: number,
    boundary: MultiLoopBoundary,
  ): void {
    if (!this.isCurrentGeneration(generationId) || this.state !== "running") {
      this.ignore("stale-generation");
      return;
    }
    try {
      const active = this.activeLoop;
      if (
        active === undefined ||
        active.generationId !== generationId ||
        active.loopNumber !== boundary.loopNumber ||
        active.resetCueId === undefined ||
        active.countsAtStart === undefined
      ) {
        throw new Error("loop boundary correlation is incomplete");
      }

      const countsAtEnd = this.runtimeCounts();
      const telemetrySummary = active.telemetry.finishLoop({
        loopId: active.loopId,
        generationId,
        resetCueId: active.resetCueId,
        expectedPoemSha256: this.dependencies.originalPoemSha256,
        endedAtMs: boundary.completedAtMs,
        tickLatenessMs: boundary.tickLatenessMs,
        advanceOverrunMs: boundary.advanceOverrunMs,
      });
      const resources = active.sampler.finish();
      const network = this.dependencies.sampleNetwork();
      this.activeLoop = undefined;
      this.updateAggregate(telemetrySummary);
      this.completedLoops = this.aggregate.completedLoops;

      const terminalBoundary =
        this.stopQueued ||
        (this.dependencies.mode === "Soak3" && boundary.loopNumber === 3);
      if (terminalBoundary) {
        this.pendingNextLoop = undefined;
        this.currentLoopId = null;
      } else {
        const pending = this.pendingNextLoop;
        if (
          pending === undefined ||
          pending.generationId !== generationId ||
          pending.loopNumber !== boundary.loopNumber + 1
        ) {
          throw new Error("next loop ID was not reserved by the runtime");
        }
        this.pendingNextLoop = undefined;
        const next = this.createActiveLoop(
          pending.loopNumber,
          generationId,
          pending.loopId,
        );
        next.countsAtStart = this.runtimeCounts();
      }

      this.boundaryQueue = this.boundaryQueue
        .then(async () => {
          const [resourceSummary, networkSnapshot] = await Promise.all([
            resources,
            network,
          ]);
          if (!this.isCurrentGeneration(generationId)) {
            this.ignore("stale-generation");
            return;
          }
          this.retainNetworkSnapshot(networkSnapshot);
          this.retainLoopSummary({
            ...telemetrySummary,
            generationId,
            resources: resourceSummary,
            countsAtStart: active.countsAtStart!,
            countsAtEnd,
          });
        })
        .catch(() => this.receiveTerminalFailure("loop-boundary-finalize-failed"));
    } catch {
      this.driver?.stop();
      this.receiveTerminalFailure("loop-boundary-invalid");
    }
  }

  private handleDriverComplete(generationId: number): void {
    if (!this.isCurrentGeneration(generationId) || this.state !== "running") {
      this.ignore("stale-generation");
      return;
    }
    const result: ShowRunResult =
      this.dependencies.mode === "Soak3" && this.completedLoops === 3
        ? { ok: true, reason: "soak-complete" }
        : this.stopQueued
          ? { ok: true, reason: "operator-stop" }
          : { ok: false, reason: "driver-completed-unexpectedly" };
    void this.boundaryQueue.then(() => this.beginShutdown(result));
  }

  private handleDriverFailure(generationId: number, reason: string): void {
    if (!this.isCurrentGeneration(generationId)) {
      this.ignore("stale-generation");
      return;
    }
    this.receiveTerminalFailure(reason);
  }

  private receiveTerminalFailure(reason: string): void {
    void this.beginShutdown({ ok: false, reason });
  }

  private handleSecondaryDestroyed(): void {
    if (this.state === "running") {
      const session = this.session;
      const oldSurface = this.surface;
      this.transition("safe-cruise", "secondary-destroyed");
      const generationId = this.invalidateActiveLoopForRecovery();
      if (session === undefined || session.diagnostics().connections !== 1) {
        void this.holdAfterSecondaryLoss(oldSurface, generationId);
      } else if (session.diagnostics().editorCommandPending) {
        this.transition("black-recovering", "secondary-editor-pending");
        this.rebindRetainedSurface(oldSurface, generationId);
        void this.recoverFullSession(session, generationId);
      } else {
        void this.recoverSecondary(session, oldSurface, generationId);
      }
    } else {
      this.ignore("secondary-destroyed-out-of-context");
    }
  }

  private handleSessionFault(
    fault: "agent-disconnected" | "critical-ack-failed" | "janvim-exited",
  ): void {
    if (this.state === "running") {
      const oldSession = this.session;
      this.transition("black-recovering", fault);
      const generationId = this.invalidateActiveLoopForRecovery();
      this.rebindRetainedSurface(this.surface, generationId);
      this.sendStatus();
      if (oldSession === undefined) {
        this.enterSafeReady("recovery-session-missing");
      } else {
        void this.recoverFullSession(oldSession, generationId);
      }
    } else {
      this.ignore("session-fault-out-of-context");
    }
  }

  private invalidateActiveLoopForRecovery(): number {
    this.incrementGeneration();
    this.disposeSurfaceListeners();
    this.disposeSessionListeners();
    this.driver?.stop();
    this.driver = undefined;
    const sampler = this.activeLoop?.sampler;
    this.activeLoop = undefined;
    this.pendingNextLoop = undefined;
    this.currentLoopId = null;
    this.stopQueued = false;
    this.operatorArmed = false;
    if (sampler !== undefined) void bestEffort(() => sampler.finish());
    return this.generationId;
  }

  private async recoverSecondary(
    session: ShowRunSession,
    oldSurface: ShowSecondarySurface | undefined,
    generationId: number,
  ): Promise<void> {
    await Promise.resolve();
    if (!this.canContinueRecovery(generationId, "safe-cruise")) return;
    this.transition("black-recovering", "secondary-recovery");
    bestEffortSync(() => oldSurface?.close());
    if (this.surface === oldSurface) this.surface = undefined;

    try {
      const surface = await this.dependencies.openSecondary(generationId);
      if (!this.canContinueRecovery(generationId, "black-recovering")) {
        bestEffortSync(() => surface.close());
        return;
      }
      this.surface = surface;
      this.bindSurface(surface, generationId);
      session.rebindGeneration(generationId);
      this.bindSession(session, generationId);
      const reset = await session.resetToOriginal(
        `recovery-reset-g${generationId}`,
      );
      if (!this.canContinueRecovery(generationId, "black-recovering")) return;
      if (reset.bufferSha256 !== this.dependencies.originalPoemSha256) {
        throw new Error("secondary recovery reset hash mismatch");
      }
      this.operatorArmed = true;
      if (!this.startRun()) this.enterSafeReady("secondary-restart-failed");
    } catch {
      if (this.canContinueRecovery(generationId, "black-recovering")) {
        this.enterSafeReady("secondary-recovery-failed");
      }
    }
  }

  private async holdAfterSecondaryLoss(
    oldSurface: ShowSecondarySurface | undefined,
    generationId: number,
  ): Promise<void> {
    await Promise.resolve();
    if (!this.canContinueRecovery(generationId, "safe-cruise")) return;
    bestEffortSync(() => oldSurface?.close());
    if (this.surface === oldSurface) this.surface = undefined;
    try {
      const surface = await this.dependencies.openSecondary(generationId);
      if (!this.canContinueRecovery(generationId, "safe-cruise")) {
        bestEffortSync(() => surface.close());
        return;
      }
      this.surface = surface;
      this.bindSurface(surface, generationId);
    } catch {
      // A missing control surface still remains a fail-closed safe-ready hold.
    }
    if (this.canContinueRecovery(generationId, "safe-cruise")) {
      this.enterSafeReady("secondary-session-unhealthy");
    }
  }

  private async recoverFullSession(
    oldSession: ShowRunSession,
    generationId: number,
  ): Promise<void> {
    await Promise.resolve();
    if (!this.canContinueRecovery(generationId, "black-recovering")) return;
    await this.cleanupHeldSession(oldSession);
    if (!this.canContinueRecovery(generationId, "black-recovering")) return;

    let session: ShowRunSession | undefined;
    try {
      session = this.dependencies.createSession(generationId);
      this.session = session;
      this.bindSession(session, generationId);
      await session.startBridge();
      if (!this.canContinueRecovery(generationId, "black-recovering")) return;
      await session.launchJanVim();
      if (!this.canContinueRecovery(generationId, "black-recovering")) return;
      await session.placeJanVim();
      if (!this.canContinueRecovery(generationId, "black-recovering")) return;
      await session.awaitAgent();
      if (!this.canContinueRecovery(generationId, "black-recovering")) return;
      const prepared = await session.prepareOriginalPoem();
      if (!this.canContinueRecovery(generationId, "black-recovering")) return;
      if (prepared.bufferSha256 !== this.dependencies.originalPoemSha256) {
        throw new Error("replacement prepare hash mismatch");
      }

      this.operatorArmed = true;
      this.transition("ready", "session-recovered");
      this.sendStatus();
      if (!this.startRun()) this.enterSafeReady("session-restart-failed");
    } catch {
      if (session !== undefined) await this.cleanupHeldSession(session);
      if (this.canContinueRecovery(generationId, "black-recovering")) {
        this.enterSafeReady("session-recovery-failed");
      }
    }
  }

  private async restartFromSafeReady(): Promise<void> {
    const oldSession = this.session;
    this.incrementGeneration();
    const generationId = this.generationId;
    this.disposeSurfaceListeners();
    this.disposeSessionListeners();
    this.rebindRetainedSurface(this.surface, generationId);
    if (oldSession !== undefined) await this.cleanupHeldSession(oldSession);
    if (!this.canContinueRecovery(generationId, "safe-ready")) return;

    let session: ShowRunSession | undefined;
    try {
      if (this.surface === undefined) {
        const surface = await this.dependencies.openSecondary(generationId);
        if (!this.canContinueRecovery(generationId, "safe-ready")) {
          bestEffortSync(() => surface.close());
          return;
        }
        this.surface = surface;
        this.bindSurface(surface, generationId);
      }
      session = this.dependencies.createSession(generationId);
      this.session = session;
      this.bindSession(session, generationId);
      await session.startBridge();
      if (!this.canContinueRecovery(generationId, "safe-ready")) return;
      await session.launchJanVim();
      if (!this.canContinueRecovery(generationId, "safe-ready")) return;
      await session.placeJanVim();
      if (!this.canContinueRecovery(generationId, "safe-ready")) return;
      await session.awaitAgent();
      if (!this.canContinueRecovery(generationId, "safe-ready")) return;
      const prepared = await session.prepareOriginalPoem();
      if (!this.canContinueRecovery(generationId, "safe-ready")) return;
      if (prepared.bufferSha256 !== this.dependencies.originalPoemSha256) {
        throw new Error("operator restart prepare hash mismatch");
      }

      this.operatorArmed = true;
      this.recoveryInFlight = false;
      this.transition("ready", "operator-restart");
      this.sendStatus();
      if (!this.startRun()) this.enterSafeReady("operator-restart-failed");
    } catch {
      if (session !== undefined) await this.cleanupHeldSession(session);
      if (this.canContinueRecovery(generationId, "safe-ready")) {
        this.stateReason = "operator-restart-failed";
        this.operatorArmed = true;
        this.recoveryInFlight = false;
        this.sendStatus();
      }
    }
  }

  private rebindRetainedSurface(
    surface: ShowSecondarySurface | undefined,
    generationId: number,
  ): void {
    if (surface !== undefined) this.bindSurface(surface, generationId);
  }

  private canContinueRecovery(
    generationId: number,
    state: ShowCoordinatorState,
  ): boolean {
    return this.isCurrentGeneration(generationId) && this.state === state;
  }

  private enterSafeReady(reason: string): void {
    if (this.state !== "safe-ready") this.transition("safe-ready", reason);
    this.stateReason = reason;
    this.operatorArmed = true;
    this.recoveryInFlight = false;
    this.sendStatus();
  }

  private beginShutdown(result: ShowRunResult): Promise<void> {
    if (this.shutdownPromise !== undefined) return this.shutdownPromise;
    if (this.state === "stopped") return Promise.resolve();

    this.transition("shutting-down", result.reason);
    this.sendStatus();
    this.operatorArmed = false;
    this.incrementGeneration();
    this.disposeSurfaceListeners();
    this.disposeSessionListeners();
    this.driver?.stop();
    this.driver = undefined;
    this.stopQueued = false;
    this.currentLoopId = null;
    this.pendingNextLoop = undefined;

    const session = this.session;
    const surface = this.surface;
    const activeSampler = this.activeLoop?.sampler;
    const startupOperation = this.startupOperation;
    this.activeLoop = undefined;

    this.shutdownPromise = (async () => {
      if (startupOperation !== undefined) {
        await bestEffort(() => startupOperation);
      }
      if (session !== undefined) {
        await session.sendAgentShutdown(2_000, 1);
        await session.closePlacedWindow(2_000, 4_096);
        const exit = await session.waitForJanVimExit(5_000);
        if (exit === "still-running") {
          session.terminateExactJanVim();
          await session.waitForForcedExit(5_000);
        }
        await session.closeBridge(5_000);
        session.dispose();
      }
      this.session = undefined;
      if (activeSampler !== undefined) await activeSampler.finish();
      if (surface !== undefined) surface.close();
      this.surface = undefined;
      this.retainNetworkSnapshot(await this.dependencies.sampleNetwork());
      await this.dependencies.flushLogs();
      await this.dependencies.finalizeEvidence(result, this.diagnostics());
      await this.dependencies.writeTerminalMarker(result);
      this.transition("stopped", result.reason);
      this.resolveCompletion(result);
    })();
    return this.shutdownPromise;
  }

  private updateAggregate(summary: LoopTelemetrySummary): void {
    this.aggregate.completedLoops += 1;
    this.aggregate.dispatchedCueCount += summary.dispatchedCueCount;
    this.aggregate.completedPrimaryCueCount += summary.completedPrimaryCueCount;
    this.aggregate.presentedSecondaryCueCount += summary.presentedSecondaryCueCount;
    this.aggregate.cumulativeVisibleDriftMs += summary.finalVisibleDriftMs;
    this.aggregate.maxTickLatenessMs = Math.max(
      this.aggregate.maxTickLatenessMs,
      summary.tickLatenessMs,
    );
    this.aggregate.maxAdvanceOverrunMs = Math.max(
      this.aggregate.maxAdvanceOverrunMs,
      summary.advanceOverrunMs,
    );
    mergeConservativeLatency(
      this.aggregate.secondaryPresentLatencyMs,
      summary.secondaryPresentLatencyMs,
    );
    mergeConservativeLatency(
      this.aggregate.primaryCompletionLatencyMs,
      summary.primaryCompletionLatencyMs,
    );
    mergeConservativeLatency(
      this.aggregate.primaryInstantAckLatencyMs,
      summary.primaryInstantAckLatencyMs,
    );
    mergeConservativeLatency(
      this.aggregate.primaryInsertOverheadMs,
      summary.primaryInsertOverheadMs,
    );
  }

  private retainLoopSummary(summary: CoordinatorLoopSummary): void {
    this.loops.push(summary);
    const limit =
      this.dependencies.mode === "Soak3" ? 3 : MAX_RETAINED_SHOW_LOOPS;
    if (this.loops.length > limit) this.loops.splice(0, this.loops.length - limit);
  }

  private retainNetworkSnapshot(snapshot: NetworkSnapshotEvidence): void {
    this.offlineSnapshots.push({ ...snapshot });
    const limit =
      this.dependencies.mode === "Soak3"
        ? 5
        : MAX_RETAINED_NETWORK_SNAPSHOTS;
    if (this.offlineSnapshots.length > limit) {
      this.offlineSnapshots.splice(0, this.offlineSnapshots.length - limit);
    }
  }

  private runtimeCounts(): RuntimeCountEvidence {
    const session = this.session?.diagnostics();
    const driverTimers = this.driver?.diagnostics().timers ?? 0;
    const samplerTimers = this.activeLoop?.sampler.diagnostics().timerCount ?? 0;
    return {
      listeners: this.surfaceDisposers.size + this.sessionDisposers.size,
      timers: driverTimers + samplerTimers,
      connections: session?.connections ?? 0,
      pendingCommands: session?.pendingCommands ?? 0,
    };
  }

  private sendStatus(): void {
    if (this.surface === undefined) return;
    const event: RunStatusEvent = {
      schema: 1,
      type: "run-status",
      generationId: this.generationId,
      state: this.state,
      ...(this.state === "safe-ready" && this.stateReason !== undefined
        ? { reason: this.stateReason }
        : {}),
    };
    bestEffortSync(() => this.surface?.send(event));
  }

  private transition(next: ShowCoordinatorState, reason?: string): void {
    if (!ALLOWED_TRANSITIONS[this.state].has(next)) {
      throw new Error(`illegal coordinator transition ${this.state} -> ${next}`);
    }
    const transition: CoordinatorTransition = {
      from: this.state,
      to: next,
      ...(reason === undefined ? {} : { reason }),
    };
    this.transitions.push(transition);
    if (this.transitions.length > MAX_TRANSITIONS) this.transitions.shift();
    this.state = next;
    this.stateReason = reason;
  }

  private isCurrentGeneration(generationId: number): boolean {
    return generationId === this.generationId;
  }

  private incrementGeneration(): void {
    if (this.generationId === Number.MAX_SAFE_INTEGER) {
      throw new Error("coordinator generation exhausted");
    }
    this.generationId += 1;
  }

  private ignore(reason: string): void {
    if (
      this.ignoredReasonBuckets.has(reason) ||
      this.ignoredReasonBuckets.size >= MAX_IGNORED_REASON_BUCKETS
    ) {
      return;
    }
    this.ignoredReasonBuckets.add(reason);
    this.dependencies.log({ type: "ignored-event", reason });
  }

  private disposeSurfaceListeners(): void {
    for (const dispose of this.surfaceDisposers) bestEffortSync(dispose);
    this.surfaceDisposers.clear();
  }

  private disposeSessionListeners(): void {
    for (const dispose of this.sessionDisposers) bestEffortSync(dispose);
    this.sessionDisposers.clear();
  }
}

function cueReachesPrimary(cue: Cue): boolean {
  return (
    cue.kind === "editor-action" ||
    cue.target === "main" ||
    cue.target === "both"
  );
}

function cueReachesSecondary(cue: Cue): boolean {
  return cue.target === "secondary" || cue.target === "both";
}

function cloneLoopSummary(summary: CoordinatorLoopSummary): CoordinatorLoopSummary {
  return {
    ...summary,
    secondaryPresentLatencyMs: { ...summary.secondaryPresentLatencyMs },
    primaryCompletionLatencyMs: { ...summary.primaryCompletionLatencyMs },
    primaryInstantAckLatencyMs: { ...summary.primaryInstantAckLatencyMs },
    primaryInsertOverheadMs: { ...summary.primaryInsertOverheadMs },
    resources: {
      controller: {
        rssBytes: { ...summary.resources.controller.rssBytes },
        handleCount: { ...summary.resources.controller.handleCount },
      },
      renderer: {
        rssBytes: { ...summary.resources.renderer.rssBytes },
        handleCount: { ...summary.resources.renderer.handleCount },
      },
      janvim: {
        rssBytes: { ...summary.resources.janvim.rssBytes },
        handleCount: { ...summary.resources.janvim.handleCount },
      },
      sampleIncomplete: summary.resources.sampleIncomplete,
    },
    countsAtStart: { ...summary.countsAtStart },
    countsAtEnd: { ...summary.countsAtEnd },
  };
}

function emptyLatencySummary(): LatencySummary {
  return { count: 0, p50Ms: null, p95Ms: null, maxMs: null };
}

function mergeConservativeLatency(
  aggregate: LatencySummary,
  loop: LatencySummary,
): void {
  aggregate.count += loop.count;
  aggregate.p50Ms = maxNullable(aggregate.p50Ms, loop.p50Ms);
  aggregate.p95Ms = maxNullable(aggregate.p95Ms, loop.p95Ms);
  aggregate.maxMs = maxNullable(aggregate.maxMs, loop.maxMs);
}

function maxNullable(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}

function cloneAggregate(aggregate: CoordinatorAggregate): CoordinatorAggregate {
  return {
    ...aggregate,
    secondaryPresentLatencyMs: { ...aggregate.secondaryPresentLatencyMs },
    primaryCompletionLatencyMs: { ...aggregate.primaryCompletionLatencyMs },
    primaryInstantAckLatencyMs: { ...aggregate.primaryInstantAckLatencyMs },
    primaryInsertOverheadMs: { ...aggregate.primaryInsertOverheadMs },
  };
}

async function bestEffort(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch {
    // Task 9 classifies each bounded cleanup failure; Task 8 must still advance.
  }
}

async function bestEffortResult<T>(
  action: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await action();
  } catch {
    return fallback;
  }
}

function bestEffortSync(action: () => unknown): void {
  try {
    action();
  } catch {
    // Cleanup remains best effort and finite.
  }
}
