import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("toolchain pinned versions", () => {
  const root = process.cwd();

  const packageJsonPath = join(root, "package.json");
  const packageLockPath = join(root, "package-lock.json");

  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    engines?: { node?: string };
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  const packageLock = JSON.parse(readFileSync(packageLockPath, "utf8")) as {
    lockfileVersion?: number;
  };

  it("pins node engine and scripts for build/test/lint/typecheck", () => {
    expect(packageJson.engines?.node).toBe("22.23.0");
    expect(packageJson.scripts).toMatchObject({
      build: expect.any(String),
      test: expect.any(String),
      lint: expect.any(String),
      typecheck: expect.any(String),
    });
  });

  it("uses exact dependency versions and does not allow semver ranges", () => {
    const exactVersion = /^\d+\.\d+\.\d+(-[\w.-]+)?$/;
    const versions = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    for (const [name, version] of Object.entries(versions)) {
      expect(version).toMatch(exactVersion);
    }
  });

  it("creates lockfile v3", () => {
    expect(packageLock.lockfileVersion).toBe(3);
  });
});
