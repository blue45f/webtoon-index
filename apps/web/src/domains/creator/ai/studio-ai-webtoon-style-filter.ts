/**
 * studio-ai-webtoon-style-filter.ts
 *
 * Webtoon AI Style Transfer & Toon Filter Engine.
 * Benchmarks Naver Webtoon Toon Filter, Krea AI, and ComfyUI Webtoon pipelines.
 *
 * - 4 Archetypal webtoon art styles:
 *   1. `romance-manhwa` (화사한 순정/로판 - 파스텔 톤, 반짝이는 눈망울, 맑은 피부)
 *   2. `action-shonen-ink` (역동적 소년/액션 - 묵직한 먹선, 강렬한 명암비, 속도선)
 *   3. `fantasy-noble-cel` (판타지 웹소설 표지 - 금장 디테일, 웅장한 극화체)
 *   4. `thriller-noir-grit` (다크 스릴러/좀비 - 거친 해칭, 음산한 청회색조)
 *
 * Synthesizes style-specific prompt prefixes, negative prompts, lineart weights,
 * and color grading lookups for generative AI backends.
 */

export type WebtoonArtStyleId =
  | "romance-manhwa"
  | "action-shonen-ink"
  | "fantasy-noble-cel"
  | "thriller-noir-grit";

export interface WebtoonArtStyleMeta {
  readonly id: WebtoonArtStyleId;
  readonly name: string;
  readonly genre: string;
  readonly description: string;
  readonly promptKeywords: readonly string[];
  readonly negativeKeywords: readonly string[];
  readonly lineThicknessFactor: number; // 0.5 (thin) ~ 2.0 (heavy ink)
  readonly contrastBoost: number; // 1.0 (neutral) ~ 1.5 (high contrast)
  readonly saturationMultiplier: number;
  readonly recommendedDenoiserStrength: number; // 0.35 (preserve original structure) ~ 0.75 (heavy restyle)
}

export const WEBTOON_ART_STYLES: Record<WebtoonArtStyleId, WebtoonArtStyleMeta> = {
  "romance-manhwa": {
    id: "romance-manhwa",
    name: "로맨스 판타지 / 순정만화 화풍",
    genre: "로맨스 / 순정 / 로판",
    description: "투명하고 맑은 피부톤, 파스텔조 환경광, 반짝이는 눈동자 하이라이트가 돋보이는 화사한 화풍",
    promptKeywords: [
      "Korean romance manhwa style",
      "sparkling luminous eyes",
      "delicate fine ink lineart",
      "soft pastel lighting",
      "glowing rim light",
      "elegant aesthetic",
      "clean digital webtoon illustration",
    ],
    negativeKeywords: [
      "rough heavy hatching",
      "dark muddy shadows",
      "grim expressions",
      "dirty skin texture",
      "hyper-realistic pores",
    ],
    lineThicknessFactor: 0.8,
    contrastBoost: 1.05,
    saturationMultiplier: 1.15,
    recommendedDenoiserStrength: 0.55,
  },
  "action-shonen-ink": {
    id: "action-shonen-ink",
    name: "소년 액션 / 역동적 극화체",
    genre: "액션 / 소년 / 무협",
    description: "굵직하고 거친 브러시 잉크 먹선, 극적인 명암 대비, 충격파 및 속도선이 강조된 액션 화풍",
    promptKeywords: [
      "Korean action webtoon style",
      "dynamic perspective",
      "heavy brush ink linework",
      "dramatic cel shading",
      "high contrast chiaroscuro",
      "intense expression",
      "speedlines and motion blast",
    ],
    negativeKeywords: [
      "soft blur",
      "weak lines",
      "pastel colors",
      "dull flat lighting",
      "childish look",
    ],
    lineThicknessFactor: 1.6,
    contrastBoost: 1.35,
    saturationMultiplier: 1.0,
    recommendedDenoiserStrength: 0.65,
  },
  "fantasy-noble-cel": {
    id: "fantasy-noble-cel",
    name: "고급 판타지 / 웹소설 표지풍",
    genre: "판타지 / 영애물 / 성좌물",
    description: "화려한 금장 의상과 보석 렌더링, 입체감 넘치는 완성도 높은 하이엔드 웹툰 표지 작화",
    promptKeywords: [
      "luxurious fantasy webtoon cover art",
      "detailed ornate royal clothing and jewelry",
      "masterpiece cel shading",
      "cinematic volumetric lighting",
      "sharp crystal details",
      "regal atmosphere",
    ],
    negativeKeywords: [
      "sloppy lines",
      "flat coloring",
      "pixelated artifacts",
      "cluttered messy background",
    ],
    lineThicknessFactor: 1.1,
    contrastBoost: 1.2,
    saturationMultiplier: 1.25,
    recommendedDenoiserStrength: 0.6,
  },
  "thriller-noir-grit": {
    id: "thriller-noir-grit",
    name: "스릴러 누아르 / 다크 판타지",
    genre: "스릴러 / 미스터리 / 아포칼립스",
    description: "음산한 청회색 모노톤, 섬뜩한 사선 해칭선, 서스펜스를 고조시키는 극단적 하이라이트",
    promptKeywords: [
      "dark webtoon thriller noir style",
      "dense cross-hatching pen strokes",
      "shadowy moody ambient",
      "cold desaturated color palette with intense focal accent",
      "psychological tension",
    ],
    negativeKeywords: [
      "cute",
      "bright sunny",
      "vibrant rainbow colors",
      "smooth airbrush shading",
    ],
    lineThicknessFactor: 1.3,
    contrastBoost: 1.45,
    saturationMultiplier: 0.7,
    recommendedDenoiserStrength: 0.7,
  },
};

export class StudioAiWebtoonStyleFilterEngine {
  /**
   * Generates a fully compiled generative AI prompt combining user intent with target art style rules.
   */
  public compilePrompt(
    styleId: WebtoonArtStyleId,
    userDescription: string,
    additionalModifiers: readonly string[] = [],
  ): {
    positivePrompt: string;
    negativePrompt: string;
    denoiseStrength: number;
    recommendedSettings: {
      lineFactor: number;
      contrast: number;
      saturation: number;
    };
  } {
    const style = WEBTOON_ART_STYLES[styleId] ?? WEBTOON_ART_STYLES["romance-manhwa"];
    const baseClean = userDescription.trim();

    const positivePrompt = [
      ...style.promptKeywords,
      baseClean,
      ...additionalModifiers,
    ]
      .filter(Boolean)
      .join(", ");

    const negativePrompt = [
      ...style.negativeKeywords,
      "lowres",
      "bad anatomy",
      "worst quality",
      "watermark",
      "signature",
      "ugly",
      "extra fingers",
    ].join(", ");

    return {
      positivePrompt,
      negativePrompt,
      denoiseStrength: style.recommendedDenoiserStrength,
      recommendedSettings: {
        lineFactor: style.lineThicknessFactor,
        contrast: style.contrastBoost,
        saturation: style.saturationMultiplier,
      },
    };
  }

  public listStyles(): readonly WebtoonArtStyleMeta[] {
    return Object.values(WEBTOON_ART_STYLES);
  }

  public getStyle(id: WebtoonArtStyleId): WebtoonArtStyleMeta {
    return WEBTOON_ART_STYLES[id] ?? WEBTOON_ART_STYLES["romance-manhwa"];
  }
}
