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
const productionScript = join(repositoryRoot, "scripts", "start-g2-rehearsal.ps1");
const rehearsalParent = "D:\\VirtualData\\JanVim-Exhibition-Rehearsals";
const protectedPath =
  "D:\\VirtualData\\TempCache\\janvim-task5-physical-cached-e9735e8d02e34ff4a4ac8836f8e22dcb";

interface LauncherFixture {
  root: string;
  script: string;
  externalRoot: string;
  externalMap: string;
  invocationLog: string;
  sequenceLog: string;
  checkedInMap: string;
  checkedInMapBefore: string;
  runtimeSentinel: string;
  entrySentinel: string;
  cleanup(): void;
}

function makeLauncherFixture(): LauncherFixture {
  if (!existsSync(productionScript)) {
    throw new Error(`production launcher missing: ${productionScript}`);
  }
  const root = mkdtempSync(join(tmpdir(), "janvim-g2-launcher-"));
  const externalRoot = win32.join(rehearsalParent, `g2-launcher-${randomUUID()}`);
  const externalMap = win32.join(externalRoot, "display-map.json");
  const script = join(root, "scripts", "start-g2-rehearsal.ps1");
  const invocationLog = join(root, "electron-invocation.log");
  const sequenceLog = join(root, "sequence.log");
  const checkedInMap = join(root, "show", "display-map.json");
  const runtimeSentinel = join(root, "runtime", "janvim", "janvim-core.exe");
  const entrySentinel = join(
    root,
    "apps",
    "controller",
    "dist",
    "src",
    "electron-main.js",
  );
  for (const directory of [
    dirname(script),
    join(root, "node_modules", ".bin"),
    dirname(checkedInMap),
    dirname(runtimeSentinel),
    dirname(entrySentinel),
  ]) {
    mkdirSync(directory, { recursive: true });
  }
  copyFileSync(productionScript, script);
  writeFileSync(
    join(root, "AGENTS.md"),
    "# JanVim Exhibition 2026 agent instructions\n",
    "utf8",
  );
  const checkedInMapBefore = '{"mappingStatus":"unconfirmed","sentinel":true}\n';
  writeFileSync(checkedInMap, checkedInMapBefore, "utf8");
  writeFileSync(runtimeSentinel, "immutable-runtime-sentinel", "utf8");
  writeFileSync(entrySentinel, "// built entry sentinel\n", "utf8");
  writeFileSync(
    join(root, "scripts", "verify-runtime.ps1"),
    [
      "$ErrorActionPreference = 'Stop'",
      "Add-Content -LiteralPath $env:G2_TEST_SEQUENCE_LOG -Value 'verify'",
      "exit [int]$env:G2_TEST_VERIFY_EXIT",
      "",
    ].join("\r\n"),
    "utf8",
  );
  writeFileSync(
    join(root, "node_modules", ".bin", "electron.cmd"),
    [
      "@echo off",
      'echo electron>>"%G2_TEST_SEQUENCE_LOG%"',
      'echo %*>>"%G2_TEST_INVOCATION_LOG%"',
      "exit /b %G2_TEST_ELECTRON_EXIT%",
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
    sequenceLog,
    checkedInMap,
    checkedInMapBefore,
    runtimeSentinel,
    entrySentinel,
    cleanup: () => {
      if (win32.dirname(externalRoot).toLowerCase() !== rehearsalParent.toLowerCase()) {
        throw new Error("refusing to clean unexpected rehearsal path");
      }
      rmSync(externalRoot, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function prepareExternalMap(fixture: LauncherFixture): void {
  mkdirSync(fixture.externalRoot, { recursive: false });
  writeFileSync(fixture.externalMap, '{"mappingStatus":"confirmed"}\n', "utf8");
}

function runLauncher(
  fixture: LauncherFixture,
  args: readonly string[],
  options: { electronExit?: number; verifyExit?: number } = {},
) {
  return spawnSync(
    "pwsh",
    ["-NoProfile", "-NonInteractive", "-File", fixture.script, ...args],
    {
      cwd: fixture.root,
      encoding: "utf8",
      env: {
        ...process.env,
        G2_TEST_ELECTRON_EXIT: String(options.electronExit ?? 0),
        G2_TEST_VERIFY_EXIT: String(options.verifyExit ?? 0),
        G2_TEST_INVOCATION_LOG: fixture.invocationLog,
        G2_TEST_SEQUENCE_LOG: fixture.sequenceLog,
      },
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    },
  );
}

function captureArguments(fixture: LauncherFixture): string[] {
  return [
    "-Mode",
    "Capture",
    "-RehearsalRoot",
    fixture.externalRoot,
    "-DisplayMapPath",
    fixture.externalMap,
  ];
}

function runArguments(fixture: LauncherFixture): string[] {
  return [
    "-Mode",
    "Run",
    "-RehearsalRoot",
    fixture.externalRoot,
    "-DisplayMapPath",
    fixture.externalMap,
    "-RunId",
    win32.basename(fixture.externalRoot),
  ];
}

describe("bounded G2 PowerShell launcher", () => {
  it("forwards one closed command without touching the checked-in display map", () => {
    const fixture = makeLauncherFixture();
    try {
      const result = runLauncher(fixture, captureArguments(fixture));
      expect(result.status).toBe(0);
      expect(readFileSync(fixture.invocationLog, "utf8")).toContain("--g2-mode=capture");
      expect(readFileSync(fixture.checkedInMap, "utf8")).toBe(fixture.checkedInMapBefore);
      expect(JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)!)).toMatchObject({
        schema: 1,
        mode: "Capture",
        exitCode: 0,
        displayMapPath: fixture.externalMap,
        runId: null,
      });
    } finally {
      fixture.cleanup();
    }
  });

  it("preflights required launch files before creating a Capture root", () => {
    const fixture = makeLauncherFixture();
    try {
      rmSync(fixture.entrySentinel, { force: false });

      const result = runLauncher(fixture, captureArguments(fixture));

      expect(result.status).not.toBe(0);
      expect(existsSync(fixture.externalRoot)).toBe(false);
      expect(existsSync(fixture.invocationLog)).toBe(false);
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects invalid paths and same Confirm IDs before Electron invocation", () => {
    const cases = [
      (fixture: LauncherFixture) => [
        "-Mode",
        "Capture",
        "-RehearsalRoot",
        "relative",
        "-DisplayMapPath",
        fixture.externalMap,
      ],
      (fixture: LauncherFixture) => {
        prepareExternalMap(fixture);
        return [
          "-Mode",
          "Confirm",
          "-RehearsalRoot",
          fixture.externalRoot,
          "-DisplayMapPath",
          fixture.externalMap,
          "-PrimaryDisplayId",
          "1",
          "-SecondaryDisplayId",
          "1",
        ];
      },
      (_fixture: LauncherFixture) => [
        "-Mode",
        "Capture",
        "-RehearsalRoot",
        protectedPath,
        "-DisplayMapPath",
        `${protectedPath}\\display-map.json`,
      ],
    ];
    for (const makeArguments of cases) {
      const fixture = makeLauncherFixture();
      try {
        const result = runLauncher(fixture, makeArguments(fixture));
        expect(result.status).not.toBe(0);
        expect(existsSync(fixture.invocationLog)).toBe(false);
      } finally {
        fixture.cleanup();
      }
    }
  });

  it("runs runtime verification before Electron and preserves source/runtime sentinels", () => {
    const fixture = makeLauncherFixture();
    try {
      prepareExternalMap(fixture);
      const result = runLauncher(fixture, runArguments(fixture));
      expect(result.status).toBe(0);
      expect(readFileSync(fixture.sequenceLog, "utf8").trim().split(/\r?\n/)).toEqual([
        "verify",
        "electron",
      ]);
      expect(readFileSync(fixture.runtimeSentinel, "utf8")).toBe(
        "immutable-runtime-sentinel",
      );
      expect(readFileSync(fixture.entrySentinel, "utf8")).toBe("// built entry sentinel\n");
      expect(readFileSync(fixture.checkedInMap, "utf8")).toBe(fixture.checkedInMapBefore);
    } finally {
      fixture.cleanup();
    }
  });

  it("prevents Electron after verifier failure", () => {
    const fixture = makeLauncherFixture();
    try {
      prepareExternalMap(fixture);
      const result = runLauncher(fixture, runArguments(fixture), { verifyExit: 9 });
      expect(result.status).not.toBe(0);
      expect(readFileSync(fixture.sequenceLog, "utf8").trim()).toBe("verify");
      expect(existsSync(fixture.invocationLog)).toBe(false);
    } finally {
      fixture.cleanup();
    }
  });

  it("propagates the exact Electron exit code in process status and JSON", () => {
    const fixture = makeLauncherFixture();
    try {
      prepareExternalMap(fixture);
      const result = runLauncher(fixture, runArguments(fixture), { electronExit: 7 });
      expect(result.status).toBe(7);
      expect(JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)!)).toMatchObject({
        schema: 1,
        mode: "Run",
        exitCode: 7,
        runId: win32.basename(fixture.externalRoot),
      });
    } finally {
      fixture.cleanup();
    }
  });
});
