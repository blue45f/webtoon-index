import { describe, expect, it } from "vitest";

import {
  BUBBLE_OUTLINE_STYLE_OPTIONS,
  normalizeBubbleOutlineStyle,
  styledBubblePathData,
  styledBubblePolygonPathData,
} from "./studio-bubble-outline-style";

describe("normalizeBubbleOutlineStyle", () => {
  it("rough/wobbly 만 통과하고 나머지는 undefined(매끈)", () => {
    expect(normalizeBubbleOutlineStyle("rough")).toBe("rough");
    expect(normalizeBubbleOutlineStyle("wobbly")).toBe("wobbly");
    expect(normalizeBubbleOutlineStyle("smooth")).toBeUndefined();
    expect(normalizeBubbleOutlineStyle(undefined)).toBeUndefined();
    expect(normalizeBubbleOutlineStyle(42)).toBeUndefined();
  });

  it("옵션 카탈로그는 smooth(기본)+rough+wobbly 를 모두 노출한다", () => {
    const ids = BUBBLE_OUTLINE_STYLE_OPTIONS.map((o) => o.id);
    expect(ids).toEqual(["smooth", "rough", "wobbly"]);
  });
});

describe("styledBubblePathData", () => {
  // 사각형에 가까운 닫힌 path(d) — variant 실루엣의 대역.
  const squareD = "M 0 0 L 100 0 L 100 60 L 0 60 Z";

  it("style=undefined 는 입력 d 를 바이트 그대로 돌려준다(하위호환)", () => {
    expect(styledBubblePathData(squareD, undefined, "el-1", 3)).toBe(squareD);
  });

  it("rough/wobbly 는 입력과 다른 d 를 만든다", () => {
    const rough = styledBubblePathData(squareD, "rough", "el-1", 3);
    const wobbly = styledBubblePathData(squareD, "wobbly", "el-1", 3);
    expect(rough).not.toBe(squareD);
    expect(wobbly).not.toBe(squareD);
    expect(rough.length).toBeGreaterThan(0);
    expect(wobbly.length).toBeGreaterThan(0);
    // 두 스타일은 서로 다른 파라미터(직선 vs 스무딩)라 결과도 달라야 한다.
    expect(rough).not.toBe(wobbly);
  });

  it("결정적 — 같은 (d, style, seedKey, strokeWidth) 는 항상 같은 d, seedKey 가 다르면 달라진다", () => {
    const a = styledBubblePathData(squareD, "rough", "el-1", 3);
    const b = styledBubblePathData(squareD, "rough", "el-1", 3);
    const c = styledBubblePathData(squareD, "rough", "el-2", 3);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("점이 부족한 폴리곤은 방어적으로 빈/폴리라인 문자열", () => {
    expect(styledBubblePolygonPathData([0, 0, 1, 1], "rough", "k", 2)).toContain("M");
    expect(styledBubblePolygonPathData([0, 0], "rough", "k", 2)).toBe("");
  });
});
