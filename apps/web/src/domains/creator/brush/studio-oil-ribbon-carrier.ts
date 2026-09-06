/**
 * Continuous carrier for oil/acrylic paint.
 *
 * `planOilBrushDabs` remains the deterministic pressure/material station planner, but rendering
 * every station as an ellipse exposes a row of beads on long strokes. This adapter converts those
 * stations into one variable-width, direction-following body and five continuous bristle lanes.
 * Canvas and SVG consume the same quantized geometry.
 */

import {
  StudioBristlePhysicsOilPlanner,
  planStudioBristlePhysicsOil,
  type StudioBristlePhysicsOilPlan,
} from "./studio-bristle-physics-oil-v1";
import {
  studioOilRibbonProgramsFromSet,
  type StudioBrushOilProgramSet,
} from "./studio-brush-engine-program-set";
import { STUDIO_BRUSH_RETAINED_DRAFT_SYMMETRY_VARIATIONS } from "./studio-brush-symmetry";
import {
  StudioOilBristleLoadDynamicsPlanner,
  planStudioOilBristleLoadDynamics,
  type StudioOilBristleLoadDynamicsPlan,
} from "./studio-oil-bristle-load-dynamics-v1";
import {
  STUDIO_OIL_PHYSICS_REST_RADIUS_ANCHOR_STATIONS,
  STUDIO_OIL_RIBBON_CARRIER_VERSION,
  type OilCarrierStation,
  type SmoothedOilCarrierGeometry,
  type StudioOilRibbonBristleLane,
  type StudioOilRibbonCarrierBristleLoadDynamicsOptions,
  type StudioOilRibbonCarrierBristlePhysicsOptions,
  type StudioOilRibbonCarrierOptions,
  type StudioOilRibbonCarrierPlan,
  type StudioOilRibbonPath,
  type StudioOilRibbonPathSink,
} from "./studio-oil-ribbon-carrier-types";
import {
  STUDIO_OIL_IMPASTO_RELIEF_HIGHLIGHT_COLOR,
  STUDIO_OIL_IMPASTO_RELIEF_OVERLAY_VERSION,
  StudioImpastoReliefPlanner,
  buildImpastoReliefField,
  planImpastoReliefOverlayLanes,
  type ImpastoDirtyRect,
  type ImpastoFilmCursor,
  type ImpastoReliefField,
  type ImpastoReliefFieldSnapshot,
  type ImpastoReliefGrid,
  type ImpastoReliefPoint,
  type ImpastoReliefRunShape,
  type PlannedImpastoReliefRun,
} from "./studio-oil-ribbon-impasto-relief";
import {
  paintStudioOilRibbonCarrier,
  paintStudioOilRibbonCarrierOverlay,
  paintStudioOilRibbonHit,
  studioOilRibbonPaintIsHitPass,
} from "./studio-oil-ribbon-paint";
import { applyStudioOilWetIntoWetStroke } from "./studio-oil-wet-into-wet";

import type { FxOilDab } from "../studio-fx-brush";

export * from "./studio-oil-ribbon-carrier-types";

export {
  STUDIO_OIL_IMPASTO_RELIEF_HIGHLIGHT_COLOR,
  STUDIO_OIL_IMPASTO_RELIEF_OVERLAY_VERSION,
  StudioImpastoReliefPlanner,
  applyStudioOilWetIntoWetStroke,
  buildImpastoReliefField,
  paintStudioOilRibbonCarrier,
  paintStudioOilRibbonCarrierOverlay,
  paintStudioOilRibbonHit,
  planImpastoReliefOverlayLanes,
  studioOilRibbonPaintIsHitPass,
  type ImpastoDirtyRect,
  type ImpastoFilmCursor,
  type ImpastoReliefField,
  type ImpastoReliefFieldSnapshot,
  type ImpastoReliefGrid,
  type ImpastoReliefPoint,
  type ImpastoReliefRunShape,
  type PlannedImpastoReliefRun,
};

const COORDINATE_LIMIT = 1_000_000;
const GEOMETRY_QUANTIZATION = 10_000;
const POINT_EPSILON = 1e-6;

/**
 * Which carrier programs a given oil/acrylic lane runs.
 *
 * This replaces an either/or `brush === ...` chain that was duplicated in the Canvas renderer and
 * the SVG exporter. The chain could only ever grant ONE program, so a lane could not be both
 * loaded and impasto, and every lane that was not one of the three demo ids fell through to the
 * plain carrier - which is why oil--filbert-ribbon, oil--impasto-ribbon and brush--oil-lanes all
 * painted the same bed. Returning the option object from one place makes combinations expressible
 * and keeps the two renderers from drifting into disagreeing about a stroke's programs.
 *
 * The matrix is physical, not decorative:
 * - a filbert is a loaded tuft, so it splays under pressure          -> bristlePhysics
 * - impasto is that same tuft leaving standing ridges                -> bristlePhysics + relief
 * - flat and acrylic-stiff declare a HARD tip: flat instruments whose mechanism is not tuft
 *   splay, so they stay off the sim (acrylic is already separated by its fast-setting body)
 * - brush--oil-lanes stays plain, which is what now distinguishes it from the filbert
 * - the product oil/acrylic beds run all three: a loaded tuft that depletes as it travels and
 *   leaves ridges is what those tools sell
 */
export function studioOilRibbonProgramsForBrush(
  brush: string,
  seed: number,
  /**
   * A program set carried by the stroke or the saved brush. When present it REPLACES the id
   * matrix below rather than merging with it, because a user brush's program set is a complete
   * statement of what that brush is - merging would make it impossible to turn a preset's own
   * program off. Absent, the matrix runs unchanged and every shipped preset keeps a byte-identical
   * plan, which the program-set contract test pins for all seven ids and the default.
   */
  programs?: StudioBrushOilProgramSet | null,
): StudioOilRibbonCarrierOptions | undefined {
  if (programs) return studioOilRibbonProgramsFromSet(programs, seed);
  const bristlePhysics = { enabled: true, seed } as const;
  switch (brush) {
    case "brush--bristle-physics":
      // The mechanics showcase runs BOTH mechanical programs. It has to stay distinguishable from
      // oil--filbert-ribbon, which now also runs the sim: with the sim alone the two planned
      // identical beds (same lane widths, same opacities). Quarantining the demo instead is not
      // available - it is a pinned experimental lane and the governance audit keeps it through its
      // lab period - so it earns its own identity rather than losing its row.
      return { bristlePhysics, bristleLoadDynamics: { enabled: true, seed } };
    case "brush--bristle-depletion":
      return { bristleLoadDynamics: { enabled: true, seed } };
    case "brush--impasto-relief":
      return { impastoRelief: { enabled: true } };
    case "oil--filbert-ribbon":
      return { bristlePhysics };
    case "oil--impasto-ribbon":
      return { bristlePhysics, impastoRelief: { enabled: true } };
    case "oil":
    case "acrylic":
      return { bristlePhysics, bristleLoadDynamics: { enabled: true, seed }, impastoRelief: { enabled: true } };
    default:
      return undefined;
  }
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

function quantizedPoints(points: readonly number[]): readonly number[] {
  return Object.freeze(points.map(quantize));
}

function accumulatedOpacity(opacity: number, overlapCount: number): number {
  const normalized = clamp(finite(opacity, 0), 0, 1);
  return clamp(1 - ((1 - normalized) ** overlapCount), 0, 0.96);
}

function normalizedDabs(dabs: readonly FxOilDab[]): readonly FxOilDab[] {
  const accepted: FxOilDab[] = [];
  for (const dab of dabs) {
    if (!Number.isFinite(dab.x) || !Number.isFinite(dab.y)) continue;
    accepted.push(dab);
  }
  return accepted;
}

function weightedMovingAverage(
  values: ArrayLike<number>,
  index: number,
  radius: number,
): number {
  let weighted = 0;
  let totalWeight = 0;
  const len = values.length;
  const start = Math.max(0, index - radius);
  const end = Math.min(len - 1, index + radius);
  for (let pos = start; pos <= end; pos += 1) {
    const sample = values[pos]!;
    const weight = radius + 1 - Math.abs(pos - index);
    weighted += sample * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? weighted / totalWeight : values[index] ?? 0;
}

/**
 * Widest smoothing radius any channel below reads, so an entry is settled once its whole window
 * lies inside the verified dab prefix. Keep in step with the `weightedMovingAverage` radii.
 */
const OIL_GEOMETRY_SMOOTHING_RADIUS = 6;

/**
 * Neighbour reach of `tangentAt`, so a station is settled this far behind the settled geometry.
 *
 * Shared with `tangentAt` on purpose. The reuse chain rests on the settled boundary being at
 * least as deep as the widest window any settled entry reads, and widening the tangent stencil is
 * an ordinary quality change — so the two must not be able to drift. The suite cannot catch that
 * drift: the stations a one-entry-too-generous boundary reuses differ below `quantize`'s step, so
 * every plan still compares equal while the prefix argument has stopped being true.
 */
const OIL_STATION_TANGENT_RADIUS = 2;

function smoothGeometry(dabs: readonly FxOilDab[]): readonly SmoothedOilCarrierGeometry[] {
  return smoothGeometryFrom(dabs, [], 0);
}

/**
 * Smoothed geometry for `dabs`, keeping the first `settled` entries of `cached`.
 *
 * A caller may only pass a non-zero `settled` once it has proven that `dabs` shares a byte-equal
 * prefix with the array `cached` was built from AND that `settled + OIL_GEOMETRY_SMOOTHING_RADIUS`
 * still lands inside it: every kept entry then read the same window, with the same edge clamps, as
 * it would on a full rebuild. The raw channel arrays are refilled whole — four typed-array writes
 * per dab, against thirteen multiply-adds per channel in the window walk this skips.
 */
function smoothGeometryFrom(
  dabs: readonly FxOilDab[],
  cached: readonly SmoothedOilCarrierGeometry[],
  settled: number,
): readonly SmoothedOilCarrierGeometry[] {
  const len = dabs.length;
  const xs = new Float64Array(len);
  const ys = new Float64Array(len);
  const radiusXs = new Float64Array(len);
  const radiusYs = new Float64Array(len);
  for (let i = 0; i < len; i += 1) {
    const dab = dabs[i]!;
    xs[i] = dab.x;
    ys[i] = dab.y;
    radiusXs[i] = dab.radiusX;
    radiusYs[i] = dab.radiusY;
  }
  const from = Math.max(0, Math.min(settled, len, cached.length));
  const result: SmoothedOilCarrierGeometry[] = new Array(len);
  for (let index = 0; index < from; index += 1) result[index] = cached[index]!;
  for (let index = from; index < len; index += 1) {
    const dab = dabs[index]!;
    result[index] = Object.freeze({
      // Normal-offset jitter belonged to the old overlapping-dab texture. Smooth it out of the
      // silhouette; the five explicit bristle lanes now own all high-frequency material detail.
      x: index === 0 || index === len - 1
        ? dab.x
        : weightedMovingAverage(xs, index, 3),
      y: index === 0 || index === len - 1
        ? dab.y
        : weightedMovingAverage(ys, index, 3),
      radiusX: weightedMovingAverage(radiusXs, index, 4),
      // Radius jitter is intentionally filtered more strongly than the centreline. Without this
      // separation a one-pixel sawtooth appears on both edges of an otherwise continuous ribbon.
      radiusY: weightedMovingAverage(radiusYs, index, 6),
    });
  }
  return Object.freeze(result);
}

function tangentAt(
  geometry: readonly SmoothedOilCarrierGeometry[],
  index: number,
  fallbackAngle: number,
): readonly [number, number] {
  const current = geometry[index]!;
  const before = geometry[Math.max(0, index - OIL_STATION_TANGENT_RADIUS)] ?? current;
  const after = geometry[
    Math.min(geometry.length - 1, index + OIL_STATION_TANGENT_RADIUS)
  ] ?? current;
  let dx = after.x - before.x;
  let dy = after.y - before.y;
  let length = Math.sqrt(dx * dx + dy * dy);
  if (length <= POINT_EPSILON) {
    dx = Math.cos(finite(fallbackAngle, 0));
    dy = Math.sin(finite(fallbackAngle, 0));
    length = Math.max(POINT_EPSILON, Math.sqrt(dx * dx + dy * dy));
  }
  return [dx / length, dy / length];
}

function collectStations(dabs: readonly FxOilDab[]): readonly OilCarrierStation[] {
  return collectStationsFrom(dabs, smoothGeometry(dabs), [], 0);
}

/**
 * Stations for `geometry`, keeping the first `settled` entries of `cached`.
 *
 * `tangentAt` reads ±2 neighbours, so a station is settled two entries behind the settled
 * geometry; the caller owns that arithmetic (`StudioOilRibbonCarrierPlanner`).
 */
function collectStationsFrom(
  dabs: readonly FxOilDab[],
  geometry: readonly SmoothedOilCarrierGeometry[],
  cached: readonly OilCarrierStation[],
  settled: number,
): readonly OilCarrierStation[] {
  const from = Math.max(0, Math.min(settled, dabs.length, cached.length));
  return Object.freeze(dabs.map((source, index) => {
    if (index < from) return cached[index]!;
    const planned = geometry[index]!;
    const [tangentX, tangentY] = tangentAt(geometry, index, source.angleRad);
    return Object.freeze({
      x: quantize(planned.x),
      y: quantize(planned.y),
      tangentX,
      tangentY,
      normalX: -tangentY,
      normalY: tangentX,
      radiusX: clamp(finite(planned.radiusX, 0.4), 0.05, COORDINATE_LIMIT / 4),
      radiusY: clamp(finite(planned.radiusY, 0.25), 0.05, COORDINATE_LIMIT / 4),
      opacity: clamp(finite(source.opacity, 0), 0, 1),
      source,
    });
  }));
}

function directionalTap(station: OilCarrierStation): StudioOilRibbonPath {
  const axis = Math.max(station.radiusX, station.radiusY * 1.25);
  const cross = station.radiusY;
  const diagonalAxis = axis * 0.68;
  const diagonalCross = cross * 0.72;
  const { x, y, tangentX: tx, tangentY: ty, normalX: nx, normalY: ny } = station;
  return Object.freeze({
    points: quantizedPoints([
      x + tx * axis,
      y + ty * axis,
      x + tx * diagonalAxis + nx * diagonalCross,
      y + ty * diagonalAxis + ny * diagonalCross,
      x + nx * cross,
      y + ny * cross,
      x - tx * diagonalAxis + nx * diagonalCross,
      y - ty * diagonalAxis + ny * diagonalCross,
      x - tx * axis,
      y - ty * axis,
      x - tx * diagonalAxis - nx * diagonalCross,
      y - ty * diagonalAxis - ny * diagonalCross,
      x - nx * cross,
      y - ny * cross,
      x + tx * diagonalAxis - nx * diagonalCross,
      y + ty * diagonalAxis - ny * diagonalCross,
    ]),
  });
}

/**
 * Directional cap the body overhangs its first and last station by.
 *
 * Shared with the bristle lanes on purpose. The body used to own these numbers privately and the
 * hairs stopped dead at the outermost station, so both ends of every oil stroke were up to 0.96
 * half-widths of smooth untextured pigment - a blunt blob stuck on a bed that is otherwise all
 * ridge and furrow, at exactly the two places a viewer looks first. Extracting the shoulder lets
 * `bristleCapPoint` place hair tips inside the same outline instead of guessing at it.
 */
const OIL_BODY_CAP_AXIS_SCALE = 0.56;
const OIL_BODY_CAP_RADIUS_SCALE = 0.96;
/** Where the cap's widest point sits, as a fraction of the cap, and its half-width there. */
const OIL_BODY_CAP_SHOULDER = 0.5;
const OIL_BODY_CAP_SHOULDER_WIDTH = 0.84;

function bodyCapLength(station: OilCarrierStation): number {
  return Math.min(
    station.radiusX * OIL_BODY_CAP_AXIS_SCALE,
    station.radiusY * OIL_BODY_CAP_RADIUS_SCALE,
  );
}

/**
 * Where a hair carrying `offset` reaches into the cap, one station past the end of the path.
 *
 * The tip stops at the cap's shoulder rather than its point, and its offset is scaled by the
 * shoulder's own half-width, so the hair lands just inside the body outline. Running it to the
 * point instead would push the outer hairs past the closing pigment and leave them hanging in
 * open space; leaving the last stretch to smooth body is also what a loaded brush does, since the
 * film closes over the hairs where they lift off.
 */
function bristleCapPoint(
  station: OilCarrierStation,
  offset: number,
  direction: 1 | -1,
): readonly [number, number] {
  const reach = bodyCapLength(station) * OIL_BODY_CAP_SHOULDER * direction;
  return [
    station.x + station.tangentX * reach + station.normalX * offset * OIL_BODY_CAP_SHOULDER_WIDTH,
    station.y + station.tangentY * reach + station.normalY * offset * OIL_BODY_CAP_SHOULDER_WIDTH,
  ];
}

function variableWidthBody(stations: readonly OilCarrierStation[]): StudioOilRibbonPath {
  const first = stations[0]!;
  const last = stations.at(-1)!;
  const firstCap = bodyCapLength(first);
  const lastCap = bodyCapLength(last);
  const points: number[] = [
    first.x - first.tangentX * firstCap,
    first.y - first.tangentY * firstCap,
    first.x - first.tangentX * firstCap * OIL_BODY_CAP_SHOULDER
      + first.normalX * first.radiusY * OIL_BODY_CAP_SHOULDER_WIDTH,
    first.y - first.tangentY * firstCap * OIL_BODY_CAP_SHOULDER
      + first.normalY * first.radiusY * OIL_BODY_CAP_SHOULDER_WIDTH,
  ];

  for (const station of stations) {
    points.push(
      station.x + station.normalX * station.radiusY,
      station.y + station.normalY * station.radiusY,
    );
  }
  const lastShoulder = lastCap * OIL_BODY_CAP_SHOULDER;
  const lastShoulderWidth = last.radiusY * OIL_BODY_CAP_SHOULDER_WIDTH;
  points.push(
    last.x + last.tangentX * lastShoulder + last.normalX * lastShoulderWidth,
    last.y + last.tangentY * lastShoulder + last.normalY * lastShoulderWidth,
    last.x + last.tangentX * lastCap,
    last.y + last.tangentY * lastCap,
    last.x + last.tangentX * lastShoulder - last.normalX * lastShoulderWidth,
    last.y + last.tangentY * lastShoulder - last.normalY * lastShoulderWidth,
  );
  for (let index = stations.length - 1; index >= 0; index -= 1) {
    const station = stations[index]!;
    points.push(
      station.x - station.normalX * station.radiusY,
      station.y - station.normalY * station.radiusY,
    );
  }
  points.push(
    first.x - first.tangentX * firstCap * OIL_BODY_CAP_SHOULDER
      - first.normalX * first.radiusY * OIL_BODY_CAP_SHOULDER_WIDTH,
    first.y - first.tangentY * firstCap * OIL_BODY_CAP_SHOULDER
      - first.normalY * first.radiusY * OIL_BODY_CAP_SHOULDER_WIDTH,
  );
  return Object.freeze({ points: quantizedPoints(points) });
}

/**
 * `mean(items.map(select))` without the intermediate array.
 *
 * Bit-identical: the same values are added in the same left-to-right order onto the same zero.
 * The carrier took these means once per width gauge and once per occupied load band on every
 * pointer frame, each one allocating an array the length of its member list.
 */
function meanBy<TItem>(items: readonly TItem[], select: (item: TItem) => number): number {
  if (items.length === 0) return 0;
  let sum = 0;
  for (const item of items) sum += select(item);
  return sum / items.length;
}

/**
 * Stations per emitted bristle run.
 *
 * The planner already varies each bristle's tooth per station (`hash2(si, 31 + i*7, seed)` in
 * `planOilBrushDabs` drives `radiusYRatio` and `opacity`), but collapsing a whole stroke into one
 * `mean()` width and one `mean()` opacity erased every bit of that: a 770 px oil stroke measured a
 * length-axis coefficient of variation of 0.002, i.e. it was constant along its own travel. Cutting
 * each hair into short runs lets the load change as the brush travels. Runs share their boundary
 * station with the next run, so the hair stays continuous.
 */
const BRISTLE_RUN_STATIONS = 3;

/** Stations each successive hair shifts its run boundaries by. Coprime-ish with the run length. */
const BRISTLE_RUN_PHASE_STRIDE = 1;

/** Normalised load below which a hair is off the paper and deposits nothing at all. */
const BRISTLE_DRY_LIFTOFF = 0.2;

/**
 * Load bands the runs of one width gauge are quantised into - the stroke's tonal resolution.
 *
 * This used to be pinned at three by self-crossings rather than by tone: each band was its own
 * multiply pass, so N bands folded N alphas wherever a stroke crossed itself and the figure-eight
 * knot probe went 0.038 -> 0.084 -> 0.123 -> 0.135 (3/6/12/16 bands) against a limit three passes
 * only just cleared. Raising it bought interior tone and paid for it in dark knots.
 *
 * The shells below untie the two: a band's cost at a crossing is now zero regardless of the count,
 * so the constant is set by tone alone. Measured on a rendered stroke, the share of ink in the two
 * most-occupied tone bins falls 0.507 (3) -> 0.321 (6) -> 0.280 (12) -> 0.237 (16) -> 0.250 (24),
 * with entropy 3.41 -> 4.03 -> 4.37 -> 4.55 -> 4.57 bits. Sixteen is the knee: past it bands start
 * coming up empty (24 requested, 23 populated) and tone stops improving while the shell count, and
 * with it the repainted geometry, keeps growing.
 */
const BRISTLE_LOAD_BANDS = 16;

/**
 * Virtual overlaps folded into one deposit. See `planStudioOilRibbonCarrier` for the body budget.
 *
 * Lowered 14 -> 6 because 14 put the fold deep in its own saturated regime, and that - not the load
 * signal - is what made every oil stroke read as two flat tones. `accumulatedOpacity` folds n
 * overlaps as `1 - (1-a)^n` clamped at 0.96, so at n=14 ANY per-dab alpha above about 0.2 lands on
 * the ceiling: two of the three load bands came out at exactly 0.96 and the whole loaded range
 * collapsed onto a single value.
 *
 * Measured on a rendered stroke - share of inked pixels in the two most-occupied tone bins, so
 * LOWER means more tonal range and less of the "단 2색" flatness that was reported:
 *   n=14 71.1% [0.574, 0.96, 0.96]    n=10 72.0% [0.456, 0.96, 0.96]    n=8 70.8%    n=7 70.6%
 *   n=6  54.6% [0.306, 0.902, 0.96]   n=5  58.0%                        n=3 60.3%
 * Six is the knee: above it the second band re-saturates onto the ceiling, below it the bands
 * start collapsing downward instead. Mean ink moves only 0.883 -> 0.847 and the ink standard
 * deviation is unchanged, so this buys tonal range without thinning the stroke.
 */
const BRISTLE_VIRTUAL_OVERLAPS = 3;

/**
 * Ridge-width classes the runs are split into before they are banded by load.
 *
 * Two jobs, one split. The first is texture: a run's width comes from its own hair
 * (`0.15 + radiusYRatio * 1.18`, a 9x range across hairs) but the emitted lane can only carry one
 * `lineWidth`, and the old code averaged that over a whole load band. Load and width are drawn
 * from independent hashes, so every band's width mean converged on the same global mean and the
 * bed rendered as hairs of one thickness - a bristle brush whose hairs are all identical is
 * exactly the "단 2색" flatness read from the other direction.
 *
 * The second is a precondition for the load shells below: a shell repaints its members' geometry,
 * so every run inside one gauge must stroke at the SAME width or a run would be laid down at two
 * different widths by two shells and halo. Splitting on width first makes each gauge homogeneous
 * and the shells exact.
 *
 * Three gauges, because gauges are the one axis that still folds at a self-crossing (shells remove
 * the fold inside a gauge but not between them), and three folds is the depth the knot gate is
 * already measured against.
 */
export const STUDIO_OIL_BRISTLE_WIDTH_GAUGES = 2;

/**
 * Smallest incremental deposit a shell may carry before it is folded into the next one.
 *
 * A shell that darkens what is under it by less than one 8-bit step cannot change the rendered
 * image, but it still costs a full repaint of every run at and above its band. 1/255 is that step;
 * the bands it absorbs are the ones whose mean loads landed close enough together that they were
 * going to render as one tone anyway.
 */
const BRISTLE_SHELL_VISIBLE_DEPOSIT = 1 / 255;

interface PlannedBristleRun {
  readonly points: readonly number[];
  readonly load: number;
  readonly width: number;
  /** Which hair this run belongs to, and where in that hair's travel it sits. */
  readonly bristleIndex: number;
  readonly runIndex: number;
}

interface BristleWidthGauge {
  readonly runs: readonly PlannedBristleRun[];
  readonly lineWidth: number;
}

/**
 * Welds a hair's consecutive runs that landed in the same band back into one polyline.
 *
 * A run carries ONE load, so a run boundary is a hard tonal step — and at 4x that step is exactly
 * the "dash" the oil bed was reported as: short dark bars with square ends floating on a flat
 * slab, never a furrow dragged the length of the stroke. Neighbouring runs of one hair very often
 * land in the SAME band (the load is smoothstepped along travel, so it changes slowly), and when
 * they do the step between them is not a step at all — it is a seam this planner invented by
 * cutting the hair up. Welding them removes the seam without changing one deposited value.
 *
 * It is also the change that pays for the wider bed: the run count falls by roughly the mean weld
 * length, so a bed with five times the hairs does not emit five times the geometry.
 *
 * Runs share their boundary station by construction, so the joint point is dropped exactly once.
 */
function weldRuns(runs: readonly PlannedBristleRun[]): readonly PlannedBristleRun[] {
  return weldByTrack(
    runs,
    (run) => run.bristleIndex,
    (run) => run.runIndex,
    (points, first, last) => ({
      points,
      // The welded furrow keeps the band's identity; load and width are only ever read as the band
      // mean and the gauge mean, and both members already belong to the same band and gauge.
      load: (first.load + last.load) / 2,
      width: (first.width + last.width) / 2,
      bristleIndex: last.bristleIndex,
      runIndex: last.runIndex,
    }),
  );
}

/**
 * Joins consecutive runs of one track into a single polyline, in linear time.
 *
 * Linear matters: the obvious `[...previous.points, ...run.points]` accumulator rebuilds the whole
 * array at every join, so a stripe that welds n runs copies O(n²) coordinates — measured, that
 * alone took a 2000-station impasto plan from 25ms to 74ms and blew the planner's budget. Appending
 * into one buffer and freezing it once at the end is the same output for linear work.
 *
 * Runs share their boundary station by construction, so the joint point is dropped exactly once.
 */
function weldByTrack<TRun extends { readonly points: readonly number[] }>(
  runs: readonly TRun[],
  trackOf: (run: TRun) => number,
  orderOf: (run: TRun) => number,
  build: (points: readonly number[], first: TRun, last: TRun, members: number) => TRun,
): readonly TRun[] {
  const ordered = [...runs].sort((left, right) =>
    trackOf(left) - trackOf(right) || orderOf(left) - orderOf(right));
  const welded: TRun[] = [];
  let buffer: number[] | null = null;
  let first: TRun | null = null;
  let previous: TRun | null = null;
  let members = 0;
  const flush = (): void => {
    if (!buffer || !first || !previous) return;
    welded.push(members === 1 ? previous : build(buffer, first, previous, members));
    buffer = null;
    first = null;
    previous = null;
    members = 0;
  };
  for (const run of ordered) {
    if (
      previous
      && trackOf(previous) === trackOf(run)
      && orderOf(previous) === orderOf(run) - 1
    ) {
      for (let index = 2; index < run.points.length; index += 1) buffer!.push(run.points[index]!);
      previous = run;
      members += 1;
      continue;
    }
    flush();
    buffer = [...run.points];
    first = run;
    previous = run;
    members = 1;
  }
  flush();
  return welded;
}

/**
 * Equal-count width quantiles over the HAIRS, so each gauge is a real population rather than an
 * empty bucket — and so a hair is never split between two of them.
 *
 * This used to quantile the runs. A run's width is `radiusY · f(hair)` and radiusY tracks
 * pressure, so one hair's runs spanned a 2x width range down a pressure-tapered stroke and landed
 * on both sides of the gauge boundary. That put the two halves of one furrow into two different
 * lanes, which the weld can never rejoin — measured, it was holding the median welded furrow at
 * seven stations while the load signal was already carrying it for seventy. Grouping by hair costs
 * the ridge its pressure-widening (the lane can only carry one lineWidth either way) and buys back
 * every furrow's continuity; the bed still fans under pressure because the hairs' OFFSETS scale
 * with radiusY.
 */
function widthGauges(
  runsByHair: readonly (readonly PlannedBristleRun[])[],
): readonly BristleWidthGauge[] {
  // Taken as it is built rather than regrouped from a flat array. Both this and the band walk
  // below used to rebuild the same `Map<bristleIndex, runs>` from ~27k runs on every move, while
  // the planner was already holding exactly that grouping. A hair that emitted nothing is skipped,
  // as an absent map key was: it carries no width, and it must not count toward the group size.
  const hairs = runsByHair
    .filter((runs) => runs.length > 0)
    .map((runs) => ({ runs, width: meanBy(runs, (run) => run.width) }))
    .sort((left, right) => left.width - right.width);
  const gauges: BristleWidthGauge[] = [];
  const size = Math.ceil(hairs.length / STUDIO_OIL_BRISTLE_WIDTH_GAUGES);
  for (let start = 0; start < hairs.length; start += size) {
    const group = hairs.slice(start, start + size);
    if (group.length === 0) continue;
    const runs: readonly PlannedBristleRun[] = group
      .flatMap<PlannedBristleRun>(({ runs: hairRuns }) => hairRuns as PlannedBristleRun[]);
    gauges.push({ runs, lineWidth: meanBy(runs, (run) => run.width) });
  }
  return gauges;
}

/**
 * Band width a hair's load must overshoot before the hair is allowed to change band.
 *
 * Quantising each run independently is what cut the furrows into dashes. A hair's load wanders
 * slowly, so it spends much of its travel sitting ON a band boundary — and there the raw
 * `floor(load · bands)` flickers between two bands from one run to the next. Every flicker is a
 * seam the weld cannot close, and a row of seams three stations apart is exactly the bar-code the
 * oil bed was reported as. The flicker is not tone: the load either side of it differs by a
 * millionth, while the rendered step is a full band.
 *
 * A Schmitt trigger removes it. The band follows the load only once the load has committed past
 * the boundary by this margin, so genuine ramps still move band by band while boundary noise does
 * not. Nothing is smoothed and no load is altered — only the *choice of quantiser* changes, and it
 * changes toward the one whose output is stable under an input that barely moves.
 */
const BRISTLE_BAND_HYSTERESIS = 0.4;

/**
 * Assigns every run its load band, walking each hair along its own travel so the trigger has a
 * history. Runs below the dry-liftoff cut get no band at all and are simply never emitted.
 *
 * A hair that runs out of paint lifts off the paper. Without that cut every hair painted the full
 * length of the stroke at SOME opacity — the virtual-overlap fold guarantees it, since
 * `1 - (1-a)^6` turns even a 0.015 load into 0.087 — so the bed rendered as unbroken parallel
 * ribbons, which is the grain of plywood rather than the mark of a brush. Skipping the driest runs
 * is what breaks those ribbons into the interrupted, skipping stroke that reads as bristle.
 */
function bandRunsAlongEachHair(
  runsByHair: readonly (readonly PlannedBristleRun[])[],
  minimumLoad: number,
  span: number,
): ReadonlyMap<PlannedBristleRun, number> {
  const bandByRun = new Map<PlannedBristleRun, number>();
  // `buildBristleRunsForHair` walks one hair's run origins in order and appends, so each hair
  // arrives sorted by `runIndex` — which is what the trigger below needs and what the regrouped
  // copy used to re-establish with a sort per hair on every move.
  for (const hair of runsByHair) {
    let held = -1;
    for (const run of hair) {
      const normalized = span > POINT_EPSILON ? (run.load - minimumLoad) / span : 0;
      if (normalized < BRISTLE_DRY_LIFTOFF) {
        // Lifting off ends the hair's history: when it touches down again it re-enters on whatever
        // band its load says, with no memory of the band it carried before the gap.
        held = -1;
        continue;
      }
      const scaled = normalized * BRISTLE_LOAD_BANDS;
      const raw = Math.min(BRISTLE_LOAD_BANDS - 1, Math.floor(scaled));
      const band = held < 0
        || (raw > held && scaled >= held + 1 + BRISTLE_BAND_HYSTERESIS)
        || (raw < held && scaled <= held - BRISTLE_BAND_HYSTERESIS)
        ? raw
        : held;
      held = band;
      bandByRun.set(run, band);
    }
  }
  return bandByRun;
}

/**
 * One frozen, quantised path per run, memoised so the shells above it can share it.
 *
 * The memo is a module-level `WeakMap` rather than a per-call `Map` so it also spans pointer
 * frames: a run object the incremental planner reused keeps the path it was already quantised
 * into, and a run that is dropped takes its entry with it. `PlannedBristleRun` is immutable once
 * emitted — the weld hands its buffer over and never writes to it again — so a hit is exact.
 */
const QUANTIZED_RUN_PATHS = new WeakMap<PlannedBristleRun, StudioOilRibbonPath>();

function quantizedRun(run: PlannedBristleRun): StudioOilRibbonPath {
  const cached = QUANTIZED_RUN_PATHS.get(run);
  if (cached) return cached;
  const frozen = Object.freeze({ points: quantizedPoints(run.points) });
  QUANTIZED_RUN_PATHS.set(run, frozen);
  return frozen;
}

/**
 * Fixed width bucket for the v2 fixed-anchor lanes, in document units.
 *
 * v1 groups hairs into equal-count quantiles and strokes each gauge at the observed mean — both
 * values move when the stroke grows. The v2 lane's width must be a pure function of its members'
 * shared key, so runs are binned by their own sample width on an absolute ruler. 4 units keeps
 * the within-bucket stroke-width error under half a typical hair diameter; 8 buckets span the
 * practical radiusY·2.425 range many times over.
 */
const BRISTLE_V2_WIDTH_BUCKET = 4;
const BRISTLE_V2_WIDTH_BUCKETS = 8;

/**
 * Deposit of one v2 band's anchor load.
 *
 * Pure function of the band index: an append that adds runs to any band — or creates a band that
 * did not exist — changes nothing about any other band's deposit, which is exactly the property
 * v1's observed-span means cannot offer.
 */
function bandAnchorDeposit(band: number): number {
  return accumulatedOpacity(
    (band + 0.5) / BRISTLE_LOAD_BANDS,
    BRISTLE_VIRTUAL_OVERLAPS,
  );
}

/**
 * Fixed-anchor bristle lanes (`bristleBanding: "fixed-anchor-v2"`).
 *
 * Every emitted value is either run-local geometry or a pure function of the lane's
 * (band, width-bucket) key: the band comes from fixed [0,1] normalisation through the same
 * per-hair Schmitt trigger and dry liftoff as v1, the width from an absolute ruler, the deposit
 * from the band anchor alone. Planning a prefix of a growing stroke therefore emits byte-identical
 * lanes for everything already planned — the append-stability contract the live suffix assembly
 * needs. Deliberate divergences from v1, both tone-level and gate-arbitrated: no observed-span
 * contrast stretch, and each band paints once at its own anchor instead of via cumulative shells
 * (self-crossings of DIFFERENT bands fold again; within-band crossings stay fold-free).
 */
/**
 * Fixed load ceiling the v2 banding normalises against.
 *
 * The station-opacity map clamps to [0.14, 0.62] (`pressureProxyFromStationOpacity` documents the
 * same numbers from the other side). Raw per-run loads are therefore already on a known absolute
 * ruler — stretching them to the observed span like v1 does is precisely what makes every band
 * membership move on append.
 */
const BRISTLE_V2_FIXED_MAX_LOAD = 0.62;

function planFixedAnchorBristleLanes(
  runsByHair: readonly (readonly PlannedBristleRun[])[],
): readonly StudioOilRibbonBristleLane[] {
  const bandByRun = bandRunsAlongEachHair(runsByHair, 0, BRISTLE_V2_FIXED_MAX_LOAD);
  const runsByKey = new Map<number, PlannedBristleRun[]>();
  // Hair-major, exactly the order the flat array this used to take was built in.
  for (const run of runsByHair.flat()) {
    const band = bandByRun.get(run);
    if (band === undefined) continue;
    const bucket = Math.min(
      BRISTLE_V2_WIDTH_BUCKETS - 1,
      Math.floor(run.width / BRISTLE_V2_WIDTH_BUCKET),
    );
    const key = band * BRISTLE_V2_WIDTH_BUCKETS + bucket;
    const group = runsByKey.get(key);
    if (group) group.push(run);
    else runsByKey.set(key, [run]);
  }
  const lanes: StudioOilRibbonBristleLane[] = [];
  for (const key of [...runsByKey.keys()].sort((left, right) => left - right)) {
    const band = Math.floor(key / BRISTLE_V2_WIDTH_BUCKETS);
    const bucket = key % BRISTLE_V2_WIDTH_BUCKETS;
    lanes.push(Object.freeze({
      runs: Object.freeze(
        weldRuns(runsByKey.get(key)!).map((run) => quantizedRun(run)),
      ),
      lineWidth: quantize((bucket + 0.5) * BRISTLE_V2_WIDTH_BUCKET),
      opacity: quantize(bandAnchorDeposit(band)),
      loadBand: band,
    }));
  }
  return Object.freeze(lanes);
}

/**
 * Hairs the bed can carry — the shortest bristle list any station offers.
 *
 * Spread-free on purpose: `Math.min(...stations.map(...))` allocated a whole array and then pushed
 * one argument per station onto the call stack, which a 4096-station bed paid on every pointer
 * move. Same value, same order of comparison.
 */
function resolveBristleCount(stations: readonly OilCarrierStation[]): number {
  let count = Number.POSITIVE_INFINITY;
  for (const station of stations) {
    const length = station.source.bristles.length;
    if (length < count) count = length;
  }
  return count;
}

/**
 * Every run one hair emits along the bed, in emission order.
 *
 * `reusable` names how many LEADING runs the caller has already proven unchanged and is handing
 * back in `cached`; the walk then resumes at the first run past them. Run boundaries are a
 * function of `bristleIndex` and the station index alone, and a run reads only the stations it
 * spans, so a reused run is exactly the object the full walk would have built — see
 * `StudioOilRibbonCarrierPlanner` for how a caller earns a non-zero `reusable`.
 */
function buildBristleRunsForHair(
  stations: readonly OilCarrierStation[],
  bristleIndex: number,
  dynamics: StudioOilBristleLoadDynamicsPlan | undefined,
  physics: StudioBristlePhysicsOilPlan | undefined,
  cached: readonly PlannedBristleRun[] = [],
  reusable = 0,
): PlannedBristleRun[] {
  const emitted: PlannedBristleRun[] = reusable > 0
    ? cached.slice(0, reusable)
    : [];
  let produced = 0;
  {
    // Each hair cuts its runs on a different phase. A run carries ONE load, so a run boundary is a
    // hard tonal step; with every hair cutting at stations 0, 5, 10, … those steps lined up across
    // the whole ribbon and the bed rendered as a stack of rectangular blocks with seams running
    // clean through it - the "각진" look, arriving through tone rather than through geometry.
    // Striding the phase by 2 spreads seven hairs over all five phases (0,2,4,1,3,0,2), so the
    // steps scatter into a mosaic instead of a grid. Nothing about the load itself changes.
    const phase = (bristleIndex * BRISTLE_RUN_PHASE_STRIDE) % BRISTLE_RUN_STATIONS;
    let runIndex = -1;
    for (
      let runOrigin = -phase;
      runOrigin < stations.length - 1;
      runOrigin += BRISTLE_RUN_STATIONS
    ) {
      runIndex += 1;
      const runStart = Math.max(0, runOrigin);
      const runEnd = Math.min(stations.length - 1, runOrigin + BRISTLE_RUN_STATIONS);
      if (runEnd <= runStart) continue;
      if (produced < reusable) {
        // Same walk, same boundaries — this run is already sitting in `emitted`.
        produced += 1;
        continue;
      }
      const points: number[] = [];
      for (let index = runStart; index <= runEnd; index += 1) {
        const station = stations[index]!;
        const bristle = station.source.bristles[bristleIndex]!;
        // v1 bristle physics (flag-gated): the simulated tuft's contact
        // trajectory replaces the hashed per-station offset, in the same
        // radiusY units, so splay/hysteresis/clump-split drive the lane path.
        const offset = physics
          ? station.radiusY
            * physics.laneOffsetRatio[index * physics.laneCount + bristleIndex]!
          : station.radiusY * bristle.offsetRatio;
        // The body overhangs the outermost stations by a directional cap. A hair that stopped at
        // the station left that cap as smooth pigment, so every oil stroke began and ended with a
        // blunt untextured head. Reaching one point into the cap - at the same shoulder the body
        // outline turns on - carries the ridge and furrow all the way to the tip.
        if (index === 0) points.push(...bristleCapPoint(station, offset, -1));
        points.push(
          station.x + station.normalX * offset,
          station.y + station.normalY * offset,
        );
        if (index === stations.length - 1) points.push(...bristleCapPoint(station, offset, 1));
      }
      // One representative station per run rather than the run's mean. Averaging is what erased the
      // tooth: the per-station noise is independent, so a mean over six stations shrinks its
      // amplitude by √6 and a mean over a whole stroke annihilates it.
      const sampleIndex = Math.min(runEnd, runStart + ((runEnd - runStart) >> 1));
      const sample = stations[sampleIndex]!;
      const sampleBristle = sample.source.bristles[bristleIndex]!;
      let load = clamp(sample.opacity * sampleBristle.opacity, 0, 1);
      // Ridge width against lane pitch. The constant term used to be 0.15 — over half the final
      // width — which flattened the hairs' own diameters into one gauge no matter what the planner
      // hashed. Shifting the weight onto the ratio spreads the bed over 2.4x instead of 1.6x, so
      // fine hairs and clumped ones are visibly different strands. 0.15–0.37·radiusY still keeps
      // impasto readable at 1x while surviving the body opacity headroom reserved below.
      let width = Math.max(0.38, sample.radiusY * (0.075 + sampleBristle.radiusYRatio * 2.35));
      if (dynamics) {
        // v1 load dynamics (flag-gated): the lane's evolving film strength
        // scales the deposit and the flattened footprint widens the ridge.
        load = clamp(
          load * dynamics.laneFilmStrength[sampleIndex * dynamics.laneCount + bristleIndex]!,
          0,
          1,
        );
        width *= dynamics.footprintScale[sampleIndex]!;
      }
      if (physics) {
        // v1 bristle physics (flag-gated): simulated contact alpha modulates
        // the deposit (lifted/starving hairs thin) and simulated contact
        // radius flattens/thins the ridge width per lane.
        load = clamp(
          load * physics.laneLoadMultiplier[sampleIndex * physics.laneCount + bristleIndex]!,
          0,
          1,
        );
        width *= physics.laneWidthScale[sampleIndex * physics.laneCount + bristleIndex]!;
      }
      emitted.push({ points, load, width, bristleIndex, runIndex });
      produced += 1;
    }
  }
  return emitted;
}

/**
 * Bands, welds and shells a finished run bed into lanes.
 *
 * Split out of `planBristleLanes` so an incremental caller can hand over a run bed it assembled
 * from a verified prefix. Everything from here down reads the WHOLE bed by design — the load span,
 * the band means and the telescoping shell deltas are all stroke-global — so this stage always
 * runs in full, and it is the one that decides tone. The saved work is upstream, in the geometry
 * the runs carry.
 */
function planBristleLanesFromRuns(
  runsByHair: readonly (readonly PlannedBristleRun[])[],
  banding: "observed-span-v1" | "fixed-anchor-v2",
): readonly StudioOilRibbonBristleLane[] {
  if (banding === "fixed-anchor-v2") {
    return runsByHair.some((runs) => runs.length > 0)
      ? planFixedAnchorBristleLanes(runsByHair)
      : [];
  }

  let minimumLoad = Number.POSITIVE_INFINITY;
  let maximumLoad = Number.NEGATIVE_INFINITY;
  let count = 0;
  for (const hair of runsByHair) {
    for (const run of hair) {
      minimumLoad = Math.min(minimumLoad, run.load);
      maximumLoad = Math.max(maximumLoad, run.load);
      count += 1;
    }
  }
  if (count === 0) return [];
  const span = maximumLoad - minimumLoad;
  const bandByRun = bandRunsAlongEachHair(runsByHair, minimumLoad, span);
  const lanes: StudioOilRibbonBristleLane[] = [];
  for (const gauge of widthGauges(runsByHair)) {
    const bands: PlannedBristleRun[][] = Array.from(
      { length: BRISTLE_LOAD_BANDS },
      () => [],
    );
    for (const run of gauge.runs) {
      const band = bandByRun.get(run);
      if (band === undefined) continue;
      bands[band]!.push(run);
    }
    for (const [band, runs] of bands.entries()) bands[band] = [...weldRuns(runs)];

    // Target deposit per band, monotone in load. Flat overlap count, deliberately: the bands are
    // ALREADY ordered by load, so scaling the overlap count by the band index applied that
    // ordering a second time and pushed the top of the load range onto `accumulatedOpacity`'s
    // 0.96 clamp - measured across 288 planned strokes, 126 emitted only TWO distinct lane
    // opacities and none ever exceeded three.
    const occupied: { band: number; target: number; runs: PlannedBristleRun[] }[] = [];
    let previousTarget = 0;
    for (const [band, runs] of bands.entries()) {
      if (runs.length === 0) continue;
      const target = Math.max(
        previousTarget,
        accumulatedOpacity(meanBy(runs, (run) => run.load), BRISTLE_VIRTUAL_OVERLAPS),
      );
      occupied.push({ band, target, runs });
      previousTarget = target;
    }

    // Cumulative shells, not one pass per band. Shell k carries every run in band >= k, so a
    // pixel in band m is painted by shells 0..m and its folded transmittance is the telescoping
    // product of (1 - delta), which is exactly 1 - target(m). Two arms crossing at bands i and m
    // are jointly covered by shells 0..max(i, m) and each shell is ONE paint, so the crossing
    // lands on max(target) instead of folding both - the knot cost of a band goes to zero and the
    // count stops being capped by self-crossings.
    //
    // Built as SUFFIXES from the outermost band inward, and quantised once per run. A run in band
    // m belongs to shells 0..m, and the straightforward `slice(index).flatMap(...).map(quantise)`
    // re-walked and re-quantised its coordinates once for every one of those shells — on a
    // 1300-station scribble that redundancy was most of the planner's time. Shell k is exactly
    // `band k ++ shell k+1`, and the frozen path objects are shared, so the emitted plan is
    // identical while each coordinate is touched once.
    // The deposit walk runs FIRST and touches no geometry, so a shell whose deposit cannot survive
    // 8-bit quantisation is never built at all. Materialising every band's suffix up front and
    // discarding the skipped ones measured slower than the redundant version it replaced.
    //
    // A shell repaints every run at and above its band, so it is the most expensive thing this
    // planner emits - measured, the shells raise an oil stroke's lane path data about 6x. A shell
    // that is skipped deliberately does NOT advance `carried`, which leaves the skipped band's
    // target to the next shell that IS worth painting, so tone stays exact instead of drifting.
    const emitted: { index: number; band: number; delta: number }[] = [];
    let carried = 0;
    for (let index = 0; index < occupied.length; index += 1) {
      const entry = occupied[index]!;
      // Incremental deposit that lands the fold on this band's target given everything already
      // laid by the shells outside it.
      const delta = carried >= 1
        ? 0
        : clamp(1 - (1 - entry.target) / (1 - carried), 0, 1);
      if (delta < BRISTLE_SHELL_VISIBLE_DEPOSIT) continue;
      carried = entry.target;
      emitted.push({ index, band: entry.band, delta });
    }

    // Built inward from the outermost emitted shell, and quantised once per run. A run in band m
    // belongs to shells 0..m, and the straightforward `slice(index).flatMap(...)` re-walked and
    // re-quantised its coordinates once for every one of those shells — on a 1300-station scribble
    // that redundancy was most of the planner's time. Shell k is exactly `bands k..next ++ shell
    // next`, and the frozen path objects are shared, so the emitted plan is identical while each
    // coordinate is quantised once.
    const shells: (readonly StudioOilRibbonPath[])[] = new Array(emitted.length);
    for (let slot = emitted.length - 1; slot >= 0; slot -= 1) {
      const from = emitted[slot]!.index;
      const to = emitted[slot + 1]?.index ?? occupied.length;
      const own: StudioOilRibbonPath[] = [];
      for (let index = from; index < to; index += 1) {
        for (const run of occupied[index]!.runs) own.push(quantizedRun(run));
      }
      const outer = shells[slot + 1];
      shells[slot] = outer ? own.concat(outer) : own;
    }
    for (const [slot, shell] of emitted.entries()) {
      lanes.push(Object.freeze({
        runs: Object.freeze(shells[slot]!),
        lineWidth: quantize(gauge.lineWidth),
        opacity: quantize(shell.delta),
        loadBand: shell.band,
      }));
    }
  }
  return Object.freeze(lanes);
}

function planBristleLanes(
  stations: readonly OilCarrierStation[],
  dynamics?: StudioOilBristleLoadDynamicsPlan,
  physics?: StudioBristlePhysicsOilPlan,
  banding: "observed-span-v1" | "fixed-anchor-v2" = "observed-span-v1",
): readonly StudioOilRibbonBristleLane[] {
  if (stations.length < 2) return [];
  const bristleCount = resolveBristleCount(stations);
  const runsByHair: PlannedBristleRun[][] = new Array(bristleCount);
  for (let bristleIndex = 0; bristleIndex < bristleCount; bristleIndex += 1) {
    runsByHair[bristleIndex] = buildBristleRunsForHair(stations, bristleIndex, dynamics, physics);
  }
  return planBristleLanesFromRuns(runsByHair, banding);
}

/**
 * Pressure proxy used when the dynamics flag is enabled without explicit
 * pressures: inverts the planner's non-tap station opacity map
 * (`0.16 + pressureFeel·0.38 + n2·0.045`, clamped to [0.14, 0.62]). A proxy —
 * programs that own the raw stylus samples should pass `pressures` instead.
 */
function pressureProxyFromStationOpacity(opacity: number): number {
  return clamp((opacity - 0.16) / 0.38, 0, 1);
}

/**
 * v1 bristle-physics adapter (the `bristlePhysics` program; every matrix row
 * that enables it runs this, not only brush--bristle-physics). Feeds the carrier's
 * own smoothed centreline and pressure proxy into the platform's WetBrush-2D
 * tuft; lane count and station count come from the exact same `stations` array
 * the band walker iterates, so the returned streams index it 1:1 by
 * construction.
 */
/**
 * The tuft's rest half-width for this bed. See `restRadiusAnchor`.
 *
 * The default window sums the same values in the same order `meanBy` does, so a stroke shorter
 * than the window produces a bit-for-bit identical anchor — and past it the anchor cancels out of
 * everything the program publishes anyway.
 */
function tuftRestRadiusPx(
  stations: readonly OilCarrierStation[],
  anchor: "stroke-mean-v1" | "settled-prefix-v2" | undefined,
): number {
  if (anchor === "stroke-mean-v1") return meanBy(stations, (station) => station.radiusY);
  const count = Math.min(stations.length, STUDIO_OIL_PHYSICS_REST_RADIUS_ANCHOR_STATIONS);
  if (count === 0) return 0;
  let sum = 0;
  for (let index = 0; index < count; index += 1) sum += stations[index]!.radiusY;
  return sum / count;
}

/**
 * A per-station series both programs read through `sampleSeries`, which HOLDS a short series at
 * its last value — so a station already marched would read a number that moves as the stroke
 * grows. Absent or exactly station-length is stable; anything else is not.
 */
function seriesSpansStations(
  series: readonly number[] | undefined,
  stationCount: number,
): boolean {
  return series === undefined || series.length === 0 || series.length >= stationCount;
}

/** True once the anchor can no longer move, which is what makes the physics prefix reusable. */
function tuftRestRadiusIsFrozen(
  stations: readonly OilCarrierStation[],
  anchor: "stroke-mean-v1" | "settled-prefix-v2" | undefined,
): boolean {
  return anchor !== "stroke-mean-v1"
    && stations.length >= STUDIO_OIL_PHYSICS_REST_RADIUS_ANCHOR_STATIONS;
}

function planBristlePhysics(
  stations: readonly OilCarrierStation[],
  options: StudioOilRibbonCarrierBristlePhysicsOptions,
  /**
   * Live stroke only: a retained tuft plus the station prefix this planner has already proven
   * byte-identical. Absent (batch, export, settle) simulates the whole stroke as before.
   */
  resume?: { readonly planner: StudioBristlePhysicsOilPlanner; readonly settled: number },
): StudioBristlePhysicsOilPlan | undefined {
  if (stations.length < 2) return undefined;
  const laneCount = resolveBristleCount(stations);
  if (laneCount <= 0) return undefined;
  const pressures = options.pressures && options.pressures.length > 0
    ? options.pressures
    : stations.map((station) => pressureProxyFromStationOpacity(station.opacity));
  const input = {
    stationXs: stations.map((station) => station.x),
    stationYs: stations.map((station) => station.y),
    laneCount,
    seed: Math.floor(finite(options.seed, 0)),
    // Tuft rest half-width — the offset stream's normalization radius.
    // Stroke-global by design — and the reason a physics program's bristle runs are never reused
    // across a pointer move: this normalization radius moves with every appended station, so the
    // whole simulated bed legitimately differs. See `StudioOilRibbonCarrierPlanner`.
    baseRadiusPx: tuftRestRadiusPx(stations, options.restRadiusAnchor),
    pressures,
    ...(options.speeds ? { speeds: options.speeds } : {}),
    ...(options.tiltX !== undefined ? { tiltX: options.tiltX } : {}),
    ...(options.tiltY !== undefined ? { tiltY: options.tiltY } : {}),
    ...(options.bristleCount !== undefined
      ? { bristleCount: options.bristleCount }
      : {}),
    ...(options.initialLoad !== undefined
      ? { initialLoad: options.initialLoad }
      : {}),
  };
  // One construction site for the input, so the resumable path cannot be fed a different stroke
  // than the batch path would have been.
  return resume
    ? resume.planner.plan(input, resume.settled)
    : planStudioBristlePhysicsOil(input);
}

function planLoadDynamics(
  stations: readonly OilCarrierStation[],
  options: StudioOilRibbonCarrierBristleLoadDynamicsOptions,
  /**
   * Live stroke only: a retained march plus the station prefix this planner has already proven
   * byte-identical. Absent (batch, export, settle) marches the whole stroke as before.
   */
  resume?: { readonly planner: StudioOilBristleLoadDynamicsPlanner; readonly settled: number },
): StudioOilBristleLoadDynamicsPlan | undefined {
  if (stations.length < 2) return undefined;
  const laneCount = resolveBristleCount(stations);
  if (laneCount <= 0) return undefined;
  const pressures = options.pressures && options.pressures.length > 0
    ? options.pressures
    : stations.map((station) => pressureProxyFromStationOpacity(station.opacity));
  const input = {
    stationCount: stations.length,
    laneCount,
    seed: Math.floor(finite(options.seed, 0)),
    pressures,
    ...(options.speeds ? { speeds: options.speeds } : {}),
    ...(options.initialLoad !== undefined ? { initialLoad: options.initialLoad } : {}),
    ...(options.depletionRate !== undefined
      ? { depletionRate: options.depletionRate }
      : {}),
  };
  // One construction site for the input, so the resumable path cannot be fed a different stroke
  // than the batch path would have been.
  return resume
    ? resume.planner.plan(input, resume.settled)
    : planStudioOilBristleLoadDynamics(input);
}

export function planStudioOilRibbonCarrier(
  inputDabs: readonly FxOilDab[],
  options?: StudioOilRibbonCarrierOptions,
): StudioOilRibbonCarrierPlan {
  const dabs = normalizedDabs(Array.isArray(inputDabs) ? inputDabs : []);
  const stations = collectStations(dabs);
  const averageOpacity = meanStationOpacity(stations);
  const bodyOnly = options?.bodyOnly === true;
  const loadDynamicsOptions = options?.bristleLoadDynamics;
  const dynamics = !bodyOnly && loadDynamicsOptions?.enabled === true
    ? planLoadDynamics(stations, loadDynamicsOptions)
    : undefined;
  // v1 bristle physics touches ONLY the bristle lanes: body geometry/opacity
  // stay byte-identical so the pinned lane inherits the settled silhouette.
  const bristlePhysicsOptions = options?.bristlePhysics;
  const physics = !bodyOnly && bristlePhysicsOptions?.enabled === true
    ? planBristlePhysics(stations, bristlePhysicsOptions)
    : undefined;
  // The relief overlay is additive only: enabling it must never change the base plan fields, and
  // NOT enabling it must not even add the key (legacy plans stay structurally identical).
  const impastoReliefLanes = !bodyOnly && options?.impastoRelief?.enabled === true
    ? planImpastoReliefOverlayLanes(stations)
    : undefined;
  return Object.freeze({
    version: STUDIO_OIL_RIBBON_CARRIER_VERSION,
    sourceStationCount: stations.length,
    body: stations.length === 0
      ? null
      : stations.length === 1
        ? directionalTap(stations[0]!)
        : variableWidthBody(stations),
    // Body is the paint the bristles have already spread — a film UNDER the ridges, not a slab
    // beside them. Two virtual overlaps put it at 0.68 while the lowest band a hair can deposit
    // came out at 0.65, so every furrow lighter than the film was invisible by construction and
    // only the top two or three bands ever showed: a flat slab with a few dark decals on it, which
    // is exactly how the bed was reported. One overlap is the film itself, and it leaves the whole
    // band range visible against it.
    bodyOpacity: quantize(accumulatedOpacity(averageOpacity, 1)),
    bristleLanes: bodyOnly
      ? Object.freeze([])
      : planBristleLanes(stations, dynamics, physics, options?.bristleBanding),
    repeatedBodyStampCount: 0,
    ...(impastoReliefLanes ? { impastoReliefLanes } : {}),
  });
}

/**
 * Growing-stroke carrier planner: the same plan `planStudioOilRibbonCarrier` returns, without
 * rebuilding the parts of it that an append cannot have changed.
 *
 * ## Why the batch planner is the wrong shape for a live stroke
 *
 * A live oil stroke replans the whole carrier on every pointer frame. Measured on this tree at a
 * 2906-dab bed that is ~17 ms per move, and at the 4096-dab cap ~28 ms — both past a 60 Hz frame
 * on their own, before a single pixel is painted, and both paid again on the next move.
 *
 * ## What is settled, and why it is exactly settled
 *
 * The chain is `dabs → smoothed geometry → stations → bristle runs`, and every stage reads a
 * BOUNDED window:
 *   - `smoothGeometry` weights ±6 neighbours at most, and its first/last raw passthrough only
 *     touches the two ends;
 *   - `tangentAt` reads ±2 geometry entries;
 *   - a bristle run reads only the stations it spans, plus the cap at index 0.
 * So with a byte-equal dab prefix of `identical`, geometry is settled to `identical - 6` entries
 * and stations to `identical - 8` — the N−8 settled prefix the 2026-08-22 carrier anatomy
 * measured. A run is settled while its UNCLAMPED end index stays inside that station prefix,
 * which also keeps it clear of the end cap the last station carries.
 *
 * The verification is object identity on the dab array, not a field compare: `FxOilDabPlanner`
 * hands its own verified prefix back as the same `FxOilDab` objects, so identity is both the
 * cheapest test available and strictly stronger than comparing the fields this planner reads.
 * Anything it cannot prove is rebuilt, so a wrong reuse is not expressible.
 *
 * ## What is NOT settled, and stays a full pass
 *
 * Banding, band means and the telescoping shell deltas are stroke-global by design: the load span
 * comes from the observed minimum and maximum, so one append can re-band every run. That stage
 * therefore always runs in full (`planBristleLanesFromRuns`), and the plan this class returns is
 * byte-identical to the batch planner's rather than an incremental approximation of it. Removing
 * the global aggregation itself is the separate, tone-changing `fixed-anchor-v2` work
 * (docs/perf/brush-advancement-roadmap-2026-08-22.md §3).
 *
 * The v1 load-dynamics and bristle-physics programs publish per-station arrays that are replanned
 * across the whole bed, so their runs are never reused — geometry and stations still are. The
 * impasto relief overlay reads stations only, so `StudioImpastoReliefPlanner` resumes on the same
 * settled boundary for all three of its stages: the height rasters, the shading of the cells whose
 * neighbourhood moved, and the flank runs sampled off them. Bucketing the runs into tone lanes is
 * the one relief stage still run in full, for the same reason the bristle banding is.
 */
export class StudioOilRibbonCarrierPlanner {
  private optionsKey: string | null = null;
  private dabs: readonly FxOilDab[] = [];
  private geometry: readonly SmoothedOilCarrierGeometry[] = [];
  private stations: readonly OilCarrierStation[] = [];
  private runsByHair: PlannedBristleRun[][] = [];
  private lastReusedRuns = 0;
  private lastSettledStations = 0;
  /** Hair count the retained runs were built for; -1 until the first plan. */
  private lastBristleCount = -1;
  /**
   * Retained load-dynamics march. The program is strictly causal in the station index, so unlike
   * the bristle-physics program (whose `baseRadiusPx` is a stroke-global mean) its settled prefix
   * is byte-stable under an append and is kept across pointer frames.
   */
  private readonly loadDynamics = new StudioOilBristleLoadDynamicsPlanner();
  /**
   * Retained bristle-physics tuft. Causal in the station index once the rest-radius anchor is
   * frozen (`restRadiusAnchor`), which is what lets the already-drawn hairs stop being
   * re-simulated on every pointer frame.
   */
  private readonly bristlePhysics = new StudioBristlePhysicsOilPlanner();
  /**
   * Retained impasto height field and the relief runs cut from it. Reads stations only, and only
   * the settled prefix is baked, so it resumes on the same boundary the bristle runs do.
   */
  private readonly impastoRelief = new StudioImpastoReliefPlanner();

  /** Runs reused from the previous call. Diagnostics and identity tests only. */
  get reusedRuns(): number {
    return this.lastReusedRuns;
  }

  /** Stations proven settled on the previous call. Diagnostics and identity tests only. */
  get settledStations(): number {
    return this.lastSettledStations;
  }

  /** Relief runs reused from the previous call. Diagnostics and identity tests only. */
  get reusedReliefRuns(): number {
    return this.impastoRelief.reusedRuns;
  }

  /** The retained relief shading tile. Diagnostics and identity tests only. */
  get reliefField(): ImpastoReliefFieldSnapshot | null {
    return this.impastoRelief.snapshot();
  }

  reset(): void {
    this.optionsKey = null;
    this.dabs = [];
    this.geometry = [];
    this.stations = [];
    this.runsByHair = [];
    this.lastReusedRuns = 0;
    this.lastSettledStations = 0;
    this.lastBristleCount = -1;
    this.loadDynamics.reset();
    this.bristlePhysics.reset();
    this.impastoRelief.reset();
  }

  plan(
    inputDabs: readonly FxOilDab[],
    options?: StudioOilRibbonCarrierOptions,
  ): StudioOilRibbonCarrierPlan {
    const dabs = normalizedDabs(Array.isArray(inputDabs) ? inputDabs : []);
    // Any option that reaches the plan invalidates the retained bed when it moves. Cheap: the
    // options object is a handful of flags and scalars, never per-sample data of stroke length.
    const optionsKey = JSON.stringify(options ?? null);
    if (optionsKey !== this.optionsKey) {
      this.reset();
      this.optionsKey = optionsKey;
    }

    const previous = this.dabs;
    const shared = Math.min(previous.length, dabs.length);
    let identical = 0;
    while (identical < shared && previous[identical] === dabs[identical]) identical += 1;
    if (identical === 0) {
      // Nothing survives — the lattice refit at the dab cap, a new stroke, an undo. Drop the
      // retained bed BEFORE building the replacement rather than holding two full generations
      // of 4096 stations × 7–44 hairs alive next to each other; `FxOilDabPlanner` measured that
      // overlap at +4.5 ms per move in GC alone, and bailing out here can only ever cause a full
      // rebuild, never a wrong reuse.
      this.dabs = [];
      this.geometry = [];
      this.stations = [];
      this.runsByHair = [];
      // Same reason: the retained march holds stationCount x laneCount doubles.
      this.loadDynamics.reset();
      this.bristlePhysics.reset();
      this.impastoRelief.reset();
    }

    const settledGeometry = Math.max(0, identical - OIL_GEOMETRY_SMOOTHING_RADIUS);
    // `tangentAt` reaches this far past the station it builds, so the station boundary trails the
    // geometry one by the same stencil the reader uses.
    const settledStations = Math.max(0, settledGeometry - OIL_STATION_TANGENT_RADIUS);
    const geometry = smoothGeometryFrom(dabs, this.geometry, settledGeometry);
    const stations = collectStationsFrom(dabs, geometry, this.stations, settledStations);

    const bodyOnly = options?.bodyOnly === true;
    const loadDynamicsOptions = options?.bristleLoadDynamics;
    const dynamics = !bodyOnly && loadDynamicsOptions?.enabled === true
      ? planLoadDynamics(stations, loadDynamicsOptions, {
        planner: this.loadDynamics,
        settled: settledStations,
      })
      : undefined;
    const bristlePhysicsOptions = options?.bristlePhysics;
    const physics = !bodyOnly && bristlePhysicsOptions?.enabled === true
      ? planBristlePhysics(stations, bristlePhysicsOptions, {
        planner: this.bristlePhysics,
        // The tuft may only resume where its own anchor has stopped moving. Below the window the
        // anchor is still a running mean, so the settled station prefix is not a settled tuft.
        settled: tuftRestRadiusIsFrozen(stations, bristlePhysicsOptions.restRadiusAnchor)
          ? settledStations
          : 0,
      })
      : undefined;
    const impastoReliefLanes = !bodyOnly && options?.impastoRelief?.enabled === true
      ? planImpastoReliefOverlayLanes(stations, {
        planner: this.impastoRelief,
        settled: settledStations,
      })
      : undefined;

    let bristleLanes: readonly StudioOilRibbonBristleLane[] = Object.freeze([]);
    let reusedRuns = 0;
    if (!bodyOnly && stations.length >= 2) {
      const bristleCount = resolveBristleCount(stations);
      // Both programs publish per-station arrays that a run reads by station index, so a run is
      // only reusable while every array it reads is settled too.
      //
      //  - load dynamics is a strictly causal march and is now resumed rather than replanned
      //    (`StudioOilBristleLoadDynamicsPlanner`), so its prefix is byte-stable by construction;
      //  - bristle physics is causal as well, but its `baseRadiusPx` anchor decides the whole
      //    simulation. Under the shipped `stroke-mean-v1` anchor that number moves on every
      //    append, so nothing it produces is settled. Under `settled-prefix-v2` it stops moving
      //    once the window is full, and from there the physics prefix is settled too.
      //
      // The hair count also has to hold: both programs are indexed `station * laneCount + lane`,
      // so a bed that re-resolved its lane count is reading a different array shape and the
      // cached runs belong to a different tuft.
      const physicsSettled = physics === undefined
        || (tuftRestRadiusIsFrozen(stations, bristlePhysicsOptions?.restRadiusAnchor)
          && seriesSpansStations(bristlePhysicsOptions?.pressures, stations.length)
          && seriesSpansStations(bristlePhysicsOptions?.speeds, stations.length));
      const dynamicsSettled = dynamics === undefined
        || (seriesSpansStations(loadDynamicsOptions?.pressures, stations.length)
          && seriesSpansStations(loadDynamicsOptions?.speeds, stations.length));
      const programsSettled =
        physicsSettled && dynamicsSettled && bristleCount === this.lastBristleCount;
      const reusableStations = programsSettled ? settledStations : 0;
      this.lastBristleCount = bristleCount;
      const runsByHair: PlannedBristleRun[][] = new Array(bristleCount);
      for (let bristleIndex = 0; bristleIndex < bristleCount; bristleIndex += 1) {
        const cached = this.runsByHair[bristleIndex] ?? [];
        const reusable = reusableRunCountForHair(
          bristleIndex,
          stations.length,
          reusableStations,
          cached.length,
        );
        reusedRuns += reusable;
        const runs = buildBristleRunsForHair(
          stations,
          bristleIndex,
          dynamics,
          physics,
          cached,
          reusable,
        );
        runsByHair[bristleIndex] = runs;
      }
      this.runsByHair = runsByHair;
      bristleLanes = planBristleLanesFromRuns(
        runsByHair,
        options?.bristleBanding ?? "observed-span-v1",
      );
    } else {
      this.runsByHair = [];
    }

    this.dabs = dabs;
    this.geometry = geometry;
    this.stations = stations;
    this.lastReusedRuns = reusedRuns;
    this.lastSettledStations = settledStations;

    return Object.freeze({
      version: STUDIO_OIL_RIBBON_CARRIER_VERSION,
      sourceStationCount: stations.length,
      body: stations.length === 0
        ? null
        : stations.length === 1
          ? directionalTap(stations[0]!)
          : variableWidthBody(stations),
      bodyOpacity: quantize(accumulatedOpacity(meanStationOpacity(stations), 1)),
      bristleLanes,
      repeatedBodyStampCount: 0,
      ...(impastoReliefLanes ? { impastoReliefLanes } : {}),
    });
  }
}

/**
 * Planners retained for the ONE draft currently being drawn.
 *
 * A single slot, not an LRU over strokes: only one stroke is ever active, and its symmetry copies
 * are the whole working set. An LRU got this wrong twice over — sized below the fan it evicted
 * every copy just before its next use (0% hit rate, and worse than no cache once construction and
 * a doomed verification pass are charged), and sized above it, a finished stroke's beds stayed
 * strongly reachable while later single-copy strokes aged out one stale entry at a time. At the
 * dab cap one copy holds ~27k run objects, so a 16-copy stroke is hundreds of thousands of objects
 * that must not outlive the stroke that needed them.
 *
 * Starting a different draft therefore drops the previous one outright, and
 * `releaseStudioOilRibbonDraftPlanners` frees the last one when its committed render arrives.
 */
interface RetainedOilCarrierDraft {
  readonly draftId: string;
  readonly planners: Map<number, StudioOilRibbonCarrierPlanner>;
}

let retainedOilCarrierDraft: RetainedOilCarrierDraft | null = null;

/**
 * Stroke-keyed `StudioOilRibbonCarrierPlanner`, for renderers that cannot hold one themselves.
 *
 * Same plan as `planStudioOilRibbonCarrier` — see the class for why — so this is a drop-in for the
 * ACTIVE DRAFT only. Committed and export renders must keep calling the batch planner: they render
 * arbitrary strokes in arbitrary order and would evict each other's beds for nothing.
 *
 * A symmetry transform draws one element several times from different point arrays, so the copy's
 * `variationIndex` selects its own planner. A fan wider than
 * `STUDIO_BRUSH_RETAINED_DRAFT_SYMMETRY_VARIATIONS` falls back to the batch planner rather than
 * retaining beds without bound; callers should not reach that guard, since they are expected to
 * check the same bound before routing here.
 */
export function planStudioOilRibbonCarrierIncremental(
  draftId: string,
  variationIndex: number,
  dabs: readonly FxOilDab[],
  options?: StudioOilRibbonCarrierOptions,
): StudioOilRibbonCarrierPlan {
  if (retainedOilCarrierDraft?.draftId !== draftId) {
    retainedOilCarrierDraft = { draftId, planners: new Map() };
  }
  const planners = retainedOilCarrierDraft.planners;
  let planner = planners.get(variationIndex);
  if (!planner) {
    if (planners.size >= STUDIO_BRUSH_RETAINED_DRAFT_SYMMETRY_VARIATIONS) {
      return planStudioOilRibbonCarrier(dabs, options);
    }
    planner = new StudioOilRibbonCarrierPlanner();
    planners.set(variationIndex, planner);
  }
  return planner.plan(dabs, options);
}

/** Frees `draftId`'s retained beds. A no-op once a different draft has already replaced them. */
export function releaseStudioOilRibbonDraftPlanners(draftId: string): void {
  if (retainedOilCarrierDraft?.draftId === draftId) retainedOilCarrierDraft = null;
}

/**
 * Runs the retained planner for one copy of `draftId` reused on its last call, or `null` when no
 * planner is held for it. @internal — the colocated retention contract test only; a caller cannot
 * act on this, and a hit/miss is never a correctness signal (every plan is byte-identical either
 * way).
 */
export function studioOilRibbonCarrierRetainedReuse(
  draftId: string,
  variationIndex: number,
): number | null {
  if (retainedOilCarrierDraft?.draftId !== draftId) return null;
  return retainedOilCarrierDraft.planners.get(variationIndex)?.reusedRuns ?? null;
}

/**
 * Leading runs of one hair whose spans lie wholly inside the settled station prefix.
 *
 * Walks the same origins the builder does rather than closing the form, so the two can never
 * disagree about which run is which — the count is what matters, and each step is a comparison.
 */
function reusableRunCountForHair(
  bristleIndex: number,
  stationCount: number,
  settledStations: number,
  cachedLength: number,
): number {
  if (settledStations < 2 || cachedLength === 0) return 0;
  const phase = (bristleIndex * BRISTLE_RUN_PHASE_STRIDE) % BRISTLE_RUN_STATIONS;
  let count = 0;
  for (
    let runOrigin = -phase;
    runOrigin < stationCount - 1;
    runOrigin += BRISTLE_RUN_STATIONS
  ) {
    const runStart = Math.max(0, runOrigin);
    const runEnd = Math.min(stationCount - 1, runOrigin + BRISTLE_RUN_STATIONS);
    if (runEnd <= runStart) continue;
    // The UNCLAMPED end has to be inside the settled prefix: a run that ends on the clamp read
    // the bed's last station, whose end cap and smoothing both move when the stroke grows.
    if (runOrigin + BRISTLE_RUN_STATIONS > settledStations - 1) break;
    count += 1;
    if (count >= cachedLength) break;
  }
  return count;
}

/**
 * Stroke-mean station opacity, accumulated left to right.
 *
 * `mean(stations.map((s) => s.opacity))` allocated one array per pointer frame the length of the
 * bed to add its members in the same order; this adds them in that order directly, so the value
 * is bit-identical.
 */
function meanStationOpacity(stations: readonly OilCarrierStation[]): number {
  if (stations.length === 0) return 0;
  let sum = 0;
  for (const station of stations) sum += station.opacity;
  return sum / stations.length;
}

export function traceStudioOilRibbonPath(
  sink: StudioOilRibbonPathSink,
  path: StudioOilRibbonPath,
  close = false,
): void {
  // Indexed, not rest-destructured. `const [x, y, ...rest] = path.points` copies the entire
  // coordinate array on every call, and a full oil plan traces one path per lane run — the copy
  // alone was ~0.9 ms per pointer move on a 4096-station stroke. Same coordinates, same order.
  const points = path.points;
  const firstX = points[0];
  const firstY = points[1];
  if (firstX === undefined || firstY === undefined) return;
  sink.moveTo(firstX, firstY);
  for (let index = 2; index < points.length; index += 2) {
    const x = points[index];
    const y = points[index + 1];
    if (x === undefined || y === undefined) break;
    sink.lineTo(x, y);
  }
  if (close) sink.closePath?.();
}

function formatPathNumber(value: number): string {
  if (Object.is(value, -0)) return "0";
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(4).replace(/0+$/u, "").replace(/\.$/u, "");
}

/** SVG serializes the exact coordinates consumed by the retained Canvas renderer. */
export function studioOilRibbonPathData(
  path: StudioOilRibbonPath,
  close = false,
): string {
  const [firstX, firstY, ...remaining] = path.points;
  if (firstX === undefined || firstY === undefined) return "";
  let data = `M${formatPathNumber(firstX)} ${formatPathNumber(firstY)}`;
  for (let index = 0; index < remaining.length; index += 2) {
    const x = remaining[index];
    const y = remaining[index + 1];
    if (x === undefined || y === undefined) break;
    data += `L${formatPathNumber(x)} ${formatPathNumber(y)}`;
  }
  return close ? `${data}Z` : data;
}

