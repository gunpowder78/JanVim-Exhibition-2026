import { z } from "zod";

import type { DisplayRoute, Rectangle, RuntimeDisplay } from "./display-router.js";
import { REQUEST_START_CHANNEL } from "./preload.js";

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
  if (!isLocalFileUrl(readyPageUrl)) {
    throw new Error("Ready page URL must be a local file URL");
  }

  const listener = (event: LocalStartIpcEvent, payload: unknown): void => {
    if (event.senderFrame?.url !== readyPageUrl) return;
    controller.requestStart(payload);
  };
  ipcMain.on(REQUEST_START_CHANNEL, listener);

  let bound = true;
  return () => {
    if (!bound) return;
    bound = false;
    ipcMain.removeListener(REQUEST_START_CHANNEL, listener);
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
