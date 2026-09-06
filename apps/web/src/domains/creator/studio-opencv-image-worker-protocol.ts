import {
  STUDIO_OPENCV_IMAGE_PROVIDER_LIMITS,
  type StudioOpenCvImageArtifact,
  type StudioOpenCvImageFailure,
  type StudioOpenCvImageRequest,
  type StudioOpenCvImageResult,
} from "./studio-opencv-image-provider";

export const STUDIO_OPENCV_IMAGE_WORKER_PROTOCOL_VERSION = 1 as const;

export interface StudioOpenCvImageWorkerExecuteMessage {
  readonly type: "studio-opencv-image/execute";
  readonly version: typeof STUDIO_OPENCV_IMAGE_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly request: StudioOpenCvImageRequest;
}

export interface StudioOpenCvImageWorkerCancelMessage {
  readonly type: "studio-opencv-image/cancel";
  readonly version: typeof STUDIO_OPENCV_IMAGE_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
}

export interface StudioOpenCvImageWorkerAdvanceEpochMessage {
  readonly type: "studio-opencv-image/advance-epoch";
  readonly version: typeof STUDIO_OPENCV_IMAGE_WORKER_PROTOCOL_VERSION;
  readonly requestEpoch: number;
}

export type StudioOpenCvImageWorkerInboundMessage =
  | StudioOpenCvImageWorkerExecuteMessage
  | StudioOpenCvImageWorkerCancelMessage
  | StudioOpenCvImageWorkerAdvanceEpochMessage;

export interface StudioOpenCvImageWorkerReadyMessage {
  readonly type: "studio-opencv-image/ready";
  readonly version: typeof STUDIO_OPENCV_IMAGE_WORKER_PROTOCOL_VERSION;
  readonly requestEpoch: number;
}

export interface StudioOpenCvImageWorkerResultMessage {
  readonly type: "studio-opencv-image/result";
  readonly version: typeof STUDIO_OPENCV_IMAGE_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly result: StudioOpenCvImageResult;
}

export type StudioOpenCvImageWorkerOutboundMessage =
  | StudioOpenCvImageWorkerReadyMessage
  | StudioOpenCvImageWorkerResultMessage;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === required.length
    && required.every((key) => Object.hasOwn(value, key));
}

function isRequestId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isRequestEpoch(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isStudioOpenCvImageWorkerInboundMessage(
  value: unknown,
): value is StudioOpenCvImageWorkerInboundMessage {
  if (!isPlainRecord(value) || value.version !== STUDIO_OPENCV_IMAGE_WORKER_PROTOCOL_VERSION) {
    return false;
  }
  if (value.type === "studio-opencv-image/execute") {
    return hasExactKeys(value, ["type", "version", "requestId", "request"])
      && isRequestId(value.requestId)
      && isPlainRecord(value.request);
  }
  if (value.type === "studio-opencv-image/cancel") {
    return hasExactKeys(value, ["type", "version", "requestId"])
      && isRequestId(value.requestId);
  }
  if (value.type === "studio-opencv-image/advance-epoch") {
    return hasExactKeys(value, ["type", "version", "requestEpoch"])
      && isRequestEpoch(value.requestEpoch);
  }
  return false;
}

function isReceipt(value: unknown): boolean {
  return isPlainRecord(value)
    && hasExactKeys(value, [
      "provider",
      "packageName",
      "packageVersion",
      "runtimeSource",
      "execution",
      "intendedHost",
      "synchronousJsFallback",
      "nativeHandlesReturned",
      "outputOwnership",
      "capabilities",
    ])
    && value.provider === "opencv.js"
    && value.packageName === "@techstark/opencv-js"
    && value.packageVersion === "5.0.0-release.1"
    && (value.runtimeSource === "package-dynamic-import" || value.runtimeSource === "injected")
    && value.execution === "wasm-provider"
    && value.intendedHost === "dedicated-worker"
    && value.synchronousJsFallback === false
    && value.nativeHandlesReturned === false
    && value.outputOwnership === "defensive-copy"
    && Array.isArray(value.capabilities)
    && value.capabilities.length === 4
    && value.capabilities[0] === "morphology"
    && value.capabilities[1] === "connected-components"
    && value.capabilities[2] === "contours"
    && value.capabilities[3] === "perspective-warp";
}

function isImage(value: unknown): boolean {
  if (
    !isPlainRecord(value)
    || !hasExactKeys(value, ["width", "height", "channels", "data"])
    || typeof value.width !== "number"
    || typeof value.height !== "number"
    || !Number.isSafeInteger(value.width)
    || !Number.isSafeInteger(value.height)
    || value.width <= 0
    || value.height <= 0
    || value.width > STUDIO_OPENCV_IMAGE_PROVIDER_LIMITS.maxWidth
    || value.height > STUDIO_OPENCV_IMAGE_PROVIDER_LIMITS.maxHeight
    || (value.channels !== 1 && value.channels !== 3 && value.channels !== 4)
    || !(value.data instanceof Uint8Array)
  ) {
    return false;
  }
  if (value.width > Math.floor(STUDIO_OPENCV_IMAGE_PROVIDER_LIMITS.maxPixels / value.height)) {
    return false;
  }
  return value.data.length === value.width * value.height * value.channels
    && value.data.byteLength <= STUDIO_OPENCV_IMAGE_PROVIDER_LIMITS.maxOutputBytes;
}

function isFailure(value: unknown): value is StudioOpenCvImageFailure {
  if (
    !isPlainRecord(value)
    || !hasExactKeys(value, ["ok", "reason", "detail"])
    || value.ok !== false
    || typeof value.detail !== "string"
    || value.detail.length > 1_024
  ) {
    return false;
  }
  return value.reason === "invalid-input"
    || value.reason === "budget-exceeded"
    || value.reason === "time-budget-exceeded"
    || value.reason === "cancelled"
    || value.reason === "stale-request-epoch"
    || value.reason === "backpressure"
    || value.reason === "disposed"
    || value.reason === "provider-unavailable"
    || value.reason === "unsupported-capability"
    || value.reason === "provider-failure"
    || value.reason === "invalid-provider-output"
    || value.reason === "cleanup-failure";
}

function isFiniteBounds(
  value: unknown,
  keys: readonly string[],
): value is Record<string, number> {
  return isPlainRecord(value)
    && hasExactKeys(value, keys)
    && keys.every((key) => typeof value[key] === "number" && Number.isFinite(value[key]));
}

function isArtifact(value: unknown): value is StudioOpenCvImageArtifact {
  if (!isPlainRecord(value) || !isReceipt(value.receipt)) return false;
  if (value.operation === "morphology") {
    return hasExactKeys(value, ["operation", "mode", "image", "receipt"])
      && (
        value.mode === "erode"
        || value.mode === "dilate"
        || value.mode === "open"
        || value.mode === "close"
        || value.mode === "gradient"
      )
      && isImage(value.image);
  }
  if (value.operation === "connected-components") {
    if (
      !hasExactKeys(value, ["operation", "width", "height", "labels", "components", "receipt"])
      || typeof value.width !== "number"
      || typeof value.height !== "number"
      || !Number.isSafeInteger(value.width)
      || !Number.isSafeInteger(value.height)
      || value.width <= 0
      || value.height <= 0
      || !(value.labels instanceof Int32Array)
      || value.labels.length !== value.width * value.height
      || !Array.isArray(value.components)
      || value.components.length > STUDIO_OPENCV_IMAGE_PROVIDER_LIMITS.maxComponents
    ) {
      return false;
    }
    return value.components.every((component) => (
      isPlainRecord(component)
      && hasExactKeys(component, ["label", "bounds", "area", "centroid"])
      && typeof component.label === "number"
      && Number.isSafeInteger(component.label)
      && component.label > 0
      && typeof component.area === "number"
      && Number.isSafeInteger(component.area)
      && component.area > 0
      && isFiniteBounds(component.bounds, ["x", "y", "width", "height"])
      && isFiniteBounds(component.centroid, ["x", "y"])
    ));
  }
  if (value.operation === "contours") {
    if (
      !hasExactKeys(value, ["operation", "contours", "hierarchy", "receipt"])
      || !Array.isArray(value.contours)
      || value.contours.length > STUDIO_OPENCV_IMAGE_PROVIDER_LIMITS.maxContours
      || !(value.hierarchy instanceof Int32Array)
      || value.hierarchy.length !== value.contours.length * 4
    ) {
      return false;
    }
    let points = 0;
    for (const contour of value.contours) {
      if (
        !isPlainRecord(contour)
        || !hasExactKeys(contour, ["points", "pointCount", "bounds"])
        || !(contour.points instanceof Int32Array)
        || typeof contour.pointCount !== "number"
        || !Number.isSafeInteger(contour.pointCount)
        || contour.pointCount < 1
        || contour.pointCount > STUDIO_OPENCV_IMAGE_PROVIDER_LIMITS.maxPointsPerContour
        || contour.points.length !== contour.pointCount * 2
        || !isFiniteBounds(contour.bounds, ["minX", "minY", "maxX", "maxY"])
      ) {
        return false;
      }
      points += contour.pointCount;
      if (points > STUDIO_OPENCV_IMAGE_PROVIDER_LIMITS.maxTotalContourPoints) return false;
    }
    return true;
  }
  if (value.operation === "perspective-warp") {
    return hasExactKeys(value, ["operation", "image", "transform", "receipt"])
      && isImage(value.image)
      && value.transform instanceof Float64Array
      && value.transform.length === 9
      && [...value.transform].every(Number.isFinite);
  }
  return false;
}

export function isStudioOpenCvImageResult(value: unknown): value is StudioOpenCvImageResult {
  if (isFailure(value)) return true;
  return isPlainRecord(value)
    && hasExactKeys(value, ["ok", "artifact"])
    && value.ok === true
    && isArtifact(value.artifact);
}

export function isStudioOpenCvImageWorkerOutboundMessage(
  value: unknown,
): value is StudioOpenCvImageWorkerOutboundMessage {
  if (!isPlainRecord(value) || value.version !== STUDIO_OPENCV_IMAGE_WORKER_PROTOCOL_VERSION) {
    return false;
  }
  if (value.type === "studio-opencv-image/ready") {
    return hasExactKeys(value, ["type", "version", "requestEpoch"])
      && isRequestEpoch(value.requestEpoch);
  }
  return value.type === "studio-opencv-image/result"
    && hasExactKeys(value, ["type", "version", "requestId", "result"])
    && isRequestId(value.requestId)
    && isStudioOpenCvImageResult(value.result);
}

function transferableBuffer(view: ArrayBufferView): ArrayBuffer | null {
  return view.buffer instanceof ArrayBuffer ? view.buffer : null;
}

export function studioOpenCvImageRequestTransfers(
  message: StudioOpenCvImageWorkerExecuteMessage,
): Transferable[] {
  const buffer = transferableBuffer(message.request.image.data);
  return buffer === null ? [] : [buffer];
}

export function studioOpenCvImageResultTransfers(
  message: StudioOpenCvImageWorkerResultMessage,
): Transferable[] {
  if (!message.result.ok) return [];
  const artifact = message.result.artifact;
  const buffers: ArrayBuffer[] = [];
  if (artifact.operation === "morphology" || artifact.operation === "perspective-warp") {
    const imageBuffer = transferableBuffer(artifact.image.data);
    if (imageBuffer !== null) buffers.push(imageBuffer);
    if (artifact.operation === "perspective-warp") {
      const transformBuffer = transferableBuffer(artifact.transform);
      if (transformBuffer !== null) buffers.push(transformBuffer);
    }
  } else if (artifact.operation === "connected-components") {
    const labelsBuffer = transferableBuffer(artifact.labels);
    if (labelsBuffer !== null) buffers.push(labelsBuffer);
  } else {
    for (const contour of artifact.contours) {
      const pointsBuffer = transferableBuffer(contour.points);
      if (pointsBuffer !== null) buffers.push(pointsBuffer);
    }
    const hierarchyBuffer = transferableBuffer(artifact.hierarchy);
    if (hierarchyBuffer !== null) buffers.push(hierarchyBuffer);
  }
  return [...new Set(buffers)];
}
