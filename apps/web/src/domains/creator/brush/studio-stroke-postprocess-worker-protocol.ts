/**
 * Structured-clone-only boundary for release-time freehand post-correction.
 *
 * Points cross both directions as Float64Array buffers. The main realm snapshots the caller's
 * number[] before transferring, so detachment can never mutate the authoritative stroke array.
 */

export const STUDIO_STROKE_POSTPROCESS_WORKER_PROTOCOL_VERSION = 1 as const;

export const STUDIO_STROKE_POSTPROCESS_MAX_POINTS = 131_072;
export const STUDIO_STROKE_POSTPROCESS_MAX_COORDINATES =
  STUDIO_STROKE_POSTPROCESS_MAX_POINTS * 2;
export const STUDIO_STROKE_POSTPROCESS_MAX_COORDINATE_BYTES =
  STUDIO_STROKE_POSTPROCESS_MAX_COORDINATES * Float64Array.BYTES_PER_ELEMENT;
export const STUDIO_STROKE_POSTPROCESS_MAX_ABSOLUTE_COORDINATE = 10_000_000;

export type StudioStrokePostprocessWorkerFailureCode =
  | "budget-exceeded"
  | "execution-failed"
  | "invalid-request";

export interface StudioStrokePostprocessWorkerOptions {
  readonly preserveCorners: boolean;
  readonly cornerThresholdDeg: number;
}

export interface StudioStrokePostprocessWorkerRunMessage {
  readonly type: "studio-stroke-postprocess/run";
  readonly version: typeof STUDIO_STROKE_POSTPROCESS_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly generationId: number;
  readonly pointCount: number;
  readonly coordinateByteLength: number;
  readonly points: Float64Array;
  readonly strength: number;
  readonly options: StudioStrokePostprocessWorkerOptions;
}

export interface StudioStrokePostprocessWorkerSuccessMessage {
  readonly type: "studio-stroke-postprocess/success";
  readonly version: typeof STUDIO_STROKE_POSTPROCESS_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly generationId: number;
  readonly pointCount: number;
  readonly coordinateByteLength: number;
  readonly points: Float64Array;
}

export interface StudioStrokePostprocessWorkerFailureMessage {
  readonly type: "studio-stroke-postprocess/failure";
  readonly version: typeof STUDIO_STROKE_POSTPROCESS_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly generationId: number;
  readonly error: Readonly<{
    code: StudioStrokePostprocessWorkerFailureCode;
    name: string;
    message: string;
  }>;
}

export type StudioStrokePostprocessWorkerResponseMessage =
  | StudioStrokePostprocessWorkerSuccessMessage
  | StudioStrokePostprocessWorkerFailureMessage;

export interface StudioStrokePostprocessWorkerAuthority {
  readonly requestId: number;
  readonly generationId: number;
  readonly pointCount: number;
  readonly coordinateByteLength: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && actual.every((key) => expected.includes(key));
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isBoundedFiniteCoordinate(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= STUDIO_STROKE_POSTPROCESS_MAX_ABSOLUTE_COORDINATE;
}

function hasValidCoordinates(points: Float64Array): boolean {
  for (let index = 0; index < points.length; index += 1) {
    const coordinate = points[index];
    if (coordinate === undefined || !isBoundedFiniteCoordinate(coordinate)) return false;
  }
  return true;
}

function hasValidCorrelation(
  value: Record<string, unknown>,
): value is Record<string, unknown> & Readonly<{ requestId: number; generationId: number }> {
  return isPositiveSafeInteger(value.requestId) && isPositiveSafeInteger(value.generationId);
}

function hasValidPointPayload(
  value: Record<string, unknown>,
  points: Float64Array,
): boolean {
  if (!Number.isInteger(value.pointCount) || (value.pointCount as number) < 0) return false;
  const pointCount = value.pointCount as number;
  if (pointCount > STUDIO_STROKE_POSTPROCESS_MAX_POINTS) return false;
  if (points.length !== pointCount * 2 || points.length > STUDIO_STROKE_POSTPROCESS_MAX_COORDINATES) {
    return false;
  }
  if (
    !Number.isInteger(value.coordinateByteLength)
    || value.coordinateByteLength !== points.byteLength
    || points.byteLength > STUDIO_STROKE_POSTPROCESS_MAX_COORDINATE_BYTES
  ) {
    return false;
  }
  return hasValidCoordinates(points);
}

export function studioStrokePostprocessWorkerResponseIdentity(value: unknown): Readonly<{
  requestId: number;
  generationId: number;
}> | null {
  if (!isRecord(value) || !hasValidCorrelation(value)) return null;
  return {
    requestId: value.requestId,
    generationId: value.generationId,
  };
}

export function studioStrokePostprocessWorkerRequestFailureCode(
  value: unknown,
): StudioStrokePostprocessWorkerFailureCode | null {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "type",
      "version",
      "requestId",
      "generationId",
      "pointCount",
      "coordinateByteLength",
      "points",
      "strength",
      "options",
    ])
    || value.type !== "studio-stroke-postprocess/run"
    || value.version !== STUDIO_STROKE_POSTPROCESS_WORKER_PROTOCOL_VERSION
    || !hasValidCorrelation(value)
    || !(value.points instanceof Float64Array)
  ) {
    return "invalid-request";
  }

  const pointCount = value.pointCount;
  const coordinateByteLength = value.coordinateByteLength;
  if (
    typeof pointCount === "number"
    && Number.isInteger(pointCount)
    && pointCount > STUDIO_STROKE_POSTPROCESS_MAX_POINTS
  ) {
    return "budget-exceeded";
  }
  if (
    typeof coordinateByteLength === "number"
    && Number.isInteger(coordinateByteLength)
    && coordinateByteLength > STUDIO_STROKE_POSTPROCESS_MAX_COORDINATE_BYTES
  ) {
    return "budget-exceeded";
  }
  if (!hasValidPointPayload(value, value.points)) return "invalid-request";
  if (!Number.isInteger(value.strength) || (value.strength as number) < 0 || (value.strength as number) > 10) {
    return "invalid-request";
  }
  if (
    !isRecord(value.options)
    || !hasExactKeys(value.options, ["preserveCorners", "cornerThresholdDeg"])
    || typeof value.options.preserveCorners !== "boolean"
    || typeof value.options.cornerThresholdDeg !== "number"
    || !Number.isFinite(value.options.cornerThresholdDeg)
    || value.options.cornerThresholdDeg < 20
    || value.options.cornerThresholdDeg > 160
  ) {
    return "invalid-request";
  }
  return null;
}

export function isStudioStrokePostprocessWorkerRunMessage(
  value: unknown,
): value is StudioStrokePostprocessWorkerRunMessage {
  return studioStrokePostprocessWorkerRequestFailureCode(value) === null;
}

function isFailureMessage(value: Record<string, unknown>): value is Record<string, unknown> &
  StudioStrokePostprocessWorkerFailureMessage {
  if (
    !hasExactKeys(value, ["type", "version", "requestId", "generationId", "error"])
    || value.type !== "studio-stroke-postprocess/failure"
    || value.version !== STUDIO_STROKE_POSTPROCESS_WORKER_PROTOCOL_VERSION
    || !hasValidCorrelation(value)
    || !isRecord(value.error)
    || !hasExactKeys(value.error, ["code", "name", "message"])
  ) {
    return false;
  }
  const code = value.error.code;
  return (
    (code === "budget-exceeded" || code === "execution-failed" || code === "invalid-request")
    && typeof value.error.name === "string"
    && value.error.name.length > 0
    && value.error.name.length <= 128
    && typeof value.error.message === "string"
    && value.error.message.length > 0
    && value.error.message.length <= 2_048
  );
}

function isSuccessMessage(value: Record<string, unknown>): value is Record<string, unknown> &
  StudioStrokePostprocessWorkerSuccessMessage {
  return (
    hasExactKeys(value, [
      "type",
      "version",
      "requestId",
      "generationId",
      "pointCount",
      "coordinateByteLength",
      "points",
    ])
    && value.type === "studio-stroke-postprocess/success"
    && value.version === STUDIO_STROKE_POSTPROCESS_WORKER_PROTOCOL_VERSION
    && hasValidCorrelation(value)
    && value.points instanceof Float64Array
    && hasValidPointPayload(value, value.points)
  );
}

export function isStudioStrokePostprocessWorkerResponseForAuthority(
  value: unknown,
  authority: StudioStrokePostprocessWorkerAuthority,
): value is StudioStrokePostprocessWorkerResponseMessage {
  if (!isRecord(value) || !hasValidCorrelation(value)) return false;
  if (value.requestId !== authority.requestId || value.generationId !== authority.generationId) return false;
  if (isFailureMessage(value)) return true;
  return (
    isSuccessMessage(value)
    && value.pointCount === authority.pointCount
    && value.coordinateByteLength === authority.coordinateByteLength
  );
}

export function studioStrokePostprocessWorkerRequestTransfers(
  request: StudioStrokePostprocessWorkerRunMessage,
): Transferable[] {
  return [request.points.buffer];
}

export function studioStrokePostprocessWorkerSuccessTransfers(
  response: StudioStrokePostprocessWorkerSuccessMessage,
): Transferable[] {
  return [response.points.buffer];
}
