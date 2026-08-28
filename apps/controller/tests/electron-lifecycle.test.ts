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
  public readonly quit = vi.fn();
  public createdWindowCount = 0;

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
    expect(app.quit).toHaveBeenCalledTimes(1);
    expect(app.createdWindowCount).toBe(0);
  });

  it("returns nonzero and still quits once when the command throws", async () => {
    const app = new FakeElectronApp();
    const pending = runElectronLifecycle(app, async () => {
      throw new Error("command failed");
    });
    app.resolveReady();
    await expect(pending).resolves.toBe(1);
    expect(app.quit).toHaveBeenCalledTimes(1);
  });
});
