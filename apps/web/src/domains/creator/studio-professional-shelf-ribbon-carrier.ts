/**
 * Prefix-stable material carrier for the professional bristle and palette-knife shelf.
 *
 * These presets historically arrived at the shared coverage renderer as repeated alpha-map dabs.
 * On long strokes the transport lattice became more visible than the authored material. This
 * carrier keeps the canonical pressure/flow/colour response from the source mark, but replaces the
 * repeated stamp transport with deterministic connected fibre/blade polygons.
 *
 * Geometry is causal: a segment uses only the current dab and its persisted previous-station frame.
 * A live prefix, committed replay and SVG export therefore consume the same immutable polygons.
 */

import {
  isStudioDynamicBrushCausalDepositPipeline,
} from "./brush/studio-brush-dynamics";

import type {
  NormalizedStudioBrushDynamicsSettings,
  StudioDynamicBrushDab,
  StudioDynamicBrushSegmentStartFrame,
} from "./brush/studio-brush-dynamics";
import type {
  StudioBrushTipAlphaMap,
} from "./brush/studio-brush-tip-stamp";
import type { StudioDynamicBrushMaterialIdentity } from "./brush/studio-dry-media-dynamic-bridge";

export const STUDIO_PROFESSIONAL_SHELF_RIBBON_CARRIER_VERSION =
  "professional-shelf-ribbon-carrier-v1" as const;

export const STUDIO_PROFESSIONAL_SHELF_RIBBON_MAX_STATIONS = 1_048_576;
export const STUDIO_PROFESSIONAL_SHELF_RIBBON_MAX_CONTOURS = 1_048_576;

export const STUDIO_PROFESSIONAL_SHELF_RIBBON_CATALOG_IDS = Object.freeze([
  "bristle-round-loaded",
  "bristle-fan-dry",
  "bristle-flat-streak",
  "oil-filbert",
  "palette-knife-edge",
] as const);

export type StudioProfessionalShelfRibbonCatalogId =
  (typeof STUDIO_PROFESSIONAL_SHELF_RIBBON_CATALOG_IDS)[number];

export type StudioProfessionalShelfRibbonSemanticProfile =
  | "loaded-round-bristle"
  | "dry-fan-bristle"
  | "flat-streak-bristle"
  | "oil-filbert-bristle"
  | "palette-knife-edge";

export interface StudioProfessionalShelfRibbonPolygon {
  readonly kind: "professional-shelf-ribbon-polygon";
  readonly version: typeof STUDIO_PROFESSIONAL_SHELF_RIBBON_CARRIER_VERSION;
  readonly role: "stroke-union";
  readonly semanticProfile: StudioProfessionalShelfRibbonSemanticProfile;
  /**
   * Same-winding `[x0,y0,x1,y1,…]` contours. Deliberate space between contours is the physical
   * separation between bristles or a knife ridge, not a round-dab spacing artefact.
   */
  readonly polygons: readonly (readonly number[])[];
}

export interface StudioProfessionalShelfRibbonSourceMark {
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

export interface StudioProfessionalShelfRibbonCoverageMark
  extends Omit<
    StudioProfessionalShelfRibbonSourceMark,
    "falloff" | "texture"
  > {
  readonly ribbon: StudioProfessionalShelfRibbonPolygon;
}

export type StudioProfessionalShelfRibbonPlanResult =
  | Readonly<{
      readonly applied: true;
      readonly catalogId: StudioProfessionalShelfRibbonCatalogId;
      readonly semanticProfile: StudioProfessionalShelfRibbonSemanticProfile;
      readonly marks: readonly StudioProfessionalShelfRibbonCoverageMark[];
    }>
  | Readonly<{
      readonly applied: false;
      readonly reason:
        | "ineligible-material"
        | "invalid-geometry"
        | "mark-dab-mismatch"
        | "contour-budget"
        | "station-budget";
      readonly marks: readonly StudioProfessionalShelfRibbonSourceMark[];
    }>;

interface LaneProfile {
  /** Lane centre in the normalized cross-section `[-1, 1]`. */
  readonly center: number;
  /** Lane half-width in the normalized cross-section. */
  readonly halfWidth: number;
  /** Seed-independent material irregularity, evaluated per causal station. */
  readonly wander: number;
  readonly widthJitter: number;
}

interface MaterialProfile {
  readonly semanticProfile: StudioProfessionalShelfRibbonSemanticProfile;
  readonly lanes: readonly LaneProfile[];
  /** Converts the dynamic tip's cross radius into the material's painted span. */
  readonly spanScale: number;
  /** Tap length measured against the current half-span. */
  readonly tapLengthRatio: number;
}

const PROFILE_BY_ID: Readonly<
  Record<StudioProfessionalShelfRibbonCatalogId, MaterialProfile>
> = Object.freeze({
  "bristle-round-loaded": Object.freeze({
    semanticProfile: "loaded-round-bristle",
    spanScale: 1.05,
    tapLengthRatio: 0.42,
    lanes: Object.freeze([
      { center: -0.78, halfWidth: 0.18, wander: 0.035, widthJitter: 0.08 },
      { center: -0.52, halfWidth: 0.2, wander: 0.028, widthJitter: 0.07 },
      { center: -0.26, halfWidth: 0.21, wander: 0.024, widthJitter: 0.06 },
      { center: 0, halfWidth: 0.22, wander: 0.02, widthJitter: 0.05 },
      { center: 0.27, halfWidth: 0.21, wander: 0.024, widthJitter: 0.06 },
      { center: 0.54, halfWidth: 0.19, wander: 0.03, widthJitter: 0.07 },
      { center: 0.8, halfWidth: 0.16, wander: 0.038, widthJitter: 0.09 },
    ]),
  }),
  "bristle-fan-dry": Object.freeze({
    semanticProfile: "dry-fan-bristle",
    spanScale: 1.62,
    tapLengthRatio: 0.28,
    lanes: Object.freeze([
      { center: -0.94, halfWidth: 0.045, wander: 0.055, widthJitter: 0.2 },
      { center: -0.75, halfWidth: 0.06, wander: 0.05, widthJitter: 0.18 },
      { center: -0.54, halfWidth: 0.052, wander: 0.045, widthJitter: 0.22 },
      { center: -0.34, halfWidth: 0.075, wander: 0.04, widthJitter: 0.16 },
      { center: -0.1, halfWidth: 0.06, wander: 0.038, widthJitter: 0.2 },
      { center: 0.12, halfWidth: 0.07, wander: 0.038, widthJitter: 0.18 },
      { center: 0.36, halfWidth: 0.055, wander: 0.042, widthJitter: 0.22 },
      { center: 0.57, halfWidth: 0.072, wander: 0.046, widthJitter: 0.17 },
      { center: 0.78, halfWidth: 0.05, wander: 0.052, widthJitter: 0.23 },
      { center: 0.95, halfWidth: 0.04, wander: 0.058, widthJitter: 0.24 },
    ]),
  }),
  "bristle-flat-streak": Object.freeze({
    semanticProfile: "flat-streak-bristle",
    spanScale: 1.34,
    tapLengthRatio: 0.32,
    lanes: Object.freeze([
      { center: -0.9, halfWidth: 0.075, wander: 0.035, widthJitter: 0.14 },
      { center: -0.65, halfWidth: 0.1, wander: 0.03, widthJitter: 0.12 },
      { center: -0.38, halfWidth: 0.12, wander: 0.025, widthJitter: 0.1 },
      { center: -0.08, halfWidth: 0.11, wander: 0.022, widthJitter: 0.1 },
      { center: 0.21, halfWidth: 0.13, wander: 0.024, widthJitter: 0.09 },
      { center: 0.51, halfWidth: 0.09, wander: 0.03, widthJitter: 0.14 },
      { center: 0.77, halfWidth: 0.105, wander: 0.034, widthJitter: 0.12 },
      { center: 0.94, halfWidth: 0.045, wander: 0.042, widthJitter: 0.18 },
    ]),
  }),
  "oil-filbert": Object.freeze({
    semanticProfile: "oil-filbert-bristle",
    spanScale: 1.18,
    tapLengthRatio: 0.48,
    lanes: Object.freeze([
      { center: -0.82, halfWidth: 0.14, wander: 0.025, widthJitter: 0.08 },
      { center: -0.58, halfWidth: 0.17, wander: 0.022, widthJitter: 0.07 },
      { center: -0.32, halfWidth: 0.19, wander: 0.018, widthJitter: 0.06 },
      { center: -0.05, halfWidth: 0.21, wander: 0.016, widthJitter: 0.05 },
      { center: 0.23, halfWidth: 0.2, wander: 0.018, widthJitter: 0.06 },
      { center: 0.5, halfWidth: 0.18, wander: 0.021, widthJitter: 0.07 },
      { center: 0.75, halfWidth: 0.14, wander: 0.026, widthJitter: 0.08 },
    ]),
  }),
  "palette-knife-edge": Object.freeze({
    semanticProfile: "palette-knife-edge",
    spanScale: 1.5,
    tapLengthRatio: 0.7,
    lanes: Object.freeze([
      // Broad asymmetric blade deposit plus one separated ridge of paint.
      { center: -0.13, halfWidth: 0.63, wander: 0.012, widthJitter: 0.035 },
      { center: 0.78, halfWidth: 0.085, wander: 0.022, widthJitter: 0.12 },
    ]),
  }),
});

const EXPECTED_RUNTIME_BY_ID: Readonly<
  Record<StudioProfessionalShelfRibbonCatalogId, string>
> = Object.freeze({
  "bristle-round-loaded": "ink-particle",
  "bristle-fan-dry": "dry-media",
  "bristle-flat-streak": "dry-media",
  "oil-filbert": "dry-media",
  "palette-knife-edge": "ink-particle",
});

const ELIGIBLE_ID_SET = new Set<string>(
  STUDIO_PROFESSIONAL_SHELF_RIBBON_CATALOG_IDS,
);
const COORDINATE_LIMIT = 1_000_000_000;
const GEOMETRY_QUANTIZATION = 10_000;
const POINT_EPSILON = 1e-6;

interface StationGeometry {
  readonly x: number;
  readonly y: number;
  readonly tangentX: number;
  readonly tangentY: number;
  readonly normalX: number;
  readonly normalY: number;
  readonly halfSpan: number;
  readonly stationIndex: number;
}

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

function hashUnit(stationIndex: number, laneIndex: number, salt: number): number {
  let value = (
    Math.imul((stationIndex + 1) | 0, 0x9e37_79b1)
    ^ Math.imul((laneIndex + 3) | 0, 0x85eb_ca6b)
    ^ salt
  ) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb_352d) >>> 0;
  value ^= value >>> 15;
  value = Math.imul(value, 0x846c_a68b) >>> 0;
  value ^= value >>> 16;
  return value / 0x1_0000_0000;
}

function signedArea(points: readonly number[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 2) {
    const next = (index + 2) % points.length;
    area += points[index]! * points[next + 1]!
      - points[next]! * points[index + 1]!;
  }
  return area / 2;
}

function sameWinding(points: readonly number[]): readonly number[] {
  const quantized = points.map(quantize);
  if (signedArea(quantized) >= 0) return Object.freeze(quantized);
  const reversed: number[] = [];
  for (let index = quantized.length - 2; index >= 0; index -= 2) {
    reversed.push(quantized[index]!, quantized[index + 1]!);
  }
  return Object.freeze(reversed);
}

function convexHull(
  coordinates: readonly (readonly [number, number])[],
): readonly number[] {
  const points = coordinates
    .map(([x, y]) => Object.freeze([quantize(x), quantize(y)] as const))
    .filter(([x, y], index, candidates) => (
      candidates.findIndex(([candidateX, candidateY]) => (
        candidateX === x && candidateY === y
      )) === index
    ))
    .sort(([leftX, leftY], [rightX, rightY]) => (
      leftX === rightX ? leftY - rightY : leftX - rightX
    ));
  if (points.length < 3) return Object.freeze([]);
  const cross = (
    origin: readonly [number, number],
    first: readonly [number, number],
    second: readonly [number, number],
  ) => (
    (first[0] - origin[0]) * (second[1] - origin[1])
    - (first[1] - origin[1]) * (second[0] - origin[0])
  );
  const lower: Array<readonly [number, number]> = [];
  for (const point of points) {
    while (
      lower.length >= 2
      && cross(lower.at(-2)!, lower.at(-1)!, point) <= POINT_EPSILON
    ) lower.pop();
    lower.push(point);
  }
  const upper: Array<readonly [number, number]> = [];
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index]!;
    while (
      upper.length >= 2
      && cross(upper.at(-2)!, upper.at(-1)!, point) <= POINT_EPSILON
    ) upper.pop();
    upper.push(point);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)]
    .flatMap(([x, y]) => [x, y]);
  return sameWinding(hull);
}

function validFrame(
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
    && frame.roundness > 0;
}

function validMark(mark: StudioProfessionalShelfRibbonSourceMark): boolean {
  return Number.isFinite(mark.x)
    && Number.isFinite(mark.y)
    && Number.isFinite(mark.radiusX)
    && mark.radiusX > 0
    && Number.isFinite(mark.radiusY)
    && mark.radiusY > 0
    && Number.isFinite(mark.angleRadians)
    && Number.isFinite(mark.alpha)
    && mark.alpha >= 0
    && mark.alpha <= 1
    && typeof mark.color === "string"
    && mark.color.length > 0;
}

function stationFromDab(
  dab: StudioDynamicBrushDab,
  mark: StudioProfessionalShelfRibbonSourceMark,
  profile: MaterialProfile,
): Readonly<{
  readonly current: StationGeometry;
  readonly previous: StationGeometry | null;
  readonly travel: number;
}> | null {
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
  const direction = finite(dab.direction, Number.NaN);
  if (travel > POINT_EPSILON && !Number.isFinite(direction)) return null;
  const currentDirection = Number.isFinite(direction)
    ? direction
    : finite(dab.angle, 0);
  const currentRadians = currentDirection * Math.PI / 180;
  const current: StationGeometry = Object.freeze({
    x: dab.sourceX,
    y: dab.sourceY,
    tangentX: Math.cos(currentRadians),
    tangentY: Math.sin(currentRadians),
    normalX: -Math.sin(currentRadians),
    normalY: Math.cos(currentRadians),
    halfSpan: Math.max(0.25, mark.radiusY * profile.spanScale),
    stationIndex: Math.max(0, Math.floor(finite(dab.index, 0))),
  });
  if (travel <= POINT_EPSILON) {
    return Object.freeze({ current, previous: null, travel });
  }
  const frame = dab.segmentStartFrame;
  if (!validFrame(frame)) return null;
  const previousRadians = frame.direction * Math.PI / 180;
  const previous = Object.freeze({
    x: frame.sourceX,
    y: frame.sourceY,
    tangentX: Math.cos(previousRadians),
    tangentY: Math.sin(previousRadians),
    normalX: -Math.sin(previousRadians),
    normalY: Math.cos(previousRadians),
    halfSpan: Math.max(
      0.25,
      frame.size / 2 * frame.roundness * profile.spanScale,
    ),
    stationIndex: frame.index,
  });
  return Object.freeze({ current, previous, travel });
}

function laneIntervalAt(
  lane: LaneProfile,
  laneIndex: number,
  stationIndex: number,
): readonly [number, number] {
  const centerNoise = (
    hashUnit(stationIndex, laneIndex, 0x91e1_0da5) * 2 - 1
  ) * lane.wander;
  const widthNoise = 1 + (
    hashUnit(stationIndex, laneIndex, 0x4b1d_2f37) * 2 - 1
  ) * lane.widthJitter;
  const center = clamp(lane.center + centerNoise, -0.98, 0.98);
  const halfWidth = Math.max(0.012, lane.halfWidth * widthNoise);
  return Object.freeze([
    clamp(center - halfWidth, -1, 1),
    clamp(center + halfWidth, -1, 1),
  ]);
}

function pointAt(
  station: StationGeometry,
  normalizedOffset: number,
  tangentOffset: number,
): readonly [number, number] {
  return Object.freeze([
    station.x
      + station.normalX * normalizedOffset * station.halfSpan
      + station.tangentX * tangentOffset,
    station.y
      + station.normalY * normalizedOffset * station.halfSpan
      + station.tangentY * tangentOffset,
  ]);
}

function lanePolygon(
  lane: LaneProfile,
  laneIndex: number,
  current: StationGeometry,
  previous: StationGeometry | null,
  tapLengthRatio: number,
): readonly number[] {
  const currentInterval = laneIntervalAt(
    lane,
    laneIndex,
    current.stationIndex,
  );
  if (!previous) {
    const tapHalfLength = Math.max(
      0.2,
      current.halfSpan * tapLengthRatio,
    );
    const startLow = pointAt(current, currentInterval[0], -tapHalfLength);
    const endLow = pointAt(current, currentInterval[0], tapHalfLength);
    const endHigh = pointAt(current, currentInterval[1], tapHalfLength);
    const startHigh = pointAt(current, currentInterval[1], -tapHalfLength);
    return sameWinding([
      ...startLow,
      ...endLow,
      ...endHigh,
      ...startHigh,
    ]);
  }
  const previousInterval = laneIntervalAt(
    lane,
    laneIndex,
    previous.stationIndex,
  );
  const outgoingPrevious: StationGeometry = Object.freeze({
    ...previous,
    tangentX: current.tangentX,
    tangentY: current.tangentY,
    normalX: current.normalX,
    normalY: current.normalY,
  });
  const startLow = pointAt(previous, previousInterval[0], 0);
  const outgoingLow = pointAt(
    outgoingPrevious,
    previousInterval[0],
    0,
  );
  const endLow = pointAt(current, currentInterval[0], 0);
  const endHigh = pointAt(current, currentInterval[1], 0);
  const outgoingHigh = pointAt(
    outgoingPrevious,
    previousInterval[1],
    0,
  );
  const startHigh = pointAt(previous, previousInterval[1], 0);
  // A bounded convex join covers the incoming and outgoing cross-sections without an unbounded
  // miter spike. On a ~180° cusp this becomes a finite bevel around the station; on a straight
  // segment the duplicate points collapse back to the ordinary four-corner ribbon.
  return convexHull([
    startLow,
    outgoingLow,
    endLow,
    endHigh,
    outgoingHigh,
    startHigh,
  ]);
}

function boundsForPolygons(
  polygons: readonly (readonly number[])[],
): Readonly<{
  readonly x: number;
  readonly y: number;
  readonly radiusX: number;
  readonly radiusY: number;
}> | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const polygon of polygons) {
    if (
      polygon.length < 6
      || polygon.length % 2 !== 0
      || !polygon.every(Number.isFinite)
    ) {
      return null;
    }
    for (let index = 0; index < polygon.length; index += 2) {
      const x = polygon[index]!;
      const y = polygon[index + 1]!;
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

function resolvedCatalogId(
  materialIdentity: StudioDynamicBrushMaterialIdentity | undefined,
): StudioProfessionalShelfRibbonCatalogId | null {
  const catalogId = materialIdentity?.brushCatalogId;
  if (
    typeof catalogId !== "string"
    || !ELIGIBLE_ID_SET.has(catalogId)
    || materialIdentity?.brushId !== EXPECTED_RUNTIME_BY_ID[
      catalogId as StudioProfessionalShelfRibbonCatalogId
    ]
  ) {
    return null;
  }
  return catalogId as StudioProfessionalShelfRibbonCatalogId;
}

export function studioProfessionalShelfRibbonCarrierOwnsMaterial(
  materialIdentity: StudioDynamicBrushMaterialIdentity | undefined,
  dynamics?: NormalizedStudioBrushDynamicsSettings,
): boolean {
  return resolvedCatalogId(materialIdentity) !== null
    && (
      dynamics === undefined
      || isStudioDynamicBrushCausalDepositPipeline(dynamics.depositPipeline)
    );
}

/**
 * Conservative geometry-work multiplier for the shared mark budget.
 *
 * The carrier issues one Canvas fill command per dab, but that path contains two to ten physical
 * contours. Charging each contour prevents a very long fan-brush stroke from hiding expensive
 * geometry behind a nominal one-command count.
 */
export function studioProfessionalShelfRibbonCarrierWorkMultiplier(
  materialIdentity: StudioDynamicBrushMaterialIdentity | undefined,
  dynamics?: NormalizedStudioBrushDynamicsSettings,
): number {
  const catalogId = resolvedCatalogId(materialIdentity);
  return catalogId
    && studioProfessionalShelfRibbonCarrierOwnsMaterial(
      materialIdentity,
      dynamics,
    )
    ? PROFILE_BY_ID[catalogId].lanes.length
    : 1;
}

function polygonsFor(
  catalogId: StudioProfessionalShelfRibbonCatalogId,
  dab: StudioDynamicBrushDab,
  mark: StudioProfessionalShelfRibbonSourceMark,
): readonly (readonly number[])[] | null {
  const profile = PROFILE_BY_ID[catalogId];
  const stations = stationFromDab(dab, mark, profile);
  if (!stations) return null;
  const polygons = Object.freeze(profile.lanes.map((lane, laneIndex) => (
    lanePolygon(
      lane,
      laneIndex,
      stations.current,
      stations.previous,
      profile.tapLengthRatio,
    )
  )));
  return polygons.every((polygon) => polygon.length >= 6)
    ? polygons
    : null;
}

/**
 * Replaces the primary one-mark-per-dab plan for five audited professional materials.
 *
 * The planner deliberately receives primary marks rather than every legacy tip layer. Once this
 * specialist route is admitted, bristle lanes or the knife blade are the material geometry;
 * legacy dual-tip/tip-layer stamps are not replayed on top and cannot reintroduce round cadence.
 */
export function planStudioProfessionalShelfRibbonCarrier(
  input: Readonly<{
    readonly dabs: readonly StudioDynamicBrushDab[];
    readonly marks: readonly StudioProfessionalShelfRibbonSourceMark[];
    readonly materialIdentity?: StudioDynamicBrushMaterialIdentity;
    readonly dynamics: NormalizedStudioBrushDynamicsSettings;
  }>,
): StudioProfessionalShelfRibbonPlanResult {
  const catalogId = resolvedCatalogId(input.materialIdentity);
  if (
    !catalogId
    || !studioProfessionalShelfRibbonCarrierOwnsMaterial(
      input.materialIdentity,
      input.dynamics,
    )
  ) {
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
  if (input.dabs.length > STUDIO_PROFESSIONAL_SHELF_RIBBON_MAX_STATIONS) {
    return Object.freeze({
      applied: false,
      reason: "station-budget",
      marks: input.marks,
    });
  }
  if (
    input.dabs.length
      * PROFILE_BY_ID[catalogId].lanes.length
    > STUDIO_PROFESSIONAL_SHELF_RIBBON_MAX_CONTOURS
  ) {
    return Object.freeze({
      applied: false,
      reason: "contour-budget",
      marks: input.marks,
    });
  }
  if (input.dabs.length === 0) {
    return Object.freeze({
      applied: true,
      catalogId,
      semanticProfile: PROFILE_BY_ID[catalogId].semanticProfile,
      marks: Object.freeze([]),
    });
  }
  const firstColor = input.marks[0]?.color;
  if (
    typeof firstColor !== "string"
    || input.marks.some((mark) => mark.color !== firstColor)
  ) {
    return Object.freeze({
      applied: false,
      reason: "invalid-geometry",
      marks: input.marks,
    });
  }
  const polygons: Array<readonly number[]> = [];
  for (let index = 0; index < input.dabs.length; index += 1) {
    const planned = polygonsFor(
      catalogId,
      input.dabs[index]!,
      input.marks[index]!,
    );
    if (!planned) {
      return Object.freeze({
        applied: false,
        reason: "invalid-geometry",
        marks: input.marks,
      });
    }
    polygons.push(...planned);
  }
  const bounds = boundsForPolygons(polygons);
  if (!bounds) {
    return Object.freeze({
      applied: false,
      reason: "invalid-geometry",
      marks: input.marks,
    });
  }
  const coverageAlpha = clamp(
    finite(input.dynamics.opacity.base, 1)
      * finite(input.dynamics.flow.base, 1),
    0,
    1,
  );
  const unionMark: StudioProfessionalShelfRibbonCoverageMark = Object.freeze({
    ...bounds,
    angleRadians: 0,
    // Internal flow remains a single stroke-local alpha. Pressure still controls the authored
    // width/roundness; it no longer compounds merely because the path turns or crosses itself.
    alpha: coverageAlpha,
    color: firstColor,
    ribbon: Object.freeze({
      kind: "professional-shelf-ribbon-polygon",
      version: STUDIO_PROFESSIONAL_SHELF_RIBBON_CARRIER_VERSION,
      role: "stroke-union",
      semanticProfile: PROFILE_BY_ID[catalogId].semanticProfile,
      polygons: Object.freeze(polygons),
    }),
  });
  return Object.freeze({
    applied: true,
    catalogId,
    semanticProfile: PROFILE_BY_ID[catalogId].semanticProfile,
    marks: Object.freeze([unionMark]),
  });
}
