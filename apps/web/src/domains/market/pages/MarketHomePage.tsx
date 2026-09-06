import {
  AlertTriangle,
  ArrowRight,
  Cuboid,
  PackageSearch,
  RefreshCw,
  Sparkles,
  Store,
  Upload,
  Plus,
} from "lucide-react";

import { MarketNavHeader } from "../components/MarketNavHeader";
import { MarketResourceCard } from "../components/MarketResourceCard";
import { StaleNoticeBar } from "../components/StaleNoticeBar";
import { useMarketResources } from "../hooks/use-market-resources";
import { marketHomeJsonLd } from "../models/market-jsonld";
import { MARKET_KINDS, MARKET_LICENSES } from "../models/market-kind";
import { MARKET_CURATED_THEMES } from "../models/market-theme";

import { Container } from "@/shared/components/section";
import { buttonClass } from "@/shared/components/ui/button-utils";
import Link from "@/src/compat/router-link";
import {
  useDocumentTitle,
  useJsonLd,
  useMetaDescription,
  usePageSocialMeta,
} from "@/src/hooks/use-document-title";

const MARKET_HOME_DESCRIPTION =
  "브러시, 팔레트, 필터, 장면 템플릿, 3D 프리셋, 3D 에셋과 소품을 살펴보고 ToonSpectrum Studio에서 바로 활용하세요.";

export function MarketHomePage() {
  const latest = useMarketResources({ limit: 12, sort: "newest" });
  const hasLatestItems = latest.items.length > 0;
  const hasFatalLatestError = Boolean(latest.error) && !hasLatestItems;

  useDocumentTitle("창작 마켓");
  useMetaDescription(MARKET_HOME_DESCRIPTION);
  usePageSocialMeta({
    canonicalPath: "/market",
    title: "창작 마켓 · 툰스펙트럼",
    description: MARKET_HOME_DESCRIPTION,
  });
  useJsonLd(marketHomeJsonLd(latest.items));

  const tagCounts = new Map<string, number>();
  for (const record of latest.items) {
    for (const tag of record.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const popularTags = [...tagCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([tag]) => tag);

  const materials3D = latest.items.filter(
    (item) => item.kind === "3d-asset" || item.kind === "3d-preset",
  );

  return (
    <div>
      <section className="border-b border-line bg-ledger">
        <Container size="wide" className="py-7 sm:py-10">
          <MarketNavHeader />
          <p className="eyebrow text-accent mt-6">Creator Market</p>
          <h1 className="mt-2 text-pretty text-3xl font-bold leading-[1.1] sm:mt-2.5 sm:text-4xl lg:text-[2.8rem]">
            창작 마켓
          </h1>
          <p className="mt-2.5 max-w-xl text-pretty font-serif text-base italic leading-relaxed text-fg-2 sm:mt-3 sm:text-lg">
            스튜디오에서 태어난 창작 리소스가 다음 작가의 도구가 되는 곳.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2.5 border-t border-line pt-4 sm:mt-7 sm:pt-5">
            <Link href="/market/browse" className={buttonClass({ variant: "solid", size: "md" })}>
              <Store className="h-4 w-4" aria-hidden="true" />
              리소스 둘러보기
            </Link>
            <Link
              href="/market/publish"
              className={buttonClass({
                variant: "outline",
                size: "md",
                className: "border-accent text-accent hover:bg-accent/10",
              })}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              에셋 등록하기
            </Link>
            <Link
              href="/studio?assetMarket=community&communityView=share"
              className={buttonClass({ variant: "outline", size: "md" })}
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              스튜디오에서 공유하기
            </Link>
            <span className="rounded-full bg-good/15 px-2.5 py-1 text-xs font-medium text-good">
              전 리소스 무료 공유
            </span>
          </div>
        </Container>
      </section>

      {/* ── Curated Thematic Exhibitions (Acon3D & Clip Studio Benchmark) ── */}
      <section className="border-b border-line bg-card/40 py-8 sm:py-10">
        <Container size="wide">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <p className="eyebrow text-accent">Theme Exhibition</p>
              <h2 className="mt-1 text-lg font-bold text-fg sm:text-xl">장르별 웹툰 기획전</h2>
            </div>
            <Link
              href="/market/browse"
              className="inline-flex min-h-6 items-center text-xs font-semibold text-accent hover:text-accent-2 pointer-coarse:min-h-11"
            >
              모든 기획전 보기 →
            </Link>
          </div>
          <div className="mt-4 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            {MARKET_CURATED_THEMES.map((theme) => {
              const ThemeIcon = theme.icon;
              return (
                <Link
                  key={theme.id}
                  href={`/market/browse?tag=${encodeURIComponent(theme.tag)}`}
                  className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-line bg-card p-4 transition-all duration-200 hover:-translate-y-1 hover:border-line-strong hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                >
                  <div className={`absolute -right-8 -top-8 size-28 rounded-full bg-gradient-to-br ${theme.gradient} blur-2xl opacity-60 group-hover:opacity-100 transition-opacity`} />
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-raised px-2 py-0.5 text-[0.65rem] font-bold text-accent">
                        <Sparkles className="size-2.5" aria-hidden="true" />
                        {theme.badge}
                      </span>
                      <ThemeIcon className="size-4 text-fg-3 group-hover:text-accent transition-colors" aria-hidden="true" />
                    </div>
                    <h3 className="mt-2.5 text-sm font-bold text-fg group-hover:text-accent transition-colors">
                      {theme.title}
                    </h3>
                    <p className="mt-1 text-xs text-fg-3 line-clamp-2 leading-relaxed">
                      {theme.subtitle}
                    </p>
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-line/60 pt-2.5 text-[0.7rem] font-medium text-fg-2">
                    <span className="text-accent font-semibold">#{theme.tag} 모음</span>
                    <span className="flex items-center gap-1 text-fg-3 group-hover:translate-x-0.5 transition-transform">
                      보러가기 <ArrowRight className="size-3" aria-hidden="true" />
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </Container>
      </section>

      <Container size="wide" className="py-8 sm:py-10 lg:py-12">
        <h2 className="eyebrow text-fg-3">리소스 종류</h2>
        <ul className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-7">
          {MARKET_KINDS.map((kind) => {
            const KindIcon = kind.icon;
            return (
              <li key={kind.kind}>
                <Link
                  href={`/market/browse?kind=${kind.kind}`}
                  className="group flex h-full flex-col gap-2 rounded-xl border border-line bg-card p-3.5 transition-[border-color,transform] duration-200 ease-out-expo hover:-translate-y-0.5 hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                >
                  <KindIcon
                    strokeWidth={1.5}
                    className="h-6 w-6 transition-colors duration-200"
                    style={{ color: `oklch(0.78 0.11 ${kind.hue})` }}
                    aria-hidden="true"
                  />
                  <span className="text-sm font-semibold text-fg">{kind.label}</span>
                  <span className="line-clamp-2 text-xs leading-snug text-fg-3">{kind.description}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Container>

      {/* ── 3D Special Spotlight (Clip Studio & Acon3D 3D Benchmark) ── */}
      {materials3D.length > 0 ? (
        <Container size="wide" className="pb-10 sm:pb-12">
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex items-center gap-2">
              <Cuboid className="size-4 text-accent" aria-hidden="true" />
              <h2 className="text-base font-bold text-fg sm:text-lg">3D 데생 소체 & 배경 특별관</h2>
            </div>
            <Link
              href="/market/browse?kind=3d-asset"
              className="inline-flex min-h-6 items-center text-xs font-semibold text-accent hover:text-accent-2 pointer-coarse:min-h-11"
            >
              3D 소재 전체 보기 →
            </Link>
          </div>
          <ul className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {materials3D.slice(0, 4).map((record) => (
              <li key={record.id}>
                <MarketResourceCard record={record} className="h-full" />
              </li>
            ))}
          </ul>
        </Container>
      ) : null}

      {popularTags.length >= 3 ? (
        <Container size="wide" className="pb-10 sm:pb-12">
          <h2 className="eyebrow text-fg-3">최신 리소스 태그</h2>
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {popularTags.map((tag) => (
              <li key={tag}>
                <Link
                  href={`/market/browse?tag=${encodeURIComponent(tag)}`}
                  className="inline-flex min-h-11 items-center rounded bg-raised px-3 py-2 text-xs text-fg-2 transition-colors duration-150 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                >
                  #{tag}
                </Link>
              </li>
            ))}
          </ul>
        </Container>
      ) : null}

      <Container size="wide" className="pb-10 sm:pb-12">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="eyebrow text-fg-3">최근 공유</h2>
          <Link
            href="/market/browse"
            className="inline-flex min-h-6 items-center text-sm text-accent hover:text-accent-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 pointer-coarse:min-h-11"
          >
            전체 보기 →
          </Link>
        </div>
        {hasFatalLatestError ? (
          <div
            role="alert"
            className="mt-6 rounded-2xl border border-warn/30 bg-warn/5 p-8 text-center sm:p-10"
          >
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-warn/10 text-warn">
              <AlertTriangle className="size-6" aria-hidden="true" />
            </div>
            <h3 className="mt-3 text-base font-bold text-fg">
              최근 공유 리소스를 불러올 수 없어요
            </h3>
            <p className="mx-auto mt-1.5 max-w-sm text-sm text-fg-2">
              일시적인 네트워크 문제이거나 서버 장애일 수 있어요.
            </p>
            <button
              type="button"
              onClick={latest.reload}
              className={buttonClass({ variant: "outline", size: "sm", className: "mt-4" })}
            >
              <RefreshCw className="mr-1.5 size-3.5" aria-hidden="true" />
              다시 시도
            </button>
          </div>
        ) : null}
        {latest.stale ? (
          <StaleNoticeBar
            savedAt={latest.staleSavedAt ?? new Date().toISOString()}
            onRetry={latest.reload}
            className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-fg-2 [&>button]:ml-auto"
          />
        ) : null}
        {hasFatalLatestError ? null : (
          <>
            {latest.loading ? (
              <p role="status" className="sr-only">
                최근 공유된 마켓 리소스를 불러오는 중입니다.
              </p>
            ) : null}
            <ul
              aria-busy={latest.loading || undefined}
              className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4"
            >
              {latest.loading && latest.items.length === 0
                ? Array.from({ length: 8 }, (_, index) => (
                    <li key={index} aria-hidden="true">
                      <div className="skeleton aspect-[16/9] w-full rounded-t-xl" />
                      <div className="space-y-2 rounded-b-xl border border-t-0 border-line bg-card p-3.5">
                        <div className="skeleton h-4 w-4/5" />
                        <div className="skeleton h-3 w-2/5" />
                      </div>
                    </li>
                  ))
                : latest.items.map((record) => (
                    <li key={record.id}>
                      <MarketResourceCard record={record} className="h-full" />
                    </li>
                  ))}
            </ul>
            {!latest.loading && latest.items.length === 0 ? (
              <div className="mt-6 rounded-2xl border border-dashed border-line bg-panel p-8 text-center sm:p-10">
                <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-raised text-fg-3">
                  <PackageSearch className="size-6" aria-hidden="true" />
                </div>
                <h3 className="mt-3 text-base font-bold text-fg">
                  아직 공유된 리소스가 없어요
                </h3>
                <p className="mx-auto mt-1.5 max-w-md text-sm text-fg-2">
                  스튜디오에서 창작한 3D 에셋, 브러시, 팔레트를 마켓 커뮤니티에 가장 먼저 공유해 보세요!
                </p>
                <div className="mt-5 flex justify-center">
                  <Link
                    href="/studio?assetMarket=community&communityView=share"
                    className={buttonClass({ variant: "solid", size: "sm" })}
                  >
                    <Upload className="mr-1.5 size-3.5" aria-hidden="true" />
                    스튜디오에서 첫 리소스 공유하기
                  </Link>
                </div>
              </div>
            ) : null}
          </>
        )}
      </Container>

      <Container size="wide" className="pb-14">
        <h2 className="eyebrow text-fg-3">사용권 안내</h2>
        <ul className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {MARKET_LICENSES.map((license) => (
            <li key={license.license} className="rounded-xl border border-line bg-card p-4">
              <h3 className="text-sm font-semibold text-fg">{license.label}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-fg-2">{license.summary}</p>
              <a
                href={license.url ?? "/terms"}
                target={license.url ? "_blank" : undefined}
                rel={license.url ? "noreferrer" : undefined}
                className="mt-2 inline-flex min-h-11 items-center text-xs text-cool underline decoration-current underline-offset-2 hover:decoration-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
              >
                사용권 전문 보기{license.url ? " ↗" : ""}
              </a>
            </li>
          ))}
        </ul>
      </Container>
    </div>
  );
}
