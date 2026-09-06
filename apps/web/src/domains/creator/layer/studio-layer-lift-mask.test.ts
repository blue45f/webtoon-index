import { describe, expect, it } from "vitest";

import {
  analyzeStudioLayerLiftMask,
  applyStudioLayerLiftMaskMorphology,
  composeStudioLayerLiftForegroundAlpha,
  estimateStudioLayerLiftMorphologyWork,
  prepareStudioLayerLiftMask,
  removeStudioLayerLiftSmallIslands,
  resampleStudioLayerLiftConfidenceMask,
  STUDIO_LAYER_LIFT_MASK_MAX_DIMENSION,
  STUDIO_LAYER_LIFT_MASK_MAX_MORPHOLOGY_NEIGHBOR_VISITS,
  STUDIO_LAYER_LIFT_MASK_MAX_PIXELS,
  thresholdStudioLayerLiftConfidenceMask,
  validateStudioLayerLiftConfidenceMask,
} from "./studio-layer-lift-mask";

const confidence = (
  width: number,
  height: number,
  values: readonly number[],
) => ({ width, height, confidence: Float32Array.from(values) });

const binary = (
  width: number,
  height: number,
  values: readonly number[],
) => ({ width, height, pixels: Uint8Array.from(values) });

describe("studio layer-lift confidence admission", () => {
  it("accepts a bounded finite raster and returns a defensive copy", () => {
    const input = confidence(2, 2, [0, 0.25, 0.5, 1]);
    const result = validateStudioLayerLiftConfidenceMask(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.confidence).not.toBe(input.confidence);
    input.confidence[0] = 1;
    expect([...result.value.confidence]).toEqual([0, 0.25, 0.5, 1]);
  });

  it.each([
    [0, 1, "invalid-dimensions"],
    [1.5, 1, "invalid-dimensions"],
    [Number.NaN, 1, "invalid-dimensions"],
    [STUDIO_LAYER_LIFT_MASK_MAX_DIMENSION + 1, 1, "dimension-budget-exceeded"],
  ] as const)("rejects invalid dimensions %s x %s", (width, height, code) => {
    const result = validateStudioLayerLiftConfidenceMask(
      confidence(width, height, [0]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(code);
  });

  it("rejects area, length, NaN, infinity, and out-of-range confidence", () => {
    const overArea = validateStudioLayerLiftConfidenceMask(confidence(
      STUDIO_LAYER_LIFT_MASK_MAX_DIMENSION,
      Math.floor(STUDIO_LAYER_LIFT_MASK_MAX_PIXELS
        / STUDIO_LAYER_LIFT_MASK_MAX_DIMENSION) + 1,
      [0],
    ));
    expect(overArea.ok).toBe(false);
    if (!overArea.ok) expect(overArea.code).toBe("pixel-budget-exceeded");

    for (const input of [
      confidence(2, 2, [0]),
      confidence(1, 1, [Number.NaN]),
      confidence(1, 1, [Number.POSITIVE_INFINITY]),
      confidence(1, 1, [-0.01]),
      confidence(1, 1, [1.01]),
    ]) {
      expect(validateStudioLayerLiftConfidenceMask(input).ok).toBe(false);
    }
  });
});

describe("studio layer-lift resampling and threshold", () => {
  it("bilinearly resamples pixel centres with clamped edges", () => {
    const result = resampleStudioLayerLiftConfidenceMask(
      confidence(2, 2, [0, 1, 1, 0]),
      3,
      3,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.value.confidence]).toEqual([
      0, 0.5, 1,
      0.5, 0.5, 0.5,
      1, 0.5, 0,
    ]);
  });

  it("copies even when dimensions are unchanged", () => {
    const input = confidence(2, 1, [0.25, 0.75]);
    const result = resampleStudioLayerLiftConfidenceMask(input, 2, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.confidence).not.toBe(input.confidence);
    expect([...result.value.confidence]).toEqual([0.25, 0.75]);
  });

  it("hard-thresholds and uses a centred smoothstep feather", () => {
    const input = confidence(5, 1, [0.2, 0.3, 0.5, 0.7, 0.8]);
    const hard = thresholdStudioLayerLiftConfidenceMask(input, {
      threshold: 0.5,
    });
    const soft = thresholdStudioLayerLiftConfidenceMask(input, {
      threshold: 0.5,
      feather: 0.4,
    });
    expect(hard.ok && [...hard.value.alpha]).toEqual([0, 0, 1, 1, 1]);
    expect(soft.ok).toBe(true);
    if (!soft.ok) return;
    expect(soft.value.alpha[0]).toBe(0);
    expect(soft.value.alpha[1]).toBeCloseTo(0, 6);
    expect(soft.value.alpha[2]).toBeCloseTo(0.5, 6);
    expect(soft.value.alpha[3]).toBeCloseTo(1, 6);
    expect(soft.value.alpha[4]).toBe(1);
  });

  it("fails closed for invalid threshold options", () => {
    expect(thresholdStudioLayerLiftConfidenceMask(
      confidence(1, 1, [0.5]),
      { threshold: Number.NaN },
    ).ok).toBe(false);
    expect(thresholdStudioLayerLiftConfidenceMask(
      confidence(1, 1, [0.5]),
      { feather: 2 },
    ).ok).toBe(false);
    expect(thresholdStudioLayerLiftConfidenceMask(
      confidence(1, 1, [0]),
      { threshold: 0, feather: 0.2 },
    )).toMatchObject({ ok: false, code: "invalid-options" });
    expect(thresholdStudioLayerLiftConfidenceMask(
      confidence(1, 1, [1]),
      { threshold: 1, feather: 0.2 },
    )).toMatchObject({ ok: false, code: "invalid-options" });
    const throwingOptions = Object.defineProperty({}, "threshold", {
      enumerable: true,
      get: () => {
        throw new Error("hostile getter");
      },
    });
    expect(thresholdStudioLayerLiftConfidenceMask(
      confidence(1, 1, [0.5]),
      throwingOptions,
    )).toMatchObject({ ok: false, code: "invalid-options" });
  });
});

describe("studio layer-lift alpha composition and statistics", () => {
  it("multiplies the mask by partial source alpha", () => {
    const mask = {
      width: 4,
      height: 1,
      alpha: Float32Array.from([0, 0.5, 1, 0.25]),
    };
    const result = composeStudioLayerLiftForegroundAlpha(
      {
        width: 4,
        height: 1,
        alpha: Uint8ClampedArray.from([255, 128, 64, 200]),
      },
      mask,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.value.alpha]).toEqual([0, 64, 64, 50]);
    expect(result.value.alpha).not.toBe(mask.alpha);
  });

  it("reports right/bottom-exclusive bounds and normalized statistics", () => {
    const result = analyzeStudioLayerLiftMask({
      width: 3,
      height: 2,
      alpha: Float32Array.from([0, 0.5, 0, 0, 1, 0]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      pixelCount: 6,
      nonZeroPixelCount: 2,
      opaquePixelCount: 1,
      minimumAlpha: 0,
      maximumAlpha: 1,
      coverage: 2 / 6,
      bounds: { left: 1, top: 0, right: 2, bottom: 2, width: 1, height: 2 },
    });
    expect(result.value.meanAlpha).toBeCloseTo(0.25, 10);
  });

  it("rejects dimension mismatch and non-finite alpha", () => {
    expect(composeStudioLayerLiftForegroundAlpha(
      { width: 1, height: 1, alpha: new Uint8Array([255]) },
      { width: 2, height: 1, alpha: Float32Array.from([1, 1]) },
    )).toMatchObject({ ok: false, code: "dimension-mismatch" });
    expect(analyzeStudioLayerLiftMask({
      width: 1,
      height: 1,
      alpha: Float32Array.from([Number.NaN]),
    })).toMatchObject({ ok: false, sampleIndex: 0 });
  });
});

describe("studio layer-lift binary cleanup", () => {
  it("dilates and erodes deterministically with 4/8 connectivity", () => {
    const dot = binary(3, 3, [
      0, 0, 0,
      0, 1, 0,
      0, 0, 0,
    ]);
    const four = applyStudioLayerLiftMaskMorphology(dot, {
      operation: "dilate",
      connectivity: 4,
    });
    const eight = applyStudioLayerLiftMaskMorphology(dot, {
      operation: "dilate",
      connectivity: 8,
    });
    expect(four.ok && [...four.value.pixels]).toEqual([
      0, 1, 0,
      1, 1, 1,
      0, 1, 0,
    ]);
    expect(eight.ok && [...eight.value.pixels]).toEqual(new Array(9).fill(1));

    const eroded = applyStudioLayerLiftMaskMorphology(
      binary(3, 3, new Array(9).fill(1)),
      { operation: "erode" },
    );
    expect(eroded.ok && [...eroded.value.pixels]).toEqual(new Array(9).fill(1));
  });

  it("close fills a one-pixel hole and open removes a one-pixel speck", () => {
    const hole = applyStudioLayerLiftMaskMorphology(binary(3, 3, [
      1, 1, 1,
      1, 0, 1,
      1, 1, 1,
    ]), { operation: "close" });
    const speck = applyStudioLayerLiftMaskMorphology(binary(3, 3, [
      0, 0, 0,
      0, 1, 0,
      0, 0, 0,
    ]), { operation: "open" });
    expect(hole.ok && [...hole.value.pixels]).toEqual(new Array(9).fill(1));
    expect(speck.ok && [...speck.value.pixels]).toEqual(new Array(9).fill(0));
  });

  it("removes small islands according to 4/8 connectivity", () => {
    const diagonal = binary(3, 3, [
      1, 0, 0,
      0, 1, 0,
      0, 0, 0,
    ]);
    const four = removeStudioLayerLiftSmallIslands(diagonal, {
      minimumPixels: 2,
      connectivity: 4,
    });
    const eight = removeStudioLayerLiftSmallIslands(diagonal, {
      minimumPixels: 2,
      connectivity: 8,
    });
    expect(four.ok && [...four.value.mask.pixels]).toEqual(new Array(9).fill(0));
    expect(eight.ok && [...eight.value.mask.pixels]).toEqual([
      1, 0, 0,
      0, 1, 0,
      0, 0, 0,
    ]);
    if (four.ok) {
      expect(four.value.statistics).toMatchObject({
        componentCount: 2,
        removedComponentCount: 2,
        removedPixelCount: 2,
      });
    }
  });

  it("rejects non-binary values and work beyond the morphology budget", () => {
    expect(applyStudioLayerLiftMaskMorphology(binary(1, 1, [2]), {
      operation: "dilate",
    })).toMatchObject({ ok: false, code: "invalid-mask-value" });

    const width = STUDIO_LAYER_LIFT_MASK_MAX_DIMENSION;
    const height = STUDIO_LAYER_LIFT_MASK_MAX_PIXELS / width;
    const tooMuch = applyStudioLayerLiftMaskMorphology(
      binary(width, height, new Array(width * height).fill(0)),
      { operation: "close", iterations: Math.floor(
        STUDIO_LAYER_LIFT_MASK_MAX_MORPHOLOGY_NEIGHBOR_VISITS
          / (width * height * 2 * 9),
      ) + 1 },
    );
    expect(tooMuch).toMatchObject({ ok: false, code: "work-budget-exceeded" });

    const throwingOptions = Object.defineProperty({}, "operation", {
      enumerable: true,
      get: () => {
        throw new Error("hostile getter");
      },
    });
    expect(applyStudioLayerLiftMaskMorphology(
      binary(1, 1, [1]),
      throwingOptions as never,
    )).toMatchObject({ ok: false, code: "invalid-options" });
  });

  it("budgets actual 4/8-connected neighbor reads instead of output pixels", () => {
    expect(estimateStudioLayerLiftMorphologyWork({
      pixelCount: 100,
      operation: "dilate",
      iterations: 2,
      connectivity: 4,
    })).toEqual({
      ok: true,
      value: {
        passCount: 2,
        maximumNeighborsPerPixel: 5,
        maximumNeighborVisits: 1_000,
      },
    });
    expect(estimateStudioLayerLiftMorphologyWork({
      pixelCount: 100,
      operation: "close",
      iterations: 2,
      connectivity: 8,
    })).toEqual({
      ok: true,
      value: {
        passCount: 4,
        maximumNeighborsPerPixel: 9,
        maximumNeighborVisits: 3_600,
      },
    });
    expect(estimateStudioLayerLiftMorphologyWork({
      pixelCount: STUDIO_LAYER_LIFT_MASK_MAX_PIXELS,
      operation: "close",
      iterations: 2,
      connectivity: 8,
    })).toMatchObject({ ok: false, code: "work-budget-exceeded" });
  });
});

describe("studio layer-lift end-to-end preparation", () => {
  it("resamples, cleans islands, and preserves partial source alpha", () => {
    const result = prepareStudioLayerLiftMask({
      confidence: confidence(2, 1, [1, 0]),
      sourceAlpha: {
        width: 4,
        height: 1,
        alpha: Uint8ClampedArray.from([64, 128, 192, 255]),
      },
      options: { threshold: 0.5 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.value.foregroundAlpha.alpha]).toEqual([64, 128, 0, 0]);
    expect(result.value.foregroundStatistics.bounds).toEqual({
      left: 0, top: 0, right: 2, bottom: 1, width: 2, height: 1,
    });
  });

  it("returns an explicit empty failure for a zero-visible foreground", () => {
    const result = prepareStudioLayerLiftMask({
      confidence: confidence(1, 1, [1]),
      sourceAlpha: { width: 1, height: 1, alpha: new Uint8Array([0]) },
    });
    expect(result).toMatchObject({
      ok: false,
      empty: true,
      code: "empty-foreground",
      foregroundStatistics: { nonZeroPixelCount: 0, bounds: null },
    });
  });

  it("fails closed when a preparation boundary exposes hostile getters", () => {
    const hostile = Object.defineProperty({}, "sourceAlpha", {
      enumerable: true,
      get: () => {
        throw new Error("hostile getter");
      },
    });
    expect(prepareStudioLayerLiftMask(hostile as never)).toMatchObject({
      ok: false,
      empty: false,
      code: "invalid-mask",
    });
  });

  it("is byte-deterministic and never mutates inputs", () => {
    const model = confidence(3, 2, [0.1, 0.6, 0.9, 0.8, 0.4, 0.7]);
    const source = {
      width: 3,
      height: 2,
      alpha: Uint8ClampedArray.from([255, 200, 150, 100, 50, 25]),
    };
    const beforeConfidence = new Float32Array(model.confidence);
    const beforeAlpha = new Uint8ClampedArray(source.alpha);
    const first = prepareStudioLayerLiftMask({
      confidence: model,
      sourceAlpha: source,
      options: { threshold: 0.5, feather: 0.2 },
    });
    const second = prepareStudioLayerLiftMask({
      confidence: model,
      sourceAlpha: source,
      options: { threshold: 0.5, feather: 0.2 },
    });
    expect(first).toEqual(second);
    expect(model.confidence).toEqual(beforeConfidence);
    expect(source.alpha).toEqual(beforeAlpha);
  });
});
