/** Shared V12 SQLite/OPFS authority for mannequin state and BG3D LT user presets. */

import {
  EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD,
} from "../bg3d/studio-bg3d-lt-preset-library";
import {
  STUDIO_BG3D_LT_PRESET_MAX_BYTES,
  parseStudioBg3dLtPresetPayload,
  serializeStudioBg3dLtPresetPayload,
  type StudioBg3dLtPresetPayload,
} from "../bg3d/studio-bg3d-lt-presets";
import { acquireStudioLocalDatabase } from "../studio-local-database-runtime";

import {
  STUDIO_MANNEQUIN_STATE_DOC_MAX_BYTES,
  normalizeStudioMannequinPose,
  parseStudioMannequinState,
  serializeStudioMannequinState,
  type StudioMannequinPersistentState,
} from "./studio-mannequin-poses";

import type { StudioLocalDatabase } from "../studio-local-database";

export const STUDIO_MANNEQUIN_STATE_SQLITE_NAMESPACE =
  "studio-mannequin-state-v12" as const;
export const STUDIO_MANNEQUIN_STATE_SQLITE_KEY = "state-v1" as const;
export const STUDIO_BG3D_LT_PRESET_SQLITE_NAMESPACE =
  "studio-bg3d-lt-user-presets-v12" as const;
export const STUDIO_BG3D_LT_PRESET_SQLITE_KEY = "library-v1" as const;

export type StudioSmallCreativeSqliteErrorCode = "invalid" | "unavailable";

export class StudioSmallCreativeSqliteError extends Error {
  readonly code: StudioSmallCreativeSqliteErrorCode;

  constructor(
    code: StudioSmallCreativeSqliteErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StudioSmallCreativeSqliteError";
    this.code = code;
  }
}

export interface StudioMannequinStateSqliteRepository {
  readonly authority: "sqlite";
  load(): Promise<StudioMannequinPersistentState | null>;
  save(state: StudioMannequinPersistentState): Promise<StudioMannequinPersistentState>;
}

export interface StudioBg3dLtPresetSqliteRepository {
  readonly authority: "sqlite";
  load(): Promise<StudioBg3dLtPresetPayload>;
  save(payload: StudioBg3dLtPresetPayload): Promise<StudioBg3dLtPresetPayload>;
}

export interface StudioSmallCreativeSqliteRepositoryOptions {
  readonly acquireDatabase?: () => Promise<StudioLocalDatabase>;
}

const UTF8_ENCODER = new TextEncoder();

function byteLength(value: string): number {
  return UTF8_ENCODER.encode(value).byteLength;
}

function invalid(message: string, cause?: unknown): never {
  throw new StudioSmallCreativeSqliteError(
    "invalid",
    message,
    cause === undefined ? undefined : { cause },
  );
}

function unavailable(operation: string, cause: unknown): never {
  if (cause instanceof StudioSmallCreativeSqliteError) throw cause;
  throw new StudioSmallCreativeSqliteError(
    "unavailable",
    `${operation}: ${cause instanceof Error ? cause.message : String(cause)}`,
    { cause },
  );
}

function sameNumber(left: number, right: number): boolean {
  return left === right || (Object.is(left, -0) && right === 0);
}

function sameQuantizedPoseNumber(left: number, right: number): boolean {
  return sameNumber(left, right) || Math.abs(left - right) <= 0.00000051;
}

function isCanonicalMannequinInput(
  input: StudioMannequinPersistentState,
  canonical: StudioMannequinPersistentState,
): boolean {
  if (
    typeof input !== "object" ||
    input === null ||
    Object.keys(input).sort().join("|") !== "params|pose"
  ) {
    return false;
  }
  if (
    typeof input.params !== "object" ||
    input.params === null ||
    Array.isArray(input.params) ||
    typeof input.pose !== "object" ||
    input.pose === null ||
    Array.isArray(input.pose)
  ) {
    return false;
  }
  const inputParamKeys = Object.keys(input.params).sort();
  const canonicalParamKeys = Object.keys(canonical.params).sort();
  if (
    inputParamKeys.length !== canonicalParamKeys.length ||
    inputParamKeys.some((key, index) => key !== canonicalParamKeys[index])
  ) {
    return false;
  }
  for (const key of canonicalParamKeys) {
    const param = key as keyof StudioMannequinPersistentState["params"];
    const left = input.params[param];
    const right = canonical.params[param];
    if (left === undefined || right === undefined) {
      if (left !== right) return false;
    } else if (!sameNumber(left, right)) {
      return false;
    }
  }
  if (Object.keys(input.pose).sort().join("|") !== "joints|pelvisOffset") {
    return false;
  }
  if (
    !Array.isArray(input.pose.pelvisOffset) ||
    input.pose.pelvisOffset.length !== 3 ||
    input.pose.pelvisOffset.some((value) => !Number.isFinite(value)) ||
    typeof input.pose.joints !== "object" ||
    input.pose.joints === null ||
    Array.isArray(input.pose.joints)
  ) {
    return false;
  }
  for (let index = 0; index < 3; index += 1) {
    if (!sameQuantizedPoseNumber(
      input.pose.pelvisOffset[index],
      canonical.pose.pelvisOffset[index],
    )) {
      return false;
    }
  }
  const normalized = normalizeStudioMannequinPose(input.pose);
  const inputJointKeys = Object.keys(input.pose.joints).sort();
  const normalizedJointKeys = Object.keys(normalized.joints).sort();
  if (
    inputJointKeys.length !== normalizedJointKeys.length ||
    inputJointKeys.some((key, index) => key !== normalizedJointKeys[index])
  ) {
    return false;
  }
  for (const jointId of normalizedJointKeys) {
    const inputRotation = input.pose.joints[
      jointId as keyof typeof input.pose.joints
    ];
    const normalizedRotation = normalized.joints[
      jointId as keyof typeof normalized.joints
    ];
    if (!inputRotation || !normalizedRotation) return false;
    for (let index = 0; index < 3; index += 1) {
      if (!sameQuantizedPoseNumber(inputRotation[index], normalizedRotation[index])) return false;
    }
  }
  return true;
}

export function parseCanonicalStudioMannequinSqliteState(
  raw: string,
): StudioMannequinPersistentState {
  if (byteLength(raw) > STUDIO_MANNEQUIN_STATE_DOC_MAX_BYTES) {
    invalid("Mannequin SQLite state exceeds the 24 KiB byte budget.");
  }
  const parsed = parseStudioMannequinState(raw);
  if (!parsed || serializeStudioMannequinState(parsed) !== raw) {
    invalid("Mannequin SQLite state is corrupt, future, unknown-field, or non-canonical data.");
  }
  return parsed;
}

function serializeCanonicalMannequinState(
  state: StudioMannequinPersistentState,
): { readonly raw: string; readonly state: StudioMannequinPersistentState } {
  let raw: string;
  try {
    raw = serializeStudioMannequinState(state);
  } catch (cause) {
    invalid("Mannequin state cannot be serialized.", cause);
  }
  const canonical = parseCanonicalStudioMannequinSqliteState(raw);
  if (!isCanonicalMannequinInput(state, canonical)) {
    invalid("Mannequin state would require silent field removal, clamping, or normalization.");
  }
  return { raw, state: canonical };
}

export function parseCanonicalStudioBg3dLtPresetSqlitePayload(
  raw: string,
): StudioBg3dLtPresetPayload {
  if (byteLength(raw) > STUDIO_BG3D_LT_PRESET_MAX_BYTES) {
    invalid("BG3D LT preset SQLite row exceeds the 64 KiB byte budget.");
  }
  const parsed = parseStudioBg3dLtPresetPayload(raw);
  const canonical = parsed ? serializeStudioBg3dLtPresetPayload(parsed) : null;
  if (!parsed || canonical !== raw) {
    invalid("BG3D LT preset SQLite row is corrupt, future, unknown-field, or non-canonical data.");
  }
  return parsed;
}

function serializeCanonicalStudioBg3dLtPresetPayload(
  payload: StudioBg3dLtPresetPayload,
): { readonly raw: string; readonly payload: StudioBg3dLtPresetPayload } {
  const raw = serializeStudioBg3dLtPresetPayload(payload);
  if (!raw) {
    invalid("BG3D LT preset payload violates its schema, count, or byte budget.");
  }
  return { raw, payload: parseCanonicalStudioBg3dLtPresetSqlitePayload(raw) };
}

async function openDatabase(
  acquireDatabase: () => Promise<StudioLocalDatabase>,
  operation: string,
): Promise<StudioLocalDatabase> {
  try {
    return await acquireDatabase();
  } catch (cause) {
    unavailable(operation, cause);
  }
}

export function createStudioMannequinStateSqliteRepository(
  options: StudioSmallCreativeSqliteRepositoryOptions = {},
): StudioMannequinStateSqliteRepository {
  const acquireDatabase = options.acquireDatabase ?? acquireStudioLocalDatabase;
  let mutationTail: Promise<void> = Promise.resolve();

  return {
    authority: "sqlite",

    async load() {
      await mutationTail;
      try {
        const database = await openDatabase(acquireDatabase, "Mannequin SQLite open failed");
        const raw = await database.kvGet(
          STUDIO_MANNEQUIN_STATE_SQLITE_NAMESPACE,
          STUDIO_MANNEQUIN_STATE_SQLITE_KEY,
        );
        return raw === null ? null : parseCanonicalStudioMannequinSqliteState(raw);
      } catch (cause) {
        unavailable("Mannequin SQLite read failed", cause);
      }
    },

    save(state) {
      const canonical = serializeCanonicalMannequinState(state);
      const result = mutationTail.then(async () => {
        try {
          const database = await openDatabase(acquireDatabase, "Mannequin SQLite open failed");
          await database.kvSet(
            STUDIO_MANNEQUIN_STATE_SQLITE_NAMESPACE,
            STUDIO_MANNEQUIN_STATE_SQLITE_KEY,
            canonical.raw,
          );
          return canonical.state;
        } catch (cause) {
          unavailable("Mannequin SQLite write failed", cause);
        }
      });
      mutationTail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}

export function createStudioBg3dLtPresetSqliteRepository(
  options: StudioSmallCreativeSqliteRepositoryOptions = {},
): StudioBg3dLtPresetSqliteRepository {
  const acquireDatabase = options.acquireDatabase ?? acquireStudioLocalDatabase;
  let mutationTail: Promise<void> = Promise.resolve();

  return {
    authority: "sqlite",

    async load() {
      await mutationTail;
      try {
        const database = await openDatabase(acquireDatabase, "BG3D LT SQLite open failed");
        const raw = await database.kvGet(
          STUDIO_BG3D_LT_PRESET_SQLITE_NAMESPACE,
          STUDIO_BG3D_LT_PRESET_SQLITE_KEY,
        );
        return raw === null
          ? EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD
          : parseCanonicalStudioBg3dLtPresetSqlitePayload(raw);
      } catch (cause) {
        unavailable("BG3D LT SQLite read failed", cause);
      }
    },

    save(payload) {
      const canonical = serializeCanonicalStudioBg3dLtPresetPayload(payload);
      const result = mutationTail.then(async () => {
        try {
          const database = await openDatabase(acquireDatabase, "BG3D LT SQLite open failed");
          await database.kvSet(
            STUDIO_BG3D_LT_PRESET_SQLITE_NAMESPACE,
            STUDIO_BG3D_LT_PRESET_SQLITE_KEY,
            canonical.raw,
          );
          return canonical.payload;
        } catch (cause) {
          unavailable("BG3D LT SQLite write failed", cause);
        }
      });
      mutationTail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}

let productMannequinRepository: StudioMannequinStateSqliteRepository | null = null;
let productBg3dLtPresetRepository: StudioBg3dLtPresetSqliteRepository | null = null;

export function getProductStudioMannequinStateSqliteRepository(): StudioMannequinStateSqliteRepository {
  productMannequinRepository ??= createStudioMannequinStateSqliteRepository();
  return productMannequinRepository;
}

export function getProductStudioBg3dLtPresetSqliteRepository(): StudioBg3dLtPresetSqliteRepository {
  productBg3dLtPresetRepository ??= createStudioBg3dLtPresetSqliteRepository();
  return productBg3dLtPresetRepository;
}
