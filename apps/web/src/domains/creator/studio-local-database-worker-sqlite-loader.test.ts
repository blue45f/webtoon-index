import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { loadStudioLocalDatabaseWorkerSqlite } from "./studio-local-database-worker-sqlite-loader";

import type { StudioSqliteApiHandle } from "./studio-local-database";

describe("Studio local database Worker sqlite-wasm loader", () => {
  it("disables only unused proxy VFS installers while preserving SAH-pool authority", async () => {
    const globalObject: { sqlite3ApiConfig?: unknown } = {};
    const api = {} as StudioSqliteApiHandle;
    const initializer = vi.fn(async () => {
      expect(globalObject.sqlite3ApiConfig).toEqual({
        disable: {
          vfs: {
            opfs: true,
            "opfs-vfs": true,
            "opfs-wl": true,
          },
        },
        wasmfsOpfsDir: false,
      });
      expect(globalObject.sqlite3ApiConfig).not.toMatchObject({
        disable: { vfs: { "opfs-sahpool": true } },
      });
      return api;
    });

    await expect(loadStudioLocalDatabaseWorkerSqlite({
      globalObject,
      loadModule: async () => ({ default: initializer }),
    })).resolves.toBe(api);

    expect(initializer).toHaveBeenCalledOnce();
    expect(globalObject).not.toHaveProperty("sqlite3ApiConfig");
  });

  it("clears bootstrap ownership after initialization failure", async () => {
    const globalObject: { sqlite3ApiConfig?: unknown } = {};
    await expect(loadStudioLocalDatabaseWorkerSqlite({
      globalObject,
      loadModule: async () => ({
        default: async () => {
          throw new Error("wasm initialization failed");
        },
      }),
    })).rejects.toThrow("wasm initialization failed");
    expect(globalObject).not.toHaveProperty("sqlite3ApiConfig");
  });

  it("fails closed instead of overwriting another initializer's bootstrap config", async () => {
    const existing = { owner: "other-sqlite-initializer" };
    const globalObject: { sqlite3ApiConfig?: unknown } = { sqlite3ApiConfig: existing };
    const loadModule = vi.fn();

    await expect(loadStudioLocalDatabaseWorkerSqlite({ globalObject, loadModule }))
      .rejects.toThrow("already owned");
    expect(globalObject.sqlite3ApiConfig).toBe(existing);
    expect(loadModule).not.toHaveBeenCalled();
  });

  it("keeps SQLite and every unused proxy VFS inside the product DedicatedWorker", () => {
    const workerSource = readFileSync(
      new URL("./studio-local-database.worker.ts", import.meta.url),
      "utf8"
    );
    const loaderSource = readFileSync(
      new URL("./studio-local-database-worker-sqlite-loader.ts", import.meta.url),
      "utf8"
    );
    const runtimeSource = readFileSync(
      new URL("./studio-local-database-runtime.ts", import.meta.url),
      "utf8"
    );

    expect(workerSource).toContain("loadStudioLocalDatabaseWorkerSqlite");
    expect(workerSource).toContain('vfs: "opfs"');
    expect(workerSource).not.toContain('vfs: "memory"');
    expect(loaderSource).toContain("opfs: true");
    expect(loaderSource).toContain('"opfs-vfs": true');
    expect(loaderSource).toContain('"opfs-wl": true');
    expect(loaderSource).toContain("wasmfsOpfsDir: false");
    expect(loaderSource).not.toContain('"opfs-sahpool": true');
    expect(runtimeSource).toContain("acquireStudioLocalDatabaseWorker");
    expect(runtimeSource).not.toContain("@sqlite.org/sqlite-wasm");
    expect(runtimeSource).not.toContain('vfs: "memory"');
    expect(runtimeSource).not.toContain("localStorage");
  });
});
