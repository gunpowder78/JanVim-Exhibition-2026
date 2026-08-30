import { createHash } from "node:crypto";

import type {
  AgentAck,
  AgentCommand,
  Cue,
  RendererToControllerEvent,
  ShowManifest,
} from "@janvim-exhibition/show-schema";
import { parseRendererToControllerEvent } from "@janvim-exhibition/show-schema";
import { z } from "zod";

import { CueDispatcher } from "./cue-dispatcher.js";
import type { DisplayRoute, Rectangle, RuntimeDisplay } from "./display-router.js";
import { RENDERER_EVENT_CHANNEL } from "./preload.js";
import { Scheduler } from "./scheduler.js";

export interface StartRequest {
  schema: 1;
  source: "local-ready-page";
}

export type ControllerState = "booting" | "ready" | "running" | "stopped";

export interface ControllerDependencies {
  validateManifestsAndHashes: () => Promise<
    { ok: true } | { ok: false; reason: string }
  >;
  routeDisplays: () => Promise<DisplayRoute>;
  openSecondaryReady: (secondary: RuntimeDisplay) => Promise<void>;
  startBridge: () => Promise<{ host: "127.0.0.1"; port: number; token: string }>;
  startJanVim: (bridge: {
    host: "127.0.0.1";
    port: number;
    token: string;
  }) => Promise<{ ok: true; pid: number } | { ok: false; reason: string }>;
  placeJanVimWindow: (
    pid: number,
    bounds: Rectangle,
  ) => Promise<{ ok: true } | { ok: false; reason: string }>;
  awaitAgentStatus: (bridge: {
    host: "127.0.0.1";
    port: number;
    token: string;
  }) => Promise<{ ok: true } | { ok: false; reason: string }>;
  holdReady: (reason: string) => void;
  beginMonotonicLoop: () => void;
}

export interface LocalStartIpcEvent {
  sender?: unknown;
  senderFrame: { url: string } | null;
}

export interface IpcMainAdapter {
  on(
    channel: string,
    listener: (event: LocalStartIpcEvent, payload: unknown) => void,
  ): void;
  removeListener(
    channel: string,
    listener: (event: LocalStartIpcEvent, payload: unknown) => void,
  ): void;
}

const startRequestSchema = z
  .object({
    schema: z.literal(1),
    source: z.literal("local-ready-page"),
  })
  .strict();

export class ShowController {
  private bootAttempted = false;
  private armed = false;
  public state: ControllerState = "booting";

  public constructor(private readonly dependencies: ControllerDependencies) {}

  public async boot(): Promise<{ ready: true } | { ready: false; reason: string }> {
    if (this.bootAttempted) return this.hold("controller-already-booted");
    this.bootAttempted = true;

    try {
      const validation = await this.dependencies.validateManifestsAndHashes();
      if (!validation.ok) return this.hold(validation.reason);

      const route = await this.dependencies.routeDisplays();
      if (route.state !== "mapped") return this.hold(route.reason);

      await this.dependencies.openSecondaryReady(route.secondary);
      const bridge = await this.dependencies.startBridge();
      const janvim = await this.dependencies.startJanVim(bridge);
      if (!janvim.ok) return this.hold(janvim.reason);

      const placement = await this.dependencies.placeJanVimWindow(
        janvim.pid,
        route.primary.bounds,
      );
      if (!placement.ok) return this.hold(placement.reason);

      const agent = await this.dependencies.awaitAgentStatus(bridge);
      if (!agent.ok) return this.hold(agent.reason);

      this.armed = true;
      this.state = "ready";
      return { ready: true };
    } catch {
      return this.hold("controller-boot-failed");
    }
  }

  public requestStart(value: unknown): boolean {
    if (!startRequestSchema.safeParse(value).success || !this.armed || this.state !== "ready") {
      return false;
    }

    this.armed = false;
    try {
      this.dependencies.beginMonotonicLoop();
      this.state = "running";
      return true;
    } catch {
      this.hold("loop-start-failed");
      return false;
    }
  }

  public stop(): void {
    this.armed = false;
    this.state = "stopped";
  }

  private hold(reason: string): { ready: false; reason: string } {
    this.armed = false;
    this.state = "ready";
    this.dependencies.holdReady(reason);
    return { ready: false, reason };
  }
}

export function bindLocalStartRequest(
  ipcMain: IpcMainAdapter,
  controller: ShowController,
  readyPageUrl: string,
): () => void {
  return bindLocalRendererEvents(ipcMain, readyPageUrl, (event) => {
    if (event.type !== "operator-action" || event.action !== "start") return;
    controller.requestStart({ schema: 1, source: "local-ready-page" });
  });
}

export function bindLocalRendererEvents(
  ipcMain: IpcMainAdapter,
  readyPageUrl: string,
  onEvent: (event: RendererToControllerEvent) => void,
  expectedSender?: unknown,
): () => void {
  if (!isLocalFileUrl(readyPageUrl)) {
    throw new Error("Ready page URL must be a local file URL");
  }

  const listener = (event: LocalStartIpcEvent, payload: unknown): void => {
    if (expectedSender !== undefined && event.sender !== expectedSender) return;
    if (event.senderFrame?.url !== readyPageUrl) return;
    try {
      onEvent(parseRendererToControllerEvent(payload));
    } catch {
      // Invalid or unknown renderer events fail closed in Electron main.
    }
  };
  ipcMain.on(RENDERER_EVENT_CHANNEL, listener);

  let bound = true;
  return () => {
    if (!bound) return;
    bound = false;
    ipcMain.removeListener(RENDERER_EVENT_CHANNEL, listener);
  };
}

function isLocalFileUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "file:" && parsed.hostname.length === 0;
  } catch {
    return false;
  }
}

export type DeterministicShowLoopState =
  | "booting"
  | "ready"
  | "running"
  | "safe-black"
  | "stopped";

export interface ShowLoopRenderer {
  apply(cue: Cue): void;
  showReady(loopId: string): void;
}

export interface ShowLoopAgent {
  dispatch(command: AgentCommand): Promise<AgentAck>;
}

export interface DeterministicShowLoopOptions {
  manifest: ShowManifest;
  poem: string;
  token: string;
  clock: { nowMonotonic: () => number };
  renderer: ShowLoopRenderer;
  agent: ShowLoopAgent;
  generateLoopId: () => string;
  onSafeBlack?: (reason: string) => void;
}

export class DeterministicShowLoop {
  private readonly scheduler: Scheduler;
  private readonly dispatcher: CueDispatcher;
  private readonly manifest: ShowManifest;
  private readonly poem: string;
  private readonly token: string;
  private readonly renderer: ShowLoopRenderer;
  private readonly agent: ShowLoopAgent;
  private readonly onSafeBlack?: (reason: string) => void;
  private pendingAgentCommands = 0;
  private pendingEditorCommand?: Promise<void>;
  private advancing = false;
  private resultComplete = false;
  private resultAccepted = false;
  public state: DeterministicShowLoopState = "booting";
  public completedLoops = 0;

  public constructor(options: DeterministicShowLoopOptions) {
    if (!/^[A-Za-z0-9._-]{16,}$/.test(options.token)) {
      throw new Error("Show loop token format is invalid");
    }
    if (sha256(options.poem) !== options.manifest.poemSha256) {
      throw new Error("Show loop poem hash does not match the manifest");
    }

    this.manifest = options.manifest;
    this.poem = options.poem;
    this.token = options.token;
    this.renderer = options.renderer;
    this.agent = options.agent;
    this.onSafeBlack = options.onSafeBlack;
    this.scheduler = new Scheduler({
      manifest: options.manifest,
      clock: options.clock,
      initialLoopId: options.manifest.loopId,
    });
    this.dispatcher = new CueDispatcher({
      clock: options.clock,
      initialLoopId: options.manifest.loopId,
      generateLoopId: options.generateLoopId,
      onVisualCue: (cue) => this.renderer.apply(cue),
      onEditorCue: (cue) => this.beginEditorCommand(cue),
      onSafeBlack: (reason) => this.enterSafeBlack(reason),
      onLoopReset: (loopId) => this.renderer.showReady(loopId),
    });
  }

  public async prepare(): Promise<boolean> {
    if (this.state !== "booting") return false;
    const loopId = this.dispatcher.currentLoopId;
    let acknowledgement: AgentAck;
    try {
      acknowledgement = await this.dispatchAgent({
        schema: 1,
        token: this.token,
        loopId,
        cueId: `${loopId}-prepare`,
        action: {
          type: "prepare",
          poem: this.poem,
          expectedSha256: this.manifest.poemSha256,
        },
      });
    } catch {
      this.enterSafeBlack("agent prepare failed");
      return false;
    }

    if (
      !isSuccessfulAcknowledgement(acknowledgement, loopId, `${loopId}-prepare`) ||
      acknowledgement.bufferSha256 !== this.manifest.poemSha256
    ) {
      this.enterSafeBlack("agent prepare acknowledgement invalid");
      return false;
    }

    this.state = "ready";
    this.renderer.showReady(loopId);
    return true;
  }

  public start(): boolean {
    if (this.state !== "ready") return false;
    this.resultComplete = false;
    this.resultAccepted = false;
    this.scheduler.startLoop(this.dispatcher.currentLoopId);
    this.dispatcher.start();
    this.state = "running";
    return true;
  }

  public async advance(): Promise<number> {
    if (this.state !== "running" || this.advancing) return 0;
    this.advancing = true;
    let processed = 0;
    try {
      for (const event of this.scheduler.takeDueCues()) {
        if (this.state !== "running") break;
        const cue = event.cue;
        if (cue.kind !== "editor-action") {
          if (cue.kind === "token-stream") {
            const reachesSecondary = cue.target === "secondary" || cue.target === "both";
            if (cue.payload.complete === true) {
              if (
                !reachesSecondary ||
                typeof cue.payload.text !== "string" ||
                cue.payload.text.trim().length === 0
              ) {
                this.enterSafeBlack("result completion was not visibly rendered");
                break;
              }
              this.resultComplete = true;
            }
            if (cue.payload.accepted === true) {
              if (
                !reachesSecondary ||
                !this.resultComplete ||
                typeof cue.payload.summary !== "string" ||
                cue.payload.summary.trim().length === 0
              ) {
                this.enterSafeBlack("result acceptance preceded visible completion");
                break;
              }
              this.resultAccepted = true;
            }
          }
          this.dispatcher.dispatch(cue);
          processed += 1;
          continue;
        }

        if (cue.payload.action.type === "reset") {
          await this.applyReset(cue, event.loopId);
          processed += 1;
          break;
        }
        if (!this.resultComplete || !this.resultAccepted) {
          this.enterSafeBlack("editor cue preceded result completion or acceptance");
          break;
        }

        this.dispatcher.dispatch(cue);
        const pending = this.pendingEditorCommand;
        if (pending === undefined) {
          this.enterSafeBlack("editor cue did not create an agent command");
          break;
        }
        await pending;
        if (this.pendingEditorCommand === pending) this.pendingEditorCommand = undefined;
        processed += 1;
      }
      return processed;
    } finally {
      this.advancing = false;
    }
  }

  public stop(): void {
    if (this.state === "stopped") return;
    this.dispatcher.stop();
    this.scheduler.enterStopped();
    this.state = "stopped";
  }

  public resourceDiagnostics(): {
    controllerListeners: 0;
    controllerTimers: 0;
    pendingAgentCommands: number;
    pendingEditorCues: number;
  } {
    return {
      controllerListeners: 0,
      controllerTimers: 0,
      pendingAgentCommands: this.pendingAgentCommands,
      pendingEditorCues: this.dispatcher.diagnostics().pendingEditorCues,
    };
  }

  private beginEditorCommand(cue: Extract<Cue, { kind: "editor-action" }>): void {
    if (this.pendingEditorCommand !== undefined) {
      this.dispatcher.failPending("multiple editor commands became pending");
      return;
    }
    this.renderer.apply(cue);
    const loopId = this.dispatcher.currentLoopId;
    this.pendingEditorCommand = this.sendEditorCommand(cue, loopId);
  }

  private async sendEditorCommand(
    cue: Extract<Cue, { kind: "editor-action" }>,
    loopId: string,
  ): Promise<void> {
    let acknowledgement: AgentAck | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        acknowledgement = await this.dispatchAgent({
          schema: 1,
          token: this.token,
          loopId,
          cueId: cue.id,
          action: cue.payload.action,
        });
        break;
      } catch {
        if (attempt === 1) {
          this.dispatcher.failPending("editor cue dispatch failed after bounded retry");
          return;
        }
      }
    }

    if (acknowledgement === undefined) return;
    if (acknowledgement.loopId !== loopId || acknowledgement.cueId !== cue.id) {
      this.dispatcher.failPending("editor cue acknowledgement identity mismatch");
      return;
    }
    this.dispatcher.ack(acknowledgement);
  }

  private async applyReset(
    cue: Extract<Cue, { kind: "editor-action" }>,
    loopId: string,
  ): Promise<void> {
    this.renderer.apply(cue);
    let acknowledgement: AgentAck;
    try {
      acknowledgement = await this.dispatchAgent({
        schema: 1,
        token: this.token,
        loopId,
        cueId: cue.id,
        action: cue.payload.action,
      });
    } catch {
      this.enterSafeBlack("reset dispatch failed");
      return;
    }

    if (
      !isSuccessfulAcknowledgement(acknowledgement, loopId, cue.id) ||
      acknowledgement.bufferSha256 !== this.manifest.poemSha256
    ) {
      this.enterSafeBlack("reset acknowledgement invalid");
      return;
    }

    this.completedLoops += 1;
    this.resultComplete = false;
    this.resultAccepted = false;
    this.dispatcher.rotateLoop();
    this.scheduler.startLoop(this.dispatcher.currentLoopId);
    this.dispatcher.start();
    this.state = "running";
  }

  private async dispatchAgent(command: AgentCommand): Promise<AgentAck> {
    this.pendingAgentCommands += 1;
    try {
      return await this.agent.dispatch(command);
    } finally {
      this.pendingAgentCommands -= 1;
    }
  }

  private enterSafeBlack(reason: string): void {
    if (this.state === "safe-black" || this.state === "stopped") return;
    if (this.scheduler.state === "running") this.scheduler.enterSafeBlack();
    this.state = "safe-black";
    this.onSafeBlack?.(reason);
  }
}

function isSuccessfulAcknowledgement(
  acknowledgement: AgentAck,
  loopId: string,
  cueId: string,
): boolean {
  return (
    acknowledgement.loopId === loopId &&
    acknowledgement.cueId === cueId &&
    (acknowledgement.outcome === "applied" || acknowledgement.outcome === "duplicate")
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
