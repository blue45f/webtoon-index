import { Sparkles, BookHeart, Star, Compass, BellRing } from "lucide-react";
import { useEffect, useState } from "react";

import { CollectionsTab } from "./library-view-collections";
import {
  RATED_SORTS,
  DAY_FROM_GETDAY,
  READ_TABS,
  EMPTY_PROFILE,
} from "./library-view-constants";
import { EmptyTeach } from "./library-view-empty";
import { MiniPoster } from "./rank-row";
import { TitleCard } from "./title-card";
import { UnderlineTabs, Segmented } from "./ui/segmented";
import { MeterBar } from "./ui/spectrum-bar";
import { Stars, RatingInline } from "./ui/stars";

import type {
  Tab,
  RatedSort,
  TasteProfile,
  TasteRec,
} from "./library-view-constants";
import type { ReadState, Title } from "@/shared/lib/types";

import { withCsrfProtection } from "@/shared/lib/csrf";
import { statsAreEstimated } from "@/shared/lib/estimate";
import { genreColor, spectrumGradient } from "@/shared/lib/genre-color";
import { useApp, useHydrated } from "@/shared/lib/store";
import { WEEK_DAYS } from "@/shared/lib/taxonomy";
import { cn } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";

export function LibraryView({ initialTab = "shelf" }: { initialTab?: Tab }) {
  const hydrated = useHydrated();
  const reads = useApp((s) => s.reads);
  const ratings = useApp((s) => s.ratings);
  const subscriptions = useApp((s) => s.subscriptions);
  const collections = useApp((s) => s.collections);
  const recentlyViewed = useApp((s) => s.recentlyViewed);
  const createCollection = useApp((s) => s.createCollection);
  const renameCollection = useApp((s) => s.renameCollection);
  const deleteCollection = useApp((s) => s.deleteCollection);
  const adultVerified = useApp((s) => s.adultVerified);
  const setAdultVerified = useApp((s) => s.setAdultVerified);
  const resetAll = useApp((s) => s.resetAll);

  const [tab, setTab] = useState<Tab>(initialTab);
  const [readTab, setReadTab] = useState<ReadState>("want");
  const [ratedSort, setRatedSort] = useState<RatedSort>("high");
  const [titlesById, setTitlesById] = useState<Record<string, Title>>({});
  const [profile, setProfile] = useState<TasteProfile>(EMPTY_PROFILE);
  const [recs, setRecs] = useState<TasteRec[]>([]);

  const titleIds = (() => {
    const ids = new Set<string>();
    Object.keys(reads).forEach((id) => ids.add(id));
    Object.keys(ratings).forEach((id) => ids.add(id));
    Object.entries(subscriptions).forEach(([id, on]) => {
      if (on) ids.add(id);
    });
    collections.forEach((collection) => collection.titleIds.forEach((id) => ids.add(id)));
    recentlyViewed.forEach((id) => ids.add(id));
    return Array.from(ids).sort((a, b) => a.localeCompare(b));
  })();

  const titleIdsKey = titleIds.join(",");

  useEffect(() => {
    if (!hydrated) return;
    const controller = new AbortController();

    async function loadLibraryData() {
      const [catalog, recommendation] = await Promise.all([
        titleIdsKey
          ? fetch(`/api/titles?ids=${encodeURIComponent(titleIdsKey)}`, {
              cache: "no-store",
              signal: controller.signal,
            }).then((res) => (res.ok ? res.json() : { items: [] }))
          : Promise.resolve({ items: [] }),
        fetch("/api/recommend", withCsrfProtection({
          method: "POST",
          cache: "no-store",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ratings, reads }),
        })).then((res) => (res.ok ? res.json() : { profile: EMPTY_PROFILE, tasteRecs: [] })),
      ]);

      const nextById: Record<string, Title> = {};
      for (const title of (catalog.items ?? []) as Title[]) nextById[title.id] = title;

      setTitlesById(nextById);
      setProfile((recommendation.profile as TasteProfile | undefined) ?? EMPTY_PROFILE);
      setRecs((recommendation.tasteRecs as TasteRec[] | undefined) ?? []);
    }

    loadLibraryData().catch((error) => {
      if ((error as Error).name !== "AbortError") {
        setProfile(EMPTY_PROFILE);
        setRecs([]);
      }
    });

    return () => controller.abort();
  }, [hydrated, ratings, reads, titleIdsKey]);

  if (!hydrated) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="skeleton aspect-[3/4] w-full" />
        ))}
      </div>
    );
  }

  const readIds = Object.entries(reads);
  const ratedEntries = Object.entries(ratings);
  const ratedIds = [...ratedEntries].sort((a, b) => {
    if (ratedSort === "title") {
      const nameA = titlesById[a[0]]?.title ?? "";
      const nameB = titlesById[b[0]]?.title ?? "";
      return nameA.localeCompare(nameB, "ko-KR");
    }
    return ratedSort === "low" ? a[1] - b[1] : b[1] - a[1];
  });

  const counts: Record<ReadState, number> = { want: 0, reading: 0, done: 0, dropped: 0 };
  readIds.forEach(([, st]) => (counts[st] = (counts[st] ?? 0) + 1));
  const shelfTitles = readIds
    .filter(([, st]) => st === readTab)
    .map(([id]) => titlesById[id])
    .filter((title): title is Title => Boolean(title));

  // 최근 본 작품 — 상세 페이지 방문 순서(최신순), 서재에 담지 않은 것도 포함
  const recentTitles = recentlyViewed
    .map((id) => titlesById[id])
    .filter((title): title is Title => Boolean(title))
    .slice(0, 12);

  // 연재 알림 — 구독한 작품을 요일별로
  const subTitles = Object.entries(subscriptions)
    .filter(([, on]) => on)
    .map(([id]) => titlesById[id])
    .filter((title): title is Title => Boolean(title));
  const todayDay = WEEK_DAYS[DAY_FROM_GETDAY[new Date().getDay()]];
  const todaySubs = subTitles.filter((t) => t.updateDays?.includes(todayDay));

  return (
    <div className="flex flex-col gap-6">
      <UnderlineTabs
        value={tab}
        onChange={(v) => setTab(v as Tab)}
        items={[
          { value: "shelf", label: `서재 ${readIds.length || ""}`.trim() },
          { value: "rated", label: `평가 ${ratedIds.length || ""}`.trim() },
          { value: "alerts", label: `연재 알림 ${subTitles.length || ""}`.trim() },
          { value: "taste", label: "취향 분석" },
          { value: "collections", label: "컬렉션" },
        ]}
      />

      {/* 서재 */}
      {tab === "shelf" && (
        <div className="flex flex-col gap-5">
          {recentTitles.length > 0 && (
            <section className="flex flex-col gap-3">
              <div className="flex items-baseline gap-2">
                <h3 className="text-sm font-semibold text-fg">최근 본 작품</h3>
                <span className="text-xs text-fg-3">방문 순</span>
              </div>
              <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {recentTitles.map((t) => (
                  <Link
                    key={t.id}
                    href={`/title/${t.slug}`}
                    className="group w-[4.5rem] shrink-0"
                    title={t.title}
                  >
                    <MiniPoster title={t} className="w-full" />
                    <p className="mt-1.5 truncate text-[0.7rem] text-fg-3 group-hover:text-accent">
                      {t.title}
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          )}
          <Segmented
            value={readTab}
            onChange={setReadTab}
            items={READ_TABS.map((t) => ({
              value: t.value,
              label: `${t.label}${counts[t.value] ? ` ${counts[t.value]}` : ""}`,
            }))}
          />
          {shelfTitles.length === 0 ? (
            <EmptyTeach
              icon={BookHeart}
              title="아직 담은 작품이 없어요"
              desc="작품 카드의 북마크나 상세 페이지의 상태 버튼으로 서재를 채워보세요."
              cta={{ label: "작품 탐색하기", href: "/explore" }}
            />
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-5">
              {shelfTitles.map((t) => (
                <TitleCard key={t.id} title={t} size="sm" />
              ))}
            </div>
          )}
        </div>
      )}

      {/* 내 평가 */}
      {tab === "rated" && (
        <div>
          {ratedIds.length === 0 ? (
            <EmptyTeach
              icon={Star}
              title="평가한 작품이 없어요"
              desc="별점을 남기면 취향 분석과 추천이 정교해집니다."
              cta={{ label: "평가하러 가기", href: "/ranking" }}
            />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-fg-3">
                  평가한 작품 <span className="numeral text-fg">{ratedIds.length}</span>편
                </span>
                <Segmented
                  value={ratedSort}
                  onChange={setRatedSort}
                  items={RATED_SORTS}
                  size="sm"
                />
              </div>
              <div className="flex flex-col gap-2.5">
              {ratedIds.map(([id, r]) => {
                const t = titlesById[id];
                if (!t) return null;
                return (
                  <Link
                    key={id}
                    href={`/title/${t.slug}`}
                    className="group flex items-center gap-4 rounded-xl border border-line bg-card p-3 transition-colors hover:border-line-strong"
                  >
                    <MiniPoster title={t} className="w-10" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-fg group-hover:text-accent">
                        {t.title}
                      </p>
                      <p className="text-xs text-fg-3">{t.author}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="flex items-center gap-1.5">
                        <Stars value={r} size="sm" />
                        <span className="numeral text-sm text-accent">{r.toFixed(1)}</span>
                      </span>
                      <span className="text-[0.7rem] text-fg-3">
                        평균 {statsAreEstimated(t) ? "≈" : ""}
                        {t.stats.ratingAvg.toFixed(1)}
                      </span>
                    </div>
                  </Link>
                );
              })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 취향 분석 */}
      {tab === "taste" && (
        <div className="flex flex-col gap-8">
          {profile.ratedCount === 0 && readIds.length === 0 ? (
            <EmptyTeach
              icon={Compass}
              title="취향 데이터를 모으는 중"
              desc="작품을 평가하거나 서재에 담으면, 당신의 취향 스펙트럼을 분석해 드려요."
              cta={{ label: "지금 평가하기", href: "/ranking" }}
            />
          ) : (
            <>
              <div className="flex flex-col gap-5 rounded-2xl border border-line bg-card p-6 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
                <div className="min-w-0">
                  <p className="eyebrow text-fg-3">독자 유형</p>
                  <p className="mt-1.5 font-serif text-2xl italic text-accent sm:text-[1.75rem]">
                    {profile.affinityType === "webtoon"
                      ? "웹툰파"
                      : profile.affinityType === "webnovel"
                        ? "웹소설파"
                        : "균형 잡힌 독자"}
                  </p>
                </div>
                <dl className="flex shrink-0 divide-x divide-line border-line sm:border-l sm:pl-8">
                  <div className="pr-6 sm:px-6 sm:first:pl-0">
                    <dd className="numeral text-2xl text-fg">{profile.ratedCount}</dd>
                    <dt className="mt-0.5 text-xs text-fg-3">평가한 작품</dt>
                  </div>
                  <div className="pl-6 sm:px-6 sm:last:pr-0">
                    <dd className="numeral text-2xl text-fg">
                      {profile.avgRating ? profile.avgRating.toFixed(1) : "·"}
                    </dd>
                    <dt className="mt-0.5 text-xs text-fg-3">내 평균 별점</dt>
                  </div>
                </dl>
              </div>

              {profile.topGenres.length > 0 && (
                <div className="rounded-2xl border border-line bg-card p-5">
                  <h3 className="mb-4 text-sm font-semibold">선호 장르 스펙트럼</h3>
                  <div
                    className="mb-4 h-1.5 w-full rounded-full"
                    style={{ background: spectrumGradient(profile.topGenres.map((g) => g.name)) }}
                  />
                  <div className="flex flex-col gap-2.5">
                    {profile.topGenres.map((g) => {
                      const max = profile.topGenres[0].weight || 1;
                      return (
                        <MeterBar
                          key={g.name}
                          label={g.name}
                          value={Math.round((g.weight / max) * 100)}
                          suffix=""
                          color={genreColor(g.name, 0.7)}
                        />
                      );
                    })}
                  </div>
                  {profile.topTags.length > 0 && (
                    <div className="mt-5 flex flex-wrap gap-1.5">
                      {profile.topTags.map((t) => (
                        <span
                          key={t.name}
                          className="rounded-full border border-line bg-raised/50 px-2.5 py-1 text-xs text-fg-2"
                        >
                          #{t.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {recs.length > 0 && (
                <div>
                  <div className="mb-4 flex items-center gap-2">
                    <Sparkles size={16} className="text-accent" />
                    <h3 className="font-semibold">취향 저격 추천</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-5">
                    {recs.map(({ title, reason }) => (
                      <div key={title.id} className="flex flex-col gap-1.5">
                        <TitleCard title={title} size="sm" />
                        <p className="text-[0.7rem] leading-snug text-accent">{reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* 연재 알림 */}
      {tab === "alerts" && (
        <div className="flex flex-col gap-6">
          {subTitles.length === 0 ? (
            <EmptyTeach
              icon={BellRing}
              title="구독한 연재가 없어요"
              desc="작품 상세에서 '연재 알림 받기'를 켜면 요일별 업데이트를 모아 보여드려요."
              cta={{ label: "연재 캘린더 보기", href: "/calendar" }}
            />
          ) : (
            <>
              {todaySubs.length > 0 && (
                <div className="rounded-2xl border border-accent/40 bg-accent-soft/40 p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <BellRing size={16} className="text-accent" />
                    <h3 className="font-semibold text-fg">
                      오늘({todayDay}) 새 회차 {todaySubs.length}편
                    </h3>
                  </div>
                  <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                    {todaySubs.map((t) => (
                      <TitleCard key={t.id} title={t} size="sm" />
                    ))}
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-5">
                {WEEK_DAYS.map((day) => {
                  const list = subTitles.filter((t) => t.updateDays?.includes(day));
                  if (list.length === 0) return null;
                  const isToday = day === todayDay;
                  return (
                    <div key={day}>
                      <h4
                        className={cn(
                          "mb-2.5 flex items-center gap-2 text-sm font-semibold",
                          isToday ? "text-accent" : "text-fg-2"
                        )}
                      >
                        <span className="font-display">{day}요일</span>
                        <span className="text-xs font-normal text-fg-3">{list.length}편</span>
                        {isToday && <span className="text-[0.65rem]">· 오늘</span>}
                      </h4>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {list.map((t) => (
                          <Link
                            key={t.id}
                            href={`/title/${t.slug}`}
                            className="group flex items-center gap-3 rounded-xl border border-line bg-card p-2.5 transition-colors hover:border-line-strong"
                          >
                            <MiniPoster title={t} className="w-9" />
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg group-hover:text-accent">
                              {t.title}
                            </span>
                            <RatingInline value={t.stats.ratingAvg} estimated={statsAreEstimated(t)} size="xs" />
                          </Link>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* 컬렉션 */}
      {tab === "collections" && (
        <CollectionsTab
          collections={collections}
          titlesById={titlesById}
          onCreate={createCollection}
          onRename={renameCollection}
          onDelete={deleteCollection}
        />
      )}

      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-5 text-xs text-fg-3">
        <span>
          성인 인증:{" "}
          <span className={adultVerified ? "font-medium text-good" : "text-fg-2"}>
            {adultVerified ? "인증됨 · 19금 표시" : "미인증 · 19금 가림"}
          </span>
        </span>
        <button
          onClick={() => setAdultVerified(!adultVerified)}
          className="inline-flex min-h-8 items-center rounded-md border border-line px-2.5 py-1 transition-colors hover:border-line-strong hover:text-fg"
        >
          {adultVerified ? "인증 해제" : "성인 인증하기 (만 19세+)"}
        </button>
        {(readIds.length > 0 || ratedIds.length > 0) && (
          <button
            onClick={() => confirm("내 서재 데이터를 모두 초기화할까요?") && resetAll()}
            className="inline-flex min-h-8 items-center rounded-md px-1.5 py-1 transition-colors hover:text-bad"
          >
            서재 데이터 초기화
          </button>
        )}
      </div>
    </div>
  );
}
