import type { ResolvedDisplayRoute } from "./display-router.js";
import type {
  ShowRuntimeDisplay,
  SoftDisplayId,
} from "./display-routing-contract.js";

export type DisplayTopologyEventName =
  | "display-added"
  | "display-removed"
  | "display-metrics-changed";

export interface DisplayTopologyEventSource {
  on(
    event: DisplayTopologyEventName,
    listener: (...arguments_: readonly unknown[]) => void,
  ): void;
  removeListener(
    event: DisplayTopologyEventName,
    listener: (...arguments_: readonly unknown[]) => void,
  ): void;
}

export interface DisplayTopologyGuardTimers {
  setTimeout(callback: () => void, delayMs: number): number | object;
  clearTimeout(handle: number | object): void;
}

type MappedRoute = Extract<ResolvedDisplayRoute, { state: "mapped" }>;

export interface DisplayTopologyGuardOptions {
  source: DisplayTopologyEventSource;
  timers: DisplayTopologyGuardTimers;
  expectedRoute: MappedRoute;
  resolveCurrentRoute(): ResolvedDisplayRoute;
  onTopologyChanged(reason: "display-topology-changed"): void;
  onTopologyStable(): void;
}

const TOPOLOGY_EVENTS: readonly DisplayTopologyEventName[] = [
  "display-added",
  "display-removed",
  "display-metrics-changed",
];
const COALESCE_MS = 500;
const SOFT_DISPLAY_IDS: readonly SoftDisplayId[] = [
  "SCREEN-1",
  "SCREEN-2",
  "SCREEN-3",
];

export class DisplayTopologyGuard {
  private readonly registeredEvents: DisplayTopologyEventName[] = [];
  private timer: number | object | undefined;
  private started = false;
  private disposed = false;
  private tripped = false;

  public constructor(private readonly options: DisplayTopologyGuardOptions) {}

  public start(): void {
    if (this.started || this.disposed) {
      throw new Error("display-topology-guard-already-started");
    }
    this.started = true;
    try {
      for (const event of TOPOLOGY_EVENTS) {
        this.registeredEvents.push(event);
        this.options.source.on(event, this.handleTopologyEvent);
      }
    } catch (error) {
      this.dispose();
      throw error;
    }

    this.evaluate(false);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer !== undefined) {
      const timer = this.timer;
      this.timer = undefined;
      try {
        this.options.timers.clearTimeout(timer);
      } catch {
        // Listener cleanup must continue even if timer cancellation fails.
      }
    }
    for (const event of this.registeredEvents.splice(0).reverse()) {
      try {
        this.options.source.removeListener(event, this.handleTopologyEvent);
      } catch {
        // Disposal remains best-effort and attempts every registered listener.
      }
    }
  }

  private readonly handleTopologyEvent = (): void => {
    if (this.disposed || this.tripped || this.timer !== undefined) return;
    try {
      this.timer = this.options.timers.setTimeout(() => {
        this.timer = undefined;
        this.evaluate(true);
      }, COALESCE_MS);
    } catch {
      this.trip();
    }
  };

  private evaluate(notifyStable: boolean): void {
    if (this.disposed || this.tripped) return;
    let current: ResolvedDisplayRoute;
    try {
      current = this.options.resolveCurrentRoute();
    } catch {
      this.trip();
      return;
    }
    if (!sameAssignedRoute(this.options.expectedRoute, current)) {
      this.trip();
      return;
    }
    if (notifyStable) this.options.onTopologyStable();
  }

  private trip(): void {
    if (this.disposed || this.tripped) return;
    this.tripped = true;
    this.dispose();
    this.options.onTopologyChanged("display-topology-changed");
  }
}

function sameAssignedRoute(
  expected: MappedRoute,
  current: ResolvedDisplayRoute,
): boolean {
  if (current.state !== "mapped" || current.mode !== expected.mode) return false;
  return SOFT_DISPLAY_IDS.every((softId) =>
    sameOptionalDisplay(expected.roles[softId], current.roles[softId]),
  );
}

function sameOptionalDisplay(
  expected: ShowRuntimeDisplay | undefined,
  current: ShowRuntimeDisplay | undefined,
): boolean {
  if (expected === undefined || current === undefined) {
    return expected === current;
  }
  return (
    expected.displayId === current.displayId &&
    sameRectangle(expected.bounds, current.bounds) &&
    sameRectangle(expected.workingArea, current.workingArea) &&
    expected.scaleFactor === current.scaleFactor &&
    expected.rotation === current.rotation
  );
}

function sameRectangle(
  left: ShowRuntimeDisplay["bounds"],
  right: ShowRuntimeDisplay["bounds"],
): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}
