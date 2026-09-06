import { describe, expect, it } from "vitest";

import {
  applyStrokeStyleToCtx,
  arrowDotRadius,
  arrowHeadGeometry,
  arrowHeadSize,
  DEFAULT_SHAPE_PARAMS,
  DEFAULT_STROKE_STYLE,
  effectiveCornerRadius,
  isDefaultShapeParams,
  isDefaultStrokeStyle,
  lineArrowHeadGeoms,
  normalizeShapeParams,
  normalizeStrokeStyle,
  pathPointsToSvg,
  polygonPathPoints,
  polygonPathPointsInBounds,
  polygonPathNodeLayoutInBounds,
  SHAPE_PARAM_RANGES,
  starPathPoints,
  STROKE_ARROW_HEADS,
  STROKE_DASH_PRESETS,
  STROKE_LINE_CAPS,
  strokeDashArray,
  strokeStyleNodeProps,
  traceArrowHeadOnCtx,
  type ArrowHeadGeom,
  type StrokeStyle,
} from "./studio-stroke-shapes";

// 화살촉이 있는 스타일을 빠르게 만드는 헬퍼.
function styleWith(patch: Partial<StrokeStyle>): StrokeStyle {
  return { ...DEFAULT_STROKE_STYLE, ...patch };
}

// 부동소수 오차 방지용 소수 첫째 자리 반올림.
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

describe("STROKE_DASH_PRESETS / STROKE_LINE_CAPS / STROKE_ARROW_HEADS", () => {
  it("점선 프리셋은 정확히 6종이고 id가 유일하다", () => {
    expect(STROKE_DASH_PRESETS).toHaveLength(6);
    const ids = STROKE_DASH_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["solid", "dash", "longDash", "dot", "dashDot", "sparse"]);
  });

  it("실선만 빈 패턴이고 나머지는 짝수 길이 패턴을 가진다", () => {
    for (const preset of STROKE_DASH_PRESETS) {
      if (preset.id === "solid") {
        expect(preset.pattern).toHaveLength(0);
      } else {
        expect(preset.pattern.length).toBeGreaterThan(0);
        expect(preset.pattern.length % 2).toBe(0);
        expect(preset.pattern.every((seg) => seg > 0)).toBe(true);
      }
    }
  });

  it("선 끝 3종·화살촉 3종을 한글 라벨과 함께 노출한다", () => {
    expect(STROKE_LINE_CAPS.map((c) => c.id)).toEqual(["butt", "round", "square"]);
    expect(STROKE_ARROW_HEADS.map((h) => h.id)).toEqual(["none", "arrow", "dot"]);
    expect(STROKE_ARROW_HEADS.map((h) => h.label)).toEqual(["없음", "화살촉", "점"]);
  });
});

describe("strokeDashArray", () => {
  it("실선은 undefined(대시 미적용)를 반환한다", () => {
    expect(strokeDashArray("solid", 4)).toBeUndefined();
  });

  it("패턴을 선 굵기에 비례해 스케일한다", () => {
    expect(strokeDashArray("dash", 2)).toEqual([6, 4]);
    expect(strokeDashArray("longDash", 2)).toEqual([12, 6]);
    expect(strokeDashArray("dashDot", 1)).toEqual([5, 2, 1, 2]);
  });

  it("선 굵기 1 미만/비정상 값은 1로 취급한다", () => {
    expect(strokeDashArray("dot", 0)).toEqual(strokeDashArray("dot", 1));
    expect(strokeDashArray("dot", Number.NaN)).toEqual(strokeDashArray("dot", 1));
  });

  it("모든 세그먼트는 최소 0.5px 이상이다(굵기가 커져도 0 없음)", () => {
    for (const preset of STROKE_DASH_PRESETS) {
      const arr = strokeDashArray(preset.id, 12);
      if (arr) expect(arr.every((seg) => seg >= 0.5)).toBe(true);
    }
  });
});

describe("normalizeStrokeStyle / isDefaultStrokeStyle", () => {
  it("미설정(undefined)은 기본값 복사본을 반환한다", () => {
    const style = normalizeStrokeStyle(undefined);
    expect(style).toEqual(DEFAULT_STROKE_STYLE);
    expect(style).not.toBe(DEFAULT_STROKE_STYLE);
  });

  it("유효한 값은 그대로 통과한다", () => {
    const input: StrokeStyle = { dash: "dashDot", lineCap: "square", arrowStart: "dot", arrowEnd: "arrow" };
    expect(normalizeStrokeStyle(input)).toEqual(input);
  });

  it("필드별 이상값은 그 필드만 기본값으로 되돌린다", () => {
    expect(normalizeStrokeStyle({ dash: "zigzag", lineCap: "round", arrowStart: 3, arrowEnd: "dot" })).toEqual({
      dash: "solid",
      lineCap: "round",
      arrowStart: "none",
      arrowEnd: "dot",
    });
  });

  it("isDefaultStrokeStyle은 기본값에서만 true", () => {
    expect(isDefaultStrokeStyle(DEFAULT_STROKE_STYLE)).toBe(true);
    expect(isDefaultStrokeStyle(styleWith({ dash: "dot" }))).toBe(false);
    expect(isDefaultStrokeStyle(styleWith({ arrowEnd: "arrow" }))).toBe(false);
  });
});

describe("strokeStyleNodeProps / applyStrokeStyleToCtx", () => {
  it("Konva 스프레드용 props를 만든다(실선은 dash undefined)", () => {
    expect(strokeStyleNodeProps(DEFAULT_STROKE_STYLE, 3)).toEqual({ dash: undefined, lineCap: "round" });
    expect(strokeStyleNodeProps(styleWith({ dash: "dash", lineCap: "butt" }), 2)).toEqual({
      dash: [6, 4],
      lineCap: "butt",
    });
  });

  it("ctx에 lineCap과 dash를 적용하고, 실선은 빈 배열로 해제한다", () => {
    const calls: number[][] = [];
    const ctx = {
      lineCap: "butt",
      setLineDash(segments: number[]) {
        calls.push(segments);
      },
    };
    applyStrokeStyleToCtx(ctx, styleWith({ dash: "dot", lineCap: "square" }), 2);
    expect(ctx.lineCap).toBe("square");
    expect(calls).toEqual([[2, 4]]);

    applyStrokeStyleToCtx(ctx, DEFAULT_STROKE_STYLE, 2);
    expect(ctx.lineCap).toBe("round");
    expect(calls[1]).toEqual([]);
  });
});

describe("arrowHeadGeometry", () => {
  it("none이면 null", () => {
    expect(arrowHeadGeometry(10, 20, 0, 4, "none")).toBeNull();
  });

  it("dot은 끝점 중심의 원(굵기 비례 반지름, 최소 3px)", () => {
    expect(arrowHeadGeometry(10, 20, 0, 1, "dot")).toEqual({ kind: "dot", cx: 10, cy: 20, r: 3 });
    expect(arrowHeadGeometry(10, 20, Math.PI, 10, "dot")).toEqual({ kind: "dot", cx: 10, cy: 20, r: 12 });
  });

  it("arrow는 꼭짓점이 정확히 끝점인 닫힌 삼각형(좌표 6개)", () => {
    const geom = arrowHeadGeometry(100, 50, 0, 2, "arrow");
    expect(geom).not.toBeNull();
    if (!geom || geom.kind !== "arrow") throw new Error("arrow 지오메트리가 아님");
    expect(geom.points).toHaveLength(6);
    // 꼭짓점 = 끝점
    expect(geom.points[0]).toBe(100);
    expect(geom.points[1]).toBe(50);
    // 날개 2개는 진행 방향(+x) 반대쪽(x < 100)에, y는 50 기준 대칭.
    expect(geom.points[2]!).toBeLessThan(100);
    expect(geom.points[4]!).toBeLessThan(100);
    expect(geom.points[2]).toBe(geom.points[4]);
    expect(round1(geom.points[3]! + geom.points[5]!)).toBe(100);
  });

  it("화살촉 크기·점 반지름은 최소값을 보장한다", () => {
    expect(arrowHeadSize(1)).toBe(8);
    expect(arrowHeadSize(10)).toBe(25);
    expect(arrowDotRadius(1)).toBe(3);
    expect(arrowDotRadius(10)).toBe(12);
  });
});

describe("lineArrowHeadGeoms", () => {
  const line = [10, 10, 90, 10]; // 왼쪽 → 오른쪽 수평선

  it("화살촉이 둘 다 none이면 빈 배열", () => {
    expect(lineArrowHeadGeoms(line, DEFAULT_STROKE_STYLE, 2)).toEqual([]);
  });

  it("끝 화살촉은 진행 방향(+x)을, 시작 화살촉은 반대(-x)를 향한다", () => {
    const geoms = lineArrowHeadGeoms(line, styleWith({ arrowStart: "arrow", arrowEnd: "arrow" }), 2);
    expect(geoms).toHaveLength(2);
    const [start, end] = geoms as [ArrowHeadGeom & { kind: "arrow" }, ArrowHeadGeom & { kind: "arrow" }];
    // 시작 화살촉: 꼭짓점 (10,10), 날개는 선 안쪽(x > 10).
    expect(start.points[0]).toBe(10);
    expect(start.points[2]!).toBeGreaterThan(10);
    // 끝 화살촉: 꼭짓점 (90,10), 날개는 선 안쪽(x < 90).
    expect(end.points[0]).toBe(90);
    expect(end.points[2]!).toBeLessThan(90);
  });

  it("시작 점(dot) + 끝 화살촉 조합을 지원한다", () => {
    const geoms = lineArrowHeadGeoms(line, styleWith({ arrowStart: "dot", arrowEnd: "arrow" }), 2);
    expect(geoms).toHaveLength(2);
    expect(geoms[0]).toEqual({ kind: "dot", cx: 10, cy: 10, r: 3 });
    expect(geoms[1]!.kind).toBe("arrow");
  });

  it("점이 부족하거나 길이 0인 선·비유한 좌표는 빈 배열", () => {
    const both = styleWith({ arrowStart: "arrow", arrowEnd: "arrow" });
    expect(lineArrowHeadGeoms([10, 10], both, 2)).toEqual([]);
    expect(lineArrowHeadGeoms([10, 10, 10, 10], both, 2)).toEqual([]);
    expect(lineArrowHeadGeoms([10, 10, Number.NaN, 10], both, 2)).toEqual([]);
  });

  it("여러 점 폴리라인은 마지막 세그먼트 방향으로 끝 화살촉을 정한다", () => {
    // 오른쪽으로 가다 아래로 꺾이는 폴리라인 — 끝 화살촉은 아래(+y)를 향해야 한다.
    const poly = [0, 0, 50, 0, 50, 40];
    const geoms = lineArrowHeadGeoms(poly, styleWith({ arrowEnd: "arrow" }), 2);
    expect(geoms).toHaveLength(1);
    const end = geoms[0]! as ArrowHeadGeom & { kind: "arrow" };
    expect(end.points[0]).toBe(50);
    expect(end.points[1]).toBe(40);
    // 날개는 끝점보다 위(y < 40).
    expect(end.points[3]!).toBeLessThan(40);
    expect(end.points[5]!).toBeLessThan(40);
  });
});

describe("traceArrowHeadOnCtx", () => {
  function fakeCtx() {
    const ops: string[] = [];
    return {
      ops,
      beginPath: () => ops.push("beginPath"),
      moveTo: (x: number, y: number) => ops.push(`moveTo:${x},${y}`),
      lineTo: (x: number, y: number) => ops.push(`lineTo:${x},${y}`),
      closePath: () => ops.push("closePath"),
      arc: (x: number, y: number, r: number) => ops.push(`arc:${x},${y},${r}`),
      fill: () => ops.push("fill"),
    };
  }

  it("dot은 arc + fill로 그린다", () => {
    const ctx = fakeCtx();
    traceArrowHeadOnCtx(ctx, { kind: "dot", cx: 5, cy: 6, r: 3 });
    expect(ctx.ops).toEqual(["beginPath", "arc:5,6,3", "fill"]);
  });

  it("arrow는 닫힌 삼각형 패스 + fill로 그린다", () => {
    const ctx = fakeCtx();
    traceArrowHeadOnCtx(ctx, { kind: "arrow", points: [0, 0, -8, 3, -8, -3] });
    expect(ctx.ops).toEqual(["beginPath", "moveTo:0,0", "lineTo:-8,3", "lineTo:-8,-3", "closePath", "fill"]);
  });
});

describe("DEFAULT_SHAPE_PARAMS / normalizeShapeParams", () => {
  it("기본값은 기존 하드코딩 렌더와 동일하다(별 5각·내부 1/2·육각형·모서리 3px)", () => {
    expect(DEFAULT_SHAPE_PARAMS).toEqual({ starPoints: 5, starInnerRatio: 0.5, polygonSides: 6, cornerRadius: 3 });
  });

  it("미설정/비객체는 기본값 복사본", () => {
    expect(normalizeShapeParams(undefined)).toEqual(DEFAULT_SHAPE_PARAMS);
    expect(normalizeShapeParams("junk")).toEqual(DEFAULT_SHAPE_PARAMS);
    expect(normalizeShapeParams(undefined)).not.toBe(DEFAULT_SHAPE_PARAMS);
  });

  it("범위를 벗어나면 SHAPE_PARAM_RANGES로 클램프하고 정수 필드는 반올림한다", () => {
    expect(
      normalizeShapeParams({ starPoints: 99, starInnerRatio: -1, polygonSides: 4.4, cornerRadius: 999 })
    ).toEqual({
      starPoints: SHAPE_PARAM_RANGES.starPoints.max,
      starInnerRatio: SHAPE_PARAM_RANGES.starInnerRatio.min,
      polygonSides: 4,
      cornerRadius: SHAPE_PARAM_RANGES.cornerRadius.max,
    });
  });

  it("isDefaultShapeParams는 기본값에서만 true", () => {
    expect(isDefaultShapeParams(DEFAULT_SHAPE_PARAMS)).toBe(true);
    expect(isDefaultShapeParams({ ...DEFAULT_SHAPE_PARAMS, polygonSides: 8 })).toBe(false);
  });
});

describe("starPathPoints", () => {
  it("꼭짓점 n개면 좌표 4n개(외곽/내부 정점 교차)를 만든다", () => {
    const pts = starPathPoints(0, 0, 10, { starPoints: 5, starInnerRatio: 0.5 });
    expect(pts).toHaveLength(20);
  });

  it("첫 정점은 12시 방향 외곽 꼭짓점이다", () => {
    const pts = starPathPoints(24, 24, 20, DEFAULT_SHAPE_PARAMS);
    expect(pts[0]).toBe(24);
    expect(pts[1]).toBe(4); // 24 - 20
  });

  it("외곽·내부 정점이 지정 반경 위에 번갈아 놓인다", () => {
    const outer = 10;
    const ratio = 0.4;
    const pts = starPathPoints(0, 0, outer, { starPoints: 6, starInnerRatio: ratio });
    for (let i = 0; i + 1 < pts.length; i += 2) {
      const dist = Math.hypot(pts[i]!, pts[i + 1]!);
      const expected = (i / 2) % 2 === 0 ? outer : outer * ratio;
      expect(Math.abs(dist - expected)).toBeLessThan(0.05);
    }
  });

  it("이상 파라미터는 클램프된다(3각 미만 없음)", () => {
    const pts = starPathPoints(0, 0, 10, { starPoints: 1, starInnerRatio: 5 });
    expect(pts).toHaveLength(12); // 3각 × 2정점 × 2좌표
  });
});

describe("polygonPathPoints", () => {
  it("변 수만큼 정점을 만들고 첫 정점은 12시 방향", () => {
    const pts = polygonPathPoints(0, 0, 10, 6);
    expect(pts).toHaveLength(12);
    expect(pts[0]).toBe(0);
    expect(pts[1]).toBe(-10);
  });

  it("모든 정점이 반경 위에 있다", () => {
    const pts = polygonPathPoints(5, 5, 7, 8);
    for (let i = 0; i + 1 < pts.length; i += 2) {
      expect(Math.abs(Math.hypot(pts[i]! - 5, pts[i + 1]! - 5) - 7)).toBeLessThan(0.05);
    }
  });

  it("변 수는 3..12로 클램프된다", () => {
    expect(polygonPathPoints(0, 0, 10, 2)).toHaveLength(6);
    expect(polygonPathPoints(0, 0, 10, 40)).toHaveLength(24);
  });
});

describe("polygonPathPointsInBounds", () => {
  it.each([3, 5, 6, 10])("%i각형이 가로·세로가 다른 bbox의 네 경계를 모두 사용한다", (sides) => {
    const pts = polygonPathPointsInBounds(10, 20, 300, 90, sides);
    const xs = pts.filter((_, index) => index % 2 === 0);
    const ys = pts.filter((_, index) => index % 2 === 1);
    expect(Math.min(...xs)).toBeCloseTo(10, 2);
    expect(Math.max(...xs)).toBeCloseTo(310, 2);
    expect(Math.min(...ys)).toBeCloseTo(20, 2);
    expect(Math.max(...ys)).toBeCloseTo(110, 2);
  });

  it("변 수와 비정상 크기를 안전하게 정규화한다", () => {
    const pts = polygonPathPointsInBounds(Number.NaN, Number.NaN, -0, Number.NaN, 1);
    expect(pts).toHaveLength(6);
    expect(pts.every(Number.isFinite)).toBe(true);
  });

  it("비정사각형 패턴 도형의 노드 원점을 bbox 중심에 두면서 절대 지오메트리를 보존한다", () => {
    const layout = polygonPathNodeLayoutInBounds(10, 20, 300, 90, 5);
    expect(layout).toMatchObject({ x: 160, y: 65 });
    const absolute = layout.points.map((value, index) =>
      value + (index % 2 === 0 ? layout.x : layout.y));
    const expected = polygonPathPointsInBounds(10, 20, 300, 90, 5);
    absolute.forEach((value, index) => expect(value).toBeCloseTo(expected[index] ?? Number.NaN, 8));
    expect(Object.isFrozen(layout)).toBe(true);
    expect(Object.isFrozen(layout.points)).toBe(true);
  });
});

describe("effectiveCornerRadius / pathPointsToSvg", () => {
  it("짧은 변의 절반을 넘지 않게 클램프한다", () => {
    expect(effectiveCornerRadius(100, 40, 8)).toBe(8);
    expect(effectiveCornerRadius(100, 40, 500)).toBe(20);
    expect(effectiveCornerRadius(100, 40, -3)).toBe(0);
    expect(effectiveCornerRadius(Number.NaN, 40, 8)).toBe(0);
  });

  it("평탄 배열을 SVG polygon points 문자열로 변환한다", () => {
    expect(pathPointsToSvg([0, 1, 2.5, 3, 4, 5])).toBe("0,1 2.5,3 4,5");
    expect(pathPointsToSvg([])).toBe("");
  });
});
