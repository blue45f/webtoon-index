/**
 * Raster wet-into-wet compositor for the shipped 유화 path.
 *
 * Oil ribbon geometry already depletes film along travel (`planStudioOilBristleLoadDynamics`).
 * This module is the david.li Fluid Paint half of that feel on pixels: a stroke over existing
 * wet paint picks up the canvas colour, deposits a spectral mix, and later dabs carry less
 * fresh paint than the head of the same stroke.
 *
 * Pure and deterministic — no DOM, no clock, no Math.random. Tests and the retouch worker
 * call the same `wetMixStroke` body.
 */

import { STUDIO_OSS_OIL_FILM_RECIPE } from "../studio-oss-brush-kernels";

import { planStudioOilBristleLoadDynamics } from "./studio-oil-bristle-load-dynamics-v1";
import {
  wetMixStroke,
  type WetMixColor,
  type WetMixPixelPoint,
  type WetMixSettings,
} from "./studio-wet-mix";

export const STUDIO_OIL_WET_INTO_WET_VERSION = "studio-oil-wet-into-wet-v1" as const;

/** Per-dab load drain when the caller does not pass an explicit depletion. */
export const STUDIO_OIL_WET_INTO_WET_DEFAULT_LOAD_DEPLETION = 0.08 as const;

export type StudioOilWetIntoWetSettings = WetMixSettings;

/**
 * One oil stroke on an existing painted canvas. Pickup/mix come from `wetMixStroke`;
 * load drop and spectral WGM mix are the oil defaults (libmypaint `paintMode` 0.88).
 */
export function applyStudioOilWetIntoWetStroke(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  points: readonly WetMixPixelPoint[],
  settings: StudioOilWetIntoWetSettings,
): Uint8ClampedArray {
  return wetMixStroke(data, w, h, points, {
    ...settings,
    loadDepletion: settings.loadDepletion ?? STUDIO_OIL_WET_INTO_WET_DEFAULT_LOAD_DEPLETION,
    initialLoad: settings.initialLoad ?? 1,
    mixModel: settings.mixModel ?? "spectral-wgm",
  });
}

/**
 * Film-strength series the ribbon already uses, exposed so oil tests can assert the
 * same stroke's tail is weaker than its head without re-deriving the drain math.
 */
export function planStudioOilWetIntoWetLoadSeries(input: Readonly<{
  stationCount: number;
  seed?: number;
  pressures?: readonly number[];
  speeds?: readonly number[];
  initialLoad?: number;
  depletionRate?: number;
}>): Float64Array {
  const plan = planStudioOilBristleLoadDynamics({
    stationCount: input.stationCount,
    laneCount: 1,
    seed: input.seed ?? 0,
    ...(input.pressures ? { pressures: input.pressures } : {}),
    ...(input.speeds ? { speeds: input.speeds } : {}),
    initialLoad: input.initialLoad ?? 1,
    depletionRate: input.depletionRate ?? 1,
  });
  const strengths = new Float64Array(plan.stationCount);
  for (let station = 0; station < plan.stationCount; station += 1) {
    strengths[station] = plan.laneFilmStrength[station] ?? 0;
  }
  return strengths;
}

export const STUDIO_OIL_WET_INTO_WET_PAINT_MODE = STUDIO_OSS_OIL_FILM_RECIPE.paintMode;

export type { WetMixColor, WetMixPixelPoint };
