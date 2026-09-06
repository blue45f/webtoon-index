/**
 * Prefix-stable wet-media fallback carrier.
 *
 * The physical wet-field backend is intentionally fail-closed while its product capability is
 * unavailable. New causal watercolor strokes still need an honest retained representation in the
 * meantime, but a row of radial circles exposes obvious beads on long strokes. This planner turns
 * the causal station pairs into connected, direction-following pigment ribbons instead.
 *
 * Geometry is renderer-neutral and quantized once here. Canvas and SVG consume the same polygon
 * coordinates, so export cannot silently substitute another brush. Existing legacy watercolor
 * documents never enter this module.
 */

import { hash2 } from "../studio-grain";

export const STUDIO_WET_RIBBON_CARRIER_VERSION = "wet-ribbon-carrier-v2" as const;

export const STUDIO_WET_RIBBON_FOOTPRINT_CAP_RANGE = Object.freeze({
  min: 1,
  max: 8_192,
});

export const DEFAULT_STUDIO_WET_RIBBON_MAX_FOOTPRINTS = 4_096;

const COORDINATE_LIMIT = 1_000_000;
const MIN_RADIUS = 0.05;
/**
 * Opacity levels a wash may resolve to — the stroke's tonal resolution.
 *
 * This was 32, and 32 is far too coarse for what a wash actually paints. The skirt bands leave the
 * material at roughly 0.03-0.09 alpha, so the whole bleed lived inside the first three rungs of the
 * ladder and quantised onto barely more than one value. Anything finer than a rung - the diffuse
 * falloff between bands, and any per-dab granulation a wet-texture program produces - was rounded
 * away before it could be painted. That is why 수묵 read as a flat film with a hard edge rather
 * than as pigment sitting in paper.
 *
 * Measured on a rendered 30px ink-wash curve, share of ink in the two most-occupied 8-bit luminance
 * levels (lower is richer) and the level entropy:
 *   32 -> 0.4805 / 2.959 bits (25 batches)      64  -> 0.3933 / 3.488 (49)
 *   128 -> 0.2837 / 3.915 (98)                  256 -> 0.2558 / 4.352 (195)
 * 128 is the knee: it removes 41% of the flatness for 4x the batches, while 256 buys a further 3%
 * for another doubling.
 *
 * The cost is real and is the reason the old value was low - batch count is the live/export budget,
 * and it scales linearly with this constant. It is spent deliberately: a wash whose entire bleed is
 * one tone is the defect, and no amount of longitudinal interpolation inside a station pair can add
 * a level the ladder cannot represent.
 */
export const STUDIO_WET_RIBBON_OPACITY_BUCKET_COUNT = 128;
const OPACITY_BUCKET_COUNT = STUDIO_WET_RIBBON_OPACITY_BUCKET_COUNT;
const GEOMETRY_QUANTIZATION = 10_000;
const POINT_EPSILON = 1e-6;
const TAU = Math.PI * 2;

export type StudioWetRibbonCarrierLayer =
  | "diffuse-outer"
  | "diffuse-middle"
  | "diffuse-inner"
  | "core";

export interface StudioWetRibbonSourceDab {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly opacity: number;
  readonly role: "core" | "diffuse";
}

export interface StudioWetRibbonPolygon {
  /** Flat, closed-by-renderer `[x0,y0,x1,y1,…]` polygon with at least three points. */
  readonly points: readonly number[];
  /**
   * Optional strip topology retained until adjacent superlevel regions are joined.
   *
   * Threshold clips can have a material-shaped, multi-point cross-section instead of a ruler-
   * straight edge. Keeping the two cross-sections explicit lets Canvas/SVG still receive one
   * continuous contour without reintroducing coincident station seams.
   */
  readonly strip?: {
    readonly startSection: readonly number[];
    readonly endSection: readonly number[];
    readonly directionX: number;
    readonly directionY: number;
  };
}

export interface StudioWetRibbonFootprintLayer {
  readonly layer: StudioWetRibbonCarrierLayer;
  /**
   * Quantized midpoint coverage retained for diagnostics and tap compatibility.
   *
   * Segment batches use the endpoint values below to interpolate coverage continuously along the
   * same quad. Keeping this midpoint avoids changing the public footprint summary while removing
   * the former station-wide opacity plateau.
   */
  readonly opacity: number;
  readonly startOpacity: number;
  readonly endOpacity: number;
  readonly polygon: StudioWetRibbonPolygon;
}

export interface StudioWetRibbonFootprint {
  readonly index: number;
  readonly kind: "tap" | "segment";
  readonly startX: number;
  readonly startY: number;
  readonly endX: number;
  readonly endY: number;
  readonly layers: readonly StudioWetRibbonFootprintLayer[];
}

export interface StudioWetRibbonCarrierBatch {
  readonly layer: StudioWetRibbonCarrierLayer;
  /**
   * Maximum stroke-local coverage represented after this batch is composited.
   *
   * Each batch contains the union of every polygon whose authored opacity reaches this threshold.
   * `opacity` is the source-over increment from the previous threshold, not the target itself.
   * That threshold decomposition makes a self-crossing converge to the stronger local coverage
   * instead of adding two station opacities. Separate DrawEl strokes still glaze normally when
   * their completed stroke-local surfaces are composited by the document renderer.
   */
  readonly coverageCeiling: number;
  readonly opacity: number;
  readonly polygons: readonly StudioWetRibbonPolygon[];
}

export interface StudioWetRibbonCarrierPlan {
  readonly version: typeof STUDIO_WET_RIBBON_CARRIER_VERSION;
  readonly sourceStationCount: number;
  readonly footprintCount: number;
  readonly polygonCount: number;
  readonly capped: boolean;
  readonly footprints: readonly StudioWetRibbonFootprint[];
  readonly batches: readonly StudioWetRibbonCarrierBatch[];
}

export interface StudioWetRibbonCarrierPlanOptions {
  readonly seed?: number;
  readonly maxFootprints?: number;
}

interface WetRibbonStation {
  x: number;
  y: number;
  coreRadius: number;
  coreOpacity: number;
  diffuseRadius: number;
  diffuseOpacity: number;
}

interface LayerEdge {
  leftX: number;
  leftY: number;
  rightX: number;
  rightY: number;
  directionX: number;
  directionY: number;
}

const LAYER_ORDER: readonly StudioWetRibbonCarrierLayer[] = [
  "diffuse-outer",
  "diffuse-middle",
  "diffuse-inner",
  "core",
];

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function quantize(value: number): number {
  return Math.round(
    clamp(value, -COORDINATE_LIMIT, COORDINATE_LIMIT) * GEOMETRY_QUANTIZATION,
  ) / GEOMETRY_QUANTIZATION;
}

function normalizeOpacity(value: unknown): number {
  return clamp(finite(value, 0), 0, 1);
}

function normalizeRadius(value: unknown): number {
  return clamp(finite(value, MIN_RADIUS), MIN_RADIUS, COORDINATE_LIMIT / 4);
}

function smoothCausalWetOpacity(
  previousOpacity: number | undefined,
  currentOpacity: number,
): number {
  const normalized = normalizeOpacity(currentOpacity);
  if (previousOpacity === undefined) return normalized;
  const delta = normalized - previousOpacity;
  const magnitude = Math.abs(delta);
  // A real pressure/load change must remain immediate. The causal watercolor planner's station
  // grain is at most a few hundredths, however, and rendering that raw noise as full-width bands
  // is an implementation artefact rather than useful paper texture. A one-sided response keeps
  // every existing prefix immutable while gently correlating only those small fluctuations.
  if (magnitude >= 0.16) return normalized;
  const response = 0.12 + (magnitude / 0.16) * 0.24;
  return normalizeOpacity(previousOpacity + delta * response);
}

function quantizeOpacity(value: number): number {
  const bucket = opacityBucket(value);
  return bucket / OPACITY_BUCKET_COUNT;
}

function opacityBucket(value: number): number {
  if (value <= 0) return 0;
  return Math.max(
    1,
    Math.min(OPACITY_BUCKET_COUNT, Math.round(clamp(value, 0, 1) * OPACITY_BUCKET_COUNT)),
  );
}

function normalizeOptions(
  options?: StudioWetRibbonCarrierPlanOptions | null,
): Required<StudioWetRibbonCarrierPlanOptions> {
  return {
    seed: Math.floor(clamp(finite(options?.seed, 1), 0, 9_999)),
    maxFootprints: Math.floor(clamp(
      finite(options?.maxFootprints, DEFAULT_STUDIO_WET_RIBBON_MAX_FOOTPRINTS),
      STUDIO_WET_RIBBON_FOOTPRINT_CAP_RANGE.min,
      STUDIO_WET_RIBBON_FOOTPRINT_CAP_RANGE.max,
    )),
  };
}

function collectStations(
  dabs: readonly StudioWetRibbonSourceDab[],
  maxFootprints: number,
): { stations: WetRibbonStation[]; capped: boolean } {
  const stations: WetRibbonStation[] = [];
  let capped = false;
  for (const dab of dabs) {
    if (dab.role === "diffuse") {
      const station = stations.at(-1);
      if (station) {
        station.diffuseRadius = Math.max(
          station.coreRadius * 1.08,
          normalizeRadius(dab.radius),
        );
        station.diffuseOpacity = smoothCausalWetOpacity(
          stations.at(-2)?.diffuseOpacity,
          normalizeOpacity(dab.opacity),
        );
      }
      continue;
    }
    if (
      typeof dab.x !== "number"
      || !Number.isFinite(dab.x)
      || typeof dab.y !== "number"
      || !Number.isFinite(dab.y)
    ) {
      continue;
    }
    if (stations.length >= maxFootprints) {
      capped = true;
      break;
    }
    const coreRadius = normalizeRadius(dab.radius);
    const coreOpacity = smoothCausalWetOpacity(
      stations.at(-1)?.coreOpacity,
      normalizeOpacity(dab.opacity),
    );
    stations.push({
      x: quantize(dab.x),
      y: quantize(dab.y),
      coreRadius,
      coreOpacity,
      diffuseRadius: coreRadius * 1.42,
      diffuseOpacity: coreOpacity * 0.24,
    });
  }
  return { stations, capped };
}

function layerHalfWidth(
  station: WetRibbonStation,
  layer: StudioWetRibbonCarrierLayer,
): number {
  switch (layer) {
    case "diffuse-outer":
      return station.diffuseRadius;
    case "diffuse-middle":
      return station.coreRadius
        + (station.diffuseRadius - station.coreRadius) * 0.72;
    case "diffuse-inner":
      return station.coreRadius
        + (station.diffuseRadius - station.coreRadius) * 0.42;
    case "core":
      return station.coreRadius;
  }
}

function layerOpacity(
  station: WetRibbonStation,
  layer: StudioWetRibbonCarrierLayer,
): number {
  switch (layer) {
    case "diffuse-outer":
      return station.diffuseOpacity * 0.24;
    case "diffuse-middle":
      return station.diffuseOpacity * 0.4;
    case "diffuse-inner":
      return station.diffuseOpacity * 0.62;
    case "core":
      return station.coreOpacity;
  }
}

function polygon(
  points: readonly number[],
  strip?: StudioWetRibbonPolygon["strip"],
): StudioWetRibbonPolygon {
  return Object.freeze({
    points: Object.freeze(points.map(quantize)),
    ...(strip
      ? {
          strip: Object.freeze({
            startSection: Object.freeze(strip.startSection.map(quantize)),
            endSection: Object.freeze(strip.endSection.map(quantize)),
            directionX: strip.directionX,
            directionY: strip.directionY,
          }),
        }
      : {}),
  });
}

function tapPolygon(
  station: WetRibbonStation,
  layer: StudioWetRibbonCarrierLayer,
  angle: number,
): StudioWetRibbonPolygon {
  const halfWidth = layerHalfWidth(station, layer);
  // A six-point directional leaf is intentionally anisotropic: even a tap cannot be mistaken for
  // the prohibited generic round-circle carrier.
  const axisRadius = halfWidth * 1.16;
  const crossRadius = halfWidth * 0.7;
  const directionX = Math.cos(angle);
  const directionY = Math.sin(angle);
  const normalX = -directionY;
  const normalY = directionX;
  const { x, y } = station;
  return polygon([
    x + directionX * axisRadius,
    y + directionY * axisRadius,
    x + directionX * axisRadius * 0.18 + normalX * crossRadius,
    y + directionY * axisRadius * 0.18 + normalY * crossRadius,
    x - directionX * axisRadius * 0.82 + normalX * crossRadius * 0.72,
    y - directionY * axisRadius * 0.82 + normalY * crossRadius * 0.72,
    x - directionX * axisRadius,
    y - directionY * axisRadius,
    x - directionX * axisRadius * 0.82 - normalX * crossRadius * 0.72,
    y - directionY * axisRadius * 0.82 - normalY * crossRadius * 0.72,
    x + directionX * axisRadius * 0.18 - normalX * crossRadius,
    y + directionY * axisRadius * 0.18 - normalY * crossRadius,
  ]);
}

function segmentPolygon(input: {
  start: WetRibbonStation;
  end: WetRibbonStation;
  layer: StudioWetRibbonCarrierLayer;
  previousEdge: LayerEdge | null;
}): { polygon: StudioWetRibbonPolygon; endEdge: LayerEdge } {
  const { start, end, layer, previousEdge } = input;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.max(POINT_EPSILON, Math.hypot(dx, dy));
  const directionX = dx / distance;
  const directionY = dy / distance;
  const normalX = -directionY;
  const normalY = directionX;
  const startHalfWidth = layerHalfWidth(start, layer);
  const endHalfWidth = layerHalfWidth(end, layer);
  const canReusePreviousEdge = previousEdge !== null
    && previousEdge.directionX * directionX
      + previousEdge.directionY * directionY > 0;
  const startLeftX = canReusePreviousEdge
    ? previousEdge.leftX
    : start.x + normalX * startHalfWidth;
  const startLeftY = canReusePreviousEdge
    ? previousEdge.leftY
    : start.y + normalY * startHalfWidth;
  const startRightX = canReusePreviousEdge
    ? previousEdge.rightX
    : start.x - normalX * startHalfWidth;
  const startRightY = canReusePreviousEdge
    ? previousEdge.rightY
    : start.y - normalY * startHalfWidth;
  const endEdge = {
    leftX: quantize(end.x + normalX * endHalfWidth),
    leftY: quantize(end.y + normalY * endHalfWidth),
    rightX: quantize(end.x - normalX * endHalfWidth),
    rightY: quantize(end.y - normalY * endHalfWidth),
    directionX,
    directionY,
  };
  return {
    polygon: polygon([
      startLeftX,
      startLeftY,
      endEdge.leftX,
      endEdge.leftY,
      endEdge.rightX,
      endEdge.rightY,
      startRightX,
      startRightY,
    ], {
      startSection: [
        startLeftX,
        startLeftY,
        startRightX,
        startRightY,
      ],
      endSection: [
        endEdge.leftX,
        endEdge.leftY,
        endEdge.rightX,
        endEdge.rightY,
      ],
      directionX,
      directionY,
    }),
    endEdge,
  };
}

function footprintLayer(
  layer: StudioWetRibbonCarrierLayer,
  startOpacity: number,
  endOpacity: number,
  footprintPolygon: StudioWetRibbonPolygon,
): StudioWetRibbonFootprintLayer {
  const normalizedStartOpacity = normalizeOpacity(startOpacity);
  const normalizedEndOpacity = normalizeOpacity(endOpacity);
  return Object.freeze({
    layer,
    opacity: quantizeOpacity(
      (normalizedStartOpacity + normalizedEndOpacity) * 0.5,
    ),
    startOpacity: normalizedStartOpacity,
    endOpacity: normalizedEndOpacity,
    polygon: footprintPolygon,
  });
}

function buildFootprints(
  stations: readonly WetRibbonStation[],
  seed: number,
): readonly StudioWetRibbonFootprint[] {
  const first = stations[0];
  if (!first) return [];

  const footprints: StudioWetRibbonFootprint[] = [];
  // A tap is provisional input geometry, not a permanent start cap. Once the pointer travels,
  // retaining it underneath the first ribbon creates the large circular start blob seen in live
  // watercolor strokes and applies pigment twice. A true click still gets the directional leaf.
  if (stations.length === 1) {
    const tapAngle = hash2(0, 73, seed) * TAU;
    footprints.push(Object.freeze({
      index: 0,
      kind: "tap",
      startX: first.x,
      startY: first.y,
      endX: first.x,
      endY: first.y,
      layers: Object.freeze(LAYER_ORDER.map((layer) => footprintLayer(
        layer,
        layerOpacity(first, layer),
        layerOpacity(first, layer),
        tapPolygon(first, layer, tapAngle),
      ))),
    }));
    return Object.freeze(footprints);
  }

  const previousEdges = new Map<StudioWetRibbonCarrierLayer, LayerEdge>();
  for (let stationIndex = 1; stationIndex < stations.length; stationIndex += 1) {
    const start = stations[stationIndex - 1]!;
    const end = stations[stationIndex]!;
    if (Math.hypot(end.x - start.x, end.y - start.y) <= POINT_EPSILON) continue;
    const layers = LAYER_ORDER.map((layer) => {
      const planned = segmentPolygon({
        start,
        end,
        layer,
        previousEdge: previousEdges.get(layer) ?? null,
      });
      previousEdges.set(layer, planned.endEdge);
      return footprintLayer(
        layer,
        layerOpacity(start, layer),
        layerOpacity(end, layer),
        planned.polygon,
      );
    });
    footprints.push(Object.freeze({
      index: footprints.length,
      kind: "segment",
      startX: start.x,
      startY: start.y,
      endX: end.x,
      endY: end.y,
      layers: Object.freeze(layers),
    }));
  }
  return Object.freeze(footprints);
}

function interpolatedPolygonPoint(
  points: readonly number[],
  startIndex: number,
  endIndex: number,
  progress: number,
): readonly [number, number] {
  const startX = points[startIndex]!;
  const startY = points[startIndex + 1]!;
  const endX = points[endIndex]!;
  const endY = points[endIndex + 1]!;
  return [
    startX + (endX - startX) * progress,
    startY + (endY - startY) * progress,
  ];
}

function reverseInteriorPointPairs(points: readonly number[]): readonly number[] {
  const reversed: number[] = [];
  for (let index = points.length - 4; index >= 2; index -= 2) {
    reversed.push(points[index]!, points[index + 1]!);
  }
  return reversed;
}

function coverageBoundarySection(
  deposit: StudioWetRibbonFootprintLayer,
  progress: number,
): readonly number[] {
  const points = deposit.polygon.points;
  const startCenterX = (points[0]! + points[6]!) * 0.5;
  const startCenterY = (points[1]! + points[7]!) * 0.5;
  const endCenterX = (points[2]! + points[4]!) * 0.5;
  const endCenterY = (points[3]! + points[5]!) * 0.5;
  const segmentLength = Math.hypot(
    endCenterX - startCenterX,
    endCenterY - startCenterY,
  );
  if (segmentLength <= POINT_EPSILON) {
    return [
      ...interpolatedPolygonPoint(points, 0, 2, progress),
      ...interpolatedPolygonPoint(points, 6, 4, progress),
    ];
  }

  /*
   * A two-point threshold edge exposes a ruler-straight crossbar across the full wash width. Shape
   * the boundary as a shallow deterministic S-curve sampled across the nib instead. The progress
   * displacement is zero on the centreline (authored pressure remains exact there), bounded to
   * 3.2px longitudinally, and tapers to zero at either station. For every transverse sample,
   * `p + A sin(πp) profile` stays monotonic because A <= .34 and |profile| <= .62, so higher
   * coverage regions remain nested and stroke-local max coverage cannot become additive pigment.
   */
  const layerSalt = LAYER_ORDER.indexOf(deposit.layer) + 1;
  const orientation = hash2(
    Math.round(startCenterX * 64),
    Math.round(startCenterY * 64),
    layerSalt * 977,
  ) < 0.5 ? -1 : 1;
  const maximumProgressOffset = Math.min(0.34, 5.2 / segmentLength);
  const stationTaper = Math.sin(Math.PI * progress);
  const sampleCount = 7;
  const section: number[] = [];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const transverse = sample / (sampleCount - 1);
    const materialProfile = (transverse * 2 - 1) * 0.62
      + Math.sin(transverse * TAU) * 0.38;
    const localProgress = clamp(
      progress
        + orientation
          * maximumProgressOffset
          * stationTaper
          * materialProfile,
      0,
      1,
    );
    const leftToRight = interpolatedPolygonPoint(
      points,
      0,
      6,
      transverse,
    );
    const leftToRightEnd = interpolatedPolygonPoint(
      points,
      2,
      4,
      transverse,
    );
    section.push(
      leftToRight[0] + (leftToRightEnd[0] - leftToRight[0]) * localProgress,
      leftToRight[1] + (leftToRightEnd[1] - leftToRight[1]) * localProgress,
    );
  }
  return section;
}

/**
 * Returns the linear-opacity superlevel region of one footprint.
 *
 * Segment polygons are ordered `[startLeft,endLeft,endRight,startRight]`. Clipping their two long
 * edges at a fixed coverage threshold preserves the exact shared station edge while distributing
 * opacity changes across the segment instead of painting one flat station-wide band. Tap leaves
 * have equal endpoint opacity and therefore remain unchanged.
 */
function clipFootprintLayerAtCoverage(
  deposit: StudioWetRibbonFootprintLayer,
  coverageThreshold: number,
): StudioWetRibbonPolygon | null {
  const threshold = clamp(coverageThreshold, 0, 1);
  const includes = threshold <= 0
    ? (opacity: number) => opacity > 0
    : (opacity: number) => opacity >= threshold;
  const includesStart = includes(deposit.startOpacity);
  const includesEnd = includes(deposit.endOpacity);
  if (includesStart && includesEnd) return deposit.polygon;
  if (!includesStart && !includesEnd) return null;

  // Only segment quads can have different endpoint coverage. A malformed/custom footprint fails
  // closed rather than inventing geometry that Canvas and SVG could interpret differently.
  if (deposit.polygon.points.length !== 8) return null;
  const denominator = deposit.endOpacity - deposit.startOpacity;
  if (Math.abs(denominator) <= POINT_EPSILON) return null;
  const progress = clamp(
    (threshold - deposit.startOpacity) / denominator,
    0,
    1,
  );
  const boundarySection = coverageBoundarySection(deposit, progress);
  const boundaryLeft = boundarySection.slice(0, 2);
  const boundaryRight = boundarySection.slice(-2);
  const strip = deposit.polygon.strip;
  if (!strip) return null;
  if (includesStart) {
    return polygon([
      deposit.polygon.points[0]!,
      deposit.polygon.points[1]!,
      ...boundarySection,
      deposit.polygon.points[6]!,
      deposit.polygon.points[7]!,
    ], {
      startSection: strip.startSection,
      endSection: boundarySection,
      directionX: strip.directionX,
      directionY: strip.directionY,
    });
  }
  return polygon([
    ...boundaryLeft,
    deposit.polygon.points[2]!,
    deposit.polygon.points[3]!,
    deposit.polygon.points[4]!,
    deposit.polygon.points[5]!,
    ...boundaryRight,
    ...reverseInteriorPointPairs(boundarySection),
  ], {
    startSection: boundarySection,
    endSection: strip.endSection,
    directionX: strip.directionX,
    directionY: strip.directionY,
  });
}

/**
 * Threshold of one rung of the fixed coverage ladder.
 *
 * Nearest-bucket coverage changes at half-bucket thresholds. The first non-zero bucket deliberately
 * starts immediately above zero so tiny but authored pigment is not erased.
 */
function coverageThresholdForBucket(coverageBucket: number): number {
  return coverageBucket === 1
    ? 0
    : (coverageBucket - 0.5) / OPACITY_BUCKET_COUNT;
}

/**
 * Highest ladder rung whose `clipFootprintLayerAtCoverage` inclusion test still accepts `opacity`.
 *
 * `includes` is `opacity > 0` on rung 1 and `opacity >= (bucket - 0.5) / COUNT` above it, and the
 * rung thresholds are strictly increasing, so the test is a monotone step in `coverageBucket`. The
 * closed-form guess is only a seed: both adjustment walks re-evaluate the *same* comparison the
 * per-bucket scan used, so a float landing exactly on a rung boundary resolves identically to the
 * scan it replaces. Returns 0 when no rung includes the value.
 */
function highestIncludingCoverageBucket(
  opacity: number,
  maximumCoverageBucket: number,
): number {
  if (maximumCoverageBucket < 1 || !(opacity > 0)) return 0;
  let coverageBucket = Math.min(
    maximumCoverageBucket,
    Math.max(1, Math.floor(opacity * OPACITY_BUCKET_COUNT + 0.5)),
  );
  while (
    coverageBucket > 1
    && !(opacity >= coverageThresholdForBucket(coverageBucket))
  ) {
    coverageBucket -= 1;
  }
  while (
    coverageBucket < maximumCoverageBucket
    && opacity >= coverageThresholdForBucket(coverageBucket + 1)
  ) {
    coverageBucket += 1;
  }
  return coverageBucket;
}

/**
 * Groups every deposit onto the coverage ladder in one pass instead of rescanning all deposits once
 * per rung.
 *
 * The previous shape was `layers x rungs x deposits` clip attempts — with a 4096-footprint cap and
 * a 128-rung ladder that is millions of inclusion tests per pointer move, the overwhelming majority
 * of which returned `null` or the deposit's own unclipped polygon. Because the inclusion test is
 * monotone in the rung index, each deposit's rung span is two integers: rungs `1..fullBucket` take
 * the unclipped polygon (the identical frozen reference the scan returned), rungs
 * `fullBucket+1..anyBucket` take the real threshold clip at the identical threshold, and rungs
 * above `anyBucket` were exactly the ones the scan discarded.
 *
 * Output order is unchanged, which is load-bearing: these polygons composite translucently, so
 * reordering them within a batch would change pixels. Deposits are appended to each rung's list in
 * deposit order and the rungs are emitted in ascending order per layer — the same traversal order
 * the nested scan produced.
 */
function buildBatches(
  footprints: readonly StudioWetRibbonFootprint[],
): readonly StudioWetRibbonCarrierBatch[] {
  const batches: StudioWetRibbonCarrierBatch[] = [];
  for (const layer of LAYER_ORDER) {
    // One pass instead of flatMap plus reduce: the same first-match-per-footprint selection, the
    // same filter, the same left-to-right `Math.max` fold, without a throwaway array per footprint.
    const deposits: StudioWetRibbonFootprintLayer[] = [];
    let maximumCoverageBucket = 0;
    for (const footprint of footprints) {
      const planned = footprint.layers.find(
        (candidate) => candidate.layer === layer,
      );
      if (!planned) continue;
      const depositCeiling = Math.max(planned.startOpacity, planned.endOpacity);
      if (!(depositCeiling > 0)) continue;
      deposits.push(planned);
      maximumCoverageBucket = Math.max(
        maximumCoverageBucket,
        opacityBucket(depositCeiling),
      );
    }
    if (maximumCoverageBucket < 1) continue;

    /*
     * If A is the coverage after the previous pass and T is the next target, source-over needs
     * source alpha `(T - A) / (1 - A)` to land exactly on T. Every polygon at or above T is
     * traced into one compound path, so overlap inside this same threshold is a geometric union
     * rather than another alpha deposit. The complete fixed threshold ladder is important:
     * a later input suffix cannot insert a new intermediate pass and subtly re-antialias pixels
     * that were already visible. Repeating it therefore evaluates to max(local authored
     * opacity), not the sum of crossing station opacities, while remaining causal-prefix stable.
     *
     * The ladder is walked first, in the same ascending order, so each rung's increment is the
     * identical float the sequential accumulator produced. A rung whose increment is not positive
     * is left without a polygon list, which is what suppressed both its clips and its batch before.
     */
    const rungOpacities = new Array<number>(maximumCoverageBucket + 1).fill(0);
    const rungPolygons = new Array<StudioWetRibbonPolygon[] | null>(
      maximumCoverageBucket + 1,
    ).fill(null);
    let previousCeiling = 0;
    for (
      let coverageBucket = 1;
      coverageBucket <= maximumCoverageBucket;
      coverageBucket += 1
    ) {
      const coverageCeiling = coverageBucket / OPACITY_BUCKET_COUNT;
      const opacity = previousCeiling >= 1
        ? 0
        : clamp(
            (coverageCeiling - previousCeiling) / (1 - previousCeiling),
            0,
            1,
          );
      rungOpacities[coverageBucket] = opacity;
      if (opacity > 0) rungPolygons[coverageBucket] = [];
      previousCeiling = coverageCeiling;
    }

    for (const deposit of deposits) {
      // `includesStart && includesEnd` is `includes(min)` and `includesStart || includesEnd` is
      // `includes(max)`, because the inclusion test is a threshold comparison on each endpoint.
      const fullBucket = highestIncludingCoverageBucket(
        Math.min(deposit.startOpacity, deposit.endOpacity),
        maximumCoverageBucket,
      );
      const anyBucket = highestIncludingCoverageBucket(
        Math.max(deposit.startOpacity, deposit.endOpacity),
        maximumCoverageBucket,
      );
      for (
        let coverageBucket = 1;
        coverageBucket <= fullBucket;
        coverageBucket += 1
      ) {
        rungPolygons[coverageBucket]?.push(deposit.polygon);
      }
      for (
        let coverageBucket = fullBucket + 1;
        coverageBucket <= anyBucket;
        coverageBucket += 1
      ) {
        const polygons = rungPolygons[coverageBucket];
        if (!polygons) continue;
        // Mixed-inclusion rungs still take the real clip, including its fail-closed rejections.
        const clipped = clipFootprintLayerAtCoverage(
          deposit,
          coverageThresholdForBucket(coverageBucket),
        );
        if (clipped) polygons.push(clipped);
      }
    }

    for (
      let coverageBucket = 1;
      coverageBucket <= maximumCoverageBucket;
      coverageBucket += 1
    ) {
      const polygons = rungPolygons[coverageBucket];
      if (!polygons) continue;
      batches.push(Object.freeze({
        layer,
        coverageCeiling: coverageBucket / OPACITY_BUCKET_COUNT,
        opacity: rungOpacities[coverageBucket]!,
        polygons: Object.freeze(polygons),
      }));
    }
  }
  return Object.freeze(batches);
}

export function planStudioWetRibbonCarrier(
  dabs: readonly StudioWetRibbonSourceDab[],
  options?: StudioWetRibbonCarrierPlanOptions | null,
): StudioWetRibbonCarrierPlan {
  const normalized = normalizeOptions(options);
  const collected = collectStations(
    Array.isArray(dabs) ? dabs : [],
    normalized.maxFootprints,
  );
  const footprints = buildFootprints(collected.stations, normalized.seed);
  const batches = buildBatches(footprints);
  return Object.freeze({
    version: STUDIO_WET_RIBBON_CARRIER_VERSION,
    sourceStationCount: collected.stations.length,
    footprintCount: footprints.length,
    polygonCount: footprints.reduce((sum, footprint) => sum + footprint.layers.length, 0),
    capped: collected.capped,
    footprints,
    batches,
  });
}

export interface StudioIncrementalWetRibbonCarrier {
  /**
   * 배치 `planStudioWetRibbonCarrier`와 값이 정확히 같은 플랜을 돌려주되, 안정 prefix 구간의
   * 스테이션·풋프린트·사다리 칸(rung) 폴리곤을 호출 사이에 유지해 이동당 비용을 새 표본 수에만 비례시킨다.
   *
   * `stableDabCount`는 상류 증분 플래너가 보증하는 append 전용 prefix 길이이고,
   * `sourceGeneration`은 그 보증이 깨질 때(되돌리기·재작성·설정 변경) 증가하는 세대 카운터다 —
   * 세대가 바뀌면 여기서도 전체를 다시 만든다. 반환 플랜의 `footprints`와 각 batch 의
   * `polygons`는 내부 보관 배열을 그대로 노출하므로 수정하면 안 되고, 다음 `plan()` 호출까지만
   * 유효하다(휘발 꼬리는 다음 호출에서 걷어내고 다시 단다).
   */
  plan(
    dabs: readonly StudioWetRibbonSourceDab[],
    stableDabCount: number,
    sourceGeneration: number,
    options?: StudioWetRibbonCarrierPlanOptions | null,
  ): StudioWetRibbonCarrierPlan;
}

interface IncrementalCarrierLaneState {
  /** 사다리 칸(rung)(커버리지 사다리 칸)별 폴리곤 목록 — 인덱스 1..OPACITY_BUCKET_COUNT 사용. */
  readonly rungPolygons: StudioWetRibbonPolygon[][];
  readonly rungStableCounts: number[];
  stableMaxBucket: number;
  volatileMaxBucket: number;
}

/**
 * 증분 습식 리본 캐리어.
 *
 * 배치 플래너의 세 단계는 모두 앞으로만 흐르는 상태를 가진다: `collectStations`는 마지막
 * 스테이션만 소급 변형하고(디퓨즈 dab), `buildFootprints`의 `previousEdges`는 직전 세그먼트의
 * 끝단만 참조하며, `buildBatches`의 사다리 칸(rung) 소속은 예치물 자신의 불투명도와 레이어 최대 버킷의
 * `min` 으로만 정해진다. 그래서 (1) 마지막 안정 스테이션 스냅샷 복원 → 새 안정 dab 순차 소비,
 * (2) 안정 풋프린트는 끝 스테이션이 확정된 쌍까지만 유지, (3) 사다리 칸(rung) 배열은 상한 없이(캡 128)
 * 소속을 미리 계산해 두고 방출 시 레이어 최대 버킷까지만 자르면, 각 호출의 결과가 같은 입력의
 * 배치 플랜과 값으로 완전히 일치한다(같은 헬퍼를 같은 순서로 호출하므로 부동소수점까지 동일).
 */
export function createStudioIncrementalWetRibbonCarrier(): StudioIncrementalWetRibbonCarrier {
  let generation: number | null = null;
  let seed = 0;
  let maxFootprints = 0;

  const stations: WetRibbonStation[] = [];
  let consumedDabs = 0;
  let stableStationCount = 0;
  let stableLastStationSnapshot: WetRibbonStation | null = null;
  /** 캡 초과 코어 dab 을 만나 배치 루프가 `break` 한 상태 — 이후 dab 은 영원히 무시된다. */
  let stableStopped = false;
  let stableCapped = false;

  const footprints: StudioWetRibbonFootprint[] = [];
  let stableFootprintCount = 0;
  let stablePolygonSum = 0;
  /** 다음에 방출할 안정 세그먼트 쌍의 끝 스테이션 인덱스. */
  let stableNextEnd = 1;
  const stableEdges = new Map<StudioWetRibbonCarrierLayer, LayerEdge>();

  const lanes: IncrementalCarrierLaneState[] = LAYER_ORDER.map(() => ({
    rungPolygons: Array.from(
      { length: OPACITY_BUCKET_COUNT + 1 },
      () => [] as StudioWetRibbonPolygon[],
    ),
    rungStableCounts: new Array<number>(OPACITY_BUCKET_COUNT + 1).fill(0),
    stableMaxBucket: 0,
    volatileMaxBucket: 0,
  }));

  const reset = (): void => {
    stations.length = 0;
    consumedDabs = 0;
    stableStationCount = 0;
    stableLastStationSnapshot = null;
    stableStopped = false;
    stableCapped = false;
    footprints.length = 0;
    stableFootprintCount = 0;
    stablePolygonSum = 0;
    stableNextEnd = 1;
    stableEdges.clear();
    for (const lane of lanes) {
      for (let bucket = 0; bucket <= OPACITY_BUCKET_COUNT; bucket += 1) {
        lane.rungPolygons[bucket]!.length = 0;
        lane.rungStableCounts[bucket] = 0;
      }
      lane.stableMaxBucket = 0;
      lane.volatileMaxBucket = 0;
    }
  };

  /** `collectStations` 루프 본문 한 dab 분. `true` = 캡 초과 코어 dab(배치의 `break`). */
  const consumeDab = (dab: StudioWetRibbonSourceDab): boolean => {
    if (dab.role === "diffuse") {
      const station = stations.at(-1);
      if (station) {
        station.diffuseRadius = Math.max(
          station.coreRadius * 1.08,
          normalizeRadius(dab.radius),
        );
        station.diffuseOpacity = smoothCausalWetOpacity(
          stations.at(-2)?.diffuseOpacity,
          normalizeOpacity(dab.opacity),
        );
      }
      return false;
    }
    if (
      typeof dab.x !== "number"
      || !Number.isFinite(dab.x)
      || typeof dab.y !== "number"
      || !Number.isFinite(dab.y)
    ) {
      return false;
    }
    if (stations.length >= maxFootprints) return true;
    const coreRadius = normalizeRadius(dab.radius);
    const coreOpacity = smoothCausalWetOpacity(
      stations.at(-1)?.coreOpacity,
      normalizeOpacity(dab.opacity),
    );
    stations.push({
      x: quantize(dab.x),
      y: quantize(dab.y),
      coreRadius,
      coreOpacity,
      diffuseRadius: coreRadius * 1.42,
      diffuseOpacity: coreOpacity * 0.24,
    });
    return false;
  };

  /**
   * `buildBatches`의 예치 스캔 한 풋프린트 분. 사다리 칸(rung) 소속은 캡 128 로 계산해 보관한다 —
   * `highestIncludingCoverageBucket`은 캡에 대해 `min(무캡 결과, 캡)` 이므로, 방출 시 레이어
   * 최대 버킷 `M` 까지만 노출하면 사다리 칸(rung) `b <= M` 의 내용이 배치 계산과 정확히 같다.
   */
  const pushFootprintDeposits = (
    footprint: StudioWetRibbonFootprint,
    stable: boolean,
  ): void => {
    for (let layerIndex = 0; layerIndex < LAYER_ORDER.length; layerIndex += 1) {
      const deposit = footprint.layers[layerIndex]!;
      const depositCeiling = Math.max(deposit.startOpacity, deposit.endOpacity);
      if (!(depositCeiling > 0)) continue;
      const lane = lanes[layerIndex]!;
      const fullBucket = highestIncludingCoverageBucket(
        Math.min(deposit.startOpacity, deposit.endOpacity),
        OPACITY_BUCKET_COUNT,
      );
      const anyBucket = highestIncludingCoverageBucket(
        depositCeiling,
        OPACITY_BUCKET_COUNT,
      );
      for (let bucket = 1; bucket <= fullBucket; bucket += 1) {
        lane.rungPolygons[bucket]!.push(deposit.polygon);
      }
      for (let bucket = fullBucket + 1; bucket <= anyBucket; bucket += 1) {
        const clipped = clipFootprintLayerAtCoverage(
          deposit,
          coverageThresholdForBucket(bucket),
        );
        if (clipped) lane.rungPolygons[bucket]!.push(clipped);
      }
      const ceilingBucket = opacityBucket(depositCeiling);
      if (stable) {
        lane.stableMaxBucket = Math.max(lane.stableMaxBucket, ceilingBucket);
      } else {
        lane.volatileMaxBucket = Math.max(lane.volatileMaxBucket, ceilingBucket);
      }
    }
  };

  /** `buildFootprints` 세그먼트 루프 본문 한 쌍 분(끝 스테이션 `endIndex`). */
  const emitSegmentPair = (
    endIndex: number,
    edges: Map<StudioWetRibbonCarrierLayer, LayerEdge>,
    stable: boolean,
  ): number => {
    const start = stations[endIndex - 1]!;
    const end = stations[endIndex]!;
    if (Math.hypot(end.x - start.x, end.y - start.y) <= POINT_EPSILON) return 0;
    const layers = LAYER_ORDER.map((layer) => {
      const planned = segmentPolygon({
        start,
        end,
        layer,
        previousEdge: edges.get(layer) ?? null,
      });
      edges.set(layer, planned.endEdge);
      return footprintLayer(
        layer,
        layerOpacity(start, layer),
        layerOpacity(end, layer),
        planned.polygon,
      );
    });
    const footprint = Object.freeze({
      index: footprints.length,
      kind: "segment" as const,
      startX: start.x,
      startY: start.y,
      endX: end.x,
      endY: end.y,
      layers: Object.freeze(layers),
    });
    footprints.push(footprint);
    pushFootprintDeposits(footprint, stable);
    return layers.length;
  };

  return {
    plan(dabs, stableDabCount, sourceGeneration, options) {
      const normalized = normalizeOptions(options);
      const sourceDabs = Array.isArray(dabs) ? dabs : [];
      const stableCount = Math.max(0, Math.min(stableDabCount, sourceDabs.length));
      if (
        generation !== sourceGeneration
        || seed !== normalized.seed
        || maxFootprints !== normalized.maxFootprints
        || stableCount < consumedDabs
      ) {
        reset();
        generation = sourceGeneration;
        seed = normalized.seed;
        maxFootprints = normalized.maxFootprints;
      }

      // 1. 휘발 오버레이 복원: 지난 호출의 꼬리 스테이션/풋프린트/사다리 칸(rung) 항목을 걷어내고,
      //    휘발 디퓨즈 dab 이 소급 변형했을 수 있는 마지막 안정 스테이션을 스냅샷으로 되돌린다.
      stations.length = stableStationCount;
      if (stableStationCount > 0 && stableLastStationSnapshot) {
        stations[stableStationCount - 1] = { ...stableLastStationSnapshot };
      }
      footprints.length = stableFootprintCount;
      let volatilePolygonSum = 0;
      for (const lane of lanes) {
        for (let bucket = 1; bucket <= OPACITY_BUCKET_COUNT; bucket += 1) {
          lane.rungPolygons[bucket]!.length = lane.rungStableCounts[bucket]!;
        }
        lane.volatileMaxBucket = 0;
      }

      // 2. 새 안정 dab 순차 소비 — 배치 `collectStations` 와 같은 배열 상태 위에서 같은 순서로
      //    걷기 때문에 결과 스테이션 값이 비트 동일하다.
      if (!stableStopped) {
        for (let index = consumedDabs; index < stableCount; index += 1) {
          if (consumeDab(sourceDabs[index]!)) {
            stableStopped = true;
            stableCapped = true;
            break;
          }
        }
      }
      consumedDabs = stableCount;
      stableStationCount = stations.length;

      // 3. 확정된 스테이션 쌍만 안정 풋프린트로 방출한다. 스테이션 i 는 다음 코어 dab(스테이션
      //    i+1)이 안정 구간에 존재해야 디퓨즈 소급 변형에서 벗어나므로, 끝 인덱스는
      //    stableStationCount - 2 까지다.
      for (
        let endIndex = stableNextEnd;
        endIndex <= stableStationCount - 2;
        endIndex += 1
      ) {
        stablePolygonSum += emitSegmentPair(endIndex, stableEdges, true);
      }
      stableNextEnd = Math.max(stableNextEnd, stableStationCount - 1);
      stableFootprintCount = footprints.length;
      for (const lane of lanes) {
        for (let bucket = 1; bucket <= OPACITY_BUCKET_COUNT; bucket += 1) {
          lane.rungStableCounts[bucket] = lane.rungPolygons[bucket]!.length;
        }
      }
      const lastStable = stations.at(-1);
      stableLastStationSnapshot = lastStable ? { ...lastStable } : null;

      // 4. 휘발 꼬리 재구축: 꼬리 dab → 꼬리 스테이션 → 꼬리 풋프린트/예치. 다음 호출이 1 에서
      //    걷어낸다.
      let volatileCapped = false;
      if (!stableStopped) {
        for (let index = stableCount; index < sourceDabs.length; index += 1) {
          if (consumeDab(sourceDabs[index]!)) {
            volatileCapped = true;
            break;
          }
        }
      }
      if (stations.length === 1) {
        // 배치의 탭 특례: 스테이션이 하나뿐일 때만 방향성 잎을 만든다. 항상 휘발로 다뤄
        // 두 번째 스테이션이 생기는 순간 자연히 사라진다(탭→세그먼트 전이 재구축 불필요).
        const first = stations[0]!;
        const tapAngle = hash2(0, 73, seed) * TAU;
        const tap = Object.freeze({
          index: 0,
          kind: "tap" as const,
          startX: first.x,
          startY: first.y,
          endX: first.x,
          endY: first.y,
          layers: Object.freeze(LAYER_ORDER.map((layer) => footprintLayer(
            layer,
            layerOpacity(first, layer),
            layerOpacity(first, layer),
            tapPolygon(first, layer, tapAngle),
          ))),
        });
        footprints.push(tap);
        pushFootprintDeposits(tap, false);
        volatilePolygonSum += tap.layers.length;
      } else if (stations.length > 1) {
        const volatileEdges = new Map(stableEdges);
        for (
          let endIndex = Math.max(1, stableStationCount - 1);
          endIndex <= stations.length - 1;
          endIndex += 1
        ) {
          volatilePolygonSum += emitSegmentPair(endIndex, volatileEdges, false);
        }
      }

      // 5. 래퍼 방출 — 레이어별 최대 버킷까지 고정 사다리 공식으로 batch 객체만 새로 만든다
      //    (사다리 칸(rung) 수는 128 이하 상수라 이동당 비용이 스트로크 길이와 무관하다).
      const batches: StudioWetRibbonCarrierBatch[] = [];
      for (let layerIndex = 0; layerIndex < LAYER_ORDER.length; layerIndex += 1) {
        const lane = lanes[layerIndex]!;
        const maximumCoverageBucket = Math.max(
          lane.stableMaxBucket,
          lane.volatileMaxBucket,
        );
        if (maximumCoverageBucket < 1) continue;
        let previousCeiling = 0;
        for (
          let coverageBucket = 1;
          coverageBucket <= maximumCoverageBucket;
          coverageBucket += 1
        ) {
          const coverageCeiling = coverageBucket / OPACITY_BUCKET_COUNT;
          const opacity = previousCeiling >= 1
            ? 0
            : clamp(
                (coverageCeiling - previousCeiling) / (1 - previousCeiling),
                0,
                1,
              );
          if (opacity > 0) {
            batches.push({
              layer: LAYER_ORDER[layerIndex]!,
              coverageCeiling,
              opacity,
              polygons: lane.rungPolygons[coverageBucket]!,
            });
          }
          previousCeiling = coverageCeiling;
        }
      }

      return {
        version: STUDIO_WET_RIBBON_CARRIER_VERSION,
        sourceStationCount: stations.length,
        footprintCount: footprints.length,
        polygonCount: stablePolygonSum + volatilePolygonSum,
        capped: stableCapped || volatileCapped,
        footprints,
        batches,
      };
    },
  };
}

export interface StudioWetRibbonPathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
}

/**
 * Joins adjacent segment quads into one continuous strip before either renderer sees them.
 *
 * The planner deliberately retains one immutable footprint per causal station pair. Sending those
 * quads to Canvas as separate subpaths, however, makes the rasterizer antialias their coincident
 * station edges independently. At fractional zoom/DPR that leaks a pale transverse line at every
 * station — the conspicuous "vertical bands" seen in the real Studio ink-wash path. This linear
 * pass removes only those internal edges. Disconnected superlevel intervals and directional tap
 * leaves remain separate contours, and the underlying footprint/batch arrays stay prefix-stable.
 */
function continuousBatchContours(
  polygons: readonly StudioWetRibbonPolygon[],
): readonly StudioWetRibbonPolygon[] {
  const contours: StudioWetRibbonPolygon[] = [];
  let leftBoundary: number[] | null = null;
  let rightBoundary: number[] | null = null;
  let startSection: readonly number[] | null = null;
  let endSection: readonly number[] | null = null;
  let previousDirection: readonly [number, number] | null = null;

  const flush = () => {
    if (
      !leftBoundary
      || !rightBoundary
      || !startSection
      || !endSection
    ) return;
    const joined = [...leftBoundary];
    joined.push(...endSection.slice(2));
    for (
      let sourceIndex = rightBoundary.length - 4;
      sourceIndex >= 0;
      sourceIndex -= 2
    ) {
      joined.push(
        rightBoundary[sourceIndex]!,
        rightBoundary[sourceIndex + 1]!,
      );
    }
    for (
      let sourceIndex = startSection.length - 4;
      sourceIndex >= 2;
      sourceIndex -= 2
    ) {
      joined.push(
        startSection[sourceIndex]!,
        startSection[sourceIndex + 1]!,
      );
    }
    contours.push(polygon(joined));
    leftBoundary = null;
    rightBoundary = null;
    startSection = null;
    endSection = null;
    previousDirection = null;
  };

  for (const plannedPolygon of polygons) {
    const strip = plannedPolygon.strip;
    // Directional tap leaves and malformed/custom geometry keep their standalone representation.
    if (!strip) {
      flush();
      contours.push(plannedPolygon);
      continue;
    }
    const direction = [strip.directionX, strip.directionY] as const;
    const currentLeftBoundary = leftBoundary;
    const currentRightBoundary = rightBoundary;
    const connects = currentLeftBoundary !== null
      && currentRightBoundary !== null
      && endSection !== null
      && previousDirection !== null
      // A continuous strip may self-intersect safely, but folding the outline through an
      // anti-parallel U-turn reverses its winding and erases the retraced region under nonzero
      // fill. Start a new same-batch subpath at right-angle/reversal cusps. All segment quads have
      // the same winding, so their overlap still evaluates once at this batch alpha.
      && previousDirection[0] * direction[0]
        + previousDirection[1] * direction[1] > 0
      && endSection.length === strip.startSection.length
      && endSection.every((coordinate, index) => (
        coordinate === strip.startSection[index]
      ));
    if (!connects) {
      flush();
      startSection = strip.startSection;
      endSection = strip.endSection;
      leftBoundary = [
        strip.startSection[0]!,
        strip.startSection[1]!,
        strip.endSection[0]!,
        strip.endSection[1]!,
      ];
      rightBoundary = [
        strip.startSection.at(-2)!,
        strip.startSection.at(-1)!,
        strip.endSection.at(-2)!,
        strip.endSection.at(-1)!,
      ];
      previousDirection = direction;
      continue;
    }
    currentLeftBoundary.push(
      strip.endSection[0]!,
      strip.endSection[1]!,
    );
    currentRightBoundary.push(
      strip.endSection.at(-2)!,
      strip.endSection.at(-1)!,
    );
    endSection = strip.endSection;
    previousDirection = direction;
  }
  flush();
  return Object.freeze(contours);
}

/** Canvas and test adapters trace the exact continuous contours shared with SVG. */
export function traceStudioWetRibbonCarrierBatch(
  sink: StudioWetRibbonPathSink,
  batch: StudioWetRibbonCarrierBatch,
): void {
  for (const plannedPolygon of continuousBatchContours(batch.polygons)) {
    const [firstX, firstY, ...remaining] = plannedPolygon.points;
    if (firstX === undefined || firstY === undefined) continue;
    sink.moveTo(firstX, firstY);
    for (let index = 0; index < remaining.length; index += 2) {
      const x = remaining[index];
      const y = remaining[index + 1];
      if (x === undefined || y === undefined) break;
      sink.lineTo(x, y);
    }
    sink.closePath();
  }
}

function formatPathNumber(value: number): string {
  if (Object.is(value, -0)) return "0";
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

/** SVG serializes the same continuous, quantized contours consumed by the Canvas path sink. */
export function studioWetRibbonCarrierBatchPathData(
  batch: StudioWetRibbonCarrierBatch,
): string {
  return continuousBatchContours(batch.polygons).map((plannedPolygon) => {
    const [firstX, firstY, ...remaining] = plannedPolygon.points;
    if (firstX === undefined || firstY === undefined) return "";
    let path = `M${formatPathNumber(firstX)} ${formatPathNumber(firstY)}`;
    for (let index = 0; index < remaining.length; index += 2) {
      const x = remaining[index];
      const y = remaining[index + 1];
      if (x === undefined || y === undefined) break;
      path += `L${formatPathNumber(x)} ${formatPathNumber(y)}`;
    }
    return `${path}Z`;
  }).join("");
}
