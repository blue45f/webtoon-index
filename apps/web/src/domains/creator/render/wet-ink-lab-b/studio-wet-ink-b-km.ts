/**
 * Lane B Kubelka-Munk optical compositing — Curtis 1997 §5.2.
 *
 *   a = (S + K)/S,  b = sqrt(a^2 - 1)
 *   c = a*sinh(b*S*x) + b*cosh(b*S*x)
 *   R = sinh(b*S*x)/c,  T = b/c
 *
 * Layer over background (Kubelka's compositing equations, Curtis §5.2):
 *   R_total = R + T^2 * R_bg / (1 - R * R_bg)
 *
 * The property that makes drybrush possible lives here: at `x = 0` the layer is `R = 0, T = 1`,
 * so the background passes through EXACTLY. A hole in the pigment field is a hole in the image,
 * not a lightened smudge. A multiply-on-colour compositor cannot express this, which is why the
 * sim stores pigment as per-channel optical quantity and never as a colour.
 */

import type { StudioWetInkBPigment } from "./studio-wet-ink-b-model";

export const STUDIO_WET_INK_B_KM_REVISION = 1 as const;

/** sinh/cosh overflow guard. `z` beyond this is optically opaque anyway. */
const Z_MAX = 60;

export interface StudioWetInkBLayer {
  readonly reflectance: readonly [number, number, number];
  readonly transmittance: readonly [number, number, number];
}

/** Reflectance and transmittance of one pigment layer of thickness `x`, per linear-RGB channel. */
export function studioWetInkBLayer(
  K: readonly [number, number, number],
  S: readonly [number, number, number],
  x: number,
): Readonly<StudioWetInkBLayer> {
  const reflectance: [number, number, number] = [0, 0, 0];
  const transmittance: [number, number, number] = [1, 1, 1];
  for (let channel = 0; channel < 3; channel += 1) {
    const k = K[channel];
    const s = Math.max(1e-6, S[channel]);
    const a = (s + k) / s;
    const b = Math.sqrt(Math.max(1e-12, a * a - 1));
    const z = Math.min(Z_MAX, b * s * x);
    if (!(z > 1e-8)) {
      reflectance[channel] = 0;
      transmittance[channel] = 1;
      continue;
    }
    const sinh = Math.sinh(z);
    const cosh = Math.cosh(z);
    const denom = a * sinh + b * cosh;
    reflectance[channel] = sinh / denom;
    transmittance[channel] = b / denom;
  }
  return Object.freeze({
    reflectance: reflectance as readonly [number, number, number],
    transmittance: transmittance as readonly [number, number, number],
  });
}

/** Composites a layer over a background reflectance. */
export function studioWetInkBOver(
  layer: Readonly<StudioWetInkBLayer>,
  background: readonly [number, number, number],
): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  for (let channel = 0; channel < 3; channel += 1) {
    const r = layer.reflectance[channel];
    const t = layer.transmittance[channel];
    const bg = background[channel];
    const denom = 1 - r * bg;
    out[channel] = r + (t * t * bg) / (denom > 1e-6 ? denom : 1e-6);
  }
  return out;
}

/**
 * Curtis §5.2: "the S and K coefficients of each pigment k are weighted in proportion to that
 * pigment's relative thickness x_k. The overall thickness x is the sum."
 */
export function studioWetInkBMixed(
  pigments: readonly Readonly<StudioWetInkBPigment>[],
  thicknesses: readonly number[],
): Readonly<StudioWetInkBLayer> & { readonly thickness: number } {
  let x = 0;
  for (const t of thicknesses) x += t;
  if (!(x > 0)) {
    return Object.freeze({
      reflectance: [0, 0, 0] as readonly [number, number, number],
      transmittance: [1, 1, 1] as readonly [number, number, number],
      thickness: 0,
    });
  }
  const K: [number, number, number] = [0, 0, 0];
  const S: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < pigments.length; i += 1) {
    const weight = thicknesses[i] / x;
    for (let channel = 0; channel < 3; channel += 1) {
      K[channel] += weight * pigments[i].K[channel];
      S[channel] += weight * pigments[i].S[channel];
    }
  }
  return Object.freeze({ ...studioWetInkBLayer(K, S, x), thickness: x });
}

/** Linear reflectance to an 8-bit sRGB code value. */
export function studioWetInkBSrgb8(linear: number): number {
  const c = linear <= 0 ? 0 : linear >= 1 ? 1 : linear;
  const encoded = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(255 * encoded);
}

export interface StudioWetInkBRenderOptions {
  /** Background reflectance, per linear-RGB channel. White paper is `[1,1,1]`. */
  readonly background?: readonly [number, number, number];
}

/**
 * Renders a thickness field to RGBA8.
 *
 * Alpha is the *coverage* implied by the pigment layer rather than a painted constant, so a cell
 * with `x = 0` is fully transparent. That is what makes the ragged drybrush silhouette visible
 * as a silhouette instead of as a pale wash.
 */
export function renderStudioWetInkBRgba8(
  thickness: Float32Array,
  pigment: Readonly<StudioWetInkBPigment>,
  options?: Readonly<StudioWetInkBRenderOptions>,
): Uint8ClampedArray {
  const background = options?.background ?? ([1, 1, 1] as const);
  const out = new Uint8ClampedArray(thickness.length * 4);
  for (let i = 0; i < thickness.length; i += 1) {
    const x = thickness[i];
    const layer = studioWetInkBLayer(pigment.K, pigment.S, x);
    const rgb = studioWetInkBOver(layer, background);
    out[i * 4] = studioWetInkBSrgb8(rgb[0]);
    out[i * 4 + 1] = studioWetInkBSrgb8(rgb[1]);
    out[i * 4 + 2] = studioWetInkBSrgb8(rgb[2]);
    // Opacity of the layer itself: 1 - mean transmittance.
    const meanT =
      (layer.transmittance[0] + layer.transmittance[1] + layer.transmittance[2]) / 3;
    out[i * 4 + 3] = Math.round(255 * Math.max(0, Math.min(1, 1 - meanT)));
  }
  return out;
}
