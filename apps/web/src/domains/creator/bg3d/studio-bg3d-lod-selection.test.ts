import { describe, expect, it } from "vitest";

import {
  projectStudioBg3dLodDiameterCssPx,
  selectStudioBg3dLodLevel,
  type StudioBg3dLodProjectionInput,
  type StudioBg3dLodSelectionInput,
} from "./studio-bg3d-lod-selection";

const PROJECTION: StudioBg3dLodProjectionInput = {
  worldRadius: 1,
  viewDepth: 10,
  verticalProjectionScale: 2,
  viewportCssHeight: 800,
  perspective: true,
  nearPlane: 0.1,
};

const SELECTION: StudioBg3dLodSelectionInput = {
  projectedDiameterCssPx: 500,
  fallbackThresholdsCssPx: [400, 160, 64],
  lodBias: 0,
  previousLevelIndex: null,
  hysteresisRatio: 0.1,
  forceHighestDetail: false,
  offscreen: false,
  invalid: false,
};

describe("studio BG3D projected CSS-pixel LOD", () => {
  it("projects perspective diameter from FOV scale, CSS height, radius, and depth", () => {
    expect(projectStudioBg3dLodDiameterCssPx(PROJECTION)).toEqual({
      projectedDiameterCssPx: 160,
      forceHighestDetail: false,
    });

    const fov60Scale = 1 / Math.tan(Math.PI / 6);
    const fov90Scale = 1 / Math.tan(Math.PI / 4);
    const fov60 = projectStudioBg3dLodDiameterCssPx({
      ...PROJECTION,
      verticalProjectionScale: fov60Scale,
    });
    const fov90 = projectStudioBg3dLodDiameterCssPx({
      ...PROJECTION,
      verticalProjectionScale: fov90Scale,
    });
    expect(fov60?.projectedDiameterCssPx).toBeCloseTo(80 * Math.sqrt(3));
    expect(fov90?.projectedDiameterCssPx).toBeCloseTo(80);
  });

  it("tracks perspective zoom, viewport, radius, and inverse depth linearly", () => {
    const base = projectStudioBg3dLodDiameterCssPx(PROJECTION)?.projectedDiameterCssPx ?? 0;
    expect(projectStudioBg3dLodDiameterCssPx({
      ...PROJECTION,
      verticalProjectionScale: 4,
    })?.projectedDiameterCssPx).toBeCloseTo(base * 2);
    expect(projectStudioBg3dLodDiameterCssPx({
      ...PROJECTION,
      viewportCssHeight: 1_600,
    })?.projectedDiameterCssPx).toBeCloseTo(base * 2);
    expect(projectStudioBg3dLodDiameterCssPx({
      ...PROJECTION,
      worldRadius: 2,
    })?.projectedDiameterCssPx).toBeCloseTo(base * 2);
    expect(projectStudioBg3dLodDiameterCssPx({
      ...PROJECTION,
      viewDepth: 20,
    })?.projectedDiameterCssPx).toBeCloseTo(base / 2);
  });

  it("keeps orthographic coverage independent of depth while respecting camera zoom", () => {
    const near = projectStudioBg3dLodDiameterCssPx({
      ...PROJECTION,
      perspective: false,
      verticalProjectionScale: 0.01,
      viewDepth: 10,
    });
    const far = projectStudioBg3dLodDiameterCssPx({
      ...PROJECTION,
      perspective: false,
      verticalProjectionScale: -0.01,
      viewDepth: 1_000,
    });
    expect(near?.projectedDiameterCssPx).toBe(8);
    expect(far?.projectedDiameterCssPx).toBe(8);
    expect(projectStudioBg3dLodDiameterCssPx({
      ...PROJECTION,
      perspective: false,
      verticalProjectionScale: 0.02,
    })?.projectedDiameterCssPx).toBe(16);
  });

  it("forces highest detail when the sphere intersects the near plane or contains the camera", () => {
    expect(projectStudioBg3dLodDiameterCssPx({
      ...PROJECTION,
      worldRadius: 1,
      viewDepth: 1.1,
      nearPlane: 0.1,
    })?.forceHighestDetail).toBe(true);
    expect(projectStudioBg3dLodDiameterCssPx({
      ...PROJECTION,
      worldRadius: 2,
      viewDepth: 1,
    })?.forceHighestDetail).toBe(true);
    expect(projectStudioBg3dLodDiameterCssPx({
      ...PROJECTION,
      worldRadius: 1,
      viewDepth: 1.100_001,
      nearPlane: 0.1,
    })?.forceHighestDetail).toBe(false);
  });

  it("uses CSS pixels only, so backing-store DPR cannot change selection coverage", () => {
    const cssViewportHeight = 720;
    const atDpr1 = projectStudioBg3dLodDiameterCssPx({
      ...PROJECTION,
      viewportCssHeight: cssViewportHeight,
    });
    const conceptualBackingStoreHeightAtDpr3 = cssViewportHeight * 3;
    const atDpr3 = projectStudioBg3dLodDiameterCssPx({
      ...PROJECTION,
      // DPR is intentionally not an API field; retain the CSS layout height.
      viewportCssHeight: conceptualBackingStoreHeightAtDpr3 / 3,
    });
    expect(atDpr1).toEqual(atDpr3);
  });

  it("fails closed on invalid projection values and returns an immutable result", () => {
    const inputBefore = structuredClone(PROJECTION);
    const invalidOverrides: Partial<StudioBg3dLodProjectionInput>[] = [
      { worldRadius: 0 },
      { worldRadius: Number.NaN },
      { viewDepth: 0 },
      { viewDepth: Number.POSITIVE_INFINITY },
      { verticalProjectionScale: 0 },
      { verticalProjectionScale: Number.NaN },
      { viewportCssHeight: 0 },
      { viewportCssHeight: Number.NaN },
      { nearPlane: -0.1 },
      { nearPlane: Number.NaN },
    ];
    for (const override of invalidOverrides) {
      expect(projectStudioBg3dLodDiameterCssPx({ ...PROJECTION, ...override })).toBeNull();
    }
    expect(projectStudioBg3dLodDiameterCssPx({
      ...PROJECTION,
      worldRadius: Number.MAX_VALUE,
      verticalProjectionScale: Number.MAX_VALUE,
    })).toBeNull();

    const result = projectStudioBg3dLodDiameterCssPx(PROJECTION);
    expect(Object.isFrozen(result)).toBe(true);
    expect(PROJECTION).toEqual(inputBefore);
  });
});

describe("studio BG3D stable LOD selection", () => {
  it("maps strictly descending coverage thresholds from high to low detail", () => {
    for (const [diameter, expected] of [
      [500, 0],
      [400, 0],
      [399.999, 1],
      [160, 1],
      [159.999, 2],
      [64, 2],
      [63.999, 3],
      [0, 3],
    ] as const) {
      expect(selectStudioBg3dLodLevel({
        ...SELECTION,
        projectedDiameterCssPx: diameter,
      })).toBe(expected);
    }
  });

  it("uses positive bias to engage lower detail sooner and negative bias to preserve detail", () => {
    expect(selectStudioBg3dLodLevel({
      ...SELECTION,
      projectedDiameterCssPx: 500,
      lodBias: 1,
    })).toBe(1);
    expect(selectStudioBg3dLodLevel({
      ...SELECTION,
      projectedDiameterCssPx: 250,
      lodBias: -1,
    })).toBe(0);
    expect(selectStudioBg3dLodLevel({
      ...SELECTION,
      projectedDiameterCssPx: 128,
      lodBias: 1,
    })).toBe(2);
  });

  it("widens downgrade and upgrade boundaries by the hysteresis ratio", () => {
    const fromHigh = { ...SELECTION, previousLevelIndex: 0 } as const;
    expect(selectStudioBg3dLodLevel({
      ...fromHigh,
      projectedDiameterCssPx: 360,
    })).toBe(0);
    expect(selectStudioBg3dLodLevel({
      ...fromHigh,
      projectedDiameterCssPx: 359.999,
    })).toBe(1);

    const fromLow = { ...SELECTION, previousLevelIndex: 1 } as const;
    expect(selectStudioBg3dLodLevel({
      ...fromLow,
      projectedDiameterCssPx: 439.999,
    })).toBe(1);
    expect(selectStudioBg3dLodLevel({
      ...fromLow,
      projectedDiameterCssPx: 440,
    })).toBe(0);
  });

  it("crosses multiple fallback levels after large camera jumps in either direction", () => {
    expect(selectStudioBg3dLodLevel({
      ...SELECTION,
      previousLevelIndex: 0,
      projectedDiameterCssPx: 1,
    })).toBe(3);
    expect(selectStudioBg3dLodLevel({
      ...SELECTION,
      previousLevelIndex: 3,
      projectedDiameterCssPx: 1_000,
    })).toBe(0);
  });

  it("does not flap across hundreds of noisy frames inside a hysteresis band", () => {
    let level = 0;
    for (let frame = 0; frame < 1_000; frame += 1) {
      const noise = Math.sin(frame * 2.399_963) * 35;
      level = selectStudioBg3dLodLevel({
        ...SELECTION,
        previousLevelIndex: level,
        projectedDiameterCssPx: 400 + noise,
      });
      expect(level).toBe(0);
    }

    level = selectStudioBg3dLodLevel({
      ...SELECTION,
      previousLevelIndex: level,
      projectedDiameterCssPx: 350,
    });
    expect(level).toBe(1);
    for (let frame = 0; frame < 1_000; frame += 1) {
      const noise = Math.cos(frame * 1.618_034) * 35;
      level = selectStudioBg3dLodLevel({
        ...SELECTION,
        previousLevelIndex: level,
        projectedDiameterCssPx: 400 + noise,
      });
      expect(level).toBe(1);
    }
  });

  it("retains a valid previous level for offscreen, upstream-invalid, or invalid numeric frames", () => {
    const staleInputs: Partial<StudioBg3dLodSelectionInput>[] = [
      { offscreen: true },
      { invalid: true },
      { projectedDiameterCssPx: -1 },
      { projectedDiameterCssPx: Number.NaN },
      { lodBias: Number.NaN },
      { hysteresisRatio: -0.1 },
      { hysteresisRatio: 1 },
      { fallbackThresholdsCssPx: [400, 400, 64] },
      { fallbackThresholdsCssPx: [400, 500, 64] },
      { fallbackThresholdsCssPx: [400, 0, 64] },
      { fallbackThresholdsCssPx: [400, Number.NaN, 64] },
    ];
    for (const stale of staleInputs) {
      expect(selectStudioBg3dLodLevel({
        ...SELECTION,
        previousLevelIndex: 2,
        ...stale,
      })).toBe(2);
      expect(selectStudioBg3dLodLevel({
        ...SELECTION,
        previousLevelIndex: null,
        ...stale,
      })).toBe(0);
    }
  });

  it("ignores invalid previous indices and safely starts from the measured or highest level", () => {
    for (const previousLevelIndex of [-1, 1.5, 4, Number.NaN]) {
      expect(selectStudioBg3dLodLevel({
        ...SELECTION,
        previousLevelIndex,
        projectedDiameterCssPx: 100,
      })).toBe(2);
      expect(selectStudioBg3dLodLevel({
        ...SELECTION,
        previousLevelIndex,
        invalid: true,
      })).toBe(0);
    }
  });

  it("always honors force-highest and treats a no-fallback asset as level zero", () => {
    expect(selectStudioBg3dLodLevel({
      ...SELECTION,
      previousLevelIndex: 3,
      projectedDiameterCssPx: 0,
      offscreen: true,
      invalid: true,
      forceHighestDetail: true,
    })).toBe(0);
    expect(selectStudioBg3dLodLevel({
      ...SELECTION,
      fallbackThresholdsCssPx: [],
      previousLevelIndex: 99,
      projectedDiameterCssPx: Number.NaN,
    })).toBe(0);
  });

  it("does not mutate caller-owned threshold or input data", () => {
    const thresholds = [400, 160, 64];
    const input: StudioBg3dLodSelectionInput = {
      ...SELECTION,
      fallbackThresholdsCssPx: thresholds,
      previousLevelIndex: 1,
      projectedDiameterCssPx: 100,
    };
    const before = structuredClone(input);

    expect(selectStudioBg3dLodLevel(input)).toBe(2);
    expect(input).toEqual(before);
    expect(thresholds).toEqual([400, 160, 64]);
  });

  it("remains stable for extreme finite magnitudes without overflow", () => {
    expect(selectStudioBg3dLodLevel({
      ...SELECTION,
      fallbackThresholdsCssPx: [1e300, 1e100, 1],
      projectedDiameterCssPx: Number.MAX_VALUE,
      lodBias: 2_000,
      previousLevelIndex: null,
    })).toBe(3);
    expect(selectStudioBg3dLodLevel({
      ...SELECTION,
      fallbackThresholdsCssPx: [1e300, 1e100, 1],
      projectedDiameterCssPx: Number.MIN_VALUE,
      lodBias: -3_000,
      previousLevelIndex: null,
    })).toBe(0);
  });
});
