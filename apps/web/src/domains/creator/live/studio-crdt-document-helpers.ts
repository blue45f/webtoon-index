import * as Y from "yjs";

import {
  STUDIO_BRUSH_RENDER_PROVENANCE_LIMITS,
  parseStudioBrushRenderProvenanceCrdtSidecar,
  serializeStudioBrushRenderProvenanceCrdtSidecarCanonical,
  type StudioBrushRenderProvenanceCrdtSidecar,
} from "../brush/studio-brush-render-provenance";

import {
  BASELINE_PROPERTY_PREFIX,
  LAYER_GROUP_ROOT_PREFIX,
  MAX_DELETION_TARGET_LENGTH,
  MAX_ID_LENGTH,
  MAX_JSON_DEPTH,
  MAX_JSON_ENTRIES,
  MAX_JSON_STRING_LENGTH,
  MAX_TEXT_LENGTH,
  PAGE_ROOT_PREFIX,
  PROPERTY_PREFIX,
  RASTER_SAFE_ID_PATTERN,
  SCENE_ELEMENT_ROOT_PREFIX,
  TEXT_ENCODER,
  UNSET_PROPERTY_PREFIX,
  type StudioCrdtDeletionTarget,
} from "./studio-crdt-document-constants";

import type { StudioCrdtSampleArrayKey } from "./studio-crdt-document-types";
import type {
  StudioCrdtJsonObject,
  StudioCrdtJsonValue,
} from "./studio-crdt-scene-schema";

import {
  canonicalStudioRasterJson,
  type StudioRasterAssetReference,
} from "@/shared/lib/studio-crdt-raster-ops";

export function defaultSetTimeout(handler: () => void, delay: number): unknown {
  return globalThis.setTimeout(handler, delay);
}

export function defaultClearTimeout(handle: unknown): void {
  globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
}

export function exactText(value: unknown, maximum = MAX_TEXT_LENGTH): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) return false;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 31 || (codePoint >= 127 && codePoint <= 159)) return false;
  }
  return true;
}

export function assertId(value: unknown, label: string): asserts value is string {
  if (!exactText(value, MAX_ID_LENGTH)) throw new Error(`${label} 식별자가 올바르지 않습니다.`);
}

export function assertLayerGroupId(value: unknown): asserts value is string {
  assertId(value, "레이어 그룹");
  if (value === "page-root") throw new Error("page-root는 레이어 그룹 식별자로 사용할 수 없습니다.");
}

export function assertFiniteRange(value: unknown, minimum: number, maximum: number, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} 값이 허용 범위를 벗어났습니다.`);
  }
}

export function cloneAndValidateJson(
  value: StudioCrdtJsonValue,
  state = { entries: 0 },
  depth = 0
): StudioCrdtJsonValue {
  if (depth > MAX_JSON_DEPTH || ++state.entries > MAX_JSON_ENTRIES) {
    throw new Error("획 확장 데이터가 허용 범위를 벗어났습니다.");
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("획 확장 데이터에 유한하지 않은 수가 있습니다.");
    return value;
  }
  if (typeof value === "string") {
    if (value.length > MAX_JSON_STRING_LENGTH) throw new Error("획 확장 문자열이 너무 깁니다.");
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => cloneAndValidateJson(item, state, depth + 1));
  }
  if (typeof value !== "object") throw new Error("획 확장 데이터는 JSON 형식이어야 합니다.");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("획 확장 데이터는 일반 JSON 객체여야 합니다.");
  }
  const result: StudioCrdtJsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    if (!exactText(key, MAX_TEXT_LENGTH)) throw new Error("획 확장 데이터 키가 올바르지 않습니다.");
    result[key] = cloneAndValidateJson(item, state, depth + 1);
  }
  return result;
}

export function cloneJsonObject(value: StudioCrdtJsonObject): StudioCrdtJsonObject {
  const cloned = cloneAndValidateJson(value);
  if (!cloned || typeof cloned !== "object" || Array.isArray(cloned)) {
    throw new Error("획 확장 데이터는 JSON 객체여야 합니다.");
  }
  return cloned;
}

export function sceneElementRootName(id: string): string {
  return `${SCENE_ELEMENT_ROOT_PREFIX}${encodeURIComponent(id)}`;
}

export function pageRootName(id: string): string {
  return `${PAGE_ROOT_PREFIX}${encodeURIComponent(id)}`;
}

export function layerGroupRootName(compositeKey: string): string {
  return `${LAYER_GROUP_ROOT_PREFIX}${encodeURIComponent(compositeKey)}`;
}

export function encodeDeletionTarget(target: StudioCrdtDeletionTarget): string {
  return target.kind === "group"
    ? JSON.stringify([target.kind, target.pageId, target.id])
    : JSON.stringify([target.kind, target.id]);
}

export function strokeDeletionTarget(id: string): string {
  return encodeDeletionTarget({ kind: "stroke", id });
}

export function sceneDeletionTarget(id: string): string {
  return encodeDeletionTarget({ kind: "scene", id });
}

export function pageDeletionTarget(id: string): string {
  return encodeDeletionTarget({ kind: "page", id });
}

export function layerGroupDeletionTarget(pageId: string, id: string): string {
  return encodeDeletionTarget({ kind: "group", pageId, id });
}

export function parseDeletionTarget(value: unknown): StudioCrdtDeletionTarget | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_DELETION_TARGET_LENGTH) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    if (
      parsed.length === 2 &&
      (parsed[0] === "stroke" || parsed[0] === "scene" || parsed[0] === "page") &&
      exactText(parsed[1], MAX_ID_LENGTH)
    ) {
      const target = { kind: parsed[0], id: parsed[1] } satisfies StudioCrdtDeletionTarget;
      return encodeDeletionTarget(target) === value ? target : null;
    }
    if (
      parsed.length === 3 &&
      parsed[0] === "group" &&
      exactText(parsed[1], MAX_ID_LENGTH) &&
      exactText(parsed[2], MAX_ID_LENGTH) &&
      parsed[2] !== "page-root"
    ) {
      const target = {
        kind: "group",
        pageId: parsed[1],
        id: parsed[2],
      } satisfies StudioCrdtDeletionTarget;
      return encodeDeletionTarget(target) === value ? target : null;
    }
  } catch {
    // Untrusted remote documents are read defensively; the API rejects malformed protocol roots.
  }
  return null;
}

export function createDeletionOperationId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues !== "function") {
    throw new Error("삭제 작업 식별자를 안전하게 생성할 수 없습니다.");
  }
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

export function propertyKey(prefix: typeof PROPERTY_PREFIX | typeof BASELINE_PROPERTY_PREFIX, key: string): string {
  return `${prefix}${key}`;
}

export function readCrdtProperties(record: Y.Map<unknown>): StudioCrdtJsonObject {
  const result: StudioCrdtJsonObject = {};
  let encodedKeyCount = 0;
  for (const key of record.keys()) {
    if (
      key.startsWith(BASELINE_PROPERTY_PREFIX) || key.startsWith(PROPERTY_PREFIX) ||
      key.startsWith(UNSET_PROPERTY_PREFIX)
    ) {
      encodedKeyCount += 1;
      if (encodedKeyCount > 256) throw new Error("CRDT 요소 속성 수가 허용 범위를 초과했습니다.");
    }
  }
  for (const [key, value] of record) {
    if (!key.startsWith(BASELINE_PROPERTY_PREFIX)) continue;
    const property = key.slice(BASELINE_PROPERTY_PREFIX.length);
    const cloned = cloneAndValidateJson(value as StudioCrdtJsonValue);
    result[property] = cloned;
  }
  for (const [key, value] of record) {
    if (!key.startsWith(PROPERTY_PREFIX)) continue;
    const property = key.slice(PROPERTY_PREFIX.length);
    const cloned = cloneAndValidateJson(value as StudioCrdtJsonValue);
    result[property] = cloned;
  }
  for (const [key, value] of record) {
    if (!key.startsWith(UNSET_PROPERTY_PREFIX) || value !== true) continue;
    delete result[key.slice(UNSET_PROPERTY_PREFIX.length)];
  }
  return result;
}

export function setCrdtProperties(
  record: Y.Map<unknown>,
  prefix: typeof PROPERTY_PREFIX | typeof BASELINE_PROPERTY_PREFIX,
  props: StudioCrdtJsonObject,
  keys: readonly string[] = Object.keys(props)
): void {
  for (const key of keys) {
    if (!(key in props)) continue;
    record.set(propertyKey(prefix, key), cloneAndValidateJson(props[key]!));
    if (prefix === PROPERTY_PREFIX) record.set(`${UNSET_PROPERTY_PREFIX}${key}`, false);
  }
}

export function validateUnsetKeys(
  keys: readonly string[],
  allowed: ReadonlySet<string>,
  required: readonly string[]
): void {
  const seen = new Set<string>();
  for (const key of keys) {
    if (!exactText(key, MAX_TEXT_LENGTH) || !allowed.has(key) || seen.has(key)) {
      throw new Error("동기화에서 제거할 속성이 올바르지 않습니다.");
    }
    if (required.includes(key)) throw new Error(`${key} 필수 속성은 제거할 수 없습니다.`);
    seen.add(key);
  }
}

export function yArray(record: Y.Map<unknown>, key: StudioCrdtSampleArrayKey): Y.Array<number> | null {
  // Yjs preliminary shared types deliberately allow writes but warn on reads. Out-of-order
  // collaboration updates and local create→history-reconcile bursts can briefly surface one of
  // those preliminary maps to bookkeeping code, so admission must fail closed until integration.
  if (record.doc === null) return null;
  const value = record.get(key);
  return value instanceof Y.Array ? (value as Y.Array<number>) : null;
}

export function readString(record: Y.Map<unknown>, key: string): string | null {
  const value = record.get(key);
  return typeof value === "string" ? value : null;
}

export function readNumber(record: Y.Map<unknown>, key: string): number | null {
  const value = record.get(key);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readJsonObject(record: Y.Map<unknown>, key: string): StudioCrdtJsonObject | undefined {
  const value = record.get(key);
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  try {
    return cloneJsonObject(value as StudioCrdtJsonObject);
  } catch {
    return undefined;
  }
}

export function createSampleArray(values: readonly number[]): Y.Array<number> {
  const result = new Y.Array<number>();
  if (values.length > 0) result.push([...values]);
  return result;
}

/** strokeRecordCache 등에 저장하기 전 레코드를 얼린다 — 캐시된 레코드는 get*() 호출마다 다시
 * 디코딩되지 않고 여러 호출에서 재사용되므로, 호출자가 실수로 내부(payload/props 등)를 제자리
 * 수정하면 캐시가 조용히 오염된다. lib/studio-crdt-raster-ops.ts 의 deepFreeze 와 동일한 관례. */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export function orderEntryValue(entry: unknown, key: string): string | null {
  // Reading a detached Y.Map logs Yjs' "Add Yjs type to a document" warning and yields incomplete
  // preliminary content. The integrating root-array event will register the entry once `doc` is
  // available, so ignoring it at this transient boundary is both quieter and more correct.
  if (!(entry instanceof Y.Map) || entry.doc === null) return null;
  const value = entry.get(key);
  return typeof value === "string" ? value : null;
}

export function sceneOrderEntryId(entry: unknown): string | null {
  return orderEntryValue(entry, "elementId");
}

export function pageOrderEntryId(entry: unknown): string | null {
  return orderEntryValue(entry, "pageId");
}

export function mixedOrderEntryId(entry: unknown): string | null {
  return orderEntryValue(entry, "strokeId") ?? sceneOrderEntryId(entry);
}

export function isRasterPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function hasExactRasterKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isRasterPlainRecord(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function parseCanonicalRasterJson(value: unknown): unknown | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return canonicalStudioRasterJson(parsed) === value ? parsed : null;
  } catch {
    return null;
  }
}

export function rasterEnvelopeSurfaceId(value: unknown): string | null {
  const parsed = parseCanonicalRasterJson(value);
  if (!hasExactRasterKeys(parsed, ["surfaceId", "operation"]) &&
      !hasExactRasterKeys(parsed, ["surfaceId", "undoOperation"]) &&
      !hasExactRasterKeys(parsed, ["surfaceId", "acknowledgement"])) {
    return null;
  }
  return typeof parsed.surfaceId === "string" && RASTER_SAFE_ID_PATTERN.test(parsed.surfaceId)
    ? parsed.surfaceId
    : null;
}

export function rasterCheckpointSurfaceId(value: unknown): string | null {
  const parsed = parseCanonicalRasterJson(value);
  if (!isRasterPlainRecord(parsed) || !isRasterPlainRecord(parsed.surface)) return null;
  const surfaceId = parsed.surface.surfaceId;
  return typeof surfaceId === "string" && RASTER_SAFE_ID_PATTERN.test(surfaceId)
    ? surfaceId
    : null;
}

export function assertRasterSafeId(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > MAX_ID_LENGTH ||
    !RASTER_SAFE_ID_PATTERN.test(value)
  ) {
    throw new Error(`${label} 식별자가 올바르지 않습니다.`);
  }
}

export interface StudioCrdtRasterMutation {
  readonly surface?: { readonly id: string; readonly value: string };
  readonly operations?: readonly { readonly id: string; readonly value: string }[];
  readonly undoOperations?: readonly { readonly id: string; readonly value: string }[];
  readonly undoAcknowledgements?: readonly { readonly id: string; readonly value: string }[];
  readonly brushRenderProvenance?: {
    readonly registry: readonly { readonly id: string; readonly value: string }[];
    readonly contentIndex: readonly { readonly id: string; readonly value: string }[];
  };
}

export interface StudioCrdtBrushRenderProvenanceSnapshot {
  readonly byOperationId: ReadonlyMap<
    string,
    Readonly<StudioBrushRenderProvenanceCrdtSidecar>
  >;
  readonly sidecars: readonly Readonly<StudioBrushRenderProvenanceCrdtSidecar>[];
  readonly totalBytes: number;
}

export interface StudioCrdtBrushRenderProvenanceMutation {
  readonly sidecars: readonly Readonly<StudioBrushRenderProvenanceCrdtSidecar>[];
  readonly registry: readonly { readonly id: string; readonly value: string }[];
  readonly contentIndex: readonly { readonly id: string; readonly value: string }[];
}

export function brushRenderProvenanceContentIndexKey(
  sidecar: Readonly<StudioBrushRenderProvenanceCrdtSidecar>
): string {
  return `${sidecar.operationId}|${sidecar.provenanceSha256}`;
}

export function brushRenderProvenanceOperationIdFromContentIndexKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const separator = value.indexOf("|");
  if (separator <= 0) return null;
  const operationId = value.slice(0, separator);
  const provenanceSha256 = value.slice(separator + 1);
  if (
    operationId.length > STUDIO_BRUSH_RENDER_PROVENANCE_LIMITS.maxOperationIdLength ||
    !RASTER_SAFE_ID_PATTERN.test(operationId) ||
    !/^sha256:[a-f0-9]{64}$/u.test(provenanceSha256)
  ) {
    return null;
  }
  return operationId;
}

export function crdtUtf8Bytes(value: string): number {
  return TEXT_ENCODER.encode(value).byteLength;
}

export function crdtMapEntryBytes(key: string, value: string): number {
  return crdtUtf8Bytes(key) + crdtUtf8Bytes(value);
}

export function parseCanonicalBrushRenderProvenanceSidecar(
  value: unknown
): Readonly<StudioBrushRenderProvenanceCrdtSidecar> | null {
  if (
    typeof value !== "string" ||
    crdtUtf8Bytes(value) > STUDIO_BRUSH_RENDER_PROVENANCE_LIMITS.maxCrdtSidecarBytes
  ) {
    return null;
  }
  try {
    const parsedJson: unknown = JSON.parse(value);
    const parsed = parseStudioBrushRenderProvenanceCrdtSidecar(parsedJson);
    if (parsed.status !== "ready") return null;
    return serializeStudioBrushRenderProvenanceCrdtSidecarCanonical(parsed.sidecar) === value
      ? parsed.sidecar
      : null;
  } catch {
    return null;
  }
}

export function addRasterAsset(
  assets: Map<string, StudioRasterAssetReference>,
  asset: StudioRasterAssetReference,
  label: string
): number {
  const existing = assets.get(asset.assetId);
  if (existing) {
    if (canonicalStudioRasterJson(existing) !== canonicalStudioRasterJson(asset)) {
      throw new Error(`${label}: 같은 assetId가 서로 다른 불변 자산을 가리킵니다.`);
    }
    return 0;
  }
  assets.set(asset.assetId, asset);
  return asset.byteLength;
}

export function mergeStudioCrdtUpdates(updates: readonly Uint8Array[]): Uint8Array {
  if (updates.length === 0) throw new Error("병합할 CRDT 업데이트가 없습니다.");
  return updates.length === 1 ? updates[0].slice() : Y.mergeUpdates([...updates]);
}
