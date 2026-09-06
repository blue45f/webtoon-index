import { describe, expect, it } from "vitest";

import {
  STUDIO_BG3D_LT_CAPTURE_MAX_EDGE,
  STUDIO_BG3D_LT_CAPTURE_MAX_HEIGHT,
  STUDIO_BG3D_LT_CAPTURE_MAX_PIXELS,
  STUDIO_BG3D_LT_CAPTURE_MIN_HEIGHT,
  resolveStudioBg3dLtCaptureSize,
  resolveStudioBg3dShotCaptureSize,
} from "./studio-bg3d-lt-capture-size";

describe("resolveStudioBg3dLtCaptureSize", () => {
  it("keeps an admitted 16:9 requested size exactly", () => {
    expect(
      resolveStudioBg3dLtCaptureSize({
        sourceWidth: 1_920,
        sourceHeight: 1_080,
        requestedHeight: 1_080,
        maxPixels: 8_294_400,
      })
    ).toEqual({
      width: 1_920,
      height: 1_080,
      pixelCount: 2_073_600,
      requestedHeight: 1_080,
      wasReduced: false,
    });
  });

  it("reduces a 4K-height request to the mobile pixel budget while preserving aspect", () => {
    const result = resolveStudioBg3dLtCaptureSize({
      sourceWidth: 1_920,
      sourceHeight: 1_080,
      requestedHeight: 4_096,
      maxPixels: 2_073_600,
    });
    expect(result).not.toBeNull();
    expect(result!.wasReduced).toBe(true);
    expect(result!.pixelCount).toBeLessThanOrEqual(2_073_600);
    expect(result!.height).toBeLessThan(4_096);
    expect(result!.width / result!.height).toBeCloseTo(16 / 9, 2);
  });

  it("obeys a tighter explicit edge cap", () => {
    const result = resolveStudioBg3dLtCaptureSize({
      sourceWidth: 4_000,
      sourceHeight: 1_000,
      requestedHeight: 1_000,
      maxPixels: 4_000_000,
      maxEdge: 2_048,
    });
    expect(result).toMatchObject({ width: 2_048, height: 512, wasReduced: true });
  });

  it("keeps an ultrawide batch capture inside the downstream 4096px PNG edge", () => {
    const result = resolveStudioBg3dLtCaptureSize({
      sourceWidth: 3_440,
      sourceHeight: 1_440,
      requestedHeight: 2_160,
      maxPixels: 8_388_608,
      maxEdge: 4_096,
    });
    expect(result).not.toBeNull();
    expect(result!.width).toBeLessThanOrEqual(4_096);
    expect(result!.height).toBeLessThanOrEqual(4_096);
    expect(result!.pixelCount).toBeLessThanOrEqual(8_388_608);
    expect(result!.wasReduced).toBe(true);
  });

  it("handles portrait and square sources deterministically", () => {
    expect(
      resolveStudioBg3dLtCaptureSize({
        sourceWidth: 900,
        sourceHeight: 1_600,
        requestedHeight: 1_600,
        maxPixels: 2_000_000,
      })
    ).toMatchObject({ width: 900, height: 1_600, wasReduced: false });
    expect(
      resolveStudioBg3dLtCaptureSize({
        sourceWidth: 1,
        sourceHeight: 1,
        requestedHeight: 1_024,
        maxPixels: 1_048_576,
      })
    ).toMatchObject({ width: 1_024, height: 1_024, wasReduced: false });
  });

  it("is frozen and never mutates its input", () => {
    const input = {
      sourceWidth: 1_600,
      sourceHeight: 900,
      requestedHeight: 720,
      maxPixels: 2_073_600,
    };
    const snapshot = { ...input };
    const result = resolveStudioBg3dLtCaptureSize(input);
    expect(input).toEqual(snapshot);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([
    { sourceWidth: 0, sourceHeight: 100, requestedHeight: 640, maxPixels: 1_000_000 },
    { sourceWidth: 100.5, sourceHeight: 100, requestedHeight: 640, maxPixels: 1_000_000 },
    { sourceWidth: 100, sourceHeight: Number.NaN, requestedHeight: 640, maxPixels: 1_000_000 },
    { sourceWidth: 100, sourceHeight: 100, requestedHeight: STUDIO_BG3D_LT_CAPTURE_MIN_HEIGHT - 1, maxPixels: 1_000_000 },
    { sourceWidth: 100, sourceHeight: 100, requestedHeight: STUDIO_BG3D_LT_CAPTURE_MAX_HEIGHT + 1, maxPixels: 1_000_000 },
    { sourceWidth: 100, sourceHeight: 100, requestedHeight: 640, maxPixels: 0 },
    { sourceWidth: 100, sourceHeight: 100, requestedHeight: 640, maxPixels: STUDIO_BG3D_LT_CAPTURE_MAX_PIXELS + 1 },
    { sourceWidth: 100, sourceHeight: 100, requestedHeight: 640, maxPixels: 1_000_000, maxEdge: STUDIO_BG3D_LT_CAPTURE_MAX_EDGE + 1 },
  ])("rejects malformed or out-of-contract input %#", (input) => {
    expect(resolveStudioBg3dLtCaptureSize(input)).toBeNull();
  });

  it("uses an explicit aspect instead of the live source aspect", () => {
    expect(
      resolveStudioBg3dLtCaptureSize({
        sourceWidth: 1_512,
        sourceHeight: 851,
        aspectRatio: 16 / 9,
        requestedHeight: 1_080,
        maxPixels: 8_294_400,
      })
    ).toEqual({
      width: 1_920,
      height: 1_080,
      pixelCount: 2_073_600,
      requestedHeight: 1_080,
      wasReduced: false,
    });
  });

  it("keeps every budget clamp when the aspect is explicit", () => {
    const pixelBudget = resolveStudioBg3dLtCaptureSize({
      sourceWidth: 1_512,
      sourceHeight: 851,
      aspectRatio: 16 / 9,
      requestedHeight: 4_096,
      maxPixels: 2_073_600,
    });
    expect(pixelBudget).not.toBeNull();
    expect(pixelBudget!.pixelCount).toBeLessThanOrEqual(2_073_600);
    expect(pixelBudget!.wasReduced).toBe(true);
    expect(pixelBudget!.width / pixelBudget!.height).toBeCloseTo(16 / 9, 2);

    const edgeBudget = resolveStudioBg3dLtCaptureSize({
      sourceWidth: 800,
      sourceHeight: 800,
      aspectRatio: 4,
      requestedHeight: 1_000,
      maxPixels: 4_000_000,
      maxEdge: 2_048,
    });
    expect(edgeBudget).toMatchObject({ width: 2_048, height: 512, wasReduced: true });

    for (const input of [
      { sourceWidth: 100, sourceHeight: 100, aspectRatio: Number.NaN, requestedHeight: 640, maxPixels: 1_000_000 },
      { sourceWidth: 100, sourceHeight: 100, aspectRatio: 0, requestedHeight: 640, maxPixels: 1_000_000 },
      { sourceWidth: 100, sourceHeight: 100, aspectRatio: -1, requestedHeight: 640, maxPixels: 1_000_000 },
      { sourceWidth: 100, sourceHeight: 100, aspectRatio: 16 / 9, requestedHeight: 255, maxPixels: 1_000_000 },
      { sourceWidth: 100, sourceHeight: 100, aspectRatio: 16 / 9, requestedHeight: 4_097, maxPixels: 1_000_000 },
      {
        sourceWidth: 100,
        sourceHeight: 100,
        aspectRatio: 16 / 9,
        requestedHeight: 640,
        maxPixels: STUDIO_BG3D_LT_CAPTURE_MAX_PIXELS + 1,
      },
      {
        sourceWidth: 100,
        sourceHeight: 100,
        aspectRatio: 16 / 9,
        requestedHeight: 640,
        maxPixels: 1_000_000,
        maxEdge: STUDIO_BG3D_LT_CAPTURE_MAX_EDGE + 1,
      },
    ]) {
      expect(resolveStudioBg3dLtCaptureSize(input)).toBeNull();
    }
  });

  it("stays byte-identical when the aspect is omitted (legacy documents)", () => {
    const legacyInputs = [
      { sourceWidth: 1_512, sourceHeight: 851, requestedHeight: 640, maxPixels: 2_073_600 },
      { sourceWidth: 1_920, sourceHeight: 1_080, requestedHeight: 1_080, maxPixels: 8_294_400 },
      { sourceWidth: 3_440, sourceHeight: 1_440, requestedHeight: 2_160, maxPixels: 8_388_608, maxEdge: 4_096 },
      { sourceWidth: 741, sourceHeight: 1_333, requestedHeight: 4_096, maxPixels: 1_234_567 },
      { sourceWidth: 1, sourceHeight: 1, requestedHeight: 1_024, maxPixels: 1_048_576 },
    ] as const;
    for (const input of legacyInputs) {
      const legacy = resolveStudioBg3dLtCaptureSize(input);
      const derived = resolveStudioBg3dLtCaptureSize({
        ...input,
        aspectRatio: input.sourceWidth / input.sourceHeight,
      });
      expect(legacy).not.toBeNull();
      expect(derived).toEqual(legacy);
    }
  });

  it("never allocates beyond either limit at difficult rounding boundaries", () => {
    for (const [sourceWidth, sourceHeight] of [
      [1_919, 1_080],
      [10_000, 3_333],
      [333, 1_000],
    ] as const) {
      const result = resolveStudioBg3dLtCaptureSize({
        sourceWidth,
        sourceHeight,
        requestedHeight: 4_096,
        maxPixels: 1_234_567,
        maxEdge: 2_049,
      });
      expect(result).not.toBeNull();
      expect(result!.pixelCount).toBeLessThanOrEqual(1_234_567);
      expect(result!.width).toBeLessThanOrEqual(2_049);
      expect(result!.height).toBeLessThanOrEqual(2_049);
    }
  });
});

describe("resolveStudioBg3dShotCaptureSize", () => {
  it("matches legacy LT capture size when export aspect is omitted", () => {
    const input = {
      sourceWidth: 1_512,
      sourceHeight: 851,
      requestedHeight: 720,
      maxPixels: 8_294_400,
    };
    expect(resolveStudioBg3dShotCaptureSize(input)).toEqual(
      resolveStudioBg3dLtCaptureSize(input),
    );
    expect(resolveStudioBg3dShotCaptureSize({
      ...input,
      exportAspectRatio: null,
    })).toEqual(resolveStudioBg3dLtCaptureSize(input));
  });

  it("fixed export aspect yields the same size for two different source viewports", () => {
    const budgets = {
      requestedHeight: 720,
      maxPixels: 8_294_400,
      maxEdge: 4_096,
      exportAspectRatio: 16 / 9,
    } as const;
    const wide = resolveStudioBg3dShotCaptureSize({
      sourceWidth: 1_512,
      sourceHeight: 851,
      ...budgets,
    });
    const portrait = resolveStudioBg3dShotCaptureSize({
      sourceWidth: 640,
      sourceHeight: 900,
      ...budgets,
    });
    expect(wide).not.toBeNull();
    expect(portrait).not.toBeNull();
    expect(wide).toEqual(portrait);
    expect(wide!.width / wide!.height).toBeCloseTo(16 / 9, 2);
  });

  it("ignores non-finite export aspects and fails closed on invalid budgets", () => {
    const base = {
      sourceWidth: 1_000,
      sourceHeight: 1_000,
      requestedHeight: 720,
      maxPixels: 2_000_000,
    };
    expect(resolveStudioBg3dShotCaptureSize({
      ...base,
      exportAspectRatio: Number.NaN,
    })).toEqual(resolveStudioBg3dLtCaptureSize(base));
    expect(resolveStudioBg3dShotCaptureSize({
      ...base,
      exportAspectRatio: 0,
    })).toEqual(resolveStudioBg3dLtCaptureSize(base));
    expect(resolveStudioBg3dShotCaptureSize({
      sourceWidth: 0,
      sourceHeight: 100,
      requestedHeight: 720,
      maxPixels: 1_000_000,
      exportAspectRatio: 16 / 9,
    })).toBeNull();
  });
});
