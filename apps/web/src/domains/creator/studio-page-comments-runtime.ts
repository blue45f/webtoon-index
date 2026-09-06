import { CANVAS_W } from "./studio-assets";
import { projectStudioPointCommentToScreen } from "./studio-comment-screen-projection";
import {
  applyStudioTeamCommentReanchorReceipt,
  normalizeStudioCommentsDocument,
  studioCommentAnchorsEqual,
  type StudioCommentAnchor,
  type StudioCommentsDocument,
} from "./studio-comments";
import { loadStudioTeamCommentClient } from "./studio-page-lazy-ui";
import {
  decideStudioTeamCommentLiveResponse,
  mergeStudioTeamCommentMutationReceipt,
} from "./studio-team-comment-frontier";

import type { StudioCommentPinReanchorPayload } from "./live/StudioLiveCanvasOverlay";
import type { StudioTeamCommentCapabilities } from "./studio-team-comment-client";
import type { StudioTeamCommentLiveEvent } from "./studio-team-comment-live-event";
import type { StudioTeamCommentOperationScopeRegistry } from "./studio-team-comment-operation-scope";
import type { StudioTeamCommentRefreshSession } from "./studio-team-comment-refresh-session";
import type { StudioViewRotation } from "./studio-view-controls";
import type { Dispatch, SetStateAction } from "react";

/**
 * StudioPage 댓글 배선 추출(2026-08, B-06) — 서버 소유 팀 댓글과 로컬 문서 댓글을 합쳐 보여주는
 * 뷰 문서 클러스터, 그리고 live comment-changed 이벤트를 스레드 단위 GET 으로 수렴시키는
 * 라이브 새로고침 큐. 본문은 StudioPage 원본의 verbatim 이동이고, 상태/refs 는 페이지가
 * 소유한 채 ctx 로만 주입된다.
 */

/** 뷰 문서 투영 입력 — StudioPage 가 렌더마다 값으로 넘긴다. */
export interface StudioCommentViewDocumentInput {
  readonly studioComments: StudioCommentsDocument;
  readonly studioTeamComments: StudioCommentsDocument;
  readonly studioTeamCommentsWorkId: string | null;
}

/**
 * Server-owned review comments never enter the persisted work document. The panel/overlay gets
 * a projection that keeps pre-server document comments as explicitly read-only archive rows.
 * (StudioPage 의 studioCommentViewDocument useMemo 본문 — verbatim 이동.)
 */
export function buildStudioCommentViewDocument(
  input: StudioCommentViewDocumentInput
): StudioCommentsDocument {
  const { studioComments, studioTeamComments, studioTeamCommentsWorkId } = input;
  if (!studioTeamCommentsWorkId) return studioComments;
  const remoteThreadIds = new Set(studioTeamComments.threads.map((thread) => thread.id));
  return normalizeStudioCommentsDocument({
    version: 1,
    threads: [
      ...studioTeamComments.threads,
      ...studioComments.threads.filter((thread) => !remoteThreadIds.has(thread.id)),
    ],
  });
}

/** 아카이브 판정 입력 — 원본 memo 의 threads-단위 deps 와 같은 결이 되도록 배열만 받는다. */
export interface StudioLegacyCommentThreadIdSetInput {
  readonly studioCommentThreads: StudioCommentsDocument["threads"];
  readonly studioTeamCommentThreads: StudioCommentsDocument["threads"];
  readonly studioTeamCommentsWorkId: string | null;
}

/**
 * 서버 스냅샷에 없는(=이전 문서에 보관된) 로컬 댓글 스레드 id 집합 — read-only 아카이브 판정에
 * 쓰인다. (StudioPage 의 studioLegacyCommentThreadIdSet useMemo 본문 이동 — 문서 대신 threads
 * 배열을 받는 것만 다르고 판정은 동일하다.)
 */
export function buildStudioLegacyCommentThreadIdSet(
  input: StudioLegacyCommentThreadIdSetInput
): Set<string> {
  const { studioCommentThreads, studioTeamCommentThreads, studioTeamCommentsWorkId } = input;
  if (!studioTeamCommentsWorkId) return new Set<string>();
  const remoteThreadIds = new Set(studioTeamCommentThreads.map((thread) => thread.id));
  return new Set(
    studioCommentThreads
      .filter((thread) => !remoteThreadIds.has(thread.id))
      .map((thread) => thread.id)
  );
}

/**
 * 라이브 새로고침 큐가 읽고 쓰는 페이지 소유 상태 — 전부 참조 안정(useState setter·useRef 박스·
 * 호이스팅된 컨텍스트 함수)이라 팩토리는 렌더마다 호출해도 원본 함수 선언과 같은 계약을 가진다.
 */
export interface StudioTeamCommentLiveRefreshContext {
  readonly currentStudioTeamCommentOperationContext: () => {
    workId: string | null;
    generation: number;
    mounted: boolean;
  };
  readonly editorMountedRef: { readonly current: boolean };
  readonly setStudioCommentSyncError: Dispatch<SetStateAction<string | null>>;
  readonly setStudioTeamCommentsState: Dispatch<SetStateAction<StudioCommentsDocument>>;
  readonly setStudioTeamUnreadCommentIds: Dispatch<SetStateAction<string[]>>;
  readonly studioTeamCommentActivitySequenceRef: { readonly current: Map<string, bigint> };
  readonly studioTeamCommentLiveRefreshFlightRef: {
    readonly current: Map<string, Promise<void>>;
  };
  readonly studioTeamCommentLiveTargetSequenceRef: { readonly current: Map<string, bigint> };
  readonly studioTeamCommentOperationScopeRegistryRef: {
    readonly current: StudioTeamCommentOperationScopeRegistry;
  };
  readonly studioTeamCommentReadSequenceRef: { readonly current: Map<string, bigint> };
  readonly studioTeamCommentRefreshSessionRef: {
    readonly current: StudioTeamCommentRefreshSession | null;
  };
  readonly studioTeamCommentsLoadGenerationRef: { readonly current: number };
  readonly studioTeamCommentsScopeRef: { readonly current: string | null };
}

export interface StudioTeamCommentLiveRefreshRuntime {
  /** 수동 새로고침 — 현재 refresh 세션에 manual 요청을 위임한다. */
  readonly refreshStudioTeamComments: () => void;
  /** live comment-changed 이벤트를 스레드별 단건 GET 프론티어로 수렴시키는 큐. */
  readonly queueStudioTeamCommentLiveRefresh: (change: StudioTeamCommentLiveEvent) => void;
}

/**
 * 라이브 새로고침 큐 본문 — StudioPage 의 refreshStudioTeamComments /
 * queueStudioTeamCommentLiveRefresh 함수 선언의 verbatim 이동. 시퀀스 프론티어(activity/read),
 * 세대·스코프 가드, 재시도/defer 판정은 추출 전 계약 그대로다.
 */
export function createStudioTeamCommentLiveRefreshRuntime(
  ctx: StudioTeamCommentLiveRefreshContext
): StudioTeamCommentLiveRefreshRuntime {
  const {
    currentStudioTeamCommentOperationContext,
    editorMountedRef,
    setStudioCommentSyncError,
    setStudioTeamCommentsState,
    setStudioTeamUnreadCommentIds,
    studioTeamCommentActivitySequenceRef,
    studioTeamCommentLiveRefreshFlightRef,
    studioTeamCommentLiveTargetSequenceRef,
    studioTeamCommentOperationScopeRegistryRef,
    studioTeamCommentReadSequenceRef,
    studioTeamCommentRefreshSessionRef,
    studioTeamCommentsLoadGenerationRef,
    studioTeamCommentsScopeRef,
  } = ctx;
  function refreshStudioTeamComments(): void {
    studioTeamCommentRefreshSessionRef.current?.request("manual");
  }
  function queueStudioTeamCommentLiveRefresh(change: StudioTeamCommentLiveEvent): void {
    const workIdValue = studioTeamCommentsScopeRef.current;
    const generation = studioTeamCommentsLoadGenerationRef.current;
    if (
      !workIdValue
      || change.workId !== workIdValue
      || !editorMountedRef.current
    ) return;

    const incomingSequence = BigInt(change.activitySequence);
    const acceptedSequence = studioTeamCommentActivitySequenceRef.current.get(change.threadId);
    if (acceptedSequence !== undefined && acceptedSequence >= incomingSequence) return;

    const targets = studioTeamCommentLiveTargetSequenceRef.current;
    const previousTarget = targets.get(change.threadId);
    if (previousTarget === undefined || incomingSequence > previousTarget) {
      targets.set(change.threadId, incomingSequence);
    }
    const flights = studioTeamCommentLiveRefreshFlightRef.current;
    if (flights.has(change.threadId)) return;

    const pending = (async () => {
      let staleResponseRetries = 0;
      while (
        studioTeamCommentsScopeRef.current === workIdValue
        && studioTeamCommentsLoadGenerationRef.current === generation
        && editorMountedRef.current
      ) {
        const targetSequence = targets.get(change.threadId);
        const currentSequence = studioTeamCommentActivitySequenceRef.current.get(change.threadId);
        if (
          targetSequence === undefined
          || (currentSequence !== undefined && currentSequence >= targetSequence)
        ) {
          targets.delete(change.threadId);
          return;
        }

        const registry = studioTeamCommentOperationScopeRegistryRef.current;
        const ticket = registry.begin(workIdValue, generation);
        let admitted = false;
        try {
          const commentClient = await loadStudioTeamCommentClient();
          if (!registry.isCurrent(ticket, currentStudioTeamCommentOperationContext())) {
            registry.invalidate(ticket);
            return;
          }
          const remoteThread = await commentClient.getStudioTeamCommentThread(
            workIdValue,
            change.threadId,
            { messageLimit: 51 },
            ticket.signal
          );
          admitted = registry.isCurrent(ticket, currentStudioTeamCommentOperationContext());
          registry.finish(ticket);
          if (!admitted) return;

          const remoteSequence = BigInt(remoteThread.latestActivitySequence);
          const latestTarget = targets.get(change.threadId) ?? targetSequence;
          const currentReadSequence =
            studioTeamCommentReadSequenceRef.current.get(change.threadId) ?? BigInt(-1);
          const liveDecision = decideStudioTeamCommentLiveResponse({
            remoteSequence,
            targetSequence: latestTarget,
            currentReadSequence,
            remoteUnread: remoteThread.unread,
            staleResponseRetries,
          });
          if (liveDecision.status === "retry") {
            // A newer socket event may arrive while this GET is in flight. Retry once against
            // the newer target instead of discarding it; keep the target for a later event if a
            // lagging replica still cannot satisfy the frontier without starting a poll loop.
            staleResponseRetries = liveDecision.staleResponseRetries;
            continue;
          }
          if (liveDecision.status === "defer") {
            setStudioCommentSyncError(
              "팀 댓글 변경이 아직 동기화 중이에요. 다음 변경 알림에서 자동으로 다시 확인합니다."
            );
            return;
          }
          staleResponseRetries = liveDecision.staleResponseRetries;
          const localThread = commentClient.studioTeamCommentThreadToLocalThread(remoteThread);
          if (!localThread) {
            throw new Error("변경된 팀 댓글의 전체 기록을 안전하게 반영하지 못했어요.");
          }

          const acceptedRemoteSequence = studioTeamCommentActivitySequenceRef.current.get(
            change.threadId
          );
          if (
            acceptedRemoteSequence === undefined
            || remoteSequence >= acceptedRemoteSequence
          ) {
            studioTeamCommentActivitySequenceRef.current.set(change.threadId, remoteSequence);
            if (!remoteThread.unread) {
              if (remoteSequence > currentReadSequence) {
                studioTeamCommentReadSequenceRef.current.set(change.threadId, remoteSequence);
              }
            }
            setStudioTeamCommentsState((current) => normalizeStudioCommentsDocument({
              version: 1,
              threads: current.threads.some((thread) => thread.id === localThread.id)
                ? current.threads.map((thread) =>
                    thread.id === localThread.id ? localThread : thread
                  )
                : [localThread, ...current.threads],
            }));
            setStudioTeamUnreadCommentIds((current) => liveDecision.remainsUnread
              ? current.includes(change.threadId)
                ? current
                : [...current, change.threadId].sort()
              : current.filter((threadId) => threadId !== change.threadId));
          }
          setStudioCommentSyncError(null);
        } catch (cause) {
          const shouldReport = admitted
            || registry.isCurrent(ticket, currentStudioTeamCommentOperationContext());
          registry.invalidate(ticket);
          if (!shouldReport) return;
          const message = cause instanceof Error
            ? cause.message
            : "변경된 팀 댓글을 불러오지 못했어요.";
          setStudioCommentSyncError(message);
          targets.delete(change.threadId);
          return;
        }
      }
    })();
    flights.set(change.threadId, pending);
    void pending.finally(() => {
      if (flights.get(change.threadId) === pending) flights.delete(change.threadId);
    });
  }
  return { refreshStudioTeamComments, queueStudioTeamCommentLiveRefresh };
}

/** 위치 댓글 컴포저 핀의 화면 좌표 투영 입력 — 값은 렌더 스냅샷, refs 는 ref 그대로 흐른다. */
export interface StudioPointCommentScreenProjectionContext {
  readonly pointCommentComposerRef: {
    readonly current: { readonly anchor: Extract<StudioCommentAnchor, { type: "point" }> } | null;
  };
  readonly zoomHostRef: { readonly current: HTMLElement | null };
  readonly canvasH: number;
  readonly canvasFlipH: boolean;
  readonly canvasRotation: StudioViewRotation;
}

/**
 * 위치 댓글 컴포저 getScreenPoint 본문 — StudioPage 원본 클로저의 verbatim 이동. 렌더마다 새로
 * 만들어 useStudioStableHandlers 에 넘기면 원본과 같은 최신-클로저 계약이 된다.
 */
export function buildStudioPointCommentScreenProjection(
  ctx: StudioPointCommentScreenProjectionContext
): () => ReturnType<typeof projectStudioPointCommentToScreen> | null {
  const { pointCommentComposerRef, zoomHostRef, canvasH, canvasFlipH, canvasRotation } = ctx;
  return () => {
    const current = pointCommentComposerRef.current;
    const host = zoomHostRef.current;
    if (!current || !host?.isConnected || canvasH <= 0) return null;
    return projectStudioPointCommentToScreen({
      anchor: current.anchor,
      canvasWidth: CANVAS_W,
      canvasHeight: canvasH,
      canvasFlipH,
      canvasRotation,
      viewportRect: host.getBoundingClientRect(),
    });
  };
}

/** 핀 빠른답글 팝오버의 화면 좌표 투영 입력 — 세션 뷰의 selectedThread 만 읽는다. */
export interface StudioCommentThreadPopoverScreenProjectionContext {
  readonly studioCommentThreadSessionView: {
    readonly selectedThread: { readonly anchor: StudioCommentAnchor } | null;
  };
  readonly zoomHostRef: { readonly current: HTMLElement | null };
  readonly canvasH: number;
  readonly canvasFlipH: boolean;
  readonly canvasRotation: StudioViewRotation;
}

/** 핀 빠른답글 팝오버 getScreenPoint 본문 — StudioPage 원본 클로저의 verbatim 이동. */
export function buildStudioCommentThreadPopoverScreenProjection(
  ctx: StudioCommentThreadPopoverScreenProjectionContext
): () => ReturnType<typeof projectStudioPointCommentToScreen> | null {
  const { studioCommentThreadSessionView, zoomHostRef, canvasH, canvasFlipH, canvasRotation } = ctx;
  return () => {
    const selectedThread = studioCommentThreadSessionView.selectedThread;
    const host = zoomHostRef.current;
    if (
      !selectedThread
      || selectedThread.anchor.type !== "point"
      || !host?.isConnected
      || canvasH <= 0
    ) return null;
    return projectStudioPointCommentToScreen({
      anchor: selectedThread.anchor,
      canvasWidth: CANVAS_W,
      canvasHeight: canvasH,
      canvasFlipH,
      canvasRotation,
      viewportRect: host.getBoundingClientRect(),
    });
  };
}

/**
 * 핀 재앵커가 읽고 쓰는 페이지 소유 상태 — 화면 투영과 같은 파일에서 함께 배선되어, 옵티미스틱
 * 앵커 이동과 팝오버 투영이 항상 같은 렌더 컨텍스트/refs 를 본다(스테일 ref 분리 금지 계약).
 */
export interface StudioCommentPinReanchorContext {
  readonly announceDrawingShortcut: (message: string) => void;
  readonly collaborationDocumentLocked: boolean;
  readonly currentStudioTeamCommentOperationContext: () => {
    workId: string | null;
    generation: number;
    mounted: boolean;
  };
  readonly editorMountedRef: { readonly current: boolean };
  readonly refreshStudioTeamComments: () => void;
  readonly setStudioCommentInteractionNotice: Dispatch<SetStateAction<string | null>>;
  readonly setStudioCommentSyncError: Dispatch<SetStateAction<string | null>>;
  readonly setStudioComments: (next: SetStateAction<StudioCommentsDocument>) => boolean;
  readonly setStudioTeamCommentsState: Dispatch<SetStateAction<StudioCommentsDocument>>;
  readonly setStudioTeamUnreadCommentIds: Dispatch<SetStateAction<string[]>>;
  readonly studioAuthUserId: string | null;
  readonly studioCommentViewDocumentRef: { readonly current: StudioCommentsDocument };
  readonly studioLegacyCommentThreadIdSet: ReadonlySet<string>;
  readonly studioTeamCommentActivitySequenceRef: { readonly current: Map<string, bigint> };
  readonly studioTeamCommentCapabilities: StudioTeamCommentCapabilities | null;
  readonly studioTeamCommentOperationScopeRegistryRef: {
    readonly current: StudioTeamCommentOperationScopeRegistry;
  };
  readonly studioTeamCommentReadSequenceRef: { readonly current: Map<string, bigint> };
  readonly studioTeamCommentReanchorFlightRef: {
    readonly current: Map<string, Promise<boolean>>;
  };
  readonly studioTeamCommentReanchorQueueRef: {
    readonly current: Map<string, StudioCommentPinReanchorPayload>;
  };
  readonly studioTeamCommentsLoadGenerationRef: { readonly current: number };
  readonly studioTeamCommentsScopeRef: { readonly current: string | null };
  readonly studioTeamCommentsWorkId: string | null;
}

/**
 * 위치 댓글 핀 재앵커 본문 — StudioPage 의 reanchorStudioCommentPin 함수 선언의 verbatim 이동.
 * 옵티미스틱 적용 → 서버 확정/롤백 → 연속 이동 큐 연쇄(같은 flightKey 재귀)까지 추출 전 계약
 * 그대로이며, 로컬(공유 문서) 경로와 팀 댓글 경로의 분기도 동일하다.
 */
export function createStudioCommentPinReanchor(
  ctx: StudioCommentPinReanchorContext
): (payload: StudioCommentPinReanchorPayload) => Promise<boolean> {
  const {
    announceDrawingShortcut,
    collaborationDocumentLocked,
    currentStudioTeamCommentOperationContext,
    editorMountedRef,
    refreshStudioTeamComments,
    setStudioCommentInteractionNotice,
    setStudioCommentSyncError,
    setStudioComments,
    setStudioTeamCommentsState,
    setStudioTeamUnreadCommentIds,
    studioAuthUserId,
    studioCommentViewDocumentRef,
    studioLegacyCommentThreadIdSet,
    studioTeamCommentActivitySequenceRef,
    studioTeamCommentCapabilities,
    studioTeamCommentOperationScopeRegistryRef,
    studioTeamCommentReadSequenceRef,
    studioTeamCommentReanchorFlightRef,
    studioTeamCommentReanchorQueueRef,
    studioTeamCommentsLoadGenerationRef,
    studioTeamCommentsScopeRef,
    studioTeamCommentsWorkId,
  } = ctx;
  async function reanchorStudioCommentPin(
    payload: StudioCommentPinReanchorPayload
  ): Promise<boolean> {
    const currentThread = studioCommentViewDocumentRef.current.threads.find(
      (thread) => thread.id === payload.threadId
    );
    if (!currentThread || currentThread.anchor.type !== "point") {
      setStudioCommentInteractionNotice("이동할 위치 댓글을 현재 문서에서 찾을 수 없어요.");
      return false;
    }
    if (payload.anchor.pageId !== currentThread.anchor.pageId) {
      setStudioCommentInteractionNotice("댓글 핀은 현재 페이지 안에서만 이동할 수 있어요.");
      return false;
    }

    if (!studioTeamCommentsWorkId) {
      if (collaborationDocumentLocked) {
        setStudioCommentInteractionNotice("읽기 전용 원고에서는 댓글 위치를 변경할 수 없어요.");
        return false;
      }
      if (!setStudioComments((current) => applyStudioTeamCommentReanchorReceipt(current, {
        threadId: payload.threadId,
        anchor: payload.anchor,
        updatedAt: new Date().toISOString(),
      }))) return false;
      setStudioCommentInteractionNotice(null);
      announceDrawingShortcut("댓글 위치를 옮겼습니다");
      return true;
    }

    if (studioLegacyCommentThreadIdSet.has(payload.threadId)) {
      setStudioCommentInteractionNotice("이전 문서에 보관된 댓글 위치는 변경할 수 없어요.");
      return false;
    }
    const ownsThread = Boolean(
      studioAuthUserId && currentThread.author.id === studioAuthUserId
    );
    if (studioTeamCommentCapabilities?.reanchor !== true && !ownsThread) {
      setStudioCommentInteractionNotice(
        "자신이 작성한 댓글만 옮길 수 있어요. 소유자·관리자·편집자는 모든 핀을 옮길 수 있습니다."
      );
      return false;
    }
    const workIdValue = studioTeamCommentsWorkId;
    const generation = studioTeamCommentsLoadGenerationRef.current;
    const expectedSequence = studioTeamCommentActivitySequenceRef.current.get(payload.threadId);
    if (!expectedSequence || expectedSequence <= BigInt(0)) {
      setStudioCommentInteractionNotice("댓글 최신 상태를 확인한 뒤 위치를 다시 옮겨 주세요.");
      refreshStudioTeamComments();
      return false;
    }
    const flightKey = `${workIdValue}:reanchor:${payload.threadId}`;
    const existingFlight = studioTeamCommentReanchorFlightRef.current.get(flightKey);
    if (existingFlight) {
      studioTeamCommentReanchorQueueRef.current.set(flightKey, payload);
      setStudioTeamCommentsState((current) => applyStudioTeamCommentReanchorReceipt(current, {
        threadId: payload.threadId,
        anchor: payload.anchor,
        updatedAt: new Date().toISOString(),
      }));
      setStudioCommentInteractionNotice("연속 위치 변경을 이어서 저장하고 있어요…");
      return existingFlight;
    }

    const previousAnchor = currentThread.anchor;
    const previousUpdatedAt = currentThread.updatedAt;
    setStudioTeamCommentsState((current) => applyStudioTeamCommentReanchorReceipt(current, {
      threadId: payload.threadId,
      anchor: payload.anchor,
      updatedAt: new Date().toISOString(),
    }));
    setStudioCommentInteractionNotice("댓글 위치를 저장하고 있어요…");

    const pending = (async (): Promise<boolean> => {
      const registry = studioTeamCommentOperationScopeRegistryRef.current;
      const ticket = registry.begin(workIdValue, generation);
      let admitted = false;
      try {
        const commentClient = await loadStudioTeamCommentClient();
        if (!registry.isCurrent(ticket, currentStudioTeamCommentOperationContext())) {
          registry.invalidate(ticket);
          return false;
        }
        const response = await commentClient.reanchorStudioTeamCommentThread(
          workIdValue,
          payload.threadId,
          {
            mutationId: commentClient.createStudioTeamCommentMutationId(),
            anchor: payload.anchor,
            expectedActivitySequence: expectedSequence.toString(),
          },
          ticket.signal
        );
        admitted = registry.isCurrent(ticket, currentStudioTeamCommentOperationContext());
        registry.finish(ticket);
        if (!admitted) return false;
        const receipt = mergeStudioTeamCommentMutationReceipt(
          studioTeamCommentActivitySequenceRef.current,
          studioTeamCommentReadSequenceRef.current,
          payload.threadId,
          BigInt(response.latestActivitySequence)
        );
        if (!receipt.stale) {
          setStudioTeamCommentsState((current) => {
            const queued = studioTeamCommentReanchorQueueRef.current.get(flightKey);
            const optimistic = current.threads.find((thread) => thread.id === payload.threadId);
            // Do not let the first receipt visually rewind a newer keyboard/drag destination that
            // is already queued behind it. The queued request will reconcile its own server time.
            if (
              queued
              && optimistic
              && studioCommentAnchorsEqual(optimistic.anchor, queued.anchor)
            ) return current;
            return applyStudioTeamCommentReanchorReceipt(current, {
              threadId: response.threadId,
              anchor: response.anchor,
              updatedAt: response.updatedAt,
            });
          });
          setStudioTeamUnreadCommentIds((current) => current.filter(
            (threadId) => threadId !== payload.threadId
          ));
        }
        setStudioCommentInteractionNotice(null);
        setStudioCommentSyncError(null);
        announceDrawingShortcut(
          payload.source === "keyboard"
            ? "댓글 위치를 미세 조정했습니다"
            : "댓글 위치를 옮겼습니다"
        );
        return true;
      } catch (cause) {
        const shouldReport = admitted
          || registry.isCurrent(ticket, currentStudioTeamCommentOperationContext());
        registry.invalidate(ticket);
        if (!shouldReport) return false;
        // Roll back only if no newer mutation or live event has replaced this optimistic anchor.
        if (
          studioTeamCommentActivitySequenceRef.current.get(payload.threadId) === expectedSequence
        ) {
          setStudioTeamCommentsState((current) => {
            const queued = studioTeamCommentReanchorQueueRef.current.get(flightKey);
            const optimistic = current.threads.find((thread) => thread.id === payload.threadId);
            const ownsOptimisticAnchor = optimistic && (
              studioCommentAnchorsEqual(optimistic.anchor, payload.anchor)
              || Boolean(queued && studioCommentAnchorsEqual(optimistic.anchor, queued.anchor))
            );
            return ownsOptimisticAnchor
              ? applyStudioTeamCommentReanchorReceipt(current, {
                  threadId: payload.threadId,
                  anchor: previousAnchor,
                  updatedAt: previousUpdatedAt,
                })
              : current;
          });
        }
        const message = cause instanceof Error
          ? cause.message
          : "댓글 위치를 저장하지 못했어요.";
        setStudioCommentInteractionNotice(message);
        setStudioCommentSyncError(message);
        throw new Error(message, { cause });
      }
    })();
    studioTeamCommentReanchorFlightRef.current.set(flightKey, pending);
    let completedSuccessfully = false;
    try {
      completedSuccessfully = await pending;
      return completedSuccessfully;
    } finally {
      if (studioTeamCommentReanchorFlightRef.current.get(flightKey) === pending) {
        studioTeamCommentReanchorFlightRef.current.delete(flightKey);
      }
      const queued = studioTeamCommentReanchorQueueRef.current.get(flightKey);
      studioTeamCommentReanchorQueueRef.current.delete(flightKey);
      if (
        completedSuccessfully
        && queued
        && studioTeamCommentsScopeRef.current === workIdValue
        && studioTeamCommentsLoadGenerationRef.current === generation
        && editorMountedRef.current
      ) {
        void reanchorStudioCommentPin(queued).catch(() => {
          // The queued call reports its own interaction and sync error state.
        });
      }
    }
  }
  return reanchorStudioCommentPin;
}
