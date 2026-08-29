import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();

describe("frozen G2 show runtime selection", () => {
  it("locks the explicit orthogonal Plugin Lab config by its exact bytes", () => {
    const configBytes = readFileSync(
      join(repositoryRoot, "show", "janvim-show.toml"),
    );
    const lock = JSON.parse(
      readFileSync(join(repositoryRoot, "janvim-artifact.lock.json"), "utf8"),
    ) as {
      configSha256?: string;
      layoutEngine?: string;
    };

    expect(lock.layoutEngine).toBe("orthogonal");
    expect(lock.configSha256).toBe(createHash("sha256").update(configBytes).digest("hex"));
  });

  it.each([
    "show/janvim-show.toml",
    "content/fixture/poem.txt",
  ])("checks out hash-sensitive input %s with LF bytes", (path) => {
    const result = spawnSync(
      "git",
      ["check-attr", "eol", "--", path],
      { cwd: repositoryRoot, encoding: "utf8", timeout: 5_000 },
    );

    expect(result.status, result.stderr || result.error?.message).toBe(0);
    expect(result.stdout.trim()).toBe(`${path}: eol: lf`);
  });
});
