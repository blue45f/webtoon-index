import { describe, expect, it } from "vitest";

import {
  COLOR_RANGE_FUZZINESS_RANGE,
  COLOR_RANGE_REGION_THRESHOLD,
  applyColorRangeMaskToSelection,
  applyColorRangeRegionsToSelection,
  buildColorRangeMask,
  colorRangeMaskHasMatches,
  colorRangeMaskRegions,
  colorRangeSampleDistance,
  flipColorRangeMask,
  sanitizeColorRangeSamples,
  type ColorRangeSample,
} from "./studio-color-range";
import {
  addSelectionSubpath,
  pointInSelection,
  rectSelectionPolygon,
  type PixelSelection,
} from "./studio-selection-tools";

// ---------------------------------------------------------------------------
// 테스트 픽스처 — studio-magic-wand.test.ts 의 imageDataFromGrid 관례를 따른다.
// ---------------------------------------------------------------------------

/** RGBA 버퍼를 문자 그리드에서 만든다(문자 → colors 매핑, 미등록 문자는 투명 검정). */
function imageDataFromGrid(
  rows: string[],
  colors: Record<string, [number, number, number, number]>,
): { data: Uint8ClampedArray; w: number; h: number } {
  const h = rows.length;
  const w = rows[0]!.length;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = colors[rows[y]![x]!] ?? [0, 0, 0, 0];
      const idx = (y * w + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }
  return { data, w, h };
}

/** 단색 1×1 이미지의 마스크 알파 한 값 — 커버리지 커브 검증용. */
function alphaOfColor(
  color: [number, number, number, number],
  samples: ColorRangeSample[],
  fuzziness: number,
  antiAlias = true,
): number {
  const data = new Uint8ClampedArray([...color]);
  return buildColorRangeMask(data, 1, 1, samples, fuzziness, { antiAlias }).alpha[0]!;
}

const RED: ColorRangeSample = { r: 220, g: 40, b: 40 };
const BLUE: ColorRangeSample = { r: 40, g: 60, b: 220 };

// ---------------------------------------------------------------------------
// buildColorRangeMask — 커버리지 커브
// ---------------------------------------------------------------------------

describe("buildColorRangeMask", () => {
  it("selects exact-color pixels fully and leaves distant colors unselected", () => {
    const { data, w, h } = imageDataFromGrid(
      ["RRBB", "RRBB"],
      { R: [220, 40, 40, 255], B: [40, 60, 220, 255] },
    );
    const mask = buildColorRangeMask(data, w, h, [RED], 40);
    expect(mask.alpha[0]).toBe(255); // 정확히 일치 → 완전 선택
    expect(mask.alpha[2]).toBe(0); // 먼 색 → 미선택
    expect(mask.width).toBe(4);
    expect(mask.height).toBe(2);
  });

  it("fuzziness 0 keeps only exact matches (no soft band)", () => {
    expect(alphaOfColor([220, 40, 40, 255], [RED], 0)).toBe(255);
    expect(alphaOfColor([221, 40, 40, 255], [RED], 0)).toBe(0); // 1 채널 차이도 제외
  });

  it("applies the Photoshop soft edge: full within f/2, linear falloff to f", () => {
    const f = 120;
    // 거리를 실제 척도로 계산해 밴드 안/밖 색을 고른다(하드코딩된 근사값 금지).
    const near: [number, number, number, number] = [200, 40, 40, 255];
    const mid: [number, number, number, number] = [120, 90, 40, 255];
    const dNear = colorRangeSampleDistance(near[0], near[1], near[2], RED);
    const dMid = colorRangeSampleDistance(mid[0], mid[1], mid[2], RED);
    expect(dNear).toBeLessThanOrEqual(f / 2); // 픽스처 자체 검증
    expect(dMid).toBeGreaterThan(f / 2);
    expect(dMid).toBeLessThan(f);

    expect(alphaOfColor(near, [RED], f)).toBe(255);
    const soft = alphaOfColor(mid, [RED], f);
    expect(soft).toBeGreaterThan(0);
    expect(soft).toBeLessThan(255);
    expect(soft).toBe(Math.round(((f - dMid) / (f / 2)) * 255)); // 선형 감쇠 수식 그대로
  });

  it("widens coverage monotonically as fuzziness grows", () => {
    const probe: [number, number, number, number] = [160, 80, 60, 255];
    let prev = 0;
    for (
      let f = COLOR_RANGE_FUZZINESS_RANGE.min;
      f <= COLOR_RANGE_FUZZINESS_RANGE.max;
      f += 20
    ) {
      const cur = alphaOfColor(probe, [RED], f);
      expect(cur).toBeGreaterThanOrEqual(prev);
      prev = cur;
    }
  });

  it("unions multiple samples via the nearest sample (max coverage)", () => {
    const { data, w, h } = imageDataFromGrid(
      ["RB"],
      { R: [220, 40, 40, 255], B: [40, 60, 220, 255] },
    );
    const both = buildColorRangeMask(data, w, h, [RED, BLUE], 30);
    expect(both.alpha[0]).toBe(255);
    expect(both.alpha[1]).toBe(255);
    const redOnly = buildColorRangeMask(data, w, h, [RED], 30);
    expect(redOnly.alpha[1]).toBe(0);
  });

  it("returns an all-zero mask for empty samples", () => {
    const { data, w, h } = imageDataFromGrid(["RR"], { R: [220, 40, 40, 255] });
    const mask = buildColorRangeMask(data, w, h, [], 200);
    expect(Array.from(mask.alpha)).toEqual([0, 0]);
    expect(colorRangeMaskHasMatches(mask)).toBe(false);
  });

  it("never selects fully transparent pixels and scales semi-transparent ones", () => {
    const { data, w, h } = imageDataFromGrid(
      ["RT H"],
      { R: [220, 40, 40, 255], T: [220, 40, 40, 0], H: [220, 40, 40, 128] },
    );
    const mask = buildColorRangeMask(data, w, h, [RED], 40);
    expect(mask.alpha[0]).toBe(255);
    expect(mask.alpha[1]).toBe(0); // 완전 투명 — RGB 일치라도 제외
    expect(mask.alpha[2]).toBe(0); // 미등록 문자(공백) = 투명
    expect(mask.alpha[3]).toBe(Math.round(255 * (128 / 255))); // 반투명 → 비례 감쇠
  });

  it("antiAlias:false produces a hard binary mask thresholded at 50% coverage", () => {
    const f = 120;
    const mid: [number, number, number, number] = [120, 90, 40, 255]; // 소프트 밴드 안(위 테스트에서 검증)
    const soft = alphaOfColor(mid, [RED], f, true);
    const hard = alphaOfColor(mid, [RED], f, false);
    expect([0, 255]).toContain(hard);
    expect(hard).toBe(soft >= 128 ? 255 : 0);
    expect(alphaOfColor([220, 40, 40, 255], [RED], f, false)).toBe(255);
  });

  it("is deterministic — identical inputs give identical masks", () => {
    const { data, w, h } = imageDataFromGrid(
      ["RBRB", "BRBR", "RBRB"],
      { R: [220, 40, 40, 255], B: [40, 60, 220, 255] },
    );
    const a = buildColorRangeMask(data, w, h, [RED, BLUE], 55);
    const b = buildColorRangeMask(data, w, h, [RED, BLUE], 55);
    expect(Array.from(a.alpha)).toEqual(Array.from(b.alpha));
  });

  it("sanitizes broken samples instead of throwing", () => {
    const cleaned = sanitizeColorRangeSamples([{ r: Number.NaN, g: -20, b: 999 }]);
    expect(cleaned).toEqual([{ r: 0, g: 0, b: 255 }]);
  });
});

// ---------------------------------------------------------------------------
// flipColorRangeMask
// ---------------------------------------------------------------------------

describe("flipColorRangeMask", () => {
  it("mirrors columns/rows and is identity when both flags are false", () => {
    const mask = { width: 2, height: 2, alpha: new Uint8ClampedArray([10, 20, 30, 40]) };
    expect(flipColorRangeMask(mask, false, false)).toBe(mask);
    expect(Array.from(flipColorRangeMask(mask, true, false).alpha)).toEqual([20, 10, 40, 30]);
    expect(Array.from(flipColorRangeMask(mask, false, true).alpha)).toEqual([30, 40, 10, 20]);
    expect(Array.from(flipColorRangeMask(mask, true, true).alpha)).toEqual([40, 30, 20, 10]);
  });
});

// ---------------------------------------------------------------------------
// colorRangeMaskRegions — 비연속 region 추적(마술봉 추적기 재사용)
// ---------------------------------------------------------------------------

/** 8×8, 서로 떨어진 2×2 블록 두 개(R) — 비연속 선택의 최소 픽스처. */
function twoBlocksMask() {
  const { data, w, h } = imageDataFromGrid(
    [
      "........",
      ".RR..RR.",
      ".RR..RR.",
      "........",
      "........",
      "........",
      "........",
      "........",
    ],
    { R: [220, 40, 40, 255], ".": [255, 255, 255, 255] },
  );
  return buildColorRangeMask(data, w, h, [RED], 40);
}

describe("colorRangeMaskRegions", () => {
  it("traces disconnected matches as separate regions (non-contiguous selection)", () => {
    const regions = colorRangeMaskRegions(twoBlocksMask());
    expect(regions).toHaveLength(2);
    for (const region of regions) {
      expect(region.outer.length).toBeGreaterThanOrEqual(3);
      expect(region.holes).toEqual([]);
      for (const p of region.outer) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(1);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(1);
      }
    }
    // 두 블록의 bbox 가 각각 좌/우에 있어야 한다(crop → 전체 좌표 재사상 검증).
    const xs = regions.map((r) => Math.min(...r.outer.map((p) => p.x)));
    expect(Math.min(...xs)).toBeCloseTo(1 / 8, 5);
    expect(Math.max(...xs)).toBeCloseTo(5 / 8, 5);
  });

  it("caps the number of regions by area-descending order", () => {
    const regions = colorRangeMaskRegions(twoBlocksMask(), { maxRegions: 1 });
    expect(regions).toHaveLength(1);
  });

  it("is deterministic across runs", () => {
    const a = colorRangeMaskRegions(twoBlocksMask());
    const b = colorRangeMaskRegions(twoBlocksMask());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("returns no regions for an empty mask", () => {
    const mask = { width: 4, height: 4, alpha: new Uint8ClampedArray(16) };
    expect(colorRangeMaskRegions(mask)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// applyColorRangeMaskToSelection — add/subtract/intersect 결합
// ---------------------------------------------------------------------------

const LEFT_BLOCK_CENTER = { x: 2 / 8, y: 1.5 / 8 };
const RIGHT_BLOCK_CENTER = { x: 6 / 8, y: 1.5 / 8 };
const OUTSIDE = { x: 0.5, y: 0.75 };

describe("applyColorRangeMaskToSelection", () => {
  it("add: builds a non-contiguous selection covering both matched blocks", () => {
    const sel = applyColorRangeMaskToSelection(null, twoBlocksMask(), "add");
    expect(sel).not.toBeNull();
    expect(sel!.subpaths.length).toBe(2);
    expect(pointInSelection(sel, LEFT_BLOCK_CENTER)).toBe(true);
    expect(pointInSelection(sel, RIGHT_BLOCK_CENTER)).toBe(true);
    expect(pointInSelection(sel, OUTSIDE)).toBe(false);
  });

  it("add: leaves the selection unchanged when nothing matches", () => {
    const empty = { width: 4, height: 4, alpha: new Uint8ClampedArray(16) };
    expect(applyColorRangeMaskToSelection(null, empty, "add")).toBeNull();
    const existing = addSelectionSubpath(null, "add", rectSelectionPolygon({ x: 0, y: 0 }, { x: 1, y: 1 }));
    expect(applyColorRangeMaskToSelection(existing, empty, "add")).toBe(existing);
  });

  it("subtract: punches the matched blocks out of an existing full selection", () => {
    const full = addSelectionSubpath(null, "add", rectSelectionPolygon({ x: 0, y: 0 }, { x: 1, y: 1 }));
    const sel = applyColorRangeMaskToSelection(full, twoBlocksMask(), "subtract");
    expect(sel).not.toBeNull();
    expect(pointInSelection(sel, LEFT_BLOCK_CENTER)).toBe(false);
    expect(pointInSelection(sel, RIGHT_BLOCK_CENTER)).toBe(false);
    expect(pointInSelection(sel, OUTSIDE)).toBe(true);
  });

  it("intersect: keeps only matches inside the existing selection and preserves feather", () => {
    const leftHalf: PixelSelection = {
      ...addSelectionSubpath(null, "add", rectSelectionPolygon({ x: 0, y: 0 }, { x: 0.5, y: 1 }))!,
      featherPx: 7,
    };
    const sel = applyColorRangeMaskToSelection(leftHalf, twoBlocksMask(), "intersect");
    expect(sel).not.toBeNull();
    expect(sel!.featherPx).toBe(7); // 기존 페더 유지
    expect(sel!.invert).toBe(false);
    expect(pointInSelection(sel, LEFT_BLOCK_CENTER)).toBe(true);
    expect(pointInSelection(sel, RIGHT_BLOCK_CENTER)).toBe(false); // 기존 선택 밖 매치는 탈락
    expect(pointInSelection(sel, OUTSIDE)).toBe(false);
  });

  it("intersect: returns null when there is no usable existing selection", () => {
    expect(applyColorRangeMaskToSelection(null, twoBlocksMask(), "intersect")).toBeNull();
  });

  it("intersect: returns null when matches and selection do not overlap", () => {
    const bottom = addSelectionSubpath(null, "add", rectSelectionPolygon({ x: 0, y: 0.6 }, { x: 1, y: 1 }));
    expect(applyColorRangeMaskToSelection(bottom, twoBlocksMask(), "intersect")).toBeNull();
  });

  it("threshold is honored when folding the soft mask into regions", () => {
    // 소프트 밴드 값(255 미만)만 있는 마스크 — 기본 문턱(128)보다 낮으면 region 이 없어야 한다.
    const soft = { width: 4, height: 4, alpha: new Uint8ClampedArray(16).fill(100) };
    expect(colorRangeMaskRegions(soft)).toEqual([]);
    expect(colorRangeMaskRegions(soft, { threshold: 90 }).length).toBe(1);
    expect(colorRangeMaskHasMatches(soft)).toBe(false);
    expect(colorRangeMaskHasMatches(soft, 90)).toBe(true);
    expect(soft.alpha[0]).toBeLessThan(COLOR_RANGE_REGION_THRESHOLD);
  });

  it("applyColorRangeRegionsToSelection folds sequentially and stays deterministic", () => {
    const regions = colorRangeMaskRegions(twoBlocksMask());
    const a = applyColorRangeRegionsToSelection(null, regions, "add");
    const b = applyColorRangeRegionsToSelection(null, regions, "add");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a!.subpaths.every((sp) => sp.mode === "add")).toBe(true);
  });
});
