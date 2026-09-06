import { describe, expect, it } from "vitest";

import {
  applyStudioInlineFilterMaskMutation,
  collectStudioFilterMaskSurfaceIds,
  projectStudioFilterMaskElementsForServerSave,
  projectStudioFilterMaskPagesForServerSave,
  projectStudioFilterMaskSurfacesForRender,
} from "./studio-filter-mask-surface-projection";

const SURFACE_A = "filter-mask:v1:11111111-1111-4111-8111-111111111111";
const SURFACE_B = "filter-mask:v1:22222222-2222-4222-8222-222222222222";

describe("Studio filter-mask surface projection", () => {
  it("makes an inline edit authoritative by removing the durable surface own-property", () => {
    const authored = Object.freeze({
      id: "edited-mask",
      type: "image",
      filterMaskSurfaceId: SURFACE_A,
      filterMaskSrc: "data:image/png;base64,OLD",
      filterMaskEnabled: false,
      name: "before edit",
    });
    const edited = applyStudioInlineFilterMaskMutation(authored, {
      filterMaskSrc: "data:image/png;base64,NEW",
      filterMaskEnabled: true,
      name: "after edit",
    });

    expect(edited).toEqual({
      id: "edited-mask",
      type: "image",
      filterMaskSrc: "data:image/png;base64,NEW",
      filterMaskEnabled: true,
      name: "after edit",
    });
    expect(edited).not.toHaveProperty("filterMaskSurfaceId");
    expect(authored.filterMaskSurfaceId).toBe(SURFACE_A);

    const editedElements = [edited];
    const projection = projectStudioFilterMaskSurfacesForRender({
      elements: editedElements,
      hydrationRevision: 8,
      resolveState: () => {
        throw new Error("an invalidated surface must not be resolved");
      },
    });
    expect(projection.elements).toBe(editedElements);
    expect(projection.elements[0]!.filterMaskSrc).toBe("data:image/png;base64,NEW");
    expect(collectStudioFilterMaskSurfaceIds([edited])).toEqual([]);
  });

  it("physically removes mask fields for an inline delete instead of retaining undefined refs", () => {
    const deleted = applyStudioInlineFilterMaskMutation({
      id: "deleted-mask",
      type: "image",
      filterMaskSurfaceId: SURFACE_A,
      filterMaskSrc: "data:image/png;base64,OLD",
      filterMaskEnabled: true,
    }, {
      filterMaskSrc: undefined,
      filterMaskEnabled: undefined,
    });

    expect(deleted).toEqual({ id: "deleted-mask", type: "image" });
    expect(Object.hasOwn(deleted, "filterMaskSurfaceId")).toBe(false);
    expect(Object.hasOwn(deleted, "filterMaskSrc")).toBe(false);
    expect(Object.hasOwn(deleted, "filterMaskEnabled")).toBe(false);
  });

  it("collects only unique canonical image surface references", () => {
    expect(collectStudioFilterMaskSurfaceIds([
      { id: "a", type: "image", filterMaskSurfaceId: SURFACE_B },
      { id: "b", type: "image", filterMaskSurfaceId: SURFACE_A },
      { id: "c", type: "image", filterMaskSurfaceId: SURFACE_B },
      { id: "d", type: "text", filterMaskSurfaceId: SURFACE_A },
      { id: "e", type: "image", filterMaskSurfaceId: "filter-mask:v1:bad" },
    ])).toEqual([SURFACE_A, SURFACE_B]);
  });

  it("injects a ready Blob URL into a render clone without mutating authored state", () => {
    const authored = Object.freeze({
      id: "image-a",
      type: "image",
      filterMaskSurfaceId: SURFACE_A,
      filterMaskSrc: "data:image/png;base64,LOCAL",
    });
    const projection = projectStudioFilterMaskSurfacesForRender({
      elements: [authored],
      hydrationRevision: 3,
      resolveState: () => ({
        status: "ready",
        surfaceId: SURFACE_A,
        width: 512,
        height: 512,
        resourceUrl: "blob:mask-a",
        byteLength: 12,
      }),
    });

    expect(projection.elements[0]).toEqual({
      ...authored,
      filterMaskSrc: "blob:mask-a",
    });
    expect(projection.elements[0]).not.toBe(authored);
    expect(authored.filterMaskSrc).toBe("data:image/png;base64,LOCAL");
    expect(projection.pendingSurfaceIds).toEqual([]);
    expect(projection.errorSurfaceIds).toEqual([]);
  });

  it("fails closed while an exact surface is pending or failed", () => {
    const source = [
      {
        id: "image-a",
        type: "image",
        filterMaskSurfaceId: SURFACE_A,
        filterMaskSrc: "data:image/png;base64,STALE",
      },
      {
        id: "image-b",
        type: "image",
        filterMaskSurfaceId: SURFACE_B,
        filterMaskSrc: "data:image/png;base64,STALE",
      },
    ];
    const projection = projectStudioFilterMaskSurfacesForRender({
      elements: source,
      hydrationRevision: 4,
      resolveState: (surfaceId) => surfaceId === SURFACE_A
        ? { status: "loading", surfaceId }
        : { status: "error", surfaceId, code: "missing", message: "missing" },
    });

    expect(projection.elements[0]).not.toHaveProperty("filterMaskSrc");
    expect(projection.elements[1]).not.toHaveProperty("filterMaskSrc");
    expect(source[0]!.filterMaskSrc).toContain("STALE");
    expect(projection.pendingSurfaceIds).toEqual([SURFACE_A]);
    expect(projection.errorSurfaceIds).toEqual([SURFACE_B]);
  });

  it("preserves legacy inline masks with no surface reference", () => {
    const source = [{
      id: "legacy",
      type: "image",
      filterMaskSrc: "data:image/png;base64,LEGACY",
    }];
    const projection = projectStudioFilterMaskSurfacesForRender({
      elements: source,
      hydrationRevision: 0,
      resolveState: () => null,
    });
    expect(projection.elements).toBe(source);
  });

  it("strips only an ACKed surface fallback from a server-save clone", () => {
    const pages = [{
      id: "page-a",
      elements: [
        {
          id: "durable",
          type: "image",
          filterMaskSurfaceId: SURFACE_A,
          filterMaskSrc: "data:image/png;base64,A",
        },
        {
          id: "local",
          type: "image",
          filterMaskSurfaceId: SURFACE_B,
          filterMaskSrc: "data:image/png;base64,B",
        },
        {
          id: "legacy",
          type: "image",
          filterMaskSrc: "data:image/png;base64,C",
        },
      ],
    }];
    const projected = projectStudioFilterMaskPagesForServerSave(
      pages,
      (surfaceId) => surfaceId === SURFACE_A
    );

    expect(projected[0]!.elements[0]).not.toHaveProperty("filterMaskSrc");
    expect(projected[0]!.elements[1]).toHaveProperty(
      "filterMaskSrc",
      "data:image/png;base64,B"
    );
    expect(projected[0]!.elements[2]).toHaveProperty(
      "filterMaskSrc",
      "data:image/png;base64,C"
    );
    expect(pages[0]!.elements[0]).toHaveProperty(
      "filterMaskSrc",
      "data:image/png;base64,A"
    );
  });

  it("rejects a render-only Blob URL at every authored save boundary", () => {
    expect(() => projectStudioFilterMaskElementsForServerSave([
      {
        id: "leak",
        type: "image",
        filterMaskSurfaceId: SURFACE_A,
        filterMaskSrc: "blob:render-only",
      },
    ], () => true)).toThrow(/Blob URL/u);
  });
});
