/**
 * webtoon-color-harmony-assistant.ts
 *
 * Webtoon Skin Tone & Shadow Harmony Assistant.
 * Benchmarks Naver Webtoon AI Painter, Clip Studio Color Swatches, and professional webtoon coloring studios.
 *
 * - 5 archetypal webtoon character skin tone palettes (4 steps: Highlight, Base, 1st Cel Shadow, 2nd Deep Shadow).
 * - Algorithmic comic hue-shift shadow generator that travels toward a cool blue-violet target on the
 *   shortest color-wheel path instead of blindly adding hue degrees.
 * - 4 genre lighting mood color palettes (Romance Golden Sunset, Fresh Academy, Dark Noir, Cyberpunk Neon).
 */

export type SkinToneId =
  | "warm-fair" // 아이보리 웜톤 (주인공 표준)
  | "cool-pale" // 쿨톤 창백 (로판 남주/뱀파이어)
  | "blush-peach" // 생기 피치 홍조 (히로인/소녀)
  | "sun-kissed-tan" // 건강한 웜 베이지/구릿빛 태닝
  | "dark-rich"; // 딥 브라운 / 다크 엘프

export interface SkinTonePalette {
  readonly id: SkinToneId;
  readonly name: string;
  readonly description: string;
  readonly highlight: string;
  readonly base: string;
  readonly shadow1: string;
  readonly shadow2: string;
  readonly blushTint: string;
}

export interface SceneMoodPalette {
  readonly id: string;
  readonly name: string;
  readonly genre: string;
  readonly skyTint: string;
  readonly ambientLight: string;
  readonly directSun: string;
  readonly shadowCast: string;
  readonly rimLight: string;
}

export const WEBTOON_SKIN_PALETTES: Record<SkinToneId, SkinTonePalette> = {
  "warm-fair": {
    id: "warm-fair",
    name: "아이보리 웜톤 (주인공 표준)",
    description: "가장 널리 쓰이는 밝고 화사한 주인공 표준 살구빛 피부톤",
    highlight: "#fffbf5",
    base: "#ffedd5",
    shadow1: "#fbcfe8",
    shadow2: "#e0b0d5",
    blushTint: "#fb7185",
  },
  "cool-pale": {
    id: "cool-pale",
    name: "쿨톤 창백 (로판 남주/뱀파이어)",
    description: "로맨스 판타지 미남, 냉혹한 북부대공, 뱀파이어용 창백한 쿨톤",
    highlight: "#f8fafc",
    base: "#f1f5f9",
    shadow1: "#cbd5e1",
    shadow2: "#94a3b8",
    blushTint: "#f472b6",
  },
  "blush-peach": {
    id: "blush-peach",
    name: "생기 피치 홍조 (히로인/소녀)",
    description: "생기 넘치고 뺨에 자연스러운 붉은 기가 도는 청순 히로인 톤",
    highlight: "#fff1f2",
    base: "#ffe4e6",
    shadow1: "#fecdd3",
    shadow2: "#fda4af",
    blushTint: "#f43f5e",
  },
  "sun-kissed-tan": {
    id: "sun-kissed-tan",
    name: "건강한 구릿빛 태닝 (액션/스포츠)",
    description: "야외 훈련이나 햇살에 그을린 건강미 넘치는 스포츠·액션 캐릭터",
    highlight: "#fed7aa",
    base: "#f97316",
    shadow1: "#c2410c",
    shadow2: "#7c2d12",
    blushTint: "#ea580c",
  },
  "dark-rich": {
    id: "dark-rich",
    name: "딥 브라운 / 다크 엘프 (판타지)",
    description: "이국적인 매력이나 판타지 다크 엘프를 위한 깊고 윤기 있는 갈색톤",
    highlight: "#a8a29e",
    base: "#78716c",
    shadow1: "#44403c",
    shadow2: "#1c1917",
    blushTint: "#991b1b",
  },
};

export const SCENE_MOOD_PALETTES: readonly SceneMoodPalette[] = [
  {
    id: "romance-golden-sunset",
    name: "골든아워 노을 (로맨스 판타지)",
    genre: "로맨스 / 드라마",
    skyTint: "#fde047",
    ambientLight: "#fb923c",
    directSun: "#ffedd5",
    shadowCast: "#831843",
    rimLight: "#fef08a",
  },
  {
    id: "fresh-academy-sky",
    name: "청량한 대낮 햇살 (학원물)",
    genre: "학원물 / 일상",
    skyTint: "#38bdf8",
    ambientLight: "#bae6fd",
    directSun: "#ffffff",
    shadowCast: "#64748b",
    rimLight: "#e0f2fe",
  },
  {
    id: "dark-fantasy-noir",
    name: "다크 판타지 누아르 (액션/스릴러)",
    genre: "액션 / 스릴러",
    skyTint: "#0f172a",
    ambientLight: "#1e293b",
    directSun: "#64748b",
    shadowCast: "#020617",
    rimLight: "#38bdf8",
  },
  {
    id: "cyberpunk-neon-night",
    name: "사이버펑크 네온야경 (SF)",
    genre: "SF / 사이버펑크",
    skyTint: "#09090b",
    ambientLight: "#3b0764",
    directSun: "#f43f5e",
    shadowCast: "#18181b",
    rimLight: "#06b6d4",
  },
];

interface RgbColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

interface HslColor {
  readonly h: number;
  readonly s: number;
  readonly l: number;
}

const HEX_COLOR_PATTERN = /^#?([0-9a-f]{6})$/iu;
const COOL_SHADOW_TARGET_HUE = 265;
const WARM_HIGHLIGHT_TARGET_HUE = 45;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function shiftHueToward(sourceHue: number, targetHue: number, maxDegrees: number): number {
  const shortestDelta = ((targetHue - sourceHue + 540) % 360) - 180;
  const appliedDelta = clamp(shortestDelta, -maxDegrees, maxDegrees);
  return (sourceHue + appliedDelta + 360) % 360;
}

export class WebtoonColorHarmonyAssistant {
  public getSkinPalette(id: SkinToneId): SkinTonePalette {
    return WEBTOON_SKIN_PALETTES[id] ?? WEBTOON_SKIN_PALETTES["warm-fair"];
  }

  public getSceneMoodPalette(id: string): SceneMoodPalette | undefined {
    return SCENE_MOOD_PALETTES.find((palette) => palette.id === id);
  }

  /**
   * Generates a two-step comic shadow ramp and a warm highlight from a six-digit hex color.
   *
   * - Shadow hues move toward blue-violet on the shortest color-wheel path. A fixed `+25°` shift is
   *   not equivalent to "cooler": for red/orange it moves toward yellow and makes the result warmer.
   * - Near-neutral colors receive a small cool saturation floor so gray/white bases do not become
   *   muddy black overlays.
   * - Saturation is deliberately bounded. Very light skin bases often report HSL saturation near
   *   100%; carrying that value into darker shadows produces neon red, not a usable cel-shading ramp.
   * - Lightness ordering is deterministic: highlight >= base >= shadow1 >= shadow2, modulo 8-bit rounding.
   */
  public generateHueShiftShadow(baseHex: string): {
    shadow1: string;
    shadow2: string;
    highlight: string;
  } {
    const normalizedHex = this.normalizeHex(baseHex);
    const rgb = this.hexToRgb(normalizedHex);
    const hsl = this.rgbToHsl(rgb.r, rgb.g, rgb.b);

    // Hue is undefined for a true neutral. Anchor it near blue before applying the cool target.
    const meaningfulBaseHue = hsl.s < 0.02 ? 245 : hsl.h;
    const h1 = shiftHueToward(meaningfulBaseHue, COOL_SHADOW_TARGET_HUE, 45);
    const h2 = shiftHueToward(meaningfulBaseHue, COOL_SHADOW_TARGET_HUE, 65);
    const s1 = clamp(0.12 + hsl.s * 0.38, 0.14, 0.5);
    const s2 = clamp(0.18 + hsl.s * 0.32, 0.2, 0.52);
    const l1 = clamp(hsl.l * 0.86, 0, 0.88);
    const l2 = clamp(hsl.l * 0.68, 0, 0.72);

    const highlightBaseHue = hsl.s < 0.02 ? WARM_HIGHLIGHT_TARGET_HUE : hsl.h;
    const hh = shiftHueToward(highlightBaseHue, WARM_HIGHLIGHT_TARGET_HUE, 12);
    const sh = clamp(Math.max(0.04, hsl.s * 0.7), 0, 1);
    const lh = clamp(hsl.l * 1.2 + 0.08, hsl.l, 0.99);

    const rgb1 = this.hslToRgb(h1, s1, l1);
    const rgb2 = this.hslToRgb(h2, s2, l2);
    const rgbHighlight = this.hslToRgb(hh, sh, lh);

    return {
      shadow1: this.rgbToHex(rgb1.r, rgb1.g, rgb1.b),
      shadow2: this.rgbToHex(rgb2.r, rgb2.g, rgb2.b),
      highlight:
        hsl.l >= 0.985
          ? normalizedHex
          : this.rgbToHex(rgbHighlight.r, rgbHighlight.g, rgbHighlight.b),
    };
  }

  private normalizeHex(hex: string): string {
    const match = HEX_COLOR_PATTERN.exec(hex.trim());
    if (!match?.[1]) {
      throw new RangeError("색상은 #RRGGBB 형식의 6자리 HEX여야 합니다.");
    }
    return `#${match[1].toLowerCase()}`;
  }

  private hexToRgb(hex: string): RgbColor {
    const parsed = Number.parseInt(hex.slice(1), 16);
    return {
      r: (parsed >> 16) & 255,
      g: (parsed >> 8) & 255,
      b: parsed & 255,
    };
  }

  private rgbToHex(r: number, g: number, b: number): string {
    const packed = (1 << 24) + (r << 16) + (g << 8) + b;
    return `#${packed.toString(16).slice(1)}`;
  }

  private rgbToHsl(r: number, g: number, b: number): HslColor {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
      const delta = max - min;
      s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
      switch (max) {
        case rn:
          h = (gn - bn) / delta + (gn < bn ? 6 : 0);
          break;
        case gn:
          h = (bn - rn) / delta + 2;
          break;
        case bn:
          h = (rn - gn) / delta + 4;
          break;
      }
      h *= 60;
    }

    return { h, s, l };
  }

  private hslToRgb(h: number, s: number, l: number): RgbColor {
    let r: number;
    let g: number;
    let b: number;

    if (s === 0) {
      r = g = b = l;
    } else {
      const hueToRgb = (p: number, q: number, t: number): number => {
        let adjusted = t;
        if (adjusted < 0) adjusted += 1;
        if (adjusted > 1) adjusted -= 1;
        if (adjusted < 1 / 6) return p + (q - p) * 6 * adjusted;
        if (adjusted < 1 / 2) return q;
        if (adjusted < 2 / 3) return p + (q - p) * (2 / 3 - adjusted) * 6;
        return p;
      };

      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      const normalizedHue = h / 360;

      r = hueToRgb(p, q, normalizedHue + 1 / 3);
      g = hueToRgb(p, q, normalizedHue);
      b = hueToRgb(p, q, normalizedHue - 1 / 3);
    }

    return {
      r: Math.round(r * 255),
      g: Math.round(g * 255),
      b: Math.round(b * 255),
    };
  }
}