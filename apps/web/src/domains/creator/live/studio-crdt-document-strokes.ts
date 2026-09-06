import * as Y from "yjs";

import { isStudioInkPressureModel } from "../brush/studio-ink-pressure-model";

import {
  EXTENDED_INK_SAMPLE_ARRAY_KEYS,
  STUDIO_CRDT_APPEND_MAX_SAMPLES,
  STUDIO_CRDT_REPLACE_CHUNK_SAMPLES,
  STUDIO_CRDT_STROKE_MAX_SAMPLES,
} from "./studio-crdt-document-constants";
import {
  assertId,
  createSampleArray,
  orderEntryValue,
  readJsonObject,
  readString,
  strokeDeletionTarget,
  yArray,
} from "./studio-crdt-document-helpers";
import { assertAlive, type StudioCrdtDocumentHost } from "./studio-crdt-document-host";
import {
  assertOrderEditBound,
  deactivateOrderEntries,
  insertOrderEntry,
  lastActiveOrderIndex,
  liveMixedOrderSuccessorId,
} from "./studio-crdt-document-order";
import {
  mergeStrokePayloadFields,
  normalizedSamples,
  readPayload,
  setPayloadMetadata,
  setPayloadMetadataField,
  validatePayload,
} from "./studio-crdt-document-payload";
import {
  drainDirtyStrokeIds,
  readRecord,
} from "./studio-crdt-document-records";
import {
  acknowledgeCurrentDeletionOperations,
  addDeletionOperation,
  isDeleted,
  restoreDeletedRecord,
} from "./studio-crdt-document-tracking";
import {
  SAMPLE_ARRAY_KEYS,
  STROKE_PAYLOAD_KEYS,
  type StudioCrdtSampleArrayKey,
  type StudioCrdtStrokeInput,
  type StudioCrdtStrokePatch,
  type StudioCrdtStrokePayloadKey,
  type StudioCrdtStrokeQuery,
  type StudioCrdtStrokeRecord,
  type StudioCrdtStrokeSamples,
  type StudioCrdtUpsertOptions,
} from "./studio-crdt-document-types";
import { STUDIO_CRDT_ORIGIN_LOCAL } from "./studio-crdt-protocol";

import {
  isStudioInkInputContractV2,
  normalizeStudioInkInputContract,
} from "@/shared/lib/studio-ink-input-contract";

export function beginStroke(host: StudioCrdtDocumentHost, input: StudioCrdtStrokeInput, beforeStrokeId: string | null = null): StudioCrdtStrokeRecord {
    assertAlive(host);
    assertStrokeInput(host, input, true);
    if (host.strokes.has(input.id)) throw new Error("이미 존재하는 획 식별자입니다.");
    const normalized = normalizedSamples(input.payload, true);
    const emptyInput = withoutSamples(host, input);
    host.doc.transact(() => {
      const record = createRecord(host, emptyInput, "drawing");
      host.strokes.set(input.id, record);
      insertOrderEntry(host, input, beforeStrokeId);
    }, STUDIO_CRDT_ORIGIN_LOCAL);
    const record = host.strokes.get(input.id);
    if (!(record instanceof Y.Map)) throw new Error("생성한 획 레코드가 손상되었습니다.");
    appendNormalizedSamples(host, record, normalized);
    return requiredStroke(host, input.id);
  }

export function appendStrokeSamples(host: StudioCrdtDocumentHost, id: string, samples: StudioCrdtStrokeSamples): number {
    assertAlive(host);
    assertId(id, "획");
    const record = host.strokes.get(id);
    if (!(record instanceof Y.Map) || isDeleted(host, record, strokeDeletionTarget(id))) {
      throw new Error("추가할 획을 찾을 수 없습니다.");
    }
    if (record.get("status") !== "drawing") throw new Error("완료된 획에는 샘플을 추가할 수 없습니다.");
    const extensions = readJsonObject(record, "extensions");
    const pressureModel = isStudioInkPressureModel(extensions?.pressureModel)
      ? extensions.pressureModel
      : undefined;
    const requireExtendedInkChannels = isStudioInkInputContractV2(
      normalizeStudioInkInputContract(extensions?.inkInput),
    );
    const normalized = normalizedSamples(
      samples,
      false,
      pressureModel,
      requireExtendedInkChannels,
    );
    if (requireExtendedInkChannels) {
      const storedTimeOffsets = yArray(record, "sampleTimeOffsets");
      const previousTimeOffset = storedTimeOffsets?.length
        ? storedTimeOffsets.get(storedTimeOffsets.length - 1)
        : 0;
      const nextTimeOffset = normalized.sampleTimeOffsets?.[0];
      if (
        typeof previousTimeOffset !== "number"
        || typeof nextTimeOffset !== "number"
        || nextTimeOffset < previousTimeOffset
      ) {
        throw new Error("추가할 획 상대 시간이 기존 권위 샘플보다 앞섭니다.");
      }
    }
    const appendedCount = normalized.points.length / 2;
    if (appendedCount > STUDIO_CRDT_APPEND_MAX_SAMPLES) {
      throw new Error("한 번에 추가할 수 있는 획 샘플 수를 초과했습니다.");
    }
    const currentCount = (yArray(record, "points")?.length ?? 0) / 2;
    if (currentCount + appendedCount > STUDIO_CRDT_STROKE_MAX_SAMPLES) {
      throw new Error("획 샘플 수가 최대 한도를 초과합니다.");
    }
    appendNormalizedSamples(host, record, normalized);
    return currentCount + appendedCount;
  }

export function finalizeStroke(host: StudioCrdtDocumentHost, id: string, finalSamples?: StudioCrdtStrokeSamples): StudioCrdtStrokeRecord {
    assertAlive(host);
    if (finalSamples !== undefined) appendStrokeSamples(host, id, finalSamples);
    const record = host.strokes.get(id);
    if (!(record instanceof Y.Map) || isDeleted(host, record, strokeDeletionTarget(id))) {
      throw new Error("완료할 획을 찾을 수 없습니다.");
    }
    host.doc.transact(() => record.set("status", "finalized"), STUDIO_CRDT_ORIGIN_LOCAL);
    return requiredStroke(host, id);
  }

export function addStroke(host: StudioCrdtDocumentHost, input: StudioCrdtStrokeInput): StudioCrdtStrokeRecord {
    return upsertStroke(host, input, { status: "finalized" });
  }

export function upsertStroke(host: StudioCrdtDocumentHost,
    input: StudioCrdtStrokeInput,
    options: StudioCrdtUpsertOptions = {}
  ): StudioCrdtStrokeRecord {
    assertAlive(host);
    assertStrokeInput(host, input, true);
    const existing = host.strokes.get(input.id);
    const desiredStatus = options.status ?? "finalized";
    if (existing !== undefined && !(existing instanceof Y.Map)) {
      throw new Error("기존 획 레코드가 손상되었습니다.");
    }
    if (!existing) {
      beginStroke(host, input, options.beforeStrokeId ?? null);
      if (desiredStatus === "finalized") {
        const created = host.strokes.get(input.id);
        if (!(created instanceof Y.Map)) throw new Error("생성한 획 레코드가 손상되었습니다.");
        host.doc.transact(
          () => created.set("status", "finalized"),
          STUDIO_CRDT_ORIGIN_LOCAL
        );
      }
      return requiredStroke(host, input.id);
    }

    const deletionTarget = strokeDeletionTarget(input.id);
    const deleted = isDeleted(host, existing, deletionTarget);
    if (deleted && !options.resurrect) throw new Error("삭제된 획은 명시적으로 복원해야 합니다.");
    const normalized = normalizedSamples(input.payload, true);
    const previousPageId = readString(existing, "pageId");
    const previousLayerId = readString(existing, "layerId");
    const requiresReorder = previousPageId !== input.pageId ||
      previousLayerId !== input.layerId ||
      options.beforeStrokeId !== undefined;
    if (requiresReorder) assertOrderEditBound(host, input.id);
    // An explicit target wins; an implicit same-page layer change keeps the existing z-order slot.
    const reorderBeforeId = options.beforeStrokeId !== undefined
      ? options.beforeStrokeId
      : requiresReorder && previousPageId === input.pageId
        ? liveMixedOrderSuccessorId(host, input.id, "strokeId", input.pageId)
        : null;
    host.doc.transact(() => {
      if (deleted && options.resurrect) {
        acknowledgeCurrentDeletionOperations(host, existing, deletionTarget);
      }
      existing.set("pageId", input.pageId);
      existing.set("layerId", input.layerId);
      existing.set("status", "drawing");
      setPayloadMetadata(existing, input.payload);
      for (const key of SAMPLE_ARRAY_KEYS) {
        const nextValues = normalized[key];
        let target = yArray(existing, key);
        if (
          (EXTENDED_INK_SAMPLE_ARRAY_KEYS as readonly string[]).includes(key)
          && nextValues === undefined
        ) {
          existing.delete(key);
          continue;
        }
        if (
          !target
          && (EXTENDED_INK_SAMPLE_ARRAY_KEYS as readonly string[]).includes(key)
        ) {
          existing.set(key, createSampleArray([]));
          target = yArray(existing, key);
        }
        if (!target) throw new Error("획 샘플 배열이 손상되었습니다.");
        if (target.length > 0) target.delete(0, target.length);
      }
      if (requiresReorder) {
        deactivateOrderEntries(host, input.id);
        insertOrderEntry(host, input, reorderBeforeId);
      }
    }, STUDIO_CRDT_ORIGIN_LOCAL);
    appendNormalizedSamples(host, existing, normalized);
    if (desiredStatus === "finalized") {
      host.doc.transact(
        () => existing.set("status", "finalized"),
        STUDIO_CRDT_ORIGIN_LOCAL
      );
    }
    return requiredStroke(host, input.id);
  }

/**
   * Replaces a completed stroke without creating an oversized single Yjs update. Metadata and
   * array reset are one transaction, sample inserts are bounded transactions, and finalization is
   * last. Remote peers can therefore render the replacement progressively while every wire update
   * stays below the durable channel's incremental cap after batching.
   */
export function replaceStroke(host: StudioCrdtDocumentHost, input: StudioCrdtStrokeInput): StudioCrdtStrokeRecord {
    return upsertStroke(host, input, { status: "finalized" });
  }

/**
   * Applies only fields that changed in the caller's local before/after snapshot. Independent
   * metadata edits therefore remain independent Y.Map operations instead of a replace-all write.
   * Pointer arrays are one aligned atomic group and retain the existing bounded chunk transport.
   */
export function patchStroke(host: StudioCrdtDocumentHost, id: string, patch: StudioCrdtStrokePatch): StudioCrdtStrokeRecord {
    assertAlive(host);
    assertId(id, "획");
    const record = host.strokes.get(id);
    if (!(record instanceof Y.Map) || isDeleted(host, record, strokeDeletionTarget(id))) {
      throw new Error("수정할 획을 찾을 수 없습니다.");
    }
    const current = requiredStroke(host, id);
    const changedKeys = [...new Set(patch.changedPayloadKeys ?? [])];
    for (const key of changedKeys) {
      if (!(STROKE_PAYLOAD_KEYS as readonly string[]).includes(key)) {
        throw new Error("수정할 획 속성이 올바르지 않습니다.");
      }
    }
    if (changedKeys.some((key) => (SAMPLE_ARRAY_KEYS as readonly string[]).includes(key))) {
      for (const key of SAMPLE_ARRAY_KEYS) {
        if (!changedKeys.includes(key)) changedKeys.push(key);
      }
    }
    if (changedKeys.length > 0 && !patch.payload) {
      throw new Error("획 속성을 수정하려면 다음 페이로드가 필요합니다.");
    }
    const pageId = patch.pageId ?? current.pageId;
    const layerId = patch.layerId ?? current.layerId;
    const payload = patch.payload
      ? mergeStrokePayloadFields(current.payload, patch.payload, changedKeys)
      : current.payload;
    assertStrokeInput(host, { id, pageId, layerId, payload }, true);

    const requiresReorder = pageId !== current.pageId || layerId !== current.layerId;
    if (requiresReorder) assertOrderEditBound(host, id);
    // A same-page layer change must not repaint the canvas, so keep the exact z-order slot.
    const reorderBeforeId = requiresReorder && pageId === current.pageId
      ? liveMixedOrderSuccessorId(host, id, "strokeId", pageId)
      : null;
    const sampleChanged = changedKeys.some((key) =>
      (SAMPLE_ARRAY_KEYS as readonly string[]).includes(key)
    );
    const metadataKeys = changedKeys.filter((key) =>
      !(SAMPLE_ARRAY_KEYS as readonly string[]).includes(key)
    ) as Exclude<StudioCrdtStrokePayloadKey, StudioCrdtSampleArrayKey>[];
    if (!requiresReorder && !sampleChanged && metadataKeys.length === 0) return current;

    const normalized = sampleChanged ? normalizedSamples(payload, true) : null;
    host.doc.transact(() => {
      if (requiresReorder) {
        record.set("pageId", pageId);
        record.set("layerId", layerId);
        deactivateOrderEntries(host, id);
        insertOrderEntry(host, { id, pageId, layerId }, reorderBeforeId);
      }
      for (const key of metadataKeys) setPayloadMetadataField(record, payload, key);
      if (sampleChanged) {
        record.set("status", "drawing");
        for (const key of SAMPLE_ARRAY_KEYS) {
          const nextValues = normalized?.[key];
          let target = yArray(record, key);
          if (
            (EXTENDED_INK_SAMPLE_ARRAY_KEYS as readonly string[]).includes(key)
            && nextValues === undefined
          ) {
            record.delete(key);
            continue;
          }
          if (
            !target
            && (EXTENDED_INK_SAMPLE_ARRAY_KEYS as readonly string[]).includes(key)
          ) {
            record.set(key, createSampleArray([]));
            target = yArray(record, key);
          }
          if (!target) throw new Error("획 샘플 배열이 손상되었습니다.");
          if (target.length > 0) target.delete(0, target.length);
        }
      }
    }, STUDIO_CRDT_ORIGIN_LOCAL);
    if (normalized) {
      appendNormalizedSamples(host, record, normalized);
      host.doc.transact(() => record.set("status", "finalized"), STUDIO_CRDT_ORIGIN_LOCAL);
    }
    return requiredStroke(host, id);
  }

export function deleteStroke(host: StudioCrdtDocumentHost, id: string): boolean {
    assertAlive(host);
    assertId(id, "획");
    const record = host.strokes.get(id);
    const target = strokeDeletionTarget(id);
    if (!(record instanceof Y.Map) || isDeleted(host, record, target)) return false;
    host.doc.transact(() => addDeletionOperation(host, target), STUDIO_CRDT_ORIGIN_LOCAL);
    return true;
  }

export function restoreStroke(host: StudioCrdtDocumentHost, id: string): boolean {
    assertAlive(host);
    assertId(id, "획");
    const record = host.strokes.get(id);
    return record instanceof Y.Map
      ? restoreDeletedRecord(host, record, strokeDeletionTarget(id))
      : false;
  }

export function moveStroke(host: StudioCrdtDocumentHost, id: string, beforeStrokeId: string | null): StudioCrdtStrokeRecord {
    assertAlive(host);
    assertId(id, "획");
    if (beforeStrokeId !== null) assertId(beforeStrokeId, "대상 획");
    const record = host.strokes.get(id);
    if (!(record instanceof Y.Map)) throw new Error("이동할 획을 찾을 수 없습니다.");
    const pageId = readString(record, "pageId");
    const layerId = readString(record, "layerId");
    if (!pageId || !layerId) throw new Error("획의 페이지 또는 레이어 정보가 손상되었습니다.");
    assertOrderEditBound(host, id);
    host.doc.transact(() => {
      deactivateOrderEntries(host, id);
      insertOrderEntry(host, { id, pageId, layerId }, beforeStrokeId);
    }, STUDIO_CRDT_ORIGIN_LOCAL);
    return requiredStroke(host, id);
  }

export function getStroke(host: StudioCrdtDocumentHost, id: string, includeDeleted = false): StudioCrdtStrokeRecord | null {
    assertAlive(host);
    const record = host.strokes.get(id);
    if (!(record instanceof Y.Map)) return null;
    const orderIndex = lastActiveOrderIndex(host, id);
    const result = readRecord(host, id, record, orderIndex);
    if (!result || (!includeDeleted && result.deleted)) return null;
    return result;
  }

export function getStrokes(host: StudioCrdtDocumentHost, query: StudioCrdtStrokeQuery = {}): StudioCrdtStrokeRecord[] {
    assertAlive(host);
    drainDirtyStrokeIds(host);
    const latestOrder = new Map<string, number>();
    host.order.forEach((entry, index) => {
      if (!(entry instanceof Y.Map)) return;
      if (entry.get("active") !== true) return;
      const id = orderEntryValue(entry, "strokeId");
      if (id) latestOrder.set(id, index);
    });
    const records: StudioCrdtStrokeRecord[] = [];
    for (const [id, cached] of host.strokeRecordCache) {
      if (!cached) continue;
      const result: StudioCrdtStrokeRecord = {
        ...cached,
        orderIndex: latestOrder.get(id) ?? Number.MAX_SAFE_INTEGER,
      };
      if (!query.includeDeleted && result.deleted) continue;
      if (query.pageId !== undefined && result.pageId !== query.pageId) continue;
      if (query.layerId !== undefined && result.layerId !== query.layerId) continue;
      records.push(result);
    }
    return records.sort(
      (left, right) =>
        left.pageId.localeCompare(right.pageId) ||
        left.orderIndex - right.orderIndex ||
        left.id.localeCompare(right.id)
    );
  }

export function assertStrokeInput(host: StudioCrdtDocumentHost, input: StudioCrdtStrokeInput, allowEmpty: boolean): void {
    assertId(input.id, "획");
    assertId(input.pageId, "페이지");
    assertId(input.layerId, "레이어");
    validatePayload(input.payload, allowEmpty);
  }

export function withoutSamples(host: StudioCrdtDocumentHost, input: StudioCrdtStrokeInput): StudioCrdtStrokeInput {
    return {
      ...input,
      payload: {
        ...input.payload,
        points: [],
        pressures: [],
        tiltXs: [],
        tiltYs: [],
        twists: [],
        speeds: [],
        tangentialPressures: [],
        ...(input.payload.altitudeAngles ? { altitudeAngles: [] } : {}),
        ...(input.payload.azimuthAngles ? { azimuthAngles: [] } : {}),
        ...(input.payload.contactWidths ? { contactWidths: [] } : {}),
        ...(input.payload.contactHeights ? { contactHeights: [] } : {}),
        ...(input.payload.sampleTimeOffsets ? { sampleTimeOffsets: [] } : {}),
      },
    };
  }

export function appendNormalizedSamples(host: StudioCrdtDocumentHost,
    record: Y.Map<unknown>,
    normalized: ReturnType<typeof normalizedSamples>
  ): void {
    const targets = new Map<StudioCrdtSampleArrayKey, Y.Array<number>>();
    for (const key of SAMPLE_ARRAY_KEYS) {
      const values = normalized[key];
      if (values === undefined) continue;
      let target = yArray(record, key);
      if (
        !target
        && (EXTENDED_INK_SAMPLE_ARRAY_KEYS as readonly string[]).includes(key)
      ) {
        host.doc.transact(
          () => record.set(key, createSampleArray([])),
          STUDIO_CRDT_ORIGIN_LOCAL,
        );
        target = yArray(record, key);
      }
      if (!target) throw new Error("획 샘플 배열이 손상되었습니다.");
      targets.set(key, target);
    }
    const sampleTotal = normalized.points.length / 2;
    for (let start = 0; start < sampleTotal; start += STUDIO_CRDT_REPLACE_CHUNK_SAMPLES) {
      const end = Math.min(sampleTotal, start + STUDIO_CRDT_REPLACE_CHUNK_SAMPLES);
      host.doc.transact(() => {
        for (const key of SAMPLE_ARRAY_KEYS) {
          const channel = normalized[key];
          if (channel === undefined) continue;
          const values = key === "points"
            ? normalized.points.slice(start * 2, end * 2)
            : channel.slice(start, end);
          targets.get(key)!.push(values);
        }
      }, STUDIO_CRDT_ORIGIN_LOCAL);
    }
  }

export function createRecord(host: StudioCrdtDocumentHost,
    input: StudioCrdtStrokeInput,
    status: StudioCrdtStrokeRecord["status"]
  ): Y.Map<unknown> {
    const record = new Y.Map<unknown>();
    record.set("id", input.id);
    record.set("pageId", input.pageId);
    record.set("layerId", input.layerId);
    record.set("status", status);
    setPayloadMetadata(record, input.payload);
    const samples = normalizedSamples(input.payload, true);
    for (const key of SAMPLE_ARRAY_KEYS) {
      const values = samples[key];
      if (values !== undefined) record.set(key, createSampleArray(values));
    }
    // Do not inspect/register this preliminary Y.Map yet. `strokes.set` integrates it and the
    // root observer registers every nested sample array without triggering Yjs detached-read
    // warnings.
    return record;
  }

export function requiredStroke(host: StudioCrdtDocumentHost, id: string): StudioCrdtStrokeRecord {
    const result = getStroke(host, id, true);
    if (!result) throw new Error("CRDT 획을 읽지 못했습니다.");
    return result;
  }
