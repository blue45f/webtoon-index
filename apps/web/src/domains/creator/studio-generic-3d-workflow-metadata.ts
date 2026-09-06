/**
 * Pure persistence helpers for generic (non-VRM) 3D workflow metadata on scene attachments.
 *
 * Classification and source-format maps are kept outside the engine runtime so document restore
 * can rehydrate workflow UI state without trusting free-form strings or prototype-polluting keys.
 */

import {
  isStudioGeneric3dSourceFormat,
  type StudioGeneric3dClassification,
  type StudioGeneric3dSourceFormat,
} from "./studio-generic-3d-model-mode";

export type { StudioGeneric3dClassification, StudioGeneric3dSourceFormat };

export const STUDIO_GENERIC_3D_WORKFLOW_METADATA_KEY = "generic3dWorkflow" as const;
export const STUDIO_GENERIC_3D_WORKFLOW_METADATA_VERSION = 1 as const;
export const STUDIO_GENERIC_3D_WORKFLOW_ID_MAX_LENGTH = 80;

const CLASSIFICATIONS = new Set<string>(["character", "creature", "prop"]);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,79}$/u;
const FORBIDDEN_ID_SET = new Set(["__proto__", "constructor", "prototype"]);
const WORKFLOW_KEYS = new Set(["version", "classification", "sourceFormat"]);

export interface StudioGeneric3dWorkflowMetadataInput {
  readonly classification?: unknown;
  readonly sourceFormat?: unknown;
}

export interface StudioGeneric3dWorkflowMetadata {
  readonly classification: StudioGeneric3dClassification | null;
  readonly sourceFormat: StudioGeneric3dSourceFormat | null;
}

export interface StudioGeneric3dWorkflowMetadataRecord {
  readonly version: typeof STUDIO_GENERIC_3D_WORKFLOW_METADATA_VERSION;
  readonly classification?: StudioGeneric3dClassification;
  readonly sourceFormat?: StudioGeneric3dSourceFormat;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsControlCharacter(value: string): boolean {
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

/** Accepts only the closed classification enum; rejects non-strings and unknown labels. */
export function normalizeStudioGeneric3dClassification(
  value: unknown
): StudioGeneric3dClassification | null {
  if (typeof value !== "string" || containsControlCharacter(value)) return null;
  if (!CLASSIFICATIONS.has(value)) return null;
  if (Array.from(value).length > STUDIO_GENERIC_3D_WORKFLOW_ID_MAX_LENGTH) return null;
  return value as StudioGeneric3dClassification;
}

/** Accepts only the closed generic source-format enum (VRM and other formats fail closed). */
export function normalizeStudioGeneric3dSourceFormat(
  value: unknown
): StudioGeneric3dSourceFormat | null {
  if (typeof value !== "string" || containsControlCharacter(value)) return null;
  if (Array.from(value).length > STUDIO_GENERIC_3D_WORKFLOW_ID_MAX_LENGTH) return null;
  return isStudioGeneric3dSourceFormat(value) ? value : null;
}

/**
 * Safe map / attachment ids: printable ASCII pattern, length-bounded, no prototype pollution keys
 * and no control characters.
 */
export function normalizeStudioGeneric3dWorkflowId(value: unknown): string | null {
  if (typeof value !== "string" || containsControlCharacter(value)) return null;
  if (Array.from(value).length > STUDIO_GENERIC_3D_WORKFLOW_ID_MAX_LENGTH) return null;
  if (!ID_PATTERN.test(value) || FORBIDDEN_ID_SET.has(value.toLowerCase())) return null;
  return value;
}

/**
 * Shallow-copies `attachment` and writes a sanitized `generic3dWorkflow` v1 block.
 * Invalid optional fields are omitted (fail closed) instead of being passed through.
 */
export function attachStudioGeneric3dWorkflowMetadata<T extends object>(
  attachment: T,
  meta: StudioGeneric3dWorkflowMetadataInput = {}
): T & { readonly [STUDIO_GENERIC_3D_WORKFLOW_METADATA_KEY]: StudioGeneric3dWorkflowMetadataRecord } {
  const workflow: {
    version: typeof STUDIO_GENERIC_3D_WORKFLOW_METADATA_VERSION;
    classification?: StudioGeneric3dClassification;
    sourceFormat?: StudioGeneric3dSourceFormat;
  } = {
    version: STUDIO_GENERIC_3D_WORKFLOW_METADATA_VERSION,
  };

  if (meta.classification !== undefined) {
    const classification = normalizeStudioGeneric3dClassification(meta.classification);
    if (classification) workflow.classification = classification;
  }
  if (meta.sourceFormat !== undefined) {
    const sourceFormat = normalizeStudioGeneric3dSourceFormat(meta.sourceFormat);
    if (sourceFormat) workflow.sourceFormat = sourceFormat;
  }

  return {
    ...attachment,
    [STUDIO_GENERIC_3D_WORKFLOW_METADATA_KEY]: Object.freeze(workflow),
  };
}

/**
 * Reads a v1 `generic3dWorkflow` block from an attachment-like object.
 * Unknown keys, wrong versions, and invalid field values fail closed (`null`).
 */
export function parseStudioGeneric3dWorkflowMetadata(
  attachment: unknown
): StudioGeneric3dWorkflowMetadata | null {
  if (!isRecord(attachment)) return null;
  const raw = attachment[STUDIO_GENERIC_3D_WORKFLOW_METADATA_KEY];
  if (!isRecord(raw)) return null;

  for (const key of Object.keys(raw)) {
    if (!WORKFLOW_KEYS.has(key) || FORBIDDEN_ID_SET.has(key)) return null;
  }
  if (raw.version !== STUDIO_GENERIC_3D_WORKFLOW_METADATA_VERSION) return null;

  let classification: StudioGeneric3dClassification | null = null;
  if (raw.classification !== undefined) {
    classification = normalizeStudioGeneric3dClassification(raw.classification);
    if (!classification) return null;
  }

  let sourceFormat: StudioGeneric3dSourceFormat | null = null;
  if (raw.sourceFormat !== undefined) {
    sourceFormat = normalizeStudioGeneric3dSourceFormat(raw.sourceFormat);
    if (!sourceFormat) return null;
  }

  return Object.freeze({ classification, sourceFormat });
}

/**
 * Merges workflow maps: `patch` wins on shared keys. Entries with invalid ids are dropped from
 * both sides. Values are not re-validated (callers store already-normalized enums).
 */
export function mergeStudioGeneric3dWorkflowMaps<T>(
  current: ReadonlyMap<string, T>,
  patch: ReadonlyMap<string, T>
): Map<string, T> {
  const result = new Map<string, T>();
  if (current instanceof Map || (current && typeof current[Symbol.iterator] === "function")) {
    for (const [id, value] of current) {
      const normalizedId = normalizeStudioGeneric3dWorkflowId(id);
      if (normalizedId) result.set(normalizedId, value);
    }
  }
  if (patch instanceof Map || (patch && typeof patch[Symbol.iterator] === "function")) {
    for (const [id, value] of patch) {
      const normalizedId = normalizeStudioGeneric3dWorkflowId(id);
      if (normalizedId) result.set(normalizedId, value);
    }
  }
  return result;
}
