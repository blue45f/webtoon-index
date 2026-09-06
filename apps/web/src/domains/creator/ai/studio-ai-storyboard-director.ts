/**
 * studio-ai-storyboard-director.ts
 *
 * Webtoon Scenario to Storyboard & Cut Director Engine.
 */

export type StoryboardShotScale =
  | "extreme-close-up"
  | "close-up"
  | "medium-shot"
  | "full-shot"
  | "long-shot"
  | "birds-eye"
  | "worms-eye";

export type StoryboardCameraAngle = "eye-level" | "low-angle" | "high-angle" | "dutch-tilt";

export type CharacterEmotionalTone =
  | "determination"
  | "shock"
  | "joy"
  | "rage"
  | "sorrow"
  | "calm";

export interface StoryboardCutPlan {
  readonly cutNumber: number;
  readonly summary: string;
  readonly dialogue?: string;
  readonly shotScale: StoryboardShotScale;
  readonly cameraAngle: StoryboardCameraAngle;
  readonly emotion: CharacterEmotionalTone;
  readonly suggestedSfx?: string;
  readonly backgroundPrompt: string;
  readonly panelHeightRatio: number;
}

export interface StoryboardDirectingResult {
  readonly rawText: string;
  readonly cuts: readonly StoryboardCutPlan[];
  readonly totalCuts: number;
  readonly estimatedEpisodeReadingSec: number;
  readonly pacingScore: number;
}

const ACTION_PATTERN = /(?:결투|공격|타격|대검|장검|단검|마검|검(?=$|[\s,.:;!?)]|을|이|으로|과|도|만|날|집|자루|끝)|칼(?=$|[\s,.:;!?)]|을|이|로|과|도|만|날|자루|끝)|주먹|때리|폭발|쾅|쿵)/u;
const QUOTED_DIALOGUE_PATTERN = /["“](.+?)["”]/u;
const SPEAKER_DIALOGUE_PATTERN = /^\s*[^:：\n]{1,20}[:：]\s*(.+)$/u;

function visualPromptSource(line: string): string {
  const withoutDialogue = line
    .replace(/["“][^"”]*["”]/gu, "")
    .replace(/^\s*[^:：\n]{1,20}[:：]\s*/u, "")
    .replace(/\s+/gu, " ")
    .trim();
  return (withoutDialogue || "character reaction and visual acting").slice(0, 80);
}

export class StudioAiStoryboardDirector {
  public direct(scriptText: string): StoryboardDirectingResult {
    const lines = scriptText
      .split(/\n+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) {
      return {
        rawText: scriptText,
        cuts: [],
        totalCuts: 0,
        estimatedEpisodeReadingSec: 0,
        pacingScore: 100,
      };
    }

    const cuts: StoryboardCutPlan[] = [];
    lines.forEach((line, index) => {
      cuts.push(this.analyzeLineDirectives(line, index + 1, lines.length));
    });

    return {
      rawText: scriptText,
      cuts,
      totalCuts: cuts.length,
      estimatedEpisodeReadingSec: cuts.length * 6,
      pacingScore: Math.min(100, Math.max(50, 95 - Math.abs(cuts.length - 8) * 3)),
    };
  }

  private analyzeLineDirectives(line: string, cutNum: number, totalCuts: number): StoryboardCutPlan {
    let shotScale: StoryboardShotScale = "medium-shot";
    let cameraAngle: StoryboardCameraAngle = "eye-level";
    let emotion: CharacterEmotionalTone = "calm";
    let suggestedSfx: string | undefined;
    let heightRatio = 1.0;

    const quoteMatch = line.match(QUOTED_DIALOGUE_PATTERN);
    const speakerMatch = line.match(SPEAKER_DIALOGUE_PATTERN);
    const dialogue: string | undefined =
      quoteMatch?.[1]?.trim() || speakerMatch?.[1]?.trim();

    if (ACTION_PATTERN.test(line)) {
      shotScale = "full-shot";
      cameraAngle = "low-angle";
      emotion = "rage";
      suggestedSfx = "콰앙";
      heightRatio = 1.5;
    } else if (/눈빛|숨결|동공|입술|바라보|경악|놀라|충격/.test(line)) {
      shotScale = "extreme-close-up";
      emotion = "shock";
      suggestedSfx = "두근";
      heightRatio = 0.9;
    } else if (/눈물|울|슬픔|비탄|절망|주저앉/.test(line)) {
      shotScale = "close-up";
      cameraAngle = "high-angle";
      emotion = "sorrow";
      suggestedSfx = "주룩주룩";
      heightRatio = 1.2;
    } else if (/웃|미소|행복|기쁨|환호/.test(line)) {
      emotion = "joy";
    } else if (cutNum === totalCuts) {
      shotScale = "worms-eye";
      cameraAngle = "low-angle";
      emotion = "determination";
      suggestedSfx = "스윽";
      heightRatio = 1.8;
    }

    return {
      cutNumber: cutNum,
      summary: line,
      dialogue,
      shotScale,
      cameraAngle,
      emotion,
      suggestedSfx,
      backgroundPrompt: `Webtoon panel staging for ${visualPromptSource(line)}, cinematic lighting, clean manhwa cel aesthetic, no speech bubbles, no readable text`,
      panelHeightRatio: heightRatio,
    };
  }
}
