// 연재 시리즈 상세 — 회차 목록(episodeNo 순) + 첫화부터/최신화 보기 + 소유자 관리.
import {
  ArrowLeft,
  BookOpen,
  Eye,
  Heart,
  Layers,
  MessageCircle,
  Pencil,
  PenLine,
  Play,
  SkipForward,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { AuthorAvatar, SeriesForm } from "./creator-community-ui";
import { SERIES_STATUS_LABEL } from "./creator-community-utils";
import { buildStudioHref } from "./creator-studio-links";
import { confirmStudioDestructiveAction } from "./studio-destructive-action-preview";
import { studioDeleteSeriesRequest } from "./studio-destructive-command-catalog";
import { StudioDestructiveConfirmHost } from "./StudioDestructiveConfirmHost";

import { CoverImage } from "@/shared/components/cover-image";
import { Container } from "@/shared/components/section";
import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn, formatCount, relativeDate } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";
import { ErrorState } from "@/src/components/error-state";
import { NotFoundPage } from "@/src/components/NotFoundPage";
import { useDocumentTitle } from "@/src/hooks/use-document-title";
import { deleteSeries, getSeries, type SeriesDetail, type WorkSummary } from "@/src/infrastructure/creator-client";


// 회차 행 — 목록형(웹툰 회차 리스트 스타일).
function EpisodeRow({ episode }: { episode: WorkSummary }) {
  return (
    <Link
      href={`/create/${episode.id}`}
      className="group flex items-center gap-3 rounded-xl border border-line bg-card/50 px-3 py-2.5 transition-colors hover:border-line-strong hover:bg-card"
    >
      <span className="numeral w-10 shrink-0 text-center font-display text-lg font-bold text-accent">
        {episode.episodeNo != null ? episode.episodeNo : "—"}
      </span>
      <span className="relative aspect-[4/3] w-16 shrink-0 overflow-hidden rounded-lg bg-raised/40">
        <CoverImage
          src={episode.cover}
          alt=""
          className="h-full w-full object-cover"
          fallback={
            <span className="grid h-full w-full place-items-center text-fg-3">
              <PenLine size={14} />
            </span>
          }
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-fg group-hover:text-accent">
          {episode.title}
          {episode.status === "draft" && <span className="ml-1.5 text-[0.7rem] text-warn">(초안)</span>}
        </span>
        <span className="mt-0.5 block text-[0.72rem] text-fg-3">{relativeDate(episode.createdAt)}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2.5 text-[0.72rem] text-fg-3">
        <span className="inline-flex items-center gap-1">
          <Heart size={12} className={cn(episode.liked && "fill-accent text-accent")} />
          <span className="numeral">{formatCount(episode.likes)}</span>
        </span>
        <span className="hidden items-center gap-1 sm:inline-flex">
          <MessageCircle size={12} />
          <span className="numeral">{formatCount(episode.comments)}</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <Eye size={12} />
          <span className="numeral">{formatCount(episode.views)}</span>
        </span>
      </span>
    </Link>
  );
}

export function CreateSeriesPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [series, setSeries] = useState<SeriesDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useDocumentTitle(series ? `${series.title} · 연재 시리즈` : "연재 시리즈");

  useEffect(() => {
    if (!id) return;
    let alive = true;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setNotFound(false);
    getSeries(id, controller.signal)
      .then((result) => {
        if (alive) setSeries(result);
      })
      .catch((err: unknown) => {
        if (!alive || controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : "시리즈를 불러오지 못했습니다.";
        if (/\(404\)/.test(message)) setNotFound(true);
        else setError(message);
        setSeries(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [id, reloadKey]);

  async function onDelete() {
    if (!series || deleting) return;
    if (
      !(await confirmStudioDestructiveAction(
        studioDeleteSeriesRequest(series.title || "이 시리즈")
      ))
    ) return;
    setDeleting(true);
    setActionError(null);
    try {
      await deleteSeries(series.id);
      navigate("/create?tab=series", { replace: true });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "시리즈를 삭제하지 못했습니다.");
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <Container size="wide" className="py-10">
        <div className="skeleton mb-4 h-7 w-1/3" />
        <div className="flex gap-5">
          <span className="skeleton block aspect-[3/4] w-40 rounded-2xl" />
          <div className="flex-1 space-y-3 py-2">
            <span className="skeleton block h-6 w-1/2" />
            <span className="skeleton block h-4 w-2/3" />
            <span className="skeleton block h-4 w-1/3" />
          </div>
        </div>
      </Container>
    );
  }

  if (notFound || (!series && !error)) return <NotFoundPage />;

  if (error || !series) {
    return (
      <Container size="wide" className="py-10">
        <ErrorState
          title="시리즈를 불러오지 못했습니다."
          message={error}
          onRetry={() => setReloadKey((value) => value + 1)}
        />
      </Container>
    );
  }

  // 공개 회차 기준 첫화/최신화 — 목록은 episodeNo 오름차순.
  const published = series.episodeList.filter((episode) => episode.status === "published");
  const firstEpisode = published[0] ?? null;
  const latestEpisode = published.length > 0 ? published[published.length - 1] : null;

  return (
    <Container size="wide" className="py-8 lg:py-10">
      {/* 스튜디오 밖 라우트에도 승인 표면을 둔다 — 없으면 네이티브 confirm 으로 떨어진다. */}
      <StudioDestructiveConfirmHost />
      <Link
        href="/create?tab=series"
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-fg-3 transition-colors hover:text-fg"
      >
        <ArrowLeft size={15} />
        시리즈 목록
      </Link>

      <header className="overflow-hidden rounded-2xl border border-line bg-panel/45 p-5 surface-hl sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row">
          <div className="relative aspect-[3/4] w-36 shrink-0 overflow-hidden rounded-xl bg-raised/40 sm:w-44">
            <CoverImage
              src={series.cover}
              alt={series.title}
              className="h-full w-full object-cover"
              fallback={
                <span className="grid h-full w-full place-items-center bg-gradient-to-br from-raised to-card text-fg-3">
                  <BookOpen size={32} />
                </span>
              }
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[0.7rem] font-medium leading-none",
                  series.status === "completed"
                    ? "border-line bg-raised text-fg-2"
                    : "border-[color:oklch(0.8_0.15_150/0.3)] bg-[oklch(0.8_0.15_150/0.12)] text-good"
                )}
              >
                {SERIES_STATUS_LABEL[series.status]}
              </span>
              <span className="inline-flex items-center gap-1 text-xs text-fg-3">
                <Layers size={12} />
                <span className="numeral">{series.episodes}</span>화
              </span>
            </div>
            <h1 className="mt-2 text-pretty text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
              {series.title}
            </h1>
            <Link
              href={series.author.id ? `/u/${encodeURIComponent(series.author.id)}` : "/create"}
              className="mt-2.5 inline-flex items-center gap-2 text-sm text-fg-2 transition-colors hover:text-accent"
            >
              <AuthorAvatar name={series.author.name} avatar={series.author.avatar} size="sm" />
              {series.author.name}
            </Link>
            {series.description && (
              <p className="mt-3 whitespace-pre-wrap text-pretty text-sm leading-relaxed text-fg-2">
                {series.description}
              </p>
            )}
            {series.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {series.tags.map((tag) => (
                  <Link
                    key={tag}
                    href={`/create?tag=${encodeURIComponent(tag)}`}
                    className="inline-flex h-7 items-center rounded-full border border-line bg-card px-2.5 text-[0.72rem] text-fg-2 transition-colors hover:border-accent/50 hover:text-accent"
                  >
                    #{tag}
                  </Link>
                ))}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-fg-3">
              <span className="inline-flex items-center gap-1">
                <Eye size={13} />
                <span className="numeral">{formatCount(series.views)}</span> 조회
              </span>
              <span className="inline-flex items-center gap-1">
                <Heart size={13} />
                <span className="numeral">{formatCount(series.likes)}</span> 좋아요
              </span>
              {series.latestEpisodeAt && <span>{relativeDate(series.latestEpisodeAt)} 갱신</span>}
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
              {firstEpisode && (
                <Link
                  href={`/create/${firstEpisode.id}`}
                  className={buttonClass({ size: "sm", variant: "solid", className: "gap-1.5" })}
                >
                  <Play size={14} />
                  첫화부터 보기
                </Link>
              )}
              {latestEpisode && latestEpisode.id !== firstEpisode?.id && (
                <Link
                  href={`/create/${latestEpisode.id}`}
                  className={buttonClass({ size: "sm", variant: "outline", className: "gap-1.5" })}
                >
                  <SkipForward size={14} />
                  최신화 보기
                </Link>
              )}
              {series.isOwner && (
                <Link
                  href={buildStudioHref({ seriesId: series.id })}
                  className={buttonClass({ size: "sm", variant: "solid", className: "gap-1.5" })}
                >
                  <PenLine size={14} />
                  다음화 만들기
                </Link>
              )}
              {series.isOwner && (
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing((value) => !value)}
                    className={buttonClass({ size: "sm", variant: "quiet", className: "gap-1.5" })}
                  >
                    <Pencil size={14} />
                    정보 수정
                  </button>
                  <button
                    type="button"
                    onClick={onDelete}
                    disabled={deleting}
                    className={buttonClass({
                      size: "sm",
                      variant: "quiet",
                      className: "gap-1.5 text-bad hover:text-bad",
                    })}
                  >
                    <Trash2 size={14} />
                    삭제
                  </button>
                </div>
              )}
            </div>
            {actionError && <p className="mt-2 text-xs text-bad">{actionError}</p>}
          </div>
        </div>

        {editing && series.isOwner && (
          <div className="mt-5 border-t border-line pt-5">
            <SeriesForm
              initial={series}
              onSaved={(saved) => {
                setEditing(false);
                setSeries((current) => (current ? { ...current, ...saved } : current));
              }}
              onCancel={() => setEditing(false)}
            />
          </div>
        )}
      </header>

      <section className="mt-7">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-fg">
          <Layers size={15} className="text-accent" />
          회차 목록
          <span className="numeral text-fg-3">{series.episodeList.length}</span>
        </h2>
        {series.episodeList.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-line bg-card/40 p-10 text-center">
            <PenLine size={24} className="mx-auto mb-2.5 text-fg-3" />
            <p className="text-sm font-medium text-fg">아직 등록된 회차가 없습니다.</p>
            <p className="mt-1 text-xs text-fg-3">
              {series.isOwner
                ? "‘다음화 만들기’를 누르면 이 시리즈에 자동 연결된 상태로 스튜디오가 열립니다."
                : "창작자가 첫 회차를 준비 중입니다."}
            </p>
            {series.isOwner && (
              <Link
                href={buildStudioHref({ seriesId: series.id })}
                className={buttonClass({ size: "sm", variant: "outline", className: "mt-4 gap-1.5" })}
              >
                <PenLine size={14} />
                1화 만들기
              </Link>
            )}
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {series.episodeList.map((episode) => (
              <EpisodeRow key={episode.id} episode={episode} />
            ))}
          </div>
        )}
      </section>
    </Container>
  );
}
