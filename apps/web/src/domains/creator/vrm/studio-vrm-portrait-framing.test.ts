import { describe, expect, it } from "vitest";

import { resolveStudioVrmPortraitBounds } from "./studio-vrm-portrait-framing";

const body = { min: [-0.5, 0, -0.2], max: [0.5, 1.8, 0.35] } as const;
const points = { head: [0, 1.55, 0], neck: [0, 1.43, 0], leftEye: [0.032, 1.64, 0.09], rightEye: [-0.032, 1.64, 0.09], chest: [0, 1.18, 0], leftUpperArm: [0.25, 1.38, 0], rightUpperArm: [-0.25, 1.38, 0] } as const;
type Vec3 = readonly [number, number, number];

describe("landmark portrait regions", () => {
  it.each(["closeup", "dramaticEye", "bust"])("follows scale and translation for %s instead of assuming a standing origin", (id) => {
    const original = resolveStudioVrmPortraitBounds(id, body, points)!;
    for (const scale of [0.2, 0.5, 1, 2, 5]) {
      const transform = (v: Vec3): Vec3 => [v[0] * scale + 3, v[1] * scale - 2, v[2] * scale + 4];
      const transformed = resolveStudioVrmPortraitBounds(id, { min: transform(body.min), max: transform(body.max) },
        Object.fromEntries(Object.entries(points).map(([key, value]) => [key, transform(value)])))!;
      for (const edge of ["min", "max"] as const) transformed[edge].forEach((value, axis) => {
        expect(value).toBeCloseTo(transform(original[edge])[axis], 9);
      });
    }
  });
  it("includes shoulders and chest for a bust without zooming all the way out", () => {
    const face = resolveStudioVrmPortraitBounds("closeup", body, points)!;
    const bust = resolveStudioVrmPortraitBounds("bust", body, points)!;
    expect(bust.min[1]).toBeLessThan(face.min[1]);
    expect(bust.max[0]).toBeGreaterThan(face.max[0]);
    expect(bust.min[1]).toBeGreaterThan(body.min[1]);
  });
  it.each(["custom", "overShoulder", "front", "fullBody"])("does not override %s", (id) => {
    expect(resolveStudioVrmPortraitBounds(id, body, points)).toBeNull();
  });
  it("fails closed for missing, stale or invalid landmarks and bounds", () => {
    expect(resolveStudioVrmPortraitBounds("closeup", body, {})).toBeNull();
    expect(resolveStudioVrmPortraitBounds("closeup", body, { head: [99, 99, 99] })).toBeNull();
    expect(resolveStudioVrmPortraitBounds("closeup", { min: [NaN, 0, 0], max: [1, 1, 1] }, points)).toBeNull();
    expect(resolveStudioVrmPortraitBounds("closeup", body, { head: [0, 1.5, 0], neck: [NaN, 1, 0] })).not.toBeNull();
  });
});
