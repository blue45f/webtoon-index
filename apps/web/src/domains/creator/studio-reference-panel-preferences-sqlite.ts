import {
  deserializeReferencePanelSettings,
  serializeReferencePanelSettings,
  type ReferencePanelSettings,
} from "./studio-reference-panel";

import type { StudioAsyncKeyValueStore } from "./studio-local-database";

async function acquireStudioReferencePanelDatabase() {
  const { acquireStudioLocalDatabase } = await import("./studio-local-database-runtime");
  return acquireStudioLocalDatabase();
}

export const STUDIO_REFERENCE_PANEL_PREFERENCES_SQLITE_NAMESPACE =
  "studio-reference-panel-preferences-v1";
export const STUDIO_REFERENCE_PANEL_SETTINGS_KEY = "layout-settings";

export interface StudioReferencePanelPreferenceSnapshot {
  readonly settings: ReferencePanelSettings;
  /** True only when the snapshot came from the SQLite/OPFS key, including a malformed payload. */
  readonly persisted: boolean;
}

export interface StudioReferencePanelPreferencesRepository {
  readonly authority: "sqlite-opfs";
  load(
    viewportWidth: number,
    viewportHeight: number,
  ): Promise<StudioReferencePanelPreferenceSnapshot>;
  save(settings: ReferencePanelSettings): Promise<void>;
  /** Waits for every write already accepted by this repository. */
  flush(): Promise<void>;
}

/**
 * Reference-panel presentation state has its own bounded SQLite namespace. Writes are chained so
 * a slow OPFS transaction cannot let an older drag/resize snapshot overtake a newer one.
 */
export function createStudioReferencePanelPreferencesRepository(
  store: StudioAsyncKeyValueStore,
): StudioReferencePanelPreferencesRepository {
  let writeTail: Promise<void> = Promise.resolve();

  return Object.freeze({
    authority: "sqlite-opfs" as const,
    async load(viewportWidth: number, viewportHeight: number) {
      const raw = await store.get(STUDIO_REFERENCE_PANEL_SETTINGS_KEY);
      return Object.freeze({
        settings: deserializeReferencePanelSettings(raw, viewportWidth, viewportHeight),
        persisted: raw !== null,
      });
    },
    save(settings: ReferencePanelSettings) {
      const serialized = serializeReferencePanelSettings(settings);
      const operation = writeTail
        .catch(() => undefined)
        .then(() => store.set(STUDIO_REFERENCE_PANEL_SETTINGS_KEY, serialized));
      writeTail = operation;
      return operation;
    },
    flush() {
      return writeTail;
    },
  });
}

let sharedRepository: Promise<StudioReferencePanelPreferencesRepository> | null = null;

export function acquireProductStudioReferencePanelPreferencesRepository(): Promise<StudioReferencePanelPreferencesRepository> {
  sharedRepository ??= acquireStudioReferencePanelDatabase().then((database) =>
    createStudioReferencePanelPreferencesRepository(
      database.asAsyncKeyValueStore(STUDIO_REFERENCE_PANEL_PREFERENCES_SQLITE_NAMESPACE),
    ));
  return sharedRepository;
}

/** Test/session seam; the app-lifetime SQLite handle remains owned by its shared runtime. */
export function resetStudioReferencePanelPreferencesRepositoryForTests(): void {
  sharedRepository = null;
}
