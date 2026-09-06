import {
  Check,
  CloudOff,
  ExternalLink,
  Eye,
  EyeOff,
  LoaderCircle,
  MessageCircle,
  MousePointer2,
  Radio,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  UsersRound,
  Wrench,
  X,
} from "lucide-react";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import {
  nudgeStudioCommentPointAnchor,
  projectStudioCommentPointerToPointAnchor,
} from "../studio-comment-pin-reanchor";
import {
  studioLivePresenceAlwaysVisible,
  studioPresenceConnectionLabel,
  studioPresenceOverflowLabel,
  studioPresenceVisiblePeerCount,
} from "../studio-commercial-residuals";

import {
  planStudioCommentPinPreviewPosition,
  studioLiveCursorActivityLabel,
  studioLiveCursorToolLabel,
  studioLiveParticipantColor,
  type StudioCanvasCommentPin,
} from "./studio-live-canvas-overlay-model";
import { useStudioLiveCollaboration } from "./studio-live-collaboration-context";
import { selectStudioLivePresentedCursors } from "./studio-live-cursor-presentation";
import {
  presentStudioLiveCursorQuality,
  type StudioLiveCursorQualitySnapshot,
} from "./studio-live-cursor-quality";
import { openStudioLiveCompanionTab } from "./studio-live-jam-session";
import { summarizeStudioLiveActiveOwners } from "./studio-live-layer-ownership";
import { useStudioRemoteCursors } from "./studio-live-remote-cursor-store";
import {
  INITIAL_STUDIO_LIVE_SYNC_SNAPSHOT,
  formatStudioLiveLastAck,
  presentStudioLiveSyncSnapshot,
  type StudioLiveSyncPhase,
  type StudioLiveSyncSnapshot,
} from "./studio-live-sync-safety";
import {
  isStudioLiveCursorVisibilityShortcut,
  isStudioLiveShortcutTextTarget,
  toggleStudioLiveRemoteCursors,
  useStudioLiveViewPreferences,
} from "./studio-live-view-preferences";
import { StudioLiveQuickCollaborationControls } from "./StudioLiveQuickCollaborationControls";
import { useStudioLiveCursorChatBubbles } from "./use-studio-live-cursor-chat-bubbles";
import { useStudioLiveCursorQuality } from "./use-studio-live-cursor-quality";

import type {
  StudioLiveCursorPayload,
  StudioLiveParticipant,
} from "./studio-live-collaboration-protocol";
import type { StudioCommentAnchor } from "../studio-comments";
import type { StudioLivePeer } from "./studio-live-collaboration-room";

import { cn } from "@/shared/lib/utils";
import { studioCanOpenAuxiliaryWindow } from "@/src/compat/in-app-browser";

export interface StudioLiveCanvasCursor {
  participant: StudioLiveParticipant;
  cursor: StudioLiveCursorPayload;
  updatedAt: number;
  chatText?: string;
}

export interface StudioCommentPinClickPayload {
  pinKey: string;
  anchor: StudioCommentAnchor;
  preferredThreadId: string | undefined;
  threadIds: readonly string[];
  trigger: HTMLButtonElement;
}

export interface StudioCommentPinReanchorPayload {
  pinKey: string;
  threadId: string;
  anchor: Extract<StudioCommentAnchor, { type: "point" }>;
  source: "pointer" | "keyboard";
}

export interface StudioLiveCanvasOverlayProps {
  canvasWidth: number;
  canvasHeight: number;
  cursors: readonly StudioLiveCanvasCursor[];
  commentPins: readonly StudioCanvasCommentPin[];
  onCommentPinClick: (payload: StudioCommentPinClickPayload) => void;
  /** Moves one unclustered point comment; persistence and authorization remain parent-owned. */
  onCommentPinReanchor?: (payload: StudioCommentPinReanchorPayload) => void;
  /** Optional per-thread authority set; omitted keeps the callback-based legacy permission rule. */
  commentPinReanchorableThreadIds?: ReadonlySet<string>;
  /** Explains a temporary permission/sync lock without disabling ordinary comment opening. */
  commentPinReanchorDisabledReason?: string;
  /** Warms the quick-reply chunk on pointer or keyboard intent. */
  onCommentQuickReplyPreload?: () => void;
  /** Keeps the lightweight preview from competing with an active quick-reply surface. */
  commentQuickReplyActive?: boolean;
  flipX?: boolean;
  /** View-only clockwise quarter turn; horizontal flip remains relative to the visible screen. */
  rotation?: 0 | 90 | 180 | 270;
}

export interface StudioLivePresenceDockProps {
  connected: boolean;
  operationSyncReady?: boolean;
  /** Always-on collab: show while connecting/ready even with zero peers. */
  alwaysOn?: boolean;
  peers: readonly StudioLivePeer[];
  /**
   * Active page/element edit leases currently held in the room.
   * Zero hides the lock chip so solo sessions stay quiet.
   */
  activeLockCount?: number;
  /** Richer lock-chip title (owners) from `summarizeStudioLiveActiveOwners`. */
  activeLockLabel?: string | null;
  followingSessionId: string | null;
  onOpenTeam: () => void;
  onOpenCompanionTab?: () => void;
  onToggleFollow: (sessionId: string) => void;
  remoteCursorsVisible?: boolean;
  onToggleRemoteCursors?: () => void;
  cursorQuality?: StudioLiveCursorQualitySnapshot | null;
  syncSnapshot?: StudioLiveSyncSnapshot;
  voiceControls?: ReactNode;
}

export interface StudioRemoteCursorOverlayProps {
  pageId: string;
  followingSessionId?: string | null;
  canvasWidth: number;
  canvasHeight: number;
  /** Keep pointer/tip presence while the retained gesture renderer owns this peer's trail. */
  trailSuppressedSessionIds?: ReadonlySet<string>;
  hidden?: boolean;
  commentPins: readonly StudioCanvasCommentPin[];
  onCommentPinClick: (payload: StudioCommentPinClickPayload) => void;
  onCommentPinReanchor?: (payload: StudioCommentPinReanchorPayload) => void;
  commentPinReanchorableThreadIds?: ReadonlySet<string>;
  commentPinReanchorDisabledReason?: string;
  onCommentQuickReplyPreload?: () => void;
  commentQuickReplyActive?: boolean;
  flipX?: boolean;
  /** View-only clockwise quarter turn; horizontal flip remains relative to the visible screen. */
  rotation?: 0 | 90 | 180 | 270;
}

export interface StudioLivePresenceDockConnectedProps {
  operationSyncReady?: boolean;
  followingSessionId: string | null;
  onOpenTeam: () => void;
  onToggleFollow: (sessionId: string) => void;
  onFollowPage: (pageId: string) => void;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

interface StudioLiveOverlayProjection {
  x: number;
  y: number;
  screenOffsetX: number;
  screenOffsetY: number;
}

interface StudioCommentPinDragSession {
  pinKey: string;
  threadId: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startPointerAnchor: Extract<StudioCommentAnchor, { type: "point" }>;
  initialAnchor: Extract<StudioCommentAnchor, { type: "point" }>;
  moved: boolean;
  latestAnchor: Extract<StudioCommentAnchor, { type: "point" }>;
  trigger: HTMLButtonElement;
}

interface StudioCommentPinDragPreview {
  pinKey: string;
  anchor: Extract<StudioCommentAnchor, { type: "point" }>;
}

interface StudioCommentPinGlobalDragHandlers {
  move: (event: PointerEvent, stopPropagation?: boolean) => void;
  finish: (event: PointerEvent, stopPropagation?: boolean) => void;
  cancel: (event: PointerEvent, stopPropagation?: boolean) => void;
}

const STUDIO_COMMENT_PIN_DRAG_THRESHOLD_PX = 4;
const STUDIO_COMMENT_PIN_KEYBOARD_FINE_FRACTION = 0.005;
const STUDIO_COMMENT_PIN_KEYBOARD_COARSE_FRACTION = 0.025;

/** Project document-local coordinates into the axis-aligned quarter-turned view box. */
function projectStudioLiveOverlayPoint(
  x: number,
  y: number,
  screenOffsetX: number,
  screenOffsetY: number,
  flipX: boolean,
  rotation: 0 | 90 | 180 | 270
): StudioLiveOverlayProjection {
  let projected: StudioLiveOverlayProjection;
  if (rotation === 90) {
    projected = {
      x: 1 - y,
      y: x,
      screenOffsetX: -screenOffsetY,
      screenOffsetY: screenOffsetX,
    };
  } else if (rotation === 180) {
    projected = {
      x: 1 - x,
      y: 1 - y,
      screenOffsetX: -screenOffsetX,
      screenOffsetY: -screenOffsetY,
    };
  } else if (rotation === 270) {
    projected = {
      x: y,
      y: 1 - x,
      screenOffsetX: screenOffsetY,
      screenOffsetY: -screenOffsetX,
    };
  } else {
    projected = {
      x,
      y,
      screenOffsetX,
      screenOffsetY,
    };
  }

  return flipX
    ? {
        ...projected,
        x: 1 - projected.x,
        screenOffsetX: -projected.screenOffsetX,
      }
    : projected;
}

function initial(value: string): string {
  return Array.from(value.trim())[0]?.toLocaleUpperCase("ko-KR") ?? "?";
}

function roleLabel(role: StudioLiveParticipant["role"]): string {
  if (role === "owner") return "소유자";
  if (role === "admin") return "관리자";
  if (role === "editor") return "편집자";
  if (role === "commenter") return "검토자";
  return "열람자";
}

function summarizeCommentPinBody(body: string): string {
  const normalized = body.replace(/\s+/gu, " ").trim();
  const characters = Array.from(normalized);
  return characters.length > 96
    ? `${characters.slice(0, 95).join("")}…`
    : normalized;
}

function studioCommentPinReanchorTarget(pin: StudioCanvasCommentPin): {
  anchor: Extract<StudioCommentAnchor, { type: "point" }>;
  threadId: string;
} | null {
  if (
    pin.count !== 1
    || pin.anchor.type !== "point"
    || pin.threadIds?.length !== 1
    || !pin.threadIds[0]
  ) return null;
  return { anchor: pin.anchor, threadId: pin.threadIds[0] };
}

function commentPinAccessibleLabel(
  pin: StudioCanvasCommentPin,
  index: number,
  total: number,
  options: {
    reanchorable: boolean;
    reanchoring: boolean;
    reanchorDisabledReason?: string;
  }
): string {
  const parts = [pin.label, `댓글 핀 ${index + 1}/${total}`];
  const author = pin.previewAuthor?.trim();
  const body = pin.previewBody ? summarizeCommentPinBody(pin.previewBody) : "";
  if (author) parts.push(`최근 작성자 ${author}`);
  if (body) parts.push(`최근 댓글 ${body}`);
  parts.push(`미해결 대화 ${pin.count}개`);
  parts.push(pin.unreadCount ? `읽지 않은 대화 ${pin.unreadCount}개` : "모두 읽음");
  if (options.reanchoring) {
    parts.push("댓글 위치 이동 중");
  } else if (options.reanchorable) {
    parts.push("드래그 또는 Alt와 방향키로 위치 이동");
  } else if (options.reanchorDisabledReason) {
    parts.push(`위치 이동 불가 ${options.reanchorDisabledReason}`);
  }
  parts.push("Enter 키로 대화 열기");
  return parts
    .map((part) => /[.!?…。！？]$/u.test(part) ? part : `${part}.`)
    .join(" ");
}

function syncToneClass(tone: ReturnType<typeof presentStudioLiveSyncSnapshot>["tone"]): string {
  if (tone === "good") return "border-good/40 bg-good/10 text-good";
  if (tone === "warn") return "border-warn/45 bg-warn/10 text-warn";
  if (tone === "bad") return "border-bad/50 bg-bad/12 text-bad";
  if (tone === "cool") return "border-cool/40 bg-cool/10 text-cool";
  return "border-line bg-card text-fg-2";
}

function StudioSyncStatusIcon({ phase }: { phase: StudioLiveSyncPhase }) {
  if (phase === "synced") return <ShieldCheck size={14} aria-hidden />;
  // A follower tab cannot persist — the shield-alert matches the warn tone of its presentation
  // without borrowing the green shield a writable tab earns.
  if (phase === "read-only-follower") return <ShieldAlert size={14} aria-hidden />;
  if (phase === "offline-queued") return <CloudOff size={14} aria-hidden />;
  if (phase === "repairing") return <Wrench size={14} aria-hidden />;
  if (phase === "durability-risk" || phase === "revoked" || phase === "recovery-required") {
    return <ShieldAlert size={14} aria-hidden />;
  }
  if (phase === "retrying") {
    return (
      <RefreshCw
        className="animate-spin [animation-duration:1.4s] motion-reduce:animate-none"
        size={14}
        aria-hidden
      />
    );
  }
  if (phase === "syncing" || phase === "initializing") {
    return (
      <LoaderCircle
        className="animate-spin [animation-duration:1.2s] motion-reduce:animate-none"
        size={14}
        aria-hidden
      />
    );
  }
  return <Radio size={14} aria-hidden />;
}

function StudioCommentPinPreviewPortal({
  anchor,
  author,
  body,
  reanchorable,
}: {
  anchor: HTMLButtonElement;
  author: string;
  body: string;
  reanchorable: boolean;
}) {
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<ReturnType<
    typeof planStudioCommentPinPreviewPosition
  > | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const anchorRect = anchor.getBoundingClientRect();
      const tooltipRect = tooltipRef.current?.getBoundingClientRect();
      const visualViewport = globalThis.visualViewport;
      setPosition(planStudioCommentPinPreviewPosition({
        anchor: anchorRect,
        viewport: {
          left: visualViewport?.offsetLeft ?? 0,
          top: visualViewport?.offsetTop ?? 0,
          width: visualViewport?.width ?? globalThis.innerWidth,
          height: visualViewport?.height ?? globalThis.innerHeight,
        },
        measured: tooltipRect && tooltipRect.width > 0 && tooltipRect.height > 0
          ? { width: tooltipRect.width, height: tooltipRect.height }
          : undefined,
      }));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(anchor);
    if (tooltipRef.current) observer?.observe(tooltipRef.current);
    globalThis.addEventListener("resize", measure);
    globalThis.addEventListener("scroll", measure, true);
    globalThis.visualViewport?.addEventListener("resize", measure);
    globalThis.visualViewport?.addEventListener("scroll", measure);
    return () => {
      observer?.disconnect();
      globalThis.removeEventListener("resize", measure);
      globalThis.removeEventListener("scroll", measure, true);
      globalThis.visualViewport?.removeEventListener("resize", measure);
      globalThis.visualViewport?.removeEventListener("scroll", measure);
    };
  }, [anchor, author, body]);

  if (typeof globalThis.document === "undefined") return null;
  return createPortal(
    <span
      ref={tooltipRef}
      aria-hidden
      data-studio-comment-pin-preview="true"
      data-placement={position?.placement}
      className="pointer-events-none fixed z-[89] max-h-28 overflow-hidden rounded-xl border border-line-strong bg-panel/98 p-2.5 text-left normal-case tracking-normal text-fg shadow-[0_14px_40px_oklch(0.06_0.02_70/0.52)] backdrop-blur-xl"
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        width: position?.width ?? 224,
        visibility: position ? "visible" : "hidden",
      }}
    >
      <span className="block truncate text-[0.68rem] font-bold text-fg">{author}</span>
      <span className="mt-1 block line-clamp-3 text-[0.68rem] font-medium leading-relaxed text-fg-2">
        {body}
      </span>
      <span className="mt-1.5 block text-[0.62rem] font-semibold text-accent">
        {reanchorable
          ? "드래그·Alt+방향키로 위치 이동 · 클릭·Enter로 열기"
          : "클릭·Enter로 열기 · ←/→ 핀 이동"}
      </span>
    </span>,
    globalThis.document.body
  );
}

export function StudioLiveCanvasOverlay({
  canvasWidth,
  canvasHeight,
  cursors,
  commentPins,
  onCommentPinClick,
  onCommentPinReanchor,
  commentPinReanchorableThreadIds,
  commentPinReanchorDisabledReason,
  onCommentQuickReplyPreload,
  commentQuickReplyActive = false,
  flipX = false,
  rotation = 0,
}: StudioLiveCanvasOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [activeCommentPreviewKey, setActiveCommentPreviewKey] = useState<string | null>(null);
  const [preferredCommentPinKey, setPreferredCommentPinKey] = useState<string | null>(
    () => commentPins[0]?.key ?? null
  );
  const pinButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const dragSessionRef = useRef<StudioCommentPinDragSession | null>(null);
  const globalDragHandlersRef = useRef<StudioCommentPinGlobalDragHandlers | null>(null);
  const keyboardReanchorAnchorRef = useRef(
    new Map<string, Extract<StudioCommentAnchor, { type: "point" }>>()
  );
  const suppressedClickPinKeyRef = useRef<string | null>(null);
  const suppressedClickTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const [dragPreview, setDragPreview] = useState<StudioCommentPinDragPreview | null>(null);
  const [reanchorAnnouncement, setReanchorAnnouncement] = useState("");
  const tabbableCommentPinKey = preferredCommentPinKey
    && commentPins.some((pin) => pin.key === preferredCommentPinKey)
    ? preferredCommentPinKey
    : commentPins[0]?.key ?? null;
  const activePreviewPin = !commentQuickReplyActive && activeCommentPreviewKey
    ? commentPins.find((pin) => pin.key === activeCommentPreviewKey)
    : undefined;
  const activePreviewReanchorTarget = activePreviewPin
    ? studioCommentPinReanchorTarget(activePreviewPin)
    : null;
  const activePreviewAnchor = !commentQuickReplyActive && activeCommentPreviewKey
    ? pinButtonRefs.current.get(activeCommentPreviewKey)
    : undefined;
  useEffect(() => {
    if (commentQuickReplyActive) setActiveCommentPreviewKey(null);
  }, [commentQuickReplyActive]);
  useEffect(() => {
    setPreferredCommentPinKey((current) => (
      current && commentPins.some((pin) => pin.key === current)
        ? current
        : commentPins[0]?.key ?? null
    ));
  }, [commentPins]);
  useEffect(() => {
    const activeKeys = new Set<string>();
    for (const pin of commentPins) {
      const target = studioCommentPinReanchorTarget(pin);
      if (!target) continue;
      activeKeys.add(pin.key);
      keyboardReanchorAnchorRef.current.set(pin.key, target.anchor);
    }
    for (const key of keyboardReanchorAnchorRef.current.keys()) {
      if (!activeKeys.has(key)) keyboardReanchorAnchorRef.current.delete(key);
    }
  }, [commentPins]);
  useEffect(() => () => {
    if (suppressedClickTimerRef.current !== null) {
      globalThis.clearTimeout(suppressedClickTimerRef.current);
    }
    const session = dragSessionRef.current;
    if (
      session
      && typeof session.trigger.releasePointerCapture === "function"
      && session.trigger.hasPointerCapture?.(session.pointerId)
    ) {
      try {
        session.trigger.releasePointerCapture(session.pointerId);
      } catch {
        // Pointer capture may already be released while the overlay is unmounting.
      }
    }
    dragSessionRef.current = null;
  }, []);
  const previewCommentPin = (pinKey: string) => {
    onCommentQuickReplyPreload?.();
    if (!commentQuickReplyActive) setActiveCommentPreviewKey(pinKey);
  };
  const focusCommentPin = (currentKey: string, destination: "next" | "previous" | "first" | "last") => {
    if (commentPins.length === 0) return;
    const currentIndex = Math.max(0, commentPins.findIndex((pin) => pin.key === currentKey));
    const nextIndex = destination === "first"
      ? 0
      : destination === "last"
        ? commentPins.length - 1
        : destination === "next"
          ? (currentIndex + 1) % commentPins.length
          : (currentIndex - 1 + commentPins.length) % commentPins.length;
    const nextKey = commentPins[nextIndex]!.key;
    setPreferredCommentPinKey(nextKey);
    pinButtonRefs.current.get(nextKey)?.focus({ preventScroll: true });
  };
  const projectPointerAnchor = (
    pageId: string,
    clientX: number,
    clientY: number
  ): Extract<StudioCommentAnchor, { type: "point" }> | null => {
    const overlay = overlayRef.current;
    if (!overlay) return null;
    const rect = overlay.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return projectStudioCommentPointerToPointAnchor({
      pageId,
      clientX,
      clientY,
      viewportRect: rect,
      canvasWidth,
      canvasHeight,
      canvasFlipH: flipX,
      canvasRotation: rotation,
    });
  };
  const releasePinPointerCapture = (session: StudioCommentPinDragSession) => {
    if (
      typeof session.trigger.releasePointerCapture !== "function"
      || !session.trigger.hasPointerCapture?.(session.pointerId)
    ) return;
    try {
      session.trigger.releasePointerCapture(session.pointerId);
    } catch {
      // A pointercancel/lostcapture race may release it before React receives this event.
    }
  };
  const suppressNextPinClick = (pinKey: string) => {
    suppressedClickPinKeyRef.current = pinKey;
    if (suppressedClickTimerRef.current !== null) {
      globalThis.clearTimeout(suppressedClickTimerRef.current);
    }
    suppressedClickTimerRef.current = globalThis.setTimeout(() => {
      if (suppressedClickPinKeyRef.current === pinKey) {
        suppressedClickPinKeyRef.current = null;
      }
      suppressedClickTimerRef.current = null;
    }, 250);
  };
  const beginPinDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    pin: StudioCanvasCommentPin,
    target: NonNullable<ReturnType<typeof studioCommentPinReanchorTarget>>
  ) => {
    if (
      !onCommentPinReanchor
      || event.isPrimary === false
      || event.button !== 0
    ) return;
    event.stopPropagation();
    setPreferredCommentPinKey(pin.key);
    setActiveCommentPreviewKey(null);
    dragSessionRef.current = {
      pinKey: pin.key,
      threadId: target.threadId,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPointerAnchor: projectPointerAnchor(
        target.anchor.pageId,
        event.clientX,
        event.clientY
      ) ?? target.anchor,
      initialAnchor: target.anchor,
      moved: false,
      latestAnchor: target.anchor,
      trigger: event.currentTarget,
    };
    event.currentTarget.focus({ preventScroll: true });
    if (typeof event.currentTarget.setPointerCapture === "function") {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Some embedded WebViews expose Pointer Events without functional capture.
      }
    }
  };
  const projectPinDragAnchor = (
    session: StudioCommentPinDragSession,
    clientX: number,
    clientY: number
  ): Extract<StudioCommentAnchor, { type: "point" }> | null => {
    const pointerAnchor = projectPointerAnchor(
      session.initialAnchor.pageId,
      clientX,
      clientY
    );
    if (!pointerAnchor) return null;
    return {
      type: "point",
      pageId: session.initialAnchor.pageId,
      x: clamp(
        session.initialAnchor.x + pointerAnchor.x - session.startPointerAnchor.x,
        0,
        1
      ),
      y: clamp(
        session.initialAnchor.y + pointerAnchor.y - session.startPointerAnchor.y,
        0,
        1
      ),
    };
  };
  const movePinDrag = (
    event: ReactPointerEvent<HTMLButtonElement> | PointerEvent,
    stopPropagation = true
  ) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const distance = Math.hypot(
      event.clientX - session.startClientX,
      event.clientY - session.startClientY
    );
    if (!session.moved && distance < STUDIO_COMMENT_PIN_DRAG_THRESHOLD_PX) return;
    const anchor = projectPinDragAnchor(session, event.clientX, event.clientY);
    if (!anchor) return;
    event.preventDefault();
    if (stopPropagation) event.stopPropagation();
    if (!session.moved) {
      session.moved = true;
      setReanchorAnnouncement("댓글 위치 이동 중입니다. 손가락이나 포인터를 놓으면 저장합니다.");
    }
    session.latestAnchor = anchor;
    setDragPreview((current) => (
      current?.pinKey === session.pinKey
      && current.anchor.x === anchor.x
      && current.anchor.y === anchor.y
        ? current
        : { pinKey: session.pinKey, anchor }
    ));
  };
  const finishPinDrag = (
    event: ReactPointerEvent<HTMLButtonElement> | PointerEvent,
    stopPropagation = true
  ) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    dragSessionRef.current = null;
    const droppedAnchor = session.moved
      ? projectPinDragAnchor(session, event.clientX, event.clientY)
        ?? session.latestAnchor
      : session.latestAnchor;
    releasePinPointerCapture(session);
    setDragPreview(null);
    if (!session.moved || !onCommentPinReanchor) return;
    event.preventDefault();
    if (stopPropagation) event.stopPropagation();
    suppressNextPinClick(session.pinKey);
    onCommentPinReanchor({
      pinKey: session.pinKey,
      threadId: session.threadId,
      anchor: droppedAnchor,
      source: "pointer",
    });
    setReanchorAnnouncement("댓글 위치를 옮겼습니다.");
  };
  const cancelPinDrag = (
    event: ReactPointerEvent<HTMLButtonElement> | PointerEvent,
    stopPropagation = true
  ) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    dragSessionRef.current = null;
    releasePinPointerCapture(session);
    setDragPreview(null);
    if (session.moved) {
      event.preventDefault();
      if (stopPropagation) event.stopPropagation();
      setReanchorAnnouncement("댓글 위치 이동을 취소했습니다.");
    }
  };
  globalDragHandlersRef.current = {
    move: movePinDrag,
    finish: finishPinDrag,
    cancel: cancelPinDrag,
  };
  useEffect(() => {
    const ownerWindow = overlayRef.current?.ownerDocument.defaultView;
    if (!ownerWindow) return undefined;
    const handlePointerMove = (event: PointerEvent) => {
      globalDragHandlersRef.current?.move(event, false);
    };
    const handlePointerUp = (event: PointerEvent) => {
      globalDragHandlersRef.current?.finish(event, false);
    };
    const handlePointerCancel = (event: PointerEvent) => {
      globalDragHandlersRef.current?.cancel(event, false);
    };
    ownerWindow.addEventListener("pointermove", handlePointerMove, {
      capture: true,
      passive: true,
    });
    ownerWindow.addEventListener("pointerup", handlePointerUp, { capture: true, passive: true });
    ownerWindow.addEventListener("pointercancel", handlePointerCancel, { capture: true, passive: true });
    return () => {
      ownerWindow.removeEventListener("pointermove", handlePointerMove, { capture: true });
      ownerWindow.removeEventListener("pointerup", handlePointerUp, { capture: true });
      ownerWindow.removeEventListener("pointercancel", handlePointerCancel, { capture: true });
    };
  }, []);
  return (
    <div
      ref={overlayRef}
      aria-label="공동작업 캔버스 오버레이"
      role="group"
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
      data-studio-live-canvas-overlay
    >
      <span aria-atomic="true" aria-live="polite" className="sr-only" role="status">
        {reanchorAnnouncement}
      </span>
      {commentPins.map((pin, index) => {
        const reanchorTarget = studioCommentPinReanchorTarget(pin);
        const allowedByThreadAuthority = !reanchorTarget
          || commentPinReanchorableThreadIds === undefined
          || commentPinReanchorableThreadIds.has(reanchorTarget.threadId);
        const blockedByReanchorPolicy = commentPinReanchorableThreadIds === undefined
          ? Boolean(commentPinReanchorDisabledReason)
          : !allowedByThreadAuthority;
        const reanchorDisabledReason = reanchorTarget
          && onCommentPinReanchor
          && blockedByReanchorPolicy
          ? commentPinReanchorDisabledReason ?? "이 댓글 위치를 옮길 권한이 없어요."
          : undefined;
        const reanchorable = Boolean(
          reanchorTarget
          && onCommentPinReanchor
          && allowedByThreadAuthority
          && !reanchorDisabledReason
        );
        const reanchoring = dragPreview?.pinKey === pin.key;
        const originalProjected = projectStudioLiveOverlayPoint(
          pin.x / canvasWidth,
          pin.y / canvasHeight,
          pin.screenOffsetX ?? 0,
          pin.screenOffsetY ?? 0,
          flipX,
          rotation
        );
        const projected = reanchoring && dragPreview
          ? projectStudioLiveOverlayPoint(
              dragPreview.anchor.x,
              dragPreview.anchor.y,
              0,
              0,
              flipX,
              rotation
            )
          : originalProjected;
        const keyboardShortcuts = reanchorable
          ? "ArrowLeft ArrowRight ArrowUp ArrowDown Home End Enter Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown Alt+Shift+ArrowLeft Alt+Shift+ArrowRight Alt+Shift+ArrowUp Alt+Shift+ArrowDown"
          : "ArrowLeft ArrowRight ArrowUp ArrowDown Home End Enter";
        return (
          <Fragment key={pin.key}>
            {reanchoring ? (
              <span
                aria-hidden
                data-studio-comment-pin-drag-origin="true"
                className="pointer-events-none absolute grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full"
                style={{
                  left: `clamp(1.375rem, calc(${(originalProjected.x * 100).toFixed(4)}% + ${originalProjected.screenOffsetX}px), calc(100% - 1.375rem))`,
                  top: `clamp(1.375rem, calc(${(originalProjected.y * 100).toFixed(4)}% + ${originalProjected.screenOffsetY}px), calc(100% - 1.375rem))`,
                }}
              >
                <span className="size-8 rounded-full border-2 border-dashed border-accent/65 bg-panel/35 shadow-sm" />
              </span>
            ) : null}
            <button
              ref={(node) => {
                if (node) pinButtonRefs.current.set(pin.key, node);
                else pinButtonRefs.current.delete(pin.key);
              }}
              type="button"
              aria-haspopup="dialog"
              aria-keyshortcuts={keyboardShortcuts}
              aria-label={commentPinAccessibleLabel(pin, index, commentPins.length, {
                reanchorable,
                reanchoring,
                reanchorDisabledReason,
              })}
              aria-roledescription={reanchorable ? "이동 가능한 위치 댓글 핀" : undefined}
              data-studio-comment-pin="true"
              data-studio-comment-pin-reanchorable={reanchorable ? "true" : undefined}
              data-studio-comment-pin-reanchoring={reanchoring ? "true" : undefined}
              data-studio-comment-pin-anchor-x={reanchoring && dragPreview
                ? dragPreview.anchor.x.toFixed(4)
                : undefined}
              data-studio-comment-pin-anchor-y={reanchoring && dragPreview
                ? dragPreview.anchor.y.toFixed(4)
                : undefined}
              tabIndex={pin.key === tabbableCommentPinKey ? 0 : -1}
              className={cn(
                "group pointer-events-auto absolute grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-[0.65rem] font-black tabular-nums text-on-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                "[&>[data-pin-marker]]:transition-transform [&>[data-pin-marker]]:duration-200 motion-reduce:[&>[data-pin-marker]]:transition-none hover:[&>[data-pin-marker]]:scale-110",
                reanchorable ? "touch-none cursor-grab active:cursor-grabbing" : null,
                reanchoring ? "z-10 cursor-grabbing [&>[data-pin-marker]]:scale-110 [&>[data-pin-marker]]:ring-4 [&>[data-pin-marker]]:ring-accent/35" : null,
                pin.unreadCount ? "[&>[data-pin-marker]]:ring-4 [&>[data-pin-marker]]:ring-accent/30" : null
              )}
              style={{
                left: `clamp(1.375rem, calc(${(projected.x * 100).toFixed(4)}% + ${projected.screenOffsetX}px), calc(100% - 1.375rem))`,
                top: `clamp(1.375rem, calc(${(projected.y * 100).toFixed(4)}% + ${projected.screenOffsetY}px), calc(100% - 1.375rem))`,
              }}
              title={reanchorable
                ? `${pin.label} · 드래그 또는 Alt+방향키로 위치 이동 · 클릭으로 열기`
                : reanchorDisabledReason
                  ? `${pin.label} · 위치 이동 불가: ${reanchorDisabledReason} · 클릭으로 열기`
                  : pin.previewBody
                    ? undefined
                    : `${pin.label} · ${pin.unreadCount ? `읽지 않음 ${pin.unreadCount}개 · ` : ""}열림 ${pin.count}개`}
              onPointerEnter={() => {
                if (dragSessionRef.current?.pinKey !== pin.key) previewCommentPin(pin.key);
              }}
              onPointerLeave={(event) => {
                if (event.currentTarget.ownerDocument.activeElement === event.currentTarget) return;
                setActiveCommentPreviewKey((current) => current === pin.key ? null : current);
              }}
              onPointerDown={(event) => {
                if (reanchorable && reanchorTarget) beginPinDrag(event, pin, reanchorTarget);
              }}
              onPointerMove={movePinDrag}
              onPointerUp={finishPinDrag}
              onPointerCancel={cancelPinDrag}
              onLostPointerCapture={cancelPinDrag}
              onFocus={() => {
                setPreferredCommentPinKey(pin.key);
                if (dragSessionRef.current?.pinKey !== pin.key) previewCommentPin(pin.key);
              }}
              onBlur={() => setActiveCommentPreviewKey((current) => (
                current === pin.key ? null : current
              ))}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  const dragSession = dragSessionRef.current;
                  if (dragSession?.pinKey === pin.key) {
                    dragSessionRef.current = null;
                    releasePinPointerCapture(dragSession);
                    setDragPreview(null);
                    setReanchorAnnouncement("댓글 위치 이동을 취소했습니다.");
                  }
                  setActiveCommentPreviewKey(null);
                  return;
                }
                const direction = event.key === "ArrowRight"
                  ? { x: 1 as const, y: 0 as const }
                  : event.key === "ArrowLeft"
                    ? { x: -1 as const, y: 0 as const }
                    : event.key === "ArrowDown"
                      ? { x: 0 as const, y: 1 as const }
                      : event.key === "ArrowUp"
                        ? { x: 0 as const, y: -1 as const }
                        : null;
                if (event.altKey && direction) {
                  if (reanchorable && reanchorTarget && onCommentPinReanchor) {
                    event.preventDefault();
                    event.stopPropagation();
                    const keyboardBaseAnchor =
                      keyboardReanchorAnchorRef.current.get(pin.key) ?? reanchorTarget.anchor;
                    const nextAnchor = nudgeStudioCommentPointAnchor({
                      anchor: keyboardBaseAnchor,
                      directionX: direction.x,
                      directionY: direction.y,
                      viewFraction: event.shiftKey
                        ? STUDIO_COMMENT_PIN_KEYBOARD_COARSE_FRACTION
                        : STUDIO_COMMENT_PIN_KEYBOARD_FINE_FRACTION,
                      canvasWidth,
                      canvasHeight,
                      canvasFlipH: flipX,
                      canvasRotation: rotation,
                    });
                    keyboardReanchorAnchorRef.current.set(pin.key, nextAnchor);
                    setActiveCommentPreviewKey(null);
                    onCommentPinReanchor({
                      pinKey: pin.key,
                      threadId: reanchorTarget.threadId,
                      anchor: nextAnchor,
                      source: "keyboard",
                    });
                    setReanchorAnnouncement(event.shiftKey
                      ? "댓글 위치를 크게 옮겼습니다."
                      : "댓글 위치를 조금 옮겼습니다.");
                  } else if (reanchorDisabledReason) {
                    event.preventDefault();
                    event.stopPropagation();
                    setReanchorAnnouncement(`댓글 위치를 옮길 수 없습니다. ${reanchorDisabledReason}`);
                  }
                  return;
                }
                const destination = event.key === "Home"
                  ? "first"
                  : event.key === "End"
                    ? "last"
                    : event.key === "ArrowRight" || event.key === "ArrowDown"
                      ? "next"
                      : event.key === "ArrowLeft" || event.key === "ArrowUp"
                        ? "previous"
                        : null;
                if (!destination) return;
                event.preventDefault();
                event.stopPropagation();
                focusCommentPin(pin.key, destination);
              }}
              onClick={(event) => {
                if (suppressedClickPinKeyRef.current === pin.key) {
                  event.preventDefault();
                  event.stopPropagation();
                  suppressedClickPinKeyRef.current = null;
                  if (suppressedClickTimerRef.current !== null) {
                    globalThis.clearTimeout(suppressedClickTimerRef.current);
                    suppressedClickTimerRef.current = null;
                  }
                  return;
                }
                setPreferredCommentPinKey(pin.key);
                setActiveCommentPreviewKey(null);
                onCommentPinClick({
                  pinKey: pin.key,
                  anchor: pin.anchor,
                  preferredThreadId: pin.newestUnreadThreadId ?? pin.newestThreadId,
                  threadIds: pin.threadIds ?? [],
                  trigger: event.currentTarget,
                });
              }}
            >
              <span data-pin-marker className="relative grid size-8 place-items-center rounded-full border-2 border-panel bg-accent shadow-[0_4px_14px_oklch(0.10_0.02_70/0.42)]">
                {pin.count > 1
                  ? pin.count
                  : pin.previewAuthor
                    ? <span aria-hidden>{initial(pin.previewAuthor)}</span>
                    : <MessageCircle size={14} aria-hidden />}
                {pin.unreadCount ? (
                  <span
                    aria-hidden
                    className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-panel bg-warn shadow-sm"
                  />
                ) : null}
              </span>
            </button>
          </Fragment>
        );
      })}

      {activePreviewPin?.previewBody && activePreviewAnchor ? (
        <StudioCommentPinPreviewPortal
          anchor={activePreviewAnchor}
          author={activePreviewPin.previewAuthor ?? "검토자"}
          body={activePreviewPin.previewBody}
          reanchorable={Boolean(
            activePreviewReanchorTarget
            && onCommentPinReanchor
            && (commentPinReanchorableThreadIds === undefined
              ? !commentPinReanchorDisabledReason
              : commentPinReanchorableThreadIds.has(activePreviewReanchorTarget.threadId))
          )}
        />
      ) : null}

      {cursors.map(({ participant, cursor, chatText }) => {
        const color = studioLiveParticipantColor(participant.sessionId);
        const projected = projectStudioLiveOverlayPoint(
          clamp(cursor.x, 0, 1),
          clamp(cursor.y, 0, 1),
          0,
          0,
          flipX,
          rotation
        );
        const strokeColor = cursor.strokeColor || color;
        const strokeWidth = cursor.strokeWidth || 4;
        const isDrawing = Boolean(cursor.drawing);
        const isEraserTrail = cursor.tool === "eraser";
        const isPixelTrail = cursor.tool === "pixel";
        const trailColor = isEraserTrail ? color : strokeColor;
        const toolLabel = studioLiveCursorToolLabel(cursor.tool);
        const activityLabel = studioLiveCursorActivityLabel(cursor.tool, isDrawing);
        const eraserOutline = Math.max(2, Math.min(4, strokeWidth * 0.22));
        const dash = isEraserTrail ? Math.max(8, strokeWidth * 0.7) : 0;
        const gap = isEraserTrail ? Math.max(6, strokeWidth * 0.45) : 0;

        let pointsString = "";
        if (isDrawing && cursor.points && cursor.points.length >= 4) {
          const pairs: string[] = [];
          for (let i = 0; i < cursor.points.length - 1; i += 2) {
            const px = cursor.points[i];
            const py = cursor.points[i + 1];
            if (typeof px === "number" && typeof py === "number") {
              const proj = projectStudioLiveOverlayPoint(
                clamp(px / canvasWidth, 0, 1),
                clamp(py / canvasHeight, 0, 1),
                0,
                0,
                flipX,
                rotation
              );
              pairs.push(`${(proj.x * canvasWidth).toFixed(1)},${(proj.y * canvasHeight).toFixed(1)}`);
            }
          }
          pointsString = pairs.join(" ");
        }

        return (
          <Fragment key={participant.sessionId}>
            {pointsString ? (
              <svg
                className="pointer-events-none absolute inset-0 z-10 size-full"
                data-studio-live-cursor-trail={isEraserTrail ? "eraser" : isPixelTrail ? "pixel" : "ink"}
                preserveAspectRatio="none"
                viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
              >
                {isEraserTrail ? (
                  <polyline
                    points={pointsString}
                    fill="none"
                    stroke="white"
                    strokeWidth={eraserOutline + 2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={`${dash} ${gap}`}
                    opacity={0.78}
                  />
                ) : null}
                <polyline
                  points={pointsString}
                  fill="none"
                  stroke={trailColor}
                  strokeWidth={isEraserTrail ? eraserOutline : strokeWidth}
                  strokeLinecap={isPixelTrail ? "square" : "round"}
                  strokeLinejoin={isPixelTrail ? "miter" : "round"}
                  strokeDasharray={isEraserTrail ? `${dash} ${gap}` : undefined}
                  opacity={isEraserTrail ? 0.95 : (cursor.strokeOpacity ?? 0.9)}
                  className="motion-safe:transition-all motion-safe:duration-75"
                />
              </svg>
            ) : null}
            <div
              className="absolute left-0 top-0 pointer-events-none z-20 motion-safe:transition-[left,top] motion-safe:duration-75"
              style={{
                left: `${projected.x * 100}%`,
                top: `${projected.y * 100}%`,
              }}
            >
              <div className="relative">
                {isDrawing ? (
                  <span
                    className="absolute -left-3 -top-3 block rounded-full border-2 shadow-md animate-pulse"
                    data-studio-live-cursor-tip={isEraserTrail ? "eraser" : "ink"}
                    style={{
                      width: `${Math.max(12, strokeWidth * 2)}px`,
                      height: `${Math.max(12, strokeWidth * 2)}px`,
                      backgroundColor: isEraserTrail ? "transparent" : strokeColor,
                      borderColor: isEraserTrail ? color : "#fff",
                      boxShadow: isEraserTrail ? `0 0 0 1px ${color}` : undefined,
                    }}
                  />
                ) : null}
                <MousePointer2
                  aria-hidden
                  className="drop-shadow-[0_2px_2px_rgb(0_0_0/0.35)]"
                  fill={color}
                  size={22}
                  stroke="white"
                  strokeWidth={2}
                />
                {chatText ? (
                  <span
                    aria-live="polite"
                    className="absolute left-5 top-6 z-30 block w-max max-w-56 rounded-xl border border-line-strong bg-panel/98 px-3 py-2 text-xs font-semibold leading-relaxed text-fg shadow-[0_10px_30px_oklch(0.06_0.02_70/0.5)] backdrop-blur-md"
                    data-studio-live-cursor-chat="true"
                    role="status"
                  >
                    {chatText}
                  </span>
                ) : null}
                <span
                  className="ml-3 -mt-0.5 block max-w-40 truncate rounded-md px-2 py-1 text-[0.65rem] font-bold leading-none text-white shadow-lg"
                  style={{ backgroundColor: color }}
                >
                  {participant.displayName}
                  {toolLabel ? <span className="ml-1 font-medium opacity-80">· {toolLabel}</span> : null}
                  {activityLabel ? (
                    <span className="ml-1 text-[0.6rem] font-bold animate-pulse">
                      {activityLabel === "그리는 중" ? `✏️ ${activityLabel}` : activityLabel}
                    </span>
                  ) : null}
                </span>
              </div>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

/** Isolated high-frequency subscriber so cursor traffic never rerenders the giant Studio editor. */
export function StudioRemoteCursorOverlay({
  pageId,
  followingSessionId = null,
  canvasWidth,
  canvasHeight,
  trailSuppressedSessionIds,
  hidden = false,
  commentPins,
  onCommentPinClick,
  onCommentPinReanchor,
  commentPinReanchorableThreadIds,
  commentPinReanchorDisabledReason,
  onCommentQuickReplyPreload,
  commentQuickReplyActive = false,
  flipX = false,
  rotation = 0,
}: StudioRemoteCursorOverlayProps) {
  const { room, peers } = useStudioLiveCollaboration();
  const { remoteCursorsVisible } = useStudioLiveViewPreferences();
  const cursorQualityTier = useStudioLiveCursorQuality(room?.workId ?? null)?.tier ?? null;
  const cursors = useStudioRemoteCursors(room);
  const cursorChats = useStudioLiveCursorChatBubbles(room);
  const chatTextBySession = useMemo(
    () => new Map(cursorChats.map((message) => [message.participant.sessionId, message.text] as const)),
    [cursorChats]
  );
  const cursorChatSessionIds = useMemo(
    () => new Set(cursorChats.map((message) => message.participant.sessionId)),
    [cursorChats]
  );
  const presentedCursors = useMemo(
    () => selectStudioLivePresentedCursors({
      cursors,
      peers,
      pageId,
      followingSessionId,
      pinnedSessionIds: cursorChatSessionIds,
      visible: remoteCursorsVisible,
      qualityTier: cursorQualityTier,
    }),
    [
      cursorChatSessionIds,
      cursorQualityTier,
      cursors,
      followingSessionId,
      pageId,
      peers,
      remoteCursorsVisible,
    ]
  );

  // Export/hydration boundaries hide every overlay. The user's cursor preference hides only
  // remote pointers; anchored review comments remain available.
  if (hidden) return null;
  return (
    <StudioLiveCanvasOverlay
      canvasWidth={canvasWidth}
      canvasHeight={canvasHeight}
      cursors={presentedCursors.map((value) => {
        const chatText = chatTextBySession.get(value.participant.sessionId);
        return {
          ...value,
          ...(chatText ? { chatText } : {}),
          cursor: trailSuppressedSessionIds?.has(value.participant.sessionId)
            ? { ...value.cursor, points: undefined }
            : value.cursor,
        };
      })}
      commentPins={commentPins}
      onCommentPinClick={onCommentPinClick}
      onCommentPinReanchor={onCommentPinReanchor}
      commentPinReanchorableThreadIds={commentPinReanchorableThreadIds}
      commentPinReanchorDisabledReason={commentPinReanchorDisabledReason}
      onCommentQuickReplyPreload={onCommentQuickReplyPreload}
      commentQuickReplyActive={commentQuickReplyActive}
      flipX={flipX}
      rotation={rotation}
    />
  );
}

export function StudioLivePresenceDock({
  connected,
  operationSyncReady = false,
  alwaysOn = false,
  peers,
  activeLockCount = 0,
  activeLockLabel = null,
  followingSessionId,
  onOpenTeam,
  onOpenCompanionTab,
  onToggleFollow,
  remoteCursorsVisible = true,
  onToggleRemoteCursors,
  cursorQuality = null,
  syncSnapshot,
  voiceControls,
}: StudioLivePresenceDockProps) {
  // Always-on collab chrome: parent passes alwaysOn while connecting/ready (presence strip).
  if (!alwaysOn && !connected && peers.length === 0) return null;
  const lockCount =
    Number.isFinite(activeLockCount) && activeLockCount > 0
      ? Math.floor(activeLockCount)
      : 0;
  const lockLabel =
    typeof activeLockLabel === "string" && activeLockLabel.trim().length > 0
      ? activeLockLabel.trim()
      : lockCount > 0
        ? `활성 편집 잠금 ${lockCount}개 · 레이어 소유권은 네비게이터 배지로 표시됩니다`
        : null;
  const visibleCount = studioPresenceVisiblePeerCount(peers.length, 5);
  const visiblePeers = peers.slice(0, visibleCount);
  const desktopHiddenPeerCount = Math.max(0, peers.length - visiblePeers.length);
  const desktopOverflow = studioPresenceOverflowLabel(desktopHiddenPeerCount);
  const connectionLabel = studioPresenceConnectionLabel(connected);
  const resolvedSync = syncSnapshot ?? {
    ...INITIAL_STUDIO_LIVE_SYNC_SNAPSHOT,
    phase: connected && operationSyncReady ? "syncing" : connected ? "syncing" : "retrying",
    transportReady: connected,
    operationSyncReady,
    message: connected
      ? operationSyncReady
        ? "원고 보존 경로를 확인하는 중입니다."
        : "원고 연산 동기화를 준비하는 중입니다."
      : connectionLabel,
  };
  const syncPresentation = presentStudioLiveSyncSnapshot(resolvedSync);
  const lastAckLabel = formatStudioLiveLastAck(resolvedSync.lastAckAt);
  const syncAnnouncement = `${syncPresentation.shortLabel}. ${syncPresentation.detail}`;
  const collaborationLabel = `${syncAnnouncement} ${lastAckLabel}.`;
  const followedPeer = peers.find((peer) => peer.sessionId === followingSessionId) ?? null;
  const cursorQualityPresentation = cursorQuality
    ? presentStudioLiveCursorQuality(cursorQuality)
    : null;

  return (
    <div
      data-studio-presence-dock="true"
      data-studio-sync-phase={resolvedSync.phase}
      className="pointer-events-auto flex max-w-[calc(100%-1rem)] flex-wrap items-center justify-end gap-1.5 rounded-xl border border-line/80 bg-panel/95 p-1.5 shadow-xl backdrop-blur-md"
    >
      {syncPresentation.assertive ? (
        <span aria-atomic="true" aria-live="assertive" className="sr-only" role="alert">
          {syncAnnouncement}
        </span>
      ) : (
        <span aria-atomic="true" aria-live="polite" className="sr-only" role="status">
          {syncAnnouncement}
        </span>
      )}
      {onOpenCompanionTab ? (
        <button
          type="button"
          aria-label="새 탭에서 같이 그리기"
          title="새 탭에서 같이 그리기"
          data-studio-presence-companion-tab="true"
          className="grid size-11 shrink-0 place-items-center rounded-lg border border-accent/40 bg-accent-soft text-accent transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none"
          onClick={onOpenCompanionTab}
        >
          <ExternalLink size={16} strokeWidth={1.75} aria-hidden />
        </button>
      ) : null}
      <button
        type="button"
        aria-label="팀 작업 공간 열기"
        title="팀"
        data-studio-presence-team-action="true"
        className="hidden size-11 shrink-0 place-items-center rounded-lg border border-line/60 bg-card/80 text-fg-2 transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none sm:grid"
        onClick={onOpenTeam}
      >
        <UsersRound size={16} strokeWidth={1.75} aria-hidden />
      </button>
      {onToggleRemoteCursors ? (
        <button
          type="button"
          aria-label={remoteCursorsVisible ? "팀원 커서 숨기기" : "팀원 커서 표시하기"}
          aria-pressed={remoteCursorsVisible}
          title={
            remoteCursorsVisible
              ? "팀원 커서 숨기기 · Ctrl/⌘+Alt+\\"
              : "팀원 커서 표시하기 · Ctrl/⌘+Alt+\\"
          }
          data-studio-remote-cursor-visibility={remoteCursorsVisible ? "visible" : "hidden"}
          className="hidden size-11 shrink-0 place-items-center rounded-lg border border-line/60 bg-card/80 text-fg-2 transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none sm:grid"
          onClick={onToggleRemoteCursors}
        >
          {remoteCursorsVisible ? (
            <Eye size={16} strokeWidth={1.75} aria-hidden />
          ) : (
            <EyeOff size={16} strokeWidth={1.75} aria-hidden />
          )}
        </button>
      ) : null}
      <button
        type="button"
        aria-label={`${collaborationLabel} 팀 작업 공간 열기`}
        title={`${syncPresentation.detail} · ${lastAckLabel}`}
        data-studio-presence-link={resolvedSync.phase}
        data-studio-presence-sync-action="true"
        className={cn(
          // Keep the canvas presence dock icon-only throughout the mobile shell. Expanding its
          // status copy at 412px covered the 430px project/save/publish controls because immersive
          // Studio deliberately overlays both chrome rows at the canvas top. The full label and
          // secondary team controls have room only from the desktop `sm` layout onward.
          "inline-flex size-11 min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full border p-0 text-[0.7rem] font-bold transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none sm:w-[16.5rem] sm:justify-start sm:px-3",
          syncToneClass(syncPresentation.tone)
        )}
        onClick={onOpenTeam}
      >
        <StudioSyncStatusIcon phase={resolvedSync.phase} />
        <span className="hidden min-w-0 flex-1 truncate text-left tabular-nums sm:inline">
          {syncPresentation.shortLabel}
        </span>
      </button>

      {cursorQuality && cursorQualityPresentation && cursorQuality.tier !== "live" ? (
        <button
          type="button"
          aria-label={`${cursorQualityPresentation.detail} 팀 작업 공간 열기`}
          title={cursorQualityPresentation.detail}
          data-studio-cursor-quality={cursorQuality.tier}
          className={cn(
            "hidden min-h-11 max-w-44 items-center gap-1.5 rounded-full border px-2.5 text-[0.66rem] font-bold tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent xl:inline-flex",
            syncToneClass(cursorQualityPresentation.tone)
          )}
          onClick={onOpenTeam}
        >
          <Radio size={13} className="shrink-0" aria-hidden />
          <span className="truncate">
            {cursorQualityPresentation.shortLabel} · {cursorQuality.cadenceMs}ms
          </span>
        </button>
      ) : null}

      {voiceControls}

      {lockCount > 0 ? (
        <button
          type="button"
          data-studio-presence-lock-count={lockCount}
          data-studio-presence-lock-label={lockLabel ?? undefined}
          aria-label={`${lockLabel ?? `활성 편집 잠금 ${lockCount}개`}, 팀 작업 공간 열기`}
          title={lockLabel ?? undefined}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-full border border-accent/35 bg-accent-soft px-2.5 text-[0.68rem] font-bold tabular-nums text-accent transition-colors hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onClick={onOpenTeam}
        >
          <ShieldCheck size={14} strokeWidth={2} aria-hidden />
          <span className="hidden sm:inline">{lockCount}</span>
        </button>
      ) : null}

      <div
        className="hidden items-center -space-x-1.5 pl-0.5 sm:flex"
        role="group"
        aria-label="참여자"
        data-studio-presence-stack="true"
      >
        {visiblePeers.map((peer, index) => {
          const following = peer.sessionId === followingSessionId;
          const color = studioLiveParticipantColor(peer.sessionId);
          return (
            <button
              key={peer.sessionId}
              type="button"
              aria-label={
                following
                  ? `${peer.displayName} 따라가기 중지`
                  : `${peer.displayName} 작업 페이지 따라가기`
              }
              aria-pressed={following}
              className={cn(
                "relative grid size-11 shrink-0 place-items-center rounded-full border-2 text-xs font-black shadow-sm transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transform-none motion-reduce:transition-none",
                // Peer hue is data color; cream ink for contrast (DESIGN: no raw white on accent surfaces).
                "text-[oklch(0.96_0.01_85)]",
                following ? "z-10 border-accent ring-2 ring-accent/30" : "border-panel",
                index >= 2 && "hidden sm:grid"
              )}
              style={{ backgroundColor: color, zIndex: following ? 20 : 10 - index }}
              title={`${peer.displayName} · ${roleLabel(peer.role)}${peer.pageId ? " · 클릭해 따라가기" : ""}`}
              onClick={() => onToggleFollow(peer.sessionId)}
            >
              {initial(peer.displayName)}
              <span
                aria-label={peer.visibility === "active" ? "활성" : "자리 비움"}
                className={cn(
                  "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-panel",
                  peer.visibility === "active" ? "bg-good" : "bg-fg-3"
                )}
              />
              {following ? (
                <span className="absolute -right-1.5 -top-1.5 grid size-4 place-items-center rounded-full bg-accent text-on-accent">
                  <Check size={10} aria-hidden />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {desktopOverflow ? (
        <button
          type="button"
          aria-label={`추가 팀원 ${desktopHiddenPeerCount}명, 팀 작업 공간 열기`}
          className="hidden size-11 shrink-0 place-items-center rounded-full border border-line bg-raised text-[0.65rem] font-bold text-fg-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent sm:grid"
          onClick={onOpenTeam}
        >
          {desktopOverflow}
        </button>
      ) : null}

      {followedPeer ? (
        <button
          type="button"
          aria-label={`${followedPeer.displayName} 따라가기 중지`}
          className="order-last ml-auto hidden min-h-11 max-w-full items-center gap-1.5 rounded-lg border border-accent/35 bg-accent-soft px-2.5 text-[0.68rem] font-bold text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent sm:ml-1 sm:inline-flex sm:max-w-40"
          onClick={() => onToggleFollow(followedPeer.sessionId)}
        >
          <span className="truncate">{followedPeer.displayName} 따라가기</span>
          <X size={12} className="shrink-0" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

export function StudioLivePresenceDockConnected({
  operationSyncReady,
  followingSessionId,
  onOpenTeam,
  onToggleFollow,
  onFollowPage,
}: StudioLivePresenceDockConnectedProps) {
  const live = useStudioLiveCollaboration();
  const { availability, peers, locks, sync, room } = live;
  const { remoteCursorsVisible } = useStudioLiveViewPreferences();
  const cursorQuality = useStudioLiveCursorQuality(room?.workId ?? null);
  const followedPeer = peers.find((peer) => peer.sessionId === followingSessionId) ?? null;
  const alwaysOn = studioLivePresenceAlwaysVisible(availability, peers.length);
  // Room lock snapshots are lease-pruned; omit `now` so the pure summary counts the snapshot
  // without calling Date.now during render (React purity).
  const lockOwners = summarizeStudioLiveActiveOwners({
    locks,
    selfSessionId: room?.participant.sessionId,
  });

  useEffect(() => {
    if (followedPeer?.pageId) onFollowPage(followedPeer.pageId);
  }, [followedPeer?.pageId, onFollowPage]);

  useEffect(() => {
    if (followingSessionId && !followedPeer) onToggleFollow(followingSessionId);
  }, [followedPeer, followingSessionId, onToggleFollow]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented
        || event.repeat
        || !isStudioLiveCursorVisibilityShortcut(event)
        || isStudioLiveShortcutTextTarget(event.target)
      ) return;
      event.preventDefault();
      toggleStudioLiveRemoteCursors();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (!alwaysOn) return null;

  return (
    <StudioLivePresenceDock
      connected={availability === "ready"}
      operationSyncReady={operationSyncReady}
      alwaysOn
      onOpenCompanionTab={
        // 인앱 브라우저(카카오톡·인스타그램·네이버앱 …)에서는 window.open 이 언제나 null 을
        // 돌려주므로 이 버튼은 눌러도 아무 일이 없는 죽은 컨트롤이 된다. 실패를 사후에
        // 안내하는 대신 아예 내보내지 않는다 — 모바일 상단 크롬에서 44px 을 되찾는 효과도 있다.
        room && studioCanOpenAuxiliaryWindow()
          ? () => {
              openStudioLiveCompanionTab(room.workId);
            }
          : undefined
      }
      peers={peers}
      activeLockCount={lockOwners.activeLockCount}
      activeLockLabel={lockOwners.label}
      followingSessionId={followingSessionId}
      onOpenTeam={onOpenTeam}
      onToggleFollow={onToggleFollow}
      remoteCursorsVisible={remoteCursorsVisible}
      onToggleRemoteCursors={toggleStudioLiveRemoteCursors}
      cursorQuality={cursorQuality}
      syncSnapshot={sync}
      voiceControls={
        room ? (
          <StudioLiveQuickCollaborationControls
            room={room}
            peers={peers}
            followingSessionId={followingSessionId}
            onToggleFollow={onToggleFollow}
          />
        ) : null
      }
    />
  );
}
