import { describe, expect, it } from "vitest";

import { matchesStudioToolSearch, normalizeStudioToolSearch, studioToolSearchTerms } from "./studio-tool-search";

describe("local tool discovery search", () => {
  it("normalizes full-width Latin and decomposed Korean without discarding literal punctuation", () => {
    expect(normalizeStudioToolSearch("  ＧＰＥＮ  ")).toBe("gpen");
    expect(normalizeStudioToolSearch("선화".normalize("NFD"))).toBe("선화");
    expect(studioToolSearchTerms("  Ｇ pen\n선화  ")).toEqual(["g", "pen", "선화"]);
  });
  it("AND-matches separate words over names, IDs, aliases, and descriptions", () => {
    expect(matchesStudioToolSearch(studioToolSearchTerms("선화 ＧＰＥＮ"), ["G펜", "gpen", "웹툰 선화"])).toBe(true);
    expect(matchesStudioToolSearch(studioToolSearchTerms("선화 목탄"), ["G펜", "웹툰 선화"])).toBe(false);
    expect(matchesStudioToolSearch(studioToolSearchTerms("["), ["[일반]"])).toBe(true);
    expect(matchesStudioToolSearch([], [undefined])).toBe(true);
  });
});
