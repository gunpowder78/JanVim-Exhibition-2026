import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();
const npmCli = process.env.npm_execpath;

describe("compiled Electron module graph", () => {
  it("loads the real G2 runtime adapter graph after a project build", () => {
    if (npmCli === undefined) throw new Error("npm_execpath is required for the build smoke test");
    execFileSync(process.execPath, [npmCli, "run", "build"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: 30_000,
    });

    const adapterUrl = pathToFileURL(
      join(repositoryRoot, "apps", "controller", "dist", "src", "g2-runtime-adapters.js"),
    ).href;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", `await import(${JSON.stringify(adapterUrl)})`],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        timeout: 15_000,
      },
    );

    expect(result.status, result.stderr || result.error?.message).toBe(0);
  });
});
