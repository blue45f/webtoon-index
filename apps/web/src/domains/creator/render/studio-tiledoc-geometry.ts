/**
 * Tiled document geometry — the *storage* tile grid.
 *
 * The WebGPU compositor (studio-webgpu-tile-plan / -tile-runtime) already tiles the *presentation*
 * path: it derives per-tile render tasks from the stroke log and budgets GPU textures. It never
 * owns document pixels. This module defines the grid that the storage side uses so both sides
 * agree on tile identity without a translation step:
 *
 * - Same tile size (512) and the same `${column}:${row}` id format as `studio-webgpu-tile-plan`,
 *   so a viewport query here can be handed straight to `planVisibleStudioGpuTiles` output ids.
 * - Zero bleed. `STUDIO_GPU_TILE_BLEED` (2px) exists so anti-aliased dabs can feather across a
 *   render tile edge. Storage tiles must instead abut exactly: every document pixel has exactly
 *   one owning tile, otherwise a copy-on-write clone would have to reconcile two writers for the
 *   same pixel and undo would stop being exact. Bleed stays a render-time expansion.
 *
 * Rectangles are half-open in logical document pixels: `[x, x + width) × [y, y + height)`.
 * Coordinates may be fractional (stroke bounds) and negative (an edit that starts off-canvas).
 */

/**
 * 512 logical pixels per side.
 *
 * - Matches `STUDIO_GPU_TILE_SIZE`, so storage tiles and render tiles are the same cells.
 * - 512 × 512 × 4 = exactly 1 MiB per RGBA tile, which makes every budget number in this
 *   subsystem a whole number of tiles.
 * - 256 would quadruple bookkeeping (a 4000×6000 page goes from 96 to 384 tiles per layer) for a
 *   4× finer dirty granularity that a brush stroke rarely exploits.
 * - 1024 would make the smallest possible copy-on-write clone 4 MiB, and CoW clone cost is the
 *   dominant cost of undo in this design.
 */
export const STUDIO_TILEDOC_TILE_SIZE = 512;

/** Bytes of one fully materialised tile payload at the default tile size (1 MiB). */
export const STUDIO_TILEDOC_TILE_BYTES = STUDIO_TILEDOC_TILE_SIZE * STUDIO_TILEDOC_TILE_SIZE * 4;

/**
 * Per-tile payload format.
 *
 * `Uint8ClampedArray` of `tileSize * tileSize * 4` bytes, row-major, stride `tileSize * 4`,
 * origin at the tile's top-left document pixel `(column * tileSize, row * tileSize)`.
 * Channel order R,G,B,A with **premultiplied** alpha, matching the premultiplied colour the
 * compositor already packs per dab instance, so an uploaded tile needs no conversion pass.
 * `ImageData` ingest (straight alpha) must un-premultiply on the way in — see
 * `studio-tiledoc-migration`.
 */
export const STUDIO_TILEDOC_TILE_FORMAT = "rgba8-premultiplied";

export interface StudioTileDocRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioTileDocTileAddress {
  /** `${column}:${row}` — identical to the compositor's tile id format. */
  readonly id: string;
  readonly column: number;
  readonly row: number;
}

export interface StudioTileDocTileSpan {
  readonly firstColumn: number;
  readonly lastColumn: number;
  readonly firstRow: number;
  readonly lastRow: number;
}

export interface StudioTileDocGridBounds {
  readonly width: number;
  readonly height: number;
}

export interface StudioTileDocSpanOptions {
  readonly tileSize?: number;
  /** Clamps the span to the document. Tiles fully outside the document are dropped. */
  readonly bounds?: StudioTileDocGridBounds;
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function resolveStudioTileDocTileSize(tileSize: number | undefined): number {
  if (tileSize === undefined) return STUDIO_TILEDOC_TILE_SIZE;
  if (!Number.isFinite(tileSize)) return STUDIO_TILEDOC_TILE_SIZE;
  const floored = Math.floor(tileSize);
  return floored > 0 ? floored : STUDIO_TILEDOC_TILE_SIZE;
}

export function studioTileDocTileId(column: number, row: number): string {
  return `${column}:${row}`;
}

export function parseStudioTileDocTileId(
  id: string
): StudioTileDocTileAddress | null {
  const match = /^(-?\d+):(-?\d+)$/u.exec(id);
  if (!match) return null;
  const column = Number(match[1]);
  const row = Number(match[2]);
  if (!Number.isSafeInteger(column) || !Number.isSafeInteger(row)) return null;
  return Object.freeze({ id, column, row });
}

/** Logical rect covered by a tile cell, before any document clamp. */
export function studioTileDocTileRect(
  column: number,
  row: number,
  tileSize?: number
): StudioTileDocRect {
  const size = resolveStudioTileDocTileSize(tileSize);
  return Object.freeze({
    x: column * size,
    y: row * size,
    width: size,
    height: size,
  });
}

export function intersectStudioTileDocRects(
  left: StudioTileDocRect,
  right: StudioTileDocRect
): StudioTileDocRect | null {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const right_ = Math.min(left.x + left.width, right.x + right.width);
  const bottom = Math.min(left.y + left.height, right.y + right.height);
  if (!(right_ > x) || !(bottom > y)) return null;
  return Object.freeze({ x, y, width: right_ - x, height: bottom - y });
}

export function unionStudioTileDocRects(
  left: StudioTileDocRect,
  right: StudioTileDocRect
): StudioTileDocRect {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const right_ = Math.max(left.x + left.width, right.x + right.width);
  const bottom = Math.max(left.y + left.height, right.y + right.height);
  return Object.freeze({ x, y, width: right_ - x, height: bottom - y });
}

/**
 * Half-open rect → inclusive tile span.
 *
 * `firstColumn = floor(x / size)` and `lastColumn = ceil((x + width) / size) - 1`, which keeps a
 * rect that ends exactly on a tile boundary inside the previous column (`x=512,width=512` covers
 * column 1 only) and handles negative origins (`x=-1,width=2` covers columns -1 and 0).
 */
export function studioTileDocTileSpan(
  rect: StudioTileDocRect,
  options: StudioTileDocSpanOptions = {}
): StudioTileDocTileSpan | null {
  const size = resolveStudioTileDocTileSize(options.tileSize);
  if (
    !Number.isFinite(rect.x) || !Number.isFinite(rect.y)
    || !isFinitePositive(rect.width) || !isFinitePositive(rect.height)
  ) {
    return null;
  }
  let firstColumn = Math.floor(rect.x / size);
  let firstRow = Math.floor(rect.y / size);
  let lastColumn = Math.ceil((rect.x + rect.width) / size) - 1;
  let lastRow = Math.ceil((rect.y + rect.height) / size) - 1;
  const bounds = options.bounds;
  if (bounds) {
    if (!isFinitePositive(bounds.width) || !isFinitePositive(bounds.height)) return null;
    firstColumn = Math.max(firstColumn, 0);
    firstRow = Math.max(firstRow, 0);
    lastColumn = Math.min(lastColumn, Math.ceil(bounds.width / size) - 1);
    lastRow = Math.min(lastRow, Math.ceil(bounds.height / size) - 1);
  }
  if (lastColumn < firstColumn || lastRow < firstRow) return null;
  return Object.freeze({ firstColumn, lastColumn, firstRow, lastRow });
}

/** Tile count for a rect without materialising the addresses — cheap enough for a guard. */
export function studioTileDocTileCountForRect(
  rect: StudioTileDocRect,
  options: StudioTileDocSpanOptions = {}
): number {
  const span = studioTileDocTileSpan(rect, options);
  if (!span) return 0;
  return (span.lastColumn - span.firstColumn + 1) * (span.lastRow - span.firstRow + 1);
}

/** Row-major (row asc, then column asc) tile addresses covering the rect. Deterministic. */
export function studioTileDocTilesForRect(
  rect: StudioTileDocRect,
  options: StudioTileDocSpanOptions = {}
): readonly StudioTileDocTileAddress[] {
  const span = studioTileDocTileSpan(rect, options);
  if (!span) return [];
  const addresses: StudioTileDocTileAddress[] = [];
  for (let row = span.firstRow; row <= span.lastRow; row += 1) {
    for (let column = span.firstColumn; column <= span.lastColumn; column += 1) {
      addresses.push(Object.freeze({ id: studioTileDocTileId(column, row), column, row }));
    }
  }
  return Object.freeze(addresses);
}

/** Tiles needed to cover a whole document at this tile size. */
export function studioTileDocGridTileCount(
  bounds: StudioTileDocGridBounds,
  tileSize?: number
): number {
  const size = resolveStudioTileDocTileSize(tileSize);
  if (!isFinitePositive(bounds.width) || !isFinitePositive(bounds.height)) return 0;
  return Math.ceil(bounds.width / size) * Math.ceil(bounds.height / size);
}

/** Integer-aligned rect — the form a texture sub-upload needs. */
export function alignStudioTileDocRect(rect: StudioTileDocRect): StudioTileDocRect | null {
  if (
    !Number.isFinite(rect.x) || !Number.isFinite(rect.y)
    || !isFinitePositive(rect.width) || !isFinitePositive(rect.height)
  ) {
    return null;
  }
  const x = Math.floor(rect.x);
  const y = Math.floor(rect.y);
  const width = Math.ceil(rect.x + rect.width) - x;
  const height = Math.ceil(rect.y + rect.height) - y;
  if (width <= 0 || height <= 0) return null;
  return Object.freeze({ x, y, width, height });
}
