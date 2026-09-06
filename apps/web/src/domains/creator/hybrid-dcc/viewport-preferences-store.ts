import { STUDIO_UI_PREFERENCES_SQLITE_NAMESPACE } from "../studio-ui-preferences-sqlite";

import {
  normalizeStudioHybridDccViewportPreferences,
  parseStudioHybridDccViewportPreferences,
  STUDIO_HYBRID_DCC_VIEWPORT_PREFERENCES_KEY,
  type StudioHybridDccViewportPreferences,
} from "./studio-hybrid-dcc-viewport-interaction";

// The app owns the database. This adapter opens no extra file and never reads or writes
// a legacy browser-KV backend. A rejected acquire is not cached and remains retryable.
async function acquireStore() {
  const { acquireStudioLocalDatabase } = await import("../studio-local-database-runtime");
  const database = await acquireStudioLocalDatabase();
  return database.asAsyncKeyValueStore(STUDIO_UI_PREFERENCES_SQLITE_NAMESPACE);
}
let writeTail: Promise<void> = Promise.resolve();

export async function loadHybridDccViewportPreferences(): Promise<StudioHybridDccViewportPreferences> {
  await writeTail;
  const store = await acquireStore();
  return parseStudioHybridDccViewportPreferences(await store.get(STUDIO_HYBRID_DCC_VIEWPORT_PREFERENCES_KEY));
}

export function saveHybridDccViewportPreferences(preferences: StudioHybridDccViewportPreferences): Promise<void> {
  const serialized = JSON.stringify(normalizeStudioHybridDccViewportPreferences(preferences));
  const operation = writeTail.then(async () => {
    const store = await acquireStore();
    await store.set(STUDIO_HYBRID_DCC_VIEWPORT_PREFERENCES_KEY, serialized);
  });
  writeTail = operation.catch(() => undefined);
  return operation;
}
