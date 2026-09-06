import { describe, expect, it } from "vitest";

import {
  ADVANCED_FILL_DEFAULTS,
  ADVANCED_FILL_MAX_AREA_ADJUSTMENT,
  ADVANCED_FILL_MAX_CLOSE_GAP_RADIUS,
  ADVANCED_FILL_MAX_PIXELS,
  applyAdvancedFill,
  type AdvancedFillImageDataLike,
  type AdvancedFillMaskLike,
  type AdvancedFillOptions,
  type AdvancedFillRequest,
  type AdvancedFillRgba,
} from "./studio-advanced-fill";

const CLEAR: AdvancedFillRgba = [0, 0, 0, 0];
const WHITE: AdvancedFillRgba = [255, 255, 255, 255];
const BLACK: AdvancedFillRgba = [0, 0, 0, 255];
const RED: AdvancedFillRgba = [240, 20, 30, 255];
const BLUE: AdvancedFillRgba = [10, 80, 240, 255];

function solid(width: number, height: number, color: AdvancedFillRgba): AdvancedFillImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let position = 0; position < width * height; position++) data.set(color, position * 4);
  return { data, width, height };
}

function imageFromRows(
  rows: readonly string[],
  palette: Readonly<Record<string, AdvancedFillRgba>>,
): AdvancedFillImageDataLike {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const data = new Uint8ClampedArray(width * height * 4);
  rows.forEach((row, y) => {
    expect(row).toHaveLength(width);
    [...row].forEach((key, x) => {
      const color = palette[key];
      if (!color) throw new Error(`Missing test palette color: ${key}`);
      data.set(color, (y * width + x) * 4);
    });
  });
  return { data, width, height };
}

function byteMask(width: number, height: number, values: readonly number[]): AdvancedFillMaskLike {
  return { data: Uint8Array.from(values), width, height };
}

function rgbaAt(image: AdvancedFillImageDataLike, x: number, y: number): number[] {
  const offset = (y * image.width + x) * 4;
  return Array.from(image.data.slice(offset, offset + 4));
}

function maskRows(mask: Uint8Array, width: number): string[] {
  const rows: string[] = [];
  for (let offset = 0; offset < mask.length; offset += width) {
    rows.push(Array.from(mask.slice(offset, offset + width), (value) => (value ? "#" : ".")).join(""));
  }
  return rows;
}

function fill(
  target: AdvancedFillImageDataLike,
  overrides: Partial<Omit<AdvancedFillRequest, "target" | "seeds" | "fill">> & {
    seeds?: AdvancedFillRequest["seeds"];
    color?: AdvancedFillRgba;
    options?: AdvancedFillOptions;
  } = {},
) {
  return applyAdvancedFill({
    target,
    seeds: overrides.seeds ?? [{ x: 0, y: 0 }],
    fill: overrides.color ?? RED,
    referenceImage: overrides.referenceImage,
    referenceMask: overrides.referenceMask,
    abort: overrides.abort,
    options: { maxAreaRatio: 1, ...overrides.options },
  });
}

describe("applyAdvancedFill basic contiguous selection", () => {
  it("fills only the 4-connected seed-color region", () => {
    const target = imageFromRows(["WWB", "WBB", "BBB"], { W: WHITE, B: BLACK });
    const result = fill(target);

    expect(result.diagnostics.status).toBe("applied");
    expect(maskRows(result.matchedMask, 3)).toEqual(["##.", "#..", "..."]);
    expect(maskRows(result.mask, 3)).toEqual(["##.", "#..", "..."]);
    expect(result.diagnostics.matched.pixelCount).toBe(3);
    expect(rgbaAt(result.imageData, 1, 0)).toEqual(RED);
    expect(rgbaAt(result.imageData, 2, 0)).toEqual(BLACK);
  });

  it("uses RMS color tolerance with an inclusive threshold", () => {
    const target = imageFromRows(["ABC"], {
      A: [100, 100, 100, 255],
      B: [110, 100, 100, 255],
      C: [112, 100, 100, 255],
    });
    // RGB RMS distances are 10/sqrt(3) and 12/sqrt(3).
    const result = fill(target, { options: { tolerance: 6, matchAlpha: false } });

    expect(maskRows(result.mask, 3)).toEqual(["##."]);
  });

  it("includes alpha in color matching by default", () => {
    const target = imageFromRows(["AB"], {
      A: [80, 90, 100, 0],
      B: [80, 90, 100, 255],
    });
    expect(maskRows(fill(target, { options: { tolerance: 0 } }).mask, 2)).toEqual(["#."]);
    expect(maskRows(fill(target, { options: { tolerance: 0, matchAlpha: false } }).mask, 2)).toEqual(["##"]);
  });

  it("supports 8-way diagonal connectivity without changing the 4-way default", () => {
    const target = imageFromRows(["WB", "BW"], { W: WHITE, B: BLACK });

    expect(maskRows(fill(target).mask, 2)).toEqual(["#.", ".."]);
    expect(maskRows(fill(target, { options: { connectivity: 8 } }).mask, 2)).toEqual(["#.", ".#"]);
  });

  it("selects disconnected matching regions when contiguous is false", () => {
    const target = imageFromRows(["WBW"], { W: WHITE, B: BLACK });
    const result = fill(target, { options: { contiguous: false } });

    expect(maskRows(result.mask, 3)).toEqual(["#.#"]);
    expect(result.diagnostics.final.pixelCount).toBe(2);
  });

  it("unions multiple disconnected seeds and reports duplicate seeds separately", () => {
    const target = imageFromRows(["WBW"], { W: WHITE, B: BLACK });
    const result = fill(target, {
      seeds: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 0, y: 0 },
      ],
    });

    expect(maskRows(result.mask, 3)).toEqual(["#.#"]);
    expect(result.diagnostics.requestedSeedCount).toBe(3);
    expect(result.diagnostics.uniqueSeedCount).toBe(2);
    expect(result.diagnostics.acceptedSeedCount).toBe(2);
  });

  it("supports multiple seed colors in one deterministic request", () => {
    const target = imageFromRows(["WRB"], { W: WHITE, R: RED, B: BLACK });
    const first = fill(target, {
      seeds: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
      ],
      color: BLUE,
    });
    const second = fill(target, {
      seeds: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
      ],
      color: BLUE,
    });

    expect(maskRows(first.mask, 3)).toEqual(["#.#"]);
    expect(first.imageData.data).toEqual(second.imageData.data);
    expect(first.mask).toEqual(second.mask);
  });

  it("returns noop but preserves the selected mask when every selected RGBA value already matches", () => {
    const target = solid(2, 2, RED);
    const result = fill(target, { color: RED });

    expect(result.diagnostics.status).toBe("noop");
    expect(result.diagnostics.paintedPixelCount).toBe(0);
    expect(result.diagnostics.final.pixelCount).toBe(4);
  });

  it("never mutates target and returns independent image and mask buffers", () => {
    const target = imageFromRows(["WB"], { W: WHITE, B: BLACK });
    const before = target.data.slice();
    const result = fill(target);

    expect(target.data).toEqual(before);
    expect(result.imageData.data).not.toBe(target.data);
    expect(result.mask).not.toBe(result.matchedMask);
    result.imageData.data[0] = 17;
    result.mask[0] = 0;
    expect(target.data).toEqual(before);
    expect(result.matchedMask[0]).toBe(1);
  });

  it("handles a large flat region iteratively without recursion", () => {
    const target = solid(320, 240, WHITE);
    const result = fill(target, { seeds: [{ x: 160, y: 120 }] });

    expect(result.diagnostics.status).toBe("applied");
    expect(result.diagnostics.final.pixelCount).toBe(76_800);
  });
});

describe("separate reference image, alpha boundaries, and reference masks", () => {
  it("uses a separate reference image while writing full RGBA into a transparent target", () => {
    const target = solid(3, 1, CLEAR);
    const reference = imageFromRows(["WBW"], { W: WHITE, B: BLACK });
    const result = fill(target, {
      referenceImage: reference,
      seeds: [{ x: 0, y: 0 }],
      color: [12, 34, 56, 180],
    });

    expect(result.diagnostics.referenceSource).toBe("reference-image");
    expect(maskRows(result.mask, 3)).toEqual(["#.."]);
    expect(rgbaAt(result.imageData, 0, 0)).toEqual([12, 34, 56, 180]);
    expect(rgbaAt(result.imageData, 1, 0)).toEqual(CLEAR);
  });

  it("fills a transparent enclosure using visible pixels as boundaries", () => {
    const reference = imageFromRows(["VVV", "VTV", "VVV"], {
      V: BLACK,
      T: CLEAR,
    });
    const result = fill(solid(3, 3, CLEAR), {
      referenceImage: reference,
      seeds: [{ x: 1, y: 1 }],
      options: { matchMode: "boundary-only", alphaBoundary: "visible" },
    });

    expect(maskRows(result.mask, 3)).toEqual(["...", ".#.", "..."]);
    expect(result.diagnostics.acceptedSeedCount).toBe(1);
  });

  it("can use transparent pixels as boundaries and fill only visible pixels", () => {
    const reference = imageFromRows(["VTV"], { V: BLACK, T: CLEAR });
    const result = fill(solid(3, 1, CLEAR), {
      referenceImage: reference,
      options: {
        matchMode: "boundary-only",
        alphaBoundary: "transparent",
        contiguous: false,
      },
    });

    expect(maskRows(result.mask, 3)).toEqual(["#.#"]);
  });

  it("honors alphaThreshold on anti-aliased boundary pixels", () => {
    const reference = imageFromRows(["ABC"], {
      A: [0, 0, 0, 10],
      B: [0, 0, 0, 11],
      C: [0, 0, 0, 255],
    });
    const result = fill(solid(3, 1, CLEAR), {
      referenceImage: reference,
      seeds: [{ x: 0, y: 0 }],
      options: { matchMode: "boundary-only", alphaBoundary: "visible", alphaThreshold: 10 },
    });

    expect(maskRows(result.mask, 3)).toEqual(["#.."]);
  });

  it("interprets a supplied mask in allow mode with an explicit threshold", () => {
    const target = solid(4, 1, WHITE);
    const referenceMask = byteMask(4, 1, [0, 20, 21, 255]);
    const result = fill(target, {
      referenceMask,
      seeds: [{ x: 2, y: 0 }],
      options: { maskMode: "allow", maskThreshold: 20, contiguous: false },
    });

    expect(maskRows(result.mask, 4)).toEqual(["..##"]);
    expect(result.diagnostics.mask).toEqual({
      supplied: true,
      mode: "allow",
      threshold: 20,
      constrainExpansion: true,
    });
  });

  it("interprets a supplied mask in block mode and rejects a blocked seed", () => {
    const target = solid(4, 1, WHITE);
    const referenceMask = byteMask(4, 1, [0, 255, 0, 0]);
    const result = fill(target, {
      referenceMask,
      seeds: [{ x: 1, y: 0 }],
      options: { maskMode: "block" },
    });

    expect(result.diagnostics.status).toBe("empty");
    expect(result.diagnostics.acceptedSeedCount).toBe(0);
    expect(result.diagnostics.rejectedSeedCount).toBe(1);
    expect(result.mask).toEqual(new Uint8Array(4));
  });

  it("allows unblocked regions in block mode", () => {
    const target = solid(4, 1, WHITE);
    const referenceMask = byteMask(4, 1, [0, 255, 0, 0]);
    const result = fill(target, {
      referenceMask,
      seeds: [{ x: 0, y: 0 }],
      options: { maskMode: "block", contiguous: false },
    });

    expect(maskRows(result.mask, 4)).toEqual(["#.##"]);
  });
});

describe("close-gap and area adjustment", () => {
  it("closes a one-pixel break in a line-art boundary", () => {
    const reference = imageFromRows(
      ["TTTVTTT", "TTTVTTT", "TTTVTTT", "TTTTTTT", "TTTVTTT", "TTTVTTT", "TTTVTTT"],
      { T: CLEAR, V: BLACK },
    );
    const target = solid(7, 7, CLEAR);
    const open = fill(target, {
      referenceImage: reference,
      seeds: [{ x: 1, y: 3 }],
      options: { tolerance: 0 },
    });
    const closed = fill(target, {
      referenceImage: reference,
      seeds: [{ x: 1, y: 3 }],
      options: { tolerance: 0, closeGapRadius: 1 },
    });

    expect(open.diagnostics.final.pixelCount).toBe(43);
    expect(open.diagnostics.final.touchesCanvasEdge).toBe(true);
    expect(closed.diagnostics.final.pixelCount).toBeLessThan(open.diagnostics.final.pixelCount);
    expect(closed.mask[3 * 7 + 4]).toBe(0);
    expect(closed.mask[3 * 7 + 1]).toBe(1);
  });

  it("expands a one-pixel region by one pixel with a 3x3 square footprint", () => {
    const target = imageFromRows(["BBB", "BWB", "BBB"], { W: WHITE, B: BLACK });
    const result = fill(target, {
      seeds: [{ x: 1, y: 1 }],
      options: { areaAdjustment: 1 },
    });

    expect(maskRows(result.matchedMask, 3)).toEqual(["...", ".#.", "..."]);
    expect(maskRows(result.mask, 3)).toEqual(["###", "###", "###"]);
  });

  it("accepts 0.5px UI steps and rounds symmetrically away from zero", () => {
    const expansionTarget = imageFromRows(["BBB", "BWB", "BBB"], { W: WHITE, B: BLACK });
    const contractionTarget = imageFromRows(
      ["BBBBB", "BWWWB", "BWWWB", "BWWWB", "BBBBB"],
      { W: WHITE, B: BLACK },
    );
    const expanded = fill(expansionTarget, {
      seeds: [{ x: 1, y: 1 }],
      options: { areaAdjustment: 0.5 },
    });
    const contracted = fill(contractionTarget, {
      seeds: [{ x: 2, y: 2 }],
      options: { areaAdjustment: -0.5 },
    });

    expect(expanded.diagnostics.areaAdjustment).toBe(1);
    expect(expanded.diagnostics.final.pixelCount).toBe(9);
    expect(contracted.diagnostics.areaAdjustment).toBe(-1);
    expect(maskRows(contracted.mask, 5)).toEqual([".....", ".....", "..#..", ".....", "....."]);
  });

  it("contracts a 3x3 region to its center", () => {
    const target = imageFromRows(
      ["BBBBB", "BWWWB", "BWWWB", "BWWWB", "BBBBB"],
      { W: WHITE, B: BLACK },
    );
    const result = fill(target, {
      seeds: [{ x: 2, y: 2 }],
      options: { areaAdjustment: -1 },
    });

    expect(result.diagnostics.matched.pixelCount).toBe(9);
    expect(result.diagnostics.final.pixelCount).toBe(1);
    expect(result.diagnostics.final.bounds).toEqual({ x: 2, y: 2, width: 1, height: 1 });
  });

  it("can contract a region entirely and report empty without painting", () => {
    const target = imageFromRows(["BBB", "BWB", "BBB"], { W: WHITE, B: BLACK });
    const before = target.data.slice();
    const result = fill(target, {
      seeds: [{ x: 1, y: 1 }],
      options: { areaAdjustment: -1 },
    });

    expect(result.diagnostics.status).toBe("empty");
    expect(result.diagnostics.matched.pixelCount).toBe(1);
    expect(result.diagnostics.final.pixelCount).toBe(0);
    expect(result.imageData.data).toEqual(before);
  });

  it("constrains expansion to an allow mask by default", () => {
    const target = imageFromRows(["BBB", "BWB", "BBB"], { W: WHITE, B: BLACK });
    const referenceMask = byteMask(3, 3, [0, 0, 0, 0, 255, 255, 0, 0, 0]);
    const result = fill(target, {
      referenceMask,
      seeds: [{ x: 1, y: 1 }],
      options: { areaAdjustment: 1 },
    });

    expect(maskRows(result.mask, 3)).toEqual(["...", ".##", "..."]);
  });

  it("can explicitly let expansion cross a reference mask", () => {
    const target = imageFromRows(["BBB", "BWB", "BBB"], { W: WHITE, B: BLACK });
    const referenceMask = byteMask(3, 3, [0, 0, 0, 0, 255, 0, 0, 0, 0]);
    const result = fill(target, {
      referenceMask,
      seeds: [{ x: 1, y: 1 }],
      options: { areaAdjustment: 1, constrainExpansionToMask: false },
    });

    expect(maskRows(result.mask, 3)).toEqual(["###", "###", "###"]);
  });
});

describe("leak guard and diagnostics", () => {
  it("rejects a scan as soon as selected area exceeds maxAreaRatio", () => {
    const target = solid(10, 1, WHITE);
    const before = target.data.slice();
    const result = applyAdvancedFill({
      target,
      seeds: [{ x: 0, y: 0 }],
      fill: RED,
      options: { maxAreaRatio: 0.5 },
    });

    expect(result.diagnostics.status).toBe("leak-guarded");
    expect(result.diagnostics.leakGuard).toEqual({
      triggered: true,
      phase: "scan",
      maxAreaRatio: 0.5,
      maxPixelCount: 5,
    });
    expect(result.diagnostics.matched.pixelCount).toBe(6);
    expect(result.diagnostics.matched.areaRatio).toBe(0.6);
    expect(result.diagnostics.matched.touchesCanvasEdge).toBe(true);
    expect(result.diagnostics.final.pixelCount).toBe(0);
    expect(result.mask).toEqual(new Uint8Array(10));
    expect(result.imageData.data).toEqual(before);
    expect(target.data).toEqual(before);
  });

  it("the safe default guards a full-canvas accidental fill", () => {
    const result = applyAdvancedFill({
      target: solid(20, 1, WHITE),
      seeds: [{ x: 0, y: 0 }],
      fill: RED,
    });

    expect(ADVANCED_FILL_DEFAULTS.maxAreaRatio).toBe(0.85);
    expect(result.diagnostics.status).toBe("leak-guarded");
    expect(result.diagnostics.leakGuard.maxPixelCount).toBe(17);
  });

  it("allows exactly 100% when maxAreaRatio is 1", () => {
    const result = fill(solid(5, 2, WHITE));

    expect(result.diagnostics.status).toBe("applied");
    expect(result.diagnostics.final.pixelCount).toBe(10);
    expect(result.diagnostics.final.areaRatio).toBe(1);
  });

  it("guards an area expansion that crosses the limit", () => {
    const target = imageFromRows(["BBBBB", "BBWBB", "BBBBB"], { W: WHITE, B: BLACK });
    const before = target.data.slice();
    const result = applyAdvancedFill({
      target,
      seeds: [{ x: 2, y: 1 }],
      fill: RED,
      options: { maxAreaRatio: 0.4, areaAdjustment: 1 },
    });

    expect(result.diagnostics.status).toBe("leak-guarded");
    expect(result.diagnostics.leakGuard.phase).toBe("adjustment");
    expect(result.diagnostics.matched.pixelCount).toBe(1);
    expect(result.diagnostics.final.pixelCount).toBe(0);
    expect(result.imageData.data).toEqual(before);
  });

  it("reports bounds and whether a successful selection touches the canvas edge", () => {
    const target = imageFromRows(["WBBB", "BBBB", "BBWB", "BBBB"], { W: WHITE, B: BLACK });
    const edge = fill(target, { seeds: [{ x: 0, y: 0 }] });
    const interior = fill(target, { seeds: [{ x: 2, y: 2 }] });

    expect(edge.diagnostics.final).toMatchObject({
      pixelCount: 1,
      touchesCanvasEdge: true,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
    });
    expect(interior.diagnostics.final).toMatchObject({
      pixelCount: 1,
      touchesCanvasEdge: false,
      bounds: { x: 2, y: 2, width: 1, height: 1 },
    });
  });

  it("supports a ratio small enough to permit zero pixels and guards the first match", () => {
    const result = applyAdvancedFill({
      target: solid(2, 2, WHITE),
      seeds: [{ x: 1, y: 1 }],
      fill: RED,
      options: { maxAreaRatio: 0.01 },
    });

    expect(result.diagnostics.leakGuard.maxPixelCount).toBe(0);
    expect(result.diagnostics.status).toBe("leak-guarded");
    expect(result.diagnostics.matched.pixelCount).toBe(1);
  });
});

describe("abort safety", () => {
  it("returns an untouched clone and zero masks when already aborted", () => {
    const target = solid(4, 4, WHITE);
    const before = target.data.slice();
    const result = fill(target, { abort: { aborted: true } });

    expect(result.diagnostics.status).toBe("aborted");
    expect(result.imageData.data).toEqual(before);
    expect(result.imageData.data).not.toBe(target.data);
    expect(result.mask).toEqual(new Uint8Array(16));
    expect(result.matchedMask).toEqual(new Uint8Array(16));
  });

  it("polls an abort callback during work and never exposes a partial paint", () => {
    const target = solid(20, 20, WHITE);
    const before = target.data.slice();
    let polls = 0;
    const result = fill(target, {
      abort: () => {
        polls++;
        return polls >= 2;
      },
    });

    expect(polls).toBeGreaterThanOrEqual(2);
    expect(result.diagnostics.status).toBe("aborted");
    expect(result.imageData.data).toEqual(before);
    expect(result.mask).toEqual(new Uint8Array(400));
  });

  it("does not swallow exceptions thrown by a caller abort callback", () => {
    expect(() =>
      fill(solid(2, 2, WHITE), {
        abort: () => {
          throw new Error("abort source failed");
        },
      }),
    ).toThrow("abort source failed");
  });
});

describe("runtime validation and safety bounds", () => {
  it("validates target dimensions and exact RGBA buffer length", () => {
    expect(() =>
      applyAdvancedFill({
        target: { width: 0, height: 1, data: new Uint8ClampedArray(0) },
        seeds: [{ x: 0, y: 0 }],
        fill: RED,
      }),
    ).toThrow(/target\.width/);
    expect(() =>
      applyAdvancedFill({
        target: { width: 2, height: 2, data: new Uint8ClampedArray(15) },
        seeds: [{ x: 0, y: 0 }],
        fill: RED,
      }),
    ).toThrow(/width \* height \* 4/);
  });

  it("rejects images above the explicit allocation safety limit before reading data", () => {
    expect(() =>
      applyAdvancedFill({
        target: {
          width: ADVANCED_FILL_MAX_PIXELS,
          height: 2,
          data: new Uint8ClampedArray(0),
        },
        seeds: [{ x: 0, y: 0 }],
        fill: RED,
      }),
    ).toThrow(/pixel safety limit/);
  });

  it("requires Uint8ClampedArray RGBA data", () => {
    const malformed = { width: 1, height: 1, data: new Uint8Array(4) } as unknown as AdvancedFillImageDataLike;
    expect(() => fill(malformed)).toThrow(/Uint8ClampedArray/);
  });

  it("validates separate reference dimensions and RGBA length", () => {
    expect(() => fill(solid(2, 2, WHITE), { referenceImage: solid(3, 2, WHITE) })).toThrow(
      /referenceImage dimensions/,
    );
    const malformedReference = {
      width: 2,
      height: 2,
      data: new Uint8ClampedArray(12),
    };
    expect(() => fill(solid(2, 2, WHITE), { referenceImage: malformedReference })).toThrow(
      /referenceImage\.data length/,
    );
  });

  it("validates reference mask dimensions, type, and length", () => {
    const target = solid(2, 2, WHITE);
    expect(() => fill(target, { referenceMask: byteMask(1, 4, [1, 1, 1, 1]) })).toThrow(
      /dimensions must match/,
    );
    expect(() =>
      fill(target, {
        referenceMask: { width: 2, height: 2, data: new Uint8Array(3) },
      }),
    ).toThrow(/width \* height/);
    const malformed = {
      width: 2,
      height: 2,
      data: new Uint16Array(4),
    } as unknown as AdvancedFillMaskLike;
    expect(() => fill(target, { referenceMask: malformed })).toThrow(/Uint8Array/);
  });

  it("requires non-empty, integer, in-bounds seeds", () => {
    const target = solid(2, 2, WHITE);
    expect(() => fill(target, { seeds: [] })).toThrow(/at least one/);
    expect(() => fill(target, { seeds: [{ x: 0.5, y: 0 }] })).toThrow(/seeds\[0\]\.x/);
    expect(() => fill(target, { seeds: [{ x: 2, y: 0 }] })).toThrow(/seeds\[0\]\.x/);
    expect(() => fill(target, { seeds: [{ x: 0, y: -1 }] })).toThrow(/seeds\[0\]\.y/);
  });

  it("requires exactly four integer RGBA channels", () => {
    const target = solid(1, 1, WHITE);
    expect(() => fill(target, { color: [1, 2, 3] as unknown as AdvancedFillRgba })).toThrow(/four/);
    expect(() => fill(target, { color: [1, 2, 3, 256] })).toThrow(/fill\[3\]/);
    expect(() => fill(target, { color: [1, 2.5, 3, 4] })).toThrow(/fill\[1\]/);
  });

  it.each([
    ["tolerance", { tolerance: -1 }],
    ["tolerance", { tolerance: 256 }],
    ["alphaThreshold", { alphaThreshold: 256 }],
    ["maskThreshold", { maskThreshold: -1 }],
    ["connectivity", { connectivity: 6 as 4 }],
    ["closeGapRadius", { closeGapRadius: ADVANCED_FILL_MAX_CLOSE_GAP_RADIUS + 1 }],
    ["areaAdjustment", { areaAdjustment: ADVANCED_FILL_MAX_AREA_ADJUSTMENT + 0.1 }],
    ["maxAreaRatio", { maxAreaRatio: 0 }],
    ["maxAreaRatio", { maxAreaRatio: 1.01 }],
  ] satisfies ReadonlyArray<readonly [string, AdvancedFillOptions]>) (
    "rejects an out-of-range %s option",
    (label, options) => {
      expect(() => fill(solid(1, 1, WHITE), { options })).toThrow(label);
    },
  );

  it("rejects malformed enum and boolean options at runtime", () => {
    const target = solid(1, 1, WHITE);
    expect(() => fill(target, { options: { matchMode: "all" as "seed-color" } })).toThrow(/matchMode/);
    expect(() => fill(target, { options: { alphaBoundary: "opaque" as "none" } })).toThrow(/alphaBoundary/);
    expect(() => fill(target, { options: { maskMode: "clip" as "allow" } })).toThrow(/maskMode/);
    expect(() => fill(target, { options: { contiguous: 1 as unknown as boolean } })).toThrow(/contiguous/);
  });
});
