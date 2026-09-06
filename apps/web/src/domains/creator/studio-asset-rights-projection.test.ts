import { describe, expect, it } from "vitest";

import { projectStudioAssetRightsUsages } from "./studio-asset-rights-projection";

import type { El } from "./studio-element-model";

function image(overrides: Partial<Extract<El, { type: "image" }>> = {}) {
  return {
    id: "image-1",
    type: "image",
    src: "data:image/png;base64,AA==",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    ...overrides,
  } as Extract<El, { type: "image" }>;
}

describe("projectStudioAssetRightsUsages", () => {
  it("projects placed community and builtin assets with their persisted licenses", () => {
    const usages = projectStudioAssetRightsUsages([
      {
        id: "page-1",
        elements: [
          image({
            id: "community-image",
            communityAssetCredit: {
              assetId: "asset-1",
              authorName: "윤",
              licenseId: "cc-by-4.0",
              licenseLabel: "CC BY",
              attributionText: "윤 · 원본",
              attributionRequired: true,
              commercialUse: true,
              containsAi: false,
            },
          }),
          image({
            id: "builtin-image",
            builtinRasterAssetId: "builtin-raster-school-corridor",
          }),
        ],
      },
    ]);

    expect(usages).toEqual([
      expect.objectContaining({
        assetId: "asset-1",
        pageId: "page-1",
        elementId: "community-image",
        licenseId: "cc-by-4.0",
        source: { kind: "community", id: "asset-1" },
      }),
      expect.objectContaining({
        assetId: "builtin-raster-school-corridor",
        licenseId: "toonspectrum-standard",
        source: { kind: "builtin", id: "builtin-raster-school-corridor" },
      }),
    ]);
  });

  it("keeps unknown uploads, AI generations and 3D captures fail-closed", () => {
    const usages = projectStudioAssetRightsUsages([
      {
        id: "page-1",
        elements: [
          image(),
          image({
            id: "ai-image",
            aiProvenance: {
              provider: "example",
              model: "image-v1",
              action: "generated",
            },
          }),
          image({ id: "3d-image", bg3dScene: {} as never }),
        ],
      },
    ]);

    expect(usages.map((usage) => ({
      assetId: usage.assetId,
      source: usage.source?.kind,
      licenseId: usage.licenseId,
    }))).toEqual([
      { assetId: "local:image-1", source: "local-upload", licenseId: "unknown" },
      { assetId: "ai:ai-image", source: "ai-generated", licenseId: "unknown" },
      { assetId: "3d:3d-image", source: "3d-library", licenseId: "unknown" },
    ]);
  });

  it("does not turn authored vector and drawing elements into external assets", () => {
    const usages = projectStudioAssetRightsUsages([
      {
        id: "page-1",
        elements: [
          { id: "text-1", type: "text", text: "안녕" } as El,
          { id: "draw-1", type: "draw", points: [] } as unknown as El,
        ],
      },
    ]);

    expect(usages).toEqual([]);
  });
});
