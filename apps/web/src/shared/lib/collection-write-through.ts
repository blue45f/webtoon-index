export interface CollectionAuthFence {
  userId: string;
  /** Legacy per-tab header credential. Null means authenticate with the HttpOnly cookie. */
  sessionToken: string | null;
  generation: number;
}

export type CollectionCommand =
  | {
      action: "create";
      id: string;
      name: string;
      emoji: string;
    }
  | {
      action: "rename";
      id: string;
      name: string;
    }
  | {
      action: "delete";
      id: string;
    }
  | {
      action: "set-item";
      id: string;
      titleId: string;
      included: boolean;
    };

export interface CollectionWriteJob {
  accountKey: string;
  laneKey: string;
  run: () => Promise<void>;
  shouldRetry: (error: unknown) => boolean;
  onSuccess?: () => void;
  onPermanentFailure: (error: unknown) => void;
  onTransientFailure: (error: unknown) => void;
}

/**
 * Per-account, per-collection FIFO for optimistic collection commands.
 *
 * Every new command is idempotent, so a transient transport failure gets one immediate retry.
 * The coordinator deliberately owns ordering only; auth fencing and revision-guarded projection
 * stay in the Zustand host, where the current account and optimistic state are authoritative.
 */
export class CollectionWriteThroughCoordinator {
  private readonly lanes = new Map<string, Promise<void>>();
  private readonly pendingByAccount = new Map<string, number>();
  private readonly promisesByAccount = new Map<string, Set<Promise<void>>>();

  enqueue(job: CollectionWriteJob): void {
    this.pendingByAccount.set(
      job.accountKey,
      (this.pendingByAccount.get(job.accountKey) ?? 0) + 1
    );
    const previous = this.lanes.get(job.laneKey) ?? Promise.resolve();

    const run = previous
      .then(async () => {
        try {
          await job.run();
        } catch (firstError) {
          if (!job.shouldRetry(firstError)) {
            job.onPermanentFailure(firstError);
            return;
          }
          try {
            await job.run();
          } catch (secondError) {
            if (job.shouldRetry(secondError)) job.onTransientFailure(secondError);
            else job.onPermanentFailure(secondError);
            return;
          }
        }
        job.onSuccess?.();
      })
      // A callback is application code. Keep one faulty rollback/toast from poisoning the FIFO
      // tail and starving every later command for this collection.
      .catch(() => {});

    const settled = run.finally(() => {
      const remaining = (this.pendingByAccount.get(job.accountKey) ?? 1) - 1;
      if (remaining > 0) this.pendingByAccount.set(job.accountKey, remaining);
      else this.pendingByAccount.delete(job.accountKey);
      const accountPromises = this.promisesByAccount.get(job.accountKey);
      accountPromises?.delete(settled);
      if (accountPromises?.size === 0) this.promisesByAccount.delete(job.accountKey);
      if (this.lanes.get(job.laneKey) === settled) this.lanes.delete(job.laneKey);
    });
    this.lanes.set(job.laneKey, settled);
    const accountPromises = this.promisesByAccount.get(job.accountKey) ?? new Set();
    accountPromises.add(settled);
    this.promisesByAccount.set(job.accountKey, accountPromises);
  }

  hasPending(accountKey: string): boolean {
    return (this.pendingByAccount.get(accountKey) ?? 0) > 0;
  }

  async waitForIdle(laneKey: string): Promise<void> {
    await (this.lanes.get(laneKey) ?? Promise.resolve());
  }

  async waitForAccountIdle(accountKey: string): Promise<void> {
    // Jobs may enqueue more work while a prior snapshot is settling. Loop until the account has
    // no tracked promise instead of taking a one-time snapshot that can resolve too early.
    while (true) {
      const pending = [...(this.promisesByAccount.get(accountKey) ?? [])];
      if (pending.length === 0) return;
      await Promise.all(pending);
    }
  }
}

export function collectionAccountKey(fence: CollectionAuthFence): string {
  // Token rotation changes the callback generation, but it must not split command ordering for
  // the same account. Cross-account isolation comes from userId; callbacks still verify generation.
  return fence.userId;
}

export function collectionLaneKey(
  fence: CollectionAuthFence,
  collectionId: string
): string {
  return `${collectionAccountKey(fence)}:${collectionId}`;
}

export type CollectionIdMap = Record<string, string>;

interface CollectionMergeResult {
  idMap: CollectionIdMap;
  error: Error | null;
}

export interface CollectionMergeHandle {
  readonly userId: string;
  readonly promise: Promise<CollectionMergeResult>;
  settle: (result: CollectionMergeResult) => void;
  settled: boolean;
}

const collectionMergeBarriers = new Map<string, CollectionMergeHandle>();

export function beginCollectionMerge(fence: CollectionAuthFence): CollectionMergeHandle {
  let settlePromise!: (result: CollectionMergeResult) => void;
  const handle: CollectionMergeHandle = {
    userId: fence.userId,
    promise: new Promise<CollectionMergeResult>((resolve) => {
      settlePromise = resolve;
    }),
    settle: (result) => {
      if (handle.settled) return;
      handle.settled = true;
      settlePromise(result);
    },
    settled: false,
  };
  collectionMergeBarriers.set(fence.userId, handle);
  return handle;
}

export function completeCollectionMerge(
  handle: CollectionMergeHandle,
  idMap: CollectionIdMap = {}
): void {
  if (collectionMergeBarriers.get(handle.userId) === handle) {
    collectionMergeBarriers.delete(handle.userId);
  }
  handle.settle({ idMap, error: null });
}

export function failCollectionMerge(handle: CollectionMergeHandle, error: unknown): void {
  const isCurrent = collectionMergeBarriers.get(handle.userId) === handle;
  const normalized = error instanceof Error ? error : new Error("컬렉션 병합에 실패했습니다.");
  // Keep a failed current barrier installed until the next login/merge attempt replaces it. This
  // prevents queued writes from targeting a pre-remap guest ID after a partial merge response.
  handle.settle(isCurrent
    ? { idMap: {}, error: normalized }
    : { idMap: {}, error: null });
}

export function clearCollectionMergeBarrier(userId: string): void {
  const barrier = collectionMergeBarriers.get(userId);
  if (!barrier) return;
  collectionMergeBarriers.delete(userId);
  barrier.settle({ idMap: {}, error: null });
}

export async function waitForCollectionMerge(userId: string): Promise<CollectionIdMap> {
  const aggregate: CollectionIdMap = {};
  while (true) {
    const barrier = collectionMergeBarriers.get(userId);
    if (!barrier) return aggregate;
    const result = await barrier.promise;
    if (result.error) throw result.error;
    Object.assign(aggregate, result.idMap);
    if (collectionMergeBarriers.get(userId) === barrier) return aggregate;
  }
}

export function remapCollectionId(id: string, idMap: CollectionIdMap): string {
  let current = id;
  const seen = new Set<string>();
  while (idMap[current] && !seen.has(current)) {
    seen.add(current);
    current = idMap[current] ?? current;
  }
  return current;
}

export function remapCollectionCommand(
  command: CollectionCommand,
  idMap: CollectionIdMap
): CollectionCommand {
  const id = remapCollectionId(command.id, idMap);
  return id === command.id ? command : { ...command, id };
}
