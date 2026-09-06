import { describe, expect, it } from "vitest";

import { readStudioPageCompositionSource } from "../studio-cuttoon-editor/read-studio-cuttoon-editor-source";


import { readStudioBg3dEditorSource } from "./read-studio-bg3d-editor-source";
import { createStudioBg3dCameraUpForDutchRoll } from "./studio-bg3d-camera-orientation";
import {
  deriveStudioBg3dVanishingPoints,
  mapStudioBg3dVanishingPointsToCanvas,
} from "./studio-bg3d-perspective-bridge";

const FRONT_CAMERA = {
  position: [0, 0, 5] as const,
  target: [0, 0, 0] as const,
  fovDegrees: 90,
  projection: "perspective" as const,
  zoom: 1,
  lensShift: [0, 0] as const,
};

const backgroundSource = readStudioBg3dEditorSource();
const studioPageSource = readStudioPageCompositionSource();

describe("studio-bg3d-perspective-bridge", () => {
  it("derives a one-point guide for a camera aligned to the world z axis", () => {
    const points = deriveStudioBg3dVanishingPoints(FRONT_CAMERA, 1000, 500);
    expect(points).toHaveLength(1);
    expect(points[0]?.axis).toBe("world-z");
    expect(points[0]?.x).toBeCloseTo(500);
    expect(points[0]?.y).toBeCloseTo(250);
  });

  it("derives three finite guide points for an oblique camera", () => {
    const points = deriveStudioBg3dVanishingPoints(
      { ...FRONT_CAMERA, position: [5, 3, 5] as const },
      1200,
      800,
    );
    expect(points.map((point) => point.axis).sort()).toEqual(["world-x", "world-y", "world-z"]);
    expect(points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
  });

  it("omits guides for orthographic and degenerate cameras", () => {
    expect(
      deriveStudioBg3dVanishingPoints({ ...FRONT_CAMERA, projection: "orthographic" }, 1000, 500),
    ).toEqual([]);
    expect(
      deriveStudioBg3dVanishingPoints({ ...FRONT_CAMERA, target: FRONT_CAMERA.position }, 1000, 500),
    ).toEqual([]);
  });

  it("uses the same lens-shift projection contract as the 3d editor", () => {
    const centered = deriveStudioBg3dVanishingPoints(FRONT_CAMERA, 1000, 500)[0];
    const shifted = deriveStudioBg3dVanishingPoints(
      { ...FRONT_CAMERA, lensShift: [0.1, -0.2] as const },
      1000,
      500,
    )[0];
    expect(shifted?.x).not.toBeCloseTo(centered?.x ?? 0);
    expect(shifted?.y).not.toBeCloseTo(centered?.y ?? 0);
  });

  it("rotates exported perspective guides with the persisted Dutch angle", () => {
    const camera = { ...FRONT_CAMERA, position: [5, 3, 5] as const };
    const up = createStudioBg3dCameraUpForDutchRoll(camera, 90);
    expect(up).not.toBeNull();
    const normal = deriveStudioBg3dVanishingPoints(camera, 1_000, 1_000);
    const rolled = deriveStudioBg3dVanishingPoints({ ...camera, up: up! }, 1_000, 1_000);
    expect(rolled.map(({ axis }) => axis)).toEqual(normal.map(({ axis }) => axis));
    for (const normalPoint of normal) {
      const rolledPoint = rolled.find(({ axis }) => axis === normalPoint.axis)!;
      const normalOffset = [normalPoint.x - 500, normalPoint.y - 500] as const;
      const rolledOffset = [rolledPoint.x - 500, rolledPoint.y - 500] as const;
      expect(Math.hypot(...rolledOffset)).toBeCloseTo(Math.hypot(...normalOffset), 7);
      expect(
        normalOffset[0] * rolledOffset[0] + normalOffset[1] * rolledOffset[1],
      ).toBeCloseTo(0, 6);
    }
  });

  it("applies perspective zoom without moving the optical center", () => {
    const camera = { ...FRONT_CAMERA, position: [5, 3, 5] as const };
    const normal = deriveStudioBg3dVanishingPoints(camera, 1200, 800);
    const zoomed = deriveStudioBg3dVanishingPoints({ ...camera, zoom: 2 }, 1200, 800);
    const normalX = normal.find((point) => point.axis === "world-x");
    const zoomedX = zoomed.find((point) => point.axis === "world-x");
    expect(Math.abs((zoomedX?.x ?? 600) - 600)).toBeCloseTo(
      Math.abs((normalX?.x ?? 600) - 600) * 2,
    );
  });

  it("maps capture coordinates into the placed Studio image bounds", () => {
    expect(
      mapStudioBg3dVanishingPointsToCanvas(
        [{ axis: "world-z", x: 500, y: 250 }],
        { x: 100, y: 200, width: 500, height: 250, sourceWidth: 1000, sourceHeight: 500 },
      ),
    ).toEqual([{ axis: "world-z", x: 350, y: 325 }]);
  });

  it("fails invalid placement geometry closed", () => {
    expect(
      mapStudioBg3dVanishingPointsToCanvas(
        [{ axis: "world-z", x: 1, y: 1 }],
        { x: 0, y: 0, width: 0, height: 100, sourceWidth: 100, sourceHeight: 100 },
      ),
    ).toEqual([]);
  });

  it("computes guides inside the lazy 3D editor and passes normalized coordinates to Studio", () => {
    expect(backgroundSource).toContain("const perspectiveGuides = deriveStudioBg3dVanishingPoints(");
    expect(backgroundSource).toContain("x: point.x / rendered.width");
    expect(backgroundSource).toContain("perspectiveGuides,");
    expect(studioPageSource).toContain("mapStudioBg3dPerspectiveGuidesToAnchor(");
    expect(studioPageSource).not.toContain('from "./studio-bg3d-perspective-bridge"');
  });
});
