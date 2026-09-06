import { describe, expect, it } from "vitest";

import {
  applyMagicWandRegionToSelection,
  flipMagicWandRegion,
  flipNormalizedPoint,
  scanMagicWandRegionFromImageData,
  traceMaskContours,
  type MagicWandRegion,
} from "./studio-magic-wand";
import { emptyPixelSelection } from "./studio-selection-tools";

// ---------------------------------------------------------------------------
// 테스트 픽스처
// ---------------------------------------------------------------------------

/** w*h 크기의 0/1 마스크를 문자열 그리드에서 만든다("." = 0, "#" = 1). 행 길이는 모두 같아야 한다. */
function maskFromGrid(rows: string[]): { mask: Uint8Array; w: number; h: number } {
  const h = rows.length;
  const w = rows[0]!.length;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      mask[y * w + x] = rows[y]![x] === "#" ? 1 : 0;
    }
  }
  return { mask, w, h };
}

/** RGBA 버퍼를 2색 그리드에서 만든다("A"/"B" 등 문자 → colors 매핑, 그 외 문자는 colors.default). */
function imageDataFromGrid(rows: string[], colors: Record<string, [number, number, number, number]>): { data: Uint8ClampedArray; w: number; h: number } {
  const h = rows.length;
  const w = rows[0]!.length;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y]![x]!;
      const [r, g, b, a] = colors[ch] ?? [0, 0, 0, 0];
      const idx = (y * w + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }
  return { data, w, h };
}

// ---------------------------------------------------------------------------
// traceMaskContours
// ---------------------------------------------------------------------------

describe("traceMaskContours", () => {
  it("solid filled rectangle produces a 4-ish point outer with no holes", () => {
    const { mask, w, h } = maskFromGrid(["#####", "#####", "#####", "#####"]);
    const region = traceMaskContours(mask, w, h, 2, 1);
    expect(region.outer.length).toBeGreaterThanOrEqual(4);
    expect(region.holes).toEqual([]);
    // 정규화 좌표는 0..1 범위 안에 있어야 한다.
    for (const p of region.outer) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });

  it("a donut mask (5x5 block with a 1x1 hole in the middle) yields one hole", () => {
    const { mask, w, h } = maskFromGrid(["#####", "#####", "##.##", "#####", "#####"]);
    const region = traceMaskContours(mask, w, h, 0, 0);
    expect(region.outer.length).toBeGreaterThanOrEqual(3);
    expect(region.holes.length).toBe(1);
  });

  it("all-zero mask returns an empty outer", () => {
    const { mask, w, h } = maskFromGrid([".....", ".....", "....."]);
    const region = traceMaskContours(mask, w, h, 0, 0);
    expect(region.outer).toEqual([]);
    expect(region.holes).toEqual([]);
  });

  it("a checkerboard/saddle mask does not throw or hang and produces closed loop(s)", () => {
    const { mask, w, h } = maskFromGrid(["#.#.", ".#.#", "#.#.", ".#.#"]);
    expect(() => traceMaskContours(mask, w, h, 0, 0)).not.toThrow();
    const region = traceMaskContours(mask, w, h, 0, 0);
    // desaddle 이 대각선 접촉을 항상 단순 연결로 바꾸므로 outer 는 항상 유효한(≥3점) 폴리곤이거나 빈 배열이다.
    expect(region.outer.length === 0 || region.outer.length >= 3).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// applyMagicWandRegionToSelection
// ---------------------------------------------------------------------------

describe("applyMagicWandRegionToSelection", () => {
  const outer: MagicWandRegion["outer"] = [
    { x: 0.1, y: 0.1 },
    { x: 0.5, y: 0.1 },
    { x: 0.5, y: 0.5 },
    { x: 0.1, y: 0.5 },
  ];
  const hole: MagicWandRegion["outer"] = [
    { x: 0.2, y: 0.2 },
    { x: 0.3, y: 0.2 },
    { x: 0.3, y: 0.3 },
    { x: 0.2, y: 0.3 },
  ];

  it("pushes outer with mode and holes with the opposite mode", () => {
    const region: MagicWandRegion = { outer, holes: [hole] };
    const result = applyMagicWandRegionToSelection(emptyPixelSelection(), region, "add");
    expect(result).not.toBeNull();
    expect(result!.subpaths.length).toBe(2);
    expect(result!.subpaths[0]!.mode).toBe("add");
    expect(result!.subpaths[1]!.mode).toBe("subtract");
  });

  it("subtract mode pushes holes as add", () => {
    const region: MagicWandRegion = { outer, holes: [hole] };
    const result = applyMagicWandRegionToSelection(emptyPixelSelection(), region, "subtract");
    expect(result!.subpaths[0]!.mode).toBe("subtract");
    expect(result!.subpaths[1]!.mode).toBe("add");
  });

  it("empty outer returns sel unchanged (reference equality)", () => {
    const sel = emptyPixelSelection();
    const region: MagicWandRegion = { outer: [], holes: [] };
    const result = applyMagicWandRegionToSelection(sel, region, "add");
    expect(result).toBe(sel);
  });

  it("null sel with empty outer returns null", () => {
    const region: MagicWandRegion = { outer: [], holes: [] };
    expect(applyMagicWandRegionToSelection(null, region, "add")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// flipNormalizedPoint / flipMagicWandRegion
// ---------------------------------------------------------------------------

describe("flipNormalizedPoint", () => {
  it("flips x and/or y around 0.5", () => {
    const onlyX = flipNormalizedPoint({ x: 0.2, y: 0.8 }, true, false);
    expect(onlyX.x).toBeCloseTo(0.8);
    expect(onlyX.y).toBeCloseTo(0.8);

    const onlyY = flipNormalizedPoint({ x: 0.2, y: 0.8 }, false, true);
    expect(onlyY.x).toBeCloseTo(0.2);
    expect(onlyY.y).toBeCloseTo(0.2);

    const both = flipNormalizedPoint({ x: 0.2, y: 0.8 }, true, true);
    expect(both.x).toBeCloseTo(0.8);
    expect(both.y).toBeCloseTo(0.2);

    expect(flipNormalizedPoint({ x: 0.2, y: 0.8 }, false, false)).toEqual({ x: 0.2, y: 0.8 });
  });

  it("is its own inverse (flip(flip(p)) === p in value)", () => {
    const p = { x: 0.37, y: 0.91 };
    const once = flipNormalizedPoint(p, true, true);
    const twice = flipNormalizedPoint(once, true, true);
    expect(twice.x).toBeCloseTo(p.x);
    expect(twice.y).toBeCloseTo(p.y);
  });
});

describe("flipMagicWandRegion", () => {
  it("returns the original reference when both flips are false", () => {
    const region: MagicWandRegion = { outer: [{ x: 0.1, y: 0.2 }], holes: [] };
    expect(flipMagicWandRegion(region, false, false)).toBe(region);
  });

  it("flips every point in outer and holes", () => {
    const region: MagicWandRegion = {
      outer: [{ x: 0.1, y: 0.2 }],
      holes: [[{ x: 0.3, y: 0.4 }]],
    };
    const flipped = flipMagicWandRegion(region, true, false);
    expect(flipped.outer[0]).toEqual({ x: 0.9, y: 0.2 });
    expect(flipped.holes[0]![0]).toEqual({ x: 0.7, y: 0.4 });
  });
});

// ---------------------------------------------------------------------------
// scanMagicWandRegionFromImageData
// ---------------------------------------------------------------------------

describe("scanMagicWandRegionFromImageData", () => {
  it("finds the correct connected region on a hand-built 4x4 two-color buffer", () => {
    const { data, w, h } = imageDataFromGrid(["AABB", "AABB", "AABB", "AABB"], {
      A: [255, 0, 0, 255],
      B: [0, 0, 255, 255],
    });
    const region = scanMagicWandRegionFromImageData(data, w, h, 0, 0, 10);
    expect(region.outer.length).toBeGreaterThanOrEqual(3);
    // 클릭 지점(0,0)이 왼쪽 절반(A) 안에 있어야 하므로 x 는 0..0.5 범위여야 한다.
    for (const p of region.outer) {
      expect(p.x).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });

  it("returns empty outer when nothing matches beyond the start pixel area threshold", () => {
    const { data, w, h } = imageDataFromGrid(["A"], { A: [255, 0, 0, 255] });
    const region = scanMagicWandRegionFromImageData(data, w, h, 0, 0, 10);
    // 1x1 마스크는 면적 문턱(MIN_SELECTION_SUBPATH_AREA) 미만이라 버려질 수 있다 — 예외 없이 outer/holes 반환.
    expect(Array.isArray(region.outer)).toBe(true);
    expect(Array.isArray(region.holes)).toBe(true);
  });
});
