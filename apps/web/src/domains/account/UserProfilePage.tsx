import { BookOpen, PenLine, RefreshCw, UserCheck, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";


import type { SeedReview, Title } from "@/shared/lib/types";

import { ReviewCard } from "@/shared/components/review-card";
import { Container } from "@/shared/components/section";
import { buttonClass } from "@/shared/components/ui/button-utils";
import { Stars } from "@/shared/components/ui/stars";
import { useT } from "@/shared/lib/i18n";
import { useApp } from "@/shared/lib/store";
import { cn, formatCount } from "@/shared/lib/utils";
import { ErrorState } from "@/src/components/error-state";
import { SeriesCard, WorkCard, WorkGridSkeleton } from "@/src/domains/creator/creator-community-ui";
import { useDocumentTitle, useMetaDescription } from "@/src/hooks/use-document-title";
import {
  getCreatorProfile,
  listSeries,
  listWorks,
  toggleFollow,
  type CreatorProfile,
  type SeriesSummary,
  type WorkSummary,
} from "@/src/infrastructure/creator-client";
import { useApiResource } from "@/src/infrastructure/use-api-resource";


// 회원 공개 프로필 — 리뷰 카드의 작성자명을 누르면 오는 /u/:userId.
// 리뷰는 기존 /api/reviews 응답(피드+통계)을 userId로 필터해 그대로 재사용하고,
// 창작 활동(팔로우/작품/시리즈)은 /api/creator/users/:id/profile + 목록 API 를 사용한다.
interface ReviewsResponse {
  feed: Array<SeedReview & { title: Title }>;
  stats: { total: number; avg: number; spoilerPct: number; distinctTitles: number };
}

type ProfileTab = "reviews" | "works" | "series";

const TABS: { value: ProfileTab; labelKey: string }[] = [
  { value: "reviews", labelKey: "userProfile.tabs.reviews" },
  { value: "works", labelKey: "userProfile.tabs.works" },
  { value: "series", labelKey: "userProfile.tabs.series" },
];

function isTab(value: string | null): value is ProfileTab {
  return value === "reviews" || value === "works" || value === "series";
}

// ── 창작 작품 탭 ──────────────────────────────────────────────────────
function ProfileWorksTab({ userId }: { userId: string }) {
  const t = useT();
  const [works, setWorks] = useState<WorkSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    setLoading(true);
    listWorks({ userId }, controller.signal)
      .then((result) => {
        if (alive) setWorks(result);
      })
      .catch(() => {
        if (alive) setWorks([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [userId]);

  if (loading) return <WorkGridSkeleton count={5} />;
  if (works.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-card/40 p-10 text-center text-sm text-fg-2 sm:p-12">
        <PenLine size={24} className="mx-auto mb-2.5 text-fg-3" />
        {t("userProfile.works.empty")}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {works.map((work) => (
        <WorkCard key={work.id} work={work} showAuthor={false} />
      ))}
    </div>
  );
}

// ── 시리즈 탭 ─────────────────────────────────────────────────────────
function ProfileSeriesTab({ userId }: { userId: string }) {
  const t = useT();
  const [series, setSeries] = useState<SeriesSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    setLoading(true);
    listSeries({ userId }, controller.signal)
      .then((result) => {
        if (alive) setSeries(result);
      })
      .catch(() => {
        if (alive) setSeries([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [userId]);

  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="flex gap-3.5 rounded-2xl border border-line bg-panel/30 p-3">
            <span className="skeleton block aspect-[3/4] w-24 rounded-xl" />
            <div className="flex-1 space-y-2 py-1">
              <span className="skeleton block h-4 w-2/3" />
              <span className="skeleton block h-3 w-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (series.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-card/40 p-10 text-center text-sm text-fg-2 sm:p-12">
        <BookOpen size={24} className="mx-auto mb-2.5 text-fg-3" />
        {t("userProfile.series.empty")}
      </div>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {series.map((item) => (
        <SeriesCard key={item.id} series={item} />
      ))}
    </div>
  );
}

export function UserProfilePage() {
  const t = useT();
  const { userId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: ProfileTab = isTab(tabParam) ? tabParam : "reviews";
  const viewerId = useApp((s) => s.userId);
  const isSelf = !!viewerId && viewerId === userId;

  const { data, loading, error, reload } = useApiResource<ReviewsResponse>(
    `/api/reviews?userId=${encodeURIComponent(userId)}`,
    t("userProfile.fetchError")
  );

  // 창작자 프로필(이름/아바타/소개 + 팔로우/작품/시리즈 수) — 리뷰가 없어도 동작.
  const [profile, setProfile] = useState<CreatorProfile | null>(null);
  const [followBusy, setFollowBusy] = useState(false);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const controller = new AbortController();
    getCreatorProfile(userId, controller.signal)
      .then((result) => {
        if (alive) setProfile(result);
      })
      .catch(() => {
        if (alive) setProfile(null);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [userId, viewerId]);

  const feed = data?.feed ?? [];
  const author = profile?.name ?? feed[0]?.author ?? t("userProfile.authorFallback");
  const avatar = profile?.avatar ?? feed[0]?.avatar ?? "#7c5cfc";
  const total = data?.stats.total ?? 0;
  const avg = data?.stats.avg ?? 0;
  const distinctTitles = data?.stats.distinctTitles ?? 0;
  useDocumentTitle(loading && !profile ? t("userProfile.eyebrow") : `${author}`);
  useMetaDescription(
    data
      ? t("userProfile.metaTemplate")
          .replace("{author}", author)
          .replace("{reviews}", String(total))
          .replace("{works}", String(distinctTitles))
          .replace("{avg}", avg ? avg.toFixed(1) : "-")
      : null
  );

  async function onToggleFollow() {
    if (!profile || !viewerId || isSelf || followBusy) return;
    setFollowBusy(true);
    // 낙관적 토글 — 실패 시 원복.
    const prev = { isFollowing: profile.isFollowing, followers: profile.followers };
    setProfile({
      ...profile,
      isFollowing: !prev.isFollowing,
      followers: prev.followers + (prev.isFollowing ? -1 : 1),
    });
    try {
      const result = await toggleFollow(profile.id);
      setProfile((current) =>
        current ? { ...current, isFollowing: result.following, followers: result.followers } : current
      );
    } catch {
      setProfile((current) => (current ? { ...current, ...prev } : current));
    } finally {
      setFollowBusy(false);
    }
  }

  const setTab = (next: ProfileTab) => {
    const params = new URLSearchParams(searchParams);
    if (next === "reviews") params.delete("tab");
    else params.set("tab", next);
    setSearchParams(params, { replace: true });
  };

  return (
    <div>
      <section className="border-b border-line bg-ledger">
        <Container size="wide" className="py-8 sm:py-12 lg:py-16">
          <p className="eyebrow text-accent">{t("userProfile.eyebrow")}</p>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <span
              className="grid size-14 shrink-0 place-items-center rounded-full text-2xl font-bold text-[oklch(0.97_0.012_85)] ring-1 ring-[oklch(0.95_0.01_85/0.16)] shadow-[inset_0_1px_0_oklch(1_0_0/0.12)] sm:size-16"
              style={{ background: `linear-gradient(140deg, ${avatar}, oklch(0.3 0.05 60))` }}
              aria-hidden
            >
              {author.charAt(0)}
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-2xl font-bold leading-tight sm:text-3xl">{author}</h1>
              <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-fg-2">
                {profile?.bio || t("userProfile.bioFallback")}
              </p>
            </div>
            {/* 팔로우 버튼 — 본인 프로필이면 숨김, 비로그인은 비활성 안내 */}
            {profile && !isSelf && (
              <button
                type="button"
                onClick={onToggleFollow}
                disabled={!viewerId || followBusy}
                aria-pressed={profile.isFollowing}
                title={viewerId ? undefined : t("userProfile.followHint")}
                className={buttonClass({
                  size: "sm",
                  variant: profile.isFollowing ? "outline" : "solid",
                  className: "shrink-0 gap-1.5",
                })}
              >
                {profile.isFollowing ? <UserCheck size={14} /> : <UserPlus size={14} />}
                {profile.isFollowing ? t("userProfile.following") : t("userProfile.follow")}
              </button>
            )}
          </div>

          <dl className="mt-7 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-line pt-6 sm:flex sm:flex-wrap sm:items-end sm:gap-x-9">
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-fg-2">{t("userProfile.stat.followers")}</dt>
              <dd className="numeral tnum text-2xl text-fg">{formatCount(profile?.followers ?? 0)}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-fg-2">{t("userProfile.stat.totalReviews")}</dt>
              <dd className="numeral tnum text-2xl text-fg">{total.toLocaleString("ko-KR")}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-fg-2">{t("userProfile.stat.avgRating")}</dt>
              <dd className="flex items-center gap-2">
                <Stars value={avg} size="sm" />
                <span className="numeral tnum text-2xl text-fg">{avg.toFixed(2)}</span>
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-fg-2">{t("userProfile.stat.works")}</dt>
              <dd className="numeral tnum text-2xl text-fg">{(profile?.works ?? 0).toLocaleString("ko-KR")}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-fg-2">{t("userProfile.stat.series")}</dt>
              <dd className="numeral tnum text-2xl text-fg">{(profile?.series ?? 0).toLocaleString("ko-KR")}</dd>
            </div>
          </dl>
        </Container>
      </section>

      <Container size="wide" className="py-8 sm:py-10 lg:py-12">
        {/* 탭: 리뷰 / 창작 작품 / 시리즈 */}
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label={t("userProfile.tabsLabel")} className="flex flex-wrap gap-1.5">
            {TABS.map((option) => {
              const on = option.value === tab;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setTab(option.value)}
                  className={cn(
                    "inline-flex h-8 items-center rounded-full border px-3.5 text-[0.8125rem] font-medium transition-colors",
                    on
                      ? "border-accent bg-accent text-on-accent"
                      : "border-line bg-card text-fg-2 hover:bg-raised"
                  )}
                >
                  {t(option.labelKey)}
                </button>
              );
            })}
          </div>
          {tab === "reviews" && (
            <button
              type="button"
              onClick={reload}
              className={buttonClass({ size: "sm", variant: "quiet", className: "ml-auto gap-1.5" })}
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              {t("userProfile.refresh")}
            </button>
          )}
        </div>

        {tab === "works" ? (
          <ProfileWorksTab userId={userId} />
        ) : tab === "series" ? (
          <ProfileSeriesTab userId={userId} />
        ) : loading ? (
          <div className="columns-1 gap-4 sm:columns-2 xl:columns-3 [&>*]:mb-4 [&>*]:break-inside-avoid">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="rounded-2xl border border-line bg-card p-5">
                <span className="skeleton mb-2 block h-4 w-full" />
                <span className="skeleton mb-2 block h-4 w-5/6" />
                <span className="skeleton block h-4 w-2/3" />
              </div>
            ))}
          </div>
        ) : error ? (
          <ErrorState title={t("userProfile.fetchError")} message={error} onRetry={reload} />
        ) : feed.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-card/40 p-10 text-center text-sm text-fg-2 sm:p-12">
            {t("userProfile.emptyReviews")}
          </div>
        ) : (
          <div className="columns-1 gap-4 sm:columns-2 lg:columns-2 xl:columns-3 [&>*]:mb-4 [&>*]:break-inside-avoid">
            {feed.map((review) => (
              <ReviewCard key={review.id} review={review} title={review.title} showTitle />
            ))}
          </div>
        )}
      </Container>
    </div>
  );
}
