/**
 * Studio Webtoon Guides — 웹툰 표준폭 가이드·세이프영역·분량 피드백 헬퍼.
 * 기존 userGuides는 작가가 손으로 끄는 수동 드래그선뿐이라, 여기에 더해
 * "플랫폼 표준 연재폭(네이버 690·카카오 720…)을 자동으로 짚어주는 가이드선"과
 * "에피소드 길이(몇 스크롤 분량인가)" 추정을 데이터/순수함수로 제공한다.
 *
 * 표준폭 가이드의 핵심 발상: 캔버스 내용폭(CANVAS_W=720)은 고정이라도, 작가가
 * 실제 연재할 플랫폼 폭은 더 좁을 수 있다 → 그 폭이 캔버스 정중앙에 놓였을 때의
 * 좌/우 안쪽 모서리에 세로선을 깔아, "이 안에 핵심을 담아라"를 시각화한다.
 * 세이프영역은 양옆 약 6%를 잘림 위험 구간으로 표시(모바일 뷰어 여백/UI 가림 대비).
 *
 * 전부 순수·결정적(랜덤 없음). DOM/Konva/React 의존 없음 — StudioPage 오버레이
 * 레이어와 단위 테스트가 같은 데이터를 공유한다. 사용자 노출 문자열은 한글.
 */

export interface WebtoonWidthStandard {
  id: string;
  label: string;
  width: number;
}

/**
 * 대표 웹툰 플랫폼/작업 표준 연재폭(px). 좁은 폭부터 넓은 폭 순서.
 * - 네이버 690 / 카카오 720: 실제 모바일 연재 기준폭.
 * - 웹툰 캔버스 800: 자유 연재 플랫폼 권장 작업폭.
 * - 고화질 작업 1080: 레티나/확대 대비 고해상 작업 캔버스.
 */
export const WEBTOON_WIDTH_STANDARDS: WebtoonWidthStandard[] = [
  { id: "naver", label: "네이버", width: 690 },
  { id: "kakao", label: "카카오", width: 720 },
  { id: "canvas", label: "웹툰 캔버스", width: 800 },
  { id: "hires", label: "고화질 작업", width: 1080 },
];

/** 오버레이가 그릴 세로 가이드선 한 줄(축 x 고정 — 표준폭은 좌우 경계만 짚는다). */
export type GuideLine = { axis: "x"; pos: number; label: string };

// 세이프영역 비율/하한 — 양옆 약 6%, 단 너무 좁은 캔버스에서도 최소 24px은 확보.
const SAFE_RATIO = 0.06;
const SAFE_MIN = 24;

// 에피소드 분량 구간 경계(스크롤 화면 수). <=3 짧음 · <=8 보통 · <=16 넉넉 · 그 외 긺.
const TIER_SHORT_MAX = 3;
const TIER_NORMAL_MAX = 8;
const TIER_AMPLE_MAX = 16;

// 분량 추정 기본 뷰포트 높이(px) — 한 스크롤 화면. 세로 모바일 1화면 ≈ 1280px.
const DEFAULT_VIEWPORT_H = 1280;

export type EpisodeLengthTier = "짧음" | "보통" | "넉넉" | "긺";

export interface EpisodeLengthFeedback {
  screens: number;
  label: string;
  tier: EpisodeLengthTier;
}

// ---------------------------------------------------------------------------
// 표준폭 가이드
// ---------------------------------------------------------------------------

/**
 * 캔버스 폭에 들어가는 각 표준폭마다, 그 폭을 정중앙에 놓았을 때의 좌/우 안쪽
 * 모서리에 세로 가이드선 2개를 만든다.
 *
 * 좌측 pos = round((canvasWidth - width) / 2),
 * 우측 pos = canvasWidth - 좌측 pos  (정수·완전 대칭).
 * 각 선 라벨은 `${label} ${width}` (예: "네이버 690").
 *
 * - canvasWidth 이하인 표준폭만 대상(넘치는 폭은 가이드 의미 없음).
 * - 동일 pos는 중복 제거(예: 캔버스폭과 같은 표준폭 → 좌/우가 0과 canvasWidth로
 *   각각 한 번씩만, 서로 다른 표준폭이 같은 안쪽 모서리를 만들면 1줄로 합침).
 * - canvasWidth<=0 이면 [].
 */
export function webtoonWidthGuides(canvasWidth: number): GuideLine[] {
  if (canvasWidth <= 0) return [];
  const lines: GuideLine[] = [];
  const seen = new Set<number>();
  for (const std of WEBTOON_WIDTH_STANDARDS) {
    if (std.width > canvasWidth) continue;
    const inset = Math.round((canvasWidth - std.width) / 2);
    const left = inset;
    const right = canvasWidth - inset;
    const label = `${std.label} ${std.width}`;
    for (const pos of [left, right]) {
      if (seen.has(pos)) continue;
      seen.add(pos);
      lines.push({ axis: "x", pos, label });
    }
  }
  return lines;
}

/**
 * 캔버스 양옆 세이프영역(잘림 위험) 여백(px). 좌우 대칭·정수.
 * 약 6%씩, 단 하한 24px. canvasWidth<=0 이면 {left:0,right:0}.
 */
export function safeAreaMargin(canvasWidth: number): { left: number; right: number } {
  if (canvasWidth <= 0) return { left: 0, right: 0 };
  const margin = Math.max(SAFE_MIN, Math.round(canvasWidth * SAFE_RATIO));
  return { left: margin, right: margin };
}

// ---------------------------------------------------------------------------
// 에피소드 분량 피드백
// ---------------------------------------------------------------------------

/** 스크롤 화면 수 → 분량 등급(짧음/보통/넉넉/긺). */
function lengthTier(screens: number): EpisodeLengthTier {
  if (screens <= TIER_SHORT_MAX) return "짧음";
  if (screens <= TIER_NORMAL_MAX) return "보통";
  if (screens <= TIER_AMPLE_MAX) return "넉넉";
  return "긺";
}

/**
 * 전체 세로 길이(px)를 뷰포트 1화면 높이로 나눠 "몇 스크롤 분량"인지 추정한다.
 * screens = ceil(totalHeight / viewport). 라벨 "약 N스크롤 분량".
 *
 * - totalHeightPx<=0 → 빈 작업: {screens:0, label:"비어 있음", tier:"짧음"}.
 * - viewportHeightPx<=0 → 잘못된 입력이므로 기본 1280px로 간주(0 나눗셈 방지).
 */
export function episodeLengthLabel(
  totalHeightPx: number,
  viewportHeightPx: number = DEFAULT_VIEWPORT_H
): EpisodeLengthFeedback {
  if (totalHeightPx <= 0) return { screens: 0, label: "비어 있음", tier: "짧음" };
  const viewport = viewportHeightPx > 0 ? viewportHeightPx : DEFAULT_VIEWPORT_H;
  const screens = Math.ceil(totalHeightPx / viewport);
  return { screens, label: `약 ${screens}스크롤 분량`, tier: lengthTier(screens) };
}
