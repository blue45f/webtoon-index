export type StudioToolHintCoordinator = {
  claim: (hintId: string) => string | null;
  release: (hintId: string) => boolean;
  markPending: (hintId: string) => void;
  clearPending: (hintId: string) => boolean;
  dismissAll: () => number;
  getActiveHintId: () => string | null;
  getDismissEpoch: () => number;
  subscribe: (listener: () => void) => () => void;
};

/**
 * Keeps transient Studio help on one exclusive channel. A guarded release is
 * important here: a delayed blur from the previous target must never dismiss
 * the target that has since taken ownership.
 */
export function createStudioToolHintCoordinator(): StudioToolHintCoordinator {
  let activeHintId: string | null = null;
  let dismissEpoch = 0;
  const pendingHintIds = new Set<string>();
  const listeners = new Set<() => void>();

  function emit() {
    for (const listener of listeners) listener();
  }

  return {
    claim(hintId) {
      const previousHintId = activeHintId;
      // An explicit claim is newer than every delayed hover intent. Clear the
      // whole pending lane so an older target cannot wake up after keyboard
      // focus (or another immediate reveal) has already taken ownership.
      pendingHintIds.clear();
      if (previousHintId === hintId) return previousHintId;
      activeHintId = hintId;
      emit();
      return previousHintId;
    },
    release(hintId) {
      if (activeHintId !== hintId) return false;
      activeHintId = null;
      emit();
      return true;
    },
    markPending(hintId) {
      pendingHintIds.add(hintId);
    },
    clearPending(hintId) {
      return pendingHintIds.delete(hintId);
    },
    dismissAll() {
      if (activeHintId === null && pendingHintIds.size === 0) return dismissEpoch;
      activeHintId = null;
      pendingHintIds.clear();
      dismissEpoch += 1;
      emit();
      return dismissEpoch;
    },
    getActiveHintId() {
      return activeHintId;
    },
    getDismissEpoch() {
      return dismissEpoch;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
