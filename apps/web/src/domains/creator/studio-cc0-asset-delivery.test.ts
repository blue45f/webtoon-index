import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  STUDIO_CC0_CATEGORY_LABELS,
  filterStudioCc0Assets,
  parseStudioCc0Catalog,
  studioCc0AssetUrl,
} from "./studio-cc0-asset-delivery";
import {
  STUDIO_ORIGINAL_FREE_ASSETS,
  STUDIO_ORIGINAL_FREE_ASSET_PACKAGES,
  STUDIO_RETIRED_ORIGINAL_FREE_ASSETS,
  filterStudioOriginalFreeAssets,
  findStudioOriginalFreeAsset,
  findStudioOriginalFreeAssetPackage,
} from "./studio-original-free-asset-packs";

const fixture = () => ({
  id: "kenney-furniture-chair", name: "Chair", kind: "model", category: "furniture",
  path: "assets/kenney-furniture/chair.glb", previewPath: "previews/kenney-furniture-chair.png",
  sha256: "a".repeat(64), bytes: 4096, browserRenderVerified: true,
  license: {id: "CC0-1.0", provider: "Kenney", sourceUrl: "https://kenney.nl/assets/furniture-kit", commercialUse: true, redistributionAllowed: true},
});
const manifest = (assets: unknown[]) => ({schema: "toonspectrum.asset-delivery.v1", assets});

describe("CC0 delivery catalog boundary", () => {
  it("admits an explicitly licensed, rendered self-hosted model", () => {
    const result = parseStudioCc0Catalog(manifest([fixture()]));
    expect(result).toHaveLength(1);
    expect(result[0].provider).toBe("Kenney");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
  });
  it.each(["../secret.glb", "assets/../secret.glb", "assets//chair.glb", "assets/%2e%2e/secret.glb", "https://example.com/model.glb", "assets/chair.svg", "assets/chair.glb?token=x"])("rejects unsafe path %s", input => {
    expect(() => studioCc0AssetUrl(input)).toThrow();
  });
  it("does not admit duplicate IDs", () => {
    expect(() => parseStudioCc0Catalog(manifest([fixture(), fixture()]))).toThrow();
  });
  it("requires actual rendering and a real thumbnail for models", () => {
    expect(() => parseStudioCc0Catalog(manifest([{...fixture(), browserRenderVerified: false}]))).toThrow();
    expect(() => parseStudioCc0Catalog(manifest([{...fixture(), previewPath: undefined}]))).toThrow();
  });
  it.each(["CC-BY-NC", "unknown", "CC-BY-4.0"])("does not silently accept a different license %s", id => {
    const asset = fixture();
    expect(() => parseStudioCc0Catalog(manifest([{...asset, license: {...asset.license, id}}]))).toThrow();
  });
  it("requires redistribution permission, not merely commercial use", () => {
    const asset = fixture();
    expect(() => parseStudioCc0Catalog(manifest([{...asset, license: {...asset.license, redistributionAllowed: false}}]))).toThrow();
  });
  it.each(["https://kenney.nl.evil.example/assets/x", "http://kenney.nl/assets/x", "https://user:pass@kenney.nl/assets/x"])("rejects a forged supplier %s", sourceUrl => {
    const asset = fixture();
    expect(() => parseStudioCc0Catalog(manifest([{...asset, license: {...asset.license, sourceUrl}}]))).toThrow();
  });
  it("rejects missing digests, giant images and format mismatch", () => {
    expect(() => parseStudioCc0Catalog(manifest([{...fixture(), sha256: "unverified"}]))).toThrow();
    expect(() => parseStudioCc0Catalog(manifest([{...fixture(), path: "assets/chair.webp"}]))).toThrow();
    expect(() => parseStudioCc0Catalog(manifest([{...fixture(), kind: "effect-mask", path: "assets/effect.webp", width: 10000, height: 10000}]))).toThrow();
  });
  it("supports Korean category and case-insensitive multi-token search", () => {
    const items = parseStudioCc0Catalog(manifest([fixture()]));
    expect(filterStudioCc0Assets(items, "가구 CHAIR", "model")).toHaveLength(1);
    expect(filterStudioCc0Assets(items, "chair", "effect-mask")).toHaveLength(0);
    expect(filterStudioCc0Assets(items, "missing")).toHaveLength(0);
  });
  it("labels the detailed PBR prop category so text search matches what the library shows", () => {
    const items = parseStudioCc0Catalog(manifest([{...fixture(), category: "pbr-detailed-prop"}]));
    expect(STUDIO_CC0_CATEGORY_LABELS["pbr-detailed-prop"]).toBe("디테일 가구 · 생활 소품");
    expect(filterStudioCc0Assets(items, "디테일 생활 소품", "model")).toHaveLength(1);
    expect(filterStudioCc0Assets(items, "pbr-detailed-prop")).toHaveLength(1);
    expect(filterStudioCc0Assets(items, "디테일", "effect-mask")).toHaveLength(0);
  });
  it("gives every category shipped in the CC0 manifest a Korean label", () => {
    const shipped = JSON.parse(readFileSync(new URL("../../../public/assets/studio/cc0-20260906/manifest.json", import.meta.url), "utf8")) as {assets: {category: string}[]};
    const categories = [...new Set(shipped.assets.map(asset => asset.category))].sort();
    expect(categories).toContain("pbr-detailed-prop");
    for (const category of categories) expect(STUDIO_CC0_CATEGORY_LABELS[category], category).toBeTruthy();
  });
});

describe("blockout-only starter retirement", () => {
  it("removes eight draft backgrounds from new selection without deleting their identities", () => {
    expect(STUDIO_RETIRED_ORIGINAL_FREE_ASSETS).toHaveLength(8);
    expect(STUDIO_ORIGINAL_FREE_ASSETS).toHaveLength(24);
    expect(STUDIO_ORIGINAL_FREE_ASSET_PACKAGES).toHaveLength(3);
    expect(filterStudioOriginalFreeAssets({categories: ["modern-background"]})).toHaveLength(0);
    for (const asset of STUDIO_RETIRED_ORIGINAL_FREE_ASSETS) {
      expect(findStudioOriginalFreeAsset(asset.id)).toBe(asset);
      expect(findStudioOriginalFreeAssetPackage(asset.packageId)?.includedItems).toContain(asset);
    }
  });
  it("keeps other starter categories and unknown-ID semantics unchanged", () => {
    expect(filterStudioOriginalFreeAssets({categories: ["daily-prop"]})).toHaveLength(8);
    expect(filterStudioOriginalFreeAssets({categories: ["atmosphere-fx"]})).toHaveLength(8);
    expect(filterStudioOriginalFreeAssets({categories: ["genre-prop"]})).toHaveLength(8);
    expect(findStudioOriginalFreeAsset("missing")).toBeNull();
    expect(findStudioOriginalFreeAssetPackage(undefined)).toBeNull();
  });
});
