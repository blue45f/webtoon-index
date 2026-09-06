import { AreaChart } from "./insights-components/area-chart";
import { BarList } from "./insights-components/bar-list";
import { CompareSplit } from "./insights-components/compare-split";
import { Donut } from "./insights-components/donut";
import { Panel } from "./insights-components/panel";
import { TagCloud } from "./insights-components/tag-cloud";


import type { getInsightsData } from "@/shared/lib/server/insights";

import { CountUp } from "@/shared/components/count-up";
import { Container } from "@/shared/components/section";
import { Badge } from "@/shared/components/ui/chip";
import { DistributionBars, GenreSpectrum, MeterBar } from "@/shared/components/ui/spectrum-bar";
import { genreColor } from "@/shared/lib/genre-color";
import { TYPE_LABEL } from "@/shared/lib/taxonomy";
import { formatCount, formatFull } from "@/shared/lib/utils";
import { ErrorState } from "@/src/components/error-state";
import { useApiResource } from "@/src/infrastructure/use-api-resource";


type InsightsData = Awaited<ReturnType<typeof getInsightsData>>;

export function InsightsPage() {
  const { data, loading, error, reload } = useApiResource<InsightsData>(
    "/api/insights",
    "인사이트 데이터를 불러오지 못했습니다."
  );

  if (loading) {
    return (
      <Container size="wide" className="py-16">
        <div className="skeleton h-40 rounded-2xl" />
      </Container>
    );
  }

  if (error || !data) {
    return (
      <Container size="wide" className="py-10">
        <ErrorState title="인사이트 데이터를 불러오지 못했습니다." message={error} onRetry={reload} />
      </Container>
    );
  }

  const {
    total,
    genreRows,
    topGenre,
    bestRatedGenre,
    wt,
    wn,
    platformRows,
    topPlatform,
    platformTotal,
    yearPoints,
    peakYear,
    distTotal,
    distSum,
    weightedAvg,
    fourPlusPct,
    pricingTotal,
    pricingSegments,
    freeShare,
    webnovelsCount,
    adaptedNovelsCount,
    adaptPct,
    tags,
    trendingTop,
    completionTop,
  } = data;

  return (
    <div>
      <section className="relative overflow-hidden border-b border-line bg-ledger">
        <div
          className="pointer-events-none absolute -top-1/2 right-1/4 h-[44rem] w-[44rem] opacity-25 blur-3xl"
          style={{ background: "radial-gradient(circle, oklch(0.72 0.185 42 / 0.3), transparent 60%)" }}
          aria-hidden
        />
        <Container size="wide" className="relative py-12 lg:py-16">
          <p className="eyebrow text-accent">DATA · INSIGHTS</p>
          <h1 className="mt-3 text-pretty text-3xl font-bold leading-[1.1] sm:text-4xl lg:text-[3rem]">
            이야기의 지형을 읽다
          </h1>
          <p className="mt-4 max-w-xl text-pretty text-base leading-relaxed text-fg-2">
            수록작 전체를 가로질러 장르·플랫폼·평점·가격·어댑테이션을 집계했습니다. 어느 플랫폼도
            보여주지 않는, 독자를 위한 트렌드 대시보드.
          </p>
          <p className="mt-2 max-w-xl text-xs leading-relaxed text-fg-3">
            장르 분포·평점·플랫폼은 수집 실데이터, 트렌드 점수·완독률·몰입 지수는 추정값(≈)입니다.
          </p>
          {/* 시그니처 hero 스펙트럼 — reveal 채움 + 커서 스크럽으로 장르를 짚는다 */}
          <div className="mt-7 max-w-xl">
            <GenreSpectrum
              genres={genreRows.map((row) => row.genre)}
              height={10}
              interactive
              label={`수록작 장르 스펙트럼 (${genreRows.length}개 장르)`}
            />
            <p className="mt-2 text-[0.68rem] text-fg-3">
              바 위에 커서를 올리면 그 지점의 장르가 표시됩니다.
            </p>
          </div>
          <dl className="mt-7 flex flex-wrap items-center gap-x-8 gap-y-3">
            {[
              { value: total, label: "수록 작품" },
              { value: genreRows.length, label: "활성 장르" },
              { value: platformTotal, label: "연재 플랫폼" },
              { value: distSum, display: formatFull(distSum), label: "집계 평가 수" },
            ].map((item) => (
              <div key={item.label} className="flex items-baseline gap-2">
                <dd className="numeral text-2xl text-fg tabular-nums">
                  {"display" in item && item.display ? (
                    item.display
                  ) : (
                    <CountUp value={item.value} />
                  )}
                </dd>
                <dt className="text-xs text-fg-3">{item.label}</dt>
              </div>
            ))}
          </dl>
        </Container>
      </section>

      <Container size="wide" className="py-10 sm:py-14">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-6">
          <Panel
            className="lg:col-span-3 lg:row-span-2"
            eyebrow="GENRE LANDSCAPE"
            title="장르 분포 & 평균 평점"
            aside={<Badge tone="neutral">{genreRows.length}개 장르</Badge>}
            insight={
              <>
                <span className="text-fg-2">{topGenre.genre}</span>가 {topGenre.count}작으로 가장 두텁고,
                평점은 <span className="text-fg-2">{bestRatedGenre.genre}</span>(
                {bestRatedGenre.rating.toFixed(2)})가 가장 높습니다.
              </>
            }
          >
            <BarList
              max={topGenre.count}
              valueFormat={(value) => `${value}`}
              items={genreRows.map((row) => ({
                label: row.genre,
                value: row.count,
                color: genreColor(row.genre, 0.7),
                dot: true,
                meta: `★ ${row.rating.toFixed(2)}`,
              }))}
            />
          </Panel>

          <Panel
            className="lg:col-span-3"
            eyebrow="FORMAT FACE-OFF"
            title="웹툰 vs 웹소설"
            insight={
              <>
                평균 평점은 <span className="text-fg-2">{wn.rating >= wt.rating ? "웹소설" : "웹툰"}</span>
                이 근소하게 앞서고, 누적 조회는 웹소설이 압도합니다.
              </>
            }
          >
            <CompareSplit
              aName={TYPE_LABEL.webtoon}
              bName={TYPE_LABEL.webnovel}
              aColor="var(--color-cool)"
              bColor="var(--color-accent)"
              aCount={wt.count}
              bCount={wn.count}
              metrics={[
                { label: "평균 평점", a: wt.rating.toFixed(2), b: wn.rating.toFixed(2), aRaw: wt.rating, bRaw: wn.rating },
                { label: "평균 조회", a: formatCount(wt.views), b: formatCount(wn.views), aRaw: wt.views, bRaw: wn.views },
                { label: "몰입 지수", a: wt.binge.toFixed(0), b: wn.binge.toFixed(0), aRaw: wt.binge, bRaw: wn.binge },
              ]}
            />
          </Panel>

          <Panel
            className="lg:col-span-3"
            eyebrow="ADAPTATION INDEX"
            title="원작 → 웹툰 파이프라인"
            insight={
              <>
                웹소설 {webnovelsCount}작 중 {adaptedNovelsCount}작이 웹툰으로 재탄생했습니다. 원작 추적이
                곧 차기 화제작 예측입니다.
              </>
            }
          >
            <div className="flex items-end gap-3">
              <span className="numeral text-[3.4rem] leading-none text-accent">
                <CountUp value={Math.round(adaptPct)} />
              </span>
              <span className="numeral mb-1.5 text-xl text-fg-3">%</span>
              <span className="mb-2 text-sm text-fg-3">웹툰화 비율</span>
            </div>
            <MeterBar
              className="mt-4"
              value={adaptedNovelsCount}
              max={webnovelsCount}
              label="웹툰화된 웹소설"
              suffix={` / ${webnovelsCount}`}
            />
          </Panel>

          <Panel
            className="lg:col-span-2"
            eyebrow="PLATFORM MAP"
            title="플랫폼 지형도"
            insight={
              <>
                <span className="text-fg-2">{topPlatform.p.name}</span>이 {topPlatform.count}작으로 최다
                수록. 한 작품이 여러 플랫폼에 걸쳐 있습니다.
              </>
            }
          >
            <BarList
              max={topPlatform.count}
              items={platformRows.map((row) => ({
                label: row.p.short,
                value: row.count,
                color: row.p.color,
                dot: true,
              }))}
            />
          </Panel>

          <Panel
            className="lg:col-span-2"
            eyebrow="RELEASE TREND"
            title="연도별 신작 추이"
            insight={
              <>
                {peakYear.label}년 {peakYear.value}작으로 정점. 수록작 분포가 시장 팽창기의 흔적을
                보여줍니다.
              </>
            }
          >
            <AreaChart points={yearPoints} color="var(--color-accent)" />
          </Panel>

          <Panel
            className="lg:col-span-2"
            eyebrow="RATING SPREAD"
            title="전체 평점 분포"
            aside={
              <div className="text-right">
                <div className="numeral text-2xl text-accent tabular-nums">{weightedAvg.toFixed(2)}</div>
                <div className="text-[0.72rem] text-fg-3">가중 평균</div>
              </div>
            }
            insight={
              <>
                {formatFull(distSum)}건의 평가 중 4점 이상이 {fourPlusPct.toFixed(0)}%. 큐레이션된 인덱스답게
                분포가 상단에 쏠려 있습니다.
              </>
            }
          >
            <DistributionBars dist={distTotal} />
          </Panel>

          <Panel
            className="lg:col-span-3"
            eyebrow="PRICING MODEL"
            title="가격 모델 분포"
            insight={
              <>
                연재 채널 {pricingTotal}곳 중 무료·기다무 진입로가 {freeShare.toFixed(0)}%. 시작 비용을
                낮출 경로가 절반 이상 열려 있습니다.
              </>
            }
          >
            <Donut
              segments={pricingSegments}
              center={
                <>
                  <span className="numeral text-2xl text-fg tabular-nums">{pricingTotal}</span>
                  <span className="text-[0.72rem] text-fg-3">연재 채널</span>
                </>
              }
            />
          </Panel>

          <Panel className="lg:col-span-3" eyebrow="TAG CLOUD" title="독자 코드 TOP" insight="태그는 검색과 추천의 공통 언어로 사용됩니다.">
            <TagCloud tags={tags.slice(0, 28)} />
          </Panel>

          <Panel className="lg:col-span-3" eyebrow="TRENDING" title="급상승 신호 상위작" aside={<Badge tone="neutral">추정</Badge>} insight="랭킹의 급상승 축과 함께 읽으면 현재 시장의 온도를 빠르게 볼 수 있습니다.">
            <BarList
              max={trendingTop[0]?.stats.trendingScore ?? 1}
              items={trendingTop.map((title) => ({
                label: title.title,
                value: Math.round(title.stats.trendingScore),
                color: genreColor(title.genres[0], 0.7),
                dot: true,
                meta: title.genres[0],
              }))}
            />
          </Panel>

          <Panel className="lg:col-span-3" eyebrow="BINGE" title="완독률 상위작" aside={<Badge tone="neutral">추정</Badge>} insight="정주행 만족도가 높은 작품은 장기 추천에서 더 높은 가중치를 받습니다.">
            <BarList
              max={completionTop[0]?.stats.completionRate ?? 1}
              valueFormat={(value) => `${value}%`}
              items={completionTop.map((title) => ({
                label: title.title,
                value: Math.round(title.stats.completionRate),
                color: genreColor(title.genres[0], 0.7),
                dot: true,
                meta: title.genres[0],
              }))}
            />
          </Panel>
        </div>
      </Container>
    </div>
  );
}
