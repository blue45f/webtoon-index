import {
  AlertTriangle,
  PackageSearch,
  RefreshCw,
  RotateCcw,
  Search,
  SearchX,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigationType, useSearchParams } from "react-router-dom";

import { MarketNavHeader } from "../components/MarketNavHeader";
import { MarketResourceCard } from "../components/MarketResourceCard";
import { StaleNoticeBar } from "../components/StaleNoticeBar";
import { useMarketResources } from "../hooks/use-market-resources";
import { marketBrowseJsonLd } from "../models/market-jsonld";
import { MARKET_KINDS, MARKET_LICENSES, marketKindMeta } from "../models/market-kind";
import {
  parseMarketBrowseQuery,
  resolveMarketBrowseSort,
} from "../models/market-query";

import { Container } from "@/shared/components/section";
import { buttonClass } from "@/shared/components/ui/button-utils";
import {
  CREATOR_MARKETPLACE_RESOURCE_QUERY_SEARCH_MAX_CHARACTERS,
  CreatorMarketplaceResourceSearchQuerySchema,
} from "@/shared/lib/creator-marketplace-resource-contract";
import { cn } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";
import {
  useDocumentTitle,
  useJsonLd,
  useMetaDescription,
  usePageSocialMeta,
} from "@/src/hooks/use-document-title";

const PAGE_SIZE = 12;
const MARKET_BROWSE_DESCRIPTION =
  "웹툰 제작에 필요한 브러시, 팔레트, 필터, 장면 템플릿, 3D 프리셋, 3D 에셋과 소품을 종류와 사용권으로 찾아보세요.";

function filterChipClass(active: boolean): string {
  return cn(
    "inline-flex min-h-6 items-center rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-150 pointer-coarse:min-h-11",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70",
    active
      ? "border-transparent text-fg shadow-sm"
      : "border-line bg-card text-fg-2 hover:border-line-strong hover:text-fg"
  );
}

export function MarketBrowsePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigationType = useNavigationType();
  const searchInputId = "market-browse-search";
  const parsedUrlQuery = parseMarketBrowseQuery(searchParams);
  const [draftSearch, setDraftSearch] = useState(() => parsedUrlQuery.searchDraft);
  const pendingSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const query = {
    limit: PAGE_SIZE,
    ...parsedUrlQuery.values,
    sort: resolveMarketBrowseSort(parsedUrlQuery.values),
  };
  const hasInvalidQuery = parsedUrlQuery.issues.length > 0;
  const page = useMarketResources(hasInvalidQuery ? null : query);
  const pageTitle = query.kind
    ? `${marketKindMeta(query.kind).label} 리소스 탐색`
    : "마켓 탐색";

  useDocumentTitle(pageTitle);
  useMetaDescription(MARKET_BROWSE_DESCRIPTION);
  usePageSocialMeta({
    canonicalPath: "/market/browse",
    title: `${pageTitle} · 툰스펙트럼`,
    description: MARKET_BROWSE_DESCRIPTION,
  });
  useJsonLd(marketBrowseJsonLd(page.items, query.kind));

  const patchParams = useCallback(
    (patch: Record<string, string | null>) => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          for (const [key, value] of Object.entries(patch)) {
            if (value === null || value.length === 0) next.delete(key);
            else next.set(key, value);
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const activeSearch = query.search;
  const activeKind = query.kind;
  const activeLicense = query.license;
  const activePublisherLabel = query.publisher
    ? page.items.find((record) => record.publisher.id === query.publisher)?.publisher.name
      ?? "선택한 배급자"
    : null;

  const committedSearch = parsedUrlQuery.searchDraft;
  const cancelPendingSearchCommit = useCallback(() => {
    if (pendingSearchTimerRef.current === null) return;
    clearTimeout(pendingSearchTimerRef.current);
    pendingSearchTimerRef.current = null;
  }, []);

  useEffect(() => {
    cancelPendingSearchCommit();
    setDraftSearch(committedSearch);
    return cancelPendingSearchCommit;
  }, [cancelPendingSearchCommit, committedSearch]);

  const serializedSearchParams = searchParams.toString();
  useEffect(() => {
    if (navigationType !== "POP") return;
    cancelPendingSearchCommit();
    setDraftSearch(committedSearch);
  }, [
    cancelPendingSearchCommit,
    committedSearch,
    navigationType,
    serializedSearchParams,
  ]);

  const updateDraftSearch = useCallback((value: string) => {
    setDraftSearch(value);
    cancelPendingSearchCommit();
    const parsed = CreatorMarketplaceResourceSearchQuerySchema.safeParse(value);
    if (!parsed.success) return;
    pendingSearchTimerRef.current = setTimeout(() => {
      pendingSearchTimerRef.current = null;
      patchParams({
        q: parsed.data || null,
        ...(parsed.data ? {} : { sort: null }),
      });
    }, 300);
  }, [cancelPendingSearchCommit, patchParams]);

  const clearSearch = useCallback(() => {
    cancelPendingSearchCommit();
    setDraftSearch("");
    patchParams({ q: null, ...(query.sort === "relevance" ? { sort: null } : {}) });
  }, [cancelPendingSearchCommit, patchParams, query.sort]);

  const resetFilters = useCallback(() => {
    cancelPendingSearchCommit();
    setDraftSearch("");
    patchParams({
      q: null,
      tag: null,
      publisher: null,
      kind: null,
      license: null,
      sort: null,
    });
  }, [cancelPendingSearchCommit, patchParams]);

  const hasActiveFilters = Boolean(
    query.search || query.tag || query.publisher || activeKind || activeLicense
  );

  return (
    <div>
      <section className="border-b border-line bg-ledger">
        <Container size="wide" className="py-7 sm:py-10">
          <MarketNavHeader />
          <p className="eyebrow text-accent mt-6">Browse</p>
          <h1 className="mt-2 text-pretty text-2xl font-bold leading-tight sm:text-3xl">
            마켓 탐색
          </h1>
          <p className="mt-1 max-w-xl text-xs text-fg-3">
            브러시, 팔레트, 필터, 템플릿, 3D 프리셋, 3D 에셋 등 웹툰 창작에 필요한 검증된 도구를 탐색하세요.
          </p>

          <form
            role="search"
            className="mt-5 flex max-w-xl items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              cancelPendingSearchCommit();
              const parsed = CreatorMarketplaceResourceSearchQuerySchema.safeParse(draftSearch);
              if (parsed.success) {
                patchParams({
                  q: parsed.data || null,
                  ...(parsed.data ? {} : { sort: null }),
                });
              }
            }}
          >
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-3" aria-hidden="true" />
              <input
                id={searchInputId}
                type="search"
                aria-label="마켓 리소스 검색"
                value={draftSearch}
                onChange={(event) => updateDraftSearch(event.target.value)}
                maxLength={CREATOR_MARKETPLACE_RESOURCE_QUERY_SEARCH_MAX_CHARACTERS}
                aria-invalid={
                  parsedUrlQuery.issues.some((issue) => issue.param === "q") || undefined
                }
                aria-describedby={
                  parsedUrlQuery.issues.some((issue) => issue.param === "q")
                    ? "market-invalid-query"
                    : undefined
                }
                placeholder="리소스·태그·배급자 검색 (예: 잉크, 수채화, 4컷, 배경)"
                className="h-10 w-full appearance-none rounded-[0.7rem] border border-line bg-card pl-9 pr-9 text-sm text-fg placeholder:text-fg-3 outline-none transition-colors duration-150 focus:border-accent pointer-coarse:h-11 pointer-coarse:pr-12 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
              />
              {draftSearch ? (
                <button
                  type="button"
                  aria-label="검색어 지우기"
                  onClick={clearSearch}
                  className="absolute right-1 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded text-fg-3 transition-colors duration-150 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 pointer-coarse:right-0 pointer-coarse:size-11"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </div>
            <button type="submit" className={buttonClass({ variant: "solid", size: "md" })}>
              검색
            </button>
          </form>
        </Container>
      </section>

      <Container size="wide" className="py-6">
        {/* Category Filters */}
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="리소스 종류 필터">
          <button
            type="button"
            onClick={() => patchParams({ kind: null })}
            aria-pressed={!activeKind}
            className={cn(filterChipClass(!activeKind), !activeKind && "border-accent bg-accent-soft text-accent font-semibold")}
          >
            전체
          </button>
          {MARKET_KINDS.map((kind) => {
            const isSelected = activeKind === kind.kind;
            const KindIcon = kind.icon;
            return (
              <button
                key={kind.kind}
                type="button"
                onClick={() => patchParams({ kind: isSelected ? null : kind.kind })}
                aria-pressed={isSelected}
                className={filterChipClass(isSelected)}
                style={
                  isSelected
                    ? {
                        backgroundColor: `oklch(0.72 0.11 ${kind.hue} / 0.20)`,
                        color: `oklch(0.85 0.12 ${kind.hue})`,
                        borderColor: `oklch(0.72 0.15 ${kind.hue} / 0.5)`,
                      }
                    : undefined
                }
              >
                <span className="inline-flex items-center gap-1">
                  <KindIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  {kind.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* License Filters */}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5" role="group" aria-label="라이선스 필터">
          <button
            type="button"
            onClick={() => patchParams({ license: null })}
            aria-pressed={!activeLicense}
            className={cn(filterChipClass(!activeLicense), !activeLicense && "border-accent bg-accent-soft text-accent font-semibold")}
          >
            전체 라이선스
          </button>
          {MARKET_LICENSES.map((license) => {
            const isSelected = activeLicense === license.license;
            return (
              <button
                key={license.license}
                type="button"
                onClick={() => patchParams({ license: isSelected ? null : license.license })}
                aria-pressed={isSelected}
                className={cn(
                  filterChipClass(isSelected),
                  isSelected && "border-accent bg-accent-soft text-accent font-semibold"
                )}
              >
                {license.label}
              </button>
            );
          })}
        </div>

        {/* Trending Genre / Thematic Tag Filters (Acon3D & Clip Studio Benchmark) */}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5" role="group" aria-label="장르 및 테마 태그 필터">
          <span className="text-[0.68rem] font-semibold text-fg-3 px-1">추천 태그:</span>
          {["로판", "학교", "3D", "인체", "무기", "3D배경", "G펜", "레이스", "파티클", "소품"].map((tag) => {
            const isSelected = query.tag === tag;
            return (
              <button
                key={tag}
                type="button"
                onClick={() => patchParams({ tag: isSelected ? null : tag })}
                aria-pressed={isSelected}
                className={cn(
                  "inline-flex min-h-6 items-center rounded-full border px-2.5 py-1 text-[0.7rem] font-medium transition-colors duration-150 pointer-coarse:min-h-11",
                  isSelected
                    ? "border-accent bg-accent text-on-accent font-bold shadow-sm"
                    : "border-line/70 bg-panel text-fg-2 hover:border-line-strong hover:text-fg"
                )}
              >
                #{tag}
              </button>
            );
          })}
        </div>

        {/* Status and Active Filter Chips */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-3">
          {!hasInvalidQuery && !page.loading && !page.error ? (
            <p className="text-xs text-fg-3" aria-live="polite">
              현재 <span className="numeral tnum font-semibold text-fg">{page.items.length}</span>개 표시
            </p>
          ) : (
            <span />
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <label className="inline-flex min-h-9 items-center gap-2 text-xs font-medium text-fg-2 pointer-coarse:min-h-11">
              <span>정렬</span>
              <select
                aria-label="정렬 기준"
                value={query.sort}
                onChange={(event) => patchParams({ sort: event.target.value })}
                className="h-9 rounded-lg border border-line bg-card px-2.5 text-xs text-fg outline-none transition-colors duration-150 focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/70 pointer-coarse:h-11"
              >
                <option value="relevance" disabled={!query.search}>
                  관련도순
                </option>
                <option value="newest">최신순</option>
              </select>
            </label>

            {hasActiveFilters ? (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {query.search ? (
                <button
                  type="button"
                  aria-label={`검색: “${query.search}” 필터 제거`}
                  onClick={clearSearch}
                  className="inline-flex min-h-6 items-center gap-1 rounded bg-raised px-2 py-0.5 text-fg-2 hover:text-fg pointer-coarse:min-h-11 pointer-coarse:px-3"
                >
                  검색: “{query.search}”
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              ) : null}
              {query.tag ? (
                <button
                  type="button"
                  aria-label={`#${query.tag} 태그 필터 제거`}
                  onClick={() => patchParams({ tag: null })}
                  className="inline-flex min-h-6 items-center gap-1 rounded bg-raised px-2 py-0.5 text-fg-2 hover:text-fg pointer-coarse:min-h-11 pointer-coarse:px-3"
                >
                  #{query.tag}
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              ) : null}
              {activeKind ? (
                <button
                  type="button"
                  aria-label={`${marketKindMeta(activeKind).label} 필터 제거`}
                  onClick={() => patchParams({ kind: null })}
                  className="inline-flex min-h-6 items-center gap-1 rounded bg-raised px-2 py-0.5 text-fg-2 hover:text-fg pointer-coarse:min-h-11 pointer-coarse:px-3"
                >
                  {marketKindMeta(activeKind).label}
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              ) : null}
              {activeLicense ? (
                <button
                  type="button"
                  aria-label={`${MARKET_LICENSES.find((meta) => meta.license === activeLicense)?.label ?? activeLicense} 필터 제거`}
                  onClick={() => patchParams({ license: null })}
                  className="inline-flex min-h-6 items-center gap-1 rounded bg-raised px-2 py-0.5 text-fg-2 hover:text-fg pointer-coarse:min-h-11 pointer-coarse:px-3"
                >
                  {MARKET_LICENSES.find((meta) => meta.license === activeLicense)?.label}
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              ) : null}
              {query.publisher ? (
                <button
                  type="button"
                  aria-label={`배급자: ${activePublisherLabel} 필터 제거`}
                  onClick={() => patchParams({ publisher: null })}
                  className="inline-flex min-h-6 min-w-0 max-w-full items-center gap-1 rounded bg-raised px-2 py-0.5 text-fg-2 hover:text-fg pointer-coarse:min-h-11 pointer-coarse:px-3"
                >
                  <span className="max-w-64 truncate">배급자: {activePublisherLabel}</span>
                  <X className="h-3 w-3 shrink-0" aria-hidden="true" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex min-h-6 items-center gap-1 rounded bg-bad/10 px-2 py-0.5 text-xs text-bad hover:bg-bad/20 pointer-coarse:min-h-11 pointer-coarse:px-3"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                조건 초기화
              </button>
              </div>
            ) : null}
          </div>
        </div>

        {hasInvalidQuery ? (
          <div
            id="market-invalid-query"
            role="alert"
            className="mt-4 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-fg-2"
          >
            <p className="font-medium text-fg">주소의 검색 조건을 적용할 수 없어요.</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs leading-relaxed">
              {parsedUrlQuery.issues.map((issue) => (
                <li key={`${issue.param}-${issue.code}`}>{issue.message}</li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => {
                cancelPendingSearchCommit();
                const patch = Object.fromEntries(
                  [...new Set(parsedUrlQuery.issues.map((issue) => issue.param))]
                    .map((param) => [param, null])
                );
                if ("q" in patch) setDraftSearch("");
                patchParams(patch);
              }}
              className={buttonClass({ variant: "outline", size: "sm", className: "mt-3" })}
            >
              잘못된 조건 제거
            </button>
          </div>
        ) : null}

        {!hasInvalidQuery && page.stale ? (
          <StaleNoticeBar
            savedAt={page.staleSavedAt ?? new Date().toISOString()}
            onRetry={page.reload}
            className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-fg-2 [&>button]:ml-auto"
          />
        ) : null}

        {!hasInvalidQuery && page.error && page.items.length === 0 ? (
          <div
            role="alert"
            className="mt-8 rounded-2xl border border-warn/30 bg-warn/5 p-8 text-center sm:p-12"
          >
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-warn/10 text-warn">
              <AlertTriangle className="size-6" aria-hidden="true" />
            </div>
            <h2 className="mt-4 text-base font-bold text-fg">
              리소스를 불러올 수 없어요
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-fg-2">
              일시적인 네트워크 문제이거나 서버에 일시적 장애가 발생했을 수 있어요. 잠시 후 다시 시도해 주세요.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={page.reload}
                className={buttonClass({ variant: "solid", size: "sm" })}
              >
                <RefreshCw className="mr-1.5 size-3.5" aria-hidden="true" />
                다시 시도
              </button>
              <Link
                href="/studio"
                className={buttonClass({ variant: "outline", size: "sm" })}
              >
                스튜디오로 이동
              </Link>
            </div>
          </div>
        ) : null}

        {hasInvalidQuery || (page.error && page.items.length === 0) ? null : (
          <>
            <h2 className="sr-only">탐색 결과</h2>
            {page.loading ? (
              <p role="status" className="sr-only">
                마켓 탐색 결과를 불러오는 중입니다.
              </p>
            ) : null}
            <ul
              aria-busy={page.loading || undefined}
              className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4"
            >
              {page.loading && page.items.length === 0
                ? Array.from({ length: PAGE_SIZE }, (_, index) => (
                    <li key={index} aria-hidden="true">
                      <div className="skeleton aspect-[16/9] w-full rounded-t-xl" />
                      <div className="space-y-2 rounded-b-xl border border-t-0 border-line bg-card p-3.5">
                        <div className="skeleton h-4 w-4/5" />
                        <div className="skeleton h-3 w-2/5" />
                      </div>
                    </li>
                  ))
                : page.items.map((record) => (
                    <li key={record.id}>
                      <MarketResourceCard record={record} className="h-full" />
                    </li>
                  ))}
            </ul>

            {!page.loading && page.items.length === 0 ? (
              <div className="mt-8 rounded-2xl border border-dashed border-line bg-panel p-8 text-center sm:p-12">
                {activeSearch ? (
                  <>
                    <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-raised text-fg-3">
                      <SearchX className="size-6" aria-hidden="true" />
                    </div>
                    <h2 className="mt-4 text-base font-bold text-fg">
                      &lsquo;{activeSearch}&rsquo; 검색 결과가 없어요
                    </h2>
                    <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-fg-2">
                      단어의 맞춤법을 확인하거나 더 일반적인 검색어로 찾아보세요.
                    </p>
                    <div className="mt-6 flex flex-wrap justify-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => {
                          setDraftSearch("");
                          patchParams({ q: null });
                        }}
                        className={buttonClass({ variant: "solid", size: "sm" })}
                      >
                        검색어 초기화
                      </button>
                      {hasActiveFilters ? (
                        <button
                          type="button"
                          onClick={resetFilters}
                          className={buttonClass({ variant: "outline", size: "sm" })}
                        >
                          <RotateCcw className="mr-1.5 size-3.5" aria-hidden="true" />
                          모든 필터 초기화
                        </button>
                      ) : null}
                    </div>
                  </>
                ) : activeKind ? (
                  <>
                    <div
                      className="mx-auto flex size-12 items-center justify-center rounded-full"
                      style={{
                        backgroundColor: `oklch(0.92 0.04 ${marketKindMeta(activeKind).hue})`,
                        color: `oklch(0.45 0.18 ${marketKindMeta(activeKind).hue})`,
                      }}
                    >
                      {(() => {
                        const Icon = marketKindMeta(activeKind).icon;
                        return <Icon className="size-6" aria-hidden="true" />;
                      })()}
                    </div>
                    <h2 className="mt-4 text-base font-bold text-fg">
                      아직 등록된 {marketKindMeta(activeKind).label} 리소스가 없어요
                    </h2>
                    <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-fg-2">
                      {activeKind === "3d-asset"
                        ? "3D 캐릭터 소체, 학교·판타지 소품, 무기 파츠를 스튜디오에서 첫 번째로 공유해 보세요!"
                        : activeKind === "3d-preset"
                          ? "절차형 3D 공간과 조명 프리셋을 스튜디오에서 첫 번째로 공유해 보세요!"
                          : "스튜디오에서 제작한 창작 도구를 마켓 커뮤니티에 가장 먼저 공유해 보세요!"}
                    </p>
                    <div className="mt-6 flex flex-wrap justify-center gap-2.5">
                      <Link
                        href="/studio?assetMarket=community&communityView=share"
                        className={buttonClass({ variant: "solid", size: "sm" })}
                      >
                        <Upload className="mr-1.5 size-3.5" aria-hidden="true" />
                        스튜디오에서 {marketKindMeta(activeKind).label} 공유하기
                      </Link>
                      <button
                        type="button"
                        onClick={() => patchParams({ kind: null })}
                        className={buttonClass({ variant: "outline", size: "sm" })}
                      >
                        전체 리소스 둘러보기
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-raised text-fg-3">
                      <PackageSearch className="size-6" aria-hidden="true" />
                    </div>
                    <h2 className="mt-4 text-base font-bold text-fg">
                      조건에 맞는 공유 리소스가 없어요
                    </h2>
                    <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-fg-2">
                      필터 조건을 변경하거나 스튜디오에서 창작한 도구를 첫 번째로 공유해 보세요.
                    </p>
                    <div className="mt-6 flex flex-wrap justify-center gap-2.5">
                      <Link
                        href="/studio?assetMarket=community&communityView=share"
                        className={buttonClass({ variant: "solid", size: "sm" })}
                      >
                        <Upload className="mr-1.5 size-3.5" aria-hidden="true" />
                        스튜디오에서 첫 리소스 공유하기
                      </Link>
                      {hasActiveFilters ? (
                        <button
                          type="button"
                          onClick={resetFilters}
                          className={buttonClass({ variant: "outline", size: "sm" })}
                        >
                          <RotateCcw className="mr-1.5 size-3.5" aria-hidden="true" />
                          필터 조건 초기화
                        </button>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
            ) : null}

            {!page.loading && page.loadMoreError && !page.error ? (
              <div
                className="mt-8 flex flex-wrap items-center justify-center gap-2 text-center text-xs text-bad"
                role="alert"
              >
                <span>{page.loadMoreError}</span>
                <button
                  type="button"
                  onClick={page.loadMore}
                  disabled={page.loadingMore}
                  className={buttonClass({ variant: "outline", size: "sm" })}
                >
                  {page.loadingMore ? "다시 불러오는 중…" : "다시 시도"}
                </button>
              </div>
            ) : !page.loading && page.hasMore && !page.error ? (
              <div className="mt-8 text-center">
                <button
                  type="button"
                  onClick={page.loadMore}
                  disabled={page.loadingMore}
                  className={buttonClass({ variant: "outline", size: "md" })}
                >
                  {page.loadingMore ? "불러오는 중…" : "더 많은 리소스 불러오기"}
                </button>
              </div>
            ) : null}
          </>
        )}
      </Container>
    </div>
  );
}
