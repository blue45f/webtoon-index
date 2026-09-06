import { ArrowLeft, Gamepad2 } from "lucide-react";
import { Suspense, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

import { findGame, PLAY_GAMES } from "./game-registry";

import { Container } from "@/shared/components/section";
import { SharePageButton } from "@/shared/components/share-page-button";
import { cn } from "@/shared/lib/utils";


export function PlayPage() {
  const [params, setParams] = useSearchParams();
  const activeId = params.get("game") ?? undefined;
  const active = findGame(activeId);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    document.title = active ? `${active.label} · 놀이터 · 툰스펙트럼` : "놀이터 · 툰스펙트럼";
  }, [active]);

  // 라우트/게임 전환 시 제목으로 포커스 이동(스크린리더 안내).
  useEffect(() => {
    headingRef.current?.focus();
  }, [activeId]);

  const openGame = (id: string) => setParams({ game: id }, { replace: false });
  const exitGame = () => setParams({}, { replace: false });

  if (active) {
    const { Component } = active;
    return (
      <Container className="py-5">
        <button
          type="button"
          onClick={exitGame}
          className="mb-3 inline-flex items-center gap-1 text-sm text-fg-2 hover:text-fg"
        >
          <ArrowLeft className="h-4 w-4" /> 놀이터
        </button>
        <h1 ref={headingRef} tabIndex={-1} className="mb-1 flex items-center gap-2 text-lg font-bold outline-none">
          <active.Icon className="h-5 w-5 text-accent" />
          {active.label}
        </h1>
        <p className="mb-4 text-sm text-fg-2">{active.tagline}</p>
        <div style={{ ["--char-hue" as string]: active.hue }}>
          <Suspense fallback={<div className="grid min-h-[16rem] place-items-center text-sm text-fg-2">게임을 불러오는 중…</div>}>
            <Component onExit={exitGame} />
          </Suspense>
        </div>
      </Container>
    );
  }

  return (
    <Container className="py-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-2xl font-bold outline-none">
            <Gamepad2 className="h-6 w-6 text-accent" /> 놀이터
          </h1>
          <p className="mt-1 text-sm text-fg-2">웹툰 캐릭터로 즐기는 미니게임 — 카드 배틀, 가위바위보, 퀴즈 등.</p>
        </div>
        {/* 놀이터 공유 — Web Share API → 클립보드 폴백 */}
        <SharePageButton path="/play" text="툰스펙트럼 놀이터 — 웹툰 캐릭터 미니게임" label="놀이터 공유" />
      </header>

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PLAY_GAMES.map((g) => (
          <li key={g.id}>
            <button
              type="button"
              onClick={() => openGame(g.id)}
              className={cn(
                "group flex w-full items-start gap-3 rounded-2xl border border-line bg-card/50 p-4 text-left transition",
                "hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-lg hover:shadow-accent/10",
              )}
            >
              <span
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white shadow"
                style={{ background: `oklch(0.62 0.17 ${g.hue})` }}
              >
                <g.Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="font-semibold text-fg">{g.label}</span>
                  <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[0.6rem] font-medium text-accent">{g.category}</span>
                </span>
                <span className="mt-0.5 block text-[0.78rem] leading-snug text-fg-2">{g.tagline}</span>
                {g.usesCamera && <span className="mt-1 inline-block text-[0.62rem] text-fg-3">📷 웹캠 사용</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-6 text-[0.68rem] leading-relaxed text-fg-3">
        놀이터 게임은 공개 카탈로그의 메타데이터(제목·작가·장르·지표)를 사용합니다. 표지 썸네일은 사이트
        전반과 동일한 표지 정책(출처 표기·성인 제외·운영자 비표시 전환)에 따라 표시되며, 비표시 시 작품별
        색상으로 대체됩니다. 일부 지표는 추정값(≈)입니다.
      </p>
    </Container>
  );
}

export default PlayPage;
