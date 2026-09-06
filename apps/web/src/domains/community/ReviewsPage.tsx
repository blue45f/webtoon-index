import { RefreshCw } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { ReviewControls } from "./reviews-components/review-controls";


import type { ReviewSort, ReviewsResponse } from "@/shared/lib/types";

import { CoverImage } from "@/shared/components/cover-image";
import { ReviewCard } from "@/shared/components/review-card";
import { Container } from "@/shared/components/section";
import { buttonClass } from "@/shared/components/ui/button-utils";
import { Stars } from "@/shared/components/ui/stars";
import { spectrumGradient } from "@/shared/lib/genre-color";
import Link from "@/src/compat/router-link";
import { ErrorState } from "@/src/components/error-state";
import { useApiResource } from "@/src/infrastructure/use-api-resource";



export function ReviewsPage() {
  const [searchParams] = useSearchParams();
  const sort = ((searchParams.get("sort") as ReviewSort | null) ?? "recent") as ReviewSort;
  const spoiler = searchParams.get("spoiler");
  const rating = searchParams.get("rating");
  const params = new URLSearchParams({ sort });
  if (spoiler) params.set("spoiler", spoiler);
  if (rating) params.set("rating", rating);
  const { data, loading, error, reload } = useApiResource<ReviewsResponse>(
    `/api/reviews?${params.toString()}`,
    "리뷰 데이터를 불러오지 못했습니다."
  );
  const feed = data?.feed ?? [];
  const topReviewed = data?.topReviewed ?? [];
  const total = data?.stats.total ?? 0;
  const avg = data?.stats.avg ?? 0;
  const spoilerPct = data?.stats.spoilerPct ?? 0;
  const distinctTitles = data?.stats.distinctTitles ?? 0;

  return (
    <div>
      <section className="border-b border-line bg-ledger">
        <Container size="wide" className="py-7 sm:py-12 lg:py-16">
          <p className="eyebrow text-accent">READER REVIEWS</p>
          <h1 className="mt-2.5 text-pretty text-3xl font-bold leading-[1.1] sm:mt-3 sm:text-4xl lg:text-[2.9rem]">
            독자들이 남긴 한 줄
          </h1>
          <p className="mt-3 max-w-xl text-pretty font-serif text-base italic leading-relaxed text-fg-2 sm:mt-4 sm:text-lg">
            정주행의 끝에서, 누군가는 별점 대신 문장을 남겼다.
          </p>

          <dl className="mt-6 flex flex-wrap items-end gap-x-9 gap-y-5 border-t border-line pt-5 sm:mt-9 sm:pt-6">
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-fg-3">총 리뷰</dt>
              <dd className="numeral tnum text-2xl text-fg">{total.toLocaleString("ko-KR")}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-fg-3">평균 별점</dt>
              <dd className="flex items-center gap-2">
                <Stars value={avg} size="sm" />
                <span className="numeral tnum text-2xl text-fg">{avg.toFixed(2)}</span>
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-fg-3">스포일러 포함</dt>
              <dd className="numeral tnum text-2xl text-fg">
                {spoilerPct}
                <span className="ml-0.5 text-base text-fg-3">%</span>
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-fg-3">리뷰된 작품</dt>
              <dd className="numeral tnum text-2xl text-fg">{distinctTitles.toLocaleString("ko-KR")}</dd>
            </div>
          </dl>
        </Container>
      </section>

      <Container size="wide" className="py-10 lg:py-12">
        <div className="grid gap-8 lg:grid-cols-[1fr_268px] lg:items-start">
          <div className="min-w-0 lg:order-1">
            <div className="mb-6 rail -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <ReviewControls />
            </div>

            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-fg-3">
                <span className="numeral text-fg-2">{feed.length.toLocaleString("ko-KR")}</span>개의 리뷰
              </p>
              <button
                type="button"
                onClick={reload}
                className={buttonClass({ size: "sm", variant: "quiet", className: "gap-1.5" })}
              >
                <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                갱신
              </button>
            </div>

            {loading ? (
              <div className="columns-1 gap-4 sm:columns-2 xl:columns-3 [&>*]:mb-4 [&>*]:break-inside-avoid">
                {Array.from({ length: 9 }).map((_, index) => (
                  <div key={index} className="rounded-2xl border border-line bg-card p-5">
                    <div className="mb-4 flex items-center gap-3">
                      <span className="skeleton size-9 rounded-full" />
                      <span className="flex-1 space-y-2">
                        <span className="skeleton block h-3 w-28" />
                        <span className="skeleton block h-3 w-16" />
                      </span>
                    </div>
                    <span className="skeleton mb-2 block h-4 w-full" />
                    <span className="skeleton mb-2 block h-4 w-5/6" />
                    <span className="skeleton block h-4 w-2/3" />
                  </div>
                ))}
              </div>
            ) : error ? (
              <ErrorState title="리뷰 데이터를 불러오지 못했습니다." message={error} onRetry={reload} />
            ) : feed.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-line bg-card/40 p-12 text-center text-sm text-fg-3">
                아직 등록된 리뷰가 없습니다. 리뷰가 작성되면 바로 이 피드에 반영됩니다.
              </div>
            ) : (
              <div className="columns-1 gap-4 sm:columns-2 lg:columns-2 xl:columns-3 [&>*]:mb-4 [&>*]:break-inside-avoid">
                {feed.map((review) => (
                  <ReviewCard key={review.id} review={review} title={review.title} showTitle />
                ))}
              </div>
            )}
          </div>

          <aside className="lg:sticky lg:top-20 lg:order-2">
            <div className="rounded-2xl border border-line bg-card p-5 surface-hl">
              <p className="eyebrow text-accent">MOST REVIEWED</p>
              <h2 className="mt-1.5 text-base font-bold tracking-tight text-fg">가장 많이 리뷰된 작품</h2>
              <p className="mt-1 text-xs text-fg-3">독자들이 가장 많이 입을 연 다섯 작품</p>

              <ol className="mt-5 flex flex-col gap-1">
                {topReviewed.length === 0 && (
                  <li className="rounded-xl border border-dashed border-line bg-raised/30 px-3 py-5 text-center text-xs text-fg-3">
                    아직 집계된 리뷰가 없습니다.
                  </li>
                )}
                {topReviewed.map((item, index) => (
                  <li key={item.title.id}>
                    <Link
                      href={`/title/${item.title.slug}`}
                      className="group flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-raised/60"
                    >
                      <span className="numeral w-5 shrink-0 text-center text-lg text-fg-3 group-hover:text-accent">
                        {index + 1}
                      </span>
                      <span className="size-9 shrink-0 overflow-hidden rounded-lg ring-1 ring-line">
                        {item.title.coverImage ? (
                          <CoverImage
                            src={item.title.coverImage}
                            alt=""
                            className="h-full w-full object-cover"
                            fallback={
                              <span
                                className="block h-full w-full"
                                style={{ background: `linear-gradient(140deg, ${item.title.cover[0]}, ${item.title.cover[1]})` }}
                              />
                            }
                          />
                        ) : (
                          <span
                            className="block h-full w-full"
                            style={{ background: `linear-gradient(140deg, ${item.title.cover[0]}, ${item.title.cover[1]})` }}
                            aria-hidden
                          />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-fg-2 transition-colors group-hover:text-fg">
                          {item.title.title}
                        </span>
                        <span className="block truncate text-xs text-fg-3">{item.title.genres.slice(0, 2).join(" · ")}</span>
                      </span>
                      <span className="flex shrink-0 items-baseline gap-0.5 text-fg-3">
                        <span className="numeral tnum text-sm text-fg-2">{item.count}</span>
                        <span className="text-[0.7rem]">개</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>

              <div
                className="mt-5 h-1 w-full rounded-full"
                style={{ background: spectrumGradient(topReviewed.flatMap((item) => item.title.genres.slice(0, 1))) }}
                aria-hidden
              />
            </div>
          </aside>
        </div>
      </Container>
    </div>
  );
}
