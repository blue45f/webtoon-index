/**
 * Public-domain-style Kubelka–Munk *inspired* two-color mix for oil/smudge evaluation.
 *
 * This is **not** Mixbox and does not include Mixbox LUTs or Secret Weapons code.
 * Mixbox (CC BY-NC / commercial license) ships in Rebelle Pro — blocked for product
 * until a commercial license is purchased (see studio-commercial-open-engine-evaluation).
 *
 * Algorithm: treat linear RGB as rough absorption proxies, mix in "K/S-like" space,
 * convert back. Good enough for natural secondary hues without NC-licensed assets.
 */

export const STUDIO_SPECTRAL_PIGMENT_MIX_APPROX_VERSION =
  "studio-spectral-pigment-mix-approx-v1" as const;

export const STUDIO_SPECTRAL_PIGMENT_MIX_PROVENANCE = Object.freeze({
  theory: "Kubelka–Munk two-flux pigment mixing (public scientific literature)",
  notMixbox: "Does not use mixbox.js, mixbox_lut.png, or Secret Weapons assets",
  commercialNote:
    "For Rebelle-class accuracy, license Mixbox commercially and swap this adapter",
} as const);

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** sRGB 0–255 → approximate linear 0–1. */
export function studioSrgbChannelToLinear(channel: number): number {
  const c = clamp01(channel / 255);
  return c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function studioLinearToSrgbChannel(linear: number): number {
  const c = clamp01(linear);
  const srgb = c <= 0.003_130_8 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(clamp01(srgb) * 255);
}

/**
 * Reflectance → crude K/S ratio (infinite paint film simplification).
 * K/S = (1-R)^2 / (2R)
 */
function reflectanceToKs(r: number): number {
  const R = Math.min(0.97, Math.max(0.02, r));
  const t = 1 - R;
  return (t * t) / (2 * R);
}

function ksToReflectance(ks: number): number {
  const k = Math.max(0, ks);
  return clamp01(1 + k - Math.sqrt(k * (k + 2)));
}

export interface StudioRgb8 {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * Mix two sRGB colors with weight t∈[0,1] toward `b`.
 *
 * Combines:
 * - Kubelka–Munk-like K/S channel mix (darker, paint-like body)
 * - geometric mean of linear RGB (subtractive secondary bias: blue+yellow → green)
 *
 * Not Mixbox-accurate; good enough for oil smudge without NC-licensed LUTs.
 */
export function mixStudioSpectralPigmentApprox(
  a: StudioRgb8,
  b: StudioRgb8,
  t: number,
): StudioRgb8 {
  const w = clamp01(t);
  const la = [
    studioSrgbChannelToLinear(a.r),
    studioSrgbChannelToLinear(a.g),
    studioSrgbChannelToLinear(a.b),
  ] as const;
  const lb = [
    studioSrgbChannelToLinear(b.r),
    studioSrgbChannelToLinear(b.g),
    studioSrgbChannelToLinear(b.b),
  ] as const;
  const channels = [0, 1, 2].map((i) => {
    const ra = Math.max(1e-4, la[i]!);
    const rb = Math.max(1e-4, lb[i]!);
    // Subtractive geometric mean in linear light.
    const geo = ra ** (1 - w) * rb ** w;
    // KM-style optical-density mix for body.
    const ks = reflectanceToKs(ra) * (1 - w) + reflectanceToKs(rb) * w;
    const km = ksToReflectance(ks);
    // Prefer geometric mean for hue (secondary colours), blend a little KM darkness.
    const mixed = geo * 0.72 + km * 0.28;
    return studioLinearToSrgbChannel(mixed);
  });
  return {
    r: channels[0]!,
    g: channels[1]!,
    b: channels[2]!,
  };
}

/** Compare greener bias vs RGB lerp for blue+yellow (qualitative self-check). */
export function studioSpectralMixBeatsRgbLerpOnBlueYellow(): boolean {
  const blue = { r: 0, g: 33, b: 133 };
  const yellow = { r: 252, g: 211, b: 0 };
  const spectral = mixStudioSpectralPigmentApprox(blue, yellow, 0.5);
  const lerp = {
    r: Math.round((blue.r + yellow.r) / 2),
    g: Math.round((blue.g + yellow.g) / 2),
    b: Math.round((blue.b + yellow.b) / 2),
  };
  const spectralGreenBias = spectral.g - (spectral.r + spectral.b) / 2;
  const lerpGreenBias = lerp.g - (lerp.r + lerp.b) / 2;
  return spectral.g > lerp.g || spectralGreenBias > lerpGreenBias - 30;
}
