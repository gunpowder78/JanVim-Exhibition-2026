import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";
import { build } from "vite";

const repositoryRoot = process.cwd();
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("file-loaded secondary build", () => {
  it("emits only local asset references that resolve beside index.html", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "janvim-secondary-file-entry-"));
    temporaryRoots.push(outDir);

    await build({
      configFile: join(repositoryRoot, "apps", "secondary-screen", "vite.config.ts"),
      logLevel: "silent",
      build: { outDir, emptyOutDir: true },
    });

    const entryPath = join(outDir, "index.html");
    const html = readFileSync(entryPath, "utf8");
    const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(
      (match) => match[1]!,
    );
    expect(references.length).toBeGreaterThanOrEqual(2);

    for (const reference of references) {
      const resolved = fileURLToPath(new URL(reference, pathToFileURL(entryPath)));
      expect(relative(outDir, resolved).startsWith(`..${sep}`)).toBe(false);
      expect(dirname(resolved).startsWith(outDir)).toBe(true);
      expect(existsSync(resolved)).toBe(true);
    }
  });
});
