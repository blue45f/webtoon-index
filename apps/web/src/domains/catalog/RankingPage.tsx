import { ChevronRight, ListFilter } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import type { PlatformId } from "@/shared/lib/types";
import type { MouseEvent } from "react";

import { RankingBoard } from "@/shared/components/ranking-board";
import { RankingMethod } from "@/shared/components/ranking-method";
import { Container } from "@/shared/components/section";
import { SharePageButton } from "@/shared/components/share-page-button";
import { spectrumGradient } from "@/shared/lib/genre-color";
import { PLATFORM_LIST } from "@/shared/lib/platforms";
import { RANK_AXES, type RankAxis } from "@/shared/lib/ranking";
import { GENRES } from "@/shared/lib/taxonomy";

export function RankingPage() {
  const [searchParams] = useSearchParams();
  const axis: RankAxis =
    RANK_AXES.find((entry) => entry.key === searchParams.get("axis"))?.key ?? "popular";
  const platformParam = searchParams.get("platform");
  const platformIds = new Set(PLATFORM_LIST.map((platform) => platform.id));
  const platform: PlatformId | "all" = platformIds.has(platformParam as PlatformId)
    ? (platformParam as PlatformId)
    : "all";

  const jumpToBoard = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    document.getElementById("ranking-board")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <Container size="wide" className="py-6 sm:py-10">
      <header className="relative mb-6 overflow-hidden rounded-2xl border border-line bg-panel/55 p-4 surface-hl sm:mb-8 sm:p-6">
        {/* 시그니처 스펙트럼 틱 — 상단을 따라 흐르는 살아있는 데이터 맥동(홈·탐색 히어로와 동일 언어) */}
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-1 bg-[length:200%_100%] motion-safe:[animation:spectrum-sheen_3.6s_linear_infinite]"
          style={{ backgroundImage: spectrumGradient([...GENRES], 90) }}
        />
        <p className="eyebrow text-accent">UNIFIED RANKING</p>
        <h1 className="mt-2 text-[clamp(1.6rem,7vw,1.875rem)] font-bold tracking-tight sm:text-4xl">통합 랭킹</h1>
        <p className="lede mt-2 max-w-2xl text-pretty text-sm leading-relaxed text-fg-2">
          검증된 카탈로그 스냅샷에 투명 산식을 적용해 지금 볼 작품을 고릅니다. 기간(일간·주간·월간·전체)은
          무작위 변주가 아니라 실 신호(순위 변동·트렌드·누적 조회/관심/평점)의 가중 블렌딩으로 달라집니다.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2 sm:mt-6">
          <a
            href="#ranking-board"
            onClick={jumpToBoard}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line bg-card px-3.5 py-1.5 text-xs text-fg-2 transition-colors hover:border-accent/55 hover:bg-accent-soft/40 hover:text-fg"
          >
            <ChevronRight size={14} className="text-accent" />
            랭킹 시작점으로 이동
          </a>
          <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1.5 text-xs text-fg-2">
            <ListFilter size={14} className="text-fg-3" />
            현재 축: <span className="font-medium text-fg">{axis}</span>
          </span>
          {/* 랭킹 공유 — OS 공유 시트 → 클립보드 폴백 */}
          <SharePageButton path="/ranking" text="툰스펙트럼 통합 랭킹" label="랭킹 공유" />
        </div>
      </header>

      <section id="ranking-board">
        <RankingBoard initialAxis={axis} initialPlatform={platform} />
      </section>

      <div className="mt-12">
        <RankingMethod />
      </div>
    </Container>
  );
}
