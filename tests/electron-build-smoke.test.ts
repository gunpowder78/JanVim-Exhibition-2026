import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();

describe("compiled Electron module graph", () => {
  it("loads the real G2 runtime adapter graph through the serialized verifier", () => {
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
  });
});
