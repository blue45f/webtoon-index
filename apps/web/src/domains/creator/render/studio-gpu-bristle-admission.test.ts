import { describe, expect, it } from "vitest";

import {
  acceptStudioGpuBristleSurface,
  measureStudioGpuBristleLuminance,
  measureStudioGpuBristleRidgeContrast,
  proveStudioGpuBristleAdmission,
  STUDIO_GPU_BRISTLE_ADMISSION_THRESHOLDS,
  STUDIO_GPU_BRISTLE_SURFACE_LIMITS,
  type StudioGpuBristleAdmissionSamples,
} from "./studio-gpu-bristle-admission";

/** A probe that clears every threshold with margin. Each test mutates exactly one field. */
const PASSING: StudioGpuBristleAdmissionSamples = {
  paperLuminanceStdDev: 6,
  probeStrokeDarkness: 42,
  untouchedLuminanceStdDev: 0.05,
  untouchedLuminance: 254.9,
  normalRidgeContrast: 1.4,
};

function surfaceRgba(
  width: number,
  height: number,
  luminanceAt: (x: number, y: number) => number,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = luminanceAt(x, y);
      const offset = (y * width + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return data;
}

describe("proveStudioGpuBristleAdmission", () => {
  it("admits a probe that clears all four thresholds", () => {
    const verdict = proveStudioGpuBristleAdmission(PASSING);
    expect(verdict.admitted).toBe(true);
    expect(verdict.reasons).toEqual([]);
    expect(verdict.message).toBe("");
  });

  it("refuses a flat paper field — the grain did not survive the resolve", () => {
    const verdict = proveStudioGpuBristleAdmission({
      ...PASSING,
      paperLuminanceStdDev:
        STUDIO_GPU_BRISTLE_ADMISSION_THRESHOLDS.minPaperLuminanceStdDev - 0.01,
    });
    expect(verdict.admitted).toBe(false);
    expect(verdict.reasons).toContain("paper-grain-flat");
  });

  it("refuses the zero-pixel / flat-stroke trap", () => {
    const verdict = proveStudioGpuBristleAdmission({ ...PASSING, probeStrokeDarkness: 0 });
    expect(verdict.admitted).toBe(false);
    expect(verdict.reasons).toContain("probe-stroke-too-faint");
  });

  it("refuses when paint appears outside the probe stroke", () => {
    expect(
      proveStudioGpuBristleAdmission({ ...PASSING, untouchedLuminanceStdDev: 3 }).reasons,
    ).toContain("untouched-region-contaminated");
    expect(
      proveStudioGpuBristleAdmission({ ...PASSING, untouchedLuminance: 240 }).reasons,
    ).toContain("untouched-region-darkened");
  });

  it("refuses a collapsed impasto relief, which no other threshold catches", () => {
    // NORMAL_SCALE collapsing leaves grain, darkness and cleanliness all green while the paint
    // reads perfectly flat. Contrast 1.0 is exactly what a shadeless resolve produces.
    const verdict = proveStudioGpuBristleAdmission({ ...PASSING, normalRidgeContrast: 1 });
    expect(verdict.admitted).toBe(false);
    expect(verdict.reasons).toEqual(["impasto-relief-flat"]);
    expect(verdict.message).toContain("임파스토");
    expect(verdict.message).toContain("다른 엔진으로 자동 전환하지 않습니다");
    expect(verdict.message).toContain("다음 획");
  });

  it("refuses rather than guesses when a statistic is not a number", () => {
    const verdict = proveStudioGpuBristleAdmission({
      ...PASSING,
      normalRidgeContrast: Number.NaN,
    });
    expect(verdict.admitted).toBe(false);
    expect(verdict.reasons).toEqual(["probe-statistics-invalid"]);
  });
});

describe("acceptStudioGpuBristleSurface", () => {
  it("accepts a normal stroke surface", () => {
    expect(acceptStudioGpuBristleSurface(512, 384).accepted).toBe(true);
  });

  it("rejects below the short-edge floor without naming a substitute", () => {
    const verdict = acceptStudioGpuBristleSurface(
      STUDIO_GPU_BRISTLE_SURFACE_LIMITS.minShortEdgePx - 1,
      512,
    );
    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toBe("surface-too-small");
    expect(verdict.message).toContain("다른 엔진으로 자동 전환하지 않습니다");
    expect(verdict.message).not.toContain("유화 캐리어");
  });

  it("declines above the pixel ceiling and above the edge ceiling", () => {
    expect(acceptStudioGpuBristleSurface(4096, 2048).reason).toBe("surface-too-large");
    expect(
      acceptStudioGpuBristleSurface(STUDIO_GPU_BRISTLE_SURFACE_LIMITS.maxEdgePx + 1, 64).reason,
    ).toBe("surface-too-large");
  });

  it("declines a non-finite or non-positive surface", () => {
    expect(acceptStudioGpuBristleSurface(Number.NaN, 100).reason).toBe("surface-invalid");
    expect(acceptStudioGpuBristleSurface(0, 100).reason).toBe("surface-invalid");
  });
});

describe("probe statistics", () => {
  it("measures mean and stddev over a region and reports NaN for an empty one", () => {
    const flat = surfaceRgba(16, 16, () => 200);
    const stats = measureStudioGpuBristleLuminance(flat, 16, 16, {
      x: 0,
      y: 0,
      width: 16,
      height: 16,
    });
    expect(stats.count).toBe(256);
    expect(stats.mean).toBeCloseTo(200, 3);
    expect(stats.stdDev).toBeCloseTo(0, 6);

    const striped = surfaceRgba(16, 16, (x) => (x % 2 === 0 ? 180 : 220));
    const stripeStats = measureStudioGpuBristleLuminance(striped, 16, 16, {
      x: 0,
      y: 0,
      width: 16,
      height: 16,
    });
    expect(stripeStats.stdDev).toBeCloseTo(20, 3);

    expect(
      measureStudioGpuBristleLuminance(flat, 16, 16, { x: 40, y: 40, width: 4, height: 4 }).count,
    ).toBe(0);
  });

  it("returns exactly 1 for a flat ridge and more than 1 for a shaded one", () => {
    const flat = surfaceRgba(16, 16, () => 128);
    expect(
      measureStudioGpuBristleRidgeContrast(
        flat,
        16,
        16,
        { x: 0, y: 4, width: 16, height: 2 },
        { x: 0, y: 10, width: 16, height: 2 },
      ),
    ).toBeCloseTo(1, 9);

    const shaded = surfaceRgba(16, 16, (_x, y) => (y < 8 ? 200 : 100));
    expect(
      measureStudioGpuBristleRidgeContrast(
        shaded,
        16,
        16,
        { x: 0, y: 4, width: 16, height: 2 },
        { x: 0, y: 10, width: 16, height: 2 },
      ),
    ).toBeCloseTo(2, 6);
  });

  it("refuses to invent a statistic from a truncated buffer", () => {
    const truncated = new Uint8ClampedArray(16);
    const stats = measureStudioGpuBristleLuminance(truncated, 16, 16, {
      x: 0,
      y: 0,
      width: 16,
      height: 16,
    });
    expect(Number.isNaN(stats.mean)).toBe(true);
  });
});
