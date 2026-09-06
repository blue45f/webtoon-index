import {
  STUDIO_LAYER_LIFT_MASK_MAX_DIMENSION,
  STUDIO_LAYER_LIFT_MASK_MAX_MORPHOLOGY_ITERATIONS,
  STUDIO_LAYER_LIFT_MASK_MAX_MORPHOLOGY_NEIGHBOR_VISITS,
  STUDIO_LAYER_LIFT_MASK_MAX_PIXELS,
  estimateStudioLayerLiftMorphologyWork,
  type StudioLayerLiftConnectivity,
  type StudioLayerLiftIslandStatistics,
  type StudioLayerLiftMaskFailureCode,
  type StudioLayerLiftMaskStatistics,
  type StudioLayerLiftMorphologyOperation,
  type StudioLayerLiftPreparationOptions,
  type StudioLayerLiftPreparationResult,
} from "./studio-layer-lift-mask";

export const STUDIO_LAYER_LIFT_MASK_WORKER_PROTOCOL_VERSION = 1 as const;
export const STUDIO_LAYER_LIFT_MASK_WORKER_MAX_PEAK_BYTES =
  384 * 1024 * 1024;
export const STUDIO_LAYER_LIFT_MASK_WORKER_MAX_AGGREGATE_NEIGHBOR_VISITS =
  STUDIO_LAYER_LIFT_MASK_MAX_MORPHOLOGY_NEIGHBOR_VISITS;

const MAX_FAILURE_MESSAGE_CHARACTERS = 256;

export interface StudioLayerLiftMaskWorkerInput {
  /**
   * `run` takes ownership of both complete backing buffers. A successful
   * `postMessage` detaches them from the caller; clone first if they are needed
   * elsewhere. Partial views and shared/resizable buffers are rejected.
   */
  readonly confidence: {
    readonly width: number;
    readonly height: number;
    readonly confidence: Float32Array<ArrayBuffer>;
  };
  readonly sourceAlpha: {
    readonly width: number;
    readonly height: number;
    readonly alpha:
      | Uint8Array<ArrayBuffer>
      | Uint8ClampedArray<ArrayBuffer>;
  };
  readonly options?: StudioLayerLiftPreparationOptions;
}

export interface StudioLayerLiftMaskWorkerCanonicalOptions {
  readonly threshold: number;
  readonly feather: number;
  readonly morphology: Readonly<{
    readonly operation: StudioLayerLiftMorphologyOperation;
    readonly iterations: number;
    readonly connectivity: StudioLayerLiftConnectivity;
  }> | null;
  readonly islands: Readonly<{
    readonly minimumPixels: number;
    readonly connectivity: StudioLayerLiftConnectivity;
  }> | null;
}

export interface StudioLayerLiftMaskWorkerPreflight {
  readonly confidencePixelCount: number;
  readonly targetPixelCount: number;
  readonly inputByteLength: number;
  readonly outputByteLength: number;
  readonly morphologyPassCount: number;
  readonly morphologyMaximumNeighborsPerPixel: 0 | 5 | 9;
  readonly morphologyMaximumNeighborVisits: number;
  readonly islandMaximumNeighborsPerPixel: 0 | 4 | 8;
  readonly islandMaximumNeighborVisits: number;
  readonly aggregateMaximumNeighborVisits: number;
  readonly peakByteLength: number;
}

export type StudioLayerLiftMaskWorkerPreflightFailureCode =
  | "invalid-request"
  | "memory-budget-exceeded"
  | "work-budget-exceeded";

export type StudioLayerLiftMaskWorkerPreflightResult =
  | Readonly<{
      readonly ok: true;
      readonly options: StudioLayerLiftMaskWorkerCanonicalOptions;
      readonly value: StudioLayerLiftMaskWorkerPreflight;
    }>
  | Readonly<{
      readonly ok: false;
      readonly code: StudioLayerLiftMaskWorkerPreflightFailureCode;
      readonly message: string;
    }>;

interface StudioLayerLiftMaskWorkerPlane {
  readonly role: "confidence" | "source-alpha";
  readonly encoding: "float32" | "uint8";
  readonly width: number;
  readonly height: number;
  readonly pixelCount: number;
  readonly byteLength: number;
  readonly buffer: ArrayBuffer;
}

export interface StudioLayerLiftMaskWorkerRequest {
  readonly planes: readonly [
    StudioLayerLiftMaskWorkerPlane & {
      readonly role: "confidence";
      readonly encoding: "float32";
    },
    StudioLayerLiftMaskWorkerPlane & {
      readonly role: "source-alpha";
      readonly encoding: "uint8";
    },
  ];
  readonly options: StudioLayerLiftMaskWorkerCanonicalOptions;
  readonly preflight: StudioLayerLiftMaskWorkerPreflight;
}

export interface StudioLayerLiftMaskWorkerRunMessage {
  readonly type: "studio-layer-lift-mask/run";
  readonly version: typeof STUDIO_LAYER_LIFT_MASK_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly epoch: number;
  readonly request: StudioLayerLiftMaskWorkerRequest;
}

interface StudioLayerLiftMaskWorkerOutputPlane {
  readonly role: "confidence" | "matte" | "binary" | "foreground-alpha";
  readonly encoding: "float32" | "uint8";
  readonly byteLength: number;
  readonly buffer: ArrayBuffer;
}

interface StudioLayerLiftMaskWorkerSuccessResult {
  readonly ok: true;
  readonly empty: false;
  readonly width: number;
  readonly height: number;
  readonly pixelCount: number;
  readonly planes: readonly [
    StudioLayerLiftMaskWorkerOutputPlane & {
      readonly role: "confidence";
      readonly encoding: "float32";
    },
    StudioLayerLiftMaskWorkerOutputPlane & {
      readonly role: "matte";
      readonly encoding: "float32";
    },
    StudioLayerLiftMaskWorkerOutputPlane & {
      readonly role: "binary";
      readonly encoding: "uint8";
    },
    StudioLayerLiftMaskWorkerOutputPlane & {
      readonly role: "foreground-alpha";
      readonly encoding: "uint8";
    },
  ];
  readonly maskStatistics: StudioLayerLiftMaskStatistics;
  readonly foregroundStatistics: StudioLayerLiftMaskStatistics;
  readonly islandStatistics: StudioLayerLiftIslandStatistics | null;
}

interface StudioLayerLiftMaskWorkerFailureResult {
  readonly ok: false;
  readonly empty: false;
  readonly code: StudioLayerLiftMaskFailureCode;
  readonly message: string;
  readonly sampleIndex: number | null;
}

interface StudioLayerLiftMaskWorkerEmptyResult {
  readonly ok: false;
  readonly empty: true;
  readonly code: "empty-foreground";
  readonly message: string;
  readonly width: number;
  readonly height: number;
  readonly pixelCount: number;
  readonly maskStatistics: StudioLayerLiftMaskStatistics;
  readonly foregroundStatistics: StudioLayerLiftMaskStatistics;
}

export type StudioLayerLiftMaskWorkerWireResult =
  | StudioLayerLiftMaskWorkerSuccessResult
  | StudioLayerLiftMaskWorkerFailureResult
  | StudioLayerLiftMaskWorkerEmptyResult;

export interface StudioLayerLiftMaskWorkerResultMessage {
  readonly type: "studio-layer-lift-mask/result";
  readonly version: typeof STUDIO_LAYER_LIFT_MASK_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly epoch: number;
  readonly result: StudioLayerLiftMaskWorkerWireResult;
}

export type StudioLayerLiftMaskWorkerTransportFailureCode =
  | "execution-failed"
  | "protocol-error";

export interface StudioLayerLiftMaskWorkerFailureMessage {
  readonly type: "studio-layer-lift-mask/failure";
  readonly version: typeof STUDIO_LAYER_LIFT_MASK_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly epoch: number;
  readonly code: StudioLayerLiftMaskWorkerTransportFailureCode;
}

export type StudioLayerLiftMaskWorkerResponseMessage =
  | StudioLayerLiftMaskWorkerResultMessage
  | StudioLayerLiftMaskWorkerFailureMessage;

export class StudioLayerLiftMaskWorkerProtocolError extends Error {
  constructor(
    readonly code: StudioLayerLiftMaskWorkerPreflightFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "StudioLayerLiftMaskWorkerProtocolError";
  }
}

const MASK_FAILURE_CODES = new Set<StudioLayerLiftMaskFailureCode>([
  "invalid-mask",
  "invalid-dimensions",
  "dimension-budget-exceeded",
  "pixel-budget-exceeded",
  "buffer-length-mismatch",
  "invalid-confidence-buffer",
  "invalid-alpha-mask-buffer",
  "invalid-source-alpha-buffer",
  "invalid-binary-mask-buffer",
  "invalid-confidence-value",
  "invalid-mask-value",
  "dimension-mismatch",
  "invalid-options",
  "work-budget-exceeded",
  "allocation-failed",
  "empty-foreground",
]);

function dataRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): Record<string, unknown> | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const allowed = new Set([...requiredKeys, ...optionalKeys]);
    const keys = Reflect.ownKeys(value);
    if (
      keys.some((key) => typeof key !== "string" || !allowed.has(key))
      || requiredKeys.some((key) => !keys.includes(key))
    ) {
      return null;
    }
    const record: Record<string, unknown> = {};
    for (const key of keys) {
      if (typeof key !== "string") return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        return null;
      }
      record[key] = descriptor.value;
    }
    return record;
  } catch {
    return null;
  }
}

function exactDenseArray(value: unknown, length: number): readonly unknown[] | null {
  try {
    if (
      !Array.isArray(value)
      || Object.getPrototypeOf(value) !== Array.prototype
      || value.length !== length
    ) {
      return null;
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1 || !keys.includes("length")) return null;
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        return null;
      }
    }
    return value;
  } catch {
    return null;
  }
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number"
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum
  );
}

function fullOwnedBuffer(view: ArrayBufferView): view is ArrayBufferView<ArrayBuffer> {
  return (
    view.buffer instanceof ArrayBuffer
    && view.byteOffset === 0
    && view.byteLength === view.buffer.byteLength
    && Reflect.get(view.buffer, "resizable") !== true
  );
}

function dimensions(
  width: unknown,
  height: unknown,
): Readonly<{ width: number; height: number; pixelCount: number }> | null {
  if (
    !positiveSafeInteger(width)
    || !positiveSafeInteger(height)
    || width > STUDIO_LAYER_LIFT_MASK_MAX_DIMENSION
    || height > STUDIO_LAYER_LIFT_MASK_MAX_DIMENSION
  ) {
    return null;
  }
  const pixelCount = width * height;
  return Number.isSafeInteger(pixelCount)
    && pixelCount <= STUDIO_LAYER_LIFT_MASK_MAX_PIXELS
    ? Object.freeze({ width, height, pixelCount })
    : null;
}

function normalizeOptions(
  value: unknown,
): StudioLayerLiftMaskWorkerCanonicalOptions | null {
  const options = value === undefined
    ? {}
    : dataRecord(value, [], ["threshold", "feather", "morphology", "islands"]);
  if (!options) return null;
  const threshold = options.threshold ?? 0.5;
  const feather = options.feather ?? 0;
  if (
    !finiteInRange(threshold, 0, 1)
    || !finiteInRange(feather, 0, 1)
    || (
      feather > 0
      && (threshold - feather / 2 < 0 || threshold + feather / 2 > 1)
    )
  ) {
    return null;
  }

  let morphology: StudioLayerLiftMaskWorkerCanonicalOptions["morphology"] = null;
  if (options.morphology !== undefined) {
    const candidate = dataRecord(
      options.morphology,
      ["operation"],
      ["iterations", "connectivity"],
    );
    if (!candidate) return null;
    const operation = candidate.operation;
    const iterations = candidate.iterations ?? 1;
    const connectivity = candidate.connectivity ?? 8;
    if (
      (
        operation !== "dilate"
        && operation !== "erode"
        && operation !== "close"
        && operation !== "open"
      )
      || !nonNegativeSafeInteger(iterations)
      || iterations > STUDIO_LAYER_LIFT_MASK_MAX_MORPHOLOGY_ITERATIONS
      || (connectivity !== 4 && connectivity !== 8)
    ) {
      return null;
    }
    morphology = Object.freeze({ operation, iterations, connectivity });
  }

  let islands: StudioLayerLiftMaskWorkerCanonicalOptions["islands"] = null;
  if (options.islands !== undefined) {
    const candidate = dataRecord(
      options.islands,
      ["minimumPixels"],
      ["connectivity"],
    );
    if (!candidate) return null;
    const minimumPixels = candidate.minimumPixels;
    const connectivity = candidate.connectivity ?? 8;
    if (
      !positiveSafeInteger(minimumPixels)
      || minimumPixels > STUDIO_LAYER_LIFT_MASK_MAX_PIXELS
      || (connectivity !== 4 && connectivity !== 8)
    ) {
      return null;
    }
    islands = Object.freeze({ minimumPixels, connectivity });
  }

  return Object.freeze({ threshold, feather, morphology, islands });
}

function readCanonicalOptions(
  value: unknown,
): StudioLayerLiftMaskWorkerCanonicalOptions | null {
  const options = dataRecord(
    value,
    ["threshold", "feather", "morphology", "islands"],
  );
  if (!options) return null;
  const partial: Record<string, unknown> = {
    threshold: options.threshold,
    feather: options.feather,
  };
  if (options.morphology !== null) {
    const morphology = dataRecord(
      options.morphology,
      ["operation", "iterations", "connectivity"],
    );
    if (!morphology) return null;
    partial.morphology = morphology;
  }
  if (options.islands !== null) {
    const islands = dataRecord(
      options.islands,
      ["minimumPixels", "connectivity"],
    );
    if (!islands) return null;
    partial.islands = islands;
  }
  return normalizeOptions(partial);
}

function preflightFailure(
  code: StudioLayerLiftMaskWorkerPreflightFailureCode,
  message: string,
): StudioLayerLiftMaskWorkerPreflightResult {
  return Object.freeze({ ok: false, code, message });
}

function calculatePreflight(
  confidence: Readonly<{ pixelCount: number; width: number; height: number }>,
  target: Readonly<{ pixelCount: number; width: number; height: number }>,
  options: StudioLayerLiftMaskWorkerCanonicalOptions,
): StudioLayerLiftMaskWorkerPreflightResult {
  let morphologyPassCount = 0;
  let morphologyMaximumNeighborsPerPixel: 0 | 5 | 9 = 0;
  let morphologyMaximumNeighborVisits = 0;
  if (options.morphology) {
    const estimated = estimateStudioLayerLiftMorphologyWork({
      pixelCount: target.pixelCount,
      ...options.morphology,
    });
    if (!estimated.ok) {
      return preflightFailure(
        estimated.code === "work-budget-exceeded"
          ? "work-budget-exceeded"
          : "invalid-request",
        estimated.message,
      );
    }
    morphologyPassCount = estimated.value.passCount;
    morphologyMaximumNeighborsPerPixel =
      estimated.value.maximumNeighborsPerPixel;
    morphologyMaximumNeighborVisits =
      estimated.value.maximumNeighborVisits;
  }

  const islandMaximumNeighborsPerPixel: 0 | 4 | 8 =
    options.islands?.connectivity ?? 0;
  const islandMaximumNeighborVisits =
    target.pixelCount * islandMaximumNeighborsPerPixel;
  const aggregateMaximumNeighborVisits =
    morphologyMaximumNeighborVisits + islandMaximumNeighborVisits;
  if (
    !Number.isSafeInteger(aggregateMaximumNeighborVisits)
    || aggregateMaximumNeighborVisits
      > STUDIO_LAYER_LIFT_MASK_WORKER_MAX_AGGREGATE_NEIGHBOR_VISITS
  ) {
    return preflightFailure(
      "work-budget-exceeded",
      "Layer-lift aggregate neighbour work exceeds the Worker budget.",
    );
  }

  const requiresResample =
    confidence.width !== target.width || confidence.height !== target.height;
  const targetFrameMultiplier = options.islands
    ? 15 + (options.morphology ? 1 : 0)
    : 13 + (options.morphology ? 1 : 0);
  // Core snapshots both inputs. The target multiplier is the maximum set of
  // simultaneously live full-frame arrays at the final-composition or island
  // phase; resampling adds one Float32 target frame. It is deliberately a peak,
  // not a sum over morphology passes, whose previous frames are no longer live.
  const peakByteLength =
    confidence.pixelCount * Float32Array.BYTES_PER_ELEMENT * 2
    + target.pixelCount
      * (targetFrameMultiplier + (requiresResample ? 4 : 0));
  if (
    !Number.isSafeInteger(peakByteLength)
    || peakByteLength > STUDIO_LAYER_LIFT_MASK_WORKER_MAX_PEAK_BYTES
  ) {
    return preflightFailure(
      "memory-budget-exceeded",
      "Layer-lift full-frame peak memory exceeds the Worker budget.",
    );
  }

  const inputByteLength =
    confidence.pixelCount * Float32Array.BYTES_PER_ELEMENT
    + target.pixelCount;
  const outputByteLength = target.pixelCount * 10;
  return Object.freeze({
    ok: true,
    options,
    value: Object.freeze({
      confidencePixelCount: confidence.pixelCount,
      targetPixelCount: target.pixelCount,
      inputByteLength,
      outputByteLength,
      morphologyPassCount,
      morphologyMaximumNeighborsPerPixel,
      morphologyMaximumNeighborVisits,
      islandMaximumNeighborsPerPixel,
      islandMaximumNeighborVisits,
      aggregateMaximumNeighborVisits,
      peakByteLength,
    }),
  });
}

export function preflightStudioLayerLiftMaskWorker(input: {
  readonly confidenceWidth: number;
  readonly confidenceHeight: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly options?: StudioLayerLiftPreparationOptions;
}): StudioLayerLiftMaskWorkerPreflightResult {
  const record = dataRecord(
    input,
    ["confidenceWidth", "confidenceHeight", "sourceWidth", "sourceHeight"],
    ["options"],
  );
  if (!record) {
    return preflightFailure("invalid-request", "Layer-lift Worker preflight shape is invalid.");
  }
  const confidence = dimensions(record.confidenceWidth, record.confidenceHeight);
  const target = dimensions(record.sourceWidth, record.sourceHeight);
  const options = normalizeOptions(record.options);
  if (!confidence || !target || !options) {
    return preflightFailure("invalid-request", "Layer-lift Worker preflight values are invalid.");
  }
  return calculatePreflight(confidence, target, options);
}

export function admitStudioLayerLiftMaskWorkerInput(
  input: StudioLayerLiftMaskWorkerInput,
): StudioLayerLiftMaskWorkerRequest {
  const record = dataRecord(
    input,
    ["confidence", "sourceAlpha"],
    ["options"],
  );
  const confidenceRecord = record
    ? dataRecord(record.confidence, ["width", "height", "confidence"])
    : null;
  const sourceRecord = record
    ? dataRecord(record.sourceAlpha, ["width", "height", "alpha"])
    : null;
  const confidence = confidenceRecord?.confidence;
  const sourceAlpha = sourceRecord?.alpha;
  if (
    !record
    || !confidenceRecord
    || !sourceRecord
    || !(confidence instanceof Float32Array)
    || (
      !(sourceAlpha instanceof Uint8Array)
      && !(sourceAlpha instanceof Uint8ClampedArray)
    )
    || !fullOwnedBuffer(confidence)
    || !fullOwnedBuffer(sourceAlpha)
    || confidence.buffer === sourceAlpha.buffer
  ) {
    throw new StudioLayerLiftMaskWorkerProtocolError(
      "invalid-request",
      "Layer-lift Worker inputs must own two distinct complete ArrayBuffers.",
    );
  }
  const confidenceDimensions = dimensions(
    confidenceRecord.width,
    confidenceRecord.height,
  );
  const sourceDimensions = dimensions(sourceRecord.width, sourceRecord.height);
  if (
    !confidenceDimensions
    || !sourceDimensions
    || confidence.byteLength
      !== confidenceDimensions.pixelCount * Float32Array.BYTES_PER_ELEMENT
    || sourceAlpha.byteLength !== sourceDimensions.pixelCount
  ) {
    throw new StudioLayerLiftMaskWorkerProtocolError(
      "invalid-request",
      "Layer-lift Worker buffer lengths do not match their dimensions.",
    );
  }
  const preflight = preflightStudioLayerLiftMaskWorker({
    confidenceWidth: confidenceDimensions.width,
    confidenceHeight: confidenceDimensions.height,
    sourceWidth: sourceDimensions.width,
    sourceHeight: sourceDimensions.height,
    ...(record.options === undefined ? {} : {
      options: record.options as StudioLayerLiftPreparationOptions,
    }),
  });
  if (!preflight.ok) {
    throw new StudioLayerLiftMaskWorkerProtocolError(
      preflight.code,
      preflight.message,
    );
  }
  const planes: StudioLayerLiftMaskWorkerRequest["planes"] = Object.freeze([
      Object.freeze({
        role: "confidence",
        encoding: "float32",
        width: confidenceDimensions.width,
        height: confidenceDimensions.height,
        pixelCount: confidenceDimensions.pixelCount,
        byteLength: confidence.byteLength,
        buffer: confidence.buffer,
      }),
      Object.freeze({
        role: "source-alpha",
        encoding: "uint8",
        width: sourceDimensions.width,
        height: sourceDimensions.height,
        pixelCount: sourceDimensions.pixelCount,
        byteLength: sourceAlpha.byteLength,
        buffer: sourceAlpha.buffer,
      }),
    ]);
  return Object.freeze({
    planes,
    options: preflight.options,
    preflight: preflight.value,
  });
}

export function createStudioLayerLiftMaskWorkerRunMessage(
  request: StudioLayerLiftMaskWorkerRequest,
  requestId: number,
  epoch: number,
): StudioLayerLiftMaskWorkerRunMessage {
  if (!positiveSafeInteger(requestId) || !positiveSafeInteger(epoch)) {
    throw new StudioLayerLiftMaskWorkerProtocolError(
      "invalid-request",
      "Layer-lift Worker identity must use positive safe integers.",
    );
  }
  const message: StudioLayerLiftMaskWorkerRunMessage = {
    type: "studio-layer-lift-mask/run",
    version: STUDIO_LAYER_LIFT_MASK_WORKER_PROTOCOL_VERSION,
    requestId,
    epoch,
    request,
  };
  if (!isStudioLayerLiftMaskWorkerRunMessage(message)) {
    throw new StudioLayerLiftMaskWorkerProtocolError(
      "invalid-request",
      "Layer-lift Worker request failed canonical validation.",
    );
  }
  return Object.freeze(message);
}

function isRequestPlane(
  value: unknown,
  role: "confidence" | "source-alpha",
  encoding: "float32" | "uint8",
): value is StudioLayerLiftMaskWorkerPlane {
  const plane = dataRecord(
    value,
    [
      "role",
      "encoding",
      "width",
      "height",
      "pixelCount",
      "byteLength",
      "buffer",
    ],
  );
  if (!plane || plane.role !== role || plane.encoding !== encoding) return false;
  const admitted = dimensions(plane.width, plane.height);
  const bytesPerPixel = encoding === "float32" ? 4 : 1;
  return (
    admitted !== null
    && plane.pixelCount === admitted.pixelCount
    && plane.byteLength === admitted.pixelCount * bytesPerPixel
    && plane.buffer instanceof ArrayBuffer
    && Reflect.get(plane.buffer, "resizable") !== true
    && plane.buffer.byteLength === plane.byteLength
  );
}

function isPreflight(
  value: unknown,
): value is StudioLayerLiftMaskWorkerPreflight {
  const report = dataRecord(value, [
    "confidencePixelCount",
    "targetPixelCount",
    "inputByteLength",
    "outputByteLength",
    "morphologyPassCount",
    "morphologyMaximumNeighborsPerPixel",
    "morphologyMaximumNeighborVisits",
    "islandMaximumNeighborsPerPixel",
    "islandMaximumNeighborVisits",
    "aggregateMaximumNeighborVisits",
    "peakByteLength",
  ]);
  return (
    report !== null
    && Object.values(report).every(nonNegativeSafeInteger)
    && (report.morphologyMaximumNeighborsPerPixel === 0
      || report.morphologyMaximumNeighborsPerPixel === 5
      || report.morphologyMaximumNeighborsPerPixel === 9)
    && (report.islandMaximumNeighborsPerPixel === 0
      || report.islandMaximumNeighborsPerPixel === 4
      || report.islandMaximumNeighborsPerPixel === 8)
  );
}

function samePreflight(
  left: StudioLayerLiftMaskWorkerPreflight,
  right: StudioLayerLiftMaskWorkerPreflight,
): boolean {
  return (
    left.confidencePixelCount === right.confidencePixelCount
    && left.targetPixelCount === right.targetPixelCount
    && left.inputByteLength === right.inputByteLength
    && left.outputByteLength === right.outputByteLength
    && left.morphologyPassCount === right.morphologyPassCount
    && left.morphologyMaximumNeighborsPerPixel
      === right.morphologyMaximumNeighborsPerPixel
    && left.morphologyMaximumNeighborVisits
      === right.morphologyMaximumNeighborVisits
    && left.islandMaximumNeighborsPerPixel
      === right.islandMaximumNeighborsPerPixel
    && left.islandMaximumNeighborVisits === right.islandMaximumNeighborVisits
    && left.aggregateMaximumNeighborVisits
      === right.aggregateMaximumNeighborVisits
    && left.peakByteLength === right.peakByteLength
  );
}

export function isStudioLayerLiftMaskWorkerRunMessage(
  value: unknown,
): value is StudioLayerLiftMaskWorkerRunMessage {
  const message = dataRecord(
    value,
    ["type", "version", "requestId", "epoch", "request"],
  );
  const request = message
    ? dataRecord(message.request, ["planes", "options", "preflight"])
    : null;
  const planes = request ? exactDenseArray(request.planes, 2) : null;
  const options = request ? readCanonicalOptions(request.options) : null;
  const report = request?.preflight;
  if (
    !message
    || message.type !== "studio-layer-lift-mask/run"
    || message.version !== STUDIO_LAYER_LIFT_MASK_WORKER_PROTOCOL_VERSION
    || !positiveSafeInteger(message.requestId)
    || !positiveSafeInteger(message.epoch)
    || !request
    || !planes
    || !options
    || !isPreflight(report)
    || !isRequestPlane(planes[0], "confidence", "float32")
    || !isRequestPlane(planes[1], "source-alpha", "uint8")
    || planes[0].buffer === planes[1].buffer
  ) {
    return false;
  }
  const calculated = calculatePreflight(
    {
      width: planes[0].width,
      height: planes[0].height,
      pixelCount: planes[0].pixelCount,
    },
    {
      width: planes[1].width,
      height: planes[1].height,
      pixelCount: planes[1].pixelCount,
    },
    options,
  );
  return calculated.ok && samePreflight(report, calculated.value);
}

export function studioLayerLiftMaskWorkerRequestTransfers(
  message: StudioLayerLiftMaskWorkerRunMessage,
): Transferable[] {
  return [message.request.planes[0].buffer, message.request.planes[1].buffer];
}

function ownedResultBuffer(view: ArrayBufferView): ArrayBuffer {
  if (!fullOwnedBuffer(view)) {
    throw new StudioLayerLiftMaskWorkerProtocolError(
      "invalid-request",
      "Layer-lift core returned a non-owned output buffer.",
    );
  }
  return view.buffer;
}

export function createStudioLayerLiftMaskWorkerResultMessage(
  request: StudioLayerLiftMaskWorkerRunMessage,
  result: StudioLayerLiftPreparationResult,
): StudioLayerLiftMaskWorkerResultMessage {
  let wireResult: StudioLayerLiftMaskWorkerWireResult;
  if (result.ok) {
    const width = result.value.matte.width;
    const height = result.value.matte.height;
    const pixelCount = width * height;
    wireResult = {
      ok: true,
      empty: false,
      width,
      height,
      pixelCount,
      planes: [
        {
          role: "confidence",
          encoding: "float32",
          byteLength: result.value.confidence.confidence.byteLength,
          buffer: ownedResultBuffer(result.value.confidence.confidence),
        },
        {
          role: "matte",
          encoding: "float32",
          byteLength: result.value.matte.alpha.byteLength,
          buffer: ownedResultBuffer(result.value.matte.alpha),
        },
        {
          role: "binary",
          encoding: "uint8",
          byteLength: result.value.binary.pixels.byteLength,
          buffer: ownedResultBuffer(result.value.binary.pixels),
        },
        {
          role: "foreground-alpha",
          encoding: "uint8",
          byteLength: result.value.foregroundAlpha.alpha.byteLength,
          buffer: ownedResultBuffer(result.value.foregroundAlpha.alpha),
        },
      ],
      maskStatistics: result.value.maskStatistics,
      foregroundStatistics: result.value.foregroundStatistics,
      islandStatistics: result.value.islandStatistics,
    };
  } else if (result.empty) {
    const sourcePlane = request.request.planes[1];
    wireResult = {
      ok: false,
      empty: true,
      code: "empty-foreground",
      message: result.message,
      width: sourcePlane.width,
      height: sourcePlane.height,
      pixelCount: sourcePlane.pixelCount,
      maskStatistics: result.maskStatistics,
      foregroundStatistics: result.foregroundStatistics,
    };
  } else {
    wireResult = {
      ok: false,
      empty: false,
      code: result.code,
      message: result.message,
      sampleIndex: result.sampleIndex ?? null,
    };
  }
  const message: StudioLayerLiftMaskWorkerResultMessage = {
    type: "studio-layer-lift-mask/result",
    version: STUDIO_LAYER_LIFT_MASK_WORKER_PROTOCOL_VERSION,
    requestId: request.requestId,
    epoch: request.epoch,
    result: wireResult,
  };
  if (!isStudioLayerLiftMaskWorkerResponseMessage(message)) {
    throw new StudioLayerLiftMaskWorkerProtocolError(
      "invalid-request",
      "Layer-lift Worker result failed canonical validation.",
    );
  }
  return message;
}

export function createStudioLayerLiftMaskWorkerFailureMessage(
  requestId: number,
  epoch: number,
  code: StudioLayerLiftMaskWorkerTransportFailureCode,
): StudioLayerLiftMaskWorkerFailureMessage {
  return {
    type: "studio-layer-lift-mask/failure",
    version: STUDIO_LAYER_LIFT_MASK_WORKER_PROTOCOL_VERSION,
    requestId,
    epoch,
    code,
  };
}

function isBounds(
  value: unknown,
  width: number,
  height: number,
): boolean {
  if (value === null) return true;
  const bounds = dataRecord(
    value,
    ["left", "top", "right", "bottom", "width", "height"],
  );
  return (
    bounds !== null
    && nonNegativeSafeInteger(bounds.left)
    && nonNegativeSafeInteger(bounds.top)
    && positiveSafeInteger(bounds.right)
    && positiveSafeInteger(bounds.bottom)
    && positiveSafeInteger(bounds.width)
    && positiveSafeInteger(bounds.height)
    && bounds.right <= width
    && bounds.bottom <= height
    && bounds.width === bounds.right - bounds.left
    && bounds.height === bounds.bottom - bounds.top
  );
}

function isStatistics(
  value: unknown,
  width: number,
  height: number,
  pixelCount: number,
): value is StudioLayerLiftMaskStatistics {
  const statistics = dataRecord(value, [
    "pixelCount",
    "nonZeroPixelCount",
    "opaquePixelCount",
    "minimumAlpha",
    "maximumAlpha",
    "sumAlpha",
    "meanAlpha",
    "coverage",
    "bounds",
  ]);
  return (
    statistics !== null
    && statistics.pixelCount === pixelCount
    && nonNegativeSafeInteger(statistics.nonZeroPixelCount)
    && statistics.nonZeroPixelCount <= pixelCount
    && nonNegativeSafeInteger(statistics.opaquePixelCount)
    && statistics.opaquePixelCount <= statistics.nonZeroPixelCount
    && finiteInRange(statistics.minimumAlpha, 0, 1)
    && finiteInRange(statistics.maximumAlpha, 0, 1)
    && statistics.minimumAlpha <= statistics.maximumAlpha
    && finiteInRange(statistics.sumAlpha, 0, pixelCount)
    && finiteInRange(statistics.meanAlpha, 0, 1)
    && finiteInRange(statistics.coverage, 0, 1)
    && statistics.meanAlpha === statistics.sumAlpha / pixelCount
    && statistics.coverage === statistics.nonZeroPixelCount / pixelCount
    && isBounds(statistics.bounds, width, height)
    && (statistics.nonZeroPixelCount === 0) === (statistics.bounds === null)
  );
}

function isIslandStatistics(
  value: unknown,
  pixelCount: number,
): value is StudioLayerLiftIslandStatistics | null {
  if (value === null) return true;
  const statistics = dataRecord(value, [
    "componentCount",
    "keptComponentCount",
    "removedComponentCount",
    "removedPixelCount",
    "largestComponentPixels",
  ]);
  if (!statistics) return false;
  const componentCount = statistics.componentCount;
  const keptComponentCount = statistics.keptComponentCount;
  const removedComponentCount = statistics.removedComponentCount;
  const removedPixelCount = statistics.removedPixelCount;
  const largestComponentPixels = statistics.largestComponentPixels;
  return (
    nonNegativeSafeInteger(componentCount)
    && nonNegativeSafeInteger(keptComponentCount)
    && nonNegativeSafeInteger(removedComponentCount)
    && nonNegativeSafeInteger(removedPixelCount)
    && nonNegativeSafeInteger(largestComponentPixels)
    && keptComponentCount + removedComponentCount === componentCount
    && removedPixelCount <= pixelCount
    && largestComponentPixels <= pixelCount
  );
}

function isOutputPlane(
  value: unknown,
  role: StudioLayerLiftMaskWorkerOutputPlane["role"],
  encoding: StudioLayerLiftMaskWorkerOutputPlane["encoding"],
  expectedByteLength: number,
): value is StudioLayerLiftMaskWorkerOutputPlane {
  const plane = dataRecord(
    value,
    ["role", "encoding", "byteLength", "buffer"],
  );
  return (
    plane !== null
    && plane.role === role
    && plane.encoding === encoding
    && plane.byteLength === expectedByteLength
    && plane.buffer instanceof ArrayBuffer
    && Reflect.get(plane.buffer, "resizable") !== true
    && plane.buffer.byteLength === expectedByteLength
  );
}

function isWireResult(value: unknown): value is StudioLayerLiftMaskWorkerWireResult {
  const discriminator = dataRecord(value, ["ok", "empty"], [
    "width",
    "height",
    "pixelCount",
    "planes",
    "maskStatistics",
    "foregroundStatistics",
    "islandStatistics",
    "code",
    "message",
    "sampleIndex",
  ]);
  if (!discriminator) return false;
  if (discriminator.ok === true && discriminator.empty === false) {
    const success = dataRecord(value, [
      "ok",
      "empty",
      "width",
      "height",
      "pixelCount",
      "planes",
      "maskStatistics",
      "foregroundStatistics",
      "islandStatistics",
    ]);
    const admitted = success
      ? dimensions(success.width, success.height)
      : null;
    const planes = success ? exactDenseArray(success.planes, 4) : null;
    if (
      !success
      || !admitted
      || success.pixelCount !== admitted.pixelCount
      || !planes
      || !isOutputPlane(
        planes[0],
        "confidence",
        "float32",
        admitted.pixelCount * 4,
      )
      || !isOutputPlane(
        planes[1],
        "matte",
        "float32",
        admitted.pixelCount * 4,
      )
      || !isOutputPlane(planes[2], "binary", "uint8", admitted.pixelCount)
      || !isOutputPlane(
        planes[3],
        "foreground-alpha",
        "uint8",
        admitted.pixelCount,
      )
      || new Set([
        planes[0].buffer,
        planes[1].buffer,
        planes[2].buffer,
        planes[3].buffer,
      ]).size !== 4
      || !isStatistics(
        success.maskStatistics,
        admitted.width,
        admitted.height,
        admitted.pixelCount,
      )
      || !isStatistics(
        success.foregroundStatistics,
        admitted.width,
        admitted.height,
        admitted.pixelCount,
      )
      || !isIslandStatistics(success.islandStatistics, admitted.pixelCount)
    ) {
      return false;
    }
    return true;
  }
  if (discriminator.ok !== false) return false;
  if (discriminator.empty === true) {
    const empty = dataRecord(value, [
      "ok",
      "empty",
      "code",
      "message",
      "width",
      "height",
      "pixelCount",
      "maskStatistics",
      "foregroundStatistics",
    ]);
    const admitted = empty ? dimensions(empty.width, empty.height) : null;
    if (
      !empty
      || !admitted
      || empty.pixelCount !== admitted.pixelCount
      || empty.code !== "empty-foreground"
      || typeof empty.message !== "string"
      || empty.message.length < 1
      || empty.message.length > MAX_FAILURE_MESSAGE_CHARACTERS
    ) {
      return false;
    }
    return (
      isStatistics(
        empty.maskStatistics,
        admitted.width,
        admitted.height,
        admitted.pixelCount,
      )
      && isStatistics(
        empty.foregroundStatistics,
        admitted.width,
        admitted.height,
        admitted.pixelCount,
      )
    );
  }
  const failure = dataRecord(
    value,
    ["ok", "empty", "code", "message", "sampleIndex"],
  );
  return (
    failure !== null
    && MASK_FAILURE_CODES.has(failure.code as StudioLayerLiftMaskFailureCode)
    && failure.code !== "empty-foreground"
    && typeof failure.message === "string"
    && failure.message.length > 0
    && failure.message.length <= MAX_FAILURE_MESSAGE_CHARACTERS
    && (
      failure.sampleIndex === null
      || nonNegativeSafeInteger(failure.sampleIndex)
    )
  );
}

export function studioLayerLiftMaskWorkerResponseIdentity(
  value: unknown,
): Readonly<{ requestId: number; epoch: number }> | null {
  try {
    if (value === null || typeof value !== "object") return null;
    const requestId = Object.getOwnPropertyDescriptor(value, "requestId");
    const epoch = Object.getOwnPropertyDescriptor(value, "epoch");
    return (
      requestId
      && "value" in requestId
      && epoch
      && "value" in epoch
      && positiveSafeInteger(requestId.value)
      && positiveSafeInteger(epoch.value)
    )
      ? Object.freeze({ requestId: requestId.value, epoch: epoch.value })
      : null;
  } catch {
    return null;
  }
}

export function isStudioLayerLiftMaskWorkerResponseMessage(
  value: unknown,
): value is StudioLayerLiftMaskWorkerResponseMessage {
  const identity = studioLayerLiftMaskWorkerResponseIdentity(value);
  if (!identity) return false;
  const candidate = dataRecord(
    value,
    ["type", "version", "requestId", "epoch"],
    ["result", "code"],
  );
  if (
    !candidate
    || candidate.version !== STUDIO_LAYER_LIFT_MASK_WORKER_PROTOCOL_VERSION
  ) {
    return false;
  }
  if (candidate.type === "studio-layer-lift-mask/failure") {
    const failure = dataRecord(
      value,
      ["type", "version", "requestId", "epoch", "code"],
    );
    return (
      failure !== null
      && (
        failure.code === "protocol-error"
        || failure.code === "execution-failed"
      )
    );
  }
  const result = dataRecord(
    value,
    ["type", "version", "requestId", "epoch", "result"],
  );
  return (
    result !== null
    && result.type === "studio-layer-lift-mask/result"
    && isWireResult(result.result)
  );
}

export function studioLayerLiftMaskWorkerResponseTransfers(
  message: StudioLayerLiftMaskWorkerResponseMessage,
): Transferable[] {
  return message.type === "studio-layer-lift-mask/result" && message.result.ok
    ? message.result.planes.map((plane) => plane.buffer)
    : [];
}

function frozenStatistics(
  value: StudioLayerLiftMaskStatistics,
): StudioLayerLiftMaskStatistics {
  return Object.freeze({
    ...value,
    bounds: value.bounds === null ? null : Object.freeze({ ...value.bounds }),
  });
}

export function decodeStudioLayerLiftMaskWorkerResult(
  message: StudioLayerLiftMaskWorkerResultMessage,
): StudioLayerLiftPreparationResult {
  if (
    !isStudioLayerLiftMaskWorkerResponseMessage(message)
    || message.type !== "studio-layer-lift-mask/result"
  ) {
    throw new StudioLayerLiftMaskWorkerProtocolError(
      "invalid-request",
      "Layer-lift Worker result is malformed.",
    );
  }
  const result = message.result;
  if (result.ok) {
    return Object.freeze({
      ok: true,
      empty: false,
      value: Object.freeze({
        confidence: Object.freeze({
          width: result.width,
          height: result.height,
          confidence: new Float32Array(result.planes[0].buffer),
        }),
        matte: Object.freeze({
          width: result.width,
          height: result.height,
          alpha: new Float32Array(result.planes[1].buffer),
        }),
        binary: Object.freeze({
          width: result.width,
          height: result.height,
          pixels: new Uint8Array(result.planes[2].buffer),
        }),
        foregroundAlpha: Object.freeze({
          width: result.width,
          height: result.height,
          alpha: new Uint8ClampedArray(result.planes[3].buffer),
        }),
        maskStatistics: frozenStatistics(result.maskStatistics),
        foregroundStatistics: frozenStatistics(
          result.foregroundStatistics,
        ),
        islandStatistics: result.islandStatistics === null
          ? null
          : Object.freeze({ ...result.islandStatistics }),
      }),
    });
  }
  if (result.empty) {
    return Object.freeze({
      ok: false,
      empty: true,
      code: "empty-foreground",
      message: result.message,
      maskStatistics: frozenStatistics(result.maskStatistics),
      foregroundStatistics: frozenStatistics(result.foregroundStatistics),
    });
  }
  return Object.freeze(result.sampleIndex === null
    ? {
        ok: false,
        empty: false,
        code: result.code,
        message: result.message,
      }
    : {
        ok: false,
        empty: false,
        code: result.code,
        message: result.message,
        sampleIndex: result.sampleIndex,
      });
}
