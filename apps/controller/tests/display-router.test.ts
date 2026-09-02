import { describe, expect, it } from "vitest";

import {
  createSecondaryWindowPlan,
  hashDisplayGeometry,
  installSecondaryNavigationGuard,
  openSecondaryReadyWindow,
  routeDisplays,
  type DisplayMapConfig,
  type DisplayFingerprint,
  type RuntimeDisplay,
} from "../src/display-router.ts";

const primaryGeometry: DisplayFingerprint = {
  displayId: "engineering-projector",
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  scaleFactor: 1,
};

const secondaryGeometry: DisplayFingerprint = {
  displayId: "nut-projector",
  bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
  scaleFactor: 1,
};

function displayMap(overrides: Partial<DisplayMapConfig> = {}): DisplayMapConfig {
  return {
    schema: 1,
    mappingStatus: "confirmed",
    expectedDisplayCount: 2,
    primary: {
      ...primaryGeometry,
      bounds: { ...primaryGeometry.bounds },
      geometrySha256: hashDisplayGeometry(primaryGeometry),
    },
    secondary: {
      ...secondaryGeometry,
      bounds: { ...secondaryGeometry.bounds },
      geometrySha256: hashDisplayGeometry(secondaryGeometry),
    },
    ...overrides,
  };
}

function runtimeDisplay(fingerprint: DisplayFingerprint): RuntimeDisplay {
  return { ...fingerprint };
}

describe("display router", () => {
  it("stays ready unless exactly two displays are present", () => {
    const one = routeDisplays([runtimeDisplay(primaryGeometry)], displayMap());
    const three = routeDisplays(
      [
        runtimeDisplay(primaryGeometry),
        runtimeDisplay(secondaryGeometry),
        {
          displayId: "unexpected-monitor",
          bounds: { x: 3840, y: 0, width: 1280, height: 720 },
          scaleFactor: 1,
        },
      ],
      displayMap(),
    );

    expect(one).toEqual({ state: "ready", reason: "display-count-mismatch" });
    expect(three).toEqual({ state: "ready", reason: "display-count-mismatch" });
  });

  it("assigns explicit primary and secondary IDs even when enumeration order is reversed", () => {
    const routed = routeDisplays(
      [runtimeDisplay(secondaryGeometry), runtimeDisplay(primaryGeometry)],
      displayMap(),
    );

    expect(routed.state).toBe("mapped");
    if (routed.state !== "mapped") throw new Error(routed.reason);
    expect(routed.primary.displayId).toBe("engineering-projector");
    expect(routed.secondary.displayId).toBe("nut-projector");
  });

  it("stays ready for unconfirmed, tampered, or geometrically changed mappings", () => {
    expect(
      routeDisplays(
        [runtimeDisplay(primaryGeometry), runtimeDisplay(secondaryGeometry)],
        displayMap({ mappingStatus: "unconfirmed" }),
      ),
    ).toEqual({ state: "ready", reason: "display-map-unconfirmed" });

    const tampered = displayMap();
    tampered.secondary.geometrySha256 = "0".repeat(64);
    expect(
      routeDisplays(
        [runtimeDisplay(primaryGeometry), runtimeDisplay(secondaryGeometry)],
        tampered,
      ),
    ).toEqual({ state: "ready", reason: "display-map-hash-mismatch" });

    const shiftedSecondary = runtimeDisplay(secondaryGeometry);
    shiftedSecondary.bounds = { ...shiftedSecondary.bounds, x: 1919 };
    expect(
      routeDisplays([runtimeDisplay(primaryGeometry), shiftedSecondary], displayMap()),
    ).toEqual({ state: "ready", reason: "display-geometry-mismatch" });
  });

  it("rejects malformed map and runtime geometry instead of routing it", () => {
    const malformedMap = displayMap();
    malformedMap.secondary.bounds.width = -1920;
    malformedMap.secondary.geometrySha256 = hashDisplayGeometry(malformedMap.secondary);
    expect(
      routeDisplays(
        [runtimeDisplay(primaryGeometry), runtimeDisplay(malformedMap.secondary)],
        malformedMap,
      ),
    ).toEqual({ state: "ready", reason: "display-map-invalid" });

    const malformedRuntime = runtimeDisplay(secondaryGeometry);
    malformedRuntime.scaleFactor = Number.NaN;
    expect(
      routeDisplays([runtimeDisplay(primaryGeometry), malformedRuntime], displayMap()),
    ).toEqual({ state: "ready", reason: "display-runtime-invalid" });

    const missingBounds = {
      ...displayMap(),
      secondary: { displayId: "nut-projector", scaleFactor: 1, geometrySha256: "0".repeat(64) },
    } as unknown as DisplayMapConfig;
    expect(
      routeDisplays(
        [runtimeDisplay(primaryGeometry), runtimeDisplay(secondaryGeometry)],
        missingBounds,
      ),
    ).toEqual({ state: "ready", reason: "display-map-invalid" });

    const missingRuntimeBounds = {
      displayId: "nut-projector",
      scaleFactor: 1,
    } as RuntimeDisplay;
    expect(
      routeDisplays([runtimeDisplay(primaryGeometry), missingRuntimeBounds], displayMap()),
    ).toEqual({ state: "ready", reason: "display-runtime-invalid" });
  });

  it("builds a frameless fullscreen secondary window and denies remote navigation", () => {
    const entryUrl = "file:///show/apps/secondary-screen/dist/index.html";
    const plan = createSecondaryWindowPlan(secondaryGeometry.bounds, "D:\\show\\preload.cjs", entryUrl);

    expect(plan.browserWindowOptions).toMatchObject({
      frame: false,
      fullscreen: true,
      x: secondaryGeometry.bounds.x,
      y: secondaryGeometry.bounds.y,
      width: secondaryGeometry.bounds.width,
      height: secondaryGeometry.bounds.height,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: "D:\\show\\preload.cjs",
      },
    });
    expect(plan.browserWindowOptions).not.toHaveProperty("bounds");
    expect(plan.isNavigationAllowed(entryUrl)).toBe(true);
    expect(plan.isNavigationAllowed("https://example.com/remote")) .toBe(false);
    expect(plan.isNavigationAllowed("file:///show/another.html")).toBe(false);
  });

  it("blocks real navigation events and every attempt to open another window", () => {
    const entryUrl = "file:///show/apps/secondary-screen/dist/index.html";
    let navigationListener:
      | ((event: { preventDefault(): void }, targetUrl: string) => void)
      | undefined;
    let windowOpenHandler:
      | ((details: { url: string }) => { action: "deny" })
      | undefined;
    const removed: unknown[] = [];
    const uninstall = installSecondaryNavigationGuard(
      {
        on: (_eventName, listener) => {
          navigationListener = listener;
        },
        removeListener: (_eventName, listener) => {
          removed.push(listener);
        },
        setWindowOpenHandler: (handler) => {
          windowOpenHandler = handler;
        },
      },
      entryUrl,
    );

    let prevented = 0;
    navigationListener?.({ preventDefault: () => prevented += 1 }, entryUrl);
    navigationListener?.({ preventDefault: () => prevented += 1 }, "https://example.com/");
    navigationListener?.({ preventDefault: () => prevented += 1 }, "file:///show/other.html");
    expect(prevented).toBe(2);
    expect(windowOpenHandler?.({ url: entryUrl })).toEqual({ action: "deny" });
    expect(windowOpenHandler?.({ url: "https://example.com/" })).toEqual({ action: "deny" });

    uninstall();
    expect(removed).toEqual([navigationListener]);
  });

  it("requires an absolute CommonJS preload path and a local entry URL", () => {
    expect(() =>
      createSecondaryWindowPlan(secondaryGeometry.bounds, "preload.cjs", "file:///show/index.html"),
    ).toThrow(/preload/i);
    expect(() =>
      createSecondaryWindowPlan(
        secondaryGeometry.bounds,
        "D:\\show\\preload.js",
        "file:///show/index.html",
      ),
    ).toThrow(/CommonJS/i);
    expect(() =>
      createSecondaryWindowPlan(
        secondaryGeometry.bounds,
        "D:\\show\\preload.cjs",
        "https://example.com/",
      ),
    ).toThrow(/local file/i);
  });

  it("creates, guards, and loads the secondary ready window through an injected factory", async () => {
    const calls: string[] = [];
    const entryUrl = "file:///show/safety.html";
    const window = {
      webContents: {
        on: () => calls.push("guard-navigation"),
        removeListener: () => calls.push("remove-navigation-guard"),
        setWindowOpenHandler: () => calls.push("deny-window-open"),
      },
      loadURL: async (targetUrl: string) => {
        calls.push(`load:${targetUrl}`);
      },
    };

    const opened = await openSecondaryReadyWindow({
      bounds: secondaryGeometry.bounds,
      preloadPath: "D:\\show\\preload.cjs",
      entryUrl,
      createWindow: (options) => {
        calls.push("create-window");
        expect(options).toMatchObject({
          x: 1920,
          y: 0,
          width: 1920,
          height: 1080,
          webPreferences: { sandbox: true },
        });
        return window;
      },
    });

    expect(opened.window).toBe(window);
    expect(calls).toEqual([
      "create-window",
      "guard-navigation",
      "deny-window-open",
      `load:${entryUrl}`,
    ]);
    opened.disposeNavigationGuard();
    expect(calls.at(-1)).toBe("remove-navigation-guard");
  });
});
