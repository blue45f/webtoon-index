// 창작 커뮤니티 공용 UI — 작품 카드(시리즈/챌린지 배지), 시리즈 카드, 시리즈 폼, 아바타.
// CreateGalleryPage · CreateSeriesPage · CreateChallengesPage · UserProfilePage 에서 재사용한다.
import { BookOpen, Eye, Heart, Layers, MessageCircle, PenLine, Trophy } from "lucide-react";
import { useState } from "react";

import { FORMAT_LABEL, SERIES_STATUS_LABEL } from "./creator-community-utils";

import { CoverImage } from "@/shared/components/cover-image";
import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn, formatCount, relativeDate } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";
import {
  createSeries,
  updateSeries,
  type SeriesInput,
  type SeriesStatus,
  type SeriesSummary,
  type WorkSummary,
} from "@/src/infrastructure/creator-client";


// 아바타 컬러 hex → 그라디언트 원형 + 이니셜 (review-card 패턴 재사용)
export function AuthorAvatar({
  name,
  avatar,
  size = "sm",
  className,
}: {
  name: string;
  avatar: string;
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  // 이니셜은 장식(aria-hidden)이고 인접 닉네임 텍스트가 항상 함께 표기된다.
  const sizes = { xs: "size-4 text-[0.55rem]", sm: "size-6 text-[0.7rem]", md: "size-9 text-sm" }; // a11y-exempt: 장식 이니셜

  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-bold text-[oklch(0.97_0.012_85)] ring-1 ring-[oklch(0.95_0.01_85/0.14)]",
        sizes[size],
        className
      )}
      style={{ background: `linear-gradient(140deg, ${avatar || "#7c5cfc"}, oklch(0.3 0.05 60))` }}
    >
      {(name || "익").charAt(0)}
    </span>
  );
}

// 작품 카드 — 갤러리/프로필/챌린지/팔로잉 피드 공용. 시리즈·챌린지 배지 표시.
// 모바일 2열 그리드 친화: 호버=리프트+테두리 강조, 탭=눌림 스프링(active:scale). sheen 으로 프리미엄 질감.
export function WorkCard({ work, showAuthor = true }: { work: WorkSummary; showAuthor?: boolean }) {
  return (
    <Link
      href={`/create/${work.id}`}
      className="sheen-sweep group flex flex-col overflow-hidden rounded-2xl border border-line bg-panel/30 transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-lg hover:shadow-black/25 active:scale-[0.98]"
    >
      <div className="relative aspect-[3/4] overflow-hidden bg-raised/40">
        <CoverImage
          src={work.cover}
          alt={work.title}
          className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.05]"
          fallback={
            <span className="grid h-full w-full place-items-center bg-gradient-to-br from-raised to-card text-fg-3">
              <PenLine size={28} />
            </span>
          }
        />
        {/* 하단 그라데이션 — 배지·썸 가독성 보강(저작 이미지 위 텍스트 대비). */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[oklch(0.14_0.01_70/0.55)] to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        />
        <span className="absolute left-2 top-2 inline-flex items-center rounded-full border border-line/60 bg-[oklch(0.16_0.01_70/0.7)] px-2 py-0.5 text-[0.72rem] font-medium text-fg-2 backdrop-blur-md">
          {FORMAT_LABEL[work.format]}
        </span>
        {/* 시리즈 회차 배지 */}
        {work.seriesId && (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full border border-cool/40 bg-[oklch(0.16_0.01_70/0.75)] px-2 py-0.5 text-[0.72rem] font-medium text-cool backdrop-blur-md">
            <Layers size={10} />
            {work.episodeNo != null ? `${work.episodeNo}화` : "시리즈"}
          </span>
        )}
        {/* 챌린지 참여 배지 */}
        {work.challengeId && (
          <span className="absolute bottom-2 left-2 inline-flex max-w-[calc(100%-1rem)] items-center gap-1 truncate rounded-full border border-accent/45 bg-[oklch(0.16_0.01_70/0.78)] px-2 py-0.5 text-[0.72rem] font-medium text-accent backdrop-blur-md">
            <Trophy size={10} className="shrink-0" />
            <span className="truncate">{work.challengeTitle ?? "챌린지"}</span>
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <h3 className="line-clamp-2 text-sm font-semibold leading-tight text-fg transition-colors duration-150 group-hover:text-accent">
          {work.seriesTitle ? `${work.seriesTitle} · ` : ""}
          {work.title}
        </h3>
        {showAuthor && (
          <div className="flex items-center gap-1.5 text-xs text-fg-3">
            <AuthorAvatar name={work.author.name} avatar={work.author.avatar} size="xs" />
            <span className="truncate">{work.author.name}</span>
          </div>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1.5 text-[0.72rem] text-fg-3">
          <span className="inline-flex items-center gap-1">
            <Heart size={12} className={cn(work.liked && "fill-accent text-accent")} />
            <span className="numeral">{formatCount(work.likes)}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <MessageCircle size={12} />
            <span className="numeral">{formatCount(work.comments)}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <Eye size={12} />
            <span className="numeral">{formatCount(work.views)}</span>
          </span>
          <span className="ml-auto shrink-0">{relativeDate(work.createdAt)}</span>
        </div>
      </div>
    </Link>
  );
}

// 작품 그리드 스켈레톤(공용)
export function WorkGridSkeleton({ count = 10 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="overflow-hidden rounded-2xl border border-line bg-panel/30">
          <span className="skeleton block aspect-[3/4]" />
          <div className="space-y-2 p-3">
            <span className="skeleton block h-4 w-full" />
            <span className="skeleton block h-3 w-2/3" />
            <span className="skeleton block h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

// 시리즈 카드 — 회차 수·총 조회·최신 회차 갱신일 + 연재 상태.
export function SeriesCard({ series }: { series: SeriesSummary }) {
  return (
    <Link
      href={`/create/series/${series.id}`}
      className="group flex gap-3.5 overflow-hidden rounded-2xl border border-line bg-panel/30 p-3 transition-colors hover:border-line-strong"
    >
      <div className="relative aspect-[3/4] w-24 shrink-0 overflow-hidden rounded-xl bg-raised/40 sm:w-28">
        <CoverImage
          src={series.cover}
          alt={series.title}
          className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
          fallback={
            <span className="grid h-full w-full place-items-center bg-gradient-to-br from-raised to-card text-fg-3">
              <BookOpen size={24} />
            </span>
          }
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col py-0.5">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[0.72rem] font-medium leading-none",
              series.status === "completed"
                ? "border-line bg-raised text-fg-2"
                : "border-[color:oklch(0.8_0.15_150/0.3)] bg-[oklch(0.8_0.15_150/0.12)] text-good"
            )}
          >
            {SERIES_STATUS_LABEL[series.status]}
          </span>
          <span className="numeral text-[0.7rem] text-fg-3">{series.episodes}화</span>
        </div>
        <h3 className="mt-1.5 line-clamp-1 text-sm font-semibold text-fg group-hover:text-accent">{series.title}</h3>
        {series.description && (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-fg-3">{series.description}</p>
        )}
        <div className="mt-auto flex items-center gap-1.5 pt-2 text-xs text-fg-3">
          <AuthorAvatar name={series.author.name} avatar={series.author.avatar} size="xs" />
          <span className="truncate">{series.author.name}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.72rem] text-fg-3">
          <span className="inline-flex items-center gap-1">
            <Eye size={12} />
            <span className="numeral">{formatCount(series.views)}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <Heart size={12} />
            <span className="numeral">{formatCount(series.likes)}</span>
          </span>
          {series.latestEpisodeAt && <span className="ml-auto">{relativeDate(series.latestEpisodeAt)} 갱신</span>}
        </div>
      </div>
    </Link>
  );
}

// 시리즈 생성/수정 인라인 폼 — FeedbackPage 인라인 폼 패턴.
export function SeriesForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: SeriesSummary | null;
  onSaved: (series: SeriesSummary) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [tagsText, setTagsText] = useState((initial?.tags ?? []).join(", "));
  const [status, setStatus] = useState<SeriesStatus>(initial?.status ?? "ongoing");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    const input: SeriesInput = {
      title: title.trim(),
      description,
      tags: tagsText.split(/[,\n]/).map((t) => t.trim()).filter(Boolean),
      status,
    };
    try {
      const saved = initial ? await updateSeries(initial.id, input) : await createSeries(input);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "시리즈를 저장하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-card/60 p-4">
      <p className="text-sm font-bold text-fg">{initial ? "시리즈 정보 수정" : "새 연재 시리즈"}</p>
      <div className="mt-3 flex flex-col gap-2.5">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value.slice(0, 80))}
          aria-label="시리즈 제목"
          placeholder="시리즈 제목 (예: 야자 끝나고 옥상에서)"
          className="w-full rounded-lg border border-line bg-canvas px-2.5 py-2 text-sm text-fg placeholder:text-fg-3 focus:border-accent/50"
        />
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value.slice(0, 2000))}
          aria-label="시리즈 소개"
          placeholder="어떤 이야기인지 소개해 주세요."
          rows={3}
          className="w-full resize-y rounded-lg border border-line bg-canvas px-2.5 py-2 text-sm text-fg placeholder:text-fg-3 focus:border-accent/50"
        />
        <input
          value={tagsText}
          onChange={(event) => setTagsText(event.target.value.slice(0, 200))}
          aria-label="시리즈 태그 (쉼표로 구분)"
          placeholder="태그 (쉼표로 구분, 최대 8개)"
          className="w-full rounded-lg border border-line bg-canvas px-2.5 py-2 text-sm text-fg placeholder:text-fg-3 focus:border-accent/50"
        />
        <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="연재 상태">
          {(["ongoing", "completed"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={status === value}
              onClick={() => setStatus(value)}
              className={cn(
                "inline-flex h-8 items-center rounded-full border px-3 text-[0.8125rem] transition-colors",
                status === value
                  ? "border-accent/60 bg-accent-soft/55 text-fg"
                  : "border-line bg-card text-fg-2 hover:bg-raised"
              )}
            >
              {SERIES_STATUS_LABEL[value]}
            </button>
          ))}
        </div>
        {error && <p className="text-xs text-bad">{error}</p>}
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onCancel} className={buttonClass({ size: "sm", variant: "quiet" })}>
            취소
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!title.trim() || submitting}
            className={buttonClass({ size: "sm", variant: "solid" })}
          >
            {initial ? "저장" : "시리즈 만들기"}
          </button>
        </div>
      </div>
    </div>
  );
}
