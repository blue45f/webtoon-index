import { Sparkles, Wand2, Shuffle, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";

import { MiniPoster } from "./rank-row";
import { RecommendOnboarding } from "./recommend-view-onboarding";
import { Section, Rail } from "./section";
import { TitleCard } from "./title-card";

import type { RecommendPayload } from "./recommend-view-types";
import type { PlatformId } from "@/shared/lib/types";

import { TitleFilterPanel } from "@/shared/components/title-filter-panel";
import { withCsrfProtection } from "@/shared/lib/csrf";
import { genreColor, genreTextColor } from "@/shared/lib/genre-color";
import { useApp, useHydrated, useSavedTitleIds } from "@/shared/lib/store";
import { GENRES } from "@/shared/lib/taxonomy";
import { applyTitleFilters, countActiveTitleFilters } from "@/shared/lib/title-filters";
import { useRememberedFilters } from "@/shared/lib/use-remembered-filters";
import { cn } from "@/shared/lib/utils";


export function RecommendView({ initialGenres = [] }: { initialGenres?: string[] }) {
  const hydrated = useHydrated();
  const ratings = useApp((s) => s.ratings);
  const reads = useApp((s) => s.reads);
  const setRating = useApp((s) => s.setRating);
  const setRead = useApp((s) => s.setRead);

  const savedIds = useSavedTitleIds();

  const [picked, setPicked] = useState<string[]>(initialGenres);
  const [seedId, setSeedId] = useState<string | null>(null);
  const [data, setData] = useState<RecommendPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const { filters, setFilters, remember, toggleRemember } = useRememberedFilters("recommend");
  const [showFilters, setShowFilters] = useState(false);

  // 온보딩 취향 테스트 관련 상태
  const [showOnboarding, setShowOnboarding] = useState(false);

  const requestBody = JSON.stringify({ picked, seedId, ratings, reads });

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    fetch("/api/recommend", withCsrfProtection({
      method: "POST",
      body: requestBody,
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    }))
      .then((res) => {
        if (!res.ok) throw new Error("recommend failed");
        return res.json() as Promise<RecommendPayload>;
      })
      .then((payload) => {
        if (alive) setData(payload);
      })
      .catch((e) => {
        if (alive && (e as Error)?.name !== "AbortError") {
          setData(null);
          setError(true);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [requestBody, reloadKey]);

  const pickedRecsRaw = data?.pickedRecs ?? [];
  const pickedLabelGenres = data?.pickedLabelGenres ?? picked;
  const tasteRecsRaw = data?.tasteRecs ?? [];
  const popular = data?.popular ?? [];
  const seed = data?.seed ?? null;
  const similarRaw = data?.similar ?? [];
  const hasTaste = hydrated && !!data && data.profile.ratedCount + data.profile.readCount > 0;

  // 클라이언트 측 필터 적용 — 추천 결과 목록에만 반영(원작 추천 'picked' 동작은 그대로 유지).
  // 'popular' 레일은 비슷한 작품 탐색의 시드 선택기이므로 필터하지 않는다.
  const pickedRecs = applyTitleFilters(pickedRecsRaw, filters, savedIds);
  const tasteRecs = tasteRecsRaw.filter((r) =>
    applyTitleFilters([r.title], filters, savedIds).length > 0
  );
  const similar = applyTitleFilters(similarRaw, filters, savedIds);

  // 데이터에 실제로 존재하는 플랫폼만 facet에 노출(빈 플랫폼 숨김).
  const platformOptions = Array.from(
    new Set(
      [...pickedRecsRaw, ...tasteRecsRaw.map((r) => r.title), ...similarRaw, ...popular].flatMap((t) =>
        t.availability.map((a) => a.platformId)
      )
    )
  ) as PlatformId[];

  const activeFilters = countActiveTitleFilters(filters);

  const handleOnboardingComplete = (
    selectedGenres: string[],
    selectedTitles: string[],
    selectedFormat: "all" | "webtoon" | "webnovel",
    selectedStatus: "all" | "ongoing" | "completed"
  ) => {
    // 1. 선호 장르 설정
    setPicked(selectedGenres);

    // 2. 선택 작품 5.0 평점 및 읽음 처리 적용
    selectedTitles.forEach((id) => {
      setRating(id, 5.0);
      setRead(id, "done");
    });

    // 3. 선호 포맷 및 상태 필터 적용 (배열 형태로 변환)
    setFilters((prev) => ({
      ...prev,
      types: selectedFormat === "all" ? [] : [selectedFormat],
      status: selectedStatus === "all" ? [] : [selectedStatus],
    }));

    setShowOnboarding(false);
  };

  // 온보딩 진행 화면 렌더링
  if (showOnboarding && !loading) {
    return (
      <RecommendOnboarding
        initialGenres={picked}
        popular={popular}
        onComplete={handleOnboardingComplete}
        onCancel={() => setShowOnboarding(false)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-16 animate-fade-in">
      {error && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-warn/40 bg-[oklch(0.82_0.15_80/0.08)] p-5 text-sm text-fg-2">
          <Sparkles size={18} className="shrink-0 text-warn" />
          <p className="flex-1">추천을 불러오지 못했어요. 장르 선택은 그대로 두고 다시 시도할 수 있습니다.</p>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-fg hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            다시 시도
          </button>
        </div>
      )}

      {/* 추천 결과 필터 — '필터' 토글 뒤에 패널을 둠 */}
      <div className="-mb-6 flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
          className={cn(
            "inline-flex w-fit items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            showFilters || activeFilters > 0
              ? "border-accent/60 bg-accent-soft/60 text-fg"
              : "border-line bg-card text-fg-2 hover:border-line-strong hover:text-fg"
          )}
        >
          <SlidersHorizontal size={15} className="text-accent" /> 필터
          {activeFilters > 0 && (
            <span className="rounded-full bg-accent/15 px-1.5 text-[0.68rem] text-accent">
              {activeFilters}
            </span>
          )}
        </button>
        {showFilters && (
          <TitleFilterPanel
            value={filters}
            onChange={setFilters}
            facets={[
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
            ]}
            platformOptions={platformOptions}
            savedCount={savedIds.size}
            remember={remember}
            onToggleRemember={toggleRemember}
          />
        )}
      </div>

      {/* 취향 픽 — 콜드스타트 친화 */}
      <section>
        <div className="mb-5 flex items-center gap-2">
          <Wand2 size={18} className="text-accent" />
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl">어떤 결이 끌리나요?</h2>
        </div>
        <p className="mb-4 max-w-xl text-sm text-fg-3">
          끌리는 장르를 고르면 즉시 추천이 갱신됩니다. 평가 이력이 있다면 그것까지 함께 반영해요.
        </p>
        <div className="mb-7 flex flex-wrap gap-2">
          {GENRES.map((g) => {
            const on = picked.includes(g);
            return (
              <button
                key={g}
                onClick={() =>
                  setPicked((p) => (p.includes(g) ? p.filter((x) => x !== g) : [...p, g]))
                }
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm font-medium transition-transform duration-150 hover:scale-105",
                  on && "ring-1"
                )}
                style={{
                  color: genreTextColor(g, on ? 0.92 : 0.82),
                  backgroundColor: `color-mix(in oklch, ${genreColor(g, 0.6)} ${on ? 26 : 12}%, transparent)`,
                  borderColor: `color-mix(in oklch, ${genreColor(g, 0.6)} ${on ? 60 : 28}%, transparent)`,
                }}
              >
                {g}
              </button>
            );
          })}
          {picked.length > 0 && (
            <button
              onClick={() => setPicked([])}
              className="rounded-full border border-line px-3 py-1.5 text-sm text-fg-3 hover:text-fg"
            >
              초기화
            </button>
          )}
        </div>

        {pickedLabelGenres.length > 0 && (
          <p className="mb-4 text-sm text-fg-2">
            <span className="text-accent">{pickedLabelGenres.join(" · ")}</span> 취향으로 고른{" "}
            <span className="numeral text-fg">{loading ? "..." : pickedRecs.length}</span>편
          </p>
        )}
        <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-5">
          {pickedRecs.map((t) => (
            <TitleCard key={t.id} title={t} size="sm" />
          ))}
        </div>
      </section>

      {/* 내 평가 기반 (평가가 없을 땐 취향 온보딩 테스트 카드 노출) */}
      {hasTaste ? (
        tasteRecs.length > 0 && (
          <Section
            eyebrow="FOR YOU"
            title="당신의 평가가 가리키는 다음 작품"
            desc={`평가 ${data.profile.ratedCount}편, 관심 ${data.profile.readCount}편을 분석했어요`}
            action={{ label: "취향 분석", href: "/library?tab=taste" }}
          >
            <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-6">
              {tasteRecs.map(({ title, reason }) => (
                <div key={title.id} className="flex flex-col gap-1.5">
                  <TitleCard title={title} size="sm" />
                  <p className="text-[0.7rem] leading-snug text-accent">{reason}</p>
                </div>
              ))}
            </div>
          </Section>
        )
      ) : (
        <div className="rounded-2xl border border-line bg-panel/35 p-6 sm:p-8 flex flex-col items-center text-center space-y-4 max-w-xl mx-auto my-4 shadow-md">
          <div className="size-12 rounded-full bg-accent-soft/30 flex items-center justify-center text-accent">
            <Sparkles size={22} className="animate-pulse-soft" />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-fg">나를 위한 개인화 추천 받기</h3>
            <p className="text-xs text-fg-3 max-w-sm leading-relaxed">
              인생작 몇 편과 선호하는 장르를 선택해주시면, 툰스펙트럼의 다축 AI 엔진이 전 플랫폼을 가로질러 맞춤 작품을 즉시 제안해 드립니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowOnboarding(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-5 py-2.5 text-xs font-semibold text-on-accent hover:bg-accent/90 transition-all cursor-pointer shadow-md"
          >
            <Wand2 size={13} />
            10초 취향 테스트 시작
          </button>
        </div>
      )}

      {/* 비슷한 작품 찾기 */}
      <section>
        <div className="mb-5 flex items-center gap-2">
          <Shuffle size={18} className="text-accent" />
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl">이 작품과 비슷한</h2>
        </div>
        <p className="mb-4 text-sm text-fg-3">기준 작품을 고르면 장르·태그·어댑테이션으로 닮은 작품을 찾아줍니다.</p>
        <Rail itemClassName="w-14">
          {popular.map((t) => (
            <button
              key={t.id}
              onClick={() => setSeedId(t.id)}
              className={cn(
                "block w-14 rounded-md transition-transform hover:scale-105",
                seed?.id === t.id && "ring-2 ring-accent ring-offset-2 ring-offset-canvas"
              )}
              title={t.title}
            >
              <MiniPoster title={t} className="w-full" />
            </button>
          ))}
        </Rail>
        {seed && (
          <div className="mt-6">
            <p className="mb-4 text-sm text-fg-2">
              <span className="font-semibold text-fg">{seed.title}</span>
              <span className="text-fg-3">와 비슷한 작품</span>
            </p>
            <Rail>
              {similar.map((t) => (
                <TitleCard key={t.id} title={t} />
              ))}
            </Rail>
          </div>
        )}
      </section>
    </div>
  );
}
