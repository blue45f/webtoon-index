/**
 * Filter pack registry — the one place the *names* of every filter live.
 *
 * `studio-filter-pack.ts` owns the parameter schemas and the pixel engines, so any module that
 * imports a value from it drags the whole filter engine graph into the importer's chunk. The
 * top menu needs nothing but "which filters exist and what are they called", and it is on the
 * Studio's first chunk, so it used to restate that list by hand — and the hand-written copy fell
 * 16 filters behind the real catalogue (the entire union wave was unreachable from the menubar).
 *
 * This module is deliberately import-free: no engines, no Konva, no React. Both the registry and
 * the pack re-export the same arrays, so the menu, the dialog gallery and the pack schema cannot
 * count differently. `studio-filter-pack.test.ts` proves every kind here has a schema and that
 * every schema label matches the label here.
 */

/**
 * Deterministic filter-union wave kinds. Declared here rather than in
 * `studio-filter-union-wave.ts` so the menu can name them without loading the warp kernels;
 * that module re-exports this array as its own public name.
 */
export const STUDIO_FILTER_UNION_WAVE_KINDS = [
  "wave-warp",
  "ripple-warp",
  "fisheye",
  "twirl",
  "pinch-bloat",
  "lens-distortion",
  "film-grain-pro",
  "salt-pepper",
  "rgb-noise",
  "perlin-texture",
  "pointillize",
  "stained-glass",
  "poster-edges",
  "photocopy",
  "normal-map",
  "god-rays",
  "polar-coordinates",
] as const;

export type StudioFilterUnionWaveKind = (typeof STUDIO_FILTER_UNION_WAVE_KINDS)[number];

/** Every filter-pack kind, in top-menu and dialog registration order. */
export const STUDIO_FILTER_PACK_KINDS = [
  "mosaic",
  "radial-blur",
  "zoom-blur",
  "lens-blur",
  "field-iris-blur",
  "tilt-shift-blur",
  "selective-gaussian-blur",
  "tileable-blur",
  "chromatic-aberration",
  "glitch",
  "scanline",
  "vignette",
  "lens-flare",
  "emboss",
  "solarize",
  "threshold",
  "oil-paint",
  "surface-blur",
  "line-cleanup",
  "screentone-removal",
  "jpeg-artifact-reduction",
  "edge-aware-denoise",
  "dust-scratches",
  "difference-of-gaussians",
  "color-to-alpha",
  "duotone",
  "noise-add",
  ...STUDIO_FILTER_UNION_WAVE_KINDS,
] as const;

export type StudioFilterPackKind = (typeof STUDIO_FILTER_PACK_KINDS)[number];

/**
 * kind → Korean label. Identical to `STUDIO_FILTER_PACK_DEFS[kind].label`; the schema keeps its
 * own copy next to the parameters it documents, and the pack's contract test compares the two so
 * a renamed filter cannot show one name in the menu and another in the dialog.
 */
export const STUDIO_FILTER_PACK_LABELS: Readonly<Record<StudioFilterPackKind, string>> = {
  mosaic: "모자이크 / 픽셀화",
  "radial-blur": "방사형 블러",
  "zoom-blur": "줌 블러",
  "lens-blur": "렌즈 블러",
  "field-iris-blur": "영역 초점 블러",
  "tilt-shift-blur": "틸트 시프트 블러",
  "selective-gaussian-blur": "선택적 가우시안 블러",
  "tileable-blur": "이음매 없는 블러",
  "chromatic-aberration": "색수차",
  glitch: "글리치",
  scanline: "스캔라인 (CRT)",
  vignette: "비네트",
  "lens-flare": "렌즈 플레어",
  emboss: "엠보스",
  solarize: "솔라라이즈",
  threshold: "흑백 이진화",
  "oil-paint": "유화",
  "surface-blur": "표면 블러",
  "line-cleanup": "스케치 선화 정리",
  "screentone-removal": "스크린톤 제거",
  "jpeg-artifact-reduction": "JPEG 압축 깨짐 제거",
  "edge-aware-denoise": "윤곽 보존 노이즈 제거",
  "dust-scratches": "먼지와 스크래치 제거",
  "difference-of-gaussians": "가우시안 차분 선화",
  "color-to-alpha": "색상 투명화",
  duotone: "세피아 / 듀오톤",
  "noise-add": "노이즈 추가",
  "wave-warp": "물결 왜곡",
  "ripple-warp": "동심원 물결",
  fisheye: "어안 렌즈",
  twirl: "소용돌이",
  "pinch-bloat": "오므리기 / 부풀리기",
  "lens-distortion": "렌즈 왜곡 보정",
  "film-grain-pro": "시네마 필름 그레인",
  "salt-pepper": "소금·후추 노이즈",
  "rgb-noise": "RGB 채널 노이즈",
  "perlin-texture": "프랙탈 밸류 텍스처",
  pointillize: "점묘화",
  "stained-glass": "스테인드글라스",
  "poster-edges": "포스터 엣지",
  photocopy: "복사기 효과",
  "normal-map": "노멀 맵 변환",
  "god-rays": "빛줄기",
  "polar-coordinates": "극좌표 변환",
};

/** The five hand-rolled filters that predate the pack; each still owns a bespoke draft shape. */
export const STUDIO_FILTER_CORE_KINDS = [
  "gaussian-blur",
  "motion-blur",
  "hue-saturation-brightness",
  "brightness-contrast",
  "color-curves",
] as const;

export type StudioFilterCoreKindName = (typeof STUDIO_FILTER_CORE_KINDS)[number];

export const STUDIO_FILTER_CORE_LABELS: Readonly<Record<StudioFilterCoreKindName, string>> = {
  "gaussian-blur": "가우시안 블러",
  "motion-blur": "모션 블러",
  "hue-saturation-brightness": "색조 / 채도 / 밝기",
  "brightness-contrast": "명도 / 대비",
  "color-curves": "색상 커브",
};

/**
 * Every filter the top menu, the dialog gallery and the "N개 필터" counters describe, in
 * registration order: the five core filters first, then the pack.
 */
export const STUDIO_FILTER_ALL_KINDS: readonly (StudioFilterCoreKindName | StudioFilterPackKind)[] =
  Object.freeze([...STUDIO_FILTER_CORE_KINDS, ...STUDIO_FILTER_PACK_KINDS]);

export const STUDIO_FILTER_ALL_LABELS: Readonly<
  Record<StudioFilterCoreKindName | StudioFilterPackKind, string>
> = Object.freeze({ ...STUDIO_FILTER_CORE_LABELS, ...STUDIO_FILTER_PACK_LABELS });
