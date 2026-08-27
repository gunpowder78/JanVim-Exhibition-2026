import { describe, expect, it } from "vitest";

import { sampleRendererFrameRate } from "../src/frame-rate-monitor.ts";

describe("renderer frame-rate monitor", () => {
  it("computes FPS from exactly eight monotonic frame intervals", async () => {
    const callbacks: Array<(timestamp: number) => void> = [];
    let requestCount = 0;
    let clearCount = 0;

    const result = sampleRendererFrameRate({
      requestFrame: (callback) => {
        callbacks.push(callback);
        requestCount += 1;
        return requestCount;
      },
      cancelFrame: () => {
        throw new Error("completed samples must not cancel a consumed frame");
      },
      setTimer: () => 17,
      clearTimer: (id) => {
        expect(id).toBe(17);
        clearCount += 1;
      },
    });

    for (const timestamp of [0, 50, 100, 150, 200, 250, 300, 350, 400]) {
      const callback = callbacks.shift();
      expect(callback).toBeDefined();
      callback?.(timestamp);
    }

    await expect(result).resolves.toBe(20);
    expect(requestCount).toBe(9);
    expect(callbacks).toHaveLength(0);
    expect(clearCount).toBe(1);
  });

  it("returns null and cancels the pending frame at the finite timeout", async () => {
    let timeout: (() => void) | undefined;
    let cancelledFrame: number | undefined;

    const result = sampleRendererFrameRate({
      requestFrame: () => 23,
      cancelFrame: (id) => {
        cancelledFrame = id;
      },
      setTimer: (callback, delayMs) => {
        expect(delayMs).toBe(1_000);
        timeout = callback;
        return 29;
      },
      clearTimer: () => {
        throw new Error("timeout path must not clear its already-fired timer");
      },
    });

    timeout?.();

    await expect(result).resolves.toBeNull();
    expect(cancelledFrame).toBe(23);
  });
});
