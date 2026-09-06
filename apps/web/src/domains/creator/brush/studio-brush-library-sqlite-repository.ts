/**
 * SQLite-first product authority for the unlimited Studio brush library.
 *
 * The table stores the canonical StudioSavedBrush JSON plus independently indexed
 * search/order columns. Reads verify both representations so bit-rot or an external
 * partial write cannot silently change an artist's brush. Product startup never reads
 * the legacy ToonStudio localStorage envelope: V12 discards internal Studio data at
 * cutover. When OPFS/SQLite is unavailable, the product uses an explicitly labelled
 * in-memory session. localStorage remains reachable only through explicit legacy/test
 * seams and the opt-in migration tool.
 */

import {
  requireStudioBrushLibraryDatabase,
  SqliteUnavailableError,
  type StudioBrushLibraryDatabase,
  type StudioBrushLibrarySqlRecord,
  type StudioKeyValueSqlCompareAndRestoreEntry,
  type StudioLocalDatabase,
  type StudioSqlCompareAndRestoreResult,
} from "../studio-local-database";
import { acquireStudioLocalDatabase } from "../studio-local-database-runtime";

import {
  BRUSH_LIBRARY_KEY,
  BRUSH_LIBRARY_STORAGE_VERSION,
  browserBrushLibraryStorage,
  brushActivityAt,
  duplicateBrushName,
  normalizeStoredBrush,
  readBrushLibrary,
  type BrushLibraryReadStatus,
  type BrushLibraryStorage,
  type StudioSavedBrush,
} from "./studio-brush-library";
import {
  createBrushLibraryRepository,
  createStorageBrushLibraryRepository,
  BrushLibraryRepositoryError,
  type BrushLibraryAdapterPage,
  type BrushLibraryBatchWriteSummary,
  type BrushLibraryRepositoryAdapter,
  type BrushLibraryRepositoryPort,
} from "./studio-brush-library-repository";
import { STUDIO_BRUSH_RUNTIME_CONTRACT } from "./studio-brush-runtime-contract";

import type { StudioBrushRenderFamily } from "../studio-brush";

export const BRUSH_LIBRARY_LEGACY_MIGRATION_NAMESPACE =
  "studio-brush-library-migrations";
export const BRUSH_LIBRARY_LEGACY_MIGRATION_KEY =
  "localstorage-envelope-v1-to-sqlite-v3";
export const BRUSH_LIBRARY_LEGACY_MIGRATION_VERSION = 1 as const;
export const BRUSH_LIBRARY_V12_FALLBACK_KEY =
  "toonspectrum-studio-v12-brush-library-fallback";
export const STUDIO_BRUSH_LIBRARY_CHANGED_EVENT =
  "toonspectrum-studio-v12-brush-library-changed";

export function notifyStudioBrushLibraryChanged(): void {
  globalThis.dispatchEvent?.(new Event(STUDIO_BRUSH_LIBRARY_CHANGED_EVENT));
}

const FAMILY_BY_BRUSH_ID = new Map<string, StudioBrushRenderFamily>(
  STUDIO_BRUSH_RUNTIME_CONTRACT.map((entry) => [entry.id, entry.family] as const),
);

export type ProductBrushLibraryAuthority = "sqlite" | "memory-session";

export interface LegacyBrushLibraryMigrationResult {
  readonly status: "imported" | "already-complete" | "empty" | "source-unavailable";
  readonly sourceCount: number;
  readonly insertedCount: number;
}

export interface ProductBrushLibraryRepository {
  readonly authority: ProductBrushLibraryAuthority;
  readonly repository: BrushLibraryRepositoryPort;
  readonly migration: LegacyBrushLibraryMigrationResult | null;
  /** Product-only stale-install compensation. SQLite executes compare+restore in one transaction. */
  readonly compareAndRestoreInstallSnapshot?: (
    entries: readonly StudioBrushLibraryInstallCompareAndRestoreEntry[],
    sidecars?: readonly StudioKeyValueSqlCompareAndRestoreEntry[],
  ) => Promise<StudioSqlCompareAndRestoreResult>;
  /** Migration CAS seam: inserts only rows that are still absent, never overwriting newer edits. */
  readonly insertMissingInstallSnapshot?: (
    brushes: readonly StudioSavedBrush[],
  ) => Promise<number>;
}

export interface StudioBrushLibraryInstallCompareAndRestoreEntry {
  readonly id: string;
  readonly expected: StudioSavedBrush;
  readonly restore: StudioSavedBrush | null;
}

interface SqliteBrushLibraryAdapterOptions {
  readonly now?: () => number;
  readonly uuid?: () => string;
}

export interface OpenProductBrushLibraryRepositoryOptions {
  /**
   * Explicit legacy-import seam. The default product open and its memory-session
   * fallback never read or write this storage.
   */
  readonly storage?: BrushLibraryStorage | null;
  readonly acquireDatabase?: () => Promise<StudioLocalDatabase>;
  /**
   * V12 product policy is `discard`. `import-explicit` exists only for controlled
   * developer/test tooling and must never be selected by the default `/studio` boot.
   */
  readonly legacyDataPolicy?: "discard" | "import-explicit";
  readonly now?: () => number;
  readonly uuid?: () => string;
}

function createV12FallbackStorage(
  storage: BrushLibraryStorage | null | undefined,
): BrushLibraryStorage | null {
  if (!storage) return null;
  return {
    getItem(key) {
      if (key !== BRUSH_LIBRARY_KEY) return null;
      return storage.getItem(BRUSH_LIBRARY_V12_FALLBACK_KEY);
    },
    setItem(key, value) {
      if (key !== BRUSH_LIBRARY_KEY) return;
      storage.setItem(BRUSH_LIBRARY_V12_FALLBACK_KEY, value);
    },
  };
}

/**
 * Explicit legacy/test adapter for the retired V12 localStorage fallback envelope.
 * Product factories never call this function.
 */
export function createLegacyV12FallbackBrushLibraryRepository(
  storage: BrushLibraryStorage | null | undefined,
): BrushLibraryRepositoryPort {
  return createStorageBrushLibraryRepository(createV12FallbackStorage(storage));
}

function createMemorySessionBrushLibraryProduct(): Pick<
  ProductBrushLibraryRepository,
  "repository" | "compareAndRestoreInstallSnapshot"
> {
  const values = new Map<string, string>();
  const storage: BrushLibraryStorage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
  const repository = createStorageBrushLibraryRepository(storage);
  return {
    repository,
    async compareAndRestoreInstallSnapshot(entries, sidecars = []) {
      const seen = new Set<string>();
      for (const entry of entries) {
        if (
          entry.id.length === 0
          || seen.has(entry.id)
          || entry.expected.id !== entry.id
          || (entry.restore !== null && entry.restore.id !== entry.id)
        ) {
          throw new BrushLibraryRepositoryError(
            "write-error",
            "Memory brush compare-and-restore input is invalid",
          );
        }
        seen.add(entry.id);
      }
      const sidecarKeys = new Set<string>();
      const unsupportedSidecars: string[] = [];
      for (const { namespace, key } of sidecars) {
        const identity = `${namespace}\u0000${key}`;
        if (namespace.length === 0 || key.length === 0 || sidecarKeys.has(identity)) {
          throw new BrushLibraryRepositoryError(
            "write-error",
            "Memory brush compare-and-restore sidecar input is invalid",
          );
        }
        sidecarKeys.add(identity);
        unsupportedSidecars.push(identity);
      }
      if (unsupportedSidecars.length > 0) {
        // This authority cannot atomically share a transaction with the SQLite receipt. Treat the
        // unverifiable sidecar as a global newer-operation conflict and preserve every row.
        return { restoredIds: [], conflictIds: unsupportedSidecars };
      }
      const read = readBrushLibrary(storage);
      if (read.status !== "ok" && read.status !== "empty") {
        throw new BrushLibraryRepositoryError(
          "read-error",
          `Memory brush library cannot be compensated safely (${read.status})`,
        );
      }
      const currentById = new Map(read.brushes.map((brush) => [brush.id, brush]));
      const conflictIds: string[] = [];
      const restoredIds: string[] = [];
      const eligibleIds = new Set<string>();
      for (const entry of entries) {
        const current = currentById.get(entry.id) ?? null;
        const currentRecord = current === null ? null : studioBrushToSqlRecord(current);
        const restoreRecord = entry.restore === null
          ? null
          : studioBrushToSqlRecord(entry.restore);
        const alreadyRestored = currentRecord === null
          ? restoreRecord === null
          : restoreRecord !== null
            && canonicalJson(currentRecord) === canonicalJson(restoreRecord);
        if (
          !alreadyRestored
          && (
            currentRecord === null
            || canonicalJson(currentRecord)
              !== canonicalJson(studioBrushToSqlRecord(entry.expected))
          )
        ) {
          conflictIds.push(entry.id);
          continue;
        }
        if (!alreadyRestored) eligibleIds.add(entry.id);
      }

      for (const entry of entries) {
        if (!eligibleIds.has(entry.id)) continue;
        if (entry.restore === null) currentById.delete(entry.id);
        else currentById.set(entry.id, sqlRecordToStudioBrush(studioBrushToSqlRecord(entry.restore)));
        restoredIds.push(entry.id);
      }
      if (restoredIds.length > 0) {
        values.set(BRUSH_LIBRARY_KEY, JSON.stringify({
          version: BRUSH_LIBRARY_STORAGE_VERSION,
          brushes: [...currentById.values()],
        }));
      }
      return { restoredIds, conflictIds };
    },
  };
}

/** A fresh, non-persistent repository whose lifetime is the returned product session. */
export function createMemorySessionBrushLibraryRepository(): BrushLibraryRepositoryPort {
  return createMemorySessionBrushLibraryProduct().repository;
}

function normalizeSearch(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

function familyOf(brushId: string): StudioBrushRenderFamily {
  return FAMILY_BY_BRUSH_ID.get(brushId) ?? "pen";
}

function brushSearchText(brush: StudioSavedBrush, category: string): string {
  return normalizeSearch([
    brush.id,
    brush.name,
    brush.brushId,
    brush.sourcePresetId ?? "",
    brush.sourcePresetName ?? "",
    category,
  ].join("\u0000"));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function corruptRecord(message: string, detail?: unknown): BrushLibraryRepositoryError {
  return new BrushLibraryRepositoryError("corrupt", message, detail);
}

export function studioBrushToSqlRecord(brush: StudioSavedBrush): StudioBrushLibrarySqlRecord {
  const normalized = normalizeStoredBrush(brush);
  if (!normalized) {
    throw corruptRecord("Brush library write contains an invalid Studio brush");
  }
  const category = familyOf(normalized.brushId);
  return {
    id: normalized.id,
    name: normalized.name,
    brushId: normalized.brushId,
    category,
    searchText: brushSearchText(normalized, category),
    payload: JSON.stringify(normalized),
    pinned: normalized.pinned,
    activityAt: brushActivityAt(normalized),
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
    lastUsedAt: normalized.lastUsedAt,
  };
}

export function sqlRecordToStudioBrush(
  record: StudioBrushLibrarySqlRecord,
): StudioSavedBrush {
  let parsed: unknown;
  try {
    parsed = JSON.parse(record.payload);
  } catch (error) {
    throw corruptRecord(`Brush ${record.id} contains invalid JSON`, error);
  }
  const brush = normalizeStoredBrush(parsed);
  if (!brush || canonicalJson(parsed) !== canonicalJson(brush)) {
    throw corruptRecord(`Brush ${record.id} payload is invalid or non-canonical`);
  }
  const category = familyOf(brush.brushId);
  const expected = studioBrushToSqlRecord(brush);
  if (
    record.id !== expected.id
    || record.name !== expected.name
    || record.brushId !== expected.brushId
    || record.category !== category
    || record.searchText !== expected.searchText
    || record.pinned !== expected.pinned
    || record.activityAt !== expected.activityAt
    || record.createdAt !== expected.createdAt
    || record.updatedAt !== expected.updatedAt
    || record.lastUsedAt !== expected.lastUsedAt
  ) {
    throw corruptRecord(`Brush ${record.id} indexed columns disagree with its payload`);
  }
  return brush;
}

function writeFailure(message: string, error: unknown): BrushLibraryRepositoryError {
  if (error instanceof BrushLibraryRepositoryError) return error;
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (/SQLITE_FULL|database or disk is full|quota exceeded/i.test(detail)) {
    return new BrushLibraryRepositoryError(
      "quota-exceeded",
      "SQLite brush-library storage quota was exceeded",
      error,
    );
  }
  return new BrushLibraryRepositoryError("write-error", message, error);
}

function readFailure(message: string, error: unknown): BrushLibraryRepositoryError {
  return error instanceof BrushLibraryRepositoryError
    ? error
    : new BrushLibraryRepositoryError("read-error", message, error);
}

export function createSqliteBrushLibraryAdapter(
  database: StudioBrushLibraryDatabase,
  options: SqliteBrushLibraryAdapterOptions = {},
): BrushLibraryRepositoryAdapter {
  const now = options.now ?? Date.now;
  const uuid = options.uuid ?? (() => crypto.randomUUID());

  return {
    async query(input): Promise<BrushLibraryAdapterPage> {
      try {
        const page = await database.queryBrushLibraryRecords({
          limit: input.limit,
          search: input.search,
          category: input.category === "all" ? null : input.category,
          pinned: input.pinned,
          after: input.after,
        });
        return {
          items: page.records.map(sqlRecordToStudioBrush),
          hasMore: page.hasMore,
          totalCount: page.totalCount,
        };
      } catch (error) {
        throw readFailure("SQLite brush-library query failed", error);
      }
    },

    async getById(id) {
      try {
        const record = await database.getBrushLibraryRecord(id);
        return record === null ? null : sqlRecordToStudioBrush(record);
      } catch (error) {
        throw readFailure(`SQLite brush-library read failed for ${id}`, error);
      }
    },

    async put(brush) {
      try {
        const record = studioBrushToSqlRecord(brush);
        await database.putBrushLibraryRecord(record);
        return sqlRecordToStudioBrush(record);
      } catch (error) {
        throw writeFailure(`SQLite brush-library write failed for ${brush.id}`, error);
      }
    },

    async putMany(brushes): Promise<BrushLibraryBatchWriteSummary> {
      const unique: StudioSavedBrush[] = [];
      const ids = new Set<string>();
      for (const brush of brushes) {
        if (ids.has(brush.id)) continue;
        ids.add(brush.id);
        unique.push(brush);
      }
      try {
        await database.putBrushLibraryRecords(unique.map(studioBrushToSqlRecord));
      } catch (error) {
        throw writeFailure("SQLite brush-library batch write failed", error);
      }
      return {
        savedCount: unique.length,
        skippedDuplicateCount: brushes.length - unique.length,
      };
    },

    async delete(id) {
      try {
        const deleted = await database.deleteBrushLibraryRecord(id);
        return deleted === null
          ? null
          : { brush: sqlRecordToStudioBrush(deleted.record), index: deleted.index };
      } catch (error) {
        throw writeFailure(`SQLite brush-library delete failed for ${id}`, error);
      }
    },

    async restore(deleted) {
      try {
        const record = studioBrushToSqlRecord(deleted.brush);
        await database.putBrushLibraryRecord(record);
        return sqlRecordToStudioBrush(record);
      } catch (error) {
        throw writeFailure(`SQLite brush-library restore failed for ${deleted.brush.id}`, error);
      }
    },

    async duplicate(id) {
      let source: StudioBrushLibrarySqlRecord | null;
      let names: string[];
      try {
        [source, names] = await Promise.all([
          database.getBrushLibraryRecord(id),
          database.listBrushLibraryNames(),
        ]);
      } catch (error) {
        throw readFailure(`SQLite brush-library duplicate read failed for ${id}`, error);
      }
      if (source === null) return null;
      const original = sqlRecordToStudioBrush(source);
      const timestamp = now();
      const duplicate: StudioSavedBrush = {
        ...original,
        id: uuid(),
        name: duplicateBrushName(original.name, names),
        createdAt: timestamp,
        updatedAt: timestamp,
        pinned: false,
        lastUsedAt: null,
      };
      try {
        await database.putBrushLibraryRecord(studioBrushToSqlRecord(duplicate));
        return duplicate;
      } catch (error) {
        throw writeFailure(`SQLite brush-library duplicate write failed for ${id}`, error);
      }
    },
  };
}

export function createSqliteBrushLibraryRepository(
  database: StudioLocalDatabase,
  options: SqliteBrushLibraryAdapterOptions = {},
): BrushLibraryRepositoryPort {
  return createBrushLibraryRepository(
    createSqliteBrushLibraryAdapter(requireStudioBrushLibraryDatabase(database), options),
  );
}

function legacyReadError(status: BrushLibraryReadStatus): BrushLibraryRepositoryError {
  const code = status === "unsupported-version" ? "unsupported-version"
    : status === "read-error" ? "read-error"
      : status === "unavailable" ? "unavailable"
        : "corrupt";
  return new BrushLibraryRepositoryError(
    code,
    `Legacy brush library cannot be imported safely (${status})`,
  );
}

interface LegacyMigrationMarker {
  version: typeof BRUSH_LIBRARY_LEGACY_MIGRATION_VERSION;
  sourceVersion: typeof BRUSH_LIBRARY_STORAGE_VERSION;
  sourceCount: number;
  insertedCount: number;
  completedAt: number;
}

function parseMigrationMarker(raw: string): LegacyMigrationMarker {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw corruptRecord("Brush-library legacy migration marker contains invalid JSON", error);
  }
  if (!value || typeof value !== "object") {
    throw corruptRecord("Brush-library legacy migration marker has an invalid shape");
  }
  const marker = value as Partial<LegacyMigrationMarker>;
  if (
    marker.version !== BRUSH_LIBRARY_LEGACY_MIGRATION_VERSION
    || marker.sourceVersion !== BRUSH_LIBRARY_STORAGE_VERSION
    || !Number.isSafeInteger(marker.sourceCount)
    || (marker.sourceCount ?? -1) < 0
    || !Number.isSafeInteger(marker.insertedCount)
    || (marker.insertedCount ?? -1) < 0
    || typeof marker.completedAt !== "number"
    || !Number.isFinite(marker.completedAt)
  ) {
    throw corruptRecord("Brush-library legacy migration marker has an invalid shape");
  }
  return marker as LegacyMigrationMarker;
}

export async function migrateLegacyBrushLibraryToSqlite(
  database: StudioLocalDatabase,
  storage: BrushLibraryStorage | null | undefined,
  now: () => number = Date.now,
): Promise<LegacyBrushLibraryMigrationResult> {
  const markerRaw = await database.kvGet(
    BRUSH_LIBRARY_LEGACY_MIGRATION_NAMESPACE,
    BRUSH_LIBRARY_LEGACY_MIGRATION_KEY,
  );
  if (markerRaw !== null) {
    const marker = parseMigrationMarker(markerRaw);
    return {
      status: "already-complete",
      sourceCount: marker.sourceCount,
      insertedCount: marker.insertedCount,
    };
  }

  const legacy = readBrushLibrary(storage);
  if (legacy.status === "unavailable") {
    return { status: "source-unavailable", sourceCount: 0, insertedCount: 0 };
  }
  if (legacy.status !== "ok" && legacy.status !== "empty") {
    throw legacyReadError(legacy.status);
  }

  const brushDatabase = requireStudioBrushLibraryDatabase(database);
  const insertedCount = await brushDatabase.insertMissingBrushLibraryRecords(
    legacy.brushes.map(studioBrushToSqlRecord),
  );
  const marker: LegacyMigrationMarker = {
    version: BRUSH_LIBRARY_LEGACY_MIGRATION_VERSION,
    sourceVersion: BRUSH_LIBRARY_STORAGE_VERSION,
    sourceCount: legacy.brushes.length,
    insertedCount,
    completedAt: now(),
  };
  // Batch import is atomic. If this marker write fails, the next launch repeats an
  // insert-if-absent merge and therefore cannot overwrite newer SQLite edits.
  await database.kvSet(
    BRUSH_LIBRARY_LEGACY_MIGRATION_NAMESPACE,
    BRUSH_LIBRARY_LEGACY_MIGRATION_KEY,
    JSON.stringify(marker),
  );
  return {
    status: legacy.brushes.length === 0 ? "empty" : "imported",
    sourceCount: legacy.brushes.length,
    insertedCount,
  };
}

async function openProductBrushLibraryRepositoryInternal(
  options: OpenProductBrushLibraryRepositoryOptions,
): Promise<ProductBrushLibraryRepository> {
  let database: StudioLocalDatabase;
  try {
    database = await (options.acquireDatabase ?? acquireStudioLocalDatabase)();
  } catch (error) {
    if (!(error instanceof SqliteUnavailableError)) throw error;
    const memory = createMemorySessionBrushLibraryProduct();
    return {
      authority: "memory-session",
      repository: memory.repository,
      migration: null,
      compareAndRestoreInstallSnapshot: memory.compareAndRestoreInstallSnapshot,
    };
  }

  const storage = options.legacyDataPolicy === "import-explicit"
    ? options.storage === undefined
      ? browserBrushLibraryStorage()
      : options.storage
    : null;
  const migration = options.legacyDataPolicy === "import-explicit"
    ? await migrateLegacyBrushLibraryToSqlite(database, storage, options.now)
    : null;
  const brushDatabase = requireStudioBrushLibraryDatabase(database);
  return {
    authority: "sqlite",
    repository: createBrushLibraryRepository(createSqliteBrushLibraryAdapter(brushDatabase, {
      now: options.now,
      uuid: options.uuid,
    })),
    migration,
    compareAndRestoreInstallSnapshot: (entries, sidecars = []) =>
      brushDatabase.compareAndRestoreBrushLibraryRecords(
        entries.map((entry) => ({
          id: entry.id,
          expected: studioBrushToSqlRecord(entry.expected),
          restore: entry.restore === null ? null : studioBrushToSqlRecord(entry.restore),
        })),
        sidecars,
      ),
    insertMissingInstallSnapshot: (brushes) =>
      brushDatabase.insertMissingBrushLibraryRecords(
        brushes.map(studioBrushToSqlRecord),
      ),
  };
}

/**
 * The page, desktop inspector, mobile dock, and import surfaces are projections of
 * one app-lifetime catalog. In particular, an OPFS ownership failure must not give
 * every projection a different empty memory fallback: a later panel hydration could
 * otherwise replace an in-session import with `[]`.
 */
let sharedProductBrushLibraryPromise: Promise<ProductBrushLibraryRepository> | null = null;

function usesProductBrushLibraryRuntime(
  options: OpenProductBrushLibraryRepositoryOptions,
): boolean {
  return options.acquireDatabase === undefined
    && options.storage === undefined
    && options.legacyDataPolicy === undefined
    && options.now === undefined
    && options.uuid === undefined;
}

/** Test/session retry seam. The shared SQLite handle remains owned by its runtime. */
export function resetProductBrushLibraryRepositoryRuntime(): void {
  sharedProductBrushLibraryPromise = null;
  notifyStudioBrushLibraryChanged();
}

/**
 * A different SQLite consumer can retry the shared DB while the brush opening is
 * still resolving to its tab-lifetime fallback. Wait for that exact generation so
 * a pending save cannot be orphaned between two memory repositories.
 */
export async function reconcileProductBrushLibraryRepositoryForDatabaseClose(
  options: { readonly preserveMemorySession?: boolean } = {},
): Promise<void> {
  const opening = sharedProductBrushLibraryPromise;
  if (!opening) return;
  if (options.preserveMemorySession) {
    try {
      const product = await opening;
      if (sharedProductBrushLibraryPromise !== opening) return;
      if (product.authority === "memory-session") return;
    } catch {
      // The opening rejection path already clears this exact generation.
    }
  }
  if (sharedProductBrushLibraryPromise === opening) {
    resetProductBrushLibraryRepositoryRuntime();
  }
}

export function openProductBrushLibraryRepository(
  options: OpenProductBrushLibraryRepositoryOptions = {},
): Promise<ProductBrushLibraryRepository> {
  if (!usesProductBrushLibraryRuntime(options)) {
    return openProductBrushLibraryRepositoryInternal(options);
  }
  if (!sharedProductBrushLibraryPromise) {
    const opening = openProductBrushLibraryRepositoryInternal({});
    sharedProductBrushLibraryPromise = opening;
    void opening.then(
      () => undefined,
      () => {
        if (sharedProductBrushLibraryPromise === opening) {
          sharedProductBrushLibraryPromise = null;
        }
      },
    );
  }
  return sharedProductBrushLibraryPromise;
}

/**
 * Controlled legacy consumers still expect one array. Read it in deterministic SQL
 * pages without imposing a catalog cap; the page size only bounds per-query memory.
 */
export async function readAllBrushesFromRepository(
  repository: BrushLibraryRepositoryPort,
  pageSize = 256,
): Promise<StudioSavedBrush[]> {
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0) {
    throw new RangeError("Brush library read page size must be a positive safe integer");
  }
  const brushes: StudioSavedBrush[] = [];
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  let hasMore = true;
  while (hasMore) {
    const page = await repository.query({ cursor, limit: pageSize });
    for (const brush of page.items) {
      if (ids.has(brush.id)) {
        throw corruptRecord(`Brush repository repeated id ${brush.id} across pages`);
      }
      ids.add(brush.id);
      brushes.push(brush);
    }
    hasMore = page.hasMore;
    if (!hasMore) break;
    if (page.nextCursor === null || cursors.has(page.nextCursor)) {
      throw corruptRecord("Brush repository returned a missing or cyclic page cursor");
    }
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  return brushes;
}
