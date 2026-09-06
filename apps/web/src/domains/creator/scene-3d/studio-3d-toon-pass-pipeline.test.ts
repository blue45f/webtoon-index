import { describe, it, expect } from "vitest";

import {
  Studio3DToonPassPipeline,
  createMangaMonochromeProfile,
  createCinematicActionProfile,
  createDefaultToonPipelineProfile,
} from "./studio-3d-toon-pass-pipeline";

describe("Studio3DToonPassPipeline", () => {
  it("initializes standard toon profile with active passes", () => {
    const defaultProfile = createDefaultToonPipelineProfile();
    expect(defaultProfile.passes.beauty.enabled).toBe(true);

    const pipeline = new Studio3DToonPassPipeline();
    const passes = pipeline.getActivePassTypes();
    expect(passes).toContain("beauty");
    expect(passes).toContain("line-art");
    expect(passes).toContain("shadow-ao");
    expect(passes).toContain("depth");
    expect(passes).toContain("object-id");
    expect(passes).toContain("rim-light");
  });

  it("toggles pass enablement and adjusts thickness and rim lighting", () => {
    const pipeline = new Studio3DToonPassPipeline();
    pipeline.togglePass("depth", false);
    expect(pipeline.getActivePassTypes()).not.toContain("depth");

    pipeline.setOutlineThickness(2.5);
    expect(pipeline.getProfile().outlineThickness).toBe(2.5);

    pipeline.setRimLightIntensity(1.5);
    expect(pipeline.getProfile().rimLightIntensity).toBe(1.5);

    pipeline.setShadowBands(3);
    expect(pipeline.getProfile().shadowBands).toBe(3);
  });

  it("adjusts quality levels and resolution multipliers", () => {
    const pipeline = new Studio3DToonPassPipeline();
    pipeline.setQuality("final");
    expect(pipeline.getProfile().quality).toBe("final");
    expect(pipeline.getProfile().passes.beauty.resolutionMultiplier).toBe(2);
    expect(pipeline.getProfile().passes["line-art"].resolutionMultiplier).toBe(2);

    pipeline.setQuality("draft");
    expect(pipeline.getProfile().passes.beauty.resolutionMultiplier).toBe(1);
  });

  it("configures monochrome manga and cinematic action profiles", () => {
    const mono = createMangaMonochromeProfile();
    expect(mono.passes.screentone.enabled).toBe(true);
    expect(mono.passes.beauty.enabled).toBe(false);

    const action = createCinematicActionProfile();
    expect(action.passes["rim-light"].enabled).toBe(true);
    expect(action.passes.normal.enabled).toBe(true);
    expect(action.rimLightIntensity).toBeGreaterThan(1.0);
  });

  it("generates PSD layer manifest with blend modes and opacity", () => {
    const pipeline = new Studio3DToonPassPipeline();
    pipeline.setPassOpacity("shadow-ao", 0.7);
    const manifest = pipeline.generatePsdLayerManifest();
    expect(manifest.length).toBeGreaterThanOrEqual(5);

    const linePass = manifest.find((m) => m.type === "line-art");
    expect(linePass?.name).toBe("Line Ink Layer");
    expect(linePass?.blendMode).toBe("multiply");

    const rimPass = manifest.find((m) => m.type === "rim-light");
    expect(rimPass?.blendMode).toBe("screen");

    const shadowPass = manifest.find((m) => m.type === "shadow-ao");
    expect(shadowPass?.opacity).toBe(0.7);
  });
});
