import { createHash } from "node:crypto";
import { win32 } from "node:path";

import {
  hashDisplayGeometryV2,
  hashDisplayTopology,
  type DisplayLayout,
  type DisplayMapBindingV2,
  type DisplayMapV2,
  type DisplayMode,
  type ShowRuntimeDisplay,
  type SoftDisplayId,
} from "./display-routing-contract.js";

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

export type DisplayConfigurationReason =
  | "display-map-invalid"
  | "display-map-unconfirmed"
  | "display-count-mismatch"
  | "display-runtime-invalid"
  | "display-role-conflict"
  | "display-map-hash-mismatch"
  | "display-layout-hash-mismatch"
  | "display-mode-mismatch"
  | "display-id-mismatch"
  | "display-geometry-mismatch";

export type ResolvedDisplayRoute =
  | {
      state: "mapped";
      mode: "legacy-dual" | DisplayMode;
      roles: Partial<Record<SoftDisplayId, ShowRuntimeDisplay>>;
      skippedRoles: readonly SoftDisplayId[];
      unassignedDisplays: readonly ShowRuntimeDisplay[];
    }
  | { state: "configuration-required"; reason: DisplayConfigurationReason };

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

export function resolveDisplayRoute(
  displays: readonly ShowRuntimeDisplay[],
  layout: DisplayLayout,
  map: DisplayMapConfig | DisplayMapV2,
): ResolvedDisplayRoute {
  if (map.schema === 1) {
    const legacyRoute = routeDisplays(displays, map);
    if (legacyRoute.state !== "mapped") {
      return configurationRequired(normalizeLegacyReason(legacyRoute.reason));
    }
    if (
      !isShowRuntimeDisplay(legacyRoute.primary) ||
      !isShowRuntimeDisplay(legacyRoute.secondary)
    ) {
      return configurationRequired("display-runtime-invalid");
    }
    return mappedRoute(
      "legacy-dual",
      {
        "SCREEN-1": legacyRoute.primary,
        "SCREEN-2": legacyRoute.secondary,
      },
      ["SCREEN-3"],
      [],
    );
  }

  if (map.mappingStatus !== "confirmed") {
    return configurationRequired("display-map-unconfirmed");
  }
  if (map.layoutSha256 !== layout.layoutSha256) {
    return configurationRequired("display-layout-hash-mismatch");
  }
  if (!hasValidV2MapIntegrity(map)) {
    return configurationRequired("display-map-hash-mismatch");
  }
  if (!hasValidRuntimeTopology(displays)) {
    return configurationRequired("display-runtime-invalid");
  }

  if (map.mode === "single-display-preview") {
    if (displays.length !== 1) {
      return configurationRequired("display-count-mismatch");
    }
    if (
      map.bindings.length !== 1 ||
      map.bindings[0]?.softId !== "SCREEN-1"
    ) {
      return configurationRequired("display-mode-mismatch");
    }
    return resolveV2Bindings(displays, map.mode, map.bindings, [
      "SCREEN-2",
      "SCREEN-3",
    ]);
  }

  if (map.mode === "production-3") {
    if (displays.length < 3) {
      return configurationRequired("display-count-mismatch");
    }
    const softIds = map.bindings.map((binding) => binding.softId);
    if (
      map.bindings.length !== 3 ||
      new Set(softIds).size !== 3 ||
      !(["SCREEN-1", "SCREEN-2", "SCREEN-3"] as const).every((softId) =>
        softIds.includes(softId),
      )
    ) {
      return configurationRequired("display-mode-mismatch");
    }
    return resolveV2Bindings(displays, map.mode, map.bindings, []);
  }

  return configurationRequired("display-mode-mismatch");
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

function hasValidV2MapIntegrity(map: DisplayMapV2): boolean {
  const topology = [...map.bindings, ...map.unassignedDisplays];
  const displayIds = topology.map((display) => display.displayId);
  const softIds = map.bindings.map((binding) => binding.softId);
  return (
    topology.length <= 16 &&
    new Set(displayIds).size === displayIds.length &&
    new Set(softIds).size === softIds.length &&
    map.bindings.every(
      (binding) =>
        HASH_PATTERN.test(binding.geometrySha256) &&
        hashDisplayGeometryV2(binding) === binding.geometrySha256,
    ) &&
    map.unassignedDisplays.every(
      (display) =>
        HASH_PATTERN.test(display.geometrySha256) &&
        hashDisplayGeometryV2(display) === display.geometrySha256,
    ) &&
    HASH_PATTERN.test(map.topologySha256) &&
    hashDisplayTopology(topology) === map.topologySha256
  );
}

function resolveV2Bindings(
  displays: readonly ShowRuntimeDisplay[],
  mode: DisplayMode,
  bindings: readonly DisplayMapBindingV2[],
  skippedRoles: readonly SoftDisplayId[],
): ResolvedDisplayRoute {
  const roles: Partial<Record<SoftDisplayId, ShowRuntimeDisplay>> = {};
  const assignedIds = new Set<string>();
  for (const binding of bindings) {
    if (assignedIds.has(binding.displayId)) {
      return configurationRequired("display-role-conflict");
    }
    const display = displays.find(
      (candidate) => String(candidate.displayId) === binding.displayId,
    );
    if (display === undefined) {
      return configurationRequired("display-id-mismatch");
    }
    if (hashDisplayGeometryV2(display) !== binding.geometrySha256) {
      return configurationRequired("display-geometry-mismatch");
    }
    roles[binding.softId] = display;
    assignedIds.add(binding.displayId);
  }

  return mappedRoute(
    mode,
    roles,
    skippedRoles,
    displays.filter((display) => !assignedIds.has(String(display.displayId))),
  );
}

function mappedRoute(
  mode: "legacy-dual" | DisplayMode,
  roles: Partial<Record<SoftDisplayId, ShowRuntimeDisplay>>,
  skippedRoles: readonly SoftDisplayId[],
  unassignedDisplays: readonly ShowRuntimeDisplay[],
): ResolvedDisplayRoute {
  const clonedRoles: Partial<Record<SoftDisplayId, ShowRuntimeDisplay>> = {};
  for (const softId of ["SCREEN-1", "SCREEN-2", "SCREEN-3"] as const) {
    const display = roles[softId];
    if (display !== undefined) clonedRoles[softId] = cloneDisplay(display);
  }
  return Object.freeze({
    state: "mapped" as const,
    mode,
    roles: Object.freeze(clonedRoles),
    skippedRoles: Object.freeze([...skippedRoles]),
    unassignedDisplays: Object.freeze(unassignedDisplays.map(cloneDisplay)),
  });
}

function configurationRequired(
  reason: DisplayConfigurationReason,
): ResolvedDisplayRoute {
  return Object.freeze({ state: "configuration-required" as const, reason });
}

function cloneDisplay(display: ShowRuntimeDisplay): ShowRuntimeDisplay {
  return Object.freeze({
    displayId: display.displayId,
    bounds: Object.freeze({ ...display.bounds }),
    workingArea: Object.freeze({ ...display.workingArea }),
    scaleFactor: display.scaleFactor,
    rotation: display.rotation,
  });
}

function hasValidRuntimeTopology(
  displays: readonly ShowRuntimeDisplay[],
): boolean {
  if (displays.length > 16 || !displays.every(isShowRuntimeDisplay)) return false;
  const ids = displays.map((display) => String(display.displayId));
  return new Set(ids).size === ids.length;
}

function isShowRuntimeDisplay(value: RuntimeDisplay): value is ShowRuntimeDisplay {
  if (
    value === null ||
    typeof value !== "object" ||
    !("workingArea" in value) ||
    !("rotation" in value)
  ) {
    return false;
  }
  const hasValidDisplayId =
    (typeof value.displayId === "string" && value.displayId.length > 0) ||
    (typeof value.displayId === "number" && Number.isSafeInteger(value.displayId));
  const displayId = String(value.displayId);
  return (
    hasValidDisplayId &&
    Buffer.byteLength(displayId, "utf8") <= 256 &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(displayId) &&
    isRectangle(value.bounds) &&
    isRectangle(value.workingArea) &&
    Number.isFinite(value.scaleFactor) &&
    value.scaleFactor > 0 &&
    value.scaleFactor <= Number.MAX_SAFE_INTEGER &&
    (value.rotation === 0 ||
      value.rotation === 90 ||
      value.rotation === 180 ||
      value.rotation === 270)
  );
}

function normalizeLegacyReason(reason: string): DisplayConfigurationReason {
  switch (reason) {
    case "display-map-invalid":
    case "display-map-unconfirmed":
    case "display-count-mismatch":
    case "display-runtime-invalid":
    case "display-role-conflict":
    case "display-map-hash-mismatch":
    case "display-id-mismatch":
    case "display-geometry-mismatch":
      return reason;
    default:
      return "display-map-invalid";
  }
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
