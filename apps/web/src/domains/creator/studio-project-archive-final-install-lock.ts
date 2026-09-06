/**
 * Origin-wide transaction fence for the final project-archive install/apply/compensation chain.
 *
 * Reference, VRM, and texture libraries may expose a newly created row to another import before
 * the creating import knows whether its document apply will commit. If the creator then rolls back,
 * that second import would retain a dangling "reused" reference. One lock must therefore cover the
 * whole nested install through either successful project apply or exact compensation.
 */

export const STUDIO_PROJECT_ARCHIVE_FINAL_INSTALL_LOCK_NAME =
  "toonspectrum-studio-project-archive:final-install-v1";

export interface StudioProjectArchiveFinalInstallLockManagerLike {
  request<T>(
    name: string,
    options: { readonly mode: "exclusive" },
    callback: () => Promise<T>,
  ): Promise<T>;
}

export class StudioProjectArchiveFinalInstallLockError extends Error {
  readonly code = "archive-final-install-lock-unavailable" as const;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StudioProjectArchiveFinalInstallLockError";
  }
}

export interface StudioProjectArchiveFinalInstallLockOptions {
  /** Test seam. Undefined selects the product browser authority; null explicitly disables it. */
  readonly lockManager?: StudioProjectArchiveFinalInstallLockManagerLike | null;
}

let inRealmTail: Promise<unknown> = Promise.resolve();

function browserLockManager(): StudioProjectArchiveFinalInstallLockManagerLike | null {
  try {
    const manager = typeof navigator === "undefined"
      ? null
      : (navigator as Navigator & {
          readonly locks?: StudioProjectArchiveFinalInstallLockManagerLike;
        }).locks;
    return manager && typeof manager.request === "function" ? manager : null;
  } catch {
    return null;
  }
}

/**
 * Runs one complete final archive transaction under both an in-realm queue and an origin-wide Web
 * Lock. Product code fails closed when Web Locks are unavailable; it never silently weakens this to
 * a tab-local mutex.
 */
export function runStudioProjectArchiveFinalInstallExclusive<T>(
  task: () => Promise<T>,
  options: StudioProjectArchiveFinalInstallLockOptions = {},
): Promise<T> {
  const manager = options.lockManager === undefined
    ? browserLockManager()
    : options.lockManager;
  if (!manager) {
    return Promise.reject(new StudioProjectArchiveFinalInstallLockError(
      "Web Locks가 없어 프로젝트 archive 최종 설치를 탭 간 안전하게 실행할 수 없습니다.",
    ));
  }
  const execute = async (): Promise<T> => {
    let taskEntered = false;
    try {
      return await manager.request(
        STUDIO_PROJECT_ARCHIVE_FINAL_INSTALL_LOCK_NAME,
        { mode: "exclusive" },
        async () => {
          taskEntered = true;
          return await task();
        },
      );
    } catch (cause) {
      // Archive/rollback failures must retain their exact type (notably AggregateError). Only a
      // failure before callback admission is a lock-acquisition failure.
      if (taskEntered) throw cause;
      if (cause instanceof StudioProjectArchiveFinalInstallLockError) throw cause;
      throw new StudioProjectArchiveFinalInstallLockError(
        "프로젝트 archive 최종 설치 잠금을 획득하거나 완료하지 못했습니다.",
        { cause },
      );
    }
  };
  const run = inRealmTail.then(execute, execute);
  inRealmTail = run.catch(() => undefined);
  return run;
}
