import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();

describe("compiled Electron module graph", () => {
  it("loads the real G2 and Task 9 runtime graphs through the serialized verifier", () => {
    const verifier = join(repositoryRoot, "scripts", "verify-electron-module-graph.mjs");
    const result = spawnSync(
      process.execPath,
      [verifier],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        timeout: 15_000,
      },
    );

    expect(result.status, result.stderr || result.error?.message).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      schema: 1,
      status: "compiled-g2-and-show-module-graphs-verified",
    });
  });

  it("rejects a nested emitted import that points at a TypeScript source extension", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "janvim-module-graph-"));
    const fixtureScripts = join(fixtureRoot, "scripts");
    const fixtureDist = join(fixtureRoot, "apps", "controller", "dist", "src");

    try {
      mkdirSync(fixtureScripts, { recursive: true });
      mkdirSync(fixtureDist, { recursive: true });
      copyFileSync(
        join(repositoryRoot, "scripts", "verify-electron-module-graph.mjs"),
        join(fixtureScripts, "verify-electron-module-graph.mjs"),
      );
      writeFileSync(join(fixtureDist, "g2-runtime-adapters.js"), "export const g2 = true;\n");
      writeFileSync(
        join(fixtureDist, "show-runtime-adapters.js"),
        'import "./nested.js";\nexport const show = true;\n',
      );
      writeFileSync(join(fixtureDist, "nested.js"), 'import "./source.ts";\n');

      const result = spawnSync(
        process.execPath,
        [join(fixtureScripts, "verify-electron-module-graph.mjs")],
        {
          cwd: fixtureRoot,
          encoding: "utf8",
          timeout: 15_000,
        },
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("TypeScript source extension");
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
