import * as Y from "yjs";

import {
  BATCH_MAX_DELAY_MS,
  BATCH_MIN_DELAY_MS,
  DEFAULT_BATCH_DELAY_MS,
  DEFAULT_BATCH_MAX_BYTES,
  STUDIO_CRDT_CHANGE_SNAPSHOT_FIELD_SET,
} from "./studio-crdt-document-constants";
import {
  defaultClearTimeout,
  defaultSetTimeout,
  mergeStudioCrdtUpdates,
} from "./studio-crdt-document-helpers";
import { assertAlive, type StudioCrdtDocumentHost } from "./studio-crdt-document-host";
import {
  decodeStudioCrdtStateVector,
  decodeStudioCrdtSyncChunks,
  decodeStudioCrdtUpdate,
  encodeStudioCrdtStateVector,
  encodeStudioCrdtUpdate,
  STUDIO_CRDT_ORIGIN_LOCAL,
  STUDIO_CRDT_ORIGIN_REMOTE,
  STUDIO_CRDT_ORIGIN_SYNC,
  STUDIO_CRDT_UPDATE_MAX_BYTES,
  type StudioCrdtSyncResponse,
} from "./studio-crdt-protocol";

import type {
  StudioCrdtBatchOptions,
  StudioCrdtBatchSubscription,
  StudioCrdtBatchedUpdate,
  StudioCrdtChangeHandler,
  StudioCrdtChangeSnapshot,
  StudioCrdtChangeSnapshotField,
  StudioCrdtChangeSubscriptionOptions,
  StudioCrdtChangeSummary,
  StudioCrdtProjectedChange,
  StudioCrdtProjectedChangeHandler,
  StudioCrdtProjectedChangeSubscriptionOptions,
  StudioCrdtUpdateHandler,
} from "./studio-crdt-document-types";

import { compareStudioRasterEventOrder } from "@/shared/lib/studio-crdt-raster-ops";

export function subscribe(host: StudioCrdtDocumentHost, handler: StudioCrdtUpdateHandler): () => void {
    assertAlive(host);
    const listener = (update: Uint8Array, origin: unknown) => handler(update.slice(), origin);
    host.doc.on("update", listener);
    const unsubscribe = () => {
      host.doc.off("update", listener);
      host.cleanup.delete(unsubscribe);
    };
    host.cleanup.add(unsubscribe);
    return unsubscribe;
  }

export function subscribeChanges<const Fields extends readonly StudioCrdtChangeSnapshotField[]>(host: StudioCrdtDocumentHost,
    handler: StudioCrdtProjectedChangeHandler<Fields>,
    options: StudioCrdtProjectedChangeSubscriptionOptions<Fields>
  ): () => void;
export function subscribeChanges(host: StudioCrdtDocumentHost,
    handler: StudioCrdtChangeHandler,
    options?: StudioCrdtChangeSubscriptionOptions
  ): () => void;
export function subscribeChanges<const Fields extends readonly StudioCrdtChangeSnapshotField[]>(host: StudioCrdtDocumentHost,
    handler: StudioCrdtChangeHandler | StudioCrdtProjectedChangeHandler<Fields>,
    options:
      | StudioCrdtChangeSubscriptionOptions
      | StudioCrdtProjectedChangeSubscriptionOptions<Fields> = {}
  ): () => void {
  return subscribeChangesImpl(host, handler, options);
}

/** Overload-free view of the tolerant implementation, for delegating wrappers (e.g. the document class). */
export function subscribeChangesImpl<const Fields extends readonly StudioCrdtChangeSnapshotField[]>(host: StudioCrdtDocumentHost,
    handler: StudioCrdtChangeHandler | StudioCrdtProjectedChangeHandler<Fields>,
    options:
      | StudioCrdtChangeSubscriptionOptions
      | StudioCrdtProjectedChangeSubscriptionOptions<Fields> = {}
  ): () => void {
    assertAlive(host);
    const projectionFields: Readonly<Fields> | null = options.snapshotFields === undefined
      ? null
      : Object.freeze([...options.snapshotFields]) as unknown as Readonly<Fields>;
    const projectionFieldSet = projectionFields === null
      ? null
      : new Set<StudioCrdtChangeSnapshotField>(projectionFields);
    if (projectionFields !== null) {
      for (const field of projectionFields) {
        if (!STUDIO_CRDT_CHANGE_SNAPSHOT_FIELD_SET.has(field)) {
          throw new Error(`지원하지 않는 CRDT 변경 스냅샷 필드입니다: ${field}`);
        }
      }
    }
    const listener = (transaction: Y.Transaction) => {
      if (options.includeOrigin && !options.includeOrigin(transaction.origin)) return;
      const summary: StudioCrdtChangeSummary = {
        origin: transaction.origin,
        local: transaction.local || transaction.origin === STUDIO_CRDT_ORIGIN_LOCAL,
        changedStrokeIds: new Set(host.changedStrokeIdsByTransaction.get(transaction) ?? []),
        changedSceneElementIds: new Set(
          host.changedSceneElementIdsByTransaction.get(transaction) ?? []
        ),
        changedPageIds: new Set(host.changedPageIdsByTransaction.get(transaction) ?? []),
        changedLayerGroupIds: new Set(
          host.changedLayerGroupIdsByTransaction.get(transaction) ?? []
        ),
        changedRasterSurfaceIds: new Set(
          host.changedRasterSurfaceIdsByTransaction.get(transaction) ?? []
        ),
        changedRasterOperationIds: new Set(
          host.changedRasterOperationIdsByTransaction.get(transaction) ?? []
        ),
        changedRasterUndoOperationIds: new Set(
          host.changedRasterUndoOperationIdsByTransaction.get(transaction) ?? []
        ),
        changedRasterUndoAcknowledgementIds: new Set(
          host.changedRasterUndoAcknowledgementIdsByTransaction.get(transaction) ?? []
        ),
        changedRasterCheckpointIds: new Set(
          host.changedRasterCheckpointIdsByTransaction.get(transaction) ?? []
        ),
      };
      if (options.includeChange && !options.includeChange(summary)) return;
      if (projectionFields !== null && projectionFieldSet !== null) {
        const change: StudioCrdtProjectedChange<Fields> = {
          ...summary,
          snapshotMode: "projected",
          snapshotFields: projectionFields,
          snapshot: materializeChangeSnapshotProjection<Fields>(host, projectionFieldSet),
        };
        (handler as StudioCrdtProjectedChangeHandler<Fields>)(change);
        return;
      }
      const rasterSnapshot = host.tryReadExactRasterDocumentSnapshot();
      (handler as StudioCrdtChangeHandler)({
        ...summary,
        strokes: host.getStrokes({ includeDeleted: true }),
        sceneElements: host.getSceneElements({ includeDeleted: true }),
        pages: host.getPages(true),
        layerGroups: host.getLayerGroups({ includeDeleted: true }),
        rasterOperationLogs: rasterSnapshot
          ? [...rasterSnapshot.logs.values()].sort((left, right) => (
              left.surface.surfaceId < right.surface.surfaceId ? -1 :
              left.surface.surfaceId > right.surface.surfaceId ? 1 : 0
            ))
          : [],
        rasterCheckpoints: rasterSnapshot
          ? [...rasterSnapshot.checkpoints].sort((left, right) => {
              const order = compareStudioRasterEventOrder(left.through, right.through);
              if (order !== 0) return order;
              return left.checkpointId < right.checkpointId ? -1 :
                left.checkpointId > right.checkpointId ? 1 : 0;
            })
          : [],
      });
    };
    host.doc.on("afterTransaction", listener);
    const unsubscribe = () => {
      host.doc.off("afterTransaction", listener);
      host.cleanup.delete(unsubscribe);
    };
    host.cleanup.add(unsubscribe);
    return unsubscribe;
  }

export function materializeChangeSnapshotProjection<
    Fields extends readonly StudioCrdtChangeSnapshotField[]
  >(host: StudioCrdtDocumentHost,
    fields: ReadonlySet<StudioCrdtChangeSnapshotField>
  ): Readonly<Pick<StudioCrdtChangeSnapshot, Fields[number]>> {
    const snapshot: Partial<StudioCrdtChangeSnapshot> = {};
    if (fields.has("strokes")) {
      snapshot.strokes = host.getStrokes({ includeDeleted: true });
    }
    if (fields.has("sceneElements")) {
      snapshot.sceneElements = host.getSceneElements({ includeDeleted: true });
    }
    if (fields.has("pages")) {
      snapshot.pages = host.getPages(true);
    }
    if (fields.has("layerGroups")) {
      snapshot.layerGroups = host.getLayerGroups({ includeDeleted: true });
    }
    const needsRasterSnapshot = fields.has("rasterOperationLogs") ||
      fields.has("rasterCheckpoints");
    if (needsRasterSnapshot) {
      const rasterSnapshot = host.tryReadExactRasterDocumentSnapshot();
      if (fields.has("rasterOperationLogs")) {
        snapshot.rasterOperationLogs = rasterSnapshot
          ? [...rasterSnapshot.logs.values()].sort((left, right) => (
              left.surface.surfaceId < right.surface.surfaceId ? -1 :
              left.surface.surfaceId > right.surface.surfaceId ? 1 : 0
            ))
          : [];
      }
      if (fields.has("rasterCheckpoints")) {
        snapshot.rasterCheckpoints = rasterSnapshot
          ? [...rasterSnapshot.checkpoints].sort((left, right) => {
              const order = compareStudioRasterEventOrder(left.through, right.through);
              if (order !== 0) return order;
              return left.checkpointId < right.checkpointId ? -1 :
                left.checkpointId > right.checkpointId ? 1 : 0;
            })
          : [];
      }
    }
    return snapshot as Pick<StudioCrdtChangeSnapshot, Fields[number]>;
  }

export function subscribeBatchedUpdates(host: StudioCrdtDocumentHost,
    handler: (batch: StudioCrdtBatchedUpdate) => void,
    options: StudioCrdtBatchOptions = {}
  ): StudioCrdtBatchSubscription {
    assertAlive(host);
    const delayMs = Math.min(
      BATCH_MAX_DELAY_MS,
      Math.max(BATCH_MIN_DELAY_MS, Math.trunc(options.delayMs ?? DEFAULT_BATCH_DELAY_MS))
    );
    const maximum = Math.min(
      STUDIO_CRDT_UPDATE_MAX_BYTES,
      Math.max(1_024, Math.trunc(options.maxBytes ?? DEFAULT_BATCH_MAX_BYTES))
    );
    const schedule = options.setTimeout ?? defaultSetTimeout;
    const cancel = options.clearTimeout ?? defaultClearTimeout;
    const includeOrigin = options.includeOrigin
      ?? ((origin: unknown) => origin === STUDIO_CRDT_ORIGIN_LOCAL);
    let updates: Uint8Array[] = [];
    let origins = new Set<unknown>();
    let queuedBytes = 0;
    let timeout: unknown = null;
    let active = true;

    const flush = () => {
      if (!active || updates.length === 0) return;
      if (timeout !== null) cancel(timeout);
      timeout = null;
      const currentUpdates = updates;
      const currentOrigins = origins;
      updates = [];
      origins = new Set();
      queuedBytes = 0;
      handler({ update: mergeStudioCrdtUpdates(currentUpdates), origins: currentOrigins });
    };
    const unsubscribeUpdates = subscribe(host, (update, origin) => {
      if (!active || !includeOrigin(origin)) return;
      if (updates.length > 0 && queuedBytes + update.byteLength > maximum) flush();
      updates.push(update);
      origins.add(origin);
      queuedBytes += update.byteLength;
      if (queuedBytes >= maximum) {
        flush();
      } else if (timeout === null) {
        timeout = schedule(flush, delayMs);
      }
    });
    const unsubscribe = () => {
      if (!active) return;
      flush();
      active = false;
      if (timeout !== null) cancel(timeout);
      timeout = null;
      unsubscribeUpdates();
      host.cleanup.delete(unsubscribe);
    };
    host.cleanup.add(unsubscribe);
    return { flush, unsubscribe };
  }

export function applyUpdate(host: StudioCrdtDocumentHost, update: Uint8Array, origin: unknown = STUDIO_CRDT_ORIGIN_REMOTE): void {
    assertAlive(host);
    if (update.byteLength === 0 || update.byteLength > STUDIO_CRDT_UPDATE_MAX_BYTES) {
      throw new Error("증분 CRDT 업데이트 크기가 허용 범위를 벗어났습니다.");
    }
    Y.applyUpdate(host.doc, update, origin);
  }

export function applyUpdateBase64(host: StudioCrdtDocumentHost, update: string, origin: unknown = STUDIO_CRDT_ORIGIN_REMOTE): void {
    applyUpdate(host, decodeStudioCrdtUpdate(update), origin);
  }

export function applySyncResponse(host: StudioCrdtDocumentHost, response: StudioCrdtSyncResponse): void {
    assertAlive(host);
    const update = decodeStudioCrdtSyncChunks(response.chunks, response.totalBytes);
    Y.applyUpdate(host.doc, update, STUDIO_CRDT_ORIGIN_SYNC);
  }

export function encodeStateVector(host: StudioCrdtDocumentHost): Uint8Array {
    assertAlive(host);
    return Y.encodeStateVector(host.doc);
  }

export function getStateVectorBase64(host: StudioCrdtDocumentHost): string {
    return encodeStudioCrdtStateVector(encodeStateVector(host));
  }

export function encodeStateAsUpdate(host: StudioCrdtDocumentHost, remoteStateVector?: Uint8Array): Uint8Array {
    assertAlive(host);
    return Y.encodeStateAsUpdate(host.doc, remoteStateVector);
  }

export function encodeMissingUpdate(host: StudioCrdtDocumentHost, serverStateVectorBase64: string): Uint8Array {
    return encodeStateAsUpdate(host, decodeStudioCrdtStateVector(serverStateVectorBase64));
  }

export function encodeMissingUpdateBase64(host: StudioCrdtDocumentHost, serverStateVectorBase64: string): string {
    const update = encodeMissingUpdate(host, serverStateVectorBase64);
    if (update.byteLength > STUDIO_CRDT_UPDATE_MAX_BYTES) {
      throw new Error(
        "오프라인 변경분이 단일 업로드 한도를 초과했습니다. 연결 상태를 유지한 채 대기 중인 증분 업데이트를 다시 전송해 주세요."
      );
    }
    return encodeStudioCrdtUpdate(update);
  }

export function getUpdateBase64(host: StudioCrdtDocumentHost, update: Uint8Array): string {
    return encodeStudioCrdtUpdate(update);
  }

export function destroy(host: StudioCrdtDocumentHost): void {
    if (host.destroyed) return;
    for (const dispose of [...host.cleanup]) dispose();
    host.cleanup.clear();
    host.destroyed = true;
    host.doc.destroy();
  }
