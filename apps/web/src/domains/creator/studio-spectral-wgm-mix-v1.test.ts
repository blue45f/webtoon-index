import { describe, expect, it } from "vitest";

import {
  isStudioSpectralWgmColorMixProgramId,
  mixStudioSpectralWgm,
  mixStudioSpectralWgmSrgb8,
  STUDIO_SPECTRAL_WGM_B_SMALL,
  STUDIO_SPECTRAL_WGM_BAND_COUNT,
  STUDIO_SPECTRAL_WGM_COLOR_MIX_PAINT_MODE,
  STUDIO_SPECTRAL_WGM_COLOR_MIX_PROGRAM_ID,
  STUDIO_SPECTRAL_WGM_EPSILON,
  STUDIO_SPECTRAL_WGM_G_SMALL,
  STUDIO_SPECTRAL_WGM_MIX_PROVENANCE,
  STUDIO_SPECTRAL_WGM_MIX_V1_VERSION,
  STUDIO_SPECTRAL_WGM_R_SMALL,
  STUDIO_SPECTRAL_WGM_T_MATRIX_SMALL,
  studioSpectralWgmBeatsRgbLerpOnBlueYellow,
  studioSpectralWgmEffectiveFactors,
  studioSpectralWgmRgbToSpectral,
  studioSpectralWgmSpectralToRgb,
} from "./studio-spectral-wgm-mix-v1";

const BLUE = { r: 0, g: 33 / 255, b: 133 / 255 } as const;
const YELLOW = { r: 252 / 255, g: 211 / 255, b: 0 } as const;

function hueDegrees(color: { r: number; g: number; b: number }): number {
  const max = Math.max(color.r, color.g, color.b);
  const min = Math.min(color.r, color.g, color.b);
  const delta = max - min;
  if (delta < 1e-9) return 0;
  let hue: number;
  if (max === color.r) hue = ((color.g - color.b) / delta) % 6;
  else if (max === color.g) hue = (color.b - color.r) / delta + 2;
  else hue = (color.r - color.g) / delta + 4;
  hue *= 60;
  return hue < 0 ? hue + 360 : hue;
}

function chroma(color: { r: number; g: number; b: number }): number {
  return (
    Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b)
  );
}

describe("studio spectral WGM mix v1 (libmypaint ISC port)", () => {
  it("carries frozen ISC provenance and the upstream 10-band tables verbatim", () => {
    expect(STUDIO_SPECTRAL_WGM_MIX_V1_VERSION).toBe("studio-spectral-wgm-mix-v1");
    expect(Object.isFrozen(STUDIO_SPECTRAL_WGM_MIX_PROVENANCE)).toBe(true);
    expect(STUDIO_SPECTRAL_WGM_MIX_PROVENANCE.license).toContain("ISC");
    expect(STUDIO_SPECTRAL_WGM_EPSILON).toBe(0.001);
    expect(STUDIO_SPECTRAL_WGM_T_MATRIX_SMALL).toHaveLength(3);
    for (const row of STUDIO_SPECTRAL_WGM_T_MATRIX_SMALL) {
      expect(row).toHaveLength(STUDIO_SPECTRAL_WGM_BAND_COUNT);
    }
    for (const primary of [
      STUDIO_SPECTRAL_WGM_R_SMALL,
      STUDIO_SPECTRAL_WGM_G_SMALL,
      STUDIO_SPECTRAL_WGM_B_SMALL,
    ]) {
      expect(primary).toHaveLength(STUDIO_SPECTRAL_WGM_BAND_COUNT);
    }
    // Spot-check exact upstream helpers.c values (first/last of each table).
    expect(STUDIO_SPECTRAL_WGM_T_MATRIX_SMALL[0]![0]).toBe(0.026595621243689);
    expect(STUDIO_SPECTRAL_WGM_T_MATRIX_SMALL[2]![9]).toBe(-0.000051604594741);
    expect(STUDIO_SPECTRAL_WGM_R_SMALL[6]).toBe(0.977865045723212);
    expect(STUDIO_SPECTRAL_WGM_G_SMALL[3]).toBe(0.748259205918013);
    expect(STUDIO_SPECTRAL_WGM_B_SMALL[0]).toBe(0.537052150373386);
  });

  it("mixes blue + yellow into a green-hued pigment (70°–160°), not grey mud", () => {
    for (const factor of [0.3, 0.5, 2 / 3, 0.75]) {
      const mixed = mixStudioSpectralWgm(BLUE, YELLOW, factor, 1);
      const hue = hueDegrees(mixed);
      expect(hue).toBeGreaterThan(70);
      expect(hue).toBeLessThan(160);
      expect(mixed.g).toBeGreaterThan(mixed.r);
      expect(mixed.g).toBeGreaterThan(mixed.b);
    }
  });

  it("beats the linear-RGB lerp on blue+yellow saturation and green bias", () => {
    expect(studioSpectralWgmBeatsRgbLerpOnBlueYellow()).toBe(true);
    const wgm = mixStudioSpectralWgm(BLUE, YELLOW, 0.5, 1);
    const lerp = mixStudioSpectralWgm(BLUE, YELLOW, 0.5, 0);
    // Measured: WGM chroma ≈ 0.41 vs lerp ≈ 0.23; green bias ≈ 0.36 vs ≈ 0.10.
    expect(chroma(wgm)).toBeGreaterThan(chroma(lerp) + 0.1);
    const greenBias = (c: { r: number; g: number; b: number }) =>
      c.g - (c.r + c.b) / 2;
    expect(greenBias(wgm)).toBeGreaterThan(greenBias(lerp) + 0.15);
  });

  it("returns each endpoint at factor 1 / factor 0 (exact linear, ≤1e-3 spectral round trip)", () => {
    const colors = [
      BLUE,
      YELLOW,
      { r: 1, g: 1, b: 1 },
      { r: 0, g: 0, b: 0 },
      { r: 0.25, g: 0.5, b: 0.75 },
    ] as const;
    for (const color of colors) {
      const exactA = mixStudioSpectralWgm(color, YELLOW, 1, 0);
      expect(exactA.r).toBe(color.r);
      expect(exactA.g).toBe(color.g);
      expect(exactA.b).toBe(color.b);
      // paintMode 1 passes through the 10-band round trip; upstream tables were
      // fit so the worst 17³-sweep error measures 0.000186 — assert ≤ 1e-3.
      const spectralA = mixStudioSpectralWgm(color, YELLOW, 1, 1);
      expect(Math.abs(spectralA.r - color.r)).toBeLessThanOrEqual(1e-3);
      expect(Math.abs(spectralA.g - color.g)).toBeLessThanOrEqual(1e-3);
      expect(Math.abs(spectralA.b - color.b)).toBeLessThanOrEqual(1e-3);
      const spectralB = mixStudioSpectralWgm(BLUE, color, 0, 1);
      expect(Math.abs(spectralB.r - color.r)).toBeLessThanOrEqual(1e-3);
      expect(Math.abs(spectralB.g - color.g)).toBeLessThanOrEqual(1e-3);
      expect(Math.abs(spectralB.b - color.b)).toBeLessThanOrEqual(1e-3);
    }
  });

  it("commutes where upstream commutes: linear path and alpha channel swap exactly", () => {
    const pairs = [
      [BLUE, YELLOW],
      [{ r: 0.8, g: 0.1, b: 0.3, a: 0.4 }, { r: 0.2, g: 0.9, b: 0.6, a: 0.7 }],
      [{ r: 0.05, g: 0.05, b: 0.05 }, { r: 0.95, g: 0.95, b: 0.95 }],
    ] as const;
    for (const [a, b] of pairs) {
      for (const factor of [0, 0.25, 0.5, 0.8, 1]) {
        const forward = mixStudioSpectralWgm(a, b, factor, 0);
        const swapped = mixStudioSpectralWgm(b, a, 1 - factor, 0);
        // Linear path: a·f + b·(1−f) commutes bit-exactly in IEEE.
        expect(swapped.r).toBe(forward.r);
        expect(swapped.g).toBe(forward.g);
        expect(swapped.b).toBe(forward.b);
        expect(swapped.a).toBe(forward.a);
        // Alpha mixes linearly at every paintMode.
        const spectralSwap = mixStudioSpectralWgm(b, a, 1 - factor, 1);
        expect(spectralSwap.a).toBe(mixStudioSpectralWgm(a, b, factor, 1).a);
      }
    }
  });

  it("keeps upstream's deliberate smudge-bucket asymmetry on the spectral path", () => {
    // libmypaint weighs `a` (the bucket) by fac·αa/(αa + αb·(1−fac)) — at equal
    // opaque alphas and fac=0.5 that is 1/3, not 1/2. The port must preserve it.
    const [sfacA, sfacB] = studioSpectralWgmEffectiveFactors(0.5, 1, 1);
    expect(sfacA).toBeCloseTo(1 / 3, 12);
    expect(sfacB).toBeCloseTo(2 / 3, 12);
    // Zero bucket alpha short-circuits to the sampled color (NaN guard).
    const [zeroA, zeroB] = studioSpectralWgmEffectiveFactors(0.5, 0, 1);
    expect(zeroA).toBe(0);
    expect(zeroB).toBe(1);
    const forward = mixStudioSpectralWgm(BLUE, YELLOW, 0.5, 1);
    const swapped = mixStudioSpectralWgm(YELLOW, BLUE, 0.5, 1);
    // Bucket bias: the two orders intentionally differ (upstream behaviour).
    expect(Math.abs(swapped.g - forward.g)).toBeGreaterThan(0.01);
  });

  it("never produces NaN or out-of-range channels across a 17³ RGB sweep", () => {
    const steps = 17;
    for (let ri = 0; ri < steps; ri += 1) {
      for (let gi = 0; gi < steps; gi += 1) {
        for (let bi = 0; bi < steps; bi += 1) {
          const color = { r: ri / 16, g: gi / 16, b: bi / 16 };
          const complement = { r: 1 - color.r, g: 1 - color.g, b: 1 - color.b };
          for (const partner of [complement, { r: 1, g: 1, b: 1 }]) {
            for (const factor of [0, 0.5, 1]) {
              for (const paintMode of [0, 0.88, 1]) {
                const mixed = mixStudioSpectralWgm(color, partner, factor, paintMode);
                expect(Number.isFinite(mixed.r)).toBe(true);
                expect(Number.isFinite(mixed.g)).toBe(true);
                expect(Number.isFinite(mixed.b)).toBe(true);
                expect(Number.isFinite(mixed.a)).toBe(true);
                expect(mixed.r).toBeGreaterThanOrEqual(0);
                expect(mixed.r).toBeLessThanOrEqual(1);
                expect(mixed.g).toBeGreaterThanOrEqual(0);
                expect(mixed.g).toBeLessThanOrEqual(1);
                expect(mixed.b).toBeGreaterThanOrEqual(0);
                expect(mixed.b).toBeLessThanOrEqual(1);
                expect(mixed.a).toBeGreaterThanOrEqual(0);
                expect(mixed.a).toBeLessThanOrEqual(1);
              }
            }
          }
        }
      }
    }
  });

  it("survives degenerate inputs: zero alphas, non-finite channels, out-of-range factors", () => {
    const zeroAlpha = mixStudioSpectralWgm(
      { r: 0.3, g: 0.4, b: 0.5, a: 0 },
      { r: 0.9, g: 0.2, b: 0.1, a: 0 },
      0.5,
      1,
    );
    expect(Number.isFinite(zeroAlpha.r)).toBe(true);
    expect(zeroAlpha.a).toBe(0);
    const hostile = mixStudioSpectralWgm(
      { r: Number.NaN, g: Number.POSITIVE_INFINITY, b: -5, a: Number.NaN },
      YELLOW,
      Number.NaN,
      Number.NaN,
    );
    for (const channel of [hostile.r, hostile.g, hostile.b, hostile.a]) {
      expect(Number.isFinite(channel)).toBe(true);
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(1);
    }
    const overFactor = mixStudioSpectralWgm(BLUE, YELLOW, 7, 1);
    expect(Math.abs(overFactor.b - mixStudioSpectralWgm(BLUE, YELLOW, 1, 1).b))
      .toBeLessThanOrEqual(1e-12);
  });

  it("round-trips rgb→spectral→rgb tightly and keeps every band positive", () => {
    for (const color of [BLUE, YELLOW, { r: 0.5, g: 0.5, b: 0.5 }]) {
      const spectral = studioSpectralWgmRgbToSpectral(color.r, color.g, color.b);
      expect(spectral).toHaveLength(STUDIO_SPECTRAL_WGM_BAND_COUNT);
      for (const band of spectral) expect(band).toBeGreaterThan(0);
      const [r, g, b] = studioSpectralWgmSpectralToRgb(spectral);
      expect(Math.abs(r - color.r)).toBeLessThanOrEqual(1e-3);
      expect(Math.abs(g - color.g)).toBeLessThanOrEqual(1e-3);
      expect(Math.abs(b - color.b)).toBeLessThanOrEqual(1e-3);
    }
  });

  it("adapts 8-bit colors through the same kernel", () => {
    const mixed = mixStudioSpectralWgmSrgb8(
      { r: 0, g: 33, b: 133 },
      { r: 252, g: 211, b: 0 },
      0.5,
      1,
    );
    // Measured reference: rgb(45, 124, 19) — assert the green identity loosely
    // enough to survive rounding, tightly enough to catch a channel swap.
    expect(mixed.g).toBeGreaterThan(mixed.r + 40);
    expect(mixed.g).toBeGreaterThan(mixed.b + 40);
    expect(Number.isInteger(mixed.r)).toBe(true);
    expect(Number.isInteger(mixed.g)).toBe(true);
    expect(Number.isInteger(mixed.b)).toBe(true);
  });

  it("is deterministic call to call", () => {
    const first = mixStudioSpectralWgm(BLUE, YELLOW, 0.37, 0.88);
    const second = mixStudioSpectralWgm(BLUE, YELLOW, 0.37, 0.88);
    expect(second).toEqual(first);
  });

  it("freezes the per-dab colour program pin contract (F3 lane wiring)", () => {
    expect(STUDIO_SPECTRAL_WGM_COLOR_MIX_PROGRAM_ID).toBe("spectral-wgm-v1");
    // Pure spectral pigment character — no linear blend-back on the pinned lane.
    expect(STUDIO_SPECTRAL_WGM_COLOR_MIX_PAINT_MODE).toBe(1);
    expect(
      isStudioSpectralWgmColorMixProgramId(STUDIO_SPECTRAL_WGM_COLOR_MIX_PROGRAM_ID),
    ).toBe(true);
    for (const hostile of [
      "spectral-wgm-v2",
      "SPECTRAL-WGM-V1",
      STUDIO_SPECTRAL_WGM_MIX_V1_VERSION,
      "",
      1,
      null,
      undefined,
      {},
    ]) {
      expect(
        isStudioSpectralWgmColorMixProgramId(hostile),
        `hostile pin ${String(hostile)}`,
      ).toBe(false);
    }
  });
});
