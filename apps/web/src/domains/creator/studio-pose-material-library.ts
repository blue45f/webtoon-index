/**
 * Bounded local pose-material library with an injected localStorage-compatible adapter.
 *
 * Reads and writes use one versioned envelope. Corrupt/future values are never overwritten by
 * ordinary mutation; recovery replacement requires an explicit force intent. Storage exceptions
 * never escape, and import is transactional: validation/count/byte admission completes before the
 * sole `setItem` call.
 */

import {
  parseStudioPoseMaterial,
  serializeStudioPoseMaterial,
  type StudioPoseMaterial,
} from "./studio-pose-material";

export const STUDIO_POSE_MATERIAL_LIBRARY_STORAGE_KEY =
  "toonspectrum-studio-pose-material-library-v1";
export const STUDIO_POSE_MATERIAL_LIBRARY_KIND =
  "toonspectrum.studio-pose-material-library" as const;
export const STUDIO_POSE_MATERIAL_LIBRARY_VERSION = 1 as const;
export const STUDIO_POSE_MATERIAL_LIBRARY_MAX_COUNT = 64;
export const STUDIO_POSE_MATERIAL_LIBRARY_MAX_BYTES = 256 * 1024;

export interface StudioPoseMaterialLibraryPayload {
  readonly kind: typeof STUDIO_POSE_MATERIAL_LIBRARY_KIND;
  readonly version: typeof STUDIO_POSE_MATERIAL_LIBRARY_VERSION;
  readonly materials: readonly StudioPoseMaterial[];
}

export interface StudioPoseMaterialStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type StudioPoseMaterialLibraryLoadStatus =
  | "missing"
  | "loaded"
  | "future"
  | "corrupt"
  | "unavailable"
  | "read-error";

export interface StudioPoseMaterialLibraryLoadResult {
  readonly status: StudioPoseMaterialLibraryLoadStatus;
  readonly payload: StudioPoseMaterialLibraryPayload;
  /** Null for corrupt/future storage so callers cannot accidentally rewrite it as an empty v1. */
  readonly canonicalJson: string | null;
  readonly shouldRewrite: boolean;
}

export type StudioPoseMaterialLibraryOperation =
  | "saved"
  | "created"
  | "updated"
  | "deleted"
  | "imported";

export type StudioPoseMaterialLibraryFailureReason =
  | "storage-unavailable"
  | "storage-read-error"
  | "storage-write-error"
  | "library-corrupt"
  | "library-future"
  | "replace-requires-force"
  | "invalid-library"
  | "invalid-material"
  | "invalid-id"
  | "duplicate-id"
  | "max-count"
  | "max-bytes"
  | "not-found";

export interface StudioPoseMaterialLibrarySuccess {
  readonly ok: true;
  readonly operation: StudioPoseMaterialLibraryOperation;
  readonly payload: StudioPoseMaterialLibraryPayload;
  readonly canonicalJson: string;
  readonly material: StudioPoseMaterial | null;
}

export interface StudioPoseMaterialLibraryFailure {
  readonly ok: false;
  readonly reason: StudioPoseMaterialLibraryFailureReason;
}

export type StudioPoseMaterialLibraryMutationResult =
  | StudioPoseMaterialLibrarySuccess
  | StudioPoseMaterialLibraryFailure;

export type StudioPoseMaterialLibraryImportMode = "merge" | "replace";

/** Deliberate destructive recovery intent; exact shape and literal `true` are checked at runtime. */
export interface StudioPoseMaterialLibraryForceReplaceIntent {
  readonly force: true;
}

export interface StudioPoseMaterialLibraryExportSuccess {
  readonly ok: true;
  readonly json: string;
  readonly count: number;
}

export type StudioPoseMaterialLibraryExportResult =
  | StudioPoseMaterialLibraryExportSuccess
  | StudioPoseMaterialLibraryFailure;

const LIBRARY_KEYS = ["kind", "version", "materials"] as const;
const FORCE_REPLACE_INTENT_KEYS = ["force"] as const;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,79}$/u;
const FORBIDDEN_ID_SET = new Set(["__proto__", "constructor", "prototype"]);
const FORBIDDEN_KEY_SET = new Set(["__proto__", "constructor", "prototype"]);
const UTF8_ENCODER = new TextEncoder();
const MAX_DECODE_DEPTH = 10;
const MAX_DECODE_NODES = 32_768;
const INVALID_JSON_VALUE = Symbol("invalid-json-value");

type DenseArraySnapshot =
  | { readonly ok: true; readonly values: readonly unknown[] }
  | { readonly ok: false; readonly reason: "invalid" | "max-count" };

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue };

interface DecodeState {
  nodes: number;
  readonly ancestors: WeakSet<object>;
}

function utf8ByteLength(value: string): number {
  return UTF8_ENCODER.encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * Copies only a standard dense Array's own enumerable data elements. In particular, this never
 * consults `Symbol.iterator`, so a hostile or accidentally replaced iterator cannot bypass the
 * cardinality limit, omit visible entries, or turn admission into an unbounded loop.
 */
function snapshotPlainDenseArray(value: unknown, maximumLength: number): DenseArraySnapshot {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      return { ok: false, reason: "invalid" };
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (!lengthDescriptor || !("value" in lengthDescriptor)) {
      return { ok: false, reason: "invalid" };
    }
    const length = lengthDescriptor.value;
    if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
      return { ok: false, reason: "invalid" };
    }
    if (length > maximumLength) return { ok: false, reason: "max-count" };

    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== length + 1 ||
      keys.some((key) => {
        if (key === "length") return false;
        if (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key)) return true;
        const index = Number(key);
        return !Number.isSafeInteger(index) || index < 0 || index >= length;
      })
    ) {
      return { ok: false, reason: "invalid" };
    }

    const values: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
        return { ok: false, reason: "invalid" };
      }
      values.push(descriptor.value);
    }
    return { ok: true, values: Object.freeze(values) };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

/** Snapshots an exact plain record without invoking accessors or accepting hidden/symbol fields. */
function snapshotExactPlainRecord(
  value: unknown,
  expectedKeys: readonly string[]
): Readonly<Record<string, unknown>> | null {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
    ) {
      return null;
    }
    const snapshot = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return null;
      snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

function copySafeJsonValue(
  value: unknown,
  state: DecodeState,
  depth = 0
): JsonValue | typeof INVALID_JSON_VALUE {
  state.nodes += 1;
  if (state.nodes > MAX_DECODE_NODES || depth > MAX_DECODE_DEPTH) return INVALID_JSON_VALUE;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : INVALID_JSON_VALUE;
  if (typeof value !== "object" || state.ancestors.has(value)) return INVALID_JSON_VALUE;

  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_DECODE_NODES) {
        return INVALID_JSON_VALUE;
      }
      const keys = Reflect.ownKeys(value);
      if (
        keys.some(
          (key) =>
            typeof key !== "string" ||
            (key !== "length" &&
              (!/^(?:0|[1-9]\d*)$/u.test(key) ||
                !Number.isSafeInteger(Number(key)) ||
                Number(key) >= value.length))
        )
      ) {
        return INVALID_JSON_VALUE;
      }
      const result: JsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          return INVALID_JSON_VALUE;
        }
        const copied = copySafeJsonValue(descriptor.value, state, depth + 1);
        if (copied === INVALID_JSON_VALUE) return INVALID_JSON_VALUE;
        result.push(copied);
      }
      return result;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return INVALID_JSON_VALUE;
    const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string" || FORBIDDEN_KEY_SET.has(key)) return INVALID_JSON_VALUE;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return INVALID_JSON_VALUE;
      }
      const copied = copySafeJsonValue(descriptor.value, state, depth + 1);
      if (copied === INVALID_JSON_VALUE) return INVALID_JSON_VALUE;
      result[key] = copied;
    }
    return result;
  } catch {
    return INVALID_JSON_VALUE;
  } finally {
    state.ancestors.delete(value);
  }
}

function decodeBoundedJson(raw: unknown): unknown | null {
  let decoded = raw;
  try {
    if (typeof raw === "string") {
      if (utf8ByteLength(raw) > STUDIO_POSE_MATERIAL_LIBRARY_MAX_BYTES) return null;
      decoded = JSON.parse(raw) as unknown;
    }
    const copied = copySafeJsonValue(decoded, {
      nodes: 0,
      ancestors: new WeakSet<object>(),
    });
    if (copied === INVALID_JSON_VALUE) return null;
    const serialized = JSON.stringify(copied);
    if (utf8ByteLength(serialized) > STUDIO_POSE_MATERIAL_LIBRARY_MAX_BYTES) return null;
    return JSON.parse(serialized) as unknown;
  } catch {
    return null;
  }
}

function canonicalPayloadFromMaterials(rawMaterials: unknown): StudioPoseMaterialLibraryPayload | null {
  const snapshot = snapshotPlainDenseArray(rawMaterials, STUDIO_POSE_MATERIAL_LIBRARY_MAX_COUNT);
  if (!snapshot.ok) return null;
  const materials: StudioPoseMaterial[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < snapshot.values.length; index += 1) {
    const rawMaterial = snapshot.values[index];
    const material = parseStudioPoseMaterial(rawMaterial);
    if (!material || ids.has(material.id)) return null;
    ids.add(material.id);
    materials.push(material);
  }
  materials.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const payload = deepFreeze({
    kind: STUDIO_POSE_MATERIAL_LIBRARY_KIND,
    version: STUDIO_POSE_MATERIAL_LIBRARY_VERSION,
    materials,
  });
  const serialized = JSON.stringify(payload);
  return utf8ByteLength(serialized) <= STUDIO_POSE_MATERIAL_LIBRARY_MAX_BYTES ? payload : null;
}

function createEmptyPayload(): StudioPoseMaterialLibraryPayload {
  const payload = canonicalPayloadFromMaterials([]);
  if (!payload) throw new Error("Unable to create the empty pose-material library payload.");
  return payload;
}

export const EMPTY_STUDIO_POSE_MATERIAL_LIBRARY = createEmptyPayload();
export const EMPTY_STUDIO_POSE_MATERIAL_LIBRARY_JSON = JSON.stringify(
  EMPTY_STUDIO_POSE_MATERIAL_LIBRARY
);

export function parseStudioPoseMaterialLibraryPayload(
  raw: unknown
): StudioPoseMaterialLibraryPayload | null {
  const decoded = decodeBoundedJson(raw);
  if (!isRecord(decoded) || !hasExactKeys(decoded, LIBRARY_KEYS)) return null;
  if (
    decoded.kind !== STUDIO_POSE_MATERIAL_LIBRARY_KIND ||
    decoded.version !== STUDIO_POSE_MATERIAL_LIBRARY_VERSION
  ) {
    return null;
  }
  return canonicalPayloadFromMaterials(decoded.materials);
}

export function serializeStudioPoseMaterialLibraryPayload(raw: unknown): string | null {
  const payload = parseStudioPoseMaterialLibraryPayload(raw);
  if (!payload) return null;
  const serialized = JSON.stringify(payload);
  return utf8ByteLength(serialized) <= STUDIO_POSE_MATERIAL_LIBRARY_MAX_BYTES
    ? serialized
    : null;
}

function immutableLoadResult(
  status: StudioPoseMaterialLibraryLoadStatus,
  payload: StudioPoseMaterialLibraryPayload,
  canonicalJson: string | null,
  shouldRewrite: boolean
): StudioPoseMaterialLibraryLoadResult {
  return Object.freeze({ status, payload, canonicalJson, shouldRewrite });
}

export function loadStudioPoseMaterialLibrary(
  storage: StudioPoseMaterialStorage | null | undefined
): StudioPoseMaterialLibraryLoadResult {
  if (!storage) {
    return immutableLoadResult(
      "unavailable",
      EMPTY_STUDIO_POSE_MATERIAL_LIBRARY,
      EMPTY_STUDIO_POSE_MATERIAL_LIBRARY_JSON,
      false
    );
  }
  let raw: string | null;
  try {
    raw = storage.getItem(STUDIO_POSE_MATERIAL_LIBRARY_STORAGE_KEY);
  } catch {
    return immutableLoadResult(
      "read-error",
      EMPTY_STUDIO_POSE_MATERIAL_LIBRARY,
      EMPTY_STUDIO_POSE_MATERIAL_LIBRARY_JSON,
      false
    );
  }
  if (raw === null) {
    return immutableLoadResult(
      "missing",
      EMPTY_STUDIO_POSE_MATERIAL_LIBRARY,
      EMPTY_STUDIO_POSE_MATERIAL_LIBRARY_JSON,
      false
    );
  }
  const decoded = decodeBoundedJson(raw);
  if (
    isRecord(decoded) &&
    decoded.kind === STUDIO_POSE_MATERIAL_LIBRARY_KIND &&
    typeof decoded.version === "number" &&
    Number.isSafeInteger(decoded.version) &&
    decoded.version > STUDIO_POSE_MATERIAL_LIBRARY_VERSION
  ) {
    return immutableLoadResult(
      "future",
      EMPTY_STUDIO_POSE_MATERIAL_LIBRARY,
      null,
      false
    );
  }
  const payload = parseStudioPoseMaterialLibraryPayload(decoded);
  if (!payload) {
    return immutableLoadResult(
      "corrupt",
      EMPTY_STUDIO_POSE_MATERIAL_LIBRARY,
      null,
      false
    );
  }
  const canonicalJson = JSON.stringify(payload);
  return immutableLoadResult("loaded", payload, canonicalJson, canonicalJson !== raw);
}

function failure(reason: StudioPoseMaterialLibraryFailureReason): StudioPoseMaterialLibraryFailure {
  return Object.freeze({ ok: false, reason });
}

function loadForMutation(
  storage: StudioPoseMaterialStorage | null | undefined
): StudioPoseMaterialLibraryPayload | StudioPoseMaterialLibraryFailure {
  const loaded = loadStudioPoseMaterialLibrary(storage);
  if (loaded.status === "unavailable") return failure("storage-unavailable");
  if (loaded.status === "read-error") return failure("storage-read-error");
  if (loaded.status === "future") return failure("library-future");
  if (loaded.status === "corrupt") return failure("library-corrupt");
  return loaded.payload;
}

function hasExplicitForceReplaceIntent(
  raw: unknown
): raw is StudioPoseMaterialLibraryForceReplaceIntent {
  const snapshot = snapshotExactPlainRecord(raw, FORCE_REPLACE_INTENT_KEYS);
  return snapshot?.force === true;
}

function admitDestructiveReplace(
  storage: StudioPoseMaterialStorage | null | undefined,
  rawIntent: unknown
): StudioPoseMaterialLibraryFailure | null {
  const hasForce = rawIntent !== undefined && hasExplicitForceReplaceIntent(rawIntent);
  if (rawIntent !== undefined && !hasForce) {
    return failure("replace-requires-force");
  }
  const loaded = loadStudioPoseMaterialLibrary(storage);
  if (loaded.status === "unavailable") return failure("storage-unavailable");
  if (loaded.status === "read-error") return failure("storage-read-error");
  if (loaded.status === "missing") return null;
  return hasForce
    ? null
    : failure("replace-requires-force");
}

function persist(
  storage: StudioPoseMaterialStorage | null | undefined,
  operation: StudioPoseMaterialLibraryOperation,
  payload: StudioPoseMaterialLibraryPayload,
  material: StudioPoseMaterial | null
): StudioPoseMaterialLibraryMutationResult {
  if (!storage) return failure("storage-unavailable");
  const canonicalJson = JSON.stringify(payload);
  if (utf8ByteLength(canonicalJson) > STUDIO_POSE_MATERIAL_LIBRARY_MAX_BYTES) {
    return failure("max-bytes");
  }
  try {
    storage.setItem(STUDIO_POSE_MATERIAL_LIBRARY_STORAGE_KEY, canonicalJson);
  } catch {
    return failure("storage-write-error");
  }
  return Object.freeze({ ok: true, operation, payload, canonicalJson, material });
}

function payloadAdmissionFailure(rawMaterials: unknown): StudioPoseMaterialLibraryFailureReason {
  const snapshot = snapshotPlainDenseArray(rawMaterials, STUDIO_POSE_MATERIAL_LIBRARY_MAX_COUNT);
  if (!snapshot.ok) return snapshot.reason === "max-count" ? "max-count" : "invalid-library";
  const ids = new Set<string>();
  for (let index = 0; index < snapshot.values.length; index += 1) {
    const rawMaterial = snapshot.values[index];
    const material = parseStudioPoseMaterial(rawMaterial);
    if (!material) return "invalid-material";
    if (ids.has(material.id)) return "duplicate-id";
    ids.add(material.id);
  }
  return "max-bytes";
}

/** Replaces the whole library after validation; an existing value requires explicit force intent. */
export function saveStudioPoseMaterialLibrary(
  storage: StudioPoseMaterialStorage | null | undefined,
  rawMaterials: unknown,
  forceIntent?: StudioPoseMaterialLibraryForceReplaceIntent
): StudioPoseMaterialLibraryMutationResult {
  const payload = canonicalPayloadFromMaterials(rawMaterials);
  if (!payload) return failure(payloadAdmissionFailure(rawMaterials));
  const replacementFailure = admitDestructiveReplace(storage, forceIntent);
  if (replacementFailure) return replacementFailure;
  return persist(storage, "saved", payload, null);
}

export function upsertStudioPoseMaterial(
  storage: StudioPoseMaterialStorage | null | undefined,
  rawMaterial: unknown
): StudioPoseMaterialLibraryMutationResult {
  const current = loadForMutation(storage);
  if ("ok" in current) return current;
  const material = parseStudioPoseMaterial(rawMaterial);
  if (!material) return failure("invalid-material");
  const existingIndex = current.materials.findIndex((entry) => entry.id === material.id);
  if (existingIndex < 0 && current.materials.length >= STUDIO_POSE_MATERIAL_LIBRARY_MAX_COUNT) {
    return failure("max-count");
  }
  const nextMaterials = existingIndex < 0
    ? [...current.materials, material]
    : current.materials.map((entry, index) => (index === existingIndex ? material : entry));
  const payload = canonicalPayloadFromMaterials(nextMaterials);
  if (!payload) return failure("max-bytes");
  return persist(storage, existingIndex < 0 ? "created" : "updated", payload, material);
}

function isValidId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ID_PATTERN.test(value) &&
    !FORBIDDEN_ID_SET.has(value.toLowerCase())
  );
}

export function deleteStudioPoseMaterial(
  storage: StudioPoseMaterialStorage | null | undefined,
  rawId: unknown
): StudioPoseMaterialLibraryMutationResult {
  const current = loadForMutation(storage);
  if ("ok" in current) return current;
  if (!isValidId(rawId)) return failure("invalid-id");
  const existing = current.materials.find((material) => material.id === rawId);
  if (!existing) return failure("not-found");
  const payload = canonicalPayloadFromMaterials(
    current.materials.filter((material) => material.id !== rawId)
  );
  if (!payload) return failure("invalid-library");
  return persist(storage, "deleted", payload, existing);
}

/** Imports a strict envelope. Merge updates equal ids; whole-library replace requires force. */
export function importStudioPoseMaterialLibrary(
  storage: StudioPoseMaterialStorage | null | undefined,
  raw: unknown,
  mode: StudioPoseMaterialLibraryImportMode = "merge",
  forceIntent?: StudioPoseMaterialLibraryForceReplaceIntent
): StudioPoseMaterialLibraryMutationResult {
  if (mode !== "merge" && mode !== "replace") return failure("invalid-library");
  if (mode === "merge" && forceIntent !== undefined) return failure("invalid-library");
  const imported = parseStudioPoseMaterialLibraryPayload(raw);
  if (!imported) return failure("invalid-library");

  let nextMaterials: readonly StudioPoseMaterial[] = imported.materials;
  if (mode === "merge") {
    const current = loadForMutation(storage);
    if ("ok" in current) return current;
    const byId = new Map(current.materials.map((material) => [material.id, material] as const));
    for (const material of imported.materials) byId.set(material.id, material);
    nextMaterials = [...byId.values()];
  } else {
    const replacementFailure = admitDestructiveReplace(storage, forceIntent);
    if (replacementFailure) return replacementFailure;
  }

  if (nextMaterials.length > STUDIO_POSE_MATERIAL_LIBRARY_MAX_COUNT) return failure("max-count");
  const payload = canonicalPayloadFromMaterials(nextMaterials);
  if (!payload) return failure("max-bytes");
  return persist(storage, "imported", payload, null);
}

/** Exports canonical JSON without mutating or repairing storage. */
export function exportStudioPoseMaterialLibrary(
  storage: StudioPoseMaterialStorage | null | undefined
): StudioPoseMaterialLibraryExportResult {
  const loaded = loadStudioPoseMaterialLibrary(storage);
  if (loaded.status === "unavailable") return failure("storage-unavailable");
  if (loaded.status === "read-error") return failure("storage-read-error");
  if (loaded.status === "future") return failure("library-future");
  if (loaded.status === "corrupt") return failure("library-corrupt");
  if (loaded.canonicalJson === null) return failure("invalid-library");
  return Object.freeze({
    ok: true,
    json: loaded.canonicalJson,
    count: loaded.payload.materials.length,
  });
}

/** Convenience for callers that need one portable material rather than the entire library. */
export function exportStudioPoseMaterial(rawMaterial: unknown): string | null {
  return serializeStudioPoseMaterial(rawMaterial);
}
