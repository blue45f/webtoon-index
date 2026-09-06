import { useFx } from "@toonspectrum/core/fx";
import { Compass, RefreshCw, RotateCcw, Shuffle, SlidersHorizontal, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";


import type { SortKey } from "@/shared/lib/search";
import type { AgeRating, PlatformId, Pricing, SerialStatus, Title, WorkType } from "@/shared/lib/types";

import { AdSlot } from "@/shared/components/ad-slot";
import { CountUp } from "@/shared/components/count-up";
import { RevealOnScroll } from "@/shared/components/reveal-on-scroll";
import { Container } from "@/shared/components/section";
import { ShimmerTitle } from "@/shared/components/shimmer-title";
import { TitleCard } from "@/shared/components/title-card";
import { TitleFilterPanel } from "@/shared/components/title-filter-panel";
import { genreBorder, genreColor, genreTextColor, genreTint, spectrumGradient } from "@/shared/lib/genre-color";
import { useSavedTitleIds } from "@/shared/lib/store";
import { GENRES, TYPE_LABEL } from "@/shared/lib/taxonomy";
import {
  applyClientOnlyFilters,
  countActiveTitleFilters,
  titleFiltersToParams,
  type TitleFilterState,
} from "@/shared/lib/title-filters";
import { cn } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";
import { ErrorState } from "@/src/components/error-state";
import { useApiResource } from "@/src/infrastructure/use-api-resource";

type ExploreParams = Record<string, string | undefined>;

const SORTS: { key: SortKey; label: string }[] = [
  { key: "popular", label: "인기순" },
  { key: "rating", label: "평점순" },
  { key: "trending", label: "급상승" },
  { key: "newest", label: "최신순" },
];

const TYPES: { value: WorkType | "all"; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "webtoon", label: TYPE_LABEL.webtoon },
  { value: "webnovel", label: TYPE_LABEL.webnovel },
];

const FACETS = [
  "saved",
  "type",
  "genre",
  "status",
  "platform",
  "age",
  "pricing",
  "minRating",
  "year",
  "tag",
  "adapted",
] as const;

function splitParam(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

// URL 검색파라미터 → 패널 상태. 단일 genre/tag(스펙트럼·태그 칩)와 복수 genres/tags를 병합한다.
// 서버 explore는 freeOnly만 받으므로(가격 정밀값은 클라 전용) URL에서 pricing 정밀 선택을 복원한다.
function filtersFromSearchParams(sp: URLSearchParams): TitleFilterState {
  const genres = new Set(splitParam(sp.get("genres")));
  const singleGenre = sp.get("genre");
  if (singleGenre && GENRES.includes(singleGenre as (typeof GENRES)[number])) genres.add(singleGenre);

  const tags = new Set(splitParam(sp.get("tags")));
  const singleTag = sp.get("tag");
  if (singleTag) tags.add(singleTag);

  const types = new Set<WorkType>(splitParam(sp.get("types")) as WorkType[]);
  const singleType = sp.get("type") as WorkType | null;
  if (singleType === "webtoon" || singleType === "webnovel") types.add(singleType);

  const yearMin = Number(sp.get("yearMin"));
  const yearMax = Number(sp.get("yearMax"));
  const yearRange: [number, number] | null =
    Number.isFinite(yearMin) && Number.isFinite(yearMax) && sp.get("yearMin") && sp.get("yearMax")
      ? [yearMin, yearMax]
      : null;

  const minRating = Number(sp.get("minRating"));

  return {
    types: [...types],
    genres: [...genres],
    status: splitParam(sp.get("status")) as SerialStatus[],
    platforms: splitParam(sp.get("platforms")) as PlatformId[],
    ages: splitParam(sp.get("ages")) as AgeRating[],
    pricing: splitParam(sp.get("pricing")) as Pricing[],
    minRating: Number.isFinite(minRating) ? minRating : 0,
    yearRange,
    tags: [...tags],
    savedOnly: sp.get("savedOnly") === "true",
    adaptedOnly: sp.get("adaptedOnly") === "true",
  };
}

// 패널 상태 → URL. 서버 파라미터(titleFiltersToParams)에 더해 클라 전용(pricing 정밀·savedOnly)도
// URL에 보존해 새로고침/공유 시 복원되게 한다. sort/show는 호출부에서 합친다.
function clientOnlyParams(filters: TitleFilterState): Record<string, string> {
  const extra: Record<string, string> = {};
  if (filters.pricing.length) extra.pricing = filters.pricing.join(",");
  if (filters.savedOnly) extra.savedOnly = "true";
  return extra;
}

interface PlatformCoverage {
  id: PlatformId;
  label: string;
  color: string;
  count: number;
  share: number;
}

interface ExploreResponse {
  filters: {
    genre?: string;
    tag?: string;
    type?: WorkType;
    sort: SortKey;
  };
  current: ExploreParams;
  results: Title[];
  shown: Title[];
  hasMore: boolean;
  showCount: number;
  pageSize: number;
  tags: { tag: string; count: number }[];
  genres: string[];
  catalog?: {
    platformCoverage?: PlatformCoverage[];
    filteredPlatformCoverage?: PlatformCoverage[];
  };
  generatedAt: string;
  source: string;
}

export function ExplorePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const savedIds = useSavedTitleIds();
  const [panelOpen, setPanelOpen] = useState(false);
  const fx = useFx();

  const sort = (SORTS.find((entry) => entry.key === searchParams.get("sort"))?.key ?? "popular") as SortKey;
  const sortExplicit = Boolean(searchParams.get("sort"));
  const showParam = searchParams.get("show") ?? undefined;

  const filters = filtersFromSearchParams(searchParams);
  const activeFilters = countActiveTitleFilters(filters);
  // 헤더 스펙트럼/그라데이션이 강조할 장르 — 선택한 첫 장르(없으면 미강조).
  const heroGenre = filters.genres[0];

  // 패널/칩이 바꾼 상태를 서버 파라미터 + 클라 전용 파라미터로 직렬화해 URL에 반영.
  // sort/show는 명시 override가 없으면 기존 값을 보존한다(show는 필터 변경 시 초기화).
  const writeState = (next: TitleFilterState, override?: { sort?: SortKey | null; show?: string | null }) => {
    const extra: Record<string, string> = { ...clientOnlyParams(next) };
    const nextSort = override && "sort" in override ? override.sort : sortExplicit ? sort : null;
    if (nextSort) extra.sort = nextSort;
    const nextShow = override && "show" in override ? override.show : null;
    if (nextShow) extra.show = nextShow;
    setSearchParams(new URLSearchParams(titleFiltersToParams(next, extra)));
  };

  const applyFilters = (next: TitleFilterState) => writeState(next);
  const changeSort = (key: SortKey) => writeState(filters, { sort: key, show: showParam ?? null });
  const showMore = () => writeState(filters, { sort: sortExplicit ? sort : null, show: String(showCount + pageSize) });

  // 빌드된 서버 쿼리(현재 URL 그대로 사용). useApiResource가 키스트로크당 네트워크를 보장.
  const query = searchParams.toString();
  const { data, loading, error, reload } = useApiResource<ExploreResponse>(
    query ? `/api/explore?${query}` : "/api/explore",
    "탐색 데이터를 불러오지 못했습니다."
  );
  const rawResults = data?.results ?? [];
  // 서버가 적용하지 못한 클라 전용 facet(가격 정밀·내 찜만)을 결과에 추가 적용.
  const results = applyClientOnlyFilters(rawResults, filters, savedIds);
  const showCount = data?.showCount ?? 40;
  const pageSize = data?.pageSize ?? 40;
  const shown = results.slice(0, showCount);
  const tags = data?.tags ?? [];
  // 데이터에 존재하는 플랫폼만 패널에 노출(빈 플랫폼 숨김).
  const platformOptions = data?.catalog?.platformCoverage?.map((entry) => entry.id);
  const hasFilter = sortExplicit || activeFilters > 0;
  const accent = heroGenre ? genreColor(heroGenre, 0.84) : undefined;

  // 무한 스크롤 — 하단 센티넬이 보이면 자동으로 다음 페이지 로드(더보기 버튼 누를 필요 없음).
  // useInView는 1회용이라 부적합 → 반복 트리거 IntersectionObserver를 직접 둔다. 버튼은 a11y/수동 폴백으로 유지.
  const hasMore = results.length > shown.length;
  const loaderRef = useRef<HTMLDivElement>(null);
  const showMoreRef = useRef(showMore);
  showMoreRef.current = showMore;
  useEffect(() => {
    const node = loaderRef.current;
    if (!node || !hasMore || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loading) showMoreRef.current();
      },
      { rootMargin: "800px 0px" }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [hasMore, loading]);

  return (
    <div>
      <section className="relative overflow-hidden border-b border-line bg-ledger">
        {/* 상단 장르-스펙트럼 스트립 — 데이터 시그니처(홈과 톤 정합). 좌→우 fill-in. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-1 overflow-hidden" aria-hidden>
          <div
            className="size-full origin-left motion-safe:[animation:spectrum-grow_0.9s_var(--ease-out-expo)_0.1s_both]"
            style={{ background: spectrumGradient([...GENRES], 90) }}
          />
        </div>
        {/* warm-ink 깊이 — persimmon 상단 글로(호흡). hue 42 축 유지(장르 선택 시 그 색으로 보강). */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-44 opacity-70"
          style={{
            background:
              "linear-gradient(to bottom, oklch(0.72 0.185 42 / 0.12), oklch(0.155 0.008 70 / 0))",
          }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -right-24 -top-16 size-[30rem] rounded-full opacity-60 blur-3xl motion-safe:[animation:hero-bloom_11s_ease-in-out_infinite]"
          style={{
            background: heroGenre
              ? `radial-gradient(closest-side, ${genreTint(heroGenre, 0.22)}, transparent 70%)`
              : "radial-gradient(closest-side, oklch(0.66 0.2 38 / 0.15), oklch(0.62 0.16 60 / 0.05) 58%, transparent 72%)",
          }}
          aria-hidden
        />
        {heroGenre && (
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background: `radial-gradient(120% 90% at 18% -10%, ${genreTint(
                heroGenre,
                0.2
              )}, transparent 60%)`,
            }}
            aria-hidden
          />
        )}
        <Container size="wide" className="relative py-7 sm:py-12 lg:py-16">
          <p
            className="eyebrow inline-flex items-center gap-2 text-accent"
            style={{ animation: "fade-up 0.5s var(--ease-out-expo) 0.05s both" }}
          >
            {/* 시그니처 스펙트럼 틱 — 살아있는 브랜드 맥동(데이터 맥락, 홈 히어로와 동일 언어). */}
            <span
              aria-hidden
              className="h-2.5 w-9 rounded-full bg-[length:200%_100%] motion-safe:[animation:spectrum-sheen_3.6s_linear_infinite]"
              style={{ backgroundImage: spectrumGradient([...GENRES], 90) }}
            />
            <Compass size={14} strokeWidth={2} />
            GENRE SPECTRUM / 탐색
          </p>

          <div className="mt-3 max-w-2xl sm:mt-4">
            <h1
              className="text-pretty text-[clamp(1.7rem,7vw,2.25rem)] font-bold leading-[1.1] sm:text-4xl"
              style={{ animation: "fade-up 0.6s var(--ease-out-expo) 0.14s both" }}
            >
              색을 따라 떠나는{" "}
              {heroGenre ? (
                <span className="relative font-serif font-normal italic" style={{ color: accent }}>
                  {heroGenre}
                  {/* 선택 장르 강조 밑줄 — 그 장르색으로 fill-in. */}
                  <span
                    aria-hidden
                    className="absolute -bottom-0.5 left-0 h-[0.12em] w-full origin-left rounded-full motion-safe:[animation:spectrum-grow_0.6s_var(--ease-out-expo)_0.5s_both]"
                    style={{ background: `linear-gradient(90deg, ${accent}, transparent)` }}
                  />
                </span>
              ) : (
                <ShimmerTitle
                  as="span"
                  className="relative font-serif font-normal italic"
                  particleCount={22}
                  particleSpread={1.2}
                >
                  스펙트럼 탐색
                </ShimmerTitle>
              )}
            </h1>
            <p
              className="lede mt-2.5 text-pretty text-sm leading-relaxed text-fg-2 sm:mt-3.5 sm:text-base"
              style={{ animation: "fade-up 0.6s var(--ease-out-expo) 0.24s both" }}
            >
              장르·태그·유형별로 웹툰과 웹소설을 좁혀봅니다. 작품 카드에는 줄거리와 연재 상태가 함께
              표시되어 무슨 작품인지 바로 판단할 수 있습니다.
            </p>
            <Link
              href={heroGenre ? `/random?genre=${encodeURIComponent(heroGenre)}` : "/random"}
              className="sheen-sweep group mt-4 inline-flex items-center gap-2 overflow-hidden rounded-xl border border-line bg-card px-4 py-2.5 text-sm font-medium text-fg-2 transition-[color,background-color,border-color,box-shadow] duration-200 hover:border-accent/50 hover:bg-accent-soft hover:text-accent hover:shadow-[0_8px_24px_-12px_oklch(0.72_0.185_42/0.5)] sm:mt-5"
              style={{ animation: "fade-up 0.6s var(--ease-out-expo) 0.32s both" }}
            >
              <Shuffle size={16} className="transition-transform duration-300 ease-out-expo group-hover:rotate-180" />
              {heroGenre ? `${heroGenre}에서 랜덤 발견` : "랜덤으로 한 편 발견"}
            </Link>
          </div>

          <RevealOnScroll className="mt-8" delayMs={60}>
            <div className="h-2 w-full rounded-full" style={{ background: spectrumGradient([...GENRES]) }} aria-hidden />
            <div className="mt-4 flex flex-wrap gap-2">
              {GENRES.map((entry) => {
                const active = filters.genres.includes(entry);
                return (
                  <button
                    key={entry}
                    type="button"
                    data-no-sfx
                    onClick={(event) => {
                      // 선택(off→on)되는 순간만 그 장르색으로 파티클 "팡" — 색을 고르는 보상감.
                      if (!active) {
                        fx.sfx("pop");
                        fx.burstAt(event.currentTarget, {
                          count: 12,
                          spread: 0.8,
                          colors: [genreColor(entry, 0.82), genreColor(entry, 0.66), "oklch(0.95 0.02 85)"],
                        });
                      }
                      applyFilters({ ...filters, genres: toggleValue(filters.genres, entry) });
                    }}
                    aria-pressed={active}
                    className={cn(
                      "inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-medium",
                      "transition-[transform,background-color,border-color,box-shadow] duration-200 ease-out-expo",
                      "hover:-translate-y-px active:scale-[0.96]",
                      active && "ring-1"
                    )}
                    style={{
                      color: genreTextColor(entry, active ? 0.92 : 0.82),
                      backgroundColor: genreTint(entry, active ? 0.3 : 0.12),
                      borderColor: genreBorder(entry, active ? 0.7 : 0.26),
                      // 선택된 칩엔 그 장르색 글로우로 "켜진" 느낌을 강화.
                      boxShadow: active ? `0 6px 20px -10px ${genreColor(entry, 0.62)}` : undefined,
                    }}
                  >
                    {entry}
                  </button>
                );
              })}
            </div>
          </RevealOnScroll>
        </Container>
      </section>

      <Container size="wide" className="flex flex-col gap-8 py-10">
        <RevealOnScroll variant="fade">
          <p className="eyebrow mb-3 text-fg-3">BY CODE / 코드로 좁히기</p>
          <div className="flex flex-wrap gap-2">
            {tags.map(({ tag: entry, count }) => {
              const active = filters.tags.includes(entry);
              return (
                <button
                  key={entry}
                  type="button"
                  data-no-sfx
                  onClick={(event) => {
                    if (!active) {
                      fx.sfx("pop");
                      fx.burstAt(event.currentTarget, { count: 10, spread: 0.7 });
                    }
                    applyFilters({ ...filters, tags: toggleValue(filters.tags, entry) });
                  }}
                  aria-pressed={active}
                  className={cn(
                    "group inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-[color,background-color,border-color,box-shadow,transform] duration-150 active:scale-[0.96]",
                    active
                      ? "border-accent/60 bg-accent-soft text-accent shadow-[0_4px_16px_-8px_oklch(0.72_0.185_42/0.5)]"
                      : "border-line bg-card text-fg-2 hover:border-line-strong hover:text-fg"
                  )}
                >
                  <span className={cn(active ? "text-accent" : "text-fg-3 group-hover:text-accent")}>#</span>
                  {entry}
                  <span className="tnum text-xs text-fg-3">{count}</span>
                </button>
              );
            })}
          </div>
        </RevealOnScroll>

        <div className="flex flex-col gap-4 border-y border-line py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <div className="inline-flex items-center rounded-lg border border-line bg-card p-0.5" role="group" aria-label="작품 유형">
              {TYPES.map((entry) => {
                const active =
                  entry.value === "all"
                    ? filters.types.length === 0
                    : filters.types.length === 1 && filters.types[0] === entry.value;
                return (
                  <button
                    key={entry.value}
                    type="button"
                    onClick={() =>
                      applyFilters({
                        ...filters,
                        types: entry.value === "all" ? [] : [entry.value],
                      })
                    }
                    aria-pressed={active}
                    className={cn(
                      "rounded-md px-3 py-1 text-sm font-medium transition-colors duration-150",
                      active ? "bg-accent text-on-accent" : "text-fg-2 hover:text-fg"
                    )}
                  >
                    {entry.label}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-1">
              {SORTS.map((entry) => {
                const active = entry.key === sort;
                return (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => changeSort(entry.key)}
                    aria-pressed={active}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-sm transition-colors duration-150",
                      active ? "font-semibold text-fg" : "font-medium text-fg-3 hover:text-fg-2"
                    )}
                  >
                    {entry.label}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setPanelOpen((open) => !open)}
              aria-expanded={panelOpen}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors duration-150",
                panelOpen || activeFilters > 0
                  ? "border-accent/60 bg-accent-soft/60 text-fg"
                  : "border-line bg-card text-fg-2 hover:border-line-strong hover:text-fg"
              )}
            >
              <SlidersHorizontal size={14} className="text-accent" />
              상세 필터
              {activeFilters > 0 && (
                <span className="rounded-full bg-accent/15 px-1.5 text-[0.68rem] text-accent">{activeFilters}</span>
              )}
            </button>
          </div>

          <div className="flex items-center gap-4">
            <p className="text-sm text-fg-2">
              작품{" "}
              <CountUp
                key={results.length}
                value={results.length}
                duration={0.7}
                separator={results.length >= 1000}
                className="numeral text-base text-fg"
              />
              편
            </p>
            <button
              type="button"
              onClick={reload}
              className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-fg-3 transition-colors duration-150 hover:text-accent"
            >
              <RefreshCw size={13} className={cn(loading && "animate-spin")} />
              갱신
            </button>
            {hasFilter && (
              <Link
                href="/explore"
                className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-fg-3 transition-colors duration-150 hover:text-accent"
              >
                <RotateCcw size={13} />
                필터 초기화
              </Link>
            )}
          </div>
        </div>

        {panelOpen && (
          <TitleFilterPanel
            value={filters}
            onChange={applyFilters}
            facets={[...FACETS]}
            platformOptions={platformOptions}
            savedCount={savedIds.size}
          />
        )}

        {/* 수익화 OFF면 렌더되지 않음(기본 invisible). 결과 그리드 위 광고 지면(탐색 전용 슬롯). */}
        <AdSlot slots={["discover-spotlight-1", "discover-spotlight-2", "discover-spotlight-3"]} />

        {loading ? (
          <div className="grid grid-cols-2 gap-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 10 }).map((_, index) => (
              <div key={index} className="space-y-3">
                <span className="skeleton block aspect-[3/4] rounded-xl" />
                <span className="skeleton block h-4 w-3/4" />
                <span className="skeleton block h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : error ? (
          <ErrorState title="탐색 데이터를 불러오지 못했습니다." message={error} onRetry={reload} />
        ) : results.length > 0 ? (
          <>
            <div className="grid grid-cols-2 gap-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {shown.map((title) => (
                <TitleCard key={title.id} title={title} />
              ))}
            </div>
            {hasMore && (
              <div ref={loaderRef} className="mt-10 flex justify-center">
                <button
                  type="button"
                  onClick={showMore}
                  className="inline-flex items-center gap-2 rounded-xl border border-line bg-card px-5 py-2.5 text-sm font-medium text-fg-2 transition-colors hover:border-line-strong hover:text-fg"
                >
                  {loading ? "불러오는 중…" : "더 보기"}
                  <span className="numeral text-fg-3">
                    {shown.length} / {results.length}
                  </span>
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="relative flex flex-col items-center overflow-hidden rounded-3xl border border-dashed border-line bg-gradient-to-b from-card/55 to-panel/30 p-12 text-center">
            {/* 은은한 액센트 글로우 — 배경에만 깔려 가독성 영향 없음(창작 게시판 빈-상태와 톤 정합). */}
            <div
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-2 h-32 w-32 -translate-x-1/2 rounded-full opacity-50 blur-3xl"
              style={{ background: "radial-gradient(circle, oklch(0.72 0.185 42 / 0.32), transparent 70%)" }}
            />
            <span
              aria-hidden
              className="pf-glow relative mb-4 grid size-14 place-items-center rounded-2xl border border-accent/30 bg-accent-soft/60 text-accent"
            >
              <Compass size={26} />
              <Sparkles size={12} className="pf-sparkle absolute -right-1 -top-1 text-warn" />
            </span>
            <p className="relative text-sm font-medium text-fg">조건에 맞는 작품이 없어요.</p>
            <p className="relative mt-1 text-xs text-fg-3">
              {hasFilter ? "필터를 조금 넓히거나 초기화해 보세요." : "다른 장르나 태그로 탐색해 보세요."}
            </p>
            {hasFilter && (
              <Link
                href="/explore"
                className="relative mt-4 inline-flex items-center gap-1.5 rounded-lg border border-line bg-card px-4 py-2 text-sm font-medium text-fg-2 transition-colors hover:border-accent/50 hover:bg-accent-soft hover:text-accent"
              >
                <RotateCcw size={14} />
                필터 초기화
              </Link>
            )}
          </div>
        )}
      </Container>
    </div>
  );
}

function toggleValue<T>(arr: T[], value: T): T[] {
  return arr.includes(value) ? arr.filter((entry) => entry !== value) : [...arr, value];
}
