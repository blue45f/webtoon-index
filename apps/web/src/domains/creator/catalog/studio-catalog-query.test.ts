import { describe, expect, it } from "vitest";

import { normalizeStudioCatalogText, queryStudioCatalog, studioCatalogOrientation, studioCatalogTerms } from "./studio-catalog-query";

const source = Object.freeze([
  { id: "corner", label: "구석 집중선", category: "effect", keywords: ["focus corner"], width: 400, height: 240 },
  { id: "radial", label: "집중선", category: "effect", keywords: ["radial"], width: 240, height: 240 },
  { id: "office", label: "회의실", category: "daily", description: "회사 대화", width: 240, height: 400 },
  { id: "classroom", label: "교실", category: "school", width: 240, height: 240 },
]);
describe("bounded catalog search", () => {
  it("normalizes full width Latin, Korean whitespace and case", () => expect(normalizeStudioCatalogText(" ＦＯＣＵＳ\n  학교 ")).toBe("focus 학교"));
  it("supports quoted phrases and AND terms", () => {
    expect(studioCatalogTerms('"focus corner" 집중선')).toEqual(["focus corner", "집중선"]);
    expect(queryStudioCatalog(source, { query: "focus corner" }).map((x) => x.id)).toEqual(["corner"]);
  });
  it("recognizes use synonyms in both Korean and English", () => {
    expect(queryStudioCatalog(source, { query: "office" }).map((x) => x.id)).toEqual(["office"]);
    expect(queryStudioCatalog(source, { query: "학교" }).map((x) => x.id)).toEqual(["classroom"]);
  });
  it("ranks exact labels above partial labels", () => expect(queryStudioCatalog(source, { query: "집중선" }).map((x) => x.id)).toEqual(["radial", "corner"]));
  it("combines category, orientation and favorites without changing source", () => {
    expect(queryStudioCatalog(source, { category: "effect", orientation: "landscape", favoritesOnly: true, favoriteIds: ["corner", "office"] })).toEqual([source[0]]);
    expect(source[0].id).toBe("corner");
  });
  it("sorts recent first without hiding the rest", () => expect(queryStudioCatalog(source, { sort: "recent", recentIds: ["office", "corner"] }).map((x) => x.id)).toEqual(["office", "corner", "radial", "classroom"]));
  it("bounded terms never treat regex text as a pattern", () => {
    expect(queryStudioCatalog(source, { query: "(a+)+$" })).toEqual([]);
    expect(studioCatalogTerms("a ".repeat(1000))).toHaveLength(12);
    expect(studioCatalogTerms('"unfinished')).toEqual(["unfinished"]);
  });
  it("treats invalid dimensions as unknown, not portrait or landscape", () => {
    for (const width of [-1, 0, NaN, Infinity]) expect(studioCatalogOrientation({ ...source[0], width })).toBe("all");
  });
  it("keeps empty search stable and ignores stale favorite IDs", () => {
    expect(queryStudioCatalog(source)).toEqual(source);
    expect(queryStudioCatalog(source, { favoritesOnly: true, favoriteIds: ["deleted"] })).toEqual([]);
  });
});
