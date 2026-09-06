import {
  StudioGpuSparseBrushFramePlanner,
  type StudioGpuSparseBrushFrameInput,
  type StudioGpuSparseBrushFramePrepareResult,
  type StudioGpuSparseBrushFrameSettlementResult,
  type StudioGpuSparseBrushFrameToken,
  type StudioGpuSparseBrushPreparedFrame,
  type StudioGpuSparseBrushTileWork,
} from "./studio-webgpu-sparse-brush-frame";

export const STUDIO_GPU_SPARSE_BRUSH_ATLAS_RUNTIME_REVISION = 1 as const;
export const STUDIO_GPU_SPARSE_BRUSH_ATLAS_FORMAT = "rgba16float" as const;
export const STUDIO_GPU_SPARSE_BRUSH_ATLAS_BYTES_PER_PIXEL = 8;

const GPU_TEXTURE_COPY_SRC = 0x01;
const GPU_TEXTURE_COPY_DST = 0x02;
const GPU_TEXTURE_BINDING = 0x04;
const GPU_TEXTURE_RENDER_ATTACHMENT = 0x10;

export const STUDIO_GPU_SPARSE_BRUSH_ATLAS_USAGE =
  GPU_TEXTURE_COPY_SRC
  | GPU_TEXTURE_COPY_DST
  | GPU_TEXTURE_BINDING
  | GPU_TEXTURE_RENDER_ATTACHMENT;

export interface StudioGpuSparseBrushAtlasRuntimeOptions {
  readonly device: GPUDevice;
  readonly columns: number;
  readonly rows: number;
  readonly tileSize?: number;
  readonly bleed?: number;
  readonly maximumTextureDimension2D?: number;
  readonly ownsDevice?: boolean;
  readonly onDeviceLost?: (info: GPUDeviceLostInfo) => void;
}

export interface StudioGpuSparseBrushAtlasTileWork
  extends StudioGpuSparseBrushTileWork {
  readonly allocationRect: Readonly<{
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }>;
  readonly contentRect: Readonly<{
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }>;
  readonly logicalRenderOrigin: Readonly<{
    readonly x: number;
    readonly y: number;
  }>;
  readonly contentUv: Readonly<{
    readonly minimumU: number;
    readonly minimumV: number;
    readonly maximumU: number;
    readonly maximumV: number;
  }>;
}

export interface StudioGpuSparseBrushAtlasPreparedFrame
  extends Omit<StudioGpuSparseBrushPreparedFrame, "kind" | "tiles"> {
  readonly kind: "studio-gpu-sparse-brush-atlas-frame";
  readonly runtimeRevision:
    typeof STUDIO_GPU_SPARSE_BRUSH_ATLAS_RUNTIME_REVISION;
  readonly texture: GPUTexture;
  readonly view: GPUTextureView;
  readonly format: typeof STUDIO_GPU_SPARSE_BRUSH_ATLAS_FORMAT;
  readonly atlasWidth: number;
  readonly atlasHeight: number;
  readonly tiles: readonly Readonly<StudioGpuSparseBrushAtlasTileWork>[];
}

export type StudioGpuSparseBrushAtlasPrepareResult =
  | Readonly<{
      status: "prepared";
      frame: Readonly<StudioGpuSparseBrushAtlasPreparedFrame>;
    }>
  | Exclude<StudioGpuSparseBrushFramePrepareResult, { status: "prepared" }>
  | Readonly<{ status: "rejected"; reason: "device-lost" }>;

export interface StudioGpuSparseBrushAtlasRuntimeStats {
  readonly revision: typeof STUDIO_GPU_SPARSE_BRUSH_ATLAS_RUNTIME_REVISION;
  readonly status: "ready" | "device-lost" | "disposed";
  readonly deviceGeneration: number;
  readonly atlasWidth: number;
  readonly atlasHeight: number;
  readonly textureBytes: number;
  readonly residentTiles: number;
  readonly activeFrameId: string | null;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
}

export type StudioGpuSparseBrushAtlasRuntimeCreationResult =
  | Readonly<{
      status: "ready";
      runtime: StudioGpuSparseBrushAtlasRuntime;
    }>
  | Readonly<{
      status: "rejected";
      reason: "invalid-options" | "initialization-failed";
    }>;

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function safeDestroyTexture(texture: GPUTexture | null): void {
  try {
    texture?.destroy();
  } catch {
    // A lost device may have already retired the texture.
  }
}

function safeDestroyDevice(device: GPUDevice, owned: boolean): void {
  if (!owned) return;
  try {
    device.destroy();
  } catch {
    // Best-effort release for a dedicated device.
  }
}

export function createStudioGpuSparseBrushAtlasRuntime(
  options: StudioGpuSparseBrushAtlasRuntimeOptions,
): StudioGpuSparseBrushAtlasRuntimeCreationResult {
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
  try {
    return Object.freeze({
      status: "ready",
      runtime: new StudioGpuSparseBrushAtlasRuntime(options),
    });
  } catch {
    safeDestroyDevice(options.device, options.ownsDevice === true);
    return Object.freeze({ status: "rejected", reason: "initialization-failed" });
  }
}

export class StudioGpuSparseBrushAtlasRuntime {
  readonly #device: GPUDevice;
  readonly #ownsDevice: boolean;
  readonly #planner: StudioGpuSparseBrushFramePlanner;
  readonly #texture: GPUTexture;
  readonly #view: GPUTextureView;
  readonly #atlasWidth: number;
  readonly #atlasHeight: number;
  readonly #tileSize: number;
  readonly #bleed: number;
  #lost = false;
  #disposed = false;
  #activeToken: StudioGpuSparseBrushFrameToken | null = null;

  public constructor(options: StudioGpuSparseBrushAtlasRuntimeOptions) {
    this.#device = options.device;
    this.#ownsDevice = options.ownsDevice === true;
    const reportedLimit = Number(options.device.limits?.maxTextureDimension2D);
    const deviceLimit = positiveSafeInteger(reportedLimit)
      ? reportedLimit
      : options.maximumTextureDimension2D;
    const maximumTextureDimension2D = options.maximumTextureDimension2D === undefined
      ? deviceLimit
      : deviceLimit === undefined
        ? options.maximumTextureDimension2D
        : Math.min(deviceLimit, options.maximumTextureDimension2D);
    this.#planner = new StudioGpuSparseBrushFramePlanner({
      columns: options.columns,
      rows: options.rows,
      ...(options.tileSize === undefined ? {} : { tileSize: options.tileSize }),
      ...(options.bleed === undefined ? {} : { bleed: options.bleed }),
      ...(maximumTextureDimension2D === undefined
        ? {}
        : { maximumTextureDimension2D }),
    });
    const topology = this.#planner.stats();
    this.#atlasWidth = topology.atlasWidth;
    this.#atlasHeight = topology.atlasHeight;
    this.#tileSize = topology.tileSize;
    this.#bleed = topology.bleed;
    let texture: GPUTexture | null = null;
    try {
      texture = this.#device.createTexture({
        label: "Studio sparse physical RGBA16F brush atlas",
        size: {
          width: this.#atlasWidth,
          height: this.#atlasHeight,
          depthOrArrayLayers: 1,
        },
        format: STUDIO_GPU_SPARSE_BRUSH_ATLAS_FORMAT,
        usage: STUDIO_GPU_SPARSE_BRUSH_ATLAS_USAGE,
      });
      const view = texture.createView();
      this.#texture = texture;
      this.#view = view;
    } catch (error) {
      safeDestroyTexture(texture);
      this.#planner.dispose();
      throw error;
    }
    void this.#device.lost.then((info) => {
      if (this.#disposed) return;
      this.#lost = true;
      this.#activeToken = null;
      this.#planner.resetDevice();
      options.onDeviceLost?.(info);
    });
  }

  public prepareFrame(
    input: StudioGpuSparseBrushFrameInput,
  ): StudioGpuSparseBrushAtlasPrepareResult {
    if (this.#disposed) {
      return Object.freeze({ status: "rejected", reason: "disposed" });
    }
    if (this.#lost) {
      return Object.freeze({ status: "rejected", reason: "device-lost" });
    }
    const prepared = this.#planner.prepareFrame(input);
    if (prepared.status !== "prepared") return prepared;
    const tiles: StudioGpuSparseBrushAtlasTileWork[] = [];
    for (const tile of prepared.frame.tiles) {
      const logicalX = tile.column * this.#tileSize;
      const logicalY = tile.row * this.#tileSize;
      const contentWidth = Math.min(
        this.#tileSize,
        input.documentWidth - logicalX,
      );
      const contentHeight = Math.min(
        this.#tileSize,
        input.documentHeight - logicalY,
      );
      if (contentWidth <= 0 || contentHeight <= 0) {
        this.#planner.abortFrame(prepared.frame.token);
        return Object.freeze({ status: "rejected", reason: "invalid-input" });
      }
      const { pixelX, pixelY, physicalExtent } = tile.assignment;
      const contentX = pixelX + this.#bleed;
      const contentY = pixelY + this.#bleed;
      tiles.push(Object.freeze({
        ...tile,
        allocationRect: Object.freeze({
          x: pixelX,
          y: pixelY,
          width: physicalExtent,
          height: physicalExtent,
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
    const frame: StudioGpuSparseBrushAtlasPreparedFrame = Object.freeze({
      ...prepared.frame,
      kind: "studio-gpu-sparse-brush-atlas-frame",
      runtimeRevision: STUDIO_GPU_SPARSE_BRUSH_ATLAS_RUNTIME_REVISION,
      texture: this.#texture,
      view: this.#view,
      format: STUDIO_GPU_SPARSE_BRUSH_ATLAS_FORMAT,
      atlasWidth: this.#atlasWidth,
      atlasHeight: this.#atlasHeight,
      tiles: Object.freeze(tiles),
    });
    this.#activeToken = prepared.frame.token;
    return Object.freeze({ status: "prepared", frame });
  }

  public completeFrame(
    token: StudioGpuSparseBrushFrameToken,
  ): StudioGpuSparseBrushFrameSettlementResult {
    if (this.#disposed) {
      return Object.freeze({ status: "rejected", reason: "disposed" });
    }
    if (this.#lost) {
      return Object.freeze({ status: "rejected", reason: "stale-generation" });
    }
    if (this.#activeToken !== token) {
      return Object.freeze({ status: "rejected", reason: "invalid-token" });
    }
    const result = this.#planner.completeFrame(token);
    if (result.status !== "rejected") this.#activeToken = null;
    return result;
  }

  public abortFrame(
    token: StudioGpuSparseBrushFrameToken,
  ): StudioGpuSparseBrushFrameSettlementResult {
    if (this.#disposed) {
      return Object.freeze({ status: "rejected", reason: "disposed" });
    }
    if (this.#lost) {
      return Object.freeze({ status: "rejected", reason: "stale-generation" });
    }
    if (this.#activeToken !== token) {
      return Object.freeze({ status: "rejected", reason: "invalid-token" });
    }
    const result = this.#planner.abortFrame(token);
    if (result.status !== "rejected") this.#activeToken = null;
    return result;
  }

  public stats(): Readonly<StudioGpuSparseBrushAtlasRuntimeStats> {
    const topology = this.#planner.stats();
    return Object.freeze({
      revision: STUDIO_GPU_SPARSE_BRUSH_ATLAS_RUNTIME_REVISION,
      status: this.#disposed ? "disposed" : this.#lost ? "device-lost" : "ready",
      deviceGeneration: topology.deviceGeneration,
      atlasWidth: this.#atlasWidth,
      atlasHeight: this.#atlasHeight,
      textureBytes:
        this.#atlasWidth
        * this.#atlasHeight
        * STUDIO_GPU_SPARSE_BRUSH_ATLAS_BYTES_PER_PIXEL,
      residentTiles: topology.residentTiles,
      activeFrameId: topology.activeFrameId,
      hits: topology.hits,
      misses: topology.misses,
      evictions: topology.evictions,
    });
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#activeToken = null;
    this.#planner.dispose();
    safeDestroyTexture(this.#texture);
    safeDestroyDevice(this.#device, this.#ownsDevice);
  }
}
