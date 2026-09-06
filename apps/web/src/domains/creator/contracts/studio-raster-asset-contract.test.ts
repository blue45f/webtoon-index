import { describe, expect, it } from "vitest";

import {
  STUDIO_RASTER_ASSET_MAX_ASSETS_PER_WORK,
  STUDIO_RASTER_ASSET_ADMISSION_OPT_IN_TOKEN,
  STUDIO_RASTER_ASSET_MAX_BYTES,
  STUDIO_RASTER_ASSET_MAX_TOTAL_BYTES_PER_WORK,
  StudioRasterAssetManifestSchema,
  StudioRasterStoredReferenceSchema,
  isStudioRasterAssetAdmissionOptedIn,
  isStudioRasterAssetMediaType,
  isStudioRasterAssetReferenceStoredExactly,
  studioRasterAssetContentPath,
  studioRasterAssetReferenceFromManifest,
} from "./studio-raster-asset-contract";

const sha256 = "a".repeat(64);

const manifest = {
  version: 1 as const,
  scope: "work" as const,
  assetId: sha256,
  sha256,
  byteLength: 1_024,
  mediaType: "image/png" as const,
  width: 16,
  height: 16,
  createdAt: "2026-07-16T00:00:00.000Z",
};

describe("studio raster asset storage contract", () => {
  it("keeps server-side admission fail-closed behind one exact experiment token", () => {
    expect(isStudioRasterAssetAdmissionOptedIn(undefined)).toBe(false);
    expect(isStudioRasterAssetAdmissionOptedIn("true")).toBe(false);
    expect(isStudioRasterAssetAdmissionOptedIn(
      STUDIO_RASTER_ASSET_ADMISSION_OPT_IN_TOKEN
    )).toBe(true);
  });

  it("is the exact work-scoped reference shape consumed by raster replay", () => {
    const reference = studioRasterAssetReferenceFromManifest(manifest);
    expect(reference).toEqual({
      scope: "work",
      assetId: sha256,
      sha256,
      byteLength: 1_024,
      mediaType: "image/png",
      width: 16,
      height: 16,
    });
    expect(isStudioRasterAssetReferenceStoredExactly(manifest, reference)).toBe(true);
    expect(isStudioRasterAssetReferenceStoredExactly(manifest, {
      ...reference,
      width: 17,
    })).toBe(false);
  });

  it("requires a lowercase SHA-256 content address and exact immutable metadata", () => {
    expect(StudioRasterAssetManifestSchema.safeParse(manifest).success).toBe(true);
    expect(StudioRasterAssetManifestSchema.safeParse({
      ...manifest,
      assetId: "b".repeat(64),
    }).success).toBe(false);
    expect(StudioRasterStoredReferenceSchema.safeParse({
      ...studioRasterAssetReferenceFromManifest(manifest),
      sha256: sha256.toUpperCase(),
    }).success).toBe(false);
    expect(StudioRasterAssetManifestSchema.safeParse({
      ...manifest,
      sourceUrl: "https://private.example/tile.png",
    }).success).toBe(false);
  });

  it("admits only the fully decoded PNG profile and shares the CRDT byte/dimension limits", () => {
    expect(isStudioRasterAssetMediaType("image/png")).toBe(true);
    for (const legacyReadOnlyMediaType of [
      "image/webp",
      "application/x-toonspectrum-rgba-zstd",
      "application/x-toonspectrum-alpha-zstd",
    ]) {
      expect(isStudioRasterAssetMediaType(legacyReadOnlyMediaType)).toBe(false);
      expect(StudioRasterAssetManifestSchema.safeParse({
        ...manifest,
        mediaType: legacyReadOnlyMediaType,
      }).success).toBe(false);
    }
    expect(isStudioRasterAssetMediaType("application/zstd")).toBe(false);
    expect(isStudioRasterAssetMediaType("image/jpeg")).toBe(false);
    expect(STUDIO_RASTER_ASSET_MAX_BYTES).toBe(16 * 1_024 * 1_024);
    expect(STUDIO_RASTER_ASSET_MAX_ASSETS_PER_WORK).toBe(250_000);
    expect(STUDIO_RASTER_ASSET_MAX_TOTAL_BYTES_PER_WORK).toBe(2 * 1_024 * 1_024 * 1_024);
    expect(StudioRasterAssetManifestSchema.safeParse({
      ...manifest,
      width: 1_025,
    }).success).toBe(false);
  });

  it("builds an encoded work-scoped content endpoint without encoding the hash", () => {
    expect(studioRasterAssetContentPath({ workId: "work / 한글", assetId: sha256 }))
      .toBe(`/api/creator/works/work%20%2F%20%ED%95%9C%EA%B8%80/raster-assets/${sha256}/content`);
  });
});
