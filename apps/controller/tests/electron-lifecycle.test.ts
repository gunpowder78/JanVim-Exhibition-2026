import { describe, expect, it, vi } from "vitest";

import {
  runElectronLifecycle,
  type ElectronAppLifecycleAdapter,
} from "../src/electron-lifecycle.ts";

class FakeElectronApp implements ElectronAppLifecycleAdapter {
  private readonly listeners = new Map<string, Array<() => void>>();
  private resolveReadyPromise!: () => void;
  private readonly ready = new Promise<void>((resolve) => {
    this.resolveReadyPromise = resolve;
  });
  public createdWindowCount = 0;
  public exitedWith: number | undefined;
  public exitCount = 0;

  public whenReady(): Promise<void> {
    return this.ready;
  }

  public on(event: "activate" | "window-all-closed", listener: () => void): void {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  public emit(event: "activate" | "window-all-closed"): void {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }

  public resolveReady(): void {
    this.resolveReadyPromise();
  }

  public exit(exitCode = 0): void {
    this.exitedWith = exitCode;
    this.exitCount += 1;
  }
}

describe("one-shot Electron lifecycle", () => {
  it("runs once and never creates a window through activation", async () => {
    const app = new FakeElectronApp();
    const run = vi.fn(async () => 0);
    const pending = runElectronLifecycle(app, run);
    app.emit("activate");
    app.resolveReady();
    await expect(pending).resolves.toBe(0);
    app.emit("activate");
    app.emit("window-all-closed");
    expect(run).toHaveBeenCalledTimes(1);
    expect(app.exitCount).toBe(1);
    expect(app.exitedWith).toBe(0);
    expect(app.createdWindowCount).toBe(0);
  });

  it("returns nonzero and exits once when the command throws", async () => {
    const app = new FakeElectronApp();
    const pending = runElectronLifecycle(app, async () => {
      throw new Error("command failed");
    });
    app.resolveReady();
    await expect(pending).resolves.toBe(1);
    expect(app.exitCount).toBe(1);
    expect(app.exitedWith).toBe(1);
  });

  it("waits for command cleanup before exiting with the failed result", async () => {
    const app = new FakeElectronApp();
    let commandStarted = false;
    let resolveCommand!: (exitCode: number) => void;
    const command = new Promise<number>((resolve) => {
      resolveCommand = resolve;
    });
    const pending = runElectronLifecycle(app, () => {
      commandStarted = true;
      return command;
    });
    app.resolveReady();
    await Promise.resolve();

    expect(commandStarted).toBe(true);
    expect(app.exitCount).toBe(0);
    resolveCommand(1);
    await expect(pending).resolves.toBe(1);
    expect(app.exitCount).toBe(1);
    expect(app.exitedWith).toBe(1);
  });
});
