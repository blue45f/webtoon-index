import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  addStudioCommentThread,
  createEmptyStudioCommentsDocument,
  type StudioCommentAnchor,
} from "./studio-comments";
import {
  addStudioTeamCommentReply,
  createStudioTeamCommentThread,
  getStudioTeamCommentThread,
  isStudioTeamCommentResponseContractError,
  listAllStudioTeamComments,
  listStudioTeamComments,
  markAllStudioTeamCommentsRead,
  markStudioTeamCommentRead,
  reopenStudioTeamCommentThread,
  reanchorStudioTeamCommentThread,
  resolveStudioTeamCommentThread,
  studioCommentAnchorToTeamCommentAnchor,
  studioTeamCommentsOrLocalFallback,
  studioTeamCommentsToLocalDocument,
  teamCommentAnchorToStudioCommentAnchor,
  StudioTeamCommentResponseContractError,
  type StudioTeamCommentListResponse,
  type StudioTeamCommentThread,
} from "./studio-team-comment-client";

const { apiGet, apiPost, toApiError } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  toApiError: vi.fn(async (_error: unknown, fallback: string) =>
    new Error(`안전 오류: ${fallback}`)
  ),
}));

vi.mock("@/src/infrastructure/api", () => ({
  api: { get: apiGet, post: apiPost },
  toApiError,
}));

const CREATED_AT = "2026-07-18T01:00:00.000Z";
const REPLIED_AT = "2026-07-18T01:05:00.000Z";
const RESOLVED_AT = "2026-07-18T01:10:00.000Z";
const ACTOR = { userId: "user-1", name: "하린" } as const;
const PAGE_ANCHOR = { type: "page", pageId: "page-1" } as const;

function openThread(
  overrides: Partial<StudioTeamCommentThread> = {}
): StudioTeamCommentThread {
  return {
    id: "thread-1",
    workId: "work/한글",
    anchor: PAGE_ANCHOR,
    status: "open",
    createdBy: ACTOR,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: CREATED_AT,
    updatedAt: REPLIED_AT,
    latestActivitySequence: "2",
    unread: true,
    messageCount: 2,
    messages: [
      { id: "message-1", author: ACTOR, body: "첫 댓글", createdAt: CREATED_AT },
      {
        id: "message-2",
        author: { userId: "user-2", name: "민호" },
        body: "답글",
        createdAt: REPLIED_AT,
      },
    ],
    messagesTruncated: false,
    ...overrides,
  };
}

function resolvedThread(
  overrides: Partial<StudioTeamCommentThread> = {}
): StudioTeamCommentThread {
  return openThread({
    status: "resolved",
    resolvedBy: ACTOR,
    resolvedAt: RESOLVED_AT,
    updatedAt: RESOLVED_AT,
    latestActivitySequence: "3",
    ...overrides,
  });
}

function listResponse(
  overrides: Partial<StudioTeamCommentListResponse> = {}
): StudioTeamCommentListResponse {
  return {
    workId: "work/한글",
    capabilities: { view: true, comment: true, resolve: true },
    items: [openThread()],
    nextCursor: null,
    ...overrides,
  };
}

function threadWithMessages(threadIndex: number, count = 51): StudioTeamCommentThread {
  return openThread({
    id: `thread-${threadIndex}`,
    messageCount: count,
    messages: Array.from({ length: count }, (_, messageIndex) => ({
      id: `message-${threadIndex}-${messageIndex}`,
      author: ACTOR,
      body: `댓글 ${threadIndex}-${messageIndex}`,
      createdAt: CREATED_AT,
    })),
  });
}

describe("Studio team comment API client", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    toApiError.mockClear();
  });

  it("encodes the work id and sends a bounded, explicit list query through the shared auth client", async () => {
    apiGet.mockResolvedValue(listResponse());
    const controller = new AbortController();

    await expect(
      listStudioTeamComments(
        "work/한글",
        { status: "open", limit: 12, messageLimit: 34, cursor: "cursor_1" },
        controller.signal
      )
    ).resolves.toEqual(listResponse());

    expect(apiGet).toHaveBeenCalledWith(
      "/creator/works/work%2F%ED%95%9C%EA%B8%80/team/comments",
      {
        params: {
          status: "open",
          limit: 12,
          messageLimit: 34,
          cursor: "cursor_1",
        },
        signal: controller.signal,
      }
    );
  });

  it("accumulates every bounded cursor page with complete message histories", async () => {
    apiGet
      .mockResolvedValueOnce(listResponse({ nextCursor: "cursor_2" }))
      .mockResolvedValueOnce(listResponse({
        items: [openThread({ id: "thread-2" })],
        nextCursor: null,
      }));

    await expect(listAllStudioTeamComments("work/한글")).resolves.toMatchObject({
      workId: "work/한글",
      items: [{ id: "thread-2" }, { id: "thread-1" }],
      nextCursor: null,
    });
    expect(apiGet.mock.calls.map(([, options]) => options.params)).toEqual([
      { status: "all", limit: 9, messageLimit: 51, cursor: undefined },
      { status: "all", limit: 9, messageLimit: 51, cursor: "cursor_2" },
    ]);
  });

  it("rejects response pages that exceed the exact requested item or message window", async () => {
    apiGet
      .mockResolvedValueOnce(listResponse({
        items: [openThread(), openThread({ id: "thread-2" })],
      }))
      .mockResolvedValueOnce(listResponse());

    await expect(listStudioTeamComments("work/한글", {
      limit: 1,
      messageLimit: 2,
    })).rejects.toBeInstanceOf(StudioTeamCommentResponseContractError);
    await expect(listStudioTeamComments("work/한글", {
      limit: 1,
      messageLimit: 1,
    })).rejects.toBeInstanceOf(StudioTeamCommentResponseContractError);

    expect(toApiError).not.toHaveBeenCalled();
  });

  it("fails closed when complete pagination cycles or crosses the local 1,000-message contract", async () => {
    apiGet
      .mockResolvedValueOnce(listResponse({ nextCursor: "cursor_cycle" }))
      .mockResolvedValueOnce(listResponse({
        items: [openThread({ id: "thread-2" })],
        nextCursor: "cursor_cycle",
      }));
    await expect(listAllStudioTeamComments("work/한글"))
      .rejects.toThrow("댓글 페이지 커서가 순환했습니다");

    apiGet
      .mockResolvedValueOnce(listResponse({
        items: Array.from({ length: 9 }, (_, index) => threadWithMessages(index + 1)),
        nextCursor: "cursor_2",
      }))
      .mockResolvedValueOnce(listResponse({
        items: Array.from({ length: 9 }, (_, index) => threadWithMessages(index + 10)),
        nextCursor: "cursor_3",
      }))
      .mockResolvedValueOnce(listResponse({
        items: [threadWithMessages(19), threadWithMessages(20)],
        nextCursor: null,
      }));

    await expect(listAllStudioTeamComments("work/한글"))
      .rejects.toThrow("댓글 메시지 스냅샷이 지원 한도를 벗어났습니다");
  });

  it("creates and replies with canonical trimmed bodies and exact semantic anchors", async () => {
    const created = openThread({ messages: [openThread().messages[0]], messageCount: 1 });
    apiPost
      .mockResolvedValueOnce(created)
      .mockResolvedValueOnce({
        threadId: "thread/한글",
        message: {
          id: "message-3",
          author: ACTOR,
          body: "후속 답글",
          createdAt: REPLIED_AT,
        },
        latestActivitySequence: "3",
      });

    await createStudioTeamCommentThread("work/한글", {
      mutationId: "mutation-create-1",
      anchor: { type: "element", pageId: "page-1", frameId: "frame-1", elementId: "el-1" },
      body: "  첫 댓글  ",
    });
    await addStudioTeamCommentReply("work/한글", "thread/한글", {
      mutationId: "mutation-reply-1",
      body: "  후속 답글  ",
    });

    expect(apiPost).toHaveBeenNthCalledWith(
      1,
      "/creator/works/work%2F%ED%95%9C%EA%B8%80/team/comments",
      {
        anchor: {
          type: "element",
          pageId: "page-1",
          frameId: "frame-1",
          elementId: "el-1",
        },
        body: "첫 댓글",
      },
      {
        signal: undefined,
        headers: { "Idempotency-Key": "mutation-create-1" },
      }
    );
    expect(apiPost).toHaveBeenNthCalledWith(
      2,
      "/creator/works/work%2F%ED%95%9C%EA%B8%80/team/comments/thread%2F%ED%95%9C%EA%B8%80/replies",
      { body: "후속 답글" },
      {
        signal: undefined,
        headers: { "Idempotency-Key": "mutation-reply-1" },
      }
    );
  });

  it("loads one bounded thread and re-anchors it with a retry key and activity CAS", async () => {
    const movedAnchor = { type: "point" as const, pageId: "page-1", x: 0.75, y: 0.8 };
    apiGet.mockResolvedValueOnce(openThread());
    apiPost.mockResolvedValueOnce({
      threadId: "thread/한글",
      anchor: movedAnchor,
      updatedAt: RESOLVED_AT,
      latestActivitySequence: "3",
    });
    const controller = new AbortController();

    await expect(getStudioTeamCommentThread(
      "work/한글",
      "thread-1",
      { messageLimit: 17 },
      controller.signal
    )).resolves.toMatchObject({ id: "thread-1" });
    await expect(reanchorStudioTeamCommentThread(
      "work/한글",
      "thread/한글",
      {
        mutationId: "mutation-reanchor-1",
        anchor: movedAnchor,
        expectedActivitySequence: "2",
      },
      controller.signal
    )).resolves.toEqual({
      threadId: "thread/한글",
      anchor: movedAnchor,
      updatedAt: RESOLVED_AT,
      latestActivitySequence: "3",
    });

    expect(apiGet).toHaveBeenCalledWith(
      "/creator/works/work%2F%ED%95%9C%EA%B8%80/team/comments/thread-1",
      { params: { messageLimit: 17 }, signal: controller.signal }
    );
    expect(apiPost).toHaveBeenCalledWith(
      "/creator/works/work%2F%ED%95%9C%EA%B8%80/team/comments/thread%2F%ED%95%9C%EA%B8%80/reanchor",
      { anchor: movedAnchor, expectedActivitySequence: "2" },
      {
        signal: controller.signal,
        headers: { "Idempotency-Key": "mutation-reanchor-1" },
      }
    );
  });

  it("fails closed on invalid detail bounds, anchors, activity frontiers, and re-anchor scope", async () => {
    await expect(getStudioTeamCommentThread(
      "work-1",
      "thread-1",
      { messageLimit: 52 }
    )).rejects.toThrow("댓글 상세 조회 조건이 올바르지 않습니다");
    await expect(reanchorStudioTeamCommentThread("work-1", "thread-1", {
      mutationId: "mutation-reanchor-invalid-point",
      anchor: { type: "point", pageId: "page-1", x: -0.01, y: 0.5 },
      expectedActivitySequence: "2",
    })).rejects.toThrow("댓글의 새 위치 또는 변경 기준이 올바르지 않습니다");
    await expect(reanchorStudioTeamCommentThread("work-1", "thread-1", {
      mutationId: "mutation-reanchor-invalid-sequence",
      anchor: PAGE_ANCHOR,
      expectedActivitySequence: "0",
    })).rejects.toThrow("댓글의 새 위치 또는 변경 기준이 올바르지 않습니다");
    expect(apiGet).not.toHaveBeenCalled();
    expect(apiPost).not.toHaveBeenCalled();

    apiGet.mockResolvedValueOnce(openThread({ workId: "work-other" }));
    await expect(getStudioTeamCommentThread("work/한글", "thread-1"))
      .rejects.toBeInstanceOf(StudioTeamCommentResponseContractError);

    apiPost.mockResolvedValueOnce({
      threadId: "thread-other",
      anchor: PAGE_ANCHOR,
      updatedAt: RESOLVED_AT,
      latestActivitySequence: "3",
    });
    await expect(reanchorStudioTeamCommentThread("work-1", "thread-1", {
      mutationId: "mutation-reanchor-wrong-scope",
      anchor: PAGE_ANCHOR,
      expectedActivitySequence: "2",
    })).rejects.toBeInstanceOf(StudioTeamCommentResponseContractError);
  });

  it("adds a cryptographically random retry key when no local mutation id is available", async () => {
    apiPost.mockResolvedValueOnce(
      openThread({ messages: [openThread().messages[0]], messageCount: 1 })
    );

    await createStudioTeamCommentThread("work/한글", {
      anchor: PAGE_ANCHOR,
      body: "첫 댓글",
    });

    const requestOptions = apiPost.mock.calls[0]?.[2] as {
      headers?: { "Idempotency-Key"?: unknown };
    } | undefined;
    expect(requestOptions?.headers?.["Idempotency-Key"]).toEqual(expect.stringMatching(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    ));
  });

  it("uses dedicated resolve, reopen, per-thread read, and bulk read endpoints", async () => {
    apiPost
      .mockResolvedValueOnce({
        threadId: "thread-1",
        status: "resolved",
        resolvedBy: ACTOR,
        resolvedAt: RESOLVED_AT,
        updatedAt: RESOLVED_AT,
        latestActivitySequence: "3",
      })
      .mockResolvedValueOnce({
        threadId: "thread-1",
        status: "open",
        resolvedBy: null,
        resolvedAt: null,
        updatedAt: "2026-07-18T01:11:00.000Z",
        latestActivitySequence: "4",
      })
      .mockResolvedValueOnce({
        threadId: "thread-1",
        lastReadActivitySequence: "4",
        readAt: "2026-07-18T01:12:00.000Z",
      })
      .mockResolvedValueOnce({
        workId: "work-1",
        readCount: 7,
        readAt: "2026-07-18T01:13:00.000Z",
      });

    await resolveStudioTeamCommentThread("work-1", "thread-1");
    await reopenStudioTeamCommentThread("work-1", "thread-1");
    await markStudioTeamCommentRead("work-1", "thread-1");
    await markAllStudioTeamCommentsRead("work-1");

    expect(apiPost.mock.calls.map(([path]) => path)).toEqual([
      "/creator/works/work-1/team/comments/thread-1/resolve",
      "/creator/works/work-1/team/comments/thread-1/reopen",
      "/creator/works/work-1/team/comments/thread-1/read",
      "/creator/works/work-1/team/comments/read",
    ]);
    expect(apiPost.mock.calls.every(([, body]) => body === undefined)).toBe(true);
  });

  it("fails closed on extra response fields, inconsistent truncation, or another scope", async () => {
    apiGet
      .mockResolvedValueOnce({ ...listResponse(), privateServerField: "must not pass" })
      .mockResolvedValueOnce(
        listResponse({
          items: [openThread({ messageCount: 3, messagesTruncated: false })],
        })
      )
      .mockResolvedValueOnce(listResponse({ workId: "work-other" }));

    for (let index = 0; index < 3; index += 1) {
      const error = await listStudioTeamComments("work/한글").catch(
        (cause: unknown) => cause
      );
      expect(isStudioTeamCommentResponseContractError(error)).toBe(true);
    }
    expect(toApiError).not.toHaveBeenCalled();
  });

  it("rejects invalid client input before a request and maps only transport failures", async () => {
    await expect(
      listStudioTeamComments("work-1", { limit: 51 })
    ).rejects.toThrow("댓글 목록 조건이 올바르지 않습니다");
    await expect(
      createStudioTeamCommentThread("work-1", {
        mutationId: "mutation-invalid-anchor",
        anchor: { type: "point", pageId: "page-1", x: 2, y: 0.5 },
        body: "내용",
      })
    ).rejects.toThrow("연결 위치가 올바르지 않습니다");
    await expect(
      createStudioTeamCommentThread("work-1", {
        mutationId: "mutation-long-body",
        anchor: PAGE_ANCHOR,
        body: `${" ".repeat(4_000)}x`,
      })
    ).rejects.toThrow("새 댓글 내용 또는 연결 위치가 올바르지 않습니다");
    await expect(
      addStudioTeamCommentReply("work-1", "thread-1", {
        mutationId: "mutation-long-reply",
        body: `${" ".repeat(4_000)}x`,
      })
    ).rejects.toThrow("답글 내용이 올바르지 않습니다");
    await expect(
      addStudioTeamCommentReply("work-1", "thread-1", {
        mutationId: "bad\nmutation",
        body: "답글",
      })
    ).rejects.toThrow("답글 내용이 올바르지 않습니다");
    expect(apiGet).not.toHaveBeenCalled();
    expect(apiPost).not.toHaveBeenCalled();

    const cause = new Error("database secret");
    apiGet.mockRejectedValueOnce(cause);
    await expect(listStudioTeamComments("work-1")).rejects.toThrow(
      "안전 오류: 팀 댓글을 불러오지 못했습니다."
    );
    expect(toApiError).toHaveBeenCalledWith(cause, "팀 댓글을 불러오지 못했습니다.");
  });

  it("preserves an aborted request error instead of replacing it with a UI transport error", async () => {
    const controller = new AbortController();
    const abortError = new DOMException("Aborted", "AbortError");
    apiGet.mockImplementationOnce(async () => {
      controller.abort();
      throw abortError;
    });

    await expect(
      listStudioTeamComments("work-1", {}, controller.signal)
    ).rejects.toBe(abortError);
    expect(toApiError).not.toHaveBeenCalled();
  });
});

describe("Studio team comment local v1 projection", () => {
  it("round-trips every local semantic anchor without dropping frame or normalized point data", () => {
    const anchors: StudioCommentAnchor[] = [
      { type: "page", pageId: "page-1" },
      { type: "frame", pageId: "page-1", frameId: "frame-1" },
      { type: "element", pageId: "page-1", frameId: "frame-1", elementId: "el-1" },
      { type: "point", pageId: "page-1", x: 0.25, y: 0.75 },
    ];

    for (const anchor of anchors) {
      const server = studioCommentAnchorToTeamCommentAnchor(anchor);
      expect(server).toEqual(anchor);
      expect(teamCommentAnchorToStudioCommentAnchor(server)).toEqual(anchor);
    }
    expect(studioCommentAnchorToTeamCommentAnchor({ type: "frame", pageId: "page-1" }))
      .toBeNull();
    expect(teamCommentAnchorToStudioCommentAnchor({
      type: "point",
      pageId: "page-1",
      x: 200,
      y: 300,
    })).toBeNull();
    expect(teamCommentAnchorToStudioCommentAnchor({
      type: "page",
      pageId: "p".repeat(121),
    })).toBeNull();
  });

  it("projects a complete unfiltered server history to canonical local v1", () => {
    const response = listResponse({ items: [resolvedThread()] });

    const projected = studioTeamCommentsToLocalDocument(response, {
      unfilteredSnapshotComplete: true,
    });

    expect(projected).toEqual({
      version: 1,
      threads: [
        {
          id: "thread-1",
          anchor: PAGE_ANCHOR,
          author: { id: "user-1", displayName: "하린" },
          body: "첫 댓글",
          mentions: [],
          createdAt: CREATED_AT,
          updatedAt: RESOLVED_AT,
          replies: [
            {
              id: "message-2",
              author: { id: "user-2", displayName: "민호" },
              body: "답글",
              mentions: [],
              createdAt: REPLIED_AT,
              updatedAt: REPLIED_AT,
            },
          ],
          resolved: true,
          resolvedAt: RESOLVED_AT,
          resolvedBy: { id: "user-1", displayName: "하린" },
        },
      ],
    });
  });

  it("keeps the exact local v1 fallback for pagination, truncation, or an unproven snapshot", () => {
    const local = addStudioCommentThread(
      createEmptyStudioCommentsDocument(),
      {
        id: "local-thread",
        anchor: PAGE_ANCHOR,
        author: { id: "local-user", displayName: "로컬 작가" },
        body: "오프라인 댓글",
      },
      new Date(CREATED_AT)
    );
    const paginated = listResponse({ nextCursor: "next_cursor" });
    const truncated = listResponse({
      items: [
        openThread({
          messageCount: 3,
          messages: [openThread().messages[1]],
          messagesTruncated: true,
        }),
      ],
    });

    expect(studioTeamCommentsOrLocalFallback(local, paginated, {
      unfilteredSnapshotComplete: true,
    })).toBe(local);
    expect(studioTeamCommentsOrLocalFallback(local, truncated, {
      unfilteredSnapshotComplete: true,
    })).toBe(local);
    expect(studioTeamCommentsOrLocalFallback(local, listResponse(), {
      unfilteredSnapshotComplete: false,
    })).toBe(local);
  });
});
