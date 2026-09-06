import * as Y from "yjs";

import {
  BASELINE_PROPERTY_PREFIX,
  MAX_TEXT_LENGTH,
  PROPERTY_PREFIX,
  UNSET_PROPERTY_PREFIX,
} from "./studio-crdt-document-constants";
import {
  assertId,
  assertLayerGroupId,
  cloneAndValidateJson,
  cloneJsonObject,
  exactText,
  layerGroupDeletionTarget,
  pageDeletionTarget,
  pageOrderEntryId,
  propertyKey,
  readString,
  sceneDeletionTarget,
  sceneOrderEntryId,
  setCrdtProperties,
  validateUnsetKeys,
} from "./studio-crdt-document-helpers";
import { assertAlive, type StudioCrdtDocumentHost } from "./studio-crdt-document-host";
import {
  assertMixedOrderEditBound,
  assertPageOrderEditBound,
  deactivateMixedOrderEntries,
  deactivatePageOrderEntries,
  insertPageOrderEntry,
  insertSceneOrderEntry,
  lastActiveMixedOrderIndex,
  lastActivePageOrderIndex,
  liveMixedOrderSuccessorId,
} from "./studio-crdt-document-order";
import {
  drainDirtyLayerGroupIds,
  drainDirtyPageIds,
  drainDirtySceneElementIds,
  layerGroupRecord,
  pageRecord,
  readLayerGroupPayload,
  readLayerGroupRecord,
  readPagePayload,
  readSceneElementPayload,
  readSceneElementRecord,
  sceneElementRecord,
} from "./studio-crdt-document-records";
import {
  acknowledgeCurrentDeletionOperations,
  addDeletionOperation,
  isDeleted,
  restoreDeletedRecord,
} from "./studio-crdt-document-tracking";
import { STUDIO_CRDT_ORIGIN_LOCAL } from "./studio-crdt-protocol";
import {
  STUDIO_CRDT_LAYER_GROUP_PAYLOAD_VERSION,
  STUDIO_CRDT_LAYER_GROUP_PROPERTY_KEYS,
  STUDIO_CRDT_PAGE_PAYLOAD_VERSION,
  STUDIO_CRDT_PAGE_PROPERTY_KEYS,
  STUDIO_CRDT_REQUIRED_SCENE_ELEMENT_KEYS,
  STUDIO_CRDT_SCENE_ELEMENT_KEYS_BY_TYPE,
  STUDIO_CRDT_SCENE_ELEMENT_PAYLOAD_VERSION,
  studioCrdtLayerGroupKey,
  validateStudioCrdtLayerGroupPayload,
  validateStudioCrdtPagePayload,
  validateStudioCrdtSceneElementPayload,
  type StudioCrdtJsonObject,
} from "./studio-crdt-scene-schema";

import type {
  StudioCrdtLayerGroupInput,
  StudioCrdtLayerGroupPatch,
  StudioCrdtLayerGroupQuery,
  StudioCrdtLayerGroupRecord,
  StudioCrdtLayerGroupUpsertOptions,
  StudioCrdtPageInput,
  StudioCrdtPagePatch,
  StudioCrdtPageRecord,
  StudioCrdtPageUpsertOptions,
  StudioCrdtSceneElementInput,
  StudioCrdtSceneElementPatch,
  StudioCrdtSceneElementQuery,
  StudioCrdtSceneElementRecord,
  StudioCrdtSceneElementUpsertOptions,
} from "./studio-crdt-document-types";

export function addSceneElement(host: StudioCrdtDocumentHost,
    input: StudioCrdtSceneElementInput,
    beforeElementId: string | null = null
  ): StudioCrdtSceneElementRecord {
    if (host.sceneElementIds.get(input.id) === true) {
      throw new Error("이미 존재하는 장면 요소 식별자입니다.");
    }
    return upsertSceneElement(host, input, { beforeElementId });
  }

export function upsertSceneElement(host: StudioCrdtDocumentHost,
    input: StudioCrdtSceneElementInput,
    options: StudioCrdtSceneElementUpsertOptions = {}
  ): StudioCrdtSceneElementRecord {
    assertAlive(host);
    assertSceneElementInput(host, input);
    const payload = validateStudioCrdtSceneElementPayload(input.payload);
    const exists = host.sceneElementIds.get(input.id) === true;
    const record = sceneElementRecord(host, input.id, !exists);
    if (!record) throw new Error("장면 요소 레코드가 손상되었습니다.");
    const deletionTarget = sceneDeletionTarget(input.id);
    const deleted = isDeleted(host, record, deletionTarget);
    const existingPayload = exists ? readSceneElementPayload(host, record) : null;
    if (exists && !existingPayload) throw new Error("기존 장면 요소 레코드가 손상되었습니다.");
    if (existingPayload && existingPayload.type !== payload.type) {
      throw new Error("기존 장면 요소의 타입은 변경할 수 없습니다.");
    }
    if (deleted && !options.resurrect) {
      throw new Error("삭제된 장면 요소는 명시적으로 복원해야 합니다.");
    }

    const usesLegacyBootstrap = options.baselineProps !== undefined || options.changedProps !== undefined ||
      options.unsetProps !== undefined;
    let baseline: StudioCrdtJsonObject | null = null;
    let changedProps: readonly string[] = [];
    let unsetProps: readonly string[] = [];
    if (usesLegacyBootstrap) {
      if (!options.baselineProps) {
        throw new Error("레거시 요소 등록에는 기준 속성이 필요합니다.");
      }
      baseline = validateStudioCrdtSceneElementPayload({
        version: STUDIO_CRDT_SCENE_ELEMENT_PAYLOAD_VERSION,
        type: payload.type,
        props: options.baselineProps,
      }).props;
      const allowed = STUDIO_CRDT_SCENE_ELEMENT_KEYS_BY_TYPE[payload.type];
      const seen = new Set<string>();
      for (const key of options.changedProps ?? []) {
        if (!exactText(key, MAX_TEXT_LENGTH) || !allowed.has(key) || seen.has(key) || !(key in payload.props)) {
          throw new Error("레거시 요소의 변경 속성 목록이 올바르지 않습니다.");
        }
        seen.add(key);
      }
      changedProps = [...seen];
      validateUnsetKeys(
        options.unsetProps ?? [],
        allowed,
        STUDIO_CRDT_REQUIRED_SCENE_ELEMENT_KEYS[payload.type]
      );
      unsetProps = [...new Set(options.unsetProps ?? [])];
      if (unsetProps.some((key) => seen.has(key) || key in payload.props)) {
        throw new Error("제거할 레거시 속성은 변경 목록과 현재 페이로드에 포함될 수 없습니다.");
      }
    }

    const previousPageId = readString(record, "pageId");
    const previousLayerId = readString(record, "layerId");
    const requiresOrderEntry = !exists || previousPageId !== input.pageId ||
      previousLayerId !== input.layerId || options.beforeElementId !== undefined;
    if (exists && requiresOrderEntry) assertMixedOrderEditBound(host, input.id, "elementId");
    // An explicit target wins; an implicit same-page layer change keeps the existing z-order slot.
    const reorderBeforeId = options.beforeElementId !== undefined
      ? options.beforeElementId
      : exists && requiresOrderEntry && previousPageId === input.pageId
        ? liveMixedOrderSuccessorId(host, input.id, "elementId", input.pageId)
        : null;

    host.doc.transact(() => {
      if (deleted && options.resurrect) {
        acknowledgeCurrentDeletionOperations(host, record, deletionTarget);
      }
      host.sceneElementIds.set(input.id, true);
      record.set("id", input.id);
      record.set("pageId", input.pageId);
      record.set("layerId", input.layerId);
      record.set("payloadVersion", payload.version);
      record.set("type", payload.type);
      if (baseline) {
        for (const [key, value] of Object.entries(baseline)) {
          const baselineKey = propertyKey(BASELINE_PROPERTY_PREFIX, key);
          if (!record.has(baselineKey)) record.set(baselineKey, cloneAndValidateJson(value));
        }
        setCrdtProperties(record, PROPERTY_PREFIX, payload.props, changedProps);
        for (const key of unsetProps) record.set(`${UNSET_PROPERTY_PREFIX}${key}`, true);
      } else {
        const previous = existingPayload?.props ?? {};
        setCrdtProperties(record, PROPERTY_PREFIX, payload.props);
        for (const key of Object.keys(previous)) {
          if (!(key in payload.props)) record.set(`${UNSET_PROPERTY_PREFIX}${key}`, true);
        }
      }
      if (requiresOrderEntry) {
        deactivateMixedOrderEntries(host, input.id, "elementId");
        insertSceneOrderEntry(host, input, reorderBeforeId);
      }
    }, STUDIO_CRDT_ORIGIN_LOCAL);
    return requiredSceneElement(host, input.id);
  }

export function patchSceneElement(host: StudioCrdtDocumentHost, id: string, patch: StudioCrdtSceneElementPatch): StudioCrdtSceneElementRecord {
    assertAlive(host);
    assertId(id, "장면 요소");
    const record = sceneElementRecord(host, id);
    if (!record || isDeleted(host, record, sceneDeletionTarget(id))) {
      throw new Error("수정할 장면 요소를 찾을 수 없습니다.");
    }
    const current = readSceneElementPayload(host, record);
    if (!current) throw new Error("장면 요소 레코드가 손상되었습니다.");
    const set = patch.set ? cloneJsonObject(patch.set) : {};
    const unset = patch.unset ?? [];
    const allowed = STUDIO_CRDT_SCENE_ELEMENT_KEYS_BY_TYPE[current.type];
    for (const key of Object.keys(set)) {
      if (!allowed.has(key)) throw new Error(`${current.type} 요소의 ${key} 속성은 동기화할 수 없습니다.`);
    }
    validateUnsetKeys(unset, allowed, STUDIO_CRDT_REQUIRED_SCENE_ELEMENT_KEYS[current.type]);
    const nextProps = { ...current.props, ...set };
    for (const key of unset) delete nextProps[key];
    validateStudioCrdtSceneElementPayload({ ...current, props: nextProps });
    if (patch.pageId !== undefined) assertId(patch.pageId, "페이지");
    if (patch.layerId !== undefined) assertId(patch.layerId, "레이어");
    const nextPageId = patch.pageId ?? readString(record, "pageId");
    const nextLayerId = patch.layerId ?? readString(record, "layerId");
    if (!nextPageId || !nextLayerId) throw new Error("장면 요소 위치 정보가 손상되었습니다.");
    const reparented = nextPageId !== record.get("pageId") || nextLayerId !== record.get("layerId");
    if (reparented) assertMixedOrderEditBound(host, id, "elementId");
    // A same-page layer change must not repaint the canvas, so keep the exact z-order slot.
    const reorderBeforeId = reparented && nextPageId === record.get("pageId")
      ? liveMixedOrderSuccessorId(host, id, "elementId", nextPageId)
      : null;

    host.doc.transact(() => {
      record.set("pageId", nextPageId);
      record.set("layerId", nextLayerId);
      setCrdtProperties(record, PROPERTY_PREFIX, set);
      for (const key of unset) record.set(`${UNSET_PROPERTY_PREFIX}${key}`, true);
      if (reparented) {
        deactivateMixedOrderEntries(host, id, "elementId");
        insertSceneOrderEntry(host, 
          { id, pageId: nextPageId, layerId: nextLayerId },
          reorderBeforeId
        );
      }
    }, STUDIO_CRDT_ORIGIN_LOCAL);
    return requiredSceneElement(host, id);
  }

export function deleteSceneElement(host: StudioCrdtDocumentHost, id: string): boolean {
    assertAlive(host);
    assertId(id, "장면 요소");
    const record = sceneElementRecord(host, id);
    const target = sceneDeletionTarget(id);
    if (!record || isDeleted(host, record, target)) return false;
    host.doc.transact(() => addDeletionOperation(host, target), STUDIO_CRDT_ORIGIN_LOCAL);
    return true;
  }

export function restoreSceneElement(host: StudioCrdtDocumentHost, id: string): boolean {
    assertAlive(host);
    assertId(id, "장면 요소");
    const record = sceneElementRecord(host, id);
    return record ? restoreDeletedRecord(host, record, sceneDeletionTarget(id)) : false;
  }

export function moveSceneElement(host: StudioCrdtDocumentHost, id: string, beforeElementId: string | null): StudioCrdtSceneElementRecord {
    assertAlive(host);
    assertId(id, "장면 요소");
    if (beforeElementId !== null) assertId(beforeElementId, "대상 요소");
    const record = sceneElementRecord(host, id);
    if (!record) throw new Error("이동할 장면 요소를 찾을 수 없습니다.");
    const pageId = readString(record, "pageId");
    const layerId = readString(record, "layerId");
    if (!pageId || !layerId) throw new Error("장면 요소 위치 정보가 손상되었습니다.");
    assertMixedOrderEditBound(host, id, "elementId");
    host.doc.transact(() => {
      deactivateMixedOrderEntries(host, id, "elementId");
      insertSceneOrderEntry(host, { id, pageId, layerId }, beforeElementId);
    }, STUDIO_CRDT_ORIGIN_LOCAL);
    return requiredSceneElement(host, id);
  }

export function getSceneElement(host: StudioCrdtDocumentHost, id: string, includeDeleted = false): StudioCrdtSceneElementRecord | null {
    assertAlive(host);
    const record = sceneElementRecord(host, id);
    if (!record) return null;
    const result = readSceneElementRecord(host, id, record, lastActiveMixedOrderIndex(host, id, "elementId"));
    if (!result || (!includeDeleted && result.deleted)) return null;
    return result;
  }

export function getSceneElements(host: StudioCrdtDocumentHost, query: StudioCrdtSceneElementQuery = {}): StudioCrdtSceneElementRecord[] {
    assertAlive(host);
    drainDirtySceneElementIds(host);
    const latestOrder = new Map<string, number>();
    host.order.forEach((entry, index) => {
      if (!(entry instanceof Y.Map) || entry.get("active") !== true) return;
      const id = sceneOrderEntryId(entry);
      if (id) latestOrder.set(id, index);
    });
    const records: StudioCrdtSceneElementRecord[] = [];
    for (const [id, cached] of host.sceneElementRecordCache) {
      if (!cached) continue;
      const result: StudioCrdtSceneElementRecord = {
        ...cached,
        orderIndex: latestOrder.get(id) ?? Number.MAX_SAFE_INTEGER,
      };
      if (!query.includeDeleted && result.deleted) continue;
      if (query.pageId !== undefined && result.pageId !== query.pageId) continue;
      if (query.layerId !== undefined && result.layerId !== query.layerId) continue;
      records.push(result);
    }
    return records.sort(
      (left, right) => left.pageId.localeCompare(right.pageId) ||
        left.orderIndex - right.orderIndex || left.id.localeCompare(right.id)
    );
  }

export function addPage(host: StudioCrdtDocumentHost, input: StudioCrdtPageInput, beforePageId: string | null = null): StudioCrdtPageRecord {
    if (host.pageIds.get(input.id) === true) throw new Error("이미 존재하는 페이지 식별자입니다.");
    return upsertPage(host, input, { beforePageId });
  }

export function upsertPage(host: StudioCrdtDocumentHost,
    input: StudioCrdtPageInput,
    options: StudioCrdtPageUpsertOptions = {}
  ): StudioCrdtPageRecord {
    assertAlive(host);
    assertId(input.id, "페이지");
    const payload = validateStudioCrdtPagePayload(input.payload);
    const exists = host.pageIds.get(input.id) === true;
    const record = pageRecord(host, input.id, !exists);
    if (!record) throw new Error("페이지 레코드가 손상되었습니다.");
    const deletionTarget = pageDeletionTarget(input.id);
    const deleted = isDeleted(host, record, deletionTarget);
    const previousPayload = exists ? readPagePayload(host, record) : null;
    if (exists && !previousPayload) throw new Error("기존 페이지 레코드가 손상되었습니다.");
    if (deleted && !options.resurrect) {
      throw new Error("삭제된 페이지는 명시적으로 복원해야 합니다.");
    }
    const usesLegacyBootstrap = options.baselineProps !== undefined || options.changedProps !== undefined ||
      options.unsetProps !== undefined;
    let baseline: StudioCrdtJsonObject | null = null;
    let changedProps: readonly string[] = [];
    let unsetProps: readonly string[] = [];
    if (usesLegacyBootstrap) {
      if (!options.baselineProps) throw new Error("레거시 페이지 등록에는 기준 속성이 필요합니다.");
      baseline = validateStudioCrdtPagePayload({
        version: STUDIO_CRDT_PAGE_PAYLOAD_VERSION,
        props: options.baselineProps,
      }).props;
      const seen = new Set<string>();
      for (const key of options.changedProps ?? []) {
        if (!exactText(key, MAX_TEXT_LENGTH) || !STUDIO_CRDT_PAGE_PROPERTY_KEYS.has(key) ||
          seen.has(key) || !(key in payload.props)) {
          throw new Error("레거시 페이지의 변경 속성 목록이 올바르지 않습니다.");
        }
        seen.add(key);
      }
      changedProps = [...seen];
      validateUnsetKeys(
        options.unsetProps ?? [],
        STUDIO_CRDT_PAGE_PROPERTY_KEYS,
        ["bg", "bgGrad", "canvasH"]
      );
      unsetProps = [...new Set(options.unsetProps ?? [])];
      if (unsetProps.some((key) => seen.has(key) || key in payload.props)) {
        throw new Error("제거할 레거시 페이지 속성은 변경 목록과 현재 페이로드에 포함될 수 없습니다.");
      }
    }
    const requiresOrderEntry = !exists || options.beforePageId !== undefined;
    if (exists && requiresOrderEntry) assertPageOrderEditBound(host, input.id);
    host.doc.transact(() => {
      if (deleted && options.resurrect) {
        acknowledgeCurrentDeletionOperations(host, record, deletionTarget);
      }
      host.pageIds.set(input.id, true);
      record.set("id", input.id);
      record.set("payloadVersion", payload.version);
      if (baseline) {
        for (const [key, value] of Object.entries(baseline)) {
          const baselineKey = propertyKey(BASELINE_PROPERTY_PREFIX, key);
          if (!record.has(baselineKey)) record.set(baselineKey, cloneAndValidateJson(value));
        }
        setCrdtProperties(record, PROPERTY_PREFIX, payload.props, changedProps);
        for (const key of unsetProps) record.set(`${UNSET_PROPERTY_PREFIX}${key}`, true);
      } else {
        setCrdtProperties(record, PROPERTY_PREFIX, payload.props);
        for (const key of Object.keys(previousPayload?.props ?? {})) {
          if (!(key in payload.props)) record.set(`${UNSET_PROPERTY_PREFIX}${key}`, true);
        }
      }
      if (requiresOrderEntry) {
        deactivatePageOrderEntries(host, input.id);
        insertPageOrderEntry(host, input.id, options.beforePageId ?? null);
      }
    }, STUDIO_CRDT_ORIGIN_LOCAL);
    return requiredPage(host, input.id);
  }

export function patchPage(host: StudioCrdtDocumentHost, id: string, patch: StudioCrdtPagePatch): StudioCrdtPageRecord {
    assertAlive(host);
    assertId(id, "페이지");
    const record = pageRecord(host, id);
    if (!record || isDeleted(host, record, pageDeletionTarget(id))) {
      throw new Error("수정할 페이지를 찾을 수 없습니다.");
    }
    const current = readPagePayload(host, record);
    if (!current) throw new Error("페이지 레코드가 손상되었습니다.");
    const set = patch.set ? cloneJsonObject(patch.set) : {};
    for (const key of Object.keys(set)) {
      if (!STUDIO_CRDT_PAGE_PROPERTY_KEYS.has(key)) {
        throw new Error(`페이지의 ${key} 속성은 동기화할 수 없습니다.`);
      }
    }
    validateUnsetKeys(
      patch.unset ?? [],
      STUDIO_CRDT_PAGE_PROPERTY_KEYS,
      ["bg", "bgGrad", "canvasH"]
    );
    const props = { ...current.props, ...set };
    for (const key of patch.unset ?? []) delete props[key];
    validateStudioCrdtPagePayload({ version: STUDIO_CRDT_PAGE_PAYLOAD_VERSION, props });
    host.doc.transact(() => {
      setCrdtProperties(record, PROPERTY_PREFIX, set);
      for (const key of patch.unset ?? []) {
        record.set(`${UNSET_PROPERTY_PREFIX}${key}`, true);
      }
    }, STUDIO_CRDT_ORIGIN_LOCAL);
    return requiredPage(host, id);
  }

export function deletePage(host: StudioCrdtDocumentHost, id: string): boolean {
    assertAlive(host);
    assertId(id, "페이지");
    const record = pageRecord(host, id);
    const target = pageDeletionTarget(id);
    if (!record || isDeleted(host, record, target)) return false;
    host.doc.transact(() => addDeletionOperation(host, target), STUDIO_CRDT_ORIGIN_LOCAL);
    return true;
  }

export function restorePage(host: StudioCrdtDocumentHost, id: string): boolean {
    assertAlive(host);
    assertId(id, "페이지");
    const record = pageRecord(host, id);
    return record ? restoreDeletedRecord(host, record, pageDeletionTarget(id)) : false;
  }

export function movePage(host: StudioCrdtDocumentHost, id: string, beforePageId: string | null): StudioCrdtPageRecord {
    assertAlive(host);
    assertId(id, "페이지");
    if (beforePageId !== null) assertId(beforePageId, "대상 페이지");
    if (!pageRecord(host, id)) throw new Error("이동할 페이지를 찾을 수 없습니다.");
    assertPageOrderEditBound(host, id);
    host.doc.transact(() => {
      deactivatePageOrderEntries(host, id);
      insertPageOrderEntry(host, id, beforePageId);
    }, STUDIO_CRDT_ORIGIN_LOCAL);
    return requiredPage(host, id);
  }

export function getPage(host: StudioCrdtDocumentHost, id: string, includeDeleted = false): StudioCrdtPageRecord | null {
    assertAlive(host);
    drainDirtyPageIds(host);
    const cached = host.pageRecordCache.get(id);
    if (!cached) return null;
    const result: StudioCrdtPageRecord = {
      ...cached,
      orderIndex: lastActivePageOrderIndex(host, id),
    };
    if (!includeDeleted && result.deleted) return null;
    return result;
  }

export function getPages(host: StudioCrdtDocumentHost, includeDeleted = false): StudioCrdtPageRecord[] {
    assertAlive(host);
    drainDirtyPageIds(host);
    const latestOrder = new Map<string, number>();
    host.pageOrder.forEach((entry, index) => {
      if (!(entry instanceof Y.Map) || entry.get("active") !== true) return;
      const id = pageOrderEntryId(entry);
      if (id) latestOrder.set(id, index);
    });
    const records: StudioCrdtPageRecord[] = [];
    for (const [id, cached] of host.pageRecordCache) {
      if (!cached) continue;
      const result: StudioCrdtPageRecord = {
        ...cached,
        orderIndex: latestOrder.get(id) ?? Number.MAX_SAFE_INTEGER,
      };
      if (!includeDeleted && result.deleted) continue;
      records.push(result);
    }
    return records.sort(
      (left, right) => left.orderIndex - right.orderIndex || left.id.localeCompare(right.id)
    );
  }

export function addLayerGroup(host: StudioCrdtDocumentHost, input: StudioCrdtLayerGroupInput): StudioCrdtLayerGroupRecord {
    const compositeKey = studioCrdtLayerGroupKey(input.pageId, input.id);
    if (host.layerGroupIds.get(compositeKey) === true) {
      throw new Error("이미 존재하는 레이어 그룹 식별자입니다.");
    }
    return upsertLayerGroup(host, input);
  }

export function upsertLayerGroup(host: StudioCrdtDocumentHost,
    input: StudioCrdtLayerGroupInput,
    options: StudioCrdtLayerGroupUpsertOptions = {}
  ): StudioCrdtLayerGroupRecord {
    assertAlive(host);
    assertLayerGroupId(input.id);
    assertId(input.pageId, "페이지");
    const compositeKey = studioCrdtLayerGroupKey(input.pageId, input.id);
    const payload = validateStudioCrdtLayerGroupPayload(input.payload);
    const exists = host.layerGroupIds.get(compositeKey) === true;
    const record = layerGroupRecord(host, compositeKey, !exists);
    if (!record) throw new Error("레이어 그룹 레코드가 손상되었습니다.");
    const deletionTarget = layerGroupDeletionTarget(input.pageId, input.id);
    const deleted = isDeleted(host, record, deletionTarget);
    const previousPayload = exists ? readLayerGroupPayload(host, record) : null;
    if (exists && !previousPayload) throw new Error("기존 레이어 그룹 레코드가 손상되었습니다.");
    if (deleted && !options.resurrect) {
      throw new Error("삭제된 레이어 그룹은 명시적으로 복원해야 합니다.");
    }

    const usesLegacyBootstrap = options.baselineProps !== undefined ||
      options.changedProps !== undefined || options.unsetProps !== undefined;
    let baseline: StudioCrdtJsonObject | null = null;
    let changedProps: readonly string[] = [];
    let unsetProps: readonly string[] = [];
    if (usesLegacyBootstrap) {
      if (!options.baselineProps) {
        throw new Error("레거시 레이어 그룹 등록에는 기준 속성이 필요합니다.");
      }
      baseline = validateStudioCrdtLayerGroupPayload({
        version: STUDIO_CRDT_LAYER_GROUP_PAYLOAD_VERSION,
        props: options.baselineProps,
      }).props;
      const seen = new Set<string>();
      for (const key of options.changedProps ?? []) {
        if (
          !exactText(key, MAX_TEXT_LENGTH) || !STUDIO_CRDT_LAYER_GROUP_PROPERTY_KEYS.has(key) ||
          seen.has(key) || !(key in payload.props)
        ) {
          throw new Error("레거시 레이어 그룹의 변경 속성 목록이 올바르지 않습니다.");
        }
        seen.add(key);
      }
      changedProps = [...seen];
      validateUnsetKeys(
        options.unsetProps ?? [],
        STUDIO_CRDT_LAYER_GROUP_PROPERTY_KEYS,
        ["name"]
      );
      unsetProps = [...new Set(options.unsetProps ?? [])];
      if (unsetProps.some((key) => seen.has(key) || key in payload.props)) {
        throw new Error("제거할 레이어 그룹 속성은 변경 목록과 현재 페이로드에 포함될 수 없습니다.");
      }
    }

    host.doc.transact(() => {
      if (deleted && options.resurrect) {
        acknowledgeCurrentDeletionOperations(host, record, deletionTarget);
      }
      host.layerGroupIds.set(compositeKey, true);
      record.set("id", input.id);
      record.set("pageId", input.pageId);
      record.set("payloadVersion", payload.version);
      if (baseline) {
        for (const [key, value] of Object.entries(baseline)) {
          const baselineKey = propertyKey(BASELINE_PROPERTY_PREFIX, key);
          if (!record.has(baselineKey)) record.set(baselineKey, cloneAndValidateJson(value));
        }
        setCrdtProperties(record, PROPERTY_PREFIX, payload.props, changedProps);
        for (const key of unsetProps) record.set(`${UNSET_PROPERTY_PREFIX}${key}`, true);
      } else {
        setCrdtProperties(record, PROPERTY_PREFIX, payload.props);
        for (const key of Object.keys(previousPayload?.props ?? {})) {
          if (!(key in payload.props)) record.set(`${UNSET_PROPERTY_PREFIX}${key}`, true);
        }
      }
    }, STUDIO_CRDT_ORIGIN_LOCAL);
    return requiredLayerGroup(host, input.pageId, input.id);
  }

export function patchLayerGroup(host: StudioCrdtDocumentHost,
    pageId: string,
    id: string,
    patch: StudioCrdtLayerGroupPatch
  ): StudioCrdtLayerGroupRecord {
    assertAlive(host);
    const compositeKey = studioCrdtLayerGroupKey(pageId, id);
    const record = layerGroupRecord(host, compositeKey);
    if (!record || isDeleted(host, record, layerGroupDeletionTarget(pageId, id))) {
      throw new Error("수정할 레이어 그룹을 찾을 수 없습니다.");
    }
    const current = readLayerGroupPayload(host, record);
    if (!current) throw new Error("레이어 그룹 레코드가 손상되었습니다.");
    const set = patch.set ? cloneJsonObject(patch.set) : {};
    for (const key of Object.keys(set)) {
      if (!STUDIO_CRDT_LAYER_GROUP_PROPERTY_KEYS.has(key)) {
        throw new Error(`레이어 그룹의 ${key} 속성은 동기화할 수 없습니다.`);
      }
    }
    validateUnsetKeys(
      patch.unset ?? [],
      STUDIO_CRDT_LAYER_GROUP_PROPERTY_KEYS,
      ["name"]
    );
    const props = { ...current.props, ...set };
    for (const key of patch.unset ?? []) delete props[key];
    validateStudioCrdtLayerGroupPayload({
      version: STUDIO_CRDT_LAYER_GROUP_PAYLOAD_VERSION,
      props,
    });
    host.doc.transact(() => {
      setCrdtProperties(record, PROPERTY_PREFIX, set);
      for (const key of patch.unset ?? []) record.set(`${UNSET_PROPERTY_PREFIX}${key}`, true);
    }, STUDIO_CRDT_ORIGIN_LOCAL);
    return requiredLayerGroup(host, pageId, id);
  }

export function deleteLayerGroup(host: StudioCrdtDocumentHost, pageId: string, id: string): boolean {
    assertAlive(host);
    const record = layerGroupRecord(host, studioCrdtLayerGroupKey(pageId, id));
    const target = layerGroupDeletionTarget(pageId, id);
    if (!record || isDeleted(host, record, target)) return false;
    host.doc.transact(() => addDeletionOperation(host, target), STUDIO_CRDT_ORIGIN_LOCAL);
    return true;
  }

export function restoreLayerGroup(host: StudioCrdtDocumentHost, pageId: string, id: string): boolean {
    assertAlive(host);
    const record = layerGroupRecord(host, studioCrdtLayerGroupKey(pageId, id));
    return record
      ? restoreDeletedRecord(host, record, layerGroupDeletionTarget(pageId, id))
      : false;
  }

export function getLayerGroup(host: StudioCrdtDocumentHost,
    pageId: string,
    id: string,
    includeDeleted = false
  ): StudioCrdtLayerGroupRecord | null {
    assertAlive(host);
    const compositeKey = studioCrdtLayerGroupKey(pageId, id);
    const record = layerGroupRecord(host, compositeKey);
    if (!record) return null;
    const result = readLayerGroupRecord(host, compositeKey, record);
    if (!result || (!includeDeleted && result.deleted)) return null;
    return result;
  }

export function getLayerGroups(host: StudioCrdtDocumentHost, query: StudioCrdtLayerGroupQuery = {}): StudioCrdtLayerGroupRecord[] {
    assertAlive(host);
    drainDirtyLayerGroupIds(host);
    const records: StudioCrdtLayerGroupRecord[] = [];
    for (const cached of host.layerGroupRecordCache.values()) {
      if (!cached) continue;
      if (!query.includeDeleted && cached.deleted) continue;
      if (query.pageId !== undefined && cached.pageId !== query.pageId) continue;
      records.push({ ...cached });
    }
    return records.sort(
      (left, right) => left.pageId.localeCompare(right.pageId) || left.id.localeCompare(right.id)
    );
  }

export function assertSceneElementInput(host: StudioCrdtDocumentHost, input: StudioCrdtSceneElementInput): void {
    assertId(input.id, "장면 요소");
    assertId(input.pageId, "페이지");
    assertId(input.layerId, "레이어");
    validateStudioCrdtSceneElementPayload(input.payload);
  }

export function requiredSceneElement(host: StudioCrdtDocumentHost, id: string): StudioCrdtSceneElementRecord {
    const result = getSceneElement(host, id, true);
    if (!result) throw new Error("CRDT 장면 요소를 읽지 못했습니다.");
    return result;
  }

export function requiredPage(host: StudioCrdtDocumentHost, id: string): StudioCrdtPageRecord {
    const result = getPage(host, id, true);
    if (!result) throw new Error("CRDT 페이지를 읽지 못했습니다.");
    return result;
  }

export function requiredLayerGroup(host: StudioCrdtDocumentHost, pageId: string, id: string): StudioCrdtLayerGroupRecord {
    const result = getLayerGroup(host, pageId, id, true);
    if (!result) throw new Error("CRDT 레이어 그룹을 읽지 못했습니다.");
    return result;
  }
