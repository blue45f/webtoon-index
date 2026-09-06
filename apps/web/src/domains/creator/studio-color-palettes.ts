/**
 * Studio Color Palettes
 * 웹툰 채색 실무용 큐레이션 팔레트 + 최근 사용 색 추적 + 듀오톤 프리셋.
 * 전부 순수 모듈 — DOM/Konva 의존 없음. StudioPage 색상 패널과 단위 테스트가 공유한다.
 */

export {
  isValidHexColor,
  normalizeHexColor,
  pushRecentColor,
  readRecentColors,
  RECENT_COLORS_KEY,
  storeRecentColors,
} from "./studio-color-utils";

// 큐레이션 팔레트 한 벌(색상 패널의 탭 단위).
export type StudioPalette = {
  id: string;
  label: string;
  tip: string;
  colors: string[];
};

// 웹툰 채색에서 자주 쓰는 장면별 팔레트. 색은 전부 소문자 #rrggbb.
export const STUDIO_PALETTES: StudioPalette[] = [
  {
    id: "skin-natural",
    label: "피부톤",
    tip: "인물 피부 베이스·음영을 밝은 톤부터 어두운 톤까지 한 줄에서 고르세요.",
    colors: [
      "#ffe9dc",
      "#ffdcc5",
      "#f8cdb0",
      "#f0bd9d",
      "#e3a988",
      "#cf9272",
      "#b87a5c",
      "#9c6248",
      "#7d4a35",
      "#5e3526",
    ],
  },
  {
    id: "hair-natural",
    label: "헤어 내추럴",
    tip: "흑발·갈색·금발 등 현실 머리색의 베이스와 하이라이트용.",
    colors: [
      "#1b1b22",
      "#2e2a2b",
      "#463733",
      "#5c4334",
      "#75543c",
      "#8d6a4a",
      "#a8845c",
      "#c4a06f",
      "#dcbb85",
      "#e9d3a2",
    ],
  },
  {
    id: "hair-vivid",
    label: "헤어 비비드",
    tip: "판타지·학원물 주연의 개성 있는 염색 머리에 포인트로.",
    colors: [
      "#ff5d73",
      "#ff8fb1",
      "#c377f2",
      "#7c52e0",
      "#5d8bf4",
      "#42a9e8",
      "#28c2a8",
      "#5cc978",
      "#f0c22e",
      "#f2853a",
    ],
  },
  {
    id: "sky-hours",
    label: "하늘·시간대",
    tip: "새벽부터 깊은 밤까지 — 배경 하늘 그라데이션을 시간 순서로.",
    colors: [
      "#c9d3ee",
      "#9cc4ec",
      "#5ea0e0",
      "#f5b04c",
      "#ef8354",
      "#c45b8c",
      "#7b5298",
      "#4a4380",
      "#3d3a6e",
      "#1e2244",
    ],
  },
  {
    id: "nature-green",
    label: "자연·초목",
    tip: "잎·풀·숲 배경의 밝은 새싹색부터 그늘진 심녹색까지.",
    colors: [
      "#eaf4d3",
      "#cde6a5",
      "#a8d278",
      "#82bb55",
      "#61a23f",
      "#4c8a38",
      "#3a7233",
      "#2d5a2e",
      "#224428",
      "#16301e",
    ],
  },
  {
    id: "pastel-mood",
    label: "파스텔 무드",
    tip: "일상물·힐링 장면의 부드러운 분위기 연출과 말풍선 배경에.",
    colors: [
      "#ffd6e0",
      "#ffe3c9",
      "#fff3c4",
      "#e6f5c9",
      "#cdeede",
      "#c9e7f2",
      "#ccd9f5",
      "#ddd2f3",
      "#f0d3ef",
      "#f9e2ea",
    ],
  },
  {
    id: "neon-cyber",
    label: "네온·사이버",
    tip: "사이버펑크 도시 야경 — 어두운 베이스 위에 네온 광원을 얹으세요.",
    colors: [
      "#0d0b1e",
      "#1d1745",
      "#35206e",
      "#ff2d95",
      "#ff6ec7",
      "#9d3ce8",
      "#00e5ff",
      "#00ffa3",
      "#d8ff3e",
      "#f4f1ff",
    ],
  },
  {
    id: "vintage-sepia",
    label: "빈티지 세피아",
    tip: "회상 장면·오래된 사진 연출 등 따뜻한 갈색조 통일감에.",
    colors: [
      "#f6ead8",
      "#ecd9bb",
      "#ddc29a",
      "#c9a87c",
      "#b08f63",
      "#94734e",
      "#785b3d",
      "#5c442e",
      "#423020",
      "#2b1f15",
    ],
  },
  {
    id: "mono-ink",
    label: "모노 잉크",
    tip: "웹툰 먹선·흑백 원고용 회색 단계 — 선화와 톤 정리에.",
    colors: [
      "#000000",
      "#1a1a1a",
      "#333333",
      "#4d4d4d",
      "#666666",
      "#808080",
      "#999999",
      "#b3b3b3",
      "#cccccc",
      "#e6e6e6",
      "#f5f5f5",
      "#ffffff",
    ],
  },
  {
    id: "romance-pink",
    label: "로맨스 핑크",
    tip: "설렘·고백 장면의 볼터치, 꽃잎, 분위기 오버레이에.",
    colors: [
      "#fff0f4",
      "#ffdce7",
      "#ffc2d4",
      "#ffa8c5",
      "#f98bb5",
      "#ee6fa4",
      "#dc5694",
      "#c04183",
      "#9c3070",
      "#6e2354",
    ],
  },
  {
    id: "autumn-fall",
    label: "가을 단풍",
    tip: "낙엽·단풍 장면의 배경과 옷 배색 — 옅은 볏짚색부터 짙은 적갈까지.",
    colors: [
      "#fdf0c8",
      "#f7d98a",
      "#f0b85c",
      "#e89a4a",
      "#d97a3e",
      "#c25a38",
      "#a63f2e",
      "#832f28",
      "#5c2418",
      "#3a1810",
    ],
  },
  {
    id: "dark-fantasy",
    label: "다크 판타지",
    tip: "마법진·저주·악역 연출 등 채도 낮은 보라~청록의 신비로운 밤 장면에.",
    colors: [
      "#0a0714",
      "#160f28",
      "#241a3e",
      "#362355",
      "#4a2f6e",
      "#5c3d82",
      "#3a5a6e",
      "#2f7d78",
      "#57a190",
      "#8f6bb0",
    ],
  },
];

// 듀오톤 프리셋 — shadow(어두운 쪽)·highlight(밝은 쪽) 두 색으로 장면 무드를 통일.
export type DuotonePreset = {
  id: string;
  label: string;
  shadow: string;
  highlight: string;
};

export const DUOTONE_PRESETS: DuotonePreset[] = [
  { id: "ink-paper", label: "먹·백", shadow: "#1a1a1a", highlight: "#f8f8f6" },
  { id: "navy-cream", label: "네이비·크림", shadow: "#1f2a52", highlight: "#f6edd8" },
  { id: "purple-peach", label: "퍼플·피치", shadow: "#4b2a6e", highlight: "#ffd9b8" },
  { id: "teal-lemon", label: "청록·레몬", shadow: "#0f5a5a", highlight: "#f6f3b5" },
  { id: "maroon-ivory", label: "적갈·아이보리", shadow: "#5c2a1e", highlight: "#f7f1e3" },
  { id: "pink-sky", label: "핑크·하늘", shadow: "#b03a6b", highlight: "#d8effb" },
  { id: "sepia-ivory", label: "세피아·아이보리", shadow: "#6b4a2e", highlight: "#f5ecdc" },
  { id: "blue-rose", label: "블루·로즈", shadow: "#27418f", highlight: "#fbd8de" },
];
