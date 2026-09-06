/**
 * Recent page-background state and normalization.
 *
 * The synchronous Storage helpers below are retained only as an explicit
 * legacy/import-test seam. Product Studio persists this state through
 * `studio-ui-preferences-sqlite.ts` (SQLite over OPFS) and does not select a
 * browser Storage implementation automatically.
 */

export const STUDIO_BACKGROUND_RECENT_KEY = "toonspectrum-studio-bg-recent:v1";
export const STUDIO_BACKGROUND_RECENT_MAX = 20;
export const STUDIO_BACKGROUND_RECENT_VERSION = 1 as const;

export interface StudioBackgroundRecentState {
  version: typeof STUDIO_BACKGROUND_RECENT_VERSION;
  ids: string[];
}

export type StudioBackgroundRecentStorage = Pick<Storage, "getItem" | "setItem">;

const EMPTY: StudioBackgroundRecentState = {
  version: STUDIO_BACKGROUND_RECENT_VERSION,
  ids: [],
};

export function normalizeStudioBackgroundRecentState(raw: unknown): StudioBackgroundRecentState {
  let decoded = raw;
  if (typeof raw === "string") {
    try {
      decoded = JSON.parse(raw) as unknown;
    } catch {
      return { ...EMPTY, ids: [] };
    }
  }
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
    return { ...EMPTY, ids: [] };
  }
  const candidate = decoded as { version?: unknown; ids?: unknown };
  if (candidate.version !== STUDIO_BACKGROUND_RECENT_VERSION || !Array.isArray(candidate.ids)) {
    return { ...EMPTY, ids: [] };
  }
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of candidate.ids) {
    if (typeof value !== "string" || !value || value.length > 80) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    ids.push(value);
    if (ids.length >= STUDIO_BACKGROUND_RECENT_MAX) break;
  }
  return { version: STUDIO_BACKGROUND_RECENT_VERSION, ids };
}

export function loadStudioBackgroundRecent(
  storage: StudioBackgroundRecentStorage | null | undefined
): StudioBackgroundRecentState {
  if (!storage) return { ...EMPTY, ids: [] };
  try {
    return normalizeStudioBackgroundRecentState(storage.getItem(STUDIO_BACKGROUND_RECENT_KEY));
  } catch {
    return { ...EMPTY, ids: [] };
  }
}

export function rememberStudioBackgroundRecent(
  state: StudioBackgroundRecentState,
  presetId: string
): StudioBackgroundRecentState {
  const id = typeof presetId === "string" ? presetId.trim() : "";
  if (!id || id.length > 80) return state;
  const ids = [id, ...state.ids.filter((x) => x !== id)].slice(0, STUDIO_BACKGROUND_RECENT_MAX);
  return { version: STUDIO_BACKGROUND_RECENT_VERSION, ids };
}

export function saveStudioBackgroundRecent(
  storage: StudioBackgroundRecentStorage | null | undefined,
  state: StudioBackgroundRecentState
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(
      STUDIO_BACKGROUND_RECENT_KEY,
      JSON.stringify(normalizeStudioBackgroundRecentState(state))
    );
    return true;
  } catch {
    return false;
  }
}

export function pushStudioBackgroundRecent(
  storage: StudioBackgroundRecentStorage | null | undefined,
  presetId: string
): StudioBackgroundRecentState {
  const next = rememberStudioBackgroundRecent(loadStudioBackgroundRecent(storage), presetId);
  saveStudioBackgroundRecent(storage, next);
  return next;
}
