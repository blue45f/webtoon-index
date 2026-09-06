import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
  STUDIO_ENGINE_TILE_ENCODING,
  studioEngineRgba16FloatTileDigest,
  studioEngineTileProviderBatchDigest,
  type StudioEngineTileProviderBaseTile,
  type StudioEngineTileProviderInput,
} from "./studio-engine-tile-authority";
import {
  copyStudioEngineWebGpuTileReadbackRows,
  createStudioEngineWebGpuTileProviderV1,
  STUDIO_ENGINE_WEBGPU_TILE_BYTE_LENGTH,
  STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_VERSION,
  STUDIO_ENGINE_WEBGPU_TILE_SIZE,
  type StudioEngineWebGpuTileProviderRequest,
  type StudioEngineWebGpuTileProviderV1,
} from "./studio-engine-webgpu-tile-provider-v1";

import type { StudioCanonicalBrushPlan } from "../studio-canonical-brush-plan";

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
  readonly reject: (reason?: unknown) => void;
}

interface FakeBuffer {
  readonly buffer: GPUBuffer;
  readonly descriptor: GPUBufferDescriptor;
  readonly storage: ArrayBuffer | null;
  readonly mapAsync: ReturnType<typeof vi.fn>;
  readonly getMappedRange: ReturnType<typeof vi.fn>;
  readonly unmap: ReturnType<typeof vi.fn>;
  readonly destroy: ReturnType<typeof vi.fn>;
}

interface FakeTexture {
  readonly texture: GPUTexture;
  readonly descriptor: GPUTextureDescriptor;
  readonly destroy: ReturnType<typeof vi.fn>;
}

interface CopyRecord {
  readonly source: GPUTexelCopyTextureInfo;
  readonly destination: GPUTexelCopyBufferInfo;
  readonly size: GPUExtent3D;
}

interface FakeGpuHarness {
  readonly device: GPUDevice;
  readonly lost: Deferred<GPUDeviceLostInfo>;
  readonly buffers: FakeBuffer[];
  readonly textures: FakeTexture[];
  readonly copies: CopyRecord[];
  readonly passes: GPURenderPassDescriptor[];
  readonly writeTexture: ReturnType<typeof vi.fn>;
  readonly instanceUploads: Float32Array[];
  readonly submit: ReturnType<typeof vi.fn>;
  readonly onSubmittedWorkDone: ReturnType<typeof vi.fn>;
  readonly destroyDevice: ReturnType<typeof vi.fn>;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fakeGpuHarness(
  options: {
    readonly fence?: () => Promise<void>;
    readonly submitError?: Error;
    readonly mapError?: Error;
    readonly maxBufferSize?: number;
  } = {},
): FakeGpuHarness {
  const lost = deferred<GPUDeviceLostInfo>();
  const buffers: FakeBuffer[] = [];
  const textures: FakeTexture[] = [];
  const copies: CopyRecord[] = [];
  const passes: GPURenderPassDescriptor[] = [];
  const writeTexture = vi.fn();
  const instanceUploads: Float32Array[] = [];
  const destroyDevice = vi.fn();
  let submittedCopyCount = 0;

  const submit = vi.fn(() => {
    if (options.submitError) throw options.submitError;
    for (let index = submittedCopyCount; index < copies.length; index += 1) {
      const copy = copies[index]!;
      const fakeBuffer = buffers.find((candidate) => (
        candidate.buffer === copy.destination.buffer
      ));
      if (!fakeBuffer?.storage) throw new Error("readback storage missing");
      const offset = Number(copy.destination.offset ?? 0);
      const bytesPerRow = Number(copy.destination.bytesPerRow);
      const width = Number((copy.size as GPUExtent3DDict).width);
      const height = Number((copy.size as GPUExtent3DDict).height);
      const rowBytes = width * 8;
      const storage = new Uint8Array(fakeBuffer.storage);
      for (let row = 0; row < height; row += 1) {
        storage.fill(index + 1, offset + row * bytesPerRow, offset + row * bytesPerRow + rowBytes);
        storage.fill(
          0xee,
          offset + row * bytesPerRow + rowBytes,
          offset + (row + 1) * bytesPerRow,
        );
      }
    }
    submittedCopyCount = copies.length;
  });
  const onSubmittedWorkDone = vi.fn(options.fence ?? (async () => undefined));
  const queue = {
    writeBuffer: vi.fn((
      _buffer: GPUBuffer,
      _bufferOffset: number,
      data: AllowSharedBufferSource,
      dataOffset = 0,
      size?: number,
    ) => {
      const source = ArrayBuffer.isView(data)
        ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        : new Uint8Array(data);
      const byteLength = size ?? source.byteLength - dataOffset;
      const copy = source.slice(dataOffset, dataOffset + byteLength);
      instanceUploads.push(new Float32Array(copy.buffer));
    }),
    writeTexture,
    submit,
    onSubmittedWorkDone,
  };
  const device = {
    lost: lost.promise,
    limits: {
      maxTextureDimension2D: 8_192,
      maxBufferSize: options.maxBufferSize ?? 256 * 1024 * 1024,
    },
    queue,
    createShaderModule: vi.fn((descriptor: GPUShaderModuleDescriptor) => ({ descriptor })),
    createRenderPipeline: vi.fn((descriptor: GPURenderPipelineDescriptor) => ({ descriptor })),
    createBuffer: vi.fn((descriptor: GPUBufferDescriptor) => {
      const isReadback = (Number(descriptor.usage) & 0x01) !== 0;
      const storage = isReadback ? new ArrayBuffer(Number(descriptor.size)) : null;
      const destroy = vi.fn();
      const mapAsync = options.mapError
        ? vi.fn(async () => {
            throw options.mapError;
          })
        : vi.fn(async () => undefined);
      const getMappedRange = vi.fn(() => {
        if (!storage) throw new Error("buffer is not mappable");
        return storage;
      });
      const unmap = vi.fn();
      const buffer = {
        descriptor,
        mapAsync,
        getMappedRange,
        unmap,
        destroy,
      } as unknown as GPUBuffer;
      buffers.push({
        buffer,
        descriptor,
        storage,
        mapAsync,
        getMappedRange,
        unmap,
        destroy,
      });
      return buffer;
    }),
    createTexture: vi.fn((descriptor: GPUTextureDescriptor) => {
      const destroy = vi.fn();
      const texture = {
        descriptor,
        createView: vi.fn(() => ({ descriptor })),
        destroy,
      } as unknown as GPUTexture;
      textures.push({ texture, descriptor, destroy });
      return texture;
    }),
    createCommandEncoder: vi.fn(() => ({
      beginRenderPass: vi.fn((descriptor: GPURenderPassDescriptor) => {
        passes.push(descriptor);
        return {
          setVertexBuffer: vi.fn(),
          setPipeline: vi.fn(),
          draw: vi.fn(),
          end: vi.fn(),
        };
      }),
      copyTextureToBuffer: vi.fn((
        source: GPUTexelCopyTextureInfo,
        destination: GPUTexelCopyBufferInfo,
        size: GPUExtent3D,
      ) => {
        copies.push({ source, destination, size });
      }),
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
    instanceUploads,
    submit,
    onSubmittedWorkDone,
    destroyDevice,
  };
}

function brushPlan(
  commandSequence = 1,
  sessionEpoch = 7,
): StudioCanonicalBrushPlan {
  return {
    kind: "studio-canonical-brush-plan",
    version: 1,
    sessionEpoch,
    strokeEpoch: 1,
    commandSequence,
    strokeId: `stroke-${commandSequence}`,
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
      brushId: "quality-gpen",
      engine: "dab-v1",
      material: "ink",
      tip: {
        kind: "analytic",
        shape: "round",
        edgeSoftness: 0.1,
      },
      size: 12,
      flow: 1,
      hardness: 0.9,
      spacingRatio: 0.2,
      scatter: {
        radiusRatio: 0,
        distribution: "uniform-disk",
      },
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
          x: 24,
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
  row: number,
  options: {
    readonly layerId?: string;
    readonly revision?: number;
    readonly encoded?: ArrayBuffer | null;
    readonly digest?: string | null;
  } = {},
): StudioEngineTileProviderBaseTile {
  const layerId = options.layerId ?? "line";
  const encoded = options.encoded ?? null;
  const revision = options.revision ?? (encoded ? 1 : 0);
  const digest = options.digest ?? (
    encoded ? studioEngineRgba16FloatTileDigest(encoded) : null
  );
  const logicalTileIndex = BigInt(row * 64 + column);
  const logicalByteOffset = logicalTileIndex * BigInt(STUDIO_ENGINE_WEBGPU_TILE_BYTE_LENGTH);
  return {
    address: {
      tileId: `${column}:${row}`,
      column,
      row,
      layerId,
      layerIndex: 0,
      logicalTileIndex,
      logicalByteOffset,
      shardIndex: BigInt(0),
      shardByteOffset: logicalByteOffset,
    },
    tileRevision: revision,
    contentDigest: digest,
    encoded,
  };
}

function providerInput(
  commandSequence = 1,
  targets: readonly StudioEngineTileProviderBaseTile[] = [tile(0, 0)],
): StudioEngineTileProviderInput {
  return {
    kind: "studio-engine-tile-provider-input",
    version: STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
    encoding: STUDIO_ENGINE_TILE_ENCODING,
    commandIdentity: `command:${commandSequence}`,
    baseDocumentRevision: commandSequence - 1,
    baseLayerRevision: commandSequence - 1,
    layerId: "line",
    tileSize: STUDIO_ENGINE_WEBGPU_TILE_SIZE,
    brushPlan: brushPlan(commandSequence),
    targets,
  };
}

function request(
  input: StudioEngineTileProviderInput,
  mode: "append" | "rebuild" = "rebuild",
): StudioEngineWebGpuTileProviderRequest {
  return {
    kind: "studio-engine-webgpu-tile-provider-request",
    version: STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_VERSION,
    mode,
    requestEpoch: 7,
    deviceEpoch: 1,
    requestSequence: input.brushPlan.commandSequence,
    input,
  };
}

function readyProvider(
  harness: FakeGpuHarness,
  options: Parameters<typeof createStudioEngineWebGpuTileProviderV1>[0]["limits"] = {},
): StudioEngineWebGpuTileProviderV1 {
  const result = createStudioEngineWebGpuTileProviderV1({
    boundary: { device: harness.device },
    requestEpoch: 7,
    limits: options,
  });
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error("provider initialization failed");
  return result.provider;
}

describe("StudioEngineWebGpuTileProviderV1", () => {
  it("removes 256-byte WebGPU row padding without leaking padding bytes", () => {
    const source = new ArrayBuffer(768);
    const bytes = new Uint8Array(source);
    bytes.fill(0xee);
    bytes.set(Array.from({ length: 24 }, (_, index) => index), 256);
    bytes.set(Array.from({ length: 24 }, (_, index) => index + 24), 512);

    const copied = copyStudioEngineWebGpuTileReadbackRows(source, {
      width: 3,
      height: 2,
      bytesPerPixel: 8,
      bytesPerRow: 256,
      byteOffset: 256,
    });

    expect(copied).not.toBeNull();
    expect([...new Uint8Array(copied!.buffer)]).toEqual(
      Array.from({ length: 48 }, (_, index) => index),
    );
    expect([...new Uint8Array(copied!.buffer)]).not.toContain(0xee);
  });

  it("submits and reads multiple tiles in deterministic row-major order", async () => {
    const harness = fakeGpuHarness();
    const provider = readyProvider(harness);
    const input = providerInput(1, [
      tile(0, 0),
      tile(1, 0),
      tile(0, 1),
    ]);

    const result = await provider.execute(request(input));

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.batch.deltas.map((delta) => delta.tileId)).toEqual([
      "0:0",
      "1:0",
      "0:1",
    ]);
    expect(result.batch.deltas.map((delta) => (
      delta.encoded instanceof Uint16Array
        ? new Uint8Array(
            delta.encoded.buffer,
            delta.encoded.byteOffset,
            delta.encoded.byteLength,
          )[0]
        : new Uint8Array(delta.encoded)[0]
    ))).toEqual([1, 2, 3]);
    expect(result.batch.batchDigest).toBe(studioEngineTileProviderBatchDigest({
      commandIdentity: result.batch.commandIdentity,
      baseDocumentRevision: result.batch.baseDocumentRevision,
      baseLayerRevision: result.batch.baseLayerRevision,
      complete: true,
      deltaCount: result.batch.deltaCount,
      deltas: result.batch.deltas,
    }));
    expect(harness.copies.map((copy) => Number(copy.destination.offset))).toEqual([
      0,
      STUDIO_ENGINE_WEBGPU_TILE_BYTE_LENGTH,
      STUDIO_ENGINE_WEBGPU_TILE_BYTE_LENGTH * 2,
    ]);
    expect(harness.copies.every((copy) => copy.destination.bytesPerRow === 4_096)).toBe(true);
    expect(harness.instanceUploads).toHaveLength(1);
    const instances = harness.instanceUploads[0]!;
    const floatsPerTile = result.receipt.dabCount * 16;
    expect(instances[floatsPerTile]! - instances[0]!).toBeCloseTo(-2, 6);
    expect(instances[floatsPerTile * 2 + 1]! - instances[1]!).toBeCloseTo(2, 6);
    expect(harness.submit).toHaveBeenCalledTimes(1);
    expect(harness.passes.map((pass) => pass.colorAttachments[0]!.loadOp)).toEqual([
      "clear",
      "clear",
      "clear",
    ]);
    expect(harness.textures.every((texture) => (
      texture.descriptor.format === "rgba16float" && texture.destroy.mock.calls.length === 1
    ))).toBe(true);
    expect(harness.buffers.every((buffer) => buffer.destroy.mock.calls.length === 1)).toBe(true);
    expect(harness.buffers.find((buffer) => buffer.storage)?.unmap).toHaveBeenCalledTimes(1);
  });

  it("keeps append and recovery rebuild on the same exact base-tile algorithm", async () => {
    const baseWords = new Uint16Array(
      STUDIO_ENGINE_WEBGPU_TILE_BYTE_LENGTH / Uint16Array.BYTES_PER_ELEMENT,
    );
    baseWords[0] = 0x3c00;
    const base = baseWords.buffer;
    const input = providerInput(1, [tile(0, 0, { encoded: base })]);
    const appendHarness = fakeGpuHarness();
    const rebuildHarness = fakeGpuHarness();

    const append = await readyProvider(appendHarness).execute(request(input, "append"));
    const rebuild = await readyProvider(rebuildHarness).execute(request(input, "rebuild"));

    expect(append.status).toBe("completed");
    expect(rebuild.status).toBe("completed");
    if (append.status !== "completed" || rebuild.status !== "completed") return;
    expect(append.receipt.mode).toBe("append");
    expect(rebuild.receipt.mode).toBe("rebuild");
    expect(append.receipt.uploadedBaseBytes).toBe(STUDIO_ENGINE_WEBGPU_TILE_BYTE_LENGTH);
    expect(rebuild.receipt.uploadedBaseBytes).toBe(STUDIO_ENGINE_WEBGPU_TILE_BYTE_LENGTH);
    expect(append.batch.deltas[0]!.encoded).toEqual(rebuild.batch.deltas[0]!.encoded);
    expect(appendHarness.writeTexture).toHaveBeenCalledTimes(1);
    expect(rebuildHarness.writeTexture).toHaveBeenCalledTimes(1);
    expect(appendHarness.passes[0]!.colorAttachments[0]!.loadOp).toBe("load");
    expect(rebuildHarness.passes[0]!.colorAttachments[0]!.loadOp).toBe("load");
  });

  it("exposes an authority-facing render adapter that returns the exact delta frame", async () => {
    const harness = fakeGpuHarness();
    const batch = await readyProvider(harness).render(providerInput());

    expect(batch).toEqual(expect.objectContaining({
      kind: "studio-engine-tile-provider-delta",
      version: STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
      commandIdentity: "command:1",
      complete: true,
      deltaCount: 1,
    }));
  });

  it("honors cancellation before allocation and after a submitted queue fence", async () => {
    const earlyHarness = fakeGpuHarness();
    const earlyProvider = readyProvider(earlyHarness);
    const earlyAbort = new AbortController();
    earlyAbort.abort();

    await expect(earlyProvider.execute(
      request(providerInput()),
      earlyAbort.signal,
    )).resolves.toEqual({ status: "rejected", reason: "aborted" });
    expect(earlyHarness.buffers).toHaveLength(0);
    expect(earlyHarness.textures).toHaveLength(0);

    const fence = deferred<void>();
    const lateHarness = fakeGpuHarness({ fence: () => fence.promise });
    const lateProvider = readyProvider(lateHarness);
    const lateAbort = new AbortController();
    const pending = lateProvider.execute(request(providerInput()), lateAbort.signal);
    await vi.waitFor(() => expect(lateHarness.submit).toHaveBeenCalledTimes(1));
    lateAbort.abort();
    fence.resolve(undefined);

    await expect(pending).resolves.toEqual({ status: "rejected", reason: "aborted" });
    expect(lateHarness.textures.every((texture) => texture.destroy.mock.calls.length === 1))
      .toBe(true);
    expect(lateHarness.buffers.every((buffer) => buffer.destroy.mock.calls.length === 1))
      .toBe(true);
  });

  it("fails closed on device loss and invalidates the device epoch", async () => {
    const fence = deferred<void>();
    const harness = fakeGpuHarness({ fence: () => fence.promise });
    const onDeviceLost = vi.fn();
    const created = createStudioEngineWebGpuTileProviderV1({
      boundary: { device: harness.device },
      requestEpoch: 7,
      onDeviceLost,
    });
    if (created.status !== "ready") throw new Error("provider initialization failed");
    const pending = created.provider.execute(request(providerInput()));
    await vi.waitFor(() => expect(harness.submit).toHaveBeenCalledTimes(1));

    harness.lost.resolve({
      reason: "unknown",
      message: "test loss",
    } as GPUDeviceLostInfo);

    await expect(pending).resolves.toEqual({ status: "rejected", reason: "device-lost" });
    expect(created.provider.stats()).toEqual(expect.objectContaining({
      status: "device-lost",
      deviceEpoch: 2,
      activeRequests: 0,
    }));
    expect(onDeviceLost).toHaveBeenCalledTimes(1);
    expect(harness.textures.every((texture) => texture.destroy.mock.calls.length === 1))
      .toBe(true);
    expect(harness.buffers.every((buffer) => buffer.destroy.mock.calls.length === 1))
      .toBe(true);
  });

  it("destroys every request resource when queue completion or mapping fails", async () => {
    for (const harness of [
      fakeGpuHarness({ fence: async () => {
        throw new Error("queue failed");
      } }),
      fakeGpuHarness({ mapError: new Error("map failed") }),
    ]) {
      const provider = readyProvider(harness);
      await expect(provider.execute(request(providerInput()))).resolves.toEqual({
        status: "rejected",
        reason: "submission-failed",
      });
      expect(provider.stats().status).toBe("failed");
      expect(harness.textures.every((texture) => texture.destroy.mock.calls.length === 1))
        .toBe(true);
      expect(harness.buffers.every((buffer) => buffer.destroy.mock.calls.length === 1))
        .toBe(true);
    }
  });

  it("rejects excess concurrent work before allocating a second request", async () => {
    const fence = deferred<void>();
    const harness = fakeGpuHarness({ fence: () => fence.promise });
    const provider = readyProvider(harness, { maxInFlightRequests: 1 });
    const first = provider.execute(request(providerInput(1)));
    await vi.waitFor(() => expect(harness.submit).toHaveBeenCalledTimes(1));

    await expect(provider.execute(request(providerInput(2)))).resolves.toEqual({
      status: "rejected",
      reason: "gpu-backpressure",
    });
    expect(harness.textures).toHaveLength(1);
    fence.resolve(undefined);
    await expect(first).resolves.toEqual(expect.objectContaining({ status: "completed" }));
  });

  it.each([
    {
      limits: { maxTiles: 1 },
      targets: [tile(0, 0), tile(1, 0)],
      reason: "tile-budget",
    },
    {
      limits: { maxInputBytes: 1 },
      targets: [tile(0, 0, {
        encoded: new ArrayBuffer(STUDIO_ENGINE_WEBGPU_TILE_BYTE_LENGTH),
      })],
      reason: "input-byte-budget",
    },
    {
      limits: { maxInstanceBytes: 1 },
      targets: [tile(0, 0)],
      reason: "instance-byte-budget",
    },
    {
      limits: { maxStagingBytes: 1 },
      targets: [tile(0, 0)],
      reason: "staging-byte-budget",
    },
    {
      limits: { maxDispatches: 1 },
      targets: [tile(0, 0), tile(1, 0)],
      reason: "work-dispatch-budget",
    },
  ])("enforces $reason before GPU resource creation", async ({
    limits,
    targets,
    reason,
  }) => {
    const harness = fakeGpuHarness();
    const provider = readyProvider(harness, limits);

    await expect(provider.execute(request(providerInput(1, targets)))).resolves.toEqual({
      status: "rejected",
      reason,
    });
    expect(harness.buffers).toHaveLength(0);
    expect(harness.textures).toHaveLength(0);
  });

  it("rejects corrupt bases, non-row-major targets, and stale epochs fail-closed", async () => {
    const harness = fakeGpuHarness();
    const provider = readyProvider(harness);
    const corrupt = new ArrayBuffer(STUDIO_ENGINE_WEBGPU_TILE_BYTE_LENGTH);

    await expect(provider.execute(request(providerInput(1, [
      tile(0, 0, {
        encoded: corrupt,
        digest: "rgba16f-v1:corrupt",
      }),
    ])))).resolves.toEqual({
      status: "rejected",
      reason: "invalid-base-tile",
    });
    await expect(provider.execute(request(providerInput(1, [
      tile(1, 0),
      tile(0, 0),
    ])))).resolves.toEqual({
      status: "rejected",
      reason: "invalid-base-tile",
    });
    await expect(provider.execute({
      ...request(providerInput()),
      requestEpoch: 8,
    })).resolves.toEqual({
      status: "rejected",
      reason: "stale-request-epoch",
    });
    await expect(provider.execute({
      ...request(providerInput()),
      deviceEpoch: 2,
    })).resolves.toEqual({
      status: "rejected",
      reason: "stale-device-epoch",
    });
    expect(harness.buffers).toHaveLength(0);
    expect(harness.textures).toHaveLength(0);
  });
});
