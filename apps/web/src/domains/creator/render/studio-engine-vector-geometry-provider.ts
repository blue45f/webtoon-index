/**
 * Lazy, renderer-neutral Paper.js geometry boundary.
 *
 * Paper.js is never used as the Studio scene or canvas authority here. A provider owns
 * one isolated PaperScope, creates one non-inserting Project for an admitted operation,
 * copies the result into frozen plain data, and removes the Project in `finally`.
 * No Paper item, project, scope, point, rectangle, or other vendor object crosses this
 * boundary.
 */

import type paper from "paper";

export const STUDIO_ENGINE_VECTOR_GEOMETRY_PROVIDER_VERSION = 1 as const;
export const STUDIO_ENGINE_VECTOR_GEOMETRY_FLATNESS = 0.25 as const;

export const STUDIO_ENGINE_VECTOR_GEOMETRY_LIMITS = Object.freeze({
  maxPathDataCodeUnits: 1_048_576,
  maxTotalPathDataCodeUnits: 2_097_152,
  maxInputCommandsPerPath: 32_768,
  maxInputNumbersPerPath: 262_144,
  maxInputCurvesPerPath: 32_768,
  maxOutputCurves: 65_536,
  maxOutputFlattenedPoints: 262_144,
  maxOutputPathDataCodeUnits: 2_097_152,
  maxBooleanCurvePairWorkUnits: 4_000_000,
  maxCoordinateAbsolute: 1_000_000,
  maxSimplifyTolerance: 10_000,
} as const);

export type StudioEngineVectorGeometryBooleanOperator =
  | "unite"
  | "subtract"
  | "intersect"
  | "exclude";

export type StudioEngineVectorGeometrySmoothingType =
  | "continuous"
  | "asymmetric"
  | "catmull-rom"
  | "geometric";

export interface StudioEngineVectorGeometryParseRequest {
  readonly operation: "parse";
  readonly pathData: string;
}

export interface StudioEngineVectorGeometrySmoothRequest {
  readonly operation: "smooth";
  readonly pathData: string;
  readonly smoothing?: Readonly<{
    readonly type?: StudioEngineVectorGeometrySmoothingType;
    readonly factor?: number;
  }>;
}

export interface StudioEngineVectorGeometrySimplifyRequest {
  readonly operation: "simplify";
  readonly pathData: string;
  readonly tolerance: number;
}

export interface StudioEngineVectorGeometryBooleanRequest {
  readonly operation: "boolean";
  readonly operator: StudioEngineVectorGeometryBooleanOperator;
  readonly leftPathData: string;
  readonly rightPathData: string;
}

export type StudioEngineVectorGeometryRequest =
  | StudioEngineVectorGeometryParseRequest
  | StudioEngineVectorGeometrySmoothRequest
  | StudioEngineVectorGeometrySimplifyRequest
  | StudioEngineVectorGeometryBooleanRequest;

export interface StudioEngineVectorGeometryBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioEngineVectorGeometryContour {
  /** Flattened document-space point pairs: [x0, y0, x1, y1, ...]. */
  readonly points: readonly number[];
  readonly closed: boolean;
}

export interface StudioEngineVectorGeometryArtifact {
  readonly kind: "studio-engine-vector-geometry";
  readonly version: typeof STUDIO_ENGINE_VECTOR_GEOMETRY_PROVIDER_VERSION;
  readonly operation:
    | "parse"
    | "smooth"
    | "simplify"
    | StudioEngineVectorGeometryBooleanOperator;
  readonly pathData: string;
  readonly bounds: StudioEngineVectorGeometryBounds;
  readonly empty: boolean;
  readonly curveCount: number;
  readonly subpathCount: number;
  /**
   * Frozen, vendor-neutral contours sampled from the canonical Paper path with the provider's
   * fixed flatness. These are suggestions only; no Paper object crosses this boundary.
   */
  readonly contours: readonly StudioEngineVectorGeometryContour[];
  readonly flattenedPointCount: number;
  readonly provider: Readonly<{
    readonly packageName: "paper";
    readonly packageVersion: string;
    readonly role: "ephemeral-vector-geometry";
    readonly sceneAuthority: false;
    readonly vendorObjectsReturned: false;
  }>;
}

export type StudioEngineVectorGeometryFailureReason =
  | "invalid-input"
  | "budget-exceeded"
  | "cancelled"
  | "disposed"
  | "provider-unavailable"
  | "provider-failure"
  | "invalid-provider-output";

export type StudioEngineVectorGeometryResult =
  | Readonly<{
      readonly ok: true;
      readonly artifact: StudioEngineVectorGeometryArtifact;
    }>
  | Readonly<{
      readonly ok: false;
      readonly reason: StudioEngineVectorGeometryFailureReason;
      readonly detail: string;
    }>;

export interface StudioEngineVectorGeometryExecution {
  readonly signal?: AbortSignal;
}

export interface StudioEngineVectorGeometryProviderLimits {
  readonly maxPathDataCodeUnits?: number;
  readonly maxTotalPathDataCodeUnits?: number;
  readonly maxInputCommandsPerPath?: number;
  readonly maxInputNumbersPerPath?: number;
  readonly maxInputCurvesPerPath?: number;
  readonly maxOutputCurves?: number;
  readonly maxOutputFlattenedPoints?: number;
  readonly maxOutputPathDataCodeUnits?: number;
  readonly maxBooleanCurvePairWorkUnits?: number;
  readonly maxCoordinateAbsolute?: number;
  readonly maxSimplifyTolerance?: number;
}

export interface StudioEngineVectorGeometryProviderOptions {
  readonly limits?: StudioEngineVectorGeometryProviderLimits;
}

export interface StudioEngineVectorGeometryProviderDiagnostics {
  readonly phase: "cold" | "ready" | "disposed";
  readonly paperLoaded: boolean;
  readonly activeProjectCount: number;
  readonly peakActiveProjectCount: number;
  readonly createdProjectCount: number;
  readonly removedProjectCount: number;
  readonly completedOperationCount: number;
  readonly rejectedOperationCount: number;
}

type PaperLibrary = typeof paper;
type PaperScope = InstanceType<PaperLibrary["PaperScope"]>;
type PaperProject = InstanceType<PaperLibrary["Project"]>;
type PaperPathItem = InstanceType<PaperLibrary["PathItem"]>;
type PaperPath = InstanceType<PaperLibrary["Path"]>;

interface ResolvedLimits {
  readonly maxPathDataCodeUnits: number;
  readonly maxTotalPathDataCodeUnits: number;
  readonly maxInputCommandsPerPath: number;
  readonly maxInputNumbersPerPath: number;
  readonly maxInputCurvesPerPath: number;
  readonly maxOutputCurves: number;
  readonly maxOutputFlattenedPoints: number;
  readonly maxOutputPathDataCodeUnits: number;
  readonly maxBooleanCurvePairWorkUnits: number;
  readonly maxCoordinateAbsolute: number;
  readonly maxSimplifyTolerance: number;
}

interface ParsedPathData {
  readonly pathData: string;
  readonly commandCount: number;
  readonly numberCount: number;
}

interface ParsedRequest {
  readonly operation:
    | "parse"
    | "smooth"
    | "simplify"
    | StudioEngineVectorGeometryBooleanOperator;
  readonly pathData: string;
  readonly rightPathData: string | null;
  readonly tolerance: number | null;
  readonly smoothing: Readonly<{
    readonly type: StudioEngineVectorGeometrySmoothingType;
    readonly factor: number | null;
  }> | null;
}

const PATH_COMMAND = /^[AaCcHhLlMmQqSsTtVvZz]$/;
const PATH_TOKEN =
  /[AaCcHhLlMmQqSsTtVvZz]|[-+]?(?:(?:\d+\.\d*)|(?:\.\d+)|(?:\d+))(?:[eE][-+]?\d+)?/g;
const PATH_SEPARATOR = /^[\s,]*$/;
const OUTPUT_DECIMAL_PLACES = 6;
const OUTPUT_SCALE = 10 ** OUTPUT_DECIMAL_PLACES;
// Paper's Path#flatten() creates a PathFlattener with maxRecursion=256. The
// implementation halves the parameter span until it reaches 1 / 256, so a
// single curve can otherwise allocate as many as 256 part records before the
// provider gets a chance to inspect the resulting segments.
const PAPER_FLATTEN_MAX_SUBDIVISION_DEPTH = 8;
const PAPER_NUMERICAL_EPSILON = 1e-12;
const PAPER_COLLINEAR_EPSILON = 1e-8;
const PAPER_STRAIGHT_DISTANCE_EPSILON = 1e-7;
const LIMIT_KEYS = [
  "maxPathDataCodeUnits",
  "maxTotalPathDataCodeUnits",
  "maxInputCommandsPerPath",
  "maxInputNumbersPerPath",
  "maxInputCurvesPerPath",
  "maxOutputCurves",
  "maxOutputFlattenedPoints",
  "maxOutputPathDataCodeUnits",
  "maxBooleanCurvePairWorkUnits",
  "maxCoordinateAbsolute",
  "maxSimplifyTolerance",
] as const;

let paperLibraryPromise: Promise<PaperLibrary> | null = null;
let paperCriticalSection: Promise<void> = Promise.resolve();

class StudioEngineVectorGeometryStop extends Error {
  constructor(
    readonly reason: StudioEngineVectorGeometryFailureReason,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "StudioEngineVectorGeometryStop";
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

function positiveIntegerLimit(
  candidate: number | undefined,
  fallback: number,
  name: string,
): number {
  const value = candidate ?? fallback;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function positiveFiniteLimit(
  candidate: number | undefined,
  fallback: number,
  name: string,
): number {
  const value = candidate ?? fallback;
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive finite number`);
  }
  return value;
}

function resolveLimits(
  candidate: StudioEngineVectorGeometryProviderLimits | undefined,
): ResolvedLimits {
  if (
    candidate !== undefined
    && (!isPlainRecord(candidate) || !hasExactKeys(candidate, [], LIMIT_KEYS))
  ) {
    throw new TypeError("Vector geometry limits must be a plain object");
  }
  const limits = (candidate ?? {}) as StudioEngineVectorGeometryProviderLimits;
  const resolved = {
    maxPathDataCodeUnits: positiveIntegerLimit(
      limits.maxPathDataCodeUnits,
      STUDIO_ENGINE_VECTOR_GEOMETRY_LIMITS.maxPathDataCodeUnits,
      "maxPathDataCodeUnits",
    ),
    maxTotalPathDataCodeUnits: positiveIntegerLimit(
      limits.maxTotalPathDataCodeUnits,
      STUDIO_ENGINE_VECTOR_GEOMETRY_LIMITS.maxTotalPathDataCodeUnits,
      "maxTotalPathDataCodeUnits",
    ),
    maxInputCommandsPerPath: positiveIntegerLimit(
      limits.maxInputCommandsPerPath,
      STUDIO_ENGINE_VECTOR_GEOMETRY_LIMITS.maxInputCommandsPerPath,
      "maxInputCommandsPerPath",
    ),
    maxInputNumbersPerPath: positiveIntegerLimit(
      limits.maxInputNumbersPerPath,
      STUDIO_ENGINE_VECTOR_GEOMETRY_LIMITS.maxInputNumbersPerPath,
      "maxInputNumbersPerPath",
    ),
    maxInputCurvesPerPath: positiveIntegerLimit(
      limits.maxInputCurvesPerPath,
      STUDIO_ENGINE_VECTOR_GEOMETRY_LIMITS.maxInputCurvesPerPath,
      "maxInputCurvesPerPath",
    ),
    maxOutputCurves: positiveIntegerLimit(
      limits.maxOutputCurves,
      STUDIO_ENGINE_VECTOR_GEOMETRY_LIMITS.maxOutputCurves,
      "maxOutputCurves",
    ),
    maxOutputFlattenedPoints: positiveIntegerLimit(
      limits.maxOutputFlattenedPoints,
      STUDIO_ENGINE_VECTOR_GEOMETRY_LIMITS.maxOutputFlattenedPoints,
      "maxOutputFlattenedPoints",
    ),
    maxOutputPathDataCodeUnits: positiveIntegerLimit(
      limits.maxOutputPathDataCodeUnits,
      STUDIO_ENGINE_VECTOR_GEOMETRY_LIMITS.maxOutputPathDataCodeUnits,
      "maxOutputPathDataCodeUnits",
    ),
    maxBooleanCurvePairWorkUnits: positiveIntegerLimit(
      limits.maxBooleanCurvePairWorkUnits,
      STUDIO_ENGINE_VECTOR_GEOMETRY_LIMITS.maxBooleanCurvePairWorkUnits,
      "maxBooleanCurvePairWorkUnits",
    ),
    maxCoordinateAbsolute: positiveFiniteLimit(
      limits.maxCoordinateAbsolute,
      STUDIO_ENGINE_VECTOR_GEOMETRY_LIMITS.maxCoordinateAbsolute,
      "maxCoordinateAbsolute",
    ),
    maxSimplifyTolerance: positiveFiniteLimit(
      limits.maxSimplifyTolerance,
      STUDIO_ENGINE_VECTOR_GEOMETRY_LIMITS.maxSimplifyTolerance,
      "maxSimplifyTolerance",
    ),
  } satisfies ResolvedLimits;
  if (resolved.maxTotalPathDataCodeUnits < resolved.maxPathDataCodeUnits) {
    throw new TypeError("maxTotalPathDataCodeUnits cannot be smaller than maxPathDataCodeUnits");
  }
  return Object.freeze(resolved);
}

function fail(
  reason: StudioEngineVectorGeometryFailureReason,
  detail: string,
): StudioEngineVectorGeometryResult {
  return Object.freeze({ ok: false, reason, detail });
}

function stop(
  reason: StudioEngineVectorGeometryFailureReason,
  detail: string,
): never {
  throw new StudioEngineVectorGeometryStop(reason, detail);
}

function assertNotCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) stop("cancelled", "Vector geometry execution was cancelled");
}

function hasUnsupportedPathControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127) {
      return true;
    }
  }
  return false;
}

function scanPathData(
  value: unknown,
  limits: ResolvedLimits,
  fieldName: string,
): ParsedPathData {
  if (typeof value !== "string") {
    stop("invalid-input", `${fieldName} must be an SVG path-data string`);
  }
  const pathData = value.trim();
  if (pathData.length === 0 || hasUnsupportedPathControlCharacter(pathData)) {
    stop("invalid-input", `${fieldName} is empty or contains control characters`);
  }
  if (pathData.length > limits.maxPathDataCodeUnits) {
    stop("budget-exceeded", `${fieldName} exceeds the path-data code-unit budget`);
  }

  PATH_TOKEN.lastIndex = 0;
  let cursor = 0;
  let commandCount = 0;
  let numberCount = 0;
  let firstCommand: string | null = null;
  for (let match = PATH_TOKEN.exec(pathData); match; match = PATH_TOKEN.exec(pathData)) {
    if (!PATH_SEPARATOR.test(pathData.slice(cursor, match.index))) {
      stop("invalid-input", `${fieldName} contains unsupported SVG path syntax`);
    }
    const token = match[0];
    if (PATH_COMMAND.test(token)) {
      firstCommand ??= token;
      commandCount += 1;
      if (commandCount > limits.maxInputCommandsPerPath) {
        stop("budget-exceeded", `${fieldName} exceeds the command budget`);
      }
    } else {
      const number = Number(token);
      if (!Number.isFinite(number) || Math.abs(number) > limits.maxCoordinateAbsolute) {
        stop("invalid-input", `${fieldName} contains an invalid or out-of-range number`);
      }
      numberCount += 1;
      if (numberCount > limits.maxInputNumbersPerPath) {
        stop("budget-exceeded", `${fieldName} exceeds the numeric-token budget`);
      }
    }
    cursor = PATH_TOKEN.lastIndex;
  }
  if (
    !PATH_SEPARATOR.test(pathData.slice(cursor))
    || commandCount === 0
    || numberCount === 0
    || (firstCommand !== "M" && firstCommand !== "m")
  ) {
    stop("invalid-input", `${fieldName} is not admitted SVG path data`);
  }
  return Object.freeze({ pathData, commandCount, numberCount });
}

function parseSmoothing(
  value: unknown,
): ParsedRequest["smoothing"] {
  if (value === undefined) {
    return Object.freeze({ type: "continuous", factor: null });
  }
  if (!isPlainRecord(value) || !hasExactKeys(value, [], ["type", "factor"])) {
    stop("invalid-input", "smoothing must be a plain object with known fields");
  }
  const type = value.type ?? "continuous";
  if (
    type !== "continuous"
    && type !== "asymmetric"
    && type !== "catmull-rom"
    && type !== "geometric"
  ) {
    stop("invalid-input", "smoothing.type is unsupported");
  }
  const factor = value.factor;
  if (
    factor !== undefined
    && (typeof factor !== "number" || !Number.isFinite(factor) || factor < 0 || factor > 1)
  ) {
    stop("invalid-input", "smoothing.factor must be a finite number from zero to one");
  }
  return Object.freeze({ type, factor: factor ?? null });
}

function parseRequest(value: unknown, limits: ResolvedLimits): ParsedRequest {
  if (!isPlainRecord(value) || typeof value.operation !== "string") {
    stop("invalid-input", "Vector geometry request must be a plain object");
  }

  if (value.operation === "parse") {
    if (!hasExactKeys(value, ["operation", "pathData"])) {
      stop("invalid-input", "Parse request contains missing or unknown fields");
    }
    const path = scanPathData(value.pathData, limits, "pathData");
    return Object.freeze({
      operation: "parse",
      pathData: path.pathData,
      rightPathData: null,
      tolerance: null,
      smoothing: null,
    });
  }

  if (value.operation === "smooth") {
    if (!hasExactKeys(value, ["operation", "pathData"], ["smoothing"])) {
      stop("invalid-input", "Smooth request contains missing or unknown fields");
    }
    const path = scanPathData(value.pathData, limits, "pathData");
    return Object.freeze({
      operation: "smooth",
      pathData: path.pathData,
      rightPathData: null,
      tolerance: null,
      smoothing: parseSmoothing(value.smoothing),
    });
  }

  if (value.operation === "simplify") {
    if (!hasExactKeys(value, ["operation", "pathData", "tolerance"])) {
      stop("invalid-input", "Simplify request contains missing or unknown fields");
    }
    if (
      typeof value.tolerance !== "number"
      || !Number.isFinite(value.tolerance)
      || value.tolerance <= 0
      || value.tolerance > limits.maxSimplifyTolerance
    ) {
      stop("invalid-input", "tolerance is outside the admitted finite range");
    }
    const path = scanPathData(value.pathData, limits, "pathData");
    return Object.freeze({
      operation: "simplify",
      pathData: path.pathData,
      rightPathData: null,
      tolerance: value.tolerance,
      smoothing: null,
    });
  }

  if (value.operation === "boolean") {
    if (
      !hasExactKeys(
        value,
        ["operation", "operator", "leftPathData", "rightPathData"],
      )
    ) {
      stop("invalid-input", "Boolean request contains missing or unknown fields");
    }
    if (
      value.operator !== "unite"
      && value.operator !== "subtract"
      && value.operator !== "intersect"
      && value.operator !== "exclude"
    ) {
      stop("invalid-input", "Boolean operator is unsupported");
    }
    const left = scanPathData(value.leftPathData, limits, "leftPathData");
    const right = scanPathData(value.rightPathData, limits, "rightPathData");
    if (left.pathData.length + right.pathData.length > limits.maxTotalPathDataCodeUnits) {
      stop("budget-exceeded", "Boolean inputs exceed the aggregate path-data budget");
    }
    return Object.freeze({
      operation: value.operator,
      pathData: left.pathData,
      rightPathData: right.pathData,
      tolerance: null,
      smoothing: null,
    });
  }

  stop("invalid-input", "Vector geometry operation is unsupported");
}

async function loadPaperLibrary(): Promise<PaperLibrary> {
  paperLibraryPromise ??= import("paper").then((moduleNamespace: unknown) => {
    const candidate = isPlainRecord(moduleNamespace) && "default" in moduleNamespace
      ? moduleNamespace.default
      : moduleNamespace;
    if (
      typeof candidate !== "object"
      || candidate === null
      || !("PaperScope" in candidate)
      || typeof candidate.PaperScope !== "function"
    ) {
      throw new Error("Paper.js module did not expose PaperScope");
    }
    return candidate as PaperLibrary;
  });
  return paperLibraryPromise;
}

function serializePaperWork<T>(work: () => Promise<T>): Promise<T> {
  const result = paperCriticalSection.then(work, work);
  paperCriticalSection = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function roundOutputNumber(value: number): number {
  if (!Number.isFinite(value)) {
    stop("invalid-provider-output", "Paper.js returned a non-finite number");
  }
  const rounded = Math.round(value * OUTPUT_SCALE) / OUTPUT_SCALE;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function formatOutputNumber(value: number): string {
  const rounded = roundOutputNumber(value);
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(OUTPUT_DECIMAL_PLACES).replace(/(?:\.0+|(\.\d+?)0+)$/, "$1");
}

function canonicalizePaperPathData(pathData: string, limits: ResolvedLimits): string {
  if (
    typeof pathData !== "string"
    || pathData.length === 0
    || pathData.length > limits.maxOutputPathDataCodeUnits * 2
  ) {
    stop("invalid-provider-output", "Paper.js returned missing or oversized path data");
  }
  PATH_TOKEN.lastIndex = 0;
  const tokens: string[] = [];
  let cursor = 0;
  for (let match = PATH_TOKEN.exec(pathData); match; match = PATH_TOKEN.exec(pathData)) {
    if (!PATH_SEPARATOR.test(pathData.slice(cursor, match.index))) {
      stop("invalid-provider-output", "Paper.js returned malformed path data");
    }
    const token = match[0];
    tokens.push(PATH_COMMAND.test(token) ? token : formatOutputNumber(Number(token)));
    cursor = PATH_TOKEN.lastIndex;
  }
  if (!PATH_SEPARATOR.test(pathData.slice(cursor)) || tokens.length === 0) {
    stop("invalid-provider-output", "Paper.js returned malformed path data");
  }
  const canonical = tokens.join(" ");
  if (canonical.length > limits.maxOutputPathDataCodeUnits) {
    stop("budget-exceeded", "Canonical path data exceeds the output budget");
  }
  return canonical;
}

function emptyBounds(): StudioEngineVectorGeometryBounds {
  return Object.freeze({
    minX: 0,
    minY: 0,
    maxX: 0,
    maxY: 0,
    width: 0,
    height: 0,
  });
}

function paperCurveCount(scope: PaperScope, path: PaperPathItem): number {
  let count = -1;
  if (path instanceof scope.CompoundPath) {
    count = 0;
    for (const child of path.children) {
      if (!(child instanceof scope.Path)) {
        stop("invalid-provider-output", "Paper.js returned an invalid compound-path child");
      }
      count += child.curves.length;
    }
  } else if (path instanceof scope.Path) {
    count = path.curves.length;
  }
  if (!Number.isSafeInteger(count) || count < 0) {
    stop("invalid-provider-output", "Paper.js returned an invalid curve count");
  }
  return count;
}

function paperSubpathCount(
  scope: PaperScope,
  path: PaperPathItem,
): number {
  if (path instanceof scope.CompoundPath) {
    return path.children.length;
  }
  return 1;
}

function paperContourPaths(
  scope: PaperScope,
  path: PaperPathItem,
): readonly PaperPath[] {
  if (path instanceof scope.CompoundPath) {
    const children: PaperPath[] = [];
    for (const child of path.children) {
      if (!(child instanceof scope.Path)) {
        stop("invalid-provider-output", "Paper.js returned an invalid compound-path child");
      }
      children.push(child);
    }
    return children;
  }
  if (!(path instanceof scope.Path)) {
    stop("invalid-provider-output", "Paper.js returned an unsupported path item");
  }
  return [path];
}

interface PaperFlatteningPreflightState {
  readonly maxFlattenedPointCount: number;
  readonly maxWorkUnits: number;
  flattenedPointCount: number;
  workUnits: number;
}

function isPaperZero(value: number): boolean {
  return value >= -PAPER_NUMERICAL_EPSILON && value <= PAPER_NUMERICAL_EPSILON;
}

function arePaperVectorsCollinear(
  leftX: number,
  leftY: number,
  rightX: number,
  rightY: number,
): boolean {
  const cross = Math.abs(leftX * rightY - leftY * rightX);
  const magnitudeProduct = Math.sqrt(
    (leftX * leftX + leftY * leftY) * (rightX * rightX + rightY * rightY),
  );
  return cross <= magnitudeProduct * PAPER_COLLINEAR_EPSILON;
}

/**
 * Mirrors the numeric predicates used by Paper's Curve.isStraight(values).
 * Keeping this local avoids constructing Paper Curve/Point/Line objects during
 * preflight while still allowing ordinary line-heavy documents through.
 */
function arePaperCurveValuesStraight(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
): boolean {
  const handle1X = x1 - x0;
  const handle1Y = y1 - y0;
  const handle2X = x2 - x3;
  const handle2Y = y2 - y3;
  if (
    isPaperZero(handle1X)
    && isPaperZero(handle1Y)
    && isPaperZero(handle2X)
    && isPaperZero(handle2Y)
  ) {
    return true;
  }

  const chordX = x3 - x0;
  const chordY = y3 - y0;
  const chordSquared = chordX * chordX + chordY * chordY;
  if (
    isPaperZero(chordX)
    && isPaperZero(chordY)
  ) {
    return false;
  }
  if (
    !arePaperVectorsCollinear(chordX, chordY, handle1X, handle1Y)
    || !arePaperVectorsCollinear(chordX, chordY, handle2X, handle2Y)
  ) {
    return false;
  }

  const chordLength = Math.sqrt(chordSquared);
  const control1Distance = Math.abs(
    chordX * (y1 - y0) - chordY * (x1 - x0),
  ) / chordLength;
  const control2Distance = Math.abs(
    chordX * (y2 - y0) - chordY * (x2 - x0),
  ) / chordLength;
  if (
    control1Distance >= PAPER_STRAIGHT_DISTANCE_EPSILON
    || control2Distance >= PAPER_STRAIGHT_DISTANCE_EPSILON
  ) {
    return false;
  }

  const handle1Projection = (
    chordX * handle1X + chordY * handle1Y
  ) / chordSquared;
  const handle2Projection = (
    chordX * handle2X + chordY * handle2Y
  ) / chordSquared;
  return handle1Projection >= 0
    && handle1Projection <= 1
    && handle2Projection <= 0
    && handle2Projection >= -1;
}

function arePaperCurveValuesFlatEnough(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
): boolean {
  const firstX = 3 * x1 - 2 * x0 - x3;
  const firstY = 3 * y1 - 2 * y0 - y3;
  const secondX = 3 * x2 - 2 * x3 - x0;
  const secondY = 3 * y2 - 2 * y3 - y0;
  return (
    Math.max(firstX * firstX, secondX * secondX)
    + Math.max(firstY * firstY, secondY * secondY)
  ) <= 16 * STUDIO_ENGINE_VECTOR_GEOMETRY_FLATNESS ** 2;
}

function preflightPaperCurveFlattening(
  state: PaperFlatteningPreflightState,
  closed: boolean,
  contourPartCount: { value: number },
  depth: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
): void {
  state.workUnits += 1;
  if (state.workUnits > state.maxWorkUnits) {
    stop("budget-exceeded", "Geometry flattening exceeds the preflight work budget");
  }

  if (
    depth < PAPER_FLATTEN_MAX_SUBDIVISION_DEPTH
    && !arePaperCurveValuesStraight(x0, y0, x1, y1, x2, y2, x3, y3)
    && !arePaperCurveValuesFlatEnough(x0, y0, x1, y1, x2, y2, x3, y3)
  ) {
    const x4 = (x0 + x1) / 2;
    const y4 = (y0 + y1) / 2;
    const x5 = (x1 + x2) / 2;
    const y5 = (y1 + y2) / 2;
    const x6 = (x2 + x3) / 2;
    const y6 = (y2 + y3) / 2;
    const x7 = (x4 + x5) / 2;
    const y7 = (y4 + y5) / 2;
    const x8 = (x5 + x6) / 2;
    const y8 = (y5 + y6) / 2;
    const x9 = (x7 + x8) / 2;
    const y9 = (y7 + y8) / 2;
    preflightPaperCurveFlattening(
      state,
      closed,
      contourPartCount,
      depth + 1,
      x0,
      y0,
      x4,
      y4,
      x7,
      y7,
      x9,
      y9,
    );
    preflightPaperCurveFlattening(
      state,
      closed,
      contourPartCount,
      depth + 1,
      x9,
      y9,
      x8,
      y8,
      x6,
      y6,
      x3,
      y3,
    );
    return;
  }

  const chordX = x3 - x0;
  const chordY = y3 - y0;
  // PathFlattener omits zero-distance terminal parts.
  if (Math.sqrt(chordX * chordX + chordY * chordY) <= 0) return;

  state.flattenedPointCount += contourPartCount.value === 0 && !closed ? 2 : 1;
  contourPartCount.value += 1;
  if (state.flattenedPointCount > state.maxFlattenedPointCount) {
    stop("budget-exceeded", "Geometry result exceeds the flattened-point budget");
  }
}

function assertPaperFlatteningBudget(
  contourPaths: readonly PaperPath[],
  limits: ResolvedLimits,
): void {
  let curveCount = 0;
  for (const contourPath of contourPaths) {
    curveCount += contourPath.curves.length;
  }
  // A fully subdivided binary curve visits roughly twice as many recursion
  // nodes as it emits parts. Curve-count headroom preserves large straight
  // paths, while the point-related headroom bounds pathological recursion
  // before Paper allocates PathFlattener part objects and replacement Segments.
  const maxWorkUnits = Math.min(
    Number.MAX_SAFE_INTEGER,
    curveCount * 4 + limits.maxOutputFlattenedPoints * 4,
  );
  const state: PaperFlatteningPreflightState = {
    maxFlattenedPointCount: limits.maxOutputFlattenedPoints,
    maxWorkUnits,
    flattenedPointCount: 0,
    workUnits: 0,
  };

  for (const contourPath of contourPaths) {
    const contourPartCount = { value: 0 };
    for (const curve of contourPath.curves) {
      const values = curve.values;
      if (
        values.length !== 8
        || values.some((value) => !Number.isFinite(value))
      ) {
        stop("invalid-provider-output", "Paper.js returned invalid curve values");
      }
      preflightPaperCurveFlattening(
        state,
        contourPath.closed,
        contourPartCount,
        0,
        values[0]!,
        values[1]!,
        values[2]!,
        values[3]!,
        values[4]!,
        values[5]!,
        values[6]!,
        values[7]!,
      );
    }
  }
}

function flattenPaperContours(
  scope: PaperScope,
  path: PaperPathItem,
  limits: ResolvedLimits,
): Readonly<{
  contours: readonly StudioEngineVectorGeometryContour[];
  flattenedPointCount: number;
}> {
  const contourPaths = paperContourPaths(scope, path);
  // Path#flatten() eagerly allocates all recursive parts before it mutates the
  // path. Simulate its bounded subdivision first so oversized output is rejected
  // before any of those allocations or mutations occur.
  assertPaperFlatteningBudget(contourPaths, limits);

  const contours: StudioEngineVectorGeometryContour[] = [];
  let flattenedPointCount = 0;
  for (const contourPath of contourPaths) {
    contourPath.flatten(STUDIO_ENGINE_VECTOR_GEOMETRY_FLATNESS);
    const points: number[] = [];
    for (const segment of contourPath.segments) {
      flattenedPointCount += 1;
      if (flattenedPointCount > limits.maxOutputFlattenedPoints) {
        stop("budget-exceeded", "Geometry result exceeds the flattened-point budget");
      }
      const x = roundOutputNumber(segment.point.x);
      const y = roundOutputNumber(segment.point.y);
      if (
        Math.abs(x) > limits.maxCoordinateAbsolute
        || Math.abs(y) > limits.maxCoordinateAbsolute
      ) {
        stop("invalid-provider-output", "Paper.js returned an out-of-range flattened point");
      }
      points.push(x, y);
    }
    if (points.length === 0) {
      stop("invalid-provider-output", "Paper.js returned an empty non-empty contour");
    }
    contours.push(Object.freeze({
      points: Object.freeze(points),
      closed: contourPath.closed,
    }));
  }
  return Object.freeze({
    contours: Object.freeze(contours),
    flattenedPointCount,
  });
}

function extractBounds(path: PaperPathItem): StudioEngineVectorGeometryBounds {
  const rectangle = path.bounds;
  const minX = roundOutputNumber(rectangle.x);
  const minY = roundOutputNumber(rectangle.y);
  const maxX = roundOutputNumber(rectangle.x + rectangle.width);
  const maxY = roundOutputNumber(rectangle.y + rectangle.height);
  if (maxX < minX || maxY < minY) {
    stop("invalid-provider-output", "Paper.js returned inverted geometry bounds");
  }
  return Object.freeze({
    minX,
    minY,
    maxX,
    maxY,
    width: roundOutputNumber(maxX - minX),
    height: roundOutputNumber(maxY - minY),
  });
}

function createPaperProject(scope: PaperScope): PaperProject {
  // Paper's generated declarations require a view argument, but its runtime intentionally
  // supports an omitted argument and creates a detached zero-size View in non-DOM runtimes
  // (or an off-DOM 1×1 canvas in browsers). It is removed before this operation resolves.
  const ProjectWithoutView = scope.Project as unknown as new () => PaperProject;
  const existingProjects = new Set(scope.projects);
  try {
    return new ProjectWithoutView();
  } catch (error) {
    for (const project of [...scope.projects]) {
      if (!existingProjects.has(project)) {
        try {
          removeProject(project);
        } catch {
          // Preserve the constructor failure. The scope itself is discarded on dispose.
        }
      }
    }
    throw error;
  }
}

function removeProject(project: PaperProject): void {
  try {
    project.clear();
  } finally {
    project.remove();
  }
}

function applyOperation(
  scope: PaperScope,
  request: ParsedRequest,
  limits: ResolvedLimits,
  signal: AbortSignal | undefined,
): StudioEngineVectorGeometryArtifact {
  let left: PaperPathItem | null = null;
  let right: PaperPathItem | null = null;
  let result: PaperPathItem | null = null;
  try {
    try {
      left = scope.PathItem.create(request.pathData);
      if (request.rightPathData !== null) {
        right = scope.PathItem.create(request.rightPathData);
      }
    } catch {
      stop("invalid-input", "Paper.js could not parse the admitted SVG path data");
    }
    assertNotCancelled(signal);

    const leftCurveCount = paperCurveCount(scope, left);
    if (leftCurveCount > limits.maxInputCurvesPerPath) {
      stop("budget-exceeded", "Left path exceeds the parsed-curve budget");
    }
    if (right !== null) {
      const rightCurveCount = paperCurveCount(scope, right);
      if (rightCurveCount > limits.maxInputCurvesPerPath) {
        stop("budget-exceeded", "Right path exceeds the parsed-curve budget");
      }
      const booleanWorkUnits = Math.max(1, leftCurveCount) * Math.max(1, rightCurveCount);
      if (booleanWorkUnits > limits.maxBooleanCurvePairWorkUnits) {
        stop("budget-exceeded", "Boolean geometry exceeds the curve-pair work budget");
      }
    }

    try {
      if (request.operation === "smooth") {
        const smoothing = request.smoothing;
        if (smoothing === null) {
          stop("invalid-input", "Smooth request is missing smoothing configuration");
        }
        const options: { type: StudioEngineVectorGeometrySmoothingType; factor?: number } = {
          type: smoothing.type,
        };
        if (smoothing.factor !== null) options.factor = smoothing.factor;
        left.smooth(options);
        result = left;
      } else if (request.operation === "simplify") {
        if (request.tolerance === null) {
          stop("invalid-input", "Simplify request is missing a tolerance");
        }
        left.simplify(request.tolerance);
        result = left;
      } else if (request.operation === "unite") {
        result = left.unite(right!, { insert: false });
      } else if (request.operation === "subtract") {
        result = left.subtract(right!, { insert: false, trace: true });
      } else if (request.operation === "intersect") {
        result = left.intersect(right!, { insert: false, trace: true });
      } else if (request.operation === "exclude") {
        result = left.exclude(right!, { insert: false });
      } else {
        result = left;
      }
    } catch (error) {
      if (error instanceof StudioEngineVectorGeometryStop) throw error;
      stop("provider-failure", "Paper.js geometry execution failed");
    }
    assertNotCancelled(signal);

    const providerReceipt = Object.freeze({
      packageName: "paper",
      packageVersion: scope.version,
      role: "ephemeral-vector-geometry",
      sceneAuthority: false,
      vendorObjectsReturned: false,
    } as const);
    if (result.pathData.trim().length === 0) {
      if (
        request.operation !== "subtract"
        && request.operation !== "intersect"
        && request.operation !== "exclude"
      ) {
        stop("invalid-provider-output", "Paper.js unexpectedly returned empty geometry");
      }
      return Object.freeze({
        kind: "studio-engine-vector-geometry",
        version: STUDIO_ENGINE_VECTOR_GEOMETRY_PROVIDER_VERSION,
        operation: request.operation,
        pathData: "",
        bounds: emptyBounds(),
        empty: true,
        curveCount: 0,
        subpathCount: 0,
        contours: Object.freeze([]),
        flattenedPointCount: 0,
        provider: providerReceipt,
      });
    }

    const canonicalPathData = canonicalizePaperPathData(result.pathData, limits);
    let canonicalPath: PaperPathItem;
    try {
      canonicalPath = scope.PathItem.create(canonicalPathData);
    } catch {
      stop("invalid-provider-output", "Canonical Paper.js path data could not be replayed");
    }
    try {
      const curveCount = paperCurveCount(scope, canonicalPath);
      if (curveCount > limits.maxOutputCurves) {
        stop("budget-exceeded", "Geometry result exceeds the output-curve budget");
      }
      const bounds = extractBounds(canonicalPath);
      const subpathCount = paperSubpathCount(scope, canonicalPath);
      const flattened = flattenPaperContours(scope, canonicalPath, limits);
      const artifact = {
        kind: "studio-engine-vector-geometry",
        version: STUDIO_ENGINE_VECTOR_GEOMETRY_PROVIDER_VERSION,
        operation: request.operation,
        pathData: canonicalPathData,
        bounds,
        empty: false,
        curveCount,
        subpathCount,
        contours: flattened.contours,
        flattenedPointCount: flattened.flattenedPointCount,
        provider: providerReceipt,
      } as const satisfies StudioEngineVectorGeometryArtifact;
      return Object.freeze(artifact);
    } finally {
      canonicalPath.remove();
    }
  } finally {
    if (result !== null && result !== left && result !== right) result.remove();
    right?.remove();
    left?.remove();
  }
}

export class StudioEngineVectorGeometryProvider {
  private readonly limits: ResolvedLimits;
  private scope: PaperScope | null = null;
  private disposed = false;
  private activeProjectCount = 0;
  private peakActiveProjectCount = 0;
  private createdProjectCount = 0;
  private removedProjectCount = 0;
  private completedOperationCount = 0;
  private rejectedOperationCount = 0;

  constructor(options: StudioEngineVectorGeometryProviderOptions = {}) {
    if (!isPlainRecord(options) || !hasExactKeys(options, [], ["limits"])) {
      throw new TypeError("Vector geometry provider options contain unknown fields");
    }
    this.limits = resolveLimits(
      (options as StudioEngineVectorGeometryProviderOptions).limits,
    );
  }

  public execute(
    candidate: unknown,
    execution: StudioEngineVectorGeometryExecution = {},
  ): Promise<StudioEngineVectorGeometryResult> {
    if (this.disposed) {
      this.rejectedOperationCount += 1;
      return Promise.resolve(fail("disposed", "Vector geometry provider is disposed"));
    }
    if (
      !isPlainRecord(execution)
      || !hasExactKeys(execution, [], ["signal"])
      || (
        execution.signal !== undefined
        && !(execution.signal instanceof AbortSignal)
      )
    ) {
      this.rejectedOperationCount += 1;
      return Promise.resolve(fail("invalid-input", "Execution options are invalid"));
    }
    const signal = (execution as StudioEngineVectorGeometryExecution).signal;

    let request: ParsedRequest;
    try {
      request = parseRequest(candidate, this.limits);
      assertNotCancelled(signal);
    } catch (error) {
      this.rejectedOperationCount += 1;
      if (error instanceof StudioEngineVectorGeometryStop) {
        return Promise.resolve(fail(error.reason, error.detail));
      }
      return Promise.resolve(fail("invalid-input", "Vector geometry request is invalid"));
    }

    return serializePaperWork(async () => {
      if (this.disposed) {
        this.rejectedOperationCount += 1;
        return fail("disposed", "Vector geometry provider is disposed");
      }
      try {
        assertNotCancelled(signal);
        let library: PaperLibrary;
        try {
          library = await loadPaperLibrary();
        } catch {
          stop("provider-unavailable", "Paper.js could not be loaded");
        }
        assertNotCancelled(signal);
        if (this.disposed) {
          stop("disposed", "Vector geometry provider was disposed while loading Paper.js");
        }
        this.scope ??= new library.PaperScope();
        this.scope.activate();
        this.scope.settings.insertItems = false;

        const project = createPaperProject(this.scope);
        this.activeProjectCount += 1;
        this.createdProjectCount += 1;
        this.peakActiveProjectCount = Math.max(
          this.peakActiveProjectCount,
          this.activeProjectCount,
        );
        try {
          const artifact = applyOperation(
            this.scope,
            request,
            this.limits,
            signal,
          );
          this.completedOperationCount += 1;
          return Object.freeze({ ok: true, artifact });
        } finally {
          try {
            removeProject(project);
          } finally {
            this.activeProjectCount -= 1;
            this.removedProjectCount += 1;
          }
        }
      } catch (error) {
        this.rejectedOperationCount += 1;
        if (error instanceof StudioEngineVectorGeometryStop) {
          return fail(error.reason, error.detail);
        }
        return fail("provider-failure", "Paper.js geometry provider failed closed");
      }
    });
  }

  public parseSvgPath(
    pathData: unknown,
    execution?: StudioEngineVectorGeometryExecution,
  ): Promise<StudioEngineVectorGeometryResult> {
    return this.execute({ operation: "parse", pathData }, execution);
  }

  public smoothPath(
    pathData: unknown,
    smoothing?: StudioEngineVectorGeometrySmoothRequest["smoothing"],
    execution?: StudioEngineVectorGeometryExecution,
  ): Promise<StudioEngineVectorGeometryResult> {
    const request = smoothing === undefined
      ? { operation: "smooth", pathData }
      : { operation: "smooth", pathData, smoothing };
    return this.execute(request, execution);
  }

  public simplifyPath(
    pathData: unknown,
    tolerance: unknown,
    execution?: StudioEngineVectorGeometryExecution,
  ): Promise<StudioEngineVectorGeometryResult> {
    return this.execute({ operation: "simplify", pathData, tolerance }, execution);
  }

  public booleanPath(
    operator: unknown,
    leftPathData: unknown,
    rightPathData: unknown,
    execution?: StudioEngineVectorGeometryExecution,
  ): Promise<StudioEngineVectorGeometryResult> {
    return this.execute(
      { operation: "boolean", operator, leftPathData, rightPathData },
      execution,
    );
  }

  public getDiagnostics(): StudioEngineVectorGeometryProviderDiagnostics {
    return Object.freeze({
      phase: this.disposed ? "disposed" : this.scope === null ? "cold" : "ready",
      paperLoaded: this.scope !== null,
      activeProjectCount: this.activeProjectCount,
      peakActiveProjectCount: this.peakActiveProjectCount,
      createdProjectCount: this.createdProjectCount,
      removedProjectCount: this.removedProjectCount,
      completedOperationCount: this.completedOperationCount,
      rejectedOperationCount: this.rejectedOperationCount,
    });
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.scope !== null) {
      for (const project of [...this.scope.projects]) {
        removeProject(project);
      }
      this.scope = null;
    }
  }
}

export function createStudioEngineVectorGeometryProvider(
  options?: StudioEngineVectorGeometryProviderOptions,
): StudioEngineVectorGeometryProvider {
  return new StudioEngineVectorGeometryProvider(options);
}
