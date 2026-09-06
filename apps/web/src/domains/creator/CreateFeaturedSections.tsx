import { Boxes, Flame, Sparkles, Trophy, WandSparkles } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { WorkCard, WorkGridSkeleton } from "./creator-community-ui";
import { buildStudioHref } from "./creator-studio-links";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";
import {
  challengeDday,
  listChallenges,
  listWorks,
  type ChallengeSummary,
  type WorkSummary,
} from "@/src/infrastructure/creator-client";


function SectionShell({
  eyebrow,
  title,
  description,
  action,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-panel/30 p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow text-accent">{eyebrow}</p>
          <h2 className="mt-1 text-lg font-bold text-fg">{title}</h2>
          {description ? <p className="mt-1 text-xs leading-relaxed text-fg-3">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function tagCounts(works: WorkSummary[]) {
  const counts = new Map<string, number>();
  for (const work of works) {
    for (const tag of work.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
}

export function CreateFeaturedSections() {
  const [popular, setPopular] = useState<WorkSummary[]>([]);
  const [recent, setRecent] = useState<WorkSummary[]>([]);
  const [challenge, setChallenge] = useState<ChallengeSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    setLoading(true);
    Promise.all([
      listWorks({ sort: "likes" }, controller.signal),
      listWorks({ sort: "recent" }, controller.signal),
      listChallenges(controller.signal),
    ])
      .then(([likedWorks, recentWorks, challenges]) => {
        if (!alive) return;
        setPopular(likedWorks.slice(0, 5));
        setRecent(recentWorks.slice(0, 12));
        const ongoing = challenges.filter((item) => item.state !== "ended");
        setChallenge(ongoing[0] ?? challenges[0] ?? null);
      })
      .catch(() => {
        if (!alive) return;
        setPopular([]);
        setRecent([]);
        setChallenge(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, []);

  const trendingTags = tagCounts(recent);
  const remixWorks = recent.filter((work) => work.remixFromId).slice(0, 4);

  if (loading) {
    return (
      <div className="mb-6 space-y-4">
        <WorkGridSkeleton count={5} />
      </div>
    );
  }

  if (popular.length === 0 && !challenge && trendingTags.length === 0) return null;

  const challengeDdayLabel = challenge ? challengeDday(challenge.endsAt) : null;

  return (
    <div className="mb-6 space-y-4">
      {challenge && (
        <SectionShell
          eyebrow="WEEKLY CHALLENGE"
          title={challenge.title}
          description={challenge.theme}
          action={
            <Link
              href={buildStudioHref({ challengeId: challenge.id })}
              className={buttonClass({ size: "sm", variant: "solid", className: "gap-1.5" })}
            >
              <Trophy size={14} />
              바로 참여하기
            </Link>
          }
        >
          <div className="flex flex-wrap items-center gap-2 text-xs text-fg-3">
            <span className="inline-flex items-center gap-1 rounded-full border border-accent/35 bg-accent-soft/50 px-2.5 py-1 text-accent">
              <Trophy size={12} />
              참여작 <span className="numeral font-semibold">{challenge.entries}</span>
            </span>
            {challengeDdayLabel != null && (
              <span
                className={cn(
                  "numeral inline-flex items-center rounded-full border px-2.5 py-1 font-semibold",
                  challengeDdayLabel <= 3
                    ? "border-warn/35 bg-warn/10 text-warn"
                    : "border-line bg-raised text-fg-2"
                )}
              >
                {challengeDdayLabel === 0 ? "오늘 마감" : `D-${challengeDdayLabel}`}
              </span>
            )}
            <Link href={`/create/challenges?c=${encodeURIComponent(challenge.slug)}`} className="ml-auto text-accent hover:underline">
              참여작 보기
            </Link>
          </div>
        </SectionShell>
      )}

      {popular.length > 0 && (
        <SectionShell
          eyebrow="CREATOR PICKS"
          title="이번 주 인기 창작물"
          description="좋아요가 많은 작품을 모았습니다."
          action={
            <Link href="/create?sort=likes" className={buttonClass({ size: "sm", variant: "outline" })}>
              전체 보기
            </Link>
          }
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {popular.map((work) => (
              <WorkCard key={work.id} work={work} />
            ))}
          </div>
        </SectionShell>
      )}

      {trendingTags.length > 0 && (
        <SectionShell
          eyebrow="TAG DISCOVERY"
          title="요즘 많이 쓰는 태그"
          description="태그를 눌러 비슷한 분위기의 창작물을 찾아보세요."
        >
          <div className="flex flex-wrap gap-2">
            {trendingTags.map(([tag, count]) => (
              <Link
                key={tag}
                href={`/create?tag=${encodeURIComponent(tag)}`}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-card px-3 text-sm text-fg-2 transition-colors hover:border-accent/45 hover:text-accent"
              >
                <Flame size={13} className="text-warn" />#{tag}
                <span className="numeral text-xs text-fg-3">{count}</span>
              </Link>
            ))}
          </div>
        </SectionShell>
      )}

      {remixWorks.length > 0 && (
        <SectionShell
          eyebrow="REMIX LINEAGE"
          title="리믹스로 이어지는 창작"
          description="다른 작품을 이어받아 새롭게 그린 작품들입니다."
          action={
            <span className="inline-flex items-center gap-1 text-xs text-fg-3">
              <WandSparkles size={13} className="text-accent" />
              상세에서 ‘리믹스’로 참여
            </span>
          }
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {remixWorks.map((work) => (
              <WorkCard key={work.id} work={work} />
            ))}
          </div>
        </SectionShell>
      )}

      <SectionShell
        eyebrow="QUICK START"
        title="오늘 바로 시작하기"
        description="그리기가 부담스럽다면 이미지 업로드, 컷 구성이 필요하면 스튜디오로."
      >
        <div className="grid gap-2 sm:grid-cols-3">
          <Link
            href={buildStudioHref({ mode: "upload" })}
            className="flex items-center gap-3 rounded-xl border border-line bg-card/60 px-4 py-3 transition-colors hover:border-accent/45 hover:bg-card"
          >
            <span className="grid size-10 place-items-center rounded-lg bg-accent-soft text-accent">
              <Sparkles size={18} />
            </span>
            <span>
              <span className="block text-sm font-semibold text-fg">이미지 업로드 게시</span>
              <span className="mt-0.5 block text-xs text-fg-3">완성 이미지를 순서대로 올리기</span>
            </span>
          </Link>
          <Link
            href="/studio"
            className="flex items-center gap-3 rounded-xl border border-line bg-card/60 px-4 py-3 transition-colors hover:border-accent/45 hover:bg-card"
          >
            <span className="grid size-10 place-items-center rounded-lg bg-accent-soft text-accent">
              <Trophy size={18} />
            </span>
            <span>
              <span className="block text-sm font-semibold text-fg">컷툰 스튜디오</span>
              <span className="mt-0.5 block text-xs text-fg-3">템플릿·말풍선·VRM으로 제작</span>
            </span>
          </Link>
          <Link
            href="/studio/lift3d"
            className="flex items-center gap-3 rounded-xl border border-line bg-card/60 px-4 py-3 transition-colors hover:border-accent/45 hover:bg-card"
          >
            <span className="grid size-10 place-items-center rounded-lg bg-accent-soft text-accent">
              <Boxes size={18} />
            </span>
            <span>
              <span className="block text-sm font-semibold text-fg">2D → 3D 변환</span>
              <span className="mt-0.5 block text-xs text-fg-3">원화를 3D 모델·배경으로 세우기</span>
            </span>
          </Link>
        </div>
      </SectionShell>
    </div>
  );
}