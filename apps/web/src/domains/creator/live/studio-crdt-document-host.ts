
import type {
  StudioCrdtLayerGroupQuery,
  StudioCrdtLayerGroupRecord,
  StudioCrdtPageRecord,
  StudioCrdtSceneElementQuery,
  StudioCrdtSceneElementRecord,
  StudioCrdtStrokeQuery,
  StudioCrdtStrokeRecord,
} from "./studio-crdt-document-types";
import type { StudioCrdtRasterDocumentSnapshot } from "@/shared/lib/studio-crdt-raster-document-contract";
import type * as Y from "yjs";

export interface StudioCrdtDocumentHost {
  doc: Y.Doc;
  strokes: Y.Map<Y.Map<unknown>>;
  sceneElementIds: Y.Map<boolean>;
  pageIds: Y.Map<boolean>;
  layerGroupIds: Y.Map<boolean>;
  order: Y.Array<Y.Map<unknown>>;
  pageOrder: Y.Array<Y.Map<unknown>>;
  deletionOps: Y.Map<string>;
  deletionAcks: Y.Map<string>;
  rasterSurfaces: Y.Map<string>;
  rasterOperations: Y.Map<string>;
  rasterUndoOperations: Y.Map<string>;
  rasterUndoAcknowledgements: Y.Map<string>;
  rasterCheckpoints: Y.Map<string>;
  brushRenderProvenance: Y.Map<string>;
  brushRenderProvenanceContentIndex: Y.Map<string>;
  shared3dStageRecords: Y.Map<boolean>;
  shared3dStageVisibilityReceipts: Y.Map<boolean>;
  deletionOpIdsByTarget: Map<string, Set<string>>;
  cleanup: Set<() => void>;
  strokeIdByType: WeakMap<object, string>;
  changedStrokeIdsByTransaction: WeakMap<Y.Transaction, Set<string>>;
  changedSceneElementIdsByTransaction: WeakMap<Y.Transaction, Set<string>>;
  changedPageIdsByTransaction: WeakMap<Y.Transaction, Set<string>>;
  changedLayerGroupIdsByTransaction: WeakMap<Y.Transaction, Set<string>>;
  changedRasterSurfaceIdsByTransaction: WeakMap<Y.Transaction, Set<string>>;
  changedRasterOperationIdsByTransaction: WeakMap<Y.Transaction, Set<string>>;
  changedRasterUndoOperationIdsByTransaction: WeakMap<Y.Transaction, Set<string>>;
  changedRasterUndoAcknowledgementIdsByTransaction: WeakMap<Y.Transaction, Set<string>>;
  changedRasterCheckpointIdsByTransaction: WeakMap<Y.Transaction, Set<string>>;
  strokeRecordCache: Map<string, StudioCrdtStrokeRecord | null>;
  sceneElementRecordCache: Map<string, StudioCrdtSceneElementRecord | null>;
  pageRecordCache: Map<string, StudioCrdtPageRecord | null>;
  layerGroupRecordCache: Map<string, StudioCrdtLayerGroupRecord | null>;
  dirtyStrokeIds: Set<string>;
  dirtySceneElementIds: Set<string>;
  dirtyPageIds: Set<string>;
  dirtyLayerGroupIds: Set<string>;
  observedSceneElementRoots: Set<string>;
  observedPageRoots: Set<string>;
  observedLayerGroupRoots: Set<string>;
  observedShared3dStageRoots: Set<string>;
  observedShared3dStageVisibilityReceiptRoots: Set<string>;
  destroyed: boolean;
  getStrokes(query?: StudioCrdtStrokeQuery): StudioCrdtStrokeRecord[];
  getSceneElements(query?: StudioCrdtSceneElementQuery): StudioCrdtSceneElementRecord[];
  getPages(includeDeleted?: boolean): StudioCrdtPageRecord[];
  getLayerGroups(query?: StudioCrdtLayerGroupQuery): StudioCrdtLayerGroupRecord[];
  tryReadExactRasterDocumentSnapshot(): StudioCrdtRasterDocumentSnapshot | null;
}

export function asStudioCrdtDocumentHost(document: object): StudioCrdtDocumentHost {
  return document as StudioCrdtDocumentHost;
}

export function assertAlive(host: StudioCrdtDocumentHost): void {
  if (host.destroyed) throw new Error("이미 닫힌 CRDT 문서입니다.");
}
