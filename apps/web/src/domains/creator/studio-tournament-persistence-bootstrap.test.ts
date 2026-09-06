import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { readStudioCuttoonEditorSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";
import {
  createStudioTournamentPersistenceBootstrap,
  type StudioTournamentPersistenceModule,
} from "./studio-tournament-persistence-bootstrap";

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(cause: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("Studio tournament persistence bootstrap", () => {
  it("installs SQLite before constructing and hydrating the shared runtime", async () => {
    const order: string[] = [];
    const persistence: StudioTournamentPersistenceModule = {
      installStudioTournamentSqlitePersistence: () => order.push("install"),
    };
    const bootstrap = createStudioTournamentPersistenceBootstrap({
      loadPersistence: async () => {
        order.push("load");
        return persistence;
      },
      getRuntime: () => {
        order.push("get-runtime");
        return {
          hydrate: async () => {
            order.push("hydrate");
            return true;
          },
          persistenceStatus: () => ({ mode: "sqlite-opfs", durable: true, reason: null }),
        } as never;
      },
      warn: vi.fn(),
    });

    await expect(bootstrap.boot()).resolves.toBe(true);
    expect(order).toEqual(["load", "install", "get-runtime", "hydrate"]);
  });

  it("does not construct a runtime while the dynamic persistence module is loading", async () => {
    const moduleLoad = deferred<StudioTournamentPersistenceModule>();
    const getRuntime = vi.fn(() => ({
      hydrate: vi.fn(async () => true),
      persistenceStatus: () => ({ mode: "sqlite-opfs", durable: true, reason: null }),
    }) as never);
    const bootstrap = createStudioTournamentPersistenceBootstrap({
      loadPersistence: () => moduleLoad.promise,
      getRuntime,
      warn: vi.fn(),
    });

    const boot = bootstrap.boot();
    expect(getRuntime).not.toHaveBeenCalled();
    moduleLoad.resolve({ installStudioTournamentSqlitePersistence: vi.fn() });
    await expect(boot).resolves.toBe(true);
    expect(getRuntime).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent boot calls and hydrates once", async () => {
    const hydrate = vi.fn(async () => true);
    const loadPersistence = vi.fn(async () => ({
      installStudioTournamentSqlitePersistence: vi.fn(),
    }));
    const bootstrap = createStudioTournamentPersistenceBootstrap({
      loadPersistence,
      getRuntime: () => ({
        hydrate,
        persistenceStatus: () => ({ mode: "sqlite-opfs", durable: true, reason: null }),
      }) as never,
      warn: vi.fn(),
    });

    const first = bootstrap.boot();
    const second = bootstrap.boot();
    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(loadPersistence).toHaveBeenCalledTimes(1);
    expect(hydrate).toHaveBeenCalledTimes(1);
  });

  it("contains a failed lazy load and allows a later retry", async () => {
    const warn = vi.fn();
    const loadPersistence = vi
      .fn<() => Promise<StudioTournamentPersistenceModule>>()
      .mockRejectedValueOnce(new Error("chunk unavailable"))
      .mockResolvedValueOnce({ installStudioTournamentSqlitePersistence: vi.fn() });
    const bootstrap = createStudioTournamentPersistenceBootstrap({
      loadPersistence,
      getRuntime: () => ({
        hydrate: vi.fn(async () => false),
        persistenceStatus: () => ({ mode: "sqlite-opfs", durable: true, reason: null }),
      }) as never,
      warn,
    });

    await expect(bootstrap.boot()).resolves.toBe(false);
    await Promise.resolve();
    await expect(bootstrap.boot()).resolves.toBe(true);
    expect(loadPersistence).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("returns false and reports explicit memory-only status when SQLite cannot open", async () => {
    const warn = vi.fn();
    const bootstrap = createStudioTournamentPersistenceBootstrap({
      loadPersistence: async () => ({
        installStudioTournamentSqlitePersistence: vi.fn(),
      }),
      getRuntime: () => ({
        hydrate: vi.fn(async () => false),
        persistenceStatus: () => ({
          mode: "memory-only",
          durable: false,
          reason: "database open failed: OPFS unavailable",
        }),
      }) as never,
      warn,
    });

    await expect(bootstrap.boot()).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(
      "studio tournament is running memory-only; SQLite/OPFS persistence is unavailable",
      expect.objectContaining({ mode: "memory-only", durable: false }),
    );
  });

  it("does not warn when another page already owns the OPFS SQLite lock", async () => {
    const warn = vi.fn();
    const bootstrap = createStudioTournamentPersistenceBootstrap({
      loadPersistence: async () => ({
        installStudioTournamentSqlitePersistence: vi.fn(),
      }),
      getRuntime: () => ({
        hydrate: vi.fn(async () => false),
        persistenceStatus: () => ({
          mode: "memory-only",
          durable: false,
          reason:
            "database open failed: SQLite/OPFS unavailable: studio local sqlite unavailable: DedicatedWorker ownership lock failed: Studio OPFS SQLite is already owned by another page",
        }),
      }) as never,
      warn,
    });

    await expect(bootstrap.boot()).resolves.toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps SQLite persistence outside the StudioPage static graph", () => {
    const page = readStudioCuttoonEditorSource();
    const bootstrap = readFileSync(
      new URL("./studio-tournament-persistence-bootstrap.ts", import.meta.url),
      "utf8",
    );

    expect(page).not.toMatch(
      /^import .*studio-tournament-sqlite-persistence/mu,
    );
    // The boot call moved into its runtime hook when the routes were layered, so the specifier is
    // now "../../" rather than "./". The boundary is which module the surface imports, not how
    // deep the importer sits.
    expect(page).toMatch(/from\s+["'][^"']*studio-tournament-persistence-bootstrap["']/u);
    expect(bootstrap).toContain(
      'import("./studio-tournament-sqlite-persistence")',
    );
    expect(bootstrap).not.toMatch(
      /^import .*studio-tournament-sqlite-persistence/mu,
    );
    expect(page).not.toMatch(
      /from\s+["']\.\/(?:brush\/)?studio-brush-library-sqlite-repository["']/u,
    );
    expect(page).toMatch(
      /import\(\s*["']\.\/(?:brush\/)?studio-brush-library-sqlite-repository["']\s*\)/u,
    );
  });

  it("keeps search indexing out of the active-tool and pen-down startup paths", () => {
    const page = readStudioCuttoonEditorSource();

    expect(page).toContain(
      'from "./studio-active-tool-command"',
    );
    expect(page).not.toContain(
      'from "./studio-current-tool-help"',
    );
    expect(page).not.toContain("peekBootedStudioTournamentRuntime()");
    expect(page).not.toContain("getStudioTournamentRuntime()");
    expect(page).not.toContain("resolveStudioStrokeRoutePointerDownGate");
    expect(page).toContain("const livingInkAdmitted = livingInkSelected");
  });
});
