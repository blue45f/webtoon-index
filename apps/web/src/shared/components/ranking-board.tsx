import {
  AlertCircle,
  BookOpen,
  Flag,
  Flame,
  ArrowUpRight,
  FunctionSquare,
  Gem,
  Grid2X2,
  Heart,
  LayoutGrid,
  LayoutList,
  RefreshCw,
  Rows3,
  SlidersHorizontal,
  Sprout,
  Star,
  TrendingUp,
  Waves,
} from "lucide-react";
import { useEffect, useRef, useState, type ComponentType } from "react";

import { PlatformTags } from "./availability";
import {
  RankRow,
  MiniPoster,
  RANK_ENTRY_STAGGER_CAP,
  RANK_ENTRY_ANIMATION_CLASS,
} from "./rank-row";
import { SignalWorkbench } from "./ranking-board-signal";
import { RankingSkeleton } from "./ranking-board-skeleton";
import { metricFor, entryStaggerStyle, formatUpdatedAt } from "./ranking-board-utils";
import { TitleCard } from "./title-card";
import { TitleFilterPanel } from "./title-filter-panel";
import { Segmented } from "./ui/segmented";
import { Select } from "./ui/select";
import { RatingInline } from "./ui/stars";

import type { View, LoadState, RankingMeta, RankingInsights, RankingResponse } from "./ranking-board-types";
import type { WorkType, PlatformId, Pricing, SerialStatus } from "@/shared/lib/types";

import { statsAreEstimated } from "@/shared/lib/estimate";
import { PLATFORM_LIST } from "@/shared/lib/platforms";
import {
  RANK_AXES,
  PERIODS,
  axisMeta,
  rankingItemListJsonLd,
  type RankedTitle,
  type RankAxis,
  type RankPeriod,
} from "@/shared/lib/ranking";
import { useSavedTitleIds } from "@/shared/lib/store";
import { GENRES } from "@/shared/lib/taxonomy";
import { applyTitleFilters, countActiveTitleFilters } from "@/shared/lib/title-filters";
import { useRememberedFilters } from "@/shared/lib/use-remembered-filters";
import { cn } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";
import { useJsonLd } from "@/src/hooks/use-document-title";


const axisIcons: Record<RankAxis, ComponentType<{ size?: number; className?: string }>> = {
  popular: Flame,
  trending: TrendingUp,
  favorites: Heart,
  rating: Star,
  hidden: Gem,
  binge: Waves,
  completed: Flag,
  rookie: Sprout,
};
const RANKING_DEFAULT_LIMIT = "200";
const PLATFORM_FILTER_ITEMS: { value: PlatformId | "all"; label: string }[] = [
  { value: "all", label: "전체 플랫폼" },
  ...PLATFORM_LIST.map((platform) => ({ value: platform.id, label: platform.short })),
];

export function RankingBoard({
  initialAxis = "popular",
  initialPlatform = "all",
}: {
  initialAxis?: RankAxis;
  initialPlatform?: PlatformId | "all";
}) {
  const [axis, setAxis] = useState<RankAxis>(initialAxis);
  const [period, setPeriod] = useState<RankPeriod>("weekly");
  const [type, setType] = useState<WorkType | "all">("all");
  const [genre, setGenre] = useState<string>("all");
  const [platform, setPlatform] = useState<PlatformId | "all">(initialPlatform);
  const [status, setStatus] = useState<SerialStatus | "all">("all");
  const [pricing, setPricing] = useState<Pricing | "all">("all");
  const [minRating, setMinRating] = useState(0);
  const [risingOnly, setRisingOnly] = useState(false);
  const {
    filters: clientFilters,
    setFilters: setClientFilters,
    remember: rememberFilters,
    toggleRemember: toggleRememberFilters,
  } = useRememberedFilters("ranking");
  const [showFilters, setShowFilters] = useState(false);
  const savedIds = useSavedTitleIds();
  const [view, setView] = useState<View>("list");
  const [ranked, setRanked] = useState<RankedTitle[]>([]);
  const [rankingMeta, setRankingMeta] = useState<RankingMeta | null>(null);
  const [insights, setInsights] = useState<RankingInsights | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const forceRefresh = useRef(false);
  const [pollIntervalMs, setPollIntervalMs] = useState(60_000);
  const [nextRefreshAt, setNextRefreshAt] = useState<number | null>(null);
  const [refreshCountdown, setRefreshCountdown] = useState<number | null>(null);

  const axisDetail = axisMeta(axis);
  const metric = metricFor(axis);

  // /ranking 구조화 데이터 — 현재 축의 서버 순위 상위권을 ItemList로 노출(이 보드는 랭킹 페이지 전용 마운트).
  // 구글이 JS 렌더링으로 수집해 '웹툰 랭킹' 계열 질의의 사이트 구조 이해·사이트링크 노출에 쓰인다.
  useJsonLd(rankingItemListJsonLd(ranked, axisDetail.label));

  const query = (() => {
    const params = new URLSearchParams({
      axis,
      period,
      type,
      genre,
      platform,
      status,
      pricing,
      minRating: String(minRating),
      rising: String(risingOnly),
      limit: RANKING_DEFAULT_LIMIT,
      refresh: "false",
    });
    return params.toString();
  })();

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();

    async function load(silent = false) {
      const shouldForce = forceRefresh.current;
      setState((prev) => (silent && prev === "ready" ? "refreshing" : "loading"));
      setError(null);
      const url = new URLSearchParams(query);
      if (shouldForce) {
        url.set("refresh", "true");
      } else {
        url.delete("refresh");
      }

      try {
        const res = await fetch(`/api/ranking?${url.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("랭킹 API 응답을 받지 못했습니다.");
        const data = (await res.json()) as RankingResponse;
        if (!alive) return;
        setRanked(data.items);
        setRankingMeta(data.meta);
        setInsights(data.insights);
        // 스냅샷 산식 운영 — 폴링 주기는 서버 refreshSeconds 기준(외부 실시간 TTL 없음).
        const pollMs = Math.max(30_000, Math.min(300_000, data.meta.refreshSeconds * 1000));
        setPollIntervalMs(pollMs);
        setNextRefreshAt(Date.now() + pollMs);
        setState("ready");
      } catch (err) {
        if (!alive || controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "랭킹을 불러오지 못했습니다.");
        setState("error");
      } finally {
        forceRefresh.current = false;
      }
    }

    load();
    const timer = globalThis.setInterval(() => load(true), pollIntervalMs);
    return () => {
      alive = false;
      controller.abort();
      globalThis.clearInterval(timer);
    };
  }, [pollIntervalMs, query, refreshKey]);

  useEffect(() => {
    if (!nextRefreshAt) {
      setRefreshCountdown(null);
      return;
    }

    const tick = () => {
      setRefreshCountdown(Math.max(0, Math.floor((nextRefreshAt - Date.now()) / 1000)));
    };
    tick();
    const t = globalThis.setInterval(tick, 1000);
    return () => globalThis.clearInterval(t);
  }, [nextRefreshAt]);

  const isLoading = state === "loading";
  const isRefreshing = state === "refreshing";
  const refreshLabel = refreshCountdown === null ? "자동 갱신 대기" : `${refreshCountdown}초`;

  // 서버가 매긴 순위/순서는 유지하고, 클라이언트 보조 필터(찜·장르·이용가)에 안 맞는 행만 숨긴다.
  const clientFilterCount = countActiveTitleFilters(clientFilters);
  const visibleIds = new Set(
    applyTitleFilters(
      ranked.map((r) => r.title),
      clientFilters,
      savedIds
    ).map((t) => t.id)
  );
  const visibleRanked = clientFilterCount > 0 ? ranked.filter((r) => visibleIds.has(r.title.id)) : ranked;

  return (
    <div className="flex flex-col gap-5">
      {/* 축 선택 */}
      <section className="rounded-2xl border border-line bg-panel/60 p-4 surface-hl sm:p-5">
        <div className="mb-3 flex flex-col gap-1.5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="eyebrow mb-1.5 text-accent">RANKING AXES</p>
            <h2 className="text-lg font-semibold text-fg">랭킹 산식 축</h2>
            <p className="text-sm text-fg-3">축 하나가 바뀌면 전체 정렬 기준이 즉시 교체됩니다.</p>
          </div>
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1.5 text-xs text-fg-2">
            <span className="size-1.5 rounded-full bg-accent" />
            현재 {axisDetail.label}
          </span>
        </div>

        <div className="rail -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:grid sm:grid-cols-2 sm:px-0 lg:grid-cols-4">
          {RANK_AXES.map((a) => {
            const active = a.key === axis;
            const Icon = axisIcons[a.key];
            return (
              <button
                key={a.key}
                onClick={() => setAxis(a.key)}
                className={cn(
                  "group flex min-w-36 shrink-0 items-center gap-3 rounded-2xl border px-3.5 py-3 text-left text-sm font-medium transition-[background,border-color,color,transform,box-shadow] duration-150 ease-out-expo sm:min-w-0",
                  active
                    ? "border-accent/55 bg-accent-soft text-accent shadow-[0_10px_30px_-18px_oklch(0.72_0.185_42/0.75)]"
                    : "border-line bg-card text-fg-2 hover:-translate-y-0.5 hover:border-line-strong hover:text-fg"
                )}
              >
                <span
                  className={cn(
                    "grid size-9 shrink-0 place-items-center rounded-xl border transition-colors duration-150",
                    active ? "border-accent/45 bg-canvas/45" : "border-line bg-raised/60"
                  )}
                >
                  <Icon size={17} />
                </span>
                <span className="min-w-0 leading-tight">
                  <span>{a.label}</span>
                  <span className="mt-0.5 hidden truncate text-[0.72rem] font-normal text-fg-3 sm:block">
                    {a.desc}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <SignalWorkbench insights={insights} meta={rankingMeta} />

      {/* 산식 + 기간/유형 */}
      <section className="grid gap-3 rounded-2xl border border-line bg-panel/40 p-4 surface-hl lg:grid-cols-[1fr_auto] lg:items-center sm:p-5">
        <div className="flex min-w-0 items-start gap-2.5">
          <FunctionSquare size={16} className="mt-0.5 shrink-0 text-accent" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-fg">{axisDetail.desc}</p>
            <p className="mt-0.5 font-mono text-xs leading-relaxed text-fg-3">
              <span className="eyebrow mr-1.5 text-[0.6rem] text-accent">산식</span>
              {axisDetail.formula}
            </p>
            <Link
              href="/guide"
              className="mt-1 inline-flex items-center gap-1 text-[0.72rem] font-medium text-accent hover:underline"
            >
              산정 방식 자세히 보기
              <ArrowUpRight size={12} />
            </Link>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
          <Segmented
            size="sm"
            value={type}
            onChange={setType}
            items={[
              { value: "all", label: "전체" },
              { value: "webtoon", label: "웹툰" },
              { value: "webnovel", label: "웹소설" },
            ]}
          />
          <Segmented
            size="sm"
            value={period}
            onChange={setPeriod}
            items={PERIODS.map((p) => ({ value: p.key, label: p.label }))}
          />
        </div>
      </section>

      {/* 필터(장르·플랫폼) + 보기 방식 */}
      <section className="grid gap-3 rounded-2xl border border-line bg-panel/40 p-4 surface-hl lg:grid-cols-[1fr_auto] lg:items-start xl:p-5">
        <div className="grid min-w-0 gap-2 sm:flex sm:flex-wrap">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-8 items-center rounded-full border border-accent/35 bg-accent-soft px-3 text-[0.7rem] font-semibold text-accent">
              장르·운영 조건
            </span>
          </div>

          <Select
            value={genre}
            onValueChange={setGenre}
            ariaLabel="장르 필터"
            triggerClassName="h-10 min-w-36 rounded-lg border border-line bg-card px-2.5 text-sm text-fg-2"
            options={[
              { value: "all", label: "전체 장르" },
              ...GENRES.map((g) => ({ value: g, label: g })),
            ]}
          />
          <div className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-card px-3 text-xs text-fg-2 transition-colors focus-within:border-accent/50">
            <span className="whitespace-nowrap text-fg-3">플랫폼</span>
            {(() => {
              // 카탈로그에 실존하는 플랫폼만 노출(빈 플랫폼 옵션 방지). 커버리지 미수신 시 전체 노출.
              const present = rankingMeta?.availablePlatforms;
              const items =
                present && present.length
                  ? PLATFORM_FILTER_ITEMS.filter(
                      (item) =>
                        item.value === "all" ||
                        item.value === platform ||
                        present.includes(item.value as PlatformId)
                    )
                  : PLATFORM_FILTER_ITEMS;
              return (
                <Select
                  value={platform}
                  onValueChange={(value) => setPlatform(value as PlatformId | "all")}
                  ariaLabel="플랫폼 필터"
                  triggerClassName="min-w-28 text-sm font-medium text-fg"
                  options={items.map((item) => ({ value: item.value, label: item.label }))}
                />
              );
            })()}
          </div>
          <Segmented
            size="sm"
            value={status}
            onChange={(v) => setStatus(v as SerialStatus | "all")}
            items={[
              { value: "all", label: "전체 상태" },
              { value: "ongoing", label: "연재중" },
              { value: "completed", label: "완결" },
              { value: "hiatus", label: "휴재" },
            ]}
          />
          <Segmented
            size="sm"
            value={pricing}
            onChange={(v) => setPricing(v as Pricing | "all")}
            items={[
              { value: "all", label: "전체 가격" },
              { value: "free", label: "무료" },
              { value: "wait-free", label: "기다무" },
              { value: "paid", label: "유료" },
            ]}
          />
          <label className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-card px-3 text-xs text-fg-2">
            <Star size={14} className="text-accent" />
            <span className="whitespace-nowrap">평점 {minRating.toFixed(1)}+</span>
            <input
              type="range"
              min="0"
              max="5"
              step="0.1"
              value={minRating}
              onChange={(event) => setMinRating(Number(event.target.value))}
              className="h-1 w-24 accent-[oklch(0.72_0.185_42)]"
              aria-label="최소 평점"
            />
          </label>
          <button
            type="button"
            onClick={() => setRisingOnly((current) => !current)}
            className={cn(
              "inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-xs font-medium transition-colors",
              risingOnly
                ? "border-good/40 bg-[oklch(0.8_0.15_150/0.12)] text-good"
                : "border-line bg-card text-fg-2 hover:border-line-strong hover:text-fg"
            )}
          >
            <TrendingUp size={14} />
            상승작
          </button>
        </div>
        <div className="grid min-w-0 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end xl:justify-end">
          <div
            className={cn(
              "inline-flex h-10 min-w-0 items-center gap-2 rounded-full border border-line bg-card/90 px-3 text-xs text-fg-3",
              state === "error" && "border-bad/40 bg-[oklch(0.66_0.2_25/0.12)] text-bad"
            )}
          >
            {state === "error" ? (
              <AlertCircle size={14} className="shrink-0" />
            ) : (
              <Grid2X2 size={14} className="shrink-0 text-fg-2" />
            )}
            <span className="truncate">
              {state === "error"
                ? error
                : `스냅샷 산식 · 신뢰 ${rankingMeta?.reliability.confidence ?? 0}/100 · 업데이트 ${formatUpdatedAt(rankingMeta?.generatedAt)}`}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              forceRefresh.current = true;
              setRefreshKey((current) => current + 1);
            }}
            className="inline-flex size-10 items-center justify-center rounded-xl border border-line bg-card text-fg-2 transition-colors hover:border-line-strong hover:text-fg"
            title="랭킹 새로고침"
            aria-label="랭킹 새로고침"
          >
            <RefreshCw size={14} className={cn(isRefreshing && "animate-spin")} />
          </button>
          <span className="inline-flex h-10 items-center rounded-xl border border-line bg-card px-3 text-sm text-fg-3">
            <span className="mr-1 text-fg">다음 갱신:</span>
            <span className="numeral mr-1 text-fg">{refreshLabel}</span>
            <span>·</span>
            <span className="numeral mr-1 text-fg">{visibleRanked.length}</span>편
            {clientFilterCount > 0 && <span className="ml-1 text-fg-3">/ {ranked.length}</span>}
          </span>
          <button
            type="button"
            onClick={() => setShowFilters((current) => !current)}
            aria-expanded={showFilters}
            className={cn(
              "inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-xs font-medium transition-colors",
              showFilters || clientFilterCount > 0
                ? "border-accent/45 bg-accent-soft text-accent"
                : "border-line bg-card text-fg-2 hover:border-line-strong hover:text-fg"
            )}
          >
            <SlidersHorizontal size={14} />
            필터
            {clientFilterCount > 0 && (
              <span className="rounded-full bg-accent/20 px-1.5 text-[0.68rem] text-accent">
                {clientFilterCount}
              </span>
            )}
          </button>
          <Segmented
            size="sm"
            value={view}
            onChange={(v) => setView(v as View)}
            items={[
              { value: "list", label: <LayoutList size={15} />, hint: "리스트 보기" },
              { value: "poster", label: <LayoutGrid size={15} />, hint: "포스터 보기" },
              { value: "compact", label: <Rows3 size={15} />, hint: "컴팩트 보기" },
            ]}
          />
        </div>
      </section>

      {/* 보조 클라이언트 필터(내 찜·장르·이용가) — 서버 순위는 유지하고 비매칭 행만 숨김 */}
      {showFilters && (
        <TitleFilterPanel
          value={clientFilters}
          onChange={setClientFilters}
          facets={["saved", "genre", "age"]}
          savedCount={savedIds.size}
          remember={rememberFilters}
          onToggleRemember={toggleRememberFilters}
        />
      )}

      {/* 랭킹 — 3가지 표시 방식 */}
      {isLoading ? (
        <RankingSkeleton />
      ) : state === "error" ? (
        <div className="rounded-xl border border-bad/40 bg-[oklch(0.66_0.2_25/0.12)] px-5 py-12 text-center">
          <AlertCircle className="mx-auto mb-3 text-bad" size={24} />
          <p className="text-sm font-medium text-fg">랭킹을 불러오지 못했습니다.</p>
          <p className="mt-1 text-sm text-fg-3">{error}</p>
        </div>
      ) : visibleRanked.length === 0 ? (
        <div className="rounded-xl border border-line bg-panel/30 px-5 py-14 text-center">
          <BookOpen className="mx-auto mb-3 text-fg-3" size={24} />
          <p className="text-sm font-medium text-fg">해당 조건의 작품이 없습니다.</p>
          <p className="mt-1 text-sm text-fg-3">
            {clientFilterCount > 0 ? "찜·장르·이용가 필터를 넓혀보세요." : "장르나 플랫폼 필터를 넓혀보세요."}
          </p>
        </div>
      ) : view === "list" ? (
        <div className="rounded-xl border border-line bg-panel/30 p-2 sm:p-3">
          {visibleRanked.map((r, i) => (
            <RankRow key={r.title.id} ranked={r} axis={axis} metric={metric} entryIndex={i} />
          ))}
        </div>
      ) : view === "poster" ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {/* 진입 스태거 — TitleCard API 는 그대로 두고 얇은 래퍼에 지연만 입힌다(캡 밖은 즉시). */}
          {visibleRanked.map((r, i) => (
            <div
              key={r.title.id}
              className={cn(i < RANK_ENTRY_STAGGER_CAP && RANK_ENTRY_ANIMATION_CLASS)}
              style={entryStaggerStyle(i)}
            >
              <TitleCard title={r.title} rank={r.rank} />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {visibleRanked.map((r, i) => {
            const mm = metric(r.title);
            // 별점 축은 RatingInline이 ≈를 붙이므로 지표 컬럼 중복 표기를 피한다.
            const mmEstimated = statsAreEstimated(r.title) && axis !== "rating" && axis !== "hidden";
            return (
              <Link
                key={r.title.id}
                href={`/title/${r.title.slug}`}
                className={cn(
                  "group flex items-center gap-3 rounded-xl border border-line bg-card px-3 py-2 transition-colors hover:border-line-strong",
                  i < RANK_ENTRY_STAGGER_CAP && RANK_ENTRY_ANIMATION_CLASS
                )}
                style={entryStaggerStyle(i)}
              >
                <span
                  className={cn(
                    "numeral w-7 shrink-0 text-center text-lg",
                    r.rank <= 3 ? "text-accent" : "text-fg-3"
                  )}
                >
                  {r.rank}
                </span>
                <MiniPoster title={r.title} className="w-7 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg group-hover:text-accent">
                    {r.title.title}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-fg-3">{r.title.synopsis}</span>
                  <span className="flex items-center gap-1.5">
                    <RatingInline value={r.title.stats.ratingAvg} estimated={statsAreEstimated(r.title)} size="xs" />
                    <PlatformTags availability={r.title.availability} max={1} />
                  </span>
                </span>
                <span className="numeral shrink-0 text-xs text-fg-2">
                  {mmEstimated && <span className="text-fg-3" aria-hidden>≈</span>}
                  {mm.value}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
