/**
 * Studio Image Layer Styles
 * 포토샵 레이어 스타일(드롭 섀도/외곽 글로우/둥근 모서리) 원클릭 프리셋.
 * Konva.Image가 그림자/모서리를 네이티브로 그리므로 여기엔 픽셀 필터가 없다 —
 * 프리셋·슬라이더 범위·활성 판정만 담는 순수 데이터/헬퍼 모듈이다.
 * 추가로 스티커 테두리(studio-outline)와 그림자를 한 번에 세팅하는 콤보 프리셋을 담는다
 * (웹툰 스티커의 흰 테두리+그림자, 이중 테두리, 네온 글로우+테두리).
 * Konva/DOM 의존 없음 — StudioPage 인스펙터와 단위 테스트가 공유한다.
 */

import { normalizeOutline, type Outline } from "../studio-outline";

// ---------------------------------------------------------------------------
// 레이어 스타일 패치 — Konva.Image가 네이티브로 지원하는 그림자/모서리 속성에 대응.
// 미지정 키는 원본 유지(원본 복귀 시 6개 키 전부 undefined).
// ---------------------------------------------------------------------------

export type LayerStylePatch = {
  shadowColor?: string;      // 그림자/글로우 색(#rrggbb)
  shadowBlur?: number;       // 번짐 0..60
  shadowOffsetX?: number;    // 가로 오프셋 -40..40
  shadowOffsetY?: number;    // 세로 오프셋 -40..40
  shadowOpacity?: number;    // 0..1
  cornerRadius?: number;     // 모서리 둥글기(px) 0..120
};

// ---------------------------------------------------------------------------
// 레이어 스타일 범위(인스펙터 슬라이더용) — 모든 프리셋 수치가 이 안에 들어간다.
// ---------------------------------------------------------------------------

export const LAYER_STYLE_RANGES: Record<
  "shadowBlur" | "shadowOffsetX" | "shadowOffsetY" | "shadowOpacity" | "cornerRadius",
  { min: number; max: number; step: number }
> = {
  shadowBlur: { min: 0, max: 60, step: 1 },
  shadowOffsetX: { min: -40, max: 40, step: 1 },
  shadowOffsetY: { min: -40, max: 40, step: 1 },
  shadowOpacity: { min: 0, max: 1, step: 0.05 },
  cornerRadius: { min: 0, max: 120, step: 1 },
};

/** 6개 레이어 스타일 키를 명시적으로 undefined로 채운 패치 — 기존 스타일 제거(원본 복귀)용. */
export function layerStyleResetPatch(): LayerStylePatch {
  return {
    shadowColor: undefined,
    shadowBlur: undefined,
    shadowOffsetX: undefined,
    shadowOffsetY: undefined,
    shadowOpacity: undefined,
    cornerRadius: undefined,
  };
}

/**
 * 레이어 스타일이 눈에 보이는 효과를 내는지.
 * 그림자 활성 = shadowColor가 있고 (shadowBlur/offsetX/offsetY 중 하나가 0이 아니고)
 *               shadowOpacity(없으면 1)가 0보다 클 때.
 * 또는 cornerRadius가 0보다 클 때. (없는 blur/offset은 0, 없는 opacity는 1로 본다.)
 */
export function hasActiveLayerStyle(el: LayerStylePatch): boolean {
  const radius = el.cornerRadius;
  if (typeof radius === "number" && radius > 0) return true;

  if (!el.shadowColor) return false;
  // 번짐/오프셋이 전부 0이면 그림자가 보이지 않는다.
  const hasSpread =
    (el.shadowBlur ?? 0) !== 0 || (el.shadowOffsetX ?? 0) !== 0 || (el.shadowOffsetY ?? 0) !== 0;
  if (!hasSpread) return false;
  // 불투명도 미지정은 1(완전 불투명)로 취급.
  const opacity = el.shadowOpacity ?? 1;
  return opacity > 0;
}

// ---------------------------------------------------------------------------
// 원클릭 레이어 스타일 프리셋 — 이미지 한 장에 적용할 그림자/모서리 묶음(patch)
// ---------------------------------------------------------------------------

export type LayerStylePreset = { id: string; label: string; tip: string; patch: LayerStylePatch };

// 웹툰 연출 중심 레이어 스타일 프리셋. 모든 수치는 LAYER_STYLE_RANGES 안, 색은 #rrggbb.
export const LAYER_STYLE_PRESETS: LayerStylePreset[] = [
  { id: "none", label: "기본", tip: "모든 레이어 스타일을 제거하고 원본으로 되돌립니다.", patch: layerStyleResetPatch() },
  {
    id: "soft-shadow",
    label: "소프트 섀도",
    tip: "은은하게 번지는 검은 그림자로 컷을 살짝 띄웁니다.",
    patch: { shadowColor: "#000000", shadowBlur: 12, shadowOffsetX: 0, shadowOffsetY: 6, shadowOpacity: 0.35 },
  },
  {
    id: "drop-shadow",
    label: "드롭 섀도",
    tip: "또렷한 오프셋 그림자로 입체감을 줍니다.",
    patch: { shadowColor: "#000000", shadowBlur: 8, shadowOffsetX: 6, shadowOffsetY: 8, shadowOpacity: 0.5 },
  },
  {
    id: "long-shadow",
    label: "롱 섀도",
    tip: "길게 늘어진 그림자로 플랫 디자인 느낌을 냅니다.",
    patch: { shadowColor: "#000000", shadowBlur: 4, shadowOffsetX: 18, shadowOffsetY: 18, shadowOpacity: 0.35 },
  },
  {
    id: "floating",
    label: "떠있는",
    tip: "넓고 부드러운 아래 그림자로 공중에 뜬 듯 보이게 합니다.",
    patch: { shadowColor: "#000000", shadowBlur: 24, shadowOffsetX: 0, shadowOffsetY: 14, shadowOpacity: 0.3 },
  },
  {
    id: "outer-glow-white",
    label: "외곽 글로우 흰",
    tip: "흰 글로우로 어떤 배경에서도 컷 외곽을 또렷하게 띄웁니다.",
    patch: { shadowColor: "#ffffff", shadowBlur: 18, shadowOffsetX: 0, shadowOffsetY: 0, shadowOpacity: 0.9 },
  },
  {
    id: "neon-glow",
    label: "네온 글로우",
    tip: "하늘색 네온 글로우로 사이버펑크 무드를 더합니다.",
    patch: { shadowColor: "#38bdf8", shadowBlur: 22, shadowOffsetX: 0, shadowOffsetY: 0, shadowOpacity: 0.95 },
  },
  {
    id: "rounded-card",
    label: "둥근 카드",
    tip: "둥근 모서리에 부드러운 그림자를 더해 카드처럼 만듭니다.",
    patch: { cornerRadius: 18, shadowColor: "#000000", shadowBlur: 14, shadowOffsetX: 0, shadowOffsetY: 8, shadowOpacity: 0.35 },
  },
  {
    id: "sticker",
    label: "스티커",
    tip: "둥근 모서리에 흰 테두리 글로우와 드롭 섀도로 스티커처럼 떼어 붙입니다.",
    patch: { cornerRadius: 24, shadowColor: "#ffffff", shadowBlur: 6, shadowOffsetX: 2, shadowOffsetY: 4, shadowOpacity: 0.85 },
  },
  {
    id: "paper-lift",
    label: "종이 들뜸",
    tip: "살짝 둥근 모서리와 짧은 그림자로 종이가 들뜬 느낌을 냅니다.",
    patch: { cornerRadius: 6, shadowColor: "#000000", shadowBlur: 4, shadowOffsetX: 2, shadowOffsetY: 4, shadowOpacity: 0.4 },
  },
];

// ---------------------------------------------------------------------------
// 콤보 프리셋 — 레이어 스타일(그림자)과 스티커 테두리(outline)를 한 클릭에 함께 세팅.
// layer는 reset 위에 덮어써 절대값으로 적용하고, outline은 el.outline을 통째로 교체한다.
// 모든 layer 수치는 LAYER_STYLE_RANGES 안, outline은 normalizeOutline을 통과한 값.
// ---------------------------------------------------------------------------

export type ComboLayerStylePreset = {
  id: string;
  label: string;
  tip: string;
  /** layerStyleResetPatch() 위에 덮어쓸 그림자/모서리 패치(빈 객체면 그림자 제거만). */
  layer: LayerStylePatch;
  /** el.outline에 절대값으로 세팅할 테두리. */
  outline: Outline;
};

export const COMBO_LAYER_STYLE_PRESETS: ComboLayerStylePreset[] = [
  {
    id: "sticker-outline-shadow",
    label: "스티커(흰 테두리+그림자)",
    tip: "도톰한 흰 테두리와 부드러운 그림자로 다이컷 스티커처럼 떼어 붙입니다.",
    layer: { shadowColor: "#000000", shadowBlur: 10, shadowOffsetX: 0, shadowOffsetY: 6, shadowOpacity: 0.4 },
    outline: normalizeOutline({ color: "#ffffff", width: 10, opacity: 100 }),
  },
  {
    id: "double-outline",
    label: "이중 테두리",
    tip: "안쪽 흰 테두리에 바깥 검정 라인을 두른 웹툰 스티커 이중 테두리입니다(그림자 없음).",
    layer: {},
    outline: normalizeOutline({ color: "#ffffff", width: 6, opacity: 100, secondColor: "#111111", secondWidth: 3 }),
  },
  {
    id: "neon-glow-outline",
    label: "네온(글로우+테두리)",
    tip: "시안 테두리와 하늘색 글로우를 겹쳐 빛나는 네온 사인을 만듭니다.",
    layer: { shadowColor: "#38bdf8", shadowBlur: 22, shadowOffsetX: 0, shadowOffsetY: 0, shadowOpacity: 0.95 },
    outline: normalizeOutline({ color: "#00e5ff", width: 4, opacity: 100 }),
  },
];
