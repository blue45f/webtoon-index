/**
 * Pure CRUD and persistence boundary for user-authored Studio BG3D line-and-tone presets.
 *
 * This module never reads or writes browser storage. Callers own the storage adapter and pass its
 * raw value to `loadStudioBg3dLtUserPresetLibrary`. Every successful mutation returns canonical
 * JSON ready for that adapter. IDs are always supplied by the caller and are never generated from
 * time, randomness, names, or array position.
 */

import {
  STUDIO_BG3D_LT_BUILT_IN_PRESETS,
  STUDIO_BG3D_LT_PRESET_MAX_COUNT,
  STUDIO_BG3D_LT_PRESET_PAYLOAD_KIND,
  STUDIO_BG3D_LT_PRESET_PAYLOAD_VERSION,
  STUDIO_BG3D_LT_PRESET_VERSION,
  parseStudioBg3dLtPresetPayload,
  serializeStudioBg3dLtPresetPayload,
  type StudioBg3dLtPreset,
  type StudioBg3dLtPresetPayload,
} from "./studio-bg3d-lt-presets";

export interface StudioBg3dLtUserPresetDraft {
  /** Stable caller-owned identity. It is validated and preserved byte-for-byte. */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly line: StudioBg3dLtPreset["line"];
  readonly tone: StudioBg3dLtPreset["tone"];
}

export type StudioBg3dLtUserPresetLoadStatus = "missing" | "loaded" | "recovered";

export interface StudioBg3dLtUserPresetLoadResult {
  readonly status: StudioBg3dLtUserPresetLoadStatus;
  readonly payload: StudioBg3dLtPresetPayload;
  readonly canonicalJson: string;
  /** True only when a present but invalid value should be replaced or quarantined by the caller. */
  readonly shouldRewrite: boolean;
}

export type StudioBg3dLtUserPresetMutationOperation =
  | "created"
  | "updated"
  | "renamed"
  | "deleted";

export type StudioBg3dLtUserPresetMutationFailureReason =
  | "invalid-payload"
  | "invalid-preset"
  | "invalid-name"
  | "built-in-id"
  | "duplicate-id"
  | "max-count"
  | "not-found"
  | "serialization-failed";

export interface StudioBg3dLtUserPresetMutationSuccess {
  readonly ok: true;
  readonly operation: StudioBg3dLtUserPresetMutationOperation;
  readonly payload: StudioBg3dLtPresetPayload;
  readonly canonicalJson: string;
  /** The canonical affected preset, or null after deletion. */
  readonly preset: StudioBg3dLtPreset | null;
}

export interface StudioBg3dLtUserPresetMutationFailure {
  readonly ok: false;
  readonly reason: StudioBg3dLtUserPresetMutationFailureReason;
}

export type StudioBg3dLtUserPresetMutationResult =
  | StudioBg3dLtUserPresetMutationSuccess
  | StudioBg3dLtUserPresetMutationFailure;

const USER_PRESET_DRAFT_KEYS = ["id", "name", "description", "line", "tone"] as const;
const BUILT_IN_ID_SET = new Set(STUDIO_BG3D_LT_BUILT_IN_PRESETS.map((preset) => preset.id));

function canonicalPayload(raw: unknown): StudioBg3dLtPresetPayload | null {
  const serialized = serializeStudioBg3dLtPresetPayload(raw);
  return serialized ? parseStudioBg3dLtPresetPayload(serialized) : null;
}

function createEmptyPayload(): StudioBg3dLtPresetPayload {
  const parsed = canonicalPayload({
    kind: STUDIO_BG3D_LT_PRESET_PAYLOAD_KIND,
    version: STUDIO_BG3D_LT_PRESET_PAYLOAD_VERSION,
    presets: [],
  });
  if (!parsed) throw new Error("Unable to create the canonical empty BG3D LT preset payload.");
  return parsed;
}

/** Shared immutable safe state for first use and corruption recovery. */
export const EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD = createEmptyPayload();

export const EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD_JSON =
  serializeStudioBg3dLtPresetPayload(EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD) ?? "";

if (!EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD_JSON) {
  throw new Error("Unable to serialize the canonical empty BG3D LT preset payload.");
}

function immutableLoadResult(
  status: StudioBg3dLtUserPresetLoadStatus,
  payload: StudioBg3dLtPresetPayload,
  canonicalJson: string,
  shouldRewrite: boolean
): StudioBg3dLtUserPresetLoadResult {
  return Object.freeze({ status, payload, canonicalJson, shouldRewrite });
}

/**
 * Converts a raw storage value into a trusted payload without touching `localStorage` or any other
 * side effect. Missing values use the shared empty payload. Present malformed values fail closed to
 * that same payload and explicitly request a caller-managed rewrite/quarantine.
 */
export function loadStudioBg3dLtUserPresetLibrary(
  raw: unknown
): StudioBg3dLtUserPresetLoadResult {
  if (raw === null || raw === undefined) {
    return immutableLoadResult(
      "missing",
      EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD,
      EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD_JSON,
      false
    );
  }
  if (typeof raw === "string") {
    const payload = parseStudioBg3dLtPresetPayload(raw);
    if (payload) {
      const canonicalJson = serializeStudioBg3dLtPresetPayload(payload);
      if (canonicalJson) return immutableLoadResult("loaded", payload, canonicalJson, false);
    }
  }
  return immutableLoadResult(
    "recovered",
    EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD,
    EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD_JSON,
    true
  );
}

/** Reads only plain enumerable data properties and never invokes draft accessors. */
function presetCandidateFromDraft(raw: unknown): StudioBg3dLtPreset | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  try {
    const prototype = Object.getPrototypeOf(raw);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(raw);
    if (
      keys.length !== USER_PRESET_DRAFT_KEYS.length ||
      keys.some((key) => typeof key !== "string" || !USER_PRESET_DRAFT_KEYS.includes(key as never))
    ) {
      return null;
    }
    const descriptors = Object.getOwnPropertyDescriptors(raw);
    for (const key of USER_PRESET_DRAFT_KEYS) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
    }
    return {
      id: descriptors.id.value as string,
      version: STUDIO_BG3D_LT_PRESET_VERSION,
      name: descriptors.name.value as string,
      description: descriptors.description.value as string,
      line: descriptors.line.value as StudioBg3dLtPreset["line"],
      tone: descriptors.tone.value as StudioBg3dLtPreset["tone"],
    };
  } catch {
    return null;
  }
}

function canonicalPresetFromDraft(raw: unknown): StudioBg3dLtPreset | null {
  const candidate = presetCandidateFromDraft(raw);
  if (!candidate) return null;
  const payload = canonicalPayload({
    kind: STUDIO_BG3D_LT_PRESET_PAYLOAD_KIND,
    version: STUDIO_BG3D_LT_PRESET_PAYLOAD_VERSION,
    presets: [candidate],
  });
  return payload?.presets[0] ?? null;
}

function draftId(raw: unknown): string | null {
  return presetCandidateFromDraft(raw)?.id ?? null;
}

function payloadFromPresets(
  presets: readonly StudioBg3dLtPreset[]
): StudioBg3dLtPresetPayload | null {
  return canonicalPayload({
    kind: STUDIO_BG3D_LT_PRESET_PAYLOAD_KIND,
    version: STUDIO_BG3D_LT_PRESET_PAYLOAD_VERSION,
    presets,
  });
}

function failure(
  reason: StudioBg3dLtUserPresetMutationFailureReason
): StudioBg3dLtUserPresetMutationFailure {
  return Object.freeze({ ok: false, reason });
}

function success(
  operation: StudioBg3dLtUserPresetMutationOperation,
  payload: StudioBg3dLtPresetPayload,
  preset: StudioBg3dLtPreset | null
): StudioBg3dLtUserPresetMutationResult {
  const canonicalJson = serializeStudioBg3dLtPresetPayload(payload);
  if (!canonicalJson) return failure("serialization-failed");
  return Object.freeze({ ok: true, operation, payload, canonicalJson, preset });
}

function trustedMutationPayload(raw: unknown): StudioBg3dLtPresetPayload | null {
  return canonicalPayload(raw);
}

/**
 * Adds one canonical user preset. The caller-supplied id is preserved exactly; duplicates and
 * built-in ids are rejected rather than renamed or suffixed implicitly.
 */
export function createStudioBg3dLtUserPreset(
  rawPayload: unknown,
  rawDraft: unknown
): StudioBg3dLtUserPresetMutationResult {
  const payload = trustedMutationPayload(rawPayload);
  if (!payload) return failure("invalid-payload");
  const id = draftId(rawDraft);
  if (!id) return failure("invalid-preset");
  if (BUILT_IN_ID_SET.has(id)) return failure("built-in-id");
  const preset = canonicalPresetFromDraft(rawDraft);
  if (!preset) return failure("invalid-preset");
  if (payload.presets.some((entry) => entry.id === preset.id)) return failure("duplicate-id");
  if (payload.presets.length >= STUDIO_BG3D_LT_PRESET_MAX_COUNT) return failure("max-count");
  const next = payloadFromPresets([...payload.presets, preset]);
  return next ? success("created", next, next.presets.find((entry) => entry.id === preset.id) ?? null) : failure("serialization-failed");
}

/**
 * Replaces the exact matching id or creates it when absent. Replacement remains allowed at the
 * maximum count because it never increases storage cardinality.
 */
export function upsertStudioBg3dLtUserPreset(
  rawPayload: unknown,
  rawDraft: unknown
): StudioBg3dLtUserPresetMutationResult {
  const payload = trustedMutationPayload(rawPayload);
  if (!payload) return failure("invalid-payload");
  const id = draftId(rawDraft);
  if (!id) return failure("invalid-preset");
  if (BUILT_IN_ID_SET.has(id)) return failure("built-in-id");
  const preset = canonicalPresetFromDraft(rawDraft);
  if (!preset) return failure("invalid-preset");
  const existingIndex = payload.presets.findIndex((entry) => entry.id === preset.id);
  if (existingIndex < 0 && payload.presets.length >= STUDIO_BG3D_LT_PRESET_MAX_COUNT) {
    return failure("max-count");
  }
  const nextPresets = existingIndex < 0
    ? [...payload.presets, preset]
    : payload.presets.map((entry, index) => (index === existingIndex ? preset : entry));
  const next = payloadFromPresets(nextPresets);
  return next
    ? success(
      existingIndex < 0 ? "created" : "updated",
      next,
      next.presets.find((entry) => entry.id === preset.id) ?? null
    )
    : failure("serialization-failed");
}

/** Changes only the display name. Stable ids, description, line, and tone data are preserved. */
export function renameStudioBg3dLtUserPreset(
  rawPayload: unknown,
  id: string,
  name: string
): StudioBg3dLtUserPresetMutationResult {
  const payload = trustedMutationPayload(rawPayload);
  if (!payload) return failure("invalid-payload");
  if (BUILT_IN_ID_SET.has(id)) return failure("built-in-id");
  const existingIndex = payload.presets.findIndex((entry) => entry.id === id);
  if (existingIndex < 0) return failure("not-found");
  const existing = payload.presets[existingIndex];
  const renamed: StudioBg3dLtPreset = { ...existing, name };
  const next = payloadFromPresets(
    payload.presets.map((entry, index) => (index === existingIndex ? renamed : entry))
  );
  if (!next) return failure("invalid-name");
  return success("renamed", next, next.presets.find((entry) => entry.id === id) ?? null);
}

/** Removes one exact user id. Built-in presets are outside this payload and cannot be deleted. */
export function deleteStudioBg3dLtUserPreset(
  rawPayload: unknown,
  id: string
): StudioBg3dLtUserPresetMutationResult {
  const payload = trustedMutationPayload(rawPayload);
  if (!payload) return failure("invalid-payload");
  if (BUILT_IN_ID_SET.has(id)) return failure("built-in-id");
  if (!payload.presets.some((entry) => entry.id === id)) return failure("not-found");
  const next = payloadFromPresets(payload.presets.filter((entry) => entry.id !== id));
  return next ? success("deleted", next, null) : failure("serialization-failed");
}
