/** Small, versioned local preference store. No scene, images, tokens or account data are stored. */
export const CHARACTER_FAVORITES_KEY = "toonstudio.character-shaper.favorites.v1";
export const CHARACTER_FAVORITES_LIMIT = 256;
const MAX_ID_LENGTH = 160;
// JSON may expand one UTF-16 code unit to six characters (e.g. a lone surrogate).
// Derive the read budget from the accepted id/count limits so our own writes always round-trip.
const MAX_STORAGE_LENGTH = 32 + CHARACTER_FAVORITES_LIMIT * (MAX_ID_LENGTH * 6 + 3);

export interface CharacterFavoritesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface CharacterFavoritesSnapshot {
  readonly ids: readonly string[];
  readonly persistence: "persistent" | "memory";
  readonly notice: string | null;
  readonly hasPendingChanges: boolean;
}

export const EMPTY_CHARACTER_FAVORITES: CharacterFavoritesSnapshot = Object.freeze({
  ids: Object.freeze([] as string[]), persistence: "memory", notice: null, hasPendingChanges: false,
});

type ParsedFavorites =
  | { readonly ok: true; readonly ids: readonly string[] }
  | { readonly ok: false; readonly reason: string };

function validId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id.length <= MAX_ID_LENGTH
    && id === id.trim()
    && Array.from(id).every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127);
}

/** Fail closed on future schemas or damaged data; never silently overwrite them. */
export function parseCharacterFavorites(raw: string | null): ParsedFavorites {
  if (raw === null) return { ok: true, ids: [] };
  if (raw.length > MAX_STORAGE_LENGTH) return { ok: false, reason: "저장된 즐겨찾기 크기가 너무 큽니다." };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, reason: "저장된 즐겨찾기 형식을 읽을 수 없습니다." };
    }
    const data = value as Record<string, unknown>;
    if (data.version !== 1) return { ok: false, reason: "다른 버전의 즐겨찾기는 덮어쓰지 않습니다." };
    if (!Array.isArray(data.ids) || data.ids.length > CHARACTER_FAVORITES_LIMIT || !data.ids.every(validId)) {
      return { ok: false, reason: "저장된 즐겨찾기 목록을 읽을 수 없습니다." };
    }
    return { ok: true, ids: [...new Set(data.ids as string[])].sort() };
  } catch {
    return { ok: false, reason: "저장된 즐겨찾기가 손상되어 이번 세션에서만 보관합니다." };
  }
}

export interface CharacterFavoriteStore {
  getSnapshot(): CharacterFavoritesSnapshot;
  subscribe(listener: () => void): () => void;
  refresh(): void;
  setFavorite(id: string, favorite: boolean): void;
  /** Retry only unsaved edits, merging the latest stored preferences first. */
  retrySave(): void;
}

/**
 * Injected storage keeps this testable without a browser. Reads latest storage before an explicit
 * mutation. Unsaved session edits survive quota/read failures. Simultaneous tab writes are still
 * last-writer-wins: localStorage has no transaction/CAS; this is not collaboration state.
 */
export function createCharacterFavoriteStore(
  storageProvider: () => CharacterFavoritesStorage | null,
): CharacterFavoriteStore {
  let snapshot = EMPTY_CHARACTER_FAVORITES;
  const listeners = new Set<() => void>();
  const pending = new Map<string, boolean>();

  const publish = (ids: readonly string[], persistence: CharacterFavoritesSnapshot["persistence"], notice: string | null) => {
    const sorted = [...new Set(ids)].sort();
    const hasPendingChanges = pending.size > 0;
    if (snapshot.persistence === persistence && snapshot.notice === notice
      && snapshot.hasPendingChanges === hasPendingChanges
      && snapshot.ids.length === sorted.length && snapshot.ids.every((id, index) => id === sorted[index])) return;
    snapshot = Object.freeze({ ids: Object.freeze(sorted), persistence, notice, hasPendingChanges });
    for (const listener of listeners) listener();
  };

  const read = (): { storage: CharacterFavoritesStorage | null; parsed: ParsedFavorites } => {
    try {
      const storage = storageProvider();
      if (!storage) return { storage: null, parsed: { ok: false as const, reason: "이번 세션에서만 즐겨찾기를 보관합니다." } };
      return { storage, parsed: parseCharacterFavorites(storage.getItem(CHARACTER_FAVORITES_KEY)) };
    } catch {
      return { storage: null, parsed: { ok: false as const, reason: "브라우저 저장소에 접근할 수 없어 이번 세션에서만 보관합니다." } };
    }
  };

  const mergePending = (ids: readonly string[]) => {
    const merged = new Set(ids);
    // Remove first: an offline deletion may make room for an offline addition.
    for (const [id, enabled] of pending) if (!enabled) merged.delete(id);
    for (const [id, enabled] of pending) if (enabled) merged.add(id);
    return [...merged];
  };

  const refresh = () => {
    const { parsed } = read();
    if (!parsed.ok) {
      publish(snapshot.ids, "memory", parsed.reason);
      return;
    }
    const merged = mergePending(parsed.ids);
    if (merged.length > CHARACTER_FAVORITES_LIMIT) {
      publish(snapshot.ids, "memory", "다른 탭의 변경과 합치면 즐겨찾기 한도를 넘습니다. 일부 항목을 해제해 주세요.");
      return;
    }
    publish(merged, pending.size ? "memory" : "persistent",
      pending.size ? "아직 저장하지 못한 변경이 있어 이번 세션에도 보관 중입니다." : null);
  };

  const persist = (ids: readonly string[], loaded: ReturnType<typeof read>) => {
    const { storage, parsed } = loaded;
    if (parsed.ok && storage) {
      const raw = JSON.stringify({ version: 1, ids: [...ids].sort() });
      // Keep a final invariant guard even if future id or schema limits change independently.
      if (!parseCharacterFavorites(raw).ok) {
        publish(ids, "memory", "즐겨찾기 저장 형식을 확인할 수 없어 이번 세션에서만 보관합니다.");
        return;
      }
      try {
        storage.setItem(CHARACTER_FAVORITES_KEY, raw);
        pending.clear();
        publish(ids, "persistent", null);
        return;
      } catch {
        publish(ids, "memory", "즐겨찾기를 저장하지 못해 이번 세션에서만 보관합니다.");
        return;
      }
    }
    publish(ids, "memory", parsed.ok ? "이번 세션에서만 보관합니다." : parsed.reason);
  };

  const retrySave = () => {
    if (pending.size === 0) {
      refresh();
      return;
    }
    const loaded = read();
    if (!loaded.parsed.ok) {
      publish(snapshot.ids, "memory", loaded.parsed.reason);
      return;
    }
    const merged = mergePending(loaded.parsed.ids);
    if (merged.length > CHARACTER_FAVORITES_LIMIT) {
      publish(snapshot.ids, "memory", "다른 탭의 변경과 합치면 즐겨찾기 한도를 넘습니다. 일부 항목을 해제해 주세요.");
      return;
    }
    persist(merged, loaded);
  };

  const setFavorite = (id: string, favorite: boolean) => {
    if (!validId(id)) return;
    const { storage, parsed } = read();
    const next = new Set(mergePending(parsed.ok ? parsed.ids : snapshot.ids));
    if (favorite) next.add(id);
    else next.delete(id);
    if (next.size > CHARACTER_FAVORITES_LIMIT) {
      if (!favorite) {
        pending.set(id, false);
        publish(snapshot.ids.filter((item) => item !== id), "memory",
          "다른 탭의 변경과 합치면 한도를 넘습니다. 해제한 항목은 세션에 보관하며 추가 해제가 필요합니다.");
      } else {
        publish(snapshot.ids, snapshot.persistence, `즐겨찾기는 최대 ${CHARACTER_FAVORITES_LIMIT}개입니다.`);
      }
      return;
    }
    if (snapshot.ids.includes(id) === favorite && pending.size === 0 && parsed.ok
      && parsed.ids.length === next.size && parsed.ids.every((item) => next.has(item))) {
      publish([...next], "persistent", null);
      return;
    }
    pending.set(id, favorite);
    persist([...next], { storage, parsed });
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh,
    setFavorite,
    retrySave,
  };
}
