export interface StudioHybridDccLatestTask {
  readonly run: () => Promise<void>;
  readonly onError?: (cause: unknown) => void;
}

export interface StudioHybridDccLatestTaskQueue {
  /** Runs one task per scope and retains only the newest task waiting behind it. */
  enqueue(scope: string, task: StudioHybridDccLatestTask): void;
  readonly activeScopeCount: number;
}

interface StudioHybridDccScopeTaskState {
  running: boolean;
  pending: StudioHybridDccLatestTask | null;
}

/**
 * Bounded latest-write-wins queue. Different documents drain independently, while a slow
 * checkpoint retains at most one newer snapshot for its own document.
 */
export function createStudioHybridDccLatestTaskQueue(): StudioHybridDccLatestTaskQueue {
  const states = new Map<string, StudioHybridDccScopeTaskState>();

  const start = (
    scope: string,
    state: StudioHybridDccScopeTaskState,
    task: StudioHybridDccLatestTask,
  ) => {
    state.running = true;
    void Promise.resolve()
      .then(task.run)
      .catch((cause: unknown) => {
        try {
          task.onError?.(cause);
        } catch {
          // UI reporting must never stall the durable queue.
        }
      })
      .finally(() => {
        const next = state.pending;
        state.pending = null;
        if (next) {
          start(scope, state, next);
          return;
        }
        state.running = false;
        if (states.get(scope) === state) states.delete(scope);
      });
  };

  return {
    enqueue(scope, task) {
      if (scope.length === 0) throw new Error("Hybrid DCC task scope must not be empty.");
      const state = states.get(scope) ?? { running: false, pending: null };
      if (!states.has(scope)) states.set(scope, state);
      if (state.running) {
        state.pending = task;
        return;
      }
      start(scope, state, task);
    },
    get activeScopeCount() {
      return states.size;
    },
  };
}
