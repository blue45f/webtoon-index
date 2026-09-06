import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { STUDIO_BG3D_MEASUREMENT_MAX_WORLD_COORDINATE } from "./studio-bg3d-measurement";
import { readStudioBg3dMeasurementPointFromThreeEvent } from "./studio-bg3d-measurement-three-adapter";

describe("Studio BG3D Three measurement point adapter", () => {
  it("copies a finite Three world point into the renderer-independent tuple boundary", () => {
    const point = new THREE.Vector3(1.25, -2.5, 3.75);
    const admitted = readStudioBg3dMeasurementPointFromThreeEvent({ point });
    expect(admitted).toEqual([1.25, -2.5, 3.75]);
    expect(admitted).not.toBe(point);
    expect(Object.isFrozen(admitted)).toBe(true);
  });

  it("fails non-finite and out-of-world Three coordinates closed", () => {
    expect(readStudioBg3dMeasurementPointFromThreeEvent({
      point: new THREE.Vector3(Number.NaN, 0, 0),
    })).toBeNull();
    expect(readStudioBg3dMeasurementPointFromThreeEvent({
      point: new THREE.Vector3(STUDIO_BG3D_MEASUREMENT_MAX_WORLD_COORDINATE + 1, 0, 0),
    })).toBeNull();
  });
});
