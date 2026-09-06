/**
 * studio-color-harmony-engine.ts
 *
 * Professional Color Harmony, Webtoon Cel-Shading & Color Science Engine.
 * Benchmarks: Clip Studio Paint, Procreate, Adobe Color, Photoshop, Coolors, and Naver Webtoon AI Painter.
 *
 * Pure TypeScript module — zero DOM/Konva dependencies, deterministic, fully unit-tested.
 */

import { normalizeHexColor } from "./studio-color-utils";

export interface RgbColor {
  readonly r: number; // 0..255
  readonly g: number; // 0..255
  readonly b: number; // 0..255
}

export interface HslColor {
  readonly h: number; // 0..360 (degrees)
  readonly s: number; // 0..100 (percentage)
  readonly l: number; // 0..100 (percentage)
}

export interface HsvColor {
  readonly h: number; // 0..360 (degrees)
  readonly s: number; // 0..100 (percentage)
  readonly v: number; // 0..100 (percentage, also Brightness)
}

export interface CmykColor {
  readonly c: number; // 0..100
  readonly m: number; // 0..100
  readonly y: number; // 0..100
  readonly k: number; // 0..100
}

export type HarmonyMode =
  | "complementary"
  | "analogous"
  | "triadic"
  | "split-complementary"
  | "tetradic"
  | "monochromatic";

export interface HarmonyPalette {
  readonly mode: HarmonyMode;
  readonly label: string;
  readonly description: string;
  readonly colors: readonly string[];
}

export interface WebtoonCelShadeResult {
  readonly highlight: string; // Warm light / specular highlight (-10° hue, +light, -sat)
  readonly base: string; // Original base color
  readonly celShadow1: string; // 1st cel shadow (+25° cool shift, +sat, -light)
  readonly celShadow2: string; // 2nd deep shadow (+40° deep shift, +sat, -light)
  readonly blushTint: string; // Vitality / peach / skin flush tint
  readonly rimLight: string; // Luminous rim light (contrast pop)
}

export interface ContrastAudit {
  readonly ratioOnWhite: number;
  readonly ratioOnBlack: number;
  readonly aaOnWhite: boolean;
  readonly aaaOnWhite: boolean;
  readonly aaOnBlack: boolean;
  readonly aaaOnBlack: boolean;
  readonly bestForeground: "#ffffff" | "#000000";
}

/* =====================================================================
 * 1. Base Math & Color Conversions
 * ===================================================================== */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function hexToRgb(rawHex: string): RgbColor {
  const hex = normalizeHexColor(rawHex) ?? "#000000";
  const num = parseInt(hex.slice(1), 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const cr = clamp(Math.round(r), 0, 255);
  const cg = clamp(Math.round(g), 0, 255);
  const cb = clamp(Math.round(b), 0, 255);
  return `#${((1 << 24) + (cr << 16) + (cg << 8) + cb).toString(16).slice(1)}`;
}

export function rgbToHsv(r: number, g: number, b: number): HsvColor {
  const nr = clamp(r, 0, 255) / 255;
  const ng = clamp(g, 0, 255) / 255;
  const nb = clamp(b, 0, 255) / 255;

  const max = Math.max(nr, ng, nb);
  const min = Math.min(nr, ng, nb);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === nr) {
      h = ((ng - nb) / delta + (ng < nb ? 6 : 0)) * 60;
    } else if (max === ng) {
      h = ((nb - nr) / delta + 2) * 60;
    } else {
      h = ((nr - ng) / delta + 4) * 60;
    }
  }

  const s = max === 0 ? 0 : (delta / max) * 100;
  const v = max * 100;

  return {
    h: round((h + 360) % 360, 1),
    s: round(s, 1),
    v: round(v, 1),
  };
}

export function hsvToRgb(h: number, s: number, v: number): RgbColor {
  const nh = ((h % 360) + 360) % 360;
  const ns = clamp(s, 0, 100) / 100;
  const nv = clamp(v, 0, 100) / 100;

  const c = nv * ns;
  const x = c * (1 - Math.abs(((nh / 60) % 2) - 1));
  const m = nv - c;

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (nh < 60) {
    r1 = c;
    g1 = x;
  } else if (nh < 120) {
    r1 = x;
    g1 = c;
  } else if (nh < 180) {
    g1 = c;
    b1 = x;
  } else if (nh < 240) {
    g1 = x;
    b1 = c;
  } else if (nh < 300) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }

  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

export function hsvToHex(h: number, s: number, v: number): string {
  const rgb = hsvToRgb(h, s, v);
  return rgbToHex(rgb.r, rgb.g, rgb.b);
}

export function hexToHsv(rawHex: string): HsvColor {
  const rgb = hexToRgb(rawHex);
  return rgbToHsv(rgb.r, rgb.g, rgb.b);
}

export function rgbToHsl(r: number, g: number, b: number): HslColor {
  const nr = clamp(r, 0, 255) / 255;
  const ng = clamp(g, 0, 255) / 255;
  const nb = clamp(b, 0, 255) / 255;

  const max = Math.max(nr, ng, nb);
  const min = Math.min(nr, ng, nb);
  const delta = max - min;
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;

  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    if (max === nr) {
      h = ((ng - nb) / delta + (ng < nb ? 6 : 0)) * 60;
    } else if (max === ng) {
      h = ((nb - nr) / delta + 2) * 60;
    } else {
      h = ((nr - ng) / delta + 4) * 60;
    }
  }

  return {
    h: round((h + 360) % 360, 1),
    s: round(s * 100, 1),
    l: round(l * 100, 1),
  };
}

export function hslToRgb(h: number, s: number, l: number): RgbColor {
  const nh = ((h % 360) + 360) % 360;
  const ns = clamp(s, 0, 100) / 100;
  const nl = clamp(l, 0, 100) / 100;

  if (ns === 0) {
    const val = Math.round(nl * 255);
    return { r: val, g: val, b: val };
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    let tc = t;
    if (tc < 0) tc += 1;
    if (tc > 1) tc -= 1;
    if (tc < 1 / 6) return p + (q - p) * 6 * tc;
    if (tc < 1 / 2) return q;
    if (tc < 2 / 3) return p + (q - p) * (2 / 3 - tc) * 6;
    return p;
  };

  const q = nl < 0.5 ? nl * (1 + ns) : nl + ns - nl * ns;
  const p = 2 * nl - q;
  const hn = nh / 360;

  return {
    r: Math.round(hue2rgb(p, q, hn + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, hn) * 255),
    b: Math.round(hue2rgb(p, q, hn - 1 / 3) * 255),
  };
}

export function hslToHex(h: number, s: number, l: number): string {
  const rgb = hslToRgb(h, s, l);
  return rgbToHex(rgb.r, rgb.g, rgb.b);
}

export function hexToHsl(rawHex: string): HslColor {
  const rgb = hexToRgb(rawHex);
  return rgbToHsl(rgb.r, rgb.g, rgb.b);
}

export function rgbToCmyk(r: number, g: number, b: number): CmykColor {
  const nr = clamp(r, 0, 255) / 255;
  const ng = clamp(g, 0, 255) / 255;
  const nb = clamp(b, 0, 255) / 255;

  const k = 1 - Math.max(nr, ng, nb);
  if (k >= 1) {
    return { c: 0, m: 0, y: 0, k: 100 };
  }

  const c = ((1 - nr - k) / (1 - k)) * 100;
  const m = ((1 - ng - k) / (1 - k)) * 100;
  const y = ((1 - nb - k) / (1 - k)) * 100;

  return {
    c: round(c),
    m: round(m),
    y: round(y),
    k: round(k * 100),
  };
}

export function cmykToRgb(c: number, m: number, y: number, k: number): RgbColor {
  const nc = clamp(c, 0, 100) / 100;
  const nm = clamp(m, 0, 100) / 100;
  const ny = clamp(y, 0, 100) / 100;
  const nk = clamp(k, 0, 100) / 100;

  return {
    r: Math.round(255 * (1 - nc) * (1 - nk)),
    g: Math.round(255 * (1 - nm) * (1 - nk)),
    b: Math.round(255 * (1 - ny) * (1 - nk)),
  };
}

/* =====================================================================
 * 2. Color Harmonies (Adobe Color / Procreate Parity)
 * ===================================================================== */

function offsetHue(h: number, degrees: number): number {
  return ((h + degrees) % 360 + 360) % 360;
}

export function getComplementary(rawHex: string): string[] {
  const hsv = hexToHsv(rawHex);
  const base = normalizeHexColor(rawHex) ?? rawHex;
  const comp = hsvToHex(offsetHue(hsv.h, 180), hsv.s, hsv.v);
  return [base, comp];
}

export function getAnalogous(rawHex: string, angle = 30): string[] {
  const hsv = hexToHsv(rawHex);
  const base = normalizeHexColor(rawHex) ?? rawHex;
  const left = hsvToHex(offsetHue(hsv.h, -angle), hsv.s, hsv.v);
  const right = hsvToHex(offsetHue(hsv.h, angle), hsv.s, hsv.v);
  return [left, base, right];
}

export function getTriadic(rawHex: string): string[] {
  const hsv = hexToHsv(rawHex);
  const base = normalizeHexColor(rawHex) ?? rawHex;
  const t1 = hsvToHex(offsetHue(hsv.h, 120), hsv.s, hsv.v);
  const t2 = hsvToHex(offsetHue(hsv.h, 240), hsv.s, hsv.v);
  return [base, t1, t2];
}

export function getSplitComplementary(rawHex: string, angle = 150): string[] {
  const hsv = hexToHsv(rawHex);
  const base = normalizeHexColor(rawHex) ?? rawHex;
  const s1 = hsvToHex(offsetHue(hsv.h, angle), hsv.s, hsv.v);
  const s2 = hsvToHex(offsetHue(hsv.h, 360 - angle), hsv.s, hsv.v);
  return [base, s1, s2];
}

export function getTetradic(rawHex: string): string[] {
  const hsv = hexToHsv(rawHex);
  const base = normalizeHexColor(rawHex) ?? rawHex;
  const c2 = hsvToHex(offsetHue(hsv.h, 90), hsv.s, hsv.v);
  const c3 = hsvToHex(offsetHue(hsv.h, 180), hsv.s, hsv.v);
  const c4 = hsvToHex(offsetHue(hsv.h, 270), hsv.s, hsv.v);
  return [base, c2, c3, c4];
}

export function getMonochromatic(rawHex: string): string[] {
  const hsv = hexToHsv(rawHex);
  const base = normalizeHexColor(rawHex) ?? rawHex;
  const c1 = hsvToHex(hsv.h, clamp(hsv.s * 0.45, 10, 100), clamp(hsv.v * 1.3, 0, 100));
  const c2 = hsvToHex(hsv.h, clamp(hsv.s * 0.75, 15, 100), clamp(hsv.v * 1.15, 0, 100));
  const c4 = hsvToHex(hsv.h, clamp(hsv.s * 1.15, 0, 100), clamp(hsv.v * 0.75, 10, 100));
  const c5 = hsvToHex(hsv.h, clamp(hsv.s * 1.25, 0, 100), clamp(hsv.v * 0.45, 8, 100));
  return [c1, c2, base, c4, c5];
}

export function getAllHarmonies(rawHex: string): readonly HarmonyPalette[] {
  return [
    {
      mode: "complementary",
      label: "보색 (Complementary)",
      description: "180도 반대편 색으로 선명한 대비와 강렬한 시선 집중 효과",
      colors: getComplementary(rawHex),
    },
    {
      mode: "analogous",
      label: "유사색 (Analogous)",
      description: "인접한 30도 각도의 색들로 편안하고 조화로운 배경 연출",
      colors: getAnalogous(rawHex),
    },
    {
      mode: "triadic",
      label: "3색 조화 (Triadic)",
      description: "120도 간격의 세 색상으로 다채롭고 균형 잡힌 웹툰 메인 컬러",
      colors: getTriadic(rawHex),
    },
    {
      mode: "split-complementary",
      label: "분할 보색 (Split)",
      description: "보색 양옆의 색을 취해 강렬하면서도 덜 공격적인 세련된 배색",
      colors: getSplitComplementary(rawHex),
    },
    {
      mode: "tetradic",
      label: "4색 조화 (Tetradic)",
      description: "90도 간격 4색으로 풍부한 판타지·축제 장면에 어울리는 배색",
      colors: getTetradic(rawHex),
    },
    {
      mode: "monochromatic",
      label: "단색 명도변형 (Mono)",
      description: "동일 색상에서 채도와 명도만 조절한 통일감 높은 톤온톤 배색",
      colors: getMonochromatic(rawHex),
    },
  ];
}

/* =====================================================================
 * 3. Webtoon Cel-Shading & Hue-Shift Generator (Anti-Muddy Shadow)
 * ===================================================================== */

/**
 * Generates production-grade comic hue-shifted shadows and highlights.
 * Prevents muddy dirty gray by rotating hue toward cool tones (indigo/purple),
 * increasing saturation, and lowering value.
 */
export function generateWebtoonCelShading(rawHex: string): WebtoonCelShadeResult {
  const base = normalizeHexColor(rawHex) ?? rawHex;
  const rgb = hexToRgb(base);
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);

  // 1st Cel Shadow (+25° hue shift toward cool tones, +12% sat, -24% light)
  const h1 = (hsl.h + 25) % 360;
  const s1 = clamp(hsl.s * 1.15, 15, 100);
  const l1 = clamp(hsl.l * 0.74, 12, 90);
  const celShadow1 = hslToHex(h1, s1, l1);

  // 2nd Deep Shadow (+42° deep shift, +22% sat, -48% light)
  const h2 = (hsl.h + 42) % 360;
  const s2 = clamp(hsl.s * 1.25, 20, 100);
  const l2 = clamp(hsl.l * 0.5, 6, 75);
  const celShadow2 = hslToHex(h2, s2, l2);

  // Highlight (Warm sunlight shift: -12° hue, -25% sat, +26% light)
  const hh = (hsl.h - 12 + 360) % 360;
  const sh = clamp(hsl.s * 0.75, 5, 95);
  const lh = clamp(hsl.l * 1.22 + 10, 20, 98);
  const highlight = hslToHex(hh, sh, lh);

  // Blush / flush tint (shift towards crimson-peach ~350-15° hue)
  const hb = offsetHue(hsl.h, (355 - hsl.h) * 0.35);
  const sb = clamp(hsl.s * 1.3 + 10, 30, 95);
  const lb = clamp(hsl.l * 0.95, 25, 85);
  const blushTint = hslToHex(hb, sb, lb);

  // Luminous rim light (high-value complementary backlight)
  const hr = offsetHue(hsl.h, 160);
  const sr = clamp(hsl.s * 0.6, 20, 80);
  const lr = clamp(hsl.l * 1.35 + 15, 60, 98);
  const rimLight = hslToHex(hr, sr, lr);

  return {
    highlight,
    base,
    celShadow1,
    celShadow2,
    blushTint,
    rimLight,
  };
}

/* =====================================================================
 * 4. Tints, Shades & Tones Gradation Generator
 * ===================================================================== */

/**
 * Generates an odd-numbered step progression (default 9 steps):
 * Tints (mixed with white) -> Base Color -> Shades (mixed with black).
 */
export function getTintsAndShades(rawHex: string, steps = 9): string[] {
  const base = normalizeHexColor(rawHex) ?? rawHex;
  const rgb = hexToRgb(base);
  const half = Math.floor(steps / 2);
  const results: string[] = [];

  // Tints (interpolated with white 255,255,255)
  for (let i = half; i >= 1; i--) {
    const factor = i / (half + 1);
    const r = Math.round(rgb.r + (255 - rgb.r) * factor);
    const g = Math.round(rgb.g + (255 - rgb.g) * factor);
    const b = Math.round(rgb.b + (255 - rgb.b) * factor);
    results.push(rgbToHex(r, g, b));
  }

  // Base
  results.push(base);

  // Shades (interpolated with black 0,0,0)
  for (let i = 1; i <= half; i++) {
    const factor = 1 - i / (half + 1);
    const r = Math.round(rgb.r * factor);
    const g = Math.round(rgb.g * factor);
    const b = Math.round(rgb.b * factor);
    results.push(rgbToHex(r, g, b));
  }

  return results;
}

/* =====================================================================
 * 5. Contrast & WCAG 2.1 Readability
 * ===================================================================== */

export function getRelativeLuminance(r: number, g: number, b: number): number {
  const toLinear = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function calculateContrastRatio(hex1: string, hex2: string): number {
  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);
  const lum1 = getRelativeLuminance(rgb1.r, rgb1.g, rgb1.b);
  const lum2 = getRelativeLuminance(rgb2.r, rgb2.g, rgb2.b);
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return round((lighter + 0.05) / (darker + 0.05), 2);
}

export function auditContrast(rawHex: string): ContrastAudit {
  const hex = normalizeHexColor(rawHex) ?? rawHex;
  const ratioOnWhite = calculateContrastRatio(hex, "#ffffff");
  const ratioOnBlack = calculateContrastRatio(hex, "#000000");

  return {
    ratioOnWhite,
    ratioOnBlack,
    aaOnWhite: ratioOnWhite >= 4.5,
    aaaOnWhite: ratioOnWhite >= 7.0,
    aaOnBlack: ratioOnBlack >= 4.5,
    aaaOnBlack: ratioOnBlack >= 7.0,
    bestForeground: ratioOnBlack > ratioOnWhite ? "#000000" : "#ffffff",
  };
}

/* =====================================================================
 * 6. Visual Human Color Naming Dictionary
 * ===================================================================== */

export function getFriendlyColorName(rawHex: string): string {
  const hex = normalizeHexColor(rawHex) ?? rawHex;
  const rgb = hexToRgb(hex);
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);

  if (hsv.v <= 12) return "옵시디언 블랙 (Obsidian Black)";
  if (hsv.s <= 8 && hsv.v >= 90) return "퓨어 화이트 (Pure White)";
  if (hsv.s <= 10) {
    if (hsv.v >= 70) return "라이트 그레이 (Light Gray)";
    if (hsv.v >= 40) return "미디엄 그레이 (Medium Gray)";
    return "차콜 다크그레이 (Charcoal Gray)";
  }

  const h = hsv.h;
  const s = hsv.s;
  const v = hsv.v;

  if (h >= 350 || h < 12) {
    if (v < 50) return "버건디 와인 (Burgundy Wine)";
    if (s < 50) return "로즈 핑크 (Rose Pink)";
    return "크림슨 레드 (Crimson Red)";
  }
  if (h < 35) {
    if (s < 45 && v > 75) return "피치 베이지 (Peach Beige)";
    if (v < 50) return "브릭 테라코타 (Terracotta)";
    return "선셋 코랄 (Sunset Coral)";
  }
  if (h < 55) {
    if (s < 40 && v > 80) return "웜 아이보리 (Warm Ivory)";
    if (v < 50) return "초콜릿 브라운 (Chocolate Brown)";
    return "골든 앰버 (Golden Amber)";
  }
  if (h < 75) {
    if (s < 45) return "파스텔 레몬 (Pastel Lemon)";
    return "비비드 옐로우 (Vivid Yellow)";
  }
  if (h < 165) {
    if (v < 40) return "딥 포레스트 (Deep Forest)";
    if (s < 45) return "민트 세이지 (Mint Sage)";
    return "에메랄드 그린 (Emerald Green)";
  }
  if (h < 195) {
    if (s < 40) return "소프트 아쿠아 (Soft Aqua)";
    return "청록 틸 그린 (Teal Green)";
  }
  if (h < 225) {
    if (v < 40) return "미드나잇 네이비 (Midnight Navy)";
    if (s < 45) return "스카이 블루 (Sky Blue)";
    return "오션 블루 (Ocean Blue)";
  }
  if (h < 265) {
    if (v < 40) return "다크 인디고 (Dark Indigo)";
    return "코발트 블루 (Cobalt Blue)";
  }
  if (h < 300) {
    if (s < 45) return "라벤더 퍼플 (Lavender Purple)";
    return "로열 바이올렛 (Royal Violet)";
  }
  if (h < 330) {
    if (v < 45) return "딥 플럼 (Deep Plum)";
    return "마젠타 오키드 (Magenta Orchid)";
  }
  return "체리 블라썸 (Cherry Blossom)";
}
