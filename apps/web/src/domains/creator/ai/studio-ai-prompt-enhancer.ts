/**
 * studio-ai-prompt-enhancer.ts
 *
 * Professional Webtoon Prompt Enhancer & Negative Prompt Generator.
 * Benchmarks Midjourney Webtoon LoRAs, Dashtoon, Scenario, and NovelAI.
 *
 * - Translates & augments natural user idea into high-yield webtoon production prompts.
 * - Automatically injects composition, lighting, camera angle, and clean lineart anchors.
 * - Generates comprehensive negative prompts to eliminate anatomical deformities,
 *   extra fingers, muddy shadows, and artifact blurs.
 */

export type PromptGenreHint = "action" | "romance" | "fantasy" | "slice-of-life" | "horror";

export interface PromptEnhancementOptions {
  readonly genre?: PromptGenreHint;
  readonly includeCompositionAnchor?: boolean;
  readonly includeLightingAnchor?: boolean;
  readonly includeQualityBooster?: boolean;
}

export interface EnhancedPromptResult {
  readonly originalInput: string;
  readonly enhancedPositivePrompt: string;
  readonly recommendedNegativePrompt: string;
  readonly detectedGenre: PromptGenreHint;
  readonly keywordsAdded: readonly string[];
}

const GENRE_KEYWORD_MAP: Record<PromptGenreHint, readonly string[]> = {
  action: [
    "dynamic action pose",
    "extreme foreshortening",
    "impact sparks and speedlines",
    "intense focused gaze",
    "dramatic low angle worm's eye view",
    "high contrast sharp cel shading",
  ],
  romance: [
    "sparkling beautiful expressive eyes",
    "soft fluttering hair",
    "warm glowing ambient light",
    "subtle blush tint",
    "delicate romantic atmosphere",
    "clean pastel tones",
  ],
  fantasy: [
    "ornate royal fantasy attire",
    "glowing magical particles and aura",
    "epic mystical atmosphere",
    "detailed crystal jewelry",
    "volumetric atmospheric lighting",
  ],
  "slice-of-life": [
    "natural casual posture",
    "cozy warm sunlight",
    "detailed realistic modern background",
    "relatable gentle smile",
    "clean everyday manhwa style",
  ],
  horror: [
    "ominous shadowy silhouette",
    "dense psychological cross hatching",
    "cold desaturated muted tones",
    "creepy eerie ambient",
    "distorted claustrophobic perspective",
  ],
};

const UNIVERSAL_QUALITY_BOOSTERS: readonly string[] = [
  "masterpiece",
  "top quality Korean webtoon style",
  "crisp sharp digital ink lineart",
  "vibrant professional webtoon colorist grading",
  "clean background separation",
];

const UNIVERSAL_NEGATIVE_PROMPTS: readonly string[] = [
  "worst quality",
  "lowres",
  "bad anatomy",
  "bad hands",
  "missing fingers",
  "extra fingers",
  "mutated hands",
  "distorted face",
  "blurry linework",
  "muddy gray shadows",
  "watermark",
  "signature",
  "text caption",
  "3D CGI plastic mannequin look",
  "deformed iris",
];

export class StudioAiPromptEnhancer {
  /**
   * Enhances a user prompt with genre-appropriate webtoon art directives.
   */
  public enhance(
    rawPrompt: string,
    options: PromptEnhancementOptions = {},
  ): EnhancedPromptResult {
    const clean = rawPrompt.trim();
    const genre = options.genre ?? this.detectGenre(clean);
    const addedKeywords: string[] = [];

    const positiveTokens: string[] = [];

    // 1. Base user idea
    if (clean) {
      positiveTokens.push(clean);
    }

    // 2. Genre-specific enhancements
    const genreKeywords = GENRE_KEYWORD_MAP[genre];
    positiveTokens.push(...genreKeywords);
    addedKeywords.push(...genreKeywords);

    // 3. Optional quality boosters
    if (options.includeQualityBooster !== false) {
      positiveTokens.push(...UNIVERSAL_QUALITY_BOOSTERS);
      addedKeywords.push(...UNIVERSAL_QUALITY_BOOSTERS);
    }

    return {
      originalInput: clean,
      enhancedPositivePrompt: positiveTokens.join(", "),
      recommendedNegativePrompt: UNIVERSAL_NEGATIVE_PROMPTS.join(", "),
      detectedGenre: genre,
      keywordsAdded: addedKeywords,
    };
  }

  /**
   * Automatically detects genre from natural Korean/English keywords.
   */
  public detectGenre(text: string): PromptGenreHint {
    const lower = text.toLowerCase();

    if (/검|싸움|격투|결투|전투|펀치|타격|돌진|마왕|몬스터|action|sword|fight|battle|punch|duel/.test(lower)) {
      return "action";
    }
    if (/연애|로맨스|사랑|설렘|키스|데이트|순정|romance|love|date|kiss|blush/.test(lower)) {
      return "romance";
    }
    if (/마법|영애|황제|기사|성좌|던전|드래곤|fantasy|magic|knight|emperor|dragon/.test(lower)) {
      return "fantasy";
    }
    if (/공포|귀신|괴물|섬뜩|살인|혈흔|유혈|사망|horror|ghost|blood|creepy|dark|killer/.test(lower)) {
      return "horror";
    }

    return "slice-of-life";
  }
}
