/** Event-time click suppression; rendering never reads a clock or starts a timer. */
export function createStudioHybridDccSelectionGate<Handle>(
  schedule: (release: () => void, delayMs: number) => Handle,
  unschedule: (handle: Handle) => void,
) {
  let pending: { handle: Handle } | null = null;
  let generation = 0;
  let blocked = false;
  let disposed = false;
  const clear = () => {
    generation += 1;
    if (pending) unschedule(pending.handle);
    pending = null;
  };
  return {
    allows() { return !blocked && !disposed; },
    suppress(delayMs = 120) {
      if (disposed) return;
      clear();
      blocked = true;
      const lease = generation;
      pending = { handle: schedule(() => {
        if (disposed || lease !== generation) return;
        blocked = false;
        pending = null;
      }, delayMs) };
    },
    dispose() {
      clear();
      disposed = true;
      blocked = true;
    },
  };
}
