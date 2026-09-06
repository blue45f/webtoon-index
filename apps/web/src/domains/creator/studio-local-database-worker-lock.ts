/** Origin-wide ownership gate for the OPFS SQLite SAH pool. */
export const STUDIO_LOCAL_DATABASE_WORKER_LOCK_NAME =
  "toonspectrum-studio-local-v12-opfs-worker-owner";

export type StudioLocalDatabaseWorkerLockErrorCode =
  | "web-locks-unavailable"
  | "lock-unavailable"
  | "lock-request-failed";

export class StudioLocalDatabaseWorkerLockError extends Error {
  readonly code: StudioLocalDatabaseWorkerLockErrorCode;

  constructor(
    code: StudioLocalDatabaseWorkerLockErrorCode,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.name = "StudioLocalDatabaseWorkerLockError";
    this.code = code;
  }
}

export interface StudioLocalDatabaseWorkerLockManagerLike {
  request<T>(
    name: string,
    options: { readonly mode: "exclusive"; readonly ifAvailable: true },
    callback: (lock: unknown | null) => T | PromiseLike<T>,
  ): Promise<T>;
}

export interface StudioLocalDatabaseWorkerLockLease {
  readonly name: typeof STUDIO_LOCAL_DATABASE_WORKER_LOCK_NAME;
  release(): Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown Web Lock failure";
}

/**
 * Acquires the database lock without waiting. The callback deliberately stays pending until
 * release(), so ownership spans SQLite initialization, all RPC operations, and DB close.
 */
export async function acquireStudioLocalDatabaseWorkerLock(
  lockManager: StudioLocalDatabaseWorkerLockManagerLike | null,
): Promise<StudioLocalDatabaseWorkerLockLease> {
  if (!lockManager) {
    throw new StudioLocalDatabaseWorkerLockError(
      "web-locks-unavailable",
      "Studio OPFS SQLite requires Web Locks inside its DedicatedWorker",
    );
  }

  let releaseLifetime: (() => void) | null = null;
  const lifetime = new Promise<void>((resolve) => {
    releaseLifetime = resolve;
  });
  let resolveAcquired: (() => void) | null = null;
  let rejectAcquired: ((error: unknown) => void) | null = null;
  const acquired = new Promise<void>((resolve, reject) => {
    resolveAcquired = resolve;
    rejectAcquired = reject;
  });

  const ownership = lockManager.request(
    STUDIO_LOCAL_DATABASE_WORKER_LOCK_NAME,
    { mode: "exclusive", ifAvailable: true },
    async (lock) => {
      if (lock === null) {
        rejectAcquired?.(
          new StudioLocalDatabaseWorkerLockError(
            "lock-unavailable",
            "Studio OPFS SQLite is already owned by another page",
          ),
        );
        return;
      }
      resolveAcquired?.();
      await lifetime;
    },
  );
  void ownership.catch((error: unknown) => {
    rejectAcquired?.(
      new StudioLocalDatabaseWorkerLockError(
        "lock-request-failed",
        `Studio OPFS SQLite Web Lock request failed: ${errorMessage(error)}`,
        { cause: error },
      ),
    );
  });

  await acquired;
  let released = false;
  return Object.freeze({
    name: STUDIO_LOCAL_DATABASE_WORKER_LOCK_NAME,
    async release(): Promise<void> {
      if (released) return;
      released = true;
      releaseLifetime?.();
      try {
        await ownership;
      } catch (error) {
        throw new StudioLocalDatabaseWorkerLockError(
          "lock-request-failed",
          `Studio OPFS SQLite Web Lock release failed: ${errorMessage(error)}`,
          { cause: error },
        );
      }
    },
  });
}
