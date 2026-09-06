import {
  createStudioWebGpuDabTileBinningComputeRuntime,
  planStudioWebGpuDabTileSpans,
  type StudioWebGpuDabTileBinningComputeExecutionResult,
  type StudioWebGpuDabTileBinningComputeRuntimeOptions,
  type StudioWebGpuDabTileBinningComputeRuntimeStats,
  type StudioWebGpuDabTileBinningComputeOutput,
  type StudioWebGpuDabTileSpanPlan,
} from "./studio-webgpu-dab-tile-binning-compute";
import {
  STUDIO_GPU_SPARSE_BRUSH_ATLAS_BYTES_PER_PIXEL,
  STUDIO_GPU_SPARSE_BRUSH_ATLAS_FORMAT,
  STUDIO_GPU_SPARSE_BRUSH_ATLAS_USAGE,
} from "./studio-webgpu-sparse-brush-atlas-runtime";
import {
  StudioGpuSparseTileAtlas,
  type StudioGpuSparseTileAtlasAssignment,
  type StudioGpuSparseTileAtlasFrameToken,
  type StudioGpuSparseTileAtlasOptions,
  type StudioGpuSparseTileAtlasStats,
} from "./studio-webgpu-sparse-tile-atlas";

import type { StudioGpuDab } from "./studio-webgpu-dab-plan-contract";

/**
 * Async sparse-frame boundary that keeps the exact stable CSR index on the GPU.
 *
 * Phase 2 introduced a deterministic CPU CSR oracle and a transactional sparse atlas. The exact
 * WebGPU count/scan/stable-scatter implementation arrived later, but nothing connected its output
 * buffers to an atlas frame: callers still had to materialize `dabIndices` on the CPU. This runtime
 * closes that seam. CPU work is limited to bounded span admission and a touched-tile bitset; stable
 * per-tile dab order remains in the compute-owned buffers consumed by the following render pass.
 *
 * There is deliberately no implicit CPU fallback. A caller selects this runtime only after its
 * adapter-specific election evidence promotes the compute backend. Rejection leaves the previous
 * authoritative frame intact and the caller may explicitly retain the CPU runtime it selected.
 */
export const STUDIO_GPU_SPARSE_BRUSH_COMPUTE_RUNTIME_REVISION = 1 as const;

const STUDIO_GPU_SPARSE_BRUSH_COMPUTE_TOKEN: unique symbol = Symbol(
  "StudioGpuSparseBrushComputeFrameToken",
);

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function safeDestroyTexture(texture: GPUTexture | null): void {
  try {
    texture?.destroy();
  } catch {
    // A lost device may already have retired the atlas.
  }
}

function safeDestroyDevice(device: GPUDevice, ownsDevice: boolean): void {
  if (!ownsDevice) return;
  try {
    device.destroy();
  } catch {
    // Best-effort release for a dedicated device.
  }
}

export interface StudioGpuSparseBrushComputeBinningBoundary {
  readonly deviceEpoch: number;
  execute(
    requestSequence: number,
    input: Readonly<{
      documentWidth: number;
      documentHeight: number;
      tileSize?: number;
      dabs: readonly Pick<StudioGpuDab, "x" | "y" | "radius">[];
      maximumTileReferences?: number;
      maximumTiles?: number;
    }>,
    options?: Readonly<{ readback?: boolean; signal?: AbortSignal }>,
  ): Promise<StudioWebGpuDabTileBinningComputeExecutionResult>;
  stats(): Readonly<StudioWebGpuDabTileBinningComputeRuntimeStats>;
  dispose(): void;
}

export interface StudioGpuSparseBrushComputeRuntimeOptions
  extends StudioGpuSparseTileAtlasOptions {
  readonly device: GPUDevice;
  readonly ownsDevice?: boolean;
  readonly maximumDabs?: number;
  readonly maximumTiles?: number;
  readonly maximumReferences?: number;
  readonly maximumStableTests?: number;
  readonly initialDeviceEpoch?: number;
  readonly onDeviceLost?: (info: GPUDeviceLostInfo) => void;
}

export interface StudioGpuSparseBrushComputeFrameInput {
  readonly frameId: string;
  readonly requestSequence: number;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly dabs: readonly Pick<StudioGpuDab, "x" | "y" | "radius">[];
  /** Optional row-major logical-tile visibility filter (`column:row`). */
  readonly visibleTileIds?: readonly string[];
  readonly maximumTileReferences?: number;
  readonly maximumTiles?: number;
  readonly signal?: AbortSignal;
}

export interface StudioGpuSparseBrushComputeTileWork {
  readonly logicalTileId: string;
  readonly tileIndex: number;
  readonly column: number;
  readonly row: number;
  readonly assignment: Readonly<StudioGpuSparseTileAtlasAssignment>;
  readonly allocationRect: Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  readonly contentRect: Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  readonly logicalRenderOrigin: Readonly<{ x: number; y: number }>;
  readonly contentUv: Readonly<{
    minimumU: number;
    minimumV: number;
    maximumU: number;
    maximumV: number;
  }>;
}

export interface StudioGpuSparseBrushComputeFrameToken {
  readonly frameId: string;
  readonly requestSequence: number;
  readonly deviceGeneration: number;
  readonly computeDeviceEpoch: number;
  readonly atlasToken: StudioGpuSparseTileAtlasFrameToken;
  readonly [STUDIO_GPU_SPARSE_BRUSH_COMPUTE_TOKEN]: true;
}

export interface StudioGpuSparseBrushComputePreparedFrame {
  readonly kind: "studio-gpu-sparse-brush-compute-frame";
  readonly revision: typeof STUDIO_GPU_SPARSE_BRUSH_COMPUTE_RUNTIME_REVISION;
  readonly frameId: string;
  readonly requestSequence: number;
  readonly deviceGeneration: number;
  readonly computeDeviceEpoch: number;
  readonly token: StudioGpuSparseBrushComputeFrameToken;
  readonly texture: GPUTexture;
  readonly view: GPUTextureView;
  readonly format: typeof STUDIO_GPU_SPARSE_BRUSH_ATLAS_FORMAT;
  readonly atlasWidth: number;
  readonly atlasHeight: number;
  readonly tileSize: number;
  readonly bleed: number;
  readonly binning: Readonly<StudioWebGpuDabTileBinningComputeOutput>;
  readonly tiles: readonly Readonly<StudioGpuSparseBrushComputeTileWork>[];
}

export type StudioGpuSparseBrushComputePrepareResult =
  | Readonly<{
      status: "prepared";
      frame: Readonly<StudioGpuSparseBrushComputePreparedFrame>;
    }>
  | Readonly<{
      status: "rejected";
      reason:
        | "invalid-input"
        | "invalid-visible-tiles"
        | "request-sequence"
        | "atlas-capacity"
        | "compute-rejected"
        | "compute-failed"
        | "device-lost"
        | "busy"
        | "cancelled"
        | "disposed";
      detail?: string;
    }>;

export type StudioGpuSparseBrushComputeSettlementResult =
  | Readonly<{
      status: "completed" | "aborted";
      frameId: string;
      requestSequence: number;
      residentTiles: number;
      deviceGeneration: number;
    }>
  | Readonly<{
      status: "rejected";
      reason: "invalid-token" | "stale-generation" | "device-lost" | "disposed";
    }>;

export interface StudioGpuSparseBrushComputeRuntimeStats {
  readonly revision: typeof STUDIO_GPU_SPARSE_BRUSH_COMPUTE_RUNTIME_REVISION;
  readonly status: "ready" | "busy" | "device-lost" | "disposed";
  readonly deviceGeneration: number;
  readonly computeDeviceEpoch: number;
  readonly lastRequestSequence: number;
  readonly atlasWidth: number;
  readonly atlasHeight: number;
  readonly textureBytes: number;
  readonly residentTiles: number;
  readonly activeFrameId: string | null;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  readonly compute: Readonly<StudioWebGpuDabTileBinningComputeRuntimeStats>;
}

export type StudioGpuSparseBrushComputeRuntimeCreationResult =
  | Readonly<{
      status: "ready";
      runtime: StudioGpuSparseBrushComputeRuntime;
    }>
  | Readonly<{
      status: "rejected";
      reason: "invalid-options" | "compute-unavailable" | "initialization-failed";
    }>;

interface ActiveComputeFrame {
  readonly token: StudioGpuSparseBrushComputeFrameToken;
}

function parseVisibleTileIds(
  input: readonly string[] | undefined,
  columns: number,
  rows: number,
): ReadonlySet<number> | null | "invalid" {
  if (input === undefined) return null;
  if (!Array.isArray(input) || new Set(input).size !== input.length) return "invalid";
  const result = new Set<number>();
  for (const id of input) {
    if (typeof id !== "string" || !/^\d+:\d+$/u.test(id)) return "invalid";
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
    ) return "invalid";
    result.add(row * columns + column);
  }
  return result;
}

/**
 * Returns touched tile indices in row-major order without constructing stable per-tile dab lists.
 * Stable references are emitted only by the GPU scatter pass.
 */
export function studioGpuTouchedTilesFromDabSpans(
  plan: Readonly<StudioWebGpuDabTileSpanPlan>,
  visible: ReadonlySet<number> | null = null,
): Readonly<Uint32Array> | null {
  if (
    !plan
    || plan.kind !== "studio-webgpu-dab-tile-span-plan"
    || plan.spans.length !== plan.dabCount * 4
    || !positiveSafeInteger(plan.columns)
    || !positiveSafeInteger(plan.rows)
    || plan.columns * plan.rows !== plan.tileCount
  ) return null;
  const touched = new Uint8Array(plan.tileCount);
  for (let dabIndex = 0; dabIndex < plan.dabCount; dabIndex += 1) {
    const offset = dabIndex * 4;
    const minimumColumn = plan.spans[offset]!;
    if (minimumColumn === 0xffff_ffff) continue;
    const maximumColumn = plan.spans[offset + 1]!;
    const minimumRow = plan.spans[offset + 2]!;
    const maximumRow = plan.spans[offset + 3]!;
    if (
      minimumColumn > maximumColumn
      || minimumRow > maximumRow
      || maximumColumn >= plan.columns
      || maximumRow >= plan.rows
    ) return null;
    for (let row = minimumRow; row <= maximumRow; row += 1) {
      const rowOffset = row * plan.columns;
      for (let column = minimumColumn; column <= maximumColumn; column += 1) {
        const tileIndex = rowOffset + column;
        if (!visible || visible.has(tileIndex)) touched[tileIndex] = 1;
      }
    }
  }
  let count = 0;
  for (const value of touched) count += value;
  const result = new Uint32Array(count);
  let cursor = 0;
  for (let tileIndex = 0; tileIndex < touched.length; tileIndex += 1) {
    if (touched[tileIndex] === 1) result[cursor++] = tileIndex;
  }
  return result;
}

function atlasOptions(
  options: StudioGpuSparseBrushComputeRuntimeOptions,
): StudioGpuSparseTileAtlasOptions {
  return {
    columns: options.columns,
    rows: options.rows,
    ...(options.tileSize === undefined ? {} : { tileSize: options.tileSize }),
    ...(options.bleed === undefined ? {} : { bleed: options.bleed }),
    ...(options.maximumTextureDimension2D === undefined
      ? {}
      : { maximumTextureDimension2D: options.maximumTextureDimension2D }),
  };
}

function computeOptions(
  options: StudioGpuSparseBrushComputeRuntimeOptions,
): StudioWebGpuDabTileBinningComputeRuntimeOptions {
  return {
    device: options.device,
    ownsDevice: false,
    ...(options.maximumDabs === undefined ? {} : { maximumDabs: options.maximumDabs }),
    ...(options.maximumTiles === undefined ? {} : { maximumTiles: options.maximumTiles }),
    ...(options.maximumReferences === undefined
      ? {}
      : { maximumReferences: options.maximumReferences }),
    ...(options.maximumStableTests === undefined
      ? {}
      : { maximumStableTests: options.maximumStableTests }),
    ...(options.initialDeviceEpoch === undefined
      ? {}
      : { initialDeviceEpoch: options.initialDeviceEpoch }),
  };
}

export function createStudioGpuSparseBrushComputeRuntime(
  options: StudioGpuSparseBrushComputeRuntimeOptions,
): StudioGpuSparseBrushComputeRuntimeCreationResult {
  if (
    !options
    || typeof options !== "object"
    || !options.device
    || typeof options.device.createTexture !== "function"
    || !options.device.lost
    || typeof options.device.lost.then !== "function"
    || !positiveSafeInteger(options.columns)
    || !positiveSafeInteger(options.rows)
  ) return Object.freeze({ status: "rejected", reason: "invalid-options" });
  const created = createStudioWebGpuDabTileBinningComputeRuntime(
    computeOptions(options),
  );
  if (created.status !== "ready") {
    return Object.freeze({ status: "rejected", reason: "compute-unavailable" });
  }
  try {
    return Object.freeze({
      status: "ready",
      runtime: new StudioGpuSparseBrushComputeRuntime(
        options,
        created.runtime,
        true,
      ),
    });
  } catch {
    created.runtime.dispose();
    safeDestroyDevice(options.device, options.ownsDevice === true);
    return Object.freeze({ status: "rejected", reason: "initialization-failed" });
  }
}

/** @internal Injectable exact boundary for unit tests and adapter-owned compute runtimes. */
export function createStudioGpuSparseBrushComputeRuntimeWithBoundary(
  options: StudioGpuSparseBrushComputeRuntimeOptions,
  boundary: StudioGpuSparseBrushComputeBinningBoundary,
  disposeBoundary = false,
): StudioGpuSparseBrushComputeRuntimeCreationResult {
  if (
    !options
    || typeof options !== "object"
    || !options.device
    || typeof options.device.createTexture !== "function"
    || !options.device.lost
    || typeof options.device.lost.then !== "function"
    || !positiveSafeInteger(options.columns)
    || !positiveSafeInteger(options.rows)
    || !boundary
    || typeof boundary.execute !== "function"
    || typeof boundary.stats !== "function"
    || typeof boundary.dispose !== "function"
    || !positiveSafeInteger(boundary.deviceEpoch)
  ) return Object.freeze({ status: "rejected", reason: "invalid-options" });
  try {
    return Object.freeze({
      status: "ready",
      runtime: new StudioGpuSparseBrushComputeRuntime(
        options,
        boundary,
        disposeBoundary,
      ),
    });
  } catch {
    if (disposeBoundary) boundary.dispose();
    safeDestroyDevice(options.device, options.ownsDevice === true);
    return Object.freeze({ status: "rejected", reason: "initialization-failed" });
  }
}

export class StudioGpuSparseBrushComputeRuntime {
  readonly #device: GPUDevice;
  readonly #ownsDevice: boolean;
  readonly #atlas: StudioGpuSparseTileAtlas;
  readonly #binning: StudioGpuSparseBrushComputeBinningBoundary;
  readonly #disposeBinning: boolean;
  readonly #texture: GPUTexture;
  readonly #view: GPUTextureView;
  readonly #atlasWidth: number;
  readonly #atlasHeight: number;
  readonly #tileSize: number;
  readonly #bleed: number;
  #lastRequestSequence = 0;
  #active: ActiveComputeFrame | null = null;
  #preparing = false;
  #lost = false;
  #disposed = false;

  public constructor(
    options: StudioGpuSparseBrushComputeRuntimeOptions,
    binning: StudioGpuSparseBrushComputeBinningBoundary,
    disposeBinning: boolean,
  ) {
    this.#device = options.device;
    this.#ownsDevice = options.ownsDevice === true;
    this.#binning = binning;
    this.#disposeBinning = disposeBinning;
    const reportedLimit = Number(options.device.limits?.maxTextureDimension2D);
    const deviceLimit = positiveSafeInteger(reportedLimit)
      ? reportedLimit
      : undefined;
    const configuredLimit = options.maximumTextureDimension2D;
    const maximumTextureDimension2D = deviceLimit === undefined
      ? configuredLimit
      : configuredLimit === undefined
        ? deviceLimit
        : Math.min(deviceLimit, configuredLimit);
    this.#atlas = new StudioGpuSparseTileAtlas({
      ...atlasOptions(options),
      ...(maximumTextureDimension2D === undefined
        ? {}
        : { maximumTextureDimension2D }),
    });
    const topology = this.#atlas.stats();
    this.#atlasWidth = topology.atlasWidth;
    this.#atlasHeight = topology.atlasHeight;
    this.#tileSize = topology.tileSize;
    this.#bleed = topology.bleed;
    let texture: GPUTexture | null = null;
    try {
      texture = this.#device.createTexture({
        label: "Studio sparse compute RGBA16F brush atlas",
        size: {
          width: this.#atlasWidth,
          height: this.#atlasHeight,
          depthOrArrayLayers: 1,
        },
        format: STUDIO_GPU_SPARSE_BRUSH_ATLAS_FORMAT,
        usage: STUDIO_GPU_SPARSE_BRUSH_ATLAS_USAGE,
      });
      this.#texture = texture;
      this.#view = texture.createView();
    } catch (error) {
      safeDestroyTexture(texture);
      this.#atlas.dispose();
      throw error;
    }
    void this.#device.lost.then((info) => {
      if (this.#disposed) return;
      this.#lost = true;
      this.#preparing = false;
      this.#active = null;
      this.#atlas.resetDevice();
      options.onDeviceLost?.(info);
    });
  }

  public async prepareFrame(
    input: StudioGpuSparseBrushComputeFrameInput,
  ): Promise<StudioGpuSparseBrushComputePrepareResult> {
    if (this.#disposed) return Object.freeze({ status: "rejected", reason: "disposed" });
    if (this.#lost) return Object.freeze({ status: "rejected", reason: "device-lost" });
    if (this.#preparing || this.#active) {
      return Object.freeze({ status: "rejected", reason: "busy" });
    }
    if (
      !input
      || typeof input !== "object"
      || typeof input.frameId !== "string"
      || input.frameId.length === 0
      || input.frameId.length > 256
      || !positiveSafeInteger(input.requestSequence)
      || input.requestSequence <= this.#lastRequestSequence
      || !finitePositive(input.documentWidth)
      || !finitePositive(input.documentHeight)
      || !Array.isArray(input.dabs)
      || (input.signal !== undefined && !(input.signal instanceof AbortSignal))
    ) {
      return Object.freeze({
        status: "rejected",
        reason: positiveSafeInteger(input?.requestSequence)
          && input.requestSequence <= this.#lastRequestSequence
          ? "request-sequence"
          : "invalid-input",
      });
    }
    if (input.signal?.aborted) {
      return Object.freeze({ status: "rejected", reason: "cancelled" });
    }

    const topology = this.#atlas.stats();
    const computeInput = {
      documentWidth: input.documentWidth,
      documentHeight: input.documentHeight,
      tileSize: topology.tileSize,
      dabs: input.dabs,
      ...(input.maximumTileReferences === undefined
        ? {}
        : { maximumTileReferences: input.maximumTileReferences }),
      ...(input.maximumTiles === undefined
        ? {}
        : { maximumTiles: input.maximumTiles }),
    };
    const spans = planStudioWebGpuDabTileSpans(computeInput, {
      maximumTiles: input.maximumTiles,
      maximumReferences: input.maximumTileReferences,
    });
    if (spans.status !== "ready") {
      return Object.freeze({
        status: "rejected",
        reason: "compute-rejected",
        detail: spans.reason,
      });
    }
    const visible = parseVisibleTileIds(
      input.visibleTileIds,
      spans.plan.columns,
      spans.plan.rows,
    );
    if (visible === "invalid") {
      return Object.freeze({
        status: "rejected",
        reason: "invalid-visible-tiles",
      });
    }
    const touched = studioGpuTouchedTilesFromDabSpans(spans.plan, visible);
    if (!touched) {
      return Object.freeze({ status: "rejected", reason: "invalid-input" });
    }
    const logicalTileIds = Array.from(touched, (tileIndex) => {
      const column = tileIndex % spans.plan.columns;
      const row = Math.floor(tileIndex / spans.plan.columns);
      return `${column}:${row}`;
    });
    const atlasFrame = this.#atlas.prepareFrame(input.frameId, logicalTileIds);
    if (atlasFrame.status !== "prepared") {
      return Object.freeze({
        status: "rejected",
        reason: atlasFrame.reason === "capacity" ? "atlas-capacity" : atlasFrame.reason,
        ...(atlasFrame.activeFrameId ? { detail: atlasFrame.activeFrameId } : {}),
      });
    }

    this.#preparing = true;
    this.#lastRequestSequence = input.requestSequence;
    try {
      const computed = await this.#binning.execute(
        input.requestSequence,
        computeInput,
        { readback: false, signal: input.signal },
      );
      if (computed.status !== "completed") {
        this.#atlas.abortFrame(atlasFrame.frame.token);
        if (computed.status === "cancelled") {
          return Object.freeze({ status: "rejected", reason: "cancelled" });
        }
        if (computed.status === "device-lost") {
          this.#lost = true;
          this.#atlas.resetDevice();
          return Object.freeze({ status: "rejected", reason: "device-lost" });
        }
        if (computed.status === "rejected") {
          return Object.freeze({
            status: "rejected",
            reason: "compute-rejected",
            detail: computed.reason,
          });
        }
        return Object.freeze({
          status: "rejected",
          reason: "compute-failed",
          detail: computed.status,
        });
      }
      if (input.signal?.aborted) {
        this.#atlas.abortFrame(atlasFrame.frame.token);
        return Object.freeze({ status: "rejected", reason: "cancelled" });
      }
      if (
        computed.output.tileCount !== spans.plan.tileCount
        || computed.output.referenceCount !== spans.plan.referenceCount
        || atlasFrame.frame.assignments.length !== touched.length
      ) {
        this.#atlas.abortFrame(atlasFrame.frame.token);
        return Object.freeze({
          status: "rejected",
          reason: "compute-failed",
          detail: "output-contract",
        });
      }

      const tiles: StudioGpuSparseBrushComputeTileWork[] = [];
      for (let index = 0; index < touched.length; index += 1) {
        const tileIndex = touched[index]!;
        const assignment = atlasFrame.frame.assignments[index]!;
        const column = tileIndex % spans.plan.columns;
        const row = Math.floor(tileIndex / spans.plan.columns);
        const logicalX = column * this.#tileSize;
        const logicalY = row * this.#tileSize;
        const contentWidth = Math.min(this.#tileSize, input.documentWidth - logicalX);
        const contentHeight = Math.min(this.#tileSize, input.documentHeight - logicalY);
        if (contentWidth <= 0 || contentHeight <= 0) {
          this.#atlas.abortFrame(atlasFrame.frame.token);
          return Object.freeze({ status: "rejected", reason: "invalid-input" });
        }
        const contentX = assignment.pixelX + this.#bleed;
        const contentY = assignment.pixelY + this.#bleed;
        tiles.push(Object.freeze({
          logicalTileId: assignment.logicalTileId,
          tileIndex,
          column,
          row,
          assignment,
          allocationRect: Object.freeze({
            x: assignment.pixelX,
            y: assignment.pixelY,
            width: assignment.physicalExtent,
            height: assignment.physicalExtent,
          }),
          contentRect: Object.freeze({
            x: contentX,
            y: contentY,
            width: contentWidth,
            height: contentHeight,
          }),
          logicalRenderOrigin: Object.freeze({
            x: logicalX - this.#bleed,
            y: logicalY - this.#bleed,
          }),
          contentUv: Object.freeze({
            minimumU: contentX / this.#atlasWidth,
            minimumV: contentY / this.#atlasHeight,
            maximumU: (contentX + contentWidth) / this.#atlasWidth,
            maximumV: (contentY + contentHeight) / this.#atlasHeight,
          }),
        }));
      }
      const token = Object.freeze<StudioGpuSparseBrushComputeFrameToken>({
        frameId: input.frameId,
        requestSequence: input.requestSequence,
        deviceGeneration: atlasFrame.frame.deviceGeneration,
        computeDeviceEpoch: computed.receipt.deviceEpoch,
        atlasToken: atlasFrame.frame.token,
        [STUDIO_GPU_SPARSE_BRUSH_COMPUTE_TOKEN]: true,
      });
      const frame: StudioGpuSparseBrushComputePreparedFrame = Object.freeze({
        kind: "studio-gpu-sparse-brush-compute-frame",
        revision: STUDIO_GPU_SPARSE_BRUSH_COMPUTE_RUNTIME_REVISION,
        frameId: input.frameId,
        requestSequence: input.requestSequence,
        deviceGeneration: atlasFrame.frame.deviceGeneration,
        computeDeviceEpoch: computed.receipt.deviceEpoch,
        token,
        texture: this.#texture,
        view: this.#view,
        format: STUDIO_GPU_SPARSE_BRUSH_ATLAS_FORMAT,
        atlasWidth: this.#atlasWidth,
        atlasHeight: this.#atlasHeight,
        tileSize: this.#tileSize,
        bleed: this.#bleed,
        binning: computed.output,
        tiles: Object.freeze(tiles),
      });
      this.#active = { token };
      return Object.freeze({ status: "prepared", frame });
    } catch {
      this.#atlas.abortFrame(atlasFrame.frame.token);
      return Object.freeze({ status: "rejected", reason: "compute-failed" });
    } finally {
      this.#preparing = false;
    }
  }

  public completeFrame(
    token: StudioGpuSparseBrushComputeFrameToken,
  ): StudioGpuSparseBrushComputeSettlementResult {
    const valid = this.#validateToken(token);
    if (valid !== true) return valid;
    const settled = this.#atlas.completeFrame(token.atlasToken);
    if (settled.status === "rejected") return settled;
    this.#active = null;
    return Object.freeze({
      ...settled,
      requestSequence: token.requestSequence,
    });
  }

  public abortFrame(
    token: StudioGpuSparseBrushComputeFrameToken,
  ): StudioGpuSparseBrushComputeSettlementResult {
    const valid = this.#validateToken(token);
    if (valid !== true) return valid;
    const settled = this.#atlas.abortFrame(token.atlasToken);
    if (settled.status === "rejected") return settled;
    this.#active = null;
    return Object.freeze({
      ...settled,
      requestSequence: token.requestSequence,
    });
  }

  public stats(): Readonly<StudioGpuSparseBrushComputeRuntimeStats> {
    const atlas = this.#atlas.stats();
    return Object.freeze({
      revision: STUDIO_GPU_SPARSE_BRUSH_COMPUTE_RUNTIME_REVISION,
      status: this.#disposed
        ? "disposed"
        : this.#lost
          ? "device-lost"
          : this.#preparing || this.#active
            ? "busy"
            : "ready",
      deviceGeneration: atlas.deviceGeneration,
      computeDeviceEpoch: this.#binning.deviceEpoch,
      lastRequestSequence: this.#lastRequestSequence,
      atlasWidth: this.#atlasWidth,
      atlasHeight: this.#atlasHeight,
      textureBytes:
        this.#atlasWidth
        * this.#atlasHeight
        * STUDIO_GPU_SPARSE_BRUSH_ATLAS_BYTES_PER_PIXEL,
      residentTiles: atlas.residentTiles,
      activeFrameId: atlas.activeFrameId,
      hits: atlas.hits,
      misses: atlas.misses,
      evictions: atlas.evictions,
      compute: this.#binning.stats(),
    });
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#preparing = false;
    this.#active = null;
    this.#atlas.dispose();
    if (this.#disposeBinning) this.#binning.dispose();
    safeDestroyTexture(this.#texture);
    safeDestroyDevice(this.#device, this.#ownsDevice);
  }

  #validateToken(
    token: StudioGpuSparseBrushComputeFrameToken,
  ):
    | true
    | Extract<StudioGpuSparseBrushComputeSettlementResult, { status: "rejected" }> {
    if (this.#disposed) {
      return Object.freeze({ status: "rejected", reason: "disposed" });
    }
    if (this.#lost) {
      return Object.freeze({ status: "rejected", reason: "device-lost" });
    }
    const atlasStats: Readonly<StudioGpuSparseTileAtlasStats> = this.#atlas.stats();
    if (
      !token
      || token[STUDIO_GPU_SPARSE_BRUSH_COMPUTE_TOKEN] !== true
      || token.deviceGeneration !== atlasStats.deviceGeneration
      || token.computeDeviceEpoch !== this.#binning.deviceEpoch
    ) return Object.freeze({ status: "rejected", reason: "stale-generation" });
    if (!this.#active || this.#active.token !== token) {
      return Object.freeze({ status: "rejected", reason: "invalid-token" });
    }
    return true;
  }
}
