import { describe, expect, it, vi } from "vitest";

import {
  bindShowStopShortcut,
  SHOW_STOP_ACCELERATOR,
} from "../src/show-global-shortcut.ts";

describe("show global stop shortcut", () => {
  it("binds Ctrl+Shift+S and disposes the registration exactly once", () => {
    const callbacks = new Map<string, () => void>();
    const adapter = {
      register: vi.fn((accelerator: string, callback: () => void) => {
        callbacks.set(accelerator, callback);
        return true;
      }),
      unregister: vi.fn((accelerator: string) => {
        callbacks.delete(accelerator);
      }),
    };
    const stop = vi.fn();

    const dispose = bindShowStopShortcut(adapter, stop);

    expect(adapter.register).toHaveBeenCalledWith(
      SHOW_STOP_ACCELERATOR,
      expect.any(Function),
    );
    callbacks.get(SHOW_STOP_ACCELERATOR)!();
    callbacks.get(SHOW_STOP_ACCELERATOR)!();
    expect(stop).toHaveBeenCalledTimes(2);
    dispose!();
    dispose!();
    expect(adapter.unregister).toHaveBeenCalledTimes(1);
  });

  it("returns unavailable without registering cleanup", () => {
    const adapter = {
      register: vi.fn(() => false),
      unregister: vi.fn(),
    };

    expect(bindShowStopShortcut(adapter, vi.fn())).toBeUndefined();
    expect(adapter.unregister).not.toHaveBeenCalled();
  });
});
