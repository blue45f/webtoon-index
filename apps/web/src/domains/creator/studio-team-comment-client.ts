import { z } from "zod";

import {
  StudioCommentActorSchema,
  StudioCommentAnchorSchema,
  StudioCommentReplySchema,
  StudioCommentThreadSchema,
  StudioCommentsDocumentSchema,
  type StudioCommentActor,
  type StudioCommentAnchor,
  type StudioCommentReply,
  type StudioCommentThread,
  type StudioCommentsDocument,
} from "./studio-comments";

import { api, toApiError } from "@/src/infrastructure/api";

const TEAM_COMMENTS_BASE = "/creator/works";
const MAX_WORK_ID_LENGTH = 160;
const MAX_OPAQUE_ID_LENGTH = 160;
const MAX_COMMENT_BODY_LENGTH = 4_000;
const MAX_CURSOR_LENGTH = 512;
const MAX_LIST_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 51;
const MAX_COMPLETE_SNAPSHOT_THREADS = 200;
const MAX_COMPLETE_SNAPSHOT_MESSAGES = 1_000;
const COMPLETE_SNAPSHOT_PAGE_SIZE = 9;
const MAX_COMPLETE_SNAPSHOT_PAGES = Math.ceil(
  MAX_COMPLETE_SNAPSHOT_THREADS / COMPLETE_SNAPSHOT_PAGE_SIZE
);

const StudioTeamCommentWorkIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_WORK_ID_LENGTH);

const StudioTeamCommentOpaqueIdSchema = z
  .string()
  .min(1)
  .max(MAX_OPAQUE_ID_LENGTH)
  .refine((value) => value.trim().length > 0)
  .refine(
    (value) =>
      ![...value].some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
      })
  );

const StudioTeamCommentMutationIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_OPAQUE_ID_LENGTH)
  .refine(
    (value) =>
      ![...value].some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
      })
  );

const StudioTeamCommentBodySchema = z
  .string()
  .max(MAX_COMMENT_BODY_LENGTH)
  .transform((value) => value.trim())
  .pipe(z.string().min(1).max(MAX_COMMENT_BODY_LENGTH));
const StudioTeamCommentSequenceSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,18})$/u)
  .refine((value) => BigInt(value) <= BigInt("9223372036854775807"));
const StudioTeamCommentExpectedActivitySequenceSchema =
  StudioTeamCommentSequenceSchema.refine((value) => BigInt(value) > BigInt(0));
const StudioTeamCommentCursorSchema = z
  .string()
  .min(1)
  .max(MAX_CURSOR_LENGTH)
  .regex(/^[A-Za-z0-9_-]+$/u);
const StudioTeamCommentDateTimeSchema = z.iso.datetime({ offset: true });

const StudioTeamCommentUserSchema = z
  .object({
    userId: StudioTeamCommentOpaqueIdSchema.nullable(),
    name: z.string().trim().min(1).max(160),
  })
  .strict();

const StudioTeamCommentMessageSchema = z
  .object({
    id: StudioTeamCommentOpaqueIdSchema,
    author: StudioTeamCommentUserSchema,
    body: z.string().min(1).max(MAX_COMMENT_BODY_LENGTH),
    createdAt: StudioTeamCommentDateTimeSchema,
  })
  .strict();

const StudioTeamCommentThreadSchema = z
  .object({
    id: StudioTeamCommentOpaqueIdSchema,
    workId: StudioTeamCommentWorkIdSchema,
    anchor: StudioCommentAnchorSchema,
    status: z.enum(["open", "resolved"]),
    createdBy: StudioTeamCommentUserSchema,
    resolvedBy: StudioTeamCommentUserSchema.nullable(),
    resolvedAt: StudioTeamCommentDateTimeSchema.nullable(),
    createdAt: StudioTeamCommentDateTimeSchema,
    updatedAt: StudioTeamCommentDateTimeSchema,
    latestActivitySequence: StudioTeamCommentSequenceSchema,
    unread: z.boolean(),
    messageCount: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    messages: z.array(StudioTeamCommentMessageSchema).max(MAX_MESSAGE_LIMIT),
    messagesTruncated: z.boolean(),
  })
  .strict()
  .superRefine((thread, context) => {
    if (thread.status === "open" && (thread.resolvedAt !== null || thread.resolvedBy !== null)) {
      context.addIssue({
        code: "custom",
        message: "open thread cannot include resolution metadata",
        path: ["status"],
      });
    }
    if (thread.status === "resolved" && (thread.resolvedAt === null || thread.resolvedBy === null)) {
      context.addIssue({
        code: "custom",
        message: "resolved thread requires resolution metadata",
        path: ["status"],
      });
    }
    if (Date.parse(thread.updatedAt) < Date.parse(thread.createdAt)) {
      context.addIssue({
        code: "custom",
        message: "updatedAt cannot precede createdAt",
        path: ["updatedAt"],
      });
    }
    if (thread.messageCount < thread.messages.length) {
      context.addIssue({
        code: "custom",
        message: "messageCount cannot be smaller than returned messages",
        path: ["messageCount"],
      });
    }
    if (thread.messagesTruncated !== (thread.messageCount > thread.messages.length)) {
      context.addIssue({
        code: "custom",
        message: "messagesTruncated must match the returned message window",
        path: ["messagesTruncated"],
      });
    }

    const messageIds = new Set<string>();
    let previousCreatedAt = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < thread.messages.length; index += 1) {
      const message = thread.messages[index];
      if (messageIds.has(message.id)) {
        context.addIssue({
          code: "custom",
          message: "duplicate message id",
          path: ["messages", index, "id"],
        });
      }
      messageIds.add(message.id);
      const createdAt = Date.parse(message.createdAt);
      if (createdAt < previousCreatedAt) {
        context.addIssue({
          code: "custom",
          message: "messages must be ordered oldest first",
          path: ["messages", index, "createdAt"],
        });
      }
      previousCreatedAt = createdAt;
    }
  });

const StudioTeamCommentCapabilitiesSchema = z
  .object({
    view: z.literal(true),
    comment: z.boolean(),
    resolve: z.boolean(),
    reanchor: z.boolean().optional(),
  })
  .strict();

const ListStudioTeamCommentsResponseSchema = z
  .object({
    workId: StudioTeamCommentWorkIdSchema,
    capabilities: StudioTeamCommentCapabilitiesSchema,
    items: z.array(StudioTeamCommentThreadSchema).max(MAX_LIST_LIMIT),
    nextCursor: StudioTeamCommentCursorSchema.nullable(),
  })
  .strict()
  .superRefine((response, context) => {
    const threadIds = new Set<string>();
    for (let index = 0; index < response.items.length; index += 1) {
      const thread = response.items[index];
      if (thread.workId !== response.workId) {
        context.addIssue({
          code: "custom",
          message: "thread belongs to another work",
          path: ["items", index, "workId"],
        });
      }
      if (threadIds.has(thread.id)) {
        context.addIssue({
          code: "custom",
          message: "duplicate thread id",
          path: ["items", index, "id"],
        });
      }
      threadIds.add(thread.id);
    }
  });

const AddStudioTeamCommentReplyResponseSchema = z
  .object({
    threadId: StudioTeamCommentOpaqueIdSchema,
    message: StudioTeamCommentMessageSchema,
    latestActivitySequence: StudioTeamCommentSequenceSchema,
  })
  .strict();

const TransitionStudioTeamCommentResponseSchema = z
  .object({
    threadId: StudioTeamCommentOpaqueIdSchema,
    status: z.enum(["open", "resolved"]),
    resolvedBy: StudioTeamCommentUserSchema.nullable(),
    resolvedAt: StudioTeamCommentDateTimeSchema.nullable(),
    updatedAt: StudioTeamCommentDateTimeSchema,
    latestActivitySequence: StudioTeamCommentSequenceSchema,
  })
  .strict()
  .superRefine((transition, context) => {
    if (
      transition.status === "open" &&
      (transition.resolvedBy !== null || transition.resolvedAt !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "open transition cannot include resolution metadata",
        path: ["status"],
      });
    }
    if (
      transition.status === "resolved" &&
      (transition.resolvedBy === null || transition.resolvedAt === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "resolved transition requires resolution metadata",
        path: ["status"],
      });
    }
  });

const ReanchorStudioTeamCommentResponseSchema = z
  .object({
    threadId: StudioTeamCommentOpaqueIdSchema,
    anchor: StudioCommentAnchorSchema,
    updatedAt: StudioTeamCommentDateTimeSchema,
    latestActivitySequence: StudioTeamCommentExpectedActivitySequenceSchema,
  })
  .strict();

const ReadStudioTeamCommentResponseSchema = z
  .object({
    threadId: StudioTeamCommentOpaqueIdSchema,
    lastReadActivitySequence: StudioTeamCommentSequenceSchema,
    readAt: StudioTeamCommentDateTimeSchema,
  })
  .strict();

const ReadAllStudioTeamCommentsResponseSchema = z
  .object({
    workId: StudioTeamCommentWorkIdSchema,
    readCount: z.number().int().min(0).max(MAX_COMPLETE_SNAPSHOT_THREADS),
    readAt: StudioTeamCommentDateTimeSchema,
  })
  .strict();

const ListStudioTeamCommentsOptionsSchema = z
  .object({
    status: z.enum(["all", "open", "resolved"]).default("all"),
    limit: z.number().int().min(1).max(MAX_LIST_LIMIT).default(20),
    messageLimit: z.number().int().min(1).max(MAX_MESSAGE_LIMIT).default(20),
    cursor: StudioTeamCommentCursorSchema.optional(),
  })
  .strict()
  .superRefine((query, context) => {
    if (query.limit * query.messageLimit > 500) {
      context.addIssue({
        code: "custom",
        message: "too many comment messages requested",
        path: ["messageLimit"],
      });
    }
  });

const GetStudioTeamCommentThreadOptionsSchema = z
  .object({
    messageLimit: z.number().int().min(1).max(MAX_MESSAGE_LIMIT).default(MAX_MESSAGE_LIMIT),
  })
  .strict();

const CreateStudioTeamCommentThreadInputSchema = z
  .object({
    mutationId: StudioTeamCommentMutationIdSchema.optional(),
    anchor: StudioCommentAnchorSchema,
    body: StudioTeamCommentBodySchema,
  })
  .strict();

const AddStudioTeamCommentReplyInputSchema = z
  .object({
    mutationId: StudioTeamCommentMutationIdSchema.optional(),
    body: StudioTeamCommentBodySchema,
  })
  .strict();

const ReanchorStudioTeamCommentThreadInputSchema = z
  .object({
    mutationId: StudioTeamCommentMutationIdSchema.optional(),
    anchor: StudioCommentAnchorSchema,
    expectedActivitySequence: StudioTeamCommentExpectedActivitySequenceSchema,
  })
  .strict();

export type StudioTeamCommentAnchor = StudioCommentAnchor;
export type StudioTeamCommentUser = z.infer<typeof StudioTeamCommentUserSchema>;
export type StudioTeamCommentMessage = z.infer<typeof StudioTeamCommentMessageSchema>;
export type StudioTeamCommentThread = z.infer<typeof StudioTeamCommentThreadSchema>;
export type StudioTeamCommentCapabilities = z.infer<
  typeof StudioTeamCommentCapabilitiesSchema
>;
export type StudioTeamCommentListResponse = z.infer<
  typeof ListStudioTeamCommentsResponseSchema
>;
export type StudioTeamCommentReplyResponse = z.infer<
  typeof AddStudioTeamCommentReplyResponseSchema
>;
export type StudioTeamCommentTransitionResponse = z.infer<
  typeof TransitionStudioTeamCommentResponseSchema
>;
export type StudioTeamCommentReanchorResponse = z.infer<
  typeof ReanchorStudioTeamCommentResponseSchema
>;
export type StudioTeamCommentReadResponse = z.infer<
  typeof ReadStudioTeamCommentResponseSchema
>;
export type StudioTeamCommentReadAllResponse = z.infer<
  typeof ReadAllStudioTeamCommentsResponseSchema
>;
export type StudioTeamCommentListOptions = z.input<
  typeof ListStudioTeamCommentsOptionsSchema
>;
export type StudioTeamCommentThreadOptions = z.input<
  typeof GetStudioTeamCommentThreadOptionsSchema
>;
export interface StudioTeamCommentCompleteSnapshot {
  workId: string;
  capabilities: StudioTeamCommentCapabilities;
  items: StudioTeamCommentThread[];
  nextCursor: null;
}
export type CreateStudioTeamCommentThreadInput = z.input<
  typeof CreateStudioTeamCommentThreadInputSchema
>;
export type AddStudioTeamCommentReplyInput = z.input<
  typeof AddStudioTeamCommentReplyInputSchema
>;
export type ReanchorStudioTeamCommentThreadInput = z.input<
  typeof ReanchorStudioTeamCommentThreadInputSchema
>;

export class StudioTeamCommentResponseContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioTeamCommentResponseContractError";
  }
}

export class StudioTeamCommentInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioTeamCommentInputError";
  }
}

export function createStudioTeamCommentMutationId(): string {
  const generated = globalThis.crypto?.randomUUID?.();
  if (!generated) {
    throw new StudioTeamCommentInputError(
      "이 브라우저에서는 안전한 댓글 요청 식별자를 만들 수 없습니다."
    );
  }
  return generated;
}

export function isStudioTeamCommentResponseContractError(
  error: unknown
): error is StudioTeamCommentResponseContractError {
  return error instanceof StudioTeamCommentResponseContractError;
}

function parseInput<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new StudioTeamCommentInputError(message);
  return parsed.data;
}

function parseResponse<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new StudioTeamCommentResponseContractError(message);
  return parsed.data;
}

function commentCollectionPath(workId: string): string {
  return `${TEAM_COMMENTS_BASE}/${encodeURIComponent(workId)}/team/comments`;
}

function commentThreadPath(workId: string, threadId: string): string {
  return `${commentCollectionPath(workId)}/${encodeURIComponent(threadId)}`;
}

function canonicalWorkId(value: string): string {
  return parseInput(
    StudioTeamCommentWorkIdSchema,
    value,
    "댓글을 연결할 작품 ID가 올바르지 않습니다."
  );
}

function canonicalThreadId(value: string): string {
  return parseInput(
    StudioTeamCommentOpaqueIdSchema,
    value,
    "댓글 스레드 ID가 올바르지 않습니다."
  );
}

async function requestStudioTeamComment<T>({
  run,
  schema,
  validateScope,
  fallback,
  contractMessage,
  signal,
}: {
  run: () => Promise<unknown>;
  schema: z.ZodType<T>;
  validateScope?: (response: T) => boolean;
  fallback: string;
  contractMessage: string;
  signal?: AbortSignal;
}): Promise<T> {
  let payload: unknown;
  try {
    payload = await run();
  } catch (error) {
    if (signal?.aborted) throw error;
    throw await toApiError(error, fallback);
  }
  const response = parseResponse(schema, payload, contractMessage);
  if (validateScope && !validateScope(response)) {
    throw new StudioTeamCommentResponseContractError(
      "다른 작품 또는 댓글 스레드의 응답을 받았습니다."
    );
  }
  return response;
}

export async function listStudioTeamComments(
  workIdValue: string,
  options: StudioTeamCommentListOptions = {},
  signal?: AbortSignal
): Promise<StudioTeamCommentListResponse> {
  const workId = canonicalWorkId(workIdValue);
  const query = parseInput(
    ListStudioTeamCommentsOptionsSchema,
    options,
    "댓글 목록 조건이 올바르지 않습니다."
  );
  const response = await requestStudioTeamComment({
    run: () =>
      api.get<unknown>(commentCollectionPath(workId), {
        params: {
          status: query.status,
          limit: query.limit,
          messageLimit: query.messageLimit,
          cursor: query.cursor,
        },
        signal,
      }),
    schema: ListStudioTeamCommentsResponseSchema,
    validateScope: (response) => response.workId === workId,
    fallback: "팀 댓글을 불러오지 못했습니다.",
    contractMessage: "팀 댓글 목록 응답 형식이 올바르지 않습니다.",
    signal,
  });
  if (
    response.items.length > query.limit
    || response.items.some((thread) => thread.messages.length > query.messageLimit)
  ) {
    throw new StudioTeamCommentResponseContractError(
      "요청한 댓글 페이지 범위를 벗어난 응답을 받았습니다."
    );
  }
  return response;
}

export async function getStudioTeamCommentThread(
  workIdValue: string,
  threadIdValue: string,
  optionsValue: StudioTeamCommentThreadOptions = {},
  signal?: AbortSignal
): Promise<StudioTeamCommentThread> {
  const workId = canonicalWorkId(workIdValue);
  const threadId = canonicalThreadId(threadIdValue);
  const options = parseInput(
    GetStudioTeamCommentThreadOptionsSchema,
    optionsValue,
    "댓글 상세 조회 조건이 올바르지 않습니다."
  );
  const response = await requestStudioTeamComment({
    run: () => api.get<unknown>(commentThreadPath(workId, threadId), {
      params: { messageLimit: options.messageLimit },
      signal,
    }),
    schema: StudioTeamCommentThreadSchema,
    validateScope: (thread) => thread.workId === workId && thread.id === threadId,
    fallback: "팀 댓글을 불러오지 못했습니다.",
    contractMessage: "팀 댓글 상세 응답 형식이 올바르지 않습니다.",
    signal,
  });
  if (response.messages.length > options.messageLimit) {
    throw new StudioTeamCommentResponseContractError(
      "요청한 댓글 메시지 범위를 벗어난 응답을 받았습니다."
    );
  }
  return response;
}

/**
 * Reads every bounded team-comment page with full per-thread history.
 *
 * The server's aggregate response guard permits 9 × 51 messages per request. Its opaque cursor is
 * based on immutable thread creation fields; after accumulation we restore latest-activity order.
 * Cursor cycles, changing capabilities, duplicate IDs, truncation, and quota overflow fail closed.
 */
export async function listAllStudioTeamComments(
  workIdValue: string,
  signal?: AbortSignal
): Promise<StudioTeamCommentCompleteSnapshot> {
  const workId = canonicalWorkId(workIdValue);
  const items: StudioTeamCommentThread[] = [];
  const threadIds = new Set<string>();
  const cursors = new Set<string>();
  let messageCount = 0;
  let cursor: string | undefined;
  let capabilities: StudioTeamCommentCapabilities | null = null;
  let complete = false;

  for (let pageIndex = 0; pageIndex < MAX_COMPLETE_SNAPSHOT_PAGES; pageIndex += 1) {
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    const page = await listStudioTeamComments(workId, {
      status: "all",
      limit: COMPLETE_SNAPSHOT_PAGE_SIZE,
      messageLimit: MAX_MESSAGE_LIMIT,
      ...(cursor ? { cursor } : {}),
    }, signal);
    if (
      capabilities
      && (capabilities.comment !== page.capabilities.comment
        || capabilities.resolve !== page.capabilities.resolve
        || (capabilities.reanchor ?? false) !== (page.capabilities.reanchor ?? false))
    ) {
      throw new StudioTeamCommentResponseContractError(
        "댓글 목록을 불러오는 동안 팀 권한이 변경되었습니다."
      );
    }
    capabilities = page.capabilities;
    for (const thread of page.items) {
      if (thread.messagesTruncated || thread.messageCount !== thread.messages.length) {
        throw new StudioTeamCommentResponseContractError(
          "전체 댓글 기록이 포함되지 않은 응답을 받았습니다."
        );
      }
      if (threadIds.has(thread.id)) {
        throw new StudioTeamCommentResponseContractError(
          "페이지 사이에 중복된 댓글 스레드를 받았습니다."
        );
      }
      threadIds.add(thread.id);
      items.push(thread);
      messageCount += thread.messageCount;
      if (items.length > MAX_COMPLETE_SNAPSHOT_THREADS) {
        throw new StudioTeamCommentResponseContractError(
          "팀 댓글 스냅샷이 지원 한도를 벗어났습니다."
        );
      }
      if (messageCount > MAX_COMPLETE_SNAPSHOT_MESSAGES) {
        throw new StudioTeamCommentResponseContractError(
          "팀 댓글 메시지 스냅샷이 지원 한도를 벗어났습니다."
        );
      }
    }
    if (page.nextCursor === null) {
      complete = true;
      break;
    }
    if (cursors.has(page.nextCursor)) {
      throw new StudioTeamCommentResponseContractError(
        "댓글 페이지 커서가 순환했습니다."
      );
    }
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }

  if (!capabilities || !complete) {
    throw new StudioTeamCommentResponseContractError(
      "팀 댓글 전체 페이지를 안전한 범위 안에서 불러오지 못했습니다."
    );
  }
  items.sort((left, right) =>
    Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    || right.id.localeCompare(left.id)
  );
  return { workId, capabilities, items, nextCursor: null };
}

export async function createStudioTeamCommentThread(
  workIdValue: string,
  inputValue: CreateStudioTeamCommentThreadInput,
  signal?: AbortSignal
): Promise<StudioTeamCommentThread> {
  const workId = canonicalWorkId(workIdValue);
  const input = parseInput(
    CreateStudioTeamCommentThreadInputSchema,
    inputValue,
    "새 댓글 내용 또는 연결 위치가 올바르지 않습니다."
  );
  const mutationId = input.mutationId ?? createStudioTeamCommentMutationId();
  const request = {
    anchor: input.anchor,
    body: input.body,
  };
  return requestStudioTeamComment({
    run: () => api.post<unknown>(commentCollectionPath(workId), request, {
      signal,
      headers: { "Idempotency-Key": mutationId },
    }),
    schema: StudioTeamCommentThreadSchema,
    validateScope: (response) => response.workId === workId,
    fallback: "팀 댓글을 등록하지 못했습니다.",
    contractMessage: "새 팀 댓글 응답 형식이 올바르지 않습니다.",
    signal,
  });
}

export async function addStudioTeamCommentReply(
  workIdValue: string,
  threadIdValue: string,
  inputValue: AddStudioTeamCommentReplyInput,
  signal?: AbortSignal
): Promise<StudioTeamCommentReplyResponse> {
  const workId = canonicalWorkId(workIdValue);
  const threadId = canonicalThreadId(threadIdValue);
  const input = parseInput(
    AddStudioTeamCommentReplyInputSchema,
    inputValue,
    "답글 내용이 올바르지 않습니다."
  );
  const mutationId = input.mutationId ?? createStudioTeamCommentMutationId();
  const request = { body: input.body };
  return requestStudioTeamComment({
    run: () =>
      api.post<unknown>(`${commentThreadPath(workId, threadId)}/replies`, request, {
        signal,
        headers: { "Idempotency-Key": mutationId },
      }),
    schema: AddStudioTeamCommentReplyResponseSchema,
    validateScope: (response) => response.threadId === threadId,
    fallback: "팀 댓글에 답글을 등록하지 못했습니다.",
    contractMessage: "팀 댓글 답글 응답 형식이 올바르지 않습니다.",
    signal,
  });
}

export async function reanchorStudioTeamCommentThread(
  workIdValue: string,
  threadIdValue: string,
  inputValue: ReanchorStudioTeamCommentThreadInput,
  signal?: AbortSignal
): Promise<StudioTeamCommentReanchorResponse> {
  const workId = canonicalWorkId(workIdValue);
  const threadId = canonicalThreadId(threadIdValue);
  const input = parseInput(
    ReanchorStudioTeamCommentThreadInputSchema,
    inputValue,
    "댓글의 새 위치 또는 변경 기준이 올바르지 않습니다."
  );
  const mutationId = input.mutationId ?? createStudioTeamCommentMutationId();
  return requestStudioTeamComment({
    run: () => api.post<unknown>(`${commentThreadPath(workId, threadId)}/reanchor`, {
      anchor: input.anchor,
      expectedActivitySequence: input.expectedActivitySequence,
    }, {
      signal,
      headers: { "Idempotency-Key": mutationId },
    }),
    schema: ReanchorStudioTeamCommentResponseSchema,
    validateScope: (response) => response.threadId === threadId,
    fallback: "팀 댓글 위치를 변경하지 못했습니다.",
    contractMessage: "팀 댓글 위치 변경 응답 형식이 올바르지 않습니다.",
    signal,
  });
}

async function transitionStudioTeamCommentThread(
  workIdValue: string,
  threadIdValue: string,
  action: "resolve" | "reopen",
  signal?: AbortSignal
): Promise<StudioTeamCommentTransitionResponse> {
  const workId = canonicalWorkId(workIdValue);
  const threadId = canonicalThreadId(threadIdValue);
  const expectedStatus = action === "resolve" ? "resolved" : "open";
  return requestStudioTeamComment({
    run: () =>
      api.post<unknown>(`${commentThreadPath(workId, threadId)}/${action}`, undefined, {
        signal,
      }),
    schema: TransitionStudioTeamCommentResponseSchema,
    validateScope: (response) =>
      response.threadId === threadId && response.status === expectedStatus,
    fallback: action === "resolve"
      ? "팀 댓글을 해결 처리하지 못했습니다."
      : "팀 댓글을 다시 열지 못했습니다.",
    contractMessage: "팀 댓글 상태 응답 형식이 올바르지 않습니다.",
    signal,
  });
}

export async function resolveStudioTeamCommentThread(
  workId: string,
  threadId: string,
  signal?: AbortSignal
): Promise<StudioTeamCommentTransitionResponse> {
  return transitionStudioTeamCommentThread(workId, threadId, "resolve", signal);
}

export async function reopenStudioTeamCommentThread(
  workId: string,
  threadId: string,
  signal?: AbortSignal
): Promise<StudioTeamCommentTransitionResponse> {
  return transitionStudioTeamCommentThread(workId, threadId, "reopen", signal);
}

export async function markStudioTeamCommentRead(
  workIdValue: string,
  threadIdValue: string,
  signal?: AbortSignal
): Promise<StudioTeamCommentReadResponse> {
  const workId = canonicalWorkId(workIdValue);
  const threadId = canonicalThreadId(threadIdValue);
  return requestStudioTeamComment({
    run: () =>
      api.post<unknown>(`${commentThreadPath(workId, threadId)}/read`, undefined, { signal }),
    schema: ReadStudioTeamCommentResponseSchema,
    validateScope: (response) => response.threadId === threadId,
    fallback: "팀 댓글 읽음 상태를 저장하지 못했습니다.",
    contractMessage: "팀 댓글 읽음 응답 형식이 올바르지 않습니다.",
    signal,
  });
}

export async function markAllStudioTeamCommentsRead(
  workIdValue: string,
  signal?: AbortSignal
): Promise<StudioTeamCommentReadAllResponse> {
  const workId = canonicalWorkId(workIdValue);
  return requestStudioTeamComment({
    run: () =>
      api.post<unknown>(`${commentCollectionPath(workId)}/read`, undefined, { signal }),
    schema: ReadAllStudioTeamCommentsResponseSchema,
    validateScope: (response) => response.workId === workId,
    fallback: "모든 팀 댓글을 읽음 처리하지 못했습니다.",
    contractMessage: "팀 댓글 전체 읽음 응답 형식이 올바르지 않습니다.",
    signal,
  });
}

/** Server and local v1 use the same semantic anchor union; no lossy coordinate guess is allowed. */
export function studioCommentAnchorToTeamCommentAnchor(
  value: unknown
): StudioTeamCommentAnchor | null {
  const parsed = StudioCommentAnchorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Server and local v1 use the same semantic anchor union; no lossy coordinate guess is allowed. */
export function teamCommentAnchorToStudioCommentAnchor(
  value: unknown
): StudioCommentAnchor | null {
  const parsed = StudioCommentAnchorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function studioTeamCommentUserToLocalActor(
  actor: StudioTeamCommentUser
): StudioCommentActor | null {
  const candidate = actor.userId
    ? { id: actor.userId, displayName: actor.name }
    : { displayName: actor.name };
  const parsed = StudioCommentActorSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export function studioTeamCommentMessageToLocalReply(
  message: StudioTeamCommentMessage
): StudioCommentReply | null {
  const author = studioTeamCommentUserToLocalActor(message.author);
  if (!author) return null;
  const timestamp = canonicalLocalTimestamp(message.createdAt);
  const parsed = StudioCommentReplySchema.safeParse({
    id: message.id,
    author,
    body: message.body,
    mentions: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return parsed.success ? parsed.data : null;
}

function canonicalLocalTimestamp(value: string): string {
  return new Date(value).toISOString();
}

/**
 * Projects a fully loaded server thread into the local persisted v1 shape.
 *
 * The local model cannot represent a truncated message history, unread frontier, activity
 * sequence, or server capabilities. Returning null instead of guessing prevents a partial remote
 * response from silently replacing durable local comments.
 */
export function studioTeamCommentThreadToLocalThread(
  thread: StudioTeamCommentThread
): StudioCommentThread | null {
  if (
    thread.messagesTruncated ||
    thread.messageCount !== thread.messages.length ||
    thread.messages.length === 0
  ) {
    return null;
  }
  const anchor = teamCommentAnchorToStudioCommentAnchor(thread.anchor);
  const firstMessage = thread.messages[0];
  const author = studioTeamCommentUserToLocalActor(firstMessage.author);
  if (!anchor || !author) return null;

  const replies: StudioCommentReply[] = [];
  for (const message of thread.messages.slice(1)) {
    const reply = studioTeamCommentMessageToLocalReply(message);
    if (!reply) return null;
    replies.push(reply);
  }

  const resolvedBy = thread.resolvedBy
    ? studioTeamCommentUserToLocalActor(thread.resolvedBy)
    : undefined;
  if (thread.status === "resolved" && !resolvedBy) return null;
  const candidate = {
    id: thread.id,
    anchor,
    author,
    body: firstMessage.body,
    mentions: [],
    createdAt: canonicalLocalTimestamp(thread.createdAt),
    updatedAt: canonicalLocalTimestamp(thread.updatedAt),
    replies,
    resolved: thread.status === "resolved",
    ...(thread.resolvedAt
      ? { resolvedAt: canonicalLocalTimestamp(thread.resolvedAt) }
      : {}),
    ...(resolvedBy ? { resolvedBy } : {}),
  };
  const parsed = StudioCommentThreadSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export interface StudioTeamCommentLocalProjectionOptions {
  /** True only after listing status=all through every cursor with untruncated message histories. */
  unfilteredSnapshotComplete: boolean;
}

/** Returns null unless replacing a local document would preserve the complete remote history. */
export function studioTeamCommentsToLocalDocument(
  response: StudioTeamCommentListResponse | StudioTeamCommentCompleteSnapshot,
  options: StudioTeamCommentLocalProjectionOptions
): StudioCommentsDocument | null {
  if (!options.unfilteredSnapshotComplete || response.nextCursor !== null) return null;
  const threads: StudioCommentThread[] = [];
  for (const remoteThread of response.items) {
    const thread = studioTeamCommentThreadToLocalThread(remoteThread);
    if (!thread) return null;
    threads.push(thread);
  }
  const parsed = StudioCommentsDocumentSchema.safeParse({ version: 1, threads });
  return parsed.success ? parsed.data : null;
}

/**
 * Keeps the existing canonical local v1 object by identity unless a complete server projection is
 * proven safe. This is the integration point for rolling deployments and offline/local projects.
 */
export function studioTeamCommentsOrLocalFallback(
  localDocument: StudioCommentsDocument,
  response: StudioTeamCommentListResponse | StudioTeamCommentCompleteSnapshot,
  options: StudioTeamCommentLocalProjectionOptions
): StudioCommentsDocument {
  if (!StudioCommentsDocumentSchema.safeParse(localDocument).success) {
    throw new StudioTeamCommentInputError("기존 로컬 댓글 문서가 올바르지 않습니다.");
  }
  return studioTeamCommentsToLocalDocument(response, options) ?? localDocument;
}
