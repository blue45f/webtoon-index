export interface StudioTeamCommentFrontierMerge {
  activitySequence: bigint;
  readSequence: bigint;
  /** The receipt predates activity already accepted from a poll or another mutation. */
  stale: boolean;
  /** Whether the merged read frontier covers every accepted activity for this thread. */
  fullyRead: boolean;
}

export type StudioTeamCommentLiveResponseDecision =
  | { status: "retry"; staleResponseRetries: number }
  | { status: "defer"; staleResponseRetries: number }
  | { status: "accept"; staleResponseRetries: 0; remainsUnread: boolean };

/**
 * Decides whether one targeted live GET can advance the local thread frontier. A socket target may
 * move while the GET is in flight, so one bounded retry is allowed without ever turning the flow
 * into polling. Read receipts win ties to prevent an older viewer-specific unread flag from
 * resurrecting a badge that the user already cleared.
 */
export function decideStudioTeamCommentLiveResponse(input: {
  remoteSequence: bigint;
  targetSequence: bigint;
  currentReadSequence: bigint;
  remoteUnread: boolean;
  staleResponseRetries: number;
  maxStaleResponseRetries?: number;
}): StudioTeamCommentLiveResponseDecision {
  const maximumRetries = Math.max(0, Math.trunc(input.maxStaleResponseRetries ?? 1));
  if (input.remoteSequence < input.targetSequence) {
    return input.staleResponseRetries < maximumRetries
      ? { status: "retry", staleResponseRetries: input.staleResponseRetries + 1 }
      : { status: "defer", staleResponseRetries: input.staleResponseRetries };
  }
  return {
    status: "accept",
    staleResponseRetries: 0,
    remainsUnread: input.remoteUnread && input.currentReadSequence < input.remoteSequence,
  };
}

function advanceSequence(
  frontier: Map<string, bigint>,
  threadId: string,
  incomingSequence: bigint
): bigint {
  const current = frontier.get(threadId);
  const next = current === undefined || incomingSequence > current
    ? incomingSequence
    : current;
  frontier.set(threadId, next);
  return next;
}

/**
 * Mutation receipts can be replayed after a lost response. Merge their clocks monotonically so
 * an old idempotency receipt never opens the door for a stale poll to replace newer UI state.
 */
export function mergeStudioTeamCommentMutationReceipt(
  activityFrontier: Map<string, bigint>,
  readFrontier: Map<string, bigint>,
  threadId: string,
  incomingSequence: bigint
): StudioTeamCommentFrontierMerge {
  const previousActivity = activityFrontier.get(threadId);
  const activitySequence = advanceSequence(
    activityFrontier,
    threadId,
    incomingSequence
  );
  const readSequence = advanceSequence(readFrontier, threadId, incomingSequence);
  return {
    activitySequence,
    readSequence,
    stale: previousActivity !== undefined && incomingSequence < previousActivity,
    fullyRead: readSequence >= activitySequence,
  };
}

/** A read response is also a server-observed activity clock and must be merged, never assigned. */
export function mergeStudioTeamCommentReadReceipt(
  activityFrontier: Map<string, bigint>,
  readFrontier: Map<string, bigint>,
  threadId: string,
  incomingSequence: bigint
): StudioTeamCommentFrontierMerge {
  const previousActivity = activityFrontier.get(threadId);
  const activitySequence = advanceSequence(
    activityFrontier,
    threadId,
    incomingSequence
  );
  const readSequence = advanceSequence(readFrontier, threadId, incomingSequence);
  return {
    activitySequence,
    readSequence,
    stale: previousActivity !== undefined && incomingSequence < previousActivity,
    fullyRead: readSequence >= activitySequence,
  };
}
