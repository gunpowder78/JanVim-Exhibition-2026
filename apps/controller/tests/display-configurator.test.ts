import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";

import { describe, expect, it } from "vitest";

import { parseDisplayLayout, parseDisplayMap } from "../src/display-routing-contract.ts";
import type { DisplayConfigCommand } from "../src/display-config-command.ts";
import {
  CLOSE_IDENTIFY_CHANNEL,
  IDENTIFY_CHANNEL,
  SAVE_DISPLAY_MAP_CHANNEL,
  SNAPSHOT_CHANNEL,
  buildDisplayMapBytes,
  captureConfigurationSnapshot,
  assertNoDisplayConfigReparseTraversal,
  runDisplayConfigurator,
  writeDisplayMapAtomic,
  type DisplayConfigBrowserWindowAdapter,
  type DisplayConfigBrowserWindowConstructor,
  type DisplayConfigIpcEvent,
  type DisplayConfigIpcMainAdapter,
  type DisplayConfigSessionAdapter,
  type DisplayConfigTimerAdapter,
  type DisplayConfiguratorHost,
  type DisplayMapAtomicFileSystem,
} from "../src/display-configurator.ts";

const repositoryRoot = process.cwd();
const rehearsalRoot =
  "D:\\VirtualData\\JanVim-Exhibition-Rehearsals\\g4-config-runtime-test";
const displayMapPath = win32.join(rehearsalRoot, "display-map.json");
const command: DisplayConfigCommand = {
  mode: "Configure",
  rehearsalRoot,
  displayMapPath,
};
const SNAPSHOT_TOKEN =
  "e77d4b450bc75f560ca5617b6cf6ff84b8754ef29ee8f4f5caca5e524b808c10";

function rawDisplay(
  id: string,
  label: string,
  x: number,
  scaleFactor = 1,
  rotation: 0 | 90 | 180 | 270 = 0,
) {
  return {
    id,
    label,
    bounds: { x, y: 0, width: 1920, height: 1080 },
    workArea: { x, y: 0, width: 1920, height: 1040 },
    scaleFactor,
    rotation,
  };
}

const RAW_DISPLAYS = [
  rawDisplay("A", "A projector", 0),
  rawDisplay("B", "B projector", 1920, 1.25, 90),
  rawDisplay("C", "C projector", 3840, 1, 180),
] as const;

class MemoryAtomicFileSystem implements DisplayMapAtomicFileSystem {
  public readonly files = new Map<string, Buffer>();
  public readonly calls: string[] = [];
  public failRename = false;
  private nextDescriptor = 1;
  private nextIdentity = 1;
  private readonly pathIdentities = new Map<string, string>();
  private readonly reparsePaths = new Set<string>();
  private readonly descriptors = new Map<
    number,
    { path: string; bytes: Buffer; closed: boolean; identity: string }
  >();

  public openExclusive(path: string): number {
    this.calls.push(`open:wx:${path}`);
    if (this.files.has(path)) throw new Error("EEXIST");
    const descriptor = this.nextDescriptor++;
    const identity = `memory-file-${this.nextIdentity++}`;
    this.descriptors.set(descriptor, {
      path,
      bytes: Buffer.alloc(0),
      closed: false,
      identity,
    });
    this.pathIdentities.set(path, identity);
    this.files.set(path, Buffer.alloc(0));
    return descriptor;
  }

  public write(descriptor: number, bytes: Uint8Array): void {
    this.calls.push("write");
    const open = this.requireDescriptor(descriptor);
    open.bytes = Buffer.from(bytes);
    this.files.set(open.path, Buffer.from(bytes));
  }

  public flush(descriptor: number): void {
    this.requireDescriptor(descriptor);
    this.calls.push("flush");
  }

  public inspectDescriptor(descriptor: number) {
    const open = this.requireDescriptor(descriptor);
    this.calls.push("inspect-descriptor");
    return {
      device: "memory",
      file: open.identity,
      byteLength: open.bytes.length,
      regularFile: true,
      reparsePoint: false,
    };
  }

  public inspectPath(path: string) {
    this.calls.push("inspect-path");
    const identity = this.pathIdentities.get(path);
    const bytes = this.files.get(path);
    if (identity === undefined || bytes === undefined) throw new Error("ENOENT");
    return {
      device: "memory",
      file: identity,
      byteLength: bytes.length,
      regularFile: true,
      reparsePoint: this.reparsePaths.has(path),
    };
  }

  public readDescriptor(descriptor: number, maximumBytes: number): Buffer {
    const open = this.requireDescriptor(descriptor);
    this.calls.push("read-descriptor");
    if (open.bytes.length > maximumBytes) throw new Error("bounded read exceeded");
    return Buffer.from(open.bytes);
  }

  public close(descriptor: number): void {
    const open = this.requireDescriptor(descriptor);
    if (open.closed) return;
    open.closed = true;
    this.calls.push("close");
  }

  public rename(source: string, target: string): void {
    this.calls.push(`rename:${source}:${target}`);
    if (this.failRename) throw new Error("rename failed");
    const bytes = this.files.get(source);
    if (bytes === undefined) throw new Error("source missing");
    this.files.set(target, bytes);
    this.files.delete(source);
    this.pathIdentities.delete(source);
    this.reparsePaths.delete(source);
  }

  public remove(path: string): void {
    this.calls.push(`remove:${path}`);
    this.files.delete(path);
    this.pathIdentities.delete(path);
    this.reparsePaths.delete(path);
  }

  public substituteTemporary(bytes: Buffer): void {
    const open = this.lastDescriptor();
    this.files.set(open.path, Buffer.from(bytes));
    this.pathIdentities.set(open.path, `substitute-${this.nextIdentity++}`);
  }

  public markTemporaryReparse(): void {
    this.reparsePaths.add(this.lastDescriptor().path);
  }

  public mutateTemporaryBytes(bytes: Buffer): void {
    const open = this.lastDescriptor();
    open.bytes = Buffer.from(bytes);
    if (this.pathIdentities.get(open.path) === open.identity) {
      this.files.set(open.path, Buffer.from(bytes));
    }
  }

  private requireDescriptor(descriptor: number) {
    const open = this.descriptors.get(descriptor);
    if (open === undefined) throw new Error("bad descriptor");
    return open;
  }

  private lastDescriptor() {
    const open = [...this.descriptors.values()].at(-1);
    if (open === undefined) throw new Error("no temporary descriptor");
    return open;
  }
}

async function captureError(operation: () => unknown): Promise<unknown> {
  try {
    await operation();
    return undefined;
  } catch (error) {
    return error;
  }
}

class FakeIpcMain implements DisplayConfigIpcMainAdapter {
  public readonly handlers = new Map<
    string,
    (event: DisplayConfigIpcEvent, payload: unknown) => Promise<unknown>
  >();

  public handle(
    channel: string,
    listener: (
      event: DisplayConfigIpcEvent,
      payload: unknown,
    ) => Promise<unknown>,
  ): void {
    if (this.handlers.has(channel)) throw new Error("duplicate handler");
    this.handlers.set(channel, listener);
  }

  public removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }

  public invoke(
    channel: string,
    event: DisplayConfigIpcEvent,
    payload: unknown,
  ): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (handler === undefined) return Promise.reject(new Error("handler missing"));
    return handler(event, payload);
  }
}

class FakeTimers implements DisplayConfigTimerAdapter {
  public readonly pending = new Map<number, () => void>();
  public readonly delays: number[] = [];
  private nextId = 1;

  public setTimeout(callback: () => void, delayMs: number): number {
    const id = this.nextId++;
    this.pending.set(id, callback);
    this.delays.push(delayMs);
    return id;
  }

  public clearTimeout(id: unknown): void {
    this.pending.delete(id as number);
  }

  public fireOnly(): void {
    expect(this.pending.size).toBe(1);
    const [id, callback] = [...this.pending.entries()][0]!;
    this.pending.delete(id);
    callback();
  }
}

interface FakeWindow extends DisplayConfigBrowserWindowAdapter {
  readonly options: Record<string, unknown>;
  loadedUrl?: string;
  closed: boolean;
  emitClosed(): void;
}

function createWindowHarness(
  session: DisplayConfigSessionAdapter,
  harnessOptions: {
    hangIdentifyLoads?: boolean;
    failIdentifyNavigation?: boolean;
  } = {},
) {
  const windows: FakeWindow[] = [];
  const BrowserWindow = class implements FakeWindow {
    public readonly webContents: FakeWindow["webContents"];
    public loadedUrl?: string;
    public closed = false;
    private rejectLoad?: (error: Error) => void;
    private readonly closedListeners = new Set<() => void>();
    private readonly navigationListeners = new Set<
      (event: { preventDefault(): void }, targetUrl: string) => void
    >();

    public constructor(public readonly options: Record<string, unknown>) {
      this.webContents = {
        session,
        on: (_event, listener) => this.navigationListeners.add(listener),
        removeListener: (_event, listener) =>
          this.navigationListeners.delete(listener),
        setWindowOpenHandler: () => {
          const webPreferences = this.options.webPreferences as Record<
            string,
            unknown
          >;
          if (
            harnessOptions.failIdentifyNavigation === true &&
            !("preload" in webPreferences)
          ) {
            throw new Error("identify navigation guard failed");
          }
        },
      };
      windows.push(this);
    }

    public async loadURL(url: string): Promise<void> {
      this.loadedUrl = url;
      const webPreferences = this.options.webPreferences as Record<
        string,
        unknown
      >;
      if (
        harnessOptions.hangIdentifyLoads === true &&
        !("preload" in webPreferences)
      ) {
        await new Promise<void>((_resolve, reject) => {
          this.rejectLoad = reject;
        });
      }
    }

    public on(_event: "closed", listener: () => void): this {
      this.closedListeners.add(listener);
      return this;
    }

    public once(_event: "closed", listener: () => void): this {
      const wrapped = (): void => {
        this.closedListeners.delete(wrapped);
        listener();
      };
      this.closedListeners.add(wrapped);
      return this;
    }

    public removeListener(_event: "closed", listener: () => void): this {
      this.closedListeners.delete(listener);
      return this;
    }

    public close(): void {
      this.emitClosed();
    }

    public destroy(): void {
      this.emitClosed();
    }

    public isDestroyed(): boolean {
      return this.closed;
    }

    public emitClosed(): void {
      if (this.closed) return;
      this.closed = true;
      this.rejectLoad?.(new Error("window closed during load"));
      this.rejectLoad = undefined;
      for (const listener of [...this.closedListeners]) listener();
      this.closedListeners.clear();
    }
  } as unknown as DisplayConfigBrowserWindowConstructor;
  return { windows, BrowserWindow };
}

function createRuntimeHarness(
  initialDisplays: readonly unknown[] = RAW_DISPLAYS,
  options: {
    hangIdentifyLoads?: boolean;
    failIdentifyNavigation?: boolean;
  } = {},
) {
  const webRequestCalls: Array<unknown> = [];
  const session: DisplayConfigSessionAdapter = {
    webRequest: {
      onBeforeRequest: (filter) => webRequestCalls.push(filter),
    },
  };
  const windowHarness = createWindowHarness(
    session,
    options,
  );
  const ipcMain = new FakeIpcMain();
  const timers = new FakeTimers();
  const atomicFileSystem = new MemoryAtomicFileSystem();
  let displays = [...initialDisplays];
  let screenReads = 0;
  let prepareTargetCalls = 0;
  const evidence = new Set<string>();
  const partitions: string[] = [];

  const host: DisplayConfiguratorHost = {
    repositoryRoot,
    BrowserWindow: windowHarness.BrowserWindow,
    ipcMain,
    screen: {
      getAllDisplays: () => {
        screenReads += 1;
        return displays;
      },
    },
    fromPartition: (partition) => {
      partitions.push(partition);
      return session;
    },
    readFile: (path) => {
      if (!path.endsWith("display-layout.json")) {
        throw new Error(`unexpected read: ${path}`);
      }
      return readFileSync(join(repositoryRoot, "show", "display-layout.json"));
    },
    pathExists: (path) => evidence.has(path),
    prepareTarget: () => {
      prepareTargetCalls += 1;
    },
    atomicFileSystem,
    randomSuffix: () => "fixture",
    nowUtc: () => "2026-09-04T01:02:03.004Z",
    timers,
  };

  return {
    host,
    ipcMain,
    timers,
    atomicFileSystem,
    windows: windowHarness.windows,
    partitions,
    webRequestCalls,
    evidence,
    get screenReads() {
      return screenReads;
    },
    get prepareTargetCalls() {
      return prepareTargetCalls;
    },
    setDisplays(next: readonly unknown[]) {
      displays = [...next];
    },
  };
}

function mainEvent(window: FakeWindow): DisplayConfigIpcEvent {
  if (window.loadedUrl === undefined) throw new Error("main URL missing");
  return {
    sender: window.webContents,
    senderFrame: { url: window.loadedUrl },
  };
}

async function startHarness(harness: ReturnType<typeof createRuntimeHarness>) {
  const pending = runDisplayConfigurator(command, harness.host);
  await Promise.resolve();
  await Promise.resolve();
  const mainWindow = harness.windows[0];
  if (mainWindow === undefined) throw new Error("main window missing");
  return { pending, mainWindow, event: mainEvent(mainWindow) };
}

function productionRequest(topologySha256 = SNAPSHOT_TOKEN) {
  return {
    topologySha256,
    mode: "production-3" as const,
    bindings: [
      { softId: "SCREEN-1" as const, displayId: "A" },
      { softId: "SCREEN-2" as const, displayId: "B" },
      { softId: "SCREEN-3" as const, displayId: "C" },
    ],
  };
}

describe("display topology snapshot and map publication", () => {
  it("rejects a reparse point in any existing target ancestor", () => {
    const inspected: string[] = [];
    const reparseAncestor = "D:\\VirtualData";

    expect(() =>
      assertNoDisplayConfigReparseTraversal(
        "D:\\VirtualData\\JanVim-Exhibition-Rehearsals\\g4-config\\display-map.json",
        (path) => {
          inspected.push(path);
          return {
            exists: true,
            reparsePoint: path.toLowerCase() === reparseAncestor.toLowerCase(),
          };
        },
      ),
    ).toThrow(/reparse/i);
    expect(inspected).toContain(reparseAncestor);
    expect(inspected).toContain(
      "D:\\VirtualData\\JanVim-Exhibition-Rehearsals\\g4-config\\display-map.json",
    );
  });

  it("sorts and numbers by top, left, then ID without assigning a role", () => {
    const snapshot = captureConfigurationSnapshot([
      rawDisplay("C", "C projector", 3840, 1, 180),
      rawDisplay("A", "A projector", 0),
      rawDisplay("B", "B projector", 1920, 1.25, 90),
    ]);

    expect(snapshot.topologySha256).toBe(SNAPSHOT_TOKEN);
    expect(snapshot.displays.map(({ number, displayId }) => ({ number, displayId }))).toEqual([
      { number: 1, displayId: "A" },
      { number: 2, displayId: "B" },
      { number: 3, displayId: "C" },
    ]);
    expect(snapshot.displays.every((entry) => !("softId" in entry))).toBe(true);
    expect(snapshot.allowedModes).toEqual(["production-3"]);
    expect(Object.isFrozen(snapshot.displays[0]?.bounds)).toBe(true);
  });

  it("allows preview only at one display and bounds topology and labels", () => {
    expect(
      captureConfigurationSnapshot([rawDisplay("solo", "Only display", 0)])
        .allowedModes,
    ).toEqual(["single-display-preview"]);
    expect(
      captureConfigurationSnapshot([
        rawDisplay("A", "A", 0),
        rawDisplay("B", "B", 1920),
      ]).allowedModes,
    ).toEqual([]);
    expect(() =>
      captureConfigurationSnapshot(
        Array.from({ length: 17 }, (_, index) =>
          rawDisplay(String(index), String(index), index * 100),
        ),
      ),
    ).toThrow(/16 displays/i);
    expect(() =>
      captureConfigurationSnapshot([
        rawDisplay("A", "界".repeat(171), 0),
      ]),
    ).toThrow(/512 UTF-8 bytes/i);
  });

  it("builds a strict schema-2 map using Task 1 hashes and role order", () => {
    const layout = parseDisplayLayout(
      readFileSync(join(repositoryRoot, "show", "display-layout.json")),
    );
    const snapshot = captureConfigurationSnapshot(RAW_DISPLAYS);
    const bytes = buildDisplayMapBytes(
      layout,
      snapshot,
      productionRequest(snapshot.topologySha256),
      "2026-09-04T01:02:03.004Z",
    );
    const map = parseDisplayMap(bytes);

    expect(bytes.at(-1)).toBe(10);
    expect(map).toMatchObject({
      schema: 2,
      mappingStatus: "confirmed",
      mode: "production-3",
      layoutSha256: layout.layoutSha256,
      capturedAtUtc: "2026-09-04T01:02:03.004Z",
      bindings: [
        { softId: "SCREEN-1", displayId: "A", label: "A projector" },
        { softId: "SCREEN-2", displayId: "B", label: "B projector" },
        { softId: "SCREEN-3", displayId: "C", label: "C projector" },
      ],
      unassignedDisplays: [],
    });

    expect(() =>
      buildDisplayMapBytes(
        layout,
        snapshot,
        { ...productionRequest(), bindings: productionRequest().bindings.slice(0, 2) },
        "2026-09-04T01:02:03.004Z",
      ),
    ).toThrow(/bindings|roles/i);
  });

  it("keeps the exclusive temp open through synchronous validation and rename", async () => {
    const fileSystem = new MemoryAtomicFileSystem();
    fileSystem.files.set(displayMapPath, Buffer.from("old map\n"));
    const layout = parseDisplayLayout(
      readFileSync(join(repositoryRoot, "show", "display-layout.json")),
    );
    const bytes = buildDisplayMapBytes(
      layout,
      captureConfigurationSnapshot(RAW_DISPLAYS),
      productionRequest(),
      "2026-09-04T01:02:03.004Z",
    );
    const beforeCommit: string[] = [];

    const result = writeDisplayMapAtomic(
      displayMapPath,
      bytes,
      () => {
        beforeCommit.push("checked");
        fileSystem.calls.push("precommit");
      },
      fileSystem,
      "fixture",
    );

    expect(result).toBeUndefined();
    expect(beforeCommit).toEqual(["checked"]);
    expect(fileSystem.calls).toEqual([
      `open:wx:${rehearsalRoot}\\.display-map-fixture.tmp`,
      "write",
      "flush",
      "inspect-descriptor",
      "precommit",
      "inspect-descriptor",
      "inspect-path",
      "read-descriptor",
      `rename:${rehearsalRoot}\\.display-map-fixture.tmp:${displayMapPath}`,
      "close",
    ]);
    expect(parseDisplayMap(fileSystem.files.get(displayMapPath)!)).toBeTruthy();

    fileSystem.files.set(displayMapPath, Buffer.from("known good old map\n"));
    fileSystem.failRename = true;
    const renameError = await captureError(() =>
      writeDisplayMapAtomic(
        displayMapPath,
        bytes,
        () => undefined,
        fileSystem,
        "second",
      ),
    );
    expect(String(renameError)).toMatch(/rename failed/i);
    expect(fileSystem.files.get(displayMapPath)?.toString("utf8")).toBe(
      "known good old map\n",
    );
    expect(
      [...fileSystem.files.keys()].some((path) => path.endsWith(".tmp")),
    ).toBe(false);
  });

  it.each([
    {
      name: "path substitution",
      mutate: (fileSystem: MemoryAtomicFileSystem, bytes: Buffer) =>
        fileSystem.substituteTemporary(bytes),
    },
    {
      name: "reparse substitution",
      mutate: (fileSystem: MemoryAtomicFileSystem) =>
        fileSystem.markTemporaryReparse(),
    },
    {
      name: "descriptor byte change",
      mutate: (fileSystem: MemoryAtomicFileSystem) =>
        fileSystem.mutateTemporaryBytes(Buffer.from("changed\n")),
    },
  ])("rejects temporary $name without replacing the old map", async ({ mutate }) => {
    const fileSystem = new MemoryAtomicFileSystem();
    fileSystem.files.set(displayMapPath, Buffer.from("known good old map\n"));
    const layout = parseDisplayLayout(
      readFileSync(join(repositoryRoot, "show", "display-layout.json")),
    );
    const bytes = buildDisplayMapBytes(
      layout,
      captureConfigurationSnapshot(RAW_DISPLAYS),
      productionRequest(),
      "2026-09-04T01:02:03.004Z",
    );

    const error = await captureError(() =>
      writeDisplayMapAtomic(
        displayMapPath,
        bytes,
        () => mutate(fileSystem, bytes),
        fileSystem,
        "tamper",
      ),
    );

    expect(String(error)).toMatch(/temporary|identity|reparse|bytes/i);
    expect(fileSystem.files.get(displayMapPath)?.toString("utf8")).toBe(
      "known good old map\n",
    );
    expect(
      [...fileSystem.files.keys()].some((path) => path.endsWith(".tmp")),
    ).toBe(false);
  });

  it("rejects an accidentally asynchronous precommit callback", async () => {
    const fileSystem = new MemoryAtomicFileSystem();
    fileSystem.files.set(displayMapPath, Buffer.from("known good old map\n"));
    const layout = parseDisplayLayout(
      readFileSync(join(repositoryRoot, "show", "display-layout.json")),
    );
    const bytes = buildDisplayMapBytes(
      layout,
      captureConfigurationSnapshot(RAW_DISPLAYS),
      productionRequest(),
      "2026-09-04T01:02:03.004Z",
    );
    const asynchronous = (() => Promise.resolve()) as unknown as () => void;

    const error = await captureError(() =>
      writeDisplayMapAtomic(
        displayMapPath,
        bytes,
        asynchronous,
        fileSystem,
        "async-precommit",
      ),
    );

    expect(String(error)).toMatch(/precommit.*synchronous/i);
    expect(fileSystem.files.get(displayMapPath)?.toString("utf8")).toBe(
      "known good old map\n",
    );
    expect(
      [...fileSystem.files.keys()].some((path) => path.endsWith(".tmp")),
    ).toBe(false);
  });

  it("atomically replaces an existing map through the real Windows filesystem", async () => {
    const directory = mkdtempSync(join(tmpdir(), "janvim-g4-map-atomic-"));
    const target = join(directory, "display-map.json");
    try {
      writeFileSync(target, "old map\n", "utf8");
      const layout = parseDisplayLayout(
        readFileSync(join(repositoryRoot, "show", "display-layout.json")),
      );
      const bytes = buildDisplayMapBytes(
        layout,
        captureConfigurationSnapshot(RAW_DISPLAYS),
        productionRequest(),
        "2026-09-04T01:02:03.004Z",
      );

      await writeDisplayMapAtomic(
        target,
        bytes,
        () => undefined,
        undefined,
        "real-windows",
      );

      expect(parseDisplayMap(readFileSync(target))).toMatchObject({
        schema: 2,
        mode: "production-3",
      });
      expect(readdirSync(directory)).toEqual(["display-map.json"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("least-privilege display configurator runtime", () => {
  it("removes the session guard when main-window construction fails", async () => {
    const harness = createRuntimeHarness();
    const FailingBrowserWindow = class {
      public constructor() {
        throw new Error("window construction failed");
      }
    } as unknown as DisplayConfigBrowserWindowConstructor;

    await expect(
      runDisplayConfigurator(command, {
        ...harness.host,
        BrowserWindow: FailingBrowserWindow,
      }),
    ).rejects.toThrow(/window construction failed/i);
    expect(harness.webRequestCalls).toEqual([
      { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
      null,
    ]);
  });

  it("cleans only its own resources when IPC registration fails", async () => {
    const harness = createRuntimeHarness();
    const existing = async (): Promise<unknown> => ({ existing: true });
    harness.ipcMain.handlers.set(IDENTIFY_CHANNEL, existing);

    await expect(
      runDisplayConfigurator(command, harness.host),
    ).rejects.toThrow(/duplicate handler/i);

    expect(harness.ipcMain.handlers).toEqual(
      new Map([[IDENTIFY_CHANNEL, existing]]),
    );
    expect(harness.windows).toHaveLength(1);
    expect(harness.windows[0]?.closed).toBe(true);
    expect(harness.webRequestCalls).toEqual([
      { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
      null,
    ]);
  });

  it("uses one non-persistent session and waits for the main window to close", async () => {
    const harness = createRuntimeHarness();
    const { pending, mainWindow } = await startHarness(harness);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(harness.partitions).toHaveLength(1);
    expect(harness.partitions[0]).not.toMatch(/^persist:/);
    expect(harness.webRequestCalls).toHaveLength(1);
    expect(harness.ipcMain.handlers.size).toBe(4);

    mainWindow.emitClosed();
    await expect(pending).resolves.toBe(0);
    expect(harness.ipcMain.handlers.size).toBe(0);
    expect(harness.webRequestCalls).toEqual([
      { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
      null,
    ]);
  });

  it("rejects every IPC from the wrong sender, URL, or malformed payload", async () => {
    const harness = createRuntimeHarness();
    const { pending, mainWindow, event } = await startHarness(harness);

    expect(new URL(mainWindow.loadedUrl!).searchParams.get("topologySha256")).toBe(
      SNAPSHOT_TOKEN,
    );

    await expect(
      harness.ipcMain.invoke(
        SNAPSHOT_CHANNEL,
        { ...event, sender: {} },
        { topologySha256: SNAPSHOT_TOKEN },
      ),
    ).rejects.toThrow(/unauthorized/i);
    await expect(
      harness.ipcMain.invoke(
        SNAPSHOT_CHANNEL,
        { ...event, senderFrame: { url: "file:///wrong.html" } },
        { topologySha256: SNAPSHOT_TOKEN },
      ),
    ).rejects.toThrow(/unauthorized/i);
    await expect(
      harness.ipcMain.invoke(SNAPSHOT_CHANNEL, event, { schema: 1 }),
    ).rejects.toThrow(/snapshot request/i);
    await expect(
      harness.ipcMain.invoke(SNAPSHOT_CHANNEL, event, {
        topologySha256: "f".repeat(64),
      }),
    ).rejects.toThrow(/topology changed/i);
    await expect(
      harness.ipcMain.invoke(SNAPSHOT_CHANNEL, event, {
        topologySha256: SNAPSHOT_TOKEN,
      }),
    ).resolves.toMatchObject({ topologySha256: SNAPSHOT_TOKEN });
    await expect(
      harness.ipcMain.invoke(IDENTIFY_CHANNEL, event, {
        topologySha256: "bad",
      }),
    ).rejects.toThrow(/identify request/i);
    await expect(
      harness.ipcMain.invoke(CLOSE_IDENTIFY_CHANNEL, event, {}),
    ).rejects.toThrow(/close-identify request/i);
    await expect(
      harness.ipcMain.invoke(SAVE_DISPLAY_MAP_CHANNEL, event, {
        ...productionRequest(),
        automatic: true,
      }),
    ).rejects.toThrow(/save request/i);

    mainWindow.emitClosed();
    await pending;
  });

  it("replaces identify cards, shares one session, and reuses one 12-second timer", async () => {
    const harness = createRuntimeHarness();
    const { pending, mainWindow, event } = await startHarness(harness);
    const snapshot = (await harness.ipcMain.invoke(
      SNAPSHOT_CHANNEL,
      event,
      { topologySha256: SNAPSHOT_TOKEN },
    )) as { topologySha256: string };

    await harness.ipcMain.invoke(IDENTIFY_CHANNEL, event, {
      topologySha256: snapshot.topologySha256,
    });
    const firstCards = harness.windows.slice(1);
    expect(firstCards).toHaveLength(3);
    expect(harness.timers.delays).toEqual([12_000]);
    expect(harness.timers.pending.size).toBe(1);
    for (const [index, card] of firstCards.entries()) {
      const webPreferences = card.options.webPreferences as Record<string, unknown>;
      expect(webPreferences.session).toBe(
        (mainWindow.options.webPreferences as Record<string, unknown>).session,
      );
      expect(webPreferences).not.toHaveProperty("preload");
      expect(card.loadedUrl).toContain(`number=${index + 1}`);
    }

    await harness.ipcMain.invoke(IDENTIFY_CHANNEL, event, {
      topologySha256: snapshot.topologySha256,
    });
    expect(firstCards.every((window) => window.closed)).toBe(true);
    expect(harness.timers.delays).toEqual([12_000, 12_000]);
    expect(harness.timers.pending.size).toBe(1);

    harness.timers.fireOnly();
    expect(harness.windows.slice(4).every((window) => window.closed)).toBe(true);
    mainWindow.emitClosed();
    await pending;
  });

  it("rejects overlapping identify requests and permits a later settled request", async () => {
    const windowOptions = { hangIdentifyLoads: true };
    const harness = createRuntimeHarness(RAW_DISPLAYS, windowOptions);
    const { pending, mainWindow, event } = await startHarness(harness);
    const first = harness.ipcMain.invoke(IDENTIFY_CHANNEL, event, {
      topologySha256: SNAPSHOT_TOKEN,
    });
    await Promise.resolve();
    const second = harness.ipcMain.invoke(IDENTIFY_CHANNEL, event, {
      topologySha256: SNAPSHOT_TOKEN,
    });

    try {
      await Promise.resolve();
      expect(harness.windows).toHaveLength(2);
      expect(harness.windows[1]?.closed).toBe(false);
      await expect(second).rejects.toThrow(/identify.*in progress/i);

      windowOptions.hangIdentifyLoads = false;
      harness.timers.fireOnly();
      await expect(first).rejects.toThrow(/closed during load/i);
      await expect(
        harness.ipcMain.invoke(IDENTIFY_CHANNEL, event, {
          topologySha256: SNAPSHOT_TOKEN,
        }),
      ).resolves.toEqual({ closedAfterMs: 12_000 });
      expect(harness.windows.slice(-3).every((window) => !window.closed)).toBe(
        true,
      );
      expect(harness.timers.pending.size).toBe(1);
    } finally {
      windowOptions.hangIdentifyLoads = false;
      if (harness.timers.pending.size === 1) harness.timers.fireOnly();
      mainWindow.emitClosed();
      await Promise.allSettled([pending, first, second]);
    }
  });

  it("rechecks the live topology token before closing identify cards", async () => {
    const harness = createRuntimeHarness();
    const { pending, mainWindow, event } = await startHarness(harness);
    const snapshot = (await harness.ipcMain.invoke(
      SNAPSHOT_CHANNEL,
      event,
      { topologySha256: SNAPSHOT_TOKEN },
    )) as { topologySha256: string };
    await harness.ipcMain.invoke(IDENTIFY_CHANNEL, event, {
      topologySha256: snapshot.topologySha256,
    });
    const cards = harness.windows.slice(1);

    harness.setDisplays([
      RAW_DISPLAYS[0],
      { ...RAW_DISPLAYS[1], scaleFactor: 1.5 },
      RAW_DISPLAYS[2],
    ]);
    await expect(
      harness.ipcMain.invoke(CLOSE_IDENTIFY_CHANNEL, event, {
        topologySha256: snapshot.topologySha256,
      }),
    ).rejects.toThrow(/topology changed/i);
    expect(cards.every((window) => !window.closed)).toBe(true);

    harness.timers.fireOnly();
    mainWindow.emitClosed();
    await pending;
  });

  it("validates a snapshot refresh before closing the active identify generation", async () => {
    const harness = createRuntimeHarness();
    const { pending, mainWindow, event } = await startHarness(harness);
    await harness.ipcMain.invoke(IDENTIFY_CHANNEL, event, {
      topologySha256: SNAPSHOT_TOKEN,
    });
    const cards = harness.windows.slice(1);

    harness.setDisplays([
      RAW_DISPLAYS[0],
      { ...RAW_DISPLAYS[1], scaleFactor: 1.5 },
      RAW_DISPLAYS[2],
    ]);
    await expect(
      harness.ipcMain.invoke(SNAPSHOT_CHANNEL, event, {
        topologySha256: SNAPSHOT_TOKEN,
      }),
    ).rejects.toThrow(/topology changed/i);
    expect(cards.every((window) => !window.closed)).toBe(true);
    expect(harness.timers.pending.size).toBe(1);

    harness.timers.fireOnly();
    mainWindow.emitClosed();
    await pending;
  });

  it("starts the 12-second bound before any identify page can hang", async () => {
    const harness = createRuntimeHarness(RAW_DISPLAYS, {
      hangIdentifyLoads: true,
    });
    const { pending, mainWindow, event } = await startHarness(harness);
    const snapshot = (await harness.ipcMain.invoke(
      SNAPSHOT_CHANNEL,
      event,
      { topologySha256: SNAPSHOT_TOKEN },
    )) as { topologySha256: string };
    const identifyPending = harness.ipcMain.invoke(IDENTIFY_CHANNEL, event, {
      topologySha256: snapshot.topologySha256,
    });

    try {
      await Promise.resolve();
      expect(harness.timers.pending.size).toBe(1);
      harness.timers.fireOnly();
      await expect(identifyPending).rejects.toThrow(/closed during load/i);
    } finally {
      mainWindow.emitClosed();
      await pending;
      await identifyPending.catch(() => undefined);
    }
  });

  it("destroys an identify window when its navigation guard cannot install", async () => {
    const harness = createRuntimeHarness(RAW_DISPLAYS, {
      failIdentifyNavigation: true,
    });
    const { pending, mainWindow, event } = await startHarness(harness);
    const snapshot = (await harness.ipcMain.invoke(
      SNAPSHOT_CHANNEL,
      event,
      { topologySha256: SNAPSHOT_TOKEN },
    )) as { topologySha256: string };

    await expect(
      harness.ipcMain.invoke(IDENTIFY_CHANNEL, event, {
        topologySha256: snapshot.topologySha256,
      }),
    ).rejects.toThrow(/identify navigation guard failed/i);
    expect(harness.windows).toHaveLength(2);
    expect(harness.windows[1]?.closed).toBe(true);
    expect(harness.timers.pending.size).toBe(0);

    mainWindow.emitClosed();
    await pending;
  });

  it("re-samples before save and before commit, rejecting stale topology without replacing a map", async () => {
    const harness = createRuntimeHarness();
    harness.atomicFileSystem.files.set(displayMapPath, Buffer.from("old map\n"));
    const { pending, mainWindow, event } = await startHarness(harness);
    const snapshot = (await harness.ipcMain.invoke(
      SNAPSHOT_CHANNEL,
      event,
      { topologySha256: SNAPSHOT_TOKEN },
    )) as { topologySha256: string };

    harness.setDisplays([
      RAW_DISPLAYS[0],
      { ...RAW_DISPLAYS[1], scaleFactor: 1.5 },
      RAW_DISPLAYS[2],
    ]);
    await expect(
      harness.ipcMain.invoke(
        SAVE_DISPLAY_MAP_CHANNEL,
        event,
        productionRequest(snapshot.topologySha256),
      ),
    ).rejects.toThrow(/topology changed/i);
    expect(harness.atomicFileSystem.files.get(displayMapPath)?.toString()).toBe(
      "old map\n",
    );

    harness.setDisplays(RAW_DISPLAYS);
    const fresh = (await harness.ipcMain.invoke(
      SNAPSHOT_CHANNEL,
      event,
      { topologySha256: SNAPSHOT_TOKEN },
    )) as { topologySha256: string };
    await harness.ipcMain.invoke(
      SAVE_DISPLAY_MAP_CHANNEL,
      event,
      productionRequest(fresh.topologySha256),
    );
    expect(harness.screenReads).toBeGreaterThanOrEqual(5);
    expect(harness.prepareTargetCalls).toBe(3);
    expect(
      parseDisplayMap(harness.atomicFileSystem.files.get(displayMapPath)!),
    ).toMatchObject({ mode: "production-3" });

    mainWindow.emitClosed();
    await pending;
  });

  it.each([
    "controller-terminal.json",
    "run-lease.json",
    "controller-incident.json",
    "show-run.json",
    "watchdog-attempts.jsonl",
  ])("refuses publication when %s exists", async (name) => {
    const harness = createRuntimeHarness();
    harness.atomicFileSystem.files.set(displayMapPath, Buffer.from("old map\n"));
    harness.evidence.add(win32.join(rehearsalRoot, name));
    const { pending, mainWindow, event } = await startHarness(harness);
    const snapshot = (await harness.ipcMain.invoke(
      SNAPSHOT_CHANNEL,
      event,
      { topologySha256: SNAPSHOT_TOKEN },
    )) as { topologySha256: string };

    await expect(
      harness.ipcMain.invoke(
        SAVE_DISPLAY_MAP_CHANNEL,
        event,
        productionRequest(snapshot.topologySha256),
      ),
    ).rejects.toThrow(/show state|evidence/i);
    expect(harness.atomicFileSystem.files.get(displayMapPath)?.toString()).toBe(
      "old map\n",
    );

    mainWindow.emitClosed();
    await pending;
  });
});
