import * as Y from "yjs";

import {
  MAX_ID_LENGTH,
  MAX_LAYER_GROUP_KEY_LENGTH,
} from "./studio-crdt-document-constants";
import {
  deepFreeze,
  exactText,
  layerGroupDeletionTarget,
  layerGroupRootName,
  orderEntryValue,
  pageDeletionTarget,
  pageRootName,
  readCrdtProperties,
  readString,
  sceneDeletionTarget,
  sceneElementRootName,
  strokeDeletionTarget,
  yArray,
} from "./studio-crdt-document-helpers";
import { readPayload } from "./studio-crdt-document-payload";
import {
  changedLayerGroupIdsFor,
  changedPageIdsFor,
  changedSceneElementIdsFor,
  isDeleted,
} from "./studio-crdt-document-tracking";
import {
  decoratePageWithShared3dStage,
  getShared3dStageFrontier,
  type StudioCrdtShared3dStagePageState,
} from "./studio-crdt-shared-3d-stage";
import {
  SAMPLE_ARRAY_KEYS,
  type StudioCrdtLayerGroupRecord,
  type StudioCrdtPageRecord,
  type StudioCrdtSceneElementRecord,
  type StudioCrdtStrokeRecord,
} from "./studio-crdt-document-types";
import {
  STUDIO_CRDT_LAYER_GROUP_PAYLOAD_VERSION,
  STUDIO_CRDT_PAGE_PAYLOAD_VERSION,
  STUDIO_CRDT_SCENE_ELEMENT_PAYLOAD_VERSION,
  isStudioCrdtSceneElementType,
  studioCrdtLayerGroupKey,
  validateStudioCrdtLayerGroupPayload,
  validateStudioCrdtPagePayload,
  validateStudioCrdtSceneElementPayload,
  type StudioCrdtLayerGroupPayload,
  type StudioCrdtPagePayload,
  type StudioCrdtSceneElementPayload,
} from "./studio-crdt-scene-schema";

import type { StudioCrdtDocumentHost } from "./studio-crdt-document-host";

export function observeSceneElementRoot(host: StudioCrdtDocumentHost, id: string): void {
    const rootName = sceneElementRootName(id);
    if (host.observedSceneElementRoots.has(rootName)) return;
    let value: Y.Map<unknown>;
    try {
      value = host.doc.getMap<unknown>(rootName);
    } catch {
      return;
    }
    const listener = (_event: Y.YMapEvent<unknown>, transaction: Y.Transaction) => {
      changedSceneElementIdsFor(host, transaction).add(id);
    };
    value.observe(listener);
    host.observedSceneElementRoots.add(rootName);
    const dispose = () => {
      value.unobserve(listener);
      host.observedSceneElementRoots.delete(rootName);
    };
    host.cleanup.add(dispose);
  }

export function observePageRoot(host: StudioCrdtDocumentHost, id: string): void {
    const rootName = pageRootName(id);
    if (host.observedPageRoots.has(rootName)) return;
    let value: Y.Map<unknown>;
    try {
      value = host.doc.getMap<unknown>(rootName);
    } catch {
      return;
    }
    const listener = (_event: Y.YMapEvent<unknown>, transaction: Y.Transaction) => {
      changedPageIdsFor(host, transaction).add(id);
    };
    value.observe(listener);
    host.observedPageRoots.add(rootName);
    const dispose = () => {
      value.unobserve(listener);
      host.observedPageRoots.delete(rootName);
    };
    host.cleanup.add(dispose);
  }

export function observeLayerGroupRoot(host: StudioCrdtDocumentHost, compositeKey: string): void {
    const rootName = layerGroupRootName(compositeKey);
    if (host.observedLayerGroupRoots.has(rootName)) return;
    let value: Y.Map<unknown>;
    try {
      value = host.doc.getMap<unknown>(rootName);
    } catch {
      return;
    }
    const listener = (_event: Y.YMapEvent<unknown>, transaction: Y.Transaction) => {
      changedLayerGroupIdsFor(host, transaction).add(compositeKey);
    };
    value.observe(listener);
    host.observedLayerGroupRoots.add(rootName);
    const dispose = () => {
      value.unobserve(listener);
      host.observedLayerGroupRoots.delete(rootName);
    };
    host.cleanup.add(dispose);
  }

export function sceneElementRecord(host: StudioCrdtDocumentHost, id: string, create = false): Y.Map<unknown> | null {
    if (!create && host.sceneElementIds.get(id) !== true) return null;
    const rootName = sceneElementRootName(id);
    let value: Y.Map<unknown>;
    try {
      value = host.doc.getMap<unknown>(rootName);
    } catch {
      return null;
    }
    observeSceneElementRoot(host, id);
    return value as Y.Map<unknown>;
  }

export function pageRecord(host: StudioCrdtDocumentHost, id: string, create = false): Y.Map<unknown> | null {
    if (!create && host.pageIds.get(id) !== true) return null;
    const rootName = pageRootName(id);
    let value: Y.Map<unknown>;
    try {
      value = host.doc.getMap<unknown>(rootName);
    } catch {
      return null;
    }
    observePageRoot(host, id);
    return value as Y.Map<unknown>;
  }

export function layerGroupRecord(host: StudioCrdtDocumentHost, compositeKey: string, create = false): Y.Map<unknown> | null {
    if (!create && host.layerGroupIds.get(compositeKey) !== true) return null;
    const rootName = layerGroupRootName(compositeKey);
    let value: Y.Map<unknown>;
    try {
      value = host.doc.getMap<unknown>(rootName);
    } catch {
      return null;
    }
    observeLayerGroupRoot(host, compositeKey);
    return value as Y.Map<unknown>;
  }

export function readSceneElementPayload(host: StudioCrdtDocumentHost, record: Y.Map<unknown>): StudioCrdtSceneElementPayload | null {
    const version = record.get("payloadVersion");
    const type = record.get("type");
    if (
      version !== STUDIO_CRDT_SCENE_ELEMENT_PAYLOAD_VERSION ||
      !isStudioCrdtSceneElementType(type)
    ) return null;
    try {
      return validateStudioCrdtSceneElementPayload({ version, type, props: readCrdtProperties(record) });
    } catch {
      return null;
    }
  }

export function readSceneElementRecord(host: StudioCrdtDocumentHost,
    id: string,
    record: Y.Map<unknown>,
    orderIndex: number
  ): StudioCrdtSceneElementRecord | null {
    const pageId = readString(record, "pageId");
    const layerId = readString(record, "layerId");
    const payload = readSceneElementPayload(host, record);
    if (readString(record, "id") !== id || !pageId || !layerId || !payload) return null;
    return {
      id,
      pageId,
      layerId,
      payload,
      deleted: isDeleted(host, record, sceneDeletionTarget(id)),
      orderIndex,
    };
  }

export function readPagePayload(host: StudioCrdtDocumentHost, record: Y.Map<unknown>): StudioCrdtPagePayload | null {
    const version = record.get("payloadVersion");
    if (version !== STUDIO_CRDT_PAGE_PAYLOAD_VERSION) return null;
    try {
      return validateStudioCrdtPagePayload({ version, props: readCrdtProperties(record) });
    } catch {
      return null;
    }
  }

export function readPageRecord(host: StudioCrdtDocumentHost,
    id: string,
    record: Y.Map<unknown>,
    orderIndex: number,
    shared3dStageState?: StudioCrdtShared3dStagePageState,
  ): StudioCrdtPageRecord | null {
    const payload = readPagePayload(host, record);
    if (readString(record, "id") !== id || !payload) return null;
    return decoratePageWithShared3dStage(host, {
      id,
      payload,
      deleted: isDeleted(host, record, pageDeletionTarget(id)),
      orderIndex,
      shared3dStageManaged: false,
    }, shared3dStageState);
  }

export function readLayerGroupPayload(host: StudioCrdtDocumentHost, record: Y.Map<unknown>): StudioCrdtLayerGroupPayload | null {
    const version = record.get("payloadVersion");
    if (version !== STUDIO_CRDT_LAYER_GROUP_PAYLOAD_VERSION) return null;
    try {
      return validateStudioCrdtLayerGroupPayload({
        version,
        props: readCrdtProperties(record),
      });
    } catch {
      return null;
    }
  }

export function readLayerGroupRecord(host: StudioCrdtDocumentHost,
    compositeKey: string,
    record: Y.Map<unknown>
  ): StudioCrdtLayerGroupRecord | null {
    const id = readString(record, "id");
    const pageId = readString(record, "pageId");
    const payload = readLayerGroupPayload(host, record);
    if (!id || !pageId || !payload) return null;
    try {
      if (studioCrdtLayerGroupKey(pageId, id) !== compositeKey) return null;
    } catch {
      return null;
    }
    return {
      id,
      pageId,
      payload,
      deleted: isDeleted(host, record, layerGroupDeletionTarget(pageId, id)),
    };
  }

export function registerRecord(host: StudioCrdtDocumentHost, id: string, value: unknown): void {
    if (!(value instanceof Y.Map) || value.doc === null) return;
    host.strokeIdByType.set(value, id);
    for (const key of SAMPLE_ARRAY_KEYS) {
      const samples = yArray(value, key);
      if (samples) host.strokeIdByType.set(samples, id);
    }
  }

export function registerOrderEntry(host: StudioCrdtDocumentHost, value: unknown): void {
    if (!(value instanceof Y.Map) || value.doc === null) return;
    const id = orderEntryValue(value, "strokeId");
    if (id) host.strokeIdByType.set(value, id);
  }

// strokeRecordCache/sceneElementRecordCache/pageRecordCache/layerGroupRecordCache 갱신 — 생성자
  // 부트스트랩과 reconcileRecordCaches(afterTransaction) 양쪽에서 호출된다. 디코딩 로직은 기존
  // readRecord/readSceneElementRecord/readPageRecord/readLayerGroupRecord 를 그대로 재사용하고
  // (orderIndex 는 자리값 0 — get*() 가 캐시에서 꺼낸 뒤 order 배열 기준으로 새로 채운다), 결과는
  // deepFreeze 로 얼려 여러 get*() 호출 사이에서 안전하게 공유한다.
export function refreshStrokeRecordCache(host: StudioCrdtDocumentHost, id: string): void {
    const record = host.strokes.get(id);
    host.strokeRecordCache.set(
      id,
      record instanceof Y.Map ? deepFreeze(readRecord(host, id, record, 0)) : null
    );
  }

export function refreshSceneElementRecordCache(host: StudioCrdtDocumentHost, id: string): void {
    if (!exactText(id, MAX_ID_LENGTH)) {
      host.sceneElementRecordCache.set(id, null);
      return;
    }
    const record = sceneElementRecord(host, id);
    host.sceneElementRecordCache.set(
      id,
      record ? deepFreeze(readSceneElementRecord(host, id, record, 0)) : null
    );
  }

export function refreshPageRecordCache(
    host: StudioCrdtDocumentHost,
    id: string,
    shared3dStageState?: StudioCrdtShared3dStagePageState,
  ): void {
    if (!exactText(id, MAX_ID_LENGTH)) {
      host.pageRecordCache.set(id, null);
      return;
    }
    const record = pageRecord(host, id);
    host.pageRecordCache.set(
      id,
      record
        ? deepFreeze(readPageRecord(host, id, record, 0, shared3dStageState))
        : null,
    );
  }

export function refreshLayerGroupRecordCache(host: StudioCrdtDocumentHost, compositeKey: string): void {
    if (!exactText(compositeKey, MAX_LAYER_GROUP_KEY_LENGTH)) {
      host.layerGroupRecordCache.set(compositeKey, null);
      return;
    }
    const record = layerGroupRecord(host, compositeKey);
    host.layerGroupRecordCache.set(
      compositeKey,
      record ? deepFreeze(readLayerGroupRecord(host, compositeKey, record)) : null
    );
  }

// dirty*Ids 를 실제로 재디코딩해 캐시에 반영한다 — get*() 호출 맨 앞에서만 실행된다(지연 갱신).
  // 개별 id 하나의 디코딩 실패가 나머지 id 나 이 트랜잭션의 다른 subscribeChanges 구독자 통지를
  // 막지 않도록 각 항목을 개별적으로 try/catch 한다 — 이 파일의 다른 read* 헬퍼들이 신뢰할 수 없는
  // 원격 CRDT 콘텐츠에 조용히 null 로 실패하는 것과 동일한 방어. 실패한 항목은 캐시의 마지막으로
  // 성공한 값을 그대로 둔다(있다면) — 일시적 실패로 이전엔 유효했던 레코드를 사라지게 만들지 않는다.
export function drainDirtyStrokeIds(host: StudioCrdtDocumentHost): void {
    if (host.dirtyStrokeIds.size === 0) return;
    for (const id of host.dirtyStrokeIds) {
      try {
        refreshStrokeRecordCache(host, id);
      } catch {
        // 마지막으로 성공한 캐시 값 유지 — 위 주석 참고.
      }
    }
    host.dirtyStrokeIds.clear();
  }

export function drainDirtySceneElementIds(host: StudioCrdtDocumentHost): void {
    if (host.dirtySceneElementIds.size === 0) return;
    for (const id of host.dirtySceneElementIds) {
      try {
        refreshSceneElementRecordCache(host, id);
      } catch {
        // 마지막으로 성공한 캐시 값 유지 — 위 주석 참고.
      }
    }
    host.dirtySceneElementIds.clear();
  }

export function drainDirtyPageIds(host: StudioCrdtDocumentHost): void {
    if (host.dirtyPageIds.size === 0) return;
    let shared3dStageStateByPageId: ReadonlyMap<string, StudioCrdtShared3dStagePageState>;
    try {
      shared3dStageStateByPageId = new Map(
        getShared3dStageFrontier(host).map((state) => [state.pageId, state] as const),
      );
    } catch {
      // Preserve the last valid cache exactly as the former per-page try/catch did when an
      // untrusted sidecar made decoration fail. A later valid transaction will dirty the page again.
      host.dirtyPageIds.clear();
      return;
    }
    for (const id of host.dirtyPageIds) {
      try {
        refreshPageRecordCache(host, id, shared3dStageStateByPageId.get(id) ?? {
          pageId: id,
          managed: false,
          value: undefined,
        });
      } catch {
        // 마지막으로 성공한 캐시 값 유지 — 위 주석 참고.
      }
    }
    host.dirtyPageIds.clear();
  }

export function drainDirtyLayerGroupIds(host: StudioCrdtDocumentHost): void {
    if (host.dirtyLayerGroupIds.size === 0) return;
    for (const compositeKey of host.dirtyLayerGroupIds) {
      try {
        refreshLayerGroupRecordCache(host, compositeKey);
      } catch {
        // 마지막으로 성공한 캐시 값 유지 — 위 주석 참고.
      }
    }
    host.dirtyLayerGroupIds.clear();
  }

export function readRecord(host: StudioCrdtDocumentHost,
    id: string,
    record: Y.Map<unknown>,
    orderIndex: number
  ): StudioCrdtStrokeRecord | null {
    registerRecord(host, id, record);
    const storedId = readString(record, "id");
    const pageId = readString(record, "pageId");
    const layerId = readString(record, "layerId");
    const status = record.get("status");
    const payload = readPayload(record);
    if (
      storedId !== id ||
      !pageId ||
      !layerId ||
      (status !== "drawing" && status !== "finalized") ||
      !payload
    ) {
      return null;
    }
    return {
      id,
      pageId,
      layerId,
      payload,
      status,
      deleted: isDeleted(host, record, strokeDeletionTarget(id)),
      orderIndex,
    };
  }
