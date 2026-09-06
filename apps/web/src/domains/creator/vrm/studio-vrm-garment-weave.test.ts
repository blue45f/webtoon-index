import { describe, expect, it } from "vitest";

import { sampleStudioVrmGarmentWeave, studioVrmGarmentBumpScaleM } from "./studio-vrm-garment-weave";
import { WARDROBE_FABRICS } from "./studio-vrm-wardrobe";

describe("garment surface scale and repeat continuity", () => {
  it.each(WARDROBE_FABRICS)("keeps $id fabric relief at or below one millimeter", (fabric) => {
    const scale = studioVrmGarmentBumpScaleM(fabric);
    expect(scale).toBeGreaterThanOrEqual(0);
    expect(scale).toBeLessThanOrEqual(0.001);
    if (fabric.weaveStrength > 0) expect(scale).toBeGreaterThan(0);
    else expect(scale).toBe(0);
  });
  it.each(WARDROBE_FABRICS)("keeps both repeat boundaries continuous for $id", (fabric) => {
    for (let i = 0; i <= 128; i += 1) {
      const t = i / 128;
      expect(Math.abs(sampleStudioVrmGarmentWeave(fabric, 0, t) - sampleStudioVrmGarmentWeave(fabric, 1, t))).toBeLessThanOrEqual(1);
      expect(Math.abs(sampleStudioVrmGarmentWeave(fabric, t, 0) - sampleStudioVrmGarmentWeave(fabric, t, 1))).toBeLessThanOrEqual(1);
    }
  });
  it("preserves relative fabric character without centimeter-scale bumps", () => {
    const byId = (id: string) => WARDROBE_FABRICS.find((fabric) => fabric.id === id)!;
    expect(studioVrmGarmentBumpScaleM(byId("cotton"))).toBeCloseTo(0.00036);
    expect(studioVrmGarmentBumpScaleM(byId("knit"))).toBeCloseTo(0.00084);
    expect(studioVrmGarmentBumpScaleM(byId("steel"))).toBe(0);
  });
  it("guards invalid custom parameters without leaking NaN into textures", () => {
    const invalid = { id: "cotton", weaveFrequency: NaN, weaveStrength: Infinity } as const;
    expect(studioVrmGarmentBumpScaleM(invalid)).toBe(0);
    expect(Number.isFinite(sampleStudioVrmGarmentWeave(invalid, 0.1, 0.3))).toBe(true);
    expect(sampleStudioVrmGarmentWeave(invalid, NaN, 0)).toBe(128);
  });
});
