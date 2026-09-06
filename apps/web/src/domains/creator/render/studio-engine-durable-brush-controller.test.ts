import { describe, expect, it, vi } from "vitest";

import {
  StudioEngineDurableBrushController,
  type StudioEngineDurableBrushStorageBoundary,
} from "./studio-engine-durable-brush-controller";
import {
  StudioEngineTileAuthority,
  STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
  studioEngineRgba16FloatTileDigest,
  studioEngineTileProviderBatchDigest,
  type StudioEngineTileExecutionProvider,
  type StudioEngineTileProviderDelta,
  type StudioEngineTileProviderInput,
} from "./studio-engine-tile-authority";
import {
  StudioEngineTileStorageBridge,
  STUDIO_ENGINE_TILE_STORAGE_ACK_KIND,
  STUDIO_ENGINE_TILE_STORAGE_PROTOCOL_VERSION,
  type StudioEngineTileStorageCommitAck,
  type StudioEngineTileStorageCommitRequest,
  type StudioEngineTileStorageTransport,
} from "./studio-engine-tile-storage-bridge";
import {
  createStudioEngineVNextBrushProviderGpuCompletion,
  StudioEngineVNextBrushProviderGpuBoundaryAdapter,
  type StudioEngineVNextBrushProviderGpuExecutionBoundary,
} from "./studio-engine-vnext-brush-provider-gpu-boundary";
import {
  StudioEngineVNextBrushProviderRouter,
  type StudioEngineVNextBrushProviderCapability,
  type StudioEngineVNextBrushProviderDescriptor,
  type StudioEngineVNextBrushProviderExecution,
} from "./studio-engine-vnext-brush-provider-router";
import {
  fingerprintStudioEngineWebGpuBrushPlan,
  STUDIO_ENGINE_WEBGPU_BRUSH_COLOR_MODEL,
  STUDIO_ENGINE_WEBGPU_BRUSH_INPUT_COLOR_ENCODING,
  STUDIO_ENGINE_WEBGPU_BRUSH_PRESENTATION_COLOR_SPACE,
  STUDIO_ENGINE_WEBGPU_BRUSH_RECEIPT_REVISION,
  STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT,
  STUDIO_ENGINE_WEBGPU_BRUSH_WORKING_COLOR_SPACE,
} from "./studio-engine-webgpu-brush-runtime";

import type {
  StudioEngineFutureBrushGpuBoundary,
  StudioEngineFutureBrushSubmission,
} from "./studio-engine-future-brush-controller";
import type {
  StudioEngineWebGpuBrushExecutionResult,
  StudioEngineWebGpuBrushFrame,
} from "./studio-engine-webgpu-brush-runtime";

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
  readonly reject: (reason?: unknown) => void;
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

function curve() {
  return { minimum: 1, maximum: 1, exponent: 1 };
}

function proceduralGrain() {
  return {
    kind: "procedural-noise",
    assetId: null,
    contentHash: null,
    space: "document",
    scale: 1,
    depth: 0.5,
    contrast: 1,
    seed: 17,
  };
}

function canonicalPlan(
  commandSequence = 1,
  options: Readonly<{ grain?: unknown }> = {},
): Record<string, unknown> {
  return {
    kind: "studio-canonical-brush-plan",
    version: 1,
    sessionEpoch: 7,
    strokeEpoch: 11,
    commandSequence,
    strokeId: `durable-stroke-${commandSequence}`,
    seed: 0x1234_5678 + commandSequence,
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
      components: [0.2, 0.4, 0.8, 0.9],
    },
    composite: {
      porterDuff: "source-over",
      blendMode: "normal",
      opacity: 1,
    },
    recipe: {
      version: 1,
      brushId: "durable-g-pen",
      engine: "dab-v1",
      material: "ink",
      tip: { kind: "analytic", shape: "round", edgeSoftness: 0.1 },
      size: 4,
      flow: 1,
      hardness: 0.9,
      spacingRatio: 0.2,
      scatter: { radiusRatio: 0, distribution: "uniform-disk" },
      angleRadians: 0,
      roundness: 1,
      pressure: {
        size: curve(),
        opacity: curve(),
        flow: curve(),
      },
      grain: options.grain ?? null,
      wetMedia: null,
    },
    source: {
      encoding: "accepted-authoritative-samples-v1",
      firstSequence: 1,
      lastSequence: 2,
      samples: [
        {
          role: "authoritative",
          sequence: 1,
          x: 0.5,
          y: 0.5,
          pressure: 0.7,
          tangentialPressure: 0,
          tiltX: 0,
          tiltY: 0,
          twist: 0,
          timeMilliseconds: 1,
          pointerId: 1,
          flags: 0,
        },
        {
          role: "authoritative",
          sequence: 2,
          x: 3.5,
          y: 1.5,
          pressure: 1,
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

function submission(
  commandSequence = 1,
  overrides: Partial<StudioEngineFutureBrushSubmission> = {},
): StudioEngineFutureBrushSubmission {
  return {
    mode: "rebuild",
    resizeEpoch: 3,
    deviceEpoch: 5,
    rasterRect: { x: 0, y: 0, width: 8, height: 8 },
    layerId: "ink",
    baseDocumentRevision: commandSequence - 1,
    baseLayerRevision: commandSequence - 1,
    dirtyRects: [{ x: 0, y: 0, width: 4, height: 2 }],
    brushPlan: canonicalPlan(commandSequence),
    ...overrides,
  };
}

function gpuPresented(
  frame: StudioEngineWebGpuBrushFrame,
): StudioEngineWebGpuBrushExecutionResult {
  return {
    status: "presented",
    receipt: Object.freeze({
      kind: "studio-engine-webgpu-brush-receipt",
      revision: STUDIO_ENGINE_WEBGPU_BRUSH_RECEIPT_REVISION,
      backend: "webgpu",
      requestSequence: frame.requestSequence,
      resizeEpoch: frame.resizeEpoch,
      deviceEpoch: 5,
      width: 8,
      height: 8,
      textureFormat: STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT,
      colorModel: STUDIO_ENGINE_WEBGPU_BRUSH_COLOR_MODEL,
      workingColorSpace: STUDIO_ENGINE_WEBGPU_BRUSH_WORKING_COLOR_SPACE,
      inputColorEncoding: STUDIO_ENGINE_WEBGPU_BRUSH_INPUT_COLOR_ENCODING,
      presentationColorSpace: STUDIO_ENGINE_WEBGPU_BRUSH_PRESENTATION_COLOR_SPACE,
      mode: frame.update.mode,
      strokeId: frame.update.strokeId,
      loweringVersion: frame.update.loweringVersion,
      dabCount: frame.update.dabs.length,
      batchCount: frame.update.batches.length,
      batchOrder: Object.freeze(
        frame.update.batches.map((batch) => batch.composite.porterDuff),
      ),
      planFingerprint: fingerprintStudioEngineWebGpuBrushPlan(frame),
      queueState: "submitted",
      complete: true,
    }),
  };
}

function tileProvider(events: string[] = []): StudioEngineTileExecutionProvider {
  return {
    render(input: StudioEngineTileProviderInput) {
      events.push(`provider:${input.brushPlan.commandSequence}`);
      const deltas: StudioEngineTileProviderDelta[] = input.targets.map(
        (target, index) => {
          const encoded = new Uint16Array(input.tileSize * input.tileSize * 4);
          encoded.fill(0x3c00 + input.brushPlan.commandSequence + index);
          return {
            index,
            tileId: target.address.tileId,
            column: target.address.column,
            row: target.address.row,
            baseTileRevision: target.tileRevision,
            encoded,
            contentDigest: studioEngineRgba16FloatTileDigest(encoded),
          };
        },
      );
      const framing = {
        commandIdentity: input.commandIdentity,
        baseDocumentRevision: input.baseDocumentRevision,
        baseLayerRevision: input.baseLayerRevision,
        complete: true,
        deltaCount: deltas.length,
        deltas,
      };
      return {
        kind: "studio-engine-tile-provider-delta",
        version: STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
        ...framing,
        batchDigest: studioEngineTileProviderBatchDigest(framing),
      };
    },
  };
}

function authority(events: string[] = []): StudioEngineTileAuthority {
  return new StudioEngineTileAuthority({
    documentId: "durable-doc",
    documentWidth: 8,
    documentHeight: 8,
    tileSize: 2,
    layerIds: ["ink"],
    sessionEpoch: 7,
    strokeEpoch: 11,
    shardBytes: BigInt(64),
    provider: tileProvider(events),
  });
}

function exactAck(
  request: StudioEngineTileStorageCommitRequest,
  disposition: StudioEngineTileStorageCommitAck["disposition"] = "committed",
): StudioEngineTileStorageCommitAck {
  return {
    kind: STUDIO_ENGINE_TILE_STORAGE_ACK_KIND,
    version: STUDIO_ENGINE_TILE_STORAGE_PROTOCOL_VERSION,
    complete: true,
    disposition,
    requestSequence: request.requestSequence,
    sessionEpoch: request.sessionEpoch,
    transactionSequence: request.transactionSequence,
    transactionIdentity: request.transactionIdentity,
    expectedDurableRevision: request.expectedDurableRevision,
    durableRevision: request.expectedDurableRevision + 1,
    documentId: request.documentId,
    commandSequence: request.commandSequence,
    documentRevision: request.documentRevision,
    writeCount: request.writeCount,
    totalPayloadBytes: request.totalPayloadBytes,
    journal: {
      sequence: request.journal.sequence,
      logicalByteOffset: request.journal.logicalByteOffset,
      byteLength: request.journal.byteLength,
      recordDigest: request.journal.recordDigest,
      payloadChecksum: request.journal.payloadChecksum,
    },
    tiles: request.tiles.map((tile) => ({
      index: tile.index,
      tileId: tile.tileId,
      logicalTileIndex: tile.logicalTileIndex,
      logicalByteOffset: tile.logicalByteOffset,
      shardIndex: tile.shardIndex,
      shardByteOffset: tile.shardByteOffset,
      tileRevision: tile.tileRevision,
      byteLength: tile.byteLength,
      contentDigest: tile.contentDigest,
      payloadChecksum: tile.payloadChecksum,
    })),
  };
}

function bridge(
  actor: StudioEngineTileAuthority,
  transport: StudioEngineTileStorageTransport,
): StudioEngineTileStorageBridge {
  return new StudioEngineTileStorageBridge({
    documentId: "durable-doc",
    sessionEpoch: 7,
    payloadSource: {
      readTile(tile) {
        return actor.readTile(tile.layerId, tile.column, tile.row);
      },
    },
    transport,
  });
}

function controller(options: {
  readonly actor?: StudioEngineTileAuthority;
  readonly storage?: StudioEngineDurableBrushStorageBoundary;
  readonly transport?: StudioEngineTileStorageTransport;
  readonly gpu?: StudioEngineFutureBrushGpuBoundary;
  readonly specialistGpu?: StudioEngineVNextBrushProviderGpuExecutionBoundary;
  readonly events?: string[];
}) {
  const events = options.events ?? [];
  const actor = options.actor ?? authority(events);
  const transport = options.transport ?? {
    commit: (request: StudioEngineTileStorageCommitRequest) => {
      events.push(`storage:${request.commandSequence}`);
      return exactAck(request);
    },
  };
  const storage = options.storage ?? bridge(actor, transport);
  const gpu = options.gpu ?? {
    execute: (frame: StudioEngineWebGpuBrushFrame) => {
      events.push(`gpu:${frame.update.strokeId}`);
      return gpuPresented(frame);
    },
  };
  const target = new StudioEngineDurableBrushController({
    sessionEpoch: 7,
    strokeEpoch: 11,
    resizeEpoch: 3,
    deviceEpoch: 5,
    webGpu: gpu,
    ...(options.specialistGpu
      ? { specialistGpu: options.specialistGpu }
      : {}),
    tileAuthority: actor,
    storage,
  });
  return { target, actor, storage, transport, gpu, events };
}

const DURABLE_GRAIN_CAPABILITIES = [
  "tip:analytic",
  "grain:procedural",
  "media:dry",
  "color:linear-srgb",
  "porter-duff:source-over",
  "blend:normal",
  "intent:professional",
] as const satisfies readonly StudioEngineVNextBrushProviderCapability[];

function durableSpecialistBoundary(events: string[]) {
  const descriptor: StudioEngineVNextBrushProviderDescriptor = Object.freeze({
    id: "durable-grain-provider",
    version: 4,
    priority: 100,
    capabilities: DURABLE_GRAIN_CAPABILITIES,
  });
  const execute = vi.fn((
    execution: StudioEngineVNextBrushProviderExecution,
  ) => {
    events.push(`specialist-gpu:${execution.canonicalPlan.commandSequence}`);
    return createStudioEngineVNextBrushProviderGpuCompletion(
      descriptor,
      execution,
      {
        executionDigest: `durable:gpu:${execution.globalRequestSequence}`,
        width: 8,
        height: 8,
        loweringVersion: 11,
        dabCount: 2,
        batchCount: 1,
        batchOrder: [execution.canonicalPlan.composite.porterDuff],
      },
    );
  });
  const router = new StudioEngineVNextBrushProviderRouter({
    sessionEpoch: 7,
    deviceEpoch: 5,
    resizeEpoch: 3,
    providers: [{
      descriptor,
      execute,
      notifyDeviceLoss: vi.fn(),
      dispose: vi.fn(),
    }],
  });
  return {
    boundary: new StudioEngineVNextBrushProviderGpuBoundaryAdapter(router),
    execute,
  };
}

describe("StudioEngineDurableBrushController", () => {
  it("acknowledges one receipt only after GPU, real tile authority, and atomic OPFS v2 ACK", async () => {
    const events: string[] = [];
    const fixture = controller({ events });

    const result = await fixture.target.submit(submission());

    expect(result.status).toBe("committed");
    if (result.status !== "committed") return;
    expect(events).toEqual([
      "gpu:durable-stroke-1",
      "provider:1",
      "storage:1",
    ]);
    expect(result.receipt).toMatchObject({
      storageDurability: "opfs-v2-durable",
      commandSequence: 1,
      gpu: {
        state: "submitted",
        requestSequence: 1,
      },
      authority: {
        state: "tile-authority-committed",
        documentId: "durable-doc",
        commandSequence: 1,
        documentRevision: 1,
        layerRevision: 1,
        journalSequence: 1,
      },
      storage: {
        state: "opfs-v2-atomic-commit-acknowledged",
        disposition: "committed",
        durableRevision: 1,
        documentId: "durable-doc",
        commandSequence: 1,
        documentRevision: 1,
        tileCount: 2,
      },
    });
    expect(result.receipt.storage.totalPayloadBytes).toBe(
      BigInt(result.receipt.authority.journalByteLength)
      + BigInt(2 * 2 * 2 * 4 * Uint16Array.BYTES_PER_ELEMENT),
    );
    expect(Object.isFrozen(result.receipt)).toBe(true);
    expect(Object.isFrozen(result.receipt.authority)).toBe(true);
    expect(Object.isFrozen(result.receipt.storage)).toBe(true);
    expect(fixture.target.stats()).toMatchObject({
      durableReceiptCount: 1,
      storageRetryBlocked: false,
    });
  });

  it("returns an idempotent durable duplicate without re-running GPU, authority, or storage", async () => {
    const events: string[] = [];
    const fixture = controller({ events });
    const input = submission();

    const first = await fixture.target.submit(input);
    const duplicate = await fixture.target.submit(input);

    expect(first.status).toBe("committed");
    expect(duplicate.status).toBe("duplicate");
    if (first.status === "rejected" || duplicate.status === "rejected") return;
    expect(duplicate.receipt).toBe(first.receipt);
    expect(events).toEqual([
      "gpu:durable-stroke-1",
      "provider:1",
      "storage:1",
    ]);
  });

  it("durably commits specialist GPU completion before tile/storage and caches duplicates", async () => {
    const events: string[] = [];
    const specialist = durableSpecialistBoundary(events);
    const analyticExecute = vi.fn();
    const fixture = controller({
      events,
      specialistGpu: specialist.boundary,
      gpu: { execute: analyticExecute },
    });
    const input = submission(1, {
      brushPlan: canonicalPlan(1, { grain: proceduralGrain() }),
    });

    const first = await fixture.target.submit(input);
    const duplicate = await fixture.target.submit(input);

    expect(first.status).toBe("committed");
    expect(duplicate.status).toBe("duplicate");
    if (first.status === "rejected" || duplicate.status === "rejected") return;
    expect(events).toEqual([
      "specialist-gpu:1",
      "provider:1",
      "storage:1",
    ]);
    expect(analyticExecute).not.toHaveBeenCalled();
    expect(specialist.execute).toHaveBeenCalledTimes(1);
    expect(duplicate.receipt).toBe(first.receipt);
    expect(first.receipt).toMatchObject({
      gpu: {
        requestSequence: 1,
        planFingerprint: expect.stringMatching(
          /^vnext-provider:durable-grain-provider@4:/u,
        ),
      },
      authority: { commandSequence: 1 },
      storage: {
        state: "opfs-v2-atomic-commit-acknowledged",
        commandSequence: 1,
      },
      storageDurability: "opfs-v2-durable",
    });
  });

  it("rejects a same-sequence conflict and a sequence gap before durability advances", async () => {
    const events: string[] = [];
    const fixture = controller({ events });
    await fixture.target.submit(submission());

    const conflict = await fixture.target.submit(submission(1, {
      dirtyRects: [{ x: 2, y: 2, width: 2, height: 2 }],
    }));
    const gap = await fixture.target.submit(submission(3, {
      baseDocumentRevision: 1,
      baseLayerRevision: 1,
    }));

    expect(conflict).toMatchObject({
      status: "rejected",
      reason: "command-sequence-conflict",
    });
    expect(gap).toMatchObject({
      status: "rejected",
      reason: "command-sequence-gap",
    });
    expect(events.filter((event) => event.startsWith("storage:"))).toEqual(["storage:1"]);
  });

  it("preserves the bridge retry barrier after ambiguous storage failure and permits only exact retry", async () => {
    const events: string[] = [];
    const actor = authority(events);
    let attempts = 0;
    const send = vi.fn((request: StudioEngineTileStorageCommitRequest) => {
      attempts += 1;
      events.push(`storage-attempt:${request.commandSequence}:${attempts}`);
      if (attempts === 1) throw new Error("ambiguous transport failure");
      return exactAck(request, "idempotent-replay");
    });
    const storage = bridge(actor, { commit: send });
    const fixture = controller({ actor, storage, events });

    const failed = await fixture.target.submit(submission());
    const later = await fixture.target.submit(submission(2));
    const retried = await fixture.target.submit(submission());

    expect(failed).toEqual({
      status: "rejected",
      reason: "storage-rejected",
      futureReason: "tile-authority-rejected",
      storageCode: "transport-failed",
    });
    expect(failed).not.toHaveProperty("receipt");
    expect(later).toMatchObject({
      status: "rejected",
      reason: "command-sequence-gap",
    });
    expect(retried.status).toBe("duplicate");
    if (retried.status === "rejected") return;
    expect(retried.receipt.storage.disposition).toBe("idempotent-replay");
    expect(send).toHaveBeenCalledTimes(2);
    expect(events.filter((event) => event === "provider:1")).toHaveLength(1);
    expect(fixture.target.stats().storageRetryBlocked).toBe(false);
  });

  it("fails closed when a storage boundary returns a mismatched durable receipt", async () => {
    const actor = authority();
    const storage: StudioEngineDurableBrushStorageBoundary = {
      persist(committedValue) {
        const committed = committedValue as {
          receipt: {
            commandIdentity: string;
            commandSequence: number;
            documentRevision: number;
            journalLogicalByteOffset: bigint;
            journalByteLength: number;
            journalSequence: number;
            tiles: readonly { byteLength: number }[];
          };
        };
        const receipt = committed.receipt;
        return {
          kind: "studio-engine-tile-storage-durable-receipt",
          version: STUDIO_ENGINE_TILE_STORAGE_PROTOCOL_VERSION,
          disposition: "committed",
          requestSequence: 1,
          sessionEpoch: 7,
          transactionSequence: receipt.journalSequence,
          transactionIdentity: "mismatched-storage-identity",
          durableRevision: 1,
          documentId: "wrong-document",
          commandIdentity: receipt.commandIdentity,
          commandSequence: receipt.commandSequence,
          documentRevision: receipt.documentRevision,
          journalLogicalByteOffset: receipt.journalLogicalByteOffset,
          journalByteLength: receipt.journalByteLength,
          journalPayloadChecksum: "checksum",
          tileCount: receipt.tiles.length,
          totalPayloadBytes: BigInt(receipt.journalByteLength) + receipt.tiles.reduce(
            (total, tile) => total + BigInt(tile.byteLength),
            BigInt(0),
          ),
        };
      },
    };
    const fixture = controller({ actor, storage });

    const result = await fixture.target.submit(submission());

    expect(result).toEqual({
      status: "rejected",
      reason: "durable-receipt-mismatch",
      futureReason: "tile-authority-rejected",
      storageCode: undefined,
    });
    expect(result).not.toHaveProperty("receipt");
    expect(fixture.target.stats().durableReceiptCount).toBe(0);
  });

  it("cancels while GPU is pending without starting authority or storage", async () => {
    const gpu = deferred<StudioEngineWebGpuBrushExecutionResult>();
    let frame: StudioEngineWebGpuBrushFrame | null = null;
    const execute = vi.fn((value: StudioEngineWebGpuBrushFrame) => {
      frame = value;
      return gpu.promise;
    });
    const actor = authority();
    const commit = vi.spyOn(actor, "commit");
    const storagePersist = vi.fn();
    const fixture = controller({
      actor,
      storage: { persist: storagePersist },
      gpu: { execute },
    });
    const pending = fixture.target.submit(submission());
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));

    expect(fixture.target.cancel(1)).toEqual({ status: "canceled", commandSequence: 1 });
    gpu.resolve(gpuPresented(frame!));

    await expect(pending).resolves.toEqual({
      status: "rejected",
      reason: "canceled",
      futureReason: "canceled",
    });
    expect(commit).not.toHaveBeenCalled();
    expect(storagePersist).not.toHaveBeenCalled();
  });

  it("makes cancellation too late after storage starts and completes the atomic transaction", async () => {
    const transportStarted = deferred<void>();
    const ack = deferred<StudioEngineTileStorageCommitAck>();
    let request: StudioEngineTileStorageCommitRequest | null = null;
    const actor = authority();
    const storage = bridge(actor, {
      commit(value) {
        request = value;
        transportStarted.resolve(undefined);
        return ack.promise;
      },
    });
    const fixture = controller({ actor, storage });
    const pending = fixture.target.submit(submission());
    await transportStarted.promise;

    expect(fixture.target.stats().activeStages.storage).toBe(1);
    expect(fixture.target.cancel(1)).toEqual({ status: "too-late", commandSequence: 1 });
    ack.resolve(exactAck(request!));

    await expect(pending).resolves.toEqual(expect.objectContaining({
      status: "committed",
      receipt: expect.objectContaining({
        storageDurability: "opfs-v2-durable",
      }),
    }));
  });

  it("disposes storage, then authority, then GPU and never publishes a partial receipt", async () => {
    const events: string[] = [];
    const transportStarted = deferred<void>();
    const actor = authority();
    const authorityDispose = vi.spyOn(actor, "dispose").mockImplementation(() => {
      events.push("authority-dispose");
    });
    const transport: StudioEngineTileStorageTransport = {
      commit(_request, options) {
        events.push("storage-start");
        transportStarted.resolve(undefined);
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(options.signal.reason), {
            once: true,
          });
        });
      },
      dispose() {
        events.push("storage-dispose");
      },
    };
    const storage = bridge(actor, transport);
    const gpuDispose = vi.fn(() => events.push("gpu-dispose"));
    const fixture = controller({
      actor,
      storage,
      gpu: {
        execute: (frame) => gpuPresented(frame),
        dispose: gpuDispose,
      },
    });
    const pending = fixture.target.submit(submission());
    await transportStarted.promise;

    const disposing = fixture.target.dispose();
    const result = await pending;
    await disposing;

    expect(result.status).toBe("rejected");
    expect(result).not.toHaveProperty("receipt");
    expect(events).toEqual([
      "storage-start",
      "storage-dispose",
      "authority-dispose",
      "gpu-dispose",
    ]);
    expect(authorityDispose).toHaveBeenCalledTimes(1);
    expect(gpuDispose).toHaveBeenCalledTimes(1);
    expect(fixture.target.stats()).toMatchObject({
      disposed: true,
      durableReceiptCount: 0,
      activeSubmissions: 0,
    });
  });

  it("rejects a first-command sequence gap without touching GPU, authority, or storage", async () => {
    const actor = authority();
    const authorityCommit = vi.spyOn(actor, "commit");
    const gpuExecute = vi.fn();
    const storagePersist = vi.fn();
    const fixture = controller({
      actor,
      storage: { persist: storagePersist },
      gpu: { execute: gpuExecute },
    });

    const result = await fixture.target.submit(submission(2));

    expect(result).toMatchObject({
      status: "rejected",
      reason: "command-sequence-gap",
    });
    expect(gpuExecute).not.toHaveBeenCalled();
    expect(authorityCommit).not.toHaveBeenCalled();
    expect(storagePersist).not.toHaveBeenCalled();
  });
});
