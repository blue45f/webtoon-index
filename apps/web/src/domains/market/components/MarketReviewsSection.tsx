import {
  Cloud,
  LoaderCircle,
  PackageCheck,
  Palette,
  PenTool,
  RefreshCw,
  ShieldCheck,
  Star,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import { useMarketSocial } from "../hooks/use-market-social";

import type {
  CreatorMarketplaceSocialAuthorBadge,
  CreatorMarketplaceSocialReview,
  CreatorMarketplaceSocialReviewQualification,
} from "@/shared/lib/creator-marketplace-social-contract";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";
import { useSession } from "@/src/compat/auth-session-store";
import Link from "@/src/compat/router-link";

interface MarketReviewsSectionProps {
  resourceId: string;
}

type ReviewSort = "helpful" | "newest" | "rating";

const ROLE_TAGS = [
  "현역 웹툰 작가",
  "어시스턴트",
  "콘티/데생 작가",
  "일러스트레이터",
  "웹툰 지망생",
] as const;
const REVIEW_TAGS = [
  "선화 최적",
  "작업 속도 단축",
  "필압 우수",
  "3D 구도 편리",
  "색감 통일성",
  "레이어 분리 깔끔",
] as const;

function formatDate(value: string): string {
  try {
    return new Intl.DateTimeFormat("ko-KR", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(value));
  } catch {
    return value.slice(0, 10);
  }
}

function Stars({ value, size = "size-3.5" }: { value: number; size?: string }) {
  return (
    <span className="flex" aria-label={`${value}점`}>
      {Array.from({ length: 5 }, (_, index) => (
        <Star
          key={index}
          className={cn(
            size,
            index < Math.round(value)
              ? "fill-amber-400 text-amber-400"
              : "text-line-strong",
          )}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

function AuthorBadge({ badge }: { badge: CreatorMarketplaceSocialAuthorBadge }) {
  if (badge === "publisher") {
    return <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[0.62rem] font-semibold text-accent">배급자</span>;
  }
  if (badge === "studio-verified") {
    return (
      <span className="inline-flex items-center gap-0.5 rounded bg-good/15 px-1.5 py-0.5 text-[0.62rem] font-semibold text-good">
        <ShieldCheck className="size-2.5" aria-hidden="true" /> Studio 설치 확인
      </span>
    );
  }
  if (badge === "library-member") {
    return (
      <span className="inline-flex items-center gap-0.5 rounded bg-cool/15 px-1.5 py-0.5 text-[0.62rem] font-medium text-cool">
        <Cloud className="size-2.5" aria-hidden="true" /> 보관함 소장
      </span>
    );
  }
  return null;
}

function QualificationBadge({
  qualification,
  installedVersion,
}: {
  qualification: CreatorMarketplaceSocialReviewQualification;
  installedVersion: string | null;
}) {
  return qualification === "studio" ? (
    <span className="inline-flex items-center gap-1 rounded-md border border-good/30 bg-good/10 px-2 py-1 text-[0.65rem] font-semibold text-good">
      <ShieldCheck className="size-3" aria-hidden="true" />
      Studio 설치 확인{installedVersion ? ` v${installedVersion}` : ""}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-md border border-cool/30 bg-cool/10 px-2 py-1 text-[0.65rem] font-semibold text-cool">
      <PackageCheck className="size-3" aria-hidden="true" /> 계정 보관함 확인
    </span>
  );
}

function sortReviews(
  reviews: readonly CreatorMarketplaceSocialReview[],
  sort: ReviewSort,
): CreatorMarketplaceSocialReview[] {
  return [...reviews].sort((left, right) => {
    if (sort === "rating") {
      return right.rating - left.rating
        || right.helpfulCount - left.helpfulCount
        || right.createdAt.localeCompare(left.createdAt);
    }
    if (sort === "newest") return right.createdAt.localeCompare(left.createdAt);
    return right.helpfulCount - left.helpfulCount
      || right.createdAt.localeCompare(left.createdAt);
  });
}

// A fresh `[]` each render hands every memo below a new dependency identity, so they
// recompute every render and memoise nothing. One frozen empty keeps it stable while
// `data` is still loading.
const NO_REVIEWS: readonly CreatorMarketplaceSocialReview[] = Object.freeze([]);

export function MarketReviewsSection({ resourceId }: MarketReviewsSectionProps) {
  const session = useSession();
  const authenticated = session.status === "authenticated";
  const social = useMarketSocial(
    resourceId,
    authenticated ? session.data.user.id : "guest",
  );
  const [sort, setSort] = useState<ReviewSort>("helpful");
  const [formOpen, setFormOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [roleTag, setRoleTag] = useState<string>(ROLE_TAGS[0]);
  const [tags, setTags] = useState<string[]>([]);

  const reviews = social.data?.reviews ?? NO_REVIEWS;
  const displayed = useMemo(() => sortReviews(reviews, sort), [reviews, sort]);
  const mine = social.data?.viewer.myReviewId
    ? reviews.find((review) => review.id === social.data?.viewer.myReviewId) ?? null
    : null;
  const stats = social.data?.stats ?? {
    average: 0,
    totalCount: 0,
    recommendPercentage: 0,
    distribution: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 },
  };
  const viewer = social.data?.viewer;
  const pending = social.pendingAction !== null;

  function openEditor(): void {
    if (!viewer?.canReview) return;
    setRating(mine?.rating ?? 5);
    setTitle(mine?.title ?? "");
    setContent(mine?.content ?? "");
    setRoleTag(mine?.roleTag || ROLE_TAGS[0]);
    setTags(mine ? [...mine.tags] : []);
    setFormOpen(true);
  }

  function toggleTag(tag: string): void {
    setTags((current) => current.includes(tag)
      ? current.filter((item) => item !== tag)
      : current.length >= 5
        ? current
        : [...current, tag]);
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!viewer?.canReview || !title.trim() || !content.trim()) return;
    try {
      await social.saveReview({
        rating,
        title: title.trim(),
        content: content.trim(),
        roleTag,
        tags,
      });
      setFormOpen(false);
    } catch {
      // The shared store exposes the server-owned error below the form.
    }
  }

  return (
    <section
      aria-labelledby="market-reviews-heading"
      className="rounded-xl border border-line bg-card p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
        <div>
          <h2 id="market-reviews-heading" className="flex items-center gap-2 text-base font-bold text-fg sm:text-lg">
            <Star className="size-4 fill-amber-400 text-amber-400" aria-hidden="true" />
            검증 평점 & 활용 리뷰
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-fg-3">
            브러시·필터·팔레트는 실제 Studio 설치 확인 뒤 평가합니다. 아직 설치 영수증을 지원하지 않는 종류는 계정 보관함 확인으로 구분해 과장 없이 표시합니다.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void social.refresh()}
            disabled={social.status === "loading"}
            aria-label="리뷰 새로고침"
            className={buttonClass({ variant: "ghost", size: "sm" })}
          >
            <RefreshCw className={cn("size-3.5", social.status === "loading" && "animate-spin")} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => formOpen ? setFormOpen(false) : openEditor()}
            disabled={!viewer?.canReview || pending}
            className={buttonClass({
              variant: formOpen ? "outline" : "solid",
              size: "sm",
              className: "gap-1.5 disabled:cursor-not-allowed disabled:opacity-45",
            })}
          >
            <PenTool className="size-3.5" aria-hidden="true" />
            {formOpen ? "작성 취소" : mine ? "내 리뷰 수정" : "리뷰 작성"}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 rounded-xl border border-line/60 bg-panel/30 p-4 sm:grid-cols-[180px_minmax(0,1fr)]">
        <div className="flex flex-col items-center justify-center border-b border-line/50 pb-4 text-center sm:border-b-0 sm:border-r sm:pb-0 sm:pr-4">
          <strong className="numeral tnum text-4xl text-fg">{stats.average.toFixed(1)}</strong>
          <Stars value={stats.average} size="size-4" />
          <span className="mt-1 text-xs text-fg-2">{stats.totalCount}개 검증 평가 · {stats.recommendPercentage}% 추천</span>
        </div>
        <div className="space-y-1.5">
          {([5, 4, 3, 2, 1] as const).map((star) => {
            const key = String(star) as "1" | "2" | "3" | "4" | "5";
            const count = stats.distribution[key];
            const width = stats.totalCount ? Math.round((count / stats.totalCount) * 100) : 0;
            return (
              <div key={star} className="flex items-center gap-2 text-xs">
                <span className="w-6 text-fg-3">{star}★</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-raised">
                  <div className="h-full rounded-full bg-amber-400" style={{ width: `${width}%` }} />
                </div>
                <span className="numeral tnum w-8 text-right text-fg-3">{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {viewer ? (
        <div className={cn(
          "mt-4 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2.5 text-xs",
          viewer.canReview ? "border-good/35 bg-good/10 text-good" : "border-line bg-panel text-fg-2",
        )}>
          {viewer.canReview ? (
            <>
              {viewer.reviewQualification === "studio"
                ? <ShieldCheck className="size-4" aria-hidden="true" />
                : <PackageCheck className="size-4" aria-hidden="true" />}
              <strong>
                {viewer.reviewQualification === "studio"
                  ? "Studio 설치 확인 완료 · 리뷰 작성 가능"
                  : "계정 보관함 확인 완료 · 리뷰 작성 가능"}
              </strong>
            </>
          ) : viewer.reviewRequirement === "login" ? (
            <span>로그인 후 리뷰 자격을 확인합니다.</span>
          ) : viewer.reviewRequirement === "publisher-cannot-review" ? (
            <span>배급자는 자신의 리소스에 평점을 남길 수 없습니다.</span>
          ) : viewer.reviewRequirement === "add-to-library" ? (
            <>
              <Cloud className="size-4 text-cool" aria-hidden="true" />
              <span>먼저 계정 라이브러리에 이 패키지를 추가해 주세요.</span>
              <button type="button" onClick={() => void social.refresh()} className="ml-auto font-semibold text-accent hover:underline">
                자격 다시 확인
              </button>
            </>
          ) : (
            <>
              <Palette className="size-4 text-accent" aria-hidden="true" />
              <span>Studio에서 실제 설치를 완료하면 리뷰가 열립니다.</span>
              <Link href={`/studio?installMarketResource=${resourceId}&assetMarket=community`} className="ml-auto font-semibold text-accent hover:underline">
                Studio에서 설치
              </Link>
            </>
          )}
        </div>
      ) : null}

      {formOpen && viewer?.canReview ? (
        <form onSubmit={(event) => void submit(event)} className="mt-5 space-y-4 rounded-xl border border-accent/40 bg-panel/70 p-4 sm:p-5">
          <h3 className="text-sm font-bold text-fg">{mine ? "내 활용 리뷰 수정" : "활용 리뷰 남기기"}</h3>
          <fieldset>
            <legend className="text-xs font-semibold text-fg">별점</legend>
            <div className="mt-1 flex gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button key={star} type="button" onClick={() => setRating(star)} aria-label={`${star}점`} aria-pressed={rating === star} className="rounded p-0.5 focus-visible:ring-2 focus-visible:ring-accent">
                  <Star className={cn("size-6", star <= rating ? "fill-amber-400 text-amber-400" : "text-line-strong")} aria-hidden="true" />
                </button>
              ))}
            </div>
          </fieldset>
          <label className="block text-xs font-semibold text-fg">
            작업 역할
            <select value={roleTag} onChange={(event) => setRoleTag(event.target.value)} className="mt-1 block h-9 w-full rounded-lg border border-line bg-card px-2.5 text-xs sm:max-w-xs">
              {ROLE_TAGS.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
            </select>
          </label>
          <label className="block text-xs font-semibold text-fg">
            리뷰 제목
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} required placeholder="예: 선화 작업 시간이 확실히 줄었습니다" className="mt-1 block h-9 w-full rounded-lg border border-line bg-card px-3 text-xs" />
          </label>
          <label className="block text-xs font-semibold text-fg">
            실제 적용 경험
            <textarea value={content} onChange={(event) => setContent(event.target.value)} rows={4} maxLength={1_000} required placeholder="어떤 컷과 설정에서 사용했는지, 품질·성능·호환성의 장단점을 구체적으로 남겨 주세요." className="mt-1 block w-full rounded-xl border border-line bg-card p-3 text-xs leading-relaxed" />
          </label>
          <fieldset>
            <legend className="text-xs font-semibold text-fg">핵심 키워드</legend>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {REVIEW_TAGS.map((tag) => (
                <button key={tag} type="button" onClick={() => toggleTag(tag)} aria-pressed={tags.includes(tag)} className={cn("rounded-md border px-2 py-1 text-[0.68rem]", tags.includes(tag) ? "border-accent bg-accent/15 text-accent" : "border-line bg-card text-fg-3")}>
                  #{tag}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="flex justify-end gap-2 border-t border-line/60 pt-3">
            <button type="button" onClick={() => setFormOpen(false)} className={buttonClass({ variant: "ghost", size: "sm" })}>취소</button>
            <button type="submit" disabled={!title.trim() || !content.trim() || pending} className={buttonClass({ variant: "solid", size: "sm", className: "gap-1.5 disabled:opacity-40" })}>
              {social.pendingAction === "review:save" ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : null}
              {mine ? "리뷰 수정" : "리뷰 등록"}
            </button>
          </div>
        </form>
      ) : null}

      {social.error ? (
        <div role="alert" className="mt-4 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-fg-2">
          {social.error}
        </div>
      ) : null}

      <div className="mt-5 flex items-center justify-between gap-2">
        <strong className="text-xs text-fg-2">검증된 사용자 리뷰</strong>
        <select value={sort} onChange={(event) => setSort(event.target.value as ReviewSort)} aria-label="리뷰 정렬" className="h-8 rounded-lg border border-line bg-panel px-2 text-xs text-fg">
          <option value="helpful">도움순</option>
          <option value="newest">최신순</option>
          <option value="rating">평점 높은순</option>
        </select>
      </div>

      <div className="mt-3 space-y-3.5">
        {social.status === "loading" && !social.data ? (
          <div role="status" className="rounded-xl border border-line bg-panel/40 p-6 text-center text-xs text-fg-3">리뷰를 불러오는 중입니다.</div>
        ) : displayed.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line bg-panel/50 py-8 text-center text-xs text-fg-2">아직 검증된 활용 리뷰가 없습니다.</div>
        ) : displayed.map((review) => (
          <article key={review.id} className="rounded-xl border border-line/60 bg-panel/30 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <strong className="text-xs text-fg">{review.author.name}</strong>
                  <AuthorBadge badge={review.author.badge} />
                  {review.roleTag ? <span className="text-[0.65rem] text-fg-3">· {review.roleTag}</span> : null}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Stars value={review.rating} />
                  <time dateTime={review.createdAt} className="text-[0.65rem] text-fg-3">{formatDate(review.createdAt)} · 대상 v{review.sourceResourceVersion}</time>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => void social.toggleReviewHelpful(review.id).catch(() => undefined)} disabled={!authenticated || review.isMine || pending} aria-pressed={review.helpfulByViewer} title={review.isMine ? "자신의 리뷰에는 도움 반응을 남길 수 없습니다." : undefined} className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[0.68rem] disabled:opacity-50", review.helpfulByViewer ? "border-accent bg-accent/15 text-accent" : "border-line bg-card text-fg-3")}>
                  <ThumbsUp className="size-3" aria-hidden="true" /> 도움 {review.helpfulCount || ""}
                </button>
                {review.canDelete ? (
                  <button type="button" onClick={() => void social.deleteReview().catch(() => undefined)} disabled={pending} aria-label="내 리뷰 삭제" className="rounded p-1.5 text-fg-3 hover:text-warn disabled:opacity-40">
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </div>
            <div className="mt-3"><QualificationBadge qualification={review.qualification} installedVersion={review.installedResourceVersion} /></div>
            <h3 className="mt-3 text-sm font-bold text-fg">{review.title}</h3>
            <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-fg-2">{review.content}</p>
            {review.tags.length ? (
              <ul className="mt-2.5 flex flex-wrap gap-1">{review.tags.map((tag) => <li key={tag} className="rounded bg-raised/80 px-1.5 py-0.5 text-[0.62rem] text-fg-3">#{tag}</li>)}</ul>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
