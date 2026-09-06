/**
 * Lane B substrate generation.
 *
 * Curtis 1997 §4.1: the paper is a heightfield `0 < h < 1` with fluid capacity
 * `c = h*(c_max - c_min) + c_min`.
 * Van Laerhoven 2004 §3.3: ONE procedural noise texture derives both the height field and the
 * capillary-capacity field.
 *
 * LANE B DEVIATION (independent): two fBm fields from independent seeds, mixed with a
 * correlation `rho`, so topography `h` and sizing/absorbency `alpha` are separable axes. Real
 * paper is rough-vs-sized independently — a rough sheet can be hard-sized. `rho = 1` collapses
 * back to Van Laerhoven's single-texture model exactly.
 *
 * QUANTIZATION CONTRACT: every plane is emitted as `Uint8Array` and both backends dequantize
 * with the same `byte / 255`. The GPU uploads these bytes verbatim. That makes the substrate
 * *bit-identical* across backends, so any CPU/GPU divergence measured later is attributable to
 * the fluid arithmetic alone and never to the paper. This is why the r8 discipline from
 * `studio-webgpu-r8-grain-native.ts` is worth keeping even though the sim state itself is f32.
 */

export const STUDIO_WET_INK_B_SUBSTRATE_REVISION = 1 as const;

export interface StudioWetInkBSubstrateOptions {
  readonly seedHeight: number;
  readonly seedSizing: number;
  /** Correlation between topography and sizing. 1 reproduces Van Laerhoven's single texture. */
  readonly rho: number;
  readonly capacityMin: number;
  readonly capacityMax: number;
  /** Tooth high-pass radius in cells. */
  readonly toothRadius: number;
}

export const STUDIO_WET_INK_B_DEFAULT_SUBSTRATE_OPTIONS: Readonly<StudioWetInkBSubstrateOptions> =
  Object.freeze({
    seedHeight: 12345,
    seedSizing: 98765,
    rho: 0.35,
    capacityMin: 0.4,
    capacityMax: 0.9,
    toothRadius: 5,
  });

export interface StudioWetInkBSubstrate {
  readonly kind: "studio-wet-ink-b-substrate";
  readonly revision: typeof STUDIO_WET_INK_B_SUBSTRATE_REVISION;
  readonly size: number;
  /** Paper topography, rank-uniform, quantized to u8. */
  readonly height: Uint8Array;
  /** Tooth-scale high-pass of `height`, rank-uniform in its own right, quantized to u8. */
  readonly tooth: Uint8Array;
  /** Fluid capacity `c`, derived from `alpha` (NOT from `height`), quantized to u8. */
  readonly capacity: Uint8Array;
  /** Sizing / absorbency, rank-uniform, quantized to u8. */
  readonly sizing: Uint8Array;
  /** The exact options that produced these planes; part of the determinism receipt. */
  readonly options: Readonly<StudioWetInkBSubstrateOptions>;
}

/** The single dequantization rule. Both backends and every test must route through this. */
export const studioWetInkBDequantize = (byte: number): number => byte / 255;

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function valueNoiseLayer(size: number, freq: number, rnd: () => number): Float32Array {
  const lattice = new Float32Array(freq * freq);
  for (let i = 0; i < lattice.length; i += 1) lattice[i] = rnd();
  const out = new Float32Array(size * size);
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y += 1) {
    const fy = (y / size) * freq;
    const y0 = Math.floor(fy);
    const ty = smooth(fy - y0);
    const y0m = ((y0 % freq) + freq) % freq;
    const y1m = (y0m + 1) % freq;
    for (let x = 0; x < size; x += 1) {
      const fx = (x / size) * freq;
      const x0 = Math.floor(fx);
      const tx = smooth(fx - x0);
      const x0m = ((x0 % freq) + freq) % freq;
      const x1m = (x0m + 1) % freq;
      const a = lattice[y0m * freq + x0m];
      const b = lattice[y0m * freq + x1m];
      const c = lattice[y1m * freq + x0m];
      const d = lattice[y1m * freq + x1m];
      const top = a + (b - a) * tx;
      const bottom = c + (d - c) * tx;
      out[y * size + x] = top + (bottom - top) * ty;
    }
  }
  return out;
}

interface FbmOptions {
  readonly octaves: number;
  readonly baseFreq: number;
  readonly gain: number;
  readonly lacunarity: number;
}

function fbm(size: number, seed: number, options: FbmOptions): Float32Array {
  const rnd = mulberry32(seed);
  const out = new Float32Array(size * size);
  let amplitude = 1;
  let freq = options.baseFreq;
  let norm = 0;
  for (let octave = 0; octave < options.octaves; octave += 1) {
    const layer = valueNoiseLayer(size, Math.max(2, Math.round(freq)), rnd);
    for (let i = 0; i < out.length; i += 1) out[i] += amplitude * layer[i];
    norm += amplitude;
    amplitude *= options.gain;
    freq *= options.lacunarity;
  }
  for (let i = 0; i < out.length; i += 1) out[i] /= norm;
  return out;
}

function normalize01(field: Float32Array): Float32Array {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < field.length; i += 1) {
    if (field[i] < lo) lo = field[i];
    if (field[i] > hi) hi = field[i];
  }
  const scale = hi > lo ? 1 / (hi - lo) : 1;
  for (let i = 0; i < field.length; i += 1) field[i] = (field[i] - lo) * scale;
  return field;
}

/**
 * Rank-transform to a uniform distribution (Heitz & Neyret 2018 gaussianization, simplified to
 * a uniform target). This is what makes the drybrush rule exact: because `tooth` is rank-uniform,
 * thresholding at `1 - wetness` covers a fraction of the paper equal to `wetness` regardless of
 * resolution or octave mix. A raw height threshold has neither property.
 */
function rankUniform(field: Float32Array): Float32Array {
  const order = new Uint32Array(field.length);
  for (let i = 0; i < order.length; i += 1) order[i] = i;
  const sorted = Array.from(order).sort((i, j) => field[i] - field[j]);
  const out = new Float32Array(field.length);
  for (let rank = 0; rank < sorted.length; rank += 1) {
    out[sorted[rank]] = (rank + 0.5) / field.length;
  }
  return out;
}

function boxBlur(field: Float32Array, size: number, radius: number): Float32Array {
  const tmp = new Float32Array(size * size);
  const out = new Float32Array(size * size);
  const width = 2 * radius + 1;
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) {
        sum += field[Math.min(size - 1, Math.max(0, i + k)) + j * size];
      }
      tmp[i + j * size] = sum / width;
    }
  }
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) {
        sum += tmp[i + Math.min(size - 1, Math.max(0, j + k)) * size];
      }
      out[i + j * size] = sum / width;
    }
  }
  return out;
}

function quantize(field: Float32Array): Uint8Array {
  const out = new Uint8Array(field.length);
  for (let i = 0; i < field.length; i += 1) {
    const v = field[i];
    out[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
  }
  return out;
}

/**
 * Builds the four static paper planes.
 *
 * The `height` spectrum is deliberately TOOTH-DOMINATED (baseFreq 24 over the grid, i.e. a
 * dominant scale near 10 cells). A low-frequency-weighted fBm makes the `-grad(h)` velocity
 * term expel pigment from broad hills and open wide white craters in the wash, and breaks
 * drybrush into disconnected blobs instead of speckle. See PROVENANCE CORRECTION-3.
 */
export function createStudioWetInkBSubstrate(
  size: number,
  overrides?: Partial<StudioWetInkBSubstrateOptions>,
): Readonly<StudioWetInkBSubstrate> {
  if (!Number.isInteger(size) || size < 8 || size > 4096) {
    throw new RangeError(`studio-wet-ink-b: substrate size must be an integer in [8, 4096], got ${size}`);
  }
  const options = Object.freeze({
    ...STUDIO_WET_INK_B_DEFAULT_SUBSTRATE_OPTIONS,
    ...overrides,
  }) as Readonly<StudioWetInkBSubstrateOptions>;

  const heightRaw = fbm(size, options.seedHeight, {
    octaves: 5,
    baseFreq: 24,
    gain: 0.5,
    lacunarity: 2,
  });
  const sizingRaw = fbm(size, options.seedSizing, {
    octaves: 4,
    baseFreq: 6,
    gain: 0.6,
    lacunarity: 2,
  });
  normalize01(heightRaw);
  normalize01(sizingRaw);

  const mixed = new Float32Array(size * size);
  for (let i = 0; i < mixed.length; i += 1) {
    mixed[i] = options.rho * heightRaw[i] + (1 - options.rho) * sizingRaw[i];
  }

  const height = rankUniform(heightRaw);
  const sizing = rankUniform(mixed);

  // Curtis §4.1 capacity, but driven by the SIZING field, not by the topography.
  const capacity = new Float32Array(size * size);
  const span = options.capacityMax - options.capacityMin;
  for (let i = 0; i < capacity.length; i += 1) {
    capacity[i] = sizing[i] * span + options.capacityMin;
  }

  // `tooth`: the fine-scale component of `height`, rank-uniform in its own right. Drybrush
  // contact and granular settling both read this rather than `height`, because both are
  // tooth-scale phenomena and must not be driven by the sheet's macro undulation.
  const blurred = boxBlur(height, size, options.toothRadius);
  const highPass = new Float32Array(size * size);
  for (let i = 0; i < highPass.length; i += 1) highPass[i] = height[i] - blurred[i];
  const tooth = rankUniform(highPass);

  return Object.freeze({
    kind: "studio-wet-ink-b-substrate" as const,
    revision: STUDIO_WET_INK_B_SUBSTRATE_REVISION,
    size,
    height: quantize(height),
    tooth: quantize(tooth),
    capacity: quantize(capacity),
    sizing: quantize(sizing),
    options,
  });
}

/**
 * Interleaves the four u8 planes into the rgba8 byte order the GPU uploads.
 * Channel order is (height, tooth, capacity, sizing) and is part of the shader contract.
 */
export function packStudioWetInkBSubstrateRgba8(
  substrate: Readonly<StudioWetInkBSubstrate>,
): Uint8Array {
  const count = substrate.size * substrate.size;
  const out = new Uint8Array(count * 4);
  for (let i = 0; i < count; i += 1) {
    out[i * 4] = substrate.height[i];
    out[i * 4 + 1] = substrate.tooth[i];
    out[i * 4 + 2] = substrate.capacity[i];
    out[i * 4 + 3] = substrate.sizing[i];
  }
  return out;
}
