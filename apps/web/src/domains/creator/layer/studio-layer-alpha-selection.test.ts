import { describe, expect, it } from "vitest";

import {
  emptyPixelSelection,
  isSelectionUsable,
  pointInSelection,
  rectSelectionPolygon,
  type PixelSelection,
} from "../studio-selection-tools";

import {
  alphaBitmapFromRgba,
  alphaRingsToPixelSelection,
  downsampleAlphaBitmap,
  layerAlphaToPixelSelection,
  traceAlphaContourRings,
  LAYER_ALPHA_MAX_POINTS_PER_RING,
  LAYER_ALPHA_TRACE_MAX_DIM,
  type AlphaBitmap,
} from "./studio-layer-alpha-selection";

/** 알파 비트맵 생성 헬퍼 — fn(x,y) → 0..255. */
function makeBitmap(width: number, height: number, fn: (x: number, y: number) => number): AlphaBitmap {
  const alpha = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) alpha[y * width + x] = fn(x, y);
  }
  return { width, height, alpha };
}

function inBox(x: number, y: number, x0: number, y0: number, x1: number, y1: number): boolean {
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

const SOLID = 255;

describe("alphaBitmapFromRgba", () => {
  it("extracts the alpha channel", () => {
    const rgba = new Uint8ClampedArray([1, 2, 3, 40, 5, 6, 7, 80, 9, 10, 11, 120, 13, 14, 15, 160]);
    const bitmap = alphaBitmapFromRgba(rgba, 2, 2)!;
    expect(bitmap.width).toBe(2);
    expect(Array.from(bitmap.alpha)).toEqual([40, 80, 120, 160]);
  });

  it("rejects short buffers and degenerate sizes", () => {
    expect(alphaBitmapFromRgba(new Uint8ClampedArray(4), 2, 2)).toBeNull();
    expect(alphaBitmapFromRgba(new Uint8ClampedArray(16), 0, 2)).toBeNull();
    expect(alphaBitmapFromRgba(new Uint8ClampedArray(16), Number.NaN, 2)).toBeNull();
  });
});

describe("downsampleAlphaBitmap", () => {
  it("returns the same object when already within the cap", () => {
    const bitmap = makeBitmap(8, 8, () => SOLID);
    expect(downsampleAlphaBitmap(bitmap, 16)).toBe(bitmap);
  });

  it("box-averages down to the cap preserving aspect ratio", () => {
    const bitmap = makeBitmap(8, 4, (x) => (x < 4 ? 0 : 255));
    const small = downsampleAlphaBitmap(bitmap, 4);
    expect(small.width).toBe(4);
    expect(small.height).toBe(2);
    expect(Array.from(small.alpha.slice(0, 4))).toEqual([0, 0, 255, 255]);
  });

  it("is deterministic", () => {
    const bitmap = makeBitmap(64, 64, (x, y) => (x * 7 + y * 13) % 256);
    expect(Array.from(downsampleAlphaBitmap(bitmap, 16).alpha)).toEqual(
      Array.from(downsampleAlphaBitmap(bitmap, 16).alpha)
    );
  });
});

describe("traceAlphaContourRings", () => {
  it("traces a solid rectangle into one canonically ordered outer ring", () => {
    const bitmap = makeBitmap(32, 32, (x, y) => (inBox(x, y, 8, 8, 23, 23) ? SOLID : 0));
    const rings = traceAlphaContourRings(bitmap);
    expect(rings).toHaveLength(1);
    const [ring] = rings;
    expect(ring!.kind).toBe("outer");
    expect(ring!.parent).toBe(-1);
    expect(ring!.componentIndex).toBe(0);
    // 앵커((y,x) 사전순 최소)가 index 0, 방향은 부호 있는 면적 > 0.
    expect(ring!.points).toEqual([
      { x: 0.25, y: 0.25 },
      { x: 0.75, y: 0.25 },
      { x: 0.75, y: 0.75 },
      { x: 0.25, y: 0.75 },
    ]);
    expect(ring!.signedArea).toBeCloseTo(0.25, 10);
  });

  it("traces a ring-with-hole into an outer ring plus an inward-wound hole", () => {
    const bitmap = makeBitmap(32, 32, (x, y) =>
      inBox(x, y, 4, 4, 27, 27) && !inBox(x, y, 12, 12, 19, 19) ? SOLID : 0
    );
    const rings = traceAlphaContourRings(bitmap);
    expect(rings.map((r) => r.kind)).toEqual(["outer", "hole"]);
    expect(rings[1]!.parent).toBe(0);
    expect(rings[1]!.componentIndex).toBe(0);
    expect(rings[0]!.signedArea).toBeGreaterThan(0);
    expect(rings[1]!.signedArea).toBeLessThan(0);
    expect(rings[0]!.points[0]).toEqual({ x: 0.125, y: 0.125 });
    expect(rings[1]!.points).toEqual([
      { x: 0.375, y: 0.375 },
      { x: 0.375, y: 0.625 },
      { x: 0.625, y: 0.625 },
      { x: 0.625, y: 0.375 },
    ]);
  });

  it("traces disjoint blobs as separate components in raster-scan order", () => {
    const bitmap = makeBitmap(32, 32, (x, y) =>
      inBox(x, y, 2, 2, 7, 7) || inBox(x, y, 20, 22, 27, 29) ? SOLID : 0
    );
    const rings = traceAlphaContourRings(bitmap);
    expect(rings).toHaveLength(2);
    expect(rings.every((r) => r.kind === "outer")).toBe(true);
    expect(rings.map((r) => r.componentIndex)).toEqual([0, 1]);
    // 위쪽(스캔이 먼저 닿는) 블롭이 먼저 나온다.
    expect(rings[0]!.points[0]!.y).toBeLessThan(rings[1]!.points[0]!.y);
  });

  it("cuts an antialiased edge exactly at the requested threshold", () => {
    // x=14→64, 15→127, 16→191, 17.. →255 인 소프트 세로 경계.
    const ramp = (x: number): number => (x <= 13 ? 0 : x === 14 ? 64 : x === 15 ? 127 : x === 16 ? 191 : 255);
    const bitmap = makeBitmap(32, 32, (x) => ramp(x));
    const at128 = traceAlphaContourRings(bitmap, { threshold: 128 });
    const at192 = traceAlphaContourRings(bitmap, { threshold: 192 });
    const at64 = traceAlphaContourRings(bitmap, { threshold: 64 });
    const leftEdge = (rings: ReturnType<typeof traceAlphaContourRings>): number =>
      Math.min(...rings[0]!.points.map((p) => p.x));
    expect(leftEdge(at128)).toBeCloseTo(16 / 32, 10);
    expect(leftEdge(at192)).toBeCloseTo(17 / 32, 10);
    expect(leftEdge(at64)).toBeCloseTo(14 / 32, 10);
  });

  it("returns no rings for a fully transparent layer", () => {
    expect(traceAlphaContourRings(makeBitmap(16, 16, () => 0))).toEqual([]);
    // 문턱 미만의 아주 옅은 알파도 선택으로 살아남지 않는다.
    expect(traceAlphaContourRings(makeBitmap(16, 16, () => 40))).toEqual([]);
  });

  it("returns the whole canvas for a fully opaque layer", () => {
    const rings = traceAlphaContourRings(makeBitmap(16, 16, () => SOLID));
    expect(rings).toHaveLength(1);
    expect(rings[0]!.points).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]);
    expect(rings[0]!.signedArea).toBeCloseTo(1, 10);
  });

  it("rejects malformed bitmaps", () => {
    expect(traceAlphaContourRings({ width: 8, height: 8, alpha: new Uint8ClampedArray(9) })).toEqual([]);
    expect(traceAlphaContourRings({ width: 0, height: 8, alpha: new Uint8ClampedArray(0) })).toEqual([]);
  });

  it("mirrors rings for flipped elements without breaking winding", () => {
    const bitmap = makeBitmap(32, 32, (x, y) => (inBox(x, y, 0, 8, 7, 23) ? SOLID : 0));
    const normal = traceAlphaContourRings(bitmap);
    const flipped = traceAlphaContourRings(bitmap, { flipX: true });
    expect(Math.min(...normal[0]!.points.map((p) => p.x))).toBeCloseTo(0, 10);
    expect(Math.max(...flipped[0]!.points.map((p) => p.x))).toBeCloseTo(1, 10);
    expect(Math.min(...flipped[0]!.points.map((p) => p.x))).toBeCloseTo(0.75, 10);
    // 반전은 방향을 뒤집지만 규범화가 다시 바로잡는다.
    expect(flipped[0]!.signedArea).toBeGreaterThan(0);
  });

  it("is deterministic across repeated runs", () => {
    const bitmap = makeBitmap(48, 48, (x, y) => ((x * x + y * y) % 97 < 40 ? SOLID : 0));
    expect(traceAlphaContourRings(bitmap)).toEqual(traceAlphaContourRings(bitmap));
  });
});

describe("simplification budget", () => {
  /** 반지름 r 의 원 — 계단 경계가 길어 단순화 없이는 점이 폭발한다. */
  function disc(size: number): AlphaBitmap {
    const c = size / 2;
    const r = size * 0.45;
    return makeBitmap(size, size, (x, y) => ((x - c) ** 2 + (y - c) ** 2 <= r * r ? SOLID : 0));
  }

  it("keeps a downsampled 1200px disc far under the per-ring cap", () => {
    const selection = layerAlphaToPixelSelection(disc(1200));
    expect(selection).not.toBeNull();
    const points = selection!.subpaths[0]!.points;
    expect(points.length).toBeLessThanOrEqual(LAYER_ALPHA_MAX_POINTS_PER_RING);
    // 실루엣은 남는다 — 원 중심은 선택 안, 모서리는 밖.
    expect(pointInSelection(selection, { x: 0.5, y: 0.5 })).toBe(true);
    expect(pointInSelection(selection, { x: 0.02, y: 0.02 })).toBe(false);
  });

  it("RDP shrinks the ring further than the tracer's own dedup, monotonically in tolerance", () => {
    const bitmap = downsampleAlphaBitmap(disc(1200), LAYER_ALPHA_TRACE_MAX_DIM);
    const raw = traceAlphaContourRings(bitmap, { simplifyToleranceTexels: 0 });
    const fine = traceAlphaContourRings(bitmap);
    const coarse = traceAlphaContourRings(bitmap, { simplifyToleranceTexels: 3 });
    expect(raw[0]!.points.length).toBeGreaterThan(200);
    expect(fine[0]!.points.length).toBeLessThan(raw[0]!.points.length * 0.6);
    expect(coarse[0]!.points.length).toBeLessThan(fine[0]!.points.length);
    // 오차 한계가 보장되는 단순화라 면적(실루엣)은 거의 그대로다.
    const area = (rings: ReturnType<typeof traceAlphaContourRings>): number => rings[0]!.signedArea;
    expect(area(fine)).toBeCloseTo(area(raw), 3);
    expect(Math.abs(area(coarse) - area(raw)) / area(raw)).toBeLessThan(0.02);
  });

  it("escalates tolerance until the hard per-ring cap is met", () => {
    const bitmap = downsampleAlphaBitmap(disc(1200), LAYER_ALPHA_TRACE_MAX_DIM);
    const tiny = traceAlphaContourRings(bitmap, { maxPointsPerRing: 12 });
    expect(tiny[0]!.points.length).toBeLessThanOrEqual(12);
    expect(tiny[0]!.points.length).toBeGreaterThanOrEqual(3);
    expect(tiny[0]!.signedArea).toBeGreaterThan(0);
  });

  it("caps the trace resolution so huge layers stay bounded", () => {
    const scaled = downsampleAlphaBitmap(makeBitmap(1600, 800, () => SOLID), LAYER_ALPHA_TRACE_MAX_DIM);
    expect(scaled.width).toBe(LAYER_ALPHA_TRACE_MAX_DIM);
    expect(scaled.height).toBe(LAYER_ALPHA_TRACE_MAX_DIM / 2);
  });
});

describe("alphaRingsToPixelSelection", () => {
  it("maps outer rings to add and holes to subtract subpaths", () => {
    const bitmap = makeBitmap(32, 32, (x, y) =>
      inBox(x, y, 4, 4, 27, 27) && !inBox(x, y, 12, 12, 19, 19) ? SOLID : 0
    );
    const selection = alphaRingsToPixelSelection(traceAlphaContourRings(bitmap))!;
    expect(selection.subpaths.map((sp) => sp.mode)).toEqual(["add", "subtract"]);
    expect(selection.invert).toBe(false);
    expect(pointInSelection(selection, { x: 0.5, y: 0.5 })).toBe(false); // 구멍 안
    expect(pointInSelection(selection, { x: 0.25, y: 0.5 })).toBe(true); // 도넛 살
    expect(pointInSelection(selection, { x: 0.02, y: 0.02 })).toBe(false); // 바깥
  });

  it("keeps an island floating inside a hole selected (enclosing-first ordering)", () => {
    const bitmap = makeBitmap(48, 48, (x, y) => {
      if (inBox(x, y, 18, 18, 29, 29)) return SOLID; // 구멍 안의 섬
      if (inBox(x, y, 12, 12, 35, 35)) return 0; // 구멍
      if (inBox(x, y, 4, 4, 43, 43)) return SOLID; // 바깥 도넛
      return 0;
    });
    const rings = traceAlphaContourRings(bitmap);
    expect(rings.map((r) => r.kind)).toEqual(["outer", "hole", "outer"]);
    const selection = alphaRingsToPixelSelection(rings)!;
    expect(pointInSelection(selection, { x: 0.5, y: 0.5 })).toBe(true); // 섬
    expect(pointInSelection(selection, { x: 0.31, y: 0.5 })).toBe(false); // 구멍
    expect(pointInSelection(selection, { x: 0.15, y: 0.5 })).toBe(true); // 도넛 살
  });

  it("returns null when nothing survives", () => {
    expect(alphaRingsToPixelSelection([])).toBeNull();
  });

  it("supports adding to and subtracting from an existing selection", () => {
    const bitmap = makeBitmap(32, 32, (x, y) => (inBox(x, y, 8, 8, 23, 23) ? SOLID : 0));
    const rings = traceAlphaContourRings(bitmap);
    const base: PixelSelection = {
      ...emptyPixelSelection(),
      subpaths: [{ mode: "add", points: rectSelectionPolygon({ x: 0, y: 0 }, { x: 0.4, y: 0.4 }) }],
    };
    const added = alphaRingsToPixelSelection(rings, { base, mode: "add" })!;
    expect(added.subpaths).toHaveLength(2);
    expect(pointInSelection(added, { x: 0.1, y: 0.1 })).toBe(true);
    expect(pointInSelection(added, { x: 0.7, y: 0.7 })).toBe(true);

    const subtracted = alphaRingsToPixelSelection(rings, { base, mode: "subtract" })!;
    expect(subtracted.subpaths.map((sp) => sp.mode)).toEqual(["add", "subtract"]);
    expect(pointInSelection(subtracted, { x: 0.3, y: 0.3 })).toBe(false); // 겹친 부분이 빠졌다
    expect(pointInSelection(subtracted, { x: 0.1, y: 0.1 })).toBe(true);
  });

  it("clamps an explicit feather and otherwise keeps the base value", () => {
    const bitmap = makeBitmap(32, 32, (x, y) => (inBox(x, y, 8, 8, 23, 23) ? SOLID : 0));
    const rings = traceAlphaContourRings(bitmap);
    expect(alphaRingsToPixelSelection(rings, { featherPx: 6 })!.featherPx).toBe(6);
    expect(alphaRingsToPixelSelection(rings, { featherPx: 9999 })!.featherPx).toBe(60);
    expect(
      alphaRingsToPixelSelection(rings, {
        base: { ...emptyPixelSelection(), featherPx: 12 },
      })!.featherPx
    ).toBe(12);
  });
});

describe("layerAlphaToPixelSelection", () => {
  it("is a usable selection for a solid layer and null for an empty one", () => {
    const solid = layerAlphaToPixelSelection(makeBitmap(64, 64, () => SOLID));
    expect(isSelectionUsable(solid)).toBe(true);
    expect(pointInSelection(solid, { x: 0.5, y: 0.5 })).toBe(true);
    expect(layerAlphaToPixelSelection(makeBitmap(64, 64, () => 0))).toBeNull();
  });

  it("rejects malformed bitmaps", () => {
    expect(
      layerAlphaToPixelSelection({ width: 8, height: 8, alpha: new Uint8ClampedArray(3) })
    ).toBeNull();
  });

  it("is deterministic", () => {
    const bitmap = makeBitmap(200, 140, (x, y) => (((x / 9) | 0) % 2 === (((y / 7) | 0) % 2) ? SOLID : 0));
    expect(layerAlphaToPixelSelection(bitmap)).toEqual(layerAlphaToPixelSelection(bitmap));
  });
});
