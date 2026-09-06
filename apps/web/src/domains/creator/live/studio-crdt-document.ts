import * as Y from "yjs";

import {
  STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_CONTENT_INDEX_ROOT,
  STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_ROOT,
  STUDIO_CRDT_DELETION_ACKS_ROOT,
  STUDIO_CRDT_DELETION_OPS_ROOT,
} from "./studio-crdt-document-constants";
import {
  addLayerGroup,
  addPage,
  addSceneElement,
  deleteLayerGroup,
  deletePage,
  deleteSceneElement,
  getLayerGroup,
  getLayerGroups,
  getPage,
  getPages,
  getSceneElement,
  getSceneElements,
  movePage,
  moveSceneElement,
  patchLayerGroup,
  patchPage,
  patchSceneElement,
  restoreLayerGroup,
  restorePage,
  restoreSceneElement,
  upsertLayerGroup,
  upsertPage,
  upsertSceneElement,
} from "./studio-crdt-document-graph";
import { asStudioCrdtDocumentHost } from "./studio-crdt-document-host";
import { bindStudioCrdtDocumentObservers } from "./studio-crdt-document-observe";
import {
  getBrushRenderProvenance,
  getBrushRenderProvenanceSidecars,
  getRasterCompactionCheckpoints,
  getRasterOperationLog,
  getRasterOperationLogAsync,
  getRasterOperationLogs,
  mergeRasterOperationLog,
  mergeRasterOperationLogWithBrushRenderProvenance,
  tryReadExactRasterDocumentSnapshot as readExactRasterDocumentSnapshotOnHost,
} from "./studio-crdt-document-raster";
import {
  addStroke,
  appendStrokeSamples,
  beginStroke,
  deleteStroke,
  finalizeStroke,
  getStroke,
  getStrokes,
  moveStroke,
  patchStroke,
  replaceStroke,
  restoreStroke,
  upsertStroke,
} from "./studio-crdt-document-strokes";
import {
  applySyncResponse,
  applyUpdate,
  applyUpdateBase64,
  destroy,
  encodeMissingUpdate,
  encodeMissingUpdateBase64,
  encodeStateAsUpdate,
  encodeStateVector,
  getStateVectorBase64,
  getUpdateBase64,
  subscribe,
  subscribeBatchedUpdates,
  subscribeChangesImpl,
} from "./studio-crdt-document-subscribe";
import {
  decodeStudioCrdtUpdate,
  STUDIO_CRDT_ORIGIN_REMOTE,
  STUDIO_CRDT_ORIGIN_SYNC,
  type StudioCrdtSyncResponse,
} from "./studio-crdt-protocol";
import {
  getShared3dStageFrontier,
  getShared3dStagePageState,
  preflightShared3dStagePageDiff,
  publishShared3dStagePageDiff,
  STUDIO_CRDT_SHARED_3D_STAGE_RECORDS_ROOT,
  STUDIO_CRDT_SHARED_3D_STAGE_VISIBILITY_RECEIPTS_ROOT,
  type StudioCrdtShared3dStagePageState,
  type StudioCrdtShared3dStagePublishOptions,
} from "./studio-crdt-shared-3d-stage";

import type {
  StudioCrdtBatchOptions,
  StudioCrdtBatchSubscription,
  StudioCrdtBatchedUpdate,
  StudioCrdtChangeHandler,
  StudioCrdtChangeSubscriptionOptions,
  StudioCrdtLayerGroupInput,
  StudioCrdtLayerGroupPatch,
  StudioCrdtLayerGroupQuery,
  StudioCrdtLayerGroupRecord,
  StudioCrdtLayerGroupUpsertOptions,
  StudioCrdtPageInput,
  StudioCrdtPagePatch,
  StudioCrdtPageRecord,
  StudioCrdtPageUpsertOptions,
  StudioCrdtProjectedChangeHandler,
  StudioCrdtProjectedChangeSubscriptionOptions,
  StudioCrdtSceneElementInput,
  StudioCrdtSceneElementPatch,
  StudioCrdtSceneElementQuery,
  StudioCrdtSceneElementRecord,
  StudioCrdtSceneElementUpsertOptions,
  StudioCrdtStrokeInput,
  StudioCrdtStrokePatch,
  StudioCrdtStrokeQuery,
  StudioCrdtStrokeRecord,
  StudioCrdtStrokeSamples,
  StudioCrdtUpdateHandler,
  StudioCrdtUpsertOptions,
  StudioCrdtChangeSnapshotField,
} from "./studio-crdt-document-types";
import type { StudioBrushRenderProvenanceCrdtSidecar } from "../brush/studio-brush-render-provenance";
import type { StudioShared3dStagePersistedState } from "../studio-shared-3d-stage-collection";
import type { StudioRasterCompactionCheckpoint } from "@/shared/lib/studio-crdt-raster-compaction";
import type { StudioRasterOperationLog } from "@/shared/lib/studio-crdt-raster-ops";

import {
  STUDIO_CRDT_RASTER_CHECKPOINTS_ROOT,
  STUDIO_CRDT_RASTER_OPERATIONS_ROOT,
  STUDIO_CRDT_RASTER_SURFACES_ROOT,
  STUDIO_CRDT_RASTER_UNDO_ACKS_ROOT,
  STUDIO_CRDT_RASTER_UNDO_OPERATIONS_ROOT,
} from "@/shared/lib/studio-crdt-raster-document-contract";


export {
  STUDIO_CRDT_ORIGIN_LOCAL,
  STUDIO_CRDT_ORIGIN_REMOTE,
  STUDIO_CRDT_ORIGIN_SYNC,
  STUDIO_CRDT_LEGACY_STROKE_PAYLOAD_VERSION,
  STUDIO_CRDT_MATERIAL_STROKE_PAYLOAD_VERSION,
  STUDIO_CRDT_PAINT_STROKE_PAYLOAD_VERSION,
  STUDIO_CRDT_STROKE_PAYLOAD_VERSION,
  type StudioCrdtStrokePayloadVersion,
} from "./studio-crdt-protocol";
export {
  STUDIO_CRDT_LAYER_GROUP_MAX_BYTES,
  STUDIO_CRDT_LAYER_GROUP_PAYLOAD_VERSION,
  STUDIO_CRDT_PAGE_MAX_BYTES,
  STUDIO_CRDT_PAGE_PAYLOAD_VERSION,
  STUDIO_CRDT_PAYLOAD_SCENE_ELEMENT_TYPES,
  STUDIO_CRDT_SCENE_ELEMENT_MAX_BYTES,
  STUDIO_CRDT_SCENE_ELEMENT_PAYLOAD_VERSION,
  STUDIO_CRDT_SCENE_ELEMENT_TYPES,
  isStudioCrdtPayloadSceneElementType,
  validateStudioCrdtPagePayload,
  validateStudioCrdtLayerGroupPayload,
  validateStudioCrdtSceneElementPayload,
  type StudioCrdtJsonObject,
  type StudioCrdtJsonValue,
  type StudioCrdtLayerGroupPayload,
  type StudioCrdtPagePayload,
  type StudioCrdtPayloadSceneElementType,
  type StudioCrdtSceneElementPayload,
  type StudioCrdtSceneElementType,
} from "./studio-crdt-scene-schema";
export {
  STUDIO_CRDT_STROKE_MAX_SAMPLES,
  STUDIO_CRDT_APPEND_MAX_SAMPLES,
  STUDIO_CRDT_REPLACE_CHUNK_SAMPLES,
  STUDIO_CRDT_METADATA_MAX_BYTES,
  STUDIO_CRDT_DELETION_OPS_ROOT,
  STUDIO_CRDT_DELETION_ACKS_ROOT,
  STUDIO_CRDT_DELETION_OPERATION_MAX_ENTRIES,
  STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_ROOT,
  STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_CONTENT_INDEX_ROOT,
  STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_MAX_ENTRIES,
  STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_MAX_BYTES,
} from "./studio-crdt-document-constants";
export {
  STUDIO_CRDT_RASTER_CHECKPOINTS_ROOT,
  STUDIO_CRDT_RASTER_MAX_CHECKPOINTS,
  STUDIO_CRDT_RASTER_MAX_REFERENCED_BYTES,
  STUDIO_CRDT_RASTER_MAX_SURFACES,
  STUDIO_CRDT_RASTER_OPERATIONS_ROOT,
  STUDIO_CRDT_RASTER_SURFACES_ROOT,
  STUDIO_CRDT_RASTER_UNDO_ACKS_ROOT,
  STUDIO_CRDT_RASTER_UNDO_OPERATIONS_ROOT,
} from "@/shared/lib/studio-crdt-raster-document-contract";
export {
  SAMPLE_ARRAY_KEYS,
  OPTIONAL_STRING_PAYLOAD_KEYS,
  STROKE_PAYLOAD_KEYS,
  STUDIO_CRDT_CHANGE_SNAPSHOT_FIELDS,
  type StudioCrdtSampleArrayKey,
  type StudioCrdtStringPayloadKey,
  type StudioCrdtStrokePayloadKey,
  type StudioCrdtStrokeSamples,
  type StudioCrdtDrawStrokePayload,
  type StudioCrdtStrokeInput,
  type StudioCrdtStrokeRecord,
  type StudioCrdtSceneElementInput,
  type StudioCrdtSceneElementRecord,
  type StudioCrdtSceneElementQuery,
  type StudioCrdtSceneElementPatch,
  type StudioCrdtSceneElementUpsertOptions,
  type StudioCrdtPageInput,
  type StudioCrdtPageRecord,
  type StudioCrdtPagePatch,
  type StudioCrdtPageUpsertOptions,
  type StudioCrdtLayerGroupInput,
  type StudioCrdtLayerGroupRecord,
  type StudioCrdtLayerGroupQuery,
  type StudioCrdtLayerGroupPatch,
  type StudioCrdtLayerGroupUpsertOptions,
  type StudioCrdtStrokeQuery,
  type StudioCrdtUpsertOptions,
  type StudioCrdtStrokePatch,
  type StudioCrdtChangeSummary,
  type StudioCrdtChangeSnapshot,
  type StudioCrdtChangeSnapshotField,
  type StudioCrdtChange,
  type StudioCrdtProjectedChange,
  type StudioCrdtChangeSubscriptionOptions,
  type StudioCrdtProjectedChangeSubscriptionOptions,
  type StudioCrdtUpdateHandler,
  type StudioCrdtChangeHandler,
  type StudioCrdtProjectedChangeHandler,
  type StudioCrdtBatchedUpdate,
  type StudioCrdtBatchOptions,
  type StudioCrdtBatchSubscription,
} from "./studio-crdt-document-types";
export { mergeStudioCrdtUpdates } from "./studio-crdt-document-helpers";
export {
  parseStudioCrdtShared3dStageCompositeKey,
  preflightShared3dStagePageDiff,
  studioCrdtShared3dStageCompositeKey,
  studioCrdtShared3dStageRecordRootName,
  studioCrdtShared3dStageVisibilityReceiptRootName,
  STUDIO_CRDT_SHARED_3D_STAGE_MAX_GENERATION_EVENTS_PER_RECORD,
  STUDIO_CRDT_SHARED_3D_STAGE_PAYLOAD_VERSION,
  STUDIO_CRDT_SHARED_3D_STAGE_RECORD_ROOT_PREFIX,
  STUDIO_CRDT_SHARED_3D_STAGE_RECORDS_ROOT,
  STUDIO_CRDT_SHARED_3D_STAGE_VISIBILITY_RECEIPT_ROOT_PREFIX,
  STUDIO_CRDT_SHARED_3D_STAGE_VISIBILITY_RECEIPTS_ROOT,
  type StudioCrdtShared3dStagePageState,
  type StudioCrdtShared3dStagePublishOptions,
} from "./studio-crdt-shared-3d-stage";

/**
 * Y.Map records hold stroke metadata while nested Y.Arrays append pointer samples incrementally.
 * A single root Y.Array provides deterministic cross-client compositing order, including erasers.
 */
export class StudioCrdtDocument {
  private readonly doc: Y.Doc;
  private readonly strokes: Y.Map<Y.Map<unknown>>;
  private readonly sceneElementIds: Y.Map<boolean>;
  private readonly pageIds: Y.Map<boolean>;
  private readonly layerGroupIds: Y.Map<boolean>;
  private readonly order: Y.Array<Y.Map<unknown>>;
  private readonly pageOrder: Y.Array<Y.Map<unknown>>;
  private readonly deletionOps: Y.Map<string>;
  private readonly deletionAcks: Y.Map<string>;
  private readonly rasterSurfaces: Y.Map<string>;
  private readonly rasterOperations: Y.Map<string>;
  private readonly rasterUndoOperations: Y.Map<string>;
  private readonly rasterUndoAcknowledgements: Y.Map<string>;
  private readonly rasterCheckpoints: Y.Map<string>;
  private readonly brushRenderProvenance: Y.Map<string>;
  private readonly brushRenderProvenanceContentIndex: Y.Map<string>;
  private readonly shared3dStageRecords: Y.Map<boolean>;
  private readonly shared3dStageVisibilityReceipts: Y.Map<boolean>;
  private readonly deletionOpIdsByTarget = new Map<string, Set<string>>();
  private readonly cleanup = new Set<() => void>();
  private readonly strokeIdByType = new WeakMap<object, string>();
  private readonly changedStrokeIdsByTransaction = new WeakMap<Y.Transaction, Set<string>>();
  private readonly changedSceneElementIdsByTransaction = new WeakMap<Y.Transaction, Set<string>>();
  private readonly changedPageIdsByTransaction = new WeakMap<Y.Transaction, Set<string>>();
  private readonly changedLayerGroupIdsByTransaction = new WeakMap<Y.Transaction, Set<string>>();
  private readonly changedRasterSurfaceIdsByTransaction = new WeakMap<Y.Transaction, Set<string>>();
  private readonly changedRasterOperationIdsByTransaction = new WeakMap<Y.Transaction, Set<string>>();
  private readonly changedRasterUndoOperationIdsByTransaction = new WeakMap<Y.Transaction, Set<string>>();
  private readonly changedRasterUndoAcknowledgementIdsByTransaction = new WeakMap<Y.Transaction, Set<string>>();
  private readonly changedRasterCheckpointIdsByTransaction = new WeakMap<Y.Transaction, Set<string>>();
  // subscribeChanges/get*() 호출마다 전체 문서를 다시 스캔하지 않도록, id별로 디코딩된 레코드를
  // 캐시한다. orderIndex는 캐시에 포함하지 않는다(순서는 다른 항목의 삽입/삭제로도 바뀌므로 get*()
  // 호출마다 order 배열에서 새로 계산한다). 갱신은 지연(lazy) 방식이다 — afterTransaction 리스너
  // (reconcileRecordCaches, 생성자 맨 끝에서 등록)는 changed*IdsByTransaction 을 dirty*Ids 집합에
  // 옮겨 담기만 할 뿐 그 자리에서 재디코딩하지 않는다(트랜잭션당 Set.add 몇 번뿐이라 사실상 공짜).
  // 실제 디코딩(readPayload 의 Y.Array.toArray() + deepFreeze)은 get*() 호출 시작에서 drainDirty*Ids
  // 가 수행한다 — 한 획을 라이브로 그리는 동안 appendStrokeSamples 가 로컬 트랜잭션을 수십~수백 번
  // 만들어도(포인터 이동마다 1개), 그 사이 아무도 get*() 를 호출하지 않으면 재디코딩은 0번, 마지막에
  // 실제로 읽힐 때 딱 1번만 일어난다 — eager 버전은 트랜잭션마다 매번 전체 샘플 배열을 다시 디코딩·
  // 동결해 라이브 드로잉 경로에 없던 비용을 새로 만들어냈다(리뷰에서 확인된 실측 회귀).
  private readonly strokeRecordCache = new Map<string, StudioCrdtStrokeRecord | null>();
  private readonly sceneElementRecordCache = new Map<string, StudioCrdtSceneElementRecord | null>();
  private readonly pageRecordCache = new Map<string, StudioCrdtPageRecord | null>();
  private readonly layerGroupRecordCache = new Map<string, StudioCrdtLayerGroupRecord | null>();
  private readonly dirtyStrokeIds = new Set<string>();
  private readonly dirtySceneElementIds = new Set<string>();
  private readonly dirtyPageIds = new Set<string>();
  private readonly dirtyLayerGroupIds = new Set<string>();
  private readonly observedSceneElementRoots = new Set<string>();
  private readonly observedPageRoots = new Set<string>();
  private readonly observedLayerGroupRoots = new Set<string>();
  private readonly observedShared3dStageRoots = new Set<string>();
  private readonly observedShared3dStageVisibilityReceiptRoots = new Set<string>();
  private destroyed = false;

  constructor(initialUpdate?: Uint8Array | string) {
    this.doc = new Y.Doc();
    this.strokes = this.doc.getMap<Y.Map<unknown>>("strokes");
    this.sceneElementIds = this.doc.getMap<boolean>("scene-elements");
    this.pageIds = this.doc.getMap<boolean>("studio-pages");
    this.layerGroupIds = this.doc.getMap<boolean>("layer-groups");
    this.order = this.doc.getArray<Y.Map<unknown>>("stroke-order");
    this.pageOrder = this.doc.getArray<Y.Map<unknown>>("page-order");
    this.deletionOps = this.doc.getMap<string>(STUDIO_CRDT_DELETION_OPS_ROOT);
    this.deletionAcks = this.doc.getMap<string>(STUDIO_CRDT_DELETION_ACKS_ROOT);
    this.rasterSurfaces = this.doc.getMap<string>(STUDIO_CRDT_RASTER_SURFACES_ROOT);
    this.rasterOperations = this.doc.getMap<string>(STUDIO_CRDT_RASTER_OPERATIONS_ROOT);
    this.rasterUndoOperations = this.doc.getMap<string>(STUDIO_CRDT_RASTER_UNDO_OPERATIONS_ROOT);
    this.rasterUndoAcknowledgements = this.doc.getMap<string>(STUDIO_CRDT_RASTER_UNDO_ACKS_ROOT);
    this.rasterCheckpoints = this.doc.getMap<string>(STUDIO_CRDT_RASTER_CHECKPOINTS_ROOT);
    this.brushRenderProvenance = this.doc.getMap<string>(
      STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_ROOT
    );
    this.brushRenderProvenanceContentIndex = this.doc.getMap<string>(
      STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_CONTENT_INDEX_ROOT
    );
    this.shared3dStageRecords = this.doc.getMap<boolean>(
      STUDIO_CRDT_SHARED_3D_STAGE_RECORDS_ROOT
    );
    this.shared3dStageVisibilityReceipts = this.doc.getMap<boolean>(
      STUDIO_CRDT_SHARED_3D_STAGE_VISIBILITY_RECEIPTS_ROOT
    );
    if (initialUpdate !== undefined) {
      const decoded =
        typeof initialUpdate === "string" ? decodeStudioCrdtUpdate(initialUpdate) : initialUpdate;
      Y.applyUpdate(this.doc, decoded, STUDIO_CRDT_ORIGIN_SYNC);
    }
    bindStudioCrdtDocumentObservers(asStudioCrdtDocumentHost(this));
  }

  subscribe(handler: StudioCrdtUpdateHandler): () => void {
    return subscribe(asStudioCrdtDocumentHost(this), handler);
  }

  subscribeChanges<const Fields extends readonly StudioCrdtChangeSnapshotField[]>(
    handler: StudioCrdtProjectedChangeHandler<Fields>,
    options: StudioCrdtProjectedChangeSubscriptionOptions<Fields>
  ): () => void;
  subscribeChanges(
    handler: StudioCrdtChangeHandler,
    options?: StudioCrdtChangeSubscriptionOptions
  ): () => void;
  subscribeChanges<const Fields extends readonly StudioCrdtChangeSnapshotField[]>(
    handler: StudioCrdtChangeHandler | StudioCrdtProjectedChangeHandler<Fields>,
    options:
      | StudioCrdtChangeSubscriptionOptions
      | StudioCrdtProjectedChangeSubscriptionOptions<Fields> = {}
  ): () => void {
    return subscribeChangesImpl(asStudioCrdtDocumentHost(this), handler, options);
  }

  subscribeBatchedUpdates(
    handler: (batch: StudioCrdtBatchedUpdate) => void,
    options: StudioCrdtBatchOptions = {}
  ): StudioCrdtBatchSubscription {
    return subscribeBatchedUpdates(asStudioCrdtDocumentHost(this), handler, options);
  }

  beginStroke(input: StudioCrdtStrokeInput, beforeStrokeId: string | null = null): StudioCrdtStrokeRecord {
    return beginStroke(asStudioCrdtDocumentHost(this), input, beforeStrokeId);
  }

  appendStrokeSamples(id: string, samples: StudioCrdtStrokeSamples): number {
    return appendStrokeSamples(asStudioCrdtDocumentHost(this), id, samples);
  }

  finalizeStroke(id: string, finalSamples?: StudioCrdtStrokeSamples): StudioCrdtStrokeRecord {
    return finalizeStroke(asStudioCrdtDocumentHost(this), id, finalSamples);
  }

  addStroke(input: StudioCrdtStrokeInput): StudioCrdtStrokeRecord {
    return addStroke(asStudioCrdtDocumentHost(this), input);
  }

  upsertStroke(
    input: StudioCrdtStrokeInput,
    options: StudioCrdtUpsertOptions = {}
  ): StudioCrdtStrokeRecord {
    return upsertStroke(asStudioCrdtDocumentHost(this), input, options);
  }

  /**
   * Replaces a completed stroke without creating an oversized single Yjs update. Metadata and
   * array reset are one transaction, sample inserts are bounded transactions, and finalization is
   * last. Remote peers can therefore render the replacement progressively while every wire update
   * stays below the durable channel's incremental cap after batching.
   */
  replaceStroke(input: StudioCrdtStrokeInput): StudioCrdtStrokeRecord {
    return replaceStroke(asStudioCrdtDocumentHost(this), input);
  }

  /**
   * Applies only fields that changed in the caller's local before/after snapshot. Independent
   * metadata edits therefore remain independent Y.Map operations instead of a replace-all write.
   * Pointer arrays are one aligned atomic group and retain the existing bounded chunk transport.
   */
  patchStroke(id: string, patch: StudioCrdtStrokePatch): StudioCrdtStrokeRecord {
    return patchStroke(asStudioCrdtDocumentHost(this), id, patch);
  }

  deleteStroke(id: string): boolean {
    return deleteStroke(asStudioCrdtDocumentHost(this), id);
  }

  restoreStroke(id: string): boolean {
    return restoreStroke(asStudioCrdtDocumentHost(this), id);
  }

  moveStroke(id: string, beforeStrokeId: string | null): StudioCrdtStrokeRecord {
    return moveStroke(asStudioCrdtDocumentHost(this), id, beforeStrokeId);
  }

  getStroke(id: string, includeDeleted = false): StudioCrdtStrokeRecord | null {
    return getStroke(asStudioCrdtDocumentHost(this), id, includeDeleted);
  }

  getStrokes(query: StudioCrdtStrokeQuery = {}): StudioCrdtStrokeRecord[] {
    return getStrokes(asStudioCrdtDocumentHost(this), query);
  }

  addSceneElement(
    input: StudioCrdtSceneElementInput,
    beforeElementId: string | null = null
  ): StudioCrdtSceneElementRecord {
    return addSceneElement(asStudioCrdtDocumentHost(this), input, beforeElementId);
  }

  upsertSceneElement(
    input: StudioCrdtSceneElementInput,
    options: StudioCrdtSceneElementUpsertOptions = {}
  ): StudioCrdtSceneElementRecord {
    return upsertSceneElement(asStudioCrdtDocumentHost(this), input, options);
  }

  patchSceneElement(id: string, patch: StudioCrdtSceneElementPatch): StudioCrdtSceneElementRecord {
    return patchSceneElement(asStudioCrdtDocumentHost(this), id, patch);
  }

  deleteSceneElement(id: string): boolean {
    return deleteSceneElement(asStudioCrdtDocumentHost(this), id);
  }

  restoreSceneElement(id: string): boolean {
    return restoreSceneElement(asStudioCrdtDocumentHost(this), id);
  }

  moveSceneElement(id: string, beforeElementId: string | null): StudioCrdtSceneElementRecord {
    return moveSceneElement(asStudioCrdtDocumentHost(this), id, beforeElementId);
  }

  moveElement(
    id: string,
    beforeElementId: string | null
  ): StudioCrdtStrokeRecord | StudioCrdtSceneElementRecord {
    const host = asStudioCrdtDocumentHost(this);
    const hasSceneElement = host.sceneElementIds.get(id) === true;
    const hasStroke = host.strokes.has(id);
    if (hasSceneElement && hasStroke) throw new Error("중복된 CRDT 요소 식별자는 이동할 수 없습니다.");
    if (hasSceneElement) return moveSceneElement(host, id, beforeElementId);
    if (hasStroke) return moveStroke(host, id, beforeElementId);
    throw new Error("이동할 CRDT 요소를 찾을 수 없습니다.");
  }

  getSceneElement(id: string, includeDeleted = false): StudioCrdtSceneElementRecord | null {
    return getSceneElement(asStudioCrdtDocumentHost(this), id, includeDeleted);
  }

  getSceneElements(query: StudioCrdtSceneElementQuery = {}): StudioCrdtSceneElementRecord[] {
    return getSceneElements(asStudioCrdtDocumentHost(this), query);
  }

  addPage(input: StudioCrdtPageInput, beforePageId: string | null = null): StudioCrdtPageRecord {
    return addPage(asStudioCrdtDocumentHost(this), input, beforePageId);
  }

  upsertPage(
    input: StudioCrdtPageInput,
    options: StudioCrdtPageUpsertOptions = {}
  ): StudioCrdtPageRecord {
    return upsertPage(asStudioCrdtDocumentHost(this), input, options);
  }

  patchPage(id: string, patch: StudioCrdtPagePatch): StudioCrdtPageRecord {
    return patchPage(asStudioCrdtDocumentHost(this), id, patch);
  }

  deletePage(id: string): boolean {
    return deletePage(asStudioCrdtDocumentHost(this), id);
  }

  restorePage(id: string): boolean {
    return restorePage(asStudioCrdtDocumentHost(this), id);
  }

  movePage(id: string, beforePageId: string | null): StudioCrdtPageRecord {
    return movePage(asStudioCrdtDocumentHost(this), id, beforePageId);
  }

  getPage(id: string, includeDeleted = false): StudioCrdtPageRecord | null {
    return getPage(asStudioCrdtDocumentHost(this), id, includeDeleted);
  }

  getPages(includeDeleted = false): StudioCrdtPageRecord[] {
    return getPages(asStudioCrdtDocumentHost(this), includeDeleted);
  }

  publishShared3dStagePageDiff(
    pageId: string,
    previous: StudioShared3dStagePersistedState | undefined,
    next: StudioShared3dStagePersistedState | undefined,
    options: StudioCrdtShared3dStagePublishOptions = {}
  ): StudioCrdtShared3dStagePageState {
    return publishShared3dStagePageDiff(
      asStudioCrdtDocumentHost(this),
      pageId,
      previous,
      next,
      options
    );
  }

  preflightShared3dStagePageDiff(
    pageId: string,
    previous: StudioShared3dStagePersistedState | undefined,
    next: StudioShared3dStagePersistedState | undefined,
    options: StudioCrdtShared3dStagePublishOptions = {}
  ): void {
    preflightShared3dStagePageDiff(
      asStudioCrdtDocumentHost(this),
      pageId,
      previous,
      next,
      options
    );
  }

  getShared3dStagePageState(pageId: string): StudioCrdtShared3dStagePageState {
    return getShared3dStagePageState(asStudioCrdtDocumentHost(this), pageId);
  }

  getShared3dStageFrontier(): readonly StudioCrdtShared3dStagePageState[] {
    return getShared3dStageFrontier(asStudioCrdtDocumentHost(this));
  }

  addLayerGroup(input: StudioCrdtLayerGroupInput): StudioCrdtLayerGroupRecord {
    return addLayerGroup(asStudioCrdtDocumentHost(this), input);
  }

  upsertLayerGroup(
    input: StudioCrdtLayerGroupInput,
    options: StudioCrdtLayerGroupUpsertOptions = {}
  ): StudioCrdtLayerGroupRecord {
    return upsertLayerGroup(asStudioCrdtDocumentHost(this), input, options);
  }

  patchLayerGroup(
    pageId: string,
    id: string,
    patch: StudioCrdtLayerGroupPatch
  ): StudioCrdtLayerGroupRecord {
    return patchLayerGroup(asStudioCrdtDocumentHost(this), pageId, id, patch);
  }

  deleteLayerGroup(pageId: string, id: string): boolean {
    return deleteLayerGroup(asStudioCrdtDocumentHost(this), pageId, id);
  }

  restoreLayerGroup(pageId: string, id: string): boolean {
    return restoreLayerGroup(asStudioCrdtDocumentHost(this), pageId, id);
  }

  getLayerGroup(
    pageId: string,
    id: string,
    includeDeleted = false
  ): StudioCrdtLayerGroupRecord | null {
    return getLayerGroup(asStudioCrdtDocumentHost(this), pageId, id, includeDeleted);
  }

  getLayerGroups(query: StudioCrdtLayerGroupQuery = {}): StudioCrdtLayerGroupRecord[] {
    return getLayerGroups(asStudioCrdtDocumentHost(this), query);
  }

  /**
   * Adds the immutable set-union of one validated raster replica. Existing entries are never
   * overwritten or deleted. Every conflict is preflighted before the Yjs transaction because Yjs
   * transactions are atomic for observers but do not roll back JavaScript exceptions.
   */
  mergeRasterOperationLog(value: StudioRasterOperationLog): StudioRasterOperationLog {
    return mergeRasterOperationLog(asStudioCrdtDocumentHost(this), value);
  }

  /**
   * Atomically publishes raster operations and their matching canonical render provenance.
   * Every sidecar must name an operation present in `value`; partial or unrelated attachment is
   * rejected before the Yjs transaction begins.
   */
  mergeRasterOperationLogWithBrushRenderProvenance(
    value: StudioRasterOperationLog,
    sidecars: readonly unknown[]
  ): StudioRasterOperationLog {
    return mergeRasterOperationLogWithBrushRenderProvenance(asStudioCrdtDocumentHost(this), value, sidecars);
  }

  /**
   * Strict full-registry read. Any malformed, non-canonical, orphaned, over-budget, deleted, or
   * concurrently conflicted entry rejects the entire snapshot instead of returning partial truth.
   */
  getBrushRenderProvenanceSidecars():
    readonly Readonly<StudioBrushRenderProvenanceCrdtSidecar>[] {
    return getBrushRenderProvenanceSidecars(asStudioCrdtDocumentHost(this));
  }

  getBrushRenderProvenance(
    operationId: string
  ): Readonly<StudioBrushRenderProvenanceCrdtSidecar> | null {
    return getBrushRenderProvenance(asStudioCrdtDocumentHost(this), operationId);
  }

  getRasterOperationLog(surfaceId: string): StudioRasterOperationLog | null {
    return getRasterOperationLog(asStudioCrdtDocumentHost(this), surfaceId);
  }

  /**
   * getRasterOperationLog 와 동일하지만 파싱·검증(JSON.parse + canonical 재직렬화 비교, exact-schema
   * 검증)을 Worker에서 실행한다 — 화면에 보이는 surface 하나만 필요한 렌더 경로(예:
   * StudioRasterCrdtSurface)가 원격 협업자 트랜잭션마다 메인 스레드를 막지 않도록. Y.Doc에서 각
   * 래스터 root의 원시 항목만 동기로 뽑아내고(가벼움 — JSON 파싱 없음), 무거운 파싱은 Worker(또는
   * 폴백 시 동일 로직의 동기 실행)로 넘긴다. mergeRasterOperationLog 의 로컬 쓰기 프리플라이트처럼
   * Yjs 트랜잭션 준비 도중 동기 결과가 필요한 호출부는 계속 getRasterOperationLog 를 써야 한다.
   */
  async getRasterOperationLogAsync(
    surfaceId: string,
    options: { signal?: AbortSignal } = {}
  ): Promise<StudioRasterOperationLog | null> {
    return await getRasterOperationLogAsync(asStudioCrdtDocumentHost(this), surfaceId, options);
  }

  getRasterOperationLogs(): StudioRasterOperationLog[] {
    return getRasterOperationLogs(asStudioCrdtDocumentHost(this));
  }

  getRasterCompactionCheckpoints(surfaceId?: string): StudioRasterCompactionCheckpoint[] {
    return getRasterCompactionCheckpoints(asStudioCrdtDocumentHost(this), surfaceId);
  }

  applyUpdate(update: Uint8Array, origin: unknown = STUDIO_CRDT_ORIGIN_REMOTE): void {
    return applyUpdate(asStudioCrdtDocumentHost(this), update, origin);
  }

  applyUpdateBase64(update: string, origin: unknown = STUDIO_CRDT_ORIGIN_REMOTE): void {
    return applyUpdateBase64(asStudioCrdtDocumentHost(this), update, origin);
  }

  applySyncResponse(response: StudioCrdtSyncResponse): void {
    return applySyncResponse(asStudioCrdtDocumentHost(this), response);
  }

  encodeStateVector(): Uint8Array {
    return encodeStateVector(asStudioCrdtDocumentHost(this));
  }

  getStateVectorBase64(): string {
    return getStateVectorBase64(asStudioCrdtDocumentHost(this));
  }

  encodeStateAsUpdate(remoteStateVector?: Uint8Array): Uint8Array {
    return encodeStateAsUpdate(asStudioCrdtDocumentHost(this), remoteStateVector);
  }

  encodeMissingUpdate(serverStateVectorBase64: string): Uint8Array {
    return encodeMissingUpdate(asStudioCrdtDocumentHost(this), serverStateVectorBase64);
  }

  encodeMissingUpdateBase64(serverStateVectorBase64: string): string {
    return encodeMissingUpdateBase64(asStudioCrdtDocumentHost(this), serverStateVectorBase64);
  }

  getUpdateBase64(update: Uint8Array): string {
    return getUpdateBase64(asStudioCrdtDocumentHost(this), update);
  }

  destroy(): void {
    return destroy(asStudioCrdtDocumentHost(this));
  }

  private tryReadExactRasterDocumentSnapshot() {
    return readExactRasterDocumentSnapshotOnHost(asStudioCrdtDocumentHost(this));
  }
}
