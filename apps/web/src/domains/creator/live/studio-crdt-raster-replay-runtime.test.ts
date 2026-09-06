import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { StudioCrdtDocument } from "./studio-crdt-document";
import {
  StudioRasterReplayRuntimeError,
  decodeStudioRasterPngInBrowser,
  replayStudioRasterCrdtPixels,
  type StudioRasterDecodedPng,
  type StudioRasterReplayRuntimeDependencies,
} from "./studio-crdt-raster-replay-runtime";

import type { StudioRasterCompactionCheckpoint } from "@/shared/lib/studio-crdt-raster-compaction";

import {
  STUDIO_RASTER_CRDT_VERSION,
  STUDIO_RASTER_KERNEL,
  type StudioRasterAssetReference,
  type StudioRasterOperation,
  type StudioRasterOperationLog,
  type StudioRasterSurfaceSpec,
} from "@/shared/lib/studio-crdt-raster-ops";

const SEMANTIC_HASH = "0".repeat(64);

function sha256Sync(bytes: Uint8Array | Uint8ClampedArray): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function sha256(bytes: Uint8Array, signal: AbortSignal): Promise<string> {
  if (signal.aborted) throw signal.reason;
  return sha256Sync(bytes);
}

function uuid(index: number): string {
  return `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < table.length; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[value] = crc >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.byteLength + 12);
  writeUint32(result, 0, data.byteLength);
  for (let index = 0; index < 4; index += 1) result[4 + index] = type.charCodeAt(index);
  result.set(data, 8);
  writeUint32(result, 8 + data.byteLength, crc32(result.subarray(4, 8 + data.byteLength)));
  return result;
}

interface FixturePngOptions {
  readonly bitDepth?: number;
  readonly colorType?: number;
  readonly compression?: number;
  readonly filter?: number;
  readonly interlace?: number;
  readonly chunksAfterHeader?: readonly Uint8Array[];
}

function fixturePng(
  width: number,
  height: number,
  marker: number,
  options: FixturePngOptions = {}
): Uint8Array {
  const signature = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  const ihdr = new Uint8Array(13);
  writeUint32(ihdr, 0, width);
  writeUint32(ihdr, 4, height);
  ihdr.set([
    options.bitDepth ?? 8,
    options.colorType ?? 6,
    options.compression ?? 0,
    options.filter ?? 0,
    options.interlace ?? 0,
  ], 8);
  const chunks = [
    pngChunk("IHDR", ihdr),
    ...(options.chunksAfterHeader ?? [
      // A valid two-byte zlib header is enough for envelope tests. The injected decoder owns full
      // stream decoding, while production createImageBitmap rejects an invalid compressed body.
      pngChunk("IDAT", Uint8Array.of(0x78, 0x01, marker)),
      pngChunk("IEND", new Uint8Array()),
    ]),
  ];
  const byteLength = signature.byteLength + chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(byteLength);
  let offset = 0;
  result.set(signature, offset);
  offset += signature.byteLength;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function solid(width: number, height: number, rgba: readonly [number, number, number, number]): Uint8ClampedArray {
  const result = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < result.byteLength; offset += 4) result.set(rgba, offset);
  return result;
}

interface FixtureAsset {
  readonly reference: StudioRasterAssetReference;
  readonly bytes: Uint8Array;
  readonly rgba: Uint8ClampedArray;
}

function fixtureAsset(
  name: string,
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
  marker: number,
  pngOptions: FixturePngOptions = {}
): FixtureAsset {
  const bytes = fixturePng(width, height, marker, pngOptions);
  return {
    reference: {
      scope: "work",
      assetId: `asset-${name}`,
      sha256: sha256Sync(bytes),
      byteLength: bytes.byteLength,
      mediaType: "image/png",
      width,
      height,
    },
    bytes,
    rgba,
  };
}

function surface(overrides: Partial<StudioRasterSurfaceSpec> = {}): StudioRasterSurfaceSpec {
  return {
    version: STUDIO_RASTER_CRDT_VERSION,
    surfaceId: "surface-main",
    width: 128,
    height: 128,
    tileSize: 128,
    ...overrides,
  };
}

function operation(input: {
  index: number;
  clock: string;
  actor?: string;
  intent?: StudioRasterOperation["intent"];
  patches: StudioRasterOperation["patches"];
}): StudioRasterOperation {
  return {
    version: STUDIO_RASTER_CRDT_VERSION,
    operationId: uuid(input.index),
    order: { logicalClock: input.clock, actorId: input.actor ?? "actor-a" },
    pageId: "page-1",
    layerId: "layer-1",
    intent: input.intent ?? "paint",
    kernel: STUDIO_RASTER_KERNEL,
    semanticParametersSha256: SEMANTIC_HASH,
    patches: input.patches,
  };
}

function log(
  rasterSurface: StudioRasterSurfaceSpec,
  operations: readonly StudioRasterOperation[],
  overrides: Partial<Pick<StudioRasterOperationLog, "undoOperations" | "undoAcknowledgements">> = {}
): StudioRasterOperationLog {
  return {
    version: STUDIO_RASTER_CRDT_VERSION,
    surface: rasterSurface,
    operations,
    undoOperations: overrides.undoOperations ?? [],
    undoAcknowledgements: overrides.undoAcknowledgements ?? [],
  };
}

function compositePatch(
  asset: FixtureAsset,
  input: Partial<{
    tileX: number;
    tileY: number;
    x: number;
    y: number;
    blendMode: "source-over" | "destination-out";
    selectionMask: StudioRasterAssetReference;
  }> = {}
): StudioRasterOperation["patches"][number] {
  return {
    tileX: input.tileX ?? 0,
    tileY: input.tileY ?? 0,
    region: {
      x: input.x ?? 0,
      y: input.y ?? 0,
      width: asset.reference.width,
      height: asset.reference.height,
    },
    effect: {
      kind: "composite",
      blendMode: input.blendMode ?? "source-over",
      payload: asset.reference,
    },
    ...(input.selectionMask ? { selectionMask: input.selectionMask } : {}),
  };
}

function replacePatch(
  asset: FixtureAsset,
  tileX: number,
  baseTileSha256: string
): StudioRasterOperation["patches"][number] {
  return {
    tileX,
    tileY: 0,
    region: { x: 0, y: 0, width: asset.reference.width, height: asset.reference.height },
    effect: { kind: "replace", baseTileSha256, payload: asset.reference },
  };
}

function fixtureDependencies(
  assets: readonly FixtureAsset[],
  overrides: Partial<StudioRasterReplayRuntimeDependencies> = {}
): StudioRasterReplayRuntimeDependencies {
  const byId = new Map(assets.map((asset) => [asset.reference.assetId, asset]));
  return {
    download: async (reference, signal) => {
      if (signal.aborted) throw signal.reason;
      const asset = byId.get(reference.assetId);
      if (!asset) throw new Error(`missing ${reference.assetId}`);
      return Uint8Array.from(asset.bytes);
    },
    decode: async (_bytes, reference, signal): Promise<StudioRasterDecodedPng> => {
      if (signal.aborted) throw signal.reason;
      const asset = byId.get(reference.assetId);
      if (!asset) throw new Error(`missing ${reference.assetId}`);
      return { width: reference.width, height: reference.height, rgba: asset.rgba };
    },
    sha256,
    ...overrides,
  };
}

describe("studio raster CRDT replay runtime", () => {
  it("converges concurrent operations by Lamport/actor/event order regardless of input order", async () => {
    const red = fixtureAsset("red", 1, 1, solid(1, 1, [255, 0, 0, 128]), 1);
    const blue = fixtureAsset("blue", 1, 1, solid(1, 1, [0, 0, 255, 128]), 2);
    const redOperation = operation({
      index: 2,
      clock: "7",
      actor: "actor-z",
      patches: [compositePatch(red)],
    });
    const blueOperation = operation({
      index: 1,
      clock: "7",
      actor: "actor-a",
      patches: [compositePatch(blue)],
    });
    const dependencies = fixtureDependencies([red, blue]);

    const [first, second] = await Promise.all([
      replayStudioRasterCrdtPixels(
        { workId: "work-1", log: log(surface(), [redOperation, blueOperation]) },
        dependencies
      ),
      replayStudioRasterCrdtPixels(
        { workId: "work-1", log: log(surface(), [blueOperation, redOperation]) },
        dependencies
      ),
    ]);

    expect(first.appliedOperationIds).toEqual([blueOperation.operationId, redOperation.operationId]);
    expect(second.appliedOperationIds).toEqual(first.appliedOperationIds);
    expect(second.tiles[0]!.sha256).toBe(first.tiles[0]!.sha256);
    expect([...second.tiles[0]!.copyRgba().slice(0, 4)]).toEqual(
      [...first.tiles[0]!.copyRgba().slice(0, 4)]
    );
  });

  it("roundtrips a sparse checkpoint and deterministically merges the concurrent tail", async () => {
    const base = fixtureAsset(
      "checkpoint-base",
      128,
      128,
      solid(128, 128, [210, 30, 20, 255]),
      20
    );
    const blue = fixtureAsset("checkpoint-blue", 1, 1, solid(1, 1, [0, 40, 255, 128]), 21);
    const eraser = fixtureAsset("checkpoint-eraser", 1, 1, solid(1, 1, [0, 0, 0, 128]), 22);
    const baseOperation = operation({
      index: 21,
      clock: "1",
      actor: "actor-seoul",
      patches: [compositePatch(base)],
    });
    const concurrentPaint = operation({
      index: 22,
      clock: "2",
      actor: "actor-busan",
      patches: [compositePatch(blue)],
    });
    const concurrentErase = operation({
      index: 23,
      clock: "2",
      actor: "actor-seoul",
      intent: "erase",
      patches: [compositePatch(eraser, { blendMode: "destination-out" })],
    });
    const checkpoint: StudioRasterCompactionCheckpoint = {
      version: STUDIO_RASTER_CRDT_VERSION,
      checkpointId: uuid(24),
      proofId: uuid(25),
      surface: surface(),
      through: { ...baseOperation.order, eventId: baseOperation.operationId },
      tileManifestSha256: "e".repeat(64),
      tiles: [{ tileX: 0, tileY: 0, asset: base.reference }],
      sealedOperationIds: [baseOperation.operationId],
      sealedUndoOperationIds: [],
      sealedUndoAcknowledgementIds: [],
    };
    const dependencies = fixtureDependencies([base, blue, eraser]);

    const fromOrigin = await replayStudioRasterCrdtPixels({
      workId: "work-checkpoint",
      log: log(surface(), [concurrentErase, baseOperation, concurrentPaint]),
    }, dependencies);
    const restoredCheckpoint = JSON.parse(JSON.stringify(checkpoint)) as StudioRasterCompactionCheckpoint;
    const restoredTail = JSON.parse(JSON.stringify(
      log(surface(), [concurrentErase, concurrentPaint])
    )) as StudioRasterOperationLog;
    const fromCheckpoint = await replayStudioRasterCrdtPixels({
      workId: "work-checkpoint",
      checkpoint: restoredCheckpoint,
      log: restoredTail,
    }, dependencies);
    const oppositeArrival = await replayStudioRasterCrdtPixels({
      workId: "work-checkpoint",
      checkpoint: restoredCheckpoint,
      log: log(surface(), [concurrentPaint, concurrentErase]),
    }, dependencies);

    expect(fromCheckpoint.checkpointId).toBe(checkpoint.checkpointId);
    expect(fromCheckpoint.appliedOperationIds).toEqual([
      concurrentPaint.operationId,
      concurrentErase.operationId,
    ]);
    expect(oppositeArrival.appliedOperationIds).toEqual(fromCheckpoint.appliedOperationIds);
    expect(fromCheckpoint.tiles[0]!.sha256).toBe(fromOrigin.tiles[0]!.sha256);
    expect(oppositeArrival.tiles[0]!.sha256).toBe(fromCheckpoint.tiles[0]!.sha256);
    expect([...fromCheckpoint.tiles[0]!.copyRgba().slice(0, 4)])
      .toEqual([...fromOrigin.tiles[0]!.copyRgba().slice(0, 4)]);
    expect(fromCheckpoint.tiles[0]!.copyRgba()[3]).toBe(127);
  });

  it("keeps overlapping pixel strokes idempotent across reconnect updates and a full snapshot", async () => {
    const red = fixtureAsset("reconnect-red", 1, 1, solid(1, 1, [255, 0, 0, 160]), 23);
    const blue = fixtureAsset("reconnect-blue", 1, 1, solid(1, 1, [0, 0, 255, 160]), 24);
    const eraser = fixtureAsset("reconnect-eraser", 1, 1, solid(1, 1, [0, 0, 0, 64]), 25);
    const redOperation = operation({
      index: 26,
      clock: "7",
      actor: "actor-z",
      patches: [compositePatch(red)],
    });
    const blueOperation = operation({
      index: 27,
      clock: "7",
      actor: "actor-a",
      patches: [compositePatch(blue)],
    });
    const eraseOperation = operation({
      index: 28,
      clock: "8",
      actor: "actor-c",
      intent: "erase",
      patches: [compositePatch(eraser, { blendMode: "destination-out" })],
    });
    const left = new StudioCrdtDocument();
    const right = new StudioCrdtDocument();
    const restored = new StudioCrdtDocument();

    try {
      left.mergeRasterOperationLog(log(surface(), [redOperation]));
      right.mergeRasterOperationLog(log(surface(), [blueOperation]));
      const leftUpdate = left.encodeStateAsUpdate();
      const rightUpdate = right.encodeStateAsUpdate();
      left.applyUpdate(rightUpdate);
      right.applyUpdate(leftUpdate);
      left.applyUpdate(rightUpdate);
      right.applyUpdate(leftUpdate);

      const fullSnapshot = left.encodeStateAsUpdate();
      restored.applyUpdate(fullSnapshot);
      restored.applyUpdate(fullSnapshot);
      restored.mergeRasterOperationLog(log(surface(), [eraseOperation]));
      const reconnectDelta = restored.encodeStateAsUpdate(left.encodeStateVector());
      left.applyUpdate(reconnectDelta);
      left.applyUpdate(reconnectDelta);

      const leftLog = left.getRasterOperationLog(surface().surfaceId)!;
      const restoredLog = restored.getRasterOperationLog(surface().surfaceId)!;
      expect(leftLog).toEqual(restoredLog);
      expect(leftLog.operations.map(({ operationId }) => operationId)).toEqual([
        blueOperation.operationId,
        redOperation.operationId,
        eraseOperation.operationId,
      ]);

      const dependencies = fixtureDependencies([red, blue, eraser]);
      const [leftPixels, restoredPixels] = await Promise.all([
        replayStudioRasterCrdtPixels({ workId: "work-reconnect", log: leftLog }, dependencies),
        replayStudioRasterCrdtPixels({ workId: "work-reconnect", log: restoredLog }, dependencies),
      ]);
      expect(leftPixels.appliedOperationIds).toEqual([
        blueOperation.operationId,
        redOperation.operationId,
        eraseOperation.operationId,
      ]);
      expect(leftPixels.tiles[0]!.sha256).toBe(restoredPixels.tiles[0]!.sha256);
      expect([...leftPixels.tiles[0]!.copyRgba().slice(0, 4)])
        .toEqual([...restoredPixels.tiles[0]!.copyRgba().slice(0, 4)]);
      expect(leftPixels.tiles[0]!.copyRgba()[3]).toBeLessThan(255);
    } finally {
      left.destroy();
      right.destroy();
      restored.destroy();
    }
  });

  it("composites destination-out with exact straight-alpha rounding", async () => {
    const red = fixtureAsset("erase-red", 1, 1, solid(1, 1, [220, 40, 10, 255]), 3);
    const eraser = fixtureAsset("eraser", 1, 1, solid(1, 1, [99, 88, 77, 128]), 4);
    const paint = operation({ index: 3, clock: "1", patches: [compositePatch(red)] });
    const erase = operation({
      index: 4,
      clock: "2",
      intent: "erase",
      patches: [compositePatch(eraser, { blendMode: "destination-out" })],
    });

    const result = await replayStudioRasterCrdtPixels(
      { workId: "work-1", log: log(surface(), [erase, paint]) },
      fixtureDependencies([red, eraser])
    );

    expect([...result.tiles[0]!.copyRgba().slice(0, 4)]).toEqual([220, 40, 10, 127]);
  });

  it("honors observed-remove undo and restores only an explicitly acknowledged undo", async () => {
    const paintAsset = fixtureAsset("undo-paint", 1, 1, solid(1, 1, [1, 2, 3, 255]), 5);
    const paint = operation({ index: 5, clock: "1", patches: [compositePatch(paintAsset)] });
    const undo = {
      version: STUDIO_RASTER_CRDT_VERSION,
      undoOperationId: uuid(6),
      targetOperationId: paint.operationId,
      order: { logicalClock: "2", actorId: "actor-a" },
    } as const;
    const acknowledgement = {
      version: STUDIO_RASTER_CRDT_VERSION,
      acknowledgementId: uuid(7),
      undoOperationId: undo.undoOperationId,
      targetOperationId: paint.operationId,
      order: { logicalClock: "3", actorId: "actor-a" },
    } as const;
    const download = vi.fn(async () => Uint8Array.from(paintAsset.bytes));

    const undone = await replayStudioRasterCrdtPixels(
      {
        workId: "work-1",
        log: log(surface(), [paint], { undoOperations: [undo] }),
      },
      fixtureDependencies([paintAsset], { download })
    );
    expect(undone.undoneOperationIds).toEqual([paint.operationId]);
    expect([...undone.tiles[0]!.copyRgba().slice(0, 4)]).toEqual([0, 0, 0, 0]);
    expect(download).not.toHaveBeenCalled();

    const restored = await replayStudioRasterCrdtPixels(
      {
        workId: "work-1",
        log: log(surface(), [paint], {
          undoOperations: [undo],
          undoAcknowledgements: [acknowledgement],
        }),
      },
      fixtureDependencies([paintAsset])
    );
    expect(restored.undoneOperationIds).toEqual([]);
    expect([...restored.tiles[0]!.copyRgba().slice(0, 4)]).toEqual([1, 2, 3, 255]);
  });

  it("multiplies composite source alpha by the normalized selection mask", async () => {
    const source = fixtureAsset("selected-source", 1, 1, solid(1, 1, [10, 80, 240, 255]), 6);
    const mask = fixtureAsset("selection-mask", 1, 1, solid(1, 1, [0, 0, 0, 128]), 7);
    const selected = operation({
      index: 8,
      clock: "1",
      intent: "selection-fill",
      patches: [compositePatch(source, { selectionMask: mask.reference })],
    });

    const result = await replayStudioRasterCrdtPixels(
      { workId: "work-1", log: log(surface(), [selected]) },
      fixtureDependencies([source, mask])
    );

    expect([...result.tiles[0]!.copyRgba().slice(0, 4)]).toEqual([10, 80, 240, 128]);
  });

  it("skips a multi-tile replace atomically when an off-screen base hash conflicts", async () => {
    const red = fixtureAsset("atomic-red", 128, 128, solid(128, 128, [200, 0, 0, 255]), 8);
    const green = fixtureAsset("atomic-green", 128, 128, solid(128, 128, [0, 200, 0, 255]), 9);
    const baseSha = sha256Sync(red.rgba);
    const initial = operation({
      index: 9,
      clock: "1",
      patches: [
        compositePatch(red, { tileX: 0 }),
        compositePatch(red, { tileX: 1 }),
      ],
    });
    const conditional = operation({
      index: 10,
      clock: "2",
      intent: "filter",
      patches: [
        replacePatch(green, 0, baseSha),
        replacePatch(green, 1, "f".repeat(64)),
      ],
    });

    const result = await replayStudioRasterCrdtPixels(
      {
        workId: "work-1",
        log: log(surface({ width: 256 }), [conditional, initial]),
        visibleTileFilter: ({ tileX }) => tileX === 0,
      },
      fixtureDependencies([red, green])
    );

    expect(result.tiles).toHaveLength(1);
    expect(result.conflictedOperationIds).toEqual([conditional.operationId]);
    expect(result.appliedOperationIds).toEqual([initial.operationId]);
    expect([...result.tiles[0]!.copyRgba().slice(0, 4)]).toEqual([200, 0, 0, 255]);
  });

  it("applies a conditional replacement after hashing the complete raw tile", async () => {
    const replacement = fixtureAsset("replace-success", 1, 1, solid(1, 1, [7, 8, 9, 0]), 15);
    const transparentTileSha = sha256Sync(new Uint8ClampedArray(128 * 128 * 4));
    const conditional = operation({
      index: 16,
      clock: "1",
      intent: "filter",
      patches: [replacePatch(replacement, 0, transparentTileSha)],
    });

    const result = await replayStudioRasterCrdtPixels(
      { workId: "work-1", log: log(surface(), [conditional]) },
      fixtureDependencies([replacement])
    );

    expect(result.conflictedOperationIds).toEqual([]);
    expect(result.appliedOperationIds).toEqual([conditional.operationId]);
    // Direct replace preserves straight RGBA bytes, including RGB carried by a transparent pixel.
    expect([...result.tiles[0]!.copyRgba().slice(0, 4)]).toEqual([7, 8, 9, 0]);
  });

  it("downloads and decodes one content-addressed asset only once", async () => {
    const shared = fixtureAsset("deduped", 1, 1, solid(1, 1, [4, 5, 6, 255]), 10);
    const first = operation({ index: 11, clock: "1", patches: [compositePatch(shared)] });
    const second = operation({
      index: 12,
      clock: "2",
      patches: [compositePatch(shared, { x: 1 })],
    });
    const base = fixtureDependencies([shared]);
    const download = vi.fn(base.download);
    const decode = vi.fn(base.decode!);

    const result = await replayStudioRasterCrdtPixels(
      { workId: "work-1", log: log(surface(), [first, second]) },
      { ...base, download, decode }
    );

    expect(result.appliedPatchCount).toBe(2);
    expect(download).toHaveBeenCalledTimes(1);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("fails closed on asset failure and on abort without returning a partial frame", async () => {
    const firstAsset = fixtureAsset("failure-first", 1, 1, solid(1, 1, [1, 0, 0, 255]), 11);
    const secondAsset = fixtureAsset("failure-second", 1, 1, solid(1, 1, [0, 1, 0, 255]), 12);
    const rasterLog = log(surface(), [
      operation({ index: 13, clock: "1", patches: [compositePatch(firstAsset)] }),
      operation({ index: 14, clock: "2", patches: [compositePatch(secondAsset, { x: 1 })] }),
    ]);
    let leakedResult: unknown;
    await expect(
      replayStudioRasterCrdtPixels(
        { workId: "work-1", log: rasterLog, concurrency: 1 },
        fixtureDependencies([firstAsset, secondAsset], {
          download: async (reference) => {
            if (reference.assetId === secondAsset.reference.assetId) throw new Error("missing");
            return Uint8Array.from(firstAsset.bytes);
          },
        })
      ).then((result) => {
        leakedResult = result;
      })
    ).rejects.toMatchObject({ code: "asset_download_failed" });
    expect(leakedResult).toBeUndefined();

    const controller = new AbortController();
    const abortReason = new DOMException("stop", "AbortError");
    controller.abort(abortReason);
    const download = vi.fn();
    await expect(
      replayStudioRasterCrdtPixels(
        { workId: "work-1", log: rasterLog, signal: controller.signal },
        fixtureDependencies([firstAsset, secondAsset], { download })
      )
    ).rejects.toBe(abortReason);
    expect(download).not.toHaveBeenCalled();
  });

  it("returns exact edge-tile dimensions and guards frame buffers from caller mutation", async () => {
    const result = await replayStudioRasterCrdtPixels(
      {
        workId: "work-1",
        log: log(surface({ width: 130, height: 129 }), []),
      },
      fixtureDependencies([])
    );

    expect(result.tiles.map(({ tileX, tileY, width, height, byteLength }) => ({
      tileX,
      tileY,
      width,
      height,
      byteLength,
    }))).toEqual([
      { tileX: 0, tileY: 0, width: 128, height: 128, byteLength: 128 * 128 * 4 },
      { tileX: 1, tileY: 0, width: 2, height: 128, byteLength: 2 * 128 * 4 },
      { tileX: 0, tileY: 1, width: 128, height: 1, byteLength: 128 * 4 },
      { tileX: 1, tileY: 1, width: 2, height: 1, byteLength: 8 },
    ]);
    const firstRead = result.tiles[0]!.rgba;
    firstRead[0] = 255;
    expect(result.tiles[0]!.copyRgba()[0]).toBe(0);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.tiles)).toBe(true);
    expect(Object.isFrozen(result.tiles[0])).toBe(true);
  });

  it("rejects malformed decoded RGBA before replay begins", async () => {
    const asset = fixtureAsset("malformed-decode", 1, 1, solid(1, 1, [1, 2, 3, 4]), 13);
    const rasterLog = log(surface(), [
      operation({ index: 15, clock: "1", patches: [compositePatch(asset)] }),
    ]);

    await expect(replayStudioRasterCrdtPixels(
      { workId: "work-1", log: rasterLog },
      fixtureDependencies([asset], {
        decode: async () => ({ width: 1, height: 1, rgba: new Uint8ClampedArray(3) }),
      })
    )).rejects.toMatchObject({ code: "decoded_rgba_length_mismatch" });
  });

  it("rejects a content-addressed PNG with a corrupt chunk CRC before decode", async () => {
    const asset = fixtureAsset("bad-crc", 1, 1, solid(1, 1, [1, 2, 3, 4]), 16);
    const corrupted = Uint8Array.from(asset.bytes);
    corrupted[corrupted.byteLength - 1] ^= 0xff;
    const corruptedAsset: FixtureAsset = {
      ...asset,
      bytes: corrupted,
      reference: {
        ...asset.reference,
        sha256: sha256Sync(corrupted),
      },
    };
    const decode = vi.fn();

    await expect(replayStudioRasterCrdtPixels(
      {
        workId: "work-1",
        log: log(surface(), [
          operation({ index: 17, clock: "1", patches: [compositePatch(corruptedAsset)] }),
        ]),
      },
      fixtureDependencies([corruptedAsset], { decode })
    )).rejects.toMatchObject({ code: "invalid_png_crc" });
    expect(decode).not.toHaveBeenCalled();
  });

  it.each([
    ["16-bit RGBA", { bitDepth: 16 }],
    ["palette", { colorType: 3 }],
    ["interlaced", { interlace: 1 }],
    ["RGB without alpha", { colorType: 2 }],
    ["nonstandard compression", { compression: 1 }],
    ["nonstandard filter method", { filter: 1 }],
  ] satisfies readonly (readonly [string, FixturePngOptions])[])(
    "rejects the %s PNG profile admitted by neither storage nor replay",
    async (_label, pngOptions) => {
      const asset = fixtureAsset(
        `profile-${Object.values(pngOptions).join("-")}`,
        1,
        1,
        solid(1, 1, [1, 2, 3, 4]),
        17,
        pngOptions
      );
      const decode = vi.fn();

      await expect(replayStudioRasterCrdtPixels(
        {
          workId: "work-1",
          log: log(surface(), [
            operation({ index: 18, clock: "1", patches: [compositePatch(asset)] }),
          ]),
        },
        fixtureDependencies([asset], { decode })
      )).rejects.toMatchObject({ code: "unsupported_png_profile" });
      expect(decode).not.toHaveBeenCalled();
    }
  );

  it("loads legacy WebP metadata but explicitly rejects unsupported replay decoding", async () => {
    const png = fixtureAsset("declared-webp", 1, 1, solid(1, 1, [1, 2, 3, 4]), 18);
    const webp: FixtureAsset = {
      ...png,
      reference: {
        ...png.reference,
        mediaType: "image/webp",
      } as unknown as StudioRasterAssetReference,
    };
    const download = vi.fn();

    await expect(replayStudioRasterCrdtPixels(
      {
        workId: "work-1",
        log: log(surface(), [
          operation({ index: 19, clock: "1", patches: [compositePatch(webp)] }),
        ]),
      },
      fixtureDependencies([webp], { download })
    )).rejects.toMatchObject({ code: "unsupported_media_type" });
    expect(download).not.toHaveBeenCalled();
  });

  it.each([
    [
      "reserved chunk-type bit",
      [
        pngChunk("ABcD", Uint8Array.of(1)),
        pngChunk("IDAT", Uint8Array.of(0x78, 0x01, 1)),
        pngChunk("IEND", new Uint8Array()),
      ],
      "invalid_png_chunk_type",
    ],
    [
      "unknown critical chunk",
      [
        pngChunk("ABCD", Uint8Array.of(1)),
        pngChunk("IDAT", Uint8Array.of(0x78, 0x01, 1)),
        pngChunk("IEND", new Uint8Array()),
      ],
      "unsupported_png_critical_chunk",
    ],
    [
      "empty IDAT",
      [pngChunk("IDAT", new Uint8Array()), pngChunk("IEND", new Uint8Array())],
      "invalid_png_idat_sequence",
    ],
    [
      "non-contiguous IDAT",
      [
        pngChunk("IDAT", Uint8Array.of(0x78, 0x01)),
        pngChunk("tEXt", Uint8Array.of(1)),
        pngChunk("IDAT", Uint8Array.of(2)),
        pngChunk("IEND", new Uint8Array()),
      ],
      "invalid_png_idat_sequence",
    ],
  ] satisfies readonly (readonly [string, readonly Uint8Array[], string])[])(
    "fails closed on a PNG with %s",
    async (_label, chunksAfterHeader, expectedCode) => {
      const asset = fixtureAsset(
        `structure-${expectedCode}`,
        1,
        1,
        solid(1, 1, [1, 2, 3, 4]),
        19,
        { chunksAfterHeader }
      );
      const decode = vi.fn();

      await expect(replayStudioRasterCrdtPixels(
        {
          workId: "work-1",
          log: log(surface(), [
            operation({ index: 20, clock: "1", patches: [compositePatch(asset)] }),
          ]),
        },
        fixtureDependencies([asset], { decode })
      )).rejects.toMatchObject({ code: expectedCode });
      expect(decode).not.toHaveBeenCalled();
    }
  );

  it("browser decoder uses a bounded canvas, requests unpremultiplied decode and closes bitmap", async () => {
    const asset = fixtureAsset("browser", 1, 1, solid(1, 1, [9, 8, 7, 6]), 14);
    const close = vi.fn();
    const createImageBitmap = vi.fn(async () => ({ width: 1, height: 1, close } as unknown as ImageBitmap));
    const context = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: Uint8ClampedArray.of(9, 8, 7, 6) })),
    };
    const createOffscreenCanvas = vi.fn(() => ({
      getContext: vi.fn(() => context),
    } as unknown as OffscreenCanvas));

    const decoded = await decodeStudioRasterPngInBrowser(
      asset.bytes,
      asset.reference,
      new AbortController().signal,
      { createImageBitmap, createOffscreenCanvas }
    );

    expect(createImageBitmap).toHaveBeenCalledWith(expect.any(Blob), {
      imageOrientation: "none",
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    });
    expect(createOffscreenCanvas).toHaveBeenCalledWith(1, 1);
    expect([...decoded.rgba]).toEqual([9, 8, 7, 6]);
    expect(close).toHaveBeenCalledOnce();
  });

  it("enforces the resident memory bound before invoking the downloader", async () => {
    const download = vi.fn();
    await expect(replayStudioRasterCrdtPixels(
      {
        workId: "work-1",
        log: log(surface(), []),
        maxResidentBytes: 1,
      },
      { download, sha256 }
    )).rejects.toBeInstanceOf(StudioRasterReplayRuntimeError);
    expect(download).not.toHaveBeenCalled();
  });
});
