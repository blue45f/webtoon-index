/**
 * Loss-bounded bridge between Studio's persisted polyline DrawEl model and the settled-only
 * Paper vector refinement provider.
 *
 * The adapter deliberately owns no scene, history, selection, persistence, or collaboration
 * authority. A successful result contains only a replacement DrawEl for the caller to revalidate
 * and commit through StudioPage's canonical mutation path.
 */

import {
  resolveStudioBrushRenderFamily,
  type StudioBrushRenderFamily,
} from "../studio-brush";

import { resolveStudioInkPressureSamples } from "./studio-ink-pressure-model";

import type { DrawEl } from "../studio-element-model";
import type {
  StudioPaperVectorRefinementFailureReason,
  StudioPaperVectorRefinementResult,
  StudioPaperVectorSmoothCommand,
} from "./studio-paper-vector-refinement-provider";

export const STUDIO_PAPER_VECTOR_DOCUMENT_ADAPTER_LIMITS = Object.freeze({
  maxInputPoints: 32_768,
  maxOutputPoints: 65_536,
  maxCoordinateAbsolute: 1_000_000,
} as const);

export interface StudioPaperVectorDocumentAdapterLimits {
  readonly maxInputPoints?: number;
  readonly maxOutputPoints?: number;
  readonly maxCoordinateAbsolute?: number;
}

export type StudioPaperVectorDocumentRefinement =
  | Readonly<{
      readonly kind: "simplify";
      readonly tolerance: number;
    }>
  | Readonly<{
      readonly kind: "smooth";
      readonly smoothing?: StudioPaperVectorSmoothCommand["smoothing"];
    }>;

/**
 * Minimal refinement port consumed by the document adapter.
 *
 * The in-process Paper provider and the isolated Worker client both satisfy this contract.
 * Keeping the adapter structural avoids giving either implementation scene, history, or
 * persistence authority and prevents the provider class's private state from leaking into the
 * document boundary.
 */
export interface StudioPaperVectorDocumentRefinementPort {
  refine(candidate: unknown): Promise<StudioPaperVectorRefinementResult>;
}

export interface StudioPaperVectorDocumentAdapterInput {
  readonly element: DrawEl;
  readonly provider: StudioPaperVectorDocumentRefinementPort;
  readonly requestSequence: number;
  readonly engineEpoch: number;
  readonly refinement: StudioPaperVectorDocumentRefinement;
  readonly signal?: AbortSignal;
  readonly limits?: StudioPaperVectorDocumentAdapterLimits;
}

export type StudioPaperVectorDocumentAdapterFailureReason =
  | "invalid-input"
  | "ineligible-element"
  | "budget-exceeded"
  | "provider-rejected"
  | "invalid-provider-output";

export type StudioPaperVectorDocumentAdapterResult =
  | Readonly<{
      readonly ok: true;
      readonly replacement: DrawEl;
    }>
  | Readonly<{
      readonly ok: false;
      readonly reason: StudioPaperVectorDocumentAdapterFailureReason;
      readonly detail: string;
      readonly providerReason?: StudioPaperVectorRefinementFailureReason;
    }>;

interface ResolvedAdapterLimits {
  readonly maxInputPoints: number;
  readonly maxOutputPoints: number;
  readonly maxCoordinateAbsolute: number;
}

interface ArcLengthTable {
  readonly cumulative: readonly number[];
  readonly total: number;
}

const OUTPUT_DECIMAL_PLACES = 6;
const OUTPUT_SCALE = 10 ** OUTPUT_DECIMAL_PLACES;
const SAFE_CONNECTED_PATH_FAMILIES: ReadonlySet<StudioBrushRenderFamily> = new Set([
  "pen",
  "gpen",
  "calligraphy",
  "perfect",
  "marker",
  "highlighter",
  "neon",
  "glow",
]);

function failure(
  reason: StudioPaperVectorDocumentAdapterFailureReason,
  detail: string,
  providerReason?: StudioPaperVectorRefinementFailureReason,
): StudioPaperVectorDocumentAdapterResult {
  return Object.freeze({
    ok: false,
    reason,
    detail: detail.slice(0, 512),
    ...(providerReason === undefined ? {} : { providerReason }),
  });
}

function positiveSafeInteger(
  value: number | undefined,
  fallback: number,
): number | null {
  const resolved = value ?? fallback;
  return Number.isSafeInteger(resolved) && resolved > 0 ? resolved : null;
}

function positiveFinite(
  value: number | undefined,
  fallback: number,
): number | null {
  const resolved = value ?? fallback;
  return Number.isFinite(resolved) && resolved > 0 ? resolved : null;
}

function resolveLimits(
  candidate: StudioPaperVectorDocumentAdapterLimits | undefined,
): ResolvedAdapterLimits | null {
  if (
    candidate !== undefined
    && (
      typeof candidate !== "object"
      || candidate === null
      || Array.isArray(candidate)
      || Object.keys(candidate).some(
        (key) =>
          key !== "maxInputPoints"
          && key !== "maxOutputPoints"
          && key !== "maxCoordinateAbsolute",
      )
    )
  ) {
    return null;
  }
  const maxInputPoints = positiveSafeInteger(
    candidate?.maxInputPoints,
    STUDIO_PAPER_VECTOR_DOCUMENT_ADAPTER_LIMITS.maxInputPoints,
  );
  const maxOutputPoints = positiveSafeInteger(
    candidate?.maxOutputPoints,
    STUDIO_PAPER_VECTOR_DOCUMENT_ADAPTER_LIMITS.maxOutputPoints,
  );
  const maxCoordinateAbsolute = positiveFinite(
    candidate?.maxCoordinateAbsolute,
    STUDIO_PAPER_VECTOR_DOCUMENT_ADAPTER_LIMITS.maxCoordinateAbsolute,
  );
  if (
    maxInputPoints === null
    || maxOutputPoints === null
    || maxCoordinateAbsolute === null
  ) {
    return null;
  }
  return Object.freeze({
    maxInputPoints,
    maxOutputPoints,
    maxCoordinateAbsolute,
  });
}

function roundOutputNumber(value: number): number {
  const rounded = Math.round(value * OUTPUT_SCALE) / OUTPUT_SCALE;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function formatOutputNumber(value: number): string {
  const rounded = roundOutputNumber(value);
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(OUTPUT_DECIMAL_PLACES).replace(/(?:\.0+|(\.\d+?)0+)$/u, "$1");
}

function finitePointPairs(
  value: unknown,
  maximumPoints: number,
  maximumCoordinateAbsolute: number,
): boolean {
  if (
    !Array.isArray(value)
    || value.length < 4
    || value.length % 2 !== 0
    || value.length / 2 > maximumPoints
  ) {
    return false;
  }
  return value.every(
    (coordinate) =>
      typeof coordinate === "number"
      && Number.isFinite(coordinate)
      && Math.abs(coordinate) <= maximumCoordinateAbsolute,
  );
}

function arcLengthTable(points: readonly number[]): ArcLengthTable | null {
  const pointCount = points.length / 2;
  const cumulative = new Array<number>(pointCount);
  cumulative[0] = 0;
  let total = 0;
  for (let index = 1; index < pointCount; index += 1) {
    const previousOffset = (index - 1) * 2;
    const offset = index * 2;
    total += Math.hypot(
      points[offset]! - points[previousOffset]!,
      points[offset + 1]! - points[previousOffset + 1]!,
    );
    cumulative[index] = total;
  }
  if (!Number.isFinite(total) || total <= 0) return null;
  return Object.freeze({
    cumulative: Object.freeze(cumulative),
    total,
  });
}

function canonicalOpenPolylinePathData(points: readonly number[]): string {
  const tokens = [
    "M",
    formatOutputNumber(points[0]!),
    formatOutputNumber(points[1]!),
  ];
  let previousX = points[0]!;
  let previousY = points[1]!;
  for (let offset = 2; offset < points.length; offset += 2) {
    const x = points[offset]!;
    const y = points[offset + 1]!;
    if (x === previousX && y === previousY) continue;
    tokens.push("L", formatOutputNumber(x), formatOutputNumber(y));
    previousX = x;
    previousY = y;
  }
  return tokens.join(" ");
}

function complexBrushIneligibilityReason(element: DrawEl): string | null {
  const family = resolveStudioBrushRenderFamily(element.brush ?? "pen");
  if (!SAFE_CONNECTED_PATH_FAMILIES.has(family)) {
    return `The ${family} brush family does not have path-stable Paper refinement semantics.`;
  }
  if (
    element.brushDynamics !== undefined
    || element.stamp !== undefined
    || element.stampPipeline !== undefined
    || element.watercolorPipeline !== undefined
    || element.sketch !== undefined
  ) {
    return "Dynamic, stamped, watercolor, or rough brush pipelines cannot be safely resampled.";
  }
  return null;
}

/**
 * Returns null only for an open, connected-path freehand pen whose rendered semantics survive a
 * centerline replacement. Geometry validity and budgets are checked separately by the adapter.
 */
export function studioPaperVectorDocumentIneligibilityReason(
  element: DrawEl,
): string | null {
  if (!element || element.type !== "draw") return "Only drawing elements can be refined.";
  if ((element.kind ?? "freehand") !== "freehand") {
    return "Only freehand drawing elements can be refined.";
  }
  if ((element.mode ?? "pen") !== "pen") return "Eraser paths cannot be refined.";
  if (
    element.fill !== undefined
    || element.gradient !== undefined
    || element.pattern !== undefined
  ) {
    return "Filled or patterned paths cannot be refined by the open-polyline adapter.";
  }
  if ((element.symmetry?.type ?? "none") !== "none") {
    return "Active symmetry must be baked before Paper refinement.";
  }
  return complexBrushIneligibilityReason(element);
}

function normalizeLinearSamples(
  samples: readonly number[] | undefined,
  pointCount: number,
  fallback: number,
  minimum: number,
  maximum: number,
): number[] {
  return Array.from({ length: pointCount }, (_, index) => {
    const candidate = samples?.[index];
    const finite = typeof candidate === "number" && Number.isFinite(candidate)
      ? candidate
      : fallback;
    return Math.min(maximum, Math.max(minimum, finite));
  });
}

function normalizeTwistSamples(
  samples: readonly number[] | undefined,
  pointCount: number,
): number[] {
  return Array.from({ length: pointCount }, (_, index) => {
    const candidate = samples?.[index];
    if (typeof candidate !== "number" || !Number.isFinite(candidate)) return 0;
    const normalized = candidate % 360;
    return normalized < 0 ? normalized + 360 : normalized;
  });
}

function lowerBoundDistance(
  cumulative: readonly number[],
  target: number,
): number {
  let low = 1;
  let high = cumulative.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (cumulative[middle]! < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function interpolateLinear(
  values: readonly number[],
  sourceArc: ArcLengthTable,
  normalizedDistance: number,
): number {
  if (normalizedDistance <= 0) return values[0]!;
  if (normalizedDistance >= 1) return values[values.length - 1]!;
  const target = normalizedDistance * sourceArc.total;
  let upper = lowerBoundDistance(sourceArc.cumulative, target);
  while (
    upper < sourceArc.cumulative.length - 1
    && sourceArc.cumulative[upper] === sourceArc.cumulative[upper - 1]
  ) {
    upper += 1;
  }
  const lower = upper - 1;
  const span = sourceArc.cumulative[upper]! - sourceArc.cumulative[lower]!;
  const ratio = span <= 0
    ? 0
    : (target - sourceArc.cumulative[lower]!) / span;
  return values[lower]! + (values[upper]! - values[lower]!) * ratio;
}

function interpolateTwist(
  values: readonly number[],
  sourceArc: ArcLengthTable,
  normalizedDistance: number,
): number {
  if (normalizedDistance <= 0) return values[0]!;
  if (normalizedDistance >= 1) return values[values.length - 1]!;
  const target = normalizedDistance * sourceArc.total;
  let upper = lowerBoundDistance(sourceArc.cumulative, target);
  while (
    upper < sourceArc.cumulative.length - 1
    && sourceArc.cumulative[upper] === sourceArc.cumulative[upper - 1]
  ) {
    upper += 1;
  }
  const lower = upper - 1;
  const span = sourceArc.cumulative[upper]! - sourceArc.cumulative[lower]!;
  const ratio = span <= 0
    ? 0
    : (target - sourceArc.cumulative[lower]!) / span;
  const start = values[lower]!;
  const delta = ((values[upper]! - start + 540) % 360) - 180;
  const result = (start + delta * ratio) % 360;
  return result < 0 ? result + 360 : result;
}

function remapLinearSamples(
  values: readonly number[],
  sourceArc: ArcLengthTable,
  outputArc: ArcLengthTable,
): number[] {
  return outputArc.cumulative.map((distance) =>
    roundOutputNumber(interpolateLinear(values, sourceArc, distance / outputArc.total)),
  );
}

function remapTwistSamples(
  values: readonly number[],
  sourceArc: ArcLengthTable,
  outputArc: ArcLengthTable,
): number[] {
  return outputArc.cumulative.map((distance) =>
    roundOutputNumber(interpolateTwist(values, sourceArc, distance / outputArc.total)),
  );
}

function replacementWithRemappedMetadata(
  element: DrawEl,
  points: number[],
  sourceArc: ArcLengthTable,
  outputArc: ArcLengthTable,
): DrawEl {
  const sourcePointCount = element.points.length / 2;
  const replacement: DrawEl = {
    ...element,
    points,
  };
  // Speeds describe the old sampling cadence. Keeping them after a topology-changing refinement
  // would be semantically stale, so omit them until a caller with timing authority recomputes them.
  delete replacement.speeds;

  if (element.pressures !== undefined) {
    replacement.pressures = remapLinearSamples(
      resolveStudioInkPressureSamples(
        element.pressures,
        sourcePointCount,
        element.pressureModel,
      ),
      sourceArc,
      outputArc,
    );
  }
  if (element.tiltXs !== undefined) {
    replacement.tiltXs = remapLinearSamples(
      normalizeLinearSamples(element.tiltXs, sourcePointCount, 0, -90, 90),
      sourceArc,
      outputArc,
    );
  }
  if (element.tiltYs !== undefined) {
    replacement.tiltYs = remapLinearSamples(
      normalizeLinearSamples(element.tiltYs, sourcePointCount, 0, -90, 90),
      sourceArc,
      outputArc,
    );
  }
  if (element.twists !== undefined) {
    replacement.twists = remapTwistSamples(
      normalizeTwistSamples(element.twists, sourcePointCount),
      sourceArc,
      outputArc,
    );
  }
  if (element.tangentialPressures !== undefined) {
    replacement.tangentialPressures = remapLinearSamples(
      normalizeLinearSamples(
        element.tangentialPressures,
        sourcePointCount,
        0,
        -1,
        1,
      ),
      sourceArc,
      outputArc,
    );
  }
  return replacement;
}

/**
 * Builds and executes one settled simplify/smooth request, then converts exactly one non-empty
 * open contour back into Studio's current DrawEl polyline model.
 */
export async function refineStudioDrawElementWithPaper(
  input: StudioPaperVectorDocumentAdapterInput,
): Promise<StudioPaperVectorDocumentAdapterResult> {
  if (
    !input
    || typeof input !== "object"
    || typeof input.provider?.refine !== "function"
    || !Number.isSafeInteger(input.requestSequence)
    || input.requestSequence <= 0
    || !Number.isSafeInteger(input.engineEpoch)
    || input.engineEpoch < 0
    || (
      input.signal !== undefined
      && !(
        typeof AbortSignal !== "undefined"
        && input.signal instanceof AbortSignal
      )
    )
  ) {
    return failure("invalid-input", "The adapter request envelope is invalid.");
  }
  const limits = resolveLimits(input.limits);
  if (limits === null) {
    return failure("invalid-input", "The adapter limits are invalid.");
  }
  const ineligibilityReason = studioPaperVectorDocumentIneligibilityReason(input.element);
  if (ineligibilityReason !== null) {
    return failure("ineligible-element", ineligibilityReason);
  }
  if (!finitePointPairs(
    input.element.points,
    limits.maxInputPoints,
    limits.maxCoordinateAbsolute,
  )) {
    const pointCount = Array.isArray(input.element.points)
      ? input.element.points.length / 2
      : 0;
    return failure(
      pointCount > limits.maxInputPoints ? "budget-exceeded" : "invalid-input",
      "The source polyline is malformed or exceeds the input geometry budget.",
    );
  }
  const sourceArc = arcLengthTable(input.element.points);
  if (sourceArc === null) {
    return failure("invalid-input", "The source polyline has zero arc length.");
  }

  let command: StudioPaperVectorSmoothCommand | Readonly<{
    kind: "simplify";
    pathData: string;
    tolerance: number;
  }>;
  const pathData = canonicalOpenPolylinePathData(input.element.points);
  if (input.refinement.kind === "simplify") {
    if (
      typeof input.refinement.tolerance !== "number"
      || !Number.isFinite(input.refinement.tolerance)
      || input.refinement.tolerance <= 0
    ) {
      return failure("invalid-input", "Simplify tolerance must be a positive finite number.");
    }
    command = Object.freeze({
      kind: "simplify",
      pathData,
      tolerance: input.refinement.tolerance,
    });
  } else if (input.refinement.kind === "smooth") {
    command = Object.freeze({
      kind: "smooth",
      pathData,
      ...(input.refinement.smoothing === undefined
        ? {}
        : {
            smoothing: Object.freeze({
              ...input.refinement.smoothing,
            }),
          }),
    });
  } else {
    return failure("invalid-input", "Only simplify and smooth refinement are supported.");
  }

  const providerResult = await input.provider.refine({
    kind: "studio-paper-vector-refinement/request",
    version: 1,
    requestSequence: input.requestSequence,
    engineEpoch: input.engineEpoch,
    stage: "settled",
    command,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  if (providerResult.status === "rejected") {
    return failure(
      providerResult.reason === "budget-exceeded"
        ? "budget-exceeded"
        : "provider-rejected",
      providerResult.detail,
      providerResult.reason,
    );
  }

  const { artifact } = providerResult;
  if (
    artifact.empty
    || artifact.contours.length !== 1
    || artifact.contours[0]!.closed
  ) {
    return failure(
      "invalid-provider-output",
      "Paper refinement did not return exactly one non-empty open contour.",
    );
  }
  const outputPoints = [...artifact.contours[0]!.points];
  if (!finitePointPairs(
    outputPoints,
    limits.maxOutputPoints,
    limits.maxCoordinateAbsolute,
  )) {
    const pointCount = outputPoints.length / 2;
    return failure(
      pointCount > limits.maxOutputPoints ? "budget-exceeded" : "invalid-provider-output",
      "The refined contour is malformed or exceeds the output geometry budget.",
    );
  }
  const outputArc = arcLengthTable(outputPoints);
  if (outputArc === null) {
    return failure("invalid-provider-output", "The refined contour has zero arc length.");
  }

  return Object.freeze({
    ok: true,
    replacement: replacementWithRemappedMetadata(
      input.element,
      outputPoints,
      sourceArc,
      outputArc,
    ),
  });
}
