import { CalendarDays, CalendarPlus, Database, SlidersHorizontal } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";


import type { PlatformId, Title, TitleCard } from "@/shared/lib/types";

import { AvailabilityDots } from "@/shared/components/availability";
import { MiniPoster } from "@/shared/components/rank-row";
import { Container } from "@/shared/components/section";
import { TitleFilterPanel } from "@/shared/components/title-filter-panel";
import { buttonClass } from "@/shared/components/ui/button-utils";
import { RatingInline } from "@/shared/components/ui/stars";
import { statsAreEstimated } from "@/shared/lib/estimate";
import { buildWeeklyIcs, downloadIcs, titleToWeeklyIcsEvent } from "@/shared/lib/ics";
import { useSavedTitleIds } from "@/shared/lib/store";
import { WEEK_DAYS } from "@/shared/lib/taxonomy";
import {
  EMPTY_TITLE_FILTERS,
  applyTitleFilters,
  countActiveTitleFilters,
} from "@/shared/lib/title-filters";
import { useRememberedFilters } from "@/shared/lib/use-remembered-filters";
import { cn } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";
import { ErrorState } from "@/src/components/error-state";
import { useApiResource } from "@/src/infrastructure/use-api-resource";



interface CalendarResponse {
  todayIdx: number;
  todayDay: string;
  todayCount: number;
  totalScheduled: number;
  platformCoverage: { id: PlatformId; label: string; color: string; count: number; share: number }[];
  // 정적 calendar.json 은 경량 카드(TitleCard)를 싣는다(시놉시스·보러가기 URL·평점분포 생략).
  // API 폴백 모드의 풀 Title 도 TitleCard 상위집합이라 같은 타입으로 소비한다.
  days: { day: string; items: TitleCard[] }[];
  generatedAt: string;
}

// 카드가 읽는 필드(추정 배지 판별·공용 필터·ICS 내보내기 포함)는 경량 카드에 모두 들어 있어
// Title 을 요구하는 공용 헬퍼에 안전하게 전달한다(lib/catalog-slim.ts 슬리밍 규약 참조).
const asTitle = (card: TitleCard) => card as unknown as Title;
const asTitleList = (cards: TitleCard[]) => cards as unknown as Title[];

// 캘린더 작품 행 — 데스크톱 7열 컬럼과 모바일 요일 목록에서 공용.
function CalItem({ title, className }: { title: TitleCard; className?: string }) {
  return (
    <Link
      href={`/title/${title.slug}`}
      className={cn(
        "group flex gap-2.5 rounded-xl p-1.5 transition-colors hover:bg-raised",
        className
      )}
    >
      <MiniPoster title={title} className="w-10 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-1">
        <span className="line-clamp-2 text-xs font-medium leading-tight text-fg group-hover:text-accent">
          {title.title}
        </span>
        <span className="flex items-center justify-between gap-1">
          <RatingInline value={title.stats.ratingAvg} estimated={statsAreEstimated(asTitle(title))} size="xs" />
          <AvailabilityDots availability={title.availability} max={2} />
        </span>
      </span>
    </Link>
  );
}

export function CalendarPage() {
  const { data, loading, error, reload } = useApiResource<CalendarResponse>(
    "/api/calendar",
    "연재 캘린더를 불러오지 못했습니다."
  );
  // 공용 작품 필터(찜·장르·플랫폼·가격·이용가·평점·태그). "필터 기억" ON이면 플랫폼 선택도 함께 유지된다.
  const { filters, setFilters, remember, toggleRemember } = useRememberedFilters("calendar");
  // 표시할 플랫폼 선택은 공용 필터(filters.platforms)에 보관 — 별도 상태일 때 재방문 시 유지되지 않던 문제 해소.
  // 캘린더 전용 칩 UI로 토글하며, 패널 facet에서는 'platform'을 제외해 중복 노출을 막는다.
  const selectedPlatforms = new Set(filters.platforms);
  const platformFilterActive = filters.platforms.length > 0;
  const togglePlatform = (id: PlatformId) =>
    setFilters({
      ...filters,
      platforms: filters.platforms.includes(id)
        ? filters.platforms.filter((p) => p !== id)
        : [...filters.platforms, id],
    });

  const [showFilters, setShowFilters] = useState(false);
  // 모바일: 요일 탭으로 하루씩 본다(null = 오늘). 데스크톱(xl)은 7열 그리드 유지.
  const [selectedDayIdx, setSelectedDayIdx] = useState<number | null>(null);
  const savedIds = useSavedTitleIds();
  // '상세 필터' 배지는 패널에 보이는 facet만 센다(플랫폼은 전용 칩으로 분리 노출).
  const titleFilterCount = countActiveTitleFilters(filters) - filters.platforms.length;
  const titleFilterActive = titleFilterCount > 0;
  const anyFilterActive = platformFilterActive || titleFilterActive;

  const todayIdx = data?.todayIdx ?? 0;
  const todayDay = data?.todayDay ?? WEEK_DAYS[todayIdx] ?? "월";
  const rawDays = data?.days ?? WEEK_DAYS.map((day) => ({ day, items: [] }));
  // 공용 필터(플랫폼 포함)를 적용. 비활성이면 원본 그대로 사용.
  const days = anyFilterActive
    ? rawDays.map((d) => ({
        day: d.day,
        items: applyTitleFilters(asTitleList(d.items), filters, savedIds),
      }))
    : rawDays;
  const totalScheduled = anyFilterActive
    ? days.reduce((n, d) => n + d.items.length, 0)
    : data?.totalScheduled ?? 0;
  const todayCount = anyFilterActive
    ? days[todayIdx]?.items.length ?? 0
    : data?.todayCount ?? 0;
  const selDay = Math.min(selectedDayIdx ?? todayIdx, Math.max(0, days.length - 1));
  const selItems = days[selDay]?.items ?? [];

  // ICS 내보내기 대상: 현재 필터가 적용된 보드의 고유 작품. 같은 작품이 여러 요일에 보이면
  // VEVENT 1건으로 합치고 보드 버킷 요일을 RRULE BYDAY 다중으로 넣는다.
  const exportable = new Map<string, { title: TitleCard; days: string[] }>();
  for (const { day, items } of days) {
    for (const title of items) {
      const entry = exportable.get(title.id);
      if (entry) entry.days.push(day);
      else exportable.set(title.id, { title, days: [day] });
    }
  }
  const exportIcs = () => {
    if (exportable.size === 0) return;
    const events = [...exportable.values()].map(({ title, days: titleDays }) =>
      titleToWeeklyIcsEvent(asTitle(title), titleDays)
    );
    downloadIcs(
      buildWeeklyIcs(events, { calendarName: "툰스펙트럼 연재 캘린더" }),
      "toonspectrum-calendar.ics"
    );
  };

  return (
    <Container size="wide" className="py-6 sm:py-10">
      <header className="mb-6 rounded-2xl border border-line bg-panel/45 p-4 surface-hl sm:mb-7 sm:p-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between lg:gap-4">
          <div>
            <p className="eyebrow flex items-center gap-1.5 text-accent">
              <CalendarDays size={14} /> RELEASE CALENDAR
            </p>
            <h1 className="mt-2 text-[clamp(1.6rem,7vw,1.875rem)] font-bold tracking-tight sm:text-4xl">연재 캘린더</h1>
            <p className="lede mt-2 max-w-2xl text-pretty text-sm leading-relaxed text-fg-2">
              연재요일 정보가 있는 작품을 요일별로 모두 표시합니다. 오늘은{" "}
              <span className="font-semibold text-accent">{todayDay}요일</span>, 새 회차가 올라오는 작품이{" "}
              <span className="numeral text-fg">{todayCount.toLocaleString("ko-KR")}</span>편입니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-card px-3 text-xs text-fg-2">
              <Database size={14} className="text-accent" />
              전체 연재 <span className="numeral text-fg">{totalScheduled.toLocaleString("ko-KR")}</span>편
            </span>
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              aria-expanded={showFilters}
              aria-pressed={titleFilterActive}
              className={buttonClass({
                size: "sm",
                variant: titleFilterActive ? "outline" : "quiet",
                className: "gap-1.5",
              })}
            >
              <SlidersHorizontal size={14} className={titleFilterActive ? "text-accent" : undefined} />
              필터
              {titleFilterActive && (
                <span className="rounded-full bg-accent/15 px-1.5 text-[0.68rem] text-accent">
                  {titleFilterCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={exportIcs}
              disabled={loading || !!error || exportable.size === 0}
              title="현재 필터 기준 연재 일정을 캘린더 앱용 .ics 파일로 저장 (주간 반복 일정)"
              className={buttonClass({ size: "sm", variant: "quiet", className: "gap-1.5" })}
            >
              <CalendarPlus size={14} />
              내보내기 (.ics)
              {exportable.size > 0 && (
                <span className="numeral text-[0.68rem] text-fg-3">
                  {exportable.size.toLocaleString("ko-KR")}
                </span>
              )}
            </button>
            {/* 연재 캘린더는 커밋된 카탈로그 스냅샷(정적 calendar.json)에서 파생된다 — 런타임 재수집이
                없어 수동 "갱신"은 동일 데이터를 다시 읽을 뿐이라 오해를 줘 제거했다. 로드 실패 시
                재시도는 아래 ErrorState 의 onRetry(reload) 로 제공한다. */}
          </div>
        </div>

        {data?.platformCoverage.length ? (
          <div className="mt-5 border-t border-line pt-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[0.72rem] font-medium text-fg-3">
                표시할 플랫폼{platformFilterActive ? ` · ${selectedPlatforms.size}개 선택` : " · 전체"}
              </span>
              {platformFilterActive && (
                <button
                  type="button"
                  onClick={() => setFilters({ ...filters, platforms: [] })}
                  className="text-[0.72rem] text-accent hover:underline"
                >
                  전체 보기
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {data.platformCoverage.map((platform) => {
                const on = selectedPlatforms.has(platform.id);
                return (
                  <button
                    key={platform.id}
                    type="button"
                    onClick={() => togglePlatform(platform.id)}
                    aria-pressed={on}
                    className={cn(
                      "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[0.72rem] transition-colors pointer-coarse:h-9 pointer-coarse:px-3 pointer-coarse:text-xs",
                      on
                        ? "border-accent/60 bg-accent-soft/50 text-fg"
                        : "border-line bg-card text-fg-2 hover:bg-raised",
                      platformFilterActive && !on && "opacity-45"
                    )}
                    title={`${platform.label} ${platform.count.toLocaleString("ko-KR")}편`}
                  >
                    <span className="size-1.5 rounded-full" style={{ backgroundColor: platform.color }} />
                    {platform.label}
                    <span className="numeral text-fg-3">{platform.count.toLocaleString("ko-KR")}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {showFilters && (
          <div className="mt-4 border-t border-line pt-4">
            <TitleFilterPanel
              value={filters}
              onChange={setFilters}
              facets={["saved", "genre", "pricing", "age", "minRating", "tag"]}
              savedCount={savedIds.size}
              remember={remember}
              onToggleRemember={toggleRemember}
            />
          </div>
        )}
      </header>

      {error ? (
        <ErrorState title="연재 캘린더를 불러오지 못했습니다." message={error} onRetry={reload} />
      ) : loading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          {WEEK_DAYS.map((day) => (
            <section key={day} className="rounded-2xl border border-line bg-panel/30 p-3">
              <div className="mb-3 flex items-center justify-between">
                <span className="font-display text-sm font-bold">{day}</span>
                <span className="skeleton h-4 w-8" />
              </div>
              <div className="space-y-2.5">
                {Array.from({ length: 8 }).map((_, index) => (
                  <div key={index} className="flex gap-2.5">
                    <span className="skeleton h-12 w-10 rounded-lg" />
                    <span className="flex-1 space-y-2 py-1">
                      <span className="skeleton block h-3 w-full" />
                      <span className="skeleton block h-3 w-2/3" />
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <>
          {/* 모바일·태블릿: 요일 탭 + 선택한 하루 목록 (가로 스크롤 컬럼 대신 세로 1일) */}
          <div className="xl:hidden">
            <div
              role="tablist"
              aria-label="요일 선택"
              className="rail -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1"
            >
              {days.map(({ day, items }, index) => {
                const on = index === selDay;
                const isToday = index === todayIdx;
                return (
                  <button
                    key={day}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setSelectedDayIdx(index)}
                    className={cn(
                      "relative inline-flex min-h-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border px-4 py-2 transition-colors",
                      on
                        ? "border-accent/60 text-fg"
                        : "border-line bg-panel/30 text-fg-2 hover:bg-raised"
                    )}
                  >
                    {on && (
                      <motion.span
                        layoutId="cal-active-day"
                        className="absolute inset-0 -z-10 rounded-xl bg-accent-soft/55 border border-accent/60"
                        transition={{ type: "spring", stiffness: 400, damping: 33 }}
                      />
                    )}
                    <span className={cn("font-display text-sm font-bold", isToday && !on && "text-accent")}>
                      {day}
                      {isToday && <span aria-hidden="true" className="ml-1 text-[0.55rem] align-top">●</span>}
                    </span>
                    <span className="numeral text-[0.72rem] text-fg-3">{items.length}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3">
              {selItems.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-line bg-card/40 px-4 py-10 text-center text-xs text-fg-3">
                  {days[selDay]?.day}요일 연재 없음
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {selItems.map((title) => (
                    <CalItem key={title.id} title={title} className="border border-line bg-panel/30 p-2" />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 데스크톱(xl+): 7열 그리드 */}
          <div className="hidden gap-3 xl:grid xl:grid-cols-7">
            {days.map(({ day, items }, index) => {
              const isToday = index === todayIdx;
              return (
                <section
                  key={day}
                  className={cn(
                    "flex flex-col rounded-2xl border",
                    isToday ? "border-accent/50 bg-accent-soft/40" : "border-line bg-panel/30"
                  )}
                >
                  <header
                    className={cn(
                      "flex items-center justify-between rounded-t-2xl border-b px-3.5 py-2.5",
                      isToday ? "border-accent/30" : "border-line"
                    )}
                  >
                    <span className={cn("font-display text-sm font-bold tracking-wide", isToday ? "text-accent" : "text-fg")}>
                      {day}
                      {isToday && <span className="ml-1.5 text-[0.72rem] font-medium">오늘</span>}
                    </span>
                    <span className="numeral text-xs text-fg-3">{items.length}</span>
                  </header>
                  <div className="flex flex-col gap-2.5 p-2.5">
                    {items.length === 0 ? (
                      <p className="px-1 py-6 text-center text-xs text-fg-3">연재 없음</p>
                    ) : (
                      items.map((title) => <CalItem key={title.id} title={title} />)
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}

      {!loading && !error && totalScheduled === 0 && (
        <div className="mt-4 rounded-2xl border border-dashed border-line bg-card/40 p-10 text-center">
          {anyFilterActive ? (
            <>
              <p className="text-sm font-medium text-fg">선택한 조건에 맞는 연재 작품이 없습니다.</p>
              <button
                type="button"
                onClick={() => setFilters(EMPTY_TITLE_FILTERS)}
                className="mt-1 text-xs text-accent hover:underline"
              >
                필터 초기화
              </button>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-fg">연재요일 정보가 있는 작품이 없습니다.</p>
              <p className="mt-1 text-xs text-fg-3">다음 카탈로그 수집이 성공하면 DB 스냅샷 기준으로 자동 반영됩니다.</p>
            </>
          )}
        </div>
      )}
    </Container>
  );
}
