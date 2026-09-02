import { describe, expect, it } from "vitest";

import { Scheduler } from "../src/scheduler.ts";
import type { Cue, ShowManifest } from "../../../packages/show-schema/src/index";

class FakeClock {
  public monotonic = 0;
  public wall = 0;

  public nowMonotonic(): number {
    return this.monotonic;
  }

  public nowWall(): number {
    return this.wall;
  }

  public advance(ms: number): void {
    this.monotonic += ms;
    this.wall += ms;
  }

  public setWall(ms: number): void {
    this.wall = ms;
  }
}

const makeVisualCue = (
  id: string,
  atMs: number,
  target: "main" | "secondary" | "both" = "secondary",
): Cue => ({
  id,
  atMs,
  target,
  kind: "prompt",
  payload: {},
});

const baseManifest: ShowManifest = {
  schema: 1,
  loopId: "loop-90s",
  loopDurationMs: 90_000,
  poemSha256:
    "11111111111111111111111111111111111111111111111111111111111111111111",
  contentRevision: "task3-fake",
  preparedBy: "JanVim Exhibition Team",
  cues: [],
};

const withCues = (...cues: Cue[]): ShowManifest => ({
  ...baseManifest,
  cues,
});

describe("show scheduler", () => {
  it("dispatches each cue at most once within a round", () => {
    const manifest = withCues(
      makeVisualCue("cue-1", 0),
      makeVisualCue("cue-2", 10),
    );
    const clock = new FakeClock();
    const scheduler = new Scheduler({
      manifest,
      clock: { nowMonotonic: () => clock.nowMonotonic(), nowWall: () => clock.nowWall() },
      initialLoopId: "loop-1",
    });

    scheduler.startLoop("loop-1");
    clock.advance(100);
    expect(scheduler.takeDueCues()).toHaveLength(2);
    expect(scheduler.takeDueCues()).toHaveLength(0);
  });

  it("keeps same-ms visual cue ordering stable", () => {
    const manifest = withCues(
      makeVisualCue("cue-a", 50, "secondary"),
      makeVisualCue("cue-b", 50, "main"),
      {
        ...makeVisualCue("cue-c", 120, "secondary"),
        atMs: 50,
      },
    );
    const clock = new FakeClock();
    const scheduler = new Scheduler({
      manifest,
      clock: { nowMonotonic: () => clock.nowMonotonic(), nowWall: () => clock.nowWall() },
    });

    scheduler.startLoop("loop-2");
    clock.advance(80);
    const due = scheduler.takeDueCues().map((event) => event.cue.id);
    expect(due).toEqual(["cue-a", "cue-b", "cue-c"]);
  });

  it("catches up non-editor cues within 250ms behind", () => {
    const manifest = withCues(
      makeVisualCue("cue-prompt", 200),
      makeVisualCue("cue-result", 500),
    );
    const clock = new FakeClock();
    const scheduler = new Scheduler({
      manifest,
      clock: { nowMonotonic: () => clock.nowMonotonic(), nowWall: () => clock.nowWall() },
      catchUpWindowMs: 250,
    });

    scheduler.startLoop("loop-3");
    clock.advance(450);
    expect(scheduler.takeDueCues().map((event) => event.cue.id)).toEqual(["cue-prompt"]);
    expect(scheduler.takeDueCues()).toHaveLength(0);
  });

  it("drops visual cues too far behind catch-up window", () => {
    const manifest = withCues(
      makeVisualCue("cue-prompt", 120),
      makeVisualCue("cue-result", 130),
    );
    const clock = new FakeClock();
    const scheduler = new Scheduler({
      manifest,
      clock: { nowMonotonic: () => clock.nowMonotonic(), nowWall: () => clock.nowWall() },
      catchUpWindowMs: 250,
    });

    scheduler.startLoop("loop-4");
    clock.advance(500);
    expect(scheduler.takeDueCues().map((event) => event.cue.id)).toEqual([]);
  });

  it("does not depend on wall clock when it goes backwards", () => {
    const manifest = withCues(makeVisualCue("cue-result", 200));
    const clock = new FakeClock();
    const scheduler = new Scheduler({
      manifest,
      clock: { nowMonotonic: () => clock.nowMonotonic(), nowWall: () => clock.nowWall() },
      initialLoopId: "loop-5",
    });

    scheduler.startLoop("loop-5");
    clock.monotonic = 250;
    clock.wall = 1000;
    expect(scheduler.takeDueCues()).toHaveLength(1);

    clock.setWall(10);
    expect(scheduler.takeDueCues()).toHaveLength(0);
  });

  it("allows pause/resume only in safe-black or ready states", () => {
    const manifest = withCues(makeVisualCue("cue-result", 50));
    const clock = new FakeClock();
    const scheduler = new Scheduler({
      manifest,
      clock: { nowMonotonic: () => clock.nowMonotonic(), nowWall: () => clock.nowWall() },
    });

    expect(() => scheduler.pause()).not.toThrow();
    expect(() => scheduler.resume()).not.toThrow();

    scheduler.startLoop("loop-6");
    expect(() => scheduler.pause()).toThrow(/not allowed/);
    expect(() => scheduler.resume()).toThrow(/not allowed/);

    scheduler.enterSafeBlack();
    expect(() => scheduler.pause()).not.toThrow();
    expect(() => scheduler.resume()).not.toThrow();
  });
});
