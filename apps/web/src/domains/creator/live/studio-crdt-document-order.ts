import * as Y from "yjs";

import { MAX_ACTIVE_ORDER_ENTRIES_PER_STROKE } from "./studio-crdt-document-constants";
import {
  assertId,
  mixedOrderEntryId,
  orderEntryValue,
  pageDeletionTarget,
  pageOrderEntryId,
  readString,
  sceneDeletionTarget,
  sceneOrderEntryId,
  strokeDeletionTarget,
} from "./studio-crdt-document-helpers";
import { pageRecord, sceneElementRecord } from "./studio-crdt-document-records";
import { isDeleted } from "./studio-crdt-document-tracking";

import type { StudioCrdtDocumentHost } from "./studio-crdt-document-host";
import type {
  StudioCrdtSceneElementInput,
  StudioCrdtStrokeInput,
} from "./studio-crdt-document-types";

export function createOrderEntry(host: StudioCrdtDocumentHost, input: Pick<StudioCrdtStrokeInput, "id" | "pageId" | "layerId">) {
    const entry = new Y.Map<unknown>();
    entry.set("strokeId", input.id);
    entry.set("pageId", input.pageId);
    entry.set("layerId", input.layerId);
    entry.set("active", true);
    // Registration reads the entry ID, so defer it until `order.push/insert` has integrated the
    // preliminary map and the order observer can register it safely.
    return entry;
  }

export function createSceneOrderEntry(host: StudioCrdtDocumentHost,
    input: Pick<StudioCrdtSceneElementInput, "id" | "pageId" | "layerId">
  ): Y.Map<unknown> {
    const entry = new Y.Map<unknown>();
    entry.set("elementId", input.id);
    entry.set("pageId", input.pageId);
    entry.set("layerId", input.layerId);
    entry.set("kind", "scene");
    entry.set("active", true);
    return entry;
  }

export function insertSceneOrderEntry(host: StudioCrdtDocumentHost,
    input: Pick<StudioCrdtSceneElementInput, "id" | "pageId" | "layerId">,
    beforeElementId: string | null
  ): void {
    const entry = createSceneOrderEntry(host, input);
    if (beforeElementId === null) {
      host.order.push([entry]);
      return;
    }
    assertId(beforeElementId, "대상 요소");
    let targetIndex = -1;
    host.order.forEach((candidate, index) => {
      if (
        candidate instanceof Y.Map && candidate.get("active") === true &&
        mixedOrderEntryId(candidate) === beforeElementId &&
        isLiveMixedOrderEntry(host, candidate, input.pageId)
      ) {
        targetIndex = index;
      }
    });
    if (targetIndex < 0) host.order.push([entry]);
    else host.order.insert(targetIndex, [entry]);
  }

export function isLiveMixedOrderEntry(host: StudioCrdtDocumentHost, entry: Y.Map<unknown>, expectedPageId: string): boolean {
    const pageId = orderEntryValue(entry, "pageId");
    const layerId = orderEntryValue(entry, "layerId");
    if (pageId !== expectedPageId || !layerId) return false;
    const strokeId = orderEntryValue(entry, "strokeId");
    if (strokeId) {
      const stroke = host.strokes.get(strokeId);
      return stroke instanceof Y.Map && !isDeleted(host, stroke, strokeDeletionTarget(strokeId)) &&
        readString(stroke, "pageId") === pageId && readString(stroke, "layerId") === layerId;
    }
    const elementId = sceneOrderEntryId(entry);
    if (!elementId) return false;
    const element = sceneElementRecord(host, elementId);
    return element !== null && !isDeleted(host, element, sceneDeletionTarget(elementId)) &&
      readString(element, "pageId") === pageId && readString(element, "layerId") === layerId;
  }

export function deactivateMixedOrderEntries(host: StudioCrdtDocumentHost, id: string, idKey: "strokeId" | "elementId"): void {
    for (const entry of host.order) {
      if (
        entry instanceof Y.Map && entry.get("active") === true &&
        orderEntryValue(entry, idKey) === id
      ) {
        entry.set("active", false);
      }
    }
  }

export function assertMixedOrderEditBound(host: StudioCrdtDocumentHost, id: string, idKey: "strokeId" | "elementId"): void {
    let activeCount = 0;
    for (const entry of host.order) {
      if (
        entry instanceof Y.Map && entry.get("active") === true &&
        orderEntryValue(entry, idKey) === id
      ) {
        activeCount += 1;
        if (activeCount >= MAX_ACTIVE_ORDER_ENTRIES_PER_STROKE) {
          throw new Error("요소 순서 충돌이 너무 많아 안전하게 이동할 수 없습니다. 먼저 다시 동기화해 주세요.");
        }
      }
    }
  }

/**
   * Returns the element the given one currently sits *below* in the shared page z-order.
   *
   * A layer reparent (grouping, ungrouping, "group with the layer below") only changes membership
   * metadata; the drawing must look identical afterwards. Re-inserting the order entry before this
   * successor keeps the element in its exact slot, whereas a `null` tail push would silently lift
   * every reparented element above its unreparented siblings. `null` means "already last", where a
   * tail push is itself position preserving.
   */
export function liveMixedOrderSuccessorId(host: StudioCrdtDocumentHost,
    id: string,
    idKey: "strokeId" | "elementId",
    pageId: string
  ): string | null {
    let anchorIndex = -1;
    host.order.forEach((entry, index) => {
      if (
        entry instanceof Y.Map && entry.get("active") === true &&
        orderEntryValue(entry, idKey) === id
      ) {
        anchorIndex = index;
      }
    });
    if (anchorIndex < 0) return null;
    for (let index = anchorIndex + 1; index < host.order.length; index += 1) {
      const entry = host.order.get(index);
      if (!(entry instanceof Y.Map) || entry.get("active") !== true) continue;
      const candidateId = mixedOrderEntryId(entry);
      if (!candidateId || candidateId === id) continue;
      if (!isLiveMixedOrderEntry(host, entry, pageId)) continue;
      return candidateId;
    }
    return null;
  }

export function lastActiveMixedOrderIndex(host: StudioCrdtDocumentHost, id: string, idKey: "strokeId" | "elementId"): number {
    let result = Number.MAX_SAFE_INTEGER;
    host.order.forEach((entry, index) => {
      if (
        entry instanceof Y.Map && entry.get("active") === true &&
        orderEntryValue(entry, idKey) === id
      ) {
        result = index;
      }
    });
    return result;
  }

export function createPageOrderEntry(host: StudioCrdtDocumentHost, id: string): Y.Map<unknown> {
    const entry = new Y.Map<unknown>();
    entry.set("pageId", id);
    entry.set("active", true);
    return entry;
  }

export function insertPageOrderEntry(host: StudioCrdtDocumentHost, id: string, beforePageId: string | null): void {
    const entry = createPageOrderEntry(host, id);
    if (beforePageId === null) {
      host.pageOrder.push([entry]);
      return;
    }
    assertId(beforePageId, "대상 페이지");
    const targetRecord = pageRecord(host, beforePageId);
    let targetIndex = -1;
    host.pageOrder.forEach((candidate, index) => {
      if (
        candidate instanceof Y.Map && candidate.get("active") === true &&
        pageOrderEntryId(candidate) === beforePageId &&
        targetRecord !== null && !isDeleted(host, targetRecord, pageDeletionTarget(beforePageId)) &&
        readString(targetRecord, "id") === beforePageId
      ) {
        targetIndex = index;
      }
    });
    if (targetIndex < 0) host.pageOrder.push([entry]);
    else host.pageOrder.insert(targetIndex, [entry]);
  }

export function deactivatePageOrderEntries(host: StudioCrdtDocumentHost, id: string): void {
    for (const entry of host.pageOrder) {
      if (
        entry instanceof Y.Map && entry.get("active") === true && pageOrderEntryId(entry) === id
      ) {
        entry.set("active", false);
      }
    }
  }

export function assertPageOrderEditBound(host: StudioCrdtDocumentHost, id: string): void {
    let activeCount = 0;
    for (const entry of host.pageOrder) {
      if (
        entry instanceof Y.Map && entry.get("active") === true && pageOrderEntryId(entry) === id
      ) {
        activeCount += 1;
        if (activeCount >= MAX_ACTIVE_ORDER_ENTRIES_PER_STROKE) {
          throw new Error("페이지 순서 충돌이 너무 많아 안전하게 이동할 수 없습니다. 먼저 다시 동기화해 주세요.");
        }
      }
    }
  }

export function lastActivePageOrderIndex(host: StudioCrdtDocumentHost, id: string): number {
    let result = Number.MAX_SAFE_INTEGER;
    host.pageOrder.forEach((entry, index) => {
      if (
        entry instanceof Y.Map && entry.get("active") === true && pageOrderEntryId(entry) === id
      ) {
        result = index;
      }
    });
    return result;
  }

export function insertOrderEntry(host: StudioCrdtDocumentHost,
    input: Pick<StudioCrdtStrokeInput, "id" | "pageId" | "layerId">,
    beforeStrokeId: string | null
  ): void {
    const entry = createOrderEntry(host, input);
    if (beforeStrokeId === null) {
      host.order.push([entry]);
      return;
    }
    assertId(beforeStrokeId, "대상 획");
    let targetIndex = -1;
    host.order.forEach((candidate, index) => {
      if (
        candidate instanceof Y.Map &&
        candidate.get("active") === true &&
        mixedOrderEntryId(candidate) === beforeStrokeId &&
        isLiveMixedOrderEntry(host, candidate, input.pageId)
      ) {
        targetIndex = index;
      }
    });
    if (targetIndex < 0) host.order.push([entry]);
    else host.order.insert(targetIndex, [entry]);
  }

export function deactivateOrderEntries(host: StudioCrdtDocumentHost, id: string): void {
    for (const entry of host.order) {
      if (
        entry instanceof Y.Map &&
        entry.get("active") === true &&
        orderEntryValue(entry, "strokeId") === id
      ) {
        entry.set("active", false);
      }
    }
  }

export function assertOrderEditBound(host: StudioCrdtDocumentHost, id: string): void {
    let activeCount = 0;
    for (const entry of host.order) {
      if (
        entry instanceof Y.Map &&
        entry.get("active") === true &&
        orderEntryValue(entry, "strokeId") === id
      ) {
        activeCount += 1;
        if (activeCount >= MAX_ACTIVE_ORDER_ENTRIES_PER_STROKE) {
          throw new Error("획 순서 충돌이 너무 많아 안전하게 이동할 수 없습니다. 먼저 다시 동기화해 주세요.");
        }
      }
    }
  }

export function lastActiveOrderIndex(host: StudioCrdtDocumentHost, id: string): number {
    let result = Number.MAX_SAFE_INTEGER;
    host.order.forEach((entry, index) => {
      if (
        entry instanceof Y.Map &&
        entry.get("active") === true &&
        orderEntryValue(entry, "strokeId") === id
      ) {
        result = index;
      }
    });
    return result;
  }
