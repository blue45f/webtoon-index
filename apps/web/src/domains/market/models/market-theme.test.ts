import { describe, expect, it } from "vitest";

import { MARKET_CURATED_THEMES, filterThemeResources } from "./market-theme";

import { CREATOR_MARKETPLACE_STARTER_RECORDS } from "@/shared/lib/creator-marketplace-starter-catalog";

describe("market-theme", () => {
  it("defines all curated themes with valid metadata", () => {
    expect(MARKET_CURATED_THEMES.length).toBeGreaterThanOrEqual(4);
    for (const theme of MARKET_CURATED_THEMES) {
      expect(theme.id).toBeTruthy();
      expect(theme.title).toBeTruthy();
      expect(theme.tag).toBeTruthy();
      expect(theme.icon).toBeDefined();
    }
  });

  it("correctly filters resources matching theme tag", () => {
    const rofanItems = filterThemeResources(CREATOR_MARKETPLACE_STARTER_RECORDS, "로판");
    expect(rofanItems.length).toBeGreaterThan(0);
    expect(rofanItems.every((item) => item.tags.includes("로판"))).toBe(true);

    const schoolItems = filterThemeResources(CREATOR_MARKETPLACE_STARTER_RECORDS, "학교");
    expect(schoolItems.length).toBeGreaterThan(0);
    expect(schoolItems.every((item) => item.tags.includes("학교"))).toBe(true);
  });
});
