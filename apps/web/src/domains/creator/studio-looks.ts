/**
 * Studio One-Click Looks
 * 라이트룸/인스타그램 프리셋처럼 스튜디오의 ~30개 이미지 필터를 한 번에 세팅하는 큐레이티드 "룩".
 *   - 각 룩의 patch는 완성된 분위기를 내는 필터 필드의 "선별된 부분집합"이다.
 *   - 스칼라/불리언 필드(brightness/contrast/grayscale/sepia/temperature 등)는 값을 직접 박는다.
 *   - 객체 필드(curve/colorBalance/photoFilter/vibrance/gradientMap/halftone/grain/glow/
 *     stylize/light/sketch/clarity)는 검증된 상수 범위의 raw preset object로 둔다.
 *     무거운 필터 모듈은 실제 고급 보정 패널/필터 적용 시점에만 로드한다.
 * 룩은 "절대값(absolute)" 적용이라 가산이 아니다 — looksResetPatch()로 모든 필드를 비운 뒤 patch를 얹는다.
 * 필터 클립보드(복사/붙여넣기)도 LOOK_FILTER_KEYS / extractFilterFields로 공유한다.
 * Konva/DOM 의존 없음 — StudioPage와 단위 테스트가 함께 쓴다. 전부 순수·결정적(랜덤 없음).
 */

import type { ImageFilterFields } from "./render/studio-konva-filter-fields";

// ---------------------------------------------------------------------------
// 타입 — 룩 카테고리와 룩 자체
// ---------------------------------------------------------------------------

/** 룩 카테고리 — 인스펙터에서 룩을 묶어 보여줄 그룹. */
export type StudioLookCategory = "만화" | "시네마틱" | "빈티지" | "감성" | "흑백" | "실험";

/** 원클릭 룩 — patch는 여러 필터 필드를 한 번에 세팅하는 부분집합. */
export type StudioLook = {
  id: string;
  label: string;
  tip: string;
  category: StudioLookCategory;
  patch: Partial<ImageFilterFields>;
};

// ---------------------------------------------------------------------------
// 룩 카탈로그 — 카테고리별로 시각적으로 또렷하고 웹툰 실전에 쓸모 있는 16+ 룩.
// 객체 필드는 검증된 상수 범위로 선언해 룩 패널 진입 시 고급 필터 모듈을 당겨오지 않는다.
// ---------------------------------------------------------------------------

export const STUDIO_LOOKS: StudioLook[] = [
  // ===== 만화 =====
  {
    id: "classic-manga",
    label: "클래식 만화",
    tip: "흑백 변환과 강한 대비에 흑색 망점과 옅은 필름 그레인을 얹어 정통 출판 만화 톤을 냅니다.",
    category: "만화",
    patch: {
      grayscale: true,
      contrast: 22,
      halftone: { dotSize: 4, angle: 45, mode: "mono", strength: 85 },
      grain: { type: "film", amount: 18, size: 1, seed: 7 },
    },
  },
  {
    id: "american-comic",
    label: "아메리칸 코믹",
    tip: "고운 CMYK 망점에 채도와 대비를 더해 미국 코믹스풍 컬러 인쇄 질감을 만듭니다.",
    category: "만화",
    patch: {
      saturation: 0.3,
      contrast: 18,
      halftone: { dotSize: 4, angle: 15, mode: "cmyk", strength: 100 },
    },
  },
  {
    id: "pen-drawing",
    label: "펜 드로잉",
    tip: "복사기 톤으로 윤곽만 검은 잉크로 남기고 흑백으로 정리해 펜 선화 느낌을 냅니다.",
    category: "만화",
    patch: {
      grayscale: true,
      contrast: 10,
      sketch: { type: "photocopy", strength: 100, detail: 4 },
    },
  },
  {
    id: "screentone",
    label: "스크린톤",
    tip: "흑백 변환에 촘촘한 흑색 망점과 대비를 더해 망가 스크린톤 음영을 깔아 줍니다.",
    category: "만화",
    patch: {
      grayscale: true,
      contrast: 16,
      halftone: { dotSize: 3, angle: 45, mode: "mono", strength: 100 },
    },
  },
  {
    id: "webtoon-cel",
    label: "웹툰 셀",
    tip: "색을 몇 단계로 평탄화하고 생기·선명도를 끌어올려 깔끔한 컬러 셀 음영을 냅니다. 3D 캐릭터 캡처를 한국형 컬러 웹툰 컷처럼 보이게 합니다.",
    category: "만화",
    patch: {
      contrast: 8,
      posterize: 5,
      vibrance: { vibrance: 22, saturation: 4 },
      clarity: { clarity: 30, dehaze: 0 },
    },
  },
  {
    id: "clean-lineart",
    label: "클린 라인아트",
    tip: "소벨 에지 검출로 윤곽만 검은 선으로 남기고 배경을 하얗게 비워 깔끔한 흑백 선화(콘티·러프 스케치)를 만듭니다.",
    category: "만화",
    patch: {
      lineart: true,
    },
  },
  {
    id: "sumi-e-webtoon",
    label: "수묵 웹툰",
    tip: "사진·3D 배경을 먹의 농담, 젖은 가장자리 번짐, 한지 섬유와 안료 과립으로 바꿔 동양화풍 장면 컷을 만듭니다.",
    category: "만화",
    patch: {
      inkWash: { strength: 86, spread: 3, edgeBleed: 56, granulation: 46, paper: 62, inkColor: "#20282c", seed: 41 },
    },
  },

  // ===== 시네마틱 =====
  {
    id: "noir",
    label: "느와르",
    tip: "흑백에 강렬한 대비와 거친 필름 그레인, 짙은 비네트로 누아르 분위기를 만듭니다.",
    category: "시네마틱",
    patch: {
      grayscale: true,
      contrast: 36,
      curve: [
        { x: 0, y: 0 },
        { x: 56, y: 24 },
        { x: 200, y: 232 },
        { x: 255, y: 255 },
      ],
      grain: { type: "film", amount: 38, size: 2, seed: 11 },
      glow: { strength: 18, size: 8, threshold: 80, color: "auto" },
    },
  },
  {
    id: "blockbuster",
    label: "블록버스터",
    tip: "그림자는 청록, 하이라이트는 주황으로 미는 틸&오렌지 컬러 밸런스에 대비를 더한 영화 룩.",
    category: "시네마틱",
    patch: {
      contrast: 16,
      colorBalance: { shadows: [-10, 5, 20], midtones: [0, 0, 0], highlights: [25, 10, -20] },
      vibrance: { vibrance: 12, saturation: 6 },
    },
  },
  {
    id: "cyberpunk",
    label: "사이버펑크",
    tip: "그림자는 청색, 하이라이트는 마젠타로 물들이고 네온 광채와 광선 스트릭으로 사이버펑크를 연출합니다.",
    category: "시네마틱",
    patch: {
      contrast: 14,
      saturation: 0.25,
      colorBalance: { shadows: [-18, -4, 24], midtones: [0, 0, 0], highlights: [22, -10, 18] },
      glow: { strength: 55, size: 16, threshold: 55, color: "#00e5ff" },
      light: { type: "glowStreak", intensity: 45, x: 50, y: 40, hue: 300 },
    },
  },
  {
    id: "golden-hour",
    label: "골든아워",
    tip: "따뜻한 주황 포토 필터에 황금빛 라이트 릭과 생기를 더해 해 질 녘 골든아워를 감쌉니다.",
    category: "시네마틱",
    patch: {
      brightness: 0.04,
      photoFilter: { color: "#ff9e3d", density: 35, preserveLuminosity: true },
      vibrance: { vibrance: 18, saturation: 4 },
      light: { type: "lightLeak", intensity: 48, x: 10, y: 16, hue: 38 },
    },
  },

  // ===== 빈티지 =====
  {
    id: "vintage-film",
    label: "빈티지 필름",
    tip: "검정을 들어올린 페이드 커브에 따뜻한 색조와 필름 그레인을 더해 빛바랜 필름 톤을 냅니다.",
    category: "빈티지",
    patch: {
      curve: [
        { x: 0, y: 24 },
        { x: 64, y: 78 },
        { x: 192, y: 198 },
        { x: 255, y: 235 },
      ],
      photoFilter: { color: "#ec8a00", density: 28, preserveLuminosity: true },
      grain: { type: "film", amount: 30, size: 2, seed: 23 },
      vibrance: { vibrance: 0, saturation: -18 },
    },
  },
  {
    id: "sepia-tone",
    label: "세피아 톤",
    tip: "누런 세피아 변환에 필름 그레인과 대비를 더해 오래된 사진 같은 색조를 만듭니다.",
    category: "빈티지",
    patch: {
      sepia: true,
      contrast: 12,
      grain: { type: "film", amount: 22, size: 1, seed: 5 },
    },
  },
  {
    id: "super-8mm",
    label: "8mm",
    tip: "주사선 텍스처와 페이드 커브, 낮은 채도로 8mm 홈비디오 같은 빈티지 화면을 냅니다.",
    category: "빈티지",
    patch: {
      saturation: -0.15,
      curve: [
        { x: 0, y: 18 },
        { x: 128, y: 138 },
        { x: 255, y: 240 },
      ],
      grain: { type: "scanline", amount: 35, size: 2, seed: 1 },
      photoFilter: { color: "#d8a24a", density: 22, preserveLuminosity: true },
    },
  },

  // ===== 감성 =====
  {
    id: "pastel",
    label: "파스텔",
    tip: "채도를 낮추고 중간톤을 끌어올린 부드러운 커브로 화사한 파스텔 무드를 만듭니다.",
    category: "감성",
    patch: {
      brightness: 0.08,
      curve: [
        { x: 0, y: 22 },
        { x: 128, y: 150 },
        { x: 255, y: 250 },
      ],
      vibrance: { vibrance: 18, saturation: -38 },
    },
  },
  {
    id: "dreamy",
    label: "꿈결",
    tip: "넓게 번지는 부드러운 글로우와 생기, 옅은 햇살로 몽환적인 꿈결 장면을 연출합니다.",
    category: "감성",
    patch: {
      brightness: 0.06,
      glow: { strength: 45, size: 28, threshold: 45, color: "auto" },
      vibrance: { vibrance: 14, saturation: -8 },
      light: { type: "lightLeak", intensity: 30, x: 78, y: 20, hue: 320 },
    },
  },
  {
    id: "fresh-cool",
    label: "청량",
    tip: "차가운 색온도에 생기와 선명도를 더해 맑고 청량한 한낮 공기를 표현합니다.",
    category: "감성",
    patch: {
      temperature: -22,
      saturation: 0.1,
      vibrance: { vibrance: 24, saturation: 6 },
      clarity: { clarity: 28, dehaze: 12 },
    },
  },

  // ===== 흑백 =====
  {
    id: "high-contrast-bw",
    label: "하이콘 흑백",
    tip: "흑백에 강한 대비와 선명도를 더해 또렷하고 강렬한 모노크롬을 만듭니다.",
    category: "흑백",
    patch: {
      grayscale: true,
      contrast: 34,
      clarity: { clarity: 40, dehaze: 0 },
      curve: [
        { x: 0, y: 0 },
        { x: 64, y: 44 },
        { x: 192, y: 212 },
        { x: 255, y: 255 },
      ],
    },
  },
  {
    id: "ink-bw",
    label: "잉크 흑백",
    tip: "흑백 변환에 스탬프 잉크 도장을 얹어 강렬한 흑백 2계조 실루엣을 찍습니다.",
    category: "흑백",
    patch: {
      grayscale: true,
      sketch: { type: "stamp", strength: 100, detail: 5 },
    },
  },

  // ===== 실험 =====
  {
    id: "pop-art",
    label: "팝아트",
    tip: "큼직한 CMYK 망점에 채도를 크게 올려 리히텐슈타인풍 팝아트 도트를 강하게 입힙니다.",
    category: "실험",
    patch: {
      saturation: 0.5,
      contrast: 12,
      halftone: { dotSize: 10, angle: 15, mode: "cmyk", strength: 100 },
    },
  },
  {
    id: "oil-painting",
    label: "유화",
    tip: "이웃 색을 뭉치는 유화 스타일화에 선명도와 생기를 더해 두꺼운 붓 터치 질감을 만듭니다.",
    category: "실험",
    patch: {
      stylize: { type: "oilPaint", strength: 85, detail: 4 },
      clarity: { clarity: 22, dehaze: 0 },
      vibrance: { vibrance: 20, saturation: 8 },
    },
  },
  {
    id: "solaris",
    label: "솔라리",
    tip: "밝은 톤을 부분 반전하는 솔라리제이션에 채도를 더해 몽환적이고 이질적인 색조를 만듭니다.",
    category: "실험",
    patch: {
      saturation: 0.2,
      stylize: { type: "solarize", strength: 75, detail: 4 },
      gradientMap: {
        stops: [
          { pos: 0, color: "#1a0030" },
          { pos: 0.5, color: "#9c3bd0" },
          { pos: 1, color: "#ffe07a" },
        ],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// 필터 필드 키 집합 — 룩 "절대 적용"으로 모든 필터 필드를 비우거나 복사/붙여넣기에 쓴다.
// ImageFilterFields의 모든 키를 빠짐없이 나열한다(컴파일러가 누락/오타를 잡도록 타입 고정).
// ---------------------------------------------------------------------------

/** 룩이 건드릴 수 있는 모든 필터 필드 키 — ImageFilterFields의 전체 키. */
export const LOOK_FILTER_KEYS: (keyof ImageFilterFields)[] = [
  "blur",
  "brightness",
  "contrast",
  "grayscale",
  "sepia",
  "screentone",
  "lineart",
  "chromatic",
  "posterize",
  "noise",
  "saturation",
  "hue",
  "temperature",
  "sharpen",
  "pixelate",
  "invert",
  "inkThreshold",
  "duotoneShadow",
  "duotoneHighlight",
  "levelsBlack",
  "levelsWhite",
  "levelsGamma",
  "levelsOutBlack",
  "levelsOutWhite",
  "levelsCh",
  "curve",
  "curveCh",
  "colorBalance",
  "channelMixer",
  "selectiveHsl",
  "vibrance",
  "gradientMap",
  "photoFilter",
  "autoAdjust",
  "clarity",
  "shadowHighlight",
  "outline",
  "glow",
  "halftone",
  "grain",
  "inkWash",
  "blurFx",
  "lensBlur",
  "fieldIrisBlur",
  "tiltShiftBlur",
  "selectiveGaussianBlur",
  "tileableBlur",
  "distort",
  "stylize",
  "light",
  "sketch",
  "detail",
  "lineCleanup",
  "screentoneRemoval",
  "jpegArtifactReduction",
  "edgeAwareDenoise",
  "dustScratches",
  "differenceOfGaussians",
  "colorToAlpha",
];

/**
 * 모든 필터 필드를 undefined로 비운 패치를 반환한다 — 룩 적용/전체 리셋이 깨끗한 상태에서
 * 시작하도록(룩은 가산이 아닌 절대값). 모든 LOOK_FILTER_KEYS 키가 undefined로 채워진다.
 */
export function looksResetPatch(): Partial<ImageFilterFields> {
  const patch: Partial<ImageFilterFields> = {};
  for (const key of LOOK_FILTER_KEYS) {
    patch[key] = undefined;
  }
  return patch;
}

/**
 * 요소에서 필터 필드만 골라낸다("필터 복사"용) — 값이 설정된 키만 담은
 * Partial<ImageFilterFields>를 반환한다(undefined 키는 건너뜀). 순수(입력 불변).
 */
export function extractFilterFields(el: Partial<ImageFilterFields>): Partial<ImageFilterFields> {
  const out: Partial<ImageFilterFields> = {};
  if (!el || typeof el !== "object") return out;
  for (const key of LOOK_FILTER_KEYS) {
    const value = el[key];
    if (value === undefined) continue;
    // 키별 값 타입이 서로 달라(불리언/숫자/문자열/객체) 좁히기 어려우므로
    // 단일 인덱스 대입으로 한 번에 옮긴다(키는 LOOK_FILTER_KEYS로 한정).
    (out as Record<keyof ImageFilterFields, unknown>)[key] = value;
  }
  return out;
}
