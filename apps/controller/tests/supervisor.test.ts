import { describe, expect, it } from "vitest";

import * as boundedLogModule from "../src/bounded-log.ts";
import * as supervisorModule from "../src/supervisor.ts";
import {
  BoundedLog,
  DEFAULT_LOG_FILE_BYTES,
  DEFAULT_LOG_TOTAL_BYTES,
  type BoundedLogOptions,
  type LogStorage,
  type RunLogStream,
} from "../src/bounded-log.ts";

type RestartDecision =
  | { allowed: true; attempt: 1 | 2 | 3; delayMs: 1_000 | 2_000 | 4_000 }
  | { allowed: false; reason: "restart-limit" };

type RestartBudgetInstance = {
  reserve(nowMs: number): RestartDecision;
  diagnostics(nowMs: number): { attemptsInWindow: number };
};

type GenerationGateInstance = {
  current(): number;
  invalidate(): number;
  isCurrent(generationId: number): boolean;
};

type SupervisorPolicyModule = {
  RestartBudget?: new () => RestartBudgetInstance;
  GenerationGate?: new (initialGenerationId?: number) => GenerationGateInstance;
};

type RunLogBudgetInstance = {
  write(stream: RunLogStream, value: Uint8Array | string): boolean;
  writeJson(stream: RunLogStream, value: Record<string, unknown>): boolean;
  snapshot(): { totalBytes: number; fileCount: number; incomplete: boolean };
};

type RunLogBudgetModule = {
  RunLogBudget?: new (options: BoundedLogOptions) => RunLogBudgetInstance;
};

function newRestartBudget(): RestartBudgetInstance {
  const RestartBudget = (supervisorModule as SupervisorPolicyModule).RestartBudget;
  expect(RestartBudget).toBeTypeOf("function");
  return new RestartBudget!();
}

function newGenerationGate(initialGenerationId?: number): GenerationGateInstance {
  const GenerationGate = (supervisorModule as SupervisorPolicyModule).GenerationGate;
  expect(GenerationGate).toBeTypeOf("function");
  return new GenerationGate!(initialGenerationId);
}

function newRunLogBudget(options: BoundedLogOptions): RunLogBudgetInstance {
  const RunLogBudget = (boundedLogModule as RunLogBudgetModule).RunLogBudget;
  expect(RunLogBudget).toBeTypeOf("function");
  return new RunLogBudget!(options);
}

class MemoryLogStorage implements LogStorage {
  public readonly files = new Map<string, string>();
  public readonly pathsSeen = new Set<string>();

  public append(path: string, text: string): void {
    this.pathsSeen.add(path);
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
    this.pathsSeen.add(to);
    this.files.set(to, value);
    this.files.delete(from);
  }

  public remove(path: string): void {
    this.files.delete(path);
  }
}

class FailOnceLogStorage extends MemoryLogStorage {
  private failNextAppend = true;

  public override append(path: string, text: string): void {
    if (this.failNextAppend) {
      this.failNextAppend = false;
      throw new Error("injected append failure");
    }
    super.append(path, text);
  }
}

describe("pure restart policy", () => {
  it("reserves only the bounded 1/2/4 second attempts", () => {
    const budget = newRestartBudget();

    expect(budget.reserve(0)).toEqual({ allowed: true, attempt: 1, delayMs: 1_000 });
    expect(budget.reserve(1)).toEqual({ allowed: true, attempt: 2, delayMs: 2_000 });
    expect(budget.reserve(2)).toEqual({ allowed: true, attempt: 3, delayMs: 4_000 });
    expect(budget.diagnostics(2)).toEqual({ attemptsInWindow: 3 });
    expect(budget.reserve(3)).toEqual({ allowed: false, reason: "restart-limit" });
    expect(budget.diagnostics(3)).toEqual({ attemptsInWindow: 3 });
  });

  it("expires attempts at the rolling ten-minute boundary", () => {
    const budget = newRestartBudget();
    budget.reserve(0);
    budget.reserve(1);
    budget.reserve(2);

    expect(budget.diagnostics(600_000)).toEqual({ attemptsInWindow: 2 });
    expect(budget.diagnostics(600_003)).toEqual({ attemptsInWindow: 0 });
    expect(budget.reserve(600_003)).toEqual({
      allowed: true,
      attempt: 1,
      delayMs: 1_000,
    });
  });

  it("rejects invalid or decreasing monotonic timestamps without consuming an attempt", () => {
    for (const invalid of [-1, Number.NaN, Infinity, -Infinity]) {
      expect(() => newRestartBudget().reserve(invalid)).toThrow(/monotonic/i);
    }

    const budget = newRestartBudget();
    expect(budget.reserve(10)).toEqual({ allowed: true, attempt: 1, delayMs: 1_000 });
    expect(() => budget.reserve(9)).toThrow(/monotonic/i);
    expect(() => budget.diagnostics(9)).toThrow(/monotonic/i);
    expect(budget.diagnostics(10)).toEqual({ attemptsInWindow: 1 });
  });
});

describe("generation gate", () => {
  it("invalidates the old generation before accepting the new one", () => {
    const gate = newGenerationGate();
    expect(gate.current()).toBe(1);

    const old = gate.current();
    expect(gate.invalidate()).toBe(2);
    expect(gate.isCurrent(old)).toBe(false);
    expect(gate.isCurrent(2)).toBe(true);
    expect(gate.isCurrent(0)).toBe(false);
  });

  it("rejects invalid initial generations and refuses to wrap a safe integer", () => {
    for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity]) {
      expect(() => newGenerationGate(invalid)).toThrow(/generation/i);
    }

    const gate = newGenerationGate(Number.MAX_SAFE_INTEGER);
    expect(() => gate.invalidate()).toThrow(/generation/i);
    expect(gate.current()).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("bounded structured log", () => {
  it("pins production limits to four 8 MiB files totaling at most 32 MiB", () => {
    expect(DEFAULT_LOG_FILE_BYTES).toBe(8 * 1024 * 1024);
    expect(DEFAULT_LOG_TOTAL_BYTES).toBe(32 * 1024 * 1024);
  });

  it("redacts tokens and rotates without exceeding the configured total", () => {
    const storage = new MemoryLogStorage();
    const token = "sensitive-show-token-2026";
    const log = new BoundedLog({
      storage,
      basePath: "show.log",
      secrets: [token],
      maxFileBytes: 100,
      maxTotalBytes: 300,
    });

    for (let index = 0; index < 12; index += 1) {
      log.write({ event: "bridge", index, token, nested: { authorization: token } });
    }

    const combined = [...storage.files.values()].join("");
    const total = [...storage.files.keys()].reduce((sum, path) => sum + storage.size(path), 0);
    expect(combined).not.toContain(token);
    expect(combined).toContain("[REDACTED]");
    expect(total).toBeLessThanOrEqual(300);
    expect(storage.files.size).toBeLessThanOrEqual(3);
  });

  it("rejects one entry larger than a log file instead of growing without bound", () => {
    const log = new BoundedLog({
      storage: new MemoryLogStorage(),
      basePath: "show.log",
      secrets: [],
      maxFileBytes: 32,
      maxTotalBytes: 64,
    });

    expect(() => log.write({ message: "x".repeat(100) })).toThrow(/entry exceeds/i);
  });
});

describe("shared run log budget", () => {
  it("shares one bounded quota across fixed stream rotation names for 1000 restarted-child writes", () => {
    const storage = new MemoryLogStorage();
    const streams = [
      "controller",
      "recovery",
      "janvim-stdout",
      "janvim-stderr",
    ] as const satisfies readonly RunLogStream[];
    const bridgeToken = `bridge-token-${"x".repeat(120)}`;
    const privatePath = "D:\\private\\show-secret";
    const budget = newRunLogBudget({
      storage,
      basePath: "run.log",
      secrets: [bridgeToken, privatePath],
      maxFileBytes: 100,
      maxTotalBytes: 300,
    });
    let pathsAfterWarmup: string[] | undefined;

    for (let index = 0; index < 1_000; index += 1) {
      const stream = streams[index % streams.length]!;
      const restart = Math.floor(index / streams.length);
      const record = {
        restart,
        generation: restart + 1,
        token: bridgeToken,
        path: privatePath,
      };
      const written =
        index % 3 === 0
          ? budget.writeJson(stream, record)
          : index % 3 === 1
            ? budget.write(
                stream,
                `restart=${restart};generation=${restart + 1};token=${bridgeToken};path=${privatePath}\n`,
              )
            : budget.write(
                stream,
                Buffer.from(
                  `restart=${restart};generation=${restart + 1};token=${bridgeToken};path=${privatePath}\n`,
                  "utf8",
                ),
              );

      expect(written).toBe(true);
      const totalBytes = [...storage.files.keys()].reduce(
        (total, path) => total + storage.size(path),
        0,
      );
      for (const path of storage.files.keys()) {
        expect(storage.size(path)).toBeLessThanOrEqual(100);
      }
      expect(totalBytes).toBeLessThanOrEqual(300);
      expect(budget.snapshot()).toEqual({
        totalBytes,
        fileCount: storage.files.size,
        incomplete: false,
      });

      if (index === 99) pathsAfterWarmup = [...storage.pathsSeen].sort();
    }

    const combined = [...storage.files.values()].join("");
    expect(combined).not.toContain(bridgeToken);
    expect(combined).not.toContain(privatePath);
    expect(combined).toContain("[REDACTED]");
    expect(storage.pathsSeen.size).toBeLessThanOrEqual(streams.length * 3);
    expect([...storage.pathsSeen].sort()).toEqual(pathsAfterWarmup);
    for (const path of storage.pathsSeen) {
      expect(path).toMatch(
        /^run\.log\.(controller|recovery|janvim-stdout|janvim-stderr)(?:\.[12])?$/,
      );
      expect(path).not.toMatch(/generation|restart/i);
    }
  });

  it("returns false and marks logging incomplete for an oversized record", () => {
    const storage = new MemoryLogStorage();
    const budget = newRunLogBudget({
      storage,
      basePath: "run.log",
      secrets: [],
      maxFileBytes: 32,
      maxTotalBytes: 64,
    });

    expect(budget.writeJson("controller", { message: "x".repeat(100) })).toBe(false);
    expect(storage.files.size).toBe(0);
    expect(budget.snapshot()).toEqual({ totalBytes: 0, fileCount: 0, incomplete: true });
  });

  it("redacts JSON-escaped supplied secrets before byte accounting and writing", () => {
    const storage = new MemoryLogStorage();
    const secretPath = "D:\\private\\show-secret";
    const budget = newRunLogBudget({
      storage,
      basePath: "run.log",
      secrets: [secretPath],
      maxFileBytes: 100,
      maxTotalBytes: 300,
    });

    expect(budget.writeJson("controller", { path: secretPath })).toBe(true);
    expect([...storage.files.values()].join("")).toBe('{"path":"[REDACTED]"}\n');
  });

  it("contains storage errors without throwing and keeps the incomplete marker sticky", () => {
    const storage = new FailOnceLogStorage();
    const budget = newRunLogBudget({
      storage,
      basePath: "run.log",
      secrets: [],
      maxFileBytes: 100,
      maxTotalBytes: 300,
    });

    expect(budget.write("recovery", "first\n")).toBe(false);
    expect(budget.snapshot()).toEqual({ totalBytes: 0, fileCount: 0, incomplete: true });
    expect(budget.write("recovery", "second\n")).toBe(true);
    expect(budget.snapshot()).toEqual({ totalBytes: 7, fileCount: 1, incomplete: true });
  });
});
