import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  filterStudioRasterAssets,
  STUDIO_RASTER_ASSETS,
  STUDIO_RASTER_ASSET_BLEND_MODES,
  STUDIO_RASTER_ASSET_PLACEMENTS,
  STUDIO_RASTER_INTERNAL_LICENSE_REF,
} from "./studio-raster-assets";

const EXPECTED_ASSETS = {
  "builtin-raster-daily-cafe-table-for-two": {
    src: "/assets/studio/props/daily/webtoon_cafe_table_for_two.webp",
    promptSha256: "ca2d63544261ced0ac4574e81511f07a1c76d7e6e250188f4445ff0ad3a42758",
  },
  "builtin-raster-school-desk-study-cluster": {
    src: "/assets/studio/props/school/webtoon_school_desk_study_cluster.webp",
    promptSha256: "c8d0f0f9cb9dadca26334a7f9ab177ab845557aa89c452cc6160c31171401d74",
  },
  "builtin-raster-fantasy-royal-letter-seal-cluster": {
    src: "/assets/studio/props/fantasy/webtoon_royal_letter_seal_cluster.webp",
    promptSha256: "8d27e67ecc3f362e80cabc9c2fc563d11075d39448d297dd9256f5b6e6f0047d",
  },
  "builtin-raster-urban-street-fixture-cluster": {
    src: "/assets/studio/props/urban/webtoon_street_fixture_cluster.webp",
    promptSha256: "85173f61ef38f85e612ce371f8bb9678cef171ee0e6926f55a5989be2d4aba96",
  },
} as const;

function readPublicAsset(src: string): Buffer {
  return readFileSync(join(process.cwd(), "apps/web/public", src.replace(/^\//, "")));
}

function uint24Le(bytes: Buffer, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

describe("studio built-in raster asset catalog", () => {
  it("contains exactly the reviewed assets with stable unique ids and paths", () => {
    expect(STUDIO_RASTER_ASSETS).toHaveLength(4);
    expect(new Set(STUDIO_RASTER_ASSETS.map((asset) => asset.id)).size).toBe(STUDIO_RASTER_ASSETS.length);
    expect(new Set(STUDIO_RASTER_ASSETS.map((asset) => asset.src)).size).toBe(STUDIO_RASTER_ASSETS.length);

    expect(
      Object.fromEntries(
        STUDIO_RASTER_ASSETS.map((asset) => [
          asset.id,
          { src: asset.src, promptSha256: asset.provenance.promptSha256 },
        ])
      )
    ).toEqual(EXPECTED_ASSETS);
  });

  it("keeps provenance hash-only, reviewed, and tied to the internal license reference", () => {
    for (const asset of STUDIO_RASTER_ASSETS) {
      expect(asset.provenance.promptSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(asset.provenance).toMatchObject({
        origin: "ai-generated",
        provider: "openai",
        pipeline: "built-in-image-generation",
        model: "gpt-image-2",
        generatedOn: "2026-07-11",
        promptRetention: "sha256-only",
        humanReviewed: true,
      });
      expect(asset.provenance.postProcessing.at(-1)).toBe("local-chroma-key-removal");
      expect(Object.keys(asset.provenance).sort()).toEqual(
        ([
          "generatedOn",
          "humanReviewed",
          "model",
          "origin",
          "pipeline",
          "postProcessing",
          "promptRetention",
          "promptSha256",
          "provider",
          ...(asset.collection === "school" ? ["editPromptSha256"] : []),
        ] as string[]).sort()
      );
      expect(asset.license).toEqual({
        licenseRef: STUDIO_RASTER_INTERNAL_LICENSE_REF,
        scope: "project-internal",
        redistribution: "bundled-with-product",
        attributionRequired: false,
      });
    }
    const school = STUDIO_RASTER_ASSETS.find((asset) => asset.collection === "school");
    expect(school?.provenance.editPromptSha256).toBe(
      "f3b2a1c692ad2abc0a7b9dbf81d9ac4b537971c43175877f900d31b5456452ae"
    );
    expect(school?.provenance.postProcessing).toEqual(["built-in-image-edit", "local-chroma-key-removal"]);
  });

  it("searches labels, descriptions, Korean/English tags, and exact tag chips", () => {
    expect(filterStudioRasterAssets(STUDIO_RASTER_ASSETS, { query: "카페 커피" }).map((asset) => asset.collection)).toEqual([
      "daily",
    ]);
    expect(filterStudioRasterAssets(STUDIO_RASTER_ASSETS, { query: "wax seal" }).map((asset) => asset.collection)).toEqual([
      "fantasy",
    ]);
    expect(
      filterStudioRasterAssets(STUDIO_RASTER_ASSETS, { tags: ["학교", "stationery"] }).map((asset) => asset.collection)
    ).toEqual(["school"]);
    expect(
      filterStudioRasterAssets(STUDIO_RASTER_ASSETS, { tags: ["traffic cone"] }).map((asset) => asset.collection)
    ).toEqual(["urban"]);

    for (const asset of STUDIO_RASTER_ASSETS) {
      expect(filterStudioRasterAssets(STUDIO_RASTER_ASSETS, { query: asset.tags[0] })).toContain(asset);
    }
  });

  it("combines taxonomy filters without changing catalog order and reuses unfiltered input", () => {
    expect(filterStudioRasterAssets(STUDIO_RASTER_ASSETS)).toBe(STUDIO_RASTER_ASSETS);
    expect(
      filterStudioRasterAssets(STUDIO_RASTER_ASSETS, {
        kinds: ["prop-cluster"],
        collections: ["daily", "school"],
        placements: ["frame-bottom-center"],
      }).map((asset) => asset.collection)
    ).toEqual(["daily", "school"]);
    expect(filterStudioRasterAssets(STUDIO_RASTER_ASSETS, { query: "없는 태그" })).toEqual([]);
  });

  it("declares valid WebP dimensions, alpha, placement, blend, and opacity defaults", () => {
    for (const asset of STUDIO_RASTER_ASSETS) {
      expect(asset.src).toMatch(/^\/assets\/studio\/props\/(daily|school|fantasy|urban)\/.+\.webp$/);
      expect(asset.mimeType).toBe("image/webp");
      expect(asset.width).toBe(1536);
      expect(asset.height).toBe(1024);
      expect(asset.hasAlpha).toBe(true);
      expect(STUDIO_RASTER_ASSET_PLACEMENTS).toContain(asset.defaultPlacement);
      expect(STUDIO_RASTER_ASSET_BLEND_MODES).toContain(asset.defaultBlendMode);
      expect(asset.defaultBlendMode).toBe("source-over");
      expect(asset.defaultOpacity).toBeGreaterThan(0);
      expect(asset.defaultOpacity).toBeLessThanOrEqual(1);
    }
  });

  it("matches the checked-in extended WebP file magic, canvas dimensions, and alpha feature bit", () => {
    for (const asset of STUDIO_RASTER_ASSETS) {
      const bytes = readPublicAsset(asset.src);
      expect(bytes.subarray(0, 4).toString("ascii"), asset.src).toBe("RIFF");
      expect(bytes.subarray(8, 12).toString("ascii"), asset.src).toBe("WEBP");
      expect(bytes.subarray(12, 16).toString("ascii"), asset.src).toBe("VP8X");
      expect(uint24Le(bytes, 24) + 1, asset.src).toBe(asset.width);
      expect(uint24Le(bytes, 27) + 1, asset.src).toBe(asset.height);
      expect(bytes[20] & 0x10, asset.src).toBe(0x10);
    }
  });
});
