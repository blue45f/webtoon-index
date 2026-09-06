import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_RASTER_CRDT_VERSION,
  STUDIO_RASTER_KERNEL,
  STUDIO_RASTER_MAX_ASSET_BYTES,
  StudioRasterContractError,
  createStudioRasterOperationLog,
  mergeStudioRasterOperationLogs,
  replayStudioRasterOperationLog,
  studioRasterUndoneOperationIds,
  type StudioRasterAssetReference,
  type StudioRasterAssetMediaType,
  type StudioRasterOperation,
  type StudioRasterOperationLog,
  type StudioRasterTilePatch,
  type StudioRasterUndoAcknowledgement,
  type StudioRasterUndoOperation,
} from "./studio-crdt-raster-ops";

const sha = (character: string) => character.repeat(64);
const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const persistedV1RasterMediaTypes = [
  "image/png",
  "image/webp",
  "application/x-toonspectrum-rgba-zstd",
  "application/x-toonspectrum-alpha-zstd",
] as const satisfies readonly StudioRasterAssetMediaType[];

const surface = {
  version: STUDIO_RASTER_CRDT_VERSION,
  surfaceId: "surface-main",
  width: 300,
  height: 260,
  tileSize: 128,
} as const;

function asset(
  id: string,
  width = 16,
  height = 16,
  digest = sha("a")
): StudioRasterAssetReference {
  return {
    scope: "work",
    assetId: id,
    sha256: digest,
    byteLength: 1_024,
    mediaType: "image/png",
    width,
    height,
  };
}

function compositePatch(
  id: string,
  tileX = 0,
  tileY = 0,
  blendMode: "source-over" | "destination-out" = "source-over"
): StudioRasterTilePatch {
  return {
    tileX,
    tileY,
    region: { x: 0, y: 0, width: 16, height: 16 },
    effect: { kind: "composite", blendMode, payload: asset(id) },
  };
}

function replacePatch(id: string, tileX = 0, tileY = 0, baseTileSha256 = sha("b")): StudioRasterTilePatch {
  return {
    tileX,
    tileY,
    region: { x: 0, y: 0, width: 16, height: 16 },
    effect: { kind: "replace", baseTileSha256, payload: asset(id) },
  };
}

function operation(input: {
  id: number;
  clock?: string;
  actorId?: string;
  intent?: StudioRasterOperation["intent"];
  patches?: readonly StudioRasterTilePatch[];
}): StudioRasterOperation {
  const intent = input.intent ?? "paint";
  return {
    version: STUDIO_RASTER_CRDT_VERSION,
    operationId: uuid(input.id),
    order: { logicalClock: input.clock ?? String(input.id), actorId: input.actorId ?? "artist-a" },
    pageId: "page-1",
    layerId: "layer-ink",
    intent,
    kernel: STUDIO_RASTER_KERNEL,
    semanticParametersSha256: sha("c"),
    patches: input.patches ?? [compositePatch(`asset-${input.id}`)],
  };
}

function log(input: {
  operations?: readonly StudioRasterOperation[];
  undoOperations?: readonly StudioRasterUndoOperation[];
  undoAcknowledgements?: readonly StudioRasterUndoAcknowledgement[];
} = {}): StudioRasterOperationLog {
  return {
    version: STUDIO_RASTER_CRDT_VERSION,
    surface,
    operations: input.operations ?? [],
    undoOperations: input.undoOperations ?? [],
    undoAcknowledgements: input.undoAcknowledgements ?? [],
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("semantic raster CRDT operations", () => {
  it("canonicalizes a bounded operation log and freezes immutable operations and patch order", () => {
    const second = operation({ id: 2, clock: "10" });
    const first = operation({
      id: 1,
      clock: "9",
      patches: [compositePatch("asset-first-a"), compositePatch("asset-first-b", 1)],
    });

    const result = createStudioRasterOperationLog(log({ operations: [second, first] }));

    expect(result.operations.map((entry) => entry.operationId)).toEqual([uuid(1), uuid(2)]);
    expect(result.operations[0]!.patches.map((patch) => patch.effect.payload.assetId)).toEqual([
      "asset-first-a",
      "asset-first-b",
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.operations[0]!.patches)).toBe(true);
    expect(Object.keys(result.operations[0]!.patches[0]!.effect.payload)).not.toContain("src");
  });

  it("rejects inline URLs/data and unknown transport fields on opaque asset references", () => {
    const invalid = clone(operation({ id: 1 })) as unknown as Record<string, unknown>;
    const patches = invalid.patches as Array<Record<string, unknown>>;
    const effect = patches[0]!.effect as Record<string, unknown>;
    const payload = effect.payload as Record<string, unknown>;
    payload.assetId = "data:image/png;base64,AAAA";
    payload.src = "data:image/png;base64,AAAA";

    expect(() => createStudioRasterOperationLog(log({ operations: [invalid as unknown as StudioRasterOperation] })))
      .toThrowError(StudioRasterContractError);
  });

  it.each(persistedV1RasterMediaTypes)(
    "keeps persisted CRDT v1 %s asset references readable",
    (mediaType) => {
      const persisted = clone(operation({ id: 1 }));
      (persisted.patches[0]!.effect.payload as { mediaType: StudioRasterAssetMediaType })
        .mediaType = mediaType;

      const result = createStudioRasterOperationLog(log({ operations: [persisted] }));
      expect(result.operations[0]?.patches[0]?.effect.payload.mediaType).toBe(mediaType);
    }
  );

  it("still rejects media types that were never part of the CRDT v1 contract", () => {
    const unsupported = clone(operation({ id: 1 }));
    (unsupported.patches[0]!.effect.payload as unknown as { mediaType: string }).mediaType =
      "image/jpeg";

    expect(() => createStudioRasterOperationLog(log({ operations: [unsupported] })))
      .toThrow(/mediaType/u);
  });

  it("enforces per-asset bytes, edge-tile bounds, and exact payload dimensions", () => {
    const overBudget = operation({ id: 1 });
    (overBudget.patches[0]!.effect.payload as { byteLength: number }).byteLength = STUDIO_RASTER_MAX_ASSET_BYTES + 1;
    expect(() => createStudioRasterOperationLog(log({ operations: [overBudget] }))).toThrow(/byteLength/u);

    const edgeOverflow = operation({
      id: 2,
      patches: [{
        tileX: 2,
        tileY: 2,
        region: { x: 40, y: 0, width: 16, height: 4 },
        effect: { kind: "composite", blendMode: "source-over", payload: asset("edge", 16, 4) },
      }],
    });
    expect(() => createStudioRasterOperationLog(log({ operations: [edgeOverflow] }))).toThrow(/타일 경계/u);

    const dimensionMismatch = operation({
      id: 3,
      patches: [{
        tileX: 0,
        tileY: 0,
        region: { x: 0, y: 0, width: 16, height: 16 },
        effect: { kind: "composite", blendMode: "source-over", payload: asset("wrong-size", 8, 16) },
      }],
    });
    expect(() => createStudioRasterOperationLog(log({ operations: [dimensionMismatch] }))).toThrow(/크기/u);
  });

  it("merges replicas by immutable set union with deterministic 64-bit clock ordering", () => {
    const earlier = operation({ id: 1, clock: "9999999999999999999", actorId: "artist-z" });
    const later = operation({ id: 2, clock: "10000000000000000000", actorId: "artist-a" });
    const left = createStudioRasterOperationLog(log({ operations: [later] }));
    const right = createStudioRasterOperationLog(log({ operations: [earlier] }));

    const leftFirst = mergeStudioRasterOperationLogs([left, right]);
    const rightFirst = mergeStudioRasterOperationLogs([right, left]);

    expect(leftFirst).toEqual(rightFirst);
    expect(leftFirst.operations.map((entry) => entry.operationId)).toEqual([uuid(1), uuid(2)]);
  });

  it("rejects clocks outside uint64 and event identities reused across operation kinds", () => {
    const overflowClock = operation({ id: 1, clock: "18446744073709551616" });
    expect(() => createStudioRasterOperationLog(log({ operations: [overflowClock] }))).toThrow(/Lamport/u);

    const target = operation({ id: 2, clock: "1" });
    const reusedIdentity: StudioRasterUndoOperation = {
      version: STUDIO_RASTER_CRDT_VERSION,
      undoOperationId: target.operationId,
      targetOperationId: target.operationId,
      order: { logicalClock: "2", actorId: "artist-a" },
    };
    expect(() => createStudioRasterOperationLog(log({ operations: [target], undoOperations: [reusedIdentity] })))
      .toThrow(/중복 식별자/u);
  });

  it("rejects replicas that reuse an immutable operation identity with different content", () => {
    const original = operation({ id: 1, clock: "1" });
    const rewritten = { ...clone(original), semanticParametersSha256: sha("d") };

    expect(() => mergeStudioRasterOperationLogs([
      createStudioRasterOperationLog(log({ operations: [original] })),
      createStudioRasterOperationLog(log({ operations: [rewritten] })),
    ])).toThrow(/불변 이벤트/u);
  });

  it("allows only the operation owner to undo or acknowledge a restore", () => {
    const target = operation({ id: 1, actorId: "artist-a" });
    const foreignUndo: StudioRasterUndoOperation = {
      version: STUDIO_RASTER_CRDT_VERSION,
      undoOperationId: uuid(2),
      targetOperationId: target.operationId,
      order: { logicalClock: "2", actorId: "artist-b" },
    };
    expect(() => createStudioRasterOperationLog(log({ operations: [target], undoOperations: [foreignUndo] })))
      .toThrow(/작성자만/u);

    const ownedUndo = { ...foreignUndo, order: { logicalClock: "2", actorId: "artist-a" } };
    const foreignAck: StudioRasterUndoAcknowledgement = {
      version: STUDIO_RASTER_CRDT_VERSION,
      acknowledgementId: uuid(3),
      undoOperationId: ownedUndo.undoOperationId,
      targetOperationId: target.operationId,
      order: { logicalClock: "3", actorId: "artist-b" },
    };
    expect(() => createStudioRasterOperationLog(log({
      operations: [target],
      undoOperations: [ownedUndo],
      undoAcknowledgements: [foreignAck],
    }))).toThrow(/작성자만/u);
  });

  it("uses observed-remove restore semantics so an unseen concurrent undo still wins", () => {
    const target = operation({ id: 1 });
    const firstUndo: StudioRasterUndoOperation = {
      version: STUDIO_RASTER_CRDT_VERSION,
      undoOperationId: uuid(2),
      targetOperationId: target.operationId,
      order: { logicalClock: "2", actorId: "artist-a" },
    };
    const restore: StudioRasterUndoAcknowledgement = {
      version: STUDIO_RASTER_CRDT_VERSION,
      acknowledgementId: uuid(3),
      undoOperationId: firstUndo.undoOperationId,
      targetOperationId: target.operationId,
      order: { logicalClock: "3", actorId: "artist-a" },
    };
    const unseenUndo: StudioRasterUndoOperation = {
      version: STUDIO_RASTER_CRDT_VERSION,
      undoOperationId: uuid(4),
      targetOperationId: target.operationId,
      order: { logicalClock: "4", actorId: "artist-a" },
    };
    const result = createStudioRasterOperationLog(log({
      operations: [target],
      undoOperations: [firstUndo, unseenUndo],
      undoAcknowledgements: [restore],
    }));

    expect(studioRasterUndoneOperationIds(result)).toEqual(new Set([target.operationId]));
    const applyPatch = vi.fn();
    expect(replayStudioRasterOperationLog(result, { readTileSha256: () => null, applyPatch })).toMatchObject({
      appliedOperationIds: [],
      undoneOperationIds: [target.operationId],
      appliedPatchCount: 0,
    });
    expect(applyPatch).not.toHaveBeenCalled();
  });

  it("converges harmless concurrent acknowledgements of the same observed undo", () => {
    const target = operation({ id: 1 });
    const undo: StudioRasterUndoOperation = {
      version: STUDIO_RASTER_CRDT_VERSION,
      undoOperationId: uuid(2),
      targetOperationId: target.operationId,
      order: { logicalClock: "2", actorId: "artist-a" },
    };
    const acknowledgement = (id: number, clock: string): StudioRasterUndoAcknowledgement => ({
      version: STUDIO_RASTER_CRDT_VERSION,
      acknowledgementId: uuid(id),
      undoOperationId: undo.undoOperationId,
      targetOperationId: target.operationId,
      order: { logicalClock: clock, actorId: "artist-a" },
    });
    const result = createStudioRasterOperationLog(log({
      operations: [target],
      undoOperations: [undo],
      undoAcknowledgements: [acknowledgement(3, "3"), acknowledgement(4, "4")],
    }));

    expect(result.undoAcknowledgements).toHaveLength(2);
    expect(studioRasterUndoneOperationIds(result).size).toBe(0);
  });

  it("replays operations by total order and preserves immutable patch order within each operation", () => {
    const second = operation({ id: 2, clock: "2", patches: [compositePatch("second")] });
    const first = operation({
      id: 1,
      clock: "1",
      patches: [compositePatch("first-a"), compositePatch("first-b", 1)],
    });
    const applied: string[] = [];

    const result = replayStudioRasterOperationLog(log({ operations: [second, first] }), {
      readTileSha256: () => null,
      applyPatch: ({ patch }) => applied.push(patch.effect.payload.assetId),
    });

    expect(applied).toEqual(["first-a", "first-b", "second"]);
    expect(result.appliedOperationIds).toEqual([first.operationId, second.operationId]);
    expect(result.appliedPatchCount).toBe(3);
  });

  it("preflights every destructive tile and skips the whole operation on one base mismatch", () => {
    const filter = operation({
      id: 1,
      intent: "filter",
      patches: [replacePatch("filtered-a", 0, 0), replacePatch("filtered-b", 1, 0)],
    });
    const applyPatch = vi.fn();
    const result = replayStudioRasterOperationLog(log({ operations: [filter] }), {
      readTileSha256: ({ tileX }) => tileX === 0 ? sha("b") : sha("d"),
      applyPatch,
    });

    expect(result.conflictedOperationIds).toEqual([filter.operationId]);
    expect(result.appliedPatchCount).toBe(0);
    expect(applyPatch).not.toHaveBeenCalled();
  });

  it("rejects contradictory base hashes for multiple replacements of one tile", () => {
    const filter = operation({
      id: 1,
      intent: "filter",
      patches: [
        replacePatch("filtered-a", 0, 0, sha("b")),
        replacePatch("filtered-b", 0, 0, sha("d")),
      ],
    });
    expect(() => createStudioRasterOperationLog(log({ operations: [filter] }))).toThrow(/같은 base hash/u);
  });

  it("requires selection masks and intent-safe blend/effect semantics", () => {
    const missingMask = operation({
      id: 1,
      intent: "selection-fill",
      patches: [compositePatch("selection-fill")],
    });
    expect(() => createStudioRasterOperationLog(log({ operations: [missingMask] }))).toThrow(/선택 마스크/u);

    const unsafeFilter = operation({ id: 2, intent: "filter", patches: [compositePatch("filter")] });
    expect(() => createStudioRasterOperationLog(log({ operations: [unsafeFilter] }))).toThrow(/replace/u);

    const wrongErase = operation({ id: 3, intent: "erase", patches: [compositePatch("erase")] });
    expect(() => createStudioRasterOperationLog(log({ operations: [wrongErase] }))).toThrow(/합성 모드/u);
  });

  it("rejects one asset identity resolving to different hashes anywhere in the log", () => {
    const first = operation({ id: 1, patches: [compositePatch("shared-asset")] });
    const conflictingPatch = compositePatch("shared-asset");
    (conflictingPatch.effect.payload as { sha256: string }).sha256 = sha("e");
    const second = operation({ id: 2, patches: [conflictingPatch] });

    expect(() => createStudioRasterOperationLog(log({ operations: [first, second] })))
      .toThrow(/같은 assetId/u);
  });
});
