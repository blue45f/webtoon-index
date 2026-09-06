import { describe, expect, it } from "vitest";

import {
  MarketWebtoonSpecInspector,
  type Asset3dMeshMetadata,
} from "./market-webtoon-spec-inspector";

describe("MarketWebtoonSpecInspector", () => {
  const inspector = new MarketWebtoonSpecInspector();

  it("grades optimal-webtoon polycount and verifies safe studio usage", () => {
    const meta: Asset3dMeshMetadata = {
      triangleCount: 45_000,
      vertexCount: 28_000,
      textureResolutionMax: 2048,
      hasLineExtractionSupport: true,
      hasCelShadingPreset: true,
      hasDayNightVariants: true,
      dynamicLayerCount: 4,
      format: "glb",
    };

    const report = inspector.audit(meta);
    expect(report.polycountGrade).toBe("optimal-webtoon");
    expect(report.isPerformanceSafeForStudio).toBe(true);
    expect(report.lineArtReadiness).toBe("ready");
    expect(report.textureAudit.isSafeForWebtoon).toBe(true);
    expect(report.featuresAvailable).toHaveLength(4);
    expect(report.featuresAvailable[0]).toContain("은선");
  });

  it("warns for heavy polycount (> 300k) and advises LOD decimation", () => {
    const meta: Asset3dMeshMetadata = {
      triangleCount: 520_000,
      vertexCount: 380_000,
      textureResolutionMax: 8192,
      hasLineExtractionSupport: false,
      hasCelShadingPreset: false,
      hasDayNightVariants: false,
      format: "fbx",
    };

    const report = inspector.audit(meta);
    expect(report.polycountGrade).toBe("heavy-warning");
    expect(report.isPerformanceSafeForStudio).toBe(false);
    expect(report.recommendedLODAction).toBeDefined();
    expect(report.textureAudit.isSafeForWebtoon).toBe(false);
    expect(report.textureAudit.warning).toContain("8192px");
  });

  it("grades ultra-light polycount for low poly props", () => {
    const meta: Asset3dMeshMetadata = {
      triangleCount: 8_500,
      vertexCount: 4_900,
      textureResolutionMax: 1024,
      hasLineExtractionSupport: true,
      hasCelShadingPreset: false,
      hasDayNightVariants: false,
      format: "obj",
    };

    const report = inspector.audit(meta);
    expect(report.polycountGrade).toBe("ultra-light");
    expect(report.polycountSummaryKo).toContain("초경량");
  });

  it("returns human-readable format labels for all 3D/2D comic formats", () => {
    expect(inspector.getFormatLabel("glb")).toContain("GLB");
    expect(inspector.getFormatLabel("vrm")).toContain("VRM");
    expect(inspector.getFormatLabel("skp")).toContain("SKP");
    expect(inspector.getFormatLabel("clip-sut")).toContain("SUT");
  });
});
