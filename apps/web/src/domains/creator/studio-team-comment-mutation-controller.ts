import {
  addStudioCommentReply,
  normalizeStudioCommentsDocument,
  reopenStudioCommentThread,
  resolveStudioCommentThread,
  type StudioCommentsDocument,
} from "./studio-comments";

import type { StudioTeamCommentCapabilities } from "./studio-team-comment-client";
import type { StudioTeamCommentMutationPlan } from "./studio-team-comment-mutation-plan";
import type {
  StudioTeamCommentOperationContext,
  StudioTeamCommentOperationScopeRegistry,
} from "./studio-team-comment-operation-scope";

type StudioTeamCommentClientModule = typeof import("./studio-team-comment-client");
type StudioStateUpdate<T> = T | ((current: T) => T);

export interface StudioTeamCommentMutationFlight {
  readonly signature: string;
  readonly promise: Promise<boolean>;
}

export interface StudioTeamCommentMutationControllerInput {
  readonly plan: StudioTeamCommentMutationPlan;
  readonly expectedScope?: {
    readonly workId: string;
    readonly generation: number;
  };
  readonly readScope: () => StudioTeamCommentOperationContext;
  readonly readCapabilities: () => StudioTeamCommentCapabilities | null;
  readonly readDocument: () => StudioCommentsDocument;
  readonly legacyThreadIds: ReadonlySet<string>;
  readonly flights: Map<string, StudioTeamCommentMutationFlight>;
  readonly operationRegistry: StudioTeamCommentOperationScopeRegistry;
  readonly activitySequence: Map<string, bigint>;
  readonly readSequence: Map<string, bigint>;
  readonly mergeMutationReceipt: (
    activitySequence: Map<string, bigint>,
    readSequence: Map<string, bigint>,
    threadId: string,
    incomingSequence: bigint
  ) => { readonly stale: boolean };
  readonly loadClient: () => Promise<StudioTeamCommentClientModule>;
  readonly updateDocument: (update: StudioStateUpdate<StudioCommentsDocument>) => void;
  readonly updateUnreadThreadIds: (update: StudioStateUpdate<string[]>) => void;
  readonly setSyncError: (message: string | null) => void;
}

function mutationFlightKey(
  workId: string,
  plan: StudioTeamCommentMutationPlan,
): string {
  return plan.kind === "create"
    ? `${workId}:create:${plan.mutationId}`
    : `${workId}:thread:${plan.threadId}`;
}

/**
 * Executes one server-owned comment mutation behind a work-generation and operation-ticket fence.
 *
 * The caller retains React state and refs; this boundary owns command validation, request
 * de-duplication, remote-to-local projection, frontier advancement, and stale-response rejection.
 */
export async function executeStudioTeamCommentMutation({
  plan,
  expectedScope,
  readScope,
  readCapabilities,
  readDocument,
  legacyThreadIds,
  flights,
  operationRegistry,
  activitySequence,
  readSequence,
  mergeMutationReceipt,
  loadClient,
  updateDocument,
  updateUnreadThreadIds,
  setSyncError,
}: StudioTeamCommentMutationControllerInput): Promise<boolean> {
  const initialScope = readScope();
  const workId = expectedScope?.workId ?? initialScope.workId;
  const generation = expectedScope?.generation ?? initialScope.generation;
  if (
    !workId
    || initialScope.workId !== workId
    || initialScope.generation !== generation
    || !initialScope.mounted
  ) {
    return false;
  }

  const capabilities = readCapabilities();
  if ((plan.kind === "create" || plan.kind === "reply") && capabilities?.comment !== true) {
    throw new Error("현재 팀 역할로는 댓글을 작성할 수 없어요.");
  }
  if ((plan.kind === "resolve" || plan.kind === "reopen") && capabilities?.resolve !== true) {
    throw new Error("해결 상태는 소유자·관리자·편집자만 변경할 수 있어요.");
  }
  if (plan.kind !== "create") {
    const currentThread = readDocument().threads.find((thread) => thread.id === plan.threadId);
    if (!currentThread) throw new Error("댓글을 현재 문서에서 찾을 수 없어요.");
    if (legacyThreadIds.has(plan.threadId)) {
      throw new Error("이전 문서에 보관된 댓글은 전체 검토함에서 읽기 전용으로 확인할 수 있어요.");
    }
    if (plan.kind === "reply" && currentThread.resolved) {
      throw new Error("이미 해결된 댓글에는 답글을 남길 수 없어요. 먼저 다시 열어 주세요.");
    }
    if (plan.kind === "resolve" && currentThread.resolved) return true;
    if (plan.kind === "reopen" && !currentThread.resolved) return true;
  }

  const flightKey = mutationFlightKey(workId, plan);
  const signature = JSON.stringify(plan);
  const existingFlight = flights.get(flightKey);
  if (existingFlight) {
    if (existingFlight.signature === signature) return existingFlight.promise;
    throw new Error("이 댓글의 다른 변경을 저장하고 있어요. 완료된 뒤 다시 시도해 주세요.");
  }

  const pending = (async (): Promise<boolean> => {
    const ticket = operationRegistry.begin(workId, generation);
    let admitted = false;
    try {
      const commentClient = await loadClient();
      if (!operationRegistry.isCurrent(ticket, readScope())) {
        operationRegistry.invalidate(ticket);
        return false;
      }

      if (plan.kind === "create") {
        const remoteThread = await commentClient.createStudioTeamCommentThread(
          workId,
          {
            mutationId: plan.mutationId,
            anchor: plan.anchor,
            body: plan.body,
          },
          ticket.signal,
        );
        admitted = operationRegistry.isCurrent(ticket, readScope());
        operationRegistry.finish(ticket);
        if (!admitted) return false;
        const receipt = mergeMutationReceipt(
          activitySequence,
          readSequence,
          remoteThread.id,
          BigInt(remoteThread.latestActivitySequence),
        );
        if (!receipt.stale) {
          const localThread = commentClient.studioTeamCommentThreadToLocalThread(remoteThread);
          if (!localThread) {
            throw new Error("등록된 팀 댓글을 화면에 안전하게 반영하지 못했어요.");
          }
          updateDocument((current) => normalizeStudioCommentsDocument({
            version: 1,
            threads: current.threads.some((thread) =>
              thread.id === localThread.id
              || thread.replies.some((reply) => reply.id === localThread.id)
            )
              ? current.threads
              : [localThread, ...current.threads],
          }));
          updateUnreadThreadIds((current) => remoteThread.unread
            ? current.includes(localThread.id)
              ? current
              : [...current, localThread.id].sort()
            : current.filter((threadId) => threadId !== localThread.id));
        }
        setSyncError(null);
        return true;
      }

      if (plan.kind === "reply") {
        const response = await commentClient.addStudioTeamCommentReply(
          workId,
          plan.threadId,
          { mutationId: plan.mutationId, body: plan.body },
          ticket.signal,
        );
        admitted = operationRegistry.isCurrent(ticket, readScope());
        operationRegistry.finish(ticket);
        if (!admitted) return false;
        const receipt = mergeMutationReceipt(
          activitySequence,
          readSequence,
          plan.threadId,
          BigInt(response.latestActivitySequence),
        );
        if (!receipt.stale) {
          const reply = commentClient.studioTeamCommentMessageToLocalReply(response.message);
          if (!reply) throw new Error("등록된 팀 답글을 화면에 안전하게 반영하지 못했어요.");
          updateDocument((current) => {
            const alreadyProjected = current.threads.some((thread) =>
              thread.id === reply.id
              || thread.replies.some((candidate) => candidate.id === reply.id)
            );
            return alreadyProjected
              ? current
              : addStudioCommentReply(current, plan.threadId, {
                  id: reply.id,
                  author: reply.author,
                  body: reply.body,
                  mentions: reply.mentions,
                }, new Date(reply.createdAt));
          });
          updateUnreadThreadIds((current) =>
            current.filter((threadId) => threadId !== plan.threadId)
          );
        }
        setSyncError(null);
        return true;
      }

      if (plan.kind === "resolve") {
        const response = await commentClient.resolveStudioTeamCommentThread(
          workId,
          plan.threadId,
          ticket.signal,
        );
        admitted = operationRegistry.isCurrent(ticket, readScope());
        operationRegistry.finish(ticket);
        if (!admitted) return false;
        const receipt = mergeMutationReceipt(
          activitySequence,
          readSequence,
          plan.threadId,
          BigInt(response.latestActivitySequence),
        );
        if (!receipt.stale) {
          const resolver = response.resolvedBy
            ? commentClient.studioTeamCommentUserToLocalActor(response.resolvedBy)
            : null;
          const resolvedAt = response.resolvedAt;
          if (!resolver || !resolvedAt) {
            throw new Error("팀 댓글 해결 정보를 화면에 안전하게 반영하지 못했어요.");
          }
          updateDocument((current) => resolveStudioCommentThread(
            current,
            plan.threadId,
            resolver,
            new Date(resolvedAt),
          ));
          updateUnreadThreadIds((current) =>
            current.filter((threadId) => threadId !== plan.threadId)
          );
        }
        setSyncError(null);
        return true;
      }

      const response = await commentClient.reopenStudioTeamCommentThread(
        workId,
        plan.threadId,
        ticket.signal,
      );
      admitted = operationRegistry.isCurrent(ticket, readScope());
      operationRegistry.finish(ticket);
      if (!admitted) return false;
        const receipt = mergeMutationReceipt(
        activitySequence,
        readSequence,
        plan.threadId,
        BigInt(response.latestActivitySequence),
      );
      if (!receipt.stale) {
        updateDocument((current) => reopenStudioCommentThread(
          current,
          plan.threadId,
          new Date(response.updatedAt),
        ));
        updateUnreadThreadIds((current) =>
          current.filter((threadId) => threadId !== plan.threadId)
        );
      }
      setSyncError(null);
      return true;
    } catch (cause) {
      const shouldReport = admitted || operationRegistry.isCurrent(ticket, readScope());
      operationRegistry.invalidate(ticket);
      if (!shouldReport) return false;
      const message = cause instanceof Error
        ? cause.message
        : "팀 댓글 변경을 저장하지 못했어요.";
      setSyncError(message);
      throw new Error(message, { cause });
    }
  })();

  flights.set(flightKey, { signature, promise: pending });
  try {
    return await pending;
  } finally {
    const current = flights.get(flightKey);
    if (current?.promise === pending) flights.delete(flightKey);
  }
}
