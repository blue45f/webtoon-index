/**
 * Single-physical-texture WebGPU tile provider candidate.
 *
 * V2 deliberately reuses the complete V1 request validation, canonical lowering, brush pipelines,
 * readback layout and authority batch construction. A strict virtual GPU boundary maps V1's
 * disposable logical 512×512 textures onto disjoint slots of one retained RGBA16F atlas:
 *
 * - writeTexture and copyTextureToBuffer origins are translated to the owning slot;
 * - render passes target one shared atlas view with slot-scoped viewport/scissor state;
 * - attachment-wide clear is replaced by a transparent draw constrained to that slot;
 * - logical texture destruction releases only the slot; the atlas survives across requests.
 *
 * This makes V1 and V2 pixel algorithms identical by construction while removing O(tileCount)
 * physical texture creation/destruction. V2 remains stateless with respect to document authority:
 * every reused slot is loaded from the supplied base tile or cleared before replay.
 */

import {
  STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT,
} from "./studio-engine-webgpu-brush-runtime";
import {
  createStudioEngineWebGpuTileProviderV1,
  DEFAULT_STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_LIMITS,
  STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_VERSION,
  STUDIO_ENGINE_WEBGPU_TILE_SIZE,
  type StudioEngineWebGpuTileProviderLimits,
  type StudioEngineWebGpuTileProviderOptions,
  type StudioEngineWebGpuTileProviderReceipt,
  type StudioEngineWebGpuTileProviderRejectionReason,
  type StudioEngineWebGpuTileProviderRequest,
  type StudioEngineWebGpuTileProviderStats,
  type StudioEngineWebGpuTileProviderV1,
} from "./studio-engine-webgpu-tile-provider-v1";

import type {
  StudioEngineTileProviderDeltaBatch,
  StudioEngineTileProviderInput,
} from "./studio-engine-tile-authority";

export const STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_V2_VERSION = 2 as const;
export const STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_V2_STORAGE =
  "single-rgba16float-2d-atlas" as const;
export const STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_V2_DEFAULT_MAX_ATLAS_BYTES =
  128 * 1024 * 1024;

const GPU_TEXTURE_COPY_SRC = 0x01;
const GPU_TEXTURE_COPY_DST = 0x02;
const GPU_TEXTURE_RENDER_ATTACHMENT = 0x10;
const RGBA16FLOAT_BYTES_PER_PIXEL = 8;
const DEFAULT_MAX_TEXTURE_DIMENSION = 8_192;

const CLEAR_SHADER = /* wgsl */ `
@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> @builtin(position) vec4f {
  let positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f( 3.0, -1.0),
    vec2f(-1.0,  3.0),
  );
  return vec4f(positions[vertex_index], 0.0, 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4f {
  return vec4f(0.0);
}
`;

export interface StudioEngineWebGpuTileProviderV2Options
  extends StudioEngineWebGpuTileProviderOptions {
  readonly maximumAtlasBytes?: number;
}

export interface StudioEngineWebGpuTileProviderV2Request {
  readonly kind: "studio-engine-webgpu-tile-provider-v2-request";
  readonly version: typeof STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_V2_VERSION;
  readonly mode: "append" | "rebuild";
  readonly requestEpoch: number;
  readonly deviceEpoch: number;
  readonly requestSequence: number;
  readonly input: StudioEngineTileProviderInput;
}

export interface StudioEngineWebGpuTileProviderV2Receipt
  extends Omit<
    StudioEngineWebGpuTileProviderReceipt,
    "kind" | "version" | "backend"
  > {
  readonly kind: "studio-engine-webgpu-tile-provider-v2-receipt";
  readonly version: typeof STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_V2_VERSION;
  readonly backend: "webgpu-atlas";
  readonly storage:
    typeof STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_V2_STORAGE;
  readonly physicalTextureCount: 1;
  readonly atlasWidth: number;
  readonly atlasHeight: number;
  readonly atlasCapacity: number;
  readonly atlasBytes: number;
  readonly peakActiveSlots: number;
}

export type StudioEngineWebGpuTileProviderV2Result =
  | Readonly<{
      status: "completed";
      receipt: StudioEngineWebGpuTileProviderV2Receipt;
      batch: StudioEngineTileProviderDeltaBatch;
    }>
  | Readonly<{
      status: "rejected";
      reason: StudioEngineWebGpuTileProviderRejectionReason;
    }>;

export interface StudioEngineWebGpuTileProviderV2Stats
  extends StudioEngineWebGpuTileProviderStats {
  readonly storage:
    typeof STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_V2_STORAGE;
  readonly physicalTextureCount: 1;
  readonly atlasWidth: number;
  readonly atlasHeight: number;
  readonly atlasCapacity: number;
  readonly atlasBytes: number;
  readonly logicalTextureAllocations: number;
  readonly logicalTextureReleases: number;
  readonly activeSlots: number;
  readonly peakActiveSlots: number;
}

export type StudioEngineWebGpuTileProviderV2CreationResult =
  | Readonly<{
      status: "ready";
      provider: StudioEngineWebGpuTileProviderV2;
    }>
  | Readonly<{
      status: "failed";
      reason:
        | "initialization-failed"
        | "invalid-configuration"
        | "invalid-device"
        | "atlas-budget";
    }>;

interface AtlasLayout {
  readonly columns: number;
  readonly rows: number;
  readonly capacity: number;
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
}

interface AtlasSlot {
  readonly index: number;
  readonly column: number;
  readonly row: number;
  readonly x: number;
  readonly y: number;
}

interface AtlasTextureRecord {
  readonly slot: AtlasSlot;
  readonly texture: GPUTexture;
  released: boolean;
}

interface AtlasViewRecord {
  readonly texture: AtlasTextureRecord;
}

interface AtlasBoundaryStats {
  readonly atlasWidth: number;
  readonly atlasHeight: number;
  readonly atlasCapacity: number;
  readonly atlasBytes: number;
  readonly logicalTextureAllocations: number;
  readonly logicalTextureReleases: number;
  readonly activeSlots: number;
  readonly peakActiveSlots: number;
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function normalizedLimits(
  input: Partial<StudioEngineWebGpuTileProviderLimits> | undefined,
): Readonly<StudioEngineWebGpuTileProviderLimits> | null {
  const limits = {
    ...DEFAULT_STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_LIMITS,
    ...input,
  };
  return Object.values(limits).every(positiveSafeInteger)
    ? Object.freeze(limits)
    : null;
}

function checkedProduct(...values: readonly number[]): number | null {
  let product = 1;
  for (const value of values) {
    if (!positiveSafeInteger(value)) return null;
    product *= value;
    if (!Number.isSafeInteger(product)) return null;
  }
  return product;
}

function chooseAtlasLayout(
  capacity: number,
  maximumDimension: number,
  maximumBytes: number,
): AtlasLayout | null {
  if (
    !positiveSafeInteger(capacity)
    || !positiveSafeInteger(maximumDimension)
    || !positiveSafeInteger(maximumBytes)
  ) return null;
  const maximumAxisSlots = Math.floor(
    maximumDimension / STUDIO_ENGINE_WEBGPU_TILE_SIZE,
  );
  if (maximumAxisSlots <= 0) return null;
  let winner: AtlasLayout | null = null;
  for (
    let columns = 1;
    columns <= Math.min(capacity, maximumAxisSlots);
    columns += 1
  ) {
    const rows = Math.ceil(capacity / columns);
    if (rows > maximumAxisSlots) continue;
    const width = columns * STUDIO_ENGINE_WEBGPU_TILE_SIZE;
    const height = rows * STUDIO_ENGINE_WEBGPU_TILE_SIZE;
    const byteLength = checkedProduct(
      width,
      height,
      RGBA16FLOAT_BYTES_PER_PIXEL,
    );
    if (byteLength === null || byteLength > maximumBytes) continue;
    const candidate: AtlasLayout = {
      columns,
      rows,
      capacity,
      width,
      height,
      byteLength,
    };
    if (
      !winner
      || columns * rows < winner.columns * winner.rows
      || (
        columns * rows === winner.columns * winner.rows
        && Math.abs(columns - rows) < Math.abs(winner.columns - winner.rows)
      )
      || (
        columns * rows === winner.columns * winner.rows
        && Math.abs(columns - rows) === Math.abs(winner.columns - winner.rows)
        && columns > winner.columns
      )
    ) winner = candidate;
  }
  return winner ? Object.freeze(winner) : null;
}

function extent3d(value: unknown): Readonly<{
  width: number;
  height: number;
  depthOrArrayLayers: number;
}> | null {
  if (Array.isArray(value)) {
    const width = Number(value[0]);
    const height = Number(value[1] ?? 1);
    const depthOrArrayLayers = Number(value[2] ?? 1);
    return [width, height, depthOrArrayLayers].every(positiveSafeInteger)
      ? { width, height, depthOrArrayLayers }
      : null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const width = Number(record.width);
  const height = Number(record.height ?? 1);
  const depthOrArrayLayers = Number(record.depthOrArrayLayers ?? 1);
  return [width, height, depthOrArrayLayers].every(positiveSafeInteger)
    ? { width, height, depthOrArrayLayers }
    : null;
}

function origin3d(value: unknown): Readonly<{ x: number; y: number; z: number }> | null {
  if (value === undefined) return { x: 0, y: 0, z: 0 };
  if (Array.isArray(value)) {
    const x = Number(value[0] ?? 0);
    const y = Number(value[1] ?? 0);
    const z = Number(value[2] ?? 0);
    return [x, y, z].every((part) => Number.isSafeInteger(part) && part >= 0)
      ? { x, y, z }
      : null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const x = Number(record.x ?? 0);
  const y = Number(record.y ?? 0);
  const z = Number(record.z ?? 0);
  return [x, y, z].every((part) => Number.isSafeInteger(part) && part >= 0)
    ? { x, y, z }
    : null;
}

function safeDestroyTexture(texture: GPUTexture | null): void {
  try {
    texture?.destroy();
  } catch {
    // A lost device may already have retired the atlas.
  }
}

function safeDestroyDevice(device: GPUDevice, owned: boolean): void {
  if (!owned) return;
  try {
    device.destroy();
  } catch {
    // Best-effort release for an owned boundary.
  }
}

class StudioEngineWebGpuAtlasVirtualBoundary {
  readonly #device: GPUDevice;
  readonly #atlas: GPUTexture;
  readonly #atlasView: GPUTextureView;
  readonly #clearPipeline: GPURenderPipeline;
  readonly #layout: AtlasLayout;
  readonly #textureRecords = new WeakMap<object, AtlasTextureRecord>();
  readonly #viewRecords = new WeakMap<object, AtlasViewRecord>();
  readonly #freeSlots: number[];
  readonly #virtualDevice: GPUDevice;
  #logicalTextureAllocations = 0;
  #logicalTextureReleases = 0;
  #activeSlots = 0;
  #peakActiveSlots = 0;
  #disposed = false;

  public constructor(device: GPUDevice, layout: AtlasLayout) {
    this.#device = device;
    this.#layout = layout;
    let atlas: GPUTexture | null = null;
    try {
      atlas = device.createTexture({
        label: "Studio Engine vNext single RGBA16F tile atlas",
        size: {
          width: layout.width,
          height: layout.height,
          depthOrArrayLayers: 1,
        },
        format: STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT,
        usage:
          GPU_TEXTURE_RENDER_ATTACHMENT
          | GPU_TEXTURE_COPY_DST
          | GPU_TEXTURE_COPY_SRC,
      });
      this.#atlas = atlas;
      this.#atlasView = atlas.createView();
      const module = device.createShaderModule({
        label: "Studio Engine vNext atlas slot clear shader",
        code: CLEAR_SHADER,
      });
      this.#clearPipeline = device.createRenderPipeline({
        label: "Studio Engine vNext atlas slot clear pipeline",
        layout: "auto",
        vertex: { module, entryPoint: "vs_main" },
        fragment: {
          module,
          entryPoint: "fs_main",
          targets: [{
            format: STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT,
            writeMask: 0xf,
          }],
        },
        primitive: { topology: "triangle-list" },
      });
    } catch (error) {
      safeDestroyTexture(atlas);
      throw error;
    }
    this.#freeSlots = Array.from({ length: layout.capacity }, (_, index) => index);
    this.#virtualDevice = this.#createVirtualDevice();
  }

  public get device(): GPUDevice {
    return this.#virtualDevice;
  }

  public stats(): Readonly<AtlasBoundaryStats> {
    return Object.freeze({
      atlasWidth: this.#layout.width,
      atlasHeight: this.#layout.height,
      atlasCapacity: this.#layout.capacity,
      atlasBytes: this.#layout.byteLength,
      logicalTextureAllocations: this.#logicalTextureAllocations,
      logicalTextureReleases: this.#logicalTextureReleases,
      activeSlots: this.#activeSlots,
      peakActiveSlots: this.#peakActiveSlots,
    });
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#freeSlots.length = 0;
    safeDestroyTexture(this.#atlas);
  }

  #slot(index: number): AtlasSlot {
    const column = index % this.#layout.columns;
    const row = Math.floor(index / this.#layout.columns);
    return Object.freeze({
      index,
      column,
      row,
      x: column * STUDIO_ENGINE_WEBGPU_TILE_SIZE,
      y: row * STUDIO_ENGINE_WEBGPU_TILE_SIZE,
    });
  }

  #allocateLogicalTexture(): GPUTexture {
    if (this.#disposed) throw new Error("atlas-disposed");
    const index = this.#freeSlots.shift();
    if (index === undefined) throw new RangeError("atlas-capacity");
    const record: AtlasTextureRecord = {
      slot: this.#slot(index),
      texture: null as unknown as GPUTexture,
      released: false,
    };
    const texture = {
      createView: () => {
        if (record.released) throw new Error("logical-texture-released");
        const view = Object.freeze({
          label: `Studio virtual atlas tile view ${record.slot.index}`,
        }) as unknown as GPUTextureView;
        this.#viewRecords.set(view as object, { texture: record });
        return view;
      },
      destroy: () => this.#releaseLogicalTexture(record),
    } as unknown as GPUTexture;
    (record as { texture: GPUTexture }).texture = texture;
    this.#textureRecords.set(texture as object, record);
    this.#logicalTextureAllocations += 1;
    this.#activeSlots += 1;
    this.#peakActiveSlots = Math.max(this.#peakActiveSlots, this.#activeSlots);
    return texture;
  }

  #releaseLogicalTexture(record: AtlasTextureRecord): void {
    if (record.released) return;
    record.released = true;
    this.#freeSlots.push(record.slot.index);
    this.#freeSlots.sort((left, right) => left - right);
    this.#logicalTextureReleases += 1;
    this.#activeSlots = Math.max(0, this.#activeSlots - 1);
  }

  #atlasTextureRecord(value: unknown): AtlasTextureRecord | null {
    return value && typeof value === "object"
      ? this.#textureRecords.get(value) ?? null
      : null;
  }

  #atlasViewRecord(value: unknown): AtlasViewRecord | null {
    return value && typeof value === "object"
      ? this.#viewRecords.get(value) ?? null
      : null;
  }

  #matchesLogicalTileTexture(descriptor: GPUTextureDescriptor): boolean {
    const size = extent3d(descriptor.size);
    return Boolean(
      size
      && size.width === STUDIO_ENGINE_WEBGPU_TILE_SIZE
      && size.height === STUDIO_ENGINE_WEBGPU_TILE_SIZE
      && size.depthOrArrayLayers === 1
      && descriptor.format === STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT
      && (descriptor.usage & GPU_TEXTURE_RENDER_ATTACHMENT) !== 0
      && (descriptor.usage & GPU_TEXTURE_COPY_DST) !== 0
      && (descriptor.usage & GPU_TEXTURE_COPY_SRC) !== 0
    );
  }

  #translateTextureCopy(
    source: Record<string, unknown>,
    record: AtlasTextureRecord,
    copySize: unknown,
  ): Record<string, unknown> {
    if (record.released) throw new Error("logical-texture-released");
    const origin = origin3d(source.origin);
    const extent = extent3d(copySize);
    if (
      !origin
      || !extent
      || origin.z !== 0
      || extent.depthOrArrayLayers !== 1
      || origin.x + extent.width > STUDIO_ENGINE_WEBGPU_TILE_SIZE
      || origin.y + extent.height > STUDIO_ENGINE_WEBGPU_TILE_SIZE
    ) throw new RangeError("invalid-atlas-copy");
    return {
      ...source,
      texture: this.#atlas,
      origin: {
        x: record.slot.x + origin.x,
        y: record.slot.y + origin.y,
        z: 0,
      },
    };
  }

  #createVirtualQueue(): GPUQueue {
    const queue = this.#device.queue;
    return {
      get label() {
        return queue.label;
      },
      set label(value: string) {
        queue.label = value;
      },
      submit: (commandBuffers: Iterable<GPUCommandBuffer>) =>
        queue.submit(commandBuffers),
      onSubmittedWorkDone: () => queue.onSubmittedWorkDone(),
      writeBuffer: (...args: Parameters<GPUQueue["writeBuffer"]>) =>
        queue.writeBuffer(...args),
      writeTexture: (...args: Parameters<GPUQueue["writeTexture"]>) => {
        const [destination, data, dataLayout, size] = args;
        const record = this.#atlasTextureRecord(destination.texture);
        if (!record) {
          queue.writeTexture(destination, data, dataLayout, size);
          return;
        }
        queue.writeTexture(
          this.#translateTextureCopy(
            destination as unknown as Record<string, unknown>,
            record,
            size,
          ) as unknown as Parameters<GPUQueue["writeTexture"]>[0],
          data,
          dataLayout,
          size,
        );
      },
      copyExternalImageToTexture: (
        ...args: Parameters<GPUQueue["copyExternalImageToTexture"]>
      ) => queue.copyExternalImageToTexture(...args),
    } as unknown as GPUQueue;
  }

  #createVirtualEncoder(
    descriptor?: GPUCommandEncoderDescriptor,
  ): GPUCommandEncoder {
    const encoder = this.#device.createCommandEncoder(descriptor);
    return {
      beginRenderPass: (input: GPURenderPassDescriptor) => {
        const atlasAttachments = input.colorAttachments.flatMap((attachment) => {
          if (!attachment) return [];
          const record = this.#atlasViewRecord(attachment.view);
          return record ? [{ attachment, record }] : [];
        });
        if (atlasAttachments.length === 0) return encoder.beginRenderPass(input);
        if (
          atlasAttachments.length !== 1
          || input.colorAttachments.filter(Boolean).length !== 1
        ) throw new Error("invalid-atlas-render-pass");
        const [{ attachment, record }] = atlasAttachments;
        if (record.texture.released) throw new Error("logical-texture-released");
        const loadOp = attachment.loadOp;
        const pass = encoder.beginRenderPass({
          ...input,
          colorAttachments: [{
            ...attachment,
            view: this.#atlasView,
            loadOp: "load",
          }],
        });
        pass.setViewport(
          record.texture.slot.x,
          record.texture.slot.y,
          STUDIO_ENGINE_WEBGPU_TILE_SIZE,
          STUDIO_ENGINE_WEBGPU_TILE_SIZE,
          0,
          1,
        );
        pass.setScissorRect(
          record.texture.slot.x,
          record.texture.slot.y,
          STUDIO_ENGINE_WEBGPU_TILE_SIZE,
          STUDIO_ENGINE_WEBGPU_TILE_SIZE,
        );
        if (loadOp === "clear") {
          pass.setPipeline(this.#clearPipeline);
          pass.draw(3, 1, 0, 0);
        }
        return pass;
      },
      copyTextureToBuffer: (
        ...args: Parameters<GPUCommandEncoder["copyTextureToBuffer"]>
      ) => {
        const [source, destination, copySize] = args;
        const record = this.#atlasTextureRecord(source.texture);
        if (!record) {
          encoder.copyTextureToBuffer(source, destination, copySize);
          return;
        }
        encoder.copyTextureToBuffer(
          this.#translateTextureCopy(
            source as unknown as Record<string, unknown>,
            record,
            copySize,
          ) as unknown as Parameters<GPUCommandEncoder["copyTextureToBuffer"]>[0],
          destination,
          copySize,
        );
      },
      finish: (finishDescriptor?: GPUCommandBufferDescriptor) =>
        encoder.finish(finishDescriptor),
    } as unknown as GPUCommandEncoder;
  }

  #createVirtualDevice(): GPUDevice {
    const queue = this.#createVirtualQueue();
    const deviceLabel = this.#device.label;
    return {
      get label() {
        return deviceLabel || "Studio virtual atlas device";
      },
      limits: this.#device.limits,
      features: this.#device.features,
      adapterInfo: this.#device.adapterInfo,
      lost: this.#device.lost,
      queue,
      createBuffer: (...args: Parameters<GPUDevice["createBuffer"]>) =>
        this.#device.createBuffer(...args),
      createTexture: (descriptor: GPUTextureDescriptor) =>
        this.#matchesLogicalTileTexture(descriptor)
          ? this.#allocateLogicalTexture()
          : this.#device.createTexture(descriptor),
      createSampler: (...args: Parameters<GPUDevice["createSampler"]>) =>
        this.#device.createSampler(...args),
      createBindGroupLayout: (
        ...args: Parameters<GPUDevice["createBindGroupLayout"]>
      ) => this.#device.createBindGroupLayout(...args),
      createPipelineLayout: (
        ...args: Parameters<GPUDevice["createPipelineLayout"]>
      ) => this.#device.createPipelineLayout(...args),
      createBindGroup: (...args: Parameters<GPUDevice["createBindGroup"]>) =>
        this.#device.createBindGroup(...args),
      createShaderModule: (
        ...args: Parameters<GPUDevice["createShaderModule"]>
      ) => this.#device.createShaderModule(...args),
      createComputePipeline: (
        ...args: Parameters<GPUDevice["createComputePipeline"]>
      ) => this.#device.createComputePipeline(...args),
      createRenderPipeline: (
        ...args: Parameters<GPUDevice["createRenderPipeline"]>
      ) => this.#device.createRenderPipeline(...args),
      createComputePipelineAsync: (
        ...args: Parameters<GPUDevice["createComputePipelineAsync"]>
      ) => this.#device.createComputePipelineAsync(...args),
      createRenderPipelineAsync: (
        ...args: Parameters<GPUDevice["createRenderPipelineAsync"]>
      ) => this.#device.createRenderPipelineAsync(...args),
      createCommandEncoder: (descriptor?: GPUCommandEncoderDescriptor) =>
        this.#createVirtualEncoder(descriptor),
      pushErrorScope: (...args: Parameters<GPUDevice["pushErrorScope"]>) =>
        this.#device.pushErrorScope(...args),
      popErrorScope: () => this.#device.popErrorScope(),
      importExternalTexture: (
        ...args: Parameters<GPUDevice["importExternalTexture"]>
      ) => this.#device.importExternalTexture(...args),
      destroy: () => undefined,
    } as unknown as GPUDevice;
  }
}

export function createStudioEngineWebGpuTileProviderV2(
  options: StudioEngineWebGpuTileProviderV2Options,
): StudioEngineWebGpuTileProviderV2CreationResult {
  const limits = normalizedLimits(options?.limits);
  const device = options?.boundary?.device;
  const maximumAtlasBytes = options?.maximumAtlasBytes
    ?? STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_V2_DEFAULT_MAX_ATLAS_BYTES;
  if (
    !limits
    || !positiveSafeInteger(options?.requestEpoch)
    || !positiveSafeInteger(options?.initialDeviceEpoch ?? 1)
    || !positiveSafeInteger(maximumAtlasBytes)
  ) return Object.freeze({ status: "failed", reason: "invalid-configuration" });
  if (!device) return Object.freeze({ status: "failed", reason: "invalid-device" });
  const dimension = Number(
    device.limits?.maxTextureDimension2D ?? DEFAULT_MAX_TEXTURE_DIMENSION,
  );
  const capacity = checkedProduct(limits.maxTiles, limits.maxInFlightRequests);
  if (!positiveSafeInteger(dimension) || capacity === null) {
    return Object.freeze({ status: "failed", reason: "invalid-device" });
  }
  const layout = chooseAtlasLayout(capacity, dimension, maximumAtlasBytes);
  if (!layout) return Object.freeze({ status: "failed", reason: "atlas-budget" });

  let boundary: StudioEngineWebGpuAtlasVirtualBoundary | null = null;
  try {
    boundary = new StudioEngineWebGpuAtlasVirtualBoundary(device, layout);
    const created = createStudioEngineWebGpuTileProviderV1({
      boundary: { device: boundary.device, ownsDevice: false },
      requestEpoch: options.requestEpoch,
      initialDeviceEpoch: options.initialDeviceEpoch,
      limits,
      onDeviceLost: options.onDeviceLost,
    });
    if (created.status !== "ready") {
      boundary.dispose();
      safeDestroyDevice(device, options.boundary.ownsDevice === true);
      return created.reason === "invalid-device"
        ? Object.freeze({ status: "failed", reason: "invalid-device" })
        : Object.freeze({ status: "failed", reason: "initialization-failed" });
    }
    return Object.freeze({
      status: "ready",
      provider: new StudioEngineWebGpuTileProviderV2(
        created.provider,
        boundary,
        device,
        options.boundary.ownsDevice === true,
      ),
    });
  } catch {
    boundary?.dispose();
    safeDestroyDevice(device, options.boundary.ownsDevice === true);
    return Object.freeze({ status: "failed", reason: "initialization-failed" });
  }
}

export class StudioEngineWebGpuTileProviderV2 {
  readonly #provider: StudioEngineWebGpuTileProviderV1;
  readonly #boundary: StudioEngineWebGpuAtlasVirtualBoundary;
  readonly #device: GPUDevice;
  readonly #ownsDevice: boolean;
  #disposed = false;

  public constructor(
    provider: StudioEngineWebGpuTileProviderV1,
    boundary: StudioEngineWebGpuAtlasVirtualBoundary,
    device: GPUDevice,
    ownsDevice: boolean,
  ) {
    this.#provider = provider;
    this.#boundary = boundary;
    this.#device = device;
    this.#ownsDevice = ownsDevice;
  }

  public stats(): Readonly<StudioEngineWebGpuTileProviderV2Stats> {
    return Object.freeze({
      ...this.#provider.stats(),
      storage: STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_V2_STORAGE,
      physicalTextureCount: 1,
      ...this.#boundary.stats(),
    });
  }

  public async render(input: StudioEngineTileProviderInput): Promise<unknown> {
    return this.#provider.render(input);
  }

  public async execute(
    request: StudioEngineWebGpuTileProviderV2Request,
    signal?: AbortSignal,
  ): Promise<StudioEngineWebGpuTileProviderV2Result> {
    if (
      !request
      || request.kind !== "studio-engine-webgpu-tile-provider-v2-request"
      || request.version !== STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_V2_VERSION
    ) return Object.freeze({ status: "rejected", reason: "invalid-request" });
    const v1Request: StudioEngineWebGpuTileProviderRequest = {
      kind: "studio-engine-webgpu-tile-provider-request",
      version: STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_VERSION,
      mode: request.mode,
      requestEpoch: request.requestEpoch,
      deviceEpoch: request.deviceEpoch,
      requestSequence: request.requestSequence,
      input: request.input,
    };
    const result = await this.#provider.execute(v1Request, signal);
    if (result.status === "rejected") return result;
    const atlas = this.#boundary.stats();
    const receipt: StudioEngineWebGpuTileProviderV2Receipt = Object.freeze({
      ...result.receipt,
      kind: "studio-engine-webgpu-tile-provider-v2-receipt",
      version: STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_V2_VERSION,
      backend: "webgpu-atlas",
      storage: STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_V2_STORAGE,
      physicalTextureCount: 1,
      atlasWidth: atlas.atlasWidth,
      atlasHeight: atlas.atlasHeight,
      atlasCapacity: atlas.atlasCapacity,
      atlasBytes: atlas.atlasBytes,
      peakActiveSlots: atlas.peakActiveSlots,
    });
    return Object.freeze({
      status: "completed",
      receipt,
      batch: result.batch,
    });
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#provider.dispose();
    this.#boundary.dispose();
    safeDestroyDevice(this.#device, this.#ownsDevice);
  }
}
