import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

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
  files: Readonly<Record<string, string>> = {},
): { root: string; dist: string } {
  const root = mkdtempSync(join(tmpdir(), "janvim-module-graph-"));
  temporaryRoots.push(root);
  const scripts = join(root, "scripts");
  const dist = join(root, "apps", "controller", "dist", "src");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(dist, { recursive: true });
  copyFileSync(
    join(repositoryRoot, "scripts", "verify-electron-module-graph.mjs"),
    join(scripts, "verify-electron-module-graph.mjs"),
  );
  const completeFiles = {
    "electron-main.js": "export const electronMain = true;\n",
    "g2-runtime-adapters.js": "export const g2 = true;\n",
    "show-runtime-adapters.js": "export const show = true;\n",
    ...files,
  };
  for (const [relativePath, source] of Object.entries(completeFiles)) {
    const path = join(dist, ...relativePath.split("/"));
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, source);
  }
  return { root, dist };
}

describe("compiled Electron module graph", () => {
  it("emits the bounded canonical sorted and hashed real electron-main graph", () => {
    const result = runVerifier(repositoryRoot);

    expect(result.status, result.stderr || result.error?.message).toBe(0);
    expect(result.stdout.endsWith("\n")).toBe(true);
    const output = JSON.parse(result.stdout) as {
      schema: number;
      status: string;
      files: Array<{ relativePath: string; bytes: number; sha256: string }>;
    };
    expect(Object.keys(output)).toEqual(["schema", "status", "files"]);
    expect(output.schema).toBe(1);
    expect(output.status).toBe("compiled-electron-main-graph-verified");
    expect(output.files.length).toBeGreaterThan(0);
    expect(output.files.length).toBeLessThanOrEqual(256);

    const relativePaths = output.files.map((file) => file.relativePath);
    expect(relativePaths).toEqual([...relativePaths].sort());
    expect(new Set(relativePaths).size).toBe(relativePaths.length);
    expect(relativePaths).toContain("apps/controller/dist/src/electron-main.js");
    const canonicalRepositoryRoot = realpathSync.native(repositoryRoot);
    for (const file of output.files) {
      expect(Object.keys(file)).toEqual(["relativePath", "bytes", "sha256"]);
      expect(file.relativePath).toMatch(
        /^apps\/controller\/dist\/src\/(?:[^/]+\/)*(?:[^/]+\.(?:js|mjs|cjs))$/u,
      );
      expect(file.relativePath).not.toContain("\\");
      const canonicalPath = realpathSync.native(
        join(repositoryRoot, ...file.relativePath.split("/")),
      );
      expect(relative(canonicalRepositoryRoot, canonicalPath).split(sep).join("/")).toBe(
        file.relativePath,
      );
      const bytes = readFileSync(canonicalPath);
      expect(file.bytes).toBeGreaterThan(0);
      expect(file.bytes).toBeLessThanOrEqual(16 * 1024 * 1024);
      expect(file.bytes).toBe(bytes.byteLength);
      expect(file.sha256).toBe(
        createHash("sha256").update(bytes).digest("hex"),
      );
    }
  });

  it("rejects a nested TypeScript import reachable only from electron-main", () => {
    const fixture = createVerifierFixture({
      "electron-main.js": 'import "./nested.js";\nexport const entry = true;\n',
      "nested.js": 'import "./source.ts";\nexport const nested = true;\n',
    });

    const result = runVerifier(fixture.root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("TypeScript source extension");
  });

  it("rejects a local import that escapes the canonical controller dist root", () => {
    const fixture = createVerifierFixture({
      "electron-main.js": 'import "../../../../escaped.js";\n',
    });

    const result = runVerifier(fixture.root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("escaped controller dist");
  });

  it("rejects a missing local emitted module", () => {
    const fixture = createVerifierFixture({
      "electron-main.js": 'import "./missing.js";\n',
    });

    const result = runVerifier(fixture.root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Missing emitted local module");
  });

  it("rejects distinct local paths that resolve to one canonical module", () => {
    const fixture = createVerifierFixture({
      "electron-main.js": [
        'import "./shared/module.js";',
        'import "./alias/module.js";',
        "",
      ].join("\n"),
      "shared/module.js": "export const shared = true;\n",
    });
    symlinkSync(join(fixture.dist, "shared"), join(fixture.dist, "alias"), "junction");

    const result = runVerifier(fixture.root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Duplicate canonical emitted module path");
  });

  it("rejects an electron-main graph containing 257 modules", () => {
    const files: Record<string, string> = {
      "electron-main.js": 'import "./module-000.js";\n',
    };
    for (let index = 0; index < 256; index += 1) {
      const name = `module-${String(index).padStart(3, "0")}.js`;
      files[name] =
        index === 255
          ? "export const last = true;\n"
          : `import "./module-${String(index + 1).padStart(3, "0")}.js";\n`;
    }
    const fixture = createVerifierFixture(files);

    const result = runVerifier(fixture.root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("exceeds 256 modules");
  });

  it("rejects an emitted module larger than the finite file bound", () => {
    const fixture = createVerifierFixture({
      "electron-main.js": 'import "./oversized.js";\n',
      "oversized.js": "export const oversized = true;\n",
    });
    truncateSync(join(fixture.dist, "oversized.js"), 16 * 1024 * 1024 + 1);

    const result = runVerifier(fixture.root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("module size is outside the finite bound");
  });

  it("statically verifies electron-main without executing it", () => {
    const fixture = createVerifierFixture({
      "electron-main.js": [
        'import { writeFileSync } from "node:fs";',
        'writeFileSync("electron-main-executed", "unsafe");',
        "",
      ].join("\n"),
    });

    const result = runVerifier(fixture.root);

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(join(fixture.root, "electron-main-executed"))).toBe(false);
  });
});
