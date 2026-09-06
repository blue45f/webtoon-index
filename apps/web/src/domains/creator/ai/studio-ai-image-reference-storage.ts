import {
  createEmptyStudioAiImageReferenceDocument,
  hydrateStudioAiImageReferenceDocument,
  serializeStudioAiImageReferenceDocument,
  type StudioAiImageReferenceDocument,
} from "./studio-ai-image-reference-roles";

/**
 * Legacy/test-only Web Storage adapter. V12 product authority is the canonical
 * `aiImageReferences` field in StudioProjectFile/StudioProjectSnapshot and its
 * OPFS/SQLite autosave journal. Product boot must not call this module or
 * automatically import these keys (`LEGACY_DATA_MIGRATION=FALSE`).
 */

export const STUDIO_AI_IMAGE_REFERENCE_STORAGE_VERSION = 1 as const;
export const STUDIO_AI_IMAGE_REFERENCE_STORAGE_PREFIX =
  `toonspectrum-studio-ai-image-references:v${STUDIO_AI_IMAGE_REFERENCE_STORAGE_VERSION}`;

export const STUDIO_AI_IMAGE_REFERENCE_STORAGE_LIMITS = Object.freeze({
  maxScopePreviewLength: 48,
  maxStorageKeyLength: 240,
});

export interface StudioAiImageReferenceStorageScope {
  /** Project/work identity is mandatory so references cannot leak into an unrelated document. */
  readonly workId: string;
  /** Optional authenticated owner scope. Missing or blank values use the isolated guest scope. */
  readonly userScope?: string | null;
}

export interface StudioAiImageReferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const UNSAFE_KEY_PREVIEW_PATTERN = /[^A-Za-z0-9._-]+/gu;

function replaceControlCharacters(value: string): string {
  let normalized = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    normalized += code <= 31 || (code >= 127 && code <= 159) ? " " : value[index];
  }
  return normalized;
}

function normalizeScopeSource(value: unknown): string {
  if (typeof value !== "string") return "";
  return replaceControlCharacters(value.normalize("NFKC"))
    .replace(/\s+/gu, " ")
    .trim();
}

function scopeHash(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

function scopeToken(value: string): string {
  const preview =
    value
      .replace(UNSAFE_KEY_PREVIEW_PATTERN, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(
        0,
        STUDIO_AI_IMAGE_REFERENCE_STORAGE_LIMITS.maxScopePreviewLength,
      ) || "scope";
  return `${preview}-${scopeHash(value)}`;
}

/**
 * Produces a deterministic, bounded v1 key. The hash keeps long IDs isolated even when their
 * readable previews share the same prefix; normalized control characters never reach the key.
 */
export function studioAiImageReferenceStorageKey(
  scope: StudioAiImageReferenceStorageScope,
): string {
  const workId = normalizeScopeSource(scope?.workId);
  if (!workId) {
    throw new Error("AI 이미지 레퍼런스를 저장하려면 작품 ID가 필요합니다.");
  }
  const userScope = normalizeScopeSource(scope.userScope);
  const owner = userScope ? `user:${scopeToken(userScope)}` : "guest";
  const key = `${STUDIO_AI_IMAGE_REFERENCE_STORAGE_PREFIX}:${owner}:work:${scopeToken(workId)}`;
  if (
    key.length >
    STUDIO_AI_IMAGE_REFERENCE_STORAGE_LIMITS.maxStorageKeyLength
  ) {
    throw new Error("AI 이미지 레퍼런스 저장 키 길이 제한을 초과했습니다.");
  }
  return key;
}

function resolveStorageKey(
  scope: StudioAiImageReferenceStorageScope,
): string | null {
  try {
    return studioAiImageReferenceStorageKey(scope);
  } catch {
    return null;
  }
}

/**
 * Explicit legacy-import/test seam. Missing, blocked, corrupt, oversized, or future-version data
 * fails closed to the canonical empty document. Product startup does not call this function.
 */
export function loadStudioAiImageReferenceDocument(
  storage: Pick<StudioAiImageReferenceStorage, "getItem"> | null | undefined,
  scope: StudioAiImageReferenceStorageScope,
): StudioAiImageReferenceDocument {
  const key = resolveStorageKey(scope);
  if (!storage || !key) return createEmptyStudioAiImageReferenceDocument();
  try {
    const serialized = storage.getItem(key);
    return serialized === null
      ? createEmptyStudioAiImageReferenceDocument()
      : hydrateStudioAiImageReferenceDocument(serialized);
  } catch {
    return createEmptyStudioAiImageReferenceDocument();
  }
}

/**
 * Legacy/test seam that persists only the canonical reference-role document. Canonical serialization strips binary
 * data, data URLs, provider payloads, and unknown fields; quota/private-mode failures are ignored
 * while the normalized in-memory document is returned to the caller.
 */
export function saveStudioAiImageReferenceDocument(
  storage: Pick<StudioAiImageReferenceStorage, "setItem"> | null | undefined,
  scope: StudioAiImageReferenceStorageScope,
  value: unknown,
): StudioAiImageReferenceDocument {
  const serialized = serializeStudioAiImageReferenceDocument(value);
  const document = hydrateStudioAiImageReferenceDocument(serialized);
  const key = resolveStorageKey(scope);
  if (!storage || !key) return document;
  try {
    storage.setItem(key, serialized);
  } catch {
    // Metadata references are a convenience cache. Quota/private mode must not break generation.
  }
  return document;
}

/** Clears only the current owner/work key and reports whether storage accepted the operation. */
export function clearStudioAiImageReferenceDocument(
  storage:
    | Pick<StudioAiImageReferenceStorage, "removeItem">
    | null
    | undefined,
  scope: StudioAiImageReferenceStorageScope,
): boolean {
  const key = resolveStorageKey(scope);
  if (!storage || !key) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
