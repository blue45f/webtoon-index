import {
  ArrowDownWideNarrow,
  CheckCircle2,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  CircleDot,
  ClipboardList,
  CornerDownRight,
  Edit3,
  Eye,
  EyeOff,
  HardDrive,
  MapPin,
  MessageSquareText,
  Plus,
  Reply,
  RotateCcw,
  RotateCw,
  Search,
  Send,
  ShieldCheck,
  UserRoundCheck,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";

import {
  studioCommentActorsRepresentSamePerson,
  studioCommentThreadAssignedToActor,
  studioCommentThreadMentionsActor,
} from "./studio-comment-inbox-filter";
import {
  addStudioCommentReply,
  addStudioCommentThread,
  mergeStudioTeamCommentMutableDocument,
  partitionStudioTeamCommentMutableDocument,
  assignStudioCommentThread,
  createStudioCommentMessageId,
  editStudioCommentReply,
  editStudioCommentThread,
  removeStudioCommentReply,
  removeStudioCommentThread,
  reopenStudioCommentThread,
  resolveStudioCommentThread,
  STUDIO_COMMENTS_MAX_BODY_LENGTH,
  STUDIO_COMMENTS_MAX_DISPLAY_NAME_LENGTH,
  STUDIO_COMMENTS_MAX_REPLIES_PER_THREAD,
  STUDIO_COMMENTS_MAX_THREADS,
  STUDIO_COMMENTS_MAX_TOTAL_MESSAGES,
  canonicalStudioCommentAnchorKey,
  studioCommentAnchorsEqual,
  type StudioCommentActor,
  type StudioCommentAnchor,
  type StudioCommentThread,
  type StudioCommentsDocument,
} from "./studio-comments";
import {
  compileStudioReviewTask,
  type StudioReviewTaskPriority,
} from "./studio-review-task-compiler";

export interface StudioCommentAnchorOption {
  anchor: StudioCommentAnchor;
  label: string;
}

export interface StudioCommentsPanelSharedReplySubmission {
  readonly threadId: string;
  readonly body: string;
  /** Stable retry ID owned by the parent comment-thread session, when already prepared. */
  readonly mutationId: string | null;
}

/** Optional controlled reply state shared by the canvas pin popover and this review rail. */
export interface StudioCommentsPanelSharedReplyController {
  readonly threadId: string | null;
  readonly body: string;
  readonly mutationId: string | null;
  readonly submitting: boolean;
  readonly onThreadChange: (threadId: string) => void;
  readonly onBodyChange: (threadId: string, body: string) => void;
  /** Explicit reply cancellation discards the draft; rail close and mode switches preserve it. */
  readonly onDiscard: (threadId: string) => void;
  readonly onSubmit: (
    submission: StudioCommentsPanelSharedReplySubmission
  ) => void | boolean | Promise<void | boolean>;
}

export interface StudioCommentsPanelProps {
  open: boolean;
  onClose: () => void;
  document: StudioCommentsDocument;
  onChange: (
    document: StudioCommentsDocument
  ) => void | boolean | Promise<void | boolean>;
  activeAnchor: StudioCommentAnchor | null;
  currentActor: StudioCommentActor;
  anchorOptions?: readonly StudioCommentAnchorOption[];
  /** Guards a frozen draft anchor against page/frame/element deletion while the rail stays open. */
  isAnchorValid?: (anchor: StudioCommentAnchor) => boolean;
  onSelectAnchor?: (anchor: StudioCommentAnchor) => void;
  /** Figma식 자유 위치 핀: 캔버스 클릭 한 번으로 point 앵커를 잡는 모드를 무장한다. */
  onArmPinPlacement?: () => void;
  capabilities?: Partial<StudioCommentsPanelCapabilities>;
  mutationDisabledReason?: string;
  syncError?: string;
  syncing?: boolean;
  onRefresh?: () => void;
  storageMode?: "document" | "team";
  unreadThreadIds?: ReadonlySet<string>;
  /** 팀 댓글 도입 전에 문서에 저장된 댓글. 내용과 위치는 보존하되 서버 액션은 노출하지 않는다. */
  readOnlyThreadIds?: ReadonlySet<string>;
  pinsHidden?: boolean;
  onTogglePinsHidden?: () => void;
  onMarkThreadRead?: (threadId: string) => void | boolean | Promise<void | boolean>;
  onMarkAllRead?: () => void | boolean | Promise<void | boolean>;
  focusRequest?: { threadId: string; requestId: number } | null;
  onFocusRequestHandled?: (requestId: number) => void;
  /** When present, reply draft and mutation ownership move to the shared parent session. */
  sharedReply?: StudioCommentsPanelSharedReplyController;
}

export interface StudioCommentsPanelCapabilities {
  create: boolean;
  reply: boolean;
  editOwn: boolean;
  deleteOwn: boolean;
  resolve: boolean;
  assign: boolean;
}

type CommentFilter = "current" | "all" | "mine" | "unread" | "assigned" | "mentioned" | "open" | "resolved";
type CommentSort = "recent" | "oldest" | "location";
type CurrentActorRelation = "mentioned" | "assigned" | "authored" | "participated" | null;

interface CommentMessageTarget {
  threadId: string;
  replyId?: string;
}

const FILTERS: readonly { value: CommentFilter; label: string }[] = [
  { value: "current", label: "현재 위치" },
  { value: "all", label: "전체" },
  { value: "mine", label: "나와 관련" },
  { value: "unread", label: "읽지 않음" },
  { value: "assigned", label: "내 담당" },
  { value: "mentioned", label: "나를 멘션" },
  { value: "open", label: "열림" },
  { value: "resolved", label: "해결됨" },
];

const SORTS: readonly { value: CommentSort; label: string }[] = [
  { value: "recent", label: "최근 활동순" },
  { value: "oldest", label: "오래된 활동순" },
  { value: "location", label: "위치순" },
];

const EMPTY_THREAD_IDS: ReadonlySet<string> = new Set<string>();
const EMPTY_ANCHOR_OPTIONS: readonly StudioCommentAnchorOption[] = [];

const DEFAULT_CAPABILITIES: StudioCommentsPanelCapabilities = Object.freeze({
  create: true,
  reply: true,
  editOwn: true,
  deleteOwn: false,
  resolve: true,
  assign: true,
});

const FIELD_CLASS =
  "w-full rounded-lg border border-line bg-card px-3 py-2 text-sm leading-relaxed text-fg outline-none transition-colors placeholder:text-fg-3 hover:border-line-strong focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50";

const QUIET_BUTTON_CLASS =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-line bg-card px-2.5 text-xs font-semibold text-fg-2 transition-colors hover:border-line-strong hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-9 pointer-coarse:min-h-11";

const DATE_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatDate(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time) ? DATE_FORMATTER.format(time) : value;
}

function reviewTaskPriorityClass(priority: StudioReviewTaskPriority): string {
  if (priority === "urgent") return "border-bad/40 bg-bad/10 text-bad";
  if (priority === "high") return "border-warn/40 bg-warn/10 text-warn";
  if (priority === "low") return "border-line bg-raised text-fg-3";
  return "border-cool/35 bg-cool/10 text-cool";
}

function actorInitial(actor: StudioCommentActor): string {
  return Array.from(actor.displayName.trim())[0] ?? "?";
}

function studioCommentThreadCurrentActorRelation(
  thread: StudioCommentThread,
  currentActor: StudioCommentActor
): CurrentActorRelation {
  if (studioCommentThreadMentionsActor(thread, currentActor)) return "mentioned";
  if (studioCommentThreadAssignedToActor(thread, currentActor)) return "assigned";
  if (studioCommentActorsRepresentSamePerson(thread.author, currentActor)) return "authored";
  if (
    thread.replies.some((reply) =>
      studioCommentActorsRepresentSamePerson(reply.author, currentActor)
    )
  ) {
    return "participated";
  }
  return null;
}

function studioCommentCurrentActorRelationLabel(
  relation: CurrentActorRelation
): string | null {
  if (relation === "mentioned") return "나를 멘션";
  if (relation === "assigned") return "내 담당";
  if (relation === "authored") return "내 댓글";
  if (relation === "participated") return "내가 참여";
  return null;
}

function isStudioCommentTextEntryTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.matches("input, textarea, select") || target.isContentEditable);
}

function messageTargetsEqual(
  left: CommentMessageTarget | null,
  right: CommentMessageTarget
): boolean {
  return left?.threadId === right.threadId && left.replyId === right.replyId;
}

function shortId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 5)}…${value.slice(-4)}`;
}

function fallbackAnchorLabel(anchor: StudioCommentAnchor): string {
  if (anchor.type === "page") return `페이지 · ${shortId(anchor.pageId)}`;
  if (anchor.type === "frame") return `컷 · ${shortId(anchor.frameId)}`;
  if (anchor.type === "point") return `위치 · ${Math.round(anchor.x * 100)}%, ${Math.round(anchor.y * 100)}%`;
  return `요소 · ${shortId(anchor.elementId)}`;
}

function getAnchorLabel(
  anchor: StudioCommentAnchor,
  options: readonly StudioCommentAnchorOption[]
): string {
  return options.find((option) => studioCommentAnchorsEqual(option.anchor, anchor))?.label
    ?? fallbackAnchorLabel(anchor);
}

function uniqueStudioCommentAnchorOptions(
  options: readonly StudioCommentAnchorOption[]
): StudioCommentAnchorOption[] {
  const seenAnchorKeys = new Set<string>();
  const uniqueOptions: StudioCommentAnchorOption[] = [];
  for (const option of options) {
    const anchorKey = canonicalStudioCommentAnchorKey(option.anchor);
    if (seenAnchorKeys.has(anchorKey)) continue;
    seenAnchorKeys.add(anchorKey);
    uniqueOptions.push(option);
  }
  return uniqueOptions;
}

export function StudioCommentsPanel({
  open,
  onClose,
  document,
  onChange,
  activeAnchor,
  currentActor,
  anchorOptions = EMPTY_ANCHOR_OPTIONS,
  isAnchorValid = () => true,
  onSelectAnchor,
  onArmPinPlacement,
  capabilities: capabilityOverrides,
  mutationDisabledReason,
  syncError,
  syncing = false,
  onRefresh,
  storageMode = "document",
  unreadThreadIds = EMPTY_THREAD_IDS,
  readOnlyThreadIds = EMPTY_THREAD_IDS,
  pinsHidden = false,
  onTogglePinsHidden,
  onMarkThreadRead,
  onMarkAllRead,
  focusRequest = null,
  onFocusRequestHandled,
  sharedReply,
}: StudioCommentsPanelProps) {
  const titleId = useId();
  const descriptionId = useId();
  const newThreadDisabledReasonId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const replyEditorRef = useRef<HTMLTextAreaElement>(null);
  const assigneeEditorRef = useRef<HTMLInputElement>(null);
  const editEditorRef = useRef<HTMLTextAreaElement>(null);
  const deleteConfirmRef = useRef<HTMLButtonElement>(null);
  const panelWasOpenRef = useRef(false);
  const lastFocusRequestIdRef = useRef<number | null>(null);
  const pendingFocusThreadIdRef = useRef<string | null>(null);
  const pendingNewCommentIdRef = useRef<{
    commentId: string;
    payloadSignature: string;
  } | null>(null);
  const pendingReplyIdRef = useRef<{
    threadId: string;
    replyId: string;
    payloadSignature: string;
  } | null>(null);
  const replySubmitInFlightRef = useRef(false);
  const [filter, setFilter] = useState<CommentFilter>("current");
  const [sort, setSort] = useState<CommentSort>("recent");
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [composerLocationPickerOpen, setComposerLocationPickerOpen] = useState(false);
  const [composerAnchor, setComposerAnchor] = useState<StudioCommentAnchor | null>(null);
  const [composerAnchorLabelSnapshot, setComposerAnchorLabelSnapshot] = useState<string | null>(null);
  const [newComment, setNewComment] = useState("");
  const [replyingThreadId, setReplyingThreadId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [dismissedSharedReplyThreadId, setDismissedSharedReplyThreadId] = useState<string | null>(
    null
  );
  const [expandedTaskThreadId, setExpandedTaskThreadId] = useState<string | null>(null);
  const [assigningThreadId, setAssigningThreadId] = useState<string | null>(null);
  const [assigneeName, setAssigneeName] = useState("");
  const [editingMessage, setEditingMessage] = useState<CommentMessageTarget | null>(null);
  const [editBody, setEditBody] = useState("");
  const [pendingDelete, setPendingDelete] = useState<CommentMessageTarget | null>(null);
  const [query, setQuery] = useState("");
  const [focusedThreadId, setFocusedThreadId] = useState<string | null>(null);
  const [readMutation, setReadMutation] = useState<string | "all" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const capabilities: StudioCommentsPanelCapabilities = {
    ...DEFAULT_CAPABILITIES,
    ...capabilityOverrides,
  };
  const activeReplyThreadId = sharedReply
    ? sharedReply.threadId === dismissedSharedReplyThreadId
      ? null
      : sharedReply.threadId
    : replyingThreadId;
  const ownedReplyThreadId = sharedReply?.threadId ?? replyingThreadId;
  const ownedReplyBody = sharedReply?.body ?? replyBody;
  const activeReplyBody = sharedReply?.threadId === activeReplyThreadId
    ? sharedReply.body
    : replyBody;
  const closeReplyEditor = (
    options: { protectDraft?: boolean } = {}
  ): boolean => {
    // The submit request is already authoritative once it enters the shared controller. Hiding
    // or discarding its draft while that request is in flight would make a successful receipt
    // look canceled and would remove the stable retry payload after a failure.
    if (replySubmitInFlightRef.current || sharedReply?.submitting || saving) return false;
    if (options.protectDraft && ownedReplyBody.trim()) {
      setError("작성 중인 답글을 등록하거나 취소한 뒤 다른 작업을 진행해 주세요.");
      if (sharedReply?.threadId) setDismissedSharedReplyThreadId(null);
      globalThis.requestAnimationFrame(() => replyEditorRef.current?.focus());
      return false;
    }
    if (sharedReply?.threadId) {
      sharedReply.onDiscard(sharedReply.threadId);
      setDismissedSharedReplyThreadId(sharedReply.threadId);
      return true;
    }
    setReplyingThreadId(null);
    setReplyBody("");
    pendingReplyIdRef.current = null;
    return true;
  };
  const composerAnchorValid = composerAnchor !== null && isAnchorValid(composerAnchor);
  const focusReviewRail = () => {
    dialogRef.current?.focus({ preventScroll: true });
  };
  const currentAnchorOptions = uniqueStudioCommentAnchorOptions(anchorOptions);
  const frozenComposerAnchorOption = composerAnchor !== null
    && composerAnchorValid
    && !currentAnchorOptions.some((option) =>
      studioCommentAnchorsEqual(option.anchor, composerAnchor)
    )
    ? {
        anchor: composerAnchor,
        label: composerAnchorLabelSnapshot ?? fallbackAnchorLabel(composerAnchor),
      }
    : null;
  const selectableAnchorOptions = frozenComposerAnchorOption
    ? [frozenComposerAnchorOption, ...currentAnchorOptions]
    : currentAnchorOptions;

  useEffect(() => {
    if (!open || typeof globalThis.document === "undefined") return;
    const previousFocus = globalThis.document.activeElement;
    const reviewRail = dialogRef.current;

    const animationFrame = globalThis.requestAnimationFrame(() => {
      reviewRail?.focus();
    });
    return () => {
      globalThis.cancelAnimationFrame(animationFrame);
      const activeElement = globalThis.document.activeElement;
      if (
        previousFocus instanceof HTMLElement
        && activeElement instanceof Node
        && reviewRail?.contains(activeElement)
      ) {
        previousFocus.focus();
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open || typeof globalThis.document === "undefined") return;
    const animationFrame = globalThis.requestAnimationFrame(() => {
      if (activeReplyThreadId) replyEditorRef.current?.focus();
      else if (assigningThreadId) assigneeEditorRef.current?.focus();
      else if (editingMessage) editEditorRef.current?.focus();
      else if (pendingDelete) deleteConfirmRef.current?.focus();
      else if (composerExpanded) composerRef.current?.focus();
    });
    return () => globalThis.cancelAnimationFrame(animationFrame);
  }, [activeReplyThreadId, assigningThreadId, composerExpanded, editingMessage, open, pendingDelete]);

  useEffect(() => {
    if (!open) {
      panelWasOpenRef.current = false;
      pendingFocusThreadIdRef.current = null;
      return;
    }
    if (panelWasOpenRef.current) return;
    panelWasOpenRef.current = true;
    if (sharedReply?.threadId) setDismissedSharedReplyThreadId(null);
    const preserveReplyDraft = Boolean(
      ownedReplyThreadId
      && ownedReplyBody.trim()
      && document.threads.some(
        (thread) => thread.id === ownedReplyThreadId
      )
    );
    setFilter(preserveReplyDraft ? "all" : activeAnchor ? "current" : "all");
    if (preserveReplyDraft) setQuery("");
    if (!newComment.trim()) {
      setComposerAnchor(activeAnchor);
      setComposerAnchorLabelSnapshot(
        activeAnchor ? getAnchorLabel(activeAnchor, anchorOptions) : null
      );
      // "댓글 검토함"은 항상 review rail로 열린다. 댓글이 없는 위치에서도 일반 page
      // composer를 자동으로 덮지 않아야 정확한 "캔버스에 바로 댓글" 진입점이 보인다.
      setComposerExpanded(false);
      setComposerLocationPickerOpen(false);
    }
    if (!sharedReply && !preserveReplyDraft) {
      setReplyingThreadId(null);
      setReplyBody("");
      pendingReplyIdRef.current = null;
    }
    setAssigningThreadId(null);
    setExpandedTaskThreadId(null);
    setEditingMessage(null);
    setPendingDelete(null);
    if (!newComment.trim() && !preserveReplyDraft) setError(null);
  }, [
    activeAnchor,
    anchorOptions,
    capabilities.create,
    document.threads,
    newComment,
    open,
    ownedReplyBody,
    ownedReplyThreadId,
    sharedReply,
  ]);

  useEffect(() => {
    if (
      !open
      || !focusRequest
      || lastFocusRequestIdRef.current === focusRequest.requestId
    ) return;
    lastFocusRequestIdRef.current = focusRequest.requestId;
    pendingFocusThreadIdRef.current = focusRequest.threadId;
    onFocusRequestHandled?.(focusRequest.requestId);
    setFilter("current");
    setQuery("");
    if (!newComment.trim()) {
      setComposerExpanded(false);
      setComposerLocationPickerOpen(false);
      setComposerAnchor(null);
      setComposerAnchorLabelSnapshot(null);
    }
    if (!sharedReply) {
      setReplyingThreadId(null);
      setReplyBody("");
      pendingReplyIdRef.current = null;
    }
    setAssigningThreadId(null);
    setExpandedTaskThreadId(null);
    setEditingMessage(null);
    setPendingDelete(null);
    setError(null);
  }, [focusRequest, newComment, onFocusRequestHandled, open, sharedReply]);

  useEffect(() => {
    if (!open || !pendingFocusThreadIdRef.current) return;
    const animationFrame = globalThis.requestAnimationFrame(() => {
      const threadId = pendingFocusThreadIdRef.current;
      const thread = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>("[data-studio-comment-thread-id]") ?? []
      ).find((candidate) => candidate.dataset.studioCommentThreadId === threadId);
      if (!thread) return;
      pendingFocusThreadIdRef.current = null;
      setFocusedThreadId(threadId);
      thread.focus({ preventScroll: true });
      thread.scrollIntoView({ block: "nearest", behavior: "auto" });
    });
    return () => globalThis.cancelAnimationFrame(animationFrame);
  }, [document.threads, filter, focusRequest, open, query, sort]);

  if (!open || typeof globalThis.document === "undefined") return null;

  const {
    mutableDocument,
    readOnlyThreads,
    mutableMessageCount: mutableTotalMessages,
    readOnlyMessageCount,
  } = partitionStudioTeamCommentMutableDocument(document, readOnlyThreadIds);
  const mutableThreads = mutableDocument.threads;
  const totalMessages = mutableTotalMessages + readOnlyMessageCount;
  const openCount = document.threads.filter((thread) => !thread.resolved).length;
  const resolvedCount = document.threads.length - openCount;
  const unreadCount = document.threads.filter((thread) => unreadThreadIds.has(thread.id)).length;
  const mineCount = document.threads.filter(
    (thread) => studioCommentThreadCurrentActorRelation(thread, currentActor) !== null
  ).length;
  const currentCount = activeAnchor
    ? document.threads.filter((thread) =>
        studioCommentAnchorsEqual(thread.anchor, activeAnchor)
      ).length
    : 0;
  const assignedCount = document.threads.filter((thread) =>
    studioCommentThreadAssignedToActor(thread, currentActor)
  ).length;
  const mentionedCount = document.threads.filter((thread) =>
    studioCommentThreadMentionsActor(thread, currentActor)
  ).length;
  const filterCounts: Record<CommentFilter, number> = {
    current: currentCount,
    all: document.threads.length,
    mine: mineCount,
    unread: unreadCount,
    assigned: assignedCount,
    mentioned: mentionedCount,
    open: openCount,
    resolved: resolvedCount,
  };
  const normalizedQuery = query.trim().normalize("NFKC").toLocaleLowerCase();
  const visibleThreads = document.threads
    .filter((thread) => {
      if (filter === "current") {
        return activeAnchor
          ? studioCommentAnchorsEqual(thread.anchor, activeAnchor)
          : false;
      }
      if (filter === "mine") {
        return studioCommentThreadCurrentActorRelation(thread, currentActor) !== null;
      }
      if (filter === "unread") return unreadThreadIds.has(thread.id);
      if (filter === "assigned") {
        return studioCommentThreadAssignedToActor(thread, currentActor);
      }
      if (filter === "mentioned") {
        return studioCommentThreadMentionsActor(thread, currentActor);
      }
      if (filter === "open") return !thread.resolved;
      if (filter === "resolved") return thread.resolved;
      return true;
    })
    .filter((thread) => {
      if (!normalizedQuery) return true;
      return [
        thread.author.displayName,
        thread.body,
        thread.assignee?.displayName ?? "",
        ...thread.mentions.map((mention) => mention.displayName),
        ...thread.replies.flatMap((reply) => [
          reply.author.displayName,
          reply.body,
          ...reply.mentions.map((mention) => mention.displayName),
        ]),
      ].some((value) => value.normalize("NFKC").toLocaleLowerCase().includes(normalizedQuery));
    })
    .slice()
    .sort((left, right) => {
      if (sort === "oldest") {
        return Date.parse(left.updatedAt) - Date.parse(right.updatedAt)
          || left.id.localeCompare(right.id);
      }
      if (sort === "location") {
        return getAnchorLabel(left.anchor, anchorOptions).localeCompare(
          getAnchorLabel(right.anchor, anchorOptions),
          "ko-KR"
        ) || Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
      }
      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
        || right.id.localeCompare(left.id);
    });
  const activeReviewThreadId = visibleThreads.some((thread) => thread.id === focusedThreadId)
    ? focusedThreadId
    : visibleThreads[0]?.id ?? null;
  const activeReviewThreadIndex = activeReviewThreadId
    ? visibleThreads.findIndex((thread) => thread.id === activeReviewThreadId)
    : -1;
  const reviewNavigationBlocked = Boolean(
    composerExpanded
    || activeReplyThreadId
    || assigningThreadId
    || editingMessage
    || pendingDelete
    || saving
    || sharedReply?.submitting
  );
  const focusVisibleThreadAt = (index: number): void => {
    const nextThread = visibleThreads[index];
    if (!nextThread) return;
    setFocusedThreadId(nextThread.id);
    globalThis.requestAnimationFrame(() => {
      const thread = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>("[data-studio-comment-thread-id]") ?? []
      ).find((candidate) => candidate.dataset.studioCommentThreadId === nextThread.id);
      thread?.focus({ preventScroll: true });
      thread?.scrollIntoView({ block: "nearest", behavior: "auto" });
    });
  };
  const moveReviewFocus = (direction: -1 | 1): void => {
    if (reviewNavigationBlocked || visibleThreads.length === 0) return;
    const currentIndex = Math.max(0, activeReviewThreadIndex);
    focusVisibleThreadAt(Math.min(
      visibleThreads.length - 1,
      Math.max(0, currentIndex + direction)
    ));
  };
  const canAddThread =
    capabilities.create
    && !saving
    && mutableThreads.length < STUDIO_COMMENTS_MAX_THREADS
    && mutableTotalMessages < STUDIO_COMMENTS_MAX_TOTAL_MESSAGES;
  const newThreadDisabledReason = canAddThread
    ? null
    : mutationDisabledReason
      ?? (!capabilities.create
        ? "현재 권한으로는 새 댓글을 남길 수 없어요."
        : saving
          ? "댓글을 동기화하는 중이에요."
          : "댓글 문서의 저장 한도에 도달했어요.");
  const currentSelectionCommentDisabledReason = !activeAnchor
    ? "먼저 캔버스에서 페이지, 컷 또는 요소를 선택하세요."
    : newThreadDisabledReason;

  const applyChange = async (
    operation: () => StudioCommentsDocument,
    fallbackMessage: string
  ): Promise<boolean> => {
    if (saving) return false;
    try {
      const nextDocument = operation();
      if (nextDocument === document) return false;
      setSaving(true);
      const accepted = await onChange(nextDocument);
      if (accepted === false) throw new Error(fallbackMessage);
      setError(null);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : fallbackMessage);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const submitComment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!capabilities.create) {
      setError(mutationDisabledReason ?? "현재 권한으로는 새 댓글을 남길 수 없어요.");
      return;
    }
    if (!composerAnchor) {
      setError("댓글을 연결할 페이지, 컷 또는 요소를 먼저 선택해 주세요.");
      return;
    }
    if (!isAnchorValid(composerAnchor)) {
      setError("댓글을 연결한 위치가 삭제되었습니다. 새 위치를 선택해 주세요.");
      return;
    }
    const payloadSignature = JSON.stringify([
      canonicalStudioCommentAnchorKey(composerAnchor),
      newComment.trim(),
    ]);
    const pendingComment = pendingNewCommentIdRef.current?.payloadSignature === payloadSignature
      ? pendingNewCommentIdRef.current
      : { commentId: createStudioCommentMessageId("comment"), payloadSignature };
    pendingNewCommentIdRef.current = pendingComment;
    const saved = await applyChange(
      () => mergeStudioTeamCommentMutableDocument(
        addStudioCommentThread(mutableDocument, {
          id: pendingComment.commentId,
          anchor: composerAnchor,
          author: currentActor,
          body: newComment,
        }),
        readOnlyThreads
      ),
      "댓글을 저장하지 못했어요."
    );
    if (saved) {
      focusReviewRail();
      setNewComment("");
      setComposerExpanded(false);
      setComposerLocationPickerOpen(false);
      setComposerAnchor(null);
      setComposerAnchorLabelSnapshot(null);
      pendingNewCommentIdRef.current = null;
    }
  };

  const submitReply = async (event: FormEvent<HTMLFormElement>, threadId: string) => {
    event.preventDefault();
    if (replySubmitInFlightRef.current || sharedReply?.submitting) return;
    if (!capabilities.reply) {
      setError(mutationDisabledReason ?? "현재 권한으로는 답글을 남길 수 없어요.");
      return;
    }
    const body = sharedReply?.threadId === threadId ? sharedReply.body : replyBody;
    if (!body.trim()) return;
    replySubmitInFlightRef.current = true;
    try {
      if (sharedReply) {
        const accepted = await sharedReply.onSubmit({
          threadId,
          body: body.trim(),
          mutationId: sharedReply.mutationId,
        });
        if (accepted === false) throw new Error("답글을 저장하지 못했어요.");
        setError(null);
        focusReviewRail();
        return;
      }

      const payloadSignature = JSON.stringify([threadId, body.trim()]);
      const pendingReply = pendingReplyIdRef.current?.threadId === threadId
        && pendingReplyIdRef.current.payloadSignature === payloadSignature
        ? pendingReplyIdRef.current
        : { threadId, replyId: createStudioCommentMessageId("reply"), payloadSignature };
      pendingReplyIdRef.current = pendingReply;
      const saved = await applyChange(
        () => mergeStudioTeamCommentMutableDocument(
          addStudioCommentReply(mutableDocument, threadId, {
            id: pendingReply.replyId,
            author: currentActor,
            body,
          }),
          readOnlyThreads
        ),
        "답글을 저장하지 못했어요."
      );
      if (saved) {
        focusReviewRail();
        setReplyBody("");
        setReplyingThreadId(null);
        pendingReplyIdRef.current = null;
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "답글을 저장하지 못했어요.");
    } finally {
      replySubmitInFlightRef.current = false;
    }
  };

  const submitAssignee = async (event: FormEvent<HTMLFormElement>, threadId: string) => {
    event.preventDefault();
    const displayName = assigneeName.trim().slice(0, STUDIO_COMMENTS_MAX_DISPLAY_NAME_LENGTH);
    if (!displayName) {
      setError("담당자 표시 이름을 입력해 주세요.");
      return;
    }
    const assignee = displayName === currentActor.displayName
      ? currentActor
      : { displayName };
    const saved = await applyChange(
      () => assignStudioCommentThread(document, threadId, assignee),
      "담당자를 지정하지 못했어요."
    );
    if (saved) {
      focusReviewRail();
      setAssigningThreadId(null);
    }
  };

  const assignToCurrentActor = async (threadId: string) => {
    const saved = await applyChange(
      () => assignStudioCommentThread(document, threadId, currentActor),
      "담당자를 지정하지 못했어요."
    );
    if (saved) {
      focusReviewRail();
      setAssigningThreadId(null);
    }
  };

  const clearAssignee = async (threadId: string) => {
    const saved = await applyChange(
      () => assignStudioCommentThread(document, threadId, null),
      "담당자 배정을 해제하지 못했어요."
    );
    if (saved) {
      focusReviewRail();
      setAssigningThreadId(null);
    }
  };

  const beginEditing = (target: CommentMessageTarget, body: string) => {
    if (!closeReplyEditor({ protectDraft: true })) return;
    setEditingMessage(target);
    setEditBody(body);
    setPendingDelete(null);
    setAssigningThreadId(null);
    setError(null);
  };

  const cancelEditing = () => {
    focusReviewRail();
    setEditingMessage(null);
    setEditBody("");
  };

  const submitEdit = async (event: FormEvent<HTMLFormElement>, target: CommentMessageTarget) => {
    event.preventDefault();
    const saved = await applyChange(
      () => target.replyId
        ? editStudioCommentReply(document, target.threadId, target.replyId, { body: editBody })
        : editStudioCommentThread(document, target.threadId, { body: editBody }),
      "댓글을 수정하지 못했어요."
    );
    if (saved) cancelEditing();
  };

  const confirmDelete = async (target: CommentMessageTarget) => {
    const saved = await applyChange(
      () => target.replyId
        ? removeStudioCommentReply(document, target.threadId, target.replyId)
        : removeStudioCommentThread(document, target.threadId),
      "댓글을 삭제하지 못했어요."
    );
    if (saved) {
      focusReviewRail();
      setPendingDelete(null);
      if (messageTargetsEqual(editingMessage, target)) cancelEditing();
    }
  };

  const navigateToAnchor = (anchor: StudioCommentAnchor) => {
    if (!onSelectAnchor) return;
    onSelectAnchor(anchor);
  };

  const markThreadRead = async (threadId: string): Promise<void> => {
    if (!onMarkThreadRead || !unreadThreadIds.has(threadId) || readMutation) return;
    setReadMutation(threadId);
    try {
      const accepted = await onMarkThreadRead(threadId);
      if (accepted === false) throw new Error("댓글을 읽음 처리하지 못했어요.");
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "댓글을 읽음 처리하지 못했어요.");
    } finally {
      setReadMutation(null);
    }
  };

  const markAllRead = async (): Promise<void> => {
    if (!onMarkAllRead || unreadCount === 0 || readMutation) return;
    setReadMutation("all");
    try {
      const accepted = await onMarkAllRead();
      if (accepted === false) throw new Error("모든 댓글을 읽음 처리하지 못했어요.");
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "모든 댓글을 읽음 처리하지 못했어요.");
    } finally {
      setReadMutation(null);
    }
  };

  const beginQuickReply = (threadId: string): void => {
    if (replySubmitInFlightRef.current || sharedReply?.submitting || saving) return;

    if (
      ownedReplyThreadId
      && ownedReplyThreadId !== threadId
      && ownedReplyBody.trim()
    ) {
      setError("작성 중인 답글을 등록하거나 취소한 뒤 다른 댓글에 답글을 남겨 주세요.");
      if (sharedReply?.threadId) setDismissedSharedReplyThreadId(null);
      globalThis.requestAnimationFrame(() => replyEditorRef.current?.focus());
      return;
    }

    if (sharedReply) {
      setDismissedSharedReplyThreadId(null);
      if (sharedReply.threadId !== threadId) sharedReply.onThreadChange(threadId);
    } else {
      if (replyingThreadId !== threadId) {
        setReplyBody("");
        pendingReplyIdRef.current = null;
      }
      setReplyingThreadId(threadId);
    }
    setAssigningThreadId(null);
    setEditingMessage(null);
    setEditBody("");
    setPendingDelete(null);
    setError(null);

    if (activeReplyThreadId === threadId) {
      globalThis.requestAnimationFrame(() => replyEditorRef.current?.focus());
    }
  };

  let emptyTitle = "이 조건에 맞는 댓글이 없어요";
  let emptyDescription = "필터를 바꾸거나 새 댓글을 등록하면 여기에 표시됩니다.";
  if (normalizedQuery) {
    emptyTitle = "검색 결과가 없어요";
    emptyDescription = "다른 작성자 이름이나 댓글 문구로 다시 검색해 보세요.";
  } else if (filter === "mine") {
    emptyTitle = "나와 관련된 댓글이 없어요";
    emptyDescription = "내가 작성·답글·담당·멘션된 댓글을 한곳에 모아 보여 드립니다.";
  } else if (filter === "unread") {
    emptyTitle = "새 피드백을 모두 확인했어요";
    emptyDescription = "새 댓글이나 답글이 도착하면 여기에 모아 보여 드립니다.";
  } else if (filter === "current" && !activeAnchor) {
    emptyTitle = "선택한 위치가 없어요";
    emptyDescription = "캔버스에서 페이지, 컷 또는 요소를 선택하거나 전체 댓글을 확인하세요.";
  } else if (filter === "current") {
    emptyDescription = "이 위치의 첫 댓글을 위에서 남겨 보세요.";
  }

  const activeAnchorLabel = activeAnchor
    ? getAnchorLabel(activeAnchor, anchorOptions)
    : "선택한 위치 없음";
  const composerAnchorLabel = composerAnchor
    ? composerAnchorLabelSnapshot ?? getAnchorLabel(composerAnchor, anchorOptions)
    : "선택한 위치 없음";
  const reviewRailClassName = composerExpanded
    ? "fixed inset-x-2 bottom-[calc(7rem+env(safe-area-inset-bottom))] z-[80] m-0 ml-0 flex max-h-[min(72dvh,34rem)] max-w-none flex-col overflow-hidden rounded-2xl border border-line bg-panel p-0 text-fg shadow-[0_-18px_48px_oklch(0.08_0.01_70/0.35)] outline-none sm:inset-x-auto sm:bottom-auto sm:right-3 sm:top-1/2 sm:w-[min(24rem,calc(100vw-1.5rem))] sm:-translate-y-1/2 sm:shadow-[0_18px_60px_oklch(0.08_0.01_70/0.48)]"
    : "fixed inset-x-2 bottom-[calc(7rem+env(safe-area-inset-bottom))] top-auto z-[80] m-0 ml-0 flex h-[min(62dvh,36rem)] max-h-none max-w-none flex-col overflow-hidden rounded-2xl border border-line bg-panel p-0 text-fg shadow-[0_-18px_48px_oklch(0.08_0.01_70/0.35)] outline-none sm:inset-y-3 sm:right-3 sm:left-auto sm:h-auto sm:w-[min(27rem,calc(100vw-1.5rem))] sm:rounded-2xl sm:border sm:shadow-[0_18px_60px_oklch(0.08_0.01_70/0.48)]";

  const reviewRail = (
    <dialog
      open
      id="studio-comments-review-dialog"
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={saving || sharedReply?.submitting || readMutation !== null || syncing}
      tabIndex={-1}
      data-studio-comments-rail="true"
      aria-keyshortcuts="J K /"
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (event.target === searchInputRef.current && query) {
            setQuery("");
            globalThis.requestAnimationFrame(() => searchInputRef.current?.focus());
          } else if (pendingDelete) {
            focusReviewRail();
            setPendingDelete(null);
          } else if (editingMessage) {
            cancelEditing();
          } else if (activeReplyThreadId) {
            if (replySubmitInFlightRef.current || sharedReply?.submitting || saving) return;
            focusReviewRail();
            closeReplyEditor();
          } else if (ownedReplyThreadId && ownedReplyBody.trim()) {
            setError("보존 중인 답글을 등록하거나 취소한 뒤 검토함을 닫아 주세요.");
            if (sharedReply?.threadId) setDismissedSharedReplyThreadId(null);
            globalThis.requestAnimationFrame(() => replyEditorRef.current?.focus());
          } else if (assigningThreadId) {
            focusReviewRail();
            setAssigningThreadId(null);
          } else if (composerExpanded) {
            focusReviewRail();
            setComposerExpanded(false);
            setNewComment("");
            setComposerAnchor(null);
            setComposerAnchorLabelSnapshot(null);
            pendingNewCommentIdRef.current = null;
          } else {
            onClose();
          }
          return;
        }
        if (
          event.defaultPrevented
          || event.metaKey
          || event.ctrlKey
          || event.altKey
          || isStudioCommentTextEntryTarget(event.target)
        ) return;
        if (event.key === "/") {
          event.preventDefault();
          searchInputRef.current?.focus();
          return;
        }
        const shortcut = event.key.toLocaleLowerCase();
        if (shortcut === "j" || shortcut === "k") {
          event.preventDefault();
          moveReviewFocus(shortcut === "j" ? 1 : -1);
        }
      }}
      className={reviewRailClassName}
    >
      <header className="flex shrink-0 items-start gap-3 border-b border-line px-4 py-3">
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border border-line bg-card text-accent">
          <MessageSquareText size={17} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={titleId} className="text-sm font-bold text-fg">
              {composerExpanded ? "새 댓글" : "검토 댓글"}
            </h2>
            <span className="inline-flex items-center gap-1 rounded-md border border-cool/30 bg-cool/10 px-1.5 py-0.5 text-[0.62rem] font-semibold text-cool" title={storageMode === "team" ? "팀 댓글 서버에 안전하게 동기화됩니다." : "프로젝트 파일에 댓글이 함께 저장됩니다."}>
              <HardDrive size={10} aria-hidden />
              {storageMode === "team" ? "팀 동기화" : "문서 저장"}
            </span>
            {unreadCount > 0 ? (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 py-0.5 text-[0.62rem] font-bold tabular-nums text-on-accent" aria-label={`읽지 않은 댓글 ${unreadCount}개`}>
                새 글 {unreadCount}
              </span>
            ) : null}
          </div>
          <p id={descriptionId} className="mt-0.5 truncate text-xs leading-relaxed text-fg-3">
            {composerExpanded
              ? "클릭한 위치에 바로 피드백을 남겨요."
              : "캔버스를 보며 위치별 피드백을 검토하세요."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {!composerExpanded ? <span className="rounded-md bg-raised px-2 py-1 text-[0.65rem] font-semibold tabular-nums text-fg-2" aria-label={`열린 댓글 ${openCount}개`}>
            열림 {openCount}
          </span> : null}
          {onRefresh && !composerExpanded ? (
            <button
              type="button"
              onClick={onRefresh}
              disabled={syncing}
              aria-label={syncing ? "팀 댓글 동기화 중" : "팀 댓글 새로고침"}
              title={syncing ? "팀 댓글 동기화 중" : "팀 댓글 새로고침"}
              className="grid size-11 shrink-0 place-items-center rounded-lg border border-line bg-card text-fg-3 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-60 sm:size-9"
            >
              <RotateCw size={15} className={syncing ? "animate-spin motion-reduce:animate-none" : undefined} aria-hidden />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label={composerExpanded ? "댓글 작성 닫기" : "검토 댓글 닫기"}
            title={ownedReplyThreadId && ownedReplyBody.trim()
              ? "닫기 · 작성 중인 답글은 유지됩니다"
              : "닫기 (Esc)"}
            className="grid size-11 shrink-0 place-items-center rounded-lg border border-line bg-card text-fg-3 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:size-9"
          >
            <X size={16} aria-hidden />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2 [scrollbar-gutter:stable]">
          {composerExpanded ? (
            <form onSubmit={submitComment} className="bg-card/25 px-4 py-3">
              <div className="flex min-w-0 items-start gap-2 rounded-xl border border-line bg-panel/75 p-2.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                  <MapPin size={14} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <span className="block text-[0.68rem] font-semibold text-fg-3">
                    댓글 위치
                  </span>
                  <p className="mt-0.5 truncate text-xs font-semibold text-fg" title={composerAnchorLabel}>
                    {composerAnchorLabel}
                  </p>
                </div>
                {selectableAnchorOptions.length > 0 && onSelectAnchor ? (
                  <button
                    type="button"
                    aria-expanded={composerLocationPickerOpen}
                    onClick={() => setComposerLocationPickerOpen((current) => !current)}
                    className={QUIET_BUTTON_CLASS}
                  >
                    위치 변경
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    focusReviewRail();
                    setComposerExpanded(false);
                    setComposerLocationPickerOpen(false);
                    setNewComment("");
                    setComposerAnchor(null);
                    setComposerAnchorLabelSnapshot(null);
                    pendingNewCommentIdRef.current = null;
                    setError(null);
                  }}
                  className={QUIET_BUTTON_CLASS}
                >
                  취소
                </button>
              </div>
              {composerAnchor && !composerAnchorValid ? (
                <p role="status" className="mt-2 rounded-lg border border-warn/35 bg-warn/10 px-2.5 py-2 text-[0.7rem] font-semibold text-warn">
                  연결 위치가 삭제되었어요. 아래에서 새 위치를 선택해 주세요.
                </p>
              ) : null}
              {(composerLocationPickerOpen || !composerAnchorValid)
                && selectableAnchorOptions.length > 0
                && onSelectAnchor ? (
                  <div className="mt-2 min-w-0">
                    <label htmlFor={`${titleId}-anchor`} className="sr-only">댓글 연결 위치</label>
                    <select
                      id={`${titleId}-anchor`}
                      value={composerAnchor ? canonicalStudioCommentAnchorKey(composerAnchor) : ""}
                      onChange={(event) => {
                        const option = selectableAnchorOptions.find(
                          (candidate) => canonicalStudioCommentAnchorKey(candidate.anchor) === event.target.value
                        );
                        if (option) {
                          setComposerAnchor(option.anchor);
                          setComposerAnchorLabelSnapshot(option.label);
                          onSelectAnchor(option.anchor);
                          setComposerLocationPickerOpen(false);
                        }
                      }}
                      className={FIELD_CLASS}
                    >
                      <option value="">위치를 선택하세요</option>
                      {selectableAnchorOptions.map((option) => (
                        <option key={canonicalStudioCommentAnchorKey(option.anchor)} value={canonicalStudioCommentAnchorKey(option.anchor)}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              <label htmlFor={`${titleId}-body`} className="sr-only">댓글 내용</label>
              <textarea
                ref={composerRef}
                id={`${titleId}-body`}
                value={newComment}
                maxLength={STUDIO_COMMENTS_MAX_BODY_LENGTH}
                rows={4}
                disabled={!composerAnchorValid || !canAddThread || saving}
                placeholder={!composerAnchor
                  ? "먼저 페이지, 컷 또는 요소를 선택해 주세요."
                  : !composerAnchorValid
                    ? "삭제되지 않은 페이지, 컷 또는 요소를 다시 선택해 주세요."
                    : "수정할 점이나 확인이 필요한 내용을 남겨 주세요."}
                aria-keyshortcuts="Control+Enter Meta+Enter"
                onChange={(event) =>
                  setNewComment(event.target.value.slice(0, STUDIO_COMMENTS_MAX_BODY_LENGTH))
                }
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
                className={`${FIELD_CLASS} mt-2 min-h-28 resize-y text-sm leading-relaxed`}
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[0.7rem] text-fg-3">
                  {canAddThread ? "⌘/Ctrl + Enter로 등록" : newThreadDisabledReason}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[0.7rem] tabular-nums text-fg-3">
                    {newComment.length.toLocaleString("ko-KR")}/{STUDIO_COMMENTS_MAX_BODY_LENGTH.toLocaleString("ko-KR")}
                  </span>
                  <button
                    type="submit"
                    disabled={!composerAnchorValid || !canAddThread || !newComment.trim()}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-xs font-bold text-on-accent transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-9"
                  >
                    <Send size={13} aria-hidden />
                    등록
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-2 border-b border-line bg-card/20 px-4 py-2.5">
              <div className="min-w-0 flex-1 basis-40">
                <p className="text-[0.68rem] font-semibold text-fg-3">선택한 피드백 위치</p>
                <p className="mt-0.5 truncate text-xs font-semibold text-fg" title={activeAnchorLabel}>
                  {activeAnchorLabel}
                </p>
              </div>
              {onArmPinPlacement && capabilities.create ? (
                <button
                  type="button"
                  onClick={() => {
                    if (!closeReplyEditor({ protectDraft: true })) return;
                    onArmPinPlacement();
                  }}
                  className={QUIET_BUTTON_CLASS}
                  title="캔버스를 한 번 클릭한 뒤 그 자리에서 바로 댓글을 작성합니다"
                >
                  <MapPin size={13} aria-hidden />
                  위치 찍고 댓글
                </button>
              ) : null}
              <button
                type="button"
                disabled={!activeAnchor || !canAddThread}
                aria-describedby={currentSelectionCommentDisabledReason
                  ? newThreadDisabledReasonId
                  : undefined}
                title={currentSelectionCommentDisabledReason
                  ?? "현재 선택한 페이지, 컷 또는 요소에 댓글을 남깁니다"}
                onClick={() => {
                  if (!closeReplyEditor({ protectDraft: true })) return;
                  setComposerAnchor(activeAnchor);
                  setComposerAnchorLabelSnapshot(
                    activeAnchor ? getAnchorLabel(activeAnchor, anchorOptions) : null
                  );
                  setComposerLocationPickerOpen(false);
                  setComposerExpanded(true);
                  setError(null);
                }}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-bold text-on-accent transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-9"
              >
                <Plus size={13} aria-hidden />
                현재 선택에 댓글
              </button>
              {currentSelectionCommentDisabledReason ? (
                <p
                  id={newThreadDisabledReasonId}
                  className="basis-full text-[0.68rem] leading-relaxed text-fg-3"
                >
                  {currentSelectionCommentDisabledReason}
                </p>
              ) : null}
            </div>
          )}

          {syncError ? (
            <div
              role="status"
              aria-live="polite"
              className="flex items-start gap-2 border-b border-warn/35 bg-warn/10 px-4 py-2.5 text-xs leading-relaxed text-warn sm:px-5"
            >
              <CircleDot size={14} className="mt-0.5 shrink-0" aria-hidden />
              <p className="min-w-0 flex-1">
                팀 댓글 동기화 지연 · {syncError}
              </p>
            </div>
          ) : null}

          {error && (
            <div role="alert" className="flex items-start gap-2 border-b border-bad/35 bg-bad/10 px-4 py-2.5 text-xs leading-relaxed text-bad sm:px-5">
              <CircleDot size={14} className="mt-0.5 shrink-0" aria-hidden />
              <p className="min-w-0 flex-1">{error}</p>
              <button
                type="button"
                onClick={() => setError(null)}
                aria-label="오류 메시지 닫기"
                className="grid size-11 shrink-0 place-items-center rounded-md hover:bg-bad/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:size-7"
              >
                <X size={13} aria-hidden />
              </button>
            </div>
          )}

          {!composerExpanded ? (
          <>
          <div className="sticky top-0 z-10 flex flex-col gap-1.5 border-b border-line bg-panel/95 px-4 py-2.5 backdrop-blur-sm sm:px-5">
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="relative min-w-0 flex-1">
                <label className="block">
                  <span className="sr-only">댓글 검색</span>
                  <Search size={13} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-3" />
                  <input
                    ref={searchInputRef}
                    type="search"
                    value={query}
                    aria-keyshortcuts="/"
                    onChange={(event) => setQuery(event.target.value.slice(0, 120))}
                    placeholder="댓글·작성자·멘션 검색 (/)"
                    className="h-11 w-full rounded-lg border border-line bg-card pl-8 pr-10 text-xs text-fg outline-none transition-colors placeholder:text-fg-3 hover:border-line-strong focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:h-9 [&::-webkit-search-cancel-button]:appearance-none"
                  />
                </label>
                {query ? (
                  <button
                    type="button"
                    aria-label="댓글 검색 지우기"
                    title="검색 지우기 (Esc)"
                    onClick={() => {
                      setQuery("");
                      globalThis.requestAnimationFrame(() => searchInputRef.current?.focus());
                    }}
                    className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-md text-fg-3 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent sm:size-7"
                  >
                    <X size={13} aria-hidden />
                  </button>
                ) : null}
              </div>
              {onTogglePinsHidden ? (
                <button
                  type="button"
                  aria-pressed={!pinsHidden}
                  aria-label="캔버스 열린 댓글 핀 표시"
                  onClick={onTogglePinsHidden}
                  className={`${QUIET_BUTTON_CLASS} shrink-0 px-3 sm:px-2.5`}
                  title={pinsHidden ? "캔버스 댓글 핀을 다시 표시합니다 (Shift+C)" : "캔버스 댓글 핀을 숨깁니다 (Shift+C)"}
                >
                  {pinsHidden ? <Eye size={13} aria-hidden /> : <EyeOff size={13} aria-hidden />}
                  <span className="sr-only sm:not-sr-only">{pinsHidden ? "핀 표시" : "핀 숨김"}</span>
                </button>
              ) : null}
              {onMarkAllRead && storageMode === "team" ? (
                <button
                  type="button"
                  disabled={unreadCount === 0 || readMutation !== null}
                  aria-label={readMutation === "all" ? "모든 댓글 읽음 처리 중" : "모든 댓글 읽음 처리"}
                  onClick={() => void markAllRead()}
                  className={`${QUIET_BUTTON_CLASS} shrink-0 px-3 sm:px-2.5`}
                  title="현재 읽지 않은 팀 댓글을 모두 읽음 처리합니다"
                >
                  <CheckCheck size={13} aria-hidden />
                  <span className="sr-only sm:not-sr-only">{readMutation === "all" ? "처리 중" : "모두 읽음"}</span>
                </button>
              ) : null}
              <label className="relative size-11 shrink-0 sm:h-8 sm:w-auto sm:min-w-32">
                <span className="sr-only">댓글 정렬</span>
                <ArrowDownWideNarrow
                  size={13}
                  aria-hidden
                  className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 text-fg-2 sm:left-2 sm:translate-x-0 sm:text-fg-3"
                />
                <select
                  aria-label="댓글 정렬"
                  value={sort}
                  onChange={(event) => setSort(event.target.value as CommentSort)}
                  className="h-11 w-11 appearance-none rounded-lg border border-line bg-card px-0 text-transparent outline-none transition-colors hover:border-line-strong hover:bg-raised focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&>option]:text-fg-2 sm:h-8 sm:w-full sm:pl-7 sm:pr-7 sm:text-[0.7rem] sm:font-semibold sm:text-fg-2"
                >
                  {SORTS.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
                <ChevronDown
                  size={12}
                  aria-hidden
                  className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 text-fg-3 sm:block"
                />
              </label>
            </div>
            <div className="-mx-4 flex min-w-0 items-center gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
              <span className="mr-1 shrink-0 text-[0.68rem] font-semibold text-fg-3">필터</span>
              {FILTERS.filter((item) => storageMode === "team" || item.value !== "unread").map((item) => {
                const active = filter === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    aria-pressed={active}
                    disabled={item.value === "current" && !activeAnchor}
                    onClick={() => setFilter(item.value)}
                    className={`inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg border px-2.5 text-[0.7rem] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-35 sm:min-h-8 ${
                      active
                        ? "border-accent/45 bg-accent-soft text-accent"
                        : "border-line bg-card text-fg-2 hover:border-line-strong hover:bg-raised hover:text-fg"
                    }`}
                  >
                    {item.label}
                    <span className="tabular-nums text-[0.65rem] opacity-75">{filterCounts[item.value]}</span>
                  </button>
                );
              })}
              <span className="ml-auto hidden text-[0.68rem] tabular-nums text-fg-3 sm:block">
                {normalizedQuery ? `검색 ${visibleThreads.length} · ` : ""}
                {storageMode === "team" && readOnlyMessageCount > 0
                  ? `팀 메시지 ${mutableTotalMessages}/${STUDIO_COMMENTS_MAX_TOTAL_MESSAGES} · 보관 ${readOnlyMessageCount}`
                  : `메시지 ${totalMessages}/${STUDIO_COMMENTS_MAX_TOTAL_MESSAGES}`}
              </span>
            </div>
            {visibleThreads.length > 1 ? (
              <div className="flex min-w-0 items-center justify-between gap-2 border-t border-line/70 pt-1.5">
                <p className="min-w-0 truncate text-[0.68rem] font-semibold text-fg-3">
                  순차 검토
                  <span className="ml-1 tabular-nums text-fg-2">
                    {Math.max(1, activeReviewThreadIndex + 1).toLocaleString("ko-KR")}
                    <span className="px-1 text-fg-3">/</span>
                    {visibleThreads.length.toLocaleString("ko-KR")}
                  </span>
                  <span className="ml-2 hidden font-normal sm:inline">J/K로 이동</span>
                </p>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={reviewNavigationBlocked || activeReviewThreadIndex <= 0}
                    aria-label="이전 댓글로 이동"
                    title={reviewNavigationBlocked ? "작성 중인 작업을 먼저 마무리해 주세요." : "이전 댓글 (K)"}
                    onClick={() => moveReviewFocus(-1)}
                    className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-line bg-card px-2.5 text-[0.68rem] font-semibold text-fg-2 transition-colors hover:border-line-strong hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-35 sm:min-h-8"
                  >
                    <ChevronUp size={13} aria-hidden />
                    이전
                  </button>
                  <button
                    type="button"
                    disabled={reviewNavigationBlocked || activeReviewThreadIndex >= visibleThreads.length - 1}
                    aria-label="다음 댓글로 이동"
                    title={reviewNavigationBlocked ? "작성 중인 작업을 먼저 마무리해 주세요." : "다음 댓글 (J)"}
                    onClick={() => moveReviewFocus(1)}
                    className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-line bg-card px-2.5 text-[0.68rem] font-semibold text-fg-2 transition-colors hover:border-line-strong hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-35 sm:min-h-8"
                  >
                    다음
                    <ChevronDown size={13} aria-hidden />
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {visibleThreads.length === 0 ? (
            <div className="grid min-h-52 place-items-center px-6 py-10 text-center" aria-live="polite">
              <div className="max-w-sm">
                <MessageSquareText size={28} className="mx-auto text-fg-3" aria-hidden />
                <h3 className="mt-3 text-sm font-bold text-fg">{emptyTitle}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-fg-3">{emptyDescription}</p>
                {filter === "current" && !activeAnchor && document.threads.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setFilter("all")}
                    className={`${QUIET_BUTTON_CLASS} mt-4`}
                  >
                    전체 댓글 보기
                  </button>
                )}
              </div>
            </div>
          ) : (
            <ol aria-label={`${FILTERS.find((item) => item.value === filter)?.label ?? "전체"} 댓글`}>
              {visibleThreads.map((thread) => {
                const isReadOnlyArchive = readOnlyThreadIds.has(thread.id);
                const canReply =
                  !isReadOnlyArchive
                  && capabilities.reply
                  && !saving
                  && !sharedReply?.submitting
                  && !thread.resolved
                  && thread.replies.length < STUDIO_COMMENTS_MAX_REPLIES_PER_THREAD
                  && mutableTotalMessages < STUDIO_COMMENTS_MAX_TOTAL_MESSAGES;
                const isReplying = !isReadOnlyArchive && activeReplyThreadId === thread.id;
                const isAssigning = !isReadOnlyArchive && assigningThreadId === thread.id;
                const threadTarget: CommentMessageTarget = { threadId: thread.id };
                const ownsThread = studioCommentActorsRepresentSamePerson(thread.author, currentActor);
                const canEditThread = !isReadOnlyArchive && capabilities.editOwn && ownsThread && !saving;
                const isEditingThread = !isReadOnlyArchive && messageTargetsEqual(editingMessage, threadTarget);
                const locationLabel = getAnchorLabel(thread.anchor, anchorOptions);
                const currentActorRelation = studioCommentThreadCurrentActorRelation(
                  thread,
                  currentActor
                );
                const currentActorRelationLabel = studioCommentCurrentActorRelationLabel(
                  currentActorRelation
                );
                const taskSuggestion = compileStudioReviewTask(thread, {
                  anchorLabel: locationLabel,
                });
                const taskExpanded = expandedTaskThreadId === thread.id;
                const assignedToCurrentActor = Boolean(
                  thread.assignee
                  && studioCommentActorsRepresentSamePerson(thread.assignee, currentActor)
                );
                const taskConversionDisabledReason = isReadOnlyArchive
                  ? "읽기 전용 보관 댓글은 작업으로 전환할 수 없습니다."
                  : thread.resolved
                    ? "해결된 댓글은 다시 연 뒤 작업으로 전환할 수 있습니다."
                    : assignedToCurrentActor
                      ? "이미 내 작업으로 지정되어 있습니다."
                      : !capabilities.assign
                        ? mutationDisabledReason
                          ?? "현재 권한으로는 담당 작업을 지정할 수 없습니다."
                        : mutationDisabledReason
                          ? mutationDisabledReason
                          : saving || syncing
                            ? "댓글을 동기화하는 동안 잠시 기다려 주세요."
                            : null;
                const taskProposalId = `${titleId}-task-proposal-${thread.id}`;
                const taskConversionHelpId = `${titleId}-task-conversion-help-${thread.id}`;

                return (
                  <li key={thread.id} className="border-b border-line last:border-b-0">
                    <article
                      id={`${titleId}-thread-${thread.id}`}
                      data-studio-comment-thread-id={thread.id}
                      tabIndex={activeReviewThreadId === thread.id ? 0 : -1}
                      onFocusCapture={() => setFocusedThreadId(thread.id)}
                      className={`relative px-4 py-4 outline-none transition-colors focus-visible:bg-accent-soft/20 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent sm:px-5 ${unreadThreadIds.has(thread.id) ? "bg-accent-soft/15 before:absolute before:inset-y-3 before:left-0 before:w-0.5 before:rounded-r before:bg-accent" : ""}`}
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full border border-line bg-raised text-xs font-bold text-fg-2">
                          {actorInitial(thread.author)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <strong className="text-xs text-fg">{thread.author.displayName}</strong>
                            <time dateTime={thread.createdAt} className="text-[0.68rem] text-fg-3">
                              {formatDate(thread.createdAt)}
                            </time>
                            <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[0.62rem] font-semibold ${
                              thread.resolved
                                ? "border-good/35 bg-good/10 text-good"
                                : "border-warn/35 bg-warn/10 text-warn"
                            }`}>
                              {thread.resolved
                                ? <CheckCircle2 size={10} aria-hidden />
                                : <CircleDot size={10} aria-hidden />}
                              {thread.resolved ? "해결됨" : "열림"}
                            </span>
                            {filter === "mine" && currentActorRelationLabel ? (
                              <span className="inline-flex items-center rounded-md border border-accent/30 bg-accent-soft px-1.5 py-0.5 text-[0.62rem] font-semibold text-accent">
                                {currentActorRelationLabel}
                              </span>
                            ) : null}
                            {unreadThreadIds.has(thread.id) ? (
                              <span className="inline-flex items-center gap-1 rounded-md bg-accent px-1.5 py-0.5 text-[0.62rem] font-bold text-on-accent">
                                새 피드백
                              </span>
                            ) : null}
                            {isReadOnlyArchive ? (
                              <span
                                className="inline-flex items-center gap-1 rounded-md border border-line bg-raised px-1.5 py-0.5 text-[0.62rem] font-semibold text-fg-2"
                                title="팀 댓글 도입 전에 문서에 저장된 댓글입니다. 내용과 위치만 보존됩니다."
                              >
                                <HardDrive size={10} aria-hidden />
                                로컬 보관본 · 읽기 전용
                              </span>
                            ) : null}
                          </div>
                          {onSelectAnchor ? (
                            <button
                              type="button"
                              onClick={() => {
                                navigateToAnchor(thread.anchor);
                                void markThreadRead(thread.id);
                              }}
                              aria-label={`${locationLabel} 위치로 이동`}
                              className="mt-1 inline-flex min-h-11 max-w-full items-center gap-1 rounded-md py-1 text-[0.68rem] font-semibold text-cool hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:min-h-7"
                            >
                              <MapPin size={11} className="shrink-0" aria-hidden />
                              <span className="truncate">{locationLabel}</span>
                              <CornerDownRight size={11} className="shrink-0" aria-hidden />
                            </button>
                          ) : (
                            <span className="mt-1 inline-flex max-w-full items-center gap-1 text-[0.68rem] font-semibold text-fg-3">
                              <MapPin size={11} className="shrink-0" aria-hidden />
                              <span className="truncate">{locationLabel}</span>
                            </span>
                          )}
                        </div>
                        {canEditThread && !isEditingThread && (
                          <span className="inline-flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => beginEditing(threadTarget, thread.body)}
                              aria-label={`${thread.author.displayName}의 댓글 수정`}
                              title="댓글 수정"
                              className="grid size-11 place-items-center rounded-md text-fg-3 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:size-8"
                            >
                              <Edit3 size={12} aria-hidden />
                            </button>
                          </span>
                        )}
                      </div>

                      {isEditingThread ? (
                        <form onSubmit={(event) => submitEdit(event, threadTarget)} className="mt-3 rounded-xl bg-raised/35 p-3">
                          <label htmlFor={`${titleId}-edit-${thread.id}`} className="block text-[0.7rem] font-semibold text-fg-2">
                            댓글 수정
                          </label>
                          <textarea
                            ref={editEditorRef}
                            id={`${titleId}-edit-${thread.id}`}
                            value={editBody}
                            maxLength={STUDIO_COMMENTS_MAX_BODY_LENGTH}
                            rows={3}
                            onChange={(event) => setEditBody(event.target.value.slice(0, STUDIO_COMMENTS_MAX_BODY_LENGTH))}
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
                            className={`${FIELD_CLASS} mt-1.5 resize-y`}
                          />
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <span className="text-[0.65rem] tabular-nums text-fg-3">{editBody.length}/{STUDIO_COMMENTS_MAX_BODY_LENGTH}</span>
                            <div className="flex items-center gap-2">
                              <button type="button" onClick={cancelEditing} className={QUIET_BUTTON_CLASS}>취소</button>
                              <button
                                type="submit"
                                disabled={!editBody.trim() || editBody.trim() === thread.body}
                                className="inline-flex min-h-11 items-center rounded-lg bg-accent px-3 text-xs font-bold text-on-accent transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-9"
                              >
                                저장
                              </button>
                            </div>
                          </div>
                        </form>
                      ) : canReply ? (
                        <button
                          type="button"
                          aria-expanded={isReplying}
                          aria-controls={`${titleId}-reply-${thread.id}`}
                          aria-label={`${thread.author.displayName}의 댓글에 빠르게 답글`}
                          data-studio-comment-quick-reply="true"
                          onClick={() => {
                            beginQuickReply(thread.id);
                            void markThreadRead(thread.id);
                          }}
                          className="group mt-2 block min-h-11 w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-raised/65 focus-visible:bg-raised/65 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                          title="클릭해 바로 답글을 작성합니다"
                        >
                          <span className="block whitespace-pre-wrap break-words text-sm leading-6 text-fg">
                            {thread.body}
                          </span>
                          <span className="mt-1 flex items-center gap-1 text-[0.68rem] font-semibold text-fg-3 transition-colors group-hover:text-accent group-focus-visible:text-accent sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-visible:opacity-100">
                            <Reply size={11} aria-hidden />
                            클릭해 답글 쓰기
                          </span>
                        </button>
                      ) : (
                        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-fg">
                          {thread.body}
                        </p>
                      )}

                      {thread.replies.length > 0 && (
                        <ol aria-label={`${thread.author.displayName} 댓글의 답글`} className="mt-3">
                          {thread.replies.map((reply) => {
                            const replyTarget: CommentMessageTarget = {
                              threadId: thread.id,
                              replyId: reply.id,
                            };
                            const ownsReply = studioCommentActorsRepresentSamePerson(reply.author, currentActor);
                            const canEditReply = !isReadOnlyArchive && capabilities.editOwn && ownsReply && !saving;
                            const isEditingReply = !isReadOnlyArchive && messageTargetsEqual(editingMessage, replyTarget);
                            const isDeletingReply = false;
                            return (
                              <li key={reply.id} className="border-t border-line/70 py-3">
                                <div className="flex min-w-0 items-start gap-2.5 pl-4 sm:pl-6">
                                  <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-raised text-[0.68rem] font-bold text-fg-2">
                                    {actorInitial(reply.author)}
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                      <strong className="text-[0.72rem] text-fg-2">{reply.author.displayName}</strong>
                                      <time dateTime={reply.createdAt} className="text-[0.65rem] text-fg-3">
                                        {formatDate(reply.createdAt)}
                                      </time>
                                      {reply.updatedAt !== reply.createdAt && (
                                        <span className="text-[0.62rem] text-fg-3">수정됨</span>
                                      )}
                                      {canEditReply && !isEditingReply && (
                                        <span className="ml-auto inline-flex items-center gap-1">
                                          <button
                                            type="button"
                                            onClick={() => beginEditing(replyTarget, reply.body)}
                                            aria-label={`${reply.author.displayName}의 답글 수정`}
                                            title="답글 수정"
                                            className="grid size-11 place-items-center rounded-md text-fg-3 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:size-8"
                                          >
                                            <Edit3 size={12} aria-hidden />
                                          </button>
                                        </span>
                                      )}
                                    </div>
                                    {isEditingReply ? (
                                      <form onSubmit={(event) => submitEdit(event, replyTarget)} className="mt-2 rounded-xl bg-raised/35 p-2.5">
                                        <label htmlFor={`${titleId}-edit-${reply.id}`} className="sr-only">답글 수정</label>
                                        <textarea
                                          ref={editEditorRef}
                                          id={`${titleId}-edit-${reply.id}`}
                                          value={editBody}
                                          maxLength={STUDIO_COMMENTS_MAX_BODY_LENGTH}
                                          rows={2}
                                          onChange={(event) => setEditBody(event.target.value.slice(0, STUDIO_COMMENTS_MAX_BODY_LENGTH))}
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
                                          className={`${FIELD_CLASS} resize-y`}
                                        />
                                        <div className="mt-2 flex justify-end gap-2">
                                          <button type="button" onClick={cancelEditing} className={QUIET_BUTTON_CLASS}>취소</button>
                                          <button
                                            type="submit"
                                            disabled={!editBody.trim() || editBody.trim() === reply.body}
                                            className="inline-flex min-h-11 items-center rounded-lg bg-accent px-3 text-xs font-bold text-on-accent transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-9"
                                          >
                                            저장
                                          </button>
                                        </div>
                                      </form>
                                    ) : (
                                      <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-fg-2">
                                        {reply.body}
                                      </p>
                                    )}
                                    {isDeletingReply && (
                                      <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-bad/30 bg-bad/10 px-2.5 py-2 text-[0.68rem] text-fg-2">
                                        <span className="min-w-0 flex-1">이 답글을 삭제할까요?</span>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            focusReviewRail();
                                            setPendingDelete(null);
                                          }}
                                          className={QUIET_BUTTON_CLASS}
                                        >
                                          취소
                                        </button>
                                        <button
                                          ref={deleteConfirmRef}
                                          type="button"
                                          onClick={() => void confirmDelete(replyTarget)}
                                          className="inline-flex min-h-11 items-center rounded-lg bg-bad px-3 text-xs font-bold text-on-accent transition-colors hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bad sm:min-h-9"
                                        >
                                          삭제
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </li>
                            );
                          })}
                        </ol>
                      )}

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {!isReadOnlyArchive && unreadThreadIds.has(thread.id) && onMarkThreadRead ? (
                          <button
                            type="button"
                            disabled={readMutation !== null}
                            onClick={() => void markThreadRead(thread.id)}
                            className={QUIET_BUTTON_CLASS}
                          >
                            <CheckCheck size={13} aria-hidden />
                            {readMutation === thread.id ? "읽음 처리 중" : "읽음으로 표시"}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          data-studio-review-task-toggle="true"
                          aria-expanded={taskExpanded}
                          aria-controls={taskProposalId}
                          onClick={() =>
                            setExpandedTaskThreadId(taskExpanded ? null : thread.id)
                          }
                          className={`${QUIET_BUTTON_CLASS} ${
                            taskExpanded ? "border-accent/50 bg-accent-soft text-accent" : ""
                          }`}
                        >
                          <ClipboardList size={13} aria-hidden />
                          작업 제안
                          <ChevronDown
                            size={13}
                            className={`transition-transform duration-150 motion-reduce:transition-none ${
                              taskExpanded ? "rotate-180" : ""
                            }`}
                            aria-hidden
                          />
                        </button>
                        {!isReadOnlyArchive && capabilities.assign ? <button
                          type="button"
                          aria-expanded={isAssigning}
                          onClick={() => {
                            if (!closeReplyEditor({ protectDraft: true })) return;
                            setAssigningThreadId(isAssigning ? null : thread.id);
                            setAssigneeName(thread.assignee?.displayName ?? "");
                            setEditingMessage(null);
                            setEditBody("");
                            setPendingDelete(null);
                            setError(null);
                          }}
                          className={QUIET_BUTTON_CLASS}
                        >
                          <UserRoundCheck size={13} aria-hidden />
                          {thread.assignee ? `담당 · ${thread.assignee.displayName}` : "담당자 지정"}
                        </button> : null}
                        {!isReadOnlyArchive && capabilities.resolve ? <button
                          type="button"
                          disabled={saving}
                          aria-pressed={thread.resolved}
                          aria-label={thread.resolved
                            ? `${thread.author.displayName}의 댓글 다시 열기`
                            : `${thread.author.displayName}의 댓글 해결 처리`}
                          onClick={() => {
                            if (
                              !thread.resolved
                              && !closeReplyEditor({ protectDraft: true })
                            ) return;
                            void applyChange(
                              () => thread.resolved
                                ? reopenStudioCommentThread(document, thread.id)
                                : resolveStudioCommentThread(document, thread.id, currentActor),
                              thread.resolved
                                ? "댓글을 다시 열지 못했어요."
                                : "댓글을 해결 처리하지 못했어요."
                            ).then((saved) => {
                              if (!saved) return;
                              focusReviewRail();
                            });
                          }}
                          className={`${QUIET_BUTTON_CLASS} ${
                            thread.resolved ? "text-warn hover:text-warn" : "text-good hover:text-good"
                          }`}
                        >
                          {thread.resolved
                            ? <RotateCcw size={13} aria-hidden />
                            : <CheckCircle2 size={13} aria-hidden />}
                          {thread.resolved ? "다시 열기" : "해결"}
                        </button> : null}
                      </div>

                      {taskExpanded ? (
                        <section
                          id={taskProposalId}
                          data-studio-review-task="true"
                          aria-labelledby={`${taskProposalId}-title`}
                          className="mt-3 border-y border-line/70 py-3"
                        >
                          <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="inline-flex min-h-6 items-center rounded-md border border-accent/35 bg-accent-soft px-2 text-[0.65rem] font-bold text-accent">
                                  {taskSuggestion.kindLabel}
                                </span>
                                <span
                                  className={`inline-flex min-h-6 items-center rounded-md border px-2 text-[0.65rem] font-bold ${reviewTaskPriorityClass(taskSuggestion.priority)}`}
                                >
                                  우선순위 {taskSuggestion.priorityLabel}
                                </span>
                              </div>
                              <h3
                                id={`${taskProposalId}-title`}
                                className="mt-2 text-sm font-bold leading-5 text-fg text-pretty"
                              >
                                {taskSuggestion.title}
                              </h3>
                            </div>
                            <span
                              className="inline-flex min-h-7 shrink-0 items-center gap-1 rounded-md border border-good/30 bg-good/10 px-2 text-[0.62rem] font-semibold text-good"
                              title="댓글 내용은 서버나 외부 AI로 전송되지 않습니다."
                            >
                              <ShieldCheck size={11} aria-hidden />
                              로컬 규칙 기반
                            </span>
                          </div>

                          <dl className="mt-3 space-y-2 text-xs leading-relaxed">
                            <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
                              <dt className="font-semibold text-fg-3">대상 범위</dt>
                              <dd className="min-w-0 break-words font-semibold text-fg-2">
                                {taskSuggestion.targetScope}
                              </dd>
                            </div>
                            <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
                              <dt className="font-semibold text-fg-3">제안 근거</dt>
                              <dd className="min-w-0">
                                <ul className="space-y-1 text-fg-2">
                                  {taskSuggestion.rationale.map((item) => (
                                    <li key={item} className="flex min-w-0 items-start gap-1.5">
                                      <CircleDot
                                        size={10}
                                        className="mt-1 shrink-0 text-cool"
                                        aria-hidden
                                      />
                                      <span className="min-w-0 break-words">{item}</span>
                                    </li>
                                  ))}
                                </ul>
                              </dd>
                            </div>
                          </dl>

                          <div className="mt-3">
                            <p className="text-[0.7rem] font-bold text-fg-2">완료 조건</p>
                            <ul className="mt-1.5 space-y-1.5">
                              {taskSuggestion.completionChecklist.map((item) => (
                                <li
                                  key={item}
                                  className="flex min-w-0 items-start gap-2 text-xs leading-relaxed text-fg-2"
                                >
                                  <span
                                    className="mt-0.5 size-3.5 shrink-0 rounded border border-line-strong bg-card"
                                    aria-hidden
                                  />
                                  <span className="min-w-0 break-words">{item}</span>
                                </li>
                              ))}
                            </ul>
                          </div>

                          <div className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                            <p
                              id={taskConversionHelpId}
                              className="min-w-0 flex-1 text-[0.68rem] leading-relaxed text-fg-3"
                              role={taskConversionDisabledReason ? "status" : undefined}
                            >
                              {taskConversionDisabledReason
                                ?? (thread.assignee
                                  ? `현재 담당자 ${thread.assignee.displayName}에서 ${currentActor.displayName}(으)로 변경합니다.`
                                  : `${currentActor.displayName}을(를) 이 댓글의 담당자로 지정합니다.`)}
                            </p>
                            <button
                              type="button"
                              data-studio-review-task-convert="true"
                              disabled={taskConversionDisabledReason !== null}
                              aria-describedby={taskConversionHelpId}
                              onClick={() => void assignToCurrentActor(thread.id)}
                              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-bold text-on-accent transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:bg-raised disabled:text-fg-3 disabled:opacity-55 sm:min-h-9 pointer-coarse:min-h-11"
                            >
                              <UserRoundCheck size={13} aria-hidden />
                              {assignedToCurrentActor ? "내 작업으로 지정됨" : "내 작업으로 전환"}
                            </button>
                          </div>
                        </section>
                      ) : null}

                      {isReplying && (
                        <form
                          id={`${titleId}-reply-${thread.id}`}
                          aria-labelledby={`${titleId}-reply-label-${thread.id}`}
                          data-studio-comment-inline-reply="true"
                          onSubmit={(event) => submitReply(event, thread.id)}
                          className="mt-3 rounded-lg border border-accent/35 bg-accent-soft/10 p-3 transition-colors focus-within:border-accent/65 focus-within:bg-accent-soft/15"
                        >
                          <label
                            id={`${titleId}-reply-label-${thread.id}`}
                            htmlFor={`${titleId}-reply-editor-${thread.id}`}
                            className="block text-[0.7rem] font-semibold text-fg-2"
                          >
                            {thread.author.displayName}에게 답글
                          </label>
                          <textarea
                            ref={replyEditorRef}
                            id={`${titleId}-reply-editor-${thread.id}`}
                            value={activeReplyBody}
                            maxLength={STUDIO_COMMENTS_MAX_BODY_LENGTH}
                            rows={2}
                            disabled={!canReply}
                            aria-keyshortcuts="Meta+Enter Control+Enter Escape"
                            onChange={(event) => {
                              const body = event.target.value.slice(0, STUDIO_COMMENTS_MAX_BODY_LENGTH);
                              if (sharedReply) sharedReply.onBodyChange(thread.id, body);
                              else setReplyBody(body);
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
                            placeholder="답글을 입력하세요."
                            className={`${FIELD_CLASS} mt-1.5 resize-y`}
                          />
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[0.65rem] text-fg-3">
                              <span className="hidden sm:inline">⌘/Ctrl + Enter 등록 · Esc 취소 · </span>
                              <span className="tabular-nums">
                                {activeReplyBody.length.toLocaleString("ko-KR")}/{STUDIO_COMMENTS_MAX_BODY_LENGTH.toLocaleString("ko-KR")}
                              </span>
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={saving || sharedReply?.submitting}
                                onClick={() => {
                                  focusReviewRail();
                                  closeReplyEditor();
                                }}
                                className={`${QUIET_BUTTON_CLASS} disabled:cursor-wait disabled:opacity-40`}
                              >
                                취소
                              </button>
                              <button
                                type="submit"
                                disabled={!canReply || !activeReplyBody.trim()}
                                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-bold text-on-accent transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-9"
                              >
                                <Send size={12} aria-hidden />
                                답글 등록
                              </button>
                            </div>
                          </div>
                        </form>
                      )}

                      {isAssigning && (
                        <form onSubmit={(event) => submitAssignee(event, thread.id)} className="mt-3 bg-raised/25 p-3">
                          <label htmlFor={`${titleId}-assignee-${thread.id}`} className="block text-[0.7rem] font-semibold text-fg-2">
                            담당자
                          </label>
                          <div className="mt-1.5 flex min-w-0 flex-col gap-2 sm:flex-row">
                            <input
                              ref={assigneeEditorRef}
                              id={`${titleId}-assignee-${thread.id}`}
                              type="text"
                              value={assigneeName}
                              maxLength={STUDIO_COMMENTS_MAX_DISPLAY_NAME_LENGTH}
                              onChange={(event) =>
                                setAssigneeName(event.target.value.slice(0, STUDIO_COMMENTS_MAX_DISPLAY_NAME_LENGTH))
                              }
                              placeholder="담당자 표시 이름"
                              className={`${FIELD_CLASS} min-w-0 flex-1`}
                            />
                            <div className="flex flex-wrap items-center gap-2">
                              <button type="button" onClick={() => void assignToCurrentActor(thread.id)} className={QUIET_BUTTON_CLASS}>
                                나에게
                              </button>
                              {thread.assignee && (
                                <button type="button" onClick={() => void clearAssignee(thread.id)} className={QUIET_BUTTON_CLASS}>
                                  배정 해제
                                </button>
                              )}
                              <button
                                type="submit"
                                disabled={!assigneeName.trim()}
                                className="inline-flex min-h-11 items-center rounded-lg bg-accent px-3 text-xs font-bold text-on-accent transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-9"
                              >
                                지정
                              </button>
                            </div>
                          </div>
                          <p className="mt-2 text-[0.65rem] leading-relaxed text-fg-3">
                            표시 이름만 문서에 저장됩니다. 계정 조회나 서버 권한 부여는 하지 않아요.
                          </p>
                        </form>
                      )}

                      {thread.resolved && thread.resolvedAt && (
                        <p className="mt-3 text-[0.65rem] leading-relaxed text-fg-3">
                          {thread.resolvedBy?.displayName ?? "작성자 미상"} · {formatDate(thread.resolvedAt)} 해결 처리
                        </p>
                      )}
                    </article>
                  </li>
                );
              })}
            </ol>
          )}
          </>
          ) : null}
        </div>
      </dialog>
  );

  return createPortal(reviewRail, globalThis.document.body);
}
