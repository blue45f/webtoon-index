// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useMarketWishlist } from "./use-market-wishlist";

import type { CreatorMarketplaceResourceRecord } from "@/shared/lib/creator-marketplace-resource-contract";

describe("useMarketWishlist", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const dummyRecord: CreatorMarketplaceResourceRecord = {
    schemaVersion: 1,
    id: "wish-res-1",
    packageId: "test/palette/sunset",
    name: "노을 감성 팔레트",
    description: "황금빛 노을",
    kind: "palette",
    resourceVersion: "1.0.0",
    minimumStudioVersion: "0.1.0",
    tags: ["노을", "색감"],
    license: "toonspectrum-standard",
    attributionText: "",
    containsAi: false,
    provenance: { origin: "original", authoredByPublisher: true },
    compatibility: { engines: ["canvas2d"] },
    entries: [],
    manifestHash: "2".repeat(64),
    manifestByteSize: 150,
    publisher: { id: "pub-2", name: "컬러리스트", avatar: null },
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    isOwner: false,
    access: "free",
  };

  it("toggles wishlist status correctly", () => {
    const { result } = renderHook(() => useMarketWishlist());
    expect(result.current.isWishlisted("wish-res-1")).toBe(false);
    expect(result.current.wishlistCount).toBe(0);

    act(() => {
      const added = result.current.toggleWishlist(dummyRecord);
      expect(added).toBe(true);
    });

    expect(result.current.isWishlisted("wish-res-1")).toBe(true);
    expect(result.current.wishlistCount).toBe(1);

    // Toggle off
    act(() => {
      const removed = result.current.toggleWishlist(dummyRecord);
      expect(removed).toBe(false);
    });

    expect(result.current.isWishlisted("wish-res-1")).toBe(false);
    expect(result.current.wishlistCount).toBe(0);
  });
});
