import * as Y from "yjs";

import {
  createStudioShared3dStageCollectionDocument,
  migrateStudioShared3dStageCollectionDocument,
  type StudioShared3dStageCollectionDocument,
  type StudioShared3dStageEntry,
  type StudioShared3dStagePersistedState,
  type StudioShared3dStageVisibilityReceipt,
} from "../studio-shared-3d-stage-collection";

import { MAX_ID_LENGTH } from "./studio-crdt-document-constants";
import { assertId, exactText } from "./studio-crdt-document-helpers";
import { assertAlive, type StudioCrdtDocumentHost } from "./studio-crdt-document-host";
import { changedPageIdsFor } from "./studio-crdt-document-tracking";
import {
  STUDIO_CRDT_ORIGIN_LOCAL,
  STUDIO_CRDT_UPDATE_MAX_BYTES,
} from "./studio-crdt-protocol";

import type { StudioCrdtPageRecord } from "./studio-crdt-document-types";

export const STUDIO_CRDT_SHARED_3D_STAGE_RECORDS_ROOT =
  "studio-shared-3d-stage-records-v1" as const;
export const STUDIO_CRDT_SHARED_3D_STAGE_VISIBILITY_RECEIPTS_ROOT =
  "studio-shared-3d-stage-visibility-receipts-v1" as const;
export const STUDIO_CRDT_SHARED_3D_STAGE_RECORD_ROOT_PREFIX =
  "studio-shared-3d-stage-record:" as const;
export const STUDIO_CRDT_SHARED_3D_STAGE_VISIBILITY_RECEIPT_ROOT_PREFIX =
  "studio-shared-3d-stage-visibility-receipt:" as const;
export const STUDIO_CRDT_SHARED_3D_STAGE_PAYLOAD_VERSION = 1 as const;

const MAX_SIDECAR_RECORDS = 100_000;
export const STUDIO_CRDT_SHARED_3D_STAGE_MAX_GENERATION_EVENTS_PER_RECORD = 256;
const UPDATE_ENCODING_HEADROOM_BYTES = 64;
const SAFE_ENTRY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u;
const FORBIDDEN_ENTRY_IDS = new Set(["__proto__", "constructor", "prototype"]);
const MODEL_RUNTIME_KEY_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}:sha256:[a-f0-9]{64}$/u;
const STAGE_RECORD_REQUIRED_KEYS = new Set([
  "pageId",
  "stageId",
  "payloadVersion",
  "order",
  "payload",
]);
const RECEIPT_RECORD_REQUIRED_KEYS = new Set([
  "pageId",
  "elementId",
  "payloadVersion",
  "modelRuntimeKey",
]);
const GENERATION_EVENT_KEY_PATTERN = /^(activate|deactivate):(0|[1-9][0-9]*)$/u;

export interface StudioCrdtShared3dStagePageState {
  readonly pageId: string;
  /** Includes pages represented only by inactive tombstones. */
  readonly managed: boolean;
  /** Canonical active aggregate. Tombstone-only pages have no value. */
  readonly value: StudioShared3dStageCollectionDocument | undefined;
}

interface ParsedStageRecord {
  readonly compositeKey: string;
  readonly pageId: string;
  readonly stageId: string;
  readonly activationGeneration: number | undefined;
  readonly deactivationGeneration: number | undefined;
  readonly generationEventKeys: readonly string[];
  readonly active: boolean;
  readonly order: number;
  readonly payload: string;
  readonly entry: StudioShared3dStageEntry;
}

interface ParsedReceiptRecord {
  readonly compositeKey: string;
  readonly pageId: string;
  readonly elementId: string;
  readonly activationGeneration: number | undefined;
  readonly deactivationGeneration: number | undefined;
  readonly generationEventKeys: readonly string[];
  readonly active: boolean;
  readonly modelRuntimeKey: string;
}

interface ParsedRegistry {
  readonly stages: readonly ParsedStageRecord[];
  readonly receipts: readonly ParsedReceiptRecord[];
}

interface StageMutation {
  readonly kind: "add" | "update" | "delete";
  readonly pageId: string;
  readonly stageId: string;
  readonly entry: StudioShared3dStageEntry;
  readonly order: number;
  readonly relatedElementIds: ReadonlySet<string>;
}

interface ReceiptMutation {
  readonly kind: "add" | "update" | "delete";
  readonly pageId: string;
  readonly elementId: string;
  readonly modelRuntimeKey: string;
}

interface MutationGroup {
  readonly stage?: StageMutation;
  readonly receipts: readonly ReceiptMutation[];
}

export interface StudioCrdtShared3dStagePublishOptions {
  /** Page deletion owns a destructive tombstone sweep; ordinary undefined/undefined is a no-op. */
  readonly pageDeleted?: boolean;
}

function rawTextCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Length-prefixes use JavaScript string length (UTF-16 code units), matching Yjs/map keys and the
 * existing layer-group composite-key contract. Both parser slices therefore also use code units.
 */
export function studioCrdtShared3dStageCompositeKey(pageId: string, entryId: string): string {
  assertId(pageId, "페이지");
  assertId(entryId, "공유 3D 장면 항목");
  return `${pageId.length}:${pageId}${entryId.length}:${entryId}`;
}

export function parseStudioCrdtShared3dStageCompositeKey(
  value: unknown,
): Readonly<{ pageId: string; entryId: string }> | null {
  if (typeof value !== "string") return null;
  const firstColon = value.indexOf(":");
  if (firstColon <= 0) return null;
  const pageLengthText = value.slice(0, firstColon);
  if (!/^[1-9][0-9]*$/u.test(pageLengthText)) return null;
  const pageLength = Number(pageLengthText);
  if (!Number.isSafeInteger(pageLength) || pageLength > MAX_ID_LENGTH) return null;
  const pageStart = firstColon + 1;
  const pageEnd = pageStart + pageLength;
  if (pageEnd >= value.length) return null;
  const secondColon = value.indexOf(":", pageEnd);
  if (secondColon <= pageEnd) return null;
  const entryLengthText = value.slice(pageEnd, secondColon);
  if (!/^[1-9][0-9]*$/u.test(entryLengthText)) return null;
  const entryLength = Number(entryLengthText);
  if (!Number.isSafeInteger(entryLength) || entryLength > MAX_ID_LENGTH) return null;
  const entryStart = secondColon + 1;
  if (entryStart + entryLength !== value.length) return null;
  const pageId = value.slice(pageStart, pageEnd);
  const entryId = value.slice(entryStart);
  if (!exactText(pageId, MAX_ID_LENGTH) || !exactText(entryId, MAX_ID_LENGTH)) return null;
  return studioCrdtShared3dStageCompositeKey(pageId, entryId) === value
    ? Object.freeze({ pageId, entryId })
    : null;
}

export function studioCrdtShared3dStageRecordRootName(compositeKey: string): string {
  if (!parseStudioCrdtShared3dStageCompositeKey(compositeKey)) {
    throw new Error("공유 3D 장면 Stage composite key가 올바르지 않습니다.");
  }
  return `${STUDIO_CRDT_SHARED_3D_STAGE_RECORD_ROOT_PREFIX}${encodeURIComponent(compositeKey)}`;
}

export function studioCrdtShared3dStageVisibilityReceiptRootName(compositeKey: string): string {
  if (!parseStudioCrdtShared3dStageCompositeKey(compositeKey)) {
    throw new Error("공유 3D 장면 영수증 composite key가 올바르지 않습니다.");
  }
  return `${STUDIO_CRDT_SHARED_3D_STAGE_VISIBILITY_RECEIPT_ROOT_PREFIX}${encodeURIComponent(compositeKey)}`;
}

function compositeKeyFromDynamicRoot(rootName: string, prefix: string): string | null {
  if (!rootName.startsWith(prefix)) return null;
  let compositeKey: string;
  try {
    compositeKey = decodeURIComponent(rootName.slice(prefix.length));
  } catch {
    return null;
  }
  return parseStudioCrdtShared3dStageCompositeKey(compositeKey)
    && `${prefix}${encodeURIComponent(compositeKey)}` === rootName
    ? compositeKey
    : null;
}

function hasExactRecordKeys(record: Y.Map<unknown>, required: ReadonlySet<string>): boolean {
  for (const key of required) if (!record.has(key)) return false;
  let eventCount = 0;
  for (const key of record.keys()) {
    if (required.has(key)) continue;
    if (!GENERATION_EVENT_KEY_PATTERN.test(key) || record.get(key) !== true) return false;
    eventCount += 1;
  }
  return eventCount > 0
    && eventCount <= STUDIO_CRDT_SHARED_3D_STAGE_MAX_GENERATION_EVENTS_PER_RECORD
    && record.size === required.size + eventCount;
}

function generationState(record: Y.Map<unknown>): {
  readonly activationGeneration: number | undefined;
  readonly deactivationGeneration: number | undefined;
  readonly generationEventKeys: readonly string[];
  readonly active: boolean;
} | null {
  let activationGeneration: number | undefined;
  let deactivationGeneration: number | undefined;
  const generationEventKeys: string[] = [];
  const activations = new Set<number>();
  const deactivations = new Set<number>();
  for (const [key, value] of record) {
    if (value !== true) continue;
    const match = GENERATION_EVENT_KEY_PATTERN.exec(key);
    if (!match) continue;
    generationEventKeys.push(key);
    const parsed = Number(match[2]);
    if (!Number.isSafeInteger(parsed) || parsed > 255) return null;
    if (match[1] === "activate") {
      activations.add(parsed);
      activationGeneration = Math.max(activationGeneration ?? -1, parsed);
    } else {
      deactivations.add(parsed);
      deactivationGeneration = Math.max(deactivationGeneration ?? -1, parsed);
    }
  }
  if (activationGeneration === undefined && deactivationGeneration === undefined) return null;
  for (const value of activations) {
    if (value > 0 && !deactivations.has(value - 1)) return null;
  }
  for (const value of deactivations) {
    if (value > 0 && !activations.has(value)) return null;
  }
  return {
    activationGeneration,
    deactivationGeneration,
    generationEventKeys: Object.freeze(generationEventKeys.sort(rawTextCompare)),
    active: activationGeneration !== undefined
      && activationGeneration > (deactivationGeneration ?? -1),
  };
}

function parseStagePayload(payload: unknown): StudioShared3dStageEntry | null {
  if (typeof payload !== "string") return null;
  let candidate: unknown;
  try {
    candidate = JSON.parse(payload);
  } catch {
    return null;
  }
  const collection = createStudioShared3dStageCollectionDocument({
    stages: [candidate as StudioShared3dStageEntry],
    visibilityReceipts: [],
  });
  const entry = collection?.stages[0];
  return entry && JSON.stringify(entry) === payload ? entry : null;
}

function parseStageRecord(compositeKey: string, value: unknown): ParsedStageRecord {
  const key = parseStudioCrdtShared3dStageCompositeKey(compositeKey);
  if (
    !(value instanceof Y.Map)
    || value.doc === null
    || !key
    || !hasExactRecordKeys(value, STAGE_RECORD_REQUIRED_KEYS)
  ) {
    throw new Error("공유 3D 장면 CRDT Stage 레코드가 손상되었습니다.");
  }
  const pageId = value.get("pageId");
  const stageId = value.get("stageId");
  const generations = generationState(value);
  const order = value.get("order");
  const payload = value.get("payload");
  const entry = parseStagePayload(payload);
  if (
    value.get("payloadVersion") !== STUDIO_CRDT_SHARED_3D_STAGE_PAYLOAD_VERSION
    || pageId !== key.pageId
    || stageId !== key.entryId
    || entry?.id !== stageId
    || !generations
    || (
      generations.active
      && generations.generationEventKeys.length ===
        STUDIO_CRDT_SHARED_3D_STAGE_MAX_GENERATION_EVENTS_PER_RECORD
    )
    || typeof order !== "number"
    || !Number.isSafeInteger(order)
    || order < 0
    || typeof payload !== "string"
    || !entry
  ) {
    throw new Error("공유 3D 장면 CRDT Stage 레코드가 손상되었습니다.");
  }
  return Object.freeze({ compositeKey, pageId, stageId, ...generations, order, payload, entry });
}

function parseReceiptRecord(compositeKey: string, value: unknown): ParsedReceiptRecord {
  const key = parseStudioCrdtShared3dStageCompositeKey(compositeKey);
  if (
    !(value instanceof Y.Map)
    || value.doc === null
    || !key
    || !hasExactRecordKeys(value, RECEIPT_RECORD_REQUIRED_KEYS)
  ) {
    throw new Error("공유 3D 장면 CRDT 가시성 영수증이 손상되었습니다.");
  }
  const pageId = value.get("pageId");
  const elementId = value.get("elementId");
  const generations = generationState(value);
  const modelRuntimeKey = value.get("modelRuntimeKey");
  if (
    value.get("payloadVersion") !== STUDIO_CRDT_SHARED_3D_STAGE_PAYLOAD_VERSION
    || pageId !== key.pageId
    || elementId !== key.entryId
    || typeof elementId !== "string"
    || !SAFE_ENTRY_ID_PATTERN.test(elementId)
    || FORBIDDEN_ENTRY_IDS.has(elementId.toLowerCase())
    || !generations
    || (
      generations.active
      && generations.generationEventKeys.length ===
        STUDIO_CRDT_SHARED_3D_STAGE_MAX_GENERATION_EVENTS_PER_RECORD
    )
    || !exactText(modelRuntimeKey, 200)
    || !MODEL_RUNTIME_KEY_PATTERN.test(modelRuntimeKey)
    || !modelRuntimeKey.startsWith(`${elementId}:sha256:`)
  ) {
    throw new Error("공유 3D 장면 CRDT 가시성 영수증이 손상되었습니다.");
  }
  return Object.freeze({ compositeKey, pageId, elementId, ...generations, modelRuntimeKey });
}

function readRegistry(
  doc: Y.Doc,
  stageRoot: Y.Map<boolean>,
  receiptRoot: Y.Map<boolean>,
): ParsedRegistry {
  if (stageRoot.size > MAX_SIDECAR_RECORDS || receiptRoot.size > MAX_SIDECAR_RECORDS) {
    throw new Error("공유 3D 장면 CRDT sidecar 항목 수가 허용 한도를 초과했습니다.");
  }
  const stages = [...stageRoot].map(([key, indexed]) => {
    if (indexed !== true) throw new Error("공유 3D 장면 CRDT Stage 인덱스가 손상되었습니다.");
    const rootName = studioCrdtShared3dStageRecordRootName(key);
    let value: Y.Map<unknown>;
    try {
      value = doc.getMap<unknown>(rootName);
    } catch {
      throw new Error("공유 3D 장면 CRDT Stage root 형식이 손상되었습니다.");
    }
    return parseStageRecord(key, value);
  });
  const receipts = [...receiptRoot].map(([key, indexed]) => {
    if (indexed !== true) throw new Error("공유 3D 장면 CRDT 영수증 인덱스가 손상되었습니다.");
    const rootName = studioCrdtShared3dStageVisibilityReceiptRootName(key);
    let value: Y.Map<unknown>;
    try {
      value = doc.getMap<unknown>(rootName);
    } catch {
      throw new Error("공유 3D 장면 CRDT 영수증 root 형식이 손상되었습니다.");
    }
    return parseReceiptRecord(key, value);
  });
  const totalEventCount = [...stages, ...receipts].reduce(
    (total, record) => total + record.generationEventKeys.length,
    0,
  );
  if (totalEventCount > MAX_SIDECAR_RECORDS) {
    throw new Error("공유 3D 장면 CRDT generation 이벤트 총량이 허용 한도를 초과했습니다.");
  }
  for (const rootName of doc.share.keys()) {
    const stageKey = compositeKeyFromDynamicRoot(rootName, STUDIO_CRDT_SHARED_3D_STAGE_RECORD_ROOT_PREFIX);
    if (stageKey !== null && stageRoot.get(stageKey) !== true) {
      throw new Error("인덱스에 없는 공유 3D 장면 Stage root가 있습니다.");
    }
    const receiptKey = compositeKeyFromDynamicRoot(
      rootName,
      STUDIO_CRDT_SHARED_3D_STAGE_VISIBILITY_RECEIPT_ROOT_PREFIX,
    );
    if (receiptKey !== null && receiptRoot.get(receiptKey) !== true) {
      throw new Error("인덱스에 없는 공유 3D 장면 영수증 root가 있습니다.");
    }
    if (
      (rootName.startsWith(STUDIO_CRDT_SHARED_3D_STAGE_RECORD_ROOT_PREFIX) && stageKey === null)
      || (rootName.startsWith(STUDIO_CRDT_SHARED_3D_STAGE_VISIBILITY_RECEIPT_ROOT_PREFIX)
        && receiptKey === null)
    ) {
      throw new Error("공유 3D 장면 dynamic root 이름이 손상되었습니다.");
    }
  }
  return Object.freeze({
    stages: Object.freeze(stages),
    receipts: Object.freeze(receipts),
  });
}

function registryPageStates(registry: ParsedRegistry): readonly StudioCrdtShared3dStagePageState[] {
  const stagesByPageId = new Map<string, ParsedStageRecord[]>();
  const receiptsByPageId = new Map<string, ParsedReceiptRecord[]>();
  for (const record of registry.stages) {
    const pageRecords = stagesByPageId.get(record.pageId) ?? [];
    pageRecords.push(record);
    stagesByPageId.set(record.pageId, pageRecords);
  }
  for (const record of registry.receipts) {
    const pageRecords = receiptsByPageId.get(record.pageId) ?? [];
    pageRecords.push(record);
    receiptsByPageId.set(record.pageId, pageRecords);
  }
  const pageIds = new Set([...stagesByPageId.keys(), ...receiptsByPageId.keys()]);
  return Object.freeze([...pageIds].sort(rawTextCompare).map((pageId) => {
    const pageStageRecords = stagesByPageId.get(pageId) ?? [];
    const pageReceiptRecords = receiptsByPageId.get(pageId) ?? [];
    if (pageStageRecords.length === 0 && pageReceiptRecords.length > 0) {
      throw new Error("공유 3D 장면 CRDT 영수증에 연결된 Stage 기록이 없습니다.");
    }
    const stages = pageStageRecords
      .filter((record) => record.active)
      .sort((left, right) => left.order - right.order || rawTextCompare(left.stageId, right.stageId))
      .map((record) => record.entry);
    const activeCharacterAuthorities = new Set(stages.flatMap((stage) =>
      stage.characters.map((character) =>
        `${character.elementId}\0${character.modelRuntimeKey}`)));
    // A receipt created concurrently with a Stage unlink is retained as grow-only history but is
    // dormant until an active Stage actually owns the same character runtime. Throwing here would
    // make an otherwise valid remove-wins merge unreadable (or force the server to reject whichever
    // peer arrived second).
    const receipts = pageReceiptRecords
      .filter((record) => record.active && activeCharacterAuthorities.has(
        `${record.elementId}\0${record.modelRuntimeKey}`
      ))
      .sort((left, right) => rawTextCompare(left.elementId, right.elementId))
      .map(({ elementId, modelRuntimeKey }) => ({ elementId, modelRuntimeKey }));
    if (stages.length === 0) {
      return Object.freeze({
        pageId,
        managed: true,
        value: undefined,
      });
    }
    const value = createStudioShared3dStageCollectionDocument({
      stages,
      visibilityReceipts: receipts,
    });
    if (!value) throw new Error("공유 3D 장면 CRDT sidecar aggregate가 손상되었습니다.");
    return Object.freeze({ pageId, managed: true, value });
  }));
}

export function getShared3dStageFrontier(
  host: StudioCrdtDocumentHost,
): readonly StudioCrdtShared3dStagePageState[] {
  assertAlive(host);
  return registryPageStates(readRegistry(
    host.doc,
    host.shared3dStageRecords,
    host.shared3dStageVisibilityReceipts,
  ));
}

export function getShared3dStagePageState(
  host: StudioCrdtDocumentHost,
  pageId: string,
): StudioCrdtShared3dStagePageState {
  assertId(pageId, "페이지");
  const state = getShared3dStageFrontier(host).find((candidate) => candidate.pageId === pageId);
  return state ?? Object.freeze({
    pageId,
    managed: false,
    value: undefined,
  });
}

export function decoratePageWithShared3dStage(
  host: StudioCrdtDocumentHost,
  page: StudioCrdtPageRecord,
  precomputedState?: StudioCrdtShared3dStagePageState,
): StudioCrdtPageRecord {
  const state = precomputedState ?? getShared3dStagePageState(host, page.id);
  if (state.pageId !== page.id) {
    throw new Error("공유 3D 장면 page cache 상태가 다른 페이지를 가리킵니다.");
  }
  const { shared3dStage: _ignored, ...base } = page;
  const decorated = {
    ...base,
    shared3dStageManaged: state.managed,
  };
  return state.value ? { ...decorated, shared3dStage: state.value } : decorated;
}

function canonicalCollection(
  value: StudioShared3dStagePersistedState | undefined,
  label: string,
): StudioShared3dStageCollectionDocument | undefined {
  if (value === undefined) return undefined;
  const collection = migrateStudioShared3dStageCollectionDocument(value);
  if (!collection) throw new Error(`${label} 공유 3D 장면 상태가 손상되었습니다.`);
  return collection;
}

function stageMap(collection: StudioShared3dStageCollectionDocument | undefined): ReadonlyMap<string, {
  readonly entry: StudioShared3dStageEntry;
  readonly order: number;
  readonly payload: string;
}> {
  return new Map((collection?.stages ?? []).map((entry, order) => [
    entry.id,
    Object.freeze({ entry, order, payload: JSON.stringify(entry) }),
  ]));
}

function receiptMap(
  collection: StudioShared3dStageCollectionDocument | undefined,
): ReadonlyMap<string, StudioShared3dStageVisibilityReceipt> {
  return new Map((collection?.visibilityReceipts ?? []).map((receipt) => [
    receipt.elementId,
    receipt,
  ]));
}

function mutationGroups(
  pageId: string,
  previous: StudioShared3dStageCollectionDocument | undefined,
  next: StudioShared3dStageCollectionDocument | undefined,
): readonly MutationGroup[] {
  const previousStages = stageMap(previous);
  const nextStages = stageMap(next);
  const stageIds = new Set([...previousStages.keys(), ...nextStages.keys()]);
  const stageMutations: StageMutation[] = [];
  for (const stageId of stageIds) {
    const before = previousStages.get(stageId);
    const after = nextStages.get(stageId);
    if (!before && !after) continue;
    const relatedElementIds = new Set([
      ...(before?.entry.characters.map(({ elementId }) => elementId) ?? []),
      ...(after?.entry.characters.map(({ elementId }) => elementId) ?? []),
    ]);
    if (!before && after) {
      stageMutations.push({
        kind: "add", pageId, stageId, entry: after.entry, order: after.order, relatedElementIds,
      });
    } else if (before && !after) {
      stageMutations.push({
        kind: "delete", pageId, stageId, entry: before.entry, order: before.order, relatedElementIds,
      });
    } else if (before && after && (before.payload !== after.payload || before.order !== after.order)) {
      stageMutations.push({
        kind: "update", pageId, stageId, entry: after.entry, order: after.order, relatedElementIds,
      });
    }
  }
  stageMutations.sort((left, right) => left.order - right.order || rawTextCompare(left.stageId, right.stageId));

  const previousReceipts = receiptMap(previous);
  const nextReceipts = receiptMap(next);
  const receiptIds = new Set([...previousReceipts.keys(), ...nextReceipts.keys()]);
  const receiptMutations = new Map<string, ReceiptMutation>();
  for (const elementId of receiptIds) {
    const before = previousReceipts.get(elementId);
    const after = nextReceipts.get(elementId);
    if (!before && after) {
      receiptMutations.set(elementId, {
        kind: "add", pageId, elementId, modelRuntimeKey: after.modelRuntimeKey,
      });
    } else if (before && !after) {
      receiptMutations.set(elementId, {
        kind: "delete", pageId, elementId, modelRuntimeKey: before.modelRuntimeKey,
      });
    } else if (before && after && before.modelRuntimeKey !== after.modelRuntimeKey) {
      receiptMutations.set(elementId, {
        kind: "update", pageId, elementId, modelRuntimeKey: after.modelRuntimeKey,
      });
    }
  }

  const groups: MutationGroup[] = [];
  for (const stage of stageMutations) {
    const receipts: ReceiptMutation[] = [];
    for (const elementId of stage.relatedElementIds) {
      const receipt = receiptMutations.get(elementId);
      if (!receipt) continue;
      receipts.push(receipt);
      receiptMutations.delete(elementId);
    }
    groups.push(Object.freeze({ stage, receipts: Object.freeze(receipts) }));
  }
  for (const receipt of [...receiptMutations.values()].sort((left, right) =>
    rawTextCompare(left.elementId, right.elementId))) {
    groups.push(Object.freeze({ receipts: Object.freeze([receipt]) }));
  }
  return Object.freeze(groups);
}

function setIfChanged(record: Y.Map<unknown>, key: string, value: unknown): void {
  if (record.get(key) !== value) record.set(key, value);
}

function writeStageRecord(
  record: Y.Map<unknown>,
  entry: StageMutation,
  activate: boolean,
): void {
  record.set("pageId", entry.pageId);
  record.set("stageId", entry.stageId);
  record.set("payloadVersion", STUDIO_CRDT_SHARED_3D_STAGE_PAYLOAD_VERSION);
  record.set("order", entry.order);
  record.set("payload", JSON.stringify(entry.entry));
  record.set(activate ? "activate:0" : "deactivate:0", true);
}

function writeReceiptRecord(
  record: Y.Map<unknown>,
  entry: ReceiptMutation,
  activate: boolean,
): void {
  record.set("pageId", entry.pageId);
  record.set("elementId", entry.elementId);
  record.set("payloadVersion", STUDIO_CRDT_SHARED_3D_STAGE_PAYLOAD_VERSION);
  record.set("modelRuntimeKey", entry.modelRuntimeKey);
  record.set(activate ? "activate:0" : "deactivate:0", true);
}

function activateRecord(record: Y.Map<unknown>): void {
  const state = generationState(record);
  if (!state) throw new Error("공유 3D 장면 generation 기록이 손상되었습니다.");
  if (state.active) return;
  const generation = Math.max(
    state.activationGeneration ?? -1,
    state.deactivationGeneration ?? -1,
  ) + 1;
  if (
    generation > 255
    || state.generationEventKeys.length >=
      STUDIO_CRDT_SHARED_3D_STAGE_MAX_GENERATION_EVENTS_PER_RECORD - 1
  ) {
    throw new Error("공유 3D 장면 generation이 허용 한도를 초과했습니다.");
  }
  record.set(`activate:${generation}`, true);
}

function deactivateRecord(record: Y.Map<unknown>): void {
  const state = generationState(record);
  if (!state) throw new Error("공유 3D 장면 generation 기록이 손상되었습니다.");
  if (!state.active) return;
  if (
    state.activationGeneration! > 255
    || state.generationEventKeys.length >=
      STUDIO_CRDT_SHARED_3D_STAGE_MAX_GENERATION_EVENTS_PER_RECORD
  ) {
    throw new Error("공유 3D 장면 generation이 허용 한도를 초과했습니다.");
  }
  record.set(`deactivate:${state.activationGeneration!}`, true);
}

function applyMutationGroup(
  doc: Y.Doc,
  stageRoot: Y.Map<boolean>,
  receiptRoot: Y.Map<boolean>,
  group: MutationGroup,
): void {
  const stage = group.stage;
  if (stage) {
    const key = studioCrdtShared3dStageCompositeKey(stage.pageId, stage.stageId);
    const indexed = stageRoot.get(key);
    const rootName = studioCrdtShared3dStageRecordRootName(key);
    const existing = doc.share.has(rootName) ? doc.getMap<unknown>(rootName) : undefined;
    if (indexed !== true) {
      if (indexed !== undefined || existing !== undefined) {
        throw new Error("공유 3D 장면 Stage 인덱스가 손상되었습니다.");
      }
      const record = doc.getMap<unknown>(rootName);
      writeStageRecord(record, stage, stage.kind !== "delete");
      stageRoot.set(key, true);
    } else if (stage.kind === "delete") {
      if (!(existing instanceof Y.Map)) throw new Error("공유 3D 장면 Stage root가 손상되었습니다.");
      deactivateRecord(existing);
    } else {
      if (!(existing instanceof Y.Map)) throw new Error("공유 3D 장면 Stage root가 손상되었습니다.");
      setIfChanged(existing, "order", stage.order);
      setIfChanged(existing, "payload", JSON.stringify(stage.entry));
      if (stage.kind === "add") activateRecord(existing);
    }
  }
  for (const receipt of group.receipts) {
    const key = studioCrdtShared3dStageCompositeKey(receipt.pageId, receipt.elementId);
    const indexed = receiptRoot.get(key);
    const rootName = studioCrdtShared3dStageVisibilityReceiptRootName(key);
    const existing = doc.share.has(rootName) ? doc.getMap<unknown>(rootName) : undefined;
    if (indexed !== true) {
      if (indexed !== undefined || existing !== undefined) {
        throw new Error("공유 3D 장면 영수증 인덱스가 손상되었습니다.");
      }
      const record = doc.getMap<unknown>(rootName);
      writeReceiptRecord(record, receipt, receipt.kind !== "delete");
      receiptRoot.set(key, true);
    } else if (receipt.kind === "delete") {
      if (!(existing instanceof Y.Map)) throw new Error("공유 3D 장면 영수증 root가 손상되었습니다.");
      deactivateRecord(existing);
    } else {
      if (!(existing instanceof Y.Map)) throw new Error("공유 3D 장면 영수증 root가 손상되었습니다.");
      setIfChanged(existing, "modelRuntimeKey", receipt.modelRuntimeKey);
      if (receipt.kind === "add") activateRecord(existing);
    }
  }
}

function copyRegistryToProbe(registry: ParsedRegistry): {
  readonly doc: Y.Doc;
  readonly stageRoot: Y.Map<boolean>;
  readonly receiptRoot: Y.Map<boolean>;
} {
  const doc = new Y.Doc();
  const stageRoot = doc.getMap<boolean>(STUDIO_CRDT_SHARED_3D_STAGE_RECORDS_ROOT);
  const receiptRoot = doc.getMap<boolean>(
    STUDIO_CRDT_SHARED_3D_STAGE_VISIBILITY_RECEIPTS_ROOT,
  );
  doc.transact(() => {
    for (const stage of registry.stages) {
      const record = doc.getMap<unknown>(studioCrdtShared3dStageRecordRootName(stage.compositeKey));
      record.set("pageId", stage.pageId);
      record.set("stageId", stage.stageId);
      record.set("payloadVersion", STUDIO_CRDT_SHARED_3D_STAGE_PAYLOAD_VERSION);
      record.set("order", stage.order);
      record.set("payload", stage.payload);
      for (const eventKey of stage.generationEventKeys) record.set(eventKey, true);
      stageRoot.set(stage.compositeKey, true);
    }
    for (const receipt of registry.receipts) {
      const record = doc.getMap<unknown>(
        studioCrdtShared3dStageVisibilityReceiptRootName(receipt.compositeKey),
      );
      record.set("pageId", receipt.pageId);
      record.set("elementId", receipt.elementId);
      record.set("payloadVersion", STUDIO_CRDT_SHARED_3D_STAGE_PAYLOAD_VERSION);
      record.set("modelRuntimeKey", receipt.modelRuntimeKey);
      for (const eventKey of receipt.generationEventKeys) record.set(eventKey, true);
      receiptRoot.set(receipt.compositeKey, true);
    }
  });
  return { doc, stageRoot, receiptRoot };
}

function applyTransactionGroup(
  doc: Y.Doc,
  stageRoot: Y.Map<boolean>,
  receiptRoot: Y.Map<boolean>,
  groups: readonly MutationGroup[],
): void {
  for (const group of groups) applyMutationGroup(doc, stageRoot, receiptRoot, group);
}

function preflightTransactionGroups(
  registry: ParsedRegistry,
  groups: readonly MutationGroup[],
): readonly (readonly MutationGroup[])[] {
  if (groups.length === 0) return Object.freeze([]);

  // Prefer one page-atomic update. Besides being smaller, this keeps a receipt valid when its
  // authority moves from one changed Stage to another in the same local edit.
  const combinedProbe = copyRegistryToProbe(registry);
  try {
    const before = Y.encodeStateVector(combinedProbe.doc);
    combinedProbe.doc.transact(() => applyTransactionGroup(
      combinedProbe.doc,
      combinedProbe.stageRoot,
      combinedProbe.receiptRoot,
      groups,
    ), STUDIO_CRDT_ORIGIN_LOCAL);
    registryPageStates(readRegistry(
      combinedProbe.doc,
      combinedProbe.stageRoot,
      combinedProbe.receiptRoot,
    ));
    const update = Y.encodeStateAsUpdate(combinedProbe.doc, before);
    if (update.byteLength <= STUDIO_CRDT_UPDATE_MAX_BYTES - UPDATE_ENCODING_HEADROOM_BYTES) {
      return Object.freeze([Object.freeze([...groups])]);
    }
  } finally {
    combinedProbe.doc.destroy();
  }

  // Large bootstraps/deletions fall back to one Stage plus its related receipt changes. Every
  // intermediate update is independently strict-read because the server admits each one alone.
  const probe = copyRegistryToProbe(registry);
  const transactionGroups: Array<readonly MutationGroup[]> = [];
  try {
    const remaining = [...groups];
    while (remaining.length > 0) {
      const snapshot = Y.encodeStateAsUpdate(probe.doc);
      let selectedIndex = -1;
      let lastError: unknown;
      for (let index = 0; index < remaining.length; index += 1) {
        const candidate = new Y.Doc();
        try {
          Y.applyUpdate(candidate, snapshot);
          const candidateStages = candidate.getMap<boolean>(
            STUDIO_CRDT_SHARED_3D_STAGE_RECORDS_ROOT,
          );
          const candidateReceipts = candidate.getMap<boolean>(
            STUDIO_CRDT_SHARED_3D_STAGE_VISIBILITY_RECEIPTS_ROOT,
          );
          const before = Y.encodeStateVector(candidate);
          candidate.transact(() => applyMutationGroup(
            candidate,
            candidateStages,
            candidateReceipts,
            remaining[index]!,
          ), STUDIO_CRDT_ORIGIN_LOCAL);
          registryPageStates(readRegistry(candidate, candidateStages, candidateReceipts));
          const update = Y.encodeStateAsUpdate(candidate, before);
          if (update.byteLength <= STUDIO_CRDT_UPDATE_MAX_BYTES - UPDATE_ENCODING_HEADROOM_BYTES) {
            selectedIndex = index;
            break;
          }
          lastError = new Error("공유 3D 장면 CRDT 증분 업데이트가 48KiB 한도를 초과했습니다.");
        } catch (error) {
          lastError = error;
        } finally {
          candidate.destroy();
        }
      }
      if (selectedIndex < 0) {
        throw lastError instanceof Error
          ? lastError
          : new Error("공유 3D 장면 변경을 유효한 증분 업데이트로 분할할 수 없습니다.");
      }
      const group = remaining.splice(selectedIndex, 1)[0]!;
      const before = Y.encodeStateVector(probe.doc);
      probe.doc.transact(
        () => applyMutationGroup(probe.doc, probe.stageRoot, probe.receiptRoot, group),
        STUDIO_CRDT_ORIGIN_LOCAL,
      );
      const update = Y.encodeStateAsUpdate(probe.doc, before);
      if (update.byteLength > STUDIO_CRDT_UPDATE_MAX_BYTES - UPDATE_ENCODING_HEADROOM_BYTES) {
        throw new Error("공유 3D 장면 CRDT 증분 업데이트가 48KiB 한도를 초과했습니다.");
      }
      registryPageStates(readRegistry(probe.doc, probe.stageRoot, probe.receiptRoot));
      transactionGroups.push(Object.freeze([group]));
    }
    return Object.freeze(transactionGroups);
  } finally {
    probe.doc.destroy();
  }
}

interface Shared3dStagePagePlan {
  readonly transactionGroups: readonly (readonly MutationGroup[])[];
}

function planShared3dStagePageDiff(
  host: StudioCrdtDocumentHost,
  pageId: string,
  previousValue: StudioShared3dStagePersistedState | undefined,
  nextValue: StudioShared3dStagePersistedState | undefined,
  options: StudioCrdtShared3dStagePublishOptions,
): Shared3dStagePagePlan {
  assertAlive(host);
  assertId(pageId, "페이지");
  const previous = canonicalCollection(previousValue, "이전");
  const next = canonicalCollection(nextValue, "다음");
  const registry = readRegistry(
    host.doc,
    host.shared3dStageRecords,
    host.shared3dStageVisibilityReceipts,
  );
  const currentStates = registryPageStates(registry);
  // Stage records alone establish ownership. Receipt-only roots are rejected above and can never
  // turn an otherwise unmanaged page into an owned page.
  const managed = registry.stages.some((record) => record.pageId === pageId);
  const currentState = currentStates.find((state) => state.pageId === pageId);
  const effectivePrevious = options.pageDeleted
    ? currentState?.value
    : managed
      ? previous
      : next !== undefined ? undefined : previous;
  const effectiveNext = options.pageDeleted ? undefined : next;
  const groups = mutationGroups(pageId, effectivePrevious, effectiveNext);
  return Object.freeze({ transactionGroups: preflightTransactionGroups(registry, groups) });
}

export function preflightShared3dStagePageDiff(
  host: StudioCrdtDocumentHost,
  pageId: string,
  previousValue: StudioShared3dStagePersistedState | undefined,
  nextValue: StudioShared3dStagePersistedState | undefined,
  options: StudioCrdtShared3dStagePublishOptions = {},
): void {
  planShared3dStagePageDiff(host, pageId, previousValue, nextValue, options);
}

export function publishShared3dStagePageDiff(
  host: StudioCrdtDocumentHost,
  pageId: string,
  previousValue: StudioShared3dStagePersistedState | undefined,
  nextValue: StudioShared3dStagePersistedState | undefined,
  options: StudioCrdtShared3dStagePublishOptions = {},
): StudioCrdtShared3dStagePageState {
  const plan = planShared3dStagePageDiff(host, pageId, previousValue, nextValue, options);
  for (const transactionGroup of plan.transactionGroups) {
    host.doc.transact(() => applyTransactionGroup(
      host.doc,
      host.shared3dStageRecords,
      host.shared3dStageVisibilityReceipts,
      transactionGroup,
    ), STUDIO_CRDT_ORIGIN_LOCAL);
  }
  return getShared3dStagePageState(host, pageId);
}

export function bindStudioCrdtShared3dStageObservers(host: StudioCrdtDocumentHost): void {
  const observeDynamicRoot = (
    compositeKey: string,
    kind: "stage" | "receipt",
  ) => {
    const parsed = parseStudioCrdtShared3dStageCompositeKey(compositeKey);
    if (!parsed) return;
    const rootName = kind === "stage"
      ? studioCrdtShared3dStageRecordRootName(compositeKey)
      : studioCrdtShared3dStageVisibilityReceiptRootName(compositeKey);
    const observed = kind === "stage"
      ? host.observedShared3dStageRoots
      : host.observedShared3dStageVisibilityReceiptRoots;
    if (observed.has(rootName)) return;
    if (!host.doc.share.has(rootName)) return;
    let root: Y.Map<unknown>;
    try {
      root = host.doc.getMap<unknown>(rootName);
    } catch {
      return;
    }
    const observer = (_event: Y.YMapEvent<unknown>, transaction: Y.Transaction) => {
      changedPageIdsFor(host, transaction).add(parsed.pageId);
    };
    root.observe(observer);
    observed.add(rootName);
    host.cleanup.add(() => {
      root.unobserve(observer);
      observed.delete(rootName);
    });
  };
  for (const [compositeKey, indexed] of host.shared3dStageRecords) {
    if (indexed === true) observeDynamicRoot(compositeKey, "stage");
  }
  for (const [compositeKey, indexed] of host.shared3dStageVisibilityReceipts) {
    if (indexed === true) observeDynamicRoot(compositeKey, "receipt");
  }
  const observeIndex = (
    root: Y.Map<boolean>,
    kind: "stage" | "receipt",
  ): Parameters<typeof root.observe>[0] => (event, transaction) => {
    const changedPageIds = changedPageIdsFor(host, transaction);
    for (const compositeKey of event.keysChanged) {
      const parsed = parseStudioCrdtShared3dStageCompositeKey(compositeKey);
      if (!parsed) continue;
      changedPageIds.add(parsed.pageId);
      if (root.get(compositeKey) === true) observeDynamicRoot(compositeKey, kind);
    }
  };
  const observeStages = observeIndex(host.shared3dStageRecords, "stage");
  const observeReceipts = observeIndex(host.shared3dStageVisibilityReceipts, "receipt");
  host.shared3dStageRecords.observe(observeStages);
  host.shared3dStageVisibilityReceipts.observe(observeReceipts);
  host.cleanup.add(() => host.shared3dStageRecords.unobserve(observeStages));
  host.cleanup.add(() => host.shared3dStageVisibilityReceipts.unobserve(observeReceipts));
}
