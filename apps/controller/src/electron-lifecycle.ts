export interface ElectronAppLifecycleAdapter {
  whenReady(): Promise<void>;
  on(event: "activate" | "window-all-closed", listener: () => void): void;
  quit(): void;
}

export async function runElectronLifecycle(
  app: ElectronAppLifecycleAdapter,
  run: () => Promise<number>,
): Promise<number> {
  let started = false;
  app.on("activate", () => undefined);
  app.on("window-all-closed", () => undefined);
  await app.whenReady();
  if (started) return 1;
  started = true;
  try {
    return await run();
  } catch {
    return 1;
  } finally {
    app.quit();
  }
}
