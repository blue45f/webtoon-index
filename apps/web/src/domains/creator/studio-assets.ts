// 창작 스튜디오 "쉽게 만들기" 프리셋 — 컷 레이아웃 템플릿·말풍선 종류·만화 효과·배경.
// 라이선스 이슈 없는 자체 벡터/텍스트 프리셋만 사용(외부 아트 에셋 없음).

import { STUDIO_CANVAS_WIDTH } from "./canvas/studio-canvas-constants";

export const CANVAS_W = STUDIO_CANVAS_WIDTH;

export interface FrameSpec {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface TemplateSpec {
  id: string;
  label: string;
  hint: string;
  canvasH: number;
  frames: FrameSpec[];
}

const M = 24; // 컷 간격/여백

// 세로 스택 N컷(전폭).
function stack(count: number, canvasH: number): FrameSpec[] {
  const h = Math.round((canvasH - M * (count + 1)) / count);
  return Array.from({ length: count }, (_, i) => ({
    x: M,
    y: M + i * (h + M),
    width: CANVAS_W - M * 2,
    height: h,
  }));
}

function grid(cols: number, rows: number, canvasH: number): FrameSpec[] {
  const w = (CANVAS_W - M * (cols + 1)) / cols;
  const h = (canvasH - M * (rows + 1)) / rows;
  return Array.from({ length: rows * cols }, (_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      x: M + col * (w + M),
      y: M + row * (h + M),
      width: w,
      height: h,
    };
  });
}

function columns(count: number, canvasH: number): FrameSpec[] {
  const width = (CANVAS_W - M * (count + 1)) / count;
  return Array.from({ length: count }, (_, index) => ({
    x: M + index * (width + M),
    y: M,
    width,
    height: canvasH - M * 2,
  }));
}

function insetFrame(canvasH: number, inset = M): FrameSpec[] {
  return [{
    x: inset,
    y: inset,
    width: CANVAS_W - inset * 2,
    height: canvasH - inset * 2,
  }];
}

export const TEMPLATES: TemplateSpec[] = [
  { id: "blank", label: "빈 캔버스", hint: "처음부터 자유롭게", canvasH: 1080, frames: [] },
  { id: "webtoon2", label: "세로 웹툰 · 2컷", hint: "짧은 장면 전환", canvasH: 1280, frames: stack(2, 1280) },
  { id: "webtoon3", label: "세로 웹툰 · 3컷", hint: "스크롤 웹툰 기본", canvasH: 1620, frames: stack(3, 1620) },
  { id: "webtoon4", label: "세로 웹툰 · 4컷", hint: "긴 호흡", canvasH: 1920, frames: stack(4, 1920) },
  { id: "webtoon5", label: "세로 웹툰 · 5컷", hint: "긴 스크롤", canvasH: 2400, frames: stack(5, 2400) },
  { id: "webtoon6", label: "세로 웹툰 · 6컷", hint: "연재형 구성", canvasH: 2880, frames: stack(6, 2880) },
  { id: "webtoon7", label: "세로 웹툰 · 7컷", hint: "대화와 리액션", canvasH: 3240, frames: stack(7, 3240) },
  { id: "webtoon8", label: "세로 웹툰 · 8컷", hint: "긴 에피소드", canvasH: 3600, frames: stack(8, 3600) },
  { id: "strip4", label: "4컷 만화", hint: "기승전결", canvasH: 1680, frames: stack(4, 1680) },
  {
    id: "grid4",
    label: "4컷 그리드",
    hint: "2×2 배치",
    canvasH: 1080,
    frames: [
      { x: M, y: M, width: (CANVAS_W - M * 3) / 2, height: (1080 - M * 3) / 2 },
      { x: M * 2 + (CANVAS_W - M * 3) / 2, y: M, width: (CANVAS_W - M * 3) / 2, height: (1080 - M * 3) / 2 },
      { x: M, y: M * 2 + (1080 - M * 3) / 2, width: (CANVAS_W - M * 3) / 2, height: (1080 - M * 3) / 2 },
      {
        x: M * 2 + (CANVAS_W - M * 3) / 2,
        y: M * 2 + (1080 - M * 3) / 2,
        width: (CANVAS_W - M * 3) / 2,
        height: (1080 - M * 3) / 2,
      },
    ],
  },
  { id: "grid6", label: "6컷 그리드(2x3)", hint: "2열 3행", canvasH: 1440, frames: grid(2, 3, 1440) },
  { id: "grid8", label: "8컷(2x4)", hint: "2열 4행", canvasH: 1680, frames: grid(2, 4, 1680) },
  { id: "grid9", label: "9컷 그리드", hint: "3열 3행", canvasH: 1080, frames: grid(3, 3, 1080) },
  { id: "grid12", label: "12컷 콘택트 시트", hint: "3열 4행", canvasH: 1440, frames: grid(3, 4, 1440) },
  { id: "storyboard3", label: "스토리보드 · 3장면", hint: "가로 시퀀스", canvasH: 720, frames: columns(3, 720) },
  { id: "storyboard6", label: "스토리보드 · 6장면", hint: "3열 2행", canvasH: 960, frames: grid(3, 2, 960) },
  {
    id: "dynamic-hero-top",
    label: "히어로 상단 · 3컷",
    hint: "큰 도입 + 리액션",
    canvasH: 1200,
    frames: [
      { x: M, y: M, width: CANVAS_W - M * 2, height: 700 },
      { x: M, y: 748, width: (CANVAS_W - M * 3) / 2, height: 428 },
      { x: M * 2 + (CANVAS_W - M * 3) / 2, y: 748, width: (CANVAS_W - M * 3) / 2, height: 428 },
    ],
  },
  {
    id: "dynamic-hero-left",
    label: "히어로 좌측 · 3컷",
    hint: "인물 강조 구성",
    canvasH: 1080,
    frames: [
      { x: M, y: M, width: 420, height: 1032 },
      { x: 468, y: M, width: 228, height: 504 },
      { x: 468, y: 552, width: 228, height: 504 },
    ],
  },
  {
    id: "dynamic-hero-right",
    label: "히어로 우측 · 3컷",
    hint: "대상 강조 구성",
    canvasH: 1080,
    frames: [
      { x: M, y: M, width: 228, height: 504 },
      { x: M, y: 552, width: 228, height: 504 },
      { x: 276, y: M, width: 420, height: 1032 },
    ],
  },
  {
    id: "dynamic-manga-five",
    label: "만화 리듬 · 5컷",
    hint: "강약이 다른 컷",
    canvasH: 1440,
    frames: [
      { x: M, y: M, width: CANVAS_W - M * 2, height: 520 },
      { x: M, y: 568, width: 250, height: 380 },
      { x: 298, y: 568, width: 398, height: 380 },
      { x: M, y: 972, width: 398, height: 444 },
      { x: 446, y: 972, width: 250, height: 444 },
    ],
  },
  {
    id: "dynamic-dialogue",
    label: "대화 장면 · 3컷",
    hint: "투샷 + 표정 교차",
    canvasH: 1320,
    frames: [
      { x: M, y: M, width: CANVAS_W - M * 2, height: 610 },
      { x: M, y: 658, width: (CANVAS_W - M * 3) / 2, height: 638 },
      { x: M * 2 + (CANVAS_W - M * 3) / 2, y: 658, width: (CANVAS_W - M * 3) / 2, height: 638 },
    ],
  },
  { id: "cover-square", label: "정사각 커버", hint: "썸네일·SNS", canvasH: 720, frames: insetFrame(720, 36) },
  { id: "cover-instagram", label: "인스타툰 정사각", hint: "1080×1080 SNS 연재", canvasH: 720, frames: insetFrame(720, 24) },
  { id: "cover-poster", label: "세로 포스터", hint: "표지·키비주얼", canvasH: 1080, frames: insetFrame(1080, 42) },
  { id: "cover-story", label: "스토리 커버", hint: "긴 세로 프로모션", canvasH: 1280, frames: insetFrame(1280, 36) },
  { id: "webtoon-character-sheet", label: "캐릭터 설정집", hint: "삼면도·표정 모음집", canvasH: 1440, frames: grid(2, 2, 1440) },
  { id: "webtoon10", label: "세로 웹툰 · 10컷", hint: "장편 연재 표준 10컷", canvasH: 4500, frames: stack(10, 4500) },
  {
    id: "dynamic-action-zoom",
    label: "액션 줌 · 4컷",
    hint: "타격감 액션 연출",
    canvasH: 1500,
    frames: [
      { x: M, y: M, width: CANVAS_W - M * 2, height: 400 },
      { x: M, y: 448, width: 320, height: 500 },
      { x: 368, y: 448, width: CANVAS_W - 368 - M, height: 500 },
      { x: M, y: 972, width: CANVAS_W - M * 2, height: 504 },
    ],
  },
  {
    id: "dynamic-cinematic-banner",
    label: "시네마틱 파노라마",
    hint: "영화 같은 파노라마 연출",
    canvasH: 1200,
    frames: [
      { x: M, y: M, width: CANVAS_W - M * 2, height: 350 },
      { x: M, y: 398, width: CANVAS_W - M * 2, height: 350 },
      { x: M, y: 796, width: CANVAS_W - M * 2, height: 380 },
    ],
  },
  { id: "single", label: "한 컷", hint: "일러스트·표지", canvasH: 900, frames: stack(1, 900) },
];

// 템플릿을 유형별로 묶어 메뉴에서 일관된 우선순위로 보여준다.
export const TEMPLATE_GROUP_ORDER = [
  "세로 웹툰",
  "컷만화·그리드",
  "다이내믹 컷",
  "스토리보드",
  "커버·소셜",
  "기본",
] as const;
function templateGroupOf(id: string): string {
  if (id.startsWith("webtoon")) return "세로 웹툰";
  if (id === "strip4" || id.startsWith("grid")) return "컷만화·그리드";
  if (id.startsWith("dynamic")) return "다이내믹 컷";
  if (id.startsWith("storyboard")) return "스토리보드";
  if (id.startsWith("cover")) return "커버·소셜";
  return "기본"; // blank, single
}
export function groupTemplates(templates: TemplateSpec[]): { group: string; templates: TemplateSpec[] }[] {
  return TEMPLATE_GROUP_ORDER.map((group) => ({
    group,
    templates: templates.filter((t) => templateGroupOf(t.id) === group),
  })).filter((g) => g.templates.length > 0);
}

export type BubbleVariant =
  | "speech"
  | "double"
  | "thought"
  | "shout"
  | "box"
  | "whisper"
  | "scared"
  | "system"
  | "heart"
  | "phone"
  | "angry"
  | "explosive"
  | "cloud-soft"
  | "digital-code"
  | "sparkle-magical"
  | "comic-narrative";
export const BUBBLE_VARIANTS: { id: BubbleVariant; label: string; hint: string }[] = [
  { id: "speech", label: "말하기", hint: "기본 대사" },
  { id: "double", label: "이어 말하기", hint: "긴 대사·시간차" },
  { id: "thought", label: "생각", hint: "속마음·독백" },
  { id: "shout", label: "외침", hint: "큰 소리·충격" },
  { id: "whisper", label: "속삭임", hint: "작은 목소리" },
  { id: "scared", label: "소심·공포", hint: "떨림·불안" },
  { id: "system", label: "상태창", hint: "퀘스트·알림" },
  { id: "heart", label: "러블리", hint: "호감·설렘" },
  { id: "phone", label: "메신저", hint: "채팅·문자" },
  { id: "angry", label: "격앙", hint: "분노·절규" },
  { id: "box", label: "내레이션", hint: "시간·장소 설명" },
  { id: "explosive", label: "임팩트 폭발", hint: "격렬한 액션 충격" },
  { id: "cloud-soft", label: "몽환 구름", hint: "꿈결·회상 독백" },
  { id: "digital-code", label: "SF 디지털", hint: "게임·홀로그램 통신" },
  { id: "sparkle-magical", label: "마법 반짝이", hint: "마법·신비로운 대사" },
  { id: "comic-narrative", label: "만화 해설 띠", hint: "상단 긴 내레이션 띠" },
];

/** 말풍선 라이브러리/인스펙터에서 종류를 역할별로 묶어 보여 다양성이 한눈에 들어오게 한다. */
export const BUBBLE_VARIANT_GROUPS: { group: string; ids: BubbleVariant[] }[] = [
  { group: "대사", ids: ["speech", "double", "whisper", "comic-narrative"] },
  { group: "감정", ids: ["thought", "shout", "scared", "angry", "heart", "explosive", "cloud-soft", "sparkle-magical"] },
  { group: "연출·UI", ids: ["system", "phone", "box", "digital-code"] },
];

export function groupBubbleVariants(
  variants: { id: BubbleVariant; label: string; hint: string }[] = BUBBLE_VARIANTS
): { group: string; variants: { id: BubbleVariant; label: string; hint: string }[] }[] {
  const byId = new Map(variants.map((v) => [v.id, v] as const));
  return BUBBLE_VARIANT_GROUPS.map((g) => ({
    group: g.group,
    variants: g.ids.map((id) => byId.get(id)).filter((v): v is { id: BubbleVariant; label: string; hint: string } => !!v),
  })).filter((g) => g.variants.length > 0);
}

// 만화 효과 이모지(스티커).
export const EFFECT_EMOJIS = [
  "💢", "💦", "✨", "💕", "💥", "😱", "🔥", "⚡", "😤", "💧", "❗", "❓", "💤", "🎶", "👊", "🌀",
  "⭐", "🌸", "💬", "🗯️", "💭", "☀️", "🌙", "💫", "💘", "🎉", "📢", "⚠️", "🔮", "💡",
];

// 효과음 텍스트(흰 글자 + 검은 외곽선의 만화 SFX).
export const SFX_PRESETS: { text: string; fill: string }[] = [
  { text: "쾅!", fill: "#ffffff" },
  { text: "두근", fill: "#ff5a7a" },
  { text: "헉!", fill: "#ffffff" },
  { text: "팟", fill: "#ffd166" },
  { text: "콰광!", fill: "#ffffff" },
  { text: "반짝", fill: "#7ad7ff" },
  { text: "피웅!", fill: "#ff5252" },
  { text: "슉-", fill: "#e0e0e0" },
  { text: "우르릉!", fill: "#ffb74d" },
  { text: "샤라랑", fill: "#f48fb1" },
  { text: "번쩍!", fill: "#ffff72" },
  { text: "치이익", fill: "#81c784" },
  { text: "콰아아", fill: "#4fc3f7" },
  { text: "톡-", fill: "#ce93d8" },
];

export interface BgPreset {
  id: string;
  label: string;
  fill?: string;
  grad?: string[]; // 2색 세로 그라디언트 stop 색상
}
export const BG_PRESETS: BgPreset[] = [
  { id: "white", label: "흰색", fill: "#ffffff" },
  { id: "cream", label: "크림", fill: "#fbf3e4" },
  { id: "ink", label: "먹지", fill: "#1a1410" },
  { id: "sky", label: "하늘", grad: ["#bfe6ff", "#eaf7ff"] },
  { id: "sunset", label: "노을", grad: ["#ffd9a0", "#ff9aa2"] },
  { id: "night", label: "밤", grad: ["#2a2350", "#0e0b1f"] },
  { id: "cyberpunk-night", label: "사이버펑크 네온", grad: ["#2c003e", "#050014"] },
  { id: "cherry-blossom", label: "벚꽃 분홍", grad: ["#ffdde1", "#ee9ca7"] },
  { id: "emerald-forest", label: "에메랄드 숲", grad: ["#134e5e", "#71b280"] },
  { id: "vintage-manga", label: "빈티지 갱지", fill: "#f4eedb" },
  { id: "golden-noon", label: "따스한 햇살", grad: ["#ffe53b", "#ff2525"] },
];

// ── 에셋 피커 검색(효과·배경 씬 메뉴) ──────────────────────────
// 라벨 부분일치(대소문자 무시·공백 트림)로 에셋 목록을 거른다. 빈 검색어는 원본 그대로.
export function filterAssetsByLabel<T extends { label: string }>(assets: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return assets;
  return assets.filter((asset) => asset.label.toLowerCase().includes(q));
}

// 장르 섹션 배열을 같은 규칙으로 거르고, 결과가 빈 섹션은 숨긴다(배경 씬 메뉴용).
export function filterBgSceneSections<T extends { label: string }>(
  sections: { genre: string; scenes: T[] }[],
  query: string
): { genre: string; scenes: T[] }[] {
  if (!query.trim()) return sections;
  return sections
    .map((section) => ({ ...section, scenes: filterAssetsByLabel(section.scenes, query) }))
    .filter((section) => section.scenes.length > 0);
}

export {
  BUBBLE_STYLE_PRESETS,
  type BubbleStylePreset,
} from "./lettering/studio-bubble-style-presets";
