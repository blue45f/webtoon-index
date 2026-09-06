import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  fitStudioVrmPreviewCamera,
  type StudioVrmPreviewBounds,
  type StudioVrmPreviewCamera,
} from "./studio-vrm-preview-framing";

const BOXES: readonly StudioVrmPreviewBounds[] = [
  { min: [-0.35, 0, -0.2], max: [0.35, 1.7, 0.2] },
  { min: [-1.4, 0, -0.4], max: [1.4, 1.4, 0.5] },
  { min: [2, -1, 3], max: [2.4, -0.45, 3.35] },
];
const DIRECTIONS: readonly (readonly [number, number, number])[] = [
  [0, 0.2, 3], [1.55, 0.28, 2.75], [2.8, 0.15, 0.35], [0.2, 3.4, 1.2], [0, 3, 0],
];
const DEFAULT: StudioVrmPreviewCamera = { id: "front", position: [0, 0.2, 3], target: [0, 0, 0], fov: 30 };

describe("character preview camera framing", () => {
  it.each([0.3, 0.5, 1, 1.8, 3])("keeps every corner inside the padded frame at aspect %s", (aspect) => {
    for (const bounds of BOXES) {
      for (const position of DIRECTIONS) {
        const preset = { ...DEFAULT, position };
        const fit = fitStudioVrmPreviewCamera(preset, bounds, aspect);
        expect(fit).not.toBeNull();
        if (!fit) throw new Error("Expected a valid frame");
        const camera = new THREE.PerspectiveCamera(preset.fov, aspect, 0.001, 1000);
        camera.position.set(...fit.position);
        // Exact poles need the same nonparallel up-axis fallback as the fit basis.
        if (position[0] === 0 && position[2] === 0) camera.up.set(0, 0, 1);
        camera.lookAt(...fit.target);
        camera.updateMatrixWorld(true);
        for (let corner = 0; corner < 8; corner += 1) {
          const projected = new THREE.Vector3(
            corner & 1 ? bounds.max[0] : bounds.min[0],
            corner & 2 ? bounds.max[1] : bounds.min[1],
            corner & 4 ? bounds.max[2] : bounds.min[2],
          ).project(camera);
          expect(Math.abs(projected.x)).toBeLessThanOrEqual(0.88000001);
          expect(Math.abs(projected.y)).toBeLessThanOrEqual(0.88000001);
          expect(projected.z).toBeGreaterThan(-1);
          expect(projected.z).toBeLessThan(1);
        }
      }
    }
  });

  it("centers translated bounds while preserving the requested viewing direction", () => {
    const preset = { ...DEFAULT, position: DIRECTIONS[1] };
    const fit = fitStudioVrmPreviewCamera(preset, BOXES[2], 1)!;
    expect(fit.target[0]).toBeCloseTo(2.2);
    expect(fit.target[1]).toBeCloseTo(-0.725);
    expect(fit.target[2]).toBeCloseTo(3.175);
    const actual = new THREE.Vector3(...fit.position).sub(new THREE.Vector3(...fit.target)).normalize();
    const expected = new THREE.Vector3(...preset.position).sub(new THREE.Vector3(...preset.target)).normalize();
    expect(actual.distanceTo(expected)).toBeLessThan(1e-10);
  });

  it("pulls back for wide poses on a narrow viewport", () => {
    const narrow = fitStudioVrmPreviewCamera(DEFAULT, BOXES[1], 0.4)!;
    const wide = fitStudioVrmPreviewCamera(DEFAULT, BOXES[1], 2)!;
    expect(narrow.distance).toBeGreaterThan(wide.distance);
  });

  it.each(["bust", "dramaticEye", "closeup", "overShoulder", "custom"])("preserves the authored %s crop", (id) => {
    expect(fitStudioVrmPreviewCamera({ ...DEFAULT, id }, BOXES[0], 1)).toBeNull();
  });

  it("rejects invalid bounds, lenses and aspect ratios without producing NaNs", () => {
    for (const aspect of [0, -1, NaN, Infinity]) {
      expect(fitStudioVrmPreviewCamera(DEFAULT, BOXES[0], aspect)).toBeNull();
    }
    for (const fov of [0, 1, 170, 180, NaN]) {
      expect(fitStudioVrmPreviewCamera({ ...DEFAULT, fov }, BOXES[0], 1)).toBeNull();
    }
    expect(fitStudioVrmPreviewCamera(DEFAULT, { min: [Infinity, 0, 0], max: [1, 1, 1] }, 1)).toBeNull();
    expect(fitStudioVrmPreviewCamera(DEFAULT, { min: [1, 0, 0], max: [0, 1, 1] }, 1)).toBeNull();
    expect(fitStudioVrmPreviewCamera(DEFAULT, { min: [0, 0, 0], max: [0, 0, 0] }, 1)).toBeNull();
    expect(fitStudioVrmPreviewCamera({ ...DEFAULT, position: [0, 0, 0] }, BOXES[0], 1)).toBeNull();
    expect(fitStudioVrmPreviewCamera(DEFAULT, BOXES[0], 1, 1)).toBeNull();
  });
});
