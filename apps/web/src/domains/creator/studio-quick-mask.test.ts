import { describe, expect, it } from "vitest";

import {
  applyMaskDab,
  applyMaskStrokeDabs,
  buildQuickMaskTintPixels,
  estimateQuickMaskFeatherDevicePx,
  featherQuickMaskAlpha,
  invertMask,
  maskToSelection,
  quickMaskRasterSize,
  quickMaskStrokePreviewColor,
  selectionToMask,
  QUICK_MASK_MAX_DIM,
  type QuickMaskDab,
} from "./studio-quick-mask";
import {
  emptyPixelSelection,
  pointInSelection,
  rectSelectionPolygon,
  selectionBoundsNorm,
  type PixelSelection,
} from "./studio-selection-tools";

const W = 64;
const H = 64;

/** 정규화 사각 선택(0..1 코너) 헬퍼 — rectSelectionPolygon 재사용. */
function rectSelection(x1: number, y1: number, x2: number, y2: number, featherPx = 0): PixelSelection {
  return {
    ...emptyPixelSelection(),
    featherPx,
    subpaths: [{ mode: "add", points: rectSelectionPolygon({ x: x1, y: y1 }, { x: x2, y: y2 }) }],
  };
}

function paintDab(overrides: Partial<QuickMaskDab> = {}): QuickMaskDab {
  return { x: 32, y: 32, radius: 10, hardness: 0.5, opacity: 1, mode: "paint", ...overrides };
}

function countBinaryMismatch(a: Uint8ClampedArray, b: Uint8ClampedArray, threshold = 128): number {
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i]! >= threshold !== b[i]! >= threshold) mismatch++;
  }
  return mismatch;
}

describe("quickMaskRasterSize", () => {
  it("caps the long side at QUICK_MASK_MAX_DIM preserving aspect", () => {
    expect(quickMaskRasterSize(4000, 2000)).toEqual({ width: QUICK_MASK_MAX_DIM, height: QUICK_MASK_MAX_DIM / 2 });
    expect(quickMaskRasterSize(100, 50)).toEqual({ width: 100, height: 50 });
  });

  it("survives degenerate inputs", () => {
    expect(quickMaskRasterSize(Number.NaN, -3)).toEqual({ width: 1, height: 1 });
  });
});

describe("selectionToMask", () => {
  it("returns an all-zero mask for null/unusable selections and empty for bad dims", () => {
    const empty = selectionToMask(null, W, H);
    expect(empty.length).toBe(W * H);
    expect(empty.every((v) => v === 0)).toBe(true);
    expect(selectionToMask(rectSelection(0.2, 0.2, 0.8, 0.8), Number.NaN, H).length).toBe(0);
  });

  it("rasterizes a hard rect selection exactly at pixel centers", () => {
    const mask = selectionToMask(rectSelection(0.25, 0.25, 0.75, 0.75), W, H);
    let selected = 0;
    for (const v of mask) {
      expect(v === 0 || v === 255).toBe(true);
      if (v === 255) selected++;
    }
    // 픽셀 중심 (px+0.5)/64 ∈ [0.25, 0.75] ⇔ px ∈ 16..47 — 정확히 32×32.
    expect(selected).toBe(32 * 32);
    expect(mask[32 * W + 32]).toBe(255);
    expect(mask[4 * W + 4]).toBe(0);
  });

  it("rasterizes the inverted full selection as all 255", () => {
    const all = selectionToMask({ subpaths: [], featherPx: 0, invert: true }, 16, 16);
    expect(all.every((v) => v === 255)).toBe(true);
  });

  it("honors subtract subpaths with last-covering-subpath semantics", () => {
    const donut: PixelSelection = {
      featherPx: 0,
      invert: false,
      subpaths: [
        { mode: "add", points: rectSelectionPolygon({ x: 0.125, y: 0.125 }, { x: 0.875, y: 0.875 }) },
        { mode: "subtract", points: rectSelectionPolygon({ x: 0.375, y: 0.375 }, { x: 0.625, y: 0.625 }) },
      ],
    };
    const mask = selectionToMask(donut, W, H);
    expect(mask[32 * W + 32]).toBe(0); // 구멍 속
    expect(mask[32 * W + 12]).toBe(255); // 링 위
    expect(mask[2 * W + 2]).toBe(0); // 바깥
  });

  it("flips sample coordinates when flipX is requested", () => {
    const off = rectSelection(0, 0.25, 0.25, 0.75); // 왼쪽 1/4 밴드
    const flipped = selectionToMask(off, W, H, { flipX: true });
    expect(flipped[32 * W + (W - 4)]).toBe(255); // 오른쪽으로 이동
    expect(flipped[32 * W + 4]).toBe(0);
  });

  it("feathers edges into a monotone soft band while keeping the far interior solid", () => {
    const mask = selectionToMask(rectSelection(0.25, 0.25, 0.75, 0.75, 6), W, H);
    expect(mask[32 * W + 32]).toBe(255); // 중심(경계에서 16px)은 그대로
    const nearEdge = mask[32 * W + 16]!; // 경계 바로 안쪽
    expect(nearEdge).toBeGreaterThan(0);
    expect(nearEdge).toBeLessThan(255);
    // 중심→바깥으로 단조 감소(박스블러 스텝 응답).
    const row = 32;
    for (let x = 32; x > 0; x--) {
      expect(mask[row * W + x - 1]!).toBeLessThanOrEqual(mask[row * W + x]!);
    }
  });
});

describe("featherQuickMaskAlpha / estimateQuickMaskFeatherDevicePx", () => {
  it("estimates zero feather for a hard mask and a matching band for a soft one", () => {
    const hard = selectionToMask(rectSelection(0.25, 0.25, 0.75, 0.75), W, H);
    expect(estimateQuickMaskFeatherDevicePx(hard, W, H)).toBe(0);

    const soft = hard.slice();
    featherQuickMaskAlpha(soft, W, H, 8);
    const estimated = estimateQuickMaskFeatherDevicePx(soft, W, H);
    expect(estimated).toBeGreaterThanOrEqual(4);
    expect(estimated).toBeLessThanOrEqual(14);
  });

  it("is a no-op for zero feather and mismatched buffers", () => {
    const mask = selectionToMask(rectSelection(0.25, 0.25, 0.75, 0.75), W, H);
    const before = mask.slice();
    featherQuickMaskAlpha(mask, W, H, 0);
    expect(mask).toEqual(before);
    const wrong = new Uint8ClampedArray(3);
    featherQuickMaskAlpha(wrong, W, H, 5);
    expect([...wrong]).toEqual([0, 0, 0]);
  });
});

describe("applyMaskDab", () => {
  it("paints a soft dab with full center and monotone radial falloff", () => {
    const mask = new Uint8ClampedArray(W * H);
    const dirty = applyMaskDab(mask, W, H, paintDab());
    expect(dirty).toEqual({ x0: 22, y0: 22, x1: 42, y1: 42 });
    expect(mask[32 * W + 32]).toBe(255);
    expect(mask[32 * W + 44]).toBe(0); // 반경 밖
    for (let x = 32; x < 42; x++) {
      expect(mask[32 * W + x + 1]!).toBeLessThanOrEqual(mask[32 * W + x]!);
    }
    // 안쪽 하드 코어(반경×경도=5)는 완전 불투명.
    expect(mask[32 * W + 35]).toBe(255);
  });

  it("accumulates partial opacity toward 255 without overshooting", () => {
    const mask = new Uint8ClampedArray(W * H);
    applyMaskDab(mask, W, H, paintDab({ opacity: 0.5 }));
    const once = mask[32 * W + 32]!;
    expect(once).toBeGreaterThan(120);
    expect(once).toBeLessThan(135);
    applyMaskDab(mask, W, H, paintDab({ opacity: 0.5 }));
    const twice = mask[32 * W + 32]!;
    expect(twice).toBeGreaterThan(once);
    expect(twice).toBeLessThan(255);
  });

  it("erases toward zero with the mirrored falloff", () => {
    const mask = new Uint8ClampedArray(W * H).fill(255);
    applyMaskDab(mask, W, H, paintDab({ mode: "erase" }));
    expect(mask[32 * W + 32]).toBe(0);
    expect(mask[32 * W + 44]).toBe(255);
  });

  it("is bounds-safe: off-canvas and oversized dabs never touch invalid memory", () => {
    const mask = new Uint8ClampedArray(W * H);
    expect(applyMaskDab(mask, W, H, paintDab({ x: -50, y: -50 }))).toBeNull();
    expect(mask.every((v) => v === 0)).toBe(true);

    const clipped = applyMaskDab(mask, W, H, paintDab({ x: 0, y: 0, radius: 8 }));
    expect(clipped).toEqual({ x0: 0, y0: 0, x1: 8, y1: 8 });

    const huge = new Uint8ClampedArray(W * H);
    const rect = applyMaskDab(huge, W, H, paintDab({ radius: 10_000, hardness: 1 }));
    expect(rect).toEqual({ x0: 0, y0: 0, x1: W - 1, y1: H - 1 });
    expect(huge.every((v) => v === 255)).toBe(true);
  });

  it("rejects degenerate dabs (NaN center, zero radius/opacity, wrong buffer)", () => {
    const mask = new Uint8ClampedArray(W * H);
    expect(applyMaskDab(mask, W, H, paintDab({ x: Number.NaN }))).toBeNull();
    expect(applyMaskDab(mask, W, H, paintDab({ radius: 0 }))).toBeNull();
    expect(applyMaskDab(mask, W, H, paintDab({ opacity: 0 }))).toBeNull();
    expect(applyMaskDab(new Uint8ClampedArray(3), W, H, paintDab())).toBeNull();
    expect(mask.every((v) => v === 0)).toBe(true);
  });

  it("is deterministic — identical inputs yield identical buffers", () => {
    const a = new Uint8ClampedArray(W * H);
    const b = new Uint8ClampedArray(W * H);
    for (const buf of [a, b]) {
      applyMaskDab(buf, W, H, paintDab({ hardness: 0.3, opacity: 0.7 }));
      applyMaskDab(buf, W, H, paintDab({ x: 40.25, y: 27.5, mode: "erase", opacity: 0.4 }));
    }
    expect(a).toEqual(b);
  });
});

describe("applyMaskStrokeDabs", () => {
  it("stamps evenly along the polyline independent of point density", () => {
    const sparse = new Uint8ClampedArray(W * H);
    const dense = new Uint8ClampedArray(W * H);
    const opts = { radius: 6, hardness: 1, opacity: 1, mode: "paint" as const };
    applyMaskStrokeDabs(sparse, W, H, [{ x: 10, y: 32 }, { x: 54, y: 32 }], opts);
    const densePoints = Array.from({ length: 45 }, (_, i) => ({ x: 10 + i, y: 32 }));
    applyMaskStrokeDabs(dense, W, H, densePoints, opts);
    // 경도 1 + 완전 불투명이면 중간 지점 밀도와 무관하게 같은 띠를 덮는다.
    expect(sparse).toEqual(dense);
    for (let x = 12; x <= 52; x++) expect(sparse[32 * W + x]).toBe(255);
    expect(sparse[10 * W + 32]).toBe(0);
  });

  it("returns a merged dirty rect and null for degenerate strokes", () => {
    const mask = new Uint8ClampedArray(W * H);
    const dirty = applyMaskStrokeDabs(mask, W, H, [{ x: 10, y: 10 }, { x: 50, y: 50 }], {
      radius: 4,
      hardness: 1,
      opacity: 1,
      mode: "paint",
    });
    expect(dirty).toEqual({ x0: 6, y0: 6, x1: 54, y1: 54 });
    expect(applyMaskStrokeDabs(mask, W, H, [], { radius: 4, hardness: 1, opacity: 1, mode: "paint" })).toBeNull();
    expect(applyMaskStrokeDabs(mask, W, H, [{ x: 1, y: 1 }], { radius: 0, hardness: 1, opacity: 1, mode: "paint" })).toBeNull();
  });
});

describe("invertMask", () => {
  it("is an involution mapping 0↔255", () => {
    const mask = selectionToMask(rectSelection(0.25, 0.25, 0.75, 0.75, 4), W, H);
    const inverted = invertMask(mask);
    expect(inverted[32 * W + 32]).toBe(0);
    expect(inverted[2 * W + 2]).toBe(255);
    expect(invertMask(inverted)).toEqual(mask);
  });
});

describe("maskToSelection", () => {
  it("returns null for empty masks and bad dimensions", () => {
    expect(maskToSelection(new Uint8ClampedArray(W * H), W, H)).toBeNull();
    expect(maskToSelection(new Uint8ClampedArray(3), W, H)).toBeNull();
    expect(maskToSelection(new Uint8ClampedArray(0), Number.NaN, H)).toBeNull();
  });

  it("recovers a usable full-frame selection from an all-255 mask", () => {
    const sel = maskToSelection(new Uint8ClampedArray(16 * 16).fill(255), 16, 16);
    expect(sel).not.toBeNull();
    expect(pointInSelection(sel, { x: 0.5, y: 0.5 })).toBe(true);
  });

  it("keeps disjoint blobs as separate add subpaths", () => {
    const mask = new Uint8ClampedArray(W * H);
    applyMaskDab(mask, W, H, paintDab({ x: 14, y: 14, radius: 7, hardness: 1 }));
    applyMaskDab(mask, W, H, paintDab({ x: 50, y: 50, radius: 7, hardness: 1 }));
    const sel = maskToSelection(mask, W, H);
    expect(sel).not.toBeNull();
    expect(sel!.subpaths.filter((sp) => sp.mode === "add")).toHaveLength(2);
    expect(pointInSelection(sel, { x: 14.5 / W, y: 14.5 / H })).toBe(true);
    expect(pointInSelection(sel, { x: 50.5 / W, y: 50.5 / H })).toBe(true);
    expect(pointInSelection(sel, { x: 0.5, y: 0.5 })).toBe(false);
  });

  it("preserves holes as subtract subpaths (donut)", () => {
    const mask = new Uint8ClampedArray(W * H);
    applyMaskDab(mask, W, H, paintDab({ x: 32, y: 32, radius: 20, hardness: 1 }));
    applyMaskDab(mask, W, H, paintDab({ x: 32, y: 32, radius: 8, hardness: 1, mode: "erase" }));
    const sel = maskToSelection(mask, W, H);
    expect(sel).not.toBeNull();
    expect(sel!.subpaths.some((sp) => sp.mode === "subtract")).toBe(true);
    expect(pointInSelection(sel, { x: 32.5 / W, y: 32.5 / H })).toBe(false); // 구멍
    expect(pointInSelection(sel, { x: 46.5 / W, y: 32.5 / H })).toBe(true); // 링
  });

  it("caps region count keeping the largest blobs deterministically", () => {
    const mask = new Uint8ClampedArray(W * H);
    applyMaskDab(mask, W, H, paintDab({ x: 12, y: 12, radius: 6, hardness: 1 }));
    applyMaskDab(mask, W, H, paintDab({ x: 52, y: 52, radius: 6, hardness: 1 }));
    applyMaskDab(mask, W, H, paintDab({ x: 12, y: 52, radius: 2, hardness: 1 }));
    applyMaskDab(mask, W, H, paintDab({ x: 52, y: 12, radius: 2, hardness: 1 }));
    const sel = maskToSelection(mask, W, H, { maxRegions: 2 });
    expect(sel).not.toBeNull();
    expect(sel!.subpaths.filter((sp) => sp.mode === "add")).toHaveLength(2);
    expect(pointInSelection(sel, { x: 12.5 / W, y: 12.5 / H })).toBe(true);
    expect(pointInSelection(sel, { x: 52.5 / W, y: 52.5 / H })).toBe(true);
    expect(pointInSelection(sel, { x: 12.5 / W, y: 52.5 / H })).toBe(false); // 작은 얼룩은 탈락
  });

  it("mirrors regions back into display space when flipX is set", () => {
    const mask = new Uint8ClampedArray(W * H);
    applyMaskDab(mask, W, H, paintDab({ x: 16, y: 32, radius: 8, hardness: 1 }));
    const sel = maskToSelection(mask, W, H, { flipX: true });
    const bounds = selectionBoundsNorm(sel);
    expect(bounds).not.toBeNull();
    const centerX = bounds!.x + bounds!.w / 2;
    expect(Math.abs(centerX - (1 - 16 / W))).toBeLessThan(0.05);
  });
});

describe("selection → mask → selection roundtrip", () => {
  it("preserves a hard rect selection with only boundary-level error", () => {
    const original = rectSelection(0.25, 0.25, 0.75, 0.75);
    const mask1 = selectionToMask(original, W, H);
    const roundtripped = maskToSelection(mask1, W, H);
    expect(roundtripped).not.toBeNull();
    expect(roundtripped!.featherPx).toBe(0);
    const mask2 = selectionToMask(roundtripped, W, H);
    // 오차는 경계 밴드(±1px) 안에만 허용 — 둘레 ≈ 4×32.
    expect(countBinaryMismatch(mask1, mask2)).toBeLessThanOrEqual(260);
    // 경계에서 2px 이상 떨어진 표본은 소속이 반드시 일치.
    for (const [x, y, inside] of [[32, 32, true], [20, 20, true], [10, 32, false], [32, 4, false], [60, 60, false]] as const) {
      const p = { x: (x + 0.5) / W, y: (y + 0.5) / H };
      expect(pointInSelection(original, p)).toBe(inside);
      expect(pointInSelection(roundtripped, p)).toBe(inside);
    }
  });

  it("preserves soft (feathered) edges as an equivalent global feather", () => {
    const original = rectSelection(0.25, 0.25, 0.75, 0.75, 6);
    const mask1 = selectionToMask(original, W, H);
    const roundtripped = maskToSelection(mask1, W, H);
    expect(roundtripped).not.toBeNull();
    expect(roundtripped!.featherPx).toBeGreaterThanOrEqual(3);
    expect(roundtripped!.featherPx).toBeLessThanOrEqual(12);
    const mask2 = selectionToMask(roundtripped, W, H);
    // 50% 등고선(이진 경계)은 페더와 무관하게 원래 사각 경계에 남는다.
    expect(countBinaryMismatch(mask1, mask2)).toBeLessThanOrEqual(300);
  });

  it("converts display-px feather through featherScale symmetrically", () => {
    const original = rectSelection(0.25, 0.25, 0.75, 0.75, 4);
    const mask = selectionToMask(original, W, H, { featherScale: 2 }); // 디바이스 8px 밴드
    const sel = maskToSelection(mask, W, H, { featherScale: 2 });
    expect(sel).not.toBeNull();
    expect(sel!.featherPx).toBeGreaterThanOrEqual(2);
    expect(sel!.featherPx).toBeLessThanOrEqual(7);
  });
});

describe("buildQuickMaskTintPixels", () => {
  it("tints the unselected area with PS red 50% by default", () => {
    const mask = new Uint8ClampedArray(4).fill(0);
    mask[3] = 255;
    const px = buildQuickMaskTintPixels(mask, 2, 2);
    expect([px[0], px[1], px[2], px[3]]).toEqual([255, 0, 0, 128]); // 비선택 → 덮음
    expect(px[3 * 4 + 3]).toBe(0); // 선택 → 투명
  });

  it("supports tintSelected, custom colors and shorthand hex with fallback", () => {
    const mask = new Uint8ClampedArray([0, 255]);
    const sel = buildQuickMaskTintPixels(mask, 2, 1, { color: "#00ff00", opacity: 1, tintSelected: true });
    expect([sel[4], sel[5], sel[6], sel[7]]).toEqual([0, 255, 0, 255]);
    expect(sel[3]).toBe(0);
    const short = buildQuickMaskTintPixels(mask, 2, 1, { color: "#abc" });
    expect([short[0], short[1], short[2]]).toEqual([170, 187, 204]);
    const fallback = buildQuickMaskTintPixels(mask, 2, 1, { color: "not-a-color" });
    expect([fallback[0], fallback[1], fallback[2]]).toEqual([255, 0, 0]);
    expect(buildQuickMaskTintPixels(mask, 3, 3).length).toBe(0); // 크기 불일치 방어
  });
});

describe("quickMaskStrokePreviewColor", () => {
  it("previews paint as white and erase as the clamped tint color", () => {
    expect(quickMaskStrokePreviewColor("paint", "#ff0000", 0.5)).toBe("rgba(255,255,255,0.55)");
    expect(quickMaskStrokePreviewColor("erase", "#3b82f6", 0.5)).toBe("rgba(59,130,246,0.5)");
    expect(quickMaskStrokePreviewColor("erase", "#3b82f6", 0.01)).toBe("rgba(59,130,246,0.15)");
    expect(quickMaskStrokePreviewColor("erase", "bogus", Number.NaN)).toBe("rgba(255,0,0,0.5)");
  });
});
