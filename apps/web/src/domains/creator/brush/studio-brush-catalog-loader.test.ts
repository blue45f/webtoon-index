import { describe, expect, it } from "vitest";

import {
  loadStudioBrushCatalogItemById,
  loadStudioFullBrushCatalogItems,
  loadStudioListedBrushCatalogItems,
} from "./studio-brush-catalog-loader";
import { STUDIO_BRUSH_QUARANTINED_PRESET_IDS } from "./studio-brush-quarantine";

describe("studio brush catalog loader lanes", () => {
  it("keeps quarantined ids out of the deferred LISTING lane", async () => {
    // The ledger must be non-empty for these lane tests to prove anything.
    expect(STUDIO_BRUSH_QUARANTINED_PRESET_IDS.length).toBeGreaterThan(0);

    const listed = await loadStudioListedBrushCatalogItems();
    const quarantined = new Set(STUDIO_BRUSH_QUARANTINED_PRESET_IDS);
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.some((item) => quarantined.has(item.id))).toBe(false);
  });

  it("keeps saved-document metadata RESOLUTION unfiltered", async () => {
    const full = await loadStudioFullBrushCatalogItems();
    for (const quarantinedId of STUDIO_BRUSH_QUARANTINED_PRESET_IDS) {
      expect(
        full.some((item) => item.id === quarantinedId),
        `${quarantinedId}: left the unfiltered SSOT lane`
      ).toBe(true);
      const resolved = await loadStudioBrushCatalogItemById(quarantinedId);
      expect(resolved?.id, `${quarantinedId}: saved-document resolution lost`).toBe(
        quarantinedId
      );
    }
  });

  it("keeps non-quarantined listings byte-identical to the unfiltered SSOT", async () => {
    const [full, listed] = await Promise.all([
      loadStudioFullBrushCatalogItems(),
      loadStudioListedBrushCatalogItems(),
    ]);
    const quarantined = new Set(STUDIO_BRUSH_QUARANTINED_PRESET_IDS);
    const expected = full.filter((item) => !quarantined.has(item.id));
    expect(listed).toHaveLength(expected.length);
    // Same frozen item objects in SSOT order — the listing filter must not clone, reorder, or
    // reshape a single non-quarantined row.
    listed.forEach((item, index) => {
      expect(item).toBe(expected[index]);
    });
  });
});
