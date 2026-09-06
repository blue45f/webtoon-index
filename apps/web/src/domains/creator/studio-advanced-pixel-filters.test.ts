import { describe, expect, it } from "vitest";

import {
  applyStudioClouds,
  applyStudioConvolution,
  applyStudioExposureAdjustment,
  applyStudioMorphology,
  applyStudioPixelOffset,
  applyStudioUnsharpMask,
  isIdentityStudioConvolution,
  normalizeStudioConvolution,
  normalizeStudioExposureAdjustment,
  normalizeStudioMorphology,
  normalizeStudioPixelOffset,
  normalizeStudioUnsharpMask,
} from "./studio-advanced-pixel-filters";

function image(
  width: number,
  height: number,
  pixels: readonly [number, number, number, number][],
) {
  return {
    width,
    height,
    data: new Uint8ClampedArray(pixels.flat()),
  };
}

function grayscale(values: readonly number[], alpha = 173) {
  return image(values.length, 1, values.map((value) => [value, value, value, alpha]));
}

function referenceUnsharp(
  source: ReturnType<typeof image>,
  value: { amount: number; radius: number; threshold: number },
): void {
  const { data, width, height } = source;
  const horizontal = new Uint8ClampedArray(data.length);
  const diameter = value.radius * 2 + 1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        let sum = 0;
        for (let offset = -value.radius; offset <= value.radius; offset += 1) {
          const sampleX = Math.min(width - 1, Math.max(0, x + offset));
          sum += data[(y * width + sampleX) * 4 + channel]!;
        }
        horizontal[index + channel] = sum / diameter;
      }
      horizontal[index + 3] = data[index + 3]!;
    }
  }
  const gate = (deltaAbs: number): number => {
    if (value.threshold <= 0) return 1;
    const t = (deltaAbs - value.threshold) / value.threshold;
    const bounded = t <= 0 ? 0 : t >= 1 ? 1 : t;
    return bounded * bounded * (3 - 2 * bounded);
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        let sum = 0;
        for (let offset = -value.radius; offset <= value.radius; offset += 1) {
          const sampleY = Math.min(height - 1, Math.max(0, y + offset));
          sum += horizontal[(sampleY * width + x) * 4 + channel]!;
        }
        const delta = data[index + channel]! - sum / diameter;
        const strength = gate(Math.abs(delta));
        if (strength > 0) {
          data[index + channel] = data[index + channel]! + delta * value.amount * strength;
        }
      }
    }
  }
}

describe("studio advanced pixel filter normalization", () => {
  it("clamps hostile parameters to the bounded Worker contract", () => {
    expect(normalizeStudioExposureAdjustment({ exposure: 99, gamma: 0, offset: -4 })).toEqual({
      exposure: 5,
      gamma: 0.1,
      offset: -1,
    });
    expect(normalizeStudioUnsharpMask({ amount: 99, radius: 99, threshold: -4 })).toEqual({
      amount: 3,
      radius: 5,
      threshold: 0,
    });
    expect(normalizeStudioMorphology({ mode: "unknown", radius: 99 })).toEqual({
      mode: "dilate",
      radius: 4,
    });
    expect(normalizeStudioPixelOffset({ x: Number.NaN, y: -99_999, edge: "unknown" })).toEqual({
      x: 0,
      y: -4_096,
      edge: "transparent",
    });
    expect(normalizeStudioConvolution({
      kernel: Array.from({ length: 9 }, () => 1_000),
      divisor: 0,
      bias: -999,
    })).toEqual({
      kernel: Array.from({ length: 9 }, () => 16),
      divisor: 1,
      bias: -255,
    });
  });
});

describe("studio advanced pixel filters", () => {
  it("applies exposure/gamma/offset while preserving alpha", () => {
    const source = grayscale([64, 128, 192]);
    applyStudioExposureAdjustment(source, { exposure: 1, gamma: 1, offset: 0 });
    expect(Array.from(source.data.filter((_, index) => index % 4 === 0))).toEqual([128, 255, 255]);
    expect(Array.from(source.data.filter((_, index) => index % 4 === 3))).toEqual([173, 173, 173]);
  });

  it("unsharp mask increases a hard edge and honors its threshold", () => {
    const source = grayscale([80, 100, 180, 200, 220]);
    const before = Array.from(source.data);
    applyStudioUnsharpMask(source, { amount: 1, radius: 1, threshold: 0 });
    expect(source.data[2 * 4]).toBeGreaterThan(before[2 * 4]!);
    expect(source.data[3]).toBe(173);

    const thresholded = grayscale([80, 100, 180, 200, 220]);
    applyStudioUnsharpMask(thresholded, { amount: 1, radius: 1, threshold: 255 });
    expect(Array.from(thresholded.data)).toEqual(before);
  });

  it("keeps optimized sliding-window unsharp bit-identical to the clamped reference", () => {
    for (const [width, height] of [[1, 1], [2, 5], [7, 2], [9, 6]] as const) {
      const pixels = Array.from({ length: width * height }, (_, index) => [
        (index * 71 + width * 13) % 256,
        (index * 37 + height * 29) % 256,
        (index * 113 + 17) % 256,
        (index * 19 + 101) % 256,
      ] as [number, number, number, number]);
      for (const radius of [1, 3, 5]) {
        const optimized = image(width, height, pixels);
        const expected = image(width, height, pixels);
        const params = { amount: 1.35, radius, threshold: 23 };
        applyStudioUnsharpMask(optimized, params);
        referenceUnsharp(expected, params);
        expect(Array.from(optimized.data), `${width}x${height}, radius=${radius}`)
          .toEqual(Array.from(expected.data));
      }
    }
  });

  it("dilate and erode expand RGBA extrema, including mask alpha", () => {
    const brightCenter = image(3, 3, Array.from({ length: 9 }, (_, index) => {
      const center = index === 4;
      const value = center ? 255 : 0;
      return [value, value, value, center ? 240 : 16] as [number, number, number, number];
    }));
    applyStudioMorphology(brightCenter, { mode: "dilate", radius: 1 });
    expect(Array.from(brightCenter.data.filter((_, index) => index % 4 === 0)))
      .toEqual(Array.from({ length: 9 }, () => 255));
    expect(Array.from(brightCenter.data.filter((_, index) => index % 4 === 3)))
      .toEqual(Array.from({ length: 9 }, () => 240));

    const darkCenter = image(3, 3, Array.from({ length: 9 }, (_, index) => {
      const center = index === 4;
      const value = center ? 0 : 255;
      return [value, value, value, center ? 12 : 232] as [number, number, number, number];
    }));
    applyStudioMorphology(darkCenter, { mode: "erode", radius: 1 });
    expect(Array.from(darkCenter.data.filter((_, index) => index % 4 === 0)))
      .toEqual(Array.from({ length: 9 }, () => 0));
    expect(Array.from(darkCenter.data.filter((_, index) => index % 4 === 3)))
      .toEqual(Array.from({ length: 9 }, () => 12));
  });

  it("pixel offset supports transparent and wrapping edges", () => {
    const transparent = grayscale([10, 20, 30], 255);
    applyStudioPixelOffset(transparent, { x: 1, y: 0, edge: "transparent" });
    expect(Array.from(transparent.data)).toEqual([
      0, 0, 0, 0,
      10, 10, 10, 255,
      20, 20, 20, 255,
    ]);

    const wrapped = grayscale([10, 20, 30], 255);
    applyStudioPixelOffset(wrapped, { x: 1, y: 0, edge: "wrap" });
    expect(Array.from(wrapped.data.filter((_, index) => index % 4 === 0))).toEqual([30, 10, 20]);
  });

  it("keeps identity convolution untouched and applies a bounded edge kernel", () => {
    const identity = grayscale([20, 40, 80]);
    const before = Array.from(identity.data);
    expect(isIdentityStudioConvolution({
      kernel: [0, 0, 0, 0, 1, 0, 0, 0, 0],
      divisor: 1,
      bias: 0,
    })).toBe(true);
    applyStudioConvolution(identity, {
      kernel: [0, 0, 0, 0, 1, 0, 0, 0, 0],
      divisor: 1,
      bias: 0,
    });
    expect(Array.from(identity.data)).toEqual(before);

    const edge = grayscale([20, 40, 80]);
    applyStudioConvolution(edge, {
      kernel: [0, 0, 0, -1, 1, 0, 0, 0, 0],
      divisor: 1,
      bias: 128,
    });
    expect(Array.from(edge.data)).not.toEqual(before);
    expect(edge.data[3]).toBe(173);
  });

  it("clouds are deterministic by seed and preserve alpha", () => {
    const first = grayscale(Array.from({ length: 32 }, () => 128));
    const second = grayscale(Array.from({ length: 32 }, () => 128));
    const different = grayscale(Array.from({ length: 32 }, () => 128));
    applyStudioClouds(first, { amount: 0.8, scale: 12, seed: 42, mode: "overlay" });
    applyStudioClouds(second, { amount: 0.8, scale: 12, seed: 42, mode: "overlay" });
    applyStudioClouds(different, { amount: 0.8, scale: 12, seed: 43, mode: "overlay" });
    expect(Array.from(first.data)).toEqual(Array.from(second.data));
    expect(Array.from(first.data)).not.toEqual(Array.from(different.data));
    expect(Array.from(first.data.filter((_, index) => index % 4 === 3)))
      .toEqual(Array.from({ length: 32 }, () => 173));
  });
});
