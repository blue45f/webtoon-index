import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Eye,
  Heart,
  Layers,
  Link2,
  MessageCircle,
  Pencil,
  Send,
  Settings2,
  Trash2,
  Trophy,
  WandSparkles,
} from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { STUDIO_RASTER_ASSETS } from "./render/studio-raster-assets";
import { BUBBLE_VARIANTS } from "./studio-assets";
import { confirmStudioDestructiveAction } from "./studio-destructive-action-preview";
import { studioDeleteWorkRequest } from "./studio-destructive-command-catalog";
import { readWorkFx } from "./studio-motion-fx";
import { StudioDestructiveConfirmHost } from "./StudioDestructiveConfirmHost";
import { WebtoonFxPlayer } from "./WebtoonFxPlayer";
import { WorkFxPanel } from "./WorkFxPanel";

import { CoverImage } from "@/shared/components/cover-image";
import { Container } from "@/shared/components/section";
import { buttonClass } from "@/shared/components/ui/button-utils";
import { useApp } from "@/shared/lib/store";
import { cn, formatCount, relativeDate } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";
import { ErrorState } from "@/src/components/error-state";
import { NotFoundPage } from "@/src/components/NotFoundPage";
import { useDocumentTitle } from "@/src/hooks/use-document-title";
import {
  deleteWork,
  getWork,
  listChallenges,
  listComments,
  listSeries,
  postComment,
  toggleWorkLike,
  updateWork,
  type ChallengeSummary,
  type SeriesSummary,
  type WorkComment,
  type WorkDetail,
} from "@/src/infrastructure/creator-client";

const MAX_COMMENT_LENGTH = 700;
const BUBBLE_LABEL_BY_ID: ReadonlyMap<string, string> = new Map(
  BUBBLE_VARIANTS.map((variant) => [variant.id, variant.label] as const)
);
const RASTER_ASSET_LABEL_BY_ID: ReadonlyMap<string, string> = new Map(
  STUDIO_RASTER_ASSETS.map((asset) => [asset.id, asset.label] as const)
);

// 모션툰 영상(WebM) 내보내기 패널 — 작성자에게만 보이므로 녹화 엔진 청크를 지연 로드한다.
const StudioMotionExportPanel = lazy(() =>
  import("./StudioMotionExportPanel").then((mod) => ({ default: mod.StudioMotionExportPanel }))
);

// ── 연재·챌린지 설정(작성자 전용) — StudioPage를 건드리지 않는 추가 게시 설정 패널 ──
function WorkCommunityPanel({
  work,
  onUpdated,
}: {
  work: WorkDetail;
  onUpdated: (patch: Partial<WorkDetail>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mySeries, setMySeries] = useState<SeriesSummary[]>([]);
  const [challenges, setChallenges] = useState<ChallengeSummary[]>([]);
  const [seriesId, setSeriesId] = useState(work.seriesId ?? "");
  const [challengeId, setChallengeId] = useState(work.challengeId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userId = useApp((s) => s.userId);

  // 패널을 열 때 내 시리즈 + 진행중 챌린지 목록 로드.
  useEffect(() => {
    if (!open || !userId) return;
    let alive = true;
    const controller = new AbortController();
    listSeries({ userId }, controller.signal)
      .then((result) => {
        if (alive) setMySeries(result.filter((s) => s.isOwner));
      })
      .catch(() => {
        if (alive) setMySeries([]);
      });
    listChallenges(controller.signal)
      .then((result) => {
        if (alive) setChallenges(result.filter((c) => c.state === "ongoing"));
      })
      .catch(() => {
        if (alive) setChallenges([]);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [open, userId]);

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await updateWork(work.id, {
        seriesId: seriesId || null,
        challengeId: challengeId || null,
        ...(work.revision ? { baseRevision: work.revision } : {}),
      });
      onUpdated({
        seriesId: saved.seriesId ?? null,
        episodeNo: saved.episodeNo ?? null,
        seriesTitle: saved.seriesTitle ?? null,
        challengeId: saved.challengeId ?? null,
        challengeTitle: saved.challengeTitle ?? null,
        revision: saved.revision ?? work.revision,
      });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "설정을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-line bg-card/50">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium text-fg-2 transition-colors hover:text-fg"
      >
        <Settings2 size={13} className="text-accent" />
        연재·챌린지 설정
        <span className="ml-auto text-[0.7rem] text-fg-3">
          {work.seriesTitle ? `시리즈: ${work.seriesTitle}` : "시리즈 미연결"}
          {" · "}
          {work.challengeTitle ? `챌린지: ${work.challengeTitle}` : "챌린지 미참여"}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-2.5 border-t border-line px-3.5 py-3">
          <label className="flex flex-col gap-1 text-xs text-fg-2">
            연재 시리즈 (선택 시 회차 번호 자동 부여)
            <select
              value={seriesId}
              onChange={(event) => setSeriesId(event.target.value)}
              className="h-9 rounded-lg border border-line bg-canvas px-2 text-sm text-fg focus:border-accent/50"
            >
              <option value="">시리즈에 연결하지 않음</option>
              {mySeries.map((series) => (
                <option key={series.id} value={series.id}>
                  {series.title} ({series.episodes}화)
                </option>
              ))}
            </select>
          </label>
          {mySeries.length === 0 && (
            <p className="text-[0.7rem] text-fg-3">
              아직 만든 시리즈가 없어요.{" "}
              <Link href="/create?tab=series" className="text-accent hover:underline">
                창작 게시판 시리즈 탭
              </Link>
              에서 새 시리즈를 만들 수 있습니다.
            </p>
          )}
          <label className="flex flex-col gap-1 text-xs text-fg-2">
            창작 챌린지 참여
            <select
              value={challengeId}
              onChange={(event) => setChallengeId(event.target.value)}
              className="h-9 rounded-lg border border-line bg-canvas px-2 text-sm text-fg focus:border-accent/50"
            >
              <option value="">챌린지에 참여하지 않음</option>
              {/* 이미 연결된(종료됐을 수도 있는) 챌린지는 유지 옵션으로 노출 */}
              {work.challengeId && !challenges.some((c) => c.id === work.challengeId) && (
                <option value={work.challengeId}>{work.challengeTitle ?? "현재 참여 중인 챌린지"}</option>
              )}
              {challenges.map((challenge) => (
                <option key={challenge.id} value={challenge.id}>
                  {challenge.title}
                </option>
              ))}
            </select>
          </label>
          {error && <p className="text-xs text-bad">{error}</p>}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className={buttonClass({ size: "sm", variant: "solid" })}
            >
              설정 저장
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function WorkComments({ workId }: { workId: string }) {
  const userId = useApp((s) => s.userId);
  const [comments, setComments] = useState<WorkComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    listComments(workId, controller.signal)
      .then((result) => {
        if (alive) setComments(result);
      })
      .catch((err: unknown) => {
        if (!alive || controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "댓글을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [workId]);

  async function submit() {
    const text = draft.trim();
    if (!text || !userId || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await postComment(workId, text);
      setComments((current) => [...current, created]);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "댓글을 등록하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-panel/30 p-4 sm:p-5">
      <h2 className="flex items-center gap-1.5 text-sm font-bold text-fg">
        <MessageCircle size={15} className="text-accent" />
        댓글
        <span className="numeral text-fg-3">{comments.length}</span>
      </h2>

      {userId ? (
        <div className="mt-3 flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, MAX_COMMENT_LENGTH))}
            placeholder="응원의 한마디를 남겨 보세요."
            aria-label="댓글 입력"
            rows={3}
            className="w-full resize-y rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-fg transition-colors placeholder:text-fg-3 focus:border-accent/50"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="numeral text-[0.7rem] text-fg-3">
              {draft.length}/{MAX_COMMENT_LENGTH}
            </span>
            <button
              type="button"
              onClick={submit}
              disabled={!draft.trim() || submitting}
              className={buttonClass({ size: "sm", variant: "solid", className: "gap-1.5" })}
            >
              <Send size={14} />
              등록
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-3 rounded-xl border border-dashed border-line bg-card/40 px-3 py-3 text-center text-xs text-fg-3">
          댓글을 남기려면 로그인해 주세요.
        </p>
      )}

      {error && <p className="mt-3 text-xs text-bad">{error}</p>}

      <div className="mt-4 flex flex-col gap-3">
        {loading ? (
          Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="flex gap-2.5">
              <span className="skeleton size-8 shrink-0 rounded-full" />
              <span className="flex-1 space-y-2 py-0.5">
                <span className="skeleton block h-3 w-24" />
                <span className="skeleton block h-3 w-full" />
              </span>
            </div>
          ))
        ) : comments.length === 0 ? (
          <p className="py-6 text-center text-xs text-fg-3">아직 댓글이 없습니다. 첫 댓글을 남겨 보세요.</p>
        ) : (
          comments.map((comment) => (
            <div key={comment.id} className="flex gap-2.5">
              <span className="size-8 shrink-0 overflow-hidden rounded-full bg-raised ring-1 ring-line">
                {comment.author.avatar ? (
                  <CoverImage
                    src={comment.author.avatar}
                    alt=""
                    className="h-full w-full object-cover"
                    fallback={<span className="block h-full w-full bg-raised" />}
                  />
                ) : (
                  <span className="block h-full w-full bg-raised" aria-hidden />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-sm font-medium text-fg">{comment.author.name}</span>
                  <span className="shrink-0 text-[0.7rem] text-fg-3">{relativeDate(comment.createdAt)}</span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-fg-2">{comment.text}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

interface ElNode {
  id: string;
  type: string;
  name: string;
  details?: string;
  opacity?: number;
  hidden?: boolean;
  builtinRasterAssetId?: string;
}

interface StudioElement {
  id: string;
  type: string;
  variant?: string;
  text?: string;
  src?: string;
  points?: number[];
  stroke?: string;
  width?: number;
  height?: number;
  bg?: string;
  bgColor?: string;
  lineCount?: number;
  opacity?: number;
  hidden?: boolean;
  builtinRasterAssetId?: string;
}

interface StudioDoc {
  pagesList?: { elements?: StudioElement[] }[];
  elements?: StudioElement[];
}

function parseLayersFromDoc(doc: unknown): { pageIndex: number; layers: ElNode[] }[] {
  if (!doc || typeof doc !== "object") return [];
  const studioDoc = doc as StudioDoc;
  const pagesList = studioDoc.pagesList;
  if (!pagesList || !Array.isArray(pagesList)) {
    if (studioDoc.elements && Array.isArray(studioDoc.elements)) {
      return [{ pageIndex: 1, layers: mapElementsToNodes(studioDoc.elements) }];
    }
    return [];
  }
  return pagesList.map((page, index: number) => ({
    pageIndex: index + 1,
    layers: mapElementsToNodes(page?.elements ?? []),
  }));
}

function mapElementsToNodes(elements: StudioElement[]): ElNode[] {
  return elements.map((el) => {
    let name = "레이어";
    let details = "";
    if (el.type === "bubble") {
      name = `${BUBBLE_LABEL_BY_ID.get(el.variant ?? "") ?? "대사"} 말풍선`;
      details = el.text ? `"${el.text.slice(0, 30)}${el.text.length > 30 ? "..." : ""}"` : "(비어 있음)";
    } else if (el.type === "text") {
      name = "텍스트 레이어";
      details = el.text ? `"${el.text.slice(0, 30)}${el.text.length > 30 ? "..." : ""}"` : "(비어 있음)";
    } else if (el.type === "image") {
      name = el.builtinRasterAssetId
        ? RASTER_ASSET_LABEL_BY_ID.get(el.builtinRasterAssetId) ?? "번들 장면 소품"
        : el.src && el.src.startsWith("data:")
          ? "3D 캐릭터 렌더"
          : "배경 / 스튜디오 이미지";
      details = el.src && !el.src.startsWith("data:") ? el.src.split("/").pop() || "" : "";
    } else if (el.type === "sticker") {
      name = "소품 / 스티커";
      details = el.text || "";
    } else if (el.type === "draw") {
      name = `자유 드로잉 (${el.points ? Math.floor(el.points.length / 2) : 0} 획)`;
      details = el.stroke || "";
    } else if (el.type === "frame") {
      name = `컷 프레임 (${el.width}x${el.height})`;
      details = el.bg || el.bgColor || "투명";
    } else if (el.type === "focusLines") {
      name = "효과선 (집중선)";
      details = `${el.lineCount}개 선`;
    } else if (el.type === "speedLines") {
      name = "효과선 (속도선)";
      details = `${el.lineCount}개 선`;
    }

    return {
      id: el.id,
      type: el.type,
      name,
      details,
      opacity: el.opacity,
      hidden: el.hidden,
    };
  });
}

function WorkInspector({ doc }: { doc: unknown }) {
  const [open, setOpen] = useState(false);
  const pages = parseLayersFromDoc(doc);
  const totalLayers = pages.reduce((sum, p) => sum + p.layers.length, 0);

  if (totalLayers === 0) return null;

  return (
    <section className="mt-6 rounded-2xl border border-line bg-panel/30 p-4 sm:p-5">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex w-full items-center justify-between font-bold text-sm text-fg"
      >
        <span className="flex items-center gap-1.5">
          <Layers size={15} className="text-accent" />
          개체/레이어 탐색기 (Inspector)
          <span className="numeral text-fg-3">{totalLayers}개 요소</span>
        </span>
        <span className="text-xs text-accent hover:underline">
          {open ? "닫기" : "레이어 트리 열기"}
        </span>
      </button>

      {open && (
        <div className="mt-4 max-h-96 overflow-y-auto rounded-xl border border-line bg-card/60 p-3 space-y-4 font-mono text-[0.72rem] leading-relaxed">
          {pages.map((p) => (
            <div key={p.pageIndex} className="space-y-1.5">
              <h4 className="font-semibold text-fg-2 border-b border-line pb-1 mb-2 border-solid">
                Page {p.pageIndex}
              </h4>
              {p.layers.length === 0 ? (
                <p className="text-fg-3 italic pl-3">이 페이지에는 개체가 없습니다.</p>
              ) : (
                <div className="pl-2 space-y-1">
                  {p.layers.map((layer) => (
                    <div
                      key={layer.id}
                      className={cn(
                        "flex items-center justify-between rounded px-2.5 py-1.5 bg-canvas/30 hover:bg-canvas/60 border border-transparent hover:border-line border-solid transition-colors",
                        layer.hidden && "opacity-50"
                      )}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className="text-accent font-bold">[{layer.type.toUpperCase()}]</span>
                        <span className="text-fg font-medium truncate">{layer.name}</span>
                        {layer.details && (
                          <span className="text-fg-3 truncate italic">{layer.details}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 text-fg-3">
                        {layer.opacity !== undefined && <span>op:{Math.round(layer.opacity * 100)}%</span>}
                        {layer.hidden && <span className="text-bad">[숨김]</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function CreateWorkPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const userId = useApp((s) => s.userId);

  const [work, setWork] = useState<WorkDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [liking, setLiking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useDocumentTitle(work?.title);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setNotFound(false);
    getWork(id, controller.signal)
      .then((result) => {
        if (alive) setWork(result);
      })
      .catch((err: unknown) => {
        if (!alive || controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : "창작물을 불러오지 못했습니다.";
        if (/\(404\)/.test(message)) setNotFound(true);
        else setError(message);
        setWork(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [id, reloadKey]);

  async function onToggleLike() {
    if (!work || !userId || liking) return;
    setLiking(true);
    setActionError(null);
    // 낙관적 토글 — 실패하면 서버 응답이 아닌 이전 상태로 되돌린다.
    const prev = { liked: work.liked, likes: work.likes };
    setWork({ ...work, liked: !prev.liked, likes: prev.likes + (prev.liked ? -1 : 1) });
    try {
      const result = await toggleWorkLike(work.id);
      setWork((current) => (current ? { ...current, liked: result.liked, likes: result.likes } : current));
    } catch (err) {
      setWork((current) => (current ? { ...current, ...prev } : current));
      setActionError(err instanceof Error ? err.message : "좋아요를 처리하지 못했습니다.");
    } finally {
      setLiking(false);
    }
  }

  async function onDelete() {
    if (!work || deleting) return;
    if (
      !(await confirmStudioDestructiveAction(
        studioDeleteWorkRequest(work.title || "이 창작물")
      ))
    ) return;
    setDeleting(true);
    setActionError(null);
    try {
      await deleteWork(work.id);
      navigate("/create", { replace: true });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "창작물을 삭제하지 못했습니다.");
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <Container size="prose" className="py-10">
        <div className="skeleton mb-4 h-7 w-2/3" />
        <div className="skeleton mb-6 h-4 w-1/3" />
        <div className="space-y-3">
          <span className="skeleton block aspect-[3/4] rounded-2xl" />
          <span className="skeleton block aspect-[3/4] rounded-2xl" />
        </div>
      </Container>
    );
  }

  if (notFound || (!work && !error)) {
    return <NotFoundPage />;
  }

  if (error || !work) {
    return (
      <Container size="prose" className="py-10">
        <ErrorState
          title="창작물을 불러오지 못했습니다."
          message={error}
          onRetry={() => setReloadKey((value) => value + 1)}
        />
      </Container>
    );
  }

  return (
    <Container size="prose" className="py-8 lg:py-10">
      {/* 스튜디오 밖 라우트에도 승인 표면을 둔다 — 없으면 네이티브 confirm 으로 떨어진다. */}
      <StudioDestructiveConfirmHost />
      <Link
        href="/create"
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-fg-3 transition-colors hover:text-fg"
      >
        <ArrowLeft size={15} />
        창작 게시판
      </Link>

      <header className="mb-6">
        {/* 리믹스 원작 정보 배지 */}
        {work.remixFromId && (
          <div className="mb-3 flex items-center gap-1.5 rounded-lg border border-line bg-raised/50 px-2.5 py-1.5 text-xs text-fg-2 border-solid">
            <span className="font-semibold text-accent flex items-center gap-1">
              <WandSparkles size={13} />
              Remix
            </span>
            <span>이 작품은 원작</span>
            <Link href={`/create/${work.remixFromId}`} className="font-semibold text-fg hover:text-accent hover:underline">
              {work.remixFromTitle || "원본 작품"}
            </Link>
            <span>의 리믹스 버전입니다.</span>
          </div>
        )}
        {/* 연재 시리즈 배지 — 시리즈 상세로 이동 */}
        {work.series && (
          <Link
            href={`/create/series/${encodeURIComponent(work.series.id)}`}
            className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-cool/40 bg-[oklch(0.8_0.11_232/0.1)] px-2.5 py-1 text-xs font-medium text-cool transition-colors hover:border-cool/70"
          >
            <Layers size={12} />
            {work.series.title}
            {work.episodeNo != null && <span className="numeral">· {work.episodeNo}화</span>}
            {work.series.status === "completed" && <span className="text-[0.7rem] opacity-80">(완결)</span>}
          </Link>
        )}
        <h1 className="text-pretty text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
          {work.title}
        </h1>

        <div className="mt-3 flex items-center gap-2.5">
          <span className="size-9 shrink-0 overflow-hidden rounded-full bg-raised ring-1 ring-line">
            {work.author.avatar ? (
              <CoverImage
                src={work.author.avatar}
                alt=""
                className="h-full w-full object-cover"
                fallback={<span className="block h-full w-full bg-raised" />}
              />
            ) : (
              <span className="block h-full w-full bg-raised" aria-hidden />
            )}
          </span>
          <div className="min-w-0">
            {work.author.id ? (
              <Link
                href={`/u/${encodeURIComponent(work.author.id)}`}
                className="block truncate text-sm font-medium text-fg transition-colors hover:text-accent"
              >
                {work.author.name}
              </Link>
            ) : (
              <p className="truncate text-sm font-medium text-fg">{work.author.name}</p>
            )}
            <p className="text-xs text-fg-3">{relativeDate(work.createdAt)}</p>
          </div>
        </div>

        {work.description && (
          <p className="mt-4 whitespace-pre-wrap text-pretty text-sm leading-relaxed text-fg-2">
            {work.description}
          </p>
        )}

        {work.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {work.tags.map((tag) => (
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

        <div className="flex flex-wrap items-center gap-2">
          {work.titleId && (
            <Link
              href={`/title/${encodeURIComponent(work.titleId)}`}
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-line bg-card px-3 py-2 text-xs text-fg-2 transition-colors hover:border-accent/50 hover:text-accent"
            >
              <Link2 size={14} className="text-accent" />
              연관 웹툰 보러 가기
            </Link>
          )}
          {/* 챌린지 참여 배지 — 챌린지 페이지로 이동 */}
          {work.challenge && (
            <Link
              href={`/create/challenges?c=${encodeURIComponent(work.challenge.slug)}`}
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-accent/40 bg-accent-soft/40 px-3 py-2 text-xs text-accent transition-colors hover:bg-accent-soft"
            >
              <Trophy size={14} />
              {work.challenge.title} 챌린지 참여작
            </Link>
          )}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <button
            type="button"
            onClick={onToggleLike}
            disabled={!userId || liking}
            aria-pressed={work.liked}
            title={userId ? undefined : "로그인 후 좋아요를 누를 수 있습니다."}
            className={buttonClass({
              size: "sm",
              variant: work.liked ? "solid" : "outline",
              className: "gap-1.5",
            })}
          >
            <Heart size={14} className={cn(work.liked && "fill-current")} />
            <span className="numeral">{formatCount(work.likes)}</span>
          </button>
          <span className="inline-flex items-center gap-1.5 text-xs text-fg-3">
            <Eye size={14} />
            <span className="numeral">{formatCount(work.views)}</span> 조회
          </span>

          <Link
            href={`/studio?remix=${encodeURIComponent(work.id)}`}
            className={buttonClass({
              size: "sm",
              variant: "outline",
              className: "gap-1.5 border-accent/40 bg-accent-soft/20 text-accent hover:bg-accent-soft/30 ml-2 border-solid",
            })}
          >
            <WandSparkles size={14} />
            <span>이어서 편집 (Remix)</span>
          </Link>

          {work.isOwner && (
            <div className="ml-auto flex items-center gap-2">
              <Link
                href={
                  work.format === "upload"
                    ? `/studio?mode=upload&id=${encodeURIComponent(work.id)}`
                    : `/studio?id=${encodeURIComponent(work.id)}`
                }
                className={buttonClass({ size: "sm", variant: "quiet", className: "gap-1.5" })}
              >
                <Pencil size={14} />
                수정
              </Link>
              <button
                type="button"
                onClick={onDelete}
                disabled={deleting}
                className={buttonClass({ size: "sm", variant: "quiet", className: "gap-1.5 text-bad hover:text-bad" })}
              >
                <Trash2 size={14} />
                삭제
              </button>
            </div>
          )}
        </div>

        {actionError && <p className="mt-3 text-xs text-bad">{actionError}</p>}

        {/* 작성자 전용: 연재 시리즈/챌린지 연결 설정 */}
        {work.isOwner && (
          <WorkCommunityPanel
            work={work}
            onUpdated={(patch) => {
              setWork((current) => (current ? { ...current, ...patch } : current));
              setReloadKey((value) => value + 1); // 시리즈/회차·이웃 회차 정보 새로고침
            }}
          />
        )}

        {/* 작성자 전용: 효과툰(배경음악·스크롤 모션·분위기) 설정 — doc.fx에 저장 */}
        {work.isOwner && (
          <WorkFxPanel
            work={work}
            onUpdated={(doc, revision) =>
              setWork((current) => current ? { ...current, doc, revision: revision ?? current.revision } : current)
            }
          />
        )}

        {/* 작성자 전용: 모션툰 영상(WebM) 내보내기 — 저장된 doc.fx 연출·컷·BGM을 그대로 녹화 */}
        {work.isOwner && (
          <Suspense fallback={<div className="skeleton mt-4 h-10 rounded-xl" aria-hidden />}>
            <StudioMotionExportPanel work={work} />
          </Suspense>
        )}
      </header>

      {/* 세로 웹툰 스크롤 — 효과툰 리더(스크롤 모션·분위기·BGM, doc.fx 기반) */}
      <WebtoonFxPlayer pages={work.pages} fx={readWorkFx(work.doc)} title={work.title} />

      {/* 개체/레이어 탐색기 (Inspector) */}
      <WorkInspector doc={work.doc} />

      {/* 이 작품을 이어서 그린 리믹스 작품들 */}
      {work.remixedChildren && work.remixedChildren.length > 0 && (
        <section className="mt-6 rounded-2xl border border-line bg-panel/30 p-4 sm:p-5">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-fg mb-4">
            <WandSparkles size={15} className="text-accent" />
            이 작품을 이어서 그린 리믹스 작품들
            <span className="numeral text-fg-3">{work.remixedChildren.length}</span>
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {work.remixedChildren.map((child) => (
              <Link
                key={child.id}
                href={`/create/${child.id}`}
                className="group flex flex-col overflow-hidden rounded-xl border border-line bg-card/60 transition-colors hover:border-line-strong"
              >
                <div className="relative aspect-[3/4] overflow-hidden bg-raised/40">
                  <CoverImage
                    src={child.cover}
                    alt={child.title}
                    className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
                  />
                </div>
                <div className="flex flex-col gap-1 p-2">
                  <h3 className="line-clamp-1 text-xs font-semibold leading-tight text-fg group-hover:text-accent">
                    {child.title}
                  </h3>
                  <p className="truncate text-[0.72rem] text-fg-3">by {child.author.name}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 시리즈 회차 내비게이션 — 이전화/시리즈 목록/다음화 */}
      {work.series && (
        <nav aria-label="회차 이동" className="mb-8 grid grid-cols-3 gap-2">
          {work.prevEpisode ? (
            <Link
              href={`/create/${encodeURIComponent(work.prevEpisode.id)}`}
              className="group flex min-w-0 items-center gap-1.5 rounded-xl border border-line bg-card px-3 py-2.5 text-sm text-fg-2 transition-colors hover:border-accent/50 hover:text-accent"
            >
              <ChevronLeft size={15} className="shrink-0" />
              <span className="min-w-0">
                <span className="block text-[0.72rem] text-fg-3">이전화</span>
                <span className="block truncate text-xs font-medium">
                  {work.prevEpisode.episodeNo != null && (
                    <span className="numeral">{work.prevEpisode.episodeNo}화 </span>
                  )}
                  {work.prevEpisode.title}
                </span>
              </span>
            </Link>
          ) : (
            <span className="grid place-items-center rounded-xl border border-dashed border-line px-3 py-2.5 text-xs text-fg-3">
              첫 화입니다
            </span>
          )}
          <Link
            href={`/create/series/${encodeURIComponent(work.series.id)}`}
            className="grid place-items-center rounded-xl border border-line bg-card px-3 py-2.5 text-xs font-medium text-fg-2 transition-colors hover:border-accent/50 hover:text-accent"
          >
            <span className="inline-flex items-center gap-1">
              <Layers size={13} />
              회차 목록
            </span>
          </Link>
          {work.nextEpisode ? (
            <Link
              href={`/create/${encodeURIComponent(work.nextEpisode.id)}`}
              className="group flex min-w-0 items-center justify-end gap-1.5 rounded-xl border border-line bg-card px-3 py-2.5 text-right text-sm text-fg-2 transition-colors hover:border-accent/50 hover:text-accent"
            >
              <span className="min-w-0">
                <span className="block text-[0.72rem] text-fg-3">다음화</span>
                <span className="block truncate text-xs font-medium">
                  {work.nextEpisode.episodeNo != null && (
                    <span className="numeral">{work.nextEpisode.episodeNo}화 </span>
                  )}
                  {work.nextEpisode.title}
                </span>
              </span>
              <ChevronRight size={15} className="shrink-0" />
            </Link>
          ) : (
            <span className="grid place-items-center rounded-xl border border-dashed border-line px-3 py-2.5 text-xs text-fg-3">
              최신화입니다
            </span>
          )}
        </nav>
      )}

      <WorkComments workId={work.id} />
    </Container>
  );
}
