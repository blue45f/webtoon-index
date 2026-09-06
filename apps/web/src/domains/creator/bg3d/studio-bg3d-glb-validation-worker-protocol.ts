import type {
  StudioBg3dGlbFailureCode,
  StudioBg3dGlbMetrics,
  StudioBg3dGlbValidationOptions,
  StudioBg3dGlbValidationResult,
} from "./studio-bg3d-glb-validation";

export const STUDIO_BG3D_GLB_VALIDATION_WORKER_PROTOCOL_VERSION = 6 as const;

export type StudioBg3dGlbWorkerValidationOptions = Omit<
  StudioBg3dGlbValidationOptions,
  "basisPayloadPreflight" | "basisRuntimeProvider" | "basisTranscoderCapability" | "digest"
>;

export interface StudioBg3dGlbWorkerValidateRequest {
  readonly version: typeof STUDIO_BG3D_GLB_VALIDATION_WORKER_PROTOCOL_VERSION;
  readonly kind: "validate";
  readonly requestId: number;
  readonly bytes: ArrayBuffer;
  readonly options: StudioBg3dGlbWorkerValidationOptions;
}

export interface StudioBg3dGlbWorkerCancelRequest {
  readonly version: typeof STUDIO_BG3D_GLB_VALIDATION_WORKER_PROTOCOL_VERSION;
  readonly kind: "cancel";
  readonly requestId: number;
}

export type StudioBg3dGlbWorkerRequest =
  | StudioBg3dGlbWorkerValidateRequest
  | StudioBg3dGlbWorkerCancelRequest;

export interface StudioBg3dGlbWorkerResultResponse {
  readonly version: typeof STUDIO_BG3D_GLB_VALIDATION_WORKER_PROTOCOL_VERSION;
  readonly kind: "result";
  readonly requestId: number;
  readonly result: StudioBg3dGlbValidationResult;
}

export interface StudioBg3dGlbWorkerErrorResponse {
  readonly version: typeof STUDIO_BG3D_GLB_VALIDATION_WORKER_PROTOCOL_VERSION;
  readonly kind: "error";
  readonly requestId: number;
}

export type StudioBg3dGlbWorkerResponse =
  | StudioBg3dGlbWorkerResultResponse
  | StudioBg3dGlbWorkerErrorResponse;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const FAILURE_CODES = new Set<StudioBg3dGlbFailureCode>([
  "invalid-input",
  "invalid-options",
  "invalid-declared-metadata",
  "mime-type-mismatch",
  "byte-size-mismatch",
  "file-too-large",
  "model-byte-budget-exceeded",
  "cumulative-byte-budget-exceeded",
  "digest-unavailable",
  "digest-failed",
  "hash-mismatch",
  "truncated-header",
  "invalid-magic",
  "unsupported-version",
  "declared-length-mismatch",
  "missing-json-chunk",
  "json-chunk-too-large",
  "invalid-chunk-alignment",
  "invalid-chunk-bounds",
  "duplicate-json-chunk",
  "duplicate-bin-chunk",
  "unsupported-chunk-type",
  "invalid-json-encoding",
  "invalid-json",
  "invalid-gltf-root",
  "unsupported-required-extension",
  "external-resource-uri",
  "missing-bin-chunk",
  "invalid-buffer",
  "invalid-buffer-view",
  "invalid-accessor",
  "invalid-mesh",
  "invalid-node",
  "invalid-animation",
  "invalid-skin",
  "invalid-image",
  "basis-transcode-failed",
  "arithmetic-overflow",
  "node-budget-exceeded",
  "triangle-budget-exceeded",
  "draw-call-budget-exceeded",
  "material-budget-exceeded",
  "light-budget-exceeded",
  "animation-count-budget-exceeded",
  "animation-channel-budget-exceeded",
  "animation-keyframe-budget-exceeded",
  "animation-value-budget-exceeded",
  "skin-count-budget-exceeded",
  "joint-count-budget-exceeded",
  "morph-target-budget-exceeded",
  "accessor-element-budget-exceeded",
  "geometry-memory-budget-exceeded",
  "texture-count-budget-exceeded",
  "texture-byte-budget-exceeded",
  "texture-dimension-budget-exceeded",
]);

const METRIC_KEYS: readonly (keyof StudioBg3dGlbMetrics)[] = [
  "byteSize",
  "jsonByteSize",
  "binByteSize",
  "nodes",
  "meshes",
  "meshPrimitives",
  "drawCalls",
  "triangles",
  "materials",
  "textures",
  "images",
  "imageBytes",
  "estimatedDecodedImageBytes",
  "maxImageDimension",
  "undeterminedImageDimensions",
  "lights",
  "animations",
  "animationChannels",
  "animationKeyframes",
  "animationValues",
  "skins",
  "joints",
  "morphTargets",
  "accessorElements",
  "estimatedDecodedGeometryBytes",
];

const VERIFIED_SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const DECLARED_SHA256_PATTERN = /^(?:sha256:)?[a-f0-9]{64}$/iu;

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonEmptyMessage(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isMetrics(value: unknown, verifiedByteLength: number): value is StudioBg3dGlbMetrics {
  if (!isRecord(value)) return false;
  if (!METRIC_KEYS.every((key) => isSafeNonNegativeInteger(value[key]))) return false;
  const metrics = value as unknown as StudioBg3dGlbMetrics;
  return metrics.byteSize === verifiedByteLength
    && metrics.jsonByteSize <= verifiedByteLength
    && metrics.binByteSize <= verifiedByteLength
    && metrics.imageBytes <= verifiedByteLength;
}

function isValidationResult(value: unknown): value is StudioBg3dGlbValidationResult {
  if (!isRecord(value) || typeof value.ok !== "boolean" || !isNonEmptyMessage(value.message)) {
    return false;
  }
  if (value.ok === false) {
    return typeof value.code === "string" && FAILURE_CODES.has(value.code as StudioBg3dGlbFailureCode);
  }
  if (
    value.code !== "valid"
    || (value.profile !== "mobile" && value.profile !== "desktop")
    || typeof value.verifiedSha256 !== "string"
    || !VERIFIED_SHA256_PATTERN.test(value.verifiedSha256)
    || !(value.verifiedBytes instanceof Uint8Array)
    || !isSafeNonNegativeInteger(value.cumulativeBytesAfter)
    || typeof value.usesBasisTextures !== "boolean"
    || typeof value.requiresBasisTextures !== "boolean"
    || (value.requiresBasisTextures && !value.usesBasisTextures)
  ) {
    return false;
  }
  return value.cumulativeBytesAfter >= value.verifiedBytes.byteLength
    && isMetrics(value.metrics, value.verifiedBytes.byteLength);
}

function isBudget(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.complexity) || !isRecord(value.textures)) return false;
  const positive = [
    value.complexity.maxModelBytes,
    value.complexity.maxNodes,
    value.complexity.maxTriangles,
    value.complexity.maxDrawCalls,
    value.complexity.maxMaterials,
    value.complexity.maxLights,
    value.textures.maxTextures,
    value.textures.maxTotalBytes,
    value.textures.maxDimension,
  ].every(isSafePositiveInteger);
  const nonNegative = [
    value.complexity.maxAnimations,
    value.complexity.maxAnimationChannels,
    value.complexity.maxAnimationKeyframes,
    value.complexity.maxAnimationValues,
    value.complexity.maxSkins,
    value.complexity.maxJoints,
    value.complexity.maxMorphTargets,
    value.complexity.maxAccessorElements,
    value.complexity.maxDecodedGeometryBytes,
  ].every(isSafeNonNegativeInteger);
  return positive && nonNegative;
}

function isValidationOptions(value: unknown): value is StudioBg3dGlbWorkerValidationOptions {
  if (
    !isRecord(value)
    || (value.profile !== "mobile" && value.profile !== "desktop")
    || !isRecord(value.declared)
    || !isSafeNonNegativeInteger(value.declared.byteSize)
    || typeof value.declared.sha256 !== "string"
    || !DECLARED_SHA256_PATTERN.test(value.declared.sha256)
    || (value.declared.mimeType !== undefined && typeof value.declared.mimeType !== "string")
    || !isRecord(value.cumulative)
    || !isSafeNonNegativeInteger(value.cumulative.usedBytes)
    || !isSafePositiveInteger(value.cumulative.maximumBytes)
    || value.cumulative.usedBytes > value.cumulative.maximumBytes
    || !isRecord(value.budgets)
    || !isBudget(value.budgets.mobile)
    || !isBudget(value.budgets.desktop)
    || (value.maxJsonBytes !== undefined && !isSafePositiveInteger(value.maxJsonBytes))
    || (
      value.supportedRequiredExtensions !== undefined
      && (
        !Array.isArray(value.supportedRequiredExtensions)
        || value.supportedRequiredExtensions.some((entry) => typeof entry !== "string")
      )
    )
  ) {
    return false;
  }
  return !Object.hasOwn(value, "digest") &&
    !Object.hasOwn(value, "basisTranscoderCapability") &&
    !Object.hasOwn(value, "basisPayloadPreflight") &&
    !Object.hasOwn(value, "basisRuntimeProvider");
}

export function isStudioBg3dGlbWorkerRequest(
  value: unknown,
): value is StudioBg3dGlbWorkerRequest {
  if (
    !isRecord(value)
    || value.version !== STUDIO_BG3D_GLB_VALIDATION_WORKER_PROTOCOL_VERSION
    || !isSafePositiveInteger(value.requestId)
  ) {
    return false;
  }
  if (value.kind === "cancel") return true;
  return value.kind === "validate"
    && value.bytes instanceof ArrayBuffer
    && isValidationOptions(value.options);
}

export function isStudioBg3dGlbWorkerResponse(
  value: unknown,
): value is StudioBg3dGlbWorkerResponse {
  if (!isRecord(value)) return false;
  return value.version === STUDIO_BG3D_GLB_VALIDATION_WORKER_PROTOCOL_VERSION
    && (value.kind === "result" || value.kind === "error")
    && Number.isSafeInteger(value.requestId)
    && (value.requestId as number) > 0
    && (value.kind === "error" || isValidationResult(value.result));
}
