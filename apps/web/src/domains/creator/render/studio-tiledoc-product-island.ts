/**
 * Product adapter from immutable CRDT raster tiles to the stable tiled-document authority.
 *
 * The CRDT replay lane exposes straight RGBA while StudioTiledDocumentStore owns premultiplied
 * RGBA. This adapter performs that conversion once per changed SHA-256, keeps only the bounded
 * replay viewport, and never treats a missing/invalid tile as successfully imported.
 */

import { StudioTiledDocumentStore } from "./studio-tiledoc-store";

import type { StudioRasterImmutableTileFrame } from "../live/studio-crdt-raster-replay-runtime";
import type { StudioRasterSurfaceSpec } from "@/shared/lib/studio-crdt-raster-ops";

export const STUDIO_TILEDOC_PRODUCT_RASTER_LAYER_ID = "studio-raster-crdt";

export interface StudioTileDocProductIslandReconcileResult {
  readonly written: number;
  readonly reused: number;
  readonly deleted: number;
  readonly inputTiles: number;
  readonly residentBytes: number;
}

function tileId(tile: Pick<StudioRasterImmutableTileFrame, "tileX" | "tileY">): string {
  return `${tile.tileX}:${tile.tileY}`;
}

function premultiplyChannel(channel: number, alpha: number): number {
  if (alpha <= 0) return 0;
  if (alpha >= 255) return channel;
  return Math.round(channel * alpha / 255);
}

function validTile(surface: StudioRasterSurfaceSpec, tile: StudioRasterImmutableTileFrame): boolean {
  const expectedWidth = Math.min(surface.tileSize, surface.width - tile.tileX * surface.tileSize);
  const expectedHeight = Math.min(surface.tileSize, surface.height - tile.tileY * surface.tileSize);
  return tile.surfaceId === surface.surfaceId
    && Number.isSafeInteger(tile.tileX)
    && tile.tileX >= 0
    && Number.isSafeInteger(tile.tileY)
    && tile.tileY >= 0
    && tile.width === expectedWidth
    && tile.height === expectedHeight
    && tile.width > 0
    && tile.height > 0
    && tile.byteLength === tile.width * tile.height * 4
    && tile.rgba.byteLength === tile.byteLength
    && /^[a-f0-9]{64}$/u.test(tile.sha256);
}

export class StudioTileDocProductIslandStore {
  public readonly store: StudioTiledDocumentStore;
  private readonly surface: StudioRasterSurfaceSpec;
  private readonly hashes = new Map<string, string>();
  private disposed = false;

  public constructor(surface: StudioRasterSurfaceSpec) {
    if (
      !Number.isSafeInteger(surface.width)
      || surface.width <= 0
      || !Number.isSafeInteger(surface.height)
      || surface.height <= 0
      || !Number.isSafeInteger(surface.tileSize)
      || surface.tileSize <= 0
    ) {
      throw new RangeError("Studio tiledoc product island requires positive integer geometry");
    }
    this.surface = Object.freeze({ ...surface });
    this.store = new StudioTiledDocumentStore({
      documentWidth: surface.width,
      documentHeight: surface.height,
      tileSize: surface.tileSize,
    });
  }

  public reconcile(
    tiles: readonly StudioRasterImmutableTileFrame[]
  ): StudioTileDocProductIslandReconcileResult {
    if (this.disposed) throw new Error("Studio tiledoc product island is disposed");
    const incoming = new Set<string>();
    let written = 0;
    let reused = 0;
    for (const tile of tiles) {
      if (!validTile(this.surface, tile)) {
        throw new Error(`Invalid Studio raster tile ${tileId(tile)}`);
      }
      const id = tileId(tile);
      if (incoming.has(id)) throw new Error(`Duplicate Studio raster tile ${id}`);
      incoming.add(id);
      if (this.hashes.get(id) === tile.sha256) {
        reused += 1;
        continue;
      }
      const result = this.store.writeTile(
        STUDIO_TILEDOC_PRODUCT_RASTER_LAYER_ID,
        tile.tileX,
        tile.tileY,
        (pixels, context) => {
          pixels.fill(0);
          for (let row = 0; row < tile.height; row += 1) {
            for (let column = 0; column < tile.width; column += 1) {
              const source = (row * tile.width + column) * 4;
              const target = (row * context.tileSize + column) * 4;
              const alpha = tile.rgba[source + 3]!;
              pixels[target] = premultiplyChannel(tile.rgba[source]!, alpha);
              pixels[target + 1] = premultiplyChannel(tile.rgba[source + 1]!, alpha);
              pixels[target + 2] = premultiplyChannel(tile.rgba[source + 2]!, alpha);
              pixels[target + 3] = alpha;
            }
          }
        }
      );
      if (result.status !== "written" && result.status !== "pruned") {
        throw new Error(`Studio raster tile ${id} could not enter tiledoc (${result.status})`);
      }
      this.hashes.set(id, tile.sha256);
      written += 1;
    }

    let deleted = 0;
    for (const id of [...this.hashes.keys()]) {
      if (incoming.has(id)) continue;
      const [columnText, rowText] = id.split(":");
      const column = Number(columnText);
      const row = Number(rowText);
      if (this.store.deleteTile(STUDIO_TILEDOC_PRODUCT_RASTER_LAYER_ID, column, row)) {
        deleted += 1;
      }
      this.hashes.delete(id);
    }
    return Object.freeze({
      written,
      reused,
      deleted,
      inputTiles: tiles.length,
      residentBytes: this.store.stats().residentBytes,
    });
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.hashes.clear();
    this.store.dispose();
  }
}
