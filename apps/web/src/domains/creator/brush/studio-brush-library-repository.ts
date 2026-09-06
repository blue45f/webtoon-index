/**
 * Async, paged authority boundary for the unlimited Studio brush library.
 *
 * The legacy localStorage adapter at the bottom preserves existing deployments, but consumers only
 * receive one page. The product SQLite/OPFS implementation lives in
 * studio-brush-library-sqlite-repository.ts and pushes the same search/category/keyset cursor into
 * SQL. No count limit is part of this contract; `limit` is a page size only.
 */

import {
  BRUSH_LIBRARY_CAPACITY,
  browserBrushLibraryStorage,
  brushActivityAt,
  compareBrushesForLibrary,
  deleteBrushWithRecord,
  duplicateBrush,
  readBrushLibrary,
  restoreDeletedBrush,
  saveBrushBatchWithResult,
  saveBrushWithResult,
  type BrushLibraryReadStatus,
  type BrushLibraryStorage,
  type DeletedBrushRecord,
  type StudioSavedBrush,
} from "./studio-brush-library";
import { STUDIO_BRUSH_RUNTIME_CONTRACT } from "./studio-brush-runtime-contract";

import type { StudioBrushRenderFamily } from "../studio-brush";

export const DEFAULT_BRUSH_LIBRARY_PAGE_SIZE = 64;
export const BRUSH_LIBRARY_CURSOR_VERSION = 1 as const;
const BRUSH_LIBRARY_CURSOR_PREFIX = "toonspectrum-brush-page-v1:";

export type BrushLibraryCategory = StudioBrushRenderFamily | "all";

export interface BrushLibraryPageRequest {
  /** Opaque keyset cursor returned by the previous page. */
  readonly cursor?: string | null;
  /** Page size, not a library capacity. Any positive safe integer is accepted. */
  readonly limit?: number;
  /** Unicode-normalized, case-insensitive match over identity, name, source preset and family. */
  readonly search?: string;
  readonly category?: BrushLibraryCategory;
  readonly pinned?: boolean;
}

export interface BrushLibraryPage {
  readonly items: readonly StudioSavedBrush[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  /** Optional for database adapters where an exact COUNT would be disproportionately expensive. */
  readonly totalCount?: number;
}

export interface BrushLibraryBatchWriteSummary {
  readonly savedCount: number;
  readonly skippedDuplicateCount: number;
}

export type BrushLibraryRepositoryErrorCode =
  | "unavailable"
  | "read-error"
  | "corrupt"
  | "unsupported-version"
  | "quota-exceeded"
  | "write-error"
  | "invalid-cursor";

export class BrushLibraryRepositoryError extends Error {
  readonly code: BrushLibraryRepositoryErrorCode;
  readonly detail: unknown;

  constructor(code: BrushLibraryRepositoryErrorCode, message: string, detail?: unknown) {
    super(message);
    this.name = "BrushLibraryRepositoryError";
    this.code = code;
    this.detail = detail;
  }
}

/**
 * SQLite-ready authority port. Implementations must preserve the documented order and cursor
 * semantics and should fetch at most `limit + 1` rows. Mutations are async because the product
 * authority commits them through SQLite transactions.
 */
export interface BrushLibraryRepositoryPort {
  readonly capacity: typeof BRUSH_LIBRARY_CAPACITY;
  query(request?: BrushLibraryPageRequest): Promise<BrushLibraryPage>;
  getById(id: string): Promise<StudioSavedBrush | null>;
  put(brush: StudioSavedBrush): Promise<StudioSavedBrush>;
  putMany(brushes: readonly StudioSavedBrush[]): Promise<BrushLibraryBatchWriteSummary>;
  delete(id: string): Promise<DeletedBrushRecord | null>;
  restore(deleted: DeletedBrushRecord): Promise<StudioSavedBrush>;
  duplicate(id: string): Promise<StudioSavedBrush | null>;
}

/** Decoded keyset position supplied to a SQLite-ready adapter. */
export interface BrushLibraryCursorPosition {
  readonly pinned: boolean;
  readonly activityAt: number;
  readonly createdAt: number;
  readonly id: string;
}

export interface BrushLibraryAdapterQuery {
  readonly limit: number;
  readonly search: string;
  readonly category: BrushLibraryCategory;
  readonly pinned: boolean | null;
  readonly after: BrushLibraryCursorPosition | null;
}

export interface BrushLibraryAdapterPage {
  readonly items: readonly StudioSavedBrush[];
  readonly hasMore: boolean;
  readonly totalCount?: number;
}

/**
 * Storage adapter seam. A SQLite implementation receives the decoded keyset and can map it to a
 * WHERE tuple plus ORDER BY/LIMIT without knowing the opaque public cursor encoding.
 */
export interface BrushLibraryRepositoryAdapter {
  query(input: BrushLibraryAdapterQuery): Promise<BrushLibraryAdapterPage>;
  getById(id: string): Promise<StudioSavedBrush | null>;
  put(brush: StudioSavedBrush): Promise<StudioSavedBrush>;
  putMany(brushes: readonly StudioSavedBrush[]): Promise<BrushLibraryBatchWriteSummary>;
  delete(id: string): Promise<DeletedBrushRecord | null>;
  restore(deleted: DeletedBrushRecord): Promise<StudioSavedBrush>;
  duplicate(id: string): Promise<StudioSavedBrush | null>;
}

interface NormalizedBrushLibraryPageRequest {
  readonly cursor: string | null;
  readonly limit: number;
  readonly search: string;
  readonly category: BrushLibraryCategory;
  readonly pinned: boolean | null;
  readonly queryKey: string;
}

interface BrushLibraryCursorPayload {
  readonly version: typeof BRUSH_LIBRARY_CURSOR_VERSION;
  readonly queryKey: string;
  readonly pinned: 0 | 1;
  readonly activityAt: number;
  readonly createdAt: number;
  readonly id: string;
}

const BRUSH_LIBRARY_CATEGORIES = new Set<StudioBrushRenderFamily>(
  STUDIO_BRUSH_RUNTIME_CONTRACT.map((contract) => contract.family)
);
const BRUSH_LIBRARY_FAMILY_BY_ID = new Map<string, StudioBrushRenderFamily>(
  STUDIO_BRUSH_RUNTIME_CONTRACT.map((contract) => [contract.id, contract.family] as const)
);

function normalizeSearch(value: string | undefined): string {
  return (value ?? "").normalize("NFKC").trim().toLowerCase();
}

function normalizePageRequest(
  request: BrushLibraryPageRequest = {}
): NormalizedBrushLibraryPageRequest {
  const limit = request.limit ?? DEFAULT_BRUSH_LIBRARY_PAGE_SIZE;
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new RangeError("Brush library page limit must be a positive safe integer");
  }
  const category = request.category ?? "all";
  if (category !== "all" && !BRUSH_LIBRARY_CATEGORIES.has(category)) {
    throw new RangeError(`Unsupported brush library category: ${String(category)}`);
  }
  const search = normalizeSearch(request.search);
  const pinned = typeof request.pinned === "boolean" ? request.pinned : null;
  const queryKey = JSON.stringify([search, category, pinned]);
  return {
    cursor: request.cursor ?? null,
    limit,
    search,
    category,
    pinned,
    queryKey,
  };
}

function encodeCursor(
  brush: StudioSavedBrush,
  queryKey: string
): string {
  const payload: BrushLibraryCursorPayload = {
    version: BRUSH_LIBRARY_CURSOR_VERSION,
    queryKey,
    pinned: brush.pinned ? 1 : 0,
    activityAt: brushActivityAt(brush),
    createdAt: brush.createdAt,
    id: brush.id,
  };
  return `${BRUSH_LIBRARY_CURSOR_PREFIX}${encodeURIComponent(JSON.stringify(payload))}`;
}

function decodeCursor(
  cursor: string,
  expectedQueryKey: string
): BrushLibraryCursorPayload {
  try {
    if (!cursor.startsWith(BRUSH_LIBRARY_CURSOR_PREFIX)) throw new Error("prefix");
    const parsed = JSON.parse(
      decodeURIComponent(cursor.slice(BRUSH_LIBRARY_CURSOR_PREFIX.length))
    ) as Partial<BrushLibraryCursorPayload>;
    if (
      parsed.version !== BRUSH_LIBRARY_CURSOR_VERSION
      || parsed.queryKey !== expectedQueryKey
      || (parsed.pinned !== 0 && parsed.pinned !== 1)
      || typeof parsed.activityAt !== "number"
      || !Number.isFinite(parsed.activityAt)
      || typeof parsed.createdAt !== "number"
      || !Number.isFinite(parsed.createdAt)
      || typeof parsed.id !== "string"
      || parsed.id.length === 0
    ) {
      throw new Error("shape");
    }
    return parsed as BrushLibraryCursorPayload;
  } catch (error) {
    throw new BrushLibraryRepositoryError(
      "invalid-cursor",
      "Brush library cursor is malformed or belongs to a different query",
      error
    );
  }
}

function compareBrushToCursor(
  brush: StudioSavedBrush,
  cursor: Pick<BrushLibraryCursorPayload, "pinned" | "activityAt" | "createdAt" | "id">
): number {
  return cursor.pinned - Number(brush.pinned)
    || cursor.activityAt - brushActivityAt(brush)
    || cursor.createdAt - brush.createdAt
    || (brush.id < cursor.id ? -1 : brush.id > cursor.id ? 1 : 0);
}

function cursorPosition(cursor: BrushLibraryCursorPayload): BrushLibraryCursorPosition {
  return {
    pinned: cursor.pinned === 1,
    activityAt: cursor.activityAt,
    createdAt: cursor.createdAt,
    id: cursor.id,
  };
}

function brushSearchText(brush: StudioSavedBrush): string {
  const family = BRUSH_LIBRARY_FAMILY_BY_ID.get(brush.brushId) ?? "pen";
  return normalizeSearch([
    brush.id,
    brush.name,
    brush.brushId,
    brush.sourcePresetId ?? "",
    brush.sourcePresetName ?? "",
    family,
  ].join("\u0000"));
}

function matchesPageRequest(
  brush: StudioSavedBrush,
  request: NormalizedBrushLibraryPageRequest
): boolean {
  const family = BRUSH_LIBRARY_FAMILY_BY_ID.get(brush.brushId) ?? "pen";
  if (request.category !== "all" && family !== request.category) return false;
  if (request.pinned !== null && brush.pinned !== request.pinned) return false;
  return request.search.length === 0 || brushSearchText(brush).includes(request.search);
}

/**
 * Compatibility/in-memory query implementation. It returns only a page to the consumer. SQLite
 * adapters should reproduce this predicate and order in SQL rather than calling this function.
 */
export function queryBrushLibraryPage(
  brushes: readonly StudioSavedBrush[],
  request: BrushLibraryPageRequest = {}
): BrushLibraryPage {
  const normalized = normalizePageRequest(request);
  const cursor = normalized.cursor
    ? decodeCursor(normalized.cursor, normalized.queryKey)
    : null;
  const ordered = brushes
    .filter((brush) => matchesPageRequest(brush, normalized))
    .sort(compareBrushesForLibrary);
  let start = 0;
  if (cursor) {
    while (start < ordered.length && compareBrushToCursor(ordered[start], cursor) <= 0) {
      start += 1;
    }
  }
  const end = Math.min(ordered.length, start + normalized.limit);
  const items = ordered.slice(start, end);
  const hasMore = end < ordered.length;
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(last, normalized.queryKey) : null,
    hasMore,
    totalCount: ordered.length,
  };
}

function invalidAdapterPage(message: string): BrushLibraryRepositoryError {
  return new BrushLibraryRepositoryError("corrupt", message);
}

/**
 * Wraps a SQLite/OPFS adapter with public request validation and opaque cursor handling. This is the
 * preferred authority constructor; the localStorage constructor below exists only for migration.
 */
export function createBrushLibraryRepository(
  adapter: BrushLibraryRepositoryAdapter
): BrushLibraryRepositoryPort {
  return {
    capacity: BRUSH_LIBRARY_CAPACITY,

    async query(request = {}) {
      const normalized = normalizePageRequest(request);
      const decoded = normalized.cursor
        ? decodeCursor(normalized.cursor, normalized.queryKey)
        : null;
      const page = await adapter.query({
        limit: normalized.limit,
        search: normalized.search,
        category: normalized.category,
        pinned: normalized.pinned,
        after: decoded ? cursorPosition(decoded) : null,
      });
      if (page.items.length > normalized.limit) {
        throw invalidAdapterPage("Brush library adapter returned more than the requested page size");
      }
      if (!brushLibraryPageIsDeterministic(page.items)) {
        throw invalidAdapterPage("Brush library adapter returned duplicate or non-deterministic rows");
      }
      if (page.items.some((brush) => !matchesPageRequest(brush, normalized))) {
        throw invalidAdapterPage("Brush library adapter returned a row outside the requested filters");
      }
      if (
        decoded
        && page.items.some((brush) => compareBrushToCursor(brush, decoded) <= 0)
      ) {
        throw invalidAdapterPage("Brush library adapter returned a row before its keyset cursor");
      }
      if (page.hasMore && page.items.length === 0) {
        throw invalidAdapterPage("Brush library adapter reported more rows after an empty page");
      }
      if (
        page.totalCount !== undefined
        && (!Number.isSafeInteger(page.totalCount) || page.totalCount < page.items.length)
      ) {
        throw invalidAdapterPage("Brush library adapter returned an invalid total count");
      }
      const last = page.items.at(-1);
      return {
        items: page.items,
        nextCursor: page.hasMore && last ? encodeCursor(last, normalized.queryKey) : null,
        hasMore: page.hasMore,
        ...(page.totalCount === undefined ? {} : { totalCount: page.totalCount }),
      };
    },

    getById: (id) => adapter.getById(id),
    put: (brush) => adapter.put(brush),
    putMany: (brushes) => adapter.putMany(brushes),
    delete: (id) => adapter.delete(id),
    restore: (deleted) => adapter.restore(deleted),
    duplicate: (id) => adapter.duplicate(id),
  };
}

function readErrorCode(status: BrushLibraryReadStatus): BrushLibraryRepositoryErrorCode {
  if (status === "unavailable") return "unavailable";
  if (status === "read-error") return "read-error";
  if (status === "unsupported-version") return "unsupported-version";
  return "corrupt";
}

function assertReadable(status: BrushLibraryReadStatus): void {
  if (status === "ok" || status === "empty") return;
  const code = readErrorCode(status);
  throw new BrushLibraryRepositoryError(
    code,
    `Brush library cannot be read safely (${status})`
  );
}

function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return candidate.name === "QuotaExceededError"
    || candidate.name === "NS_ERROR_DOM_QUOTA_REACHED"
    || candidate.code === 22
    || candidate.code === 1014;
}

function writeError(error: unknown): BrushLibraryRepositoryError {
  return isQuotaError(error)
    ? new BrushLibraryRepositoryError(
      "quota-exceeded",
      "Brush library storage quota was exceeded",
      error
    )
    : new BrushLibraryRepositoryError(
      "write-error",
      "Brush library write failed",
      error
    );
}

function trackedStorage(storage: BrushLibraryStorage | null | undefined): {
  readonly storage: BrushLibraryStorage | null;
  readonly writeFailure: () => unknown;
} {
  if (!storage) return { storage: null, writeFailure: () => undefined };
  let failure: unknown;
  return {
    storage: {
      getItem: (key) => storage.getItem(key),
      setItem: (key, value) => {
        try {
          storage.setItem(key, value);
        } catch (error) {
          failure = error;
          throw error;
        }
      },
    },
    writeFailure: () => failure,
  };
}

function throwMutationFailure(
  status: "storage-error" | "library-unreadable" | "full",
  storage: BrushLibraryStorage | null,
  failure: unknown
): never {
  if (status === "library-unreadable") {
    const read = readBrushLibrary(storage);
    assertReadable(read.status);
  }
  if (status === "full") {
    throw new BrushLibraryRepositoryError(
      "write-error",
      "A legacy adapter rejected an unlimited brush-library mutation"
    );
  }
  if (!storage) {
    throw new BrushLibraryRepositoryError("unavailable", "Brush library storage is unavailable");
  }
  throw writeError(failure);
}

/**
 * Transitional adapter for the v1 localStorage envelope. It keeps old callers operational while
 * exposing only async, paged results. SQLite migration code can replace this port without importing
 * or emulating localStorage.
 */
export function createStorageBrushLibraryRepository(
  storage: BrushLibraryStorage | null | undefined = browserBrushLibraryStorage()
): BrushLibraryRepositoryPort {
  return {
    capacity: BRUSH_LIBRARY_CAPACITY,

    async query(request = {}) {
      const read = readBrushLibrary(storage);
      assertReadable(read.status);
      return queryBrushLibraryPage(read.brushes, request);
    },

    async getById(id) {
      const read = readBrushLibrary(storage);
      assertReadable(read.status);
      return read.brushes.find((brush) => brush.id === id) ?? null;
    },

    async put(brush) {
      const tracked = trackedStorage(storage);
      const result = saveBrushWithResult(tracked.storage, brush);
      if (result.status !== "saved") {
        throwMutationFailure(
          result.status,
          tracked.storage,
          tracked.writeFailure()
        );
      }
      const saved = result.brushes.find((candidate) => candidate.id === brush.id);
      if (!saved) {
        throw new BrushLibraryRepositoryError(
          "write-error",
          "Brush library write completed without the requested brush"
        );
      }
      return saved;
    },

    async putMany(brushes) {
      const tracked = trackedStorage(storage);
      const result = saveBrushBatchWithResult(tracked.storage, brushes);
      if (result.status === "storage-error" || result.status === "library-unreadable" || result.status === "full") {
        throwMutationFailure(
          result.status,
          tracked.storage,
          tracked.writeFailure()
        );
      }
      return {
        savedCount: result.savedCount,
        skippedDuplicateCount: result.skippedCount,
      };
    },

    async delete(id) {
      const tracked = trackedStorage(storage);
      const result = deleteBrushWithRecord(tracked.storage, id);
      if (result.status === "storage-error" || result.status === "library-unreadable") {
        throwMutationFailure(
          result.status,
          tracked.storage,
          tracked.writeFailure()
        );
      }
      return result.deleted;
    },

    async restore(deleted) {
      const tracked = trackedStorage(storage);
      const result = restoreDeletedBrush(tracked.storage, deleted);
      if (result.status !== "restored") {
        throwMutationFailure(
          result.status,
          tracked.storage,
          tracked.writeFailure()
        );
      }
      return result.brushes.find((brush) => brush.id === deleted.brush.id) ?? deleted.brush;
    },

    async duplicate(id) {
      const tracked = trackedStorage(storage);
      const result = duplicateBrush(tracked.storage, id);
      if (result.status === "storage-error" || result.status === "library-unreadable" || result.status === "full") {
        throwMutationFailure(
          result.status,
          tracked.storage,
          tracked.writeFailure()
        );
      }
      return result.brush;
    },
  };
}

/** Verifies the total ordering contract a custom SQLite adapter must preserve. */
export function brushLibraryPageIsDeterministic(
  items: readonly StudioSavedBrush[]
): boolean {
  const ids = new Set<string>();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (ids.has(item.id)) return false;
    ids.add(item.id);
    if (index > 0 && compareBrushesForLibrary(items[index - 1], item) > 0) return false;
  }
  return true;
}
