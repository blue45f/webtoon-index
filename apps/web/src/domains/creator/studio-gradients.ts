/**
 * Studio Gradient Preset Library
 * 웹툰 배경용 2색 선형 그라데이션 프리셋과 Konva fillLinearGradient* 설정 빌더를 모았다.
 * 전부 순수 함수 — Konva/DOM 의존 없음. StudioPage 캔버스 로직과 단위 테스트가 공유한다.
 */

// 그라데이션 방향 — 세로(위→아래) 또는 가로(좌→우).
export type GradientDirection = "vertical" | "horizontal";

// 프리셋 한 개. stops는 [시작색, 끝색] 2색(소문자 #rrggbb).
export type GradientPreset = {
  id: string;
  label: string;
  tip: string;
  stops: [string, string];
  direction: GradientDirection;
};

// 웹툰 무드 그라데이션 프리셋. stops는 전부 소문자 #rrggbb,
// 두 색의 휘도 차이를 충분히 둬서 면이 또렷하게 갈리도록 골랐다.
export const GRADIENT_PRESETS: GradientPreset[] = [
  {
    id: "dawn-sky",
    label: "새벽 하늘",
    tip: "짙은 남색에서 옅은 분홍으로 번지는 동트기 직전 하늘.",
    stops: ["#1b2a52", "#f3b7c4"],
    direction: "vertical",
  },
  {
    id: "sunset",
    label: "노을",
    tip: "주황과 진보라가 겹치는 해질녘 노을.",
    stops: ["#ff7a3d", "#3a1d52"],
    direction: "vertical",
  },
  {
    id: "midday-sky",
    label: "한낮 하늘",
    tip: "맑은 하늘색에서 새하얀 지평선으로 떨어지는 한낮.",
    stops: ["#4aa6e8", "#eaf6ff"],
    direction: "vertical",
  },
  {
    id: "night-sky",
    label: "밤하늘",
    tip: "칠흑 같은 검정에서 깊은 남보라로 깔리는 밤하늘.",
    stops: ["#05060f", "#22305e"],
    direction: "vertical",
  },
  {
    id: "aurora",
    label: "오로라",
    tip: "어두운 청록에서 옥빛 초록으로 흐르는 극광.",
    stops: ["#0b2a3a", "#49dba0"],
    direction: "vertical",
  },
  {
    id: "cherry-blossom",
    label: "벚꽃",
    tip: "여린 분홍에서 새하얀 꽃잎으로 옅어지는 봄.",
    stops: ["#f7a8c4", "#fff5fa"],
    direction: "vertical",
  },
  {
    id: "ocean",
    label: "바다",
    tip: "밝은 청록 수면에서 깊은 군청 심해로 가라앉는 바다.",
    stops: ["#27c4d6", "#0a3a6b"],
    direction: "vertical",
  },
  {
    id: "forest-shade",
    label: "숲 그늘",
    tip: "은은한 세이지 잎새에서 짙은 청록 그늘로 내려앉는 숲.",
    stops: ["#a9c95a", "#163a26"],
    direction: "vertical",
  },
  {
    id: "neon-city",
    label: "네온 시티",
    tip: "짙은 자홍 보석빛에서 청록으로 번지는 사이버펑크 야경.",
    stops: ["#c81f96", "#22a8c2"],
    direction: "horizontal",
  },
  {
    id: "mono-gray",
    label: "모노 그레이",
    tip: "밝은 회색에서 짙은 먹빛으로 떨어지는 무채색.",
    stops: ["#dfe2e6", "#1f2226"],
    direction: "vertical",
  },
  {
    id: "romance-pink",
    label: "로맨스 핑크",
    tip: "달콤한 핑크에서 따뜻한 살구빛으로 녹는 로맨스.",
    stops: ["#ff6fae", "#ffd9a8"],
    direction: "horizontal",
  },
  {
    id: "horror-violet",
    label: "공포 보라",
    tip: "핏빛 검붉음에서 음산한 보라로 스미는 공포.",
    stops: ["#2a0710", "#5b2a8a"],
    direction: "vertical",
  },
  {
    id: "golden-hour",
    label: "황금빛",
    tip: "눈부신 금빛에서 짙은 호박색으로 무르익는 황금빛.",
    stops: ["#ffd54a", "#b5651d"],
    direction: "vertical",
  },
  {
    id: "pastel-rainbow",
    label: "파스텔 무지개",
    tip: "파스텔 보라에서 연노랑으로 흐르는 무지개(앞 2색).",
    stops: ["#c9a8ff", "#fff3a8"],
    direction: "horizontal",
  },
  {
    id: "autumn-maple",
    label: "가을 단풍",
    tip: "따뜻한 호박빛에서 짙은 적갈로 무르익는 단풍 배경.",
    stops: ["#f0a85c", "#5c2418"],
    direction: "vertical",
  },
  {
    id: "lavender-dusk",
    label: "라벤더 황혼",
    tip: "뽀얀 라벤더에서 짙은 남보라로 저무는 황혼.",
    stops: ["#d7b8e0", "#33314f"],
    direction: "horizontal",
  },
];

/** #rgb / #rrggbb 헥스 색 여부(대소문자 허용). */
export function isHexColor(v: string): boolean {
  return typeof v === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v);
}

/**
 * 프리셋 → 기존 페이지 배경 bgGrad 포맷([시작색, 끝색]).
 * 페이지 배경은 이 두 색을 세로 그라데이션으로 그리므로 stops를 그대로 넘긴다.
 */
export function gradientToBgGrad(preset: GradientPreset): [string, string] {
  return [preset.stops[0], preset.stops[1]];
}

/**
 * Konva Rect용 선형 그라데이션 설정 빌더.
 * vertical → 위(0,0)에서 아래(0,h), horizontal → 좌(0,0)에서 우(w,0).
 * colorStops는 [0, 시작색, 1, 끝색] 형태로 StudioPage 배경 규약과 동일.
 */
export function buildKonvaLinearGradient(
  stops: [string, string],
  w: number,
  h: number,
  direction: GradientDirection
): {
  fillLinearGradientStartPoint: { x: number; y: number };
  fillLinearGradientEndPoint: { x: number; y: number };
  fillLinearGradientColorStops: Array<number | string>;
} {
  const start = { x: 0, y: 0 };
  const end = direction === "horizontal" ? { x: w, y: 0 } : { x: 0, y: h };
  return {
    fillLinearGradientStartPoint: start,
    fillLinearGradientEndPoint: end,
    fillLinearGradientColorStops: [0, stops[0], 1, stops[1]],
  };
}
