import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { win32 } from "node:path";
import { pathToFileURL } from "node:url";

import {
  CLOSE_IDENTIFY_CHANNEL,
  IDENTIFY_CHANNEL,
  SAVE_DISPLAY_MAP_CHANNEL,
  SNAPSHOT_CHANNEL,
  parseConfigurationSnapshot,
  parseSaveDisplayMapRequest,
  parseSnapshotRequest,
  parseTopologyRequest,
  type ConfigurationSnapshot,
  type NumberedDisplay,
  type SaveDisplayMapRequest,
} from "./display-config-ipc-contract.js";
import type { DisplayConfigCommand } from "./display-config-command.js";
import {
  hashDisplayGeometryV2,
  hashDisplayTopology,
  parseDisplayLayout,
  parseDisplayMap,
  type DisplayLayout,
  type DisplayMapBindingV2,
  type DisplayMapPhysicalSnapshot,
  type DisplayMode,
  type DisplayRectangleV2,
  type DisplayRotation,
  type SoftDisplayId,
} from "./display-routing-contract.js";
import type {
  LocalWebRequestAdapter,
} from "./runtime-adapter-common.js";

export {
  CLOSE_IDENTIFY_CHANNEL,
  IDENTIFY_CHANNEL,
  SAVE_DISPLAY_MAP_CHANNEL,
  SNAPSHOT_CHANNEL,
};

export interface DisplayConfigNavigationEvent {
  preventDefault(): void;
}

export interface DisplayConfigSessionAdapter {
  readonly webRequest: LocalWebRequestAdapter;
}

export interface DisplayConfigWebContentsAdapter {
  readonly session: DisplayConfigSessionAdapter;
  on(
    event: "will-navigate",
    listener: (
      event: DisplayConfigNavigationEvent,
      targetUrl: string,
    ) => void,
  ): void;
  removeListener(
    event: "will-navigate",
    listener: (
      event: DisplayConfigNavigationEvent,
      targetUrl: string,
    ) => void,
  ): void;
  setWindowOpenHandler(
    handler: (details: { url: string }) => { action: "deny" },
  ): void;
}

export interface DisplayConfigBrowserWindowAdapter {
  readonly webContents: DisplayConfigWebContentsAdapter;
  loadURL(url: string): Promise<void>;
  on(event: "closed", listener: () => void): this;
  once(event: "closed", listener: () => void): this;
  removeListener(event: "closed", listener: () => void): this;
  close(): void;
  destroy(): void;
  isDestroyed(): boolean;
}

export type DisplayConfigBrowserWindowConstructor = new (
  options: Record<string, unknown>,
) => DisplayConfigBrowserWindowAdapter;

export interface DisplayConfigIpcEvent {
  readonly sender?: unknown;
  readonly senderFrame: { readonly url: string } | null;
}

export interface DisplayConfigIpcMainAdapter {
  handle(
    channel: string,
    listener: (
      event: DisplayConfigIpcEvent,
      payload: unknown,
    ) => Promise<unknown>,
  ): void;
  removeHandler(channel: string): void;
}

export interface DisplayConfigTimerAdapter {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface DisplayMapAtomicFileSystem {
  openExclusive(path: string): number;
  write(descriptor: number, bytes: Uint8Array): void;
  flush(descriptor: number): void;
  close(descriptor: number): void;
  rename(source: string, target: string): void;
  remove(path: string): void;
}

export interface DisplayConfiguratorHost {
  readonly repositoryRoot: string;
  readonly BrowserWindow: DisplayConfigBrowserWindowConstructor;
  readonly ipcMain: DisplayConfigIpcMainAdapter;
  readonly screen: { getAllDisplays(): readonly unknown[] };
  readonly fromPartition: (partition: string) => DisplayConfigSessionAdapter;
  readonly readFile?: (path: string) => Buffer;
  readonly pathExists?: (path: string) => boolean;
  readonly prepareTarget?: (command: DisplayConfigCommand) => void;
  readonly atomicFileSystem?: DisplayMapAtomicFileSystem;
  readonly randomSuffix?: () => string;
  readonly nowUtc?: () => string;
  readonly timers?: DisplayConfigTimerAdapter;
}

const MAX_DISPLAYS = 16;
const IDENTIFY_DURATION_MS = 12_000;
const SESSION_PARTITION = "janvim-display-configurator";
const REMOTE_REQUEST_FILTER = {
  urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"],
};
const SOFT_ROLE_ORDER = ["SCREEN-1", "SCREEN-2", "SCREEN-3"] as const;
const TERMINAL_EVIDENCE_FILES = [
  "controller-terminal.json",
  "run-lease.json",
  "controller-incident.json",
  "show-run.json",
  "watchdog-attempts.jsonl",
] as const;

export function captureConfigurationSnapshot(
  rawDisplays: readonly unknown[],
): ConfigurationSnapshot {
  if (rawDisplays.length > MAX_DISPLAYS) {
    throw new Error("Display topology must contain at most 16 displays");
  }

  const displays = rawDisplays.map(normalizePhysicalDisplay);
  const ids = displays.map((display) => display.displayId);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Display topology contains duplicate display IDs");
  }
  displays.sort((left, right) =>
    left.bounds.y - right.bounds.y ||
    left.bounds.x - right.bounds.x ||
    left.displayId.localeCompare(right.displayId, "en"),
  );

  const numbered = displays.map((display, index) => ({
    number: index + 1,
    ...display,
  }));
  const allowedModes: DisplayMode[] =
    numbered.length === 1
      ? ["single-display-preview"]
      : numbered.length >= 3
        ? ["production-3"]
        : [];
  const snapshot = parseConfigurationSnapshot({
    topologySha256: hashDisplayTopology(numbered),
    displays: numbered,
    allowedModes,
  });
  return deepFreeze(cloneSnapshot(snapshot));
}

export function buildDisplayMapBytes(
  layout: DisplayLayout,
  snapshotValue: ConfigurationSnapshot,
  requestValue: SaveDisplayMapRequest,
  capturedAtUtc: string,
): Buffer {
  const snapshot = parseConfigurationSnapshot(snapshotValue);
  const request = parseSaveDisplayMapRequest(requestValue);
  if (request.topologySha256 !== snapshot.topologySha256) {
    throw new Error("Display topology changed; refresh before saving");
  }
  if (!snapshot.allowedModes.includes(request.mode)) {
    throw new Error("Display mode is not allowed for this topology");
  }

  const bindingsByRole = new Map<SoftDisplayId, string>();
  const assignedDisplayIds = new Set<string>();
  for (const binding of request.bindings) {
    if (bindingsByRole.has(binding.softId)) {
      throw new Error("Display map contains duplicate roles");
    }
    if (assignedDisplayIds.has(binding.displayId)) {
      throw new Error("Display map roles must use distinct displays");
    }
    bindingsByRole.set(binding.softId, binding.displayId);
    assignedDisplayIds.add(binding.displayId);
  }

  const requiredRoles: readonly SoftDisplayId[] =
    request.mode === "production-3" ? SOFT_ROLE_ORDER : ["SCREEN-1"];
  if (
    request.bindings.length !== requiredRoles.length ||
    !requiredRoles.every((softId) => bindingsByRole.has(softId))
  ) {
    throw new Error("Display map bindings do not match the selected mode roles");
  }
  if (
    request.mode === "single-display-preview" &&
    snapshot.displays.length !== 1
  ) {
    throw new Error("Single-display preview requires exactly one display");
  }

  const displayById = new Map(
    snapshot.displays.map((display) => [display.displayId, display]),
  );
  const bindings: DisplayMapBindingV2[] = requiredRoles.map((softId) => {
    const displayId = bindingsByRole.get(softId)!;
    const display = displayById.get(displayId);
    if (display === undefined) {
      throw new Error("Display map binding references a stale display ID");
    }
    return { softId, ...withoutNumber(display) };
  });
  const unassignedDisplays = snapshot.displays
    .filter((display) => !assignedDisplayIds.has(display.displayId))
    .map(withoutNumber);
  const topology = [...bindings, ...unassignedDisplays];
  const map = {
    schema: 2,
    mappingStatus: "confirmed",
    mode: request.mode,
    layoutSha256: layout.layoutSha256,
    capturedAtUtc,
    topologySha256: hashDisplayTopology(topology),
    bindings,
    unassignedDisplays,
  } as const;
  const bytes = Buffer.from(`${JSON.stringify(map, null, 2)}\n`, "utf8");
  parseDisplayMap(bytes);
  return bytes;
}

export async function writeDisplayMapAtomic(
  targetPath: string,
  bytes: Uint8Array,
  beforeCommit: () => void | Promise<void>,
  fileSystem: DisplayMapAtomicFileSystem = realAtomicFileSystem,
  suffix: string = randomUUID(),
): Promise<void> {
  parseDisplayMap(bytes);
  if (!/^[A-Za-z0-9-]{1,64}$/u.test(suffix)) {
    throw new Error("Display map temporary suffix is invalid");
  }
  const temporaryPath = win32.join(
    win32.dirname(targetPath),
    `.display-map-${suffix}.tmp`,
  );
  let descriptor: number | undefined;
  let ownsTemporary = false;
  try {
    descriptor = fileSystem.openExclusive(temporaryPath);
    ownsTemporary = true;
    fileSystem.write(descriptor, bytes);
    fileSystem.flush(descriptor);
    fileSystem.close(descriptor);
    descriptor = undefined;
    await beforeCommit();
    fileSystem.rename(temporaryPath, targetPath);
    ownsTemporary = false;
  } finally {
    if (descriptor !== undefined) {
      try {
        fileSystem.close(descriptor);
      } catch {
        // Preserve the original write failure.
      }
    }
    if (ownsTemporary) {
      try {
        fileSystem.remove(temporaryPath);
      } catch {
        // Preserve the original write or commit failure.
      }
    }
  }
}

export async function runDisplayConfigurator(
  command: DisplayConfigCommand,
  source: DisplayConfiguratorHost,
): Promise<number> {
  const host = normalizeHost(source);
  host.prepareTarget(command);
  const layout = parseDisplayLayout(
    host.readFile(win32.join(host.repositoryRoot, "show", "display-layout.json")),
  );
  const initialSnapshot = captureConfigurationSnapshot(
    host.screen.getAllDisplays(),
  );
  const mainEntry = pathToFileURL(
    win32.join(
      host.repositoryRoot,
      "apps",
      "display-configurator",
      "dist",
      "index.html",
    ),
  );
  mainEntry.searchParams.set(
    "topologySha256",
    initialSnapshot.topologySha256,
  );
  const mainEntryUrl = mainEntry.href;
  const identifyEntryPath = win32.join(
    host.repositoryRoot,
    "apps",
    "display-configurator",
    "dist",
    "identify.html",
  );
  const preloadPath = win32.join(
    host.repositoryRoot,
    "apps",
    "controller",
    "dist",
    "display-config-preload",
    "display-config-preload.cjs",
  );

  const session = host.fromPartition(SESSION_PARTITION);
  const disposeSessionGuard = installSessionNetworkGuard(session);
  let mainWindow: DisplayConfigBrowserWindowAdapter;
  try {
    mainWindow = new host.BrowserWindow({
      width: 1120,
      height: 760,
      minWidth: 880,
      minHeight: 640,
      autoHideMenuBar: true,
      backgroundColor: "#11111b",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: preloadPath,
        session,
      },
    });
  } catch (error) {
    safely(disposeSessionGuard);
    throw error;
  }
  let disposeMainNavigation: () => void;
  try {
    disposeMainNavigation = installWindowNavigationGuard(
      mainWindow.webContents,
      mainEntryUrl,
    );
  } catch (error) {
    if (!mainWindow.isDestroyed()) safely(() => mainWindow.destroy());
    safely(disposeSessionGuard);
    throw error;
  }

  let activeSnapshot: ConfigurationSnapshot | undefined = initialSnapshot;
  let identifyTimer: unknown;
  let identifyCards: Array<{
    window: DisplayConfigBrowserWindowAdapter;
    disposeNavigation: () => void;
  }> = [];
  let cleaned = false;

  const closeIdentifyCards = (): void => {
    if (identifyTimer !== undefined) {
      host.timers.clearTimeout(identifyTimer);
      identifyTimer = undefined;
    }
    const cards = identifyCards;
    identifyCards = [];
    for (const card of cards) {
      safely(card.disposeNavigation);
      if (!card.window.isDestroyed()) safely(() => card.window.close());
    }
  };

  const openIdentifyCards = async (snapshot: ConfigurationSnapshot): Promise<void> => {
    closeIdentifyCards();
    if (cleaned) throw new Error("Display configurator session is closed");
    identifyTimer = host.timers.setTimeout(
      closeIdentifyCards,
      IDENTIFY_DURATION_MS,
    );
    try {
      for (const display of snapshot.displays) {
        if (cleaned) throw new Error("Display configurator session is closed");
        const cardUrl = new URL(pathToFileURL(identifyEntryPath).href);
        cardUrl.searchParams.set("number", String(display.number));
        const window = new host.BrowserWindow({
          frame: false,
          fullscreen: true,
          autoHideMenuBar: true,
          alwaysOnTop: true,
          skipTaskbar: true,
          x: display.bounds.x,
          y: display.bounds.y,
          width: display.bounds.width,
          height: display.bounds.height,
          backgroundColor: "#11111b",
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            session,
          },
        });
        let disposeNavigation: () => void;
        try {
          disposeNavigation = installWindowNavigationGuard(
            window.webContents,
            cardUrl.href,
          );
        } catch (error) {
          if (!window.isDestroyed()) safely(() => window.destroy());
          throw error;
        }
        identifyCards.push({ window, disposeNavigation });
        await window.loadURL(cardUrl.href);
        if (cleaned) throw new Error("Display configurator session is closed");
      }
    } catch (error) {
      closeIdentifyCards();
      throw error;
    }
  };

  const assertAuthorized = (event: DisplayConfigIpcEvent): void => {
    if (
      event.sender !== mainWindow.webContents ||
      event.senderFrame?.url !== mainEntryUrl
    ) {
      throw new Error("Display configurator IPC sender is unauthorized");
    }
  };

  const sample = (): ConfigurationSnapshot =>
    captureConfigurationSnapshot(host.screen.getAllDisplays());
  const requireCurrentSnapshot = (
    topologySha256: string,
  ): ConfigurationSnapshot => {
    if (
      activeSnapshot === undefined ||
      activeSnapshot.topologySha256 !== topologySha256
    ) {
      throw new Error("Display topology changed; refresh before continuing");
    }
    const current = sample();
    if (current.topologySha256 !== topologySha256) {
      throw new Error("Display topology changed; refresh before continuing");
    }
    return current;
  };

  const handlers = new Map<
    string,
    (event: DisplayConfigIpcEvent, payload: unknown) => Promise<unknown>
  >([
    [
      SNAPSHOT_CHANNEL,
      async (event, payload) => {
        assertAuthorized(event);
        let request: { readonly topologySha256: string };
        try {
          request = parseSnapshotRequest(payload);
        } catch {
          throw new Error("Display snapshot request is invalid");
        }
        closeIdentifyCards();
        activeSnapshot = requireCurrentSnapshot(request.topologySha256);
        return activeSnapshot;
      },
    ],
    [
      IDENTIFY_CHANNEL,
      async (event, payload) => {
        assertAuthorized(event);
        let request: { readonly topologySha256: string };
        try {
          request = parseTopologyRequest(payload);
        } catch {
          throw new Error("Display identify request is invalid");
        }
        await openIdentifyCards(requireCurrentSnapshot(request.topologySha256));
        return { closedAfterMs: IDENTIFY_DURATION_MS };
      },
    ],
    [
      CLOSE_IDENTIFY_CHANNEL,
      async (event, payload) => {
        assertAuthorized(event);
        let request: { readonly topologySha256: string };
        try {
          request = parseTopologyRequest(payload);
        } catch {
          throw new Error("Display close-identify request is invalid");
        }
        requireCurrentSnapshot(request.topologySha256);
        closeIdentifyCards();
        return { closed: true };
      },
    ],
    [
      SAVE_DISPLAY_MAP_CHANNEL,
      async (event, payload) => {
        assertAuthorized(event);
        let request: SaveDisplayMapRequest;
        try {
          request = parseSaveDisplayMapRequest(payload);
        } catch {
          throw new Error("Display map save request is invalid");
        }
        const current = requireCurrentSnapshot(request.topologySha256);
        host.prepareTarget(command);
        assertNoTerminalEvidence(command.rehearsalRoot, host.pathExists);
        const bytes = buildDisplayMapBytes(
          layout,
          current,
          request,
          host.nowUtc(),
        );
        await writeDisplayMapAtomic(
          command.displayMapPath,
          bytes,
          () => {
            if (cleaned) {
              throw new Error("Display configurator session is closed");
            }
            host.prepareTarget(command);
            const finalSnapshot = sample();
            if (finalSnapshot.topologySha256 !== request.topologySha256) {
              throw new Error("Display topology changed before map commit");
            }
            assertNoTerminalEvidence(command.rehearsalRoot, host.pathExists);
          },
          host.atomicFileSystem,
          host.randomSuffix(),
        );
        return { saved: true, displayMapPath: command.displayMapPath };
      },
    ],
  ]);
  const registeredChannels: string[] = [];

  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    closeIdentifyCards();
    for (const channel of registeredChannels) {
      safely(() => host.ipcMain.removeHandler(channel));
    }
    registeredChannels.length = 0;
    safely(disposeMainNavigation);
    safely(disposeSessionGuard);
  };

  const completion = new Promise<number>((resolve) => {
    mainWindow.once("closed", () => {
      cleanup();
      resolve(0);
    });
  });
  try {
    for (const [channel, handler] of handlers) {
      host.ipcMain.handle(channel, handler);
      registeredChannels.push(channel);
    }
    await mainWindow.loadURL(mainEntryUrl);
    return await completion;
  } catch (error) {
    cleanup();
    if (!mainWindow.isDestroyed()) safely(() => mainWindow.destroy());
    throw error;
  }
}

function normalizePhysicalDisplay(value: unknown): DisplayMapPhysicalSnapshot {
  if (value === null || typeof value !== "object") {
    throw new Error("Display runtime record is invalid");
  }
  const raw = value as Record<string, unknown>;
  const id = raw.id;
  if (
    !(
      (typeof id === "string" && id.length > 0) ||
      (typeof id === "number" && Number.isSafeInteger(id))
    )
  ) {
    throw new Error("Display ID is invalid");
  }
  const displayId = String(id);
  const label = raw.label;
  if (
    Buffer.byteLength(displayId, "utf8") > 256 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(displayId)
  ) {
    throw new Error("Display ID must be at most 256 UTF-8 bytes without controls");
  }
  if (
    typeof label !== "string" ||
    Buffer.byteLength(label, "utf8") > 512 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(label)
  ) {
    throw new Error("Display label must be at most 512 UTF-8 bytes without controls");
  }
  const bounds = normalizeRectangle(raw.bounds);
  const workingArea = normalizeRectangle(raw.workArea);
  const scaleFactor = raw.scaleFactor;
  if (
    typeof scaleFactor !== "number" ||
    !Number.isFinite(scaleFactor) ||
    scaleFactor <= 0 ||
    scaleFactor > Number.MAX_SAFE_INTEGER
  ) {
    throw new Error("Display scale factor is invalid");
  }
  const rotation = raw.rotation;
  if (rotation !== 0 && rotation !== 90 && rotation !== 180 && rotation !== 270) {
    throw new Error("Display rotation is invalid");
  }
  const geometry = {
    displayId,
    bounds,
    workingArea,
    scaleFactor,
    rotation: rotation as DisplayRotation,
  };
  return {
    ...geometry,
    label,
    geometrySha256: hashDisplayGeometryV2(geometry),
  };
}

function normalizeRectangle(value: unknown): DisplayRectangleV2 {
  if (value === null || typeof value !== "object") {
    throw new Error("Display rectangle is invalid");
  }
  const raw = value as Record<string, unknown>;
  const rectangle = {
    x: raw.x,
    y: raw.y,
    width: raw.width,
    height: raw.height,
  };
  if (
    !Number.isSafeInteger(rectangle.x) ||
    !Number.isSafeInteger(rectangle.y) ||
    !Number.isSafeInteger(rectangle.width) ||
    !Number.isSafeInteger(rectangle.height) ||
    (rectangle.width as number) <= 0 ||
    (rectangle.height as number) <= 0 ||
    !Number.isSafeInteger((rectangle.x as number) + (rectangle.width as number)) ||
    !Number.isSafeInteger((rectangle.y as number) + (rectangle.height as number))
  ) {
    throw new Error("Display rectangle is invalid");
  }
  return rectangle as DisplayRectangleV2;
}

function withoutNumber(display: NumberedDisplay): DisplayMapPhysicalSnapshot {
  return {
    displayId: display.displayId,
    label: display.label,
    bounds: { ...display.bounds },
    workingArea: { ...display.workingArea },
    scaleFactor: display.scaleFactor,
    rotation: display.rotation,
    geometrySha256: display.geometrySha256,
  };
}

function cloneSnapshot(snapshot: ConfigurationSnapshot): ConfigurationSnapshot {
  return {
    topologySha256: snapshot.topologySha256,
    displays: snapshot.displays.map((display) => ({
      ...display,
      bounds: { ...display.bounds },
      workingArea: { ...display.workingArea },
    })),
    allowedModes: [...snapshot.allowedModes],
  };
}

function assertNoTerminalEvidence(
  rehearsalRoot: string,
  pathExists: (path: string) => boolean,
): void {
  const conflict = TERMINAL_EVIDENCE_FILES.find((name) =>
    pathExists(win32.join(rehearsalRoot, name)),
  );
  if (conflict !== undefined) {
    throw new Error(`Display map save refused because show evidence exists: ${conflict}`);
  }
}

function installSessionNetworkGuard(
  session: DisplayConfigSessionAdapter,
): () => void {
  session.webRequest.onBeforeRequest(
    { urls: [...REMOTE_REQUEST_FILTER.urls] },
    (_details, callback) => callback({ cancel: true }),
  );
  let installed = true;
  return () => {
    if (!installed) return;
    installed = false;
    session.webRequest.onBeforeRequest(null);
  };
}

function installWindowNavigationGuard(
  webContents: DisplayConfigWebContentsAdapter,
  entryUrl: string,
): () => void {
  if (!isExactLocalFileUrl(entryUrl)) {
    throw new Error("Display configurator entry must be an exact local file URL");
  }
  const listener = (
    event: DisplayConfigNavigationEvent,
    targetUrl: string,
  ): void => {
    if (targetUrl !== entryUrl) event.preventDefault();
  };
  let listenerInstalled = false;
  try {
    webContents.on("will-navigate", listener);
    listenerInstalled = true;
    webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  } catch (error) {
    if (listenerInstalled) {
      safely(() => webContents.removeListener("will-navigate", listener));
    }
    throw error;
  }
  let installed = true;
  return () => {
    if (!installed) return;
    installed = false;
    webContents.removeListener("will-navigate", listener);
  };
}

function prepareDisplayConfigTarget(command: DisplayConfigCommand): void {
  const parent = win32.dirname(command.rehearsalRoot);
  assertPlainDirectory(parent, "rehearsal parent");
  if (!existsSync(command.rehearsalRoot)) {
    mkdirSync(command.rehearsalRoot, { recursive: false });
  }
  assertPlainDirectory(command.rehearsalRoot, "rehearsal root");
  const realParent = realpathSync.native(parent);
  const realRoot = realpathSync.native(command.rehearsalRoot);
  if (win32.dirname(realRoot).toLowerCase() !== realParent.toLowerCase()) {
    throw new Error("Display configuration target escapes through a reparse point");
  }
  if (existsSync(command.displayMapPath)) {
    const mapStat = lstatSync(command.displayMapPath);
    if (!mapStat.isFile() || mapStat.isSymbolicLink()) {
      throw new Error("Display map target must be a plain file");
    }
  }
}

function assertPlainDirectory(path: string, label: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Display configuration ${label} must be a plain directory`);
  }
}

function isExactLocalFileUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "file:" && parsed.hostname.length === 0;
  } catch {
    return false;
  }
}

function safely(operation: () => void): void {
  try {
    operation();
  } catch {
    // Cleanup remains bounded and continues through independent resources.
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function normalizeHost(source: DisplayConfiguratorHost) {
  return {
    ...source,
    readFile: source.readFile ?? ((path: string) => readFileSync(path)),
    pathExists: source.pathExists ?? existsSync,
    prepareTarget: source.prepareTarget ?? prepareDisplayConfigTarget,
    atomicFileSystem: source.atomicFileSystem ?? realAtomicFileSystem,
    randomSuffix: source.randomSuffix ?? randomUUID,
    nowUtc: source.nowUtc ?? (() => new Date().toISOString()),
    timers: source.timers ?? realTimers,
  };
}

const realAtomicFileSystem: DisplayMapAtomicFileSystem = {
  openExclusive: (path) => openSync(path, "wx", 0o600),
  write: (descriptor, bytes) => writeFileSync(descriptor, bytes),
  flush: (descriptor) => fsyncSync(descriptor),
  close: (descriptor) => closeSync(descriptor),
  rename: (source, target) => renameSync(source, target),
  remove: (path) => rmSync(path, { force: true }),
};

const realTimers: DisplayConfigTimerAdapter = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
