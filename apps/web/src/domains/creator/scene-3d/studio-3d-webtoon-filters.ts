/**
 * studio-3d-webtoon-filters.ts
 *
 * Snaptoon & Abler-inspired Real-Time Webtoon Shading, Cel-grade & Ink Filter Engine.
 * Provides specialized presets (Classic B&W Ink, Romance Fantasy Pastel, Modern Crisp Cel,
 * Dark Action Noir, Retro Screentone Pop, Cyberpunk Neon Rim, Watercolor Wash)
 * with cel quantization ramps, outline weights, color grading LUT matrix and canvas filter synthesis.
 */

export type WebtoonFilterId =
  | "classic-bw-ink"
  | "romance-fantasy-pastel"
  | "modern-crisp-cel"
  | "dark-action-noir"
  | "retro-screentone-pop"
  | "cyberpunk-neon-rim"
  | "watercolor-wash";

export type WebtoonFilterCategory =
  | "bw"
  | "romance"
  | "action"
  | "retro"
  | "scifi"
  | "artistic";

export interface WebtoonFilterConfig {
  readonly id: WebtoonFilterId;
  readonly name: string;
  readonly category: WebtoonFilterCategory;
  readonly lineThicknessPx: number; // 0.5 to 4.0 px
  readonly lineToneColor: string; // #000000, #1a1a2e, #4a2810 etc.
  readonly celSteps: 2 | 3 | 4; // Cel quantization steps
  readonly shadowIntensity: number; // 0.0 to 1.0
  readonly shadowThreshold: number; // 0.1 to 0.8
  readonly highlightBloom: number; // 0.0 to 1.5
  readonly colorSaturation: number; // 0.0 (B&W) to 2.0 (ultra-vivid)
  readonly contrast: number; // 0.8 to 2.2
  readonly rimLightIntensity: number; // 0.0 to 1.5
  readonly paperTextureEnabled: boolean;
  readonly description: string;
}

export const WEBTOON_FILTER_PRESETS: readonly WebtoonFilterConfig[] = [
  {
    id: "classic-bw-ink",
    name: "클래식 흑백 먹칠 펜선 (Classic B&W Ink)",
    category: "bw",
    lineThicknessPx: 2.2,
    lineToneColor: "#050508",
    celSteps: 2,
    shadowIntensity: 0.95,
    shadowThreshold: 0.45,
    highlightBloom: 0.0,
    colorSaturation: 0.0,
    contrast: 1.8,
    rimLightIntensity: 0.2,
    paperTextureEnabled: true,
    description: "출판 만화 및 흑백 웹툰의 깊은 먹칠과 명확한 펜선 스타일",
  },
  {
    id: "romance-fantasy-pastel",
    name: "로맨스 판타지 파스텔 (Romance Fantasy Pastel)",
    category: "romance",
    lineThicknessPx: 1.2,
    lineToneColor: "#4a354f",
    celSteps: 4,
    shadowIntensity: 0.45,
    shadowThreshold: 0.55,
    highlightBloom: 1.2,
    colorSaturation: 1.25,
    contrast: 1.05,
    rimLightIntensity: 0.9,
    paperTextureEnabled: false,
    description: "부드러운 블룸 광채와 따뜻한 라벤더·로즈 톤의 로판 황실풍",
  },
  {
    id: "modern-crisp-cel",
    name: "현대극 깔끔한 2단 셀 (Modern Crisp Cel)",
    category: "action",
    lineThicknessPx: 1.6,
    lineToneColor: "#181824",
    celSteps: 2,
    shadowIntensity: 0.65,
    shadowThreshold: 0.5,
    highlightBloom: 0.3,
    colorSaturation: 1.1,
    contrast: 1.25,
    rimLightIntensity: 0.4,
    paperTextureEnabled: false,
    description: "학원·오피스·현대 판타지에 가장 널리 쓰이는 표준 2단 셀 셰이딩",
  },
  {
    id: "dark-action-noir",
    name: "다크 액션 누아르 (Dark Action Noir)",
    category: "action",
    lineThicknessPx: 2.8,
    lineToneColor: "#0a0a10",
    celSteps: 2,
    shadowIntensity: 0.9,
    shadowThreshold: 0.35,
    highlightBloom: 0.1,
    colorSaturation: 0.7,
    contrast: 1.65,
    rimLightIntensity: 0.75,
    paperTextureEnabled: false,
    description: "묵직한 그림자와 날카로운 역광 림라이트로 긴장감을 주는 액션 씬",
  },
  {
    id: "retro-screentone-pop",
    name: "레트로 팝 만화 망점 (Retro Screentone Pop)",
    category: "retro",
    lineThicknessPx: 2.0,
    lineToneColor: "#121216",
    celSteps: 3,
    shadowIntensity: 0.8,
    shadowThreshold: 0.5,
    highlightBloom: 0.0,
    colorSaturation: 0.9,
    contrast: 1.4,
    rimLightIntensity: 0.1,
    paperTextureEnabled: true,
    description: "아날로그 망점 톤 스크린과 코믹스 팝아트 감성의 조화",
  },
  {
    id: "cyberpunk-neon-rim",
    name: "SF 사이버펑크 네온 (Cyberpunk Neon Rim)",
    category: "scifi",
    lineThicknessPx: 1.5,
    lineToneColor: "#0f172a",
    celSteps: 3,
    shadowIntensity: 0.75,
    shadowThreshold: 0.4,
    highlightBloom: 1.4,
    colorSaturation: 1.5,
    contrast: 1.35,
    rimLightIntensity: 1.4,
    paperTextureEnabled: false,
    description: "강렬한 네온 림라이트와 사이안/마젠타 대비의 미래지향적 연출",
  },
  {
    id: "watercolor-wash",
    name: "수채화 담채 일러스트 (Watercolor Wash)",
    category: "artistic",
    lineThicknessPx: 1.0,
    lineToneColor: "#332720",
    celSteps: 4,
    shadowIntensity: 0.5,
    shadowThreshold: 0.6,
    highlightBloom: 0.5,
    colorSaturation: 1.0,
    contrast: 0.95,
    rimLightIntensity: 0.3,
    paperTextureEnabled: true,
    description: "번짐과 투명한 수채 물감 느낌의 감성 일러스트 컷",
  },
];

export class Studio3DWebtoonFilterEngine {
  private readonly presets = new Map<WebtoonFilterId, WebtoonFilterConfig>();

  constructor() {
    for (const preset of WEBTOON_FILTER_PRESETS) {
      this.presets.set(preset.id, preset);
    }
  }

  public getPreset(id: WebtoonFilterId): WebtoonFilterConfig {
    const found = this.presets.get(id);
    if (!found) {
      return WEBTOON_FILTER_PRESETS[2]; // Default to modern-crisp-cel
    }
    return found;
  }

  public listPresets(category?: WebtoonFilterCategory): readonly WebtoonFilterConfig[] {
    if (!category) {
      return WEBTOON_FILTER_PRESETS;
    }
    return WEBTOON_FILTER_PRESETS.filter((p) => p.category === category);
  }

  /**
   * Evaluates discrete cel shading ramp for a given surface diffuse light coefficient (0.0 to 1.0).
   */
  public evaluateCelRamp(diffuseDot: number, steps: 2 | 3 | 4, shadowThreshold: number = 0.5): number {
    const clamped = Math.max(0, Math.min(1, diffuseDot));
    if (steps === 2) {
      return clamped >= shadowThreshold ? 1.0 : 0.35;
    }
    if (steps === 3) {
      if (clamped >= shadowThreshold + 0.25) return 1.0;
      if (clamped >= shadowThreshold) return 0.65;
      return 0.3;
    }
    // steps === 4
    if (clamped >= 0.8) return 1.0;
    if (clamped >= 0.55) return 0.75;
    if (clamped >= 0.35) return 0.5;
    return 0.25;
  }

  /**
   * Builds high-performance CSS filter chain for viewport composite overlay.
   */
  public generateCssFilterString(config: WebtoonFilterConfig): string {
    const filters: string[] = [];
    if (config.colorSaturation !== 1.0) {
      filters.push(`saturate(${Math.round(config.colorSaturation * 100)}%)`);
    }
    if (config.contrast !== 1.0) {
      filters.push(`contrast(${Math.round(config.contrast * 100)}%)`);
    }
    if (config.highlightBloom > 0.0) {
      const brightnessBoost = 100 + Math.round(config.highlightBloom * 12);
      filters.push(`brightness(${brightnessBoost}%)`);
    }
    return filters.join(" ") || "none";
  }

  /**
   * Applies custom color grading matrix to RGB byte values [0..255].
   */
  public applyColorGradeRgb(
    r: number,
    g: number,
    b: number,
    config: WebtoonFilterConfig,
  ): { r: number; g: number; b: number } {
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    // Saturation adjustment
    let outR = lum + (r - lum) * config.colorSaturation;
    let outG = lum + (g - lum) * config.colorSaturation;
    let outB = lum + (b - lum) * config.colorSaturation;

    // Contrast adjustment around midpoint 128
    outR = (outR - 128) * config.contrast + 128;
    outG = (outG - 128) * config.contrast + 128;
    outB = (outB - 128) * config.contrast + 128;

    // Clamp
    return {
      r: Math.max(0, Math.min(255, Math.round(outR))),
      g: Math.max(0, Math.min(255, Math.round(outG))),
      b: Math.max(0, Math.min(255, Math.round(outB))),
    };
  }

  /**
   * Linearly blends two filter configs (useful for smooth transitions between shots/panels).
   */
  public blendFilters(
    a: WebtoonFilterConfig,
    b: WebtoonFilterConfig,
    factor: number,
  ): WebtoonFilterConfig {
    const t = Math.max(0, Math.min(1, factor));
    const lerp = (start: number, end: number) => start + (end - start) * t;

    return {
      id: t < 0.5 ? a.id : b.id,
      name: `${a.name} → ${b.name} (${Math.round(t * 100)}%)`,
      category: t < 0.5 ? a.category : b.category,
      lineThicknessPx: Number(lerp(a.lineThicknessPx, b.lineThicknessPx).toFixed(2)),
      lineToneColor: t < 0.5 ? a.lineToneColor : b.lineToneColor,
      celSteps: t < 0.5 ? a.celSteps : b.celSteps,
      shadowIntensity: Number(lerp(a.shadowIntensity, b.shadowIntensity).toFixed(2)),
      shadowThreshold: Number(lerp(a.shadowThreshold, b.shadowThreshold).toFixed(2)),
      highlightBloom: Number(lerp(a.highlightBloom, b.highlightBloom).toFixed(2)),
      colorSaturation: Number(lerp(a.colorSaturation, b.colorSaturation).toFixed(2)),
      contrast: Number(lerp(a.contrast, b.contrast).toFixed(2)),
      rimLightIntensity: Number(lerp(a.rimLightIntensity, b.rimLightIntensity).toFixed(2)),
      paperTextureEnabled: t < 0.5 ? a.paperTextureEnabled : b.paperTextureEnabled,
      description: `Blended filter preset at ${Math.round(t * 100)}% transition`,
    };
  }
}
