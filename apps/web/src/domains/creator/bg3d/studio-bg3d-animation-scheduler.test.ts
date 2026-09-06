import { describe, expect, it } from "vitest";

import { resolveStudioBg3dAnimationSchedule } from "./studio-bg3d-animation-scheduler";

const BASE = {
  visibleInHierarchy: true,
  inCameraFrustum: true,
  capturing: false,
  selected: false,
  targetFps: 60,
  distanceToCamera: 10,
  boundingRadius: 1,
} as const;

describe("studio-bg3d-animation-scheduler", () => {
  it("suspends hidden/offscreen work but never capture or selected editing", () => {
    expect(resolveStudioBg3dAnimationSchedule({ ...BASE, visibleInHierarchy: false }))
      .toMatchObject({ suspended: true, reason: "hidden" });
    expect(resolveStudioBg3dAnimationSchedule({ ...BASE, inCameraFrustum: false }))
      .toMatchObject({ suspended: true, reason: "offscreen" });
    expect(resolveStudioBg3dAnimationSchedule({ ...BASE, inCameraFrustum: false, capturing: true }))
      .toEqual({ suspended: false, minimumIntervalSeconds: 0, reason: "capture" });
    expect(resolveStudioBg3dAnimationSchedule({ ...BASE, inCameraFrustum: false, selected: true }))
      .toEqual({ suspended: false, minimumIntervalSeconds: 0, reason: "selected" });
  });

  it("progressively throttles far animation while respecting a lower device target", () => {
    expect(resolveStudioBg3dAnimationSchedule(BASE)).toMatchObject({ reason: "near" });
    expect(resolveStudioBg3dAnimationSchedule(BASE).minimumIntervalSeconds).toBeCloseTo(1 / 60);
    expect(resolveStudioBg3dAnimationSchedule({ ...BASE, distanceToCamera: 40 }))
      .toEqual({ suspended: false, minimumIntervalSeconds: 1 / 20, reason: "far" });
    expect(resolveStudioBg3dAnimationSchedule({ ...BASE, distanceToCamera: 100 }))
      .toEqual({ suspended: false, minimumIntervalSeconds: 1 / 10, reason: "very-far" });
    expect(resolveStudioBg3dAnimationSchedule({ ...BASE, targetFps: 15, distanceToCamera: 40 }))
      .toEqual({ suspended: false, minimumIntervalSeconds: 1 / 15, reason: "far" });
  });

  it("uses the device LOD bias to engage throttling earlier or later", () => {
    expect(resolveStudioBg3dAnimationSchedule({
      ...BASE,
      distanceToCamera: 20,
      lodBias: 1,
    }).reason).toBe("far");
    expect(resolveStudioBg3dAnimationSchedule({
      ...BASE,
      distanceToCamera: 50,
      lodBias: -1,
    }).reason).toBe("near");
    expect(resolveStudioBg3dAnimationSchedule({
      ...BASE,
      distanceToCamera: 1,
      lodBias: Number.NaN,
    }).reason).toBe("near");
  });

  it("prefers projected CSS-pixel coverage over distance while preserving the distance fallback", () => {
    expect(resolveStudioBg3dAnimationSchedule({
      ...BASE,
      distanceToCamera: 1_000,
      projectedDiameterCssPx: 100,
    }).reason).toBe("near");
    expect(resolveStudioBg3dAnimationSchedule({
      ...BASE,
      distanceToCamera: 1,
      projectedDiameterCssPx: 10,
    }).reason).toBe("very-far");
    expect(resolveStudioBg3dAnimationSchedule({
      ...BASE,
      distanceToCamera: 40,
      projectedDiameterCssPx: Number.NaN,
    }).reason).toBe("far");
  });

  it("stabilizes projected bands with hysteresis and honors LOD bias/near-plane force-high", () => {
    expect(resolveStudioBg3dAnimationSchedule({
      ...BASE,
      projectedDiameterCssPx: 52,
      previousProjectedLodReason: null,
    }).reason).toBe("far");
    expect(resolveStudioBg3dAnimationSchedule({
      ...BASE,
      projectedDiameterCssPx: 52,
      previousProjectedLodReason: "near",
    }).reason).toBe("near");
    expect(resolveStudioBg3dAnimationSchedule({
      ...BASE,
      projectedDiameterCssPx: 50,
      previousProjectedLodReason: "near",
    }).reason).toBe("far");
    expect(resolveStudioBg3dAnimationSchedule({
      ...BASE,
      projectedDiameterCssPx: 60,
      previousProjectedLodReason: "far",
    }).reason).toBe("far");
    expect(resolveStudioBg3dAnimationSchedule({
      ...BASE,
      projectedDiameterCssPx: 62,
      previousProjectedLodReason: "far",
    }).reason).toBe("near");
    expect(resolveStudioBg3dAnimationSchedule({
      ...BASE,
      projectedDiameterCssPx: 100,
      lodBias: 2,
    }).reason).toBe("far");
    expect(resolveStudioBg3dAnimationSchedule({
      ...BASE,
      projectedDiameterCssPx: 1,
      projectedForceHighestDetail: true,
      previousProjectedLodReason: "very-far",
    }).reason).toBe("near");
  });

  it("fails safely on invalid device and bounds signals", () => {
    const result = resolveStudioBg3dAnimationSchedule({
      ...BASE,
      targetFps: Number.NaN,
      distanceToCamera: Number.NaN,
      boundingRadius: 0,
    });
    expect(result).toEqual({ suspended: false, minimumIntervalSeconds: 0.1, reason: "very-far" });
  });
});
