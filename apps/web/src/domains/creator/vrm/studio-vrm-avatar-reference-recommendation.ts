import {
  AVATAR_FORGE_PRESETS,
  type AvatarForgePreset,
} from "./studio-vrm-avatar-forge";

import type { Embedding } from "@mediapipe/tasks-vision";

export const STUDIO_VRM_AVATAR_REFERENCE_PROVIDER_ID =
  "google-mediapipe-tasks-vision/image-embedder" as const;
export const STUDIO_VRM_AVATAR_REFERENCE_MODEL_ID =
  "mobilenet-v3-small-float32" as const;
export const STUDIO_VRM_AVATAR_REFERENCE_MODEL_REVISION =
  "1" as const;
export const STUDIO_VRM_AVATAR_REFERENCE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_embedder/mobilenet_v3_small/float32/1/mobilenet_v3_small.tflite" as const;
export const STUDIO_VRM_AVATAR_REFERENCE_MODEL_BYTE_LENGTH = 4_117_670 as const;
export const STUDIO_VRM_AVATAR_REFERENCE_MODEL_SHA256 =
  "bbbb4c51a55a53905af1daec995ca1aae355046f8839bb8c9f5ce9271394bc40" as const;
export const STUDIO_VRM_AVATAR_REFERENCE_MODEL_FETCH_TIMEOUT_MS = 15_000 as const;
export const STUDIO_VRM_AVATAR_REFERENCE_PROTOCOL_VERSION = 1 as const;

export const STUDIO_VRM_AVATAR_REFERENCE_LIMITS = Object.freeze({
  maxCatalogueEntries: 64,
  maxEmbeddingDimensions: 4_096,
  maxModelBytes: 8 * 1024 * 1024,
  maxTopK: 5,
  maxCatalogueRevisionLength: 128,
  maxOutputDimension: 1_024,
  maxOutputPixels: 1_024 * 1_024,
});

export type StudioVrmAvatarReferenceErrorCode =
  | "aborted"
  | "catalogue-unavailable"
  | "decode-failed"
  | "disposed"
  | "file-invalid"
  | "inference-failed"
  | "model-unavailable"
  | "protocol"
  | "stale-generation"
  | "timeout"
  | "unsupported-browser"
  | "worker-failed";

const ERROR_MESSAGES: Readonly<Record<StudioVrmAvatarReferenceErrorCode, string>> = Object.freeze({
  aborted: "참고 이미지 분석을 취소했습니다.",
  "catalogue-unavailable": "검증된 아바타 프리셋 추천 기준이 아직 준비되지 않았습니다.",
  "decode-failed": "이미지를 해석하지 못했습니다. 손상되지 않은 JPG, PNG 또는 WebP를 선택해 주세요.",
  disposed: "종료된 참고 이미지 분석기는 다시 사용할 수 없습니다.",
  "file-invalid": "JPG, PNG 또는 WebP 이미지는 16MB 이하여야 하며 안전한 픽셀 범위 안에 있어야 합니다.",
  "inference-failed": "이미지 특징을 비교하지 못했습니다. 다른 이미지로 다시 시도해 주세요.",
  "model-unavailable": "MediaPipe 이미지 임베딩 모델을 준비하지 못했습니다. 네트워크 상태를 확인해 주세요.",
  protocol: "추천 결과의 출처와 구조를 안전하게 확인하지 못했습니다.",
  "stale-generation": "더 최근에 선택한 이미지가 있어 이전 추천 결과를 사용하지 않았습니다.",
  timeout: "이미지 분석 시간이 초과되었습니다. 더 작은 이미지로 다시 시도해 주세요.",
  "unsupported-browser": "이 브라우저는 안전한 이미지 Worker 분석을 지원하지 않습니다.",
  "worker-failed": "이미지 추천 Worker를 실행하지 못했습니다.",
});

export class StudioVrmAvatarReferenceError extends Error {
  constructor(
    readonly code: StudioVrmAvatarReferenceErrorCode,
    options?: ErrorOptions,
  ) {
    super(ERROR_MESSAGES[code], options);
    this.name = "StudioVrmAvatarReferenceError";
  }
}

export interface StudioVrmAvatarReferenceEmbedding {
  readonly headIndex: number;
  readonly headName: string;
  readonly floatEmbedding: readonly number[];
}

export interface StudioVrmAvatarReferenceCatalogueEntry {
  readonly presetId: string;
  readonly embedding: StudioVrmAvatarReferenceEmbedding;
}

export interface StudioVrmAvatarReferenceCatalogue {
  readonly version: typeof STUDIO_VRM_AVATAR_REFERENCE_PROTOCOL_VERSION;
  readonly providerId: typeof STUDIO_VRM_AVATAR_REFERENCE_PROVIDER_ID;
  readonly modelId: typeof STUDIO_VRM_AVATAR_REFERENCE_MODEL_ID;
  readonly modelRevision: typeof STUDIO_VRM_AVATAR_REFERENCE_MODEL_REVISION;
  readonly modelSha256: typeof STUDIO_VRM_AVATAR_REFERENCE_MODEL_SHA256;
  readonly catalogueRevision: string;
  readonly entries: readonly StudioVrmAvatarReferenceCatalogueEntry[];
}

export interface StudioVrmAvatarReferenceRecommendation {
  readonly rank: number;
  readonly presetId: string;
  readonly similarity: number;
}

export interface StudioVrmAvatarReferenceRecommendationReceipt {
  readonly version: typeof STUDIO_VRM_AVATAR_REFERENCE_PROTOCOL_VERSION;
  readonly providerId: typeof STUDIO_VRM_AVATAR_REFERENCE_PROVIDER_ID;
  readonly modelId: typeof STUDIO_VRM_AVATAR_REFERENCE_MODEL_ID;
  readonly modelRevision: typeof STUDIO_VRM_AVATAR_REFERENCE_MODEL_REVISION;
  readonly modelSha256: typeof STUDIO_VRM_AVATAR_REFERENCE_MODEL_SHA256;
  readonly catalogueRevision: string;
  readonly cataloguePresetIds: readonly string[];
  readonly queryEmbeddingSha256: string;
  readonly recommendations: readonly StudioVrmAvatarReferenceRecommendation[];
}

export type StudioVrmAvatarReferenceCosineSimilarity = (
  left: Embedding,
  right: Embedding,
) => number;

const PRESETS_BY_ID = new Map<string, AvatarForgePreset>(
  AVATAR_FORGE_PRESETS.map((preset) => [preset.id, preset]),
);
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const REVISION = /^[a-z0-9][a-z0-9._:@/+-]{0,127}$/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failProtocol(cause?: unknown): never {
  throw new StudioVrmAvatarReferenceError(
    "protocol",
    cause === undefined ? undefined : { cause },
  );
}

function cloneEmbedding(value: unknown): StudioVrmAvatarReferenceEmbedding {
  if (!isRecord(value)) return failProtocol();
  const headIndex = value.headIndex;
  const headName = value.headName;
  const floatEmbedding = value.floatEmbedding;
  if (
    typeof headIndex !== "number"
    || !Number.isSafeInteger(headIndex)
    || headIndex < 0
    || headIndex > 64
    || typeof headName !== "string"
    || headName.length > 256
    || !Array.isArray(floatEmbedding)
    || floatEmbedding.length < 1
    || floatEmbedding.length > STUDIO_VRM_AVATAR_REFERENCE_LIMITS.maxEmbeddingDimensions
  ) return failProtocol();
  const vector = floatEmbedding.map((component) => {
    if (typeof component !== "number" || !Number.isFinite(component)) return failProtocol();
    return component;
  });
  return Object.freeze({
    headIndex,
    headName,
    floatEmbedding: Object.freeze(vector),
  });
}

/**
 * Admits only a catalogue produced by the exact MediaPipe provider/model pair used at inference.
 * Reference images are deliberately absent: the durable product seam stores only bounded vectors.
 */
export function admitStudioVrmAvatarReferenceCatalogue(
  value: unknown,
): StudioVrmAvatarReferenceCatalogue {
  if (!isRecord(value)) return failProtocol();
  if (
    value.version !== STUDIO_VRM_AVATAR_REFERENCE_PROTOCOL_VERSION
    || value.providerId !== STUDIO_VRM_AVATAR_REFERENCE_PROVIDER_ID
    || value.modelId !== STUDIO_VRM_AVATAR_REFERENCE_MODEL_ID
    || value.modelRevision !== STUDIO_VRM_AVATAR_REFERENCE_MODEL_REVISION
    || value.modelSha256 !== STUDIO_VRM_AVATAR_REFERENCE_MODEL_SHA256
    || typeof value.catalogueRevision !== "string"
    || !REVISION.test(value.catalogueRevision)
    || value.catalogueRevision.length > STUDIO_VRM_AVATAR_REFERENCE_LIMITS.maxCatalogueRevisionLength
    || !Array.isArray(value.entries)
    || value.entries.length < 1
    || value.entries.length > STUDIO_VRM_AVATAR_REFERENCE_LIMITS.maxCatalogueEntries
  ) return failProtocol();

  const presetIds = new Set<string>();
  let dimensions: number | null = null;
  let headIndex: number | null = null;
  let headName: string | null = null;
  const entries = value.entries.map((candidate) => {
    if (!isRecord(candidate) || typeof candidate.presetId !== "string") return failProtocol();
    const presetId = candidate.presetId;
    if (!PRESETS_BY_ID.has(presetId) || presetIds.has(presetId)) return failProtocol();
    presetIds.add(presetId);
    const embedding = cloneEmbedding(candidate.embedding);
    dimensions ??= embedding.floatEmbedding.length;
    headIndex ??= embedding.headIndex;
    headName ??= embedding.headName;
    if (
      dimensions !== embedding.floatEmbedding.length
      || headIndex !== embedding.headIndex
      || headName !== embedding.headName
    ) return failProtocol();
    return Object.freeze({ presetId, embedding });
  });

  return Object.freeze({
    version: STUDIO_VRM_AVATAR_REFERENCE_PROTOCOL_VERSION,
    providerId: STUDIO_VRM_AVATAR_REFERENCE_PROVIDER_ID,
    modelId: STUDIO_VRM_AVATAR_REFERENCE_MODEL_ID,
    modelRevision: STUDIO_VRM_AVATAR_REFERENCE_MODEL_REVISION,
    modelSha256: STUDIO_VRM_AVATAR_REFERENCE_MODEL_SHA256,
    catalogueRevision: value.catalogueRevision,
    entries: Object.freeze(entries),
  });
}

export function findStudioVrmAvatarReferencePreset(presetId: string): AvatarForgePreset | null {
  return PRESETS_BY_ID.get(presetId) ?? null;
}

export function rankStudioVrmAvatarReferenceRecommendations(input: {
  readonly catalogue: StudioVrmAvatarReferenceCatalogue;
  readonly queryEmbedding: StudioVrmAvatarReferenceEmbedding;
  readonly queryEmbeddingSha256: string;
  readonly topK: number;
  readonly cosineSimilarity: StudioVrmAvatarReferenceCosineSimilarity;
}): StudioVrmAvatarReferenceRecommendationReceipt {
  const catalogue = admitStudioVrmAvatarReferenceCatalogue(input.catalogue);
  const queryEmbedding = cloneEmbedding(input.queryEmbedding);
  if (
    !Number.isSafeInteger(input.topK)
    || input.topK < 1
    || input.topK > STUDIO_VRM_AVATAR_REFERENCE_LIMITS.maxTopK
    || !SHA256_HEX.test(input.queryEmbeddingSha256)
    || typeof input.cosineSimilarity !== "function"
  ) return failProtocol();
  const reference = catalogue.entries[0]!.embedding;
  if (
    reference.floatEmbedding.length !== queryEmbedding.floatEmbedding.length
    || reference.headIndex !== queryEmbedding.headIndex
    || reference.headName !== queryEmbedding.headName
  ) return failProtocol();

  const query: Embedding = {
    headIndex: queryEmbedding.headIndex,
    headName: queryEmbedding.headName,
    floatEmbedding: [...queryEmbedding.floatEmbedding],
  };
  const recommendations = catalogue.entries.map((entry) => {
    let similarity: number;
    try {
      similarity = input.cosineSimilarity(query, {
        headIndex: entry.embedding.headIndex,
        headName: entry.embedding.headName,
        floatEmbedding: [...entry.embedding.floatEmbedding],
      });
    } catch (cause) {
      return failProtocol(cause);
    }
    if (!Number.isFinite(similarity) || similarity < -1.000_001 || similarity > 1.000_001) {
      return failProtocol();
    }
    return { presetId: entry.presetId, similarity: Math.max(-1, Math.min(1, similarity)) };
  });
  recommendations.sort((left, right) =>
    right.similarity - left.similarity || left.presetId.localeCompare(right.presetId, "en"),
  );
  const top = recommendations.slice(0, Math.min(input.topK, recommendations.length)).map(
    (recommendation, index) => Object.freeze({
      rank: index + 1,
      presetId: recommendation.presetId,
      similarity: recommendation.similarity,
    }),
  );

  return Object.freeze({
    version: STUDIO_VRM_AVATAR_REFERENCE_PROTOCOL_VERSION,
    providerId: STUDIO_VRM_AVATAR_REFERENCE_PROVIDER_ID,
    modelId: STUDIO_VRM_AVATAR_REFERENCE_MODEL_ID,
    modelRevision: STUDIO_VRM_AVATAR_REFERENCE_MODEL_REVISION,
    modelSha256: STUDIO_VRM_AVATAR_REFERENCE_MODEL_SHA256,
    catalogueRevision: catalogue.catalogueRevision,
    cataloguePresetIds: Object.freeze(catalogue.entries.map((entry) => entry.presetId).sort()),
    queryEmbeddingSha256: input.queryEmbeddingSha256,
    recommendations: Object.freeze(top),
  });
}

export function isStudioVrmAvatarReferenceRecommendationReceipt(
  value: unknown,
): value is StudioVrmAvatarReferenceRecommendationReceipt {
  if (
    !isRecord(value)
    || value.version !== STUDIO_VRM_AVATAR_REFERENCE_PROTOCOL_VERSION
    || value.providerId !== STUDIO_VRM_AVATAR_REFERENCE_PROVIDER_ID
    || value.modelId !== STUDIO_VRM_AVATAR_REFERENCE_MODEL_ID
    || value.modelRevision !== STUDIO_VRM_AVATAR_REFERENCE_MODEL_REVISION
    || value.modelSha256 !== STUDIO_VRM_AVATAR_REFERENCE_MODEL_SHA256
    || typeof value.catalogueRevision !== "string"
    || !REVISION.test(value.catalogueRevision)
    || typeof value.queryEmbeddingSha256 !== "string"
    || !SHA256_HEX.test(value.queryEmbeddingSha256)
    || !Array.isArray(value.cataloguePresetIds)
    || value.cataloguePresetIds.length < 1
    || value.cataloguePresetIds.length > STUDIO_VRM_AVATAR_REFERENCE_LIMITS.maxCatalogueEntries
    || !Array.isArray(value.recommendations)
    || value.recommendations.length < 1
    || value.recommendations.length > STUDIO_VRM_AVATAR_REFERENCE_LIMITS.maxTopK
  ) return false;
  const catalogueIds = new Set<string>();
  let previousCatalogueId = "";
  for (const id of value.cataloguePresetIds) {
    if (typeof id !== "string" || !PRESETS_BY_ID.has(id) || catalogueIds.has(id)) return false;
    if (previousCatalogueId && previousCatalogueId.localeCompare(id, "en") >= 0) return false;
    catalogueIds.add(id);
    previousCatalogueId = id;
  }
  const recommendationIds = new Set<string>();
  let previousSimilarity = Number.POSITIVE_INFINITY;
  return value.recommendations.every((recommendation, index) => {
    if (!isRecord(recommendation)) return false;
    const id = recommendation.presetId;
    const similarity = recommendation.similarity;
    if (
      recommendation.rank !== index + 1
      || typeof id !== "string"
      || !catalogueIds.has(id)
      || recommendationIds.has(id)
      || typeof similarity !== "number"
      || !Number.isFinite(similarity)
      || similarity < -1
      || similarity > 1
      || similarity > previousSimilarity
    ) return false;
    recommendationIds.add(id);
    previousSimilarity = similarity;
    return true;
  });
}
