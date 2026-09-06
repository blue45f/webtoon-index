import { Bookmark, Eye, Heart, Layers, MapPin, Star } from "lucide-react";
import { useEffect } from "react";
import { useParams } from "react-router-dom";


import type { SeedReview, Title } from "@/shared/lib/types";

import { AdaptationGraph } from "@/shared/components/adaptation-graph";
import { AuthorLine } from "@/shared/components/author-line";
import { AvailabilityRouter } from "@/shared/components/availability";
import { CollectionAdd } from "@/shared/components/collection-add";
import { CoverImage } from "@/shared/components/cover-image";
import { FanCafePanel } from "@/shared/components/fan-cafe-panel";
import { PriceCompare } from "@/shared/components/price-compare";
import { ReadStateSelector } from "@/shared/components/read-state";
import { ReviewCard } from "@/shared/components/review-card";
import { ReviewForm } from "@/shared/components/review-form";
import { ScoreBreakdown } from "@/shared/components/score-breakdown";
import { Rail, Section, Container } from "@/shared/components/section";
import { ShareButton } from "@/shared/components/share-button";
import { SubscribeButton } from "@/shared/components/subscribe-button";
import { TitleCard } from "@/shared/components/title-card";
import { TitleExternal } from "@/shared/components/title-external";
import { TitleFanWorks } from "@/shared/components/title-fan-works";
import { TitleOst } from "@/shared/components/title-ost";
import { TitlePoster } from "@/shared/components/title-poster";
import { Badge, GenreChip } from "@/shared/components/ui/chip";
import { DistributionBars, GenreSpectrum, MeterBar } from "@/shared/components/ui/spectrum-bar";
import { Stars } from "@/shared/components/ui/stars";
import { statsAreEstimated } from "@/shared/lib/estimate";
import { useApp } from "@/shared/lib/store";
import { AGE_LABEL, STATUS_LABEL, TYPE_LABEL } from "@/shared/lib/taxonomy";
import { mergedUniverse } from "@/shared/lib/title-universe";
import { formatCount } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";
import { ErrorState } from "@/src/components/error-state";
import { NotFoundPage } from "@/src/components/NotFoundPage";
import { useAppConfig } from "@/src/hooks/use-app-config";
import { useDocumentTitle, useMetaDescription } from "@/src/hooks/use-document-title";
import { useApiResource } from "@/src/infrastructure/use-api-resource";


interface TitleDetailResponse {
  title: Title;
  reviews: SeedReview[];
  similar: Title[];
  byAuthor?: Title[];
  original: Title;
  adaptations: Title[];
  hasFamily: boolean;
  reviewAvg: number;
  reviewCount: number;
  generatedAt: string;
  source: string;
}

export function TitleDetailPage() {
  const { slug } = useParams();
  const { data, loading, error, notFound, reload } = useApiResource<TitleDetailResponse>(
    slug ? `/api/titles/${encodeURIComponent(slug)}` : null,
    "작품 상세 데이터를 불러오지 못했습니다."
  );
  useDocumentTitle(data?.title?.title);
  // 시놉시스 원문은 저작권 리스크가 있어 관리자 킬스위치로 끌 수 있다(끄면 문단 자체를 숨김).
  const { showSynopsis } = useAppConfig();

  const t = data?.title;
  const metaDesc = t
    ? [
        [t.author, ...(t.genres ?? []).slice(0, 2)].filter(Boolean).join(" · "),
        (t.synopsis ?? "").replace(/\s+/g, " ").trim(),
      ]
        .filter(Boolean)
        .join(" — ")
    : null;
  useMetaDescription(metaDesc);

  const addRecentlyViewed = useApp((s) => s.addRecentlyViewed);
  const viewedId = data?.title?.id;
  useEffect(() => {
    if (viewedId) addRecentlyViewed(viewedId);
  }, [viewedId, addRecentlyViewed]);

  if (loading) {
    return (
      <Container size="wide" className="relative py-8 lg:py-10">
        <div className="grid gap-8 lg:grid-cols-[19rem_1fr]">
          <aside className="flex flex-col gap-4">
            <div className="skeleton aspect-[3/4] rounded-2xl" />
            <div className="skeleton h-12 rounded-xl" />
            <div className="skeleton h-24 rounded-2xl" />
          </aside>
          <div className="space-y-5">
            <div className="skeleton h-8 w-40" />
            <div className="skeleton h-12 w-3/4" />
            <div className="skeleton h-5 w-64" />
            <div className="skeleton h-28 rounded-2xl" />
            <div className="skeleton h-24 rounded-2xl" />
          </div>
        </div>
      </Container>
    );
  }

  if (notFound || !data) {
    if (!error) return <NotFoundPage />;
  }

  if (error || !data) {
    return (
      <Container size="wide" className="py-10">
        <ErrorState title="작품 상세를 불러오지 못했습니다." message={error} onRetry={reload} />
      </Container>
    );
  }

  const { title, reviews, similar, original, adaptations, hasFamily } = data;
  const byAuthor = data.byAuthor ?? [];
  // 영상화(드라마·영화·애니·OTT)는 통합 유니버스 데이터에서 조회(원작+현재작 합산).
  // 웹툰화 패밀리가 없어도(독립 작품) 영상화가 있으면 그래프를 노출한다.
  const externalMedia = mergedUniverse(title, original).adaptations;
  const hasExternalMedia = externalMedia.length > 0;
  const reviewCount = data.reviewCount || title.stats.ratingCount;
  const reviewAvg = data.reviewCount > 0 ? data.reviewAvg : title.stats.ratingAvg;
  const estimated = statsAreEstimated(title);
  const fmtStat = (value: number) => (estimated ? `≈${formatCount(value)}` : formatCount(value));
  const stats = [
    { icon: Eye, label: "조회", value: fmtStat(title.stats.views) },
    { icon: Heart, label: "좋아요", value: fmtStat(title.stats.likes) },
    { icon: Bookmark, label: "관심", value: fmtStat(title.stats.bookmarks) },
    { icon: Star, label: "평가", value: fmtStat(reviewCount) },
  ];

  return (
    <Container size="wide" className="relative py-8 lg:py-10">
      {title.coverImage && (
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[480px] w-screen -translate-x-1/2 overflow-hidden"
        >
          <CoverImage src={title.coverImage} alt="" className="size-full scale-110 object-cover opacity-25 blur-2xl" />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(to bottom, oklch(0.155 0.008 70 / 0.32), oklch(0.155 0.008 70 / 0.86) 58%, oklch(0.155 0.008 70))",
            }}
          />
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[19rem_1fr]">
        <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
          <TitlePoster title={title} size="lg" priority />
          <ReadStateSelector titleId={title.id} />
          <CollectionAdd titleId={title.id} />
          {title.status === "ongoing" && title.updateDays && title.updateDays.length > 0 && (
            <SubscribeButton titleId={title.id} days={title.updateDays} />
          )}
          <ShareButton title={title.title} slug={title.slug} className="self-start" />
          <div className="rounded-2xl border border-line bg-panel/50 p-4">
            <div className="mb-3 flex items-center gap-2">
              <MapPin size={15} className="text-accent" />
              <p className="text-sm font-semibold text-fg">어디서 볼 수 있나요</p>
            </div>
            <AvailabilityRouter availability={title.availability} />
            <p className="mt-3 text-[0.7rem] leading-relaxed text-fg-3">
              플랫폼을 가로질러 가격(무료·기다무·유료)을 비교합니다. 가장 저렴한 진입점을 위로
              정렬했어요.
            </p>
          </div>
          <PriceCompare availability={title.availability} />
        </aside>

        <div className="flex flex-col gap-6">
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="accent">{TYPE_LABEL[title.type]}</Badge>
              <Badge tone={title.status === "completed" ? "good" : title.status === "hiatus" ? "warn" : "neutral"}>
                {STATUS_LABEL[title.status]}
              </Badge>
              <Badge tone={title.ageRating === "19" ? "bad" : "neutral"}>{AGE_LABEL[title.ageRating]}</Badge>
              {title.updateDays && title.updateDays.length > 0 && (
                <Badge tone="cool">{title.updateDays.join("·")} 연재</Badge>
              )}
            </div>

            <h1 className="mt-3 text-pretty [word-break:keep-all] text-[clamp(1.6rem,6.5vw,1.875rem)] font-bold leading-tight tracking-tight sm:text-4xl">
              {title.title}
            </h1>
            {title.altTitles && title.altTitles.length > 0 && (
              <p className="mt-1.5 text-sm text-fg-3">{title.altTitles.join(" · ")}</p>
            )}
            <AuthorLine author={title.author} artist={title.artist} year={title.releaseYear} />
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-line bg-card p-5">
            <div className="flex items-center gap-3">
              <span className="numeral text-4xl text-accent">{reviewAvg.toFixed(1)}</span>
              <div>
                <div className="flex items-center gap-1.5">
                  <Stars value={reviewAvg} size="md" />
                  {estimated && <Badge tone="neutral">추정</Badge>}
                </div>
                <p className="mt-1 text-xs text-fg-3">
                  {estimated ? `약 ${formatCount(reviewCount)} 평가 (추정)` : `${formatCount(reviewCount)}개의 평가`}
                </p>
              </div>
            </div>
            <div className="ml-auto flex flex-wrap gap-1.5">
              {title.genres.map((genre) => (
                <GenreChip key={genre} genre={genre} />
              ))}
            </div>
          </div>

          {showSynopsis && title.synopsis && (
            <p className="text-pretty text-[0.95rem] leading-relaxed text-fg-2">{title.synopsis}</p>
          )}

          {title.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {title.tags.map((tag) => (
                <Link
                  key={tag}
                  href={`/explore?tags=${encodeURIComponent(tag)}`}
                  className="inline-flex items-center rounded-full border border-line bg-raised/50 px-2.5 py-1 text-xs text-fg-2 transition-colors hover:border-accent/50 hover:bg-accent-soft/40 hover:text-accent pointer-coarse:px-3 pointer-coarse:py-1.5"
                >
                  #{tag}
                </Link>
              ))}
            </div>
          )}

          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-4">
            {stats.map((item) => (
              <div key={item.label} className="flex flex-col gap-1 bg-card p-4">
                <dt className="flex items-center gap-1.5 text-xs text-fg-3">
                  <item.icon size={13} /> {item.label}
                </dt>
                <dd className="numeral text-xl text-fg">{item.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <section className="mt-10 sm:mt-14">
        <h2 className="eyebrow mb-1 text-accent">METRICS · 지표</h2>
        <p className="mb-4 text-xs text-fg-2">완독률·몰입·분포는 수집값과 추정값을 함께 사용합니다.</p>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-line bg-card p-5">
            <h3 className="mb-4 text-sm font-semibold text-fg">평점 분포</h3>
            <DistributionBars dist={title.stats.ratingDist} />
          </div>
          <div className="flex flex-col gap-4 rounded-2xl border border-line bg-card p-5">
            <h3 className="text-sm font-semibold text-fg">정주행 지표</h3>
            <MeterBar label="완독률" value={Math.round(title.stats.completionRate)} suffix="%" />
            <MeterBar label="몰입 지수" value={Math.round(title.stats.bingeIndex)} color="var(--color-cool)" />
            <MeterBar label="트렌드 점수" value={Math.round(title.stats.trendingScore)} color="var(--color-good)" />
            <div className="mt-1">
              <p className="mb-1.5 text-xs text-fg-3">장르 스펙트럼</p>
              <GenreSpectrum genres={title.genres} height={6} />
            </div>
          </div>
        </div>
      </section>

      <ScoreBreakdown title={title} className="mt-10 sm:mt-14" />

      {(hasFamily || hasExternalMedia) && (
        <Section
          className="mt-10 sm:mt-14"
          eyebrow="ADAPTATION"
          title="같은 이야기, 다른 형태"
          desc="원작·웹툰부터 드라마·영화·애니메이션까지, 하나의 우주로 연결했습니다."
        >
          <div className="rounded-2xl border border-line bg-card p-5">
            <div className="mb-4 flex items-center gap-2 text-fg-3">
              <Layers size={15} />
              <span className="eyebrow">{original.title} 유니버스</span>
            </div>
            <AdaptationGraph
              original={original}
              adaptations={adaptations}
              externalMedia={externalMedia}
              currentId={title.id}
            />
          </div>
        </Section>
      )}

      <TitleOst title={title} original={original} />

      <TitleExternal title={title} />

      <Section
        className="mt-10 sm:mt-14"
        eyebrow="COMMUNITY"
        title={`${title.title} 팬카페`}
        desc="작품 해석, 정주행 메모, 팬아트 아이디어를 독자들과 나눕니다."
      >
        <FanCafePanel scope="title" targetId={title.id} targetLabel={title.title} />
      </Section>

      <TitleFanWorks titleId={title.id} />

      <Section
        className="mt-10 sm:mt-14"
        eyebrow="REVIEWS"
        title={
          <span className="flex items-baseline gap-3">
            리뷰
            <span className="numeral text-lg text-fg-3">{reviews.length}</span>
            {reviews.length > 0 && (
              <span className="flex items-center gap-1.5 text-sm font-normal text-fg-3">
                <Stars value={reviewAvg} size="sm" /> {reviewAvg.toFixed(1)}
              </span>
            )}
          </span>
        }
      >
        <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr] lg:items-start">
          <div className="lg:sticky lg:top-20">
            <ReviewForm titleId={title.id} />
          </div>
          <div className="flex flex-col gap-3">
            {reviews.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-line bg-card/50 p-10 text-center">
                <p className="text-sm text-fg-2">아직 리뷰가 없어요.</p>
                <p className="mt-1 text-xs text-fg-3">첫 리뷰를 남기면 취향 분석에도 반영됩니다.</p>
              </div>
            ) : (
              reviews.map((review) => <ReviewCard key={review.id} review={review} enableReplies />)
            )}
          </div>
        </div>
      </Section>

      {byAuthor.length > 0 && (
        <Section
          className="mt-10 sm:mt-14"
          eyebrow="BY THIS AUTHOR"
          title={`${title.author}의 다른 작품`}
          desc="같은 작가가 그린·쓴 다른 작품"
        >
          <Rail>
            {byAuthor.map((item) => (
              <TitleCard key={item.id} title={item} />
            ))}
          </Rail>
        </Section>
      )}

      {similar.length > 0 && (
        <Section
          className="mt-10 sm:mt-14"
          eyebrow="SIMILAR"
          title="이 작품과 비슷한"
          desc="장르·태그·어댑테이션 관계로 찾은 추천"
        >
          <Rail>
            {similar.map((item) => (
              <TitleCard key={item.id} title={item} />
            ))}
          </Rail>
        </Section>
      )}
    </Container>
  );
}
