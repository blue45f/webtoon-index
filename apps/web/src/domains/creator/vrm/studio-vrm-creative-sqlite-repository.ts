/**
 * Shared V12 SQLite/OPFS authority for user-authored VRM poses and full poser states.
 *
 * The two libraries intentionally use separate KV namespaces. Product reads never probe the
 * pre-V12 browser KV keys; explicit JSON import remains the only legacy ingress. Each row is a
 * bounded, strict, canonical document so a malformed member cannot be loaded as a partial library.
 */

import { isStudioHumanoidBoneName } from "../studio-humanoid-bones";
import { acquireStudioLocalDatabase } from "../studio-local-database-runtime";

import {
  EMPTY_STUDIO_VRM_POSE_TRANSLATIONS,
  cloneStudioVrmPoseTranslations,
  normalizeStudioVrmPoseTranslations,
} from "./studio-vrm-pose-translations";
import {
  deserializeFullVrmState,
  type FullVrmState,
  type PoseBone,
  type PoseBoneMap,
} from "./studio-vrm-poser-utils";

import type { StudioLocalDatabase } from "../studio-local-database";
import type { StudioVrmPoseTranslations } from "./studio-vrm-scene-document";

export const STUDIO_VRM_CUSTOM_POSE_SQLITE_NAMESPACE = "studio-vrm-custom-poses-v12";
export const STUDIO_VRM_FULL_STATE_SQLITE_NAMESPACE = "studio-vrm-full-poser-states-v12";
export const STUDIO_VRM_CREATIVE_SQLITE_KEY = "library-v1";

export const STUDIO_VRM_CUSTOM_POSE_LIBRARY_MAX_COUNT = 256;
export const STUDIO_VRM_CUSTOM_POSE_LIBRARY_MAX_BYTES = 4 * 1024 * 1024;
export const STUDIO_VRM_CUSTOM_POSE_MAX_LABEL_LENGTH = 80;
export const STUDIO_VRM_FULL_STATE_LIBRARY_MAX_COUNT = 100;
export const STUDIO_VRM_FULL_STATE_LIBRARY_MAX_BYTES = 16 * 1024 * 1024;
export const STUDIO_VRM_FULL_STATE_MAX_BYTES = 2 * 1024 * 1024;
export const STUDIO_VRM_FULL_STATE_MAX_NAME_LENGTH = 24;

const CUSTOM_POSE_LIBRARY_KIND = "toonspectrum.studio-vrm-custom-pose-library" as const;
const FULL_STATE_LIBRARY_KIND = "toonspectrum.studio-vrm-full-state-library" as const;
const LIBRARY_VERSION = 1 as const;
const CUSTOM_POSE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const UTF8_ENCODER = new TextEncoder();

export interface StudioVrmCustomPose {
  readonly id: string;
  readonly label: string;
  readonly yOffset: number;
  readonly bones: PoseBoneMap;
  readonly poseTranslations: StudioVrmPoseTranslations;
  readonly expressionWeights: Readonly<Record<string, number>>;
}

interface StudioVrmCustomPoseLibraryV1 {
  readonly kind: typeof CUSTOM_POSE_LIBRARY_KIND;
  readonly version: typeof LIBRARY_VERSION;
  readonly poses: readonly StudioVrmCustomPose[];
}

interface StudioVrmFullStateEntryV1 {
  readonly name: string;
  readonly state: FullVrmState;
}

interface StudioVrmFullStateLibraryV1 {
  readonly kind: typeof FULL_STATE_LIBRARY_KIND;
  readonly version: typeof LIBRARY_VERSION;
  readonly states: readonly StudioVrmFullStateEntryV1[];
}

export type StudioVrmCreativeSqliteErrorCode =
  | "invalid"
  | "limit"
  | "unavailable";

export class StudioVrmCreativeSqliteError extends Error {
  readonly code: StudioVrmCreativeSqliteErrorCode;

  constructor(
    code: StudioVrmCreativeSqliteErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StudioVrmCreativeSqliteError";
    this.code = code;
  }
}

export interface StudioVrmCreativeSqliteRepository {
  readonly authority: "sqlite";
  loadCustomPoses(): Promise<StudioVrmCustomPose[]>;
  saveCustomPoses(poses: readonly StudioVrmCustomPose[]): Promise<StudioVrmCustomPose[]>;
  loadFullStates(): Promise<Record<string, FullVrmState>>;
  saveFullStates(states: Readonly<Record<string, FullVrmState>>): Promise<Record<string, FullVrmState>>;
}

export interface StudioVrmCreativeSqliteRepositoryOptions {
  readonly acquireDatabase?: () => Promise<StudioLocalDatabase>;
}

function byteLength(value: string): number {
  return UTF8_ENCODER.encode(value).byteLength;
}

function plainRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (
      (prototype !== Object.prototype && prototype !== null)
      || Object.getOwnPropertySymbols(value).length > 0
    ) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result: Record<string, unknown> = {};
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (
        FORBIDDEN_KEYS.has(key)
        || !("value" in descriptor)
        || !descriptor.enumerable
      ) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return null;
  }
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function isCanonicalText(value: unknown, maximum: number): value is string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maximum
    || value !== value.normalize("NFKC").trim().replace(/\s+/gu, " ")
  ) return false;
  return !Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  const record = plainRecord(value);
  if (!record) return value;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    const entry = record[key];
    if (entry !== undefined) result[key] = canonicalJsonValue(entry);
  }
  return result;
}

function canonicalPoseBoneMap(value: PoseBoneMap): PoseBoneMap {
  const result: PoseBoneMap = {};
  for (const key of Object.keys(value).sort()) {
    if (!isStudioHumanoidBoneName(key)) continue;
    const bone = value[key];
    if (!bone) continue;
    const canonical: PoseBone = {};
    if (bone.direction !== undefined) {
      canonical.direction = canonicalJsonValue(bone.direction) as PoseBone["direction"];
    }
    if (bone.rotation !== undefined) {
      canonical.rotation = [bone.rotation[0], bone.rotation[1], bone.rotation[2]];
    }
    result[key] = canonical;
  }
  return result;
}

function canonicalNumberRecord(value: Readonly<Record<string, number>>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const key of Object.keys(value).sort()) result[key] = value[key]!;
  return result;
}

function normalizeCustomPose(
  value: unknown,
  options: { readonly explicitImport: boolean },
): StudioVrmCustomPose | null {
  const record = plainRecord(value);
  if (!record) return null;
  const required = ["id", "label", "yOffset", "bones"];
  const optional = ["poseTranslations", "expressionWeights"];
  const keys = Object.keys(record);
  if (
    required.some((key) => !Object.prototype.hasOwnProperty.call(record, key))
    || keys.some((key) => !required.includes(key) && !optional.includes(key))
    || (!options.explicitImport && !hasExactKeys(record, [...required, ...optional]))
    || typeof record.id !== "string"
    || !CUSTOM_POSE_ID_PATTERN.test(record.id)
    || !isCanonicalText(record.label, STUDIO_VRM_CUSTOM_POSE_MAX_LABEL_LENGTH)
  ) return null;

  const translations = record.poseTranslations === undefined && options.explicitImport
    ? EMPTY_STUDIO_VRM_POSE_TRANSLATIONS
    : normalizeStudioVrmPoseTranslations(record.poseTranslations);
  const expressionWeights = record.expressionWeights === undefined && options.explicitImport
    ? {}
    : record.expressionWeights;
  if (!translations || !plainRecord(expressionWeights)) return null;

  const validated = deserializeFullVrmState({
    version: 3,
    bones: record.bones,
    yOffset: record.yOffset,
    poseTranslations: translations,
    ikConstraints: [],
    bodyRotation: 0,
    expressionWeights,
  });
  if (!validated || !validated.expressionWeights) return null;

  return Object.freeze({
    id: record.id,
    label: record.label,
    yOffset: validated.yOffset,
    bones: canonicalPoseBoneMap(validated.bones),
    poseTranslations: cloneStudioVrmPoseTranslations(validated.poseTranslations),
    expressionWeights: canonicalNumberRecord(validated.expressionWeights),
  });
}

function normalizeCustomPoses(
  values: unknown,
  options: { readonly explicitImport: boolean },
): StudioVrmCustomPose[] {
  if (!Array.isArray(values) || values.length > STUDIO_VRM_CUSTOM_POSE_LIBRARY_MAX_COUNT) {
    throw new StudioVrmCreativeSqliteError(
      "limit",
      `VRM custom pose library exceeds ${STUDIO_VRM_CUSTOM_POSE_LIBRARY_MAX_COUNT} entries.`,
    );
  }
  const ids = new Set<string>();
  const result: StudioVrmCustomPose[] = [];
  for (const value of values) {
    const pose = normalizeCustomPose(value, options);
    if (!pose || ids.has(pose.id)) {
      throw new StudioVrmCreativeSqliteError(
        "invalid",
        "VRM custom pose library contains an invalid or duplicate entry.",
      );
    }
    ids.add(pose.id);
    result.push(pose);
  }
  return result;
}

function customPoseEnvelope(poses: readonly StudioVrmCustomPose[]): StudioVrmCustomPoseLibraryV1 {
  return {
    kind: CUSTOM_POSE_LIBRARY_KIND,
    version: LIBRARY_VERSION,
    poses,
  };
}

export function serializeStudioVrmCustomPoseLibrary(
  poses: readonly StudioVrmCustomPose[],
): string {
  const normalized = normalizeCustomPoses(poses, { explicitImport: false });
  const serialized = JSON.stringify(customPoseEnvelope(normalized));
  if (byteLength(serialized) > STUDIO_VRM_CUSTOM_POSE_LIBRARY_MAX_BYTES) {
    throw new StudioVrmCreativeSqliteError(
      "limit",
      "VRM custom pose library exceeds its 4 MiB UTF-8 budget.",
    );
  }
  return serialized;
}

export function parseCanonicalStudioVrmCustomPoseLibrary(raw: string): StudioVrmCustomPose[] {
  if (byteLength(raw) > STUDIO_VRM_CUSTOM_POSE_LIBRARY_MAX_BYTES) {
    throw new StudioVrmCreativeSqliteError("limit", "VRM custom pose SQLite row is too large.");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch {
    throw new StudioVrmCreativeSqliteError("invalid", "VRM custom pose SQLite JSON is corrupt.");
  }
  const record = plainRecord(decoded);
  if (
    !record
    || !hasExactKeys(record, ["kind", "version", "poses"])
    || record.kind !== CUSTOM_POSE_LIBRARY_KIND
    || record.version !== LIBRARY_VERSION
  ) {
    throw new StudioVrmCreativeSqliteError("invalid", "VRM custom pose SQLite envelope is invalid.");
  }
  const poses = normalizeCustomPoses(record.poses, { explicitImport: false });
  if (JSON.stringify(customPoseEnvelope(poses)) !== raw) {
    throw new StudioVrmCreativeSqliteError(
      "invalid",
      "VRM custom pose SQLite row is not canonical JSON.",
    );
  }
  return poses;
}

/** Explicit file-import seam. It never probes an old browser KV key and rejects partial input. */
export function parseStudioVrmCustomPoseImport(
  value: unknown,
  createId: (index: number) => string,
): StudioVrmCustomPose[] {
  let decoded = value;
  if (typeof value === "string") {
    if (byteLength(value) > STUDIO_VRM_CUSTOM_POSE_LIBRARY_MAX_BYTES) {
      throw new StudioVrmCreativeSqliteError("limit", "Imported VRM pose JSON is too large.");
    }
    try {
      decoded = JSON.parse(value) as unknown;
    } catch {
      throw new StudioVrmCreativeSqliteError("invalid", "Imported VRM pose JSON is corrupt.");
    }
  }
  if (!Array.isArray(decoded)) {
    throw new StudioVrmCreativeSqliteError("invalid", "Imported VRM poses must be one JSON array.");
  }
  const remapped = decoded.map((entry, index) => {
    const record = plainRecord(entry);
    if (!record) return entry;
    return { ...record, id: createId(index) };
  });
  return normalizeCustomPoses(remapped, { explicitImport: true });
}

function normalizeFullState(value: unknown): FullVrmState | null {
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return null;
  }
  if (byteLength(json) > STUDIO_VRM_FULL_STATE_MAX_BYTES) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(json) as unknown;
  } catch {
    return null;
  }
  const state = deserializeFullVrmState(decoded);
  if (!state) return null;
  return JSON.parse(JSON.stringify(state)) as FullVrmState;
}

function normalizeFullStateEntries(value: unknown): StudioVrmFullStateEntryV1[] {
  if (!Array.isArray(value) || value.length > STUDIO_VRM_FULL_STATE_LIBRARY_MAX_COUNT) {
    throw new StudioVrmCreativeSqliteError(
      "limit",
      `VRM full-state library exceeds ${STUDIO_VRM_FULL_STATE_LIBRARY_MAX_COUNT} entries.`,
    );
  }
  const names = new Set<string>();
  const entries: StudioVrmFullStateEntryV1[] = [];
  for (const candidate of value) {
    const record = plainRecord(candidate);
    const state = record ? normalizeFullState(record.state) : null;
    if (
      !record
      || !hasExactKeys(record, ["name", "state"])
      || !isCanonicalText(record.name, STUDIO_VRM_FULL_STATE_MAX_NAME_LENGTH)
      || names.has(record.name)
      || !state
    ) {
      throw new StudioVrmCreativeSqliteError(
        "invalid",
        "VRM full-state library contains an invalid or duplicate entry.",
      );
    }
    names.add(record.name);
    entries.push({ name: record.name, state });
  }
  return entries.sort((left, right) => (
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  ));
}

function fullStateEnvelope(states: readonly StudioVrmFullStateEntryV1[]): StudioVrmFullStateLibraryV1 {
  return {
    kind: FULL_STATE_LIBRARY_KIND,
    version: LIBRARY_VERSION,
    states,
  };
}

function fullStateRecord(entries: readonly StudioVrmFullStateEntryV1[]): Record<string, FullVrmState> {
  const result: Record<string, FullVrmState> = Object.create(null) as Record<string, FullVrmState>;
  for (const entry of entries) result[entry.name] = entry.state;
  return result;
}

export function serializeStudioVrmFullStateLibrary(
  states: Readonly<Record<string, FullVrmState>>,
): string {
  const record = plainRecord(states);
  if (!record) {
    throw new StudioVrmCreativeSqliteError("invalid", "VRM full-state library must be a plain record.");
  }
  const entries = normalizeFullStateEntries(Object.entries(record).map(([name, state]) => ({
    name,
    state,
  })));
  const serialized = JSON.stringify(fullStateEnvelope(entries));
  if (byteLength(serialized) > STUDIO_VRM_FULL_STATE_LIBRARY_MAX_BYTES) {
    throw new StudioVrmCreativeSqliteError(
      "limit",
      "VRM full-state library exceeds its 16 MiB UTF-8 budget.",
    );
  }
  return serialized;
}

export function parseCanonicalStudioVrmFullStateLibrary(
  raw: string,
): Record<string, FullVrmState> {
  if (byteLength(raw) > STUDIO_VRM_FULL_STATE_LIBRARY_MAX_BYTES) {
    throw new StudioVrmCreativeSqliteError("limit", "VRM full-state SQLite row is too large.");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch {
    throw new StudioVrmCreativeSqliteError("invalid", "VRM full-state SQLite JSON is corrupt.");
  }
  const record = plainRecord(decoded);
  if (
    !record
    || !hasExactKeys(record, ["kind", "version", "states"])
    || record.kind !== FULL_STATE_LIBRARY_KIND
    || record.version !== LIBRARY_VERSION
  ) {
    throw new StudioVrmCreativeSqliteError("invalid", "VRM full-state SQLite envelope is invalid.");
  }
  const entries = normalizeFullStateEntries(record.states);
  if (JSON.stringify(fullStateEnvelope(entries)) !== raw) {
    throw new StudioVrmCreativeSqliteError(
      "invalid",
      "VRM full-state SQLite row is not canonical JSON.",
    );
  }
  return fullStateRecord(entries);
}

function wrapUnavailable(error: unknown, operation: string): never {
  if (error instanceof StudioVrmCreativeSqliteError) throw error;
  throw new StudioVrmCreativeSqliteError(
    "unavailable",
    `VRM creative SQLite ${operation} failed: ${error instanceof Error ? error.message : String(error)}`,
    { cause: error },
  );
}

export function createStudioVrmCreativeSqliteRepository(
  options: StudioVrmCreativeSqliteRepositoryOptions = {},
): StudioVrmCreativeSqliteRepository {
  const acquireDatabase = options.acquireDatabase ?? acquireStudioLocalDatabase;
  let mutationTail: Promise<void> = Promise.resolve();

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = mutationTail.then(operation, operation);
    mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  async function database(): Promise<StudioLocalDatabase> {
    try {
      return await acquireDatabase();
    } catch (error) {
      wrapUnavailable(error, "open");
    }
  }

  return {
    authority: "sqlite",

    async loadCustomPoses() {
      await mutationTail;
      try {
        const raw = await (await database()).kvGet(
          STUDIO_VRM_CUSTOM_POSE_SQLITE_NAMESPACE,
          STUDIO_VRM_CREATIVE_SQLITE_KEY,
        );
        return raw === null ? [] : parseCanonicalStudioVrmCustomPoseLibrary(raw);
      } catch (error) {
        wrapUnavailable(error, "custom-pose read");
      }
    },

    saveCustomPoses(poses) {
      const serialized = serializeStudioVrmCustomPoseLibrary(poses);
      const canonical = parseCanonicalStudioVrmCustomPoseLibrary(serialized);
      return enqueue(async () => {
        try {
          await (await database()).kvSet(
            STUDIO_VRM_CUSTOM_POSE_SQLITE_NAMESPACE,
            STUDIO_VRM_CREATIVE_SQLITE_KEY,
            serialized,
          );
          return canonical;
        } catch (error) {
          wrapUnavailable(error, "custom-pose write");
        }
      });
    },

    async loadFullStates() {
      await mutationTail;
      try {
        const raw = await (await database()).kvGet(
          STUDIO_VRM_FULL_STATE_SQLITE_NAMESPACE,
          STUDIO_VRM_CREATIVE_SQLITE_KEY,
        );
        return raw === null ? {} : parseCanonicalStudioVrmFullStateLibrary(raw);
      } catch (error) {
        wrapUnavailable(error, "full-state read");
      }
    },

    saveFullStates(states) {
      const serialized = serializeStudioVrmFullStateLibrary(states);
      const canonical = parseCanonicalStudioVrmFullStateLibrary(serialized);
      return enqueue(async () => {
        try {
          await (await database()).kvSet(
            STUDIO_VRM_FULL_STATE_SQLITE_NAMESPACE,
            STUDIO_VRM_CREATIVE_SQLITE_KEY,
            serialized,
          );
          return canonical;
        } catch (error) {
          wrapUnavailable(error, "full-state write");
        }
      });
    },
  };
}
