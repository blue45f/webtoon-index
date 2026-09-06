/**
 * Stroke-local union carrier for the five built-in dry-media brushes.
 *
 * The anisotropic bridge still owns the pressure/material response and emits three or five
 * independent fibres per source station. This adapter changes only their transport: instead of
 * source-over stamping every fibre footprint, it sweeps each footprint from its immutable
 * `segmentStartFrame` and fills every contour in one operation. Consequently a self-crossing or
 * A→B→A retrace is covered once inside one stroke, while separate DrawEls still build pigment in
 * the ordinary destination compositor.
 */

import {
  isStudioDryMediaUnionComposableProgramPin,
  STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST,
  STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION,
  type NormalizedStudioBrushDynamicsSettings,
  type StudioDynamicBrushDab,
  type StudioDynamicBrushSegmentStartFrame,
} from "./studio-brush-dynamics";
import {
  studioDryMediaDynamicBridgeMarkMultiplier,
  type StudioDynamicBrushMaterialIdentity,
} from "./studio-dry-media-dynamic-bridge";
import {
  resolveStudioDryMediaKernelTipMaterial,
  studioDryMediaKernelDabPathOwnsMaterial,
  type StudioDryMediaCoreId,
} from "./studio-dry-media-kernel-tip";

import type { StudioBrushTipAlphaMap } from "./studio-brush-tip-stamp";

export const STUDIO_DRY_MEDIA_UNION_RIBBON_CARRIER_VERSION =
  "dry-media-union-ribbon-carrier-v1" as const;
export {
  STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST,
  STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION,
} from "./studio-brush-dynamics";

export interface StudioDryMediaUnionComposableGroup {
  /** Immutable global causal station, independent from pointer delivery chunking. */
  readonly stationIndex: number;
  /** Positive carrier bodies and only the pores physically authored inside those bodies. */
  readonly polygons: readonly (readonly number[])[];
}
export const STUDIO_DRY_MEDIA_UNION_RIBBON_MAX_MARKS = 524_288;

export interface StudioDryMediaUnionRibbonPolygon {
  readonly kind: "dry-media-union-ribbon-polygon";
  readonly version: typeof STUDIO_DRY_MEDIA_UNION_RIBBON_CARRIER_VERSION;
  readonly role: "stroke-union";
  /**
   * Positive-winding pigment contours followed by deterministic opposite-winding micro pores.
   * One non-zero fill therefore deposits a continuous bed while revealing paper tooth without
   * painting the background colour or source-over stacking transparent stamps.
   */
  readonly polygons: readonly (readonly number[])[];
  /**
   * New strokes use fixed causal-station groups. Each group is rasterized with one nonzero Path,
   * then alpha-max-unioned into the stroke-local coverage bitmap. A later pore therefore reveals
   * only its own wax carrier and never erases pigment already laid by an earlier station.
   */
  readonly compositing?: Readonly<{
    readonly kind: "causal-group-alpha-max";
    readonly version: typeof STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION;
    readonly programDigest: typeof STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST;
    readonly groups: readonly StudioDryMediaUnionComposableGroup[];
  }>;
}

export const STUDIO_DRY_MEDIA_UNION_CHUNKED_RIBBON_VERSION =
  "dry-media-union-ribbon-chunks-v2" as const;
/**
 * Admission bound for one immutable host -> Worker page. This is deliberately not a stroke
 * geometry ceiling: older pages can be sealed into the dry-media CAS while a stroke continues.
 */
export const STUDIO_DRY_MEDIA_UNION_CHUNK_PAGE_BYTE_BUDGET = 1024 * 1024;
export const STUDIO_DRY_MEDIA_UNION_CHUNK_DOCUMENT_TILE_SIZE = 64;

/**
 * Getter-free opaque authority for live dry-media geometry. Coordinate buffers remain in this
 * module's private WeakMap, so retained-plan consumers cannot mutate a typed backing store.
 */
export interface StudioDryMediaUnionChunkAuthorityReceipt {
  readonly contract: "studio-dry-media-union-chunk-authority-v1";
  readonly version: 1;
  readonly generation: number;
  readonly entryCount: number;
  readonly contourCount: number;
  readonly coordinateCount: number;
  readonly tileReferenceCount: number;
  /** Conservative resident charge, including typed capacities and JS index/container overhead. */
  readonly residentByteLength: number;
  /** Compatibility alias for retained-plan accounting. Equal to `residentByteLength`. */
  readonly estimatedByteLength: number;
  /** Ephemeral in-process fingerprint only; never used as a durable content authority. */
  readonly geometryDigest: string;
}

export interface StudioDryMediaUnionChunkedRibbonPolygon {
  readonly kind: "dry-media-union-ribbon-chunks-v2";
  readonly version: typeof STUDIO_DRY_MEDIA_UNION_CHUNKED_RIBBON_VERSION;
  readonly role: "stroke-union";
  readonly authority: StudioDryMediaUnionChunkAuthorityReceipt;
  readonly entryIndex: number;
  /** Compatibility sentinel; opaque coordinates are never materialized through this property. */
  readonly polygons: readonly [];
}

export interface StudioDryMediaUnionRibbonSourceMark {
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

export interface StudioDryMediaUnionRibbonCoverageMark
  extends Omit<StudioDryMediaUnionRibbonSourceMark, "falloff" | "texture"> {
  readonly ribbon: StudioDryMediaUnionRibbonPolygon;
}

export interface StudioDryMediaUnionChunkedRibbonCoverageMark
  extends Omit<StudioDryMediaUnionRibbonSourceMark, "falloff" | "texture"> {
  readonly ribbon: StudioDryMediaUnionChunkedRibbonPolygon;
}

export type StudioDryMediaUnionRibbonPlanResult =
  | Readonly<{
      readonly applied: true;
      readonly marks: readonly StudioDryMediaUnionRibbonCoverageMark[];
    }>
  | Readonly<{
      readonly applied: false;
      readonly reason:
        | "ineligible-material"
        | "invalid-geometry"
        | "mark-dab-mismatch"
        | "mark-budget";
      readonly marks: readonly StudioDryMediaUnionRibbonSourceMark[];
    }>;

const COORDINATE_LIMIT = 1_000_000_000;
const QUANTIZATION = 10_000;
const EPSILON = 1e-6;
const TAU = Math.PI * 2;

type CoreDryMediaId = StudioDryMediaCoreId;

interface DryMediaNegativeGrainPolicy {
  /** Probability that one causal lane segment exposes a paper-tooth slit. */
  readonly density: number;
  /** Slit length as a fraction of the causal segment, before the absolute fine-grain bound. */
  readonly lengthRatio: number;
  /** Slit width as a fraction of the narrowest connected pigment half-width. */
  readonly widthRatio: number;
  readonly maximumHalfLength: number;
  readonly maximumHalfWidth: number;
  readonly lateralWander: number;
}

const DRY_MEDIA_NEGATIVE_GRAIN_POLICY = Object.freeze({
  // Continuous anisotropic wax tooth: longer, slightly denser slits along the travel direction
  // so the bed never reads as isotropic noise tiles or isolated lozenges.
  crayon: Object.freeze({
    density: 0.42,
    lengthRatio: 0.52,
    widthRatio: 0.1,
    maximumHalfLength: 0.88,
    maximumHalfWidth: 0.2,
    lateralWander: 0.34,
  }),
  // Many hairline carbon gaps preserve a fibrous stick texture.
  charcoal: Object.freeze({
    density: 0.68,
    lengthRatio: 0.58,
    widthRatio: 0.09,
    maximumHalfLength: 0.82,
    maximumHalfWidth: 0.2,
    lateralWander: 0.56,
  }),
  // Shorter mineral pores read as chalk tooth rather than square pigment flakes.
  chalk: Object.freeze({
    density: 0.6,
    lengthRatio: 0.3,
    widthRatio: 0.18,
    maximumHalfLength: 0.48,
    maximumHalfWidth: 0.34,
    lateralWander: 0.62,
  }),
  // Fine, moderately dense paper tooth under soft powder.
  pastel: Object.freeze({
    density: 0.5,
    lengthRatio: 0.34,
    widthRatio: 0.14,
    maximumHalfLength: 0.56,
    maximumHalfWidth: 0.3,
    lateralWander: 0.52,
  }),
  // Oil pastel is smoother and more occlusive, with only occasional wax grooves.
  "oil-pastel": Object.freeze({
    density: 0.24,
    lengthRatio: 0.5,
    widthRatio: 0.08,
    maximumHalfLength: 0.7,
    maximumHalfWidth: 0.18,
    lateralWander: 0.34,
  }),
} as const satisfies Readonly<Record<CoreDryMediaId, DryMediaNegativeGrainPolicy>>);

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function quantize(value: number): number {
  return Math.round(
    clamp(finite(value, 0), -COORDINATE_LIMIT, COORDINATE_LIMIT) * QUANTIZATION,
  ) / QUANTIZATION;
}

/**
 * Union-carrier ownership is the legacy byte authority of the T1 de-polygon flip, defined as the
 * exact complement of the kernel dab path over eligible materials (fail-safe): it keeps every
 * eligible stroke whose dynamics do NOT carry the explicit fresh-authoring `dryMediaKernelProgram`
 * marker. That set is every persisted pre-wave document — unpinned causal strokes included —
 * plus every explicitly pinned element, so historical replay is byte-identical to the pre-flip
 * output instead of being silently re-rendered by the kernel tips. Only freshly authored core
 * dry-media strokes (whose preset snapshots mint the marker) leave this carrier.
 */
export function studioDryMediaUnionRibbonCarrierOwnsMaterial(
  materialIdentity: StudioDynamicBrushMaterialIdentity | undefined,
  dynamics: NormalizedStudioBrushDynamicsSettings,
): boolean {
  return resolveStudioDryMediaKernelTipMaterial(materialIdentity, dynamics) !== null
    && studioDryMediaKernelDabPathOwnsMaterial(materialIdentity, dynamics) === null;
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

function validPair(
  dab: StudioDynamicBrushDab,
  mark: StudioDryMediaUnionRibbonSourceMark,
): boolean {
  return Number.isFinite(dab.sourceX)
    && Number.isFinite(dab.sourceY)
    && Number.isFinite(dab.size)
    && dab.size > 0
    && Number.isFinite(dab.direction)
    && Number.isFinite(dab.distanceFromPrevious)
    && finite(mark.x, Number.NaN) === mark.x
    && finite(mark.y, Number.NaN) === mark.y
    && finite(mark.radiusX, Number.NaN) === mark.radiusX
    && mark.radiusX > 0
    && finite(mark.radiusY, Number.NaN) === mark.radiusY
    && mark.radiusY > 0
    && Number.isFinite(mark.alpha)
    && mark.alpha >= 0
    && mark.alpha <= 1
    && typeof mark.color === "string"
    && mark.color.length > 0;
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

function oppositeWinding(points: readonly number[]): readonly number[] {
  const positive = sameWinding(points);
  const reversed: number[] = [];
  for (let index = positive.length - 2; index >= 0; index -= 2) {
    reversed.push(positive[index]!, positive[index + 1]!);
  }
  return Object.freeze(reversed);
}

function deterministicUnit(
  seed: number,
  stationIndex: number,
  laneIndex: number,
  channel: number,
): number {
  let value = (
    (seed >>> 0)
    ^ Math.imul((stationIndex + 1) >>> 0, 0x9e37_79b1)
    ^ Math.imul((laneIndex + 1) >>> 0, 0x85eb_ca77)
    ^ Math.imul((channel + 1) >>> 0, 0xc2b2_ae3d)
  ) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb_352d) >>> 0;
  value ^= value >>> 15;
  value = Math.imul(value, 0x846c_a68b) >>> 0;
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000;
}

function ellipsePolygon(
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  angle: number,
  vertexCount = 12,
): readonly number[] {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const points: number[] = [];
  for (let index = 0; index < vertexCount; index += 1) {
    const theta = index / vertexCount * TAU;
    const localX = Math.cos(theta) * radiusX;
    const localY = Math.sin(theta) * radiusY;
    points.push(
      centerX + localX * cosine - localY * sine,
      centerY + localX * sine + localY * cosine,
    );
  }
  return sameWinding(points);
}

function coverageHalfWidth(
  mark: StudioDryMediaUnionRibbonSourceMark,
): number {
  // Pigment/grain alpha becomes edge density instead of repeated transparent stamp opacity.
  // This keeps paper-tooth variation without allowing overlaps inside one DrawEl to darken.
  return Math.max(
    0.18,
    mark.radiusY * (0.52 + Math.sqrt(clamp(mark.alpha, 0, 1)) * 0.48),
  );
}

function previousFiberCenter(
  dab: StudioDynamicBrushDab,
  mark: StudioDryMediaUnionRibbonSourceMark,
  frame: StudioDynamicBrushSegmentStartFrame,
): Readonly<{ x: number; y: number; halfWidth: number }> {
  const currentDirection = finite(dab.direction, 0) * Math.PI / 180;
  const previousDirection = frame.direction * Math.PI / 180;
  const delta = previousDirection - currentDirection;
  const cosine = Math.cos(delta);
  const sine = Math.sin(delta);
  const scale = clamp(frame.size / Math.max(EPSILON, dab.size), 0.2, 5);
  const offsetX = mark.x - dab.sourceX;
  const offsetY = mark.y - dab.sourceY;
  return Object.freeze({
    x: frame.sourceX + (offsetX * cosine - offsetY * sine) * scale,
    y: frame.sourceY + (offsetX * sine + offsetY * cosine) * scale,
    halfWidth: coverageHalfWidth(mark) * scale,
  });
}

function actualPreviousFiberCenter(
  dabs: readonly StudioDynamicBrushDab[],
  marks: readonly StudioDryMediaUnionRibbonSourceMark[],
  index: number,
  laneCount: number,
  frame: StudioDynamicBrushSegmentStartFrame,
): Readonly<{ x: number; y: number; halfWidth: number }> | null {
  const previousIndex = index - laneCount;
  if (previousIndex < 0) return null;
  const previousDab = dabs[previousIndex];
  const previousMark = marks[previousIndex];
  if (!previousDab || !previousMark || !validPair(previousDab, previousMark)) {
    return null;
  }

  // The bridge emits every physical lane in a stable station-major order. A full-prefix replay
  // therefore has the exact previous footprint at `index - laneCount`; use that authored geometry
  // instead of rotating the current station's freshly seeded offset backwards. The reconstruction
  // remains the causal-suffix fallback when the preceding station is intentionally not supplied.
  if (
    Math.abs(previousDab.sourceX - frame.sourceX) > EPSILON
    || Math.abs(previousDab.sourceY - frame.sourceY) > EPSILON
  ) {
    return null;
  }
  if (
    Number.isFinite(previousDab.distanceFromStrokeStart)
    && Number.isFinite(frame.distanceFromStrokeStart)
    && Math.abs(
      previousDab.distanceFromStrokeStart! - frame.distanceFromStrokeStart!,
    ) > EPSILON
  ) {
    return null;
  }
  return Object.freeze({
    x: previousMark.x,
    y: previousMark.y,
    halfWidth: coverageHalfWidth(previousMark),
  });
}

function segmentPolygon(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  startHalfWidth: number,
  endHalfWidth: number,
): readonly number[] | null {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const length = Math.hypot(deltaX, deltaY);
  if (length <= EPSILON) return null;
  const normalX = -deltaY / length;
  const normalY = deltaX / length;
  return sameWinding([
    startX - normalX * startHalfWidth,
    startY - normalY * startHalfWidth,
    endX - normalX * endHalfWidth,
    endY - normalY * endHalfWidth,
    endX + normalX * endHalfWidth,
    endY + normalY * endHalfWidth,
    startX + normalX * startHalfWidth,
    startY + normalY * startHalfWidth,
  ]);
}

function negativeGrainSlitPolygon(
  input: Readonly<{
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    startHalfWidth: number;
    endHalfWidth: number;
    seed: number;
    stationIndex: number;
    laneIndex: number;
    policy: DryMediaNegativeGrainPolicy;
  }>,
): readonly number[] | null {
  if (
    deterministicUnit(
      input.seed,
      input.stationIndex,
      input.laneIndex,
      0,
    ) >= input.policy.density
  ) return null;
  const deltaX = input.endX - input.startX;
  const deltaY = input.endY - input.startY;
  const length = Math.hypot(deltaX, deltaY);
  const minimumHalfWidth = Math.min(
    input.startHalfWidth,
    input.endHalfWidth,
  );
  if (length <= 0.45 || minimumHalfWidth <= 0.18) return null;

  const tangentX = deltaX / length;
  const tangentY = deltaY / length;
  const normalX = -tangentY;
  const normalY = tangentX;
  const along = 0.24 + deterministicUnit(
    input.seed,
    input.stationIndex,
    input.laneIndex,
    1,
  ) * 0.52;
  const lateral = (
    deterministicUnit(
      input.seed,
      input.stationIndex,
      input.laneIndex,
      2,
    ) * 2 - 1
  ) * minimumHalfWidth * input.policy.lateralWander;
  const centerX = input.startX + deltaX * along + normalX * lateral;
  const centerY = input.startY + deltaY * along + normalY * lateral;
  const halfLength = Math.max(
    0.12,
    Math.min(
      length * 0.31,
      input.policy.maximumHalfLength,
      length * input.policy.lengthRatio * (
        0.72 + deterministicUnit(
          input.seed,
          input.stationIndex,
          input.laneIndex,
          3,
        ) * 0.4
      ),
    ),
  );
  const sampledHalfWidth = Math.max(
    0.04,
    Math.min(
      minimumHalfWidth * 0.32,
      input.policy.maximumHalfWidth,
      minimumHalfWidth * input.policy.widthRatio * (
        0.78 + deterministicUnit(
          input.seed,
          input.stationIndex,
          input.laneIndex,
          4,
        ) * 0.38
      ),
    ),
  );
  // A four-corner subtractive slit remained clearly rectangular at 200%+
  // zoom, especially in chalk and crayon. Keep every pore materially
  // elongated and round its ends so paper tooth never reads as a tiled square
  // particle. The bound is deterministic and independent from live chunking.
  const halfWidth = Math.min(sampledHalfWidth, halfLength / 2.8);
  if (halfLength * 2 >= length * 0.68 || halfWidth >= minimumHalfWidth * 0.4) {
    return null;
  }
  // Ten vertices keep elongated pores round enough at 200% zoom (tests require ≥20 coords).
  return oppositeWinding(ellipsePolygon(
    centerX,
    centerY,
    halfLength,
    halfWidth,
    Math.atan2(tangentY, tangentX),
    10,
  ));
}

function polygonBounds(
  polygons: readonly (readonly number[])[],
): Readonly<{ x: number; y: number; radiusX: number; radiusY: number }> | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const count = polygons.length;
  for (let pIndex = 0; pIndex < count; pIndex += 1) {
    const polygon = polygons[pIndex]!;
    const len = polygon.length;
    if (len < 6 || (len & 1) !== 0) return null;
    for (let index = 0; index < len; index += 2) {
      const x = polygon[index]!;
      const y = polygon[index + 1]!;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
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

/**
 * Replaces the complete built-in dry-media mark sequence with one opaque geometry mask.
 *
 * Opaque here is stroke-local only: the caller still composites the complete mask with the
 * DrawEl opacity once, so two independently authored strokes retain normal pigment build-up.
 */
export function planStudioDryMediaUnionRibbonCarrier(
  input: Readonly<{
    dabs: readonly StudioDynamicBrushDab[];
    marks: readonly StudioDryMediaUnionRibbonSourceMark[];
    materialIdentity?: StudioDynamicBrushMaterialIdentity;
    dynamics: NormalizedStudioBrushDynamicsSettings;
    /**
     * Physical bridged marks supplied only as causal context. They participate in predecessor
     * lookup but are omitted from the returned suffix polygons. Live drawing uses one complete
     * predecessor station so a newly appended lane starts at the exact previous fibre centre
     * without rebuilding the whole stroke.
     */
    skipLeadingMarks?: number;
  }>,
): StudioDryMediaUnionRibbonPlanResult {
  if (
    !studioDryMediaUnionRibbonCarrierOwnsMaterial(
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
  if (input.marks.length > STUDIO_DRY_MEDIA_UNION_RIBBON_MAX_MARKS) {
    return Object.freeze({
      applied: false,
      reason: "mark-budget",
      marks: input.marks,
    });
  }
  if (input.marks.length === 0) {
    return Object.freeze({ applied: true, marks: Object.freeze([]) });
  }
  const laneCount = studioDryMediaDynamicBridgeMarkMultiplier(
    input.materialIdentity,
  );
  const skipLeadingMarks = input.skipLeadingMarks ?? 0;
  if (laneCount === 1 || input.dabs.length % laneCount !== 0) {
    return Object.freeze({
      applied: false,
      reason: "mark-dab-mismatch",
      marks: input.marks,
    });
  }
  if (
    !Number.isSafeInteger(skipLeadingMarks)
    || skipLeadingMarks < 0
    || skipLeadingMarks >= input.marks.length
    || skipLeadingMarks % laneCount !== 0
  ) {
    return Object.freeze({
      applied: false,
      reason: "mark-dab-mismatch",
      marks: input.marks,
    });
  }
  const firstColor = input.marks[0]!.color;
  if (
    input.marks.some((mark, index) => (
      mark.color !== firstColor || !validPair(input.dabs[index]!, mark)
    ))
  ) {
    return Object.freeze({
      applied: false,
      reason: "invalid-geometry",
      marks: input.marks,
    });
  }

  const polygons: Array<readonly number[]> = [];
  const composableGroups: Array<{
    stationIndex: number;
    polygons: Array<readonly number[]>;
  }> = [];
  let currentComposableGroup: {
    stationIndex: number;
    polygons: Array<readonly number[]>;
  } | null = null;
  const appendComposablePolygon = (
    stationIndex: number,
    polygon: readonly number[],
  ): void => {
    if (!currentComposableGroup || currentComposableGroup.stationIndex !== stationIndex) {
      currentComposableGroup = { stationIndex, polygons: [] };
      composableGroups.push(currentComposableGroup);
    }
    currentComposableGroup.polygons.push(polygon);
    polygons.push(polygon);
  };
  // Legacy-replay byte authority: the negative-grain policy is keyed by the kernel-tip material
  // id — the runtime brushId for every persisted core dry-media stroke — never by the resolved
  // anisotropic preset. `dryMediaPresetId` folds oil-pastel onto the "pastel" row and would
  // silently change the paper-tooth slit bytes of every stored oil-pastel stroke.
  const grainMaterialId = resolveStudioDryMediaKernelTipMaterial(
    input.materialIdentity,
    input.dynamics,
  );
  if (grainMaterialId === null) {
    // Unreachable behind the ownership gate above; fail closed instead of substituting a policy.
    return Object.freeze({
      applied: false,
      reason: "ineligible-material",
      marks: input.marks,
    });
  }
  const grainPolicy = DRY_MEDIA_NEGATIVE_GRAIN_POLICY[grainMaterialId];
  const grainSeed = Math.trunc(finite(input.dynamics.seed, 0)) >>> 0;
  for (
    let index = skipLeadingMarks;
    index < input.dabs.length;
    index += 1
  ) {
    const dab = input.dabs[index]!;
    const mark = input.marks[index]!;
    const travel = Math.max(0, finite(dab.distanceFromPrevious, 0));
    const frame = dab.segmentStartFrame;
    // The anisotropic bridge expands one source station into several physical lanes and assigns
    // each lane an independent sampling index. Those expanded indices are texture identities,
    // not causal station identities: every initial lane belongs to source station zero.
    const stationIndex = frame ? frame.index + 1 : 0;
    if (travel > EPSILON) {
      if (!validFrame(frame)) {
        return Object.freeze({
          applied: false,
          reason: "invalid-geometry",
          marks: input.marks,
        });
      }
      const start = actualPreviousFiberCenter(
        input.dabs,
        input.marks,
        index,
        laneCount,
        frame,
      ) ?? previousFiberCenter(dab, mark, frame);
      const segment = segmentPolygon(
        start.x,
        start.y,
        mark.x,
        mark.y,
        start.halfWidth,
        coverageHalfWidth(mark),
      );
      if (!segment) {
        return Object.freeze({
          applied: false,
          reason: "invalid-geometry",
          marks: input.marks,
        });
      }
      appendComposablePolygon(stationIndex, segment);
      const grain = negativeGrainSlitPolygon({
        startX: start.x,
        startY: start.y,
        endX: mark.x,
        endY: mark.y,
        startHalfWidth: start.halfWidth,
        endHalfWidth: coverageHalfWidth(mark),
        seed: grainSeed,
        // The carrier may receive an arbitrary causal suffix during live drawing. Local array
        // indices restart at zero for that suffix, while the segment frame retains the immutable
        // source-dab index. Seed paper tooth from that causal identity so chunking a stroke does
        // not move, add or remove grain pores compared with the pointer-up full replay.
        stationIndex: frame.index + 1,
        laneIndex: index % laneCount,
        policy: grainPolicy,
      });
      if (grain) appendComposablePolygon(stationIndex, grain);
    } else {
      appendComposablePolygon(stationIndex, ellipsePolygon(
        mark.x,
        mark.y,
        Math.max(
          0.25,
          Math.min(mark.radiusX * 0.28, coverageHalfWidth(mark) * 1.8),
        ),
        coverageHalfWidth(mark),
        mark.angleRadians,
      ));
    }

    // Only immutable document endpoints receive caps. A moving live suffix never leaves a
    // temporary circular stamp behind, while retained/SVG endpoints stay softly rounded.
    if (dab.progress >= 1 - EPSILON) {
      appendComposablePolygon(stationIndex, ellipsePolygon(
        mark.x,
        mark.y,
        Math.max(
          0.25,
          Math.min(mark.radiusX * 0.24, coverageHalfWidth(mark) * 1.65),
        ),
        coverageHalfWidth(mark),
        mark.angleRadians,
      ));
    }
  }
  const bounds = polygonBounds(polygons);
  if (!bounds) {
    return Object.freeze({
      applied: false,
      reason: "invalid-geometry",
      marks: input.marks,
    });
  }
  return Object.freeze({
    applied: true,
    marks: Object.freeze([
      Object.freeze({
        ...bounds,
        angleRadians: 0,
        // The DrawEl/stroke opacity is applied exactly once by the coverage compositor.
        alpha: 1,
        color: firstColor,
        ribbon: Object.freeze({
          kind: "dry-media-union-ribbon-polygon",
          version: STUDIO_DRY_MEDIA_UNION_RIBBON_CARRIER_VERSION,
          role: "stroke-union",
          polygons: Object.freeze(polygons),
          ...(isStudioDryMediaUnionComposableProgramPin(
            input.dynamics.dryMediaUnionProgram,
          )
            ? {
                compositing: Object.freeze({
                  kind: "causal-group-alpha-max" as const,
                  version: STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION,
                  programDigest: STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST,
                  groups: Object.freeze(composableGroups.map((group) => Object.freeze({
                    stationIndex: group.stationIndex,
                    polygons: Object.freeze(group.polygons),
                  }))),
                }),
              }
            : {}),
        }),
      }),
    ]),
  });
}

interface ChunkedUnionEntry {
  readonly color: string;
  readonly ribbonVersion: typeof STUDIO_DRY_MEDIA_UNION_RIBBON_CARRIER_VERSION;
  minimumX: number;
  minimumY: number;
  maximumX: number;
  maximumY: number;
}

interface ChunkedUnionBatch {
  readonly firstContourId: number;
  readonly coordinates: Float64Array;
  readonly offsets: Uint32Array;
  readonly lengths: Uint32Array;
  readonly entryIndexes: Uint32Array;
  readonly bounds: Float64Array;
  readonly visitStamps: Uint32Array;
}

interface ChunkedTileIndex {
  readonly blocks: Uint32Array[];
  length: number;
}

interface ChunkedUnionAuthorityData {
  entries: ChunkedUnionEntry[];
  readonly batches: ChunkedUnionBatch[];
  readonly tileIndex: Map<number, ChunkedTileIndex>;
  contourCount: number;
  coordinateCount: number;
  tileReferenceCount: number;
  residentByteLength: number;
  hashA: number;
  hashB: number;
  hashC: number;
  hashD: number;
  visitGeneration: number;
  latestAuthority: StudioDryMediaUnionChunkAuthorityReceipt | null;
  pendingCandidate: StudioDryMediaUnionChunkAuthorityReceipt | null;
}

interface ChunkedUnionAuthorityView {
  readonly storage: ChunkedUnionAuthorityData;
  readonly entries: readonly ChunkedUnionEntry[];
  readonly contourCount: number;
  readonly coordinateCount: number;
  readonly tileReferenceCount: number;
  readonly residentByteLength: number;
  readonly hashA: number;
  readonly hashB: number;
  readonly hashC: number;
  readonly hashD: number;
}

interface ChunkedUnionPendingAppend {
  readonly previous: StudioDryMediaUnionChunkAuthorityReceipt;
  readonly candidate: StudioDryMediaUnionChunkAuthorityReceipt;
  readonly prepared: PreparedChunkedUnionBatch;
  readonly previousTileLengths: ReadonlyMap<number, number>;
}

interface PreparedChunkedUnionBatch {
  readonly batch: ChunkedUnionBatch;
  readonly tileAssignments: ReadonlyMap<number, readonly number[]>;
  readonly tileReferenceCount: number;
  readonly residentByteLength: number;
  readonly hashA: number;
  readonly hashB: number;
  readonly hashC: number;
  readonly hashD: number;
}

export interface StudioDryMediaUnionChunkedPathTarget {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
}

export interface StudioDryMediaUnionChunkedBounds {
  readonly minimumX: number;
  readonly minimumY: number;
  readonly maximumX: number;
  readonly maximumY: number;
}

export type StudioDryMediaUnionChunkedPathResult = Readonly<{
  status: "appended";
  contourCount: number;
}> | Readonly<{
  status: "rejected";
  reason: "stale-authority" | "invalid-entry" | "contour-work-budget";
  contourCount: number;
}>;

const CHUNK_AUTHORITY_CONTRACT =
  "studio-dry-media-union-chunk-authority-v1" as const;
const CHUNK_AUTHORITY_VERSION = 1 as const;
const CHUNK_TILE_INDEX_BLOCK_LENGTH = 256;
const CHUNK_TILE_COORDINATE_BIAS = 0x0100_0000;
const CHUNK_TILE_COORDINATE_SPAN = 0x0200_0000;
const CHUNK_BATCH_CONTAINER_BYTE_CHARGE = 128;
const CHUNK_TILE_MAP_ENTRY_BYTE_CHARGE = 64;
const CHUNK_ENTRY_BYTE_CHARGE = 96;
const chunkAuthorityData = new WeakMap<
  StudioDryMediaUnionChunkAuthorityReceipt,
  ChunkedUnionAuthorityView
>();
const chunkAuthorityPending = new WeakMap<
  StudioDryMediaUnionChunkAuthorityReceipt,
  ChunkedUnionPendingAppend
>();
let chunkAuthorityGeneration = 0;

function chunkTileKey(tileX: number, tileY: number): number | null {
  const biasedX = tileX + CHUNK_TILE_COORDINATE_BIAS;
  const biasedY = tileY + CHUNK_TILE_COORDINATE_BIAS;
  if (
    !Number.isSafeInteger(biasedX)
    || !Number.isSafeInteger(biasedY)
    || biasedX < 0
    || biasedX >= CHUNK_TILE_COORDINATE_SPAN
    || biasedY < 0
    || biasedY >= CHUNK_TILE_COORDINATE_SPAN
  ) return null;
  return biasedX * CHUNK_TILE_COORDINATE_SPAN + biasedY;
}

function quantizedHashPart(value: number): readonly [number, number] {
  const quantized = Math.round(value * QUANTIZATION);
  const low = quantized >>> 0;
  const high = Math.floor(quantized / 0x1_0000_0000) >>> 0;
  return [low, high];
}

function appendChunkHash(
  state: readonly [number, number, number, number],
  value: number,
): readonly [number, number, number, number] {
  const [low, high] = quantizedHashPart(value);
  return [
    Math.imul(state[0] ^ low, 0x85eb_ca6b) >>> 0,
    Math.imul(state[1] ^ high, 0xc2b2_ae35) >>> 0,
    Math.imul(state[2] ^ (low + high), 0x27d4_eb2f) >>> 0,
    Math.imul(state[3] ^ (low ^ high), 0x1656_67b1) >>> 0,
  ];
}

function chunkGeometryDigest(data: Pick<
  ChunkedUnionAuthorityData,
  "hashA" | "hashB" | "hashC" | "hashD"
>): string {
  return [data.hashA, data.hashB, data.hashC, data.hashD]
    .map((value) => value.toString(16).padStart(8, "0"))
    .join("");
}

function chunkAuthorityReceipt(
  data: Pick<ChunkedUnionAuthorityView,
    | "entries"
    | "contourCount"
    | "coordinateCount"
    | "tileReferenceCount"
    | "residentByteLength"
    | "hashA"
    | "hashB"
    | "hashC"
    | "hashD"
  >,
): StudioDryMediaUnionChunkAuthorityReceipt {
  chunkAuthorityGeneration = chunkAuthorityGeneration >= Number.MAX_SAFE_INTEGER
    ? 1
    : chunkAuthorityGeneration + 1;
  return Object.freeze({
    contract: CHUNK_AUTHORITY_CONTRACT,
    version: CHUNK_AUTHORITY_VERSION,
    generation: chunkAuthorityGeneration,
    entryCount: data.entries.length,
    contourCount: data.contourCount,
    coordinateCount: data.coordinateCount,
    tileReferenceCount: data.tileReferenceCount,
    residentByteLength: data.residentByteLength,
    estimatedByteLength: data.residentByteLength,
    geometryDigest: chunkGeometryDigest(data),
  });
}

function snapshotChunkEntries(
  entries: readonly ChunkedUnionEntry[],
): readonly ChunkedUnionEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

function chunkAuthorityView(
  storage: ChunkedUnionAuthorityData,
): ChunkedUnionAuthorityView {
  return {
    storage,
    entries: snapshotChunkEntries(storage.entries),
    contourCount: storage.contourCount,
    coordinateCount: storage.coordinateCount,
    tileReferenceCount: storage.tileReferenceCount,
    residentByteLength: storage.residentByteLength,
    hashA: storage.hashA,
    hashB: storage.hashB,
    hashC: storage.hashC,
    hashD: storage.hashD,
  };
}

function prepareChunkedUnionBatch(
  marks: readonly StudioDryMediaUnionRibbonCoverageMark[],
  firstContourId: number,
  initialHash: readonly [number, number, number, number],
): PreparedChunkedUnionBatch | null {
  let contourCount = 0;
  let coordinateCount = 0;
  for (const mark of marks) {
    if (
      mark.ribbon.kind !== "dry-media-union-ribbon-polygon"
      || mark.ribbon.role !== "stroke-union"
      || mark.alpha !== 1
    ) return null;
    contourCount += mark.ribbon.polygons.length;
    for (const polygon of mark.ribbon.polygons) coordinateCount += polygon.length;
  }
  if (contourCount <= 0 || coordinateCount <= 0) return null;
  const typedPayloadBytes = coordinateCount * Float64Array.BYTES_PER_ELEMENT
    + contourCount * (
      Uint32Array.BYTES_PER_ELEMENT * 4
      + Float64Array.BYTES_PER_ELEMENT * 4
    );
  if (
    !Number.isSafeInteger(typedPayloadBytes)
    || typedPayloadBytes > STUDIO_DRY_MEDIA_UNION_CHUNK_PAGE_BYTE_BUDGET
  ) return null;

  const coordinates = new Float64Array(coordinateCount);
  const offsets = new Uint32Array(contourCount);
  const lengths = new Uint32Array(contourCount);
  const entryIndexes = new Uint32Array(contourCount);
  const bounds = new Float64Array(contourCount * 4);
  const tileAssignments = new Map<number, number[]>();
  let coordinateOffset = 0;
  let contourIndex = 0;
  let tileReferenceCount = 0;
  let hashState = initialHash;
  for (const [entryIndex, mark] of marks.entries()) {
    for (const polygon of mark.ribbon.polygons) {
      const contourBounds = polygonBounds([polygon]);
      if (!contourBounds || polygon.length > 0xffff_ffff) return null;
      offsets[contourIndex] = coordinateOffset;
      lengths[contourIndex] = polygon.length;
      entryIndexes[contourIndex] = entryIndex;
      bounds[contourIndex * 4] = contourBounds.x - contourBounds.radiusX;
      bounds[contourIndex * 4 + 1] = contourBounds.y - contourBounds.radiusY;
      bounds[contourIndex * 4 + 2] = contourBounds.x + contourBounds.radiusX;
      bounds[contourIndex * 4 + 3] = contourBounds.y + contourBounds.radiusY;
      for (const value of polygon) {
        coordinates[coordinateOffset++] = value;
        hashState = appendChunkHash(hashState, value);
      }
      const minimumTileX = Math.floor(
        bounds[contourIndex * 4]! / STUDIO_DRY_MEDIA_UNION_CHUNK_DOCUMENT_TILE_SIZE,
      );
      const minimumTileY = Math.floor(
        bounds[contourIndex * 4 + 1]! / STUDIO_DRY_MEDIA_UNION_CHUNK_DOCUMENT_TILE_SIZE,
      );
      const maximumTileX = Math.floor(
        bounds[contourIndex * 4 + 2]! / STUDIO_DRY_MEDIA_UNION_CHUNK_DOCUMENT_TILE_SIZE,
      );
      const maximumTileY = Math.floor(
        bounds[contourIndex * 4 + 3]! / STUDIO_DRY_MEDIA_UNION_CHUNK_DOCUMENT_TILE_SIZE,
      );
      const referenceColumns = maximumTileX - minimumTileX + 1;
      const referenceRows = maximumTileY - minimumTileY + 1;
      if (
        !Number.isSafeInteger(referenceColumns)
        || !Number.isSafeInteger(referenceRows)
        || referenceColumns <= 0
        || referenceRows <= 0
        || !Number.isSafeInteger(referenceColumns * referenceRows)
      ) return null;
      const globalContourId = firstContourId + contourIndex;
      for (let tileY = minimumTileY; tileY <= maximumTileY; tileY += 1) {
        for (let tileX = minimumTileX; tileX <= maximumTileX; tileX += 1) {
          const key = chunkTileKey(tileX, tileY);
          if (key === null) return null;
          const assigned = tileAssignments.get(key) ?? [];
          assigned.push(globalContourId);
          tileAssignments.set(key, assigned);
          tileReferenceCount += 1;
        }
      }
      contourIndex += 1;
    }
  }
  const allocatedTileBlockCount = [...tileAssignments.values()].reduce(
    (count, contourIds) => count
      + Math.ceil(contourIds.length / CHUNK_TILE_INDEX_BLOCK_LENGTH),
    0,
  );
  const residentByteLength = typedPayloadBytes
    + CHUNK_BATCH_CONTAINER_BYTE_CHARGE
    + allocatedTileBlockCount
      * CHUNK_TILE_INDEX_BLOCK_LENGTH * Uint32Array.BYTES_PER_ELEMENT
    + tileAssignments.size * CHUNK_TILE_MAP_ENTRY_BYTE_CHARGE;
  if (
    !Number.isSafeInteger(residentByteLength)
    || residentByteLength > STUDIO_DRY_MEDIA_UNION_CHUNK_PAGE_BYTE_BUDGET
  ) return null;
  return {
    batch: {
      firstContourId,
      coordinates,
      offsets,
      lengths,
      entryIndexes,
      bounds,
      visitStamps: new Uint32Array(contourCount),
    },
    tileAssignments,
    tileReferenceCount,
    residentByteLength,
    hashA: hashState[0],
    hashB: hashState[1],
    hashC: hashState[2],
    hashD: hashState[3],
  };
}

function appendTileIndexReference(index: ChunkedTileIndex, contourId: number): void {
  const blockIndex = Math.floor(index.length / CHUNK_TILE_INDEX_BLOCK_LENGTH);
  const offset = index.length % CHUNK_TILE_INDEX_BLOCK_LENGTH;
  let block = index.blocks[blockIndex];
  if (!block) {
    block = new Uint32Array(CHUNK_TILE_INDEX_BLOCK_LENGTH);
    index.blocks.push(block);
  }
  block[offset] = contourId;
  index.length += 1;
}

function applyPreparedChunkedBatch(
  data: ChunkedUnionAuthorityData,
  prepared: PreparedChunkedUnionBatch,
): boolean {
  const batchBytes = prepared.batch.coordinates.byteLength
    + prepared.batch.offsets.byteLength
    + prepared.batch.lengths.byteLength
    + prepared.batch.entryIndexes.byteLength
    + prepared.batch.bounds.byteLength
    + prepared.batch.visitStamps.byteLength;
  if (!Number.isSafeInteger(data.contourCount + prepared.batch.offsets.length)) {
    return false;
  }
  data.batches.push(prepared.batch);
  let newTileBlocks = 0;
  let newTileKeys = 0;
  for (const [key, contourIds] of prepared.tileAssignments) {
    let index = data.tileIndex.get(key);
    if (!index) {
      index = { blocks: [], length: 0 };
      newTileKeys += 1;
    }
    const previousBlockCount = index.blocks.length;
    for (const contourId of contourIds) appendTileIndexReference(index, contourId);
    newTileBlocks += index.blocks.length - previousBlockCount;
    data.tileIndex.set(key, index);
  }
  data.contourCount += prepared.batch.offsets.length;
  data.coordinateCount += prepared.batch.coordinates.length;
  data.tileReferenceCount += prepared.tileReferenceCount;
  data.residentByteLength += batchBytes
    + CHUNK_BATCH_CONTAINER_BYTE_CHARGE
    + newTileBlocks
      * CHUNK_TILE_INDEX_BLOCK_LENGTH * Uint32Array.BYTES_PER_ELEMENT
    + newTileKeys * CHUNK_TILE_MAP_ENTRY_BYTE_CHARGE;
  data.hashA = prepared.hashA;
  data.hashB = prepared.hashB;
  data.hashC = prepared.hashC;
  data.hashD = prepared.hashD;
  return true;
}

function chunkEntriesFromMarks(
  marks: readonly StudioDryMediaUnionRibbonCoverageMark[],
): ChunkedUnionEntry[] | null {
  const entries: ChunkedUnionEntry[] = [];
  for (const mark of marks) {
    const bounds = polygonBounds(mark.ribbon.polygons);
    if (!bounds || mark.alpha !== 1 || typeof mark.color !== "string") return null;
    entries.push({
      color: mark.color,
      ribbonVersion: mark.ribbon.version,
      minimumX: bounds.x - bounds.radiusX,
      minimumY: bounds.y - bounds.radiusY,
      maximumX: bounds.x + bounds.radiusX,
      maximumY: bounds.y + bounds.radiusY,
    });
  }
  return entries.length > 0 ? entries : null;
}

export function createStudioDryMediaUnionChunkAuthority(
  marks: readonly StudioDryMediaUnionRibbonCoverageMark[],
): StudioDryMediaUnionChunkAuthorityReceipt | null {
  const entries = chunkEntriesFromMarks(marks);
  if (!entries) return null;
  const data: ChunkedUnionAuthorityData = {
    entries,
    batches: [],
    tileIndex: new Map(),
    contourCount: 0,
    coordinateCount: 0,
    tileReferenceCount: 0,
    residentByteLength: entries.length * CHUNK_ENTRY_BYTE_CHARGE,
    hashA: 0x811c_9dc5,
    hashB: 0x9e37_79b9,
    hashC: 0x85eb_ca6b,
    hashD: 0xc2b2_ae35,
    visitGeneration: 0,
    latestAuthority: null,
    pendingCandidate: null,
  };
  const prepared = prepareChunkedUnionBatch(
    marks,
    0,
    [data.hashA, data.hashB, data.hashC, data.hashD],
  );
  if (!prepared || !applyPreparedChunkedBatch(data, prepared)) return null;
  const view = chunkAuthorityView(data);
  const receipt = chunkAuthorityReceipt(view);
  data.latestAuthority = receipt;
  chunkAuthorityData.set(receipt, view);
  return receipt;
}

export function appendStudioDryMediaUnionChunkAuthority(
  receipt: StudioDryMediaUnionChunkAuthorityReceipt,
  suffixMarks: readonly StudioDryMediaUnionRibbonCoverageMark[],
): StudioDryMediaUnionChunkAuthorityReceipt | null {
  const candidate = prepareStudioDryMediaUnionChunkAuthorityAppend(
    receipt,
    suffixMarks,
  );
  return candidate
    ? commitStudioDryMediaUnionChunkAuthorityAppend(candidate)
    : null;
}

/**
 * Builds an append candidate without advancing the committed tail. The renderer may inspect and
 * raster this receipt, then either commit it or abort it; a failed surface update therefore never
 * makes a retry append the same suffix twice.
 */
export function prepareStudioDryMediaUnionChunkAuthorityAppend(
  receipt: StudioDryMediaUnionChunkAuthorityReceipt,
  suffixMarks: readonly StudioDryMediaUnionRibbonCoverageMark[],
): StudioDryMediaUnionChunkAuthorityReceipt | null {
  const previous = chunkAuthorityData.get(receipt);
  const data = previous?.storage;
  if (
    !previous
    || !data
    || data.pendingCandidate !== null
    || data.latestAuthority !== receipt
    || suffixMarks.length !== previous.entries.length
  ) return null;
  for (const [entryIndex, mark] of suffixMarks.entries()) {
    const entry = previous.entries[entryIndex];
    if (
      !entry
      || mark.color !== entry.color
      || mark.alpha !== 1
      || mark.ribbon.version !== entry.ribbonVersion
    ) return null;
  }
  const prepared = prepareChunkedUnionBatch(
    suffixMarks,
    previous.contourCount,
    [previous.hashA, previous.hashB, previous.hashC, previous.hashD],
  );
  if (!prepared) return null;
  const previousTileLengths = new Map<number, number>();
  for (const key of prepared.tileAssignments.keys()) {
    previousTileLengths.set(key, data.tileIndex.get(key)?.length ?? 0);
  }
  if (!applyPreparedChunkedBatch(data, prepared)) return null;
  for (const [entryIndex, mark] of suffixMarks.entries()) {
    const bounds = polygonBounds(mark.ribbon.polygons)!;
    const entry = data.entries[entryIndex]!;
    entry.minimumX = Math.min(entry.minimumX, bounds.x - bounds.radiusX);
    entry.minimumY = Math.min(entry.minimumY, bounds.y - bounds.radiusY);
    entry.maximumX = Math.max(entry.maximumX, bounds.x + bounds.radiusX);
    entry.maximumY = Math.max(entry.maximumY, bounds.y + bounds.radiusY);
  }
  const candidateView = chunkAuthorityView(data);
  const candidate = chunkAuthorityReceipt(candidateView);
  data.pendingCandidate = candidate;
  chunkAuthorityData.set(candidate, candidateView);
  chunkAuthorityPending.set(candidate, {
    previous: receipt,
    candidate,
    prepared,
    previousTileLengths,
  });
  return candidate;
}

export function commitStudioDryMediaUnionChunkAuthorityAppend(
  candidate: StudioDryMediaUnionChunkAuthorityReceipt,
): StudioDryMediaUnionChunkAuthorityReceipt | null {
  const pending = chunkAuthorityPending.get(candidate);
  const view = chunkAuthorityData.get(candidate);
  const data = view?.storage;
  if (!pending || !view || !data || data.pendingCandidate !== candidate) return null;
  data.pendingCandidate = null;
  data.latestAuthority = candidate;
  chunkAuthorityPending.delete(candidate);
  return candidate;
}

export function abortStudioDryMediaUnionChunkAuthorityAppend(
  candidate: StudioDryMediaUnionChunkAuthorityReceipt,
): boolean {
  const pending = chunkAuthorityPending.get(candidate);
  const candidateView = chunkAuthorityData.get(candidate);
  const previousView = pending
    ? chunkAuthorityData.get(pending.previous)
    : null;
  const data = candidateView?.storage;
  if (
    !pending
    || !candidateView
    || !previousView
    || !data
    || data.pendingCandidate !== candidate
    || data.batches.at(-1) !== pending.prepared.batch
  ) return false;
  data.batches.pop();
  for (const [key, previousLength] of pending.previousTileLengths) {
    const index = data.tileIndex.get(key);
    if (!index || index.length < previousLength) return false;
    if (previousLength === 0) {
      data.tileIndex.delete(key);
      continue;
    }
    index.length = previousLength;
    index.blocks.length = Math.ceil(previousLength / CHUNK_TILE_INDEX_BLOCK_LENGTH);
  }
  data.entries = snapshotChunkEntries(previousView.entries) as ChunkedUnionEntry[];
  data.contourCount = previousView.contourCount;
  data.coordinateCount = previousView.coordinateCount;
  data.tileReferenceCount = previousView.tileReferenceCount;
  data.residentByteLength = previousView.residentByteLength;
  data.hashA = previousView.hashA;
  data.hashB = previousView.hashB;
  data.hashC = previousView.hashC;
  data.hashD = previousView.hashD;
  data.pendingCandidate = null;
  chunkAuthorityPending.delete(candidate);
  chunkAuthorityData.delete(candidate);
  return true;
}

export function snapshotStudioDryMediaUnionChunkAuthority(
  receipt: StudioDryMediaUnionChunkAuthorityReceipt,
): readonly StudioDryMediaUnionChunkedRibbonCoverageMark[] | null {
  const view = chunkAuthorityData.get(receipt);
  if (!view) return null;
  return Object.freeze(view.entries.map((entry, entryIndex) => Object.freeze({
    x: quantize((entry.minimumX + entry.maximumX) / 2),
    y: quantize((entry.minimumY + entry.maximumY) / 2),
    radiusX: quantize(Math.max(0.25, (entry.maximumX - entry.minimumX) / 2)),
    radiusY: quantize(Math.max(0.25, (entry.maximumY - entry.minimumY) / 2)),
    angleRadians: 0,
    alpha: 1,
    color: entry.color,
    ribbon: Object.freeze({
      kind: "dry-media-union-ribbon-chunks-v2" as const,
      version: STUDIO_DRY_MEDIA_UNION_CHUNKED_RIBBON_VERSION,
      role: "stroke-union" as const,
      authority: receipt,
      entryIndex,
      polygons: Object.freeze([]) as readonly [],
    }),
  })));
}

function locateChunkedContour(
  data: Pick<ChunkedUnionAuthorityData, "batches">,
  contourId: number,
): Readonly<{ batch: ChunkedUnionBatch; localIndex: number }> | null {
  let minimum = 0;
  let maximum = data.batches.length - 1;
  while (minimum <= maximum) {
    const middle = (minimum + maximum) >>> 1;
    const batch = data.batches[middle]!;
    if (contourId < batch.firstContourId) {
      maximum = middle - 1;
    } else if (contourId >= batch.firstContourId + batch.offsets.length) {
      minimum = middle + 1;
    } else {
      return { batch, localIndex: contourId - batch.firstContourId };
    }
  }
  return null;
}

function chunkBoundsIntersect(
  batch: ChunkedUnionBatch,
  localIndex: number,
  bounds: StudioDryMediaUnionChunkedBounds,
): boolean {
  const offset = localIndex * 4;
  return batch.bounds[offset]! <= bounds.maximumX
    && batch.bounds[offset + 1]! <= bounds.maximumY
    && batch.bounds[offset + 2]! >= bounds.minimumX
    && batch.bounds[offset + 3]! >= bounds.minimumY;
}

function appendChunkedContourToPath(
  target: StudioDryMediaUnionChunkedPathTarget,
  batch: ChunkedUnionBatch,
  localIndex: number,
): void {
  const offset = batch.offsets[localIndex]!;
  const length = batch.lengths[localIndex]!;
  target.moveTo(batch.coordinates[offset]!, batch.coordinates[offset + 1]!);
  for (let index = 2; index < length; index += 2) {
    target.lineTo(
      batch.coordinates[offset + index]!,
      batch.coordinates[offset + index + 1]!,
    );
  }
  target.closePath();
}

export function appendStudioDryMediaUnionChunkedPath(
  target: StudioDryMediaUnionChunkedPathTarget,
  ribbon: StudioDryMediaUnionChunkedRibbonPolygon,
  options: Readonly<{
    bounds?: StudioDryMediaUnionChunkedBounds;
    maximumContours?: number;
  }> = {},
): StudioDryMediaUnionChunkedPathResult {
  const view = chunkAuthorityData.get(ribbon.authority);
  if (!view) {
    return Object.freeze({
      status: "rejected",
      reason: "stale-authority",
      contourCount: 0,
    });
  }
  if (
    !Number.isSafeInteger(ribbon.entryIndex)
    || ribbon.entryIndex < 0
    || ribbon.entryIndex >= view.entries.length
  ) {
    return Object.freeze({
      status: "rejected",
      reason: "invalid-entry",
      contourCount: 0,
    });
  }
  const maximumContours = Number.isFinite(options.maximumContours)
    ? Math.max(0, Math.floor(options.maximumContours!))
    : Number.POSITIVE_INFINITY;
  let contourCount = 0;
  const appendLocated = (batch: ChunkedUnionBatch, localIndex: number): boolean => {
    if (
      batch.entryIndexes[localIndex] !== ribbon.entryIndex
      || (options.bounds && !chunkBoundsIntersect(batch, localIndex, options.bounds))
    ) return true;
    contourCount += 1;
    if (contourCount > maximumContours) return false;
    appendChunkedContourToPath(target, batch, localIndex);
    return true;
  };

  if (!options.bounds) {
    for (const batch of view.storage.batches) {
      for (let localIndex = 0; localIndex < batch.offsets.length; localIndex += 1) {
        if (batch.firstContourId + localIndex >= view.contourCount) break;
        if (!appendLocated(batch, localIndex)) {
          return Object.freeze({
            status: "rejected",
            reason: "contour-work-budget",
            contourCount,
          });
        }
      }
    }
    return Object.freeze({ status: "appended", contourCount });
  }

  const data = view.storage;
  data.visitGeneration = data.visitGeneration >= 0xffff_fffe
    ? 1
    : data.visitGeneration + 1;
  if (data.visitGeneration === 1) {
    for (const batch of data.batches) batch.visitStamps.fill(0);
  }
  const generation = data.visitGeneration;
  const candidateIds: number[] = [];
  const minimumTileX = Math.floor(
    options.bounds.minimumX / STUDIO_DRY_MEDIA_UNION_CHUNK_DOCUMENT_TILE_SIZE,
  );
  const minimumTileY = Math.floor(
    options.bounds.minimumY / STUDIO_DRY_MEDIA_UNION_CHUNK_DOCUMENT_TILE_SIZE,
  );
  const maximumTileX = Math.floor(
    options.bounds.maximumX / STUDIO_DRY_MEDIA_UNION_CHUNK_DOCUMENT_TILE_SIZE,
  );
  const maximumTileY = Math.floor(
    options.bounds.maximumY / STUDIO_DRY_MEDIA_UNION_CHUNK_DOCUMENT_TILE_SIZE,
  );
  for (let tileY = minimumTileY; tileY <= maximumTileY; tileY += 1) {
    for (let tileX = minimumTileX; tileX <= maximumTileX; tileX += 1) {
      const key = chunkTileKey(tileX, tileY);
      if (key === null) continue;
      const index = data.tileIndex.get(key);
      if (!index) continue;
      for (let reference = 0; reference < index.length; reference += 1) {
        const block = index.blocks[
          Math.floor(reference / CHUNK_TILE_INDEX_BLOCK_LENGTH)
        ]!;
        const contourId = block[reference % CHUNK_TILE_INDEX_BLOCK_LENGTH]!;
        if (contourId >= view.contourCount) continue;
        const located = locateChunkedContour(data, contourId);
        if (!located) continue;
        if (located.batch.visitStamps[located.localIndex] === generation) continue;
        located.batch.visitStamps[located.localIndex] = generation;
        if (
          located.batch.entryIndexes[located.localIndex] !== ribbon.entryIndex
          || !chunkBoundsIntersect(located.batch, located.localIndex, options.bounds)
        ) continue;
        candidateIds.push(contourId);
        if (candidateIds.length > maximumContours) {
          return Object.freeze({
            status: "rejected",
            reason: "contour-work-budget",
            contourCount: candidateIds.length,
          });
        }
      }
    }
  }
  candidateIds.sort((left, right) => left - right);
  for (const contourId of candidateIds) {
    const located = locateChunkedContour(data, contourId);
    if (!located || !appendLocated(located.batch, located.localIndex)) {
      return Object.freeze({
        status: "rejected",
        reason: "contour-work-budget",
        contourCount,
      });
    }
  }
  return Object.freeze({ status: "appended", contourCount });
}

export function inspectStudioDryMediaUnionChunkAuthority(
  receipt: StudioDryMediaUnionChunkAuthorityReceipt,
): StudioDryMediaUnionChunkAuthorityReceipt | null {
  const data = chunkAuthorityData.get(receipt);
  if (!data) return null;
  return receipt.contract === CHUNK_AUTHORITY_CONTRACT
      && receipt.version === CHUNK_AUTHORITY_VERSION
      && receipt.entryCount === data.entries.length
      && receipt.contourCount === data.contourCount
      && receipt.coordinateCount === data.coordinateCount
      && receipt.tileReferenceCount === data.tileReferenceCount
      && receipt.residentByteLength === data.residentByteLength
      && receipt.estimatedByteLength === data.residentByteLength
      && receipt.geometryDigest === chunkGeometryDigest(data)
    ? receipt
    : null;
}
