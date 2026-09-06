/**
 * Dialogue emotion analysis and speech-bubble recommendation.
 *
 * This is a deterministic, local-first heuristic: no dialogue leaves the browser and every
 * recommendation carries the signals, runner-up, and review state needed for an artist to judge
 * the suggestion instead of accepting an opaque one-shot result.
 */

export const STUDIO_AI_EMOTION_BUBBLE_MATCHER_VERSION = 2 as const;
export const STUDIO_AI_EMOTION_ANALYSIS_TEXT_LIMIT = 2_000;

export type SpeechEmotionKind =
  | "rage-shout"
  | "shock-gasp"
  | "whisper-secret"
  | "thought-monologue"
  | "romance-blush"
  | "neutral-calm";

export type BubbleShapePreset =
  | "shout-spiky"
  | "wobbly-distress"
  | "whisper-dashed"
  | "cloud-thought"
  | "soft-blush"
  | "standard-oval";

export type SpeechAnalysisLocale = "ko" | "en" | "ja" | "mixed" | "undetermined";

export interface EmotionBubbleCandidate {
  readonly emotion: SpeechEmotionKind;
  readonly evidenceScore: number;
  readonly matchedSignals: readonly string[];
}

export interface EmotionBubbleRecommendation {
  readonly analysisVersion: typeof STUDIO_AI_EMOTION_BUBBLE_MATCHER_VERSION;
  readonly dialogue: string;
  readonly detectedEmotion: SpeechEmotionKind;
  readonly confidenceScore: number; // 0..100%
  readonly recommendedBubbleShape: BubbleShapePreset;
  readonly strokeWidthPx: number;
  readonly strokeColor: string;
  readonly fillColor: string;
  readonly textColor: string;
  readonly isDashedBorder: boolean;
  readonly recommendedFontWeight: "bold" | "black" | "normal" | "medium";
  readonly suggestedEmoteIcon: string;
  readonly analysisLocale: SpeechAnalysisLocale;
  readonly matchedSignals: readonly string[];
  readonly secondaryEmotion: SpeechEmotionKind | null;
  readonly secondaryConfidenceScore: number;
  readonly confidenceGap: number;
  readonly needsHumanReview: boolean;
  readonly analysisWasTruncated: boolean;
  readonly candidates: readonly EmotionBubbleCandidate[];
}

interface EmotionSignal {
  readonly id: string;
  readonly emotion: Exclude<SpeechEmotionKind, "neutral-calm">;
  readonly pattern: RegExp;
  readonly weight: number;
}

interface BubbleVisualStyle {
  readonly recommendedBubbleShape: BubbleShapePreset;
  readonly strokeWidthPx: number;
  readonly strokeColor: string;
  readonly fillColor: string;
  readonly textColor: string;
  readonly isDashedBorder: boolean;
  readonly recommendedFontWeight: "bold" | "black" | "normal" | "medium";
  readonly suggestedEmoteIcon: string;
}

const EMOTION_TIE_BREAK_ORDER: readonly SpeechEmotionKind[] = Object.freeze([
  "thought-monologue",
  "shock-gasp",
  "rage-shout",
  "whisper-secret",
  "romance-blush",
  "neutral-calm",
]);

const BUBBLE_VISUAL_STYLES: Readonly<Record<SpeechEmotionKind, BubbleVisualStyle>> = Object.freeze({
  "rage-shout": Object.freeze({
    recommendedBubbleShape: "shout-spiky",
    strokeWidthPx: 3.5,
    strokeColor: "#000000",
    fillColor: "#ffffff",
    textColor: "#000000",
    isDashedBorder: false,
    recommendedFontWeight: "black",
    suggestedEmoteIcon: "Flame",
  }),
  "shock-gasp": Object.freeze({
    recommendedBubbleShape: "wobbly-distress",
    strokeWidthPx: 2.5,
    strokeColor: "#1e293b",
    fillColor: "#ffffff",
    textColor: "#0f172a",
    isDashedBorder: false,
    recommendedFontWeight: "bold",
    suggestedEmoteIcon: "Zap",
  }),
  "whisper-secret": Object.freeze({
    recommendedBubbleShape: "whisper-dashed",
    strokeWidthPx: 1.5,
    strokeColor: "#64748b",
    fillColor: "#f8fafc",
    textColor: "#334155",
    isDashedBorder: true,
    recommendedFontWeight: "normal",
    suggestedEmoteIcon: "VolumeX",
  }),
  "thought-monologue": Object.freeze({
    recommendedBubbleShape: "cloud-thought",
    strokeWidthPx: 2,
    strokeColor: "#475569",
    fillColor: "#f8fafc",
    textColor: "#1e293b",
    isDashedBorder: false,
    recommendedFontWeight: "medium",
    suggestedEmoteIcon: "Cloud",
  }),
  "romance-blush": Object.freeze({
    recommendedBubbleShape: "soft-blush",
    strokeWidthPx: 2,
    strokeColor: "#f43f5e",
    fillColor: "#fff1f2",
    textColor: "#881337",
    isDashedBorder: false,
    recommendedFontWeight: "bold",
    suggestedEmoteIcon: "Heart",
  }),
  "neutral-calm": Object.freeze({
    recommendedBubbleShape: "standard-oval",
    strokeWidthPx: 2,
    strokeColor: "#000000",
    fillColor: "#ffffff",
    textColor: "#000000",
    isDashedBorder: false,
    recommendedFontWeight: "normal",
    suggestedEmoteIcon: "MessageCircle",
  }),
});

const EMOTION_SIGNALS: readonly EmotionSignal[] = Object.freeze([
  // Rage / shout — lexical intent is stronger than punctuation alone.
  {
    id: "ko-rage-lexicon",
    emotion: "rage-shout",
    weight: 5,
    pattern: /(?:닥쳐|죽어|용서(?:하지|못)|안\s*돼|비켜|꺼져|괴물|미친|가만\s*안|절대\s*용서)/iu,
  },
  {
    id: "en-rage-lexicon",
    emotion: "rage-shout",
    weight: 5,
    pattern: /(?:shut\s*up|never\s+forgive|go\s+away|get\s+out|damn\s+you|you\s+monster|i\s+hate\s+you|drop\s+dead)/iu,
  },
  {
    id: "ja-rage-lexicon",
    emotion: "rage-shout",
    weight: 5,
    pattern: /(?:黙れ|死ね|許さない|どけ|消えろ|ふざけるな|絶対に許さない)/u,
  },
  {
    id: "repeated-exclamation",
    emotion: "rage-shout",
    weight: 3,
    pattern: /!{2,}/u,
  },
  {
    id: "uppercase-shout",
    emotion: "rage-shout",
    weight: 2,
    pattern: /\b[A-Z]{3,}\b/u,
  },
  {
    id: "shout-interjection",
    emotion: "rage-shout",
    weight: 2,
    pattern: /(?:으아+|아아+|うわあ+|きゃあ+|a+h+|no+o+)/iu,
  },

  // Shock / gasp — question-heavy surprise must not be mistaken for rage.
  {
    id: "ko-shock-lexicon",
    emotion: "shock-gasp",
    weight: 5,
    pattern: /(?:설마|거짓말|어떻게|말도\s*안|히익|헉|헐|뭐라고|진짜로)/iu,
  },
  {
    id: "en-shock-lexicon",
    emotion: "shock-gasp",
    weight: 5,
    pattern: /(?:no\s+way|impossible|oh\s+my\s+god|omg|how\s+could|are\s+you\s+serious|what\s+the)/iu,
  },
  {
    id: "ja-shock-lexicon",
    emotion: "shock-gasp",
    weight: 5,
    pattern: /(?:まさか|嘘|ありえない|えっ|なんで|本当に|そんな)/u,
  },
  {
    id: "repeated-question",
    emotion: "shock-gasp",
    weight: 4,
    pattern: /\?{2,}/u,
  },
  {
    id: "interrobang",
    emotion: "shock-gasp",
    weight: 2,
    pattern: /(?:\?!|!\?)/u,
  },
  {
    id: "gasp-interjection",
    emotion: "shock-gasp",
    weight: 3,
    pattern: /(?:^|\s)(?:헉|헐|어|えっ|ええっ|gasp|whoa|wait)(?:\s|[!?.,…]|$)/iu,
  },

  // Whisper / secret.
  {
    id: "ko-whisper-lexicon",
    emotion: "whisper-secret",
    weight: 5,
    pattern: /(?:쉿|조용히|몰래|비밀|소근|들키면|낮은\s*목소리)/iu,
  },
  {
    id: "en-whisper-lexicon",
    emotion: "whisper-secret",
    weight: 5,
    pattern: /(?:\b(?:shh+|psst|quiet(?:ly)?|whisper|secret)\b|keep\s+it\s+down|don't\s+let\s+.+\s+know)/iu,
  },
  {
    id: "ja-whisper-lexicon",
    emotion: "whisper-secret",
    weight: 5,
    pattern: /(?:しー+っ?|静かに|内緒|秘密|小声|ばれ(?:る|たら))/u,
  },
  {
    id: "ellipsis",
    emotion: "whisper-secret",
    weight: 2,
    pattern: /(?:\.{3,}|…+)/u,
  },

  // Thought / monologue.
  {
    id: "thought-wrapper",
    emotion: "thought-monologue",
    weight: 6,
    pattern: /^\s*(?:\(|（)[\s\S]+(?:\)|）)\s*$/u,
  },
  {
    id: "ko-thought-lexicon",
    emotion: "thought-monologue",
    weight: 4,
    pattern: /(?:생각|겠지|일까|모르겠|마음속|속으로|혹시)/iu,
  },
  {
    id: "en-thought-lexicon",
    emotion: "thought-monologue",
    weight: 4,
    pattern: /(?:i\s+wonder|maybe|perhaps|in\s+my\s+mind|could\s+it\s+be|i\s+think)/iu,
  },
  {
    id: "ja-thought-lexicon",
    emotion: "thought-monologue",
    weight: 4,
    pattern: /(?:だろう|かな|かもしれない|心の中|と思う|ひょっとして)/u,
  },
  {
    id: "reflective-ellipsis",
    emotion: "thought-monologue",
    weight: 1,
    pattern: /(?:\.{3,}|…+)/u,
  },

  // Romance / affection.
  {
    id: "ko-romance-lexicon",
    emotion: "romance-blush",
    weight: 5,
    pattern: /(?:좋아|사랑|예쁘|두근|반했|보고\s*싶|고마워|설레|심쿵)/iu,
  },
  {
    id: "en-romance-lexicon",
    emotion: "romance-blush",
    weight: 5,
    pattern: /(?:i\s+love\s+you|i\s+like\s+you|beautiful|miss\s+you|thank\s+you|my\s+heart|blush)/iu,
  },
  {
    id: "ja-romance-lexicon",
    emotion: "romance-blush",
    weight: 5,
    pattern: /(?:好き|愛して|綺麗|会いたい|ありがとう|ドキドキ|惚れ)/u,
  },
  {
    id: "heart-symbol",
    emotion: "romance-blush",
    weight: 3,
    pattern: /(?:♥|♡|❤|💕|💗)/u,
  },
]);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function detectSpeechAnalysisLocale(text: string): SpeechAnalysisLocale {
  const scripts = [
    /[가-힣ㄱ-ㅎㅏ-ㅣ]/u.test(text) ? "ko" : null,
    /[A-Za-z]/u.test(text) ? "en" : null,
    /[\u3040-\u30ff]/u.test(text) ? "ja" : null,
  ].filter((value): value is "ko" | "en" | "ja" => value !== null);
  if (scripts.length > 1) return "mixed";
  return scripts[0] ?? "undetermined";
}

function createCandidates(analysisText: string): readonly EmotionBubbleCandidate[] {
  const mutable = new Map<SpeechEmotionKind, { score: number; signals: string[] }>(
    EMOTION_TIE_BREAK_ORDER.map((emotion) => [emotion, { score: 0, signals: [] }]),
  );

  for (const signal of EMOTION_SIGNALS) {
    if (!signal.pattern.test(analysisText)) continue;
    const candidate = mutable.get(signal.emotion)!;
    candidate.score += signal.weight;
    candidate.signals.push(signal.id);
  }

  return Object.freeze(
    EMOTION_TIE_BREAK_ORDER
      .map((emotion, tieBreakIndex) => ({
        emotion,
        evidenceScore: mutable.get(emotion)?.score ?? 0,
        matchedSignals: Object.freeze([...(mutable.get(emotion)?.signals ?? [])]),
        tieBreakIndex,
      }))
      .sort((left, right) =>
        right.evidenceScore - left.evidenceScore || left.tieBreakIndex - right.tieBreakIndex,
      )
      .map(({ emotion, evidenceScore, matchedSignals }) =>
        Object.freeze({ emotion, evidenceScore, matchedSignals }),
      ),
  );
}

function confidenceFor(score: number, runnerUpScore: number, signalCount: number): number {
  const gap = Math.max(0, score - runnerUpScore);
  return clamp(
    Math.round(68 + score * 3 + gap * 1.5 + Math.min(6, signalCount * 2)),
    68,
    97,
  );
}

function secondaryConfidenceFor(score: number, primaryConfidence: number): number {
  if (score <= 0) return 0;
  return clamp(Math.round(48 + score * 5), 1, Math.max(1, primaryConfidence - 4));
}

export class StudioAiEmotionBubbleMatcher {
  /** Analyzes one dialogue line and returns an inspectable speech-bubble suggestion. */
  public match(dialogueText: string): EmotionBubbleRecommendation {
    const dialogue = String(dialogueText ?? "").trim();
    const analysisWasTruncated = dialogue.length > STUDIO_AI_EMOTION_ANALYSIS_TEXT_LIMIT;
    const analysisText = dialogue
      .slice(0, STUDIO_AI_EMOTION_ANALYSIS_TEXT_LIMIT)
      .normalize("NFKC");
    const analysisLocale = detectSpeechAnalysisLocale(analysisText);

    if (!analysisText) {
      return this.buildRecommendation({
        dialogue,
        detectedEmotion: "neutral-calm",
        confidenceScore: 0,
        analysisLocale,
        matchedSignals: [],
        secondaryEmotion: null,
        secondaryConfidenceScore: 0,
        needsHumanReview: true,
        analysisWasTruncated,
        candidates: createCandidates(analysisText),
      });
    }

    const candidates = createCandidates(analysisText);
    const strongest = candidates[0]!;
    if (strongest.evidenceScore === 0) {
      return this.buildRecommendation({
        dialogue,
        detectedEmotion: "neutral-calm",
        confidenceScore: 75,
        analysisLocale,
        matchedSignals: [],
        secondaryEmotion: null,
        secondaryConfidenceScore: 0,
        needsHumanReview: false,
        analysisWasTruncated,
        candidates,
      });
    }

    const runnerUp = candidates.find(
      (candidate) => candidate.emotion !== strongest.emotion && candidate.evidenceScore > 0,
    ) ?? null;
    const runnerUpScore = runnerUp?.evidenceScore ?? 0;
    const confidenceScore = confidenceFor(
      strongest.evidenceScore,
      runnerUpScore,
      strongest.matchedSignals.length,
    );
    const secondaryConfidenceScore = secondaryConfidenceFor(runnerUpScore, confidenceScore);
    const evidenceGap = strongest.evidenceScore - runnerUpScore;
    const needsHumanReview =
      analysisWasTruncated
      || confidenceScore < 82
      || evidenceGap <= 2
      || (runnerUpScore >= 4 && evidenceGap <= 3);

    return this.buildRecommendation({
      dialogue,
      detectedEmotion: strongest.emotion,
      confidenceScore,
      analysisLocale,
      matchedSignals: strongest.matchedSignals,
      secondaryEmotion: runnerUp?.emotion ?? null,
      secondaryConfidenceScore,
      needsHumanReview,
      analysisWasTruncated,
      candidates,
    });
  }

  /** Batch helper for panel-by-panel generation; preserves input order and never mutates the input. */
  public matchMany(dialogueTexts: readonly string[]): readonly EmotionBubbleRecommendation[] {
    return Object.freeze(dialogueTexts.map((dialogue) => this.match(dialogue)));
  }

  private buildRecommendation(input: {
    dialogue: string;
    detectedEmotion: SpeechEmotionKind;
    confidenceScore: number;
    analysisLocale: SpeechAnalysisLocale;
    matchedSignals: readonly string[];
    secondaryEmotion: SpeechEmotionKind | null;
    secondaryConfidenceScore: number;
    needsHumanReview: boolean;
    analysisWasTruncated: boolean;
    candidates: readonly EmotionBubbleCandidate[];
  }): EmotionBubbleRecommendation {
    const style = BUBBLE_VISUAL_STYLES[input.detectedEmotion];
    return Object.freeze({
      analysisVersion: STUDIO_AI_EMOTION_BUBBLE_MATCHER_VERSION,
      dialogue: input.dialogue,
      detectedEmotion: input.detectedEmotion,
      confidenceScore: input.confidenceScore,
      ...style,
      analysisLocale: input.analysisLocale,
      matchedSignals: Object.freeze([...input.matchedSignals]),
      secondaryEmotion: input.secondaryEmotion,
      secondaryConfidenceScore: input.secondaryConfidenceScore,
      confidenceGap: input.confidenceScore - input.secondaryConfidenceScore,
      needsHumanReview: input.needsHumanReview,
      analysisWasTruncated: input.analysisWasTruncated,
      candidates: input.candidates,
    });
  }
}
