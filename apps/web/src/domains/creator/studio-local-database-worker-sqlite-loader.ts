import type { StudioSqliteApiHandle } from "./studio-local-database";

interface StudioSqliteWasmModule {
  default(): Promise<StudioSqliteApiHandle>;
}

interface StudioSqliteApiConfigGlobal {
  sqlite3ApiConfig?: unknown;
}

export interface StudioLocalDatabaseWorkerSqliteLoaderOptions {
  readonly globalObject?: StudioSqliteApiConfigGlobal;
  readonly loadModule?: () => Promise<StudioSqliteWasmModule>;
}

/**
 * Initializes sqlite-wasm for the single SAH-pool authority owned by our DedicatedWorker.
 *
 * sqlite-wasm otherwise attempts to install its separate `opfs` and `opfs-wl` VFSes, each of
 * which launches an additional async proxy Worker. ToonSpectrum never uses those VFSes and Vite
 * cannot infer their package-internal runtime URL from the prebundled module. Disable only those
 * optional installers while leaving `opfs-sahpool` enabled for openStudioLocalDatabase().
 */
export async function loadStudioLocalDatabaseWorkerSqlite(
  options: StudioLocalDatabaseWorkerSqliteLoaderOptions = {},
): Promise<StudioSqliteApiHandle> {
  const globalObject = options.globalObject ?? globalThis as StudioSqliteApiConfigGlobal;
  if (Object.hasOwn(globalObject, "sqlite3ApiConfig")) {
    throw new Error("sqlite3ApiConfig is already owned by another initializer in this Worker");
  }
  const config = Object.freeze({
    disable: Object.freeze({
      vfs: Object.freeze({
        opfs: true,
        "opfs-vfs": true,
        "opfs-wl": true,
      }),
    }),
    wasmfsOpfsDir: false,
  });
  globalObject.sqlite3ApiConfig = config;
  try {
    const module = await (options.loadModule ?? (async () => {
      const loaded = await import("@sqlite.org/sqlite-wasm");
      return loaded as unknown as StudioSqliteWasmModule;
    }))();
    return await module.default();
  } finally {
    // The upstream bootstrap normally deletes this itself. Also clean it on an early load failure.
    if (globalObject.sqlite3ApiConfig === config) delete globalObject.sqlite3ApiConfig;
  }
}
