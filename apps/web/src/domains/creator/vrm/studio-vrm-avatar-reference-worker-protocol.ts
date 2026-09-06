import {
  STUDIO_VRM_AVATAR_REFERENCE_LIMITS,
  STUDIO_VRM_AVATAR_REFERENCE_PROTOCOL_VERSION,
  admitStudioVrmAvatarReferenceCatalogue,
  isStudioVrmAvatarReferenceRecommendationReceipt,
  type StudioVrmAvatarReferenceCatalogue,
  type StudioVrmAvatarReferenceErrorCode,
  type StudioVrmAvatarReferenceRecommendationReceipt,
} from "./studio-vrm-avatar-reference-recommendation";

export interface StudioVrmAvatarReferenceWorkerRecommendRequest {
  readonly version: typeof STUDIO_VRM_AVATAR_REFERENCE_PROTOCOL_VERSION;
  readonly kind: "recommend";
  readonly requestId: number;
  readonly generationId: number;
  readonly bitmap: ImageBitmap;
  readonly catalogue: StudioVrmAvatarReferenceCatalogue;
  readonly topK: number;
}

export interface StudioVrmAvatarReferenceWorkerCancelRequest {
  readonly version: typeof STUDIO_VRM_AVATAR_REFERENCE_PROTOCOL_VERSION;
  readonly kind: "cancel";
  readonly requestId: number;
  readonly generationId: number;
}

export type StudioVrmAvatarReferenceWorkerRequest =
  | StudioVrmAvatarReferenceWorkerRecommendRequest
  | StudioVrmAvatarReferenceWorkerCancelRequest;

export interface StudioVrmAvatarReferenceWorkerProgressResponse {
  readonly version: typeof STUDIO_VRM_AVATAR_REFERENCE_PROTOCOL_VERSION;
  readonly kind: "progress";
  readonly requestId: number;
  readonly generationId: number;
  readonly stage: "model" | "embedding" | "ranking";
  readonly progress: number;
}

export interface StudioVrmAvatarReferenceWorkerResultResponse {
  readonly version: typeof STUDIO_VRM_AVATAR_REFERENCE_PROTOCOL_VERSION;
  readonly kind: "result";
  readonly requestId: number;
  readonly generationId: number;
  readonly receipt: StudioVrmAvatarReferenceRecommendationReceipt;
}

export interface StudioVrmAvatarReferenceWorkerErrorResponse {
  readonly version: typeof STUDIO_VRM_AVATAR_REFERENCE_PROTOCOL_VERSION;
  readonly kind: "error";
  readonly requestId: number;
  readonly generationId: number;
  readonly code: Extract<
    StudioVrmAvatarReferenceErrorCode,
    | "inference-failed"
    | "model-unavailable"
    | "protocol"
    | "unsupported-browser"
  >;
}

export type StudioVrmAvatarReferenceWorkerResponse =
  | StudioVrmAvatarReferenceWorkerProgressResponse
  | StudioVrmAvatarReferenceWorkerResultResponse
  | StudioVrmAvatarReferenceWorkerErrorResponse;

const STAGES = new Set<StudioVrmAvatarReferenceWorkerProgressResponse["stage"]>([
  "model",
  "embedding",
  "ranking",
]);
const ERROR_CODES = new Set<StudioVrmAvatarReferenceWorkerErrorResponse["code"]>([
  "inference-failed",
  "model-unavailable",
  "protocol",
  "unsupported-browser",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isBitmap(value: unknown): value is ImageBitmap {
  return isRecord(value)
    && positiveSafeInteger(value.width)
    && positiveSafeInteger(value.height)
    && value.width <= STUDIO_VRM_AVATAR_REFERENCE_LIMITS.maxOutputDimension
    && value.height <= STUDIO_VRM_AVATAR_REFERENCE_LIMITS.maxOutputDimension
    && value.width * value.height <= STUDIO_VRM_AVATAR_REFERENCE_LIMITS.maxOutputPixels
    && typeof value.close === "function";
}

export function isStudioVrmAvatarReferenceWorkerRequest(
  value: unknown,
): value is StudioVrmAvatarReferenceWorkerRequest {
  if (
    !isRecord(value)
    || value.version !== STUDIO_VRM_AVATAR_REFERENCE_PROTOCOL_VERSION
    || !positiveSafeInteger(value.requestId)
    || !positiveSafeInteger(value.generationId)
  ) return false;
  if (value.kind === "cancel") return true;
  if (
    value.kind !== "recommend"
    || !isBitmap(value.bitmap)
    || !positiveSafeInteger(value.topK)
    || value.topK > STUDIO_VRM_AVATAR_REFERENCE_LIMITS.maxTopK
  ) return false;
  try {
    admitStudioVrmAvatarReferenceCatalogue(value.catalogue);
    return true;
  } catch {
    return false;
  }
}

export function isStudioVrmAvatarReferenceWorkerResponse(
  value: unknown,
): value is StudioVrmAvatarReferenceWorkerResponse {
  if (
    !isRecord(value)
    || value.version !== STUDIO_VRM_AVATAR_REFERENCE_PROTOCOL_VERSION
    || !positiveSafeInteger(value.requestId)
    || !positiveSafeInteger(value.generationId)
  ) return false;
  if (value.kind === "progress") {
    return typeof value.stage === "string"
      && STAGES.has(value.stage as StudioVrmAvatarReferenceWorkerProgressResponse["stage"])
      && typeof value.progress === "number"
      && Number.isFinite(value.progress)
      && value.progress >= 0
      && value.progress <= 1;
  }
  if (value.kind === "error") {
    return typeof value.code === "string"
      && ERROR_CODES.has(value.code as StudioVrmAvatarReferenceWorkerErrorResponse["code"]);
  }
  return value.kind === "result"
    && isStudioVrmAvatarReferenceRecommendationReceipt(value.receipt);
}

export function studioVrmAvatarReferenceRequestTransfers(
  request: StudioVrmAvatarReferenceWorkerRequest,
): Transferable[] {
  return request.kind === "recommend" ? [request.bitmap] : [];
}
