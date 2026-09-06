/**
 * Stroke-local coverage carrier for the legacy velocity-reactive `ink-brush`.
 *
 * The stamp walker remains the canonical pressure/velocity sampler. Its circular dabs are converted
 * into one variable-radius ribbon and submitted as one non-zero fill, preventing translucent ink
 * from accumulating at every carrier overlap, exact retrace and self-crossing.
 *
 * The walker samples far denser than the ribbon needs: ink spacing is 0.32 of a dab diameter, so
 * consecutive stations sit 0.64 radii apart and every station used to contribute a 24-gon join
 * disc. Those discs were 88% of the submitted path vertices while the bodies around them already
 * covered the same pixels. `planStudioStampInkRibbon` now proves that containment per station and
 * omits only the joins that cannot change coverage by more than `INK_RIBBON_JOIN_TOLERANCE`
 * document pixels — bodies, caps, opacity and determinism are untouched.
 */

import { computeStudioImpastoReliefShading } from "../studio-impasto-relief-shading-v1";

import type {
  StudioStampBrushDab,
  StudioStampBrushStyle,
} from "./studio-brush-stamp-engine";

export const STUDIO_STAMP_INK_RIBBON_VERSION =
  "stamp-ink-ribbon-v1" as const;

export type StudioStampInkRibbonPolygonRole =
  | "body"
  | "join"
  | "start-cap"
  | "end-cap"
  | "tap";

export interface StudioStampInkRibbonPolygon {
  readonly role: StudioStampInkRibbonPolygonRole;
  readonly points: readonly number[];
}

export const STUDIO_STAMP_KNIFE_RELIEF_VERSION =
  "stamp-knife-relief-v1" as const;

/** Lit crest or shaded flank. The surfaces own the colours, exactly like the oil relief lanes. */
export type StudioStampKnifeReliefKind = "highlight" | "shadow";

export interface StudioStampKnifeReliefBand {
  readonly kind: StudioStampKnifeReliefKind;
  /** One polyline per welded run of the same bead, flattened `x, y, …`. */
  readonly runs: ReadonlyArray<readonly number[]>;
  readonly lineWidth: number;
  readonly opacity: number;
}

export interface StudioStampInkRibbonPlan {
  readonly kind: "studio-stamp-ink-ribbon";
  readonly version: typeof STUDIO_STAMP_INK_RIBBON_VERSION;
  readonly coverageOperation: "stroke-local-single-fill";
  readonly fillRule: "nonzero";
  readonly cap: "round";
  readonly sourceDabCount: number;
  readonly acceptedDabCount: number;
  /** Document-pixel bound on how far omitting a join may move the filled boundary. */
  readonly joinTolerance: number;
  /** Interior stations whose join disc was proven redundant at `joinTolerance`. */
  readonly omittedJoinCount: number;
  readonly opacity: number;
  /** Exponent applied to recover the union's deposit, or `null` when the plan kept the raw alpha. */
  readonly depositAccumulation: number | null;
  readonly polygons: readonly StudioStampInkRibbonPolygon[];
  /**
   * Standing-paint bands along the slab's own edges. Additive only, and the key is present iff
   * `relief` was requested — every legacy plan stays structurally identical.
   */
  readonly reliefBands?: readonly StudioStampKnifeReliefBand[];
  readonly reliefVersion?: typeof STUDIO_STAMP_KNIFE_RELIEF_VERSION;
}

export interface StudioStampInkRibbonOptions {
  /**
   * Document-pixel budget for join omission. Zero reproduces the historical carrier that emitted
   * one join disc per interior station, which is what the coverage-parity contract compares to.
   */
  readonly joinTolerance?: number;
  /**
   * How many dabs the walker laid on one covered pixel — libmypaint's `dabs_per_pixel` after the
   * preset's `opaque_linearize` interpolation, i.e. the exponent its per-dab alpha was solved
   * against. Absent (the default) keeps the historical union opacity untouched.
   *
   * The ribbon exists to fill the union of those dabs ONCE, which is exactly the accumulation the
   * linearization assumed would happen and then cancelled: `alpha_dab = 1 − (1 − opaque)^(1/L)`.
   * Painting the union at `alpha_dab` therefore ships the pre-accumulation alpha as if it were the
   * finished deposit. Measured on `mypaint-cc0--knife` that is a 7.8x under-deposit — the preset
   * asks for a saturation of 0.5 and the exported slab came out at 0.064, a ghost rather than
   * paint. See `accumulatedOpacity`.
   */
  readonly depositAccumulation?: number;
  /**
   * Plan the standing-paint bands a knife-class nib leaves along its own edges. Off by default;
   * enabling it only APPENDS `reliefBands` — polygons, opacity and determinism are untouched.
   */
  readonly relief?: boolean;
}

export interface StudioStampInkRibbonPathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
}

interface InkStation {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly alpha: number;
  /** Flat-nib minor axis. Absent (the default) means a round nib and the historical geometry. */
  readonly radiusY?: number;
  /** Major-axis direction of the nib, radians. Present only with `radiusY`. */
  readonly angleRadians?: number;
}

/**
 * Half-width of the nib measured along `(nx, ny)`.
 *
 * A round nib answers `radius` in every direction, which is why the ribbon was previously able to
 * ignore direction entirely. A flat nib does not: this is the ellipse support function
 * `sqrt(a²(u·n)² + b²(v·n)²)` for semi-axes `a` along the nib and `b` across it, so a stroke that
 * travels ACROSS the nib is laid down at full width while one travelling ALONG it thins to `b`.
 * That direction-dependent swelling is what makes a calligraphy nib legible as calligraphy, and
 * without it CC0 calligraphy (ratio 5.46) and the fat marker (ratio 10.0) rendered 0.186 apart -
 * effectively the same brush - despite obviously different upstream files.
 */
function nibSupport(station: InkStation, nx: number, ny: number): number {
  const minor = station.radiusY;
  if (minor === undefined || !(minor > 0)) return station.radius;
  const angle = station.angleRadians ?? 0;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const alongNib = ux * nx + uy * ny;
  const acrossNib = -uy * nx + ux * ny;
  return Math.hypot(station.radius * alongNib, minor * acrossNib);
}

const COORDINATE_LIMIT = 1_000_000_000;
const RADIUS_LIMIT = 65_536;
const POINT_EPSILON = 1e-6;
const ROUND_STEPS = 24;
const QUANTIZE_SCALE = 10_000;
const TAU = Math.PI * 2;
/**
 * Sub-pixel budget for omitting a join disc. A shipped stroke is drawn under the viewport
 * transform, so this stays far below one document pixel to remain sub-pixel at the 500% zoom
 * ceiling as well.
 */
export const INK_RIBBON_JOIN_TOLERANCE = 0.03;
/**
 * A join disc reaches one radius along the path in each direction. Walking more stations than this
 * to prove that reach keeps the analysis linear even for a degenerate spacing/radius ratio.
 */
const MAX_JOIN_WINDOW_STATIONS = 64;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function quantize(value: number): number {
  const result = Math.round(value * QUANTIZE_SCALE) / QUANTIZE_SCALE;
  return Object.is(result, -0) ? 0 : result;
}

function sanitizeInkStations(
  dabs: readonly StudioStampBrushDab[],
): readonly InkStation[] {
  const stations: InkStation[] = [];
  for (const dab of dabs) {
    if (
      !Number.isFinite(dab.x)
      || !Number.isFinite(dab.y)
      || !Number.isFinite(dab.radius)
      || !Number.isFinite(dab.alpha)
      || dab.radius <= 0
    ) continue;
    const chiselMinor = typeof dab.radiusY === "number"
        && Number.isFinite(dab.radiusY)
        && dab.radiusY > 0
      ? clamp(dab.radiusY, 0.25, RADIUS_LIMIT)
      : null;
    const station = Object.freeze({
      x: clamp(dab.x, -COORDINATE_LIMIT, COORDINATE_LIMIT),
      y: clamp(dab.y, -COORDINATE_LIMIT, COORDINATE_LIMIT),
      radius: clamp(dab.radius, 0.25, RADIUS_LIMIT),
      alpha: clamp(dab.alpha, 0, 1),
      ...(chiselMinor !== null
        ? {
            radiusY: chiselMinor,
            angleRadians: Number.isFinite(dab.angleRadians) ? dab.angleRadians! : 0,
          }
        : {}),
    });
    const previous = stations.at(-1);
    if (
      previous
      && Math.hypot(station.x - previous.x, station.y - previous.y)
        <= POINT_EPSILON
    ) {
      stations[stations.length - 1] = Object.freeze({
        ...station,
        radius: Math.max(previous.radius, station.radius),
        alpha: Math.max(previous.alpha, station.alpha),
      });
    } else {
      stations.push(station);
    }
  }
  return Object.freeze(stations);
}

function bodyPolygon(
  from: InkStation,
  to: InkStation,
): readonly number[] | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length <= POINT_EPSILON) return null;
  const normalX = -dy / length;
  const normalY = dx / length;
  // Emitted right-side-forward: with a strictly positive length and radius the left-side-forward
  // order is always negatively wound, so this is the re-wound result without measuring it.
  const fromHalf = nibSupport(from, normalX, normalY);
  const toHalf = nibSupport(to, normalX, normalY);
  return Object.freeze([
    quantize(from.x - normalX * fromHalf),
    quantize(from.y - normalY * fromHalf),
    quantize(to.x - normalX * toHalf),
    quantize(to.y - normalY * toHalf),
    quantize(to.x + normalX * toHalf),
    quantize(to.y + normalY * toHalf),
    quantize(from.x + normalX * fromHalf),
    quantize(from.y + normalY * fromHalf),
  ]);
}

function roundPolygon(station: InkStation): readonly number[] {
  const points: number[] = [];
  for (let step = 0; step < ROUND_STEPS; step += 1) {
    const angle = TAU * step / ROUND_STEPS;
    // Round nib: nibSupport answers `radius` in every direction, so this is the original circle.
    const support = nibSupport(station, Math.cos(angle), Math.sin(angle));
    points.push(
      quantize(station.x + Math.cos(angle) * support),
      quantize(station.y + Math.sin(angle) * support),
    );
  }
  // Ascending angles are already positively wound, so the generic re-winding copy is skipped.
  return Object.freeze(points);
}

/**
 * Depth by which a disc of `radius` escapes two adjacent bodies whose directions differ by the
 * turn with cosine `turnCosine`.
 *
 * The two bodies end and start on their own perpendicular cross-sections through the station, so
 * the pair leaves a sector of exactly the turn angle uncovered. The point of that sector furthest
 * from either bounding cross-section sits on the rim, `radius * sin(turn / 2)` away.
 */
function turnGapDepth(radius: number, turnCosine: number): number {
  return radius * Math.sqrt(Math.max(0, (1 - turnCosine) / 2));
}

/**
 * Depth by which a disc of `radius` escapes a body whose half-width falls away at `shrinkSlope`
 * document pixels per document pixel travelled. Solving `radius - slope*u >= sqrt(radius^2 - u^2)`
 * puts the worst violation at `radius * (sqrt(1 + slope^2) - 1)`.
 */
function shrinkPinchDepth(radius: number, shrinkSlope: number): number {
  return radius * (Math.sqrt(1 + shrinkSlope * shrinkSlope) - 1);
}

function segmentLength(from: InkStation, to: InkStation): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

function unitTurnCosine(
  previous: InkStation,
  station: InkStation,
  next: InkStation,
): number {
  const inX = station.x - previous.x;
  const inY = station.y - previous.y;
  const outX = next.x - station.x;
  const outY = next.y - station.y;
  const inLength = Math.hypot(inX, inY);
  const outLength = Math.hypot(outX, outY);
  if (inLength <= POINT_EPSILON || outLength <= POINT_EPSILON) return -1;
  return (inX * outX + inY * outY) / (inLength * outLength);
}

/**
 * Proves that the bodies within one radius of `index` already cover its join disc.
 *
 * The scan walks outward until it has travelled the disc's own radius on that side. Every station
 * it passes contributes two ways the disc could still escape: the outer wedge left by that
 * station's turn, and the taper of the strip as the radius falls away from the disc's centre.
 * Both are bounded, and the walk fails closed when the stroke ends before a full radius.
 */
function joinDiscIsCovered(
  stations: readonly InkStation[],
  index: number,
  tolerance: number,
): boolean {
  const station = stations[index]!;
  const radius = station.radius;
  for (const stride of [-1, 1] as const) {
    let travelled = 0;
    let cursor = index;
    let steps = 0;
    while (travelled < radius) {
      const nextIndex = cursor + stride;
      if (nextIndex < 0 || nextIndex >= stations.length) return false;
      steps += 1;
      if (steps > MAX_JOIN_WINDOW_STATIONS) return false;
      const from = stations[cursor]!;
      const to = stations[nextIndex]!;
      const length = segmentLength(from, to);
      if (length <= POINT_EPSILON) return false;
      travelled += length;
      if (shrinkPinchDepth(radius, Math.max(0, radius - to.radius) / travelled) > tolerance) {
        return false;
      }
      // The turn at every station between the disc and the reach of its own radius opens another
      // wedge in the strip that carries it, so those turns are budgeted here too.
      const beyondIndex = nextIndex + stride;
      if (travelled < radius && beyondIndex >= 0 && beyondIndex < stations.length) {
        const turnCosine = stride === 1
          ? unitTurnCosine(from, to, stations[beyondIndex]!)
          : unitTurnCosine(stations[beyondIndex]!, to, from);
        if (turnGapDepth(Math.max(radius, to.radius), turnCosine) > tolerance) return false;
      }
      cursor = nextIndex;
    }
  }
  const turnCosine = unitTurnCosine(
    stations[index - 1]!,
    station,
    stations[index + 1]!,
  );
  return turnGapDepth(radius, turnCosine) <= tolerance;
}

function weightedOpacity(stations: readonly InkStation[]): number {
  if (stations.length === 0) return 0;
  if (stations.length === 1) return stations[0]!.alpha;
  let weighted = 0;
  let totalLength = 0;
  for (let index = 1; index < stations.length; index += 1) {
    const previous = stations[index - 1]!;
    const current = stations[index]!;
    const length = Math.hypot(
      current.x - previous.x,
      current.y - previous.y,
    );
    weighted += (previous.alpha + current.alpha) * 0.5 * length;
    totalLength += length;
  }
  return totalLength <= POINT_EPSILON
    ? stations.reduce((sum, station) => sum + station.alpha, 0) / stations.length
    : weighted / totalLength;
}

/**
 * Deposit of `accumulation` coincident dabs of alpha `alpha`, over-compositing: `1 − (1 − a)^L`.
 *
 * This is the exact inverse of the linearization the CC0 presets solve their per-dab alpha with
 * (`studioLibmypaintLinearizedDabAlpha`), so a preset whose stroke saturation target is `opaque`
 * gets `opaque` back — the union fill lands where the dab chain would have landed instead of one
 * dab below it.
 */
function accumulatedOpacity(alpha: number, accumulation: number): number {
  if (!(accumulation > 1) || !(alpha > 0)) return alpha;
  return 1 - (1 - alpha) ** accumulation;
}

// ---------------------------------------------------------------------------
// Knife relief — standing paint along the slab's own edges.
// ---------------------------------------------------------------------------

/**
 * A palette knife is not a pen that happens to be flat. It carries a LOAD, and the blade's two
 * long edges drag that load into a bead which stands proud of the film between them; that bead,
 * catching the light on one flank and shading the other, is the entire reason a knife mark reads
 * as paint rather than as fill. The `.myb` file says the tip is flat and hard (elliptical ratio
 * 6.52, hardness 0.8) and the ink nib already draws exactly that, so the missing signal was never
 * the dab — softening it measured 5 → 92 interior tones and rendered as a graded ribbon, further
 * from a knife than the slab it replaced. What was missing is the body.
 *
 * The height field is the ribbon's OWN geometry (same stations, same `nibSupport` ellipse), so the
 * bead can never drift off the silhouette the fill covers, and it is shaded by the shared dli GGX
 * lamp the oil impasto lane uses — one lamp for every relief in the app.
 *
 * Unlike the oil lane the bands carry NO blend mode. `mix-blend-mode` is dropped by the SVG
 * rasterisers this repo measures with, so a screened glint is a highlight that the metrics cannot
 * see and the browser can — plain alpha over a mid-tone slab lightens and darkens just as well and
 * keeps every surface, and every measurement, in agreement.
 */
const KNIFE_RELIEF_GRID_LONG_SIDE = 192;
/** Cell-count cap for scribble-shaped strokes, mirroring the oil field's blob guard. */
const KNIFE_RELIEF_GRID_MAX_CELLS = 24_000;
const KNIFE_RELIEF_MIN_CELL_PX = 0.6;
/** Wet film level under the plateau (heights stay 0..1 like dli's alpha channel). */
const KNIFE_RELIEF_FILM_HEIGHT = 0.5;
/** Extra standing paint the edge bead adds at its crest. */
const KNIFE_RELIEF_BEAD_HEIGHT = 0.5;
/**
 * Outer share of the nib's half-width the bead occupies. The crest therefore sits at
 * `1 − BEAD/2` of the half-width — inside the rim, never on it, so the bead and the film's own
 * edge cliff stay two separate features instead of one doubled edge.
 */
const KNIFE_RELIEF_BEAD_FRACTION = 0.32;
/** Film rim slope width in cells — thick paint ends in a cliff, not an alias step. */
const KNIFE_RELIEF_EDGE_FEATHER_CELLS = 1.2;
/** Same height gain the oil relief uses, so one stroke's tile answers dli's reference slope. */
const KNIFE_RELIEF_HEIGHT_SCALE = 3;
/** |shading − 1| below this is flat paint and emits no band. */
const KNIFE_RELIEF_MIN_STRENGTH = 0.02;
/** Shading distance → opacity gains. Asymmetric for the same reason as the oil lane's. */
const KNIFE_RELIEF_HIGHLIGHT_GAIN = 2.6;
const KNIFE_RELIEF_SHADOW_GAIN = 3.6;
/**
 * The oil lane's caps are calibrated for a `screen`-blended glint, which multiplies brightness;
 * these bands composite as plain alpha, so the lit crest needs a higher ceiling to reach the same
 * lightness over a mid-tone slab. At the oil lane's 0.44 the crest measured invisible against the
 * shaded flank and the mark read as a bar with one dark edge instead of a bead with two flanks.
 */
const KNIFE_RELIEF_MAX_HIGHLIGHT_OPACITY = 0.55;
const KNIFE_RELIEF_MAX_SHADOW_OPACITY = 0.3;
/** Stations per sampled run — the bead's tone is allowed to change this often, not per station. */
const KNIFE_RELIEF_RUN_STATIONS = 6;
const KNIFE_RELIEF_OPACITY_BUCKETS = 3;
/** Non-uniform bucket edges keep whisper / accent / glint tonally apart (oil lane's rationale). */
const KNIFE_RELIEF_BUCKET_EDGE_LOW = 0.18;
const KNIFE_RELIEF_BUCKET_EDGE_HIGH = 0.45;
/**
 * Overshoot, as a fraction of the max opacity, a bead must commit before it changes tone bucket.
 *
 * Not optional polish. Bucketing each run independently let one bead flicker between two buckets
 * from one six-station run to the next, which put consecutive stretches of a single crest into two
 * different bands: the weld could not rejoin them and the lit edge rendered as a dashed line of
 * white ticks rather than a continuous crest. Same Schmitt trigger, same reason, as the oil
 * relief's bucket hysteresis.
 */
const KNIFE_RELIEF_BUCKET_HYSTERESIS = 0.06;

/** Upper edge of a bucket, as a fraction of max opacity — Infinity for the top bucket. */
function knifeBucketEdgeAbove(bucket: number): number {
  return bucket === 0
    ? KNIFE_RELIEF_BUCKET_EDGE_LOW
    : bucket === 1
      ? KNIFE_RELIEF_BUCKET_EDGE_HIGH
      : Number.POSITIVE_INFINITY;
}

/** Lower edge of a bucket, as a fraction of max opacity — 0 for the bottom bucket. */
function knifeBucketEdgeBelow(bucket: number): number {
  return bucket === 0
    ? 0
    : bucket === 1
      ? KNIFE_RELIEF_BUCKET_EDGE_LOW
      : KNIFE_RELIEF_BUCKET_EDGE_HIGH;
}

interface KnifeReliefField {
  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly cell: number;
  readonly originX: number;
  readonly originY: number;
  /** Flat-normalized dli shading multipliers (1 = flat paint). */
  readonly shading: Float32Array;
}

interface PlannedKnifeReliefRun {
  readonly points: number[];
  readonly strength: number;
  readonly width: number;
  readonly trackIndex: number;
  readonly runIndex: number;
}

/** Unit normal at `index`, averaged across the two segments that meet there. */
function stationNormal(
  stations: readonly InkStation[],
  index: number,
): readonly [number, number] {
  const previous = stations[Math.max(0, index - 1)]!;
  const next = stations[Math.min(stations.length - 1, index + 1)]!;
  const dx = next.x - previous.x;
  const dy = next.y - previous.y;
  const length = Math.hypot(dx, dy);
  if (length <= POINT_EPSILON) return [0, 1];
  return [-dy / length, dx / length];
}

/**
 * Cross-section of the load: a plateau of film, a bead standing over the outer
 * `KNIFE_RELIEF_BEAD_FRACTION` of the half-width, then the rim cliff feathering to bare paper.
 * `u` is the distance from the centreline in half-widths.
 */
function knifeReliefProfile(u: number, film: number, featherRatio: number): number {
  const inner = 1 - KNIFE_RELIEF_BEAD_FRACTION;
  if (u <= inner) return film;
  if (u <= 1) {
    const s = (u - inner) / KNIFE_RELIEF_BEAD_FRACTION;
    return film + KNIFE_RELIEF_BEAD_HEIGHT * Math.sin(Math.PI * s);
  }
  if (featherRatio <= 0) return 0;
  return Math.max(0, film * (1 - (u - 1) / featherRatio));
}

/**
 * Fold the ribbon's stations into a coarse stroke-local height tile and relief-shade it with the
 * shared dli GGX port. Height is max-blended: a slab crossing its own earlier pass is one level of
 * standing paint, not two stacked ones. Pure function of the stations — no clock, no randomness.
 */
function buildKnifeReliefField(
  stations: readonly InkStation[],
): KnifeReliefField | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxAlpha = 0;
  for (const station of stations) {
    const pad = station.radius + 2;
    minX = Math.min(minX, station.x - pad);
    minY = Math.min(minY, station.y - pad);
    maxX = Math.max(maxX, station.x + pad);
    maxY = Math.max(maxY, station.y + pad);
    maxAlpha = Math.max(maxAlpha, station.alpha);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || maxAlpha <= 0) return null;
  const spanX = Math.max(1e-3, maxX - minX);
  const spanY = Math.max(1e-3, maxY - minY);
  let cell = Math.max(
    KNIFE_RELIEF_MIN_CELL_PX,
    Math.max(spanX, spanY) / KNIFE_RELIEF_GRID_LONG_SIDE,
  );
  const cellsAtLongSide = (spanX / cell) * (spanY / cell);
  if (cellsAtLongSide > KNIFE_RELIEF_GRID_MAX_CELLS) {
    cell *= Math.sqrt(cellsAtLongSide / KNIFE_RELIEF_GRID_MAX_CELLS);
  }
  const gridWidth = Math.max(4, Math.ceil(spanX / cell) + 1);
  const gridHeight = Math.max(4, Math.ceil(spanY / cell) + 1);
  const heights = new Float32Array(gridWidth * gridHeight);
  const feather = KNIFE_RELIEF_EDGE_FEATHER_CELLS * cell;

  // Walk the same segments the body polygons are cut from, so the tile's rim is the fill's rim.
  // Stride by a third of the nib width: consecutive stations sit far closer than that and
  // max-blending makes the stride invisible in the level.
  let travelled = Number.POSITIVE_INFINITY;
  for (let index = 0; index + 1 < stations.length; index += 1) {
    const from = stations[index]!;
    const to = stations[index + 1]!;
    const segmentX = to.x - from.x;
    const segmentY = to.y - from.y;
    const length = Math.hypot(segmentX, segmentY);
    if (length <= POINT_EPSILON) continue;
    travelled += length;
    const stampGap = Math.max(cell, from.radius * 0.33);
    if (index !== 0 && index + 2 !== stations.length && travelled < stampGap) continue;
    travelled = 0;
    const normalX = -segmentY / length;
    const normalY = segmentX / length;
    const fromHalf = Math.max(POINT_EPSILON, nibSupport(from, normalX, normalY));
    const toHalf = Math.max(POINT_EPSILON, nibSupport(to, normalX, normalY));
    const maximumHalf = Math.max(fromHalf, toHalf);
    const reach = maximumHalf + feather;
    const inverseLengthSquared = 1 / (length * length);
    const minCellX = Math.max(0, Math.floor((Math.min(from.x, to.x) - reach - minX) / cell));
    const maxCellX = Math.min(
      gridWidth - 1,
      Math.ceil((Math.max(from.x, to.x) + reach - minX) / cell),
    );
    const minCellY = Math.max(0, Math.floor((Math.min(from.y, to.y) - reach - minY) / cell));
    const maxCellY = Math.min(
      gridHeight - 1,
      Math.ceil((Math.max(from.y, to.y) + reach - minY) / cell),
    );
    for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
      const pointY = minY + (cellY + 0.5) * cell - from.y;
      for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
        const pointX = minX + (cellX + 0.5) * cell - from.x;
        const t = clamp(
          (pointX * segmentX + pointY * segmentY) * inverseLengthSquared,
          0,
          1,
        );
        const deltaX = pointX - segmentX * t;
        const deltaY = pointY - segmentY * t;
        const half = fromHalf + (toHalf - fromHalf) * t;
        const u = Math.hypot(deltaX, deltaY) / half;
        if (u > 1 + feather / half) continue;
        // Load stands the film proud: a pressed station carries more paint than a feathered one.
        const load = (from.alpha + (to.alpha - from.alpha) * t) / maxAlpha;
        const film = KNIFE_RELIEF_FILM_HEIGHT * (0.72 + 0.28 * clamp(load, 0, 1));
        const value = knifeReliefProfile(u, film, feather / half);
        const at = cellY * gridWidth + cellX;
        if (value > heights[at]!) heights[at] = value;
      }
    }
  }

  return {
    gridWidth,
    gridHeight,
    cell,
    originX: minX,
    originY: minY,
    shading: computeStudioImpastoReliefShading(heights, {
      width: gridWidth,
      height: gridHeight,
      heightScale: KNIFE_RELIEF_HEIGHT_SCALE,
    }),
  };
}

/** Bilinear read of the shading buffer at a document point. 1 (flat) outside the tile. */
function sampleKnifeReliefShading(
  field: KnifeReliefField,
  x: number,
  y: number,
): number {
  const gridX = (x - field.originX) / field.cell - 0.5;
  const gridY = (y - field.originY) / field.cell - 0.5;
  const baseX = Math.floor(gridX);
  const baseY = Math.floor(gridY);
  const fractionX = gridX - baseX;
  const fractionY = gridY - baseY;
  const at = (cellX: number, cellY: number): number => {
    if (cellX < 0 || cellY < 0 || cellX >= field.gridWidth || cellY >= field.gridHeight) return 1;
    return field.shading[cellY * field.gridWidth + cellX]!;
  };
  const top = at(baseX, baseY) * (1 - fractionX) + at(baseX + 1, baseY) * fractionX;
  const bottom = at(baseX, baseY + 1) * (1 - fractionX) + at(baseX + 1, baseY + 1) * fractionX;
  return top * (1 - fractionY) + bottom * fractionY;
}

function bucketOf(ratio: number): number {
  return ratio < KNIFE_RELIEF_BUCKET_EDGE_LOW
    ? 0
    : ratio < KNIFE_RELIEF_BUCKET_EDGE_HIGH
      ? 1
      : KNIFE_RELIEF_OPACITY_BUCKETS - 1;
}

/** Join runs that are consecutive on the same track, dropping the shared boundary point once. */
function weldKnifeReliefRuns(
  runs: readonly PlannedKnifeReliefRun[],
): ReadonlyArray<readonly number[]> {
  const byTrack = new Map<number, PlannedKnifeReliefRun[]>();
  for (const run of runs) {
    const bucket = byTrack.get(run.trackIndex);
    if (bucket) bucket.push(run);
    else byTrack.set(run.trackIndex, [run]);
  }
  const welded: (readonly number[])[] = [];
  for (const track of [...byTrack.keys()].sort((left, right) => left - right)) {
    let current: number[] | null = null;
    let previousIndex = Number.NEGATIVE_INFINITY;
    for (const run of byTrack.get(track)!.sort((left, right) => left.runIndex - right.runIndex)) {
      if (current && run.runIndex === previousIndex + 1) current.push(...run.points.slice(2));
      else {
        if (current) welded.push(Object.freeze(current));
        current = [...run.points];
      }
      previousIndex = run.runIndex;
    }
    if (current) welded.push(Object.freeze(current));
  }
  return Object.freeze(welded);
}

/**
 * Express the shaded tile as bands both surfaces can stroke identically: one polyline per welded
 * run of bead crest, classified by the shading sampled where that crest actually lives. Band
 * orientation therefore FOLLOWS the light — with dli's (0, −1, 1) the upper edge of a horizontal
 * slab is lit and the lower one shaded, and a stroke running toward the lamp emits neither.
 */
function planKnifeReliefBands(
  stations: readonly InkStation[],
): readonly StudioStampKnifeReliefBand[] {
  if (stations.length < 2) return Object.freeze([]);
  const field = buildKnifeReliefField(stations);
  if (!field) return Object.freeze([]);
  const crestRatio = 1 - KNIFE_RELIEF_BEAD_FRACTION / 2;
  const planned: PlannedKnifeReliefRun[] = [];
  for (
    let runStart = 0;
    runStart < stations.length - 1;
    runStart += KNIFE_RELIEF_RUN_STATIONS
  ) {
    const runEnd = Math.min(stations.length - 1, runStart + KNIFE_RELIEF_RUN_STATIONS);
    const runIndex = runStart / KNIFE_RELIEF_RUN_STATIONS;
    for (const side of [-1, 1] as const) {
      const points: number[] = [];
      let strengthSum = 0;
      let widthSum = 0;
      for (let index = runStart; index <= runEnd; index += 1) {
        const station = stations[index]!;
        const [normalX, normalY] = stationNormal(stations, index);
        const half = nibSupport(station, normalX, normalY);
        const offset = side * half * crestRatio;
        const x = station.x + normalX * offset;
        const y = station.y + normalY * offset;
        points.push(x, y);
        strengthSum += sampleKnifeReliefShading(field, x, y) - 1;
        widthSum += clamp(half * KNIFE_RELIEF_BEAD_FRACTION * 0.8, 0.4, 3);
      }
      const samples = runEnd - runStart + 1;
      if (samples < 2) continue;
      planned.push({
        points,
        strength: strengthSum / samples,
        width: widthSum / samples,
        // One track per side, so a welded band is always the same physical bead end to end.
        trackIndex: side === 1 ? 1 : 0,
        runIndex,
      });
    }
  }

  const buckets = new Map<string, {
    kind: StudioStampKnifeReliefKind;
    order: number;
    runs: PlannedKnifeReliefRun[];
    opacities: number[];
  }>();
  // Walked in track order so the bucket choice has a history — see KNIFE_RELIEF_BUCKET_HYSTERESIS.
  const held = new Map<number, { kind: StudioStampKnifeReliefKind; bucket: number }>();
  for (const run of [...planned].sort((left, right) =>
    left.trackIndex - right.trackIndex || left.runIndex - right.runIndex)) {
    const magnitude = Math.abs(run.strength);
    if (magnitude < KNIFE_RELIEF_MIN_STRENGTH) {
      held.delete(run.trackIndex);
      continue;
    }
    const kind: StudioStampKnifeReliefKind = run.strength > 0 ? "highlight" : "shadow";
    const maxOpacity = kind === "highlight"
      ? KNIFE_RELIEF_MAX_HIGHLIGHT_OPACITY
      : KNIFE_RELIEF_MAX_SHADOW_OPACITY;
    const gain = kind === "highlight"
      ? KNIFE_RELIEF_HIGHLIGHT_GAIN
      : KNIFE_RELIEF_SHADOW_GAIN;
    const opacity = Math.min(maxOpacity, magnitude * gain);
    const ratio = opacity / maxOpacity;
    const raw = bucketOf(ratio);
    // A flank that flips lit/shaded is a genuinely different surface, so the trigger only holds
    // within one kind; crossing zero always re-enters on the raw bucket.
    const previous = held.get(run.trackIndex);
    const bucket = !previous || previous.kind !== kind
      ? raw
      : raw > previous.bucket
        ? (ratio >= knifeBucketEdgeAbove(previous.bucket) + KNIFE_RELIEF_BUCKET_HYSTERESIS
            ? raw : previous.bucket)
        : raw < previous.bucket
          ? (ratio <= knifeBucketEdgeBelow(previous.bucket) - KNIFE_RELIEF_BUCKET_HYSTERESIS
              ? raw : previous.bucket)
          : raw;
    held.set(run.trackIndex, { kind, bucket });
    // Shadows first, glints last: paint order is plan order on both surfaces.
    const order = (kind === "shadow" ? 0 : KNIFE_RELIEF_OPACITY_BUCKETS) + bucket;
    const key = `${kind}:${bucket}`;
    const entry = buckets.get(key) ?? { kind, order, runs: [], opacities: [] };
    entry.runs.push(run);
    entry.opacities.push(opacity);
    buckets.set(key, entry);
  }

  const mean = (values: readonly number[]): number => (
    values.reduce((total, value) => total + value, 0) / Math.max(1, values.length)
  );
  return Object.freeze(
    [...buckets.values()]
      .sort((left, right) => left.order - right.order)
      .map((entry) => Object.freeze({
        kind: entry.kind,
        runs: weldKnifeReliefRuns(entry.runs).map((run) => Object.freeze(run.map(quantize))),
        // Width and opacity are the bucket's means over its RUNS, not over the welded bands:
        // welding is a geometry join and must not re-weight the tone by band length.
        lineWidth: quantize(mean(entry.runs.map(({ width }) => width))),
        opacity: quantize(mean(entry.opacities)),
      })),
  );
}

/**
 * The ribbon options a stamp style implies, so the SVG serializer and Canvas2D compatibility
 * renderer cannot drift apart on the union's deposit. A style with no `opaque_linearize` pin
 * (every non-cc0 lane) yields an empty object and the historical plan.
 */
export function studioStampInkRibbonOptions(
  style: Pick<StudioStampBrushStyle, "mypaintCc0Dynamics">,
): StudioStampInkRibbonOptions {
  const accumulation = style.mypaintCc0Dynamics?.linearizeDabsPerPixel;
  return {
    ...(typeof accumulation === "number" && accumulation > 1
      ? { depositAccumulation: accumulation }
      : {}),
    ...(style.mypaintCc0Dynamics?.reliefBody === true ? { relief: true } : {}),
  };
}

export function planStudioStampInkRibbon(
  dabs: readonly StudioStampBrushDab[],
  options?: StudioStampInkRibbonOptions | null,
): StudioStampInkRibbonPlan {
  const joinTolerance = typeof options?.joinTolerance === "number"
      && Number.isFinite(options.joinTolerance)
    ? Math.max(0, options.joinTolerance)
    : INK_RIBBON_JOIN_TOLERANCE;
  const depositAccumulation = typeof options?.depositAccumulation === "number"
      && Number.isFinite(options.depositAccumulation)
      && options.depositAccumulation > 1
    ? options.depositAccumulation
    : null;
  const relief = options?.relief === true;
  const stations = sanitizeInkStations(dabs);
  const polygons: StudioStampInkRibbonPolygon[] = [];
  let omittedJoinCount = 0;
  if (stations.length === 1) {
    polygons.push(Object.freeze({
      role: "tap",
      points: roundPolygon(stations[0]!),
    }));
  } else if (stations.length > 1) {
    for (let index = 1; index < stations.length; index += 1) {
      const body = bodyPolygon(stations[index - 1]!, stations[index]!);
      if (!body) continue;
      polygons.push(Object.freeze({
        role: "body",
        points: body,
      }));
    }
    for (let index = 1; index < stations.length - 1; index += 1) {
      if (
        joinTolerance > 0
        && joinDiscIsCovered(stations, index, joinTolerance)
      ) {
        omittedJoinCount += 1;
        continue;
      }
      polygons.push(Object.freeze({
        role: "join",
        points: roundPolygon(stations[index]!),
      }));
    }
    polygons.push(
      Object.freeze({
        role: "start-cap",
        points: roundPolygon(stations[0]!),
      }),
      Object.freeze({
        role: "end-cap",
        points: roundPolygon(stations.at(-1)!),
      }),
    );
  }
  return Object.freeze({
    kind: "studio-stamp-ink-ribbon",
    version: STUDIO_STAMP_INK_RIBBON_VERSION,
    coverageOperation: "stroke-local-single-fill",
    fillRule: "nonzero",
    cap: "round",
    sourceDabCount: dabs.length,
    acceptedDabCount: stations.length,
    joinTolerance,
    omittedJoinCount,
    opacity: clamp(
      depositAccumulation === null
        ? weightedOpacity(stations)
        : accumulatedOpacity(weightedOpacity(stations), depositAccumulation),
      0,
      1,
    ),
    depositAccumulation,
    polygons: Object.freeze(polygons),
    ...(relief
      ? {
          reliefBands: planKnifeReliefBands(stations),
          reliefVersion: STUDIO_STAMP_KNIFE_RELIEF_VERSION,
        }
      : {}),
  });
}

export function traceStudioStampInkRibbon(
  sink: StudioStampInkRibbonPathSink,
  plan: StudioStampInkRibbonPlan,
): void {
  for (const polygon of plan.polygons) {
    if (polygon.points.length < 6) continue;
    sink.moveTo(polygon.points[0]!, polygon.points[1]!);
    for (let index = 2; index + 1 < polygon.points.length; index += 2) {
      sink.lineTo(polygon.points[index]!, polygon.points[index + 1]!);
    }
    sink.closePath();
  }
}
