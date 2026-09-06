/**
 * Shared V12 SQLite/OPFS authority for the dialogue translation memory.
 *
 * The interchange document remains engine-neutral TM v1. This adapter only changes the product
 * storage authority. It deliberately never probes the former localStorage key: importing that
 * data requires an explicit host-provided Storage seam or a user-selected JSON document.
 */

import { acquireStudioLocalDatabase } from "./studio-local-database-runtime";
import {
  exportStudioTranslationMemory,
  importStudioTranslationMemory,
  type StudioTranslationMemoryEntry,
  type StudioTranslationMemoryLoadResult,
  type StudioTranslationMemorySaveResult,
} from "./studio-translation-memory";

import type { StudioLocalDatabase } from "./studio-local-database";

export const STUDIO_TRANSLATION_MEMORY_SQLITE_NAMESPACE =
  "studio-translation-memory-v12";
export const STUDIO_TRANSLATION_MEMORY_SQLITE_KEY = "library-v1";

export interface StudioTranslationMemoryPersistence {
  load(): Promise<StudioTranslationMemoryLoadResult>;
  save(
    entries: readonly StudioTranslationMemoryEntry[],
  ): Promise<StudioTranslationMemorySaveResult>;
}

export interface StudioTranslationMemorySqlitePersistenceOptions {
  readonly acquireDatabase?: () => Promise<StudioLocalDatabase>;
}

function sqliteFailure(
  error: unknown,
  operation: "읽기" | "저장",
): string {
  return `SQLite 번역 메모리 ${operation}를 완료하지 못했습니다: ${
    error instanceof Error ? error.message : String(error)
  }`;
}

export function createStudioTranslationMemorySqlitePersistence(
  options: StudioTranslationMemorySqlitePersistenceOptions = {},
): StudioTranslationMemoryPersistence {
  const acquireDatabase = options.acquireDatabase ?? acquireStudioLocalDatabase;
  let saveTail: Promise<void> = Promise.resolve();

  return {
    async load() {
      try {
        const database = await acquireDatabase();
        const raw = await database.kvGet(
          STUDIO_TRANSLATION_MEMORY_SQLITE_NAMESPACE,
          STUDIO_TRANSLATION_MEMORY_SQLITE_KEY,
        );
        if (raw === null) return { entries: [], status: "empty" };
        const imported = importStudioTranslationMemory(raw);
        if (!imported.ok) {
          return { entries: [], status: "invalid", error: imported.error };
        }
        if (
          imported.rejected > 0
          || imported.duplicates > 0
          || imported.truncated > 0
        ) {
          return {
            entries: [],
            status: "invalid",
            error:
              "SQLite 번역 메모리에 유효하지 않거나 중복된 항목이 있어 전체 로드를 중단했습니다.",
          };
        }
        return { entries: imported.entries, status: "ok" };
      } catch (error) {
        return {
          entries: [],
          status: "unavailable",
          error: sqliteFailure(error, "읽기"),
        };
      }
    },

    save(entries) {
      const exported = exportStudioTranslationMemory(entries);
      if (!exported.ok) return Promise.resolve(exported);

      const write = saveTail.then(async (): Promise<StudioTranslationMemorySaveResult> => {
        try {
          const database = await acquireDatabase();
          await database.kvSet(
            STUDIO_TRANSLATION_MEMORY_SQLITE_NAMESPACE,
            STUDIO_TRANSLATION_MEMORY_SQLITE_KEY,
            exported.json,
          );
          return { ok: true };
        } catch (error) {
          return { ok: false, error: sqliteFailure(error, "저장") };
        }
      });
      saveTail = write.then(
        () => undefined,
        () => undefined,
      );
      return write;
    },
  };
}
