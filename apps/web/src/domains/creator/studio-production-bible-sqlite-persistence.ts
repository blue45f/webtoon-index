/**
 * Shared V12 SQLite/OPFS authority for Production Bible metadata.
 *
 * The KV row contains one bounded, strict, canonical JSON document. `kvSet` is a single SQLite
 * upsert, so readers observe either the previous complete document or the next complete document.
 * Per-document write queues preserve invocation order when UI edits overlap asynchronously.
 */

import { acquireStudioLocalDatabase } from "./studio-local-database-runtime";
import {
  createEmptyStudioProductionBible,
  normalizeStudioProductionBible,
  normalizeStudioProductionBibleStorageKey,
  serializeStudioProductionBible,
  STUDIO_PRODUCTION_BIBLE_MAX_IMPORT_BYTES,
  StudioProductionBibleSchema,
  type StudioProductionBible,
  type StudioProductionBiblePersistenceResult,
  type StudioProductionBibleRepository,
} from "./studio-production-bible";

import type { StudioLocalDatabase } from "./studio-local-database";

export const STUDIO_PRODUCTION_BIBLE_SQLITE_NAMESPACE =
  "studio-production-bible-v12";

export interface StudioProductionBibleSqlitePersistenceOptions {
  readonly acquireDatabase?: () => Promise<StudioLocalDatabase>;
}

type CanonicalDecodeResult =
  | { readonly ok: true; readonly bible: StudioProductionBible }
  | { readonly ok: false; readonly error: string };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** Strict V12 SQLite rows do not accept legacy containers, unknown fields, or non-canonical JSON. */
export function decodeCanonicalStudioProductionBible(
  serialized: string
): CanonicalDecodeResult {
  if (byteLength(serialized) > STUDIO_PRODUCTION_BIBLE_MAX_IMPORT_BYTES) {
    return {
      ok: false,
      error: `SQLite 바이블 문서가 ${Math.floor(
        STUDIO_PRODUCTION_BIBLE_MAX_IMPORT_BYTES / 1024 / 1024
      )}MB 한도를 초과했습니다.`,
    };
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(serialized) as unknown;
  } catch {
    return { ok: false, error: "SQLite 바이블 JSON이 손상되었습니다." };
  }

  const validated = StudioProductionBibleSchema.safeParse(decoded);
  if (!validated.success) {
    return { ok: false, error: "SQLite 바이블 문서가 V12 스키마를 통과하지 못했습니다." };
  }

  const bible = normalizeStudioProductionBible(validated.data);
  if (serializeStudioProductionBible(bible) !== serialized) {
    return {
      ok: false,
      error: "SQLite 바이블 문서가 정규 필드·항목 순서의 canonical JSON이 아닙니다.",
    };
  }
  return { ok: true, bible };
}

function memoryResult(
  bible: StudioProductionBible,
  warning: string
): StudioProductionBiblePersistenceResult {
  return {
    bible,
    backend: "memory",
    persisted: false,
    localOnly: true,
    warning,
  };
}

function unavailableResult(warning: string): StudioProductionBiblePersistenceResult {
  return {
    bible: createEmptyStudioProductionBible(),
    backend: "unavailable",
    persisted: false,
    localOnly: true,
    warning,
  };
}

/**
 * Creates a repository over the app-lifetime shared database handle. It never probes IndexedDB or
 * localStorage and never imports pre-V12 data. SQLite failures retain only an explicitly labelled
 * in-session memory recovery value; corrupt rows fail closed instead of being normalized to empty.
 */
export function createStudioProductionBibleSqlitePersistence(
  options: StudioProductionBibleSqlitePersistenceOptions = {}
): StudioProductionBibleRepository {
  const acquireDatabase = options.acquireDatabase ?? acquireStudioLocalDatabase;
  const memory = new Map<string, StudioProductionBible>();
  const writeTails = new Map<string, Promise<void>>();

  function enqueueWrite(key: string, operation: () => Promise<void>): Promise<void> {
    const previous = writeTails.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    writeTails.set(key, current);
    const retire = () => {
      if (writeTails.get(key) === current) writeTails.delete(key);
    };
    void current.then(retire, retire);
    return current;
  }

  return {
    async load(key) {
      const normalizedKey = normalizeStudioProductionBibleStorageKey(key);
      if (!normalizedKey) {
        return memoryResult(
          createEmptyStudioProductionBible(),
          "저장 키가 없어 이 세션의 메모리에서만 바이블을 유지합니다."
        );
      }

      try {
        await writeTails.get(normalizedKey);
        const database = await acquireDatabase();
        const serialized = await database.kvGet(
          STUDIO_PRODUCTION_BIBLE_SQLITE_NAMESPACE,
          normalizedKey
        );
        if (serialized === null) {
          const bible = createEmptyStudioProductionBible();
          memory.set(normalizedKey, bible);
          return {
            bible,
            backend: "sqlite",
            persisted: false,
            localOnly: true,
          };
        }

        const decoded = decodeCanonicalStudioProductionBible(serialized);
        if (!decoded.ok) {
          return unavailableResult(decoded.error);
        }
        memory.set(normalizedKey, decoded.bible);
        return {
          bible: decoded.bible,
          backend: "sqlite",
          persisted: true,
          localOnly: true,
        };
      } catch (error) {
        const recovered = memory.get(normalizedKey);
        if (recovered) {
          return memoryResult(
            recovered,
            `SQLite/OPFS 읽기를 완료하지 못해 이 세션의 마지막 정상본을 사용합니다: ${errorText(
              error
            )}`
          );
        }
        return unavailableResult(
          `SQLite/OPFS 바이블 저장소를 열지 못했습니다: ${errorText(error)}`
        );
      }
    },

    async save(key, value) {
      const normalizedKey = normalizeStudioProductionBibleStorageKey(key);
      const bible = normalizeStudioProductionBible(value);
      const serialized = serializeStudioProductionBible(bible);
      if (!normalizedKey) {
        return memoryResult(
          bible,
          "저장 키가 없어 이 세션의 메모리에서만 바이블을 유지합니다."
        );
      }

      memory.set(normalizedKey, bible);
      try {
        await enqueueWrite(normalizedKey, async () => {
          const database = await acquireDatabase();
          await database.kvSet(
            STUDIO_PRODUCTION_BIBLE_SQLITE_NAMESPACE,
            normalizedKey,
            serialized
          );
        });
        return {
          bible,
          backend: "sqlite",
          persisted: true,
          localOnly: true,
        };
      } catch (error) {
        return memoryResult(
          bible,
          `SQLite/OPFS 저장에 실패했습니다. 변경은 이 세션 메모리에만 남습니다: ${errorText(
            error
          )}`
        );
      }
    },
  };
}
