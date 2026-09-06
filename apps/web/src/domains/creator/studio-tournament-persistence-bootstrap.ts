import { isStudioLocalDatabaseOwnershipBusyError } from "./studio-local-database-ownership";
import {
  getStudioTournamentRuntime,
  type StudioRendererTournamentRuntime,
} from "./studio-renderer-tournament-runtime";

/**
 * The renderer tournament is a synchronous decision surface, but its durable
 * winner cache lives in SQLite/OPFS. Keep those two concerns on opposite sides
 * of a dynamic-import boundary: Studio can draw immediately from pristine
 * in-memory state while persistence installs and hydrates after mount.
 */

export interface StudioTournamentPersistenceModule {
  installStudioTournamentSqlitePersistence(): void;
}

export interface StudioTournamentPersistenceBootstrapDependencies {
  loadPersistence(): Promise<StudioTournamentPersistenceModule>;
  getRuntime(): StudioRendererTournamentRuntime;
  warn(message: string, cause: unknown): void;
}

export interface StudioTournamentPersistenceBootstrap {
  /** Starts one shared install/hydration attempt without blocking the caller. */
  boot(): Promise<boolean>;
}

/**
 * Creates an idempotent async bootstrap. Installation always precedes shared
 * runtime construction, so the runtime captures the SQLite/OPFS adapter rather
 * than becoming memory-only. A failed module load may be retried later. A
 * database-open failure returns false and emits the runtime's explicit
 * non-durable status; it is never reported as a successful boot.
 */
export function createStudioTournamentPersistenceBootstrap(
  dependencies: StudioTournamentPersistenceBootstrapDependencies,
): StudioTournamentPersistenceBootstrap {
  let pending: Promise<boolean> | null = null;

  return {
    boot(): Promise<boolean> {
      if (pending) return pending;

      const attempt = dependencies
        .loadPersistence()
        .then(async (persistenceModule) => {
          persistenceModule.installStudioTournamentSqlitePersistence();
          const runtime = dependencies.getRuntime();
          await runtime.hydrate();
          const status = runtime.persistenceStatus();
          if (!status.durable) {
            // Another same-origin tab already owns the OPFS SAH Worker. Memory-only
            // tournament cache is the designed degrade — do not dump lock text.
            if (!isStudioLocalDatabaseOwnershipBusyError(status)) {
              dependencies.warn(
                "studio tournament is running memory-only; SQLite/OPFS persistence is unavailable",
                status,
              );
            }
            return false;
          }
          return true;
        })
        .catch((cause: unknown) => {
          if (!isStudioLocalDatabaseOwnershipBusyError(cause)) {
            dependencies.warn("studio tournament persistence bootstrap skipped", cause);
          }
          return false;
        });

      pending = attempt;
      void attempt.then((installed) => {
        if (!installed && pending === attempt) pending = null;
      });
      return attempt;
    },
  };
}

const productBootstrap = createStudioTournamentPersistenceBootstrap({
  loadPersistence: () => import("./studio-tournament-sqlite-persistence"),
  getRuntime: getStudioTournamentRuntime,
  warn: (message, cause) => console.warn(message, cause),
});

/** Starts the product SQLite/OPFS install after Studio has mounted. */
export function bootStudioTournamentPersistence(): Promise<boolean> {
  return productBootstrap.boot();
}
