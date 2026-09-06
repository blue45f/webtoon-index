import { describe, expect, it } from "vitest";

import { EMERES_TEMPLATES } from "./studio-emeres-templates";
import { SCENE_TEMPLATES } from "./studio-scene-templates";
import { hasSameCategorySiblings, sameCategoryItems, type CategorizedCatalogItem } from "./studio-similar-style";

interface Fixture extends CategorizedCatalogItem {
  label: string;
}

const CATALOG: Fixture[] = [
  { id: "a1", category: "animal", label: "고양이" },
  { id: "a2", category: "animal", label: "강아지" },
  { id: "a3", category: "animal", label: "토끼" },
  { id: "p1", category: "plant", label: "장미" },
  { id: "p2", category: "plant", label: "튤립" },
  { id: "s1", category: "solo", label: "유일한 항목" },
];

describe("sameCategoryItems", () => {
  it("returns the other items sharing the same category, excluding itself", () => {
    const result = sameCategoryItems(CATALOG, "a1");
    expect(result.map((i) => i.id)).toEqual(["a2", "a3"]);
  });

  it("preserves original catalog order (does not re-sort)", () => {
    const result = sameCategoryItems(CATALOG, "a3");
    expect(result.map((i) => i.id)).toEqual(["a1", "a2"]);
  });

  it("returns an empty array when the item has no siblings in its category", () => {
    expect(sameCategoryItems(CATALOG, "s1")).toEqual([]);
  });

  it("returns an empty array when currentId is not in the catalog", () => {
    expect(sameCategoryItems(CATALOG, "does-not-exist")).toEqual([]);
  });

  it("returns an empty array for an empty catalog", () => {
    expect(sameCategoryItems([], "anything")).toEqual([]);
  });

  it("respects the limit parameter", () => {
    const result = sameCategoryItems(CATALOG, "a1", 1);
    expect(result.map((i) => i.id)).toEqual(["a2"]);
  });

  it("returns everything when limit is larger than the sibling count", () => {
    const result = sameCategoryItems(CATALOG, "a1", 99);
    expect(result.map((i) => i.id)).toEqual(["a2", "a3"]);
  });

  it("clamps a limit of 0 to an empty array", () => {
    expect(sameCategoryItems(CATALOG, "a1", 0)).toEqual([]);
  });

  it("clamps a negative limit to an empty array instead of throwing", () => {
    expect(sameCategoryItems(CATALOG, "a1", -5)).toEqual([]);
  });

  it("does not mutate the input catalog", () => {
    const frozen = Object.freeze(CATALOG.map((item) => Object.freeze({ ...item })));
    expect(() => sameCategoryItems(frozen, "a1", 1)).not.toThrow();
    expect(frozen.map((i) => i.id)).toEqual(["a1", "a2", "a3", "p1", "p2", "s1"]);
  });

  it("is deterministic across repeated calls with the same input", () => {
    const first = sameCategoryItems(CATALOG, "p1");
    const second = sameCategoryItems(CATALOG, "p1");
    expect(second).toEqual(first);
  });

  it("does not throw for a NaN limit and falls back to an empty result instead of silently ignoring the limit", () => {
    // Math.max(0, NaN) is NaN, and Array#slice(0, NaN) treats NaN as 0 (per ToIntegerOrInfinity) — so
    // this resolves deterministically to an empty array rather than crashing or returning everything.
    expect(() => sameCategoryItems(CATALOG, "a1", Number.NaN)).not.toThrow();
    expect(sameCategoryItems(CATALOG, "a1", Number.NaN)).toEqual([]);
  });

  it("treats a +Infinity limit the same as passing no limit at all", () => {
    const result = sameCategoryItems(CATALOG, "a1", Number.POSITIVE_INFINITY);
    expect(result.map((i) => i.id)).toEqual(["a2", "a3"]);
  });
});

describe("hasSameCategorySiblings", () => {
  it("mirrors sameCategoryItems(...).length > 0 for a shared category", () => {
    expect(hasSameCategorySiblings(CATALOG, "a1")).toBe(true);
  });

  it("is false when the item is alone in its category", () => {
    expect(hasSameCategorySiblings(CATALOG, "s1")).toBe(false);
  });

  it("is false when currentId is not in the catalog", () => {
    expect(hasSameCategorySiblings(CATALOG, "nope")).toBe(false);
  });

  it("is exactly equivalent to sameCategoryItems(...).length > 0 for every item in the catalog", () => {
    // This locks in the equivalence the docstring claims, rather than relying on a couple of examples
    // that happen to agree with it.
    for (const item of CATALOG) {
      expect(hasSameCategorySiblings(CATALOG, item.id)).toBe(sameCategoryItems(CATALOG, item.id).length > 0);
    }
    expect(hasSameCategorySiblings(CATALOG, "does-not-exist")).toBe(sameCategoryItems(CATALOG, "does-not-exist").length > 0);
  });
});

// ── 실제 카탈로그 연동 확인 — EmeresTemplate/SceneTemplate 둘 다 { id, category } 모양을 그대로
// 만족해 타입 인자 없이도(구조적 타이핑으로) 바로 재사용 가능함을 고정한다. 카탈로그 내용이 바뀌어도
// 이 테스트가 깨지면 studio-similar-style-integration.md 의 예시 id/카운트도 같이 갱신해야 한다는
// 신호다.
describe("sameCategoryItems + 실제 카탈로그(studio-emeres-templates / studio-scene-templates)", () => {
  it("이메레스: '관계' 카테고리 항목은 서로를 형제로 찾는다", () => {
    const siblings = sameCategoryItems(EMERES_TEMPLATES, "emeres_face_each_other");
    expect(siblings.length).toBeGreaterThan(0);
    expect(siblings.every((t) => t.category === "관계")).toBe(true);
    expect(siblings.some((t) => t.id === "emeres_face_each_other")).toBe(false);
  });

  it("장면 템플릿: 'romance' 카테고리 항목은 서로를 형제로 찾는다", () => {
    const siblings = sameCategoryItems(SCENE_TEMPLATES, "confession");
    expect(siblings.length).toBeGreaterThan(0);
    expect(siblings.every((t) => t.category === "romance")).toBe(true);
    expect(siblings.some((t) => t.id === "confession")).toBe(false);
  });

  it("두 카탈로그 전 항목이 자기 자신을 제외한 채 형제를 찾거나(카테고리 1개뿐이면) 빈 배열을 반환한다", () => {
    for (const t of EMERES_TEMPLATES) {
      const siblings = sameCategoryItems(EMERES_TEMPLATES, t.id);
      expect(siblings.some((s) => s.id === t.id)).toBe(false);
      expect(siblings.every((s) => s.category === t.category)).toBe(true);
    }
    for (const t of SCENE_TEMPLATES) {
      const siblings = sameCategoryItems(SCENE_TEMPLATES, t.id);
      expect(siblings.some((s) => s.id === t.id)).toBe(false);
      expect(siblings.every((s) => s.category === t.category)).toBe(true);
    }
  });
});
