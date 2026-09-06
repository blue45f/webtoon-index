import { describe, expect, it } from "vitest";

import {
  STUDIO_BRUSH_PACK_CATALOG_IDS,
  isStudioBrushPackCatalogId,
} from "./studio-brush-pack-id";

describe("procedural brush pack ids", () => {
  it("publishes exactly 160 stable, unique catalogue ids", () => {
    expect(STUDIO_BRUSH_PACK_CATALOG_IDS).toHaveLength(160);
    expect(new Set(STUDIO_BRUSH_PACK_CATALOG_IDS).size).toBe(160);
    for (const id of STUDIO_BRUSH_PACK_CATALOG_IDS) {
      expect(id).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
      expect(isStudioBrushPackCatalogId(id)).toBe(true);
    }
  });

  it("rejects unknown and non-string catalogue identities", () => {
    expect(isStudioBrushPackCatalogId("pen")).toBe(false);
    expect(isStudioBrushPackCatalogId("heart_stamp")).toBe(false);
    expect(isStudioBrushPackCatalogId(67)).toBe(false);
    expect(isStudioBrushPackCatalogId(null)).toBe(false);
  });
});
