import { describe, expect, it } from "vitest";

import {
  buildJanVimChildEnvironment,
  launchJanVimProcess,
  type JanVimLaunchConfig,
  type SpawnAdapter,
} from "../src/janvim-process.ts";

const config: JanVimLaunchConfig = {
  artifactLockPath: "D:\\show\\janvim-artifact.lock.json",
  executablePath: "D:\\show\\runtime\\janvim\\janvim-core.exe",
  workingDirectory: "D:\\show\\runtime\\janvim",
  arguments: ["--config", "D:\\show\\show\\janvim-show.toml"],
  privateUserRoot: "D:\\show\\runtime\\user-root",
  bridgePort: 32123,
  bridgeToken: "fixture-process-token-2026",
};

describe("JanVim process launcher", () => {
  it("does not spawn when immutable artifact verification fails", async () => {
    let spawnCount = 0;
    const result = await launchJanVimProcess(config, {
      baseEnvironment: { HOME: "D:\\Users\\operator" },
      verifyArtifact: async () => ({ ok: false, reason: "core-hash-mismatch" }),
      spawn: (() => {
        spawnCount += 1;
        return { pid: 99 };
      }) as SpawnAdapter,
    });

    expect(result).toEqual({ started: false, reason: "core-hash-mismatch" });
    expect(spawnCount).toBe(0);
  });

  it("preserves inherited user variables and adds the product user root plus bridge values", () => {
    const base = {
      HOME: "D:\\Users\\operator",
      XDG_CONFIG_HOME: "D:\\Users\\operator\\.config",
      PATH: "C:\\Windows\\System32",
    };
    const environment = buildJanVimChildEnvironment(base, config);

    expect(base).toEqual({
      HOME: "D:\\Users\\operator",
      XDG_CONFIG_HOME: "D:\\Users\\operator\\.config",
      PATH: "C:\\Windows\\System32",
    });
    expect(environment).toEqual({
      ...base,
      JANVIM_USER_ROOT: config.privateUserRoot,
      JANVIM_EXHIBITION_PORT: "32123",
      JANVIM_EXHIBITION_TOKEN: config.bridgeToken,
    });
    expect(environment).not.toHaveProperty("JANVIM_EXHIBITION_USER_ROOT");
  });

  it("spawns the exact verified executable without a shell and returns its PID", async () => {
    const calls: Array<{ file: string; args: readonly string[]; options: unknown }> = [];
    const result = await launchJanVimProcess(config, {
      baseEnvironment: { HOME: "D:\\Users\\operator" },
      verifyArtifact: async (lockPath, executablePath) => {
        expect(lockPath).toBe(config.artifactLockPath);
        expect(executablePath).toBe(config.executablePath);
        return { ok: true };
      },
      spawn: (file, args, options) => {
        calls.push({ file, args, options });
        return { pid: 5150 };
      },
    });

    expect(result).toMatchObject({ started: true, pid: 5150 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      file: config.executablePath,
      args: config.arguments,
      options: {
        cwd: config.workingDirectory,
        shell: false,
        windowsHide: false,
      },
    });
  });

  it("rejects invalid port, token, paths, and missing child PIDs", async () => {
    expect(() => buildJanVimChildEnvironment({}, { ...config, bridgePort: 0 })).toThrow(/port/i);
    expect(() =>
      buildJanVimChildEnvironment({}, { ...config, bridgeToken: "short" }),
    ).toThrow(/token/i);

    await expect(
      launchJanVimProcess(config, {
        baseEnvironment: {},
        verifyArtifact: async () => ({ ok: true }),
        spawn: () => ({ pid: undefined }),
      }),
    ).resolves.toEqual({ started: false, reason: "spawn-missing-pid" });
  });
});
