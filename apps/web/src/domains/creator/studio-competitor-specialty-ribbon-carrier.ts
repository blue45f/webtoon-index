/**
 * Connected carrier for four specialist brushes missing from the audited competitor matrix.
 *
 * The ordinary dynamic-dab planner still owns pressure, flow and taper. This module only replaces
 * the repeated stamp transport with causal polygons:
 *
 * - hard airbrush: one continuous, sharp-edged envelope;
 * - erodible pencil: a progressively worn, asymmetric contact ribbon;
 * - paint tube: a loaded body with two opposite-winding extrusion grooves;
 * - tangent normal brush: a continuous ribbon whose colour encodes its tangent-space direction.
 *
 * Every segment depends only on the current dab and its persisted previous-station frame. Live
 * prefixes, committed replay and SVG export therefore receive byte-identical quantized geometry.
 */

import {
  isStudioDynamicBrushCausalDepositPipeline,
  type NormalizedStudioBrushDynamicsSettings,
  type StudioDynamicBrushDab,
  type StudioDynamicBrushSegmentStartFrame,
} from "./brush/studio-brush-dynamics";

import type { StudioBrushTipAlphaMap } from "./brush/studio-brush-tip-stamp";
import type { StudioDynamicBrushMaterialIdentity } from "./brush/studio-dry-media-dynamic-bridge";

export const STUDIO_COMPETITOR_SPECIALTY_RIBBON_CARRIER_VERSION =
  "competitor-specialty-ribbon-carrier-v1" as const;
export const STUDIO_COMPETITOR_SPECIALTY_RIBBON_MAX_STATIONS = 1_048_576;
export const STUDIO_COMPETITOR_SPECIALTY_RIBBON_MAX_CONTOURS = 1_048_576;

export const STUDIO_COMPETITOR_SPECIALTY_RIBBON_CATALOG_IDS = Object.freeze([
  "hard-airbrush",
  "erodible-pencil",
  "paint-tube",
  "tangent-normal-brush",
] as const);

export type StudioCompetitorSpecialtyRibbonCatalogId =
  (typeof STUDIO_COMPETITOR_SPECIALTY_RIBBON_CATALOG_IDS)[number];

export type StudioCompetitorSpecialtyRibbonSemanticProfile =
  | "hard-airbrush-envelope"
  | "progressive-erodible-tip"
  | "extruded-paint-bead"
  | "tangent-normal-vector";

export type StudioCompetitorSpecialtyRibbonContourRole =
  | "body"
  | "highlight"
  | "shadow";

export interface StudioCompetitorSpecialtyRibbonContourStyle {
  readonly role: StudioCompetitorSpecialtyRibbonContourRole;
  readonly color: string;
  readonly alphaMultiplier: number;
}

export interface StudioCompetitorSpecialtyRibbonPolygon {
  readonly kind: "competitor-specialty-ribbon-polygon";
  readonly version: typeof STUDIO_COMPETITOR_SPECIALTY_RIBBON_CARRIER_VERSION;
  readonly role: "stroke-union";
  readonly semanticProfile: StudioCompetitorSpecialtyRibbonSemanticProfile;
  /**
   * Quantized `[x0,y0,x1,y1,…]` contours. Paint-tube grooves use opposite winding so Canvas and
   * SVG cut them from the outer bead without introducing transparent circular stamps.
   */
  readonly polygons: readonly (readonly number[])[];
  /** Present only when each contour is intentionally painted as a separate relief layer. */
  readonly contourStyles?: readonly StudioCompetitorSpecialtyRibbonContourStyle[];
}

export interface StudioCompetitorSpecialtyRibbonSourceMark {
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

export interface StudioCompetitorSpecialtyRibbonCoverageMark
  extends Omit<
    StudioCompetitorSpecialtyRibbonSourceMark,
    "falloff" | "texture"
  > {
  readonly ribbon: StudioCompetitorSpecialtyRibbonPolygon;
}

export type StudioCompetitorSpecialtyRibbonPlanResult =
  | Readonly<{
      readonly applied: true;
      readonly catalogId: StudioCompetitorSpecialtyRibbonCatalogId;
      readonly semanticProfile: StudioCompetitorSpecialtyRibbonSemanticProfile;
      readonly marks: readonly StudioCompetitorSpecialtyRibbonCoverageMark[];
    }>
  | Readonly<{
      readonly applied: false;
      readonly reason:
        | "contour-budget"
        | "ineligible-material"
        | "invalid-geometry"
        | "mark-dab-mismatch"
        | "station-budget";
      readonly marks: readonly StudioCompetitorSpecialtyRibbonSourceMark[];
    }>;

interface SpecialtyProfile {
  readonly semanticProfile: StudioCompetitorSpecialtyRibbonSemanticProfile;
  readonly spanScale: number;
  readonly tapLengthRatio: number;
  readonly contourCount: number;
}

interface StationGeometry {
  readonly x: number;
  readonly y: number;
  readonly tangentX: number;
  readonly tangentY: number;
  readonly normalX: number;
  readonly normalY: number;
  readonly halfSpan: number;
  readonly stationIndex: number;
  readonly directionDegrees: number;
  readonly distanceFromStrokeStart: number;
  readonly contactLoadFromStrokeStart: number;
  readonly contactFactor: number;
  readonly wearScale: number;
}

const PROFILE_BY_ID: Readonly<
  Record<StudioCompetitorSpecialtyRibbonCatalogId, SpecialtyProfile>
> = Object.freeze({
  "hard-airbrush": Object.freeze({
    semanticProfile: "hard-airbrush-envelope",
    spanScale: 1,
    tapLengthRatio: 0.48,
    contourCount: 1,
  }),
  "erodible-pencil": Object.freeze({
    semanticProfile: "progressive-erodible-tip",
    spanScale: 1,
    tapLengthRatio: 0.52,
    contourCount: 1,
  }),
  "paint-tube": Object.freeze({
    semanticProfile: "extruded-paint-bead",
    spanScale: 1.08,
    tapLengthRatio: 0.52,
    contourCount: 3,
  }),
  "tangent-normal-brush": Object.freeze({
    semanticProfile: "tangent-normal-vector",
    spanScale: 1,
    tapLengthRatio: 0.46,
    contourCount: 1,
  }),
});

const ELIGIBLE_ID_SET = new Set<string>(
  STUDIO_COMPETITOR_SPECIALTY_RIBBON_CATALOG_IDS,
);
const COORDINATE_LIMIT = 1_000_000_000;
const GEOMETRY_QUANTIZATION = 10_000;
const POINT_EPSILON = 1e-6;
const TAU = Math.PI * 2;

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

function signedArea(points: readonly number[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 2) {
    const next = (index + 2) % points.length;
    area += points[index]! * points[next + 1]!
      - points[next]! * points[index + 1]!;
  }
  return area / 2;
}

function withWinding(
  points: readonly number[],
  winding: "counter-clockwise" | "clockwise",
): readonly number[] {
  const quantized = points.map(quantize);
  const clockwise = signedArea(quantized) < 0;
  if (
    (winding === "clockwise" && clockwise)
    || (winding === "counter-clockwise" && !clockwise)
  ) {
    return Object.freeze(quantized);
  }
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
  return withWinding(
    [...lower.slice(0, -1), ...upper.slice(0, -1)]
      .flatMap(([x, y]) => [x, y]),
    "counter-clockwise",
  );
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

function validMark(mark: StudioCompetitorSpecialtyRibbonSourceMark): boolean {
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

function resolvedCatalogId(
  materialIdentity: StudioDynamicBrushMaterialIdentity | undefined,
): StudioCompetitorSpecialtyRibbonCatalogId | null {
  const brushId = materialIdentity?.brushId;
  const catalogId = materialIdentity?.brushCatalogId;
  return typeof brushId === "string"
    && brushId === catalogId
    && ELIGIBLE_ID_SET.has(brushId)
    ? brushId as StudioCompetitorSpecialtyRibbonCatalogId
    : null;
}

export function studioCompetitorSpecialtyRibbonCarrierOwnsMaterial(
  materialIdentity: StudioDynamicBrushMaterialIdentity | undefined,
  dynamics?: NormalizedStudioBrushDynamicsSettings,
): boolean {
  return resolvedCatalogId(materialIdentity) !== null
    && (
      dynamics === undefined
      || isStudioDynamicBrushCausalDepositPipeline(dynamics.depositPipeline)
    );
}

export function studioCompetitorSpecialtyRibbonCarrierWorkMultiplier(
  materialIdentity: StudioDynamicBrushMaterialIdentity | undefined,
  dynamics?: NormalizedStudioBrushDynamicsSettings,
): number {
  const catalogId = resolvedCatalogId(materialIdentity);
  return catalogId
    && studioCompetitorSpecialtyRibbonCarrierOwnsMaterial(
      materialIdentity,
      dynamics,
    )
    ? PROFILE_BY_ID[catalogId].contourCount
    : 1;
}

function erodibleWearScale(
  distanceFromStrokeStart: number,
  contactLoadFromStrokeStart: number,
): number {
  const distanceWear = 1 - Math.exp(
    -Math.max(0, distanceFromStrokeStart) / 760,
  );
  const contactWear = 1 - Math.exp(
    -Math.max(0, contactLoadFromStrokeStart) / 1_650,
  );
  return 1 - clamp(distanceWear * 0.12 + contactWear * 0.2, 0, 0.3);
}

function stationHalfSpan(
  baseHalfSpan: number,
  profile: SpecialtyProfile,
  wearScale: number,
): number {
  return Math.max(0.2, baseHalfSpan * profile.spanScale * wearScale);
}

function stationFromDab(
  catalogId: StudioCompetitorSpecialtyRibbonCatalogId,
  dab: StudioDynamicBrushDab,
  mark: StudioCompetitorSpecialtyRibbonSourceMark,
): Readonly<{
  readonly current: StationGeometry;
  readonly previous: StationGeometry | null;
  readonly travel: number;
}> | null {
  const travel = finite(dab.distanceFromPrevious, Number.NaN);
  if (
    !validMark(mark)
    || !Number.isSafeInteger(dab.index)
    || dab.index < 0
    || !Number.isFinite(dab.sourceX)
    || !Number.isFinite(dab.sourceY)
    || !Number.isFinite(travel)
    || travel < 0
  ) {
    return null;
  }
  const direction = finite(dab.direction, Number.NaN);
  if (travel > POINT_EPSILON && !Number.isFinite(direction)) return null;
  const directionDegrees = Number.isFinite(direction)
    ? direction
    : mark.angleRadians * 180 / Math.PI;
  const profile = PROFILE_BY_ID[catalogId];
  const contactFactor = finite(
    dab.contactFactor,
    Math.max(0, dab.size) * clamp(dab.opacity, 0, 1) * clamp(dab.flow, 0, 1),
  );
  const frame = dab.segmentStartFrame;
  const previousDistance = frame
    ? finite(
        frame.distanceFromStrokeStart,
        Math.max(0, dab.index - 1) * travel,
      )
    : 0;
  const previousContactFactor = frame
    ? finite(frame.contactFactor, contactFactor)
    : contactFactor;
  const previousContactLoad = frame
    ? finite(
        frame.contactLoadFromStrokeStart,
        previousDistance * previousContactFactor,
      )
    : 0;
  const distanceFromStrokeStart = finite(
    dab.distanceFromStrokeStart,
    previousDistance + travel,
  );
  const contactLoadFromStrokeStart = finite(
    dab.contactLoadFromStrokeStart,
    previousContactLoad
      + travel * (previousContactFactor + contactFactor) / 2,
  );
  const wearScale = catalogId === "erodible-pencil"
    ? erodibleWearScale(
        distanceFromStrokeStart,
        contactLoadFromStrokeStart,
      )
    : 1;
  const radians = directionDegrees * Math.PI / 180;
  const current: StationGeometry = Object.freeze({
    x: dab.sourceX,
    y: dab.sourceY,
    tangentX: Math.cos(radians),
    tangentY: Math.sin(radians),
    normalX: -Math.sin(radians),
    normalY: Math.cos(radians),
    halfSpan: stationHalfSpan(mark.radiusY, profile, wearScale),
    stationIndex: dab.index,
    directionDegrees,
    distanceFromStrokeStart,
    contactLoadFromStrokeStart,
    contactFactor,
    wearScale,
  });
  if (travel <= POINT_EPSILON) {
    return Object.freeze({ current, previous: null, travel });
  }
  if (!validFrame(frame)) return null;
  const previousRadians = frame.direction * Math.PI / 180;
  const previousWearScale = catalogId === "erodible-pencil"
    ? erodibleWearScale(previousDistance, previousContactLoad)
    : 1;
  const previous: StationGeometry = Object.freeze({
    x: frame.sourceX,
    y: frame.sourceY,
    tangentX: Math.cos(previousRadians),
    tangentY: Math.sin(previousRadians),
    normalX: -Math.sin(previousRadians),
    normalY: Math.cos(previousRadians),
    halfSpan: stationHalfSpan(
      frame.size / 2 * frame.roundness,
      profile,
      previousWearScale,
    ),
    stationIndex: frame.index,
    directionDegrees: frame.direction,
    distanceFromStrokeStart: previousDistance,
    contactLoadFromStrokeStart: previousContactLoad,
    contactFactor: previousContactFactor,
    wearScale: previousWearScale,
  });
  return Object.freeze({ current, previous, travel });
}

function intervalAt(
  catalogId: StudioCompetitorSpecialtyRibbonCatalogId,
  contourIndex: number,
  station: StationGeometry,
): readonly [number, number] {
  if (catalogId === "erodible-pencil") {
    const worn = 1 - station.wearScale;
    const center = Math.sin(
      station.distanceFromStrokeStart * 0.043 + 0.4,
    ) * (0.025 + worn * 0.1);
    const halfWidth = 0.96
      - worn * 0.12
      + Math.sin(
        station.distanceFromStrokeStart * 0.027 + 1.7,
      ) * 0.018;
    return Object.freeze([
      clamp(center - halfWidth, -1, 1),
      clamp(center + halfWidth, -1, 1),
    ]);
  }
  if (catalogId === "paint-tube" && contourIndex > 0) {
    const side = contourIndex === 1 ? -1 : 1;
    const center = side * (
      0.47
      + Math.sin(
        station.distanceFromStrokeStart * 0.031 + contourIndex * 1.3,
      ) * 0.025
    );
    const halfWidth = 0.045
      + (
        Math.sin(
          station.distanceFromStrokeStart * 0.023 + contourIndex * 0.8,
        ) + 1
      ) * 0.009;
    return Object.freeze([
      clamp(center - halfWidth, -0.82, 0.82),
      clamp(center + halfWidth, -0.82, 0.82),
    ]);
  }
  if (catalogId === "tangent-normal-brush") {
    return Object.freeze([-0.94, 0.94]);
  }
  return Object.freeze([-1, 1]);
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

function contourPolygon(
  catalogId: StudioCompetitorSpecialtyRibbonCatalogId,
  contourIndex: number,
  current: StationGeometry,
  previous: StationGeometry | null,
  tapLengthRatio: number,
): readonly number[] {
  const currentInterval = intervalAt(
    catalogId,
    contourIndex,
    current,
  );
  const winding = "counter-clockwise";
  if (!previous) {
    if (catalogId === "hard-airbrush" && contourIndex === 0) {
      const points: number[] = [];
      for (let index = 0; index < 16; index += 1) {
        const theta = index / 16 * TAU;
        points.push(
          ...pointAt(
            current,
            Math.sin(theta),
            Math.cos(theta) * current.halfSpan,
          ),
        );
      }
      return withWinding(points, winding);
    }
    const tapHalfLength = Math.max(
      0.2,
      current.halfSpan * tapLengthRatio,
    );
    const startLow = pointAt(current, currentInterval[0], -tapHalfLength);
    const endLow = pointAt(current, currentInterval[0], tapHalfLength);
    const endHigh = pointAt(current, currentInterval[1], tapHalfLength);
    const startHigh = pointAt(current, currentInterval[1], -tapHalfLength);
    return withWinding(
      [...startLow, ...endLow, ...endHigh, ...startHigh],
      winding,
    );
  }
  const previousInterval = intervalAt(
    catalogId,
    contourIndex,
    previous,
  );
  const outgoingPrevious: StationGeometry = Object.freeze({
    ...previous,
    tangentX: current.tangentX,
    tangentY: current.tangentY,
    normalX: current.normalX,
    normalY: current.normalY,
    directionDegrees: current.directionDegrees,
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
  // A bounded convex bevel joins the incoming and outgoing cross-sections without an unbounded
  // miter spike. A ~180° cusp remains a finite polygon and a straight segment collapses back to
  // the ordinary four-corner ribbon.
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
    radiusX: quantize(Math.max(0.2, (maxX - minX) / 2)),
    radiusY: quantize(Math.max(0.2, (maxY - minY) / 2)),
  });
}

function byteToHex(value: number): string {
  return Math.round(clamp(value, 0, 1) * 255)
    .toString(16)
    .padStart(2, "0");
}

function parsedHexColor(color: string): readonly [number, number, number] | null {
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color.trim());
  if (!match) return null;
  const value = match[1]!;
  const expanded = value.length === 3
    ? [...value].map((component) => component + component).join("")
    : value;
  return Object.freeze([
    Number.parseInt(expanded.slice(0, 2), 16) / 255,
    Number.parseInt(expanded.slice(2, 4), 16) / 255,
    Number.parseInt(expanded.slice(4, 6), 16) / 255,
  ]);
}

function shadeHexColor(
  color: string,
  target: "light" | "dark",
  amount: number,
): string {
  const parsed = parsedHexColor(color);
  if (!parsed) return target === "light" ? "#ffffff" : "#000000";
  const targetValue = target === "light" ? 1 : 0;
  const boundedAmount = clamp(amount, 0, 1);
  return `#${parsed.map((channel) => (
    byteToHex(channel + (targetValue - channel) * boundedAmount)
  )).join("")}`;
}

function paintTubeContourStyles(
  color: string,
): readonly StudioCompetitorSpecialtyRibbonContourStyle[] {
  return Object.freeze([
    Object.freeze({
      role: "body",
      color,
      alphaMultiplier: 1,
    }),
    Object.freeze({
      role: "highlight",
      color: shadeHexColor(color, "light", 0.62),
      alphaMultiplier: 0.58,
    }),
    Object.freeze({
      role: "shadow",
      color: shadeHexColor(color, "dark", 0.56),
      alphaMultiplier: 0.46,
    }),
  ]);
}

function tangentNormalColor(directionDegrees: number): string {
  const radians = finite(directionDegrees, 0) * Math.PI / 180;
  const planarStrength = 0.72;
  const x = Math.cos(radians) * planarStrength;
  const y = Math.sin(radians) * planarStrength;
  const z = Math.sqrt(Math.max(0, 1 - planarStrength * planarStrength));
  return `#${byteToHex(x * 0.5 + 0.5)}${
    byteToHex(y * 0.5 + 0.5)
  }${byteToHex(z * 0.5 + 0.5)}`;
}

function polygonsFor(
  catalogId: StudioCompetitorSpecialtyRibbonCatalogId,
  dab: StudioDynamicBrushDab,
  mark: StudioCompetitorSpecialtyRibbonSourceMark,
): Readonly<{
  readonly polygons: readonly (readonly number[])[];
  readonly directionDegrees: number;
}> | null {
  const profile = PROFILE_BY_ID[catalogId];
  const stations = stationFromDab(catalogId, dab, mark);
  if (!stations) return null;
  const polygons = Object.freeze(
    Array.from({ length: profile.contourCount }, (_, contourIndex) => (
      contourPolygon(
        catalogId,
        contourIndex,
        stations.current,
        stations.previous,
        profile.tapLengthRatio,
      )
    )),
  );
  return polygons.every((polygon) => polygon.length >= 6)
    ? Object.freeze({
        polygons,
        directionDegrees: stations.current.directionDegrees,
      })
    : null;
}

export function planStudioCompetitorSpecialtyRibbonCarrier(
  input: Readonly<{
    readonly dabs: readonly StudioDynamicBrushDab[];
    readonly marks: readonly StudioCompetitorSpecialtyRibbonSourceMark[];
    readonly materialIdentity?: StudioDynamicBrushMaterialIdentity;
    readonly dynamics: NormalizedStudioBrushDynamicsSettings;
  }>,
): StudioCompetitorSpecialtyRibbonPlanResult {
  const catalogId = resolvedCatalogId(input.materialIdentity);
  if (
    !catalogId
    || !studioCompetitorSpecialtyRibbonCarrierOwnsMaterial(
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
  if (input.dabs.length > STUDIO_COMPETITOR_SPECIALTY_RIBBON_MAX_STATIONS) {
    return Object.freeze({
      applied: false,
      reason: "station-budget",
      marks: input.marks,
    });
  }
  if (
    input.dabs.length * PROFILE_BY_ID[catalogId].contourCount
    > STUDIO_COMPETITOR_SPECIALTY_RIBBON_MAX_CONTOURS
  ) {
    return Object.freeze({
      applied: false,
      reason: "contour-budget",
      marks: input.marks,
    });
  }
  const profile = PROFILE_BY_ID[catalogId];
  if (input.dabs.length === 0) {
    return Object.freeze({
      applied: true,
      catalogId,
      semanticProfile: profile.semanticProfile,
      marks: Object.freeze([]),
    });
  }
  const firstColor = input.marks[0]?.color;
  if (
    typeof firstColor !== "string"
    || (
      catalogId !== "tangent-normal-brush"
      && input.marks.some((mark) => mark.color !== firstColor)
    )
  ) {
    return Object.freeze({
      applied: false,
      reason: "invalid-geometry",
      marks: input.marks,
    });
  }
  const plannedByDab: Array<Readonly<{
    readonly polygons: readonly (readonly number[])[];
    readonly directionDegrees: number;
  }>> = [];
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
    plannedByDab.push(planned);
  }
  const polygons: Array<readonly number[]> = [];
  const contourStyles: StudioCompetitorSpecialtyRibbonContourStyle[] = [];
  if (catalogId === "paint-tube") {
    const styles = paintTubeContourStyles(firstColor);
    // Keep identical relief roles contiguous. Canvas and SVG can fill the complete body,
    // highlight and shadow unions once per role, so a retrace cannot compound one semantic layer.
    for (
      let contourIndex = 0;
      contourIndex < profile.contourCount;
      contourIndex += 1
    ) {
      for (const planned of plannedByDab) {
        polygons.push(planned.polygons[contourIndex]!);
        contourStyles.push(styles[contourIndex]!);
      }
    }
  } else if (catalogId === "tangent-normal-brush") {
    for (const planned of plannedByDab) {
      polygons.push(planned.polygons[0]!);
      contourStyles.push(Object.freeze({
        role: "body",
        color: tangentNormalColor(planned.directionDegrees),
        alphaMultiplier: 1,
      }));
    }
  } else {
    for (const planned of plannedByDab) polygons.push(...planned.polygons);
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
  const unionMark: StudioCompetitorSpecialtyRibbonCoverageMark = Object.freeze({
    ...bounds,
    angleRadians: 0,
    alpha: coverageAlpha,
    color: firstColor,
    ribbon: Object.freeze({
      kind: "competitor-specialty-ribbon-polygon",
      version: STUDIO_COMPETITOR_SPECIALTY_RIBBON_CARRIER_VERSION,
      role: "stroke-union",
      semanticProfile: profile.semanticProfile,
      polygons: Object.freeze(polygons),
      ...(contourStyles.length > 0
        ? { contourStyles: Object.freeze(contourStyles) }
        : {}),
    }),
  });
  return Object.freeze({
    applied: true,
    catalogId,
    semanticProfile: profile.semanticProfile,
    marks: Object.freeze([unionMark]),
  });
}
