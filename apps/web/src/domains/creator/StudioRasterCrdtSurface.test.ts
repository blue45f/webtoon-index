import { describe, expect, it } from "vitest";

import {
  studioRasterOperationIntersectsDocumentRect,
  studioRasterTileIntersectsDocumentRect,
  studioRasterVisibleDocumentRectFromViewport,
} from "./render/studio-raster-visible-rect";

import type { StudioRasterOperation } from "@/shared/lib/studio-crdt-raster-ops";

const surfaceId = "raster:page-a:ink";

function operationAt(
  ...tiles: readonly (readonly [tileX: number, tileY: number])[]
): Pick<StudioRasterOperation, "patches"> {
  return {
    patches: tiles.map(([tileX, tileY]) => ({
      tileX,
      tileY,
      region: { x: 0, y: 0, width: 1, height: 1 },
      effect: {
        kind: "composite" as const,
        blendMode: "source-over" as const,
        payload: {
          scope: "work" as const,
          assetId: `asset-${tileX}-${tileY}`,
          sha256: "a".repeat(64),
          byteLength: 1,
          mediaType: "image/png" as const,
          width: 1,
          height: 1,
        },
      },
    })),
  };
}

describe("StudioRasterCrdtSurface visible tile filter", () => {
  it("derives the logical visible rectangle for normal and horizontally flipped viewports", () => {
    const viewport = {
      surface: { left: 200, top: 300, width: 360, height: 480 },
      transform: {
        scaleX: 2,
        scaleY: 2.5,
        offsetX: -400,
        offsetY: -750,
        flipX: false,
      },
    } as const;
    expect(studioRasterVisibleDocumentRectFromViewport({
      viewport,
      documentWidth: 720,
      documentHeight: 1_200,
      documentScale: 2,
    })).toEqual({ x: 100, y: 150, width: 180, height: 240 });
    expect(studioRasterVisibleDocumentRectFromViewport({
      viewport: { ...viewport, transform: { ...viewport.transform, flipX: true } },
      documentWidth: 720,
      documentHeight: 1_200,
      documentScale: 2,
    })).toEqual({ x: 440, y: 150, width: 180, height: 240 });
  });

  it("fails closed when viewport dimensions or scale are invalid", () => {
    expect(studioRasterVisibleDocumentRectFromViewport({
      viewport: null,
      documentWidth: 720,
      documentHeight: 1_200,
      documentScale: 1,
    })).toBeNull();
    expect(studioRasterVisibleDocumentRectFromViewport({
      viewport: {
        surface: { left: 0, top: 0, width: 360, height: 480 },
        transform: { scaleX: 2, scaleY: 2, offsetX: 0, offsetY: 0, flipX: false },
      },
      documentWidth: 720,
      documentHeight: 1_200,
      documentScale: 0,
    })).toBeNull();
  });

  it("selects intersecting tiles and excludes exact edge contacts", () => {
    const rect = { x: 512, y: 512, width: 512, height: 512 };
    expect(studioRasterTileIntersectsDocumentRect({
      surfaceId,
      tileX: 1,
      tileY: 1,
      width: 512,
      height: 512,
    }, rect, 512)).toBe(true);
    expect(studioRasterTileIntersectsDocumentRect({
      surfaceId,
      tileX: 0,
      tileY: 1,
      width: 512,
      height: 512,
    }, rect, 512)).toBe(false);
    expect(studioRasterTileIntersectsDocumentRect({
      surfaceId,
      tileX: 2,
      tileY: 1,
      width: 512,
      height: 512,
    }, rect, 512)).toBe(false);
  });

  it("uses actual partial-tile dimensions at the document edge", () => {
    expect(studioRasterTileIntersectsDocumentRect({
      surfaceId,
      tileX: 1,
      tileY: 2,
      width: 288,
      height: 176,
    }, { x: 790, y: 1_100, width: 10, height: 100 }, 512)).toBe(true);
    expect(studioRasterTileIntersectsDocumentRect({
      surfaceId,
      tileX: 1,
      tileY: 2,
      width: 288,
      height: 176,
    }, { x: 0, y: 0, width: 100, height: 100 }, 512)).toBe(false);
  });

  it("projects the handoff operation list to only tiles intersecting the viewport", () => {
    const surface = { surfaceId, width: 1_024, height: 1_024, tileSize: 512 };
    const visible = { x: 0, y: 0, width: 512, height: 512 };
    expect(studioRasterOperationIntersectsDocumentRect(
      operationAt([0, 0]),
      surface,
      visible
    )).toBe(true);
    expect(studioRasterOperationIntersectsDocumentRect(
      operationAt([1, 0]),
      surface,
      visible
    )).toBe(false);
    expect(studioRasterOperationIntersectsDocumentRect(
      operationAt([1, 0], [0, 0]),
      surface,
      visible
    )).toBe(true);
  });

  it("keeps a blank viewport's visible handoff subset empty while off-screen ink exists", () => {
    const surface = { surfaceId, width: 1_024, height: 1_024, tileSize: 512 };
    const blankViewport = { x: 0, y: 0, width: 512, height: 512 };
    const pageOperations = [operationAt([1, 0]), operationAt([1, 1])];
    expect(pageOperations.filter((operation) => (
      studioRasterOperationIntersectsDocumentRect(operation, surface, blankViewport)
    ))).toEqual([]);
  });

  it("fails closed for invalid visible rectangles", () => {
    const tile = { surfaceId, tileX: 0, tileY: 0, width: 512, height: 512 };
    expect(studioRasterTileIntersectsDocumentRect(
      tile,
      { x: 0, y: 0, width: 0, height: 100 },
      512
    )).toBe(false);
    expect(studioRasterTileIntersectsDocumentRect(
      tile,
      { x: Number.NaN, y: 0, width: 100, height: 100 },
      512
    )).toBe(false);
    expect(studioRasterTileIntersectsDocumentRect(
      tile,
      { x: 0, y: 0, width: 100, height: 100 },
      0
    )).toBe(false);
  });
});
