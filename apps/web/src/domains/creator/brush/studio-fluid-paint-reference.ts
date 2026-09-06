/**
 * David Li Fluid Paint (david.li/paint, MIT) — numeric contract for Studio.
 *
 * Source: github.com/dli/paint `brush.js`, `shaders/splat.frag`, `shaders/painting.frag`,
 * `paint.js`. We do not ship the WebGL app; these numbers drive the oil/wet-mix path so a
 * Fluid Paint stroke has the same *feel* (bristle density, velocity clamp, RYB mix, GGX relief).
 */

import {
  studioOilPaintBodyForBrush,
  studioOilTipProfileForBrush,
  type FxOilCapStationMode,
  type FxOilPaintBody,
  type FxOilTipProfile,
} from "../studio-fx-brush";

export const STUDIO_FLUID_PAINT_REFERENCE_VERSION =
  "studio-fluid-paint-reference-v1" as const;

export const STUDIO_FLUID_PAINT_PROVENANCE = Object.freeze({
  license: "MIT (dli/paint LICENSE, © 2017 David Li)",
  source: "http://david.li/paint — github.com/dli/paint",
  brush: "brush.js VERTICES_PER_BRISTLE 10 / SPLATS_PER_SEGMENT 8 / BRISTLE_LENGTH 4.5 / BRISTLE_JITTER 0.5 / ITERATIONS 20 / GRAVITY 30 / BRUSH_DAMPING 0.75 / STIFFNESS_VARIATION 0.3 / N_PREVIOUS_SPEEDS 15",
  splat: "shaders/splat.frag distance-to-line capsule, MAX_SPEED 2.0",
  display:
    "shaders/painting.frag Sobel height→normal + GGX/GGGX/Schlick, RYB cube (Gossett & Chen)",
});

/** brush.js */
export const STUDIO_FLUID_PAINT_BRUSH = Object.freeze({
  previousSpeeds: 15,
  splatsPerSegment: 8,
  verticesPerBristle: 10,
  bristleLength: 4.5,
  bristleJitter: 0.5,
  constraintIterations: 20,
  gravity: 30,
  damping: 0.75,
  stiffnessVariation: 0.3,
});

/** shaders/splat.frag */
export const STUDIO_FLUID_PAINT_SPLAT = Object.freeze({
  maxSpeed: 2,
});

/** paint.js lighting defaults, same as studio-impasto-relief-shading-v1. */
export const STUDIO_FLUID_PAINT_DISPLAY = Object.freeze({
  normalScale: 7,
  roughness: 0.075,
  f0: 0.05,
  specularScale: 0.5,
  diffuseScale: 0.15,
});

export type StudioFluidPaintRgb = readonly [number, number, number];

/**
 * Gossett & Chen RYB cube used by painting.frag `rybToRgb`.
 * Vertices: white, red, blue, yellow, orange, green, purple, black.
 */
export const STUDIO_FLUID_PAINT_RYB_CUBE = Object.freeze({
  v000: [1, 1, 1],
  v100: [1, 0, 0],
  v010: [0.163, 0.373, 0.6],
  v001: [1, 1, 0],
  v101: [1, 0.5, 0],
  v011: [0, 0.66, 0.2],
  v110: [0.5, 0, 0.5],
  v111: [0.2, 0.094, 0],
} as const);

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value >= 1 ? 1 : value;
}

function trilinear(
  p: readonly [number, number, number],
  cube: typeof STUDIO_FLUID_PAINT_RYB_CUBE,
): [number, number, number] {
  const x = clamp01(p[0]);
  const y = clamp01(p[1]);
  const z = clamp01(p[2]);
  const ix = 1 - x;
  const iy = 1 - y;
  const iz = 1 - z;
  const mix = (channel: 0 | 1 | 2): number =>
    cube.v000[channel] * ix * iy * iz
    + cube.v100[channel] * x * iy * iz
    + cube.v010[channel] * ix * y * iz
    + cube.v001[channel] * ix * iy * z
    + cube.v101[channel] * x * iy * z
    + cube.v011[channel] * ix * y * z
    + cube.v110[channel] * x * y * iz
    + cube.v111[channel] * x * y * z;
  return [mix(0), mix(1), mix(2)];
}

/** Inverse of the RGB display path: store paint as RYB so subtractive mixes stay chromatic. */
export function studioFluidPaintRgbToRyb(
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  return [clamp01(1 - g), clamp01(1 - r), clamp01(1 - b)];
}

export function studioFluidPaintRybToRgb(
  r: number,
  y: number,
  b: number,
): [number, number, number] {
  return trilinear([r, y, b], STUDIO_FLUID_PAINT_RYB_CUBE);
}

export function studioFluidPaintClampVelocity(
  vx: number,
  vy: number,
  maxSpeed: number = STUDIO_FLUID_PAINT_SPLAT.maxSpeed,
): [number, number] {
  const speed = Math.hypot(vx, vy);
  if (!Number.isFinite(speed) || speed <= maxSpeed || speed <= 0) {
    return [vx, vy];
  }
  const scale = maxSpeed / speed;
  return [vx * scale, vy * scale];
}

/** Max of the last N speeds — brush.js `getFilteredSpeed`. */
export function studioFluidPaintFilteredSpeed(
  speeds: readonly number[],
  window: number = STUDIO_FLUID_PAINT_BRUSH.previousSpeeds,
): number {
  if (speeds.length === 0) return 0;
  const start = Math.max(0, speeds.length - Math.max(1, window));
  let peak = 0;
  for (let index = start; index < speeds.length; index += 1) {
    const value = speeds[index] ?? 0;
    if (value > peak) peak = value;
  }
  return peak;
}

/**
 * Distance from `p` to the capsule between `a` and `b` — splat.frag `distanceToLine`.
 * Used to stamp a soft bristle segment instead of a round dab.
 */
export function studioFluidPaintDistanceToSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);
  if (length <= 1e-8) return Math.hypot(px - ax, py - ay);
  const projected = Math.min(length, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / length));
  const qx = ax + (dx / length) * projected;
  const qy = ay + (dy / length) * projected;
  return Math.hypot(px - qx, py - qy);
}

export function studioFluidPaintSplatWeight(
  distance: number,
  radius: number,
): number {
  if (!(radius > 0)) return 0;
  return Math.max(0, 1 - distance / radius);
}

/**
 * Station pitch as a fraction of head width. Fluid Paint stamps 8 capsules per bristle
 * segment; walking the oil ribbon at 1/8 the default 0.068 pitch makes the tuft read as a
 * continuous liquid film rather than a row of ovals.
 *
 * Reference number only. The four `fluid-paint*` brush ids that used to select this pitch were
 * never registered in any catalog and were removed on 2026-09-02; the planner still honours an
 * explicit `stationSpacingRatio`, and the reference tests pin the pitch against it.
 */
export const STUDIO_FLUID_PAINT_STATION_SPACING_RATIO =
  0.068 / STUDIO_FLUID_PAINT_BRUSH.splatsPerSegment;

/**
 * Every field the oil family adds to an `FxOilPlanInput`, resolved from the brush id.
 *
 * These travel together on purpose. The paint body and tip profile were already passed side by
 * side at each oil call site; `capMode` joined them and was immediately forgotten at one of the
 * three, which would have let the same stroke be previewed on the ladder and then committed on
 * the legacy refit — the stroke visibly changing the moment the live overlay handed off. Handing
 * the set out as one object is what keeps that from depending on anyone remembering.
 *
 * The airbrush family plans through the same planner and deliberately does NOT use this: it has no
 * carrier pipeline to save, so it keeps the budget-filling refit.
 */
export function studioOilFamilyPlanFields(brush: string): {
  readonly paintBody: FxOilPaintBody;
  readonly tipProfile: FxOilTipProfile;
  readonly capMode: FxOilCapStationMode;
} {
  return {
    paintBody: studioOilPaintBodyForBrush(brush),
    tipProfile: studioOilTipProfileForBrush(brush),
    capMode: "prefix-stable-ladder-v2",
  };
}
