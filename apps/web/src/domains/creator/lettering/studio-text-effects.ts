/**
 * Studio Text Effects Presets
 * 웹툰 효과음(SFX)/대사 텍스트 연출용 원클릭 스타일 프리셋.
 * 각 patch는 StudioPage의 TextEl 필드(fill/stroke/그림자/그라디언트)에 그대로 매핑된다.
 * Konva/DOM 의존 없음 — StudioPage 텍스트 인스펙터와 단위 테스트가 공유한다.
 */

// ---------------------------------------------------------------------------
// 텍스트 스타일 패치 — TextEl의 연출 관련 필드 부분집합(미지정 키는 원본 유지)
// ---------------------------------------------------------------------------

export type TextFxPatch = {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  fontStyle?: "normal" | "bold" | "italic" | "bold italic";
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowOpacity?: number;
  fillType?: "solid" | "gradient";
  gradientColorStart?: string;
  gradientColorEnd?: string;
  gradientDirection?: "vertical" | "horizontal";
};

/** 모든 텍스트 연출 키를 명시적으로 undefined로 채운 패치 — 기존 스타일 제거(원본 복귀)용. */
export function textFxResetPatch(): TextFxPatch {
  return {
    fill: undefined,
    stroke: undefined,
    strokeWidth: undefined,
    fontStyle: undefined,
    shadowColor: undefined,
    shadowBlur: undefined,
    shadowOffsetX: undefined,
    shadowOffsetY: undefined,
    shadowOpacity: undefined,
    fillType: undefined,
    gradientColorStart: undefined,
    gradientColorEnd: undefined,
    gradientDirection: undefined,
  };
}

export type TextFxPreset = { id: string; label: string; tip: string; patch: TextFxPatch };

// 웹툰 효과음/대사 연출 중심 원클릭 프리셋.
// 값 범위: strokeWidth 0..20, shadowBlur 0..40, shadowOffsetX/Y -20..20, shadowOpacity 0..1.
// gradient 프리셋은 fillType:"gradient" + gradientColorStart/End를 함께 지정한다. 색은 #rrggbb.
export const TEXT_FX_PRESETS: TextFxPreset[] = [
  { id: "plain", label: "기본", tip: "모든 텍스트 효과를 제거하고 원본 스타일로 되돌립니다.", patch: textFxResetPatch() },
  {
    id: "outline-bold",
    label: "외곽선 굵게",
    tip: "흰 글자에 검은 외곽선을 둘러 어떤 배경에서도 또렷하게 보이게 합니다.",
    patch: { fill: "#ffffff", stroke: "#000000", strokeWidth: 4, fontStyle: "bold" },
  },
  {
    id: "impact",
    label: "충격",
    tip: "빨간 글자에 검은 외곽선과 그림자로 강한 충격 효과음을 연출합니다.",
    patch: {
      fill: "#ff2d2d",
      stroke: "#000000",
      strokeWidth: 5,
      fontStyle: "bold",
      shadowColor: "#000000",
      shadowBlur: 6,
      shadowOffsetX: 3,
      shadowOffsetY: 3,
      shadowOpacity: 0.7,
    },
  },
  {
    id: "scream",
    label: "비명",
    tip: "굵은 글자에 강한 외곽선을 더해 터져 나오는 비명을 표현합니다.",
    patch: { fill: "#ffffff", stroke: "#111111", strokeWidth: 8, fontStyle: "bold italic" },
  },
  {
    id: "whisper",
    label: "속삭임",
    tip: "연한 회색 글자에 옅은 그림자로 작게 속삭이는 대사를 만듭니다.",
    patch: {
      fill: "#9aa0a6",
      shadowColor: "#000000",
      shadowBlur: 2,
      shadowOffsetX: 0,
      shadowOffsetY: 1,
      shadowOpacity: 0.25,
    },
  },
  {
    id: "horror",
    label: "공포",
    tip: "검은 글자에 번지는 핏빛 그림자로 오싹한 공포 분위기를 냅니다.",
    patch: {
      fill: "#0a0a0a",
      shadowColor: "#a40000",
      shadowBlur: 12,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      shadowOpacity: 0.85,
    },
  },
  {
    id: "metal",
    label: "금속",
    tip: "밝은 회색에서 어두운 회색으로 떨어지는 그라디언트로 금속 질감을 입힙니다.",
    patch: {
      stroke: "#3a3a3a",
      strokeWidth: 2,
      fontStyle: "bold",
      fillType: "gradient",
      gradientColorStart: "#f2f2f2",
      gradientColorEnd: "#6e6e6e",
      gradientDirection: "vertical",
    },
  },
  {
    id: "neon",
    label: "네온",
    tip: "밝은 색 글자에 같은 색의 넓은 글로우 그림자로 네온사인처럼 빛나게 합니다.",
    patch: {
      fill: "#39ff14",
      shadowColor: "#39ff14",
      shadowBlur: 24,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      shadowOpacity: 0.9,
      fontStyle: "bold",
    },
  },
  {
    id: "cartoon-sfx",
    label: "만화 효과음",
    tip: "노란 글자에 굵은 검은 외곽선으로 통통 튀는 만화 효과음을 만듭니다.",
    patch: { fill: "#ffd400", stroke: "#000000", strokeWidth: 7, fontStyle: "bold" },
  },
  {
    id: "rainbow",
    label: "무지개 그라디언트",
    tip: "보라에서 빨강으로 흐르는 무지개빛 그라디언트로 화사하게 강조합니다.",
    patch: {
      fontStyle: "bold",
      fillType: "gradient",
      gradientColorStart: "#a000ff",
      gradientColorEnd: "#ff0040",
      gradientDirection: "horizontal",
    },
  },
  {
    id: "sunset",
    label: "석양 그라디언트",
    tip: "주황에서 분홍으로 번지는 노을빛 그라디언트를 입힙니다.",
    patch: {
      fillType: "gradient",
      gradientColorStart: "#ff7a18",
      gradientColorEnd: "#ff4f9a",
      gradientDirection: "vertical",
    },
  },
  {
    id: "ice",
    label: "얼음",
    tip: "하늘색 그라디언트에 흰 외곽선을 더해 시린 얼음 효과음을 만듭니다.",
    patch: {
      stroke: "#ffffff",
      strokeWidth: 3,
      fontStyle: "bold",
      fillType: "gradient",
      gradientColorStart: "#cdeeff",
      gradientColorEnd: "#3aa6e0",
      gradientDirection: "vertical",
    },
  },
  {
    id: "flame",
    label: "불꽃",
    tip: "빨강에서 노랑으로 타오르는 그라디언트로 불꽃 효과음을 연출합니다.",
    patch: {
      stroke: "#5a1500",
      strokeWidth: 3,
      fontStyle: "bold",
      fillType: "gradient",
      gradientColorStart: "#d40000",
      gradientColorEnd: "#ffd000",
      gradientDirection: "vertical",
    },
  },
  {
    id: "shadow-pop",
    label: "그림자 강조",
    tip: "오프셋이 큰 검은 그림자로 글자를 배경에서 도드라지게 띄웁니다.",
    patch: {
      fill: "#ffffff",
      fontStyle: "bold",
      shadowColor: "#000000",
      shadowBlur: 4,
      shadowOffsetX: 8,
      shadowOffsetY: 8,
      shadowOpacity: 0.6,
    },
  },
  {
    id: "punch",
    label: "펀치",
    tip: "굵은 글자에 큰 외곽선과 묵직한 그림자로 강타하는 타격감을 줍니다.",
    patch: {
      fill: "#ffffff",
      stroke: "#000000",
      strokeWidth: 10,
      fontStyle: "bold italic",
      shadowColor: "#000000",
      shadowBlur: 10,
      shadowOffsetX: 5,
      shadowOffsetY: 5,
      shadowOpacity: 0.65,
    },
  },
  {
    id: "vintage",
    label: "빈티지",
    tip: "세피아빛 글자에 갈색 외곽선으로 오래된 활자 느낌을 냅니다.",
    patch: { fill: "#e9d8a6", stroke: "#5c4326", strokeWidth: 3, fontStyle: "italic" },
  },
];
