import { describe, expect, it } from "vitest";

import {
  addStudioCommentReply,
  addStudioCommentThread,
  assignStudioCommentThread,
  canonicalStudioCommentAnchorKey,
  createEmptyStudioCommentsDocument,
  createStudioCommentMessageId,
  editStudioCommentReply,
  editStudioCommentThread,
  listStudioCommentThreadsForAnchor,
  normalizeStudioCommentsDocument,
  studioCommentMutationReceiptOwnsDraft,
  reanchorStudioCommentThread,
  removeStudioCommentReply,
  removeStudioCommentThread,
  reopenStudioCommentThread,
  resolveStudioCommentThread,
  serializeStudioCommentsDocument,
  STUDIO_COMMENTS_MAX_BODY_LENGTH,
  STUDIO_COMMENTS_MAX_DISPLAY_NAME_LENGTH,
  STUDIO_COMMENTS_MAX_MENTIONS,
  STUDIO_COMMENTS_MAX_REPLIES_PER_THREAD,
  STUDIO_COMMENTS_MAX_THREADS,
  STUDIO_COMMENTS_MAX_TOTAL_MESSAGES,
  STUDIO_COMMENTS_VERSION,
  StudioCommentsDocumentSchema,
  studioCommentAnchorsEqual,
  type StudioCommentActor,
  type StudioCommentAnchor,
  type StudioCommentsDocument,
} from "./studio-comments";

const AUTHOR: StudioCommentActor = { id: "author-1", displayName: "윤 편집" };
const SECOND_AUTHOR: StudioCommentActor = { id: "author-2", displayName: "한 작가" };
const PAGE_ANCHOR: StudioCommentAnchor = { type: "page", pageId: "page-1" };
const CREATED_AT = new Date("2026-07-10T01:00:00.000Z");
const UPDATED_AT = new Date("2026-07-10T02:00:00.000Z");

describe("studio comment message ids", () => {
  it("creates bounded retry identifiers for thread and reply mutations", () => {
    const commentId = createStudioCommentMessageId("comment");
    const replyId = createStudioCommentMessageId("reply");
    expect(commentId).toMatch(/^comment_[A-Za-z0-9_-]+$/u);
    expect(replyId).toMatch(/^reply_[A-Za-z0-9_-]+$/u);
    expect(commentId.length).toBeLessThanOrEqual(120);
    expect(replyId.length).toBeLessThanOrEqual(120);
    expect(commentId).not.toBe(replyId);
  });

  it("lets only the matching async receipt close the current draft generation", () => {
    expect(studioCommentMutationReceiptOwnsDraft("comment_new", "comment_old")).toBe(false);
    expect(studioCommentMutationReceiptOwnsDraft(null, "comment_old")).toBe(false);
    expect(studioCommentMutationReceiptOwnsDraft("comment_same", "comment_same")).toBe(true);
  });
});

function withThread(
  anchor: StudioCommentAnchor = PAGE_ANCHOR,
  id = "thread-1"
): StudioCommentsDocument {
  return addStudioCommentThread(
    createEmptyStudioCommentsDocument(),
    { id, anchor, author: AUTHOR, body: "첫 댓글" },
    CREATED_AT
  );
}

function legacyThread(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    pageId: "page-1",
    authorName: "  편집자  ",
    text: "  검토 의견  ",
    createdAt: "2026-07-10T01:00:00+09:00",
    ...overrides,
  };
}

describe("studio comments schema and migration", () => {
  it("creates and serializes an empty, strict, versioned document", () => {
    const empty = createEmptyStudioCommentsDocument();
    expect(empty).toEqual({ version: STUDIO_COMMENTS_VERSION, threads: [] });
    expect(JSON.parse(serializeStudioCommentsDocument(empty))).toEqual(empty);
    expect(StudioCommentsDocumentSchema.safeParse({ ...empty, remoteSynced: true }).success).toBe(false);
  });

  it("normalizes page, frame, and element anchors", () => {
    const normalized = normalizeStudioCommentsDocument({
      comments: [
        legacyThread("page"),
        legacyThread("frame", { targetType: "panel", panelId: "frame-1" }),
        legacyThread("element", {
          anchor: { kind: "layer", page: "page-2", panelId: "frame-2", layerId: "layer-1" },
        }),
      ],
    });
    expect(normalized.threads.map(({ anchor }) => anchor)).toEqual([
      { type: "page", pageId: "page-1" },
      { type: "frame", pageId: "page-1", frameId: "frame-1" },
      { type: "element", pageId: "page-2", frameId: "frame-2", elementId: "layer-1" },
    ]);
  });

  it("migrates nested legacy comments, replies, actors, mentions, assignment, and resolution", () => {
    const normalized = normalizeStudioCommentsDocument(JSON.stringify({
      items: [{
        threadId: "legacy-thread",
        anchor: { targetType: "element", pageId: "p1", elementId: "e1" },
        comment: {
          id: "old-message-id",
          author: { userId: "u1", name: "  작가  " },
          content: "  수정했습니다  ",
          mentions: ["@편집자", "편집자", { userId: "u2", name: "리드" }],
          timestamp: "2026-07-10T00:00:00.000Z",
        },
        responses: [{
          replyId: "reply-1",
          creator: "편집자",
          text: " 확인했어요 ",
          created_at: "2026-07-10T00:30:00.000Z",
        }],
        assignedTo: { id: "u2", displayName: " 리드 " },
        status: "resolved",
        resolver: "리드",
        updatedAt: "2026-07-10T01:00:00.000Z",
      }],
    }));

    expect(normalized.threads).toHaveLength(1);
    expect(normalized.threads[0]).toEqual({
      id: "legacy-thread",
      anchor: { type: "element", pageId: "p1", elementId: "e1" },
      author: { id: "u1", displayName: "작가" },
      body: "수정했습니다",
      mentions: [{ displayName: "편집자" }, { id: "u2", displayName: "리드" }],
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-10T01:00:00.000Z",
      replies: [{
        id: "reply-1",
        author: { displayName: "편집자" },
        body: "확인했어요",
        mentions: [],
        createdAt: "2026-07-10T00:30:00.000Z",
        updatedAt: "2026-07-10T00:30:00.000Z",
      }],
      resolved: true,
      resolvedAt: "2026-07-10T01:00:00.000Z",
      resolvedBy: { displayName: "리드" },
      assignee: { id: "u2", displayName: "리드" },
    });
  });

  it("canonicalizes timestamps, trims bounded text, and drops unknown persisted fields", () => {
    const normalized = normalizeStudioCommentsDocument({
      version: 1,
      threads: [legacyThread("bounded", {
        body: "나".repeat(STUDIO_COMMENTS_MAX_BODY_LENGTH + 20),
        text: undefined,
        unknown: "drop",
        updatedAt: "2026-07-10T02:00:00+09:00",
      })],
      unknownRoot: true,
    });
    expect(normalized.threads[0].body).toHaveLength(STUDIO_COMMENTS_MAX_BODY_LENGTH);
    expect(normalized.threads[0].createdAt).toBe("2026-07-09T16:00:00.000Z");
    expect(normalized.threads[0].updatedAt).toBe("2026-07-09T17:00:00.000Z");
    expect(normalized.threads[0]).not.toHaveProperty("unknown");
    expect(normalized).not.toHaveProperty("unknownRoot");
  });

  it("accepts the full server-bounded collaborator display name contract", () => {
    const displayName = "가".repeat(STUDIO_COMMENTS_MAX_DISPLAY_NAME_LENGTH);
    const document = addStudioCommentThread(createEmptyStudioCommentsDocument(), {
      id: "long-name-thread",
      anchor: PAGE_ANCHOR,
      author: { id: "long-name-author", displayName },
      body: "긴 표시 이름 계약 확인",
    }, CREATED_AT);
    expect(document.threads[0].author.displayName).toBe(displayName);
  });

  it("drops malformed records and duplicate IDs without inventing replacements", () => {
    const normalized = normalizeStudioCommentsDocument({
      threads: [
        legacyThread("keep", {
          replies: [
            { id: "reply", author: "A", body: "one", createdAt: "2026-07-10T00:00:00Z" },
            { id: "reply", author: "B", body: "duplicate", createdAt: "2026-07-10T00:01:00Z" },
            { id: "", author: "C", body: "missing id", createdAt: "2026-07-10T00:02:00Z" },
          ],
        }),
        legacyThread("keep"),
        legacyThread("bad-anchor", { pageId: undefined }),
        legacyThread("bad-author", { authorName: undefined }),
        legacyThread("bad-time", { createdAt: "yesterday" }),
      ],
    });
    expect(normalized.threads.map(({ id }) => id)).toEqual(["keep"]);
    expect(normalized.threads[0].replies.map(({ id }) => id)).toEqual(["reply"]);
  });

  it("refuses explicit future versions and safely handles malformed JSON or containers", () => {
    expect(normalizeStudioCommentsDocument({ version: 2, threads: [legacyThread("future")] })).toEqual(
      createEmptyStudioCommentsDocument()
    );
    expect(normalizeStudioCommentsDocument({ version: "2", threads: [legacyThread("future")] })).toEqual(
      createEmptyStudioCommentsDocument()
    );
    expect(normalizeStudioCommentsDocument("{broken")).toEqual(createEmptyStudioCommentsDocument());
    expect(normalizeStudioCommentsDocument({ threads: "wrong" })).toEqual(
      createEmptyStudioCommentsDocument()
    );
  });

  it("enforces reply, mention, thread, and total-message migration limits", () => {
    const manyReplies = Array.from(
      { length: STUDIO_COMMENTS_MAX_REPLIES_PER_THREAD + 5 },
      (_, index) => ({
        id: `reply-${index}`,
        author: "A",
        body: "reply",
        createdAt: "2026-07-10T00:00:00.000Z",
      })
    );
    const manyMentions = Array.from(
      { length: STUDIO_COMMENTS_MAX_MENTIONS + 5 },
      (_, index) => `person-${index}`
    );
    const threads = Array.from({ length: STUDIO_COMMENTS_MAX_THREADS + 5 }, (_, index) =>
      legacyThread(`thread-${index}`, {
        mentions: manyMentions,
        replies: manyReplies.map((reply) => ({ ...reply, id: `${reply.id}-${index}` })),
      })
    );
    const normalized = normalizeStudioCommentsDocument({ threads });
    const messageCount = normalized.threads.reduce(
      (count, thread) => count + 1 + thread.replies.length,
      0
    );
    expect(normalized.threads[0].mentions).toHaveLength(STUDIO_COMMENTS_MAX_MENTIONS);
    expect(normalized.threads[0].replies).toHaveLength(STUDIO_COMMENTS_MAX_REPLIES_PER_THREAD);
    expect(normalized.threads.length).toBeLessThanOrEqual(STUDIO_COMMENTS_MAX_THREADS);
    expect(messageCount).toBe(STUDIO_COMMENTS_MAX_TOTAL_MESSAGES);
  });
});

describe("studio comments immutable operations", () => {
  it("adds a trimmed top-level comment without mutating the source", () => {
    const source = createEmptyStudioCommentsDocument();
    const next = addStudioCommentThread(source, {
      id: " thread-1 ",
      anchor: { type: "frame", pageId: " page-1 ", frameId: " frame-1 " },
      author: { id: "author", displayName: " 작가 " },
      body: "  프레임 구도를 확인해 주세요.  ",
      mentions: [SECOND_AUTHOR, SECOND_AUTHOR],
    }, CREATED_AT);
    expect(source.threads).toEqual([]);
    expect(next).not.toBe(source);
    expect(next.threads[0]).toMatchObject({
      id: "thread-1",
      anchor: { type: "frame", pageId: "page-1", frameId: "frame-1" },
      author: { id: "author", displayName: "작가" },
      body: "프레임 구도를 확인해 주세요.",
      mentions: [SECOND_AUTHOR],
      createdAt: CREATED_AT.toISOString(),
      updatedAt: CREATED_AT.toISOString(),
      resolved: false,
    });
  });

  it("rejects blank/duplicate IDs, blank bodies, bad anchors, and invalid clocks", () => {
    const document = withThread();
    expect(() => addStudioCommentThread(document, {
      id: "thread-1",
      anchor: PAGE_ANCHOR,
      author: AUTHOR,
      body: "duplicate",
    })).toThrow(/사용 중/);
    expect(() => addStudioCommentThread(document, {
      id: "",
      anchor: PAGE_ANCHOR,
      author: AUTHOR,
      body: "invalid",
    })).toThrow(/ID/);
    expect(() => addStudioCommentThread(document, {
      id: "new",
      anchor: PAGE_ANCHOR,
      author: AUTHOR,
      body: "   ",
    })).toThrow(/내용/);
    expect(() => addStudioCommentThread(document, {
      id: "new",
      anchor: { type: "frame", pageId: "page-1", frameId: "" },
      author: AUTHOR,
      body: "invalid anchor",
    })).toThrow(/위치/);
    expect(() => addStudioCommentThread(document, {
      id: "new",
      anchor: PAGE_ANCHOR,
      author: AUTHOR,
      body: "invalid clock",
    }, new Date("invalid"))).toThrow(/시간/);
  });

  it("adds replies with globally unique IDs and preserves unrelated identities", () => {
    const source = withThread();
    const next = addStudioCommentReply(source, "thread-1", {
      id: "reply-1",
      author: SECOND_AUTHOR,
      body: " 반영할게요 ",
      mentions: [AUTHOR],
    }, UPDATED_AT);
    expect(next).not.toBe(source);
    expect(next.threads[0]).not.toBe(source.threads[0]);
    expect(next.threads[0].replies[0]).toMatchObject({
      id: "reply-1",
      body: "반영할게요",
      mentions: [AUTHOR],
      updatedAt: UPDATED_AT.toISOString(),
    });
    expect(next.threads[0].updatedAt).toBe(UPDATED_AT.toISOString());
    expect(() => addStudioCommentReply(next, "thread-1", {
      id: "thread-1",
      author: AUTHOR,
      body: "collision",
    })).toThrow(/사용 중/);
    expect(addStudioCommentReply(source, "missing", {
      id: "unused",
      author: AUTHOR,
      body: "missing",
    })).toBe(source);
  });

  it("edits top-level comments and replies immutably and treats normalized equality as a no-op", () => {
    const withReply = addStudioCommentReply(withThread(), "thread-1", {
      id: "reply-1",
      author: SECOND_AUTHOR,
      body: "초안",
    }, UPDATED_AT);
    const editedThread = editStudioCommentThread(withReply, "thread-1", {
      body: "  수정 의견  ",
      mentions: [SECOND_AUTHOR],
    }, new Date("2026-07-10T03:00:00.000Z"));
    const editedReply = editStudioCommentReply(editedThread, "thread-1", "reply-1", {
      body: "  반영 완료  ",
    }, new Date("2026-07-10T04:00:00.000Z"));

    expect(withReply.threads[0].body).toBe("첫 댓글");
    expect(editedThread.threads[0]).toMatchObject({ body: "수정 의견", mentions: [SECOND_AUTHOR] });
    expect(editedReply.threads[0].replies[0].body).toBe("반영 완료");
    expect(editedReply.threads[0].updatedAt).toBe("2026-07-10T04:00:00.000Z");
    expect(editStudioCommentThread(editedThread, "thread-1", { body: " 수정 의견 " })).toBe(
      editedThread
    );
    expect(editStudioCommentReply(editedReply, "thread-1", "reply-1", { body: "반영 완료" })).toBe(
      editedReply
    );
    expect(() => editStudioCommentThread(withReply, "thread-1", { body: "" })).toThrow(/내용/);
    expect(() => editStudioCommentThread(withReply, "thread-1", { author: AUTHOR } as never)).toThrow(
      /수정할 수 없는/
    );
  });

  it("resolves and reopens a thread with explicit local audit metadata", () => {
    const source = withThread();
    const resolved = resolveStudioCommentThread(source, "thread-1", SECOND_AUTHOR, UPDATED_AT);
    expect(resolved.threads[0]).toMatchObject({
      resolved: true,
      resolvedAt: UPDATED_AT.toISOString(),
      resolvedBy: SECOND_AUTHOR,
      updatedAt: UPDATED_AT.toISOString(),
    });
    expect(resolveStudioCommentThread(resolved, "thread-1", AUTHOR)).toBe(resolved);

    const reopened = reopenStudioCommentThread(
      resolved,
      "thread-1",
      new Date("2026-07-10T03:00:00.000Z")
    );
    expect(reopened.threads[0].resolved).toBe(false);
    expect(reopened.threads[0]).not.toHaveProperty("resolvedAt");
    expect(reopened.threads[0]).not.toHaveProperty("resolvedBy");
    expect(reopenStudioCommentThread(reopened, "thread-1")).toBe(reopened);
  });

  it("assigns, clears, and no-ops an assignee immutably", () => {
    const source = withThread();
    const assigned = assignStudioCommentThread(source, "thread-1", SECOND_AUTHOR, UPDATED_AT);
    expect(source.threads[0]).not.toHaveProperty("assignee");
    expect(assigned.threads[0].assignee).toEqual(SECOND_AUTHOR);
    expect(assignStudioCommentThread(assigned, "thread-1", { ...SECOND_AUTHOR })).toBe(assigned);
    const cleared = assignStudioCommentThread(
      assigned,
      "thread-1",
      null,
      new Date("2026-07-10T03:00:00.000Z")
    );
    expect(cleared.threads[0]).not.toHaveProperty("assignee");
    expect(assignStudioCommentThread(source, "missing", SECOND_AUTHOR)).toBe(source);
  });

  it("reanchors and selects exact page/frame/element targets", () => {
    const page = withThread(PAGE_ANCHOR, "page-thread");
    const frameAnchor: StudioCommentAnchor = { type: "frame", pageId: "page-1", frameId: "f1" };
    const frame = addStudioCommentThread(page, {
      id: "frame-thread",
      anchor: frameAnchor,
      author: AUTHOR,
      body: "frame",
    }, UPDATED_AT);
    const movedAnchor: StudioCommentAnchor = {
      type: "element",
      pageId: "page-1",
      frameId: "f1",
      elementId: "e1",
    };
    const moved = reanchorStudioCommentThread(frame, "page-thread", movedAnchor, UPDATED_AT);
    expect(moved.threads[0].anchor).toEqual(movedAnchor);
    expect(listStudioCommentThreadsForAnchor(moved, movedAnchor).map(({ id }) => id)).toEqual([
      "page-thread",
    ]);
    expect(listStudioCommentThreadsForAnchor(moved, frameAnchor).map(({ id }) => id)).toEqual([
      "frame-thread",
    ]);
    expect(reanchorStudioCommentThread(moved, "page-thread", { ...movedAnchor })).toBe(moved);
  });

  it("uses one collision-safe canonical identity for framed elements and nearby point pins", () => {
    const firstPoint: StudioCommentAnchor = {
      type: "point",
      pageId: "page-1",
      x: 0.234441,
      y: 0.765541,
    };
    const nearbyPoint: StudioCommentAnchor = {
      type: "point",
      pageId: "page-1",
      x: 0.234449,
      y: 0.765549,
    };
    const separatePoint: StudioCommentAnchor = {
      type: "point",
      pageId: "page-1",
      x: 0.23456,
      y: 0.76566,
    };
    const firstFrameElement: StudioCommentAnchor = {
      type: "element",
      pageId: "page-1",
      frameId: "frame-1",
      elementId: "shared-element-id",
    };
    const secondFrameElement: StudioCommentAnchor = {
      type: "element",
      pageId: "page-1",
      frameId: "frame-2",
      elementId: "shared-element-id",
    };

    expect(canonicalStudioCommentAnchorKey(firstPoint)).toBe(
      canonicalStudioCommentAnchorKey(nearbyPoint)
    );
    expect(studioCommentAnchorsEqual(firstPoint, nearbyPoint)).toBe(true);
    expect(studioCommentAnchorsEqual(firstPoint, separatePoint)).toBe(false);
    expect(canonicalStudioCommentAnchorKey(firstFrameElement)).toBe(
      canonicalStudioCommentAnchorKey(secondFrameElement)
    );
    expect(studioCommentAnchorsEqual(firstFrameElement, secondFrameElement)).toBe(true);

    const source = withThread(firstPoint);
    expect(listStudioCommentThreadsForAnchor(source, nearbyPoint).map(({ id }) => id)).toEqual([
      "thread-1",
    ]);
    expect(reanchorStudioCommentThread(source, "thread-1", nearbyPoint)).toBe(source);

    const serialized = JSON.parse(serializeStudioCommentsDocument(source)) as StudioCommentsDocument;
    expect(serialized.version).toBe(STUDIO_COMMENTS_VERSION);
    expect(serialized.threads[0].anchor).toEqual(firstPoint);
  });

  it("can exclude resolved threads from exact-anchor selections", () => {
    const source = withThread();
    const resolved = resolveStudioCommentThread(source, "thread-1", null, UPDATED_AT);
    expect(listStudioCommentThreadsForAnchor(resolved, PAGE_ANCHOR)).toHaveLength(1);
    expect(
      listStudioCommentThreadsForAnchor(resolved, PAGE_ANCHOR, { includeResolved: false })
    ).toEqual([]);
  });

  it("removes replies and threads without mutating sources and preserves identity when missing", () => {
    const withReply = addStudioCommentReply(withThread(), "thread-1", {
      id: "reply-1",
      author: SECOND_AUTHOR,
      body: "답글",
    }, UPDATED_AT);
    const withoutReply = removeStudioCommentReply(
      withReply,
      "thread-1",
      "reply-1",
      new Date("2026-07-10T03:00:00.000Z")
    );
    expect(withReply.threads[0].replies).toHaveLength(1);
    expect(withoutReply.threads[0].replies).toEqual([]);
    expect(removeStudioCommentReply(withoutReply, "thread-1", "missing")).toBe(withoutReply);
    expect(removeStudioCommentThread(withoutReply, "missing")).toBe(withoutReply);
    expect(removeStudioCommentThread(withoutReply, "thread-1")).toEqual(
      createEmptyStudioCommentsDocument()
    );
  });
});

describe("studio comments hard limits", () => {
  it("rejects additions at the per-thread and document limits", () => {
    const maxReplies = Array.from({ length: STUDIO_COMMENTS_MAX_REPLIES_PER_THREAD }, (_, index) => ({
      id: `reply-${index}`,
      author: AUTHOR,
      body: "reply",
      mentions: [],
      createdAt: CREATED_AT.toISOString(),
      updatedAt: CREATED_AT.toISOString(),
    }));
    const fullReplyThread = StudioCommentsDocumentSchema.parse({
      version: STUDIO_COMMENTS_VERSION,
      threads: [{
        ...withThread().threads[0],
        replies: maxReplies,
      }],
    });
    expect(() => addStudioCommentReply(fullReplyThread, "thread-1", {
      id: "overflow",
      author: AUTHOR,
      body: "overflow",
    })).toThrow(/스레드당/);

    const fullThreads = normalizeStudioCommentsDocument({
      threads: Array.from({ length: STUDIO_COMMENTS_MAX_THREADS }, (_, index) =>
        legacyThread(`thread-${index}`)
      ),
    });
    expect(() => addStudioCommentThread(fullThreads, {
      id: "overflow",
      anchor: PAGE_ANCHOR,
      author: AUTHOR,
      body: "overflow",
    })).toThrow(/스레드는 최대/);
  });
});
