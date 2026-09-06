/** V12 SQLite/OPFS authority for user-authored Brand Kits. */

import {
  deleteBrandKitInMemory,
  parseCanonicalStudioBrandKitLibrary,
  renameBrandKitInMemory,
  serializeStudioBrandKitLibrary,
  StudioBrandKitLibraryError,
  upsertBrandKitInMemory,
} from "./studio-brand-kit";
import { acquireStudioLocalDatabase } from "./studio-local-database-runtime";

import type { BrandKit } from "./studio-brand-kit";
import type { StudioLocalDatabase } from "./studio-local-database";

export const STUDIO_BRAND_KIT_SQLITE_NAMESPACE = "studio-brand-kits-v12";
export const STUDIO_BRAND_KIT_SQLITE_KEY = "library-v1";

export type StudioBrandKitSqliteRepositoryErrorCode = "invalid" | "limit" | "unavailable";

export class StudioBrandKitSqliteRepositoryError extends Error {
  readonly code: StudioBrandKitSqliteRepositoryErrorCode;

  constructor(
    code: StudioBrandKitSqliteRepositoryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StudioBrandKitSqliteRepositoryError";
    this.code = code;
  }
}

export interface StudioBrandKitSqliteRepository {
  readonly authority: "sqlite";
  list(): Promise<BrandKit[]>;
  save(kit: BrandKit): Promise<BrandKit[]>;
  rename(id: string, name: string): Promise<BrandKit[]>;
  delete(id: string): Promise<BrandKit[]>;
  subscribe(listener: () => void): () => void;
}

export interface StudioBrandKitSqliteRepositoryOptions {
  readonly acquireDatabase?: () => Promise<StudioLocalDatabase>;
  readonly now?: () => number;
}

function repositoryError(error: unknown, operation: string): never {
  if (error instanceof StudioBrandKitSqliteRepositoryError) throw error;
  if (error instanceof StudioBrandKitLibraryError) {
    throw new StudioBrandKitSqliteRepositoryError(
      error.code === "library-too-large" ? "limit" : "invalid",
      `브랜드 킷 SQLite ${operation} 데이터를 처리하지 못했습니다: ${error.message}`,
      { cause: error },
    );
  }
  throw new StudioBrandKitSqliteRepositoryError(
    "unavailable",
    `브랜드 킷 SQLite ${operation}를 완료하지 못했습니다: ${
      error instanceof Error ? error.message : String(error)
    }`,
    { cause: error },
  );
}

async function readLibrary(database: StudioLocalDatabase): Promise<BrandKit[]> {
  const raw = await database.kvGet(STUDIO_BRAND_KIT_SQLITE_NAMESPACE, STUDIO_BRAND_KIT_SQLITE_KEY);
  return raw === null ? [] : parseCanonicalStudioBrandKitLibrary(raw);
}

export function createStudioBrandKitSqliteRepository(
  options: StudioBrandKitSqliteRepositoryOptions = {},
): StudioBrandKitSqliteRepository {
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
      repositoryError(error, "열기");
    }
  }

  function notify(): void {
    for (const listener of listeners) listener();
  }

  async function mutate(
    update: (items: readonly BrandKit[]) => BrandKit[],
  ): Promise<BrandKit[]> {
    const database = await open();
    const next = update(await readLibrary(database));
    await database.kvSet(
      STUDIO_BRAND_KIT_SQLITE_NAMESPACE,
      STUDIO_BRAND_KIT_SQLITE_KEY,
      serializeStudioBrandKitLibrary(next),
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

    save(kit) {
      return enqueue(async () => {
        try {
          return await mutate((items) => upsertBrandKitInMemory(items, kit));
        } catch (error) {
          repositoryError(error, "저장");
        }
      });
    },

    rename(id, name) {
      return enqueue(async () => {
        try {
          return await mutate((items) => renameBrandKitInMemory(items, id, name, now()));
        } catch (error) {
          repositoryError(error, "이름 변경");
        }
      });
    },

    delete(id) {
      return enqueue(async () => {
        try {
          return await mutate((items) => deleteBrandKitInMemory(items, id));
        } catch (error) {
          repositoryError(error, "삭제");
        }
      });
    },
  };
}

let productRepository: StudioBrandKitSqliteRepository | null = null;

export function getProductStudioBrandKitSqliteRepository(): StudioBrandKitSqliteRepository {
  productRepository ??= createStudioBrandKitSqliteRepository();
  return productRepository;
}
