/**
 * Studio Emotional & Color Script Engine — 회차·장면별 긴장·희망·공포·유머 감정 곡선과
 * 색채 팔레트(명도·채도·조명 키) 및 연출 밀도(클로즈업·대사·배경)를 설계·검증하는 코어.
 *
 * 마스터플랜 9.5 (Emotional·Color Script) & 41개 경쟁제품 기능 갭 전수 비교:
 * - 장면·비트별 긴장(Tension), 희망(Hope), 공포(Fear), 유머(Humor) 4축 감정 곡선
 * - 팔레트(Key/Secondary/Accent), 조명 톤, 평균 명도·채도 계획
 * - 컷·대사 밀도, 클로즈업 빈도, 배경 디테일 수준 연계
 * - 감정 곡선과 색채 톤의 일치도 검증 및 급격한 단절 경고
 * - 순수 함수, 불변성, 결정론, DOM/React 무관
 */

export const STUDIO_EMOTIONAL_COLOR_SCRIPT_VERSION = 1 as const;

export const STUDIO_EMOTIONAL_LIMITS = Object.freeze({
  maxScenes: 512,
  maxPointsPerScript: 1_024,
  maxColorsPerPalette: 16,
  maxIdLength: 128,
  maxNameLength: 160,
  maxDiagnostics: 256,
});

export const LIGHTING_TONE_KEYS = [
  "warm-day",
  "cool-night",
  "neon-glow",
  "high-contrast-noir",
  "golden-sunset",
  "overcast-fog",
  "dramatic-red",
  "eerie-green",
] as const;
export type LightingToneKey = (typeof LIGHTING_TONE_KEYS)[number];

export const BACKGROUND_DETAIL_LEVELS = [
  "minimal",
  "standard",
  "dense",
  "hyper-detailed",
] as const;
export type BackgroundDetailLevel = (typeof BACKGROUND_DETAIL_LEVELS)[number];

export interface EmotionalIntensityVector {
  readonly tension: number; // 0..1
  readonly hope: number; // 0..1
  readonly fear: number; // 0..1
  readonly humor: number; // 0..1
}

export interface SceneColorPalette {
  readonly primaryColor: string; // hex
  readonly secondaryColor: string; // hex
  readonly accentColor: string; // hex
  readonly lightingTone: LightingToneKey;
  readonly targetLuminance: number; // 0..1 (0: Dark, 1: High key)
  readonly targetSaturation: number; // 0..1
}

export interface ScenePacingDensity {
  readonly closeUpRatio: number; // 0..1
  readonly panelDensity: number; // 컷 수 / 페이지 또는 씬
  readonly dialogueWordCount: number;
  readonly backgroundDetail: BackgroundDetailLevel;
  readonly audioOrSfxCue?: string;
}

export interface SceneEmotionalColorNode {
  readonly id: string;
  readonly sceneId: string;
  readonly sceneTitle: string;
  readonly sequenceIndex: number;
  readonly emotions: EmotionalIntensityVector;
  readonly palette: SceneColorPalette;
  readonly pacing: ScenePacingDensity;
}

export interface StudioEmotionalColorScript {
  readonly version: typeof STUDIO_EMOTIONAL_COLOR_SCRIPT_VERSION;
  readonly id: string;
  readonly episodeId: string;
  readonly nodes: readonly SceneEmotionalColorNode[];
}

export interface EmotionalScriptDiagnostic {
  readonly code:
    | "CLIMAX_TENSION_TOO_LOW"
    | "DISCORDANT_COLOR_MOOD"
    | "ABRUPT_TONE_JUMP"
    | "OVERCROWDED_PACING";
  readonly sceneId: string;
  readonly message: string;
  readonly severity: "warning" | "info";
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

export function createStudioEmotionalColorScript(params: {
  id: string;
  episodeId: string;
  nodes?: readonly SceneEmotionalColorNode[];
}): StudioEmotionalColorScript {
  const sanitizedNodes = (params.nodes ?? []).map((node) =>
    Object.freeze({
      ...node,
      emotions: Object.freeze({
        tension: clamp01(node.emotions.tension),
        hope: clamp01(node.emotions.hope),
        fear: clamp01(node.emotions.fear),
        humor: clamp01(node.emotions.humor),
      }),
      palette: Object.freeze({
        ...node.palette,
        targetLuminance: clamp01(node.palette.targetLuminance),
        targetSaturation: clamp01(node.palette.targetSaturation),
      }),
      pacing: Object.freeze({
        ...node.pacing,
        closeUpRatio: clamp01(node.pacing.closeUpRatio),
      }),
    }),
  );

  return Object.freeze({
    version: STUDIO_EMOTIONAL_COLOR_SCRIPT_VERSION,
    id: params.id.trim(),
    episodeId: params.episodeId.trim(),
    nodes: Object.freeze(sanitizedNodes.sort((a, b) => a.sequenceIndex - b.sequenceIndex)),
  });
}

export function addEmotionalNode(
  script: StudioEmotionalColorScript,
  node: SceneEmotionalColorNode,
): StudioEmotionalColorScript {
  if (script.nodes.some((n) => n.id === node.id)) {
    throw new Error(`Node ${node.id} already exists`);
  }
  const next = [...script.nodes, node].sort((a, b) => a.sequenceIndex - b.sequenceIndex);
  return createStudioEmotionalColorScript({
    id: script.id,
    episodeId: script.episodeId,
    nodes: next,
  });
}

export function updateEmotionalNode(
  script: StudioEmotionalColorScript,
  nodeId: string,
  patch: Partial<Omit<SceneEmotionalColorNode, "id">>,
): StudioEmotionalColorScript {
  const index = script.nodes.findIndex((n) => n.id === nodeId);
  if (index === -1) {
    throw new Error(`Node ${nodeId} not found`);
  }
  const updated: SceneEmotionalColorNode = { ...script.nodes[index], ...patch };
  const next = [...script.nodes];
  next[index] = updated;
  return createStudioEmotionalColorScript({
    id: script.id,
    episodeId: script.episodeId,
    nodes: next,
  });
}

/**
 * 감정 스크립트와 컬러 톤 및 연출 템포의 정합성을 검증한다.
 */
export function validateEmotionalColorScript(
  script: StudioEmotionalColorScript,
): readonly EmotionalScriptDiagnostic[] {
  const diagnostics: EmotionalScriptDiagnostic[] = [];

  for (let i = 0; i < script.nodes.length; i += 1) {
    const node = script.nodes[i];

    // 1. 공포/긴장도가 극도로 높은데 지나치게 밝고 채도가 높은 불일치 탐지
    const stress = Math.max(node.emotions.tension, node.emotions.fear);
    if (stress > 0.85 && node.palette.targetLuminance > 0.85 && node.palette.targetSaturation > 0.85) {
      diagnostics.push({
        code: "DISCORDANT_COLOR_MOOD",
        sceneId: node.sceneId,
        message: `장면 '${node.sceneTitle}'의 긴장/공포 지수(${stress.toFixed(2)})에 비해 명도·채도가 지나치게 높습니다(하이키 설정). 의도된 대비인지 확인하세요.`,
        severity: "warning",
      });
    }

    // 2. 인접 장면 간 급격한 감정 톤 점프
    if (i > 0) {
      const prev = script.nodes[i - 1];
      const deltaTension = Math.abs(node.emotions.tension - prev.emotions.tension);
      const deltaFear = Math.abs(node.emotions.fear - prev.emotions.fear);
      if (deltaTension > 0.7 || deltaFear > 0.7) {
        diagnostics.push({
          code: "ABRUPT_TONE_JUMP",
          sceneId: node.sceneId,
          message: `이전 장면 '${prev.sceneTitle}' 대비 긴장도/공포 변화가 급격합니다(Δ>${Math.max(deltaTension, deltaFear).toFixed(2)}). 완충 비트 필요 여부를 검토하세요.`,
          severity: "info",
        });
      }
    }

    // 3. 대사 과밀 + 클로즈업 과다로 인한 답답함 탐지
    if (node.pacing.dialogueWordCount > 400 && node.pacing.closeUpRatio > 0.85) {
      diagnostics.push({
        code: "OVERCROWDED_PACING",
        sceneId: node.sceneId,
        message: `장면 '${node.sceneTitle}'에 대사량(${node.pacing.dialogueWordCount}단어)과 클로즈업 비율(${Math.round(node.pacing.closeUpRatio * 100)}%)이 과밀합니다.`,
        severity: "warning",
      });
    }
  }

  return Object.freeze(diagnostics);
}
