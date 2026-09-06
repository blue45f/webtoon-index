/**
 * Silk-class interactive generative symmetry trails.
 *
 * Given a pointer path, emits multi-arm mirrored/rotated samples for
 * generative abstract art (backgrounds, energy patterns). Pure geometry.
 *
 * Optional noise force (weavesilk-class) bends filaments with a deterministic
 * multi-octave hash field so live prefixes stay byte-stable under the same seed.
 */

export interface StudioSilkPoint {
  readonly x: number;
  readonly y: number;
  readonly pressure?: number;
  readonly t?: number;
}

export interface StudioSilkGenerativeSpec {
  /** Number of rotational arms (Silk-like multi-filament). */
  readonly arms: number;
  readonly centerX: number;
  readonly centerY: number;
  /** Mirror each arm (kaleidoscope energy). */
  readonly mirror: boolean;
  /** Soft trail copies behind the live tip (0..8). */
  readonly trailCopies: number;
  /** Document units between trail echoes. */
  readonly trailSpacing: number;
  /** Attenuate pressure/opacity along trail echoes. */
  readonly trailFalloff: number;
  /**
   * Document-unit amplitude of the deterministic noise force.
   * 0 disables (legacy pure radial geometry).
   */
  readonly noiseForceScale: number;
  /** Spatial frequency of the noise field (cycles per document unit). */
  readonly noiseSpaceScale: number;
  /** Time evolution of the noise field along the stroke parameter t. */
  readonly noiseTimeScale: number;
  /** Deterministic field seed. */
  readonly noiseSeed: number;
  /** When true, trail echoes spiral toward the symmetry centre. */
  readonly spiral: boolean;
}

export const DEFAULT_STUDIO_SILK_GENERATIVE_SPEC: StudioSilkGenerativeSpec = Object.freeze({
  arms: 6,
  centerX: 400,
  centerY: 600,
  mirror: true,
  trailCopies: 3,
  trailSpacing: 14,
  trailFalloff: 0.72,
  noiseForceScale: 4.5,
  noiseSpaceScale: 0.035,
  noiseTimeScale: 0.8,
  noiseSeed: 0x51_1c_e001,
  spiral: false,
});

export const STUDIO_SILK_MAX_ARMS = 24;
export const STUDIO_SILK_MAX_TRAIL_COPIES = 8;

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Deterministic [0,1) hash — no Math.random, prefix-stable. */
function hash01(x: number, y: number, z: number, seed: number): number {
  let value = (
    Math.imul(x | 0, 0x45d9_f3b)
    ^ Math.imul(y | 0, 0x27d4_eb2d)
    ^ Math.imul(z | 0, 0x1656_67b1)
    ^ (seed >>> 0)
  ) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb_352d) >>> 0;
  value = Math.imul(value ^ (value >>> 15), 0x846c_a68b) >>> 0;
  value ^= value >>> 16;
  return (value >>> 0) / 0xffff_ffff;
}

function valueNoise2d(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash01(x0, y0, 1, seed);
  const b = hash01(x0 + 1, y0, 1, seed);
  const c = hash01(x0, y0 + 1, 1, seed);
  const d = hash01(x0 + 1, y0 + 1, 1, seed);
  return a
    + (b - a) * ux
    + (c - a) * uy
    + (a - b - c + d) * ux * uy;
}

/** Three octaves of value noise → angle in radians (0..2π). */
function silkNoiseAngle(
  x: number,
  y: number,
  t: number,
  seed: number,
  spaceScale: number,
  timeScale: number,
): number {
  const sx = x * spaceScale;
  const sy = y * spaceScale;
  const st = t * timeScale;
  const n0 = valueNoise2d(sx + st, sy, seed);
  const n1 = valueNoise2d(sx * 2.1 + 17 + st * 0.7, sy * 2.1, seed ^ 0x9e37);
  const n2 = valueNoise2d(sx * 4.3 - 9 + st * 0.35, sy * 4.3, seed ^ 0x85eb);
  const field = n0 * 0.5 + n1 * 0.33 + n2 * 0.17;
  return field * Math.PI * 2;
}

function normalizeSpec(spec?: Partial<StudioSilkGenerativeSpec>): StudioSilkGenerativeSpec {
  const base = DEFAULT_STUDIO_SILK_GENERATIVE_SPEC;
  return Object.freeze({
    arms: clampInt(spec?.arms ?? base.arms, 1, STUDIO_SILK_MAX_ARMS, base.arms),
    centerX: Number.isFinite(spec?.centerX) ? Number(spec?.centerX) : base.centerX,
    centerY: Number.isFinite(spec?.centerY) ? Number(spec?.centerY) : base.centerY,
    mirror: spec?.mirror ?? base.mirror,
    trailCopies: clampInt(
      spec?.trailCopies ?? base.trailCopies,
      0,
      STUDIO_SILK_MAX_TRAIL_COPIES,
      base.trailCopies,
    ),
    trailSpacing: Math.max(0, Number.isFinite(spec?.trailSpacing) ? Number(spec?.trailSpacing) : base.trailSpacing),
    trailFalloff: Math.max(
      0.05,
      Math.min(1, Number.isFinite(spec?.trailFalloff) ? Number(spec?.trailFalloff) : base.trailFalloff),
    ),
    noiseForceScale: clamp(
      Number.isFinite(spec?.noiseForceScale) ? Number(spec?.noiseForceScale) : base.noiseForceScale,
      0,
      64,
    ),
    noiseSpaceScale: clamp(
      Number.isFinite(spec?.noiseSpaceScale) ? Number(spec?.noiseSpaceScale) : base.noiseSpaceScale,
      0.001,
      1,
    ),
    noiseTimeScale: clamp(
      Number.isFinite(spec?.noiseTimeScale) ? Number(spec?.noiseTimeScale) : base.noiseTimeScale,
      0,
      8,
    ),
    noiseSeed: clampInt(
      spec?.noiseSeed ?? base.noiseSeed,
      0,
      0xffff_ffff,
      base.noiseSeed,
    ),
    spiral: spec?.spiral ?? base.spiral,
  });
}

function rotateAround(
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  angle: number,
): StudioSilkPoint {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = x - centerX;
  const dy = y - centerY;
  return {
    x: centerX + dx * cos - dy * sin,
    y: centerY + dx * sin + dy * cos,
  };
}

function mirrorVertical(
  x: number,
  y: number,
  centerX: number,
): StudioSilkPoint {
  return { x: centerX * 2 - x, y };
}

/**
 * Expand one sample into the full Silk filament set (arms × mirror × trails).
 * Deterministic order: arm major, mirror, trail.
 */
export function expandStudioSilkSample(
  sample: StudioSilkPoint,
  partialSpec?: Partial<StudioSilkGenerativeSpec>,
): readonly StudioSilkPoint[] {
  const spec = normalizeSpec(partialSpec);
  const pressure = Math.max(0, Math.min(1, sample.pressure ?? 0.7));
  const t = Number.isFinite(sample.t) ? Number(sample.t) : 0;
  const out: StudioSilkPoint[] = [];

  const applyNoise = (point: StudioSilkPoint, phase: number): StudioSilkPoint => {
    if (spec.noiseForceScale <= 0) return point;
    const angle = silkNoiseAngle(
      point.x,
      point.y,
      t + phase,
      spec.noiseSeed,
      spec.noiseSpaceScale,
      spec.noiseTimeScale,
    );
    const amp = spec.noiseForceScale * (0.55 + pressure * 0.45);
    return {
      x: point.x + Math.cos(angle) * amp,
      y: point.y + Math.sin(angle) * amp,
      pressure: point.pressure,
      t: point.t,
    };
  };

  for (let arm = 0; arm < spec.arms; arm += 1) {
    const angle = (arm * 2 * Math.PI) / spec.arms;
    const rotated = rotateAround(sample.x, sample.y, spec.centerX, spec.centerY, angle);
    const bases = spec.mirror
      ? [rotated, mirrorVertical(rotated.x, rotated.y, spec.centerX)]
      : [rotated];

    for (const [baseIndex, base] of bases.entries()) {
      const filament = applyNoise(
        { x: base.x, y: base.y, pressure, t: sample.t },
        arm * 0.17 + baseIndex * 0.31,
      );
      out.push(filament);
      for (let trail = 1; trail <= spec.trailCopies; trail += 1) {
        const towardCenterX = spec.centerX - filament.x;
        const towardCenterY = spec.centerY - filament.y;
        const len = Math.hypot(towardCenterX, towardCenterY) || 1;
        const nx = towardCenterX / len;
        const ny = towardCenterY / len;
        // Spiral: rotate the inward echo so filaments coil toward the centre (weavesilk toggle).
        const spiralAngle = spec.spiral ? trail * 0.35 : 0;
        const cos = Math.cos(spiralAngle);
        const sin = Math.sin(spiralAngle);
        const rx = nx * cos - ny * sin;
        const ry = nx * sin + ny * cos;
        const fall = pressure * (spec.trailFalloff ** trail);
        const echo = applyNoise(
          {
            x: filament.x + rx * spec.trailSpacing * trail,
            y: filament.y + ry * spec.trailSpacing * trail,
            pressure: fall,
            t: sample.t,
          },
          arm * 0.17 + trail * 0.11 + baseIndex * 0.05,
        );
        out.push(echo);
      }
    }
  }

  return Object.freeze(out);
}

export function expandStudioSilkPath(
  path: readonly StudioSilkPoint[],
  partialSpec?: Partial<StudioSilkGenerativeSpec>,
): readonly StudioSilkPoint[] {
  const expanded: StudioSilkPoint[] = [];
  for (const sample of path) {
    expanded.push(...expandStudioSilkSample(sample, partialSpec));
  }
  return Object.freeze(expanded);
}

export function studioSilkVariationCount(partialSpec?: Partial<StudioSilkGenerativeSpec>): number {
  const spec = normalizeSpec(partialSpec);
  const mirrors = spec.mirror ? 2 : 1;
  return spec.arms * mirrors * (1 + spec.trailCopies);
}
