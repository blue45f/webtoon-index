// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import {
  deleteCustomPublishedResource,
  findMergedMarketResourceById,
  getAllMergedMarketResources,
  getCustomPublishedResources,
  saveCustomPublishedResource,
  updateCustomPublishedResource,
} from "./market-custom-registry";

import type { CreatorMarketplaceResourceRecord } from "@/shared/lib/creator-marketplace-resource-contract";

describe("market-custom-registry", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const sample: CreatorMarketplaceResourceRecord = {
    schemaVersion: 1,
    id: "test-custom-1",
    packageId: "user/brush/pen",
    name: "테스트용 G펜",
    description: "테스트 브러시",
    kind: "brush",
    resourceVersion: "1.0.0",
    minimumStudioVersion: "0.1.0",
    tags: ["선화", "G펜"],
    license: "toonspectrum-standard",
    attributionText: "",
    containsAi: false,
    provenance: { origin: "original", authoredByPublisher: true },
    compatibility: { engines: ["canvas2d"] },
    entries: [],
    manifestHash: "0".repeat(64),
    manifestByteSize: 100,
    publisher: { id: "user-1", name: "테스트 작가", avatar: null },
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    isOwner: true,
    access: "free",
  };

  it("saves, updates, and deletes custom published resource", () => {
    saveCustomPublishedResource(sample);
    const list = getCustomPublishedResources();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("테스트용 G펜");

    // Update
    const updated = updateCustomPublishedResource("test-custom-1", {
      name: "업데이트된 G펜",
      resourceVersion: "1.1.0",
    });
    expect(updated?.name).toBe("업데이트된 G펜");
    expect(updated?.resourceVersion).toBe("1.1.0");

    // Retrieve via merged finder
    const found = findMergedMarketResourceById("test-custom-1");
    expect(found?.name).toBe("업데이트된 G펜");

    // Delete
    deleteCustomPublishedResource("test-custom-1");
    expect(getCustomPublishedResources()).toHaveLength(0);
  });

  it("merges custom resources with starter catalog", () => {
    saveCustomPublishedResource(sample);
    const all = getAllMergedMarketResources();
    expect(all.length).toBeGreaterThan(1);
    expect(all[0].id).toBe("test-custom-1"); // prepended
  });
});
