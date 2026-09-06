/**
 * Per-lane bristle load dynamics for the oil ribbon carrier (손맛 상향).
 *
 * The ribbon carrier's bristle lanes carry per-station tooth but no *history*:
 * a lane deposits the same film at station 400 as at station 4. This helper
 * evolves three coupled hand-feel states along the stroke —
 *
 *   (a) film drive   — pressure-driven deposit strength with dli/paint's
 *                      bristle momentum: David Li's PBD brush damps bristle
 *                      velocity by ×0.75 per step (brush.js BRUSH_DAMPING,
 *                      MIT), reproduced here as an EMA that retains 0.75 of
 *                      the previous drive, so loading/unloading lags the
 *                      stylus the way a sprung tuft does;
 *   (b) footprint    — pressure flattens the tuft into a wider contact patch
 *                      (dli's plane constraint analog), widening lane ridges;
 *   (c) reservoirs   — each lane carries finite ink; travel drains it faster
 *                      at speed, and seeded per-lane capacity variation makes
 *                      lanes starve at different arc lengths (갈필 streaks).
 *
 * Numeric anchors come from the verified libmypaint-derived
 * STUDIO_OSS_OIL_FILM_RECIPE (ISC): `opaque` 0.74 caps the film ceiling,
 * `opaqueLinearize` 0.9 is the pressure exponent, `directionFilter` 0.4 the
 * speed EMA weight, and `dabsPerActualRadius` 8.5 normalizes drain per
 * station. Randomness is exclusively studioOssUnitHash — deterministic per
 * seed, no clock, no Math.random.
 *
 * Pure planning module: it returns typed-array fields the carrier multiplies
 * into its per-run band computation behind the program flag; it never touches
 * geometry itself.
 */

import {
  STUDIO_OSS_OIL_FILM_RECIPE,
  studioOssUnitHash,
} from "../studio-oss-brush-kernels";

export const STUDIO_OIL_BRISTLE_LOAD_DYNAMICS_V1_VERSION =
  "studio-oil-bristle-load-dynamics-v1" as const;

export const STUDIO_OIL_BRISTLE_LOAD_DYNAMICS_PROVENANCE = Object.freeze({
  damping:
    "dli/paint brush.js BRUSH_DAMPING 0.75 (MIT) — per-step momentum retention",
  recipe:
    "libmypaint-derived STUDIO_OSS_OIL_FILM_RECIPE (ISC) — opaque/opaqueLinearize/directionFilter/dabsPerActualRadius",
  behaviour:
    "pressure→flattened footprint + deposit, speed→streaky depletion; reimplemented state model, no upstream code",
} as const);

/** dli/paint brush.js: `velocity *= 0.75` per simulation step. */
export const STUDIO_OIL_BRISTLE_DAMPING = 0.75 as const;

/** Pressure that maps to film strength 1.0 — keeps mid-pressure strokes stable. */
const REFERENCE_PRESSURE = 0.6;
/** Film drive ceiling; ridge bands cap here (recipe.opaque headroom ≈ ×2). */
const MAX_FILM_DRIVE = 1.48;
/** Lane ink fade knee, as a fraction of capacity (bristle-model inkFadeFraction). */
const INK_FADE_FRACTION = 0.35;
/** Per-lane capacity spread (rough tuft DNA; studio-brush-platform uses 0.3–0.55). */
const CAPACITY_VARIATION = 0.35;
/** Footprint widening at full flattening drive. */
const FOOTPRINT_FLATTEN_GAIN = 0.42;
/**
 * Stations per drained ink unit at neutral factors. The carrier stations sit
 * at ~0.068 widths (≈ 14.7 per radius vs libmypaint's 8.5 dabs), so the
 * normalizer is `dabsPerActualRadius × 64` ≈ 544: a full dip at reference
 * pressure and rest speed lasts ≈ 1.3k stations (≈ 90 radii of travel) and the
 * `depletionRate` dial plus stroke speed shorten it into dry-brush range.
 */
const DRAIN_STATION_NORMALIZER = STUDIO_OSS_OIL_FILM_RECIPE.dabsPerActualRadius * 64;

export interface StudioOilBristleLoadDynamicsInput {
  /** Station count of the planned stroke (carrier stations, in travel order). */
  readonly stationCount: number;
  /** Bristle lane count across the head (the carrier's shared bristle count). */
  readonly laneCount: number;
  /** Deterministic seed — reuse the stroke's brush seed. */
  readonly seed: number;
  /**
   * Normalized 0..1 pressure per station. Shorter arrays hold their last
   * value; missing arrays fall back to `fallbackPressure`.
   */
  readonly pressures?: readonly number[];
  /** Normalized 0..1 speed per station (1 = flat-out flick). Missing → 0. */
  readonly speeds?: readonly number[];
  /** Used when `pressures` is absent/empty. Default REFERENCE_PRESSURE. */
  readonly fallbackPressure?: number;
  /** Ink dip at stroke start, 0..1. Default 1 (fully loaded). */
  readonly initialLoad?: number;
  /** Depletion dial; 0 disables draining entirely. Default 1. */
  readonly depletionRate?: number;
}

export interface StudioOilBristleLoadDynamicsPlan {
  readonly version: typeof STUDIO_OIL_BRISTLE_LOAD_DYNAMICS_V1_VERSION;
  readonly stationCount: number;
  readonly laneCount: number;
  /**
   * Row-major `[station * laneCount + lane]` film strength multipliers in
   * [0, MAX_FILM_DRIVE]; 1.0 ≈ reference-pressure wet lane.
   */
  readonly laneFilmStrength: Float64Array;
  /** Per-station footprint widening multiplier, ≥ 1. */
  readonly footprintScale: Float64Array;
  /** Final per-lane reservoir 0..capacity (diagnostics + gate assertions). */
  readonly laneReservoir: Float64Array;
  /** Per-lane starting capacity (seeded variation around 1). */
  readonly laneCapacity: Float64Array;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite01(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(value, 0, 1)
    : fallback;
}

function sampleSeries(
  series: readonly number[] | undefined,
  index: number,
  fallback: number,
): number {
  if (!series || series.length === 0) return fallback;
  const raw = series[Math.min(index, series.length - 1)];
  return finite01(raw, fallback);
}

/**
 * Seeded per-lane capacity and its initial dip. A function of the seed and the dial alone, so a
 * live stroke carries it across frames instead of re-hashing it every pointer move.
 */
function seedLaneCapacity(
  laneCapacity: Float64Array,
  laneReservoir: Float64Array,
  laneCount: number,
  seed: number,
  initialLoad: number,
): void {
  for (let lane = 0; lane < laneCount; lane += 1) {
    const variation =
      (studioOssUnitHash(seed, lane, 0x0111_ca9) - 0.5) * 2 * CAPACITY_VARIATION;
    laneCapacity[lane] = Math.max(0.05, 1 + variation);
    laneReservoir[lane] = laneCapacity[lane]! * initialLoad;
  }
}

/**
 * Everything the march carries across a station boundary.
 *
 * The three drives and the reservoirs ARE the simulation: station k reads them, writes its own
 * output row, and hands them to station k+1. Nothing else crosses, and no step ever reads a
 * station ahead of itself — which is exactly why a live stroke can stop on a settled station,
 * keep this object, and resume from it. See `StudioOilBristleLoadDynamicsPlanner`.
 */
export interface LoadDynamicsMarchState {
  /** Stations already marched; the next step writes this row. */
  station: number;
  filmDrive: number;
  flattenDrive: number;
  speedEma: number;
  /** Live reservoirs, mutated in place as the march advances. */
  laneReservoir: Float64Array;
}

interface LoadDynamicsMarchInputs {
  readonly laneCount: number;
  readonly depletionRate: number;
  readonly fallbackPressure: number;
  readonly pressures?: readonly number[];
  readonly speeds?: readonly number[];
  readonly laneCapacity: Float64Array;
  readonly laneFilmStrength: Float64Array;
  readonly footprintScale: Float64Array;
}

/**
 * Advance the march to `until`, writing one output row per station.
 *
 * The one and only implementation of the model: the batch planner runs it once from station 0,
 * the incremental planner runs it over two disjoint ranges. Two callers, one loop, so a resumed
 * stroke cannot drift away from the batch answer.
 */
function marchLoadDynamics(
  state: LoadDynamicsMarchState,
  inputs: LoadDynamicsMarchInputs,
  until: number,
): void {
  const {
    laneCount, depletionRate, fallbackPressure,
    laneCapacity, laneFilmStrength, footprintScale,
  } = inputs;
  const laneReservoir = state.laneReservoir;
  const centre = (laneCount - 1) / 2;
  const pressureExponent = STUDIO_OSS_OIL_FILM_RECIPE.opaqueLinearize;
  const speedEmaWeight = STUDIO_OSS_OIL_FILM_RECIPE.directionFilter;
  let filmDrive = state.filmDrive;
  let flattenDrive = state.flattenDrive;
  let speedEma = state.speedEma;

  for (let station = state.station; station < until; station += 1) {
    const pressure = sampleSeries(inputs.pressures, station, fallbackPressure);
    const speed = sampleSeries(inputs.speeds, station, 0);
    speedEma += (speed - speedEma) * speedEmaWeight;

    // (a) film drive chases the pressure response with 0.75 momentum retention.
    const driveTarget = clamp(
      (pressure / REFERENCE_PRESSURE) ** pressureExponent,
      0,
      MAX_FILM_DRIVE,
    );
    filmDrive =
      filmDrive * STUDIO_OIL_BRISTLE_DAMPING
      + driveTarget * (1 - STUDIO_OIL_BRISTLE_DAMPING);

    // (b) flattened footprint lags the same way — the tuft opens under load
    // and stays open a beat after the stylus lets go (hysteresis 손맛).
    flattenDrive =
      flattenDrive * STUDIO_OIL_BRISTLE_DAMPING
      + (pressure ** pressureExponent) * (1 - STUDIO_OIL_BRISTLE_DAMPING);
    footprintScale[station] = 1 + FOOTPRINT_FLATTEN_GAIN * flattenDrive;

    // (c) travel drains each touching lane; speed drains harder and pressure
    // presses more hairs into contact — dli's fast dry-brush streak recipe.
    const stationDrain =
      depletionRate
      * (1 / DRAIN_STATION_NORMALIZER)
      * (0.35 + 0.65 * pressure)
      * (0.55 + 0.9 * speedEma);
    const rowOffset = station * laneCount;
    for (let lane = 0; lane < laneCount; lane += 1) {
      const edge = centre > 0 ? Math.abs(lane - centre) / centre : 0;
      // Outer lanes only touch once the tuft flattens onto them.
      const contact = clamp(
        flattenDrive * (1.08 - edge * 0.55) + 0.12 - edge * 0.2,
        0,
        1,
      );
      const capacity = laneCapacity[lane]!;
      const reservoirBefore = laneReservoir[lane]!;
      const drained = Math.min(reservoirBefore, stationDrain * contact);
      laneReservoir[lane] = reservoirBefore - drained;
      // Soft fade knee: a starving lane thins before it cuts out.
      const fade = clamp(
        reservoirBefore / (capacity * INK_FADE_FRACTION),
        0,
        1,
      ) ** 0.85;
      laneFilmStrength[rowOffset + lane] = filmDrive * fade;
    }
  }

  state.station = Math.max(state.station, until);
  state.filmDrive = filmDrive;
  state.flattenDrive = flattenDrive;
  state.speedEma = speedEma;
}

/**
 * Plan the dynamics for one stroke. Pure and deterministic: identical input
 * produces identical typed arrays.
 */
export function planStudioOilBristleLoadDynamics(
  input: StudioOilBristleLoadDynamicsInput,
): StudioOilBristleLoadDynamicsPlan {
  const stationCount = Number.isInteger(input.stationCount) && input.stationCount > 0
    ? input.stationCount
    : 0;
  const laneCount = Number.isInteger(input.laneCount) && input.laneCount > 0
    ? input.laneCount
    : 0;
  const seed = Number.isFinite(input.seed) ? Math.floor(input.seed) : 0;
  const fallbackPressure = finite01(input.fallbackPressure, REFERENCE_PRESSURE);
  const initialLoad = finite01(input.initialLoad, 1);
  const depletionRate =
    typeof input.depletionRate === "number" && Number.isFinite(input.depletionRate)
      ? clamp(input.depletionRate, 0, 64)
      : 1;

  const laneFilmStrength = new Float64Array(stationCount * laneCount);
  const footprintScale = new Float64Array(stationCount);
  const laneCapacity = new Float64Array(laneCount);
  const laneReservoir = new Float64Array(laneCount);
  if (stationCount === 0 || laneCount === 0) {
    return Object.freeze({
      version: STUDIO_OIL_BRISTLE_LOAD_DYNAMICS_V1_VERSION,
      stationCount,
      laneCount,
      laneFilmStrength,
      footprintScale,
      laneReservoir,
      laneCapacity,
    });
  }

  seedLaneCapacity(laneCapacity, laneReservoir, laneCount, seed, initialLoad);

  const state: LoadDynamicsMarchState = {
    station: 0,
    filmDrive: 0,
    flattenDrive: 0,
    speedEma: 0,
    laneReservoir,
  };
  marchLoadDynamics(state, {
    laneCount,
    depletionRate,
    fallbackPressure,
    ...(input.pressures ? { pressures: input.pressures } : {}),
    ...(input.speeds ? { speeds: input.speeds } : {}),
    laneCapacity,
    laneFilmStrength,
    footprintScale,
  }, stationCount);

  return Object.freeze({
    version: STUDIO_OIL_BRISTLE_LOAD_DYNAMICS_V1_VERSION,
    stationCount,
    laneCount,
    laneFilmStrength,
    footprintScale,
    laneReservoir,
    laneCapacity,
  });
}

/**
 * Growing-stroke load dynamics: the plan `planStudioOilBristleLoadDynamics` returns, without
 * re-marching the stations an append cannot have changed.
 *
 * The march is strictly causal — station k reads `pressures[k]`, `speeds[k]` and the state left by
 * station k-1, and never looks ahead. So for a stroke whose first `settled` stations are known
 * byte-identical to the previous call, the first `settled` output rows are byte-identical too, and
 * the only honest work is the tail. `StudioOilRibbonCarrierPlanner` already computes that settled
 * station prefix for its own geometry, and hands it in here.
 *
 * The caller must have proven the prefix; this class only trusts it. Everything it cannot line up
 * with the retained state (a different lane count, seed or dial, a shrinking stroke, a series whose
 * length no longer matches the station count) falls back to a full march, so a wrong reuse is not
 * expressible.
 *
 * NOTE on `sampleSeries`: it clamps a short series to its last element, which would make an
 * already-marched station read a value that moves as the stroke grows. Reuse is therefore gated on
 * the series being exactly station-length (what the carrier always passes) or absent.
 */
export class StudioOilBristleLoadDynamicsPlanner {
  private key: string | null = null;
  /** Stations whose state is retained in `state` — the resume point. */
  private marched = 0;
  private state: LoadDynamicsMarchState | null = null;
  private laneCapacity = new Float64Array(0);
  /** Output rows [0, marched), kept so a resumed frame copies instead of recomputing. */
  private film = new Float64Array(0);
  private footprint = new Float64Array(0);

  reset(): void {
    this.key = null;
    this.marched = 0;
    this.state = null;
    this.laneCapacity = new Float64Array(0);
    this.film = new Float64Array(0);
    this.footprint = new Float64Array(0);
  }

  /**
   * `settled` is how many LEADING stations the caller has proven byte-identical to the previous
   * call. Passing 0 is always correct and simply re-marches everything.
   */
  plan(
    input: StudioOilBristleLoadDynamicsInput,
    settled: number,
  ): StudioOilBristleLoadDynamicsPlan {
    const stationCount = Number.isInteger(input.stationCount) && input.stationCount > 0
      ? input.stationCount
      : 0;
    const laneCount = Number.isInteger(input.laneCount) && input.laneCount > 0
      ? input.laneCount
      : 0;
    const seed = Number.isFinite(input.seed) ? Math.floor(input.seed) : 0;
    const fallbackPressure = finite01(input.fallbackPressure, REFERENCE_PRESSURE);
    const initialLoad = finite01(input.initialLoad, 1);
    const depletionRate =
      typeof input.depletionRate === "number" && Number.isFinite(input.depletionRate)
        ? clamp(input.depletionRate, 0, 64)
        : 1;

    if (stationCount === 0 || laneCount === 0) {
      this.reset();
      return planStudioOilBristleLoadDynamics(input);
    }

    // A series shorter than the stroke is held at its last value, so an already-marched station
    // would read a number that moves as the stroke grows. Only exact-length (or absent) series
    // keep the prefix stable.
    const seriesAligned = (series: readonly number[] | undefined): boolean =>
      series === undefined || series.length === 0 || series.length === stationCount;
    // The retained state is the state after EXACTLY `marched` stations, so that is the only point
    // the march can resume from: resuming earlier would pair one station's index with a later
    // station's drives. A stroke that shrank below the boundary, or whose caller cannot vouch for
    // the whole retained prefix, re-marches from zero.
    const reusable =
      seriesAligned(input.pressures)
      && seriesAligned(input.speeds)
      && this.marched > 0
      && this.marched <= stationCount
      && settled >= this.marched
        ? this.marched
        : 0;

    const key = `${laneCount}|${seed}|${fallbackPressure}|${initialLoad}|${depletionRate}`
      + `|${input.pressures === undefined}|${input.speeds === undefined}`;
    const resume = reusable > 0 && this.key === key && this.state !== null;

    const laneFilmStrength = new Float64Array(stationCount * laneCount);
    const footprintScale = new Float64Array(stationCount);
    const laneCapacity = new Float64Array(laneCount);
    const laneReservoir = new Float64Array(laneCount);

    let state: LoadDynamicsMarchState;
    if (resume) {
      laneCapacity.set(this.laneCapacity);
      laneReservoir.set(this.state!.laneReservoir);
      laneFilmStrength.set(this.film.subarray(0, reusable * laneCount));
      footprintScale.set(this.footprint.subarray(0, reusable));
      state = {
        station: reusable,
        filmDrive: this.state!.filmDrive,
        flattenDrive: this.state!.flattenDrive,
        speedEma: this.state!.speedEma,
        laneReservoir,
      };
    } else {
      seedLaneCapacity(laneCapacity, laneReservoir, laneCount, seed, initialLoad);
      state = {
        station: 0, filmDrive: 0, flattenDrive: 0, speedEma: 0, laneReservoir,
      };
    }

    const marchInputs = {
      laneCount,
      depletionRate,
      fallbackPressure,
      ...(input.pressures ? { pressures: input.pressures } : {}),
      ...(input.speeds ? { speeds: input.speeds } : {}),
      laneCapacity,
      laneFilmStrength,
      footprintScale,
    };

    // Advance the RETAINED march to this frame's settled boundary first, snapshotting the state
    // there, then run the unsettled tail on a throwaway copy. Only the settled part is promoted,
    // so the next frame always resumes from a boundary it has proven.
    const boundary = Math.max(0, Math.min(settled, stationCount));
    marchLoadDynamics(state, marchInputs, boundary);
    this.key = key;
    this.marched = state.station;
    this.laneCapacity = laneCapacity;
    this.film = laneFilmStrength;
    this.footprint = footprintScale;
    this.state = {
      station: state.station,
      filmDrive: state.filmDrive,
      flattenDrive: state.flattenDrive,
      speedEma: state.speedEma,
      laneReservoir: laneReservoir.slice(),
    };

    marchLoadDynamics(state, marchInputs, stationCount);

    return Object.freeze({
      version: STUDIO_OIL_BRISTLE_LOAD_DYNAMICS_V1_VERSION,
      stationCount,
      laneCount,
      laneFilmStrength,
      footprintScale,
      laneReservoir,
      laneCapacity,
    });
  }
}
