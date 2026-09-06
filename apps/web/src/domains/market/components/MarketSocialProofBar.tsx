import {
  LoaderCircle,
  MessageSquare,
  ShieldCheck,
  Star,
  ThumbsUp,
} from "lucide-react";

import { useMarketSocial } from "../hooks/use-market-social";

import { cn } from "@/shared/lib/utils";
import { useSession } from "@/src/compat/auth-session-store";

export function MarketSocialProofBar({
  resourceId,
}: {
  readonly resourceId: string;
}) {
  const session = useSession();
  const viewerKey = session.ready && session.status === "authenticated"
    ? session.data.user.id
    : "anonymous";
  const { data, status } = useMarketSocial(resourceId, viewerKey);

  if (status === "loading" && !data) {
    return (
      <div
        role="status"
        aria-label="평점과 댓글 요약 불러오는 중"
        className="mt-4 inline-flex min-h-9 items-center gap-2 rounded-lg border border-line/70 bg-card/70 px-3 text-xs text-fg-3"
      >
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        활용 평가와 질문 동기화 중
      </div>
    );
  }

  if (!data) return null;

  const hasReviews = data.stats.totalCount > 0;
  return (
    <nav
      aria-label="이 리소스의 평가와 질문 요약"
      className="mt-4 flex flex-wrap items-center gap-1.5"
    >
      {/*
        The visible text is two adjacent spans, so each link's computed name concatenates with no
        separator — "4.712개", which a screen reader reads as a single number. Name them explicitly
        rather than relying on a flex gap only sighted users perceive.
      */}
      <a
        href="#market-reviews-heading"
        aria-label={hasReviews
          ? `평점 ${data.stats.average.toFixed(1)} · 리뷰 ${data.stats.totalCount}개`
          : `평가 전 · 리뷰 ${data.stats.totalCount}개`}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-card/80 px-3 text-xs font-semibold text-fg transition-colors hover:border-accent/50 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
      >
        <Star
          className={cn(
            "size-3.5",
            hasReviews
              ? "fill-amber-400 text-amber-400"
              : "text-fg-3",
          )}
          aria-hidden="true"
        />
        <span className="numeral tnum">
          {hasReviews ? data.stats.average.toFixed(1) : "평가 전"}
        </span>
        <span className="font-normal text-fg-3">
          {data.stats.totalCount}개
        </span>
      </a>
      <a
        href="#market-reviews-heading"
        aria-label={`추천 ${data.stats.recommendPercentage}%`}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-card/80 px-3 text-xs font-semibold text-fg transition-colors hover:border-accent/50 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
      >
        <ThumbsUp className="size-3.5 text-good" aria-hidden="true" />
        <span className="numeral tnum">{data.stats.recommendPercentage}%</span>
        <span className="font-normal text-fg-3">추천</span>
      </a>
      <a
        href="#market-comments-heading"
        aria-label={`질문·답글 ${data.totalCommentCount}개`}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-card/80 px-3 text-xs font-semibold text-fg transition-colors hover:border-accent/50 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
      >
        <MessageSquare className="size-3.5 text-accent" aria-hidden="true" />
        <span className="numeral tnum">{data.totalCommentCount}</span>
        <span className="font-normal text-fg-3">질문·답글</span>
      </a>
      {data.viewer.studioInstallVerified ? (
        <span className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-good/30 bg-good/10 px-3 text-xs font-semibold text-good">
          <ShieldCheck className="size-3.5" aria-hidden="true" />
          내 계정 Studio 사용 인증
        </span>
      ) : null}
    </nav>
  );
}
