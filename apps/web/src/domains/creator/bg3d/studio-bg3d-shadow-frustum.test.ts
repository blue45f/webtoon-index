import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_BG3D_SHADOW_DEFAULT_HALF_EXTENT,
  STUDIO_BG3D_SHADOW_MAX_FAR,
  STUDIO_BG3D_SHADOW_MAX_HALF_EXTENT,
  collectStudioBg3dShadowSceneBounds,
  fitStudioBg3dDirectionalShadowFrustum,
  readStudioBg3dShadowGeometryLocalBounds,
  readStudioBg3dShadowModelLocalBounds,
  type StudioBg3dShadowBounds,
} from "./studio-bg3d-shadow-frustum";

function corners(bounds: StudioBg3dShadowBounds): THREE.Vector3[] {
  const result: THREE.Vector3[] = [];
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) {
        result.push(new THREE.Vector3(x, y, z));
      }
    }
  }
  return result;
}

describe("Studio BG3D dynamic directional-shadow frustum", () => {
  it("keeps the established small-scene texel density and normal bias", () => {
    const fit = fitStudioBg3dDirectionalShadowFrustum({
      bounds: { min: [-1, 0, -1], max: [1, 2, 1] },
      direction: [4, 8, 5],
      focus: [0, 1, 0],
      groundY: 0,
      mapSize: 1_024,
    });

    expect(fit.source).toBe("scene");
    expect(fit.left).toBe(-STUDIO_BG3D_SHADOW_DEFAULT_HALF_EXTENT);
    expect(fit.right).toBe(STUDIO_BG3D_SHADOW_DEFAULT_HALF_EXTENT);
    expect(fit.top).toBe(STUDIO_BG3D_SHADOW_DEFAULT_HALF_EXTENT);
    expect(fit.bottom).toBe(-STUDIO_BG3D_SHADOW_DEFAULT_HALF_EXTENT);
    expect(fit.worldUnitsPerTexel).toBeCloseTo(40 / 1_024, 12);
    expect(fit.normalBias).toBeCloseTo(0.025, 12);
    expect(fit.near).toBeGreaterThanOrEqual(0.1);
    expect(fit.far).toBeGreaterThan(fit.near);
  });

  it("covers every corner of a large scene with tight finite XY and depth planes", () => {
    const bounds: StudioBg3dShadowBounds = {
      min: [-320, -20, -180],
      max: [420, 260, 510],
    };
    const lightDirection = new THREE.Vector3(3, 7, -4).normalize();
    const fit = fitStudioBg3dDirectionalShadowFrustum({
      bounds,
      direction: [lightDirection.x, lightDirection.y, lightDirection.z],
      focus: [50, 10, 100],
      groundY: 0,
      mapSize: 2_048,
    });
    const camera = new THREE.OrthographicCamera(
      fit.left,
      fit.right,
      fit.top,
      fit.bottom,
      fit.near,
      fit.far,
    );
    camera.position.set(...fit.position);
    camera.up.set(...fit.cameraUp);
    camera.lookAt(new THREE.Vector3(...fit.target));
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();

    expect(fit.right).toBeGreaterThan(STUDIO_BG3D_SHADOW_DEFAULT_HALF_EXTENT);
    for (const corner of corners(bounds)) {
      const projected = corner.project(camera);
      expect(Math.abs(projected.x)).toBeLessThanOrEqual(1 + 1e-9);
      expect(Math.abs(projected.y)).toBeLessThanOrEqual(1 + 1e-9);
      expect(projected.z).toBeGreaterThanOrEqual(-1 - 1e-9);
      expect(projected.z).toBeLessThanOrEqual(1 + 1e-9);
    }
    for (const x of [bounds.min[0], bounds.max[0]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const topCorner = new THREE.Vector3(x, bounds.max[1], z);
        const receiverTravel = (topCorner.y - 0) / lightDirection.y;
        const groundReceiver = topCorner.addScaledVector(lightDirection, -receiverTravel);
        const projectedReceiver = groundReceiver.project(camera);
        expect(Math.abs(projectedReceiver.x)).toBeLessThanOrEqual(1 + 1e-9);
        expect(Math.abs(projectedReceiver.y)).toBeLessThanOrEqual(1 + 1e-9);
        expect(projectedReceiver.z).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
    expect(fit.far - fit.near).toBeLessThan(STUDIO_BG3D_SHADOW_MAX_FAR);
  });

  it("snaps the light target to shadow texels under sub-texel scene motion", () => {
    const original = fitStudioBg3dDirectionalShadowFrustum({
      bounds: { min: [-1, 0, -1], max: [1, 2, 1] },
      direction: [0, 1, 1],
      focus: [0, 1, 0],
      mapSize: 1_024,
    });
    const subTexelShift = original.worldUnitsPerTexel * 0.4;
    const shifted = fitStudioBg3dDirectionalShadowFrustum({
      bounds: {
        min: [-1 + subTexelShift, 0, -1],
        max: [1 + subTexelShift, 2, 1],
      },
      direction: [0, 1, 1],
      focus: [subTexelShift, 1, 0],
      mapSize: 1_024,
    });

    expect(shifted.target[0]).toBeCloseTo(original.target[0], 12);
    expect(shifted.left).toBe(original.left);
    expect(shifted.right).toBe(original.right);
  });

  it("fails safe for malformed bounds, focus, direction, ground, and map size", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const fit = fitStudioBg3dDirectionalShadowFrustum({
        bounds: { min: [Number.NaN, 2, 3], max: [-1, 1, 2] },
        direction: [0, 0, 0],
        focus: [Number.POSITIVE_INFINITY, 0, 0],
        groundY: Number.NEGATIVE_INFINITY,
        mapSize: Number.NaN,
      });
      const camera = new THREE.OrthographicCamera(
        fit.left,
        fit.right,
        fit.top,
        fit.bottom,
        fit.near,
        fit.far,
      );
      camera.position.set(...fit.position);
      camera.up.set(...fit.cameraUp);
      camera.lookAt(new THREE.Vector3(...fit.target));
      camera.updateMatrixWorld(true);
      camera.updateProjectionMatrix();

      expect(fit.source).toBe("fallback");
      expect(fit.clamped).toBe(true);
      expect(fit.mapSize).toBe(1_024);
      expect(fit.left).toBeLessThan(fit.right);
      expect(fit.bottom).toBeLessThan(fit.top);
      expect(fit.near).toBeGreaterThan(0);
      expect(fit.far).toBeGreaterThan(fit.near);
      expect([
        ...fit.position,
        ...fit.target,
        ...fit.cameraUp,
        fit.left,
        fit.right,
        fit.bottom,
        fit.top,
        fit.near,
        fit.far,
        fit.normalBias,
        fit.worldUnitsPerTexel,
      ].every(Number.isFinite)).toBe(true);
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it("admits hostile finite ranges without creating unbounded Three camera planes", () => {
    const fit = fitStudioBg3dDirectionalShadowFrustum({
      bounds: {
        min: [-1e12, -1e12, -1e12],
        max: [1e12, 1e12, 1e12],
      },
      direction: [1e12, 1e12, -1e12],
      focus: [1e12, -1e12, 1e12],
      mapSize: 1e12,
    });

    expect(fit.clamped).toBe(true);
    expect(fit.right).toBeLessThanOrEqual(STUDIO_BG3D_SHADOW_MAX_HALF_EXTENT);
    expect(fit.far).toBeLessThanOrEqual(STUDIO_BG3D_SHADOW_MAX_FAR);
    expect(fit.mapSize).toBe(8_192);
  });
});

describe("Studio BG3D shadow-boundary collection", () => {
  it("uses actual primitive geometry dimensions and exact repaired hierarchy transforms", () => {
    const tube = new THREE.CylinderGeometry(0.4, 0.4, 1, 24, 1, true);
    const localBounds = readStudioBg3dShadowGeometryLocalBounds(tube);
    expect(localBounds?.min[0]).toBeCloseTo(-0.4, 6);
    expect(localBounds?.max[0]).toBeCloseTo(0.4, 6);

    const unitBounds: StudioBg3dShadowBounds = {
      min: [-0.5, -0.5, -0.5],
      max: [0.5, 0.5, 0.5],
    };
    const collected = collectStudioBg3dShadowSceneBounds([
      {
        id: "parent",
        position: [10, 0, 0],
        rotation: [0, 0, 0],
        scale: [2, 1, 1],
        localBounds: unitBounds,
      },
      {
        id: "child",
        parentId: "parent",
        position: [2, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        localBounds: unitBounds,
      },
      {
        id: "hidden",
        position: [9_000, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        visible: false,
        localBounds: unitBounds,
      },
    ]);

    expect(collected.includedEntityCount).toBe(2);
    expect(collected.rejectedEntityCount).toBe(0);
    expect(collected.bounds?.min[0]).toBeCloseTo(9, 12);
    expect(collected.bounds?.max[0]).toBeCloseTo(15, 12);
    tube.dispose();
  });

  it("measures authored model pivots and keeps a deformation safety margin", () => {
    const root = new THREE.Group();
    const geometry = new THREE.BoxGeometry(2, 4, 6);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    mesh.position.x = 10;
    root.add(mesh);

    const bounds = readStudioBg3dShadowModelLocalBounds(root);
    expect(bounds?.min[0]).toBeCloseTo(8.5, 12);
    expect(bounds?.max[0]).toBeCloseTo(11.5, 12);
    expect(bounds?.min[1]).toBeCloseTo(-3, 12);
    expect(bounds?.max[2]).toBeCloseTo(4.5, 12);
    geometry.dispose();
    mesh.material.dispose();
  });
});
