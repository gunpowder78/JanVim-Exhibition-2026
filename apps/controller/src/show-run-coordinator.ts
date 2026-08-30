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
const STARTUP_PHASE_TIMEOUT_MS = 35_000;
const BOUNDARY_PHASE_TIMEOUT_MS = 10_000;
const CLEANUP_PHASE_TIMEOUT_MS = 10_000;
const FINALIZATION_PHASE_TIMEOUT_MS = 10_000;
const RECOVERY_PHASE_TIMEOUT_MS = 10_000;
const MAX_RETAINED_SHOW_LOOPS = 3;
const MAX_RETAINED_NETWORK_SNAPSHOTS = 8;
const MAX_RECOVERY_EVENTS = 32;
const MAX_TRANSITIONS = 32;
const MAX_IGNORED_REASON_BUCKETS = 32;
const MAX_SHUTDOWN_FAILURES = 16;
const MAX_COORDINATOR_PHASE_DEADLINES = 8;
const MAX_GUARDED_ABORT_LISTENERS = 64;

class BoundedPhaseTimeoutError extends Error {
  public constructor(
    public readonly phase: string,
    public readonly timeoutMs: number,
  ) {
    super(`coordinator phase timed out: ${phase}`);
  }
}

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

type StagedLoopCallbackGate = {
  reserveNextLoopId(): string;
  dispatchPrimary(event: PrimaryEditorDispatchEvent): void;
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
  rebindGeneration(generationId: number, signal: AbortSignal): Promise<void>;
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
    signal: AbortSignal,
  ): Promise<void>;
  writeTerminalMarker(
    result: ShowRunResult,
    signal: AbortSignal,
  ): Promise<void>;
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
  pendingBoundaryWork: 0 | 1;
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
  ready: new Set(["running", "black-recovering", "shutting-down"]),
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

type HeldCleanupSequence = {
  revoked: boolean;
};

type RecoveryPhase =
  | "open-secondary"
  | "rebind-generation"
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
  private operatorArmed = false;
  private surface: ShowSecondarySurface | undefined;
  private session: ShowRunSession | undefined;
  private pendingSession: ShowRunSession | undefined;
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
  private readonly phaseDeadlines = new Map<
    OneLoopTimerHandle,
    { phase: string; cancel: () => void }
  >();
  private shutdownPromise: Promise<void> | undefined;
  private startupOperation: Promise<unknown> | undefined;
  private recoveryOperation: Promise<void> | undefined;
  private pendingRecoveryTerminalFailure: string | undefined;
  private priorSessionSettlement: SessionCleanupResult | undefined;
  private boundaryOperation: Promise<void> | undefined;
  private pendingBoundaryTerminal: ShowRunResult | undefined;
  private heldCleanupSequence: HeldCleanupSequence | undefined;
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
      await this.runStartupOperation("validation", () =>
        this.dependencies.validate(),
      );
      if (!this.isBootGeneration(capturedGeneration)) {
        return { ready: false, reason: "controller-stopping" };
      }
      this.retainNetworkSnapshot(
        await this.runStartupOperation("network-sample", () =>
          this.dependencies.sampleNetwork(),
        ),
      );
      if (!this.isBootGeneration(capturedGeneration)) {
        return { ready: false, reason: "controller-stopping" };
      }

      const surface = await this.runStartupOperation(
        "open-secondary",
        (signal) => this.dependencies.openSecondary(capturedGeneration, signal),
        (lateSurface) => lateSurface.close(),
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
      await this.runStartupOperation("start-bridge", (signal) =>
        session.startBridge(signal),
      );
      if (!this.isBootGeneration(capturedGeneration)) {
        return { ready: false, reason: "controller-stopping" };
      }
      await this.runStartupOperation("launch-janvim", (signal) =>
        session.launchJanVim(signal),
      );
      if (!this.isBootGeneration(capturedGeneration)) {
        return { ready: false, reason: "controller-stopping" };
      }
      await this.runStartupOperation("place-janvim", (signal) =>
        session.placeJanVim(signal),
      );
      if (!this.isBootGeneration(capturedGeneration)) {
        return { ready: false, reason: "controller-stopping" };
      }
      await this.runStartupOperation("await-agent", (signal) =>
        session.awaitAgent(signal),
      );
      if (!this.isBootGeneration(capturedGeneration)) {
        return { ready: false, reason: "controller-stopping" };
      }
      const prepared = await this.runStartupOperation(
        "prepare-original",
        (signal) => session.prepareOriginalPoem(signal),
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
      if (!this.isBootGeneration(capturedGeneration)) {
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
      pendingBoundaryWork: this.boundaryOperation === undefined ? 0 : 1,
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

  private async runStartupOperation<T>(
    phase: string,
    action: (signal: AbortSignal) => Promise<T>,
    onLateValue?: (value: T) => void,
  ): Promise<T> {
    const operation = this.runBoundedPhase(
      `startup-${phase}`,
      STARTUP_PHASE_TIMEOUT_MS,
      action,
      onLateValue,
    );
    this.startupOperation = operation;
    try {
      return await operation;
    } finally {
      if (this.startupOperation === operation) this.startupOperation = undefined;
    }
  }

  private runBoundedPhase<T>(
    phase: string,
    timeoutMs: number,
    action: (signal: AbortSignal) => Promise<T>,
    onLateValue?: (value: T) => void,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let lateValueHandled = false;
      let handle: OneLoopTimerHandle | undefined;
      const abortController = createGuardedAbortController();

      const revokeDeadline = (clearExternal: boolean): boolean => {
        const currentHandle = handle;
        if (currentHandle === undefined) return true;
        handle = undefined;
        this.phaseDeadlines.delete(currentHandle);
        if (!clearExternal) return true;
        try {
          this.dependencies.timers.clearTimeout(currentHandle);
          return true;
        } catch {
          this.log({ type: "coordinator-timer-clear-failed", phase });
          return false;
        }
      };

      const abort = (): void => {
        abortController.abort();
      };

      const cancel = (): void => {
        if (settled) return;
        settled = true;
        const cleared = revokeDeadline(true);
        abort();
        if (!cleared && phase.startsWith("recovery-")) {
          this.recordShutdownFailure("recovery-phase-timer-clear-failed");
        }
        reject(new Error(`coordinator phase cancelled: ${phase}`));
      };

      if (this.phaseDeadlines.size >= MAX_COORDINATOR_PHASE_DEADLINES) {
        settled = true;
        abort();
        reject(new Error("coordinator phase deadline capacity exceeded"));
        return;
      }

      try {
        const allocatedHandle = this.dependencies.timers.setTimeout(() => {
          if (settled) return;
          settled = true;
          revokeDeadline(false);
          abort();
          this.log({ type: "coordinator-phase-timeout", phase, timeoutMs });
          reject(new BoundedPhaseTimeoutError(phase, timeoutMs));
        }, timeoutMs);
        handle = allocatedHandle;
        if (settled) {
          revokeDeadline(true);
          return;
        }
        this.phaseDeadlines.set(allocatedHandle, { phase, cancel });
      } catch (error) {
        settled = true;
        abort();
        reject(error);
        return;
      }

      Promise.resolve()
        .then(() => action(abortController.signal))
        .then(
          (value) => {
            if (settled) {
              if (!lateValueHandled) {
                lateValueHandled = true;
                bestEffortSync(() => onLateValue?.(value));
              }
              return;
            }
            settled = true;
            revokeDeadline(true);
            resolve(value);
          },
          (error: unknown) => {
            if (settled) return;
            settled = true;
            revokeDeadline(true);
            reject(error);
          },
        );
    });
  }

  private cancelBoundedPhases(): void {
    const deadlines = [...this.phaseDeadlines.values()];
    for (const deadline of deadlines) deadline.cancel();
  }

  private cancelBoundedPhase(phase: string): void {
    const deadline = [...this.phaseDeadlines.values()].find(
      (candidate) => candidate.phase === phase,
    );
    deadline?.cancel();
  }

  private async holdStartupFailure(
    reason: string,
    session: ShowRunSession | undefined,
  ): Promise<{ ready: false; reason: string }> {
    const generationId = this.generationId;
    this.operatorArmed = false;
    this.log({ type: "startup-cleanup", reason });
    let cleanup: SessionCleanupResult = { childSettled: true, leaseRemoved: true };
    if (session !== undefined) {
      if (this.session === session) this.session = undefined;
      this.pendingSession = session;
      this.disposeSessionListeners();
      cleanup = await this.cleanupHeldSession(session);
      this.priorSessionSettlement = cleanup;
    }
    if (this.canContinueRecovery(generationId, "booting")) {
      this.transition("safe-ready", reason);
      this.operatorArmed = cleanup.childSettled && cleanup.leaseRemoved;
      if (this.operatorArmed) this.sendStatus();
    }
    return { ready: false, reason };
  }

  private async holdInvalidatedStartup(
    session: ShowRunSession | undefined,
    generationId: number,
    reason: string,
  ): Promise<void> {
    const cleanup =
      session === undefined
        ? { childSettled: true, leaseRemoved: true }
        : await this.cleanupHeldSession(session);
    if (!this.canContinueRecovery(generationId, "booting")) return;
    this.priorSessionSettlement = cleanup;
    this.transition("safe-ready", reason);
    this.operatorArmed = cleanup.childSettled && cleanup.leaseRemoved;
    this.recoveryInFlight = false;
    if (this.operatorArmed) this.sendStatus();
  }

  private async cleanupHeldSession(
    session: ShowRunSession,
  ): Promise<SessionCleanupResult> {
    this.revokeHeldCleanupSequence();
    const sequence: HeldCleanupSequence = { revoked: false };
    this.heldCleanupSequence = sequence;
    try {
      await this.runCleanupPhase(sequence, "held-agent-shutdown", () =>
        session.sendAgentShutdown(2_000, 1),
      );
      if (!this.isHeldCleanupSequenceCurrent(sequence)) return cancelledCleanup();
      await this.runCleanupPhase(sequence, "held-hwnd-close", () =>
        session.closePlacedWindow(2_000, 4_096),
      );
      if (!this.isHeldCleanupSequenceCurrent(sequence)) return cancelledCleanup();
      const exit = await this.runCleanupPhase(
        sequence,
        "held-wait-natural",
        () => session.waitForJanVimExit(5_000),
      );
      if (!this.isHeldCleanupSequenceCurrent(sequence)) return cancelledCleanup();
      let childSettled = exit === "natural";
      if (!childSettled) {
        await this.runCleanupPhase(sequence, "held-terminate-exact", () =>
          session.terminateExactJanVim(),
        );
        if (!this.isHeldCleanupSequenceCurrent(sequence)) {
          return cancelledCleanup();
        }
        childSettled = (await this.runCleanupPhase(
          sequence,
          "held-wait-forced",
          () => session.waitForForcedExit(5_000),
        )) === true;
        if (!this.isHeldCleanupSequenceCurrent(sequence)) {
          return cancelledCleanup();
        }
      }
      await this.runCleanupPhase(sequence, "held-bridge-close", () =>
        session.closeBridge(5_000),
      );
      if (!this.isHeldCleanupSequenceCurrent(sequence)) return cancelledCleanup();
      this.disposeSessionListeners();
      if (!this.isHeldCleanupSequenceCurrent(sequence)) return cancelledCleanup();
      bestEffortSync(() => session.dispose());
      if (!this.isHeldCleanupSequenceCurrent(sequence)) return cancelledCleanup();
      const leaseRemoved = bestEffortSyncResult(
        () => session.diagnostics().leaseRemoved,
        false,
      );
      if (!this.isHeldCleanupSequenceCurrent(sequence)) return cancelledCleanup();
      if (this.session === session) this.session = undefined;
      if (this.pendingSession === session) this.pendingSession = undefined;
      return { childSettled, leaseRemoved };
    } finally {
      if (this.heldCleanupSequence === sequence) {
        this.heldCleanupSequence = undefined;
      }
    }
  }

  private async runCleanupPhase<T>(
    sequence: HeldCleanupSequence,
    phase: string,
    action: () => Promise<T>,
  ): Promise<T | undefined> {
    if (!this.isHeldCleanupSequenceCurrent(sequence)) return undefined;
    try {
      return await this.runBoundedPhase(
        `cleanup-${phase}`,
        CLEANUP_PHASE_TIMEOUT_MS,
        () => {
          if (!this.isHeldCleanupSequenceCurrent(sequence)) {
            throw new Error("held cleanup sequence cancelled");
          }
          return action();
        },
      );
    } catch {
      this.log({ type: "cleanup-phase-failed", phase });
      return undefined;
    }
  }

  private isHeldCleanupSequenceCurrent(sequence: HeldCleanupSequence): boolean {
    return !sequence.revoked && this.heldCleanupSequence === sequence;
  }

  private revokeHeldCleanupSequence(): void {
    const sequence = this.heldCleanupSequence;
    if (sequence === undefined) return;
    sequence.revoked = true;
    this.heldCleanupSequence = undefined;
  }

  private bindSurface(
    surface: ShowSecondarySurface,
    generationId: number,
  ): void {
    this.disposeSurfaceListeners();
    const stagedDisposers: Array<() => void> = [];
    try {
      stagedDisposers.push(
        surface.onEvent((event) => {
          if (!this.isCurrentGeneration(generationId)) {
            this.ignore("stale-generation");
            return;
          }
          this.handleCurrentRendererEvent(event);
        }),
      );
      stagedDisposers.push(
        surface.onDestroyed(() => {
          if (!this.isCurrentGeneration(generationId)) {
            this.ignore("stale-generation");
            return;
          }
          this.handleSecondaryDestroyed();
        }),
      );
    } catch (error) {
      runRollbackInReverse(stagedDisposers);
      throw error;
    }
    for (const dispose of stagedDisposers) this.surfaceDisposers.add(dispose);
  }

  private bindSession(session: ShowRunSession, generationId: number): void {
    this.disposeSessionListeners();
    const stagedDisposers: Array<() => void> = [];
    try {
      stagedDisposers.push(
        session.onFault((fault) => {
          if (!this.isCurrentGeneration(generationId)) {
            this.ignore("stale-generation");
            return;
          }
          this.handleSessionFault(fault);
        }),
      );
      stagedDisposers.push(
        session.onPrimaryCompletion((event) => {
          if (!this.isCurrentGeneration(generationId)) {
            this.ignore("stale-generation");
            return;
          }
          this.handlePrimaryCompletion(event);
        }),
      );
    } catch (error) {
      runRollbackInReverse(stagedDisposers);
      throw error;
    }
    for (const dispose of stagedDisposers) this.sessionDisposers.add(dispose);
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
        const acceptedGenerationId = this.generationId;
        const acceptedState = this.state;
        this.recoveryInFlight = true;
        this.operatorArmed = false;
        this.resetExhaustedRecoveryBudget();
        this.startRecovery(() =>
          this.restartFromSafeReady(acceptedGenerationId, acceptedState),
        );
        return true;
      case "stop-show":
        return this.handleStopAction();
    }
  }

  private handleStopAction(): boolean {
    if (this.state === "running") {
      if (this.boundaryOperation !== undefined) {
        if (this.stopQueued) {
          this.ignore("stop-already-queued");
          return false;
        }
        this.stopQueued = true;
        bestEffortSync(() => this.driver?.stop());
        this.queueBoundaryTerminal({ ok: true, reason: "operator-stop" });
        return true;
      }
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
    const rollback: Array<() => void> = [];
    let stagedNextLoop:
      | { generationId: number; loopNumber: number; loopId: string }
      | undefined;
    const stagedCallbackGate: StagedLoopCallbackGate = {
      reserveNextLoopId: rejectRevokedNextLoopReservation,
      dispatchPrimary: ignoreRevokedPrimaryDispatch,
    };
    let published = false;
    try {
      const loopId = this.dependencies.nextLoopId(generationId, 1);
      const loopNumber = 1;
      const telemetry = this.dependencies.createTelemetry();
      telemetry.beginLoop(loopId, this.dependencies.nowMs());
      const sampler = this.dependencies.createResourceSampler();
      rollback.push(() => sampler.dispose());
      const active: ActiveLoop = {
        generationId,
        loopId,
        loopNumber,
        telemetry,
        sampler,
      };
      const telemetrySurface = this.createTelemetrySurface(
        surface,
        generationId,
      );
      const reserveNextLoopId = (): string => {
        if (published) {
          return this.reserveNextLoopId(generationId);
        }
        if (!this.isCurrentGeneration(generationId) || this.state !== "ready") {
          throw new Error(
            "next loop ID requested outside staged loop construction",
          );
        }

        const nextLoopNumber = loopNumber + 1;
        const terminalRotation =
          (this.dependencies.mode === "Soak3" && nextLoopNumber > 3) ||
          this.stopQueued;
        if (terminalRotation) return `${loopId}-terminal`;
        if (stagedNextLoop !== undefined) return stagedNextLoop.loopId;

        const reservedLoopId = this.dependencies.nextLoopId(
          generationId,
          nextLoopNumber,
        );
        if (reservedLoopId.length === 0 || reservedLoopId === loopId) {
          throw new Error("next loop ID must be fresh and non-empty");
        }
        stagedNextLoop = {
          generationId,
          loopNumber: nextLoopNumber,
          loopId: reservedLoopId,
        };
        return reservedLoopId;
      };
      stagedCallbackGate.reserveNextLoopId = reserveNextLoopId;
      stagedCallbackGate.dispatchPrimary = (event) =>
        this.recordPrimaryEditorDispatch(event, generationId);
      const runtime = session.createLoop(
        active.loopId,
        telemetrySurface,
        () => stagedCallbackGate.reserveNextLoopId(),
        (event) => stagedCallbackGate.dispatchPrimary(event),
      );
      rollback.push(() => {
        if (runtime.state !== "stopped") runtime.stop();
      });
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
      rollback.push(() => driver.stop());
      if (!driver.start()) throw new Error("loop driver did not start");

      active.countsAtStart = this.runtimeCounts(driver, sampler);
      this.activeLoop = active;
      this.currentLoopId = loopId;
      this.pendingNextLoop = stagedNextLoop;
      this.driver = driver;
      this.transition("running");
      this.startedLoops += 1;
      published = true;
      rollback.length = 0;
      this.sendStatus();
      return true;
    } catch {
      revokeStagedLoopCallbacks(stagedCallbackGate);
      stagedNextLoop = undefined;
      runRollbackInReverse(rollback);
      this.activeLoop = undefined;
      this.currentLoopId = null;
      this.pendingNextLoop = undefined;
      this.driver = undefined;
      if (deferTerminalFailure) {
        this.pendingRecoveryTerminalFailure = "loop-start-failed";
      } else {
        this.receiveTerminalFailure("loop-start-failed");
      }
      return false;
    }
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
    if (this.boundaryOperation !== undefined) {
      bestEffortSync(() => this.driver?.stop());
      this.queueBoundaryTerminal({
        ok: false,
        reason: "loop-boundary-overlap",
      });
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

      let operation!: Promise<void>;
      operation = this.runBoundedPhase(
        "loop-boundary-finalize",
        BOUNDARY_PHASE_TIMEOUT_MS,
        async () => {
          const [resourceResult, networkResult] = await Promise.allSettled([
            active.sampler.finish(),
            this.dependencies.sampleNetwork(),
          ]);
          if (resourceResult.status === "rejected") throw resourceResult.reason;
          if (networkResult.status === "rejected") throw networkResult.reason;
          return {
            resourceSummary: resourceResult.value,
            networkSnapshot: networkResult.value,
          };
        },
      )
        .then(({ resourceSummary, networkSnapshot }) => {
          if (
            this.boundaryOperation !== operation ||
            !this.isCurrentGeneration(generationId) ||
            this.state !== "running"
          ) {
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
        .then(
          () => this.finishBoundaryOperation(operation),
          () =>
            this.finishBoundaryOperation(
              operation,
              "loop-boundary-finalize-failed",
            ),
        );
      this.boundaryOperation = operation;
    } catch {
      bestEffortSync(() => this.driver?.stop());
      this.receiveTerminalFailure("loop-boundary-invalid");
    }
  }

  private finishBoundaryOperation(
    operation: Promise<void>,
    failureReason?: string,
  ): void {
    if (this.boundaryOperation !== operation) return;
    this.boundaryOperation = undefined;
    if (failureReason !== undefined) {
      this.queueBoundaryTerminal({ ok: false, reason: failureReason });
    }
    const terminal = this.pendingBoundaryTerminal;
    this.pendingBoundaryTerminal = undefined;
    if (terminal !== undefined) void this.beginShutdown(terminal);
  }

  private queueBoundaryTerminal(result: ShowRunResult): void {
    const pending = this.pendingBoundaryTerminal;
    if (result.reason === "loop-boundary-overlap") {
      this.pendingBoundaryTerminal = result;
      return;
    }
    if (pending?.reason === "loop-boundary-overlap") return;
    if (pending === undefined || (pending.ok && !result.ok)) {
      this.pendingBoundaryTerminal = result;
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
    if (this.boundaryOperation !== undefined) {
      this.queueBoundaryTerminal(result);
    } else {
      void this.beginShutdown(result);
    }
  }

  private handleDriverFailure(generationId: number, reason: string): void {
    if (!this.isCurrentGeneration(generationId)) {
      this.ignore("stale-generation");
      return;
    }
    this.receiveTerminalFailure(reason);
  }

  private receiveTerminalFailure(reason: string): void {
    const result: ShowRunResult = { ok: false, reason };
    if (this.boundaryOperation !== undefined) {
      this.queueBoundaryTerminal(result);
    } else {
      void this.beginShutdown(result);
    }
  }

  private handleSecondaryDestroyed(): void {
    const failedState = this.state;
    if (
      failedState !== "booting" &&
      failedState !== "ready" &&
      failedState !== "running" &&
      failedState !== "safe-cruise" &&
      failedState !== "black-recovering"
    ) {
      this.ignore("secondary-destroyed-out-of-context");
      return;
    }

    const oldSurface = this.surface;
    const session = this.session ?? this.pendingSession;
    const diagnostics = bestEffortSyncResult(
      () => session?.diagnostics(),
      undefined,
    );
    const canRetainSession =
      session !== undefined &&
      diagnostics?.connections === 1 &&
      diagnostics.editorCommandPending === false;

    if (failedState === "running") {
      this.transition("safe-cruise", "secondary-destroyed");
    } else if (failedState === "ready") {
      this.transition("black-recovering", "secondary-destroyed");
    } else if (failedState === "safe-cruise") {
      this.transition("black-recovering", "secondary-destroyed-during-recovery");
    } else if (failedState === "black-recovering") {
      this.stateReason = "secondary-destroyed-during-recovery";
    }

    const requiresFullReplacement =
      failedState === "booting" ||
      failedState === "safe-cruise" ||
      failedState === "black-recovering" ||
      !canRetainSession;
    const invalidation = this.invalidateCurrentResources({
      failedSurface: oldSurface,
      ...(requiresFullReplacement ? { failedSession: session } : {}),
    });
    if (requiresFullReplacement && session !== undefined) {
      this.pendingSession = session;
    } else if (session !== undefined && !invalidation.driverStopFailed) {
      this.bindSession(session, invalidation.generationId);
    }
    const runAfterSupersededRecovery = async (
      operation: () => Promise<void>,
    ): Promise<void> => {
      if (invalidation.supersededRecovery !== undefined) {
        await bestEffort(() => invalidation.supersededRecovery!);
      }
      if (!this.isCurrentGeneration(invalidation.generationId)) return;
      await operation();
    };

    if (failedState === "booting") {
      this.startRecovery(() =>
        runAfterSupersededRecovery(() =>
          this.holdInvalidatedStartup(
            session,
            invalidation.generationId,
            "secondary-destroyed",
          ),
        ),
      );
      return;
    }
    if (
      session !== undefined &&
      diagnostics?.connections !== 1 &&
      diagnostics?.editorCommandPending === false
    ) {
      this.startRecovery(() =>
        runAfterSupersededRecovery(async () => {
          const cleanup = await this.cleanupHeldSession(session);
          if (!this.isCurrentGeneration(invalidation.generationId)) return;
          this.priorSessionSettlement = cleanup;
          await this.holdAfterSecondaryLoss(
            oldSurface,
            invalidation.generationId,
            failedState === "running" ? "safe-cruise" : "black-recovering",
          );
        }),
      );
      return;
    }
    if (session === undefined) {
      this.startRecovery(() =>
        runAfterSupersededRecovery(() =>
          this.holdAfterSecondaryLoss(
            oldSurface,
            invalidation.generationId,
            failedState === "running" ? "safe-cruise" : "black-recovering",
          ),
        ),
      );
      return;
    }
    if (requiresFullReplacement || invalidation.driverStopFailed) {
      if (this.state !== "black-recovering") {
        this.transition("black-recovering", "secondary-editor-pending");
      }
      this.startRecovery(() =>
        runAfterSupersededRecovery(() =>
          this.recoverFullSession(
            session,
            invalidation.generationId,
            true,
            failedState !== "ready",
          ),
        ),
      );
      return;
    }
    this.startRecovery(() =>
      runAfterSupersededRecovery(() =>
        this.recoverSecondary(
          session,
          oldSurface,
          invalidation.generationId,
          failedState !== "ready",
          failedState === "running" ? "safe-cruise" : "black-recovering",
        ),
      ),
    );
  }

  private handleSessionFault(
    fault: "agent-disconnected" | "critical-ack-failed" | "janvim-exited",
  ): void {
    const failedState = this.state;
    if (
      failedState !== "booting" &&
      failedState !== "ready" &&
      failedState !== "running" &&
      failedState !== "safe-cruise" &&
      failedState !== "black-recovering"
    ) {
      this.ignore("session-fault-out-of-context");
      return;
    }

    const oldSession = this.session ?? this.pendingSession;
    if (failedState === "ready" || failedState === "running") {
      this.transition("black-recovering", fault);
    } else if (failedState === "safe-cruise") {
      this.transition("black-recovering", fault);
    } else if (failedState === "black-recovering") {
      this.stateReason = fault;
    }
    const invalidation = this.invalidateCurrentResources({
      failedSession: oldSession,
      ...(failedState === "booting" ? { failedSurface: this.surface } : {}),
    });
    if (oldSession !== undefined) this.pendingSession = oldSession;

    if (failedState === "booting") {
      this.startRecovery(async () => {
        if (invalidation.supersededRecovery !== undefined) {
          await bestEffort(() => invalidation.supersededRecovery!);
        }
        await this.holdInvalidatedStartup(
          oldSession,
          invalidation.generationId,
          fault,
        );
      });
      return;
    }

    this.rebindRetainedSurface(this.surface, invalidation.generationId);
    this.sendStatus();
    if (oldSession === undefined) {
      this.enterSafeReady("recovery-session-missing", false);
      return;
    }
    this.startRecovery(async () => {
      if (invalidation.supersededRecovery !== undefined) {
        await bestEffort(() => invalidation.supersededRecovery!);
      }
      if (!this.isCurrentGeneration(invalidation.generationId)) return;
      await this.recoverFullSession(
        oldSession,
        invalidation.generationId,
        false,
        failedState !== "ready",
      );
    });
  }

  private invalidateCurrentResources(options: {
    failedSurface?: ShowSecondarySurface;
    failedSession?: ShowRunSession;
  }): {
    generationId: number;
    driverStopFailed: boolean;
    supersededRecovery: Promise<void> | undefined;
  } {
    const supersededRecovery = this.recoveryOperation;
    if (supersededRecovery !== undefined) this.recoveryOperation = undefined;
    this.incrementGeneration();
    this.revokeBoundaryOperation();
    this.revokeHeldCleanupSequence();
    this.cancelBoundedPhases();
    this.cancelRecoveryDelays();
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
    if (
      options.failedSurface !== undefined &&
      this.surface === options.failedSurface
    ) {
      this.surface = undefined;
    }
    if (options.failedSurface !== undefined) {
      bestEffortSync(() => options.failedSurface!.close());
    }
    if (
      options.failedSession !== undefined &&
      this.session === options.failedSession
    ) {
      this.session = undefined;
    }
    if (
      options.failedSession !== undefined &&
      this.pendingSession === options.failedSession
    ) {
      this.pendingSession = undefined;
    }
    const sampler = this.activeLoop?.sampler;
    this.activeLoop = undefined;
    this.pendingNextLoop = undefined;
    this.currentLoopId = null;
    this.stopQueued = false;
    this.operatorArmed = false;
    this.recoveryInFlight = false;
    if (sampler !== undefined) void bestEffort(() => sampler.finish());
    return {
      generationId: this.generationId,
      driverStopFailed,
      supersededRecovery,
    };
  }

  private revokeBoundaryOperation(): void {
    if (this.boundaryOperation === undefined) return;
    this.boundaryOperation = undefined;
    this.pendingBoundaryTerminal = undefined;
    this.cancelBoundedPhase("loop-boundary-finalize");
  }

  private startRecovery(operation: () => Promise<void>): void {
    if (this.recoveryOperation !== undefined) return;
    const generationId = this.generationId;
    const recovery = Promise.resolve()
      .then(operation)
      .catch(() => {
        if (
          this.isCurrentGeneration(generationId) &&
          (this.state === "safe-cruise" || this.state === "black-recovering")
        ) {
          this.enterSafeReady("recovery-operation-failed", false);
        }
      })
      .finally(() => {
        if (this.recoveryOperation !== recovery) return;
        this.recoveryOperation = undefined;
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
    resumeRun: boolean,
    initialState: "safe-cruise" | "black-recovering",
  ): Promise<void> {
    await Promise.resolve();
    if (!this.canContinueRecovery(generationId, initialState)) return;
    if (this.surface === oldSurface) this.surface = undefined;
    const decision = this.secondaryRestartBudget.reserve(
      this.dependencies.nowMs(),
    );
    if (!decision.allowed) {
      this.exhaustedRecoveryDomain = "secondary";
      this.enterSafeReady("secondary-restart-limit");
      return;
    }
    if (this.state !== "black-recovering") {
      this.transition("black-recovering", "secondary-recovery");
    }
    if (!(await this.waitForRecoveryDelay("secondary", decision.delayMs))) return;
    if (!this.canContinueRecovery(generationId, "black-recovering")) return;

    let recoveryRecorded = false;
    let retainedSessionTouched = false;
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
      retainedSessionTouched = true;
      await this.waitForRecoveryPhase("rebind-generation", (signal) =>
        session.rebindGeneration(generationId, signal),
      );
      if (!this.canContinueRecovery(generationId, "black-recovering")) return;
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
        await this.recoverFullSession(session, generationId, false, resumeRun);
        return;
      }
      this.operatorArmed = true;
      if (!resumeRun) {
        this.transition("ready", "secondary-recovered");
        this.sendStatus();
        this.recordRecovery({
          generationId,
          domain: "secondary",
          attempt: decision.attempt,
          delayMs: decision.delayMs,
          outcome: "recovered",
          reason: "secondary-recovered",
        });
        recoveryRecorded = true;
      } else if (this.startRun(true)) {
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
        if (retainedSessionTouched) {
          const cleanup = await this.cleanupHeldSession(session);
          if (!this.canContinueRecovery(generationId, "black-recovering")) return;
          this.priorSessionSettlement = cleanup;
          this.enterSafeReady(
            "secondary-recovery-failed",
            cleanup.childSettled && cleanup.leaseRemoved,
          );
        } else {
          this.enterSafeReady("secondary-recovery-failed");
        }
      }
    }
  }

  private async holdAfterSecondaryLoss(
    oldSurface: ShowSecondarySurface | undefined,
    generationId: number,
    state: "safe-cruise" | "black-recovering",
  ): Promise<void> {
    await Promise.resolve();
    if (!this.canContinueRecovery(generationId, state)) return;
    if (this.surface === oldSurface) this.surface = undefined;
    try {
      const surface = await this.waitForRecoveryPhase(
        "open-secondary",
        (signal) => this.dependencies.openSecondary(generationId, signal),
        (lateSurface) => lateSurface.close(),
      );
      if (!this.canContinueRecovery(generationId, state)) {
        bestEffortSync(() => surface.close());
        return;
      }
      this.surface = surface;
      this.bindSurface(surface, generationId);
    } catch {
      // A missing control surface still remains a fail-closed safe-ready hold.
    }
    if (this.canContinueRecovery(generationId, state)) {
      const settlement = this.priorSessionSettlement;
      this.enterSafeReady(
        "secondary-session-unhealthy",
        settlement === undefined ||
          (settlement.childSettled && settlement.leaseRemoved),
      );
    }
  }

  private async recoverFullSession(
    oldSession: ShowRunSession,
    generationId: number,
    replaceSecondary = false,
    resumeRun = true,
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
      this.enterSafeReady("recovery-old-session-unsettled", false);
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
    let replacementCleanup: SessionCleanupResult | undefined = cleanup;
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
      replacementCleanup = undefined;
      this.pendingSession = session;
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

      this.session = session;
      this.pendingSession = undefined;
      this.priorSessionSettlement = undefined;
      this.operatorArmed = true;
      this.transition("ready", "session-recovered");
      this.sendStatus();
      if (!resumeRun) {
        this.recordRecovery({
          generationId,
          domain: "janvim",
          attempt: decision.attempt,
          delayMs: decision.delayMs,
          outcome: "recovered",
          reason: "session-recovered",
        });
      } else if (this.startRun(true)) {
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
      if (
        session !== undefined &&
        (this.session === session || this.pendingSession === session) &&
        this.canContinueRecovery(generationId, "black-recovering")
      ) {
        const cleanup = await this.cleanupHeldSession(session);
        replacementCleanup = cleanup;
        if (this.canContinueRecovery(generationId, "black-recovering")) {
          this.priorSessionSettlement = cleanup;
        }
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
        this.enterSafeReady(
          "session-recovery-failed",
          replacementCleanup?.childSettled === true &&
            replacementCleanup.leaseRemoved,
        );
      }
    }
  }

  private async restartFromSafeReady(
    acceptedGenerationId: number,
    acceptedState: "safe-ready",
  ): Promise<void> {
    if (!this.canContinueRecovery(acceptedGenerationId, acceptedState)) return;
    const oldSession = this.session;
    this.incrementGeneration();
    const generationId = this.generationId;
    this.disposeSurfaceListeners();
    this.disposeSessionListeners();
    this.rebindRetainedSurface(this.surface, generationId);
    if (oldSession !== undefined) {
      if (
        !this.canContinueRecovery(generationId, "safe-ready") ||
        this.session !== oldSession
      ) {
        return;
      }
      const cleanup = await this.cleanupHeldSession(oldSession);
      if (!this.canContinueRecovery(generationId, "safe-ready")) return;
      this.priorSessionSettlement = cleanup;
      if (!cleanup.childSettled || !cleanup.leaseRemoved) {
        if (this.canContinueRecovery(generationId, "safe-ready")) {
          this.stateReason = "recovery-old-session-unsettled";
          this.operatorArmed = false;
          this.recoveryInFlight = false;
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
      this.pendingSession = session;
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

      this.session = session;
      this.pendingSession = undefined;
      this.priorSessionSettlement = undefined;
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
      if (
        session !== undefined &&
        (this.session === session || this.pendingSession === session) &&
        this.canContinueRecovery(generationId, "safe-ready")
      ) {
        const cleanup = await this.cleanupHeldSession(session);
        if (this.canContinueRecovery(generationId, "safe-ready")) {
          this.priorSessionSettlement = cleanup;
        }
      }
      if (this.canContinueRecovery(generationId, "safe-ready")) {
        this.stateReason = "operator-restart-failed";
        this.operatorArmed =
          this.priorSessionSettlement?.childSettled === true &&
          this.priorSessionSettlement.leaseRemoved;
        this.recoveryInFlight = false;
        if (this.operatorArmed) this.sendStatus();
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
    return this.runBoundedPhase(
      `recovery-${phase}`,
      RECOVERY_PHASE_TIMEOUT_MS,
      operation,
      onLateValue,
    ).catch((error: unknown) => {
      if (error instanceof BoundedPhaseTimeoutError) {
        this.log({
          type: "recovery-phase-timeout",
          phase,
          timeoutMs: RECOVERY_PHASE_TIMEOUT_MS,
        });
      }
      throw error;
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

  private enterSafeReady(reason: string, actionable = true): void {
    if (this.state !== "safe-ready") this.transition("safe-ready", reason);
    this.stateReason = reason;
    this.operatorArmed = actionable;
    this.recoveryInFlight = false;
    if (actionable) this.sendStatus();
  }

  private beginShutdown(result: ShowRunResult): Promise<void> {
    if (this.shutdownPromise !== undefined) return this.shutdownPromise;
    if (this.state === "stopped") return Promise.resolve();

    this.transition("shutting-down", result.reason);
    this.shutdownDiagnostics.requestedReason = result.reason;
    const startupOperation = this.startupOperation;
    const recoveryOperation = this.recoveryOperation;
    this.logShutdownPhase("disarm-operator");
    this.operatorArmed = false;
    this.incrementGeneration();
    this.logShutdownPhase("invalidate-generation");
    this.sendStatus();
    this.revokeBoundaryOperation();
    this.revokeHeldCleanupSequence();
    this.cancelBoundedPhases();
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
    this.activeLoop = undefined;

    this.shutdownPromise = Promise.resolve().then(async () => {
      if (startupOperation !== undefined) {
        await this.runShutdownPhase(
          "startup-operation-wait-failed",
          CLEANUP_PHASE_TIMEOUT_MS,
          () => bestEffort(() => startupOperation),
        );
      }
      if (recoveryOperation !== undefined) {
        await this.runShutdownPhase(
          "recovery-operation-wait-failed",
          CLEANUP_PHASE_TIMEOUT_MS,
          () => bestEffort(() => recoveryOperation),
        );
      }

      const session = this.session ?? this.pendingSession;
      const surface = this.surface;
      if (session !== undefined) {
        await this.runShutdownPhase(
          "agent-shutdown-failed",
          CLEANUP_PHASE_TIMEOUT_MS,
          () => session.sendAgentShutdown(2_000, 1),
        );
        await this.runShutdownPhase(
          "hwnd-close-failed",
          CLEANUP_PHASE_TIMEOUT_MS,
          () => session.closePlacedWindow(2_000, 4_096),
        );
        const exit = await this.runShutdownPhase(
          "wait-natural-failed",
          CLEANUP_PHASE_TIMEOUT_MS,
          () => session.waitForJanVimExit(5_000),
        );
        if (exit === "natural") {
          this.shutdownDiagnostics.childSettled = true;
        } else {
          this.shutdownDiagnostics.forcedTermination = true;
          await this.runShutdownPhase(
            "terminate-exact-failed",
            CLEANUP_PHASE_TIMEOUT_MS,
            () => session.terminateExactJanVim(),
          );
          const forced = await this.runShutdownPhase(
            "wait-forced-failed",
            CLEANUP_PHASE_TIMEOUT_MS,
            () => session.waitForForcedExit(5_000),
          );
          if (forced === true) {
            this.shutdownDiagnostics.childSettled = true;
          } else {
            this.recordShutdownFailure("janvim-unsettled");
          }
        }
        await this.runShutdownPhase(
          "bridge-close-failed",
          CLEANUP_PHASE_TIMEOUT_MS,
          () => session.closeBridge(5_000),
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
      this.pendingSession = undefined;
      if (activeSampler !== undefined) {
        await this.runShutdownPhase(
          "resource-finish-failed",
          CLEANUP_PHASE_TIMEOUT_MS,
          () => activeSampler.finish(),
        );
      }
      if (surface !== undefined) {
        this.runShutdownPhaseSync("surface-close-failed", () => surface.close());
      }
      this.surface = undefined;
      const networkSnapshot = await this.runShutdownPhase(
        "network-snapshot-failed",
        CLEANUP_PHASE_TIMEOUT_MS,
        () => this.dependencies.sampleNetwork(),
      );
      if (networkSnapshot !== undefined) this.retainNetworkSnapshot(networkSnapshot);
      await this.runShutdownPhase(
        "flush-logs-failed",
        FINALIZATION_PHASE_TIMEOUT_MS,
        () => this.dependencies.flushLogs(),
      );

      let finalResult = this.classifyShutdownResult(result);
      const evidenceDiagnostics = this.diagnostics();
      await this.runShutdownPhase(
        "evidence-write-failed",
        FINALIZATION_PHASE_TIMEOUT_MS,
        (signal) =>
          this.dependencies.finalizeEvidence(
            finalResult,
            evidenceDiagnostics,
            signal,
          ),
      );
      finalResult = this.classifyShutdownResult(result);
      await this.runShutdownPhase(
        "terminal-marker-failed",
        FINALIZATION_PHASE_TIMEOUT_MS,
        (signal) => this.dependencies.writeTerminalMarker(finalResult, signal),
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
    timeoutMs: number,
    action: (signal: AbortSignal) => Promise<T>,
  ): Promise<T | undefined> {
    try {
      return await this.runBoundedPhase(
        `shutdown-${classification}`,
        timeoutMs,
        action,
      );
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

  private runtimeCounts(
    driver: MultiLoopDriver | undefined = this.driver,
    sampler: ResourceSampler | undefined = this.activeLoop?.sampler,
  ): RuntimeCountEvidence {
    const session = this.session?.diagnostics();
    const driverTimers = driver?.diagnostics().timers ?? 0;
    const samplerTimers = sampler?.diagnostics().timerCount ?? 0;
    return {
      listeners: this.surfaceDisposers.size + this.sessionDisposers.size,
      timers:
        driverTimers +
        samplerTimers +
        this.recoveryDelays.size +
        this.phaseDeadlines.size,
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

function cancelledCleanup(): SessionCleanupResult {
  return { childSettled: false, leaseRemoved: false };
}

function createGuardedAbortController(): {
  readonly signal: AbortSignal;
  abort(reason?: unknown): void;
} {
  const controller = new AbortController();
  type Registration = {
    listener: EventListenerOrEventListenerObject;
    wrapped: EventListener;
    capture: boolean;
    once: boolean;
    externalSignal?: AbortSignal;
    externalAbortListener?: EventListener;
  };
  const registrations: Registration[] = [];
  let exposedSignal!: AbortSignal;
  let onabort: ((this: AbortSignal, event: Event) => unknown) | null = null;

  const captureOf = (
    options?: boolean | AddEventListenerOptions | EventListenerOptions,
  ): boolean =>
    typeof options === "boolean" ? options : options?.capture === true;

  const removeRegistration = (registration: Registration): void => {
    const index = registrations.indexOf(registration);
    if (index >= 0) registrations.splice(index, 1);
    if (
      registration.externalSignal !== undefined &&
      registration.externalAbortListener !== undefined
    ) {
      registration.externalSignal.removeEventListener(
        "abort",
        registration.externalAbortListener,
      );
    }
    controller.signal.removeEventListener(
      "abort",
      registration.wrapped,
      registration.capture,
    );
  };

  const addAbortListener = (
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void => {
    const externalSignal =
      typeof options === "object" ? options.signal : undefined;
    if (
      listener === null ||
      controller.signal.aborted ||
      externalSignal?.aborted === true
    ) {
      return;
    }
    const capture = captureOf(options);
    if (
      registrations.some(
        (registration) =>
          registration.listener === listener && registration.capture === capture,
      )
    ) {
      return;
    }
    if (registrations.length >= MAX_GUARDED_ABORT_LISTENERS) {
      throw new Error("coordinator abort listener capacity exceeded");
    }
    const registration: Registration = {
      listener,
      capture,
      once: typeof options === "object" && options.once === true,
      wrapped: () => undefined,
    };
    registration.wrapped = (event) => {
      if (registration.once) removeRegistration(registration);
      try {
        let result: unknown;
        if (typeof listener === "function") {
          result = (
            listener as unknown as (
              this: AbortSignal,
              event: Event,
            ) => unknown
          ).call(exposedSignal, event);
        } else {
          result = (
            listener.handleEvent as unknown as (event: Event) => unknown
          )(event);
        }
        absorbAbortListenerResult(result);
      } catch {
        // One dependency listener cannot escape the bounded phase or skip peers.
      }
    };
    registrations.push(registration);
    try {
      if (externalSignal !== undefined && externalSignal !== exposedSignal) {
        const externalAbortListener = (): void => {
          removeRegistration(registration);
        };
        registration.externalSignal = externalSignal;
        registration.externalAbortListener = externalAbortListener;
        externalSignal.addEventListener("abort", externalAbortListener, {
          once: true,
        });
        if (externalSignal.aborted) {
          removeRegistration(registration);
          return;
        }
      }
      controller.signal.addEventListener("abort", registration.wrapped, options);
    } catch (error) {
      removeRegistration(registration);
      throw error;
    }
  };

  const removeAbortListener = (
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void => {
    if (listener === null) return;
    const capture = captureOf(options);
    const registration = registrations.find(
      (candidate) =>
        candidate.listener === listener && candidate.capture === capture,
    );
    if (registration !== undefined) removeRegistration(registration);
  };

  exposedSignal = new Proxy(controller.signal, {
    get(target, property) {
      if (property === "addEventListener") {
        return (
          type: string,
          listener: EventListenerOrEventListenerObject | null,
          options?: boolean | AddEventListenerOptions,
        ): void => {
          if (listener === null) return;
          if (type === "abort") addAbortListener(listener, options);
          else target.addEventListener(type, listener, options);
        };
      }
      if (property === "removeEventListener") {
        return (
          type: string,
          listener: EventListenerOrEventListenerObject | null,
          options?: boolean | EventListenerOptions,
        ): void => {
          if (listener === null) return;
          if (type === "abort") removeAbortListener(listener, options);
          else target.removeEventListener(type, listener, options);
        };
      }
      if (property === "onabort") return onabort;
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, property, value) {
      if (property !== "onabort") {
        return Reflect.set(target, property, value, target);
      }
      onabort = typeof value === "function" ? value : null;
      target.onabort =
        onabort === null
          ? null
          : (event) => {
              try {
                absorbAbortListenerResult(
                  onabort?.call(exposedSignal, event),
                );
              } catch {
                // Property listeners receive the same nonthrowing isolation.
              }
            };
      return true;
    },
  }) as AbortSignal;

  controller.signal.addEventListener(
    "abort",
    () => {
      queueMicrotask(() => {
        for (const registration of [...registrations]) {
          removeRegistration(registration);
        }
        onabort = null;
        controller.signal.onabort = null;
      });
    },
    { once: true },
  );

  return {
    signal: exposedSignal,
    abort: (reason?: unknown) => controller.abort(reason),
  };
}

function absorbAbortListenerResult(result: unknown): void {
  void Promise.resolve(result).catch(() => undefined);
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

function rejectRevokedNextLoopReservation(): never {
  throw new Error("staged loop callbacks have been revoked");
}

function ignoreRevokedPrimaryDispatch(
  _event: PrimaryEditorDispatchEvent,
): void {}

function revokeStagedLoopCallbacks(gate: StagedLoopCallbackGate): void {
  gate.reserveNextLoopId = rejectRevokedNextLoopReservation;
  gate.dispatchPrimary = ignoreRevokedPrimaryDispatch;
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

function bestEffortSync(action: () => unknown): void {
  try {
    action();
  } catch {
    // Cleanup remains best effort and finite.
  }
}

function runRollbackInReverse(rollback: Array<() => void>): void {
  for (let index = rollback.length - 1; index >= 0; index -= 1) {
    bestEffortSync(rollback[index]!);
  }
  rollback.length = 0;
}

function bestEffortSyncResult<T>(action: () => T, fallback: T): T {
  try {
    return action();
  } catch {
    return fallback;
  }
}
