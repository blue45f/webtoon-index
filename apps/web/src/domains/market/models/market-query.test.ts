import { describe, expect, it } from "vitest";

import { parseMarketBrowseQuery, resolveMarketBrowseSort } from "./market-query";

import {
  CREATOR_MARKETPLACE_RESOURCE_QUERY_SEARCH_MAX_CHARACTERS,
  CREATOR_MARKETPLACE_RESOURCE_QUERY_TAG_MAX_CHARACTERS,
} from "@/shared/lib/creator-marketplace-resource-contract";

const PUBLISHER_ID = "123E4567-E89B-42D3-A456-426614174000";

describe("parseMarketBrowseQuery", () => {
  it("trims valid URL filters and canonicalizes the publisher UUID", () => {
    const parsed = parseMarketBrowseQuery(new URLSearchParams({
      q: "  잉크 브러시  ",
      tag: "  수채화  ",
      kind: " brush ",
      license: " cc0-1.0 ",
      publisher: ` ${PUBLISHER_ID} `,
      sort: " relevance ",
    }));

    expect(parsed.issues).toEqual([]);
    expect(parsed.searchDraft).toBe("잉크 브러시");
    expect(parsed.values).toEqual({
      search: "잉크 브러시",
      tag: "수채화",
      kind: "brush",
      license: "cc0-1.0",
      publisher: PUBLISHER_ID.toLowerCase(),
      sort: "relevance",
    });
  });

  it("does not truncate overlong q or tag values into a different query", () => {
    const search = "s".repeat(
      CREATOR_MARKETPLACE_RESOURCE_QUERY_SEARCH_MAX_CHARACTERS + 1
    );
    const tag = "t".repeat(CREATOR_MARKETPLACE_RESOURCE_QUERY_TAG_MAX_CHARACTERS + 1);
    const parsed = parseMarketBrowseQuery(new URLSearchParams({ q: search, tag }));

    expect(parsed.searchDraft).toBe(search);
    expect(parsed.values.search).toBeUndefined();
    expect(parsed.values.tag).toBeUndefined();
    expect(parsed.issues).toEqual([
      expect.objectContaining({ param: "q", code: "too-long" }),
      expect.objectContaining({ param: "tag", code: "too-long" }),
    ]);
    expect(parsed.issues.map((issue) => issue.message).join(" ")).toContain("자동으로 자르지");
  });

  it("reports duplicate, control-character, enum, and UUID filters instead of widening", () => {
    const searchParams = new URLSearchParams();
    searchParams.append("q", "first");
    searchParams.append("q", "second");
    searchParams.set("tag", `ink${String.fromCharCode(0)}`);
    searchParams.set("kind", "unknown");
    searchParams.set("license", "commercial");
    searchParams.set("publisher", "not-a-uuid");
    searchParams.set("sort", "popular");

    const parsed = parseMarketBrowseQuery(searchParams);

    expect(parsed.values).toEqual({
      search: undefined,
      tag: undefined,
      kind: undefined,
      license: undefined,
      publisher: undefined,
      sort: undefined,
    });
    expect(parsed.issues.map(({ param, code }) => [param, code])).toEqual([
      ["q", "duplicate"],
      ["tag", "invalid"],
      ["kind", "invalid"],
      ["license", "invalid"],
      ["publisher", "invalid"],
      ["sort", "invalid"],
    ]);
  });

  it("검색 여부에 따라 신뢰할 수 있는 기본 정렬을 결정한다", () => {
    expect(resolveMarketBrowseSort({})).toBe("newest");
    expect(resolveMarketBrowseSort({ search: "잉크" })).toBe("relevance");
    expect(resolveMarketBrowseSort({ search: "잉크", sort: "newest" })).toBe(
      "newest"
    );
  });

  it("검색어 없는 관련도순 URL을 요청 전에 거절한다", () => {
    const parsed = parseMarketBrowseQuery(new URLSearchParams({ sort: "relevance" }));

    expect(parsed.values.sort).toBe("relevance");
    expect(parsed.issues).toEqual([
      expect.objectContaining({ param: "sort", code: "invalid" }),
    ]);
  });
});
