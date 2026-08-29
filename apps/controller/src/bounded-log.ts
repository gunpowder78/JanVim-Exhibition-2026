import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname } from "node:path";

export const DEFAULT_LOG_FILE_BYTES = 8 * 1024 * 1024;
export const DEFAULT_LOG_TOTAL_BYTES = 32 * 1024 * 1024;

export interface LogStorage {
  append(path: string, text: string): void;
  size(path: string): number;
  exists(path: string): boolean;
  rename(from: string, to: string): void;
  remove(path: string): void;
}

export interface BoundedLogOptions {
  storage: LogStorage;
  basePath: string;
  secrets: readonly string[];
  maxFileBytes?: number;
  maxTotalBytes?: number;
}

export type RunLogStream = "controller" | "recovery" | "janvim-stdout" | "janvim-stderr";

const RUN_LOG_STREAMS: readonly RunLogStream[] = [
  "controller",
  "recovery",
  "janvim-stdout",
  "janvim-stderr",
];

export class BoundedLog {
  private readonly storage: LogStorage;
  private readonly basePath: string;
  private readonly secrets: string[];
  private readonly maxFileBytes: number;
  private readonly maxTotalBytes: number;
  private readonly maxFiles: number;

  public constructor(options: BoundedLogOptions) {
    this.maxFileBytes = positiveInteger(options.maxFileBytes ?? DEFAULT_LOG_FILE_BYTES, "file");
    this.maxTotalBytes = positiveInteger(options.maxTotalBytes ?? DEFAULT_LOG_TOTAL_BYTES, "total");
    if (this.maxTotalBytes < this.maxFileBytes) {
      throw new Error("Log total limit must be at least one file");
    }
    if (options.basePath.length === 0) throw new Error("Log base path is required");
    if (options.secrets.length > 32) throw new Error("Log secret list is bounded to 32 values");

    this.storage = options.storage;
    this.basePath = options.basePath;
    this.secrets = [...options.secrets]
      .filter((secret) => secret.length > 0)
      .sort((left, right) => right.length - left.length);
    this.maxFiles = Math.max(1, Math.floor(this.maxTotalBytes / this.maxFileBytes));
  }

  public write(entry: Record<string, unknown>): void {
    let line = `${JSON.stringify(entry)}\n`;
    for (const secret of this.secrets) line = line.split(secret).join("[REDACTED]");

    const lineBytes = Buffer.byteLength(line, "utf8");
    if (lineBytes > this.maxFileBytes) {
      throw new Error("Log entry exceeds per-file limit");
    }
    if (this.storage.size(this.basePath) + lineBytes > this.maxFileBytes) {
      this.rotate();
    }
    this.storage.append(this.basePath, line);
    this.trimToTotalLimit();
  }

  private rotate(): void {
    if (this.maxFiles === 1) {
      this.storage.remove(this.basePath);
      return;
    }

    this.storage.remove(this.rotatedPath(this.maxFiles - 1));
    for (let index = this.maxFiles - 2; index >= 1; index -= 1) {
      const source = this.rotatedPath(index);
      if (!this.storage.exists(source)) continue;
      const destination = this.rotatedPath(index + 1);
      this.storage.remove(destination);
      this.storage.rename(source, destination);
    }
    if (this.storage.exists(this.basePath)) {
      this.storage.remove(this.rotatedPath(1));
      this.storage.rename(this.basePath, this.rotatedPath(1));
    }
  }

  private trimToTotalLimit(): void {
    let total = this.totalSize();
    for (let index = this.maxFiles - 1; index >= 1 && total > this.maxTotalBytes; index -= 1) {
      const path = this.rotatedPath(index);
      if (!this.storage.exists(path)) continue;
      this.storage.remove(path);
      total = this.totalSize();
    }
  }

  private totalSize(): number {
    let total = this.storage.size(this.basePath);
    for (let index = 1; index < this.maxFiles; index += 1) {
      total += this.storage.size(this.rotatedPath(index));
    }
    return total;
  }

  private rotatedPath(index: number): string {
    return `${this.basePath}.${index}`;
  }
}

export class RunLogBudget {
  private readonly storage: LogStorage;
  private readonly basePath: string;
  private readonly secrets: string[];
  private readonly maxFileBytes: number;
  private readonly maxTotalBytes: number;
  private readonly rotationSlots: number;
  private readonly activeSlots: Record<RunLogStream, number> = {
    controller: 0,
    recovery: 0,
    "janvim-stdout": 0,
    "janvim-stderr": 0,
  };
  private totalBytes = 0;
  private fileCount = 0;
  private incomplete = false;
  private initialized = false;
  private evictionStreamIndex = 0;
  private evictionSlot = 0;

  public constructor(options: BoundedLogOptions) {
    this.maxFileBytes = positiveInteger(options.maxFileBytes ?? DEFAULT_LOG_FILE_BYTES, "file");
    this.maxTotalBytes = positiveInteger(options.maxTotalBytes ?? DEFAULT_LOG_TOTAL_BYTES, "total");
    if (this.maxTotalBytes < this.maxFileBytes) {
      throw new Error("Log total limit must be at least one file");
    }
    if (options.basePath.length === 0) throw new Error("Log base path is required");
    if (options.secrets.length > 32) throw new Error("Log secret list is bounded to 32 values");

    this.storage = options.storage;
    this.basePath = options.basePath;
    this.secrets = options.secrets
      .filter((secret) => secret.length > 0)
      .flatMap((secret) => {
        const jsonEscaped = JSON.stringify(secret).slice(1, -1);
        return jsonEscaped === secret ? [secret] : [secret, jsonEscaped];
      })
      .sort((left, right) => right.length - left.length);
    this.rotationSlots = Math.max(1, Math.ceil(this.maxTotalBytes / this.maxFileBytes));
  }

  public write(stream: RunLogStream, value: Uint8Array | string): boolean {
    try {
      if (!isRunLogStream(stream)) return this.fail();
      this.initializeLedger();

      let text = typeof value === "string" ? value : Buffer.from(value).toString("utf8");
      for (const secret of this.secrets) text = text.split(secret).join("[REDACTED]");

      const textBytes = Buffer.byteLength(text, "utf8");
      if (textBytes > this.maxFileBytes) return this.fail();

      let slot = this.activeSlots[stream];
      let path = this.streamPath(stream, slot);
      if (this.storage.size(path) + textBytes > this.maxFileBytes) {
        slot = (slot + 1) % this.rotationSlots;
        this.activeSlots[stream] = slot;
        path = this.streamPath(stream, slot);
        this.removeTracked(path);
      }

      if (!this.evictUntilFits(textBytes)) return this.fail();

      const existed = this.storage.exists(path);
      this.storage.append(path, text);
      this.totalBytes += textBytes;
      if (!existed) this.fileCount += 1;
      return true;
    } catch {
      return this.fail();
    }
  }

  public writeJson(stream: RunLogStream, value: Record<string, unknown>): boolean {
    try {
      return this.write(stream, `${JSON.stringify(value)}\n`);
    } catch {
      return this.fail();
    }
  }

  public snapshot(): { totalBytes: number; fileCount: number; incomplete: boolean } {
    return {
      totalBytes: this.totalBytes,
      fileCount: this.fileCount,
      incomplete: this.incomplete,
    };
  }

  private initializeLedger(): void {
    if (this.initialized) return;

    let totalBytes = 0;
    let fileCount = 0;
    for (const stream of RUN_LOG_STREAMS) {
      for (let slot = 0; slot < this.rotationSlots; slot += 1) {
        const path = this.streamPath(stream, slot);
        if (!this.storage.exists(path)) continue;
        totalBytes += this.storage.size(path);
        fileCount += 1;
      }
    }
    this.totalBytes = totalBytes;
    this.fileCount = fileCount;
    this.initialized = true;
  }

  private evictUntilFits(bytes: number): boolean {
    const startStreamIndex = this.evictionStreamIndex;
    const startSlot = this.evictionSlot;
    let first = true;

    while (this.totalBytes + bytes > this.maxTotalBytes) {
      if (
        !first &&
        this.evictionStreamIndex === startStreamIndex &&
        this.evictionSlot === startSlot
      ) {
        return false;
      }
      first = false;

      const stream = RUN_LOG_STREAMS[this.evictionStreamIndex]!;
      const path = this.streamPath(stream, this.evictionSlot);
      this.advanceEvictionCursor();
      this.removeTracked(path);
    }
    return true;
  }

  private advanceEvictionCursor(): void {
    this.evictionStreamIndex += 1;
    if (this.evictionStreamIndex < RUN_LOG_STREAMS.length) return;

    this.evictionStreamIndex = 0;
    this.evictionSlot = (this.evictionSlot + 1) % this.rotationSlots;
  }

  private removeTracked(path: string): void {
    if (!this.storage.exists(path)) return;
    const bytes = this.storage.size(path);
    this.storage.remove(path);
    this.totalBytes -= bytes;
    this.fileCount -= 1;
  }

  private streamPath(stream: RunLogStream, slot: number): string {
    const rotation = slot === 0 ? "" : `.${slot}`;
    return `${this.basePath}.${stream}${rotation}`;
  }

  private fail(): false {
    this.incomplete = true;
    return false;
  }
}

export class FileLogStorage implements LogStorage {
  public append(path: string, text: string): void {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, text, { encoding: "utf8" });
  }

  public size(path: string): number {
    return existsSync(path) ? statSync(path).size : 0;
  }

  public exists(path: string): boolean {
    return existsSync(path);
  }

  public rename(from: string, to: string): void {
    renameSync(from, to);
  }

  public remove(path: string): void {
    rmSync(path, { force: true });
  }
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Log ${label} limit must be a positive integer`);
  }
  return value;
}

function isRunLogStream(value: string): value is RunLogStream {
  return (
    value === "controller" ||
    value === "recovery" ||
    value === "janvim-stdout" ||
    value === "janvim-stderr"
  );
}
