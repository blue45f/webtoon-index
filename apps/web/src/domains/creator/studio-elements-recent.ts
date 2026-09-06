/**
 * Recent Studio element state and pure normalize/update helpers.
 *
 * The synchronous Storage helpers are retained only as an explicit legacy/import-test seam.
 * Product Studio persists this state through `studio-ui-preferences-sqlite.ts`.
 */

export const STUDIO_ELEMENTS_RECENT_KEY = "toonspectrum-studio-elements-recent:v1";
export const STUDIO_ELEMENTS_RECENT_MAX = 24;
export const STUDIO_ELEMENTS_RECENT_VERSION = 1 as const;

export interface StudioElementsRecentState {
  version: typeof STUDIO_ELEMENTS_RECENT_VERSION;
  /** Element ids, newest first. */
  ids: string[];
}

export type StudioElementsRecentStorage = Pick<Storage, "getItem" | "setItem">;

const EMPTY: StudioElementsRecentState = {
  version: STUDIO_ELEMENTS_RECENT_VERSION,
  ids: [],
};

export function normalizeStudioElementsRecentState(raw: unknown): StudioElementsRecentState {
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
  if (candidate.version !== STUDIO_ELEMENTS_RECENT_VERSION || !Array.isArray(candidate.ids)) {
    return { ...EMPTY, ids: [] };
  }
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of candidate.ids) {
    if (typeof value !== "string" || !value || value.length > 120) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    ids.push(value);
    if (ids.length >= STUDIO_ELEMENTS_RECENT_MAX) break;
  }
  return { version: STUDIO_ELEMENTS_RECENT_VERSION, ids };
}

export function loadStudioElementsRecent(
  storage: StudioElementsRecentStorage | null | undefined
): StudioElementsRecentState {
  if (!storage) return { ...EMPTY, ids: [] };
  try {
    return normalizeStudioElementsRecentState(storage.getItem(STUDIO_ELEMENTS_RECENT_KEY));
  } catch {
    return { ...EMPTY, ids: [] };
  }
}

export function rememberStudioElementRecent(
  state: StudioElementsRecentState,
  elementId: string
): StudioElementsRecentState {
  const id = typeof elementId === "string" ? elementId.trim() : "";
  if (!id || id.length > 120) return state;
  const ids = [id, ...state.ids.filter((existing) => existing !== id)].slice(
    0,
    STUDIO_ELEMENTS_RECENT_MAX
  );
  return { version: STUDIO_ELEMENTS_RECENT_VERSION, ids };
}

export function saveStudioElementsRecent(
  storage: StudioElementsRecentStorage | null | undefined,
  state: StudioElementsRecentState
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(
      STUDIO_ELEMENTS_RECENT_KEY,
      JSON.stringify(normalizeStudioElementsRecentState(state))
    );
    return true;
  } catch {
    return false;
  }
}

export function pushStudioElementRecent(
  storage: StudioElementsRecentStorage | null | undefined,
  elementId: string
): StudioElementsRecentState {
  const next = rememberStudioElementRecent(loadStudioElementsRecent(storage), elementId);
  saveStudioElementsRecent(storage, next);
  return next;
}
