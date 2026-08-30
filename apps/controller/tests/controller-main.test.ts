import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { RendererToControllerEvent } from "../../../packages/show-schema/src/index.ts";
import { hashDisplayGeometry, type DisplayMapConfig } from "../src/display-router.ts";
import * as controllerMain from "../src/main.ts";
import {
  ShowController,
  bindLocalStartRequest,
  type ControllerDependencies,
  type StartRequest,
} from "../src/main.ts";
import * as preloadModule from "../src/preload.ts";

type RendererIpcListener = (
  event: { sender?: unknown; senderFrame: { url: string } | null },
  payload: unknown,
) => void;

type Task9ControllerMain = {
  bindLocalRendererEvents?: (
    ipcMain: {
      on(channel: string, listener: RendererIpcListener): void;
      removeListener(channel: string, listener: RendererIpcListener): void;
    },
    readyPageUrl: string,
    onEvent: (event: RendererToControllerEvent) => void,
    expectedSender?: unknown,
  ) => () => void;
};

function makeController(overrides: Partial<ControllerDependencies> = {}) {
  const calls: string[] = [];
  const dependencies: ControllerDependencies = {
    validateManifestsAndHashes: async () => {
      calls.push("validate");
      return { ok: true };
    },
    routeDisplays: async () => {
      calls.push("displays");
      return {
        state: "mapped",
        primary: {
          displayId: "primary",
          bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          scaleFactor: 1,
        },
        secondary: {
          displayId: "secondary",
          bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
          scaleFactor: 1,
        },
      };
    },
    openSecondaryReady: async () => {
      calls.push("secondary-ready");
    },
    startBridge: async () => {
      calls.push("bridge");
      return { host: "127.0.0.1", port: 32123, token: "controller-token-2026" };
    },
    startJanVim: async () => {
      calls.push("janvim");
      return { ok: true, pid: 5150 };
    },
    placeJanVimWindow: async () => {
      calls.push("place-window");
      return { ok: true };
    },
    awaitAgentStatus: async () => {
      calls.push("agent-status");
      return { ok: true };
    },
    holdReady: (reason) => {
      calls.push(`ready:${reason}`);
    },
    beginMonotonicLoop: () => {
      calls.push("loop-start");
    },
    ...overrides,
  };
  return { controller: new ShowController(dependencies), calls };
}

describe("controller composition root", () => {
  it("boots in the fixed validation/display/ready/bridge/JanVim/agent order", async () => {
    const { controller, calls } = makeController();

    await expect(controller.boot()).resolves.toEqual({ ready: true });

    expect(calls).toEqual([
      "validate",
      "displays",
      "secondary-ready",
      "bridge",
      "janvim",
      "place-window",
      "agent-status",
    ]);
    expect(controller.state).toBe("ready");
    expect(calls).not.toContain("loop-start");
  });

  it("begins the monotonic loop only once after an exact local Start request", async () => {
    const { controller, calls } = makeController();
    await controller.boot();

    expect(controller.requestStart({ schema: 1, source: "remote-page" })).toBe(false);
    const localRequest: StartRequest = { schema: 1, source: "local-ready-page" };
    expect(controller.requestStart(localRequest)).toBe(true);
    expect(controller.requestStart(localRequest)).toBe(false);
    expect(calls.filter((call) => call === "loop-start")).toHaveLength(1);
    expect(controller.state).toBe("running");
  });

  it("holds ready and stops advancing after each failed prerequisite", async () => {
    const validationFailure = makeController({
      validateManifestsAndHashes: async () => ({ ok: false, reason: "manifest-hash-mismatch" }),
    });
    await expect(validationFailure.controller.boot()).resolves.toEqual({
      ready: false,
      reason: "manifest-hash-mismatch",
    });
    expect(validationFailure.calls).toEqual(["ready:manifest-hash-mismatch"]);

    const displayFailure = makeController({
      routeDisplays: async () => ({ state: "ready", reason: "display-count-mismatch" }),
    });
    await displayFailure.controller.boot();
    expect(displayFailure.calls).toEqual([
      "validate",
      "ready:display-count-mismatch",
    ]);

    const placementFailure = makeController({
      placeJanVimWindow: async () => ({ ok: false, reason: "window-rectangle-mismatch" }),
    });
    await placementFailure.controller.boot();
    expect(placementFailure.calls.at(-1)).toBe("ready:window-rectangle-mismatch");
    expect(placementFailure.calls).not.toContain("agent-status");
    expect(placementFailure.calls).not.toContain("loop-start");
  });

  it("accepts Start only from the exact local ready frame and unregisters the exact IPC listener", async () => {
    const { controller, calls } = makeController();
    await controller.boot();
    let registered: RendererIpcListener | undefined;
    const removed: unknown[] = [];
    const unbind = bindLocalStartRequest(
      {
        on: (channel, listener) => {
          expect(channel).toBe("janvim-exhibition:renderer-event");
          registered = listener;
        },
        removeListener: (channel, listener) => {
          expect(channel).toBe("janvim-exhibition:renderer-event");
          removed.push(listener);
        },
      },
      controller,
      "file:///show/safety.html",
    );

    const request = { schema: 1, type: "operator-action", action: "start" } as const;
    registered?.({ senderFrame: { url: "https://example.com/" } }, request);
    registered?.({ senderFrame: { url: "file:///show/safety.html" } }, { ...request, extra: true });
    expect(calls).not.toContain("loop-start");

    registered?.({ senderFrame: { url: "file:///show/safety.html" } }, request);
    expect(calls.filter((call) => call === "loop-start")).toHaveLength(1);

    unbind();
    unbind();
    expect(removed).toEqual([registered]);
  });

  it("delivers strict renderer events only from the exact local file frame", () => {
    const bindLocalRendererEvents = (controllerMain as Task9ControllerMain)
      .bindLocalRendererEvents;
    expect(bindLocalRendererEvents).toBeTypeOf("function");
    expect(
      (preloadModule as { RENDERER_EVENT_CHANNEL?: string }).RENDERER_EVENT_CHANNEL,
    ).toBe("janvim-exhibition:renderer-event");

    let registered: RendererIpcListener | undefined;
    const removed: unknown[] = [];
    const received: RendererToControllerEvent[] = [];
    const ipc = {
      on: (_channel: string, listener: RendererIpcListener) => {
        registered = listener;
      },
      removeListener: (_channel: string, listener: RendererIpcListener) => {
        removed.push(listener);
      },
    };
    const readyPageUrl = "file:///show/safety.html";
    const unbind = bindLocalRendererEvents?.(ipc, readyPageUrl, (event) => {
      received.push(event);
    });
    const presentation = {
      schema: 1,
      type: "presentation-ack",
      generationId: 2,
      loopId: "loop-2",
      cueId: "cue-reset",
    } as const;

    registered?.({ senderFrame: { url: "https://example.com/" } }, presentation);
    registered?.({ senderFrame: null }, presentation);
    registered?.(
      { senderFrame: { url: readyPageUrl } },
      { ...presentation, generationId: 0 },
    );
    registered?.(
      { senderFrame: { url: readyPageUrl } },
      { ...presentation, shell: "pwsh" },
    );
    expect(received).toEqual([]);

    registered?.(
      { sender: { id: "unscoped-g2-sender" }, senderFrame: { url: readyPageUrl } },
      presentation,
    );
    expect(received).toEqual([presentation]);

    unbind?.();
    unbind?.();
    expect(removed).toEqual([registered]);
    expect(() =>
      bindLocalRendererEvents?.(ipc, "https://example.com/", () => undefined),
    ).toThrowError(/local file/i);
  });

  it("requires the exact current sender for Start, Stop, and presentation ACK", () => {
    const bindLocalRendererEvents = (controllerMain as Task9ControllerMain)
      .bindLocalRendererEvents;
    expect(bindLocalRendererEvents).toBeTypeOf("function");

    let registered: RendererIpcListener | undefined;
    const received: RendererToControllerEvent[] = [];
    const readyPageUrl = "file:///show/safety.html";
    const oldSender = { id: "old-renderer" };
    const currentSender = { id: "current-renderer" };
    const events = [
      { schema: 1, type: "operator-action", action: "start" },
      { schema: 1, type: "operator-action", action: "stop-show" },
      {
        schema: 1,
        type: "presentation-ack",
        generationId: 2,
        loopId: "loop-2",
        cueId: "cue-reset",
      },
    ] as const;

    bindLocalRendererEvents?.(
      {
        on: (_channel, listener) => {
          registered = listener;
        },
        removeListener: () => undefined,
      },
      readyPageUrl,
      (event) => received.push(event),
      currentSender,
    );

    for (const event of events) {
      registered?.(
        { sender: oldSender, senderFrame: { url: readyPageUrl } },
        event,
      );
    }
    expect(received).toEqual([]);

    for (const event of events) {
      registered?.(
        { sender: currentSender, senderFrame: { url: readyPageUrl } },
        event,
      );
    }
    expect(received).toEqual(events);
  });

  it("emits Node-compatible ESM imports for the built Electron main", () => {
    const source = readFileSync(
      join(process.cwd(), "apps", "controller", "src", "main.ts"),
      "utf8",
    );
    expect(source).toContain('from "./preload.js"');
  });
});

describe("show-only checked-in defaults", () => {
  const showRoot = join(process.cwd(), "show");

  it("keeps the unknown physical display mapping explicitly unconfirmed with self-consistent hashes", () => {
    const config = JSON.parse(
      readFileSync(join(showRoot, "display-map.json"), "utf8"),
    ) as DisplayMapConfig;
    expect(config.mappingStatus).toBe("unconfirmed");
    expect(config.primary.geometrySha256).toBe(hashDisplayGeometry(config.primary));
    expect(config.secondary.geometrySha256).toBe(hashDisplayGeometry(config.secondary));
  });

  it("ships a local safety page and a repository-relative JanVim show config", () => {
    const safety = readFileSync(join(showRoot, "safety.html"), "utf8");
    const showConfig = readFileSync(join(showRoot, "janvim-show.toml"), "utf8");

    expect(safety).toContain("WAITING FOR CONTROLLER CHECKS");
    expect(safety).not.toMatch(/https?:\/\//i);
    expect(showConfig).not.toMatch(/[A-Za-z]:\\/);
    expect(showConfig).not.toContain("D:/github/JanVim");
  });
});
