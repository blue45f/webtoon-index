import { describe, expect, it } from "vitest";

import {
  STUDIO_TILEDOC_PRODUCT_RASTER_LAYER_ID,
  StudioTileDocProductIslandStore,
} from "./studio-tiledoc-product-island";

import type { StudioRasterImmutableTileFrame } from "../live/studio-crdt-raster-replay-runtime";

const surface = {
  version: 1,
  surfaceId: "raster:page:ink",
  width: 640,
  height: 600,
  tileSize: 512,
} as const;

function tile(
  tileX: number,
  tileY: number,
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
  sha256: string
): StudioRasterImmutableTileFrame {
  return {
    surfaceId: surface.surfaceId,
    tileX,
    tileY,
    width,
    height,
    byteLength: rgba.byteLength,
    sha256,
    rgba,
    copyRgba: () => new Uint8ClampedArray(rgba),
  };
}

describe("StudioTileDocProductIslandStore", () => {
  it("premultiplies straight RGBA and reuses unchanged immutable tile hashes", () => {
    const island = new StudioTileDocProductIslandStore(surface);
    const rgba = new Uint8ClampedArray(512 * 512 * 4);
    rgba.set([200, 100, 50, 128]);
    const frame = tile(0, 0, 512, 512, rgba, "a".repeat(64));

    expect(island.reconcile([frame])).toMatchObject({ written: 1, reused: 0, deleted: 0 });
    expect([...island.store.readTilePixels(
      STUDIO_TILEDOC_PRODUCT_RASTER_LAYER_ID,
      0,
      0
    )!.subarray(0, 4)]).toEqual([100, 50, 25, 128]);
    expect(island.reconcile([frame])).toMatchObject({ written: 0, reused: 1, deleted: 0 });
    island.dispose();
  });

  it("accepts exact partial edge tiles and deletes cells that leave the bounded replay viewport", () => {
    const island = new StudioTileDocProductIslandStore(surface);
    const edge = tile(
      1,
      1,
      128,
      88,
      new Uint8ClampedArray(128 * 88 * 4).fill(255),
      "b".repeat(64)
    );
    expect(island.reconcile([edge])).toMatchObject({ written: 1, inputTiles: 1 });
    expect(island.store.stats()).toMatchObject({ currentTileCount: 1, residentBytes: 1_048_576 });
    expect(island.reconcile([])).toMatchObject({ deleted: 1, inputTiles: 0 });
    expect(island.store.stats()).toMatchObject({ currentTileCount: 0, residentBytes: 0 });
    island.dispose();
  });

  it("fails closed on duplicate, malformed, or post-disposal input", () => {
    const island = new StudioTileDocProductIslandStore(surface);
    const rgba = new Uint8ClampedArray(512 * 512 * 4);
    rgba[3] = 255;
    const frame = tile(0, 0, 512, 512, rgba, "c".repeat(64));
    expect(() => island.reconcile([frame, frame])).toThrow(/Duplicate/u);
    expect(() => island.reconcile([{ ...frame, sha256: "bad" }])).toThrow(/Invalid/u);
    island.dispose();
    expect(() => island.reconcile([])).toThrow(/disposed/u);
  });
});
