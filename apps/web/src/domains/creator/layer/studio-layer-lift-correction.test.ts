import { describe, expect, it } from "vitest";

import {
  applyStudioLayerLiftCorrectionStroke,
  applyStudioLayerLiftCorrectionStrokeInPlace,
} from "./studio-layer-lift-correction";

describe("studio layer-lift correction", () => {
  it("adds an interpolated include stroke without mutating the caller mask", () => {
    const source = new Uint8Array(12 * 6);
    const result = applyStudioLayerLiftCorrectionStroke({
      mask: source,
      width: 12,
      height: 6,
      stroke: {
        mode: "include",
        radius: 1.2,
        points: [{ x: 1, y: 3 }, { x: 10, y: 3 }],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(source.every((value) => value === 0)).toBe(true);
    expect(result.changedPixelCount).toBeGreaterThan(10);
    for (let x = 1; x <= 10; x += 1) {
      expect(result.mask[3 * 12 + x]).toBe(255);
    }
  });

  it("removes pixels in place for a private pointer-session buffer", () => {
    const mask = new Uint8Array(10 * 10).fill(255);
    const result = applyStudioLayerLiftCorrectionStrokeInPlace({
      mask,
      width: 10,
      height: 10,
      stroke: {
        mode: "exclude",
        radius: 2,
        points: [{ x: 5, y: 5 }],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mask).toBe(mask);
    expect(mask[5 * 10 + 5]).toBe(0);
    expect(mask[0]).toBe(255);
  });

  it("clips correction stamps to the raster boundary", () => {
    const result = applyStudioLayerLiftCorrectionStroke({
      mask: new Uint8Array(4 * 4),
      width: 4,
      height: 4,
      stroke: {
        mode: "include",
        radius: 3,
        points: [{ x: -1, y: -1 }],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changedPixelCount).toBeGreaterThan(0);
    expect(result.mask).toHaveLength(16);
  });

  it("fails closed for malformed dimensions, buffers, and strokes", () => {
    expect(applyStudioLayerLiftCorrectionStroke({
      mask: new Uint8Array(4),
      width: 3,
      height: 3,
      stroke: { mode: "include", radius: 1, points: [{ x: 1, y: 1 }] },
    })).toMatchObject({ ok: false, code: "invalid-mask" });
    expect(applyStudioLayerLiftCorrectionStroke({
      mask: new Uint8Array(4),
      width: 0,
      height: 4,
      stroke: { mode: "include", radius: 1, points: [{ x: 1, y: 1 }] },
    })).toMatchObject({ ok: false, code: "invalid-dimensions" });
    expect(applyStudioLayerLiftCorrectionStroke({
      mask: new Uint8Array(4),
      width: 2,
      height: 2,
      stroke: { mode: "include", radius: 0, points: [] },
    })).toMatchObject({ ok: false, code: "invalid-stroke" });
  });
});
