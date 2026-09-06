import { describe, expect, it } from "vitest";

import {
  bundleAssetsToRecipe,
  createStudioAssetRegistry,
  deprecateAsset,
  registerAsset,
  updateAssetUsage,
  type StudioAssetRecord,
} from "./studio-asset-registry";

describe("Studio Asset Registry & Recipe Bundler", () => {
  const brushAsset: StudioAssetRecord = {
    id: "brush_gpen_v2",
    type: "brush-paper-tone",
    name: "Classic G-Pen v2",
    version: "2.0.0",
    contentHash: "hash_gpen_123",
    creatorName: "ToonArtist",
    minStudioVersion: 1,
    licenseType: "commercial-unlimited",
    isCommercialPermitted: true,
    usedIn: [],
    payloadUri: "assets/brushes/gpen_v2.json",
    createdAtMs: 1_000,
  };

  const textureAsset: StudioAssetRecord = {
    id: "tex_grain_sub",
    type: "brush-paper-tone",
    name: "Paper Grain Sub-Texture",
    version: "1.0.0",
    contentHash: "hash_grain_456",
    creatorName: "ToonArtist",
    minStudioVersion: 1,
    licenseType: "commercial-unlimited",
    isCommercialPermitted: true,
    usedIn: [],
    payloadUri: "assets/textures/grain.png",
    createdAtMs: 1_000,
  };

  const compositeBrush: StudioAssetRecord = {
    id: "brush_grainy_pen",
    type: "brush-paper-tone",
    name: "Grainy Texture Pen",
    version: "1.0.0",
    contentHash: "hash_grainy_pen_789",
    creatorName: "ToonArtist",
    minStudioVersion: 1,
    licenseType: "commercial-unlimited",
    isCommercialPermitted: true,
    dependencies: ["tex_grain_sub"], // Depends on texture
    usedIn: [],
    payloadUri: "assets/brushes/grainy.json",
    createdAtMs: 2_000,
  };

  it("registers assets and tracks usage in projects", () => {
    let reg = createStudioAssetRegistry();
    reg = registerAsset(reg, brushAsset);

    expect(reg.assets).toHaveLength(1);

    reg = updateAssetUsage(reg, "brush_gpen_v2", {
      projectId: "proj_main",
      episodeId: "ep_1",
      panelId: "p_1",
      referencedAtMs: 5_000,
    });

    expect(reg.assets[0].usedIn).toHaveLength(1);
    expect(reg.assets[0].usedIn[0].projectId).toBe("proj_main");
  });

  it("deprecates an asset and points to replacement", () => {
    let reg = createStudioAssetRegistry({ assets: [brushAsset] });
    reg = deprecateAsset(reg, "brush_gpen_v2", "v3 버전으로 대체됨", "brush_gpen_v3");

    expect(reg.assets[0].deprecation?.isDeprecated).toBe(true);
    expect(reg.assets[0].deprecation?.replacementAssetId).toBe("brush_gpen_v3");
  });

  it("bundles root assets with transitive dependencies into recipe pack", () => {
    const reg = createStudioAssetRegistry({
      assets: [textureAsset, compositeBrush, brushAsset],
    });

    const bundle = bundleAssetsToRecipe(reg, ["brush_grainy_pen"], {
      bundleId: "pack_grainy_brush",
      bundleTitle: "그레인 펜 팩",
      author: "ToonArtist",
      version: "1.0.0",
      nowMs: 10_000,
    });

    expect(bundle.bundleTitle).toBe("그레인 펜 팩");
    // Should include compositeBrush AND its dependency tex_grain_sub
    expect(bundle.includedAssets).toHaveLength(2);
    expect(bundle.includedAssets.map((a) => a.id)).toContain("brush_grainy_pen");
    expect(bundle.includedAssets.map((a) => a.id)).toContain("tex_grain_sub");
  });
});
