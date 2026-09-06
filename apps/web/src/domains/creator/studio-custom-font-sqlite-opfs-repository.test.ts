import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createStudioCustomFontSqliteOpfsRepository,
  parseStudioCustomFontManifest,
  serializeStudioCustomFontManifest,
  STUDIO_CUSTOM_FONT_CAS_OWNER,
  STUDIO_CUSTOM_FONT_MAX_COMPATIBILITY_ENTRIES,
  STUDIO_CUSTOM_FONT_MAX_PAGE_SIZE,
  STUDIO_CUSTOM_FONT_LIMITS,
  STUDIO_CUSTOM_FONT_SQLITE_MANIFEST_KEY,
  STUDIO_CUSTOM_FONT_SQLITE_NAMESPACE,
  type StudioCustomFontManifestEntry,
  type StudioCustomFontWithContentHash,
} from "./studio-custom-font-sqlite-opfs-repository";
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
  memoryFilename = `custom-font-${crypto.randomUUID()}.sqlite3`,
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

function fontBytes(seed: number, size = 96): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x00, 0x01, 0x00, 0x00]);
  for (let index = 4; index < size; index++) bytes[index] = (seed + index * 31) & 0xff;
  return bytes;
}

interface Fixture {
  readonly database: StudioLocalDatabase;
  readonly fs: StudioOpfsMemoryFileSystem;
  readonly store: StudioOpfsAssetStore;
  readonly repository: ReturnType<typeof createStudioCustomFontSqliteOpfsRepository>;
}

async function fixture(options: {
  readonly database?: StudioLocalDatabase;
  readonly fs?: StudioOpfsMemoryFileSystem;
  readonly store?: StudioOpfsAssetStore;
  readonly memoryFilename?: string;
  readonly createId?: () => string;
  readonly now?: () => number;
} = {}): Promise<Fixture> {
  const database = options.database ?? await openMemoryDatabase(options.memoryFilename);
  const fs = options.fs ?? createStudioOpfsMemoryFileSystem();
  const store = options.store ?? createStudioOpfsAssetStore({ fs, graceMs: 0 });
  let sequence = 0;
  const repository = createStudioCustomFontSqliteOpfsRepository({
    acquireDatabase: async () => database,
    acquireAssetStore: async () => store,
    runExclusive: (task) => task(),
    now: options.now ?? (() => 1_800_000_000_000 + sequence),
    createId: options.createId ?? (() => `font-${String(sequence++).padStart(4, "0")}`),
  });
  return { database, fs, store, repository };
}

async function listAllFonts(
  repository: ReturnType<typeof createStudioCustomFontSqliteOpfsRepository>,
  pageSize = STUDIO_CUSTOM_FONT_MAX_PAGE_SIZE,
) {
  const fonts: StudioCustomFontWithContentHash[] = [];
  let cursor: string | null = null;
  do {
    const page = await repository.page({ pageSize, cursor });
    fonts.push(...page.fonts);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return fonts;
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

function manifestEntry(index: number, overrides: Partial<StudioCustomFontManifestEntry> = {}) {
  const format = "ttf" as const;
  return {
    id: `font-${String(index).padStart(4, "0")}`,
    family: `CJK Family ${index}`,
    fileName: `CJK-Family-${index}.ttf`,
    format,
    mimeType: "font/ttf",
    contentHash: `sha256:${"a".repeat(64)}` as const,
    byteLength: 1,
    createdAt: 1_800_000_000_000 + index,
    ...overrides,
  };
}

describe("custom-font SQLite canonical manifest plus OPFS SHA-256 CAS", () => {
  it("keeps only canonical metadata in SQLite and returns verified original bytes", async () => {
    const { database, repository, store } = await fixture();
    const original = fontBytes(7, 4_096);
    const saved = await repository.save({ fileName: "Noto Sans CJK KR.ttf", bytes: original });

    const raw = await database.kvGet(
      STUDIO_CUSTOM_FONT_SQLITE_NAMESPACE,
      STUDIO_CUSTOM_FONT_SQLITE_MANIFEST_KEY,
    );
    expect(raw).not.toContain("data:");
    expect(raw).not.toContain("base64");
    expect(raw).not.toContain("verifiedBytes");
    expect(parseStudioCustomFontManifest(raw).entries[0]).toMatchObject({
      id: saved.id,
      family: "Noto Sans CJK KR",
      contentHash: saved.contentHash,
      byteLength: original.byteLength,
      format: "ttf",
      mimeType: "font/ttf",
    });
    expect(await store.ownerRefs(STUDIO_CUSTOM_FONT_CAS_OWNER)).toEqual([saved.contentHash]);
    const listed = await listAllFonts(repository);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.dataUrl).toBeUndefined();
    expect(listed[0]?.verifiedBytes).toEqual(original);
  });

  it("persists through real sqlite-wasm close/reopen and a rebuilt OPFS store", async () => {
    const filename = `custom-font-reopen-${crypto.randomUUID()}.sqlite3`;
    const fs = createStudioOpfsMemoryFileSystem();
    const firstDatabase = await openMemoryDatabase(filename, false);
    const first = await fixture({ database: firstDatabase, fs, createId: () => "reopen-font" });
    const saved = await first.repository.save({ fileName: "본고딕.ttc", bytes: fontBytes(11) });
    await firstDatabase.close();

    const reopenedDatabase = await openMemoryDatabase(filename);
    const reopenedStore = createStudioOpfsAssetStore({ fs, graceMs: 0 });
    const reopened = await fixture({
      database: reopenedDatabase,
      fs,
      store: reopenedStore,
      createId: () => "unused-font",
    });
    const listed = await listAllFonts(reopened.repository);
    expect(listed.map(({ id, contentHash }) => ({ id, contentHash }))).toEqual([{
      id: saved.id,
      contentHash: saved.contentHash,
    }]);
    expect(listed[0]?.verifiedBytes).toEqual(fontBytes(11));
  });

  it("fails closed when a CAS blob is missing", async () => {
    const { database, repository, store } = await fixture();
    const saved = await repository.save({ fileName: "Missing.ttf", bytes: fontBytes(13) });
    const manifestBefore = await database.kvGet(
      STUDIO_CUSTOM_FONT_SQLITE_NAMESPACE,
      STUDIO_CUSTOM_FONT_SQLITE_MANIFEST_KEY,
    );
    await store.delete(saved.contentHash);

    await expect(repository.page({ pageSize: 16 })).rejects.toMatchObject({ code: "corrupt" });
    expect(await database.kvGet(
      STUDIO_CUSTOM_FONT_SQLITE_NAMESPACE,
      STUDIO_CUSTOM_FONT_SQLITE_MANIFEST_KEY,
    )).toBe(manifestBefore);
  });

  it("detects same-length blob tampering through verify:true rehash", async () => {
    const { fs, repository, store } = await fixture();
    const saved = await repository.save({ fileName: "Tampered.ttf", bytes: fontBytes(17) });
    const stat = await store.stat(saved.contentHash);
    expect(stat).not.toBeNull();
    const tampered = fontBytes(18);
    expect(tampered.byteLength).toBe(saved.byteLength);
    await fs.write(stat!.path, tampered);

    await expect(repository.page({ pageSize: 16 })).rejects.toMatchObject({ code: "corrupt" });
  });

  it("rejects torn, noncanonical, unknown-field, and forged-total manifests", async () => {
    const { database, repository } = await fixture();
    for (const raw of [
      '{"version":1,"totalBytes":',
      '{ "version": 1, "totalBytes": 0, "entries": [] }',
      '{"version":1,"totalBytes":0,"entries":[],"future":true}',
      '{"version":1,"totalBytes":1,"entries":[]}',
    ]) {
      await database.kvSet(
        STUDIO_CUSTOM_FONT_SQLITE_NAMESPACE,
        STUDIO_CUSTOM_FONT_SQLITE_MANIFEST_KEY,
        raw,
      );
      await expect(repository.page({ pageSize: 16 })).rejects.toMatchObject({ code: "corrupt" });
    }
  });

  it("rejects an extra entry field and a MIME/format mismatch", () => {
    const entry = manifestEntry(1);
    expect(() => serializeStudioCustomFontManifest([{ ...entry, future: true } as typeof entry]))
      .toThrow(/알 수 없는 필드/u);
    expect(() => serializeStudioCustomFontManifest([{ ...entry, mimeType: "font/woff2" }]))
      .toThrow(/MIME/u);
  });

  it("serializes overlapping saves in invocation order without losing entries", async () => {
    const { repository } = await fixture();
    const [first, second, third] = await Promise.all([
      repository.save({ fileName: "Family.ttf", bytes: fontBytes(21) }),
      repository.save({ fileName: "Family.ttf", bytes: fontBytes(22) }),
      repository.save({ fileName: "Family.ttf", bytes: fontBytes(23) }),
    ]);
    const listed = await listAllFonts(repository);

    expect(listed.map(({ id }) => id)).toEqual([first.id, second.id, third.id]);
    expect(listed.map(({ family }) => family).sort()).toEqual([
      "Family",
      "Family (2)",
      "Family (3)",
    ]);
    expect(new Set(listed.map(({ contentHash }) => contentHash)).size).toBe(3);
  });

  it("commits the SQLite manifest after blob put, verification, and owner protection", async () => {
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
    await repository.save({ fileName: "Ordered.ttf", bytes: fontBytes(25) });

    expect(events.indexOf("cas:put")).toBeLessThan(events.indexOf("sqlite:manifest"));
    expect(events.indexOf("cas:get")).toBeLessThan(events.indexOf("sqlite:manifest"));
    expect(events.indexOf("cas:setOwnerRefs")).toBeLessThan(events.indexOf("sqlite:manifest"));
  });

  it("rolls owner references back and preserves the previous manifest on SQLite failure", async () => {
    const database = await openMemoryDatabase();
    const fs = createStudioOpfsMemoryFileSystem();
    const store = createStudioOpfsAssetStore({ fs, graceMs: 0 });
    const stable = await fixture({ database, fs, store, createId: () => "stable-font" });
    const first = await stable.repository.save({ fileName: "Stable.ttf", bytes: fontBytes(27) });
    const manifestBefore = await database.kvGet(
      STUDIO_CUSTOM_FONT_SQLITE_NAMESPACE,
      STUDIO_CUSTOM_FONT_SQLITE_MANIFEST_KEY,
    );
    const failing = proxyDatabase(database, {
      kvSet: async (namespace, key, value) => {
        if (namespace === STUDIO_CUSTOM_FONT_SQLITE_NAMESPACE) throw new Error("SQLITE_FULL");
        return database.kvSet(namespace, key, value);
      },
    });
    const failed = await fixture({ database: failing, fs, store, createId: () => "failed-font" });

    await expect(failed.repository.save({ fileName: "Failed.ttf", bytes: fontBytes(29) }))
      .rejects.toMatchObject({ code: "quota-exceeded" });
    expect(await database.kvGet(
      STUDIO_CUSTOM_FONT_SQLITE_NAMESPACE,
      STUDIO_CUSTOM_FONT_SQLITE_MANIFEST_KEY,
    )).toBe(manifestBefore);
    expect(await store.ownerRefs(STUDIO_CUSTOM_FONT_CAS_OWNER)).toEqual([first.contentHash]);
    expect((await listAllFonts(stable.repository)).map(({ id }) => id)).toEqual([first.id]);
  });

  it("keeps old and candidate font blobs pinned when the commit response is lost", async () => {
    const database = await openMemoryDatabase();
    const fs = createStudioOpfsMemoryFileSystem();
    const store = createStudioOpfsAssetStore({ fs, graceMs: 0 });
    const stable = await fixture({ database, fs, store, createId: () => "stable-font" });
    const first = await stable.repository.save({ fileName: "Stable.ttf", bytes: fontBytes(35) });
    const uncertain = proxyDatabase(database, {
      kvSet: async (namespace, key, value) => {
        if (namespace === STUDIO_CUSTOM_FONT_SQLITE_NAMESPACE) {
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
      createId: () => "candidate-font",
    });

    await expect(candidate.repository.save({
      fileName: "Candidate.ttf",
      bytes: fontBytes(37),
    })).rejects.toMatchObject({ code: "unavailable" });

    const ownerRefs = await store.ownerRefs(STUDIO_CUSTOM_FONT_CAS_OWNER);
    expect(ownerRefs).toContain(first.contentHash);
    expect(ownerRefs).toHaveLength(2);
    expect((await store.sweep({ graceMs: 0 })).removed).toHaveLength(0);
  });

  it("retains per-file and 2 GiB logical limits without a product-total count limit", async () => {
    expect(STUDIO_CUSTOM_FONT_LIMITS.individualBytes).toBe(128 * 1024 * 1024);
    expect(STUDIO_CUSTOM_FONT_LIMITS.logicalBytes).toBe(2 * 1024 * 1024 * 1024);
    expect(() => serializeStudioCustomFontManifest([
      manifestEntry(1, { byteLength: STUDIO_CUSTOM_FONT_LIMITS.individualBytes + 1 }),
    ])).toThrow(/바이트 크기/u);

    const fullEntries = Array.from({ length: 16 }, (_, index) => manifestEntry(index, {
      contentHash: `sha256:${index.toString(16).padStart(64, "0")}`,
      byteLength: STUDIO_CUSTOM_FONT_LIMITS.individualBytes,
    }));
    const { database, repository, store } = await fixture();
    const put = vi.spyOn(store, "put");
    const fullManifest = serializeStudioCustomFontManifest(fullEntries);
    await database.kvSet(
      STUDIO_CUSTOM_FONT_SQLITE_NAMESPACE,
      STUDIO_CUSTOM_FONT_SQLITE_MANIFEST_KEY,
      fullManifest,
    );
    await expect(repository.save({ fileName: "Overflow.ttf", bytes: fontBytes(31) }))
      .rejects.toMatchObject({ code: "invalid" });
    expect(put).not.toHaveBeenCalled();
    expect(await database.kvGet(
      STUDIO_CUSTOM_FONT_SQLITE_NAMESPACE,
      STUDIO_CUSTOM_FONT_SQLITE_MANIFEST_KEY,
    )).toBe(fullManifest);
  });

  it("saves the 513th font and reopens all entries through bounded cursor pages", async () => {
    const filename = `custom-font-513-${crypto.randomUUID()}.sqlite3`;
    const fs = createStudioOpfsMemoryFileSystem();
    const firstDatabase = await openMemoryDatabase(filename, false);
    const first = await fixture({ database: firstDatabase, fs });
    const bytes = fontBytes(41);
    const put = await first.store.put(bytes, { mime: "font/ttf", codec: "identity" });
    const seedEntries = Array.from({ length: 512 }, (_, index) => manifestEntry(index, {
      contentHash: put.ref.hash,
      byteLength: bytes.byteLength,
    }));
    await first.database.kvSet(
      STUDIO_CUSTOM_FONT_SQLITE_NAMESPACE,
      STUDIO_CUSTOM_FONT_SQLITE_MANIFEST_KEY,
      serializeStudioCustomFontManifest(seedEntries),
    );
    await first.store.setOwnerRefs(STUDIO_CUSTOM_FONT_CAS_OWNER, [put.ref.hash]);
    await first.repository.save({
      id: "font-0512",
      fileName: "CJK-Family-512.ttf",
      bytes,
    });
    await firstDatabase.close();

    const reopenedDatabase = await openMemoryDatabase(filename);
    const reopened = await fixture({
      database: reopenedDatabase,
      fs,
      store: createStudioOpfsAssetStore({ fs, graceMs: 0 }),
    });
    const listed = await listAllFonts(reopened.repository, 37);
    expect(listed).toHaveLength(513);
    expect(listed.some(({ id }) => id === "font-0512")).toBe(true);
  });

  it("traverses 1,001+ entries without hydrating more than the requested page", async () => {
    const { database, repository, store } = await fixture();
    const bytes = fontBytes(43);
    const put = await store.put(bytes, { mime: "font/ttf", codec: "identity" });
    const entries = Array.from({ length: 1_001 }, (_, index) => manifestEntry(index, {
      contentHash: put.ref.hash,
      byteLength: bytes.byteLength,
    }));
    await database.kvSet(
      STUDIO_CUSTOM_FONT_SQLITE_NAMESPACE,
      STUDIO_CUSTOM_FONT_SQLITE_MANIFEST_KEY,
      serializeStudioCustomFontManifest(entries),
    );
    await store.setOwnerRefs(STUDIO_CUSTOM_FONT_CAS_OWNER, [put.ref.hash]);

    const ids: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await repository.page({ pageSize: 37, cursor });
      expect(page.fonts.length).toBeLessThanOrEqual(37);
      expect(page.hydratedBytes).toBe(page.fonts.length * bytes.byteLength);
      ids.push(...page.fonts.map(({ id }) => id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null);
    expect(ids).toHaveLength(1_001);
    expect(new Set(ids).size).toBe(1_001);
    expect(pages).toBeGreaterThan(27);
  });

  it("binds opaque cursors to the manifest and fails closed for malformed, stale, and aborted reads", async () => {
    const { repository, store } = await fixture();
    await repository.save({ id: "font-a", fileName: "A.ttf", bytes: fontBytes(45) });
    await repository.save({ id: "font-b", fileName: "B.ttf", bytes: fontBytes(47) });
    const first = await repository.page({ pageSize: 1 });
    expect(first.nextCursor).toEqual(expect.any(String));

    await expect(repository.page({ pageSize: 1, cursor: "forged" }))
      .rejects.toMatchObject({ code: "invalid-cursor" });
    await repository.save({ id: "font-c", fileName: "C.ttf", bytes: fontBytes(49) });
    await expect(repository.page({ pageSize: 1, cursor: first.nextCursor }))
      .rejects.toMatchObject({ code: "invalid-cursor" });

    const get = vi.spyOn(store, "get");
    const callsBeforeAbort = get.mock.calls.length;
    const controller = new AbortController();
    controller.abort();
    await expect(repository.page({ pageSize: 1, signal: controller.signal }))
      .rejects.toMatchObject({ code: "aborted" });
    expect(get.mock.calls).toHaveLength(callsBeforeAbort);
  });

  it("rejects invalid page and compatibility budgets instead of clamping caller intent", async () => {
    const { repository } = await fixture();
    await expect(repository.page({ pageSize: 0 }))
      .rejects.toMatchObject({ code: "invalid-page-size" });
    await expect(repository.page({ pageSize: STUDIO_CUSTOM_FONT_MAX_PAGE_SIZE + 1 }))
      .rejects.toMatchObject({ code: "invalid-page-size" });
    await expect(repository.materialize({
      maxEntries: STUDIO_CUSTOM_FONT_MAX_COMPATIBILITY_ENTRIES + 1,
      maxHydratedBytes: 1,
    }))
      .rejects.toMatchObject({ code: "invalid-page-size" });
    await expect(repository.materialize({ maxEntries: 1, maxHydratedBytes: 0 }))
      .rejects.toMatchObject({ code: "invalid-page-size" });
  });

  it("applies byte backpressure before the next CAS hydration and returns explicit materialization receipts", async () => {
    const { repository, store } = await fixture();
    const bytes = fontBytes(51, 96);
    await repository.save({ id: "font-a", fileName: "A.ttf", bytes });
    await repository.save({ id: "font-b", fileName: "B.ttf", bytes });
    const get = vi.spyOn(store, "get");

    const first = await repository.page({ pageSize: 2, maxHydratedBytes: 100 });
    expect(first.fonts).toHaveLength(1);
    expect(first.hydratedBytes).toBe(96);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(get).toHaveBeenCalledTimes(1);
    const second = await repository.page({
      pageSize: 2,
      cursor: first.nextCursor,
      maxHydratedBytes: 100,
    });
    expect(second.fonts).toHaveLength(1);
    expect(second.nextCursor).toBeNull();

    const receipt = await repository.materialize({
      maxEntries: 1,
      maxHydratedBytes: 100,
      pageSize: 1,
    });
    expect(receipt).toMatchObject({
      truncated: true,
      totalEntries: 2,
      totalBytes: 192,
      hydratedBytes: 96,
    });
    expect(receipt.fonts).toHaveLength(1);
    expect(receipt.nextCursor).toEqual(expect.any(String));

    await expect(repository.page({ pageSize: 1, maxHydratedBytes: 95 }))
      .rejects.toMatchObject({ code: "backpressure" });
  });

  it("rejects a caller-provided hash that differs from the actual font bytes", async () => {
    const { repository } = await fixture();
    await expect(repository.save({
      fileName: "Hash.ttf",
      bytes: fontBytes(33),
      contentHash: `sha256:${"f".repeat(64)}`,
    })).rejects.toMatchObject({ code: "invalid" });
  });

  it("deletes metadata first-class and reclaims the unreferenced CAS blob", async () => {
    const { repository, store } = await fixture();
    const saved = await repository.save({ fileName: "Delete.ttf", bytes: fontBytes(35) });
    await repository.delete(saved.id);

    await expect(listAllFonts(repository)).resolves.toEqual([]);
    expect(await store.ownerRefs(STUDIO_CUSTOM_FONT_CAS_OWNER)).toEqual([]);
    expect(await store.has(saved.contentHash)).toBe(false);
  });
});
