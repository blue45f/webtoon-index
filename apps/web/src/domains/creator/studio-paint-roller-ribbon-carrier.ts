/**
 * Prefix-stable connected carrier for the built-in paint roller.
 *
 * The catalogue preset previously entered the generic dry-media bridge. That bridge correctly
 * models isolated wax fibres, but a roller needs continuous longitudinal tracks: five repeated
 * anisotropic alpha-map dabs exposed their round ends as a seven-pixel cadence on long strokes.
 *
 * This carrier keeps the pressure-resolved width, opacity, flow and causal path stations, then
 * sweeps one broad paint body with three intermittent, slowly wandering dry streaks cut out by
 * opposite-winding subpaths. The streaks taper fully closed instead of running as parallel staff
 * lines, while the outer body remains a loaded roller. No part is made from circles or ellipses,
 * so a long stroke cannot reveal a stamp cadence. Live suffix planning, retained replay and SVG
 * export all consume the same quantized non-zero-winding polygons.
 */

import type {
  NormalizedStudioBrushDynamicsSettings,
  StudioDynamicBrushDab,
  StudioDynamicBrushSegmentStartFrame,
} from "./brush/studio-brush-dynamics";
import type { StudioBrushTipAlphaMap } from "./brush/studio-brush-tip-stamp";
import type { StudioDynamicBrushMaterialIdentity } from "./brush/studio-dry-media-dynamic-bridge";

export const STUDIO_PAINT_ROLLER_RIBBON_CARRIER_VERSION =
  "paint-roller-ribbon-carrier-v2" as const;

export const STUDIO_PAINT_ROLLER_RIBBON_MAX_STATIONS = 1_048_576;

export interface StudioPaintRollerRibbonPolygon {
  readonly kind: "paint-roller-ribbon-polygon";
  readonly version: typeof STUDIO_PAINT_ROLLER_RIBBON_CARRIER_VERSION;
  readonly role: "tap" | "segment";
  /**
   * The first contour is the broad body. Remaining opposite-winding contours are intermittent
   * dry streak holes consumed with the default non-zero fill rule in Canvas and SVG.
   */
  readonly polygons: readonly (readonly number[])[];
}

export interface StudioPaintRollerRibbonSourceMark {
  readonly x: number;
  readonly y: number;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly angleRadians: number;
  readonly alpha: number;
  readonly color: string;
  readonly texture?: Readonly<{
    readonly kind: "alpha-map";
    readonly alphaMap: StudioBrushTipAlphaMap;
  }>;
  readonly falloff?: Readonly<{
    readonly kind: "analytic-radial";
    readonly exponent: number;
  }>;
}

export interface StudioPaintRollerRibbonCoverageMark
  extends Omit<StudioPaintRollerRibbonSourceMark, "falloff" | "texture"> {
  readonly ribbon: StudioPaintRollerRibbonPolygon;
}

export type StudioPaintRollerRibbonPlanResult =
  | Readonly<{
      readonly applied: true;
      readonly marks: readonly StudioPaintRollerRibbonCoverageMark[];
    }>
  | Readonly<{
      readonly applied: false;
      readonly reason:
        | "ineligible-material"
        | "invalid-geometry"
        | "mark-dab-mismatch"
        | "station-budget";
      readonly marks: readonly StudioPaintRollerRibbonSourceMark[];
    }>;

const COORDINATE_LIMIT = 1_000_000_000;
const GEOMETRY_QUANTIZATION = 10_000;
const POINT_EPSILON = 1e-6;

interface RollerDryStreakProfile {
  readonly center: number;
  readonly phase: number;
  readonly wanderFrequency: number;
  readonly wanderAmplitude: number;
  readonly opennessFrequency: number;
  readonly opennessThreshold: number;
  readonly maximumHalfWidth: number;
}

/**
 * Three narrow dry streaks occupy different parts of the roller face. Their apertures are smooth
 * half-waves with distinct phases, so each streak repeatedly tapers to zero and cannot become a
 * full-length staff line. Boundary motion is evaluated from the immutable global dab index, so an
 * incremental live suffix produces byte-identical geometry to committed full replay.
 */
const ROLLER_DRY_STREAK_PROFILES: readonly RollerDryStreakProfile[] = Object.freeze([
  {
    center: -0.48,
    phase: 0.35,
    wanderFrequency: 0.071,
    wanderAmplitude: 0.035,
    opennessFrequency: 0.173,
    opennessThreshold: 0.12,
    maximumHalfWidth: 0.030,
  },
  {
    center: 0.02,
    phase: 2.45,
    wanderFrequency: 0.059,
    wanderAmplitude: 0.028,
    opennessFrequency: 0.137,
    opennessThreshold: 0.20,
    maximumHalfWidth: 0.024,
  },
  {
    center: 0.55,
    phase: 4.75,
    wanderFrequency: 0.083,
    wanderAmplitude: 0.032,
    opennessFrequency: 0.157,
    opennessThreshold: 0.16,
    maximumHalfWidth: 0.027,
  },
]);

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function quantize(value: number): number {
  return Math.round(
    clamp(finite(value, 0), -COORDINATE_LIMIT, COORDINATE_LIMIT)
      * GEOMETRY_QUANTIZATION,
  ) / GEOMETRY_QUANTIZATION;
}

function eligibleMaterial(
  materialIdentity: StudioDynamicBrushMaterialIdentity | undefined,
  dynamics: NormalizedStudioBrushDynamicsSettings,
): boolean {
  return materialIdentity?.brushId === "dry-media"
    && materialIdentity.brushCatalogId === "paint-roller"
    && materialIdentity.dryMediaPresetId === "crayon"
    && dynamics.tip.shape === "hard"
    && dynamics.tip.alphaMapBase64 !== null
    && dynamics.grain.amount === 0
    && dynamics.tipLayers.length === 0
    && dynamics.dualBrush?.enabled !== true
    && dynamics.angle.jitter === null;
}

/**
 * The planner calls this before the generic dry-media bridge. Only the exact audited catalogue
 * material can claim direct carrier authority; custom or persisted incompatible settings keep the
 * established bridge unchanged.
 */
export function studioPaintRollerRibbonCarrierOwnsMaterial(
  materialIdentity: StudioDynamicBrushMaterialIdentity | undefined,
  dynamics: NormalizedStudioBrushDynamicsSettings,
): boolean {
  return eligibleMaterial(materialIdentity, dynamics);
}

function validMark(mark: StudioPaintRollerRibbonSourceMark): boolean {
  return Number.isFinite(mark.x)
    && Number.isFinite(mark.y)
    && Number.isFinite(mark.radiusX)
    && mark.radiusX > 0
    && Number.isFinite(mark.radiusY)
    && mark.radiusY > 0
    && Number.isFinite(mark.angleRadians)
    && Number.isFinite(mark.alpha)
    && typeof mark.color === "string"
    && mark.color.length > 0
    && mark.texture?.kind === "alpha-map"
    && mark.falloff === undefined;
}

function boundsForPolygons(
  polygons: readonly (readonly number[])[],
): Readonly<{
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
}> | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const points of polygons) {
    if (points.length < 6 || points.length % 2 !== 0) return null;
    for (let index = 0; index < points.length; index += 2) {
      const x = points[index];
      const y = points[index + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!(maxX > minX) || !(maxY > minY)) return null;
  return Object.freeze({
    x: quantize((minX + maxX) / 2),
    y: quantize((minY + maxY) / 2),
    radiusX: quantize(Math.max(0.25, (maxX - minX) / 2)),
    radiusY: quantize(Math.max(0.25, (maxY - minY) / 2)),
  });
}

function rollerBodyIntervalAt(
  stationIndex: number,
): readonly [number, number] {
  const center = Math.sin(stationIndex * 0.061 + 0.42) * 0.008;
  const halfWidth = 0.985 + Math.sin(stationIndex * 0.047 + 1.27) * 0.009;
  return Object.freeze([
    clamp(center - halfWidth, -1, 1),
    clamp(center + halfWidth, -1, 1),
  ]);
}

function dryStreakIntervalAt(
  profile: RollerDryStreakProfile,
  stationIndex: number,
): readonly [number, number] {
  const wave = Math.sin(
    stationIndex * profile.opennessFrequency + profile.phase,
  );
  const openness = clamp(
    (wave - profile.opennessThreshold) / (1 - profile.opennessThreshold),
    0,
    1,
  );
  const center = profile.center + Math.sin(
    stationIndex * profile.wanderFrequency + profile.phase * 1.31,
  ) * profile.wanderAmplitude;
  const halfWidth = profile.maximumHalfWidth * openness;
  return Object.freeze([
    clamp(center - halfWidth, -0.9, 0.9),
    clamp(center + halfWidth, -0.9, 0.9),
  ]);
}

function ribbonPolygon(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  startTangentX: number,
  startTangentY: number,
  endTangentX: number,
  endTangentY: number,
  startHalfSpan: number,
  endHalfSpan: number,
  startInterval: readonly [number, number],
  endInterval: readonly [number, number],
  tapHalfLength: number,
): readonly number[] {
  const startNormalX = -startTangentY;
  const startNormalY = startTangentX;
  const endNormalX = -endTangentY;
  const endNormalY = endTangentX;
  const startLow = startInterval[0] * startHalfSpan;
  const startHigh = startInterval[1] * startHalfSpan;
  const endLow = endInterval[0] * endHalfSpan;
  const endHigh = endInterval[1] * endHalfSpan;
  const tap = Math.hypot(endX - startX, endY - startY) <= POINT_EPSILON;
  const resolvedStartX = tap
    ? startX - startTangentX * tapHalfLength
    : startX;
  const resolvedStartY = tap
    ? startY - startTangentY * tapHalfLength
    : startY;
  const resolvedEndX = tap ? endX + endTangentX * tapHalfLength : endX;
  const resolvedEndY = tap ? endY + endTangentY * tapHalfLength : endY;
  return Object.freeze([
    quantize(resolvedStartX + startNormalX * startLow),
    quantize(resolvedStartY + startNormalY * startLow),
    quantize(resolvedEndX + endNormalX * endLow),
    quantize(resolvedEndY + endNormalY * endLow),
    quantize(resolvedEndX + endNormalX * endHigh),
    quantize(resolvedEndY + endNormalY * endHigh),
    quantize(resolvedStartX + startNormalX * startHigh),
    quantize(resolvedStartY + startNormalY * startHigh),
  ]);
}

function reversePolygonWinding(points: readonly number[]): readonly number[] {
  const reversed: number[] = [];
  for (let index = points.length - 2; index >= 0; index -= 2) {
    reversed.push(points[index]!, points[index + 1]!);
  }
  return Object.freeze(reversed);
}

function validSegmentStartFrame(
  frame: StudioDynamicBrushSegmentStartFrame | undefined,
): frame is StudioDynamicBrushSegmentStartFrame {
  return frame !== undefined
    && Number.isSafeInteger(frame.index)
    && frame.index >= 0
    && Number.isFinite(frame.sourceX)
    && Number.isFinite(frame.sourceY)
    && Number.isFinite(frame.direction)
    && Number.isFinite(frame.size)
    && frame.size > 0
    && Number.isFinite(frame.roundness)
    && frame.roundness > 0
    && frame.roundness <= 1;
}

function ribbonFor(
  dab: StudioDynamicBrushDab,
  mark: StudioPaintRollerRibbonSourceMark,
): StudioPaintRollerRibbonCoverageMark | null {
  const travel = finite(dab.distanceFromPrevious, Number.NaN);
  if (
    !validMark(mark)
    || !Number.isFinite(dab.sourceX)
    || !Number.isFinite(dab.sourceY)
    || !Number.isFinite(travel)
    || travel < 0
  ) {
    return null;
  }
  const directionDegrees = finite(dab.direction, Number.NaN);
  if (travel > POINT_EPSILON && !Number.isFinite(directionDegrees)) return null;
  const endDirectionRadians = (
    Number.isFinite(directionDegrees)
      ? directionDegrees
      : finite(dab.angle, 0)
  ) * Math.PI / 180;
  const endTangentX = Math.cos(endDirectionRadians);
  const endTangentY = Math.sin(endDirectionRadians);
  const endX = dab.sourceX;
  const endY = dab.sourceY;
  const segmentStartFrame = dab.segmentStartFrame;
  if (travel > POINT_EPSILON && !validSegmentStartFrame(segmentStartFrame)) {
    return null;
  }
  const startX = segmentStartFrame?.sourceX ?? endX;
  const startY = segmentStartFrame?.sourceY ?? endY;
  const startDirectionRadians = (
    segmentStartFrame?.direction
    ?? (Number.isFinite(directionDegrees) ? directionDegrees : finite(dab.angle, 0))
  ) * Math.PI / 180;
  const startTangentX = Math.cos(startDirectionRadians);
  const startTangentY = Math.sin(startDirectionRadians);
  const endHalfSpan = mark.radiusY;
  const startHalfSpan = segmentStartFrame
    ? Math.max(0.25, segmentStartFrame.size / 2)
      * segmentStartFrame.roundness
    : endHalfSpan;
  const tapHalfLength = Math.max(
    0.25,
    Math.min(mark.radiusX * 0.16, endHalfSpan * 0.28),
  );
  const stationIndex = Math.max(0, Math.floor(finite(dab.index, 0)));
  const previousStationIndex = segmentStartFrame?.index ?? stationIndex;
  const body = ribbonPolygon(
    startX,
    startY,
    endX,
    endY,
    startTangentX,
    startTangentY,
    endTangentX,
    endTangentY,
    startHalfSpan,
    endHalfSpan,
    rollerBodyIntervalAt(previousStationIndex),
    rollerBodyIntervalAt(stationIndex),
    tapHalfLength,
  );
  const dryStreakHoles = ROLLER_DRY_STREAK_PROFILES.map((profile) => (
    reversePolygonWinding(
      ribbonPolygon(
        startX,
        startY,
        endX,
        endY,
        startTangentX,
        startTangentY,
        endTangentX,
        endTangentY,
        startHalfSpan,
        endHalfSpan,
        dryStreakIntervalAt(profile, previousStationIndex),
        dryStreakIntervalAt(profile, stationIndex),
        tapHalfLength,
      ),
    )
  ));
  const polygons = Object.freeze([body, ...dryStreakHoles]);
  const bounds = boundsForPolygons(polygons);
  if (!bounds) return null;
  return Object.freeze({
    ...bounds,
    angleRadians: 0,
    alpha: mark.alpha,
    color: mark.color,
    ribbon: Object.freeze({
      kind: "paint-roller-ribbon-polygon",
      version: STUDIO_PAINT_ROLLER_RIBBON_CARRIER_VERSION,
      role: travel > POINT_EPSILON ? "segment" : "tap",
      polygons,
    }),
  });
}

/**
 * Replaces the paint roller's one-texture-mark-per-dab plan with equal-count connected segments.
 * All failure paths preserve the original immutable marks rather than partially lowering a stroke.
 */
export function planStudioPaintRollerRibbonCarrier(
  input: Readonly<{
    dabs: readonly StudioDynamicBrushDab[];
    marks: readonly StudioPaintRollerRibbonSourceMark[];
    materialIdentity?: StudioDynamicBrushMaterialIdentity;
    dynamics: NormalizedStudioBrushDynamicsSettings;
  }>,
): StudioPaintRollerRibbonPlanResult {
  if (!eligibleMaterial(input.materialIdentity, input.dynamics)) {
    return Object.freeze({
      applied: false,
      reason: "ineligible-material",
      marks: input.marks,
    });
  }
  if (input.dabs.length !== input.marks.length) {
    return Object.freeze({
      applied: false,
      reason: "mark-dab-mismatch",
      marks: input.marks,
    });
  }
  if (input.dabs.length > STUDIO_PAINT_ROLLER_RIBBON_MAX_STATIONS) {
    return Object.freeze({
      applied: false,
      reason: "station-budget",
      marks: input.marks,
    });
  }
  const planned: StudioPaintRollerRibbonCoverageMark[] = [];
  for (let index = 0; index < input.dabs.length; index += 1) {
    const mark = ribbonFor(input.dabs[index]!, input.marks[index]!);
    if (!mark) {
      return Object.freeze({
        applied: false,
        reason: "invalid-geometry",
        marks: input.marks,
      });
    }
    planned.push(mark);
  }
  return Object.freeze({
    applied: true,
    marks: Object.freeze(planned),
  });
}
