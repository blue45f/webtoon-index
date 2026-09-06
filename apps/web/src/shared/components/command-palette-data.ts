import {
  getAudioState,
  setBgmEnabled,
  setSfxEnabled,
} from "@toonspectrum/core/fx";
import {
  SlidersHorizontal,
  Volume2,
  Music,
  Copy,
  Shuffle,
  Trash2,
  Paintbrush,
  Palette,
  Layers,
  Type,
  Eraser,
  MousePointer,
  ZoomIn,
  Hand,
  TrendingUp,
  Library,
  CalendarDays,
  Swords,
  Compass,
  BarChart3,
  Moon,
  Sparkles,
  Store,
  HelpCircle,
  MessageSquare,
  Star,
  FileCode,
  Sliders,
  Pipette,
} from "lucide-react";

import type { PaletteCommand, PalettePage, PaletteStudioTool, PaletteMode } from "./command-palette-types";

import { useApp } from "@/shared/lib/store";

export const PALETTE_MODE_TABS: { id: PaletteMode; label: string; prefix?: string }[] = [
  { id: "all", label: "전체" },
  { id: "titles", label: "작품", prefix: "@" },
  { id: "commands", label: "명령어", prefix: ">" },
  { id: "studio", label: "스튜디오", prefix: "/" },
  { id: "pages", label: "페이지" },
  { id: "shortcuts", label: "단축키", prefix: "?" },
];

export const TRENDING_TAGS = [
  { tag: "로맨스판타지", label: "#로맨스판타지", color: "oklch(0.78 0.16 340)" },
  { tag: "먼치킨", label: "#먼치킨", color: "oklch(0.78 0.16 290)" },
  { tag: "사이다", label: "#사이다", color: "oklch(0.78 0.15 222)" },
  { tag: "스릴러", label: "#스릴러", color: "oklch(0.78 0.12 195)" },
  { tag: "힐링", label: "#힐링", color: "oklch(0.78 0.12 162)" },
  { tag: "성장물", label: "#성장물", color: "oklch(0.78 0.16 138)" },
  { tag: "회빙환", label: "#회빙환", color: "oklch(0.78 0.17 22)" },
  { tag: "학원", label: "#학원", color: "oklch(0.78 0.15 78)" },
];

export const PALETTE_COMMANDS: PaletteCommand[] = [
  {
    id: "cmd-toggle-sfx",
    title: "효과음(SFX) 토글",
    subtitle: "버튼 클릭 및 모달 상호작용 사운드 켜기/끄기",
    category: "audio",
    icon: Volume2,
    shortcut: ["⌥", "S"],
    keywords: ["소리", "사운드", "효과음", "음향", "sfx", "sound", "audio", "volume", "mute"],
    description: "ToonSpectrum 전역의 상호작용 피드백 효과음(SFX)을 활성화하거나 음소거합니다.",
    getState: () => {
      const state = getAudioState();
      return {
        active: state.sfxEnabled && !state.muted,
        label: state.sfxEnabled && !state.muted ? "켜짐" : "꺼짐",
      };
    },
    action: (ctx) => {
      const current = getAudioState().sfxEnabled && !getAudioState().muted;
      const next = !current;
      setSfxEnabled(next);
      ctx.showToast(next ? "효과음이 켜졌습니다." : "효과음이 꺼졌습니다.", { tone: next ? "success" : "default" });
      if (next) ctx.playSfx("success");
    },
  },
  {
    id: "cmd-toggle-bgm",
    title: "배경음악(BGM) 토글",
    subtitle: "웹툰 분위기에 맞춘 생성형 앰비언트 사운드",
    category: "audio",
    icon: Music,
    shortcut: ["⌥", "M"],
    keywords: ["음악", "bgm", "배경음", "노래", "music", "ambient", "ost"],
    description: "웹툰 감상과 창작 작업에 몰입감을 주는 앰비언트 배경음악을 토글합니다.",
    getState: () => {
      const state = getAudioState();
      return {
        active: state.bgmEnabled && !state.muted,
        label: state.bgmEnabled && !state.muted ? "재생중" : "정지",
      };
    },
    action: (ctx) => {
      const current = getAudioState().bgmEnabled && !getAudioState().muted;
      const next = !current;
      setBgmEnabled(next);
      ctx.showToast(next ? "배경음악이 켜졌습니다." : "배경음악이 정지되었습니다.", { tone: next ? "success" : "default" });
      if (next) ctx.playSfx("pop");
    },
  },
  {
    id: "cmd-copy-link",
    title: "현재 페이지 링크 복사",
    subtitle: "클립보드에 현재 주소 복사하기",
    category: "system",
    icon: Copy,
    shortcut: ["⌘", "C"],
    keywords: ["링크", "복사", "공유", "url", "share", "copy"],
    description: "현재 보고 있는 페이지의 웹 주소를 클립보드에 복사하여 다른 사람에게 공유합니다.",
    action: async (ctx) => {
      try {
        if (typeof window !== "undefined" && navigator.clipboard) {
          await navigator.clipboard.writeText(window.location.href);
          ctx.showToast("현재 페이지 링크가 복사되었습니다.", { tone: "success" });
          ctx.playSfx("success");
          ctx.closePalette();
        }
      } catch {
        ctx.showToast("링크 복사에 실패했습니다.");
      }
    },
  },
  {
    id: "cmd-random-pick",
    title: "랜덤 웹툰 발견",
    subtitle: "운명적인 다음 정주행 작품 무작위 추첨",
    category: "navigation",
    icon: Shuffle,
    shortcut: ["R"],
    keywords: ["랜덤", "뽑기", "무작위", "추천", "발견", "random", "shuffle"],
    description: "수천 편의 카탈로그 중에서 엄선된 추천 웹툰을 무작위로 뽑아 바로 연결합니다.",
    action: (ctx) => {
      ctx.playSfx("pop");
      ctx.closePalette();
      ctx.router.push("/random");
    },
  },
  {
    id: "cmd-new-canvas-webtoon",
    title: "새 웹툰 캔버스 (800 × 12800)",
    subtitle: "모바일 표준 세로 스크롤 웹툰 작업 문서 생성",
    category: "studio",
    icon: FileCode,
    keywords: ["웹툰", "스크롤", "캔버스", "새작업", "도화지", "만화", "webtoon", "canvas"],
    description: "네이버·카카오 표준 모바일 세로 스크롤 규격(800px 너비)으로 스튜디오 캔버스를 즉시 생성합니다.",
    action: (ctx) => {
      ctx.playSfx("pop");
      ctx.closePalette();
      ctx.router.push("/studio?preset=webtoon");
    },
  },
  {
    id: "cmd-new-canvas-4cut",
    title: "새 4컷 만화 캔버스 (1600 × 2400)",
    subtitle: "인스타그램·SNS 컷툰/단편 전용 템플릿",
    category: "studio",
    icon: Sliders,
    keywords: ["4컷", "컷툰", "만화", "인스타", "sns", "comic", "cut"],
    description: "SNS 연재 및 단편 웹툰에 최적화된 4컷 만화 프레임 규격으로 스튜디오를 엽니다.",
    action: (ctx) => {
      ctx.playSfx("pop");
      ctx.closePalette();
      ctx.router.push("/studio?preset=4cut");
    },
  },
  {
    id: "cmd-new-canvas-illustration",
    title: "새 일러스트 캔버스 (2048 × 2048)",
    subtitle: "고해상도 정사각 표지 및 캐릭터 일러스트",
    category: "studio",
    icon: Paintbrush,
    keywords: ["일러스트", "표지", "정사각", "그림", "드로잉", "illustration"],
    description: "웹툰 표지, 캐릭터 시트, 고해상도 그래픽 작업용 2K 정사각 캔버스를 로드합니다.",
    action: (ctx) => {
      ctx.playSfx("pop");
      ctx.closePalette();
      ctx.router.push("/studio?preset=illustration");
    },
  },
  {
    id: "cmd-open-market",
    title: "창작 마켓플레이스",
    subtitle: "무료 브러시·팔레트·3D 소품·템플릿 탐색",
    category: "studio",
    icon: Store,
    keywords: ["마켓", "소재", "에셋", "브러시", "팔레트", "3d", "market", "asset"],
    description: "웹툰 제작에 필요한 다양한 창작 리소스와 3D 에셋을 둘러보고 스튜디오로 가져옵니다.",
    action: (ctx) => {
      ctx.playSfx("pop");
      ctx.closePalette();
      ctx.router.push("/market");
    },
  },
  {
    id: "cmd-clear-history",
    title: "최근 검색 기록 전체 삭제",
    subtitle: "로컬에 저장된 모든 최근 검색어 비우기",
    category: "history",
    icon: Trash2,
    keywords: ["기록", "삭제", "비우기", "검색어", "clear", "history", "delete"],
    description: "팔레트 및 검색 화면에 누적된 최근 검색어 기록을 모두 초기화합니다.",
    action: (ctx) => {
      useApp.getState().clearRecentSearches();
      ctx.showToast("최근 검색 기록이 모두 삭제되었습니다.", { tone: "info" });
      ctx.playSfx("tick");
    },
  },
];

export const PALETTE_STUDIO_TOOLS: PaletteStudioTool[] = [
  {
    id: "tool-pen",
    name: "G펜 / 잉크 브러시",
    shortcutKey: "B",
    category: "draw",
    icon: Paintbrush,
    tip: "웹툰 선화와 드로잉의 기본이 되는 압력 감응 G펜 브러시 도구입니다.",
    keywords: ["펜", "브러시", "선화", "스케치", "pen", "brush", "draw"],
  },
  {
    id: "tool-eraser",
    name: "지우개",
    shortcutKey: "E",
    category: "draw",
    icon: Eraser,
    tip: "선이나 채색 레이어의 획을 부드럽거나 선명하게 지웁니다.",
    keywords: ["지우개", "삭제", "지우기", "eraser", "clear"],
  },
  {
    id: "tool-fill",
    name: "페인트 버킷 (채우기)",
    shortcutKey: "G",
    category: "edit",
    icon: Palette,
    tip: "틈새 닫힘 및 인접 영역 자동 감지 기능이 적용된 밑색 채우기 버킷입니다.",
    keywords: ["채우기", "페인트", "버킷", "색칠", "fill", "bucket", "paint"],
  },
  {
    id: "tool-eyedropper",
    name: "스포이드",
    shortcutKey: "I",
    category: "edit",
    icon: Pipette,
    tip: "캔버스나 참고 이미지 위의 색상을 클릭해 전경색으로 즉시 추출합니다.",
    keywords: ["스포이드", "색추출", "컬러픽커", "eyedropper", "picker", "sample"],
  },
  {
    id: "tool-select",
    name: "영역 선택 (마키/올가미)",
    shortcutKey: "M",
    category: "edit",
    icon: MousePointer,
    tip: "원하는 부위를 사각 또는 자유형 올가미로 지정해 변형/이동/복사합니다.",
    keywords: ["선택", "영역", "마키", "올가미", "select", "marquee", "lasso"],
  },
  {
    id: "tool-text",
    name: "텍스트 & 말풍선",
    shortcutKey: "T",
    category: "canvas",
    icon: Type,
    tip: "웹툰 전용 대사 입력 및 꼬리 달린 벡터 말풍선을 생성하고 편집합니다.",
    keywords: ["텍스트", "대사", "말풍선", "글자", "폰트", "text", "balloon", "bubble"],
  },
  {
    id: "tool-hand",
    name: "손 도구 (팬 이동)",
    shortcutKey: "H",
    category: "canvas",
    icon: Hand,
    tip: "긴 세로 스크롤 웹툰 캔버스를 화면 비율 그대로 자연스럽게 스크롤합니다.",
    keywords: ["손", "팬", "이동", "스크롤", "화면", "hand", "pan"],
  },
  {
    id: "tool-zoom",
    name: "돋보기 줌",
    shortcutKey: "Z",
    category: "canvas",
    icon: ZoomIn,
    tip: "원하는 배율로 확대하거나 전체 캔버스 맞춤 보기를 실행합니다.",
    keywords: ["줌", "확대", "축소", "돋보기", "zoom", "fit"],
  },
  {
    // ⌘K 팔레트는 스튜디오 F1 통합 검색과 별개의 목록이라, 한쪽에만 넣으면 다른 쪽에서 0건이
    // 된다. 형제인 "레이어 패널"만 여기 있고 그 옆 패널이 빠져 있었다.
    id: "tool-work-panel",
    name: "작업 패널",
    shortcutKey: "F1",
    category: "panel",
    icon: SlidersHorizontal,
    tip: "선택한 대상의 속성과 그리기 도구 설정을 한곳에서 조절합니다.",
    // "속성 패널"은 이 패널의 옛 이름이다 — 손버릇이 끊기지 않게 검색어로 남긴다.
    // 구(句) 전체를 한 항목으로 넣는다: matchesCommandSearch 는 키워드 **하나가** 질의 전체를
    // 포함하는지 보므로, "속성"·"패널"로 쪼개 두면 "속성 패널"이라고 친 사람은 0건을 본다.
    keywords: [
      "속성 패널",
      "properties panel",
      "작업",
      "속성",
      "패널",
      "대상",
      "인스펙터",
      "properties",
      "inspector",
      "panel",
    ],
  },
  {
    id: "tool-character-shaper",
    name: "캐릭터 셰이퍼",
    shortcutKey: "",
    category: "panel",
    icon: Sparkles,
    actionPath: "/studio/character",
    tip: "프리셋 카드로 3D 캐릭터를 만들고 포즈를 잡아 투명 PNG·레이어 PSD로 내보냅니다.",
    keywords: ["셰이퍼", "shaper", "캐릭터", "프리셋", "3d", "vrm", "포즈", "의상", "character"],
  },
  {
    id: "tool-layers",
    name: "레이어 패널",
    shortcutKey: "L",
    category: "panel",
    icon: Layers,
    tip: "선화, 채색, 말풍선, 배경 레이어의 순서와 블렌드 모드를 관리합니다.",
    keywords: ["레이어", "패널", "합성", "블렌드", "layer", "opacity"],
  },
];

export const PALETTE_PAGES: PalettePage[] = [
  {
    id: "page-home",
    href: "/",
    title: "홈",
    subtitle: "에디토리얼 큐레이션 및 추천 스토리 피드",
    icon: Sparkles,
    category: "main",
    keywords: ["홈", "메인", "피드", "추천", "home", "main"],
  },
  {
    id: "page-ranking",
    href: "/ranking",
    title: "다축 통합 랭킹",
    subtitle: "인기·별점·정주행·성장세 6대 기준 랭킹",
    icon: TrendingUp,
    shortcut: ["G", "R"],
    category: "discover",
    keywords: ["랭킹", "순위", "차트", "인기", "인기순", "ranking", "top"],
  },
  {
    id: "page-explore",
    href: "/explore",
    title: "장르 스펙트럼 탐색",
    subtitle: "18개 장르 색상환과 키워드 다차원 필터",
    icon: Compass,
    category: "discover",
    keywords: ["탐색", "장르", "스펙트럼", "분류", "explore", "genre"],
  },
  {
    id: "page-library",
    href: "/library",
    title: "내 서재",
    subtitle: "관심 등록, 별점 준 작품, 최근 열람 목록",
    icon: Library,
    shortcut: ["G", "L"],
    category: "main",
    keywords: ["서재", "보관함", "내서재", "북마크", "library", "bookmarks"],
  },
  {
    id: "page-recommend",
    href: "/recommend",
    title: "취향 맞춤 추천",
    subtitle: "사용자의 열람·평가 데이터 기반 개인화 추천",
    icon: Sparkles,
    category: "discover",
    keywords: ["추천", "맞춤", "취향", "개인화", "recommend", "curation"],
  },
  {
    id: "page-calendar",
    href: "/calendar",
    title: "요일별 발행 캘린더",
    subtitle: "월~일 요일별 연재작 및 신작 업데이트 일정",
    icon: CalendarDays,
    category: "discover",
    keywords: ["캘린더", "달력", "요일", "신작", "연재", "calendar", "schedule"],
  },
  {
    id: "page-compare",
    href: "/compare",
    title: "작품 1:1 비교 분석",
    subtitle: "두 작품의 지표·평점·독자 스펙트럼 대조",
    icon: Swords,
    category: "discover",
    keywords: ["비교", "대결", "분석", "스펙트럼", "compare", "vs"],
  },
  {
    id: "page-fortune",
    href: "/fortune",
    title: "사주 & 타로 운세 추천",
    subtitle: "오늘의 일진과 기운에 어울리는 스토리 매칭",
    icon: Moon,
    category: "discover",
    keywords: ["운세", "사주", "타로", "별자리", "오늘의운세", "fortune", "tarot"],
  },
  {
    id: "page-insights",
    href: "/insights",
    title: "시장 트렌드 인사이트",
    subtitle: "장르 점유율 및 크로스플랫폼 데이터 대시보드",
    icon: BarChart3,
    category: "discover",
    keywords: ["인사이트", "통계", "트렌드", "차트", "분석", "insights", "analytics"],
  },
  {
    id: "page-studio",
    href: "/studio",
    title: "웹툰 창작 스튜디오",
    subtitle: "브라우저 기반 2D·3D 통합 만화 제작 워크스페이스",
    icon: Paintbrush,
    shortcut: ["G", "S"],
    category: "creator",
    keywords: ["스튜디오", "그리기", "캔버스", "제작", "창작", "studio", "creator"],
  },
  {
    id: "page-shaper",
    href: "/shaper",
    title: "캐릭터 셰이퍼 소개",
    subtitle: "프리셋·AI 추천·표면 드로잉·PSD 내보내기 사용 안내",
    icon: Sparkles,
    category: "creator",
    keywords: ["셰이퍼", "shaper", "캐릭터", "프리셋", "3d", "가이드", "character"],
  },
  {
    id: "page-market",
    href: "/market",
    title: "창작자 소재 마켓",
    subtitle: "브러시·팔레트·3D 에셋 커뮤니티 리소스",
    icon: Store,
    category: "creator",
    keywords: ["마켓", "소재", "에셋", "리소스", "브러시", "팔레트", "market", "assets"],
  },
  {
    id: "page-community",
    href: "/community",
    title: "독자 & 작가 커뮤니티",
    subtitle: "작품 토론, 팬아트, 창작자 펜카페 소통",
    icon: MessageSquare,
    category: "community",
    keywords: ["커뮤니티", "게시판", "토론", "팬카페", "소통", "community", "forum"],
  },
  {
    id: "page-reviews",
    href: "/reviews",
    title: "실시간 독자 리뷰",
    subtitle: "검증된 별점 및 심층 작품 서평 모아보기",
    icon: Star,
    category: "community",
    keywords: ["리뷰", "서평", "평가", "별점", "한줄평", "reviews", "ratings"],
  },
  {
    id: "page-guide",
    href: "/guide",
    title: "서비스 이용 가이드",
    subtitle: "플랫폼 비교 및 스튜디오 제작 튜토리얼",
    icon: HelpCircle,
    category: "main",
    keywords: ["가이드", "도움말", "설명서", "튜토리얼", "guide", "help"],
  },
];
