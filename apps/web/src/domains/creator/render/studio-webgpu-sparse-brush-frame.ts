import {
  planStudioGpuDabTileBinning,
  studioGpuDabIndicesForTile,
  type StudioGpuDabTileBinningPlan,
  type StudioGpuDabTileBinningRejectionReason,
} from "./studio-webgpu-dab-tile-binning";
import {
  StudioGpuSparseTileAtlas,
  type StudioGpuSparseTileAtlasAssignment,
  type StudioGpuSparseTileAtlasFrameToken,
  type StudioGpuSparseTileAtlasOptions,
  type StudioGpuSparseTileAtlasStats,
} from "./studio-webgpu-sparse-tile-atlas";

import type { StudioGpuDab } from "./studio-webgpu-dab-plan-contract";

export const STUDIO_GPU_SPARSE_BRUSH_FRAME_REVISION = 1 as const;

const STUDIO_GPU_SPARSE_BRUSH_FRAME_TOKEN: unique symbol = Symbol(
  "StudioGpuSparseBrushFrameToken",
);

export type StudioGpuSparseBrushFramePlannerOptions =
  StudioGpuSparseTileAtlasOptions;

export interface StudioGpuSparseBrushFrameInput {
  readonly frameId: string;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly dabs: readonly Pick<StudioGpuDab, "x" | "y" | "radius">[];
  /** Optional row-major logical-tile visibility filter (`column:row`). */
  readonly visibleTileIds?: readonly string[];
  readonly maximumTileReferences?: number;
  readonly maximumTiles?: number;
}

export interface StudioGpuSparseBrushTileWork {
  readonly logicalTileId: string;
  readonly tileIndex: number;
  readonly column: number;
  readonly row: number;
  readonly assignment: Readonly<StudioGpuSparseTileAtlasAssignment>;
  /** Zero-copy stable view into `binning.dabIndices`. */
  readonly dabIndices: Readonly<Uint32Array>;
}

export interface StudioGpuSparseBrushFrameToken {
  readonly frameId: string;
  readonly deviceGeneration: number;
  readonly atlasToken: StudioGpuSparseTileAtlasFrameToken;
  readonly [STUDIO_GPU_SPARSE_BRUSH_FRAME_TOKEN]: true;
}

export interface StudioGpuSparseBrushPreparedFrame {
  readonly kind: "studio-gpu-sparse-brush-frame";
  readonly revision: typeof STUDIO_GPU_SPARSE_BRUSH_FRAME_REVISION;
  readonly frameId: string;
  readonly deviceGeneration: number;
  readonly token: StudioGpuSparseBrushFrameToken;
  readonly binning: Readonly<StudioGpuDabTileBinningPlan>;
  readonly tiles: readonly Readonly<StudioGpuSparseBrushTileWork>[];
}

export type StudioGpuSparseBrushFramePrepareResult =
  | Readonly<{
      status: "prepared";
      frame: Readonly<StudioGpuSparseBrushPreparedFrame>;
    }>
  | Readonly<{
      status: "rejected";
      reason:
        | StudioGpuDabTileBinningRejectionReason
        | "invalid-visible-tiles"
        | "atlas-capacity"
        | "busy"
        | "disposed";
      detail?: string;
    }>;

export type StudioGpuSparseBrushFrameSettlementResult =
  | Readonly<{
      status: "completed" | "aborted";
      frameId: string;
      deviceGeneration: number;
      residentTiles: number;
    }>
  | Readonly<{
      status: "rejected";
      reason: "invalid-token" | "stale-generation" | "disposed";
    }>;

interface ActiveSparseBrushFrame {
  readonly token: StudioGpuSparseBrushFrameToken;
}

function parseVisibleTileId(
  id: unknown,
  columns: number,
  rows: number,
): number | null {
  if (typeof id !== "string" || !/^\d+:\d+$/u.test(id)) return null;
  const [columnToken, rowToken] = id.split(":");
  const column = Number(columnToken);
  const row = Number(rowToken);
  if (
    !Number.isSafeInteger(column)
    || !Number.isSafeInteger(row)
    || column < 0
    || row < 0
    || column >= columns
    || row >= rows
  ) return null;
  return row * columns + column;
}

export class StudioGpuSparseBrushFramePlanner {
  readonly #atlas: StudioGpuSparseTileAtlas;
  #active: ActiveSparseBrushFrame | null = null;
  #disposed = false;

  public constructor(options: StudioGpuSparseBrushFramePlannerOptions) {
    this.#atlas = new StudioGpuSparseTileAtlas(options);
  }

  public prepareFrame(
    input: StudioGpuSparseBrushFrameInput,
  ): StudioGpuSparseBrushFramePrepareResult {
    if (this.#disposed) {
      return Object.freeze({ status: "rejected", reason: "disposed" });
    }
    if (this.#active) {
      return Object.freeze({ status: "rejected", reason: "busy" });
    }
    if (!input || typeof input !== "object" || typeof input.frameId !== "string") {
      return Object.freeze({ status: "rejected", reason: "invalid-input" });
    }
    const stats = this.#atlas.stats();
    const binned = planStudioGpuDabTileBinning({
      documentWidth: input.documentWidth,
      documentHeight: input.documentHeight,
      tileSize: stats.tileSize,
      dabs: input.dabs,
      maximumTileReferences: input.maximumTileReferences,
      maximumTiles: input.maximumTiles,
    });
    if (binned.status !== "ready") return binned;

    let visible: Set<number> | null = null;
    if (input.visibleTileIds !== undefined) {
      if (
        !Array.isArray(input.visibleTileIds)
        || new Set(input.visibleTileIds).size !== input.visibleTileIds.length
      ) return Object.freeze({ status: "rejected", reason: "invalid-visible-tiles" });
      visible = new Set<number>();
      for (const id of input.visibleTileIds) {
        const tileIndex = parseVisibleTileId(
          id,
          binned.plan.columns,
          binned.plan.rows,
        );
        if (tileIndex === null || visible.has(tileIndex)) {
          return Object.freeze({ status: "rejected", reason: "invalid-visible-tiles" });
        }
        visible.add(tileIndex);
      }
    }

    const selected: Array<Readonly<{
      logicalTileId: string;
      tileIndex: number;
      column: number;
      row: number;
      dabIndices: Readonly<Uint32Array>;
    }>> = [];
    for (let tileIndex = 0; tileIndex < binned.plan.tileCount; tileIndex += 1) {
      if (visible && !visible.has(tileIndex)) continue;
      const dabIndices = studioGpuDabIndicesForTile(binned.plan, tileIndex);
      if (!dabIndices || dabIndices.length === 0) continue;
      const column = tileIndex % binned.plan.columns;
      const row = Math.floor(tileIndex / binned.plan.columns);
      selected.push(Object.freeze({
        logicalTileId: `${column}:${row}`,
        tileIndex,
        column,
        row,
        dabIndices,
      }));
    }

    const atlasFrame = this.#atlas.prepareFrame(
      input.frameId,
      selected.map(({ logicalTileId }) => logicalTileId),
    );
    if (atlasFrame.status !== "prepared") {
      return Object.freeze({
        status: "rejected",
        reason: atlasFrame.reason === "capacity" ? "atlas-capacity" : atlasFrame.reason,
        ...(atlasFrame.activeFrameId
          ? { detail: atlasFrame.activeFrameId }
          : {}),
      });
    }
    if (atlasFrame.frame.assignments.length !== selected.length) {
      this.#atlas.abortFrame(atlasFrame.frame.token);
      return Object.freeze({ status: "rejected", reason: "atlas-capacity" });
    }

    const tiles = selected.map((tile, index) => Object.freeze({
      ...tile,
      assignment: atlasFrame.frame.assignments[index]!,
    }));
    const token = Object.freeze<StudioGpuSparseBrushFrameToken>({
      frameId: input.frameId,
      deviceGeneration: atlasFrame.frame.deviceGeneration,
      atlasToken: atlasFrame.frame.token,
      [STUDIO_GPU_SPARSE_BRUSH_FRAME_TOKEN]: true,
    });
    const frame: StudioGpuSparseBrushPreparedFrame = Object.freeze({
      kind: "studio-gpu-sparse-brush-frame",
      revision: STUDIO_GPU_SPARSE_BRUSH_FRAME_REVISION,
      frameId: input.frameId,
      deviceGeneration: atlasFrame.frame.deviceGeneration,
      token,
      binning: binned.plan,
      tiles: Object.freeze(tiles),
    });
    this.#active = { token };
    return Object.freeze({ status: "prepared", frame });
  }

  public completeFrame(
    token: StudioGpuSparseBrushFrameToken,
  ): StudioGpuSparseBrushFrameSettlementResult {
    const valid = this.#validateToken(token);
    if (valid !== true) return valid;
    const settled = this.#atlas.completeFrame(token.atlasToken);
    if (settled.status === "rejected") return settled;
    this.#active = null;
    return settled;
  }

  public abortFrame(
    token: StudioGpuSparseBrushFrameToken,
  ): StudioGpuSparseBrushFrameSettlementResult {
    const valid = this.#validateToken(token);
    if (valid !== true) return valid;
    const settled = this.#atlas.abortFrame(token.atlasToken);
    if (settled.status === "rejected") return settled;
    this.#active = null;
    return settled;
  }

  public stats(): Readonly<StudioGpuSparseTileAtlasStats> {
    return this.#atlas.stats();
  }

  public resetDevice(): number {
    this.#active = null;
    return this.#atlas.resetDevice();
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#active = null;
    this.#atlas.dispose();
  }

  #validateToken(
    token: StudioGpuSparseBrushFrameToken,
  ): true | Extract<StudioGpuSparseBrushFrameSettlementResult, { status: "rejected" }> {
    if (this.#disposed) {
      return Object.freeze({ status: "rejected", reason: "disposed" });
    }
    if (
      !token
      || token[STUDIO_GPU_SPARSE_BRUSH_FRAME_TOKEN] !== true
      || token.deviceGeneration !== this.#atlas.stats().deviceGeneration
    ) return Object.freeze({ status: "rejected", reason: "stale-generation" });
    if (!this.#active || this.#active.token !== token) {
      return Object.freeze({ status: "rejected", reason: "invalid-token" });
    }
    return true;
  }
}
