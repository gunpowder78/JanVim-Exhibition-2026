import { win32 } from "node:path";

export interface JanVimLaunchConfig {
  artifactLockPath: string;
  executablePath: string;
  workingDirectory: string;
  arguments: readonly string[];
  privateUserRoot: string;
  bridgePort: number;
  bridgeToken: string;
}

export interface SpawnedProcess {
  pid?: number;
  kill?: () => boolean;
}

export interface SpawnOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  shell: false;
  windowsHide: false;
  stdio: "pipe";
}

export type SpawnAdapter = (
  file: string,
  args: readonly string[],
  options: SpawnOptions,
) => SpawnedProcess;

export interface JanVimProcessDependencies {
  baseEnvironment: NodeJS.ProcessEnv;
  verifyArtifact: (
    artifactLockPath: string,
    executablePath: string,
  ) => Promise<{ ok: true } | { ok: false; reason: string }>;
  spawn: SpawnAdapter;
}

export type JanVimLaunchResult =
  | { started: false; reason: string }
  | { started: true; pid: number; child: SpawnedProcess };

const TOKEN_PATTERN = /^[A-Za-z0-9._-]{16,}$/;

export function buildJanVimChildEnvironment(
  baseEnvironment: NodeJS.ProcessEnv,
  config: JanVimLaunchConfig,
): NodeJS.ProcessEnv {
  validateBridge(config.bridgePort, config.bridgeToken);
  if (!win32.isAbsolute(config.privateUserRoot)) {
    throw new Error("Private JanVim user root must be an absolute Windows path");
  }

  return {
    ...baseEnvironment,
    JANVIM_EXHIBITION_USER_ROOT: config.privateUserRoot,
    JANVIM_EXHIBITION_PORT: String(config.bridgePort),
    JANVIM_EXHIBITION_TOKEN: config.bridgeToken,
  };
}

export async function launchJanVimProcess(
  config: JanVimLaunchConfig,
  dependencies: JanVimProcessDependencies,
): Promise<JanVimLaunchResult> {
  validateLaunchPaths(config);

  let verification: Awaited<ReturnType<JanVimProcessDependencies["verifyArtifact"]>>;
  try {
    verification = await dependencies.verifyArtifact(
      config.artifactLockPath,
      config.executablePath,
    );
  } catch {
    return { started: false, reason: "artifact-verification-failed" };
  }
  if (!verification.ok) {
    return { started: false, reason: verification.reason };
  }

  const environment = buildJanVimChildEnvironment(dependencies.baseEnvironment, config);
  let child: SpawnedProcess;
  try {
    child = dependencies.spawn(config.executablePath, [...config.arguments], {
      cwd: config.workingDirectory,
      env: environment,
      shell: false,
      windowsHide: false,
      stdio: "pipe",
    });
  } catch {
    return { started: false, reason: "spawn-failed" };
  }

  if (!Number.isSafeInteger(child.pid) || (child.pid ?? 0) <= 0) {
    child.kill?.();
    return { started: false, reason: "spawn-missing-pid" };
  }
  return { started: true, pid: child.pid!, child };
}

function validateBridge(port: number, token: string): void {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Bridge port must be an integer from 1 to 65535");
  }
  if (!TOKEN_PATTERN.test(token)) {
    throw new Error("Bridge token format is invalid");
  }
}

function validateLaunchPaths(config: JanVimLaunchConfig): void {
  const paths = [
    config.artifactLockPath,
    config.executablePath,
    config.workingDirectory,
    config.privateUserRoot,
  ];
  if (paths.some((path) => !win32.isAbsolute(path))) {
    throw new Error("JanVim launch paths must be absolute Windows paths");
  }
  if (win32.basename(config.executablePath).toLowerCase() !== "janvim-core.exe") {
    throw new Error("JanVim executable must be janvim-core.exe");
  }
}
