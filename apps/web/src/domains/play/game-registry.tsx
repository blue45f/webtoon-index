// 아케이드 게임 레지스트리 — 새 게임은 여기에 한 줄 추가하면 허브/라우팅에 자동 노출.
// 게임 본체는 lazy 로드해 무거운 의존(3D/웹캠)이 /play 진입 청크를 부풀리지 않게 한다.

import { Dices, Grid3x3, Hand, HelpCircle, TrendingUp } from "lucide-react";
import { lazy } from "react";

import type { PlayGameMeta } from "./play-types";

export const PLAY_GAMES: PlayGameMeta[] = [
  {
    id: "rps",
    label: "웹툰 가위바위보",
    tagline: "손동작·음성으로 웹툰봇과 가위바위보 · 묵찌빠 (버튼 플레이도 가능)",
    Icon: Hand,
    hue: 142,
    category: "트래킹",
    usesCamera: true,
    Component: lazy(() => import("./games/rps/RpsGame")),
  },
  {
    id: "quiz",
    label: "웹툰 퀴즈",
    tagline: "커버·작가·장르 힌트로 제목 맞히기",
    Icon: HelpCircle,
    hue: 200,
    category: "퀴즈",
    Component: lazy(() => import("./games/quiz/QuizGame")),
  },
  {
    id: "popularity-duel",
    label: "웹툰 인기 대결",
    tagline: "둘 중 더 인기 있는 웹툰 맞히기 (Higher/Lower)",
    Icon: TrendingUp,
    hue: 25,
    category: "퀴즈",
    Component: lazy(() => import("./games/popularity-duel/PopularityDuelGame")),
  },
  {
    id: "memory",
    label: "웹툰 짝맞추기",
    tagline: "커버를 뒤집어 같은 작품 짝 찾기",
    Icon: Grid3x3,
    hue: 150,
    category: "퍼즐",
    Component: lazy(() => import("./games/memory/MemoryGame")),
  },
  {
    id: "roulette",
    label: "웹툰 룰렛",
    tagline: "돌려서 오늘의 웹툰 추천 받기",
    Icon: Dices,
    hue: 330,
    category: "추천",
    Component: lazy(() => import("./games/roulette/RouletteGame")),
  },
];

export function findGame(id: string | undefined): PlayGameMeta | undefined {
  return PLAY_GAMES.find((g) => g.id === id);
}
