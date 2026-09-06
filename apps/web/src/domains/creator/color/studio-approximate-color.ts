/**
 * studio-approximate-color.ts
 *
 * Mathematical engine for Clip Studio Paint Approximate Color Palette (근사색 팔레트).
 * Generates neighboring swatches around a reference color by systematically varying
 * Hue (H), Saturation (S), and Value/Luminance (V) across 1D and 2D matrices.
 */

export type ApproximateColorMode = "sat-val" | "hue-val" | "hue-sat" | "val-only";

export interface ApproximateColorOptions {
  readonly mode: ApproximateColorMode;
  readonly steps: 5 | 7;
  readonly deltaPercent: number; // e.g. 5 means 5% change per step
}

export const DEFAULT_APPROXIMATE_COLOR_OPTIONS: ApproximateColorOptions = Object.freeze({
  mode: "sat-val",
  steps: 5,
  deltaPercent: 6,
});

/** RGB [0..255] to HSV [H 0..360, S 0..1, V 0..1] */
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const normR = r / 255;
  const normG = g / 255;
  const normB = b / 255;

  const max = Math.max(normR, normG, normB);
  const min = Math.min(normR, normG, normB);
  const delta = max - min;

  let h = 0;
  if (delta > 0) {
    if (max === normR) {
      h = 60 * (((normG - normB) / delta) % 6);
    } else if (max === normG) {
      h = 60 * ((normB - normR) / delta + 2);
    } else {
      h = 60 * ((normR - normG) / delta + 4);
    }
  }
  if (h < 0) h += 360;

  const s = max === 0 ? 0 : delta / max;
  const v = max;

  return [h, s, v];
}

/** HSV [H 0..360, S 0..1, V 0..1] to RGB [0..255] */
export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const safeH = ((h % 360) + 360) % 360;
  const safeS = Math.max(0, Math.min(1, s));
  const safeV = Math.max(0, Math.min(1, v));

  const c = safeV * safeS;
  const x = c * (1 - Math.abs(((safeH / 60) % 2) - 1));
  const m = safeV - c;

  let rPrime = 0;
  let gPrime = 0;
  let bPrime = 0;

  if (safeH < 60) {
    rPrime = c;
    gPrime = x;
  } else if (safeH < 120) {
    rPrime = x;
    gPrime = c;
  } else if (safeH < 180) {
    gPrime = c;
    bPrime = x;
  } else if (safeH < 240) {
    gPrime = x;
    bPrime = c;
  } else if (safeH < 300) {
    rPrime = x;
    bPrime = c;
  } else {
    rPrime = c;
    bPrime = x;
  }

  return [
    Math.round((rPrime + m) * 255),
    Math.round((gPrime + m) * 255),
    Math.round((bPrime + m) * 255),
  ];
}

export function hexToRgb(hex: string): [number, number, number] {
  let cleaned = hex.trim().replace(/^#/u, "");
  if (cleaned.length === 3) {
    cleaned = cleaned
      .split("")
      .map((char) => char + char)
      .join("");
  }
  if (cleaned.length !== 6) return [128, 128, 128];
  const num = parseInt(cleaned, 16);
  if (Number.isNaN(num)) return [128, 128, 128];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (v: number) => clamp(v).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Generates an NxN matrix of approximate colors around the center color.
 * The center tile at Math.floor(steps / 2) is guaranteed to equal the input color.
 */
export function generateApproximateColorGrid(
  centerHex: string,
  options: ApproximateColorOptions = DEFAULT_APPROXIMATE_COLOR_OPTIONS,
): readonly (readonly string[])[] {
  const [r, g, b] = hexToRgb(centerHex);
  const [baseH, baseS, baseV] = rgbToHsv(r, g, b);

  const size = options.steps;
  const half = Math.floor(size / 2);
  const deltaFactor = options.deltaPercent / 100;

  const rows: (readonly string[])[] = [];

  for (let row = 0; row < size; row++) {
    // vertical offset from center: -half .. +half
    const offsetY = row - half;
    const currentRow: string[] = [];

    for (let col = 0; col < size; col++) {
      // horizontal offset from center: -half .. +half
      const offsetX = col - half;

      let nextH = baseH;
      let nextS = baseS;
      let nextV = baseV;

      if (options.mode === "sat-val") {
        // X = Saturation (+ right, - left), Y = Value (- down, + up)
        nextS = Math.max(0, Math.min(1, baseS + offsetX * deltaFactor));
        nextV = Math.max(0, Math.min(1, baseV - offsetY * deltaFactor));
      } else if (options.mode === "hue-val") {
        // X = Hue (+ right, - left), Y = Value (- down, + up)
        nextH = (baseH + offsetX * (options.deltaPercent * 2) + 360) % 360;
        nextV = Math.max(0, Math.min(1, baseV - offsetY * deltaFactor));
      } else if (options.mode === "hue-sat") {
        // X = Hue, Y = Saturation
        nextH = (baseH + offsetX * (options.deltaPercent * 2) + 360) % 360;
        nextS = Math.max(0, Math.min(1, baseS - offsetY * deltaFactor));
      } else if (options.mode === "val-only") {
        // Horizontal ladder of value/brightness
        nextV = Math.max(0, Math.min(1, baseV + offsetX * deltaFactor));
      }

      const [cellR, cellG, cellB] = hsvToRgb(nextH, nextS, nextV);
      currentRow.push(rgbToHex(cellR, cellG, cellB));
    }

    rows.push(Object.freeze(currentRow));
  }

  return Object.freeze(rows);
}
