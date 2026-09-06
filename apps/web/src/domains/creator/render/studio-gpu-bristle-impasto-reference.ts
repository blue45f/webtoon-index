/**
 * GPU bristle lane — CPU twin of the deposit + impasto-resolve passes (gate G3's ≤ 1 LSB row).
 *
 * PROVENANCE. Derived from David Li's Fluid Paint (github.com/dli/paint, MIT License,
 * © 2017 David Li, http://david.li; verbatim notice at `third_party/dli-paint/LICENSE`):
 * `shaders/splat.frag` for the capsule stamp and `shaders/painting.frag` for the Sobel
 * height→normal + GGX / Smith-visibility / Schlick-fresnel relief. The BRDF itself is **not**
 * re-implemented here — this module is a thin adapter over the already-verified CPU port
 * `../studio-impasto-relief-shading-v1.ts`, which that file's own tests pin. Re-porting it would
 * create a second BRDF that could drift from the one already shipping.
 *
 * WHAT IT IS FOR. `computeStudioImpastoReliefShading` returns a per-pixel *shading multiplier*.
 * The GPU resolve returns 8-bit pixels. A ≤ 1 LSB comparison needs both sides expressed in the
 * same units and driven by the same height field, so this module supplies:
 *   1. a splat rasteriser that is the CPU twin of the `splat-deposit` pass (additive
 *      `blend {one, one}` into a paint accumulator and a height target), and
 *   2. an encoder that folds paper, pigment, optional paper grain and the shading multiplier into
 *      RGBA8 exactly as the `impasto-resolve` pass does.
 *
 * The grain term is **injected**, never re-implemented: `render/studio-webgpu-r8-grain-native.ts`
 * already ships `sampleStudioWebGpuR8GrainNativeCpu`, a bit-parity mirror of the WGSL
 * `textureSample` with repeat addressing and linear filtering. Passing that function in keeps the
 * grain term exact and leaves exactly one source of drift — the BRDF — which is a straight-line
 * per-pixel function with no iteration, hence the tight 1 LSB budget.
 */

import {
  STUDIO_FLUID_PAINT_DISPLAY,
  studioFluidPaintRybToRgb,
  studioFluidPaintSplatWeight,
} from "../brush/studio-fluid-paint-reference";
import {
  computeStudioImpastoReliefShading,
  type StudioImpastoReliefShadingQuality,
} from "../studio-impasto-relief-shading-v1";

import {
  STUDIO_GPU_BRISTLE_COMPONENTS_PER_SPLAT,
  STUDIO_GPU_BRISTLE_PHYSICS_DEFAULTS,
  STUDIO_GPU_BRISTLE_TOLERANCES,
} from "./studio-gpu-bristle-contract";

export const STUDIO_GPU_BRISTLE_IMPASTO_REFERENCE_VERSION =
  "studio-gpu-bristle-impasto-reference-v1" as const;

export class StudioGpuBristleImpastoReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioGpuBristleImpastoReferenceError";
  }
}

export interface StudioGpuBristleRasterOptions {
  readonly width: number;
  readonly height: number;
  /** World-space position of raster pixel (0, 0). */
  readonly originX?: number;
  readonly originY?: number;
}

export interface StudioGpuBristleRaster {
  readonly width: number;
  readonly height: number;
  /** Weighted RYB sums, 4 components per pixel: `r·w`, `y·w`, `b·w`, `w`. */
  readonly paint: Float32Array;
  /** Additively accumulated paint height, one component per pixel. */
  readonly heightField: Float32Array;
}

/**
 * CPU twin of the `splat-deposit` pass: every capsule is stamped additively, in slot order, into a
 * paint accumulator and a height target. Slot order is the GPU's draw order, and station-major
 * slots make that order identical under every batch chunking — see
 * `studioGpuBristleSplatSlot`.
 */
export function rasterizeStudioGpuBristleSplats(
  splats: Float32Array | Float64Array,
  options: StudioGpuBristleRasterOptions,
): StudioGpuBristleRaster {
  const { width, height } = options;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new StudioGpuBristleImpastoReferenceError(
      `raster dimensions must be positive integers, got ${width}x${height}`,
    );
  }
  if (splats.length % STUDIO_GPU_BRISTLE_COMPONENTS_PER_SPLAT !== 0) {
    throw new StudioGpuBristleImpastoReferenceError(
      `splat buffer length ${splats.length} is not a multiple of ${STUDIO_GPU_BRISTLE_COMPONENTS_PER_SPLAT}`,
    );
  }
  const originX = options.originX ?? 0;
  const originY = options.originY ?? 0;
  const paint = new Float32Array(width * height * 4);
  const heightField = new Float32Array(width * height);

  for (let slot = 0; slot < splats.length; slot += STUDIO_GPU_BRISTLE_COMPONENTS_PER_SPLAT) {
    const weight = splats[slot + 7]!;
    const radius = splats[slot + 8]!;
    if (!(weight > 0) || !(radius > 0)) continue;
    const ax = splats[slot]! - originX;
    const ay = splats[slot + 1]! - originY;
    const bx = splats[slot + 2]! - originX;
    const by = splats[slot + 3]! - originY;
    const pigmentR = splats[slot + 4]!;
    const pigmentY = splats[slot + 5]!;
    const pigmentB = splats[slot + 6]!;
    const splatHeight = splats[slot + 9]!;

    const minX = Math.max(0, Math.floor(Math.min(ax, bx) - radius));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx) + radius));
    const minY = Math.max(0, Math.floor(Math.min(ay, by) - radius));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by) + radius));

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const px = x + 0.5;
        const py = y + 0.5;
        const distance = distanceToSegment(ax, ay, bx, by, px, py);
        const falloff = studioFluidPaintSplatWeight(distance, radius);
        if (!(falloff > 0)) continue;
        const contribution = weight * falloff;
        const pixel = (y * width + x) * 4;
        paint[pixel] = paint[pixel]! + pigmentR * contribution;
        paint[pixel + 1] = paint[pixel + 1]! + pigmentY * contribution;
        paint[pixel + 2] = paint[pixel + 2]! + pigmentB * contribution;
        paint[pixel + 3] = paint[pixel + 3]! + contribution;
        const cell = y * width + x;
        heightField[cell] = heightField[cell]! + splatHeight * falloff;
      }
    }
  }
  return { width, height, paint, heightField };
}

/** `shaders/splat.frag distanceToLine`, inlined so the raster loop stays allocation-free. */
function distanceToSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (!(length > 1e-8)) return Math.hypot(px - ax, py - ay);
  const projected = Math.min(length, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / length));
  const qx = ax + (dx / length) * projected;
  const qy = ay + (dy / length) * projected;
  return Math.hypot(px - qx, py - qy);
}

export interface StudioGpuBristleResolveOptions {
  /** Linear paper colour in [0, 1]. Defaults to unbleached white. */
  readonly paperRgb?: readonly [number, number, number];
  readonly normalScale?: number;
  readonly roughness?: number;
  readonly f0?: number;
  readonly specularScale?: number;
  readonly diffuseScale?: number;
  readonly heightScale?: number;
  readonly quality?: StudioImpastoReliefShadingQuality;
  readonly lightDirection?: readonly [number, number, number];
  /**
   * Injected paper-grain sampler in raster pixel coordinates, returning [0, 1]. Pass
   * `sampleStudioWebGpuR8GrainNativeCpu` (its bit-parity WGSL mirror) so the grain term contributes
   * zero drift to the 1 LSB budget. Omitted → no grain.
   */
  readonly grain?: (x: number, y: number) => number;
  /** How strongly grain darkens the resolve, in [0, 1]. */
  readonly grainAmount?: number;
  /**
   * Gain from accumulated deposit weight to display opacity. Defaults to
   * `STUDIO_GPU_BRISTLE_PHYSICS_DEFAULTS.resolveDepositGain`; the GPU resolve must use the same
   * value or the two sides cannot be compared at 1 LSB.
   */
  readonly depositGain?: number;
}

export interface StudioGpuBristleResolve {
  readonly width: number;
  readonly height: number;
  /** Per-pixel GGX shading multiplier from `computeStudioImpastoReliefShading`. */
  readonly shading: Float32Array;
  /** Straight (non-premultiplied) RGBA8, exactly what the GPU presentation target holds. */
  readonly rgba: Uint8ClampedArray;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value >= 1 ? 1 : value;
}

/**
 * CPU twin of `impasto-resolve`. Paper is composited under the pigment by coverage, the pigment is
 * converted RYB → RGB with the Gossett & Chen cube (`painting.frag rybToRgb`), grain darkens the
 * result, and the GGX relief multiplier from the shipped port is applied last.
 */
export function computeStudioGpuBristleImpastoReference(
  raster: StudioGpuBristleRaster,
  options: StudioGpuBristleResolveOptions = {},
): StudioGpuBristleResolve {
  const { width, height, paint, heightField } = raster;
  const display = STUDIO_FLUID_PAINT_DISPLAY;
  const shading = computeStudioImpastoReliefShading(heightField, {
    width,
    height,
    normalScale: options.normalScale ?? display.normalScale,
    roughness: options.roughness ?? display.roughness,
    f0: options.f0 ?? display.f0,
    specularScale: options.specularScale ?? display.specularScale,
    diffuseScale: options.diffuseScale ?? display.diffuseScale,
    heightScale: options.heightScale ?? STUDIO_GPU_BRISTLE_PHYSICS_DEFAULTS.resolveDepositGain,
    quality: options.quality ?? "ggx",
    ...(options.lightDirection ? { lightDirection: options.lightDirection } : {}),
  });
  const paper = options.paperRgb ?? ([1, 1, 1] as const);
  const depositGain = options.depositGain ?? STUDIO_GPU_BRISTLE_PHYSICS_DEFAULTS.resolveDepositGain;
  const grainAmount = clamp01(options.grainAmount ?? 0);
  const grain = options.grain;
  const rgba = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cell = y * width + x;
      const pixel = cell * 4;
      const coverage = paint[pixel + 3]!;
      let red = paper[0]!;
      let green = paper[1]!;
      let blue = paper[2]!;
      if (coverage > 0) {
        const inverse = 1 / coverage;
        const [pigmentRed, pigmentGreen, pigmentBlue] = studioFluidPaintRybToRgb(
          paint[pixel]! * inverse,
          paint[pixel + 1]! * inverse,
          paint[pixel + 2]! * inverse,
        );
        const alpha = clamp01(coverage * depositGain);
        red = paper[0]! * (1 - alpha) + pigmentRed * alpha;
        green = paper[1]! * (1 - alpha) + pigmentGreen * alpha;
        blue = paper[2]! * (1 - alpha) + pigmentBlue * alpha;
      }
      if (grain && grainAmount > 0) {
        const tooth = 1 - grainAmount * (1 - clamp01(grain(x, y)));
        red *= tooth;
        green *= tooth;
        blue *= tooth;
      }
      const shade = shading[cell]!;
      rgba[pixel] = Math.round(clamp01(red * shade) * 255);
      rgba[pixel + 1] = Math.round(clamp01(green * shade) * 255);
      rgba[pixel + 2] = Math.round(clamp01(blue * shade) * 255);
      rgba[pixel + 3] = 255;
    }
  }
  return { width, height, shading, rgba };
}

export interface StudioGpuBristleLsbComparison {
  readonly maxDelta: number;
  readonly mismatchCount: number;
  readonly threshold: number;
  readonly pass: boolean;
}

/**
 * Per-channel 8-bit comparison for gate G3's impasto row.
 *
 * Catches: `NORMAL_SCALE 7.0` collapsing (the resolve reads flat while every other number stays
 * green), a transposed Sobel kernel, and dropped Smith visibility. The alpha channel is compared
 * too — a resolve that forgets to write opaque alpha is a black canvas, not a subtle drift.
 */
export function compareStudioGpuBristleImpastoLsb(
  candidate: Uint8ClampedArray | Uint8Array,
  reference: Uint8ClampedArray | Uint8Array,
): StudioGpuBristleLsbComparison {
  if (candidate.length !== reference.length) {
    throw new StudioGpuBristleImpastoReferenceError(
      `candidate length ${candidate.length} does not match reference length ${reference.length}`,
    );
  }
  const threshold = STUDIO_GPU_BRISTLE_TOLERANCES.impastoChannelLsb;
  let maxDelta = 0;
  let mismatchCount = 0;
  for (let index = 0; index < candidate.length; index += 1) {
    const delta = Math.abs(candidate[index]! - reference[index]!);
    if (delta > 0) mismatchCount += 1;
    if (delta > maxDelta) maxDelta = delta;
  }
  return { maxDelta, mismatchCount, threshold, pass: maxDelta <= threshold };
}

/**
 * Contrast of the shading multiplier across a synthetic ridge — the fourth admission threshold in
 * gate G4, and the only one that catches `NORMAL_SCALE` silently collapsing while paper stddev,
 * stroke darkness and untouched-region stddev all stay green.
 *
 * Returns `max(shading) − min(shading)` over the supplied field. A flat resolve returns 0.
 */
export function studioGpuBristleReliefContrast(shading: Float32Array): number {
  if (shading.length === 0) return 0;
  let lowest = Number.POSITIVE_INFINITY;
  let highest = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < shading.length; index += 1) {
    const value = shading[index]!;
    if (value < lowest) lowest = value;
    if (value > highest) highest = value;
  }
  return highest - lowest;
}

/**
 * A ridge height field for the admission probe: one raised bar running **across** the tile, so its
 * slope varies along y.
 *
 * The orientation is load-bearing, not cosmetic. The default light
 * (`STUDIO_IMPASTO_RELIEF_LIGHT_DIRECTION_DEFAULT`, image-space `(0, −1, 1)`) lies in the y–z
 * plane, so a ridge that varies along x tilts the normal only in x and barely moves `n·l` — a
 * perfectly healthy resolve then reports ~0.001 contrast and the admission gate reads as a failure.
 * Deterministic, allocation-cheap, and independent of the solver so an admission failure cannot be
 * masked by a solver bug.
 */
export function createStudioGpuBristleRidgeHeightField(
  width: number,
  height: number,
  ridgeHeight = 1,
): Float32Array {
  const field = new Float32Array(width * height);
  const center = (height - 1) / 2;
  const halfSpan = Math.max(1, height / 8);
  for (let y = 0; y < height; y += 1) {
    const distance = Math.abs(y - center) / halfSpan;
    const value = distance >= 1 ? 0 : ridgeHeight * (1 - distance);
    for (let x = 0; x < width; x += 1) field[y * width + x] = value;
  }
  return field;
}
