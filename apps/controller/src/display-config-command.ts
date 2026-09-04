import { win32 } from "node:path";

import {
  G2_PROTECTED_ROOTS,
  G2_REHEARSAL_PARENT,
} from "./g2-command.js";

export interface DisplayConfigCommand {
  readonly mode: "Configure";
  readonly rehearsalRoot: string;
  readonly displayMapPath: string;
}

const JANVIM_PRODUCT_ROOT = "D:\\github\\JanVim";
const FLAG_PATTERN = /^--([a-z0-9-]+)=(.*)$/u;
const KNOWN_FLAGS = new Set([
  "display-config-mode",
  "rehearsal-root",
  "display-map",
]);

export function parseDisplayConfigCommand(
  argv: readonly string[],
  repositoryRoot: string,
): DisplayConfigCommand {
  assertAbsoluteLocalPath(repositoryRoot, "Repository root");
  const flags = parseFlags(argv);
  if (requiredFlag(flags, "display-config-mode") !== "configure") {
    throw new Error("Display configuration mode is invalid");
  }

  const rawRehearsalRoot = requiredFlag(flags, "rehearsal-root");
  const rawDisplayMapPath = requiredFlag(flags, "display-map");
  assertAbsoluteLocalPath(rawRehearsalRoot, "Rehearsal root");
  assertAbsoluteLocalPath(rawDisplayMapPath, "Display map path");

  const rehearsalRoot = win32.resolve(rawRehearsalRoot);
  const displayMapPath = win32.resolve(rawDisplayMapPath);
  const resolvedRepositoryRoot = win32.resolve(repositoryRoot);
  rejectForbiddenPath(rehearsalRoot, resolvedRepositoryRoot);
  rejectForbiddenPath(displayMapPath, resolvedRepositoryRoot);

  if (!pathsEqual(win32.dirname(rehearsalRoot), G2_REHEARSAL_PARENT)) {
    throw new Error(
      "Rehearsal root must be one direct child of the dedicated rehearsal parent",
    );
  }
  if (win32.basename(displayMapPath).toLowerCase() !== "display-map.json") {
    throw new Error("Display map basename must be display-map.json");
  }
  if (
    !pathsEqual(win32.dirname(displayMapPath), rehearsalRoot) ||
    !pathsEqual(displayMapPath, win32.join(rehearsalRoot, "display-map.json"))
  ) {
    throw new Error("Display map must be a direct child of the rehearsal root");
  }

  return Object.freeze({
    mode: "Configure" as const,
    rehearsalRoot,
    displayMapPath,
  });
}

function parseFlags(argv: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (const argument of argv) {
    const match = FLAG_PATTERN.exec(argument);
    if (match === null || !KNOWN_FLAGS.has(match[1]!)) {
      throw new Error(`Unexpected display configuration argument: ${argument}`);
    }
    const name = match[1]!;
    if (flags.has(name)) {
      throw new Error(`Duplicate display configuration flag: --${name}`);
    }
    flags.set(name, match[2]!);
  }
  return flags;
}

function requiredFlag(flags: ReadonlyMap<string, string>, name: string): string {
  const value = flags.get(name);
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required display configuration flag: --${name}`);
  }
  return value;
}

function assertAbsoluteLocalPath(path: string, label: string): void {
  const normalized = path.replaceAll("/", "\\").toLowerCase();
  if (
    !/^[a-z]:\\/u.test(normalized) ||
    !win32.isAbsolute(path) ||
    normalized.startsWith("\\\\?\\") ||
    normalized.startsWith("\\\\.\\") ||
    path.slice(2).includes(":") ||
    /[\u0000-\u001f\u007f]/u.test(path)
  ) {
    throw new Error(`${label} must be an absolute local Windows path`);
  }
}

function rejectForbiddenPath(path: string, repositoryRoot: string): void {
  if (
    isAtOrBelow(path, repositoryRoot) ||
    isAtOrBelow(path, JANVIM_PRODUCT_ROOT)
  ) {
    throw new Error(
      "Display configuration output must remain external to source repositories",
    );
  }
  if (G2_PROTECTED_ROOTS.some((root) => isAtOrBelow(path, root))) {
    throw new Error("Display configuration path targets a protected root");
  }
  if (/\\appdata\\local\\nvim(?:\\|$)/iu.test(win32.resolve(path))) {
    throw new Error("Display configuration path targets user Neovim configuration");
  }
}

function isAtOrBelow(candidate: string, root: string): boolean {
  const relative = win32.relative(win32.resolve(root), win32.resolve(candidate));
  return (
    relative.length === 0 ||
    (!win32.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${win32.sep}`))
  );
}

function pathsEqual(left: string, right: string): boolean {
  return (
    win32.resolve(left).toLowerCase() === win32.resolve(right).toLowerCase()
  );
}
