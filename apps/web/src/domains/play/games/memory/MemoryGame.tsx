import {
  buildBoard,
  flipReducer,
  initState,
  isFaceUp,
  isSolved,
  type MemoryState,
  type Tile,
} from "@toonspectrum/play-core";
import { Clock, RotateCcw, Sparkles, Trophy } from "lucide-react";
import { useEffect, useReducer, useRef, useState } from "react";

import { GameHelp } from "../../GameHelp";
import { PlayCover } from "../../PlayCover";
import { usePlayTitles } from "../../use-play-catalog";


import type { PlayGameProps } from "../../play-types";

import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

const PAIRS = 6; // 6쌍 = 12타일
const MISMATCH_DELAY = 800; // 미스매치 후 다시 닫히기까지(ms)
const BEST_KEY = "toonspectrum-play-memory";

function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 최고 기록(최소 이동 횟수) 읽기 — localStorage 실패 시 무시. */
function readBest(): number | null {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    const n = raw == null ? NaN : Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function writeBest(moves: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(moves));
  } catch {
    // 비공개 모드 등 — 조용히 무시.
  }
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 타일 커버(뒤집힌 앞면) — PlayCover(실제 이미지 또는 타이포 폴백) + 제목 띠. */
function TileFace({ tile }: { tile: Tile }) {
  return (
    <div className="absolute inset-0 overflow-hidden rounded-lg">
      <PlayCover
        id={tile.titleId}
        title={tile.name}
        cover={tile.cover}
        coverImage={tile.coverImage}
        aspectClassName="h-full w-full"
      />
      <div className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 py-0.5 text-[0.58rem] font-medium text-white">
        {tile.name}
      </div>
    </div>
  );
}

function MemoryTile({
  tile,
  faceUp,
  matched,
  disabled,
  onFlip,
}: {
  tile: Tile;
  faceUp: boolean;
  matched: boolean;
  disabled: boolean;
  onFlip: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled || faceUp}
      onClick={onFlip}
      aria-pressed={faceUp}
      aria-label={faceUp ? tile.name : "뒤집힌 카드"}
      className={cn(
        "relative aspect-[3/4] w-full overflow-hidden rounded-lg border transition",
        matched
          ? "border-accent ring-2 ring-accent/40"
          : faceUp
            ? "border-accent/70"
            : "border-line hover:-translate-y-0.5 hover:border-accent/60",
        !faceUp && !disabled && "cursor-pointer",
      )}
    >
      {faceUp ? (
        <TileFace tile={tile} />
      ) : (
        <div className="absolute inset-0 grid place-items-center rounded-lg bg-accent-soft">
          <Sparkles className="h-5 w-5 text-accent/70" />
        </div>
      )}
    </button>
  );
}

export function MemoryGame({ onExit }: PlayGameProps) {
  const { titles, loading } = usePlayTitles("popular", "webtoon", 120);
  const [seed, setSeed] = useState(1);
  const [state, dispatch] = useReducer(flipReducer, [], () => initState([]));
  const [elapsed, setElapsed] = useState(0);
  const [best, setBest] = useState<number | null>(null);
  const startRef = useRef<number | null>(null);
  const recordedRef = useRef(false);

  const ready = titles.length >= PAIRS;
  const solved = isSolved(state);

  // 최초 best 로드(클라이언트에서만).
  useEffect(() => {
    setBest(readBest());
  }, []);

  // 데이터 준비되면(또는 재시작 시) 보드 구성.
  useEffect(() => {
    if (!ready) return;
    const tiles = buildBoard(titles, PAIRS, seededRng(seed));
    dispatch({ type: "reset", tiles });
    setElapsed(0);
    startRef.current = null;
    recordedRef.current = false;
  }, [ready, titles, seed]);

  // 미스매치(잠김) → 잠깐 뒤 자동 resolve로 닫기.
  useEffect(() => {
    if (!state.locked) return;
    const t = setTimeout(() => dispatch({ type: "resolve" }), MISMATCH_DELAY);
    return () => clearTimeout(t);
  }, [state.locked]);

  // 타이머 — 첫 상호작용(뒤집힌 카드/이동 발생)부터 승리까지 1초 단위로.
  const started = state.flipped.length > 0 || state.moves > 0;
  useEffect(() => {
    if (!started || solved) return;
    if (startRef.current === null) startRef.current = Date.now();
    const start = startRef.current;
    setElapsed(Math.floor((Date.now() - start) / 1000));
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [started, solved]);

  // 승리 시 최고 기록 갱신(이동 횟수 기준, 1회만).
  useEffect(() => {
    if (!solved || recordedRef.current) return;
    recordedRef.current = true;
    setBest((cur) => {
      const next = cur === null ? state.moves : Math.min(cur, state.moves);
      writeBest(next);
      return next;
    });
  }, [solved, state.moves]);

  const onFlip = (id: string) => {
    dispatch({ type: "flip", id });
  };

  const restart = () => setSeed((s) => s + 1);

  if (loading || !ready || state.tiles.length === 0) {
    return (
      <div
        className="grid min-h-[18rem] place-items-center text-sm text-fg-2"
        aria-live="polite"
      >
        {loading ? "웹툰 카드를 불러오는 중…" : "보드를 준비하는 중…"}
      </div>
    );
  }

  const matchedPairs = state.matched.length / 2;

  return (
    <div className="flex flex-col gap-3">
      {/* 상단 상태바 */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-3 text-fg-2">
          <span className="tabular-nums">
            짝 <span className="font-semibold text-fg">{matchedPairs}</span>/{PAIRS}
          </span>
          <span className="tabular-nums">
            이동 <span className="font-semibold text-fg">{state.moves}</span>
          </span>
          <span className="flex items-center gap-1 tabular-nums">
            <Clock className="h-3.5 w-3.5" />
            {fmtTime(elapsed)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {best !== null && (
            <span className="flex items-center gap-1 text-[0.72rem] text-fg-3">
              <Trophy className="h-3.5 w-3.5 text-accent" />
              최고 {best}수
            </span>
          )}
          <GameHelp
            id="memory"
            title="웹툰 짝맞추기"
            steps={[
              {
                emoji: "🎯",
                title: "목표",
                desc: (
                  <>
                    뒤집힌 <b className="text-fg">{PAIRS * 2}장의 카드</b>에서 같은 웹툰 표지{" "}
                    <b className="text-fg">{PAIRS}쌍</b>을 모두 찾으면 클리어예요.
                  </>
                ),
              },
              {
                emoji: "👆",
                title: "맞추기",
                desc: (
                  <>
                    카드를 눌러 한 번에 <b className="text-fg">두 장</b>을 뒤집고, 같은 웹툰이면
                    그대로 <span className="text-accent">고정</span>돼요.
                  </>
                ),
              },
              {
                emoji: "🔄",
                title: "안 맞으면",
                desc: (
                  <>
                    다르면 잠깐 보여준 뒤 카드가 <b className="text-fg">다시 뒤집혀요</b>. 표지
                    위치를 기억해 두세요.
                  </>
                ),
              },
              {
                emoji: "🏆",
                title: "점수",
                desc: (
                  <>
                    <b className="text-fg">이동 횟수</b>와 <b className="text-fg">시간</b>이
                    기록되며, 가장 적은 이동 수가 <span className="text-accent">최고 기록</span>으로
                    남아요.
                  </>
                ),
              },
            ]}
          />
        </div>
      </div>

      {/* 보드 */}
      <div className="grid grid-cols-4 gap-2 sm:gap-2.5">
        {state.tiles.map((tile) => {
          const matched = state.matched.includes(tile.id);
          return (
            <MemoryTile
              key={tile.id}
              tile={tile}
              faceUp={isFaceUp(state, tile.id)}
              matched={matched}
              disabled={state.locked || solved}
              onFlip={() => onFlip(tile.id)}
            />
          );
        })}
      </div>

      {/* 상태 안내(스크린리더 라이브) */}
      <p className="text-center text-[0.72rem] text-fg-3" aria-live="polite">
        {solved
          ? `🎉 클리어! ${state.moves}수 · ${fmtTime(elapsed)}${
              best !== null && state.moves <= best ? " — 최고 기록!" : ""
            }`
          : state.locked
            ? "짝이 아니에요. 카드가 다시 뒤집힙니다…"
            : state.flipped.length === 1
              ? "같은 웹툰을 찾아 카드를 한 장 더 뒤집으세요."
              : "카드 두 장을 뒤집어 같은 웹툰 표지를 맞추세요."}
      </p>

      {/* 컨트롤 */}
      <div className="flex items-center justify-center gap-2">
        <Button variant="solid" size="sm" onClick={restart}>
          <RotateCcw className="mr-1 h-4 w-4" /> {solved ? "다시 도전" : "새 보드"}
        </Button>
        <Button variant="outline" size="sm" onClick={onExit}>
          <Sparkles className="mr-1 h-4 w-4" /> 다른 게임
        </Button>
      </div>
    </div>
  );
}

export default MemoryGame;

export type { MemoryState };
