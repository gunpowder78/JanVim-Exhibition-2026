import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync, existsSync, ftruncateSync, linkSync, mkdirSync, mkdtempSync,
  openSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const repository = process.cwd();
const tool = join(repository, "deployment/operator/lib/package-manifest.mjs");
const builder = join(repository, "deployment/build-deployment-package.ps1");
const stateRoots = [
  "app/runtime/user-root/safe-mode/cache",
  "app/runtime/user-root/safe-mode/state",
  "app/runtime/user-root/plugin-lab/cache",
  "app/runtime/user-root/plugin-lab/state",
];
const roots: string[] = [];
const mebibyte = 1024 * 1024;
type Operation = "create" | "verify" | "verify-installed";
interface ManifestEntry { path: string; bytes: number; sha256: string }
interface Probe {
  accepted: boolean;
  reason?: string;
  value?: {
    status: string;
    files?: number;
    immutableFiles?: number;
    runtimeStateFiles?: number;
    runtimeStateBytes?: number;
    manifestSha256: string;
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    const below = relative(resolve(tmpdir()), resolve(root));
    if (below.length === 0 || below === ".." || below.startsWith(`..${sep}`) || isAbsolute(below)) {
      throw new Error("unsafe-test-root");
    }
    rmSync(root, { recursive: true, force: true });
  }
});

function emptyRoot() {
  const root = mkdtempSync(join(tmpdir(), "janvim-runtime-state-"));
  roots.push(root);
  return root;
}

function put(root: string, path: string, contents = "runtime-state") {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
  return target;
}

function sizedFile(root: string, path: string, bytes: number) {
  const target = put(root, path, "");
  const descriptor = openSync(target, "r+");
  try { ftruncateSync(descriptor, bytes); } finally { closeSync(descriptor); }
}

function probe(operation: Operation, root: string): Probe {
  const exported = {
    create: "createPackageManifest",
    verify: "verifyPackageManifest",
    "verify-installed": "verifyInstalledPackageManifest",
  }[operation];
  const source = `
    import * as manifests from ${JSON.stringify(pathToFileURL(tool).href)};
    try {
      const value = await manifests[${JSON.stringify(exported)}](${JSON.stringify(root)});
      process.stdout.write(JSON.stringify({ accepted: true, value }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ accepted: false, reason: error.message }));
    }
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    encoding: "utf8", windowsHide: true, timeout: 10_000,
  });
  expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  return JSON.parse(result.stdout) as Probe;
}

function fixture() {
  const root = emptyRoot();
  put(root, "app/runtime/user-root/plugin-lab/config/init.lua", "locked-config\n");
  put(root, "app/runtime/user-root/plugin-lab/local/agent.lua", "locked-agent\n");
  expect(probe("create", root).accepted).toBe(true);
  return root;
}

function rejectInstalled(root: string, reason: string) {
  expect(probe("verify-installed", root)).toEqual({ accepted: false, reason });
}

function checkBuilder(root: string) {
  const quote = (text: string) => `'${text.replaceAll("'", "''")}'`;
  const result = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", `
    $ErrorActionPreference='Stop'
    $builderText=Get-Content -LiteralPath ${quote(builder)} -Raw
    $mainStart=$builderText.IndexOf('$source = Resolve-BuilderPath',[StringComparison]::Ordinal)
    if($mainStart -lt 0){throw 'builder-main-marker-missing'}
    $loader=[scriptblock]::Create($builderText.Substring(0,$mainStart))
    . $loader -SourceRoot 'test' -JianShanCandidateRoot 'test' -NodeExecutable 'test' -OutputParent 'test'
    try {
      Assert-RuntimeStateClean -SourceRoot ${quote(root)}
      @{accepted=$true} | ConvertTo-Json -Compress
    } catch {
      @{accepted=$false;reason=$_.Exception.Message} | ConvertTo-Json -Compress
    }
  `], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  return JSON.parse(result.stdout) as Probe;
}

describe("installed deployment runtime state", () => {
  it("accepts only the four bounded state roots and separately reports immutable payload", () => {
    const root = fixture();
    const originalManifest = readFileSync(join(root, "package-manifest.json"));
    for (const stateRoot of stateRoots) put(root, `${stateRoot}/nvim/cache.bin`, "cache");
    const result = spawnSync(process.execPath, [tool, "verify-installed", "--root", root], {
      encoding: "utf8", windowsHide: true, timeout: 10_000,
    });
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "package-installed-payload-verified", immutableFiles: 2,
      runtimeStateFiles: 4, runtimeStateBytes: 20,
      manifestSha256: createHash("sha256").update(originalManifest).digest("hex"),
    });
    expect(readFileSync(join(root, "package-manifest.json"))).toEqual(originalManifest);
    expect(probe("verify", root)).toEqual({ accepted: false, reason: "package-payload-set-mismatch" });
  });

  it.each(stateRoots)("refuses to create a package containing existing %s state", (stateRoot) => {
    const root = emptyRoot();
    const existing = put(root, `${stateRoot}/nvim/cache.bin`);
    expect(probe("create", root)).toEqual({ accepted: false, reason: "package-runtime-state-not-clean" });
    expect(existsSync(join(root, "package-manifest.json"))).toBe(false);
    expect(readFileSync(existing, "utf8")).toBe("runtime-state");
  });

  it("rejects a runtime state root occupied by a file when creating a package", () => {
    const root = emptyRoot();
    const existing = put(root, stateRoots[0]!);
    expect(probe("create", root)).toEqual({ accepted: false, reason: "package-runtime-state-not-clean" });
    expect(existsSync(existing)).toBe(true);
    expect(existsSync(join(root, "package-manifest.json"))).toBe(false);
  });

  it("permits empty state directories in a fresh package and builder source", () => {
    const root = emptyRoot();
    for (const stateRoot of stateRoots) mkdirSync(join(root, stateRoot, "nvim"), { recursive: true });
    put(root, "app/runtime/user-root/plugin-lab/config/init.lua", "immutable");
    expect(checkBuilder(join(root, "app"))).toEqual({ accepted: true });
    expect(probe("create", root).accepted).toBe(true);
    expect(probe("verify", root).accepted).toBe(true);
    expect(probe("verify-installed", root)).toMatchObject({
      accepted: true, value: { immutableFiles: 1, runtimeStateFiles: 0, runtimeStateBytes: 0 },
    });
  });

  it.each(stateRoots)("rejects %s before the builder can copy a used runtime", (stateRoot) => {
    const root = emptyRoot();
    const existing = put(root, `${stateRoot}/nvim/cache.bin`);
    expect(checkBuilder(join(root, "app"))).toEqual({ accepted: false, reason: "package-runtime-state-not-clean" });
    expect(existsSync(existing)).toBe(true);
  });

  it.each(["changed", "missing"])("still rejects %s immutable configuration", (kind) => {
    const root = fixture();
    put(root, `${stateRoots[0]}/cache.bin`);
    const config = join(root, "app/runtime/user-root/plugin-lab/config/init.lua");
    if (kind === "missing") rmSync(config);
    else writeFileSync(config, "broken-config\n");
    rejectInstalled(root, kind === "missing" ? "package-payload-set-mismatch" : "package-payload-identity-mismatch");
  });

  it.each(["changed", "missing"])("never exempts a %s manifest entry inside a state root", (kind) => {
    const root = fixture();
    const path = `${stateRoots[3]}/legacy-pinned.bin`;
    const contents = "locked-state";
    const target = put(root, path, contents);
    const manifestPath = join(root, "package-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { schema: number; files: ManifestEntry[] };
    manifest.files.push({ path, bytes: contents.length, sha256: createHash("sha256").update(contents).digest("hex") });
    manifest.files.sort((left, right) => left.path < right.path ? -1 : 1);
    writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(probe("verify-installed", root)).toMatchObject({
      accepted: true, value: { immutableFiles: 3, runtimeStateFiles: 0 },
    });
    if (kind === "missing") rmSync(target);
    else writeFileSync(target, "broken-state");
    rejectInstalled(root, kind === "missing" ? "package-payload-set-mismatch" : "package-payload-identity-mismatch");
  });

  it.each([
    "app/runtime/user-root/plugin-lab/config/extra.lua",
    "app/runtime/user-root/plugin-lab/local/extra.lua",
    "app/runtime/user-root/plugin-lab/cache-sibling/extra.bin",
    "app/runtime/user-root/starter/cache/extra.bin",
    "app/node_modules/electron/dist/extra.bin",
  ])("rejects extra payload outside the four roots: %s", (path) => {
    const root = fixture();
    put(root, path);
    rejectInstalled(root, "package-payload-set-mismatch");
  });

  it.each([
    "active-deployment.json", "flock-input.json", "run-lease.json", "control.json",
    "ready.json", "session.json", "summary.json", "JianShan-Live.toml",
    "jianshan-live-backup.toml", "bridge-token.json", "flockDescriptorV2.Json",
    "bridgeTokenV2.backup.json", "privateDescriptor.Json", "token-private.JSON",
    ".GiT", ".operator/nested.bin", ".WORKTREES/nested.bin", ".SuperPowers/nested.bin",
    "joint-session-20260907T010203004Z-a1b2c3d4e5f6/nested.bin",
  ])("rejects private input even below a state root: %s", (path) => {
    const root = fixture();
    put(root, `${stateRoots[2]}/${path}`);
    rejectInstalled(root, "package-runtime-state-private-path");
  });

  it("rejects an empty private directory below a state root", () => {
    const root = fixture();
    mkdirSync(join(root, stateRoots[0]!, ".operator"), { recursive: true });
    rejectInstalled(root, "package-runtime-state-private-path");
  });

  it.each(["root", "nested"])("rejects a %s state junction without following it", (kind) => {
    const root = fixture();
    const outside = emptyRoot();
    put(outside, "outside.bin");
    const path = join(root, stateRoots[0]!, ...(kind === "nested" ? ["nvim"] : []));
    mkdirSync(dirname(path), { recursive: true });
    symlinkSync(outside, path, "junction");
    rejectInstalled(root, "package-reparse-rejected");
    expect(checkBuilder(join(root, "app")).accepted).toBe(false);
  });

  it("rejects state hard links to immutable payload", () => {
    const root = fixture();
    const path = join(root, stateRoots[0]!, "alias.bin");
    mkdirSync(dirname(path), { recursive: true });
    linkSync(join(root, "app/runtime/user-root/plugin-lab/config/init.lua"), path);
    rejectInstalled(root, "package-runtime-state-hardlink-rejected");
  });

  it("preserves case-folded manifest collision rejection in installed mode", () => {
    const root = fixture();
    const path = join(root, "package-manifest.json");
    const manifest = JSON.parse(readFileSync(path, "utf8")) as { schema: number; files: ManifestEntry[] };
    manifest.files.push({ ...manifest.files[0]!, path: manifest.files[0]!.path.toUpperCase() });
    manifest.files.sort((left, right) => left.path < right.path ? -1 : 1);
    writeFileSync(path, JSON.stringify(manifest));
    rejectInstalled(root, "package-manifest-duplicate-path");
  });

  it("enforces the 1,024-file budget across all four state roots", () => {
    const root = fixture();
    for (let index = 0; index < 1024; index++) {
      put(root, `${stateRoots[index % 4]}/entry-${index}`, "");
    }
    expect(probe("verify-installed", root)).toMatchObject({
      accepted: true, value: { runtimeStateFiles: 1024, runtimeStateBytes: 0 },
    });
    put(root, `${stateRoots[0]}/overflow`, "");
    rejectInstalled(root, "package-runtime-state-count-exceeded");
  }, 20_000);

  it("enforces the 16 MiB per-file budget", () => {
    const root = fixture();
    const path = `${stateRoots[1]}/cache.bin`;
    sizedFile(root, path, 16 * mebibyte);
    expect(probe("verify-installed", root).accepted).toBe(true);
    sizedFile(root, path, 16 * mebibyte + 1);
    rejectInstalled(root, "package-runtime-state-file-size-exceeded");
  });

  it("enforces the 64 MiB total budget across all four state roots", () => {
    const root = fixture();
    for (const stateRoot of stateRoots) sizedFile(root, `${stateRoot}/cache.bin`, 16 * mebibyte);
    expect(probe("verify-installed", root)).toMatchObject({
      accepted: true, value: { runtimeStateFiles: 4, runtimeStateBytes: 64 * mebibyte },
    });
    put(root, `${stateRoots[0]}/overflow`, "x");
    rejectInstalled(root, "package-runtime-state-bytes-exceeded");
  });
});
