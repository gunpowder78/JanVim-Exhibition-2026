export interface FrameTimingAdapter {
  requestFrame(callback: (timestamp: number) => void): number;
  cancelFrame(id: number): void;
  setTimer(callback: () => void, delayMs: number): number;
  clearTimer(id: number): void;
}

const SAMPLE_INTERVAL_COUNT = 8;
const SAMPLE_TIMEOUT_MS = 1_000;

export function sampleRendererFrameRate(adapter: FrameTimingAdapter): Promise<number | null> {
  return new Promise((resolve) => {
    const timestamps: number[] = [];
    let pendingFrame = 0;
    let settled = false;

    const timeoutId = adapter.setTimer(() => {
      if (settled) return;

      settled = true;
      adapter.cancelFrame(pendingFrame);
      resolve(null);
    }, SAMPLE_TIMEOUT_MS);

    const onFrame = (timestamp: number): void => {
      if (settled) return;

      timestamps.push(timestamp);
      if (timestamps.length === SAMPLE_INTERVAL_COUNT + 1) {
        settled = true;
        adapter.clearTimer(timeoutId);

        const elapsedMs = timestamps[timestamps.length - 1]! - timestamps[0]!;
        resolve(elapsedMs > 0 ? (SAMPLE_INTERVAL_COUNT * 1_000) / elapsedMs : null);
        return;
      }

      pendingFrame = adapter.requestFrame(onFrame);
    };

    pendingFrame = adapter.requestFrame(onFrame);
  });
}
