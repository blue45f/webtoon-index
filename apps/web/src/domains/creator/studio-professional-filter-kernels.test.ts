import { describe, expect, it } from "vitest";

import {
  applyStudioProfessionalFilter,
  normalizeStudioDifferenceOfGaussiansOptions,
  normalizeStudioDustScratchesOptions,
  normalizeStudioTileableBlurOptions,
  type StudioProfessionalRgbaImage,
} from "./studio-professional-filter-kernels";

function patternedImage(width = 9, height = 7): StudioProfessionalRgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = (x * 37 + y * 11) % 256;
      data[offset + 1] = (x * 13 + y * 41) % 256;
      data[offset + 2] = (x * 29 + y * 17) % 256;
      data[offset + 3] = (x * 31 + y * 19) % 256;
    }
  }
  return { width, height, data };
}

describe("studio professional filter kernels", () => {
  it("normalizes hostile option bags into the public bounds", () => {
    expect(normalizeStudioDifferenceOfGaussiansOptions({
      smallSigma: -1,
      largeSigma: -4,
      threshold: 999,
      strength: Number.NaN,
    })).toEqual({
      smallSigma: 0.25,
      largeSigma: 0.35,
      threshold: 64,
      strength: 12,
    });
    expect(normalizeStudioDustScratchesOptions({
      radius: 99,
      threshold: -3,
      strength: 7,
    })).toEqual({ radius: 5, threshold: 0, strength: 1 });
    expect(normalizeStudioTileableBlurOptions({
      radius: 0,
      sigma: 99,
      strength: -2,
    })).toEqual({ radius: 1, sigma: 20, strength: 0 });
  });

  it.each([
    {
      kernel: "difference-of-gaussians" as const,
      options: { smallSigma: 0.7, largeSigma: 1.8, threshold: 1, strength: 14 },
    },
    {
      kernel: "dust-scratches" as const,
      options: { radius: 1, threshold: 12, strength: 0.8 },
    },
    {
      kernel: "tileable-blur" as const,
      options: { radius: 3, sigma: 1.4, strength: 0.9 },
    },
  ])("$kernel is immutable, deterministic, visible, and alpha exact", ({ kernel, options }) => {
    const source = patternedImage();
    const before = new Uint8ClampedArray(source.data);
    const first = applyStudioProfessionalFilter({ kernel, source, options });
    const second = applyStudioProfessionalFilter({ kernel, source, options });
    expect(first.status).toBe("applied");
    expect(second.status).toBe("applied");
    expect(source.data).toEqual(before);
    if (first.status !== "applied" || second.status !== "applied") return;
    expect(first.image.data).toEqual(second.image.data);
    expect(first.image.data).not.toEqual(before);
    expect(first.alphaPolicy).toBe("preserved");
    for (let offset = 3; offset < before.length; offset += 4) {
      expect(first.image.data[offset]).toBe(before[offset]);
    }
  });

  it("color-to-alpha removes a keyed paper color without mutating the source", () => {
    const source: StudioProfessionalRgbaImage = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([
        255, 255, 255, 255,
        0, 0, 0, 180,
      ]),
    };
    const before = new Uint8ClampedArray(source.data);
    const result = applyStudioProfessionalFilter({
      kernel: "color-to-alpha",
      source,
      options: { keyColor: "#ffffff", strength: 100 },
    });
    expect(result.status).toBe("applied");
    expect(source.data).toEqual(before);
    if (result.status !== "applied") return;
    expect(result.alphaPolicy).toBe("derived");
    expect(result.image.data[3]).toBe(0);
    expect(result.image.data[7]).toBe(180);
    expect(result.changedPixelCount).toBeGreaterThan(0);
  });

  it("dust/scratches replaces an isolated defect but leaves a below-threshold variation", () => {
    const data = new Uint8ClampedArray(5 * 5 * 4);
    for (let offset = 0; offset < data.length; offset += 4) {
      data[offset] = 100;
      data[offset + 1] = 100;
      data[offset + 2] = 100;
      data[offset + 3] = 255;
    }
    data[(2 * 5 + 2) * 4] = 255;
    data[(1 * 5 + 1) * 4] = 108;
    const result = applyStudioProfessionalFilter({
      kernel: "dust-scratches",
      source: { width: 5, height: 5, data },
      options: { radius: 1, threshold: 20, strength: 1 },
    });
    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;
    expect(result.image.data[(2 * 5 + 2) * 4]).toBe(100);
    expect(result.image.data[(1 * 5 + 1) * 4]).toBe(108);
  });

  it("tileable blur samples across opposite edges instead of clamping a seam", () => {
    const source: StudioProfessionalRgbaImage = {
      width: 5,
      height: 1,
      data: new Uint8ClampedArray([
        255, 0, 0, 255,
        0, 0, 0, 255,
        0, 0, 0, 255,
        0, 0, 0, 255,
        0, 0, 0, 255,
      ]),
    };
    const result = applyStudioProfessionalFilter({
      kernel: "tileable-blur",
      source,
      options: { radius: 1, sigma: 1, strength: 1 },
    });
    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;
    expect(result.image.data[4 * 4]).toBeGreaterThan(0);
  });

  it("refuses malformed and over-budget work before creating an output", () => {
    const invalid = applyStudioProfessionalFilter({
      kernel: "tileable-blur",
      source: { width: 2, height: 2, data: new Uint8ClampedArray(3) },
      options: {},
    });
    expect(invalid).toMatchObject({ status: "refused", reason: "invalid-image" });

    const source = patternedImage(8, 8);
    const refused = applyStudioProfessionalFilter(
      {
        kernel: "difference-of-gaussians",
        source,
        options: {},
      },
      { maxPixels: 64, maxSamples: 1, maxWorkingBytes: 10_000 },
    );
    expect(refused).toMatchObject({
      status: "refused",
      reason: "budget-exceeded",
    });
    expect("image" in refused).toBe(false);
  });
});
