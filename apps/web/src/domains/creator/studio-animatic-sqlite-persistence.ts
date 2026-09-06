/**
 * SQLite/OPFS authority for animatic edit-decision metadata.
 *
 * V12 deliberately does not read the former localStorage v1 namespace. Explicit `storage` props
 * in StudioAnimaticTimelinePanel remain a test/embed seam; the product default enters here and
 * stores only validated JSON in the shared V12 database.
 */

import {
  exportStudioAnimaticDocument,
  importStudioAnimaticDocument,
  studioAnimaticStorageKey,
  type StudioAnimaticDocument,
  type StudioAnimaticLoadResult,
  type StudioAnimaticSaveResult,
} from "./studio-animatic-timeline";
import { acquireStudioLocalDatabase } from "./studio-local-database-runtime";

import type { StudioLocalDatabase } from "./studio-local-database";

export const STUDIO_ANIMATIC_SQLITE_NAMESPACE = "studio-animatic-v12";

export interface StudioAnimaticPersistencePort {
  load(workScope: string): Promise<StudioAnimaticLoadResult>;
  save(document: StudioAnimaticDocument): Promise<StudioAnimaticSaveResult>;
}

export interface StudioAnimaticSqlitePersistenceOptions {
  readonly acquireDatabase?: () => Promise<StudioLocalDatabase>;
}

function unavailable(error: unknown, operation: "읽기" | "저장"): StudioAnimaticLoadResult {
  return {
    document: null,
    status: "unavailable",
    error: `SQLite 애니매틱 ${operation}를 완료하지 못했습니다: ${
      error instanceof Error ? error.message : String(error)
    }`,
  };
}

export function createStudioAnimaticSqlitePersistence(
  options: StudioAnimaticSqlitePersistenceOptions = {},
): StudioAnimaticPersistencePort {
  const acquireDatabase = options.acquireDatabase ?? acquireStudioLocalDatabase;
  return {
    async load(workScope) {
      try {
        const database = await acquireDatabase();
        const raw = await database.kvGet(
          STUDIO_ANIMATIC_SQLITE_NAMESPACE,
          studioAnimaticStorageKey(workScope),
        );
        if (raw === null) return { document: null, status: "empty" };
        const imported = importStudioAnimaticDocument(raw);
        if (!imported.ok) {
          return { document: null, status: "invalid", error: imported.error };
        }
        if (
          studioAnimaticStorageKey(imported.document.workScope)
          !== studioAnimaticStorageKey(workScope)
        ) {
          return {
            document: null,
            status: "invalid",
            error: "다른 작품 범위의 애니매틱 문서입니다.",
          };
        }
        return { document: imported.document, status: "ok" };
      } catch (error) {
        return unavailable(error, "읽기");
      }
    },

    async save(document) {
      const exported = exportStudioAnimaticDocument(document);
      if (!exported.ok) return exported;
      try {
        const database = await acquireDatabase();
        await database.kvSet(
          STUDIO_ANIMATIC_SQLITE_NAMESPACE,
          studioAnimaticStorageKey(document.workScope),
          exported.json,
        );
        return { ok: true };
      } catch (error) {
        const result = unavailable(error, "저장");
        return { ok: false, error: result.error };
      }
    },
  };
}
