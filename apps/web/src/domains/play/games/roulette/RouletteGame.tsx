import {
  filterByGenre,
  genreChips,
  pickRandom,
  reasonFor,
  tierLabel,
} from "@toonspectrum/play-core";
import { Dices, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { GameHelp } from "../../GameHelp";
import { PlayCover } from "../../PlayCover";
import { usePlayTitles } from "../../use-play-catalog";


import type { HelpStep } from "../../GameHelp";
import type { PlayGameProps, PlayTitle } from "../../play-types";

import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** PlayTitle → PlayCover에 필요한 커버 필드. */
function coverProps(title: PlayTitle) {
  return { id: title.id, title: title.title, cover: title.cover, coverImage: title.coverImage };
}

const ALL = "전체";

const HELP_STEPS: HelpStep[] = [
  {
    emoji: "🎯",
    title: "목표",
    desc: (
      <>
        오늘 뭐 볼지 고민될 때, 룰렛이 인기 웹툰 중 <b className="text-fg">한 편</b>을 골라줘요.
      </>
    ),
  },
  {
    emoji: "🏷️",
    title: "장르 고르기",
    desc: (
      <>
        위쪽 <b className="text-fg">장르 칩</b>으로 범위를 좁혀요.{" "}
        <span className="text-accent">전체</span>면 모든 인기작에서 뽑아요.
      </>
    ),
  },
  {
    emoji: "🎲",
    title: "돌리기",
    desc: (
      <>
        <b className="text-fg">스핀!</b> 버튼을 누르면 표지가 두구두구 돌다가 한 편에서 멈춰요.
      </>
    ),
  },
  {
    emoji: "✨",
    title: "결과 보기",
    desc: (
      <>
        제목·작가·장르와 <b className="text-fg">추천 이유</b>가 떠요. 마음에 안 들면{" "}
        <span className="text-accent">다시 돌리기</span>로 또 뽑아요.
      </>
    ),
  },
];

export function RouletteGame({ onExit }: PlayGameProps) {
  const { titles, loading } = usePlayTitles("popular", "webtoon", 120);
  const [genre, setGenre] = useState<string>(ALL);
  const [result, setResult] = useState<PlayTitle | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [reel, setReel] = useState<PlayTitle | null>(null);
  const [history, setHistory] = useState<PlayTitle[]>([]);
  const [spins, setSpins] = useState(0);

  const rngRef = useRef(seededRng(1));
  const reelTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 마운트 시 한 번 비결정적으로 시드(렌더는 순수 유지) + 언마운트 타이머 정리.
  useEffect(() => {
    rngRef.current = seededRng(Date.now() >>> 0);
    return () => {
      if (reelTimer.current) clearInterval(reelTimer.current);
      if (stopTimer.current) clearTimeout(stopTimer.current);
    };
  }, []);

  const chips = titles.length ? [ALL, ...genreChips(titles)] : [ALL];
  const activeGenre = genre === ALL ? undefined : genre;
  const pool = filterByGenre(titles, activeGenre);

  const spin = () => {
    if (spinning || pool.length === 0) return;
    setSpinning(true);
    setResult(null);

    // 릴 애니메이션 — 짧게 무작위 표지를 빠르게 스쳐 지나가게 한다(가벼운 setInterval).
    reelTimer.current = setInterval(() => {
      const flick = pickRandom(pool, rngRef.current);
      if (flick) setReel(flick);
    }, 80);

    stopTimer.current = setTimeout(() => {
      if (reelTimer.current) {
        clearInterval(reelTimer.current);
        reelTimer.current = null;
      }
      const picked = pickRandom(pool, rngRef.current, activeGenre);
      setReel(null);
      setResult(picked);
      setSpinning(false);
      if (picked) {
        setSpins((n) => n + 1);
        setHistory((h) => [picked, ...h].slice(0, 8));
      }
    }, 1100);
  };

  const restart = () => {
    if (reelTimer.current) clearInterval(reelTimer.current);
    if (stopTimer.current) clearTimeout(stopTimer.current);
    reelTimer.current = null;
    stopTimer.current = null;
    setSpinning(false);
    setReel(null);
    setResult(null);
    setHistory([]);
    setSpins(0);
  };

  if (loading) {
    return (
      <div className="grid min-h-[18rem] place-items-center text-sm text-fg-2">
        웹툰 룰렛을 준비하는 중…
      </div>
    );
  }

  if (titles.length === 0) {
    return (
      <div className="flex min-h-[18rem] flex-col items-center justify-center gap-3 text-sm text-fg-2">
        <p>추천할 웹툰을 불러오지 못했어요.</p>
        <Button variant="outline" onClick={onExit}>
          다른 게임
        </Button>
      </div>
    );
  }

  const shown = reel ?? result;
  const status = spinning
    ? "룰렛을 돌리는 중…"
    : result
      ? `오늘의 추천: ${result.title}${activeGenre ? ` (${activeGenre})` : ""}`
      : "스핀 버튼을 눌러 오늘의 웹툰을 추천받으세요.";

  return (
    <div className="flex flex-col gap-4">
      {/* 헤더 — 게임 방법 안내 */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-fg-2">웹툰 룰렛</span>
        <GameHelp id="roulette" title="웹툰 룰렛" steps={HELP_STEPS} />
      </div>

      {/* 장르 칩 */}
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="장르 필터">
        {chips.map((g) => {
          const active = g === genre;
          return (
            <button
              key={g}
              type="button"
              onClick={() => setGenre(g)}
              aria-pressed={active}
              disabled={spinning}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition disabled:opacity-50",
                active
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line text-fg-2 hover:border-accent/50 hover:text-fg",
              )}
            >
              {g}
            </button>
          );
        })}
      </div>

      {/* 추천 무대 */}
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-card/50 p-4">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-accent">
          <Sparkles className="h-3.5 w-3.5" />
          오늘의 추천
        </div>

        <div
          className={cn(
            "relative aspect-[3/4] w-40 overflow-hidden rounded-xl border border-line shadow-lg transition-transform sm:w-44",
            spinning && "animate-pulse",
          )}
        >
          {shown ? (
            <PlayCover {...coverProps(shown)} aspectClassName="h-full w-full" />
          ) : (
            <div className="grid h-full w-full place-items-center bg-accent-soft/40 text-fg-3">
              <Dices className="h-10 w-10" />
            </div>
          )}
          {spinning && (
            <div className="absolute inset-0 grid place-items-center bg-black/30 text-sm font-semibold text-white">
              두구두구…
            </div>
          )}
        </div>

        {/* 결과 메타 */}
        {result && !spinning ? (
          <div className="flex w-full flex-col items-center gap-1.5 text-center">
            <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-0.5 text-[0.68rem] font-semibold text-accent">
              {tierLabel(result)}
            </span>
            <h3 className="text-balance text-base font-bold text-fg">{result.title}</h3>
            <p className="text-xs text-fg-2">{result.author}</p>
            {result.genres.length > 0 && (
              <div className="flex flex-wrap justify-center gap-1">
                {result.genres.slice(0, 4).map((g) => (
                  <span key={g} className="rounded bg-line/40 px-1.5 py-0.5 text-[0.62rem] text-fg-3">
                    {g}
                  </span>
                ))}
              </div>
            )}
            <p className="mt-1 max-w-xs text-pretty text-xs leading-relaxed text-fg-2">
              {reasonFor(result)}
            </p>
          </div>
        ) : (
          !spinning && (
            <p className="max-w-xs text-center text-xs text-fg-3">
              {activeGenre ? `'${activeGenre}' 장르에서` : "전체 인기작에서"} 한 편을 골라드려요.
            </p>
          )
        )}

        <div className="flex items-center gap-2">
          <Button variant="solid" disabled={spinning} onClick={spin}>
            <Dices className="mr-1 h-4 w-4" />
            {result ? "다시 돌리기" : "스핀!"}
          </Button>
          {spins > 0 && (
            <Button variant="ghost" size="sm" disabled={spinning} onClick={restart}>
              <RotateCcw className="mr-1 h-4 w-4" />
              초기화
            </Button>
          )}
        </div>
      </div>

      {/* 최근 스핀 기록 */}
      {history.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[0.7rem] font-medium text-fg-3">최근 추천 ({spins})</span>
          </div>
          <div className="flex gap-1.5 overflow-x-auto rounded-xl border border-line/60 bg-card/40 p-2">
            {history.map((t, i) => (
              <div
                key={`${t.id}-${i}`}
                className="flex w-12 shrink-0 flex-col items-center gap-1"
                title={t.title}
              >
                <PlayCover {...coverProps(t)} className="w-12 rounded-md border border-line/60" />
                <span className="w-full truncate text-center text-[0.55rem] text-fg-3">{t.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>

      <div className="flex justify-center">
        <Button variant="quiet" size="sm" onClick={onExit}>
          다른 게임
        </Button>
      </div>
    </div>
  );
}

export default RouletteGame;
