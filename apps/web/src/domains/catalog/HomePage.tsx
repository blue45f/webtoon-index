import { ArrowRight, Search } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";

import type { Title } from "@/shared/lib/types";

import { Container } from "@/shared/components/container";
import { CountUp } from "@/shared/components/count-up";
import { HeroBannerStatic } from "@/shared/components/hero-banner-static";
import { OpenSearchButton } from "@/shared/components/open-search-button";
import { ShimmerTitle } from "@/shared/components/shimmer-title";
import { spectrumGradient } from "@/shared/lib/genre-color";
import { useT } from "@/shared/lib/i18n";
import Link from "@/src/compat/router-link";
import { useApiResource } from "@/src/infrastructure/use-api-resource";

const HeroBanner = lazy(() => import("@/shared/components/hero-banner").then((module) => ({ default: module.HeroBanner })));
const HomeDeferredSections = lazy(() =>
  import("./HomeDeferredSections").then((module) => ({ default: module.HomeDeferredSections }))
);

const HERO_BUTTON_BASE =
  "inline-flex items-center justify-center whitespace-nowrap rounded-[0.7rem] font-medium transition-[background,color,border-color,transform,box-shadow,filter] duration-150 ease-out-expo select-none relative isolate overflow-hidden disabled:opacity-45 disabled:pointer-events-none active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/80 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";
const HERO_PRIMARY_BUTTON_CLASS = `${HERO_BUTTON_BASE} h-12 gap-2.5 bg-accent px-6 text-base text-on-accent shadow-[0_1px_0_0_oklch(1_0_0/0.12)_inset] before:absolute before:inset-0 before:bg-[radial-gradient(circle_at_50%_120%,oklch(1_0_0/0.2),transparent_62%)] before:opacity-0 before:transition-opacity before:duration-150 hover:bg-accent-2 hover:before:opacity-100 hover:shadow-[0_1px_0_0_oklch(1_0_0/0.12)_inset,0_8px_24px_-8px_oklch(0.72_0.185_42/0.55)]`;
const HERO_OUTLINE_BUTTON_CLASS = `${HERO_BUTTON_BASE} group h-12 gap-2 border border-line-strong/90 px-6 text-base text-fg hover:border-accent/70 hover:bg-accent-soft/80 hover:text-accent active:bg-accent active:text-on-accent`;
const RETRY_BUTTON_CLASS = `${HERO_BUTTON_BASE} mt-4 h-8 gap-1.5 border border-line-strong/90 px-3 text-[0.8125rem] text-fg hover:border-accent/70 hover:bg-accent-soft/80 hover:text-accent active:bg-accent active:text-on-accent`;

function useDeferredSections(enabled: boolean) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setReady(false);
      return;
    }
    if (ready) return;

    const activate = () => setReady(true);
    const options = { passive: true } as const;

    const timeoutId = window.setTimeout(activate, 5500);
    const fallbackTimeoutId = window.setTimeout(activate, 6500);
    window.addEventListener("scroll", activate, options);
    window.addEventListener("wheel", activate, options);
    window.addEventListener("touchmove", activate, options);
    window.addEventListener("keydown", activate);

    return () => {
      window.clearTimeout(timeoutId);
      window.clearTimeout(fallbackTimeoutId);
      window.removeEventListener("scroll", activate);
      window.removeEventListener("wheel", activate);
      window.removeEventListener("touchmove", activate);
      window.removeEventListener("keydown", activate);
    };
  }, [enabled, ready]);

  return enabled && ready;
}

function useDeferredHeroBanner(enabled: boolean) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setReady(false);
      return;
    }
    if (ready) return;

    const activate = () => setReady(true);
    const options = { passive: true } as const;
    const timeoutId = window.setTimeout(activate, 4200);

    window.addEventListener("pointerdown", activate, options);
    window.addEventListener("keydown", activate);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener("pointerdown", activate);
      window.removeEventListener("keydown", activate);
    };
  }, [enabled, ready]);

  return [enabled && ready, () => setReady(true)] as const;
}

interface HomeResponse {
  featured: Title[];
  spotlight: Title | null;
  topRated: Title[];
  waitFree: Title[];
  newest: Title[];
  families: { original: Title; adaptations: Title[] }[];
  tags: { tag: string; count: number }[];
  todayDay: string;
  todayReleases: Title[];
  stats: {
    titles: number;
    platforms: number;
    genres: number;
    reviews: number;
  };
  generatedAt: string;
}

export function HomePage() {
  const t = useT();
  const { data, loading, error, reload } = useApiResource<HomeResponse>("/api/home", t("home.loadError"));
  const homeReady = Boolean(data && !loading && !error);
  const deferredSectionsReady = useDeferredSections(homeReady);
  const [interactiveHeroReady, activateInteractiveHero] = useDeferredHeroBanner(homeReady);

  if (loading) {
    return (
      <div>
        <section className="border-b border-line bg-ledger">
          <Container size="wide" className="flex flex-col gap-12 pt-12 pb-14 lg:gap-14 lg:pb-16">
            <span className="skeleton block h-44 rounded-2xl sm:h-52" />
            <div className="space-y-5">
              <span className="skeleton block h-4 w-56" />
              <span className="skeleton block h-16 w-4/5" />
              <span className="skeleton block h-5 w-96 max-w-full" />
              <span className="skeleton block h-11 w-64" />
            </div>
          </Container>
        </section>
        <Container size="wide" className="grid grid-cols-2 gap-4 py-16 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <span key={index} className="skeleton block aspect-[3/4] rounded-xl" />
          ))}
        </Container>
      </div>
    );
  }

  if (error || !data) {
    return (
      <Container size="wide" className="py-10">
        <div
          className="rounded-2xl border border-bad/40 bg-[oklch(0.66_0.2_25/0.12)] p-12 text-center"
          role="alert"
        >
          <p className="text-sm font-medium text-fg">{t("home.loadError")}</p>
          {error && error !== t("home.loadError") && (
            <p className="mt-1 text-sm text-fg-2">{error}</p>
          )}
          <button type="button" onClick={reload} className={RETRY_BUTTON_CLASS}>
            {t("common.retry.short")}
          </button>
        </div>
      </Container>
    );
  }

  const featured = data.featured ?? [];
  const spotlight = data.spotlight ?? null;
  const topRated = data.topRated ?? [];
  const waitFree = data.waitFree ?? [];
  const newest = data.newest ?? [];
  const families = data.families ?? [];
  const tags = data.tags ?? [];
  const todayDay = data.todayDay ?? "";
  const todayReleases = data.todayReleases ?? [];
  const stats = data.stats ?? { titles: 0, platforms: 0, genres: 0, reviews: 0 };

  // 추천 배너 캐러셀 항목 — 스포트라이트를 선두로 추천작을 회전 노출.
  const bannerItems = spotlight
    ? [spotlight, ...featured.filter((f) => f.id !== spotlight.id)]
    : featured;

  // 히어로 통계 — 의미 없는 0 값(예: 정적 카탈로그의 리뷰 0)은 "0+ 리뷰"가 고장처럼 보이므로 숨긴다.
  const heroStats = [
    { v: stats.titles, suffix: "", label: t("home.hero.stats.titles") },
    { v: stats.platforms, suffix: "", label: t("home.hero.stats.platforms") },
    { v: stats.genres, suffix: "", label: t("home.hero.stats.genres") },
    { v: stats.reviews, suffix: "+", label: t("home.hero.stats.reviews") },
  ].filter((item) => item.v > 0);

  return (
    <div>
      <section className="relative overflow-hidden border-b border-line bg-ledger">
        {/* 상단 장르-스펙트럼 스트립 — 데이터 시그니처. 좌→우 fill-in 후 미세 시머. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-1 overflow-hidden" aria-hidden>
          <div
            className="size-full origin-left motion-safe:[animation:spectrum-grow_0.9s_var(--ease-out-expo)_0.1s_both]"
            style={{ background: spectrumGradient(["로맨스", "판타지", "액션", "SF"], 90) }}
          />
        </div>
        {/* warm-ink 깊이 레이어 — persimmon 상단 글로(호흡) + 우상단 따뜻한 블룸. hue 42 축 유지. */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-52 opacity-70"
          style={{
            background:
              "linear-gradient(to bottom, oklch(0.72 0.185 42 / 0.13), oklch(0.155 0.008 70 / 0))",
          }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -right-24 -top-16 size-[34rem] rounded-full opacity-70 blur-3xl motion-safe:[animation:hero-bloom_11s_ease-in-out_infinite]"
          style={{
            background:
              "radial-gradient(closest-side, oklch(0.66 0.2 38 / 0.16), oklch(0.62 0.16 60 / 0.06) 58%, transparent 72%)",
          }}
          aria-hidden
        />
        <Container size="wide" className="relative flex flex-col gap-7 pt-7 pb-9 sm:gap-12 sm:pt-12 sm:pb-14 lg:gap-14 lg:pb-16">
          {bannerItems.length > 0 && (
            // 진입 페이드는 안정적 래퍼에서 단 한 번만 — 정적→인터랙티브(embla) 배너로
            // 스왑될 때 각 컴포넌트의 fade-up이 재실행돼 배너가 두 번 깜박이던 문제 방지.
            <div style={{ animation: "fade-up 0.7s var(--ease-out-expo) 0.1s both" }}>
              {interactiveHeroReady ? (
                <Suspense fallback={<HeroBannerStatic items={bannerItems} onActivate={activateInteractiveHero} />}>
                  <HeroBanner items={bannerItems} />
                </Suspense>
              ) : (
                <HeroBannerStatic items={bannerItems} onActivate={activateInteractiveHero} />
              )}
            </div>
          )}

          <div className="relative grid items-end gap-x-10 gap-y-6 sm:gap-y-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
            <div>
              <p
                className="eyebrow inline-flex items-center gap-2 text-accent"
                style={{ animation: "fade-up 0.5s var(--ease-out-expo) 0.05s both" }}
              >
                {/* 시그니처 스펙트럼 틱 — 살아있는 브랜드 맥동(데이터 맥락). */}
                <span
                  aria-hidden
                  className="h-2.5 w-9 rounded-full bg-[length:200%_100%] motion-safe:[animation:spectrum-sheen_3.6s_linear_infinite]"
                style={{ backgroundImage: spectrumGradient(["로맨스", "판타지", "액션", "SF", "스릴러"], 90) }}
              />
                {t("home.hero.eyebrow")}
              </p>

              <h1 className="mt-3 text-balance [word-break:keep-all] text-[clamp(1.75rem,7.5vw,2.4rem)] font-bold leading-[1.1] tracking-[-0.02em] sm:mt-4 sm:text-5xl sm:leading-[1.06] lg:text-[3.7rem]">
                <span className="block [animation:line-reveal_0.7s_var(--ease-out-expo)_0.12s_both]">
                  {t("home.hero.titleLine1")}
                </span>
                <span className="block [animation:line-reveal_0.7s_var(--ease-out-expo)_0.26s_both]">
                  <ShimmerTitle
                    as="span"
                    className="relative font-serif font-normal italic"
                    particleCount={24}
                    particleSpread={1.2}
                  >
                    {t("home.hero.titleShimmer")}
                    {/* 핸드드로운 강조 밑줄 — fill-in 후 정지. accent 톤. */}
                    <span
                      aria-hidden
                      className="absolute -bottom-0.5 left-0 h-[0.14em] w-full origin-left rounded-full bg-[linear-gradient(90deg,var(--color-accent),transparent)] motion-safe:[animation:spectrum-grow_0.6s_var(--ease-out-expo)_0.9s_both]"
                    />
                  </ShimmerTitle>
                  {t("home.hero.titleSuffix")}
                </span>
              </h1>

              <p
                className="mt-3 line-clamp-2 max-w-md text-pretty text-[0.9375rem] leading-relaxed text-fg-2 sm:mt-5 sm:line-clamp-none sm:text-base"
                style={{ animation: "fade-up 0.6s var(--ease-out-expo) 0.4s both" }}
              >
                {t("home.hero.description")}
              </p>

              <div
                className="mt-5 flex flex-wrap items-center gap-3 sm:mt-7"
                style={{ animation: "fade-up 0.6s var(--ease-out-expo) 0.5s both" }}
              >
                <OpenSearchButton className={HERO_PRIMARY_BUTTON_CLASS}>
                  <Search size={18} />
                  {t("home.hero.searchButton")}
                  {/* 키보드 단축키 힌트는 정밀 포인터(데스크톱)에서만 — 터치 기기엔 의미 없음. */}
                  <kbd className="ml-1 hidden rounded-md bg-on-accent/18 px-1.5 py-0.5 text-[0.7rem] pointer-fine:inline-block">⌘K</kbd>
                </OpenSearchButton>
                <Link href="/ranking" className={HERO_OUTLINE_BUTTON_CLASS}>
                  {t("home.hero.rankingButton")}
                  <ArrowRight size={17} className="transition-transform duration-150 ease-out-expo group-hover:translate-x-0.5" />
                </Link>
              </div>
              <div
                className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-fg-2"
                style={{ animation: "fade-up 0.6s var(--ease-out-expo) 0.58s both" }}
              >
                <Link href="/studio" className="inline-flex items-center gap-1.5 transition-colors hover:text-accent">
                  {t("home.hero.studioLink")}
                  <ArrowRight size={14} />
                </Link>
                <Link href="/create" className="inline-flex items-center gap-1.5 transition-colors hover:text-accent">
                  {t("home.hero.createLink")}
                  <ArrowRight size={14} />
                </Link>
              </div>
            </div>

            {/* 시그니처 인덱스 넘버럴 — 대형 tabular grotesque. ledger 격자 패널(데이터 대장 느낌).
                작은 화면(320~360px)에선 4칼럼이 천 단위 숫자를 넘치게 만들어 2칼럼으로 떨어뜨리고,
                sm 이상에선 stat 개수(--stat-cols)만큼 한 줄로 편다(가로 스크롤·숫자 절단 방지). */}
            <dl
              className="sheen-sweep grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line/80 bg-line/40 surface-hl sm:[grid-template-columns:repeat(var(--stat-cols),minmax(0,1fr))]"
              style={
                {
                  animation: "fade-up 0.6s var(--ease-out-expo) 0.55s both",
                  "--stat-cols": Math.min(heroStats.length, 4),
                } as React.CSSProperties
              }
            >
              {heroStats.map((item, i) => (
                <div
                  key={item.label}
                  className="group relative flex flex-col gap-1 overflow-hidden bg-card/70 px-3.5 py-4 transition-colors duration-200 hover:bg-card sm:px-5 sm:py-5"
                  style={{ animation: `fade-up 0.5s var(--ease-out-expo) ${0.55 + i * 0.08}s both` }}
                >
                  {/* 호버 시 상단에 퍼시몬 빛줄 — 데이터 셀이 "켜지는" 느낌(가독성 영향 0). */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 top-0 h-px origin-left scale-x-0 bg-[linear-gradient(90deg,transparent,var(--color-accent),transparent)] transition-transform duration-300 ease-out-expo group-hover:scale-x-100"
                  />
                  <dd className="numeral text-[clamp(1.4rem,6vw,1.7rem)] leading-none text-fg transition-colors duration-200 group-hover:text-accent sm:text-[2rem]">
                    <CountUp value={item.v} suffix={item.suffix} separator={item.v >= 10000} duration={1.1 + i * 0.1} />
                  </dd>
                  <dt className="mt-0.5 text-xs text-fg-3">{item.label}</dt>
                </div>
              ))}
            </dl>
          </div>
        </Container>
      </section>

      {deferredSectionsReady && (
        // 지연 로드 구간 높이를 미리 점유(min-h)해 콘텐츠가 들어오며 bodyHeight 가 폭증하는 CLS 를 줄인다.
        <Suspense fallback={<div className="min-h-[60vh]" aria-hidden />}>
          <HomeDeferredSections
            todayReleases={todayReleases}
            todayDay={todayDay}
            families={families}
            featured={featured}
            topRated={topRated}
            waitFree={waitFree}
            tags={tags}
            newest={newest}
          />
        </Suspense>
      )}
    </div>
  );
}
