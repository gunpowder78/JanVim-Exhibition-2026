import { describe, expect, it, vi } from "vitest";

import type {
  ResolvedDisplayRoute,
} from "../src/display-router.ts";
import {
  DisplayTopologyGuard,
  type DisplayTopologyEventName,
  type DisplayTopologyEventSource,
  type DisplayTopologyGuardTimers,
} from "../src/display-topology-guard.ts";
import type { ShowRuntimeDisplay } from "../src/display-routing-contract.ts";

type MappedRoute = Extract<ResolvedDisplayRoute, { state: "mapped" }>;

const screen1: ShowRuntimeDisplay = {
  displayId: "display-A",
  bounds: { x: 0, y: 0, width: 1_920, height: 1_080 },
  workingArea: { x: 0, y: 0, width: 1_920, height: 1_040 },
  scaleFactor: 1,
  rotation: 0,
};
const screen2: ShowRuntimeDisplay = {
  displayId: "display-B",
  bounds: { x: 1_920, y: 0, width: 1_920, height: 1_080 },
  workingArea: { x: 1_920, y: 0, width: 1_920, height: 1_040 },
  scaleFactor: 1.25,
  rotation: 90,
};
const screen3: ShowRuntimeDisplay = {
  displayId: "display-C",
  bounds: { x: 3_840, y: 0, width: 1_920, height: 1_080 },
  workingArea: { x: 3_840, y: 0, width: 1_920, height: 1_040 },
  scaleFactor: 1,
  rotation: 180,
};
const operatorDisplay: ShowRuntimeDisplay = {
  displayId: "display-Z",
  bounds: { x: 5_760, y: 0, width: 1_280, height: 720 },
  workingArea: { x: 5_760, y: 0, width: 1_280, height: 680 },
  scaleFactor: 1.5,
  rotation: 270,
};

function route(
  roles: MappedRoute["roles"] = {
    "SCREEN-1": screen1,
    "SCREEN-2": screen2,
    "SCREEN-3": screen3,
  },
  unassignedDisplays: readonly ShowRuntimeDisplay[] = [],
): MappedRoute {
  return {
    state: "mapped",
    mode: "production-3",
    roles,
    skippedRoles: [],
    unassignedDisplays,
  };
}

class FakeTopologySource implements DisplayTopologyEventSource {
  private readonly listeners = new Map<
    DisplayTopologyEventName,
    Set<(...arguments_: readonly unknown[]) => void>
  >();
  public failOn: DisplayTopologyEventName | undefined;

  public on(
    event: DisplayTopologyEventName,
    listener: (...arguments_: readonly unknown[]) => void,
  ): void {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    if (this.failOn === event) throw new Error(`injected-${event}-failure`);
  }

  public removeListener(
    event: DisplayTopologyEventName,
    listener: (...arguments_: readonly unknown[]) => void,
  ): void {
    this.listeners.get(event)?.delete(listener);
  }

  public emit(event: DisplayTopologyEventName): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener();
  }

  public listenerCount(event: DisplayTopologyEventName): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

class FakeTopologyTimers implements DisplayTopologyGuardTimers {
  private nextId = 1;
  private readonly pending = new Map<number, () => void>();
  public readonly delays: number[] = [];
  public failSet = false;

  public setTimeout(callback: () => void, delayMs: number): number {
    if (this.failSet) throw new Error("injected topology timer failure");
    const id = this.nextId++;
    this.delays.push(delayMs);
    this.pending.set(id, callback);
    return id;
  }

  public clearTimeout(handle: number | object): void {
    if (typeof handle === "number") this.pending.delete(handle);
  }

  public fireOnly(): void {
    expect(this.pending.size).toBe(1);
    const [id, callback] = [...this.pending.entries()][0]!;
    this.pending.delete(id);
    callback();
  }

  public get activeCount(): number {
    return this.pending.size;
  }
}

function createHarness(
  resolveCurrentRoute: () => ResolvedDisplayRoute = () => route(),
) {
  const source = new FakeTopologySource();
  const timers = new FakeTopologyTimers();
  const onTopologyChanged = vi.fn();
  const onTopologyStable = vi.fn();
  const resolver = vi.fn(resolveCurrentRoute);
  const guard = new DisplayTopologyGuard({
    source,
    timers,
    expectedRoute: route(),
    resolveCurrentRoute: resolver,
    onTopologyChanged,
    onTopologyStable,
  });
  return {
    source,
    timers,
    resolver,
    guard,
    onTopologyChanged,
    onTopologyStable,
  };
}

const topologyEvents = [
  "display-added",
  "display-removed",
  "display-metrics-changed",
] as const;

describe("DisplayTopologyGuard", () => {
  it.each(topologyEvents)(
    "registers %s and coalesces it through one 500 ms recomputation",
    (event) => {
      const harness = createHarness();
      harness.guard.start();

      expect(harness.resolver).toHaveBeenCalledTimes(1);
      for (const registered of topologyEvents) {
        expect(harness.source.listenerCount(registered)).toBe(1);
      }

      harness.source.emit(event);
      harness.source.emit(event);
      expect(harness.timers.activeCount).toBe(1);
      expect(harness.timers.delays).toEqual([500]);
      expect(harness.resolver).toHaveBeenCalledTimes(1);

      harness.timers.fireOnly();
      expect(harness.resolver).toHaveBeenCalledTimes(2);
      expect(harness.onTopologyStable).toHaveBeenCalledOnce();
      expect(harness.onTopologyChanged).not.toHaveBeenCalled();
    },
  );

  it("coalesces mixed event bursts into one timer and one route recomputation", () => {
    const harness = createHarness();
    harness.guard.start();

    for (const event of topologyEvents) harness.source.emit(event);
    expect(harness.timers.activeCount).toBe(1);
    expect(harness.timers.delays).toEqual([500]);

    harness.timers.fireOnly();
    expect(harness.resolver).toHaveBeenCalledTimes(2);
    expect(harness.onTopologyStable).toHaveBeenCalledOnce();
  });

  it("ignores changes confined to unassigned displays", () => {
    let current = route(undefined, [operatorDisplay]);
    const harness = createHarness(() => current);
    harness.guard.start();

    current = route(undefined, [
      { ...operatorDisplay, bounds: { ...operatorDisplay.bounds, x: 6_000 } },
    ]);
    harness.source.emit("display-metrics-changed");
    harness.timers.fireOnly();

    expect(harness.onTopologyChanged).not.toHaveBeenCalled();
    expect(harness.onTopologyStable).toHaveBeenCalledOnce();
    for (const event of topologyEvents) {
      expect(harness.source.listenerCount(event)).toBe(1);
    }
  });

  it.each([
    ["ID", { ...screen2, displayId: "display-B-new" }],
    ["bounds", { ...screen2, bounds: { ...screen2.bounds, x: 2_000 } }],
    [
      "working area",
      { ...screen2, workingArea: { ...screen2.workingArea, height: 1_020 } },
    ],
    ["scale", { ...screen2, scaleFactor: 1.5 }],
    ["rotation", { ...screen2, rotation: 270 }],
  ] as const)("trips once when an assigned display %s changes", (_label, changed) => {
    let current = route();
    const harness = createHarness(() => current);
    harness.guard.start();
    current = route({
      "SCREEN-1": screen1,
      "SCREEN-2": changed,
      "SCREEN-3": screen3,
    });

    harness.source.emit("display-metrics-changed");
    harness.timers.fireOnly();

    expect(harness.onTopologyChanged).toHaveBeenCalledOnce();
    expect(harness.onTopologyChanged).toHaveBeenCalledWith(
      "display-topology-changed",
    );
    expect(harness.timers.activeCount).toBe(0);
    for (const event of topologyEvents) {
      expect(harness.source.listenerCount(event)).toBe(0);
      harness.source.emit(event);
    }
    expect(harness.onTopologyChanged).toHaveBeenCalledOnce();
    expect(harness.resolver).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      "configuration-required route",
      () =>
        ({
          state: "configuration-required",
          reason: "display-id-mismatch",
        }) as const,
    ],
    [
      "invalid live sample",
      () => {
        throw new Error("invalid Electron display sample");
      },
    ],
  ] as const)("trips closed on a %s", (_label, resolveCurrentRoute) => {
    const harness = createHarness(resolveCurrentRoute);
    harness.guard.start();

    expect(harness.onTopologyChanged).toHaveBeenCalledOnce();
    expect(harness.onTopologyChanged).toHaveBeenCalledWith(
      "display-topology-changed",
    );
    for (const event of topologyEvents) {
      expect(harness.source.listenerCount(event)).toBe(0);
    }
  });

  it("re-resolves synchronously after registering listeners to close the startup race", () => {
    const harness = createHarness(() => ({
      state: "configuration-required",
      reason: "display-geometry-mismatch",
    }));

    harness.guard.start();

    expect(harness.resolver).toHaveBeenCalledOnce();
    expect(harness.onTopologyChanged).toHaveBeenCalledOnce();
    for (const event of topologyEvents) {
      expect(harness.source.listenerCount(event)).toBe(0);
    }
  });

  it("clears a pending timer and all listeners when disposed before the tick", () => {
    const harness = createHarness();
    harness.guard.start();
    harness.source.emit("display-added");
    expect(harness.timers.activeCount).toBe(1);

    harness.guard.dispose();
    harness.guard.dispose();

    expect(harness.timers.activeCount).toBe(0);
    expect(harness.resolver).toHaveBeenCalledOnce();
    expect(harness.onTopologyChanged).not.toHaveBeenCalled();
    for (const event of topologyEvents) {
      expect(harness.source.listenerCount(event)).toBe(0);
    }
  });

  it("fails closed once when the coalescing timer cannot be armed", () => {
    const harness = createHarness();
    harness.guard.start();
    harness.timers.failSet = true;

    expect(() => harness.source.emit("display-added")).not.toThrow();

    expect(harness.onTopologyChanged).toHaveBeenCalledOnce();
    expect(harness.timers.activeCount).toBe(0);
    for (const event of topologyEvents) {
      expect(harness.source.listenerCount(event)).toBe(0);
    }
  });

  it.each(["display-removed", "display-metrics-changed"] as const)(
    "rolls back partial listener registration when %s binding throws",
    (event) => {
      const harness = createHarness();
      harness.source.failOn = event;

      expect(() => harness.guard.start()).toThrow(`injected-${event}-failure`);
      expect(harness.resolver).not.toHaveBeenCalled();
      expect(harness.timers.activeCount).toBe(0);
      for (const registered of topologyEvents) {
        expect(harness.source.listenerCount(registered)).toBe(0);
      }
    },
  );
});
