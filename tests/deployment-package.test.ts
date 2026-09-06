import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();
const manifestTool = join(
  repositoryRoot,
  "deployment",
  "operator",
  "lib",
  "package-manifest.mjs",
);
const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop()!;
    if (!resolve(root).startsWith(resolve(tmpdir()))) throw new Error("unsafe-test-root");
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "janvim-package-manifest-"));
  roots.push(root);
  mkdirSync(join(root, "nested"));
  writeFileSync(join(root, "alpha.txt"), "alpha\n", "utf8");
  writeFileSync(join(root, "nested", "beta.bin"), Buffer.from([0, 1, 2, 255]));
  return root;
}

function run(command: "create" | "verify", root: string) {
  return spawnSync(process.execPath, [manifestTool, command, "--root", root], {
    encoding: "utf8",
    timeout: 20_000,
    windowsHide: true,
  });
}

function create(root: string) {
  const result = run("create", root);
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  return JSON.parse(result.stdout) as {
    status: string;
    files: number;
    manifestBytes: number;
    manifestSha256: string;
  };
}

function manifestPath(root: string): string {
  return join(root, "package-manifest.json");
}

function readManifest(root: string): {
  schema: number;
  files: Array<{ path: string; bytes: number; sha256: string }>;
} {
  return JSON.parse(readFileSync(manifestPath(root), "utf8"));
}

function writeManifest(root: string, value: unknown): void {
  writeFileSync(manifestPath(root), `${JSON.stringify(value)}\n`, "utf8");
}

describe("deployment package manifest", () => {
  it("creates and verifies one sorted manifest that excludes itself", () => {
    const root = fixture();
    const receipt = create(root);
    const manifest = readManifest(root);

    expect(receipt).toMatchObject({ status: "package-manifest-created", files: 2 });
    expect(receipt.manifestSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(receipt.manifestBytes).toBe(readFileSync(manifestPath(root)).byteLength);
    expect(manifest).toEqual({
      schema: 1,
      files: [
        expect.objectContaining({ path: "alpha.txt", bytes: 6 }),
        expect.objectContaining({ path: "nested/beta.bin", bytes: 4 }),
      ],
    });
    expect(manifest.files.every((entry) => entry.path !== "package-manifest.json")).toBe(true);

    const verified = run("verify", root);
    expect(verified.status, `${verified.stdout}\n${verified.stderr}`).toBe(0);
    expect(JSON.parse(verified.stdout)).toMatchObject({
      status: "package-manifest-verified",
      files: 2,
      manifestSha256: receipt.manifestSha256,
    });
  });

  it.each([
    ["missing payload", (root: string) => rmSync(join(root, "alpha.txt"))],
    ["extra payload", (root: string) => writeFileSync(join(root, "extra.txt"), "x")],
    ["changed bytes", (root: string) => writeFileSync(join(root, "alpha.txt"), "changed")],
  ])("rejects %s", (_label, mutate) => {
    const root = fixture();
    create(root);
    mutate(root);
    expect(run("verify", root).status).not.toBe(0);
  });

  it.each([
    ["duplicate path", (manifest: ReturnType<typeof readManifest>) => {
      manifest.files.push({ ...manifest.files[0]! });
    }],
    ["unsorted entries", (manifest: ReturnType<typeof readManifest>) => {
      manifest.files.reverse();
    }],
    ["absolute path", (manifest: ReturnType<typeof readManifest>) => {
      manifest.files[0]!.path = "D:/escaped.txt";
    }],
    ["parent escape", (manifest: ReturnType<typeof readManifest>) => {
      manifest.files[0]!.path = "../escaped.txt";
    }],
    ["case-folded duplicate", (manifest: ReturnType<typeof readManifest>) => {
      manifest.files.push({ ...manifest.files[0]!, path: "ALPHA.TXT" });
      manifest.files.sort((left, right) => left.path < right.path ? -1 : 1);
    }],
  ])("rejects a manifest with %s", (_label, mutate) => {
    const root = fixture();
    create(root);
    const manifest = readManifest(root);
    mutate(manifest);
    writeManifest(root, manifest);
    expect(run("verify", root).status).not.toBe(0);
  });

  it("rejects a payload reparse point on create and verify", () => {
    const outside = fixture();
    const createRoot = fixture();
    const createLink = join(createRoot, "linked");
    symlinkSync(outside, createLink, "junction");
    expect(run("create", createRoot).status).not.toBe(0);

    const verifyRoot = fixture();
    create(verifyRoot);
    symlinkSync(outside, join(verifyRoot, "extra-link"), "junction");
    expect(run("verify", verifyRoot).status).not.toBe(0);
  });

  it("rejects more than 100,000 manifest entries before payload traversal", () => {
    const root = fixture();
    const files = Array.from({ length: 100_001 }, (_unused, index) => ({
      path: `f${String(index).padStart(6, "0")}`,
      bytes: 0,
      sha256: "0".repeat(64),
    }));
    writeManifest(root, { schema: 1, files });
    expect(readFileSync(manifestPath(root)).byteLength).toBeLessThanOrEqual(16 * 1024 * 1024);
    expect(run("verify", root).status).not.toBe(0);
  }, 30_000);

  it("rejects a manifest larger than 16 MiB", () => {
    const root = fixture();
    writeFileSync(manifestPath(root), "x".repeat(16 * 1024 * 1024 + 1));
    expect(run("verify", root).status).not.toBe(0);
  });

  it("checks in the package builder and read-only deployment verifier", () => {
    for (const path of [
      join(repositoryRoot, "deployment", "build-deployment-package.ps1"),
      join(repositoryRoot, "deployment", "operator", "Verify-Deployment.ps1"),
    ]) {
      expect(existsSync(path), path).toBe(true);
    }
    expect(existsSync(manifestTool)).toBe(true);
  });

  it("validates a whitelisted workspace junction against its real target", () => {
    const builder = readFileSync(
      join(repositoryRoot, "deployment", "build-deployment-package.ps1"),
      "utf8",
    );

    expect(builder).toContain("$actualTargets = @($item.Target)");
    expect(builder).toContain("$actualTargets.Count -ne 1");
    expect(builder).not.toContain(
      "(Resolve-Path -LiteralPath $item.FullName -ErrorAction Stop).ProviderPath",
    );
  });
});
