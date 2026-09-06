import type {
  StudioHistoryJournalNavigationTarget,
  StudioHistoryJournalTransitionInput,
} from "./studio-pages-history-command-journal";
import type {
  StudioPagesHistoryDurabilityStatus,
  StudioPagesHistoryPersistenceKind,
} from "./studio-pages-history-durable-runtime";

export type {
  StudioHistoryJournalNavigationTarget,
  StudioHistoryJournalTransitionInput,
} from "./studio-pages-history-command-journal";

const MAX_PENDING_HISTORY_JOURNAL_ACTIONS = 64;

type StudioHistoryJournalClientAction =
  | Readonly<{
      kind: "transition";
      input: StudioHistoryJournalTransitionInput;
    }>
  | Readonly<{
      kind: "undo" | "redo" | "rebase";
      target: StudioHistoryJournalNavigationTarget;
    }>
  | Readonly<{ kind: "reset" }>;

interface StudioPagesHistoryCommandJournalRuntime {
  recordTransition(input: StudioHistoryJournalTransitionInput): void;
  recordUndo(target: StudioHistoryJournalNavigationTarget): unknown;
  recordRedo(target: StudioHistoryJournalNavigationTarget): unknown;
  rebase(target: StudioHistoryJournalNavigationTarget): void;
  reset(): void;
  dispose?(): void;
  close?(): Promise<void>;
  durabilityStatus?(): StudioPagesHistoryDurabilityStatus;
}

export interface StudioPagesHistoryCommandJournalDurabilityStatus {
  readonly state: "initializing" | "retrying" | "durable" | "memory-only";
  readonly durable: boolean;
  readonly persistenceKind: StudioPagesHistoryPersistenceKind | null;
  readonly retryable: boolean;
  readonly cause: unknown;
}

export const STUDIO_PAGES_HISTORY_INITIAL_DURABILITY_STATUS:
StudioPagesHistoryCommandJournalDurabilityStatus = Object.freeze({
  state: "initializing",
  durable: false,
  persistenceKind: null,
  retryable: false,
  cause: null,
});

export interface StudioPagesHistoryCommandJournalClientOptions {
  readonly loadRuntime?: (
    initialTarget: StudioHistoryJournalNavigationTarget | null
  ) => Promise<StudioPagesHistoryCommandJournalRuntime>;
  readonly onError?: (cause: unknown) => void;
  readonly onDurabilityStatus?: (
    status: StudioPagesHistoryCommandJournalDurabilityStatus
  ) => void;
}

async function loadDefaultRuntime(
  initialTarget: StudioHistoryJournalNavigationTarget | null,
  onError?: (cause: unknown) => void,
  onDurabilityStatus?: (
    status: StudioPagesHistoryCommandJournalDurabilityStatus
  ) => void
): Promise<StudioPagesHistoryCommandJournalRuntime> {
  const { createDefaultStudioPagesHistoryDurableRuntime } = await import("./studio-pages-history-durable-runtime"
  );
  return createDefaultStudioPagesHistoryDurableRuntime({
    initialTarget,
    onError,
    onDurabilityStatus,
  });
}

function actionTarget(
  action: StudioHistoryJournalClientAction
): StudioHistoryJournalNavigationTarget | null {
  if (action.kind === "transition") {
    return {
      pages: action.input.nextPages,
      historyIndex: action.input.nextHistoryIndex,
    };
  }
  return action.kind === "reset" ? null : action.target;
}

/**
 * Non-blocking facade for the integrity journal.
 *
 * The snapshot history remains authoritative, so Studio can accept the user's first edit while the
 * journal chunk loads. Pending work is bounded; overload collapses to a checkpoint at the latest
 * authoritative snapshot instead of retaining a large sequence of page graphs.
 */
export class StudioPagesHistoryCommandJournalClient {
  private readonly loadRuntime: (
    initialTarget: StudioHistoryJournalNavigationTarget | null
  ) => Promise<StudioPagesHistoryCommandJournalRuntime>;
  private readonly onError: ((cause: unknown) => void) | undefined;
  private readonly onDurabilityStatus:
    | ((status: StudioPagesHistoryCommandJournalDurabilityStatus) => void)
    | undefined;
  private runtime: StudioPagesHistoryCommandJournalRuntime | null = null;
  private loadPromise: Promise<boolean> | null = null;
  private pending: StudioHistoryJournalClientAction[] = [];
  private latestTarget: StudioHistoryJournalNavigationTarget | null = null;
  private lastReadinessError: unknown = null;
  private durability: StudioPagesHistoryCommandJournalDurabilityStatus =
    STUDIO_PAGES_HISTORY_INITIAL_DURABILITY_STATUS;
  private readonly durabilityListeners = new Set<
    (status: StudioPagesHistoryCommandJournalDurabilityStatus) => void
  >();
  private disposed = false;

  constructor(options: StudioPagesHistoryCommandJournalClientOptions = {}) {
    this.onError = options.onError;
    this.onDurabilityStatus = options.onDurabilityStatus;
    this.loadRuntime = options.loadRuntime ?? (
      (initialTarget) => loadDefaultRuntime(
        initialTarget,
        options.onError,
        (status) => this.publishDurabilityStatus(status),
      )
    );
    this.publishDurabilityStatus(STUDIO_PAGES_HISTORY_INITIAL_DURABILITY_STATUS);
  }

  private publishDurabilityStatus(
    status: StudioPagesHistoryCommandJournalDurabilityStatus
  ): void {
    this.durability = Object.freeze({ ...status });
    try {
      this.onDurabilityStatus?.(this.durability);
    } catch {
      // A status observer cannot escape into the accepted edit path.
    }
    for (const listener of [...this.durabilityListeners]) {
      try {
        listener(this.durability);
      } catch {
        // One UI observer cannot hide status from another observer.
      }
    }
  }

  private apply(
    runtime: StudioPagesHistoryCommandJournalRuntime,
    action: StudioHistoryJournalClientAction
  ): void {
    if (action.kind === "transition") {
      runtime.recordTransition(action.input);
    } else if (action.kind === "undo") {
      runtime.recordUndo(action.target);
    } else if (action.kind === "redo") {
      runtime.recordRedo(action.target);
    } else if (action.kind === "rebase") {
      runtime.rebase(action.target);
    } else {
      runtime.reset();
    }
  }

  private reportError(cause: unknown): void {
    try {
      this.onError?.(cause);
    } catch {
      // Diagnostics must never escape into the creator's accepted edit path.
    }
  }

  private retainLatestCheckpoint(): void {
    if (this.disposed) {
      this.pending = [];
      return;
    }
    const checkpoint = this.latestTarget;
    this.pending = checkpoint
      ? [{ kind: "rebase", target: checkpoint }]
      : [{ kind: "reset" }];
  }

  private recoverRuntime(
    runtime: StudioPagesHistoryCommandJournalRuntime,
    cause: unknown
  ): boolean {
    this.reportError(cause);
    if (this.disposed) {
      this.runtime = null;
      return false;
    }
    try {
      if (this.latestTarget) runtime.rebase(this.latestTarget);
      else runtime.reset();
      this.lastReadinessError = null;
      return true;
    } catch (recoveryCause) {
      this.reportError(recoveryCause);
      this.lastReadinessError = recoveryCause;
      this.runtime = null;
      this.retainLatestCheckpoint();
      return false;
    }
  }

  private ensureRuntime(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    if (this.runtime) return Promise.resolve(true);
    if (this.loadPromise) return this.loadPromise;
    this.lastReadinessError = null;
    const loadPromise = Promise.resolve()
      // A custom loader is allowed for tests/alternate runtimes. Normalize a synchronous throw into
      // this fail-open promise boundary rather than letting it escape from recordTransition().
      .then(() => this.disposed ? null : this.loadRuntime(this.latestTarget))
      .then((runtime) => {
        if (!runtime) return false;
        if (this.disposed) {
          // Dynamic import/runtime construction cannot be cancelled. A runtime may therefore
          // acquire its durable writer after the owning StrictMode generation or route has already
          // unmounted. Dispose that late authority immediately instead of leaking its 30s lease.
          runtime.dispose?.();
          return false;
        }
        this.runtime = runtime;
        const runtimeDurability = runtime.durabilityStatus?.();
        if (runtimeDurability) this.publishDurabilityStatus(runtimeDurability);
        const pending = this.pending;
        this.pending = [];
        for (const action of pending) {
          if (this.disposed) {
            this.runtime = null;
            return false;
          }
          try {
            this.apply(runtime, action);
          } catch (cause) {
            // A successful checkpoint recovery represents every remaining queued action because
            // latestTarget always points at the authoritative final snapshot.
            return this.recoverRuntime(runtime, cause);
          }
        }
        this.lastReadinessError = null;
        return true;
      })
      .catch((cause: unknown) => {
        this.reportError(cause);
        if (this.disposed) return false;
        this.runtime = null;
        this.lastReadinessError = cause;
        this.publishDurabilityStatus({
          state: "memory-only",
          durable: false,
          persistenceKind: "memory-only",
          retryable: true,
          cause,
        });
        this.retainLatestCheckpoint();
        return false;
      })
      .finally(() => {
        if (this.loadPromise === loadPromise) this.loadPromise = null;
      });
    this.loadPromise = loadPromise;
    return loadPromise;
  }

  private enqueue(action: StudioHistoryJournalClientAction): void {
    if (this.disposed) return;
    const target = actionTarget(action);
    if (action.kind === "reset") this.latestTarget = null;
    else if (target) this.latestTarget = target;

    const runtime = this.runtime;
    if (runtime) {
      try {
        this.apply(runtime, action);
      } catch (cause) {
        if (!this.recoverRuntime(runtime, cause)) {
          // One bounded retry may replace a runtime whose own recovery path failed. A failure while
          // draining that retry remains checkpointed until the next action/ready() call.
          void this.ensureRuntime();
        }
      }
      return;
    }

    const previous = this.pending.at(-1);
    if (
      action.kind === "transition"
      && previous?.kind === "transition"
      && action.input.coalesceKey !== undefined
      && action.input.coalesceKey === previous.input.coalesceKey
      && (
        previous.input.nextHistoryIndex === action.input.previousHistoryIndex
        || previous.input.nextHistoryIndex === action.input.nextHistoryIndex
      )
    ) {
      this.pending[this.pending.length - 1] = {
        kind: "transition",
        input: {
          ...previous.input,
          mutationKind: action.input.mutationKind,
          nextPages: action.input.nextPages,
          nextHistoryIndex: action.input.nextHistoryIndex,
        },
      };
    } else {
      this.pending.push(action);
    }

    if (this.pending.length > MAX_PENDING_HISTORY_JOURNAL_ACTIONS) {
      this.pending = this.latestTarget
        ? [{ kind: "rebase", target: this.latestTarget }]
        : [{ kind: "reset" }];
    }
    void this.ensureRuntime();
  }

  recordTransition(input: StudioHistoryJournalTransitionInput): void {
    this.enqueue({ kind: "transition", input });
  }

  recordUndo(target: StudioHistoryJournalNavigationTarget): void {
    this.enqueue({ kind: "undo", target });
  }

  recordRedo(target: StudioHistoryJournalNavigationTarget): void {
    this.enqueue({ kind: "redo", target });
  }

  rebase(target: StudioHistoryJournalNavigationTarget): void {
    this.enqueue({ kind: "rebase", target });
  }

  reset(): void {
    this.enqueue({ kind: "reset" });
  }

  /**
   * Release queued page graphs and ignore a runtime that resolves after the owning Studio unmounts.
  * Dynamic import itself cannot be aborted, but disposed clients never replay its pending work.
  */
  dispose(): void {
    this.disposed = true;
    this.runtime?.dispose?.();
    this.runtime = null;
    this.pending = [];
    this.latestTarget = null;
    this.lastReadinessError = null;
    this.durabilityListeners.clear();
  }

  durabilityStatus(): StudioPagesHistoryCommandJournalDurabilityStatus {
    return this.durability;
  }

  observeDurabilityStatus(
    listener: (status: StudioPagesHistoryCommandJournalDurabilityStatus) => void
  ): () => void {
    if (this.disposed) return () => undefined;
    this.durabilityListeners.add(listener);
    try {
      listener(this.durability);
    } catch {
      // The subscription remains live even if its initial render callback fails.
    }
    return () => {
      this.durabilityListeners.delete(listener);
    };
  }

  /**
   * Reopens the durable authority and checkpoints the latest accepted snapshot into it.
   * Editing stays available while this promise runs; a failed retry remains explicitly
   * memory-only and can be attempted again.
   */
  async retryDurability(): Promise<boolean> {
    if (this.disposed) return false;
    if (this.durability.durable) return true;
    this.publishDurabilityStatus({
      state: "retrying",
      durable: false,
      persistenceKind: null,
      retryable: false,
      cause: this.durability.cause,
    });
    const previous = this.runtime;
    this.runtime = null;
    if (previous?.close) await previous.close().catch(() => undefined);
    else previous?.dispose?.();
    this.retainLatestCheckpoint();
    this.lastReadinessError = null;
    const ready = await this.ensureRuntime();
    return ready && this.durability.durable;
  }

  /** Await only in diagnostics/tests; Studio editing never blocks on journal loading. */
  async ready(): Promise<void> {
    if (this.disposed) {
      throw new Error("Studio history journal client has been disposed.");
    }
    const ready = await this.ensureRuntime();
    if (this.disposed) {
      throw new Error("Studio history journal client has been disposed.");
    }
    if (!ready || !this.runtime) {
      if (this.lastReadinessError instanceof Error) {
        throw this.lastReadinessError;
      }
      throw new Error("Studio history journal runtime is not ready.", {
        cause: this.lastReadinessError,
      });
    }
  }
}

export function createStudioPagesHistoryCommandJournalClient(
  options: StudioPagesHistoryCommandJournalClientOptions = {}
): StudioPagesHistoryCommandJournalClient {
  return new StudioPagesHistoryCommandJournalClient(options);
}
