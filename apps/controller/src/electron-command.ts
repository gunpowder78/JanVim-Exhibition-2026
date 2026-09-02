import type { RuntimeDisplay } from "./display-router.js";
import type { G2Command } from "./g2-command.js";
import {
  captureRehearsalDisplays,
  confirmRehearsalDisplayMap,
  type RehearsalDisplayCatalog,
} from "./rehearsal-display-map.js";
import type {
  G2RuntimeComposition,
  G2RuntimeDependencies,
} from "./runtime-composition.js";

export interface ElectronCommandAdapters {
  runWithDeadline<T>(timeoutMs: number, operation: () => Promise<T>): Promise<T>;
  getAllDisplays(): readonly RuntimeDisplay[];
  readCatalog(path: string): Promise<RehearsalDisplayCatalog>;
  writeJsonAtomic(
    path: string,
    value: unknown,
    options: { mustNotExist: true } | { replace: true },
  ): Promise<void>;
  createRuntimeDependencies(
    command: Extract<G2Command, { mode: "ValidateOnly" | "Run" }>,
  ): G2RuntimeDependencies;
  createComposition(
    dependencies: G2RuntimeDependencies,
  ): Pick<G2RuntimeComposition, "boot" | "completion" | "stop">;
}

export async function runElectronCommand(
  command: G2Command,
  adapters: ElectronCommandAdapters,
): Promise<number> {
  if (command.mode === "Capture") {
    try {
      await adapters.runWithDeadline(15_000, async () => {
        const catalog = captureRehearsalDisplays(adapters.getAllDisplays());
        await adapters.writeJsonAtomic(command.displayMapPath, catalog, {
          mustNotExist: true,
        });
      });
      return 0;
    } catch {
      return 1;
    }
  }

  if (command.mode === "Confirm") {
    try {
      const catalog = await adapters.readCatalog(command.displayMapPath);
      const confirmed = confirmRehearsalDisplayMap(
        catalog,
        command.primaryDisplayId,
        command.secondaryDisplayId,
      );
      await adapters.writeJsonAtomic(command.displayMapPath, confirmed, {
        replace: true,
      });
      return 0;
    } catch {
      return 1;
    }
  }

  const dependencies = adapters.createRuntimeDependencies(command);
  if (command.mode === "ValidateOnly") {
    try {
      const validation = await dependencies.validate();
      if (!validation.ok) return 1;
      const route = await dependencies.routeDisplays();
      return route.state === "mapped" ? 0 : 1;
    } catch {
      return 1;
    }
  }

  const composition = adapters.createComposition(dependencies);
  try {
    const boot = await composition.boot();
    if (!boot.ready) {
      await composition.completion;
      return 1;
    }
    const result = await composition.completion;
    return result.ok ? 0 : 1;
  } finally {
    await composition.stop();
  }
}
