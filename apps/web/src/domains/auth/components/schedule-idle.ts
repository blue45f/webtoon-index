type IdleWindow = Window &
  typeof globalThis & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };

export function scheduleIdle(callback: () => void) {
  const win = window as IdleWindow;
  if (typeof win.requestIdleCallback === "function") {
    const id = win.requestIdleCallback(callback, { timeout: 3500 });
    return () => win.cancelIdleCallback?.(id);
  }
  const id = win.setTimeout(callback, 2500);
  return () => win.clearTimeout(id);
}
