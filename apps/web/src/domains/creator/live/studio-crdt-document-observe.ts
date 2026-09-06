import * as Y from "yjs";

import {
  MAX_ID_LENGTH,
  MAX_LAYER_GROUP_KEY_LENGTH,
  RASTER_SAFE_ID_PATTERN,
  RASTER_UUID_PATTERN,
} from "./studio-crdt-document-constants";
import {
  exactText,
  orderEntryValue,
  pageOrderEntryId,
  rasterCheckpointSurfaceId,
  rasterEnvelopeSurfaceId,
  sceneOrderEntryId,
} from "./studio-crdt-document-helpers";
import {
  observeLayerGroupRoot,
  observePageRoot,
  observeSceneElementRoot,
  refreshLayerGroupRecordCache,
  refreshPageRecordCache,
  refreshSceneElementRecordCache,
  refreshStrokeRecordCache,
  registerOrderEntry,
  registerRecord,
} from "./studio-crdt-document-records";
import {
  changedIdsFor,
  changedLayerGroupIdsFor,
  changedPageIdsFor,
  changedRasterCheckpointIdsFor,
  changedRasterOperationIdsFor,
  changedRasterSurfaceIdsFor,
  changedRasterUndoAcknowledgementIdsFor,
  changedRasterUndoOperationIdsFor,
  changedSceneElementIdsFor,
  indexDeletionOperation,
  markDeletionTargetChanged,
  unindexDeletionOperation,
} from "./studio-crdt-document-tracking";
import {
  bindStudioCrdtShared3dStageObservers,
  getShared3dStageFrontier,
} from "./studio-crdt-shared-3d-stage";

import type { StudioCrdtDocumentHost } from "./studio-crdt-document-host";

export function bindStudioCrdtDocumentObservers(host: StudioCrdtDocumentHost): void {
    bindStudioCrdtShared3dStageObservers(host);
    for (const [id, value] of host.strokes) registerRecord(host, id, value);
    for (const value of host.order) registerOrderEntry(host, value);
    for (const [id, active] of host.sceneElementIds) {
      if (active === true) observeSceneElementRoot(host, id);
    }
    for (const [id, active] of host.pageIds) {
      if (active === true) observePageRoot(host, id);
    }
    for (const [compositeKey, active] of host.layerGroupIds) {
      if (active === true) observeLayerGroupRoot(host, compositeKey);
    }
    for (const [operationId, target] of host.deletionOps) {
      indexDeletionOperation(host, operationId, target);
    }
    for (const [id] of host.strokes) refreshStrokeRecordCache(host, id);
    for (const [id, active] of host.sceneElementIds) {
      if (active === true) refreshSceneElementRecordCache(host, id);
    }
    const activePageIds = [...host.pageIds]
      .filter(([, active]) => active === true)
      .map(([id]) => id);
    // Empty/page-less malformed sidecars remain lazily rejected by their explicit reader, matching
    // the former constructor behavior. Once a page cache actually exists, one frontier serves all
    // page decorations instead of reparsing every Stage once per page.
    const shared3dStageStateByPageId = activePageIds.length === 0
      ? new Map()
      : new Map(
          getShared3dStageFrontier(host).map((state) => [state.pageId, state] as const),
        );
    for (const id of activePageIds) {
        refreshPageRecordCache(host, id, shared3dStageStateByPageId.get(id) ?? {
          pageId: id,
          managed: false,
          value: undefined,
        });
    }
    for (const [compositeKey, active] of host.layerGroupIds) {
      if (active === true) refreshLayerGroupRecordCache(host, compositeKey);
    }

    const observeStrokes: Parameters<typeof host.strokes.observeDeep>[0] = (events, transaction) => {
      const changedIds = changedIdsFor(host, transaction);
      for (const event of events) {
        const knownId = host.strokeIdByType.get(event.target);
        if (knownId) changedIds.add(knownId);
        if (event.target !== host.strokes || !(event instanceof Y.YMapEvent)) continue;
        for (const key of event.keysChanged) {
          if (typeof key !== "string" || !exactText(key, MAX_ID_LENGTH)) continue;
          changedIds.add(key);
          registerRecord(host, key, host.strokes.get(key));
        }
      }
    };
    const observeOrder: Parameters<typeof host.order.observeDeep>[0] = (events, transaction) => {
      const changedStrokeIds = changedIdsFor(host, transaction);
      const changedSceneElementIds = changedSceneElementIdsFor(host, transaction);
      for (const event of events) {
        const knownId = host.strokeIdByType.get(event.target);
        if (knownId) changedStrokeIds.add(knownId);
        if (event.target instanceof Y.Map) {
          const strokeId = orderEntryValue(event.target, "strokeId");
          const elementId = sceneOrderEntryId(event.target);
          if (strokeId) {
            changedStrokeIds.add(strokeId);
            registerOrderEntry(host, event.target);
          }
          if (elementId) changedSceneElementIds.add(elementId);
        }
        if (event.target !== host.order || !(event instanceof Y.YArrayEvent)) continue;
        let deletedUnknownEntry = false;
        for (const delta of event.changes.delta) {
          if (delta.delete) deletedUnknownEntry = true;
          if (!Array.isArray(delta.insert)) continue;
          for (const value of delta.insert) {
            const strokeId = orderEntryValue(value, "strokeId");
            const elementId = sceneOrderEntryId(value);
            if (strokeId) changedStrokeIds.add(strokeId);
            if (elementId) changedSceneElementIds.add(elementId);
            registerOrderEntry(host, value);
          }
        }
        if (deletedUnknownEntry) {
          // Production operations tombstone entries instead of deleting them. For an untrusted
          // structural delete, all surviving indices may have shifted, so widening is safest.
          for (const value of host.order) {
            const strokeId = orderEntryValue(value, "strokeId");
            const elementId = sceneOrderEntryId(value);
            if (strokeId) changedStrokeIds.add(strokeId);
            if (elementId) changedSceneElementIds.add(elementId);
          }
        }
      }
    };
    const observeSceneElementIds = (event: Y.YMapEvent<boolean>, transaction: Y.Transaction) => {
      const changedIds = changedSceneElementIdsFor(host, transaction);
      for (const id of event.keysChanged) {
        if (!exactText(id, MAX_ID_LENGTH)) continue;
        changedIds.add(id);
        if (host.sceneElementIds.get(id) === true) observeSceneElementRoot(host, id);
      }
    };
    const observePageIds = (event: Y.YMapEvent<boolean>, transaction: Y.Transaction) => {
      const changedIds = changedPageIdsFor(host, transaction);
      for (const id of event.keysChanged) {
        if (!exactText(id, MAX_ID_LENGTH)) continue;
        changedIds.add(id);
        if (host.pageIds.get(id) === true) observePageRoot(host, id);
      }
    };
    const observeLayerGroupIds = (event: Y.YMapEvent<boolean>, transaction: Y.Transaction) => {
      const changedIds = changedLayerGroupIdsFor(host, transaction);
      for (const compositeKey of event.keysChanged) {
        if (!exactText(compositeKey, MAX_LAYER_GROUP_KEY_LENGTH)) continue;
        changedIds.add(compositeKey);
        if (host.layerGroupIds.get(compositeKey) === true) {
          observeLayerGroupRoot(host, compositeKey);
        }
      }
    };
    const observePageOrder: Parameters<typeof host.pageOrder.observeDeep>[0] = (events, transaction) => {
      const changedIds = changedPageIdsFor(host, transaction);
      for (const event of events) {
        if (event.target instanceof Y.Map) {
          const id = pageOrderEntryId(event.target);
          if (id) changedIds.add(id);
        }
        if (event.target !== host.pageOrder || !(event instanceof Y.YArrayEvent)) continue;
        let deletedUnknownEntry = false;
        for (const delta of event.changes.delta) {
          if (delta.delete) deletedUnknownEntry = true;
          if (!Array.isArray(delta.insert)) continue;
          for (const value of delta.insert) {
            const id = pageOrderEntryId(value);
            if (id) changedIds.add(id);
          }
        }
        if (deletedUnknownEntry) {
          for (const value of host.pageOrder) {
            const id = pageOrderEntryId(value);
            if (id) changedIds.add(id);
          }
        }
      }
    };
    const observeDeletionOps = (event: Y.YMapEvent<string>, transaction: Y.Transaction) => {
      for (const operationId of event.keysChanged) {
        const oldValue = event.changes.keys.get(operationId)?.oldValue;
        if (typeof oldValue === "string") {
          unindexDeletionOperation(host, operationId, oldValue);
          markDeletionTargetChanged(host, oldValue, transaction);
        }
        const target = host.deletionOps.get(operationId);
        if (typeof target === "string") {
          indexDeletionOperation(host, operationId, target);
          markDeletionTargetChanged(host, target, transaction);
        }
      }
    };
    const observeDeletionAcks = (event: Y.YMapEvent<string>, transaction: Y.Transaction) => {
      for (const operationId of event.keysChanged) {
        const oldValue = event.changes.keys.get(operationId)?.oldValue;
        if (typeof oldValue === "string") markDeletionTargetChanged(host, oldValue, transaction);
        const target = host.deletionAcks.get(operationId);
        if (typeof target === "string") markDeletionTargetChanged(host, target, transaction);
      }
    };
    const markRasterEnvelopeSurfaces = (
      currentValue: unknown,
      oldValue: unknown,
      transaction: Y.Transaction,
      checkpoint = false
    ) => {
      const changedSurfaceIds = changedRasterSurfaceIdsFor(host, transaction);
      const parse = checkpoint ? rasterCheckpointSurfaceId : rasterEnvelopeSurfaceId;
      const currentSurfaceId = parse(currentValue);
      const oldSurfaceId = parse(oldValue);
      if (currentSurfaceId) changedSurfaceIds.add(currentSurfaceId);
      if (oldSurfaceId) changedSurfaceIds.add(oldSurfaceId);
    };
    const observeRasterSurfaces = (event: Y.YMapEvent<string>, transaction: Y.Transaction) => {
      const changedIds = changedRasterSurfaceIdsFor(host, transaction);
      for (const surfaceId of event.keysChanged) {
        if (RASTER_SAFE_ID_PATTERN.test(surfaceId) && surfaceId.length <= MAX_ID_LENGTH) {
          changedIds.add(surfaceId);
        }
      }
    };
    const observeRasterOperations = (event: Y.YMapEvent<string>, transaction: Y.Transaction) => {
      const changedIds = changedRasterOperationIdsFor(host, transaction);
      for (const operationId of event.keysChanged) {
        if (RASTER_UUID_PATTERN.test(operationId)) changedIds.add(operationId);
        markRasterEnvelopeSurfaces(
          host.rasterOperations.get(operationId),
          event.changes.keys.get(operationId)?.oldValue,
          transaction
        );
      }
    };
    const observeRasterUndoOperations = (event: Y.YMapEvent<string>, transaction: Y.Transaction) => {
      const changedIds = changedRasterUndoOperationIdsFor(host, transaction);
      for (const undoOperationId of event.keysChanged) {
        if (RASTER_UUID_PATTERN.test(undoOperationId)) changedIds.add(undoOperationId);
        markRasterEnvelopeSurfaces(
          host.rasterUndoOperations.get(undoOperationId),
          event.changes.keys.get(undoOperationId)?.oldValue,
          transaction
        );
      }
    };
    const observeRasterUndoAcknowledgements = (
      event: Y.YMapEvent<string>,
      transaction: Y.Transaction
    ) => {
      const changedIds = changedRasterUndoAcknowledgementIdsFor(host, transaction);
      for (const acknowledgementId of event.keysChanged) {
        if (RASTER_UUID_PATTERN.test(acknowledgementId)) changedIds.add(acknowledgementId);
        markRasterEnvelopeSurfaces(
          host.rasterUndoAcknowledgements.get(acknowledgementId),
          event.changes.keys.get(acknowledgementId)?.oldValue,
          transaction
        );
      }
    };
    const observeRasterCheckpoints = (event: Y.YMapEvent<string>, transaction: Y.Transaction) => {
      const changedIds = changedRasterCheckpointIdsFor(host, transaction);
      for (const checkpointId of event.keysChanged) {
        if (RASTER_UUID_PATTERN.test(checkpointId)) changedIds.add(checkpointId);
        markRasterEnvelopeSurfaces(
          host.rasterCheckpoints.get(checkpointId),
          event.changes.keys.get(checkpointId)?.oldValue,
          transaction,
          true
        );
      }
    };
    host.strokes.observeDeep(observeStrokes);
    host.order.observeDeep(observeOrder);
    host.sceneElementIds.observe(observeSceneElementIds);
    host.pageIds.observe(observePageIds);
    host.layerGroupIds.observe(observeLayerGroupIds);
    host.pageOrder.observeDeep(observePageOrder);
    host.deletionOps.observe(observeDeletionOps);
    host.deletionAcks.observe(observeDeletionAcks);
    host.rasterSurfaces.observe(observeRasterSurfaces);
    host.rasterOperations.observe(observeRasterOperations);
    host.rasterUndoOperations.observe(observeRasterUndoOperations);
    host.rasterUndoAcknowledgements.observe(observeRasterUndoAcknowledgements);
    host.rasterCheckpoints.observe(observeRasterCheckpoints);
    host.cleanup.add(() => host.strokes.unobserveDeep(observeStrokes));
    host.cleanup.add(() => host.order.unobserveDeep(observeOrder));
    host.cleanup.add(() => host.sceneElementIds.unobserve(observeSceneElementIds));
    host.cleanup.add(() => host.pageIds.unobserve(observePageIds));
    host.cleanup.add(() => host.layerGroupIds.unobserve(observeLayerGroupIds));
    host.cleanup.add(() => host.pageOrder.unobserveDeep(observePageOrder));
    host.cleanup.add(() => host.deletionOps.unobserve(observeDeletionOps));
    host.cleanup.add(() => host.deletionAcks.unobserve(observeDeletionAcks));
    host.cleanup.add(() => host.rasterSurfaces.unobserve(observeRasterSurfaces));
    host.cleanup.add(() => host.rasterOperations.unobserve(observeRasterOperations));
    host.cleanup.add(() => host.rasterUndoOperations.unobserve(observeRasterUndoOperations));
    host.cleanup.add(() => host.rasterUndoAcknowledgements.unobserve(observeRasterUndoAcknowledgements));
    host.cleanup.add(() => host.rasterCheckpoints.unobserve(observeRasterCheckpoints));

    // 이 리스너는 생성자에서 등록되므로, 이후 외부에서 호출되는 모든 subscribeChanges 리스너보다
    // 항상 먼저 afterTransaction을 받는다(Yjs는 등록 순서대로 리스너를 호출한다) — get*()가 이번
    // 트랜잭션의 dirty 표시를 놓치지 않는다는 불변식이 이 등록 순서에 의존한다. 여기서는 재디코딩을
    // 하지 않는다(Set.add 만 하므로 사실상 공짜) — 실제 디코딩은 drainDirty*Ids 가 get*() 호출 시점에
    // 지연 수행한다.
    const reconcileRecordCaches = (transaction: Y.Transaction) => {
      const changedStrokeIds = host.changedStrokeIdsByTransaction.get(transaction);
      if (changedStrokeIds) for (const id of changedStrokeIds) host.dirtyStrokeIds.add(id);
      const changedSceneElementIds = host.changedSceneElementIdsByTransaction.get(transaction);
      if (changedSceneElementIds) {
        for (const id of changedSceneElementIds) host.dirtySceneElementIds.add(id);
      }
      const changedPageIds = host.changedPageIdsByTransaction.get(transaction);
      if (changedPageIds) for (const id of changedPageIds) host.dirtyPageIds.add(id);
      const changedLayerGroupIds = host.changedLayerGroupIdsByTransaction.get(transaction);
      if (changedLayerGroupIds) {
        for (const compositeKey of changedLayerGroupIds) host.dirtyLayerGroupIds.add(compositeKey);
      }
    };
    host.doc.on("afterTransaction", reconcileRecordCaches);
    host.cleanup.add(() => host.doc.off("afterTransaction", reconcileRecordCaches));
  
}
