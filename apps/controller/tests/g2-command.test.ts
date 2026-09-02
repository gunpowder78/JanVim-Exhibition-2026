import { describe, expect, it } from "vitest";

import { parseG2Command } from "../src/g2-command.ts";

const rehearsalParent = "D:\\VirtualData\\JanVim-Exhibition-Rehearsals";
const protectedRoots = [
  "D:\\VirtualData\\TempCache\\janvim-root-export-quarantine-20260826-110433-6473a2d7ebbc4524b66c61c07e540504",
  "D:\\VirtualData\\TempCache\\janvim-task5-cached-d42e9769283e47dc8b98cf94baee739d",
  "D:\\VirtualData\\TempCache\\janvim-task5-physical-cached-e9735e8d02e34ff4a4ac8836f8e22dcb",
] as const;

function baseArguments(
  mode: "capture" | "confirm" | "validateonly" | "run",
  runName = "g2-001",
): string[] {
  const rehearsalRoot = `${rehearsalParent}\\${runName}`;
  const common = [
    `--g2-mode=${mode}`,
    `--rehearsal-root=${rehearsalRoot}`,
    `--display-map=${rehearsalRoot}\\display-map.json`,
  ];
  if (mode === "confirm") {
    common.push("--primary-display-id=111", "--secondary-display-id=222");
  }
  if (mode === "validateonly" || mode === "run") {
    common.push(`--run-id=${runName}`);
  }
  return common;
}

function replaceFlag(arguments_: string[], name: string, value: string): string[] {
  return arguments_.map((argument) =>
    argument.startsWith(`--${name}=`) ? `--${name}=${value}` : argument,
  );
}

describe("G2 command parser", () => {
  it("parses one exact mode and rejects repository-local rehearsal evidence", () => {
    expect(parseG2Command(baseArguments("run"), "D:\\show")).toEqual({
      mode: "Run",
      rehearsalRoot: `${rehearsalParent}\\g2-001`,
      displayMapPath: `${rehearsalParent}\\g2-001\\display-map.json`,
      runId: "g2-001",
    });

    expect(() =>
      parseG2Command(
        [
          "--g2-mode=run",
          "--rehearsal-root=D:\\show\\evidence",
          "--display-map=D:\\show\\evidence\\display-map.json",
          "--run-id=evidence",
        ],
        "D:\\show",
      ),
    ).toThrow(/external/i);
  });

  it("returns a closed command shape for Capture, Confirm, and ValidateOnly", () => {
    expect(parseG2Command(baseArguments("capture"), "D:\\show")).toEqual({
      mode: "Capture",
      rehearsalRoot: `${rehearsalParent}\\g2-001`,
      displayMapPath: `${rehearsalParent}\\g2-001\\display-map.json`,
    });
    expect(parseG2Command(baseArguments("confirm"), "D:\\show")).toEqual({
      mode: "Confirm",
      rehearsalRoot: `${rehearsalParent}\\g2-001`,
      displayMapPath: `${rehearsalParent}\\g2-001\\display-map.json`,
      primaryDisplayId: "111",
      secondaryDisplayId: "222",
    });
    expect(parseG2Command(baseArguments("validateonly"), "D:\\show")).toEqual({
      mode: "ValidateOnly",
      rehearsalRoot: `${rehearsalParent}\\g2-001`,
      displayMapPath: `${rehearsalParent}\\g2-001\\display-map.json`,
      runId: "g2-001",
    });
  });

  it("rejects duplicate, missing, malformed, and unexpected flags", () => {
    expect(() =>
      parseG2Command([...baseArguments("capture"), "--g2-mode=run"], "D:\\show"),
    ).toThrow(/duplicate/i);
    expect(() =>
      parseG2Command(baseArguments("capture").slice(1), "D:\\show"),
    ).toThrow(/g2-mode/i);
    expect(() =>
      parseG2Command(replaceFlag(baseArguments("capture"), "g2-mode", "preview"), "D:\\show"),
    ).toThrow(/mode/i);
    expect(() =>
      parseG2Command([...baseArguments("capture"), "--surprise=true"], "D:\\show"),
    ).toThrow(/unexpected/i);
    expect(() =>
      parseG2Command([...baseArguments("capture"), "positional"], "D:\\show"),
    ).toThrow(/unexpected/i);
  });

  it("requires absolute direct-child rehearsal and display-map paths", () => {
    expect(() =>
      parseG2Command(
        replaceFlag(baseArguments("capture"), "rehearsal-root", "relative"),
        "D:\\show",
      ),
    ).toThrow(/absolute/i);
    expect(() =>
      parseG2Command(
        replaceFlag(baseArguments("capture"), "display-map", "display-map.json"),
        "D:\\show",
      ),
    ).toThrow(/absolute/i);
    expect(() =>
      parseG2Command(
        replaceFlag(baseArguments("capture"), "rehearsal-root", rehearsalParent),
        "D:\\show",
      ),
    ).toThrow(/direct child/i);
    expect(() =>
      parseG2Command(
        [
          "--g2-mode=capture",
          "--rehearsal-root=D:\\VirtualData\\SomewhereElse\\g2-001",
          "--display-map=D:\\VirtualData\\SomewhereElse\\g2-001\\display-map.json",
        ],
        "D:\\show",
      ),
    ).toThrow(/dedicated rehearsal parent/i);
    expect(() =>
      parseG2Command(
        replaceFlag(
          baseArguments("capture"),
          "display-map",
          `${rehearsalParent}\\g2-001\\other.json`,
        ),
        "D:\\show",
      ),
    ).toThrow(/display-map\.json/i);
    expect(() =>
      parseG2Command(
        replaceFlag(
          baseArguments("capture"),
          "display-map",
          `${rehearsalParent}\\g2-001\\nested\\display-map.json`,
        ),
        "D:\\show",
      ),
    ).toThrow(/direct child/i);
  });

  it("rejects JanVim product source and every protected root boundary", () => {
    for (const root of ["D:\\github\\JanVim", "D:\\github\\JanVim\\worktree"] as const) {
      expect(() =>
        parseG2Command(
          [
            "--g2-mode=capture",
            `--rehearsal-root=${root}`,
            `--display-map=${root}\\display-map.json`,
          ],
          "D:\\show",
        ),
      ).toThrow(/external/i);
    }

    for (const protectedRoot of protectedRoots) {
      for (const root of [protectedRoot, `${protectedRoot}\\descendant`]) {
        expect(() =>
          parseG2Command(
            [
              "--g2-mode=capture",
              `--rehearsal-root=${root}`,
              `--display-map=${root}\\display-map.json`,
            ],
            "D:\\show",
          ),
        ).toThrow(/protected/i);
      }
    }
  });

  it("requires Confirm to name two explicit distinct displays and no unrelated IDs", () => {
    const confirm = baseArguments("confirm");
    expect(() =>
      parseG2Command(
        confirm.filter((argument) => !argument.startsWith("--primary-display-id=")),
        "D:\\show",
      ),
    ).toThrow(/primary-display-id/i);
    expect(() =>
      parseG2Command(
        replaceFlag(confirm, "secondary-display-id", "111"),
        "D:\\show",
      ),
    ).toThrow(/distinct/i);
    expect(() =>
      parseG2Command([...baseArguments("capture"), "--primary-display-id=111"], "D:\\show"),
    ).toThrow(/unexpected.*mode/i);
  });

  it("requires a valid Run ID exactly matching the rehearsal directory", () => {
    for (const invalidId of ["bad id", "bad/id", "x".repeat(65)]) {
      expect(() =>
        parseG2Command(baseArguments("run", invalidId), "D:\\show"),
      ).toThrow(/run id/i);
    }
    expect(() =>
      parseG2Command(
        replaceFlag(baseArguments("run"), "run-id", "g2-002"),
        "D:\\show",
      ),
    ).toThrow(/directory/i);
    expect(() =>
      parseG2Command(baseArguments("capture").concat("--run-id=g2-001"), "D:\\show"),
    ).toThrow(/unexpected.*mode/i);
  });
});
