import { describe, expect, it } from "vitest";

import type { RuntimeDisplay } from "../src/display-router.ts";
import type { G2Command } from "../src/g2-command.ts";
import { runElectronCommand } from "../src/electron-command.ts";
import type { RehearsalDisplayCatalog } from "../src/rehearsal-display-map.ts";
import type { G2RuntimeDependencies, G2RunResult } from "../src/runtime-composition.ts";

interface HarnessOptions {
  mode: G2Command["mode"];
  primaryDisplayId?: string;
  secondaryDisplayId?: string;
  deadlineExceeded?: boolean;
  boot?: { ready: true } | { ready: false; reason: string };
  completion?: G2RunResult;
}

const displays: RuntimeDisplay[] = [
  {
    displayId: 111,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    scaleFactor: 1,
  },
  {
    displayId: 222,
    bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
    scaleFactor: 1,
  },
];
const catalog: RehearsalDisplayCatalog = {
  schema: 1,
  mappingStatus: "unconfirmed",
  expectedDisplayCount: 2,
  displays: [
    {
      displayId: "111",
      bounds: { ...displays[0]!.bounds },
      scaleFactor: 1,
      geometrySha256:
        "b2bc82d7bea454184acfb21ae9139e97c32aefb994443034423653e85f9c83cc",
    },
    {
      displayId: "222",
      bounds: { ...displays[1]!.bounds },
      scaleFactor: 1,
      geometrySha256:
        "2ebac5faac6c5f34562d1e91088736c9e70943c9c42846616a418db904319928",
    },
  ],
};

function createElectronHarness(options: HarnessOptions) {
  const rehearsalRoot = "D:\\VirtualData\\JanVim-Exhibition-Rehearsals\\g2-001";
  const common = {
    rehearsalRoot,
    displayMapPath: `${rehearsalRoot}\\display-map.json`,
  };
  const command: G2Command =
    options.mode === "Capture"
      ? { mode: "Capture", ...common }
      : options.mode === "Confirm"
        ? {
            mode: "Confirm",
            ...common,
            primaryDisplayId: options.primaryDisplayId ?? "111",
            secondaryDisplayId: options.secondaryDisplayId ?? "222",
          }
        : options.mode === "ValidateOnly"
          ? { mode: "ValidateOnly", ...common, runId: "g2-001" }
          : { mode: "Run", ...common, runId: "g2-001" };

  let written: unknown;
  let openedWindows = 0;
  let spawnedProcesses = 0;
  let validateCount = 0;
  let routeDisplaysCount = 0;
  let compositionBootCount = 0;
  let cleanupCount = 0;
  let atomicRenameCount = 0;
  let completionAwaited = false;
  const deadlineRequests: number[] = [];
  let resolveDeferredCompletion: ((result: G2RunResult) => void) | undefined;
  const completion = options.boot?.ready === false
    ? new Promise<G2RunResult>((resolve) => {
        resolveDeferredCompletion = resolve;
      })
    : Promise.resolve(options.completion ?? { ok: true });

  const dependencies = {
    validate: async () => {
      validateCount += 1;
      return { ok: true as const };
    },
    routeDisplays: async () => {
      routeDisplaysCount += 1;
      return {
        state: "mapped" as const,
        primary: displays[0]!,
        secondary: displays[1]!,
      };
    },
    openSecondary: async () => {
      openedWindows += 1;
      throw new Error("ValidateOnly must not open a window");
    },
    startJanVim: async () => {
      spawnedProcesses += 1;
      throw new Error("ValidateOnly must not spawn JanVim");
    },
  } as unknown as G2RuntimeDependencies;
  const composition = {
    boot: async () => {
      compositionBootCount += 1;
      return options.boot ?? { ready: true as const };
    },
    get completion() {
      completionAwaited = true;
      return completion;
    },
    stop: async () => {
      cleanupCount += 1;
    },
  };
  const adapters = {
    runWithDeadline: async <T>(timeoutMs: number, operation: () => Promise<T>) => {
      deadlineRequests.push(timeoutMs);
      if (options.deadlineExceeded === true) throw new Error("deadline exceeded");
      return operation();
    },
    getAllDisplays: () => displays,
    readCatalog: async () => catalog,
    writeJsonAtomic: async (
      _path: string,
      value: unknown,
      writeOptions: { mustNotExist: true } | { replace: true },
    ) => {
      written = value;
      if ("replace" in writeOptions) atomicRenameCount += 1;
    },
    createRuntimeDependencies: () => dependencies,
    createComposition: () => composition,
  };

  return {
    command,
    adapters,
    deadlineRequests,
    get written() {
      return written as Record<string, unknown>;
    },
    get openedWindows() {
      return openedWindows;
    },
    get spawnedProcesses() {
      return spawnedProcesses;
    },
    get validateCount() {
      return validateCount;
    },
    get routeDisplaysCount() {
      return routeDisplaysCount;
    },
    get compositionBootCount() {
      return compositionBootCount;
    },
    get cleanupCount() {
      return cleanupCount;
    },
    get atomicRenameCount() {
      return atomicRenameCount;
    },
    get completionAwaited() {
      return completionAwaited;
    },
    resolveCompletion: () => resolveDeferredCompletion?.(options.completion ?? {
      ok: false,
      reason: "window-rectangle-mismatch",
    }),
  };
}

describe("headless Electron G2 command dispatcher", () => {
  it("captures an unconfirmed catalog and quits without opening windows", async () => {
    const harness = createElectronHarness({ mode: "Capture" });
    await expect(runElectronCommand(harness.command, harness.adapters)).resolves.toBe(0);
    expect(harness.written.mappingStatus).toBe("unconfirmed");
    expect(harness.openedWindows).toBe(0);
    expect(harness.spawnedProcesses).toBe(0);
  });

  it("fails Capture at its 15-second deadline", async () => {
    const harness = createElectronHarness({ mode: "Capture", deadlineExceeded: true });
    await expect(runElectronCommand(harness.command, harness.adapters)).resolves.toBe(1);
    expect(harness.deadlineRequests).toEqual([15_000]);
    expect(harness.openedWindows).toBe(0);
    expect(harness.spawnedProcesses).toBe(0);
  });

  it("confirms only explicit captured IDs using a same-directory atomic replace", async () => {
    const harness = createElectronHarness({
      mode: "Confirm",
      primaryDisplayId: "111",
      secondaryDisplayId: "222",
    });
    await expect(runElectronCommand(harness.command, harness.adapters)).resolves.toBe(0);
    expect(harness.written).toMatchObject({
      mappingStatus: "confirmed",
      primary: { displayId: "111" },
      secondary: { displayId: "222" },
    });
    expect(harness.atomicRenameCount).toBe(1);
  });

  it("validates runtime and live display routing without opening or spawning", async () => {
    const harness = createElectronHarness({ mode: "ValidateOnly" });
    await expect(runElectronCommand(harness.command, harness.adapters)).resolves.toBe(0);
    expect(harness.validateCount).toBe(1);
    expect(harness.routeDisplaysCount).toBe(1);
    expect(harness.openedWindows).toBe(0);
    expect(harness.spawnedProcesses).toBe(0);
  });

  it("runs exactly one composition instance", async () => {
    const harness = createElectronHarness({ mode: "Run" });
    await expect(runElectronCommand(harness.command, harness.adapters)).resolves.toBe(0);
    expect(harness.compositionBootCount).toBe(1);
    expect(harness.cleanupCount).toBe(1);
  });

  it("returns nonzero after composition cleanup on run failure", async () => {
    const harness = createElectronHarness({
      mode: "Run",
      completion: { ok: false, reason: "janvim-close-timeout" },
    });
    await expect(runElectronCommand(harness.command, harness.adapters)).resolves.toBe(1);
    expect(harness.cleanupCount).toBe(1);
  });

  it("awaits blocked boot cleanup before returning nonzero", async () => {
    const harness = createElectronHarness({
      mode: "Run",
      boot: { ready: false, reason: "window-rectangle-mismatch" },
      completion: { ok: false, reason: "window-rectangle-mismatch" },
    });
    const pending = runElectronCommand(harness.command, harness.adapters);
    await Promise.resolve();
    expect(harness.completionAwaited).toBe(true);
    harness.resolveCompletion();
    await expect(pending).resolves.toBe(1);
    expect(harness.cleanupCount).toBe(1);
  });
});
