/** Searchable, reorderable, non-destructive smart-filter stack for image elements. */
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useId, useState } from "react";

import {
  STUDIO_FILTER_GROUP_ORDER,
  searchStudioFilterCatalog,
  studioFilterCatalogEntry,
  studioFilterGroupLabel,
} from "./filter/studio-filter-catalog";
import { StudioSmartFilterUnionControls } from "./filter/StudioSmartFilterUnionControls";
import {
  STUDIO_ADJUSTMENT_ADDABLE_ENGINE_IDS,
  STUDIO_ADJUSTMENT_ENGINE_IDS,
  admitStudioAdjustmentStack,
  appendStudioAdjustmentEntry,
  normalizeStudioAdjustmentStack,
  removeStudioAdjustmentEntry,
  reorderStudioAdjustmentEntry,
  setStudioAdjustmentEntryEnabled,
  studioAdjustmentDefaultParams,
  studioAdjustmentEngineLabel,
  type StudioAdjustmentEngineId,
  type StudioAdjustmentEntry,
  type StudioAdjustmentStack,
} from "./studio-adjustment-stack";
import { StudioToolHintTarget } from "./StudioToolHint";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";

type SmartFilterParams = StudioAdjustmentEntry["params"];

type NumericControlSpec = {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  fallback: number;
  suffix?: string;
};

const NUMERIC_CONTROLS: Partial<Record<StudioAdjustmentEngineId, readonly NumericControlSpec[]>> = {
  blur: [
    { key: "radius", label: "반경", min: 0, max: 30, step: 1, fallback: 2, suffix: "px" },
  ],
  "gaussian-blur": [
    { key: "radius", label: "반경", min: 1, max: 40, step: 1, fallback: 8, suffix: "px" },
    { key: "strength", label: "세기", min: 0, max: 100, step: 1, fallback: 70, suffix: "%" },
  ],
  "motion-blur": [
    { key: "radius", label: "거리", min: 1, max: 40, step: 1, fallback: 18, suffix: "px" },
    { key: "strength", label: "세기", min: 0, max: 100, step: 1, fallback: 85, suffix: "%" },
    { key: "angle", label: "각도", min: 0, max: 360, step: 1, fallback: 0, suffix: "°" },
  ],
  "spin-blur": [
    { key: "radius", label: "회전 범위", min: 1, max: 40, step: 1, fallback: 18, suffix: "°" },
    { key: "strength", label: "세기", min: 0, max: 100, step: 1, fallback: 85, suffix: "%" },
  ],
  "zoom-blur": [
    { key: "radius", label: "줌 범위", min: 1, max: 40, step: 1, fallback: 20, suffix: "%" },
    { key: "strength", label: "세기", min: 0, max: 100, step: 1, fallback: 85, suffix: "%" },
  ],
  "lens-blur": [
    { key: "radius", label: "반경", min: 0.25, max: 18, step: 0.25, fallback: 4, suffix: "px" },
    { key: "sampleCount", label: "품질 샘플", min: 5, max: 64, step: 1, fallback: 21 },
    { key: "apertureBlades", label: "조리개 날", min: 3, max: 12, step: 1, fallback: 6 },
    { key: "apertureRotationRadians", label: "조리개 회전", min: -3.14, max: 3.14, step: 0.05, fallback: 0, suffix: "rad" },
  ],
  "field-iris-blur": [
    { key: "focusCenterX", label: "초점 X", min: 0, max: 1, step: 0.01, fallback: 0.5 },
    { key: "focusCenterY", label: "초점 Y", min: 0, max: 1, step: 0.01, fallback: 0.5 },
    { key: "focusRadius", label: "초점 반경", min: 0, max: 1.414, step: 0.01, fallback: 0.16 },
    { key: "feather", label: "페더", min: 0.001, max: 1.414, step: 0.01, fallback: 0.24 },
    { key: "maximumBlurRadius", label: "최대 블러", min: 0.25, max: 18, step: 0.25, fallback: 7, suffix: "px" },
    { key: "sampleCount", label: "품질 샘플", min: 5, max: 64, step: 1, fallback: 21 },
    { key: "apertureBlades", label: "조리개 날", min: 3, max: 12, step: 1, fallback: 8 },
  ],
  "tilt-shift-blur": [
    { key: "axisRadians", label: "초점 축", min: -3.14, max: 3.14, step: 0.05, fallback: 0, suffix: "rad" },
    { key: "focusWidth", label: "초점 폭", min: 0, max: 2.828, step: 0.01, fallback: 0.2 },
    { key: "feather", label: "페더", min: 0.001, max: 1.414, step: 0.01, fallback: 0.22 },
    { key: "maximumBlurRadius", label: "최대 블러", min: 0.25, max: 18, step: 0.25, fallback: 7, suffix: "px" },
    { key: "sampleCount", label: "품질 샘플", min: 5, max: 64, step: 1, fallback: 19 },
  ],
  "selective-gaussian-blur": [
    { key: "radius", label: "반경", min: 1, max: 10, step: 1, fallback: 3, suffix: "px" },
    { key: "spatialSigma", label: "공간 시그마", min: 0.1, max: 20, step: 0.1, fallback: 2 },
    { key: "edgeThreshold", label: "경계 임계", min: 0, max: 255, step: 1, fallback: 20 },
    { key: "edgeSoftness", label: "경계 부드러움", min: 0, max: 2, step: 0.05, fallback: 0.35 },
  ],
  "tileable-blur": [
    { key: "radius", label: "랩 반경", min: 1, max: 20, step: 1, fallback: 5, suffix: "px" },
    { key: "sigma", label: "가우시안 시그마", min: 0.1, max: 20, step: 0.1, fallback: 2.2 },
    { key: "strength", label: "혼합 강도", min: 0, max: 1, step: 0.02, fallback: 1 },
  ],
  "dust-scratches": [
    { key: "radius", label: "결함 탐색 반경", min: 1, max: 5, step: 1, fallback: 2, suffix: "px" },
    { key: "threshold", label: "결함 임계값", min: 0, max: 255, step: 1, fallback: 24 },
    { key: "strength", label: "복원 강도", min: 0, max: 1, step: 0.02, fallback: 1 },
  ],
  "difference-of-gaussians": [
    { key: "smallSigma", label: "미세 시그마", min: 0.25, max: 6, step: 0.25, fallback: 0.8 },
    { key: "largeSigma", label: "대형 시그마", min: 0.35, max: 12, step: 0.05, fallback: 2 },
    { key: "threshold", label: "경계 임계값", min: 0, max: 64, step: 0.5, fallback: 1.5 },
    { key: "strength", label: "선 농도", min: 0, max: 32, step: 0.5, fallback: 12 },
  ],
  "color-to-alpha": [
    { key: "strength", label: "투명화 강도", min: 0, max: 100, step: 1, fallback: 85, suffix: "%" },
  ],
  "brightness-contrast": [
    { key: "brightness", label: "밝기", min: -0.8, max: 0.8, step: 0.05, fallback: 0 },
    { key: "contrast", label: "대비", min: -80, max: 80, step: 1, fallback: 0 },
  ],
  "shadow-highlight": [
    { key: "shadows", label: "섀도우", min: 0, max: 100, step: 1, fallback: 35, suffix: "%" },
    { key: "shadowsWidth", label: "섀도우 톤 범위", min: 0, max: 100, step: 1, fallback: 50, suffix: "%" },
    { key: "highlights", label: "하이라이트", min: 0, max: 100, step: 1, fallback: 20, suffix: "%" },
    { key: "highlightsWidth", label: "하이라이트 톤 범위", min: 0, max: 100, step: 1, fallback: 50, suffix: "%" },
    { key: "midtoneContrast", label: "미드톤 대비", min: -50, max: 50, step: 1, fallback: 0 },
  ],
  "hue-saturation": [
    { key: "hue", label: "색조", min: -180, max: 180, step: 5, fallback: 0, suffix: "°" },
    { key: "saturation", label: "채도", min: -1, max: 1, step: 0.05, fallback: 0 },
  ],
  levels: [
    { key: "black", label: "입력 검정", min: 0, max: 254, step: 1, fallback: 0 },
    { key: "white", label: "입력 흰색", min: 1, max: 255, step: 1, fallback: 255 },
    { key: "gamma", label: "감마", min: 0.1, max: 9.9, step: 0.1, fallback: 1 },
    { key: "outBlack", label: "출력 검정", min: 0, max: 255, step: 1, fallback: 0 },
    { key: "outWhite", label: "출력 흰색", min: 0, max: 255, step: 1, fallback: 255 },
  ],
  sharpen: [
    { key: "amount", label: "선명도", min: 0, max: 1, step: 0.05, fallback: 0.3 },
  ],
  "smart-sharpen": [
    { key: "amount", label: "세기", min: 0, max: 100, step: 1, fallback: 65, suffix: "%" },
    { key: "radius", label: "반경", min: 1, max: 10, step: 1, fallback: 2, suffix: "px" },
  ],
  "median-despeckle": [
    { key: "amount", label: "세기", min: 0, max: 100, step: 1, fallback: 100, suffix: "%" },
    { key: "radius", label: "반경", min: 1, max: 5, step: 1, fallback: 1, suffix: "px" },
  ],
  noise: [
    { key: "amount", label: "양", min: 0, max: 100, step: 1, fallback: 15, suffix: "%" },
  ],
  pixelate: [
    { key: "size", label: "블록 크기", min: 1, max: 40, step: 1, fallback: 8, suffix: "px" },
  ],
  posterize: [
    { key: "levels", label: "계조 수", min: 2, max: 8, step: 1, fallback: 5 },
  ],
  "ink-threshold": [
    { key: "level", label: "임계값", min: 0.01, max: 1, step: 0.01, fallback: 0.5 },
  ],
  "line-cleanup": [
    { key: "threshold", label: "이진화 임계", min: 0, max: 1, step: 0.02, fallback: 0.6 },
    { key: "strength", label: "선명도", min: 0, max: 1, step: 0.05, fallback: 0.5 },
  ],
  "screentone-removal": [
    { key: "radius", label: "탐색 반경", min: 1, max: 3, step: 1, fallback: 2, suffix: "px" },
    { key: "strength", label: "제거 강도", min: 0, max: 1, step: 0.02, fallback: 0.88 },
    { key: "inkLumaThreshold", label: "먹선 보호", min: 0, max: 160, step: 1, fallback: 72 },
  ],
  "jpeg-artifact-reduction": [
    { key: "deblockStrength", label: "블록 제거", min: 0, max: 1, step: 0.02, fallback: 0.72 },
    { key: "deringStrength", label: "링잉 제거", min: 0, max: 1, step: 0.02, fallback: 0.45 },
    { key: "boundaryThreshold", label: "블록 임계", min: 1, max: 64, step: 1, fallback: 6 },
    { key: "protectedEdgeThreshold", label: "경계 보호", min: 32, max: 224, step: 1, fallback: 88 },
    { key: "ringingThreshold", label: "링잉 임계", min: 1, max: 96, step: 1, fallback: 18 },
    { key: "inkLumaThreshold", label: "먹선 보호", min: 0, max: 160, step: 1, fallback: 64 },
  ],
  "edge-aware-denoise": [
    { key: "radius", label: "탐색 반경", min: 1, max: 3, step: 1, fallback: 1, suffix: "px" },
    { key: "strength", label: "노이즈 제거", min: 0, max: 1, step: 0.02, fallback: 0.78 },
    { key: "rangeThreshold", label: "색 경계 보호", min: 4, max: 192, step: 1, fallback: 72 },
  ],
  "color-halftone": [
    { key: "dotSize", label: "망점 크기", min: 2, max: 16, step: 1, fallback: 4, suffix: "px" },
    { key: "angle", label: "기준 각도", min: 0, max: 90, step: 1, fallback: 15, suffix: "°" },
    { key: "strength", label: "세기", min: 0, max: 100, step: 1, fallback: 100, suffix: "%" },
  ],
  "chromatic-aberration": [
    { key: "offset", label: "채널 간격", min: 1, max: 12, step: 1, fallback: 4, suffix: "px" },
  ],
  "edge-detect": [
    { key: "strength", label: "세기", min: 0, max: 100, step: 1, fallback: 100, suffix: "%" },
    { key: "detail", label: "선 두께", min: 1, max: 10, step: 1, fallback: 1 },
  ],
  emboss: [
    { key: "strength", label: "세기", min: 0, max: 100, step: 1, fallback: 100, suffix: "%" },
    { key: "detail", label: "양각 깊이", min: 1, max: 10, step: 1, fallback: 1 },
  ],
  solarize: [
    { key: "strength", label: "세기", min: 0, max: 100, step: 1, fallback: 100, suffix: "%" },
    { key: "detail", label: "반전 범위", min: 1, max: 10, step: 1, fallback: 3 },
  ],
  "oil-paint": [
    { key: "strength", label: "세기", min: 0, max: 100, step: 1, fallback: 100, suffix: "%" },
    { key: "detail", label: "붓 반경", min: 1, max: 5, step: 1, fallback: 3, suffix: "px" },
  ],
  exposure: [
    { key: "exposure", label: "노출", min: -5, max: 5, step: 0.1, fallback: 0, suffix: "EV" },
    { key: "gamma", label: "감마", min: 0.1, max: 3, step: 0.05, fallback: 1 },
    { key: "offset", label: "오프셋", min: -1, max: 1, step: 0.01, fallback: 0 },
  ],
  "unsharp-mask": [
    { key: "amount", label: "양", min: 0, max: 3, step: 0.05, fallback: 0.8 },
    { key: "radius", label: "반경", min: 1, max: 5, step: 1, fallback: 2, suffix: "px" },
    { key: "threshold", label: "임계값", min: 0, max: 255, step: 1, fallback: 8 },
  ],
  morphology: [
    { key: "radius", label: "반경", min: 0, max: 4, step: 1, fallback: 1, suffix: "px" },
  ],
  offset: [
    { key: "x", label: "가로", min: -512, max: 512, step: 1, fallback: 12, suffix: "px" },
    { key: "y", label: "세로", min: -512, max: 512, step: 1, fallback: 12, suffix: "px" },
  ],
  "custom-convolution": [
    { key: "divisor", label: "나눗수", min: -64, max: 64, step: 0.1, fallback: 1 },
    { key: "bias", label: "바이어스", min: -255, max: 255, step: 1, fallback: 0 },
  ],
  clouds: [
    { key: "amount", label: "합성량", min: 0, max: 1, step: 0.01, fallback: 0.35 },
    { key: "scale", label: "크기", min: 8, max: 512, step: 1, fallback: 96, suffix: "px" },
  ],
  "surface-blur": [
    { key: "strength", label: "평활 강도", min: 0, max: 100, step: 1, fallback: 78, suffix: "%" },
    { key: "radius", label: "보존 반경", min: 1, max: 5, step: 1, fallback: 3, suffix: "px" },
  ],
  "crystal-mosaic": [
    { key: "size", label: "결정 크기", min: 1, max: 5, step: 1, fallback: 3, suffix: "px" },
    { key: "strength", label: "색면 강도", min: 0, max: 100, step: 1, fallback: 72, suffix: "%" },
  ],
  "pencil-sketch": [
    { key: "strength", label: "연필 농도", min: 0, max: 100, step: 1, fallback: 88, suffix: "%" },
    { key: "detail", label: "선 디테일", min: 1, max: 10, step: 1, fallback: 4 },
  ],
  crosshatch: [
    { key: "strength", label: "잉크 농도", min: 0, max: 100, step: 1, fallback: 82, suffix: "%" },
    { key: "detail", label: "해칭 간격", min: 1, max: 10, step: 1, fallback: 5 },
  ],
  "ordered-dither": [
    { key: "strength", label: "디더 강도", min: 0, max: 100, step: 1, fallback: 100, suffix: "%" },
    { key: "detail", label: "패턴 크기", min: 1, max: 10, step: 1, fallback: 4 },
  ],
  "glowing-edges": [
    { key: "strength", label: "경계 강도", min: 0, max: 100, step: 1, fallback: 86, suffix: "%" },
    { key: "detail", label: "선 굵기", min: 1, max: 10, step: 1, fallback: 2 },
    { key: "glow", label: "빛 강도", min: 0, max: 100, step: 1, fallback: 72, suffix: "%" },
    { key: "radius", label: "빛 반경", min: 1, max: 20, step: 1, fallback: 5, suffix: "px" },
    { key: "threshold", label: "빛 임계", min: 0, max: 100, step: 1, fallback: 18, suffix: "%" },
  ],
  cutout: [
    { key: "strength", label: "효과 강도", min: 0, max: 100, step: 1, fallback: 100, suffix: "%" },
    { key: "levels", label: "색면 수", min: 2, max: 8, step: 1, fallback: 4 },
    { key: "smoothing", label: "면 평활", min: 0, max: 100, step: 1, fallback: 82, suffix: "%" },
    { key: "radius", label: "평활 반경", min: 1, max: 5, step: 1, fallback: 2, suffix: "px" },
    { key: "contrast", label: "경계 대비", min: -80, max: 80, step: 1, fallback: 18 },
  ],
  "retro-film": [
    { key: "strength", label: "효과 강도", min: 0, max: 100, step: 1, fallback: 100, suffix: "%" },
    { key: "grain", label: "필름 입자", min: 0, max: 100, step: 1, fallback: 24, suffix: "%" },
    { key: "grainSize", label: "입자 크기", min: 1, max: 8, step: 1, fallback: 2, suffix: "px" },
    { key: "fade", label: "페이드", min: -80, max: 80, step: 1, fallback: 14, suffix: "%" },
    { key: "chromatic", label: "색수차", min: 1, max: 12, step: 1, fallback: 2, suffix: "px" },
  ],
  watercolor: [
    { key: "strength", label: "안료 농도", min: 0, max: 100, step: 1, fallback: 78, suffix: "%" },
    { key: "spread", label: "확산 반경", min: 1, max: 12, step: 1, fallback: 4, suffix: "px" },
    { key: "bleed", label: "가장자리 번짐", min: 0, max: 100, step: 1, fallback: 62, suffix: "%" },
    { key: "granulation", label: "안료 과립", min: 0, max: 100, step: 1, fallback: 52, suffix: "%" },
    { key: "paper", label: "종이 질감", min: 0, max: 100, step: 1, fallback: 46, suffix: "%" },
  ],
  "diffuse-glow": [
    { key: "strength", label: "빛 강도", min: 0, max: 100, step: 1, fallback: 55, suffix: "%" },
    { key: "radius", label: "확산 반경", min: 1, max: 40, step: 1, fallback: 10, suffix: "px" },
    { key: "threshold", label: "밝기 임계", min: 0, max: 100, step: 1, fallback: 58, suffix: "%" },
    { key: "grain", label: "입자", min: 0, max: 40, step: 1, fallback: 8, suffix: "%" },
  ],
};

const PRESET_OPTIONS: Partial<Record<StudioAdjustmentEngineId, readonly { value: string; label: string }[]>> = {
  curves: [
    { value: "soft-contrast", label: "부드러운 S 커브" },
    { value: "matte", label: "매트" },
    { value: "fade", label: "페이드" },
  ],
  "color-balance": [
    { value: "cinematic", label: "시네마틱" },
    { value: "warm", label: "따뜻하게" },
    { value: "cool", label: "차갑게" },
    { value: "sunset", label: "석양" },
  ],
  "channel-mixer": [
    { value: "mono-balanced", label: "균형 흑백" },
    { value: "red-boost", label: "레드 부스트" },
    { value: "swap-gbr", label: "RGB → GBR" },
  ],
  "gradient-map": [
    { value: "teal-orange", label: "틸 오렌지" },
    { value: "mono", label: "흑백" },
    { value: "sepia", label: "세피아" },
    { value: "sunset", label: "석양" },
  ],
};

const CONVOLUTION_PRESETS: readonly {
  id: string;
  label: string;
  kernel: readonly number[];
  divisor: number;
  bias: number;
}[] = [
  { id: "sharpen", label: "샤픈", kernel: [0, -1, 0, -1, 5, -1, 0, -1, 0], divisor: 1, bias: 0 },
  { id: "edge", label: "외곽선", kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], divisor: 1, bias: 128 },
  { id: "high-pass", label: "하이패스", kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1], divisor: 1, bias: 128 },
  { id: "emboss", label: "엠보스", kernel: [-2, -1, 0, -1, 1, 1, 0, 1, 2], divisor: 1, bias: 128 },
  { id: "box-blur", label: "박스 블러", kernel: [1, 1, 1, 1, 1, 1, 1, 1, 1], divisor: 9, bias: 0 },
];

const STATIC_EFFECT_DESCRIPTIONS: Partial<Record<StudioAdjustmentEngineId, string>> = {
  invert: "RGB 채널을 즉시 반전합니다.",
  grayscale: "휘도 기반 흑백 변환을 적용합니다.",
  sepia: "고전 사진의 갈색 계열 색감을 적용합니다.",
  "line-extraction": "Sobel 경계를 순흑·순백 선화로 변환합니다.",
  screentone: "휘도를 고정 크기의 흑백 망점으로 변환합니다.",
  "high-pass": "제한된 3 × 3 커널로 고주파 윤곽만 분리합니다.",
};

const SEEDED_EFFECT_ENGINES = new Set<StudioAdjustmentEngineId>([
  "noise",
  "retro-film",
  "watercolor",
  "diffuse-glow",
]);

function numericParam(params: SmartFilterParams, key: string, fallback: number): number {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function formatNumericValue(value: number, step: number): string {
  if (Number.isInteger(step)) return String(Math.round(value));
  const precision = Math.min(3, Math.max(1, String(step).split(".")[1]?.length ?? 1));
  return value.toFixed(precision).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function NumericParameterControl({
  spec,
  params,
  onChange,
}: {
  spec: NumericControlSpec;
  params: SmartFilterParams;
  onChange: (next: SmartFilterParams) => void;
}) {
  const id = useId();
  const value = numericParam(params, spec.key, spec.fallback);
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_3.5rem] items-center gap-2">
      <label htmlFor={id} className="text-[0.62rem] font-semibold text-fg-2">
        {spec.label}
      </label>
      <input
        id={id}
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        onChange={(event) => onChange({ ...params, [spec.key]: Number(event.target.value) })}
        className="h-10 min-w-0 cursor-pointer accent-accent pointer-coarse:h-11"
      />
      <output htmlFor={id} className="text-right text-[0.6rem] tabular-nums text-fg-3">
        {formatNumericValue(value, spec.step)}{spec.suffix ?? ""}
      </output>
    </div>
  );
}

function SelectParameterControl({
  label,
  paramKey,
  value,
  options,
  params,
  onChange,
}: {
  label: string;
  paramKey: string;
  value: string;
  options: readonly { value: string; label: string }[];
  params: SmartFilterParams;
  onChange: (next: SmartFilterParams) => void;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2 text-[0.62rem] font-semibold text-fg-2">
      <span>{label}</span>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange({ ...params, [paramKey]: event.target.value })}
        className="min-h-10 min-w-0 rounded-lg border border-line bg-canvas px-2 text-[0.65rem] text-fg outline-none focus:border-accent pointer-coarse:min-h-11"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function ConvolutionKernelEditor({
  params,
  onChange,
}: {
  params: SmartFilterParams;
  onChange: (next: SmartFilterParams) => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-line/70 bg-canvas/45 p-2">
      <div className="flex flex-wrap gap-1">
        {CONVOLUTION_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => onChange({
              ...params,
              ...Object.fromEntries(preset.kernel.map((value, index) => [`k${index}`, value])),
              divisor: preset.divisor,
              bias: preset.bias,
            })}
            className="min-h-9 rounded-lg border border-line bg-card px-2 text-[0.6rem] font-semibold text-fg-2 hover:bg-raised hover:text-fg pointer-coarse:min-h-11"
          >
            {preset.label}
          </button>
        ))}
      </div>
      <fieldset>
        <legend className="mb-1 text-[0.6rem] font-semibold text-fg-3">3 × 3 커널</legend>
        <div className="grid grid-cols-3 gap-1">
          {Array.from({ length: 9 }, (_, index) => {
            const key = `k${index}`;
            return (
              <label key={key} className="min-w-0">
                <span className="sr-only">커널 {index + 1}</span>
                <input
                  type="number"
                  min={-16}
                  max={16}
                  step={0.25}
                  value={numericParam(params, key, index === 4 ? 1 : 0)}
                  onChange={(event) => onChange({ ...params, [key]: Number(event.target.value) })}
                  className="min-h-10 w-full rounded-md border border-line bg-card px-1 text-center text-[0.62rem] tabular-nums text-fg outline-none focus:border-accent pointer-coarse:min-h-11"
                />
              </label>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}

function StudioSmartFilterControls({
  entry,
  onChange,
}: {
  entry: StudioAdjustmentEntry;
  onChange: (params: SmartFilterParams) => void;
}) {
  const controls = NUMERIC_CONTROLS[entry.engine] ?? [];
  const presetOptions = PRESET_OPTIONS[entry.engine];
  return (
    <div className="ml-7 space-y-2 rounded-lg border border-line/60 bg-panel/35 p-2">
      {presetOptions ? (
        <SelectParameterControl
          label="프리셋"
          paramKey="preset"
          value={typeof entry.params.preset === "string" ? entry.params.preset : presetOptions[0]!.value}
          options={presetOptions}
          params={entry.params}
          onChange={onChange}
        />
      ) : null}
      {entry.engine === "morphology" ? (
        <SelectParameterControl
          label="연산"
          paramKey="mode"
          value={entry.params.mode === "dilate" ? "dilate" : "erode"}
          options={[
            { value: "erode", label: "침식 · 어두운 선 확장" },
            { value: "dilate", label: "팽창 · 밝은 영역 확장" },
          ]}
          params={entry.params}
          onChange={onChange}
        />
      ) : null}
      {entry.engine === "offset" ? (
        <SelectParameterControl
          label="가장자리"
          paramKey="edge"
          value={typeof entry.params.edge === "string" ? entry.params.edge : "transparent"}
          options={[
            { value: "transparent", label: "투명" },
            { value: "wrap", label: "반복" },
            { value: "clamp", label: "가장자리 늘이기" },
          ]}
          params={entry.params}
          onChange={onChange}
        />
      ) : null}
      {entry.engine === "color-halftone" ? (
        <SelectParameterControl
          label="색상 모드"
          paramKey="mode"
          value={entry.params.mode === "mono" ? "mono" : "cmyk"}
          options={[
            { value: "cmyk", label: "CMYK 컬러 망점" },
            { value: "mono", label: "단색 흑백 망점" },
          ]}
          params={entry.params}
          onChange={onChange}
        />
      ) : null}
      {SEEDED_EFFECT_ENGINES.has(entry.engine) ? (
        <label className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2 text-[0.62rem] font-semibold text-fg-2">
          <span>시드</span>
          <input
            type="number"
            min={0}
            max={entry.engine === "noise" ? 2_147_483_647 : 9_999}
            step={1}
            value={numericParam(entry.params, "seed", 1_337)}
            onChange={(event) => onChange({ ...entry.params, seed: Number(event.target.value) })}
            className="min-h-10 rounded-lg border border-line bg-canvas px-2 text-[0.65rem] tabular-nums text-fg outline-none focus:border-accent pointer-coarse:min-h-11"
          />
        </label>
      ) : null}
      {entry.engine === "clouds" ? (
        <>
          <SelectParameterControl
            label="합성"
            paramKey="mode"
            value={typeof entry.params.mode === "string" ? entry.params.mode : "overlay"}
            options={[
              { value: "overlay", label: "오버레이" },
              { value: "multiply", label: "곱하기" },
              { value: "screen", label: "스크린" },
            ]}
            params={entry.params}
            onChange={onChange}
          />
          <label className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2 text-[0.62rem] font-semibold text-fg-2">
            <span>시드</span>
            <input
              type="number"
              min={0}
              max={2_147_483_647}
              step={1}
              value={numericParam(entry.params, "seed", 1_337)}
              onChange={(event) => onChange({ ...entry.params, seed: Number(event.target.value) })}
              className="min-h-10 rounded-lg border border-line bg-canvas px-2 text-[0.65rem] tabular-nums text-fg outline-none focus:border-accent pointer-coarse:min-h-11"
            />
          </label>
        </>
      ) : null}
      {entry.engine === "custom-convolution" ? (
        <ConvolutionKernelEditor params={entry.params} onChange={onChange} />
      ) : null}
      {entry.engine === "color-to-alpha" ? (
        <label className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2 text-[0.62rem] font-semibold text-fg-2">
          <span>배경색</span>
          <input
            type="color"
            value={
              typeof entry.params.keyColor === "string"
              && /^#[0-9a-f]{6}$/i.test(entry.params.keyColor)
                ? entry.params.keyColor
                : "#ffffff"
            }
            onChange={(event) => onChange({ ...entry.params, keyColor: event.target.value })}
            className="h-10 w-full cursor-pointer rounded-lg border border-line bg-canvas p-1 pointer-coarse:min-h-11"
            aria-label="투명화할 배경색"
          />
        </label>
      ) : null}
      <StudioSmartFilterUnionControls
        engine={entry.engine}
        params={entry.params}
        onChange={onChange}
      />
      {controls.map((spec) => (
        <NumericParameterControl
          key={spec.key}
          spec={spec}
          params={entry.params}
          onChange={onChange}
        />
      ))}
      {STATIC_EFFECT_DESCRIPTIONS[entry.engine] ? (
        <p className="text-[0.62rem] leading-relaxed text-fg-3">
          {STATIC_EFFECT_DESCRIPTIONS[entry.engine]}
        </p>
      ) : null}
    </div>
  );
}

export function StudioSmartFiltersPanel({
  stack,
  onChange,
}: {
  stack: StudioAdjustmentStack | undefined;
  onChange: (next: StudioAdjustmentStack) => void;
}): React.ReactElement {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const current = normalizeStudioAdjustmentStack(stack);
  const visibleCatalog = searchStudioFilterCatalog(query, STUDIO_ADJUSTMENT_ADDABLE_ENGINE_IDS);

  function patch(next: StudioAdjustmentStack) {
    const receipt = admitStudioAdjustmentStack(next, current);
    onChange(receipt.stack);
  }

  function addEngine(engine: StudioAdjustmentEngineId) {
    if (!STUDIO_ADJUSTMENT_ENGINE_IDS.includes(engine)) return;
    patch(appendStudioAdjustmentEntry(current, {
      engine,
      params: studioAdjustmentDefaultParams(engine),
    }));
  }

  function patchEntryParams(entryId: string, params: SmartFilterParams) {
    patch({
      ...current,
      entries: current.entries.map((entry) => entry.id === entryId ? { ...entry, params } : entry),
    });
  }

  return (
    <div className="space-y-3" data-studio-filter-manager="true">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[0.66rem] font-semibold uppercase tracking-wider text-fg-3">필터 관리</p>
          <p className="mt-0.5 text-[0.65rem] leading-relaxed text-fg-3">
            원본은 유지됩니다. 필터를 검색해 추가하고 각 항목의 값을 언제든 다시 조절하세요.
            모든 계산은 브라우저의 로컬 Worker에서 우선 실행됩니다.
          </p>
        </div>
        <span className="shrink-0 rounded-lg border border-line bg-card px-2 py-1 text-[0.6rem] tabular-nums text-fg-3">
          {current.entries.length}개
        </span>
      </div>

      <div className="rounded-xl border border-line/70 bg-card/40 p-2.5">
        <label htmlFor={searchId} className="sr-only">필터 검색</label>
        <div className="flex min-h-11 items-center gap-2 rounded-lg border border-line bg-canvas px-2.5 focus-within:border-accent">
          <Search className="size-3.5 shrink-0 text-fg-3" aria-hidden />
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="필터 이름·효과 검색"
            className="min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-fg-3"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="필터 검색어 지우기"
              className="grid size-9 shrink-0 place-items-center rounded-lg text-fg-3 hover:bg-raised hover:text-fg pointer-coarse:size-11"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </div>

        <p className="mt-2 text-[0.58rem] text-fg-3" role="status" aria-live="polite">
          {query ? `검색 결과 ${visibleCatalog.length}개` : `사용 가능한 필터 ${visibleCatalog.length}개`}
        </p>

        <div className="mt-2 max-h-72 space-y-2.5 overflow-y-auto overscroll-contain pr-0.5 [scrollbar-width:thin]">
          {STUDIO_FILTER_GROUP_ORDER.map((group) => {
            const items = visibleCatalog.filter((entry) => entry.group === group);
            if (items.length === 0) return null;
            return (
              <section key={group} aria-labelledby={`${searchId}-${group}`}>
                <h3 id={`${searchId}-${group}`} className="mb-1 text-[0.58rem] font-bold uppercase tracking-wider text-fg-3">
                  {studioFilterGroupLabel(group)} · {items.length}
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {items.map((entry) => (
                    <StudioToolHintTarget
                      key={entry.engine}
                      hint={{
                        id: `smart-filter-${entry.engine}`,
                        title: entry.title,
                        description: entry.description,
                        preview: "filter",
                        tip: "원본을 보존한 채 스택에 추가되며 나중에 값을 다시 바꿀 수 있어요.",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => addEngine(entry.engine as StudioAdjustmentEngineId)}
                        className={cn(
                          "inline-flex min-h-10 items-center gap-1 rounded-lg border border-line/70 bg-canvas/50 px-2.5 text-[0.62rem] font-bold text-fg-2 pointer-coarse:min-h-11",
                          "hover:border-accent/45 hover:bg-accent-soft/40 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
                          "disabled:cursor-not-allowed disabled:opacity-45",
                        )}
                      >
                        <Plus className="size-3" aria-hidden />
                        {entry.title}
                      </button>
                    </StudioToolHintTarget>
                  ))}
                </div>
              </section>
            );
          })}
          {visibleCatalog.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line px-3 py-4 text-center">
              <p className="text-xs font-semibold text-fg-2">일치하는 필터가 없습니다</p>
              <p className="mt-1 text-[0.62rem] text-fg-3">‘선명’, ‘구름’, ‘감마’처럼 효과 이름으로 찾아보세요.</p>
            </div>
          ) : null}
        </div>
      </div>

      {current.entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-card/40 px-3 py-4 text-center text-[0.68rem] text-fg-3">
          스택이 비어 있어요. 위 카탈로그에서 필터를 추가하면 여기에 조절값이 나타납니다.
        </p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line" aria-label="스마트 필터 목록">
          {current.entries.map((entry, index) => {
            const catalog = studioFilterCatalogEntry(entry.engine);
            return (
              <li key={entry.id} className={cn("space-y-2 bg-card/50 px-2 py-2", !entry.enabled && "opacity-55")}>
                <div className="flex items-center gap-1.5">
                  <span className="w-5 shrink-0 text-right font-display text-[0.62rem] tabular-nums text-fg-3">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.72rem] font-semibold text-fg">
                      {studioAdjustmentEngineLabel(entry.engine)}
                    </p>
                    <p className="line-clamp-2 text-[0.58rem] leading-relaxed text-fg-3">
                      {catalog?.description ?? entry.engine}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={entry.enabled ? `${studioAdjustmentEngineLabel(entry.engine)} 끄기` : `${studioAdjustmentEngineLabel(entry.engine)} 켜기`}
                    aria-pressed={entry.enabled}
                    title={entry.enabled ? "미리보기 끄기" : "미리보기 켜기"}
                    className={buttonClass({ size: "sm", variant: "quiet", className: "min-h-10 min-w-10 pointer-coarse:min-h-11 pointer-coarse:min-w-11" })}
                    onClick={() => patch(setStudioAdjustmentEntryEnabled(current, entry.id, !entry.enabled))}
                  >
                    {entry.enabled ? <Eye className="size-3.5" aria-hidden /> : <EyeOff className="size-3.5" aria-hidden />}
                  </button>
                  <button
                    type="button"
                    aria-label={`${studioAdjustmentEngineLabel(entry.engine)} 위로 이동`}
                    disabled={index === 0}
                    className={buttonClass({ size: "sm", variant: "quiet", className: "min-h-10 min-w-10 pointer-coarse:min-h-11 pointer-coarse:min-w-11" })}
                    onClick={() => patch(reorderStudioAdjustmentEntry(current, index, index - 1))}
                  >
                    <ArrowUp className="size-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`${studioAdjustmentEngineLabel(entry.engine)} 아래로 이동`}
                    disabled={index >= current.entries.length - 1}
                    className={buttonClass({ size: "sm", variant: "quiet", className: "min-h-10 min-w-10 pointer-coarse:min-h-11 pointer-coarse:min-w-11" })}
                    onClick={() => patch(reorderStudioAdjustmentEntry(current, index, index + 1))}
                  >
                    <ArrowDown className="size-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`${studioAdjustmentEngineLabel(entry.engine)} 삭제`}
                    className={buttonClass({ size: "sm", variant: "quiet", className: "min-h-10 min-w-10 text-bad pointer-coarse:min-h-11 pointer-coarse:min-w-11" })}
                    onClick={() => patch(removeStudioAdjustmentEntry(current, entry.id))}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </div>
                {entry.enabled ? (
                  <StudioSmartFilterControls
                    entry={entry}
                    onChange={(params) => patchEntryParams(entry.id, params)}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
