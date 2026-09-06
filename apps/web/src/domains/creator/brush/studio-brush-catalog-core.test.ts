import { describe, expect, it } from "vitest";

import {
  STUDIO_CORE_BRUSH_CATALOG_ITEMS,
  STUDIO_LISTED_CORE_BRUSH_CATALOG_ITEMS,
  listStudioCoreQuickBrushCatalogItems,
  studioCoreBrushCatalogItemById,
} from "./studio-brush-catalog-core";
import { STUDIO_BRUSH_QUARANTINED_PRESET_IDS } from "./studio-brush-quarantine";

describe("studio brush catalog core quarantine lanes", () => {
  it("splits the core inventory into an unfiltered SSOT and a listed view", () => {
    expect(STUDIO_BRUSH_QUARANTINED_PRESET_IDS.length).toBeGreaterThan(0);
    const quarantined = new Set(STUDIO_BRUSH_QUARANTINED_PRESET_IDS);

    // The ledger spans both partitions since the 2026-08-21 roster reduction, and this module owns
    // only the core one — so assert core ids against the core SSOT and require that the ids this
    // module does NOT own are genuinely absent from it rather than silently skipped.
    const coreIds = new Set(STUDIO_CORE_BRUSH_CATALOG_ITEMS.map((item) => item.id));
    const quarantinedCoreIds = STUDIO_BRUSH_QUARANTINED_PRESET_IDS.filter((id) => coreIds.has(id));
    expect(quarantinedCoreIds.length).toBeGreaterThan(0);
    for (const quarantinedId of quarantinedCoreIds) {
      // A quarantined core lane variant must stay in the core SSOT…
      expect(
        STUDIO_CORE_BRUSH_CATALOG_ITEMS.some((item) => item.id === quarantinedId),
        `${quarantinedId}: left the core SSOT`
      ).toBe(true);
      // …and metadata RESOLUTION for saved documents stays unfiltered.
      expect(
        studioCoreBrushCatalogItemById(quarantinedId)?.id,
        `${quarantinedId}: saved-document resolution lost`
      ).toBe(quarantinedId);
    }
    for (const quarantinedId of STUDIO_BRUSH_QUARANTINED_PRESET_IDS) {
      if (coreIds.has(quarantinedId)) continue;
      // Pro-pack ledger entries: this module must not resolve them at all (the lazy pack index
      // owns that), so a null here proves the launch-safe core chunk still excludes the pack.
      expect(
        studioCoreBrushCatalogItemById(quarantinedId),
        `${quarantinedId}: leaked into the launch-safe core chunk`
      ).toBeNull();
    }
    expect(
      STUDIO_LISTED_CORE_BRUSH_CATALOG_ITEMS.some((item) => quarantined.has(item.id))
    ).toBe(false);
  });

  it("keeps non-quarantined core listings byte-identical to the SSOT", () => {
    const quarantined = new Set(STUDIO_BRUSH_QUARANTINED_PRESET_IDS);
    const expected = STUDIO_CORE_BRUSH_CATALOG_ITEMS.filter(
      (item) => !quarantined.has(item.id)
    );
    expect(STUDIO_LISTED_CORE_BRUSH_CATALOG_ITEMS).toHaveLength(expected.length);
    STUDIO_LISTED_CORE_BRUSH_CATALOG_ITEMS.forEach((item, index) => {
      expect(item).toBe(expected[index]);
    });
  });

  it("keeps quarantined favorites/MRU off the default quick shelf without holes", () => {
    const quarantinedId = STUDIO_BRUSH_QUARANTINED_PRESET_IDS[0]!;
    const quick = listStudioCoreQuickBrushCatalogItems({
      favoriteIds: [quarantinedId, "pen"],
      recentIds: [quarantinedId, "marker"],
      limit: 4,
    });
    expect(quick.some((item) => item.id === quarantinedId)).toBe(false);
    // Skipped, never a hole: listed neighbours keep their slots and the shelf stays full.
    expect(quick.map(({ id, quickSource }) => [id, quickSource])).toEqual([
      ["pen", "favorite"],
      ["marker", "recent"],
      ["gpen", "starter"],
      ["fountain-pen", "starter"],
    ]);
  });

  it("uses injected catalogItems verbatim so lanes are filtered exactly once", () => {
    const quarantinedId = STUDIO_BRUSH_QUARANTINED_PRESET_IDS[0]!;
    // A caller who injects owns its lane's filtering — the quick shelf must not layer a second
    // quarantine filter on top, or the two lanes could drift apart.
    const quick = listStudioCoreQuickBrushCatalogItems({
      catalogItems: STUDIO_CORE_BRUSH_CATALOG_ITEMS,
      favoriteIds: [quarantinedId],
      limit: 2,
    });
    expect(quick[0]?.id).toBe(quarantinedId);
    expect(quick[0]?.quickSource).toBe("favorite");
  });
});
