import { createHash } from "node:crypto";
import { win32 } from "node:path";

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayFingerprint {
  displayId: string;
  bounds: Rectangle;
  scaleFactor: number;
}

export interface DisplayMapRole extends DisplayFingerprint {
  geometrySha256: string;
}

export interface DisplayMapConfig {
  schema: 1;
  mappingStatus: "confirmed" | "unconfirmed";
  expectedDisplayCount: 2;
  primary: DisplayMapRole;
  secondary: DisplayMapRole;
}

export interface RuntimeDisplay {
  displayId: string | number;
  bounds: Rectangle;
  scaleFactor: number;
}

export type DisplayRoute =
  | { state: "ready"; reason: string }
  | { state: "mapped"; primary: RuntimeDisplay; secondary: RuntimeDisplay };

export interface SecondaryWindowPlan {
  browserWindowOptions: {
    frame: false;
    fullscreen: true;
    autoHideMenuBar: true;
    x: number;
    y: number;
    width: number;
    height: number;
    webPreferences: {
      contextIsolation: true;
      nodeIntegration: false;
      sandbox: true;
      preload: string;
    };
  };
  isNavigationAllowed: (targetUrl: string) => boolean;
}

export interface SecondaryNavigationEvent {
  preventDefault(): void;
}

export interface SecondaryWebContentsAdapter {
  on(
    eventName: "will-navigate",
    listener: (event: SecondaryNavigationEvent, targetUrl: string) => void,
  ): void;
  removeListener(
    eventName: "will-navigate",
    listener: (event: SecondaryNavigationEvent, targetUrl: string) => void,
  ): void;
  setWindowOpenHandler(
    handler: (details: { url: string }) => { action: "deny" },
  ): void;
}

export interface SecondaryBrowserWindowAdapter {
  webContents: SecondaryWebContentsAdapter;
  loadURL(targetUrl: string): Promise<void>;
}

export interface OpenSecondaryReadyWindowOptions {
  bounds: Rectangle;
  preloadPath: string;
  entryUrl: string;
  createWindow(
    options: SecondaryWindowPlan["browserWindowOptions"],
  ): SecondaryBrowserWindowAdapter;
}

const HASH_PATTERN = /^[0-9a-f]{64}$/;

export function hashDisplayGeometry(fingerprint: DisplayFingerprint): string {
  const canonical = JSON.stringify([
    fingerprint.displayId,
    fingerprint.bounds.x,
    fingerprint.bounds.y,
    fingerprint.bounds.width,
    fingerprint.bounds.height,
    fingerprint.scaleFactor,
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function routeDisplays(displays: readonly RuntimeDisplay[], config: DisplayMapConfig): DisplayRoute {
  if (!isDisplayMapConfig(config)) {
    return { state: "ready", reason: "display-map-invalid" };
  }
  if (config.mappingStatus !== "confirmed") {
    return { state: "ready", reason: "display-map-unconfirmed" };
  }
  if (displays.length !== config.expectedDisplayCount) {
    return { state: "ready", reason: "display-count-mismatch" };
  }
  if (!displays.every(isRuntimeDisplay)) {
    return { state: "ready", reason: "display-runtime-invalid" };
  }
  if (config.primary.displayId === config.secondary.displayId) {
    return { state: "ready", reason: "display-role-conflict" };
  }

  if (!hasValidGeometryHash(config.primary) || !hasValidGeometryHash(config.secondary)) {
    return { state: "ready", reason: "display-map-hash-mismatch" };
  }

  const primary = displays.find(
    (display) => String(display.displayId) === config.primary.displayId,
  );
  const secondary = displays.find(
    (display) => String(display.displayId) === config.secondary.displayId,
  );
  if (primary === undefined || secondary === undefined || primary === secondary) {
    return { state: "ready", reason: "display-id-mismatch" };
  }
  if (!matchesFingerprint(primary, config.primary) || !matchesFingerprint(secondary, config.secondary)) {
    return { state: "ready", reason: "display-geometry-mismatch" };
  }

  return { state: "mapped", primary, secondary };
}

export function createSecondaryWindowPlan(
  bounds: Rectangle,
  preloadPath: string,
  entryUrl: string,
): SecondaryWindowPlan {
  if (!isRectangle(bounds)) throw new Error("Secondary window rectangle is invalid");
  if (!win32.isAbsolute(preloadPath)) {
    throw new Error("Secondary preload path must be absolute");
  }
  if (win32.extname(preloadPath).toLowerCase() !== ".cjs") {
    throw new Error("Secondary preload must be a CommonJS .cjs bundle");
  }
  if (!isLocalFileUrl(entryUrl)) {
    throw new Error("Secondary entry URL must be a local file URL");
  }

  return {
    browserWindowOptions: {
      frame: false,
      fullscreen: true,
      autoHideMenuBar: true,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: preloadPath,
      },
    },
    isNavigationAllowed: (targetUrl) => targetUrl === entryUrl,
  };
}

export function installSecondaryNavigationGuard(
  webContents: SecondaryWebContentsAdapter,
  entryUrl: string,
): () => void {
  if (!isLocalFileUrl(entryUrl)) {
    throw new Error("Secondary entry URL must be a local file URL");
  }

  const listener = (event: SecondaryNavigationEvent, targetUrl: string): void => {
    if (targetUrl !== entryUrl) event.preventDefault();
  };
  webContents.on("will-navigate", listener);
  webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  let installed = true;
  return () => {
    if (!installed) return;
    installed = false;
    webContents.removeListener("will-navigate", listener);
  };
}

export async function openSecondaryReadyWindow(
  options: OpenSecondaryReadyWindowOptions,
): Promise<{
  window: SecondaryBrowserWindowAdapter;
  disposeNavigationGuard: () => void;
}> {
  const plan = createSecondaryWindowPlan(
    options.bounds,
    options.preloadPath,
    options.entryUrl,
  );
  const window = options.createWindow(plan.browserWindowOptions);
  const disposeNavigationGuard = installSecondaryNavigationGuard(
    window.webContents,
    options.entryUrl,
  );

  try {
    await window.loadURL(options.entryUrl);
  } catch (error) {
    disposeNavigationGuard();
    throw error;
  }

  return { window, disposeNavigationGuard };
}

function hasValidGeometryHash(role: DisplayMapRole): boolean {
  return HASH_PATTERN.test(role.geometrySha256) && hashDisplayGeometry(role) === role.geometrySha256;
}

function matchesFingerprint(display: RuntimeDisplay, expected: DisplayFingerprint): boolean {
  return (
    String(display.displayId) === expected.displayId &&
    display.scaleFactor === expected.scaleFactor &&
    rectanglesEqual(display.bounds, expected.bounds)
  );
}

function rectanglesEqual(left: Rectangle, right: Rectangle): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function isRectangle(value: unknown): value is Rectangle {
  return (
    value !== null &&
    typeof value === "object" &&
    "x" in value &&
    "y" in value &&
    "width" in value &&
    "height" in value &&
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    typeof value.width === "number" &&
    typeof value.height === "number" &&
    Number.isSafeInteger(value.x) &&
    Number.isSafeInteger(value.y) &&
    Number.isSafeInteger(value.width) &&
    Number.isSafeInteger(value.height) &&
    value.width > 0 &&
    value.height > 0
  );
}

function isDisplayMapConfig(value: DisplayMapConfig): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    value.schema === 1 &&
    (value.mappingStatus === "confirmed" || value.mappingStatus === "unconfirmed") &&
    value.expectedDisplayCount === 2 &&
    isDisplayMapRole(value.primary) &&
    isDisplayMapRole(value.secondary)
  );
}

function isDisplayMapRole(value: DisplayMapRole): boolean {
  return (
    isDisplayFingerprint(value) &&
    typeof value.geometrySha256 === "string" &&
    HASH_PATTERN.test(value.geometrySha256)
  );
}

function isRuntimeDisplay(value: RuntimeDisplay): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    ((typeof value.displayId === "string" && value.displayId.length > 0) ||
      (typeof value.displayId === "number" && Number.isSafeInteger(value.displayId))) &&
    isRectangle(value.bounds) &&
    Number.isFinite(value.scaleFactor) &&
    value.scaleFactor > 0
  );
}

function isDisplayFingerprint(value: DisplayFingerprint): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.displayId === "string" &&
    value.displayId.length > 0 &&
    isRectangle(value.bounds) &&
    Number.isFinite(value.scaleFactor) &&
    value.scaleFactor > 0
  );
}

function isLocalFileUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "file:" && parsed.hostname.length === 0;
  } catch {
    return false;
  }
}
