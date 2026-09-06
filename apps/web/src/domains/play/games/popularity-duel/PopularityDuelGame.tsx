import {
  guessNext,
  hasEnoughTitles,
  startDuel,
  type DuelState,
  type Guess,
} from "@toonspectrum/play-core";
import { ChevronDown, ChevronUp, Eye, RotateCcw, Trophy } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { GameHelp } from "../../GameHelp";
import { PlayCover } from "../../PlayCover";
import { usePlayTitles } from "../../use-play-catalog";


import type { PlayGameProps, PlayTitle  } from "../../play-types";

import { Button } from "@/shared/components/ui/button";

function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 큰 수를 한국어 단위(만/억)로 짧게 표기. */
function formatViews(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1).replace(/\.0$/, "")}억`;
  if (n >= 10_000) return `${Math.round(n / 10_000).toLocaleString("ko-KR")}만`;
  return n.toLocaleString("ko-KR");
}

/** 한 쪽 카드 — 앵커는 조회수 공개, 도전자는 ? 표시. */
function DuelCard({
  title,
  revealed,
  badge,
}: {
  title: PlayTitle;
  revealed: boolean;
  badge: string;
}) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-card">
      <PlayCover id={title.id} title={title.title} cover={title.cover} coverImage={title.coverImage} className="w-full" />
      <div className="flex flex-col gap-1 px-3 py-2.5">
        <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-accent">{badge}</span>
        <h3 className="line-clamp-2 min-h-[2.5rem] text-sm font-bold leading-snug text-fg">{title.title}</h3>
        <p className="truncate text-[0.7rem] text-fg-3">{title.author}</p>
        <div className="mt-1 flex items-center gap-1.5 text-sm font-bold">
          <Eye className="h-4 w-4 text-fg-3" />
          {revealed ? (
            <span className="tabular-nums text-fg">조회 {formatViews(title.views)}</span>
          ) : (
            <span className="tabular-nums text-fg-3">조회 ???</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function PopularityDuelGame({ onExit }: PlayGameProps) {
  const { titles, loading } = usePlayTitles("popular", "webtoon", 120);
  const [state, setState] = useState<DuelState<PlayTitle> | null>(null);
  const [seed, setSeed] = useState(1);
  const rngRef = useRef(seededRng(1));

  const newGame = useCallback(
    (s: number, carryBest: number) => {
      if (!hasEnoughTitles(titles)) return;
      rngRef.current = seededRng(s);
      setState(startDuel(titles, rngRef.current, carryBest));
    },
    [titles],
  );

  // 데이터 로드되면 첫 게임 시작.
  useEffect(() => {
    if (hasEnoughTitles(titles) && !state) newGame(seed, 0);
  }, [titles, state, newGame, seed]);

  const restart = () => {
    const next = seed + 1;
    setSeed(next);
    newGame(next, state?.best ?? 0);
  };

  const onGuess = (guess: Guess) => {
    setState((cur) => (cur && !cur.over ? guessNext(cur, guess, titles, rngRef.current) : cur));
  };

  if (loading || !state) {
    return (
      <div className="grid min-h-[18rem] place-items-center text-sm text-fg-2">
        {loading ? "웹툰 인기 데이터를 불러오는 중…" : "대결을 준비하는 중…"}
      </div>
    );
  }

  const { anchor, challenger, score, best, over, lastCorrect } = state;

  const status = over
    ? `게임 종료 — 최종 ${score}점, 최고 ${best}점. ${challenger.title}의 조회수는 ${formatViews(challenger.views)}였습니다.`
    : lastCorrect === true
      ? `정답! ${score}점. 다음 대결: ${challenger.title}의 인기는 더 높을까요, 낮을까요?`
      : `${anchor.title}(조회 ${formatViews(anchor.views)}) 대비 ${challenger.title}의 인기가 더 높을지 낮을지 고르세요.`;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-3">
      {/* 점수 보드 */}
      <div className="flex items-center justify-between text-sm">
        <span className="rounded-full bg-accent-soft px-3 py-1 font-bold text-accent">점수 {score}</span>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-fg-2">
            <Trophy className="h-4 w-4 text-amber-500" />
            <span className="tabular-nums">최고 {best}</span>
          </span>
          <GameHelp
            id="popularity-duel"
            title="웹툰 인기 대결"
            steps={[
              {
                emoji: "🎯",
                title: "목표",
                desc: (
                  <>
                    두 웹툰 중 <b className="text-fg">조회수가 더 많은 작품</b>을 맞히며 연승을 쌓아요.
                  </>
                ),
              },
              {
                emoji: "👀",
                title: "비교 기준",
                desc: (
                  <>
                    왼쪽 <b className="text-fg">기준 작품</b>의 조회수는 공개되고, 오른쪽{" "}
                    <b className="text-fg">도전 작품</b>의 조회수는 <span className="text-fg-3">???</span>로 가려져요.
                  </>
                ),
              },
              {
                emoji: "🔼",
                title: "선택",
                desc: (
                  <>
                    도전 작품의 조회수가 기준보다 <b className="text-fg">더 높다 / 더 낮다</b>를 골라요.
                  </>
                ),
              },
              {
                emoji: "🔥",
                title: "연승",
                desc: (
                  <>
                    맞히면 <b className="text-fg">점수 +1</b>, 직전 도전 작품이 다음 기준이 돼요. 한 번이라도 틀리면{" "}
                    <b className="text-fg">게임 종료</b>—최고 점수는 계속 이어집니다.
                  </>
                ),
              },
            ]}
          />
        </div>
      </div>

      {/* 대결 카드 두 장 */}
      <div className="flex items-stretch gap-2.5">
        <DuelCard title={anchor} revealed badge="기준 작품" />
        <div className="flex shrink-0 items-center text-xs font-black text-fg-3">VS</div>
        <DuelCard title={challenger} revealed={over} badge="도전 작품" />
      </div>

      {/* 추측 버튼 또는 게임오버 */}
      {!over ? (
        <div className="flex flex-col gap-2">
          <p className="text-center text-[0.72rem] text-fg-2">
            <span className="font-semibold text-fg">{challenger.title}</span>의 조회수는
            <span className="font-semibold text-fg"> {anchor.title}</span>보다…
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="solid" size="md" onClick={() => onGuess("higher")} className="h-12">
              <ChevronUp className="mr-1 h-5 w-5" /> 더 높다
            </Button>
            <Button variant="outline" size="md" onClick={() => onGuess("lower")} className="h-12">
              <ChevronDown className="mr-1 h-5 w-5" /> 더 낮다
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-card/60 p-4">
          <p className="text-center text-sm font-bold text-fg">
            최종 {score}점 · 최고 {best}점
          </p>
          <div className="flex items-center justify-center gap-2">
            <Button variant="solid" onClick={restart}>
              <RotateCcw className="mr-1 h-4 w-4" /> 다시 도전
            </Button>
            <Button variant="outline" onClick={onExit}>
              다른 게임
            </Button>
          </div>
        </div>
      )}

      <p className="sr-only" aria-live="polite" role="status">
        {status}
      </p>

      {/* 항상 보이는 안내/재시작(게임 진행 중에도 포기 가능) */}
      {!over && (
        <div className="flex items-center justify-between text-[0.7rem] text-fg-3">
          <span aria-hidden="true">{lastCorrect === true ? "연속 정답 중!" : "높낮이를 맞혀 보세요"}</span>
          <button
            type="button"
            onClick={restart}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-fg-3 transition hover:text-fg"
          >
            <RotateCcw className="h-3.5 w-3.5" /> 처음부터
          </button>
        </div>
      )}
    </div>
  );
}

export default PopularityDuelGame;
