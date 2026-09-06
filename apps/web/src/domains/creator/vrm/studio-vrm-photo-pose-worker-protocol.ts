import {
  STUDIO_VRM_PHOTO_POSE_LIMITS,
  STUDIO_VRM_PHOTO_POSE_MIME_TYPES,
  STUDIO_VRM_PHOTO_POSE_PROTOCOL_VERSION,
  type NormalizedStudioVrmPhotoPoseOptions,
  type StudioVrmPhotoPoseErrorCode,
  type StudioVrmPhotoPoseFileAdmission,
  type StudioVrmPhotoPoseImageInspection,
  type StudioVrmPhotoPoseOutputPlan,
} from "./studio-vrm-photo-pose";

export type StudioVrmPhotoPoseWorkerStage = "inspecting" | "decoding" | "transforming";

export interface StudioVrmPhotoPoseWorkerPreprocessRequest {
  readonly version: typeof STUDIO_VRM_PHOTO_POSE_PROTOCOL_VERSION;
  readonly kind: "preprocess";
  readonly requestId: number;
  readonly generationId: number;
  readonly bytes: ArrayBuffer;
  readonly admission: StudioVrmPhotoPoseFileAdmission;
  readonly options: NormalizedStudioVrmPhotoPoseOptions;
}

export interface StudioVrmPhotoPoseWorkerCancelRequest {
  readonly version: typeof STUDIO_VRM_PHOTO_POSE_PROTOCOL_VERSION;
  readonly kind: "cancel";
  readonly requestId: number;
  readonly generationId: number;
}

export type StudioVrmPhotoPoseWorkerRequest =
  | StudioVrmPhotoPoseWorkerPreprocessRequest
  | StudioVrmPhotoPoseWorkerCancelRequest;

export interface StudioVrmPhotoPoseWorkerProgressResponse {
  readonly version: typeof STUDIO_VRM_PHOTO_POSE_PROTOCOL_VERSION;
  readonly kind: "progress";
  readonly requestId: number;
  readonly generationId: number;
  readonly stage: StudioVrmPhotoPoseWorkerStage;
  readonly progress: number;
}

export interface StudioVrmPhotoPosePreprocessedImage {
  readonly generationId: number;
  readonly bitmap: ImageBitmap;
  readonly source: StudioVrmPhotoPoseImageInspection & { readonly byteSize: number };
  readonly output: Pick<
    StudioVrmPhotoPoseOutputPlan,
    "outputWidth" | "outputHeight" | "scale" | "appliedExifOrientation"
  > & {
    readonly rotation: NormalizedStudioVrmPhotoPoseOptions["rotation"];
    readonly mirrorHorizontal: boolean;
  };
}

export interface StudioVrmPhotoPoseWorkerResultResponse {
  readonly version: typeof STUDIO_VRM_PHOTO_POSE_PROTOCOL_VERSION;
  readonly kind: "result";
  readonly requestId: number;
  readonly generationId: number;
  readonly result: StudioVrmPhotoPosePreprocessedImage;
}

export interface StudioVrmPhotoPoseWorkerErrorResponse {
  readonly version: typeof STUDIO_VRM_PHOTO_POSE_PROTOCOL_VERSION;
  readonly kind: "error";
  readonly requestId: number;
  readonly generationId: number;
  readonly code: Extract<
    StudioVrmPhotoPoseErrorCode,
    | "aborted"
    | "decode-failed"
    | "empty-file"
    | "file-too-large"
    | "image-dimensions"
    | "mime-mismatch"
    | "protocol"
    | "unsupported-browser"
    | "unsupported-type"
  >;
}

export type StudioVrmPhotoPoseWorkerResponse =
  | StudioVrmPhotoPoseWorkerProgressResponse
  | StudioVrmPhotoPoseWorkerResultResponse
  | StudioVrmPhotoPoseWorkerErrorResponse;

const MIME_TYPES = new Set<string>(STUDIO_VRM_PHOTO_POSE_MIME_TYPES);
const WORKER_ERROR_CODES = new Set<StudioVrmPhotoPoseWorkerErrorResponse["code"]>([
  "aborted",
  "decode-failed",
  "empty-file",
  "file-too-large",
  "image-dimensions",
  "mime-mismatch",
  "protocol",
  "unsupported-browser",
  "unsupported-type",
]);
const WORKER_STAGES = new Set<StudioVrmPhotoPoseWorkerStage>(["inspecting", "decoding", "transforming"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function boundedPositiveInteger(value: unknown, maximum: number): value is number {
  return positiveSafeInteger(value) && value <= maximum;
}

function safeFileName(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 31 || codePoint === 127) return false;
  }
  return true;
}

function isAdmission(value: unknown, bytes?: ArrayBuffer): value is StudioVrmPhotoPoseFileAdmission {
  return isRecord(value)
    && typeof value.fileName === "string"
    && value.fileName.length > 0
    && value.fileName.length <= 512
    && safeFileName(value.fileName)
    && typeof value.mimeType === "string"
    && MIME_TYPES.has(value.mimeType)
    && boundedPositiveInteger(value.byteSize, STUDIO_VRM_PHOTO_POSE_LIMITS.maxFileBytes)
    && (bytes === undefined || value.byteSize === bytes.byteLength);
}

function isOptions(value: unknown): value is NormalizedStudioVrmPhotoPoseOptions {
  return isRecord(value)
    && (value.exifMode === "apply" || value.exifMode === "ignore")
    && (value.rotation === 0 || value.rotation === 90 || value.rotation === 180 || value.rotation === 270)
    && typeof value.mirrorHorizontal === "boolean"
    && boundedPositiveInteger(value.maxOutputDimension, STUDIO_VRM_PHOTO_POSE_LIMITS.maxOutputDimension)
    && value.maxOutputDimension >= 256
    && boundedPositiveInteger(value.maxOutputPixels, STUDIO_VRM_PHOTO_POSE_LIMITS.maxOutputPixels)
    && value.maxOutputPixels >= 256 * 256;
}

export function isStudioVrmPhotoPoseWorkerRequest(
  value: unknown,
): value is StudioVrmPhotoPoseWorkerRequest {
  if (
    !isRecord(value)
    || value.version !== STUDIO_VRM_PHOTO_POSE_PROTOCOL_VERSION
    || !positiveSafeInteger(value.requestId)
    || !positiveSafeInteger(value.generationId)
  ) return false;
  if (value.kind === "cancel") return true;
  return value.kind === "preprocess"
    && value.bytes instanceof ArrayBuffer
    && isAdmission(value.admission, value.bytes)
    && isOptions(value.options);
}

function isInspection(value: unknown): value is StudioVrmPhotoPosePreprocessedImage["source"] {
  return isRecord(value)
    && typeof value.mimeType === "string"
    && MIME_TYPES.has(value.mimeType)
    && boundedPositiveInteger(value.width, STUDIO_VRM_PHOTO_POSE_LIMITS.maxSourceDimension)
    && boundedPositiveInteger(value.height, STUDIO_VRM_PHOTO_POSE_LIMITS.maxSourceDimension)
    && positiveSafeInteger(value.pixelCount)
    && value.pixelCount === value.width * value.height
    && value.pixelCount <= STUDIO_VRM_PHOTO_POSE_LIMITS.maxSourcePixels
    && boundedPositiveInteger(value.exifOrientation, 8)
    && boundedPositiveInteger(value.byteSize, STUDIO_VRM_PHOTO_POSE_LIMITS.maxFileBytes);
}

function isBitmapLike(value: unknown): value is ImageBitmap {
  return isRecord(value)
    && positiveSafeInteger(value.width)
    && positiveSafeInteger(value.height)
    && typeof value.close === "function";
}

function isPreprocessedResult(value: unknown, generationId: number): value is StudioVrmPhotoPosePreprocessedImage {
  if (
    !isRecord(value)
    || value.generationId !== generationId
    || !isBitmapLike(value.bitmap)
    || !isRecord(value.output)
    || !isInspection(value.source)
  ) return false;
  const output = value.output;
  return boundedPositiveInteger(output.outputWidth, STUDIO_VRM_PHOTO_POSE_LIMITS.maxOutputDimension)
    && boundedPositiveInteger(output.outputHeight, STUDIO_VRM_PHOTO_POSE_LIMITS.maxOutputDimension)
    && output.outputWidth * output.outputHeight <= STUDIO_VRM_PHOTO_POSE_LIMITS.maxOutputPixels
    && value.bitmap.width === output.outputWidth
    && value.bitmap.height === output.outputHeight
    && typeof output.scale === "number"
    && Number.isFinite(output.scale)
    && output.scale > 0
    && output.scale <= 1
    && boundedPositiveInteger(output.appliedExifOrientation, 8)
    && (output.rotation === 0 || output.rotation === 90 || output.rotation === 180 || output.rotation === 270)
    && typeof output.mirrorHorizontal === "boolean";
}

export function isStudioVrmPhotoPoseWorkerResponse(
  value: unknown,
): value is StudioVrmPhotoPoseWorkerResponse {
  if (
    !isRecord(value)
    || value.version !== STUDIO_VRM_PHOTO_POSE_PROTOCOL_VERSION
    || !positiveSafeInteger(value.requestId)
    || !positiveSafeInteger(value.generationId)
  ) return false;
  if (value.kind === "progress") {
    return typeof value.stage === "string"
      && WORKER_STAGES.has(value.stage as StudioVrmPhotoPoseWorkerStage)
      && typeof value.progress === "number"
      && Number.isFinite(value.progress)
      && value.progress >= 0
      && value.progress <= 1;
  }
  if (value.kind === "error") {
    return typeof value.code === "string"
      && WORKER_ERROR_CODES.has(value.code as StudioVrmPhotoPoseWorkerErrorResponse["code"]);
  }
  return value.kind === "result" && isPreprocessedResult(value.result, value.generationId);
}

export function studioVrmPhotoPoseRequestTransfers(
  request: StudioVrmPhotoPoseWorkerRequest,
): Transferable[] {
  return request.kind === "preprocess" ? [request.bytes] : [];
}

export function studioVrmPhotoPoseResponseTransfers(
  response: StudioVrmPhotoPoseWorkerResponse,
): Transferable[] {
  return response.kind === "result" ? [response.result.bitmap] : [];
}
