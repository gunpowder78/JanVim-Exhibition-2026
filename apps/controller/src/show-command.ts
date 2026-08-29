import { win32 } from "node:path";

import {
  G2_PROTECTED_ROOTS,
  G2_REHEARSAL_PARENT,
} from "./g2-command.js";
import { resolveBelowRoot } from "./runtime-adapter-common.js";

export type ShowCommand = {
  mode: "ValidateOnly" | "Soak3" | "Show";
  rehearsalRoot: string;
  displayMapPath: string;
  runId: string;
  controllerRunId: string;
  networkPolicy: "OfflineRequired" | "DiagnosticConnected";
};

const JANVIM_PRODUCT_ROOT = "D:\\github\\JanVim";
const RUN_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const CONTROLLER_RUN_ID_PATTERN = /^[A-Za-z0-9._-]{1,96}$/;
const BRIDGE_TOKEN_PATTERN = /[0-9a-f]{48}/i;
const FLAG_PATTERN = /^--([a-z0-9-]+)=(.*)$/;
const KNOWN_FLAGS = new Set([
  "show-mode",
  "rehearsal-root",
  "display-map",
  "run-id",
  "controller-run-id",
  "network-policy",
]);

export function selectElectronCommandFamily(
  argv: readonly string[],
): "g2" | "show" {
  const hasG2Mode = argv.some((argument) => argument.startsWith("--g2-mode="));
  const hasShowMode = argv.some((argument) =>
    argument.startsWith("--show-mode="),
  );
  if (hasG2Mode === hasShowMode) {
    throw new Error("Electron command requires exactly one G2 or show mode family");
  }
  return hasG2Mode ? "g2" : "show";
}

export function parseShowCommand(
  argv: readonly string[],
  repositoryRoot: string,
): ShowCommand {
  if (!win32.isAbsolute(repositoryRoot)) {
    throw new Error("Repository root must be absolute");
  }
  const flags = parseFlags(argv);
  const rawMode = requiredFlag(flags, "show-mode");
  const mode = parseMode(rawMode);
  const runId = requiredFlag(flags, "run-id");
  if (BRIDGE_TOKEN_PATTERN.test(runId) || !RUN_ID_PATTERN.test(runId)) {
    throw new Error("Run ID is invalid or token-shaped");
  }
  const controllerRunId = requiredFlag(flags, "controller-run-id");
  if (
    BRIDGE_TOKEN_PATTERN.test(controllerRunId) ||
    !CONTROLLER_RUN_ID_PATTERN.test(controllerRunId)
  ) {
    throw new Error("Controller run ID is invalid or token-shaped");
  }
  const networkPolicy = parseNetworkPolicy(
    requiredFlag(flags, "network-policy"),
  );

  const rawRehearsalRoot = requiredFlag(flags, "rehearsal-root");
  const rawDisplayMapPath = requiredFlag(flags, "display-map");
  if (!win32.isAbsolute(rawRehearsalRoot)) {
    throw new Error("Rehearsal root must be absolute");
  }
  if (!win32.isAbsolute(rawDisplayMapPath)) {
    throw new Error("Display map path must be absolute");
  }
  const rehearsalRoot = win32.resolve(rawRehearsalRoot);
  const displayMapPath = win32.resolve(rawDisplayMapPath);
  const resolvedRepositoryRoot = win32.resolve(repositoryRoot);

  rejectForbiddenEvidencePath(rehearsalRoot, resolvedRepositoryRoot);
  rejectForbiddenEvidencePath(displayMapPath, resolvedRepositoryRoot);
  if (!pathsEqual(win32.dirname(rehearsalRoot), G2_REHEARSAL_PARENT)) {
    throw new Error(
      "Rehearsal root must be one direct child of the dedicated rehearsal parent",
    );
  }
  const expectedDisplayMapPath = resolveBelowRoot(
    rehearsalRoot,
    "display-map.json",
  );
  if (!pathsEqual(displayMapPath, expectedDisplayMapPath)) {
    if (win32.basename(displayMapPath).toLowerCase() !== "display-map.json") {
      throw new Error("Display map basename must be display-map.json");
    }
    throw new Error("Display map must be a direct child of the rehearsal root");
  }
  if (runId !== win32.basename(rehearsalRoot)) {
    throw new Error("Run ID must exactly match the rehearsal directory name");
  }

  return {
    mode,
    rehearsalRoot,
    displayMapPath,
    runId,
    controllerRunId,
    networkPolicy,
  };
}

function parseFlags(argv: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (const argument of argv) {
    const match = FLAG_PATTERN.exec(argument);
    if (match === null || !KNOWN_FLAGS.has(match[1]!)) {
      throw new Error(`Unexpected show argument: ${argument}`);
    }
    const name = match[1]!;
    if (flags.has(name)) throw new Error(`Duplicate show flag: --${name}`);
    flags.set(name, match[2]!);
  }
  return flags;
}

function requiredFlag(flags: ReadonlyMap<string, string>, name: string): string {
  const value = flags.get(name);
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required show flag: --${name}`);
  }
  return value;
}

function parseMode(value: string): ShowCommand["mode"] {
  if (value === "validateonly") return "ValidateOnly";
  if (value === "soak3") return "Soak3";
  if (value === "show") return "Show";
  throw new Error("Show mode is invalid");
}

function parseNetworkPolicy(value: string): ShowCommand["networkPolicy"] {
  if (value === "offline-required") return "OfflineRequired";
  if (value === "diagnostic-connected") return "DiagnosticConnected";
  throw new Error("Show network policy is invalid");
}

function rejectForbiddenEvidencePath(
  path: string,
  repositoryRoot: string,
): void {
  if (
    isAtOrBelow(path, repositoryRoot) ||
    isAtOrBelow(path, JANVIM_PRODUCT_ROOT)
  ) {
    throw new Error("Show rehearsal evidence must remain external to source repositories");
  }
  if (G2_PROTECTED_ROOTS.some((root) => isAtOrBelow(path, root))) {
    throw new Error("Show path targets a protected root");
  }
  if (containsUserNvimConfig(path)) {
    throw new Error("Show path targets user Neovim configuration");
  }
}

function containsUserNvimConfig(path: string): boolean {
  return /\\appdata\\local\\nvim(?:\\|$)/i.test(win32.resolve(path));
}

function pathsEqual(left: string, right: string): boolean {
  return win32.resolve(left).toLowerCase() === win32.resolve(right).toLowerCase();
}

function isAtOrBelow(candidate: string, root: string): boolean {
  const resolvedCandidate = win32.resolve(candidate).toLowerCase();
  const resolvedRoot = win32.resolve(root).replace(/[\\]+$/, "").toLowerCase();
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(`${resolvedRoot}\\`)
  );
}
