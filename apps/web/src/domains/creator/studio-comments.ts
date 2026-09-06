import { z } from "zod";

/**
 * Local-first editorial comment threads for Studio documents.
 *
 * This module deliberately models persisted document state only. It does not imply realtime
 * collaboration, remote delivery, account lookup, or server-side authorization.
 */

export const STUDIO_COMMENTS_VERSION = 1 as const;
export const STUDIO_COMMENTS_MAX_THREADS = 200;
export const STUDIO_COMMENTS_MAX_REPLIES_PER_THREAD = 50;
export const STUDIO_COMMENTS_MAX_TOTAL_MESSAGES = 1_000;
export const STUDIO_COMMENTS_MAX_ID_LENGTH = 120;
// Team-comment API user names are bounded to the same 160-character contract.
export const STUDIO_COMMENTS_MAX_DISPLAY_NAME_LENGTH = 160;
export const STUDIO_COMMENTS_MAX_BODY_LENGTH = 4_000;
export const STUDIO_COMMENTS_MAX_MENTIONS = 20;

/**
 * Creates one retry-safe local message identifier that is also accepted as a team-comment
 * mutation id. Callers should keep the returned value for the whole submit/retry lifecycle.
 */
export function createStudioCommentMessageId(prefix: "comment" | "reply"): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

/** Prevents a late mutation receipt from closing a newer comment draft. */
export function studioCommentMutationReceiptOwnsDraft(
  currentMessageId: string | null | undefined,
  receiptMessageId: string
): boolean {
  return currentMessageId === receiptMessageId;
}

const IdSchema = z.string().trim().min(1).max(STUDIO_COMMENTS_MAX_ID_LENGTH);
const DisplayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(STUDIO_COMMENTS_MAX_DISPLAY_NAME_LENGTH);
const BodySchema = z.string().trim().min(1).max(STUDIO_COMMENTS_MAX_BODY_LENGTH);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCanonicalTimestamp(value: string): boolean {
  if (value.length > 40 || !Number.isFinite(Date.parse(value))) return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

const TimestampSchema = z.string().refine(isCanonicalTimestamp, "UTC ISO timestamp required");

export const StudioCommentActorSchema = z
  .object({
    id: IdSchema.optional(),
    displayName: DisplayNameSchema,
  })
  .strict();

export type StudioCommentActor = z.infer<typeof StudioCommentActorSchema>;

const PageCommentAnchorSchema = z
  .object({
    type: z.literal("page"),
    pageId: IdSchema,
  })
  .strict();

const FrameCommentAnchorSchema = z
  .object({
    type: z.literal("frame"),
    pageId: IdSchema,
    frameId: IdSchema,
  })
  .strict();

const ElementCommentAnchorSchema = z
  .object({
    type: z.literal("element"),
    pageId: IdSchema,
    frameId: IdSchema.optional(),
    elementId: IdSchema,
  })
  .strict();

/** Figma식 자유 위치 핀 — 캔버스 논리 좌표를 0..1 로 정규화해 문서 크기와 무관하게 재투영한다. */
const PointCommentAnchorSchema = z
  .object({
    type: z.literal("point"),
    pageId: IdSchema,
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
  })
  .strict();

export const StudioCommentAnchorSchema = z.discriminatedUnion("type", [
  PageCommentAnchorSchema,
  FrameCommentAnchorSchema,
  ElementCommentAnchorSchema,
  PointCommentAnchorSchema,
]);

export type StudioCommentAnchor = z.infer<typeof StudioCommentAnchorSchema>;

const STUDIO_COMMENT_POINT_KEY_DECIMALS = 4;

/**
 * Returns the one canonical identity used everywhere an anchor is grouped or compared.
 *
 * Point coordinates intentionally use the same four-decimal bucket as canvas pins. At the
 * largest practical Webtoon canvas this absorbs sub-pixel serialization noise without mutating
 * the persisted v1 coordinate. JSON tuples keep arbitrary user-generated IDs collision-safe,
 * and an element's optional frame remains part of its identity.
 */
export function canonicalStudioCommentAnchorKey(value: StudioCommentAnchor): string {
  const anchor = StudioCommentAnchorSchema.parse(value);
  if (anchor.type === "page") return JSON.stringify(["page", anchor.pageId]);
  if (anchor.type === "frame") {
    return JSON.stringify(["frame", anchor.pageId, anchor.frameId]);
  }
  if (anchor.type === "element") {
    // Studio element IDs are page-global. A legacy frameId is descriptive metadata, not a
    // second identity axis; treating it as identity would render duplicate pins for one element.
    return JSON.stringify(["element", anchor.pageId, anchor.elementId]);
  }
  return JSON.stringify([
    "point",
    anchor.pageId,
    anchor.x.toFixed(STUDIO_COMMENT_POINT_KEY_DECIMALS),
    anchor.y.toFixed(STUDIO_COMMENT_POINT_KEY_DECIMALS),
  ]);
}

const CommentMessageShape = {
  id: IdSchema,
  author: StudioCommentActorSchema,
  body: BodySchema,
  mentions: z.array(StudioCommentActorSchema).max(STUDIO_COMMENTS_MAX_MENTIONS),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
} as const;

function actorKey(actor: StudioCommentActor): string {
  return actor.id
    ? `id:${actor.id}`
    : `name:${actor.displayName.normalize("NFKC").toLocaleLowerCase()}`;
}

function validateMessageFields(
  message: {
    mentions: StudioCommentActor[];
    createdAt: string;
    updatedAt: string;
  },
  context: z.RefinementCtx
): void {
  if (Date.parse(message.updatedAt) < Date.parse(message.createdAt)) {
    context.addIssue({
      code: "custom",
      message: "updatedAt must not precede createdAt",
      path: ["updatedAt"],
    });
  }

  const mentionKeys = new Set<string>();
  for (let index = 0; index < message.mentions.length; index += 1) {
    const key = actorKey(message.mentions[index]);
    if (mentionKeys.has(key)) {
      context.addIssue({
        code: "custom",
        message: "duplicate mention",
        path: ["mentions", index],
      });
      continue;
    }
    mentionKeys.add(key);
  }
}

export const StudioCommentReplySchema = z
  .object(CommentMessageShape)
  .strict()
  .superRefine(validateMessageFields);

export type StudioCommentReply = z.infer<typeof StudioCommentReplySchema>;

export const StudioCommentThreadSchema = z
  .object({
    ...CommentMessageShape,
    anchor: StudioCommentAnchorSchema,
    replies: z.array(StudioCommentReplySchema).max(STUDIO_COMMENTS_MAX_REPLIES_PER_THREAD),
    resolved: z.boolean(),
    resolvedAt: TimestampSchema.optional(),
    resolvedBy: StudioCommentActorSchema.optional(),
    assignee: StudioCommentActorSchema.optional(),
  })
  .strict()
  .superRefine((thread, context) => {
    validateMessageFields(thread, context);
    if (thread.resolved && !thread.resolvedAt) {
      context.addIssue({
        code: "custom",
        message: "resolved threads require resolvedAt",
        path: ["resolvedAt"],
      });
    }
    if (!thread.resolved && (thread.resolvedAt || thread.resolvedBy)) {
      context.addIssue({
        code: "custom",
        message: "open threads cannot keep resolution metadata",
        path: ["resolved"],
      });
    }
    const latestActivity = Math.max(
      Date.parse(thread.createdAt),
      ...thread.replies.map((reply) => Date.parse(reply.updatedAt)),
      ...(thread.resolvedAt ? [Date.parse(thread.resolvedAt)] : [])
    );
    if (Date.parse(thread.updatedAt) < latestActivity) {
      context.addIssue({
        code: "custom",
        message: "thread updatedAt must include reply and resolution activity",
        path: ["updatedAt"],
      });
    }
  });

export type StudioCommentThread = z.infer<typeof StudioCommentThreadSchema>;

export const StudioCommentsDocumentSchema = z
  .object({
    version: z.literal(STUDIO_COMMENTS_VERSION),
    threads: z.array(StudioCommentThreadSchema).max(STUDIO_COMMENTS_MAX_THREADS),
  })
  .strict()
  .superRefine((document, context) => {
    const messageIds = new Set<string>();
    let messageCount = 0;
    for (let threadIndex = 0; threadIndex < document.threads.length; threadIndex += 1) {
      const thread = document.threads[threadIndex];
      const messages: ReadonlyArray<{ id: string }> = [thread, ...thread.replies];
      for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
        const message = messages[messageIndex];
        messageCount += 1;
        if (messageIds.has(message.id)) {
          context.addIssue({
            code: "custom",
            message: "comment and reply IDs must be globally unique",
            path: ["threads", threadIndex, ...(messageIndex ? ["replies", messageIndex - 1] : []), "id"],
          });
        }
        messageIds.add(message.id);
      }
    }
    if (messageCount > STUDIO_COMMENTS_MAX_TOTAL_MESSAGES) {
      context.addIssue({
        code: "too_big",
        origin: "array",
        maximum: STUDIO_COMMENTS_MAX_TOTAL_MESSAGES,
        inclusive: true,
        message: `A Studio comment document supports at most ${STUDIO_COMMENTS_MAX_TOTAL_MESSAGES} messages`,
        path: ["threads"],
      });
    }
  });

export type StudioCommentsDocument = z.infer<typeof StudioCommentsDocumentSchema>;

export interface StudioCommentThreadInput {
  id: string;
  anchor: StudioCommentAnchor;
  author: StudioCommentActor;
  body: string;
  mentions?: readonly StudioCommentActor[];
}

export interface StudioCommentReplyInput {
  id: string;
  author: StudioCommentActor;
  body: string;
  mentions?: readonly StudioCommentActor[];
}

export interface StudioCommentMessagePatch {
  body?: string;
  mentions?: readonly StudioCommentActor[];
}

const MESSAGE_PATCH_KEYS = new Set(["body", "mentions"]);

function normalizeText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return id && id.length <= STUDIO_COMMENTS_MAX_ID_LENGTH ? id : null;
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 80 || !Number.isFinite(Date.parse(value))) {
    return null;
  }
  try {
    return new Date(value).toISOString();
  } catch {
    return null;
  }
}

function firstValue(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function normalizeActor(value: unknown, stripMentionPrefix = false): StudioCommentActor | null {
  if (typeof value === "string") {
    const candidate = stripMentionPrefix ? value.trim().replace(/^@/u, "") : value;
    const displayName = normalizeText(candidate, STUDIO_COMMENTS_MAX_DISPLAY_NAME_LENGTH);
    return displayName ? { displayName } : null;
  }
  if (!isRecord(value)) return null;

  const rawDisplayName = firstValue(value, ["displayName", "name", "label", "username"]);
  const displayName = normalizeText(rawDisplayName, STUDIO_COMMENTS_MAX_DISPLAY_NAME_LENGTH);
  if (!displayName) return null;
  const id = normalizeId(firstValue(value, ["id", "userId", "authorId"]));
  return id ? { id, displayName } : { displayName };
}

function actorFromRecord(record: Record<string, unknown>): StudioCommentActor | null {
  const explicit = firstValue(record, ["author", "creator", "user"]);
  if (explicit !== undefined) return normalizeActor(explicit);
  return normalizeActor({
    id: firstValue(record, ["authorId", "userId"]),
    displayName: firstValue(record, ["authorDisplayName", "authorName", "displayName"]),
  });
}

function normalizeMentions(value: unknown): StudioCommentActor[] {
  if (!Array.isArray(value)) return [];
  const mentions: StudioCommentActor[] = [];
  const keys = new Set<string>();
  for (const candidate of value) {
    const actor = normalizeActor(candidate, true);
    if (!actor) continue;
    const key = actorKey(actor);
    if (keys.has(key)) continue;
    keys.add(key);
    mentions.push(actor);
    if (mentions.length >= STUDIO_COMMENTS_MAX_MENTIONS) break;
  }
  return mentions;
}

function normalizeAnchor(value: unknown): StudioCommentAnchor | null {
  if (!isRecord(value)) return null;
  const nestedAnchor = firstValue(value, ["anchor", "target"]);
  const source = isRecord(nestedAnchor) ? nestedAnchor : value;
  const pageId = normalizeId(firstValue(source, ["pageId", "page"]));
  if (!pageId) return null;
  const frameId = normalizeId(firstValue(source, ["frameId", "panelId", "frame"]));
  const elementId = normalizeId(
    firstValue(source, ["elementId", "layerId", "nodeId", "objectId", "element"])
  );
  const rawType = firstValue(source, ["type", "kind", "anchorType", "targetType"]);
  const type = typeof rawType === "string" ? rawType.trim().toLowerCase() : "";

  if (["point", "position", "pin"].includes(type)) {
    const x = firstValue(source, ["x", "nx"]);
    const y = firstValue(source, ["y", "ny"]);
    if (
      typeof x !== "number" || !Number.isFinite(x) || x < 0 || x > 1 ||
      typeof y !== "number" || !Number.isFinite(y) || y < 0 || y > 1
    ) {
      return null;
    }
    return { type: "point", pageId, x, y };
  }
  if (["element", "layer", "node", "object"].includes(type) || (!type && elementId)) {
    if (!elementId) return null;
    return frameId
      ? { type: "element", pageId, frameId, elementId }
      : { type: "element", pageId, elementId };
  }
  if (["frame", "panel"].includes(type) || (!type && frameId)) {
    return frameId ? { type: "frame", pageId, frameId } : null;
  }
  if (type && type !== "page") return null;
  return { type: "page", pageId };
}

function normalizeReply(value: unknown): StudioCommentReply | null {
  if (!isRecord(value)) return null;
  const id = normalizeId(firstValue(value, ["id", "replyId", "commentId"]));
  const author = actorFromRecord(value);
  const body = normalizeText(
    firstValue(value, ["body", "text", "content"]),
    STUDIO_COMMENTS_MAX_BODY_LENGTH
  );
  const createdAt = normalizeTimestamp(firstValue(value, ["createdAt", "created_at", "timestamp"]));
  if (!id || !author || !body || !createdAt) return null;
  const candidateUpdatedAt =
    normalizeTimestamp(firstValue(value, ["updatedAt", "updated_at", "editedAt"])) ?? createdAt;
  const updatedAt = Date.parse(candidateUpdatedAt) < Date.parse(createdAt)
    ? createdAt
    : candidateUpdatedAt;

  return StudioCommentReplySchema.parse({
    id,
    author,
    body,
    mentions: normalizeMentions(value.mentions),
    createdAt,
    updatedAt,
  });
}

function normalizeThread(
  value: unknown,
  unavailableIds: ReadonlySet<string>,
  replyLimit: number
): StudioCommentThread | null {
  if (!isRecord(value)) return null;
  const nestedComment = isRecord(value.comment) ? value.comment : value;
  const id = normalizeId(
    firstValue(value, ["id", "threadId"]) ?? firstValue(nestedComment, ["id", "commentId"])
  );
  const anchor = normalizeAnchor(firstValue(value, ["anchor", "target"]) ?? value);
  const author = actorFromRecord(nestedComment) ?? actorFromRecord(value);
  const body = normalizeText(
    firstValue(nestedComment, ["body", "text", "content"]),
    STUDIO_COMMENTS_MAX_BODY_LENGTH
  );
  const createdAt = normalizeTimestamp(
    firstValue(nestedComment, ["createdAt", "created_at", "timestamp"])
      ?? firstValue(value, ["createdAt", "created_at"])
  );
  if (!id || unavailableIds.has(id) || !anchor || !author || !body || !createdAt) return null;

  const localIds = new Set<string>([id]);
  const rawReplies = firstValue(value, ["replies", "responses"])
    ?? firstValue(nestedComment, ["replies", "responses"]);
  const replies: StudioCommentReply[] = [];
  if (Array.isArray(rawReplies)) {
    for (const candidate of rawReplies) {
      if (replies.length >= replyLimit) break;
      const reply = normalizeReply(candidate);
      if (!reply || unavailableIds.has(reply.id) || localIds.has(reply.id)) continue;
      localIds.add(reply.id);
      replies.push(reply);
    }
  }

  const rawUpdatedAt =
    normalizeTimestamp(
      firstValue(value, ["updatedAt", "updated_at", "editedAt"])
        ?? firstValue(nestedComment, ["updatedAt", "updated_at", "editedAt"])
    ) ?? createdAt;
  const rawResolvedAt = normalizeTimestamp(firstValue(value, ["resolvedAt", "resolved_at"]));
  const status = firstValue(value, ["status"]);
  const resolved = value.resolved === true || status === "resolved" || Boolean(rawResolvedAt);
  const resolvedAt = resolved ? rawResolvedAt ?? rawUpdatedAt : undefined;
  const resolvedBy = resolved
    ? normalizeActor(firstValue(value, ["resolvedBy", "resolver"])) ?? undefined
    : undefined;
  const assignee = normalizeActor(firstValue(value, ["assignee", "assignedTo"])) ?? undefined;
  const latestActivity = Math.max(
    Date.parse(createdAt),
    Date.parse(rawUpdatedAt),
    ...replies.map((reply) => Date.parse(reply.updatedAt)),
    ...(resolvedAt ? [Date.parse(resolvedAt)] : [])
  );
  const updatedAt = new Date(latestActivity).toISOString();
  const mentions = normalizeMentions(
    firstValue(nestedComment, ["mentions"]) ?? firstValue(value, ["mentions"])
  );

  return StudioCommentThreadSchema.parse({
    id,
    anchor,
    author,
    body,
    mentions,
    createdAt,
    updatedAt,
    replies,
    resolved,
    ...(resolvedAt ? { resolvedAt } : {}),
    ...(resolvedBy ? { resolvedBy } : {}),
    ...(assignee ? { assignee } : {}),
  });
}

function extractThreadCandidates(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  if (Array.isArray(value.threads)) return value.threads;
  if (Array.isArray(value.comments)) return value.comments;
  if (Array.isArray(value.items)) return value.items;
  return [];
}

export function createEmptyStudioCommentsDocument(): StudioCommentsDocument {
  return { version: STUDIO_COMMENTS_VERSION, threads: [] };
}

/**
 * Converts v1 and conservative unversioned legacy shapes to the canonical document.
 *
 * Invalid records, duplicate message IDs, and records beyond the safety limits are dropped in
 * stable input order. Explicit future versions are not interpreted as v1.
 */
export function normalizeStudioCommentsDocument(value: unknown): StudioCommentsDocument {
  let decoded = value;
  if (typeof value === "string") {
    try {
      decoded = JSON.parse(value) as unknown;
    } catch {
      return createEmptyStudioCommentsDocument();
    }
  }
  if (isRecord(decoded) && Object.hasOwn(decoded, "version")) {
    const declaredVersion = decoded.version;
    // v0 was an experimental local container. Any other explicit version is unknown and must not
    // be guessed into the v1 shape, even when it happens to contain a `threads` array.
    if (declaredVersion !== 0 && declaredVersion !== STUDIO_COMMENTS_VERSION) {
      return createEmptyStudioCommentsDocument();
    }
  }

  const candidates = extractThreadCandidates(decoded);
  const messageIds = new Set<string>();
  const threads: StudioCommentThread[] = [];
  let messageCount = 0;
  for (const candidate of candidates) {
    if (
      threads.length >= STUDIO_COMMENTS_MAX_THREADS
      || messageCount >= STUDIO_COMMENTS_MAX_TOTAL_MESSAGES
    ) {
      break;
    }
    const replyLimit = Math.min(
      STUDIO_COMMENTS_MAX_REPLIES_PER_THREAD,
      STUDIO_COMMENTS_MAX_TOTAL_MESSAGES - messageCount - 1
    );
    const thread = normalizeThread(candidate, messageIds, replyLimit);
    if (!thread) continue;
    threads.push(thread);
    messageIds.add(thread.id);
    for (const reply of thread.replies) messageIds.add(reply.id);
    messageCount += 1 + thread.replies.length;
  }
  return StudioCommentsDocumentSchema.parse({ version: STUDIO_COMMENTS_VERSION, threads });
}

export function serializeStudioCommentsDocument(value: unknown): string {
  return JSON.stringify(normalizeStudioCommentsDocument(value));
}

function canonicalNow(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new Error("댓글 작업 시간이 올바르지 않아요.");
  return now.toISOString();
}

function assertCanonicalDocument(document: StudioCommentsDocument): void {
  if (!StudioCommentsDocumentSchema.safeParse(document).success) {
    throw new Error("댓글 문서가 손상되었습니다. 먼저 댓글 데이터를 정규화해 주세요.");
  }
}

function messageIdExists(document: StudioCommentsDocument, id: string): boolean {
  return document.threads.some(
    (thread) => thread.id === id || thread.replies.some((reply) => reply.id === id)
  );
}

function canonicalActor(value: StudioCommentActor, label: string): StudioCommentActor {
  const parsed = StudioCommentActorSchema.safeParse(value);
  if (!parsed.success) throw new Error(`${label} 정보가 올바르지 않아요.`);
  return parsed.data;
}

function canonicalMentions(value: unknown): StudioCommentActor[] {
  if (!value) return [];
  if (!Array.isArray(value)) throw new Error("멘션 목록이 올바르지 않아요.");
  return normalizeMentions(value);
}

function canonicalBody(value: unknown): string {
  const body = normalizeText(value, STUDIO_COMMENTS_MAX_BODY_LENGTH);
  if (!body) throw new Error("댓글 내용을 입력해 주세요.");
  return body;
}

function canonicalInputId(value: unknown): string {
  const id = normalizeId(value);
  if (!id) throw new Error("댓글 ID는 클라이언트에서 발급한 유효한 문자열이어야 해요.");
  return id;
}

function canonicalInputAnchor(value: StudioCommentAnchor): StudioCommentAnchor {
  const parsed = StudioCommentAnchorSchema.safeParse(value);
  if (!parsed.success) throw new Error("댓글 연결 위치가 올바르지 않아요.");
  return parsed.data;
}

function actorsEqual(left: StudioCommentActor | undefined, right: StudioCommentActor | undefined): boolean {
  return left?.id === right?.id && left?.displayName === right?.displayName;
}

function mentionsEqual(
  left: readonly StudioCommentActor[],
  right: readonly StudioCommentActor[]
): boolean {
  return left.length === right.length && left.every((actor, index) => actorsEqual(actor, right[index]));
}

export function studioCommentAnchorsEqual(
  left: StudioCommentAnchor,
  right: StudioCommentAnchor
): boolean {
  try {
    return canonicalStudioCommentAnchorKey(left) === canonicalStudioCommentAnchorKey(right);
  } catch {
    return false;
  }
}

export function addStudioCommentThread(
  document: StudioCommentsDocument,
  input: StudioCommentThreadInput,
  now = new Date()
): StudioCommentsDocument {
  assertCanonicalDocument(document);
  if (document.threads.length >= STUDIO_COMMENTS_MAX_THREADS) {
    throw new Error(`댓글 스레드는 최대 ${STUDIO_COMMENTS_MAX_THREADS}개까지 저장할 수 있어요.`);
  }
  const messageCount = document.threads.reduce(
    (count, thread) => count + 1 + thread.replies.length,
    0
  );
  if (messageCount >= STUDIO_COMMENTS_MAX_TOTAL_MESSAGES) {
    throw new Error(`댓글과 답글은 합쳐서 최대 ${STUDIO_COMMENTS_MAX_TOTAL_MESSAGES}개까지 저장할 수 있어요.`);
  }
  const id = canonicalInputId(input.id);
  if (messageIdExists(document, id)) throw new Error("이미 사용 중인 댓글 또는 답글 ID예요.");
  const timestamp = canonicalNow(now);
  const thread = StudioCommentThreadSchema.parse({
    id,
    anchor: canonicalInputAnchor(input.anchor),
    author: canonicalActor(input.author, "작성자"),
    body: canonicalBody(input.body),
    mentions: canonicalMentions(input.mentions),
    createdAt: timestamp,
    updatedAt: timestamp,
    replies: [],
    resolved: false,
  });
  return { ...document, threads: [...document.threads, thread] };
}

export function addStudioCommentReply(
  document: StudioCommentsDocument,
  threadId: string,
  input: StudioCommentReplyInput,
  now = new Date()
): StudioCommentsDocument {
  assertCanonicalDocument(document);
  const index = document.threads.findIndex((thread) => thread.id === threadId);
  if (index < 0) return document;
  const thread = document.threads[index];
  if (thread.replies.length >= STUDIO_COMMENTS_MAX_REPLIES_PER_THREAD) {
    throw new Error(`답글은 스레드당 최대 ${STUDIO_COMMENTS_MAX_REPLIES_PER_THREAD}개까지 저장할 수 있어요.`);
  }
  const messageCount = document.threads.reduce(
    (count, candidate) => count + 1 + candidate.replies.length,
    0
  );
  if (messageCount >= STUDIO_COMMENTS_MAX_TOTAL_MESSAGES) {
    throw new Error(`댓글과 답글은 합쳐서 최대 ${STUDIO_COMMENTS_MAX_TOTAL_MESSAGES}개까지 저장할 수 있어요.`);
  }
  const id = canonicalInputId(input.id);
  if (messageIdExists(document, id)) throw new Error("이미 사용 중인 댓글 또는 답글 ID예요.");
  const timestamp = canonicalNow(now);
  const reply = StudioCommentReplySchema.parse({
    id,
    author: canonicalActor(input.author, "작성자"),
    body: canonicalBody(input.body),
    mentions: canonicalMentions(input.mentions),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const nextThread = StudioCommentThreadSchema.parse({
    ...thread,
    replies: [...thread.replies, reply],
    updatedAt: timestamp,
  });
  const threads = document.threads.slice();
  threads[index] = nextThread;
  return { ...document, threads };
}

function normalizeMessagePatch(patch: StudioCommentMessagePatch): StudioCommentMessagePatch {
  if (!isRecord(patch)) throw new Error("댓글 수정 내용이 올바르지 않아요.");
  for (const key of Object.keys(patch)) {
    if (!MESSAGE_PATCH_KEYS.has(key)) throw new Error(`수정할 수 없는 댓글 필드예요: ${key}`);
  }
  return {
    ...(Object.hasOwn(patch, "body") ? { body: canonicalBody(patch.body) } : {}),
    ...(Object.hasOwn(patch, "mentions")
      ? { mentions: canonicalMentions(patch.mentions) }
      : {}),
  };
}

export function editStudioCommentThread(
  document: StudioCommentsDocument,
  threadId: string,
  patch: StudioCommentMessagePatch,
  now = new Date()
): StudioCommentsDocument {
  assertCanonicalDocument(document);
  const index = document.threads.findIndex((thread) => thread.id === threadId);
  if (index < 0) return document;
  const normalizedPatch = normalizeMessagePatch(patch);
  const current = document.threads[index];
  const body = normalizedPatch.body ?? current.body;
  const mentions = normalizedPatch.mentions ?? current.mentions;
  if (body === current.body && mentionsEqual(mentions, current.mentions)) return document;
  const threads = document.threads.slice();
  threads[index] = StudioCommentThreadSchema.parse({
    ...current,
    body,
    mentions,
    updatedAt: canonicalNow(now),
  });
  return { ...document, threads };
}

export function editStudioCommentReply(
  document: StudioCommentsDocument,
  threadId: string,
  replyId: string,
  patch: StudioCommentMessagePatch,
  now = new Date()
): StudioCommentsDocument {
  assertCanonicalDocument(document);
  const threadIndex = document.threads.findIndex((thread) => thread.id === threadId);
  if (threadIndex < 0) return document;
  const thread = document.threads[threadIndex];
  const replyIndex = thread.replies.findIndex((reply) => reply.id === replyId);
  if (replyIndex < 0) return document;
  const normalizedPatch = normalizeMessagePatch(patch);
  const current = thread.replies[replyIndex];
  const body = normalizedPatch.body ?? current.body;
  const mentions = normalizedPatch.mentions ?? current.mentions;
  if (body === current.body && mentionsEqual(mentions, current.mentions)) return document;
  const timestamp = canonicalNow(now);
  const replies = thread.replies.slice();
  replies[replyIndex] = StudioCommentReplySchema.parse({
    ...current,
    body,
    mentions,
    updatedAt: timestamp,
  });
  const threads = document.threads.slice();
  threads[threadIndex] = StudioCommentThreadSchema.parse({ ...thread, replies, updatedAt: timestamp });
  return { ...document, threads };
}

export function removeStudioCommentThread(
  document: StudioCommentsDocument,
  threadId: string
): StudioCommentsDocument {
  assertCanonicalDocument(document);
  const threads = document.threads.filter((thread) => thread.id !== threadId);
  return threads.length === document.threads.length ? document : { ...document, threads };
}

export function removeStudioCommentReply(
  document: StudioCommentsDocument,
  threadId: string,
  replyId: string,
  now = new Date()
): StudioCommentsDocument {
  assertCanonicalDocument(document);
  const threadIndex = document.threads.findIndex((thread) => thread.id === threadId);
  if (threadIndex < 0) return document;
  const thread = document.threads[threadIndex];
  const replies = thread.replies.filter((reply) => reply.id !== replyId);
  if (replies.length === thread.replies.length) return document;
  const threads = document.threads.slice();
  threads[threadIndex] = StudioCommentThreadSchema.parse({
    ...thread,
    replies,
    updatedAt: canonicalNow(now),
  });
  return { ...document, threads };
}

export function resolveStudioCommentThread(
  document: StudioCommentsDocument,
  threadId: string,
  resolvedBy: StudioCommentActor | null = null,
  now = new Date()
): StudioCommentsDocument {
  assertCanonicalDocument(document);
  const threadIndex = document.threads.findIndex((thread) => thread.id === threadId);
  if (threadIndex < 0 || document.threads[threadIndex].resolved) return document;
  const timestamp = canonicalNow(now);
  const resolver = resolvedBy ? canonicalActor(resolvedBy, "해결한 사람") : undefined;
  const threads = document.threads.slice();
  threads[threadIndex] = StudioCommentThreadSchema.parse({
    ...threads[threadIndex],
    resolved: true,
    resolvedAt: timestamp,
    ...(resolver ? { resolvedBy: resolver } : {}),
    updatedAt: timestamp,
  });
  return { ...document, threads };
}

export function reopenStudioCommentThread(
  document: StudioCommentsDocument,
  threadId: string,
  now = new Date()
): StudioCommentsDocument {
  assertCanonicalDocument(document);
  const threadIndex = document.threads.findIndex((thread) => thread.id === threadId);
  if (threadIndex < 0 || !document.threads[threadIndex].resolved) return document;
  const { resolvedAt: _resolvedAt, resolvedBy: _resolvedBy, ...thread } = document.threads[threadIndex];
  const threads = document.threads.slice();
  threads[threadIndex] = StudioCommentThreadSchema.parse({
    ...thread,
    resolved: false,
    updatedAt: canonicalNow(now),
  });
  return { ...document, threads };
}

export function assignStudioCommentThread(
  document: StudioCommentsDocument,
  threadId: string,
  assignee: StudioCommentActor | null,
  now = new Date()
): StudioCommentsDocument {
  assertCanonicalDocument(document);
  const threadIndex = document.threads.findIndex((thread) => thread.id === threadId);
  if (threadIndex < 0) return document;
  const current = document.threads[threadIndex];
  const nextAssignee = assignee ? canonicalActor(assignee, "담당자") : undefined;
  if (actorsEqual(current.assignee, nextAssignee)) return document;
  const { assignee: _assignee, ...thread } = current;
  const threads = document.threads.slice();
  threads[threadIndex] = StudioCommentThreadSchema.parse({
    ...thread,
    ...(nextAssignee ? { assignee: nextAssignee } : {}),
    updatedAt: canonicalNow(now),
  });
  return { ...document, threads };
}

export function reanchorStudioCommentThread(
  document: StudioCommentsDocument,
  threadId: string,
  anchor: StudioCommentAnchor,
  now = new Date()
): StudioCommentsDocument {
  assertCanonicalDocument(document);
  const threadIndex = document.threads.findIndex((thread) => thread.id === threadId);
  if (threadIndex < 0) return document;
  const nextAnchor = canonicalInputAnchor(anchor);
  const current = document.threads[threadIndex];
  if (studioCommentAnchorsEqual(current.anchor, nextAnchor)) return document;
  const threads = document.threads.slice();
  threads[threadIndex] = StudioCommentThreadSchema.parse({
    ...current,
    anchor: nextAnchor,
    updatedAt: canonicalNow(now),
  });
  return { ...document, threads };
}

export function listStudioCommentThreadsForAnchor(
  document: StudioCommentsDocument,
  anchor: StudioCommentAnchor,
  options: { includeResolved?: boolean } = {}
): StudioCommentThread[] {
  const canonicalAnchor = canonicalInputAnchor(anchor);
  const includeResolved = options.includeResolved ?? true;
  return document.threads.filter(
    (thread) =>
      (includeResolved || !thread.resolved)
      && studioCommentAnchorsEqual(thread.anchor, canonicalAnchor)
  );
}

export interface StudioTeamCommentMutablePartition {
  mutableDocument: StudioCommentsDocument;
  readOnlyThreads: StudioCommentThread[];
  mutableMessageCount: number;
  readOnlyMessageCount: number;
}

/** Applies an accepted server re-anchor receipt without replacing replies or resolution state. */
export function applyStudioTeamCommentReanchorReceipt(
  document: StudioCommentsDocument,
  input: {
    threadId: string;
    anchor: StudioCommentAnchor;
    updatedAt: string;
  }
): StudioCommentsDocument {
  const updatedAt = new Date(input.updatedAt);
  if (!Number.isFinite(updatedAt.getTime()) || updatedAt.toISOString() !== input.updatedAt) {
    return document;
  }
  return reanchorStudioCommentThread(document, input.threadId, input.anchor, updatedAt);
}

function countStudioCommentMessages(threads: readonly StudioCommentThread[]): number {
  return threads.reduce((count, thread) => count + 1 + thread.replies.length, 0);
}

/** Keeps pre-server archive rows visible without charging them against the live team quota. */
export function partitionStudioTeamCommentMutableDocument(
  document: StudioCommentsDocument,
  readOnlyThreadIds: ReadonlySet<string>
): StudioTeamCommentMutablePartition {
  const mutableThreads = document.threads.filter((thread) => !readOnlyThreadIds.has(thread.id));
  const readOnlyThreads = document.threads.filter((thread) => readOnlyThreadIds.has(thread.id));
  return {
    mutableDocument: { version: document.version, threads: mutableThreads },
    readOnlyThreads,
    mutableMessageCount: countStudioCommentMessages(mutableThreads),
    readOnlyMessageCount: countStudioCommentMessages(readOnlyThreads),
  };
}

/**
 * Live server rows are ordered before archive rows so the bounded local projection can trim old
 * archive entries without ever hiding the mutation the server just accepted.
 */
export function mergeStudioTeamCommentMutableDocument(
  nextMutableDocument: StudioCommentsDocument,
  readOnlyThreads: readonly StudioCommentThread[]
): StudioCommentsDocument {
  return normalizeStudioCommentsDocument({
    version: nextMutableDocument.version,
    threads: [...nextMutableDocument.threads, ...readOnlyThreads],
  });
}
