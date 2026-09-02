import type {
  AgentAck,
  AgentCommand,
  ControllerStatusEvent,
  RendererEvent,
} from "@janvim-exhibition/show-schema";

import type { DisplayRoute, Rectangle, RuntimeDisplay } from "./display-router.js";
import type { G2ShutdownEvidence } from "./g2-evidence.js";
import {
  ShowController,
  type DeterministicShowLoop,
} from "./main.js";
import type {
  OneLoopDriver,
  OneLoopTimerHandle,
} from "./one-loop-driver.js";
import type { WindowPlacementReceipt } from "./window-placer.js";

export type G2RunResult = { ok: true } | { ok: false; reason: string };

export interface G2EvidenceFinalization {
  result: G2RunResult;
  placement: WindowPlacementReceipt | null;
  completedLoops: 0 | 1;
  maxDriftMs: number;
  resetRestoredPoem: boolean;
  shutdown: G2ShutdownEvidence | null;
}

export interface G2BridgeHandle {
  host: "127.0.0.1";
  port: number;
  token: string;
  waitForAgent(timeoutMs: 10_000): Promise<void>;
  dispatch(command: AgentCommand): Promise<AgentAck>;
  close(): Promise<void>;
}

export interface G2JanVimHandle {
  pid: number;
  onClose(listener: (exitCode: number | null) => void): () => void;
  kill(): boolean;
}

export interface G2SecondaryHandle {
  send(event: RendererEvent): void;
  onDestroyed(listener: () => void): () => void;
  close(): void;
}

export interface G2RuntimeDependencies {
  validate(): Promise<{ ok: true } | { ok: false; reason: string }>;
  routeDisplays(): Promise<DisplayRoute>;
  openSecondary(display: RuntimeDisplay): Promise<G2SecondaryHandle>;
  bindStart(controller: ShowController): () => void;
  startBridge(): Promise<G2BridgeHandle>;
  startJanVim(
    bridge: G2BridgeHandle,
  ): Promise<{ ok: true; child: G2JanVimHandle } | { ok: false; reason: string }>;
  placeJanVim(
    pid: number,
    bounds: Rectangle,
  ): Promise<
    | { ok: true; receipt: WindowPlacementReceipt }
    | { ok: false; reason: string }
  >;
  createLoop(
    bridge: G2BridgeHandle,
    secondary: G2SecondaryHandle,
  ): DeterministicShowLoop;
  createDriver(
    loop: DeterministicShowLoop,
    callbacks: { onComplete(): void; onFailure(reason: string): void },
  ): OneLoopDriver;
  timers: {
    setTimeout(callback: () => void, delayMs: number): OneLoopTimerHandle;
    clearTimeout(id: OneLoopTimerHandle): void;
  };
  log(event: Record<string, unknown>): void;
  classifyShutdown(
    exitCode: number | null,
  ): Promise<G2ShutdownEvidence>;
  finalizeEvidence(input: G2EvidenceFinalization): Promise<void>;
}

export class G2RuntimeComposition {
  private readonly controller: ShowController;
  private readonly cleanupPromise: Promise<void>;
  private resolveCleanup!: () => void;
  private resolveCompletion!: (result: G2RunResult) => void;
  private secondary?: G2SecondaryHandle;
  private bridge?: G2BridgeHandle;
  private child?: G2JanVimHandle;
  private loop?: DeterministicShowLoop;
  private driver?: OneLoopDriver;
  private placementReceipt?: WindowPlacementReceipt;
  private disposeStart?: () => void;
  private disposeSecondary?: () => void;
  private disposeChildClose?: () => void;
  private blockedTimerId?: OneLoopTimerHandle;
  private manualCloseTimerId?: OneLoopTimerHandle;
  private childCleanupTimerId?: OneLoopTimerHandle;
  private terminalResult?: G2RunResult;
  private cleanupStarted = false;
  private childClosed = false;
  private childKillRequested = false;
  private completedReset = false;
  private manualCloseExpired = false;
  private validationSucceeded = false;
  private maxDriftMs = 0;
  private shutdownEvidence: G2ShutdownEvidence | null = null;
  public readonly completion: Promise<G2RunResult>;

  public constructor(private readonly dependencies: G2RuntimeDependencies) {
    this.cleanupPromise = new Promise<void>((resolve) => {
      this.resolveCleanup = resolve;
    });
    this.completion = new Promise<G2RunResult>((resolve) => {
      this.resolveCompletion = resolve;
    });
    this.controller = new ShowController({
      validateManifestsAndHashes: async () => {
        const result = await this.dependencies.validate();
        if (result.ok) this.validationSucceeded = true;
        return result;
      },
      routeDisplays: () => this.dependencies.routeDisplays(),
      openSecondaryReady: async (display) => {
        this.secondary = await this.dependencies.openSecondary(display);
        this.sendStatus("booting");
        this.disposeStart = this.dependencies.bindStart(this.controller);
        this.disposeSecondary = this.secondary.onDestroyed(() => {
          void this.fail("secondary-window-destroyed");
        });
      },
      startBridge: async () => {
        this.bridge = await this.dependencies.startBridge();
        return this.bridge;
      },
      startJanVim: async () => {
        const result = await this.dependencies.startJanVim(this.requiredBridge());
        if (!result.ok) return result;
        this.child = result.child;
        this.disposeChildClose = result.child.onClose((code) => {
          void this.onChildClose(code);
        });
        return { ok: true, pid: result.child.pid };
      },
      placeJanVimWindow: async (pid, bounds) => {
        const result = await this.dependencies.placeJanVim(pid, bounds);
        if (result.ok) this.placementReceipt = result.receipt;
        return result;
      },
      awaitAgentStatus: async () => {
        try {
          await this.requiredBridge().waitForAgent(10_000);
          this.loop = this.dependencies.createLoop(
            this.requiredBridge(),
            this.requiredSecondary(),
          );
          return (await this.loop.prepare())
            ? { ok: true }
            : { ok: false, reason: "agent-prepare-failed" };
        } catch {
          return { ok: false, reason: "agent-not-ready" };
        }
      },
      holdReady: (reason) => this.holdBlocked(reason),
      beginMonotonicLoop: () => this.beginLoop(),
    });
  }

  public async boot(): Promise<{ ready: true } | { ready: false; reason: string }> {
    const result = await this.controller.boot();
    if (result.ready && this.terminalResult === undefined) this.sendStatus("ready");
    return result;
  }

  public stop(): Promise<void> {
    if (this.terminalResult === undefined) {
      void this.fail("controller-stopped");
    }
    return this.cleanupPromise;
  }

  private holdBlocked(reason: string): void {
    if (this.terminalResult !== undefined) return;
    if (this.secondary === undefined) {
      void this.fail(reason);
      return;
    }
    this.sendStatus("blocked", reason);
    this.blockedTimerId ??= this.dependencies.timers.setTimeout(
      () => void this.fail(reason),
      15_000,
    );
  }

  private beginLoop(): void {
    const loop = this.requiredLoop();
    this.driver = this.dependencies.createDriver(loop, {
      onComplete: () => this.onLoopComplete(),
      onFailure: (reason) => void this.fail(reason),
    });
    if (!this.driver.start()) throw new Error("loop-start-failed");
    this.sendStatus("running");
  }

  private onLoopComplete(): void {
    if (this.terminalResult !== undefined) return;
    if (this.requiredLoop().completedLoops !== 1) {
      void this.fail("loop-count-invalid");
      return;
    }
    this.completedReset = true;
    this.maxDriftMs = this.driver?.diagnostics().maxDriftMs ?? 0;
    this.sendStatus("complete-awaiting-close");
    this.manualCloseTimerId ??= this.dependencies.timers.setTimeout(
      () => this.onManualCloseDeadline(),
      60_000,
    );
  }

  private onManualCloseDeadline(): void {
    if (this.terminalResult !== undefined || this.childClosed) return;
    this.manualCloseExpired = true;
    void this.fail("janvim-close-timeout");
  }

  private async onChildClose(exitCode: number | null): Promise<void> {
    if (this.childClosed) return;
    this.childClosed = true;
    this.clearManualCloseTimer();
    this.clearChildCleanupTimer();

    try {
      this.shutdownEvidence = await this.dependencies.classifyShutdown(exitCode);
    } catch {
      if (this.terminalResult !== undefined) {
        await this.finalizeCleanup();
      } else {
        await this.fail("janvim-shutdown-classification-failed");
      }
      return;
    }

    if (this.terminalResult !== undefined) {
      await this.finalizeCleanup();
      return;
    }
    if (!this.completedReset) {
      await this.fail("janvim-exited-before-reset");
      return;
    }
    if (this.manualCloseExpired) {
      await this.fail("janvim-close-timeout");
      return;
    }

    if (this.shutdownEvidence.natural) {
      await this.requestTerminal({ ok: true });
    } else {
      await this.fail(this.shutdownEvidence.reason);
    }
  }

  private fail(reason: string): Promise<void> {
    return this.requestTerminal({ ok: false, reason });
  }

  private requestTerminal(result: G2RunResult): Promise<void> {
    if (this.terminalResult !== undefined) return this.cleanupPromise;
    this.terminalResult = result;
    this.beginTerminalCleanup();
    return this.cleanupPromise;
  }

  private beginTerminalCleanup(): void {
    this.clearBlockedTimer();
    this.clearManualCloseTimer();
    this.controller.stop();
    this.driver?.stop();

    if (this.child !== undefined && !this.childClosed) {
      if (!this.childKillRequested) {
        this.childKillRequested = true;
        try {
          this.child.kill();
        } catch {
          this.safeLog({ event: "g2-child-kill-threw" });
        }
      }
      this.childCleanupTimerId ??= this.dependencies.timers.setTimeout(
        () => void this.onChildCleanupDeadline(),
        5_000,
      );
      return;
    }
    void this.finalizeCleanup();
  }

  private async onChildCleanupDeadline(): Promise<void> {
    if (this.cleanupStarted) return;
    if (this.shutdownEvidence === null) {
      try {
        this.shutdownEvidence = await this.dependencies.classifyShutdown(null);
      } catch {
        // Evidence records a null shutdown when no settled child snapshot is available.
      }
    }
    await this.finalizeCleanup();
  }

  private async finalizeCleanup(): Promise<void> {
    if (this.cleanupStarted) return this.cleanupPromise;
    this.cleanupStarted = true;
    this.clearBlockedTimer();
    this.clearManualCloseTimer();
    this.clearChildCleanupTimer();
    this.safeDispose(this.disposeStart);
    this.disposeStart = undefined;
    this.safeDispose(this.disposeSecondary);
    this.disposeSecondary = undefined;
    this.safeDispose(this.disposeChildClose);
    this.disposeChildClose = undefined;

    let bridgeCloseFailureReason: string | undefined;
    if (this.bridge !== undefined) {
      let bridgeCloseTimerId: OneLoopTimerHandle | undefined;
      try {
        const bridge = this.bridge;
        const outcome = await Promise.race([
          Promise.resolve()
            .then(() => bridge.close())
            .then(
              () => "closed" as const,
              () => "failed" as const,
            ),
          new Promise<"timed-out">((resolve) => {
            bridgeCloseTimerId = this.dependencies.timers.setTimeout(
              () => resolve("timed-out"),
              5_000,
            );
          }),
        ]);
        if (outcome === "failed") {
          bridgeCloseFailureReason = "g2-bridge-close-failed";
          this.safeLog({ event: "g2-bridge-close-failed" });
        } else if (outcome === "timed-out") {
          bridgeCloseFailureReason = "g2-bridge-close-timeout";
          this.safeLog({ event: "g2-bridge-close-timeout" });
        }
      } finally {
        if (bridgeCloseTimerId !== undefined) {
          this.dependencies.timers.clearTimeout(bridgeCloseTimerId);
        }
      }
    }
    try {
      this.secondary?.close();
    } catch {
      this.safeLog({ event: "g2-secondary-close-failed" });
    }

    let result: G2RunResult = this.terminalResult ?? {
      ok: false as const,
      reason: "controller-stopped",
    };
    if (result.ok && bridgeCloseFailureReason !== undefined) {
      result = { ok: false, reason: bridgeCloseFailureReason };
    }
    if (this.validationSucceeded) {
      try {
        await this.dependencies.finalizeEvidence({
          result,
          placement: this.placementReceipt ?? null,
          completedLoops: this.completedReset ? 1 : 0,
          maxDriftMs: this.maxDriftMs,
          resetRestoredPoem: this.completedReset,
          shutdown: this.shutdownEvidence,
        });
      } catch {
        result = { ok: false, reason: "g2-evidence-write-failed" };
      }
    }
    this.safeLog({
      event: "g2-runtime-cleanup",
      ok: result.ok,
      failureReason: result.ok ? null : result.reason,
      completedLoops: this.completedReset ? 1 : 0,
      maxDriftMs: this.maxDriftMs,
      placementRecorded: this.placementReceipt !== undefined,
    });
    this.resolveCompletion(result);
    this.resolveCleanup();
  }

  private sendStatus(
    state: ControllerStatusEvent["state"],
    reason?: string,
  ): void {
    const event: ControllerStatusEvent =
      reason === undefined
        ? { schema: 1, type: "controller-status", state }
        : { schema: 1, type: "controller-status", state, reason };
    this.requiredSecondary().send(event);
  }

  private clearBlockedTimer(): void {
    if (this.blockedTimerId === undefined) return;
    this.dependencies.timers.clearTimeout(this.blockedTimerId);
    this.blockedTimerId = undefined;
  }

  private clearManualCloseTimer(): void {
    if (this.manualCloseTimerId === undefined) return;
    this.dependencies.timers.clearTimeout(this.manualCloseTimerId);
    this.manualCloseTimerId = undefined;
  }

  private clearChildCleanupTimer(): void {
    if (this.childCleanupTimerId === undefined) return;
    this.dependencies.timers.clearTimeout(this.childCleanupTimerId);
    this.childCleanupTimerId = undefined;
  }

  private safeDispose(dispose: (() => void) | undefined): void {
    if (dispose === undefined) return;
    try {
      dispose();
    } catch {
      this.safeLog({ event: "g2-dispose-failed" });
    }
  }

  private safeLog(event: Record<string, unknown>): void {
    try {
      this.dependencies.log(event);
    } catch {
      // Cleanup must remain bounded even when logging is unavailable.
    }
  }

  private requiredBridge(): G2BridgeHandle {
    if (this.bridge === undefined) throw new Error("G2 bridge is unavailable");
    return this.bridge;
  }

  private requiredSecondary(): G2SecondaryHandle {
    if (this.secondary === undefined) throw new Error("G2 secondary is unavailable");
    return this.secondary;
  }

  private requiredLoop(): DeterministicShowLoop {
    if (this.loop === undefined) throw new Error("G2 loop is unavailable");
    return this.loop;
  }
}
