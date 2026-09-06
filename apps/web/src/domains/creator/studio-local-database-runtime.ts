import type {
  StudioLocalDatabase,
  StudioSqliteSupportProbe,
} from "./studio-local-database";

/**
 * One app-lifetime SQLite proxy shared by history, renderer tournament, and subsequent local
 * metadata repositories. The real SQLite handle and OPFS SAH pool live in one DedicatedWorker;
 * Window does not expose createSyncAccessHandle and must never initialize sqlite-wasm directly.
 */
let sharedDatabase: Promise<StudioLocalDatabase> | null = null;
let sharedDatabaseUsesProductWorker = false;
let sharedClosing: Promise<void> | null = null;

async function openStudioLocalDatabaseProductWorker(): Promise<StudioLocalDatabase> {
  const workerRuntime = await import("./studio-local-database-worker-client");
  return workerRuntime.acquireStudioLocalDatabaseWorker();
}

export function acquireStudioLocalDatabase(
  openDatabase?: () => Promise<StudioLocalDatabase>,
): Promise<StudioLocalDatabase> {
  if (sharedDatabase) return sharedDatabase;
  if (sharedClosing) {
    return sharedClosing.then(() => acquireStudioLocalDatabase(openDatabase));
  }
  sharedDatabaseUsesProductWorker = openDatabase === undefined;
  sharedDatabase = Promise.resolve().then(
    openDatabase ?? openStudioLocalDatabaseProductWorker,
  );
  return sharedDatabase;
}

/**
 * Product-path capability probe used by Help Center diagnostics.
 *
 * A Window-side OPFS feature check is not authoritative: the synchronous OPFS APIs required by
 * sqlite-wasm are intentionally owned by the DedicatedWorker. Opening the shared product runtime
 * is the smallest end-to-end proof that both wasm and its OPFS VFS are usable in this session.
 */
export async function probeStudioLocalDatabaseRuntime(): Promise<StudioSqliteSupportProbe> {
  try {
    await acquireStudioLocalDatabase();
    return { wasm: true, opfs: true };
  } catch (cause) {
    return {
      wasm: false,
      opfs: false,
      reason: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

export interface CloseStudioLocalDatabaseRuntimeOptions {
  /** Preserve the tab-lifetime brush fallback while another product surface retries OPFS. */
  readonly preserveBrushMemorySession?: boolean;
}

/** Test/session shutdown seam. Product code normally keeps the handle for the app lifetime. */
export async function closeStudioLocalDatabaseRuntime(
  options: CloseStudioLocalDatabaseRuntimeOptions = {},
): Promise<void> {
  if (sharedClosing) return sharedClosing;
  const database = sharedDatabase;
  sharedDatabase = null;
  const usesProductWorker = sharedDatabaseUsesProductWorker;
  sharedDatabaseUsesProductWorker = false;
  const closing = (async () => {
    // A product brush repository retains either this database generation or its
    // memory-session fallback. Invalidate it before a caller can reopen the DB.
    // The dynamic edge avoids making the shared DB authority depend statically on
    // one of its consumers.
    try {
      const brushLibrary = await import("./brush/studio-brush-library-sqlite-repository");
      await brushLibrary.reconcileProductBrushLibraryRepositoryForDatabaseClose({
        preserveMemorySession: options.preserveBrushMemorySession,
      });
    } catch {
      // The brush module can be absent from narrow runtime/test graphs.
    }
    if (!database) return;
    try {
      if (usesProductWorker) {
        // First let the pending dynamic import/acquire establish its module singleton. Closing the
        // returned proxy directly can otherwise leave that singleton pointing at a closed session.
        await database.catch(() => undefined);
        const workerRuntime = await import("./studio-local-database-worker-client");
        await workerRuntime.closeStudioLocalDatabaseWorker();
      } else {
        await (await database).close();
      }
    } catch {
      // A failed open has no handle to close. The reset still permits an explicit retry.
    }
  })().finally(() => {
    if (sharedClosing === closing) sharedClosing = null;
  });
  sharedClosing = closing;
  return closing;
}
