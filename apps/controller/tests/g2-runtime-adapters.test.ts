import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join, win32 } from "node:path";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import type { AgentAck, AgentCommand } from "@janvim-exhibition/show-schema";

import type { LogStorage } from "../src/bounded-log.ts";
import type { RuntimeDisplay } from "../src/display-router.ts";
import type { G2Command } from "../src/g2-command.ts";
import type { G2EvidenceFinalization } from "../src/runtime-composition.ts";
import {
  createG2RuntimeDependencies,
  type G2RuntimeAdapterHost,
} from "../src/g2-runtime-adapters.ts";

const repositoryFixtureRoot = process.cwd();
const lockText = readFileSync(
  join(repositoryFixtureRoot, "janvim-artifact.lock.json"),
  "utf8",
);
const showConfig = readFileSync(
  join(repositoryFixtureRoot, "show", "janvim-show.toml"),
);
const manifestText = readFileSync(
  join(repositoryFixtureRoot, "content", "fixture", "show.manifest.json"),
);
const poemText = readFileSync(
  join(repositoryFixtureRoot, "content", "fixture", "poem.txt"),
);
const janVimCore = readFileSync(
  join(repositoryFixtureRoot, "runtime", "janvim", "janvim-core.exe"),
);

const confirmedMap = {
  schema: 1,
  mappingStatus: "confirmed",
  expectedDisplayCount: 2,
  primary: {
    displayId: "111",
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    scaleFactor: 1,
    geometrySha256:
      "b2bc82d7bea454184acfb21ae9139e97c32aefb994443034423653e85f9c83cc",
  },
  secondary: {
    displayId: "222",
    bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
    scaleFactor: 1,
    geometrySha256:
      "2ebac5faac6c5f34562d1e91088736c9e70943c9c42846616a418db904319928",
  },
} as const;

const secondaryDisplay: RuntimeDisplay = {
  displayId: 222,
  bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
  scaleFactor: 1,
};

class MemoryLogStorage implements LogStorage {
  public readonly files = new Map<string, string>();

  public append(path: string, text: string): void {
    this.files.set(path, (this.files.get(path) ?? "") + text);
  }

  public size(path: string): number {
    return Buffer.byteLength(this.files.get(path) ?? "", "utf8");
  }

  public exists(path: string): boolean {
    return this.files.has(path);
  }

  public rename(from: string, to: string): void {
    const value = this.files.get(from);
    if (value === undefined) return;
    this.files.set(to, value);
    this.files.delete(from);
  }

  public remove(path: string): void {
    this.files.delete(path);
  }
}

class FakeChild extends EventEmitter {
  public readonly pid = 4242;
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public readonly kill = vi.fn(() => true);
}

function createAdapterHarness(
  calls: string[],
  options: { verifyExitCode?: number } = {},
) {
  const repositoryRoot = "D:\\show";
  const rehearsalRoot = "D:\\rehearsal";
  const displayMapPath = `${rehearsalRoot}\\display-map.json`;
  const command: Extract<G2Command, { mode: "Run" }> = {
    mode: "Run",
    rehearsalRoot,
    displayMapPath,
    runId: "rehearsal",
  };
  const baseEnvironment: NodeJS.ProcessEnv = {
    PATH: "C:\\Windows\\System32",
    USERPROFILE: "C:\\Users\\operator",
  };
  const files = new Map<string, Buffer>([
    [win32.join(repositoryRoot, "janvim-artifact.lock.json"), Buffer.from(lockText)],
    [win32.join(repositoryRoot, "show", "janvim-show.toml"), showConfig],
    [win32.join(repositoryRoot, "content", "fixture", "show.manifest.json"), manifestText],
    [win32.join(repositoryRoot, "content", "fixture", "poem.txt"), poemText],
    [
      win32.join(repositoryRoot, "runtime", "janvim", "janvim-core.exe"),
      Buffer.from(janVimCore),
    ],
    [displayMapPath, Buffer.from(`${JSON.stringify(confirmedMap)}\n`, "utf8")],
  ]);
  const logStorage = new MemoryLogStorage();
  const outputFiles = new Map<string, Buffer>();
  const child = new FakeChild();
  const bridgeToken = "ab".repeat(24);
  const readPaths: string[] = [];
  let spawnCall:
    | {
        file: string;
        args: readonly string[];
        options: {
          cwd: string;
          env: NodeJS.ProcessEnv;
          shell: false;
          windowsHide: false;
          stdio: "pipe";
        };
      }
    | undefined;
  let verifyInvocation:
    | { timeoutMs: number; maxStdoutBytes: number; maxStderrBytes: number }
    | undefined;
  let placementInvocation:
    | { pid: number; bounds: { x: number; y: number; width: number; height: number } }
    | undefined;
  let loadedUrl = "";
  let secondaryLoadDeadlineMs = 0;
  let bridgeListenDeadlineMs = 0;
  let navigationGuardInstalled = false;
  let requestFilter: { urls: string[] } = { urls: [] };
  let beforeRequest:
    | ((details: { url: string }, callback: (result: { cancel: boolean }) => void) => void)
    | undefined;
  let navigationListener:
    | ((event: { preventDefault(): void }, targetUrl: string) => void)
    | undefined;
  let windowOpenHandler:
    | ((details: { url: string }) => { action: "deny" })
    | undefined;
  let evidenceRecord: unknown;
  const sentRendererEvents: Array<{ channel: string; payload: unknown }> = [];

  class FakeWebContents extends EventEmitter {
    public readonly session = {
      webRequest: {
        onBeforeRequest: (
          filter: { urls: string[] } | null,
          listener?: (
            details: { url: string },
            callback: (result: { cancel: boolean }) => void,
          ) => void,
        ) => {
          if (filter === null) {
            beforeRequest = undefined;
            return;
          }
          requestFilter = filter;
          beforeRequest = listener;
        },
      },
    };
    public readonly send = vi.fn((channel: string, payload: unknown) => {
      sentRendererEvents.push({ channel, payload });
    });
    public readonly setWindowOpenHandler = vi.fn(
      (handler: (details: { url: string }) => { action: "deny" }) => {
        windowOpenHandler = handler;
      },
    );

    public override on(eventName: string | symbol, listener: (...args: never[]) => void): this {
      if (eventName === "will-navigate") {
        navigationGuardInstalled = true;
        navigationListener = listener as unknown as typeof navigationListener;
      }
      return super.on(eventName, listener);
    }
  }

  class FakeBrowserWindow extends EventEmitter {
    public readonly webContents = new FakeWebContents();
    private destroyed = false;

    public constructor(public readonly options: unknown) {
      super();
    }

    public async loadURL(url: string): Promise<void> {
      loadedUrl = url;
    }

    public close(): void {
      this.destroyed = true;
      this.emit("closed");
    }

    public destroy(): void {
      this.destroyed = true;
      this.emit("closed");
    }

    public isDestroyed(): boolean {
      return this.destroyed;
    }
  }

  const host = {
    repositoryRoot,
    BrowserWindow: FakeBrowserWindow,
    ipcMain: {
      on: vi.fn(),
      removeListener: vi.fn(),
    },
    screen: {
      getAllDisplays: () => [
        {
          displayId: 111,
          bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          scaleFactor: 1,
        },
        secondaryDisplay,
      ],
    },
    baseEnvironment,
    readFile: (path: string) => {
      const resolvedPath = win32.resolve(path);
      readPaths.push(resolvedPath);
      const value = files.get(resolvedPath);
      if (value === undefined) throw new Error(`missing fake file: ${path}`);
      return Buffer.from(value);
    },
    execFile: async (
      _file: string,
      args: readonly string[],
      limits: {
        timeoutMs: number;
        maxStdoutBytes: number;
        maxStderrBytes: number;
      },
    ) => {
      if (args.some((argument) => argument.endsWith("verify-runtime.ps1"))) {
        calls.push("verify-runtime");
        verifyInvocation = limits;
        return {
          exitCode: options.verifyExitCode ?? 0,
          stdout: "verified\n",
          stderr: options.verifyExitCode === 1 ? "verification failed" : "",
        };
      }
      const valueAfter = (flag: string): number => {
        const index = args.indexOf(flag);
        return Number(args[index + 1]);
      };
      placementInvocation = {
        pid: valueAfter("-ChildProcessId"),
        bounds: {
          x: valueAfter("-X"),
          y: valueAfter("-Y"),
          width: valueAfter("-Width"),
          height: valueAfter("-Height"),
        },
      };
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          schema: 1,
          pid: placementInvocation.pid,
          matchedWindowCount: 1,
          hwnd: "0x0000000000001092",
          visible: true,
          owned: false,
          requested: placementInvocation.bounds,
          actual: placementInvocation.bounds,
        }),
        stderr: "",
      };
    },
    spawn: (
      file: string,
      args: readonly string[],
      spawnOptions: {
        cwd: string;
        env: NodeJS.ProcessEnv;
        shell: false;
        windowsHide: false;
        stdio: "pipe";
      },
    ) => {
      spawnCall = { file, args, options: spawnOptions };
      return child;
    },
    verifyArtifact: async () => ({ ok: true as const }),
    randomBytes: () => Buffer.from(bridgeToken, "hex"),
    createBridge: (_token: string) => ({
      listen: async () => ({ host: "127.0.0.1" as const, port: 32123, family: "IPv4" }),
      waitForAgent: async (_timeoutMs: number) => undefined,
      dispatch: async (_command: AgentCommand): Promise<AgentAck> => {
        throw new Error("fake bridge dispatch is unused");
      },
      close: async () => undefined,
    }),
    runWithDeadline: async <T>(timeoutMs: number, operation: () => Promise<T>): Promise<T> => {
      if (timeoutMs === 15_000) secondaryLoadDeadlineMs = timeoutMs;
      if (timeoutMs === 5_000) bridgeListenDeadlineMs = timeoutMs;
      return operation();
    },
    logStorage,
    ensureExclusiveFile: (path: string) => {
      if (logStorage.files.has(path)) throw new Error("file already exists");
      logStorage.files.set(path, "");
    },
    openExclusiveOutput: (path: string) => {
      if (outputFiles.has(path)) throw new Error("file already exists");
      outputFiles.set(path, Buffer.alloc(0));
      return {
        write: (chunk: Uint8Array) => {
          outputFiles.set(
            path,
            Buffer.concat([outputFiles.get(path) ?? Buffer.alloc(0), Buffer.from(chunk)]),
          );
        },
        close: vi.fn(),
      };
    },
    writeEvidence: (_path: string, value: unknown) => {
      evidenceRecord = value;
    },
    nowMonotonic: () => 0,
  } as unknown as G2RuntimeAdapterHost;
  const dependencies = createG2RuntimeDependencies(command, host);

  return {
    dependencies,
    baseEnvironment,
    secondaryDisplay,
    bridgeToken,
    get readPaths() {
      return readPaths;
    },
    get spawnCall() {
      return spawnCall;
    },
    get verifyInvocation() {
      return verifyInvocation!;
    },
    get placementInvocation() {
      return placementInvocation!;
    },
    get loadedUrl() {
      return loadedUrl;
    },
    get secondaryLoadDeadlineMs() {
      return secondaryLoadDeadlineMs;
    },
    get bridgeListenDeadlineMs() {
      return bridgeListenDeadlineMs;
    },
    get navigationGuardInstalled() {
      return navigationGuardInstalled;
    },
    get requestFilter() {
      return requestFilter;
    },
    dispatchBeforeRequest: (url: string) => {
      let result: { cancel: boolean } | undefined;
      beforeRequest?.({ url }, (value) => {
        result = value;
      });
      return result;
    },
    dispatchNavigation: (url: string) => {
      const preventDefault = vi.fn();
      navigationListener?.({ preventDefault }, url);
      return preventDefault.mock.calls.length;
    },
    dispatchWindowOpen: (url: string) => windowOpenHandler?.({ url }),
    writeChildStdout: (value: string) => {
      child.stdout.write(Buffer.from(value, "utf8"));
    },
    writeChildStderr: (value: string) => {
      child.stderr.write(Buffer.from(value, "utf8"));
    },
    closeChild: (exitCode: number | null) => {
      child.emit("close", exitCode);
    },
    log: (event: Record<string, unknown>) => dependencies.log(event),
    get logText() {
      return logStorage.files.get(`${rehearsalRoot}\\controller.ndjson`) ?? "";
    },
    get evidenceRecord() {
      return evidenceRecord;
    },
    get sentRendererEvents() {
      return sentRendererEvents;
    },
    get confirmedMapSha256() {
      return createHash("sha256")
        .update(files.get(displayMapPath)!)
        .digest("hex");
    },
    replaceDisplayMapBytes: (value: Uint8Array) => {
      files.set(displayMapPath, Buffer.from(value));
    },
    replaceRuntimeCoreBytes: (value: Uint8Array) => {
      files.set(
        win32.join(repositoryRoot, "runtime", "janvim", "janvim-core.exe"),
        Buffer.from(value),
      );
    },
  };
}

function validFinalizationSnapshot(): G2EvidenceFinalization {
  return {
    result: { ok: true },
    placement: {
      schema: 1,
      pid: 4242,
      matchedWindowCount: 1,
      hwnd: "0x0000000000001092",
      visible: true,
      owned: false,
      requested: { x: 0, y: 0, width: 1920, height: 1080 },
      actual: { x: 0, y: 0, width: 1920, height: 1080 },
    },
    completedLoops: 1,
    maxDriftMs: 7,
    resetRestoredPoem: true,
    shutdown: {
      processExitCode: 0,
      natural: true,
      reason: "frontend-shutdown-graceful",
      stdoutBytes: 4096,
      stderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
    },
  };
}

describe("real G2 runtime adapter boundaries", () => {
  it("validates bytes before opening a window or spawning JanVim", async () => {
    const calls: string[] = [];
    const adapters = createAdapterHarness(calls, { verifyExitCode: 1 });
    await expect(adapters.dependencies.validate()).resolves.toEqual({
      ok: false,
      reason: "runtime-verification-failed",
    });
    expect(calls).toEqual(["verify-runtime"]);
  });

  it("keeps the established verifier and frozen-input read order", async () => {
    const calls: string[] = [];
    const harness = createAdapterHarness(calls);

    await expect(harness.dependencies.validate()).resolves.toEqual({ ok: true });

    expect(calls).toEqual(["verify-runtime"]);
    expect(harness.readPaths).toEqual([
      "D:\\show\\janvim-artifact.lock.json",
      "D:\\show\\show\\janvim-show.toml",
      "D:\\rehearsal\\display-map.json",
      "D:\\show\\content\\fixture\\show.manifest.json",
      "D:\\show\\content\\fixture\\poem.txt",
      "D:\\show\\runtime\\janvim\\janvim-core.exe",
    ]);
    expect(janVimCore.byteLength).toBe(18_866_688);
    expect(createHash("sha256").update(janVimCore).digest("hex")).toBe(
      "224b3457d89fbc6cf946359683632f29f9262bae08b6f0d2e3043a3a7a6d83b3",
    );
  });

  it("spawns the locked executable with only show config, fixture poem, and private environment", async () => {
    const harness = createAdapterHarness([]);
    harness.baseEnvironment.MYVIMRC = "C:\\Users\\operator\\_vimrc";
    harness.baseEnvironment.VIMINIT = "source user.vim";
    harness.baseEnvironment.EXINIT = "source legacy.ex";
    harness.baseEnvironment.NVIM_APPNAME = "AstroNvim";
    harness.baseEnvironment.XDG_CONFIG_HOME = "C:\\Users\\operator\\.config";
    harness.baseEnvironment.XDG_DATA_HOME = "C:\\Users\\operator\\.local\\share";
    harness.baseEnvironment.XDG_STATE_HOME = "C:\\Users\\operator\\.local\\state";
    await expect(harness.dependencies.validate()).resolves.toEqual({ ok: true });
    const bridge = await harness.dependencies.startBridge();
    const result = await harness.dependencies.startJanVim(bridge);
    expect(result).toMatchObject({ ok: true, child: { pid: 4242 } });
    expect(harness.spawnCall).toEqual({
      file: "D:\\show\\runtime\\janvim\\janvim-core.exe",
      args: [
        "--config",
        "D:\\show\\show\\janvim-show.toml",
        "D:\\show\\content\\fixture\\poem.txt",
      ],
      options: {
        cwd: "D:\\show\\runtime\\janvim",
        env: {
          PATH: "C:\\Windows\\System32",
          USERPROFILE: "C:\\Users\\operator",
          JANVIM_USER_ROOT: "D:\\show\\runtime\\user-root",
          JANVIM_EXHIBITION_PORT: "32123",
          JANVIM_EXHIBITION_TOKEN: harness.bridgeToken,
        },
        shell: false,
        windowsHide: false,
        stdio: "pipe",
      },
    });
    for (const name of [
      "MYVIMRC",
      "VIMINIT",
      "EXINIT",
      "NVIM_APPNAME",
      "XDG_CONFIG_HOME",
      "XDG_DATA_HOME",
      "XDG_STATE_HOME",
    ]) {
      expect(harness.spawnCall.options.env).not.toHaveProperty(name);
    }
  });

  it("bounds verifier execution and opens only the guarded local renderer", async () => {
    const harness = createAdapterHarness([]);
    await harness.dependencies.validate();
    expect(harness.verifyInvocation).toMatchObject({
      timeoutMs: 30_000,
      maxStdoutBytes: 8_192,
      maxStderrBytes: 8_192,
    });
    await harness.dependencies.openSecondary(harness.secondaryDisplay);
    expect(harness.loadedUrl).toBe(
      "file:///D:/show/apps/secondary-screen/dist/index.html",
    );
    expect(harness.secondaryLoadDeadlineMs).toBe(15_000);
    expect(harness.navigationGuardInstalled).toBe(true);
    expect(harness.requestFilter.urls).toEqual([
      "http://*/*",
      "https://*/*",
      "ws://*/*",
      "wss://*/*",
    ]);
    for (const url of [
      "http://example.invalid/a",
      "https://example.invalid/a",
      "ws://example.invalid/a",
      "wss://example.invalid/a",
    ]) {
      expect(harness.dispatchBeforeRequest(url)).toEqual({ cancel: true });
      expect(harness.dispatchNavigation(url)).toBe(1);
      expect(harness.dispatchWindowOpen(url)).toEqual({ action: "deny" });
    }
    expect(
      harness.dispatchNavigation("file:///D:/show/apps/secondary-screen/dist/index.html"),
    ).toBe(0);
  });

  it("classifies the bounded child streams from the observed process output", async () => {
    const harness = createAdapterHarness([]);
    await expect(harness.dependencies.validate()).resolves.toEqual({ ok: true });
    const bridge = await harness.dependencies.startBridge();
    await expect(harness.dependencies.startJanVim(bridge)).resolves.toMatchObject({
      ok: true,
    });
    const summary = [
      "surface-ready windows=1",
      "window_exit_reason=CloseRequested",
      "neovim_exit_class=frontend_shutdown_graceful",
      "neovim_raw_status=code:0",
      "",
    ].join(" ");

    harness.writeChildStdout(summary);
    harness.closeChild(0);

    await expect(harness.dependencies.classifyShutdown(0)).resolves.toEqual({
      processExitCode: 0,
      natural: true,
      reason: "frontend-shutdown-graceful",
      stdoutBytes: Buffer.byteLength(summary, "utf8"),
      stderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
    });
  });

  it("delivers controller events on the exact channel consumed by the preload", async () => {
    const harness = createAdapterHarness([]);
    const secondary = await harness.dependencies.openSecondary(harness.secondaryDisplay);
    const ready = { schema: 1, type: "controller-status", state: "ready" } as const;

    secondary.send(ready);

    expect(harness.sentRendererEvents).toEqual([
      { channel: "janvim-exhibition:show-event", payload: ready },
    ]);
  });

  it("places the exact child and returns its validated receipt for evidence", async () => {
    const harness = createAdapterHarness([]);
    const result = await harness.dependencies.placeJanVim(4242, {
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
    expect(result).toMatchObject({
      ok: true,
      receipt: {
        pid: 4242,
        matchedWindowCount: 1,
        actual: { x: 0, y: 0, width: 1920, height: 1080 },
      },
    });
    expect(harness.placementInvocation).toEqual({
      pid: 4242,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    });
  });

  it("keeps the bridge on IPv4 loopback and redacts its token", async () => {
    const harness = createAdapterHarness([]);
    const bridge = await harness.dependencies.startBridge();
    expect(bridge.host).toBe("127.0.0.1");
    expect(harness.bridgeListenDeadlineMs).toBe(5_000);
    harness.log({ token: bridge.token, message: bridge.token });
    expect(harness.logText).not.toContain(bridge.token);
    expect(harness.logText).toContain("[REDACTED]");
  });

  it("finalizes evidence from the verified lock, confirmed map, and explicit snapshot", async () => {
    const harness = createAdapterHarness([]);
    await expect(harness.dependencies.validate()).resolves.toEqual({ ok: true });
    harness.readPaths.length = 0;
    await harness.dependencies.finalizeEvidence(validFinalizationSnapshot());
    expect(harness.readPaths).toEqual([
      "D:\\show\\janvim-artifact.lock.json",
      "D:\\rehearsal\\display-map.json",
      "D:\\show\\show\\janvim-show.toml",
      "D:\\show\\content\\fixture\\show.manifest.json",
      "D:\\show\\content\\fixture\\poem.txt",
      "D:\\show\\runtime\\janvim\\janvim-core.exe",
    ]);
    expect(harness.evidenceRecord).toMatchObject({
      schema: 1,
      acceptanceScope: "two-real-monitors-projector-simulation",
      physicalProjectorsTested: false,
      displayMap: {
        path: "D:\\rehearsal\\display-map.json",
        sha256: harness.confirmedMapSha256,
      },
      artifact: {
        tag: "v0.10.1-gmk.4",
        commit: "e95633101d93f8448b0f906e918b5d836ab95273",
        coreBytes: 18_866_688,
        coreSha256:
          "224b3457d89fbc6cf946359683632f29f9262bae08b6f0d2e3043a3a7a6d83b3",
        layoutEngine: "orthogonal",
      },
      content: {
        manifestSha256: "9a39ee522e556860053468854b0858bc1fafd8b7a1ca08ddff57d0371b717b35",
        poemSha256: "b699de273f5bbaedb08241495f52ce863d3e8e1851275ce3b6251484d75190a8",
        contentRevision: "20260828-0002",
      },
    });
    const record = harness.evidenceRecord as Record<string, unknown> & {
      artifact: Record<string, unknown>;
      content: Record<string, unknown>;
      displayMap: Record<string, unknown>;
      loop: Record<string, unknown>;
      placement: Record<string, unknown>;
      shutdown: Record<string, unknown>;
    };
    expect(Object.keys(record).sort()).toEqual([
      "acceptanceScope",
      "artifact",
      "content",
      "displayMap",
      "failureReason",
      "loop",
      "operatorNotes",
      "outcome",
      "physicalProjectorsTested",
      "placement",
      "runId",
      "schema",
      "shutdown",
    ]);
    expect(Object.keys(record.displayMap).sort()).toEqual([
      "path",
      "primary",
      "secondary",
      "sha256",
    ]);
    expect(Object.keys(record.artifact).sort()).toEqual([
      "archiveBytes",
      "archiveSha256",
      "commit",
      "configSha256",
      "coreBytes",
      "coreSha256",
      "layoutEngine",
      "tag",
    ]);
    expect(Object.keys(record.content).sort()).toEqual([
      "contentRevision",
      "manifestSha256",
      "poemSha256",
    ]);
    expect(Object.keys(record.placement).sort()).toEqual([
      "actual",
      "matchedWindowCount",
      "pid",
      "requested",
    ]);
    expect(Object.keys(record.loop).sort()).toEqual([
      "completedLoops",
      "durationMs",
      "maxDriftMs",
      "requestedLoops",
      "resetRestoredPoem",
    ]);
    expect(Object.keys(record.shutdown).sort()).toEqual([
      "natural",
      "processExitCode",
      "reason",
      "stderrBytes",
      "stderrTruncated",
      "stdoutBytes",
      "stdoutTruncated",
    ]);
    expect(JSON.stringify(harness.evidenceRecord)).not.toContain(harness.bridgeToken);
    expect(JSON.stringify(harness.evidenceRecord)).not.toContain("C:\\Users\\operator");
  });

  it("rejects a display-map byte change after runtime validation", async () => {
    const harness = createAdapterHarness([]);
    await expect(harness.dependencies.validate()).resolves.toEqual({ ok: true });
    const validatedMapSha256 = harness.confirmedMapSha256;
    harness.replaceDisplayMapBytes(Buffer.from(`${JSON.stringify(confirmedMap, null, 2)}\n`));
    expect(harness.confirmedMapSha256).not.toBe(validatedMapSha256);

    await expect(
      harness.dependencies.finalizeEvidence(validFinalizationSnapshot()),
    ).rejects.toThrow(/display-map.*changed/i);
    expect(harness.evidenceRecord).toBeUndefined();
  });

  it("rejects a runtime-core byte change after validation before spawn", async () => {
    const harness = createAdapterHarness([]);
    await expect(harness.dependencies.validate()).resolves.toEqual({ ok: true });
    const changedCore = Buffer.from(janVimCore);
    changedCore[0] = changedCore[0]! ^ 0xff;
    harness.replaceRuntimeCoreBytes(changedCore);
    const bridge = await harness.dependencies.startBridge();

    await expect(harness.dependencies.startJanVim(bridge)).rejects.toThrow(
      "runtime-core-changed-during-run",
    );
    expect(harness.spawnCall).toBeUndefined();
  });

  it("rejects a runtime-core byte change after validation before evidence passes", async () => {
    const harness = createAdapterHarness([]);
    await expect(harness.dependencies.validate()).resolves.toEqual({ ok: true });
    const changedCore = Buffer.from(janVimCore);
    changedCore[changedCore.byteLength - 1] =
      changedCore[changedCore.byteLength - 1]! ^ 0xff;
    harness.replaceRuntimeCoreBytes(changedCore);

    await expect(
      harness.dependencies.finalizeEvidence(validFinalizationSnapshot()),
    ).rejects.toThrow("runtime-core-changed-during-run");
    expect(harness.evidenceRecord).toBeUndefined();
  });

  it("refuses display routing when map bytes change after validation", async () => {
    const harness = createAdapterHarness([]);
    await expect(harness.dependencies.validate()).resolves.toEqual({ ok: true });
    harness.replaceDisplayMapBytes(Buffer.from(`${JSON.stringify(confirmedMap, null, 2)}\n`));

    await expect(harness.dependencies.routeDisplays()).resolves.toEqual({
      state: "ready",
      reason: "display-map-invalid",
    });
  });
});
