import {
  CheckCircle2,
  ClipboardCheck,
  Lock,
  LockOpen,
  X,
} from "lucide-react";
import { useEffect, type ChangeEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import {
  normalizePageReviewState,
  PAGE_REVIEW_STATUS_LABELS,
  PAGE_REVIEW_STATUSES,
  type PageReviewState,
  type PageReviewStatus,
} from "./studio-page-review";
import { StudioFloatingSurface } from "./StudioFloatingSurface";
import { useStudioFloatingSurfaceLayout } from "./use-studio-floating-surface-layout";

import { useIsMobile } from "@/src/hooks/use-media-query";

export interface StudioPageReviewItem {
  id: string;
  label: string;
  review?: unknown;
}

export interface StudioPageReviewPanelProps {
  open: boolean;
  onClose: () => void;
  pages: readonly StudioPageReviewItem[];
  currentPageId: string;
  onSelectPage: (pageId: string) => void;
  onPatchReview: (
    pageId: string,
    patch: Partial<Omit<PageReviewState, "updatedAt">>,
  ) => void;
}

const DEFAULT_STUDIO_PAGE_REVIEW_FLOATING_LAYOUT = Object.freeze({
  version: 2 as const,
  xRatio: 0.86,
  yRatio: 0.08,
  width: 760,
  height: 720,
  dock: "right" as const,
  positionLocked: false,
  sizeLocked: false,
});

export function StudioPageReviewPanel({
  open,
  onClose,
  pages,
  currentPageId,
  onSelectPage,
  onPatchReview,
}: StudioPageReviewPanelProps) {
  const isMobile = useIsMobile();
  const {
    layout,
    authority,
    failure,
    setLayout,
  } = useStudioFloatingSurfaceLayout({
    surfaceId: "page-review",
    defaultLayout: DEFAULT_STUDIO_PAGE_REVIEW_FLOATING_LAYOUT,
    enabled: open && !isMobile,
  });

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => globalThis.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !isMobile || typeof document === "undefined") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobile, open]);

  if (!open || typeof document === "undefined") return null;

  const approvedCount = pages.filter(
    (page) => normalizePageReviewState(page.review).status === "approved",
  ).length;
  const lockedCount = pages.filter(
    (page) => normalizePageReviewState(page.review).locked,
  ).length;

  const statusSummary = (
    <div
      className="flex flex-wrap items-center gap-1.5 text-[0.68rem] text-fg-3"
      aria-label={`승인 ${approvedCount}/${pages.length}, 잠금 ${lockedCount}`}
    >
      <span className="rounded-full border border-line bg-card px-2 py-1">
        승인 {approvedCount}/{pages.length}
      </span>
      <span className="rounded-full border border-line bg-card px-2 py-1">
        잠금 {lockedCount}
      </span>
    </div>
  );

  const reviewList: ReactNode = (
    <>
      <p className="mb-3 rounded-lg border border-warning/30 bg-warning-soft/20 px-3 py-2 text-[0.7rem] leading-relaxed text-warning">
        이 잠금은 현재 문서의 편집 사고를 막는 워크플로 기능이며, 서버 권한이나
        실시간 공동편집 잠금은 아닙니다.
      </p>
      <ol className="space-y-2" aria-label="페이지 검토 목록">
        {pages.map((page) => {
          const review = normalizePageReviewState(page.review);
          const current = page.id === currentPageId;
          return (
            <li
              key={page.id}
              className={`rounded-xl border p-3 ${
                current
                  ? "border-accent/55 bg-accent-soft/15"
                  : "border-line bg-card/45"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onSelectPage(page.id)}
                  className="min-w-0 flex-1 truncate text-left text-sm font-bold text-fg hover:text-accent"
                >
                  {page.label}
                  {current ? (
                    <span className="ml-2 text-[0.65rem] font-medium text-accent">
                      현재
                    </span>
                  ) : null}
                </button>
                {review.status === "approved" ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-good/35 bg-good/10 px-2 py-1 text-[0.65rem] font-semibold text-good">
                    <CheckCircle2 size={11} aria-hidden /> 승인
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() =>
                    onPatchReview(page.id, { locked: !review.locked })}
                  aria-pressed={review.locked}
                  className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold ${
                    review.locked
                      ? "border-warning/40 bg-warning-soft/20 text-warning"
                      : "border-line bg-panel text-fg-3 hover:bg-raised hover:text-fg"
                  }`}
                >
                  {review.locked
                    ? <Lock size={12} aria-hidden />
                    : <LockOpen size={12} aria-hidden />}
                  {review.locked ? "편집 잠김" : "편집 가능"}
                </button>
              </div>

              <div className="mt-2 grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
                <label className="text-[0.68rem] font-semibold text-fg-3">
                  검토 상태
                  <select
                    value={review.status}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                      onPatchReview(page.id, {
                        status: event.target.value as PageReviewStatus,
                        ...(event.target.value === "approved"
                          ? { locked: true }
                          : {}),
                      })}
                    className="mt-1 w-full rounded-lg border border-line bg-panel px-2.5 py-2 text-xs text-fg outline-none focus:border-accent"
                  >
                    {PAGE_REVIEW_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {PAGE_REVIEW_STATUS_LABELS[status]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[0.68rem] font-semibold text-fg-3">
                  담당 / 확인자
                  <input
                    value={review.assignee ?? ""}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      onPatchReview(page.id, {
                        assignee: event.target.value.slice(0, 80),
                      })}
                    placeholder="예: 콘티 편집자"
                    className="mt-1 w-full rounded-lg border border-line bg-panel px-2.5 py-2 text-xs text-fg outline-none placeholder:text-fg-3 focus:border-accent"
                  />
                </label>
              </div>
              <label className="mt-2 block text-[0.68rem] font-semibold text-fg-3">
                검토 메모
                <textarea
                  value={review.note ?? ""}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                    onPatchReview(page.id, {
                      note: event.target.value.slice(0, 2_000),
                    })}
                  rows={2}
                  placeholder="수정 요청이나 승인 근거를 남겨요."
                  className="mt-1 w-full resize-y rounded-lg border border-line bg-panel px-2.5 py-2 text-xs leading-relaxed text-fg outline-none placeholder:text-fg-3 focus:border-accent"
                />
              </label>
            </li>
          );
        })}
      </ol>
    </>
  );

  if (!isMobile) {
    return createPortal(
      <StudioFloatingSurface
        surfaceId="page-review"
        label="페이지 검토와 잠금"
        layout={layout}
        defaultLayout={DEFAULT_STUDIO_PAGE_REVIEW_FLOATING_LAYOUT}
        minWidth={520}
        minHeight={420}
        maxWidth={1_100}
        maxHeight={1_000}
        insetTop={76}
        insetRight={12}
        insetBottom={12}
        insetLeft={12}
        onLayoutChange={setLayout}
        onClose={onClose}
        rootDataAttributes={{
          "data-studio-page-review-surface": "desktop",
          "data-studio-shortcut-boundary": "true",
          "data-layout-authority": authority,
          "data-layout-failure": failure ?? undefined,
        }}
        contentClassName="min-h-0 overflow-hidden"
      >
        <section
          aria-label="페이지 검토 작업 목록"
          className="flex h-full min-h-0 flex-col"
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-2">
            <p className="min-w-0 text-[0.7rem] leading-relaxed text-fg-3">
              승인 상태·담당·메모를 문서에 남기고 완성 페이지를 잠급니다.
            </p>
            {statusSummary}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {reviewList}
          </div>
        </section>
      </StudioFloatingSurface>,
      document.body,
    );
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="페이지 검토와 잠금"
      data-studio-page-review-surface="mobile"
      className="fixed inset-0 z-[80] bg-[oklch(0.08_0.01_70/0.82)] p-2 text-fg backdrop-blur-sm sm:p-4"
    >
      <div className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
        <header className="flex shrink-0 items-start gap-3 border-b border-line px-4 py-3">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
            <ClipboardCheck size={18} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold tracking-tight text-fg">
              페이지 검토와 잠금
            </h2>
            <p className="mt-0.5 text-xs leading-relaxed text-fg-3">
              승인 상태·담당·메모를 문서에 남기고, 완성한 페이지의 실수 편집을
              잠급니다.
            </p>
          </div>
          <div className="hidden sm:block">{statusSummary}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="페이지 검토 닫기"
            className="grid size-11 shrink-0 place-items-center rounded-lg border border-line bg-card text-fg-3 hover:bg-raised hover:text-fg"
          >
            <X size={15} aria-hidden />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {reviewList}
        </div>
      </div>
    </div>,
    document.body,
  );
}
