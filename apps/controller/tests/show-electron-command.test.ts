import { describe, expect, it, vi } from "vitest";

import type { ShowCommand } from "../src/show-command.ts";
import {
  runShowElectronCommand,
  type EmergencyStopReason,
  type RunShowCommand,
  type ShowElectronCommandAdapters,
  type ShowValidationOutcome,
} from "../src/show-electron-command.ts";
import type {
  ShowBootOutcome,
  ShowRunResult,
} from "../src/show-run-coordinator.ts";

function command(mode: ShowCommand["mode"]): ShowCommand {
  return {
    mode,
    rehearsalRoot: "D:\\VirtualData\\JanVim-Exhibition-Rehearsals\\show-001",
    displayMapPath:
      "D:\\VirtualData\\JanVim-Exhibition-Rehearsals\\show-001\\display-map.json",
    runId: "show-001",
    controllerRunId: "controller-001",
    networkPolicy: "OfflineRequired",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createHarness(options: {
  validationFailure?: boolean;
  validation?: ShowValidationOutcome;
  boot?: ShowBootOutcome;
  bootFailure?: boolean;
  completion?: ShowRunResult;
  deferredCompletion?: boolean;
  terminalShutdownStarted?: boolean;
} = {}) {
  const pendingCompletion = deferred<ShowRunResult>();
  const lifecycleReasons: EmergencyStopReason[] = [];
  let lifecycleListener:
    | ((reason: EmergencyStopReason) => void)
    | undefined;
  let validateCount = 0;
  let factoryCount = 0;
  let bootCount = 0;
  let bindCount = 0;
  let disposeCount = 0;
  const factoryCommands: RunShowCommand[] = [];
  const completion = options.deferredCompletion === true
    ? pendingCompletion.promise
    : Promise.resolve(options.completion ?? { ok: true, reason: "soak-complete" as const });
  const coordinator = {
    boot: vi.fn(async () => {
      bootCount += 1;
      if (options.bootFailure === true) throw new Error("boot-failed");
      return options.boot ?? { ready: true as const };
    }),
    completion,
    requestEmergencyStop: vi.fn(
      async (reason: EmergencyStopReason) => {
        lifecycleReasons.push(reason);
      },
    ),
    terminalShutdownStarted: vi.fn(
      () => options.terminalShutdownStarted ?? false,
    ),
  };
  const adapters: ShowElectronCommandAdapters = {
    validate: async () => {
      validateCount += 1;
      if (options.validationFailure === true) throw new Error("validation-failed");
      return options.validation ?? { outcome: "validated" as const };
    },
    createCoordinator: (runCommand) => {
      factoryCount += 1;
      factoryCommands.push(runCommand);
      return coordinator;
    },
    bindEmergencyLifecycle: (listener) => {
      bindCount += 1;
      lifecycleListener = listener;
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        disposeCount += 1;
      };
    },
  };

  return {
    adapters,
    coordinator,
    lifecycleReasons,
    emitLifecycle: (reason: EmergencyStopReason) => {
      if (lifecycleListener === undefined) throw new Error("lifecycle not bound");
      lifecycleListener(reason);
    },
    resolveCompletion: (result: ShowRunResult) => pendingCompletion.resolve(result),
    rejectCompletion: (error: unknown) => pendingCompletion.reject(error),
    get validateCount() {
      return validateCount;
    },
    get factoryCount() {
      return factoryCount;
    },
    get factoryCommands() {
      return factoryCommands;
    },
    get bootCount() {
      return bootCount;
    },
    get bindCount() {
      return bindCount;
    },
    get disposeCount() {
      return disposeCount;
    },
  };
}

describe("Task 9 Electron command dispatcher", () => {
  it("runs ValidateOnly without creating a coordinator or lifecycle handlers", async () => {
    const harness = createHarness();

    await expect(
      runShowElectronCommand(command("ValidateOnly"), harness.adapters),
    ).resolves.toBe(0);

    expect(harness.validateCount).toBe(1);
    expect(harness.factoryCount).toBe(0);
    expect(harness.bindCount).toBe(0);
    expect(harness.bootCount).toBe(0);
  });

  it("returns nonzero from failed headless validation without opening runtime state", async () => {
    const harness = createHarness({ validationFailure: true });

    await expect(
      runShowElectronCommand(command("ValidateOnly"), harness.adapters),
    ).resolves.toBe(1);

    expect(harness.validateCount).toBe(1);
    expect(harness.factoryCount).toBe(0);
    expect(harness.bindCount).toBe(0);
  });

  it("returns exit 2 only for the owned ValidateOnly configuration outcome", async () => {
    const harness = createHarness({
      validation: {
        outcome: "configuration-required",
        reason: "display-id-mismatch",
      },
    });

    await expect(
      runShowElectronCommand(command("ValidateOnly"), harness.adapters),
    ).resolves.toBe(2);

    expect(harness.validateCount).toBe(1);
    expect(harness.factoryCount).toBe(0);
    expect(harness.bindCount).toBe(0);
  });

  it.each(["Soak3", "Show"] as const)(
    "creates one %s coordinator and waits for terminal cleanup",
    async (mode) => {
      const harness = createHarness({
        completion:
          mode === "Soak3"
            ? { ok: true, reason: "soak-complete" }
            : { ok: true, reason: "operator-stop" },
      });

      await expect(runShowElectronCommand(command(mode), harness.adapters)).resolves.toBe(0);

      expect(harness.validateCount).toBe(0);
      expect(harness.factoryCount).toBe(1);
      expect(harness.factoryCommands).toEqual([command(mode)]);
      expect(harness.bootCount).toBe(1);
      expect(harness.bindCount).toBe(1);
      expect(harness.disposeCount).toBe(1);
      expect(harness.coordinator.requestEmergencyStop).toHaveBeenCalledTimes(1);
      expect(harness.lifecycleReasons).toEqual(["electron-quit"]);
    },
  );

  it("returns nonzero when strict evidence downgrades an otherwise successful run", async () => {
    const harness = createHarness({
      completion: { ok: false, reason: "acceptance-failed" },
    });

    await expect(
      runShowElectronCommand(command("Soak3"), harness.adapters),
    ).resolves.toBe(1);
    expect(harness.disposeCount).toBe(1);
  });

  it("forwards each bound emergency source to the one coordinator", async () => {
    const harness = createHarness({ deferredCompletion: true });
    const pending = runShowElectronCommand(command("Show"), harness.adapters);
    await Promise.resolve();

    for (const reason of ["sigint", "window-close", "electron-quit"] as const) {
      harness.emitLifecycle(reason);
    }
    harness.resolveCompletion({ ok: false, reason: "emergency-sigint" });

    await expect(pending).resolves.toBe(1);
    expect(harness.lifecycleReasons).toEqual([
      "sigint",
      "window-close",
      "electron-quit",
      "electron-quit",
    ]);
    expect(harness.bindCount).toBe(1);
    expect(harness.disposeCount).toBe(1);
  });

  it("stops a failed boot and waits for completion before returning", async () => {
    const harness = createHarness({
      boot: { ready: false, reason: "startup-failed" },
      deferredCompletion: true,
    });
    const pending = runShowElectronCommand(command("Soak3"), harness.adapters);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.lifecycleReasons).toEqual(["electron-quit"]);
    expect(settled).toBe(false);
    expect(harness.disposeCount).toBe(0);
    harness.resolveCompletion({ ok: false, reason: "emergency-electron-quit" });

    await expect(pending).resolves.toBe(1);
    expect(harness.disposeCount).toBe(1);
    expect(harness.coordinator.requestEmergencyStop).toHaveBeenCalledTimes(1);
  });

  it("returns exit 2 for the owned Show configuration outcome without emergency cleanup", async () => {
    const harness = createHarness({
      boot: {
        ready: false,
        outcome: "configuration-required",
        reason: "display-geometry-mismatch",
      },
      completion: { ok: false, reason: "display-configuration-required" },
      terminalShutdownStarted: true,
    });

    await expect(
      runShowElectronCommand(command("Show"), harness.adapters),
    ).resolves.toBe(2);

    expect(harness.coordinator.requestEmergencyStop).not.toHaveBeenCalled();
    expect(harness.lifecycleReasons).toEqual([]);
    expect(harness.disposeCount).toBe(1);
  });

  it("does not parse a generic boot reason into exit 2", async () => {
    const harness = createHarness({
      boot: { ready: false, reason: "display-configuration-required" },
      deferredCompletion: true,
    });
    const pending = runShowElectronCommand(command("Show"), harness.adapters);
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.lifecycleReasons).toEqual(["electron-quit"]);
    harness.resolveCompletion({ ok: false, reason: "emergency-electron-quit" });
    await expect(pending).resolves.toBe(1);
  });

  it("does not append electron-quit after topology shutdown already owns completion", async () => {
    const harness = createHarness({
      completion: {
        ok: false,
        reason: "emergency-display-topology-changed",
      },
      terminalShutdownStarted: true,
    });

    await expect(
      runShowElectronCommand(command("Show"), harness.adapters),
    ).resolves.toBe(1);

    expect(harness.coordinator.requestEmergencyStop).not.toHaveBeenCalled();
    expect(harness.lifecycleReasons).toEqual([]);
    expect(harness.disposeCount).toBe(1);
  });

  it("cleans up after boot or completion rejection and returns nonzero", async () => {
    const bootFailure = createHarness({ bootFailure: true });
    await expect(
      runShowElectronCommand(command("Show"), bootFailure.adapters),
    ).resolves.toBe(1);
    expect(bootFailure.lifecycleReasons).toEqual(["electron-quit"]);
    expect(bootFailure.disposeCount).toBe(1);

    const completionFailure = createHarness({ deferredCompletion: true });
    const pending = runShowElectronCommand(command("Show"), completionFailure.adapters);
    await Promise.resolve();
    completionFailure.rejectCompletion(new Error("completion-failed"));
    await expect(pending).resolves.toBe(1);
    expect(completionFailure.lifecycleReasons).toEqual(["electron-quit"]);
    expect(completionFailure.disposeCount).toBe(1);
  });
});
