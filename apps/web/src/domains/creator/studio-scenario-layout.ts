/**
 * Studio Scenario Layout — 시나리오 자동 생성(장면 분할 결과)을 캔버스 컷 배치로 변환하는 순수 코어.
 *
 * studio-dialogue.ts의 parseDialogueScript/layoutDialogueBubbles를 그대로 재사용한다(대사 파싱·
 * 좌우 자동 배치 로직을 중복 구현하지 않는다) — 각 장면의 dialogue 필드는 기존 "대사 한 번에"
 * 말풍선 삽입 기능과 동일한 미니 문법("이름: 대사" / "(지문)")이다(studio-scenario-scenes.ts의
 * 프롬프트가 이 문법으로 응답하도록 모델에 지시한다).
 *
 * 프레임 배치는 StudioPage.addFrame()의 "가장 아래 프레임 다음에 이어붙이기" 정책을 여러 장면
 * 배치용으로 일반화한 것이다 — 항상 현재 페이지의 기존 컷 아래로 세로 스크롤 웹툰처럼 이어붙인다
 * (완전히 새 페이지를 만들지 않는다 — 기존 장면 템플릿/대사 일괄 삽입 기능과 동일하게 "현재 페이지에
 * 이어붙이기"를 관례로 따른다. 사용자가 새 페이지에 생성하고 싶으면 먼저 페이지를 추가하면 된다).
 *
 * 각 패널의 높이는 그 장면 대사량(말풍선 스택 높이)에 맞춰 자동으로 정해진다(최소/최대 상한 有).
 *
 * Konva/DOM 의존 없음, 순수·결정적.
 */

import { layoutDialogueBubbles, parseDialogueScript, type DialogueBubbleSeed } from "./studio-dialogue";
import { normalizeScenarioBeatType, type ScenarioBeatType } from "./studio-story-beats";

import type { StudioStoryBeat } from "./studio-continuity";
import type { StudioPublishAiProvenance } from "./studio-publish-preflight";

const MARGIN = 24;
const MIN_FRAME_HEIGHT = 360;
const MAX_FRAME_HEIGHT = 900;
const BUBBLE_TOP_PAD = 32;
const BUBBLE_BOTTOM_PAD = 32;

export type ScenarioFrameRect = { x: number; y: number; width: number; height: number };

/** studio-scenario-scenes.ScenarioSceneDraft와 구조 호환(그 타입을 직접 import하지 않아 두 모듈이
 *  서로 독립적으로 테스트 가능 — studio-ai-client.ts가 둘을 이어붙인다). */
export interface ScenarioSceneInput {
  beatType?: ScenarioBeatType;
  summary?: string;
  imagePrompt: string;
  dialogue: string;
  continuity?: Omit<StudioStoryBeat, "sceneId">;
}

/** 패널 가로세로 비를 3단계로 단순화 — AI 이미지 생성 사이즈 프리셋(정사각/세로/가로) 선택에만 쓰인다
 *  (studio-ai-client.StudioAiImageSize로의 매핑은 호출부 책임 — 이 모듈은 AI 클라이언트를 모른다). */
export type ScenarioPanelAspect = "square" | "portrait" | "landscape";

export function scenarioPanelAspect(width: number, height: number): ScenarioPanelAspect {
  if (height <= 0) return "square";
  const ratio = width / height;
  if (ratio > 1.2) return "landscape";
  if (ratio < 1 / 1.2) return "portrait";
  return "square";
}

export interface ScenarioPanelSeed {
  frame: ScenarioFrameRect;
  bubbles: DialogueBubbleSeed[];
  beatType: ScenarioBeatType;
  summary: string;
  imagePrompt: string;
  /** 원본 미니 문법을 함께 보존해 미리보기 단계에서 사용자가 장면별 대사를 고치고 다시
   * 레이아웃할 수 있게 한다. bubbles만 남기면 화자 표기와 지문 문법을 복원할 수 없다. */
  dialogue: string;
  continuity?: Omit<StudioStoryBeat, "sceneId">;
  aspect: ScenarioPanelAspect;
}

/** 미리보기 카드 1개 — ScenarioPanelSeed(레이아웃 계산 결과) + 이미지 생성 결과(성공/실패는 상호
 *  배타적이지 않게 둘 다 optional로 둔다 — "아직 생성 전"은 둘 다 없음으로 표현). */
export interface ScenarioPreviewItem extends ScenarioPanelSeed {
  imageDataUrl?: string;
  imageError?: string;
  imageProvenance?: StudioPublishAiProvenance;
}

export interface ScenarioLayoutResult {
  panels: ScenarioPanelSeed[];
  /** 마지막 패널 하단 + 여백까지 반영한 페이지 캔버스 높이(기존 canvasH보다 작아지지 않는다). */
  nextCanvasH: number;
}

/**
 * 기존 프레임들 다음에 장면(scene) 개수만큼 새 패널을 세로로 이어붙인다. 빈 scenes 배열이면 빈
 * 결과(panels: [], nextCanvasH: 기존 canvasH 그대로 — 축소하지 않는다).
 */
export function layoutScenarioPanels(
  existingFrames: readonly ScenarioFrameRect[],
  canvasW: number,
  canvasH: number,
  scenes: readonly ScenarioSceneInput[]
): ScenarioLayoutResult {
  const frameW = Math.max(1, canvasW - MARGIN * 2);
  const bottomFrame = existingFrames.reduce<ScenarioFrameRect | null>(
    (best, f) => (!best || f.y + f.height > best.y + best.height ? f : best),
    null
  );
  let cursorY = bottomFrame ? bottomFrame.y + bottomFrame.height + MARGIN : MARGIN;
  const panels: ScenarioPanelSeed[] = [];

  for (const scene of scenes) {
    const lines = parseDialogueScript(scene.dialogue);
    const seedsAtOrigin = lines.length > 0 ? layoutDialogueBubbles(lines, { canvasWidth: frameW, startY: 0 }) : [];
    const bubbleStackHeight = seedsAtOrigin.reduce((max, s) => Math.max(max, s.y + s.height), 0);
    const height = Math.min(
      MAX_FRAME_HEIGHT,
      Math.max(
        MIN_FRAME_HEIGHT,
        bubbleStackHeight > 0 ? bubbleStackHeight + BUBBLE_TOP_PAD + BUBBLE_BOTTOM_PAD : MIN_FRAME_HEIGHT
      )
    );
    const frame: ScenarioFrameRect = { x: MARGIN, y: cursorY, width: frameW, height };
    const bubbles: DialogueBubbleSeed[] = seedsAtOrigin.map((s) => ({
      ...s,
      x: s.x + frame.x,
      y: s.y + frame.y + BUBBLE_TOP_PAD,
    }));
    panels.push({
      frame,
      bubbles,
      beatType: normalizeScenarioBeatType(scene.beatType),
      summary: scene.summary?.trim() || scene.imagePrompt.trim() || scene.dialogue.trim().split("\n")[0] || "장면",
      imagePrompt: scene.imagePrompt,
      dialogue: scene.dialogue,
      ...(scene.continuity ? { continuity: scene.continuity } : {}),
      aspect: scenarioPanelAspect(frame.width, frame.height),
    });
    cursorY = frame.y + frame.height + MARGIN;
  }

  return { panels, nextCanvasH: Math.max(canvasH, cursorY) };
}
