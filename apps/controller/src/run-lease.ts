import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from "node:path";
import { TextDecoder } from "node:util";

import { z } from "zod";

export type RunLease = {
  schema: 1;
  runId: string;
  controllerRunId: string;
  generationId: number;
  controller: { pid: number; startedAtUtc: string };
  janvim: {
    pid: number;
    startedAtUtc: string;
    hwnd: string;
    executableRelativePath: "janvim-core.exe";
    executableSha256: string;
  };
};

export type LeaseProcessInspection =
  | {
      status: "found";
      pid: number;
      startedAtUtc?: string;
      executablePath?: string;
    }
  | { status: "not-found" }
  | { status: "unprovable"; reason: "access-denied" | "missing-proof" };

export type LeaseWindowInspection =
  | { status: "found"; ownerPid: number }
  | { status: "not-found" }
  | { status: "unprovable"; reason: "access-denied" | "missing-proof" };

export interface LeaseIdentityAdapter {
  inspectProcess(pid: number): Promise<LeaseProcessInspection>;
  inspectWindowOwner(hwnd: string): Promise<LeaseWindowInspection>;
}

export interface LeaseVerificationInput {
  runtimeRoot: string;
  expectedExecutableSha256: string;
  adapter: LeaseIdentityAdapter;
}

const MAX_LEASE_BYTES = 4_096;
const MAX_PATH_CHARACTERS = 32_767;
const MAX_EXECUTABLE_BYTES = 256 * 1024 * 1024;
const HASH_CHUNK_BYTES = 64 * 1024;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const BRIDGE_TOKEN_PATTERN = /[0-9a-f]{48}/i;
const UTC_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;
const ATOMIC_RENAME_ATTEMPTS = 5;
const ATOMIC_RENAME_RETRY_DELAY_MS = 500;
const TRANSIENT_RENAME_ERROR_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
const LEASE_LOCK_ACQUIRE_TIMEOUT_MS = 2_500;
const LEASE_LOCK_RELEASE_TIMEOUT_MS = 2_500;
const LEASE_LOCK_NAME_PREFIX = "janvim-exhibition-run-lease-";

const runIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9._-]{1,64}$/)
  .refine(
    (value) => !BRIDGE_TOKEN_PATTERN.test(value),
    "run identity must not contain a bridge token",
  );
const controllerRunIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9._-]{1,96}$/)
  .refine(
    (value) => !BRIDGE_TOKEN_PATTERN.test(value),
    "controller run identity must not contain a bridge token",
  );
const positiveSafeIntegerSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const utcTimestampSchema = z
  .string()
  .min(20)
  .max(40)
  .refine(isValidUtcTimestamp, "creation time must be a valid UTC timestamp");
const hashSchema = z.string().regex(HASH_PATTERN);
const controllerIdentitySchema = z
  .object({
    pid: positiveSafeIntegerSchema,
    startedAtUtc: utcTimestampSchema,
  })
  .strict();
const janvimIdentitySchema = z
  .object({
    pid: positiveSafeIntegerSchema,
    startedAtUtc: utcTimestampSchema,
    hwnd: z
      .string()
      .regex(/^0x[0-9A-Fa-f]{1,16}$/)
      .refine((value) => !/^0x0+$/i.test(value), "HWND must be nonzero"),
    executableRelativePath: z.literal("janvim-core.exe"),
    executableSha256: hashSchema,
  })
  .strict();
const runLeaseSchema = z
  .object({
    schema: z.literal(1),
    runId: runIdSchema,
    controllerRunId: controllerRunIdSchema,
    generationId: positiveSafeIntegerSchema,
    controller: controllerIdentitySchema,
    janvim: janvimIdentitySchema,
  })
  .strict();

class DefiniteIdentityMismatchError extends Error {}

export async function writeRunLeaseAtomic(
  path: string,
  lease: RunLease,
): Promise<void> {
  const destinationPath = validateLeasePath(path);
  const parsedLease = parseRunLease(lease);
  const serialized = serializeRunLease(parsedLease);

  await withLeaseLock(destinationPath, async () => {
    const temporaryPath = await writeExclusiveTemporaryFile(
      destinationPath,
      serialized,
    );
    let ownsTemporary = true;
    try {
      await requireAbsentLeaseDestination(destinationPath);
      await publishTemporaryExclusively(temporaryPath, destinationPath);
      ownsTemporary = false;
    } finally {
      if (ownsTemporary) await fs.rm(temporaryPath, { force: true });
    }
  });
}

async function publishTemporaryExclusively(
  temporaryPath: string,
  destinationPath: string,
): Promise<void> {
  try {
    await fs.link(temporaryPath, destinationPath);
  } catch (error) {
    if (hasErrorCode(error, "EEXIST")) {
      throw new Error("run-lease-already-exists");
    }
    throw error;
  }
  await fs.rm(temporaryPath);
}

export async function replaceRunLeaseGenerationAtomic(
  path: string,
  expected: RunLease,
  nextGenerationId: number,
): Promise<RunLease> {
  const destinationPath = validateLeasePath(path);
  const parsedExpected = parseRunLease(expected);
  if (
    !Number.isSafeInteger(nextGenerationId) ||
    nextGenerationId <= parsedExpected.generationId
  ) {
    throw new Error("run-lease-generation-must-increase");
  }

  const replacement = parseRunLease({
    ...parsedExpected,
    generationId: nextGenerationId,
  });
  const serialized = serializeRunLease(replacement);

  await withLeaseLock(destinationPath, async () => {
    const temporaryPath = await writeExclusiveTemporaryFile(
      destinationPath,
      serialized,
    );
    let ownsTemporary = true;
    try {
      await replaceLeaseFileWithRetry(
        temporaryPath,
        destinationPath,
        parsedExpected,
      );
      ownsTemporary = false;
    } finally {
      if (ownsTemporary) await fs.rm(temporaryPath, { force: true });
    }
  });

  return replacement;
}

export async function verifyRunLeaseIdentity(
  lease: RunLease,
  expected: LeaseVerificationInput,
): Promise<"identical" | "not-identical" | "unprovable"> {
  const parsedLeaseResult = runLeaseSchema.safeParse(lease);
  if (!parsedLeaseResult.success) return "unprovable";
  const parsedLease = parsedLeaseResult.data as RunLease;
  if (!isVerificationInputShapeValid(expected)) return "unprovable";

  if (parsedLease.janvim.executableSha256 !== expected.expectedExecutableSha256) {
    return "not-identical";
  }

  let unprovable = false;
  let processExecutablePath: string | undefined;

  let processInspection: LeaseProcessInspection | undefined;
  try {
    processInspection = await expected.adapter.inspectProcess(parsedLease.janvim.pid);
  } catch {
    unprovable = true;
  }
  if (processInspection !== undefined) {
    if (processInspection.status === "not-found") return "not-identical";
    if (processInspection.status === "unprovable") {
      unprovable = true;
    } else if (processInspection.status === "found") {
      if (!isPositiveSafeInteger(processInspection.pid)) {
        unprovable = true;
      } else if (processInspection.pid !== parsedLease.janvim.pid) {
        return "not-identical";
      }

      if (typeof processInspection.startedAtUtc !== "string") {
        unprovable = true;
      } else if (processInspection.startedAtUtc !== parsedLease.janvim.startedAtUtc) {
        return "not-identical";
      }

      if (
        typeof processInspection.executablePath !== "string" ||
        processInspection.executablePath.length === 0 ||
        processInspection.executablePath.length > MAX_PATH_CHARACTERS ||
        !isAbsolute(processInspection.executablePath)
      ) {
        unprovable = true;
      } else {
        processExecutablePath = processInspection.executablePath;
      }
    } else {
      unprovable = true;
    }
  } else {
    unprovable = true;
  }

  let windowInspection: LeaseWindowInspection | undefined;
  try {
    windowInspection = await expected.adapter.inspectWindowOwner(parsedLease.janvim.hwnd);
  } catch {
    unprovable = true;
  }
  if (windowInspection !== undefined) {
    if (windowInspection.status === "not-found") return "not-identical";
    if (windowInspection.status === "unprovable") {
      unprovable = true;
    } else if (windowInspection.status === "found") {
      if (!isPositiveSafeInteger(windowInspection.ownerPid)) {
        unprovable = true;
      } else if (windowInspection.ownerPid !== parsedLease.janvim.pid) {
        return "not-identical";
      }
    } else {
      unprovable = true;
    }
  } else {
    unprovable = true;
  }

  let runtimeRoot: string | undefined;
  let runtimeExecutablePath: string | undefined;
  try {
    runtimeRoot = await fs.realpath(expected.runtimeRoot);
    runtimeExecutablePath = await fs.realpath(
      resolve(expected.runtimeRoot, parsedLease.janvim.executableRelativePath),
    );
    const executableRelativePath = relative(runtimeRoot, runtimeExecutablePath);
    if (
      !isContainedRelativePath(executableRelativePath) ||
      !pathTextEqual(
        executableRelativePath,
        parsedLease.janvim.executableRelativePath,
      )
    ) {
      return "not-identical";
    }
  } catch (error) {
    if (classifyFileProofError(error) === "not-identical") {
      return "not-identical";
    }
    unprovable = true;
  }

  if (runtimeRoot !== undefined && runtimeExecutablePath !== undefined) {
    if (processExecutablePath !== undefined) {
      try {
        const resolvedProcessExecutablePath = await fs.realpath(processExecutablePath);
        const processRelativePath = relative(runtimeRoot, resolvedProcessExecutablePath);
        if (
          !isContainedRelativePath(processRelativePath) ||
          !pathTextEqual(resolvedProcessExecutablePath, runtimeExecutablePath) ||
          !pathTextEqual(
            processRelativePath,
            parsedLease.janvim.executableRelativePath,
          )
        ) {
          return "not-identical";
        }
      } catch (error) {
        if (classifyFileProofError(error) === "not-identical") {
          return "not-identical";
        }
        unprovable = true;
      }
    }

    try {
      const currentHash = await hashExecutableBounded(runtimeExecutablePath);
      if (currentHash !== parsedLease.janvim.executableSha256) {
        return "not-identical";
      }
    } catch (error) {
      if (classifyFileProofError(error) === "not-identical") {
        return "not-identical";
      }
      unprovable = true;
    }
  }

  return unprovable ? "unprovable" : "identical";
}

export async function removeRunLeaseAfterSettlement(
  path: string,
  lease: RunLease,
): Promise<boolean> {
  let destinationPath: string;
  let parsedExpected: RunLease;
  try {
    destinationPath = validateLeasePath(path);
    parsedExpected = parseRunLease(lease);
  } catch {
    return false;
  }

  try {
    return await withLeaseLock(destinationPath, async () => {
      let current: RunLease;
      try {
        current = await readRunLeaseBounded(destinationPath);
      } catch {
        return false;
      }
      if (!leasesEqual(current, parsedExpected)) return false;
      if (!isProcessSettled(parsedExpected.janvim.pid)) return false;

      let currentImmediatelyBeforeRemoval: RunLease;
      try {
        currentImmediatelyBeforeRemoval = await readRunLeaseBounded(destinationPath);
      } catch {
        return false;
      }
      if (!leasesEqual(currentImmediatelyBeforeRemoval, parsedExpected)) return false;

      try {
        await fs.unlink(destinationPath);
        return true;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

function isValidUtcTimestamp(value: string): boolean {
  const match = UTC_TIMESTAMP_PATTERN.exec(value);
  if (match === null) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
  );
}

function parseRunLease(value: unknown): RunLease {
  const parsed = runLeaseSchema.parse(value) as RunLease;
  if (Buffer.byteLength(serializeRunLease(parsed), "utf8") > MAX_LEASE_BYTES) {
    throw new Error("run-lease-too-large");
  }
  return parsed;
}

function serializeRunLease(lease: RunLease): string {
  return `${JSON.stringify(lease, null, 2)}\n`;
}

function validateLeasePath(path: string): string {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.length > MAX_PATH_CHARACTERS ||
    !isAbsolute(path)
  ) {
    throw new Error("run-lease-path-invalid");
  }
  return path;
}

async function withLeaseLock<T>(
  leasePath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lock = await acquireLeaseLock(leasePath);

  try {
    return await operation();
  } finally {
    await releaseLeaseLock(lock);
  }
}

interface LeaseLock {
  server: Server;
  sockets: Set<Socket>;
  runtimeError: () => unknown;
}

async function acquireLeaseLock(leasePath: string): Promise<LeaseLock> {
  const endpoint = leaseLockEndpoint(leasePath);
  const sockets = new Set<Socket>();
  let postListenError: unknown;
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.once("error", () => socket.destroy());
    socket.destroy();
  });
  server.maxConnections = 1;

  await new Promise<void>((resolveLock, rejectLock) => {
    let settled = false;
    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      abortController.abort();
      server.unref();
      rejectLock(new Error("run-lease-lock-acquire-timeout"));
    }, LEASE_LOCK_ACQUIRE_TIMEOUT_MS);
    const cleanup = (): void => {
      clearTimeout(timeout);
      server.off("error", onError);
      server.off("listening", onListening);
    };
    const onError = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      server.unref();
      rejectLock(
        hasErrorCode(error, "EADDRINUSE")
          ? new Error("run-lease-busy")
          : error,
      );
    };
    const onListening = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      server.on("error", (error) => {
        postListenError ??= error;
      });
      resolveLock();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    try {
      server.listen({
        path: endpoint,
        exclusive: true,
        signal: abortController.signal,
      });
    } catch (error) {
      onError(error);
    }
  });

  return {
    server,
    sockets,
    runtimeError: () => postListenError,
  };
}

async function releaseLeaseLock(lock: LeaseLock): Promise<void> {
  for (const socket of lock.sockets) socket.destroy();

  await new Promise<void>((resolveRelease, rejectRelease) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      for (const socket of lock.sockets) socket.destroy();
      lock.server.unref();
      rejectRelease(new Error("run-lease-lock-release-timeout"));
    }, LEASE_LOCK_RELEASE_TIMEOUT_MS);
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const runtimeError = lock.runtimeError();
      if (error !== undefined) {
        rejectRelease(error);
      } else if (runtimeError !== undefined) {
        rejectRelease(runtimeError);
      } else {
        resolveRelease();
      }
    };

    try {
      lock.server.close(finish);
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function leaseLockEndpoint(leasePath: string): string {
  const normalizedPath = normalize(resolve(leasePath));
  const lockIdentity =
    process.platform === "win32"
      ? normalizedPath.toLocaleLowerCase("en-US")
      : normalizedPath;
  const digest = createHash("sha256").update(lockIdentity, "utf8").digest("hex");
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\${LEASE_LOCK_NAME_PREFIX}${digest}`;
  }
  if (process.platform === "linux") {
    return `\0${LEASE_LOCK_NAME_PREFIX}${digest}`;
  }
  throw new Error("run-lease-lock-platform-unsupported");
}

async function writeExclusiveTemporaryFile(
  leasePath: string,
  contents: string,
): Promise<string> {
  const temporaryPath = join(
    dirname(leasePath),
    `.${basename(leasePath)}-${process.pid}-${randomUUID()}.tmp`,
  );
  let handle;
  let ownsTemporary = false;
  try {
    handle = await fs.open(temporaryPath, "wx", 0o600);
    ownsTemporary = true;
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    return temporaryPath;
  } catch (error) {
    if (handle !== undefined) await handle.close();
    if (ownsTemporary) await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

async function requireAbsentLeaseDestination(path: string): Promise<void> {
  try {
    await fs.lstat(path);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return;
    throw error;
  }
  throw new Error("run-lease-already-exists");
}

async function readRunLeaseBounded(path: string): Promise<RunLease> {
  const handle = await fs.open(path, "r");
  try {
    const bytes = Buffer.alloc(MAX_LEASE_BYTES + 1);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(
        bytes,
        offset,
        bytes.byteLength - offset,
        offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > MAX_LEASE_BYTES) throw new Error("run-lease-too-large");
    return parseRunLease(JSON.parse(UTF8_DECODER.decode(bytes.subarray(0, offset))));
  } finally {
    await handle.close();
  }
}

async function replaceLeaseFileWithRetry(
  temporaryPath: string,
  destinationPath: string,
  expected: RunLease,
): Promise<void> {
  for (let attempt = 1; attempt <= ATOMIC_RENAME_ATTEMPTS; attempt += 1) {
    let current: RunLease;
    try {
      current = await readRunLeaseBounded(destinationPath);
    } catch {
      throw new Error("run-lease-compare-and-swap-failed");
    }
    if (!leasesEqual(current, expected)) {
      throw new Error("run-lease-compare-and-swap-failed");
    }

    try {
      await fs.rename(temporaryPath, destinationPath);
      return;
    } catch (error) {
      if (
        !isTransientRenameError(error) ||
        attempt === ATOMIC_RENAME_ATTEMPTS
      ) {
        throw error;
      }
      await delay(ATOMIC_RENAME_RETRY_DELAY_MS * attempt);
    }
  }
}

function isTransientRenameError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    TRANSIENT_RENAME_ERROR_CODES.has(error.code)
  );
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolveDelay) => {
    setTimeout(resolveDelay, milliseconds);
  });
}

function leasesEqual(left: RunLease, right: RunLease): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isVerificationInputShapeValid(input: LeaseVerificationInput): boolean {
  return (
    input !== null &&
    typeof input === "object" &&
    typeof input.runtimeRoot === "string" &&
    input.runtimeRoot.length > 0 &&
    input.runtimeRoot.length <= MAX_PATH_CHARACTERS &&
    isAbsolute(input.runtimeRoot) &&
    typeof input.expectedExecutableSha256 === "string" &&
    HASH_PATTERN.test(input.expectedExecutableSha256) &&
    input.adapter !== null &&
    typeof input.adapter === "object" &&
    typeof input.adapter.inspectProcess === "function" &&
    typeof input.adapter.inspectWindowOwner === "function"
  );
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value > 0;
}

function isContainedRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    path !== ".." &&
    !path.startsWith(`..${sep}`) &&
    !isAbsolute(path)
  );
}

function pathTextEqual(left: string, right: string): boolean {
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  return process.platform === "win32"
    ? normalizedLeft.toLocaleLowerCase("en-US") ===
        normalizedRight.toLocaleLowerCase("en-US")
    : normalizedLeft === normalizedRight;
}

async function hashExecutableBounded(path: string): Promise<string> {
  const handle = await fs.open(path, "r");
  try {
    const statistics = await handle.stat();
    if (
      !statistics.isFile() ||
      !Number.isSafeInteger(statistics.size) ||
      statistics.size < 0 ||
      statistics.size > MAX_EXECUTABLE_BYTES
    ) {
      throw new DefiniteIdentityMismatchError("executable-file-invalid");
    }

    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
    let position = 0;
    while (position < statistics.size) {
      const bytesToRead = Math.min(buffer.byteLength, statistics.size - position);
      const { bytesRead } = await handle.read(buffer, 0, bytesToRead, position);
      if (bytesRead === 0) {
        throw new DefiniteIdentityMismatchError("executable-file-changed");
      }
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }

    const extraByte = Buffer.allocUnsafe(1);
    const { bytesRead: extraBytesRead } = await handle.read(
      extraByte,
      0,
      1,
      statistics.size,
    );
    if (extraBytesRead !== 0) {
      throw new DefiniteIdentityMismatchError("executable-file-changed");
    }
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}

function classifyFileProofError(
  error: unknown,
): "not-identical" | "unprovable" {
  if (error instanceof DefiniteIdentityMismatchError) return "not-identical";
  if (
    hasErrorCode(error, "ENOENT") ||
    hasErrorCode(error, "ENOTDIR") ||
    hasErrorCode(error, "EISDIR")
  ) {
    return "not-identical";
  }
  return "unprovable";
}

function isProcessSettled(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return hasErrorCode(error, "ESRCH");
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === code
  );
}
