/**
 * Studio SFX Library — 효과음(SFX) 워드 라이브러리.
 *
 * 기존 SFX_PRESETS(studio-assets.ts)는 흰 글자+검은 외곽선 6개짜리 평면 목록뿐이었다.
 * 이 모듈은 코미포의 핵심 기능인 "효과음 레터링"을 제대로 살려, 카테고리별로 분류된
 * 효과음 단어를 충격/긴장/움직임/환경/정적/감정 무드에 맞춘 스타일(색·외곽선·
 * 그라디언트·기울기·글꼴)과 함께 제공한다.
 *
 * createSfxTextConfig 는 TextEl 시각 필드(id/type 제외)를 펼침-가능한 객체로 돌려준다 —
 * 메인 루프가 type:"text" + id + 위치를 채워 캔버스에 넣는다. 전부 순수·결정적.
 * 사용자 노출 문자열은 한글.
 */

type FontStyle = "normal" | "bold" | "italic" | "bold italic";
type GradientDirection = "vertical" | "horizontal";

/** TextEl 시각 필드의 부분집합 — 효과음 한 단어의 스타일. */
export interface SfxStyle {
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  fontStyle?: FontStyle;
  font?: string;
  letterSpacing?: number;
  rotation?: number;
  fillType?: "solid" | "gradient";
  gradientColorStart?: string;
  gradientColorEnd?: string;
  gradientDirection?: GradientDirection;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOpacity?: number;
}

export type SfxCategory = "impact" | "tension" | "motion" | "ambient" | "silence" | "emotion";

export const SFX_CATEGORIES: { id: SfxCategory; label: string }[] = [
  { id: "impact", label: "충격·타격" },
  { id: "tension", label: "긴장·심리" },
  { id: "motion", label: "움직임" },
  { id: "ambient", label: "환경·소리" },
  { id: "silence", label: "정적" },
  { id: "emotion", label: "감정" },
];

export interface SfxPreset {
  id: string;
  label: string;
  category: SfxCategory;
  text: string;
  keywords?: readonly string[];
  style: SfxStyle;
}

// 무드별 공통 스타일 베이스 — 반복을 줄이고 톤을 통일한다.
// impact/motion은 예전 studio-assets.ts처럼 흰 글자+검은 외곽선으로 두면 촌스러워 보이므로
// 그라디언트 채색 + 어두운 드롭섀도로 임팩트 있는 웹툰 레터링에 가깝게 잡는다.
const IMPACT: SfxStyle = { fill: "#ffb24a", fillType: "gradient", gradientColorStart: "#fff3c2", gradientColorEnd: "#ff8a2e", gradientDirection: "vertical", stroke: "#33110a", strokeWidth: 8, fontStyle: "bold", font: "Black Han Sans", rotation: -7, shadowColor: "#1a0a04", shadowBlur: 10, shadowOpacity: 0.4 };
const IMPACT_RED: SfxStyle = { fill: "#ff5f47", fillType: "gradient", gradientColorStart: "#ffcf5c", gradientColorEnd: "#e0233d", gradientDirection: "vertical", stroke: "#2a0808", strokeWidth: 8, fontStyle: "bold", font: "Black Han Sans", rotation: -9, shadowColor: "#1a0404", shadowBlur: 10, shadowOpacity: 0.4 };
const TENSION: SfxStyle = { fill: "#7aa8ff", fillType: "gradient", gradientColorStart: "#cfe0ff", gradientColorEnd: "#5b7fd6", gradientDirection: "vertical", stroke: "#1b2440", strokeWidth: 4, font: "Jua", shadowColor: "#101a33", shadowBlur: 6, shadowOpacity: 0.25 };
const MOTION: SfxStyle = { fill: "#bfe3ff", fillType: "gradient", gradientColorStart: "#ffffff", gradientColorEnd: "#6bb8f0", gradientDirection: "horizontal", stroke: "#123252", strokeWidth: 5, fontStyle: "italic", font: "Black Han Sans", rotation: -14, shadowColor: "#0a1c2e", shadowBlur: 6, shadowOpacity: 0.3 };
const AMBIENT: SfxStyle = { fill: "#eaf3ff", stroke: "#2a3142", strokeWidth: 4, font: "Gaegu" };
const QUIET: SfxStyle = { fill: "#8b8b8b", strokeWidth: 0, font: "Nanum Pen Script", shadowColor: "#000000", shadowBlur: 6, shadowOpacity: 0.25 };
const EMOTION: SfxStyle = { fill: "#ff9dc2", fillType: "gradient", gradientColorStart: "#ffd3e6", gradientColorEnd: "#ff5f95", gradientDirection: "vertical", stroke: "#ffffff", strokeWidth: 5, fontStyle: "bold", font: "Jua", rotation: -5, shadowColor: "#4a0f26", shadowBlur: 6, shadowOpacity: 0.25 };

export const SFX_LIBRARY: SfxPreset[] = [
  // 충격·타격
  { id: "sfx-kwang", label: "쾅", category: "impact", text: "쾅!", style: IMPACT },
  { id: "sfx-kwakwang", label: "콰광", category: "impact", text: "콰광!", style: IMPACT },
  { id: "sfx-puk", label: "퍽", category: "impact", text: "퍽", style: IMPACT_RED },
  { id: "sfx-bbang", label: "빵", category: "impact", text: "빵!", style: IMPACT_RED },
  { id: "sfx-wudangtang", label: "우당탕", category: "impact", text: "우당탕", style: { ...IMPACT, rotation: 5 } },
  { id: "sfx-kung", label: "쿵", category: "impact", text: "쿵!", keywords: ["heavy", "landing", "착지"], style: { ...IMPACT, rotation: 0 } },
  { id: "sfx-tang", label: "탕", category: "impact", text: "탕!", keywords: ["shot", "gun", "총성"], style: { ...IMPACT_RED, rotation: -3 } },
  { id: "sfx-kkwajik", label: "꽈직", category: "impact", text: "꽈직!", keywords: ["crush", "break", "파손"], style: { ...IMPACT_RED, rotation: 7 } },
  { id: "sfx-jjaeng", label: "쨍그랑", category: "impact", text: "쨍그랑!", keywords: ["glass", "crash", "유리"], style: { ...IMPACT, rotation: -11, gradientColorEnd: "#54a8e8" } },
  // 긴장·심리
  { id: "sfx-dugun", label: "두근두근", category: "tension", text: "두근두근", style: { ...TENSION, fill: "#ff6f91", fillType: "gradient", gradientColorStart: "#ffd0dc", gradientColorEnd: "#ff5a7a" } },
  { id: "sfx-cheolleong", label: "철렁", category: "tension", text: "철렁", style: TENSION },
  { id: "sfx-ssae", label: "쎄~", category: "tension", text: "쎄~", style: { ...TENSION, fontStyle: "italic" } },
  { id: "sfx-heumchit", label: "흠칫", category: "tension", text: "흠칫", style: { ...TENSION, rotation: -4 } },
  { id: "sfx-ossak", label: "오싹", category: "tension", text: "오싹…", keywords: ["horror", "chill", "공포"], style: { ...TENSION, fill: "#a7d8ef", rotation: 2 } },
  { id: "sfx-umjjil", label: "움찔", category: "tension", text: "움찔", keywords: ["flinch", "surprise", "놀람"], style: { ...TENSION, rotation: -8 } },
  { id: "sfx-jirit", label: "찌릿", category: "tension", text: "찌릿", keywords: ["stare", "electric", "시선"], style: { ...TENSION, fill: "#d8bcff", rotation: 6 } },
  // 움직임
  { id: "sfx-hwik", label: "휙", category: "motion", text: "휙", style: MOTION },
  { id: "sfx-syuuk", label: "슈욱", category: "motion", text: "슈욱", style: MOTION },
  { id: "sfx-hudadak", label: "후다닥", category: "motion", text: "후다닥", style: { ...MOTION, rotation: -10 } },
  { id: "sfx-tadak", label: "타닥", category: "motion", text: "타닥", style: { fill: "#ffd27a", fillType: "gradient", gradientColorStart: "#fff3c2", gradientColorEnd: "#ff9f3d", gradientDirection: "vertical", stroke: "#3a1408", strokeWidth: 5, fontStyle: "italic", font: "Black Han Sans", rotation: -10, shadowColor: "#1a0a04", shadowBlur: 6, shadowOpacity: 0.3 } },
  { id: "sfx-degul", label: "데굴데굴", category: "motion", text: "데굴데굴", keywords: ["roll", "rolling", "구르기"], style: { ...MOTION, rotation: 8 } },
  { id: "sfx-sarak", label: "사락", category: "motion", text: "사락", keywords: ["cloth", "page", "옷", "종이"], style: { ...MOTION, font: "Nanum Pen Script", rotation: -4 } },
  { id: "sfx-hwing", label: "휘이잉", category: "motion", text: "휘이잉", keywords: ["wind", "spin", "바람"], style: { ...MOTION, rotation: -17 } },
  // 환경·소리
  { id: "sfx-chwaaa", label: "촤아아", category: "ambient", text: "촤아아", style: AMBIENT },
  { id: "sfx-ureureung", label: "우르릉", category: "ambient", text: "우르릉", style: { ...AMBIENT, fill: "#c9d4e6" } },
  { id: "sfx-baseurak", label: "바스락", category: "ambient", text: "바스락", style: { ...AMBIENT, font: "Nanum Pen Script" } },
  { id: "sfx-jjaekkak", label: "째깍", category: "ambient", text: "째깍", style: { ...AMBIENT, fill: "#fff4cf" } },
  { id: "sfx-knock", label: "똑똑", category: "ambient", text: "똑똑", keywords: ["knock", "door", "문"], style: { ...AMBIENT, fill: "#f1d6af" } },
  { id: "sfx-hududuk", label: "후두둑", category: "ambient", text: "후두둑", keywords: ["rain", "drops", "비"], style: { ...AMBIENT, fill: "#b9dcf2" } },
  { id: "sfx-beep", label: "삐빅", category: "ambient", text: "삐빅", keywords: ["beep", "digital", "기계"], style: { ...AMBIENT, fill: "#8de1d0", font: "Jua" } },
  { id: "sfx-deolkeong", label: "덜컹", category: "ambient", text: "덜컹", keywords: ["door", "train", "문", "기차"], style: { ...AMBIENT, fill: "#d6c6ab", rotation: 3 } },
  // 정적
  { id: "sfx-si", label: "시-", category: "silence", text: "시-…", style: QUIET },
  { id: "sfx-goyo", label: "고요", category: "silence", text: "고요…", style: { ...QUIET, fill: "#9aa0ad" } },
  { id: "sfx-jeong", label: "정적", category: "silence", text: "…정적…", style: { ...QUIET, fill: "#7d7d7d" } },
  { id: "sfx-jeongmak", label: "적막", category: "silence", text: "적막…", keywords: ["still", "silence", "고요"], style: { ...QUIET, fill: "#737985", letterSpacing: 4 } },
  { id: "sfx-ssaneul", label: "싸늘", category: "silence", text: "싸늘—", keywords: ["cold", "awkward", "냉기"], style: { ...QUIET, fill: "#7f9aaa", fontStyle: "italic" } },
  // 감정
  { id: "sfx-budeul", label: "부들부들", category: "emotion", text: "부들부들", style: { ...EMOTION, fillType: "gradient", gradientColorStart: "#d9ccff", gradientColorEnd: "#7c5cff", fill: "#9b8cff", rotation: 3 } },
  { id: "sfx-balkkeun", label: "발끈", category: "emotion", text: "발끈!", style: { ...EMOTION, fillType: "gradient", gradientColorStart: "#ffb199", gradientColorEnd: "#e0233d", fill: "#ff5252", stroke: "#2a0d0d" } },
  { id: "sfx-dudung", label: "두둥", category: "emotion", text: "두둥!", style: { fill: "#ffe27a", fillType: "gradient", gradientColorStart: "#fff6d0", gradientColorEnd: "#c98a12", gradientDirection: "vertical", stroke: "#241004", strokeWidth: 8, fontStyle: "bold", font: "Black Han Sans", rotation: -6, shadowColor: "#1a0f02", shadowBlur: 8, shadowOpacity: 0.35 } },
  { id: "sfx-banjjak", label: "반짝", category: "emotion", text: "반짝", style: { ...EMOTION, fillType: "gradient", gradientColorStart: "#e8fbff", gradientColorEnd: "#38c7ff", fill: "#7ad7ff", stroke: "#15384a" } },
  { id: "sfx-kkyak", label: "꺄악", category: "emotion", text: "꺄악!", keywords: ["scream", "excited", "비명"], style: { ...EMOTION, rotation: -11 } },
  { id: "sfx-huljjeok", label: "훌쩍", category: "emotion", text: "훌쩍", keywords: ["cry", "sad", "울음"], style: { ...EMOTION, fill: "#86c6ef", gradientColorStart: "#d9efff", gradientColorEnd: "#5ba8dc", rotation: 0 } },
  { id: "sfx-haa", label: "하아", category: "emotion", text: "하아…", keywords: ["sigh", "breath", "한숨"], style: { ...EMOTION, fill: "#c0b8cc", gradientColorStart: "#ece7f1", gradientColorEnd: "#9588a5", rotation: 0 } },
  { id: "sfx-hehe", label: "헤헤", category: "emotion", text: "헤헤", keywords: ["laugh", "smile", "웃음"], style: { ...EMOTION, fill: "#ffb5cb", rotation: 5 } },
];

const SFX_DEFAULT_FONT_SIZE = 64;
const SFX_DEFAULT_WIDTH = 220;

/** 무드 키워드 매칭 등에 쓰도록 공백·대소문자를 정규화. */
function norm(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

/**
 * 효과음 프리셋 → 캔버스에 넣을 TextEl 시각 필드(id/type 제외)의 펼침-가능 객체.
 * 위치(x,y)와 기본 크기(fontSize·width)를 포함한다.
 */
export function createSfxTextConfig(
  preset: SfxPreset,
  x: number,
  y: number
): {
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  rotation: number;
} & SfxStyle {
  const { rotation, ...rest } = preset.style;
  return {
    text: preset.text,
    x,
    y,
    width: SFX_DEFAULT_WIDTH,
    fontSize: SFX_DEFAULT_FONT_SIZE,
    rotation: rotation ?? 0,
    ...rest,
  };
}

/** 카테고리별 효과음 목록. */
export function sfxByCategory(category: SfxCategory): SfxPreset[] {
  return SFX_LIBRARY.filter((s) => s.category === category);
}

/** 라벨·텍스트·용도 키워드 AND 검색(공백·대소문자 무시). 빈 검색어는 전체. */
export function searchSfx(query: string): SfxPreset[] {
  const terms = query.trim().split(/\s+/).map(norm).filter(Boolean);
  if (terms.length === 0) return SFX_LIBRARY;
  return SFX_LIBRARY.filter((preset) => {
    const searchable = norm([
      preset.id,
      preset.label,
      preset.text,
      preset.category,
      ...(preset.keywords ?? []),
    ].join(" "));
    return terms.every((term) => searchable.includes(term));
  });
}
