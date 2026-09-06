import { describe, expect, it } from "vitest";

import {
  fitStudioBg3dCameraToBounds,
  resolveStudioBg3dOrthographicZoom,
} from "./studio-bg3d-camera-framing";

const CAMERA = Object.freeze({
  position: [4, 3, 6] as const,
  target: [0, 0, 0] as const,
  fovDegrees: 50,
  projection: "perspective" as const,
  zoom: 1,
});

const UNIT_BOUNDS = Object.freeze({
  min: [-1, -1, -1] as const,
  max: [1, 1, 1] as const,
});

describe("Studio BG3D camera framing", () => {
  it("fits a perspective bounding sphere while preserving the camera direction and composition fields", () => {
    const result = fitStudioBg3dCameraToBounds({
      camera: {
        ...CAMERA,
        lensShift: [0.1, -0.05],
        nearClip: 0.025,
        up: [0, 0.8, 0.6],
      },
      bounds: { min: [9, 19, 29], max: [11, 21, 31] },
      viewportAspect: 16 / 9,
      padding: 1,
    });

    expect(result).not.toBeNull();
    expect(result?.target).toEqual([10, 20, 30]);
    expect(result).toMatchObject({
      fovDegrees: 50,
      projection: "perspective",
      zoom: 1,
      lensShift: [0.1, -0.05],
      nearClip: 0.025,
      up: [0, 0.8, 0.6],
    });
    const originalDirection = CAMERA.position.map((value, index) => value - CAMERA.target[index]);
    const nextDirection = result!.position.map((value, index) => value - result!.target[index]);
    const cross = [
      originalDirection[1] * nextDirection[2] - originalDirection[2] * nextDirection[1],
      originalDirection[2] * nextDirection[0] - originalDirection[0] * nextDirection[2],
      originalDirection[0] * nextDirection[1] - originalDirection[1] * nextDirection[0],
    ];
    expect(Math.hypot(...cross)).toBeCloseTo(0, 10);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result?.position)).toBe(true);
    expect(Object.isFrozen(result?.target)).toBe(true);
    expect(Object.isFrozen(result?.up)).toBe(true);
  });

  it("moves farther back for a narrow viewport and an off-centre lens shift", () => {
    const distance = (position: readonly number[], target: readonly number[]) => Math.hypot(
      position[0] - target[0],
      position[1] - target[1],
      position[2] - target[2],
    );
    const wide = fitStudioBg3dCameraToBounds({
      camera: CAMERA,
      bounds: UNIT_BOUNDS,
      viewportAspect: 16 / 9,
      padding: 1,
    });
    const narrow = fitStudioBg3dCameraToBounds({
      camera: CAMERA,
      bounds: UNIT_BOUNDS,
      viewportAspect: 9 / 16,
      padding: 1,
    });
    const shifted = fitStudioBg3dCameraToBounds({
      camera: { ...CAMERA, lensShift: [0, 0.2] },
      bounds: UNIT_BOUNDS,
      viewportAspect: 16 / 9,
      padding: 1,
    });

    expect(distance(narrow!.position, narrow!.target)).toBeGreaterThan(
      distance(wide!.position, wide!.target),
    );
    expect(distance(shifted!.position, shifted!.target)).toBeGreaterThan(
      distance(wide!.position, wide!.target),
    );
  });

  it("uses a minimum subject radius for point-like bounds and a minimum camera distance", () => {
    const result = fitStudioBg3dCameraToBounds({
      camera: { ...CAMERA, position: [0, 0, 5] },
      bounds: { min: [2, 3, 4], max: [2, 3, 4] },
      viewportAspect: 1,
      padding: 1,
      minimumRadius: 0.01,
      minDistance: 3,
    });
    expect(result?.target).toEqual([2, 3, 4]);
    expect(Math.hypot(
      result!.position[0] - result!.target[0],
      result!.position[1] - result!.target[1],
      result!.position[2] - result!.target[2],
    )).toBeCloseTo(3);
  });

  it("fits orthographic bounds from the live zoom-one frustum and preserves camera distance", () => {
    const result = fitStudioBg3dCameraToBounds({
      camera: { ...CAMERA, projection: "orthographic", zoom: 7 },
      bounds: UNIT_BOUNDS,
      viewportAspect: 2,
      orthographicFrustumAtZoomOne: { width: 20, height: 10 },
      padding: 1,
    });
    const radius = Math.sqrt(3);
    expect(result?.zoom).toBeCloseTo(10 / (radius * 2));
    expect(result?.projection).toBe("orthographic");
    expect(Math.hypot(
      result!.position[0] - result!.target[0],
      result!.position[1] - result!.target[1],
      result!.position[2] - result!.target[2],
    )).toBeCloseTo(Math.hypot(4, 3, 6));
  });

  it("moves a perspective fit beyond the persisted near plane", () => {
    const nearClip = 50;
    const result = fitStudioBg3dCameraToBounds({
      camera: { ...CAMERA, nearClip },
      bounds: UNIT_BOUNDS,
      viewportAspect: 16 / 9,
      padding: 1,
    });

    expect(result).not.toBeNull();
    const distance = Math.hypot(
      result!.position[0] - result!.target[0],
      result!.position[1] - result!.target[1],
      result!.position[2] - result!.target[2],
    );
    expect(distance).toBeCloseTo(nearClip + Math.sqrt(3));
    expect(distance - Math.sqrt(3)).toBeGreaterThanOrEqual(nearClip);
  });

  it("moves an orthographic fit beyond the near plane without changing its fitted zoom", () => {
    const nearClip = 50;
    const result = fitStudioBg3dCameraToBounds({
      camera: { ...CAMERA, projection: "orthographic", nearClip, zoom: 7 },
      bounds: UNIT_BOUNDS,
      viewportAspect: 2,
      orthographicFrustumAtZoomOne: { width: 20, height: 10 },
      padding: 1,
    });

    expect(result).not.toBeNull();
    const radius = Math.sqrt(3);
    const distance = Math.hypot(
      result!.position[0] - result!.target[0],
      result!.position[1] - result!.target[1],
      result!.position[2] - result!.target[2],
    );
    expect(result?.zoom).toBeCloseTo(10 / (radius * 2));
    expect(distance).toBeCloseTo(nearClip + radius);
    expect(distance - radius).toBeGreaterThanOrEqual(nearClip);
  });

  it("clamps orthographic button zoom with the perspective distance-factor convention", () => {
    expect(resolveStudioBg3dOrthographicZoom({
      currentZoom: 1,
      distanceFactor: 0.82,
    })).toBeCloseTo(1 / 0.82);
    expect(resolveStudioBg3dOrthographicZoom({
      currentZoom: 1,
      distanceFactor: 1.22,
    })).toBeCloseTo(1 / 1.22);
    expect(resolveStudioBg3dOrthographicZoom({
      currentZoom: 99,
      distanceFactor: 0.05,
    })).toBe(100);
    expect(resolveStudioBg3dOrthographicZoom({
      currentZoom: 0.1,
      distanceFactor: 20,
    })).toBe(0.1);
  });

  it("fails closed when a bounded perspective fit is impossible", () => {
    expect(fitStudioBg3dCameraToBounds({
      camera: CAMERA,
      bounds: { min: [-100, -100, -100], max: [100, 100, 100] },
      viewportAspect: 1,
      maxDistance: 10,
    })).toBeNull();
    expect(fitStudioBg3dCameraToBounds({
      camera: { ...CAMERA, position: [9_999, 0, 0], target: [9_998, 0, 0] },
      bounds: { min: [9_998, -1, -1], max: [10_000, 1, 1] },
      viewportAspect: 1,
    })).toBeNull();
    expect(fitStudioBg3dCameraToBounds({
      camera: { ...CAMERA, nearClip: 50 },
      bounds: UNIT_BOUNDS,
      viewportAspect: 1,
      maxDistance: 40,
    })).toBeNull();
    expect(fitStudioBg3dCameraToBounds({
      camera: { ...CAMERA, projection: "orthographic", nearClip: 50 },
      bounds: UNIT_BOUNDS,
      viewportAspect: 1,
      orthographicFrustumAtZoomOne: { width: 20, height: 10 },
      maxDistance: 40,
    })).toBeNull();
  });

  it.each([
    ["inverted bounds", { camera: CAMERA, bounds: { min: [1, 0, 0], max: [0, 1, 1] }, viewportAspect: 1 }],
    ["non-finite bounds", { camera: CAMERA, bounds: { min: [0, 0, 0], max: [1, Number.NaN, 1] }, viewportAspect: 1 }],
    ["degenerate direction", { camera: { ...CAMERA, position: [0, 0, 0] }, bounds: UNIT_BOUNDS, viewportAspect: 1 }],
    ["invalid FOV", { camera: { ...CAMERA, fovDegrees: 180 }, bounds: UNIT_BOUNDS, viewportAspect: 1 }],
    ["invalid near plane", { camera: { ...CAMERA, nearClip: 0 }, bounds: UNIT_BOUNDS, viewportAspect: 1 }],
    ["invalid up vector", { camera: { ...CAMERA, up: [0, 0, 0] }, bounds: UNIT_BOUNDS, viewportAspect: 1 }],
    ["invalid aspect", { camera: CAMERA, bounds: UNIT_BOUNDS, viewportAspect: 0 }],
    ["unframeable lens shift", { camera: { ...CAMERA, lensShift: [0.5, 0] }, bounds: UNIT_BOUNDS, viewportAspect: 1 }],
    ["missing ortho frustum", { camera: { ...CAMERA, projection: "orthographic" }, bounds: UNIT_BOUNDS, viewportAspect: 1 }],
    ["invalid ortho frustum", { camera: { ...CAMERA, projection: "orthographic" }, bounds: UNIT_BOUNDS, viewportAspect: 1, orthographicFrustumAtZoomOne: { width: 0, height: 10 } }],
  ] as const)("rejects %s", (_label, input) => {
    expect(fitStudioBg3dCameraToBounds(input as never)).toBeNull();
  });

  it("rejects malformed orthographic zoom requests", () => {
    expect(resolveStudioBg3dOrthographicZoom({ currentZoom: Number.NaN, distanceFactor: 1 })).toBeNull();
    expect(resolveStudioBg3dOrthographicZoom({ currentZoom: 1, distanceFactor: 0 })).toBeNull();
    expect(resolveStudioBg3dOrthographicZoom({ currentZoom: 1, distanceFactor: 1, minZoom: 2, maxZoom: 1 })).toBeNull();
  });
});
