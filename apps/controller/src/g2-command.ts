import { win32 } from "node:path";

export type G2Command =
  | { mode: "Capture"; rehearsalRoot: string; displayMapPath: string }
  | {
      mode: "Confirm";
      rehearsalRoot: string;
      displayMapPath: string;
      primaryDisplayId: string;
      secondaryDisplayId: string;
    }
  | {
      mode: "ValidateOnly";
      rehearsalRoot: string;
      displayMapPath: string;
      runId: string;
    }
  | { mode: "Run"; rehearsalRoot: string; displayMapPath: string; runId: string };

export const G2_REHEARSAL_PARENT =
  "D:\\VirtualData\\JanVim-Exhibition-Rehearsals";

export const G2_PROTECTED_ROOTS = [
  "D:\\VirtualData\\TempCache\\janvim-root-export-quarantine-20260826-110433-6473a2d7ebbc4524b66c61c07e540504",
  "D:\\VirtualData\\TempCache\\janvim-task5-cached-d42e9769283e47dc8b98cf94baee739d",
  "D:\\VirtualData\\TempCache\\janvim-task5-physical-cached-e9735e8d02e34ff4a4ac8836f8e22dcb",
] as const;

const JANVIM_PRODUCT_ROOT = "D:\\github\\JanVim";
const RUN_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const FLAG_PATTERN = /^--([a-z0-9-]+)=(.*)$/;
const KNOWN_FLAGS = new Set([
  "g2-mode",
  "rehearsal-root",
  "display-map",
  "run-id",
  "primary-display-id",
  "secondary-display-id",
]);

export function parseG2Command(
  argv: readonly string[],
  repositoryRoot: string,
): G2Command {
  if (!win32.isAbsolute(repositoryRoot)) {
    throw new Error("Repository root must be absolute");
  }
  const flags = parseFlags(argv);
  const rawMode = requiredFlag(flags, "g2-mode");
  if (
    rawMode !== "capture" &&
    rawMode !== "confirm" &&
    rawMode !== "validateonly" &&
    rawMode !== "run"
  ) {
    throw new Error("G2 mode is invalid");
  }

  const expectedFlags = new Set(["g2-mode", "rehearsal-root", "display-map"]);
  if (rawMode === "confirm") {
    expectedFlags.add("primary-display-id");
    expectedFlags.add("secondary-display-id");
  }
  if (rawMode === "validateonly" || rawMode === "run") expectedFlags.add("run-id");
  for (const name of flags.keys()) {
    if (!expectedFlags.has(name)) {
      throw new Error(`Unexpected flag for ${rawMode} mode: --${name}`);
    }
  }

  let runId: string | undefined;
  if (rawMode === "validateonly" || rawMode === "run") {
    runId = requiredFlag(flags, "run-id");
    if (!RUN_ID_PATTERN.test(runId)) throw new Error("Run ID is invalid");
  }

  let primaryDisplayId: string | undefined;
  let secondaryDisplayId: string | undefined;
  if (rawMode === "confirm") {
    primaryDisplayId = validateDisplayId(requiredFlag(flags, "primary-display-id"));
    secondaryDisplayId = validateDisplayId(requiredFlag(flags, "secondary-display-id"));
    if (primaryDisplayId === secondaryDisplayId) {
      throw new Error("Confirm display IDs must be distinct");
    }
  }

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

  for (const protectedRoot of G2_PROTECTED_ROOTS) {
    if (
      isAtOrBelow(rehearsalRoot, protectedRoot) ||
      isAtOrBelow(displayMapPath, protectedRoot)
    ) {
      throw new Error("G2 path targets a protected root");
    }
  }
  if (
    isAtOrBelow(rehearsalRoot, resolvedRepositoryRoot) ||
    isAtOrBelow(displayMapPath, resolvedRepositoryRoot) ||
    isAtOrBelow(rehearsalRoot, JANVIM_PRODUCT_ROOT) ||
    isAtOrBelow(displayMapPath, JANVIM_PRODUCT_ROOT)
  ) {
    throw new Error("G2 rehearsal evidence must remain external to source repositories");
  }

  if (!pathsEqual(win32.dirname(rehearsalRoot), G2_REHEARSAL_PARENT)) {
    throw new Error("Rehearsal root must be one direct child of the dedicated rehearsal parent");
  }
  if (win32.basename(displayMapPath).toLowerCase() !== "display-map.json") {
    throw new Error("Display map basename must be display-map.json");
  }
  if (!pathsEqual(win32.dirname(displayMapPath), rehearsalRoot)) {
    throw new Error("Display map must be a direct child of the rehearsal root");
  }
  if (runId !== undefined && runId !== win32.basename(rehearsalRoot)) {
    throw new Error("Run ID must exactly match the rehearsal directory name");
  }

  if (rawMode === "capture") {
    return { mode: "Capture", rehearsalRoot, displayMapPath };
  }
  if (rawMode === "confirm") {
    return {
      mode: "Confirm",
      rehearsalRoot,
      displayMapPath,
      primaryDisplayId: primaryDisplayId!,
      secondaryDisplayId: secondaryDisplayId!,
    };
  }
  if (rawMode === "validateonly") {
    return { mode: "ValidateOnly", rehearsalRoot, displayMapPath, runId: runId! };
  }
  return { mode: "Run", rehearsalRoot, displayMapPath, runId: runId! };
}

function parseFlags(argv: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (const argument of argv) {
    const match = FLAG_PATTERN.exec(argument);
    if (match === null || !KNOWN_FLAGS.has(match[1]!)) {
      throw new Error(`Unexpected G2 argument: ${argument}`);
    }
    const name = match[1]!;
    if (flags.has(name)) throw new Error(`Duplicate G2 flag: --${name}`);
    flags.set(name, match[2]!);
  }
  return flags;
}

function requiredFlag(flags: ReadonlyMap<string, string>, name: string): string {
  const value = flags.get(name);
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required G2 flag: --${name}`);
  }
  return value;
}

function validateDisplayId(value: string): string {
  if (
    value.trim().length === 0 ||
    Buffer.byteLength(value, "utf8") > 256 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error("Confirm display ID is invalid");
  }
  return value;
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
