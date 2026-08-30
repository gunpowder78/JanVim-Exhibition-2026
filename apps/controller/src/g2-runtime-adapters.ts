import { execFile as nodeExecFile, spawn as nodeSpawn } from "node:child_process";
import { createHash, randomBytes as nodeRandomBytes, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join, win32 } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import {
  parseShowManifest,
  type AgentAck,
  type AgentCommand,
  type RendererEvent,
  type ShowManifest,
} from "@janvim-exhibition/show-schema";

import { BoundedLog, FileLogStorage, type LogStorage } from "./bounded-log.js";
import { BridgeServer } from "./bridge-server.js";
import {
  createSecondaryWindowPlan,
  routeDisplays,
  type DisplayRoute,
  type Rectangle,
  type RuntimeDisplay,
  type SecondaryBrowserWindowAdapter,
  type SecondaryWebContentsAdapter,
} from "./display-router.js";
import type { G2Command } from "./g2-command.js";
import {
  BoundedChildOutput,
  CHILD_STREAM_LIMIT_BYTES,
  CHILD_TAIL_BYTES,
  classifyJanVimShutdown,
  writeG2Evidence,
  type G2EvidenceRecord,
  type G2ShutdownEvidence,
} from "./g2-evidence.js";
import {
  launchJanVimProcess,
  type JanVimProcessDependencies,
  type SpawnAdapter,
  type SpawnedProcess,
} from "./janvim-process.js";
import {
  DeterministicShowLoop,
  bindLocalStartRequest,
  type IpcMainAdapter,
  type ShowController,
} from "./main.js";
import {
  OneLoopDriver,
  type OneLoopTimerAdapter,
  type OneLoopTimerHandle,
} from "./one-loop-driver.js";
import { SHOW_EVENT_CHANNEL } from "./preload.js";
import {
  parseConfirmedRehearsalDisplayMap,
  parseRehearsalDisplayCatalog,
} from "./rehearsal-display-map.js";
import {
  assertFrozenSnapshotUnchanged,
  createBoundedChildStreamSink,
  installLocalOnlyWebGuards,
  readFrozenRuntimeSnapshot,
  resolveBelowRoot,
  type ChildStreamSink,
  type FrozenRuntimeSnapshot,
} from "./runtime-adapter-common.js";
import {
  G2RuntimeComposition,
  type G2BridgeHandle,
  type G2EvidenceFinalization,
  type G2JanVimHandle,
  type G2RuntimeDependencies,
  type G2SecondaryHandle,
} from "./runtime-composition.js";
import { placeJanVimWindow } from "./window-placer.js";

export interface G2ExecFileLimits {
  cwd?: string;
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
}

export interface G2ExecFileResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type G2ExecFileAdapter = (
  file: string,
  args: readonly string[],
  limits: G2ExecFileLimits,
) => Promise<G2ExecFileResult>;

export interface G2ExclusiveOutput {
  write(chunk: Uint8Array): void;
  close(): void;
}

export interface G2ReadableOutput {
  on(event: "data", listener: (chunk: Buffer) => void): void;
  off(event: "data", listener: (chunk: Buffer) => void): void;
}

export interface G2SpawnedChild extends SpawnedProcess {
  pid: number;
  stdout: G2ReadableOutput | null;
  stderr: G2ReadableOutput | null;
  once(event: "close", listener: (exitCode: number | null) => void): this;
  off(event: "close", listener: (exitCode: number | null) => void): this;
}

export interface G2BridgeServerAdapter {
  listen(): Promise<{ host: "127.0.0.1"; port: number; family: string }>;
  waitForAgent(timeoutMs: number): Promise<void>;
  dispatch(command: AgentCommand): Promise<AgentAck>;
  close(): Promise<void>;
}

export interface G2WebRequestAdapter {
  onBeforeRequest(
    filter: { urls: string[] } | null,
    listener?: (
      details: { url: string },
      callback: (result: { cancel: boolean }) => void,
    ) => void,
  ): void;
}

export interface G2WebContentsAdapter extends SecondaryWebContentsAdapter {
  session: { webRequest: G2WebRequestAdapter };
  send(channel: string, payload: unknown): void;
}

export interface G2BrowserWindowAdapter extends SecondaryBrowserWindowAdapter {
  webContents: G2WebContentsAdapter;
  on(event: "closed", listener: () => void): this;
  once(event: "closed", listener: () => void): this;
  removeListener(event: "closed", listener: () => void): this;
  close(): void;
  destroy(): void;
  isDestroyed(): boolean;
}

export type G2BrowserWindowConstructor = new (
  options: Record<string, unknown>,
) => G2BrowserWindowAdapter;

export interface G2RuntimeAdapterHost {
  repositoryRoot: string;
  BrowserWindow: G2BrowserWindowConstructor;
  ipcMain: IpcMainAdapter;
  screen: { getAllDisplays(): readonly unknown[] };
  baseEnvironment?: NodeJS.ProcessEnv;
  readFile?(path: string): Buffer;
  execFile?: G2ExecFileAdapter;
  spawn?: SpawnAdapter;
  verifyArtifact?: JanVimProcessDependencies["verifyArtifact"];
  randomBytes?(size: number): Buffer;
  createBridge?(token: string): G2BridgeServerAdapter;
  runWithDeadline?<T>(timeoutMs: number, operation: () => Promise<T>): Promise<T>;
  logStorage?: LogStorage;
  ensureExclusiveFile?(path: string): void;
  openExclusiveOutput?(path: string): G2ExclusiveOutput;
  writeEvidence?(path: string, value: unknown): void;
  nowMonotonic?(): number;
  timers?: OneLoopTimerAdapter;
}

interface NormalizedRuntimeHost {
  repositoryRoot: string;
  BrowserWindow: G2BrowserWindowConstructor;
  ipcMain: IpcMainAdapter;
  screen: G2RuntimeAdapterHost["screen"];
  baseEnvironment: NodeJS.ProcessEnv;
  readFile(path: string): Buffer;
  execFile: G2ExecFileAdapter;
  spawn: SpawnAdapter;
  verifyArtifact: JanVimProcessDependencies["verifyArtifact"];
  randomBytes(size: number): Buffer;
  createBridge(token: string): G2BridgeServerAdapter;
  runWithDeadline<T>(timeoutMs: number, operation: () => Promise<T>): Promise<T>;
  logStorage: LogStorage;
  ensureExclusiveFile(path: string): void;
  openExclusiveOutput(path: string): G2ExclusiveOutput;
  writeEvidence(path: string, value: unknown): void;
  nowMonotonic(): number;
  timers: OneLoopTimerAdapter;
}

type RuntimeCommand = Extract<G2Command, { mode: "ValidateOnly" | "Run" }>;

interface ValidatedRuntimeInputs {
  artifactLockBytes: Buffer;
  artifactLockSnapshot: FrozenRuntimeSnapshot;
  displayMapBytes: Buffer;
  displayMapSnapshot: FrozenRuntimeSnapshot;
  displayMap: ReturnType<typeof parseConfirmedRehearsalDisplayMap>;
  showConfigBytes: Buffer;
  showConfigSnapshot: FrozenRuntimeSnapshot;
  manifestBytes: Buffer;
  manifestSnapshot: FrozenRuntimeSnapshot;
  manifest: ShowManifest;
  poemBytes: Buffer;
  poemSnapshot: FrozenRuntimeSnapshot;
  runtimeCoreSnapshot: FrozenRuntimeSnapshot;
}
const PRIVATE_ENVIRONMENT_DENYLIST = new Set([
  "MYVIMRC",
  "VIMINIT",
  "EXINIT",
  "NVIM_APPNAME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
]);

export function createG2RuntimeDependencies(
  command: RuntimeCommand,
  source: G2RuntimeAdapterHost,
): G2RuntimeDependencies {
  const host = normalizeHost(source);
  const paths = runtimePaths(host.repositoryRoot, command.rehearsalRoot);
  let bridgeToken: string | undefined;
  let logger: BoundedLog | undefined;
  let stdoutCapture: BoundedChildOutput | undefined;
  let stderrCapture: BoundedChildOutput | undefined;
  let stdoutStreamSink: ChildStreamSink | undefined;
  let stderrStreamSink: ChildStreamSink | undefined;
  let stdoutOutput: G2ExclusiveOutput | undefined;
  let stderrOutput: G2ExclusiveOutput | undefined;
  let outputSettled = false;
  let closeObserved = false;
  let closeExitCode: number | null = null;
  let startedChild: G2SpawnedChild | undefined;
  let detachChildOutput: (() => void) | undefined;
  let validatedInputs: ValidatedRuntimeInputs | undefined;

  const requireValidatedInputs = (): ValidatedRuntimeInputs => {
    if (validatedInputs === undefined) throw new Error("runtime-inputs-not-validated");
    return validatedInputs;
  };

  const settleChildOutput = (): void => {
    if (outputSettled) return;
    outputSettled = true;
    detachChildOutput?.();
    detachChildOutput = undefined;
    safeCloseOutput(stdoutOutput);
    safeCloseOutput(stderrOutput);
    stdoutOutput = undefined;
    stderrOutput = undefined;
  };

  const dependencies: G2RuntimeDependencies = {
    validate: async () => {
      const result = await host.execFile(
        "pwsh",
        [
          "-NoProfile",
          "-NonInteractive",
          "-File",
          paths.verifyRuntimeScript,
        ],
        {
          cwd: host.repositoryRoot,
          timeoutMs: 30_000,
          maxStdoutBytes: 8_192,
          maxStderrBytes: 8_192,
        },
      );
      if (
        result.exitCode !== 0 ||
        Buffer.byteLength(result.stdout, "utf8") > 8_192 ||
        Buffer.byteLength(result.stderr, "utf8") > 8_192
      ) {
        return { ok: false, reason: "runtime-verification-failed" };
      }
      try {
        validatedInputs = validateStaticRuntimeInputs(host, paths, command.displayMapPath);
        return { ok: true };
      } catch {
        validatedInputs = undefined;
        return { ok: false, reason: "runtime-input-invalid" };
      }
    },

    routeDisplays: async (): Promise<DisplayRoute> => {
      try {
        const inputs = requireValidatedInputs();
        assertFrozenSnapshotUnchanged(inputs.displayMapSnapshot);
        return routeDisplays(
          normalizeRuntimeDisplays(host.screen.getAllDisplays()),
          inputs.displayMap,
        );
      } catch {
        return { state: "ready", reason: "display-map-invalid" };
      }
    },

    openSecondary: async (display) =>
      openGuardedSecondary(host, display, paths.secondaryEntry, paths.preloadBundle),

    bindStart: (controller: ShowController) =>
      bindLocalStartRequest(
        host.ipcMain,
        controller,
        pathToFileURL(paths.secondaryEntry).href,
      ),

    startBridge: async (): Promise<G2BridgeHandle> => {
      const token = host.randomBytes(24).toString("hex");
      const server = host.createBridge(token);
      let address: Awaited<ReturnType<G2BridgeServerAdapter["listen"]>>;
      try {
        address = await host.runWithDeadline(5_000, () => server.listen());
      } catch (error) {
        await server.close().catch(() => undefined);
        throw error;
      }
      if (address.host !== "127.0.0.1") {
        await server.close().catch(() => undefined);
        throw new Error("Bridge escaped IPv4 loopback");
      }
      bridgeToken = token;
      return {
        host: "127.0.0.1",
        port: address.port,
        token,
        waitForAgent: (timeoutMs: 10_000) => server.waitForAgent(timeoutMs),
        dispatch: (agentCommand) => server.dispatch(agentCommand),
        close: () => server.close(),
      };
    },

    startJanVim: async (bridge) => {
      const inputs = requireValidatedInputs();
      assertFrozenSnapshotUnchanged(inputs.runtimeCoreSnapshot);
      if (startedChild !== undefined) {
        return { ok: false, reason: "janvim-already-started" };
      }
      try {
        stdoutOutput = host.openExclusiveOutput(paths.stdoutLog);
        stderrOutput = host.openExclusiveOutput(paths.stderrLog);
      } catch {
        safeCloseOutput(stdoutOutput);
        safeCloseOutput(stderrOutput);
        stdoutOutput = undefined;
        stderrOutput = undefined;
        return { ok: false, reason: "child-output-open-failed" };
      }
      stdoutCapture = new BoundedChildOutput(
        CHILD_STREAM_LIMIT_BYTES,
        CHILD_TAIL_BYTES,
        (chunk) => stdoutOutput?.write(chunk),
      );
      stderrCapture = new BoundedChildOutput(
        CHILD_STREAM_LIMIT_BYTES,
        CHILD_TAIL_BYTES,
        (chunk) => stderrOutput?.write(chunk),
      );
      stdoutStreamSink = createBoundedChildStreamSink({
        stream: "janvim-stdout",
        write: (_stream, chunk) => {
          stdoutCapture?.append(chunk);
          return true;
        },
      });
      stderrStreamSink = createBoundedChildStreamSink({
        stream: "janvim-stderr",
        write: (_stream, chunk) => {
          stderrCapture?.append(chunk);
          return true;
        },
      });

      const privateBaseEnvironment = { ...host.baseEnvironment };
      for (const key of Object.keys(privateBaseEnvironment)) {
        if (PRIVATE_ENVIRONMENT_DENYLIST.has(key.toUpperCase())) {
          delete privateBaseEnvironment[key];
        }
      }
      const launch = await launchJanVimProcess(
        {
          artifactLockPath: paths.artifactLock,
          executablePath: paths.janvimExecutable,
          workingDirectory: paths.janvimRoot,
          arguments: ["--config", paths.showConfig, paths.poem],
          privateUserRoot: paths.privateUserRoot,
          bridgePort: bridge.port,
          bridgeToken: bridge.token,
        },
        {
          baseEnvironment: privateBaseEnvironment,
          verifyArtifact: host.verifyArtifact,
          spawn: host.spawn,
        },
      );
      if (!launch.started) {
        settleChildOutput();
        return { ok: false, reason: launch.reason };
      }
      const child = launch.child as G2SpawnedChild;
      if (child.stdout === null || child.stderr === null) {
        child.kill?.();
        settleChildOutput();
        return { ok: false, reason: "child-output-unavailable" };
      }
      startedChild = child;
      const onStdout = (chunk: Buffer): void => {
        stdoutStreamSink?.append(chunk);
      };
      const onStderr = (chunk: Buffer): void => {
        stderrStreamSink?.append(chunk);
      };
      child.stdout.on("data", onStdout);
      child.stderr.on("data", onStderr);
      detachChildOutput = () => {
        child.stdout?.off("data", onStdout);
        child.stderr?.off("data", onStderr);
      };
      child.once("close", (exitCode) => {
        closeObserved = true;
        closeExitCode = exitCode;
        settleChildOutput();
      });

      let killRequested = false;
      const handle: G2JanVimHandle = {
        pid: child.pid,
        onClose: (listener) => {
          if (closeObserved) {
            let active = true;
            queueMicrotask(() => {
              if (active) listener(closeExitCode);
            });
            return () => {
              active = false;
            };
          }
          child.once("close", listener);
          return () => child.off("close", listener);
        },
        kill: () => {
          if (killRequested) return false;
          killRequested = true;
          return child.kill?.() ?? false;
        },
      };
      return { ok: true, child: handle };
    },

    placeJanVim: (pid, bounds) =>
      placeJanVimWindow({
        helperPath: paths.windowPlacementScript,
        target: { pid, bounds },
        runHelper: async (invocation, limits) =>
          host.execFile(invocation.file, invocation.args, {
            cwd: host.repositoryRoot,
            timeoutMs: limits.timeoutMs,
            maxStdoutBytes: limits.maxOutputBytes,
            maxStderrBytes: limits.maxOutputBytes,
          }),
      }),

    createLoop: (bridge, secondary) => {
      const inputs = requireValidatedInputs();
      const manifest = inputs.manifest;
      const poem = inputs.poemBytes.toString("utf8");
      let resetNumber = 0;
      return new DeterministicShowLoop({
        manifest,
        poem,
        token: bridge.token,
        clock: { nowMonotonic: host.nowMonotonic },
        renderer: {
          apply: (cue) => secondary.send(cue),
          showReady: (loopId) => {
            dependencies.log({ event: "loop-ready", loopId });
          },
        },
        agent: { dispatch: (agentCommand) => bridge.dispatch(agentCommand) },
        generateLoopId: () => {
          resetNumber += 1;
          return `${manifest.loopId}-reset-${resetNumber}`;
        },
        onSafeBlack: (reason) => dependencies.log({ event: "loop-safe-black", reason }),
      });
    },

    createDriver: (loop, callbacks) => {
      const manifest = requireValidatedInputs().manifest;
      return new OneLoopDriver({
        runtime: loop,
        timers: host.timers,
        clock: { nowMonotonic: host.nowMonotonic },
        loopDurationMs: manifest.loopDurationMs,
        onComplete: callbacks.onComplete,
        onFailure: callbacks.onFailure,
      });
    },

    timers: {
      setTimeout: (callback, delayMs) => host.timers.setTimeout(callback, delayMs),
      clearTimeout: (id) => host.timers.clearTimeout(id),
    },

    log: (event) => {
      logger ??= createRunLogger(host, paths.controllerLog);
      logger.write(redactEvent(event, bridgeToken));
    },

    classifyShutdown: async (exitCode): Promise<G2ShutdownEvidence> => {
      if (exitCode === null && !closeObserved) settleChildOutput();
      const stdoutBytes = stdoutCapture?.bytesObserved ?? 0;
      const stderrBytes = stderrCapture?.bytesObserved ?? 0;
      const stdoutTruncated = stdoutCapture?.truncated ?? false;
      const stderrTruncated = stderrCapture?.truncated ?? false;
      const classification = classifyJanVimShutdown({
        processExitCode: exitCode,
        stdoutTail: stdoutCapture?.tail ?? "",
        stderrBytes,
        stdoutTruncated,
        stderrTruncated,
      });
      return {
        processExitCode: exitCode,
        ...classification,
        stdoutBytes,
        stderrBytes,
        stdoutTruncated,
        stderrTruncated,
      };
    },

    finalizeEvidence: async (input: G2EvidenceFinalization) => {
      const inputs = requireValidatedInputs();
      assertFrozenSnapshotUnchanged(inputs.artifactLockSnapshot);
      const lock = parseArtifactLockBytes(inputs.artifactLockBytes);
      assertFrozenSnapshotUnchanged(inputs.displayMapSnapshot);
      const mapBytes = inputs.displayMapBytes;
      assertFrozenSnapshotUnchanged(inputs.showConfigSnapshot);
      const configBytes = inputs.showConfigBytes;
      if (sha256(configBytes) !== lock.configSha256) {
        throw new Error("show-config-hash-mismatch");
      }
      assertFrozenSnapshotUnchanged(inputs.manifestSnapshot);
      const manifestBytes = inputs.manifestBytes;
      assertFrozenSnapshotUnchanged(inputs.poemSnapshot);
      const poemBytes = inputs.poemBytes;
      assertFrozenSnapshotUnchanged(inputs.runtimeCoreSnapshot);
      const manifest = inputs.manifest;
      const record: G2EvidenceRecord = {
        schema: 1,
        runId: command.runId,
        outcome: input.result.ok ? "passed" : "failed",
        failureReason: input.result.ok ? null : input.result.reason,
        acceptanceScope: "two-real-monitors-projector-simulation",
        physicalProjectorsTested: false,
        displayMap: {
          path: command.displayMapPath,
          sha256: sha256(mapBytes),
          primary: inputs.displayMap.primary,
          secondary: inputs.displayMap.secondary,
        },
        artifact: {
          tag: lock.tag,
          commit: lock.commit,
          archiveBytes: lock.archiveBytes,
          archiveSha256: lock.archiveSha256,
          coreBytes: lock.coreBytes,
          coreSha256: lock.coreSha256,
          configSha256: lock.configSha256,
          layoutEngine: lock.layoutEngine,
        },
        content: {
          manifestSha256: sha256(manifestBytes),
          poemSha256: sha256(poemBytes),
          contentRevision: manifest.contentRevision,
        },
        placement:
          input.placement === null
            ? null
            : {
                pid: input.placement.pid,
                requested: { ...input.placement.requested },
                actual: { ...input.placement.actual },
                matchedWindowCount: 1,
              },
        loop: {
          requestedLoops: 1,
          completedLoops: input.completedLoops,
          durationMs: manifest.loopDurationMs,
          maxDriftMs: input.maxDriftMs,
          resetRestoredPoem: input.resetRestoredPoem,
        },
        shutdown: input.shutdown,
        operatorNotes: [
          "Two real monitors used for projector simulation; physical projectors not tested.",
        ],
      };
      host.writeEvidence(paths.evidence, record);
    },
  };

  return dependencies;
}

export function createElectronCommandAdapters(source: G2RuntimeAdapterHost) {
  const host = normalizeHost(source);
  return {
    runWithDeadline: <T>(timeoutMs: number, operation: () => Promise<T>) =>
      host.runWithDeadline(timeoutMs, operation),
    getAllDisplays: () => normalizeRuntimeDisplays(host.screen.getAllDisplays()),
    readCatalog: async (path: string) =>
      parseRehearsalDisplayCatalog(JSON.parse(host.readFile(path).toString("utf8"))),
    writeJsonAtomic: async (
      path: string,
      value: unknown,
      options: { mustNotExist: true } | { replace: true },
    ) => {
      writeJsonAtomic(path, value, options);
    },
    createRuntimeDependencies: (command: RuntimeCommand) =>
      createG2RuntimeDependencies(command, source),
    createComposition: (dependencies: G2RuntimeDependencies) =>
      new G2RuntimeComposition(dependencies),
  };
}

async function openGuardedSecondary(
  host: NormalizedRuntimeHost,
  display: RuntimeDisplay,
  entryPath: string,
  preloadPath: string,
): Promise<G2SecondaryHandle> {
  const entryUrl = pathToFileURL(entryPath).href;
  const plan = createSecondaryWindowPlan(display.bounds, preloadPath, entryUrl);
  const window = new host.BrowserWindow(
    plan.browserWindowOptions as unknown as Record<string, unknown>,
  );
  const disposeGuards = installLocalOnlyWebGuards({
    webContents: window.webContents,
    entryUrl,
  });
  try {
    await host.runWithDeadline(15_000, () => window.loadURL(entryUrl));
  } catch (error) {
    if (!window.isDestroyed()) window.destroy();
    disposeGuards();
    throw error;
  }
  let resourcesDisposed = false;
  const disposeResources = (): void => {
    if (resourcesDisposed) return;
    resourcesDisposed = true;
    disposeGuards();
  };
  window.once("closed", disposeResources);

  return {
    send: (event: RendererEvent) => {
      if (!window.isDestroyed()) window.webContents.send(SHOW_EVENT_CHANNEL, event);
    },
    onDestroyed: (listener) => {
      window.on("closed", listener);
      return () => window.removeListener("closed", listener);
    },
    close: () => {
      disposeResources();
      if (!window.isDestroyed()) window.close();
    },
  };
}

function normalizeHost(source: G2RuntimeAdapterHost): NormalizedRuntimeHost {
  if (!win32.isAbsolute(source.repositoryRoot)) {
    throw new Error("G2 repository root must be an absolute Windows path");
  }
  const readFile = source.readFile ?? ((path: string) => readFileSync(path));
  return {
    repositoryRoot: win32.resolve(source.repositoryRoot),
    BrowserWindow: source.BrowserWindow,
    ipcMain: source.ipcMain,
    screen: source.screen,
    baseEnvironment: source.baseEnvironment ?? process.env,
    readFile,
    execFile: source.execFile ?? executeFileBounded,
    spawn:
      source.spawn ??
      (((file, args, options) => nodeSpawn(file, [...args], options)) as SpawnAdapter),
    verifyArtifact:
      source.verifyArtifact ??
      (async (lockPath, executablePath) => {
        try {
          const lock = readArtifactLock({ readFile } as NormalizedRuntimeHost, lockPath);
          const executable = readFile(executablePath);
          return executable.byteLength === lock.coreBytes && sha256(executable) === lock.coreSha256
            ? { ok: true }
            : { ok: false, reason: "core-hash-mismatch" };
        } catch {
          return { ok: false, reason: "artifact-verification-failed" };
        }
      }),
    randomBytes: source.randomBytes ?? nodeRandomBytes,
    createBridge: source.createBridge ?? ((token) => new BridgeServer({ token })),
    runWithDeadline: source.runWithDeadline ?? runWithDeadline,
    logStorage: source.logStorage ?? new FileLogStorage(),
    ensureExclusiveFile: source.ensureExclusiveFile ?? ensureExclusiveFile,
    openExclusiveOutput: source.openExclusiveOutput ?? openExclusiveOutput,
    writeEvidence: source.writeEvidence ?? writeG2Evidence,
    nowMonotonic: source.nowMonotonic ?? (() => performance.now()),
    timers: source.timers ?? realOneLoopTimers,
  };
}

function runtimePaths(repositoryRoot: string, rehearsalRoot: string) {
  return {
    artifactLock: resolveBelowRoot(repositoryRoot, "janvim-artifact.lock.json"),
    verifyRuntimeScript: resolveBelowRoot(repositoryRoot, "scripts\\verify-runtime.ps1"),
    windowPlacementScript: resolveBelowRoot(
      repositoryRoot,
      "scripts\\place-janvim-window.ps1",
    ),
    janvimRoot: resolveBelowRoot(repositoryRoot, "runtime\\janvim"),
    janvimExecutable: resolveBelowRoot(
      repositoryRoot,
      "runtime\\janvim\\janvim-core.exe",
    ),
    privateUserRoot: resolveBelowRoot(repositoryRoot, "runtime\\user-root"),
    showConfig: resolveBelowRoot(repositoryRoot, "show\\janvim-show.toml"),
    poem: resolveBelowRoot(repositoryRoot, "content\\fixture\\poem.txt"),
    manifest: resolveBelowRoot(
      repositoryRoot,
      "content\\fixture\\show.manifest.json",
    ),
    secondaryEntry: resolveBelowRoot(
      repositoryRoot,
      "apps\\secondary-screen\\dist\\index.html",
    ),
    preloadBundle: resolveBelowRoot(
      repositoryRoot,
      "apps\\controller\\dist\\preload\\preload.cjs",
    ),
    stdoutLog: resolveBelowRoot(rehearsalRoot, "janvim.stdout.log"),
    stderrLog: resolveBelowRoot(rehearsalRoot, "janvim.stderr.log"),
    controllerLog: resolveBelowRoot(rehearsalRoot, "controller.ndjson"),
    evidence: resolveBelowRoot(rehearsalRoot, "g2-run.json"),
  };
}

function normalizeRuntimeDisplays(values: readonly unknown[]): RuntimeDisplay[] {
  return values.map((value) => {
    if (value === null || typeof value !== "object") {
      throw new Error("Electron display is invalid");
    }
    const record = value as {
      id?: string | number;
      displayId?: string | number;
      bounds?: Rectangle;
      scaleFactor?: number;
    };
    const displayId = record.displayId ?? record.id;
    if (displayId === undefined || record.bounds === undefined || record.scaleFactor === undefined) {
      throw new Error("Electron display is incomplete");
    }
    return {
      displayId,
      bounds: { ...record.bounds },
      scaleFactor: record.scaleFactor,
    };
  });
}

function validateStaticRuntimeInputs(
  host: NormalizedRuntimeHost,
  paths: ReturnType<typeof runtimePaths>,
  displayMapPath: string,
): ValidatedRuntimeInputs {
  const artifactLock = readFrozenG2File(host, paths.artifactLock, "artifact-lock");
  const artifactLockBytes = artifactLock.bytes;
  const lock = parseArtifactLockBytes(artifactLockBytes);
  const showConfig = readFrozenG2File(host, paths.showConfig, "show-config");
  const showConfigBytes = showConfig.bytes;
  if (sha256(showConfigBytes) !== lock.configSha256) {
    throw new Error("show-config-hash-mismatch");
  }
  const displayMapFile = readFrozenG2File(host, displayMapPath, "display-map");
  const displayMapBytes = displayMapFile.bytes;
  const displayMap = parseConfirmedRehearsalDisplayMap(
    JSON.parse(displayMapBytes.toString("utf8")),
  );
  const manifestFile = readFrozenG2File(host, paths.manifest, "show-manifest");
  const manifestBytes = manifestFile.bytes;
  const manifest = parseShowManifest(JSON.parse(manifestBytes.toString("utf8")));
  const poemFile = readFrozenG2File(host, paths.poem, "poem");
  const poemBytes = poemFile.bytes;
  if (sha256(poemBytes) !== manifest.poemSha256) throw new Error("poem-hash-mismatch");
  const runtimeCore = readFrozenG2File(
    host,
    paths.janvimExecutable,
    "runtime-core",
    {
      expectedSize: lock.coreBytes,
      expectedSha256: lock.coreSha256,
    },
  );
  return {
    artifactLockBytes: Buffer.from(artifactLockBytes),
    artifactLockSnapshot: artifactLock.snapshot,
    displayMapBytes: Buffer.from(displayMapBytes),
    displayMapSnapshot: displayMapFile.snapshot,
    displayMap,
    showConfigBytes: Buffer.from(showConfigBytes),
    showConfigSnapshot: showConfig.snapshot,
    manifestBytes: Buffer.from(manifestBytes),
    manifestSnapshot: manifestFile.snapshot,
    manifest,
    poemBytes: Buffer.from(poemBytes),
    poemSnapshot: poemFile.snapshot,
    runtimeCoreSnapshot: runtimeCore.snapshot,
  };
}

function readFrozenG2File(
  host: Pick<NormalizedRuntimeHost, "readFile">,
  path: string,
  label: string,
  expected: { expectedSize: number; expectedSha256: string } | undefined =
    undefined,
): { bytes: Buffer; snapshot: FrozenRuntimeSnapshot } {
  const snapshot = readFrozenRuntimeSnapshot({
    readFile: (targetPath) => host.readFile(targetPath),
    files: [{ label, path, ...expected }],
  });
  return {
    bytes: Buffer.from(snapshot.files[0]!.bytes),
    snapshot,
  };
}

function createRunLogger(host: NormalizedRuntimeHost, path: string): BoundedLog {
  host.ensureExclusiveFile(path);
  return new BoundedLog({ storage: host.logStorage, basePath: path, secrets: [] });
}

function redactEvent(
  event: Record<string, unknown>,
  secret: string | undefined,
): Record<string, unknown> {
  let serialized = JSON.stringify(event);
  if (secret !== undefined && secret.length > 0) {
    serialized = serialized.split(secret).join("[REDACTED]");
  }
  return JSON.parse(serialized) as Record<string, unknown>;
}

function safeCloseOutput(output: G2ExclusiveOutput | undefined): void {
  if (output === undefined) return;
  try {
    output.close();
  } catch {
    // Child cleanup must remain finite when an output sink is already closed.
  }
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function runWithDeadline<T>(
  timeoutMs: number,
  operation: () => Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("g2-command-timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function executeFileBounded(
  file: string,
  args: readonly string[],
  limits: G2ExecFileLimits,
): Promise<G2ExecFileResult> {
  return new Promise((resolve) => {
    nodeExecFile(
      file,
      [...args],
      {
        cwd: limits.cwd,
        timeout: limits.timeoutMs,
        maxBuffer: Math.max(limits.maxStdoutBytes, limits.maxStderrBytes),
        encoding: "utf8",
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const errorCode = error?.code;
        const numericCode =
          error === null ? 0 : typeof errorCode === "number" ? errorCode : 1;
        resolve({
          exitCode: numericCode,
          stdout: String(stdout).slice(0, limits.maxStdoutBytes),
          stderr: String(stderr).slice(0, limits.maxStderrBytes),
        });
      },
    );
  });
}

function ensureExclusiveFile(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const descriptor = openSync(path, "wx", 0o600);
  closeSync(descriptor);
}

function openExclusiveOutput(path: string): G2ExclusiveOutput {
  mkdirSync(dirname(path), { recursive: true });
  const descriptor = openSync(path, "wx", 0o600);
  let closed = false;
  return {
    write: (chunk) => {
      if (closed) throw new Error("exclusive output is closed");
      writeSync(descriptor, chunk);
    },
    close: () => {
      if (closed) return;
      closed = true;
      fsyncSync(descriptor);
      closeSync(descriptor);
    },
  };
}

function writeJsonAtomic(
  path: string,
  value: unknown,
  options: { mustNotExist: true } | { replace: true },
): void {
  if ("mustNotExist" in options && existsSync(path)) {
    throw new Error("display-map-already-exists");
  }
  const temporaryPath = join(
    dirname(path),
    `.g2-display-map-${process.pid}-${randomUUID()}.tmp`,
  );
  let descriptor: number | undefined;
  let ownsTemporary = false;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    ownsTemporary = true;
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    if ("mustNotExist" in options && existsSync(path)) {
      throw new Error("display-map-already-exists");
    }
    renameSync(temporaryPath, path);
    ownsTemporary = false;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (ownsTemporary) rmSync(temporaryPath, { force: true });
  }
}

const realOneLoopTimers: OneLoopTimerAdapter = {
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (id: OneLoopTimerHandle) => clearInterval(id as ReturnType<typeof setInterval>),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (id: OneLoopTimerHandle) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const artifactLockSchema = z
  .object({
    schema: z.literal(1),
    sourceRepository: z.literal("D:/github/JanVim"),
    tag: z.literal("v0.10.1-gmk.4"),
    commit: z.literal("e95633101d93f8448b0f906e918b5d836ab95273"),
    archive: z.string().min(1),
    archiveBytes: z.number().int().positive(),
    archiveSha256: hashSchema,
    checksum: z.string().min(1),
    checksumSha256: hashSchema,
    core: z.literal("janvim-core.exe"),
    coreBytes: z.literal(18_866_688),
    coreSha256: z.literal(
      "224b3457d89fbc6cf946359683632f29f9262bae08b6f0d2e3043a3a7a6d83b3",
    ),
    runtimeLua: z.string().min(1),
    runtimeLuaSha256: hashSchema,
    artifactConfig: z.string().min(1),
    artifactConfigSha256: hashSchema,
    config: z.literal("show/janvim-show.toml"),
    configSha256: hashSchema,
    layoutEngine: z.enum(["dynamic", "orthogonal"]),
    role: z.literal("primary-projector"),
    provenanceKind: z.string().min(1),
    provenanceReference: z.string().min(1),
    provenanceRecord: z.string().min(1),
    provenanceSha256: hashSchema,
    evidenceRecord: z.string().min(1),
    evidenceSha256: hashSchema,
    pluginLabConfig: z.string().min(1),
    pluginLabConfigSha256: hashSchema,
  })
  .strict();

function readArtifactLock(host: Pick<NormalizedRuntimeHost, "readFile">, path: string) {
  return parseArtifactLockBytes(host.readFile(path));
}

function parseArtifactLockBytes(value: Uint8Array) {
  return artifactLockSchema.parse(JSON.parse(Buffer.from(value).toString("utf8")));
}
