import { fromUint8Array, toUint8Array } from "js-base64";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { compactStudioRasterOperationLog } from "../../../../web/src/shared/lib/studio-crdt-raster-compaction";
import {
  STUDIO_CRDT_RASTER_CHECKPOINTS_ROOT,
  STUDIO_CRDT_RASTER_OPERATIONS_ROOT,
  STUDIO_CRDT_RASTER_SURFACES_ROOT,
  STUDIO_CRDT_RASTER_UNDO_ACKS_ROOT,
  STUDIO_CRDT_RASTER_UNDO_OPERATIONS_ROOT,
} from "../../../../web/src/shared/lib/studio-crdt-raster-document-contract";
import {
  STUDIO_RASTER_CRDT_VERSION,
  STUDIO_RASTER_KERNEL,
  canonicalStudioRasterJson,
  createStudioRasterOperationLog,
  type StudioRasterAssetReference,
  type StudioRasterOperation,
  type StudioRasterUndoAcknowledgement,
  type StudioRasterUndoOperation,
} from "../../../../web/src/shared/lib/studio-crdt-raster-ops";
import {
  studioBrushDynamicsSettingsForBrushId,
} from "../../../../web/src/domains/creator/brush/studio-brush-dynamics";
import {
  isStudioStrokePaintModelCompatible as hasValidBrowserStrokePaintContract,
} from "../../../../web/src/domains/creator/brush/studio-stroke-paint-model";
import {
  BRUSH_PRESETS,
  STUDIO_BRUSH_RENDER_FAMILY,
} from "../../../../web/src/domains/creator/studio-brush";

import { StudioCrdtRasterCheckpointCoordinator } from "./studio-crdt-raster-checkpoint.coordinator";
import {
  STUDIO_CRDT_SHARED_3D_STAGE_RECORD_ROOT_PREFIX,
  STUDIO_CRDT_SHARED_3D_STAGE_RECORDS_ROOT,
  STUDIO_CRDT_SHARED_3D_STAGE_VISIBILITY_RECEIPT_ROOT_PREFIX,
  STUDIO_CRDT_SHARED_3D_STAGE_VISIBILITY_RECEIPTS_ROOT,
  encodeStudioCrdtShared3dCompositeKey,
  hasValidStudioCrdtRootSchema,
  hasValidStudioCrdtStrokePaintContract,
} from "./studio-crdt-root-schema";
import {
  STUDIO_CRDT_UPDATE_MAX_BYTES,
  studioCrdtPayloadHash,
} from "./studio-crdt.repository";
import {
  STUDIO_CRDT_SYNC_CHUNK_MAX_BYTES,
  STUDIO_CRDT_ACTIVE_WORK_ASSET_REFERENCE_MAX_COUNT,
  StudioCrdtBackpressureError,
  StudioCrdtDocumentTooLargeError,
  StudioCrdtInvalidPayloadError,
  type StudioCrdtRasterAssetAdmission,
  type StudioCrdtWorkAssetAdmission,
  StudioCrdtService,
  StudioCrdtStorageCorruptionError,
  StudioCrdtUpdateIdConflictError,
  chunkStudioCrdtSyncDiff,
  encodeStudioCrdtServerStateVector,
  encodeStudioCrdtServerStateVectorBytes,
} from "./studio-crdt.service";

import type { StudioCrdtClusterLoadRepository } from "./studio-crdt-cluster-load.repository";
import type {
  AppendStudioCrdtUpdateInput,
  AppendStudioCrdtUpdateResult,
  CompactStudioCrdtInput,
  DrizzleStudioCrdtTransaction,
  StudioCrdtHydrationState,
  StudioCrdtRepository,
  StudioCrdtSnapshotRecord,
  StudioCrdtUpdateReceiptRecord,
  StudioCrdtUpdateRecord,
  ValidateStudioCrdtAppend,
} from "./studio-crdt.repository";
import type { StudioWorkAssetReference } from "../../../../web/src/shared/lib/studio-work-asset-contract";

function copyBytes(value: Uint8Array): Uint8Array {
  return Uint8Array.from(value);
}

function copyUpdate(update: StudioCrdtUpdateRecord): StudioCrdtUpdateRecord {
  return { ...update, payload: copyBytes(update.payload), createdAt: new Date(update.createdAt) };
}

class MemoryStudioCrdtRepository implements StudioCrdtRepository {
  readonly snapshots = new Map<string, StudioCrdtSnapshotRecord>();
  readonly updates = new Map<string, StudioCrdtUpdateRecord[]>();
  readonly receipts = new Map<string, StudioCrdtUpdateReceiptRecord>();
  nextSequence = 1n;
  failAppend = false;
  compactCalls = 0;
  beforeAppend: (() => Promise<void>) | null = null;
  readonly validationTransaction = {} as DrizzleStudioCrdtTransaction;
  private readonly mutationTails = new Map<string, Promise<void>>();

  private async withWorkMutation<T>(workId: string, operation: () => Promise<T>): Promise<T> {
    const predecessor = this.mutationTails.get(workId) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = predecessor.then(() => gate);
    this.mutationTails.set(workId, tail);
    await predecessor;
    try {
      return await operation();
    } finally {
      release?.();
      if (this.mutationTails.get(workId) === tail) this.mutationTails.delete(workId);
    }
  }

  async loadDocument(workId: string): Promise<StudioCrdtHydrationState> {
    const snapshot = this.snapshots.get(workId) ?? null;
    const compactedSequence = snapshot?.compactedSequence ?? 0n;
    return {
      snapshot: snapshot
        ? { ...snapshot, snapshot: copyBytes(snapshot.snapshot), updatedAt: new Date(snapshot.updatedAt) }
        : null,
      updates: (this.updates.get(workId) ?? [])
        .filter((update) => update.sequence > compactedSequence)
        .map(copyUpdate),
    };
  }

  async loadCatchUp(workId: string, afterSequence: bigint): Promise<StudioCrdtHydrationState> {
    const storedSnapshot = this.snapshots.get(workId) ?? null;
    const snapshot =
      storedSnapshot && storedSnapshot.compactedSequence > afterSequence
        ? {
            ...storedSnapshot,
            snapshot: copyBytes(storedSnapshot.snapshot),
            updatedAt: new Date(storedSnapshot.updatedAt),
          }
        : null;
    const effectiveSequence = snapshot?.compactedSequence ?? afterSequence;
    return {
      snapshot,
      updates: (this.updates.get(workId) ?? [])
        .filter((update) => update.sequence > effectiveSequence)
        .map(copyUpdate),
    };
  }

  async listUpdatesAfter(workId: string, sequence: bigint): Promise<StudioCrdtUpdateRecord[]> {
    return (this.updates.get(workId) ?? [])
      .filter((update) => update.sequence > sequence)
      .map(copyUpdate);
  }

  async appendUpdate(
    input: AppendStudioCrdtUpdateInput,
    validate: ValidateStudioCrdtAppend
  ): Promise<AppendStudioCrdtUpdateResult> {
    await this.beforeAppend?.();
    return this.withWorkMutation(input.workId, async () => {
      if (this.failAppend) throw new Error("write failed");
      const receiptKey = JSON.stringify([input.workId, input.updateId]);
      const existingReceipt = this.receipts.get(receiptKey);
      if (existingReceipt) {
        return {
          inserted: false,
          receipt: {
            ...existingReceipt,
            payloadHash: copyBytes(existingReceipt.payloadHash),
            createdAt: new Date(existingReceipt.createdAt),
          },
        };
      }
      await validate(
        await this.loadDocument(input.workId),
        this.validationTransaction
      );
      const rows = this.updates.get(input.workId) ?? [];
      const update: StudioCrdtUpdateRecord = {
        workId: input.workId,
        sequence: this.nextSequence,
        updateId: input.updateId,
        actorUserId: input.actorUserId,
        payload: copyBytes(input.payload),
        createdAt: new Date(input.createdAt),
      };
      this.nextSequence += 1n;
      rows.push(update);
      this.updates.set(input.workId, rows);
      const receipt: StudioCrdtUpdateReceiptRecord = {
        workId: input.workId,
        updateId: input.updateId,
        sequence: update.sequence,
        actorUserId: input.actorUserId,
        payloadHash: studioCrdtPayloadHash(input.payload),
        createdAt: new Date(input.createdAt),
      };
      this.receipts.set(receiptKey, receipt);
      return {
        inserted: true,
        receipt: {
          ...receipt,
          payloadHash: copyBytes(receipt.payloadHash),
          createdAt: new Date(receipt.createdAt),
        },
      };
    });
  }

  async compact(input: CompactStudioCrdtInput): Promise<boolean> {
    return this.withWorkMutation(input.workId, async () => {
      this.compactCalls += 1;
      const existing = this.snapshots.get(input.workId);
      if (existing && existing.compactedSequence >= input.throughSequence) return false;
      this.snapshots.set(input.workId, {
        workId: input.workId,
        snapshot: copyBytes(input.snapshot),
        compactedSequence: input.throughSequence,
        updatedAt: new Date(input.updatedAt),
      });
      this.updates.set(
        input.workId,
        (this.updates.get(input.workId) ?? []).filter(
          (update) => update.sequence > input.throughSequence
        )
      );
      return true;
    });
  }
}

// Trivially "under budget" by default (readClusterLoad resolves 0), so existing tests that don't
// care about the cluster-wide cap are unaffected by it.
class MemoryStudioCrdtClusterLoadRepository implements StudioCrdtClusterLoadRepository {
  readonly reportedLoads: Array<{ nodeId: string; pendingOperations: number; now: Date }> = [];
  clusterLoad = 0;
  failReads = false;
  // When set, readClusterLoad suspends until the test resolves it -- used to hold a heartbeat
  // genuinely in-flight (e.g. to test onModuleDestroy racing against it).
  readGate: Promise<void> | undefined;

  async reportLoad(nodeId: string, pendingOperations: number, now: Date): Promise<void> {
    this.reportedLoads.push({ nodeId, pendingOperations, now });
  }

  async readClusterLoad(): Promise<number> {
    if (this.readGate) await this.readGate;
    if (this.failReads) throw new Error("cluster load discovery failed");
    return this.clusterLoad;
  }
}

const services: StudioCrdtService[] = [];

const allowStoredRasterAssetReferences: StudioCrdtRasterAssetAdmission = {
  async assertReferencesStored() {
    // Unit tests outside the storage-admission cases exercise the CRDT contract in isolation.
  },
};

const allowStoredWorkAssetReferences: StudioCrdtWorkAssetAdmission = {
  async assertReferencesStored() {
    // Unit tests outside work-asset storage admission exercise the CRDT contract in isolation.
  },
  async assertR8GrainReferencesStored() {
    // Unit tests outside R8 storage admission exercise the CRDT contract in isolation.
  },
};

function service(
  repository: MemoryStudioCrdtRepository,
  options: ConstructorParameters<typeof StudioCrdtService>[4] = {},
  rasterAssetAdmission: StudioCrdtRasterAssetAdmission = allowStoredRasterAssetReferences,
  workAssetAdmission: StudioCrdtWorkAssetAdmission = allowStoredWorkAssetReferences,
  clusterLoadRepository: StudioCrdtClusterLoadRepository = new MemoryStudioCrdtClusterLoadRepository()
): StudioCrdtService {
  const created = new StudioCrdtService(
    repository,
    rasterAssetAdmission,
    workAssetAdmission,
    clusterLoadRepository,
    options
  );
  services.push(created);
  return created;
}

afterEach(async () => {
  await Promise.all(services.splice(0).map((current) => current.onModuleDestroy()));
});

function yUpdate(key: string, value: string): string {
  const doc = new Y.Doc();
  doc.getMap<string>("root").set(key, value);
  const update = fromUint8Array(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return update;
}

function createScenePageDocument(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap<boolean>("scene-elements").set("scene-1", true);
  const scene = doc.getMap<unknown>("scene-element:scene-1");
  scene.set("id", "scene-1");
  scene.set("pageId", "page-1");
  scene.set("layerId", "layer-1");
  scene.set("payloadVersion", 1);
  scene.set("type", "text");
  scene.set("deleted", false);
  scene.set("prop:text", "동시에 편집하는 대사");
  scene.set("prop:x", 120);
  scene.set("prop:y", 240);
  scene.set("prop:width", 360);
  scene.set("prop:fontSize", 28);
  scene.set("prop:fill", "#111111");
  scene.set("prop:rotation", 0);
  scene.set("unset:font", false);

  const sceneOrder = new Y.Map<unknown>();
  sceneOrder.set("elementId", "scene-1");
  sceneOrder.set("pageId", "page-1");
  sceneOrder.set("layerId", "layer-1");
  sceneOrder.set("kind", "scene");
  sceneOrder.set("active", true);
  doc.getArray<Y.Map<unknown>>("stroke-order").push([sceneOrder]);

  doc.getMap<boolean>("studio-pages").set("page-1", true);
  const page = doc.getMap<unknown>("studio-page:page-1");
  page.set("id", "page-1");
  page.set("payloadVersion", 1);
  page.set("deleted", false);
  page.set("prop:bg", "#ffffff");
  page.set("prop:bgGrad", null);
  page.set("prop:canvasH", 1080);
  const pageOrder = new Y.Map<unknown>();
  pageOrder.set("pageId", "page-1");
  pageOrder.set("active", true);
  doc.getArray<Y.Map<unknown>>("page-order").push([pageOrder]);
  return doc;
}

function addShared3dStageSidecar(doc: Y.Doc): string {
  const stageId = "stage-1";
  const key = encodeStudioCrdtShared3dCompositeKey("page-1", stageId);
  doc.getMap<boolean>(STUDIO_CRDT_SHARED_3D_STAGE_RECORDS_ROOT).set(key, true);
  const record = doc.getMap<unknown>(
    `${STUDIO_CRDT_SHARED_3D_STAGE_RECORD_ROOT_PREFIX}${encodeURIComponent(key)}`
  );
  record.set("pageId", "page-1");
  record.set("stageId", stageId);
  record.set("payloadVersion", 1);
  record.set("order", 0);
  record.set("payload", JSON.stringify({
    id: stageId,
    capturePolicy: "background-only",
    background: {
      bundleId: "bundle-1",
      sourceHash: `sha256:${"a".repeat(64)}`,
    },
    characters: [],
  }));
  record.set("deactivate:0", true);
  doc.getMap<boolean>(STUDIO_CRDT_SHARED_3D_STAGE_VISIBILITY_RECEIPTS_ROOT);
  return key;
}

function createDrawingAssistDocument() {
  return {
    version: 2,
    perspective: {
      active: false,
      points: [
        { id: "vp-left", x: -10_000_000, y: 10_000_000 },
        { id: "vp-center", x: 400, y: 320 },
        { id: "vp-right", x: 10_000_000, y: -10_000_000 },
      ],
      eyeLevelY: 320,
      lockHorizon: true,
    },
    isometric: {
      active: false,
      angleDeg: 1,
      cellSize: 200,
      originX: -10_000_000,
      originY: 10_000_000,
    },
    advanced: {
      version: 1,
      rulers: [
        {
          id: "curve-a",
          type: "curve",
          name: "곡선자",
          enabled: true,
          visible: true,
          scope: { kind: "page", groupId: null },
          snapMode: "fixed",
          fixedOffset: -1_000_000,
          p0: { x: -10_000_000, y: 10_000_000 },
          p1: { x: -100, y: 200 },
          p2: { x: 100, y: 200 },
          p3: { x: 10_000_000, y: -10_000_000 },
        },
        {
          id: "fisheye-a",
          type: "fisheye",
          name: "어안자",
          enabled: true,
          visible: true,
          scope: { kind: "group", groupId: "background" },
          guideFamily: "auto",
          centerX: 400,
          centerY: 600,
          radius: 8,
          rotationDeg: 359,
          fovDeg: 220,
          strength: 0.25,
          outsidePolicy: "clamp",
        },
      ],
      activeSnapRulerId: "curve-a",
      selectedRulerId: "fisheye-a",
    },
  };
}

function createLegacyDrawingAssistDocument() {
  const current = createDrawingAssistDocument();
  return {
    version: 1,
    perspective: current.perspective,
    isometric: current.isometric,
  };
}

type TestDrawingAssistDocument = ReturnType<typeof createDrawingAssistDocument>;

const DELETION_OPERATION_ID = "00000000-0000-4000-8000-000000000301";
const DELETION_TARGET = JSON.stringify(["scene", "scene-1"]);

function addSceneDeletionProtocol(doc: Y.Doc, acknowledged = false): void {
  doc.getMap<string>("studio-deletion-ops").set(DELETION_OPERATION_ID, DELETION_TARGET);
  if (acknowledged) {
    doc.getMap<string>("studio-deletion-acks").set(DELETION_OPERATION_ID, DELETION_TARGET);
  }
}

const RASTER_SURFACE = {
  version: STUDIO_RASTER_CRDT_VERSION,
  surfaceId: "surface-main",
  width: 128,
  height: 128,
  tileSize: 128,
} as const;
const RASTER_OPERATION_ID = "30000000-0000-4000-8000-000000000401";
const RASTER_UNDO_ID = "30000000-0000-4000-8000-000000000402";
const RASTER_ACK_ID = "30000000-0000-4000-8000-000000000403";
const RASTER_CHECKPOINT_ID = "30000000-0000-4000-8000-000000000404";

function rasterAsset(assetId: string, width = 16, height = 16) {
  return {
    scope: "work" as const,
    assetId,
    sha256: "a".repeat(64),
    byteLength: 1_024,
    mediaType: "image/png" as const,
    width,
    height,
  };
}

function rasterOperation(
  operationId = RASTER_OPERATION_ID,
  semanticParametersSha256 = "b".repeat(64),
  actorId = "editor",
  logicalClock = "1"
): StudioRasterOperation {
  return {
    version: STUDIO_RASTER_CRDT_VERSION,
    operationId,
    order: { logicalClock, actorId },
    pageId: "page-1",
    layerId: "layer-ink",
    intent: "paint",
    kernel: STUDIO_RASTER_KERNEL,
    semanticParametersSha256,
    patches: [{
      tileX: 0,
      tileY: 0,
      region: { x: 0, y: 0, width: 16, height: 16 },
      effect: {
        kind: "composite",
        blendMode: "source-over",
        payload: rasterAsset(`patch-${operationId}`),
      },
    }],
  };
}

function rasterOperationUsingAsset(
  reference: StudioRasterAssetReference,
  operationId: string,
  semanticParametersSha256 = "b".repeat(64),
  actorId = "editor",
  logicalClock = "1"
): StudioRasterOperation {
  const operation = rasterOperation(
    operationId,
    semanticParametersSha256,
    actorId,
    logicalClock
  );
  const [patch] = operation.patches;
  if (!patch) throw new Error("raster operation fixture requires one patch");
  return {
    ...operation,
    patches: [{
      ...patch,
      effect: {
        kind: "composite",
        blendMode: "source-over",
        payload: reference,
      },
    }],
  };
}

class ExactRasterAssetAdmission implements StudioCrdtRasterAssetAdmission {
  readonly calls: Array<{
    actorUserId: string;
    workId: string;
    references: readonly StudioRasterAssetReference[];
  }> = [];
  readonly transactions: Array<DrizzleStudioCrdtTransaction | undefined> = [];
  private readonly stored = new Map<string, string>();

  constructor(references: readonly StudioRasterAssetReference[]) {
    for (const reference of references) {
      this.stored.set(reference.assetId, canonicalStudioRasterJson(reference));
    }
  }

  async assertReferencesStored(
    actorUserId: string,
    workId: string,
    references: readonly StudioRasterAssetReference[],
    transaction?: DrizzleStudioCrdtTransaction
  ): Promise<void> {
    this.transactions.push(transaction);
    this.calls.push({
      actorUserId,
      workId,
      references: references.map((reference) => ({ ...reference })),
    });
    for (const reference of references) {
      if (this.stored.get(reference.assetId) !== canonicalStudioRasterJson(reference)) {
        throw new Error("missing or mismatched raster asset");
      }
    }
  }
}

class ExactWorkAssetAdmission implements StudioCrdtWorkAssetAdmission {
  readonly calls: Array<{
    actorUserId: string;
    workId: string;
    references: readonly StudioWorkAssetReference[];
  }> = [];
  readonly transactions: Array<DrizzleStudioCrdtTransaction | undefined> = [];
  private readonly stored = new Set<string>();

  constructor(references: readonly StudioWorkAssetReference[]) {
    for (const reference of references) {
      this.stored.add(JSON.stringify([reference.assetId, reference.elementType]));
    }
  }

  async assertReferencesStored(
    actorUserId: string,
    workId: string,
    references: readonly StudioWorkAssetReference[],
    transaction?: DrizzleStudioCrdtTransaction
  ): Promise<void> {
    this.transactions.push(transaction);
    this.calls.push({
      actorUserId,
      workId,
      references: references.map((reference) => ({ ...reference })),
    });
    for (const reference of references) {
      if (!this.stored.has(JSON.stringify([reference.assetId, reference.elementType]))) {
        throw new Error("missing or mismatched work asset");
      }
    }
  }

  async assertR8GrainReferencesStored(): Promise<void> {
    // Exact R8 admission has its own focused fixture; generic work-asset tests do not append it.
  }
}

interface RasterDocumentFixtureOptions {
  operation?: StudioRasterOperation | false;
  undo?: boolean;
  acknowledgement?: boolean;
  checkpoint?: boolean;
  actorId?: string;
  undoActorId?: string;
  acknowledgementActorId?: string;
}

function createRasterDocument(options: RasterDocumentFixtureOptions = {}): Y.Doc {
  const operation = options.operation === false
    ? null
    : (options.operation ?? rasterOperation(
        RASTER_OPERATION_ID,
        "b".repeat(64),
        options.actorId
      ));
  const undo: StudioRasterUndoOperation | null = options.undo || options.acknowledgement
    ? {
        version: STUDIO_RASTER_CRDT_VERSION,
        undoOperationId: RASTER_UNDO_ID,
        targetOperationId: operation?.operationId ?? RASTER_OPERATION_ID,
        order: {
          logicalClock: "2",
          actorId: options.undoActorId ?? options.actorId ?? "editor",
        },
      }
    : null;
  const acknowledgement: StudioRasterUndoAcknowledgement | null = options.acknowledgement
    ? {
        version: STUDIO_RASTER_CRDT_VERSION,
        acknowledgementId: RASTER_ACK_ID,
        undoOperationId: RASTER_UNDO_ID,
        targetOperationId: operation?.operationId ?? RASTER_OPERATION_ID,
        order: {
          logicalClock: "3",
          actorId: options.acknowledgementActorId ?? options.actorId ?? "editor",
        },
      }
    : null;
  const log = createStudioRasterOperationLog({
    version: STUDIO_RASTER_CRDT_VERSION,
    surface: RASTER_SURFACE,
    operations: operation ? [operation] : [],
    undoOperations: undo ? [undo] : [],
    undoAcknowledgements: acknowledgement ? [acknowledgement] : [],
  });
  const doc = new Y.Doc();
  doc.getMap<string>(STUDIO_CRDT_RASTER_SURFACES_ROOT).set(
    RASTER_SURFACE.surfaceId,
    canonicalStudioRasterJson(RASTER_SURFACE)
  );
  if (operation) {
    doc.getMap<string>(STUDIO_CRDT_RASTER_OPERATIONS_ROOT).set(
      operation.operationId,
      canonicalStudioRasterJson({ surfaceId: RASTER_SURFACE.surfaceId, operation })
    );
  }
  if (undo) {
    doc.getMap<string>(STUDIO_CRDT_RASTER_UNDO_OPERATIONS_ROOT).set(
      undo.undoOperationId,
      canonicalStudioRasterJson({ surfaceId: RASTER_SURFACE.surfaceId, undoOperation: undo })
    );
  }
  if (acknowledgement) {
    doc.getMap<string>(STUDIO_CRDT_RASTER_UNDO_ACKS_ROOT).set(
      acknowledgement.acknowledgementId,
      canonicalStudioRasterJson({
        surfaceId: RASTER_SURFACE.surfaceId,
        acknowledgement,
      })
    );
  }
  if (options.checkpoint) {
    if (!operation) throw new Error("checkpoint fixture requires an operation");
    const through = acknowledgement
      ? { ...acknowledgement.order, eventId: acknowledgement.acknowledgementId }
      : undo
        ? { ...undo.order, eventId: undo.undoOperationId }
        : { ...operation.order, eventId: operation.operationId };
    const { checkpoint } = compactStudioRasterOperationLog(log, {
      checkpointId: RASTER_CHECKPOINT_ID,
      through,
      requiredReplicaIds: ["replica-a"],
      stabilityProof: {
        version: STUDIO_RASTER_CRDT_VERSION,
        proofId: "30000000-0000-4000-8000-000000000405",
        undoHorizonClosedThrough: through,
        replicaFrontiers: [{ replicaId: "replica-a", through }],
      },
      tileManifestSha256: "c".repeat(64),
      tiles: [{ tileX: 0, tileY: 0, asset: rasterAsset("checkpoint-main", 128, 128) }],
    });
    doc.getMap<string>(STUDIO_CRDT_RASTER_CHECKPOINTS_ROOT).set(
      checkpoint.checkpointId,
      canonicalStudioRasterJson(checkpoint)
    );
  }
  return doc;
}

function createSceneOrderFloodDocument(activeEntryCount: number): Y.Doc {
  const doc = createScenePageDocument();
  const order = doc.getArray<Y.Map<unknown>>("stroke-order");
  for (let index = 1; index < activeEntryCount; index += 1) {
    const entry = new Y.Map<unknown>();
    entry.set("elementId", "scene-1");
    entry.set("pageId", "page-1");
    entry.set("layerId", "layer-1");
    entry.set("kind", "scene");
    entry.set("active", true);
    order.push([entry]);
  }
  return doc;
}

function twoPartyBarrier(): () => Promise<void> {
  let arrivals = 0;
  let release: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    arrivals += 1;
    if (arrivals === 2) release?.();
    await ready;
  };
}

function createReferenceTopologyDocument(elementType = "image"): Y.Doc {
  const doc = createScenePageDocument();
  const scene = doc.getMap<unknown>("scene-element:scene-1");
  scene.set("type", "reference");
  for (const key of [...scene.keys()]) {
    if (key.startsWith("base:") || key.startsWith("prop:") || key.startsWith("unset:")) {
      scene.delete(key);
    }
  }
  scene.set("prop:elementType", elementType);
  scene.set("prop:x", 10);
  scene.set("prop:y", 20);
  scene.set("prop:width", 300);
  scene.set("prop:height", 400);
  scene.set("prop:rotation", 0);
  return doc;
}

function createLegacyReferenceTopologyDocument(elementType = "image"): Y.Doc {
  const doc = createReferenceTopologyDocument(elementType);
  const scene = doc.getMap<unknown>("scene-element:scene-1");
  for (const key of [...scene.keys()]) {
    if (
      (key.startsWith("base:") || key.startsWith("prop:") || key.startsWith("unset:")) &&
      key !== "prop:elementType"
    ) {
      scene.delete(key);
    }
  }
  return doc;
}

function createReferenceTopologyFloodDocument(activeReferenceCount: number): Y.Doc {
  const doc = createReferenceTopologyDocument();
  const index = doc.getMap<boolean>("scene-elements");
  const order = doc.getArray<Y.Map<unknown>>("stroke-order");
  for (let position = 2; position <= activeReferenceCount; position += 1) {
    const id = `asset-${position}`;
    index.set(id, true);
    const scene = doc.getMap<unknown>(`scene-element:${id}`);
    scene.set("id", id);
    scene.set("pageId", "page-1");
    scene.set("layerId", "layer-1");
    scene.set("payloadVersion", 1);
    scene.set("type", "reference");
    scene.set("deleted", false);
    scene.set("prop:elementType", "image");
    scene.set("prop:x", position * 10);
    scene.set("prop:y", 20);
    scene.set("prop:width", 300);
    scene.set("prop:height", 400);
    scene.set("prop:rotation", 0);
    const sceneOrder = new Y.Map<unknown>();
    sceneOrder.set("elementId", id);
    sceneOrder.set("pageId", "page-1");
    sceneOrder.set("layerId", "layer-1");
    sceneOrder.set("kind", "scene");
    sceneOrder.set("active", true);
    order.push([sceneOrder]);
  }
  return doc;
}

function addLayerGroup(
  doc: Y.Doc,
  options: {
    id?: string;
    pageId?: string;
    name?: string;
  } = {}
): Y.Map<unknown> {
  const id = options.id ?? "group-1";
  const pageId = options.pageId ?? "page-1";
  const key = `${pageId.length}:${pageId}${id.length}:${id}`;
  doc.getMap<boolean>("layer-groups").set(key, true);
  const group = doc.getMap<unknown>(`layer-group:${encodeURIComponent(key)}`);
  group.set("id", id);
  group.set("pageId", pageId);
  group.set("payloadVersion", 1);
  group.set("deleted", false);
  group.set("prop:name", options.name ?? "선화");
  group.set("unset:name", false);
  return group;
}

function createStrokeDocument(): Y.Doc {
  const doc = new Y.Doc();
  const stroke = new Y.Map<unknown>();
  stroke.set("id", "stroke-1");
  stroke.set("pageId", "page-1");
  stroke.set("layerId", "page-root");
  stroke.set("status", "finalized");
  stroke.set("deleted", false);
  stroke.set("payloadVersion", 1);
  stroke.set("type", "draw");
  stroke.set("mode", "pen");
  stroke.set("kind", "freehand");
  stroke.set("stroke", "#111111");
  stroke.set("strokeWidth", 8);
  for (const key of [
    "points", "pressures", "tiltXs", "tiltYs", "twists", "speeds", "tangentialPressures",
  ]) stroke.set(key, new Y.Array<number>());
  doc.getMap<Y.Map<unknown>>("strokes").set("stroke-1", stroke);
  const order = new Y.Map<unknown>();
  order.set("strokeId", "stroke-1");
  order.set("pageId", "page-1");
  order.set("layerId", "page-root");
  order.set("active", true);
  doc.getArray<Y.Map<unknown>>("stroke-order").push([order]);
  return doc;
}

function syncBytes(sync: Awaited<ReturnType<StudioCrdtService["sync"]>>): Uint8Array {
  const result = new Uint8Array(sync.totalBytes);
  let offset = 0;
  for (const chunk of sync.chunks) {
    const decoded = toUint8Array(chunk);
    result.set(decoded, offset);
    offset += decoded.byteLength;
  }
  expect(offset).toBe(sync.totalBytes);
  expect(sync.chunkCount).toBe(sync.chunks.length);
  return result;
}

function applySync(
  target: Y.Doc,
  sync: Awaited<ReturnType<StudioCrdtService["sync"]>>
): void {
  Y.applyUpdate(target, syncBytes(sync));
}

describe("StudioCrdtService", () => {
  it("keeps raw binary apply/sync semantics identical to the legacy Base64 wrappers", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const current = service(repository);
    const originalUpdate = toUint8Array(yUpdate("binary", "1"));

    const binaryResult = await current.applyUpdateBytes({
      workId: "work-binary",
      updateId: "00000000-0000-4000-8000-000000000601",
      actorUserId: "editor",
      data: originalUpdate,
    });
    const legacyRetry = await current.applyUpdate({
      workId: "work-binary",
      updateId: "00000000-0000-4000-8000-000000000601",
      actorUserId: "editor",
      data: fromUint8Array(originalUpdate),
    });

    expect(binaryResult).toMatchObject({
      duplicate: false,
      updateId: "00000000-0000-4000-8000-000000000601",
      serverSequence: "1",
    });
    expect(legacyRetry).toMatchObject({
      duplicate: true,
      updateId: binaryResult.updateId,
      serverSequence: binaryResult.serverSequence,
    });
    expect(toUint8Array(legacyRetry.update)).toEqual(binaryResult.update);
    expect(toUint8Array(legacyRetry.serverStateVector)).toEqual(
      binaryResult.serverStateVector
    );

    const binarySync = await current.syncBytes("work-binary");
    const legacySync = await current.sync("work-binary");
    expect(binarySync.update).toEqual(syncBytes(legacySync));
    expect(binarySync.serverStateVector).toEqual(
      toUint8Array(legacySync.serverStateVector)
    );
    expect(binarySync).toMatchObject({
      totalBytes: legacySync.totalBytes,
      serverSequence: legacySync.serverSequence,
    });
  });

  it("owns raw binary inputs before asynchronous persistence and accepts Buffer byte views", async () => {
    const repository = new MemoryStudioCrdtRepository();
    let releaseAppend: (() => void) | undefined;
    let markAppendStarted: (() => void) | undefined;
    const appendStarted = new Promise<void>((resolve) => {
      markAppendStarted = resolve;
    });
    repository.beforeAppend = () => {
      markAppendStarted?.();
      return new Promise<void>((resolve) => {
        releaseAppend = resolve;
      });
    };
    const current = service(repository);
    const update = toUint8Array(yUpdate("owned", "yes"));
    const expected = Uint8Array.from(update);
    const pending = current.applyUpdateBytes({
      workId: "work-owned-binary",
      updateId: "00000000-0000-4000-8000-000000000602",
      actorUserId: "editor",
      data: update,
    });
    await appendStarted;
    update.fill(0);
    releaseAppend?.();
    await expect(pending).resolves.toMatchObject({ duplicate: false, serverSequence: "1" });
    expect(repository.updates.get("work-owned-binary")?.[0]?.payload).toEqual(expected);

    repository.beforeAppend = null;
    await expect(
      current.applyUpdateBytes({
        workId: "work-owned-binary",
        updateId: "00000000-0000-4000-8000-000000000603",
        actorUserId: "editor",
        data: Buffer.from(toUint8Array(yUpdate("buffer", "accepted"))),
      })
    ).resolves.toMatchObject({ duplicate: false, serverSequence: "2" });
  });

  it("fails closed on empty or oversized raw updates and state vectors", async () => {
    const current = service(new MemoryStudioCrdtRepository());
    const baseInput = {
      workId: "work-binary-invalid",
      updateId: "00000000-0000-4000-8000-000000000604",
      actorUserId: "editor",
    };

    await expect(
      current.applyUpdateBytes({ ...baseInput, data: new Uint8Array() })
    ).rejects.toBeInstanceOf(StudioCrdtInvalidPayloadError);
    await expect(
      current.applyUpdateBytes({
        ...baseInput,
        data: new Uint8Array(STUDIO_CRDT_UPDATE_MAX_BYTES + 1),
      })
    ).rejects.toBeInstanceOf(StudioCrdtInvalidPayloadError);
    await expect(current.syncBytes("work-binary-invalid", new Uint8Array()))
      .rejects.toBeInstanceOf(StudioCrdtInvalidPayloadError);
    await expect(
      current.syncBytes(
        "work-binary-invalid",
        new Uint8Array(256 * 1_024 + 1)
      )
    ).rejects.toBeInstanceOf(StudioCrdtInvalidPayloadError);
  });

  it("returns an owned raw state vector within the configured byte budget", () => {
    const doc = new Y.Doc();
    doc.getMap<string>("root").set("stroke", "1");
    const expected = Y.encodeStateVector(doc);
    const encoded = encodeStudioCrdtServerStateVectorBytes(doc);

    expect(encoded).toEqual(expected);
    expect(() =>
      encodeStudioCrdtServerStateVectorBytes(doc, expected.byteLength - 1)
    ).toThrow(StudioCrdtStorageCorruptionError);
    doc.destroy();
  });

  it("strictly rejects malformed base64, malformed Yjs updates, and non-UUID ids", async () => {
    const current = service(new MemoryStudioCrdtRepository());
    await expect(current.sync("work-1", "not-base64")).rejects.toBeInstanceOf(
      StudioCrdtInvalidPayloadError
    );
    await expect(
      current.applyUpdate({
        workId: "work-1",
        updateId: "not-a-uuid",
        actorUserId: "editor",
        data: yUpdate("a", "1"),
      })
    ).rejects.toBeInstanceOf(StudioCrdtInvalidPayloadError);
    await expect(
      current.applyUpdate({
        workId: "work-1",
        updateId: "00000000-0000-4000-8000-000000000001",
        actorUserId: "editor",
        data: fromUint8Array(Uint8Array.of(255, 255, 255)),
      })
    ).rejects.toBeInstanceOf(StudioCrdtInvalidPayloadError);
  });

  it("rejects syntactically valid Yjs updates that poison Studio root collection types", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const current = service(repository);
    const poison = new Y.Doc();
    poison.getMap<unknown>("strokes").set("poison", "not-a-map");

    await expect(
      current.applyUpdate({
        workId: "work-1",
        updateId: "00000000-0000-4000-8000-000000000102",
        actorUserId: "editor",
        data: fromUint8Array(Y.encodeStateAsUpdate(poison)),
      })
    ).rejects.toBeInstanceOf(StudioCrdtInvalidPayloadError);
    expect(repository.updates.get("work-1") ?? []).toEqual([]);
    expect(repository.receipts.size).toBe(0);
    poison.destroy();
  });

  it("accepts bounded scene/page/group field CRDT roots and their mixed z-order entries", () => {
    const doc = createScenePageDocument();
    const group = addLayerGroup(doc);
    group.set("prop:hidden", true);
    group.set("unset:locked", true);
    doc.getMap<string>("future-compatible-root").set("key", "unreserved roots stay compatible");

    expect(hasValidStudioCrdtRootSchema(doc)).toBe(true);
    doc.destroy();
  });

  it("persists and rehydrates the canonical page drawing-assist v2 contract", async () => {
    const doc = createScenePageDocument();
    doc.getMap<unknown>("studio-page:page-1")
      .set("prop:drawingAssist", createDrawingAssistDocument());

    expect(hasValidStudioCrdtRootSchema(doc)).toBe(true);
    const current = service(new MemoryStudioCrdtRepository());
    await expect(current.applyUpdate({
      workId: "work-drawing-assist",
      updateId: "00000000-0000-4000-8000-000000000509",
      actorUserId: "editor",
      data: fromUint8Array(Y.encodeStateAsUpdate(doc)),
    })).resolves.toMatchObject({ duplicate: false, serverSequence: "1" });

    const hydrated = new Y.Doc();
    applySync(hydrated, await current.sync("work-drawing-assist"));
    expect(
      hydrated.getMap<unknown>("studio-page:page-1").get("prop:drawingAssist")
    ).toEqual(createDrawingAssistDocument());
    doc.destroy();
    hydrated.destroy();
  });

  it("continues to admit the exact legacy drawing-assist v1 contract", () => {
    const doc = createScenePageDocument();
    doc.getMap<unknown>("studio-page:page-1")
      .set("prop:drawingAssist", createLegacyDrawingAssistDocument());
    expect(hasValidStudioCrdtRootSchema(doc)).toBe(true);

    const legacyWithCurrentField = {
      ...createLegacyDrawingAssistDocument(),
      advanced: createDrawingAssistDocument().advanced,
    };
    doc.getMap<unknown>("studio-page:page-1")
      .set("prop:drawingAssist", legacyWithCurrentField);
    expect(hasValidStudioCrdtRootSchema(doc)).toBe(false);
    doc.destroy();
  });

  it("rejects malformed page drawing-assist documents", () => {
    const invalidCases: Array<[
      label: string,
      mutate: (value: TestDrawingAssistDocument) => void,
    ]> = [
      ["unknown root key", (value) => {
        (value as unknown as Record<string, unknown>).plugin = true;
      }],
      ["unsupported version", (value) => { value.version = 3; }],
      ["advanced and perspective rulers both active", (value) => {
        value.perspective.active = true;
      }],
      ["perspective and isometric rulers both active", (value) => {
        value.advanced.activeSnapRulerId = null;
        value.perspective.active = true;
        value.isometric.active = true;
      }],
      ["more than three points", (value) => {
        value.perspective.points.push({ id: "vp-four", x: 0, y: 0 });
      }],
      ["duplicate point ids", (value) => {
        value.perspective.points[1]!.id = value.perspective.points[0]!.id;
      }],
      ["empty point id", (value) => { value.perspective.points[0]!.id = ""; }],
      ["oversized point id", (value) => { value.perspective.points[0]!.id = "x".repeat(161); }],
      ["control character point id", (value) => { value.perspective.points[0]!.id = "vp\u0000"; }],
      ["out-of-range point coordinate", (value) => {
        value.perspective.points[0]!.x = 10_000_001;
      }],
      ["non-finite point coordinate", (value) => {
        value.perspective.points[0]!.y = Number.POSITIVE_INFINITY;
      }],
      ["unknown point key", (value) => {
        (value.perspective.points[0] as Record<string, unknown>).weight = 1;
      }],
      ["unknown perspective key", (value) => {
        (value.perspective as unknown as Record<string, unknown>).mode = "three-point";
      }],
      ["angle below range", (value) => { value.isometric.angleDeg = 0; }],
      ["angle above range", (value) => { value.isometric.angleDeg = 90; }],
      ["cell size below range", (value) => { value.isometric.cellSize = 7; }],
      ["cell size above range", (value) => { value.isometric.cellSize = 201; }],
      ["out-of-range origin", (value) => { value.isometric.originY = 10_000_001; }],
      ["missing isometric key", (value) => {
        delete (value.isometric as unknown as Record<string, unknown>).originY;
      }],
      ["unknown isometric key", (value) => {
        (value.isometric as unknown as Record<string, unknown>).skew = 0;
      }],
      ["missing advanced document", (value) => {
        delete (value as unknown as Record<string, unknown>).advanced;
      }],
      ["unknown advanced key", (value) => {
        (value.advanced as unknown as Record<string, unknown>).future = true;
      }],
      ["duplicate advanced ruler ids", (value) => {
        value.advanced.rulers[1]!.id = value.advanced.rulers[0]!.id;
      }],
      ["inactive active snap ruler", (value) => {
        value.advanced.rulers[0]!.enabled = false;
      }],
      ["invalid group scope", (value) => {
        value.advanced.rulers[1]!.scope.groupId = null;
      }],
      ["collapsed curve control polygon", (value) => {
        const curve = value.advanced.rulers[0]!;
        if (curve.type !== "curve") throw new Error("curve fixture missing");
        curve.p1 = { ...curve.p0 };
        curve.p2 = { ...curve.p0 };
        curve.p3 = { ...curve.p0 };
      }],
      ["non-canonical fisheye rotation", (value) => {
        const fisheye = value.advanced.rulers[1]!;
        if (fisheye.type !== "fisheye") throw new Error("fisheye fixture missing");
        fisheye.rotationDeg = 360;
      }],
    ];

    for (const [label, mutate] of invalidCases) {
      const doc = createScenePageDocument();
      const value = createDrawingAssistDocument();
      mutate(value);
      doc.getMap<unknown>("studio-page:page-1").set("prop:drawingAssist", value);
      expect(hasValidStudioCrdtRootSchema(doc), label).toBe(false);
      doc.destroy();
    }
  });

  it("rejects hidden invalid drawing-assist candidates and advanced/page payloads over budget", () => {
    const hiddenInvalid = createScenePageDocument();
    const invalidBaseline = createDrawingAssistDocument();
    invalidBaseline.version = 3;
    const hiddenPage = hiddenInvalid.getMap<unknown>("studio-page:page-1");
    hiddenPage.set("base:drawingAssist", invalidBaseline);
    hiddenPage.set("prop:drawingAssist", createDrawingAssistDocument());
    expect(hasValidStudioCrdtRootSchema(hiddenInvalid)).toBe(false);
    hiddenInvalid.destroy();

    const oversizedAdvanced = createScenePageDocument();
    const oversizedAdvancedValue = createDrawingAssistDocument();
    const curve = oversizedAdvancedValue.advanced.rulers[0]!;
    if (curve.type !== "curve") throw new Error("curve fixture missing");
    oversizedAdvancedValue.advanced.rulers = Array.from({ length: 12 }, (_, index) => ({
      ...curve,
      id: `curve-${index}-${"x".repeat(140)}`,
      name: "곡".repeat(80),
    }));
    oversizedAdvancedValue.advanced.activeSnapRulerId = null;
    oversizedAdvancedValue.advanced.selectedRulerId = null;
    oversizedAdvanced.getMap<unknown>("studio-page:page-1")
      .set("prop:drawingAssist", oversizedAdvancedValue);
    expect(hasValidStudioCrdtRootSchema(oversizedAdvanced)).toBe(false);
    oversizedAdvanced.destroy();

    const oversized = createScenePageDocument();
    const oversizedPage = oversized.getMap<unknown>("studio-page:page-1");
    oversizedPage.set("prop:drawingAssist", createDrawingAssistDocument());
    // 3,000 Hangul code points are within the note's character limit but exceed 8 KiB as UTF-8.
    oversizedPage.set("prop:note", "가".repeat(3_000));
    expect(hasValidStudioCrdtRootSchema(oversized)).toBe(false);
    oversized.destroy();
  });

  it("accepts canonical flat deletion operations and rejects malformed or orphan acknowledgements", () => {
    const valid = createScenePageDocument();
    const validGroup = addLayerGroup(valid);
    addSceneDeletionProtocol(valid, true);
    valid.getMap("scene-element:scene-1").delete("deleted");
    valid.getMap("studio-page:page-1").delete("deleted");
    validGroup.delete("deleted");
    expect(hasValidStudioCrdtRootSchema(valid)).toBe(true);
    valid.destroy();

    const validStroke = createStrokeDocument();
    (validStroke.getMap("strokes").get("stroke-1") as Y.Map<unknown>).delete("deleted");
    expect(hasValidStudioCrdtRootSchema(validStroke)).toBe(true);
    validStroke.destroy();

    const invalidCases: Array<(doc: Y.Doc) => void> = [
      (doc) => doc.getMap<string>("studio-deletion-ops").set("not-a-uuid", DELETION_TARGET),
      (doc) => doc.getMap<string>("studio-deletion-ops").set(
        DELETION_OPERATION_ID,
        '[ "scene", "scene-1" ]'
      ),
      (doc) => doc.getMap<string>("studio-deletion-ops").set(
        DELETION_OPERATION_ID,
        JSON.stringify(["scene", "missing-scene"])
      ),
      (doc) => doc.getMap<string>("studio-deletion-acks").set(
        DELETION_OPERATION_ID,
        DELETION_TARGET
      ),
      (doc) => {
        addSceneDeletionProtocol(doc);
        doc.getMap<string>("studio-deletion-acks").set(
          DELETION_OPERATION_ID,
          JSON.stringify(["page", "page-1"])
        );
      },
      (doc) => doc.getMap<unknown>("studio-deletion-ops").set(
        DELETION_OPERATION_ID,
        new Y.Map<unknown>()
      ),
    ];
    for (const mutate of invalidCases) {
      const invalid = createScenePageDocument();
      mutate(invalid);
      expect(hasValidStudioCrdtRootSchema(invalid)).toBe(false);
      invalid.destroy();
    }
  });

  it.each(["operation", "acknowledgement"] as const)(
    "rejects removal of an existing grow-only deletion %s before durable storage",
    async (kind) => {
      const repository = new MemoryStudioCrdtRepository();
      const current = service(repository);
      const base = createScenePageDocument();
      addSceneDeletionProtocol(base, kind === "acknowledgement");
      const baseUpdate = Y.encodeStateAsUpdate(base);
      await current.applyUpdate({
        workId: `work-grow-only-${kind}`,
        updateId: kind === "operation"
          ? "00000000-0000-4000-8000-000000000302"
          : "00000000-0000-4000-8000-000000000303",
        actorUserId: "editor",
        data: fromUint8Array(baseUpdate),
      });

      const attacker = new Y.Doc();
      Y.applyUpdate(attacker, baseUpdate);
      const stateVector = Y.encodeStateVector(attacker);
      attacker.getMap(
        kind === "operation" ? "studio-deletion-ops" : "studio-deletion-acks"
      ).delete(DELETION_OPERATION_ID);
      const rewrite = Y.encodeStateAsUpdate(attacker, stateVector);
      expect(hasValidStudioCrdtRootSchema(attacker)).toBe(true);

      await expect(current.applyUpdate({
        workId: `work-grow-only-${kind}`,
        updateId: kind === "operation"
          ? "00000000-0000-4000-8000-000000000304"
          : "00000000-0000-4000-8000-000000000305",
        actorUserId: "editor",
        data: fromUint8Array(rewrite),
      })).rejects.toBeInstanceOf(StudioCrdtInvalidPayloadError);
      expect(repository.updates.get(`work-grow-only-${kind}`)).toHaveLength(1);
      expect(repository.receipts.size).toBe(1);
      base.destroy();
      attacker.destroy();
    }
  );

  it("rejects removal of an existing Shared Stage ownership tombstone before storage", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const current = service(repository);
    const base = createScenePageDocument();
    const stageKey = addShared3dStageSidecar(base);
    const baseUpdate = Y.encodeStateAsUpdate(base);
    await current.applyUpdate({
      workId: "work-shared-stage-grow-only",
      updateId: "00000000-0000-4000-8000-000000000312",
      actorUserId: "editor",
      data: fromUint8Array(baseUpdate),
    });

    const attacker = new Y.Doc();
    Y.applyUpdate(attacker, baseUpdate);
    const stateVector = Y.encodeStateVector(attacker);
    attacker.getMap(STUDIO_CRDT_SHARED_3D_STAGE_RECORDS_ROOT).delete(stageKey);
    const rewrite = Y.encodeStateAsUpdate(attacker, stateVector);
    expect(hasValidStudioCrdtRootSchema(attacker)).toBe(false);

    await expect(current.applyUpdate({
      workId: "work-shared-stage-grow-only",
      updateId: "00000000-0000-4000-8000-000000000313",
      actorUserId: "editor",
      data: fromUint8Array(rewrite),
    })).rejects.toBeInstanceOf(StudioCrdtInvalidPayloadError);
    expect(repository.updates.get("work-shared-stage-grow-only")).toHaveLength(1);
    base.destroy();
    attacker.destroy();
  });

  it("accepts a complete offline Shared Stage event suffix on first server sync", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const current = service(repository);
    const offline = createScenePageDocument();
    const stageKey = addShared3dStageSidecar(offline);
    const record = offline.getMap<unknown>(
      `${STUDIO_CRDT_SHARED_3D_STAGE_RECORD_ROOT_PREFIX}${encodeURIComponent(stageKey)}`
    );
    record.set("activate:0", true);
    record.set("activate:1", true);
    expect(hasValidStudioCrdtRootSchema(offline)).toBe(true);

    await current.applyUpdate({
      workId: "work-shared-stage-offline-suffix",
      updateId: "00000000-0000-4000-8000-000000000314",
      actorUserId: "editor",
      data: fromUint8Array(Y.encodeStateAsUpdate(offline)),
    });
    expect(repository.updates.get("work-shared-stage-offline-suffix")).toHaveLength(1);
    offline.destroy();
  });

  it("accepts concurrent Stage unlink and receipt addition in either server update order", async () => {
    const base = createScenePageDocument();
    const stageKey = addShared3dStageSidecar(base);
    const stageRecord = base.getMap<unknown>(
      `${STUDIO_CRDT_SHARED_3D_STAGE_RECORD_ROOT_PREFIX}${encodeURIComponent(stageKey)}`
    );
    const elementId = "character-1";
    const sourceHash = `sha256:${"b".repeat(64)}`;
    const modelRuntimeKey = `${elementId}:${sourceHash}`;
    stageRecord.set("payload", JSON.stringify({
      id: "stage-1",
      capturePolicy: "require-all-linked",
      background: {
        bundleId: "bundle-1",
        sourceHash: `sha256:${"a".repeat(64)}`,
      },
      characters: [{ elementId, modelRuntimeKey, sourceHash }],
    }));
    stageRecord.set("activate:1", true);
    const baseUpdate = Y.encodeStateAsUpdate(base);
    const baseVector = Y.encodeStateVector(base);

    const receiptAdder = new Y.Doc();
    Y.applyUpdate(receiptAdder, baseUpdate);
    const receiptKey = encodeStudioCrdtShared3dCompositeKey("page-1", elementId);
    receiptAdder.getMap<boolean>(STUDIO_CRDT_SHARED_3D_STAGE_VISIBILITY_RECEIPTS_ROOT)
      .set(receiptKey, true);
    const receiptRecord = receiptAdder.getMap<unknown>(
      `${STUDIO_CRDT_SHARED_3D_STAGE_VISIBILITY_RECEIPT_ROOT_PREFIX}${
        encodeURIComponent(receiptKey)
      }`
    );
    receiptRecord.set("pageId", "page-1");
    receiptRecord.set("elementId", elementId);
    receiptRecord.set("payloadVersion", 1);
    receiptRecord.set("modelRuntimeKey", modelRuntimeKey);
    receiptRecord.set("activate:0", true);
    const receiptUpdate = Y.encodeStateAsUpdate(receiptAdder, baseVector);

    const unlinker = new Y.Doc();
    Y.applyUpdate(unlinker, baseUpdate);
    unlinker.getMap<unknown>(
      `${STUDIO_CRDT_SHARED_3D_STAGE_RECORD_ROOT_PREFIX}${encodeURIComponent(stageKey)}`
    ).set("deactivate:1", true);
    const unlinkUpdate = Y.encodeStateAsUpdate(unlinker, baseVector);

    const orders = [
      [receiptUpdate, unlinkUpdate],
      [unlinkUpdate, receiptUpdate],
    ] as const;
    const updateIds = [
      ["00000000-0000-4000-8000-000000000315", "00000000-0000-4000-8000-000000000316"],
      ["00000000-0000-4000-8000-000000000317", "00000000-0000-4000-8000-000000000318"],
    ] as const;
    const baseUpdateIds = [
      "00000000-0000-4000-8000-000000000319",
      "00000000-0000-4000-8000-000000000320",
    ] as const;
    for (let index = 0; index < orders.length; index += 1) {
      const repository = new MemoryStudioCrdtRepository();
      const current = service(repository);
      const workId = `work-shared-stage-dormant-receipt-${index}`;
      await current.applyUpdate({
        workId,
        updateId: baseUpdateIds[index]!,
        actorUserId: "editor",
        data: fromUint8Array(baseUpdate),
      });
      for (let updateIndex = 0; updateIndex < 2; updateIndex += 1) {
        await current.applyUpdate({
          workId,
          updateId: updateIds[index]![updateIndex]!,
          actorUserId: "editor",
          data: fromUint8Array(orders[index]![updateIndex]!),
        });
      }
      expect(repository.updates.get(workId)).toHaveLength(3);
      const hydrated = new Y.Doc();
      applySync(hydrated, await service(repository).sync(workId));
      expect(hasValidStudioCrdtRootSchema(hydrated)).toBe(true);
      hydrated.destroy();
    }

    base.destroy();
    receiptAdder.destroy();
    unlinker.destroy();
  });

  it("classifies a persisted deletion-history rewrite as storage corruption during hydration", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const base = createScenePageDocument();
    addSceneDeletionProtocol(base);
    const baseUpdate = Y.encodeStateAsUpdate(base);
    const attacker = new Y.Doc();
    Y.applyUpdate(attacker, baseUpdate);
    const stateVector = Y.encodeStateVector(attacker);
    attacker.getMap("studio-deletion-ops").delete(DELETION_OPERATION_ID);
    const rewrite = Y.encodeStateAsUpdate(attacker, stateVector);
    repository.updates.set("work-corrupt-delete-history", [
      {
        workId: "work-corrupt-delete-history",
        sequence: 1n,
        updateId: "00000000-0000-4000-8000-000000000306",
        actorUserId: "editor",
        payload: baseUpdate,
        createdAt: new Date("2026-07-16T00:00:00.000Z"),
      },
      {
        workId: "work-corrupt-delete-history",
        sequence: 2n,
        updateId: "00000000-0000-4000-8000-000000000307",
        actorUserId: "editor",
        payload: rewrite,
        createdAt: new Date("2026-07-16T00:00:01.000Z"),
      },
    ]);

    await expect(service(repository).sync("work-corrupt-delete-history")).rejects.toBeInstanceOf(
      StudioCrdtStorageCorruptionError
    );
    base.destroy();
    attacker.destroy();
  });

  it("keeps the cached document unchanged when catch-up contains a deletion-history rewrite", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const current = service(repository);
    const base = createScenePageDocument();
    addSceneDeletionProtocol(base);
    const baseUpdate = Y.encodeStateAsUpdate(base);
    await current.applyUpdate({
      workId: "work-atomic-hydration",
      updateId: "00000000-0000-4000-8000-000000000308",
      actorUserId: "editor",
      data: fromUint8Array(baseUpdate),
    });

    const attacker = new Y.Doc();
    Y.applyUpdate(attacker, baseUpdate);
    const stateVector = Y.encodeStateVector(attacker);
    attacker.getMap("studio-deletion-ops").delete(DELETION_OPERATION_ID);
    const rows = repository.updates.get("work-atomic-hydration")!;
    rows.push({
      workId: "work-atomic-hydration",
      sequence: 2n,
      updateId: "00000000-0000-4000-8000-000000000309",
      actorUserId: "attacker",
      payload: Y.encodeStateAsUpdate(attacker, stateVector),
      createdAt: new Date("2026-07-16T00:00:01.000Z"),
    });

    await expect(current.sync("work-atomic-hydration")).rejects.toBeInstanceOf(
      StudioCrdtStorageCorruptionError
    );
    rows.pop();
    const hydrated = new Y.Doc();
    applySync(hydrated, await current.sync("work-atomic-hydration"));
    expect(hydrated.getMap("studio-deletion-ops").get(DELETION_OPERATION_ID)).toBe(
      DELETION_TARGET
    );
    base.destroy();
    attacker.destroy();
    hydrated.destroy();
  });

  it("validates canonical raster roots, cross-root identities, and checkpoint prefixes exactly", () => {
    const valid = createRasterDocument({ undo: true, acknowledgement: true, checkpoint: true });
    expect(hasValidStudioCrdtRootSchema(valid)).toBe(true);
    valid.destroy();

    const invalidDocuments: Y.Doc[] = [];

    const wrongRootType = new Y.Doc();
    wrongRootType.getArray(STUDIO_CRDT_RASTER_SURFACES_ROOT).push(["not-a-map"]);
    invalidDocuments.push(wrongRootType);

    const nonCanonical = createRasterDocument({ operation: false });
    nonCanonical.getMap<string>(STUDIO_CRDT_RASTER_SURFACES_ROOT).set(
      RASTER_SURFACE.surfaceId,
      JSON.stringify(RASTER_SURFACE)
    );
    invalidDocuments.push(nonCanonical);

    const unknownOperationField = createRasterDocument();
    const operationRoot = unknownOperationField.getMap<string>(STUDIO_CRDT_RASTER_OPERATIONS_ROOT);
    const operationEnvelope = JSON.parse(operationRoot.get(RASTER_OPERATION_ID)!) as {
      surfaceId: string;
      operation: Record<string, unknown>;
    };
    operationEnvelope.operation.unexpected = true;
    operationRoot.set(RASTER_OPERATION_ID, canonicalStudioRasterJson(operationEnvelope));
    invalidDocuments.push(unknownOperationField);

    const keyMismatch = createRasterDocument();
    keyMismatch.getMap<string>(STUDIO_CRDT_RASTER_OPERATIONS_ROOT).set(
      "30000000-0000-4000-8000-000000000499",
      keyMismatch.getMap<string>(STUDIO_CRDT_RASTER_OPERATIONS_ROOT).get(RASTER_OPERATION_ID)!
    );
    invalidDocuments.push(keyMismatch);

    const orphanUndo = createRasterDocument({ operation: false });
    const orphan: StudioRasterUndoOperation = {
      version: STUDIO_RASTER_CRDT_VERSION,
      undoOperationId: RASTER_UNDO_ID,
      targetOperationId: RASTER_OPERATION_ID,
      order: { logicalClock: "2", actorId: "artist-a" },
    };
    orphanUndo.getMap<string>(STUDIO_CRDT_RASTER_UNDO_OPERATIONS_ROOT).set(
      orphan.undoOperationId,
      canonicalStudioRasterJson({ surfaceId: RASTER_SURFACE.surfaceId, undoOperation: orphan })
    );
    invalidDocuments.push(orphanUndo);

    const identityCollision = createRasterDocument({ undo: true });
    const collidingAcknowledgement: StudioRasterUndoAcknowledgement = {
      version: STUDIO_RASTER_CRDT_VERSION,
      acknowledgementId: RASTER_OPERATION_ID,
      undoOperationId: RASTER_UNDO_ID,
      targetOperationId: RASTER_OPERATION_ID,
      order: { logicalClock: "3", actorId: "artist-a" },
    };
    identityCollision.getMap<string>(STUDIO_CRDT_RASTER_UNDO_ACKS_ROOT).set(
      collidingAcknowledgement.acknowledgementId,
      canonicalStudioRasterJson({
        surfaceId: RASTER_SURFACE.surfaceId,
        acknowledgement: collidingAcknowledgement,
      })
    );
    invalidDocuments.push(identityCollision);

    const invalidCheckpoint = createRasterDocument({ checkpoint: true });
    const checkpointRoot = invalidCheckpoint.getMap<string>(STUDIO_CRDT_RASTER_CHECKPOINTS_ROOT);
    const checkpoint = JSON.parse(checkpointRoot.get(RASTER_CHECKPOINT_ID)!) as Record<string, unknown>;
    checkpoint.sealedOperationIds = [];
    checkpointRoot.set(RASTER_CHECKPOINT_ID, canonicalStudioRasterJson(checkpoint));
    invalidDocuments.push(invalidCheckpoint);

    for (const invalid of invalidDocuments) {
      expect(hasValidStudioCrdtRootSchema(invalid)).toBe(false);
      invalid.destroy();
    }
  });

  it.each([
    [
      "operation",
      null,
      { actorId: "forged-user" },
      "30000000-0000-4000-8000-000000000470",
    ],
    [
      "undo",
      { actorId: "forged-user" },
      { undo: true, actorId: "forged-user" },
      "30000000-0000-4000-8000-000000000471",
    ],
    [
      "acknowledgement",
      { undo: true, actorId: "forged-user" },
      { acknowledgement: true, actorId: "forged-user" },
      "30000000-0000-4000-8000-000000000472",
    ],
  ] as const)(
    "atomically rejects a forged raster %s actor before durable update and receipt storage",
    async (_kind, baseOptions, options, updateId) => {
      const repository = new MemoryStudioCrdtRepository();
      const current = service(repository);
      const workId = `work-raster-forged-${_kind}`;
      const base = baseOptions ? createRasterDocument(baseOptions) : null;
      if (base) {
        await current.applyUpdate({
          workId,
          updateId: _kind === "undo"
            ? "30000000-0000-4000-8000-000000000478"
            : "30000000-0000-4000-8000-000000000479",
          actorUserId: "forged-user",
          data: fromUint8Array(Y.encodeStateAsUpdate(base)),
        });
      }
      const forged = createRasterDocument(options);
      const durableCount = repository.updates.get(workId)?.length ?? 0;
      const receiptCount = repository.receipts.size;

      await expect(current.applyUpdate({
        workId,
        updateId,
        actorUserId: "editor",
        data: fromUint8Array(Y.encodeStateAsUpdate(forged)),
      })).rejects.toBeInstanceOf(StudioCrdtInvalidPayloadError);
      expect(repository.updates.get(workId) ?? []).toHaveLength(durableCount);
      expect(repository.receipts.size).toBe(receiptCount);

      base?.destroy();
      forged.destroy();
    }
  );

  it("accepts a same-actor operation, undo, and acknowledgement append", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const current = service(repository);
    const authored = createRasterDocument({
      acknowledgement: true,
      actorId: "editor",
    });

    await expect(current.applyUpdate({
      workId: "work-raster-authored",
      updateId: "30000000-0000-4000-8000-000000000473",
      actorUserId: "editor",
      data: fromUint8Array(Y.encodeStateAsUpdate(authored)),
    })).resolves.toMatchObject({ duplicate: false, serverSequence: "1" });
    expect(repository.updates.get("work-raster-authored")).toHaveLength(1);
    expect(repository.receipts.size).toBe(1);

    const hydrated = new Y.Doc();
    applySync(hydrated, await current.sync("work-raster-authored"));
    expect(hydrated.getMap(STUDIO_CRDT_RASTER_OPERATIONS_ROOT).has(RASTER_OPERATION_ID))
      .toBe(true);
    expect(hydrated.getMap(STUDIO_CRDT_RASTER_UNDO_OPERATIONS_ROOT).has(RASTER_UNDO_ID))
      .toBe(true);
    expect(hydrated.getMap(STUDIO_CRDT_RASTER_UNDO_ACKS_ROOT).has(RASTER_ACK_ID))
      .toBe(true);

    authored.destroy();
    hydrated.destroy();
  });

  it("validates a newly introduced raster asset exactly and skips durable retransmissions", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const reference = {
      ...rasterAsset("a".repeat(64)),
      sha256: "a".repeat(64),
    };
    const admission = new ExactRasterAssetAdmission([reference]);
    const current = service(repository, {}, admission);
    const authored = createRasterDocument({
      operation: rasterOperationUsingAsset(
        reference,
        "30000000-0000-4000-8000-000000000482"
      ),
    });
    const data = fromUint8Array(Y.encodeStateAsUpdate(authored));

    await expect(current.applyUpdate({
      workId: "work-raster-asset-exact",
      updateId: "30000000-0000-4000-8000-000000000483",
      actorUserId: "editor",
      data,
    })).resolves.toMatchObject({ duplicate: false, serverSequence: "1" });
    expect(admission.calls).toEqual([{
      actorUserId: "editor",
      workId: "work-raster-asset-exact",
      references: [reference],
    }]);
    expect(admission.transactions).toEqual([repository.validationTransaction]);

    // A full-state retransmission contains the durable operation but introduces no new reference.
    await expect(current.applyUpdate({
      workId: "work-raster-asset-exact",
      updateId: "30000000-0000-4000-8000-000000000484",
      actorUserId: "editor",
      data,
    })).resolves.toMatchObject({ duplicate: false, serverSequence: "2" });
    expect(admission.calls).toHaveLength(1);
    expect(repository.updates.get("work-raster-asset-exact")).toHaveLength(2);
    expect(repository.receipts.size).toBe(2);

    authored.destroy();
  });

  it("atomically rejects a newly introduced raster operation with a missing asset", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const admission = new ExactRasterAssetAdmission([]);
    const current = service(repository, {}, admission);
    const missingReference = {
      ...rasterAsset("c".repeat(64)),
      sha256: "c".repeat(64),
    };
    const authored = createRasterDocument({
      operation: rasterOperationUsingAsset(
        missingReference,
        "30000000-0000-4000-8000-000000000485"
      ),
    });

    await expect(current.applyUpdate({
      workId: "work-raster-asset-missing",
      updateId: "30000000-0000-4000-8000-000000000486",
      actorUserId: "editor",
      data: fromUint8Array(Y.encodeStateAsUpdate(authored)),
    })).rejects.toBeInstanceOf(StudioCrdtInvalidPayloadError);
    expect(admission.calls).toHaveLength(1);
    expect(repository.updates.get("work-raster-asset-missing") ?? []).toHaveLength(0);
    expect(repository.receipts.size).toBe(0);

    authored.destroy();
  });

  it("atomically rejects a raster reference whose immutable metadata differs from storage", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const storedReference = {
      ...rasterAsset("d".repeat(64)),
      sha256: "d".repeat(64),
    };
    const admission = new ExactRasterAssetAdmission([storedReference]);
    const current = service(repository, {}, admission);
    const mismatchedReference = { ...storedReference, byteLength: 2_048 };
    const authored = createRasterDocument({
      operation: rasterOperationUsingAsset(
        mismatchedReference,
        "30000000-0000-4000-8000-000000000487"
      ),
    });

    await expect(current.applyUpdate({
      workId: "work-raster-asset-mismatch",
      updateId: "30000000-0000-4000-8000-000000000488",
      actorUserId: "editor",
      data: fromUint8Array(Y.encodeStateAsUpdate(authored)),
    })).rejects.toBeInstanceOf(StudioCrdtInvalidPayloadError);
    expect(admission.calls).toHaveLength(1);
    expect(repository.updates.get("work-raster-asset-mismatch") ?? []).toHaveLength(0);
    expect(repository.receipts.size).toBe(0);

    authored.destroy();
  });

  it("admits a newly activated work-asset reference only after authorized storage validation", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const reference = { assetId: "scene-1", elementType: "image" } as const;
    const admission = new ExactWorkAssetAdmission([reference]);
    const current = service(
      repository,
      {},
      allowStoredRasterAssetReferences,
      admission
    );
    const authored = createReferenceTopologyDocument();

    await expect(current.applyUpdate({
      workId: "work-reference-admitted",
      updateId: "30000000-0000-4000-8000-000000000491",
      actorUserId: "editor",
      data: fromUint8Array(Y.encodeStateAsUpdate(authored)),
    })).resolves.toMatchObject({ duplicate: false, serverSequence: "1" });
    expect(admission.calls).toEqual([{
      actorUserId: "editor",
      workId: "work-reference-admitted",
      references: [reference],
    }]);
    expect(admission.transactions).toEqual([repository.validationTransaction]);
    expect(repository.updates.get("work-reference-admitted")).toHaveLength(1);

    authored.destroy();
  });

  it("hydrates the deployed elementType-only reference envelope without storage admission", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const admission = new ExactWorkAssetAdmission([]);
    const current = service(
      repository,
      {},
      allowStoredRasterAssetReferences,
      admission
    );
    const legacy = createLegacyReferenceTopologyDocument();
    expect(hasValidStudioCrdtRootSchema(legacy)).toBe(true);

    await expect(current.applyUpdate({
      workId: "work-reference-legacy-v1",
      updateId: "30000000-0000-4000-8000-000000000497",
      actorUserId: "editor",
      data: fromUint8Array(Y.encodeStateAsUpdate(legacy)),
    })).resolves.toMatchObject({ duplicate: false, serverSequence: "1" });
    expect(admission.calls).toHaveLength(0);

    const hydrated = new Y.Doc();
    applySync(hydrated, await current.sync("work-reference-legacy-v1"));
    expect(hydrated.getMap("scene-element:scene-1").get("prop:elementType"))
      .toBe("image");
    expect(hasValidStudioCrdtRootSchema(hydrated)).toBe(true);
    legacy.destroy();
    hydrated.destroy();
  });

  it("rejects rewriting a durable admitted reference into another scene type", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const reference = { assetId: "scene-1", elementType: "image" } as const;
    const admission = new ExactWorkAssetAdmission([reference]);
    const current = service(
      repository,
      {},
      allowStoredRasterAssetReferences,
      admission
    );
    const authored = createReferenceTopologyDocument();
    await current.applyUpdate({
      workId: "work-reference-identity-grow-only",
      updateId: "30000000-0000-4000-8000-000000000498",
      actorUserId: "editor",
      data: fromUint8Array(Y.encodeStateAsUpdate(authored)),
    });

    const beforeRewrite = Y.encodeStateVector(authored);
    const scene = authored.getMap<unknown>("scene-element:scene-1");
    scene.set("type", "text");
    for (const key of [...scene.keys()]) {
      if (key.startsWith("base:") || key.startsWith("prop:") || key.startsWith("unset:")) {
        scene.delete(key);
      }
    }
    scene.set("prop:text", "reference rewrite");
    scene.set("prop:x", 10);
    scene.set("prop:y", 20);
    scene.set("prop:width", 300);
    scene.set("prop:fontSize", 20);
    scene.set("prop:fill", "#111111");
    scene.set("prop:rotation", 0);
    expect(hasValidStudioCrdtRootSchema(authored)).toBe(true);

    await expect(current.applyUpdate({
      workId: "work-reference-identity-grow-only",
      updateId: "30000000-0000-4000-8000-000000000499",
      actorUserId: "editor",
      data: fromUint8Array(Y.encodeStateAsUpdate(authored, beforeRewrite)),
    })).rejects.toBeInstanceOf(StudioCrdtInvalidPayloadError);
    expect(repository.updates.get("work-reference-identity-grow-only")).toHaveLength(1);
    expect(admission.calls).toHaveLength(1);
    authored.destroy();
  });

  it("rejects downgrading a durable admitted reference to the legacy props-only envelope", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const reference = { assetId: "scene-1", elementType: "image" } as const;
    const admission = new ExactWorkAssetAdmission([reference]);
    const current = service(
      repository,
      {},
      allowStoredRasterAssetReferences,
      admission
    );
    const authored = createReferenceTopologyDocument();
    await current.applyUpdate({
      workId: "work-reference-no-admission-downgrade",
      updateId: "30000000-0000-4000-8000-00000000049a",
      actorUserId: "editor",
      data: fromUint8Array(Y.encodeStateAsUpdate(authored)),
    });

    const beforeDowngrade = Y.encodeStateVector(authored);
    const scene = authored.getMap<unknown>("scene-element:scene-1");
    for (const key of [...scene.keys()]) {
      if (
        (key.startsWith("base:") || key.startsWith("prop:") || key.startsWith("unset:")) &&
        key !== "prop:elementType"
      ) {
        scene.delete(key);
      }
    }
    expect(hasValidStudioCrdtRootSchema(authored)).toBe(true);

    await expect(current.applyUpdate({
      workId: "work-reference-no-admission-downgrade",
      updateId: "30000000-0000-4000-8000-00000000049b",
      actorUserId: "editor",
      data: fromUint8Array(Y.encodeStateAsUpdate(authored, beforeDowngrade)),
    })).rejects.toBeInstanceOf(StudioCrdtInvalidPayloadError);
    expect(repository.updates.get("work-reference-no-admission-downgrade")).toHaveLength(1);
    expect(admission.calls).toHaveLength(1);
    authored.destroy();
  });

  it("atomically rejects a newly activated work-asset reference missing from authorized storage", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const admission = new ExactWorkAssetAdmission([]);
    const current = service(
      repository,
      {},
      allowStoredRasterAssetReferences,
      admission
    );
    const authored = createReferenceTopologyDocument();

    await expect(current.applyUpdate({
      workId: "work-reference-missing",
      updateId: "30000000-0000-4000-8000-000000000492",
      actorUserId: "editor",
      data: fromUint8Array(Y.encodeStateAsUpdate(authored)),
    })).rejects.toBeInstanceOf(StudioCrdtInvalidPayloadError);
    expect(admission.calls).toHaveLength(1);
    expect(repository.updates.get("work-reference-missing") ?? []).toHaveLength(0);
    expect(repository.receipts.size).toBe(0);

    authored.destroy();
  });

  it("rejects a fake work-asset identity even when it is introduced already tombstoned", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const admission = new ExactWorkAssetAdmission([]);
    const current = service(
      repository,
      {},
      allowStoredRasterAssetReferences,
      admission
    );
    const authored = createReferenceTopologyDocument();
    authored.getMap<unknown>("scene-element:scene-1").set("deleted", true);

    await expect(current.applyUpdate({
      workId: "work-reference-fake-tombstone",
      updateId: "30000000-0000-4000-8000-000000000496",
      actorUserId: "editor",
      data: fromUint8Array(Y.encodeStateAsUpdate(authored)),
    })).rejects.toBeInstanceOf(StudioCrdtInvalidPayloadError);
    expect(admission.calls).toHaveLength(1);
    expect(repository.updates.get("work-reference-fake-tombstone") ?? []).toHaveLength(0);

    authored.destroy();
  });

  it("rejects more than 250 active work-asset references before storage admission or append", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const admission = new ExactWorkAssetAdmission([]);
    const current = service(
      repository,
      {},
      allowStoredRasterAssetReferences,
      admission
    );
    const authored = createReferenceTopologyFloodDocument(
      STUDIO_CRDT_ACTIVE_WORK_ASSET_REFERENCE_MAX_COUNT + 1
    );

    await expect(current.applyUpdate({
      workId: "work-reference-over-cap",
      updateId: "30000000-0000-4000-8000-000000000493",
      actorUserId: "editor",
      data: fromUint8Array(Y.encodeStateAsUpdate(authored)),
    })).rejects.toBeInstanceOf(StudioCrdtInvalidPayloadError);
    expect(admission.calls).toHaveLength(0);
    expect(repository.updates.get("work-reference-over-cap") ?? []).toHaveLength(0);
    expect(repository.receipts.size).toBe(0);

    authored.destroy();
  });

  it("does not revalidate an existing active work-asset reference on ordinary property edits", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const reference = { assetId: "scene-1", elementType: "image" } as const;
    const admission = new ExactWorkAssetAdmission([reference]);
    const current = service(
      repository,
      {},
      allowStoredRasterAssetReferences,
      admission
    );
    const authored = createReferenceTopologyDocument();
    await current.applyUpdate({
      workId: "work-reference-existing",
      updateId: "30000000-0000-4000-8000-000000000494",
      actorUserId: "editor",
      data: fromUint8Array(Y.encodeStateAsUpdate(authored)),
    });
    const currentVector = Y.encodeStateVector(authored);
    authored.getMap<unknown>("scene-element:scene-1").set("prop:x", 42);

    await expect(current.applyUpdate({
      workId: "work-reference-existing",
      updateId: "30000000-0000-4000-8000-000000000495",
      actorUserId: "editor",
      data: fromUint8Array(Y.encodeStateAsUpdate(authored, currentVector)),
    })).resolves.toMatchObject({ duplicate: false, serverSequence: "2" });
    expect(admission.calls).toHaveLength(1);
    expect(repository.updates.get("work-reference-existing")).toHaveLength(2);

    authored.destroy();
  });

  it("atomically rejects a single raster event that jumps the durable Lamport frontier", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const current = service(repository);
    const jumped = createRasterDocument({
      operation: rasterOperation(
        "30000000-0000-4000-8000-000000000480",
        "d".repeat(64),
        "editor",
        "18446744073709551615"
      ),
    });

    await expect(current.applyUpdate({
      workId: "work-raster-clock-jump",
      updateId: "30000000-0000-4000-8000-000000000481",
      actorUserId: "editor",
      data: fromUint8Array(Y.encodeStateAsUpdate(jumped)),
    })).rejects.toBeInstanceOf(StudioCrdtInvalidPayloadError);
    expect(repository.updates.get("work-raster-clock-jump") ?? []).toHaveLength(0);
    expect(repository.receipts.size).toBe(0);

    jumped.destroy();
  });

  it("rejects raster appends to a locked group but admits an atomic unlock and draw", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const current = service(repository);
    const workId = "work-raster-layer-lock";
    const base = new Y.Doc();
    const lockedGroup = addLayerGroup(base, { id: "layer-ink", pageId: "page-1" });
    lockedGroup.set("prop:locked", true);
    lockedGroup.set("unset:locked", false);
    const baseUpdate = Y.encodeStateAsUpdate(base);
    await current.applyUpdate({
      workId,
      updateId: "30000000-0000-4000-8000-000000000482",
      actorUserId: "editor",
      data: fromUint8Array(baseUpdate),
    });

    const rejected = createRasterDocument({
      operation: rasterOperation(
        "30000000-0000-4000-8000-000000000483",
        "d".repeat(64),
        "editor"
      ),
    });
    await expect(current.applyUpdate({
      workId,
      updateId: "30000000-0000-4000-8000-000000000484",
      actorUserId: "editor",
      data: fromUint8Array(Y.encodeStateAsUpdate(rejected)),
    })).rejects.toThrow(/locked layer/u);
    expect(repository.updates.get(workId)).toHaveLength(1);
    expect(repository.receipts.size).toBe(1);

    const unlocked = new Y.Doc();
    Y.applyUpdate(unlocked, baseUpdate);
    const baseVector = Y.encodeStateVector(unlocked);
    const unlockedGroup = addLayerGroup(unlocked, { id: "layer-ink", pageId: "page-1" });
    unlockedGroup.set("prop:locked", false);
    unlockedGroup.set("unset:locked", false);
    const acceptedRaster = createRasterDocument({
      operation: rasterOperation(
        "30000000-0000-4000-8000-000000000485",
        "e".repeat(64),
        "editor"
      ),
    });
    Y.applyUpdate(unlocked, Y.encodeStateAsUpdate(acceptedRaster));
    await expect(current.applyUpdate({
      workId,
      updateId: "30000000-0000-4000-8000-000000000486",
      actorUserId: "editor",
      data: fromUint8Array(Y.encodeStateAsUpdate(unlocked, baseVector)),
    })).resolves.toMatchObject({ duplicate: false, serverSequence: "2" });
    expect(repository.updates.get(workId)).toHaveLength(2);
    expect(repository.receipts.size).toBe(2);

    base.destroy();
    rejected.destroy();
    unlocked.destroy();
    acceptedRaster.destroy();
  });

  it("allows an aggregate update to retransmit an existing other-actor event", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const current = service(repository);
    const firstId = "30000000-0000-4000-8000-000000000474";
    const secondId = "30000000-0000-4000-8000-000000000475";
    const firstOperation = rasterOperation(firstId, "b".repeat(64), "artist-a");
    const secondOperation = rasterOperation(secondId, "c".repeat(64), "artist-b");
    const first = createRasterDocument({ operation: firstOperation });

    await current.applyUpdate({
      workId: "work-raster-aggregate",
      updateId: "30000000-0000-4000-8000-000000000476",
      actorUserId: "artist-a",
      data: fromUint8Array(Y.encodeStateAsUpdate(first)),
    });

    const aggregate = createRasterDocument({ operation: false });
    const operationRoot = aggregate.getMap<string>(STUDIO_CRDT_RASTER_OPERATIONS_ROOT);
    for (const operation of [firstOperation, secondOperation]) {
      operationRoot.set(
        operation.operationId,
        canonicalStudioRasterJson({ surfaceId: RASTER_SURFACE.surfaceId, operation })
      );
    }
    await expect(current.applyUpdate({
      workId: "work-raster-aggregate",
      updateId: "30000000-0000-4000-8000-000000000477",
      actorUserId: "artist-b",
      data: fromUint8Array(Y.encodeStateAsUpdate(aggregate)),
    })).resolves.toMatchObject({ duplicate: false, serverSequence: "2" });
    expect(repository.updates.get("work-raster-aggregate")).toHaveLength(2);
    expect(repository.receipts.size).toBe(2);

    const hydrated = new Y.Doc();
    applySync(hydrated, await current.sync("work-raster-aggregate"));
    expect([...hydrated.getMap(STUDIO_CRDT_RASTER_OPERATIONS_ROOT).keys()].sort())
      .toEqual([firstId, secondId]);

    first.destroy();
    aggregate.destroy();
    hydrated.destroy();
  });

  it.each([
    ["surface", { operation: false }, STUDIO_CRDT_RASTER_SURFACES_ROOT, RASTER_SURFACE.surfaceId],
    ["operation", {}, STUDIO_CRDT_RASTER_OPERATIONS_ROOT, RASTER_OPERATION_ID],
    ["undo", { undo: true }, STUDIO_CRDT_RASTER_UNDO_OPERATIONS_ROOT, RASTER_UNDO_ID],
    ["acknowledgement", { acknowledgement: true }, STUDIO_CRDT_RASTER_UNDO_ACKS_ROOT, RASTER_ACK_ID],
    ["checkpoint", { checkpoint: true }, STUDIO_CRDT_RASTER_CHECKPOINTS_ROOT, RASTER_CHECKPOINT_ID],
  ] as const)(
    "rejects removal of an existing grow-only raster %s before durable storage",
    async (kind, options, rootName, identity) => {
      const repository = new MemoryStudioCrdtRepository();
      const current = service(repository);
      const workId = `work-raster-grow-only-${kind}`;
      const base = createRasterDocument(options);
      const baseUpdate = Y.encodeStateAsUpdate(base);
      if (kind === "checkpoint") {
        repository.updates.set(workId, [{
          workId,
          sequence: 1n,
          updateId: "30000000-0000-4000-8000-000000000430",
          actorUserId: "trusted-coordinator",
          payload: baseUpdate,
          createdAt: new Date("2026-07-16T00:00:00.000Z"),
        }]);
        await current.sync(workId);
      } else {
        await current.applyUpdate({
          workId,
          updateId: `30000000-0000-4000-8000-0000000004${31 + [
            "surface", "operation", "undo", "acknowledgement",
          ].indexOf(kind)}`,
          actorUserId: "editor",
          data: fromUint8Array(baseUpdate),
        });
      }
      const durableCount = repository.updates.get(workId)?.length ?? 0;
      const receiptCount = repository.receipts.size;

      const attacker = new Y.Doc();
      Y.applyUpdate(attacker, baseUpdate);
      const stateVector = Y.encodeStateVector(attacker);
      attacker.getMap(rootName).delete(identity);
      expect(hasValidStudioCrdtRootSchema(attacker)).toBe(true);

      await expect(current.applyUpdate({
        workId,
        updateId: `30000000-0000-4000-8000-0000000004${41 + [
          "surface", "operation", "undo", "acknowledgement", "checkpoint",
        ].indexOf(kind)}`,
        actorUserId: "attacker",
        data: fromUint8Array(Y.encodeStateAsUpdate(attacker, stateVector)),
      })).rejects.toBeInstanceOf(StudioCrdtInvalidPayloadError);
      expect(repository.updates.get(workId)).toHaveLength(durableCount);
      expect(repository.receipts.size).toBe(receiptCount);
      base.destroy();
      attacker.destroy();
    }
  );

  it("rejects a same-ID raster rewrite even when the rewritten value is independently valid", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const current = service(repository);
    const base = createRasterDocument();
    const baseUpdate = Y.encodeStateAsUpdate(base);
    await current.applyUpdate({
      workId: "work-raster-rewrite",
      updateId: "30000000-0000-4000-8000-000000000450",
      actorUserId: "editor",
      data: fromUint8Array(baseUpdate),
    });
    const attacker = new Y.Doc();
    Y.applyUpdate(attacker, baseUpdate);
    const stateVector = Y.encodeStateVector(attacker);
    const rewritten = rasterOperation(RASTER_OPERATION_ID, "d".repeat(64));
    attacker.getMap<string>(STUDIO_CRDT_RASTER_OPERATIONS_ROOT).set(
      RASTER_OPERATION_ID,
      canonicalStudioRasterJson({ surfaceId: RASTER_SURFACE.surfaceId, operation: rewritten })
    );
    expect(hasValidStudioCrdtRootSchema(attacker)).toBe(true);

    await expect(current.applyUpdate({
      workId: "work-raster-rewrite",
      updateId: "30000000-0000-4000-8000-000000000451",
      actorUserId: "attacker",
      data: fromUint8Array(Y.encodeStateAsUpdate(attacker, stateVector)),
    })).rejects.toBeInstanceOf(StudioCrdtInvalidPayloadError);
    expect(repository.updates.get("work-raster-rewrite")).toHaveLength(1);
    expect(repository.receipts.size).toBe(1);
    base.destroy();
    attacker.destroy();
  });

  it("classifies a persisted raster rewrite as storage corruption during update hydration", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const base = createRasterDocument();
    const baseUpdate = Y.encodeStateAsUpdate(base);
    const attacker = new Y.Doc();
    Y.applyUpdate(attacker, baseUpdate);
    const stateVector = Y.encodeStateVector(attacker);
    attacker.getMap(STUDIO_CRDT_RASTER_OPERATIONS_ROOT).delete(RASTER_OPERATION_ID);
    repository.updates.set("work-raster-corruption", [
      {
        workId: "work-raster-corruption",
        sequence: 1n,
        updateId: "30000000-0000-4000-8000-000000000452",
        actorUserId: "editor",
        payload: baseUpdate,
        createdAt: new Date("2026-07-16T00:00:00.000Z"),
      },
      {
        workId: "work-raster-corruption",
        sequence: 2n,
        updateId: "30000000-0000-4000-8000-000000000453",
        actorUserId: "attacker",
        payload: Y.encodeStateAsUpdate(attacker, stateVector),
        createdAt: new Date("2026-07-16T00:00:01.000Z"),
      },
    ]);
    await expect(service(repository).sync("work-raster-corruption")).rejects.toBeInstanceOf(
      StudioCrdtStorageCorruptionError
    );
    base.destroy();
    attacker.destroy();
  });

  it("rolls back cached raster state when a catch-up snapshot rewrites immutable history", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const current = service(repository);
    const base = createRasterDocument();
    const baseUpdate = Y.encodeStateAsUpdate(base);
    await current.applyUpdate({
      workId: "work-raster-snapshot-rollback",
      updateId: "30000000-0000-4000-8000-000000000454",
      actorUserId: "editor",
      data: fromUint8Array(baseUpdate),
    });
    const attacker = new Y.Doc();
    Y.applyUpdate(attacker, baseUpdate);
    attacker.getMap(STUDIO_CRDT_RASTER_OPERATIONS_ROOT).delete(RASTER_OPERATION_ID);
    repository.snapshots.set("work-raster-snapshot-rollback", {
      workId: "work-raster-snapshot-rollback",
      snapshot: Y.encodeStateAsUpdate(attacker),
      compactedSequence: 2n,
      updatedAt: new Date("2026-07-16T00:00:01.000Z"),
    });

    await expect(current.sync("work-raster-snapshot-rollback")).rejects.toBeInstanceOf(
      StudioCrdtStorageCorruptionError
    );
    repository.snapshots.delete("work-raster-snapshot-rollback");
    const hydrated = new Y.Doc();
    applySync(hydrated, await current.sync("work-raster-snapshot-rollback"));
    expect(hydrated.getMap(STUDIO_CRDT_RASTER_OPERATIONS_ROOT).has(RASTER_OPERATION_ID)).toBe(true);
    base.destroy();
    attacker.destroy();
    hydrated.destroy();
  });

  it("rejects client-authored checkpoints but still validates persisted coordinator checkpoints", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const current = service(repository);
    const base = createRasterDocument();
    const baseUpdate = Y.encodeStateAsUpdate(base);
    await current.applyUpdate({
      workId: "work-raster-checkpoint-trust",
      updateId: "30000000-0000-4000-8000-000000000455",
      actorUserId: "editor",
      data: fromUint8Array(baseUpdate),
    });
    const withCheckpoint = createRasterDocument({ checkpoint: true });
    const attacker = new Y.Doc();
    Y.applyUpdate(attacker, baseUpdate);
    const stateVector = Y.encodeStateVector(attacker);
    attacker.getMap<string>(STUDIO_CRDT_RASTER_CHECKPOINTS_ROOT).set(
      RASTER_CHECKPOINT_ID,
      withCheckpoint.getMap<string>(STUDIO_CRDT_RASTER_CHECKPOINTS_ROOT)
        .get(RASTER_CHECKPOINT_ID)!
    );
    await expect(current.applyUpdate({
      workId: "work-raster-checkpoint-trust",
      updateId: "30000000-0000-4000-8000-000000000456",
      actorUserId: "editor",
      data: fromUint8Array(Y.encodeStateAsUpdate(attacker, stateVector)),
    })).rejects.toBeInstanceOf(StudioCrdtInvalidPayloadError);
    expect(repository.updates.get("work-raster-checkpoint-trust")).toHaveLength(1);
    expect(repository.receipts.size).toBe(1);

    const trustedRepository = new MemoryStudioCrdtRepository();
    const trusted = createRasterDocument({ checkpoint: true });
    trustedRepository.updates.set("work-raster-trusted-checkpoint", [{
      workId: "work-raster-trusted-checkpoint",
      sequence: 1n,
      updateId: "30000000-0000-4000-8000-000000000457",
      actorUserId: "trusted-coordinator",
      payload: Y.encodeStateAsUpdate(trusted),
      createdAt: new Date("2026-07-16T00:00:00.000Z"),
    }]);
    trustedRepository.nextSequence = 2n;
    const trustedService = service(trustedRepository);
    const hydrated = new Y.Doc();
    applySync(hydrated, await trustedService.sync("work-raster-trusted-checkpoint"));
    expect(hydrated.getMap(STUDIO_CRDT_RASTER_CHECKPOINTS_ROOT).has(RASTER_CHECKPOINT_ID))
      .toBe(true);

    const validTail = new Y.Doc();
    Y.applyUpdate(validTail, Y.encodeStateAsUpdate(trusted));
    const validTailVector = Y.encodeStateVector(validTail);
    const afterCheckpoint = rasterOperation(
      "30000000-0000-4000-8000-000000000458",
      "b".repeat(64),
      "editor",
      "2"
    );
    validTail.getMap<string>(STUDIO_CRDT_RASTER_OPERATIONS_ROOT).set(
      afterCheckpoint.operationId,
      canonicalStudioRasterJson({
        surfaceId: RASTER_SURFACE.surfaceId,
        operation: afterCheckpoint,
      })
    );
    await expect(trustedService.applyUpdate({
      workId: "work-raster-trusted-checkpoint",
      updateId: "30000000-0000-4000-8000-000000000459",
      actorUserId: "editor",
      data: fromUint8Array(Y.encodeStateAsUpdate(validTail, validTailVector)),
    })).resolves.toMatchObject({ duplicate: false });

    const lateUndo = new Y.Doc();
    Y.applyUpdate(lateUndo, Y.encodeStateAsUpdate(validTail));
    const lateUndoVector = Y.encodeStateVector(lateUndo);
    const crossesClosedHorizon: StudioRasterUndoOperation = {
      version: STUDIO_RASTER_CRDT_VERSION,
      undoOperationId: "30000000-0000-4000-8000-000000000460",
      targetOperationId: RASTER_OPERATION_ID,
      order: { logicalClock: "3", actorId: "editor" },
    };
    lateUndo.getMap<string>(STUDIO_CRDT_RASTER_UNDO_OPERATIONS_ROOT).set(
      crossesClosedHorizon.undoOperationId,
      canonicalStudioRasterJson({
        surfaceId: RASTER_SURFACE.surfaceId,
        undoOperation: crossesClosedHorizon,
      })
    );
    await expect(trustedService.applyUpdate({
      workId: "work-raster-trusted-checkpoint",
      updateId: "30000000-0000-4000-8000-000000000461",
      actorUserId: "editor",
      data: fromUint8Array(Y.encodeStateAsUpdate(lateUndo, lateUndoVector)),
    })).rejects.toBeInstanceOf(StudioCrdtInvalidPayloadError);

    base.destroy();
    withCheckpoint.destroy();
    attacker.destroy();
    trusted.destroy();
    hydrated.destroy();
    validTail.destroy();
    lateUndo.destroy();
  });

  it("serializes different-actor raster set-union races and rejects an immutable-ID collision", async () => {
    const unionRepository = new MemoryStudioCrdtRepository();
    unionRepository.beforeAppend = twoPartyBarrier();
    const unionLeft = service(unionRepository);
    const unionRight = service(unionRepository);
    const leftDocument = createRasterDocument({
      operation: rasterOperation(
        "30000000-0000-4000-8000-000000000460",
        "b".repeat(64),
        "artist-a"
      ),
    });
    const rightDocument = createRasterDocument({
      operation: rasterOperation(
        "30000000-0000-4000-8000-000000000461",
        "b".repeat(64),
        "artist-b"
      ),
    });
    const unionResults = await Promise.allSettled([
      unionLeft.applyUpdate({
        workId: "work-raster-union-race",
        updateId: "30000000-0000-4000-8000-000000000462",
        actorUserId: "artist-a",
        data: fromUint8Array(Y.encodeStateAsUpdate(leftDocument)),
      }),
      unionRight.applyUpdate({
        workId: "work-raster-union-race",
        updateId: "30000000-0000-4000-8000-000000000463",
        actorUserId: "artist-b",
        data: fromUint8Array(Y.encodeStateAsUpdate(rightDocument)),
      }),
    ]);
    expect(unionResults.every(({ status }) => status === "fulfilled")).toBe(true);
    const unionHydrated = new Y.Doc();
    applySync(unionHydrated, await unionLeft.sync("work-raster-union-race"));
    expect([...unionHydrated.getMap(STUDIO_CRDT_RASTER_OPERATIONS_ROOT).keys()].sort()).toEqual([
      "30000000-0000-4000-8000-000000000460",
      "30000000-0000-4000-8000-000000000461",
    ]);

    const conflictRepository = new MemoryStudioCrdtRepository();
    conflictRepository.beforeAppend = twoPartyBarrier();
    const conflictLeft = service(conflictRepository);
    const conflictRight = service(conflictRepository);
    const firstValue = createRasterDocument({ actorId: "artist-a" });
    const secondValue = createRasterDocument({
      operation: rasterOperation(RASTER_OPERATION_ID, "e".repeat(64), "artist-a"),
    });
    const conflictResults = await Promise.allSettled([
      conflictLeft.applyUpdate({
        workId: "work-raster-conflict-race",
        updateId: "30000000-0000-4000-8000-000000000464",
        actorUserId: "artist-a",
        data: fromUint8Array(Y.encodeStateAsUpdate(firstValue)),
      }),
      conflictRight.applyUpdate({
        workId: "work-raster-conflict-race",
        updateId: "30000000-0000-4000-8000-000000000465",
        actorUserId: "artist-a",
        data: fromUint8Array(Y.encodeStateAsUpdate(secondValue)),
      }),
    ]);
    expect(conflictResults.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(conflictResults.filter(({ status }) => status === "rejected")).toHaveLength(1);
    expect(conflictRepository.updates.get("work-raster-conflict-race")).toHaveLength(1);
    expect(conflictRepository.receipts.size).toBe(1);

    for (const doc of [
      leftDocument, rightDocument, unionHydrated, firstValue, secondValue,
    ]) doc.destroy();
  });

  it("validates reserved layer-group roots without synchronizing local collapse state", () => {
    const valid = createScenePageDocument();
    const validGroup = addLayerGroup(valid, { id: "group/slash", name: "배경 후보" });
    validGroup.set("base:hidden", false);
    validGroup.set("prop:hidden", true);
    validGroup.set("prop:locked", false);
    addLayerGroup(valid, { id: "group/slash", pageId: "page-copy", name: "복제 페이지" });
    expect(hasValidStudioCrdtRootSchema(valid)).toBe(true);
    valid.destroy();

    const orphan = createScenePageDocument();
    orphan.getMap<unknown>("layer-group:6%3Aorphan").set("id", "orphan");
    expect(hasValidStudioCrdtRootSchema(orphan)).toBe(false);
    orphan.destroy();

    const nonCanonical = createScenePageDocument();
    nonCanonical.getMap<boolean>("layer-groups").set("06:page-111:group/slash", true);
    const wrongName = nonCanonical.getMap<unknown>("layer-group:06%3Apage-111%3Agroup%2Fslash");
    wrongName.set("id", "group/slash");
    expect(hasValidStudioCrdtRootSchema(nonCanonical)).toBe(false);
    nonCanonical.destroy();

    const invalidCases: Array<(group: Y.Map<unknown>) => void> = [
      (group) => group.set("pageId", ""),
      (group) => group.set("payloadVersion", 2),
      (group) => group.set("deleted", "no"),
      (group) => group.set("prop:name", ""),
      (group) => group.set("prop:name", "선화\n폴더"),
      (group) => group.set("prop:name", "가".repeat(513)),
      (group) => group.set("prop:hidden", "yes"),
      (group) => group.set("prop:locked", 1),
      (group) => {
        group.set("base:hidden", { garbage: "x".repeat(3_000) });
        group.set("prop:hidden", false);
      },
      (group) => group.set("unset:name", true),
      (group) => group.set("name", "raw keys are not part of the wire contract"),
      (group) => group.set("prop:collapsed", true),
      (group) => group.set("prop:payload", "x".repeat(2_048)),
    ];
    for (const mutate of invalidCases) {
      const invalid = createScenePageDocument();
      mutate(addLayerGroup(invalid));
      expect(hasValidStudioCrdtRootSchema(invalid)).toBe(false);
      invalid.destroy();
    }

    const reserved = createScenePageDocument();
    addLayerGroup(reserved, { id: "page-root" });
    expect(hasValidStudioCrdtRootSchema(reserved)).toBe(false);
    reserved.destroy();

    const mismatchedIdentity = createScenePageDocument();
    addLayerGroup(mismatchedIdentity).set("pageId", "other-page");
    expect(hasValidStudioCrdtRootSchema(mismatchedIdentity)).toBe(false);
    mismatchedIdentity.destroy();
  });

  it("materializes valid remote top-level scene/page Yjs types before durable validation", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const current = service(repository);
    const source = createScenePageDocument();

    await expect(current.applyUpdate({
      workId: "work-1",
      updateId: "00000000-0000-4000-8000-000000000104",
      actorUserId: "editor",
      data: fromUint8Array(Y.encodeStateAsUpdate(source)),
    })).resolves.toMatchObject({ duplicate: false });

    const hydrated = new Y.Doc();
    applySync(hydrated, await current.sync("work-1"));
    expect(hasValidStudioCrdtRootSchema(hydrated)).toBe(true);
    expect(hydrated.getMap<unknown>("scene-element:scene-1").get("prop:text"))
      .toBe("동시에 편집하는 대사");
    hydrated.destroy();
    source.destroy();
  });

  it("materializes valid remote stroke roots instead of misclassifying them as abstract types", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const current = service(repository);
    const source = createStrokeDocument();

    await expect(current.applyUpdate({
      workId: "work-1",
      updateId: "00000000-0000-4000-8000-000000000105",
      actorUserId: "editor",
      data: fromUint8Array(Y.encodeStateAsUpdate(source)),
    })).resolves.toMatchObject({ duplicate: false });

    const hydrated = new Y.Doc();
    applySync(hydrated, await current.sync("work-1"));
    expect(hasValidStudioCrdtRootSchema(hydrated)).toBe(true);
    expect(hydrated.getMap<Y.Map<unknown>>("strokes").get("stroke-1")?.get("status"))
      .toBe("finalized");
    hydrated.destroy();
    source.destroy();
  });

  it("accepts zero sample spacing for fixed-rate causal ink", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const current = service(repository);
    const source = createStrokeDocument();
    source.getMap<Y.Map<unknown>>("strokes").get("stroke-1")!.set("sampleSpacing", 0);

    expect(hasValidStudioCrdtRootSchema(source)).toBe(true);
    await expect(current.applyUpdate({
      workId: "work-fixed-rate-zero-spacing",
      updateId: "00000000-0000-4000-8000-000000000108",
      actorUserId: "editor",
      data: fromUint8Array(Y.encodeStateAsUpdate(source)),
    })).resolves.toMatchObject({ duplicate: false });

    const hydrated = new Y.Doc();
    applySync(hydrated, await current.sync("work-fixed-rate-zero-spacing"));
    expect(hasValidStudioCrdtRootSchema(hydrated)).toBe(true);
    expect(hydrated.getMap<Y.Map<unknown>>("strokes").get("stroke-1")?.get("sampleSpacing"))
      .toBe(0);
    hydrated.destroy();
    source.destroy();
  });

  it("admits only canonical bounded brush catalog identity metadata", () => {
    const valid = createStrokeDocument();
    const validStroke = valid.getMap<Y.Map<unknown>>("strokes").get("stroke-1")!;
    validStroke.set("brush", "ink-particle");
    validStroke.set("brushCatalogId", "pro67:heart-stamp");
    validStroke.set("brushCatalogName", "하트 스탬프");
    expect(hasValidStudioCrdtRootSchema(valid)).toBe(true);
    valid.destroy();

    const invalidCases: Array<[key: string, value: unknown]> = [
      ["brushCatalogId", " pro67:heart-stamp"],
      ["brushCatalogId", "pro67:\u0000heart-stamp"],
      ["brushCatalogId", "a".repeat(161)],
      ["brushCatalogName", "붓".repeat(121)],
      ["brushCatalogName", 42],
    ];
    for (const [key, value] of invalidCases) {
      const invalid = createStrokeDocument();
      invalid.getMap<Y.Map<unknown>>("strokes").get("stroke-1")!.set(key, value);
      expect(hasValidStudioCrdtRootSchema(invalid), key).toBe(false);
      invalid.destroy();
    }

    const legacy = createStrokeDocument();
    expect(hasValidStudioCrdtRootSchema(legacy)).toBe(true);
    legacy.destroy();
  });

  it("pins the API paint mirror to every client-known brush family and dynamic alias", () => {
    const knownBrushIds = new Set([
      ...Object.keys(STUDIO_BRUSH_RENDER_FAMILY),
      ...BRUSH_PRESETS.map((preset) => preset.id),
      "future-unknown-brush",
    ]);
    for (const brush of knownBrushIds) {
      for (const paintModel of ["layered-flow-v1", "bounded-flow-v2"] as const) {
        const browserContract = {
          paintModel,
          kind: "freehand",
          mode: "pen",
          brush,
          sampleSpacing: 0,
          brushDynamics: paintModel === "bounded-flow-v2" ? {} : undefined,
        };
        const expected = hasValidBrowserStrokePaintContract(browserContract);
        for (const payloadVersion of [2, 3, 4]) {
          expect(
            hasValidStudioCrdtStrokePaintContract({
              payloadVersion,
              ...browserContract,
            }),
            `${paintModel}:${brush}:v${payloadVersion}`,
          ).toBe(expected);
        }
        expect(hasValidStudioCrdtStrokePaintContract({
          payloadVersion: 1,
          ...browserContract,
        })).toBe(false);
      }
    }

    const boundedBase = {
      paintModel: "bounded-flow-v2" as const,
      kind: "freehand",
      mode: "pen",
      brush: "dry-media",
      brushDynamics: {},
    };
    for (const causalGeometry of [
      { sampleSpacing: 0 },
      { pressureModel: "linear-full-v1" },
      { pressureModel: "linear-residual-v2" },
      { pressureModel: "linear-residual-path-v3" },
      {},
      { sampleSpacing: -0.01 },
      { pressureModel: "linear-residual-path-v4" },
    ]) {
      const browserContract = { ...boundedBase, ...causalGeometry };
      expect(hasValidStudioCrdtStrokePaintContract({
        payloadVersion: 3,
        ...browserContract,
      })).toBe(hasValidBrowserStrokePaintContract(browserContract));
    }
    for (const symmetry of [
      undefined,
      { type: "none" },
      { type: "vertical", centerX: 0, centerY: 0 },
      { type: "horizontal", centerX: 0, centerY: 0 },
      { type: "radial", centerX: 0, centerY: 0, radialCount: 32 },
      { type: "kaleidoscope", centerX: 0, centerY: 0, radialCount: 1 },
      { type: "vertical" },
      { type: "radial", centerX: 0, centerY: 0, radialCount: 33 },
      { type: "future", centerX: 0, centerY: 0 },
    ]) {
      const browserContract = {
        ...boundedBase,
        sampleSpacing: 0,
        symmetry,
      };
      expect(hasValidStudioCrdtStrokePaintContract({
        payloadVersion: 3,
        ...browserContract,
      })).toBe(hasValidBrowserStrokePaintContract(browserContract));
    }
  });

  it("admits the fresh-authoring dry-media kernel marker in brushDynamics, matching the browser oracle", () => {
    // The `dryMediaKernelProgram` marker is minted by the authored core dry-media preset
    // snapshots and travels inside the persisted brushDynamics JSON. Admission is bounded-JSON
    // (no key whitelist), so the mirror must accept exactly what the browser accepts — a
    // rejection here would drop the stroke server-side while the author keeps seeing it.
    for (const brush of ["crayon", "chalk", "charcoal", "pastel", "oil-pastel"] as const) {
      const authored = studioBrushDynamicsSettingsForBrushId(brush);
      expect(authored?.dryMediaKernelProgram, brush).toBeDefined();
      const persistedDynamics =
        JSON.parse(JSON.stringify(authored)) as Record<string, unknown>;
      expect(persistedDynamics.dryMediaKernelProgram, brush).toEqual({
        version: "dry-media-kernel-dab-path-v1",
        programDigest:
          "30c48947ab54ce7efde21a4935d7d5e278e08510e061fc5fbefb7056de818860",
      });
      const browserContract = {
        paintModel: "bounded-flow-v2" as const,
        kind: "freehand",
        mode: "pen",
        brush,
        sampleSpacing: 0,
        brushDynamics: persistedDynamics,
      };
      const expected = hasValidBrowserStrokePaintContract(browserContract);
      expect(expected, brush).toBe(true);
      // The authored snapshots ride the segmented causal pipeline, which both mirrors gate to
      // payload v4; older payload versions stay rejected regardless of the marker.
      expect(
        hasValidStudioCrdtStrokePaintContract({ payloadVersion: 4, ...browserContract }),
        brush,
      ).toBe(expected);
      for (const payloadVersion of [2, 3]) {
        expect(
          hasValidStudioCrdtStrokePaintContract({ payloadVersion, ...browserContract }),
          `${brush}:v${payloadVersion}`,
        ).toBe(false);
      }

      const document = createStrokeDocument();
      const stroke = document.getMap<Y.Map<unknown>>("strokes").get("stroke-1")!;
      stroke.set("payloadVersion", 4);
      stroke.set("brush", brush);
      stroke.set("sampleSpacing", 0);
      stroke.set("brushDynamics", persistedDynamics);
      stroke.set("extensions", { paintModel: "bounded-flow-v2" });
      expect(hasValidStudioCrdtRootSchema(document), brush).toBe(true);
      document.destroy();
    }
  });

  it("admits v2/v3/v4 layered-flow strokes and rejects incompatible paint semantics", () => {
    for (const payloadVersion of [2, 3, 4]) {
      const valid = createStrokeDocument();
      const validStroke = valid.getMap<Y.Map<unknown>>("strokes").get("stroke-1")!;
      validStroke.set("payloadVersion", payloadVersion);
      validStroke.set("opacity", 0.6);
      validStroke.set("brush", "marker");
      validStroke.set("sampleSpacing", 0);
      validStroke.set("extensions", { paintModel: "layered-flow-v1" });
      expect(hasValidStudioCrdtRootSchema(valid), `payload v${payloadVersion}`).toBe(true);
      valid.destroy();
    }

    const invalidCases: Array<(stroke: Y.Map<unknown>) => void> = [
      (stroke) => stroke.set("payloadVersion", 1),
      (stroke) => stroke.set("mode", "eraser"),
      (stroke) => stroke.set("kind", "shape"),
      (stroke) => stroke.set("fill", "#ffffff"),
      (stroke) => stroke.set("brush", "watercolor"),
      (stroke) => stroke.set("brush", "pencil-2b"),
      (stroke) => stroke.set("brush", "flat-brush"),
      (stroke) => stroke.set("brushDynamics", { pressureSize: true }),
      (stroke) => stroke.set("symmetry", { type: "vertical" }),
      (stroke) => stroke.set("extensions", {
        paintModel: "layered-flow-v1",
        stampPipeline: "causal-walker-v2",
      }),
      (stroke) => stroke.set("extensions", { paintModel: "layered-flow-v2" }),
    ];
    for (const mutate of invalidCases) {
      const document = createStrokeDocument();
      const stroke = document.getMap<Y.Map<unknown>>("strokes").get("stroke-1")!;
      stroke.set("payloadVersion", 2);
      stroke.set("opacity", 0.6);
      stroke.set("brush", "marker");
      stroke.set("sampleSpacing", 0);
      stroke.set("extensions", { paintModel: "layered-flow-v1" });
      mutate(stroke);
      expect(hasValidStudioCrdtRootSchema(document)).toBe(false);
      document.destroy();
    }

    const missingCausalGeometry = createStrokeDocument();
    const missingGeometryStroke = missingCausalGeometry
      .getMap<Y.Map<unknown>>("strokes")
      .get("stroke-1")!;
    missingGeometryStroke.set("payloadVersion", 2);
    missingGeometryStroke.set("opacity", 0.6);
    missingGeometryStroke.set("brush", "marker");
    missingGeometryStroke.set("extensions", { paintModel: "layered-flow-v1" });
    expect(hasValidStudioCrdtRootSchema(missingCausalGeometry)).toBe(false);
    missingCausalGeometry.destroy();
  });

  it("admits causal bounded-flow dynamic paint in v2/v3/v4 and rejects partial contracts", () => {
    const createBoundedFlowDocument = (payloadVersion: 2 | 3 | 4): Y.Doc => {
      const document = createStrokeDocument();
      const stroke = document.getMap<Y.Map<unknown>>("strokes").get("stroke-1")!;
      stroke.set("payloadVersion", payloadVersion);
      stroke.set("opacity", 0.6);
      stroke.set("brush", "dry-media");
      stroke.set("sampleSpacing", 0);
      stroke.set("brushDynamics", payloadVersion >= 3
        ? { pressureSize: true, minimumDiameterRatio: 0.18 }
        : { pressureSize: true });
      stroke.set("extensions", { paintModel: "bounded-flow-v2" });
      return document;
    };

    for (const payloadVersion of [2, 3, 4] as const) {
      const valid = createBoundedFlowDocument(payloadVersion);
      expect(
        hasValidStudioCrdtRootSchema(valid),
        `bounded-flow payload v${payloadVersion}`,
      ).toBe(true);
      valid.destroy();
    }

    const radial = createBoundedFlowDocument(3);
    const radialStroke = radial.getMap<Y.Map<unknown>>("strokes").get("stroke-1")!;
    radialStroke.delete("sampleSpacing");
    radialStroke.set("symmetry", {
      type: "radial",
      centerX: 100,
      centerY: 200,
      radialCount: 8,
    });
    radialStroke.set("extensions", {
      paintModel: "bounded-flow-v2",
      pressureModel: "linear-residual-path-v3",
    });
    expect(hasValidStudioCrdtRootSchema(radial)).toBe(true);
    radial.destroy();

    const invalidCases: Array<[
      label: string,
      mutate: (stroke: Y.Map<unknown>) => void,
    ]> = [
      ["payload v1", (stroke) => stroke.set("payloadVersion", 1)],
      ["missing dynamics", (stroke) => stroke.delete("brushDynamics")],
      ["non-dynamic brush", (stroke) => stroke.set("brush", "marker")],
      ["pencil family", (stroke) => stroke.set("brush", "pencil-2b")],
      ["missing causal geometry", (stroke) => stroke.delete("sampleSpacing")],
      ["eraser mode", (stroke) => stroke.set("mode", "eraser")],
      ["shape kind", (stroke) => stroke.set("kind", "shape")],
      ["closed fill", (stroke) => stroke.set("fill", "#ffffff")],
      ["stamp pipeline", (stroke) => stroke.set("extensions", {
        paintModel: "bounded-flow-v2",
        stampPipeline: "causal-walker-v2",
      })],
      ["watercolor pipeline", (stroke) => stroke.set("extensions", {
        paintModel: "bounded-flow-v2",
        watercolorPipeline: "causal-walker-v2",
      })],
      ["missing symmetry center", (stroke) => stroke.set("symmetry", {
        type: "vertical",
      })],
      ["oversized radial symmetry", (stroke) => stroke.set("symmetry", {
        type: "radial",
        centerX: 0,
        centerY: 0,
        radialCount: 33,
      })],
      ["unknown symmetry", (stroke) => stroke.set("symmetry", {
        type: "future",
        centerX: 0,
        centerY: 0,
      })],
      ["v2 dynamic floor", (stroke) => {
        stroke.set("payloadVersion", 2);
        stroke.set("brushDynamics", {
          pressureSize: true,
          minimumDiameterRatio: 0.18,
        });
      }],
    ];
    for (const [label, mutate] of invalidCases) {
      const document = createBoundedFlowDocument(3);
      const stroke = document.getMap<Y.Map<unknown>>("strokes").get("stroke-1")!;
      mutate(stroke);
      expect(hasValidStudioCrdtRootSchema(document), label).toBe(false);
      document.destroy();
    }
  });

  it("persists segmented causal deposits only in stroke payload v4", async () => {
    const createSegmentedDocument = (payloadVersion: number): Y.Doc => {
      const document = createStrokeDocument();
      const stroke = document.getMap<Y.Map<unknown>>("strokes").get("stroke-1")!;
      stroke.set("payloadVersion", payloadVersion);
      stroke.set("brush", "dry-media");
      stroke.set("sampleSpacing", 0);
      stroke.set("brushDynamics", {
        depositPipeline: "causal-deposit-v3-segmented",
      });
      stroke.set("extensions", { paintModel: "bounded-flow-v2" });
      return document;
    };

    for (const legacyVersion of [1, 2, 3]) {
      const legacy = createSegmentedDocument(legacyVersion);
      expect(
        hasValidStudioCrdtRootSchema(legacy),
        `segmented causal payload v${legacyVersion}`,
      ).toBe(false);
      legacy.destroy();
    }

    const repository = new MemoryStudioCrdtRepository();
    const current = service(repository);
    const source = createSegmentedDocument(4);
    expect(hasValidStudioCrdtRootSchema(source)).toBe(true);
    await expect(current.applyUpdate({
      workId: "work-segmented-causal-v4",
      updateId: "00000000-0000-4000-8000-000000000719",
      actorUserId: "editor",
      data: fromUint8Array(Y.encodeStateAsUpdate(source)),
    })).resolves.toMatchObject({ duplicate: false, serverSequence: "1" });

    const hydrated = new Y.Doc();
    applySync(hydrated, await current.sync("work-segmented-causal-v4"));
    const restored = hydrated.getMap<Y.Map<unknown>>("strokes").get("stroke-1")!;
    expect(restored.get("payloadVersion")).toBe(4);
    expect(restored.get("brushDynamics")).toEqual({
      depositPipeline: "causal-deposit-v3-segmented",
    });

    const poison = createSegmentedDocument(3);
    await expect(current.applyUpdate({
      workId: "work-segmented-causal-v3-poison",
      updateId: "00000000-0000-4000-8000-000000000720",
      actorUserId: "editor",
      data: fromUint8Array(Y.encodeStateAsUpdate(poison)),
    })).rejects.toBeInstanceOf(StudioCrdtInvalidPayloadError);
    expect(repository.updates.get("work-segmented-causal-v3-poison") ?? []).toEqual([]);

    source.destroy();
    hydrated.destroy();
    poison.destroy();
  });

  it("persists strict content-addressed R8 grain only in stroke payload v4", async () => {
    const r8Source = {
      kind: "r8-texture-v1",
      asset: {
        assetId: "paper.canvas-fine.v1",
        encodedSha256: `sha256:${"a".repeat(64)}`,
        decodedSha256: `sha256:${"b".repeat(64)}`,
        byteLength: 2_048,
        mediaType: "image/png",
        width: 32,
        height: 32,
        channel: "luminance",
        encoding: "r8-unorm",
      },
    };
    const createR8Document = (
      payloadVersion: number,
      source: unknown = r8Source,
    ): Y.Doc => {
      const document = createStrokeDocument();
      const stroke = document.getMap<Y.Map<unknown>>("strokes").get("stroke-1")!;
      stroke.set("payloadVersion", payloadVersion);
      stroke.set("brush", "dry-media");
      stroke.set("brushDynamics", {
        grain: { source },
      });
      return document;
    };

    for (const legacyVersion of [1, 2, 3]) {
      const legacy = createR8Document(legacyVersion);
      expect(
        hasValidStudioCrdtRootSchema(legacy),
        `R8 grain payload v${legacyVersion}`,
      ).toBe(false);
      legacy.destroy();
    }
    const malformed = createR8Document(4, {
      ...r8Source,
      asset: { ...r8Source.asset, decodedSha256: "sha256:bad" },
    });
    expect(hasValidStudioCrdtRootSchema(malformed)).toBe(false);
    malformed.destroy();
    for (const invalidSource of [
      { kind: "r8-texture-v2", asset: r8Source.asset },
      "r8-texture-v1",
    ]) {
      const invalid = createR8Document(4, invalidSource);
      expect(
        hasValidStudioCrdtRootSchema(invalid),
        `invalid R8 source ${typeof invalidSource}`,
      ).toBe(false);
      invalid.destroy();
    }

    const conflicting = createR8Document(4);
    const secondStroke = new Y.Map<unknown>();
    secondStroke.set("id", "stroke-2");
    secondStroke.set("pageId", "page-1");
    secondStroke.set("layerId", "page-root");
    secondStroke.set("status", "finalized");
    secondStroke.set("deleted", false);
    secondStroke.set("payloadVersion", 4);
    secondStroke.set("type", "draw");
    secondStroke.set("mode", "pen");
    secondStroke.set("kind", "freehand");
    secondStroke.set("stroke", "#111111");
    secondStroke.set("strokeWidth", 8);
    secondStroke.set("brush", "dry-media");
    secondStroke.set("brushDynamics", {
      grain: {
        source: {
          ...r8Source,
          asset: {
            ...r8Source.asset,
            decodedSha256: `sha256:${"c".repeat(64)}`,
          },
        },
      },
    });
    for (const key of [
      "points", "pressures", "tiltXs", "tiltYs", "twists", "speeds",
      "tangentialPressures",
    ]) secondStroke.set(key, new Y.Array<number>());
    conflicting.getMap<Y.Map<unknown>>("strokes").set("stroke-2", secondStroke);
    const secondOrder = new Y.Map<unknown>();
    secondOrder.set("strokeId", "stroke-2");
    secondOrder.set("pageId", "page-1");
    secondOrder.set("layerId", "page-root");
    secondOrder.set("active", true);
    conflicting.getArray<Y.Map<unknown>>("stroke-order").push([secondOrder]);
    expect(hasValidStudioCrdtRootSchema(conflicting)).toBe(true);
    const conflictingRepository = new MemoryStudioCrdtRepository();
    await expect(service(conflictingRepository).applyUpdate({
      workId: "work-r8-grain-conflict",
      updateId: "00000000-0000-4000-8000-000000000724",
      actorUserId: "editor",
      data: fromUint8Array(Y.encodeStateAsUpdate(conflicting)),
    })).rejects.toBeInstanceOf(StudioCrdtInvalidPayloadError);
    expect(conflictingRepository.updates.get("work-r8-grain-conflict") ?? [])
      .toEqual([]);

    const repository = new MemoryStudioCrdtRepository();
    const admittedR8References: Array<{
      actorUserId: string;
      workId: string;
      references: readonly unknown[];
      transaction: DrizzleStudioCrdtTransaction | undefined;
    }> = [];
    const current = service(
      repository,
      {},
      allowStoredRasterAssetReferences,
      {
        async assertReferencesStored() {},
        async assertR8GrainReferencesStored(
          actorUserId,
          workId,
          references,
          transaction,
        ) {
          admittedR8References.push({
            actorUserId,
            workId,
            references: structuredClone(references),
            transaction,
          });
        },
      },
    );
    const source = createR8Document(4);
    expect(hasValidStudioCrdtRootSchema(source)).toBe(true);
    await expect(current.applyUpdate({
      workId: "work-r8-grain-v4",
      updateId: "00000000-0000-4000-8000-000000000721",
      actorUserId: "editor",
      data: fromUint8Array(Y.encodeStateAsUpdate(source)),
    })).resolves.toMatchObject({ duplicate: false, serverSequence: "1" });
    expect(admittedR8References).toEqual([{
      actorUserId: "editor",
      workId: "work-r8-grain-v4",
      references: [r8Source],
      transaction: expect.any(Object),
    }]);

    const hydrated = new Y.Doc();
    applySync(hydrated, await current.sync("work-r8-grain-v4"));
    expect(
      hydrated
        .getMap<Y.Map<unknown>>("strokes")
        .get("stroke-1")!
        .get("brushDynamics"),
    ).toEqual({ grain: { source: r8Source } });

    const sourceStateVector = Y.encodeStateVector(source);
    source.getMap<Y.Map<unknown>>("strokes").get("stroke-1")!.set("brushDynamics", {
      grain: {
        source: {
          ...r8Source,
          asset: {
            ...r8Source.asset,
            decodedSha256: `sha256:${"c".repeat(64)}`,
          },
        },
      },
    });
    await expect(current.applyUpdate({
      workId: "work-r8-grain-v4",
      updateId: "00000000-0000-4000-8000-000000000723",
      actorUserId: "editor",
      data: fromUint8Array(Y.encodeStateAsUpdate(source, sourceStateVector)),
    })).rejects.toBeInstanceOf(StudioCrdtInvalidPayloadError);
    expect(admittedR8References).toHaveLength(1);

    const rejectedRepository = new MemoryStudioCrdtRepository();
    const rejectedCurrent = service(
      rejectedRepository,
      {},
      allowStoredRasterAssetReferences,
      {
        async assertReferencesStored() {},
        async assertR8GrainReferencesStored() {
          throw new Error("missing R8 grain asset");
        },
      },
    );
    const missingAsset = createR8Document(4);
    await expect(rejectedCurrent.applyUpdate({
      workId: "work-r8-grain-missing",
      updateId: "00000000-0000-4000-8000-000000000722",
      actorUserId: "editor",
      data: fromUint8Array(Y.encodeStateAsUpdate(missingAsset)),
    })).rejects.toBeInstanceOf(StudioCrdtInvalidPayloadError);
    expect(rejectedRepository.updates.get("work-r8-grain-missing") ?? []).toEqual([]);

    source.destroy();
    hydrated.destroy();
    missingAsset.destroy();
    conflicting.destroy();
  });

  it("persists and rehydrates a v3 bounded-flow dynamic stroke", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const current = service(repository);
    const source = createStrokeDocument();
    const stroke = source.getMap<Y.Map<unknown>>("strokes").get("stroke-1")!;
    stroke.set("payloadVersion", 3);
    stroke.set("brush", "dry-media");
    stroke.set("sampleSpacing", 0);
    stroke.set("brushDynamics", {
      pressureSize: true,
      minimumDiameterRatio: 0.18,
    });
    stroke.set("extensions", { paintModel: "bounded-flow-v2" });

    await expect(current.applyUpdate({
      workId: "work-bounded-flow-v3",
      updateId: "00000000-0000-4000-8000-000000000710",
      actorUserId: "editor",
      data: fromUint8Array(Y.encodeStateAsUpdate(source)),
    })).resolves.toMatchObject({ duplicate: false, serverSequence: "1" });

    const hydrated = new Y.Doc();
    applySync(hydrated, await current.sync("work-bounded-flow-v3"));
    const restored = hydrated.getMap<Y.Map<unknown>>("strokes").get("stroke-1")!;
    expect(restored.get("payloadVersion")).toBe(3);
    expect(restored.get("extensions")).toEqual({ paintModel: "bounded-flow-v2" });
    expect(restored.get("brushDynamics")).toEqual({
      pressureSize: true,
      minimumDiameterRatio: 0.18,
    });
    source.destroy();
    hydrated.destroy();
  });

  it("rejects client-incompatible paint poison before durable append", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const current = service(repository);
    const poisonCases: Array<[
      label: string,
      mutate: (stroke: Y.Map<unknown>) => void,
    ]> = [
      ["layered pencil family", (stroke) => {
        stroke.set("payloadVersion", 2);
        stroke.set("brush", "pencil-2b");
        stroke.set("sampleSpacing", 0);
        stroke.set("extensions", { paintModel: "layered-flow-v1" });
      }],
      ["bounded non-dynamic brush", (stroke) => {
        stroke.set("payloadVersion", 3);
        stroke.set("brush", "marker");
        stroke.set("sampleSpacing", 0);
        stroke.set("brushDynamics", { pressureSize: true });
        stroke.set("extensions", { paintModel: "bounded-flow-v2" });
      }],
      ["bounded missing dynamics", (stroke) => {
        stroke.set("payloadVersion", 3);
        stroke.set("brush", "dry-media");
        stroke.set("sampleSpacing", 0);
        stroke.set("extensions", { paintModel: "bounded-flow-v2" });
      }],
      ["bounded invalid symmetry", (stroke) => {
        stroke.set("payloadVersion", 3);
        stroke.set("brush", "dry-media");
        stroke.set("sampleSpacing", 0);
        stroke.set("brushDynamics", { pressureSize: true });
        stroke.set("symmetry", {
          type: "radial",
          centerX: 0,
          centerY: 0,
          radialCount: 0,
        });
        stroke.set("extensions", { paintModel: "bounded-flow-v2" });
      }],
    ];

    for (const [index, [label, mutate]] of poisonCases.entries()) {
      const workId = `work-paint-poison-${index}`;
      const poison = createStrokeDocument();
      mutate(poison.getMap<Y.Map<unknown>>("strokes").get("stroke-1")!);
      await expect(current.applyUpdate({
        workId,
        updateId: `00000000-0000-4000-8000-${(720 + index)
          .toString()
          .padStart(12, "0")}`,
        actorUserId: "editor",
        data: fromUint8Array(Y.encodeStateAsUpdate(poison)),
      }), label).rejects.toBeInstanceOf(StudioCrdtInvalidPayloadError);
      expect(repository.updates.get(workId) ?? [], label).toEqual([]);
      poison.destroy();
    }
    expect(repository.receipts.size).toBe(0);
  });

  it("admits only bounded, co-authored material-pressure semantics in stroke payload v3", () => {
    const validCases: Array<[
      label: string,
      extensions: Record<string, unknown> | undefined,
      brushDynamics: Record<string, unknown> | undefined,
    ]> = [
      [
        "inclusive zero material floor",
        {
          materialPressureModel: "canonical-material-v1",
          materialMinimumDiameterRatio: 0,
        },
        undefined,
      ],
      [
        "inclusive one dynamic floor",
        undefined,
        { pressureSize: true, minimumDiameterRatio: 1 },
      ],
      [
        "independent material and dynamic floors",
        {
          materialPressureModel: "canonical-material-v1",
          materialMinimumDiameterRatio: 0.72,
        },
        { pressureSize: true, minimumDiameterRatio: 0.18 },
      ],
    ];
    for (const [label, extensions, brushDynamics] of validCases) {
      const document = createStrokeDocument();
      const stroke = document.getMap<Y.Map<unknown>>("strokes").get("stroke-1")!;
      stroke.set("payloadVersion", 3);
      if (extensions) stroke.set("extensions", extensions);
      if (brushDynamics) stroke.set("brushDynamics", brushDynamics);
      expect(hasValidStudioCrdtRootSchema(document), label).toBe(true);
      document.destroy();
    }

    const invalidCases: Array<[
      label: string,
      payloadVersion: number,
      extensions: Record<string, unknown> | undefined,
      brushDynamics: Record<string, unknown> | undefined,
    ]> = [
      [
        "v1 material semantics",
        1,
        {
          materialPressureModel: "canonical-material-v1",
          materialMinimumDiameterRatio: 0.5,
        },
        undefined,
      ],
      [
        "v2 material semantics",
        2,
        {
          materialPressureModel: "canonical-material-v1",
          materialMinimumDiameterRatio: 0.5,
        },
        undefined,
      ],
      [
        "v1 dynamic floor",
        1,
        undefined,
        { minimumDiameterRatio: 0.5 },
      ],
      [
        "v2 dynamic floor",
        2,
        undefined,
        { minimumDiameterRatio: 0.5 },
      ],
      [
        "unknown material pressure model",
        3,
        {
          materialPressureModel: "canonical-material-v2",
          materialMinimumDiameterRatio: 0.5,
        },
        undefined,
      ],
      [
        "material model without floor",
        3,
        { materialPressureModel: "canonical-material-v1" },
        undefined,
      ],
      [
        "material floor without model",
        3,
        { materialMinimumDiameterRatio: 0.5 },
        undefined,
      ],
      [
        "negative material floor",
        3,
        {
          materialPressureModel: "canonical-material-v1",
          materialMinimumDiameterRatio: -0.01,
        },
        undefined,
      ],
      [
        "non-finite material floor",
        3,
        {
          materialPressureModel: "canonical-material-v1",
          materialMinimumDiameterRatio: Number.POSITIVE_INFINITY,
        },
        undefined,
      ],
      [
        "oversized dynamic floor",
        3,
        undefined,
        { minimumDiameterRatio: 1.01 },
      ],
      [
        "non-numeric dynamic floor",
        3,
        undefined,
        { minimumDiameterRatio: "0.5" },
      ],
    ];
    for (const [label, payloadVersion, extensions, brushDynamics] of invalidCases) {
      const document = createStrokeDocument();
      const stroke = document.getMap<Y.Map<unknown>>("strokes").get("stroke-1")!;
      stroke.set("payloadVersion", payloadVersion);
      if (extensions) stroke.set("extensions", extensions);
      if (brushDynamics) stroke.set("brushDynamics", brushDynamics);
      expect(hasValidStudioCrdtRootSchema(document), label).toBe(false);
      document.destroy();
    }
  });

  it("rejects material-pressure stroke poison updates before durable append", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const current = service(repository);
    const poisonCases: Array<[
      label: string,
      mutate: (stroke: Y.Map<unknown>) => void,
    ]> = [
      [
        "v2 material fields",
        (stroke) => {
          stroke.set("payloadVersion", 2);
          stroke.set("extensions", {
            materialPressureModel: "canonical-material-v1",
            materialMinimumDiameterRatio: 0.5,
          });
        },
      ],
      [
        "unknown v3 material model",
        (stroke) => {
          stroke.set("payloadVersion", 3);
          stroke.set("extensions", {
            materialPressureModel: "canonical-material-v2",
            materialMinimumDiameterRatio: 0.5,
          });
        },
      ],
      [
        "unpaired v3 material floor",
        (stroke) => {
          stroke.set("payloadVersion", 3);
          stroke.set("extensions", { materialMinimumDiameterRatio: 0.5 });
        },
      ],
      [
        "out-of-range v3 dynamic floor",
        (stroke) => {
          stroke.set("payloadVersion", 3);
          stroke.set("brushDynamics", { minimumDiameterRatio: -0.01 });
        },
      ],
    ];

    for (const [index, [label, mutate]] of poisonCases.entries()) {
      const workId = `work-material-poison-${index}`;
      const poison = createStrokeDocument();
      mutate(poison.getMap<Y.Map<unknown>>("strokes").get("stroke-1")!);
      await expect(
        current.applyUpdate({
          workId,
          updateId: `00000000-0000-4000-8000-${(700 + index)
            .toString()
            .padStart(12, "0")}`,
          actorUserId: "editor",
          data: fromUint8Array(Y.encodeStateAsUpdate(poison)),
        }),
        label
      ).rejects.toBeInstanceOf(StudioCrdtInvalidPayloadError);
      expect(repository.updates.get(workId) ?? [], label).toEqual([]);
      poison.destroy();
    }
    expect(repository.receipts.size).toBe(0);
  });

  it("admits the V3 path-phase extension and stationary pressure samples", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const current = service(repository);
    const source = createStrokeDocument();
    const stroke = source.getMap<Y.Map<unknown>>("strokes").get("stroke-1")!;
    stroke.set("sampleSpacing", 0);
    stroke.set("extensions", { pressureModel: "linear-residual-path-v3" });
    (stroke.get("points") as Y.Array<number>).push([0, 0, 9, 0, 9, 0, 10, 0]);
    (stroke.get("pressures") as Y.Array<number>).push([1, 1, 0, 0]);
    for (const key of ["tiltXs", "tiltYs", "twists", "speeds", "tangentialPressures"]) {
      (stroke.get(key) as Y.Array<number>).push([0, 0, 0, 0]);
    }

    expect(hasValidStudioCrdtRootSchema(source)).toBe(true);
    await expect(current.applyUpdate({
      workId: "work-residual-path-v3",
      updateId: "00000000-0000-4000-8000-000000000109",
      actorUserId: "editor",
      data: fromUint8Array(Y.encodeStateAsUpdate(source)),
    })).resolves.toMatchObject({ duplicate: false });

    const hydrated = new Y.Doc();
    applySync(hydrated, await current.sync("work-residual-path-v3"));
    const restored = hydrated.getMap<Y.Map<unknown>>("strokes").get("stroke-1")!;
    expect(restored.get("extensions")).toEqual({
      pressureModel: "linear-residual-path-v3",
    });
    expect((restored.get("points") as Y.Array<number>).toArray())
      .toEqual([0, 0, 9, 0, 9, 0, 10, 0]);
    expect((restored.get("pressures") as Y.Array<number>).toArray()).toEqual([1, 1, 0, 0]);
    hydrated.destroy();
    source.destroy();
  });

  it("rejects stroke metadata and pointer samples the browser cannot decode", () => {
    const invalidPressure = createStrokeDocument();
    const pressureStroke = invalidPressure.getMap<Y.Map<unknown>>("strokes").get("stroke-1")!;
    (pressureStroke.get("points") as Y.Array<number>).push([10, 20]);
    (pressureStroke.get("pressures") as Y.Array<number>).push([2]);
    for (const key of ["tiltXs", "tiltYs", "twists", "speeds", "tangentialPressures"]) {
      (pressureStroke.get(key) as Y.Array<number>).push([0]);
    }
    expect(hasValidStudioCrdtRootSchema(invalidPressure)).toBe(false);
    invalidPressure.destroy();

    const unknownMetadata = createStrokeDocument();
    unknownMetadata.getMap<Y.Map<unknown>>("strokes").get("stroke-1")!
      .set("unboundedPluginPayload", new Y.Map());
    expect(hasValidStudioCrdtRootSchema(unknownMetadata)).toBe(false);
    unknownMetadata.destroy();

    const invalidStyle = createStrokeDocument();
    invalidStyle.getMap<Y.Map<unknown>>("strokes").get("stroke-1")!
      .set("opacity", 1.5);
    expect(hasValidStudioCrdtRootSchema(invalidStyle)).toBe(false);
    invalidStyle.destroy();
  });

  it("rejects orphaned, non-canonical, or incorrectly typed reserved dynamic roots", () => {
    const orphan = createScenePageDocument();
    orphan.getMap<unknown>("scene-element:orphan").set("id", "orphan");
    expect(hasValidStudioCrdtRootSchema(orphan)).toBe(false);
    orphan.destroy();

    const nonCanonical = createScenePageDocument();
    nonCanonical.getMap<boolean>("scene-elements").set("scene/slash", true);
    const wrongName = nonCanonical.getMap<unknown>("scene-element:scene/slash");
    wrongName.set("id", "scene/slash");
    expect(hasValidStudioCrdtRootSchema(nonCanonical)).toBe(false);
    nonCanonical.destroy();

    const wrongTrackerValue = createScenePageDocument();
    wrongTrackerValue.getMap<unknown>("studio-pages").set("page-1", false);
    expect(hasValidStudioCrdtRootSchema(wrongTrackerValue)).toBe(false);
    wrongTrackerValue.destroy();

    const wrongDynamicType = new Y.Doc();
    wrongDynamicType.getMap<boolean>("scene-elements").set("scene-1", true);
    wrongDynamicType.getArray("scene-element:scene-1");
    expect(hasValidStudioCrdtRootSchema(wrongDynamicType)).toBe(false);
    wrongDynamicType.destroy();
  });

  it("rejects illegal scene fields, nested Yjs values, oversize payloads, and ambiguous order ids", () => {
    const illegalProperty = createScenePageDocument();
    illegalProperty.getMap<unknown>("scene-element:scene-1").set("prop:src", "data:image/png;base64,AA");
    expect(hasValidStudioCrdtRootSchema(illegalProperty)).toBe(false);
    illegalProperty.destroy();

    const nestedYjs = createScenePageDocument();
    nestedYjs.getMap<unknown>("scene-element:scene-1").set("prop:gradient", new Y.Map());
    expect(hasValidStudioCrdtRootSchema(nestedYjs)).toBe(false);
    nestedYjs.destroy();

    const oversized = createScenePageDocument();
    oversized.getMap<unknown>("scene-element:scene-1").set("prop:text", "가".repeat(20_000));
    expect(hasValidStudioCrdtRootSchema(oversized)).toBe(false);
    oversized.destroy();

    const ambiguousOrder = createScenePageDocument();
    const entry = ambiguousOrder.getArray<Y.Map<unknown>>("stroke-order").get(0);
    entry.set("strokeId", "stroke-1");
    expect(hasValidStudioCrdtRootSchema(ambiguousOrder)).toBe(false);
    ambiguousOrder.destroy();
  });

  it("enforces the same typed scene-property contract as the browser", () => {
    const invalidCases: Array<[property: string, value: unknown]> = [
      ["hidden", "yes"],
      ["align", "diagonal"],
      ["lineHeight", "wide"],
    ];
    for (const [property, value] of invalidCases) {
      const invalid = createScenePageDocument();
      invalid.getMap<unknown>("scene-element:scene-1").set(`prop:${property}`, value);
      expect(hasValidStudioCrdtRootSchema(invalid)).toBe(false);
      invalid.destroy();
    }

    const invalidFramePoints = createScenePageDocument();
    const frame = invalidFramePoints.getMap<unknown>("scene-element:scene-1");
    frame.set("type", "frame");
    for (const key of ["text", "fontSize", "fill", "rotation"]) frame.delete(`prop:${key}`);
    frame.set("prop:height", 300);
    frame.set("prop:points", [0, 0, 100, 0, 100, 100]);
    expect(hasValidStudioCrdtRootSchema(invalidFramePoints)).toBe(false);
    invalidFramePoints.destroy();

    const invalidLineCount = createScenePageDocument();
    const focus = invalidLineCount.getMap<unknown>("scene-element:scene-1");
    focus.set("type", "focusLines");
    for (const key of ["text", "fontSize", "fill"]) focus.delete(`prop:${key}`);
    focus.set("prop:height", 300);
    focus.set("prop:lineCount", 1.5);
    focus.set("prop:innerRadius", 10);
    focus.set("prop:outerRadius", 100);
    focus.set("prop:stroke", "#111111");
    focus.set("prop:strokeWidth", 2);
    focus.set("prop:noise", 0);
    expect(hasValidStudioCrdtRootSchema(invalidLineCount)).toBe(false);
    invalidLineCount.destroy();

    const aggregateEntryOverflow = createScenePageDocument();
    const text = aggregateEntryOverflow.getMap<unknown>("scene-element:scene-1");
    text.set("prop:gradient", Array<number>(2_100).fill(0));
    text.set("prop:textPath", Array<number>(2_100).fill(0));
    expect(hasValidStudioCrdtRootSchema(aggregateEntryOverflow)).toBe(false);
    aggregateEntryOverflow.destroy();
  });

  it("accepts bounded admitted-asset reference state and rejects payload smuggling or unsupported types", () => {
    for (const elementType of ["image", "vrm", "background3d"]) {
      const valid = createReferenceTopologyDocument(elementType);
      const scene = valid.getMap<unknown>("scene-element:scene-1");
      scene.set("prop:opacity", 0.5);
      scene.set("prop:flippedY", true);
      scene.set("prop:blur", 8);
      if (elementType === "image") {
        scene.set("prop:brightness", 0.8);
        scene.set("prop:contrast", -80);
        scene.set("prop:hue", 180);
        scene.set("prop:saturation", -1);
        scene.set("prop:blurFx", {
          type: "motion",
          strength: 100,
          radius: 40,
          angle: 315,
        });
        scene.set("prop:curve", [
          { x: 0, y: 8 },
          { x: 128, y: 144 },
          { x: 255, y: 248 },
        ]);
        scene.set("prop:curveCh", {
          r: [{ x: 0, y: 0 }, { x: 255, y: 240 }],
          b: [{ x: 0, y: 12 }, { x: 255, y: 255 }],
        });
        scene.set("prop:smartFilters", {
          version: 1,
          entries: [{
            id: "tone-1",
            engine: "brightness-contrast",
            enabled: true,
            params: { brightness: 0.2 },
          }],
        });
      }
      expect(hasValidStudioCrdtRootSchema(valid)).toBe(true);
      valid.destroy();
    }

    for (const elementType of [
      "draw", "text", "reference", "toString", "bad\u0007type", "x".repeat(161),
    ]) {
      const invalid = createReferenceTopologyDocument(elementType);
      expect(hasValidStudioCrdtRootSchema(invalid)).toBe(false);
      invalid.destroy();
    }

    const smuggledRaster = createReferenceTopologyDocument();
    smuggledRaster.getMap<unknown>("scene-element:scene-1")
      .set("prop:src", "data:image/png;base64,AA==");
    expect(hasValidStudioCrdtRootSchema(smuggledRaster)).toBe(false);
    smuggledRaster.destroy();

    const wrongValue = createReferenceTopologyDocument();
    wrongValue.getMap<unknown>("scene-element:scene-1").set("prop:elementType", 3);
    expect(hasValidStudioCrdtRootSchema(wrongValue)).toBe(false);
    wrongValue.destroy();

    const hiddenBaseline = createReferenceTopologyDocument();
    hiddenBaseline.getMap<unknown>("scene-element:scene-1")
      .set("base:elementType", "x".repeat(1_000));
    expect(hasValidStudioCrdtRootSchema(hiddenBaseline)).toBe(false);
    hiddenBaseline.destroy();

    const invalidPlacement = createReferenceTopologyDocument();
    invalidPlacement.getMap<unknown>("scene-element:scene-1").set("prop:width", 0);
    expect(hasValidStudioCrdtRootSchema(invalidPlacement)).toBe(false);
    invalidPlacement.destroy();

    const invalidFilter = createReferenceTopologyDocument();
    invalidFilter.getMap<unknown>("scene-element:scene-1").set("prop:blur", 31);
    expect(hasValidStudioCrdtRootSchema(invalidFilter)).toBe(false);
    invalidFilter.destroy();

    const hiddenInvalidFilter = createReferenceTopologyDocument();
    const hiddenFilterScene = hiddenInvalidFilter.getMap<unknown>("scene-element:scene-1");
    hiddenFilterScene.set("base:blur", -1);
    hiddenFilterScene.set("prop:blur", 4);
    expect(hasValidStudioCrdtRootSchema(hiddenInvalidFilter)).toBe(false);
    hiddenInvalidFilter.destroy();

    const overPointCurve = createReferenceTopologyDocument();
    overPointCurve.getMap<unknown>("scene-element:scene-1").set(
      "prop:curve",
      Array.from({ length: 17 }, (_, index) => ({
        x: Math.round(index * 255 / 16),
        y: index,
      }))
    );
    expect(hasValidStudioCrdtRootSchema(overPointCurve)).toBe(false);
    overPointCurve.destroy();

    const hiddenInvalidCurve = createReferenceTopologyDocument();
    const hiddenCurveScene = hiddenInvalidCurve.getMap<unknown>("scene-element:scene-1");
    hiddenCurveScene.set("base:curve", [
      { x: 0, y: 0 },
      { x: 128, y: 100 },
      { x: 128, y: 120 },
      { x: 255, y: 255 },
    ]);
    hiddenCurveScene.set("prop:curve", [
      { x: 0, y: 0 },
      { x: 255, y: 255 },
    ]);
    expect(hasValidStudioCrdtRootSchema(hiddenInvalidCurve)).toBe(false);
    hiddenInvalidCurve.destroy();

    const hiddenInvalidBlurFx = createReferenceTopologyDocument();
    const hiddenBlurFxScene = hiddenInvalidBlurFx.getMap<unknown>("scene-element:scene-1");
    hiddenBlurFxScene.set("base:blurFx", {
      type: "motion",
      strength: 100,
      radius: 41,
      angle: 0,
    });
    hiddenBlurFxScene.set("prop:blurFx", {
      type: "gaussian",
      strength: 100,
      radius: 10,
      angle: 0,
    });
    expect(hasValidStudioCrdtRootSchema(hiddenInvalidBlurFx)).toBe(false);
    hiddenInvalidBlurFx.destroy();

    const prototypeType = createReferenceTopologyDocument();
    prototypeType.getMap<unknown>("scene-element:scene-1").set("type", "toString");
    expect(() => hasValidStudioCrdtRootSchema(prototypeType)).not.toThrow();
    expect(hasValidStudioCrdtRootSchema(prototypeType)).toBe(false);
    prototypeType.destroy();
  });

  it("rejects order entries whose target or page/layer coordinates do not match the record", () => {
    const mismatchedLayer = createScenePageDocument();
    mismatchedLayer.getArray<Y.Map<unknown>>("stroke-order").get(0).set("layerId", "other-layer");
    expect(hasValidStudioCrdtRootSchema(mismatchedLayer)).toBe(false);
    mismatchedLayer.destroy();

    const missingPage = createScenePageDocument();
    missingPage.getArray<Y.Map<unknown>>("page-order").get(0).set("pageId", "missing-page");
    expect(hasValidStudioCrdtRootSchema(missingPage)).toBe(false);
    missingPage.destroy();

    const activeFlood = createScenePageDocument();
    const order = activeFlood.getArray<Y.Map<unknown>>("stroke-order");
    for (let index = 1; index <= 256; index += 1) {
      const entry = new Y.Map<unknown>();
      entry.set("elementId", "scene-1");
      entry.set("pageId", "page-1");
      entry.set("layerId", "layer-1");
      entry.set("kind", "scene");
      entry.set("active", true);
      order.push([entry]);
    }
    expect(hasValidStudioCrdtRootSchema(activeFlood)).toBe(false);
    activeFlood.destroy();
  });

  it("accepts reparent history while requiring the active order entry to match", async () => {
    const strokeDoc = createStrokeDocument();
    const stroke = strokeDoc.getMap<Y.Map<unknown>>("strokes").get("stroke-1")!;
    stroke.set("pageId", "page-2");
    stroke.set("layerId", "layer-2");
    strokeDoc.getArray<Y.Map<unknown>>("stroke-order").get(0).set("active", false);
    const movedStrokeOrder = new Y.Map<unknown>();
    movedStrokeOrder.set("strokeId", "stroke-1");
    movedStrokeOrder.set("pageId", "page-2");
    movedStrokeOrder.set("layerId", "layer-2");
    movedStrokeOrder.set("active", true);
    strokeDoc.getArray<Y.Map<unknown>>("stroke-order").push([movedStrokeOrder]);
    expect(hasValidStudioCrdtRootSchema(strokeDoc)).toBe(true);

    const sceneDoc = createScenePageDocument();
    const scene = sceneDoc.getMap<unknown>("scene-element:scene-1");
    scene.set("pageId", "page-2");
    scene.set("layerId", "layer-2");
    sceneDoc.getArray<Y.Map<unknown>>("stroke-order").get(0).set("active", false);
    const movedSceneOrder = new Y.Map<unknown>();
    movedSceneOrder.set("elementId", "scene-1");
    movedSceneOrder.set("pageId", "page-2");
    movedSceneOrder.set("layerId", "layer-2");
    movedSceneOrder.set("kind", "scene");
    movedSceneOrder.set("active", true);
    sceneDoc.getArray<Y.Map<unknown>>("stroke-order").push([movedSceneOrder]);
    expect(hasValidStudioCrdtRootSchema(sceneDoc)).toBe(true);

    const current = service(new MemoryStudioCrdtRepository());
    await expect(current.applyUpdate({
      workId: "work-reparent-stroke",
      updateId: "00000000-0000-4000-8000-000000000106",
      actorUserId: "editor",
      data: fromUint8Array(Y.encodeStateAsUpdate(strokeDoc)),
    })).resolves.toMatchObject({ duplicate: false });
    await expect(current.applyUpdate({
      workId: "work-reparent-scene",
      updateId: "00000000-0000-4000-8000-000000000107",
      actorUserId: "editor",
      data: fromUint8Array(Y.encodeStateAsUpdate(sceneDoc)),
    })).resolves.toMatchObject({ duplicate: false });

    strokeDoc.destroy();
    sceneDoc.destroy();
  });

  it("accepts converged concurrent draw and scene reparents with losing active entries", async () => {
    const fork = (source: Y.Doc): Y.Doc => {
      const target = new Y.Doc();
      Y.applyUpdate(target, Y.encodeStateAsUpdate(source));
      return target;
    };
    const reparentStroke = (doc: Y.Doc, pageId: string, layerId: string) => {
      const record = doc.getMap<Y.Map<unknown>>("strokes").get("stroke-1")!;
      record.set("pageId", pageId);
      record.set("layerId", layerId);
      doc.getArray<Y.Map<unknown>>("stroke-order").get(0).set("active", false);
      const entry = new Y.Map<unknown>();
      entry.set("strokeId", "stroke-1");
      entry.set("pageId", pageId);
      entry.set("layerId", layerId);
      entry.set("active", true);
      doc.getArray<Y.Map<unknown>>("stroke-order").push([entry]);
    };
    const reparentScene = (doc: Y.Doc, pageId: string, layerId: string) => {
      const record = doc.getMap<unknown>("scene-element:scene-1");
      record.set("pageId", pageId);
      record.set("layerId", layerId);
      doc.getArray<Y.Map<unknown>>("stroke-order").get(0).set("active", false);
      const entry = new Y.Map<unknown>();
      entry.set("elementId", "scene-1");
      entry.set("pageId", pageId);
      entry.set("layerId", layerId);
      entry.set("kind", "scene");
      entry.set("active", true);
      doc.getArray<Y.Map<unknown>>("stroke-order").push([entry]);
    };
    const converge = (
      base: Y.Doc,
      mutate: (doc: Y.Doc, pageId: string, layerId: string) => void
    ) => {
      const left = fork(base);
      const right = fork(base);
      mutate(left, "page-left", "layer-left");
      mutate(right, "page-right", "layer-right");
      const baseVector = Y.encodeStateVector(base);
      const leftUpdate = Y.encodeStateAsUpdate(left, baseVector);
      const rightUpdate = Y.encodeStateAsUpdate(right, baseVector);
      const merged = fork(base);
      Y.applyUpdate(merged, leftUpdate);
      Y.applyUpdate(merged, rightUpdate);
      return { left, right, merged, leftUpdate, rightUpdate };
    };

    const strokeBase = createStrokeDocument();
    const strokeForks = converge(strokeBase, reparentStroke);
    expect(hasValidStudioCrdtRootSchema(strokeForks.merged)).toBe(true);
    expect(strokeForks.merged.getArray<Y.Map<unknown>>("stroke-order").toArray()
      .filter((entry) => entry.get("active") === true)).toHaveLength(2);

    const sceneBase = createScenePageDocument();
    const sceneForks = converge(sceneBase, reparentScene);
    expect(hasValidStudioCrdtRootSchema(sceneForks.merged)).toBe(true);
    expect(sceneForks.merged.getArray<Y.Map<unknown>>("stroke-order").toArray()
      .filter((entry) => entry.get("active") === true)).toHaveLength(2);

    const current = service(new MemoryStudioCrdtRepository());
    const applySequence = async (
      workId: string,
      base: Y.Doc,
      first: Uint8Array,
      second: Uint8Array,
      idOffset: number
    ) => {
      for (const [index, update] of [Y.encodeStateAsUpdate(base), first, second].entries()) {
        await current.applyUpdate({
          workId,
          updateId: `00000000-0000-4000-8000-${String(idOffset + index).padStart(12, "0")}`,
          actorUserId: index === 2 ? "editor-right" : "editor-left",
          data: fromUint8Array(update),
        });
      }
    };
    await expect(applySequence(
      "work-concurrent-stroke-reparent",
      strokeBase,
      strokeForks.leftUpdate,
      strokeForks.rightUpdate,
      108
    )).resolves.toBeUndefined();
    await expect(applySequence(
      "work-concurrent-scene-reparent",
      sceneBase,
      sceneForks.leftUpdate,
      sceneForks.rightUpdate,
      111
    )).resolves.toBeUndefined();

    for (const doc of [
      strokeBase,
      strokeForks.left,
      strokeForks.right,
      strokeForks.merged,
      sceneBase,
      sceneForks.left,
      sceneForks.right,
      sceneForks.merged,
    ]) doc.destroy();
  });

  it("rejects malformed scene/page updates before they reach durable storage", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const current = service(repository);
    const malformed = createScenePageDocument();
    malformed.getMap<unknown>("studio-page:page-1").set("prop:canvasH", Number.NaN);

    await expect(
      current.applyUpdate({
        workId: "work-1",
        updateId: "00000000-0000-4000-8000-000000000103",
        actorUserId: "editor",
        data: fromUint8Array(Y.encodeStateAsUpdate(malformed)),
      })
    ).rejects.toBeInstanceOf(StudioCrdtInvalidPayloadError);
    expect(repository.updates.get("work-1") ?? []).toEqual([]);
    expect(repository.receipts.size).toBe(0);
    malformed.destroy();
  });

  it("classifies a poisoned persisted Studio root as stored-state corruption", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const poison = new Y.Doc();
    poison.getArray<unknown>("stroke-order").push(["not-a-map"]);
    repository.snapshots.set("work-1", {
      workId: "work-1",
      snapshot: Y.encodeStateAsUpdate(poison),
      compactedSequence: 1n,
      updatedAt: new Date("2026-07-16T00:00:00.000Z"),
    });
    poison.destroy();

    await expect(service(repository).sync("work-1")).rejects.toBeInstanceOf(
      StudioCrdtStorageCorruptionError
    );
  });

  it("fails closed when durable updates regress, duplicate a sequence, or corrupt metadata", async () => {
    const makeStoredUpdate = (
      sequence: bigint,
      updateId: string,
      overrides: Partial<StudioCrdtUpdateRecord> = {}
    ): StudioCrdtUpdateRecord => ({
      workId: "work-ordered-log",
      sequence,
      updateId,
      actorUserId: "editor",
      payload: toUint8Array(yUpdate(`sequence-${sequence}`, String(sequence))),
      createdAt: new Date("2026-07-16T00:00:00.000Z"),
      ...overrides,
    });
    const cases: Array<[string, StudioCrdtUpdateRecord[]]> = [
      [
        "regressing sequence",
        [
          makeStoredUpdate(2n, "00000000-0000-4000-8000-000000000502"),
          makeStoredUpdate(1n, "00000000-0000-4000-8000-000000000501"),
        ],
      ],
      [
        "duplicate sequence",
        [
          makeStoredUpdate(1n, "00000000-0000-4000-8000-000000000503"),
          makeStoredUpdate(1n, "00000000-0000-4000-8000-000000000504"),
        ],
      ],
      [
        "duplicate update id",
        [
          makeStoredUpdate(1n, "00000000-0000-4000-8000-000000000507"),
          makeStoredUpdate(2n, "00000000-0000-4000-8000-000000000507"),
        ],
      ],
      [
        "invalid update id",
        [makeStoredUpdate(1n, "not-a-uuid")],
      ],
      [
        "invalid actor id",
        [makeStoredUpdate(1n, "00000000-0000-4000-8000-000000000505", {
          actorUserId: "editor\u0000",
        })],
      ],
      [
        "invalid timestamp",
        [makeStoredUpdate(1n, "00000000-0000-4000-8000-000000000506", {
          createdAt: new Date(Number.NaN),
        })],
      ],
    ];

    for (const [label, updates] of cases) {
      const repository = new MemoryStudioCrdtRepository();
      repository.updates.set("work-ordered-log", updates);
      await expect(
        service(repository).sync("work-ordered-log"),
        label
      ).rejects.toBeInstanceOf(StudioCrdtStorageCorruptionError);
    }
  });

  it("rejects a prospective state-vector overflow before persisting the update", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const current = service(repository, { stateVectorMaxBytes: 1 });

    await expect(
      current.applyUpdate({
        workId: "work-1",
        updateId: "00000000-0000-4000-8000-000000000101",
        actorUserId: "editor",
        data: yUpdate("stroke", "1"),
      })
    ).rejects.toBeInstanceOf(StudioCrdtDocumentTooLargeError);

    expect(repository.updates.get("work-1") ?? []).toEqual([]);
    expect(repository.receipts.size).toBe(0);
  });

  it("classifies an oversized hydrated state vector as stored-state corruption", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const stored = new Y.Doc();
    stored.getMap<string>("root").set("stroke", "1");
    repository.snapshots.set("work-1", {
      workId: "work-1",
      snapshot: Y.encodeStateAsUpdate(stored),
      compactedSequence: 1n,
      updatedAt: new Date("2026-07-16T00:00:00.000Z"),
    });
    stored.destroy();

    const current = service(repository, { stateVectorMaxBytes: 1 });
    await expect(current.sync("work-1")).rejects.toBeInstanceOf(
      StudioCrdtStorageCorruptionError
    );
  });

  it("defensively refuses to construct a response with an oversized server vector", () => {
    const doc = new Y.Doc();
    doc.getMap<string>("root").set("stroke", "1");
    const encodedLength = Y.encodeStateVector(doc).byteLength;

    expect(() => encodeStudioCrdtServerStateVector(doc, encodedLength - 1)).toThrow(
      StudioCrdtStorageCorruptionError
    );
    expect(toUint8Array(encodeStudioCrdtServerStateVector(doc))).toHaveLength(
      encodedLength
    );
    doc.destroy();
  });

  it("persists before mutating the cached document", async () => {
    const repository = new MemoryStudioCrdtRepository();
    repository.failAppend = true;
    const current = service(repository);
    await expect(
      current.applyUpdate({
        workId: "work-1",
        updateId: "00000000-0000-4000-8000-000000000002",
        actorUserId: "editor",
        data: yUpdate("lost", "no"),
      })
    ).rejects.toThrow("write failed");
    repository.failAppend = false;
    const target = new Y.Doc();
    applySync(target, await current.sync("work-1"));
    expect(target.getMap("root").has("lost")).toBe(false);
    target.destroy();
  });

  it("bounds a stalled work queue and recovers capacity without running the rejected operation", async () => {
    const repository = new MemoryStudioCrdtRepository();
    let appendCalls = 0;
    let releaseFirstAppend: (() => void) | undefined;
    let markFirstAppendStarted: (() => void) | undefined;
    const firstAppendStarted = new Promise<void>((resolve) => {
      markFirstAppendStarted = resolve;
    });
    repository.beforeAppend = () => {
      appendCalls += 1;
      if (appendCalls !== 1) return Promise.resolve();
      markFirstAppendStarted?.();
      return new Promise<void>((resolve) => {
        releaseFirstAppend = resolve;
      });
    };
    const current = service(repository, {
      maxPendingOperationsPerWork: 2,
      maxPendingOperationsTotal: 3,
    });
    const first = current.applyUpdate({
      workId: "work-backpressure",
      updateId: "00000000-0000-4000-8000-000000000301",
      actorUserId: "editor-a",
      data: yUpdate("first", "1"),
    });
    await firstAppendStarted;
    const second = current.applyUpdate({
      workId: "work-backpressure",
      updateId: "00000000-0000-4000-8000-000000000302",
      actorUserId: "editor-b",
      data: yUpdate("second", "2"),
    });

    await expect(current.sync("work-backpressure")).rejects.toBeInstanceOf(
      StudioCrdtBackpressureError
    );
    expect(appendCalls).toBe(1);
    // A saturated room does not consume the process-wide capacity reserved for other works.
    await expect(current.sync("work-neighbour")).resolves.toMatchObject({
      serverSequence: "0",
    });

    releaseFirstAppend?.();
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ serverSequence: "1" }),
      expect.objectContaining({ serverSequence: "2" }),
    ]);
    await expect(current.sync("work-backpressure")).resolves.toMatchObject({
      serverSequence: "2",
    });
    expect(appendCalls).toBe(2);
  });

  it("bounds the aggregate queue across rooms and releases the process slot after settlement", async () => {
    const repository = new MemoryStudioCrdtRepository();
    let startedAppendCount = 0;
    let markBothAppendsStarted: (() => void) | undefined;
    let releaseAppends: (() => void) | undefined;
    const bothAppendsStarted = new Promise<void>((resolve) => {
      markBothAppendsStarted = resolve;
    });
    const appendGate = new Promise<void>((resolve) => {
      releaseAppends = resolve;
    });
    repository.beforeAppend = () => {
      startedAppendCount += 1;
      if (startedAppendCount === 2) markBothAppendsStarted?.();
      return appendGate;
    };
    const current = service(repository, {
      maxPendingOperationsPerWork: 2,
      maxPendingOperationsTotal: 2,
    });
    const first = current.applyUpdate({
      workId: "work-global-a",
      updateId: "00000000-0000-4000-8000-000000000303",
      actorUserId: "editor-a",
      data: yUpdate("first", "1"),
    });
    const second = current.applyUpdate({
      workId: "work-global-b",
      updateId: "00000000-0000-4000-8000-000000000304",
      actorUserId: "editor-b",
      data: yUpdate("second", "2"),
    });
    await bothAppendsStarted;

    await expect(current.sync("work-global-c")).rejects.toBeInstanceOf(
      StudioCrdtBackpressureError
    );
    expect(startedAppendCount).toBe(2);

    releaseAppends?.();
    await Promise.all([first, second]);
    await expect(current.sync("work-global-c")).resolves.toMatchObject({
      serverSequence: "0",
    });
  });

  it("keeps idle nodes silent and reports only active load plus the final zero transition", async () => {
    const repository = new MemoryStudioCrdtRepository();
    let releaseLoad: (() => void) | undefined;
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    vi.spyOn(repository, "loadDocument").mockImplementation(async () => {
      await loadGate;
      return { snapshot: null, updates: [] };
    });
    const reportLoad = vi.fn(async () => undefined);
    const readClusterLoad = vi.fn(async () => 1);
    const scheduled: Array<{
      handler: () => void;
      delay: number;
      handle: ReturnType<typeof setInterval>;
    }> = [];
    const cancelInterval = vi.fn();
    const current = service(
      repository,
      {
        scheduleInterval: (handler, delay) => {
          const handle = {} as ReturnType<typeof setInterval>;
          scheduled.push({ handler, delay, handle });
          return handle;
        },
        cancelInterval,
      },
      undefined,
      undefined,
      { reportLoad, readClusterLoad }
    );

    await Promise.resolve();
    expect(scheduled.some(({ delay }) => delay === 350)).toBe(false);
    expect(reportLoad).not.toHaveBeenCalled();
    expect(readClusterLoad).not.toHaveBeenCalled();

    const syncing = current.sync("work-active-cluster-load");
    await vi.waitFor(() => {
      expect(reportLoad).toHaveBeenCalledWith(
        expect.any(String),
        1,
        expect.any(Date)
      );
    });
    const clusterTimer = scheduled.find(({ delay }) => delay === 350);
    expect(clusterTimer?.handler).toBeTypeOf("function");
    expect(readClusterLoad).toHaveBeenCalledOnce();

    releaseLoad?.();
    await syncing;
    await vi.waitFor(() => {
      expect(reportLoad).toHaveBeenLastCalledWith(
        expect.any(String),
        0,
        expect.any(Date)
      );
    });
    expect(cancelInterval).toHaveBeenCalledWith(clusterTimer?.handle);
    const reportCountAfterFinalZero = reportLoad.mock.calls.length;
    await Promise.resolve();
    expect(reportLoad).toHaveBeenCalledTimes(reportCountAfterFinalZero);
    expect(readClusterLoad).toHaveBeenCalledOnce();
  });

  it("rejects a new operation when the cached cluster-wide load is at or over budget", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const clusterLoadRepository = new MemoryStudioCrdtClusterLoadRepository();
    clusterLoadRepository.clusterLoad = 5;
    const current = service(
      repository,
      { maxClusterPendingOperationsTotal: 5 },
      undefined,
      undefined,
      clusterLoadRepository
    );
    const internals = current as unknown as {
      pendingOperationCount: number;
      reportClusterLoad(): Promise<void>;
    };
    internals.pendingOperationCount = 1;
    await internals.reportClusterLoad();

    await expect(current.sync("work-cluster-cap")).rejects.toBeInstanceOf(
      StudioCrdtBackpressureError
    );
  });

  it("falls back to local-only caps once the last cluster heartbeat is stale", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const clusterLoadRepository = new MemoryStudioCrdtClusterLoadRepository();
    clusterLoadRepository.clusterLoad = 999;
    let currentTime = new Date("2026-01-01T00:00:00.000Z");
    const current = service(
      repository,
      {
        now: () => currentTime,
        maxClusterPendingOperationsTotal: 1,
        clusterLoadStaleAfterMs: 1_000,
        // Manual sampling below owns the clock in this test; no real recurring timer may race it.
        scheduleInterval: () => ({}) as ReturnType<typeof setInterval>,
        cancelInterval: () => undefined,
      },
      undefined,
      undefined,
      clusterLoadRepository
    );
    const internals = current as unknown as {
      pendingOperationCount: number;
      reportClusterLoad(): Promise<void>;
    };
    internals.pendingOperationCount = 1;
    await internals.reportClusterLoad();

    await expect(current.sync("work-stale-cluster")).rejects.toBeInstanceOf(
      StudioCrdtBackpressureError
    );

    currentTime = new Date(currentTime.getTime() + 1_001);
    await expect(current.sync("work-stale-cluster")).resolves.toMatchObject({
      serverSequence: "0",
    });
  });

  it("never blocks admission on a failed cluster-load heartbeat", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const clusterLoadRepository = new MemoryStudioCrdtClusterLoadRepository();
    clusterLoadRepository.failReads = true;
    const current = service(
      repository,
      {},
      undefined,
      undefined,
      clusterLoadRepository
    );

    await expect(current.sync("work-cluster-down")).resolves.toMatchObject({
      serverSequence: "0",
    });
  });

  it("does not let a timed-out cluster-load read overwrite a newer successful heartbeat", async () => {
    vi.useFakeTimers();
    try {
      let resolveLateRead: ((value: number) => void) | undefined;
      const lateRead = new Promise<number>((resolve) => {
        resolveLateRead = resolve;
      });
      let readCount = 0;
      const clusterLoadRepository: StudioCrdtClusterLoadRepository = {
        async reportLoad() {},
        async readClusterLoad() {
          readCount += 1;
          return readCount === 1 ? lateRead : 2;
        },
      };
      const current = service(
        new MemoryStudioCrdtRepository(),
        {
          clusterLoadHeartbeatMs: 100,
          clusterLoadStaleAfterMs: 1_000,
        },
        undefined,
        undefined,
        clusterLoadRepository
      );
      const internals = current as unknown as {
        cachedClusterPendingOperations: number;
        pendingOperationCount: number;
        reportClusterLoad(): Promise<void>;
      };
      internals.pendingOperationCount = 1;

      const first = internals.reportClusterLoad();
      await vi.advanceTimersByTimeAsync(401);
      await first;
      await internals.reportClusterLoad();
      expect(readCount).toBeGreaterThanOrEqual(2);
      expect(internals.cachedClusterPendingOperations).toBe(2);

      resolveLateRead?.(999);
      await Promise.resolve();
      await Promise.resolve();
      expect(internals.cachedClusterPendingOperations).toBe(2);
      await current.onModuleDestroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits out an in-flight cluster heartbeat before onModuleDestroy resolves", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const clusterLoadRepository = new MemoryStudioCrdtClusterLoadRepository();
    let releaseGate: (() => void) | undefined;
    clusterLoadRepository.readGate = new Promise((resolve) => {
      releaseGate = resolve;
    });
    const current = service(repository, {}, undefined, undefined, clusterLoadRepository);
    const internals = current as unknown as {
      pendingOperationCount: number;
      reportClusterLoad(): Promise<void>;
    };
    internals.pendingOperationCount = 1;
    void internals.reportClusterLoad();

    let destroyed = false;
    const destroying = current.onModuleDestroy().then(() => {
      destroyed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(destroyed).toBe(false);

    releaseGate?.();
    await destroying;
    expect(destroyed).toBe(true);
  });

  it("deduplicates exact retries and rejects update-id collisions", async () => {
    const current = service(new MemoryStudioCrdtRepository());
    const input = {
      workId: "work-1",
      updateId: "00000000-0000-4000-8000-000000000003",
      actorUserId: "editor",
      data: yUpdate("a", "1"),
    };
    await expect(current.applyUpdate(input)).resolves.toMatchObject({
      duplicate: false,
      serverSequence: "1",
    });
    await expect(current.applyUpdate(input)).resolves.toMatchObject({
      duplicate: true,
      serverSequence: "1",
    });
    await expect(
      current.applyUpdate({ ...input, data: yUpdate("b", "2") })
    ).rejects.toBeInstanceOf(StudioCrdtUpdateIdConflictError);
  });

  it("catches up from durable updates across API service instances before sync and update", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const first = service(repository);
    const second = service(repository);
    await first.applyUpdate({
      workId: "work-1",
      updateId: "00000000-0000-4000-8000-000000000004",
      actorUserId: "editor-a",
      data: yUpdate("a", "1"),
    });
    expect((await second.sync("work-1")).serverSequence).toBe("1");
    await second.applyUpdate({
      workId: "work-1",
      updateId: "00000000-0000-4000-8000-000000000005",
      actorUserId: "editor-b",
      data: yUpdate("b", "2"),
    });
    const sync = await first.sync("work-1");
    expect(sync.serverSequence).toBe("2");
    const target = new Y.Doc();
    applySync(target, sync);
    expect(Object.fromEntries(target.getMap("root"))).toEqual({ a: "1", b: "2" });
    target.destroy();
  });

  it("atomically rejects a concurrently-valid append whose durable merge violates schema", async () => {
    const repository = new MemoryStudioCrdtRepository();
    repository.beforeAppend = twoPartyBarrier();
    const first = service(repository);
    const second = service(repository);
    const left = createSceneOrderFloodDocument(130);
    const right = createSceneOrderFloodDocument(130);
    const leftUpdate = Y.encodeStateAsUpdate(left);
    const rightUpdate = Y.encodeStateAsUpdate(right);
    const merged = new Y.Doc();
    Y.applyUpdate(merged, leftUpdate);
    Y.applyUpdate(merged, rightUpdate);

    expect(hasValidStudioCrdtRootSchema(left)).toBe(true);
    expect(hasValidStudioCrdtRootSchema(right)).toBe(true);
    expect(leftUpdate.byteLength).toBeLessThanOrEqual(STUDIO_CRDT_UPDATE_MAX_BYTES);
    expect(rightUpdate.byteLength).toBeLessThanOrEqual(STUDIO_CRDT_UPDATE_MAX_BYTES);
    expect(hasValidStudioCrdtRootSchema(merged)).toBe(false);

    const results = await Promise.allSettled([
      first.applyUpdate({
        workId: "work-atomic-merge",
        updateId: "00000000-0000-4000-8000-000000000201",
        actorUserId: "editor-left",
        data: fromUint8Array(leftUpdate),
      }),
      second.applyUpdate({
        workId: "work-atomic-merge",
        updateId: "00000000-0000-4000-8000-000000000202",
        actorUserId: "editor-right",
        data: fromUint8Array(rightUpdate),
      }),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(({ status }) => status === "rejected");
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status === "rejected") {
      expect(rejected.reason).toBeInstanceOf(StudioCrdtInvalidPayloadError);
    }
    expect(repository.updates.get("work-atomic-merge")).toHaveLength(1);
    expect(repository.receipts.size).toBe(1);

    const durable = new Y.Doc();
    applySync(durable, await first.sync("work-atomic-merge"));
    expect(hasValidStudioCrdtRootSchema(durable)).toBe(true);
    expect(durable.getArray("stroke-order")).toHaveLength(130);

    left.destroy();
    right.destroy();
    merged.destroy();
    durable.destroy();
  });

  it("returns a state-vector diff and the server vector for local-op reupload", async () => {
    const current = service(new MemoryStudioCrdtRepository());
    const updateA = yUpdate("a", "1");
    await current.applyUpdate({
      workId: "work-1",
      updateId: "00000000-0000-4000-8000-000000000006",
      actorUserId: "editor",
      data: updateA,
    });
    await current.applyUpdate({
      workId: "work-1",
      updateId: "00000000-0000-4000-8000-000000000007",
      actorUserId: "editor",
      data: yUpdate("b", "2"),
    });

    const client = new Y.Doc();
    Y.applyUpdate(client, toUint8Array(updateA));
    const sync = await current.sync("work-1", fromUint8Array(Y.encodeStateVector(client)));
    applySync(client, sync);
    expect(Object.fromEntries(client.getMap("root"))).toEqual({ a: "1", b: "2" });

    client.getMap<string>("root").set("offline", "local");
    const missingOnServer = Y.encodeStateAsUpdate(client, toUint8Array(sync.serverStateVector));
    expect(missingOnServer.byteLength).toBeGreaterThan(2);
    await current.applyUpdate({
      workId: "work-1",
      updateId: "00000000-0000-4000-8000-000000000008",
      actorUserId: "editor",
      data: fromUint8Array(missingOnServer),
    });
    const reloaded = new Y.Doc();
    applySync(reloaded, await current.sync("work-1"));
    expect(reloaded.getMap("root").get("offline")).toBe("local");
    client.destroy();
    reloaded.destroy();
  });

  it("compacts by threshold and hydrates a new process from snapshot plus later updates", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const first = service(repository, { compactUpdateCount: 2 });
    await first.applyUpdate({
      workId: "work-1",
      updateId: "00000000-0000-4000-8000-000000000009",
      actorUserId: "editor",
      data: yUpdate("a", "1"),
    });
    await first.applyUpdate({
      workId: "work-1",
      updateId: "00000000-0000-4000-8000-000000000010",
      actorUserId: "editor",
      data: yUpdate("b", "2"),
    });
    expect(repository.compactCalls).toBe(1);
    expect(repository.snapshots.get("work-1")?.compactedSequence).toBe(2n);
    expect(repository.updates.get("work-1")).toEqual([]);

    await first.applyUpdate({
      workId: "work-1",
      updateId: "00000000-0000-4000-8000-000000000011",
      actorUserId: "editor",
      data: yUpdate("c", "3"),
    });
    const second = service(repository);
    const target = new Y.Doc();
    applySync(target, await second.sync("work-1"));
    expect(Object.fromEntries(target.getMap("root"))).toEqual({ a: "1", b: "2", c: "3" });
    target.destroy();
  });

  it("hands a committed frontier to the event-driven raster checkpoint coordinator", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const maybeEnqueue = vi.fn().mockResolvedValue(false);
    const coordinator = {
      maybeEnqueue,
    } as unknown as StudioCrdtRasterCheckpointCoordinator;
    const current = new StudioCrdtService(
      repository,
      allowStoredRasterAssetReferences,
      allowStoredWorkAssetReferences,
      new MemoryStudioCrdtClusterLoadRepository(),
      {},
      coordinator
    );
    services.push(current);

    await current.applyUpdate({
      workId: "work-checkpoint-trigger",
      updateId: "00000000-0000-4000-8000-000000000790",
      actorUserId: "editor",
      data: yUpdate("committed", "frontier"),
    });

    expect(maybeEnqueue).toHaveBeenCalledOnce();
    expect(maybeEnqueue).toHaveBeenCalledWith(
      "work-checkpoint-trigger",
      expect.any(Y.Doc),
      1n
    );
  });

  it("keeps exact-retry dedupe receipts after compaction deletes old update payloads", async () => {
    const repository = new MemoryStudioCrdtRepository();
    const current = service(repository, { compactUpdateCount: 2 });
    const firstInput = {
      workId: "work-1",
      updateId: "00000000-0000-4000-8000-000000000012",
      actorUserId: "editor",
      data: yUpdate("a", "1"),
    };
    await current.applyUpdate(firstInput);
    await current.applyUpdate({
      workId: "work-1",
      updateId: "00000000-0000-4000-8000-000000000013",
      actorUserId: "editor",
      data: yUpdate("b", "2"),
    });
    expect(repository.updates.get("work-1")).toEqual([]);

    await expect(current.applyUpdate(firstInput)).resolves.toMatchObject({
      duplicate: true,
      serverSequence: "1",
    });
    await expect(
      current.applyUpdate({ ...firstInput, data: yUpdate("collision", "different") })
    ).rejects.toBeInstanceOf(StudioCrdtUpdateIdConflictError);
  });

  it("evicts idle documents and destroys all cached state on shutdown", async () => {
    let now = new Date("2026-07-16T00:00:00.000Z");
    const current = service(new MemoryStudioCrdtRepository(), {
      now: () => now,
      idleEvictionMs: 1_000,
    });
    await current.sync("work-1");
    expect(current.cachedDocumentCount).toBe(1);
    now = new Date(now.getTime() + 1_001);
    expect(current.evictIdleDocuments()).toBe(1);
    expect(current.cachedDocumentCount).toBe(0);
    await current.sync("work-2");
    await current.onModuleDestroy();
    expect(current.cachedDocumentCount).toBe(0);
  });

  it("chunks sync diffs at the exact 40 KiB decoded boundary", () => {
    const source = new Uint8Array(STUDIO_CRDT_SYNC_CHUNK_MAX_BYTES * 2 + 7);
    source.fill(17);
    const chunks = chunkStudioCrdtSyncDiff(source);
    expect(chunks.map((chunk) => toUint8Array(chunk).byteLength)).toEqual([
      STUDIO_CRDT_SYNC_CHUNK_MAX_BYTES,
      STUDIO_CRDT_SYNC_CHUNK_MAX_BYTES,
      7,
    ]);
  });
});
