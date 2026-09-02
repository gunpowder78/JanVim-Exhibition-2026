export interface ElectronAppLifecycleAdapter {
  whenReady(): Promise<void>;
  on(event: "activate" | "window-all-closed", listener: () => void): void;
  exit(exitCode?: number): void;
}

export async function runElectronLifecycle(
  app: ElectronAppLifecycleAdapter,
  run: () => Promise<number>,
): Promise<number> {
  app.on("activate", () => undefined);
  app.on("window-all-closed", () => undefined);
  await app.whenReady();
  let exitCode: number;
  try {
    exitCode = await run();
  } catch {
    exitCode = 1;
  }
  app.exit(exitCode);
  return exitCode;
}
