/**
 * PicsArt / Express-class FX brush planners (glow, glitter, oil, pastel).
 *
 * Pure, deterministic dab/particle plans shared by Canvas (Konva) and SVG export.
 * No Math.random / DOM / Konva — seed + stroke geometry only.
 */

import { STUDIO_BRUSH_RETAINED_DRAFT_SYMMETRY_VARIATIONS } from "./brush/studio-brush-symmetry";
import { hash2 } from "./studio-grain";
import {
  STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
  applyStudioMaterialMinimumDiameterRatio,
  type StudioMaterialPressureModel,
} from "./studio-material-pressure-model";

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

const MAX_COORD = 1e6;
const POINT_EPS = 1e-4;
const DEFAULT_PRESSURE = 0.55;
const TAU = Math.PI * 2;

export const FX_BRUSH_SEED_RANGE = { min: 0, max: 9999 } as const;
export const DEFAULT_FX_BRUSH_SEED = 1;
export const FX_BRUSH_PARTICLE_CAP = 768;

/**
 * How much of a spark's brightness the throw distance costs it, at the edge of the scatter disc.
 *
 * Kept modest: the far sparks must still read, they just must not read as the BRIGHTEST ones. The
 * previous code had exactly that inversion because distance and opacity shared one hash draw.
 */
const FX_PARTICLE_DISTANCE_FALLOFF = 0.3;
export const FX_BRUSH_DAB_CAP = 512;
/**
 * Oil/acrylic stations feed a continuous ribbon, so they no longer pay one full body draw per
 * station. Preserve a dense centreline on very long canvases instead of redistributing 512 large
 * footprints across the whole path and exposing polygon corners.
 */
export const FX_OIL_DAB_CAP = 16_384;
/**
 * Pastel is a continuous dry medium, not a decorative particle brush. A shared 512-dab ceiling
 * previously limited it to at most 256 two-dot stations and then redistributed those circles over
 * the complete arc. On a long stroke the spacing therefore grew with total length and exposed a
 * row of round carriers. Keep a dedicated, still-bounded station budget for its anisotropic fibre
 * carrier instead.
 */
export const FX_PASTEL_DAB_CAP = 16_384;

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/** Stable seed from stroke id (same FNV-style recipe as watercolor). */
export function fxBrushSeedFromKey(key: unknown): number {
  if (typeof key !== "string" || key.length === 0) return DEFAULT_FX_BRUSH_SEED;
  let hash = 2166136261;
  for (let index = 0; index < key.length; index++) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % (FX_BRUSH_SEED_RANGE.max + 1);
}

type StrokePoint = { x: number; y: number; pressure: number };

function safeCoord(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return clamp(value, -MAX_COORD, MAX_COORD);
}

function pressureAt(pressures: unknown, progress: number): number {
  if (!Array.isArray(pressures) || pressures.length === 0) return DEFAULT_PRESSURE;
  if (pressures.length === 1) return clamp01(finiteNumber(pressures[0], DEFAULT_PRESSURE));
  const p = clamp01(progress);
  const pos = p * (pressures.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(pressures.length - 1, Math.ceil(pos));
  const t = pos - lo;
  const a = clamp01(finiteNumber(pressures[lo], DEFAULT_PRESSURE));
  const b = clamp01(finiteNumber(pressures[hi], a));
  return a + (b - a) * t;
}

/**
 * Reads point `i`'s pressure directly when the caller's journal is aligned with its point array,
 * and falls back to the normalised resample when it is not.
 *
 * `pressureAt` samples a NORMALISED progress, and `(i / (n - 1)) * (n - 1)` does not round-trip to
 * `i` in binary floating point: at n = 800 the sample for i = 357 lands on 356.99999999999994 and
 * blends in a sliver of its neighbour. The value error is ~1e-15 and invisible on screen, but the
 * dependence on `n` is not — every appended sample re-derived EVERY earlier sample slightly
 * differently, so `FxOilDabPlanner`'s byte-equality verification found its prefix ending a few
 * hundred stations in and replanned the whole rest of the bed on every pointer move. Measured on a
 * 1600-sample oil sweep: 357 of 1458 dabs reused before, 1456 of 1458 after.
 *
 * Reading the slot the progress expression is trying to name removes the rounding and the
 * dependence together. A journal whose length does NOT match the point count (legacy documents,
 * resampled or symmetry-mirrored series) keeps the interpolating path, where the normalisation is
 * doing real work.
 */
function alignedPressureJournal(
  rawPressures: unknown,
  pairCount: number,
): readonly unknown[] | null {
  return Array.isArray(rawPressures) && rawPressures.length === pairCount
    ? rawPressures
    : null;
}

function sanitizePoints(rawPoints: unknown, rawPressures: unknown): StrokePoint[] {
  if (!Array.isArray(rawPoints)) return [];
  const pairCount = Math.floor(rawPoints.length / 2);
  const aligned = alignedPressureJournal(rawPressures, pairCount);
  const out: StrokePoint[] = [];
  for (let i = 0; i < pairCount; i++) {
    const x = safeCoord(rawPoints[i * 2]);
    const y = safeCoord(rawPoints[i * 2 + 1]);
    if (x === null || y === null) continue;
    const pressure = aligned
      ? clamp01(finiteNumber(aligned[i], DEFAULT_PRESSURE))
      : pressureAt(rawPressures, pairCount <= 1 ? 0 : i / (pairCount - 1));
    const prev = out.at(-1);
    if (prev && Math.hypot(x - prev.x, y - prev.y) <= POINT_EPS) {
      prev.pressure = pressure;
      continue;
    }
    out.push({ x, y, pressure });
  }
  return out;
}

/**
 * How much coarser one rung of the capped-spacing ladder is.
 *
 * The ladder exists so a capped bed keeps a stable prefix; the ratio decides what that costs in
 * density. A rung is only ever climbed, and climbing one is the single moment the whole bed has to
 * be replanned, so a coarse ratio buys fewer rebuilds and a fine one buys spacing closer to the
 * budget. This value is measured, not assumed — see the note in
 * `docs/perf/oil-family-stage-anatomy-2026-08-30.md`.
 */
const CAPPED_STATION_STEP_RATIO = 2 ** (1 / 4);

/** Hard stop for the rung search; far beyond any stroke a pointer can produce. */
const CAPPED_STATION_STEP_MAX_RUNGS = 512;

/**
 * The spacing a capped bed walks at: the natural spacing coarsened by whole ladder rungs until the
 * station count fits the budget.
 *
 * Depends only on `step`, the rung index and the budget — never on where the arc happens to end —
 * which is what keeps already-placed stations still while the stroke grows. The rung index rises
 * monotonically with `totalLength`, so the spacing never oscillates back and forth across a
 * boundary. Two rungs are reserved: one for the leading station, one for the tail station the walk
 * appends at the stroke's end.
 */
function cappedStationStep(
  step: number,
  totalLength: number,
  stationLimit: number,
): number {
  // Two rungs are reserved: the leading station and the tail station the walk appends at the
  // stroke's end. The interior budget may legitimately be ZERO — `maxDabs: 2` asks for exactly the
  // two endpoints — and flooring it at one would fit an interior station the caller has no room
  // for, which is then truncated off the END and takes the stroke's last point with it.
  const budget = Math.max(0, stationLimit - 2);
  let scaled = step;
  for (let rung = 0; rung < CAPPED_STATION_STEP_MAX_RUNGS; rung += 1) {
    if (Math.floor(totalLength / scaled) <= budget) return scaled;
    scaled *= CAPPED_STATION_STEP_RATIO;
  }
  return scaled;
}

/** Arc-length resample stations along a polyline. */
function sampleStations(
  points: readonly StrokePoint[],
  spacing: number,
  maximumStations = Number.POSITIVE_INFINITY,
  /**
   * How the station budget is honoured once the natural spacing overruns it.
   *
   * `refit-v1` is the original: fit exactly `maximumStations` across the whole arc. Every station
   * then depends on the arc's total length, so a growing stroke shares no prefix with its previous
   * plan. `prefix-stable-ladder-v2` coarsens the spacing on a fixed ladder instead, which keeps
   * placed stations still while the stroke grows. The ladder changes the dabs a capped stroke
   * produces, so it is opt-in per brush family rather than a blanket change.
   */
  capMode: FxOilCapStationMode = "refit-v1",
): StrokePoint[] {
  if (points.length === 0) return [];
  if (points.length === 1) return [points[0]!];
  const step = Math.max(0.35, spacing);
  const stationLimit = Number.isFinite(maximumStations)
    ? Math.max(1, Math.floor(maximumStations))
    : Number.POSITIVE_INFINITY;
  if (stationLimit === 1) return [points[0]!];

  let totalLength = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    totalLength += Math.hypot(current.x - previous.x, current.y - previous.y);
  }
  if (totalLength <= POINT_EPS) return [points.at(-1)!];

  const naturalStepCount = Math.floor(totalLength / step);
  const naturalTail = totalLength - naturalStepCount * step;
  const naturalStationCount =
    1 + naturalStepCount + (naturalTail > POINT_EPS ? 1 : 0);

  // A hard station budget must not make a long stroke disappear halfway through, and the way it
  // used to be honoured cost more than it saved: fitting exactly `stationLimit` stations across
  // the whole arc (`totalLength * index / (stationLimit - 1)`) moves EVERY station whenever the
  // arc grows, so past the cap a growing stroke shared no prefix with its previous plan and every
  // downstream stage — dab bed, smoothed geometry, bristle runs, the whole carrier — was rebuilt
  // from scratch on every pointer move.
  //
  // The budget is honoured by coarsening the spacing instead, on a fixed ladder. Stations then sit
  // at multiples of one step that does not depend on `totalLength`, so growing the arc appends
  // stations without disturbing the ones already there, and the incremental planners keep their
  // prefixes. The step only changes when the arc crosses a ladder rung, which is logarithmic in
  // stroke length rather than once per move.
  if (naturalStationCount > stationLimit && capMode === "refit-v1") {
    const stations: StrokePoint[] = [];
    let segmentIndex = 1;
    let segmentStartDistance = 0;
    for (let stationIndex = 0; stationIndex < stationLimit; stationIndex += 1) {
      if (stationIndex === 0) {
        stations.push(points[0]!);
        continue;
      }
      if (stationIndex === stationLimit - 1) {
        stations.push(points.at(-1)!);
        continue;
      }
      const targetDistance = totalLength * (stationIndex / (stationLimit - 1));
      let start = points[segmentIndex - 1]!;
      let end = points[segmentIndex]!;
      let segmentLength = Math.hypot(end.x - start.x, end.y - start.y);
      while (
        segmentIndex < points.length - 1
        && segmentStartDistance + segmentLength < targetDistance
      ) {
        segmentStartDistance += segmentLength;
        segmentIndex += 1;
        start = points[segmentIndex - 1]!;
        end = points[segmentIndex]!;
        segmentLength = Math.hypot(end.x - start.x, end.y - start.y);
      }
      const amount = segmentLength > POINT_EPS
        ? clamp((targetDistance - segmentStartDistance) / segmentLength, 0, 1)
        : 0;
      stations.push({
        x: start.x + (end.x - start.x) * amount,
        y: start.y + (end.y - start.y) * amount,
        pressure: start.pressure + (end.pressure - start.pressure) * amount,
      });
    }
    return stations;
  }

  const walkStep = naturalStationCount > stationLimit
    ? cappedStationStep(step, totalLength, stationLimit)
    : step;

  const stations: StrokePoint[] = [points[0]!];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (segLen <= POINT_EPS) continue;
    let consumed = 0;
    while (carry + (segLen - consumed) >= walkStep) {
      const need = walkStep - carry;
      const t = (consumed + need) / segLen;
      stations.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        pressure: a.pressure + (b.pressure - a.pressure) * t,
      });
      consumed += need;
      carry = 0;
    }
    carry += segLen - consumed;
  }
  const last = points[points.length - 1]!;
  const tail = stations[stations.length - 1]!;
  if (Math.hypot(last.x - tail.x, last.y - tail.y) > POINT_EPS) {
    stations.push(last);
  }
  return stations;
}

// ---------------------------------------------------------------------------
// Glow — multi-pass halo (PicsArt / Express neon-glow depth)
// ---------------------------------------------------------------------------

export type FxGlowPass = {
  /** Stroke width multiplier vs base. */
  widthScale: number;
  /** Relative opacity (0–1), multiplied by element opacity later. */
  opacity: number;
};

export type FxNeonPass = FxGlowPass & {
  /** Coloured halo passes sit behind a near-white luminous core. */
  tone: "color" | "white-core";
};

export type StudioFxPressureBrushId =
  | "highlighter"
  | "chisel-highlighter"
  | "pastel-highlighter"
  | "neon"
  | "glow"
  | "soft-glow";

export interface StudioFxBrushPressureResponse {
  readonly pressure: number;
  /** Selected toolbar diameter multiplier. Highlighters deliberately keep this range narrow. */
  readonly widthScale: number;
  /** Local pigment/light energy multiplier before whole-element opacity. */
  readonly opacityScale: number;
  /** Outer halo multiplier. Neutral pressure is exactly one for legacy/mouse appearance parity. */
  readonly haloScale: number;
}

export type StudioFxPressurePathSegment =
  | (StudioFxBrushPressureResponse & {
      readonly command: "line";
      readonly moveX: number;
      readonly moveY: number;
      readonly endX: number;
      readonly endY: number;
      readonly sourceSegmentIndex: number;
    })
  | (StudioFxBrushPressureResponse & {
      readonly command: "quadratic";
      readonly moveX: number;
      readonly moveY: number;
      readonly controlX: number;
      readonly controlY: number;
      readonly endX: number;
      readonly endY: number;
      readonly sourceSegmentIndex: number;
    })
  | (StudioFxBrushPressureResponse & {
      readonly command: "cubic";
      readonly moveX: number;
      readonly moveY: number;
      readonly control1X: number;
      readonly control1Y: number;
      readonly control2X: number;
      readonly control2Y: number;
      readonly endX: number;
      readonly endY: number;
      readonly sourceSegmentIndex: number;
    });

export interface StudioFxPressurePathPlan {
  readonly kind: "studio-fx-pressure-path";
  readonly brushId: StudioFxPressureBrushId;
  readonly sourcePointCount: number;
  readonly segments: readonly StudioFxPressurePathSegment[];
}

export type StudioFxLuminousBrushId = "neon" | "glow" | "soft-glow";

/**
 * Luminous colour is accumulated with premultiplied source-over rather than raw additive RGB.
 * `lighter` (and repeated `screen`) drives unequal colour channels towards white at crossings,
 * while source-over increases coverage without changing the selected straight-alpha hue. It also
 * keeps coloured halos visible on white, dark and transparent document backgrounds.
 */
export const STUDIO_FX_LUMINOUS_COMPOSITE_OPERATION = "source-over" as const;

export type StudioFxLuminousRibbonRole =
  | "body"
  | "join"
  | "start-cap"
  | "end-cap";

export interface StudioFxLuminousRibbonPolygon {
  /**
   * Clockwise/counter-clockwise is normalised across every polygon. A non-zero compound fill
   * therefore behaves as a geometric union even when the centreline retraces or crosses itself.
   */
  readonly points: readonly number[];
  readonly role: StudioFxLuminousRibbonRole;
}

export interface StudioFxLuminousRibbonPassPlan {
  readonly kind: "studio-fx-luminous-ribbon-pass";
  readonly version: "studio-fx-luminous-ribbon-v1";
  readonly brushId: StudioFxLuminousBrushId;
  /**
   * The renderer submits all polygons in one beginPath/fill operation. Alpha is consequently
   * applied once per gesture/pass instead of once per source segment.
   */
  readonly coverageOperation: "stroke-local-single-fill";
  /**
   * This is applied outside the local mask. Separate DrawEls build opacity without adding RGB
   * energy, while a self-crossing inside one DrawEl cannot over-brighten or lose chroma.
   */
  readonly compositeOperation: typeof STUDIO_FX_LUMINOUS_COMPOSITE_OPERATION;
  readonly fillRule: "nonzero";
  readonly cap: "round";
  readonly sourceSegmentCount: number;
  readonly flattenedSegmentCount: number;
  readonly capped: boolean;
  readonly passWidthScale: number;
  readonly luminousCore: boolean;
  /** Complete pass alpha, including the pressure response. */
  readonly opacity: number;
  readonly polygons: readonly StudioFxLuminousRibbonPolygon[];
}

export interface StudioFxLuminousRibbonPathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
}

interface FxPressureAxis {
  readonly light: number;
  readonly heavy: number;
  readonly curve: number;
}

interface FxPressureProfile {
  readonly width: FxPressureAxis;
  readonly opacity: FxPressureAxis;
  readonly halo: FxPressureAxis;
}

const FX_PRESSURE_PROFILE: Readonly<
  Record<StudioFxPressureBrushId, FxPressureProfile>
> = {
  highlighter: {
    // A marker nib is physically rigid. Pressure primarily changes ink delivery, not its footprint.
    width: { light: 0.94, heavy: 1.08, curve: 0.72 },
    opacity: { light: 0.46, heavy: 1.08, curve: 0.84 },
    halo: { light: 1, heavy: 1, curve: 1 },
  },
  "chisel-highlighter": {
    width: { light: 0.97, heavy: 1.04, curve: 0.76 },
    opacity: { light: 0.42, heavy: 1.1, curve: 0.86 },
    halo: { light: 1, heavy: 1, curve: 1 },
  },
  "pastel-highlighter": {
    width: { light: 0.9, heavy: 1.14, curve: 0.78 },
    opacity: { light: 0.34, heavy: 1.14, curve: 0.92 },
    halo: { light: 1, heavy: 1, curve: 1 },
  },
  neon: {
    width: { light: 0.72, heavy: 1.24, curve: 0.82 },
    opacity: { light: 0.42, heavy: 1.1, curve: 0.88 },
    halo: { light: 0.82, heavy: 1.42, curve: 0.78 },
  },
  glow: {
    width: { light: 0.72, heavy: 1.3, curve: 0.84 },
    opacity: { light: 0.34, heavy: 1.14, curve: 0.92 },
    halo: { light: 0.78, heavy: 1.54, curve: 0.76 },
  },
  "soft-glow": {
    width: { light: 0.8, heavy: 1.36, curve: 0.82 },
    opacity: { light: 0.28, heavy: 1.12, curve: 0.94 },
    halo: { light: 0.86, heavy: 1.68, curve: 0.74 },
  },
};

const FX_PRESSURE_LEGACY_NEUTRAL = 0.5;
const FX_PRESSURE_CURRENT_NOMINAL = 0.8;

function centeredFxPressureResponse(
  pressure: number,
  axis: FxPressureAxis,
): number {
  if (pressure <= FX_PRESSURE_CURRENT_NOMINAL) {
    const amount = Math.pow(
      pressure / FX_PRESSURE_CURRENT_NOMINAL,
      axis.curve,
    );
    return axis.light + (1 - axis.light) * amount;
  }
  const amount = Math.pow(
    (pressure - FX_PRESSURE_CURRENT_NOMINAL)
      / (1 - FX_PRESSURE_CURRENT_NOMINAL),
    axis.curve,
  );
  return 1 + (axis.heavy - 1) * amount;
}

export function isStudioFxPressureBrushId(
  value: unknown,
): value is StudioFxPressureBrushId {
  return typeof value === "string"
    && Object.prototype.hasOwnProperty.call(FX_PRESSURE_PROFILE, value);
}

/**
 * Maps the already-canonical `DrawEl.pressures` channel to material response. No velocity
 * inference lives here: input, replay, collaboration and export therefore receive the same value.
 */
export function resolveStudioFxBrushPressureResponse(
  brushId: StudioFxPressureBrushId,
  pressureInput: unknown,
  minimumDiameterRatio?: unknown,
): StudioFxBrushPressureResponse {
  const pressure = clamp(
    finiteNumber(pressureInput, FX_PRESSURE_CURRENT_NOMINAL),
    0,
    1,
  );
  const profile = FX_PRESSURE_PROFILE[brushId];
  return Object.freeze({
    pressure,
    widthScale: applyStudioMaterialMinimumDiameterRatio(
      centeredFxPressureResponse(pressure, profile.width),
      minimumDiameterRatio,
    ),
    opacityScale: centeredFxPressureResponse(pressure, profile.opacity),
    haloScale: centeredFxPressureResponse(pressure, profile.halo),
  });
}

function neutralStudioFxBrushPressureResponse(
  pressure = FX_PRESSURE_LEGACY_NEUTRAL,
): StudioFxBrushPressureResponse {
  return Object.freeze({
    pressure,
    widthScale: 1,
    opacityScale: 1,
    haloScale: 1,
  });
}

/**
 * A missing version field is a persisted legacy mark and therefore keeps the selected toolbar
 * appearance. Canonical-v1 interprets every stored pressure, including an exact stylus 0.5.
 */
export function resolveStudioFxBrushTapPressureResponse(
  brushId: StudioFxPressureBrushId,
  pressureInput: unknown,
  pressureModel?: StudioMaterialPressureModel,
  minimumDiameterRatio?: unknown,
): StudioFxBrushPressureResponse {
  return pressureModel === STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1
    ? resolveStudioFxBrushPressureResponse(
        brushId,
        pressureInput,
        minimumDiameterRatio,
      )
    : neutralStudioFxBrushPressureResponse();
}

export interface StudioFxPressurePassResponse {
  /** Complete multiplier applied to the pass' existing width scale. */
  readonly widthScale: number;
  /** Complete multiplier applied to the pass' existing opacity. */
  readonly opacityScale: number;
}

/**
 * Outer luminous passes react more through radius, while the innermost core reacts through nib
 * width. Both Canvas and SVG call this exact function, preventing a pressure-dependent handoff pop.
 */
export function resolveStudioFxPressurePassResponse(
  pressure: StudioFxBrushPressureResponse,
  passWidthScale: number,
  luminousCore: boolean,
): StudioFxPressurePassResponse {
  const haloWeight = luminousCore
    ? 0
    : clamp((finiteNumber(passWidthScale, 1) - 0.8) / 3.4, 0, 1);
  return Object.freeze({
    widthScale:
      pressure.widthScale
      + (pressure.haloScale - pressure.widthScale) * haloWeight,
    opacityScale: luminousCore
      ? Math.sqrt(pressure.opacityScale)
      : pressure.opacityScale,
  });
}

interface FxPressurePoint {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
}

/**
 * Point `index`'s pressure when the journal runs parallel to the points, which every live stroke's
 * does. Same reason as `alignedPressureJournal` above: the normalised progress expression does not
 * round-trip through binary floating point, so an earlier point's pressure came out fractionally
 * different depending on how far the stroke had grown — enough to make the batch planner and the
 * incremental builder disagree in the last ulp, and to defeat prefix verification downstream.
 */
function parallelPathPressureAt(
  pressures: readonly number[],
  index: number,
): number {
  return clamp(finiteNumber(pressures[index], 0), 0, 1);
}

function fixedPathPressureAt(
  pressures: readonly number[] | null | undefined,
  progress: number,
): number {
  if (!pressures || pressures.length === 0) return FX_PRESSURE_LEGACY_NEUTRAL;
  if (pressures.length === 1) {
    return clamp(finiteNumber(pressures[0], 0), 0, 1);
  }
  const position = clamp(progress, 0, 1) * (pressures.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.min(pressures.length - 1, Math.ceil(position));
  const amount = position - lowerIndex;
  const lower = clamp(
    finiteNumber(pressures[lowerIndex], 0),
    0,
    1,
  );
  const upper = clamp(finiteNumber(pressures[upperIndex], lower), 0, 1);
  return lower + (upper - lower) * amount;
}

function sanitizeFxPressurePathPoints(
  points: readonly number[],
  pressures: readonly number[] | null | undefined,
): FxPressurePoint[] {
  const pairCount = Math.min(1_000_000, Math.floor(points.length / 2));
  const parallel = pressures && pressures.length === pairCount ? pressures : null;
  const result: FxPressurePoint[] = [];
  for (let pointIndex = 0; pointIndex < pairCount; pointIndex += 1) {
    const x = safeCoord(points[pointIndex * 2]);
    const y = safeCoord(points[pointIndex * 2 + 1]);
    if (x === null || y === null) break;
    const pressure = parallel
      ? parallelPathPressureAt(parallel, pointIndex)
      : fixedPathPressureAt(
          pressures,
          pairCount <= 1 ? 0 : pointIndex / (pairCount - 1),
        );
    const previous = result.at(-1);
    if (previous && Math.hypot(x - previous.x, y - previous.y) <= POINT_EPS) {
      result[result.length - 1] = { x, y, pressure };
    } else {
      result.push({ x, y, pressure });
    }
  }
  return result;
}

interface FxCardinalControl {
  readonly beforeX: number;
  readonly beforeY: number;
  readonly afterX: number;
  readonly afterY: number;
}

/**
 * One cardinal control, identical math to the historical `cardinalFxControls` loop body.
 * Depends only on points index-1..index+1, which is what makes the pressure path suffix-stable
 * for the incremental builder below.
 */
function cardinalFxControlAt(
  points: readonly FxPressurePoint[],
  index: number,
  tension: number,
): FxCardinalControl | null {
  if (index < 1 || index >= points.length - 1) return null;
  const previous = points[index - 1]!;
  const current = points[index]!;
  const next = points[index + 1]!;
  const previousDistance = Math.hypot(
    current.x - previous.x,
    current.y - previous.y,
  );
  const nextDistance = Math.hypot(next.x - current.x, next.y - current.y);
  const totalDistance = previousDistance + nextDistance;
  if (totalDistance <= POINT_EPS) return null;
  const beforeFactor = tension * previousDistance / totalDistance;
  const afterFactor = tension * nextDistance / totalDistance;
  return {
    beforeX: current.x - beforeFactor * (next.x - previous.x),
    beforeY: current.y - beforeFactor * (next.y - previous.y),
    afterX: current.x + afterFactor * (next.x - previous.x),
    afterY: current.y + afterFactor * (next.y - previous.y),
  };
}

function cardinalFxControls(
  points: readonly FxPressurePoint[],
  tension: number,
): Array<FxCardinalControl | null> {
  return Array.from(
    { length: points.length },
    (_ignored, index) => cardinalFxControlAt(points, index, tension),
  );
}

/**
 * One pressure-path segment, extracted from the historical planner loop body so the batch planner
 * and the incremental builder emit byte-identical commands from the same inputs.
 */
function emitFxPressurePathSegment(
  points: readonly FxPressurePoint[],
  controlAt: (index: number) => FxCardinalControl | null,
  sourceSegmentIndex: number,
  sourcePointCount: number,
  resolvePressure: (start: FxPressurePoint, end: FxPressurePoint) => StudioFxBrushPressureResponse,
): StudioFxPressurePathSegment {
  const start = points[sourceSegmentIndex]!;
  const end = points[sourceSegmentIndex + 1]!;
  const pressure = resolvePressure(start, end);
  const startControl = controlAt(sourceSegmentIndex);
  const endControl = controlAt(sourceSegmentIndex + 1);
  if (sourceSegmentIndex === 0 && endControl) {
    return Object.freeze({
      command: "quadratic",
      moveX: start.x,
      moveY: start.y,
      controlX: endControl.beforeX,
      controlY: endControl.beforeY,
      endX: end.x,
      endY: end.y,
      sourceSegmentIndex,
      ...pressure,
    });
  }
  if (sourceSegmentIndex === sourcePointCount - 2 && startControl) {
    return Object.freeze({
      command: "quadratic",
      moveX: start.x,
      moveY: start.y,
      controlX: startControl.afterX,
      controlY: startControl.afterY,
      endX: end.x,
      endY: end.y,
      sourceSegmentIndex,
      ...pressure,
    });
  }
  if (startControl && endControl) {
    return Object.freeze({
      command: "cubic",
      moveX: start.x,
      moveY: start.y,
      control1X: startControl.afterX,
      control1Y: startControl.afterY,
      control2X: endControl.beforeX,
      control2Y: endControl.beforeY,
      endX: end.x,
      endY: end.y,
      sourceSegmentIndex,
      ...pressure,
    });
  }
  return Object.freeze({
    command: "line",
    moveX: start.x,
    moveY: start.y,
    endX: end.x,
    endY: end.y,
    sourceSegmentIndex,
    ...pressure,
  });
}

/**
 * Pressure-bearing port of the Konva cardinal path used by the fixed-path FX brushes.
 *
 * Each command retains the historical Q/C geometry while carrying a midpoint pressure response.
 * Appending a future point cannot rewrite pressure on earlier commands, and active/retained Canvas
 * plus SVG serialize this same immutable command list.
 */
export function planStudioFxBrushPressurePath(input: {
  readonly brushId: StudioFxPressureBrushId;
  readonly points: readonly number[];
  readonly pressures?: readonly number[] | null;
  readonly pressureModel?: StudioMaterialPressureModel;
  readonly minimumDiameterRatio?: unknown;
  readonly tension?: unknown;
}): StudioFxPressurePathPlan {
  const points = sanitizeFxPressurePathPoints(input.points, input.pressures);
  const canonicalPressure =
    input.pressureModel === STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1;
  const sourcePointCount = points.length;
  if (sourcePointCount < 2) {
    return Object.freeze({
      kind: "studio-fx-pressure-path",
      brushId: input.brushId,
      sourcePointCount,
      segments: Object.freeze([]),
    });
  }
  const tension = clamp(finiteNumber(input.tension, 0), 0, 1);
  const controls = tension > 0 && sourcePointCount >= 3
    ? cardinalFxControls(points, tension)
    : [];
  const resolvePressure = (
    start: FxPressurePoint,
    end: FxPressurePoint,
  ): StudioFxBrushPressureResponse => (
    canonicalPressure
      ? resolveStudioFxBrushPressureResponse(
          input.brushId,
          (start.pressure + end.pressure) / 2,
          input.minimumDiameterRatio,
        )
      : neutralStudioFxBrushPressureResponse()
  );
  const segments: StudioFxPressurePathSegment[] = [];
  for (
    let sourceSegmentIndex = 0;
    sourceSegmentIndex < sourcePointCount - 1;
    sourceSegmentIndex += 1
  ) {
    segments.push(emitFxPressurePathSegment(
      points,
      (index) => controls[index] ?? null,
      sourceSegmentIndex,
      sourcePointCount,
      resolvePressure,
    ));
  }
  return Object.freeze({
    kind: "studio-fx-pressure-path",
    brushId: input.brushId,
    sourcePointCount,
    segments: Object.freeze(segments),
  });
}

export interface StudioIncrementalFxPressurePathBuilder {
  /**
   * 자라나는 획의 현재 스냅샷을 소비하고 전체 압력 경로 플랜을 돌려준다. 이미 소비한 raw
   * prefix는 다시 읽지 않으며(마지막 소비 점·필압 슬롯 하나로 O(1) 검증), 되돌리기/재작성이
   * 감지되면 전체를 다시 만든다. 반환 플랜의 `segments`는 빌더 내부 보관 배열이므로 수정하면
   * 안 된다.
   */
  append(input: {
    readonly brushId: StudioFxPressureBrushId;
    readonly points: readonly number[];
    readonly pressures?: readonly number[] | null;
    readonly pressureModel?: StudioMaterialPressureModel;
    readonly minimumDiameterRatio?: unknown;
    readonly tension?: unknown;
  }): StudioFxPressurePathPlan;
  /**
   * 마지막 `append()`가 돌려준 `segments`에서 앞으로 어떤 append도 다시 쓰지 않는 안정 prefix
   * 길이. 그 뒤(휘발 꼬리 ≤ 3 + 아주 짧은 획 특례)는 다음 호출이 다시 방출할 수 있으므로,
   * 하류 증분 소비자는 이 길이까지만 세그먼트를 신뢰해야 한다.
   */
  stableSegmentCount(): number;
  /** 전체 재구축(리셋)마다 증가한다 — 하류 증분 소비자의 prefix 신뢰를 무효화하는 신호. */
  generation(): number;
}

/**
 * 최근 append가 다시 방출해야 하는 기존 세그먼트 수. 마지막 sanitize 점은 EPS 병합으로
 * 교체될 수 있고(cardinal control이 ±1 이웃을 읽으므로 그 여파가 세그먼트 두 개 앞까지
 * 미친다), 직전의 "마지막 세그먼트" quadratic 분기도 중간 cubic으로 승격되므로, 여유 하나를
 * 더해 세 개를 다시 만든다 — append당 상수 비용이다.
 */
const FX_PRESSURE_PATH_VOLATILE_TAIL_SEGMENTS = 3;

/**
 * 라이브/리렌더용 증분 압력 경로 빌더.
 *
 * `planStudioFxBrushPressurePath`는 매 이동 전체 스트로크를 다시 계획한다(이동당 O(n) →
 * 스트로크당 O(n²) — 장획 게이트가 잡는 형태). 필압 배열이 점 배열과 나란하거나 아예 없을 때
 * (라이브 획은 항상 이 경우다) 진행률 필압 표본은 인덱스별 조회로 대수적으로 환원되고, cardinal
 * control은 ±1 이웃만 읽으므로 세그먼트는 국소 함수가 된다 — 즉 append 전용으로 만들 수 있다.
 * 기하·필압 수치는 배치 플래너와 같은 `emitFxPressurePathSegment`에서 나온다(유지된 옛 점의
 * 필압은 소비 시점의 진행률로 고정되어 신선한 배치 플랜과 최대 1 ulp 차이 — 문서 재적재 시
 * 배치 리플랜이 정본을 다시 그린다). 검증은 캘리그래피 증분 빌더와 같은 규약을 따른다: 마지막
 * 소비 raw 점(과 그 필압 슬롯) 하나로 O(1) 확인하고, 다르거나 배열이 줄면 전체 재구축.
 */
export function createStudioIncrementalFxPressurePathBuilder(): StudioIncrementalFxPressurePathBuilder {
  const sanitized: FxPressurePoint[] = [];
  const segments: StudioFxPressurePathSegment[] = [];
  let consumedRawPairs = 0;
  let lastRawX = 0;
  let lastRawY = 0;
  let lastRawPressureSlot: number | undefined;
  let configBrushId: StudioFxPressureBrushId | null = null;
  let configTension = 0;
  let configCanonical = false;
  let configMinimumDiameterRatio: unknown;
  let configParallelPressures = false;
  let stableSegments = 0;
  let rebuildGeneration = 0;

  const reset = (): void => {
    sanitized.length = 0;
    segments.length = 0;
    consumedRawPairs = 0;
    lastRawPressureSlot = undefined;
    stableSegments = 0;
    rebuildGeneration += 1;
  };

  return {
    append(input) {
      const pairCount = Math.min(1_000_000, Math.floor(input.points.length / 2));
      const tension = clamp(finiteNumber(input.tension, 0), 0, 1);
      const canonicalPressure =
        input.pressureModel === STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1;
      const pressures = input.pressures;
      const pressuresAbsent = !pressures || pressures.length === 0;
      const pressuresParallel = !pressuresAbsent && pressures.length === pairCount;
      // 진행률 표본이 인덱스별 조회로 환원되지 않는 입력(리샘플·레거시)은 유지가 불가능하다 —
      // 배치 플래너로 위임하고 내부 상태는 비워 다음 나란한 입력부터 다시 쌓는다.
      if (!pressuresAbsent && !pressuresParallel) {
        reset();
        configBrushId = null;
        return planStudioFxBrushPressurePath(input);
      }
      const configMatches = configBrushId === input.brushId
        && configTension === tension
        && configCanonical === canonicalPressure
        && Object.is(configMinimumDiameterRatio, input.minimumDiameterRatio)
        && configParallelPressures === pressuresParallel;
      let prefixVerified = configMatches && pairCount >= consumedRawPairs;
      if (prefixVerified && consumedRawPairs > 0) {
        const lastIndex = consumedRawPairs - 1;
        prefixVerified = input.points[lastIndex * 2] === lastRawX
          && input.points[lastIndex * 2 + 1] === lastRawY
          && (!pressuresParallel || pressures![lastIndex] === lastRawPressureSlot);
      }
      if (!prefixVerified) reset();
      configBrushId = input.brushId;
      configTension = tension;
      configCanonical = canonicalPressure;
      configMinimumDiameterRatio = input.minimumDiameterRatio;
      configParallelPressures = pressuresParallel;

      const previousSegmentCount = segments.length;
      let sanitizedChangedFrom = sanitized.length;
      for (let pointIndex = consumedRawPairs; pointIndex < pairCount; pointIndex += 1) {
        const x = safeCoord(input.points[pointIndex * 2]);
        const y = safeCoord(input.points[pointIndex * 2 + 1]);
        if (x === null || y === null) break;
        // Parallel journals read their own slot, so a point consumed at one stroke length keeps
        // exactly the value the batch planner gives it at any other — the ulp gap between the
        // live builder and the commit replay closes rather than being documented.
        const pressure = pressuresParallel
          ? parallelPathPressureAt(pressures!, pointIndex)
          : fixedPathPressureAt(
              pressures,
              pairCount <= 1 ? 0 : pointIndex / (pairCount - 1),
            );
        const previous = sanitized.at(-1);
        if (previous && Math.hypot(x - previous.x, y - previous.y) <= POINT_EPS) {
          sanitized[sanitized.length - 1] = { x, y, pressure };
          sanitizedChangedFrom = Math.min(sanitizedChangedFrom, sanitized.length - 1);
        } else {
          sanitized.push({ x, y, pressure });
        }
        consumedRawPairs = pointIndex + 1;
        lastRawX = input.points[pointIndex * 2]!;
        lastRawY = input.points[pointIndex * 2 + 1]!;
        lastRawPressureSlot = pressuresParallel ? pressures![pointIndex] : undefined;
      }

      const sourcePointCount = sanitized.length;
      if (sourcePointCount < 2) {
        segments.length = 0;
        stableSegments = 0;
        return {
          kind: "studio-fx-pressure-path",
          brushId: input.brushId,
          sourcePointCount,
          segments,
        };
      }
      const useControls = tension > 0 && sourcePointCount >= 3;
      const controlAt = (index: number): FxCardinalControl | null => (
        useControls ? cardinalFxControlAt(sanitized, index, tension) : null
      );
      const resolvePressure = (
        start: FxPressurePoint,
        end: FxPressurePoint,
      ): StudioFxBrushPressureResponse => (
        canonicalPressure
          ? resolveStudioFxBrushPressureResponse(
              input.brushId,
              (start.pressure + end.pressure) / 2,
              input.minimumDiameterRatio,
            )
          : neutralStudioFxBrushPressureResponse()
      );
      // 아주 짧은 획은 첫 세그먼트의 quadratic 분기까지 흔들리므로 통째로 다시 만든다.
      const rebuildFrom = sourcePointCount < 5
        ? 0
        : Math.min(
            Math.max(0, previousSegmentCount - FX_PRESSURE_PATH_VOLATILE_TAIL_SEGMENTS),
            Math.max(0, sanitizedChangedFrom - 2),
          );
      segments.length = rebuildFrom;
      for (
        let sourceSegmentIndex = rebuildFrom;
        sourceSegmentIndex < sourcePointCount - 1;
        sourceSegmentIndex += 1
      ) {
        segments.push(emitFxPressurePathSegment(
          sanitized,
          controlAt,
          sourceSegmentIndex,
          sourcePointCount,
          resolvePressure,
        ));
      }
      // 미래 append의 rebuildFrom 하한: 점이 5개 미만이면 통째로 다시 만들 수 있고, 그
      // 이상이면 항상 `segments.length - 3` 이상에서 시작한다(EPS 병합 여파 포함 — 위 주석).
      stableSegments = sourcePointCount < 5
        ? 0
        : Math.max(0, segments.length - FX_PRESSURE_PATH_VOLATILE_TAIL_SEGMENTS);
      return {
        kind: "studio-fx-pressure-path",
        brushId: input.brushId,
        sourcePointCount,
        segments,
      };
    },
    stableSegmentCount() {
      return stableSegments;
    },
    generation() {
      return rebuildGeneration;
    },
  };
}

interface FxLuminousPoint {
  readonly x: number;
  readonly y: number;
}

interface FxLuminousSection {
  readonly from: FxLuminousPoint;
  readonly to: FxLuminousPoint;
  readonly fromRadius: number;
  readonly toRadius: number;
  readonly opacityScale: number;
}

interface FxLuminousSegmentResponse {
  readonly widthScale: number;
  readonly opacityScale: number;
}

const FX_LUMINOUS_RIBBON_VERSION =
  "studio-fx-luminous-ribbon-v1" as const;
const FX_LUMINOUS_MAX_FLATTENED_SEGMENTS = 262_144;
const FX_LUMINOUS_MAX_SUBDIVISIONS = 16;
const FX_LUMINOUS_ROUND_STEPS = 24;
const FX_LUMINOUS_QUANTIZE_SCALE = 10_000;

function quantizeFxLuminous(value: number): number {
  const result = Math.round(value * FX_LUMINOUS_QUANTIZE_SCALE)
    / FX_LUMINOUS_QUANTIZE_SCALE;
  return Object.is(result, -0) ? 0 : result;
}

function fxLuminousPointAt(
  segment: StudioFxPressurePathSegment,
  progress: number,
): FxLuminousPoint {
  const amount = clamp(progress, 0, 1);
  const inverse = 1 - amount;
  if (segment.command === "cubic") {
    return {
      x: inverse ** 3 * segment.moveX
        + 3 * inverse * inverse * amount * segment.control1X
        + 3 * inverse * amount * amount * segment.control2X
        + amount ** 3 * segment.endX,
      y: inverse ** 3 * segment.moveY
        + 3 * inverse * inverse * amount * segment.control1Y
        + 3 * inverse * amount * amount * segment.control2Y
        + amount ** 3 * segment.endY,
    };
  }
  if (segment.command === "quadratic") {
    return {
      x: inverse * inverse * segment.moveX
        + 2 * inverse * amount * segment.controlX
        + amount * amount * segment.endX,
      y: inverse * inverse * segment.moveY
        + 2 * inverse * amount * segment.controlY
        + amount * amount * segment.endY,
    };
  }
  return {
    x: segment.moveX + (segment.endX - segment.moveX) * amount,
    y: segment.moveY + (segment.endY - segment.moveY) * amount,
  };
}

function fxLuminousPointLineDistance(
  point: FxLuminousPoint,
  start: FxLuminousPoint,
  end: FxLuminousPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length <= POINT_EPS) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  return Math.abs(
    dy * point.x
    - dx * point.y
    + end.x * start.y
    - end.y * start.x,
  ) / length;
}

function fxLuminousSubdivisionCount(
  segment: StudioFxPressurePathSegment,
  passWidth: number,
): number {
  if (segment.command === "line") return 1;
  const start = { x: segment.moveX, y: segment.moveY };
  const end = { x: segment.endX, y: segment.endY };
  const flatness = segment.command === "cubic"
    ? Math.max(
        fxLuminousPointLineDistance(
          { x: segment.control1X, y: segment.control1Y },
          start,
          end,
        ),
        fxLuminousPointLineDistance(
          { x: segment.control2X, y: segment.control2Y },
          start,
          end,
        ),
      )
    : fxLuminousPointLineDistance(
        { x: segment.controlX, y: segment.controlY },
        start,
        end,
      );
  const tolerance = clamp(passWidth * 0.025, 0.1, 0.55);
  if (!Number.isFinite(flatness) || flatness <= tolerance) return 1;
  return clamp(
    2 ** Math.ceil(Math.log2(Math.sqrt(flatness / tolerance))),
    1,
    FX_LUMINOUS_MAX_SUBDIVISIONS,
  );
}

function fxLuminousSamePoint(
  left: FxLuminousPoint,
  right: FxLuminousPoint,
): boolean {
  return Math.hypot(left.x - right.x, left.y - right.y) <= POINT_EPS;
}

function fxLuminousSegmentResponses(
  pressurePath: StudioFxPressurePathPlan,
  passWidthScale: number,
  luminousCore: boolean,
): readonly FxLuminousSegmentResponse[] {
  return Object.freeze(pressurePath.segments.map((segment) => (
    resolveStudioFxPressurePassResponse(
      segment,
      passWidthScale,
      luminousCore,
    )
  )));
}

function fxLuminousInterpolatedScale(
  responses: readonly FxLuminousSegmentResponse[],
  segments: readonly StudioFxPressurePathSegment[],
  segmentIndex: number,
  edge: "from " | "to",
  key: keyof FxLuminousSegmentResponse,
): number {
  const current = responses[segmentIndex]![key];
  const adjacentIndex = edge === "from " ? segmentIndex - 1 : segmentIndex + 1;
  const adjacent = responses[adjacentIndex];
  const adjacentSegment = segments[adjacentIndex];
  const segment = segments[segmentIndex]!;
  if (!adjacent || !adjacentSegment) return current;
  const continuous = edge === "from "
    ? fxLuminousSamePoint(
        { x: adjacentSegment.endX, y: adjacentSegment.endY },
        { x: segment.moveX, y: segment.moveY },
      )
    : fxLuminousSamePoint(
        { x: segment.endX, y: segment.endY },
        { x: adjacentSegment.moveX, y: adjacentSegment.moveY },
      );
  return continuous ? (current + adjacent[key]) / 2 : current;
}

/**
 * The growing state one luminous pass is planned into.
 *
 * Sections, runs, polygons and the length-weighted opacity all advance left to right, so a pass
 * that already consumed a prefix can extend it instead of re-deriving it. The batch planner runs
 * the very same appends once from index 0, which is what keeps the two from drifting.
 */
interface FxLuminousPlanState {
  readonly sections: FxLuminousSection[];
  readonly polygons: StudioFxLuminousRibbonPolygon[];
  /**
   * First section of the run still being extended. A run breaks where a section's `from` leaves
   * the previous section's `to`, and that predicate reads only the adjacent pair, so an append can
   * extend this run or open the next one but can never re-cut an earlier boundary.
   */
  openRunStart: number;
  /**
   * `polygons.length` without the open run's two trailing caps. Everything below it is final;
   * only those two caps move as the run grows, which is what makes the flat array append-only.
   */
  bodyJoinCount: number;
  capped: boolean;
  weightedOpacity: number;
  totalLength: number;
}

function createFxLuminousPlanState(): FxLuminousPlanState {
  return {
    sections: [],
    polygons: [],
    openRunStart: 0,
    bodyJoinCount: 0,
    capped: false,
    weightedOpacity: 0,
    totalLength: 0,
  };
}

/**
 * Flattens pressure segments `[fromSegmentIndex, toSegmentIndex)` onto `state`.
 *
 * Section i reads only segments i-1..i+1 — `fxLuminousInterpolatedScale` averages a response
 * across a continuous joint — so a caller that stops one segment short of its producer's stable
 * watermark gets sections it will never have to recompute.
 */
function appendFxLuminousSections(
  state: FxLuminousPlanState,
  pressurePath: StudioFxPressurePathPlan,
  passWidth: number,
  responses: readonly FxLuminousSegmentResponse[],
  fromSegmentIndex: number,
  toSegmentIndex: number,
): void {
  const sections = state.sections;
  const segments = pressurePath.segments;
  for (
    let segmentIndex = fromSegmentIndex;
    segmentIndex < toSegmentIndex;
    segmentIndex += 1
  ) {
    const segment = segments[segmentIndex]!;
    const subdivisions = fxLuminousSubdivisionCount(segment, passWidth);
    const fromWidthScale = fxLuminousInterpolatedScale(
      responses,
      segments,
      segmentIndex,
      "from ",
      "widthScale",
    );
    const toWidthScale = fxLuminousInterpolatedScale(
      responses,
      segments,
      segmentIndex,
      "to",
      "widthScale",
    );
    const fromOpacityScale = fxLuminousInterpolatedScale(
      responses,
      segments,
      segmentIndex,
      "from ",
      "opacityScale",
    );
    const toOpacityScale = fxLuminousInterpolatedScale(
      responses,
      segments,
      segmentIndex,
      "to",
      "opacityScale",
    );
    for (let subdivision = 0; subdivision < subdivisions; subdivision += 1) {
      if (sections.length >= FX_LUMINOUS_MAX_FLATTENED_SEGMENTS) {
        state.capped = true;
        return;
      }
      const fromProgress = subdivision / subdivisions;
      const toProgress = (subdivision + 1) / subdivisions;
      const from = fxLuminousPointAt(segment, fromProgress);
      const to = fxLuminousPointAt(segment, toProgress);
      if (fxLuminousSamePoint(from, to)) continue;
      const fromResponseWidth = fromWidthScale
        + (toWidthScale - fromWidthScale) * fromProgress;
      const toResponseWidth = fromWidthScale
        + (toWidthScale - fromWidthScale) * toProgress;
      const midpointProgress = (fromProgress + toProgress) / 2;
      const opacityScale = clamp(
        fromOpacityScale
        + (toOpacityScale - fromOpacityScale) * midpointProgress,
        0,
        4,
      );
      sections.push(Object.freeze({
        from,
        to,
        fromRadius: clamp(
          passWidth * fromResponseWidth / 2,
          0.25,
          2048,
        ),
        toRadius: clamp(
          passWidth * toResponseWidth / 2,
          0.25,
          2048,
        ),
        opacityScale,
      }));
      // Running accumulators for the length-weighted pass alpha. Terms are added in section order
      // here exactly as one batch loop over the finished array would add them, so a sum resumed
      // from a snapshot is the same float rather than a close one.
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      state.weightedOpacity += opacityScale * length;
      state.totalLength += length;
    }
  }
}

function fxLuminousPolygonSignedArea(points: readonly number[]): number {
  let area = 0;
  for (let index = 0; index + 1 < points.length; index += 2) {
    const nextIndex = (index + 2) % points.length;
    area += points[index]! * points[nextIndex + 1]!
      - points[nextIndex]! * points[index + 1]!;
  }
  return area / 2;
}

function sameWindingFxLuminousPolygon(
  points: readonly number[],
): readonly number[] {
  if (fxLuminousPolygonSignedArea(points) >= 0) {
    return Object.freeze([...points]);
  }
  const reversed: number[] = [];
  for (let index = points.length - 2; index >= 0; index -= 2) {
    reversed.push(points[index]!, points[index + 1]!);
  }
  return Object.freeze(reversed);
}

function fxLuminousBodyPolygon(
  section: FxLuminousSection,
): readonly number[] {
  const dx = section.to.x - section.from.x;
  const dy = section.to.y - section.from.y;
  const length = Math.hypot(dx, dy);
  const normalX = -dy / length;
  const normalY = dx / length;
  return sameWindingFxLuminousPolygon([
    quantizeFxLuminous(section.from.x + normalX * section.fromRadius),
    quantizeFxLuminous(section.from.y + normalY * section.fromRadius),
    quantizeFxLuminous(section.to.x + normalX * section.toRadius),
    quantizeFxLuminous(section.to.y + normalY * section.toRadius),
    quantizeFxLuminous(section.to.x - normalX * section.toRadius),
    quantizeFxLuminous(section.to.y - normalY * section.toRadius),
    quantizeFxLuminous(section.from.x - normalX * section.fromRadius),
    quantizeFxLuminous(section.from.y - normalY * section.fromRadius),
  ]);
}

function fxLuminousRoundPolygon(
  center: FxLuminousPoint,
  radius: number,
): readonly number[] {
  const points: number[] = [];
  for (let step = 0; step < FX_LUMINOUS_ROUND_STEPS; step += 1) {
    const angle = TAU * step / FX_LUMINOUS_ROUND_STEPS;
    points.push(
      quantizeFxLuminous(center.x + Math.cos(angle) * radius),
      quantizeFxLuminous(center.y + Math.sin(angle) * radius),
    );
  }
  return sameWindingFxLuminousPolygon(points);
}

function pushFxLuminousRunCaps(
  polygons: StudioFxLuminousRibbonPolygon[],
  first: FxLuminousSection,
  last: FxLuminousSection,
): void {
  polygons.push(
    Object.freeze({
      points: fxLuminousRoundPolygon(first.from, first.fromRadius),
      role: "start-cap" as const,
    }),
    Object.freeze({
      points: fxLuminousRoundPolygon(last.to, last.toRadius),
      role: "end-cap" as const,
    }),
  );
}

/**
 * Emits polygons for sections `[fromSectionIndex, …)` in section-local groups —
 * `body_0, body_1, join_1, body_2, join_2, …` and then the run's two caps.
 *
 * Grouping per section rather than per role (every body, then every join, then the caps) is what
 * makes the flat array append-only: only the open run's trailing caps ever move, so a frame
 * rewinds two polygons instead of re-emitting the whole stroke. Pixels do not shift — every
 * polygon is forced to one winding by `sameWindingFxLuminousPolygon` and the pass is filled once
 * with non-zero, so the winding sum at any point does not depend on the emission order.
 */
function appendFxLuminousRunPolygons(
  state: FxLuminousPlanState,
  fromSectionIndex: number,
): void {
  const { polygons, sections } = state;
  polygons.length = state.bodyJoinCount;
  for (let index = fromSectionIndex; index < sections.length; index += 1) {
    const section = sections[index]!;
    const previous = index > 0 ? sections[index - 1]! : null;
    if (previous && !fxLuminousSamePoint(previous.to, section.from)) {
      pushFxLuminousRunCaps(polygons, sections[state.openRunStart]!, previous);
      state.openRunStart = index;
    }
    polygons.push(Object.freeze({
      points: fxLuminousBodyPolygon(section),
      role: "body" as const,
    }));
    if (previous && index > state.openRunStart) {
      polygons.push(Object.freeze({
        points: fxLuminousRoundPolygon(
          previous.to,
          Math.max(previous.toRadius, section.fromRadius),
        ),
        role: "join" as const,
      }));
    }
    state.bodyJoinCount = polygons.length;
  }
  const last = sections.at(-1);
  if (last) pushFxLuminousRunCaps(polygons, sections[state.openRunStart]!, last);
}

function fxLuminousPlanWeightedOpacity(state: FxLuminousPlanState): number {
  return state.totalLength <= POINT_EPS
    ? 1
    : state.weightedOpacity / state.totalLength;
}

interface FxLuminousPassConfig {
  readonly baseWidth: number;
  readonly passWidthScale: number;
  readonly passOpacity: number;
  readonly luminousCore: boolean;
}

function resolveFxLuminousPassConfig(input: {
  readonly baseWidth: unknown;
  readonly passWidthScale: unknown;
  readonly passOpacity: unknown;
  readonly luminousCore?: boolean;
}): FxLuminousPassConfig {
  return {
    baseWidth: clamp(finiteNumber(input.baseWidth, 0), 0, 4096),
    passWidthScale: clamp(finiteNumber(input.passWidthScale, 1), 0.025, 16),
    passOpacity: clamp(finiteNumber(input.passOpacity, 0), 0, 1),
    luminousCore: input.luminousCore === true,
  };
}

function sealFxLuminousRibbonPassPlan(
  brushId: StudioFxLuminousBrushId,
  pressurePath: StudioFxPressurePathPlan,
  config: FxLuminousPassConfig,
  state: FxLuminousPlanState,
  polygons: readonly StudioFxLuminousRibbonPolygon[],
): StudioFxLuminousRibbonPassPlan {
  return {
    kind: "studio-fx-luminous-ribbon-pass",
    version: FX_LUMINOUS_RIBBON_VERSION,
    brushId,
    coverageOperation: "stroke-local-single-fill",
    compositeOperation: STUDIO_FX_LUMINOUS_COMPOSITE_OPERATION,
    fillRule: "nonzero",
    cap: "round",
    sourceSegmentCount: pressurePath.segments.length,
    flattenedSegmentCount: state.sections.length,
    capped: state.capped,
    passWidthScale: config.passWidthScale,
    luminousCore: config.luminousCore,
    opacity: clamp(
      config.passOpacity * fxLuminousPlanWeightedOpacity(state),
      0,
      1,
    ),
    polygons,
  };
}

/**
 * Plans one luminous pass as a stroke-local coverage mask.
 *
 * The returned polygons must be appended to one compound path and filled once. Bodies, joins and
 * round caps deliberately overlap inside that one fill; non-zero winding turns those overlaps,
 * exact retraces and figure-eight crossings into a union. The advertised premultiplied
 * source-over composite then builds coverage across separate DrawEls without additive whitening.
 *
 * This is the whole-stroke wrapper over the same two appends the incremental builder drives, run
 * once from index 0 — one code path, so the two cannot report different geometry.
 */
export function planStudioFxLuminousRibbonPass(input: {
  readonly brushId: StudioFxLuminousBrushId;
  readonly pressurePath: StudioFxPressurePathPlan;
  readonly baseWidth: unknown;
  readonly passWidthScale: unknown;
  readonly passOpacity: unknown;
  readonly luminousCore?: boolean;
}): StudioFxLuminousRibbonPassPlan {
  const config = resolveFxLuminousPassConfig(input);
  const state = createFxLuminousPlanState();
  if (config.baseWidth > 0) {
    appendFxLuminousSections(
      state,
      input.pressurePath,
      clamp(config.baseWidth * config.passWidthScale, 0.5, 4096),
      fxLuminousSegmentResponses(
        input.pressurePath,
        config.passWidthScale,
        config.luminousCore,
      ),
      0,
      input.pressurePath.segments.length,
    );
    appendFxLuminousRunPolygons(state, 0);
  }
  return Object.freeze(sealFxLuminousRibbonPassPlan(
    input.brushId,
    input.pressurePath,
    config,
    state,
    Object.freeze(state.polygons),
  ));
}

export interface StudioIncrementalFxLuminousRibbonBuilder {
  /**
   * 자라나는 획의 현재 압력 경로를 소비하고 이 패스의 전체 리본 플랜을 돌려준다. 플랜 모양은
   * 배치 플래너와 완전히 같으며(`polygons`는 빌더 내부 배열이므로 수정하면 안 된다), 재사용
   * 검증에 실패하면 전체를 다시 만든다. `producer`는 `pressurePath`를 만든 그 빌더여야 한다 —
   * 소비 워터마크와 세대가 전부 거기서 나온다.
   */
  append(input: {
    readonly brushId: StudioFxLuminousBrushId;
    readonly pressurePath: StudioFxPressurePathPlan;
    readonly producer: StudioIncrementalFxPressurePathBuilder;
    readonly baseWidth: unknown;
    readonly passWidthScale: unknown;
    readonly passOpacity: unknown;
    readonly luminousCore?: boolean;
  }): StudioFxLuminousRibbonPassPlan;
  /**
   * 마지막 `append()`가 돌려준 `polygons` 앞쪽에서 앞으로 어떤 append도 다시 쓰지 않는 prefix
   * 길이. 유지 경로(Path2D)는 이 길이까지만 재사용하고 나머지는 매 프레임 다시 그린다.
   */
  stablePolygonCount(): number;
  /** 전체 재구축(리셋)마다 증가한다 — 유지된 Path2D의 prefix 신뢰를 무효화하는 신호. */
  generation(): number;
}

/**
 * 라이브 드래프트용 증분 발광 리본 빌더.
 *
 * `planStudioFxLuminousRibbonPass`는 매 이동 전체 압력 경로를 다시 평탄화하고 폴리곤을 전부 다시
 * 만든다. 압력 경로 자체는 이미 증분이지만(`createStudioIncrementalFxPressurePathBuilder`) 그
 * 하류가 전부 전체 재구축이라, glow처럼 셸이 48개인 브러시는 이동당 48 x O(n) — 실측 n=3200에서
 * 이동당 1394 ms — 를 문다. 섹션 i는 세그먼트 i-1..i+1 만 읽고, 런 분할은 이웃 한 쌍만 비교하며,
 * 길이 가중 알파는 좌→우 누적이므로 세 단계 모두 append 전용으로 만들 수 있다.
 *
 * 재사용은 전부 O(1) 검증을 통과한 뒤에만 한다: 설정 동일성, 생산자 세대, 그리고 소비한 마지막
 * 세그먼트의 **객체 동일성**(`emitFxPressurePathSegment`는 호출마다 새 frozen 객체를 만들고
 * 생산자는 `segments.length = rebuildFrom; push(...)`로 꼬리를 다시 만들므로, 다시 방출된
 * 인덱스는 참조가 반드시 바뀐다 — 좌표 비교보다 정확하고 싸다). 소비 워터마크는 생산자의 안정
 * prefix보다 하나 앞에서 멈춘다(`fxLuminousInterpolatedScale`가 i+1을 읽는다).
 */
export function createStudioIncrementalFxLuminousRibbonBuilder(): StudioIncrementalFxLuminousRibbonBuilder {
  const state = createFxLuminousPlanState();
  const responses: FxLuminousSegmentResponse[] = [];
  let configBrushId: StudioFxLuminousBrushId | null = null;
  let configBaseWidth = Number.NaN;
  let configPassWidthScale = Number.NaN;
  let configPassOpacity = Number.NaN;
  let configLuminousCore = false;
  let producerGeneration = -1;
  let consumedSegmentCount = 0;
  let lastConsumedSegment: StudioFxPressurePathSegment | null = null;
  /** 세그먼트 i에서만 나오므로 생산자 워터마크가 그대로 상한이다. */
  let stableResponseCount = 0;
  let stableSections = 0;
  let stableOpenRunStart = 0;
  let stableBodyJoinCount = 0;
  let stableWeightedOpacity = 0;
  let stableTotalLength = 0;
  let poisoned = false;
  let rebuildGeneration = 0;

  const reset = (): void => {
    state.sections.length = 0;
    state.polygons.length = 0;
    state.openRunStart = 0;
    state.bodyJoinCount = 0;
    state.capped = false;
    state.weightedOpacity = 0;
    state.totalLength = 0;
    responses.length = 0;
    consumedSegmentCount = 0;
    lastConsumedSegment = null;
    stableResponseCount = 0;
    stableSections = 0;
    stableOpenRunStart = 0;
    stableBodyJoinCount = 0;
    stableWeightedOpacity = 0;
    stableTotalLength = 0;
    poisoned = false;
    rebuildGeneration += 1;
  };

  /** 지난 프레임의 휘발 꼬리를 걷어내고 워터마크 상태로 되돌린다. */
  const rewindToWatermark = (): void => {
    state.sections.length = stableSections;
    state.openRunStart = stableOpenRunStart;
    state.bodyJoinCount = stableBodyJoinCount;
    state.weightedOpacity = stableWeightedOpacity;
    state.totalLength = stableTotalLength;
  };

  return {
    append(input) {
      const config = resolveFxLuminousPassConfig(input);
      const segments = input.pressurePath.segments;
      const producerGenerationNow = input.producer.generation();
      const reusable = configBrushId === input.brushId
        && Object.is(configBaseWidth, config.baseWidth)
        && Object.is(configPassWidthScale, config.passWidthScale)
        && Object.is(configPassOpacity, config.passOpacity)
        && configLuminousCore === config.luminousCore
        && producerGeneration === producerGenerationNow
        && segments.length >= consumedSegmentCount
        && (consumedSegmentCount === 0
          || segments[consumedSegmentCount - 1] === lastConsumedSegment);
      if (!reusable) reset();
      configBrushId = input.brushId;
      configBaseWidth = config.baseWidth;
      configPassWidthScale = config.passWidthScale;
      configPassOpacity = config.passOpacity;
      configLuminousCore = config.luminousCore;
      producerGeneration = producerGenerationNow;
      // 폭 0 패스는 배치와 같은 빈 플랜이고, 캡 포화 획은 `appendFxLuminousSections`의 조기
      // 반환(`capped: true`) 의미를 한 글자도 바꾸지 않으려고 이 획 동안 빌더를 봉인한 뒤 배치
      // 플래너에 위임한다.
      if (poisoned || config.baseWidth <= 0) {
        return planStudioFxLuminousRibbonPass(input);
      }

      const passWidth = clamp(
        config.baseWidth * config.passWidthScale,
        0.5,
        4096,
      );
      const stableSegmentCount = Math.min(
        input.producer.stableSegmentCount(),
        segments.length,
      );
      const flattenLimit = Math.max(0, stableSegmentCount - 1);

      responses.length = Math.min(responses.length, stableResponseCount);
      for (let index = responses.length; index < segments.length; index += 1) {
        responses.push(resolveStudioFxPressurePassResponse(
          segments[index]!,
          config.passWidthScale,
          config.luminousCore,
        ));
      }
      stableResponseCount = stableSegmentCount;

      rewindToWatermark();
      if (flattenLimit > consumedSegmentCount) {
        appendFxLuminousSections(
          state,
          input.pressurePath,
          passWidth,
          responses,
          consumedSegmentCount,
          flattenLimit,
        );
        if (state.capped) {
          reset();
          poisoned = true;
          return planStudioFxLuminousRibbonPass(input);
        }
        appendFxLuminousRunPolygons(state, stableSections);
        stableSections = state.sections.length;
        stableOpenRunStart = state.openRunStart;
        stableBodyJoinCount = state.bodyJoinCount;
        stableWeightedOpacity = state.weightedOpacity;
        stableTotalLength = state.totalLength;
        consumedSegmentCount = flattenLimit;
        lastConsumedSegment = segments[flattenLimit - 1]!;
      }
      // 꼬리는 항상 소비 워터마크에서 시작한다. 생산자의 안정 prefix 가 (같은 세대 안에서)
      // 뒤로 물러나더라도 이미 stable 로 넘어간 섹션을 두 번 만들지 않는다.
      appendFxLuminousSections(
        state,
        input.pressurePath,
        passWidth,
        responses,
        consumedSegmentCount,
        segments.length,
      );
      if (state.capped) {
        reset();
        poisoned = true;
        return planStudioFxLuminousRibbonPass(input);
      }
      appendFxLuminousRunPolygons(state, stableSections);
      return sealFxLuminousRibbonPassPlan(
        input.brushId,
        input.pressurePath,
        config,
        state,
        state.polygons,
      );
    },
    stablePolygonCount() {
      return stableBodyJoinCount;
    },
    generation() {
      return rebuildGeneration;
    },
  };
}

/**
 * Appends a luminous pass to the caller's current path. Call `beginPath()` once before this helper
 * and `fill("nonzero")` once afterwards; calling fill per polygon would reintroduce seam energy.
 */
export function traceStudioFxLuminousRibbonPass(
  sink: StudioFxLuminousRibbonPathSink,
  plan: StudioFxLuminousRibbonPassPlan,
): void {
  traceStudioFxLuminousRibbonPassRange(sink, plan, 0, plan.polygons.length);
}

/**
 * Appends polygons `[fromPolygonIndex, toPolygonIndex)` of a luminous pass.
 *
 * The retained renderer keeps one `Path2D` for the plan's append-only prefix and traces only the
 * volatile tail each frame; it must still copy that prefix and issue ONE fill, because filling the
 * prefix and the tail separately composites their overlap twice (`a + a(1-a)` instead of `a`) —
 * exactly the seam the single-fill contract exists to prevent.
 */
export function traceStudioFxLuminousRibbonPassRange(
  sink: StudioFxLuminousRibbonPathSink,
  plan: StudioFxLuminousRibbonPassPlan,
  fromPolygonIndex: number,
  toPolygonIndex: number,
): void {
  const polygons = plan.polygons;
  const from = Math.max(0, Math.min(fromPolygonIndex, polygons.length));
  const to = Math.max(from, Math.min(toPolygonIndex, polygons.length));
  for (let index = from; index < to; index += 1) {
    const points = polygons[index]!.points;
    if (points.length < 6) continue;
    sink.moveTo(points[0]!, points[1]!);
    for (let offset = 2; offset + 1 < points.length; offset += 2) {
      sink.lineTo(points[offset]!, points[offset + 1]!);
    }
    sink.closePath();
  }
}

/**
 * Neon marker footprint: two coloured screen-blended halos plus a narrow luminous core.
 *
 * This is intentionally separate from the broader decorative glow brush.  The catalogue has
 * always previewed neon as a three-layer tube; sharing this deterministic plan with Canvas/SVG
 * prevents the selected brush from collapsing into an ordinary single line at playback/export.
 */
/**
 * How far the luminous core is pushed toward white.
 *
 * It used to be pushed all the way: the core pass painted literal #fff. On a dark canvas that is
 * right — a neon tube's centre blows out — but the default canvas here is WHITE, and on white
 * paper a white core is not a core, it is a hole. The brush rendered as a hollow grey tube whose
 * middle was the page, which is the one thing a luminous brush must never be.
 *
 * Nothing can be brighter than the paper, so on a light ground the honest reading of "hottest part
 * of the tube" is the most saturated part, not the whitest. Mixing most of the way to white keeps
 * the core clearly hotter than its halo on a dark ground while leaving it visible on a light one.
 */
const LUMINOUS_CORE_WHITE_MIX = 0.55;

/**
 * The colour a luminous lane's core pass paints, given the stroke colour.
 *
 * Shared by both surfaces on purpose: this used to be the literal string "#fff" written out at
 * four separate render sites, which is exactly the shape of drift the glow shells were moved into
 * the planner to avoid.
 */
export function studioLuminousCoreColor(stroke: unknown): string {
  const hex = typeof stroke === "string" ? stroke.trim() : "";
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/iu.exec(hex);
  if (!match) return "#ffffff";
  const digits = match[1]!;
  const full = digits.length === 3
    ? digits.split("").map((d) => d + d).join("")
    : digits;
  const channel = (index: number): number => {
    const value = Number.parseInt(full.slice(index * 2, index * 2 + 2), 16);
    const mixed = Math.round(value + (255 - value) * LUMINOUS_CORE_WHITE_MIX);
    return Math.max(0, Math.min(255, mixed));
  };
  return `#${[0, 1, 2].map((index) => channel(index).toString(16).padStart(2, "0")).join("")}`;
}

export function planNeonBrushPasses(baseWidth: number): FxNeonPass[] {
  const w = clamp(finiteNumber(baseWidth, 12), 0.5, 2048);
  const outer = w < 6 ? 3.1 : 2.7;
  return [
    { widthScale: outer, opacity: 0.14, tone: "color" },
    { widthScale: 1.65, opacity: 0.34, tone: "color" },
    { widthScale: 0.54, opacity: 0.96, tone: "white-core" },
  ];
}

/**
 * Shells the declared halo control rings are resampled into.
 *
 * The rings ARE the falloff: the renderer composites them back to front, so N flat rings give
 * exactly N flat tone plateaus separated by hard edges. At the declared 3 (glow) and 4 (soft-glow)
 * that measured 7 and 9 distinct tones across the whole halo with single steps up to 136 8-bit
 * levels — concentric bands, not a gradient. It is the same defect the pencil soft edge had, an
 * order of magnitude worse, because pencil had to smooth a 0.40 alpha band and glow has to smooth
 * a 0.99 one.
 *
 * Resampling here rather than in a renderer is deliberate: Canvas and SVG both consume this
 * planner, so they cannot drift into disagreeing about the halo.
 *
 * 48 is a chosen tradeoff, not the ideal. Each shell is one more full-stroke pass, so the ideal
 * (one 8-bit level per step, N ≈ 253) would draw a 500-point stroke 253 times and is not worth it
 * for a decorative lane. 48 puts the step at 255·A/48 ≈ 5 levels — a 27x improvement on the
 * measured 136 — and holds the pass count inside the same order of magnitude the emitters were
 * built for. If the halo still bands visibly against a flat backdrop, raise it here and pay for it
 * knowingly; do not reach for a different shape of fix.
 */
const GLOW_HALO_SHELLS = 48;

/**
 * Resamples declared halo control rings into evenly-spaced composited-alpha shells.
 *
 * The declared rings are read as (widthScale, cumulative composited alpha) control points, where
 * cumulative alpha after ring k is `1 - Π(1-o_i)`. Shell i targets an evenly spaced fraction of
 * the core's alpha, takes its width by linear interpolation of the control curve at that alpha,
 * and carries the exact incremental opacity that lands the composite on the target given what the
 * shells outside it already laid: `(target_i - target_{i-1}) / (1 - target_{i-1})`.
 *
 * Even spacing is in COMPOSITED alpha, which is what the eye reads as tone, so the steps are
 * uniform in 8-bit levels rather than geometric — the outermost shell is not left as the worst one.
 * Halo extent is unchanged because the outermost declared widthScale is kept as shell 0's width.
 */
function expandHaloShells(
  rings: readonly { widthScale: number; opacity: number }[],
): { widthScale: number; opacity: number }[] {
  const cumulative: { widthScale: number; alpha: number }[] = [];
  let carried = 0;
  for (const ring of rings) {
    carried = 1 - (1 - carried) * (1 - clamp(ring.opacity, 0, 1));
    cumulative.push({ widthScale: ring.widthScale, alpha: carried });
  }
  const core = cumulative.at(-1)?.alpha ?? 0;
  if (core <= 0 || cumulative.length < 2) return rings.map((ring) => ({ ...ring }));
  const widthAt = (alpha: number): number => {
    if (alpha <= cumulative[0]!.alpha) return cumulative[0]!.widthScale;
    for (let index = 1; index < cumulative.length; index += 1) {
      const previous = cumulative[index - 1]!;
      const current = cumulative[index]!;
      if (alpha > current.alpha) continue;
      const span = current.alpha - previous.alpha;
      const t = span > 1e-9 ? (alpha - previous.alpha) / span : 1;
      return previous.widthScale + (current.widthScale - previous.widthScale) * t;
    }
    return cumulative.at(-1)!.widthScale;
  };
  const shells: { widthScale: number; opacity: number }[] = [];
  let previousTarget = 0;
  for (let index = 0; index < GLOW_HALO_SHELLS; index += 1) {
    const target = core * (index + 1) / GLOW_HALO_SHELLS;
    const opacity = clamp((target - previousTarget) / (1 - previousTarget), 0, 1);
    previousTarget = target;
    if (opacity <= 0) continue;
    shells.push({ widthScale: widthAt(target), opacity });
  }
  return shells;
}

/**
 * Outer soft halo → bright core. Renderer draws passes back-to-front.
 * softGlow=true widens the halo (soft-glow preset).
 */
export function planGlowBrushPasses(baseWidth: number, softGlow = false): FxGlowPass[] {
  const w = clamp(finiteNumber(baseWidth, 12), 0.5, 2048);
  if (softGlow) {
    return expandHaloShells([
      { widthScale: 4.2, opacity: 0.12 },
      { widthScale: 2.8, opacity: 0.2 },
      { widthScale: 1.6, opacity: 0.38 },
      { widthScale: 0.85, opacity: 0.92 },
    ]);
  }
  // Keep scales relative so tiny pens still read as glow.
  const outer = w < 6 ? 3.4 : 3.0;
  return expandHaloShells([
    { widthScale: outer, opacity: 0.16 },
    { widthScale: outer * 0.62, opacity: 0.32 },
    { widthScale: 1.05, opacity: 0.95 },
  ]);
}

// ---------------------------------------------------------------------------
// Glitter / star-dust — scatter particles along stroke
// ---------------------------------------------------------------------------

export type FxGlitterParticle = {
  x: number;
  y: number;
  radius: number;
  opacity: number;
  /** 0 = circle spark, 1 = diamond-ish cross (renderer may draw rotated square). */
  kind: 0 | 1;
};

export type FxGlitterPlanInput = {
  points: readonly number[];
  pressures?: readonly number[] | null;
  baseWidth: number;
  seed: number;
  /** "glitter" denser; "star-dust" sparser larger sparks. */
  mode?: "glitter" | "star-dust" | "sparkle-star";
  maxParticles?: number;
};

export function planGlitterBrushParticles(input: FxGlitterPlanInput): FxGlitterParticle[] {
  const points = sanitizePoints(input.points, input.pressures);
  if (points.length === 0) return [];
  const baseWidth = clamp(finiteNumber(input.baseWidth, 18), 0.5, 2048);
  const seed = Math.floor(
    clamp(finiteNumber(input.seed, DEFAULT_FX_BRUSH_SEED), FX_BRUSH_SEED_RANGE.min, FX_BRUSH_SEED_RANGE.max)
  );
  const mode = input.mode === "star-dust" ? "star-dust" : input.mode === "sparkle-star" ? "sparkle-star" : "glitter";
  const maxParticles = Math.floor(
    clamp(finiteNumber(input.maxParticles, FX_BRUSH_PARTICLE_CAP), 4, FX_BRUSH_PARTICLE_CAP)
  );
  const spacing = mode === "star-dust" ? Math.max(2.2, baseWidth * 0.55) : mode === "sparkle-star" ? Math.max(1.8, baseWidth * 0.4) : Math.max(1.4, baseWidth * 0.28);
  const perStation = mode === "star-dust" ? 2 : mode === "sparkle-star" ? 3 : 4;
  const stations = sampleStations(
    points,
    spacing,
    Math.max(2, Math.floor(maxParticles / perStation))
  );
  const particles: FxGlitterParticle[] = [];
  const scatter = baseWidth * (mode === "star-dust" ? 0.85 : mode === "sparkle-star" ? 0.65 : 0.55);
  const perStationBudget = Math.max(1, Math.floor(maxParticles / stations.length));

  for (let si = 0; si < stations.length; si++) {
    const st = stations[si]!;
    const stationParticleStart = particles.length;
    const density = 0.55 + st.pressure * 0.55;
    const count = Math.min(
      perStationBudget,
      Math.max(1, Math.round(perStation * density))
    );
    for (let k = 0; k < count; k++) {
      if (particles.length >= maxParticles) return particles;
      const n1 = hash2(si, k * 3 + 1, seed);
      const n2 = hash2(si, k * 3 + 2, seed);
      const n3 = hash2(si, k * 3 + 3, seed);
      const n4 = hash2(si + 17, k + 9, seed);
      // Two more independent draws. Reusing n2 for both distance and opacity, and n3 for both
      // radius and shape, made those pairs perfectly rank-correlated: every far spark was a bright
      // spark (physically backwards - a spark thrown further has spent more of itself), and every
      // diamond was in the largest 38% of particles while every circle was in the smallest 62%, so
      // shape and size carried no independent information. A scatter field whose attributes are
      // locked together reads as a repeated motif rather than as scattered matter.
      const n5 = hash2(si + 53, k * 3 + 5, seed);
      const n6 = hash2(si + 89, k * 3 + 7, seed);
      // Skip some for organic sparsity
      if (n4 > density * 0.92) continue;
      const ang = n1 * TAU;
      const dist = scatter * Math.sqrt(n2);
      const rBase = mode === "star-dust"
        ? baseWidth * (0.08 + n3 * 0.22)
        : baseWidth * (0.04 + n3 * 0.14);
      particles.push({
        x: st.x + Math.cos(ang) * dist,
        y: st.y + Math.sin(ang) * dist,
        radius: Math.max(0.35, rBase),
        // Distance now DIMS a spark instead of brightening it, on its own draw for the spread.
        // The falloff scales only the variable part, never the 0.35 floor: a tap has to leave one
        // visible particle for every seed, and that guarantee is a contract, not a side effect.
        opacity: clamp(
          0.35 + n5 * 0.6 * (1 - Math.sqrt(n2) * FX_PARTICLE_DISTANCE_FALLOFF),
          0.2,
          1,
        ),
        kind: n6 > 0.62 ? 1 : 0,
      });
    }
    // Organic thinning must not erase a whole bounded station. In particular, when a long stroke
    // is LOD-fitted to the particle budget, losing its final station makes the visible stroke look
    // truncated again. Every station owns `perStationBudget` slots, so this deterministic fallback
    // cannot steal capacity reserved for later stations.
    if (particles.length === stationParticleStart && particles.length < maxParticles) {
      const n1 = hash2(si, 101, seed);
      const n2 = hash2(si, 103, seed);
      const n3 = hash2(si, 107, seed);
      const angle = n1 * TAU;
      const distance = scatter * Math.sqrt(n2);
      const radiusScale = mode === "star-dust"
        ? 0.08 + n3 * 0.22
        : 0.04 + n3 * 0.14;
      particles.push({
        x: st.x + Math.cos(angle) * distance,
        y: st.y + Math.sin(angle) * distance,
        radius: Math.max(0.35, baseWidth * radiusScale),
        opacity: clamp(0.55 + n2 * 0.35, 0.55, 0.9),
        kind: n3 > 0.62 ? 1 : 0,
      });
    }
  }

  return particles;
}

// ---------------------------------------------------------------------------
// Oil/acrylic — pressure/material stations for the continuous ribbon carrier
// ---------------------------------------------------------------------------

export type FxOilDab = {
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  angleRad: number;
  opacity: number;
  /**
   * Thin local-space ridge samples carried by the wet body. The ribbon adapter joins matching
   * samples into continuous bristle lanes so station boundaries never appear in the final mark.
   */
  bristles: readonly FxOilBristle[];
};

export type FxOilBristle = {
  /** Offset across the local minor axis, expressed as a fraction of radiusY. */
  offsetRatio: number;
  radiusXRatio: number;
  radiusYRatio: number;
  opacity: number;
};

/**
 * Which paint the bristle bed is carrying.
 *
 * Oil and acrylic share this planner, and until now they shared it completely: every declared
 * runtime field of `oil--flat-ribbon` and `acrylic--stiff-ribbon` was identical, so the two
 * differed only by defaultWidth/defaultOpacity and measured as the same texture. The split below
 * is the physical one - acrylic sets fast, so it runs dry sooner and keeps a crisper ridge, while
 * oil stays open and buttery for a longer stretch of travel.
 */
export type FxOilPaintBody = "oil" | "acrylic";

/**
 * The head doing the depositing.
 *
 * The lane catalogue has always declared this per row - `oil--flat-ribbon` says "hard",
 * `brush--oil-lanes` says "bristle" - and, like `engineVariant`, no renderer read it, so the two
 * planned byte-identical beds. A flat/hard head lays a more even film: its ridges are shallower and
 * its load varies less across the head, because there is no soft tuft to splay and starve
 * unevenly. A bristle head keeps the full variation.
 */
export type FxOilTipProfile = "bristle" | "hard";

/** See `FxOilPlanInput.capMode`. */
export type FxOilCapStationMode = "refit-v1" | "prefix-stable-ladder-v2";

export type FxOilPlanInput = {
  points: readonly number[];
  pressures?: readonly number[] | null;
  baseWidth: number;
  seed: number;
  maxDabs?: number;
  /** Defaults to "oil" so every existing caller keeps byte-identical plans. */
  paintBody?: FxOilPaintBody;
  /** Defaults to "bristle", the historical behaviour. */
  tipProfile?: FxOilTipProfile;
  /**
   * How the dab budget is honoured on a stroke long enough to overrun it. Defaults to `refit-v1`,
   * the historical whole-arc redistribution.
   *
   * `prefix-stable-ladder-v2` coarsens the spacing on a fixed ladder so a growing stroke stops
   * moving the stations it already placed — which is what lets the oil carrier reuse its bed
   * instead of rebuilding the pipeline on every pointer move. It changes the dabs a capped stroke
   * produces, so it is chosen by the caller: this planner also serves the airbrush family, whose
   * exports have no such pipeline to save and no reason to be redistributed.
   *
   * Every path that plans the SAME stroke has to pass the same value, or a stroke would be
   * previewed with one distribution and exported with another.
   */
  capMode?: FxOilCapStationMode;
  /**
   * Override station pitch as a fraction of head width. Fluid Paint walks the
   * tuft at 1/8 the default 0.068 pitch (8 capsules per bristle segment).
   */
  stationSpacingRatio?: number;
};

/**
 * Bristle load along travel.
 *
 * `tooth` gates the bimodal loaded/dry split below. Sampling it as `hash2(si, ...)` made it
 * INDEPENDENT at every station: one hair measured 0.641, 0.677, 0.025, 0.030, 0.032, 0.704, 0.022
 * ... with a lag-1 autocorrelation of -0.03, i.e. white noise. A real bristle depletes gradually,
 * so a hair that flips loaded->dry->loaded between adjacent stations rasterises as a row of
 * disconnected angular dashes rather than a continuous streak - the "각진 입자" the bed was
 * reported for. Round caps, curve-smoothed lane paths and finer load banding were all rendered and
 * all left it unchanged, because the artefact is in the load signal, not the rasteriser.
 *
 * Value noise over station index fixes the frequency without touching the amplitude: the knots are
 * the same `hash2` draws over the same seed, so the loaded fraction and its range are preserved and
 * texture is not reduced - only its wavelength grows to ~`STATIONS` stations, which is what keeps a
 * hair loaded (or dry) for a stretch of travel the way a real one is.
 */
/**
 * Station pitch as a fraction of head width. Shared, because every "per station" length in this
 * carrier is really a length in head widths and reading it any other way is how the load
 * wavelength came to be twenty-four cycles long on one stroke.
 */
const OIL_STATION_SPACING_RATIO = 0.068;
// Counted in stations rather than pixels so the wavelength scales with dab spacing - a wider brush
// lays coarser stations and gets a proportionally longer streak, and the value stays
// integer-deterministic for replay.
//
// It was 20, and the note that defended it claimed 20 stations was "roughly a brush-width of
// travel". It is not: stations sit at 0.068·width, so 20 of them span 1.36 widths and a hair
// therefore ran dry → loaded → dry roughly every 22px on a 16px brush. Measured on a 528px stroke
// that is twenty-four full load cycles, and the emitted furrows came out with a MEDIAN welded
// length of seven stations — eight pixels. Eight-pixel furrows on a five-hundred-pixel stroke are
// the dashes the oil bed was reported as; no amount of banding or welding downstream can join a
// hair the load signal itself has already chopped up.
//
// A loaded bristle does not deplete in one head-width. It holds its charge for many, and the
// depletion is what the artist reads as the stroke "running out" over its length. Seven widths is
// the shortest period that still leaves a long stroke visibly drying toward its end while making
// each furrow a continuous drag rather than a dash.
const BRISTLE_LOAD_WAVELENGTH_HEAD_WIDTHS = 7;
const BRISTLE_LOAD_WAVELENGTH_STATIONS = Math.round(
  BRISTLE_LOAD_WAVELENGTH_HEAD_WIDTHS / OIL_STATION_SPACING_RATIO,
);

/**
 * Acrylic sets while the stroke is still travelling, so its load cycles about twice as often as
 * oil's and its ridges stay sharper instead of levelling into the wet body. Oil keeps 1.
 */
const ACRYLIC_LOAD_WAVELENGTH_SCALE = 0.45;
const ACRYLIC_RIDGE_SCALE = 1.35;

/**
 * A hard head evens the bed out: ridges sit lower and the spread of load across the head narrows
 * toward its own mean. Deliberately a pull TOWARD the mean rather than a cut in amplitude, so the
 * bed stays textured instead of turning into a flat slab.
 */
const HARD_TIP_RIDGE_SCALE = 0.72;
const HARD_TIP_LOAD_EVENNESS = 0.55;

/**
 * How much of a hair's load is its own reservoir versus variation along travel.
 *
 * Hair identity has to dominate or the streaks break up; travel variation has to survive or the
 * bed goes back to constant parallel lanes. 0.62 keeps continuous streaks that still fade and
 * recover along their length.
 */
const BRISTLE_RESERVOIR_WEIGHT = 0.62;
/** >1 이면 마른 털 쪽으로 치우친다. 갈필이 남으려면 소수가 확실히 굶어야 한다. */
const BRISTLE_RESERVOIR_SKEW = 1.9;


/**
 * How far a hair drifts across the ribbon as it travels, in ribbon half-widths.
 *
 * The bed used to be seven evenly-spaced constants held for the whole stroke, so it rendered as
 * seven dead-straight parallel lanes at identical pitch - plywood grain, not a brush. Real hairs
 * neither sit on a lattice nor hold their line: they splay, clump and cross. Two corrections, both
 * deterministic in (bristleIndex, seed) so replay and export are unchanged:
 *
 *   PITCH  breaks the lattice - each hair takes a fixed offset of its own, so the spacing between
 *          neighbours is irregular and two hairs can sit close together as a clump.
 *   DRIFT  breaks the straightness - the offset wanders along travel on the same value-noise the
 *          load uses, so lanes converge and separate instead of running parallel.
 *
 * Both are small on purpose. The carrier multiplies offsetRatio by the station's radiusY, so the
 * total must stay inside 1 or the outer hairs leave the ribbon the body draws; the base offsets
 * top out at 0.88 and the two corrections are budgeted against the 0.12 that is left.
 */
/**
 * Softness of the contact band's edge, in ribbon half-widths. Wide enough that the outermost
 * touching hairs fade in rather than switching on, narrow enough that a light touch still has a
 * clearly bounded band of contact instead of a gradient across the whole head.
 */
const OIL_CONTACT_SHOULDER = 0.28;

const BRISTLE_PITCH_JITTER = 0.05;
const BRISTLE_DRIFT_AMPLITUDE = 0.1;

/**
 * Hairs in the bed, as a function of head width.
 *
 * It was seven, hardcoded, for every oil brush at every size — and seven is what made the mark
 * read as a flat slab with a few decals stuck on it rather than as paint. A 48px filbert laid down
 * seven furrows across a 20px-tall ribbon, so the space BETWEEN furrows was wider than the furrows
 * themselves and the continuous body showed through as untextured pigment everywhere else. Every
 * reference in this class (Rebelle's bristle head, Krita's bristle engine, david.li/paint) puts
 * dozens of tracks under a head that size; the furrow pitch, not the furrow itself, is what the
 * eye reads as "brush".
 *
 * Scaled by width rather than pinned, because pitch is what matters: a 6px liner with 30 hairs
 * would be sub-pixel mush and a 60px flat with 7 is the slab above. `HAIRS_PER_PX` puts the pitch
 * near two thirds of a document pixel at every size, which stays resolvable the moment the artist
 * zooms in — and antialiasing turns anything finer into honest tone rather than into a lie.
 *
 * The floor stays at the old seven so narrow strokes keep the exact bed they were tuned against.
 */
const BRISTLE_HAIRS_PER_PX = 0.78;
const BRISTLE_MIN_HAIRS = 7;
const BRISTLE_MAX_HAIRS = 44;

/**
 * The bed's lateral offsets, in ribbon half-widths.
 *
 * Deliberately NOT an even lattice. Evenly-spaced hairs are the plywood grain this file has been
 * fighting since the first version: the eye locks onto a constant pitch instantly. Each hair takes
 * an independent squash within its own slot, so neighbours clump and gap the way a real ferrule
 * splays, and the outermost pair is pushed to the ribbon edge so the silhouette has teeth.
 */
function bristleBedOffsets(baseWidth: number, seed: number): readonly number[] {
  const count = Math.max(
    BRISTLE_MIN_HAIRS,
    Math.min(BRISTLE_MAX_HAIRS, Math.round(baseWidth * BRISTLE_HAIRS_PER_PX)),
  );
  const offsets: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const slot = count === 1 ? 0.5 : index / (count - 1);
    // ±0.42 of a slot, so a hair never crosses its neighbour's centre and the bed stays ordered —
    // an unordered bed would break the width gauges' assumption that a hair keeps one thickness.
    const jitter = (hash2(index, 1_181, seed) - 0.5) * 0.84 / Math.max(1, count - 1);
    offsets.push(clamp((slot + jitter) * 2 - 1, -1, 1) * 0.9);
  }
  return offsets;
}
/**
 * Longer than the load's wavelength: a hair should wander over the stroke, not vibrate.
 *
 * Same scale error as the load wavelength had — 34 stations is 2.3 head widths, so a hair crossed
 * the ribbon and came back roughly every two brush-widths, which reads as a shimmer rather than as
 * splay. A hair that has splayed stays splayed for the length of the drag.
 */
const BRISTLE_DRIFT_WAVELENGTH_HEAD_WIDTHS = 11;
const BRISTLE_DRIFT_WAVELENGTH_STATIONS = Math.round(
  BRISTLE_DRIFT_WAVELENGTH_HEAD_WIDTHS / OIL_STATION_SPACING_RATIO,
);


/**
 * Acrylic lanes carry the fast-setting body; everything else on this carrier is oil. Kept as one
 * shared predicate so the Canvas and SVG renderers cannot drift into disagreeing about which paint
 * a stroke is made of.
 */
export function studioOilPaintBodyForBrush(brush: string): FxOilPaintBody {
  return brush.startsWith("acrylic") ? "acrylic" : "oil";
}

/** Hard heads (flat, stiff) deposit a more even film than a soft tuft; declared per lane row. */
export function studioOilTipProfileForBrush(brush: string): FxOilTipProfile {
  return brush === "oil--flat-ribbon" || brush === "acrylic--stiff-ribbon"
    ? "hard"
    : "bristle";
}

/**
 * Smoothstep centred on `edge`, ramping across `margin` either side.
 *
 * Centred deliberately, after trying the strictly-additive form that only ramps UP to the edge.
 * Additive preserves the old loaded peak exactly, which sounds safer and measures better on a
 * naive "load range" statistic - but it barely moves the thing that actually matters: rendered
 * tone stayed at 71.3% of ink in two bins versus 73.1% before. Centred reaches 54.6%.
 *
 * The difference is the top end. A bristle ridge pinned near full opacity is exactly what makes
 * the stroke read as two flat tones, so letting the strongest loads come down IS the texture fix,
 * not a concession. The load still reaches dry and still reaches loaded over a stroke - the
 * paint-body guard asserts all three populations survive rather than any single spread statistic,
 * because both variance and range fall when a bimodal gap is filled and neither can tell that
 * apart from genuine flattening.
 */
function smoothGate(value: number, edge: number, margin: number): number {
  const t = clamp((value - (edge - margin)) / (2 * margin), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * The scalar inputs a dab's value depends on, resolved once so the full planner and the
 * incremental planner cannot drift into resolving them differently.
 */
interface OilDabSettings {
  readonly baseWidth: number;
  readonly seed: number;
  readonly maxDabs: number;
  readonly paintBody: FxOilPaintBody;
  readonly tipProfile: FxOilTipProfile;
  readonly spacing: number;
  readonly capMode: FxOilCapStationMode;
}

function resolveOilDabSettings(input: FxOilPlanInput): OilDabSettings {
  const baseWidth = clamp(finiteNumber(input.baseWidth, 22), 0.5, 2048);
  const seed = Math.floor(
    clamp(finiteNumber(input.seed, DEFAULT_FX_BRUSH_SEED), FX_BRUSH_SEED_RANGE.min, FX_BRUSH_SEED_RANGE.max)
  );
  const maxDabs = Math.floor(clamp(
    finiteNumber(input.maxDabs, FX_OIL_DAB_CAP),
    2,
    FX_OIL_DAB_CAP,
  ));
  // Dense wet carrier so stations read as one continuous load of paint without becoming a stamp
  // lattice. Long strokes remain bounded by sampleStations' whole-path redistribution.
  const paintBody: FxOilPaintBody = input.paintBody === "acrylic" ? "acrylic" : "oil";
  const tipProfile: FxOilTipProfile = input.tipProfile === "hard" ? "hard" : "bristle";
  const capMode: FxOilCapStationMode = input.capMode === "prefix-stable-ladder-v2"
    ? "prefix-stable-ladder-v2"
    : "refit-v1";
  const spacingRatio = Number.isFinite(input.stationSpacingRatio)
    && (input.stationSpacingRatio ?? 0) > 0
    ? Math.min(0.2, Math.max(0.004, input.stationSpacingRatio!))
    : OIL_STATION_SPACING_RATIO;
  const spacing = Math.max(0.5, baseWidth * spacingRatio);
  return { baseWidth, seed, maxDabs, paintBody, tipProfile, spacing, capMode };
}

/**
 * Appends dabs for `stations[from..]` onto `dabs`.
 *
 * Split out of `planOilBrushDabs` verbatim so `FxOilDabPlanner` can re-enter the SAME loop at a
 * verified-unchanged prefix. Dabs are pushed 1:1 with `si` and never skipped, so on entry with a
 * prefix of length `from` the invariant `dabs.length === si` holds exactly as it did from zero and
 * the `dabs.length >= maxDabs` break fires on the same station.
 *
 * A dab is a pure function of `si`, `stations[si-1 … si+1]`, `stations.length === 1`, and the
 * settings — no accumulator crosses iterations. That is what makes prefix reuse bit-identical
 * rather than merely close.
 */
function appendOilBrushDabs(
  dabs: FxOilDab[],
  stations: readonly StrokePoint[],
  from: number,
  settings: OilDabSettings,
  bristleOffsets: readonly number[],
): void {
  const { baseWidth, seed, maxDabs, paintBody, tipProfile } = settings;
  const bristleCount = bristleOffsets.length;
  const tap = stations.length === 1;

  // Per-bed constants: functions of the hair index and the seed alone.
  //
  // These used to be recomputed inside the hair loop, i.e. once per (station, hair). At the
  // 4096-dab cap that is ~90k evaluations of ~22 distinct values, two of them through `Math.pow`,
  // and the cap is exactly where the bed is rebuilt from scratch on every pointer move. Same
  // expressions, same inputs, so the numbers are bit-for-bit what the inline versions produced.
  const pitchByHair = new Float64Array(bristleCount);
  const gaugeByHair = new Float64Array(bristleCount);
  const reservoirByHair = new Float64Array(bristleCount);
  const loadKeyByHair = new Float64Array(bristleCount);
  const driftKeyByHair = new Float64Array(bristleCount);
  for (let bristleIndex = 0; bristleIndex < bristleCount; bristleIndex += 1) {
    // PITCH breaks the lattice: each hair takes a fixed offset of its own, so neighbour spacing is
    // irregular and two hairs can sit close together as a clump.
    pitchByHair[bristleIndex] =
      (hash2(bristleIndex, 613, seed) - 0.5) * 2 * BRISTLE_PITCH_JITTER;
    // Skewed so most hairs are fine and a few are the fat ones a real ferrule always has — a bed
    // of identical-diameter hairs is the same lattice tell as identical spacing. Hashed on the
    // hair alone, so a hair keeps one diameter for the whole stroke and its runs stay weldable.
    gaugeByHair[bristleIndex] = hash2(bristleIndex, 733, seed) ** 1.4;
    const loadKey = 31 + bristleIndex * 7;
    loadKeyByHair[bristleIndex] = loadKey;
    // Each hair carries its OWN reservoir, held for the whole stroke; the travel noise below only
    // modulates it. Without this term every hair swept the entire dry..loaded range within one
    // wavelength, so a single hair crossed many load bands over 20 stations and got chopped into
    // short segments scattered across different paint passes — at 4x the bed read as dashes on a
    // slab rather than hairs dragged through paint. Real bristles differ from EACH OTHER in how
    // much they hold; one hair does not go from dry to full and back over its own length.
    // 균등분포를 그대로 쓰면 털들이 중간으로 몰려 갈필(마른 털이 남기는 빈 결)이 사라진다.
    // 제곱으로 눌러 소수의 털을 확실히 마르게 만든다 — 실제 붓에서도 굶은 털은 소수다.
    reservoirByHair[bristleIndex] = hash2(-1, loadKey, seed) ** BRISTLE_RESERVOIR_SKEW;
    driftKeyByHair[bristleIndex] = 907 + bristleIndex * 13;
  }

  // Load and drift are piecewise-smoothstep between knot hashes, and a knot spans a whole
  // wavelength of stations (103 for oil, 162 for drift). Hashing both ends once per (station,
  // hair) meant ~360k `hash2` calls at the cap for ~2.9k distinct values; the knot index is
  // non-decreasing along the walk, so the two ends only have to be refilled when it moves.
  const loadWavelength = BRISTLE_LOAD_WAVELENGTH_STATIONS
    * (paintBody === "acrylic" ? ACRYLIC_LOAD_WAVELENGTH_SCALE : 1);
  const loadStartByHair = new Float64Array(bristleCount);
  const loadEndByHair = new Float64Array(bristleCount);
  const driftStartByHair = new Float64Array(bristleCount);
  const driftEndByHair = new Float64Array(bristleCount);
  let cachedLoadKnot = Number.NaN;
  let cachedDriftKnot = Number.NaN;

  const acrylicRidgeScale = paintBody === "acrylic" ? ACRYLIC_RIDGE_SCALE : 1;
  const hardTipRidgeScale = tipProfile === "hard" ? HARD_TIP_RIDGE_SCALE : 1;

  for (let si = from; si < stations.length; si++) {
    if (dabs.length >= maxDabs) break;
    const st = stations[si]!;
    const n1 = hash2(si, 5, seed);
    const n2 = hash2(si, 11, seed);
    const n3 = hash2(si, 19, seed);
    // Use a centred tangent where possible. The previous one-sided heading amplified pointer
    // polygon corners and made the wet edge wobble even when the source curve was smooth.
    let ang = n1 * TAU;
    const tangentStart = stations[Math.max(0, si - 1)]!;
    const tangentEnd = stations[Math.min(stations.length - 1, si + 1)]!;
    const tangentX = tangentEnd.x - tangentStart.x;
    const tangentY = tangentEnd.y - tangentStart.y;
    if (Math.hypot(tangentX, tangentY) > POINT_EPS) {
      ang = Math.atan2(tangentY, tangentX) + (n1 - 0.5) * 0.07;
    }
    // Pressure owns a clear, monotonic hand-feel: light contact is a narrow wet skid, heavy
    // contact fans the head and loads pigment. A soft curve (0.82) keeps early stylus response
    // lively without snapping to the full filbert width.
    const pressureFeel = Math.pow(clamp(st.pressure, 0, 1), 0.82);

    // Knot walk for this station: the eased fraction is per-station, not per-hair.
    const loadT = si / loadWavelength;
    const loadKnot = Math.floor(loadT);
    const loadFraction = loadT - loadKnot;
    // Smoothstep so the load has no corner at a knot; a linear ramp still reads as a crease.
    const loadEased = loadFraction * loadFraction * (3 - 2 * loadFraction);
    if (loadKnot !== cachedLoadKnot) {
      for (let bristleIndex = 0; bristleIndex < bristleCount; bristleIndex += 1) {
        const key = loadKeyByHair[bristleIndex]!;
        loadStartByHair[bristleIndex] = hash2(loadKnot, key, seed);
        loadEndByHair[bristleIndex] = hash2(loadKnot + 1, key, seed);
      }
      cachedLoadKnot = loadKnot;
    }
    const driftT = si / BRISTLE_DRIFT_WAVELENGTH_STATIONS;
    const driftKnot = Math.floor(driftT);
    const driftFraction = driftT - driftKnot;
    const driftEased = driftFraction * driftFraction * (3 - 2 * driftFraction);
    if (driftKnot !== cachedDriftKnot) {
      for (let bristleIndex = 0; bristleIndex < bristleCount; bristleIndex += 1) {
        const key = driftKeyByHair[bristleIndex]!;
        driftStartByHair[bristleIndex] = hash2(driftKnot, key, seed);
        driftEndByHair[bristleIndex] = hash2(driftKnot + 1, key, seed);
      }
      cachedDriftKnot = driftKnot;
    }
    // Per-station terms the hair loop used to recompute for every hair.
    const contactWidth = clamp(0.18 + pressureFeel * 0.95, 0.18, 1);
    const dryPressureTerm = 0.35 + pressureFeel * 0.65;
    const offsetPressureScale = 0.9 + pressureFeel * 0.14;
    const size = baseWidth
      * (0.48 + pressureFeel * 0.72)
      * (0.93 + n2 * 0.14);
    const rx = Math.max(0.4, size * (0.54 + pressureFeel * 0.08));
    // Heavier pressure flattens the minor axis slightly so the bristle bed fans across the stroke.
    const ry = Math.max(
      0.25,
      size * (0.34 + pressureFeel * 0.1 + n3 * 0.05),
    );
    const normalJitter = (n2 - 0.5) * baseWidth * (0.018 + pressureFeel * 0.014);
    const bristles: FxOilBristle[] = new Array(bristleCount);
    for (let bristleIndex = 0; bristleIndex < bristleCount; bristleIndex += 1) {
      const offsetRatio = bristleOffsets[bristleIndex]!;
      // `bristleLoadAlongTravel`, inlined so the knot hashes and the hair's own reservoir can be
      // lifted out of the walk. The arithmetic is written in the same order it had inside that
      // function, so every value is bit-identical to the call it replaces.
      const loadStart = loadStartByHair[bristleIndex]!;
      const travel = loadStart + (loadEndByHair[bristleIndex]! - loadStart) * loadEased;
      const rawTooth = reservoirByHair[bristleIndex]! * BRISTLE_RESERVOIR_WEIGHT
        + travel * (1 - BRISTLE_RESERVOIR_WEIGHT);
      // A hard head pulls each hair's load toward the head's mean instead of clipping its range.
      const tooth = tipProfile === "hard"
        ? 0.5 + (rawTooth - 0.5) * HARD_TIP_LOAD_EVENNESS
        : rawTooth;
      // Pressure decides HOW MUCH OF THE FERRULE touches the paper, not how hard every hair
      // presses. That distinction is the whole behaviour.
      //
      // The old form multiplied one contact term by pressure, so a light touch scaled EVERY
      // hair down together, every hair fell under the dry-liftoff cut at once, and the mark came
      // out as a smooth film with no bristle in it. Measured across the ribbon at constant
      // pressure, the cross-section standard deviation was 0.14-0.19 at working pressure and
      // collapsed to 0.046-0.053 at a light touch — the stroke lost its hairs exactly where a
      // real brush shows them most. A light skim rides on the middle of the head and leaves a
      // few separated strands; it does not leave a wash.
      //
      // So contact is a WIDTH: hairs inside the contact band touch fully and deposit according
      // to their own load, hairs outside it do not touch at all, and pressure moves the band's
      // edge. The shoulder keeps the boundary from being a hard cut, and `tooth` still lets a
      // hair's own charge modulate what it lays down once it is in contact.
      const edge = Math.abs(offsetRatio);
      const contact = clamp(
        (contactWidth - edge) / OIL_CONTACT_SHOULDER + tooth * 0.12,
        0,
        1,
      );
      // Load is a CONTINUUM, not a switch.
      //
      // The boolean gate left a hole in the middle of the tone range - a hair was either
      // ~0.55-0.75 (loaded) or ~0.015-0.045 (dry) and never between - and a real bristle passes
      // through partly-loaded on its way to dry. That pass is most of what makes paint read as
      // paint. Measured as the share of inked pixels in the two most-occupied tone bins (lower is
      // richer), the gate and the overlap fold only work TOGETHER:
      //   bimodal + 14 overlaps 73.1%   ·   continuum + 14 overlaps 71.1%
      //   bimodal +  6 overlaps 77.4%   ·   continuum +  6 overlaps 54.6%
      // Neither change alone helps; the continuum is what gives the lower fold something to
      // spread. Note this LOWERS the load's variance (0.292 -> 0.153) while leaving its RANGE
      // untouched (0.015-0.75) - filling a bimodal gap always does - which is why the paint-body
      // guard asserts range and correlation rather than variance.
      const contactGate = smoothGate(contact, 0.42, 0.18);
      const toothGate = smoothGate(tooth, 0.38, 0.22);
      const loadGate = contactGate * toothGate;
      const pitch = pitchByHair[bristleIndex]!;
      // `bristleDriftAlongTravel`, inlined on the same terms as the load above.
      const driftStart = driftStartByHair[bristleIndex]!;
      const drift =
        ((driftStart + (driftEndByHair[bristleIndex]! - driftStart) * driftEased) * 2 - 1)
        * BRISTLE_DRIFT_AMPLITUDE;
      // Skewed so most hairs are fine and a few are the fat ones a real ferrule always has —
      // a bed of identical-diameter hairs is the same lattice tell as identical spacing.
      const hairGauge = gaugeByHair[bristleIndex]!;
      // The dry floor appears twice in the opacity fold; it is one value, not two.
      const dryFloor = 0.015 + tooth * 0.045 * dryPressureTerm;
      bristles[bristleIndex] = {
        offsetRatio: (offsetRatio + pitch + drift) * offsetPressureScale,
        radiusXRatio: 0.62 + tooth * 0.28 + pressureFeel * 0.08,
        // Ridges must remain a material fraction of radiusY after the ribbon carrier's
        // 0.17 + ratio*1.1 width map — keep them resolvable without repainting the body.
        //
        // A hair's DIAMETER is its own and does not change as it travels; only its footprint
        // does, when pressure flattens it. The per-station `tooth` used to drive this, so every
        // hair swelled and thinned along its own length and no hair could be tracked across the
        // stroke — which also meant a hair's runs scattered across width gauges and could not be
        // welded back into one furrow. The gauge is now hashed on the hair alone; `contact` is
        // the only term left that varies with travel, and that one is physical.
        radiusYRatio: (0.032 + hairGauge * 0.062 + contact * 0.03)
          * acrylicRidgeScale
          * hardTipRidgeScale,
        // Bimodal load with pressure-gated contact: skimming hairs stay near-dry film while
        // loaded ridges carry a clear pigment step. Self-crossings stay honest because mid-alpha
        // stacking (worst a·(1−a)) is avoided on the dominant band.
        opacity: dryFloor
          + loadGate * (
            (0.34 + contact * 0.42 + Math.max(0, tooth - 0.38) * 0.28)
            - dryFloor
          ),
      };
    }
    dabs.push({
      x: st.x - Math.sin(ang) * normalJitter,
      y: st.y + Math.cos(ang) * normalJitter,
      radiusX: rx,
      radiusY: ry,
      angleRad: ang,
      opacity: tap
        ? clamp(0.58 + pressureFeel * 0.36, 0.52, 0.96)
        : clamp(0.16 + pressureFeel * 0.38 + n2 * 0.045, 0.14, 0.62),
      bristles,
    });
  }
}

export function planOilBrushDabs(input: FxOilPlanInput): FxOilDab[] {
  const points = sanitizePoints(input.points, input.pressures);
  if (points.length === 0) return [];
  const settings = resolveOilDabSettings(input);
  const stations = sampleStations(points, settings.spacing, settings.maxDabs, settings.capMode);
  const bristleOffsets = bristleBedOffsets(settings.baseWidth, settings.seed);
  const dabs: FxOilDab[] = [];
  appendOilBrushDabs(dabs, stations, 0, settings, bristleOffsets);
  return dabs;
}

/**
 * Growing-stroke planner for the oil/acrylic lanes: same output as `planOilBrushDabs`, without
 * rebuilding the whole bed on every pointer move.
 *
 * A live oil stroke replans from scratch every frame, and each station carries 7–44 freshly
 * allocated bristle records, so the per-move cost climbs with the stroke — 0.6 ms at 100 dabs,
 * 12.7 ms at the 4096-dab cap, i.e. quadratic over one drag.
 *
 * The cure is prefix reuse, but it is deliberately NOT built on an ASSUMPTION that the station
 * lattice is prefix-stable. It is not always: `sampleStations` refits across the entire arc once
 * `naturalStationCount` exceeds the budget, which moves every station, and `sanitizePoints`
 * resamples pressure at `i / (pairCount - 1)`, so a growing pressure array can perturb earlier
 * samples too. Instead this planner RE-DERIVES the stations every call (that walk is cheap — a few
 * flops per source point) and then verifies, by exact `Object.is` comparison of x/y/pressure, how
 * long a prefix is genuinely byte-for-byte unchanged. Only that verified prefix is reused.
 *
 * Reuse stops one dab short of the verified prefix because dab `k` reads `stations[k+1]`: with a
 * verified prefix of `m` stations, dabs `0 … m-2` had every input they read inside it. The `tap`
 * flag (`stations.length === 1`) is a whole-array input, so a change in single-station-ness voids
 * the cache outright.
 *
 * Consequence: at the cap crossing, where the refit moves every station, the verifier finds a
 * zero-length prefix and the planner degenerates to a full replan plus one cheap comparison pass.
 * Correct in every regime, by construction, with no special case to get wrong.
 */
export class FxOilDabPlanner {
  private settingsKey: string | null = null;
  private stations: readonly StrokePoint[] = [];
  private dabs: readonly FxOilDab[] = [];
  private lastReusedDabs = 0;

  /** Dabs reused from the previous call. Diagnostics and identity tests only. */
  get reusedDabs(): number {
    return this.lastReusedDabs;
  }

  plan(input: FxOilPlanInput): FxOilDab[] {
    const points = sanitizePoints(input.points, input.pressures);
    if (points.length === 0) {
      this.reset();
      return [];
    }
    const settings = resolveOilDabSettings(input);
    const key = `${settings.baseWidth}|${settings.seed}|${settings.maxDabs}`
      + `|${settings.paintBody}|${settings.tipProfile}|${settings.spacing}`
      + `|${settings.capMode}`;
    if (key !== this.settingsKey) {
      this.settingsKey = key;
      this.stations = [];
      this.dabs = [];
    }
    const stations = sampleStations(points, settings.spacing, settings.maxDabs, settings.capMode);
    if (settings.capMode === "refit-v1" && stations.length >= settings.maxDabs) {
      // Under `refit-v1` a saturated budget means `sampleStations` is refitting the lattice across
      // the whole arc and every station moves on every append: no prefix can survive. Drop the
      // retained bed rather than keep 4096 stations x 7-44 bristles alive next to the one being
      // built — holding both generations measured +4.5 ms per move in GC alone. Bailing out here
      // can only ever cause a full replan, never a wrong reuse.
      //
      // The ladder is excluded because for it a saturated count means the opposite. It reaches the
      // budget on the last spacing interval BEFORE a rung climb, where the stations are as stable
      // as anywhere else, and a stroke can sit in that interval for many appends — so bailing out
      // there rebuilds all 4096 dabs per pointer move at exactly the length this change exists to
      // make cheap. The prefix verifier below already handles the rung climb: it finds nothing
      // byte-equal and rebuilds, which is the same outcome by the same evidence.
      this.stations = [];
      this.dabs = [];
      this.lastReusedDabs = 0;
      const full: FxOilDab[] = [];
      appendOilBrushDabs(
        full,
        stations,
        0,
        settings,
        bristleBedOffsets(settings.baseWidth, settings.seed),
      );
      return full;
    }
    const cached = this.stations;
    // `tap` is read from the whole array, so single-station-ness must match before any reuse.
    let verified = (stations.length === 1) === (cached.length === 1)
      ? Math.min(stations.length, cached.length)
      : 0;
    for (let index = 0; index < verified; index += 1) {
      const next = stations[index]!;
      const previous = cached[index]!;
      if (
        !Object.is(next.x, previous.x)
        || !Object.is(next.y, previous.y)
        || !Object.is(next.pressure, previous.pressure)
      ) {
        verified = index;
        break;
      }
    }
    const reuse = Math.max(0, Math.min(verified - 1, this.dabs.length));
    const dabs: FxOilDab[] = this.dabs.slice(0, reuse);
    appendOilBrushDabs(
      dabs,
      stations,
      reuse,
      settings,
      bristleBedOffsets(settings.baseWidth, settings.seed),
    );
    this.stations = stations;
    // Snapshot, not the returned array: a caller that mutates its own result must not be able to
    // corrupt the prefix this planner will later reuse.
    this.dabs = dabs.slice();
    this.lastReusedDabs = reuse;
    return dabs;
  }

  reset(): void {
    this.settingsKey = null;
    this.stations = [];
    this.dabs = [];
    this.lastReusedDabs = 0;
  }
}

/**
 * Planners retained for the ONE draft currently being drawn — a single slot, not an LRU over
 * strokes. See `planStudioOilRibbonCarrierIncremental` for why an LRU is the wrong shape here:
 * sized below the draft's symmetry fan it never hits, and sized above it a finished stroke's beds
 * outlive the stroke. Starting a different draft drops the previous one outright.
 */
interface RetainedOilDabDraft {
  readonly draftId: string;
  readonly planners: Map<number, FxOilDabPlanner>;
}

let retainedOilDabDraft: RetainedOilDabDraft | null = null;

/**
 * Stroke-keyed `FxOilDabPlanner`, for renderers that cannot hold one themselves.
 *
 * Same dabs as `planOilBrushDabs` — the planner verifies its retained prefix byte-for-byte and
 * re-derives everything it cannot vouch for — so this is a drop-in for the ACTIVE DRAFT only.
 * Committed and export renders keep calling the batch planner: they walk arbitrary strokes in
 * arbitrary order and would evict each other's beds for nothing.
 *
 * A symmetry transform draws one element several times from different point arrays, so the copy's
 * `variationIndex` selects its own planner; a fan wider than the retained bound falls back to the
 * batch planner rather than retaining beds without bound.
 */
export function planOilBrushDabsIncremental(
  draftId: string,
  variationIndex: number,
  input: FxOilPlanInput,
): FxOilDab[] {
  if (retainedOilDabDraft?.draftId !== draftId) {
    retainedOilDabDraft = { draftId, planners: new Map() };
  }
  const planners = retainedOilDabDraft.planners;
  let planner = planners.get(variationIndex);
  if (!planner) {
    if (planners.size >= STUDIO_BRUSH_RETAINED_DRAFT_SYMMETRY_VARIATIONS) {
      return planOilBrushDabs(input);
    }
    planner = new FxOilDabPlanner();
    planners.set(variationIndex, planner);
  }
  return planner.plan(input);
}

/** Frees `draftId`'s retained beds. A no-op once a different draft has already replaced them. */
export function releaseOilBrushDabDraftPlanners(draftId: string): void {
  if (retainedOilDabDraft?.draftId === draftId) retainedOilDabDraft = null;
}

// ---------------------------------------------------------------------------
// Pastel — direction-aligned soft pigment fibres (dry chalky build-up)
// ---------------------------------------------------------------------------

export type FxPastelDab = {
  x: number;
  y: number;
  /** Tangent-aligned half-length. Always materially larger than radiusY. */
  radiusX: number;
  /** Cross-stroke half-thickness. */
  radiusY: number;
  angleRad: number;
  opacity: number;
};

export type FxPastelPlanInput = {
  points: readonly number[];
  pressures?: readonly number[] | null;
  baseWidth: number;
  seed: number;
  maxDabs?: number;
};

export function planPastelBrushDabs(input: FxPastelPlanInput): FxPastelDab[] {
  const points = sanitizePoints(input.points, input.pressures);
  if (points.length === 0) return [];
  const baseWidth = clamp(finiteNumber(input.baseWidth, 20), 0.5, 2048);
  const seed = Math.floor(
    clamp(finiteNumber(input.seed, DEFAULT_FX_BRUSH_SEED), FX_BRUSH_SEED_RANGE.min, FX_BRUSH_SEED_RANGE.max)
  );
  const maxDabs = Math.floor(clamp(
    finiteNumber(input.maxDabs, FX_PASTEL_DAB_CAP),
    2,
    FX_PASTEL_DAB_CAP,
  ));
  // The carrier's longitudinal support is much wider than this step. Even if a very long stroke
  // reaches the bounded station count and is fitted across the full arc, adjacent fibres continue
  // to overlap instead of turning into isolated circular beads.
  const spacing = Math.max(0.55, baseWidth * 0.12);
  const stations = sampleStations(points, spacing, maxDabs);
  const dabs: FxPastelDab[] = [];

  for (let si = 0; si < stations.length; si++) {
    if (dabs.length >= maxDabs) break;
    const st = stations[si]!;
    const before = stations[Math.max(0, si - 1)]!;
    const after = stations[Math.min(stations.length - 1, si + 1)]!;
    const tangentX = after.x - before.x;
    const tangentY = after.y - before.y;
    const tangentLength = Math.hypot(tangentX, tangentY);
    const tangent = tangentLength > POINT_EPS
      ? Math.atan2(tangentY, tangentX)
      : 0;
    const normalX = -Math.sin(tangent);
    const normalY = Math.cos(tangent);
    const lengthNoise = hash2(si, 3, seed);
    const thicknessNoise = hash2(si, 5, seed);
    const offsetNoise = hash2(si, 7, seed);
    const angleNoise = hash2(si, 11, seed);
    const pressureScale = 0.72 + st.pressure * 0.48;
    const radiusX = Math.max(
      0.75,
      baseWidth * pressureScale * (0.46 + lengthNoise * 0.1),
    );
    const radiusY = Math.max(
      0.18,
      Math.min(
        radiusX / 3.2,
        baseWidth * pressureScale * (0.09 + thicknessNoise * 0.035),
      ),
    );
    const normalOffset = (offsetNoise - 0.5) * baseWidth * 0.07;
    dabs.push({
      x: st.x + normalX * normalOffset,
      y: st.y + normalY * normalOffset,
      radiusX,
      radiusY,
      angleRad: tangent + (angleNoise - 0.5) * 0.14,
      opacity: clamp(
        0.1 + st.pressure * 0.2 + thicknessNoise * 0.06,
        0.08,
        0.38,
      ),
    });
  }
  // A tap has no path tangent. Two crossed, individually anisotropic fibres make a compact chalk
  // touch without falling back to the circular carrier that long strokes deliberately avoid.
  if (stations.length === 1 && dabs.length === 1 && maxDabs >= 2) {
    const first = dabs[0]!;
    dabs.push({
      ...first,
      radiusX: first.radiusX * 0.78,
      radiusY: first.radiusY * 0.86,
      angleRad: first.angleRad + Math.PI / 2,
      opacity: first.opacity * 0.72,
    });
  }
  return dabs;
}
