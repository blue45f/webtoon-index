import { describe, it, expect } from "vitest";

import {
  RECENT_SEARCH_LIMIT,
  addRecentSearch,
  normalizeQuery,
  removeRecentSearch,
} from "../recent-searches";

describe("normalizeQuery", () => {
  it("앞뒤 공백을 제거하고 내부 연속 공백을 1칸으로", () => {
    expect(normalizeQuery("  화산   귀환  ")).toBe("화산 귀환");
  });
  it("탭·개행도 공백으로 접는다", () => {
    expect(normalizeQuery("나 혼자\t\n레벨업")).toBe("나 혼자 레벨업");
  });
  it("80자 상한을 적용", () => {
    expect(normalizeQuery("가".repeat(100))).toHaveLength(80);
  });
});

describe("addRecentSearch", () => {
  it("새 검색어를 맨 앞에 추가", () => {
    expect(addRecentSearch(["b"], "a")).toEqual(["a", "b"]);
  });
  it("빈 문자열/공백은 무시(기존 목록 유지)", () => {
    expect(addRecentSearch(["a"], "   ")).toEqual(["a"]);
    expect(addRecentSearch(["a"], "")).toEqual(["a"]);
  });
  it("대소문자 무시 중복을 제거하고 최신을 맨 앞으로 끌어올린다", () => {
    expect(addRecentSearch(["Solo", "b"], "solo")).toEqual(["solo", "b"]);
  });
  it("저장 전에 정규화한다", () => {
    expect(addRecentSearch([], "  화산  귀환 ")).toEqual(["화산 귀환"]);
  });
  it("상한을 초과하면 가장 오래된 항목을 버린다", () => {
    const full = Array.from({ length: RECENT_SEARCH_LIMIT }, (_, i) => `q${i}`);
    const next = addRecentSearch(full, "new");
    expect(next).toHaveLength(RECENT_SEARCH_LIMIT);
    expect(next[0]).toBe("new");
    expect(next).not.toContain(`q${RECENT_SEARCH_LIMIT - 1}`);
  });
  it("원본 배열을 변형하지 않는다(불변)", () => {
    const original = ["a"];
    addRecentSearch(original, "b");
    expect(original).toEqual(["a"]);
  });
});

describe("removeRecentSearch", () => {
  it("대소문자 무시로 1건을 제거", () => {
    expect(removeRecentSearch(["Solo", "b"], "solo")).toEqual(["b"]);
  });
  it("일치가 없으면 그대로 반환", () => {
    expect(removeRecentSearch(["a", "b"], "c")).toEqual(["a", "b"]);
  });
  it("빈 입력은 목록을 바꾸지 않는다", () => {
    expect(removeRecentSearch(["a"], "  ")).toEqual(["a"]);
  });
});
