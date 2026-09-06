import {
  normalizeStudioVrmRecentState,
  rememberStudioVrmRecent,
  type StudioVrmRecentState,
} from "./studio-vrm-poser-ux";

import type { StudioAsyncKeyValueStore } from "../studio-local-database";

export const STUDIO_VRM_POSER_PREFERENCES_SQLITE_NAMESPACE =
  "studio-vrm-poser-preferences-v12";

const RECENT_POSES_KEY = "recent-poses";
const RECENT_CHARACTERS_KEY = "recent-characters";
export const STUDIO_VRM_WEBCAM_CONSENT_SESSION_KEY = "studio_webcam_consent";

/**
 * Privacy notice consent is deliberately excluded from SQLite creative authority. It lasts only
 * for the current browser tab and the browser's MediaDevices permission remains authoritative.
 */
export function hasStudioVrmWebcamSessionConsent(): boolean {
  try {
    return typeof globalThis.sessionStorage !== "undefined"
      && globalThis.sessionStorage.getItem(STUDIO_VRM_WEBCAM_CONSENT_SESSION_KEY) === "true";
  } catch {
    return false;
  }
}

export function rememberStudioVrmWebcamSessionConsent(): void {
  try {
    if (typeof globalThis.sessionStorage !== "undefined") {
      globalThis.sessionStorage.setItem(STUDIO_VRM_WEBCAM_CONSENT_SESSION_KEY, "true");
    }
  } catch {
    // The mounted surface retains consent in React state even if session storage is denied.
  }
}

export interface StudioVrmPoserPreferences {
  readonly recentPoses: StudioVrmRecentState;
  readonly recentCharacters: StudioVrmRecentState;
}

export interface StudioVrmPoserPreferencesRepository {
  readonly authority: "sqlite-opfs";
  load(): Promise<StudioVrmPoserPreferences>;
  saveRecentPoses(state: StudioVrmRecentState): Promise<void>;
  saveRecentCharacters(state: StudioVrmRecentState): Promise<void>;
}

export type StudioVrmPoserPreferencesPersistenceState =
  | "hydrating"
  | "saving"
  | "durable"
  | "memory-only";

export interface StudioVrmPoserPreferencesSnapshot extends StudioVrmPoserPreferences {
  readonly authority: "sqlite-opfs";
  readonly state: StudioVrmPoserPreferencesPersistenceState;
  readonly durable: boolean;
  readonly message: string | null;
  readonly cause: unknown;
}

export interface StudioVrmPoserPreferencesRuntime {
  getSnapshot(): StudioVrmPoserPreferencesSnapshot;
  subscribe(listener: () => void): () => void;
  hydrate(): Promise<boolean>;
  retry(): Promise<boolean>;
  awaitSettled(): Promise<StudioVrmPoserPreferencesSnapshot>;
  rememberPose(poseId: string): void;
  rememberCharacter(characterId: string): void;
}

export interface StudioVrmPoserPreferencesRuntimeOptions {
  acquireRepository?: () => Promise<StudioVrmPoserPreferencesRepository>;
}

function emptyRecent(): StudioVrmRecentState {
  return { version: 1, ids: [] };
}

function immutableRecent(value: unknown): StudioVrmRecentState {
  const normalized = normalizeStudioVrmRecentState(value);
  return Object.freeze({
    version: normalized.version,
    ids: Object.freeze([...normalized.ids]) as unknown as string[],
  });
}

function serializeRecent(value: StudioVrmRecentState): string {
  return JSON.stringify(normalizeStudioVrmRecentState(value));
}

/**
 * SQLite KV repository for small VRM poser recency indexes. A single queue spans both keys so a
 * rapid pose/character sequence cannot commit in a different order from the artist's actions.
 */
export function createStudioVrmPoserPreferencesRepository(
  store: StudioAsyncKeyValueStore,
): StudioVrmPoserPreferencesRepository {
  let writeTail: Promise<void> = Promise.resolve();

  const enqueue = (key: string, state: StudioVrmRecentState): Promise<void> => {
    const payload = serializeRecent(state);
    const operation = writeTail.then(() => store.set(key, payload));
    writeTail = operation.catch(() => undefined);
    return operation;
  };

  return Object.freeze({
    authority: "sqlite-opfs" as const,
    async load() {
      const [recentPoses, recentCharacters] = await Promise.all([
        store.get(RECENT_POSES_KEY),
        store.get(RECENT_CHARACTERS_KEY),
      ]);
      return Object.freeze({
        recentPoses: immutableRecent(recentPoses),
        recentCharacters: immutableRecent(recentCharacters),
      });
    },
    saveRecentPoses(state: StudioVrmRecentState) {
      return enqueue(RECENT_POSES_KEY, state);
    },
    saveRecentCharacters(state: StudioVrmRecentState) {
      return enqueue(RECENT_CHARACTERS_KEY, state);
    },
  });
}

let sharedRepository: Promise<StudioVrmPoserPreferencesRepository> | null = null;

export async function acquireProductStudioVrmPoserPreferencesRepository(): Promise<
  StudioVrmPoserPreferencesRepository
> {
  sharedRepository ??= (async () => {
    const databaseRuntime = await import("../studio-local-database-runtime");
    const database = await databaseRuntime.acquireStudioLocalDatabase().catch(async (cause: unknown) => {
      // The shared DB runtime memoizes its open promise. Reset only when opening itself failed so
      // the visible retry action can recover from a transient OPFS/worker startup failure.
      await databaseRuntime.closeStudioLocalDatabaseRuntime({
        preserveBrushMemorySession: true,
      });
      throw cause;
    });
    return createStudioVrmPoserPreferencesRepository(
      database.asAsyncKeyValueStore(STUDIO_VRM_POSER_PREFERENCES_SQLITE_NAMESPACE),
    );
  })();
  try {
    return await sharedRepository;
  } catch (cause) {
    // OPFS can become available after a quota/permission failure. Do not cache a rejection and do
    // not silently substitute a browser key/value fallback for the V12 product authority.
    sharedRepository = null;
    throw cause;
  }
}

/** Test/session seam; the app-lifetime database handle remains owned by its shared runtime. */
export function resetStudioVrmPoserPreferencesRepositoryForTests(): void {
  sharedRepository = null;
}

function memoryOnlyMessage(cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return `SQLite/OPFS에 최근 포즈·캐릭터를 저장하지 못했습니다. 현재 탭 메모리에서만 유지되며 새로고침하면 사라집니다: ${detail}`;
}

/**
 * External-store runtime for the product surface. Hydration is field-fenced: a pose selected while
 * SQLite is loading does not prevent an untouched character list from hydrating, and vice versa.
 * Failed writes retain dirty state so an explicit retry can durably flush the current-tab value.
 */
export function createStudioVrmPoserPreferencesRuntime(
  options: StudioVrmPoserPreferencesRuntimeOptions = {},
): StudioVrmPoserPreferencesRuntime {
  const acquireRepository =
    options.acquireRepository ?? acquireProductStudioVrmPoserPreferencesRepository;
  const listeners = new Set<() => void>();
  let repository: StudioVrmPoserPreferencesRepository | null = null;
  let poseRevision = 0;
  let characterRevision = 0;
  let poseDirty = false;
  let characterDirty = false;
  let hydrationPromise: Promise<boolean> | null = null;
  let flushPromise: Promise<boolean> | null = null;
  let snapshot: StudioVrmPoserPreferencesSnapshot = Object.freeze({
    authority: "sqlite-opfs" as const,
    recentPoses: immutableRecent(emptyRecent()),
    recentCharacters: immutableRecent(emptyRecent()),
    state: "hydrating" as const,
    durable: false,
    message: null,
    cause: null,
  });

  function publish(
    recentPoses: StudioVrmRecentState,
    recentCharacters: StudioVrmRecentState,
    state: StudioVrmPoserPreferencesPersistenceState,
    message: string | null = null,
    cause: unknown = null,
  ): void {
    snapshot = Object.freeze({
      authority: "sqlite-opfs" as const,
      recentPoses,
      recentCharacters,
      state,
      durable: state === "durable",
      message,
      cause,
    });
    for (const listener of [...listeners]) listener();
  }

  function publishMemoryOnly(cause: unknown): void {
    publish(
      snapshot.recentPoses,
      snapshot.recentCharacters,
      "memory-only",
      memoryOnlyMessage(cause),
      cause,
    );
  }

  function flushPending(
    targetRepository: StudioVrmPoserPreferencesRepository,
  ): Promise<boolean> {
    if (flushPromise) return flushPromise;

    publish(snapshot.recentPoses, snapshot.recentCharacters, "saving");
    flushPromise = (async () => {
      try {
        while (poseDirty || characterDirty) {
          if (poseDirty) {
            const savingRevision = poseRevision;
            const savingState = snapshot.recentPoses;
            await targetRepository.saveRecentPoses(savingState);
            if (poseRevision === savingRevision) poseDirty = false;
          }
          if (characterDirty) {
            const savingRevision = characterRevision;
            const savingState = snapshot.recentCharacters;
            await targetRepository.saveRecentCharacters(savingState);
            if (characterRevision === savingRevision) characterDirty = false;
          }
        }
        if (repository === targetRepository) {
          publish(snapshot.recentPoses, snapshot.recentCharacters, "durable");
        }
        return true;
      } catch (cause) {
        if (repository === targetRepository) repository = null;
        publishMemoryOnly(cause);
        return false;
      } finally {
        flushPromise = null;
      }
    })();
    return flushPromise;
  }

  function startHydration(retryMemoryOnly: boolean): Promise<boolean> {
    if (snapshot.state === "durable" && !poseDirty && !characterDirty) {
      return Promise.resolve(true);
    }
    if (hydrationPromise) return hydrationPromise;
    if (flushPromise) return flushPromise;
    if (snapshot.state === "memory-only" && !retryMemoryOnly) {
      return Promise.resolve(false);
    }

    publish(snapshot.recentPoses, snapshot.recentCharacters, "hydrating");
    hydrationPromise = (async () => {
      try {
        const targetRepository = await acquireRepository();
        const loadingPoseRevision = poseRevision;
        const loadingCharacterRevision = characterRevision;
        const loaded = await targetRepository.load();
        repository = targetRepository;

        const recentPoses = !poseDirty && poseRevision === loadingPoseRevision
          ? immutableRecent(loaded.recentPoses)
          : snapshot.recentPoses;
        const recentCharacters = !characterDirty
          && characterRevision === loadingCharacterRevision
          ? immutableRecent(loaded.recentCharacters)
          : snapshot.recentCharacters;
        publish(recentPoses, recentCharacters, "hydrating");

        if (poseDirty || characterDirty) return flushPending(targetRepository);
        publish(recentPoses, recentCharacters, "durable");
        return true;
      } catch (cause) {
        repository = null;
        publishMemoryOnly(cause);
        return false;
      } finally {
        hydrationPromise = null;
      }
    })();
    return hydrationPromise;
  }

  function rememberPose(poseId: string): void {
    const next = rememberStudioVrmRecent(snapshot.recentPoses, poseId);
    if (next === snapshot.recentPoses) return;
    poseRevision += 1;
    poseDirty = true;
    publish(
      immutableRecent(next),
      snapshot.recentCharacters,
      repository ? "saving" : snapshot.state,
      snapshot.state === "memory-only" ? snapshot.message : null,
      snapshot.state === "memory-only" ? snapshot.cause : null,
    );
    if (repository) void flushPending(repository);
  }

  function rememberCharacter(characterId: string): void {
    const next = rememberStudioVrmRecent(snapshot.recentCharacters, characterId);
    if (next === snapshot.recentCharacters) return;
    characterRevision += 1;
    characterDirty = true;
    publish(
      snapshot.recentPoses,
      immutableRecent(next),
      repository ? "saving" : snapshot.state,
      snapshot.state === "memory-only" ? snapshot.message : null,
      snapshot.state === "memory-only" ? snapshot.cause : null,
    );
    if (repository) void flushPending(repository);
  }

  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hydrate: () => startHydration(false),
    retry: () => startHydration(true),
    async awaitSettled() {
      if (hydrationPromise) {
        await hydrationPromise;
      } else if (flushPromise) {
        await flushPromise;
      } else if (snapshot.state === "hydrating") {
        await startHydration(false);
      }
      return snapshot;
    },
    rememberPose,
    rememberCharacter,
  });
}
