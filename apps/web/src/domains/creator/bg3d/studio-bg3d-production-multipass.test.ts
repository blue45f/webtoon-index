import { describe, expect, it } from "vitest";

import {
  STUDIO_BG3D_DEFERRED_ARTIFACT_PASSES,
  detectStudioBg3dProductionBatchPreset,
  planStudioBg3dProductionBatchSummary,
  resolveStudioBg3dProductionBatchPreset,
} from "./studio-bg3d-production-multipass";

import type { StudioBg3dShotBatchPass } from "./studio-bg3d-shot-batch-pass-catalog";

const AVAILABLE: readonly StudioBg3dShotBatchPass[] = [
  "beauty",
  "lt-composite",
  "color",
  "tone",
  "texture-line",
  "main-line",
  "depth",
];

describe("studio-bg3d-production-multipass", () => {
  it("resolves purpose presets against the actual production pass catalog", () => {
    expect(resolveStudioBg3dProductionBatchPreset(AVAILABLE, "review")).toEqual([
      "beauty",
      "lt-composite",
    ]);
    expect(resolveStudioBg3dProductionBatchPreset(AVAILABLE, "ai-reference")).toEqual([
      "beauty",
      "main-line",
      "depth",
    ]);
    expect(resolveStudioBg3dProductionBatchPreset(["beauty", "depth"], "ai-reference")).toEqual([
      "beauty",
      "depth",
    ]);
  });

  it("detects exact presets without treating custom or duplicate selections as presets", () => {
    expect(detectStudioBg3dProductionBatchPreset(
      AVAILABLE,
      ["lt-composite", "color", "tone", "texture-line", "main-line"],
    )).toBe("manuscript");
    expect(detectStudioBg3dProductionBatchPreset(
      AVAILABLE,
      ["beauty", "depth"],
    )).toBe("custom");
    expect(detectStudioBg3dProductionBatchPreset(
      AVAILABLE,
      ["beauty", "beauty"],
    )).toBe("custom");
  });

  it("plans PNG, PSD, contact-sheet and manifest counts without allocating pixels", () => {
    const plan = planStudioBg3dProductionBatchSummary({
      selectedShotCount: 25,
      selectedPassCount: 5,
      includeLayeredPsd: true,
      includeContactSheet: true,
    });

    expect(plan.pngCount).toBe(125);
    expect(plan.psdCount).toBe(25);
    expect(plan.contactSheetCount).toBe(3);
    expect(plan.totalArtifactCount).toBe(154);
    expect(plan.warnings.some((warning) => warning.includes("PSD"))).toBe(true);
  });

  it("keeps capture-v2-only artifacts separate from advertised batch outputs", () => {
    expect(STUDIO_BG3D_DEFERRED_ARTIFACT_PASSES.map((pass) => pass.kind)).toEqual([
      "normal",
      "object-id",
      "material-id",
      "shadow",
      "ambient-occlusion",
      "emission",
      "velocity",
    ]);
  });
});
