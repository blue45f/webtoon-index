export interface StudioDrawingShortcutNotice {
  readonly id: number;
  readonly message: string;
}

export interface StudioDrawingShortcutNoticeStore {
  /** `useSyncExternalStore` subscription. */
  readonly subscribe: (onStoreChange: () => void) => () => void;
  /** Stable while the active notice has not changed. */
  readonly getSnapshot: () => StudioDrawingShortcutNotice | null;
  /**
   * Publishes a distinct active message. A duplicate returns `null` so its
   * existing dismissal deadline is not extended.
   */
  readonly publish: (message: string) => StudioDrawingShortcutNotice | null;
  /** Clears only the notice that owns `expectedId`, protecting newer notices from stale timers. */
  readonly clear: (expectedId: number) => boolean;
}

export function createStudioDrawingShortcutNoticeStore(): StudioDrawingShortcutNoticeStore {
  let sequence = 0;
  let snapshot: StudioDrawingShortcutNotice | null = null;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    subscribe(onStoreChange) {
      listeners.add(onStoreChange);
      return () => {
        listeners.delete(onStoreChange);
      };
    },
    getSnapshot() {
      return snapshot;
    },
    publish(message) {
      if (snapshot?.message === message) return null;
      sequence += 1;
      snapshot = Object.freeze({ id: sequence, message });
      notify();
      return snapshot;
    },
    clear(expectedId) {
      if (snapshot?.id !== expectedId) return false;
      snapshot = null;
      notify();
      return true;
    },
  };
}
