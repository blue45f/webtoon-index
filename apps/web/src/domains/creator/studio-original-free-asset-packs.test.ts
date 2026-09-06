import { describe, expect, it } from "vitest";

import {
  STUDIO_ORIGINAL_FREE_ASSET_LICENSE,
  STUDIO_ORIGINAL_FREE_ASSET_PACKAGES,
  STUDIO_ORIGINAL_FREE_ASSETS,
  createStudioOriginalFreeAssetRecord,
  filterStudioOriginalFreeAssets,
  findStudioOriginalFreeAsset,
  findStudioOriginalFreeAssetPackage,
} from "./studio-original-free-asset-packs";

describe("ToonSpectrum original free starter asset packs", () => {
  it("ships three selectable packages and 24 unique non-blockout SVG assets", () => {
    expect(STUDIO_ORIGINAL_FREE_ASSET_PACKAGES).toHaveLength(3);
    expect(STUDIO_ORIGINAL_FREE_ASSETS).toHaveLength(24);
    expect(new Set(STUDIO_ORIGINAL_FREE_ASSET_PACKAGES.map((pkg) => pkg.id)).size)
      .toBe(3);
    expect(new Set(STUDIO_ORIGINAL_FREE_ASSETS.map((asset) => asset.id)).size)
      .toBe(24);
    expect(new Set(STUDIO_ORIGINAL_FREE_ASSETS.map((asset) => asset.contentFingerprint)).size)
      .toBe(24);
  });

  it("makes provenance and CC0-safe rights explicit at package and item level", () => {
    expect(STUDIO_ORIGINAL_FREE_ASSET_LICENSE.id).toBe("cc0-1.0");
    expect(STUDIO_ORIGINAL_FREE_ASSET_LICENSE.redistributionAllowed).toBe(true);
    for (const pkg of STUDIO_ORIGINAL_FREE_ASSET_PACKAGES) {
      expect(pkg.access).toBe("free");
      expect(pkg.origin).toBe("original-procedural");
      expect(pkg.creator.name).toBe("ToonSpectrum Lab");
      expect(pkg.availability).toMatchObject({
        catalog: "bundled",
        library: "local-only",
        payment: "unavailable",
        cloudSync: "unavailable",
      });
      expect(pkg.license).toBe(STUDIO_ORIGINAL_FREE_ASSET_LICENSE);
      expect(pkg.includedItems).toHaveLength(8);
      for (const asset of pkg.includedItems) {
        expect(asset.packageId).toBe(pkg.id);
        expect(asset.origin).toBe("original-procedural");
        expect(asset.license).toBe(STUDIO_ORIGINAL_FREE_ASSET_LICENSE);
      }
    }
  });

  it("keeps generated SVGs bounded, standalone and free of remote or active content", () => {
    for (const asset of STUDIO_ORIGINAL_FREE_ASSETS) {
      expect(asset.width).toBeGreaterThanOrEqual(200);
      expect(asset.height).toBeGreaterThanOrEqual(200);
      expect(asset.svg).toContain("<svg");
      expect(asset.svg).toContain(`viewBox="0 0 ${asset.width} ${asset.height}"`);
      expect(asset.svg).not.toMatch(/<(?:script|foreignObject|iframe|audio|video)\b/i);
      expect(asset.svg).not.toMatch(/\b(?:href|src)\s*=/i);
      expect(asset.svg.replace('xmlns="http://www.w3.org/2000/svg"', ""))
        .not.toMatch(/https?:\/\//i);
      expect(asset.svg.length).toBeLessThan(30_000);
    }
  });

  it("searches across Korean names and tags and intersects package/category filters", () => {
    expect(filterStudioOriginalFreeAssets({ query: "병원" }).map((asset) => asset.id))
      .toEqual([]); // The blockout remains resolvable by ID, but is not a new-selection result.
    expect(filterStudioOriginalFreeAssets({
      query: "오버레이",
      categories: ["atmosphere-fx"],
    })).toHaveLength(8);
    expect(filterStudioOriginalFreeAssets({
      packageIds: ["original-daily-props"],
      categories: ["daily-prop"],
    })).toHaveLength(8);
    expect(filterStudioOriginalFreeAssets({
      packageIds: ["original-daily-props"],
      categories: ["genre-prop"],
    })).toEqual([]);
  });

  it("finds assets and packages defensively and creates a placeable local record", () => {
    const asset = findStudioOriginalFreeAsset("original-city-bicycle");
    expect(asset?.name).toBe("도시 자전거");
    expect(findStudioOriginalFreeAsset(null)).toBeNull();
    expect(findStudioOriginalFreeAsset("missing")).toBeNull();
    expect(findStudioOriginalFreeAssetPackage("original-daily-props")?.includedItems)
      .toHaveLength(8);

    const record = createStudioOriginalFreeAssetRecord(asset!);
    expect(record).toMatchObject({
      id: "starter:original-city-bicycle",
      name: "도시 자전거",
      width: 300,
      height: 210,
      kind: "original-procedural",
    });
    expect(record.dataUrl).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(decodeURIComponent(record.dataUrl.split(",")[1] ?? "")).toBe(asset?.svg);
  });
});
