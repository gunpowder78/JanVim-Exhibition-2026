import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseShowManifest,
  type AgentAck,
  type AgentCommand,
  type Cue,
  type RendererToControllerEvent,
  type ShowManifest,
} from "../../../packages/show-schema/src/index.ts";
import { hashDisplayGeometry, type DisplayMapConfig } from "../src/display-router.ts";
import * as controllerMain from "../src/main.ts";
import {
  ShowController,
  DeterministicShowLoop,
  bindLocalStartRequest,
  type ControllerDependencies,
  type ShowLoopAgent,
  type ShowLoopRenderer,
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

const resetOrderFixtureRoot = join(process.cwd(), "content", "fixture");
const resetOrderPoem = readFileSync(join(resetOrderFixtureRoot, "poem.txt"), "utf8");
const resetOrderManifest = parseShowManifest(
  JSON.parse(readFileSync(join(resetOrderFixtureRoot, "show.manifest.json"), "utf8")),
);
const resetOrderToken = "controller-reset-order-token-2026";

function acknowledgement(
  command: AgentCommand,
  poemSha256: string,
  overrides: Partial<AgentAck> = {},
): AgentAck {
  return {
    schema: 1,
    loopId: command.loopId,
    cueId: command.cueId,
    outcome: "applied",
    mode: "normal",
    cursor: { row: 0, col: 0 },
    bufferSha256: poemSha256,
    ...overrides,
  };
}

function createResetOrderLoop(
  onReset: (command: AgentCommand) => Promise<AgentAck>,
): { loop: DeterministicShowLoop; trace: string[]; clock: { now: number } } {
  const trace: string[] = [];
  const clock = { now: 0 };
  const renderer: ShowLoopRenderer = {
    apply: (cue: Cue) => {
      if (cue.kind === "editor-action" && cue.payload.action.type === "reset") {
        trace.push("renderer:reset");
      }
    },
    showReady: (loopId) => {
      if (loopId !== resetOrderManifest.loopId) trace.push("next-loop-ready");
    },
  };
  const agent: ShowLoopAgent = {
    dispatch: async (command) => {
      if (command.action.type === "reset") {
        trace.push("agent:reset");
        return onReset(command);
      }
      return acknowledgement(command, resetOrderManifest.poemSha256);
    },
  };
  let nextLoopNumber = 0;
  const loop = new DeterministicShowLoop({
    manifest: resetOrderManifest,
    poem: resetOrderPoem,
    token: resetOrderToken,
    clock: { nowMonotonic: () => clock.now },
    renderer,
    agent,
    generateLoopId: () => `reset-order-next-${++nextLoopNumber}`,
    onSafeBlack: () => trace.push("safe-black"),
  });
  return { loop, trace, clock };
}

async function beginReset(
  loop: DeterministicShowLoop,
  clock: { now: number },
): Promise<{ advance: Promise<number> }> {
  await expect(loop.prepare()).resolves.toBe(true);
  expect(loop.start()).toBe(true);
  for (const cue of resetOrderManifest.cues) {
    clock.now = cue.atMs;
    if (cue.id === "cue-reset") return { advance: loop.advance() };
    await loop.advance();
  }
  throw new Error("reset fixture cue missing");
}

const resetFailures: ReadonlyArray<[
  string,
  (command: AgentCommand) => Promise<AgentAck>,
]> = [
  ["dispatch rejection", () => Promise.reject(new Error("reset dispatch rejected"))],
  [
    "wrong original-poem hash",
    (command) => Promise.resolve(acknowledgement(command, "wrong-poem-hash")),
  ],
  [
    "failed outcome",
    (command) =>
      Promise.resolve(
        acknowledgement(command, resetOrderManifest.poemSha256, { outcome: "failed" }),
      ),
  ],
  [
    "wrong loop ID",
    (command) =>
      Promise.resolve(
        acknowledgement(command, resetOrderManifest.poemSha256, { loopId: "wrong-loop" }),
      ),
  ],
  [
    "wrong cue ID",
    (command) =>
      Promise.resolve(
        acknowledgement(command, resetOrderManifest.poemSha256, { cueId: "wrong-cue" }),
      ),
  ],
];

describe("controller composition root", () => {
  it("waits for the primary reset ACK before resetting the secondary and readying the next loop", async () => {
    let resolveReset: ((acknowledgement: AgentAck) => void) | undefined;
    const resetAck = new Promise<AgentAck>((resolve) => {
      resolveReset = resolve;
    });
    const { loop, trace, clock } = createResetOrderLoop(() => resetAck);

    const { advance } = await beginReset(loop, clock);
    expect(trace).toEqual(["agent:reset"]);

    if (resolveReset === undefined) throw new Error("reset ACK resolver missing");
    resolveReset(
      acknowledgement(
        {
          schema: 1,
          token: resetOrderToken,
          loopId: resetOrderManifest.loopId,
          cueId: "cue-reset",
          action: { type: "reset" },
        },
        resetOrderManifest.poemSha256,
      ),
    );
    await advance;

    expect(trace).toEqual(["agent:reset", "renderer:reset", "next-loop-ready"]);
    expect(loop.resourceDiagnostics().pendingAgentCommands).toBe(0);
  });

  it.each(resetFailures)(
    "enters safe black without secondary reset or next-loop readiness after a reset %s",
    async (_failure, reset) => {
      const { loop, trace, clock } = createResetOrderLoop(reset);

      const { advance } = await beginReset(loop, clock);
      await advance;

      expect(trace).toEqual(["agent:reset", "safe-black"]);
      expect(loop.state).toBe("safe-black");
      expect(loop.completedLoops).toBe(0);
      expect(loop.resourceDiagnostics().pendingAgentCommands).toBe(0);
    },
  );

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

  it("rolls back IPC when listener registration installs and then throws", () => {
    const bindLocalRendererEvents = (controllerMain as Task9ControllerMain)
      .bindLocalRendererEvents;
    expect(bindLocalRendererEvents).toBeTypeOf("function");
    let registered: RendererIpcListener | undefined;
    const removed: RendererIpcListener[] = [];

    expect(() =>
      bindLocalRendererEvents?.(
        {
          on: (_channel, listener) => {
            registered = listener;
            throw new Error("ipc-registration-failed");
          },
          removeListener: (_channel, listener) => {
            removed.push(listener);
            if (registered === listener) registered = undefined;
          },
        },
        "file:///show/safety.html",
        () => undefined,
      ),
    ).toThrow("ipc-registration-failed");

    expect(registered).toBeUndefined();
    expect(removed).toHaveLength(1);
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
