import {
  encodeStudioFloatingSurfaceLayout,
  normalizeStudioFloatingSurfaceLayout,
  type StudioFloatingSurfaceLayout,
} from "./studio-floating-surface";

import type { StudioAsyncKeyValueStore } from "./studio-local-database";

export const STUDIO_FLOATING_SURFACE_PREFERENCES_SQLITE_NAMESPACE =
  "studio-floating-surface-layout-v1";
export const STUDIO_FLOATING_SURFACE_ID_MAX_LENGTH = 128;

const SAFE_SURFACE_ID = /^[A-Za-z0-9][A-Za-z0-9._:~-]*$/u;

export type StudioFloatingSurfacePersistenceFailure =
  | "invalid-surface-id"
  | "read-failed"
  | "write-failed"
  | "verification-failed";

export interface StudioFloatingSurfaceLayoutLoadResult {
  readonly layout: StudioFloatingSurfaceLayout;
  readonly persisted: boolean;
  readonly failure: StudioFloatingSurfacePersistenceFailure | null;
}

export interface StudioFloatingSurfaceLayoutSaveResult {
  readonly layout: StudioFloatingSurfaceLayout;
  readonly status: "persisted" | "memory-only";
  readonly failure: StudioFloatingSurfacePersistenceFailure | null;
}

export interface StudioFloatingSurfacePreferencesRepository {
  readonly authority: "sqlite-opfs";
  load(
    surfaceId: string,
    fallback: StudioFloatingSurfaceLayout,
  ): Promise<StudioFloatingSurfaceLayoutLoadResult>;
  save(
    surfaceId: string,
    layout: StudioFloatingSurfaceLayout,
  ): Promise<StudioFloatingSurfaceLayoutSaveResult>;
  remove(surfaceId: string): Promise<boolean>;
  flush(): Promise<void>;
}

export function isValidStudioFloatingSurfaceId(surfaceId: string): boolean {
  return surfaceId.length > 0
    && surfaceId.length <= STUDIO_FLOATING_SURFACE_ID_MAX_LENGTH
    && SAFE_SURFACE_ID.test(surfaceId);
}

function storageKey(surfaceId: string): string {
  return `surface:${surfaceId}`;
}

/**
 * Device-local layout repository over Studio's shared SQLite/OPFS authority.
 *
 * Writes are serialized per repository and read back before success is reported. A failed write
 * never throws into the editor or replaces the caller's in-memory/session layout.
 */
export function createStudioFloatingSurfacePreferencesRepository(
  store: StudioAsyncKeyValueStore,
): StudioFloatingSurfacePreferencesRepository {
  let writeTail: Promise<void> = Promise.resolve();

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = writeTail.catch(() => undefined).then(operation);
    writeTail = result.then(() => undefined, () => undefined);
    return result;
  };

  return Object.freeze({
    authority: "sqlite-opfs" as const,
    async load(
      surfaceId: string,
      fallback: StudioFloatingSurfaceLayout,
    ) {
      const safeFallback = normalizeStudioFloatingSurfaceLayout(
        fallback,
        fallback,
      );
      if (!isValidStudioFloatingSurfaceId(surfaceId)) {
        return Object.freeze({
          layout: safeFallback,
          persisted: false,
          failure: "invalid-surface-id" as const,
        });
      }
      try {
        await writeTail.catch(() => undefined);
        const raw = await store.get(storageKey(surfaceId));
        if (raw === null) {
          return Object.freeze({
            layout: safeFallback,
            persisted: false,
            failure: null,
          });
        }
        let decoded: unknown;
        try {
          decoded = JSON.parse(raw) as unknown;
        } catch {
          return Object.freeze({
            layout: safeFallback,
            persisted: false,
            failure: "read-failed" as const,
          });
        }
        return Object.freeze({
          layout: normalizeStudioFloatingSurfaceLayout(decoded, safeFallback),
          persisted: true,
          failure: null,
        });
      } catch {
        return Object.freeze({
          layout: safeFallback,
          persisted: false,
          failure: "read-failed" as const,
        });
      }
    },
    save(
      surfaceId: string,
      layout: StudioFloatingSurfaceLayout,
    ) {
      const normalized = normalizeStudioFloatingSurfaceLayout(layout);
      if (!isValidStudioFloatingSurfaceId(surfaceId)) {
        return Promise.resolve(Object.freeze({
          layout: normalized,
          status: "memory-only" as const,
          failure: "invalid-surface-id" as const,
        }));
      }
      const key = storageKey(surfaceId);
      const encoded = encodeStudioFloatingSurfaceLayout(normalized);
      return enqueue(async () => {
        try {
          await store.set(key, encoded);
        } catch {
          return Object.freeze({
            layout: normalized,
            status: "memory-only" as const,
            failure: "write-failed" as const,
          });
        }
        try {
          if (await store.get(key) !== encoded) {
            return Object.freeze({
              layout: normalized,
              status: "memory-only" as const,
              failure: "verification-failed" as const,
            });
          }
        } catch {
          return Object.freeze({
            layout: normalized,
            status: "memory-only" as const,
            failure: "verification-failed" as const,
          });
        }
        return Object.freeze({
          layout: normalized,
          status: "persisted" as const,
          failure: null,
        });
      });
    },
    remove(surfaceId: string) {
      if (!isValidStudioFloatingSurfaceId(surfaceId)) {
        return Promise.resolve(false);
      }
      return enqueue(async () => {
        try {
          await store.delete(storageKey(surfaceId));
          return true;
        } catch {
          return false;
        }
      });
    },
    flush() {
      return writeTail;
    },
  });
}

let sharedRepository:
  Promise<StudioFloatingSurfacePreferencesRepository> | null = null;

async function acquireStudioFloatingSurfaceDatabase() {
  const { acquireStudioLocalDatabase } =
    await import("./studio-local-database-runtime");
  return acquireStudioLocalDatabase();
}

export function acquireProductStudioFloatingSurfacePreferencesRepository(
): Promise<StudioFloatingSurfacePreferencesRepository> {
  sharedRepository ??= acquireStudioFloatingSurfaceDatabase().then((database) =>
    createStudioFloatingSurfacePreferencesRepository(
      database.asAsyncKeyValueStore(
        STUDIO_FLOATING_SURFACE_PREFERENCES_SQLITE_NAMESPACE,
      ),
    ));
  return sharedRepository;
}

/** Test/session seam; the app-lifetime SQLite handle remains owned by its shared runtime. */
export function resetStudioFloatingSurfacePreferencesRepositoryForTests(): void {
  sharedRepository = null;
}
