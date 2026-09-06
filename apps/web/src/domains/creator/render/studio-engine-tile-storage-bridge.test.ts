import { describe, expect, it, vi } from "vitest";

import { STUDIO_CANONICAL_BRUSH_PLAN_VERSION } from "../studio-canonical-brush-plan";

import {
  StudioEngineTileAuthority,
  STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
  studioEngineRgba16FloatTileDigest,
  studioEngineTileProviderBatchDigest,
  type StudioEngineTileCommitResult,
  type StudioEngineTileExecutionProvider,
  type StudioEngineTileProviderDelta,
  type StudioEngineTileProviderInput,
} from "./studio-engine-tile-authority";
import {
  StudioEngineTileStorageBridge,
  StudioEngineTileStorageBridgeError,
  STUDIO_ENGINE_TILE_STORAGE_ACK_KIND,
  STUDIO_ENGINE_TILE_STORAGE_PROTOCOL_VERSION,
  studioEngineTileStorageRequestTransfers,
  type StudioEngineTileStorageCommitAck,
  type StudioEngineTileStorageCommitRequest,
  type StudioEngineTileStoragePayloadSource,
  type StudioEngineTileStorageTransport,
} from "./studio-engine-tile-storage-bridge";

function curve() {
  return { minimum: 1, maximum: 1, exponent: 1 };
}

function brushPlan(commandSequence: number) {
  return {
    kind: "studio-canonical-brush-plan",
    version: STUDIO_CANONICAL_BRUSH_PLAN_VERSION,
    sessionEpoch: 19,
    strokeEpoch: 7,
    commandSequence,
    strokeId: `storage-stroke-${commandSequence}`,
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
      components: [0.1, 0.2, 0.3, 0.9],
    },
    composite: {
      porterDuff: "source-over",
      blendMode: "normal",
      opacity: 1,
    },
    recipe: {
      version: 1,
      brushId: "storage-g-pen",
      engine: "dab-v1",
      material: "ink",
      tip: { kind: "analytic", shape: "round", edgeSoftness: 0.1 },
      size: 1,
      flow: 1,
      hardness: 1,
      spacingRatio: 0.1,
      scatter: { radiusRatio: 0, distribution: "uniform-disk" },
      angleRadians: 0,
      roundness: 1,
      pressure: {
        size: curve(),
        opacity: curve(),
        flow: curve(),
      },
      grain: null,
      wetMedia: null,
    },
    source: {
      encoding: "accepted-authoritative-samples-v1",
      firstSequence: commandSequence,
      lastSequence: commandSequence,
      samples: [{
        role: "authoritative",
        sequence: commandSequence,
        x: 0.5,
        y: 0.5,
        pressure: 1,
        tangentialPressure: 0,
        tiltX: 0,
        tiltY: 0,
        twist: 0,
        timeMilliseconds: commandSequence,
        pointerId: 1,
        flags: 0,
      }],
    },
  };
}

function provider(): StudioEngineTileExecutionProvider {
  return {
    render(input: StudioEngineTileProviderInput) {
      const deltas: StudioEngineTileProviderDelta[] = input.targets.map(
        (target, index) => {
          const encoded = new Uint16Array(input.tileSize * input.tileSize * 4);
          encoded.fill(0x3c00 + index + input.brushPlan.commandSequence);
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

function authority(
  overrides: Partial<ConstructorParameters<typeof StudioEngineTileAuthority>[0]> = {},
) {
  return new StudioEngineTileAuthority({
    documentId: "storage-doc",
    documentWidth: 8,
    documentHeight: 8,
    tileSize: 2,
    layerIds: ["ink"],
    sessionEpoch: 19,
    strokeEpoch: 7,
    shardBytes: BigInt(64),
    provider: provider(),
    ...overrides,
  });
}

async function committed(
  actor: StudioEngineTileAuthority,
  commandSequence = 1,
  dirtyRects: readonly {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }[] = [{ x: 0, y: 0, width: 4, height: 2 }],
  layerId = actor.deviceLossReplaySource().layers[0]!.layerId,
): Promise<Extract<StudioEngineTileCommitResult, { status: "committed" }>> {
  const result = await actor.commit({
    baseDocumentRevision: commandSequence - 1,
    baseLayerRevision: commandSequence - 1,
    layerId,
    dirtyRects,
    brushPlan: brushPlan(commandSequence),
  });
  if (result.status !== "committed") {
    throw new Error(`Expected committed result, received ${result.status}.`);
  }
  return result;
}

function source(
  actor: StudioEngineTileAuthority,
): StudioEngineTileStoragePayloadSource {
  return {
    readTile(tile) {
      return actor.readTile(tile.layerId, tile.column, tile.row);
    },
  };
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

function transport(
  commit: StudioEngineTileStorageTransport["commit"] = (request) =>
    exactAck(request),
): StudioEngineTileStorageTransport {
  return { commit };
}

describe("StudioEngineTileStorageBridge", () => {
  it("persists one exact WAL + full RGBA16F tile transaction and advances only after the exact ACK", async () => {
    const actor = authority();
    const result = await committed(actor);
    let captured: StudioEngineTileStorageCommitRequest | null = null;
    const send = vi.fn((request: StudioEngineTileStorageCommitRequest) => {
      captured = request;
      return exactAck(request);
    });
    const bridge = new StudioEngineTileStorageBridge({
      documentId: "storage-doc",
      sessionEpoch: 29,
      payloadSource: source(actor),
      transport: transport(send),
    });

    const durable = await bridge.persist(result);

    expect(durable).toMatchObject({
      disposition: "committed",
      transactionSequence: 1,
      durableRevision: 1,
      commandSequence: 1,
      documentRevision: 1,
      tileCount: 2,
    });
    expect(Object.isFrozen(durable)).toBe(true);
    expect(captured).not.toBeNull();
    expect(captured!.journal.data).not.toBe(result.journalBytes.buffer);
    expect(captured!.tiles).toHaveLength(2);
    expect(captured!.tiles.every((tile) =>
      tile.data.byteLength === tile.byteLength
      && studioEngineRgba16FloatTileDigest(tile.data) === tile.contentDigest
    )).toBe(true);
    expect(studioEngineTileStorageRequestTransfers(captured!)).toEqual([
      captured!.journal.data,
      captured!.tiles[0]!.data,
      captured!.tiles[1]!.data,
    ]);
    expect(bridge.stats()).toEqual({
      durableRevision: 1,
      documentRevision: 1,
      commandSequence: 1,
      transactionSequence: 1,
      journalByteLength: BigInt(result.receipt.journalByteLength),
      requestSequence: 1,
      durableReceiptCount: 1,
      retryRequired: false,
      disposed: false,
    });
  });

  it("returns the immutable cached receipt for an exact idempotent replay without re-reading or rewriting", async () => {
    const actor = authority();
    const result = await committed(actor);
    const readTile = vi.fn(source(actor).readTile);
    const send = vi.fn((request: StudioEngineTileStorageCommitRequest) =>
      exactAck(request));
    const bridge = new StudioEngineTileStorageBridge({
      documentId: "storage-doc",
      sessionEpoch: 29,
      payloadSource: { readTile },
      transport: transport(send),
    });

    const first = await bridge.persist(result);
    const replay = await bridge.persist(result);

    expect(replay).toBe(first);
    expect(send).toHaveBeenCalledTimes(1);
    expect(readTile).toHaveBeenCalledTimes(2);
  });

  it("keeps logical, shard, and journal offsets as BigInt beyond Number.MAX_SAFE_INTEGER", async () => {
    const layerIds = Array.from({ length: 4_096 }, (_, index) => `layer-${index}`);
    const actor = authority({
      documentWidth: 1_000_000,
      documentHeight: 1_000_000,
      tileSize: 1,
      layerIds,
      shardBytes: BigInt(1_048_576),
    });
    const result = await committed(
      actor,
      1,
      [{ x: 999_999, y: 999_999, width: 1, height: 1 }],
      layerIds[layerIds.length - 1]!,
    );
    let captured: StudioEngineTileStorageCommitRequest | null = null;
    const bridge = new StudioEngineTileStorageBridge({
      documentId: "storage-doc",
      sessionEpoch: 29,
      payloadSource: source(actor),
      transport: transport((request) => {
        captured = request;
        return exactAck(request);
      }),
    });

    await bridge.persist(result);

    const tile = captured!.tiles[0]!;
    expect(tile.logicalByteOffset).toBeGreaterThan(
      BigInt(Number.MAX_SAFE_INTEGER),
    );
    expect(typeof tile.logicalByteOffset).toBe("bigint");
    expect(tile.shardIndex * BigInt(1_048_576) + tile.shardByteOffset).toBe(
      tile.logicalByteOffset,
    );
  });

  it("fails closed on a torn ACK, blocks later commits, then accepts only the exact idempotent retry", async () => {
    const actor = authority();
    const first = await committed(actor, 1);
    let attempt = 0;
    const send = vi.fn((request: StudioEngineTileStorageCommitRequest) => {
      attempt += 1;
      const ack = exactAck(
        request,
        attempt === 1 ? "committed" : "idempotent-replay",
      );
      return attempt === 1
        ? { ...ack, tiles: ack.tiles.slice(0, -1) }
        : ack;
    });
    const bridge = new StudioEngineTileStorageBridge({
      documentId: "storage-doc",
      sessionEpoch: 29,
      payloadSource: source(actor),
      transport: transport(send),
    });

    await expect(bridge.persist(first)).rejects.toMatchObject({
      code: "ack-partial",
    });
    expect(bridge.stats().retryRequired).toBe(true);
    const second = await committed(actor, 2);
    await expect(bridge.persist(second)).rejects.toMatchObject({
      code: "retry-required",
    });
    expect(send).toHaveBeenCalledTimes(1);

    await expect(bridge.persist(first)).resolves.toMatchObject({
      disposition: "idempotent-replay",
      transactionSequence: 1,
    });
    await expect(bridge.persist(second)).resolves.toMatchObject({
      disposition: "idempotent-replay",
      transactionSequence: 2,
    });
    expect(bridge.stats()).toMatchObject({
      durableRevision: 2,
      transactionSequence: 2,
      retryRequired: false,
    });
  });

  it.each([
    {
      label: "duplicate tile ACK",
      code: "ack-duplicate",
      corrupt(ack: StudioEngineTileStorageCommitAck) {
        return { ...ack, tiles: [ack.tiles[0], ack.tiles[0]] };
      },
    },
    {
      label: "conflicting payload checksum",
      code: "ack-conflict",
      corrupt(ack: StudioEngineTileStorageCommitAck) {
        return {
          ...ack,
          journal: { ...ack.journal, payloadChecksum: "bytes-v1:conflict" },
        };
      },
    },
    {
      label: "malformed ACK",
      code: "ack-invalid",
      corrupt(ack: StudioEngineTileStorageCommitAck) {
        return { ...ack, durableRevision: "1" };
      },
    },
  ])("rejects a $label without advancing the durable frontier", async ({
    code,
    corrupt,
  }) => {
    const actor = authority();
    const result = await committed(actor);
    const bridge = new StudioEngineTileStorageBridge({
      documentId: "storage-doc",
      sessionEpoch: 29,
      payloadSource: source(actor),
      transport: transport((request) => corrupt(exactAck(request))),
    });

    await expect(bridge.persist(result)).rejects.toMatchObject({ code });
    expect(bridge.stats()).toMatchObject({
      durableRevision: 0,
      transactionSequence: 0,
      retryRequired: true,
    });
  });

  it("times out a stalled transport, ignores its late settlement, and permits only an exact replay", async () => {
    const actor = authority();
    const result = await committed(actor);
    let attempt = 0;
    const send = vi.fn((request: StudioEngineTileStorageCommitRequest) => {
      attempt += 1;
      return attempt === 1
        ? new Promise<never>(() => undefined)
        : exactAck(request, "idempotent-replay");
    });
    const bridge = new StudioEngineTileStorageBridge({
      documentId: "storage-doc",
      sessionEpoch: 29,
      payloadSource: source(actor),
      transport: transport(send),
      timeoutMs: 10,
    });

    await expect(bridge.persist(result)).rejects.toMatchObject({
      code: "timeout",
    });
    expect(bridge.stats()).toMatchObject({
      durableRevision: 0,
      retryRequired: true,
    });
    await expect(bridge.persist(result)).resolves.toMatchObject({
      disposition: "idempotent-replay",
      durableRevision: 1,
    });
  });

  it("honors pre-send cancellation without creating an ambiguous retry barrier", async () => {
    const actor = authority();
    const result = await committed(actor);
    const send = vi.fn((request: StudioEngineTileStorageCommitRequest) =>
      exactAck(request));
    const bridge = new StudioEngineTileStorageBridge({
      documentId: "storage-doc",
      sessionEpoch: 29,
      payloadSource: source(actor),
      transport: transport(send),
    });
    const controller = new AbortController();
    controller.abort("not needed");

    await expect(bridge.persist(result, {
      signal: controller.signal,
    })).rejects.toMatchObject({ code: "aborted" });
    expect(send).not.toHaveBeenCalled();
    expect(bridge.stats().retryRequired).toBe(false);
    await expect(bridge.persist(result)).resolves.toMatchObject({
      durableRevision: 1,
    });
  });

  it("aborts active persistence on dispose, closes the transport once, and rejects future work", async () => {
    const actor = authority();
    const result = await committed(actor);
    const transportDispose = vi.fn();
    const send = vi.fn((
      _request: StudioEngineTileStorageCommitRequest,
      options: Readonly<{ signal: AbortSignal }>,
    ) => new Promise<never>((_resolve, reject) => {
      options.signal.addEventListener(
        "abort",
        () => reject(options.signal.reason),
        { once: true },
      );
    }));
    const bridge = new StudioEngineTileStorageBridge({
      documentId: "storage-doc",
      sessionEpoch: 29,
      payloadSource: source(actor),
      transport: { commit: send, dispose: transportDispose },
    });

    const pending = bridge.persist(result);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    await bridge.dispose();

    await expect(pending).rejects.toBeInstanceOf(
      StudioEngineTileStorageBridgeError,
    );
    await expect(bridge.persist(result)).rejects.toMatchObject({
      code: "disposed",
    });
    expect(transportDispose).toHaveBeenCalledTimes(1);
    expect(bridge.stats().disposed).toBe(true);
  });

  it("re-digests authoritative tiles and never calls the transport for a mismatched payload", async () => {
    const actor = authority();
    const result = await committed(actor);
    const send = vi.fn();
    const bridge = new StudioEngineTileStorageBridge({
      documentId: "storage-doc",
      sessionEpoch: 29,
      payloadSource: {
        readTile(tile) {
          const value = actor.readTile(tile.layerId, tile.column, tile.row)!;
          new Uint16Array(value.encoded)[0] ^= 0xffff;
          return value;
        },
      },
      transport: transport(send),
    });

    await expect(bridge.persist(result)).rejects.toMatchObject({
      code: "invalid-tile-payload",
    });
    expect(send).not.toHaveBeenCalled();
    expect(bridge.stats().retryRequired).toBe(false);
  });

  it("rejects a non-canonical or tampered journal before reading tile payloads", async () => {
    const actor = authority();
    const result = await committed(actor);
    const journalBytes = Uint8Array.from(result.journalBytes);
    journalBytes[journalBytes.byteLength - 1] ^= 1;
    const readTile = vi.fn(source(actor).readTile);
    const bridge = new StudioEngineTileStorageBridge({
      documentId: "storage-doc",
      sessionEpoch: 29,
      payloadSource: { readTile },
      transport: transport(),
    });

    await expect(bridge.persist({
      ...result,
      journalBytes,
    })).rejects.toMatchObject({ code: "invalid-journal" });
    expect(readTile).not.toHaveBeenCalled();
  });

  it("rejects hostile receipt accessors without invoking them", async () => {
    const actor = authority();
    const result = await committed(actor);
    let getterCalls = 0;
    const hostile: Record<string, unknown> = {
      status: "committed",
      journalBytes: result.journalBytes,
    };
    Object.defineProperty(hostile, "receipt", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("must not execute");
      },
    });
    const bridge = new StudioEngineTileStorageBridge({
      documentId: "storage-doc",
      sessionEpoch: 29,
      payloadSource: source(actor),
      transport: transport(),
    });

    await expect(bridge.persist(hostile)).rejects.toMatchObject({
      code: "invalid-commit",
    });
    expect(getterCalls).toBe(0);
  });
});
