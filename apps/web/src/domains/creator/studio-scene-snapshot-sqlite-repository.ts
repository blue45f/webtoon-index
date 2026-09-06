/**
 * V12 SQLite/OPFS authority for user-authored scene snapshots.
 *
 * The former IndexedDB database remains an explicit legacy/test seam in
 * studio-scene-snapshot-library.ts. Product UI enters this repository and never probes or imports
 * that database. Records are immutable and an index switch is the authority commit: a crash before
 * the switch leaves only an unreachable orphan, while a crash after it always points at a complete
 * canonical record.
 */

import { acquireStudioLocalDatabase } from "./studio-local-database-runtime";
import {
  assertStudioSceneSnapshotLibraryBudget,
  cloneStudioSceneSnapshot,
  parseCanonicalStudioSceneSnapshot,
  serializeStudioSceneSnapshot,
  STUDIO_SCENE_SNAPSHOT_MAX_ENTRIES,
  STUDIO_SCENE_SNAPSHOT_MAX_NAME_LENGTH,
  STUDIO_SCENE_SNAPSHOT_TOTAL_MAX_BYTES,
  StudioSceneSnapshotLibraryError,
} from "./studio-scene-snapshot-library";

import type { StudioLocalDatabase } from "./studio-local-database";
import type { StudioSceneSnapshot } from "./studio-scene-snapshot-library";

export const STUDIO_SCENE_SNAPSHOT_SQLITE_NAMESPACE = "studio-scene-snapshots-v12";
export const STUDIO_SCENE_SNAPSHOT_SQLITE_INDEX_KEY = "index-v1";

interface SnapshotIndexReference {
  readonly id: string;
  readonly recordKey: string;
}

interface SnapshotIndexV1 {
  readonly version: 1;
  readonly records: readonly SnapshotIndexReference[];
}

export interface StudioSceneSnapshotSqliteRepository {
  readonly authority: "sqlite";
  list(): Promise<StudioSceneSnapshot[]>;
  save(snapshot: StudioSceneSnapshot): Promise<StudioSceneSnapshot[]>;
  duplicate(id: string): Promise<StudioSceneSnapshot[]>;
  delete(id: string): Promise<StudioSceneSnapshot[]>;
  subscribe(listener: () => void): () => void;
}

export interface StudioSceneSnapshotSqliteRepositoryOptions {
  readonly acquireDatabase?: () => Promise<StudioLocalDatabase>;
  readonly now?: () => number;
  readonly createId?: () => string;
}

function repositoryError(
  code: "corrupt-data" | "storage-unavailable" | "not-found",
  message: string,
  cause?: unknown,
): StudioSceneSnapshotLibraryError {
  return new StudioSceneSnapshotLibraryError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function isSafeIndexString(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return false;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) return false;
  }
  return true;
}

function serializeIndex(records: readonly SnapshotIndexReference[]): string {
  return JSON.stringify({ version: 1, records } satisfies SnapshotIndexV1);
}

function parseIndex(raw: string): SnapshotIndexReference[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw repositoryError("corrupt-data", "Scene snapshot SQLite index JSON is corrupt.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw repositoryError("corrupt-data", "Scene snapshot SQLite index is invalid.");
  }
  const record = parsed as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "records,version"
    || record.version !== 1
    || !Array.isArray(record.records)
    || record.records.length > STUDIO_SCENE_SNAPSHOT_MAX_ENTRIES
  ) {
    throw repositoryError("corrupt-data", "Scene snapshot SQLite index contract is invalid.");
  }
  const ids = new Set<string>();
  const keys = new Set<string>();
  const references = record.records.map((rawReference) => {
    if (!rawReference || typeof rawReference !== "object" || Array.isArray(rawReference)) {
      throw repositoryError("corrupt-data", "Scene snapshot SQLite index row is invalid.");
    }
    const reference = rawReference as Record<string, unknown>;
    if (
      Object.keys(reference).sort().join(",") !== "id,recordKey"
      || !isSafeIndexString(reference.id)
      || !isSafeIndexString(reference.recordKey)
      || ids.has(reference.id)
      || keys.has(reference.recordKey)
    ) {
      throw repositoryError("corrupt-data", "Scene snapshot SQLite index row is corrupt.");
    }
    ids.add(reference.id);
    keys.add(reference.recordKey);
    return { id: reference.id, recordKey: reference.recordKey };
  });
  if (serializeIndex(references) !== raw) {
    throw repositoryError("corrupt-data", "Scene snapshot SQLite index is non-canonical.");
  }
  return references;
}

function compareSnapshots(left: StudioSceneSnapshot, right: StudioSceneSnapshot): number {
  if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function sorted(entries: readonly StudioSceneSnapshot[]): StudioSceneSnapshot[] {
  return [...entries].sort(compareSnapshots);
}

function contentDigest(value: string): string {
  let fnv = 0x811c9dc5;
  let djb = 0x1505;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    fnv = Math.imul(fnv ^ code, 0x01000193) >>> 0;
    djb = (Math.imul(djb, 33) ^ code) >>> 0;
  }
  return `${fnv.toString(16).padStart(8, "0")}${djb.toString(16).padStart(8, "0")}`;
}

function recordKey(snapshot: StudioSceneSnapshot, serialized?: string): string {
  const canonical = serialized ?? serializeStudioSceneSnapshot(snapshot);
  return [
    "record",
    encodeURIComponent(snapshot.id),
    snapshot.version,
    snapshot.updatedAt,
    canonical.length,
    contentDigest(canonical),
  ].join(":");
}

function createSnapshotId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `scene-${crypto.randomUUID()}`;
  }
  return `scene-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function loadEntries(database: StudioLocalDatabase): Promise<{
  readonly entries: StudioSceneSnapshot[];
  readonly references: SnapshotIndexReference[];
}> {
  const rawIndex = await database.kvGet(
    STUDIO_SCENE_SNAPSHOT_SQLITE_NAMESPACE,
    STUDIO_SCENE_SNAPSHOT_SQLITE_INDEX_KEY,
  );
  if (rawIndex === null) return { entries: [], references: [] };
  const references = parseIndex(rawIndex);
  const entries = await Promise.all(references.map(async (reference) => {
    const raw = await database.kvGet(
      STUDIO_SCENE_SNAPSHOT_SQLITE_NAMESPACE,
      reference.recordKey,
    );
    if (raw === null) {
      throw repositoryError("corrupt-data", "Scene snapshot SQLite index points to a missing row.");
    }
    const snapshot = parseCanonicalStudioSceneSnapshot(raw);
    if (
      snapshot.id !== reference.id
      || recordKey(snapshot, raw) !== reference.recordKey
    ) {
      throw repositoryError("corrupt-data", "Scene snapshot SQLite index identity mismatch.");
    }
    return snapshot;
  }));
  const totalBytes = entries.reduce((total, entry) => total + entry.byteSize, 0);
  if (
    !Number.isSafeInteger(totalBytes)
    || totalBytes > STUDIO_SCENE_SNAPSHOT_TOTAL_MAX_BYTES
  ) {
    throw repositoryError("corrupt-data", "Scene snapshot SQLite library exceeds its budget.");
  }
  return { entries: sorted(entries), references };
}

function wrapStorageError(error: unknown, operation: string): never {
  if (error instanceof StudioSceneSnapshotLibraryError) throw error;
  throw repositoryError(
    "storage-unavailable",
    `Unable to ${operation} the V12 SQLite scene snapshot library.`,
    error,
  );
}

export function createStudioSceneSnapshotSqliteRepository(
  options: StudioSceneSnapshotSqliteRepositoryOptions = {},
): StudioSceneSnapshotSqliteRepository {
  const acquireDatabase = options.acquireDatabase ?? acquireStudioLocalDatabase;
  const now = options.now ?? Date.now;
  const createId = options.createId ?? createSnapshotId;
  const listeners = new Set<() => void>();
  let mutationTail: Promise<void> = Promise.resolve();

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = mutationTail.then(work, work);
    mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  async function database(): Promise<StudioLocalDatabase> {
    try {
      return await acquireDatabase();
    } catch (error) {
      wrapStorageError(error, "open");
    }
  }

  return {
    authority: "sqlite",

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async list() {
      await mutationTail;
      try {
        return (await loadEntries(await database())).entries;
      } catch (error) {
        wrapStorageError(error, "read");
      }
    },

    save(snapshot) {
      return enqueue(async () => {
        try {
          const canonical = parseCanonicalStudioSceneSnapshot(
            serializeStudioSceneSnapshot(snapshot),
          );
          const db = await database();
          const current = await loadEntries(db);
          assertStudioSceneSnapshotLibraryBudget(current.entries, canonical);
          const next = sorted([
            canonical,
            ...current.entries.filter((entry) => entry.id !== canonical.id),
          ]);
          const serialized = serializeStudioSceneSnapshot(canonical);
          const nextKey = recordKey(canonical, serialized);
          const previousReference = current.references.find((entry) => entry.id === canonical.id);
          await db.kvSet(
            STUDIO_SCENE_SNAPSHOT_SQLITE_NAMESPACE,
            nextKey,
            serialized,
          );
          await db.kvSet(
            STUDIO_SCENE_SNAPSHOT_SQLITE_NAMESPACE,
            STUDIO_SCENE_SNAPSHOT_SQLITE_INDEX_KEY,
            serializeIndex(next.map((entry) => ({ id: entry.id, recordKey: recordKey(entry) }))),
          );
          if (previousReference && previousReference.recordKey !== nextKey) {
            void db.kvDelete(
              STUDIO_SCENE_SNAPSHOT_SQLITE_NAMESPACE,
              previousReference.recordKey,
            ).catch(() => undefined);
          }
          notify();
          return next;
        } catch (error) {
          wrapStorageError(error, "save");
        }
      });
    },

    duplicate(id) {
      return enqueue(async () => {
        try {
          const db = await database();
          const current = await loadEntries(db);
          const source = current.entries.find((entry) => entry.id === id);
          if (!source) {
            throw repositoryError("not-found", "The scene snapshot was not found.");
          }
          const timestamp = now();
          const name = `${source.name} 복사본`
            .slice(0, STUDIO_SCENE_SNAPSHOT_MAX_NAME_LENGTH)
            .trim() || "장면 복사본";
          const duplicated = parseCanonicalStudioSceneSnapshot(
            serializeStudioSceneSnapshot({
              ...cloneStudioSceneSnapshot(source),
              id: createId(),
              name,
              version: source.version + 1,
              createdAt: timestamp,
              updatedAt: timestamp,
            }),
          );
          assertStudioSceneSnapshotLibraryBudget(current.entries, duplicated);
          const next = sorted([duplicated, ...current.entries]);
          const serialized = serializeStudioSceneSnapshot(duplicated);
          const nextKey = recordKey(duplicated, serialized);
          await db.kvSet(
            STUDIO_SCENE_SNAPSHOT_SQLITE_NAMESPACE,
            nextKey,
            serialized,
          );
          await db.kvSet(
            STUDIO_SCENE_SNAPSHOT_SQLITE_NAMESPACE,
            STUDIO_SCENE_SNAPSHOT_SQLITE_INDEX_KEY,
            serializeIndex(next.map((entry) => ({ id: entry.id, recordKey: recordKey(entry) }))),
          );
          notify();
          return next;
        } catch (error) {
          wrapStorageError(error, "duplicate");
        }
      });
    },

    delete(id) {
      return enqueue(async () => {
        try {
          const db = await database();
          const current = await loadEntries(db);
          const removed = current.references.find((entry) => entry.id === id);
          if (!removed) {
            throw repositoryError("not-found", "The scene snapshot was not found.");
          }
          const next = current.entries.filter((entry) => entry.id !== id);
          await db.kvSet(
            STUDIO_SCENE_SNAPSHOT_SQLITE_NAMESPACE,
            STUDIO_SCENE_SNAPSHOT_SQLITE_INDEX_KEY,
            serializeIndex(next.map((entry) => ({ id: entry.id, recordKey: recordKey(entry) }))),
          );
          void db.kvDelete(
            STUDIO_SCENE_SNAPSHOT_SQLITE_NAMESPACE,
            removed.recordKey,
          ).catch(() => undefined);
          notify();
          return next;
        } catch (error) {
          wrapStorageError(error, "delete");
        }
      });
    },
  };
}

let productRepository: StudioSceneSnapshotSqliteRepository | null = null;

export function getProductStudioSceneSnapshotSqliteRepository():
StudioSceneSnapshotSqliteRepository {
  productRepository ??= createStudioSceneSnapshotSqliteRepository();
  return productRepository;
}
