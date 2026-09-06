import type { StudioGpuDab } from "./studio-webgpu-dab-plan-contract";

/**
 * Deterministic CPU oracle for the future WebGPU count/scan/scatter tile-binning pass.
 *
 * The result is a compact CSR-style index:
 * - `tileOffsets[tile]..tileOffsets[tile + 1]` addresses one tile's dab references;
 * - `dabIndices` preserves the original dab order inside every tile;
 * - a dab is referenced only by tiles touched by its axis-aligned coverage bounds.
 *
 * Keeping this contract independent from GPU resources gives compute implementations an exact
 * parity oracle and lets the current renderer adopt sparse work scheduling incrementally.
 */
export const STUDIO_GPU_DAB_TILE_BINNING_REVISION = 1 as const;
export const STUDIO_GPU_DAB_TILE_BINNING_DEFAULT_TILE_SIZE = 128;
export const STUDIO_GPU_DAB_TILE_BINNING_MAX_DABS = 65_536;
export const STUDIO_GPU_DAB_TILE_BINNING_MAX_TILES = 1_048_576;
export const STUDIO_GPU_DAB_TILE_BINNING_MAX_REFERENCES = 4_194_304;

export interface StudioGpuDabTileBinningInput {
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly tileSize?: number;
  readonly dabs: readonly Pick<StudioGpuDab, "x" | "y" | "radius">[];
  /** Request-scoped ceiling, clamped to the hard allocation limit. */
  readonly maximumTileReferences?: number;
  /** Request-scoped ceiling, clamped to the hard allocation limit. */
  readonly maximumTiles?: number;
}

export interface StudioGpuDabTileBinningPlan {
  readonly kind: "studio-gpu-dab-tile-binning-plan";
  readonly revision: typeof STUDIO_GPU_DAB_TILE_BINNING_REVISION;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly tileSize: number;
  readonly columns: number;
  readonly rows: number;
  readonly tileCount: number;
  readonly dabCount: number;
  readonly referenceCount: number;
  readonly nonEmptyTileCount: number;
  /** CSR offsets. Length is `tileCount + 1`; the final value equals `referenceCount`. */
  readonly tileOffsets: Readonly<Uint32Array>;
  /** Stable original-dab indices grouped by tile. */
  readonly dabIndices: Readonly<Uint32Array>;
}

export type StudioGpuDabTileBinningRejectionReason =
  | "invalid-input"
  | "dab-limit"
  | "tile-grid-limit"
  | "reference-budget"
  | "numeric-overflow";

export type StudioGpuDabTileBinningResult =
  | Readonly<{ status: "ready"; plan: Readonly<StudioGpuDabTileBinningPlan> }>
  | Readonly<{
      status: "rejected";
      reason: StudioGpuDabTileBinningRejectionReason;
    }>;

interface StudioGpuDabTileSpan {
  readonly minimumColumn: number;
  readonly maximumColumn: number;
  readonly minimumRow: number;
  readonly maximumRow: number;
  readonly referenceCount: number;
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizedLimit(
  value: number | undefined,
  hardMaximum: number,
): number | null {
  if (value === undefined) return hardMaximum;
  if (!Number.isSafeInteger(value) || value < 0) return null;
  return Math.min(value, hardMaximum);
}

function dabTileSpan(
  dab: Pick<StudioGpuDab, "x" | "y" | "radius">,
  documentWidth: number,
  documentHeight: number,
  tileSize: number,
  columns: number,
  rows: number,
): StudioGpuDabTileSpan | null | "numeric-overflow" {
  const minimumX = dab.x - dab.radius;
  const minimumY = dab.y - dab.radius;
  const maximumX = dab.x + dab.radius;
  const maximumY = dab.y + dab.radius;
  if (![minimumX, minimumY, maximumX, maximumY].every(Number.isFinite)) {
    return "numeric-overflow";
  }
  // A tangent that touches only the document's half-open outer edge contributes zero coverage.
  if (
    maximumX <= 0
    || maximumY <= 0
    || minimumX >= documentWidth
    || minimumY >= documentHeight
  ) return null;

  const clippedMinimumX = Math.max(0, minimumX);
  const clippedMinimumY = Math.max(0, minimumY);
  const clippedMaximumX = Math.min(documentWidth, maximumX);
  const clippedMaximumY = Math.min(documentHeight, maximumY);
  const minimumColumn = Math.min(
    columns - 1,
    Math.max(0, Math.floor(clippedMinimumX / tileSize)),
  );
  const minimumRow = Math.min(
    rows - 1,
    Math.max(0, Math.floor(clippedMinimumY / tileSize)),
  );
  // The coverage domain is half-open at its maximum edge. This avoids scheduling the next tile
  // when a zero-coverage circle tangent lands exactly on a tile boundary.
  const maximumColumn = Math.min(
    columns - 1,
    Math.max(minimumColumn, Math.ceil(clippedMaximumX / tileSize) - 1),
  );
  const maximumRow = Math.min(
    rows - 1,
    Math.max(minimumRow, Math.ceil(clippedMaximumY / tileSize) - 1),
  );
  const columnCount = maximumColumn - minimumColumn + 1;
  const rowCount = maximumRow - minimumRow + 1;
  const referenceCount = columnCount * rowCount;
  if (!Number.isSafeInteger(referenceCount) || referenceCount <= 0) {
    return "numeric-overflow";
  }
  return {
    minimumColumn,
    maximumColumn,
    minimumRow,
    maximumRow,
    referenceCount,
  };
}

export function planStudioGpuDabTileBinning(
  input: StudioGpuDabTileBinningInput,
): StudioGpuDabTileBinningResult {
  const tileSize = input?.tileSize
    ?? STUDIO_GPU_DAB_TILE_BINNING_DEFAULT_TILE_SIZE;
  const maximumTiles = normalizedLimit(
    input?.maximumTiles,
    STUDIO_GPU_DAB_TILE_BINNING_MAX_TILES,
  );
  const maximumTileReferences = normalizedLimit(
    input?.maximumTileReferences,
    STUDIO_GPU_DAB_TILE_BINNING_MAX_REFERENCES,
  );
  if (
    !input
    || !finitePositive(input.documentWidth)
    || !finitePositive(input.documentHeight)
    || !finitePositive(tileSize)
    || !Array.isArray(input.dabs)
    || maximumTiles === null
    || maximumTileReferences === null
  ) return Object.freeze({ status: "rejected", reason: "invalid-input" });
  if (input.dabs.length > STUDIO_GPU_DAB_TILE_BINNING_MAX_DABS) {
    return Object.freeze({ status: "rejected", reason: "dab-limit" });
  }

  const columns = Math.ceil(input.documentWidth / tileSize);
  const rows = Math.ceil(input.documentHeight / tileSize);
  const tileCount = columns * rows;
  if (
    !Number.isSafeInteger(columns)
    || !Number.isSafeInteger(rows)
    || !Number.isSafeInteger(tileCount)
    || columns <= 0
    || rows <= 0
  ) return Object.freeze({ status: "rejected", reason: "numeric-overflow" });
  if (tileCount > maximumTiles) {
    return Object.freeze({ status: "rejected", reason: "tile-grid-limit" });
  }

  const spans: Array<StudioGpuDabTileSpan | null> = [];
  const tileCounts = new Uint32Array(tileCount);
  let referenceCount = 0;
  for (const dab of input.dabs) {
    if (
      typeof dab !== "object"
      || dab === null
      || !finite(dab.x)
      || !finite(dab.y)
      || !finitePositive(dab.radius)
    ) return Object.freeze({ status: "rejected", reason: "invalid-input" });
    const span = dabTileSpan(
      dab,
      input.documentWidth,
      input.documentHeight,
      tileSize,
      columns,
      rows,
    );
    if (span === "numeric-overflow") {
      return Object.freeze({ status: "rejected", reason: "numeric-overflow" });
    }
    spans.push(span);
    if (!span) continue;
    referenceCount += span.referenceCount;
    if (!Number.isSafeInteger(referenceCount)) {
      return Object.freeze({ status: "rejected", reason: "numeric-overflow" });
    }
    if (referenceCount > maximumTileReferences) {
      return Object.freeze({ status: "rejected", reason: "reference-budget" });
    }
    for (let row = span.minimumRow; row <= span.maximumRow; row += 1) {
      const rowOffset = row * columns;
      for (
        let column = span.minimumColumn;
        column <= span.maximumColumn;
        column += 1
      ) {
        tileCounts[rowOffset + column] += 1;
      }
    }
  }

  const tileOffsets = new Uint32Array(tileCount + 1);
  let runningOffset = 0;
  let nonEmptyTileCount = 0;
  for (let tileIndex = 0; tileIndex < tileCount; tileIndex += 1) {
    tileOffsets[tileIndex] = runningOffset;
    const count = tileCounts[tileIndex]!;
    if (count > 0) nonEmptyTileCount += 1;
    runningOffset += count;
  }
  tileOffsets[tileCount] = runningOffset;
  if (runningOffset !== referenceCount) {
    return Object.freeze({ status: "rejected", reason: "numeric-overflow" });
  }

  const dabIndices = new Uint32Array(referenceCount);
  const writeCursors = tileOffsets.slice(0, tileCount);
  for (let dabIndex = 0; dabIndex < spans.length; dabIndex += 1) {
    const span = spans[dabIndex];
    if (!span) continue;
    for (let row = span.minimumRow; row <= span.maximumRow; row += 1) {
      const rowOffset = row * columns;
      for (
        let column = span.minimumColumn;
        column <= span.maximumColumn;
        column += 1
      ) {
        const tileIndex = rowOffset + column;
        dabIndices[writeCursors[tileIndex]!] = dabIndex;
        writeCursors[tileIndex] += 1;
      }
    }
  }

  return Object.freeze({
    status: "ready",
    plan: Object.freeze({
      kind: "studio-gpu-dab-tile-binning-plan",
      revision: STUDIO_GPU_DAB_TILE_BINNING_REVISION,
      documentWidth: input.documentWidth,
      documentHeight: input.documentHeight,
      tileSize,
      columns,
      rows,
      tileCount,
      dabCount: input.dabs.length,
      referenceCount,
      nonEmptyTileCount,
      tileOffsets,
      dabIndices,
    }),
  });
}

/** Returns a zero-copy stable view for one tile, or null for an invalid plan/index. */
export function studioGpuDabIndicesForTile(
  plan: Readonly<StudioGpuDabTileBinningPlan>,
  tileIndex: number,
): Readonly<Uint32Array> | null {
  if (
    !plan
    || plan.kind !== "studio-gpu-dab-tile-binning-plan"
    || plan.revision !== STUDIO_GPU_DAB_TILE_BINNING_REVISION
    || !Number.isSafeInteger(tileIndex)
    || tileIndex < 0
    || tileIndex >= plan.tileCount
    || plan.tileOffsets.length !== plan.tileCount + 1
    || plan.dabIndices.length !== plan.referenceCount
  ) return null;
  const start = plan.tileOffsets[tileIndex];
  const end = plan.tileOffsets[tileIndex + 1];
  if (start === undefined || end === undefined || start > end || end > plan.referenceCount) {
    return null;
  }
  return plan.dabIndices.subarray(start, end);
}
