import { describe, expect, it } from "vitest";

import {
  CREATOR_MARKETPLACE_RESOURCE_KINDS,
  CreatorMarketplaceResourceRecordSchema,
} from "./creator-marketplace-resource-contract";
import {
  CREATOR_MARKETPLACE_STARTER_RECORDS,
  filterStarterMarketplaceResources,
  findStarterMarketplaceResourceById,
} from "./creator-marketplace-starter-catalog";

describe("creator-marketplace-starter-catalog", () => {
  it("provides valid starter records that satisfy the strict marketplace record schema", () => {
    expect(CREATOR_MARKETPLACE_STARTER_RECORDS.length).toBeGreaterThanOrEqual(10);
    for (const record of CREATOR_MARKETPLACE_STARTER_RECORDS) {
      expect(() => CreatorMarketplaceResourceRecordSchema.parse(record)).not.toThrow();
    }
  });

  it("covers every single supported resource kind including 3d-asset", () => {
    const coveredKinds = new Set(CREATOR_MARKETPLACE_STARTER_RECORDS.map((r) => r.kind));
    for (const kind of CREATOR_MARKETPLACE_RESOURCE_KINDS) {
      expect(coveredKinds.has(kind)).toBe(true);
    }
  });

  it("filters starter resources by kind, tag, search, and license", () => {
    const assets3d = filterStarterMarketplaceResources({ kind: "3d-asset" });
    expect(assets3d.items.length).toBeGreaterThanOrEqual(2);
    expect(assets3d.items.every((r) => r.kind === "3d-asset")).toBe(true);

    const searched = filterStarterMarketplaceResources({ search: "교실" });
    expect(searched.items.length).toBeGreaterThanOrEqual(1);

    const tagFiltered = filterStarterMarketplaceResources({ tag: "3D" });
    expect(tagFiltered.items.length).toBeGreaterThanOrEqual(2);
  });

  it("finds starter resource by ID", () => {
    const first = CREATOR_MARKETPLACE_STARTER_RECORDS[0]!;
    const found = findStarterMarketplaceResourceById(first.id);
    expect(found).toEqual(first);
    expect(findStarterMarketplaceResourceById("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
