import { describe, expect, it } from "vitest";

import {
  parseShowCommand,
  selectElectronCommandFamily,
} from "../src/show-command.ts";

const repositoryRoot = "D:\\github\\JanVim-Exhibition-2026\\.worktrees\\task1";
const rehearsalParent = "D:\\VirtualData\\JanVim-Exhibition-Rehearsals";
const protectedRoots = [
  "D:\\VirtualData\\TempCache\\janvim-root-export-quarantine-20260826-110433-6473a2d7ebbc4524b66c61c07e540504",
  "D:\\VirtualData\\TempCache\\janvim-task5-cached-d42e9769283e47dc8b98cf94baee739d",
  "D:\\VirtualData\\TempCache\\janvim-task5-physical-cached-e9735e8d02e34ff4a4ac8836f8e22dcb",
] as const;

function validArguments(
  mode: "validateonly" | "soak3" | "show" = "soak3",
  runId = "show-001",
): string[] {
  const rehearsalRoot = `${rehearsalParent}\\${runId}`;
  return [
    `--show-mode=${mode}`,
    `--rehearsal-root=${rehearsalRoot}`,
    `--display-map=${rehearsalRoot}\\display-map.json`,
    `--run-id=${runId}`,
    "--controller-run-id=controller-001",
    "--network-policy=offline-required",
  ];
}

function replaceFlag(arguments_: string[], name: string, value: string): string[] {
  return arguments_.map((argument) =>
    argument.startsWith(`--${name}=`) ? `--${name}=${value}` : argument,
  );
}

describe("Task 9 show command parser", () => {
  it("selects exactly one explicit G2, Task 9, or display-config command family", () => {
    expect(selectElectronCommandFamily(["--g2-mode=run"])).toBe("g2");
    expect(selectElectronCommandFamily(["--show-mode=soak3"])).toBe("show");
    expect(
      selectElectronCommandFamily(["--display-config-mode=configure"]),
    ).toBe("display-config");
    expect(() => selectElectronCommandFamily([])).toThrow(/exactly one|mode/i);
    expect(() =>
      selectElectronCommandFamily([
        "--g2-mode=run",
        "--show-mode=soak3",
      ]),
    ).toThrow(/mixed|exactly one|mode/i);
    expect(() =>
      selectElectronCommandFamily([
        "--show-mode=soak3",
        "--display-config-mode=configure",
      ]),
    ).toThrow(/mixed|exactly one|mode/i);
  });

  it.each([
    ["validateonly", "ValidateOnly"],
    ["soak3", "Soak3"],
    ["show", "Show"],
  ] as const)("parses the exact %s mode", (rawMode, mode) => {
    expect(parseShowCommand(validArguments(rawMode), repositoryRoot)).toEqual({
      mode,
      rehearsalRoot: `${rehearsalParent}\\show-001`,
      displayMapPath: `${rehearsalParent}\\show-001\\display-map.json`,
      runId: "show-001",
      controllerRunId: "controller-001",
      networkPolicy: "OfflineRequired",
    });
  });

  it("accepts the explicit connected diagnostic policy without changing paths", () => {
    const arguments_ = replaceFlag(
      validArguments("show"),
      "network-policy",
      "diagnostic-connected",
    );

    expect(parseShowCommand(arguments_, repositoryRoot)).toMatchObject({
      mode: "Show",
      networkPolicy: "DiagnosticConnected",
      runId: "show-001",
    });
  });

  it("requires each exact flag once and rejects unknown or mixed G2 arguments", () => {
    const requiredFlags = [
      "show-mode",
      "rehearsal-root",
      "display-map",
      "run-id",
      "controller-run-id",
      "network-policy",
    ] as const;
    for (const name of requiredFlags) {
      expect(() =>
        parseShowCommand(
          validArguments().filter((argument) => !argument.startsWith(`--${name}=`)),
          repositoryRoot,
        ),
      ).toThrow(/missing/i);
      const duplicate = validArguments();
      duplicate.push(duplicate.find((argument) => argument.startsWith(`--${name}=`))!);
      expect(() => parseShowCommand(duplicate, repositoryRoot)).toThrow(/duplicate/i);
    }

    expect(() =>
      parseShowCommand([...validArguments(), "--shell=pwsh"], repositoryRoot),
    ).toThrow(/unexpected/i);
    expect(() =>
      parseShowCommand([...validArguments(), "--g2-mode=run"], repositoryRoot),
    ).toThrow(/unexpected|mixed/i);
  });

  it("rejects invalid modes, policies, run IDs, and controller invocation IDs", () => {
    expect(() =>
      parseShowCommand(replaceFlag(validArguments(), "show-mode", "run"), repositoryRoot),
    ).toThrow(/mode/i);
    expect(() =>
      parseShowCommand(
        replaceFlag(validArguments(), "network-policy", "online"),
        repositoryRoot,
      ),
    ).toThrow(/network/i);

    for (const value of ["", "../show-001", "演出", "a".repeat(65)]) {
      expect(() =>
        parseShowCommand(replaceFlag(validArguments(), "run-id", value), repositoryRoot),
      ).toThrow(/run id|required/i);
    }
    for (const value of ["", "controller/id", "控制器", "a".repeat(97), "line\nbreak"]) {
      expect(() =>
        parseShowCommand(
          replaceFlag(validArguments(), "controller-run-id", value),
          repositoryRoot,
        ),
      ).toThrow(/controller run id|required|unexpected/i);
    }

    const tokenShapedIdentity = "ab".repeat(24);
    expect(() =>
      parseShowCommand(
        validArguments("soak3", tokenShapedIdentity),
        repositoryRoot,
      ),
    ).toThrow(/run id|token/i);
    expect(() =>
      parseShowCommand(
        replaceFlag(
          validArguments(),
          "controller-run-id",
          `controller-${tokenShapedIdentity}`,
        ),
        repositoryRoot,
      ),
    ).toThrow(/controller run id|token/i);
  });

  it("rejects relative, repository, product, user-config, and protected roots", () => {
    const forbidden = [
      repositoryRoot,
      `${repositoryRoot}\\rehearsal`,
      "D:\\github\\JanVim",
      "D:\\github\\JanVim\\.worktrees\\feature",
      "C:\\Users\\operator\\AppData\\Local\\nvim",
      "C:\\Users\\operator\\AppData\\Local\\nvim\\show-001",
      ...protectedRoots,
      ...protectedRoots.map((root) => `${root}\\show-001`),
    ];
    for (const root of forbidden) {
      const arguments_ = replaceFlag(validArguments(), "rehearsal-root", root);
      expect(() =>
        parseShowCommand(
          replaceFlag(arguments_, "display-map", `${root}\\display-map.json`),
          repositoryRoot,
        ),
      ).toThrow(/external|source|user|protected|parent/i);
    }

    expect(() =>
      parseShowCommand(
        replaceFlag(validArguments(), "rehearsal-root", ".\\show-001"),
        repositoryRoot,
      ),
    ).toThrow(/absolute/i);
    expect(() =>
      parseShowCommand(
        replaceFlag(validArguments(), "display-map", ".\\display-map.json"),
        repositoryRoot,
      ),
    ).toThrow(/absolute/i);
  });

  it("requires one direct rehearsal child, its exact map, and matching run basename", () => {
    const nestedRoot = `${rehearsalParent}\\group\\show-001`;
    let arguments_ = replaceFlag(validArguments(), "rehearsal-root", nestedRoot);
    arguments_ = replaceFlag(arguments_, "display-map", `${nestedRoot}\\display-map.json`);
    expect(() => parseShowCommand(arguments_, repositoryRoot)).toThrow(/direct child|parent/i);

    expect(() =>
      parseShowCommand(
        replaceFlag(validArguments(), "display-map", `${rehearsalParent}\\display-map.json`),
        repositoryRoot,
      ),
    ).toThrow(/direct child|rehearsal root/i);
    expect(() =>
      parseShowCommand(
        replaceFlag(
          validArguments(),
          "display-map",
          `${rehearsalParent}\\show-001\\other.json`,
        ),
        repositoryRoot,
      ),
    ).toThrow(/display-map\.json|basename/i);
    expect(() =>
      parseShowCommand(replaceFlag(validArguments(), "run-id", "other-run"), repositoryRoot),
    ).toThrow(/basename|directory name/i);
  });

  it("resolves path segments before enforcing containment and parent rules", () => {
    const rawRoot = `${rehearsalParent}\\staging\\..\\show-001`;
    let arguments_ = replaceFlag(validArguments(), "rehearsal-root", rawRoot);
    arguments_ = replaceFlag(
      arguments_,
      "display-map",
      `${rawRoot}\\.\\display-map.json`,
    );

    expect(parseShowCommand(arguments_, repositoryRoot)).toMatchObject({
      rehearsalRoot: `${rehearsalParent}\\show-001`,
      displayMapPath: `${rehearsalParent}\\show-001\\display-map.json`,
    });
  });
});
