import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  STUDIO_CRDT_ORIGIN_REMOTE,
  STUDIO_CRDT_RASTER_CHECKPOINTS_ROOT,
  STUDIO_CRDT_RASTER_OPERATIONS_ROOT,
  STUDIO_CRDT_RASTER_SURFACES_ROOT,
  STUDIO_CRDT_RASTER_UNDO_ACKS_ROOT,
  STUDIO_CRDT_RASTER_UNDO_OPERATIONS_ROOT,
  StudioCrdtDocument,
  type StudioCrdtChange,
} from "./studio-crdt-document";
import { STUDIO_CRDT_UPDATE_MAX_BYTES } from "./studio-crdt-protocol";
import {
  compactStudioRasterOperationLog,
  type StudioRasterCompactionInput,
  type StudioRasterCompactionOrderKey,
} from "./studio-crdt-raster-compaction";
import {
  STUDIO_RASTER_CRDT_VERSION,
  STUDIO_RASTER_KERNEL,
  canonicalStudioRasterJson,
  createStudioRasterOperationLog,
  type StudioRasterAssetReference,
  type StudioRasterAssetMediaType,
  type StudioRasterOperation,
  type StudioRasterOperationLog,
  type StudioRasterSurfaceSpec,
  type StudioRasterUndoAcknowledgement,
  type StudioRasterUndoOperation,
} from "./studio-crdt-raster-ops";

const sha = (character: string) => character.repeat(64);
const uuid = (value: number) => `20000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
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
  assetId: string,
  width = 16,
  height = 16,
  digest = sha("a"),
  byteLength = 1_024
): StudioRasterAssetReference {
  return {
    scope: "work",
    assetId,
    sha256: digest,
    byteLength,
    mediaType: "image/png",
    width,
    height,
  };
}

function operation(
  id: number,
  logicalClock = String(id),
  mediaType: StudioRasterAssetMediaType = "image/png"
): StudioRasterOperation {
  return {
    version: STUDIO_RASTER_CRDT_VERSION,
    operationId: uuid(id),
    order: { logicalClock, actorId: "artist-a" },
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
        payload: {
          ...asset(`patch-${id}`, 16, 16, sha("c")),
          mediaType,
        },
      },
    }],
  };
}

function operationLog(input: {
  surface?: StudioRasterSurfaceSpec;
  operations?: readonly StudioRasterOperation[];
  undoOperations?: readonly StudioRasterUndoOperation[];
  undoAcknowledgements?: readonly StudioRasterUndoAcknowledgement[];
} = {}): StudioRasterOperationLog {
  return createStudioRasterOperationLog({
    version: STUDIO_RASTER_CRDT_VERSION,
    surface: input.surface ?? surface,
    operations: input.operations ?? [],
    undoOperations: input.undoOperations ?? [],
    undoAcknowledgements: input.undoAcknowledgements ?? [],
  });
}

function budgetOperation(id: number, logicalClock: string): StudioRasterOperation {
  const maximumAssetBytes = 16 * 1_024 * 1_024;
  return {
    ...operation(id, logicalClock),
    patches: Array.from({ length: 4 }, (_, index) => ({
      tileX: 0,
      tileY: 0,
      region: { x: index * 16, y: 0, width: 16, height: 16 },
      effect: {
        kind: "composite" as const,
        blendMode: "source-over" as const,
        payload: asset(
          `budget-${id}-${index}`,
          16,
          16,
          sha("f"),
          maximumAssetBytes
        ),
      },
    })),
  };
}

function key(event: StudioRasterOperation): StudioRasterCompactionOrderKey {
  return { ...event.order, eventId: event.operationId };
}

function checkpointInput(through: StudioRasterCompactionOrderKey): StudioRasterCompactionInput {
  return {
    checkpointId: uuid(900),
    through,
    requiredReplicaIds: ["replica-seoul", "replica-busan"],
    stabilityProof: {
      version: STUDIO_RASTER_CRDT_VERSION,
      proofId: uuid(901),
      undoHorizonClosedThrough: through,
      replicaFrontiers: [
        { replicaId: "replica-seoul", through },
        { replicaId: "replica-busan", through },
      ],
    },
    tileManifestSha256: sha("d"),
    tiles: [
      { tileX: 2, tileY: 2, asset: asset("snapshot-edge", 44, 4) },
      { tileX: 0, tileY: 0, asset: asset("snapshot-origin", 128, 128) },
    ],
  };
}

function underlyingYDoc(document: StudioCrdtDocument): Y.Doc {
  return (document as unknown as { doc: Y.Doc }).doc;
}

function changedIds(changes: readonly StudioCrdtChange[], field: keyof Pick<
  StudioCrdtChange,
  | "changedRasterSurfaceIds"
  | "changedRasterOperationIds"
  | "changedRasterUndoOperationIds"
  | "changedRasterUndoAcknowledgementIds"
  | "changedRasterCheckpointIds"
>): string[] {
  return [...changes.at(-1)![field]].sort();
}

describe("StudioCrdtDocument semantic raster roots", () => {
  it.each(persistedV1RasterMediaTypes.map((mediaType, index) => [mediaType, index] as const))(
    "hydrates persisted CRDT v1 %s references without rewriting their immutable metadata",
    (mediaType, index) => {
      const source = new StudioCrdtDocument();
      const hydrated = new StudioCrdtDocument();
      const persisted = operation(100 + index, String(100 + index), mediaType);

      source.mergeRasterOperationLog(operationLog({ operations: [persisted] }));
      hydrated.applyUpdate(source.encodeStateAsUpdate());

      expect(
        hydrated.getRasterOperationLog(surface.surfaceId)
          ?.operations[0]?.patches[0]?.effect.payload.mediaType
      ).toBe(mediaType);

      source.destroy();
      hydrated.destroy();
    }
  );

  it("converges concurrent raster operations by immutable set union", () => {
    const left = new StudioCrdtDocument();
    const right = new StudioCrdtDocument();
    const remoteChanges: StudioCrdtChange[] = [];
    left.subscribeChanges((change) => remoteChanges.push(change), {
      includeOrigin: (origin) => origin === STUDIO_CRDT_ORIGIN_REMOTE,
    });

    const earlier = operation(1, "9999999999999999999");
    const later = operation(2, "10000000000000000000");
    left.mergeRasterOperationLog(operationLog({ operations: [later] }));
    right.mergeRasterOperationLog(operationLog({ operations: [earlier] }));

    left.applyUpdate(right.encodeStateAsUpdate());
    right.applyUpdate(left.encodeStateAsUpdate());

    const expectedIds = [earlier.operationId, later.operationId];
    expect(left.getRasterOperationLog(surface.surfaceId)?.operations.map(({ operationId }) => operationId))
      .toEqual(expectedIds);
    expect(right.getRasterOperationLog(surface.surfaceId)).toEqual(
      left.getRasterOperationLog(surface.surfaceId)
    );
    expect(changedIds(remoteChanges, "changedRasterOperationIds")).toEqual([earlier.operationId]);
    expect(remoteChanges.at(-1)?.rasterOperationLogs).toEqual(left.getRasterOperationLogs());

    const ydoc = underlyingYDoc(left);
    expect(ydoc.getMap<string>(STUDIO_CRDT_RASTER_SURFACES_ROOT).size).toBe(1);
    expect(ydoc.getMap<string>(STUDIO_CRDT_RASTER_OPERATIONS_ROOT).size).toBe(2);
    for (const value of ydoc.getMap<string>(STUDIO_CRDT_RASTER_OPERATIONS_ROOT).values()) {
      expect(value).toBe(canonicalStudioRasterJson(JSON.parse(value)));
      expect(value).not.toContain("data:");
    }

    left.destroy();
    right.destroy();
  });

  it("stores operation, undo, and acknowledgement in separate grow-only roots", () => {
    const document = new StudioCrdtDocument();
    const changes: StudioCrdtChange[] = [];
    document.subscribeChanges((change) => changes.push(change));
    const target = operation(10, "1");
    const undo: StudioRasterUndoOperation = {
      version: STUDIO_RASTER_CRDT_VERSION,
      undoOperationId: uuid(11),
      targetOperationId: target.operationId,
      order: { logicalClock: "2", actorId: "artist-a" },
    };
    const acknowledgement: StudioRasterUndoAcknowledgement = {
      version: STUDIO_RASTER_CRDT_VERSION,
      acknowledgementId: uuid(12),
      undoOperationId: undo.undoOperationId,
      targetOperationId: target.operationId,
      order: { logicalClock: "3", actorId: "artist-a" },
    };
    const complete = operationLog({
      operations: [target],
      undoOperations: [undo],
      undoAcknowledgements: [acknowledgement],
    });

    document.mergeRasterOperationLog(complete);

    expect(changes).toHaveLength(1);
    expect(changedIds(changes, "changedRasterSurfaceIds")).toEqual([surface.surfaceId]);
    expect(changedIds(changes, "changedRasterOperationIds")).toEqual([target.operationId]);
    expect(changedIds(changes, "changedRasterUndoOperationIds")).toEqual([undo.undoOperationId]);
    expect(changedIds(changes, "changedRasterUndoAcknowledgementIds"))
      .toEqual([acknowledgement.acknowledgementId]);
    expect(changedIds(changes, "changedRasterCheckpointIds")).toEqual([]);
    expect(changes[0]!.rasterOperationLogs).toEqual([complete]);

    const ydoc = underlyingYDoc(document);
    expect(ydoc.getMap(STUDIO_CRDT_RASTER_OPERATIONS_ROOT).size).toBe(1);
    expect(ydoc.getMap(STUDIO_CRDT_RASTER_UNDO_OPERATIONS_ROOT).size).toBe(1);
    expect(ydoc.getMap(STUDIO_CRDT_RASTER_UNDO_ACKS_ROOT).size).toBe(1);

    changes.length = 0;
    expect(document.mergeRasterOperationLog(complete)).toEqual(complete);
    expect(changes).toEqual([]);

    const rewritten = operationLog({
      operations: [{ ...target, semanticParametersSha256: sha("e") }],
    });
    expect(() => document.mergeRasterOperationLog(rewritten)).toThrow(/불변/u);
    expect(document.getRasterOperationLog(surface.surfaceId)).toEqual(complete);
    expect(changes).toEqual([]);

    document.destroy();
  });

  it("hydrates coordinator checkpoints as read-only advisory metadata", () => {
    const source = new StudioCrdtDocument();
    const first = operation(20, "1");
    const second = operation(21, "5");
    const complete = operationLog({ operations: [second, first] });
    source.mergeRasterOperationLog(complete);
    const { checkpoint } = compactStudioRasterOperationLog(complete, checkpointInput(key(first)));
    underlyingYDoc(source).getMap<string>(STUDIO_CRDT_RASTER_CHECKPOINTS_ROOT).set(
      checkpoint.checkpointId,
      canonicalStudioRasterJson(checkpoint)
    );

    const document = new StudioCrdtDocument();
    const changes: StudioCrdtChange[] = [];
    document.subscribeChanges((change) => changes.push(change));
    document.applyUpdate(source.encodeStateAsUpdate());

    expect(changes).toHaveLength(1);
    expect(changedIds(changes, "changedRasterCheckpointIds")).toEqual([checkpoint.checkpointId]);
    expect(changedIds(changes, "changedRasterSurfaceIds")).toEqual([surface.surfaceId]);
    expect(changes[0]!.rasterCheckpoints).toEqual([checkpoint]);
    expect(document.getRasterCompactionCheckpoints(surface.surfaceId)).toEqual([checkpoint]);
    expect(Object.isFrozen(document.getRasterCompactionCheckpoints()[0]!.tiles)).toBe(true);
    expect(underlyingYDoc(document).getMap(STUDIO_CRDT_RASTER_CHECKPOINTS_ROOT).size).toBe(1);
    expect("addRasterCompactionCheckpoint" in document).toBe(false);

    source.destroy();
    document.destroy();
  });

  it("rejects UUID reuse across surfaces and operation, undo, acknowledgement, checkpoint roots", () => {
    const document = new StudioCrdtDocument();
    const original = operation(40, "1");
    const originalLog = operationLog({ operations: [original] });
    document.mergeRasterOperationLog(originalLog);
    const secondarySurface = { ...surface, surfaceId: "surface-secondary" };
    const secondaryTarget = operation(41, "1");
    const collidingUndo: StudioRasterUndoOperation = {
      version: STUDIO_RASTER_CRDT_VERSION,
      undoOperationId: original.operationId,
      targetOperationId: secondaryTarget.operationId,
      order: { logicalClock: "2", actorId: "artist-a" },
    };
    const crossSurfaceLog = operationLog({
      surface: secondarySurface,
      operations: [secondaryTarget],
      undoOperations: [collidingUndo],
    });

    expect(() => document.mergeRasterOperationLog(crossSurfaceLog)).toThrow(/전역 고유/u);
    expect(document.getRasterOperationLog(secondarySurface.surfaceId)).toBeNull();
    expect(underlyingYDoc(document).getMap(STUDIO_CRDT_RASTER_UNDO_OPERATIONS_ROOT).size)
      .toBe(0);

    const collidingCheckpoint = compactStudioRasterOperationLog(originalLog, {
      ...checkpointInput(key(original)),
      checkpointId: original.operationId,
    }).checkpoint;
    underlyingYDoc(document).getMap<string>(STUDIO_CRDT_RASTER_CHECKPOINTS_ROOT).set(
      collidingCheckpoint.checkpointId,
      canonicalStudioRasterJson(collidingCheckpoint)
    );
    expect(document.getRasterCompactionCheckpoints()).toEqual([]);
    expect(document.getRasterOperationLogs()).toEqual([]);

    document.destroy();
  });

  it("enforces one document-wide asset budget across otherwise valid surfaces", () => {
    const document = new StudioCrdtDocument();
    const firstSurface = { ...surface, surfaceId: "budget-surface-a" };
    const secondSurface = { ...surface, surfaceId: "budget-surface-b" };

    for (let index = 0; index < 16; index += 1) {
      document.mergeRasterOperationLog(operationLog({
        surface: firstSurface,
        operations: [budgetOperation(1_000 + index, String(index + 1))],
      }));
      document.mergeRasterOperationLog(operationLog({
        surface: secondSurface,
        operations: [budgetOperation(1_100 + index, String(index + 1))],
      }));
    }

    const overBudget = budgetOperation(1_200, "17");
    expect(() => document.mergeRasterOperationLog(operationLog({
      surface: secondSurface,
      operations: [overBudget],
    }))).toThrow(/문서 전역 자산 참조 예산/u);
    expect(document.getRasterOperationLog(secondSurface.surfaceId)?.operations).toHaveLength(16);
    expect(underlyingYDoc(document).getMap(STUDIO_CRDT_RASTER_OPERATIONS_ROOT).size).toBe(32);

    document.destroy();
  });

  it("atomically rejects a local raster transaction whose encoded update exceeds transport limits", () => {
    const document = new StudioCrdtDocument();
    const changes: StudioCrdtChange[] = [];
    const localUpdates: Uint8Array[] = [];
    document.subscribeChanges((change) => changes.push(change));
    document.subscribe((update) => localUpdates.push(update));
    const operations = Array.from({ length: 150 }, (_, index) => (
      operation(2_000 + index, String(index + 1))
    ));

    expect(() => document.mergeRasterOperationLog(operationLog({ operations })))
      .toThrow(/로컬 업데이트가 전송 한도/u);

    expect(changes).toEqual([]);
    expect(localUpdates).toEqual([]);
    expect(underlyingYDoc(document).getMap(STUDIO_CRDT_RASTER_SURFACES_ROOT).size).toBe(0);
    expect(underlyingYDoc(document).getMap(STUDIO_CRDT_RASTER_OPERATIONS_ROOT).size).toBe(0);

    document.mergeRasterOperationLog(operationLog({ operations: [operations[0]!] }));
    expect(localUpdates).toHaveLength(1);
    expect(localUpdates[0]!.byteLength).toBeLessThanOrEqual(STUDIO_CRDT_UPDATE_MAX_BYTES);

    document.destroy();
  });

  it("fails closed without throwing when a remote replica injects malformed raster semantics", () => {
    const document = new StudioCrdtDocument();
    document.mergeRasterOperationLog(operationLog({ operations: [operation(30, "1")] }));
    const changes: StudioCrdtChange[] = [];
    document.subscribeChanges((change) => changes.push(change), {
      includeOrigin: (origin) => origin === STUDIO_CRDT_ORIGIN_REMOTE,
    });
    const attacker = new Y.Doc();
    const malformedId = uuid(31);
    attacker.getMap<string>(STUDIO_CRDT_RASTER_OPERATIONS_ROOT).set(
      malformedId,
      canonicalStudioRasterJson({ surfaceId: surface.surfaceId, operation: { version: 1 } })
    );

    expect(() => document.applyUpdate(Y.encodeStateAsUpdate(attacker))).not.toThrow();

    expect(changes).toHaveLength(1);
    expect(changedIds(changes, "changedRasterOperationIds")).toEqual([malformedId]);
    expect(changedIds(changes, "changedRasterSurfaceIds")).toEqual([surface.surfaceId]);
    expect(changes[0]!.rasterOperationLogs).toEqual([]);
    expect(document.getRasterOperationLog(surface.surfaceId)).toBeNull();

    attacker.destroy();
    document.destroy();
  });

  it("fails closed on a remote UUID collision that is valid within each separate surface", () => {
    const document = new StudioCrdtDocument();
    const original = operation(50, "1");
    document.mergeRasterOperationLog(operationLog({ operations: [original] }));
    const secondarySurface = { ...surface, surfaceId: "surface-remote-collision" };
    const secondaryTarget = operation(51, "1");
    const collidingUndo: StudioRasterUndoOperation = {
      version: STUDIO_RASTER_CRDT_VERSION,
      undoOperationId: original.operationId,
      targetOperationId: secondaryTarget.operationId,
      order: { logicalClock: "2", actorId: "artist-a" },
    };
    const attacker = new Y.Doc();
    attacker.getMap<string>(STUDIO_CRDT_RASTER_SURFACES_ROOT).set(
      secondarySurface.surfaceId,
      canonicalStudioRasterJson(secondarySurface)
    );
    attacker.getMap<string>(STUDIO_CRDT_RASTER_OPERATIONS_ROOT).set(
      secondaryTarget.operationId,
      canonicalStudioRasterJson({
        surfaceId: secondarySurface.surfaceId,
        operation: secondaryTarget,
      })
    );
    attacker.getMap<string>(STUDIO_CRDT_RASTER_UNDO_OPERATIONS_ROOT).set(
      collidingUndo.undoOperationId,
      canonicalStudioRasterJson({
        surfaceId: secondarySurface.surfaceId,
        undoOperation: collidingUndo,
      })
    );

    expect(() => document.applyUpdate(Y.encodeStateAsUpdate(attacker))).not.toThrow();
    expect(document.getRasterOperationLogs()).toEqual([]);
    expect(document.getRasterOperationLog(surface.surfaceId)).toBeNull();
    expect(document.getRasterOperationLog(secondarySurface.surfaceId)).toBeNull();

    attacker.destroy();
    document.destroy();
  });

  // getRasterOperationLogAsync offloads parse/validate to one explicitly selected Web Worker.
  // This test environment has no Worker, so the product facade reports the async read unavailable
  // instead of changing authority to the synchronous parser.
  describe("getRasterOperationLogAsync", () => {
    it("returns null without substituting the synchronous parser when Worker is unavailable", async () => {
      const document = new StudioCrdtDocument();
      document.mergeRasterOperationLog(
        operationLog({ operations: [operation(1, "1"), operation(2, "2")] })
      );

      const sync = document.getRasterOperationLog(surface.surfaceId);
      const async = await document.getRasterOperationLogAsync(surface.surfaceId);

      expect(sync).not.toBeNull();
      expect(async).toBeNull();

      document.destroy();
    });

    it("returns null for an unknown surface, matching the synchronous accessor", async () => {
      const document = new StudioCrdtDocument();
      document.mergeRasterOperationLog(operationLog({ operations: [operation(3, "1")] }));

      expect(document.getRasterOperationLog("no-such-surface")).toBeNull();
      expect(await document.getRasterOperationLogAsync("no-such-surface")).toBeNull();

      document.destroy();
    });

    it("fails closed to null (not a rejection) when aborted, matching the try*-family null-safety contract", async () => {
      // getRasterOperationLogAsync is the async counterpart of getRasterOperationLog, which never
      // throws for missing/invalid data (tryReadExactRasterDocumentSnapshot swallows everything) --
      // the async version preserves that contract by swallowing an abort into null too, rather than
      // rejecting. Downstream (StudioRasterCrdtSurface) already treats a null log as "nothing to
      // render" regardless of the reason, so this keeps both call sites uniform.
      const document = new StudioCrdtDocument();
      document.mergeRasterOperationLog(operationLog({ operations: [operation(4, "1")] }));
      const controller = new AbortController();
      controller.abort();

      await expect(
        document.getRasterOperationLogAsync(surface.surfaceId, { signal: controller.signal })
      ).resolves.toBeNull();

      document.destroy();
    });
  });
});
