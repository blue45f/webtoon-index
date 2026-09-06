/** V12 SQLite/OPFS authority for reusable element clips. */

import {
  deleteSavedClipInMemory,
  parseCanonicalStudioSavedClipLibrary,
  serializeStudioSavedClipLibrary,
  StudioSavedClipLibraryError,
  upsertSavedClipInMemory,
} from "./studio-clips";
import { acquireStudioLocalDatabase } from "./studio-local-database-runtime";

import type { StudioClip } from "./studio-clips";
import type { StudioLocalDatabase } from "./studio-local-database";

export const STUDIO_SAVED_CLIP_SQLITE_NAMESPACE = "studio-saved-clips-v12";
export const STUDIO_SAVED_CLIP_SQLITE_KEY = "library-v1";

export type StudioSavedClipSqliteRepositoryErrorCode = "invalid" | "limit" | "unavailable";

export class StudioSavedClipSqliteRepositoryError extends Error {
  readonly code: StudioSavedClipSqliteRepositoryErrorCode;

  constructor(
    code: StudioSavedClipSqliteRepositoryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StudioSavedClipSqliteRepositoryError";
    this.code = code;
  }
}

export interface StudioSavedClipSqliteRepository {
  readonly authority: "sqlite";
  list(): Promise<StudioClip[]>;
  save(clip: StudioClip): Promise<StudioClip[]>;
  delete(id: string): Promise<StudioClip[]>;
  subscribe(listener: () => void): () => void;
}

export interface StudioSavedClipSqliteRepositoryOptions {
  readonly acquireDatabase?: () => Promise<StudioLocalDatabase>;
}

function repositoryError(error: unknown, operation: string): never {
  if (error instanceof StudioSavedClipSqliteRepositoryError) throw error;
  if (error instanceof StudioSavedClipLibraryError) {
    throw new StudioSavedClipSqliteRepositoryError(
      error.code === "library-too-large" ? "limit" : "invalid",
      `클립 SQLite ${operation} 데이터를 처리하지 못했습니다: ${error.message}`,
      { cause: error },
    );
  }
  throw new StudioSavedClipSqliteRepositoryError(
    "unavailable",
    `클립 SQLite ${operation}를 완료하지 못했습니다: ${
      error instanceof Error ? error.message : String(error)
    }`,
    { cause: error },
  );
}

async function readLibrary(database: StudioLocalDatabase): Promise<StudioClip[]> {
  const raw = await database.kvGet(STUDIO_SAVED_CLIP_SQLITE_NAMESPACE, STUDIO_SAVED_CLIP_SQLITE_KEY);
  return raw === null ? [] : parseCanonicalStudioSavedClipLibrary(raw);
}

export function createStudioSavedClipSqliteRepository(
  options: StudioSavedClipSqliteRepositoryOptions = {},
): StudioSavedClipSqliteRepository {
  const acquireDatabase = options.acquireDatabase ?? acquireStudioLocalDatabase;
  const listeners = new Set<() => void>();
  let mutationTail: Promise<void> = Promise.resolve();

  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = mutationTail.then(work, work);
    mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  async function open(): Promise<StudioLocalDatabase> {
    try {
      return await acquireDatabase();
    } catch (error) {
      repositoryError(error, "열기");
    }
  }

  function notify(): void {
    for (const listener of listeners) listener();
  }

  async function mutate(
    update: (items: readonly StudioClip[]) => StudioClip[],
  ): Promise<StudioClip[]> {
    const database = await open();
    const next = update(await readLibrary(database));
    await database.kvSet(
      STUDIO_SAVED_CLIP_SQLITE_NAMESPACE,
      STUDIO_SAVED_CLIP_SQLITE_KEY,
      serializeStudioSavedClipLibrary(next),
    );
    notify();
    return next;
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
        return await readLibrary(await open());
      } catch (error) {
        repositoryError(error, "읽기");
      }
    },

    save(clip) {
      return enqueue(async () => {
        try {
          return await mutate((items) => upsertSavedClipInMemory(items, clip));
        } catch (error) {
          repositoryError(error, "저장");
        }
      });
    },

    delete(id) {
      return enqueue(async () => {
        try {
          return await mutate((items) => deleteSavedClipInMemory(items, id));
        } catch (error) {
          repositoryError(error, "삭제");
        }
      });
    },
  };
}

let productRepository: StudioSavedClipSqliteRepository | null = null;

export function getProductStudioSavedClipSqliteRepository(): StudioSavedClipSqliteRepository {
  productRepository ??= createStudioSavedClipSqliteRepository();
  return productRepository;
}
