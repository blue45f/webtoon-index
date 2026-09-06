import type { StudioAsyncKeyValueStore } from "../studio-local-database";
import type { StudioCatalogView } from "./studio-catalog-query";

export type StudioCatalogSurface = "elements" | "scenes";
export interface StudioCatalogPreferences {
  readonly version: 1;
  readonly favoriteIds: readonly string[];
  readonly recentIds: readonly string[];
  readonly view: StudioCatalogView;
}
export type StudioCatalogPreferenceAction =
  | { readonly kind: "favorite"; readonly id: string; readonly value: boolean }
  | { readonly kind: "recent"; readonly id: string }
  | { readonly kind: "view"; readonly value: StudioCatalogView };
export interface StudioCatalogPreferencesRepository {
  load(surface: StudioCatalogSurface): Promise<StudioCatalogPreferences>;
  update(surface: StudioCatalogSurface, action: StudioCatalogPreferenceAction): Promise<StudioCatalogPreferences>;
}
const SAFE_ID = /^[a-zA-Z0-9._~-]{1,160}$/u;
function ids(value: unknown, limit: number): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === "string" && SAFE_ID.test(id)))].slice(0, limit)
    : [];
}
export function normalizeStudioCatalogPreferences(value: unknown): StudioCatalogPreferences {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<StudioCatalogPreferences> : {};
  const valid = input.version === 1;
  return { version: 1, favoriteIds: valid ? ids(input.favoriteIds, 500) : [], recentIds: valid ? ids(input.recentIds, 30) : [],
    view: valid && (input.view === "compact" || input.view === "list") ? input.view : "comfortable" };
}
export function applyStudioCatalogPreference(
  state: StudioCatalogPreferences, action: StudioCatalogPreferenceAction,
): StudioCatalogPreferences {
  if (action.kind === "view") return normalizeStudioCatalogPreferences({ ...state, view: action.value });
  if (!SAFE_ID.test(action.id)) return state;
  if (action.kind === "recent") return { ...state, recentIds: [action.id, ...state.recentIds.filter((id) => id !== action.id)].slice(0, 30) };
  return { ...state, favoriteIds: action.value
    ? [action.id, ...state.favoriteIds.filter((id) => id !== action.id)].slice(0, 500)
    : state.favoriteIds.filter((id) => id !== action.id) };
}
export function createStudioCatalogPreferencesRepository(store: StudioAsyncKeyValueStore): StudioCatalogPreferencesRepository {
  const queues = new Map<StudioCatalogSurface, Promise<unknown>>();
  async function read(surface: StudioCatalogSurface) {
    const raw = await store.get(surface);
    let parsed: unknown;
    try { parsed = raw && raw.length < 120_000 ? JSON.parse(raw) : undefined; } catch { parsed = undefined; }
    return normalizeStudioCatalogPreferences(parsed);
  }
  return {
    async load(surface) { await queues.get(surface)?.catch(() => undefined); return read(surface); },
    update(surface, action) {
      const next = (queues.get(surface) ?? Promise.resolve()).catch(() => undefined).then(async () => {
        const value = applyStudioCatalogPreference(await read(surface), action);
        await store.set(surface, JSON.stringify(value));
        return value;
      });
      queues.set(surface, next);
      void next.finally(() => { if (queues.get(surface) === next) queues.delete(surface); }).catch(() => undefined);
      return next;
    },
  };
}
let product: Promise<StudioCatalogPreferencesRepository> | null = null;
export function acquireStudioCatalogPreferencesRepository(): Promise<StudioCatalogPreferencesRepository> {
  if (!product) {
    product = import("../studio-local-database-runtime").then(async ({ acquireStudioLocalDatabase }) => {
      const database = await acquireStudioLocalDatabase();
      return createStudioCatalogPreferencesRepository(database.asAsyncKeyValueStore("studio-catalog-browser-v1"));
    }).catch((error: unknown) => { product = null; throw error; });
  }
  return product;
}
