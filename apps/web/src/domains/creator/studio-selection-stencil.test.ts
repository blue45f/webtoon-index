import { describe, expect, it } from "vitest";

import {
  applyStencilToDabAlphaMap,
  buildSelectionStencil,
  classifyStencilDab,
  clipStrokePolylineToStencil,
  selectionStencilKey,
  stencilCoverageAt,
  stencilCoverageAtNorm,
  stencilDabCoverage,
  stencilTexelTransform,
  SELECTION_STENCIL_MAX_DIM,
  type SelectionStencil,
} from "./studio-selection-stencil";
import {
  emptyPixelSelection,
  rectSelectionPolygon,
  type PixelSelection,
  type SelectionFrame,
} from "./studio-selection-tools";

/** 200×200 문서 px 위의 비회전 요소 — 텍셀 1개 = 문서 1px 이 되어 좌표 검산이 쉽다. */
const FRAME: SelectionFrame = { x: 0, y: 0, width: 200, height: 200, rotation: 0 };

function rectSelection(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  extra?: Partial<PixelSelection>
): PixelSelection {
  return {
    ...emptyPixelSelection(),
    subpaths: [{ mode: "add", points: rectSelectionPolygon({ x: x1, y: y1 }, { x: x2, y: y2 }) }],
    ...extra,
  };
}

/** 0.25..0.75 정규화 = 문서 50..150 px 사각 선택. */
function centerStencil(extra?: Partial<PixelSelection>, frame: SelectionFrame = FRAME): SelectionStencil {
  const stencil = buildSelectionStencil(rectSelection(0.25, 0.25, 0.75, 0.75, extra), frame);
  if (!stencil) throw new Error("stencil build failed");
  return stencil;
}

describe("buildSelectionStencil", () => {
  it("returns null (= no clipping) when there is nothing selected", () => {
    expect(buildSelectionStencil(null, FRAME)).toBeNull();
    expect(buildSelectionStencil(emptyPixelSelection(), FRAME)).toBeNull();
    // subtract-only 선택은 isSelectionUsable=false — 그리기를 막지 않는다.
    const subtractOnly: PixelSelection = {
      ...emptyPixelSelection(),
      subpaths: [{ mode: "subtract", points: rectSelectionPolygon({ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.4 }) }],
    };
    expect(buildSelectionStencil(subtractOnly, FRAME)).toBeNull();
  });

  it("rejects degenerate frames", () => {
    const sel = rectSelection(0.25, 0.25, 0.75, 0.75);
    expect(buildSelectionStencil(sel, { ...FRAME, width: 0 })).toBeNull();
    expect(buildSelectionStencil(sel, { ...FRAME, height: Number.NaN })).toBeNull();
    expect(buildSelectionStencil(sel, { ...FRAME, x: Number.NaN })).toBeNull();
  });

  it("sizes the field to the displayed frame and caps the long side", () => {
    const small = centerStencil();
    expect(small.width).toBe(200);
    expect(small.height).toBe(200);

    const huge = buildSelectionStencil(rectSelection(0.25, 0.25, 0.75, 0.75), {
      ...FRAME,
      width: 4000,
      height: 2000,
    })!;
    expect(huge.width).toBe(SELECTION_STENCIL_MAX_DIM);
    expect(huge.height).toBe(SELECTION_STENCIL_MAX_DIM / 2);
  });

  it("is deterministic — same input yields byte-identical alpha and the same key", () => {
    const a = centerStencil();
    const b = centerStencil();
    expect(a.key).toBe(b.key);
    expect(Array.from(a.alpha)).toEqual(Array.from(b.alpha));
  });
});

describe("selectionStencilKey", () => {
  it("changes when geometry, feather, invert, frame or resolution change", () => {
    const base = rectSelection(0.25, 0.25, 0.75, 0.75);
    const key = selectionStencilKey(base, FRAME);
    expect(selectionStencilKey(rectSelection(0.25, 0.25, 0.76, 0.75), FRAME)).not.toBe(key);
    expect(selectionStencilKey({ ...base, featherPx: 4 }, FRAME)).not.toBe(key);
    expect(selectionStencilKey({ ...base, invert: true }, FRAME)).not.toBe(key);
    expect(selectionStencilKey(base, { ...FRAME, x: 12 })).not.toBe(key);
    expect(selectionStencilKey(base, FRAME, 320)).not.toBe(key);
    expect(selectionStencilKey(null, FRAME)).toBe("none");
  });
});

describe("stencil coverage sampling", () => {
  it("is 1 well inside and 0 well outside the selection", () => {
    const stencil = centerStencil();
    expect(stencilCoverageAt(stencil, 100, 100)).toBe(1);
    expect(stencilCoverageAt(stencil, 60, 140)).toBe(1);
    expect(stencilCoverageAt(stencil, 10, 10)).toBe(0);
    expect(stencilCoverageAt(stencil, 199, 100)).toBe(0);
  });

  it("straddles the hard boundary with a half-texel bilinear ramp", () => {
    const stencil = centerStencil();
    // 텍셀 중심 규약상 x=50(=u 0.25)은 정확히 두 텍셀 사이 → 0.5.
    expect(stencilCoverageAt(stencil, 50, 100)).toBeCloseTo(0.5, 6);
    expect(stencilCoverageAt(stencil, 49, 100)).toBe(0);
    expect(stencilCoverageAt(stencil, 51, 100)).toBe(1);
  });

  it("returns partial alpha across a feathered edge", () => {
    const stencil = centerStencil({ featherPx: 8 });
    const outer = stencilCoverageAt(stencil, 47, 100);
    const edge = stencilCoverageAt(stencil, 50, 100);
    const inner = stencilCoverageAt(stencil, 53, 100);
    expect(outer).toBeGreaterThan(0);
    expect(outer).toBeLessThan(edge);
    expect(edge).toBeGreaterThan(0.25);
    expect(edge).toBeLessThan(0.75);
    expect(inner).toBeGreaterThan(edge);
    expect(inner).toBeLessThan(1);
    // 충분히 멀면 다시 완전 0 / 완전 1로 수렴한다.
    expect(stencilCoverageAt(stencil, 100, 100)).toBe(1);
    expect(stencilCoverageAt(stencil, 10, 100)).toBe(0);
  });

  it("inverts: the rectangle becomes the protected area and outside-the-frame is drawable", () => {
    const stencil = centerStencil({ invert: true });
    expect(stencil.outsideAlpha).toBe(255);
    expect(stencil.boundsPx).toBeNull();
    expect(stencilCoverageAt(stencil, 100, 100)).toBe(0);
    expect(stencilCoverageAt(stencil, 10, 10)).toBe(1);
    // 요소 박스 자체를 벗어난 문서 좌표도 "선택됨"이 정답이다(보간하지 않고 outsideAlpha 사용).
    expect(stencilCoverageAt(stencil, -500, -500)).toBe(1);
    expect(stencilCoverageAtNorm(stencil, 1.4, 0.5)).toBe(1);
  });

  it("honours element rotation when converting document points", () => {
    const rotated = centerStencil(undefined, { ...FRAME, rotation: 90 });
    // 90° 회전: 로컬(100,100) 중심은 문서상 (-100, 100)으로 간다.
    expect(stencilCoverageAt(rotated, -100, 100)).toBe(1);
    expect(stencilCoverageAt(rotated, 100, 100)).toBe(0);
  });

  it("exposes a document→texel affine that matches the CPU sampler", () => {
    const stencil = centerStencil(undefined, { ...FRAME, rotation: 30, x: 17, y: -9 });
    const m = stencilTexelTransform(stencil);
    for (const [x, y] of [
      [100, 100],
      [40, 160],
      [17, -9],
    ] as const) {
      const tx = m.a * x + m.b * y + m.e;
      const ty = m.c * x + m.d * y + m.f;
      const viaAffine = stencilCoverageAtNorm(stencil, tx / m.width, ty / m.height);
      expect(viaAffine).toBeCloseTo(stencilCoverageAt(stencil, x, y), 6);
    }
  });
});

describe("classifyStencilDab", () => {
  it("classifies fully-inside dabs as inside", () => {
    const stencil = centerStencil();
    const verdict = classifyStencilDab(stencil, 100, 100, 20);
    expect(verdict.kind).toBe("inside");
    expect(verdict.coverage).toBe(1);
    expect(verdict.minCoverage).toBe(1);
  });

  it("rejects dabs that cannot touch the selection bounds", () => {
    const stencil = centerStencil();
    const verdict = classifyStencilDab(stencil, 10, 10, 5);
    expect(verdict.kind).toBe("outside");
    expect(verdict.coverage).toBe(0);
    expect(verdict.maxCoverage).toBe(0);
    expect(stencilDabCoverage(stencil, 10, 10, 5)).toBe(0);
  });

  it("marks boundary-straddling dabs partial with an in-between mean coverage", () => {
    const stencil = centerStencil();
    const verdict = classifyStencilDab(stencil, 50, 100, 20);
    expect(verdict.kind).toBe("partial");
    expect(verdict.minCoverage).toBe(0);
    expect(verdict.maxCoverage).toBe(1);
    expect(verdict.coverage).toBeGreaterThan(0.3);
    expect(verdict.coverage).toBeLessThan(0.7);
  });

  it("keeps feathered dabs partial even when fully inside the polygon", () => {
    const stencil = centerStencil({ featherPx: 12 });
    const verdict = classifyStencilDab(stencil, 55, 100, 6);
    expect(verdict.kind).toBe("partial");
    expect(verdict.coverage).toBeGreaterThan(0);
    expect(verdict.coverage).toBeLessThan(1);
  });

  it("inverts: the same dab flips from inside to outside", () => {
    const normal = centerStencil();
    const inverted = centerStencil({ invert: true });
    expect(classifyStencilDab(normal, 100, 100, 10).kind).toBe("inside");
    expect(classifyStencilDab(inverted, 100, 100, 10).kind).toBe("outside");
    expect(classifyStencilDab(inverted, 10, 10, 5).kind).toBe("inside");
  });

  it("falls back to a centre sample for sub-texel and degenerate dabs", () => {
    const stencil = centerStencil();
    expect(classifyStencilDab(stencil, 100, 100, 0.05).kind).toBe("inside");
    expect(classifyStencilDab(stencil, 10, 10, 0).kind).toBe("outside");
    expect(classifyStencilDab(stencil, Number.NaN, 100, 4).kind).toBe("outside");
  });

  it("stays bounded for enormous dabs by deterministic stride sampling", () => {
    const stencil = centerStencil();
    const verdict = classifyStencilDab(stencil, 100, 100, 5000);
    expect(verdict.kind).toBe("partial");
    expect(verdict.coverage).toBeGreaterThan(0);
    expect(verdict.coverage).toBeLessThan(1);
    expect(classifyStencilDab(stencil, 100, 100, 5000)).toEqual(verdict);
  });
});

describe("applyStencilToDabAlphaMap", () => {
  /** 5×5 알파맵을 x=48..52 에 걸치게 두면 경계(50)가 정확히 가운데 열이다. */
  function straddlingMap(): Uint8ClampedArray {
    return new Uint8ClampedArray(25).fill(255);
  }

  it("multiplies dab alpha by the stencil coverage in place", () => {
    const stencil = centerStencil();
    const map = straddlingMap();
    const result = applyStencilToDabAlphaMap(map, 5, 5, { originX: 48, originY: 98 }, stencil);
    expect(Array.from(map.slice(0, 5))).toEqual([0, 0, 128, 255, 255]);
    expect(result.maxAlpha).toBe(255);
    expect(result.changed).toBe(15); // 열 0·1 이 255→0, 열 2 가 255→128
  });

  it("reports maxAlpha 0 when the dab lands entirely outside the selection", () => {
    const stencil = centerStencil();
    const map = straddlingMap();
    const result = applyStencilToDabAlphaMap(map, 5, 5, { originX: 4, originY: 4 }, stencil);
    expect(result.maxAlpha).toBe(0);
    expect(map.every((v) => v === 0)).toBe(true);
  });

  it("leaves an entirely inside dab untouched", () => {
    const stencil = centerStencil();
    const map = straddlingMap();
    const result = applyStencilToDabAlphaMap(map, 5, 5, { originX: 98, originY: 98 }, stencil);
    expect(result.changed).toBe(0);
    expect(result.maxAlpha).toBe(255);
  });

  it("produces partial alpha over a feathered edge", () => {
    const stencil = centerStencil({ featherPx: 10 });
    const map = straddlingMap();
    applyStencilToDabAlphaMap(map, 5, 5, { originX: 48, originY: 98 }, stencil);
    const row = Array.from(map.slice(0, 5));
    expect(row[0]!).toBeGreaterThan(0);
    expect(row[4]!).toBeLessThan(255);
    for (let i = 1; i < row.length; i += 1) expect(row[i]!).toBeGreaterThan(row[i - 1]!);
  });

  it("rejects mismatched buffers without throwing", () => {
    const stencil = centerStencil();
    const map = new Uint8ClampedArray(9).fill(255);
    expect(applyStencilToDabAlphaMap(map, 5, 5, { originX: 0, originY: 0 }, stencil)).toEqual({
      changed: 0,
      maxAlpha: 0,
    });
    expect(map.every((v) => v === 255)).toBe(true);
  });
});

describe("clipStrokePolylineToStencil", () => {
  it("keeps a fully-inside polyline as a single untouched span", () => {
    const stencil = centerStencil();
    const points = [
      { x: 60, y: 60 },
      { x: 100, y: 100 },
      { x: 140, y: 140 },
    ];
    const spans = clipStrokePolylineToStencil(points, stencil);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.points).toEqual(points);
    expect(spans[0]!.startIndex).toBe(0);
    expect(spans[0]!.endIndex).toBe(2);
  });

  it("drops a fully-outside polyline", () => {
    const stencil = centerStencil();
    const spans = clipStrokePolylineToStencil(
      [
        { x: 10, y: 10 },
        { x: 20, y: 20 },
        { x: 10, y: 30 },
      ],
      stencil
    );
    expect(spans).toEqual([]);
  });

  it("cuts a straddling polyline at the boundary", () => {
    const stencil = centerStencil();
    const spans = clipStrokePolylineToStencil(
      [
        { x: 20, y: 100 },
        { x: 100, y: 100 },
      ],
      stencil
    );
    expect(spans).toHaveLength(1);
    const first = spans[0]!.points[0]!;
    expect(first.x).toBeCloseTo(50, 1);
    expect(first.y).toBeCloseTo(100, 6);
    expect(spans[0]!.points[spans[0]!.points.length - 1]).toEqual({ x: 100, y: 100 });
    expect(spans[0]!.startIndex).toBe(1);
  });

  it("finds a crossing whose segment endpoints are both outside", () => {
    const stencil = centerStencil();
    // 한 세그먼트가 선택을 통째로 관통 — 꼭짓점만 보면 놓친다.
    const spans = clipStrokePolylineToStencil(
      [
        { x: 10, y: 100 },
        { x: 190, y: 100 },
      ],
      stencil
    );
    expect(spans).toHaveLength(1);
    const span = spans[0]!;
    expect(span.points).toHaveLength(2);
    expect(span.points[0]!.x).toBeCloseTo(50, 0);
    expect(span.points[1]!.x).toBeCloseTo(150, 0);
    // 세그먼트 하나 안에서 시작하고 끝난 조각 — 원본 꼭짓점을 하나도 품지 않는다.
    expect(span.startIndex).toBeGreaterThan(span.endIndex);
  });

  it("splits into multiple spans when the stroke re-enters", () => {
    const stencil = centerStencil();
    const spans = clipStrokePolylineToStencil(
      [
        { x: 100, y: 100 },
        { x: 100, y: 20 },
        { x: 120, y: 20 },
        { x: 120, y: 100 },
      ],
      stencil
    );
    expect(spans).toHaveLength(2);
    expect(spans[0]!.points[0]).toEqual({ x: 100, y: 100 });
    expect(spans[0]!.points[spans[0]!.points.length - 1]!.y).toBeCloseTo(50, 0);
    expect(spans[1]!.points[0]!.y).toBeCloseTo(50, 0);
    expect(spans[1]!.points[spans[1]!.points.length - 1]).toEqual({ x: 120, y: 100 });
  });

  it("treats a tap as a one-point span only when it is inside", () => {
    const stencil = centerStencil();
    expect(clipStrokePolylineToStencil([{ x: 100, y: 100 }], stencil)).toEqual([
      { points: [{ x: 100, y: 100 }], startIndex: 0, endIndex: 0 },
    ]);
    expect(clipStrokePolylineToStencil([{ x: 10, y: 10 }], stencil)).toEqual([]);
    expect(clipStrokePolylineToStencil([], stencil)).toEqual([]);
  });

  it("cuts at the 50% coverage contour of a feathered edge", () => {
    const stencil = centerStencil({ featherPx: 10 });
    const spans = clipStrokePolylineToStencil(
      [
        { x: 20, y: 100 },
        { x: 100, y: 100 },
      ],
      stencil
    );
    expect(spans).toHaveLength(1);
    const entry = spans[0]!.points[0]!;
    expect(entry.x).toBeGreaterThan(40);
    expect(entry.x).toBeLessThan(60);
    expect(stencilCoverageAt(stencil, entry.x, entry.y)).toBeCloseTo(0.5, 2);
  });

  it("inverts: the same stroke keeps the complementary spans", () => {
    const inverted = centerStencil({ invert: true });
    const spans = clipStrokePolylineToStencil(
      [
        { x: 10, y: 100 },
        { x: 190, y: 100 },
      ],
      inverted
    );
    expect(spans).toHaveLength(2);
    expect(spans[0]!.points[0]).toEqual({ x: 10, y: 100 });
    expect(spans[0]!.points[1]!.x).toBeCloseTo(50, 0);
    expect(spans[1]!.points[0]!.x).toBeCloseTo(150, 0);
    expect(spans[1]!.points[1]).toEqual({ x: 190, y: 100 });
  });

  it("is deterministic across repeated runs", () => {
    const stencil = centerStencil({ featherPx: 6 });
    const points = [
      { x: 12, y: 40 },
      { x: 180, y: 120 },
      { x: 30, y: 190 },
    ];
    expect(clipStrokePolylineToStencil(points, stencil)).toEqual(
      clipStrokePolylineToStencil(points, stencil)
    );
  });
});
