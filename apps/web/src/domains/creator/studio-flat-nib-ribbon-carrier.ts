/**
 * Prefix-stable connected carrier for the built-in hard flat/chisel nibs.
 *
 * The four opted-in catalogue materials used to transport their complete 64×64 silhouette once
 * per dab. Even with dense overlap, the repeated rectangular footprint became a periodic sawtooth
 * on long strokes. This adapter sweeps the authored tip support from the previous causal station
 * to the current one and emits one connected polygon per accepted dab instead.
 *
 * Each footprint depends only on that dab's persisted planner output (`direction` and
 * `distanceFromPrevious`). Incremental live rendering and full retained replay therefore consume
 * byte-identical geometry without looking ahead or rewriting an already rendered prefix.
 */

import type {
  NormalizedStudioBrushDynamicsSettings,
  StudioDynamicBrushDab,
} from "./brush/studio-brush-dynamics";
import type { StudioBrushTipAlphaMap } from "./brush/studio-brush-tip-stamp";
import type { StudioDynamicBrushMaterialIdentity } from "./brush/studio-dry-media-dynamic-bridge";

export const STUDIO_FLAT_NIB_RIBBON_CARRIER_VERSION =
  "flat-nib-ribbon-carrier-v1" as const;

export const STUDIO_FLAT_NIB_RIBBON_MAX_STATIONS = 1_048_576;

export type StudioFlatNibRibbonCatalogId =
  | "alcohol-chisel-marker"
  | "calligraphy-tilt-nib"
  | "clean-flat-marker"
  | "line-block";

export interface StudioFlatNibRibbonPolygon {
  readonly kind: "flat-nib-ribbon-polygon";
  readonly version: typeof STUDIO_FLAT_NIB_RIBBON_CARRIER_VERSION;
  readonly role: "tap" | "segment";
  /**
   * One or more flat `[x0,y0,x1,y1,…]` contours, closed and filled as one path by the renderer.
   * `line-block` retains its thin lane and block lane as separate swept contours so the empty
   * upper/lower-left support is not filled by one coarse convex hull.
   */
  readonly polygons: readonly (readonly number[])[];
}

export interface StudioFlatNibRibbonSourceMark {
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

export interface StudioFlatNibRibbonCoverageMark
  extends Omit<StudioFlatNibRibbonSourceMark, "falloff" | "texture"> {
  readonly ribbon: StudioFlatNibRibbonPolygon;
}

export type StudioFlatNibRibbonPlanResult =
  | Readonly<{
      readonly applied: true;
      readonly catalogId: StudioFlatNibRibbonCatalogId;
      readonly marks: readonly StudioFlatNibRibbonCoverageMark[];
    }>
  | Readonly<{
      readonly applied: false;
      readonly reason:
        | "ineligible-material"
        | "invalid-geometry"
        | "mark-dab-mismatch"
        | "station-budget";
      readonly marks: readonly StudioFlatNibRibbonSourceMark[];
    }>;

const ELIGIBLE_CATALOG_IDS = new Set<StudioFlatNibRibbonCatalogId>([
  "alcohol-chisel-marker",
  "calligraphy-tilt-nib",
  "clean-flat-marker",
  "line-block",
]);

const COORDINATE_LIMIT = 1_000_000_000;
const GEOMETRY_QUANTIZATION = 10_000;
const SUPPORT_ALPHA_THRESHOLD = 1 / 255;
const POINT_EPSILON = 1e-6;

interface LocalPoint {
  readonly x: number;
  readonly y: number;
}

interface AlphaMapSupportHulls {
  readonly ordinary: readonly (readonly LocalPoint[])[];
  readonly lineBlock: readonly (readonly LocalPoint[])[];
}

const supportHullsByAlphaMap = new WeakMap<StudioBrushTipAlphaMap, AlphaMapSupportHulls>();

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

function cross(origin: LocalPoint, left: LocalPoint, right: LocalPoint): number {
  return (left.x - origin.x) * (right.y - origin.y)
    - (left.y - origin.y) * (right.x - origin.x);
}

function convexHull(points: readonly LocalPoint[]): readonly LocalPoint[] {
  if (points.length <= 1) return Object.freeze([...points]);
  const sorted = [...points].sort((left, right) => (
    left.x === right.x ? left.y - right.y : left.x - right.x
  ));
  const unique = sorted.filter((point, index) => (
    index === 0
    || point.x !== sorted[index - 1]!.x
    || point.y !== sorted[index - 1]!.y
  ));
  if (unique.length <= 2) return Object.freeze(unique);

  const lower: LocalPoint[] = [];
  for (const point of unique) {
    while (
      lower.length >= 2
      && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: LocalPoint[] = [];
  for (let index = unique.length - 1; index >= 0; index -= 1) {
    const point = unique[index]!;
    while (
      upper.length >= 2
      && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return Object.freeze([...lower, ...upper]);
}

function alphaMapSupportHulls(
  alphaMap: StudioBrushTipAlphaMap,
  catalogId: StudioFlatNibRibbonCatalogId,
): readonly (readonly LocalPoint[])[] {
  const cached = supportHullsByAlphaMap.get(alphaMap);
  if (cached) {
    return catalogId === "line-block" ? cached.lineBlock : cached.ordinary;
  }
  const size = Math.floor(finite(alphaMap.size, 0));
  if (
    size <= 0
    || alphaMap.alphas.length !== size * size
  ) {
    return [];
  }
  const ordinaryPoints: LocalPoint[] = [];
  const linePoints: LocalPoint[] = [];
  const blockPoints: LocalPoint[] = [];
  const appendCellCorners = (
    target: LocalPoint[],
    left: number,
    right: number,
    top: number,
    bottom: number,
  ) => {
    target.push(
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
    );
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const alpha = alphaMap.alphas[y * size + x];
      if (!Number.isFinite(alpha) || alpha <= SUPPORT_ALPHA_THRESHOLD) continue;
      const left = x / size * 2 - 1;
      const right = (x + 1) / size * 2 - 1;
      const top = y / size * 2 - 1;
      const bottom = (y + 1) / size * 2 - 1;
      const centerX = (left + right) / 2;
      const centerY = (top + bottom) / 2;
      appendCellCorners(ordinaryPoints, left, right, top, bottom);
      // The authored line-block map is a horizontal hairline joined to a right-hand block.
      // Decomposing the occupied pixels by those two semantic supports retains its negative space
      // while both contours are still filled as one coverage operation.
      if (Math.abs(centerY) <= 0.2) {
        appendCellCorners(linePoints, left, right, top, bottom);
      }
      if (centerX >= 0.02) {
        appendCellCorners(blockPoints, left, right, top, bottom);
      }
    }
  }
  const ordinaryHull = convexHull(ordinaryPoints);
  const lineHull = convexHull(linePoints);
  const blockHull = convexHull(blockPoints);
  const hulls: AlphaMapSupportHulls = Object.freeze({
    ordinary: ordinaryHull.length >= 3 ? Object.freeze([ordinaryHull]) : [],
    lineBlock: lineHull.length >= 3 && blockHull.length >= 3
      ? Object.freeze([lineHull, blockHull])
      : ordinaryHull.length >= 3
        ? Object.freeze([ordinaryHull])
        : [],
  });
  supportHullsByAlphaMap.set(alphaMap, hulls);
  return catalogId === "line-block" ? hulls.lineBlock : hulls.ordinary;
}

function resolvedCatalogId(
  materialIdentity: StudioDynamicBrushMaterialIdentity | undefined,
  dynamics: NormalizedStudioBrushDynamicsSettings,
): StudioFlatNibRibbonCatalogId | null {
  const candidate = materialIdentity?.brushCatalogId;
  if (
    typeof candidate !== "string"
    || !ELIGIBLE_CATALOG_IDS.has(candidate as StudioFlatNibRibbonCatalogId)
    || materialIdentity?.brushId !== "ink-particle"
    || dynamics.tip.shape !== "hard"
    || dynamics.tip.alphaMapBase64 === null
    || dynamics.grain.amount !== 0
    || dynamics.tipLayers.length !== 0
    || dynamics.dualBrush?.enabled === true
    || dynamics.angle.jitter !== null
  ) {
    return null;
  }
  return candidate as StudioFlatNibRibbonCatalogId;
}

function transformedSupport(
  support: readonly LocalPoint[],
  mark: StudioFlatNibRibbonSourceMark,
  centerX: number,
  centerY: number,
): readonly LocalPoint[] {
  const cosine = Math.cos(mark.angleRadians);
  const sine = Math.sin(mark.angleRadians);
  return support.map((point) => {
    const localX = point.x * mark.radiusX;
    const localY = point.y * mark.radiusY;
    return {
      x: centerX + localX * cosine - localY * sine,
      y: centerY + localX * sine + localY * cosine,
    };
  });
}

function polygonBounds(points: readonly LocalPoint[]): Readonly<{
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
}> | null {
  if (points.length < 3) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (!(maxX > minX) || !(maxY > minY)) return null;
  return Object.freeze({
    x: quantize((minX + maxX) / 2),
    y: quantize((minY + maxY) / 2),
    radiusX: quantize(Math.max(0.25, (maxX - minX) / 2)),
    radiusY: quantize(Math.max(0.25, (maxY - minY) / 2)),
  });
}

function ribbonFor(
  catalogId: StudioFlatNibRibbonCatalogId,
  dab: StudioDynamicBrushDab,
  mark: StudioFlatNibRibbonSourceMark,
): StudioFlatNibRibbonCoverageMark | null {
  const texture = mark.texture;
  if (
    texture?.kind !== "alpha-map"
    || mark.falloff !== undefined
    || !Number.isFinite(dab.sourceX)
    || !Number.isFinite(dab.sourceY)
    || !Number.isFinite(mark.radiusX)
    || !Number.isFinite(mark.radiusY)
    || mark.radiusX <= 0
    || mark.radiusY <= 0
  ) {
    return null;
  }
  const supportHulls = alphaMapSupportHulls(texture.alphaMap, catalogId);
  if (supportHulls.length === 0) return null;
  const travel = Math.max(0, finite(dab.distanceFromPrevious, 0));
  const direction = finite(dab.direction, Number.NaN);
  if (travel > POINT_EPSILON && !Number.isFinite(direction)) return null;
  const directionRadians = direction * Math.PI / 180;
  // Flat hard nibs use the causal path station as their silhouette authority. Per-dab centre
  // scatter belonged to the old stamp transport and is intentionally removed here; retaining it
  // would move every swept edge sideways and recreate the same periodic tooth under another name.
  // Pressure width, flow, opacity, nib angle and the authored alpha support remain untouched.
  const endX = dab.sourceX;
  const endY = dab.sourceY;
  const startX = travel > POINT_EPSILON
    ? endX - Math.cos(directionRadians) * travel
    : endX;
  const startY = travel > POINT_EPSILON
    ? endY - Math.sin(directionRadians) * travel
    : endY;
  const polygons = supportHulls.map((support) => {
    const endSupport = transformedSupport(support, mark, endX, endY);
    return travel > POINT_EPSILON
      ? convexHull([
          ...transformedSupport(support, mark, startX, startY),
          ...endSupport,
        ])
      : convexHull(endSupport);
  });
  const bounds = polygonBounds(polygons.flat());
  if (!bounds) return null;
  const quantizedPolygons = Object.freeze(polygons.map((polygon) => (
    Object.freeze(
      polygon.flatMap((point) => [quantize(point.x), quantize(point.y)]),
    )
  )));
  return Object.freeze({
    ...bounds,
    angleRadians: 0,
    alpha: mark.alpha,
    color: mark.color,
    ribbon: Object.freeze({
      kind: "flat-nib-ribbon-polygon",
      version: STUDIO_FLAT_NIB_RIBBON_CARRIER_VERSION,
      role: travel > POINT_EPSILON ? "segment" : "tap",
      polygons: quantizedPolygons,
    }),
  });
}

/**
 * Replaces a one-mark-per-dab hard flat tip plan with the same-size connected polygon plan.
 *
 * Any custom dynamics, material mismatch, malformed input or work-budget overflow returns the
 * original immutable mark list unchanged. Intentional stamps and textured brushes cannot enter.
 */
export function planStudioFlatNibRibbonCarrier(
  input: Readonly<{
    dabs: readonly StudioDynamicBrushDab[];
    marks: readonly StudioFlatNibRibbonSourceMark[];
    materialIdentity?: StudioDynamicBrushMaterialIdentity;
    dynamics: NormalizedStudioBrushDynamicsSettings;
  }>,
): StudioFlatNibRibbonPlanResult {
  const catalogId = resolvedCatalogId(input.materialIdentity, input.dynamics);
  if (!catalogId) {
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
  if (input.dabs.length > STUDIO_FLAT_NIB_RIBBON_MAX_STATIONS) {
    return Object.freeze({
      applied: false,
      reason: "station-budget",
      marks: input.marks,
    });
  }
  const planned: StudioFlatNibRibbonCoverageMark[] = [];
  for (let index = 0; index < input.dabs.length; index += 1) {
    const mark = ribbonFor(catalogId, input.dabs[index]!, input.marks[index]!);
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
    catalogId,
    marks: Object.freeze(planned),
  });
}
