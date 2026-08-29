import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs/promises";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, normalize, resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  removeRunLeaseAfterSettlement,
  replaceRunLeaseGenerationAtomic,
  verifyRunLeaseIdentity,
  writeRunLeaseAtomic,
  type LeaseProcessInspection,
  type LeaseVerificationInput,
  type LeaseWindowInspection,
  type RunLease,
} from "../src/run-lease.ts";

const fixtureRoots = new Set<string>();

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const root of fixtureRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  fixtureRoots.clear();
});

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  fixtureRoots.add(root);
  return root;
}

function executeTimeoutsImmediately(): number[] {
  const delays: number[] = [];
  const retryDelays = new Set([500, 1_000, 1_500, 2_000]);
  const realSetTimeout = globalThis.setTimeout.bind(globalThis);
  const immediateTimeout = (
    callback: (...arguments_: unknown[]) => void,
    delayMs?: number,
    ...arguments_: unknown[]
  ): ReturnType<typeof setTimeout> => {
    if (delayMs !== undefined && retryDelays.has(delayMs)) {
      delays.push(delayMs);
      callback(...arguments_);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }
    return realSetTimeout(callback, delayMs, ...arguments_);
  };
  vi.spyOn(globalThis, "setTimeout").mockImplementation(
    immediateTimeout as typeof setTimeout,
  );
  return delays;
}

function leaseLockDigest(path: string): string {
  const normalizedPath = normalize(resolve(path));
  const lockIdentity =
    process.platform === "win32"
      ? normalizedPath.toLocaleLowerCase("en-US")
      : normalizedPath;
  return createHash("sha256").update(lockIdentity, "utf8").digest("hex");
}

async function startExternalLeaseLockOwner(path: string): Promise<ChildProcess> {
  const script = [
    'const net = require("node:net");',
    "const digest = process.argv[1];",
    "const endpoint = process.platform === \"win32\"",
    '  ? "\\\\\\\\.\\\\pipe\\\\janvim-exhibition-run-lease-" + digest',
    '  : "\\\\0janvim-exhibition-run-lease-" + digest;',
    "const server = net.createServer((socket) => socket.destroy());",
    "server.once(\"error\", (error) => {",
    "  process.stderr.write(String(error && error.stack ? error.stack : error));",
    "  process.exit(2);",
    "});",
    "server.listen({ path: endpoint, exclusive: true }, () => {",
    '  process.stdout.write("locked\\n");',
    "});",
  ].join("\n");
  const child = spawn(process.execPath, ["-e", script, leaseLockDigest(path)], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const stdout = child.stdout;
  const stderr = child.stderr;
  if (stdout === null || stderr === null) {
    child.kill();
    throw new Error("lease-lock-fixture-missing-pipes");
  }

  stdout.setEncoding("utf8");
  stderr.setEncoding("utf8");
  await new Promise<void>((resolveReady, rejectReady) => {
    let stdoutText = "";
    let stderrText = "";
    const timeout = setTimeout(() => {
      cleanup();
      child.kill();
      rejectReady(
        new Error(`lease-lock-fixture-timeout:\n${stdoutText}\n${stderrText}`),
      );
    }, 2_000);
    const cleanup = (): void => {
      clearTimeout(timeout);
      stdout.off("data", onStdout);
      stderr.off("data", onStderr);
      child.off("exit", onExit);
    };
    const onStdout = (chunk: string): void => {
      stdoutText += chunk;
      if (stdoutText.includes("locked\n")) {
        cleanup();
        resolveReady();
      }
    };
    const onStderr = (chunk: string): void => {
      stderrText += chunk;
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup();
      rejectReady(
        new Error(
          `lease-lock-fixture-exited:${String(code)}:${String(signal)}:\n${stderrText}`,
        ),
      );
    };
    stdout.on("data", onStdout);
    stderr.on("data", onStderr);
    child.once("exit", onExit);
  });
  return child;
}

async function terminateFixtureChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill();
  await exited;
}

function validLease(overrides: Partial<RunLease> = {}): RunLease {
  return {
    schema: 1,
    runId: "show-run-20260830-001",
    controllerRunId: "controller-run-20260830-001",
    generationId: 1,
    controller: {
      pid: 4100,
      startedAtUtc: "2026-08-30T01:02:03.1234567Z",
    },
    janvim: {
      pid: 5100,
      startedAtUtc: "2026-08-30T01:02:04.7654321Z",
      hwnd: "0x000000000000141E",
      executableRelativePath: "janvim-core.exe",
      executableSha256: "a".repeat(64),
    },
    ...overrides,
  };
}

function leaseIdentityBytes(lease: RunLease): string {
  return JSON.stringify({
    schema: lease.schema,
    runId: lease.runId,
    controllerRunId: lease.controllerRunId,
    controller: lease.controller,
    janvim: lease.janvim,
  });
}

interface IdentityFixture {
  runtimeRoot: string;
  executablePath: string;
  executableSha256: string;
  lease: RunLease;
}

function identityFixture(): IdentityFixture {
  const root = temporaryRoot("run-lease-identity-");
  const runtimeRoot = join(root, "runtime", "janvim");
  const executablePath = join(runtimeRoot, "janvim-core.exe");
  mkdirSync(runtimeRoot, { recursive: true });
  const executable = Buffer.from("frozen JanVim executable fixture\n", "utf8");
  writeFileSync(executablePath, executable);
  const executableSha256 = createHash("sha256").update(executable).digest("hex");
  return {
    runtimeRoot,
    executablePath,
    executableSha256,
    lease: validLease({
      janvim: {
        ...validLease().janvim,
        executableSha256,
      },
    }),
  };
}

function verificationInput(
  fixture: IdentityFixture,
  processInspection: LeaseProcessInspection = {
    status: "found",
    pid: fixture.lease.janvim.pid,
    startedAtUtc: fixture.lease.janvim.startedAtUtc,
    executablePath: fixture.executablePath,
  },
  windowInspection: LeaseWindowInspection = {
    status: "found",
    ownerPid: fixture.lease.janvim.pid,
  },
): LeaseVerificationInput {
  return {
    runtimeRoot: fixture.runtimeRoot,
    expectedExecutableSha256: fixture.executableSha256,
    adapter: {
      inspectProcess: async (pid) =>
        pid === fixture.lease.janvim.pid
          ? processInspection
          : { status: "not-found" },
      inspectWindowOwner: async (hwnd) =>
        hwnd === fixture.lease.janvim.hwnd
          ? windowInspection
          : { status: "not-found" },
    },
  };
}

async function settledChildPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], {
    stdio: "ignore",
    windowsHide: true,
  });
  if (child.pid === undefined) throw new Error("fixture-child-missing-pid");
  const pid = child.pid;
  await once(child, "exit");
  return pid;
}

describe("run lease atomic persistence", () => {
  it("writes only the strict bounded token-free lease schema and cleans temporary files", async () => {
    const root = temporaryRoot("run-lease-write-");
    const path = join(root, "run-lease.json");
    const lease = validLease();

    await writeRunLeaseAtomic(path, lease);

    const raw = readFileSync(path, "utf8");
    const stored = JSON.parse(raw) as Record<string, unknown>;
    expect(stored).toEqual(lease);
    expect(Object.keys(stored)).toEqual([
      "schema",
      "runId",
      "controllerRunId",
      "generationId",
      "controller",
      "janvim",
    ]);
    expect(Object.keys(stored.controller as object)).toEqual(["pid", "startedAtUtc"]);
    expect(Object.keys(stored.janvim as object)).toEqual([
      "pid",
      "startedAtUtc",
      "hwnd",
      "executableRelativePath",
      "executableSha256",
    ]);
    expect(Buffer.byteLength(raw, "utf8")).toBeLessThanOrEqual(4_096);
    for (const forbidden of [
      "fixture-secret-bridge-token",
      "D:\\show\\runtime\\janvim",
      "C:\\Users\\operator\\AppData\\Local\\JanVimShow",
      '"title"',
      '"processName"',
    ]) {
      expect(raw).not.toContain(forbidden);
    }
    expect(readdirSync(root)).toEqual(["run-lease.json"]);
  });

  it("preserves a valid 96-byte controller invocation identity", async () => {
    const root = temporaryRoot("run-lease-controller-id-");
    const path = join(root, "run-lease.json");
    const lease = validLease({ controllerRunId: "z".repeat(96) });

    await writeRunLeaseAtomic(path, lease);

    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(lease);
  });

  it("rejects unknown, secret, absolute-path, and out-of-bound fields before writing", async () => {
    const root = temporaryRoot("run-lease-schema-");
    const lease = validLease();
    const invalidLeases: unknown[] = [
      { ...lease, bridgeToken: "fixture-secret-bridge-token" },
      {
        ...lease,
        controller: { ...lease.controller, userRoot: "C:\\Users\\operator" },
      },
      {
        ...lease,
        janvim: {
          ...lease.janvim,
          title: "JanVim",
          processName: "janvim-core",
          runtimeRoot: "D:\\show\\runtime\\janvim",
        },
      },
      { ...lease, runId: "r".repeat(65) },
      { ...lease, runId: `show-${"ab".repeat(24)}` },
      { ...lease, controllerRunId: "controller run with spaces" },
      { ...lease, controllerRunId: "z".repeat(97) },
      { ...lease, controllerRunId: `${"cd".repeat(24)}-controller` },
      { ...lease, generationId: 0 },
      {
        ...lease,
        controller: { ...lease.controller, startedAtUtc: "2026-08-30T01:02:03Z-extra" },
      },
      { ...lease, janvim: { ...lease.janvim, pid: Number.MAX_SAFE_INTEGER + 1 } },
      { ...lease, janvim: { ...lease.janvim, hwnd: "141E" } },
      { ...lease, janvim: { ...lease.janvim, hwnd: "0x0000000000000000" } },
      {
        ...lease,
        janvim: {
          ...lease.janvim,
          executableRelativePath: "D:\\show\\runtime\\janvim\\janvim-core.exe",
        },
      },
      { ...lease, janvim: { ...lease.janvim, executableSha256: "A".repeat(64) } },
    ];

    for (const [index, invalidLease] of invalidLeases.entries()) {
      const path = join(root, `${index}.json`);
      await expect(
        writeRunLeaseAtomic(path, invalidLease as RunLease),
      ).rejects.toThrow();
      expect(existsSync(path)).toBe(false);
    }
    expect(readdirSync(root)).toEqual([]);
  });

  it("never overwrites an existing lease and leaves no same-directory temporary file", async () => {
    const root = temporaryRoot("run-lease-existing-");
    const path = join(root, "run-lease.json");
    writeFileSync(path, "sentinel", "utf8");

    await expect(writeRunLeaseAtomic(path, validLease())).rejects.toThrow(
      /already-exists/i,
    );

    expect(readFileSync(path, "utf8")).toBe("sentinel");
    expect(readdirSync(root)).toEqual(["run-lease.json"]);
  });

  it("never exposes a destination when the atomic publication step fails", async () => {
    const root = temporaryRoot("run-lease-publish-failure-");
    const path = join(root, "run-lease.json");
    const publicationFailure = Object.assign(
      new Error("injected atomic publication failure"),
      { code: "EPERM" },
    );
    vi.spyOn(fs, "rename").mockRejectedValueOnce(publicationFailure);

    await expect(writeRunLeaseAtomic(path, validLease())).rejects.toThrow(
      /atomic publication failure/i,
    );

    expect(existsSync(path)).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  });

  it("allows exactly one winner when initial writers race", async () => {
    const root = temporaryRoot("run-lease-create-race-");
    const path = join(root, "run-lease.json");
    const first = validLease({ runId: "first-run" });
    const second = validLease({ runId: "second-run" });

    const results = await Promise.allSettled([
      writeRunLeaseAtomic(path, first),
      writeRunLeaseAtomic(path, second),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect([first, second]).toContainEqual(JSON.parse(readFileSync(path, "utf8")));
    expect(readdirSync(root)).toEqual(["run-lease.json"]);
  });

  it("uses an OS-released interprocess lock across controller death", async () => {
    const root = temporaryRoot("run-lease-process-lock-");
    const path = join(root, "run-lease.json");
    const owner = await startExternalLeaseLockOwner(path);
    try {
      await expect(writeRunLeaseAtomic(path, validLease())).rejects.toThrow(
        /run-lease-busy/i,
      );
    } finally {
      await terminateFixtureChild(owner);
    }

    await expect(writeRunLeaseAtomic(path, validLease())).resolves.toBeUndefined();
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(validLease());
    expect(readdirSync(root)).toEqual(["run-lease.json"]);
  }, 7_000);

  it("publishes an initial lease in a form that remains atomically replaceable on Windows", async () => {
    const root = temporaryRoot("run-lease-windows-replaceable-");
    const path = join(root, "run-lease.json");
    const expected = validLease();
    const realLink = fs.link.bind(fs);
    const realRename = fs.rename.bind(fs);
    let destinationWasHardLinked = false;
    vi.spyOn(fs, "link").mockImplementation(async (source, destination) => {
      await realLink(source, destination);
      destinationWasHardLinked = true;
    });
    vi.spyOn(fs, "rename").mockImplementation((source, destination) => {
      if (destinationWasHardLinked) {
        return Promise.reject(
          Object.assign(new Error("Windows refused to replace hard-link target"), {
            code: "EPERM",
          }),
        );
      }
      return realRename(source, destination);
    });
    executeTimeoutsImmediately();

    await writeRunLeaseAtomic(path, expected);
    await expect(
      replaceRunLeaseGenerationAtomic(path, expected, 2),
    ).resolves.toEqual({ ...expected, generationId: 2 });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      ...expected,
      generationId: 2,
    });
    expect(readdirSync(root)).toEqual(["run-lease.json"]);
  });
});

describe("run lease generation compare-and-swap", () => {
  it("atomically raises generation while preserving every identity byte-for-byte", async () => {
    const root = temporaryRoot("run-lease-generation-");
    const path = join(root, "run-lease.json");
    const expected = validLease();
    await writeRunLeaseAtomic(path, expected);
    const identityBefore = leaseIdentityBytes(expected);

    const replacement = await replaceRunLeaseGenerationAtomic(path, expected, 7);

    expect(replacement).toEqual({ ...expected, generationId: 7 });
    expect(leaseIdentityBytes(replacement)).toBe(identityBefore);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(replacement);
    expect(readdirSync(root)).toEqual(["run-lease.json"]);
  }, 7_000);

  it("retries a bounded transient Windows rename failure", async () => {
    const root = temporaryRoot("run-lease-generation-retry-");
    const path = join(root, "run-lease.json");
    const expected = validLease();
    await writeRunLeaseAtomic(path, expected);
    const rename = fs.rename.bind(fs);
    const transient = Object.assign(new Error("transient rename lock"), {
      code: "EPERM",
    });
    const renameSpy = vi
      .spyOn(fs, "rename")
      .mockRejectedValueOnce(transient)
      .mockImplementation((source, destination) => rename(source, destination));

    await expect(
      replaceRunLeaseGenerationAtomic(path, expected, 2),
    ).resolves.toEqual({ ...expected, generationId: 2 });
    expect(renameSpy).toHaveBeenCalledTimes(2);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      ...expected,
      generationId: 2,
    });
  }, 7_000);

  it("keeps the old lease after the finite rename retry budget is exhausted", async () => {
    const root = temporaryRoot("run-lease-generation-retry-limit-");
    const path = join(root, "run-lease.json");
    const expected = validLease();
    await writeRunLeaseAtomic(path, expected);
    const transient = Object.assign(new Error("persistent rename lock"), {
      code: "EPERM",
    });
    const renameSpy = vi.spyOn(fs, "rename").mockRejectedValue(transient);
    const retryDelays = executeTimeoutsImmediately();

    await expect(
      replaceRunLeaseGenerationAtomic(path, expected, 2),
    ).rejects.toThrow(/persistent rename lock/i);
    expect(renameSpy).toHaveBeenCalledTimes(5);
    expect(retryDelays).toEqual([500, 1_000, 1_500, 2_000]);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(expected);
    expect(readdirSync(root)).toEqual(["run-lease.json"]);
  });

  it("rechecks the complete expected lease before a rename retry", async () => {
    const root = temporaryRoot("run-lease-generation-retry-cas-");
    const path = join(root, "run-lease.json");
    const expected = validLease();
    const raced = { ...expected, generationId: 9 };
    await writeRunLeaseAtomic(path, expected);
    const transient = Object.assign(new Error("transient rename lock"), {
      code: "EPERM",
    });
    const renameSpy = vi.spyOn(fs, "rename").mockImplementationOnce(async () => {
      writeFileSync(path, `${JSON.stringify(raced, null, 2)}\n`, "utf8");
      throw transient;
    });

    await expect(
      replaceRunLeaseGenerationAtomic(path, expected, 2),
    ).rejects.toThrow(/compare-and-swap/i);
    expect(renameSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(raced);
  });

  it("rejects non-increasing or unsafe generations without changing the lease", async () => {
    const root = temporaryRoot("run-lease-generation-bound-");
    const path = join(root, "run-lease.json");
    const expected = validLease({ generationId: 4 });
    await writeRunLeaseAtomic(path, expected);
    const before = readFileSync(path, "utf8");

    for (const nextGenerationId of [4, 3, 0, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(
        replaceRunLeaseGenerationAtomic(path, expected, nextGenerationId),
      ).rejects.toThrow(/generation/i);
      expect(readFileSync(path, "utf8")).toBe(before);
    }
    expect(readdirSync(root)).toEqual(["run-lease.json"]);
  });

  it("compares the complete expected lease and rejects every stale identity", async () => {
    const root = temporaryRoot("run-lease-cas-stale-");
    const path = join(root, "run-lease.json");
    const current = validLease({ generationId: 3 });
    await writeRunLeaseAtomic(path, current);
    const before = readFileSync(path, "utf8");
    const staleLeases: RunLease[] = [
      { ...current, runId: "other-run" },
      { ...current, controllerRunId: "other-controller-run" },
      { ...current, controller: { ...current.controller, pid: 4101 } },
      {
        ...current,
        controller: {
          ...current.controller,
          startedAtUtc: "2026-08-30T01:02:03.1234568Z",
        },
      },
      { ...current, janvim: { ...current.janvim, pid: 5101 } },
      {
        ...current,
        janvim: {
          ...current.janvim,
          startedAtUtc: "2026-08-30T01:02:04.7654322Z",
        },
      },
      { ...current, janvim: { ...current.janvim, hwnd: "0x000000000000141F" } },
      {
        ...current,
        janvim: { ...current.janvim, executableSha256: "b".repeat(64) },
      },
      { ...current, generationId: 2 },
    ];

    for (const stale of staleLeases) {
      await expect(
        replaceRunLeaseGenerationAtomic(path, stale, 4),
      ).rejects.toThrow(/compare-and-swap/i);
      expect(readFileSync(path, "utf8")).toBe(before);
    }
    expect(readdirSync(root)).toEqual(["run-lease.json"]);
  });

  it("allows exactly one winner when generation updates race from one expected lease", async () => {
    const root = temporaryRoot("run-lease-cas-race-");
    const path = join(root, "run-lease.json");
    const expected = validLease();
    await writeRunLeaseAtomic(path, expected);

    const results = await Promise.allSettled([
      replaceRunLeaseGenerationAtomic(path, expected, 2),
      replaceRunLeaseGenerationAtomic(path, expected, 3),
    ]);
    const outcomes = results.map((result) =>
      result.status === "fulfilled"
        ? "fulfilled"
        : result.reason instanceof Error
          ? result.reason.message
          : String(result.reason),
    );

    expect(
      results.filter((result) => result.status === "fulfilled"),
      outcomes.join(" | "),
    ).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const stored = JSON.parse(readFileSync(path, "utf8")) as RunLease;
    expect([2, 3]).toContain(stored.generationId);
    expect(leaseIdentityBytes(stored)).toBe(leaseIdentityBytes(expected));
    expect(readdirSync(root)).toEqual(["run-lease.json"]);
  }, 7_000);
});

describe("run lease identity verification", () => {
  it("returns identical only when PID, native creation time, resolved path, hash, and HWND owner match", async () => {
    const fixture = identityFixture();

    await expect(
      verifyRunLeaseIdentity(fixture.lease, verificationInput(fixture)),
    ).resolves.toBe("identical");
  });

  it("returns not-identical for each definite identity mismatch", async () => {
    const fixture = identityFixture();
    const outsideExecutable = join(temporaryRoot("run-lease-outside-"), "janvim-core.exe");
    writeFileSync(outsideExecutable, readFileSync(fixture.executablePath));
    const mismatches: Array<
      [string, LeaseProcessInspection, LeaseWindowInspection, string]
    > = [
      [
        "PID",
        {
          status: "found",
          pid: fixture.lease.janvim.pid + 1,
          startedAtUtc: fixture.lease.janvim.startedAtUtc,
          executablePath: fixture.executablePath,
        },
        { status: "found", ownerPid: fixture.lease.janvim.pid },
        fixture.executableSha256,
      ],
      [
        "native-precision creation time",
        {
          status: "found",
          pid: fixture.lease.janvim.pid,
          startedAtUtc: "2026-08-30T01:02:04.7654322Z",
          executablePath: fixture.executablePath,
        },
        { status: "found", ownerPid: fixture.lease.janvim.pid },
        fixture.executableSha256,
      ],
      [
        "runtime-relative executable path",
        {
          status: "found",
          pid: fixture.lease.janvim.pid,
          startedAtUtc: fixture.lease.janvim.startedAtUtc,
          executablePath: outsideExecutable,
        },
        { status: "found", ownerPid: fixture.lease.janvim.pid },
        fixture.executableSha256,
      ],
      [
        "frozen executable hash",
        {
          status: "found",
          pid: fixture.lease.janvim.pid,
          startedAtUtc: fixture.lease.janvim.startedAtUtc,
          executablePath: fixture.executablePath,
        },
        { status: "found", ownerPid: fixture.lease.janvim.pid },
        "b".repeat(64),
      ],
      [
        "HWND owner",
        {
          status: "found",
          pid: fixture.lease.janvim.pid,
          startedAtUtc: fixture.lease.janvim.startedAtUtc,
          executablePath: fixture.executablePath,
        },
        { status: "found", ownerPid: fixture.lease.janvim.pid + 1 },
        fixture.executableSha256,
      ],
      [
        "missing PID",
        { status: "not-found" },
        { status: "found", ownerPid: fixture.lease.janvim.pid },
        fixture.executableSha256,
      ],
      [
        "missing HWND",
        {
          status: "found",
          pid: fixture.lease.janvim.pid,
          startedAtUtc: fixture.lease.janvim.startedAtUtc,
          executablePath: fixture.executablePath,
        },
        { status: "not-found" },
        fixture.executableSha256,
      ],
    ];

    for (const [name, processInspection, windowInspection, expectedHash] of mismatches) {
      const input = verificationInput(fixture, processInspection, windowInspection);
      input.expectedExecutableSha256 = expectedHash;
      await expect(
        verifyRunLeaseIdentity(fixture.lease, input),
        name,
      ).resolves.toBe("not-identical");
    }

    writeFileSync(fixture.executablePath, "mutated executable", "utf8");
    await expect(
      verifyRunLeaseIdentity(fixture.lease, verificationInput(fixture)),
      "current executable SHA-256",
    ).resolves.toBe("not-identical");
  });

  it("returns unprovable for access denial or missing native creation-time proof", async () => {
    const fixture = identityFixture();
    const unprovableProcesses: LeaseProcessInspection[] = [
      { status: "unprovable", reason: "access-denied" },
      {
        status: "found",
        pid: fixture.lease.janvim.pid,
        executablePath: fixture.executablePath,
      },
      {
        status: "found",
        pid: fixture.lease.janvim.pid,
        startedAtUtc: fixture.lease.janvim.startedAtUtc,
      },
    ];

    for (const processInspection of unprovableProcesses) {
      await expect(
        verifyRunLeaseIdentity(
          fixture.lease,
          verificationInput(fixture, processInspection),
        ),
      ).resolves.toBe("unprovable");
    }

    await expect(
      verifyRunLeaseIdentity(
        fixture.lease,
        verificationInput(
          fixture,
          undefined,
          { status: "unprovable", reason: "access-denied" },
        ),
      ),
    ).resolves.toBe("unprovable");
  });

  it("lets a definite mismatch outrank other unprovable evidence", async () => {
    const fixture = identityFixture();
    const missingCreationTime: LeaseProcessInspection = {
      status: "found",
      pid: fixture.lease.janvim.pid,
      executablePath: fixture.executablePath,
    };

    await expect(
      verifyRunLeaseIdentity(
        fixture.lease,
        verificationInput(fixture, missingCreationTime, {
          status: "found",
          ownerPid: fixture.lease.janvim.pid + 1,
        }),
      ),
    ).resolves.toBe("not-identical");
  });

  it("treats adapter failures and malformed lease evidence as unprovable", async () => {
    const fixture = identityFixture();
    const input = verificationInput(fixture);
    input.adapter.inspectProcess = async () => {
      const error = new Error("access denied") as NodeJS.ErrnoException;
      error.code = "EACCES";
      throw error;
    };

    await expect(verifyRunLeaseIdentity(fixture.lease, input)).resolves.toBe(
      "unprovable",
    );

    const missingProcessResult = verificationInput(fixture);
    missingProcessResult.adapter.inspectProcess = (async () =>
      undefined) as unknown as typeof missingProcessResult.adapter.inspectProcess;
    await expect(
      verifyRunLeaseIdentity(fixture.lease, missingProcessResult),
    ).resolves.toBe("unprovable");

    const missingWindowResult = verificationInput(fixture);
    missingWindowResult.adapter.inspectWindowOwner = (async () =>
      undefined) as unknown as typeof missingWindowResult.adapter.inspectWindowOwner;
    await expect(
      verifyRunLeaseIdentity(fixture.lease, missingWindowResult),
    ).resolves.toBe("unprovable");

    await expect(
      verifyRunLeaseIdentity(
        { ...fixture.lease, bridgeToken: "fixture-secret" } as RunLease,
        verificationInput(fixture),
      ),
    ).resolves.toBe("unprovable");
  });
});

describe("run lease settlement removal", () => {
  it("keeps an exact lease while its JanVim PID is still live", async () => {
    const root = temporaryRoot("run-lease-live-");
    const path = join(root, "run-lease.json");
    const lease = validLease({
      janvim: { ...validLease().janvim, pid: process.pid },
    });
    await writeRunLeaseAtomic(path, lease);

    await expect(removeRunLeaseAfterSettlement(path, lease)).resolves.toBe(false);

    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(lease);
    expect(readdirSync(root)).toEqual(["run-lease.json"]);
  });

  it("removes a still-exact lease only after its JanVim PID has settled", async () => {
    const root = temporaryRoot("run-lease-settled-");
    const path = join(root, "run-lease.json");
    const lease = validLease({
      janvim: { ...validLease().janvim, pid: await settledChildPid() },
    });
    await writeRunLeaseAtomic(path, lease);

    await expect(removeRunLeaseAfterSettlement(path, lease)).resolves.toBe(true);

    expect(existsSync(path)).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  });

  it("keeps a settled lease when the file has changed or is malformed", async () => {
    const root = temporaryRoot("run-lease-removal-cas-");
    const path = join(root, "run-lease.json");
    const lease = validLease({
      janvim: { ...validLease().janvim, pid: await settledChildPid() },
    });
    await writeRunLeaseAtomic(path, lease);
    const current = await replaceRunLeaseGenerationAtomic(path, lease, 2);

    await expect(removeRunLeaseAfterSettlement(path, lease)).resolves.toBe(false);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(current);

    writeFileSync(path, '{"schema":1,"bridgeToken":"fixture-secret"}', "utf8");
    await expect(removeRunLeaseAfterSettlement(path, current)).resolves.toBe(false);
    expect(readFileSync(path, "utf8")).toContain("fixture-secret");
    expect(readdirSync(root)).toEqual(["run-lease.json"]);
  }, 7_000);

  it("accepts an exact strictly parsed lease independent of JSON formatting", async () => {
    const root = temporaryRoot("run-lease-removal-format-");
    const path = join(root, "run-lease.json");
    const lease = validLease({
      janvim: { ...validLease().janvim, pid: await settledChildPid() },
    });
    await writeRunLeaseAtomic(path, lease);
    writeFileSync(path, JSON.stringify(lease), "utf8");

    await expect(removeRunLeaseAfterSettlement(path, lease)).resolves.toBe(true);
    expect(readdirSync(root)).toEqual([]);
  });
});
