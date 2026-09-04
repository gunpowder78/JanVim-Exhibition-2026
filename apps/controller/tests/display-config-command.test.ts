import { describe, expect, it } from "vitest";

import { parseDisplayConfigCommand } from "../src/display-config-command.ts";
import { selectElectronCommandFamily } from "../src/show-command.ts";

const repositoryRoot =
  "D:\\github\\JanVim-Exhibition-2026\\.worktrees\\g4-soft-display-routing";
const rehearsalParent = "D:\\VirtualData\\JanVim-Exhibition-Rehearsals";
const protectedRoot =
  "D:\\VirtualData\\TempCache\\janvim-task5-physical-cached-e9735e8d02e34ff4a4ac8836f8e22dcb";

function validArguments(runId = "g4-config-001"): string[] {
  const rehearsalRoot = `${rehearsalParent}\\${runId}`;
  return [
    "--display-config-mode=configure",
    `--rehearsal-root=${rehearsalRoot}`,
    `--display-map=${rehearsalRoot}\\display-map.json`,
  ];
}

function replaceFlag(arguments_: string[], name: string, value: string): string[] {
  return arguments_.map((argument) =>
    argument.startsWith(`--${name}=`) ? `--${name}=${value}` : argument,
  );
}

describe("manual display-configuration command", () => {
  it("selects exactly one of the three Electron command families", () => {
    expect(selectElectronCommandFamily(["--g2-mode=capture"])).toBe("g2");
    expect(selectElectronCommandFamily(["--show-mode=show"])).toBe("show");
    expect(
      selectElectronCommandFamily(["--display-config-mode=configure"]),
    ).toBe("display-config");

    expect(() => selectElectronCommandFamily([])).toThrow(/exactly one/i);
    expect(() =>
      selectElectronCommandFamily([
        "--show-mode=show",
        "--display-config-mode=configure",
      ]),
    ).toThrow(/exactly one/i);
  });

  it("parses only the exact configure command and canonical direct-child paths", () => {
    expect(parseDisplayConfigCommand(validArguments(), repositoryRoot)).toEqual({
      mode: "Configure",
      rehearsalRoot: `${rehearsalParent}\\g4-config-001`,
      displayMapPath: `${rehearsalParent}\\g4-config-001\\display-map.json`,
    });

    const withSegments = replaceFlag(
      replaceFlag(
        validArguments(),
        "rehearsal-root",
        `${rehearsalParent}\\staging\\..\\g4-config-001`,
      ),
      "display-map",
      `${rehearsalParent}\\staging\\..\\g4-config-001\\.\\display-map.json`,
    );
    expect(parseDisplayConfigCommand(withSegments, repositoryRoot)).toEqual({
      mode: "Configure",
      rehearsalRoot: `${rehearsalParent}\\g4-config-001`,
      displayMapPath: `${rehearsalParent}\\g4-config-001\\display-map.json`,
    });
  });

  it("requires every exact flag once and rejects unknown or mixed arguments", () => {
    for (const name of [
      "display-config-mode",
      "rehearsal-root",
      "display-map",
    ]) {
      expect(() =>
        parseDisplayConfigCommand(
          validArguments().filter(
            (argument) => !argument.startsWith(`--${name}=`),
          ),
          repositoryRoot,
        ),
      ).toThrow(/missing/i);

      const duplicate = validArguments();
      duplicate.push(
        duplicate.find((argument) => argument.startsWith(`--${name}=`))!,
      );
      expect(() =>
        parseDisplayConfigCommand(duplicate, repositoryRoot),
      ).toThrow(/duplicate/i);
    }

    expect(() =>
      parseDisplayConfigCommand(
        [...validArguments(), "--show-mode=show"],
        repositoryRoot,
      ),
    ).toThrow(/unexpected/i);
    expect(() =>
      parseDisplayConfigCommand(
        [...validArguments(), "--shell=pwsh"],
        repositoryRoot,
      ),
    ).toThrow(/unexpected/i);
    expect(() =>
      parseDisplayConfigCommand(
        replaceFlag(validArguments(), "display-config-mode", "automatic"),
        repositoryRoot,
      ),
    ).toThrow(/mode/i);
  });

  it("rejects relative, source, JanVim, user-config, and protected targets", () => {
    expect(() =>
      parseDisplayConfigCommand(
        replaceFlag(validArguments(), "rehearsal-root", ".\\g4-config-001"),
        repositoryRoot,
      ),
    ).toThrow(/absolute/i);
    expect(() =>
      parseDisplayConfigCommand(
        replaceFlag(validArguments(), "display-map", ".\\display-map.json"),
        repositoryRoot,
      ),
    ).toThrow(/absolute/i);

    for (const root of [
      repositoryRoot,
      `${repositoryRoot}\\rehearsal`,
      "D:\\github\\JanVim",
      "D:\\github\\JanVim\\.worktrees\\feature",
      "C:\\Users\\operator\\AppData\\Local\\nvim",
      protectedRoot,
      `${protectedRoot}\\child`,
    ]) {
      const arguments_ = replaceFlag(
        replaceFlag(validArguments(), "rehearsal-root", root),
        "display-map",
        `${root}\\display-map.json`,
      );
      expect(() =>
        parseDisplayConfigCommand(arguments_, repositoryRoot),
      ).toThrow(/source|external|protected|user|parent/i);
    }
  });

  it("requires one rehearsal child and its exact display-map.json", () => {
    const nestedRoot = `${rehearsalParent}\\group\\g4-config-001`;
    expect(() =>
      parseDisplayConfigCommand(
        replaceFlag(
          replaceFlag(validArguments(), "rehearsal-root", nestedRoot),
          "display-map",
          `${nestedRoot}\\display-map.json`,
        ),
        repositoryRoot,
      ),
    ).toThrow(/direct child|parent/i);

    expect(() =>
      parseDisplayConfigCommand(
        replaceFlag(
          validArguments(),
          "display-map",
          `${rehearsalParent}\\g4-config-001\\other.json`,
        ),
        repositoryRoot,
      ),
    ).toThrow(/display-map\.json|basename/i);
    expect(() =>
      parseDisplayConfigCommand(
        replaceFlag(
          validArguments(),
          "display-map",
          `${rehearsalParent}\\display-map.json`,
        ),
        repositoryRoot,
      ),
    ).toThrow(/direct child|rehearsal root/i);
  });
});
