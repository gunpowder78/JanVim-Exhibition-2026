import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, win32 } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();
const productionScript = join(
  repositoryRoot,
  "scripts",
  "configure-displays.ps1",
);
const rehearsalParent = "D:\\VirtualData\\JanVim-Exhibition-Rehearsals";
const protectedPath =
  "D:\\VirtualData\\TempCache\\janvim-task5-physical-cached-e9735e8d02e34ff4a4ac8836f8e22dcb";

interface LauncherFixture {
  root: string;
  script: string;
  externalRoot: string;
  externalMap: string;
  invocationLog: string;
  layoutSentinel: string;
  cleanup(): void;
}

function makeFixture(): LauncherFixture {
  const root = mkdtempSync(join(tmpdir(), "janvim-display-config-launcher-"));
  const externalRoot = win32.join(
    rehearsalParent,
    `g4-config-${randomUUID()}`,
  );
  const externalMap = win32.join(externalRoot, "display-map.json");
  const script = join(root, "scripts", "configure-displays.ps1");
  const invocationLog = join(root, "electron-invocation.log");
  const layoutSentinel = join(root, "show", "display-layout.json");
  const requiredFiles = [
    script,
    join(root, "node_modules", ".bin", "electron.cmd"),
    join(root, "apps", "controller", "dist", "main", "electron-main.js"),
    join(
      root,
      "apps",
      "controller",
      "dist",
      "display-config-preload",
      "display-config-preload.cjs",
    ),
    join(root, "apps", "display-configurator", "dist", "index.html"),
    join(root, "apps", "display-configurator", "dist", "identify.html"),
    layoutSentinel,
  ];
  for (const file of requiredFiles) mkdirSync(dirname(file), { recursive: true });

  if (existsSync(productionScript)) copyFileSync(productionScript, script);
  writeFileSync(
    join(root, "AGENTS.md"),
    "# JanVim Exhibition 2026 agent instructions\n",
    "utf8",
  );
  writeFileSync(layoutSentinel, '{"schema":1,"sentinel":true}\n', "utf8");
  for (const file of requiredFiles.slice(2, 6)) {
    writeFileSync(file, "build sentinel\n", "utf8");
  }
  writeFileSync(
    join(root, "node_modules", ".bin", "electron.cmd"),
    [
      "@echo off",
      'echo %*>>"%DISPLAY_CONFIG_TEST_INVOCATION_LOG%"',
      "exit /b %DISPLAY_CONFIG_TEST_ELECTRON_EXIT%",
      "",
    ].join("\r\n"),
    "utf8",
  );

  return {
    root,
    script,
    externalRoot,
    externalMap,
    invocationLog,
    layoutSentinel,
    cleanup: () => {
      if (
        win32.dirname(externalRoot).toLowerCase() !==
        rehearsalParent.toLowerCase()
      ) {
        throw new Error("refusing to clean unexpected rehearsal path");
      }
      rmSync(externalRoot, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function runLauncher(
  fixture: LauncherFixture,
  arguments_: readonly string[],
  electronExit = 0,
) {
  return spawnSync(
    "pwsh",
    ["-NoProfile", "-NonInteractive", "-File", fixture.script, ...arguments_],
    {
      cwd: fixture.root,
      encoding: "utf8",
      env: {
        ...process.env,
        DISPLAY_CONFIG_TEST_ELECTRON_EXIT: String(electronExit),
        DISPLAY_CONFIG_TEST_INVOCATION_LOG: fixture.invocationLog,
      },
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    },
  );
}

function validArguments(fixture: LauncherFixture): string[] {
  return [
    "-RehearsalRoot",
    fixture.externalRoot,
    "-DisplayMapPath",
    fixture.externalMap,
  ];
}

describe("public manual display configurator launcher", () => {
  it("creates only the fresh rehearsal root and invokes one closed command", () => {
    const fixture = makeFixture();
    try {
      const before = readFileSync(fixture.layoutSentinel, "utf8");
      const result = runLauncher(fixture, validArguments(fixture));

      expect(result.status, result.stderr).toBe(0);
      expect(existsSync(fixture.externalRoot)).toBe(true);
      expect(existsSync(fixture.externalMap)).toBe(false);
      const invocation = readFileSync(fixture.invocationLog, "utf8");
      expect(invocation).toContain("--display-config-mode=configure");
      expect(invocation).toContain(`--rehearsal-root=${fixture.externalRoot}`);
      expect(invocation).toContain(`--display-map=${fixture.externalMap}`);
      expect(readFileSync(fixture.layoutSentinel, "utf8")).toBe(before);
      expect(JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)!)).toEqual({
        schema: 1,
        mode: "ConfigureDisplays",
        exitCode: 0,
        displayMapPath: fixture.externalMap,
      });
    } finally {
      fixture.cleanup();
    }
  });

  it("allows an existing direct root and map for atomic replacement", () => {
    const fixture = makeFixture();
    try {
      mkdirSync(fixture.externalRoot, { recursive: false });
      writeFileSync(fixture.externalMap, "old map\n", "utf8");

      const result = runLauncher(fixture, validArguments(fixture));

      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(fixture.externalMap, "utf8")).toBe("old map\n");
    } finally {
      fixture.cleanup();
    }
  });

  it("preflights every build artifact before creating a root", () => {
    const fixture = makeFixture();
    try {
      rmSync(
        join(
          fixture.root,
          "apps",
          "controller",
          "dist",
          "display-config-preload",
          "display-config-preload.cjs",
        ),
      );

      const result = runLauncher(fixture, validArguments(fixture));

      expect(result.status).not.toBe(0);
      expect(existsSync(fixture.externalRoot)).toBe(false);
      expect(existsSync(fixture.invocationLog)).toBe(false);
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects relative, nested, wrong-basename, and protected paths before Electron", () => {
    const cases = [
      ["-RehearsalRoot", ".\\relative", "-DisplayMapPath", ".\\display-map.json"],
      [
        "-RehearsalRoot",
        `${rehearsalParent}\\nested\\child`,
        "-DisplayMapPath",
        `${rehearsalParent}\\nested\\child\\display-map.json`,
      ],
      [
        "-RehearsalRoot",
        `${rehearsalParent}\\g4-config-invalid`,
        "-DisplayMapPath",
        `${rehearsalParent}\\g4-config-invalid\\other.json`,
      ],
      [
        "-RehearsalRoot",
        protectedPath,
        "-DisplayMapPath",
        `${protectedPath}\\display-map.json`,
      ],
    ];

    for (const arguments_ of cases) {
      const fixture = makeFixture();
      try {
        const result = runLauncher(fixture, arguments_);
        expect(result.status).not.toBe(0);
        expect(existsSync(fixture.invocationLog)).toBe(false);
      } finally {
        fixture.cleanup();
      }
    }
  });

  it("propagates the exact Electron exit code in process status and receipt", () => {
    const fixture = makeFixture();
    try {
      const result = runLauncher(fixture, validArguments(fixture), 7);

      expect(result.status).toBe(7);
      expect(JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)!)).toEqual({
        schema: 1,
        mode: "ConfigureDisplays",
        exitCode: 7,
        displayMapPath: fixture.externalMap,
      });
    } finally {
      fixture.cleanup();
    }
  });
});
