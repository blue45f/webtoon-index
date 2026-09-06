/**
 * Strict, engine-neutral pose material wire contract.
 *
 * A pose material stores only normalized humanoid-bone rotations. Translation, scale, arbitrary
 * node paths, URLs, and executable metadata are intentionally outside v1. Runtime adapters consume
 * a merge plan and remain responsible for mapping semantic bone names to engine objects.
 */

import {
  STUDIO_HUMANOID_BONE_NAMES,
  isStudioHumanoidBoneInScope,
  isStudioHumanoidBoneName,
  isStudioPoseScope,
  type StudioHumanoidBoneName,
  type StudioPoseScope,
} from "./studio-humanoid-bones";

export const STUDIO_POSE_MATERIAL_KIND = "toonspectrum.studio-pose-material" as const;
export const STUDIO_POSE_MATERIAL_VERSION = 1 as const;
export const STUDIO_POSE_MATERIAL_MAX_BYTES = 96 * 1024;
export const STUDIO_POSE_MATERIAL_MAX_NAME_LENGTH = 80;
export const STUDIO_POSE_MATERIAL_MAX_DESCRIPTION_LENGTH = 320;
export const STUDIO_POSE_MATERIAL_MAX_TAGS = 12;
export const STUDIO_POSE_MATERIAL_MAX_TAG_LENGTH = 32;

/**
 * Portable v1 rotation semantics shared by every bone entry.
 *
 * `delta-times-rest` means the stored delta `D` is obtained from a normalized humanoid bone as
 * `D = posedLocal * inverse(restLocal)` and is applied as `posedLocal = D * restLocal`. This is
 * the same relative-local contract consumed by three-vrm's `getNormalizedPose()` and
 * `setNormalizedPose()`; it is not a model-specific raw-bone or absolute-local quaternion.
 */
export const STUDIO_POSE_ROTATION_CONVENTION = Object.freeze({
  componentOrder: "xyzw",
  coordinateSystem: "right-handed",
  humanoidRig: "vrm-normalized",
  transformSpace: "bone-local",
  referencePose: "rest-relative",
  composition: "delta-times-rest",
} as const);

export type StudioPoseRotationConvention = typeof STUDIO_POSE_ROTATION_CONVENTION;

export type StudioPoseQuaternion = readonly [number, number, number, number];

export interface StudioPoseMaterialBoneRotation {
  readonly bone: StudioHumanoidBoneName;
  readonly rotation: StudioPoseQuaternion;
}

export interface StudioPoseMaterialMetadata {
  /** Canonical single-line text; v1 deliberately rejects links and embedded control characters. */
  readonly description: string;
  readonly tags: readonly string[];
}

export interface StudioPoseMaterial {
  readonly kind: typeof STUDIO_POSE_MATERIAL_KIND;
  readonly version: typeof STUDIO_POSE_MATERIAL_VERSION;
  /** Exact, version-locked semantics for every quaternion in `bones`. */
  readonly rotationConvention: StudioPoseRotationConvention;
  readonly id: string;
  readonly name: string;
  readonly scope: StudioPoseScope;
  /** Topology-ordered, duplicate-free rotations whose bones all belong to `scope`. */
  readonly bones: readonly StudioPoseMaterialBoneRotation[];
  readonly metadata: StudioPoseMaterialMetadata;
}

export interface StudioPoseMaterialMergeOptions {
  /** Further narrows the material's authored scope. Defaults to the material scope. */
  readonly scope?: StudioPoseScope;
  /** Locked semantic bones are never emitted as operations. */
  readonly lockedBones?: readonly StudioHumanoidBoneName[];
}

export interface StudioPoseMaterialMergeOperation {
  readonly bone: StudioHumanoidBoneName;
  readonly rotation: StudioPoseQuaternion;
}

export interface StudioPoseMaterialMergePlan {
  readonly materialId: string;
  readonly materialScope: StudioPoseScope;
  readonly requestedScope: StudioPoseScope;
  readonly rotationConvention: StudioPoseRotationConvention;
  readonly operations: readonly StudioPoseMaterialMergeOperation[];
  readonly skippedLocked: readonly StudioHumanoidBoneName[];
  readonly skippedOutsideScope: readonly StudioHumanoidBoneName[];
}

const MATERIAL_KEYS = [
  "kind",
  "version",
  "rotationConvention",
  "id",
  "name",
  "scope",
  "bones",
  "metadata",
] as const;
const BONE_KEYS = ["bone", "rotation"] as const;
const METADATA_KEYS = ["description", "tags"] as const;
const ROTATION_CONVENTION_KEYS = [
  "componentOrder",
  "coordinateSystem",
  "humanoidRig",
  "transformSpace",
  "referencePose",
  "composition",
] as const;
const MERGE_OPTION_KEYS = ["scope", "lockedBones"] as const;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,79}$/u;
const FORBIDDEN_KEY_SET = new Set(["__proto__", "constructor", "prototype"]);
const FORBIDDEN_ID_SET = new Set(["__proto__", "constructor", "prototype"]);
const URL_LIKE_PATTERN = /(?:\b(?:https?|ftp|file|data|blob|javascript):|(?:^|[\s([{])(?:www\.|\/\/))/iu;
const UTF8_ENCODER = new TextEncoder();
const MAX_DECODE_DEPTH = 8;
const MAX_DECODE_NODES = 4_096;
const MIN_QUATERNION_NORM = 1e-8;
const INVALID_JSON_VALUE = Symbol("invalid-json-value");

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

/** Copies JSON data without invoking accessors and rejects exotic prototypes/cycles early. */
function copySafeJsonValue(
  value: unknown,
  state: DecodeState,
  depth = 0
): JsonValue | typeof INVALID_JSON_VALUE {
  state.nodes += 1;
  if (state.nodes > MAX_DECODE_NODES || depth > MAX_DECODE_DEPTH) return INVALID_JSON_VALUE;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : INVALID_JSON_VALUE;
  if (typeof value !== "object") return INVALID_JSON_VALUE;
  if (state.ancestors.has(value)) return INVALID_JSON_VALUE;

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
      if (utf8ByteLength(raw) > STUDIO_POSE_MATERIAL_MAX_BYTES) return null;
      decoded = JSON.parse(raw) as unknown;
    }
    const copied = copySafeJsonValue(decoded, {
      nodes: 0,
      ancestors: new WeakSet<object>(),
    });
    if (copied === INVALID_JSON_VALUE) return null;
    const serialized = JSON.stringify(copied);
    if (utf8ByteLength(serialized) > STUDIO_POSE_MATERIAL_MAX_BYTES) return null;
    return JSON.parse(serialized) as unknown;
  } catch {
    return null;
  }
}

function containsUnsafeTextCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    ) {
      return true;
    }
  }
  return false;
}

function canonicalText(
  value: unknown,
  maximumLength: number,
  allowEmpty: boolean
): string | null {
  if (typeof value !== "string" || containsUnsafeTextCharacter(value)) return null;
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (
    normalized !== value ||
    (!allowEmpty && normalized.length === 0) ||
    Array.from(normalized).length > maximumLength ||
    URL_LIKE_PATTERN.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function canonicalId(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !ID_PATTERN.test(value) ||
    FORBIDDEN_ID_SET.has(value.toLowerCase())
  ) {
    return null;
  }
  return value;
}

function canonicalRotationConvention(raw: unknown): StudioPoseRotationConvention | null {
  if (!isRecord(raw) || !hasExactKeys(raw, ROTATION_CONVENTION_KEYS)) return null;
  for (const key of ROTATION_CONVENTION_KEYS) {
    if (raw[key] !== STUDIO_POSE_ROTATION_CONVENTION[key]) return null;
  }
  return STUDIO_POSE_ROTATION_CONVENTION;
}

/**
 * Normalizes and hemisphere-canonicalizes a rotation. q and -q therefore serialize identically.
 * When w is zero, z/y/x form a deterministic tie-breaker. Negative zero never reaches JSON.
 */
export function canonicalizeStudioPoseQuaternion(raw: unknown): StudioPoseQuaternion | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const tuple: number[] = [];
  try {
    if (Object.getPrototypeOf(raw) !== Array.prototype) return null;
    const keys = Reflect.ownKeys(raw);
    if (
      keys.length !== 5 ||
      keys.some((key) => typeof key !== "string" || !["0", "1", "2", "3", "length"].includes(key))
    ) {
      return null;
    }
    for (let index = 0; index < 4; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(raw, String(index));
      if (
        !descriptor ||
        !("value" in descriptor) ||
        !descriptor.enumerable ||
        typeof descriptor.value !== "number" ||
        !Number.isFinite(descriptor.value)
      ) {
        return null;
      }
      tuple.push(descriptor.value);
    }
  } catch {
    return null;
  }
  const [rawX, rawY, rawZ, rawW] = tuple as [number, number, number, number];
  const norm = Math.hypot(rawX, rawY, rawZ, rawW);
  if (!Number.isFinite(norm) || norm < MIN_QUATERNION_NORM) return null;

  // Preserve already-normalized wire values within floating-point tolerance. Re-dividing a parsed
  // unit quaternion can move its final bit and would make parse -> serialize non-idempotent.
  const divisor = Math.abs(norm - 1) <= 1e-12 ? 1 : norm;
  let x = rawX / divisor;
  let y = rawY / divisor;
  let z = rawZ / divisor;
  let w = rawW / divisor;
  const hemisphere = [w, z, y, x].find((component) => component !== 0) ?? 1;
  if (hemisphere < 0) {
    x = -x;
    y = -y;
    z = -z;
    w = -w;
  }
  const positiveZero = (component: number) => (Object.is(component, -0) ? 0 : component);
  return Object.freeze([
    positiveZero(x),
    positiveZero(y),
    positiveZero(z),
    positiveZero(w),
  ] as const);
}

function canonicalMetadata(raw: unknown): StudioPoseMaterialMetadata | null {
  if (!isRecord(raw) || !hasExactKeys(raw, METADATA_KEYS)) return null;
  const description = canonicalText(
    raw.description,
    STUDIO_POSE_MATERIAL_MAX_DESCRIPTION_LENGTH,
    true
  );
  if (description === null || !Array.isArray(raw.tags) || raw.tags.length > STUDIO_POSE_MATERIAL_MAX_TAGS) {
    return null;
  }
  const tags: string[] = [];
  const foldedTags = new Set<string>();
  for (const rawTag of raw.tags) {
    const tag = canonicalText(rawTag, STUDIO_POSE_MATERIAL_MAX_TAG_LENGTH, false);
    if (tag === null) return null;
    const folded = tag.toLowerCase();
    if (foldedTags.has(folded)) return null;
    foldedTags.add(folded);
    tags.push(tag);
  }
  tags.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return deepFreeze({ description, tags });
}

function canonicalMaterial(raw: unknown): StudioPoseMaterial | null {
  const decoded = decodeBoundedJson(raw);
  if (!isRecord(decoded) || !hasExactKeys(decoded, MATERIAL_KEYS)) return null;
  if (decoded.kind !== STUDIO_POSE_MATERIAL_KIND || decoded.version !== STUDIO_POSE_MATERIAL_VERSION) {
    return null;
  }
  const rotationConvention = canonicalRotationConvention(decoded.rotationConvention);
  const id = canonicalId(decoded.id);
  const name = canonicalText(decoded.name, STUDIO_POSE_MATERIAL_MAX_NAME_LENGTH, false);
  if (
    !rotationConvention ||
    !id ||
    name === null ||
    !isStudioPoseScope(decoded.scope) ||
    !Array.isArray(decoded.bones)
  ) {
    return null;
  }
  if (decoded.bones.length === 0 || decoded.bones.length > STUDIO_HUMANOID_BONE_NAMES.length) {
    return null;
  }
  const metadata = canonicalMetadata(decoded.metadata);
  if (!metadata) return null;

  const rotations = new Map<StudioHumanoidBoneName, StudioPoseQuaternion>();
  for (const rawBone of decoded.bones) {
    if (!isRecord(rawBone) || !hasExactKeys(rawBone, BONE_KEYS)) return null;
    if (!isStudioHumanoidBoneName(rawBone.bone)) return null;
    if (!isStudioHumanoidBoneInScope(rawBone.bone, decoded.scope)) return null;
    if (rotations.has(rawBone.bone)) return null;
    const rotation = canonicalizeStudioPoseQuaternion(rawBone.rotation);
    if (!rotation) return null;
    rotations.set(rawBone.bone, rotation);
  }
  const bones = STUDIO_HUMANOID_BONE_NAMES.flatMap((bone) => {
    const rotation = rotations.get(bone);
    return rotation ? [Object.freeze({ bone, rotation })] : [];
  });
  return deepFreeze({
    kind: STUDIO_POSE_MATERIAL_KIND,
    version: STUDIO_POSE_MATERIAL_VERSION,
    rotationConvention,
    id,
    name,
    scope: decoded.scope,
    bones,
    metadata,
  });
}

/** Parses JSON text or a data object into a deeply frozen canonical v1 material. */
export function parseStudioPoseMaterial(raw: unknown): StudioPoseMaterial | null {
  return canonicalMaterial(raw);
}

/** Serializes only valid data. Unknown/future fields fail closed instead of being discarded. */
export function serializeStudioPoseMaterial(raw: unknown): string | null {
  const material = canonicalMaterial(raw);
  if (!material) return null;
  const serialized = JSON.stringify(material);
  return utf8ByteLength(serialized) <= STUDIO_POSE_MATERIAL_MAX_BYTES ? serialized : null;
}

function canonicalMergeOptions(
  raw: unknown,
  defaultScope: StudioPoseScope
): { readonly scope: StudioPoseScope; readonly lockedBones: ReadonlySet<StudioHumanoidBoneName> } | null {
  if (raw === undefined) return { scope: defaultScope, lockedBones: new Set() };
  const decoded = decodeBoundedJson(raw);
  if (!isRecord(decoded) || Object.keys(decoded).some((key) => !MERGE_OPTION_KEYS.includes(key as never))) {
    return null;
  }
  const scope = decoded.scope === undefined ? defaultScope : decoded.scope;
  if (!isStudioPoseScope(scope)) return null;
  const rawLockedBones = decoded.lockedBones ?? [];
  if (!Array.isArray(rawLockedBones) || rawLockedBones.length > STUDIO_HUMANOID_BONE_NAMES.length) {
    return null;
  }
  const lockedBones = new Set<StudioHumanoidBoneName>();
  for (const bone of rawLockedBones) {
    if (!isStudioHumanoidBoneName(bone) || lockedBones.has(bone)) return null;
    lockedBones.add(bone);
  }
  return { scope, lockedBones };
}

/**
 * Creates a deterministic, immutable mutation plan. It never touches a VRM or engine node and
 * reports every skipped source bone, so UI adapters can explain partial application accurately.
 */
export function createStudioPoseMaterialMergePlan(
  rawMaterial: unknown,
  rawOptions?: StudioPoseMaterialMergeOptions
): StudioPoseMaterialMergePlan | null {
  const material = canonicalMaterial(rawMaterial);
  if (!material) return null;
  const options = canonicalMergeOptions(rawOptions, material.scope);
  if (!options) return null;

  const operations: StudioPoseMaterialMergeOperation[] = [];
  const skippedLocked: StudioHumanoidBoneName[] = [];
  const skippedOutsideScope: StudioHumanoidBoneName[] = [];
  for (const entry of material.bones) {
    if (!isStudioHumanoidBoneInScope(entry.bone, options.scope)) {
      skippedOutsideScope.push(entry.bone);
    } else if (options.lockedBones.has(entry.bone)) {
      skippedLocked.push(entry.bone);
    } else {
      operations.push(Object.freeze({ bone: entry.bone, rotation: entry.rotation }));
    }
  }
  return deepFreeze({
    materialId: material.id,
    materialScope: material.scope,
    requestedScope: options.scope,
    rotationConvention: material.rotationConvention,
    operations,
    skippedLocked,
    skippedOutsideScope,
  });
}
