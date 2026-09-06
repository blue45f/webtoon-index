/**
 * Dirty-rect tracking and tile invalidation.
 *
 * A brush stroke emits one dirty rect per accepted sample — hundreds per second. Handing those to
 * the tile store one at a time would re-run the per-tile write path hundreds of times for the two
 * tiles a stroke actually crosses. The tracker coalesces at two levels:
 *
 * 1. **Tile level.** Every rect is folded into the tile cells it covers, so N overlapping rects on
 *    one tile collapse to one entry. This is the coalescing that keeps a stroke from invalidating
 *    the world: the entry count is bounded by the stroke's tile footprint, not by sample count.
 * 2. **Sub-rect level.** Each tile keeps the union bounding box of the dirty rects clipped to it,
 *    integer-aligned, so the uploader can do a partial texture write instead of a full 1 MiB tile.
 *
 * An overflow guard exists for genuinely global edits (page fill, filter bake): past `maxTiles`
 * distinct cells the tracker stops per-tile bookkeeping and degrades to a single bounding box,
 * which `take()` re-expands into full-tile entries. Deterministic in both modes.
 */

import {
  alignStudioTileDocRect,
  intersectStudioTileDocRects,
  resolveStudioTileDocTileSize,
  studioTileDocTileId,
  studioTileDocTileRect,
  studioTileDocTileSpan,
  studioTileDocTilesForRect,
  unionStudioTileDocRects,
  type StudioTileDocGridBounds,
  type StudioTileDocRect,
} from "./studio-tiledoc-geometry";

/** Beyond this many distinct dirty cells the tracker collapses to bounding-box mode. */
export const STUDIO_TILEDOC_DEFAULT_MAX_DIRTY_TILES = 2048;

export interface StudioTileDocDirtyTile {
  readonly id: string;
  readonly column: number;
  readonly row: number;
  /** Integer-aligned dirty sub-rect in document coordinates, clipped to this tile. */
  readonly rect: StudioTileDocRect;
  /** True when the whole tile is dirty (a partial upload would buy nothing). */
  readonly full: boolean;
}

export interface StudioTileDocDirtyRegion {
  readonly tiles: readonly StudioTileDocDirtyTile[];
  /** Integer-aligned union of every accepted rect, or null when nothing was tracked. */
  readonly bounds: StudioTileDocRect | null;
  /** Rects handed to the tracker, including ones that fell fully outside the document. */
  readonly rectCount: number;
  /** Rects that actually touched at least one in-bounds tile. */
  readonly acceptedRectCount: number;
  /** True when per-tile bookkeeping was abandoned for the bounding box. */
  readonly overflowed: boolean;
}

export interface StudioTileDocDirtyTrackerOptions {
  readonly tileSize?: number;
  /** Document extent. Dirty area outside it is clipped away (an edit can start off-canvas). */
  readonly bounds?: StudioTileDocGridBounds;
  readonly maxTiles?: number;
}

interface MutableTileBox {
  readonly column: number;
  readonly row: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const EMPTY_REGION: StudioTileDocDirtyRegion = Object.freeze({
  tiles: Object.freeze([]) as readonly StudioTileDocDirtyTile[],
  bounds: null,
  rectCount: 0,
  acceptedRectCount: 0,
  overflowed: false,
});

export function emptyStudioTileDocDirtyRegion(): StudioTileDocDirtyRegion {
  return EMPTY_REGION;
}

export class StudioTileDocDirtyTracker {
  private readonly tileSize: number;
  private readonly bounds: StudioTileDocGridBounds | undefined;
  private readonly maxTiles: number;
  private readonly boxes = new Map<string, MutableTileBox>();

  private union: StudioTileDocRect | null = null;
  private rects = 0;
  private acceptedRects = 0;
  private overflowed = false;

  public constructor(options: StudioTileDocDirtyTrackerOptions = {}) {
    this.tileSize = resolveStudioTileDocTileSize(options.tileSize);
    this.bounds = options.bounds;
    const requested = options.maxTiles;
    this.maxTiles = Number.isFinite(requested) && (requested as number) > 0
      ? Math.floor(requested as number)
      : STUDIO_TILEDOC_DEFAULT_MAX_DIRTY_TILES;
  }

  public get isEmpty(): boolean {
    return this.union === null;
  }

  public get dirtyTileCount(): number {
    return this.overflowed ? this.overflowTileCount() : this.boxes.size;
  }

  public reset(): void {
    this.boxes.clear();
    this.union = null;
    this.rects = 0;
    this.acceptedRects = 0;
    this.overflowed = false;
  }

  /** Adds a dab footprint: the axis-aligned square around a stamped point. */
  public addPoint(x: number, y: number, radius: number): void {
    const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : 0.5;
    this.addRect({
      x: x - safeRadius,
      y: y - safeRadius,
      width: safeRadius * 2,
      height: safeRadius * 2,
    });
  }

  public addRect(rect: StudioTileDocRect): void {
    this.rects += 1;
    const span = studioTileDocTileSpan(rect, {
      tileSize: this.tileSize,
      bounds: this.bounds,
    });
    if (!span) return;
    const raw = alignStudioTileDocRect(rect);
    if (!raw) return;
    // A rect can land inside the last tile column yet still sit past the document edge
    // (tile 7 of a 4000px document covers up to 4096). Clip before it reaches the union.
    const aligned = this.bounds
      ? intersectStudioTileDocRects(raw, {
        x: 0,
        y: 0,
        width: this.bounds.width,
        height: this.bounds.height,
      })
      : raw;
    if (!aligned) return;
    this.acceptedRects += 1;
    this.union = this.union ? unionStudioTileDocRects(this.union, aligned) : aligned;
    if (this.overflowed) return;

    const spanTiles = (span.lastColumn - span.firstColumn + 1)
      * (span.lastRow - span.firstRow + 1);
    if (this.boxes.size + spanTiles > this.maxTiles) {
      this.overflowed = true;
      this.boxes.clear();
      return;
    }
    for (let row = span.firstRow; row <= span.lastRow; row += 1) {
      for (let column = span.firstColumn; column <= span.lastColumn; column += 1) {
        this.mergeTile(column, row, aligned);
      }
    }
  }

  /** Snapshot of the accumulated region without clearing it. */
  public peek(): StudioTileDocDirtyRegion {
    if (this.union === null) return EMPTY_REGION;
    return Object.freeze({
      tiles: this.overflowed ? this.overflowTiles() : this.orderedTiles(),
      bounds: this.union,
      rectCount: this.rects,
      acceptedRectCount: this.acceptedRects,
      overflowed: this.overflowed,
    });
  }

  /** Snapshot then reset — the normal per-commit drain. */
  public take(): StudioTileDocDirtyRegion {
    const region = this.peek();
    this.reset();
    return region;
  }

  private mergeTile(column: number, row: number, rect: StudioTileDocRect): void {
    const tileRect = studioTileDocTileRect(column, row, this.tileSize);
    const clipped = intersectStudioTileDocRects(tileRect, rect);
    if (!clipped) return;
    const id = studioTileDocTileId(column, row);
    const existing = this.boxes.get(id);
    const maxX = clipped.x + clipped.width;
    const maxY = clipped.y + clipped.height;
    if (!existing) {
      this.boxes.set(id, {
        column,
        row,
        minX: clipped.x,
        minY: clipped.y,
        maxX,
        maxY,
      });
      return;
    }
    existing.minX = Math.min(existing.minX, clipped.x);
    existing.minY = Math.min(existing.minY, clipped.y);
    existing.maxX = Math.max(existing.maxX, maxX);
    existing.maxY = Math.max(existing.maxY, maxY);
  }

  private orderedTiles(): readonly StudioTileDocDirtyTile[] {
    const tiles = [...this.boxes.values()]
      .sort((left, right) => left.row - right.row || left.column - right.column)
      .map((box) => {
        const width = box.maxX - box.minX;
        const height = box.maxY - box.minY;
        return Object.freeze({
          id: studioTileDocTileId(box.column, box.row),
          column: box.column,
          row: box.row,
          rect: Object.freeze({ x: box.minX, y: box.minY, width, height }),
          full: width >= this.tileSize && height >= this.tileSize,
        });
      });
    return Object.freeze(tiles);
  }

  private overflowTiles(): readonly StudioTileDocDirtyTile[] {
    if (!this.union) return Object.freeze([]);
    const addresses = studioTileDocTilesForRect(this.union, {
      tileSize: this.tileSize,
      bounds: this.bounds,
    });
    return Object.freeze(addresses.map((address) => Object.freeze({
      id: address.id,
      column: address.column,
      row: address.row,
      rect: studioTileDocTileRect(address.column, address.row, this.tileSize),
      full: true,
    })));
  }

  private overflowTileCount(): number {
    if (!this.union) return 0;
    const span = studioTileDocTileSpan(this.union, {
      tileSize: this.tileSize,
      bounds: this.bounds,
    });
    if (!span) return 0;
    return (span.lastColumn - span.firstColumn + 1) * (span.lastRow - span.firstRow + 1);
  }
}

/** One-shot helper for callers that already have a single edit rect. */
export function studioTileDocDirtyRegionForRect(
  rect: StudioTileDocRect,
  options: StudioTileDocDirtyTrackerOptions = {}
): StudioTileDocDirtyRegion {
  const tracker = new StudioTileDocDirtyTracker(options);
  tracker.addRect(rect);
  return tracker.take();
}
