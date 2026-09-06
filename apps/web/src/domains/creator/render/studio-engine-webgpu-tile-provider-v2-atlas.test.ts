import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
  STUDIO_ENGINE_TILE_ENCODING,
  studioEngineRgba16FloatTileDigest,
  type StudioEngineTileProviderBaseTile,
  type StudioEngineTileProviderInput,
} from "./studio-engine-tile-authority";
import {
  STUDIO_ENGINE_WEBGPU_TILE_BYTE_LENGTH,
  STUDIO_ENGINE_WEBGPU_TILE_SIZE,
} from "./studio-engine-webgpu-tile-provider-v1";
import {
  createStudioEngineWebGpuTileProviderV2,
  STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_V2_STORAGE,
  STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_V2_VERSION,
  type StudioEngineWebGpuTileProviderV2Request,
} from "./studio-engine-webgpu-tile-provider-v2-atlas";

import type { StudioCanonicalBrushPlan } from "../studio-canonical-brush-plan";

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
}

interface FakeBuffer {
  readonly buffer: GPUBuffer;
  readonly storage: ArrayBuffer | null;
  readonly destroy: ReturnType<typeof vi.fn>;
}

interface CopyRecord {
  readonly source: GPUTexelCopyTextureInfo;
  readonly destination: GPUTexelCopyBufferInfo;
  readonly size: GPUExtent3D;
}

interface FakePass {
  readonly descriptor: GPURenderPassDescriptor;
  readonly setViewport: ReturnType<typeof vi.fn>;
  readonly setScissorRect: ReturnType<typeof vi.fn>;
  readonly setVertexBuffer: ReturnType<typeof vi.fn>;
  readonly setPipeline: ReturnType<typeof vi.fn>;
  readonly draw: ReturnType<typeof vi.fn>;
  readonly end: ReturnType<typeof vi.fn>;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function fakeGpu() {
  const lost = deferred<GPUDeviceLostInfo>();
  const buffers: FakeBuffer[] = [];
  const textures: Array<Readonly<{
    texture: GPUTexture;
    descriptor: GPUTextureDescriptor;
    view: GPUTextureView;
    destroy: ReturnType<typeof vi.fn>;
  }>> = [];
  const copies: CopyRecord[] = [];
  const passes: FakePass[] = [];
  const writeTexture = vi.fn();
  const destroyDevice = vi.fn();
  let submittedCopyCount = 0;
  const submit = vi.fn(() => {
    for (let index = submittedCopyCount; index < copies.length; index += 1) {
      const copy = copies[index]!;
      const fakeBuffer = buffers.find((candidate) => (
        candidate.buffer === copy.destination.buffer
      ));
      if (!fakeBuffer?.storage) throw new Error("readback storage missing");
      const offset = Number(copy.destination.offset ?? 0);
      const bytesPerRow = Number(copy.destination.bytesPerRow);
      const extent = copy.size as GPUExtent3DDict;
      const width = Number(extent.width);
      const height = Number(extent.height);
      const sourceOrigin = copy.source.origin as GPUOrigin3DDict;
      const marker = 1 + Math.floor(Number(sourceOrigin?.x ?? 0) / STUDIO_ENGINE_WEBGPU_TILE_SIZE);
      const storage = new Uint8Array(fakeBuffer.storage);
      for (let row = 0; row < height; row += 1) {
        storage.fill(
          marker,
          offset + row * bytesPerRow,
          offset + row * bytesPerRow + width * 8,
        );
      }
    }
    submittedCopyCount = copies.length;
  });
  const queue = {
    label: "fake-queue",
    writeBuffer: vi.fn(),
    writeTexture,
    submit,
    onSubmittedWorkDone: vi.fn(async () => undefined),
  } as unknown as GPUQueue;
  const device = {
    label: "fake-device",
    lost: lost.promise,
    limits: {
      maxTextureDimension2D: 8_192,
      maxBufferSize: 256 * 1024 * 1024,
    },
    features: new Set(),
    queue,
    createShaderModule: vi.fn((descriptor: GPUShaderModuleDescriptor) => ({ descriptor })),
    createRenderPipeline: vi.fn((descriptor: GPURenderPipelineDescriptor) => ({ descriptor })),
    createBuffer: vi.fn((descriptor: GPUBufferDescriptor) => {
      const mappable = (Number(descriptor.usage) & 0x01) !== 0;
      const storage = mappable ? new ArrayBuffer(Number(descriptor.size)) : null;
      const destroy = vi.fn();
      const buffer = {
        mapAsync: vi.fn(async () => undefined),
        getMappedRange: vi.fn(() => {
          if (!storage) throw new Error("buffer is not mappable");
          return storage;
        }),
        unmap: vi.fn(),
        destroy,
      } as unknown as GPUBuffer;
      buffers.push({ buffer, storage, destroy });
      return buffer;
    }),
    createTexture: vi.fn((descriptor: GPUTextureDescriptor) => {
      const destroy = vi.fn();
      const view = { atlas: textures.length } as unknown as GPUTextureView;
      const texture = {
        createView: vi.fn(() => view),
        destroy,
      } as unknown as GPUTexture;
      textures.push({ texture, descriptor, view, destroy });
      return texture;
    }),
    createCommandEncoder: vi.fn(() => ({
      beginRenderPass: vi.fn((descriptor: GPURenderPassDescriptor) => {
        const pass: FakePass = {
          descriptor,
          setViewport: vi.fn(),
          setScissorRect: vi.fn(),
          setVertexBuffer: vi.fn(),
          setPipeline: vi.fn(),
          draw: vi.fn(),
          end: vi.fn(),
        };
        passes.push(pass);
        return pass;
      }),
      copyTextureToBuffer: vi.fn((
        source: GPUTexelCopyTextureInfo,
        destination: GPUTexelCopyBufferInfo,
        size: GPUExtent3D,
      ) => copies.push({ source, destination, size })),
      finish: vi.fn(() => ({ encoded: true })),
    })),
    destroy: destroyDevice,
  } as unknown as GPUDevice;
  return {
    device,
    lost,
    buffers,
    textures,
    copies,
    passes,
    writeTexture,
    submit,
    destroyDevice,
  };
}

function brushPlan(commandSequence = 1): StudioCanonicalBrushPlan {
  return {
    kind: "studio-canonical-brush-plan",
    version: 1,
    sessionEpoch: 7,
    strokeEpoch: 1,
    commandSequence,
    strokeId: `atlas-stroke-${commandSequence}`,
    seed: 42,
    coordinateSpace: "document-css-px",
    transform: {
      encoding: "affine-f64-v1",
      m11: 1,
      m12: 0,
      m21: 0,
      m22: 1,
      translateX: 0,
      translateY: 0,
    },
    color: {
      space: "linear-srgb",
      alphaMode: "straight",
      components: [0.8, 0.2, 0.1, 0.75],
    },
    composite: {
      porterDuff: "source-over",
      blendMode: "normal",
      opacity: 1,
    },
    recipe: {
      version: 1,
      brushId: "atlas-gpen",
      engine: "dab-v1",
      material: "ink",
      tip: { kind: "analytic", shape: "round", edgeSoftness: 0.1 },
      size: 12,
      flow: 1,
      hardness: 0.9,
      spacingRatio: 0.2,
      scatter: { radiusRatio: 0, distribution: "uniform-disk" },
      angleRadians: 0,
      roundness: 1,
      pressure: {
        size: { minimum: 1, maximum: 1, exponent: 1 },
        opacity: { minimum: 1, maximum: 1, exponent: 1 },
        flow: { minimum: 1, maximum: 1, exponent: 1 },
      },
      grain: null,
      wetMedia: null,
    },
    source: {
      encoding: "accepted-authoritative-samples-v1",
      firstSequence: 1,
      lastSequence: 2,
      samples: [
        {
          sequence: 1,
          x: 8,
          y: 8,
          pressure: 1,
          tangentialPressure: 0,
          tiltX: 0,
          tiltY: 0,
          twist: 0,
          timeMilliseconds: 1,
          pointerId: 1,
          flags: 0,
        },
        {
          sequence: 2,
          x: 530,
          y: 18,
          pressure: 0.8,
          tangentialPressure: 0,
          tiltX: 0,
          tiltY: 0,
          twist: 0,
          timeMilliseconds: 2,
          pointerId: 1,
          flags: 0,
        },
      ],
    },
  };
}

function tile(
  column: number,
  encoded: ArrayBuffer | null = null,
): StudioEngineTileProviderBaseTile {
  const logicalTileIndex = BigInt(column);
  const logicalByteOffset = logicalTileIndex * BigInt(STUDIO_ENGINE_WEBGPU_TILE_BYTE_LENGTH);
  return {
    address: {
      tileId: `${column}:0`,
      column,
      row: 0,
      layerId: "line",
      layerIndex: 0,
      logicalTileIndex,
      logicalByteOffset,
      shardIndex: BigInt(0),
      shardByteOffset: logicalByteOffset,
    },
    tileRevision: encoded ? 1 : 0,
    contentDigest: encoded ? studioEngineRgba16FloatTileDigest(encoded) : null,
    encoded,
  };
}

function input(
  commandSequence = 1,
  targets: readonly StudioEngineTileProviderBaseTile[] = [tile(0), tile(1)],
): StudioEngineTileProviderInput {
  return {
    kind: "studio-engine-tile-provider-input",
    version: STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
    encoding: STUDIO_ENGINE_TILE_ENCODING,
    commandIdentity: `atlas-command:${commandSequence}`,
    baseDocumentRevision: commandSequence - 1,
    baseLayerRevision: commandSequence - 1,
    layerId: "line",
    tileSize: STUDIO_ENGINE_WEBGPU_TILE_SIZE,
    brushPlan: brushPlan(commandSequence),
    targets,
  };
}

function request(value: StudioEngineTileProviderInput): StudioEngineWebGpuTileProviderV2Request {
  return {
    kind: "studio-engine-webgpu-tile-provider-v2-request",
    version: STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_V2_VERSION,
    mode: "rebuild",
    requestEpoch: 7,
    deviceEpoch: 1,
    requestSequence: value.brushPlan.commandSequence,
    input: value,
  };
}

describe("StudioEngineWebGpuTileProviderV2 atlas boundary", () => {
  it("renders several logical tiles through one physical RGBA16F texture", async () => {
    const gpu = fakeGpu();
    const created = createStudioEngineWebGpuTileProviderV2({
      boundary: { device: gpu.device },
      requestEpoch: 7,
    });
    expect(created.status).toBe("ready");
    if (created.status !== "ready") return;

    expect(gpu.textures).toHaveLength(1);
    expect(gpu.textures[0]!.descriptor).toMatchObject({
      label: "Studio Engine vNext single RGBA16F tile atlas",
      size: { width: 4_096, height: 2_048, depthOrArrayLayers: 1 },
      format: "rgba16float",
    });
    const result = await created.provider.execute(request(input()));
    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;

    expect(gpu.textures).toHaveLength(1);
    expect(result.receipt).toMatchObject({
      kind: "studio-engine-webgpu-tile-provider-v2-receipt",
      version: 2,
      backend: "webgpu-atlas",
      storage: STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_V2_STORAGE,
      physicalTextureCount: 1,
      tileCount: 2,
      atlasWidth: 4_096,
      atlasHeight: 2_048,
      atlasCapacity: 32,
      atlasBytes: 4_096 * 2_048 * 8,
      peakActiveSlots: 2,
      complete: true,
    });
    expect(result.batch.deltas).toHaveLength(2);
    const firstEncoded = result.batch.deltas[0]!.encoded;
    const secondEncoded = result.batch.deltas[1]!.encoded;
    const firstBytes = firstEncoded instanceof Uint16Array
      ? new Uint8Array(firstEncoded.buffer, firstEncoded.byteOffset, firstEncoded.byteLength)
      : new Uint8Array(firstEncoded);
    const secondBytes = secondEncoded instanceof Uint16Array
      ? new Uint8Array(secondEncoded.buffer, secondEncoded.byteOffset, secondEncoded.byteLength)
      : new Uint8Array(secondEncoded);
    expect(firstBytes[0]).toBe(1);
    expect(secondBytes[0]).toBe(2);

    expect(gpu.passes).toHaveLength(2);
    expect(gpu.passes.every((pass) => (
      pass.descriptor.colorAttachments[0]?.view === gpu.textures[0]!.view
      && pass.descriptor.colorAttachments[0]?.loadOp === "load"
    ))).toBe(true);
    expect(gpu.passes[0]!.setViewport).toHaveBeenCalledWith(0, 0, 512, 512, 0, 1);
    expect(gpu.passes[1]!.setViewport).toHaveBeenCalledWith(512, 0, 512, 512, 0, 1);
    expect(gpu.passes[0]!.setScissorRect).toHaveBeenCalledWith(0, 0, 512, 512);
    expect(gpu.passes[1]!.setScissorRect).toHaveBeenCalledWith(512, 0, 512, 512);
    expect(gpu.passes[0]!.draw).toHaveBeenNthCalledWith(1, 3, 1, 0, 0);
    expect(gpu.passes[1]!.draw).toHaveBeenNthCalledWith(1, 3, 1, 0, 0);
    expect((gpu.copies[0]!.source.origin as GPUOrigin3DDict).x).toBe(0);
    expect((gpu.copies[1]!.source.origin as GPUOrigin3DDict).x).toBe(512);
    expect(gpu.copies[0]!.source.texture).toBe(gpu.textures[0]!.texture);
    expect(gpu.copies[1]!.source.texture).toBe(gpu.textures[0]!.texture);
    expect(created.provider.stats()).toMatchObject({
      physicalTextureCount: 1,
      logicalTextureAllocations: 2,
      logicalTextureReleases: 2,
      activeSlots: 0,
      peakActiveSlots: 2,
      completedRequests: 1,
    });
  });

  it("translates uploaded base tiles to the exact atlas slot", async () => {
    const gpu = fakeGpu();
    const created = createStudioEngineWebGpuTileProviderV2({
      boundary: { device: gpu.device },
      requestEpoch: 7,
    });
    expect(created.status).toBe("ready");
    if (created.status !== "ready") return;
    const base = new ArrayBuffer(STUDIO_ENGINE_WEBGPU_TILE_BYTE_LENGTH);
    new Uint8Array(base).fill(0x5a);

    const result = await created.provider.execute(request(input(1, [
      tile(0, base),
      tile(1, base),
    ])));
    expect(result.status).toBe("completed");
    expect(gpu.writeTexture).toHaveBeenCalledTimes(2);
    const firstDestination = gpu.writeTexture.mock.calls[0]![0] as GPUTexelCopyTextureInfo;
    const secondDestination = gpu.writeTexture.mock.calls[1]![0] as GPUTexelCopyTextureInfo;
    expect(firstDestination.texture).toBe(gpu.textures[0]!.texture);
    expect(secondDestination.texture).toBe(gpu.textures[0]!.texture);
    expect(firstDestination.origin).toEqual({ x: 0, y: 0, z: 0 });
    expect(secondDestination.origin).toEqual({ x: 512, y: 0, z: 0 });
    expect(gpu.passes[0]!.draw.mock.calls[0]?.[0]).not.toBe(3);
    expect(gpu.passes[1]!.draw.mock.calls[0]?.[0]).not.toBe(3);
  });

  it("reuses the physical atlas across sequential requests", async () => {
    const gpu = fakeGpu();
    const created = createStudioEngineWebGpuTileProviderV2({
      boundary: { device: gpu.device },
      requestEpoch: 7,
      limits: { maxTiles: 2 },
    });
    expect(created.status).toBe("ready");
    if (created.status !== "ready") return;

    expect((await created.provider.execute(request(input(1)))).status).toBe("completed");
    expect((await created.provider.execute(request(input(2)))).status).toBe("completed");
    expect(gpu.textures).toHaveLength(1);
    expect(created.provider.stats()).toMatchObject({
      atlasCapacity: 2,
      logicalTextureAllocations: 4,
      logicalTextureReleases: 4,
      activeSlots: 0,
      completedRequests: 2,
    });
  });

  it("fails configuration before allocating an atlas that exceeds the byte budget", () => {
    const gpu = fakeGpu();
    expect(createStudioEngineWebGpuTileProviderV2({
      boundary: { device: gpu.device },
      requestEpoch: 7,
      limits: { maxTiles: 2 },
      maximumAtlasBytes: STUDIO_ENGINE_WEBGPU_TILE_BYTE_LENGTH,
    })).toEqual({ status: "failed", reason: "atlas-budget" });
    expect(gpu.textures).toHaveLength(0);
  });

  it("propagates device loss and releases owned resources exactly once", async () => {
    const gpu = fakeGpu();
    const onDeviceLost = vi.fn();
    const created = createStudioEngineWebGpuTileProviderV2({
      boundary: { device: gpu.device, ownsDevice: true },
      requestEpoch: 7,
      onDeviceLost,
    });
    expect(created.status).toBe("ready");
    if (created.status !== "ready") return;

    const info = { reason: "unknown", message: "atlas loss" } as GPUDeviceLostInfo;
    gpu.lost.resolve(info);
    await Promise.resolve();
    expect(onDeviceLost).toHaveBeenCalledWith(info);
    expect(created.provider.stats()).toMatchObject({
      status: "device-lost",
      deviceEpoch: 2,
    });

    created.provider.dispose();
    created.provider.dispose();
    expect(gpu.textures[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(gpu.destroyDevice).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed V2 envelopes before delegating to V1", async () => {
    const gpu = fakeGpu();
    const created = createStudioEngineWebGpuTileProviderV2({
      boundary: { device: gpu.device },
      requestEpoch: 7,
    });
    expect(created.status).toBe("ready");
    if (created.status !== "ready") return;
    const malformed = {
      ...request(input()),
      kind: "wrong",
    } as unknown as StudioEngineWebGpuTileProviderV2Request;
    expect(await created.provider.execute(malformed)).toEqual({
      status: "rejected",
      reason: "invalid-request",
    });
    expect(gpu.submit).not.toHaveBeenCalled();
  });
});
