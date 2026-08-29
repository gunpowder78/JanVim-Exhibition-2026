// @vitest-environment jsdom

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import {
  parseShowManifest,
  type AgentAck,
  type AgentCommand,
  type Cue,
  type ShowManifest,
} from "../packages/show-schema/src/index.ts";
import {
  DeterministicShowLoop,
  type ShowLoopAgent,
  type ShowLoopRenderer,
} from "../apps/controller/src/main.ts";
import { SecondarySceneController } from "../apps/secondary-screen/src/scene-controller.ts";

const fixtureRoot = join(process.cwd(), "content", "fixture");
const poem = readFileSync(join(fixtureRoot, "poem.txt"), "utf8");
const fixtureManifest = parseShowManifest(
  JSON.parse(readFileSync(join(fixtureRoot, "show.manifest.json"), "utf8")),
);
const token = "fixture-first-loop-token-2026";

type ObservedEvent = {
  type:
    | "ready"
    | "prompt-start"
    | "response-complete"
    | "accepted"
    | "editor-action"
    | "key-overlay"
    | "editor-ack"
    | "fade"
    | "reset";
  cueId?: string;
  loopId?: string;
  bufferSha256?: string;
  outcome?: AgentAck["outcome"];
};

class FakeClock {
  public now = 0;

  public set(value: number): void {
    if (value < this.now) throw new Error("fake monotonic clock cannot move backwards");
    this.now = value;
  }
}

class FakeAgent implements ShowLoopAgent {
  public readonly commands: AgentCommand[] = [];
  public bufferSha256 = "";
  public pendingCommands = 0;
  public readonly listenerCount = 0;
  public readonly timerCount = 0;
  private baselinePoem = "";
  private baselineSha256 = "";
  private readonly thrownCueIds = new Set<string>();

  public constructor(
    private readonly events: ObservedEvent[],
    private readonly failCueId?: string,
    private readonly failOutcome: "failed" | "rejected" = "failed",
    private readonly throwOnceCueId?: string,
  ) {}

  public async dispatch(command: AgentCommand): Promise<AgentAck> {
    this.pendingCommands += 1;
    this.commands.push(command);
    try {
      if (
        command.cueId === this.throwOnceCueId &&
        !this.thrownCueIds.has(command.cueId)
      ) {
        this.thrownCueIds.add(command.cueId);
        throw new Error("injected bridge timeout");
      }
      if (command.action.type === "prepare") {
        const actualHash = sha256(command.action.poem);
        if (actualHash !== command.action.expectedSha256) {
          return this.ack(command, "rejected", actualHash);
        }
        this.baselinePoem = command.action.poem;
        this.baselineSha256 = command.action.expectedSha256;
        this.bufferSha256 = this.baselineSha256;
        return this.ack(command, "applied", this.bufferSha256);
      }

      if (command.cueId === this.failCueId) {
        this.events.push({
          type: "editor-ack",
          cueId: command.cueId,
          outcome: this.failOutcome,
          bufferSha256: this.bufferSha256,
        });
        return this.ack(command, this.failOutcome, this.bufferSha256);
      }

      if (command.action.type === "reset") {
        this.bufferSha256 = this.baselineSha256;
        this.events.push({
          type: "editor-ack",
          cueId: command.cueId,
          outcome: "applied",
          bufferSha256: this.bufferSha256,
        });
        return this.ack(command, "applied", this.bufferSha256);
      }

      if (command.action.type === "insert") {
        this.bufferSha256 = sha256(`${this.baselinePoem}\u0000${command.action.text}`);
      } else if (command.action.type === "replace") {
        this.bufferSha256 = sha256(`${this.baselinePoem}\u0000${command.action.text}`);
      }

      this.events.push({
        type: "editor-ack",
        cueId: command.cueId,
        outcome: "applied",
        bufferSha256: this.bufferSha256,
      });
      return this.ack(command, "applied", this.bufferSha256);
    } finally {
      this.pendingCommands -= 1;
    }
  }

  private ack(
    command: AgentCommand,
    outcome: AgentAck["outcome"],
    bufferSha256: string,
  ): AgentAck {
    return {
      schema: 1,
      loopId: command.loopId,
      cueId: command.cueId,
      outcome,
      mode: "normal",
      cursor: { row: 0, col: 0 },
      bufferSha256: bufferSha256 || sha256(""),
    };
  }
}

class FakeRenderer implements ShowLoopRenderer {
  public readonly listenerCount = 0;
  public readonly timerCount = 0;
  private readonly root = document.createElement("main");
  private readonly scene = new SecondarySceneController(this.root, {
    seed: "first-loop-fixture",
    prefersReducedMotion: false,
    measuredFps: 60,
  });

  public constructor(
    private readonly events: ObservedEvent[],
    private readonly currentBufferSha256: () => string,
  ) {}

  public apply(cue: Cue): void {
    this.scene.apply(cue);
    if (cue.kind === "prompt") {
      this.events.push({ type: "prompt-start", cueId: cue.id });
      return;
    }
    if (cue.kind === "token-stream") {
      if (
        cue.payload.complete === true &&
        cue.target !== "main" &&
        typeof cue.payload.text === "string"
      ) {
        expect(this.root.dataset.responseComplete).toBe("true");
        this.events.push({ type: "response-complete", cueId: cue.id });
      }
      if (cue.payload.accepted === true) {
        this.events.push({ type: "accepted", cueId: cue.id });
      }
      return;
    }
    if (cue.kind === "fade") {
      this.events.push({ type: "fade", cueId: cue.id });
      return;
    }
    if (cue.kind !== "editor-action") return;

    if (cue.payload.action.type === "reset") {
      this.events.push({ type: "reset", cueId: cue.id });
      return;
    }

    this.events.push({ type: "editor-action", cueId: cue.id });
    const overlay = this.root.querySelector(`[data-cue-id='${cue.id}']`);
    expect(overlay).not.toBeNull();
    this.events.push({ type: "key-overlay", cueId: overlay?.getAttribute("data-cue-id") ?? "" });
  }

  public showReady(loopId: string): void {
    expect(this.root.dataset.scene).toBe("ready");
    this.events.push({
      type: "ready",
      loopId,
      bufferSha256: this.currentBufferSha256(),
    });
  }
}

type Harness = {
  agent: FakeAgent;
  clock: FakeClock;
  events: ObservedEvent[];
  manifest: ShowManifest;
  renderer: FakeRenderer;
  runtime: DeterministicShowLoop;
};

function createHarness(options: {
  manifest?: ShowManifest;
  failCueId?: string;
  failOutcome?: "failed" | "rejected";
  throwOnceCueId?: string;
} = {}): Harness {
  const events: ObservedEvent[] = [];
  const clock = new FakeClock();
  const agent = new FakeAgent(
    events,
    options.failCueId,
    options.failOutcome,
    options.throwOnceCueId,
  );
  const renderer = new FakeRenderer(events, () => agent.bufferSha256);
  const manifest = options.manifest ?? fixtureManifest;
  let nextLoopNumber = 0;
  const runtime = new DeterministicShowLoop({
    manifest,
    poem,
    token,
    clock: { nowMonotonic: () => clock.now },
    renderer,
    agent,
    generateLoopId: () => {
      nextLoopNumber += 1;
      return `fixture-next-${nextLoopNumber}`;
    },
  });
  return { agent, clock, events, manifest, renderer, runtime };
}

async function startHarness(harness: Harness): Promise<void> {
  await expect(harness.runtime.prepare()).resolves.toBe(true);
  expect(harness.runtime.start()).toBe(true);
}

async function driveCurrentLoop(harness: Harness): Promise<void> {
  const loopStart = harness.clock.now;
  for (const cue of harness.manifest.cues) {
    harness.clock.set(loopStart + cue.atMs);
    await harness.runtime.advance();
  }
}

function cloneManifest(): ShowManifest {
  return JSON.parse(JSON.stringify(fixtureManifest)) as ShowManifest;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("first deterministic causal loop", () => {
  it("runs ready → prompt → complete result → accept → same-cue write/overlay → ACK → fade → reset", async () => {
    const harness = createHarness();
    await startHarness(harness);

    await driveCurrentLoop(harness);

    expect(harness.events.map((event) => event.type)).toEqual([
      "ready",
      "prompt-start",
      "response-complete",
      "accepted",
      "editor-action",
      "key-overlay",
      "editor-ack",
      "fade",
      "reset",
      "editor-ack",
      "ready",
    ]);
    expect(
      harness.events
        .filter((event) => event.cueId === "cue-reset")
        .map((event) => event.type),
    ).toEqual(["reset", "editor-ack"]);
    const editor = harness.events.find((event) => event.type === "editor-action");
    const overlay = harness.events.find((event) => event.type === "key-overlay");
    expect(editor?.cueId).toBe("cue-insert");
    expect(overlay?.cueId).toBe(editor?.cueId);
    expect(harness.events.at(-1)).toMatchObject({
      type: "ready",
      loopId: "fixture-next-1",
      bufferSha256: fixtureManifest.poemSha256,
    });
    expect(harness.agent.bufferSha256).toBe(fixtureManifest.poemSha256);
    expect(harness.runtime.completedLoops).toBe(1);
  });

  it.each([
    ["completion is absent", (manifest: ShowManifest) => {
      const result = manifest.cues.find((cue) => cue.id === "cue-result");
      if (result === undefined) throw new Error("fixture result cue missing");
      delete result.payload.complete;
    }],
    ["completion is targeted only at main", (manifest: ShowManifest) => {
      const result = manifest.cues.find((cue) => cue.id === "cue-result");
      if (result === undefined) throw new Error("fixture result cue missing");
      result.target = "main";
    }],
    ["completion has no visible result text", (manifest: ShowManifest) => {
      const result = manifest.cues.find((cue) => cue.id === "cue-result");
      if (result === undefined) throw new Error("fixture result cue missing");
      result.payload.text = 42;
    }],
    ["acceptance is absent", (manifest: ShowManifest) => {
      const acceptance = manifest.cues.find((cue) => cue.id === "cue-accept");
      if (acceptance === undefined) throw new Error("fixture acceptance cue missing");
      delete acceptance.payload.accepted;
    }],
    ["acceptance has no visible summary", (manifest: ShowManifest) => {
      const acceptance = manifest.cues.find((cue) => cue.id === "cue-accept");
      if (acceptance === undefined) throw new Error("fixture acceptance cue missing");
      acceptance.payload.summary = 42;
    }],
  ] as const)("never dispatches an editor action when %s", async (_label, mutate) => {
    const manifest = cloneManifest();
    mutate(manifest);
    const harness = createHarness({ manifest });
    await startHarness(harness);

    await driveCurrentLoop(harness);

    expect(harness.events.some((event) => event.type === "editor-action")).toBe(false);
    expect(
      harness.agent.commands.some(
        (command) => command.action.type !== "prepare" && command.action.type !== "status",
      ),
    ).toBe(false);
    expect(harness.runtime.state).toBe("safe-black");
  });

  it.each(["failed", "rejected"] as const)(
    "stops the causal chain after a %s editor ACK",
    async (failOutcome) => {
      const harness = createHarness({ failCueId: "cue-insert", failOutcome });
      await startHarness(harness);

      await driveCurrentLoop(harness);

      expect(harness.runtime.state).toBe("safe-black");
      expect(harness.events.some((event) => event.type === "fade")).toBe(false);
      expect(harness.events.some((event) => event.type === "reset")).toBe(false);
      expect(
        harness.agent.commands.filter((command) => command.action.type === "reset"),
      ).toHaveLength(0);
    },
  );

  it("keeps the renderer away from ready when reset does not restore the original hash", async () => {
    const harness = createHarness({ failCueId: "cue-reset" });
    await startHarness(harness);

    await driveCurrentLoop(harness);

    expect(harness.runtime.state).toBe("safe-black");
    expect(harness.runtime.completedLoops).toBe(0);
    expect(harness.events.filter((event) => event.type === "ready")).toHaveLength(1);
    expect(harness.events.filter((event) => event.type === "reset")).toHaveLength(1);
    expect(harness.events.at(-1)).toMatchObject({
      type: "editor-ack",
      cueId: "cue-reset",
      outcome: "failed",
    });
  });

  it("retries one transport timeout with the same cue id without duplicating the overlay", async () => {
    const harness = createHarness({ throwOnceCueId: "cue-insert" });
    await startHarness(harness);

    await driveCurrentLoop(harness);

    expect(harness.runtime.completedLoops).toBe(1);
    expect(
      harness.agent.commands.filter((command) => command.cueId === "cue-insert"),
    ).toHaveLength(2);
    expect(harness.events.filter((event) => event.type === "editor-action")).toHaveLength(1);
    expect(harness.events.filter((event) => event.type === "key-overlay")).toHaveLength(1);
  });

  it("runs 100 loops without accumulating listeners, timers, or pending commands", async () => {
    const harness = createHarness();
    await startHarness(harness);
    const baseline = harness.runtime.resourceDiagnostics();

    for (let index = 0; index < 100; index += 1) {
      await driveCurrentLoop(harness);
      expect(harness.agent.bufferSha256).toBe(fixtureManifest.poemSha256);
    }

    expect(harness.runtime.completedLoops).toBe(100);
    expect(harness.runtime.resourceDiagnostics()).toEqual(baseline);
    expect({
      agentListeners: harness.agent.listenerCount,
      agentTimers: harness.agent.timerCount,
      pendingCommands: harness.agent.pendingCommands,
      rendererListeners: harness.renderer.listenerCount,
      rendererTimers: harness.renderer.timerCount,
    }).toEqual({
      agentListeners: 0,
      agentTimers: 0,
      pendingCommands: 0,
      rendererListeners: 0,
      rendererTimers: 0,
    });
  });
});
