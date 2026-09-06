import { describe, expect, it } from "vitest";

import {
  compactStudioRasterOperationLog,
  type StudioRasterCompactionInput,
  type StudioRasterCompactionOrderKey,
} from "./studio-crdt-raster-compaction";
import {
  STUDIO_RASTER_CRDT_VERSION,
  STUDIO_RASTER_KERNEL,
  type StudioRasterAssetReference,
  type StudioRasterOperation,
  type StudioRasterOperationLog,
  type StudioRasterUndoAcknowledgement,
  type StudioRasterUndoOperation,
} from "./studio-crdt-raster-ops";

const sha = (character: string) => character.repeat(64);
const uuid = (value: number) => `10000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const surface = {
  version: STUDIO_RASTER_CRDT_VERSION,
  surfaceId: "surface-main",
  width: 300,
  height: 260,
  tileSize: 128,
} as const;

function asset(id: string, width = 128, height = 128): StudioRasterAssetReference {
  return {
    scope: "work",
    assetId: id,
    sha256: sha("a"),
    byteLength: 2_048,
    mediaType: "image/png",
    width,
    height,
  };
}

function operation(id: number, clock: string): StudioRasterOperation {
  return {
    version: STUDIO_RASTER_CRDT_VERSION,
    operationId: uuid(id),
    order: { logicalClock: clock, actorId: "artist-a" },
    pageId: "page-1",
    layerId: "layer-ink",
    intent: "paint",
    kernel: STUDIO_RASTER_KERNEL,
    semanticParametersSha256: sha("b"),
    patches: [{
      tileX: 0,
      tileY: 0,
      region: { x: 0, y: 0, width: 16, height: 16 },
      effect: {
        kind: "composite",
        blendMode: "source-over",
        payload: { ...asset(`patch-${id}`, 16, 16), sha256: sha("c") },
      },
    }],
  };
}

function log(input: {
  operations: readonly StudioRasterOperation[];
  undoOperations?: readonly StudioRasterUndoOperation[];
  undoAcknowledgements?: readonly StudioRasterUndoAcknowledgement[];
}): StudioRasterOperationLog {
  return {
    version: STUDIO_RASTER_CRDT_VERSION,
    surface,
    operations: input.operations,
    undoOperations: input.undoOperations ?? [],
    undoAcknowledgements: input.undoAcknowledgements ?? [],
  };
}

function key(
  event: StudioRasterOperation | StudioRasterUndoOperation | StudioRasterUndoAcknowledgement
): StudioRasterCompactionOrderKey {
  const eventId = "operationId" in event
    ? event.operationId
    : "undoOperationId" in event && !Object.hasOwn(event, "acknowledgementId")
      ? event.undoOperationId
      : (event as StudioRasterUndoAcknowledgement).acknowledgementId;
  return { ...event.order, eventId };
}

function input(through: StudioRasterCompactionOrderKey): StudioRasterCompactionInput {
  return {
    checkpointId: uuid(900),
    through,
    requiredReplicaIds: ["node-seoul", "node-busan"],
    stabilityProof: {
      version: STUDIO_RASTER_CRDT_VERSION,
      proofId: uuid(901),
      undoHorizonClosedThrough: through,
      replicaFrontiers: [
        { replicaId: "node-seoul", through },
        { replicaId: "node-busan", through },
      ],
    },
    tileManifestSha256: sha("d"),
    tiles: [
      { tileX: 2, tileY: 2, asset: asset("snapshot-edge", 44, 4) },
      { tileX: 0, tileY: 0, asset: asset("snapshot-origin") },
    ],
  };
}

type DeepMutable<T> = T extends readonly (infer TItem)[]
  ? DeepMutable<TItem>[]
  : T extends object
    ? { -readonly [TKey in keyof T]: DeepMutable<T[TKey]> }
    : T;

function clone<T>(value: T): DeepMutable<T> {
  return JSON.parse(JSON.stringify(value)) as DeepMutable<T>;
}

describe("semantic raster CRDT compaction", () => {
  it("seals a replica-stable prefix and returns a valid deterministically sorted suffix", () => {
    const first = operation(1, "1");
    const second = operation(2, "5");

    const result = compactStudioRasterOperationLog(
      log({ operations: [second, first] }),
      input(key(first))
    );

    expect(result.checkpoint.sealedOperationIds).toEqual([first.operationId]);
    expect(result.checkpoint.tiles.map((tile) => `${tile.tileX}:${tile.tileY}`)).toEqual(["0:0", "2:2"]);
    expect(result.tail.operations.map((entry) => entry.operationId)).toEqual([second.operationId]);
    expect(Object.isFrozen(result.checkpoint.tiles)).toBe(true);
    expect(Object.isFrozen(result.tail)).toBe(true);
  });

  it("requires every trusted replica frontier to reach the exact closed undo horizon", () => {
    const first = operation(1, "1");
    const second = operation(2, "5");
    const missing = clone(input(key(first)));
    missing.stabilityProof.replicaFrontiers = missing.stabilityProof.replicaFrontiers.slice(0, 1);
    expect(() => compactStudioRasterOperationLog(log({ operations: [first, second] }), missing))
      .toThrow(/node-busan/u);

    const behind = clone(input(key(second)));
    behind.stabilityProof.replicaFrontiers[1] = {
      replicaId: "node-busan",
      through: key(first),
    };
    expect(() => compactStudioRasterOperationLog(log({ operations: [first, second] }), behind))
      .toThrow(/도달하지/u);

    const horizonMismatch = clone(input(key(first)));
    horizonMismatch.stabilityProof.undoHorizonClosedThrough = key(second);
    expect(() => compactStudioRasterOperationLog(log({ operations: [first, second] }), horizonMismatch))
      .toThrow(/종료 경계/u);
  });

  it("refuses a frontier that does not identify an event in the immutable log", () => {
    const first = operation(1, "1");
    const unknown = { ...key(first), eventId: uuid(777) };

    expect(() => compactStudioRasterOperationLog(log({ operations: [first] }), input(unknown)))
      .toThrow(/실제 이벤트/u);
  });

  it("does not compact across a later undo targeting a sealed operation", () => {
    const first = operation(1, "1");
    const second = operation(2, "4");
    const undo: StudioRasterUndoOperation = {
      version: STUDIO_RASTER_CRDT_VERSION,
      undoOperationId: uuid(3),
      targetOperationId: first.operationId,
      order: { logicalClock: "3", actorId: "artist-a" },
    };

    expect(() => compactStudioRasterOperationLog(
      log({ operations: [first, second], undoOperations: [undo] }),
      input(key(first))
    )).toThrow(/실행 취소가 봉인된/u);
  });

  it("does not compact across a later acknowledgement targeting a sealed undo", () => {
    const first = operation(1, "1");
    const undo: StudioRasterUndoOperation = {
      version: STUDIO_RASTER_CRDT_VERSION,
      undoOperationId: uuid(2),
      targetOperationId: first.operationId,
      order: { logicalClock: "2", actorId: "artist-a" },
    };
    const acknowledgement: StudioRasterUndoAcknowledgement = {
      version: STUDIO_RASTER_CRDT_VERSION,
      acknowledgementId: uuid(3),
      undoOperationId: undo.undoOperationId,
      targetOperationId: first.operationId,
      order: { logicalClock: "3", actorId: "artist-a" },
    };

    expect(() => compactStudioRasterOperationLog(
      log({ operations: [first], undoOperations: [undo], undoAcknowledgements: [acknowledgement] }),
      input(key(undo))
    )).toThrow(/복원 확인이 봉인된/u);
  });

  it("seals complete undo history when the boundary includes its acknowledgement", () => {
    const first = operation(1, "1");
    const undo: StudioRasterUndoOperation = {
      version: STUDIO_RASTER_CRDT_VERSION,
      undoOperationId: uuid(2),
      targetOperationId: first.operationId,
      order: { logicalClock: "2", actorId: "artist-a" },
    };
    const acknowledgement: StudioRasterUndoAcknowledgement = {
      version: STUDIO_RASTER_CRDT_VERSION,
      acknowledgementId: uuid(3),
      undoOperationId: undo.undoOperationId,
      targetOperationId: first.operationId,
      order: { logicalClock: "3", actorId: "artist-a" },
    };
    const result = compactStudioRasterOperationLog(
      log({ operations: [first], undoOperations: [undo], undoAcknowledgements: [acknowledgement] }),
      input(key(acknowledgement))
    );

    expect(result.checkpoint.sealedUndoOperationIds).toEqual([undo.undoOperationId]);
    expect(result.checkpoint.sealedUndoAcknowledgementIds).toEqual([acknowledgement.acknowledgementId]);
    expect(result.tail.operations).toEqual([]);
    expect(result.tail.undoOperations).toEqual([]);
  });

  it("requires complete edge-tile snapshots and rejects inline checkpoint transport fields", () => {
    const first = operation(1, "1");
    const wrongEdge = clone(input(key(first)));
    wrongEdge.tiles[0]!.asset.width = 43;
    expect(() => compactStudioRasterOperationLog(log({ operations: [first] }), wrongEdge))
      .toThrow(/전체 타일 크기/u);

    const inline = clone(input(key(first))) as unknown as Record<string, unknown>;
    const tiles = inline.tiles as Array<Record<string, unknown>>;
    (tiles[0]!.asset as Record<string, unknown>).src = "data:image/png;base64,AAAA";
    expect(() => compactStudioRasterOperationLog(
      log({ operations: [first] }),
      inline as unknown as StudioRasterCompactionInput
    )).toThrow(/필드/u);
  });

  it("rejects duplicate required replicas and duplicate sparse tile addresses", () => {
    const first = operation(1, "1");
    const duplicateReplica = clone(input(key(first)));
    duplicateReplica.requiredReplicaIds = ["node-seoul", "node-seoul"];
    expect(() => compactStudioRasterOperationLog(log({ operations: [first] }), duplicateReplica))
      .toThrow(/중복/u);

    const duplicateTile = clone(input(key(first)));
    duplicateTile.tiles[1] = { tileX: 2, tileY: 2, asset: asset("different-edge", 44, 4) };
    expect(() => compactStudioRasterOperationLog(log({ operations: [first] }), duplicateTile))
      .toThrow(/중복 checkpoint/u);
  });
});
