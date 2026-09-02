import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import { RunLogBudget, type LogStorage } from "../src/bounded-log.ts";
import {
  assertFrozenSnapshotUnchanged,
  createBoundedChildStreamSink,
  installLocalOnlyWebGuards,
  readFrozenRuntimeSnapshot,
  resolveBelowRoot,
} from "../src/runtime-adapter-common.ts";

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

const protectedRoots = [
  "D:\\VirtualData\\TempCache\\janvim-root-export-quarantine-20260826-110433-6473a2d7ebbc4524b66c61c07e540504",
  "D:\\VirtualData\\TempCache\\janvim-task5-cached-d42e9769283e47dc8b98cf94baee739d",
  "D:\\VirtualData\\TempCache\\janvim-task5-physical-cached-e9735e8d02e34ff4a4ac8836f8e22dcb",
] as const;

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("frozen runtime snapshots", () => {
  it("records exact bytes, size, and SHA-256 for every frozen runtime input", () => {
    const files = new Map<string, Buffer>([
      ["D:\\show\\janvim-artifact.lock.json", Buffer.from("lock-v1")],
      ["D:\\show\\content\\show.manifest.json", Buffer.from("manifest-v1")],
      ["D:\\show\\content\\poem.txt", Buffer.from("poem-v1")],
      ["D:\\show\\show\\janvim-show.toml", Buffer.from("config-v1")],
      ["D:\\show\\runtime\\janvim\\janvim-core.exe", Buffer.from([0, 1, 2, 3, 255])],
    ]);
    const reads: string[] = [];

    const snapshot = readFrozenRuntimeSnapshot({
      readFile: (path) => {
        reads.push(path);
        const value = files.get(path);
        if (value === undefined) throw new Error(`missing fixture: ${path}`);
        return Buffer.from(value);
      },
      files: [
        {
          label: "artifact-lock",
          path: "D:\\show\\janvim-artifact.lock.json",
          expectedSize: 7,
          expectedSha256: "7e69c8c300a77387f3326374291b55b0d0bb5bdc3d51051ceaf4527a5997478f",
        },
        {
          label: "show-manifest",
          path: "D:\\show\\content\\show.manifest.json",
          expectedSize: 11,
          expectedSha256: "88c7275ef3ef13f6eb8bf6a201c972557ab952d4d6ebe115ca80d40a1c9b64c3",
        },
        {
          label: "poem",
          path: "D:\\show\\content\\poem.txt",
          expectedSize: 7,
          expectedSha256: "0bc1a7e8a27d2279a9033836bd45f15d621796265b811b0e8cf5bf243173965a",
        },
        {
          label: "show-config",
          path: "D:\\show\\show\\janvim-show.toml",
          expectedSize: 9,
          expectedSha256: "e3155b20e134632816c8611c4e9ee5cbd0e00689f7c4c955ee9f896580d02fdb",
        },
        {
          label: "runtime-core",
          path: "D:\\show\\runtime\\janvim\\janvim-core.exe",
          expectedSize: 5,
          expectedSha256: "ff5d8507b6a72bee2debce2c0054798deaccdc5d8a1b945b6280ce8aa9cba52e",
        },
      ],
    });

    expect(reads).toEqual([
      "D:\\show\\janvim-artifact.lock.json",
      "D:\\show\\content\\show.manifest.json",
      "D:\\show\\content\\poem.txt",
      "D:\\show\\show\\janvim-show.toml",
      "D:\\show\\runtime\\janvim\\janvim-core.exe",
    ]);
    expect(
      snapshot.files.map(({ label, path, size, sha256 }) => ({
        label,
        path,
        size,
        sha256,
      })),
    ).toEqual([
      {
        label: "artifact-lock",
        path: "D:\\show\\janvim-artifact.lock.json",
        size: 7,
        sha256: "7e69c8c300a77387f3326374291b55b0d0bb5bdc3d51051ceaf4527a5997478f",
      },
      {
        label: "show-manifest",
        path: "D:\\show\\content\\show.manifest.json",
        size: 11,
        sha256: "88c7275ef3ef13f6eb8bf6a201c972557ab952d4d6ebe115ca80d40a1c9b64c3",
      },
      {
        label: "poem",
        path: "D:\\show\\content\\poem.txt",
        size: 7,
        sha256: "0bc1a7e8a27d2279a9033836bd45f15d621796265b811b0e8cf5bf243173965a",
      },
      {
        label: "show-config",
        path: "D:\\show\\show\\janvim-show.toml",
        size: 9,
        sha256: "e3155b20e134632816c8611c4e9ee5cbd0e00689f7c4c955ee9f896580d02fdb",
      },
      {
        label: "runtime-core",
        path: "D:\\show\\runtime\\janvim\\janvim-core.exe",
        size: 5,
        sha256: "ff5d8507b6a72bee2debce2c0054798deaccdc5d8a1b945b6280ce8aa9cba52e",
      },
    ]);
    expect(Buffer.from(snapshot.files[4]!.bytes)).toEqual(Buffer.from([0, 1, 2, 3, 255]));
  });

  it("rejects a byte change on the second read without trusting exposed snapshot buffers", () => {
    const path = "D:\\show\\content\\poem.txt";
    let current = Buffer.from("poem-v1");
    const snapshot = readFrozenRuntimeSnapshot({
      readFile: () => Buffer.from(current),
      files: [{ label: "poem", path }],
    });
    snapshot.files[0]!.bytes.fill(0);

    expect(() => assertFrozenSnapshotUnchanged(snapshot)).not.toThrow();

    current = Buffer.from("poem-v2");

    expect(() => assertFrozenSnapshotUnchanged(snapshot)).toThrow(/poem.*changed/i);
  });

  it("rejects a frozen file alternate data stream before reading it", () => {
    const readFile = vi.fn(() => Buffer.from("hidden"));

    expect(() =>
      readFrozenRuntimeSnapshot({
        readFile,
        files: [
          {
            label: "poem",
            path: "D:\\show\\content\\poem.txt:alternate",
          },
        ],
      }),
    ).toThrow(/path/i);
    expect(readFile).not.toHaveBeenCalled();
  });
});

describe("bounded runtime path resolution", () => {
  it("resolves a relative child and rejects absolute, traversal, ADS, and device paths", () => {
    expect(resolveBelowRoot("D:\\show", "content\\fixture\\poem.txt")).toBe(
      "D:\\show\\content\\fixture\\poem.txt",
    );

    for (const value of [
      "D:\\elsewhere\\poem.txt",
      "..\\poem.txt",
      "content\\poem.txt:alternate",
      "\\\\?\\D:\\show\\poem.txt",
      "\\\\.\\pipe\\janvim",
      "NUL",
      "content\\CON.txt",
      "COM1.log",
      "content\\LPT9",
    ]) {
      expect(() => resolveBelowRoot("D:\\show", value)).toThrow();
    }
    expect(() =>
      resolveBelowRoot("D:\\show:alternate", "content\\poem.txt"),
    ).toThrow();
  });

  it("rejects JanVim product source and all three protected incident roots", () => {
    expect(() => resolveBelowRoot("D:\\github\\JanVim", "runtime\\janvim.lua")).toThrow(
      /source|protected/i,
    );
    for (const root of protectedRoots) {
      expect(() => resolveBelowRoot(root, "incident.json")).toThrow(/protected/i);
    }
  });

  it("rejects a child junction that escapes the resolved root", () => {
    if (process.platform !== "win32") return;
    const temporaryRoot = mkdtempSync(join(tmpdir(), "janvim-runtime-common-"));
    temporaryRoots.push(temporaryRoot);
    const root = join(temporaryRoot, "root");
    const outside = join(temporaryRoot, "outside");
    mkdirSync(root);
    mkdirSync(outside);
    writeFileSync(join(outside, "poem.txt"), "outside");
    symlinkSync(outside, join(root, "escape"), "junction");

    expect(() => resolveBelowRoot(root, "escape\\poem.txt")).toThrow(/symlink|escape/i);
  });
});

describe("local-only secondary web guards", () => {
  it("allows only the exact local entry and blocks remote requests, navigation, and windows", () => {
    const entryUrl = "file:///D:/show/apps/secondary-screen/dist/index.html";
    let requestFilter: { urls: string[] } | null | undefined;
    let requestListener:
      | ((details: { url: string }, callback: (result: { cancel: boolean }) => void) => void)
      | undefined;
    let navigationListener:
      | ((event: { preventDefault(): void }, targetUrl: string) => void)
      | undefined;
    let windowOpenHandler:
      | ((details: { url: string }) => { action: "deny" })
      | undefined;
    const removeNavigation = vi.fn();
    const webContents = {
      session: {
        webRequest: {
          onBeforeRequest: (
            filter: { urls: string[] } | null,
            listener?: (
              details: { url: string },
              callback: (result: { cancel: boolean }) => void,
            ) => void,
          ) => {
            requestFilter = filter;
            requestListener = listener;
          },
        },
      },
      on: (
        _eventName: "will-navigate",
        listener: (event: { preventDefault(): void }, targetUrl: string) => void,
      ) => {
        navigationListener = listener;
      },
      removeListener: (
        _eventName: "will-navigate",
        listener: (event: { preventDefault(): void }, targetUrl: string) => void,
      ) => {
        removeNavigation(listener);
      },
      setWindowOpenHandler: (
        handler: (details: { url: string }) => { action: "deny" },
      ) => {
        windowOpenHandler = handler;
      },
    };

    const dispose = installLocalOnlyWebGuards({ webContents, entryUrl });

    expect(requestFilter).toEqual({
      urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"],
    });
    for (const url of [
      "http://example.invalid/a",
      "https://example.invalid/a",
      "ws://example.invalid/a",
      "wss://example.invalid/a",
    ]) {
      let requestResult: { cancel: boolean } | undefined;
      requestListener?.({ url }, (result) => {
        requestResult = result;
      });
      expect(requestResult).toEqual({ cancel: true });

      const preventDefault = vi.fn();
      navigationListener?.({ preventDefault }, url);
      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(windowOpenHandler?.({ url })).toEqual({ action: "deny" });
    }
    const exactNavigation = vi.fn();
    navigationListener?.({ preventDefault: exactNavigation }, entryUrl);
    expect(exactNavigation).not.toHaveBeenCalled();
    const changedLocalNavigation = vi.fn();
    navigationListener?.(
      { preventDefault: changedLocalNavigation },
      "file:///D:/show/apps/secondary-screen/dist/other.html",
    );
    expect(changedLocalNavigation).toHaveBeenCalledTimes(1);

    dispose();
    dispose();
    expect(removeNavigation).toHaveBeenCalledTimes(1);
    expect(requestFilter).toBeNull();
    expect(requestListener).toBeUndefined();
  });

  it("rejects a remote entry before installing any guard", () => {
    const onBeforeRequest = vi.fn();
    const on = vi.fn();
    expect(() =>
      installLocalOnlyWebGuards({
        entryUrl: "https://example.invalid/show",
        webContents: {
          session: { webRequest: { onBeforeRequest } },
          on,
          removeListener: vi.fn(),
          setWindowOpenHandler: vi.fn(),
        },
      }),
    ).toThrow(/local file/i);
    expect(onBeforeRequest).not.toHaveBeenCalled();
    expect(on).not.toHaveBeenCalled();
  });

  it("rolls back the request filter and navigation listener when guard installation fails", () => {
    let requestFilter: { urls: string[] } | null | undefined;
    const navigationListener = vi.fn();
    const removeListener = vi.fn();

    expect(() =>
      installLocalOnlyWebGuards({
        entryUrl: "file:///D:/show/apps/secondary-screen/dist/index.html",
        webContents: {
          session: {
            webRequest: {
              onBeforeRequest: (filter) => {
                requestFilter = filter;
              },
            },
          },
          on: (_eventName, listener) => navigationListener(listener),
          removeListener,
          setWindowOpenHandler: () => {
            throw new Error("window-open-handler-failed");
          },
        },
      }),
    ).toThrow("window-open-handler-failed");
    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith(
      "will-navigate",
      navigationListener.mock.calls[0]![0],
    );
    expect(requestFilter).toBeNull();
  });

  it("clears the request filter even when navigation-listener disposal throws", () => {
    let requestFilter: { urls: string[] } | null | undefined;
    const dispose = installLocalOnlyWebGuards({
      entryUrl: "file:///D:/show/apps/secondary-screen/dist/index.html",
      webContents: {
        session: {
          webRequest: {
            onBeforeRequest: (filter) => {
              requestFilter = filter;
            },
          },
        },
        on: vi.fn(),
        removeListener: () => {
          throw new Error("navigation-disposal-failed");
        },
        setWindowOpenHandler: vi.fn(),
      },
    });

    expect(dispose).toThrow("navigation-disposal-failed");
    expect(requestFilter).toBeNull();
  });
});

describe("bounded child stream sinks", () => {
  it("alternates stdout and stderr through the shared run quota without exposing chunks", () => {
    const storage = new MemoryLogStorage();
    const budget = new RunLogBudget({
      storage,
      basePath: "D:\\rehearsal\\show",
      secrets: [],
      maxFileBytes: 32,
      maxTotalBytes: 64,
    });
    const observed: string[] = [];
    const write = (
      stream: "janvim-stdout" | "janvim-stderr",
      chunk: Uint8Array,
    ): boolean => budget.write(stream, chunk);
    const stdout = createBoundedChildStreamSink({
      stream: "janvim-stdout",
      write,
      observe: (chunk) => observed.push(`stdout:${Buffer.from(chunk).toString("utf8")}`),
    });
    const stderr = createBoundedChildStreamSink({
      stream: "janvim-stderr",
      write,
      observe: (chunk) => observed.push(`stderr:${Buffer.from(chunk).toString("utf8")}`),
    });
    const chunks = [
      Buffer.from("out-1"),
      Buffer.from("err-1"),
      Buffer.from("out-2"),
      Buffer.from("err-2"),
    ];

    expect(stdout.append(chunks[0]!)).toBe(true);
    expect(stderr.append(chunks[1]!)).toBe(true);
    expect(stdout.append(chunks[2]!)).toBe(true);
    expect(stderr.append(chunks[3]!)).toBe(true);
    for (const chunk of chunks) chunk.fill(0);

    expect(observed).toEqual([
      "stdout:out-1",
      "stderr:err-1",
      "stdout:out-2",
      "stderr:err-2",
    ]);
    expect(storage.files).toEqual(
      new Map([
        ["D:\\rehearsal\\show.janvim-stdout", "out-1out-2"],
        ["D:\\rehearsal\\show.janvim-stderr", "err-1err-2"],
      ]),
    );
    expect(Object.keys(stdout)).toEqual(["append"]);
    expect(Object.keys(stderr)).toEqual(["append"]);
  });
});
