import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createStudioAssetLibrarySqliteOpfsRepository,
  parseStudioAssetManifest,
  serializeStudioAssetManifest,
  STUDIO_ASSET_LIBRARY_CAS_OWNER,
  STUDIO_ASSET_LIBRARY_LIMITS,
  STUDIO_ASSET_LIBRARY_SQLITE_MANIFEST_KEY,
  STUDIO_ASSET_LIBRARY_SQLITE_NAMESPACE,
  StudioAssetLibraryRepositoryError,
  type StudioAssetManifestEntry,
} from "./studio-asset-library-sqlite-opfs-repository";
import { openStudioLocalDatabase } from "./studio-local-database";
import { StudioLocalDatabaseCommitOutcomeUnknownError } from "./studio-local-database-commit-outcome";
import { createStudioOpfsAssetStore } from "./studio-opfs-asset-store";
import { createStudioOpfsMemoryFileSystem } from "./studio-opfs-filesystem";

import type {
  StudioLocalDatabase,
  StudioSqliteApiHandle,
} from "./studio-local-database";
import type { StudioOpfsAssetStore } from "./studio-opfs-asset-store";
import type { StudioOpfsMemoryFileSystem } from "./studio-opfs-filesystem";

let sqlite3: StudioSqliteApiHandle;
const opened: StudioLocalDatabase[] = [];

beforeAll(async () => {
  const module = await import("@sqlite.org/sqlite-wasm");
  sqlite3 = (await module.default()) as unknown as StudioSqliteApiHandle;
});

afterAll(async () => {
  for (const database of opened) await database.close();
});

async function openMemoryDatabase(
  memoryFilename = `asset-library-${crypto.randomUUID()}.sqlite3`,
  tracked = true,
): Promise<StudioLocalDatabase> {
  const database = await openStudioLocalDatabase({
    vfs: "memory",
    memoryFilename,
    loadSqlite: () => Promise.resolve(sqlite3),
  });
  if (tracked) opened.push(database);
  return database;
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function dataUrl(value: Uint8Array | string, mime = "image/png"): string {
  const payload = typeof value === "string" ? bytes(value) : value;
  let binary = "";
  for (const byte of payload) binary += String.fromCharCode(byte);
  return `data:${mime};base64,${btoa(binary)}`;
}

function saveInput(index: number, overrides: Record<string, unknown> = {}) {
  return {
    name: `창작 에셋 ${index}.png`,
    dataUrl: dataUrl(`payload-${index}`),
    width: 64 + index,
    height: 32 + index,
    kind: index % 2 === 0 ? "ai" : undefined,
    ...overrides,
  };
}

interface Fixture {
  readonly database: StudioLocalDatabase;
  readonly fs: StudioOpfsMemoryFileSystem;
  readonly store: StudioOpfsAssetStore;
  readonly repository: ReturnType<typeof createStudioAssetLibrarySqliteOpfsRepository>;
}

async function fixture(options: {
  readonly database?: StudioLocalDatabase;
  readonly fs?: StudioOpfsMemoryFileSystem;
  readonly store?: StudioOpfsAssetStore;
  readonly memoryFilename?: string;
  readonly createId?: () => string;
} = {}): Promise<Fixture> {
  const database = options.database ?? await openMemoryDatabase(options.memoryFilename);
  const fs = options.fs ?? createStudioOpfsMemoryFileSystem();
  const store = options.store ?? createStudioOpfsAssetStore({ fs, graceMs: 0 });
  let sequence = 0;
  const repository = createStudioAssetLibrarySqliteOpfsRepository({
    acquireDatabase: async () => database,
    acquireAssetStore: async () => store,
    runExclusive: (task) => task(),
    now: () => 1_800_000_000_000 + sequence,
    createId: options.createId ?? (() => `asset-${String(sequence++).padStart(4, "0")}`),
  });
  return { database, fs, store, repository };
}

function proxyDatabase(
  database: StudioLocalDatabase,
  override: Partial<Pick<StudioLocalDatabase, "kvGet" | "kvSet">>,
): StudioLocalDatabase {
  return new Proxy(database, {
    get(target, property) {
      const replacement = override[property as keyof typeof override];
      if (replacement) return replacement;
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("Studio asset SQLite manifest + OPFS CAS authority", () => {
  it("stores only canonical metadata in SQLite and round-trips rights plus verified bytes", async () => {
    const { database, repository, store } = await fixture();
    const saved = await repository.save(saveInput(1, {
      rights: {
        sourceKind: "imported",
        sourceId: "artist-pack-1",
        licenseId: "cc-by-4.0",
        licenseLabel: "CC BY 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
        attributionRequired: true,
        attributionText: "작가 한 · 원본",
        rightsConfirmed: true,
      },
    }));

    const raw = await database.kvGet(
      STUDIO_ASSET_LIBRARY_SQLITE_NAMESPACE,
      STUDIO_ASSET_LIBRARY_SQLITE_MANIFEST_KEY,
    );
    expect(raw).not.toContain("data:");
    expect(raw).not.toContain("base64");
    expect(raw).not.toContain("payload-1");
    expect(parseStudioAssetManifest(raw).entries[0]).toMatchObject({
      id: saved.id,
      contentHash: saved.contentHash,
      byteSize: bytes("payload-1").byteLength,
      mimeType: "image/png",
      rights: { licenseId: "cc-by-4.0", rightsConfirmed: true },
    });
    expect(await store.ownerRefs(STUDIO_ASSET_LIBRARY_CAS_OWNER)).toEqual([saved.contentHash]);
    await expect(repository.list()).resolves.toEqual([saved]);
  });

  it("offers a pure list snapshot that never reconciles owner refs or sweeps CAS", async () => {
    const database = await openMemoryDatabase();
    const fs = createStudioOpfsMemoryFileSystem();
    const baseStore = createStudioOpfsAssetStore({ fs, graceMs: 0 });
    const setOwnerRefs = vi.spyOn(baseStore, "setOwnerRefs");
    const sweep = vi.spyOn(baseStore, "sweep");
    const { repository } = await fixture({ database, fs, store: baseStore });
    const saved = await repository.save(saveInput(104));
    setOwnerRefs.mockClear();
    sweep.mockClear();

    await expect(repository.listReadOnly()).resolves.toEqual([saved]);
    expect(setOwnerRefs).not.toHaveBeenCalled();
    expect(sweep).not.toHaveBeenCalled();
  });

  it("compare-deletes only an exact reference-import id + content hash", async () => {
    const { repository } = await fixture();
    const saved = await repository.save(saveInput(101));
    await expect(repository.deleteIfIdentityMatches(
      saved.id,
      `sha256:${"f".repeat(64)}`,
    )).resolves.toBe(false);
    await expect(repository.list()).resolves.toEqual([saved]);
    await expect(repository.deleteIfIdentityMatches(saved.id, saved.contentHash))
      .resolves.toBe(true);
    await expect(repository.list()).resolves.toEqual([]);
    await expect(repository.deleteIfIdentityMatches(saved.id, saved.contentHash))
      .resolves.toBe(false);
  });

  it("fails a generated-id collision instead of overwriting a row eligible for compensation", async () => {
    const { repository } = await fixture({ createId: () => "fixed-import-id" });
    const original = await repository.save(saveInput(102));
    await expect(repository.save(saveInput(103))).rejects.toMatchObject({ code: "invalid" });
    await expect(repository.list()).resolves.toEqual([original]);
  });

  it("persists through a real sqlite-wasm close/reopen and a new CAS store instance", async () => {
    const filename = `asset-reopen-${crypto.randomUUID()}.sqlite3`;
    const fs = createStudioOpfsMemoryFileSystem();
    const firstDatabase = await openMemoryDatabase(filename, false);
    const first = await fixture({ database: firstDatabase, fs });
    const saved = await first.repository.save(saveInput(2));
    await firstDatabase.close();

    const reopenedDatabase = await openMemoryDatabase(filename);
    const reopenedStore = createStudioOpfsAssetStore({ fs, graceMs: 0 });
    const reopened = await fixture({
      database: reopenedDatabase,
      fs,
      store: reopenedStore,
      createId: () => "unused-id",
    });
    await expect(reopened.repository.list()).resolves.toEqual([saved]);
  });

  it("rejects a same-length CAS hash tamper instead of returning partial content", async () => {
    const { fs, repository, store } = await fixture();
    const saved = await repository.save(saveInput(3));
    const stat = await store.stat(saved.contentHash);
    expect(stat).not.toBeNull();
    await fs.write(stat!.path, bytes("X".repeat(bytes("payload-3").byteLength)));

    await expect(repository.list()).rejects.toMatchObject({ code: "corrupt" });
  });

  it("rejects a missing blob and preserves the manifest for recovery", async () => {
    const { database, repository, store } = await fixture();
    const saved = await repository.save(saveInput(4));
    const before = await database.kvGet(
      STUDIO_ASSET_LIBRARY_SQLITE_NAMESPACE,
      STUDIO_ASSET_LIBRARY_SQLITE_MANIFEST_KEY,
    );
    await store.delete(saved.contentHash);

    await expect(repository.list()).rejects.toMatchObject({ code: "corrupt" });
    expect(await database.kvGet(
      STUDIO_ASSET_LIBRARY_SQLITE_NAMESPACE,
      STUDIO_ASSET_LIBRARY_SQLITE_MANIFEST_KEY,
    )).toBe(before);
  });

  it("rejects torn, noncanonical, unknown-field, and ledger-mismatched manifests", async () => {
    const { database, repository } = await fixture();
    for (const raw of [
      '{"version":1,"totalBytes":',
      '{ "version": 1, "totalBytes": 0, "entries": [] }',
      '{"version":1,"totalBytes":0,"entries":[],"future":true}',
      '{"version":1,"totalBytes":1,"entries":[]}',
    ]) {
      await database.kvSet(
        STUDIO_ASSET_LIBRARY_SQLITE_NAMESPACE,
        STUDIO_ASSET_LIBRARY_SQLITE_MANIFEST_KEY,
        raw,
      );
      await expect(repository.list()).rejects.toMatchObject({ code: "corrupt" });
    }
  });

  it("serializes overlapping mutations in invocation order without losing entries", async () => {
    const { repository } = await fixture();
    const [first, second, third] = await Promise.all([
      repository.save(saveInput(5)),
      repository.save(saveInput(6)),
      repository.save(saveInput(7)),
    ]);
    const listed = await repository.list();

    expect(listed.map(({ id }) => id)).toEqual([third.id, second.id, first.id]);
    expect(new Set(listed.map(({ contentHash }) => contentHash)).size).toBe(3);
  });

  it("commits the manifest after blob verification and pre-commit owner protection", async () => {
    const events: string[] = [];
    const database = await openMemoryDatabase();
    const fs = createStudioOpfsMemoryFileSystem();
    const baseStore = createStudioOpfsAssetStore({ fs, graceMs: 0 });
    const store = new Proxy(baseStore, {
      get(target, property) {
        const value = Reflect.get(target, property, target) as unknown;
        if (typeof value !== "function") return value;
        return async (...args: unknown[]) => {
          events.push(`cas:${String(property)}`);
          return (value as (...callArgs: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    const tracedDatabase = proxyDatabase(database, {
      kvSet: async (...args) => {
        events.push("sqlite:manifest");
        return database.kvSet(...args);
      },
    });
    const { repository } = await fixture({ database: tracedDatabase, fs, store });
    await repository.save(saveInput(8));

    expect(events.indexOf("cas:put")).toBeLessThan(events.indexOf("sqlite:manifest"));
    expect(events.indexOf("cas:get")).toBeLessThan(events.indexOf("sqlite:manifest"));
    expect(events.indexOf("cas:setOwnerRefs")).toBeLessThan(events.indexOf("sqlite:manifest"));
  });

  it("keeps the previous manifest and rolls owner refs back after a forced SQLite commit fault", async () => {
    const database = await openMemoryDatabase();
    const fs = createStudioOpfsMemoryFileSystem();
    const store = createStudioOpfsAssetStore({ fs, graceMs: 0 });
    const stable = await fixture({ database, fs, store });
    const first = await stable.repository.save(saveInput(9));
    const before = await database.kvGet(
      STUDIO_ASSET_LIBRARY_SQLITE_NAMESPACE,
      STUDIO_ASSET_LIBRARY_SQLITE_MANIFEST_KEY,
    );
    const failing = proxyDatabase(database, {
      kvSet: async (namespace, key, value) => {
        if (namespace === STUDIO_ASSET_LIBRARY_SQLITE_NAMESPACE) throw new Error("SQLITE_FULL");
        return database.kvSet(namespace, key, value);
      },
    });
    const failed = await fixture({
      database: failing,
      fs,
      store,
      createId: () => "asset-failed-commit",
    });

    await expect(failed.repository.save(saveInput(10))).rejects.toMatchObject({
      code: "quota-exceeded",
    });
    expect(await database.kvGet(
      STUDIO_ASSET_LIBRARY_SQLITE_NAMESPACE,
      STUDIO_ASSET_LIBRARY_SQLITE_MANIFEST_KEY,
    )).toBe(before);
    expect(await store.ownerRefs(STUDIO_ASSET_LIBRARY_CAS_OWNER)).toEqual([first.contentHash]);
    expect((await stable.repository.list()).map(({ id }) => id)).toEqual([first.id]);
  });

  it("reconciles a non-committed unknown response to the exact old manifest", async () => {
    const database = await openMemoryDatabase();
    const fs = createStudioOpfsMemoryFileSystem();
    const store = createStudioOpfsAssetStore({ fs, graceMs: 0 });
    const stable = await fixture({ database, fs, store, createId: () => "stable-asset" });
    const first = await stable.repository.save(saveInput(22));
    const uncertain = proxyDatabase(database, {
      kvSet: async (namespace, key, value) => {
        if (namespace === STUDIO_ASSET_LIBRARY_SQLITE_NAMESPACE) {
          throw new StudioLocalDatabaseCommitOutcomeUnknownError(
            "kvSet",
            new Error("response-channel-lost"),
          );
        }
        return database.kvSet(namespace, key, value);
      },
    });
    const candidate = await fixture({
      database: uncertain,
      fs,
      store,
      createId: () => "candidate-asset",
    });

    await expect(candidate.repository.save(saveInput(23)))
      .rejects.toMatchObject({ code: "unavailable" });

    expect(await store.ownerRefs(STUDIO_ASSET_LIBRARY_CAS_OWNER)).toEqual([first.contentHash]);
    expect((await stable.repository.list()).map(({ id }) => id)).toEqual([first.id]);
  });

  it("returns an exact creation receipt when the commit succeeded but its response was lost", async () => {
    const database = await openMemoryDatabase();
    const fs = createStudioOpfsMemoryFileSystem();
    const store = createStudioOpfsAssetStore({ fs, graceMs: 0 });
    const stable = await fixture({ database, fs, store, createId: () => "stable-asset" });
    const first = await stable.repository.save(saveInput(24));
    const committedUnknown = proxyDatabase(database, {
      kvSet: async (namespace, key, value) => {
        await database.kvSet(namespace, key, value);
        if (namespace === STUDIO_ASSET_LIBRARY_SQLITE_NAMESPACE) {
          throw new StudioLocalDatabaseCommitOutcomeUnknownError(
            "kvSet",
            new Error("response-channel-lost-after-commit"),
          );
        }
      },
    });
    const candidate = await fixture({
      database: committedUnknown,
      fs,
      store,
      createId: () => "candidate-asset",
    });

    const saved = await candidate.repository.save(saveInput(25));
    expect(saved.id).toBe("candidate-asset");
    expect((await stable.repository.list()).map(({ id }) => id)).toEqual([
      saved.id,
      first.id,
    ]);
    expect(await store.ownerRefs(STUDIO_ASSET_LIBRARY_CAS_OWNER)).toEqual([
      first.contentHash,
      saved.contentHash,
    ].toSorted());
  });

  it("returns the candidate row after a generic SQLite error surfaced post-autocommit", async () => {
    const database = await openMemoryDatabase();
    const fs = createStudioOpfsMemoryFileSystem();
    const store = createStudioOpfsAssetStore({ fs, graceMs: 0 });
    const genericPostCommit = proxyDatabase(database, {
      kvSet: async (namespace, key, value) => {
        await database.kvSet(namespace, key, value);
        if (namespace === STUDIO_ASSET_LIBRARY_SQLITE_NAMESPACE) {
          throw new Error("SQLITE_IOERR_AFTER_AUTOCOMMIT");
        }
      },
    });
    const candidate = await fixture({
      database: genericPostCommit,
      fs,
      store,
      createId: () => "generic-post-commit-asset",
    });

    const saved = await candidate.repository.save(saveInput(28));
    expect(saved.id).toBe("generic-post-commit-asset");
    await expect(candidate.repository.deleteIfIdentityMatches(saved.id, saved.contentHash))
      .resolves.toBe(true);
  });

  it("fails closed with the old/candidate CAS union when unknown reconciliation sees a third manifest", async () => {
    const database = await openMemoryDatabase();
    const fs = createStudioOpfsMemoryFileSystem();
    const store = createStudioOpfsAssetStore({ fs, graceMs: 0 });
    const stable = await fixture({ database, fs, store, createId: () => "stable-asset" });
    const first = await stable.repository.save(saveInput(26));
    const thirdState = proxyDatabase(database, {
      kvSet: async (namespace, key, value) => {
        if (namespace === STUDIO_ASSET_LIBRARY_SQLITE_NAMESPACE) {
          const candidate = parseStudioAssetManifest(value);
          await database.kvSet(namespace, key, serializeStudioAssetManifest(
            candidate.entries.map((entry, index) => index === 0
              ? { ...entry, name: "third-state-name" }
              : entry),
          ));
          throw new StudioLocalDatabaseCommitOutcomeUnknownError(
            "kvSet",
            new Error("response-channel-lost-with-third-state"),
          );
        }
        return database.kvSet(namespace, key, value);
      },
    });
    const candidate = await fixture({
      database: thirdState,
      fs,
      store,
      createId: () => "candidate-asset",
    });

    await expect(candidate.repository.save(saveInput(27))).rejects.toMatchObject({
      code: "unavailable",
    });
    const ownerRefs = await store.ownerRefs(STUDIO_ASSET_LIBRARY_CAS_OWNER);
    expect(ownerRefs).toContain(first.contentHash);
    expect(ownerRefs).toHaveLength(2);
    expect((await store.sweep({ graceMs: 0 })).removed).toHaveLength(0);
  });

  it("fails before manifest publication when OPFS quota cannot admit the blob", async () => {
    const database = await openMemoryDatabase();
    const fs = createStudioOpfsMemoryFileSystem();
    const store = createStudioOpfsAssetStore({
      fs,
      graceMs: 0,
      estimator: { estimate: async () => ({ usage: 99_999_999, quota: 100_000_000 }) },
    });
    const { repository } = await fixture({ database, fs, store });

    await expect(repository.save(saveInput(11))).rejects.toMatchObject({
      code: "quota-exceeded",
    });
    expect(await database.kvGet(
      STUDIO_ASSET_LIBRARY_SQLITE_NAMESPACE,
      STUDIO_ASSET_LIBRARY_SQLITE_MANIFEST_KEY,
    )).toBeNull();
  });

  it("rejects a caller-provided content hash that disagrees with the actual bytes", async () => {
    const { database, repository } = await fixture();
    await expect(repository.save(saveInput(12, {
      contentHash: `sha256:${"f".repeat(64)}`,
    }))).rejects.toMatchObject({ code: "invalid" });
    expect(await database.kvGet(
      STUDIO_ASSET_LIBRARY_SQLITE_NAMESPACE,
      STUDIO_ASSET_LIBRARY_SQLITE_MANIFEST_KEY,
    )).toBeNull();
  });

  it("rejects deduplicated bytes declared with conflicting MIME instead of rewriting metadata", async () => {
    const { repository } = await fixture();
    await repository.save(saveInput(13));
    await expect(repository.save(saveInput(14, {
      dataUrl: dataUrl("payload-13", "application/octet-stream"),
    }))).rejects.toMatchObject({ code: "corrupt" });
    expect(await repository.list()).toHaveLength(1);
  });

  it("supports deterministic bounded manifest-side search and keyset pagination", async () => {
    const { repository } = await fixture();
    await repository.save(saveInput(15, { name: "하늘 레퍼런스.png" }));
    await repository.save(saveInput(16, { name: "바다 레퍼런스.png" }));
    await repository.save(saveInput(17, { name: "하늘 톤.png" }));

    const first = await repository.query({ search: "하늘", limit: 1 });
    const second = await repository.query({ search: "하늘", limit: 1, after: first.nextCursor });
    expect(first.totalCount).toBe(2);
    expect(first.hasMore).toBe(true);
    expect(second.hasMore).toBe(false);
    expect([...first.assets, ...second.assets].map(({ name }) => name)).toEqual([
      "하늘 톤",
      "하늘 레퍼런스",
    ]);
    await expect(repository.query({ limit: STUDIO_ASSET_LIBRARY_LIMITS.queryLimit + 1 }))
      .rejects.toMatchObject({ code: "invalid" });
  });

  it("does bounded content-identity lookup without hydrating unrelated blobs", async () => {
    const { fs, repository } = await fixture();
    const first = await repository.save(saveInput(18));
    await repository.save(saveInput(19));
    fs.restart();

    const found = await repository.findByContentIdentities([{
      contentHash: first.contentHash,
      assetId: first.id,
    }]);
    expect(found.get(first.contentHash)).toEqual([first]);
    // index.json + one blob; the unrelated payload is not hydrated.
    expect(fs.counts.read).toBeLessThanOrEqual(2);
  });

  it("removes unowned CAS orphans while retaining every manifest hash", async () => {
    const { repository, store } = await fixture();
    const saved = await repository.save(saveInput(20));
    const orphan = await store.put(bytes("orphan"), { mime: "application/octet-stream" });
    expect(await store.has(orphan.ref.hash)).toBe(true);

    await expect(repository.cleanupOrphans()).resolves.toBe(1);
    expect(await store.has(orphan.ref.hash)).toBe(false);
    expect(await store.has(saved.contentHash)).toBe(true);
  });

  it("never probes ambient IndexedDB on the SQLite/OPFS path", async () => {
    const open = vi.fn(() => {
      throw new Error("legacy DB must not open");
    });
    vi.stubGlobal("indexedDB", { open });
    const { repository } = await fixture();
    await repository.save(saveInput(21));
    await repository.list();

    expect(open).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("enforces count, byte, rights, and canonical ordering bounds before SQLite publication", () => {
    const base: StudioAssetManifestEntry = {
      id: "asset-base",
      name: "기본",
      contentHash: `sha256:${"a".repeat(64)}`,
      byteSize: 1,
      mimeType: "image/png",
      width: 1,
      height: 1,
      createdAt: 1,
      kind: null,
      rights: {
        sourceKind: "local-upload",
        sourceId: null,
        licenseId: "unknown",
        licenseLabel: "",
        licenseUrl: null,
        attributionRequired: null,
        attributionText: "",
        rightsConfirmed: false,
      },
    };
    const tooMany = Array.from({ length: STUDIO_ASSET_LIBRARY_LIMITS.assets + 1 }, (_, index) => ({
      ...base,
      id: `asset-${String(index).padStart(4, "0")}`,
      createdAt: index,
    }));
    expect(() => serializeStudioAssetManifest(tooMany)).toThrow(StudioAssetLibraryRepositoryError);
    expect(() => serializeStudioAssetManifest([{
      ...base,
      byteSize: STUDIO_ASSET_LIBRARY_LIMITS.individualBytes + 1,
    }])).toThrow(StudioAssetLibraryRepositoryError);
    expect(() => serializeStudioAssetManifest([{
      ...base,
      rights: { ...base.rights, future: true } as never,
    }])).toThrow(StudioAssetLibraryRepositoryError);
  });
});
