import { describe, expect, it } from "vitest";

import {
  STUDIO_BG3D_CAMERA_DEFAULT_NEAR_CLIP,
  createStudioBg3dCameraUpForDutchRoll,
  isStudioBg3dCameraNearClip,
  isStudioBg3dCameraUpVectorValid,
  normalizeStudioBg3dCameraUpVector,
  readStudioBg3dCameraDutchRollDegrees,
  resolveStudioBg3dCameraDistanceLimits,
  resolveStudioBg3dCameraNearClip,
  resolveStudioBg3dCameraUpVector,
} from "./studio-bg3d-camera-orientation";

const CAMERA = Object.freeze({
  position: [4, 3, 6] as const,
  target: [0, 0.6, 0] as const,
});

describe("Studio BG3D Camera vNext orientation", () => {
  it("uses a bounded legacy near default without accepting invalid persisted values", () => {
    expect(resolveStudioBg3dCameraNearClip(undefined)).toBe(
      STUDIO_BG3D_CAMERA_DEFAULT_NEAR_CLIP,
    );
    expect(resolveStudioBg3dCameraNearClip(Number.NaN)).toBe(
      STUDIO_BG3D_CAMERA_DEFAULT_NEAR_CLIP,
    );
    expect(isStudioBg3dCameraNearClip(0.01)).toBe(true);
    expect(isStudioBg3dCameraNearClip(50)).toBe(true);
    expect(isStudioBg3dCameraNearClip(0)).toBe(false);
    expect(isStudioBg3dCameraNearClip(50.01)).toBe(false);
  });

  it("expands far clipping and orbit reach for large authored scenes", () => {
    expect(resolveStudioBg3dCameraDistanceLimits([0, 0, 5], [0, 0, 0])).toEqual({
      farClip: 200,
      maxOrbitDistance: 60,
    });
    expect(resolveStudioBg3dCameraDistanceLimits([0, 0, 100], [0, 0, 0])).toEqual({
      farClip: 800,
      maxOrbitDistance: 400,
    });
    expect(resolveStudioBg3dCameraDistanceLimits([0, 0, 100_000], [0, 0, 0])).toEqual({
      farClip: 20_000,
      maxOrbitDistance: 10_000,
    });
  });

  it("normalizes finite up references into stable unit vectors", () => {
    const normalized = normalizeStudioBg3dCameraUpVector([0, 4, 3]);
    expect(normalized).toEqual([0, 0.8, 0.6]);
    expect(normalizeStudioBg3dCameraUpVector(normalized)).toBe(normalized);
    expect(normalizeStudioBg3dCameraUpVector([Number.NaN, 0, 0])).toEqual([0, 1, 0]);
  });

  it("repairs a vertical camera's singular world-up reference deterministically", () => {
    const vertical = {
      position: [0, 10, 0] as const,
      target: [0, 0, 0] as const,
      up: [0, 1, 0] as const,
    };
    const resolved = resolveStudioBg3dCameraUpVector(vertical);
    expect(resolved).toEqual([0, 0, 1]);
    expect(isStudioBg3dCameraUpVectorValid(resolved, vertical)).toBe(true);
    expect(isStudioBg3dCameraUpVectorValid(vertical.up, vertical)).toBe(false);
  });

  it.each([-180, -37, 0, 42, 180])(
    "round-trips an absolute %d° Dutch roll through the up vector",
    (degrees) => {
      const up = createStudioBg3dCameraUpForDutchRoll(CAMERA, degrees);
      expect(up).not.toBeNull();
      expect(isStudioBg3dCameraUpVectorValid(up, CAMERA)).toBe(true);
      const restored = readStudioBg3dCameraDutchRollDegrees({ ...CAMERA, up: up! });
      if (Math.abs(degrees) === 180) {
        expect(Math.abs(restored)).toBeCloseTo(180, 8);
      } else {
        expect(restored).toBeCloseTo(degrees, 8);
      }
    },
  );

  it("fails closed for non-finite or out-of-range Dutch roll requests", () => {
    expect(createStudioBg3dCameraUpForDutchRoll(CAMERA, Number.NaN)).toBeNull();
    expect(createStudioBg3dCameraUpForDutchRoll(CAMERA, 181)).toBeNull();
    expect(createStudioBg3dCameraUpForDutchRoll(
      { position: [0, 0, 0], target: [0, 0, 0] },
      0,
    )).toBeNull();
  });
});
