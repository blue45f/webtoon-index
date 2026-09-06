/**
 * Studio Work-Centric Workspaces & Simple Mode Workflow
 *
 * CLIP STUDIO PAINT Ver.4.2.0 & Ver.5.0.0 Parity:
 * 1. Work-Centric Workspaces (7대 핵심 웹툰 공정 워크스페이스):
 *    - "스토리·콘티" (story-draft): 대본, 장면, 스토리보드, 컷 배치, AI 초안
 *    - "스케치·선화" (sketch-ink): 브러시, 지우개, 벡터, 손떨림 보정, 참조 이미지
 *    - "채색" (coloring-paint): 버킷 채우기, 색상 휠, Lab 팔레트, 마스크, 색상 보정
 *    - "말풍선·식자" (bubble-lettering): 말풍선, 텍스트, 폰트, 꼬리, 읽기 순서
 *    - "3D 배경·포즈" (bg3d-pose): 3D 데생 인형, 마네킹 포즈, 카메라 추적 조명, 배경
 *    - "애니메이션" (animation-timeline): 타임라인, 셀, 어니언 스킨, 재생
 *    - "검수·출력" (review-export): 댓글, 연속성, 플랫폼 안전영역, 플랫폼 슬라이스 출력
 * 2. Simple Mode Workflow (심플 모드):
 *    - Streamlined, beginner/tablet-friendly workflow without heavy inspectors:
 *      Canvas Size → Cut Template → Sketch → Lineart → Coloring → Bubble → Export.
 *
 * Pure, deterministic, zero-dependency.
 */

export type WorkCentricWorkspaceId =
  | "story-draft"
  | "sketch-ink"
  | "coloring-paint"
  | "bubble-lettering"
  | "bg3d-pose"
  | "animation-timeline"
  | "review-export";

export interface WorkCentricWorkspaceDescriptor {
  readonly id: WorkCentricWorkspaceId;
  readonly name: string;
  readonly description: string;
  readonly primaryTools: readonly string[];
  readonly defaultDocks: {
    readonly leftPanelVisible: boolean;
    readonly rightPanelVisible: boolean;
    readonly bottomTimelineVisible: boolean;
    readonly primaryInspectorTab: string;
  };
}

export const WORK_CENTRIC_WORKSPACES: readonly WorkCentricWorkspaceDescriptor[] = Object.freeze([
  {
    id: "story-draft",
    name: "스토리·콘티",
    description: "대본·콘티 작성과 컷 구도, 스토리보드 세로 스크롤 미리보기 및 AI 초안 검토",
    primaryTools: Object.freeze(["frame", "select", "text", "storyboard"]),
    defaultDocks: Object.freeze({
      leftPanelVisible: true,
      rightPanelVisible: true,
      bottomTimelineVisible: false,
      primaryInspectorTab: "story",
    }),
  },
  {
    id: "sketch-ink",
    name: "스케치·선화",
    description: "G펜·연필·잉크 브러시와 손떨림 보정 스트로크 프리뷰, 스마트 도형으로 정교한 작화",
    primaryTools: Object.freeze(["draw", "eraser", "smart-shape", "ruler", "reference"]),
    defaultDocks: Object.freeze({
      leftPanelVisible: true,
      rightPanelVisible: false,
      bottomTimelineVisible: false,
      primaryInspectorTab: "brush",
    }),
  },
  {
    id: "coloring-paint",
    name: "채색·보정",
    description: "고급 버킷 채우기, CIELAB 슬라이더, 색상환, 비파괴 레이어 효과 및 톤 보정",
    primaryTools: Object.freeze(["fill", "lasso-fill", "color-wheel", "eyedropper", "gradient"]),
    defaultDocks: Object.freeze({
      leftPanelVisible: true,
      rightPanelVisible: true,
      bottomTimelineVisible: false,
      primaryInspectorTab: "color",
    }),
  },
  {
    id: "bubble-lettering",
    name: "말풍선·식자",
    description: "11종 웹툰 말풍선, 대사 꼬리 편집, 세로쓰기, 루비, 읽기 순서 검증",
    primaryTools: Object.freeze(["bubble", "text", "tail-edit", "font-picker"]),
    defaultDocks: Object.freeze({
      leftPanelVisible: true,
      rightPanelVisible: true,
      bottomTimelineVisible: false,
      primaryInspectorTab: "text",
    }),
  },
  {
    id: "bg3d-pose",
    name: "3D 배경·포즈",
    description: "3D 데생 인형 머리 교체·숨김, 카메라 추적 조명, 높이 안개 및 3D 모델 배치",
    primaryTools: Object.freeze(["mannequin", "bg3d", "camera-light", "transform"]),
    defaultDocks: Object.freeze({
      leftPanelVisible: false,
      rightPanelVisible: true,
      bottomTimelineVisible: false,
      primaryInspectorTab: "3d",
    }),
  },
  {
    id: "animation-timeline",
    name: "애니메이션",
    description: "셀 애니메이션 타임라인, 어니언 스킨, 모션 이펙트 및 타임랩스 영상 내보내기",
    primaryTools: Object.freeze(["timeline", "onion-skin", "playhead", "keyframe"]),
    defaultDocks: Object.freeze({
      leftPanelVisible: false,
      rightPanelVisible: true,
      bottomTimelineVisible: true,
      primaryInspectorTab: "animation",
    }),
  },
  {
    id: "review-export",
    name: "검수·출력",
    description: "플랫폼별 세로 규격 분할(네이버/카카오), 안전 영역 가이드, 초안 숨김, ZIP 패키징",
    primaryTools: Object.freeze(["slice", "proof", "comment", "export"]),
    defaultDocks: Object.freeze({
      leftPanelVisible: true,
      rightPanelVisible: true,
      bottomTimelineVisible: false,
      primaryInspectorTab: "export",
    }),
  },
]);

// ── Simple Mode Workflow ───────────────────────────────────────────────────

export type SimpleModeStep =
  | "canvas-preset"
  | "frame-layout"
  | "sketch"
  | "lineart"
  | "coloring"
  | "bubbles"
  | "export";

export interface SimpleModeWorkflowState {
  readonly active: boolean;
  readonly currentStep: SimpleModeStep;
  readonly completedSteps: readonly SimpleModeStep[];
}

export const SIMPLE_MODE_STEPS: readonly {
  readonly step: SimpleModeStep;
  readonly title: string;
  readonly tip: string;
}[] = Object.freeze([
  { step: "canvas-preset", title: "1. 캔버스 규격", tip: "네이버(690px) 또는 카카오(720px) 웹툰 표준 규격 선택" },
  { step: "frame-layout", title: "2. 컷 템플릿", tip: "원터치 분할 컷 템플릿으로 빠른 연출 구도 잡기" },
  { step: "sketch", title: "3. 스케치", tip: "가벼운 연필로 전체적인 동선과 포즈 러프 그리기" },
  { step: "lineart", title: "4. 선화 작화", tip: "손떨림 보정 G펜과 스마트 도형으로 깔끔한 외곽선 마감" },
  { step: "coloring", title: "5. 채색", tip: "틈 닫기 버킷과 레이어 스타일 효과로 밑색·그림자 완성" },
  { step: "bubbles", title: "6. 말풍선·식자", tip: "말풍선과 대사를 배치하여 이야기 호흡 완성" },
  { step: "export", title: "7. 출력·게시", tip: "초안 레이어 자동 제외 후 완성 원고 다운로드" },
]);

export const DEFAULT_SIMPLE_MODE_STATE: SimpleModeWorkflowState = Object.freeze({
  active: false,
  currentStep: "sketch",
  completedSteps: Object.freeze([]),
});

/**
 * Transitions to the next step in the Simple Mode workflow.
 */
export function advanceSimpleModeStep(state: SimpleModeWorkflowState): SimpleModeWorkflowState {
  const steps: readonly SimpleModeStep[] = [
    "canvas-preset",
    "frame-layout",
    "sketch",
    "lineart",
    "coloring",
    "bubbles",
    "export",
  ];
  const currentIndex = steps.indexOf(state.currentStep);
  if (currentIndex < 0 || currentIndex >= steps.length - 1) {
    return state;
  }
  const nextStep = steps[currentIndex + 1];
  const nextCompleted = Array.from(new Set([...state.completedSteps, state.currentStep]));

  return Object.freeze({
    active: true,
    currentStep: nextStep,
    completedSteps: Object.freeze(nextCompleted),
  });
}
