/**
 * SQLite-first, uncapped Studio filter-preset catalog.
 *
 * SQL is the product mutation authority. V12 deliberately discards the old ToonStudio
 * v1 localStorage catalog: product open never reads or imports it. When OPFS/SQLite is
 * unavailable, the product uses an explicitly labelled in-memory session. The retired
 * V12 localStorage fallback remains only as an explicit legacy/test adapter. Other SQL,
 * corruption, or quota failures are surfaced and never downgraded silently.
 */

import {
  STUDIO_CREATOR_FILTER_PRESET_LIBRARY_KEY,
  isStudioCreatorInstalledFilterPreset,
  type StudioCreatorInstalledFilterPreset,
  type StudioCreatorPackStorage,
} from "../studio-creator-filter-preset-reader";
import {
  requireStudioFilterLibraryDatabase,
  SqliteUnavailableError,
  type StudioFilterLibrarySqlCursor,
  type StudioFilterLibrarySqlRecord,
  type StudioLocalDatabase,
  type StudioSqlCompareAndRestoreResult,
} from "../studio-local-database";
import { acquireStudioLocalDatabase } from "../studio-local-database-runtime";

import { isStudioFilterPackKind } from "./studio-filter-pack";

export const FILTER_LIBRARY_LEGACY_MIGRATION_NAMESPACE =
  "studio-filter-library-explicit-imports";
export const FILTER_LIBRARY_LEGACY_MIGRATION_KEY =
  "localstorage-array-v1-to-sqlite-v4";
export const FILTER_LIBRARY_LEGACY_MIGRATION_VERSION = 1 as const;
export const FILTER_LIBRARY_DEFAULT_CATEGORY = "creator-pack";
export const STUDIO_FILTER_LIBRARY_V12_FALLBACK_KEY =
  "toonspectrum.studio-filter-library.v12.fallback" as const;
export const STUDIO_FILTER_LIBRARY_DATA_POLICY = "discard-existing-studio-data" as const;

export type ProductFilterLibraryAuthority = "sqlite" | "memory-session";

export interface StudioFilterLibraryPreset extends StudioCreatorInstalledFilterPreset {
  readonly category: string;
  readonly favorite: boolean;
  readonly sortOrder: number;
  readonly packageVersion: string;
  readonly packageFingerprint: string;
}

export interface StudioFilterLibraryQuery {
  readonly cursor?: StudioFilterLibrarySqlCursor | null;
  readonly limit?: number;
  readonly search?: string;
  readonly category?: string | null;
  readonly engine?: string | null;
  readonly favorite?: boolean | null;
}

export interface StudioFilterLibraryPage {
  readonly items: readonly StudioFilterLibraryPreset[];
  readonly nextCursor: StudioFilterLibrarySqlCursor | null;
  readonly hasMore: boolean;
  readonly totalCount: number;
}

export interface StudioFilterLibraryRepository {
  query(input?: StudioFilterLibraryQuery): Promise<StudioFilterLibraryPage>;
  getById(id: string): Promise<StudioFilterLibraryPreset | null>;
  put(preset: StudioFilterLibraryPreset): Promise<StudioFilterLibraryPreset>;
  putMany(presets: readonly StudioFilterLibraryPreset[]): Promise<number>;
  delete(id: string): Promise<StudioFilterLibraryPreset | null>;
  deleteMany(ids: readonly string[]): Promise<number>;
  setFavorite(id: string, favorite: boolean): Promise<StudioFilterLibraryPreset | null>;
}

export interface LegacyFilterLibraryMigrationResult {
  readonly status: "imported" | "already-complete" | "empty" | "source-unavailable";
  readonly sourceCount: number;
  readonly insertedCount: number;
}

export interface ProductFilterLibraryRepository {
  readonly authority: ProductFilterLibraryAuthority;
  readonly repository: StudioFilterLibraryRepository;
  readonly legacyDataPolicy: typeof STUDIO_FILTER_LIBRARY_DATA_POLICY;
  /** Product-only stale-install compensation with one SQLite transaction / memory turn. */
  readonly compareAndRestoreInstallSnapshot?: (
    entries: readonly StudioFilterLibraryInstallCompareAndRestoreEntry[],
  ) => Promise<StudioSqlCompareAndRestoreResult>;
  /** Migration CAS seam: inserts only rows that are still absent, never overwriting newer edits. */
  readonly insertMissingInstallSnapshot?: (
    presets: readonly StudioFilterLibraryPreset[],
  ) => Promise<number>;
}

export interface StudioFilterLibraryInstallCompareAndRestoreEntry {
  readonly id: string;
  readonly expected: StudioFilterLibraryPreset;
  readonly restore: StudioFilterLibraryPreset | null;
}

export interface OpenProductFilterLibraryRepositoryOptions {
  /** Explicit legacy/test seam. Product open never reads or writes this storage. */
  readonly storage?: StudioCreatorPackStorage | null;
  readonly acquireDatabase?: () => Promise<StudioLocalDatabase>;
  readonly now?: () => number;
}

export type FilterLibraryRepositoryErrorCode =
  | "corrupt"
  | "read-error"
  | "write-error"
  | "quota-exceeded";

export class FilterLibraryRepositoryError extends Error {
  constructor(
    readonly code: FilterLibraryRepositoryErrorCode,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "FilterLibraryRepositoryError";
  }
}

function normalizedText(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

function normalizedCategory(value: string): string {
  const category = normalizedText(value);
  if (category.length === 0) {
    throw new FilterLibraryRepositoryError("corrupt", "Filter preset category is empty");
  }
  return category;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) {
      throw new FilterLibraryRepositoryError(
        "corrupt",
        "Filter preset contains a non-JSON value",
      );
    }
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function finiteTimestamp(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new FilterLibraryRepositoryError(
      "corrupt",
      `Filter preset ${field} must be a non-negative safe integer`,
    );
  }
  return value;
}

function normalizedSortOrder(value: number): number {
  if (!Number.isSafeInteger(value)) {
    throw new FilterLibraryRepositoryError(
      "corrupt",
      "Filter preset sortOrder must be a safe integer",
    );
  }
  return value;
}

function normalizedPackageMetadata(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new FilterLibraryRepositoryError(
      "corrupt",
      `Filter preset ${field} must be a non-empty string`,
    );
  }
  return value.trim();
}

export function normalizeStudioFilterLibraryPreset(
  input: StudioFilterLibraryPreset,
): StudioFilterLibraryPreset {
  if (!isStudioCreatorInstalledFilterPreset(input)) {
    throw new FilterLibraryRepositoryError(
      "corrupt",
      "Filter preset does not match the normalized Studio engine schema",
    );
  }
  return {
    id: input.id,
    packageId: input.packageId,
    entryId: input.entryId,
    name: input.name,
    engine: input.engine,
    values: { ...input.values },
    installedAt: finiteTimestamp(input.installedAt, "installedAt"),
    updatedAt: finiteTimestamp(input.updatedAt, "updatedAt"),
    category: normalizedCategory(input.category),
    favorite: input.favorite === true,
    sortOrder: normalizedSortOrder(input.sortOrder),
    packageVersion: normalizedPackageMetadata(input.packageVersion, "packageVersion"),
    packageFingerprint: normalizedPackageMetadata(
      input.packageFingerprint,
      "packageFingerprint",
    ),
  };
}

export function legacyFilterPresetToLibraryPreset(
  preset: StudioCreatorInstalledFilterPreset,
  sortOrder: number,
): StudioFilterLibraryPreset {
  return normalizeStudioFilterLibraryPreset({
    ...preset,
    category: FILTER_LIBRARY_DEFAULT_CATEGORY,
    favorite: false,
    sortOrder,
    packageVersion: "legacy",
    packageFingerprint: "legacy",
  });
}

function filterSearchText(preset: StudioFilterLibraryPreset): string {
  return normalizedText([
    preset.id,
    preset.name,
    preset.packageId,
    preset.entryId,
    preset.engine,
    preset.category,
    preset.packageVersion,
    preset.packageFingerprint,
  ].join("\u0000"));
}

export function studioFilterPresetToSqlRecord(
  input: StudioFilterLibraryPreset,
): StudioFilterLibrarySqlRecord {
  const preset = normalizeStudioFilterLibraryPreset(input);
  return {
    id: preset.id,
    name: preset.name,
    packageId: preset.packageId,
    entryId: preset.entryId,
    engine: preset.engine,
    category: preset.category,
    searchText: filterSearchText(preset),
    payload: canonicalJson(preset),
    favorite: preset.favorite,
    sortOrder: preset.sortOrder,
    createdAt: preset.installedAt,
    updatedAt: preset.updatedAt,
  };
}

export function sqlRecordToStudioFilterPreset(
  record: StudioFilterLibrarySqlRecord,
): StudioFilterLibraryPreset {
  let parsed: unknown;
  try {
    parsed = JSON.parse(record.payload);
  } catch (error) {
    throw new FilterLibraryRepositoryError(
      "corrupt",
      `Filter preset ${record.id} contains invalid JSON`,
      error,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new FilterLibraryRepositoryError(
      "corrupt",
      `Filter preset ${record.id} payload is not an object`,
    );
  }
  const preset = normalizeStudioFilterLibraryPreset(
    parsed as StudioFilterLibraryPreset,
  );
  const expected = studioFilterPresetToSqlRecord(preset);
  if (
    record.payload !== expected.payload
    || record.id !== expected.id
    || record.name !== expected.name
    || record.packageId !== expected.packageId
    || record.entryId !== expected.entryId
    || record.engine !== expected.engine
    || record.category !== expected.category
    || record.searchText !== expected.searchText
    || record.favorite !== expected.favorite
    || record.sortOrder !== expected.sortOrder
    || record.createdAt !== expected.createdAt
    || record.updatedAt !== expected.updatedAt
  ) {
    throw new FilterLibraryRepositoryError(
      "corrupt",
      `Filter preset ${record.id} indexed columns disagree with its canonical payload`,
    );
  }
  return preset;
}

function normalizeQuery(input: StudioFilterLibraryQuery = {}) {
  const limit = input.limit ?? 128;
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new RangeError("Filter library page size must be a positive safe integer");
  }
  const engine = input.engine === undefined || input.engine === null
    ? null
    : input.engine;
  if (engine !== null && !isStudioFilterPackKind(engine)) {
    throw new RangeError(`Unsupported filter engine query: ${engine}`);
  }
  const after = input.cursor ?? null;
  if (
    after !== null
    && (
      typeof after.favorite !== "boolean"
      || !Number.isSafeInteger(after.sortOrder)
      || !Number.isSafeInteger(after.updatedAt)
      || typeof after.id !== "string"
      || after.id.length === 0
    )
  ) {
    throw new RangeError("Filter library cursor is invalid");
  }
  return {
    limit,
    search: normalizedText(input.search ?? ""),
    category: input.category === undefined || input.category === null
      ? null
      : normalizedCategory(input.category),
    engine,
    favorite: input.favorite ?? null,
    after,
  };
}

function cursorFor(preset: StudioFilterLibraryPreset): StudioFilterLibrarySqlCursor {
  return {
    favorite: preset.favorite,
    sortOrder: preset.sortOrder,
    updatedAt: preset.updatedAt,
    id: preset.id,
  };
}

function writeError(message: string, error: unknown): FilterLibraryRepositoryError {
  if (error instanceof FilterLibraryRepositoryError) return error;
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (/SQLITE_FULL|database or disk is full|quota exceeded/i.test(detail)) {
    return new FilterLibraryRepositoryError(
      "quota-exceeded",
      "SQLite filter-library storage quota was exceeded",
      error,
    );
  }
  return new FilterLibraryRepositoryError("write-error", message, error);
}

function readError(message: string, error: unknown): FilterLibraryRepositoryError {
  return error instanceof FilterLibraryRepositoryError
    ? error
    : new FilterLibraryRepositoryError("read-error", message, error);
}

export function createSqliteFilterLibraryRepository(
  database: StudioLocalDatabase,
): StudioFilterLibraryRepository {
  const sql = requireStudioFilterLibraryDatabase(database);
  return {
    async query(input = {}) {
      try {
        const page = await sql.queryFilterLibraryRecords(normalizeQuery(input));
        const items = page.records.map(sqlRecordToStudioFilterPreset);
        return {
          items,
          hasMore: page.hasMore,
          totalCount: page.totalCount,
          nextCursor: page.hasMore && items.length > 0
            ? cursorFor(items[items.length - 1]!)
            : null,
        };
      } catch (error) {
        throw readError("SQLite filter-library query failed", error);
      }
    },
    async getById(id) {
      try {
        const record = await sql.getFilterLibraryRecord(id);
        return record === null ? null : sqlRecordToStudioFilterPreset(record);
      } catch (error) {
        throw readError(`SQLite filter-library read failed for ${id}`, error);
      }
    },
    async put(input) {
      const preset = normalizeStudioFilterLibraryPreset(input);
      try {
        await sql.putFilterLibraryRecord(studioFilterPresetToSqlRecord(preset));
        return preset;
      } catch (error) {
        throw writeError(`SQLite filter-library write failed for ${preset.id}`, error);
      }
    },
    async putMany(inputs) {
      const unique = new Map<string, StudioFilterLibraryPreset>();
      for (const input of inputs) {
        const preset = normalizeStudioFilterLibraryPreset(input);
        unique.set(preset.id, preset);
      }
      try {
        await sql.putFilterLibraryRecords(
          [...unique.values()].map(studioFilterPresetToSqlRecord),
        );
        return unique.size;
      } catch (error) {
        throw writeError("SQLite filter-library batch write failed", error);
      }
    },
    async delete(id) {
      try {
        const deleted = await sql.deleteFilterLibraryRecord(id);
        return deleted === null ? null : sqlRecordToStudioFilterPreset(deleted.record);
      } catch (error) {
        throw writeError(`SQLite filter-library delete failed for ${id}`, error);
      }
    },
    async deleteMany(ids) {
      try {
        return await sql.deleteFilterLibraryRecords(ids);
      } catch (error) {
        throw writeError("SQLite filter-library batch delete failed", error);
      }
    },
    async setFavorite(id, favorite) {
      const current = await this.getById(id);
      if (current === null) return null;
      return this.put({ ...current, favorite });
    },
  };
}

function strictStorageRead(
  storage: Pick<StudioCreatorPackStorage, "getItem"> | null | undefined,
  storageKey: string,
): StudioCreatorInstalledFilterPreset[] | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(storageKey);
  } catch (error) {
    throw new FilterLibraryRepositoryError(
      "read-error",
      "Legacy filter-library storage could not be read",
      error,
    );
  }
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new FilterLibraryRepositoryError(
      "corrupt",
      "Legacy filter-library JSON is corrupt",
      error,
    );
  }
  if (!Array.isArray(parsed) || !parsed.every(isStudioCreatorInstalledFilterPreset)) {
    throw new FilterLibraryRepositoryError(
      "corrupt",
      "Legacy filter-library envelope contains invalid presets",
    );
  }
  return parsed;
}

function writeStorage(
  storage: StudioCreatorPackStorage,
  storageKey: string,
  presets: readonly StudioFilterLibraryPreset[],
): void {
  try {
    storage.setItem(storageKey, canonicalJson(presets));
  } catch (error) {
    throw writeError("Legacy filter-library write failed", error);
  }
}

function comparePresets(
  left: StudioFilterLibraryPreset,
  right: StudioFilterLibraryPreset,
): number {
  if (left.favorite !== right.favorite) return left.favorite ? -1 : 1;
  if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
  if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function isAfterCursor(
  preset: StudioFilterLibraryPreset,
  cursor: StudioFilterLibrarySqlCursor,
): boolean {
  if (preset.favorite !== cursor.favorite) return !preset.favorite;
  if (preset.sortOrder !== cursor.sortOrder) return preset.sortOrder > cursor.sortOrder;
  if (preset.updatedAt !== cursor.updatedAt) return preset.updatedAt < cursor.updatedAt;
  return preset.id > cursor.id;
}

interface MutableFilterLibraryStore {
  read(): StudioFilterLibraryPreset[];
  write(presets: readonly StudioFilterLibraryPreset[]): void;
}

function createMutableFilterLibraryRepository(
  store: MutableFilterLibraryStore,
): StudioFilterLibraryRepository {
  return {
    async query(input = {}) {
      const query = normalizeQuery(input);
      const all = store.read().filter((preset) =>
        (query.category === null || preset.category === query.category)
        && (query.engine === null || preset.engine === query.engine)
        && (query.favorite === null || preset.favorite === query.favorite)
        && (query.search.length === 0 || filterSearchText(preset).includes(query.search)),
      ).sort(comparePresets);
      const after = query.after === null
        ? all
        : all.filter((preset) => isAfterCursor(preset, query.after!));
      const items = after.slice(0, query.limit);
      const hasMore = after.length > items.length;
      return {
        items,
        hasMore,
        totalCount: all.length,
        nextCursor: hasMore && items.length > 0
          ? cursorFor(items[items.length - 1]!)
          : null,
      };
    },
    async getById(id) {
      return store.read().find((preset) => preset.id === id) ?? null;
    },
    async put(input) {
      const preset = normalizeStudioFilterLibraryPreset(input);
      const current = store.read();
      const index = current.findIndex((candidate) => candidate.id === preset.id);
      if (index >= 0) current[index] = preset;
      else current.push(preset);
      store.write(current);
      return preset;
    },
    async putMany(inputs) {
      const current = store.read();
      const byId = new Map(current.map((preset) => [preset.id, preset]));
      for (const input of inputs) {
        const preset = normalizeStudioFilterLibraryPreset(input);
        byId.set(preset.id, preset);
      }
      store.write([...byId.values()]);
      return new Set(inputs.map((preset) => preset.id)).size;
    },
    async delete(id) {
      const current = store.read();
      const index = current.findIndex((preset) => preset.id === id);
      if (index < 0) return null;
      const [deleted] = current.splice(index, 1);
      store.write(current);
      return deleted ?? null;
    },
    async deleteMany(ids) {
      const doomed = new Set(ids);
      const current = store.read();
      const retained = current.filter((preset) => !doomed.has(preset.id));
      const deleted = current.length - retained.length;
      store.write(retained);
      return deleted;
    },
    async setFavorite(id, favorite) {
      const current = await this.getById(id);
      return current === null ? null : this.put({ ...current, favorite });
    },
  };
}

function createMemorySessionFilterLibraryProduct(): Pick<
  ProductFilterLibraryRepository,
  "repository" | "compareAndRestoreInstallSnapshot"
> {
  let presets: StudioFilterLibraryPreset[] = [];
  const store: MutableFilterLibraryStore = {
    read: () => [...presets],
    write: (next) => {
      presets = [...next];
    },
  };
  const repository = createMutableFilterLibraryRepository(store);
  return {
    repository,
    async compareAndRestoreInstallSnapshot(entries) {
      const ids = new Set<string>();
      for (const entry of entries) {
        if (
          entry.id.length === 0
          || ids.has(entry.id)
          || entry.expected.id !== entry.id
          || (entry.restore !== null && entry.restore.id !== entry.id)
        ) {
          throw new FilterLibraryRepositoryError(
            "write-error",
            "Memory filter compare-and-restore input is invalid",
          );
        }
        ids.add(entry.id);
      }

      const current = store.read();
      const byId = new Map(current.map((preset) => [preset.id, preset]));
      const restoredIds: string[] = [];
      const conflictIds: string[] = [];
      for (const entry of entries) {
        const candidate = byId.get(entry.id) ?? null;
        const candidateRaw = candidate === null
          ? null
          : canonicalJson(studioFilterPresetToSqlRecord(candidate));
        const restoreRaw = entry.restore === null
          ? null
          : canonicalJson(studioFilterPresetToSqlRecord(entry.restore));
        if (candidateRaw === restoreRaw) continue;
        if (candidateRaw !== canonicalJson(studioFilterPresetToSqlRecord(entry.expected))) {
          conflictIds.push(entry.id);
          continue;
        }
        if (entry.restore === null) byId.delete(entry.id);
        else byId.set(entry.id, normalizeStudioFilterLibraryPreset(entry.restore));
        restoredIds.push(entry.id);
      }
      if (restoredIds.length > 0) store.write([...byId.values()]);
      return { restoredIds, conflictIds };
    },
  };
}

/** A fresh, non-persistent repository whose lifetime is the returned product session. */
export function createMemorySessionFilterLibraryRepository(): StudioFilterLibraryRepository {
  return createMemorySessionFilterLibraryProduct().repository;
}

/**
 * Explicit legacy/test adapter for the retired V12 localStorage fallback envelope.
 * Product factories never call this function.
 */
export function createV12FallbackFilterLibraryRepository(
  storage: StudioCreatorPackStorage | null | undefined,
  storageKey: string = STUDIO_FILTER_LIBRARY_V12_FALLBACK_KEY,
): StudioFilterLibraryRepository {
  return createMutableFilterLibraryRepository({
    read() {
      const legacy = strictStorageRead(storage, storageKey);
      if (legacy === null) {
        throw new FilterLibraryRepositoryError(
          "read-error",
          "Legacy filter-library storage is unavailable",
        );
      }
      return legacy.map((preset, index) => {
        const extended = preset as Partial<StudioFilterLibraryPreset>;
        return normalizeStudioFilterLibraryPreset({
          ...preset,
          category: extended.category ?? FILTER_LIBRARY_DEFAULT_CATEGORY,
          favorite: extended.favorite ?? false,
          sortOrder: extended.sortOrder ?? index,
          packageVersion: extended.packageVersion ?? "legacy",
          packageFingerprint: extended.packageFingerprint ?? "legacy",
        });
      });
    },
    write(presets) {
      if (!storage) {
        throw new FilterLibraryRepositoryError(
          "write-error",
          "Legacy filter-library storage is unavailable",
        );
      }
      writeStorage(storage, storageKey, presets);
    },
  });
}

interface LegacyMigrationMarker {
  version: typeof FILTER_LIBRARY_LEGACY_MIGRATION_VERSION;
  sourceCount: number;
  insertedCount: number;
  completedAt: number;
}

function parseMigrationMarker(raw: string): LegacyMigrationMarker {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new FilterLibraryRepositoryError(
      "corrupt",
      "Filter-library migration marker contains invalid JSON",
      error,
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new FilterLibraryRepositoryError(
      "corrupt",
      "Filter-library migration marker has an invalid shape",
    );
  }
  const marker = parsed as Partial<LegacyMigrationMarker>;
  if (
    marker.version !== FILTER_LIBRARY_LEGACY_MIGRATION_VERSION
    || !Number.isSafeInteger(marker.sourceCount)
    || (marker.sourceCount ?? -1) < 0
    || !Number.isSafeInteger(marker.insertedCount)
    || (marker.insertedCount ?? -1) < 0
    || !Number.isSafeInteger(marker.completedAt)
    || (marker.completedAt ?? -1) < 0
  ) {
    throw new FilterLibraryRepositoryError(
      "corrupt",
      "Filter-library migration marker has an invalid shape",
    );
  }
  return marker as LegacyMigrationMarker;
}

/**
 * Explicit recovery/import tool only. Product startup never calls this function.
 * The literal opt-in makes accidental legacy resurrection visible at every call site.
 */
export async function importLegacyFilterLibraryToSqlite(
  database: StudioLocalDatabase,
  storage: Pick<StudioCreatorPackStorage, "getItem"> | null | undefined,
  options: { readonly explicit: true; readonly now?: () => number },
): Promise<LegacyFilterLibraryMigrationResult> {
  if (options.explicit !== true) {
    throw new Error("Legacy filter import requires explicit: true");
  }
  const markerRaw = await database.kvGet(
    FILTER_LIBRARY_LEGACY_MIGRATION_NAMESPACE,
    FILTER_LIBRARY_LEGACY_MIGRATION_KEY,
  );
  if (markerRaw !== null) {
    const marker = parseMigrationMarker(markerRaw);
    return {
      status: "already-complete",
      sourceCount: marker.sourceCount,
      insertedCount: marker.insertedCount,
    };
  }
  const legacy = strictStorageRead(storage, STUDIO_CREATOR_FILTER_PRESET_LIBRARY_KEY);
  if (legacy === null) {
    return { status: "source-unavailable", sourceCount: 0, insertedCount: 0 };
  }
  const sql = requireStudioFilterLibraryDatabase(database);
  const records = legacy.map((preset, index) =>
    studioFilterPresetToSqlRecord(legacyFilterPresetToLibraryPreset(preset, index)),
  );
  const insertedCount = await sql.insertMissingFilterLibraryRecords(records);
  const marker: LegacyMigrationMarker = {
    version: FILTER_LIBRARY_LEGACY_MIGRATION_VERSION,
    sourceCount: legacy.length,
    insertedCount,
    completedAt: (options.now ?? Date.now)(),
  };
  await database.kvSet(
    FILTER_LIBRARY_LEGACY_MIGRATION_NAMESPACE,
    FILTER_LIBRARY_LEGACY_MIGRATION_KEY,
    canonicalJson(marker),
  );
  return {
    status: legacy.length === 0 ? "empty" : "imported",
    sourceCount: legacy.length,
    insertedCount,
  };
}

export async function openProductFilterLibraryRepository(
  options: OpenProductFilterLibraryRepositoryOptions = {},
): Promise<ProductFilterLibraryRepository> {
  let database: StudioLocalDatabase;
  try {
    database = await (options.acquireDatabase ?? acquireStudioLocalDatabase)();
  } catch (error) {
    if (!(error instanceof SqliteUnavailableError)) throw error;
    const memory = createMemorySessionFilterLibraryProduct();
    return {
      authority: "memory-session",
      repository: memory.repository,
      legacyDataPolicy: STUDIO_FILTER_LIBRARY_DATA_POLICY,
      compareAndRestoreInstallSnapshot: memory.compareAndRestoreInstallSnapshot,
    };
  }
  const sql = requireStudioFilterLibraryDatabase(database);
  return {
    authority: "sqlite",
    repository: createSqliteFilterLibraryRepository(database),
    legacyDataPolicy: STUDIO_FILTER_LIBRARY_DATA_POLICY,
    compareAndRestoreInstallSnapshot: (entries) =>
      sql.compareAndRestoreFilterLibraryRecords(entries.map((entry) => ({
        id: entry.id,
        expected: studioFilterPresetToSqlRecord(entry.expected),
        restore: entry.restore === null ? null : studioFilterPresetToSqlRecord(entry.restore),
      }))),
    insertMissingInstallSnapshot: (presets) =>
      sql.insertMissingFilterLibraryRecords(
        presets.map(studioFilterPresetToSqlRecord),
      ),
  };
}

let sharedProductRepository: Promise<ProductFilterLibraryRepository> | null = null;

/** 앱 수명 동안 공유 OPFS SQLite handle과 같은 필터 repository를 재사용한다. */
export function acquireProductFilterLibraryRepository(): Promise<ProductFilterLibraryRepository> {
  sharedProductRepository ??= openProductFilterLibraryRepository();
  return sharedProductRepository;
}

/** 테스트·명시적 세션 재시도 경계. 공유 DB handle 자체는 닫지 않는다. */
export function resetProductFilterLibraryRepositoryRuntime(): void {
  sharedProductRepository = null;
}

const changeListeners = new Set<() => void>();

export function subscribeStudioFilterLibraryChanges(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

export function notifyStudioFilterLibraryChanged(): void {
  for (const listener of changeListeners) listener();
}

/** 모든 행을 bounded keyset 페이지로 읽되 전체 개수에는 상한을 두지 않는다. */
export async function readAllFilterPresetsFromRepository(
  repository: StudioFilterLibraryRepository,
  query: Omit<StudioFilterLibraryQuery, "cursor" | "limit"> = {},
  pageSize = 256,
): Promise<StudioFilterLibraryPreset[]> {
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0) {
    throw new RangeError("Filter library read page size must be a positive safe integer");
  }
  const presets: StudioFilterLibraryPreset[] = [];
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let cursor: StudioFilterLibrarySqlCursor | null = null;
  let hasMore = true;
  while (hasMore) {
    const page = await repository.query({ ...query, cursor, limit: pageSize });
    for (const preset of page.items) {
      if (ids.has(preset.id)) {
        throw new FilterLibraryRepositoryError(
          "corrupt",
          `Filter repository repeated id ${preset.id} across pages`,
        );
      }
      ids.add(preset.id);
      presets.push(preset);
    }
    hasMore = page.hasMore;
    if (!hasMore) break;
    if (page.nextCursor === null) {
      throw new FilterLibraryRepositoryError(
        "corrupt",
        "Filter repository returned a missing page cursor",
      );
    }
    const cursorKey = canonicalJson(page.nextCursor);
    if (cursors.has(cursorKey)) {
      throw new FilterLibraryRepositoryError(
        "corrupt",
        "Filter repository returned a cyclic page cursor",
      );
    }
    cursors.add(cursorKey);
    cursor = page.nextCursor;
  }
  return presets;
}
