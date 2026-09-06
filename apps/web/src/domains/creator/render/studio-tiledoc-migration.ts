/**
 * Migration from the current full-page-bitmap layer model to the tiled store, plus the cost model
 * that justifies it.
 *
 * Today a raster layer is an `ImageEl.src` data URL of the *whole* layer at its natural
 * resolution; every destructive pixel operation re-encodes the whole thing and pushes a new
 * `PageState[]` onto the undo history. The functions here quantify that and produce the slicing
 * plan that turns one decoded bitmap into the tiles a `StudioTiledDocumentStore` should hold.
 *
 * All functions are pure arithmetic/geometry — no canvas, no decode — so the numbers are
 * assertable in a headless test.
 */

import {
  resolveStudioTileDocTileSize,
  studioTileDocTilesForRect,
  type StudioTileDocRect,
  type StudioTileDocTileAddress,
} from "./studio-tiledoc-geometry";

/** RGBA8. Matches both the legacy decoded bitmap and a storage tile payload. */
export const STUDIO_TILEDOC_BYTES_PER_PIXEL = 4;

/**
 * Base64 inflates PNG bytes by 4/3 plus the `data:image/png;base64,` prefix. Used only to model
 * what the *encoded* string costs on the JS heap, which is what today's history retains.
 */
export const STUDIO_TILEDOC_BASE64_RATIO = 4 / 3;

export interface StudioTileDocFullPageInput {
  readonly width: number;
  readonly height: number;
  readonly layerCount: number;
  readonly bytesPerPixel?: number;
}

/** Decoded bytes for `layerCount` full-page layer bitmaps. */
export function studioTileDocFullPageBytes(input: StudioTileDocFullPageInput): number {
  const bytesPerPixel = input.bytesPerPixel ?? STUDIO_TILEDOC_BYTES_PER_PIXEL;
  return Math.max(0, Math.floor(input.width))
    * Math.max(0, Math.floor(input.height))
    * bytesPerPixel
    * Math.max(0, Math.floor(input.layerCount));
}

export interface StudioTileDocEncodedHistoryInput {
  readonly width: number;
  readonly height: number;
  /** Destructive edits retained in undo history. Each one re-encodes one whole layer. */
  readonly edits: number;
  /** Encoded PNG size as a fraction of raw RGBA. Webtoon line art / flats sit near 0.10. */
  readonly compressionRatio?: number;
}

/**
 * JS-heap cost of today's model: one base64 data URL per destructive edit, retained for as long as
 * the undo entry lives. Decoded bitmaps are on top of this and are counted separately.
 */
export function studioTileDocEncodedHistoryBytes(
  input: StudioTileDocEncodedHistoryInput
): number {
  const ratio = input.compressionRatio ?? 0.1;
  const raw = Math.max(0, Math.floor(input.width))
    * Math.max(0, Math.floor(input.height))
    * STUDIO_TILEDOC_BYTES_PER_PIXEL;
  return Math.round(raw * ratio * STUDIO_TILEDOC_BASE64_RATIO * Math.max(0, Math.floor(input.edits)));
}

export interface StudioTileDocHistoryModelInput {
  /** Tiles the layer holds before the edit run. */
  readonly baseTiles: number;
  readonly edits: number;
  /** Tiles a single edit dirties. A brush stroke inside one screen is 1–4. */
  readonly tilesPerEdit: number;
  readonly tileBytes: number;
}

export interface StudioTileDocHistoryModel {
  /** Copy-on-write: base tiles plus only the tiles each edit actually touched. */
  readonly copyOnWriteTiles: number;
  readonly copyOnWriteBytes: number;
  /** Snapshot-per-edit without sharing: every snapshot re-materialises the whole layer. */
  readonly naiveTiles: number;
  readonly naiveBytes: number;
  readonly savedBytes: number;
  /** naiveBytes / copyOnWriteBytes. */
  readonly ratio: number;
}

export function studioTileDocHistoryModel(
  input: StudioTileDocHistoryModelInput
): StudioTileDocHistoryModel {
  const baseTiles = Math.max(0, Math.floor(input.baseTiles));
  const edits = Math.max(0, Math.floor(input.edits));
  const tilesPerEdit = Math.max(0, Math.floor(input.tilesPerEdit));
  const tileBytes = Math.max(0, Math.floor(input.tileBytes));
  const copyOnWriteTiles = baseTiles + edits * tilesPerEdit;
  const naiveTiles = baseTiles * (edits + 1);
  const copyOnWriteBytes = copyOnWriteTiles * tileBytes;
  const naiveBytes = naiveTiles * tileBytes;
  return Object.freeze({
    copyOnWriteTiles,
    copyOnWriteBytes,
    naiveTiles,
    naiveBytes,
    savedBytes: naiveBytes - copyOnWriteBytes,
    ratio: copyOnWriteBytes > 0 ? naiveBytes / copyOnWriteBytes : 0,
  });
}

export interface StudioTileDocMigrationLayerInput {
  readonly id: string;
  /** Placement of the decoded bitmap in document coordinates. */
  readonly bounds: StudioTileDocRect;
  /**
   * Fraction of the bitmap's tiles that actually contain non-transparent pixels. Unknown layers
   * should pass 1 (worst case); the real value comes from the alpha scan at slice time.
   */
  readonly coverage?: number;
}

export interface StudioTileDocMigrationLayerPlan {
  readonly id: string;
  readonly tiles: readonly StudioTileDocTileAddress[];
  /** Tiles the bitmap overlaps. */
  readonly tileCount: number;
  /** Tiles expected to survive the transparency prune. */
  readonly retainedTileCount: number;
  readonly retainedBytes: number;
  /** Decoded bytes the same layer costs as one full-page bitmap. */
  readonly legacyBytes: number;
}

export interface StudioTileDocMigrationPlan {
  readonly tileSize: number;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly layers: readonly StudioTileDocMigrationLayerPlan[];
  readonly totalTileCount: number;
  readonly retainedTileCount: number;
  readonly tiledBytes: number;
  readonly legacyBytes: number;
  readonly savedBytes: number;
  /** legacyBytes / tiledBytes. Below 1 means tiling costs more (fully opaque layers). */
  readonly ratio: number;
  /** Grid padding overhead: the document rounded up to whole tiles vs. its exact extent. */
  readonly gridOverheadBytes: number;
}

export interface StudioTileDocMigrationInput {
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly tileSize?: number;
  readonly layers: readonly StudioTileDocMigrationLayerInput[];
}

/**
 * Slicing plan: which tiles each decoded layer bitmap produces, and what that costs against the
 * current full-page model.
 *
 * The migration itself is incremental and needs no format change to the saved project: a legacy
 * `ImageEl.src` stays the source of truth until the layer is first edited, at which point it is
 * decoded once, sliced into these tiles, and the store becomes authoritative for that layer.
 */
export function planStudioTileDocMigration(
  input: StudioTileDocMigrationInput
): StudioTileDocMigrationPlan {
  const tileSize = resolveStudioTileDocTileSize(input.tileSize);
  const tileBytes = tileSize * tileSize * STUDIO_TILEDOC_BYTES_PER_PIXEL;
  const documentWidth = Math.max(1, Math.floor(input.documentWidth));
  const documentHeight = Math.max(1, Math.floor(input.documentHeight));

  const layers: StudioTileDocMigrationLayerPlan[] = [];
  let totalTileCount = 0;
  let retainedTileCount = 0;
  let legacyBytes = 0;

  for (const layer of input.layers) {
    const tiles = studioTileDocTilesForRect(layer.bounds, {
      tileSize,
      bounds: { width: documentWidth, height: documentHeight },
    });
    const coverage = Number.isFinite(layer.coverage) && (layer.coverage as number) >= 0
      ? Math.min(1, layer.coverage as number)
      : 1;
    const retained = Math.ceil(tiles.length * coverage);
    const layerLegacyBytes = Math.max(0, Math.floor(layer.bounds.width))
      * Math.max(0, Math.floor(layer.bounds.height))
      * STUDIO_TILEDOC_BYTES_PER_PIXEL;
    totalTileCount += tiles.length;
    retainedTileCount += retained;
    legacyBytes += layerLegacyBytes;
    layers.push(Object.freeze({
      id: layer.id,
      tiles,
      tileCount: tiles.length,
      retainedTileCount: retained,
      retainedBytes: retained * tileBytes,
      legacyBytes: layerLegacyBytes,
    }));
  }

  const tiledBytes = retainedTileCount * tileBytes;
  const gridBytes = Math.ceil(documentWidth / tileSize) * tileSize
    * Math.ceil(documentHeight / tileSize) * tileSize
    * STUDIO_TILEDOC_BYTES_PER_PIXEL;
  return Object.freeze({
    tileSize,
    documentWidth,
    documentHeight,
    layers: Object.freeze(layers),
    totalTileCount,
    retainedTileCount,
    tiledBytes,
    legacyBytes,
    savedBytes: legacyBytes - tiledBytes,
    ratio: tiledBytes > 0 ? legacyBytes / tiledBytes : 0,
    gridOverheadBytes: gridBytes
      - documentWidth * documentHeight * STUDIO_TILEDOC_BYTES_PER_PIXEL,
  });
}

/**
 * Resident bytes under a budget are independent of document height: a long-scroll strip only ever
 * decodes what the viewport (plus overscan) needs. This returns the *worst case* resident bytes for
 * a viewport, which is the number that must fit the budget.
 */
export function studioTileDocViewportResidentBytes(input: {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly layerCount: number;
  readonly tileSize?: number;
  readonly overscanTiles?: number;
}): number {
  const tileSize = resolveStudioTileDocTileSize(input.tileSize);
  const overscan = Math.max(0, Math.floor(input.overscanTiles ?? 1));
  const columns = Math.ceil(Math.max(0, input.viewportWidth) / tileSize) + 1 + overscan * 2;
  const rows = Math.ceil(Math.max(0, input.viewportHeight) / tileSize) + 1 + overscan * 2;
  return columns * rows
    * Math.max(0, Math.floor(input.layerCount))
    * tileSize * tileSize * STUDIO_TILEDOC_BYTES_PER_PIXEL;
}
