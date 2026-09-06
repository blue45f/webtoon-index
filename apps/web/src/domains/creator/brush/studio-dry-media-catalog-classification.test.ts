import { describe, expect, it } from "vitest";

import { STUDIO_BRUSH_PACK_DESCRIPTORS } from "./studio-brush-pack-index";
import {
  classifyStudioDryMediaCatalogIdV1,
  resolveStudioDryMediaAnisotropicPresetIdV1,
  STUDIO_DRY_MEDIA_ANISOTROPIC_CATALOG_PRESETS_V1,
  STUDIO_DRY_MEDIA_INTENTIONAL_DISCRETE_CATALOG_IDS_V1,
} from "./studio-dry-media-anisotropic-grain-v1";

describe("dry-media catalogue classification v1", () => {
  const dryDescriptors = STUDIO_BRUSH_PACK_DESCRIPTORS.filter(
    ({ runtimeBrushId }) => runtimeBrushId === "dry-media",
  );
  const anisotropicIds = new Set(
    Object.keys(STUDIO_DRY_MEDIA_ANISOTROPIC_CATALOG_PRESETS_V1),
  );
  const discreteIds = new Set<string>(
    STUDIO_DRY_MEDIA_INTENTIONAL_DISCRETE_CATALOG_IDS_V1,
  );

  it("classifies every shipped dry-media catalogue item exactly once", () => {
    expect(dryDescriptors).toHaveLength(61);
    expect([...anisotropicIds].filter((id) => discreteIds.has(id))).toEqual([]);

    const shippedIds = new Set(dryDescriptors.map(({ catalogId }) => catalogId));
    expect(new Set([...anisotropicIds, ...discreteIds])).toEqual(shippedIds);

    for (const descriptor of dryDescriptors) {
      const classification = classifyStudioDryMediaCatalogIdV1(
        descriptor.catalogId,
      );
      expect(
        classification,
        `${descriptor.catalogId}: unclassified dry-media catalogue identity`,
      ).not.toBeNull();
      if (!classification) continue;
      if (classification.kind === "anisotropic-continuous") {
        expect(resolveStudioDryMediaAnisotropicPresetIdV1(
          descriptor.runtimeBrushId,
          descriptor.catalogId,
        )).toBe(classification.presetId);
      } else {
        expect(resolveStudioDryMediaAnisotropicPresetIdV1(
          descriptor.runtimeBrushId,
          descriptor.catalogId,
        )).toBeNull();
      }
    }
  });

  it("keeps motif/stamp media explicit instead of silently treating them as unknown", () => {
    for (const catalogId of STUDIO_DRY_MEDIA_INTENTIONAL_DISCRETE_CATALOG_IDS_V1) {
      expect(classifyStudioDryMediaCatalogIdV1(catalogId)).toEqual({
        kind: "intentional-discrete",
      });
    }
    expect(classifyStudioDryMediaCatalogIdV1("unshipped-dry-brush")).toBeNull();
  });
});
