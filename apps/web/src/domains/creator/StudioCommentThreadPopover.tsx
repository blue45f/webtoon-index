import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleDot,
  Inbox,
  LoaderCircle,
  Reply,
  RotateCcw,
  Send,
  X,
} from "lucide-react";
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
  STUDIO_COMMENTS_MAX_REPLIES_PER_THREAD,
  type StudioCommentActor,
  type StudioCommentReply,
  type StudioCommentThread,
} from "./studio-comments";

export interface StudioCommentThreadPopoverCapabilities {
  reply: boolean;
  resolve: boolean;
}

export type StudioCommentThreadPopoverCloseReason =
  | "explicit"
  | "escape"
  | "outside-pointer";

export interface StudioCommentThreadPopoverProps {
  /** Thread state remains authoritative in the parent; this component never mutates it locally. */
  thread: StudioCommentThread;
  /** Viewport-space center of the selected canvas pin. */
  screenPoint: { x: number; y: number };
  /** Optional live pin element. Its viewport-space center wins over the screenPoint fallback. */
  anchorElement?: HTMLElement | null;
  /** Optional live anchor reader for transformed or virtualized canvas pins. */
  getScreenPoint?: () => { x: number; y: number } | null;
  unread?: boolean;
  capabilities?: Partial<StudioCommentThreadPopoverCapabilities>;
  /** Shared explanation for permission, offline, quota, or read-only restrictions. */
  mutationDisabledReason?: string;
  /** Focus destination when the source pin disappears after resolving or remote reconciliation. */
  fallbackFocusTarget?: HTMLElement | null;
  syncing?: boolean;
  /** Shared session mutation fence; true while the parent owns an in-flight reply receipt. */
  submitting?: boolean;
  syncError?: string | null;
  /** Controlled draft shared with the full review panel. */
  replyBody: string;
  /** Zero-based position inside one canonical-anchor pin cluster. */
  clusterIndex?: number;
  clusterCount?: number;
  unreadClusterCount?: number;
  onNavigateCluster?: (direction: -1 | 1) => void;
  onReplyBodyChange: (threadId: string, body: string) => void;
  onClose: (reason: StudioCommentThreadPopoverCloseReason) => void;
  onOpenReview: (threadId: string) => void;
  onSubmitReply: (
    threadId: string,
    body: string
  ) => void | boolean | Promise<void | boolean>;
  onResolveChange: (
    threadId: string,
    resolved: boolean
  ) => void | boolean | Promise<void | boolean>;
}

interface StudioCommentThreadPopoverViewport {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface StudioCommentThreadPopoverPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  placement: "bottom" | "left" | "right";
}

type PopoverMutation = "reply" | "resolve" | null;
type ThreadMessage = Pick<
  StudioCommentReply,
  "id" | "author" | "body" | "createdAt" | "updatedAt"
>;

const DEFAULT_CAPABILITIES: StudioCommentThreadPopoverCapabilities = Object.freeze({
  reply: true,
  resolve: true,
});

const DATE_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const FULL_DATE_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function clamp(value: number, minimum: number, maximum: number): number {
  if (maximum < minimum) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function studioCommentThreadPopoverViewport(): StudioCommentThreadPopoverViewport {
  const viewport = globalThis.visualViewport;
  return {
    left: viewport?.offsetLeft ?? 0,
    top: viewport?.offsetTop ?? 0,
    width: Math.max(0, viewport?.width ?? globalThis.innerWidth),
    height: Math.max(0, viewport?.height ?? globalThis.innerHeight),
  };
}

function planStudioCommentThreadPopoverPosition(
  screenPoint: StudioCommentThreadPopoverProps["screenPoint"],
  viewport: StudioCommentThreadPopoverViewport,
  measured: { width: number; height: number }
): StudioCommentThreadPopoverPosition {
  const inset = Math.min(12, viewport.width / 2, viewport.height / 2);
  const width = Math.max(0, Math.min(360, viewport.width - inset * 2));
  const maxHeight = Math.max(0, viewport.height - inset * 2);
  const pointX = clamp(
    finiteOr(screenPoint.x, viewport.left + viewport.width / 2),
    viewport.left,
    viewport.left + viewport.width
  );
  const pointY = clamp(
    finiteOr(screenPoint.y, viewport.top + viewport.height / 2),
    viewport.top,
    viewport.top + viewport.height
  );
  const gap = 16;
  const rightLeft = pointX + gap;
  const leftLeft = pointX - width - gap;
  const rightRoom = viewport.left + viewport.width - inset - rightLeft;
  const leftRoom = leftLeft - (viewport.left + inset);
  const placement = rightRoom >= width || rightRoom >= leftRoom ? "right" : "left";
  const desiredLeft = placement === "right" ? rightLeft : leftLeft;
  const height = Math.min(maxHeight, finiteOr(measured.height, 500));

  return {
    left: clamp(
      desiredLeft,
      viewport.left + inset,
      viewport.left + viewport.width - inset - width
    ),
    top: clamp(
      pointY - 32,
      viewport.top + inset,
      viewport.top + viewport.height - inset - height
    ),
    width,
    maxHeight,
    placement,
  };
}

function planStudioCommentThreadBottomSheetPosition(
  viewport: StudioCommentThreadPopoverViewport,
  measured: { width: number; height: number }
): StudioCommentThreadPopoverPosition {
  const width = Math.max(0, Math.min(480, viewport.width));
  const maxHeight = Math.max(0, viewport.height);
  const height = Math.min(maxHeight, finiteOr(measured.height, 500));

  return {
    left: viewport.left + (viewport.width - width) / 2,
    top: viewport.top + viewport.height - height,
    width,
    maxHeight,
    placement: "bottom",
  };
}

function studioCommentThreadUsesBottomSheet(
  viewport: StudioCommentThreadPopoverViewport
): boolean {
  return viewport.width < 640
    || (typeof globalThis.matchMedia === "function"
      && globalThis.matchMedia("(pointer: coarse)").matches);
}

function sameStudioCommentThreadViewport(
  left: StudioCommentThreadPopoverViewport | null,
  right: StudioCommentThreadPopoverViewport
): boolean {
  return left !== null
    && left.left === right.left
    && left.top === right.top
    && left.width === right.width
    && left.height === right.height;
}

function sameScreenPoint(
  left: StudioCommentThreadPopoverProps["screenPoint"],
  right: StudioCommentThreadPopoverProps["screenPoint"]
): boolean {
  return Math.abs(left.x - right.x) < 0.1 && Math.abs(left.y - right.y) < 0.1;
}

function finiteScreenPoint(
  point: StudioCommentThreadPopoverProps["screenPoint"] | null | undefined
): StudioCommentThreadPopoverProps["screenPoint"] | null {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
}

function actorInitial(actor: StudioCommentActor): string {
  return Array.from(actor.displayName.trim())[0]?.toLocaleUpperCase("ko-KR") ?? "?";
}

function formatDate(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time) ? DATE_FORMATTER.format(time) : value;
}

function formatFullDate(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time) ? FULL_DATE_FORMATTER.format(time) : value;
}

function recentThreadMessages(thread: StudioCommentThread): {
  messages: ThreadMessage[];
  omittedCount: number;
} {
  const messages: ThreadMessage[] = [thread, ...thread.replies];
  return {
    messages: messages.slice(-3),
    omittedCount: Math.max(0, messages.length - 3),
  };
}

/**
 * Compact, callback-only canvas review surface rendered beside a selected comment pin.
 *
 * Network state, unread state, thread mutation, and reconciliation deliberately stay in the
 * parent. The popover only owns ephemeral draft, focus, positioning, and mutation feedback.
 */
export function StudioCommentThreadPopover({
  thread,
  screenPoint,
  anchorElement,
  getScreenPoint,
  unread = false,
  capabilities: capabilityOverrides,
  mutationDisabledReason,
  fallbackFocusTarget,
  syncing = false,
  submitting = false,
  syncError,
  replyBody,
  clusterIndex = 0,
  clusterCount = 1,
  unreadClusterCount = 0,
  onNavigateCluster,
  onReplyBodyChange,
  onClose,
  onOpenReview,
  onSubmitReply,
  onResolveChange,
}: StudioCommentThreadPopoverProps) {
  const titleId = useId();
  const descriptionId = useId();
  const replyId = useId();
  const hintId = useId();
  const countId = useId();
  const noticeId = useId();
  const errorId = useId();
  const restrictionId = useId();
  const resolveRestrictionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof globalThis.document === "undefined"
      ? null
      : globalThis.document.activeElement instanceof HTMLElement
        ? globalThis.document.activeElement
        : null
  );
  const fallbackFocusTargetRef = useRef(fallbackFocusTarget);
  fallbackFocusTargetRef.current = fallbackFocusTarget;
  const fallbackScreenPointRef = useRef(screenPoint);
  fallbackScreenPointRef.current = screenPoint;
  const shouldRestoreFocusRef = useRef(true);
  const suppressDeferredFocusRef = useRef(false);
  const deferredFocusAttemptedRef = useRef(false);
  const pendingMutationRef = useRef<PopoverMutation>(null);
  const mutationRevisionRef = useRef(0);
  const [pendingMutation, setPendingMutation] = useState<PopoverMutation>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAllMessages, setShowAllMessages] = useState(false);
  const [cardSize, setCardSize] = useState({ width: 360, height: 500 });
  const [liveScreenPoint, setLiveScreenPoint] = useState(screenPoint);
  const viewportRef = useRef<StudioCommentThreadPopoverViewport | null>(null);
  const coarsePointerRef = useRef<boolean | null>(null);
  const [, setViewportRevision] = useState(0);
  const capabilities: StudioCommentThreadPopoverCapabilities = {
    reply: capabilityOverrides?.reply ?? DEFAULT_CAPABILITIES.reply,
    resolve: capabilityOverrides?.resolve ?? DEFAULT_CAPABILITIES.resolve,
  };
  const atReplyLimit = thread.replies.length >= STUDIO_COMMENTS_MAX_REPLIES_PER_THREAD;
  const mutationBlocked = Boolean(mutationDisabledReason);
  const replyAllowed = capabilities.reply
    && !mutationBlocked
    && !thread.resolved
    && !atReplyLimit;
  const resolveAllowed = capabilities.resolve && !mutationBlocked;
  const busy = syncing || submitting || pendingMutation !== null;
  const replyRestriction = mutationDisabledReason
    ?? (thread.resolved
      ? "해결된 댓글입니다. 다시 열면 답글을 남길 수 있어요."
      : atReplyLimit
        ? `답글은 댓글당 최대 ${STUDIO_COMMENTS_MAX_REPLIES_PER_THREAD}개까지 남길 수 있어요.`
        : !capabilities.reply
          ? "현재 권한으로는 답글을 남길 수 없어요."
          : null);
  const resolveRestriction = mutationDisabledReason
    ?? (!capabilities.resolve ? "현재 권한으로는 해결 상태를 변경할 수 없어요." : null);
  const uniqueResolveRestriction = resolveRestriction === replyRestriction
    ? null
    : resolveRestriction;
  const resolveRestrictionDescriptionId = resolveRestriction
    ? uniqueResolveRestriction
      ? resolveRestrictionId
      : restrictionId
    : undefined;
  const recent = recentThreadMessages(thread);
  const visibleMessages: ThreadMessage[] = showAllMessages
    ? [thread, ...thread.replies]
    : recent.messages;

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const measure = () => {
      const rect = dialog.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setCardSize({ width: rect.width, height: rect.height });
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(dialog);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    let animationFrame = 0;
    let disposed = false;
    const coarsePointer = typeof globalThis.matchMedia === "function"
      ? globalThis.matchMedia("(pointer: coarse)")
      : null;
    const passiveCapture = { capture: true, passive: true } as const;

    const readLiveScreenPoint = () => {
      if (getScreenPoint) {
        try {
          const suppliedPoint = finiteScreenPoint(getScreenPoint());
          if (suppliedPoint) return suppliedPoint;
        } catch {
          // A transient canvas teardown should fall back to the last projected point.
        }
      }
      if (anchorElement?.isConnected) {
        const rect = anchorElement.getBoundingClientRect();
        const elementPoint = finiteScreenPoint({
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        });
        if (elementPoint) return elementPoint;
      }
      return finiteScreenPoint(fallbackScreenPointRef.current) ?? { x: 0, y: 0 };
    };

    const refreshPosition = () => {
      animationFrame = 0;
      if (disposed) return;
      const nextViewport = studioCommentThreadPopoverViewport();
      const nextCoarsePointer = coarsePointer?.matches ?? false;
      if (
        !sameStudioCommentThreadViewport(viewportRef.current, nextViewport)
        || coarsePointerRef.current !== nextCoarsePointer
      ) {
        viewportRef.current = nextViewport;
        coarsePointerRef.current = nextCoarsePointer;
        setViewportRevision((revision) => revision + 1);
      }

      if (!anchorElement && !getScreenPoint) return;
      const nextPoint = readLiveScreenPoint();
      setLiveScreenPoint((currentPoint) => (
        sameScreenPoint(currentPoint, nextPoint) ? currentPoint : nextPoint
      ));
    };

    const schedulePositionRefresh = () => {
      if (disposed || animationFrame !== 0) return;
      animationFrame = globalThis.requestAnimationFrame(refreshPosition);
    };

    schedulePositionRefresh();
    const observer = anchorElement && typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(schedulePositionRefresh)
      : null;
    if (anchorElement) observer?.observe(anchorElement);
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
      if (animationFrame !== 0) globalThis.cancelAnimationFrame(animationFrame);
      observer?.disconnect();
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
  }, [anchorElement, getScreenPoint, screenPoint.x, screenPoint.y, thread.updatedAt]);

  useEffect(() => {
    const frame = globalThis.requestAnimationFrame(() => {
      const activeElement = globalThis.document?.activeElement;
      const dialog = dialogRef.current;
      const openingTargetStillFocused = !deferredFocusAttemptedRef.current
        && activeElement === returnFocusRef.current;
      const focusMovedOutside = activeElement instanceof HTMLElement
        && activeElement !== globalThis.document?.body
        && !openingTargetStillFocused
        && !dialog?.contains(activeElement);
      deferredFocusAttemptedRef.current = true;
      if (suppressDeferredFocusRef.current || focusMovedOutside) return;
      if (replyAllowed && !syncing) textareaRef.current?.focus();
      else if (!syncing && !submitting) closeButtonRef.current?.focus();
      else dialogRef.current?.focus();
    });
    return () => globalThis.cancelAnimationFrame(frame);
  }, [replyAllowed, submitting, syncing, thread.id]);

  useEffect(() => {
    const returnTarget = returnFocusRef.current;
    return () => {
      if (!shouldRestoreFocusRef.current) return;
      if (returnTarget?.isConnected) {
        returnTarget.focus({ preventScroll: true });
        return;
      }
      if (fallbackFocusTargetRef.current?.isConnected) {
        fallbackFocusTargetRef.current.focus({ preventScroll: true });
      }
    };
  }, []);

  useEffect(() => {
    suppressDeferredFocusRef.current = false;
    deferredFocusAttemptedRef.current = false;
    setError(null);
    setNotice(null);
    setShowAllMessages(false);
    mutationRevisionRef.current += 1;
    pendingMutationRef.current = null;
    setPendingMutation(null);
  }, [thread.id]);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === "Escape") {
        if (pendingMutationRef.current || syncing || submitting) return;
        event.preventDefault();
        event.stopPropagation();
        shouldRestoreFocusRef.current = true;
        onClose("escape");
      }
    };
    const handleOutsidePointer = (event: PointerEvent) => {
      const dialog = dialogRef.current;
      const target = event.target;
      if (
        !dialog
        || !(target instanceof Node)
        || dialog.contains(target)
        || event.button !== 0
        || event.isPrimary === false
      ) return;
      // The popover is intentionally non-modal. Once the user returns to the
      // canvas, a deferred autofocus or a later syncing transition must not
      // reclaim keyboard focus from that newer interaction.
      suppressDeferredFocusRef.current = true;
      if (pendingMutationRef.current || syncing || submitting) return;
      if (replyBody.trim()) {
        setNotice("작성 중인 답글은 유지했어요. 캔버스 작업을 계속하거나 답글을 등록할 수 있어요.");
        return;
      }
      shouldRestoreFocusRef.current = false;
      onClose("outside-pointer");
    };
    globalThis.document?.addEventListener("keydown", handleKeyboard, true);
    globalThis.document?.addEventListener("pointerdown", handleOutsidePointer, true);
    return () => {
      globalThis.document?.removeEventListener("keydown", handleKeyboard, true);
      globalThis.document?.removeEventListener("pointerdown", handleOutsidePointer, true);
    };
  }, [onClose, replyBody, submitting, syncing]);

  if (typeof globalThis.document === "undefined") return null;

  const viewport = studioCommentThreadPopoverViewport();
  const anchorPoint = anchorElement || getScreenPoint ? liveScreenPoint : screenPoint;
  const visiblePoint = {
    x: clamp(
      finiteOr(anchorPoint.x, viewport.left + viewport.width / 2),
      viewport.left,
      viewport.left + viewport.width
    ),
    y: clamp(
      finiteOr(anchorPoint.y, viewport.top + viewport.height / 2),
      viewport.top,
      viewport.top + viewport.height
    ),
  };
  const bottomSheet = studioCommentThreadUsesBottomSheet(viewport);
  const position = bottomSheet
    ? planStudioCommentThreadBottomSheetPosition(viewport, cardSize)
    : planStudioCommentThreadPopoverPosition(visiblePoint, viewport, cardSize);
  const describedBy = [
    descriptionId,
    error || syncError ? errorId : null,
    notice ? noticeId : null,
    replyRestriction ? restrictionId : null,
    uniqueResolveRestriction ? resolveRestrictionId : null,
  ].filter(Boolean).join(" ");

  const submitReply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = replyBody.trim();
    if (!body || !replyAllowed || syncing || submitting || pendingMutationRef.current) return;
    const mutationRevision = ++mutationRevisionRef.current;
    pendingMutationRef.current = "reply";
    setPendingMutation("reply");
    setError(null);
    setNotice(null);
    try {
      const accepted = await onSubmitReply(thread.id, body);
      if (accepted === false) {
        throw new Error("답글을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
      }
      if (mutationRevisionRef.current !== mutationRevision) return;
      setNotice("답글을 등록했어요.");
    } catch (cause) {
      if (mutationRevisionRef.current !== mutationRevision) return;
      setError(cause instanceof Error ? cause.message : "답글을 저장하지 못했어요.");
      globalThis.requestAnimationFrame(() => textareaRef.current?.focus());
    } finally {
      if (mutationRevisionRef.current === mutationRevision) {
        pendingMutationRef.current = null;
        setPendingMutation(null);
      }
    }
  };

  const changeResolution = async () => {
    if (!resolveAllowed || syncing || submitting || pendingMutationRef.current) return;
    const mutationRevision = ++mutationRevisionRef.current;
    pendingMutationRef.current = "resolve";
    setPendingMutation("resolve");
    setError(null);
    setNotice(null);
    const nextResolved = !thread.resolved;
    try {
      const accepted = await onResolveChange(thread.id, nextResolved);
      if (accepted === false) {
        throw new Error(nextResolved
          ? "댓글을 해결 처리하지 못했어요."
          : "댓글을 다시 열지 못했어요.");
      }
      if (mutationRevisionRef.current !== mutationRevision) return;
      setNotice(nextResolved ? "댓글을 해결 처리했어요." : "댓글을 다시 열었어요.");
    } catch (cause) {
      if (mutationRevisionRef.current !== mutationRevision) return;
      setError(cause instanceof Error
        ? cause.message
        : nextResolved
          ? "댓글을 해결 처리하지 못했어요."
          : "댓글을 다시 열지 못했어요.");
    } finally {
      if (mutationRevisionRef.current === mutationRevision) {
        pendingMutationRef.current = null;
        setPendingMutation(null);
      }
    }
  };

  return createPortal(
    <>
      <span
        aria-hidden
        data-studio-comment-thread-active-pin="true"
        className="pointer-events-none fixed z-[93] size-11 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent/65 bg-accent-soft/20 shadow-[0_0_0_4px_oklch(0.72_0.185_42/0.12)] motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95"
        style={{ left: visiblePoint.x, top: visiblePoint.y }}
      />

      <div
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        aria-busy={busy}
        data-studio-comment-thread-popover="true"
        data-studio-shortcut-boundary="true"
        data-placement={position.placement}
        data-presentation={bottomSheet ? "bottom-sheet" : "anchored-popover"}
        onFocusCapture={() => {
          suppressDeferredFocusRef.current = false;
        }}
        className={`fixed z-[94] flex overflow-hidden border border-line-strong bg-panel/98 text-fg backdrop-blur-xl motion-safe:animate-in motion-safe:fade-in motion-reduce:transition-none ${
          bottomSheet
            ? "rounded-t-2xl border-b-0 shadow-[0_-18px_58px_oklch(0.06_0.02_70/0.5)] motion-safe:slide-in-from-bottom-3"
            : "rounded-2xl shadow-[0_24px_74px_oklch(0.06_0.02_70/0.62)] motion-safe:zoom-in-95 [transform-origin:var(--studio-comment-popover-origin)]"
        }`}
        style={{
          left: position.left,
          top: position.top,
          width: position.width,
          maxHeight: position.maxHeight,
          ["--studio-comment-popover-origin" as string]: position.placement === "right"
            ? "left top"
            : "right top",
        }}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {bottomSheet ? (
            <div aria-hidden className="flex h-5 shrink-0 items-center justify-center">
              <span className="h-1 w-10 rounded-full bg-line-strong" />
            </div>
          ) : null}
          <header className="flex min-w-0 items-start gap-2.5 border-b border-line px-3 py-2.5">
            <span
              aria-hidden
              className="grid size-9 shrink-0 place-items-center rounded-full border border-line bg-raised text-xs font-black text-fg-2"
            >
              {actorInitial(thread.author)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                <strong
                  id={titleId}
                  className="min-w-0 max-w-full [overflow-wrap:anywhere] text-xs leading-5 text-fg"
                >
                  {thread.author.displayName}
                </strong>
                <time
                  dateTime={thread.createdAt}
                  title={formatFullDate(thread.createdAt)}
                  className="shrink-0 text-[0.65rem] text-fg-3"
                >
                  {formatDate(thread.createdAt)}
                </time>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[0.62rem] font-semibold ${
                  thread.resolved
                    ? "border-good/35 bg-good/10 text-good"
                    : "border-warn/35 bg-warn/10 text-warn"
                }`}>
                  {thread.resolved
                    ? <CheckCircle2 size={10} aria-hidden />
                    : <CircleDot size={10} aria-hidden />}
                  {thread.resolved ? "해결됨" : "검토 중"}
                </span>
                {unread ? (
                  <span className="inline-flex items-center rounded-md bg-accent px-1.5 py-0.5 text-[0.62rem] font-bold text-on-accent">
                    미확인
                  </span>
                ) : (
                  <span className="text-[0.62rem] font-semibold text-fg-3">확인함</span>
                )}
                {thread.replies.length > 0 ? (
                  <span className="text-[0.62rem] font-semibold tabular-nums text-fg-3">
                    답글 {thread.replies.length.toLocaleString("ko-KR")}
                  </span>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              disabled={busy}
              aria-label="전체 댓글 검토함에서 열기"
              title="작성 중인 답글을 유지하고 전체 댓글 검토함에서 열기"
              onClick={() => {
                shouldRestoreFocusRef.current = false;
                onOpenReview(thread.id);
              }}
              className={`grid shrink-0 place-items-center rounded-lg text-fg-3 transition-colors duration-150 hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-40 motion-reduce:transition-none ${bottomSheet ? "size-11" : "size-10"}`}
            >
              <Inbox size={15} aria-hidden />
            </button>
            <button
              ref={closeButtonRef}
              type="button"
              disabled={busy}
              aria-label={replyBody.trim()
                ? "답글 초안을 버리고 댓글 대화창 닫기"
                : "댓글 대화창 닫기"}
              title={replyBody.trim() ? "초안을 버리고 닫기 (Esc)" : "닫기 (Esc)"}
              onClick={() => {
                shouldRestoreFocusRef.current = true;
                onClose("explicit");
              }}
              className={`grid shrink-0 place-items-center rounded-lg text-fg-3 transition-colors duration-150 hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-40 motion-reduce:transition-none ${bottomSheet ? "size-11" : "size-10"}`}
            >
              <X size={15} aria-hidden />
            </button>
          </header>

          <p id={descriptionId} className="sr-only">
            캔버스 위치에 연결된 댓글 대화입니다. 필요하면 전체 대화를 펼치고 빠르게 답글을 남길 수 있습니다.
          </p>

          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-width:thin]">
            {clusterCount > 1 && onNavigateCluster ? (
              <nav
                aria-label="같은 위치의 댓글 이동"
                className="flex min-h-11 items-center gap-2 border-b border-line bg-raised/45 px-3"
              >
                <button
                  type="button"
                  disabled={busy || Boolean(replyBody.trim())}
                  aria-label="이전 위치 댓글"
                  title={replyBody.trim() ? "작성 중인 답글을 먼저 마무리해 주세요." : "이전 댓글"}
                  onClick={() => onNavigateCluster(-1)}
                  className={`grid shrink-0 place-items-center rounded-lg text-fg-2 transition-colors duration-150 hover:bg-card hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none ${bottomSheet ? "size-11" : "size-9"}`}
                >
                  <ChevronLeft size={15} aria-hidden />
                </button>
                <p className="min-w-0 flex-1 text-center text-[0.68rem] font-semibold tabular-nums text-fg-2">
                  같은 위치 {Math.max(1, clusterIndex + 1).toLocaleString("ko-KR")}
                  <span className="px-1 text-fg-3">/</span>
                  {clusterCount.toLocaleString("ko-KR")}
                  {unreadClusterCount > 0 ? (
                    <span className="ml-1.5 rounded-full bg-accent px-1.5 py-0.5 text-[0.6rem] font-bold text-on-accent">
                      미확인 {unreadClusterCount.toLocaleString("ko-KR")}
                    </span>
                  ) : null}
                </p>
                <button
                  type="button"
                  disabled={busy || Boolean(replyBody.trim())}
                  aria-label="다음 위치 댓글"
                  title={replyBody.trim() ? "작성 중인 답글을 먼저 마무리해 주세요." : "다음 댓글"}
                  onClick={() => onNavigateCluster(1)}
                  className={`grid shrink-0 place-items-center rounded-lg text-fg-2 transition-colors duration-150 hover:bg-card hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none ${bottomSheet ? "size-11" : "size-9"}`}
                >
                  <ChevronRight size={15} aria-hidden />
                </button>
              </nav>
            ) : null}
            <section aria-label={showAllMessages ? "전체 댓글 대화" : "최근 댓글"} className="px-3 py-2.5">
              {recent.omittedCount > 0 ? (
                <button
                  type="button"
                  aria-expanded={showAllMessages}
                  onClick={() => setShowAllMessages((current) => !current)}
                  className="mb-2 inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-raised/45 px-2.5 text-[0.65rem] font-semibold text-fg-2 transition-colors duration-150 hover:border-line-strong hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none pointer-coarse:min-h-11"
                >
                  {showAllMessages ? <ChevronUp size={12} aria-hidden /> : <ChevronDown size={12} aria-hidden />}
                  {showAllMessages
                    ? "최근 메시지만 보기"
                    : `이전 메시지 ${recent.omittedCount.toLocaleString("ko-KR")}개 보기`}
                </button>
              ) : null}
              <ol className="divide-y divide-line/70">
                {visibleMessages.map((message, index) => (
                  <li key={message.id} className="flex min-w-0 gap-2 py-2 first:pt-0 last:pb-0">
                    <span
                      aria-hidden
                      className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-[0.65rem] font-bold ${
                        index === visibleMessages.length - 1
                          ? "bg-accent-soft text-accent"
                          : "bg-raised text-fg-2"
                      }`}
                    >
                      {actorInitial(message.author)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                        <strong className="max-w-full [overflow-wrap:anywhere] text-[0.7rem] text-fg-2">
                          {message.author.displayName}
                        </strong>
                        <time
                          dateTime={message.createdAt}
                          title={formatFullDate(message.createdAt)}
                          className="shrink-0 text-[0.62rem] text-fg-3"
                        >
                          {formatDate(message.createdAt)}
                        </time>
                        {message.updatedAt !== message.createdAt ? (
                          <span className="text-[0.6rem] text-fg-3">수정됨</span>
                        ) : null}
                      </div>
                      <p className={`mt-0.5 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-xs leading-5 text-fg-2 ${showAllMessages ? "" : "line-clamp-3"}`}>
                        {message.body}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <form
              onSubmit={submitReply}
              className={`sticky bottom-0 z-10 border-t border-line bg-card px-3 py-2.5 ${
                bottomSheet ? "pb-[max(0.625rem,env(safe-area-inset-bottom))]" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={replyId} className="inline-flex items-center gap-1.5 text-[0.7rem] font-bold text-fg-2">
                  <Reply size={12} aria-hidden />
                  빠른 답글
                </label>
                <span id={countId} className="shrink-0 text-[0.62rem] tabular-nums text-fg-3">
                  {replyBody.length.toLocaleString("ko-KR")}/{STUDIO_COMMENTS_MAX_BODY_LENGTH.toLocaleString("ko-KR")}
                </span>
              </div>
              <textarea
                ref={textareaRef}
                id={replyId}
                value={replyBody}
                maxLength={STUDIO_COMMENTS_MAX_BODY_LENGTH}
                rows={2}
                disabled={!replyAllowed || syncing}
                readOnly={submitting || pendingMutation !== null}
                aria-readonly={submitting || pendingMutation !== null}
                aria-describedby={`${hintId} ${countId}${replyRestriction ? ` ${restrictionId}` : ""}${error || syncError ? ` ${errorId}` : ""}${notice ? ` ${noticeId}` : ""}`}
                placeholder={thread.resolved ? "다시 열면 답글을 남길 수 있어요." : "답글을 입력하세요."}
                aria-keyshortcuts="Control+Enter Meta+Enter"
                onChange={(event) => {
                  onReplyBodyChange(
                    thread.id,
                    event.target.value.slice(0, STUDIO_COMMENTS_MAX_BODY_LENGTH)
                  );
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
                className="mt-1.5 min-h-20 w-full resize-none rounded-xl border border-line bg-card px-3 py-2.5 text-sm leading-relaxed text-fg outline-none transition-colors duration-150 placeholder:text-fg-2 hover:border-line-strong focus:border-accent focus:ring-2 focus:ring-accent/15 disabled:cursor-not-allowed disabled:opacity-55 read-only:cursor-wait motion-reduce:transition-none"
              />

              {replyRestriction ? (
                <p id={restrictionId} className="mt-1.5 text-[0.65rem] leading-relaxed text-fg-2">
                  {replyRestriction}
                </p>
              ) : null}
              {uniqueResolveRestriction ? (
                <p id={resolveRestrictionId} className="sr-only">
                  {uniqueResolveRestriction}
                </p>
              ) : null}
              {error || syncError ? (
                <p
                  id={errorId}
                  role="alert"
                  className="mt-2 rounded-lg border border-bad/35 bg-bad/10 px-2.5 py-2 text-[0.68rem] leading-relaxed text-bad"
                >
                  {error ?? syncError}
                </p>
              ) : null}
              {notice ? (
                <p
                  id={noticeId}
                  role="status"
                  className="mt-2 rounded-lg border border-cool/35 bg-cool/10 px-2.5 py-2 text-[0.68rem] leading-relaxed text-cool"
                >
                  {notice}
                </p>
              ) : null}

              <footer className="mt-2 flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  disabled={!resolveAllowed || busy}
                  aria-pressed={thread.resolved}
                  aria-label={thread.resolved
                    ? `${thread.author.displayName}의 댓글 다시 열기`
                    : `${thread.author.displayName}의 댓글 해결 처리`}
                  aria-describedby={resolveRestrictionDescriptionId}
                  title={!resolveAllowed ? resolveRestriction ?? undefined : undefined}
                  onClick={() => void changeResolution()}
                  className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 text-xs font-semibold transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none ${
                    thread.resolved
                      ? "text-warn hover:border-warn/45 hover:bg-warn/10"
                      : "text-good hover:border-good/45 hover:bg-good/10"
                  }`}
                >
                  {pendingMutation === "resolve" ? (
                    <LoaderCircle size={13} className="animate-spin motion-reduce:animate-none" aria-hidden />
                  ) : thread.resolved ? (
                    <RotateCcw size={13} aria-hidden />
                  ) : (
                    <CheckCircle2 size={13} aria-hidden />
                  )}
                  {pendingMutation === "resolve"
                    ? "변경 중"
                    : thread.resolved
                      ? "다시 열기"
                      : "해결"}
                </button>
                <span id={hintId} className="min-w-0 flex-1 truncate text-[0.62rem] text-fg-3">
                  ⌘/Ctrl + Enter
                </span>
                <button
                  type="submit"
                  disabled={!replyAllowed || busy || !replyBody.trim()}
                  className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-bold text-on-accent transition-colors duration-150 hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
                >
                  {pendingMutation === "reply" || submitting ? (
                    <LoaderCircle size={13} className="animate-spin motion-reduce:animate-none" aria-hidden />
                  ) : (
                    <Send size={13} aria-hidden />
                  )}
                  {pendingMutation === "reply" || submitting ? "등록 중" : "답글"}
                </button>
              </footer>
            </form>
          </div>
        </div>
      </div>
    </>,
    globalThis.document.body
  );
}
