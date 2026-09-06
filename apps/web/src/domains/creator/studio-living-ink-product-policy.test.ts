import { describe, expect, it } from "vitest";

import { DEFAULT_STUDIO_LIVING_INK_MATERIAL_CONTROLS } from "./studio-living-ink-gpu-protocol";
import {
  planStudioLivingInkProductExecutionConfig,
  studioLivingInkConfigMeetsProductQualityFloor,
} from "./studio-living-ink-product-policy";

describe("Living Ink product resolution policy", () => {
  it("admits an ordinary webtoon page above both display and physical-field floors", () => {
    const plan = planStudioLivingInkProductExecutionConfig({
      documentWidth: 800,
      documentHeight: 1_200,
      material: DEFAULT_STUDIO_LIVING_INK_MATERIAL_CONTROLS,
      seed: 1,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.config.fieldWidth).toBeGreaterThanOrEqual(128);
    expect(plan.config.displayWidth).toBeGreaterThanOrEqual(512);
    expect(studioLivingInkConfigMeetsProductQualityFloor(plan.config)).toBe(true);
  });

  it("fails closed instead of silently saving a 12×768 field for a 50k webtoon", () => {
    const plan = planStudioLivingInkProductExecutionConfig({
      documentWidth: 800,
      documentHeight: 50_000,
      material: DEFAULT_STUDIO_LIVING_INK_MATERIAL_CONTROLS,
      seed: 1,
    });
    expect(plan).toMatchObject({ ok: false });
    if (plan.ok) return;
    expect(plan.message).toMatch(/저해상도|512px|128셀/u);
  });

  it("rejects a persisted low-resolution config before physical re-editing", () => {
    expect(studioLivingInkConfigMeetsProductQualityFloor({
      displayWidth: 66,
      displayHeight: 4_096,
      fieldWidth: 12,
      fieldHeight: 768,
      coarseBase: 128,
      seed: 1,
      material: DEFAULT_STUDIO_LIVING_INK_MATERIAL_CONTROLS,
      displayMode: "composite",
    })).toBe(false);
  });
});
