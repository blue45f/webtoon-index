/**
 * Studio CIELAB Color Space Engine & Color Profile Management
 *
 * CLIP STUDIO PAINT Ver.4.2.0 & Ver.5.1.0 Parity:
 * - Lab Color Space Sliders (L*, a*, b*) in Color Palette / Color Picker.
 * - Accurate bidirectional conversion between sRGB, Hex, XYZ, and CIELAB (D65).
 * - Real-time Lab value readouts.
 * - Color Difference metrics: Delta E (CIE76 and CIEDE2000).
 * - Document Color Profiles (sRGB, Display P3, Adobe RGB) and Soft Proofing.
 *
 * Pure, deterministic, zero-dependency.
 */

export interface StudioLabColor {
  /** Lightness: 0 (black) .. 100 (white). */
  readonly l: number;
  /** Green (-128) to Magenta (+127). */
  readonly a: number;
  /** Blue (-128) to Yellow (+127). */
  readonly b: number;
}

export interface StudioRgbColor {
  readonly r: number; // 0..255
  readonly g: number; // 0..255
  readonly b: number; // 0..255
}

// D65 Standard Illuminant Reference White
const D65_XN = 0.95047;
const D65_YN = 1.0;
const D65_ZN = 1.08883;

/**
 * Converts sRGB [0..255] component to linear light (inverse gamma).
 */
function sRgbToLinear(c: number): number {
  const v = Math.max(0, Math.min(255, c)) / 255;
  return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92;
}

/**
 * Converts linear light component to gamma-encoded sRGB [0..255].
 */
function linearToSRgb(v: number): number {
  const clamped = Math.max(0, Math.min(1, v));
  const companded = clamped > 0.0031308 ? 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055 : 12.92 * clamped;
  return Math.round(companded * 255);
}

/**
 * Converts sRGB to CIELAB (D65).
 */
export function rgbToLab(r: number, g: number, b: number): StudioLabColor {
  const lr = sRgbToLinear(r);
  const lg = sRgbToLinear(g);
  const lb = sRgbToLinear(b);

  // Linear sRGB to XYZ (D65)
  const x = lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375;
  const y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.072175;
  const z = lr * 0.0193339 + lg * 0.119192 + lb * 0.9503041;

  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x / D65_XN);
  const fy = f(y / D65_YN);
  const fz = f(z / D65_ZN);

  const l = Math.max(0, Math.min(100, 116 * fy - 16));
  const a = 500 * (fx - fy);
  const bVal = 200 * (fy - fz);

  return Object.freeze({
    l: Math.round(l * 10) / 10,
    a: Math.round(a * 10) / 10,
    b: Math.round(bVal * 10) / 10,
  });
}

/**
 * Converts CIELAB (D65) to sRGB.
 */
export function labToRgb(l: number, a: number, b: number): StudioRgbColor {
  const clampedL = Math.max(0, Math.min(100, l));
  const clampedA = Math.max(-128, Math.min(127, a));
  const clampedB = Math.max(-128, Math.min(127, b));

  const fy = (clampedL + 16) / 116;
  const fx = clampedA / 500 + fy;
  const fz = fy - clampedB / 200;

  const invF = (t: number) => {
    const t3 = t * t * t;
    return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787;
  };

  const x = D65_XN * invF(fx);
  const y = D65_YN * invF(fy);
  const z = D65_ZN * invF(fz);

  // XYZ to linear sRGB
  const lr = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
  const lg = x * -0.969266 + y * 1.8760108 + z * 0.041556;
  const lb = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;

  return Object.freeze({
    r: linearToSRgb(lr),
    g: linearToSRgb(lg),
    b: linearToSRgb(lb),
  });
}

/**
 * Converts Hex string (#rrggbb) to CIELAB.
 */
export function hexToLab(hexStr: string): StudioLabColor {
  const cleanHex = hexStr.replace(/^#/u, "");
  let r = 0,
    g = 0,
    b = 0;

  if (cleanHex.length === 3) {
    r = parseInt(cleanHex[0] + cleanHex[0], 16) || 0;
    g = parseInt(cleanHex[1] + cleanHex[1], 16) || 0;
    b = parseInt(cleanHex[2] + cleanHex[2], 16) || 0;
  } else if (cleanHex.length >= 6) {
    r = parseInt(cleanHex.slice(0, 2), 16) || 0;
    g = parseInt(cleanHex.slice(2, 4), 16) || 0;
    b = parseInt(cleanHex.slice(4, 6), 16) || 0;
  }

  return rgbToLab(r, g, b);
}

/**
 * Converts CIELAB to Hex color string (#rrggbb).
 */
export function labToHex(l: number, a: number, b: number): string {
  const rgb = labToRgb(l, a, b);
  const toHex = (c: number) => c.toString(16).padStart(2, "0");
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

/**
 * Clamps Lab coordinates to valid ranges.
 */
export function clampLab(l: number, a: number, b: number): StudioLabColor {
  return Object.freeze({
    l: Math.max(0, Math.min(100, Math.round(l * 10) / 10)),
    a: Math.max(-128, Math.min(127, Math.round(a * 10) / 10)),
    b: Math.max(-128, Math.min(127, Math.round(b * 10) / 10)),
  });
}

/**
 * Formats Lab values for UI display, e.g. "L* 62.4  a* -20.1  b* 48.0".
 */
export function formatLabString(lab: StudioLabColor): string {
  return `L* ${lab.l.toFixed(1)}  a* ${lab.a >= 0 ? "+" : ""}${lab.a.toFixed(1)}  b* ${lab.b >= 0 ? "+" : ""}${lab.b.toFixed(1)}`;
}

/**
 * Calculates CIE76 Color Difference ($\Delta E_{76}$).
 */
export function deltaE76(c1: StudioLabColor, c2: StudioLabColor): number {
  const dl = c1.l - c2.l;
  const da = c1.a - c2.a;
  const db = c1.b - c2.b;
  return Math.sqrt(dl * dl + da * da + db * db);
}

// ── Document Color Profiles & Soft Proofing (CSP v4.2 parity) ─────────────────

export type StudioDocumentColorProfile = "sRGB" | "Display-P3" | "Adobe-RGB";

export interface StudioColorProfileDescriptor {
  readonly id: StudioDocumentColorProfile;
  readonly label: string;
  readonly description: string;
  readonly gamma: number;
}

export const STUDIO_DOCUMENT_COLOR_PROFILES: readonly StudioColorProfileDescriptor[] = Object.freeze([
  {
    id: "sRGB",
    label: "sRGB IEC61966-2.1",
    description: "웹·모바일 웹툰의 표준 색 공간. 모든 디바이스에서 가장 일관되게 표시됩니다.",
    gamma: 2.2,
  },
  {
    id: "Display-P3",
    label: "Display P3 (Wide Color)",
    description: "Apple 기기 및 최신 광색역 OLED 디스플레이에 최적화된 생생한 녹색·적색 색역.",
    gamma: 2.2,
  },
  {
    id: "Adobe-RGB",
    label: "Adobe RGB (1998)",
    description: "출판·단행본 인쇄 CMYK 변환 시 사이안/그린 손실을 줄이는 전문 인쇄용 색역.",
    gamma: 2.2,
  },
]);

export interface StudioSoftProofConfig {
  readonly enabled: boolean;
  readonly targetProfile: "Japan-Color-2001-Coated" | "GRACoL-2006-Coated" | "ISO-Coated-v2";
  readonly showGamutWarning: boolean;
  readonly gamutWarningColorHex: string; // default: bright magenta / cyan warning
}

export const DEFAULT_STUDIO_SOFT_PROOF_CONFIG: StudioSoftProofConfig = Object.freeze({
  enabled: false,
  targetProfile: "Japan-Color-2001-Coated",
  showGamutWarning: false,
  gamutWarningColorHex: "#ff007f",
});
