import { describe, expect, it } from "vitest";

import { countCharacterAvailability, discoverCharacterEntries, normalizeCharacterSearch } from "./character-shaper-discovery";

import type { CharacterDiscoveryEntry, CharacterDiscoveryOptions } from "./character-shaper-discovery";

const entries: readonly CharacterDiscoveryEntry[] = [
  { id: "hair:bob", label: "순정 보브", labelEn: "Romance Bob", hint: "둥근 앞머리", keywords: ["단발"], tags: ["romance", "school"] },
  { id: "hair:wave", label: "웨이브 헤어", hint: "긴 웨이브", keywords: ["curl"], tags: ["fantasy"] },
  { id: "eyes:cat", label: "고양이 눈", hint: "날카로운 눈꼬리", keywords: ["cat"], tags: ["modern"] },
];
function options(overrides: Partial<CharacterDiscoveryOptions> = {}): CharacterDiscoveryOptions {
  return { query: "", tag: null, collection: "all", favorites: new Set(), selected: new Set(), onlyAvailable: false,
    availability: new Map([["hair:bob", "available"], ["hair:wave", "partial"], ["eyes:cat", "unavailable"]]),
    tagLabels: { school: "학원", romance: "로맨스" }, ...overrides };
}
const find = (overrides: Partial<CharacterDiscoveryOptions> = {}) => discoverCharacterEntries(entries, options(overrides)).map((entry) => entry.id);

describe("character discovery", () => {
  it("preserves curated entry identities without a query", () => {
    expect(discoverCharacterEntries(entries, options())[0]).toBe(entries[0]);
  });
  it("normalizes full width input and case", () => {
    expect(normalizeCharacterSearch("　ＢＯＢ\n HAIR ")).toBe("bob hair");
    expect(find({ query: "ＲＯＭＡＮＣＥ　ㅂㅂ" })).toEqual(["hair:bob"]);
  });
  it("ANDs terms across labels, keywords and localized genres", () => {
    expect(find({ query: "ㅅㅈ 학원" })).toEqual(["hair:bob"]);
    expect(find({ query: "bob cat" })).toEqual([]);
  });
  it("searches decomposed Hangul", () => expect(find({ query: "순정".normalize("NFD") })).toEqual(["hair:bob"]));
  it("intersects favorites, tags and full model support", () => {
    expect(find({ collection: "favorites", favorites: new Set(["hair:wave"]), tag: "fantasy", onlyAvailable: true })).toEqual([]);
  });
  it("does not invent entries for stale favorite ids", () => expect(find({ collection: "favorites", favorites: new Set(["missing"]) })).toEqual([]));
  it("shows every selected accessory rather than only one", () => expect(find({ collection: "selected", selected: new Set(["hair:bob", "eyes:cat"]) })).toEqual(["hair:bob", "eyes:cat"]));
  it("distinguishes partial and unknown support", () => {
    expect(countCharacterAvailability(["hair:bob", "hair:wave", "missing"], options().availability)).toEqual({ available: 1, partial: 1, unavailable: 1 });
    expect(find({ onlyAvailable: true })).toEqual(["hair:bob"]);
  });
  it("recalculates supported entries after a model change", () => expect(find({ onlyAvailable: true, availability: new Map([["hair:wave", "available"]]) })).toEqual(["hair:wave"]));
  it("treats punctuation as literal input", () => expect(find({ query: "[.*]" })).toEqual([]));
});
