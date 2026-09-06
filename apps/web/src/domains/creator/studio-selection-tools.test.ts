import { describe, expect, it } from "vitest";

import {
  BRUSH_PREVIEW_COLORS,
  ELLIPSE_POLYGON_SEGMENTS,
  LASSO_MIN_POINT_DIST,
  MARCHING_ANTS_DASH,
  MIN_SELECTION_SUBPATH_AREA,
  SELECTION_BRIGHTNESS_RANGE,
  SELECTION_BRUSH_RADIUS_DEFAULT,
  SELECTION_BRUSH_RADIUS_RANGE,
  SELECTION_COMBINE_MODES,
  SELECTION_EXPAND_DEFAULT,
  SELECTION_EXPAND_RANGE,
  SELECTION_FEATHER_RANGE,
  SELECTION_HUE_RANGE,
  SELECTION_TOOLS,
  addBrushSubpath,
  addSelectionSubpath,
  appendBrushPoint,
  appendLassoPoint,
  appendMagneticLassoPoint,
  appendPolyLassoVertex,
  applySelectionAdjustToCanvas,
  beginPolyLassoSession,
  beginSelectionDrag,
  brushPointMinDist,
  brushStrokePreview,
  buildSelectionMaskPlan,
  canvasPointToNormalized,
  circleSelectionPolygon,
  commitPolyLassoSession,
  commitSelectionDrag,
  commitSelectionDragAtPoint,
  constrainSelectionDragCorners,
  ellipseSelectionPolygon,
  emptyPixelSelection,
  expandContractSelection,
  applySelectionContentTransformToCanvas,
  flipSelection,
  isSelectionAdjustNoop,
  isSelectionContentTransformNoop,
  isSelectionUsable,
  luminanceFieldFromRgba,
  luminanceFieldGradientAt,
  marchingAntsDashOffset,
  marchingAntsPasses,
  normalizedPointToCanvas,
  paintSelectionMaskSteps,
  planSelectionAdjust,
  pointInPolygon,
  pointInSelection,
  pointOnBrushSubpath,
  polygonAreaNorm,
  polyLassoCloseToStart,
  rasterizeSelectionMask,
  rectSelectionPolygon,
  extractSelectionToCanvas,
  removeLastSubpath,
  resolvePixelSelectionAutoTarget,
  resolveSelectionCombineOverride,
  rotateSelection,
  scaleSelection,
  selectAllPixels,
  shouldMoveSelectionMarquee,
  selectionBoundsNorm,
  selectionCentroidNorm,
  setSelectionFeather,
  simplifyLassoPolygon,
  snapLassoPointToEdge,
  subpathOutlinePoints,
  toggleSelectionInvert,
  transformSelectionMarquee,
  translateSelection,
  updateSelectionDrag,
  type MaskCanvasLike,
  type MaskCtx2DLike,
  type MaskImageSource,
  type PixelSelection,
  type SelectionBrushSubpath,
  type SelectionCanvasFactory,
  type SelectionMaskPlan,
  type SelPoint,
} from "./studio-selection-tools";

// ---------------------------------------------------------------------------
// 테스트 픽스처 — 가짜 ctx(호출 기록) + 가짜 캔버스 팩토리
// ---------------------------------------------------------------------------

type FakeCanvas = MaskCanvasLike & { id: number };

/** 호출을 문자열로 기록하는 가짜 2D 컨텍스트 — 실행 순서·합성 모드를 검증한다. */
function fakeCtx(log: string[], label: string): MaskCtx2DLike {
  let gco = "source-over";
  let filter = "none";
  return {
    set fillStyle(v: unknown) {
      log.push(`${label}:fillStyle=${String(v)}`);
    },
    get fillStyle(): unknown {
      return "#ffffff";
    },
    set strokeStyle(v: unknown) {
      log.push(`${label}:strokeStyle=${String(v)}`);
    },
    get strokeStyle(): unknown {
      return "#ffffff";
    },
    set lineWidth(v: number) {
      log.push(`${label}:lineWidth=${v}`);
    },
    get lineWidth(): number {
      return 1;
    },
    set lineCap(v: "butt" | "round" | "square") {
      log.push(`${label}:lineCap=${v}`);
    },
    get lineCap(): "butt" | "round" | "square" {
      return "butt";
    },
    set lineJoin(v: "round" | "bevel" | "miter") {
      log.push(`${label}:lineJoin=${v}`);
    },
    get lineJoin(): "round" | "bevel" | "miter" {
      return "miter";
    },
    set globalCompositeOperation(v: string) {
      gco = v;
      log.push(`${label}:gco=${v}`);
    },
    get globalCompositeOperation(): string {
      return gco;
    },
    set filter(v: string) {
      filter = v;
      log.push(`${label}:filter=${v}`);
    },
    get filter(): string {
      return filter;
    },
    beginPath: () => log.push(`${label}:beginPath`),
    moveTo: (x, y) => log.push(`${label}:moveTo(${x},${y})`),
    lineTo: (x, y) => log.push(`${label}:lineTo(${x},${y})`),
    closePath: () => log.push(`${label}:closePath`),
    fill: (rule) => log.push(`${label}:fill(${rule ?? ""})`),
    stroke: () => log.push(`${label}:stroke`),
    fillRect: (x, y, w, h) => log.push(`${label}:fillRect(${x},${y},${w},${h})`),
    clearRect: (x, y, w, h) => log.push(`${label}:clearRect(${x},${y},${w},${h})`),
    drawImage: (image, dx, dy) => log.push(`${label}:drawImage(#${(image as FakeCanvas).id},${dx},${dy})`),
    save: () => log.push(`${label}:save`),
    restore: () => log.push(`${label}:restore`),
    translate: (x, y) => log.push(`${label}:translate(${x},${y})`),
    rotate: (a) => log.push(`${label}:rotate(${a})`),
    scale: (x, y) => log.push(`${label}:scale(${x},${y})`),
  };
}

/** 생성 순서대로 id 를 붙이는 가짜 팩토리 — n 번째 생성부터 실패시킬 수도 있다. */
function fakeFactory(log: string[], failAt = Infinity): SelectionCanvasFactory {
  let count = 0;
  return (width, height) => {
    count += 1;
    if (count >= failAt) return null;
    const canvas: FakeCanvas = { id: count, width, height };
    log.push(`create#${count}(${width}x${height})`);
    return { canvas, ctx: fakeCtx(log, `c${count}`) };
  };
}

/** 단위 사각형 절반(왼쪽) 선택 — 여러 테스트의 기본 픽스처. */
function leftHalfSelection(over: Partial<PixelSelection> = {}): PixelSelection {
  return {
    subpaths: [
      {
        mode: "add",
        points: [
          { x: 0, y: 0 },
          { x: 0.5, y: 0 },
          { x: 0.5, y: 1 },
          { x: 0, y: 1 },
        ],
      },
    ],
    featherPx: 0,
    invert: false,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 상수·칩 목록
// ---------------------------------------------------------------------------

describe("상수·칩 목록", () => {
  it("도구 5종(rect/ellipse/lasso/poly-lasso/brush)·결합 3종(add/subtract/intersect) — id 고유·한글 라벨", () => {
    expect(SELECTION_TOOLS.map((t) => t.id)).toEqual(["rect", "ellipse", "lasso", "poly-lasso", "brush"]);
    expect(SELECTION_COMBINE_MODES.map((m) => m.id)).toEqual(["add", "subtract", "intersect"]);
    for (const item of [...SELECTION_TOOLS, ...SELECTION_COMBINE_MODES]) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.tip.length).toBeGreaterThan(0);
    }
  });

  it("슬라이더 범위 — 페더 0..60, 밝기 ±100, 색조 ±180, 브러시 반경 8..120(기본값 포함)", () => {
    expect(SELECTION_FEATHER_RANGE).toEqual({ min: 0, max: 60, step: 1 });
    expect(SELECTION_BRIGHTNESS_RANGE.min).toBe(-100);
    expect(SELECTION_HUE_RANGE.max).toBe(180);
    expect(SELECTION_BRUSH_RADIUS_RANGE).toEqual({ min: 8, max: 120, step: 1 });
    expect(SELECTION_BRUSH_RADIUS_DEFAULT).toBeGreaterThanOrEqual(SELECTION_BRUSH_RADIUS_RANGE.min);
    expect(SELECTION_BRUSH_RADIUS_DEFAULT).toBeLessThanOrEqual(SELECTION_BRUSH_RADIUS_RANGE.max);
    expect(SELECTION_EXPAND_DEFAULT).toBeGreaterThanOrEqual(SELECTION_EXPAND_RANGE.min);
    expect(SELECTION_EXPAND_DEFAULT).toBeLessThanOrEqual(SELECTION_EXPAND_RANGE.max);
  });

  it("브러시 미리보기 틴트 — 결합 모드별 반투명 rgba", () => {
    expect(BRUSH_PREVIEW_COLORS.add).toMatch(/^rgba\(/);
    expect(BRUSH_PREVIEW_COLORS.subtract).toMatch(/^rgba\(/);
    expect(BRUSH_PREVIEW_COLORS.intersect).toMatch(/^rgba\(/);
    expect(BRUSH_PREVIEW_COLORS.add).not.toBe(BRUSH_PREVIEW_COLORS.subtract);
    expect(BRUSH_PREVIEW_COLORS.add).not.toBe(BRUSH_PREVIEW_COLORS.intersect);
  });
});

// ---------------------------------------------------------------------------
// 도구 → 폴리곤
// ---------------------------------------------------------------------------

describe("rectSelectionPolygon", () => {
  it("드래그 순서와 무관하게 시계방향 4점 사각형", () => {
    const expected = [
      { x: 0.1, y: 0.2 },
      { x: 0.6, y: 0.2 },
      { x: 0.6, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ];
    expect(rectSelectionPolygon({ x: 0.1, y: 0.2 }, { x: 0.6, y: 0.9 })).toEqual(expected);
    expect(rectSelectionPolygon({ x: 0.6, y: 0.9 }, { x: 0.1, y: 0.2 })).toEqual(expected);
  });

  it("박스 밖 드래그는 0..1 로 클램프, NaN 은 0", () => {
    const poly = rectSelectionPolygon({ x: -0.4, y: Number.NaN }, { x: 1.7, y: 0.5 });
    for (const p of poly) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
    expect(polygonAreaNorm(poly)).toBeCloseTo(0.5, 10);
  });
});

describe("constrainSelectionDragCorners / circleSelectionPolygon", () => {
  it("Shift 는 정사각 코너를, forceCircle 은 정원을 만든다", () => {
    const { a, b } = constrainSelectionDragCorners(
      { x: 0.2, y: 0.2 },
      { x: 0.6, y: 0.4 },
      { shift: true, aspect: 1 }
    );
    expect(Math.abs(b.x - a.x)).toBeCloseTo(Math.abs(b.y - a.y), 5);
    const circle = circleSelectionPolygon({ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.5 }, 1);
    expect(circle.length).toBe(ELLIPSE_POLYGON_SEGMENTS);
  });

  it("Alt 는 시작점을 중심으로 확장한다", () => {
    const { a, b } = constrainSelectionDragCorners(
      { x: 0.5, y: 0.5 },
      { x: 0.7, y: 0.6 },
      { alt: true, aspect: 1 }
    );
    expect((a.x + b.x) / 2).toBeCloseTo(0.5, 5);
    expect((a.y + b.y) / 2).toBeCloseTo(0.5, 5);
  });
});

describe("ellipseSelectionPolygon", () => {
  it("기본 48각형으로 근사하고 면적이 π/4·w·h 에 수렴", () => {
    const poly = ellipseSelectionPolygon({ x: 0, y: 0 }, { x: 1, y: 1 });
    expect(poly).toHaveLength(ELLIPSE_POLYGON_SEGMENTS);
    // 단위원 절반 지름 0.5 → 면적 π·0.25 ≈ 0.785 (다각형 근사라 살짝 작음)
    expect(polygonAreaNorm(poly)).toBeGreaterThan(0.77);
    expect(polygonAreaNorm(poly)).toBeLessThanOrEqual(Math.PI / 4);
  });

  it("분할 수는 8..96 정수로 클램프", () => {
    expect(ellipseSelectionPolygon({ x: 0, y: 0 }, { x: 1, y: 1 }, 4)).toHaveLength(8);
    expect(ellipseSelectionPolygon({ x: 0, y: 0 }, { x: 1, y: 1 }, 500)).toHaveLength(96);
    expect(ellipseSelectionPolygon({ x: 0, y: 0 }, { x: 1, y: 1 }, Number.NaN)).toHaveLength(ELLIPSE_POLYGON_SEGMENTS);
  });

  it("모든 점이 드래그 bbox(0..1 클램프) 안", () => {
    const poly = ellipseSelectionPolygon({ x: 0.2, y: 0.3 }, { x: 0.8, y: 0.7 });
    for (const p of poly) {
      expect(p.x).toBeGreaterThanOrEqual(0.2 - 1e-9);
      expect(p.x).toBeLessThanOrEqual(0.8 + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(0.3 - 1e-9);
      expect(p.y).toBeLessThanOrEqual(0.7 + 1e-9);
    }
  });
});

describe("올가미 — appendLassoPoint / simplifyLassoPolygon", () => {
  it("최소 간격보다 가까우면 같은 배열을 그대로 반환(추가 없음)", () => {
    const pts = [{ x: 0.5, y: 0.5 }];
    const same = appendLassoPoint(pts, { x: 0.5 + LASSO_MIN_POINT_DIST / 2, y: 0.5 });
    expect(same).toBe(pts);
    const grown = appendLassoPoint(pts, { x: 0.6, y: 0.5 });
    expect(grown).toHaveLength(2);
    expect(grown).not.toBe(pts);
  });

  it("단순화 — 이웃 중복·일직선 중간점·끝점 중복 닫음 제거", () => {
    const noisy: SelPoint[] = [
      { x: 0, y: 0 },
      { x: 0.25, y: 0 }, // (0,0)→(0.5,0) 직선 위 중간점 — 제거 대상
      { x: 0.5, y: 0 },
      { x: 0.5, y: 0.0001 }, // 사실상 중복 — 제거 대상
      { x: 0.5, y: 0.5 },
      { x: 0, y: 0.5 },
      { x: 0.0005, y: 0.0005 }, // 시작점과 겹치는 닫음점 — 제거 대상
    ];
    const simplified = simplifyLassoPolygon(noisy);
    expect(simplified).toEqual([
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 0, y: 0.5 },
    ]);
  });

  it("3점 미만이면 그대로(짧은 배열) 반환", () => {
    expect(simplifyLassoPolygon([{ x: 0, y: 0 }])).toHaveLength(1);
  });
});

describe("브러시 궤적 — brushPointMinDist / appendBrushPoint", () => {
  it("최소 간격 = max(올가미 최소 간격, 반경의 20%) — 비정상 반경은 0으로", () => {
    expect(brushPointMinDist(0.1)).toBeCloseTo(0.02, 10);
    expect(brushPointMinDist(0.001)).toBe(LASSO_MIN_POINT_DIST);
    expect(brushPointMinDist(Number.NaN)).toBe(LASSO_MIN_POINT_DIST);
    expect(brushPointMinDist(-1)).toBe(LASSO_MIN_POINT_DIST);
  });

  it("반경 비례 간격보다 가까우면 같은 배열(추가 없음), 멀면 새 배열", () => {
    const pts = [{ x: 0.5, y: 0.5 }];
    // 반경 0.1 → 최소 간격 0.02: 0.01 이동은 무시, 0.03 이동은 추가.
    expect(appendBrushPoint(pts, { x: 0.51, y: 0.5 }, 0.1)).toBe(pts);
    const grown = appendBrushPoint(pts, { x: 0.53, y: 0.5 }, 0.1);
    expect(grown).toHaveLength(2);
    expect(grown).not.toBe(pts);
  });
});

// ---------------------------------------------------------------------------
// 기하 — 면적·포함
// ---------------------------------------------------------------------------

describe("polygonAreaNorm / pointInPolygon", () => {
  const square: SelPoint[] = [
    { x: 0.2, y: 0.2 },
    { x: 0.8, y: 0.2 },
    { x: 0.8, y: 0.8 },
    { x: 0.2, y: 0.8 },
  ];

  it("신발끈 면적 — 0.6×0.6 사각형 = 0.36, 3점 미만 = 0", () => {
    expect(polygonAreaNorm(square)).toBeCloseTo(0.36, 10);
    expect(polygonAreaNorm(square.slice(0, 2))).toBe(0);
  });

  it("even-odd 포함 판정 — 안/밖/오목 폴리곤", () => {
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 0.1, y: 0.5 }, square)).toBe(false);
    // L자(오목) — 파인 부분은 밖
    const lShape: SelPoint[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 1 },
      { x: 0, y: 1 },
    ];
    expect(pointInPolygon({ x: 0.75, y: 0.75 }, lShape)).toBe(false);
    expect(pointInPolygon({ x: 0.25, y: 0.75 }, lShape)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 선택 상태 — 결합·반전·페더 (불변성)
// ---------------------------------------------------------------------------

describe("addSelectionSubpath / removeLastSubpath", () => {
  it("null 에서 시작해 합치기 서브패스를 추가한다", () => {
    const sel = addSelectionSubpath(null, "add", rectSelectionPolygon({ x: 0, y: 0 }, { x: 0.5, y: 1 }));
    expect(sel).not.toBeNull();
    expect(sel!.subpaths).toHaveLength(1);
    expect(sel!.subpaths[0]!.mode).toBe("add");
    expect(sel!.featherPx).toBe(0);
  });

  it("면적이 무의미한 폴리곤은 기존 선택을 그대로 반환", () => {
    const base = leftHalfSelection();
    const side = Math.sqrt(MIN_SELECTION_SUBPATH_AREA) / 2; // 면적이 문턱의 1/4
    const tiny = rectSelectionPolygon({ x: 0.5, y: 0.5 }, { x: 0.5 + side, y: 0.5 + side });
    expect(addSelectionSubpath(base, "add", tiny)).toBe(base);
    expect(addSelectionSubpath(null, "add", tiny)).toBeNull();
  });

  it("NaN 점은 위생 처리되고 원본 선택은 변형되지 않는다(불변)", () => {
    const base = leftHalfSelection();
    const next = addSelectionSubpath(base, "subtract", [
      { x: Number.NaN, y: 0 },
      { x: 0.4, y: 0 },
      { x: 0.4, y: 0.4 },
      { x: 0, y: 0.4 },
    ]);
    expect(base.subpaths).toHaveLength(1);
    expect(next!.subpaths).toHaveLength(2);
    expect(next!.subpaths[1]!.points[0]).toEqual({ x: 0, y: 0 });
  });

  it("한 단계 되돌리기 — 마지막 서브패스 제거, 전부 없어지면 null(해제)", () => {
    const two = addSelectionSubpath(leftHalfSelection(), "subtract", rectSelectionPolygon({ x: 0, y: 0 }, { x: 0.2, y: 0.2 }))!;
    const one = removeLastSubpath(two)!;
    expect(one.subpaths).toHaveLength(1);
    expect(removeLastSubpath(one)).toBeNull();
    // 반전이 켜져 있으면 서브패스가 없어져도 선택(전체 반전)은 유지된다.
    const invertedOnly = removeLastSubpath({ ...one, invert: true });
    expect(invertedOnly).not.toBeNull();
    expect(invertedOnly!.subpaths).toHaveLength(0);
  });

  it("교집합 — 기존 선택과 새 폴리곤이 겹치는 부분만 남기고 mode 는 add 로 정규화", () => {
    const left = leftHalfSelection();
    // 가운데 세로 띠(0.25..0.75) ∩ 왼쪽 절반 → 0.25..0.5 근처
    const band = rectSelectionPolygon({ x: 0.25, y: 0 }, { x: 0.75, y: 1 });
    const hit = addSelectionSubpath(left, "intersect", band);
    expect(hit).not.toBeNull();
    expect(hit!.invert).toBe(false);
    expect(hit!.subpaths.every((sp) => sp.mode === "add")).toBe(true);
    expect(pointInSelection(hit, { x: 0.3, y: 0.5 })).toBe(true);
    expect(pointInSelection(hit, { x: 0.1, y: 0.5 })).toBe(false); // 왼쪽만 있던 영역은 교집합 밖
    expect(pointInSelection(hit, { x: 0.7, y: 0.5 })).toBe(false); // 새 영역만 있던 곳
    // 기존 선택 없으면 교집합 결과 없음
    expect(addSelectionSubpath(null, "intersect", band)).toBeNull();
  });
});

describe("selectAllPixels / expandContractSelection", () => {
  it("전체 선택 — 빈 서브패스 + 반전, 페더 유지", () => {
    const base = setSelectionFeather(leftHalfSelection(), 8);
    const all = selectAllPixels(base);
    expect(all.subpaths).toHaveLength(0);
    expect(all.invert).toBe(true);
    expect(all.featherPx).toBe(8);
    expect(isSelectionUsable(all)).toBe(true);
    expect(pointInSelection(all, { x: 0.9, y: 0.9 })).toBe(true);
    expect(selectAllPixels(null).invert).toBe(true);
  });

  it("확장 — 폴리곤 꼭짓점이 중심에서 바깥으로 밀린다", () => {
    const base = leftHalfSelection();
    const expanded = expandContractSelection(base, 0.05);
    expect(expanded).not.toBeNull();
    expect(polygonAreaNorm(expanded!.subpaths[0]!.points)).toBeGreaterThan(
      polygonAreaNorm(base.subpaths[0]!.points)
    );
  });

  it("축소 — 너무 작아지면 null, 전체 선택 축소는 안쪽 박스로", () => {
    const tiny = addSelectionSubpath(null, "add", rectSelectionPolygon({ x: 0.48, y: 0.48 }, { x: 0.52, y: 0.52 }))!;
    expect(expandContractSelection(tiny, -0.4)).toBeNull();
    const all = selectAllPixels();
    const inset = expandContractSelection(all, -0.1);
    expect(inset).not.toBeNull();
    expect(inset!.invert).toBe(false);
    expect(pointInSelection(inset, { x: 0.5, y: 0.5 })).toBe(true);
    expect(pointInSelection(inset, { x: 0.02, y: 0.02 })).toBe(false);
  });
});

describe("rotateSelection / flipSelection", () => {
  it("중심 기준으로 90° 회전 — 점유 영역이 따라 돌고 전체 반전 선택은 no-op", () => {
    // 중심(0.5,0.5) 근처 가로 길쭉한 박스
    const base = addSelectionSubpath(null, "add", rectSelectionPolygon({ x: 0.2, y: 0.4 }, { x: 0.8, y: 0.6 }))!;
    const c = selectionCentroidNorm(base)!;
    expect(c.x).toBeCloseTo(0.5, 5);
    expect(c.y).toBeCloseTo(0.5, 5);
    const rot = rotateSelection(base, 90, { aspect: 1 });
    expect(rot).not.toBeNull();
    // 가로 박스 → 세로 박스: (0.5, 0.2) 쪽은 들어오고 (0.2, 0.5) 쪽은 나갈 수 있다
    expect(pointInSelection(rot, { x: 0.5, y: 0.25 })).toBe(true);
    expect(pointInSelection(rot, { x: 0.25, y: 0.5 })).toBe(false);
    expect(rotateSelection(selectAllPixels(), 45)).toEqual(selectAllPixels());
    expect(rotateSelection(base, 0)).toBe(base);
  });

  it("aspect≠1 이면 y 스케일을 반영해 비정사각에서도 기하 회전", () => {
    const base = addSelectionSubpath(null, "add", rectSelectionPolygon({ x: 0.3, y: 0.45 }, { x: 0.7, y: 0.55 }))!;
    const tall = rotateSelection(base, 90, { aspect: 2 });
    expect(tall).not.toBeNull();
    expect(pointInSelection(tall, { x: 0.5, y: 0.5 })).toBe(true);
    // 0° 와 360° 는 동일 중심·영역 유지(수치 오차 허용)
    const full = rotateSelection(base, 360, { aspect: 1.5 })!;
    expect(pointInSelection(full, { x: 0.5, y: 0.5 })).toBe(true);
    expect(pointInSelection(full, { x: 0.35, y: 0.5 })).toBe(true);
  });

  it("좌우/상하 반전 — 꼭짓점이 중심 대칭으로 이동한다", () => {
    // 축정렬 사각형은 자기 중심 반전이 항등이라 비대칭 삼각형 꼭짓점 좌표로 검증한다.
    const tri = addSelectionSubpath(null, "add", [
      { x: 0.2, y: 0.2 },
      { x: 0.5, y: 0.2 },
      { x: 0.2, y: 0.5 },
    ])!;
    const c = selectionCentroidNorm(tri)!;
    expect(c.x).toBeCloseTo(0.35, 5);
    expect(c.y).toBeCloseTo(0.35, 5);
    const fx = flipSelection(tri, "x")!;
    const fxXs = fx.subpaths[0]!.points.map((p) => p.x).sort((a, b) => a - b);
    // 0.2 ↔ 0.5 가 중심 0.35 기준으로 서로 자리 바꿈(집합은 {0.2,0.5})
    expect(fxXs[0]).toBeCloseTo(0.2, 5);
    expect(fxXs[fxXs.length - 1]).toBeCloseTo(0.5, 5);
    // 원본 왼쪽 하단 꼭짓점(0.2,0.5) → 좌우 반전 후 (0.5,0.5)
    expect(fx.subpaths[0]!.points.some((p) => Math.abs(p.x - 0.5) < 1e-9 && Math.abs(p.y - 0.5) < 1e-9)).toBe(
      true
    );
    const fy = flipSelection(tri, "y")!;
    // 원본 오른쪽 상단(0.5,0.2) → 상하 반전 후 (0.5,0.5)
    expect(fy.subpaths[0]!.points.some((p) => Math.abs(p.x - 0.5) < 1e-9 && Math.abs(p.y - 0.5) < 1e-9)).toBe(
      true
    );
    expect(flipSelection(selectAllPixels(), "x")).toEqual(selectAllPixels());
  });

  it("translateSelection / scaleSelection — 마퀴 이동·스케일", () => {
    const base = addSelectionSubpath(null, "add", rectSelectionPolygon({ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.4 }))!;
    const moved = translateSelection(base, 0.1, 0.05)!;
    expect(pointInSelection(moved, { x: 0.35, y: 0.3 })).toBe(true);
    expect(pointInSelection(moved, { x: 0.25, y: 0.25 })).toBe(false);
    const scaled = scaleSelection(base, 2, { aspect: 1 })!;
    expect(pointInSelection(scaled, { x: 0.3, y: 0.15 })).toBe(true); // 세로로 커진 영역
    expect(translateSelection(base, 0, 0)).toBe(base);
  });

  it("transformSelectionMarquee 는 스케일·이동을 합성한다", () => {
    const base = addSelectionSubpath(null, "add", rectSelectionPolygon({ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.6 }))!;
    const next = transformSelectionMarquee(base, { scale: 1.5, dxNorm: 0.1, dyNorm: 0 });
    expect(next).not.toBeNull();
    expect(pointInSelection(next, { x: 0.7, y: 0.5 })).toBe(true);
  });
});

describe("applySelectionContentTransformToCanvas", () => {
  it("noop 변환은 null, 회전 시 마스크 영역을 지우고 조각을 다시 그린다", () => {
    expect(isSelectionContentTransformNoop({})).toBe(true);
    expect(isSelectionContentTransformNoop({ rotateDeg: 90 })).toBe(false);
    const log: string[] = [];
    const factory = fakeFactory(log);
    const source: FakeCanvas = { id: 99, width: 32, height: 32 };
    const mask: FakeCanvas = { id: 98, width: 32, height: 32 };
    const out = applySelectionContentTransformToCanvas(source, 32, 32, mask, { rotateDeg: 90 }, factory, {
      x: 8,
      y: 8,
      w: 16,
      h: 16,
    });
    expect(out).not.toBeNull();
    expect(log.some((l) => l.includes("gco=destination-in"))).toBe(true);
    expect(log.some((l) => l.includes("gco=destination-out"))).toBe(true);
    expect(log.some((l) => l.includes(":rotate("))).toBe(true);
    expect(applySelectionContentTransformToCanvas(source, 32, 32, mask, {}, factory)).toBeNull();
  });
});

describe("다각형 올가미 세션", () => {
  it("begin/append/commit — 클릭 꼭짓점을 폴리곤 선택으로 결합", () => {
    let session = beginPolyLassoSession("add", { x: 0.1, y: 0.1 });
    expect(session.points).toHaveLength(1);
    session = appendPolyLassoVertex(session, { x: 0.8, y: 0.1 });
    session = appendPolyLassoVertex(session, { x: 0.8, y: 0.8 });
    session = appendPolyLassoVertex(session, { x: 0.1, y: 0.8 });
    expect(session.points.length).toBeGreaterThanOrEqual(4);
    const sel = commitPolyLassoSession(null, session);
    expect(sel).not.toBeNull();
    expect(sel!.subpaths[0]!.mode).toBe("add");
    expect(pointInSelection(sel, { x: 0.5, y: 0.5 })).toBe(true);
  });

  it("시작점 근처 재클릭 감지 + 점 2개 이하는 커밋해도 선택 없음", () => {
    let session = beginPolyLassoSession("subtract", { x: 0.2, y: 0.2 });
    session = appendPolyLassoVertex(session, { x: 0.7, y: 0.2 });
    session = appendPolyLassoVertex(session, { x: 0.5, y: 0.7 });
    expect(polyLassoCloseToStart(session, { x: 0.21, y: 0.21 })).toBe(true);
    expect(polyLassoCloseToStart(session, { x: 0.9, y: 0.9 })).toBe(false);
    const open = beginPolyLassoSession("add", { x: 0.1, y: 0.1 });
    expect(commitPolyLassoSession(null, appendPolyLassoVertex(open, { x: 0.9, y: 0.9 }))).toBeNull();
  });

  it("교집합 모드 세션 커밋은 기존 선택과 겹친 영역만 남긴다", () => {
    const left = leftHalfSelection();
    let session = beginPolyLassoSession("intersect", { x: 0.3, y: 0 });
    session = appendPolyLassoVertex(session, { x: 0.9, y: 0 });
    session = appendPolyLassoVertex(session, { x: 0.9, y: 1 });
    session = appendPolyLassoVertex(session, { x: 0.3, y: 1 });
    const hit = commitPolyLassoSession(left, session);
    expect(hit).not.toBeNull();
    expect(pointInSelection(hit, { x: 0.4, y: 0.5 })).toBe(true);
    expect(pointInSelection(hit, { x: 0.1, y: 0.5 })).toBe(false);
  });
});

describe("setSelectionFeather / toggleSelectionInvert / isSelectionUsable", () => {
  it("페더는 0..60 클램프 + 정수 반올림, 불변 갱신", () => {
    const sel = leftHalfSelection();
    expect(setSelectionFeather(sel, 12.6).featherPx).toBe(13);
    expect(setSelectionFeather(sel, -5).featherPx).toBe(0);
    expect(setSelectionFeather(sel, 999).featherPx).toBe(SELECTION_FEATHER_RANGE.max);
    expect(setSelectionFeather(sel, Number.NaN).featherPx).toBe(0);
    expect(sel.featherPx).toBe(0);
  });

  it("반전 토글은 왕복하고, 사용 가능 판정은 add 서브패스 또는 반전", () => {
    const sel = leftHalfSelection();
    expect(toggleSelectionInvert(toggleSelectionInvert(sel))).toEqual(sel);
    expect(isSelectionUsable(sel)).toBe(true);
    expect(isSelectionUsable(null)).toBe(false);
    expect(isSelectionUsable(emptyPixelSelection())).toBe(false);
    // 빼기만 있는 선택은 못 쓰지만, 반전이 켜지면(바깥 전체) 쓸 수 있다.
    const subtractOnly: PixelSelection = {
      subpaths: [{ mode: "subtract", points: rectSelectionPolygon({ x: 0, y: 0 }, { x: 0.5, y: 0.5 }) }],
      featherPx: 0,
      invert: false,
    };
    expect(isSelectionUsable(subtractOnly)).toBe(false);
    expect(isSelectionUsable({ ...subtractOnly, invert: true })).toBe(true);
  });
});

describe("pointInSelection — 래스터와 같은 순차 덮어쓰기 의미론", () => {
  it("합치기 → 빼기 → 다시 합치기 순서가 그대로 반영된다", () => {
    let sel = addSelectionSubpath(null, "add", rectSelectionPolygon({ x: 0, y: 0 }, { x: 1, y: 1 }));
    sel = addSelectionSubpath(sel, "subtract", rectSelectionPolygon({ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.6 }));
    expect(pointInSelection(sel, { x: 0.5, y: 0.5 })).toBe(false); // 뺀 구멍
    expect(pointInSelection(sel, { x: 0.1, y: 0.1 })).toBe(true);
    sel = addSelectionSubpath(sel, "add", rectSelectionPolygon({ x: 0.45, y: 0.45 }, { x: 0.55, y: 0.55 }));
    expect(pointInSelection(sel, { x: 0.5, y: 0.5 })).toBe(true); // 구멍 위에 다시 합침
  });

  it("반전은 최종 결과를 뒤집고, null 선택은 항상 false", () => {
    const sel = leftHalfSelection();
    expect(pointInSelection(sel, { x: 0.25, y: 0.5 })).toBe(true);
    expect(pointInSelection(toggleSelectionInvert(sel), { x: 0.25, y: 0.5 })).toBe(false);
    expect(pointInSelection(toggleSelectionInvert(sel), { x: 0.75, y: 0.5 })).toBe(true);
    expect(pointInSelection(null, { x: 0.5, y: 0.5 })).toBe(false);
  });
});

describe("브러시 서브패스 — addBrushSubpath / pointOnBrushSubpath", () => {
  it("null 에서 시작해 kind:brush 서브패스를 추가하고 점 1개(탭)도 유효하다", () => {
    const sel = addBrushSubpath(null, "add", [{ x: 0.5, y: 0.5 }], 0.1);
    expect(sel).not.toBeNull();
    expect(sel!.subpaths).toHaveLength(1);
    expect(sel!.subpaths[0]).toEqual({ mode: "add", kind: "brush", points: [{ x: 0.5, y: 0.5 }], radius: 0.1 });
    expect(isSelectionUsable(sel)).toBe(true);
  });

  it("반경 0 이하·NaN·빈 궤적은 기존 선택 그대로, 과대 반경은 4로 클램프, NaN 점은 위생 처리", () => {
    const base = leftHalfSelection();
    expect(addBrushSubpath(base, "add", [{ x: 0.5, y: 0.5 }], 0)).toBe(base);
    expect(addBrushSubpath(base, "add", [{ x: 0.5, y: 0.5 }], Number.NaN)).toBe(base);
    expect(addBrushSubpath(null, "add", [], 0.1)).toBeNull();
    const clamped = addBrushSubpath(null, "add", [{ x: Number.NaN, y: 0.5 }], 99)!;
    expect(clamped.subpaths[0]).toMatchObject({ kind: "brush", radius: 4, points: [{ x: 0, y: 0.5 }] });
    expect(base.subpaths).toHaveLength(1); // 원본 불변
  });

  it("점-획 거리 판정 — 점/선분, 반경 경계, aspect(세로/가로) 이방성 보정", () => {
    const dot: SelectionBrushSubpath = { mode: "add", kind: "brush", points: [{ x: 0.5, y: 0.5 }], radius: 0.1 };
    expect(pointOnBrushSubpath({ x: 0.55, y: 0.5 }, dot)).toBe(true);
    expect(pointOnBrushSubpath({ x: 0.65, y: 0.5 }, dot)).toBe(false);
    // aspect=2(세로가 가로의 2배 px): y 오프셋 0.08 → 보정 거리 0.16 > 반경 0.1.
    expect(pointOnBrushSubpath({ x: 0.5, y: 0.58 }, dot, 1)).toBe(true);
    expect(pointOnBrushSubpath({ x: 0.5, y: 0.58 }, dot, 2)).toBe(false);
    const stroke: SelectionBrushSubpath = {
      mode: "add",
      kind: "brush",
      points: [
        { x: 0.2, y: 0.5 },
        { x: 0.8, y: 0.5 },
      ],
      radius: 0.1,
    };
    expect(pointOnBrushSubpath({ x: 0.5, y: 0.55 }, stroke)).toBe(true); // 선분 중간 위
    expect(pointOnBrushSubpath({ x: 0.5, y: 0.65 }, stroke)).toBe(false);
    expect(pointOnBrushSubpath({ x: 0.15, y: 0.5 }, stroke)).toBe(true); // 끝점 캡 안
    // 반경 0 브러시는 어떤 점도 히트하지 않는다(마스크 계획의 "칠하지 않음"과 일치).
    expect(pointOnBrushSubpath({ x: 0.5, y: 0.5 }, { ...dot, radius: 0 })).toBe(false);
  });

  it("pointInSelection — 브러시도 '마지막 덮는 서브패스' 의미론에 참여한다", () => {
    // 전체 폴리곤 add → 가운데 가로 획 brush subtract → 획 위 다시 brush add.
    let sel = addSelectionSubpath(null, "add", rectSelectionPolygon({ x: 0, y: 0 }, { x: 1, y: 1 }));
    sel = addBrushSubpath(
      sel,
      "subtract",
      [
        { x: 0.1, y: 0.5 },
        { x: 0.9, y: 0.5 },
      ],
      0.05
    );
    expect(pointInSelection(sel, { x: 0.5, y: 0.5 })).toBe(false); // 긁어낸 띠
    expect(pointInSelection(sel, { x: 0.5, y: 0.1 })).toBe(true);
    sel = addBrushSubpath(sel, "add", [{ x: 0.5, y: 0.5 }], 0.02);
    expect(pointInSelection(sel, { x: 0.5, y: 0.5 })).toBe(true); // 다시 칠함
    // aspect 옵션이 브러시 판정에 전달된다.
    const dotSel = addBrushSubpath(null, "add", [{ x: 0.5, y: 0.5 }], 0.1);
    expect(pointInSelection(dotSel, { x: 0.5, y: 0.58 }, { aspect: 2 })).toBe(false);
    expect(pointInSelection(dotSel, { x: 0.5, y: 0.58 })).toBe(true);
  });

  it("selectionBoundsNorm — 브러시 add 는 궤적을 반경만큼 부풀린 bbox(0..1 클램프)", () => {
    const sel = addBrushSubpath(null, "add", [{ x: 0.5, y: 0.05 }], 0.1)!;
    const b = selectionBoundsNorm(sel)!;
    expect(b.x).toBeCloseTo(0.4, 10);
    expect(b.y).toBe(0); // 0.05 - 0.1 → 0 으로 클램프
    expect(b.x + b.w).toBeCloseTo(0.6, 10);
    expect(b.y + b.h).toBeCloseTo(0.15, 10);
  });
});

describe("selectionBoundsNorm", () => {
  it("합치기 서브패스들의 합집합 bbox(빼기는 무시), 0..1 클램프", () => {
    let sel = addSelectionSubpath(null, "add", rectSelectionPolygon({ x: 0.1, y: 0.2 }, { x: 0.4, y: 0.5 }));
    sel = addSelectionSubpath(sel, "add", rectSelectionPolygon({ x: 0.6, y: 0.6 }, { x: 0.9, y: 0.9 }));
    sel = addSelectionSubpath(sel, "subtract", rectSelectionPolygon({ x: 0, y: 0 }, { x: 1, y: 1 }));
    const b = selectionBoundsNorm(sel);
    expect(b!.x).toBeCloseTo(0.1, 10);
    expect(b!.y).toBeCloseTo(0.2, 10);
    expect(b!.x + b!.w).toBeCloseTo(0.9, 10);
    expect(b!.y + b!.h).toBeCloseTo(0.9, 10);
  });

  it("반전이면 전체 박스, 못 쓰는 선택이면 null", () => {
    expect(selectionBoundsNorm({ ...emptyPixelSelection(), invert: true })).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(selectionBoundsNorm(null)).toBeNull();
    expect(selectionBoundsNorm(emptyPixelSelection())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 드래그 세션
// ---------------------------------------------------------------------------

describe("드래그 세션 — begin/update/commit", () => {
  it("rect: 이동마다 시작→현재 박스 미리보기 폴리곤을 재계산", () => {
    let drag = beginSelectionDrag("rect", "add", { x: 0.2, y: 0.2 });
    expect(polygonAreaNorm(drag.points)).toBe(0); // 시작 직후는 퇴화(면적 0)
    drag = updateSelectionDrag(drag, { x: 0.7, y: 0.6 });
    expect(drag.points).toEqual(rectSelectionPolygon({ x: 0.2, y: 0.2 }, { x: 0.7, y: 0.6 }));
  });

  it("ellipse: 미리보기가 타원 폴리곤", () => {
    let drag = beginSelectionDrag("ellipse", "subtract", { x: 0.1, y: 0.1 });
    drag = updateSelectionDrag(drag, { x: 0.9, y: 0.9 });
    expect(drag.points).toHaveLength(ELLIPSE_POLYGON_SEGMENTS);
    expect(drag.mode).toBe("subtract");
  });

  it("lasso: 궤적을 누적하고 너무 가까운 점은 무시(같은 상태 반환)", () => {
    let drag = beginSelectionDrag("lasso", "add", { x: 0.1, y: 0.1 });
    const before = drag;
    drag = updateSelectionDrag(drag, { x: 0.1 + LASSO_MIN_POINT_DIST / 3, y: 0.1 });
    expect(drag).toBe(before); // 점이 안 늘면 상태 객체도 그대로 → 불필요한 리렌더 없음
    drag = updateSelectionDrag(drag, { x: 0.6, y: 0.1 });
    drag = updateSelectionDrag(drag, { x: 0.6, y: 0.7 });
    expect(drag.points).toHaveLength(3);
  });

  it("commit: 의미 있는 드래그만 서브패스로 결합, 찰나 클릭은 null(변화 없음)", () => {
    let drag = beginSelectionDrag("rect", "add", { x: 0.2, y: 0.2 });
    drag = updateSelectionDrag(drag, { x: 0.8, y: 0.8 });
    const sel = commitSelectionDrag(null, drag);
    expect(sel!.subpaths).toHaveLength(1);
    // 제자리 클릭(면적 0)
    const tap = beginSelectionDrag("rect", "add", { x: 0.5, y: 0.5 });
    expect(commitSelectionDrag(sel, tap)).toBeNull();
    // 올가미 2점(선분)도 폴리곤이 안 되므로 null
    let line = beginSelectionDrag("lasso", "add", { x: 0.1, y: 0.1 });
    line = updateSelectionDrag(line, { x: 0.9, y: 0.9 });
    expect(commitSelectionDrag(sel, line)).toBeNull();
  });

  it.each(["rect", "ellipse"] as const)(
    "%s: pointermove가 생략돼도 pointerup 최종 좌표로 선택을 확정",
    (tool) => {
      const drag = beginSelectionDrag(tool, "add", { x: 0.15, y: 0.2 });
      const selection = commitSelectionDragAtPoint(
        null,
        drag,
        { x: 0.85, y: 0.8 },
        { aspect: 1 },
      );

      expect(selection).not.toBeNull();
      expect(selection?.subpaths).toHaveLength(1);
      expect(polygonAreaNorm(selection?.subpaths[0]?.points ?? [])).toBeGreaterThan(0.3);
    },
  );

  it("brush: 시작점 1개 + 정규화 반경으로 시작하고, 반경 비례 간격으로 궤적을 누적한다", () => {
    let drag = beginSelectionDrag("brush", "add", { x: 0.2, y: 0.2 }, 0.1);
    expect(drag.points).toEqual([{ x: 0.2, y: 0.2 }]);
    expect(drag.brushRadius).toBeCloseTo(0.1, 10);
    const before = drag;
    drag = updateSelectionDrag(drag, { x: 0.21, y: 0.2 }); // 간격 0.01 < 반경×0.2=0.02 → 무시
    expect(drag).toBe(before);
    drag = updateSelectionDrag(drag, { x: 0.5, y: 0.2 });
    drag = updateSelectionDrag(drag, { x: 0.5, y: 0.6 });
    expect(drag.points).toHaveLength(3);
    // 비브러시 도구는 brushRadius 인자를 무시(0 고정), 브러시 반경은 0..4 클램프.
    expect(beginSelectionDrag("rect", "add", { x: 0, y: 0 }, 0.5).brushRadius).toBe(0);
    expect(beginSelectionDrag("brush", "add", { x: 0, y: 0 }, 99).brushRadius).toBe(4);
    expect(beginSelectionDrag("brush", "add", { x: 0, y: 0 }, Number.NaN).brushRadius).toBe(0);
  });

  it("brush commit: 탭(점 1개)도 점 찍기로 결합, 반경 0 이면 null(변화 없음)", () => {
    const tap = beginSelectionDrag("brush", "subtract", { x: 0.5, y: 0.5 }, 0.08);
    const sel = commitSelectionDrag(leftHalfSelection(), tap);
    expect(sel!.subpaths).toHaveLength(2);
    expect(sel!.subpaths[1]).toMatchObject({ mode: "subtract", kind: "brush", radius: 0.08 });
    const zero = beginSelectionDrag("brush", "add", { x: 0.5, y: 0.5 }, 0);
    expect(commitSelectionDrag(null, zero)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 좌표 변환
// ---------------------------------------------------------------------------

describe("canvasPointToNormalized / normalizedPointToCanvas", () => {
  const frame = { x: 100, y: 50, width: 200, height: 100, rotation: 0 };

  it("비회전 — 요소 좌상단=(0,0), 우하단=(1,1)", () => {
    expect(canvasPointToNormalized(100, 50, frame)).toEqual({ x: 0, y: 0 });
    expect(canvasPointToNormalized(300, 150, frame)).toEqual({ x: 1, y: 1 });
    expect(canvasPointToNormalized(200, 100, frame)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("90° 회전 — 요소 로컬 (1,0) 이 캔버스에서 아래쪽에 놓인다", () => {
    const rot = { ...frame, rotation: 90 };
    // forward: 로컬 (w,0) → 캔버스 (x, y+w)
    const fwd = normalizedPointToCanvas({ x: 1, y: 0 }, rot);
    expect(fwd.x).toBeCloseTo(100, 8);
    expect(fwd.y).toBeCloseTo(50 + 200, 8);
    // inverse 왕복
    const back = canvasPointToNormalized(fwd.x, fwd.y, rot);
    expect(back.x).toBeCloseTo(1, 8);
    expect(back.y).toBeCloseTo(0, 8);
  });

  it("임의 회전 왕복 오차 없음 + 0 크기 프레임 방어", () => {
    const rot = { x: 30, y: 40, width: 120, height: 90, rotation: 33.3 };
    const p = { x: 0.31, y: 0.77 };
    const cv = normalizedPointToCanvas(p, rot);
    const back = canvasPointToNormalized(cv.x, cv.y, rot);
    expect(back.x).toBeCloseTo(p.x, 8);
    expect(back.y).toBeCloseTo(p.y, 8);
    const degenerate = canvasPointToNormalized(10, 10, { x: 0, y: 0, width: 0, height: 0 });
    expect(Number.isFinite(degenerate.x)).toBe(true);
    expect(Number.isFinite(degenerate.y)).toBe(true);
  });
});

describe("subpathOutlinePoints", () => {
  it("정규화 점을 요소 로컬 px 평탄 배열로", () => {
    const sp = leftHalfSelection().subpaths[0]!;
    expect(subpathOutlinePoints(sp, { width: 200, height: 100 })).toEqual([0, 0, 100, 0, 100, 100, 0, 100]);
  });

  it("브러시 서브패스는 궤적 중심선을 그대로 반환한다(획 폭 미반영 — 표시는 brushStrokePreview)", () => {
    const sp: SelectionBrushSubpath = {
      mode: "add",
      kind: "brush",
      points: [
        { x: 0.1, y: 0.2 },
        { x: 0.5, y: 0.6 },
      ],
      radius: 0.1,
    };
    expect(subpathOutlinePoints(sp, { width: 100, height: 50 })).toEqual([10, 10, 50, 30]);
  });
});

describe("brushStrokePreview", () => {
  it("궤적 → 로컬 px 평탄 배열 + 획 굵기(2×반경×폭) — Konva Line(round cap/join) 대응", () => {
    const pv = brushStrokePreview(
      [
        { x: 0.1, y: 0.2 },
        { x: 0.5, y: 0.6 },
      ],
      0.1,
      { width: 200, height: 100 }
    )!;
    expect(pv.points).toEqual([20, 20, 100, 60]);
    expect(pv.strokeWidth).toBeCloseTo(40, 10);
  });

  it("점 1개(탭)는 같은 점을 복제해 라운드 캡이 원을 그리게 한다", () => {
    const pv = brushStrokePreview([{ x: 0.5, y: 0.5 }], 0.05, { width: 100, height: 100 })!;
    expect(pv.points).toEqual([50, 50, 50, 50]);
    expect(pv.strokeWidth).toBeCloseTo(10, 10);
  });

  it("빈 궤적·반경 0·비정상 크기는 null(그릴 것 없음)", () => {
    expect(brushStrokePreview([], 0.1, { width: 100, height: 100 })).toBeNull();
    expect(brushStrokePreview([{ x: 0.5, y: 0.5 }], 0, { width: 100, height: 100 })).toBeNull();
    expect(brushStrokePreview([{ x: 0.5, y: 0.5 }], Number.NaN, { width: 100, height: 100 })).toBeNull();
    expect(brushStrokePreview([{ x: 0.5, y: 0.5 }], 0.1, { width: 0, height: 100 })).toBeNull();
    expect(brushStrokePreview([{ x: 0.5, y: 0.5 }], 0.1, { width: 100, height: Number.NaN })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 마칭앤츠
// ---------------------------------------------------------------------------

describe("marchingAntsDashOffset / marchingAntsPasses", () => {
  const cycle = MARCHING_ANTS_DASH[0] + MARCHING_ANTS_DASH[1];

  it("t=0 → 0, 시간이 흐르면 음수로 전진, 주기로 접힘(결정적)", () => {
    expect(marchingAntsDashOffset(0)).toBe(0);
    const half = marchingAntsDashOffset(250, 18); // 0.25s × 18px/s = 4.5px
    expect(half).toBeCloseTo(-4.5, 10);
    // 정확히 한 주기(9px ÷ 18px/s = 0.5s)를 지나면 다시 0
    expect(marchingAntsDashOffset(500, 18)).toBeCloseTo(0, 10);
    expect(marchingAntsDashOffset(123456, 18)).toBeGreaterThan(-cycle);
    expect(marchingAntsDashOffset(123456, 18)).toBeLessThanOrEqual(0);
    expect(marchingAntsDashOffset(Number.NaN)).toBe(0);
    expect(marchingAntsDashOffset(1000, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("2패스 — 흰 실선 밑줄 + 어두운 대시, 줌 배율로 화면 두께 유지", () => {
    const passes = marchingAntsPasses(250, 2);
    expect(passes).toHaveLength(2);
    expect(passes[0]!.dash).toBeNull();
    expect(passes[0]!.stroke).toBe("#ffffff");
    expect(passes[1]!.dash).toEqual([MARCHING_ANTS_DASH[0] / 2, MARCHING_ANTS_DASH[1] / 2]);
    expect(passes[1]!.dashOffset).toBeCloseTo(marchingAntsDashOffset(250) / 2, 10);
    expect(passes[0]!.strokeWidth).toBeCloseTo(0.8, 10);
    // 비정상 배율은 1로 방어
    expect(marchingAntsPasses(0, 0)[0]!.strokeWidth).toBeCloseTo(1.6, 10);
  });
});

// ---------------------------------------------------------------------------
// 마스크 래스터화 계획
// ---------------------------------------------------------------------------

describe("buildSelectionMaskPlan", () => {
  it("정규화 → 원본 px 폴리곤, add=fill / subtract=erase, 크기 반올림", () => {
    const sel = addSelectionSubpath(leftHalfSelection(), "subtract", rectSelectionPolygon({ x: 0.25, y: 0.25 }, { x: 0.5, y: 0.5 }))!;
    const plan = buildSelectionMaskPlan(sel, 800.4, 600.2)!;
    expect(plan.width).toBe(800);
    expect(plan.height).toBe(600);
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0]!.op).toBe("fill");
    expect(plan.steps[0]!.points[1]).toEqual([400, 0]); // (0.5, 0) × (800, 600)
    expect(plan.steps[1]!.op).toBe("erase");
    expect(plan.steps[1]!.points[0]).toEqual([200, 150]);
    expect(plan.invert).toBe(false);
  });

  it("featherScale 로 표시 px→원본 px 환산(상한 250), invert 전달", () => {
    const sel = toggleSelectionInvert(setSelectionFeather(leftHalfSelection(), 10));
    const plan = buildSelectionMaskPlan(sel, 1600, 1200, { featherScale: 2 })!;
    expect(plan.featherPx).toBe(20);
    expect(plan.invert).toBe(true);
    const extreme = buildSelectionMaskPlan(setSelectionFeather(leftHalfSelection(), 60), 1600, 1200, { featherScale: 100 })!;
    expect(extreme.featherPx).toBe(250);
    // 비정상 배율은 1로 방어
    expect(buildSelectionMaskPlan(sel, 1600, 1200, { featherScale: Number.NaN })!.featherPx).toBe(10);
  });

  it("flipX/flipY — 화면 반전 표시 중 선택을 원본 픽셀 좌표로 되반전", () => {
    const plan = buildSelectionMaskPlan(leftHalfSelection(), 100, 50, { flipX: true, flipY: true })!;
    // (0,0) → flip → (100,50), (0.5,0) → (50,50)
    expect(plan.steps[0]!.points[0]).toEqual([100, 50]);
    expect(plan.steps[0]!.points[1]).toEqual([50, 50]);
  });

  it("브러시 서브패스 → 스트로크 단계(굵기 = 2×반경×마스크 폭), flip 은 점에만 적용", () => {
    const sel = addBrushSubpath(
      leftHalfSelection(),
      "subtract",
      [
        { x: 0.25, y: 0.5 },
        { x: 0.75, y: 0.5 },
      ],
      0.05
    )!;
    const plan = buildSelectionMaskPlan(sel, 800, 600)!;
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0]!.strokeWidth).toBeUndefined(); // 폴리곤은 기존 그대로(하위호환)
    expect(plan.steps[1]).toEqual({
      op: "erase",
      points: [
        [200, 300],
        [600, 300],
      ],
      strokeWidth: 80, // 2 × 0.05 × 800
    });
    const flipped = buildSelectionMaskPlan(sel, 800, 600, { flipX: true })!;
    expect(flipped.steps[1]!.points).toEqual([
      [600, 300],
      [200, 300],
    ]);
    expect(flipped.steps[1]!.strokeWidth).toBe(80); // 대칭 도형이라 굵기 불변
  });

  it("반경 0 브러시는 칠할 게 없어 단계에서 제외된다(히트테스트와 일치)", () => {
    const sel: PixelSelection = {
      subpaths: [
        leftHalfSelection().subpaths[0]!,
        { mode: "add", kind: "brush", points: [{ x: 0.5, y: 0.5 }], radius: 0 },
      ],
      featherPx: 0,
      invert: false,
    };
    const plan = buildSelectionMaskPlan(sel, 100, 100)!;
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]!.strokeWidth).toBeUndefined();
  });

  it("못 쓰는 선택·비정상 크기는 null", () => {
    expect(buildSelectionMaskPlan(null, 100, 100)).toBeNull();
    expect(buildSelectionMaskPlan(emptyPixelSelection(), 100, 100)).toBeNull();
    expect(buildSelectionMaskPlan(leftHalfSelection(), 0, 100)).toBeNull();
    expect(buildSelectionMaskPlan(leftHalfSelection(), 100, Number.NaN)).toBeNull();
  });
});

describe("paintSelectionMaskSteps / rasterizeSelectionMask", () => {
  function planOf(sel: PixelSelection, w = 100, h = 100): SelectionMaskPlan {
    return buildSelectionMaskPlan(sel, w, h)!;
  }

  it("fill=source-over·erase=destination-out 순서로 칠하고 evenodd 로 채운 뒤 원복", () => {
    const log: string[] = [];
    const sel = addSelectionSubpath(leftHalfSelection(), "subtract", rectSelectionPolygon({ x: 0, y: 0 }, { x: 0.2, y: 0.2 }))!;
    paintSelectionMaskSteps(fakeCtx(log, "m"), planOf(sel));
    expect(log[0]).toBe("m:clearRect(0,0,100,100)");
    const gcoWrites = log.filter((l) => l.startsWith("m:gco="));
    expect(gcoWrites).toEqual(["m:gco=source-over", "m:gco=destination-out", "m:gco=source-over"]);
    expect(log.filter((l) => l === "m:fill(evenodd)")).toHaveLength(2);
    expect(log[log.length - 1]).toBe("m:gco=source-over");
  });

  it("브러시 단계 — 라운드 캡/조인 흰 스트로크, erase 는 destination-out, 탭은 제자리 lineTo", () => {
    const log: string[] = [];
    const sel = addBrushSubpath(
      addBrushSubpath(
        null,
        "add",
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        0.1
      ),
      "subtract",
      [{ x: 0.5, y: 0.5 }],
      0.05
    )!;
    paintSelectionMaskSteps(fakeCtx(log, "m"), planOf(sel));
    // 획 스타일 — 흰색(alpha 1) 라운드 캡/조인, 굵기 = 2×반경×폭.
    expect(log).toContain("m:strokeStyle=#ffffff");
    expect(log).toContain("m:lineWidth=20");
    expect(log).toContain("m:lineWidth=10");
    expect(log.filter((l) => l === "m:lineCap=round")).toHaveLength(2);
    expect(log.filter((l) => l === "m:lineJoin=round")).toHaveLength(2);
    expect(log.filter((l) => l === "m:stroke")).toHaveLength(2);
    expect(log.filter((l) => l.startsWith("m:fill("))).toHaveLength(0); // 브러시만 → 폴리곤 채움 없음
    const gcoWrites = log.filter((l) => l.startsWith("m:gco="));
    expect(gcoWrites).toEqual(["m:gco=source-over", "m:gco=destination-out", "m:gco=source-over"]);
    // 탭(점 1개)은 moveTo 후 제자리 lineTo — 라운드 캡이 원(점 찍기)을 그린다.
    expect(log).toContain("m:moveTo(50,50)");
    expect(log).toContain("m:lineTo(50,50)");
  });

  it("페더·반전 없음 → 캔버스 1장으로 끝", () => {
    const log: string[] = [];
    const mask = rasterizeSelectionMask(planOf(leftHalfSelection()), fakeFactory(log));
    expect((mask as FakeCanvas).id).toBe(1);
    expect(log.filter((l) => l.startsWith("create#"))).toEqual(["create#1(100x100)"]);
  });

  it("브러시 + 페더 — 스트로크 마스크도 동일하게 blur 캔버스로 옮겨 그린다", () => {
    const log: string[] = [];
    const sel = setSelectionFeather(addBrushSubpath(null, "add", [{ x: 0.5, y: 0.5 }], 0.1)!, 6);
    const mask = rasterizeSelectionMask(planOf(sel), fakeFactory(log));
    expect((mask as FakeCanvas).id).toBe(2);
    expect(log).toContain("c1:stroke");
    expect(log).toContain("c2:filter=blur(6px)");
    expect(log).toContain("c2:drawImage(#1,0,0)");
  });

  it("페더 → 두 번째 캔버스에 blur 필터로 옮겨 그림", () => {
    const log: string[] = [];
    const mask = rasterizeSelectionMask(planOf(setSelectionFeather(leftHalfSelection(), 8)), fakeFactory(log));
    expect((mask as FakeCanvas).id).toBe(2);
    expect(log).toContain("c2:filter=blur(8px)");
    expect(log).toContain("c2:drawImage(#1,0,0)");
    expect(log).toContain("c2:filter=none");
  });

  it("반전 → 흰 바탕에서 destination-out 으로 알파 반전", () => {
    const log: string[] = [];
    const mask = rasterizeSelectionMask(planOf(toggleSelectionInvert(leftHalfSelection())), fakeFactory(log));
    expect((mask as FakeCanvas).id).toBe(2);
    expect(log).toContain("c2:fillRect(0,0,100,100)");
    expect(log).toContain("c2:gco=destination-out");
    expect(log[log.length - 1]).toBe("c2:gco=source-over");
  });

  it("팩토리 실패(null) 시 어느 단계에서든 null", () => {
    const plan = planOf(toggleSelectionInvert(setSelectionFeather(leftHalfSelection(), 5)));
    expect(rasterizeSelectionMask(plan, fakeFactory([], 1))).toBeNull();
    expect(rasterizeSelectionMask(plan, fakeFactory([], 2))).toBeNull();
    expect(rasterizeSelectionMask(plan, fakeFactory([], 3))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 조정 planner + 적용 합성
// ---------------------------------------------------------------------------

describe("planSelectionAdjust / isSelectionAdjustNoop", () => {
  it("밝기 — %p 를 brightness() 배율로(클램프·소수 노이즈 없음)", () => {
    expect(planSelectionAdjust("brightness", 35)).toEqual({ kind: "brightness", amount: 35, cssFilter: "brightness(1.35)" });
    expect(planSelectionAdjust("brightness", -100).cssFilter).toBe("brightness(0)");
    expect(planSelectionAdjust("brightness", 250).cssFilter).toBe("brightness(2)");
    expect(planSelectionAdjust("brightness", Number.NaN).cssFilter).toBe("brightness(1)");
  });

  it("색조 — hue-rotate(deg), 삭제 — cssFilter 없음", () => {
    expect(planSelectionAdjust("hue", 90)).toEqual({ kind: "hue", amount: 90, cssFilter: "hue-rotate(90deg)" });
    expect(planSelectionAdjust("hue", -400).cssFilter).toBe("hue-rotate(-180deg)");
    expect(planSelectionAdjust("delete")).toEqual({ kind: "delete", cssFilter: null });
  });

  it("noop 판정 — 양 0 인 밝기/색조만 true", () => {
    expect(isSelectionAdjustNoop(planSelectionAdjust("brightness", 0))).toBe(true);
    expect(isSelectionAdjustNoop(planSelectionAdjust("hue", 0))).toBe(true);
    expect(isSelectionAdjustNoop(planSelectionAdjust("hue", 1))).toBe(false);
    expect(isSelectionAdjustNoop(planSelectionAdjust("delete"))).toBe(false);
  });
});

describe("applySelectionAdjustToCanvas", () => {
  const source: MaskImageSource & { id: number; width: number; height: number } = { id: 900, width: 100, height: 50 };
  const mask: MaskImageSource & { id: number; width: number; height: number } = { id: 901, width: 100, height: 50 };

  it("삭제 — 원본 위에 destination-out 으로 마스크를 찍는다", () => {
    const log: string[] = [];
    const out = applySelectionAdjustToCanvas(source, 100, 50, mask, planSelectionAdjust("delete"), fakeFactory(log));
    expect((out as FakeCanvas).id).toBe(1);
    expect(log).toEqual([
      "create#1(100x50)",
      "c1:drawImage(#900,0,0)",
      "c1:gco=destination-out",
      "c1:drawImage(#901,0,0)",
      "c1:gco=source-over",
    ]);
  });

  it("밝기 — 필터 적용본을 마스크로 오려(destination-in) 원본 위에 합성", () => {
    const log: string[] = [];
    const out = applySelectionAdjustToCanvas(source, 100, 50, mask, planSelectionAdjust("brightness", 20), fakeFactory(log));
    expect((out as FakeCanvas).id).toBe(2);
    expect(log).toEqual([
      "create#1(100x50)",
      "c1:filter=brightness(1.2)",
      "c1:drawImage(#900,0,0)",
      "c1:filter=none",
      "c1:gco=destination-in",
      "c1:drawImage(#901,0,0)",
      "c1:gco=source-over",
      "create#2(100x50)",
      "c2:drawImage(#900,0,0)",
      "c2:drawImage(#1,0,0)",
    ]);
  });

  it("비정상 크기·팩토리 실패는 null", () => {
    expect(applySelectionAdjustToCanvas(source, 0, 50, mask, planSelectionAdjust("delete"), fakeFactory([]))).toBeNull();
    expect(applySelectionAdjustToCanvas(source, 100, 50, mask, planSelectionAdjust("hue", 30), fakeFactory([], 1))).toBeNull();
    expect(applySelectionAdjustToCanvas(source, 100, 50, mask, planSelectionAdjust("hue", 30), fakeFactory([], 2))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// DOM 구조 호환 — 실제 Canvas 타입이 구조 타입에 대입되는지 컴파일 검증
// ---------------------------------------------------------------------------

describe("DOM 구조 타입 호환(컴파일 검증)", () => {
  it("CanvasRenderingContext2D/HTMLCanvasElement/HTMLImageElement 가 구조상 호환", () => {
    // 값은 쓰지 않는다 — 대입이 컴파일되는 것 자체가 검증(통합부가 캐스트 없이 쓰기 위함).
    const ctxCompat: MaskCtx2DLike = null as unknown as CanvasRenderingContext2D;
    const canvasCompat: MaskCanvasLike & MaskImageSource = null as unknown as HTMLCanvasElement;
    const imageCompat: MaskImageSource = null as unknown as HTMLImageElement;
    expect(ctxCompat).toBeNull();
    expect(canvasCompat).toBeNull();
    expect(imageCompat).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 자석 올가미 — 휘도장·엣지 스냅·궤적 누적 (arm-anytime 웨이브 2026-07-24)
// ---------------------------------------------------------------------------

describe("자석 올가미 휘도장", () => {
  // 좌: 검정(0), 우: 흰색(255)인 2×1 세로 경계 4×2 RGBA.
  function verticalEdgeRgba(w: number, h: number, edgeX: number): Uint8ClampedArray {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const o = (y * w + x) * 4;
        const v = x >= edgeX ? 255 : 0;
        data[o] = v;
        data[o + 1] = v;
        data[o + 2] = v;
        data[o + 3] = 255;
      }
    }
    return data;
  }

  it("luminanceFieldFromRgba — Rec.601 휘도, 크기 불일치는 null", () => {
    const field = luminanceFieldFromRgba(verticalEdgeRgba(4, 2, 2), 4, 2);
    expect(field).not.toBeNull();
    expect(field!.width).toBe(4);
    expect(field!.data[0]).toBe(0); // 좌측 검정
    expect(field!.data[3]).toBe(255); // 우측 흰색
    // 알파 0은 흰 배경 합성(255)으로 근사 — 가짜 경계 방지.
    const transparent = new Uint8ClampedArray([10, 10, 10, 0]);
    expect(luminanceFieldFromRgba(transparent, 1, 1)!.data[0]).toBe(255);
    expect(luminanceFieldFromRgba(new Uint8ClampedArray(3), 4, 2)).toBeNull();
  });

  it("luminanceFieldGradientAt — 경계에서 최대, 평탄부는 0", () => {
    const field = luminanceFieldFromRgba(verticalEdgeRgba(4, 2, 2), 4, 2)!;
    // 경계(x=1↔2)에서 |Δx| 큼, 좌측 평탄부(x=0)는 0.
    expect(luminanceFieldGradientAt(field, 1, 0)).toBeGreaterThan(
      luminanceFieldGradientAt(field, 0, 0),
    );
  });

  it("snapLassoPointToEdge — 근처 점을 가장 강한 가장자리 셀로 끌어당긴다", () => {
    const field = luminanceFieldFromRgba(verticalEdgeRgba(8, 1, 4), 8, 1)!;
    // 경계는 셀 3↔4 사이. 셀 2 중심(정규화 2.5/8)에서 시작하면 가장자리(셀 3 또는 4)로 스냅.
    const snapped = snapLassoPointToEdge({ x: 2.5 / 8, y: 0.5 }, field, { searchRadiusPx: 3 });
    const snappedCell = Math.round(snapped.x * 8 - 0.5);
    expect(snappedCell === 3 || snappedCell === 4).toBe(true);
  });

  it("snapLassoPointToEdge — 평탄한 장(가장자리 없음)에서는 원점 유지", () => {
    const flat = luminanceFieldFromRgba(new Uint8ClampedArray(8 * 4).fill(128), 8, 1)!;
    const p = { x: 0.4, y: 0.5 };
    expect(snapLassoPointToEdge(p, flat)).toEqual(p);
  });

  it("appendMagneticLassoPoint — field 없으면 일반 올가미와 동일, 결정적", () => {
    const field = luminanceFieldFromRgba(verticalEdgeRgba(8, 1, 4), 8, 1)!;
    const start: SelPoint[] = [{ x: 0.1, y: 0.5 }];
    // field=null → 스냅 없이 그대로 누적(일반 올가미).
    const plain = appendMagneticLassoPoint(start, { x: 0.3, y: 0.5 }, null);
    expect(plain).toEqual(appendLassoPoint(start, { x: 0.3, y: 0.5 }));
    // field 있으면 스냅된 점이 누적되고, 같은 입력은 같은 결과(결정성).
    const a = appendMagneticLassoPoint(start, { x: 2.5 / 8, y: 0.5 }, field, { searchRadiusPx: 3 });
    const b = appendMagneticLassoPoint(start, { x: 2.5 / 8, y: 0.5 }, field, { searchRadiusPx: 3 });
    expect(a).toEqual(b);
    expect(a.length).toBe(2);
  });

  it("updateSelectionDrag — magneticField 옵션이 lasso 궤적을 엣지로 스냅한다", () => {
    const field = luminanceFieldFromRgba(verticalEdgeRgba(8, 1, 4), 8, 1)!;
    const drag = beginSelectionDrag("lasso", "add", { x: 0.1, y: 0.5 });
    const nextPlain = updateSelectionDrag(drag, { x: 2.5 / 8, y: 0.5 }, {});
    const nextMagnetic = updateSelectionDrag(drag, { x: 2.5 / 8, y: 0.5 }, { magneticField: field });
    // 자석 옵션이 있으면 마지막 점이 가장자리로 이동해 일반 궤적과 달라진다.
    expect(nextMagnetic.points.at(-1)).not.toEqual(nextPlain.points.at(-1));
  });
});

// ---------------------------------------------------------------------------
// arm-anytime — 자동 대상 획득 + 제스처 시작 결합 모드 (2026-07-24)
// ---------------------------------------------------------------------------

describe("resolvePixelSelectionAutoTarget", () => {
  const box = (id: string, x: number, y: number, extra?: { hidden?: boolean; locked?: boolean }) => ({
    id,
    frame: { x, y, width: 100, height: 100, rotation: 0 },
    ...extra,
  });

  it("포인터 아래 최상단(배열 뒤쪽) 편집 가능 이미지를 고른다", () => {
    const res = resolvePixelSelectionAutoTarget([box("bottom", 0, 0), box("top", 0, 0)], { x: 50, y: 50 });
    expect(res).toEqual({ kind: "target", id: "top" });
  });

  it("숨김 후보는 히트하지 않고 아래의 보이는 이미지를 고른다", () => {
    const res = resolvePixelSelectionAutoTarget(
      [box("visible", 0, 0), box("hidden-top", 0, 0, { hidden: true })],
      { x: 50, y: 50 },
    );
    expect(res).toEqual({ kind: "target", id: "visible" });
  });

  it("잠긴 후보는 통과시켜 아래의 편집 가능 이미지를 고른다", () => {
    const res = resolvePixelSelectionAutoTarget(
      [box("editable", 0, 0), box("locked-top", 0, 0, { locked: true })],
      { x: 50, y: 50 },
    );
    expect(res).toEqual({ kind: "target", id: "editable" });
  });

  it("편집 가능 히트가 전혀 없고 잠긴 이미지만 있으면 locked + 최상단 잠긴 id", () => {
    const res = resolvePixelSelectionAutoTarget([box("locked", 0, 0, { locked: true })], { x: 50, y: 50 });
    expect(res).toEqual({ kind: "locked", id: "locked" });
  });

  it("포인터 아래에 이미지가 없으면 none", () => {
    expect(resolvePixelSelectionAutoTarget([box("far", 500, 500)], { x: 50, y: 50 })).toEqual({ kind: "none" });
    expect(resolvePixelSelectionAutoTarget([], { x: 50, y: 50 })).toEqual({ kind: "none" });
    expect(resolvePixelSelectionAutoTarget([box("a", 0, 0)], { x: Number.NaN, y: 50 })).toEqual({ kind: "none" });
  });
});

describe("extractSelectionToCanvas", () => {
  const source = { id: 900 } as unknown as MaskImageSource;
  const mask = { id: 901 } as unknown as MaskImageSource;

  it("마스크 안만 남긴 뒤 경계 박스로 크롭한다(destination-in → 음수 오프셋 재그리기)", () => {
    const log: string[] = [];
    const result = extractSelectionToCanvas(
      source,
      100,
      50,
      mask,
      { x: 0.2, y: 0.4, w: 0.5, h: 0.4 },
      fakeFactory(log),
    );
    expect(result).not.toBeNull();
    // 0.2*100=20 .. (0.2+0.5)*100=70 → 폭 50 / 0.4*50=20 .. 0.8*50=40 → 높이 20
    expect(result!.cropX).toBe(20);
    expect(result!.cropY).toBe(20);
    expect(result!.cropWidth).toBe(50);
    expect(result!.cropHeight).toBe(20);
    expect(log).toEqual([
      "create#1(100x50)",
      "c1:drawImage(#900,0,0)",
      "c1:gco=destination-in",
      "c1:drawImage(#901,0,0)",
      "c1:gco=source-over",
      "create#2(50x20)",
      "c2:drawImage(#1,-20,-20)",
    ]);
  });

  it("박스를 캔버스 안으로 클램프한다(음수·초과 좌표 방어)", () => {
    const result = extractSelectionToCanvas(
      source,
      100,
      50,
      mask,
      { x: -0.5, y: -0.5, w: 3, h: 3 },
      fakeFactory([]),
    );
    expect(result).toMatchObject({ cropX: 0, cropY: 0, cropWidth: 100, cropHeight: 50 });
  });

  it("면적이 없거나 비정상 입력·팩토리 실패는 null", () => {
    expect(
      extractSelectionToCanvas(source, 100, 50, mask, { x: 0.5, y: 0.5, w: 0, h: 0 }, fakeFactory([])),
    ).toBeNull();
    expect(
      extractSelectionToCanvas(source, 0, 50, mask, { x: 0, y: 0, w: 1, h: 1 }, fakeFactory([])),
    ).toBeNull();
    expect(
      extractSelectionToCanvas(source, 100, 50, mask, { x: Number.NaN, y: 0, w: 1, h: 1 }, fakeFactory([])),
    ).toBeNull();
    // 두 번째 캔버스(크롭 대상) 생성 실패
    expect(
      extractSelectionToCanvas(source, 100, 50, mask, { x: 0, y: 0, w: 1, h: 1 }, fakeFactory([], 2)),
    ).toBeNull();
  });
});

describe("resolveSelectionCombineOverride", () => {
  it("기존 선택이 없으면 base 유지(Shift/Alt 는 형태 제약 의미)", () => {
    expect(resolveSelectionCombineOverride("add", { shift: true }, false)).toBe("add");
    expect(resolveSelectionCombineOverride("add", { alt: true }, false)).toBe("add");
  });

  it("기존 선택이 있으면 Shift=add, Alt=subtract, 둘 다=intersect", () => {
    expect(resolveSelectionCombineOverride("subtract", { shift: true }, true)).toBe("add");
    expect(resolveSelectionCombineOverride("add", { alt: true }, true)).toBe("subtract");
    expect(resolveSelectionCombineOverride("add", { shift: true, alt: true }, true)).toBe("intersect");
    expect(resolveSelectionCombineOverride("subtract", {}, true)).toBe("subtract");
  });
});

describe("shouldMoveSelectionMarquee (Magma outline-drag)", () => {
  it("moves only when an existing marquee is hit with replace intent", () => {
    expect(
      shouldMoveSelectionMarquee({
        hasUsableSelection: true,
        pointInside: true,
        operationMode: "replace",
      }),
    ).toBe(true);
    expect(
      shouldMoveSelectionMarquee({
        hasUsableSelection: true,
        pointInside: true,
        operationMode: "add",
      }),
    ).toBe(false);
    expect(
      shouldMoveSelectionMarquee({
        hasUsableSelection: true,
        pointInside: false,
        operationMode: "replace",
      }),
    ).toBe(false);
    expect(
      shouldMoveSelectionMarquee({
        hasUsableSelection: false,
        pointInside: true,
        operationMode: "replace",
      }),
    ).toBe(false);
  });
});
