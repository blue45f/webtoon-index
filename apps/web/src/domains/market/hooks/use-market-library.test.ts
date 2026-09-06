// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useMarketLibrary } from "./use-market-library";

import type { CreatorMarketplaceResourceRecord } from "@/shared/lib/creator-marketplace-resource-contract";

describe("useMarketLibrary", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const dummyRecord: CreatorMarketplaceResourceRecord = {
    schemaVersion: 1,
    id: "lib-res-1",
    packageId: "test/3d/sword",
    name: "성검 3D 소품",
    description: "로판 판타지용 성검",
    kind: "3d-asset",
    resourceVersion: "1.0.0",
    minimumStudioVersion: "0.1.0",
    tags: ["3D", "무기"],
    license: "toonspectrum-standard",
    attributionText: "",
    containsAi: false,
    provenance: { origin: "original", authoredByPublisher: true },
    compatibility: { engines: ["three"] },
    entries: [],
    manifestHash: "1".repeat(64),
    manifestByteSize: 200,
    publisher: { id: "pub-1", name: "3D모델러", avatar: null },
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    isOwner: false,
    access: "free",
  };

  it("acquires resource and adds to library", async () => {
    const { result } = renderHook(() => useMarketLibrary());
    expect(result.current.isAcquired("lib-res-1")).toBe(false);

    await act(async () => {
      await result.current.acquireResource(dummyRecord);
    });

    expect(result.current.isAcquired("lib-res-1")).toBe(true);
    expect(result.current.activeItems).toHaveLength(1);
    expect(result.current.activeItems[0].resource.name).toBe("성검 3D 소품");

    // Remove
    act(() => {
      result.current.removeItem(result.current.activeItems[0].id);
    });
    expect(result.current.isAcquired("lib-res-1")).toBe(false);
  });
});
