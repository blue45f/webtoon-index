import { LoaderCircle, MapPin, Send, X } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { createPortal } from "react-dom";

import {
  STUDIO_COMMENTS_MAX_BODY_LENGTH,
  type StudioCommentAnchor,
} from "./studio-comments";
import {
  planStudioPointCommentComposerPosition,
  type StudioPointCommentViewportBounds,
} from "./studio-point-comment-composer-model";

export interface StudioPointCommentComposerProps {
  anchor: Extract<StudioCommentAnchor, { type: "point" }>;
  authorName: string;
  screenPoint: { x: number; y: number };
  /** Reprojects the document anchor while the canvas pans or zooms. `screenPoint` remains fallback. */
  getScreenPoint?: () => { x: number; y: number } | null;
  onCancel: () => void;
  onOpenReview?: () => void;
  onSubmit: (body: string) => Promise<boolean | void>;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function initial(value: string): string {
  return Array.from(value.trim())[0]?.toLocaleUpperCase("ko-KR") ?? "?";
}

function studioPointCommentViewport(): StudioPointCommentViewportBounds {
  const viewport = globalThis.visualViewport;
  return {
    left: viewport?.offsetLeft ?? 0,
    top: viewport?.offsetTop ?? 0,
    width: viewport?.width ?? globalThis.innerWidth,
    height: viewport?.height ?? globalThis.innerHeight,
  };
}

function sameStudioPointCommentViewport(
  left: StudioPointCommentViewportBounds | null,
  right: StudioPointCommentViewportBounds
): boolean {
  return left !== null
    && left.left === right.left
    && left.top === right.top
    && left.width === right.width
    && left.height === right.height;
}

/** Magma/Figma-style single-click composer rendered beside the exact canvas click. */
export function StudioPointCommentComposer({
  anchor,
  authorName,
  screenPoint,
  getScreenPoint,
  onCancel,
  onOpenReview,
  onSubmit,
}: StudioPointCommentComposerProps) {
  const hintId = useId();
  const countId = useId();
  const errorId = useId();
  const noticeId = useId();
  const cardRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(saving);
  savingRef.current = saving;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cardSize, setCardSize] = useState({ width: 336, height: 224 });
  const liveScreenPointRef = useRef<{ x: number; y: number } | null>(null);
  const [liveScreenPoint, setLiveScreenPoint] = useState<{ x: number; y: number } | null>(null);
  const viewportRef = useRef<StudioPointCommentViewportBounds | null>(null);
  const coarsePointerRef = useRef<boolean | null>(null);
  const [, setViewportRevision] = useState(0);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const measure = () => {
      const rect = card.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setCardSize({ width: rect.width, height: rect.height });
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const frame = globalThis.requestAnimationFrame(() => textareaRef.current?.focus());
    return () => globalThis.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let frame = 0;
    let disposed = false;
    const coarsePointer = globalThis.matchMedia?.("(pointer: coarse)") ?? null;
    const passiveCapture = { capture: true, passive: true } as const;

    const refreshPosition = () => {
      frame = 0;
      if (disposed) return;

      const nextViewport = studioPointCommentViewport();
      const nextCoarsePointer = coarsePointer?.matches ?? false;
      if (
        !sameStudioPointCommentViewport(viewportRef.current, nextViewport)
        || coarsePointerRef.current !== nextCoarsePointer
      ) {
        viewportRef.current = nextViewport;
        coarsePointerRef.current = nextCoarsePointer;
        setViewportRevision((revision) => revision + 1);
      }

      if (!getScreenPoint) return;
      let sampled: { x: number; y: number } | null = null;
      try {
        const projected = getScreenPoint();
        sampled = projected && Number.isFinite(projected.x) && Number.isFinite(projected.y)
          ? projected
          : null;
      } catch {
        // Canvas teardown can briefly invalidate the projection reader; keep the click fallback.
      }
      const previous = liveScreenPointRef.current;
      if (previous?.x === sampled?.x && previous?.y === sampled?.y) return;
      liveScreenPointRef.current = sampled;
      setLiveScreenPoint(sampled);
    };

    const schedulePositionRefresh = () => {
      if (disposed || frame !== 0) return;
      frame = globalThis.requestAnimationFrame(refreshPosition);
    };

    schedulePositionRefresh();
    globalThis.addEventListener("resize", schedulePositionRefresh, passiveCapture);
    globalThis.addEventListener("scroll", schedulePositionRefresh, passiveCapture);
    globalThis.addEventListener("wheel", schedulePositionRefresh, passiveCapture);
    globalThis.addEventListener("pointermove", schedulePositionRefresh, passiveCapture);
    globalThis.addEventListener("pointerup", schedulePositionRefresh, passiveCapture);
    globalThis.addEventListener("click", schedulePositionRefresh, passiveCapture);
    globalThis.addEventListener("keydown", schedulePositionRefresh, true);
    globalThis.visualViewport?.addEventListener("resize", schedulePositionRefresh);
    globalThis.visualViewport?.addEventListener("scroll", schedulePositionRefresh);
    coarsePointer?.addEventListener("change", schedulePositionRefresh);

    return () => {
      disposed = true;
      if (frame !== 0) globalThis.cancelAnimationFrame(frame);
      globalThis.removeEventListener("resize", schedulePositionRefresh, passiveCapture);
      globalThis.removeEventListener("scroll", schedulePositionRefresh, passiveCapture);
      globalThis.removeEventListener("wheel", schedulePositionRefresh, passiveCapture);
      globalThis.removeEventListener("pointermove", schedulePositionRefresh, passiveCapture);
      globalThis.removeEventListener("pointerup", schedulePositionRefresh, passiveCapture);
      globalThis.removeEventListener("click", schedulePositionRefresh, passiveCapture);
      globalThis.removeEventListener("keydown", schedulePositionRefresh, true);
      globalThis.visualViewport?.removeEventListener("resize", schedulePositionRefresh);
      globalThis.visualViewport?.removeEventListener("scroll", schedulePositionRefresh);
      coarsePointer?.removeEventListener("change", schedulePositionRefresh);
    };
  }, [getScreenPoint, screenPoint.x, screenPoint.y]);

  useEffect(() => {
    const handleComposerKeyboard = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === "Escape") {
        if (savingRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }
    };
    globalThis.document?.addEventListener("keydown", handleComposerKeyboard, true);
    return () => globalThis.document?.removeEventListener("keydown", handleComposerKeyboard, true);
  }, [onCancel]);

  if (typeof globalThis.document === "undefined") return null;
  const viewport = studioPointCommentViewport();
  const trackedScreenPoint = getScreenPoint ? liveScreenPoint ?? screenPoint : screenPoint;
  const horizontalInset = Math.min(16, Math.max(0, viewport.width / 2));
  const verticalInset = Math.min(16, Math.max(0, viewport.height / 2));
  const visiblePoint = {
    x: clamp(
      trackedScreenPoint.x,
      viewport.left + horizontalInset,
      viewport.left + viewport.width - horizontalInset
    ),
    y: clamp(
      trackedScreenPoint.y,
      viewport.top + verticalInset,
      viewport.top + viewport.height - verticalInset
    ),
  };
  const position = planStudioPointCommentComposerPosition({
    point: visiblePoint,
    viewport,
    measuredCard: cardSize,
    coarsePointer: globalThis.matchMedia?.("(pointer: coarse)").matches ?? false,
  });
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = body.trim();
    if (!message || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const accepted = await onSubmit(message);
      if (accepted === false) {
        throw new Error("댓글을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "댓글을 저장하지 못했어요.");
      globalThis.requestAnimationFrame(() => textareaRef.current?.focus());
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const preserveDraftAndRefocus = () => {
    setError(null);
    setNotice("작성 중인 댓글은 유지했어요. 등록하거나 Esc 또는 닫기 버튼으로 취소할 수 있어요.");
    globalThis.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  return createPortal(
    <>
      <span
        aria-hidden
        data-studio-point-comment-pin="true"
        className="pointer-events-none fixed z-[91] grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-panel bg-accent text-on-accent shadow-[0_4px_18px_oklch(0.10_0.03_70/0.5)]"
        style={{ left: visiblePoint.x, top: visiblePoint.y }}
      >
        <MapPin size={14} />
      </span>
      <form
        ref={cardRef}
        role="dialog"
        tabIndex={-1}
        aria-label="위치 댓글 작성"
        aria-modal={false}
        aria-describedby={error
          ? `${hintId} ${errorId}`
          : notice
            ? `${hintId} ${noticeId}`
            : hintId}
        aria-busy={saving}
        data-studio-point-comment-composer="true"
        data-studio-point-comment-layout={position.mode}
        data-presentation={position.mode === "sheet" ? "bottom-sheet" : "anchored-popover"}
        data-studio-shortcut-boundary="true"
        onSubmit={submit}
        className={`fixed z-[92] flex flex-col overflow-hidden border border-line-strong bg-panel/98 text-fg backdrop-blur-xl [scrollbar-width:thin] motion-safe:animate-in motion-safe:fade-in motion-reduce:animate-none ${position.mode === "sheet"
          ? "rounded-t-2xl border-b-0 pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] shadow-[0_-18px_54px_oklch(0.06_0.02_70/0.5)] motion-safe:slide-in-from-bottom-4"
          : "rounded-lg shadow-[0_22px_70px_oklch(0.06_0.02_70/0.58)] motion-safe:zoom-in-95"
        }`}
        style={{
          left: position.left,
          top: position.top,
          width: position.width,
          maxHeight: position.maxHeight,
          boxSizing: "border-box",
        }}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-black text-accent">
            {initial(authorName)}
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block truncate text-xs font-bold">위치 댓글</strong>
            <span className="block truncate text-[0.65rem] text-fg-3">
              {Math.round(anchor.x * 100)}%, {Math.round(anchor.y * 100)}% · {authorName}
            </span>
          </span>
          {onOpenReview ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                if (body.trim()) {
                  preserveDraftAndRefocus();
                  return;
                }
                onOpenReview();
              }}
              aria-label="댓글 검토함 열기"
              aria-disabled={body.trim() ? true : undefined}
              title={body.trim()
                ? "작성 중인 댓글을 등록하거나 취소한 뒤 검토함을 열 수 있어요"
                : "댓글 검토함 열기"}
              className="min-h-11 rounded-lg px-2 text-[0.68rem] font-semibold text-fg-3 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-45"
            >
              검토함
            </button>
          ) : null}
          <button
            type="button"
            disabled={saving}
            onClick={onCancel}
            aria-label="위치 댓글 작성 취소"
            title="취소 (Esc)"
            className="grid size-11 shrink-0 place-items-center rounded-lg text-fg-3 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-45"
          >
            <X size={15} aria-hidden />
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-3">
          <textarea
            ref={textareaRef}
            value={body}
            maxLength={STUDIO_COMMENTS_MAX_BODY_LENGTH}
            rows={3}
            readOnly={saving}
            aria-readonly={saving}
            aria-label="위치 댓글 내용"
            aria-keyshortcuts="Meta+Enter Control+Enter Escape"
            aria-describedby={`${hintId} ${countId}${error ? ` ${errorId}` : notice ? ` ${noticeId}` : ""}`}
            placeholder="이 위치에서 확인할 점이나 수정 의견을 남겨 주세요."
            onChange={(event) => {
              setBody(event.target.value.slice(0, STUDIO_COMMENTS_MAX_BODY_LENGTH));
              if (error) setError(null);
              if (notice) setNotice(null);
            }}
            onKeyDown={(event) => {
              if (
                !event.nativeEvent.isComposing
                && (event.metaKey || event.ctrlKey)
                && event.key === "Enter"
              ) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            className="min-h-24 w-full resize-none rounded-xl border border-line bg-card px-3 py-2.5 text-sm leading-relaxed text-fg outline-none transition-colors placeholder:text-fg-3 hover:border-line-strong focus:border-accent focus:ring-2 focus:ring-accent/15 read-only:cursor-wait read-only:opacity-60"
          />
          {error ? (
            <p
              id={errorId}
              role="alert"
              className="mt-2 rounded-lg border border-bad/35 bg-bad/10 px-2.5 py-2 text-[0.7rem] leading-relaxed text-bad"
            >
              {error}
            </p>
          ) : null}
          {notice ? (
            <p
              id={noticeId}
              role="status"
              className="mt-2 rounded-lg border border-cool/35 bg-cool/10 px-2.5 py-2 text-[0.7rem] leading-relaxed text-cool"
            >
              {notice}
            </p>
          ) : null}
          <footer className="mt-2 flex items-center gap-2">
            <span id={hintId} className="min-w-0 flex-1 text-[0.65rem] text-fg-3">
              Esc 취소 · ⌘/Ctrl + Enter 등록
            </span>
            <span id={countId} className="text-[0.62rem] tabular-nums text-fg-3">
              {body.length.toLocaleString("ko-KR")}/{STUDIO_COMMENTS_MAX_BODY_LENGTH.toLocaleString("ko-KR")}
            </span>
            <button
              type="submit"
              disabled={saving || !body.trim()}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-bold text-on-accent transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? (
                <LoaderCircle
                  size={13}
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
              ) : (
                <Send size={13} aria-hidden />
              )}
              {saving ? "저장 중" : "등록"}
            </button>
          </footer>
        </div>
      </form>
    </>,
    globalThis.document.body
  );
}
