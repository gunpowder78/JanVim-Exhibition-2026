import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { win32 } from "node:path";

import type { RunLogStream } from "./bounded-log.js";
import type {
  SecondaryNavigationEvent,
  SecondaryWebContentsAdapter,
} from "./display-router.js";
import { G2_PROTECTED_ROOTS } from "./g2-command.js";

export interface FrozenRuntimeFileInput {
  label: string;
  path: string;
  expectedSize?: number;
  expectedSha256?: string;
}

export interface FrozenRuntimeInput {
  readFile(path: string): Uint8Array;
  files: readonly FrozenRuntimeFileInput[];
}

export interface FrozenRuntimeFileSnapshot {
  readonly label: string;
  readonly path: string;
  readonly bytes: Buffer;
  readonly size: number;
  readonly sha256: string;
}

export interface FrozenRuntimeSnapshot {
  readonly files: readonly FrozenRuntimeFileSnapshot[];
}

interface FrozenRuntimeSnapshotState {
  readFile(path: string): Uint8Array;
  files: readonly {
    label: string;
    path: string;
    bytes: Buffer;
  }[];
}

export interface LocalWebRequestAdapter {
  onBeforeRequest(
    filter: { urls: string[] } | null,
    listener?: (
      details: { url: string },
      callback: (result: { cancel: boolean }) => void,
    ) => void,
  ): void;
}

export interface LocalWebGuardInput {
  entryUrl: string;
  webContents: SecondaryWebContentsAdapter & {
    session: { webRequest: LocalWebRequestAdapter };
  };
}

export type ChildRunLogStream = Extract<
  RunLogStream,
  "janvim-stdout" | "janvim-stderr"
>;

export interface ChildStreamSinkInput {
  stream: ChildRunLogStream;
  write(stream: ChildRunLogStream, chunk: Uint8Array): boolean;
  observe?(chunk: Uint8Array): void;
}

export interface ChildStreamSink {
  append(chunk: Uint8Array): boolean;
}

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const LABEL_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const REMOTE_REQUEST_FILTER = {
  urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"],
};
const JANVIM_PRODUCT_ROOT = "D:\\github\\JanVim";
const snapshotStates = new WeakMap<
  FrozenRuntimeSnapshot,
  FrozenRuntimeSnapshotState
>();

export function readFrozenRuntimeSnapshot(
  input: FrozenRuntimeInput,
): FrozenRuntimeSnapshot {
  if (input.files.length === 0 || input.files.length > 32) {
    throw new Error("Frozen runtime file list must contain 1 to 32 entries");
  }

  const labels = new Set<string>();
  const paths = new Set<string>();
  const publicFiles: FrozenRuntimeFileSnapshot[] = [];
  const privateFiles: FrozenRuntimeSnapshotState["files"][number][] = [];
  for (const file of input.files) {
    validateFrozenFileInput(file, labels, paths);
    const bytes = Buffer.from(input.readFile(file.path));
    const size = bytes.byteLength;
    const sha256 = hashBytes(bytes);
    if (file.expectedSize !== undefined && size !== file.expectedSize) {
      throw new Error(`${file.label}-size-mismatch`);
    }
    if (file.expectedSha256 !== undefined && sha256 !== file.expectedSha256) {
      throw new Error(`${file.label}-hash-mismatch`);
    }
    publicFiles.push(
      Object.freeze({
        label: file.label,
        path: file.path,
        bytes: Buffer.from(bytes),
        size,
        sha256,
      }),
    );
    privateFiles.push(
      Object.freeze({
        label: file.label,
        path: file.path,
        bytes: Buffer.from(bytes),
      }),
    );
  }

  const snapshot = Object.freeze({
    files: Object.freeze(publicFiles),
  });
  snapshotStates.set(snapshot, {
    readFile: input.readFile,
    files: Object.freeze(privateFiles),
  });
  return snapshot;
}

export function assertFrozenSnapshotUnchanged(
  snapshot: FrozenRuntimeSnapshot,
): void {
  const state = snapshotStates.get(snapshot);
  if (state === undefined) throw new Error("Frozen runtime snapshot is not recognized");
  for (const file of state.files) {
    const current = Buffer.from(state.readFile(file.path));
    if (!current.equals(file.bytes)) {
      throw new Error(`${file.label}-changed-during-run`);
    }
  }
}

export function installLocalOnlyWebGuards(
  input: LocalWebGuardInput,
): () => void {
  if (!isLocalFileUrl(input.entryUrl)) {
    throw new Error("Secondary entry URL must be an exact local file URL");
  }

  const webRequest = input.webContents.session.webRequest;
  const navigationListener = (
    event: SecondaryNavigationEvent,
    targetUrl: string,
  ): void => {
    if (targetUrl !== input.entryUrl) event.preventDefault();
  };
  let requestRegistrationAttempted = false;
  let navigationRegistrationAttempted = false;
  try {
    requestRegistrationAttempted = true;
    webRequest.onBeforeRequest(
      { urls: [...REMOTE_REQUEST_FILTER.urls] },
      (_details, callback) => callback({ cancel: true }),
    );
    navigationRegistrationAttempted = true;
    input.webContents.on("will-navigate", navigationListener);
    input.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  } catch (error) {
    if (navigationRegistrationAttempted) {
      try {
        input.webContents.removeListener("will-navigate", navigationListener);
      } catch {
        // Preserve the installation failure after attempting both cleanup steps.
      }
    }
    if (requestRegistrationAttempted) {
      try {
        webRequest.onBeforeRequest(null);
      } catch {
        // Preserve the installation failure after attempting both cleanup steps.
      }
    }
    throw error;
  }

  let installed = true;
  return () => {
    if (!installed) return;
    installed = false;
    let cleanupError: unknown;
    try {
      input.webContents.removeListener("will-navigate", navigationListener);
    } catch (error) {
      cleanupError = error;
    }
    try {
      webRequest.onBeforeRequest(null);
    } catch (error) {
      cleanupError ??= error;
    }
    if (cleanupError !== undefined) throw cleanupError;
  };
}

export function createBoundedChildStreamSink(
  input: ChildStreamSinkInput,
): ChildStreamSink {
  if (input.stream !== "janvim-stdout" && input.stream !== "janvim-stderr") {
    throw new Error("Child stream must be JanVim stdout or stderr");
  }
  return Object.freeze({
    append: (value: Uint8Array): boolean => {
      const chunk = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      input.observe?.(chunk);
      return input.write(input.stream, chunk);
    },
  });
}

export function resolveBelowRoot(root: string, relativePath: string): string {
  if (
    !isDriveAbsolutePath(root) ||
    isDevicePath(root) ||
    hasAlternateDataStream(root)
  ) {
    throw new Error("Runtime root must be an absolute local Windows path");
  }
  const resolvedRoot = win32.resolve(root);
  rejectForbiddenRoot(resolvedRoot);

  if (
    relativePath.length === 0 ||
    win32.isAbsolute(relativePath) ||
    isDevicePath(relativePath) ||
    relativePath.includes(":") ||
    /[\u0000-\u001f\u007f]/.test(relativePath) ||
    relativePath.split(/[\\/]/).some((segment) => segment === "..")
  ) {
    throw new Error("Runtime relative path is unsafe");
  }

  const resolved = win32.resolve(resolvedRoot, relativePath);
  if (!isAtOrBelow(resolved, resolvedRoot)) {
    throw new Error("Runtime path escapes its root");
  }
  rejectForbiddenRoot(resolved);
  assertNoSymlinkEscape(resolvedRoot, resolved);
  return resolved;
}

function validateFrozenFileInput(
  file: FrozenRuntimeFileInput,
  labels: Set<string>,
  paths: Set<string>,
): void {
  if (!LABEL_PATTERN.test(file.label) || labels.has(file.label)) {
    throw new Error("Frozen runtime labels must be unique stable identifiers");
  }
  if (
    !isDriveAbsolutePath(file.path) ||
    isDevicePath(file.path) ||
    hasAlternateDataStream(file.path)
  ) {
    throw new Error(`${file.label}-path-invalid`);
  }
  const normalizedPath = win32.resolve(file.path).toLowerCase();
  if (paths.has(normalizedPath)) {
    throw new Error("Frozen runtime paths must be unique");
  }
  if (
    file.expectedSize !== undefined &&
    (!Number.isSafeInteger(file.expectedSize) || file.expectedSize < 0)
  ) {
    throw new Error(`${file.label}-expected-size-invalid`);
  }
  if (
    file.expectedSha256 !== undefined &&
    !HASH_PATTERN.test(file.expectedSha256)
  ) {
    throw new Error(`${file.label}-expected-hash-invalid`);
  }
  labels.add(file.label);
  paths.add(normalizedPath);
}

function hashBytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function isLocalFileUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "file:" && parsed.hostname.length === 0;
  } catch {
    return false;
  }
}

function isDriveAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) && win32.isAbsolute(value);
}

function hasAlternateDataStream(value: string): boolean {
  return value.slice(2).includes(":");
}

function isDevicePath(value: string): boolean {
  const normalized = value.replaceAll("/", "\\").toLowerCase();
  if (
    normalized.startsWith("\\\\?\\") ||
    normalized.startsWith("\\\\.\\") ||
    normalized.startsWith("\\??\\")
  ) {
    return true;
  }
  return normalized.split("\\").some((segment) => {
    const baseName = segment.replace(/[ .]+$/g, "").split(".", 1)[0];
    return (
      baseName === "con" ||
      baseName === "prn" ||
      baseName === "aux" ||
      baseName === "nul" ||
      /^com[1-9]$/.test(baseName ?? "") ||
      /^lpt[1-9]$/.test(baseName ?? "")
    );
  });
}

function rejectForbiddenRoot(path: string): void {
  if (isAtOrBelow(path, JANVIM_PRODUCT_ROOT)) {
    throw new Error("Runtime path targets JanVim product source");
  }
  if (G2_PROTECTED_ROOTS.some((root) => isAtOrBelow(path, root))) {
    throw new Error("Runtime path targets a protected root");
  }
}

function assertNoSymlinkEscape(root: string, target: string): void {
  if (!existsSync(root)) return;
  const realRoot = realpathSync.native(root);
  rejectForbiddenRoot(realRoot);

  let existing = target;
  while (!existsSync(existing)) {
    const parent = win32.dirname(existing);
    if (pathsEqual(parent, existing)) {
      throw new Error("Runtime path has no resolved root ancestor");
    }
    existing = parent;
  }
  const realExisting = realpathSync.native(existing);
  if (!isAtOrBelow(realExisting, realRoot)) {
    throw new Error("Runtime path escapes its root through a symlink");
  }
  rejectForbiddenRoot(realExisting);
}

function isAtOrBelow(candidate: string, root: string): boolean {
  const normalizedCandidate = win32.resolve(candidate).toLowerCase();
  const normalizedRoot = win32.resolve(root).toLowerCase();
  const relative = win32.relative(normalizedRoot, normalizedCandidate);
  return (
    relative.length === 0 ||
    (!win32.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${win32.sep}`))
  );
}

function pathsEqual(left: string, right: string): boolean {
  return win32.resolve(left).toLowerCase() === win32.resolve(right).toLowerCase();
}
