/**
 * Effect / look / filter favorite and recent-list state. Pure, storage-injected; no DOM.
 *
 * The synchronous Storage helpers are an explicit legacy/import-test seam.
 * Product Studio uses `studio-ui-preferences-sqlite.ts` (SQLite over OPFS) and
 * never chooses localStorage from this module automatically.
 */

export const STUDIO_EFFECT_FAVORITE_STATE_VERSION = 1 as const;
export const STUDIO_EFFECT_FAVORITE_MAX_IDS = 200;
export const STUDIO_EFFECT_RECENT_MAX_IDS = 40;
export const STUDIO_EFFECT_ID_MAX_LENGTH = 120;

export const STUDIO_EFFECT_NAMESPACES = ["look", "filter", "adjustment"] as const;
export type StudioEffectNamespace = (typeof STUDIO_EFFECT_NAMESPACES)[number];

declare const studioEffectIdBrand: unique symbol;
export type StudioEffectId = `${StudioEffectNamespace}:${string}` & {
  readonly [studioEffectIdBrand]: "StudioEffectId";
};

export interface StudioEffectFavoriteState {
  readonly version: typeof STUDIO_EFFECT_FAVORITE_STATE_VERSION;
  readonly favorites: readonly StudioEffectId[];
  readonly recent: readonly StudioEffectId[];
}

export interface StudioEffectStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = "toonspectrum-studio-effect-favorites:v1";
const NAMESPACE_SET = new Set<string>(STUDIO_EFFECT_NAMESPACES);
const SAFE_RAW = /^[A-Za-z0-9._~-]+$/u;

function emptyState(): StudioEffectFavoriteState {
  return Object.freeze({
    version: STUDIO_EFFECT_FAVORITE_STATE_VERSION,
    favorites: Object.freeze([] as StudioEffectId[]),
    recent: Object.freeze([] as StudioEffectId[]),
  });
}

export function parseStudioEffectId(value: unknown): StudioEffectId | null {
  if (typeof value !== "string" || value.length > STUDIO_EFFECT_ID_MAX_LENGTH) return null;
  const separator = value.indexOf(":");
  if (separator <= 0 || separator !== value.lastIndexOf(":")) return null;
  const namespace = value.slice(0, separator);
  const raw = value.slice(separator + 1);
  if (!NAMESPACE_SET.has(namespace) || !raw || !SAFE_RAW.test(raw)) return null;
  return value as StudioEffectId;
}

export function createStudioEffectId(namespace: StudioEffectNamespace, rawId: string): StudioEffectId {
  const candidate = `${namespace}:${typeof rawId === "string" ? rawId.trim() : ""}`;
  const parsed = parseStudioEffectId(candidate);
  if (!parsed) {
    throw new TypeError("Effect IDs must use look|filter|adjustment and a URL-safe raw id.");
  }
  return parsed;
}

function normalizeIdList(value: unknown, max: number): StudioEffectId[] {
  if (!Array.isArray(value)) return [];
  const out: StudioEffectId[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const id = parseStudioEffectId(entry);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

export function normalizeStudioEffectFavoriteState(value?: unknown): StudioEffectFavoriteState {
  if (!value || typeof value !== "object") return emptyState();
  const record = value as Record<string, unknown>;
  return Object.freeze({
    version: STUDIO_EFFECT_FAVORITE_STATE_VERSION,
    favorites: Object.freeze(normalizeIdList(record.favorites ?? record.ids, STUDIO_EFFECT_FAVORITE_MAX_IDS)),
    recent: Object.freeze(normalizeIdList(record.recent, STUDIO_EFFECT_RECENT_MAX_IDS)),
  });
}

export function loadStudioEffectFavoriteState(
  storage: StudioEffectStorage | null | undefined
): StudioEffectFavoriteState {
  if (!storage) return emptyState();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    return normalizeStudioEffectFavoriteState(JSON.parse(raw));
  } catch {
    return emptyState();
  }
}

export function saveStudioEffectFavoriteState(
  storage: StudioEffectStorage | null | undefined,
  state: StudioEffectFavoriteState
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(normalizeStudioEffectFavoriteState(state)));
    return true;
  } catch {
    return false;
  }
}

export function toggleStudioEffectFavorite(
  state: StudioEffectFavoriteState,
  effectId: StudioEffectId
): StudioEffectFavoriteState {
  const id = parseStudioEffectId(effectId);
  if (!id) return normalizeStudioEffectFavoriteState(state);
  const current = normalizeStudioEffectFavoriteState(state);
  const has = current.favorites.includes(id);
  const favorites = has
    ? current.favorites.filter((entry) => entry !== id)
    : [id, ...current.favorites].slice(0, STUDIO_EFFECT_FAVORITE_MAX_IDS);
  return normalizeStudioEffectFavoriteState({ favorites, recent: current.recent });
}

export function rememberStudioEffectRecent(
  state: StudioEffectFavoriteState,
  effectId: StudioEffectId
): StudioEffectFavoriteState {
  const id = parseStudioEffectId(effectId);
  if (!id) return normalizeStudioEffectFavoriteState(state);
  const current = normalizeStudioEffectFavoriteState(state);
  const recent = [id, ...current.recent.filter((entry) => entry !== id)].slice(
    0,
    STUDIO_EFFECT_RECENT_MAX_IDS
  );
  return normalizeStudioEffectFavoriteState({ favorites: current.favorites, recent });
}

export function searchStudioEffectIds(
  catalog: readonly { id: StudioEffectId; label: string; keywords?: readonly string[] }[],
  query: string
): typeof catalog {
  const q = query.trim().toLocaleLowerCase("ko-KR");
  if (!q) return catalog;
  return catalog.filter((item) => {
    if (item.label.toLocaleLowerCase("ko-KR").includes(q)) return true;
    if (item.id.toLocaleLowerCase("ko-KR").includes(q)) return true;
    return (item.keywords ?? []).some((keyword) =>
      keyword.toLocaleLowerCase("ko-KR").includes(q)
    );
  });
}

export function isStudioEffectFavorite(
  state: StudioEffectFavoriteState,
  effectId: StudioEffectId
): boolean {
  return normalizeStudioEffectFavoriteState(state).favorites.includes(effectId);
}
