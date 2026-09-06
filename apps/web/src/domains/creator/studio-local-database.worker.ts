/// <reference lib="webworker" />

import { attachStudioLocalDatabaseWorkerHost } from "./studio-local-database-worker-host";
import {
  acquireStudioLocalDatabaseWorkerLock,
  type StudioLocalDatabaseWorkerLockLease,
  type StudioLocalDatabaseWorkerLockManagerLike,
} from "./studio-local-database-worker-lock";
import { loadStudioLocalDatabaseWorkerSqlite } from "./studio-local-database-worker-sqlite-loader";

import type { StudioLocalDatabaseWorkerDatabase } from "./studio-local-database-worker-database";

const scope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

function workerLockManager(): StudioLocalDatabaseWorkerLockManagerLike | null {
  if (!navigator.locks) return null;
  return {
    request: (name, options, callback) =>
      navigator.locks.request(name, options, (lock) => callback(lock)),
  };
}

function leaseDatabase(
  database: StudioLocalDatabaseWorkerDatabase,
  lease: StudioLocalDatabaseWorkerLockLease,
): StudioLocalDatabaseWorkerDatabase {
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    let databaseError: unknown;
    try {
      await database.close();
    } catch (error) {
      databaseError = error;
    }
    try {
      await lease.release();
    } catch (lockError) {
      if (databaseError !== undefined) {
        throw new AggregateError(
          [databaseError, lockError],
          "Studio local database and its Worker ownership lock both failed to close",
          { cause: lockError },
        );
      }
      throw lockError;
    }
    if (databaseError !== undefined) throw databaseError;
  };

  return new Proxy(database, {
    get(target, property, receiver): unknown {
      if (property === "close") return close;
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function openWorkerOwnedDatabase(): Promise<StudioLocalDatabaseWorkerDatabase> {
  let lease: StudioLocalDatabaseWorkerLockLease;
  try {
    lease = await acquireStudioLocalDatabaseWorkerLock(workerLockManager());
  } catch (error) {
    const { SqliteUnavailableError } = await import("./studio-local-database");
    const reason =
      error instanceof Error
        ? `DedicatedWorker ownership lock failed: ${error.message}`
        : "DedicatedWorker ownership lock failed";
    throw new SqliteUnavailableError(reason, { cause: error });
  }
  try {
    // Keep both the application DB module and sqlite-wasm out of the page/main bundle and cold
    // Worker path. openStudioLocalDatabase performs its own dynamic sqlite-wasm initialization.
    const { openStudioLocalDatabase } = await import("./studio-local-database");
    const database = await openStudioLocalDatabase({
      vfs: "opfs",
      loadSqlite: loadStudioLocalDatabaseWorkerSqlite,
    });
    return leaseDatabase(database as StudioLocalDatabaseWorkerDatabase, lease);
  } catch (error) {
    try {
      await lease.release();
    } catch {
      // The database/open error is the primary initialization failure.
    }
    throw error;
  }
}

attachStudioLocalDatabaseWorkerHost(scope, {
  openDatabase: openWorkerOwnedDatabase,
});

export {};
