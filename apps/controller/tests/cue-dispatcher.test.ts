import { describe, expect, it } from "vitest";

import { CueDispatcher } from "../src/cue-dispatcher.ts";
import type { AgentAck, Cue } from "../../../packages/show-schema/src/index";

class FakeClock {
  public now = 0;

  public nowMonotonic(): number {
    return this.now;
  }

  public tick(ms: number): void {
    this.now += ms;
  }
}

const visualCue = (id: string): Cue => ({
  id,
  atMs: 0,
  target: "secondary",
  kind: "prompt",
  payload: {},
});

const editorSelectCue = (id: string): Cue => ({
  id,
  atMs: 0,
  target: "main",
  kind: "editor-action",
  payload: {
    action: {
      type: "select",
      rangeId: "opening",
    },
    displayKeys: ["gg"],
    semanticLabel: "select opening",
    critical: true,
  },
});

const resetCue = (id: string): Cue => ({
  id,
  atMs: 0,
  target: "main",
  kind: "editor-action",
  payload: {
    action: {
      type: "reset",
    },
    displayKeys: ["Esc"],
    semanticLabel: "return to baseline",
    critical: true,
  },
});

describe("cue dispatcher", () => {
  it("dispatches each cue once per loop for deterministic idempotence", () => {
    const clock = new FakeClock();
    let visualCount = 0;

    const dispatcher = new CueDispatcher({
      clock: {
        nowMonotonic: () => clock.nowMonotonic(),
      },
      generateLoopId: () => "loop-1",
      onVisualCue: () => {
        visualCount += 1;
      },
      onEditorCue: () => {},
      onSafeBlack: () => {},
      onLoopReset: () => {},
      initialLoopId: "loop-1",
    });

    dispatcher.start();
    dispatcher.dispatch(visualCue("cue-ready"));
    dispatcher.dispatch(visualCue("cue-ready"));

    expect(visualCount).toBe(1);
  });

  it("waits up to two seconds for editor ACK and retries once", () => {
    const clock = new FakeClock();
    let editorCount = 0;

    const dispatcher = new CueDispatcher({
      clock: {
        nowMonotonic: () => clock.nowMonotonic(),
      },
      generateLoopId: () => "loop-1",
      onVisualCue: () => {},
      onEditorCue: () => {
        editorCount += 1;
      },
      onSafeBlack: () => {},
      onLoopReset: () => {},
      initialLoopId: "loop-1",
    });

    dispatcher.start();
    dispatcher.dispatch(editorSelectCue("cue-editor"));
    clock.tick(1999);
    dispatcher.tick();
    expect(editorCount).toBe(1);
    expect(dispatcher.state).toBe("awaiting-editor-ack");

    clock.tick(2);
    dispatcher.tick();
    expect(editorCount).toBe(2);
    expect(dispatcher.state).toBe("awaiting-editor-ack");
  });

  it("gives up editor action after timeout and requests safe-black", () => {
    const clock = new FakeClock();
    let safeBlackReason: string | undefined;

    const dispatcher = new CueDispatcher({
      clock: {
        nowMonotonic: () => clock.nowMonotonic(),
      },
      generateLoopId: () => "loop-1",
      onVisualCue: () => {},
      onEditorCue: () => {},
      onSafeBlack: (reason) => {
        safeBlackReason = reason;
      },
      onLoopReset: () => {},
      initialLoopId: "loop-1",
    });

    dispatcher.start();
    dispatcher.dispatch(editorSelectCue("cue-editor"));

    clock.tick(2_000);
    dispatcher.tick();
    expect(safeBlackReason).toBeUndefined();
    expect(dispatcher.state).toBe("awaiting-editor-ack");

    clock.tick(2_001);
    dispatcher.tick();
    expect(safeBlackReason).toBe("editor cue acknowledged with timeout");
    expect(dispatcher.state).toBe("safe-black");
  });

  it("aborts subsequent editor dispatches after safe-black", () => {
    const clock = new FakeClock();
    let editorCount = 0;

    const dispatcher = new CueDispatcher({
      clock: {
        nowMonotonic: () => clock.nowMonotonic(),
      },
      generateLoopId: () => "loop-1",
      onVisualCue: () => {},
      onEditorCue: () => {
        editorCount += 1;
      },
      onSafeBlack: () => {},
      onLoopReset: () => {},
      initialLoopId: "loop-1",
    });

    dispatcher.start();
    dispatcher.dispatch(editorSelectCue("cue-editor"));
    clock.tick(4_005);
    dispatcher.tick();
    expect(dispatcher.state).toBe("safe-black");

    dispatcher.dispatch(editorSelectCue("cue-editor-late"));
    expect(editorCount).toBe(1);
  });

  it("rotates loop id and clears idempotence after reset cue", () => {
    const clock = new FakeClock();
    const loopIds = ["loop-1", "loop-2"];
    let loopGeneration = 0;
    let seenVisualCues = 0;
    let resetCount = 0;

    const dispatcher = new CueDispatcher({
      clock: {
        nowMonotonic: () => clock.nowMonotonic(),
      },
      generateLoopId: () => {
        const next = loopIds[Math.min(loopGeneration, loopIds.length - 1)];
        loopGeneration += 1;
        return next;
      },
      onVisualCue: () => {
        seenVisualCues += 1;
      },
      onEditorCue: (cue) => {
        if (cue.id === "cue-reset") {
          resetCount += 1;
        }
      },
      onSafeBlack: () => {},
      onLoopReset: () => {},
      initialLoopId: "loop-1",
    });

    dispatcher.start();
    dispatcher.dispatch(visualCue("cue-intro"));
    dispatcher.dispatch(resetCue("cue-reset"));

    expect(resetCount).toBe(1);
    expect(dispatcher.currentLoopId).toBe("loop-2");

    dispatcher.dispatch(visualCue("cue-intro"));
    expect(seenVisualCues).toBe(2);
  });

  it("returns running on successful editor ACK", () => {
    const clock = new FakeClock();
    let editorCount = 0;
    const ack: AgentAck = {
      schema: 1,
      loopId: "loop-1",
      cueId: "cue-editor",
      outcome: "applied",
      mode: "normal",
      cursor: { row: 0, col: 0 },
      bufferSha256:
        "2222222222222222222222222222222222222222222222222222222222222222",
    };

    const dispatcher = new CueDispatcher({
      clock: {
        nowMonotonic: () => clock.nowMonotonic(),
      },
      generateLoopId: () => "loop-1",
      onVisualCue: () => {},
      onEditorCue: () => {
        editorCount += 1;
      },
      onSafeBlack: () => {},
      onLoopReset: () => {},
      initialLoopId: "loop-1",
    });

    dispatcher.start();
    dispatcher.dispatch(editorSelectCue("cue-editor"));
    expect(dispatcher.state).toBe("awaiting-editor-ack");
    expect(editorCount).toBe(1);
    dispatcher.ack(ack);
    expect(dispatcher.state).toBe("running");
  });
});
