import type { StudioGpuDab } from "./studio-webgpu-dab-plan-contract";
import type { StudioGpuRect } from "./studio-webgpu-tile-plan";

export const STUDIO_GPU_DAB_SPATIAL_FLOATS = 8;
export const STUDIO_GPU_DAB_SPATIAL_DEFAULT_MAX_DABS = 100_000;
export const STUDIO_GPU_DAB_SPATIAL_DEFAULT_MAX_TILES = 4_096;
export const STUDIO_GPU_DAB_SPATIAL_DEFAULT_MAX_MEMBERS = 1_000_000;
export const STUDIO_GPU_DAB_SPATIAL_DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
export const STUDIO_GPU_DAB_SPATIAL_DEFAULT_CELL_SIZE = 512;

const STUDIO_GPU_DAB_SPATIAL_MAX_CELLS_PER_TILE = 64;
const STUDIO_GPU_DAB_SPATIAL_GRID_MEMBERS_PER_TILE = 16;
const STUDIO_GPU_DAB_SPATIAL_MAX_QUERY_CELLS = 256;
const STUDIO_GPU_DAB_SPATIAL_MAX_UINT32 = 0xffff_ffff;

export interface StudioGpuDabSpatialTile extends StudioGpuRect {
  readonly id: string;
}

export interface StudioGpuDabSpatialBinOptions {
  readonly maximumDabs?: number;
  readonly maximumTiles?: number;
  readonly maximumMembers?: number;
  readonly maximumBytes?: number;
  readonly cellSize?: number;
  /**
   * Optional grow-only frame scratch. Successful views alias this buffer when it is large enough
   * and stay valid only until the caller reuses the same scratch for another plan.
   */
  readonly scratch?: ArrayBufferLike;
}

export type StudioGpuDabSpatialBinFailureReason =
  | "allocation-failed"
  | "byte-budget-exceeded"
  | "dab-budget-exceeded"
  | "invalid-input"
  | "invalid-options"
  | "member-budget-exceeded"
  | "tile-budget-exceeded";

export interface PlannedStudioGpuDabSpatialBins {
  readonly status: "planned";
  readonly sourceDabCount: number;
  readonly tileCount: number;
  readonly memberCount: number;
  /** Exact bytes occupied by the three returned typed views, excluding spare scratch capacity. */
  readonly byteLength: number;
  readonly buffer: ArrayBufferLike;
  /**
   * One frame-global AoS table: x, y, radius, red, green, blue, alpha, composite(0 normal/1 erase).
   */
  readonly packedDabs: Float32Array;
  /** `tileOffsets[i]..tileOffsets[i + 1]` addresses tile i's member indices. */
  readonly tileOffsets: Uint32Array;
  /** Indices into packedDabs, stable in original dab/compositing order within every tile. */
  readonly members: Uint32Array;
  /** Stable input tile order corresponding to tileOffsets. */
  readonly tileIds: readonly string[];
}

export interface RejectedStudioGpuDabSpatialBins {
  readonly status: "rejected";
  readonly reason: StudioGpuDabSpatialBinFailureReason;
}

export type StudioGpuDabSpatialBinPlan =
  | PlannedStudioGpuDabSpatialBins
  | RejectedStudioGpuDabSpatialBins;

interface NormalizedStudioGpuDabSpatialBinOptions {
  readonly maximumDabs: number;
  readonly maximumTiles: number;
  readonly maximumMembers: number;
  readonly maximumBytes: number;
  readonly cellSize: number;
  readonly scratch?: ArrayBufferLike;
}

interface CellRange {
  readonly minimumColumn: number;
  readonly maximumColumn: number;
  readonly minimumRow: number;
  readonly maximumRow: number;
  readonly cellCount: number;
}

interface StudioGpuDabSpatialTileIndex {
  readonly cells: ReadonlyMap<string, readonly number[]>;
  readonly globalTileIndices: readonly number[];
  readonly cellSize: number;
}

function reject(reason: StudioGpuDabSpatialBinFailureReason): RejectedStudioGpuDabSpatialBins {
  return { status: "rejected", reason };
}

function finiteFloat32(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && Number.isFinite(Math.fround(value));
}

function boundedSafeInteger(
  value: number | undefined,
  fallback: number
): number | null {
  const resolved = value ?? fallback;
  return Number.isSafeInteger(resolved) && resolved >= 0 ? resolved : null;
}

function normalizeOptions(
  options: StudioGpuDabSpatialBinOptions
): NormalizedStudioGpuDabSpatialBinOptions | null {
  const maximumDabs = boundedSafeInteger(
    options.maximumDabs,
    STUDIO_GPU_DAB_SPATIAL_DEFAULT_MAX_DABS
  );
  const maximumTiles = boundedSafeInteger(
    options.maximumTiles,
    STUDIO_GPU_DAB_SPATIAL_DEFAULT_MAX_TILES
  );
  const maximumMembers = boundedSafeInteger(
    options.maximumMembers,
    STUDIO_GPU_DAB_SPATIAL_DEFAULT_MAX_MEMBERS
  );
  const maximumBytes = boundedSafeInteger(
    options.maximumBytes,
    STUDIO_GPU_DAB_SPATIAL_DEFAULT_MAX_BYTES
  );
  const cellSize = options.cellSize ?? STUDIO_GPU_DAB_SPATIAL_DEFAULT_CELL_SIZE;
  if (
    maximumDabs === null
    || maximumTiles === null
    || maximumMembers === null
    || maximumBytes === null
    || maximumDabs > STUDIO_GPU_DAB_SPATIAL_MAX_UINT32
    || maximumTiles >= STUDIO_GPU_DAB_SPATIAL_MAX_UINT32
    || maximumMembers > STUDIO_GPU_DAB_SPATIAL_MAX_UINT32
    || !finiteFloat32(cellSize)
    || cellSize <= 0
  ) {
    return null;
  }
  return {
    maximumDabs,
    maximumTiles,
    maximumMembers,
    maximumBytes,
    cellSize,
    ...(options.scratch === undefined ? {} : { scratch: options.scratch }),
  };
}

function validDab(dab: StudioGpuDab): boolean {
  return finiteFloat32(dab.x)
    && finiteFloat32(dab.y)
    && finiteFloat32(dab.radius)
    && dab.radius >= 0
    && finiteFloat32(dab.red)
    && dab.red >= 0
    && dab.red <= 1
    && finiteFloat32(dab.green)
    && dab.green >= 0
    && dab.green <= 1
    && finiteFloat32(dab.blue)
    && dab.blue >= 0
    && dab.blue <= 1
    && finiteFloat32(dab.alpha)
    && dab.alpha >= 0
    && dab.alpha <= 1
    && (dab.composite === "normal" || dab.composite === "erase")
    && Number.isFinite(dab.x - dab.radius)
    && Number.isFinite(dab.x + dab.radius)
    && Number.isFinite(dab.y - dab.radius)
    && Number.isFinite(dab.y + dab.radius);
}

function validTile(tile: StudioGpuDabSpatialTile): boolean {
  return typeof tile.id === "string"
    && tile.id.length > 0
    && finiteFloat32(tile.x)
    && finiteFloat32(tile.y)
    && finiteFloat32(tile.width)
    && finiteFloat32(tile.height)
    && tile.width > 0
    && tile.height > 0
    && Number.isFinite(tile.x + tile.width)
    && Number.isFinite(tile.y + tile.height);
}

function closedCircleIntersectsRect(
  dab: Pick<StudioGpuDab, "x" | "y" | "radius">,
  rect: StudioGpuRect
): boolean {
  const nearestX = Math.min(rect.x + rect.width, Math.max(rect.x, dab.x));
  const nearestY = Math.min(rect.y + rect.height, Math.max(rect.y, dab.y));
  const dx = dab.x - nearestX;
  const dy = dab.y - nearestY;
  return Math.hypot(dx, dy) <= dab.radius;
}

function cellRange(
  minimumX: number,
  minimumY: number,
  maximumX: number,
  maximumY: number,
  cellSize: number
): CellRange | null {
  const minimumColumn = Math.floor(minimumX / cellSize);
  const maximumColumn = Math.floor(maximumX / cellSize);
  const minimumRow = Math.floor(minimumY / cellSize);
  const maximumRow = Math.floor(maximumY / cellSize);
  if (
    !Number.isSafeInteger(minimumColumn)
    || !Number.isSafeInteger(maximumColumn)
    || !Number.isSafeInteger(minimumRow)
    || !Number.isSafeInteger(maximumRow)
    || minimumColumn > maximumColumn
    || minimumRow > maximumRow
  ) {
    return null;
  }
  const columnCount = maximumColumn - minimumColumn + 1;
  const rowCount = maximumRow - minimumRow + 1;
  if (
    !Number.isSafeInteger(columnCount)
    || !Number.isSafeInteger(rowCount)
    || columnCount > Number.MAX_SAFE_INTEGER / rowCount
  ) {
    return null;
  }
  return {
    minimumColumn,
    maximumColumn,
    minimumRow,
    maximumRow,
    cellCount: columnCount * rowCount,
  };
}

function cellKey(column: number, row: number): string {
  return `${column}:${row}`;
}

function buildTileIndex(
  tiles: readonly StudioGpuDabSpatialTile[],
  cellSize: number
): StudioGpuDabSpatialTileIndex {
  const cells = new Map<string, number[]>();
  const globalTileIndices: number[] = [];
  const maximumGridMembers = Math.max(
    STUDIO_GPU_DAB_SPATIAL_GRID_MEMBERS_PER_TILE,
    tiles.length * STUDIO_GPU_DAB_SPATIAL_GRID_MEMBERS_PER_TILE
  );
  let gridMemberCount = 0;

  for (let tileIndex = 0; tileIndex < tiles.length; tileIndex += 1) {
    const tile = tiles[tileIndex]!;
    const range = cellRange(
      tile.x,
      tile.y,
      tile.x + tile.width,
      tile.y + tile.height,
      cellSize
    );
    if (
      !range
      || range.cellCount > STUDIO_GPU_DAB_SPATIAL_MAX_CELLS_PER_TILE
      || range.cellCount > maximumGridMembers - gridMemberCount
    ) {
      globalTileIndices.push(tileIndex);
      continue;
    }
    gridMemberCount += range.cellCount;
    for (let row = range.minimumRow; row <= range.maximumRow; row += 1) {
      for (let column = range.minimumColumn; column <= range.maximumColumn; column += 1) {
        const key = cellKey(column, row);
        const members = cells.get(key) ?? [];
        members.push(tileIndex);
        cells.set(key, members);
      }
    }
  }
  return { cells, globalTileIndices, cellSize };
}

function forEachCandidateTile(
  dab: StudioGpuDab,
  tiles: readonly StudioGpuDabSpatialTile[],
  index: StudioGpuDabSpatialTileIndex,
  visited: Uint32Array,
  generation: number,
  visit: (tileIndex: number) => boolean
): boolean {
  const visitOnce = (tileIndex: number): boolean => {
    if (visited[tileIndex] === generation) return true;
    visited[tileIndex] = generation;
    return visit(tileIndex);
  };
  for (const tileIndex of index.globalTileIndices) {
    if (!visitOnce(tileIndex)) return false;
  }

  const range = cellRange(
    dab.x - dab.radius,
    dab.y - dab.radius,
    dab.x + dab.radius,
    dab.y + dab.radius,
    index.cellSize
  );
  if (!range || range.cellCount > STUDIO_GPU_DAB_SPATIAL_MAX_QUERY_CELLS) {
    for (let tileIndex = 0; tileIndex < tiles.length; tileIndex += 1) {
      if (!visitOnce(tileIndex)) return false;
    }
    return true;
  }
  for (let row = range.minimumRow; row <= range.maximumRow; row += 1) {
    for (let column = range.minimumColumn; column <= range.maximumColumn; column += 1) {
      for (const tileIndex of index.cells.get(cellKey(column, row)) ?? []) {
        if (!visitOnce(tileIndex)) return false;
      }
    }
  }
  return true;
}

function requiredByteLength(
  dabCount: number,
  tileCount: number,
  memberCount: number
): number | null {
  const packedFloatCount = dabCount * STUDIO_GPU_DAB_SPATIAL_FLOATS;
  const offsetCount = tileCount + 1;
  if (
    !Number.isSafeInteger(packedFloatCount)
    || !Number.isSafeInteger(offsetCount)
    || !Number.isSafeInteger(memberCount)
  ) {
    return null;
  }
  const elementCount = packedFloatCount + offsetCount + memberCount;
  return Number.isSafeInteger(elementCount)
    && elementCount <= Number.MAX_SAFE_INTEGER / Uint32Array.BYTES_PER_ELEMENT
    ? elementCount * Uint32Array.BYTES_PER_ELEMENT
    : null;
}

/**
 * Packs one frame-global dab table and a deterministic tile→dab membership offset table.
 *
 * Exact circle/rectangle tests run in Number precision before Float32 packing. A dab touching a
 * closed tile boundary belongs to every touching tile; repeated source dabs remain distinct
 * members because repeated alpha/composite operations are semantically meaningful.
 */
export function planStudioGpuDabSpatialBins(
  dabs: readonly StudioGpuDab[],
  tiles: readonly StudioGpuDabSpatialTile[],
  options: StudioGpuDabSpatialBinOptions = {}
): StudioGpuDabSpatialBinPlan {
  try {
    const normalized = normalizeOptions(options);
    if (!normalized) return reject("invalid-options");
    if (dabs.length > normalized.maximumDabs) return reject("dab-budget-exceeded");
    if (tiles.length > normalized.maximumTiles) return reject("tile-budget-exceeded");
    if (!dabs.every(validDab) || !tiles.every(validTile)) return reject("invalid-input");
    if (new Set(tiles.map(({ id }) => id)).size !== tiles.length) {
      return reject("invalid-input");
    }

    const tileIndex = buildTileIndex(tiles, normalized.cellSize);
    const visited = new Uint32Array(tiles.length);
    const memberCounts = new Uint32Array(tiles.length);
    let generation = 0;
    let memberCount = 0;
    for (const dab of dabs) {
      generation += 1;
      const complete = forEachCandidateTile(
        dab,
        tiles,
        tileIndex,
        visited,
        generation,
        (candidateIndex) => {
          if (!closedCircleIntersectsRect(dab, tiles[candidateIndex]!)) return true;
          if (memberCount >= normalized.maximumMembers) return false;
          memberCounts[candidateIndex] += 1;
          memberCount += 1;
          return true;
        }
      );
      if (!complete) return reject("member-budget-exceeded");
    }

    const byteLength = requiredByteLength(dabs.length, tiles.length, memberCount);
    if (byteLength === null || byteLength > normalized.maximumBytes) {
      return reject("byte-budget-exceeded");
    }
    const buffer = normalized.scratch && normalized.scratch.byteLength >= byteLength
      ? normalized.scratch
      : new ArrayBuffer(byteLength);
    const packedFloatCount = dabs.length * STUDIO_GPU_DAB_SPATIAL_FLOATS;
    const packedByteLength = packedFloatCount * Float32Array.BYTES_PER_ELEMENT;
    const offsetCount = tiles.length + 1;
    const offsetByteLength = offsetCount * Uint32Array.BYTES_PER_ELEMENT;
    const packedDabs = new Float32Array(buffer, 0, packedFloatCount);
    const tileOffsets = new Uint32Array(buffer, packedByteLength, offsetCount);
    const members = new Uint32Array(
      buffer,
      packedByteLength + offsetByteLength,
      memberCount
    );

    for (let dabIndex = 0; dabIndex < dabs.length; dabIndex += 1) {
      const dab = dabs[dabIndex]!;
      const offset = dabIndex * STUDIO_GPU_DAB_SPATIAL_FLOATS;
      packedDabs[offset] = dab.x;
      packedDabs[offset + 1] = dab.y;
      packedDabs[offset + 2] = dab.radius;
      packedDabs[offset + 3] = dab.red;
      packedDabs[offset + 4] = dab.green;
      packedDabs[offset + 5] = dab.blue;
      packedDabs[offset + 6] = dab.alpha;
      packedDabs[offset + 7] = dab.composite === "erase" ? 1 : 0;
    }

    let memberOffset = 0;
    for (let tileOffset = 0; tileOffset < tiles.length; tileOffset += 1) {
      tileOffsets[tileOffset] = memberOffset;
      memberOffset += memberCounts[tileOffset]!;
    }
    tileOffsets[tiles.length] = memberOffset;
    if (memberOffset !== memberCount) return reject("allocation-failed");

    const writeCursors = tileOffsets.slice(0, tiles.length);
    visited.fill(0);
    generation = 0;
    for (let dabIndex = 0; dabIndex < dabs.length; dabIndex += 1) {
      generation += 1;
      const dab = dabs[dabIndex]!;
      const complete = forEachCandidateTile(
        dab,
        tiles,
        tileIndex,
        visited,
        generation,
        (candidateIndex) => {
          if (!closedCircleIntersectsRect(dab, tiles[candidateIndex]!)) return true;
          const cursor = writeCursors[candidateIndex]!;
          if (cursor >= tileOffsets[candidateIndex + 1]!) return false;
          members[cursor] = dabIndex;
          writeCursors[candidateIndex] = cursor + 1;
          return true;
        }
      );
      if (!complete) return reject("allocation-failed");
    }
    for (let tileOffset = 0; tileOffset < tiles.length; tileOffset += 1) {
      if (writeCursors[tileOffset] !== tileOffsets[tileOffset + 1]) {
        return reject("allocation-failed");
      }
    }

    return {
      status: "planned",
      sourceDabCount: dabs.length,
      tileCount: tiles.length,
      memberCount,
      byteLength,
      buffer,
      packedDabs,
      tileOffsets,
      members,
      tileIds: Object.freeze(tiles.map(({ id }) => id)),
    };
  } catch {
    return reject("allocation-failed");
  }
}
