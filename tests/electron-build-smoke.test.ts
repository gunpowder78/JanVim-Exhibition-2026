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
  const parserImplementation = join(
    root,
    "node_modules",
    "typescript",
    "lib",
    "typescript.js",
  );
  mkdirSync(join(parserImplementation, ".."), { recursive: true });
  copyFileSync(
    join(repositoryRoot, "node_modules", "typescript", "lib", "typescript.js"),
    parserImplementation,
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

function manifestPaths(stdout: string): string[] {
  const output = JSON.parse(stdout) as {
    files: Array<{ relativePath: string }>;
  };
  return output.files.map((file) => file.relativePath);
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

  it("discovers a comment-separated side-effect import", () => {
    const fixture = createVerifierFixture({
      "electron-main.js": 'import/* bounded comment */"./comment-child.js";\n',
      "comment-child.js": "export const commentChild = true;\n",
    });

    const result = runVerifier(fixture.root);

    expect(result.status, result.stderr).toBe(0);
    expect(manifestPaths(result.stdout)).toEqual([
      "apps/controller/dist/src/comment-child.js",
      "apps/controller/dist/src/electron-main.js",
    ]);
  });

  it("discovers a compact export-from edge", () => {
    const fixture = createVerifierFixture({
      "electron-main.js": 'export{value}from"./export-child.js";\n',
      "export-child.js": "export const value = true;\n",
    });

    const result = runVerifier(fixture.root);

    expect(result.status, result.stderr).toBe(0);
    expect(manifestPaths(result.stdout)).toEqual([
      "apps/controller/dist/src/electron-main.js",
      "apps/controller/dist/src/export-child.js",
    ]);
  });

  it("discovers a literal local require in a reachable cjs module", () => {
    const fixture = createVerifierFixture({
      "electron-main.js": 'import "./parent.cjs";\n',
      "parent.cjs": 'module.exports = require("./required-child.cjs");\n',
      "required-child.cjs": "module.exports = true;\n",
    });

    const result = runVerifier(fixture.root);

    expect(result.status, result.stderr).toBe(0);
    expect(manifestPaths(result.stdout)).toEqual([
      "apps/controller/dist/src/electron-main.js",
      "apps/controller/dist/src/parent.cjs",
      "apps/controller/dist/src/required-child.cjs",
    ]);
  });

  it("discovers a normalized escaped bare require identifier", () => {
    const fixture = createVerifierFixture({
      "electron-main.js": 'import "./escaped-require-parent.cjs";\n',
      "escaped-require-parent.cjs":
        'module.exports = requ\\u0069re("./escaped-require-child.cjs");\n',
      "escaped-require-child.cjs": "module.exports = true;\n",
    });

    const result = runVerifier(fixture.root);

    expect(result.status, result.stderr).toBe(0);
    expect(manifestPaths(result.stdout)).toEqual([
      "apps/controller/dist/src/electron-main.js",
      "apps/controller/dist/src/escaped-require-child.cjs",
      "apps/controller/dist/src/escaped-require-parent.cjs",
    ]);
  });

  it("ignores import-like text in comments, strings, regexes, and template raw text", () => {
    const fixture = createVerifierFixture({
      "electron-main.js": [
        'import "./real-child.js";',
        '// import("./line-comment-child.js");',
        '/* export { value } from "./block-comment-child.js"; */',
        'const text = \'require("./string-child.cjs") import("./string-dynamic.js")\';',
        'const pattern = /import\\(["\']\\.\\/regex-child\\.js["\']\\)/u;',
        'const template = `export * from "./template-export.js"; import("./template-child.js")`;',
        "void text; void pattern; void template;",
        "",
      ].join("\n"),
      "real-child.js": "export const real = true;\n",
    });

    const result = runVerifier(fixture.root);

    expect(result.status, result.stderr).toBe(0);
    expect(manifestPaths(result.stdout)).toEqual([
      "apps/controller/dist/src/electron-main.js",
      "apps/controller/dist/src/real-child.js",
    ]);
  });

  it("discovers literal dynamic imports inside executable template expressions", () => {
    const fixture = createVerifierFixture({
      "electron-main.js":
        'const value = `loaded:${await import("./template-expression-child.js")}`;\nvoid value;\n',
      "template-expression-child.js": "export const child = true;\n",
    });

    const result = runVerifier(fixture.root);

    expect(result.status, result.stderr).toBe(0);
    expect(manifestPaths(result.stdout)).toEqual([
      "apps/controller/dist/src/electron-main.js",
      "apps/controller/dist/src/template-expression-child.js",
    ]);
  });

  it.each([
    ["a control block", "if (true) {}"],
    ["a function body", "function boundedFunction() {}"],
    ["a class body", "class BoundedClass {}"],
  ] as const)("treats a regex after %s as inert text", (_label, prefix) => {
    const fixture = createVerifierFixture({
      "electron-main.js": [
        `${prefix} /import\\("\\.\\/regex-decoy\\.js"\\)/u.test("");`,
        'import "./regex-real-child.js";',
        "",
      ].join("\n"),
      "regex-real-child.js": "export const child = true;\n",
    });

    const result = runVerifier(fixture.root);

    expect(result.status, result.stderr).toBe(0);
    expect(manifestPaths(result.stdout)).toEqual([
      "apps/controller/dist/src/electron-main.js",
      "apps/controller/dist/src/regex-real-child.js",
    ]);
  });

  it("treats a slash after an object literal as division", () => {
    const fixture = createVerifierFixture({
      "electron-main.js": [
        "const ratio = { valueOf() { return 8; } } /",
        '  import("./division-child.js");',
        "void ratio;",
        "",
      ].join("\n"),
      "division-child.js": "export const child = true;\n",
    });

    const result = runVerifier(fixture.root);

    expect(result.status, result.stderr).toBe(0);
    expect(manifestPaths(result.stdout)).toEqual([
      "apps/controller/dist/src/division-child.js",
      "apps/controller/dist/src/electron-main.js",
    ]);
  });

  it("discovers dynamic imports in class, function, and arrow expression division", () => {
    const fixture = createVerifierFixture({
      "electron-main.js": [
        'void (class {} / import(".\\/class-expression-child.js") / 1);',
        'void (function () {} / import(".\\/function-expression-child.js") / 1);',
        'void (() => function () {} / import(".\\/arrow-expression-child.js") / 1)();',
        "",
      ].join("\n"),
      "class-expression-child.js": "export const child = true;\n",
      "function-expression-child.js": "export const child = true;\n",
      "arrow-expression-child.js": "export const child = true;\n",
    });

    const result = runVerifier(fixture.root);

    expect(result.status, result.stderr).toBe(0);
    expect(manifestPaths(result.stdout)).toEqual([
      "apps/controller/dist/src/arrow-expression-child.js",
      "apps/controller/dist/src/class-expression-child.js",
      "apps/controller/dist/src/electron-main.js",
      "apps/controller/dist/src/function-expression-child.js",
    ]);
  });

  it("discovers a static import carrying attributes", () => {
    const fixture = createVerifierFixture({
      "electron-main.js":
        'import value from "./attribute-child.js" with { type: "json" };\nvoid value;\n',
      "attribute-child.js": "export default true;\n",
    });

    const result = runVerifier(fixture.root);

    expect(result.status, result.stderr).toBe(0);
    expect(manifestPaths(result.stdout)).toEqual([
      "apps/controller/dist/src/attribute-child.js",
      "apps/controller/dist/src/electron-main.js",
    ]);
  });

  it("discovers executable local edges inside bounded dynamic import options", () => {
    const fixture = createVerifierFixture({
      "electron-main.js": 'import "./options-parent.cjs";\n',
      "options-parent.cjs": [
        'void import("./options-child.js", {',
        "  with: {",
        '    type: (require("./nested-option.cjs"), "json"),',
        '    mode: (import("./nested-option.js"), "bounded"),',
        "  },",
        "});",
        "",
      ].join("\n"),
      "options-child.js": "export default true;\n",
      "nested-option.cjs": "module.exports = true;\n",
      "nested-option.js": "export const nested = true;\n",
    });

    const result = runVerifier(fixture.root);

    expect(result.status, result.stderr).toBe(0);
    expect(manifestPaths(result.stdout)).toEqual([
      "apps/controller/dist/src/electron-main.js",
      "apps/controller/dist/src/nested-option.cjs",
      "apps/controller/dist/src/nested-option.js",
      "apps/controller/dist/src/options-child.js",
      "apps/controller/dist/src/options-parent.cjs",
    ]);
  });

  it.each([
    [
      "computed dynamic import",
      {
        "electron-main.js":
          'const child = "./computed-child.js";\nawait import(child);\n',
      },
      "Unsupported ambiguous dynamic import",
    ],
    [
      "computed cjs require",
      {
        "electron-main.js": 'import "./computed-parent.cjs";\n',
        "computed-parent.cjs":
          'const child = "./computed-child.cjs";\nmodule.exports = require(child);\n',
      },
      "Unsupported ambiguous require",
    ],
    [
      "unterminated block comment",
      { "electron-main.js": "/* import-like text never closes" },
      "Malformed emitted JavaScript",
    ],
  ] as const)("fails closed on %s", (_label, files, reason) => {
    const fixture = createVerifierFixture(files);

    const result = runVerifier(fixture.root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(reason);
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
