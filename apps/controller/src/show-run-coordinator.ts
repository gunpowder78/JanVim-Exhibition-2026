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
  OneLoopTimerHandle,
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
import { RestartBudget } from "./supervisor.js";

const SHOW_LOOP_DURATION_MS = 90_000;
const RECOVERY_PHASE_TIMEOUT_MS = 10_000;
const MAX_RETAINED_SHOW_LOOPS = 3;
const MAX_RETAINED_NETWORK_SNAPSHOTS = 8;
const MAX_RECOVERY_EVENTS = 32;
const MAX_TRANSITIONS = 32;
const MAX_IGNORED_REASON_BUCKETS = 32;
const MAX_SHUTDOWN_FAILURES = 16;

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

export type PrimaryEditorDispatchEvent = CueCorrelation & {
  cue: Extract<Cue, { kind: "editor-action" }>;
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
  // Aborting must prevent a phase from publishing a late bridge, child, HWND, or lease.
  startBridge(signal: AbortSignal): Promise<void>;
  launchJanVim(signal: AbortSignal): Promise<void>;
  placeJanVim(signal: AbortSignal): Promise<void>;
  awaitAgent(signal: AbortSignal): Promise<void>;
  prepareOriginalPoem(signal: AbortSignal): Promise<{ bufferSha256: string }>;
  createLoop(
    loopId: string,
    surface: ShowSecondarySurface,
    reserveNextLoopId: () => string,
    onPrimaryEditorDispatch: (event: PrimaryEditorDispatchEvent) => void,
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
    leaseRemoved: boolean;
  };
  resetToOriginal(
    loopId: string,
    signal: AbortSignal,
  ): Promise<{ bufferSha256: string }>;
  sendAgentShutdown(timeoutMs: 2_000, retryLimit: 1): Promise<void>;
  closePlacedWindow(timeoutMs: 2_000, maxOutputBytes: 4_096): Promise<void>;
  waitForJanVimExit(timeoutMs: 5_000): Promise<"natural" | "still-running">;
  terminateExactJanVim(): Promise<void>;
  waitForForcedExit(timeoutMs: 5_000): Promise<boolean>;
  closeBridge(timeoutMs: 5_000): Promise<void>;
  dispose(): void;
}

export interface ShowRunCoordinatorDependencies {
  mode: "Soak3" | "Show";
  originalPoemSha256: string;
  validate(): Promise<void>;
  openSecondary(
    generationId: number,
    signal: AbortSignal,
  ): Promise<ShowSecondarySurface>;
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

export type CoordinatorRecoveryEvent = {
  generationId: number;
  domain: "secondary" | "janvim";
  attempt: 1 | 2 | 3;
  delayMs: 1_000 | 2_000 | 4_000;
  outcome: "recovered" | "safe-ready" | "failed";
  reason: string;
};

export type CoordinatorAggregate = {
  completedLoops: number;
  automaticRecoveryRetryCount: number;
  recoveryEventCount: number;
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
  recoveries: readonly CoordinatorRecoveryEvent[];
  offlineSnapshots: readonly NetworkSnapshotEvidence[];
  transitions: readonly CoordinatorTransition[];
  shutdown: {
    requestedReason: string | null;
    failures: readonly string[];
    childSettled: boolean;
    leaseRemoved: boolean;
    forcedTermination: boolean;
  };
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

type SessionCleanupResult = {
  childSettled: boolean;
  leaseRemoved: boolean;
};

type RecoveryPhase =
  | "open-secondary"
  | "reset-original"
  | "start-bridge"
  | "launch-janvim"
  | "place-janvim"
  | "await-agent"
  | "prepare-original";

export class ShowRunCoordinator {
  public readonly completion: Promise<ShowRunResult>;
  private resolveCompletion!: (result: ShowRunResult) => void;
  private state: ShowCoordinatorState = "booting";
  private generationId = 1;
  private stateReason: string | undefined;
  private bootAttempted = false;
  private readonly startupAbortController = new AbortController();
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
  private secondaryRestartBudget = new RestartBudget();
  private janvimRestartBudget = new RestartBudget();
  private exhaustedRecoveryDomain: "secondary" | "janvim" | undefined;
  private readonly recoveryDelays = new Map<
    OneLoopTimerHandle,
    (elapsed: boolean) => void
  >();
  private readonly recoveryPhaseDeadlines = new Map<
    OneLoopTimerHandle,
    () => void
  >();
  private shutdownPromise: Promise<void> | undefined;
  private startupOperation: Promise<unknown> | undefined;
  private recoveryOperation: Promise<void> | undefined;
  private pendingRecoveryTerminalFailure: string | undefined;
  private priorSessionSettlement: SessionCleanupResult | undefined;
  private boundaryQueue: Promise<void> = Promise.resolve();
  private readonly surfaceDisposers = new Set<() => void>();
  private readonly sessionDisposers = new Set<() => void>();
  private readonly ignoredReasonBuckets = new Set<string>();
  private readonly transitions: CoordinatorTransition[] = [];
  private readonly loops: CoordinatorLoopSummary[] = [];
  private readonly recoveries: CoordinatorRecoveryEvent[] = [];
  private readonly offlineSnapshots: NetworkSnapshotEvidence[] = [];
  private readonly aggregate: CoordinatorAggregate = {
    completedLoops: 0,
    automaticRecoveryRetryCount: 0,
    recoveryEventCount: 0,
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
  private readonly shutdownDiagnostics = {
    requestedReason: null as string | null,
    failures: [] as string[],
    childSettled: false,
    leaseRemoved: false,
    forcedTermination: false,
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
        this.dependencies.openSecondary(
          capturedGeneration,
          this.startupAbortController.signal,
        ),
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
      await this.runStartupOperation(() =>
        session.startBridge(this.startupAbortController.signal),
      );
      if (!this.isBootGeneration(capturedGeneration)) {
        return { ready: false, reason: "controller-stopping" };
      }
      await this.runStartupOperation(() =>
        session.launchJanVim(this.startupAbortController.signal),
      );
      if (!this.isBootGeneration(capturedGeneration)) {
        return { ready: false, reason: "controller-stopping" };
      }
      await this.runStartupOperation(() =>
        session.placeJanVim(this.startupAbortController.signal),
      );
      if (!this.isBootGeneration(capturedGeneration)) {
        return { ready: false, reason: "controller-stopping" };
      }
      await this.runStartupOperation(() =>
        session.awaitAgent(this.startupAbortController.signal),
      );
      if (!this.isBootGeneration(capturedGeneration)) {
        return { ready: false, reason: "controller-stopping" };
      }
      const prepared = await this.runStartupOperation(() =>
        session.prepareOriginalPoem(this.startupAbortController.signal),
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
      recoveries: this.recoveries.map((recovery) => ({ ...recovery })),
      offlineSnapshots: this.offlineSnapshots.map((snapshot) => ({ ...snapshot })),
      transitions: this.transitions.map((transition) => ({ ...transition })),
      shutdown: {
        ...this.shutdownDiagnostics,
        failures: [...this.shutdownDiagnostics.failures],
      },
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
    this.log({ type: "startup-cleanup", reason });
    if (session !== undefined) {
      this.priorSessionSettlement = await this.cleanupHeldSession(session);
    }
    return { ready: false, reason };
  }

  private async cleanupHeldSession(
    session: ShowRunSession,
  ): Promise<SessionCleanupResult> {
    await bestEffort(() => session.sendAgentShutdown(2_000, 1));
    await bestEffort(() => session.closePlacedWindow(2_000, 4_096));
    const exit = await bestEffortResult(
      () => session.waitForJanVimExit(5_000),
      "still-running" as const,
    );
    let childSettled = exit === "natural";
    if (!childSettled) {
      await bestEffort(() => session.terminateExactJanVim());
      childSettled = await bestEffortResult(
        () => session.waitForForcedExit(5_000),
        false,
      );
    }
    await bestEffort(() => session.closeBridge(5_000));
    this.disposeSessionListeners();
    bestEffortSync(() => session.dispose());
    const leaseRemoved = bestEffortSyncResult(
      () => session.diagnostics().leaseRemoved,
      false,
    );
    if (this.session === session) this.session = undefined;
    return { childSettled, leaseRemoved };
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
        this.resetExhaustedRecoveryBudget();
        this.startRecovery(() => this.restartFromSafeReady());
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

  private startRun(deferTerminalFailure = false): boolean {
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
      (event) => this.recordPrimaryEditorDispatch(event, generationId),
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
    let started = false;
    try {
      started = driver.start();
    } catch {
      started = false;
    }
    if (!started) {
      if (deferTerminalFailure) {
        this.pendingRecoveryTerminalFailure = "loop-start-failed";
      } else {
        this.receiveTerminalFailure("loop-start-failed");
      }
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
      if (event.cue.kind !== "editor-action" && reachesPrimary) {
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
      return true;
    } catch {
      this.ignore("cue-correlation-duplicate");
      return false;
    }
  }

  private recordPrimaryEditorDispatch(
    event: PrimaryEditorDispatchEvent,
    generationId: number,
  ): void {
    const active = this.activeLoop;
    if (
      this.state !== "running" ||
      !this.isCurrentGeneration(generationId) ||
      event.generationId !== generationId ||
      active === undefined ||
      event.loopId !== active.loopId ||
      event.cueId !== event.cue.id
    ) {
      this.ignore("cue-correlation-invalid");
      return;
    }

    const key: CueCorrelation = {
      generationId,
      loopId: active.loopId,
      cueId: event.cueId,
    };
    try {
      active.telemetry.recordDispatch(
        "primary",
        key,
        event.cue,
        this.dependencies.nowMs(),
      );
      if (event.cue.payload.action.type === "reset") {
        active.resetCueId = event.cueId;
      }
    } catch {
      this.ignore("cue-correlation-duplicate");
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
      const { generationId, driverStopFailed } =
        this.invalidateActiveLoopForRecovery();
      if (session === undefined || session.diagnostics().connections !== 1) {
        this.startRecovery(() =>
          this.holdAfterSecondaryLoss(oldSurface, generationId),
        );
      } else if (
        driverStopFailed ||
        session.diagnostics().editorCommandPending
      ) {
        this.transition("black-recovering", "secondary-editor-pending");
        bestEffortSync(() => oldSurface?.close());
        if (this.surface === oldSurface) this.surface = undefined;
        this.startRecovery(() =>
          this.recoverFullSession(session, generationId, true),
        );
      } else {
        this.startRecovery(() =>
          this.recoverSecondary(session, oldSurface, generationId),
        );
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
      const { generationId } = this.invalidateActiveLoopForRecovery();
      this.rebindRetainedSurface(this.surface, generationId);
      this.sendStatus();
      if (oldSession === undefined) {
        this.enterSafeReady("recovery-session-missing");
      } else {
        this.startRecovery(() =>
          this.recoverFullSession(oldSession, generationId),
        );
      }
    } else {
      this.ignore("session-fault-out-of-context");
    }
  }

  private invalidateActiveLoopForRecovery(): {
    generationId: number;
    driverStopFailed: boolean;
  } {
    this.incrementGeneration();
    this.log({
      type: "generation-invalidate",
      generationId: this.generationId,
    });
    let driverStopFailed = false;
    try {
      this.driver?.stop();
    } catch {
      driverStopFailed = true;
      bestEffortSync(() =>
        this.log({
          type: "recovery-cleanup-failure",
          classification: "driver-stop-failed",
        }),
      );
    }
    this.driver = undefined;
    this.disposeSurfaceListeners();
    this.disposeSessionListeners();
    const sampler = this.activeLoop?.sampler;
    this.activeLoop = undefined;
    this.pendingNextLoop = undefined;
    this.currentLoopId = null;
    this.stopQueued = false;
    this.operatorArmed = false;
    if (sampler !== undefined) void bestEffort(() => sampler.finish());
    return { generationId: this.generationId, driverStopFailed };
  }

  private startRecovery(operation: () => Promise<void>): void {
    if (this.recoveryOperation !== undefined) return;
    const recovery = Promise.resolve()
      .then(operation)
      .catch(() => {
        if (
          this.state === "safe-cruise" ||
          this.state === "black-recovering"
        ) {
          this.enterSafeReady("recovery-operation-failed");
        }
      })
      .finally(() => {
        if (this.recoveryOperation === recovery) this.recoveryOperation = undefined;
        const terminalFailure = this.pendingRecoveryTerminalFailure;
        this.pendingRecoveryTerminalFailure = undefined;
        if (
          terminalFailure !== undefined &&
          this.state !== "shutting-down" &&
          this.state !== "stopped"
        ) {
          void this.beginShutdown({ ok: false, reason: terminalFailure });
        }
      });
    this.recoveryOperation = recovery;
  }

  private async recoverSecondary(
    session: ShowRunSession,
    oldSurface: ShowSecondarySurface | undefined,
    generationId: number,
  ): Promise<void> {
    await Promise.resolve();
    if (!this.canContinueRecovery(generationId, "safe-cruise")) return;
    const decision = this.secondaryRestartBudget.reserve(
      this.dependencies.nowMs(),
    );
    if (!decision.allowed) {
      this.exhaustedRecoveryDomain = "secondary";
      this.enterSafeReady("secondary-restart-limit");
      return;
    }
    this.transition("black-recovering", "secondary-recovery");
    bestEffortSync(() => oldSurface?.close());
    if (this.surface === oldSurface) this.surface = undefined;
    if (!(await this.waitForRecoveryDelay("secondary", decision.delayMs))) return;
    if (!this.canContinueRecovery(generationId, "black-recovering")) return;

    let recoveryRecorded = false;
    try {
      const surface = await this.waitForRecoveryPhase(
        "open-secondary",
        (signal) => this.dependencies.openSecondary(generationId, signal),
        (lateSurface) => lateSurface.close(),
      );
      if (!this.canContinueRecovery(generationId, "black-recovering")) {
        bestEffortSync(() => surface.close());
        return;
      }
      this.surface = surface;
      this.bindSurface(surface, generationId);
      session.rebindGeneration(generationId);
      this.bindSession(session, generationId);
      const reset = await this.waitForRecoveryPhase(
        "reset-original",
        (signal) =>
          session.resetToOriginal(`recovery-reset-g${generationId}`, signal),
      );
      if (!this.canContinueRecovery(generationId, "black-recovering")) return;
      if (reset.bufferSha256 !== this.dependencies.originalPoemSha256) {
        this.recordRecovery({
          generationId,
          domain: "secondary",
          attempt: decision.attempt,
          delayMs: decision.delayMs,
          outcome: "failed",
          reason: "reset-hash-mismatch",
        });
        recoveryRecorded = true;
        await this.recoverFullSession(session, generationId);
        return;
      }
      this.operatorArmed = true;
      if (this.startRun(true)) {
        this.recordRecovery({
          generationId,
          domain: "secondary",
          attempt: decision.attempt,
          delayMs: decision.delayMs,
          outcome: "recovered",
          reason: "secondary-recovered",
        });
        recoveryRecorded = true;
      } else {
        this.recordRecovery({
          generationId,
          domain: "secondary",
          attempt: decision.attempt,
          delayMs: decision.delayMs,
          outcome: "failed",
          reason: "secondary-restart-failed",
        });
        recoveryRecorded = true;
        if (this.state === "black-recovering") {
          this.enterSafeReady("secondary-restart-failed");
        }
      }
    } catch {
      if (this.canContinueRecovery(generationId, "black-recovering")) {
        if (!recoveryRecorded) {
          this.recordRecovery({
            generationId,
            domain: "secondary",
            attempt: decision.attempt,
            delayMs: decision.delayMs,
            outcome: "failed",
            reason: "secondary-recovery-failed",
          });
        }
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
      const surface = await this.waitForRecoveryPhase(
        "open-secondary",
        (signal) => this.dependencies.openSecondary(generationId, signal),
        (lateSurface) => lateSurface.close(),
      );
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
    replaceSecondary = false,
  ): Promise<void> {
    await Promise.resolve();
    if (!this.canContinueRecovery(generationId, "black-recovering")) return;
    const decision = this.janvimRestartBudget.reserve(
      this.dependencies.nowMs(),
    );
    const cleanup = await this.cleanupHeldSession(oldSession);
    this.priorSessionSettlement = cleanup;
    if (!this.canContinueRecovery(generationId, "black-recovering")) return;
    if (!cleanup.childSettled || !cleanup.leaseRemoved) {
      if (decision.allowed) {
        this.recordRecovery({
          generationId,
          domain: "janvim",
          attempt: decision.attempt,
          delayMs: decision.delayMs,
          outcome: "failed",
          reason: "old-session-unsettled",
        });
      }
      this.enterSafeReady("recovery-old-session-unsettled");
      return;
    }
    if (!decision.allowed) {
      this.exhaustedRecoveryDomain = "janvim";
      this.enterSafeReady("janvim-restart-limit");
      return;
    }
    if (!(await this.waitForRecoveryDelay("janvim", decision.delayMs))) return;
    if (!this.canContinueRecovery(generationId, "black-recovering")) return;

    let session: ShowRunSession | undefined;
    try {
      if (replaceSecondary) {
        const surface = await this.waitForRecoveryPhase(
          "open-secondary",
          (signal) => this.dependencies.openSecondary(generationId, signal),
          (lateSurface) => lateSurface.close(),
        );
        if (!this.canContinueRecovery(generationId, "black-recovering")) {
          bestEffortSync(() => surface.close());
          return;
        }
        this.surface = surface;
        this.bindSurface(surface, generationId);
      }
      session = this.dependencies.createSession(generationId);
      this.session = session;
      this.priorSessionSettlement = undefined;
      this.bindSession(session, generationId);
      await this.waitForRecoveryPhase("start-bridge", (signal) =>
        session!.startBridge(signal),
      );
      if (!this.canContinueRecovery(generationId, "black-recovering")) return;
      await this.waitForRecoveryPhase("launch-janvim", (signal) =>
        session!.launchJanVim(signal),
      );
      if (!this.canContinueRecovery(generationId, "black-recovering")) return;
      await this.waitForRecoveryPhase("place-janvim", (signal) =>
        session!.placeJanVim(signal),
      );
      if (!this.canContinueRecovery(generationId, "black-recovering")) return;
      await this.waitForRecoveryPhase("await-agent", (signal) =>
        session!.awaitAgent(signal),
      );
      if (!this.canContinueRecovery(generationId, "black-recovering")) return;
      const prepared = await this.waitForRecoveryPhase(
        "prepare-original",
        (signal) => session!.prepareOriginalPoem(signal),
      );
      if (!this.canContinueRecovery(generationId, "black-recovering")) return;
      if (prepared.bufferSha256 !== this.dependencies.originalPoemSha256) {
        throw new Error("replacement prepare hash mismatch");
      }

      this.operatorArmed = true;
      this.transition("ready", "session-recovered");
      this.sendStatus();
      if (this.startRun(true)) {
        this.recordRecovery({
          generationId,
          domain: "janvim",
          attempt: decision.attempt,
          delayMs: decision.delayMs,
          outcome: "recovered",
          reason: "session-recovered",
        });
      } else {
        this.recordRecovery({
          generationId,
          domain: "janvim",
          attempt: decision.attempt,
          delayMs: decision.delayMs,
          outcome: "failed",
          reason: "session-restart-failed",
        });
        if (this.state === "black-recovering") {
          this.enterSafeReady("session-restart-failed");
        }
      }
    } catch {
      if (session !== undefined) {
        this.priorSessionSettlement = await this.cleanupHeldSession(session);
      }
      if (this.canContinueRecovery(generationId, "black-recovering")) {
        this.recordRecovery({
          generationId,
          domain: "janvim",
          attempt: decision.attempt,
          delayMs: decision.delayMs,
          outcome: "failed",
          reason: "session-recovery-failed",
        });
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
    if (oldSession !== undefined) {
      const cleanup = await this.cleanupHeldSession(oldSession);
      this.priorSessionSettlement = cleanup;
      if (!cleanup.childSettled || !cleanup.leaseRemoved) {
        if (this.canContinueRecovery(generationId, "safe-ready")) {
          this.stateReason = "recovery-old-session-unsettled";
          this.operatorArmed = true;
          this.recoveryInFlight = false;
          this.sendStatus();
        }
        return;
      }
    }
    if (!this.canContinueRecovery(generationId, "safe-ready")) return;

    let session: ShowRunSession | undefined;
    try {
      if (this.surface === undefined) {
        const surface = await this.waitForRecoveryPhase(
          "open-secondary",
          (signal) => this.dependencies.openSecondary(generationId, signal),
          (lateSurface) => lateSurface.close(),
        );
        if (!this.canContinueRecovery(generationId, "safe-ready")) {
          bestEffortSync(() => surface.close());
          return;
        }
        this.surface = surface;
        this.bindSurface(surface, generationId);
      }
      session = this.dependencies.createSession(generationId);
      this.session = session;
      this.priorSessionSettlement = undefined;
      this.bindSession(session, generationId);
      await this.waitForRecoveryPhase("start-bridge", (signal) =>
        session!.startBridge(signal),
      );
      if (!this.canContinueRecovery(generationId, "safe-ready")) return;
      await this.waitForRecoveryPhase("launch-janvim", (signal) =>
        session!.launchJanVim(signal),
      );
      if (!this.canContinueRecovery(generationId, "safe-ready")) return;
      await this.waitForRecoveryPhase("place-janvim", (signal) =>
        session!.placeJanVim(signal),
      );
      if (!this.canContinueRecovery(generationId, "safe-ready")) return;
      await this.waitForRecoveryPhase("await-agent", (signal) =>
        session!.awaitAgent(signal),
      );
      if (!this.canContinueRecovery(generationId, "safe-ready")) return;
      const prepared = await this.waitForRecoveryPhase(
        "prepare-original",
        (signal) => session!.prepareOriginalPoem(signal),
      );
      if (!this.canContinueRecovery(generationId, "safe-ready")) return;
      if (prepared.bufferSha256 !== this.dependencies.originalPoemSha256) {
        throw new Error("operator restart prepare hash mismatch");
      }

      this.operatorArmed = true;
      this.recoveryInFlight = false;
      this.transition("ready", "operator-restart");
      this.sendStatus();
      if (!this.startRun(true) && this.state === "safe-ready") {
        this.stateReason = "operator-restart-failed";
        this.operatorArmed = true;
        this.recoveryInFlight = false;
        this.sendStatus();
      }
    } catch {
      if (session !== undefined) {
        this.priorSessionSettlement = await this.cleanupHeldSession(session);
      }
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

  private waitForRecoveryPhase<T>(
    phase: RecoveryPhase,
    operation: (signal: AbortSignal) => Promise<T>,
    onLateValue?: (value: T) => void,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let handle: OneLoopTimerHandle | undefined;
      const abortController = new AbortController();

      const clearDeadline = (): void => {
        if (handle === undefined) return;
        try {
          this.dependencies.timers.clearTimeout(handle);
          this.recoveryPhaseDeadlines.delete(handle);
        } catch {
          bestEffortSync(() =>
            this.log({
              type: "recovery-timer-clear-failed",
              phase,
            }),
          );
        }
      };

      const cancel = (): void => {
        if (settled) return;
        settled = true;
        abortController.abort();
        reject(new Error("recovery phase cancelled"));
      };

      try {
        handle = this.dependencies.timers.setTimeout(() => {
          if (handle !== undefined) this.recoveryPhaseDeadlines.delete(handle);
          if (settled) return;
          settled = true;
          abortController.abort();
          bestEffortSync(() =>
            this.log({
              type: "recovery-phase-timeout",
              phase,
              timeoutMs: RECOVERY_PHASE_TIMEOUT_MS,
            }),
          );
          reject(new Error(`recovery phase timed out: ${phase}`));
        }, RECOVERY_PHASE_TIMEOUT_MS);
        this.recoveryPhaseDeadlines.set(handle, cancel);
      } catch (error) {
        reject(error);
        return;
      }

      Promise.resolve()
        .then(() => operation(abortController.signal))
        .then(
          (value) => {
            if (settled) {
              bestEffortSync(() => onLateValue?.(value));
              return;
            }
            settled = true;
            clearDeadline();
            resolve(value);
          },
          (error: unknown) => {
            if (settled) return;
            settled = true;
            clearDeadline();
            reject(error);
          },
        );
    });
  }

  private waitForRecoveryDelay(
    domain: "secondary" | "janvim",
    delayMs: 1_000 | 2_000 | 4_000,
  ): Promise<boolean> {
    this.log({ type: "recovery-delay", domain, delayMs });
    return new Promise<boolean>((resolve) => {
      let handle: OneLoopTimerHandle;
      handle = this.dependencies.timers.setTimeout(() => {
        this.recoveryDelays.delete(handle);
        resolve(true);
      }, delayMs);
      this.recoveryDelays.set(handle, resolve);
    });
  }

  private cancelRecoveryDelays(): void {
    for (const [handle, resolve] of this.recoveryDelays) {
      try {
        this.dependencies.timers.clearTimeout(handle);
      } catch {
        this.recordShutdownFailure("recovery-timer-clear-failed");
      }
      resolve(false);
    }
    this.recoveryDelays.clear();
  }

  private cancelRecoveryPhases(): void {
    for (const [handle, cancel] of [...this.recoveryPhaseDeadlines]) {
      try {
        this.dependencies.timers.clearTimeout(handle);
        this.recoveryPhaseDeadlines.delete(handle);
      } catch {
        this.recordShutdownFailure("recovery-phase-timer-clear-failed");
      }
      cancel();
    }
  }

  private resetExhaustedRecoveryBudget(): void {
    if (this.exhaustedRecoveryDomain === "secondary") {
      this.secondaryRestartBudget = new RestartBudget();
    } else if (this.exhaustedRecoveryDomain === "janvim") {
      this.janvimRestartBudget = new RestartBudget();
    }
    this.exhaustedRecoveryDomain = undefined;
  }

  private recordRecovery(event: CoordinatorRecoveryEvent): void {
    this.aggregate.recoveryEventCount += 1;
    if (event.attempt > 1) this.aggregate.automaticRecoveryRetryCount += 1;
    this.recoveries.push({ ...event });
    if (this.recoveries.length > MAX_RECOVERY_EVENTS) this.recoveries.shift();
    bestEffortSync(() =>
      this.log({
        type: "recovery-outcome",
        ...event,
      }),
    );
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
    this.shutdownDiagnostics.requestedReason = result.reason;
    this.logShutdownPhase("disarm-operator");
    this.operatorArmed = false;
    this.incrementGeneration();
    this.logShutdownPhase("invalidate-generation");
    this.sendStatus();
    this.startupAbortController.abort();
    this.cancelRecoveryPhases();
    this.cancelRecoveryDelays();
    this.logShutdownPhase("stop-driver-and-queued-editor-work");
    try {
      this.driver?.stop();
    } catch {
      this.recordShutdownFailure("driver-stop-failed");
    }
    this.driver = undefined;
    this.disposeSurfaceListeners();
    this.disposeSessionListeners();
    this.stopQueued = false;
    this.currentLoopId = null;
    this.pendingNextLoop = undefined;

    const activeSampler = this.activeLoop?.sampler;
    const startupOperation = this.startupOperation;
    const recoveryOperation = this.recoveryOperation;
    this.activeLoop = undefined;

    this.shutdownPromise = Promise.resolve().then(async () => {
      if (startupOperation !== undefined) await bestEffort(() => startupOperation);
      if (recoveryOperation !== undefined) await bestEffort(() => recoveryOperation);

      const session = this.session;
      const surface = this.surface;
      if (session !== undefined) {
        await this.runShutdownPhase("agent-shutdown-failed", () =>
          session.sendAgentShutdown(2_000, 1),
        );
        await this.runShutdownPhase("hwnd-close-failed", () =>
          session.closePlacedWindow(2_000, 4_096),
        );
        const exit = await this.runShutdownPhase(
          "wait-natural-failed",
          () => session.waitForJanVimExit(5_000),
        );
        if (exit === "natural") {
          this.shutdownDiagnostics.childSettled = true;
        } else {
          this.shutdownDiagnostics.forcedTermination = true;
          await this.runShutdownPhase("terminate-exact-failed", () =>
            session.terminateExactJanVim(),
          );
          const forced = await this.runShutdownPhase(
            "wait-forced-failed",
            () => session.waitForForcedExit(5_000),
          );
          if (forced === true) {
            this.shutdownDiagnostics.childSettled = true;
          } else {
            this.recordShutdownFailure("janvim-unsettled");
          }
        }
        await this.runShutdownPhase("bridge-close-failed", () =>
          session.closeBridge(5_000),
        );
        this.runShutdownPhaseSync("session-dispose-failed", () =>
          session.dispose(),
        );
        const sessionDiagnostics = this.runShutdownPhaseSyncResult(
          "session-diagnostics-failed",
          () => session.diagnostics(),
        );
        this.shutdownDiagnostics.leaseRemoved =
          sessionDiagnostics?.leaseRemoved ?? false;
        if (!this.shutdownDiagnostics.leaseRemoved) {
          this.recordShutdownFailure("lease-not-removed");
        }
      } else {
        const prior = this.priorSessionSettlement;
        this.shutdownDiagnostics.childSettled = prior?.childSettled ?? true;
        this.shutdownDiagnostics.leaseRemoved = prior?.leaseRemoved ?? true;
        if (
          !this.shutdownDiagnostics.childSettled ||
          !this.shutdownDiagnostics.leaseRemoved
        ) {
          this.recordShutdownFailure("janvim-unsettled");
        }
      }
      this.session = undefined;
      if (activeSampler !== undefined) {
        await this.runShutdownPhase("resource-finish-failed", () =>
          activeSampler.finish(),
        );
      }
      if (surface !== undefined) {
        this.runShutdownPhaseSync("surface-close-failed", () => surface.close());
      }
      this.surface = undefined;
      const networkSnapshot = await this.runShutdownPhase(
        "network-snapshot-failed",
        () => this.dependencies.sampleNetwork(),
      );
      if (networkSnapshot !== undefined) this.retainNetworkSnapshot(networkSnapshot);
      await this.runShutdownPhase("flush-logs-failed", () =>
        this.dependencies.flushLogs(),
      );

      let finalResult = this.classifyShutdownResult(result);
      await this.runShutdownPhase("evidence-write-failed", () =>
        this.dependencies.finalizeEvidence(finalResult, this.diagnostics()),
      );
      finalResult = this.classifyShutdownResult(result);
      await this.runShutdownPhase("terminal-marker-failed", () =>
        this.dependencies.writeTerminalMarker(finalResult),
      );
      finalResult = this.classifyShutdownResult(result);
      this.transition("stopped", finalResult.reason);
      this.resolveCompletion(finalResult);
    }).catch(() => {
      this.recordShutdownFailure("shutdown-unexpected-failure");
      const finalResult = this.classifyShutdownResult({
        ok: false,
        reason: "shutdown-incomplete",
      });
      if (this.state === "shutting-down") {
        this.transition("stopped", finalResult.reason);
      }
      this.resolveCompletion(finalResult);
    });
    return this.shutdownPromise;
  }

  private async runShutdownPhase<T>(
    classification: string,
    action: () => Promise<T>,
  ): Promise<T | undefined> {
    try {
      return await action();
    } catch {
      this.recordShutdownFailure(classification);
      return undefined;
    }
  }

  private runShutdownPhaseSync(
    classification: string,
    action: () => unknown,
  ): void {
    try {
      action();
    } catch {
      this.recordShutdownFailure(classification);
    }
  }

  private runShutdownPhaseSyncResult<T>(
    classification: string,
    action: () => T,
  ): T | undefined {
    try {
      return action();
    } catch {
      this.recordShutdownFailure(classification);
      return undefined;
    }
  }

  private recordShutdownFailure(classification: string): void {
    if (
      !this.shutdownDiagnostics.failures.includes(classification) &&
      this.shutdownDiagnostics.failures.length < MAX_SHUTDOWN_FAILURES
    ) {
      this.shutdownDiagnostics.failures.push(classification);
    }
    bestEffortSync(() =>
      this.log({ type: "shutdown-failure", classification }),
    );
  }

  private logShutdownPhase(phase: string): void {
    bestEffortSync(() =>
      this.log({ type: "shutdown-phase", phase }),
    );
  }

  private classifyShutdownResult(requested: ShowRunResult): ShowRunResult {
    if (requested.ok && this.shutdownDiagnostics.failures.length > 0) {
      return { ok: false, reason: "shutdown-incomplete" };
    }
    return requested;
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
      timers:
        driverTimers +
        samplerTimers +
        this.recoveryDelays.size +
        this.recoveryPhaseDeadlines.size,
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
    this.log({ type: "ignored-event", reason });
  }

  private log(event: Record<string, unknown>): void {
    try {
      this.dependencies.log(event);
    } catch {
      // Logging is diagnostic; coordinator safety remains authoritative.
    }
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

function bestEffortSyncResult<T>(action: () => T, fallback: T): T {
  try {
    return action();
  } catch {
    return fallback;
  }
}
