/**
 * libmypaint 10-band spectral weighted-geometric-mean pigment mixer — exact CPU port.
 *
 * Ported from libmypaint (github.com/mypaint/libmypaint) `helpers.c`:
 * `T_MATRIX_SMALL`, `spectral_r_small`, `spectral_g_small`, `spectral_b_small`,
 * `rgb_to_spectral`, `spectral_to_rgb`, `mix_colors`, with `WGM_EPSILON` (0.001)
 * from `helpers.h`. libmypaint is ISC licensed (COPYING, © 2007–2008 Martin Renold
 * and the MyPaint Development Team): "Permission to use, copy, modify, and/or
 * distribute this software for any purpose with or without fee is hereby granted,
 * provided that the above copyright notice and this permission notice appear in
 * all copies." The spectral method follows Scott Allen Burns' weighted-geometric-
 * mean subtractive mixing as adapted for MyPaint's pigment/paint mode.
 *
 * This module is the verified-engine counterpart of the self-made
 * `studio-spectral-pigment-mix-approx.ts` (which stays untouched as the cheap
 * fallback). No Mixbox LUTs or Secret Weapons assets are involved.
 *
 * Numeric note: upstream computes in 32-bit `float`/`powf`; this port uses JS
 * doubles, so results are deterministic per JS engine but not bit-equal to C.
 */

export const STUDIO_SPECTRAL_WGM_MIX_V1_VERSION =
  "studio-spectral-wgm-mix-v1" as const;

/** Provenance tags embedded in metrics and tests (see studio-oss-brush-kernels). */
export const STUDIO_SPECTRAL_WGM_MIX_PROVENANCE = Object.freeze({
  license: "ISC (libmypaint COPYING; MIT-equivalent permissive)",
  source:
    "libmypaint helpers.c — rgb_to_spectral / spectral_to_rgb / mix_colors + 10-band tables",
  epsilon: "WGM_EPSILON 0.001 (libmypaint helpers.h)",
  method:
    "Scott Allen Burns weighted-geometric-mean spectral upsampling, alpha-weighted as upstream",
  notMixbox:
    "No mixbox.js / mixbox LUT / Secret Weapons assets; independent of the approx mixer",
} as const);

/**
 * Per-lane opt-in pin for the shared per-dab colour resolver
 * (studio-brush-material-dynamics). Mirrors the wet-edge-bloom / stamp-paper
 * program-id discipline: a colour-dynamics snapshot without this exact id keeps
 * the historical linear foreground↔background lerp byte-for-byte; only a lane
 * whose catalogue tuning carries the pin routes its mix through
 * {@link mixStudioSpectralWgm}.
 */
export const STUDIO_SPECTRAL_WGM_COLOR_MIX_PROGRAM_ID = "spectral-wgm-v1" as const;

export type StudioSpectralWgmColorMixProgramId =
  typeof STUDIO_SPECTRAL_WGM_COLOR_MIX_PROGRAM_ID;

export function isStudioSpectralWgmColorMixProgramId(
  value: unknown,
): value is StudioSpectralWgmColorMixProgramId {
  return value === STUDIO_SPECTRAL_WGM_COLOR_MIX_PROGRAM_ID;
}

/**
 * `paint_mode` used by the pinned per-dab colour program: 1 = pure spectral WGM
 * pigment mixing (libmypaint pigment brushes), no linear-RGB blend-back.
 */
export const STUDIO_SPECTRAL_WGM_COLOR_MIX_PAINT_MODE = 1 as const;

export const STUDIO_SPECTRAL_WGM_BAND_COUNT = 10 as const;

/** libmypaint helpers.h `WGM_EPSILON` — keeps every spectral band strictly positive. */
export const STUDIO_SPECTRAL_WGM_EPSILON = 0.001 as const;

/**
 * libmypaint helpers.c `T_MATRIX_SMALL` — 10-band spectrum → linear-ish RGB
 * back-projection, row-major [r|g|b][band].
 */
export const STUDIO_SPECTRAL_WGM_T_MATRIX_SMALL: readonly (readonly number[])[] =
  Object.freeze([
    Object.freeze([
      0.026595621243689, 0.049779426257903, 0.022449850859496, -0.218453689278271,
      -0.256894883201278, 0.445881722194840, 0.772365886289756, 0.194498761382537,
      0.014038157587820, 0.007687264480513,
    ]),
    Object.freeze([
      -0.032601672674412, -0.061021043498478, -0.052490001018404, 0.206659098273522,
      0.572496335158169, 0.317837248815438, -0.021216624031211, -0.019387668756117,
      -0.001521339050858, -0.000835181622534,
    ]),
    Object.freeze([
      0.339475473216284, 0.635401374177222, 0.771520797089589, 0.113222640692379,
      -0.055251113343776, -0.048222578468680, -0.012966666339586, -0.001523814504223,
      -0.000094718948810, -0.000051604594741,
    ]),
  ]);

/** libmypaint helpers.c `spectral_r_small` — red primary reflectance, 10 bands. */
export const STUDIO_SPECTRAL_WGM_R_SMALL: readonly number[] = Object.freeze([
  0.009281362787953, 0.009732627042016, 0.011254252737167, 0.015105578649573,
  0.024797924177217, 0.083622585502406, 0.977865045723212, 1.000000000000000,
  0.999961046144372, 0.999999992756822,
]);

/** libmypaint helpers.c `spectral_g_small` — green primary reflectance, 10 bands. */
export const STUDIO_SPECTRAL_WGM_G_SMALL: readonly number[] = Object.freeze([
  0.002854127435775, 0.003917589679914, 0.012132151699187, 0.748259205918013,
  1.000000000000000, 0.865695937531795, 0.037477469241101, 0.022816789725717,
  0.021747419446456, 0.021384940572308,
]);

/** libmypaint helpers.c `spectral_b_small` — blue primary reflectance, 10 bands. */
export const STUDIO_SPECTRAL_WGM_B_SMALL: readonly number[] = Object.freeze([
  0.537052150373386, 0.546646402401469, 0.575501819073983, 0.258778829633924,
  0.041709923751716, 0.012662638828324, 0.007485593127390, 0.006766900622462,
  0.006699764779016, 0.006676219883241,
]);

/**
 * Straight-alpha color in libmypaint's working range: every channel 0..1.
 * `a` defaults to 1 (opaque paint) — libmypaint feeds its brush color with
 * alpha 1 and only the smudge bucket carries partial alpha.
 */
export interface StudioSpectralWgmRgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a?: number;
}

export interface StudioSpectralWgmMixResult {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * libmypaint `rgb_to_spectral`: offset channels into (0, 1] by WGM_EPSILON,
 * weigh the three 10-band primaries and collapse to one spectrum. Output bands
 * are strictly positive, so the geometric mean never sees pow(0, 0).
 */
export function studioSpectralWgmRgbToSpectral(
  r: number,
  g: number,
  b: number,
  into?: Float64Array,
): Float64Array {
  const offset = 1 - STUDIO_SPECTRAL_WGM_EPSILON;
  const offsetR = clamp01(r) * offset + STUDIO_SPECTRAL_WGM_EPSILON;
  const offsetG = clamp01(g) * offset + STUDIO_SPECTRAL_WGM_EPSILON;
  const offsetB = clamp01(b) * offset + STUDIO_SPECTRAL_WGM_EPSILON;
  const spectral = into ?? new Float64Array(STUDIO_SPECTRAL_WGM_BAND_COUNT);
  for (let band = 0; band < STUDIO_SPECTRAL_WGM_BAND_COUNT; band += 1) {
    spectral[band] =
      STUDIO_SPECTRAL_WGM_R_SMALL[band]! * offsetR
      + STUDIO_SPECTRAL_WGM_G_SMALL[band]! * offsetG
      + STUDIO_SPECTRAL_WGM_B_SMALL[band]! * offsetB;
  }
  return spectral;
}

/**
 * libmypaint `spectral_to_rgb`: project the spectrum through T_MATRIX_SMALL,
 * undo the WGM_EPSILON offset and clamp to [0, 1].
 */
export function studioSpectralWgmSpectralToRgb(
  spectral: ArrayLike<number>,
): readonly [number, number, number] {
  const offset = 1 - STUDIO_SPECTRAL_WGM_EPSILON;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let band = 0; band < STUDIO_SPECTRAL_WGM_BAND_COUNT; band += 1) {
    const energy = spectral[band]!;
    r += STUDIO_SPECTRAL_WGM_T_MATRIX_SMALL[0]![band]! * energy;
    g += STUDIO_SPECTRAL_WGM_T_MATRIX_SMALL[1]![band]! * energy;
    b += STUDIO_SPECTRAL_WGM_T_MATRIX_SMALL[2]![band]! * energy;
  }
  return [
    clamp01((r - STUDIO_SPECTRAL_WGM_EPSILON) / offset),
    clamp01((g - STUDIO_SPECTRAL_WGM_EPSILON) / offset),
    clamp01((b - STUDIO_SPECTRAL_WGM_EPSILON) / offset),
  ];
}

/**
 * Effective weighted-geometric-mean exponents, exactly as libmypaint derives
 * them inside `mix_colors`. Exposed because the weighting is deliberately
 * asymmetric: `a` is the accumulated smudge state and `b` the newly sampled
 * paint, so even at equal alphas the spectral weight of `a` is
 * `factor / (2 - factor)`, not `factor`. Fully commutative behaviour only
 * exists on the linear path (`paintMode` 0) and at the factor endpoints.
 */
export function studioSpectralWgmEffectiveFactors(
  factor: number,
  alphaA: number,
  alphaB: number,
): readonly [number, number] {
  const opaA = clamp01(factor);
  const opaB = 1 - opaA;
  const a3 = clamp01(alphaA);
  const b3 = clamp01(alphaB);
  // libmypaint: "Guard against NaN from division by zero".
  const sfacA = a3 === 0 ? 0 : (opaA * a3) / (a3 + b3 * opaB);
  return [sfacA, 1 - sfacA];
}

/**
 * libmypaint `mix_colors(a, b, fac, paint_mode)`.
 *
 * `factor` is the weight of `rgbA` (libmypaint semantics — the OPPOSITE of the
 * approx mixer's `t` toward `b`). `paintMode` 1 = pure spectral WGM pigment
 * mixing, 0 = plain linear RGB lerp, in between lerps the two results —
 * matching the `.myb` `paint_mode` setting (e.g. STUDIO_OSS_OIL_FILM_RECIPE's
 * 0.88). Alpha mixes linearly and the spectral exponents are alpha-weighted
 * exactly as upstream (see {@link studioSpectralWgmEffectiveFactors}).
 */
export function mixStudioSpectralWgm(
  rgbA: StudioSpectralWgmRgba,
  rgbB: StudioSpectralWgmRgba,
  factor: number,
  paintMode: number,
): StudioSpectralWgmMixResult {
  const opaA = clamp01(factor);
  const opaB = 1 - opaA;
  const alphaA = clamp01(rgbA.a ?? 1);
  const alphaB = clamp01(rgbB.a ?? 1);
  const aR = clamp01(rgbA.r);
  const aG = clamp01(rgbA.g);
  const aB = clamp01(rgbA.b);
  const bR = clamp01(rgbB.r);
  const bG = clamp01(rgbB.g);
  const bB = clamp01(rgbB.b);
  const mode = clamp01(paintMode);

  const outAlpha = clamp01(opaA * alphaA + opaB * alphaB);
  const [sfacA, sfacB] = studioSpectralWgmEffectiveFactors(opaA, alphaA, alphaB);

  let r = 0;
  let g = 0;
  let b = 0;
  if (mode > 0) {
    const spectralA = studioSpectralWgmRgbToSpectral(aR, aG, aB);
    const spectralB = studioSpectralWgmRgbToSpectral(bR, bG, bB);
    const spectralMix = new Float64Array(STUDIO_SPECTRAL_WGM_BAND_COUNT);
    for (let band = 0; band < STUDIO_SPECTRAL_WGM_BAND_COUNT; band += 1) {
      // Subtractive weighted geometric mean — both bases are > 0 by construction.
      spectralMix[band] =
        Math.pow(spectralA[band]!, sfacA) * Math.pow(spectralB[band]!, sfacB);
    }
    [r, g, b] = studioSpectralWgmSpectralToRgb(spectralMix);
  }
  if (mode < 1) {
    r = r * mode + (1 - mode) * (aR * opaA + bR * opaB);
    g = g * mode + (1 - mode) * (aG * opaA + bG * opaB);
    b = b * mode + (1 - mode) * (aB * opaA + bB * opaB);
  }
  return { r, g, b, a: outAlpha };
}

export interface StudioSpectralWgmRgb8 {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * 8-bit convenience wrapper for the smudge/blend integration surface.
 * libmypaint feeds `mix_colors` its 0..1 fixed-point sRGB values without
 * further linearization, so `channel / 255` in and rounded `× 255` out is the
 * faithful 8-bit adapter. `factor` still weighs `rgbA` (upstream semantics).
 */
export function mixStudioSpectralWgmSrgb8(
  rgbA: StudioSpectralWgmRgb8,
  rgbB: StudioSpectralWgmRgb8,
  factor: number,
  paintMode: number,
): StudioSpectralWgmRgb8 {
  const mixed = mixStudioSpectralWgm(
    { r: rgbA.r / 255, g: rgbA.g / 255, b: rgbA.b / 255 },
    { r: rgbB.r / 255, g: rgbB.g / 255, b: rgbB.b / 255 },
    factor,
    paintMode,
  );
  return {
    r: Math.round(clamp01(mixed.r) * 255),
    g: Math.round(clamp01(mixed.g) * 255),
    b: Math.round(clamp01(mixed.b) * 255),
  };
}

/**
 * Self-check mirroring `studioSpectralMixBeatsRgbLerpOnBlueYellow`: the WGM
 * pigment mix of blue + yellow must stay greener AND more saturated than the
 * linear-RGB lerp that turns the pair into grey mud.
 */
export function studioSpectralWgmBeatsRgbLerpOnBlueYellow(): boolean {
  const blue = { r: 0, g: 33 / 255, b: 133 / 255 } as const;
  const yellow = { r: 252 / 255, g: 211 / 255, b: 0 } as const;
  // factor 0.5 → alpha-weighted spectral exponents (1/3, 2/3); see
  // studioSpectralWgmEffectiveFactors for why the balanced point is factor 2/3.
  const spectral = mixStudioSpectralWgm(blue, yellow, 0.5, 1);
  const lerp = mixStudioSpectralWgm(blue, yellow, 0.5, 0);
  const spectralGreenBias = spectral.g - (spectral.r + spectral.b) / 2;
  const lerpGreenBias = lerp.g - (lerp.r + lerp.b) / 2;
  const chroma = (c: { r: number; g: number; b: number }) =>
    Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
  return spectralGreenBias > lerpGreenBias && chroma(spectral) > chroma(lerp);
}
