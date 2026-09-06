/**
 * ToonSpectrum-owned WebGPU RGBA16F tile execution provider.
 *
 * The provider is deliberately stateless with respect to document pixels. Every request uploads
 * the exact authority-owned base tile (or starts from transparent), replays one complete canonical
 * brush command, and reads a complete RGBA16F tile back. "append" and "rebuild" therefore share
 * the same pixel algorithm: the former describes normal document progression, while the latter
 * describes recovery/replay intent. Neither mode is allowed to depend on retained GPU state.
 *
 * Canvas2D, WebGL, RGBA8 and legacy-dab fallbacks are intentionally absent.
 */

import {
  lowerStudioCanonicalBrushPlanToWebGpuDabs,
} from "../studio-canonical-brush-webgpu-lowering";

import {
  STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
  STUDIO_ENGINE_TILE_ENCODING,
  studioEngineRgba16FloatTileDigest,
  studioEngineTileProviderBatchDigest,
} from "./studio-engine-tile-authority";
import {
  adaptLoweredStudioCanonicalBrushWebGpuDabs,
  packStudioEngineWebGpuBrushDabs,
  STUDIO_ENGINE_WEBGPU_BRUSH_INSTANCE_BYTES,
  STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT,
} from "./studio-engine-webgpu-brush-runtime";

import type {
  StudioEngineTileProviderBaseTile,
  StudioEngineTileProviderDelta,
  StudioEngineTileProviderDeltaBatch,
  StudioEngineTileProviderInput,
} from "./studio-engine-tile-authority";
import type {
  StudioEngineWebGpuBrushPlan,
} from "./studio-engine-webgpu-brush-runtime";

export const STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_VERSION = 1 as const;
export const STUDIO_ENGINE_WEBGPU_TILE_SIZE = 512 as const;
export const STUDIO_ENGINE_WEBGPU_TILE_BYTES_PER_PIXEL = 8 as const;
export const STUDIO_ENGINE_WEBGPU_TILE_ROW_BYTES =
  STUDIO_ENGINE_WEBGPU_TILE_SIZE * STUDIO_ENGINE_WEBGPU_TILE_BYTES_PER_PIXEL;
export const STUDIO_ENGINE_WEBGPU_TILE_BYTE_LENGTH =
  STUDIO_ENGINE_WEBGPU_TILE_ROW_BYTES * STUDIO_ENGINE_WEBGPU_TILE_SIZE;

const GPU_BUFFER_MAP_READ = 0x01;
const GPU_BUFFER_COPY_DST = 0x08;
const GPU_BUFFER_VERTEX = 0x20;
const GPU_TEXTURE_COPY_SRC = 0x01;
const GPU_TEXTURE_COPY_DST = 0x02;
const GPU_TEXTURE_RENDER_ATTACHMENT = 0x10;
const WEBGPU_BYTES_PER_ROW_ALIGNMENT = 256;
const DEFAULT_MAX_BUFFER_SIZE = 256 * 1024 * 1024;
const DEFAULT_MAX_TEXTURE_DIMENSION = 8_192;
const MAX_COMMAND_IDENTITY_CHARACTERS = 512;
const SAFE_COMMAND_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]*$/u;

const TILE_BRUSH_SHADER = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) color: vec4f,
  @location(2) @interpolate(flat) tip: vec4f,
  @location(3) @interpolate(flat) diagnostics: vec2f,
};

@vertex
fn vs_main(
  @builtin(vertex_index) vertex_index: u32,
  @location(0) center: vec2f,
  @location(1) basis_x: vec2f,
  @location(2) basis_y: vec2f,
  @location(3) color: vec4f,
  @location(4) tip: vec4f,
  @location(5) diagnostics: vec2f,
) -> VertexOutput {
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f( 1.0, -1.0),
    vec2f(-1.0,  1.0),
    vec2f(-1.0,  1.0),
    vec2f( 1.0, -1.0),
    vec2f( 1.0,  1.0),
  );
  let local = corners[vertex_index] * tip.w;
  var output: VertexOutput;
  output.position = vec4f(center + basis_x * local.x + basis_y * local.y, 0.0, 1.0);
  output.local = local;
  output.color = color;
  output.tip = tip;
  output.diagnostics = diagnostics;
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  let radial_metric = length(input.local);
  let square_metric = max(abs(input.local.x), abs(input.local.y));
  let metric = select(radial_metric, square_metric, input.tip.x > 1.5);
  let hardness = clamp(input.tip.y, 0.0, 1.0);
  let edge_softness = clamp(input.tip.z, 0.0, 1.0);
  let feather = clamp((1.0 - hardness) + edge_softness * hardness, 0.0, 1.0);
  let inner_edge = 1.0 - feather;
  let antialias = max(fwidth(metric) * 0.5, 0.00025);
  let coverage = 1.0 - smoothstep(
    inner_edge - antialias,
    1.0 + antialias,
    metric,
  );
  return input.color * coverage;
}
`;

export interface StudioEngineWebGpuTileProviderLimits {
  readonly maxTiles: number;
  readonly maxDabs: number;
  readonly maxInputBytes: number;
  readonly maxInstanceBytes: number;
  readonly maxStagingBytes: number;
  readonly maxDispatches: number;
  readonly maxInFlightRequests: number;
}

export const DEFAULT_STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_LIMITS:
Readonly<StudioEngineWebGpuTileProviderLimits> = Object.freeze({
  maxTiles: 32,
  maxDabs: 65_536,
  maxInputBytes: 64 * 1024 * 1024,
  maxInstanceBytes: 128 * 1024 * 1024,
  maxStagingBytes: 64 * 1024 * 1024,
  maxDispatches: 4_096,
  maxInFlightRequests: 1,
});

export interface StudioEngineWebGpuTileProviderBoundary {
  readonly device: GPUDevice;
  readonly ownsDevice?: boolean;
}

export interface StudioEngineWebGpuTileProviderOptions {
  readonly boundary: StudioEngineWebGpuTileProviderBoundary;
  readonly requestEpoch: number;
  readonly initialDeviceEpoch?: number;
  readonly limits?: Partial<StudioEngineWebGpuTileProviderLimits>;
  readonly onDeviceLost?: (info: GPUDeviceLostInfo) => void;
}

export interface StudioEngineWebGpuTileProviderRequest {
  readonly kind: "studio-engine-webgpu-tile-provider-request";
  readonly version: typeof STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_VERSION;
  readonly mode: "append" | "rebuild";
  readonly requestEpoch: number;
  readonly deviceEpoch: number;
  readonly requestSequence: number;
  readonly input: StudioEngineTileProviderInput;
}

export interface StudioEngineWebGpuTileProviderReceipt {
  readonly kind: "studio-engine-webgpu-tile-provider-receipt";
  readonly version: typeof STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_VERSION;
  readonly backend: "webgpu";
  readonly mode: "append" | "rebuild";
  readonly requestEpoch: number;
  readonly deviceEpoch: number;
  readonly requestSequence: number;
  readonly commandIdentity: string;
  readonly textureFormat: typeof STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT;
  readonly encoding: typeof STUDIO_ENGINE_TILE_ENCODING;
  readonly tileSize: typeof STUDIO_ENGINE_WEBGPU_TILE_SIZE;
  readonly tileCount: number;
  readonly dabCount: number;
  readonly dispatchCount: number;
  readonly uploadedBaseBytes: number;
  readonly stagingBytes: number;
  readonly complete: true;
}

export type StudioEngineWebGpuTileProviderRejectionReason =
  | "aborted"
  | "device-lost"
  | "disposed"
  | "gpu-backpressure"
  | "input-byte-budget"
  | "instance-byte-budget"
  | "invalid-base-tile"
  | "invalid-request"
  | "request-sequence-conflict"
  | "runtime-failed"
  | "staging-byte-budget"
  | "stale-device-epoch"
  | "stale-request-epoch"
  | "stale-request-sequence"
  | "submission-failed"
  | "tile-budget"
  | "unsupported-brush-plan"
  | "work-dispatch-budget";

export type StudioEngineWebGpuTileProviderResult =
  | Readonly<{
      status: "completed";
      receipt: StudioEngineWebGpuTileProviderReceipt;
      batch: StudioEngineTileProviderDeltaBatch;
    }>
  | Readonly<{
      status: "rejected";
      reason: StudioEngineWebGpuTileProviderRejectionReason;
    }>;

export type StudioEngineWebGpuTileProviderCreationResult =
  | Readonly<{
      status: "ready";
      provider: StudioEngineWebGpuTileProviderV1;
    }>
  | Readonly<{
      status: "failed";
      reason: "initialization-failed" | "invalid-configuration" | "invalid-device";
    }>;

export interface StudioEngineWebGpuTileProviderStats {
  readonly status: "ready" | "device-lost" | "failed" | "disposed";
  readonly requestEpoch: number;
  readonly deviceEpoch: number;
  readonly lastCompletedRequestSequence: number;
  readonly activeRequests: number;
  readonly completedRequests: number;
  readonly submittedTiles: number;
  readonly stagedBytes: number;
  readonly maxInFlightRequests: number;
}

export interface StudioEngineWebGpuTileReadbackLayout {
  readonly width: number;
  readonly height: number;
  readonly bytesPerPixel: number;
  readonly bytesPerRow: number;
  readonly byteOffset: number;
}

interface TileSnapshot {
  readonly index: number;
  readonly tileId: string;
  readonly column: number;
  readonly row: number;
  readonly baseTileRevision: number;
  readonly encoded: Uint8Array | null;
}

interface RequestSnapshot {
  readonly request: StudioEngineWebGpuTileProviderRequest;
  readonly commandIdentity: string;
  readonly baseDocumentRevision: number;
  readonly baseLayerRevision: number;
  readonly plan: StudioEngineWebGpuBrushPlan;
  readonly targets: readonly TileSnapshot[];
  readonly uploadedBaseBytes: number;
  readonly instanceBytes: number;
  readonly stagingBytes: number;
  readonly dispatchCount: number;
  readonly bytesPerRow: number;
  readonly tileStride: number;
}

interface PipelineResources {
  readonly normal: GPURenderPipeline;
  readonly erase: GPURenderPipeline;
}

class ProviderFailure extends Error {
  public constructor(public readonly reason: StudioEngineWebGpuTileProviderRejectionReason) {
    super(reason);
    this.name = "StudioEngineWebGpuTileProviderFailure";
  }
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function align(value: number, alignment: number): number | null {
  if (
    !nonNegativeSafeInteger(value)
    || !positiveSafeInteger(alignment)
  ) return null;
  const aligned = Math.ceil(value / alignment) * alignment;
  return Number.isSafeInteger(aligned) ? aligned : null;
}

function checkedProduct(...values: readonly number[]): number | null {
  let product = 1;
  for (const value of values) {
    if (!nonNegativeSafeInteger(value)) return null;
    product *= value;
    if (!Number.isSafeInteger(product)) return null;
  }
  return product;
}

function normalizeLimits(
  input: Partial<StudioEngineWebGpuTileProviderLimits> | undefined,
): StudioEngineWebGpuTileProviderLimits | null {
  const limits = {
    ...DEFAULT_STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_LIMITS,
    ...input,
  };
  return Object.values(limits).every(positiveSafeInteger)
    ? Object.freeze(limits)
    : null;
}

function safeDestroyBuffer(buffer: GPUBuffer | null): void {
  try {
    buffer?.destroy();
  } catch {
    // A lost device has already retired the buffer.
  }
}

function safeDestroyTexture(texture: GPUTexture | null): void {
  try {
    texture?.destroy();
  } catch {
    // A lost device has already retired the texture.
  }
}

function safeDestroyDevice(device: GPUDevice, ownsDevice: boolean): void {
  if (!ownsDevice) return;
  try {
    device.destroy();
  } catch {
    // An already-lost device has no remaining ownership.
  }
}

function compareTargets(left: TileSnapshot, right: TileSnapshot): number {
  return left.row - right.row || left.column - right.column;
}

function copyArrayBuffer(value: ArrayBuffer): Uint8Array {
  const copy = new Uint8Array(value.byteLength);
  copy.set(new Uint8Array(value));
  return copy;
}

function validCommandIdentity(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_COMMAND_IDENTITY_CHARACTERS
    && SAFE_COMMAND_IDENTITY.test(value);
}

function snapshotTarget(
  target: StudioEngineTileProviderBaseTile,
  index: number,
  expectedLayerId: string,
): TileSnapshot | null {
  try {
    const address = target.address;
    if (
      !address
      || address.layerId !== expectedLayerId
      || address.tileId !== `${address.column}:${address.row}`
      || !nonNegativeSafeInteger(address.column)
      || !nonNegativeSafeInteger(address.row)
      || !nonNegativeSafeInteger(address.layerIndex)
      || typeof address.logicalTileIndex !== "bigint"
      || typeof address.logicalByteOffset !== "bigint"
      || typeof address.shardIndex !== "bigint"
      || typeof address.shardByteOffset !== "bigint"
      || address.logicalTileIndex < BigInt(0)
      || address.logicalByteOffset < BigInt(0)
      || address.shardIndex < BigInt(0)
      || address.shardByteOffset < BigInt(0)
      || !nonNegativeSafeInteger(target.tileRevision)
    ) return null;

    if (target.encoded === null) {
      if (target.tileRevision !== 0 || target.contentDigest !== null) return null;
      return Object.freeze({
        index,
        tileId: address.tileId,
        column: address.column,
        row: address.row,
        baseTileRevision: 0,
        encoded: null,
      });
    }
    if (
      !(target.encoded instanceof ArrayBuffer)
      || target.encoded.byteLength !== STUDIO_ENGINE_WEBGPU_TILE_BYTE_LENGTH
      || target.tileRevision <= 0
      || typeof target.contentDigest !== "string"
    ) return null;
    const encoded = copyArrayBuffer(target.encoded);
    const digest = studioEngineRgba16FloatTileDigest(
      encoded.buffer as ArrayBuffer,
    );
    if (digest !== target.contentDigest) return null;
    return Object.freeze({
      index,
      tileId: address.tileId,
      column: address.column,
      row: address.row,
      baseTileRevision: target.tileRevision,
      encoded,
    });
  } catch {
    return null;
  }
}

function validInputHeader(input: StudioEngineTileProviderInput): boolean {
  try {
    return input.kind === "studio-engine-tile-provider-input"
      && input.version === STUDIO_ENGINE_TILE_AUTHORITY_VERSION
      && input.encoding === STUDIO_ENGINE_TILE_ENCODING
      && validCommandIdentity(input.commandIdentity)
      && nonNegativeSafeInteger(input.baseDocumentRevision)
      && nonNegativeSafeInteger(input.baseLayerRevision)
      && typeof input.layerId === "string"
      && input.layerId.length > 0
      && input.tileSize === STUDIO_ENGINE_WEBGPU_TILE_SIZE
      && Array.isArray(input.targets)
      && input.targets.length > 0;
  } catch {
    return false;
  }
}

function createPipelineResources(device: GPUDevice): PipelineResources {
  const module = device.createShaderModule({
    label: "Studio Engine vNext RGBA16F tile brush shader",
    code: TILE_BRUSH_SHADER,
  });
  const vertex: GPUVertexState = {
    module,
    entryPoint: "vs_main",
    buffers: [{
      arrayStride: STUDIO_ENGINE_WEBGPU_BRUSH_INSTANCE_BYTES,
      stepMode: "instance",
      attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x2" },
        { shaderLocation: 1, offset: 8, format: "float32x2" },
        { shaderLocation: 2, offset: 16, format: "float32x2" },
        { shaderLocation: 3, offset: 24, format: "float32x4" },
        { shaderLocation: 4, offset: 40, format: "float32x4" },
        { shaderLocation: 5, offset: 56, format: "float32x2" },
      ],
    }],
  };
  const target = (porterDuff: "source-over" | "destination-out"): GPUColorTargetState => ({
    format: STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT,
    blend: porterDuff === "source-over"
      ? {
          color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
          alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
        }
      : {
          color: { srcFactor: "zero", dstFactor: "one-minus-src-alpha", operation: "add" },
          alpha: { srcFactor: "zero", dstFactor: "one-minus-src-alpha", operation: "add" },
        },
  });
  const pipeline = (
    porterDuff: "source-over" | "destination-out",
  ): GPURenderPipeline => device.createRenderPipeline({
    label: `Studio Engine vNext tile ${porterDuff} pipeline`,
    layout: "auto",
    vertex,
    fragment: {
      module,
      entryPoint: "fs_main",
      targets: [target(porterDuff)],
    },
    primitive: { topology: "triangle-list" },
  });
  return Object.freeze({
    normal: pipeline("source-over"),
    erase: pipeline("destination-out"),
  });
}

/**
 * Removes WebGPU row padding and returns detached little-endian RGBA16F words.
 * This helper is intentionally format-agnostic enough for focused layout tests, while the provider
 * itself only calls it with eight-byte RGBA16F pixels.
 */
export function copyStudioEngineWebGpuTileReadbackRows(
  source: ArrayBuffer,
  layout: StudioEngineWebGpuTileReadbackLayout,
): Uint16Array | null {
  try {
    if (
      !(source instanceof ArrayBuffer)
      || !positiveSafeInteger(layout.width)
      || !positiveSafeInteger(layout.height)
      || !positiveSafeInteger(layout.bytesPerPixel)
      || layout.bytesPerPixel % Uint16Array.BYTES_PER_ELEMENT !== 0
      || !positiveSafeInteger(layout.bytesPerRow)
      || layout.bytesPerRow % WEBGPU_BYTES_PER_ROW_ALIGNMENT !== 0
      || !nonNegativeSafeInteger(layout.byteOffset)
    ) return null;
    const packedRowBytes = checkedProduct(layout.width, layout.bytesPerPixel);
    const packedByteLength = packedRowBytes === null
      ? null
      : checkedProduct(packedRowBytes, layout.height);
    const requiredEnd = checkedProduct(layout.bytesPerRow, layout.height);
    if (
      packedRowBytes === null
      || packedByteLength === null
      || requiredEnd === null
      || layout.bytesPerRow < packedRowBytes
      || layout.byteOffset > source.byteLength - requiredEnd
    ) return null;

    const output = new Uint8Array(packedByteLength);
    const input = new Uint8Array(source);
    for (let row = 0; row < layout.height; row += 1) {
      const sourceStart = layout.byteOffset + row * layout.bytesPerRow;
      output.set(
        input.subarray(sourceStart, sourceStart + packedRowBytes),
        row * packedRowBytes,
      );
    }
    return new Uint16Array(output.buffer);
  } catch {
    return null;
  }
}

export function createStudioEngineWebGpuTileProviderV1(
  options: StudioEngineWebGpuTileProviderOptions,
): StudioEngineWebGpuTileProviderCreationResult {
  const limits = normalizeLimits(options.limits);
  const device = options.boundary?.device;
  const requestEpoch = options.requestEpoch;
  const deviceEpoch = options.initialDeviceEpoch ?? 1;
  if (
    !limits
    || !positiveSafeInteger(requestEpoch)
    || !positiveSafeInteger(deviceEpoch)
  ) return Object.freeze({ status: "failed", reason: "invalid-configuration" });
  if (
    !device
    || Number(device.limits.maxTextureDimension2D ?? DEFAULT_MAX_TEXTURE_DIMENSION)
      < STUDIO_ENGINE_WEBGPU_TILE_SIZE
  ) return Object.freeze({ status: "failed", reason: "invalid-device" });

  try {
    const resources = createPipelineResources(device);
    return Object.freeze({
      status: "ready",
      provider: new StudioEngineWebGpuTileProviderV1({
        device,
        ownsDevice: options.boundary.ownsDevice === true,
        requestEpoch,
        deviceEpoch,
        limits,
        resources,
        onDeviceLost: options.onDeviceLost,
      }),
    });
  } catch {
    safeDestroyDevice(device, options.boundary.ownsDevice === true);
    return Object.freeze({ status: "failed", reason: "initialization-failed" });
  }
}

interface RuntimeOptions {
  readonly device: GPUDevice;
  readonly ownsDevice: boolean;
  readonly requestEpoch: number;
  readonly deviceEpoch: number;
  readonly limits: StudioEngineWebGpuTileProviderLimits;
  readonly resources: PipelineResources;
  readonly onDeviceLost?: (info: GPUDeviceLostInfo) => void;
}

export class StudioEngineWebGpuTileProviderV1 {
  private readonly device: GPUDevice;
  private readonly ownsDevice: boolean;
  private readonly requestEpoch: number;
  private readonly limits: StudioEngineWebGpuTileProviderLimits;
  private readonly resources: PipelineResources;
  private readonly onDeviceLost: ((info: GPUDeviceLostInfo) => void) | undefined;
  private readonly activeSequences = new Set<number>();
  private readonly deviceLostGate: Promise<void>;
  private resolveDeviceLostGate: (() => void) | null = null;

  private status: StudioEngineWebGpuTileProviderStats["status"] = "ready";
  private deviceEpoch: number;
  private lastCompletedRequestSequence = 0;
  private highestStartedRequestSequence = 0;
  private completedRequests = 0;
  private submittedTiles = 0;
  private stagedBytes = 0;

  public constructor(options: RuntimeOptions) {
    this.device = options.device;
    this.ownsDevice = options.ownsDevice;
    this.requestEpoch = options.requestEpoch;
    this.deviceEpoch = options.deviceEpoch;
    this.limits = options.limits;
    this.resources = options.resources;
    this.onDeviceLost = options.onDeviceLost;
    this.deviceLostGate = new Promise((resolve) => {
      this.resolveDeviceLostGate = resolve;
    });
    void this.device.lost.then((info) => this.handleDeviceLost(info));
  }

  public stats(): StudioEngineWebGpuTileProviderStats {
    return Object.freeze({
      status: this.status,
      requestEpoch: this.requestEpoch,
      deviceEpoch: this.deviceEpoch,
      lastCompletedRequestSequence: this.lastCompletedRequestSequence,
      activeRequests: this.activeSequences.size,
      completedRequests: this.completedRequests,
      submittedTiles: this.submittedTiles,
      stagedBytes: this.stagedBytes,
      maxInFlightRequests: this.limits.maxInFlightRequests,
    });
  }

  /**
   * Adapter consumed directly by `StudioEngineTileAuthority`.
   *
   * Authority commits always use the stateless rebuild intent. The exact base tile carried by the
   * input still preserves normal append semantics across document commands.
   */
  public async render(input: StudioEngineTileProviderInput): Promise<unknown> {
    const plan = input?.brushPlan;
    const result = await this.execute({
      kind: "studio-engine-webgpu-tile-provider-request",
      version: STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_VERSION,
      mode: "rebuild",
      requestEpoch: this.requestEpoch,
      deviceEpoch: this.deviceEpoch,
      requestSequence: plan?.commandSequence,
      input,
    });
    if (result.status === "rejected") throw new ProviderFailure(result.reason);
    return result.batch;
  }

  public execute(
    input: StudioEngineWebGpuTileProviderRequest,
    signal?: AbortSignal,
  ): Promise<StudioEngineWebGpuTileProviderResult> {
    if (signal?.aborted) {
      return Promise.resolve(Object.freeze({ status: "rejected", reason: "aborted" }));
    }
    if (this.status === "disposed") {
      return Promise.resolve(Object.freeze({ status: "rejected", reason: "disposed" }));
    }
    if (this.status === "device-lost") {
      return Promise.resolve(Object.freeze({ status: "rejected", reason: "device-lost" }));
    }
    if (this.status !== "ready") {
      return Promise.resolve(Object.freeze({ status: "rejected", reason: "runtime-failed" }));
    }
    if (this.activeSequences.size >= this.limits.maxInFlightRequests) {
      return Promise.resolve(Object.freeze({
        status: "rejected",
        reason: "gpu-backpressure",
      }));
    }

    const snapshot = this.snapshotRequest(input);
    if ("reason" in snapshot) {
      return Promise.resolve(Object.freeze({ status: "rejected", reason: snapshot.reason }));
    }
    const requestSequence = snapshot.request.requestSequence;
    if (this.activeSequences.has(requestSequence)) {
      return Promise.resolve(Object.freeze({
        status: "rejected",
        reason: "request-sequence-conflict",
      }));
    }
    if (requestSequence <= this.lastCompletedRequestSequence) {
      return Promise.resolve(Object.freeze({
        status: "rejected",
        reason: "stale-request-sequence",
      }));
    }
    if (
      this.activeSequences.size > 0
      && requestSequence <= this.highestStartedRequestSequence
    ) {
      return Promise.resolve(Object.freeze({
        status: "rejected",
        reason: "stale-request-sequence",
      }));
    }

    this.activeSequences.add(requestSequence);
    this.highestStartedRequestSequence = Math.max(
      this.highestStartedRequestSequence,
      requestSequence,
    );
    return this.executeSnapshot(snapshot, signal).finally(() => {
      this.activeSequences.delete(requestSequence);
      if (this.activeSequences.size === 0) {
        this.highestStartedRequestSequence = this.lastCompletedRequestSequence;
      }
    });
  }

  public dispose(): void {
    if (this.status === "disposed") return;
    this.status = "disposed";
    this.resolveDeviceLostGate?.();
    this.resolveDeviceLostGate = null;
    safeDestroyDevice(this.device, this.ownsDevice);
  }

  private snapshotRequest(
    input: StudioEngineWebGpuTileProviderRequest,
  ): RequestSnapshot | Readonly<{ reason: StudioEngineWebGpuTileProviderRejectionReason }> {
    try {
      if (
        !input
        || input.kind !== "studio-engine-webgpu-tile-provider-request"
        || input.version !== STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_VERSION
        || (input.mode !== "append" && input.mode !== "rebuild")
        || !positiveSafeInteger(input.requestEpoch)
        || !positiveSafeInteger(input.deviceEpoch)
        || !positiveSafeInteger(input.requestSequence)
        || !validInputHeader(input.input)
        || input.requestSequence !== input.input.brushPlan.commandSequence
      ) return Object.freeze({ reason: "invalid-request" });
      if (input.requestEpoch !== this.requestEpoch) {
        return Object.freeze({ reason: "stale-request-epoch" });
      }
      if (input.deviceEpoch !== this.deviceEpoch) {
        return Object.freeze({ reason: "stale-device-epoch" });
      }
      if (input.input.brushPlan.sessionEpoch !== input.requestEpoch) {
        return Object.freeze({ reason: "stale-request-epoch" });
      }
      if (input.input.targets.length > this.limits.maxTiles) {
        return Object.freeze({ reason: "tile-budget" });
      }

      const targets: TileSnapshot[] = [];
      let uploadedBaseBytes = 0;
      for (let index = 0; index < input.input.targets.length; index += 1) {
        const target = snapshotTarget(input.input.targets[index]!, index, input.input.layerId);
        if (!target) return Object.freeze({ reason: "invalid-base-tile" });
        if (index > 0 && compareTargets(targets[index - 1]!, target) >= 0) {
          return Object.freeze({ reason: "invalid-base-tile" });
        }
        uploadedBaseBytes += target.encoded?.byteLength ?? 0;
        if (!Number.isSafeInteger(uploadedBaseBytes)) {
          return Object.freeze({ reason: "input-byte-budget" });
        }
        targets.push(target);
      }
      if (uploadedBaseBytes > this.limits.maxInputBytes) {
        return Object.freeze({ reason: "input-byte-budget" });
      }

      const lowering = lowerStudioCanonicalBrushPlanToWebGpuDabs(
        input.input.brushPlan,
        { maximumDabs: this.limits.maxDabs },
      );
      const adapted = adaptLoweredStudioCanonicalBrushWebGpuDabs(
        "rebuild",
        lowering,
        this.limits.maxDabs,
      );
      if (adapted.status !== "ready") {
        return Object.freeze({ reason: "unsupported-brush-plan" });
      }

      const instanceBytes = checkedProduct(
        targets.length,
        adapted.plan.dabs.length,
        STUDIO_ENGINE_WEBGPU_BRUSH_INSTANCE_BYTES,
      );
      if (instanceBytes === null || instanceBytes > this.limits.maxInstanceBytes) {
        return Object.freeze({ reason: "instance-byte-budget" });
      }
      const dispatchCount = checkedProduct(targets.length, adapted.plan.batches.length);
      if (dispatchCount === null || dispatchCount > this.limits.maxDispatches) {
        return Object.freeze({ reason: "work-dispatch-budget" });
      }
      const bytesPerRow = align(
        STUDIO_ENGINE_WEBGPU_TILE_ROW_BYTES,
        WEBGPU_BYTES_PER_ROW_ALIGNMENT,
      );
      const tileStride = bytesPerRow === null
        ? null
        : checkedProduct(bytesPerRow, STUDIO_ENGINE_WEBGPU_TILE_SIZE);
      const stagingBytes = tileStride === null
        ? null
        : checkedProduct(tileStride, targets.length);
      if (
        bytesPerRow === null
        || tileStride === null
        || stagingBytes === null
        || stagingBytes > this.limits.maxStagingBytes
      ) return Object.freeze({ reason: "staging-byte-budget" });

      const maximumBufferSize = Number(
        this.device.limits.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE,
      );
      if (
        !Number.isSafeInteger(maximumBufferSize)
        || maximumBufferSize <= 0
        || instanceBytes > maximumBufferSize
      ) return Object.freeze({ reason: "instance-byte-budget" });
      if (stagingBytes > maximumBufferSize) {
        return Object.freeze({ reason: "staging-byte-budget" });
      }

      return Object.freeze({
        request: Object.freeze({
          kind: input.kind,
          version: input.version,
          mode: input.mode,
          requestEpoch: input.requestEpoch,
          deviceEpoch: input.deviceEpoch,
          requestSequence: input.requestSequence,
          input: input.input,
        }),
        commandIdentity: input.input.commandIdentity,
        baseDocumentRevision: input.input.baseDocumentRevision,
        baseLayerRevision: input.input.baseLayerRevision,
        plan: adapted.plan,
        targets: Object.freeze(targets),
        uploadedBaseBytes,
        instanceBytes,
        stagingBytes,
        dispatchCount,
        bytesPerRow,
        tileStride,
      });
    } catch {
      return Object.freeze({ reason: "invalid-request" });
    }
  }

  private async executeSnapshot(
    snapshot: RequestSnapshot,
    signal: AbortSignal | undefined,
  ): Promise<StudioEngineWebGpuTileProviderResult> {
    let instanceBuffer: GPUBuffer | null = null;
    let stagingBuffer: GPUBuffer | null = null;
    let mapped = false;
    const textures: GPUTexture[] = [];
    try {
      this.assertCurrent(snapshot, signal);
      const instanceData = this.packInstances(snapshot);
      if (snapshot.instanceBytes > 0) {
        instanceBuffer = this.device.createBuffer({
          label: `Studio Engine vNext tile instances request ${snapshot.request.requestSequence}`,
          size: snapshot.instanceBytes,
          usage: GPU_BUFFER_VERTEX | GPU_BUFFER_COPY_DST,
        });
        this.device.queue.writeBuffer(
          instanceBuffer,
          0,
          instanceData.buffer,
          instanceData.byteOffset,
          instanceData.byteLength,
        );
      }
      stagingBuffer = this.device.createBuffer({
        label: `Studio Engine vNext RGBA16F tile readback request ${
          snapshot.request.requestSequence
        }`,
        size: snapshot.stagingBytes,
        usage: GPU_BUFFER_MAP_READ | GPU_BUFFER_COPY_DST,
      });
      const encoder = this.device.createCommandEncoder({
        label: `Studio Engine vNext tile request ${snapshot.request.requestSequence}`,
      });

      for (const target of snapshot.targets) {
        const texture = this.device.createTexture({
          label: `Studio Engine vNext RGBA16F tile ${target.tileId}`,
          size: {
            width: STUDIO_ENGINE_WEBGPU_TILE_SIZE,
            height: STUDIO_ENGINE_WEBGPU_TILE_SIZE,
            depthOrArrayLayers: 1,
          },
          format: STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT,
          usage:
            GPU_TEXTURE_RENDER_ATTACHMENT
            | GPU_TEXTURE_COPY_DST
            | GPU_TEXTURE_COPY_SRC,
        });
        textures.push(texture);
        if (target.encoded) {
          this.device.queue.writeTexture(
            { texture },
            target.encoded,
            {
              offset: 0,
              bytesPerRow: STUDIO_ENGINE_WEBGPU_TILE_ROW_BYTES,
              rowsPerImage: STUDIO_ENGINE_WEBGPU_TILE_SIZE,
            },
            {
              width: STUDIO_ENGINE_WEBGPU_TILE_SIZE,
              height: STUDIO_ENGINE_WEBGPU_TILE_SIZE,
              depthOrArrayLayers: 1,
            },
          );
        }

        const pass = encoder.beginRenderPass({
          label: `Studio Engine vNext tile replay ${target.tileId}`,
          colorAttachments: [{
            view: texture.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: target.encoded ? "load" : "clear",
            storeOp: "store",
          }],
        });
        if (instanceBuffer) {
          const perTileInstanceBytes =
            snapshot.plan.dabs.length * STUDIO_ENGINE_WEBGPU_BRUSH_INSTANCE_BYTES;
          pass.setVertexBuffer(
            0,
            instanceBuffer,
            target.index * perTileInstanceBytes,
            perTileInstanceBytes,
          );
          for (const batch of snapshot.plan.batches) {
            pass.setPipeline(
              batch.composite.porterDuff === "destination-out"
                ? this.resources.erase
                : this.resources.normal,
            );
            pass.draw(6, batch.instanceCount, 0, batch.firstInstance);
          }
        }
        pass.end();
        encoder.copyTextureToBuffer(
          { texture, origin: { x: 0, y: 0, z: 0 } },
          {
            buffer: stagingBuffer,
            offset: target.index * snapshot.tileStride,
            bytesPerRow: snapshot.bytesPerRow,
            rowsPerImage: STUDIO_ENGINE_WEBGPU_TILE_SIZE,
          },
          {
            width: STUDIO_ENGINE_WEBGPU_TILE_SIZE,
            height: STUDIO_ENGINE_WEBGPU_TILE_SIZE,
            depthOrArrayLayers: 1,
          },
        );
      }

      this.device.queue.submit([encoder.finish()]);
      await Promise.race([
        this.device.queue.onSubmittedWorkDone(),
        this.deviceLostGate,
      ]);
      this.assertCurrent(snapshot, signal);
      await stagingBuffer.mapAsync(GPU_BUFFER_MAP_READ, 0, snapshot.stagingBytes);
      mapped = true;
      this.assertCurrent(snapshot, signal);
      const mappedRange = stagingBuffer.getMappedRange(0, snapshot.stagingBytes);
      const deltas = this.readDeltas(snapshot, mappedRange);
      const batch = this.createBatch(snapshot, deltas);
      const receipt = this.createReceipt(snapshot);

      this.lastCompletedRequestSequence = Math.max(
        this.lastCompletedRequestSequence,
        snapshot.request.requestSequence,
      );
      this.completedRequests += 1;
      this.submittedTiles += snapshot.targets.length;
      this.stagedBytes += snapshot.stagingBytes;
      return Object.freeze({ status: "completed", receipt, batch });
    } catch (error) {
      const reason = error instanceof ProviderFailure ? error.reason : "submission-failed";
      if (
        reason === "submission-failed"
        && this.status === "ready"
      ) this.status = "failed";
      return Object.freeze({ status: "rejected", reason });
    } finally {
      if (mapped && stagingBuffer) {
        try {
          stagingBuffer.unmap();
        } catch {
          // Device loss may invalidate the mapped range before cleanup.
        }
      }
      safeDestroyBuffer(stagingBuffer);
      safeDestroyBuffer(instanceBuffer);
      for (const texture of textures) safeDestroyTexture(texture);
    }
  }

  private packInstances(snapshot: RequestSnapshot): Float32Array {
    if (snapshot.instanceBytes === 0) return new Float32Array();
    const output = new Float32Array(
      snapshot.instanceBytes / Float32Array.BYTES_PER_ELEMENT,
    );
    const floatsPerTile =
      snapshot.plan.dabs.length * STUDIO_ENGINE_WEBGPU_BRUSH_INSTANCE_BYTES
      / Float32Array.BYTES_PER_ELEMENT;
    for (const target of snapshot.targets) {
      const packed = packStudioEngineWebGpuBrushDabs(
        snapshot.plan.dabs,
        {
          x: target.column * STUDIO_ENGINE_WEBGPU_TILE_SIZE,
          y: target.row * STUDIO_ENGINE_WEBGPU_TILE_SIZE,
          width: STUDIO_ENGINE_WEBGPU_TILE_SIZE,
          height: STUDIO_ENGINE_WEBGPU_TILE_SIZE,
        },
        STUDIO_ENGINE_WEBGPU_TILE_SIZE,
        STUDIO_ENGINE_WEBGPU_TILE_SIZE,
      );
      output.set(packed, target.index * floatsPerTile);
    }
    return output;
  }

  private readDeltas(
    snapshot: RequestSnapshot,
    mappedRange: ArrayBuffer,
  ): readonly StudioEngineTileProviderDelta[] {
    const deltas: StudioEngineTileProviderDelta[] = [];
    for (const target of snapshot.targets) {
      const encoded = copyStudioEngineWebGpuTileReadbackRows(mappedRange, {
        width: STUDIO_ENGINE_WEBGPU_TILE_SIZE,
        height: STUDIO_ENGINE_WEBGPU_TILE_SIZE,
        bytesPerPixel: STUDIO_ENGINE_WEBGPU_TILE_BYTES_PER_PIXEL,
        bytesPerRow: snapshot.bytesPerRow,
        byteOffset: target.index * snapshot.tileStride,
      });
      if (!encoded || encoded.byteLength !== STUDIO_ENGINE_WEBGPU_TILE_BYTE_LENGTH) {
        throw new ProviderFailure("submission-failed");
      }
      const contentDigest = studioEngineRgba16FloatTileDigest(encoded);
      deltas.push(Object.freeze({
        index: target.index,
        tileId: target.tileId,
        column: target.column,
        row: target.row,
        baseTileRevision: target.baseTileRevision,
        encoded,
        contentDigest,
      }));
    }
    return Object.freeze(deltas);
  }

  private createBatch(
    snapshot: RequestSnapshot,
    deltas: readonly StudioEngineTileProviderDelta[],
  ): StudioEngineTileProviderDeltaBatch {
    const frame = {
      commandIdentity: snapshot.commandIdentity,
      baseDocumentRevision: snapshot.baseDocumentRevision,
      baseLayerRevision: snapshot.baseLayerRevision,
      complete: true as const,
      deltaCount: deltas.length,
      deltas,
    };
    return Object.freeze({
      kind: "studio-engine-tile-provider-delta",
      version: STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
      ...frame,
      batchDigest: studioEngineTileProviderBatchDigest(frame),
    });
  }

  private createReceipt(
    snapshot: RequestSnapshot,
  ): StudioEngineWebGpuTileProviderReceipt {
    return Object.freeze({
      kind: "studio-engine-webgpu-tile-provider-receipt",
      version: STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_VERSION,
      backend: "webgpu",
      mode: snapshot.request.mode,
      requestEpoch: snapshot.request.requestEpoch,
      deviceEpoch: snapshot.request.deviceEpoch,
      requestSequence: snapshot.request.requestSequence,
      commandIdentity: snapshot.commandIdentity,
      textureFormat: STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT,
      encoding: STUDIO_ENGINE_TILE_ENCODING,
      tileSize: STUDIO_ENGINE_WEBGPU_TILE_SIZE,
      tileCount: snapshot.targets.length,
      dabCount: snapshot.plan.dabs.length,
      dispatchCount: snapshot.dispatchCount,
      uploadedBaseBytes: snapshot.uploadedBaseBytes,
      stagingBytes: snapshot.stagingBytes,
      complete: true,
    });
  }

  private assertCurrent(
    snapshot: RequestSnapshot,
    signal: AbortSignal | undefined,
  ): void {
    if (signal?.aborted) throw new ProviderFailure("aborted");
    if (this.status === "disposed") throw new ProviderFailure("disposed");
    if (this.status === "device-lost") throw new ProviderFailure("device-lost");
    if (this.status !== "ready") throw new ProviderFailure("runtime-failed");
    if (snapshot.request.requestEpoch !== this.requestEpoch) {
      throw new ProviderFailure("stale-request-epoch");
    }
    if (snapshot.request.deviceEpoch !== this.deviceEpoch) {
      throw new ProviderFailure("stale-device-epoch");
    }
  }

  private handleDeviceLost(info: GPUDeviceLostInfo): void {
    if (this.status === "disposed" || this.status === "device-lost") return;
    this.status = "device-lost";
    if (this.deviceEpoch < Number.MAX_SAFE_INTEGER) this.deviceEpoch += 1;
    this.resolveDeviceLostGate?.();
    this.resolveDeviceLostGate = null;
    this.onDeviceLost?.(info);
  }
}
