import { describe, expect, it } from "vitest";

import { buildGarmentParts, FALLBACK_WARDROBE_METRICS, type GarmentPart, type WardrobeMetrics } from "./studio-vrm-wardrobe";

const measuredMetrics = (): WardrobeMetrics => ({
  ...FALLBACK_WARDROBE_METRICS,
  source: "raw-rig",
  torso: {
    version: 1, source: "measured", sampleCount: 128, measuredRingCount: 5,
    rings: [
      { t: 0.05, halfWidth: 0.145, halfDepth: 0.095, centerX: 0, centerZ: 0 },
      { t: 0.25, halfWidth: 0.135, halfDepth: 0.09, centerX: 0, centerZ: 0 },
      { t: 0.5, halfWidth: 0.15, halfDepth: 0.10, centerX: 0, centerZ: 0 },
      { t: 0.75, halfWidth: 0.17, halfDepth: 0.105, centerX: 0, centerZ: 0 },
      { t: 0.95, halfWidth: 0.155, halfDepth: 0.095, centerX: 0, centerZ: 0 },
    ],
  },
});
const dot = (a: readonly number[], b: readonly number[]) => a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);
function lateralSpineParts(parts: readonly GarmentPart[]): GarmentPart[] {
  const up = FALLBACK_WARDROBE_METRICS.up;
  return parts.filter((part) => part.bone === "spine" && part.align && Math.abs(dot(part.align, up)) < 0.25);
}

describe("remaining procedural garment fit defects", () => {
  it.each(["tshirt", "shirt", "sweater", "hoodie", "blazer"])("uses two tapered shoulder bridges instead of one cross-body tube for %s", (itemId) => {
    const shoulder = lateralSpineParts(buildGarmentParts(itemId, measuredMetrics(), 1));
    expect(shoulder).toHaveLength(2);
    expect(shoulder.every((part) => part.shape.kind === "lathe")).toBe(true);
    for (const part of shoulder) {
      if (part.shape.kind !== "lathe") throw new Error("expected tapered shoulder bridge");
      expect(part.shape.profile.length).toBeGreaterThanOrEqual(4);
      expect(part.shape.profile[0].radius).toBeGreaterThan(part.shape.profile.at(-1)!.radius);
      expect(Math.abs(dot(part.offset, FALLBACK_WARDROBE_METRICS.up) - FALLBACK_WARDROBE_METRICS.spineToNeck * 0.86)).toBeLessThan(1e-6);
    }
  });

  it.each(["pants", "jeans", "wide", "scrubpants"])("seats both trouser thighs into the pelvis shell for %s", (itemId) => {
    const m = measuredMetrics();
    const thighs = buildGarmentParts(itemId, m, 1).filter((part) => part.bone === "leftUpperLeg" || part.bone === "rightUpperLeg");
    expect(thighs).toHaveLength(2);
    for (const part of thighs) {
      expect(part.shape.kind).toBe("cylinder");
      if (part.shape.kind !== "cylinder" || !part.align) throw new Error("expected upper-leg cylinder");
      const side = part.bone === "leftUpperLeg" ? "left" : "right";
      const along = dot(part.offset, part.align);
      expect(along - part.shape.h * 0.5).toBeLessThanOrEqual(0);
      expect(along + part.shape.h * 0.5).toBeGreaterThan(m.upperLeg[side].len * 0.95);
    }
  });

  it.each(["pants", "jeans", "wide", "scrubpants"])("keeps the crotch shell short enough to avoid a skirt-like thigh intersection for %s", (itemId) => {
    const m = measuredMetrics();
    const drape = buildGarmentParts(itemId, m, 1).find((part) => part.bone === "hips" && part.skinMode === "lower-body-drape");
    expect(drape?.shape.kind).toBe("lathe");
    if (!drape || drape.shape.kind !== "lathe") throw new Error("expected pelvis drape");
    const ys = drape.shape.profile.map((ring) => ring.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(m.hipsToSpine * 0.83);
  });

  it("preserves non-shrinking motion clearance at a narrow fit", () => {
    const m = measuredMetrics();
    const fitted = buildGarmentParts("tshirt", m, 0.8).find((part) => part.bone === "leftUpperArm");
    const regular = buildGarmentParts("tshirt", m, 1).find((part) => part.bone === "leftUpperArm");
    if (fitted?.shape.kind !== "cylinder" || regular?.shape.kind !== "cylinder") throw new Error("expected sleeve");
    expect(fitted.shape.rBottom / regular.shape.rBottom).toBeGreaterThan(0.8);
  });
});
