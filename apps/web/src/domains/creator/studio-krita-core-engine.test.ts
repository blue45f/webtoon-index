import { describe, expect, it } from "vitest";

import {
  DEFAULT_KRITA_PRIMARY_TIP,
  StudioKritaCoreEngine,
} from "./studio-krita-core-engine";

describe("StudioKritaCoreEngine", () => {
  it("generates Gaussian parametric brush tip masks", () => {
    const mask = StudioKritaCoreEngine.generateParametricTipMask(DEFAULT_KRITA_PRIMARY_TIP);
    expect(mask.width).toBe(24);
    expect(mask.height).toBe(24);
    expect(mask.mask.length).toBe(24 * 24);
    // Center pixel should be highest intensity
    const centerIdx = 12 * 24 + 12;
    expect(mask.mask[centerIdx]).toBeGreaterThan(0.8);
  });

  it("generates ring and star shape parametric tip masks", () => {
    const ring = StudioKritaCoreEngine.generateParametricTipMask({
      shape: "ring",
      diameter: 16,
      ratio: 1.0,
      angleDeg: 0,
      hardness: 0.8,
      fade: 1.0,
      spikes: 5,
      ringThickness: 0.4,
    });
    expect(ring.mask.length).toBe(16 * 16);

    const star = StudioKritaCoreEngine.generateParametricTipMask({
      shape: "star",
      diameter: 20,
      ratio: 1.0,
      angleDeg: 0,
      hardness: 0.5,
      fade: 1.0,
      spikes: 5,
      ringThickness: 0.3,
    });
    expect(star.mask.length).toBe(20 * 20);
  });

  it("blends dual brush masks with multiply and screen modes", () => {
    const primary = StudioKritaCoreEngine.generateParametricTipMask({ ...DEFAULT_KRITA_PRIMARY_TIP, diameter: 10, ratio: 1.0 });
    const secondary = StudioKritaCoreEngine.generateParametricTipMask({ ...DEFAULT_KRITA_PRIMARY_TIP, diameter: 10, ratio: 1.0 });
    const multiplied = StudioKritaCoreEngine.blendDualBrushMask(primary, secondary, "multiply");
    expect(multiplied.mask.length).toBe(100);

    const screened = StudioKritaCoreEngine.blendDualBrushMask(primary, secondary, "screen");
    expect(screened.mask.length).toBe(100);
  });
});
