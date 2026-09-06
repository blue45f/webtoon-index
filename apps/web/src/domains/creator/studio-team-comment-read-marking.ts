// 팀 댓글 읽음 처리 — StudioPage 에서 추출. 단건/전체 읽음 처리가 공유하던
// 스코프 티켓·in-flight 중복 제거·오류 보고 스캐폴드를 하나의 코어로 합쳤다.
// studio-team-comment-mutation-controller 와 같은 deps 주입 스타일을 따른다.
import { loadStudioTeamCommentClient } from "./studio-page-lazy-ui";
import { mergeStudioTeamCommentReadReceipt } from "./studio-team-comment-frontier";

import type { StudioTeamCommentOperationScopeRegistry } from "./studio-team-comment-operation-scope";

type StudioTeamCommentClient = Awaited<ReturnType<typeof loadStudioTeamCommentClient>>;
type StudioTeamCommentOperationContext =
  Parameters<StudioTeamCommentOperationScopeRegistry["isCurrent"]>[1];

export interface StudioTeamCommentReadMarkingDeps {
  scopeRef: { readonly current: string | null };
  generationRef: { readonly current: number };
  unreadThreadIdsRef: { readonly current: readonly string[] };
  /** flightKey → in-flight promise. 같은 대상에 대한 중복 요청을 하나로 합친다. */
  readFlights: Map<string, Promise<boolean>>;
  operationRegistry: StudioTeamCommentOperationScopeRegistry;
  activitySequence: Map<string, bigint>;
  readSequence: Map<string, bigint>;
  currentOperationContext: () => StudioTeamCommentOperationContext;
  setUnreadThreadIds: (update: (current: string[]) => string[]) => void;
  setSyncError: (message: string | null) => void;
}

async function runStudioTeamCommentReadFlight(
  deps: StudioTeamCommentReadMarkingDeps,
  flightKey: string,
  workIdValue: string,
  fallbackErrorMessage: string,
  perform: (
    client: StudioTeamCommentClient,
    signal: AbortSignal
  ) => Promise<() => void>
): Promise<boolean> {
  const existingFlight = deps.readFlights.get(flightKey);
  if (existingFlight) return existingFlight;
  const generation = deps.generationRef.current;

  const pending = (async (): Promise<boolean> => {
    const registry = deps.operationRegistry;
    const ticket = registry.begin(workIdValue, generation);
    let admitted = false;
    try {
      const commentClient = await loadStudioTeamCommentClient();
      if (!registry.isCurrent(ticket, deps.currentOperationContext())) {
        registry.invalidate(ticket);
        return false;
      }
      const applyReadReceipt = await perform(commentClient, ticket.signal);
      admitted = registry.isCurrent(ticket, deps.currentOperationContext());
      registry.finish(ticket);
      if (!admitted) return false;
      applyReadReceipt();
      deps.setSyncError(null);
      return true;
    } catch (cause) {
      const shouldReport = admitted
        || registry.isCurrent(ticket, deps.currentOperationContext());
      registry.invalidate(ticket);
      if (!shouldReport) return false;
      const message = cause instanceof Error ? cause.message : fallbackErrorMessage;
      deps.setSyncError(message);
      throw new Error(message, { cause });
    }
  })();
  deps.readFlights.set(flightKey, pending);
  try {
    return await pending;
  } finally {
    if (deps.readFlights.get(flightKey) === pending) {
      deps.readFlights.delete(flightKey);
    }
  }
}

export async function markStudioTeamCommentThreadRead(
  deps: StudioTeamCommentReadMarkingDeps,
  threadId: string
): Promise<boolean> {
  const workIdValue = deps.scopeRef.current;
  if (!workIdValue || !deps.unreadThreadIdsRef.current.includes(threadId)) return true;
  return runStudioTeamCommentReadFlight(
    deps,
    `${workIdValue}:thread:${threadId}`,
    workIdValue,
    "댓글을 읽음 처리하지 못했어요.",
    async (commentClient, signal) => {
      const response = await commentClient.markStudioTeamCommentRead(
        workIdValue,
        threadId,
        signal
      );
      return () => {
        const receipt = mergeStudioTeamCommentReadReceipt(
          deps.activitySequence,
          deps.readSequence,
          threadId,
          BigInt(response.lastReadActivitySequence)
        );
        if (receipt.fullyRead) {
          deps.setUnreadThreadIds((current) => current.filter(
            (candidate) => candidate !== threadId
          ));
        }
      };
    }
  );
}

export async function markAllStudioTeamCommentThreadsRead(
  deps: StudioTeamCommentReadMarkingDeps
): Promise<boolean> {
  const workIdValue = deps.scopeRef.current;
  if (!workIdValue || deps.unreadThreadIdsRef.current.length === 0) return true;
  return runStudioTeamCommentReadFlight(
    deps,
    `${workIdValue}:all`,
    workIdValue,
    "모든 팀 댓글을 읽음 처리하지 못했어요.",
    async (commentClient, signal) => {
      // The bulk endpoint does not return per-thread clocks. Capture only the activity already
      // visible at request time so concurrent new replies remain unread after this receipt.
      const requestActivityFrontier = new Map(deps.activitySequence);
      await commentClient.markAllStudioTeamCommentsRead(workIdValue, signal);
      return () => {
        for (const [threadId, sequence] of requestActivityFrontier) {
          mergeStudioTeamCommentReadReceipt(
            deps.activitySequence,
            deps.readSequence,
            threadId,
            sequence
          );
        }
        deps.setUnreadThreadIds((current) => current.filter((threadId) => {
          const requestedSequence = requestActivityFrontier.get(threadId);
          const currentSequence = deps.activitySequence.get(threadId);
          return requestedSequence === undefined
            || currentSequence === undefined
            || currentSequence > requestedSequence;
        }));
      };
    }
  );
}
