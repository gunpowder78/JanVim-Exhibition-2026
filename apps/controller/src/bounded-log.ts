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
