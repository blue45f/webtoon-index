/**
 * Pure, storage-injected favorite state shared by Studio asset surfaces.
 *
 * The namespace is part of the persisted ID so an identical provider ID cannot make a local,
 * community, and bundled-raster asset accidentally share favorite state.
 */

export const STUDIO_ASSET_FAVORITE_NAMESPACES = ["local", "community", "raster"] as const;
export const STUDIO_ASSET_FAVORITE_STATE_VERSION = 1 as const;
export const STUDIO_ASSET_FAVORITE_MAX_IDS = 500;
export const STUDIO_ASSET_FAVORITE_ID_MAX_LENGTH = 160;

export type StudioAssetFavoriteNamespace = (typeof STUDIO_ASSET_FAVORITE_NAMESPACES)[number];

declare const studioAssetFavoriteIdBrand: unique symbol;
export type StudioAssetFavoriteId = `${StudioAssetFavoriteNamespace}:${string}` & {
  readonly [studioAssetFavoriteIdBrand]: "StudioAssetFavoriteId";
};

export interface StudioAssetFavoriteState {
  readonly version: typeof STUDIO_ASSET_FAVORITE_STATE_VERSION;
  readonly ids: readonly StudioAssetFavoriteId[];
}

const STUDIO_ASSET_FAVORITE_STORAGE_PREFIX = "toonspectrum-studio-asset-favorites:v1";
const STUDIO_ASSET_FAVORITE_STORAGE_KEY_MAX_LENGTH = 160;
const STORAGE_OWNER_PREVIEW_MAX_LENGTH = 72;
const SAFE_RAW_ID = /^[A-Za-z0-9._~-]+$/u;
const NAMESPACE_SET = new Set<string>(STUDIO_ASSET_FAVORITE_NAMESPACES);

function createState(ids: readonly StudioAssetFavoriteId[] = []): StudioAssetFavoriteState {
  return Object.freeze({
    version: STUDIO_ASSET_FAVORITE_STATE_VERSION,
    ids: Object.freeze([...ids]),
  });
}

function parseStudioAssetFavoriteId(value: unknown): StudioAssetFavoriteId | null {
  if (typeof value !== "string" || value.length > STUDIO_ASSET_FAVORITE_ID_MAX_LENGTH) return null;
  const separator = value.indexOf(":");
  if (separator <= 0 || separator !== value.lastIndexOf(":")) return null;
  const namespace = value.slice(0, separator);
  const rawId = value.slice(separator + 1);
  if (!NAMESPACE_SET.has(namespace) || !rawId || !SAFE_RAW_ID.test(rawId)) return null;
  return value as StudioAssetFavoriteId;
}

/** Creates the only supported, collision-safe persisted asset favorite ID shape. */
export function createStudioAssetFavoriteId(
  namespace: StudioAssetFavoriteNamespace,
  rawId: string
): StudioAssetFavoriteId {
  const normalizedRawId = typeof rawId === "string" ? rawId.trim() : "";
  const candidate = `${namespace}:${normalizedRawId}`;
  const favoriteId = parseStudioAssetFavoriteId(candidate);
  if (!favoriteId) {
    throw new TypeError(
      `Asset favorite IDs must use a supported namespace and a non-empty URL-safe ID no longer than ${STUDIO_ASSET_FAVORITE_ID_MAX_LENGTH} characters.`
    );
  }
  return favoriteId;
}

/** Converts persisted or otherwise untrusted data to the canonical bounded v1 state. */
export function normalizeStudioAssetFavoriteState(raw: unknown): StudioAssetFavoriteState {
  let decoded = raw;
  if (typeof raw === "string") {
    try {
      decoded = JSON.parse(raw) as unknown;
    } catch {
      return createState();
    }
  }
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) return createState();
  const candidate = decoded as { version?: unknown; ids?: unknown };
  if (candidate.version !== STUDIO_ASSET_FAVORITE_STATE_VERSION || !Array.isArray(candidate.ids)) {
    return createState();
  }

  const seen = new Set<StudioAssetFavoriteId>();
  const ids: StudioAssetFavoriteId[] = [];
  for (const value of candidate.ids) {
    const id = parseStudioAssetFavoriteId(value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= STUDIO_ASSET_FAVORITE_MAX_IDS) break;
  }
  return createState(ids);
}

export function toggleStudioAssetFavorite(
  state: StudioAssetFavoriteState,
  id: StudioAssetFavoriteId
): StudioAssetFavoriteState {
  const normalized = normalizeStudioAssetFavoriteState(state);
  if (normalized.ids.includes(id)) return removeStudioAssetFavorite(normalized, id);
  return createState([id, ...normalized.ids].slice(0, STUDIO_ASSET_FAVORITE_MAX_IDS));
}

export function removeStudioAssetFavorite(
  state: StudioAssetFavoriteState,
  id: StudioAssetFavoriteId
): StudioAssetFavoriteState {
  const normalized = normalizeStudioAssetFavoriteState(state);
  return createState(normalized.ids.filter((candidate) => candidate !== id));
}

export function isStudioAssetFavorite(
  state: StudioAssetFavoriteState,
  id: StudioAssetFavoriteId
): boolean {
  return normalizeStudioAssetFavoriteState(state).ids.includes(id);
}

/** Moves favorites first while preserving the input order inside both partitions. */
export function favoriteFirst<T>(
  items: readonly T[],
  state: StudioAssetFavoriteState,
  keyOf: (item: T) => StudioAssetFavoriteId
): T[] {
  const favoriteIds = new Set(normalizeStudioAssetFavoriteState(state).ids);
  const favorites: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    (favoriteIds.has(keyOf(item)) ? favorites : rest).push(item);
  }
  return [...favorites, ...rest];
}

export function favoriteOnly<T>(
  items: readonly T[],
  state: StudioAssetFavoriteState,
  keyOf: (item: T) => StudioAssetFavoriteId
): T[] {
  const favoriteIds = new Set(normalizeStudioAssetFavoriteState(state).ids);
  return items.filter((item) => favoriteIds.has(keyOf(item)));
}

function ownerHash(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function ownerPreview(value: string): string {
  try {
    return encodeURIComponent(value).slice(0, STORAGE_OWNER_PREVIEW_MAX_LENGTH);
  } catch {
    return "invalid-unicode";
  }
}

/** Guest and signed-in owners receive deterministic, bounded, non-overlapping storage keys. */
export function studioAssetFavoriteStorageKey(userId: string | null): string {
  const normalizedUserId = userId?.trim() ?? "";
  if (!normalizedUserId) return `${STUDIO_ASSET_FAVORITE_STORAGE_PREFIX}:guest`;
  const owner = `${ownerPreview(normalizedUserId)}-${ownerHash(normalizedUserId)}`;
  const key = `${STUDIO_ASSET_FAVORITE_STORAGE_PREFIX}:user:${owner}`;
  return key.slice(0, STUDIO_ASSET_FAVORITE_STORAGE_KEY_MAX_LENGTH);
}

export function loadStudioAssetFavoriteState(
  storage: Pick<Storage, "getItem"> | null,
  userId: string | null
): StudioAssetFavoriteState {
  if (!storage) return createState();
  try {
    const raw = storage.getItem(studioAssetFavoriteStorageKey(userId));
    return raw === null ? createState() : normalizeStudioAssetFavoriteState(raw);
  } catch {
    return createState();
  }
}

export function saveStudioAssetFavoriteState(
  storage: Pick<Storage, "setItem"> | null,
  userId: string | null,
  state: unknown
): StudioAssetFavoriteState {
  const normalized = normalizeStudioAssetFavoriteState(state);
  if (!storage) return normalized;
  try {
    storage.setItem(studioAssetFavoriteStorageKey(userId), JSON.stringify(normalized));
  } catch {
    // Favorites are an optional convenience. Private/quota-restricted storage must not break Studio.
  }
  return normalized;
}
