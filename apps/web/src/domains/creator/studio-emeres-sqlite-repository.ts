/** V12 SQLite/OPFS authority for the user-authored Emeres image-template library. */

import {
  deleteEmeresLibraryItemInMemory,
  parseCanonicalEmeresLibraryItems,
  renameEmeresLibraryItemInMemory,
  serializeEmeresLibraryItems,
  setEmeresLibraryItemCategoryInMemory,
  StudioEmeresLibraryError,
  upsertEmeresLibraryItem,
} from "./studio-emeres-library";
import { acquireStudioLocalDatabase } from "./studio-local-database-runtime";

import type { StudioEmeresLibraryItem } from "./studio-emeres-library";
import type { EmeresCategory } from "./studio-emeres-templates";
import type { StudioLocalDatabase } from "./studio-local-database";

export const STUDIO_EMERES_SQLITE_NAMESPACE = "studio-emeres-library-v12";
export const STUDIO_EMERES_SQLITE_KEY = "library-v1";

export type StudioEmeresSqliteRepositoryErrorCode = "invalid" | "unavailable";

export class StudioEmeresSqliteRepositoryError extends Error {
  readonly code: StudioEmeresSqliteRepositoryErrorCode;

  constructor(
    code: StudioEmeresSqliteRepositoryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StudioEmeresSqliteRepositoryError";
    this.code = code;
  }
}

export interface StudioEmeresSqliteRepository {
  readonly authority: "sqlite";
  list(): Promise<StudioEmeresLibraryItem[]>;
  save(item: StudioEmeresLibraryItem): Promise<StudioEmeresLibraryItem[]>;
  rename(id: string, name: string): Promise<StudioEmeresLibraryItem[]>;
  setCategory(
    id: string,
    category: EmeresCategory | undefined,
  ): Promise<StudioEmeresLibraryItem[]>;
  delete(id: string): Promise<StudioEmeresLibraryItem[]>;
  subscribe(listener: () => void): () => void;
}

export interface StudioEmeresSqliteRepositoryOptions {
  readonly acquireDatabase?: () => Promise<StudioLocalDatabase>;
  readonly now?: () => number;
}

function persistenceError(error: unknown, operation: string): never {
  if (error instanceof StudioEmeresSqliteRepositoryError) throw error;
  if (error instanceof StudioEmeresLibraryError) {
    throw new StudioEmeresSqliteRepositoryError(
      "invalid",
      `이메레스 SQLite ${operation} 데이터가 손상되었습니다: ${error.message}`,
      { cause: error },
    );
  }
  throw new StudioEmeresSqliteRepositoryError(
    "unavailable",
    `이메레스 SQLite ${operation}를 완료하지 못했습니다: ${
      error instanceof Error ? error.message : String(error)
    }`,
    { cause: error },
  );
}

async function readLibrary(database: StudioLocalDatabase): Promise<StudioEmeresLibraryItem[]> {
  const raw = await database.kvGet(STUDIO_EMERES_SQLITE_NAMESPACE, STUDIO_EMERES_SQLITE_KEY);
  return raw === null ? [] : parseCanonicalEmeresLibraryItems(raw);
}

export function createStudioEmeresSqliteRepository(
  options: StudioEmeresSqliteRepositoryOptions = {},
): StudioEmeresSqliteRepository {
  const acquireDatabase = options.acquireDatabase ?? acquireStudioLocalDatabase;
  const now = options.now ?? Date.now;
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
      persistenceError(error, "열기");
    }
  }

  function notify(): void {
    for (const listener of listeners) listener();
  }

  async function mutate(
    update: (items: readonly StudioEmeresLibraryItem[]) => StudioEmeresLibraryItem[],
  ): Promise<StudioEmeresLibraryItem[]> {
    const database = await open();
    const current = await readLibrary(database);
    const next = update(current);
    const serialized = serializeEmeresLibraryItems(next);
    await database.kvSet(
      STUDIO_EMERES_SQLITE_NAMESPACE,
      STUDIO_EMERES_SQLITE_KEY,
      serialized,
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
        persistenceError(error, "읽기");
      }
    },

    save(item) {
      return enqueue(async () => {
        try {
          return await mutate((items) => upsertEmeresLibraryItem(items, item));
        } catch (error) {
          persistenceError(error, "저장");
        }
      });
    },

    rename(id, name) {
      return enqueue(async () => {
        try {
          return await mutate((items) => renameEmeresLibraryItemInMemory(
            items,
            id,
            name,
            now(),
          ));
        } catch (error) {
          persistenceError(error, "이름 변경");
        }
      });
    },

    setCategory(id, category) {
      return enqueue(async () => {
        try {
          return await mutate((items) => setEmeresLibraryItemCategoryInMemory(
            items,
            id,
            category,
            now(),
          ));
        } catch (error) {
          persistenceError(error, "분류 변경");
        }
      });
    },

    delete(id) {
      return enqueue(async () => {
        try {
          return await mutate((items) => deleteEmeresLibraryItemInMemory(items, id));
        } catch (error) {
          persistenceError(error, "삭제");
        }
      });
    },
  };
}

let productRepository: StudioEmeresSqliteRepository | null = null;

export function getProductStudioEmeresSqliteRepository(): StudioEmeresSqliteRepository {
  productRepository ??= createStudioEmeresSqliteRepository();
  return productRepository;
}
