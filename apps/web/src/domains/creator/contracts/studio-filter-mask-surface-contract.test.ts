import { describe, expect, it } from "vitest";

import {
  STUDIO_FILTER_MASK_SURFACE_MAX_EDGE,
  STUDIO_FILTER_MASK_SURFACE_TILE_SIZE,
  StudioFilterMaskReferencePropsSchema,
  StudioFilterMaskSurfaceIdSchema,
  createStudioFilterMaskSurfaceId,
  createStudioFilterMaskSurfaceSpec,
  isStudioFilterMaskReferenceProps,
  isStudioFilterMaskSurfaceId,
  isStudioFilterMaskSurfaceSpec,
} from "./studio-filter-mask-surface-contract";

const UUID = "10000000-0000-4000-8000-000000000001";
const SURFACE_ID = `filter-mask:v1:${UUID}`;

describe("Studio filter-mask surface contract", () => {
  it("creates one exact namespaced immutable surface and reference payload", () => {
    const surfaceId = createStudioFilterMaskSurfaceId(UUID);
    const surface = createStudioFilterMaskSurfaceSpec({
      surfaceId,
      width: STUDIO_FILTER_MASK_SURFACE_MAX_EDGE,
      height: 1,
    });

    expect(surfaceId).toBe(SURFACE_ID);
    expect(StudioFilterMaskSurfaceIdSchema.parse(surfaceId)).toBe(surfaceId);
    expect(surface).toEqual({
      version: 1,
      surfaceId,
      width: STUDIO_FILTER_MASK_SURFACE_MAX_EDGE,
      height: 1,
      tileSize: STUDIO_FILTER_MASK_SURFACE_TILE_SIZE,
    });
    expect(isStudioFilterMaskSurfaceSpec(surface)).toBe(true);
    expect(isStudioFilterMaskReferenceProps({
      filterMaskSurfaceId: surfaceId,
      filterMaskEnabled: false,
    })).toBe(true);
  });

  it("rejects alternate spellings, URLs, inline bytes, and malformed reference state", () => {
    for (const value of [
      UUID,
      `filter-mask:v2:${UUID}`,
      "filter-mask:v1:ABCDEFAB-CDEF-4ABC-8ABC-ABCDEFABCDEF",
      "data:image/png;base64,AA==",
      "https://example.test/mask.png",
      "filter-mask:v1:00000000-0000-0000-0000-000000000000",
      "",
      null,
    ]) {
      expect(isStudioFilterMaskSurfaceId(value), String(value)).toBe(false);
    }

    expect(StudioFilterMaskReferencePropsSchema.safeParse({}).success).toBe(false);
    expect(StudioFilterMaskReferencePropsSchema.safeParse({
      filterMaskSurfaceId: SURFACE_ID,
      filterMaskEnabled: "yes",
    }).success).toBe(false);
    expect(StudioFilterMaskReferencePropsSchema.safeParse({
      filterMaskSurfaceId: SURFACE_ID,
      filterMaskSrc: "data:image/png;base64,AA==",
    }).success).toBe(false);
  });

  it("enforces the dedicated tile size, bounded integer dimensions, and exact keys", () => {
    const valid = {
      version: 1,
      surfaceId: SURFACE_ID,
      width: 1,
      height: STUDIO_FILTER_MASK_SURFACE_MAX_EDGE,
      tileSize: STUDIO_FILTER_MASK_SURFACE_TILE_SIZE,
    };
    expect(isStudioFilterMaskSurfaceSpec(valid)).toBe(true);

    for (const candidate of [
      { ...valid, width: 0 },
      { ...valid, width: 1.5 },
      { ...valid, height: STUDIO_FILTER_MASK_SURFACE_MAX_EDGE + 1 },
      { ...valid, tileSize: 512 },
      { ...valid, version: 2 },
      { ...valid, src: "data:image/png;base64,AA==" },
    ]) {
      expect(isStudioFilterMaskSurfaceSpec(candidate), JSON.stringify(candidate)).toBe(false);
    }
  });
});
