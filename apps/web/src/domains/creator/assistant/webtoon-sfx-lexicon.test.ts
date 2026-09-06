import { describe, expect, it } from "vitest";

import {
  SFX_LEXICON_DATABASE,
  WebtoonSfxLexiconEngine,
  type SfxCategory,
} from "./webtoon-sfx-lexicon";

describe("WebtoonSfxLexiconEngine", () => {
  const engine = new WebtoonSfxLexiconEngine();

  it("contains 48 unique effects balanced across 8 categories", () => {
    expect(SFX_LEXICON_DATABASE).toHaveLength(48);
    expect(new Set(SFX_LEXICON_DATABASE.map((item) => item.id)).size).toBe(48);
    expect(engine.listCategories()).toHaveLength(8);

    for (const category of engine.listCategories()) {
      expect(engine.search("", category.id)).toHaveLength(6);
    }
  });

  it("filters items by category correctly", () => {
    const impacts = engine.search("", "impact");
    expect(impacts).toHaveLength(6);
    expect(impacts.every((item) => item.category === "impact")).toBe(true);

    const magic = engine.search("", "magic-scifi");
    expect(magic).toHaveLength(6);
  });

  it("searches by text, tag, meaning, category, and normalized whitespace", () => {
    expect(engine.search("쿵")[0]?.text).toBe("쿵");
    expect(engine.search("암살").some((item) => item.text === "스윽")).toBe(true);
    expect(engine.search("천둥").some((item) => item.text === "콰르릉")).toBe(true);
    const categoryMatches = engine.search("특수");
    expect(categoryMatches).toHaveLength(6);
    expect(categoryMatches.every((item) => item.category === "magic-scifi")).toBe(true);
    expect(engine.search("두 근")[0]?.text).toBe("두근");
  });

  it("ranks exact text ahead of a genuine tag substring match", () => {
    // 탁 is an exact entry; 퍼엉 has the tag 둔탁. Both genuinely match this query.
    const results = engine.search("탁");

    expect(results[0]?.text).toBe("탁");
    expect(results.findIndex((item) => item.text === "퍼엉")).toBeGreaterThan(0);
  });

  it("does not invent fuzzy matches absent from the text, tags, meaning, or category", () => {
    const results = engine.search("펑");

    expect(results[0]?.text).toBe("펑");
    expect(results.some((item) => item.text === "퍼엉")).toBe(false);
  });

  it("combines ranked search with category filtering", () => {
    const categories: readonly SfxCategory[] = ["impact", "destruction", "magic-scifi"];
    for (const category of categories) {
      const matches = engine.search("폭발", category);
      expect(matches.length).toBeGreaterThan(0);
      expect(matches.every((item) => item.category === category)).toBe(true);
    }
  });

  it("retrieves an item by unique ID", () => {
    const item = engine.getById("sfx-dugeun");
    expect(item).toBeDefined();
    expect(item?.text).toBe("두근");
    expect(item?.category).toBe("emotion");
    expect(engine.getById("missing")).toBeUndefined();
  });

  it("recommends related alternatives without returning the selected effect", () => {
    const related = engine.getRelated("sfx-dugeun", 5);

    expect(related).toHaveLength(5);
    expect(related.some((item) => item.id === "sfx-dugeun")).toBe(false);
    expect(related.some((item) => item.tags.includes("심장"))).toBe(true);
    expect(engine.getRelated("missing")).toEqual([]);
    expect(engine.getRelated("sfx-dugeun", 0)).toEqual([]);
  });
});