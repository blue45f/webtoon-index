import { describe, expect, it } from "vitest";

import {
  analyzeStudioMoireRisk,
  denoiseStudioRgba,
  reduceStudioJpegArtifacts,
  removeStudioScreentoneArtifacts,
  type StudioToneArtifactAppliedReceipt,
  type StudioToneArtifactRgbaImage,
  type StudioToneArtifactWorkBudget,
} from "./studio-tone-artifact-filter-kernels";

function image(
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number, number],
): StudioToneArtifactRgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const rgba = pixel(x, y);
      data.set(rgba, offset);
    }
  }
  return { width, height, data };
}

function alphaBytes(source: StudioToneArtifactRgbaImage): number[] {
  return Array.from(source.data.filter((_, index) => index % 4 === 3));
}

function redAt(source: StudioToneArtifactRgbaImage, x: number, y: number): number {
  return source.data[(y * source.width + x) * 4]!;
}

function visibleBytes(source: StudioToneArtifactRgbaImage): number[] {
  const bytes: number[] = [];
  for (let offset = 0; offset < source.data.length; offset += 4) {
    bytes.push(source.data[offset + 3]!);
    if (source.data[offset + 3] !== 0) {
      bytes.push(
        source.data[offset]!,
        source.data[offset + 1]!,
        source.data[offset + 2]!,
      );
    }
  }
  return bytes;
}

function variance(values: readonly number[]): number {
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  return values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
}

function expectApplied(
  result: ReturnType<
    | typeof removeStudioScreentoneArtifacts
    | typeof reduceStudioJpegArtifacts
    | typeof denoiseStudioRgba
  >,
): StudioToneArtifactAppliedReceipt {
  expect(result.status).toBe("applied");
  if (result.status !== "applied") throw new Error(result.detail);
  return result;
}

describe("studio tone-artifact kernel contract", () => {
  it("fails closed on malformed dimensions and RGBA data", () => {
    const malformed = {
      width: 3,
      height: 2,
      data: new Uint8ClampedArray(4),
    };
    expect(removeStudioScreentoneArtifacts(malformed)).toMatchObject({
      status: "refused",
      kernel: "screentone-removal",
      reason: "invalid-image",
    });
    expect(analyzeStudioMoireRisk({
      width: Number.NaN,
      height: 2,
      data: new Uint8ClampedArray(8),
    })).toMatchObject({
      status: "refused",
      kernel: "moire-risk-analysis",
      reason: "invalid-image",
    });
    expect(denoiseStudioRgba({
      width: 1,
      height: 1,
      data: new Uint8Array(4),
    } as unknown as StudioToneArtifactRgbaImage)).toMatchObject({
      status: "refused",
      reason: "invalid-image",
    });
  });

  it("rejects malformed and exceeded budgets before allocating output", () => {
    const source = image(8, 8, () => [128, 128, 128, 255]);
    const before = Array.from(source.data);
    const invalidBudget = {
      maxPixels: 0,
      maxNeighborhoodSamples: 100,
      maxWorkingBytes: 100,
    } satisfies StudioToneArtifactWorkBudget;
    expect(denoiseStudioRgba(source, undefined, invalidBudget)).toMatchObject({
      status: "refused",
      reason: "invalid-budget",
    });

    const tinyBudget = {
      maxPixels: 63,
      maxNeighborhoodSamples: 10_000,
      maxWorkingBytes: 10_000,
    } satisfies StudioToneArtifactWorkBudget;
    expect(reduceStudioJpegArtifacts(source, undefined, tinyBudget)).toMatchObject({
      status: "refused",
      reason: "budget-exceeded",
      work: { pixels: 64 },
    });
    expect(Array.from(source.data)).toEqual(before);
  });

  it("reports operation-specific sample and memory estimates", () => {
    const source = image(4, 3, () => [128, 128, 128, 255]);
    const tone = expectApplied(removeStudioScreentoneArtifacts(source, { radius: 2 }));
    const jpeg = expectApplied(reduceStudioJpegArtifacts(source));
    const denoise = expectApplied(denoiseStudioRgba(source, { radius: 1 }));

    expect(tone.work).toMatchObject({
      pixels: 12,
      neighborhoodSamples: 300,
      workingBytes: 48,
    });
    expect(jpeg.work).toMatchObject({
      pixels: 12,
      neighborhoodSamples: 216,
      workingBytes: 96,
    });
    expect(denoise.work).toMatchObject({
      pixels: 12,
      neighborhoodSamples: 108,
      workingBytes: 48,
    });
  });
});

describe("screentone removal", () => {
  it("suppresses isolated tone dots while preserving a continuous one-pixel ink line", () => {
    const source = image(17, 17, (x, y) => {
      if (x === 8) return [18, 18, 18, 70 + (y * 11) % 186];
      const tone = x % 3 === 1 && y % 3 === 1 ? 72 : 236;
      return [tone, tone, tone, 70 + (x * 13 + y * 7) % 186];
    });
    const before = Array.from(source.data);
    const result = expectApplied(removeStudioScreentoneArtifacts(source, {
      radius: 2,
      strength: 1,
      inkLumaThreshold: 80,
    }));
    const beforeTone = [];
    const afterTone = [];
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        if (x === 8) {
          expect(redAt(result.image, x, y)).toBe(18);
        } else {
          beforeTone.push(redAt(source, x, y));
          afterTone.push(redAt(result.image, x, y));
        }
      }
    }
    expect(variance(afterTone)).toBeLessThan(variance(beforeTone));
    expect(result.changedPixelCount).toBeGreaterThan(0);
    expect(alphaBytes(result.image)).toEqual(alphaBytes(source));
    expect(Array.from(source.data)).toEqual(before);
  });

  it("leaves flat artwork bit-identical", () => {
    const source = image(7, 5, (x, y) => [143, 112, 91, 40 + x * 9 + y]);
    const result = expectApplied(removeStudioScreentoneArtifacts(source));
    expect(Array.from(result.image.data)).toEqual(Array.from(source.data));
    expect(result.changedPixelCount).toBe(0);
  });
});

describe("moire risk analysis", () => {
  it("detects repeating two-pixel phase without mutating the source", () => {
    const periodic = image(20, 20, (x, y) => {
      const value = (x + y) % 2 === 0 ? 30 : 225;
      return [value, value, value, 160 + (x % 4) * 20];
    });
    const flat = image(20, 20, () => [128, 128, 128, 255]);
    const before = Array.from(periodic.data);
    const periodicResult = analyzeStudioMoireRisk(periodic);
    const flatResult = analyzeStudioMoireRisk(flat);
    expect(periodicResult.status).toBe("analyzed");
    expect(flatResult.status).toBe("analyzed");
    if (periodicResult.status !== "analyzed" || flatResult.status !== "analyzed") return;

    expect(periodicResult.riskScore).toBeGreaterThan(0.4);
    expect(periodicResult.riskScore).toBeGreaterThan(flatResult.riskScore);
    expect(periodicResult.hotPixelRatio).toBeGreaterThan(0.4);
    expect(periodicResult.level).toBe("high");
    expect(periodicResult.dominantPeriodPx).toBe(2);
    expect(flatResult.level).toBe("low");
    expect(flatResult.dominantPeriodPx).toBeNull();
    expect(Array.from(periodic.data)).toEqual(before);
    expect(Array.from(periodicResult.heatmap.data)).not.toEqual(
      Array.from(flatResult.heatmap.data),
    );
  });

  it("is deterministic, including its heatmap and receipt metrics", () => {
    const source = image(13, 11, (x, y) => {
      const value = (x * 43 + y * 71) % 256;
      return [value, 255 - value, (value * 3) % 256, 190];
    });
    const first = analyzeStudioMoireRisk(source, { contrastThreshold: 9 });
    const second = analyzeStudioMoireRisk(source, { contrastThreshold: 9 });
    expect(first).toEqual(second);
  });
});

describe("JPEG artifact reduction", () => {
  it("softens an eight-pixel block seam but protects a true high-contrast ink edge", () => {
    const blocked = image(16, 8, (x, y) => {
      const base = x < 8 ? 108 + (y % 2) : 128 + (y % 2);
      return [base, base + 2, base - 2, 30 + x * 11 + y];
    });
    const result = expectApplied(reduceStudioJpegArtifacts(blocked, {
      deblockStrength: 1,
      deringStrength: 0,
      boundaryThreshold: 4,
      protectedEdgeThreshold: 80,
    }));
    const beforeGap = Math.abs(redAt(blocked, 7, 4) - redAt(blocked, 8, 4));
    const afterGap = Math.abs(redAt(result.image, 7, 4) - redAt(result.image, 8, 4));
    expect(afterGap).toBeLessThan(beforeGap);
    expect(alphaBytes(result.image)).toEqual(alphaBytes(blocked));

    const inkEdge = image(16, 8, (x) => {
      const value = x < 8 ? 0 : 255;
      return [value, value, value, 213];
    });
    const protectedResult = expectApplied(reduceStudioJpegArtifacts(inkEdge, {
      deblockStrength: 1,
      deringStrength: 0,
      protectedEdgeThreshold: 80,
    }));
    expect(Array.from(protectedResult.image.data)).toEqual(Array.from(inkEdge.data));
  });

  it("reduces a ringing outlier without erasing continuous dark line art", () => {
    const source = image(11, 11, (x, y) => {
      if (x === 3) return [20, 20, 20, 177];
      if (x === 7 && y === 6) return [250, 250, 250, 91];
      return [130, 130, 130, 60 + (x * 9 + y * 5) % 190];
    });
    const result = expectApplied(reduceStudioJpegArtifacts(source, {
      deblockStrength: 0,
      deringStrength: 1,
      ringingThreshold: 10,
      inkLumaThreshold: 70,
    }));
    expect(redAt(result.image, 7, 6)).toBeLessThan(redAt(source, 7, 6));
    for (let y = 0; y < source.height; y += 1) {
      expect(redAt(result.image, 3, y)).toBe(20);
    }
    expect(alphaBytes(result.image)).toEqual(alphaBytes(source));
  });
});

describe("edge-aware denoise", () => {
  it("reduces isolated noise while retaining an ink boundary and exact alpha", () => {
    const source = image(9, 9, (x, y) => {
      if (x <= 2) return [18, 18, 18, 40 + y * 9];
      if (x === 6 && y === 5) return [210, 175, 195, 121];
      const noise = ((x * 17 + y * 31) % 13) - 6;
      return [126 + noise, 128 - noise, 130 + noise, 40 + x * 15 + y];
    });
    const result = expectApplied(denoiseStudioRgba(source, {
      radius: 2,
      strength: 1,
      rangeThreshold: 160,
    }));
    expect(redAt(result.image, 6, 5)).toBeLessThan(redAt(source, 6, 5));
    expect(redAt(result.image, 1, 4)).toBeLessThan(25);
    expect(alphaBytes(result.image)).toEqual(alphaBytes(source));
    expect(result.changedPixelCount).toBeGreaterThan(0);
  });

  it("is deterministic and keeps a uniform field unchanged", () => {
    const source = image(8, 6, (x, y) => [84, 122, 166, 20 + x * 11 + y]);
    const first = expectApplied(denoiseStudioRgba(source, { radius: 3 }));
    const second = expectApplied(denoiseStudioRgba(source, { radius: 3 }));
    expect(Array.from(first.image.data)).toEqual(Array.from(source.data));
    expect(first).toEqual(second);
  });
});

describe("kernel family distinction", () => {
  it("never leaks arbitrary RGB hidden below transparent pixels into visible artwork", () => {
    const withHiddenRgb = (hidden: readonly [number, number, number]) =>
      image(17, 11, (x, y) => {
        if (x === 8 || (x === 7 && y % 3 === 0)) return [...hidden, 0];
        const block = x < 8 ? 108 : 126;
        const tone = x % 3 === 1 && y % 3 === 1 ? -42 : 0;
        const noise = ((x * 17 + y * 29) % 11) - 5;
        const value = Math.max(0, Math.min(255, block + tone + noise));
        return [value, value + 3, value - 2, 64 + (x * 9 + y * 5) % 192];
      });
    const blackHidden = withHiddenRgb([0, 0, 0]);
    const saturatedHidden = withHiddenRgb([255, 0, 241]);
    const pairs = [
      [
        expectApplied(removeStudioScreentoneArtifacts(blackHidden)),
        expectApplied(removeStudioScreentoneArtifacts(saturatedHidden)),
      ],
      [
        expectApplied(reduceStudioJpegArtifacts(blackHidden)),
        expectApplied(reduceStudioJpegArtifacts(saturatedHidden)),
      ],
      [
        expectApplied(denoiseStudioRgba(blackHidden)),
        expectApplied(denoiseStudioRgba(saturatedHidden)),
      ],
    ] as const;

    for (const [first, second] of pairs) {
      expect(visibleBytes(first.image)).toEqual(visibleBytes(second.image));
      expect(alphaBytes(first.image)).toEqual(alphaBytes(blackHidden));
      expect(alphaBytes(second.image)).toEqual(alphaBytes(saturatedHidden));
    }
  });

  it("keeps every destructive kernel deterministic for the same normalized contract", () => {
    const source = image(12, 10, (x, y) => {
      const value = (x * 37 + y * 61 + ((x + y) % 3) * 43) % 256;
      return [value, (value * 5) % 256, 255 - value, 40 + (x * 13 + y * 7) % 210];
    });
    const pairs = [
      [
        removeStudioScreentoneArtifacts(source),
        removeStudioScreentoneArtifacts(source),
      ],
      [
        reduceStudioJpegArtifacts(source),
        reduceStudioJpegArtifacts(source),
      ],
      [
        denoiseStudioRgba(source),
        denoiseStudioRgba(source),
      ],
    ] as const;
    for (const [first, second] of pairs) {
      expect(first).toEqual(second);
    }
  });

  it("produces materially different cleanup results for tone, JPEG, and sensor noise", () => {
    const source = image(16, 16, (x, y) => {
      const block = x < 8 ? 106 : 127;
      const dot = x % 3 === 1 && y % 3 === 1 ? -65 : 0;
      const noise = ((x * 19 + y * 23) % 17) - 8;
      const value = Math.max(0, Math.min(255, block + dot + noise));
      return [value, value + 2, value - 2, 180 + (x + y) % 70];
    });
    const tone = expectApplied(removeStudioScreentoneArtifacts(source));
    const jpeg = expectApplied(reduceStudioJpegArtifacts(source));
    const denoise = expectApplied(denoiseStudioRgba(source));

    expect(Array.from(tone.image.data)).not.toEqual(Array.from(jpeg.image.data));
    expect(Array.from(tone.image.data)).not.toEqual(Array.from(denoise.image.data));
    expect(Array.from(jpeg.image.data)).not.toEqual(Array.from(denoise.image.data));
    expect(alphaBytes(tone.image)).toEqual(alphaBytes(source));
    expect(alphaBytes(jpeg.image)).toEqual(alphaBytes(source));
    expect(alphaBytes(denoise.image)).toEqual(alphaBytes(source));
  });
});
