import {
  isStudioLocalDatabaseOwnershipBusyError,
  STUDIO_WATERMARK_PREFERENCES_OWNERSHIP_BUSY_HINT,
} from "./studio-local-database-ownership";
import {
  DEFAULT_WATERMARK,
  normalizeWatermark,
  type WatermarkSettings,
} from "./studio-watermark";

import type { StudioAsyncKeyValueStore } from "./studio-local-database";

async function acquireStudioWatermarkDatabase() {
  const { acquireStudioLocalDatabase } = await import("./studio-local-database-runtime");
  try {
    return await acquireStudioLocalDatabase();
  } catch (cause) {
    if (!isStudioLocalDatabaseOwnershipBusyError(cause)) throw cause;
    const memoryStore = new Map<string, string>();
    return {
      asAsyncKeyValueStore(namespace: string): StudioAsyncKeyValueStore {
        return {
          async get(key: string) { return memoryStore.get(`${namespace}:${key}`) ?? null; },
          async set(key: string, value: string) { memoryStore.set(`${namespace}:${key}`, value); },
          async delete(key: string) { memoryStore.delete(`${namespace}:${key}`); },
        };
      },
    } as Awaited<ReturnType<typeof acquireStudioLocalDatabase>>;
  }
}

export const STUDIO_WATERMARK_PREFERENCES_SQLITE_NAMESPACE =
  "studio-watermark-preferences-v1";
const WATERMARK_SETTINGS_KEY = "settings";

export interface StudioWatermarkPreferencesRepository {
  readonly authority: "sqlite-opfs";
  load(): Promise<WatermarkSettings>;
  save(settings: WatermarkSettings): Promise<void>;
}

export type StudioWatermarkPersistenceState =
  | "hydrating"
  | "saving"
  | "durable"
  | "memory-only";

export interface StudioWatermarkPreferenceSnapshot {
  readonly authority: "sqlite-opfs";
  readonly settings: WatermarkSettings;
  readonly state: StudioWatermarkPersistenceState;
  readonly durable: boolean;
  readonly message: string | null;
  readonly cause: unknown;
}

export interface StudioWatermarkPreferenceRuntime {
  getSnapshot(): StudioWatermarkPreferenceSnapshot;
  subscribe(listener: () => void): () => void;
  hydrate(): Promise<boolean>;
  /**
   * Resolves only after the current hydration/save decision has settled. SQLite/OPFS failures are
   * represented by the returned `memory-only` snapshot and never reject or leave exports waiting.
   */
  awaitReady(): Promise<StudioWatermarkPreferenceSnapshot>;
  retry(): Promise<boolean>;
  update(settings: WatermarkSettings): void;
}

export interface StudioWatermarkPreferenceRuntimeOptions {
  acquireRepository?: () => Promise<StudioWatermarkPreferencesRepository>;
  initialSettings?: WatermarkSettings;
}

function immutableSettings(value: unknown): WatermarkSettings {
  return Object.freeze(normalizeWatermark(value)) as WatermarkSettings;
}

function parseStoredSettings(raw: string | null): WatermarkSettings {
  if (raw === null) return { ...DEFAULT_WATERMARK };
  try {
    return normalizeWatermark(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_WATERMARK };
  }
}

/**
 * SQLite KV adapter for the export watermark. The queue guarantees that an older
 * slider/text write cannot overtake a newer one when the OPFS-backed database is busy.
 */
export function createStudioWatermarkPreferencesRepository(
  store: StudioAsyncKeyValueStore,
): StudioWatermarkPreferencesRepository {
  let writeTail: Promise<void> = Promise.resolve();

  return Object.freeze({
    authority: "sqlite-opfs" as const,
    async load() {
      return parseStoredSettings(await store.get(WATERMARK_SETTINGS_KEY));
    },
    save(settings: WatermarkSettings) {
      const payload = JSON.stringify(normalizeWatermark(settings));
      const operation = writeTail.then(() => store.set(WATERMARK_SETTINGS_KEY, payload));
      writeTail = operation.catch(() => undefined);
      return operation;
    },
  });
}

let sharedRepository: Promise<StudioWatermarkPreferencesRepository> | null = null;

export async function acquireProductStudioWatermarkPreferencesRepository(): Promise<
  StudioWatermarkPreferencesRepository
> {
  sharedRepository ??= acquireStudioWatermarkDatabase().then((database) =>
    createStudioWatermarkPreferencesRepository(
      database.asAsyncKeyValueStore(STUDIO_WATERMARK_PREFERENCES_SQLITE_NAMESPACE),
    ));
  try {
    return await sharedRepository;
  } catch (cause) {
    // A denied/temporarily unavailable OPFS authority must be retryable. Never cache a rejected
    // product acquisition and never replace it with localStorage.
    sharedRepository = null;
    throw cause;
  }
}

/** Test/session seam; the shared database itself is owned by the app runtime. */
export function resetStudioWatermarkPreferencesRepositoryForTests(): void {
  sharedRepository = null;
}

function memoryOnlyMessage(cause: unknown): string {
  if (isStudioLocalDatabaseOwnershipBusyError(cause)) {
    return STUDIO_WATERMARK_PREFERENCES_OWNERSHIP_BUSY_HINT;
  }
  const detail = cause instanceof Error ? cause.message : String(cause);
  return `SQLite/OPFS에 워터마크 설정을 저장하지 못했습니다. 현재 탭 메모리에서만 유지되며 새로고침하면 사라집니다: ${detail}`;
}

/**
 * Testable external-store runtime used by StudioPage. It keeps edits responsive while SQLite/OPFS
 * hydrates, never lets a late load overwrite an in-flight artist edit, and exposes every loss of
 * durability as `memory-only` instead of silently selecting browser key/value storage.
 */
export function createStudioWatermarkPreferenceRuntime(
  options: StudioWatermarkPreferenceRuntimeOptions = {},
): StudioWatermarkPreferenceRuntime {
  const acquireRepository =
    options.acquireRepository ?? acquireProductStudioWatermarkPreferencesRepository;
  const listeners = new Set<() => void>();
  let repository: StudioWatermarkPreferencesRepository | null = null;
  let revision = 0;
  let needsPersist = false;
  let hydrationPromise: Promise<boolean> | null = null;
  let flushPromise: Promise<boolean> | null = null;
  let snapshot: StudioWatermarkPreferenceSnapshot = Object.freeze({
    authority: "sqlite-opfs" as const,
    settings: immutableSettings(options.initialSettings ?? DEFAULT_WATERMARK),
    state: "hydrating" as const,
    durable: false,
    message: null,
    cause: null,
  });

  function publish(
    settings: WatermarkSettings,
    state: StudioWatermarkPersistenceState,
    message: string | null = null,
    cause: unknown = null,
  ): void {
    snapshot = Object.freeze({
      authority: "sqlite-opfs" as const,
      settings,
      state,
      durable: state === "durable",
      message,
      cause,
    });
    for (const listener of [...listeners]) listener();
  }

  function flushPending(
    targetRepository: StudioWatermarkPreferencesRepository,
  ): Promise<boolean> {
    if (flushPromise) return flushPromise;
    flushPromise = (async () => {
      try {
        while (needsPersist) {
          const savingRevision = revision;
          const savingSettings = snapshot.settings;
          await targetRepository.save(savingSettings);
          if (revision === savingRevision) needsPersist = false;
        }
        if (repository === targetRepository) {
          publish(snapshot.settings, "durable");
        }
        return true;
      } catch (cause) {
        if (repository === targetRepository) repository = null;
        publish(snapshot.settings, "memory-only", memoryOnlyMessage(cause), cause);
        return false;
      } finally {
        flushPromise = null;
      }
    })();
    return flushPromise;
  }

  function startHydration(retryMemoryOnly: boolean): Promise<boolean> {
    if (snapshot.state === "durable" && !needsPersist) return Promise.resolve(true);
    if (hydrationPromise) return hydrationPromise;
    if (flushPromise) return flushPromise;
    if (snapshot.state === "memory-only" && !retryMemoryOnly) {
      return Promise.resolve(false);
    }
    publish(snapshot.settings, "hydrating");
    hydrationPromise = (async () => {
      try {
        const acquired = await acquireRepository();
        repository = acquired;
        if (!needsPersist) {
          const loadingRevision = revision;
          const loaded = immutableSettings(await acquired.load());
          if (!needsPersist && revision === loadingRevision) {
            publish(loaded, "hydrating");
          }
        }
        if (needsPersist) return flushPending(acquired);
        publish(snapshot.settings, "durable");
        return true;
      } catch (cause) {
        repository = null;
        publish(snapshot.settings, "memory-only", memoryOnlyMessage(cause), cause);
        return false;
      } finally {
        hydrationPromise = null;
      }
    })();
    return hydrationPromise;
  }

  function hydrate(): Promise<boolean> {
    return startHydration(false);
  }

  async function awaitReady(): Promise<StudioWatermarkPreferenceSnapshot> {
    if (hydrationPromise) {
      await hydrationPromise;
    } else if (flushPromise) {
      await flushPromise;
    } else if (snapshot.state === "hydrating") {
      await startHydration(false);
    }
    return snapshot;
  }

  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hydrate,
    awaitReady,
    retry: () => startHydration(true),
    update(settings: WatermarkSettings) {
      revision += 1;
      needsPersist = true;
      const next = immutableSettings(settings);
      publish(
        next,
        repository ? "saving" : snapshot.state,
        snapshot.state === "memory-only" ? snapshot.message : null,
        snapshot.state === "memory-only" ? snapshot.cause : null,
      );
      if (repository) void flushPending(repository);
    },
  });
}
