import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();
const bundleRelativePath = "apps/controller/dist/main/electron-main.js";
const launcherPath = join(repositoryRoot, "scripts", "start-show.ps1");
const reviewedElectronReleaseIdentityStart =
  "# JANVIM_REVIEWED_ELECTRON_RELEASE_IDENTITY_BEGIN";
const reviewedElectronReleaseIdentityEnd =
  "# JANVIM_REVIEWED_ELECTRON_RELEASE_IDENTITY_END";
const temporaryRoots: string[] = [];

interface BundleManifest {
  schema: number;
  status: string;
  files: Array<{ relativePath: string; bytes: number; sha256: string }>;
  runtimeImports: string[];
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function writeText(path: string, source: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source, "utf8");
}

function runVerifier(root: string) {
  return spawnSync(
    process.execPath,
    [join(root, "scripts", "verify-electron-module-graph.mjs")],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 15_000,
    },
  );
}

function createVerifierFixture(
  candidateSource = "export const electronMain = true;\n",
  extraBundleFiles: Readonly<Record<string, string>> = {},
): { root: string; bundle: string; mainSentinel: string; adapterSentinel: string } {
  const root = mkdtempSync(join(tmpdir(), "janvim-main-bundle-"));
  temporaryRoots.push(root);
  const verifier = join(root, "scripts", "verify-electron-module-graph.mjs");
  const parser = join(root, "node_modules", "typescript", "lib", "typescript.js");
  const bundle = join(root, ...bundleRelativePath.split("/"));
  const legacyDist = join(root, "apps", "controller", "dist", "src");
  const mainSentinel = join(root, "candidate-executed");
  const adapterSentinel = join(root, "adapter-executed");

  writeText(bundle, candidateSource);
  writeText(join(legacyDist, "electron-main.js"), candidateSource);
  writeText(join(legacyDist, "g2-runtime-adapters.js"), "export const g2 = true;\n");
  writeText(join(legacyDist, "show-runtime-adapters.js"), [
    'import { writeFileSync } from "node:fs";',
    'writeFileSync("adapter-executed", "unsafe");',
    "",
  ].join("\n"));
  for (const [relativePath, source] of Object.entries(extraBundleFiles)) {
    writeText(join(dirname(bundle), ...relativePath.split("/")), source);
    writeText(join(legacyDist, ...relativePath.split("/")), source);
  }

  mkdirSync(dirname(verifier), { recursive: true });
  copyFileSync(
    join(repositoryRoot, "scripts", "verify-electron-module-graph.mjs"),
    verifier,
  );
  mkdirSync(dirname(parser), { recursive: true });
  copyFileSync(
    join(repositoryRoot, "node_modules", "typescript", "lib", "typescript.js"),
    parser,
  );
  return { root, bundle, mainSentinel, adapterSentinel };
}

function readManifest(stdout: string): BundleManifest {
  return JSON.parse(stdout) as BundleManifest;
}

describe("compiled Electron main bundle", () => {
  it("emits one bounded canonical hashed production bundle with sorted runtime imports", () => {
    const result = runVerifier(repositoryRoot);

    expect(result.status, result.stderr || result.error?.message).toBe(0);
    expect(result.stdout.endsWith("\n")).toBe(true);
    const output = readManifest(result.stdout);
    expect(Object.keys(output)).toEqual([
      "schema",
      "status",
      "files",
      "runtimeImports",
    ]);
    expect(output.schema).toBe(2);
    expect(output.status).toBe("compiled-electron-main-bundle-verified");
    expect(output.files).toHaveLength(1);
    expect(output.runtimeImports).toEqual(
      [...new Set(output.runtimeImports)].sort(),
    );
    expect(output.runtimeImports.length).toBeGreaterThan(0);
    expect(output.runtimeImports.length).toBeLessThanOrEqual(64);
    expect(output.runtimeImports).toContain("electron");

    const [file] = output.files;
    expect(file).toBeDefined();
    expect(Object.keys(file!)).toEqual(["relativePath", "bytes", "sha256"]);
    expect(file!.relativePath).toBe(bundleRelativePath);
    const canonicalRepositoryRoot = realpathSync.native(repositoryRoot);
    const canonicalBundle = realpathSync.native(
      join(repositoryRoot, ...file!.relativePath.split("/")),
    );
    expect(relative(canonicalRepositoryRoot, canonicalBundle).split(sep).join("/"))
      .toBe(bundleRelativePath);
    const bytes = readFileSync(canonicalBundle);
    expect(file!.bytes).toBe(bytes.byteLength);
    expect(file!.bytes).toBeGreaterThan(0);
    expect(file!.bytes).toBeLessThanOrEqual(16 * 1024 * 1024);
    expect(file!.sha256).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(readdirSync(dirname(canonicalBundle))).toEqual(["electron-main.js"]);
  });

  it("pins launcher release constants to the reviewed real bundle identity", () => {
    const source = readFileSync(launcherPath, "utf8");
    const start = source.indexOf(reviewedElectronReleaseIdentityStart);
    const end = source.indexOf(reviewedElectronReleaseIdentityEnd);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const block = source.slice(start, end);
    const relativePath =
      /\$reviewedElectronMainRelativePath\s*=\s*'([^']+)'/u.exec(block)?.[1];
    const bytes = Number(
      /\$reviewedElectronMainBytes\s*=\s*(\d+)L/u.exec(block)?.[1],
    );
    const sha256 =
      /\$reviewedElectronMainSha256\s*=\s*'([0-9a-f]{64})'/u.exec(block)?.[1];
    const importsBlock =
      /\$reviewedElectronMainRuntimeImports\s*=\s*@\(([\s\S]*?)\)/u.exec(
        block,
      )?.[1] ?? "";
    const runtimeImports = [...importsBlock.matchAll(/^\s*'([^']+)'\s*$/gmu)]
      .map((match) => match[1]);
    const expectedReleaseIdentity = {
      relativePath: "apps/controller/dist/main/electron-main.js",
      bytes: 448616,
      sha256:
        "e7004b3b551be57a6c4425d0e2301a9db9e2063786a28e5b93aeccc3abfe1bb4",
      runtimeImports: [
        "electron",
        "node:child_process",
        "node:crypto",
        "node:fs",
        "node:fs/promises",
        "node:net",
        "node:path",
        "node:perf_hooks",
        "node:url",
        "node:util",
      ],
    };
    expect({ relativePath, bytes, sha256, runtimeImports }).toEqual(
      expectedReleaseIdentity,
    );

    const verifierResult = runVerifier(repositoryRoot);
    expect(
      verifierResult.status,
      verifierResult.stderr || verifierResult.error?.message,
    ).toBe(0);
    const manifest = readManifest(verifierResult.stdout);
    expect({ ...manifest.files[0], runtimeImports: manifest.runtimeImports })
      .toEqual(expectedReleaseIdentity);
    const realBundle = readFileSync(
      join(repositoryRoot, ...expectedReleaseIdentity.relativePath.split("/")),
    );
    expect({
      bytes: realBundle.byteLength,
      sha256: createHash("sha256").update(realBundle).digest("hex"),
    }).toEqual({
      bytes: 448616,
      sha256:
        "e7004b3b551be57a6c4425d0e2301a9db9e2063786a28e5b93aeccc3abfe1bb4",
    });
  });

  it("rejects a non-electron bare package import", () => {
    const fixture = createVerifierFixture('import "left-pad";\n');

    const result = runVerifier(fixture.root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Unsupported Electron-main runtime import");
  });

  it.each([
    [
      "process.getBuiltinModule createRequire",
      'import "electron"; const load = process.getBuiltinModule("module").createRequire(import.meta.url); load("zod");\n',
    ],
    [
      "imported createRequire",
      'import "electron"; import { createRequire } from "node:module"; const load = createRequire(import.meta.url); load("zod");\n',
    ],
    ["module.require", 'import "electron"; module.require("zod");\n'],
    ["computed module require", 'import "electron"; module["require"]("zod");\n'],
    ["direct require reference", 'import "electron"; const load = require; load("zod");\n'],
    ["direct require call", 'import "electron"; require("zod");\n'],
    [
      "eval reconstruction",
      'import "electron"; eval(\'process.getBuiltinModule("module").createRequire(import.meta.url)("zod")\');\n',
    ],
    [
      "computed getBuiltinModule",
      'import "electron"; process["getBuiltinModule"]("module").createRequire(import.meta.url)("zod");\n',
    ],
    [
      "concatenated element access",
      'import "electron"; process["get" + "BuiltinModule"]("module")["create" + "Require"](import.meta.url)("zod");\n',
    ],
    [
      "Reflect.get concatenated access",
      'import "electron"; const moduleBuiltin = Reflect.get(process, "get" + "BuiltinModule")("module"); Reflect.get(moduleBuiltin, "create" + "Require")(import.meta.url)("zod");\n',
    ],
    [
      "templated element access",
      'import "electron"; process[`get${"Builtin"}Module`]("module")[`create${"Require"}`](import.meta.url)("zod");\n',
    ],
    [
      "Reflect.get templated access",
      'import "electron"; const runtimeProcess = process; const moduleBuiltin = Reflect.get(runtimeProcess, `get${"Builtin"}Module`)("module"); Reflect.get(moduleBuiltin, `create${"Require"}`)(import.meta.url)("zod");\n',
    ],
  ] as const)("rejects dynamic loader bypass through %s", (_label, source) => {
    const fixture = createVerifierFixture(source);

    const result = runVerifier(fixture.root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("dynamic loader");
  });

  it("never executes the candidate bundle or legacy adapters while verifying", () => {
    const fixture = createVerifierFixture([
      'import { writeFileSync } from "node:fs";',
      'writeFileSync("candidate-executed", "unsafe");',
      "",
    ].join("\n"));

    const result = runVerifier(fixture.root);

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(fixture.mainSentinel)).toBe(false);
    expect(existsSync(fixture.adapterSentinel)).toBe(false);
  });

  it("records exact electron and valid node builtins as sorted unique externals", () => {
    const fixture = createVerifierFixture([
      'import { app } from "electron";',
      'import { readFileSync } from "node:fs";',
      'import { resolve } from "node:path";',
      "void app; void readFileSync; void resolve;",
      "",
    ].join("\n"));

    const result = runVerifier(fixture.root);

    expect(result.status, result.stderr).toBe(0);
    expect(readManifest(result.stdout)).toMatchObject({
      schema: 2,
      status: "compiled-electron-main-bundle-verified",
      files: [{ relativePath: bundleRelativePath }],
      runtimeImports: ["electron", "node:fs", "node:path"],
    });
  });

  it.each([
    ["relative chunk import", 'import "./chunk.js";\n'],
    ["literal dynamic import", 'await import("node:fs");\n'],
    ["ambiguous dynamic import", 'const id = "node:fs"; await import(id);\n'],
    ["CommonJS require", 'require("node:fs");\n'],
    ["non-electron bare import", 'import "zod";\n'],
    ["invalid node namespace", 'import "node:not-a-real-builtin";\n'],
  ] as const)("fails closed on %s", (_label, source) => {
    const fixture = createVerifierFixture(source, {
      "chunk.js": "export const chunk = true;\n",
    });

    const result = runVerifier(fixture.root);

    expect(result.status).not.toBe(0);
  });

  it("rejects a missing or oversized one-file candidate", () => {
    const missing = createVerifierFixture();
    rmSync(missing.bundle);
    const missingResult = runVerifier(missing.root);
    expect(missingResult.status).not.toBe(0);

    const oversized = createVerifierFixture();
    writeFileSync(oversized.bundle, Buffer.alloc(16 * 1024 * 1024 + 1, 0x61));
    const oversizedResult = runVerifier(oversized.root);
    expect(oversizedResult.status).not.toBe(0);
    expect(oversizedResult.stderr).toContain("bundle size is outside the finite bound");
  });
});
