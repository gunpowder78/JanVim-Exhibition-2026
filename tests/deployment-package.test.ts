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
const builderScript = join(
  repositoryRoot,
  "deployment",
  "build-deployment-package.ps1",
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

function sourceTreeFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "janvim-package-source-"));
  roots.push(root);
  return root;
}

function psQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function validatePackageSourceTrees(cases: Array<{ label: string; root: string }>) {
  const powerShellCases = cases
    .map(({ label, root }) =>
      `[pscustomobject]@{label=${psQuote(label)};path=${psQuote(root)}}`)
    .join(",");
  const command = [
    "$ErrorActionPreference='Stop'",
    `$builderPath=${psQuote(builderScript)}`,
    "$builderText=Get-Content -LiteralPath $builderPath -Raw",
    "$mainStart=$builderText.IndexOf('$source = Resolve-BuilderPath',[StringComparison]::Ordinal)",
    "if($mainStart -lt 0){throw 'builder-main-marker-missing'}",
    "$loader=[scriptblock]::Create($builderText.Substring(0,$mainStart))",
    ". $loader -SourceRoot 'test' -JianShanCandidateRoot 'test' -NodeExecutable 'test' -OutputParent 'test'",
    `$cases=@(${powerShellCases})`,
    "$results=foreach($case in $cases){try{Assert-PlainTree -Path $case.path;[pscustomobject]@{label=$case.label;accepted=$true;reason=$null}}catch{[pscustomobject]@{label=$case.label;accepted=$false;reason=$_.Exception.Message}}}",
    "ConvertTo-Json -InputObject @($results) -Compress",
  ].join("\n");
  const result = spawnSync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
    { encoding: "utf8", timeout: 20_000, windowsHide: true },
  );

  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  return JSON.parse(result.stdout) as Array<{
    label: string;
    accepted: boolean;
    reason: string | null;
  }>;
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

  it("enforces the package-source privacy gate without dependency-name false positives", () => {
    const cases: Array<{ label: string; root: string; accepted: boolean }> = [];
    const addDirectoryCase = (label: string, name: string, accepted: boolean) => {
      const root = sourceTreeFixture();
      mkdirSync(join(root, "nested", name), { recursive: true });
      cases.push({ label, root, accepted });
    };
    const addFileCase = (label: string, name: string, accepted: boolean) => {
      const root = sourceTreeFixture();
      mkdirSync(join(root, "nested"), { recursive: true });
      writeFileSync(join(root, "nested", name), "fixture\n", "utf8");
      cases.push({ label, root, accepted });
    };

    for (const name of [".GiT", ".WORKTREES", ".operator", ".SuperPowers"]) {
      addDirectoryCase(`private directory ${name}`, name, false);
      addFileCase(`private metadata file ${name}`, name, false);
    }

    const sessionSuffix = "20260907T010203004Z-a1b2c3d4e5f6";
    for (const family of [
      "deployment",
      "deployment-package",
      "display-config",
      "JOINT-SESSION",
      "joint-show",
      "joint-sound",
      "joint-validate",
      "SOUND",
    ]) {
      addDirectoryCase(
        `production run root ${family}`,
        `${family}-${sessionSuffix}`,
        false,
      );
    }

    for (const name of [
      ".git-cache",
      ".operator-tools",
      "deployment-package-source",
      "joint-session-a",
      "joint-show-assets",
      "joint-sound-test",
      "joint-validate-notes",
      "sound-effects",
      "surround-sound-library",
      "deployment-20260907T010203004Z-a1b2c3d4e5f",
      "display-config-20260907T010203004Z-a1b2c3d4e5f67",
      "sound-20260907T01020304Z-a1b2c3d4e5f6",
    ]) {
      addDirectoryCase(`ordinary source directory ${name}`, name, true);
    }

    for (const name of [
      "active-deployment.json",
      "flock-input.json",
      "run-lease.json",
      "control.json",
      "ready.json",
      "summary.json",
      "session.json",
      "JianShan-Live.toml",
      "jianshan-live-private.toml",
      "bridge-token.json",
      "token-private.JSON",
      "flock-descriptor.json",
      "privateDescriptor.Json",
      "PRIVATEDESCRIPTOR.JSON",
      "bridgeTokenV2.json",
      "bridgeTokenV2.backup.json",
      "bridgeToken-v2.json",
      "bridgeToken_v2.json",
      "flockDescriptorV2.Json",
      "flockDescriptorV2Copy.json",
    ]) {
      addFileCase(`private file ${name}`, name, false);
    }

    for (const name of [
      "token-before.cjs",
      "TokenStream.js",
      "css-property-descriptors.js",
      "tokenizer.json",
      "property-descriptors.json",
      "cssPropertyDescriptorV2.json",
    ]) {
      addFileCase(`dependency source ${name}`, name, true);
    }

    const results = validatePackageSourceTrees(cases);
    expect(results.map(({ label, accepted }) => ({ label, accepted }))).toEqual(
      cases.map(({ label, accepted }) => ({ label, accepted })),
    );
    for (const result of results) {
      if (result.accepted) expect(result.reason, result.label).toBeNull();
      else expect(result.reason, result.label).toMatch(/^runtime-private-(?:directory|file)-rejected$/u);
    }
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
      builderScript,
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

  it("matches the configured SuperCollider endpoint by string value", () => {
    const verifier = readFileSync(
      join(repositoryRoot, "deployment", "operator", "Verify-Deployment.ps1"),
      "utf8",
    );

    expect(verifier).toContain("devices.includesEqual(target)");
    expect(verifier).not.toContain("devices.includes(target)");
  });
});
