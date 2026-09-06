import { describe, expect, it } from "vitest";

import {
  EMPTY_ASSET_CATALOG_STATE,
  filterAndSortAssets,
  formatAssetStorageLocation,
  recordAssetUsage,
  togglePinAsset,
  type EnhancedStudioAssetItem,
} from "./studio-asset-catalog-enhancements";

describe("studio-asset-catalog-enhancements", () => {
  const sampleAssets: readonly EnhancedStudioAssetItem[] = [
    {
      id: "brush-gpen",
      name: "리얼 G펜",
      category: "brush",
      tags: ["선화", "펜", "기본"],
      storageLocation: "로컬 OPFS / 내 브러시",
      createdAt: 1000,
      license: "free",
    },
    {
      id: "3d-school-desk",
      name: "교실 책상",
      category: "3d",
      tags: ["학교", "배경", "소품"],
      storageLocation: "클라우드 마켓 / 3D 소품",
      createdAt: 2000,
      license: "free",
    },
    {
      id: "brush-watercolor",
      name: "수채화 번짐",
      category: "brush",
      tags: ["채색", "수채", "텍스처"],
      storageLocation: "로컬 OPFS / 내 브러시",
      createdAt: 3000,
      license: "commercial",
    },
  ];

  describe("Usage Tracking & Pinning", () => {
    it("records usage timestamps and increments usage counts", () => {
      let state = EMPTY_ASSET_CATALOG_STATE;
      state = recordAssetUsage(state, "brush-gpen", 5000);
      expect(state.usageRecords["brush-gpen"].useCount).toBe(1);
      expect(state.usageRecords["brush-gpen"].lastUsedAt).toBe(5000);

      state = recordAssetUsage(state, "brush-gpen", 6000);
      expect(state.usageRecords["brush-gpen"].useCount).toBe(2);
      expect(state.usageRecords["brush-gpen"].lastUsedAt).toBe(6000);
    });

    it("toggles pinned status on assets", () => {
      let state = EMPTY_ASSET_CATALOG_STATE;
      state = togglePinAsset(state, "3d-school-desk");
      expect(state.pinnedAssetIds).toContain("3d-school-desk");

      state = togglePinAsset(state, "3d-school-desk");
      expect(state.pinnedAssetIds).not.toContain("3d-school-desk");
    });
  });

  describe("Filtering and Sorting with Pinned Anchors", () => {
    it("floats pinned assets to the top regardless of sort order", () => {
      let state = EMPTY_ASSET_CATALOG_STATE;
      state = togglePinAsset(state, "3d-school-desk"); // Pin school desk

      const sorted = filterAndSortAssets(sampleAssets, state, {}, "newest");
      expect(sorted[0].id).toBe("3d-school-desk"); // Pinned item first!
      expect(sorted[1].id).toBe("brush-watercolor"); // Then newest unpinned
      expect(sorted[2].id).toBe("brush-gpen");
    });

    it("sorts by usage frequency", () => {
      let state = EMPTY_ASSET_CATALOG_STATE;
      state = recordAssetUsage(state, "brush-gpen", 1000);
      state = recordAssetUsage(state, "brush-gpen", 2000);
      state = recordAssetUsage(state, "brush-gpen", 3000); // 3 times
      state = recordAssetUsage(state, "brush-watercolor", 4000); // 1 time

      const sorted = filterAndSortAssets(sampleAssets, state, {}, "frequency");
      expect(sorted[0].id).toBe("brush-gpen");
      expect(sorted[1].id).toBe("brush-watercolor");
      expect(sorted[2].id).toBe("3d-school-desk"); // 0 times
    });

    it("filters by query and tags in the search options bar", () => {
      const state = EMPTY_ASSET_CATALOG_STATE;
      const byQuery = filterAndSortAssets(sampleAssets, state, { query: "수채" });
      expect(byQuery).toHaveLength(1);
      expect(byQuery[0].id).toBe("brush-watercolor");

      const byCategory = filterAndSortAssets(sampleAssets, state, { category: "3d" });
      expect(byCategory).toHaveLength(1);
      expect(byCategory[0].id).toBe("3d-school-desk");

      const byTag = filterAndSortAssets(sampleAssets, state, { tag: "선화" });
      expect(byTag).toHaveLength(1);
      expect(byTag[0].id).toBe("brush-gpen");
    });
  });

  describe("formatAssetStorageLocation", () => {
    it("formats human-readable storage paths", () => {
      expect(formatAssetStorageLocation("opfs", "brushes/gpen.myb")).toBe("로컬 저장소 (OPFS) › brushes/gpen.myb");
      expect(formatAssetStorageLocation("cloud", "props/desk.glb")).toBe("클라우드 마켓 에셋 › props/desk.glb");
    });
  });
});
