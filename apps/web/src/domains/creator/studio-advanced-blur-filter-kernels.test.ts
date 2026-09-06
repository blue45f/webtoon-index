import { describe, expect, it } from "vitest";

import {
  applyStudioAdvancedBlurFilter,
  applyStudioFieldIrisBlur,
  applyStudioLensBlur,
  applyStudioSelectiveGaussianBlur,
  applyStudioTiltShiftBlur,
  type StudioAdvancedBlurApplied,
  type StudioAdvancedBlurRgbaImage,
  type StudioAdvancedBlurWorkBudget,
} from "./studio-advanced-blur-filter-kernels";

function image(
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number, number],
): StudioAdvancedBlurRgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data.set(pixel(x, y), (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

function applied(
  result: ReturnType<typeof applyStudioAdvancedBlurFilter>,
): StudioAdvancedBlurApplied {
  expect(result.status).toBe("applied");
  if (result.status !== "applied") throw new Error(result.detail);
  return result;
}

function rgbAt(source: StudioAdvancedBlurRgbaImage, x: number, y: number): number[] {
  const offset = (y * source.width + x) * 4;
  return Array.from(source.data.slice(offset, offset + 3));
}

function redAt(source: StudioAdvancedBlurRgbaImage, x: number, y: number): number {
  return source.data[(y * source.width + x) * 4]!;
}

function alphaBytes(source: StudioAdvancedBlurRgbaImage): number[] {
  const values = [];
  for (let offset = 3; offset < source.data.length; offset += 4) {
    values.push(source.data[offset]!);
  }
  return values;
}

describe("advanced blur validation and budgets", () => {
  it("fails closed on malformed RGBA extents and options", () => {
    expect(applyStudioAdvancedBlurFilter({
      kernel: "lens-blur",
      source: { width: 3, height: 2, data: new Uint8ClampedArray(7) },
    })).toMatchObject({
      status: "refused",
      reason: "invalid-source",
      allocationPerformed: false,
    });

    const source = image(3, 3, () => [60, 70, 80, 255]);
    expect(applyStudioAdvancedBlurFilter({
      kernel: "lens-blur",
      source,
      options: { sampleCount: 65 },
    })).toMatchObject({
      status: "refused",
      reason: "invalid-options",
      allocationPerformed: false,
    });
    expect(applyStudioAdvancedBlurFilter({
      kernel: "field-iris-blur",
      source,
      options: { focusCenterX: Number.NaN },
    })).toMatchObject({
      status: "refused",
      reason: "invalid-options",
    });
    expect(applyStudioAdvancedBlurFilter({
      kernel: "selective-gaussian-blur",
      source,
      options: { radius: 11 },
    })).toMatchObject({
      status: "refused",
      reason: "invalid-options",
    });
  });

  it("refuses sample or memory over-budget before output allocation", () => {
    const source = image(4, 4, () => [80, 90, 100, 255]);
    const before = Array.from(source.data);
    const sampleBudget = {
      maxPixels: 16,
      maxSourceSamples: 575,
      maxWorkingBytes: 64,
    } satisfies StudioAdvancedBlurWorkBudget;
    expect(applyStudioLensBlur({
      source,
      options: { sampleCount: 9 },
    }, sampleBudget)).toMatchObject({
      status: "refused",
      reason: "budget-exceeded",
      allocationPerformed: false,
      work: {
        pixels: 16,
        samplePoints: 144,
        sourceSamples: 576,
        workingBytes: 64,
      },
    });

    const invalidBudget = {
      maxPixels: 0,
      maxSourceSamples: 1_000,
      maxWorkingBytes: 1_000,
    } satisfies StudioAdvancedBlurWorkBudget;
    expect(applyStudioLensBlur({ source }, invalidBudget)).toMatchObject({
      status: "refused",
      reason: "invalid-budget",
      allocationPerformed: false,
    });
    expect(Array.from(source.data)).toEqual(before);
  });
});

describe("lens blur", () => {
  it("uses a bounded polygon aperture with clamped edges and no opposite-edge wrap", () => {
    const source = image(9, 9, (x, y) => {
      if (x === 0 && y === 0) return [255, 80, 20, 255];
      return [0, 0, 0, 255];
    });
    const result = applied(applyStudioLensBlur({
      source,
      options: {
        radius: 3,
        sampleCount: 25,
        apertureBlades: 5,
        apertureRotationRadians: 0.2,
      },
    }));
    expect(redAt(result.image, 0, 0)).toBeLessThan(255);
    expect(redAt(result.image, 0, 0)).toBeGreaterThan(0);
    expect(redAt(result.image, 8, 8)).toBe(0);
    expect(result.work).toMatchObject({
      samplePoints: 9 * 9 * 25,
      sourceSamples: 9 * 9 * 25 * 4,
    });
  });
});

describe("spatially controlled blur", () => {
  it("keeps the iris focus center exact while progressively blurring the outside", () => {
    const source = image(9, 9, (x, y) => {
      const value = (x + y) % 2 === 0 ? 230 : 20;
      return [value, 255 - value, value, 100 + ((x * 11 + y * 7) % 155)];
    });
    const result = applied(applyStudioFieldIrisBlur({
      source,
      options: {
        focusCenterX: 0.5,
        focusCenterY: 0.5,
        focusRadius: 0.12,
        feather: 0.2,
        maximumBlurRadius: 4,
        sampleCount: 21,
        apertureBlades: 7,
      },
    }));
    expect(rgbAt(result.image, 4, 4)).toEqual(rgbAt(source, 4, 4));
    expect(rgbAt(result.image, 0, 0)).not.toEqual(rgbAt(source, 0, 0));
    expect(result.transaction.changedBounds).not.toBeNull();
  });

  it("keeps a tilt-shift focus band sharp and applies anisotropic blur away from it", () => {
    const source = image(11, 11, (x, y) => {
      const value = (x + y) % 2 === 0 ? 245 : 10;
      return [value, value, 255 - value, 80 + ((x * 13 + y * 17) % 175)];
    });
    const horizontal = applied(applyStudioTiltShiftBlur({
      source,
      options: {
        axisRadians: 0,
        focusWidth: 0.12,
        feather: 0.12,
        maximumBlurRadius: 4,
        sampleCount: 19,
      },
    }));
    expect(rgbAt(horizontal.image, 5, 5)).toEqual(rgbAt(source, 5, 5));
    expect(rgbAt(horizontal.image, 5, 0)).not.toEqual(rgbAt(source, 5, 0));

    const vertical = applied(applyStudioTiltShiftBlur({
      source,
      options: {
        axisRadians: Math.PI / 2,
        focusWidth: 0.12,
        feather: 0.12,
        maximumBlurRadius: 4,
        sampleCount: 19,
      },
    }));
    expect(horizontal.image.data).not.toEqual(vertical.image.data);
  });

  it.each([
    { width: 21, height: 11, onBandX: 14, onBandY: 9, offBandX: 14, offBandY: 5 },
    { width: 11, height: 21, onBandX: 9, onBandY: 14, offBandX: 5, offBandY: 14 },
  ])(
    "keeps a 45-degree focus band and blur direction aspect-correct at $width×$height",
    ({ width, height, onBandX, onBandY, offBandX, offBandY }) => {
      const source = image(width, height, (x, y) => {
        const value = (x + y) % 2 === 0 ? 245 : 10;
        return [value, 255 - value, value, 255];
      });
      const result = applied(applyStudioTiltShiftBlur({
        source,
        options: {
          axisRadians: Math.PI / 4,
          focusWidth: 0.04,
          feather: 0.08,
          maximumBlurRadius: 4,
          sampleCount: 19,
        },
      }));

      // Both fixtures place this sample four physical pixels along the requested 45° band.
      // Width/height-independent normalization would incorrectly classify it as out of focus.
      expect(rgbAt(result.image, onBandX, onBandY))
        .toEqual(rgbAt(source, onBandX, onBandY));
      expect(rgbAt(result.image, offBandX, offBandY))
        .not.toEqual(rgbAt(source, offBandX, offBandY));
    },
  );
});

describe("line-art preserving selective Gaussian blur", () => {
  it("smooths same-side tone variation without bleeding across a strong ink edge", () => {
    const source = image(9, 5, (x, y) => {
      if (x === 4) return [0, 0, 0, 50 + y * 40];
      if (x < 4) {
        const value = (x + y) % 2 === 0 ? 190 : 210;
        return [value, value - 5, value - 10, 80 + x * 20 + y];
      }
      const value = (x + y) % 2 === 0 ? 220 : 240;
      return [value, value, value - 5, 120 + y * 10];
    });
    const result = applied(applyStudioSelectiveGaussianBlur({
      source,
      options: {
        radius: 2,
        spatialSigma: 1.4,
        edgeThreshold: 25,
        edgeSoftness: 0,
      },
    }));
    expect(redAt(result.image, 4, 2)).toBe(0);
    expect(redAt(result.image, 3, 2)).toBeGreaterThan(150);
    expect(redAt(result.image, 1, 2)).not.toBe(redAt(source, 1, 2));
  });
});

describe("alpha, immutability, determinism, and distinctness", () => {
  it("preserves alpha bytes and source input for every advanced blur", () => {
    const source = image(7, 7, (x, y) => [
      (x * 41 + y * 19) % 256,
      (x * 17 + y * 59) % 256,
      (x * 73 + y * 11) % 256,
      20 + ((x * 29 + y * 37) % 236),
    ]);
    const before = Array.from(source.data);
    const results = [
      applied(applyStudioLensBlur({ source, options: { radius: 2, sampleCount: 13 } })),
      applied(applyStudioFieldIrisBlur({
        source,
        options: { maximumBlurRadius: 3, sampleCount: 13 },
      })),
      applied(applyStudioTiltShiftBlur({
        source,
        options: { maximumBlurRadius: 3, sampleCount: 13 },
      })),
      applied(applyStudioSelectiveGaussianBlur({
        source,
        options: { radius: 2 },
      })),
    ];
    for (const result of results) {
      expect(alphaBytes(result.image)).toEqual(alphaBytes(source));
      expect(result.alphaSemantics).toBe("preserve-source-alpha");
      expect(result.alphaPreserved).toBe(true);
    }
    expect(Array.from(source.data)).toEqual(before);
  });

  it("returns deterministic output and a content-addressed receipt", () => {
    const source = image(8, 6, (x, y) => [
      (x * 53 + y * 31) % 256,
      (x * 7 + y * 83) % 256,
      (x * 97 + y * 13) % 256,
      90 + ((x * 17 + y * 23) % 166),
    ]);
    const request = {
      source,
      options: {
        focusCenterX: 0.42,
        focusCenterY: 0.57,
        focusRadius: 0.11,
        feather: 0.28,
        maximumBlurRadius: 3.5,
        sampleCount: 17,
        apertureBlades: 6,
      },
    };
    const first = applied(applyStudioFieldIrisBlur(request));
    const second = applied(applyStudioFieldIrisBlur(request));
    expect(first.image.data).toEqual(second.image.data);
    expect(first.transaction).toEqual(second.transaction);
    expect(first.transaction.schema).toBe("toonspectrum.advanced-blur-filter/v1");
    expect(first.transaction.operationId).toMatch(/^advanced-blur-v1-[0-9a-f]{8}$/);
    expect(first.transaction.outputFingerprint).toMatch(/^[0-9a-f]{8}$/);
  });

  it("produces materially distinct outputs for all four filter models", () => {
    const source = image(13, 11, (x, y) => [
      (x * 43 + y * 71) % 256,
      (x * 101 + y * 29) % 256,
      (x * 19 + y * 113) % 256,
      70 + ((x * 11 + y * 17) % 186),
    ]);
    const results = [
      applied(applyStudioLensBlur({
        source,
        options: { radius: 3, sampleCount: 17, apertureBlades: 5 },
      })),
      applied(applyStudioFieldIrisBlur({
        source,
        options: {
          focusRadius: 0.14,
          feather: 0.2,
          maximumBlurRadius: 4,
          sampleCount: 17,
        },
      })),
      applied(applyStudioTiltShiftBlur({
        source,
        options: {
          axisRadians: 0.4,
          focusWidth: 0.17,
          feather: 0.2,
          maximumBlurRadius: 4,
          sampleCount: 17,
        },
      })),
      applied(applyStudioSelectiveGaussianBlur({
        source,
        options: {
          radius: 2,
          spatialSigma: 1.5,
          edgeThreshold: 25,
          edgeSoftness: 0.3,
        },
      })),
    ];
    expect(new Set(results.map((result) => result.transaction.operationId)).size).toBe(4);
    expect(new Set(results.map((result) => result.transaction.outputFingerprint)).size).toBe(4);
    expect(results.every((result) => result.transaction.changedPixelCount > 0)).toBe(true);
  });
});
