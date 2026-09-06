export const SHOW_STOP_ACCELERATOR = "Control+Shift+S";

export interface GlobalShortcutAdapter {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

export function bindShowStopShortcut(
  adapter: GlobalShortcutAdapter,
  listener: () => void,
): (() => void) | undefined {
  if (!adapter.register(SHOW_STOP_ACCELERATOR, listener)) return undefined;
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    adapter.unregister(SHOW_STOP_ACCELERATOR);
  };
}
