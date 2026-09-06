/**
 * Incremental layer-stack planner for the sparse tiled document.
 *
 * Storage pixels live in `studio-tiledoc-store`; this module turns the current viewport feed into
 * exact BACK→FRONT stacks for a compositor. It retains one frame only and compares at tile
 * granularity, so layer visibility/opacity/order edits invalidate only tiles whose visual stack
 * actually changed:
 *
 * - reordering two non-overlapping layers invalidates zero tiles;
 * - visibility/opacity changes invalidate only tiles owned by that layer;
 * - one in-place tile write is detected through `contentRevision`, even when `bufferId` is stable.
 *
 * `visualRevision` advances only when at least one visible tile changes. Page thumbnails and
 * navigator previews can therefore key off it instead of rebuilding for selection/lock/name edits
 * or visually irrelevant layer reorders.
 */

import type { StudioTileDocRect } from "./studio-tiledoc-geometry";
import type { StudioTileDocViewportTile } from "./studio-tiledoc-store";

export interface StudioTileDocCompositeLayer {
  readonly id: string;
  /** Effective visibility, including parent-group visibility. Default true. */
  readonly visible?: boolean;
  /** Effective layer opacity. Default 1. */
  readonly opacity?: number;
  /** Renderer-owned blend-mode identifier. Default "normal". */
  readonly blendMode?: string;
}

export interface StudioTileDocCompositeFrameInput {
  /**
   * Stable viewport/tile-span identity. Changing it starts a fresh comparison scope so tiles that
   * merely scrolled off screen are not scheduled for clearing.
   */
  readonly scopeId: string;
  /** Layer order is BACK→FRONT and must contain every layer represented by `viewportTiles`. */
  readonly layers: readonly StudioTileDocCompositeLayer[];
  /** Query all layers from `StudioTiledDocumentStore`; visibility is applied by this planner. */
  readonly viewportTiles: readonly StudioTileDocViewportTile[];
}

export interface StudioTileDocCompositeStackEntry {
  readonly layerId: string;
  readonly bufferId: number;
  readonly contentRevision: number;
  readonly opacity: number;
  readonly blendMode: string;
  readonly resident: boolean;
}

export interface StudioTileDocCompositeTilePlan {
  readonly id: string;
  readonly column: number;
  readonly row: number;
  readonly rect: StudioTileDocRect;
  /** Exact BACK→FRONT stack. Empty means the compositor must clear this formerly/non-visible tile. */
  readonly stack: readonly StudioTileDocCompositeStackEntry[];
}

export interface StudioTileDocCompositeFramePlan {
  readonly status: "planned";
  readonly frameSequence: number;
  /** Advances only when `dirtyTileIds` is non-empty. Suitable as a thumbnail cache key. */
  readonly visualRevision: number;
  readonly scopeId: string;
  readonly tiles: readonly StudioTileDocCompositeTilePlan[];
  readonly dirtyTileIds: readonly string[];
  readonly reusedTileCount: number;
  readonly inputTileReferenceCount: number;
}

export type StudioTileDocCompositeRejectionReason =
  | "duplicate-layer"
  | "duplicate-tile-reference"
  | "invalid-layer"
  | "invalid-scope"
  | "invalid-tile"
  | "tile-geometry-mismatch"
  | "unknown-layer";

export interface StudioTileDocCompositeRejectedPlan {
  readonly status: "rejected";
  readonly reason: StudioTileDocCompositeRejectionReason;
}

export type StudioTileDocCompositePlanResult =
  | StudioTileDocCompositeFramePlan
  | StudioTileDocCompositeRejectedPlan;

interface NormalizedLayer {
  readonly id: string;
  readonly order: number;
  readonly visible: boolean;
  readonly opacity: number;
  readonly blendMode: string;
}

interface MutableCompositeTile {
  readonly id: string;
  readonly column: number;
  readonly row: number;
  readonly rect: StudioTileDocRect;
  readonly entries: Array<{
    readonly order: number;
    readonly value: StudioTileDocCompositeStackEntry;
  }>;
}

const EMPTY_STACK = Object.freeze([]) as readonly StudioTileDocCompositeStackEntry[];
const EMPTY_TILE_PLANS = Object.freeze([]) as readonly StudioTileDocCompositeTilePlan[];
const EMPTY_TILE_IDS = Object.freeze([]) as readonly string[];

function rejected(reason: StudioTileDocCompositeRejectionReason): StudioTileDocCompositeRejectedPlan {
  return Object.freeze({ status: "rejected", reason });
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1_024;
}

function validRect(rect: StudioTileDocRect): boolean {
  return Number.isFinite(rect.x)
    && Number.isFinite(rect.y)
    && Number.isFinite(rect.width)
    && Number.isFinite(rect.height)
    && rect.width > 0
    && rect.height > 0;
}

function sameRect(left: StudioTileDocRect, right: StudioTileDocRect): boolean {
  return Object.is(left.x, right.x)
    && Object.is(left.y, right.y)
    && Object.is(left.width, right.width)
    && Object.is(left.height, right.height);
}

function sameStackEntry(
  left: StudioTileDocCompositeStackEntry,
  right: StudioTileDocCompositeStackEntry
): boolean {
  return left.layerId === right.layerId
    && left.bufferId === right.bufferId
    && left.contentRevision === right.contentRevision
    && Object.is(left.opacity, right.opacity)
    && left.blendMode === right.blendMode
    && left.resident === right.resident;
}

function sameTilePlan(
  left: StudioTileDocCompositeTilePlan,
  right: StudioTileDocCompositeTilePlan
): boolean {
  return left.id === right.id
    && left.column === right.column
    && left.row === right.row
    && sameRect(left.rect, right.rect)
    && left.stack.length === right.stack.length
    && left.stack.every((entry, index) => sameStackEntry(entry, right.stack[index]!));
}

function compareTilePlans(
  left: StudioTileDocCompositeTilePlan,
  right: StudioTileDocCompositeTilePlan
): number {
  return left.row - right.row
    || left.column - right.column
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

function normalizeLayers(
  layers: readonly StudioTileDocCompositeLayer[]
): readonly NormalizedLayer[] | StudioTileDocCompositeRejectedPlan {
  const ids = new Set<string>();
  const normalized: NormalizedLayer[] = [];
  for (let order = 0; order < layers.length; order += 1) {
    const layer = layers[order]!;
    if (!validId(layer.id)) return rejected("invalid-layer");
    if (ids.has(layer.id)) return rejected("duplicate-layer");
    const opacity = layer.opacity ?? 1;
    const blendMode = layer.blendMode ?? "normal";
    if (
      typeof opacity !== "number"
      || !Number.isFinite(opacity)
      || opacity < 0
      || opacity > 1
      || !validId(blendMode)
    ) {
      return rejected("invalid-layer");
    }
    ids.add(layer.id);
    normalized.push(Object.freeze({
      id: layer.id,
      order,
      visible: layer.visible !== false,
      opacity,
      blendMode,
    }));
  }
  return Object.freeze(normalized);
}

function isRejected(
  value: readonly NormalizedLayer[] | StudioTileDocCompositeRejectedPlan
): value is StudioTileDocCompositeRejectedPlan {
  return !Array.isArray(value);
}

/**
 * One-frame retained diff. Memory is O(visible tile count + visible tile references), with no
 * document-sized history and no unbounded signature cache.
 */
export class StudioTileDocCompositePlanner {
  private previousScopeId: string | null = null;
  private previousTiles = new Map<string, StudioTileDocCompositeTilePlan>();
  private frameSequence = 0;
  private visualRevision = 0;

  public plan(input: StudioTileDocCompositeFrameInput): StudioTileDocCompositePlanResult {
    if (!validId(input.scopeId)) return rejected("invalid-scope");
    if (!Array.isArray(input.layers) || !Array.isArray(input.viewportTiles)) {
      return rejected("invalid-layer");
    }
    const normalized = normalizeLayers(input.layers);
    if (isRejected(normalized)) return normalized;
    const layersById = new Map(normalized.map((layer) => [layer.id, layer]));
    const seenReferences = new Set<string>();
    const mutableTiles = new Map<string, MutableCompositeTile>();

    for (const tile of input.viewportTiles) {
      if (
        !validId(tile.layerId)
        || !validId(tile.id)
        || tile.id !== `${tile.column}:${tile.row}`
        || !Number.isSafeInteger(tile.column)
        || !Number.isSafeInteger(tile.row)
        || !Number.isSafeInteger(tile.bufferId)
        || tile.bufferId <= 0
        || !Number.isSafeInteger(tile.contentRevision)
        || tile.contentRevision < 0
        || !validRect(tile.rect)
      ) {
        return rejected("invalid-tile");
      }
      const layer = layersById.get(tile.layerId);
      if (!layer) return rejected("unknown-layer");
      const referenceKey = `${tile.layerId}\u0000${tile.id}`;
      if (seenReferences.has(referenceKey)) return rejected("duplicate-tile-reference");
      seenReferences.add(referenceKey);

      const current = mutableTiles.get(tile.id);
      if (
        current
        && (
          current.column !== tile.column
          || current.row !== tile.row
          || !sameRect(current.rect, tile.rect)
        )
      ) {
        return rejected("tile-geometry-mismatch");
      }
      const target: MutableCompositeTile = current ?? {
        id: tile.id,
        column: tile.column,
        row: tile.row,
        rect: tile.rect,
        entries: [],
      };
      if (!current) mutableTiles.set(tile.id, target);
      if (!layer.visible || layer.opacity === 0) continue;
      target.entries.push({
        order: layer.order,
        value: Object.freeze({
          layerId: layer.id,
          bufferId: tile.bufferId,
          contentRevision: tile.contentRevision,
          opacity: layer.opacity,
          blendMode: layer.blendMode,
          resident: tile.resident,
        }),
      });
    }

    const sameScope = this.previousScopeId === input.scopeId;
    const previous = sameScope ? this.previousTiles : new Map<string, StudioTileDocCompositeTilePlan>();
    const next = new Map<string, StudioTileDocCompositeTilePlan>();
    const dirtyTileIds: string[] = [];
    let reusedTileCount = 0;

    const built = [...mutableTiles.values()].map((tile): StudioTileDocCompositeTilePlan => {
      tile.entries.sort((left, right) => left.order - right.order);
      const candidate = Object.freeze({
        id: tile.id,
        column: tile.column,
        row: tile.row,
        rect: tile.rect,
        stack: tile.entries.length === 0
          ? EMPTY_STACK
          : Object.freeze(tile.entries.map((entry) => entry.value)),
      });
      const cached = previous.get(tile.id);
      if (cached && sameTilePlan(cached, candidate)) {
        reusedTileCount += 1;
        return cached;
      }
      dirtyTileIds.push(tile.id);
      return candidate;
    }).sort(compareTilePlans);

    for (const tile of built) next.set(tile.id, tile);
    // When the comparison scope is unchanged, a source tile disappearing means the destination
    // tile must be cleared. Keep its previous geometry as an empty dirty plan for this frame.
    if (sameScope) {
      for (const [tileId, oldTile] of previous) {
        if (next.has(tileId)) continue;
        const cleared = Object.freeze({ ...oldTile, stack: EMPTY_STACK });
        next.set(tileId, cleared);
        built.push(cleared);
        dirtyTileIds.push(tileId);
      }
      built.sort(compareTilePlans);
    }

    const orderedDirtyIds = dirtyTileIds.length === 0
      ? EMPTY_TILE_IDS
      : Object.freeze([...new Set(dirtyTileIds)].sort((left, right) => {
        const leftTile = next.get(left)!;
        const rightTile = next.get(right)!;
        return compareTilePlans(leftTile, rightTile);
      }));
    if (orderedDirtyIds.length > 0) {
      this.visualRevision = this.visualRevision >= Number.MAX_SAFE_INTEGER
        ? 1
        : this.visualRevision + 1;
    }
    this.frameSequence = this.frameSequence >= Number.MAX_SAFE_INTEGER
      ? 1
      : this.frameSequence + 1;
    this.previousScopeId = input.scopeId;
    // A deleted/off-scope source tile is emitted once as an empty clear task, then forgotten.
    // Hidden layers still remain in `mutableTiles`, so their empty plans stay retained and clean.
    this.previousTiles = new Map(
      [...next].filter(([tileId]) => mutableTiles.has(tileId))
    );

    return Object.freeze({
      status: "planned",
      frameSequence: this.frameSequence,
      visualRevision: this.visualRevision,
      scopeId: input.scopeId,
      tiles: built.length === 0 ? EMPTY_TILE_PLANS : Object.freeze(built),
      dirtyTileIds: orderedDirtyIds,
      reusedTileCount,
      inputTileReferenceCount: input.viewportTiles.length,
    });
  }

  public reset(): void {
    this.previousScopeId = null;
    this.previousTiles.clear();
    this.frameSequence = 0;
    this.visualRevision = 0;
  }
}
