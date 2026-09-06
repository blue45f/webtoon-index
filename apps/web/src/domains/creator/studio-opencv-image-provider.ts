/**
 * Renderer-neutral OpenCV.js image and selection provider.
 *
 * The production runtime is loaded only after a request passes plain-data and
 * budget validation. OpenCV receives typed arrays directly; this module never
 * reads from or writes to a UI surface. Every Embind handle is registered in one
 * resource stack and explicitly deleted in reverse creation order before a
 * result crosses the boundary.
 */

import type { CV, Mat } from "@techstark/opencv-js";

export const STUDIO_OPENCV_IMAGE_PROVIDER_VERSION = 1 as const;

export const STUDIO_OPENCV_IMAGE_PROVIDER_LIMITS = Object.freeze({
  maxWidth: 8_192,
  maxHeight: 8_192,
  maxPixels: 33_554_432,
  maxInputBytes: 134_217_728,
  maxOutputBytes: 268_435_456,
  maxKernelDimension: 255,
  maxMorphologyIterations: 64,
  maxComponents: 262_144,
  maxContours: 131_072,
  maxPointsPerContour: 1_048_576,
  maxTotalContourPoints: 4_194_304,
  maxCoordinateAbsolute: 10_000_000,
  maxPendingRequests: 8,
} as const);

export type StudioOpenCvImageChannelCount = 1 | 3 | 4;

export interface StudioOpenCvImageCandidate {
  readonly width: number;
  readonly height: number;
  readonly channels: StudioOpenCvImageChannelCount;
  readonly data: Uint8Array | Uint8ClampedArray;
}

export interface StudioOpenCvImage {
  readonly width: number;
  readonly height: number;
  readonly channels: StudioOpenCvImageChannelCount;
  readonly data: Uint8Array;
}

export type StudioOpenCvMorphologyMode =
  | "erode"
  | "dilate"
  | "open"
  | "close"
  | "gradient";

export type StudioOpenCvMorphologyKernelShape = "rect" | "cross" | "ellipse";

export interface StudioOpenCvMorphologyRequest {
  readonly operation: "morphology";
  readonly requestEpoch: number;
  readonly image: StudioOpenCvImageCandidate;
  readonly mode: StudioOpenCvMorphologyMode;
  readonly kernel: Readonly<{
    readonly shape: StudioOpenCvMorphologyKernelShape;
    readonly width: number;
    readonly height: number;
  }>;
  readonly iterations?: number;
}

export interface StudioOpenCvConnectedComponentsRequest {
  readonly operation: "connected-components";
  readonly requestEpoch: number;
  readonly image: StudioOpenCvImageCandidate;
  readonly connectivity?: 4 | 8;
}

export type StudioOpenCvContourRetrievalMode =
  | "external"
  | "list"
  | "ccomp"
  | "tree";

export interface StudioOpenCvContoursRequest {
  readonly operation: "contours";
  readonly requestEpoch: number;
  readonly image: StudioOpenCvImageCandidate;
  readonly retrieval?: StudioOpenCvContourRetrievalMode;
}

export interface StudioOpenCvPointCandidate {
  readonly x: number;
  readonly y: number;
}

export type StudioOpenCvPerspectiveInterpolation =
  | "nearest"
  | "linear"
  | "cubic";

export type StudioOpenCvPerspectiveBorderMode =
  | "constant"
  | "replicate"
  | "reflect";

export interface StudioOpenCvPerspectiveWarpRequest {
  readonly operation: "perspective-warp";
  readonly requestEpoch: number;
  readonly image: StudioOpenCvImageCandidate;
  readonly sourceQuad: readonly [
    StudioOpenCvPointCandidate,
    StudioOpenCvPointCandidate,
    StudioOpenCvPointCandidate,
    StudioOpenCvPointCandidate,
  ];
  readonly destinationQuad: readonly [
    StudioOpenCvPointCandidate,
    StudioOpenCvPointCandidate,
    StudioOpenCvPointCandidate,
    StudioOpenCvPointCandidate,
  ];
  readonly output: Readonly<{
    readonly width: number;
    readonly height: number;
  }>;
  readonly interpolation?: StudioOpenCvPerspectiveInterpolation;
  readonly borderMode?: StudioOpenCvPerspectiveBorderMode;
  readonly borderValue?: readonly number[];
}

export type StudioOpenCvImageRequest =
  | StudioOpenCvMorphologyRequest
  | StudioOpenCvConnectedComponentsRequest
  | StudioOpenCvContoursRequest
  | StudioOpenCvPerspectiveWarpRequest;

export interface StudioOpenCvCapabilityReceipt {
  readonly provider: "opencv.js";
  readonly packageName: "@techstark/opencv-js";
  readonly packageVersion: "5.0.0-release.1";
  readonly runtimeSource: "package-dynamic-import" | "injected";
  readonly execution: "wasm-provider";
  readonly intendedHost: "dedicated-worker";
  readonly synchronousJsFallback: false;
  readonly nativeHandlesReturned: false;
  readonly outputOwnership: "defensive-copy";
  readonly capabilities: readonly [
    "morphology",
    "connected-components",
    "contours",
    "perspective-warp",
  ];
}

export interface StudioOpenCvConnectedComponent {
  readonly label: number;
  readonly bounds: Readonly<{
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }>;
  readonly area: number;
  readonly centroid: Readonly<{
    readonly x: number;
    readonly y: number;
  }>;
}

export interface StudioOpenCvContour {
  /** Interleaved signed integer x/y coordinates. */
  readonly points: Int32Array;
  readonly pointCount: number;
  readonly bounds: Readonly<{
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  }>;
}

export interface StudioOpenCvMorphologyArtifact {
  readonly operation: "morphology";
  readonly mode: StudioOpenCvMorphologyMode;
  readonly image: StudioOpenCvImage;
  readonly receipt: StudioOpenCvCapabilityReceipt;
}

export interface StudioOpenCvConnectedComponentsArtifact {
  readonly operation: "connected-components";
  readonly width: number;
  readonly height: number;
  readonly labels: Int32Array;
  /** Foreground components only; label zero remains represented in `labels`. */
  readonly components: readonly StudioOpenCvConnectedComponent[];
  readonly receipt: StudioOpenCvCapabilityReceipt;
}

export interface StudioOpenCvContoursArtifact {
  readonly operation: "contours";
  readonly contours: readonly StudioOpenCvContour[];
  /** OpenCV hierarchy tuples: next, previous, first-child, parent. */
  readonly hierarchy: Int32Array;
  readonly receipt: StudioOpenCvCapabilityReceipt;
}

export interface StudioOpenCvPerspectiveWarpArtifact {
  readonly operation: "perspective-warp";
  readonly image: StudioOpenCvImage;
  readonly transform: Float64Array;
  readonly receipt: StudioOpenCvCapabilityReceipt;
}

export type StudioOpenCvImageArtifact =
  | StudioOpenCvMorphologyArtifact
  | StudioOpenCvConnectedComponentsArtifact
  | StudioOpenCvContoursArtifact
  | StudioOpenCvPerspectiveWarpArtifact;

export type StudioOpenCvImageFailureReason =
  | "invalid-input"
  | "budget-exceeded"
  | "time-budget-exceeded"
  | "cancelled"
  | "stale-request-epoch"
  | "backpressure"
  | "disposed"
  | "provider-unavailable"
  | "unsupported-capability"
  | "provider-failure"
  | "invalid-provider-output"
  | "cleanup-failure";

export interface StudioOpenCvImageFailure {
  readonly ok: false;
  readonly reason: StudioOpenCvImageFailureReason;
  readonly detail: string;
}

export type StudioOpenCvImageResult =
  | Readonly<{
      readonly ok: true;
      readonly artifact: StudioOpenCvImageArtifact;
    }>
  | StudioOpenCvImageFailure;

export interface StudioOpenCvImageExecution {
  readonly signal?: AbortSignal;
}

export interface StudioOpenCvImageProviderLimits {
  readonly maxWidth?: number;
  readonly maxHeight?: number;
  readonly maxPixels?: number;
  readonly maxInputBytes?: number;
  readonly maxOutputBytes?: number;
  readonly maxKernelDimension?: number;
  readonly maxMorphologyIterations?: number;
  readonly maxComponents?: number;
  readonly maxContours?: number;
  readonly maxPointsPerContour?: number;
  readonly maxTotalContourPoints?: number;
  readonly maxCoordinateAbsolute?: number;
  readonly maxPendingRequests?: number;
}

export interface StudioOpenCvImageProviderOptions {
  readonly requestEpoch: number;
  readonly limits?: StudioOpenCvImageProviderLimits;
  /**
   * Test/host seam. Production callers omit this so the package remains lazy.
   * The runtime is still capability-validated before any handle is created.
   */
  readonly runtimeLoader?: () => CV | PromiseLike<CV>;
}

export interface StudioOpenCvImageProviderDiagnostics {
  readonly phase: "cold" | "ready" | "disposed";
  readonly requestEpoch: number;
  readonly pendingRequestCount: number;
  readonly completedRequestCount: number;
  readonly rejectedRequestCount: number;
  readonly nativeHandleCreateCount: number;
  readonly nativeHandleDeleteCount: number;
}

interface ResolvedLimits {
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly maxPixels: number;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxKernelDimension: number;
  readonly maxMorphologyIterations: number;
  readonly maxComponents: number;
  readonly maxContours: number;
  readonly maxPointsPerContour: number;
  readonly maxTotalContourPoints: number;
  readonly maxCoordinateAbsolute: number;
  readonly maxPendingRequests: number;
}

interface ParsedImage {
  readonly width: number;
  readonly height: number;
  readonly channels: StudioOpenCvImageChannelCount;
  readonly data: Uint8Array;
  readonly pixels: number;
  readonly byteLength: number;
}

interface ParsedMorphologyRequest {
  readonly operation: "morphology";
  readonly requestEpoch: number;
  readonly image: ParsedImage;
  readonly mode: StudioOpenCvMorphologyMode;
  readonly kernel: Readonly<{
    readonly shape: StudioOpenCvMorphologyKernelShape;
    readonly width: number;
    readonly height: number;
  }>;
  readonly iterations: number;
}

interface ParsedConnectedComponentsRequest {
  readonly operation: "connected-components";
  readonly requestEpoch: number;
  readonly image: ParsedImage;
  readonly connectivity: 4 | 8;
}

interface ParsedContoursRequest {
  readonly operation: "contours";
  readonly requestEpoch: number;
  readonly image: ParsedImage;
  readonly retrieval: StudioOpenCvContourRetrievalMode;
}

interface ParsedPerspectiveWarpRequest {
  readonly operation: "perspective-warp";
  readonly requestEpoch: number;
  readonly image: ParsedImage;
  readonly sourceQuad: readonly StudioOpenCvPointCandidate[];
  readonly destinationQuad: readonly StudioOpenCvPointCandidate[];
  readonly output: Readonly<{ width: number; height: number; pixels: number }>;
  readonly interpolation: StudioOpenCvPerspectiveInterpolation;
  readonly borderMode: StudioOpenCvPerspectiveBorderMode;
  readonly borderValue: readonly number[];
}

type ParsedRequest =
  | ParsedMorphologyRequest
  | ParsedConnectedComponentsRequest
  | ParsedContoursRequest
  | ParsedPerspectiveWarpRequest;

interface NativeDeletable {
  delete(): void;
}

const PROVIDER_LIMIT_KEYS = [
  "maxWidth",
  "maxHeight",
  "maxPixels",
  "maxInputBytes",
  "maxOutputBytes",
  "maxKernelDimension",
  "maxMorphologyIterations",
  "maxComponents",
  "maxContours",
  "maxPointsPerContour",
  "maxTotalContourPoints",
  "maxCoordinateAbsolute",
  "maxPendingRequests",
] as const;

const CAPABILITIES = Object.freeze([
  "morphology",
  "connected-components",
  "contours",
  "perspective-warp",
] as const);

let defaultRuntimePromise: Promise<CV> | null = null;

class StudioOpenCvStop extends Error {
  constructor(
    readonly reason: StudioOpenCvImageFailureReason,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "StudioOpenCvStop";
  }
}

class NativeResourceStack {
  private readonly resources: NativeDeletable[] = [];

  constructor(
    private readonly onCreate: () => void,
    private readonly onDelete: () => void,
  ) {}

  own<T extends NativeDeletable>(resource: T): T {
    if (
      typeof resource !== "object"
      || resource === null
      || typeof resource.delete !== "function"
    ) {
      stop("invalid-provider-output", "OpenCV returned a non-deletable native handle");
    }
    this.resources.push(resource);
    this.onCreate();
    return resource;
  }

  deleteAllReverse(): boolean {
    let clean = true;
    for (let index = this.resources.length - 1; index >= 0; index -= 1) {
      try {
        this.resources[index]!.delete();
      } catch {
        clean = false;
      } finally {
        this.onDelete();
      }
    }
    this.resources.length = 0;
    return clean;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  if (keys.length < required.length || keys.length > required.length + optional.length) {
    return false;
  }
  return required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => required.includes(key) || optional.includes(key));
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return resolved;
}

function positiveFinite(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new TypeError(`${name} must be a positive finite number`);
  }
  return resolved;
}

function resolveLimits(
  candidate: StudioOpenCvImageProviderLimits | undefined,
): ResolvedLimits {
  if (
    candidate !== undefined
    && (!isPlainRecord(candidate) || !hasExactKeys(candidate, [], PROVIDER_LIMIT_KEYS))
  ) {
    throw new TypeError("OpenCV provider limits must contain known fields only");
  }
  const limits = (candidate ?? {}) as StudioOpenCvImageProviderLimits;
  return Object.freeze({
    maxWidth: positiveInteger(
      limits.maxWidth,
      STUDIO_OPENCV_IMAGE_PROVIDER_LIMITS.maxWidth,
      "maxWidth",
    ),
    maxHeight: positiveInteger(
      limits.maxHeight,
      STUDIO_OPENCV_IMAGE_PROVIDER_LIMITS.maxHeight,
      "maxHeight",
    ),
    maxPixels: positiveInteger(
      limits.maxPixels,
      STUDIO_OPENCV_IMAGE_PROVIDER_LIMITS.maxPixels,
      "maxPixels",
    ),
    maxInputBytes: positiveInteger(
      limits.maxInputBytes,
      STUDIO_OPENCV_IMAGE_PROVIDER_LIMITS.maxInputBytes,
      "maxInputBytes",
    ),
    maxOutputBytes: positiveInteger(
      limits.maxOutputBytes,
      STUDIO_OPENCV_IMAGE_PROVIDER_LIMITS.maxOutputBytes,
      "maxOutputBytes",
    ),
    maxKernelDimension: positiveInteger(
      limits.maxKernelDimension,
      STUDIO_OPENCV_IMAGE_PROVIDER_LIMITS.maxKernelDimension,
      "maxKernelDimension",
    ),
    maxMorphologyIterations: positiveInteger(
      limits.maxMorphologyIterations,
      STUDIO_OPENCV_IMAGE_PROVIDER_LIMITS.maxMorphologyIterations,
      "maxMorphologyIterations",
    ),
    maxComponents: positiveInteger(
      limits.maxComponents,
      STUDIO_OPENCV_IMAGE_PROVIDER_LIMITS.maxComponents,
      "maxComponents",
    ),
    maxContours: positiveInteger(
      limits.maxContours,
      STUDIO_OPENCV_IMAGE_PROVIDER_LIMITS.maxContours,
      "maxContours",
    ),
    maxPointsPerContour: positiveInteger(
      limits.maxPointsPerContour,
      STUDIO_OPENCV_IMAGE_PROVIDER_LIMITS.maxPointsPerContour,
      "maxPointsPerContour",
    ),
    maxTotalContourPoints: positiveInteger(
      limits.maxTotalContourPoints,
      STUDIO_OPENCV_IMAGE_PROVIDER_LIMITS.maxTotalContourPoints,
      "maxTotalContourPoints",
    ),
    maxCoordinateAbsolute: positiveFinite(
      limits.maxCoordinateAbsolute,
      STUDIO_OPENCV_IMAGE_PROVIDER_LIMITS.maxCoordinateAbsolute,
      "maxCoordinateAbsolute",
    ),
    maxPendingRequests: positiveInteger(
      limits.maxPendingRequests,
      STUDIO_OPENCV_IMAGE_PROVIDER_LIMITS.maxPendingRequests,
      "maxPendingRequests",
    ),
  });
}

function stop(reason: StudioOpenCvImageFailureReason, detail: string): never {
  throw new StudioOpenCvStop(reason, detail);
}

export function studioOpenCvImageFailure(
  reason: StudioOpenCvImageFailureReason,
  detail: string,
): StudioOpenCvImageFailure {
  return Object.freeze({ ok: false, reason, detail });
}

function assertNotCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) stop("cancelled", "OpenCV request was cancelled");
}

function assertNoAccessorProperties(value: object, label: string): void {
  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if (!("value" in descriptor)) {
      stop("invalid-input", `${label}.${key} must not be an accessor property`);
    }
  }
}

function parseRequestEpoch(value: unknown): number {
  if (!Number.isSafeInteger(value) || typeof value !== "number" || value < 0) {
    stop("invalid-input", "requestEpoch must be a non-negative safe integer");
  }
  return value;
}

function checkedPixels(
  width: unknown,
  height: unknown,
  limits: ResolvedLimits,
  label: string,
): Readonly<{ width: number; height: number; pixels: number }> {
  if (
    typeof width !== "number"
    || typeof height !== "number"
    || !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width <= 0
    || height <= 0
  ) {
    stop("invalid-input", `${label} dimensions must be positive safe integers`);
  }
  if (width > limits.maxWidth || height > limits.maxHeight) {
    stop("budget-exceeded", `${label} dimensions exceed the configured budget`);
  }
  if (width > Math.floor(limits.maxPixels / height)) {
    stop("budget-exceeded", `${label} pixel budget exceeded`);
  }
  return Object.freeze({ width, height, pixels: width * height });
}

function isByteArray(value: unknown): value is Uint8Array | Uint8ClampedArray {
  return value instanceof Uint8Array || value instanceof Uint8ClampedArray;
}

function parseImage(value: unknown, limits: ResolvedLimits): ParsedImage {
  if (
    !isPlainRecord(value)
    || !hasExactKeys(value, ["width", "height", "channels", "data"])
  ) {
    stop("invalid-input", "image must be a plain object with exact fields");
  }
  assertNoAccessorProperties(value, "image");
  if (value.channels !== 1 && value.channels !== 3 && value.channels !== 4) {
    stop("invalid-input", "image.channels must be one, three, or four");
  }
  if (!isByteArray(value.data)) {
    stop("invalid-input", "image.data must be an unsigned byte typed array");
  }
  const dimensions = checkedPixels(value.width, value.height, limits, "image");
  const expectedBytes = dimensions.pixels * value.channels;
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes > limits.maxInputBytes) {
    stop("budget-exceeded", "image byte budget exceeded");
  }
  if (value.data.byteLength !== expectedBytes || value.data.length !== expectedBytes) {
    stop("invalid-input", "image byte length does not match its exact shape");
  }
  return Object.freeze({
    ...dimensions,
    channels: value.channels,
    data: new Uint8Array(value.data),
    byteLength: expectedBytes,
  });
}

function parsePoint(
  value: unknown,
  limits: ResolvedLimits,
  label: string,
): StudioOpenCvPointCandidate {
  if (!isPlainRecord(value)) {
    stop("invalid-input", `${label} is not a bounded finite point`);
  }
  assertNoAccessorProperties(value, label);
  if (
    !hasExactKeys(value, ["x", "y"])
    || typeof value.x !== "number"
    || typeof value.y !== "number"
    || !Number.isFinite(value.x)
    || !Number.isFinite(value.y)
    || Math.abs(value.x) > limits.maxCoordinateAbsolute
    || Math.abs(value.y) > limits.maxCoordinateAbsolute
  ) {
    stop("invalid-input", `${label} is not a bounded finite point`);
  }
  return Object.freeze({ x: value.x, y: value.y });
}

function quadrilateralArea(points: readonly StudioOpenCvPointCandidate[]): number {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return Math.abs(twiceArea) / 2;
}

function parseQuad(
  value: unknown,
  limits: ResolvedLimits,
  label: string,
): readonly StudioOpenCvPointCandidate[] {
  if (!Array.isArray(value) || value.length !== 4) {
    stop("invalid-input", `${label} must contain exactly four points`);
  }
  assertNoAccessorProperties(value, label);
  const points = value.map((point, index) => parsePoint(point, limits, `${label}[${index}]`));
  if (!Number.isFinite(quadrilateralArea(points)) || quadrilateralArea(points) < 0.000_001) {
    stop("invalid-input", `${label} is degenerate`);
  }
  return Object.freeze(points);
}

function parseBorderValue(
  value: unknown,
  channels: StudioOpenCvImageChannelCount,
): readonly number[] {
  if (value === undefined) return Object.freeze(Array.from({ length: channels }, () => 0));
  if (
    !Array.isArray(value)
    || value.length !== channels
  ) {
    stop("invalid-input", "borderValue must exactly match the image channel count");
  }
  assertNoAccessorProperties(value, "borderValue");
  const components = Array.from(
    { length: value.length },
    (_, index) => value[index],
  );
  if (
    !components.every(
      (component) => (
        typeof component === "number"
        && Number.isFinite(component)
        && component >= 0
        && component <= 255
      ),
    )
  ) {
    stop("invalid-input", "borderValue must exactly match the image channel count");
  }
  return Object.freeze(components);
}

function parseRequest(value: unknown, limits: ResolvedLimits): ParsedRequest {
  if (!isPlainRecord(value)) {
    stop("invalid-input", "OpenCV request must be a plain object");
  }
  assertNoAccessorProperties(value, "request");
  if (typeof value.operation !== "string") {
    stop("invalid-input", "OpenCV request must be a plain object");
  }

  if (value.operation === "morphology") {
    if (
      !hasExactKeys(
        value,
        ["operation", "requestEpoch", "image", "mode", "kernel"],
        ["iterations"],
      )
    ) {
      stop("invalid-input", "Morphology request contains missing or unknown fields");
    }
    if (
      value.mode !== "erode"
      && value.mode !== "dilate"
      && value.mode !== "open"
      && value.mode !== "close"
      && value.mode !== "gradient"
    ) {
      stop("invalid-input", "Morphology mode is unsupported");
    }
    if (!isPlainRecord(value.kernel)) {
      stop("invalid-input", "Morphology kernel must have positive odd dimensions");
    }
    assertNoAccessorProperties(value.kernel, "kernel");
    if (
      !hasExactKeys(value.kernel, ["shape", "width", "height"])
      || (
        value.kernel.shape !== "rect"
        && value.kernel.shape !== "cross"
        && value.kernel.shape !== "ellipse"
      )
      || typeof value.kernel.width !== "number"
      || typeof value.kernel.height !== "number"
      || !Number.isSafeInteger(value.kernel.width)
      || !Number.isSafeInteger(value.kernel.height)
      || value.kernel.width <= 0
      || value.kernel.height <= 0
      || value.kernel.width % 2 === 0
      || value.kernel.height % 2 === 0
    ) {
      stop("invalid-input", "Morphology kernel must have positive odd dimensions");
    }
    if (
      value.kernel.width > limits.maxKernelDimension
      || value.kernel.height > limits.maxKernelDimension
    ) {
      stop("budget-exceeded", "Morphology kernel exceeds the dimension budget");
    }
    const iterations = value.iterations ?? 1;
    if (
      typeof iterations !== "number"
      || !Number.isSafeInteger(iterations)
      || iterations <= 0
    ) {
      stop("invalid-input", "Morphology iterations must be a positive safe integer");
    }
    if (iterations > limits.maxMorphologyIterations) {
      stop("budget-exceeded", "Morphology iteration budget exceeded");
    }
    return Object.freeze({
      operation: "morphology",
      requestEpoch: parseRequestEpoch(value.requestEpoch),
      image: parseImage(value.image, limits),
      mode: value.mode,
      kernel: Object.freeze({
        shape: value.kernel.shape,
        width: value.kernel.width,
        height: value.kernel.height,
      }),
      iterations,
    });
  }

  if (value.operation === "connected-components") {
    if (
      !hasExactKeys(
        value,
        ["operation", "requestEpoch", "image"],
        ["connectivity"],
      )
    ) {
      stop("invalid-input", "Connected-components request contains unknown fields");
    }
    const image = parseImage(value.image, limits);
    if (image.channels !== 1) {
      stop("invalid-input", "Connected components require an exact one-channel image");
    }
    if (value.connectivity !== undefined && value.connectivity !== 4 && value.connectivity !== 8) {
      stop("invalid-input", "Connected-components connectivity must be four or eight");
    }
    return Object.freeze({
      operation: "connected-components",
      requestEpoch: parseRequestEpoch(value.requestEpoch),
      image,
      connectivity: value.connectivity ?? 8,
    });
  }

  if (value.operation === "contours") {
    if (
      !hasExactKeys(
        value,
        ["operation", "requestEpoch", "image"],
        ["retrieval"],
      )
    ) {
      stop("invalid-input", "Contours request contains unknown fields");
    }
    const image = parseImage(value.image, limits);
    if (image.channels !== 1) {
      stop("invalid-input", "Contours require an exact one-channel image");
    }
    if (
      value.retrieval !== undefined
      && value.retrieval !== "external"
      && value.retrieval !== "list"
      && value.retrieval !== "ccomp"
      && value.retrieval !== "tree"
    ) {
      stop("invalid-input", "Contour retrieval mode is unsupported");
    }
    return Object.freeze({
      operation: "contours",
      requestEpoch: parseRequestEpoch(value.requestEpoch),
      image,
      retrieval: value.retrieval ?? "external",
    });
  }

  if (value.operation === "perspective-warp") {
    if (
      !hasExactKeys(
        value,
        ["operation", "requestEpoch", "image", "sourceQuad", "destinationQuad", "output"],
        ["interpolation", "borderMode", "borderValue"],
      )
    ) {
      stop("invalid-input", "Perspective-warp request contains unknown fields");
    }
    if (
      value.interpolation !== undefined
      && value.interpolation !== "nearest"
      && value.interpolation !== "linear"
      && value.interpolation !== "cubic"
    ) {
      stop("invalid-input", "Perspective interpolation is unsupported");
    }
    if (
      value.borderMode !== undefined
      && value.borderMode !== "constant"
      && value.borderMode !== "replicate"
      && value.borderMode !== "reflect"
    ) {
      stop("invalid-input", "Perspective border mode is unsupported");
    }
    if (!isPlainRecord(value.output) || !hasExactKeys(value.output, ["width", "height"])) {
      stop("invalid-input", "Perspective output must contain exact dimensions");
    }
    assertNoAccessorProperties(value.output, "output");
    const image = parseImage(value.image, limits);
    const output = checkedPixels(value.output.width, value.output.height, limits, "output");
    const outputBytes = output.pixels * image.channels;
    if (!Number.isSafeInteger(outputBytes) || outputBytes > limits.maxOutputBytes) {
      stop("budget-exceeded", "Perspective output byte budget exceeded");
    }
    return Object.freeze({
      operation: "perspective-warp",
      requestEpoch: parseRequestEpoch(value.requestEpoch),
      image,
      sourceQuad: parseQuad(value.sourceQuad, limits, "sourceQuad"),
      destinationQuad: parseQuad(value.destinationQuad, limits, "destinationQuad"),
      output,
      interpolation: value.interpolation ?? "linear",
      borderMode: value.borderMode ?? "constant",
      borderValue: parseBorderValue(value.borderValue, image.channels),
    });
  }

  stop("invalid-input", "OpenCV operation is unsupported");
}

function isFunction(value: unknown): value is (...arguments_: never[]) => unknown {
  return typeof value === "function";
}

function validateRuntime(value: unknown): CV {
  if (typeof value !== "object" || value === null) {
    stop("provider-unavailable", "OpenCV runtime is not an object");
  }
  const runtime = value as Record<string, unknown>;
  const functions = [
    "Mat",
    "MatVector",
    "Point",
    "Size",
    "Scalar",
    "matFromArray",
    "getStructuringElement",
    "morphologyEx",
    "connectedComponentsWithStats",
    "findContours",
    "getPerspectiveTransform",
    "warpPerspective",
  ] as const;
  const constants = [
    "CV_8UC1",
    "CV_8UC3",
    "CV_8UC4",
    "CV_32S",
    "CV_32SC1",
    "CV_32SC2",
    "CV_32SC4",
    "CV_32FC2",
    "CV_64F",
    "CV_64FC1",
    "MORPH_RECT",
    "MORPH_CROSS",
    "MORPH_ELLIPSE",
    "MORPH_ERODE",
    "MORPH_DILATE",
    "MORPH_OPEN",
    "MORPH_CLOSE",
    "MORPH_GRADIENT",
    "RETR_EXTERNAL",
    "RETR_LIST",
    "RETR_CCOMP",
    "RETR_TREE",
    "CHAIN_APPROX_SIMPLE",
    "INTER_NEAREST",
    "INTER_LINEAR",
    "INTER_CUBIC",
    "BORDER_CONSTANT",
    "BORDER_REPLICATE",
    "BORDER_REFLECT",
  ] as const;
  if (!functions.every((name) => isFunction(runtime[name]))) {
    stop("unsupported-capability", "OpenCV runtime is missing a required function");
  }
  if (!constants.every((name) => typeof runtime[name] === "number")) {
    stop("unsupported-capability", "OpenCV runtime is missing a required constant");
  }
  return value as CV;
}

async function loadDefaultRuntime(): Promise<CV> {
  defaultRuntimePromise ??= import("@techstark/opencv-js").then(
    async (moduleNamespace: unknown) => {
      let candidate: unknown = moduleNamespace;
      if (
        typeof moduleNamespace === "object"
        && moduleNamespace !== null
        && "default" in moduleNamespace
      ) {
        candidate = moduleNamespace.default;
      }
      candidate = await Promise.resolve(candidate);
      if (
        typeof candidate === "object"
        && candidate !== null
        && "default" in candidate
        && !("Mat" in candidate)
      ) {
        candidate = await Promise.resolve(candidate.default);
      }
      return validateRuntime(candidate);
    },
  );
  return defaultRuntimePromise;
}

function cvImageType(runtime: CV, channels: StudioOpenCvImageChannelCount): number {
  if (channels === 1) return runtime.CV_8UC1;
  if (channels === 3) return runtime.CV_8UC3;
  return runtime.CV_8UC4;
}

function morphologyOperation(runtime: CV, mode: StudioOpenCvMorphologyMode): number {
  if (mode === "erode") return runtime.MORPH_ERODE;
  if (mode === "dilate") return runtime.MORPH_DILATE;
  if (mode === "open") return runtime.MORPH_OPEN;
  if (mode === "close") return runtime.MORPH_CLOSE;
  return runtime.MORPH_GRADIENT;
}

function morphologyShape(runtime: CV, shape: StudioOpenCvMorphologyKernelShape): number {
  if (shape === "rect") return runtime.MORPH_RECT;
  if (shape === "cross") return runtime.MORPH_CROSS;
  return runtime.MORPH_ELLIPSE;
}

function contourRetrieval(runtime: CV, mode: StudioOpenCvContourRetrievalMode): number {
  if (mode === "external") return runtime.RETR_EXTERNAL;
  if (mode === "list") return runtime.RETR_LIST;
  if (mode === "ccomp") return runtime.RETR_CCOMP;
  return runtime.RETR_TREE;
}

function interpolation(runtime: CV, mode: StudioOpenCvPerspectiveInterpolation): number {
  if (mode === "nearest") return runtime.INTER_NEAREST;
  if (mode === "cubic") return runtime.INTER_CUBIC;
  return runtime.INTER_LINEAR;
}

function borderMode(runtime: CV, mode: StudioOpenCvPerspectiveBorderMode): number {
  if (mode === "replicate") return runtime.BORDER_REPLICATE;
  if (mode === "reflect") return runtime.BORDER_REFLECT;
  return runtime.BORDER_CONSTANT;
}

function assertMatShape(
  mat: Mat,
  rows: number,
  cols: number,
  channels: number,
  type: number,
  label: string,
): void {
  if (
    mat.rows !== rows
    || mat.cols !== cols
    || mat.channels() !== channels
    || mat.type() !== type
  ) {
    stop("invalid-provider-output", `${label} has an unexpected OpenCV shape or type`);
  }
}

function exactByteCopy(mat: Mat, byteLength: number, label: string): Uint8Array {
  if (!(mat.data8U instanceof Uint8Array) || mat.data8U.length !== byteLength) {
    stop("invalid-provider-output", `${label} byte storage has an unexpected length`);
  }
  return new Uint8Array(mat.data8U);
}

function receipt(runtimeSource: StudioOpenCvCapabilityReceipt["runtimeSource"]):
StudioOpenCvCapabilityReceipt {
  return Object.freeze({
    provider: "opencv.js",
    packageName: "@techstark/opencv-js",
    packageVersion: "5.0.0-release.1",
    runtimeSource,
    execution: "wasm-provider",
    intendedHost: "dedicated-worker",
    synchronousJsFallback: false,
    nativeHandlesReturned: false,
    outputOwnership: "defensive-copy",
    capabilities: CAPABILITIES,
  });
}

function morphologyArtifact(
  runtime: CV,
  request: ParsedMorphologyRequest,
  resources: NativeResourceStack,
  limits: ResolvedLimits,
  providerReceipt: StudioOpenCvCapabilityReceipt,
): StudioOpenCvMorphologyArtifact {
  const imageType = cvImageType(runtime, request.image.channels);
  const source = resources.own(
    runtime.matFromArray(
      request.image.height,
      request.image.width,
      imageType,
      request.image.data,
    ),
  );
  const destination = resources.own(new runtime.Mat());
  const kernel = resources.own(runtime.getStructuringElement(
    morphologyShape(runtime, request.kernel.shape),
    new runtime.Size(request.kernel.width, request.kernel.height),
  ));
  runtime.morphologyEx(
    source,
    destination,
    morphologyOperation(runtime, request.mode),
    kernel,
    new runtime.Point(-1, -1),
    request.iterations,
    runtime.BORDER_CONSTANT,
  );
  assertMatShape(
    destination,
    request.image.height,
    request.image.width,
    request.image.channels,
    imageType,
    "Morphology output",
  );
  if (request.image.byteLength > limits.maxOutputBytes) {
    stop("budget-exceeded", "Morphology output byte budget exceeded");
  }
  const image = Object.freeze({
    width: request.image.width,
    height: request.image.height,
    channels: request.image.channels,
    data: exactByteCopy(destination, request.image.byteLength, "Morphology output"),
  });
  return Object.freeze({
    operation: "morphology",
    mode: request.mode,
    image,
    receipt: providerReceipt,
  });
}

function connectedComponentsArtifact(
  runtime: CV,
  request: ParsedConnectedComponentsRequest,
  resources: NativeResourceStack,
  limits: ResolvedLimits,
  providerReceipt: StudioOpenCvCapabilityReceipt,
): StudioOpenCvConnectedComponentsArtifact {
  const source = resources.own(runtime.matFromArray(
    request.image.height,
    request.image.width,
    runtime.CV_8UC1,
    request.image.data,
  ));
  const labels = resources.own(new runtime.Mat());
  const stats = resources.own(new runtime.Mat());
  const centroids = resources.own(new runtime.Mat());
  const labelCount = runtime.connectedComponentsWithStats(
    source,
    labels,
    stats,
    centroids,
    request.connectivity,
    runtime.CV_32S,
  );
  if (!Number.isSafeInteger(labelCount) || labelCount < 1) {
    stop("invalid-provider-output", "OpenCV returned an invalid connected-component count");
  }
  const foregroundCount = labelCount - 1;
  if (foregroundCount > limits.maxComponents) {
    stop("budget-exceeded", "Connected-component count budget exceeded");
  }
  assertMatShape(
    labels,
    request.image.height,
    request.image.width,
    1,
    runtime.CV_32SC1,
    "Connected-component labels",
  );
  assertMatShape(stats, labelCount, 5, 1, runtime.CV_32SC1, "Connected-component stats");
  assertMatShape(
    centroids,
    labelCount,
    2,
    1,
    runtime.CV_64FC1,
    "Connected-component centroids",
  );
  if (
    !(labels.data32S instanceof Int32Array)
    || labels.data32S.length !== request.image.pixels
    || !(stats.data32S instanceof Int32Array)
    || stats.data32S.length !== labelCount * 5
    || !(centroids.data64F instanceof Float64Array)
    || centroids.data64F.length !== labelCount * 2
  ) {
    stop("invalid-provider-output", "Connected-component storage lengths are invalid");
  }
  const outputBytes = labels.data32S.byteLength;
  if (outputBytes > limits.maxOutputBytes) {
    stop("budget-exceeded", "Connected-component label byte budget exceeded");
  }
  const components: StudioOpenCvConnectedComponent[] = [];
  for (let label = 1; label < labelCount; label += 1) {
    const offset = label * 5;
    const x = stats.data32S[offset]!;
    const y = stats.data32S[offset + 1]!;
    const width = stats.data32S[offset + 2]!;
    const height = stats.data32S[offset + 3]!;
    const area = stats.data32S[offset + 4]!;
    const centroidX = centroids.data64F[label * 2]!;
    const centroidY = centroids.data64F[label * 2 + 1]!;
    if (
      x < 0
      || y < 0
      || width <= 0
      || height <= 0
      || x + width > request.image.width
      || y + height > request.image.height
      || area <= 0
      || area > request.image.pixels
      || !Number.isFinite(centroidX)
      || !Number.isFinite(centroidY)
    ) {
      stop("invalid-provider-output", "Connected-component metadata is invalid");
    }
    components.push(Object.freeze({
      label,
      bounds: Object.freeze({ x, y, width, height }),
      area,
      centroid: Object.freeze({ x: centroidX, y: centroidY }),
    }));
  }
  return Object.freeze({
    operation: "connected-components",
    width: request.image.width,
    height: request.image.height,
    labels: new Int32Array(labels.data32S),
    components: Object.freeze(components),
    receipt: providerReceipt,
  });
}

function contourBounds(points: Int32Array): StudioOpenCvContour["bounds"] {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < points.length; index += 2) {
    const x = points[index]!;
    const y = points[index + 1]!;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return Object.freeze({ minX, minY, maxX, maxY });
}

function contoursArtifact(
  runtime: CV,
  request: ParsedContoursRequest,
  resources: NativeResourceStack,
  limits: ResolvedLimits,
  providerReceipt: StudioOpenCvCapabilityReceipt,
): StudioOpenCvContoursArtifact {
  const source = resources.own(runtime.matFromArray(
    request.image.height,
    request.image.width,
    runtime.CV_8UC1,
    request.image.data,
  ));
  const contours = resources.own(new runtime.MatVector());
  const hierarchy = resources.own(new runtime.Mat());
  runtime.findContours(
    source,
    contours,
    hierarchy,
    contourRetrieval(runtime, request.retrieval),
    runtime.CHAIN_APPROX_SIMPLE,
  );
  const contourCount = contours.size();
  if (!Number.isSafeInteger(contourCount) || contourCount < 0) {
    stop("invalid-provider-output", "OpenCV returned an invalid contour count");
  }
  if (contourCount > limits.maxContours) {
    stop("budget-exceeded", "Contour count budget exceeded");
  }
  const output: StudioOpenCvContour[] = [];
  let totalPoints = 0;
  let outputBytes = contourCount * 4 * Int32Array.BYTES_PER_ELEMENT;
  for (let index = 0; index < contourCount; index += 1) {
    const contour = resources.own(contours.get(index));
    if (
      contour.cols !== 1
      || contour.channels() !== 2
      || contour.type() !== runtime.CV_32SC2
      || !(contour.data32S instanceof Int32Array)
      || contour.data32S.length % 2 !== 0
    ) {
      stop("invalid-provider-output", "OpenCV returned an invalid contour matrix");
    }
    const pointCount = contour.data32S.length / 2;
    if (pointCount < 1 || pointCount > limits.maxPointsPerContour) {
      stop("budget-exceeded", "Contour point budget exceeded");
    }
    totalPoints += pointCount;
    if (totalPoints > limits.maxTotalContourPoints) {
      stop("budget-exceeded", "Aggregate contour point budget exceeded");
    }
    outputBytes += contour.data32S.byteLength;
    if (outputBytes > limits.maxOutputBytes) {
      stop("budget-exceeded", "Contour output byte budget exceeded");
    }
    const points = new Int32Array(contour.data32S);
    output.push(Object.freeze({
      points,
      pointCount,
      bounds: contourBounds(points),
    }));
  }
  const expectedHierarchyValues = contourCount * 4;
  if (
    !(hierarchy.data32S instanceof Int32Array)
    || hierarchy.data32S.length !== expectedHierarchyValues
  ) {
    stop("invalid-provider-output", "OpenCV contour hierarchy has an invalid shape");
  }
  return Object.freeze({
    operation: "contours",
    contours: Object.freeze(output),
    hierarchy: new Int32Array(hierarchy.data32S),
    receipt: providerReceipt,
  });
}

function perspectiveWarpArtifact(
  runtime: CV,
  request: ParsedPerspectiveWarpRequest,
  resources: NativeResourceStack,
  providerReceipt: StudioOpenCvCapabilityReceipt,
): StudioOpenCvPerspectiveWarpArtifact {
  const imageType = cvImageType(runtime, request.image.channels);
  const source = resources.own(runtime.matFromArray(
    request.image.height,
    request.image.width,
    imageType,
    request.image.data,
  ));
  const destination = resources.own(new runtime.Mat());
  const sourcePoints = resources.own(runtime.matFromArray(
    4,
    1,
    runtime.CV_32FC2,
    Float32Array.from(request.sourceQuad.flatMap(({ x, y }) => [x, y])),
  ));
  const destinationPoints = resources.own(runtime.matFromArray(
    4,
    1,
    runtime.CV_32FC2,
    Float32Array.from(request.destinationQuad.flatMap(({ x, y }) => [x, y])),
  ));
  const transform = resources.own(
    runtime.getPerspectiveTransform(sourcePoints, destinationPoints),
  );
  runtime.warpPerspective(
    source,
    destination,
    transform,
    new runtime.Size(request.output.width, request.output.height),
    interpolation(runtime, request.interpolation),
    borderMode(runtime, request.borderMode),
    new runtime.Scalar(
      request.borderValue[0] ?? 0,
      request.borderValue[1] ?? 0,
      request.borderValue[2] ?? 0,
      request.borderValue[3] ?? 0,
    ),
  );
  assertMatShape(
    destination,
    request.output.height,
    request.output.width,
    request.image.channels,
    imageType,
    "Perspective output",
  );
  assertMatShape(transform, 3, 3, 1, runtime.CV_64FC1, "Perspective transform");
  const outputByteLength = request.output.pixels * request.image.channels;
  if (!(transform.data64F instanceof Float64Array) || transform.data64F.length !== 9) {
    stop("invalid-provider-output", "Perspective transform storage is invalid");
  }
  const image = Object.freeze({
    width: request.output.width,
    height: request.output.height,
    channels: request.image.channels,
    data: exactByteCopy(destination, outputByteLength, "Perspective output"),
  });
  return Object.freeze({
    operation: "perspective-warp",
    image,
    transform: new Float64Array(transform.data64F),
    receipt: providerReceipt,
  });
}

function runWithResources(
  runtime: CV,
  request: ParsedRequest,
  limits: ResolvedLimits,
  providerReceipt: StudioOpenCvCapabilityReceipt,
  onCreate: () => void,
  onDelete: () => void,
): StudioOpenCvImageArtifact {
  const resources = new NativeResourceStack(onCreate, onDelete);
  let artifact: StudioOpenCvImageArtifact | null = null;
  let operationError: unknown;
  try {
    if (request.operation === "morphology") {
      artifact = morphologyArtifact(runtime, request, resources, limits, providerReceipt);
    } else if (request.operation === "connected-components") {
      artifact = connectedComponentsArtifact(
        runtime,
        request,
        resources,
        limits,
        providerReceipt,
      );
    } else if (request.operation === "contours") {
      artifact = contoursArtifact(runtime, request, resources, limits, providerReceipt);
    } else {
      artifact = perspectiveWarpArtifact(runtime, request, resources, providerReceipt);
    }
  } catch (error) {
    operationError = error;
  }
  const clean = resources.deleteAllReverse();
  if (!clean) stop("cleanup-failure", "One or more OpenCV native handles failed to delete");
  if (operationError !== undefined) throw operationError;
  if (artifact === null) stop("provider-failure", "OpenCV operation produced no artifact");
  return artifact;
}

export class StudioOpenCvImageProvider {
  private readonly limits: ResolvedLimits;
  private readonly runtimeLoader: () => CV | PromiseLike<CV>;
  private readonly runtimeSource: StudioOpenCvCapabilityReceipt["runtimeSource"];
  private runtimePromise: Promise<CV> | null = null;
  private currentRequestEpoch: number;
  private disposed = false;
  private pendingRequestCount = 0;
  private completedRequestCount = 0;
  private rejectedRequestCount = 0;
  private nativeHandleCreateCount = 0;
  private nativeHandleDeleteCount = 0;

  constructor(options: StudioOpenCvImageProviderOptions) {
    if (
      !isPlainRecord(options)
      || !hasExactKeys(options, ["requestEpoch"], ["limits", "runtimeLoader"])
      || !Number.isSafeInteger(options.requestEpoch)
      || options.requestEpoch < 0
      || (
        options.runtimeLoader !== undefined
        && typeof options.runtimeLoader !== "function"
      )
    ) {
      throw new TypeError("OpenCV provider options are invalid");
    }
    const validatedOptions = options as StudioOpenCvImageProviderOptions;
    this.currentRequestEpoch = validatedOptions.requestEpoch;
    this.limits = resolveLimits(validatedOptions.limits);
    this.runtimeLoader = validatedOptions.runtimeLoader ?? loadDefaultRuntime;
    this.runtimeSource = validatedOptions.runtimeLoader === undefined
      ? "package-dynamic-import"
      : "injected";
  }

  private loadRuntime(): Promise<CV> {
    this.runtimePromise ??= Promise.resolve()
      .then(() => this.runtimeLoader())
      .then((runtime) => validateRuntime(runtime))
      .catch((error: unknown) => {
        this.runtimePromise = null;
        throw error;
      });
    return this.runtimePromise;
  }

  public execute(
    candidate: unknown,
    execution: StudioOpenCvImageExecution = {},
  ): Promise<StudioOpenCvImageResult> {
    if (this.disposed) {
      this.rejectedRequestCount += 1;
      return Promise.resolve(
        studioOpenCvImageFailure("disposed", "OpenCV provider is disposed"),
      );
    }
    let signal: AbortSignal | undefined;
    if (
      !isPlainRecord(execution)
      || !hasExactKeys(execution, [], ["signal"])
    ) {
      this.rejectedRequestCount += 1;
      return Promise.resolve(
        studioOpenCvImageFailure("invalid-input", "OpenCV execution options are invalid"),
      );
    }
    try {
      assertNoAccessorProperties(execution, "execution");
      const signalValue = Object.getOwnPropertyDescriptor(execution, "signal")?.value;
      if (
        signalValue !== undefined
        && (
          typeof AbortSignal === "undefined"
          || !(signalValue instanceof AbortSignal)
        )
      ) {
        stop("invalid-input", "OpenCV execution signal is invalid");
      }
      signal = signalValue;
    } catch {
      this.rejectedRequestCount += 1;
      return Promise.resolve(
        studioOpenCvImageFailure("invalid-input", "OpenCV execution options are invalid"),
      );
    }

    if (this.pendingRequestCount >= this.limits.maxPendingRequests) {
      this.rejectedRequestCount += 1;
      return Promise.resolve(
        studioOpenCvImageFailure("backpressure", "OpenCV pending-request budget exceeded"),
      );
    }

    let request: ParsedRequest;
    try {
      request = parseRequest(candidate, this.limits);
      assertNotCancelled(signal);
      if (request.requestEpoch !== this.currentRequestEpoch) {
        stop("stale-request-epoch", "OpenCV request epoch is stale");
      }
    } catch (error) {
      this.rejectedRequestCount += 1;
      if (error instanceof StudioOpenCvStop) {
        return Promise.resolve(studioOpenCvImageFailure(error.reason, error.detail));
      }
      return Promise.resolve(
        studioOpenCvImageFailure("invalid-input", "OpenCV request is invalid"),
      );
    }

    this.pendingRequestCount += 1;
    const admittedEpoch = this.currentRequestEpoch;

    return (async (): Promise<StudioOpenCvImageResult> => {
      try {
        let runtime: CV;
        try {
          runtime = await this.loadRuntime();
        } catch (error) {
          if (error instanceof StudioOpenCvStop) throw error;
          stop("provider-unavailable", "OpenCV runtime failed to initialize");
        }
        assertNotCancelled(signal);
        if (this.disposed) stop("disposed", "OpenCV provider was disposed during execution");
        if (
          admittedEpoch !== this.currentRequestEpoch
          || request.requestEpoch !== this.currentRequestEpoch
        ) {
          stop("stale-request-epoch", "OpenCV request became stale before execution");
        }
        const artifact = runWithResources(
          runtime,
          request,
          this.limits,
          receipt(this.runtimeSource),
          () => {
            this.nativeHandleCreateCount += 1;
          },
          () => {
            this.nativeHandleDeleteCount += 1;
          },
        );
        assertNotCancelled(signal);
        if (admittedEpoch !== this.currentRequestEpoch) {
          stop("stale-request-epoch", "OpenCV request became stale after execution");
        }
        this.completedRequestCount += 1;
        return Object.freeze({ ok: true, artifact });
      } catch (error) {
        this.rejectedRequestCount += 1;
        if (error instanceof StudioOpenCvStop) {
          return studioOpenCvImageFailure(error.reason, error.detail);
        }
        return studioOpenCvImageFailure(
          "provider-failure",
          "OpenCV operation failed closed",
        );
      } finally {
        this.pendingRequestCount -= 1;
      }
    })();
  }

  public advanceRequestEpoch(nextEpoch: number): boolean {
    if (
      this.disposed
      || !Number.isSafeInteger(nextEpoch)
      || nextEpoch <= this.currentRequestEpoch
    ) {
      return false;
    }
    this.currentRequestEpoch = nextEpoch;
    return true;
  }

  public getDiagnostics(): StudioOpenCvImageProviderDiagnostics {
    return Object.freeze({
      phase: this.disposed ? "disposed" : this.runtimePromise === null ? "cold" : "ready",
      requestEpoch: this.currentRequestEpoch,
      pendingRequestCount: this.pendingRequestCount,
      completedRequestCount: this.completedRequestCount,
      rejectedRequestCount: this.rejectedRequestCount,
      nativeHandleCreateCount: this.nativeHandleCreateCount,
      nativeHandleDeleteCount: this.nativeHandleDeleteCount,
    });
  }

  public dispose(): void {
    this.disposed = true;
  }
}

export function createStudioOpenCvImageProvider(
  options: StudioOpenCvImageProviderOptions,
): StudioOpenCvImageProvider {
  return new StudioOpenCvImageProvider(options);
}
