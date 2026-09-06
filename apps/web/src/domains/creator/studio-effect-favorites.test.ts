import { describe, expect, it } from "vitest";

import {
  createStudioEffectId,
  isStudioEffectFavorite,
  loadStudioEffectFavoriteState,
  normalizeStudioEffectFavoriteState,
  rememberStudioEffectRecent,
  saveStudioEffectFavoriteState,
  searchStudioEffectIds,
  toggleStudioEffectFavorite,
} from "./studio-effect-favorites";

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

describe("studio effect favorites", () => {
  it("toggles favorites and remembers recent with persistence", () => {
    const look = createStudioEffectId("look", "warm-afternoon");
    const filter = createStudioEffectId("filter", "ink-wash");
    let state = normalizeStudioEffectFavoriteState();
    state = toggleStudioEffectFavorite(state, look);
    expect(isStudioEffectFavorite(state, look)).toBe(true);
    state = rememberStudioEffectRecent(state, filter);
    state = rememberStudioEffectRecent(state, look);
    expect(state.recent[0]).toBe(look);
    expect(state.recent[1]).toBe(filter);

    const storage = memoryStorage();
    expect(saveStudioEffectFavoriteState(storage, state)).toBe(true);
    const reloaded = loadStudioEffectFavoriteState(storage);
    expect(reloaded.favorites).toContain(look);
    expect(reloaded.recent[0]).toBe(look);
  });

  it("searches catalog by label and keywords", () => {
    const catalog = [
      { id: createStudioEffectId("look", "night"), label: "야간", keywords: ["dark", "밤"] },
      { id: createStudioEffectId("filter", "blur"), label: "흐림", keywords: ["soft"] },
    ] as const;
    expect(searchStudioEffectIds(catalog, "밤")).toHaveLength(1);
    expect(searchStudioEffectIds(catalog, "soft")[0]?.label).toBe("흐림");
    expect(searchStudioEffectIds(catalog, "")).toHaveLength(2);
  });
});
