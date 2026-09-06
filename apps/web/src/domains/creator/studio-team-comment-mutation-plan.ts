import {
  addStudioCommentReply,
  addStudioCommentThread,
  reopenStudioCommentThread,
  reanchorStudioCommentThread,
  resolveStudioCommentThread,
  StudioCommentsDocumentSchema,
  type StudioCommentAnchor,
  type StudioCommentsDocument,
} from "./studio-comments";

export type StudioTeamCommentMutationPlan =
  | { kind: "create"; mutationId: string; anchor: StudioCommentAnchor; body: string }
  | { kind: "reply"; mutationId: string; threadId: string; body: string }
  | { kind: "resolve"; threadId: string }
  | { kind: "reopen"; threadId: string };

export interface StudioTeamCommentReanchorMutationPlan {
  kind: "reanchor";
  mutationId: string;
  threadId: string;
  anchor: StudioCommentAnchor;
  expectedActivitySequence: string;
}

function documentsEqual(
  left: StudioCommentsDocument,
  right: StudioCommentsDocument
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Converts one local panel transition into an allow-listed server command.
 *
 * Exact replay through the pure v1 operations ensures a remote panel cannot smuggle edits,
 * deletes, assignments, re-anchors, or multiple mutations through the generic document callback.
 */
export function planStudioTeamCommentMutation(
  previousValue: StudioCommentsDocument,
  nextValue: StudioCommentsDocument
): StudioTeamCommentMutationPlan | null {
  const previous = StudioCommentsDocumentSchema.safeParse(previousValue);
  const next = StudioCommentsDocumentSchema.safeParse(nextValue);
  if (!previous.success || !next.success) return null;

  if (next.data.threads.length === previous.data.threads.length + 1) {
    const previousIds = new Set(previous.data.threads.map((thread) => thread.id));
    const added = next.data.threads.filter((thread) => !previousIds.has(thread.id));
    if (added.length !== 1) return null;
    const thread = added[0];
    if (thread.mentions.length > 0) return null;
    try {
      const replayed = addStudioCommentThread(previous.data, {
        id: thread.id,
        anchor: thread.anchor,
        author: thread.author,
        body: thread.body,
        mentions: thread.mentions,
      }, new Date(thread.createdAt));
      return documentsEqual(replayed, next.data)
        ? {
            kind: "create",
            mutationId: thread.id,
            anchor: thread.anchor,
            body: thread.body,
          }
        : null;
    } catch {
      return null;
    }
  }

  if (next.data.threads.length !== previous.data.threads.length) return null;
  for (const previousThread of previous.data.threads) {
    const nextThread = next.data.threads.find((thread) => thread.id === previousThread.id);
    if (!nextThread || documentsEqual(
      { version: 1, threads: [previousThread] },
      { version: 1, threads: [nextThread] }
    )) {
      continue;
    }

    if (nextThread.replies.length === previousThread.replies.length + 1) {
      const previousReplyIds = new Set(previousThread.replies.map((reply) => reply.id));
      const addedReplies = nextThread.replies.filter((reply) => !previousReplyIds.has(reply.id));
      if (addedReplies.length !== 1) return null;
      const reply = addedReplies[0];
      if (reply.mentions.length > 0) return null;
      try {
        const replayed = addStudioCommentReply(previous.data, previousThread.id, {
          id: reply.id,
          author: reply.author,
          body: reply.body,
          mentions: reply.mentions,
        }, new Date(reply.createdAt));
        return documentsEqual(replayed, next.data)
          ? {
              kind: "reply",
              mutationId: reply.id,
              threadId: previousThread.id,
              body: reply.body,
            }
          : null;
      } catch {
        return null;
      }
    }

    if (!previousThread.resolved && nextThread.resolved && nextThread.resolvedAt) {
      try {
        const replayed = resolveStudioCommentThread(
          previous.data,
          previousThread.id,
          nextThread.resolvedBy ?? null,
          new Date(nextThread.resolvedAt)
        );
        return documentsEqual(replayed, next.data)
          ? { kind: "resolve", threadId: previousThread.id }
          : null;
      } catch {
        return null;
      }
    }

    if (previousThread.resolved && !nextThread.resolved) {
      try {
        const replayed = reopenStudioCommentThread(
          previous.data,
          previousThread.id,
          new Date(nextThread.updatedAt)
        );
        return documentsEqual(replayed, next.data)
          ? { kind: "reopen", threadId: previousThread.id }
          : null;
      } catch {
        return null;
      }
    }
    return null;
  }
  return null;
}

/**
 * Plans the one server-backed mutation that cannot be inferred from local v1 alone.
 *
 * The local document intentionally does not persist the server activity frontier or retry key, so
 * callers must supply both from their authoritative thread projection/session. Keeping this plan
 * separate avoids accidentally executing a re-anchor without compare-and-swap protection.
 */
export function planStudioTeamCommentReanchorMutation(
  previousValue: StudioCommentsDocument,
  nextValue: StudioCommentsDocument,
  command: {
    mutationId: string;
    expectedActivitySequence: string;
  }
): StudioTeamCommentReanchorMutationPlan | null {
  const previous = StudioCommentsDocumentSchema.safeParse(previousValue);
  const next = StudioCommentsDocumentSchema.safeParse(nextValue);
  if (!previous.success || !next.success) return null;
  if (previous.data.threads.length !== next.data.threads.length) return null;
  if (!/^(?:[1-9]\d{0,18})$/u.test(command.expectedActivitySequence)) return null;
  if (BigInt(command.expectedActivitySequence) > BigInt("9223372036854775807")) return null;
  const mutationId = command.mutationId.trim();
  if (
    mutationId.length < 1
    || mutationId.length > 160
    || [...mutationId].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
    })
  ) return null;

  let changedThreadId: string | null = null;
  let changedAnchor: StudioCommentAnchor | null = null;
  for (const previousThread of previous.data.threads) {
    const nextThread = next.data.threads.find((thread) => thread.id === previousThread.id);
    if (!nextThread) return null;
    if (documentsEqual(
      { version: 1, threads: [previousThread] },
      { version: 1, threads: [nextThread] }
    )) continue;
    if (changedThreadId) return null;
    try {
      const replayed = reanchorStudioCommentThread(
        previous.data,
        previousThread.id,
        nextThread.anchor,
        new Date(nextThread.updatedAt)
      );
      if (!documentsEqual(replayed, next.data)) return null;
    } catch {
      return null;
    }
    changedThreadId = previousThread.id;
    changedAnchor = nextThread.anchor;
  }
  if (!changedThreadId || !changedAnchor) return null;
  return {
    kind: "reanchor",
    mutationId,
    threadId: changedThreadId,
    anchor: changedAnchor,
    expectedActivitySequence: command.expectedActivitySequence,
  };
}
