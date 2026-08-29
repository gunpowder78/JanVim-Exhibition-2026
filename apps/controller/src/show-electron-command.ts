import type { ShowCommand } from "./show-command.js";
import type {
  ShowRunCoordinator,
  ShowRunResult,
} from "./show-run-coordinator.js";

export type EmergencyStopReason =
  | "sigint"
  | "window-close"
  | "electron-quit";

export type RunShowCommand = Omit<ShowCommand, "mode"> & {
  mode: "Soak3" | "Show";
};

export interface ShowCoordinatorAdapter {
  boot(): Promise<{ ready: true } | { ready: false; reason: string }>;
  readonly completion: Promise<ShowRunResult>;
  requestEmergencyStop(reason: EmergencyStopReason): Promise<void>;
}

export interface ShowElectronCommandAdapters {
  validate(command: ShowCommand): Promise<void>;
  createCoordinator(
    command: RunShowCommand,
  ): Pick<
    ShowRunCoordinator,
    "boot" | "completion" | "requestEmergencyStop"
  >;
  bindEmergencyLifecycle(
    listener: (reason: EmergencyStopReason) => void,
  ): () => void;
}

export async function runShowElectronCommand(
  command: ShowCommand,
  adapters: ShowElectronCommandAdapters,
): Promise<number> {
  if (command.mode === "ValidateOnly") {
    try {
      await adapters.validate(command);
      return 0;
    } catch {
      return 1;
    }
  }

  let coordinator: ShowCoordinatorAdapter;
  try {
    coordinator = adapters.createCoordinator(command as RunShowCommand);
  } catch {
    return 1;
  }

  let disposeLifecycle: (() => void) | undefined;
  try {
    disposeLifecycle = adapters.bindEmergencyLifecycle((reason) => {
      void coordinator.requestEmergencyStop(reason).catch(() => undefined);
    });
    const boot = await coordinator.boot();
    if (!boot.ready) return 1;
    const result = await coordinator.completion;
    return result.ok ? 0 : 1;
  } catch {
    return 1;
  } finally {
    try {
      await coordinator.requestEmergencyStop("electron-quit");
    } catch {
      // Coordinator shutdown remains bounded and completion is still observed below.
    }
    try {
      await coordinator.completion;
    } catch {
      // A rejected terminal promise is classified by the nonzero dispatcher result.
    }
    try {
      disposeLifecycle?.();
    } catch {
      // Lifecycle disposal cannot bypass terminal cleanup.
    }
  }
}
