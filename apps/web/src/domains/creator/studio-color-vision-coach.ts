import type { CvdMatrixMode, CvdMode } from "./studio-color-vision-model";
import type { StudioToolHintSpec } from "./studio-tool-hints";

/**
 * Rich-coach copy and filter data live behind Studio's optional hint/menu
 * boundaries. Keep this module out of the eager canvas graph: the live canvas
 * only needs the compact filter model in `studio-color-vision-model`.
 */
export const STUDIO_COLOR_VISION_HINTS = {
  none: {
    id: "color-vision:original",
    title: "원본 색상",
    description: "흑백·색각 시뮬레이션을 끄고 캔버스의 원래 색을 표시합니다. 원고 데이터는 어느 모드에서도 변경되지 않습니다.",
    preview: "color-vision",
    previewVariant: "original",
    tip: "시뮬레이션으로 문제를 찾은 뒤 원본으로 돌아와 실제 색을 조정하세요.",
  },
  grayscale: {
    id: "color-vision:grayscale",
    title: "흑백 명암 보기",
    description: "색을 제거한 화면으로 밝고 어두운 값의 구분과 인물·배경의 명암 대비를 확인합니다. 원본 색은 보존됩니다.",
    // 2026-08-08: 단독 `Q` 는 퀵 마스크가 가져갔다(conflict `q-quickmask-vs-grayscale`).
    // 힌트·메뉴 배지·보기 리졸버가 같은 값을 말해야 하므로 여기도 `⌥Q`.
    shortcut: "⌥Q",
    preview: "color-vision",
    previewVariant: "grayscale",
    tip: "중요한 인물과 말풍선이 배경에 묻히지 않는지 먼저 확인하세요.",
  },
  protanopia: {
    id: "color-vision:protanopia",
    title: "1형 적록 색각 보기",
    description: "적색 계열 구분이 어려운 1형 적록 색각을 Viénot 단일 행렬로 근사해 색 대비를 점검합니다.",
    preview: "color-vision",
    previewVariant: "protanopia",
    tip: "빨강·초록만으로 상태를 구분하지 말고 명도, 패턴, 아이콘을 함께 사용하세요.",
  },
  deuteranopia: {
    id: "color-vision:deuteranopia",
    title: "2형 적록 색각 보기",
    description: "녹색 계열 구분이 어려운 2형 적록 색각을 Viénot 단일 행렬로 근사해 색 대비를 점검합니다.",
    preview: "color-vision",
    previewVariant: "deuteranopia",
    tip: "대사 강조나 효과음이 색 하나에만 의존하지 않는지 확인하세요.",
  },
  tritanopia: {
    id: "color-vision:tritanopia",
    title: "3형 청황 색각 보기",
    description: "파랑·노랑 계열 구분이 어려운 3형 청황 색각을 단일 행렬로 근사합니다. 세 시뮬레이션 중 정확도 한계가 가장 큽니다.",
    preview: "color-vision",
    previewVariant: "tritanopia",
    tip: "최종 접근성 판단에는 대비 검사와 실제 사용자 검토를 함께 사용하세요.",
  },
} as const satisfies Readonly<Record<CvdMode, StudioToolHintSpec>>;

/**
 * Optional-coach copies of the live filter values. Equality is protected by
 * regression tests so Rollup can keep the coach out of Studio's eager graph
 * without adding a shared static request.
 */
export const STUDIO_COLOR_VISION_COACH_GRAYSCALE_SATURATION = "0";

export const STUDIO_COLOR_VISION_COACH_MATRIX: Readonly<Record<CvdMatrixMode, string>> = {
  protanopia:
    "0.10889,0.89111,-0.00000,0,0 0.10889,0.89111,0.00000,0,0 0.00447,-0.00447,1.00000,0,0 0,0,0,1,0",
  deuteranopia:
    "0.29031,0.70969,-0.00000,0,0 0.29031,0.70969,-0.00000,0,0 -0.02197,0.02197,1.00000,0,0 0,0,0,1,0",
  tritanopia:
    "1.00000,0.15236,-0.15236,0,0 0.00000,0.86717,0.13283,0,0 -0.00000,0.86717,0.13283,0,0 0,0,0,1,0",
};
