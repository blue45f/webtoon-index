import { describe, expect, it } from "vitest";

import {
  clampStudioBg3dLightAngles,
  DEFAULT_STUDIO_BG3D_LIGHT_ANGLES,
  DEFAULT_STUDIO_BG3D_LIGHT_DIRECTION,
  normalizeStudioBg3dLightDirection,
  STUDIO_BG3D_LIGHT_AZIMUTH_MAX_DEG,
  STUDIO_BG3D_LIGHT_AZIMUTH_MIN_DEG,
  STUDIO_BG3D_LIGHT_DIRECTION_COMPONENT_MAX,
  STUDIO_BG3D_LIGHT_ELEVATION_MAX_DEG,
  STUDIO_BG3D_LIGHT_ELEVATION_MIN_DEG,
  studioBg3dLightAnglesToDirection,
  studioBg3dLightDirectionToAngles,
} from "./studio-bg3d-light-direction";

import type { StudioBg3dVec3 } from "./studio-bg3d-scene-document";

function expectDirectionClose(
  actual: StudioBg3dVec3,
  expected: StudioBg3dVec3,
  precision = 12,
): void {
  expect(actual[0]).toBeCloseTo(expected[0], precision);
  expect(actual[1]).toBeCloseTo(expected[1], precision);
  expect(actual[2]).toBeCloseTo(expected[2], precision);
  expect(Math.hypot(...actual)).toBeCloseTo(1, precision);
}

describe("normalizeStudioBg3dLightDirection", () => {
  it("normalizes the current key/fill-style vectors into finite unit directions", () => {
    expectDirectionClose(
      normalizeStudioBg3dLightDirection([4, 6, 4]),
      [4 / Math.sqrt(68), 6 / Math.sqrt(68), 4 / Math.sqrt(68)],
    );
    expectDirectionClose(
      normalizeStudioBg3dLightDirection([-4, 3, -3]),
      [-4 / Math.sqrt(34), 3 / Math.sqrt(34), -3 / Math.sqrt(34)],
    );
  });

  it("uses the SceneDocument component ceiling before normalization", () => {
    const normalized = normalizeStudioBg3dLightDirection([
      Number.MAX_VALUE,
      STUDIO_BG3D_LIGHT_DIRECTION_COMPONENT_MAX,
      0,
    ]);
    expectDirectionClose(normalized, [Math.SQRT1_2, Math.SQRT1_2, 0]);
  });

  it("falls back safely for zero, malformed, and non-finite vectors", () => {
    const fallback = [4, 6, 4] as const;
    const expectedFallback = normalizeStudioBg3dLightDirection(fallback);
    expectDirectionClose(normalizeStudioBg3dLightDirection([0, 0, 0], fallback), expectedFallback);
    expectDirectionClose(normalizeStudioBg3dLightDirection(null, fallback), expectedFallback);

    const partiallyMalformed = normalizeStudioBg3dLightDirection([Number.NaN, 2, 3], fallback);
    expectDirectionClose(
      partiallyMalformed,
      normalizeStudioBg3dLightDirection([fallback[0], 2, 3]),
    );
    expect(normalizeStudioBg3dLightDirection([0, 0, 0], [0, 0, 0])).toEqual(
      DEFAULT_STUDIO_BG3D_LIGHT_DIRECTION,
    );
  });

  it("canonicalizes negative zero without mutating the source tuple", () => {
    const source = [-0, 0, 1] as const;
    const normalized = normalizeStudioBg3dLightDirection(source);
    expect(normalized).toEqual([0, 0, 1]);
    expect(Object.is(source[0], -0)).toBe(true);
  });
});

describe("clampStudioBg3dLightAngles", () => {
  it("clamps azimuth and elevation to the editor's canonical range", () => {
    expect(clampStudioBg3dLightAngles({
      azimuthDeg: 1_000,
      elevationDeg: -1_000,
    })).toEqual({
      azimuthDeg: STUDIO_BG3D_LIGHT_AZIMUTH_MAX_DEG,
      elevationDeg: STUDIO_BG3D_LIGHT_ELEVATION_MIN_DEG,
    });
    expect(clampStudioBg3dLightAngles({
      azimuthDeg: -1_000,
      elevationDeg: 1_000,
    })).toEqual({
      azimuthDeg: STUDIO_BG3D_LIGHT_AZIMUTH_MIN_DEG,
      elevationDeg: STUDIO_BG3D_LIGHT_ELEVATION_MAX_DEG,
    });
  });

  it("uses a sanitized fallback for incomplete and non-finite input", () => {
    expect(clampStudioBg3dLightAngles(
      { azimuthDeg: Number.NaN },
      { azimuthDeg: 35, elevationDeg: 25 },
    )).toEqual({ azimuthDeg: 35, elevationDeg: 25 });
    expect(clampStudioBg3dLightAngles(undefined, {
      azimuthDeg: Number.POSITIVE_INFINITY,
      elevationDeg: Number.NEGATIVE_INFINITY,
    })).toEqual(DEFAULT_STUDIO_BG3D_LIGHT_ANGLES);
  });
});

describe("studioBg3dLightAnglesToDirection", () => {
  it("matches the BG3D convention at the principal axes", () => {
    expect(studioBg3dLightAnglesToDirection({ azimuthDeg: 0, elevationDeg: 0 }))
      .toEqual([0, 0, 1]);
    expect(studioBg3dLightAnglesToDirection({ azimuthDeg: 90, elevationDeg: 0 }))
      .toEqual([1, 0, 0]);
    expect(studioBg3dLightAnglesToDirection({ azimuthDeg: 0, elevationDeg: 90 }))
      .toEqual([0, 1, 0]);
    expect(studioBg3dLightAnglesToDirection({ azimuthDeg: 0, elevationDeg: -90 }))
      .toEqual([0, -1, 0]);
  });

  it("clamps out-of-range controls and always returns a unit direction", () => {
    const clamped = studioBg3dLightAnglesToDirection({
      azimuthDeg: 900,
      elevationDeg: 120,
    });
    expectDirectionClose(clamped, [0, 1, 0]);
  });
});

describe("studioBg3dLightDirectionToAngles", () => {
  it("recovers known key/fill directions and round-trips without directional drift", () => {
    for (const source of [
      [4, 6, 4],
      [-4, 3, -3],
      [1, 0, 0],
      [0.2, -0.5, 0.8],
    ] as const) {
      const normalized = normalizeStudioBg3dLightDirection(source);
      const angles = studioBg3dLightDirectionToAngles(source);
      expectDirectionClose(studioBg3dLightAnglesToDirection(angles), normalized, 11);
    }
  });

  it("retains the fallback azimuth at vertical poles", () => {
    expect(studioBg3dLightDirectionToAngles([0, 1, 0], {
      azimuthDeg: 73,
      elevationDeg: 10,
    })).toEqual({ azimuthDeg: 73, elevationDeg: 90 });
    expect(studioBg3dLightDirectionToAngles([0, -1, 0], {
      azimuthDeg: -42,
      elevationDeg: 10,
    })).toEqual({ azimuthDeg: -42, elevationDeg: -90 });
  });

  it("canonicalizes the ±180° seam to +180°", () => {
    expect(studioBg3dLightDirectionToAngles([0, 0, -1])).toEqual({
      azimuthDeg: 180,
      elevationDeg: 0,
    });
    expectDirectionClose(
      studioBg3dLightAnglesToDirection({ azimuthDeg: -180, elevationDeg: 0 }),
      [0, 0, -1],
    );
  });
});
