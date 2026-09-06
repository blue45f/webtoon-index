import {
  STUDIO_COMMENTS_MAX_BODY_LENGTH,
  studioCommentMutationReceiptOwnsDraft,
  type StudioCommentThread,
} from "./studio-comments";

import type { StudioTeamCommentMutationPlan } from "./studio-team-comment-mutation-plan";

const EMPTY_THREAD_ID_SET: ReadonlySet<string> = new Set();

/**
 * Shared selection and reply state for both the canvas pin popover and the review rail.
 *
 * Persisted threads remain authoritative outside this reducer. Keeping only IDs here prevents a
 * pin quick-reply from owning a second, stale copy of thread, unread-frontier, or resolution
 * state. Authoritative unread IDs are inputs to open/reconcile/projection, never session state.
 */
export type StudioCommentThreadSessionSurface = "pin-quick-reply" | "review-panel";

export type StudioCommentThreadSessionOpenReason =
  | "canvas-pin"
  | "review-panel"
  | "focus-request"
  | "draft-restore"
  | "thread-fallback";

export type StudioCommentThreadSessionCloseReason =
  | "explicit"
  | "escape"
  | "outside-pointer"
  | "tool-switch"
  | "thread-disappeared";

export type StudioCommentThreadSessionSelectionScope = "cluster" | "global";

export interface StudioCommentThreadSessionDraft {
  readonly threadId: string;
  readonly body: string;
  /** Stable team-comment reply ID. It survives a failed submit so retry remains idempotent. */
  readonly mutationId: string | null;
}

export interface StudioCommentThreadSessionState {
  readonly surface: StudioCommentThreadSessionSurface | null;
  readonly selectedThreadId: string | null;
  /** Ordered IDs represented by the selected canvas pin. Empty for global rail selection. */
  readonly clusterThreadIds: readonly string[];
  readonly selectionScope: StudioCommentThreadSessionSelectionScope;
  readonly openReason: StudioCommentThreadSessionOpenReason | null;
  readonly closeReason: StudioCommentThreadSessionCloseReason | null;
  /** One shared draft is intentionally preserved across popover/rail close and surface switches. */
  readonly draft: StudioCommentThreadSessionDraft | null;
  /** The sole mutation fence shared by the pin quick-reply and the review rail. */
  readonly submittingMutationId: string | null;
}

export function createStudioCommentThreadSessionState(): StudioCommentThreadSessionState {
  return {
    surface: null,
    selectedThreadId: null,
    clusterThreadIds: [],
    selectionScope: "global",
    openReason: null,
    closeReason: null,
    draft: null,
    submittingMutationId: null,
  };
}

/**
 * Keeps the actively reviewed pin thread addressable after another collaborator resolves it.
 * Unrelated resolved threads remain outside the lightweight canvas projection, while the current
 * selection/draft can still be reopened or handed to the full review rail without becoming an
 * invisible orphan.
 */
export function selectStudioCommentThreadSessionSourceThreads(
  surface: StudioCommentThreadSessionSurface | null,
  selectedThreadId: string | null,
  draftThreadId: string | null,
  threads: readonly StudioCommentThread[]
): readonly StudioCommentThread[] {
  if (surface !== "pin-quick-reply") return threads;
  const retainedThreadIds = new Set([
    selectedThreadId,
    draftThreadId,
  ].filter((threadId): threadId is string => Boolean(threadId)));
  return threads.filter((thread) => !thread.resolved || retainedThreadIds.has(thread.id));
}

export type StudioCommentThreadSessionMutationPlan = Exclude<
  StudioTeamCommentMutationPlan,
  { kind: "create" }
>;

export type StudioCommentThreadSessionEvent =
  | {
      readonly type: "session.open";
      readonly surface: StudioCommentThreadSessionSurface;
      readonly reason: Exclude<StudioCommentThreadSessionOpenReason, "thread-fallback">;
      readonly threads: readonly StudioCommentThread[];
      readonly preferredThreadId?: string;
      readonly unreadThreadIds?: ReadonlySet<string>;
      /** Presence means this is a pin cluster, including a stale empty cluster. */
      readonly clusterThreadIds?: readonly string[];
    }
  | {
      readonly type: "session.close";
      readonly reason: Exclude<StudioCommentThreadSessionCloseReason, "thread-disappeared">;
      /** Closing preserves a draft unless the user explicitly chose to discard it. */
      readonly discardDraft?: boolean;
    }
  | {
      readonly type: "thread.select";
      readonly threadId: string;
      readonly threads: readonly StudioCommentThread[];
      readonly reason?: "canvas-pin" | "focus-request" | "draft-restore";
      readonly clusterThreadIds?: readonly string[];
    }
  | {
      readonly type: "threads.reconcile";
      readonly threads: readonly StudioCommentThread[];
      readonly unreadThreadIds: ReadonlySet<string>;
    }
  | {
      readonly type: "draft.change";
      readonly threadId: string;
      readonly body: string;
    }
  | { readonly type: "draft.discard"; readonly threadId?: string }
  | {
      readonly type: "mutation.start";
      readonly plan: StudioCommentThreadSessionMutationPlan;
      /** Required for resolve/reopen, whose current server plans do not carry an idempotency ID. */
      readonly operationId?: string;
    }
  | {
      readonly type: "mutation.receipt";
      /** Dispatch only after the parent operation scope and authoritative frontier accept it. */
      readonly plan: StudioCommentThreadSessionMutationPlan;
      readonly operationId?: string;
    }
  | {
      readonly type: "mutation.failure";
      readonly mutationId: string;
    };

function threadsById(
  threads: readonly StudioCommentThread[]
): ReadonlyMap<string, StudioCommentThread> {
  return new Map(threads.map((thread) => [thread.id, thread]));
}

function existingUniqueThreadIds(
  threadIds: readonly string[],
  byId: ReadonlyMap<string, StudioCommentThread>
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const threadId of threadIds) {
    if (seen.has(threadId) || !byId.has(threadId)) continue;
    seen.add(threadId);
    result.push(threadId);
  }
  return result;
}

function newestPreferredThreadId(
  threadIds: readonly string[],
  byId: ReadonlyMap<string, StudioCommentThread>,
  unreadThreadIds: ReadonlySet<string>,
  preferredThreadId?: string | null
): string | null {
  if (preferredThreadId && threadIds.includes(preferredThreadId) && byId.has(preferredThreadId)) {
    return preferredThreadId;
  }
  return threadIds
    .map((threadId) => byId.get(threadId))
    .filter((thread): thread is StudioCommentThread => Boolean(thread))
    .sort((left, right) => {
      const unreadDifference = Number(unreadThreadIds.has(right.id))
        - Number(unreadThreadIds.has(left.id));
      if (unreadDifference !== 0) return unreadDifference;
      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
        || right.id.localeCompare(left.id);
    })[0]?.id ?? null;
}

function mutationThreadId(plan: StudioCommentThreadSessionMutationPlan): string {
  return plan.threadId;
}

/** Returns the receipt fence used by both surfaces for one allow-listed server mutation plan. */
export function studioCommentThreadSessionMutationId(
  plan: StudioCommentThreadSessionMutationPlan,
  operationId?: string
): string {
  if (plan.kind === "reply") return plan.mutationId;
  const normalizedOperationId = operationId?.trim();
  if (!normalizedOperationId) {
    throw new Error(`${plan.kind} 댓글 작업에는 고유한 operationId가 필요해요.`);
  }
  return normalizedOperationId;
}

/** A non-empty reply draft blocks resolving its thread, but must not block reopening it. */
export function studioCommentThreadSessionDraftBlocksResolutionChange(
  state: StudioCommentThreadSessionState,
  threadId: string,
  nextResolved: boolean
): boolean {
  return nextResolved
    && state.draft?.threadId === threadId
    && Boolean(state.draft.body.trim());
}

/** Maps popover close intent to draft lifetime; incidental surface changes never discard text. */
export function studioCommentThreadSessionCloseDiscardsDraft(
  reason: StudioCommentThreadSessionCloseReason
): boolean {
  return reason === "explicit" || reason === "escape";
}

function openSession(
  state: StudioCommentThreadSessionState,
  event: Extract<StudioCommentThreadSessionEvent, { type: "session.open" }>
): StudioCommentThreadSessionState {
  const byId = threadsById(event.threads);
  const clusterRequested = event.clusterThreadIds !== undefined;
  const clusterThreadIds = clusterRequested
    ? existingUniqueThreadIds(event.clusterThreadIds ?? [], byId)
    : [];
  const candidates = clusterRequested ? clusterThreadIds : Array.from(byId.keys());
  const preferredThreadId = event.preferredThreadId
    ?? (state.selectedThreadId && byId.has(state.selectedThreadId)
      ? state.selectedThreadId
      : state.draft && byId.has(state.draft.threadId)
        ? state.draft.threadId
        : null);
  const selectedThreadId = clusterRequested
    ? newestPreferredThreadId(
        candidates,
        byId,
        event.unreadThreadIds ?? EMPTY_THREAD_ID_SET,
        preferredThreadId
      )
    : preferredThreadId && byId.has(preferredThreadId)
      ? preferredThreadId
      : null;

  if (clusterRequested && !selectedThreadId) {
    return {
      ...state,
      surface: null,
      selectedThreadId: null,
      clusterThreadIds: [],
      selectionScope: "cluster",
      openReason: null,
      closeReason: "thread-disappeared",
    };
  }
  return {
    ...state,
    surface: event.surface,
    selectedThreadId,
    clusterThreadIds,
    selectionScope: clusterRequested ? "cluster" : "global",
    openReason: event.reason,
    closeReason: null,
  };
}

function reconcileThreads(
  state: StudioCommentThreadSessionState,
  event: Extract<StudioCommentThreadSessionEvent, { type: "threads.reconcile" }>
): StudioCommentThreadSessionState {
  const byId = threadsById(event.threads);
  const clusterThreadIds = existingUniqueThreadIds(state.clusterThreadIds, byId);
  if (state.selectedThreadId && byId.has(state.selectedThreadId)) {
    return {
      ...state,
      clusterThreadIds,
    };
  }

  if (!state.selectedThreadId && state.surface === null) {
    return {
      ...state,
      clusterThreadIds,
    };
  }

  const fallbackCandidates = state.selectionScope === "cluster"
    ? clusterThreadIds
    : event.threads.map((thread) => thread.id);
  const fallbackThreadId = newestPreferredThreadId(
    fallbackCandidates,
    byId,
    event.unreadThreadIds,
    state.draft && byId.has(state.draft.threadId) ? state.draft.threadId : null
  );
  if (fallbackThreadId) {
    return {
      ...state,
      selectedThreadId: fallbackThreadId,
      clusterThreadIds,
      openReason: state.surface ? "thread-fallback" : state.openReason,
      closeReason: null,
    };
  }

  if (state.surface === "pin-quick-reply") {
    return {
      ...state,
      surface: null,
      selectedThreadId: null,
      clusterThreadIds: [],
      openReason: null,
      closeReason: "thread-disappeared",
    };
  }

  return {
    ...state,
    selectedThreadId: null,
    clusterThreadIds,
  };
}

export function reduceStudioCommentThreadSession(
  state: StudioCommentThreadSessionState,
  event: StudioCommentThreadSessionEvent
): StudioCommentThreadSessionState {
  if (event.type === "session.open") return openSession(state, event);
  if (event.type === "session.close") {
    return {
      ...state,
      surface: null,
      openReason: null,
      closeReason: event.reason,
      draft: event.discardDraft ? null : state.draft,
    };
  }
  if (event.type === "thread.select") {
    const byId = threadsById(event.threads);
    if (!byId.has(event.threadId)) return state;
    const clusterRequested = event.clusterThreadIds !== undefined;
    if (clusterRequested && !(event.clusterThreadIds ?? []).includes(event.threadId)) return state;
    const clusterThreadIds = clusterRequested
      ? existingUniqueThreadIds(event.clusterThreadIds ?? [], byId)
      : [];
    return {
      ...state,
      selectedThreadId: event.threadId,
      clusterThreadIds,
      selectionScope: clusterRequested ? "cluster" : "global",
      openReason: state.surface && event.reason ? event.reason : state.openReason,
      closeReason: state.surface ? null : state.closeReason,
    };
  }
  if (event.type === "threads.reconcile") return reconcileThreads(state, event);
  if (event.type === "draft.change") {
    const body = event.body.slice(0, STUDIO_COMMENTS_MAX_BODY_LENGTH);
    if (
      state.draft
      && state.draft.threadId !== event.threadId
      && state.draft.body.trim()
    ) {
      return state;
    }
    // The wire payload is trimmed by both the quick popover and review rail. Preserve the stable
    // retry ID when an edit changes only surrounding whitespace, otherwise a lost successful
    // response could be retried under a new ID and create a duplicate reply.
    const samePayload = state.draft?.threadId === event.threadId
      && state.draft.body.trim() === body.trim();
    return {
      ...state,
      draft: {
        threadId: event.threadId,
        body,
        mutationId: samePayload ? state.draft?.mutationId ?? null : null,
      },
    };
  }
  if (event.type === "draft.discard") {
    if (!state.draft || (event.threadId && state.draft.threadId !== event.threadId)) return state;
    return { ...state, draft: null };
  }
  if (event.type === "mutation.start") {
    const mutationId = studioCommentThreadSessionMutationId(event.plan, event.operationId);
    if (state.submittingMutationId) return state;
    if (mutationThreadId(event.plan) !== state.selectedThreadId) return state;
    if (event.plan.kind === "reply") {
      if (
        !state.draft
        || state.draft.threadId !== event.plan.threadId
        || state.draft.body.trim() !== event.plan.body.trim()
      ) return state;
      return {
        ...state,
        draft: { ...state.draft, mutationId },
        submittingMutationId: mutationId,
      };
    }
    return { ...state, submittingMutationId: mutationId };
  }
  if (event.type === "mutation.failure") {
    return state.submittingMutationId === event.mutationId
      ? { ...state, submittingMutationId: null }
      : state;
  }
  if (event.type === "mutation.receipt") {
    const mutationId = studioCommentThreadSessionMutationId(event.plan, event.operationId);
    const receiptOwnsSubmission = state.submittingMutationId === mutationId;
    const receiptOwnsDraft = event.plan.kind === "reply"
      && studioCommentMutationReceiptOwnsDraft(state.draft?.mutationId, mutationId);
    return {
      ...state,
      submittingMutationId: receiptOwnsSubmission ? null : state.submittingMutationId,
      draft: receiptOwnsDraft ? null : state.draft,
    };
  }
  return state;
}

export type StudioCommentThreadSessionReplyBlockedReason =
  | "closed"
  | "no-selection"
  | "resolved"
  | "draft-target-mismatch"
  | "empty-draft"
  | "submitting"
  | null;

export interface StudioCommentThreadSessionView {
  readonly open: boolean;
  readonly selectedThread: StudioCommentThread | null;
  readonly clusterThreads: readonly StudioCommentThread[];
  readonly selectedClusterIndex: number;
  readonly selectedUnread: boolean;
  readonly unreadClusterCount: number;
  readonly selectedResolved: boolean;
  readonly selectedDraft: StudioCommentThreadSessionDraft | null;
  /** A draft for another or vanished thread stays available for an explicit restore/copy action. */
  readonly preservedDraft: StudioCommentThreadSessionDraft | null;
  readonly draftTargetMissing: boolean;
  readonly replyBlockedReason: StudioCommentThreadSessionReplyBlockedReason;
}

/** Projects one authoritative thread collection into both comment surfaces without copying it. */
export function projectStudioCommentThreadSession(
  state: StudioCommentThreadSessionState,
  threads: readonly StudioCommentThread[],
  unreadThreadIds: ReadonlySet<string> = EMPTY_THREAD_ID_SET
): StudioCommentThreadSessionView {
  const byId = threadsById(threads);
  const selectedThread = state.selectedThreadId
    ? byId.get(state.selectedThreadId) ?? null
    : null;
  const clusterThreads = state.clusterThreadIds
    .map((threadId) => byId.get(threadId))
    .filter((thread): thread is StudioCommentThread => Boolean(thread));
  const selectedDraft = state.draft?.threadId === state.selectedThreadId
    ? state.draft
    : null;
  let replyBlockedReason: StudioCommentThreadSessionReplyBlockedReason = null;
  if (!state.surface) replyBlockedReason = "closed";
  else if (!selectedThread) replyBlockedReason = "no-selection";
  else if (selectedThread.resolved) replyBlockedReason = "resolved";
  else if (state.draft && !selectedDraft) replyBlockedReason = "draft-target-mismatch";
  else if (state.submittingMutationId) replyBlockedReason = "submitting";
  else if (!selectedDraft?.body.trim()) replyBlockedReason = "empty-draft";

  return {
    open: state.surface !== null,
    selectedThread,
    clusterThreads,
    selectedClusterIndex: selectedThread
      ? clusterThreads.findIndex((thread) => thread.id === selectedThread.id)
      : -1,
    selectedUnread: selectedThread ? unreadThreadIds.has(selectedThread.id) : false,
    unreadClusterCount: clusterThreads.reduce(
      (count, thread) => count + Number(unreadThreadIds.has(thread.id)),
      0
    ),
    selectedResolved: selectedThread?.resolved === true,
    selectedDraft,
    preservedDraft: state.draft,
    draftTargetMissing: Boolean(state.draft && !byId.has(state.draft.threadId)),
    replyBlockedReason,
  };
}
