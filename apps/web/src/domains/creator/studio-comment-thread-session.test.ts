import { describe, expect, it } from "vitest";

import {
  createStudioCommentThreadSessionState,
  projectStudioCommentThreadSession,
  reduceStudioCommentThreadSession,
  selectStudioCommentThreadSessionSourceThreads,
  studioCommentThreadSessionCloseDiscardsDraft,
  studioCommentThreadSessionDraftBlocksResolutionChange,
  studioCommentThreadSessionMutationId,
  type StudioCommentThreadSessionState,
} from "./studio-comment-thread-session";
import {
  addStudioCommentReply,
  addStudioCommentThread,
  createEmptyStudioCommentsDocument,
  resolveStudioCommentThread,
  type StudioCommentThread,
} from "./studio-comments";
import { planStudioTeamCommentMutation } from "./studio-team-comment-mutation-plan";

const actor = { id: "user-1", displayName: "하린" };
const otherActor = { id: "user-2", displayName: "민호" };

function createThreads(): readonly StudioCommentThread[] {
  let document = addStudioCommentThread(createEmptyStudioCommentsDocument(), {
    id: "thread-old",
    anchor: { type: "point", pageId: "page-1", x: 0.2, y: 0.3 },
    author: actor,
    body: "선 정리를 확인해 주세요.",
  }, new Date("2026-07-22T01:00:00.000Z"));
  document = addStudioCommentThread(document, {
    id: "thread-new",
    anchor: { type: "point", pageId: "page-1", x: 0.2, y: 0.3 },
    author: otherActor,
    body: "말풍선 간격도 확인해 주세요.",
  }, new Date("2026-07-22T02:00:00.000Z"));
  document = addStudioCommentThread(document, {
    id: "thread-other",
    anchor: { type: "point", pageId: "page-1", x: 0.8, y: 0.7 },
    author: actor,
    body: "다른 위치 댓글입니다.",
  }, new Date("2026-07-22T03:00:00.000Z"));
  return document.threads;
}

function reconcile(
  state: StudioCommentThreadSessionState,
  threads: readonly StudioCommentThread[],
  unreadThreadIds: readonly string[] = []
): StudioCommentThreadSessionState {
  return reduceStudioCommentThreadSession(state, {
    type: "threads.reconcile",
    threads,
    unreadThreadIds: new Set(unreadThreadIds),
  });
}

function openPin(
  state: StudioCommentThreadSessionState,
  threads: readonly StudioCommentThread[],
  preferredThreadId?: string,
  unreadThreadIds: readonly string[] = []
): StudioCommentThreadSessionState {
  return reduceStudioCommentThreadSession(state, {
    type: "session.open",
    surface: "pin-quick-reply",
    reason: "canvas-pin",
    threads,
    preferredThreadId,
    unreadThreadIds: new Set(unreadThreadIds),
    clusterThreadIds: ["thread-old", "thread-new", "thread-old", "missing"],
  });
}

function replyPlan(
  threads: readonly StudioCommentThread[],
  threadId: string,
  mutationId: string,
  body: string
) {
  const previous = { version: 1 as const, threads: [...threads] };
  const next = addStudioCommentReply(previous, threadId, {
    id: mutationId,
    author: actor,
    body,
  }, new Date("2026-07-22T04:00:00.000Z"));
  const plan = planStudioTeamCommentMutation(previous, next);
  if (!plan || plan.kind !== "reply") throw new Error("reply plan expected");
  return plan;
}

describe("studio comment thread session", () => {
  it("discards only explicit X/Escape cancellations, never incidental surface transitions", () => {
    expect(studioCommentThreadSessionCloseDiscardsDraft("explicit")).toBe(true);
    expect(studioCommentThreadSessionCloseDiscardsDraft("escape")).toBe(true);
    expect(studioCommentThreadSessionCloseDiscardsDraft("outside-pointer")).toBe(false);
    expect(studioCommentThreadSessionCloseDiscardsDraft("tool-switch")).toBe(false);
    expect(studioCommentThreadSessionCloseDiscardsDraft("thread-disappeared")).toBe(false);
  });

  it("opens a pin cluster on the newest unread thread and preserves deterministic cluster order", () => {
    const threads = createThreads();
    const reconciled = reconcile(
      createStudioCommentThreadSessionState(),
      threads,
      ["thread-old"]
    );

    const state = openPin(reconciled, threads, undefined, ["thread-old"]);
    const view = projectStudioCommentThreadSession(state, threads, new Set(["thread-old"]));

    expect(state).toMatchObject({
      surface: "pin-quick-reply",
      selectedThreadId: "thread-old",
      clusterThreadIds: ["thread-old", "thread-new"],
      selectionScope: "cluster",
      openReason: "canvas-pin",
      closeReason: null,
    });
    expect(view.clusterThreads.map((thread) => thread.id)).toEqual([
      "thread-old",
      "thread-new",
    ]);
    expect(view.selectedClusterIndex).toBe(0);
    expect(view.selectedUnread).toBe(true);
    expect(view.unreadClusterCount).toBe(1);
  });

  it("honors an explicit clustered-pin target before unread and activity fallback", () => {
    const threads = createThreads();
    const reconciled = reconcile(
      createStudioCommentThreadSessionState(),
      threads,
      ["thread-old"]
    );

    expect(openPin(reconciled, threads, "thread-new", ["thread-old"]).selectedThreadId)
      .toBe("thread-new");
  });

  it("shares one selection and draft while switching from quick reply to the review panel", () => {
    const threads = createThreads();
    let state = openPin(createStudioCommentThreadSessionState(), threads, "thread-new");
    state = reduceStudioCommentThreadSession(state, {
      type: "draft.change",
      threadId: "thread-new",
      body: "이 간격으로 반영하겠습니다.",
    });
    state = reduceStudioCommentThreadSession(state, {
      type: "session.close",
      reason: "outside-pointer",
    });
    expect(state.draft?.body).toBe("이 간격으로 반영하겠습니다.");

    state = reduceStudioCommentThreadSession(state, {
      type: "session.open",
      surface: "review-panel",
      reason: "draft-restore",
      threads,
      preferredThreadId: "thread-new",
    });
    const view = projectStudioCommentThreadSession(state, threads);
    expect(state.selectedThreadId).toBe("thread-new");
    expect(state.surface).toBe("review-panel");
    expect(view.selectedDraft?.body).toBe("이 간격으로 반영하겠습니다.");
    expect(view.replyBlockedReason).toBeNull();
  });

  it("requires an explicit discard before replacing a non-empty draft for another thread", () => {
    const threads = createThreads();
    let state = openPin(createStudioCommentThreadSessionState(), threads, "thread-old");
    state = reduceStudioCommentThreadSession(state, {
      type: "draft.change",
      threadId: "thread-old",
      body: "보존할 초안",
    });
    const protectedState = reduceStudioCommentThreadSession(state, {
      type: "draft.change",
      threadId: "thread-new",
      body: "덮어쓸 초안",
    });
    expect(protectedState).toBe(state);

    state = reduceStudioCommentThreadSession(state, {
      type: "draft.discard",
      threadId: "thread-old",
    });
    state = reduceStudioCommentThreadSession(state, {
      type: "draft.change",
      threadId: "thread-new",
      body: "새 초안",
    });
    expect(state.draft).toEqual({
      threadId: "thread-new",
      body: "새 초안",
      mutationId: null,
    });
  });

  it("keeps a stable reply mutation ID after failure and clears only on its matching receipt", () => {
    const threads = createThreads();
    const plan = replyPlan(threads, "thread-new", "reply-retry", "재시도할 답글");
    let state = openPin(createStudioCommentThreadSessionState(), threads, "thread-new");
    state = reduceStudioCommentThreadSession(state, {
      type: "draft.change",
      threadId: "thread-new",
      body: "재시도할 답글",
    });
    state = reduceStudioCommentThreadSession(state, { type: "mutation.start", plan });
    expect(state.submittingMutationId).toBe("reply-retry");
    expect(state.draft?.mutationId).toBe("reply-retry");

    state = reduceStudioCommentThreadSession(state, {
      type: "mutation.failure",
      mutationId: "reply-retry",
    });
    expect(state.submittingMutationId).toBeNull();
    expect(state.draft?.mutationId).toBe("reply-retry");

    state = reduceStudioCommentThreadSession(state, {
      type: "draft.change",
      threadId: "thread-new",
      body: "  재시도할 답글  ",
    });
    expect(state.draft?.mutationId).toBe("reply-retry");

    state = reduceStudioCommentThreadSession(state, { type: "mutation.start", plan });
    state = reduceStudioCommentThreadSession(state, {
      type: "mutation.receipt",
      plan,
    });
    expect(state.submittingMutationId).toBeNull();
    expect(state.draft).toBeNull();
  });

  it("does not let a late old reply receipt clear a newer submission or edited draft", () => {
    const threads = createThreads();
    const oldPlan = replyPlan(threads, "thread-new", "reply-old", "첫 초안");
    const newPlan = replyPlan(threads, "thread-new", "reply-new", "새 초안");
    let state = openPin(createStudioCommentThreadSessionState(), threads, "thread-new");
    state = reduceStudioCommentThreadSession(state, {
      type: "draft.change",
      threadId: "thread-new",
      body: "첫 초안",
    });
    state = reduceStudioCommentThreadSession(state, { type: "mutation.start", plan: oldPlan });
    state = reduceStudioCommentThreadSession(state, {
      type: "mutation.failure",
      mutationId: "reply-old",
    });
    state = reduceStudioCommentThreadSession(state, {
      type: "draft.change",
      threadId: "thread-new",
      body: "새 초안",
    });
    state = reduceStudioCommentThreadSession(state, { type: "mutation.start", plan: newPlan });
    state = reduceStudioCommentThreadSession(state, {
      type: "mutation.receipt",
      plan: oldPlan,
    });

    expect(state.submittingMutationId).toBe("reply-new");
    expect(state.draft).toEqual({
      threadId: "thread-new",
      body: "새 초안",
      mutationId: "reply-new",
    });
  });

  it("falls back within a surviving pin cluster while preserving an orphaned draft", () => {
    const threads = createThreads();
    let state = openPin(createStudioCommentThreadSessionState(), threads, "thread-old");
    state = reduceStudioCommentThreadSession(state, {
      type: "draft.change",
      threadId: "thread-old",
      body: "사라진 스레드에 쓰던 초안",
    });
    const survivingThreads = threads.filter((thread) => thread.id !== "thread-old");
    state = reconcile(state, survivingThreads, ["thread-new"]);
    const view = projectStudioCommentThreadSession(state, survivingThreads);

    expect(state.selectedThreadId).toBe("thread-new");
    expect(state.openReason).toBe("thread-fallback");
    expect(state.surface).toBe("pin-quick-reply");
    expect(view.draftTargetMissing).toBe(true);
    expect(view.preservedDraft?.body).toBe("사라진 스레드에 쓰던 초안");
    expect(view.replyBlockedReason).toBe("draft-target-mismatch");
  });

  it("closes a stale pin with no surviving cluster thread without deleting its draft", () => {
    const threads = createThreads();
    let state = openPin(createStudioCommentThreadSessionState(), threads, "thread-old");
    state = reduceStudioCommentThreadSession(state, {
      type: "draft.change",
      threadId: "thread-old",
      body: "복사할 수 있도록 남겨 둘 초안",
    });
    state = reconcile(
      state,
      threads.filter((thread) => !["thread-old", "thread-new"].includes(thread.id))
    );

    expect(state).toMatchObject({
      surface: null,
      selectedThreadId: null,
      closeReason: "thread-disappeared",
    });
    expect(state.draft?.body).toBe("복사할 수 있도록 남겨 둘 초안");
  });

  it("keeps an empty review panel open when its selected thread disappears", () => {
    const threads = createThreads();
    let state = reduceStudioCommentThreadSession(createStudioCommentThreadSessionState(), {
      type: "session.open",
      surface: "review-panel",
      reason: "focus-request",
      preferredThreadId: "thread-new",
      threads,
    });
    state = reconcile(state, []);
    expect(state.surface).toBe("review-panel");
    expect(state.selectedThreadId).toBeNull();
    expect(projectStudioCommentThreadSession(state, []).replyBlockedReason).toBe("no-selection");
  });

  it("derives resolution from the authoritative thread instead of duplicating it in session state", () => {
    const threads = createThreads();
    const document = resolveStudioCommentThread(
      { version: 1, threads: [...threads] },
      "thread-new",
      actor,
      new Date("2026-07-22T05:00:00.000Z")
    );
    const state = openPin(createStudioCommentThreadSessionState(), document.threads, "thread-new");
    const view = projectStudioCommentThreadSession(state, document.threads);

    expect(view.selectedResolved).toBe(true);
    expect(view.replyBlockedReason).toBe("resolved");
    const resolvePlan = { kind: "reopen", threadId: "thread-new" } as const;
    expect(() => studioCommentThreadSessionMutationId(resolvePlan)).toThrow(/operationId/);
    expect(studioCommentThreadSessionMutationId(resolvePlan, "reopen-request-1")).toBe(
      "reopen-request-1"
    );
  });

  it("retains only the active resolved pin thread so a collaborator cannot orphan its draft", () => {
    const threads = createThreads();
    let state = openPin(createStudioCommentThreadSessionState(), threads, "thread-new");
    state = reduceStudioCommentThreadSession(state, {
      type: "draft.change",
      threadId: "thread-new",
      body: "해결 알림과 경합해도 남길 초안",
    });
    const resolvedDocument = resolveStudioCommentThread(
      resolveStudioCommentThread(
        { version: 1, threads: [...threads] },
        "thread-new",
        actor,
        new Date("2026-07-22T05:00:00.000Z")
      ),
      "thread-other",
      actor,
      new Date("2026-07-22T05:01:00.000Z")
    );

    const sourceThreads = selectStudioCommentThreadSessionSourceThreads(
      state.surface,
      state.selectedThreadId,
      state.draft?.threadId ?? null,
      resolvedDocument.threads
    );
    expect(sourceThreads.map((thread) => thread.id)).toContain("thread-new");
    expect(sourceThreads.map((thread) => thread.id)).not.toContain("thread-other");

    state = reconcile(state, sourceThreads);
    const view = projectStudioCommentThreadSession(state, sourceThreads);
    expect(view.selectedThread?.id).toBe("thread-new");
    expect(view.selectedResolved).toBe(true);
    expect(view.selectedDraft?.body).toBe("해결 알림과 경합해도 남길 초안");
    expect(view.draftTargetMissing).toBe(false);
    expect(studioCommentThreadSessionDraftBlocksResolutionChange(
      state,
      "thread-new",
      false
    )).toBe(false);
    expect(studioCommentThreadSessionDraftBlocksResolutionChange(
      state,
      "thread-new",
      true
    )).toBe(true);
  });

  it("truncates oversized drafts and discards them only when close explicitly requests it", () => {
    const threads = createThreads();
    let state = openPin(createStudioCommentThreadSessionState(), threads, "thread-new");
    state = reduceStudioCommentThreadSession(state, {
      type: "draft.change",
      threadId: "thread-new",
      body: "가".repeat(4_100),
    });
    expect(state.draft?.body).toHaveLength(4_000);
    state = reduceStudioCommentThreadSession(state, {
      type: "session.close",
      reason: "explicit",
      discardDraft: true,
    });
    expect(state.draft).toBeNull();
  });
});
