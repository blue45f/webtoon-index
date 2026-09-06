/** V12 SQLite authority for the installed original-asset marketplace package library. */

import { acquireStudioLocalDatabase } from "./studio-local-database-runtime";
import {
  STUDIO_MARKETPLACE_LIBRARY_VERSION,
  STUDIO_MARKETPLACE_MAX_LIBRARY_PACKAGES,
  parseCanonicalStudioMarketplaceLibrary,
  serializeCanonicalStudioMarketplaceLibrary,
} from "./studio-marketplace-packages";

import type { StudioLocalDatabase } from "./studio-local-database";
import type {
  StudioMarketplaceLibrarySaveOptions,
  StudioMarketplaceLibraryState,
} from "./studio-marketplace-packages";

export const STUDIO_MARKETPLACE_LIBRARY_SQLITE_NAMESPACE =
  "studio-marketplace-package-library-v12";
export const STUDIO_MARKETPLACE_LIBRARY_SQLITE_KEY = "library-v1";

export type StudioMarketplaceLibrarySqliteErrorCode =
  | "invalid"
  | "limit"
  | "unavailable";

export class StudioMarketplaceLibrarySqliteError extends Error {
  readonly code: StudioMarketplaceLibrarySqliteErrorCode;

  constructor(
    code: StudioMarketplaceLibrarySqliteErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StudioMarketplaceLibrarySqliteError";
    this.code = code;
  }
}

export interface StudioMarketplaceLibrarySqliteRepository {
  readonly authority: "sqlite";
  list(): Promise<StudioMarketplaceLibraryState>;
  save(
    state: StudioMarketplaceLibraryState,
    options?: StudioMarketplaceLibrarySaveOptions,
  ): Promise<StudioMarketplaceLibraryState>;
  subscribe(listener: () => void): () => void;
}

export interface StudioMarketplaceLibrarySqliteRepositoryOptions {
  readonly acquireDatabase?: () => Promise<StudioLocalDatabase>;
}

function emptyLibrary(): StudioMarketplaceLibraryState {
  return { version: STUDIO_MARKETPLACE_LIBRARY_VERSION, packages: [] };
}

function wrapError(error: unknown, operation: string): never {
  if (error instanceof StudioMarketplaceLibrarySqliteError) throw error;
  const message = error instanceof Error ? error.message : String(error);
  const invalid = message.includes("마켓 라이브러리");
  throw new StudioMarketplaceLibrarySqliteError(
    invalid ? "invalid" : "unavailable",
    `마켓 라이브러리 SQLite ${operation}를 완료하지 못했습니다: ${message}`,
    { cause: error },
  );
}

async function readLibrary(
  database: StudioLocalDatabase,
): Promise<StudioMarketplaceLibraryState> {
  const raw = await database.kvGet(
    STUDIO_MARKETPLACE_LIBRARY_SQLITE_NAMESPACE,
    STUDIO_MARKETPLACE_LIBRARY_SQLITE_KEY,
  );
  return raw === null ? emptyLibrary() : parseCanonicalStudioMarketplaceLibrary(raw);
}

export function createStudioMarketplaceLibrarySqliteRepository(
  options: StudioMarketplaceLibrarySqliteRepositoryOptions = {},
): StudioMarketplaceLibrarySqliteRepository {
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
      wrapError(error, "열기");
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
        return await readLibrary(await open());
      } catch (error) {
        wrapError(error, "읽기");
      }
    },

    save(state, saveOptions = {}) {
      return enqueue(async () => {
        try {
          const database = await open();
          const latest = await readLibrary(database);
          const removedIds = new Set(saveOptions.removedPackageIds ?? []);
          const requestedIds = new Set(state.packages.map((entry) => entry.packageId));
          const packages = [
            ...state.packages.filter((entry) => !removedIds.has(entry.packageId)),
            ...latest.packages.filter(
              (entry) => !removedIds.has(entry.packageId) && !requestedIds.has(entry.packageId),
            ),
          ];
          if (packages.length > STUDIO_MARKETPLACE_MAX_LIBRARY_PACKAGES) {
            throw new StudioMarketplaceLibrarySqliteError(
              "limit",
              `마켓 라이브러리는 ${STUDIO_MARKETPLACE_MAX_LIBRARY_PACKAGES}개를 초과할 수 없습니다. 기존 항목은 삭제하지 않았습니다.`,
            );
          }
          const persisted: StudioMarketplaceLibraryState = {
            version: STUDIO_MARKETPLACE_LIBRARY_VERSION,
            packages,
          };
          await database.kvSet(
            STUDIO_MARKETPLACE_LIBRARY_SQLITE_NAMESPACE,
            STUDIO_MARKETPLACE_LIBRARY_SQLITE_KEY,
            serializeCanonicalStudioMarketplaceLibrary(persisted),
          );
          for (const listener of listeners) listener();
          return persisted;
        } catch (error) {
          wrapError(error, "저장");
        }
      });
    },
  };
}

let productRepository: StudioMarketplaceLibrarySqliteRepository | null = null;

export function getProductStudioMarketplaceLibrarySqliteRepository():
StudioMarketplaceLibrarySqliteRepository {
  productRepository ??= createStudioMarketplaceLibrarySqliteRepository();
  return productRepository;
}
