import { describe, expect, it } from "vitest";

import { resolveStudioVrmInspectionBounds, STUDIO_VRM_INSPECTION_VIEWS, type StudioVrmInspectionLandmarks } from "./studio-vrm-inspection-framing";
import { CAMERA_PRESETS } from "./studio-vrm-poser-catalogs";
import { fitStudioVrmPreviewCamera } from "./studio-vrm-preview-framing";

type Vec3 = readonly [number, number, number];
const body = { min: [-0.8, 0, -0.3], max: [0.8, 1.8, 0.3] } as const;
const points: StudioVrmInspectionLandmarks = {
  hips: [0, 0.95, 0], spine: [0, 1.12, 0], chest: [0, 1.25, 0], neck: [0, 1.43, 0],
  leftUpperArm: [0.22, 1.4, 0], rightUpperArm: [-0.22, 1.4, 0],
  leftHand: [0.65, 1.2, 0], rightHand: [-0.65, 1.2, 0], leftMiddleProximal: [0.72, 1.2, 0],
  leftLowerLeg: [0.1, 0.5, 0], rightLowerLeg: [-0.1, 0.5, 0],
  leftFoot: [0.1, 0.08, 0], rightFoot: [-0.1, 0.08, 0], leftToes: [0.1, 0.03, 0.17], rightToes: [-0.1, 0.03, 0.17],
};
const crops = STUDIO_VRM_INSPECTION_VIEWS.filter((view) => view.id.startsWith("inspect"));

describe("close-up inspection framing", () => {
  it("exposes only real, uniquely identified camera presets", () => {
    expect(CAMERA_PRESETS[0]?.id).toBe("front");
    expect(new Set(CAMERA_PRESETS.map((preset) => preset.id)).size).toBe(CAMERA_PRESETS.length);
    for (const view of STUDIO_VRM_INSPECTION_VIEWS) expect(CAMERA_PRESETS.find((preset) => preset.id === view.id)?.label).toBe(view.label);
  });
  it.each(crops)("frames $id at narrow and wide viewport sizes", ({ id }) => {
    const crop = resolveStudioVrmInspectionBounds(id, body, points)!;
    const preset = CAMERA_PRESETS.find((entry) => entry.id === id)!;
    expect(crop).not.toBeNull();
    expect(crop.max[1] - crop.min[1]).toBeLessThan(1.8);
    for (const aspect of [0.35, 0.7, 1, 2.5]) expect(fitStudioVrmPreviewCamera(preset, crop, aspect)).not.toBeNull();
  });
  it.each(crops)("follows scaled and translated rigs for $id", ({ id }) => {
    const original = resolveStudioVrmInspectionBounds(id, body, points)!;
    for (const scale of [0.25, 1, 4]) {
      const transform = (value: Vec3): Vec3 => [value[0] * scale + 5, value[1] * scale - 3, value[2] * scale + 2];
      const changed = resolveStudioVrmInspectionBounds(id, { min: transform(body.min), max: transform(body.max) },
        Object.fromEntries(Object.entries(points).map(([key, value]) => [key, transform(value)])))!;
      for (const edge of ["min", "max"] as const) changed[edge].forEach((value, axis) => expect(value).toBeCloseTo(transform(original[edge])[axis], 8));
    }
  });
  it("follows a moved hand without including the opposite arm", () => {
    const changed = { ...points, leftHand: [0.4, 0.65, 0.2] as Vec3, leftMiddleProximal: [0.4, 0.58, 0.2] as Vec3 };
    const crop = resolveStudioVrmInspectionBounds("inspectLeftHand", body, changed)!;
    expect(crop.max[1]).toBeLessThan(0.8);
    expect(crop.min[0]).toBeGreaterThan(0.3);
  });
  it("does not invent missing, stale or nonfinite landmarks", () => {
    for (const { id } of crops) expect(resolveStudioVrmInspectionBounds(id, body, {})).toBeNull();
    expect(resolveStudioVrmInspectionBounds("inspectLeftHand", body, { leftHand: [99, 0, 0] })).toBeNull();
    expect(resolveStudioVrmInspectionBounds("inspectFeet", body, { ...points, leftFoot: [NaN, 0, 0] })).toBeNull();
    expect(resolveStudioVrmInspectionBounds("inspectFeet", { min: [0, 2, 0], max: [1, 1, 1] }, points)).toBeNull();
    expect(resolveStudioVrmInspectionBounds("inspectUnknown", body, points)).toBeNull();
    expect(resolveStudioVrmInspectionBounds("fullBody", body, points)).toBeNull();
  });
  it("answers null, never infinite bounds, when no landmark survives validation", () => {
    // Math.min/max over an empty point set is ±Infinity; a crop must either carry real finite edges or be absent.
    const keys = Object.keys(points) as (keyof StudioVrmInspectionLandmarks)[];
    const stale = Object.fromEntries(keys.map((key) => [key, [99, 99, 99] as Vec3]));
    const degenerate: StudioVrmInspectionLandmarks[] = [
      {}, stale,
      ...keys.map((key) => Object.fromEntries([[key, points[key]!]])),
      ...keys.map((key) => ({ ...points, [key]: [NaN, NaN, NaN] as Vec3 })),
    ];
    for (const { id } of crops) {
      for (const landmarks of degenerate) {
        const crop = resolveStudioVrmInspectionBounds(id, body, landmarks);
        if (crop === null) continue;
        for (const edge of ["min", "max"] as const) for (const value of crop[edge]) expect(Number.isFinite(value)).toBe(true);
        crop.min.forEach((value, axis) => expect(value).toBeLessThan(crop.max[axis]));
      }
    }
  });
  it("does not mutate authored landmarks", () => {
    const before = JSON.stringify(points);
    for (const { id } of crops) resolveStudioVrmInspectionBounds(id, body, points);
    expect(JSON.stringify(points)).toBe(before);
  });
});
