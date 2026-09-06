import { describe, expect, it } from "vitest";

import { attachStudioFilterMaskSurfaceAcrossHistory } from "./studio-filter-mask-surface-admission";

const INLINE = "data:image/png;base64,bWFzaw==";
const SURFACE = "filter-mask:v1:123e4567-e89b-42d3-a456-426614174000";

function page(
  filterMaskSrc: string | undefined = INLINE,
  filterMaskSurfaceId?: string
) {
  return {
    id: "page-1",
    elements: [{
      id: "image-1",
      type: "image",
      ...(filterMaskSrc ? { filterMaskSrc } : {}),
      ...(filterMaskSurfaceId ? { filterMaskSurfaceId } : {}),
    }],
  };
}

describe("attachStudioFilterMaskSurfaceAcrossHistory", () => {
  it("canonicalizes every exact redo snapshot without mutating the source history", () => {
    const history = [[page()], [page()], [{ id: "page-1", elements: [] }]];
    const result = attachStudioFilterMaskSurfaceAcrossHistory({
      history,
      currentIndex: 1,
      targetElementId: "image-1",
      expectedInlineSource: INLINE,
      surfaceId: SURFACE,
    });

    expect(result.changed).toBe(true);
    expect(result.history[0]?.[0]?.elements[0]).toMatchObject({
      filterMaskSrc: INLINE,
      filterMaskSurfaceId: SURFACE,
      filterMaskEnabled: true,
    });
    expect(result.history[1]?.[0]?.elements[0]).toMatchObject({
      filterMaskSurfaceId: SURFACE,
    });
    expect(result.history[2]?.[0]?.elements).toEqual([]);
    expect(history[0]?.[0]?.elements[0]).not.toHaveProperty("filterMaskSurfaceId");
  });

  it("rejects a late receipt after the current mask changed", () => {
    const changedInline = "data:image/png;base64,bmV3";
    const history = [[page()], [page(changedInline)]];
    const result = attachStudioFilterMaskSurfaceAcrossHistory({
      history,
      currentIndex: 1,
      targetElementId: "image-1",
      expectedInlineSource: INLINE,
      surfaceId: SURFACE,
    });

    expect(result.changed).toBe(false);
    expect(result.nextCurrentPages).toBe(result.previousCurrentPages);
    expect(result.history[0]?.[0]?.elements[0]).not.toHaveProperty("filterMaskSurfaceId");
  });

  it("does not overwrite a newer immutable surface identity", () => {
    const newer = "filter-mask:v1:223e4567-e89b-42d3-a456-426614174000";
    const history = [[page(INLINE, newer)]];
    const result = attachStudioFilterMaskSurfaceAcrossHistory({
      history,
      currentIndex: 0,
      targetElementId: "image-1",
      expectedInlineSource: INLINE,
      surfaceId: SURFACE,
    });

    expect(result.changed).toBe(false);
    expect(result.history[0]?.[0]?.elements[0]).toMatchObject({
      filterMaskSurfaceId: newer,
    });
  });

  it("fails before traversal for an invalid surface id or non-PNG fallback", () => {
    expect(() => attachStudioFilterMaskSurfaceAcrossHistory({
      history: [[page()]],
      currentIndex: 0,
      targetElementId: "image-1",
      expectedInlineSource: INLINE,
      surfaceId: "surface-1",
    })).toThrow("surface ID");
    expect(() => attachStudioFilterMaskSurfaceAcrossHistory({
      history: [[page()]],
      currentIndex: 0,
      targetElementId: "image-1",
      expectedInlineSource: "blob:mask",
      surfaceId: SURFACE,
    })).toThrow("승인 대상");
  });
});
