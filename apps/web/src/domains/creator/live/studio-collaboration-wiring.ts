import {
  useCallback,
  useLayoutEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import {
  replaceStudioWorkAssetSourceAcrossHistory,
  type StudioWorkAssetAdmissionCoordinator,
} from "../studio-work-asset-admission";
import { useStudioAutosaveDocumentRuntime } from "../useStudioAutosaveDocumentRuntime";

import { releaseStudioLiveMutationLocks } from "./studio-live-mutation-lock-coordinator";

import type { PageState } from "../studio-page-state";
import type { StudioSharedDocument } from "../studio-shared-document-client";
import type { StudioTeamCommentLiveEvent } from "../studio-team-comment-live-event";
import type { StudioCrdtDocument } from "./studio-crdt-document";
import type { StudioLiveRoom } from "./studio-live-collaboration-room";
import type { StudioLiveGesturePreviewRoomAdapter } from "./studio-live-gesture-preview-room-adapter";
import type {
  StudioCrdtAuthoritativeSaveBarrier,
  StudioCrdtSceneGraphRuntime,
} from "./StudioLiveCollaborationProvider";

/**
 * StrictMode replay가 같은 상태 객체를 공유하도록 세대 카운터는 제자리에서 증가한다. 이 변이는
 * react-compiler가 컴파일하는 훅 본문 밖(모듈 헬퍼)에서 수행해야 한다 — 훅 인자에서 파생된
 * 별칭의 직접 변이는 컴파일러가 거부한다.
 */
function advanceStudioLiveGesturePreviewLifecycle(
  lifecycle: { generation: number }
): number {
  return ++lifecycle.generation;
}

/**
 * 승인된 소스 전환 결과를 스냅샷 히스토리 authority ref에 반영한다 — state updater 밖의 ref 선행
 * 기록이라는 원본 계약 그대로이며, 훅 인자 ref 변이라 컴파일 경계 밖에서 수행한다.
 */
function commitStudioWorkAssetAdmittedHistory(
  pagesHistoryRef: MutableRefObject<PageState[][]>,
  history: PageState[][]
): void {
  pagesHistoryRef.current = history;
}

/** 저장 배리어 명령 ref 교체 — 훅 인자 ref 변이라 컴파일 경계 밖에서 수행한다. */
function publishStudioCrdtAuthoritativeSaveBarrier(
  studioCrdtAuthoritativeSaveBarrierRef: MutableRefObject<StudioCrdtAuthoritativeSaveBarrier | null>,
  barrier: StudioCrdtAuthoritativeSaveBarrier | null
): void {
  studioCrdtAuthoritativeSaveBarrierRef.current = barrier;
}

/** CRDT 문서·scene runtime ref 를 같은 room 세대의 한 쌍으로만 공개한다 — 훅 인자 ref 변이. */
function pairStudioCrdtDocumentRuntime(
  studioCrdtDocumentRef: MutableRefObject<StudioCrdtDocument | null>,
  studioCrdtSceneRuntimeRef: MutableRefObject<StudioCrdtSceneGraphRuntime | null>,
  readyDocument: StudioCrdtDocument | null,
  runtime: StudioCrdtSceneGraphRuntime | null
): void {
  studioCrdtDocumentRef.current = readyDocument;
  studioCrdtSceneRuntimeRef.current = readyDocument ? runtime : null;
}

/** 라이브 comment-room 구독 해제와 핸들러 리셋 — 훅 인자 ref 변이라 컴파일 경계 밖에서 수행한다. */
function resetStudioLiveCommentRoomWiring(
  studioLiveCommentRoomUnsubscribeRef: MutableRefObject<(() => void) | null>,
  studioLiveCommentEventHandlerRef: MutableRefObject<(
    change: StudioTeamCommentLiveEvent
  ) => void>
): void {
  studioLiveCommentRoomUnsubscribeRef.current?.();
  studioLiveCommentRoomUnsubscribeRef.current = null;
  studioLiveCommentEventHandlerRef.current = () => undefined;
}

/**
 * Live room 회전 본문 — StudioPage 추출 전 계약 그대로: begin 을 소유한 room 으로 cancel 을 먼저
 * 통과시키고, room/CRDT 리소스 해제가 끝난 뒤에만 명령 identity 를 회전한다. 훅 인자 ref 변이는
 * react-compiler 가 거부하므로 컴파일 경계 밖에서 수행한다.
 */
function rotateStudioLiveCollaborationRoom(
  context: Pick<
    StudioCollaborationWiringContext,
    | "cancelStudioLiveGesturePreviewRef"
    | "studioLiveCommentEventHandlerRef"
    | "studioLiveCommentRoomUnsubscribeRef"
    | "studioLiveGesturePreviewAdapter"
    | "studioLiveHeldResourcesRef"
    | "studioLiveMutationGenerationRef"
    | "studioLivePendingMutationRef"
    | "studioLiveRoomRef"
  >,
  room: StudioLiveRoom | null
): void {
  const {
    cancelStudioLiveGesturePreviewRef,
    studioLiveCommentEventHandlerRef,
    studioLiveCommentRoomUnsubscribeRef,
    studioLiveGesturePreviewAdapter,
    studioLiveHeldResourcesRef,
    studioLiveMutationGenerationRef,
    studioLivePendingMutationRef,
    studioLiveRoomRef,
  } = context;
  const previous = studioLiveRoomRef.current;
  if (previous === room) return;
  // The cancel must traverse the room that owned begin. A packet from the replacement room
  // cannot safely close the old sender/gesture identity, so cancel before rotating the command.
  cancelStudioLiveGesturePreviewRef.current();
  studioLiveCommentRoomUnsubscribeRef.current?.();
  studioLiveCommentRoomUnsubscribeRef.current = null;
  ++studioLiveMutationGenerationRef.current;
  studioLiveHeldResourcesRef.current = [
    ...releaseStudioLiveMutationLocks(previous, studioLiveHeldResourcesRef.current),
  ];
  studioLivePendingMutationRef.current = null;
  studioLiveGesturePreviewAdapter.setRoom(room);
  studioLiveRoomRef.current = room;
  if (room) {
    const subscribedRoom = room;
    studioLiveCommentRoomUnsubscribeRef.current = room.subscribe((event) => {
      if (
        studioLiveRoomRef.current !== subscribedRoom
        || event.type !== "comment-changed"
      ) return;
      studioLiveCommentEventHandlerRef.current(event.change);
    });
  }
}

interface StudioCollaborationAccessGeneration {
  authScopeKey: string | null;
  workId: string | null;
  locked: boolean;
  accessGeneration: number;
  documentGeneration: number;
}

/**
 * StudioPage에서 주입되는 라이브 협업 배선 컨텍스트. 이 훅은 CRDT/live-room의 LIVE 측만
 * 소유한다 — commit 엔진(히스토리 저널·pages 히스토리 상태)은 StudioPage에 남고, 여기서는
 * 주입된 핸들만 통해 접근한다. Teardown 계약: room/CRDT 해제(제스처 프리뷰 lifecycle의
 * layout cleanup)는 언제나 identity 회전(오토세이브 lease의 passive cleanup)보다 먼저 실행된다.
 */
export interface StudioCollaborationWiringContext {
  readonly authorizedWorkAssetScopeId: string | null;
  readonly autosaveKey: string;
  readonly cancelStudioLiveGesturePreviewRef: MutableRefObject<() => void>;
  readonly collaborationAccessRef: MutableRefObject<StudioCollaborationAccessGeneration>;
  readonly collaborationDocumentLocked: boolean;
  readonly editorMountedRef: MutableRefObject<boolean>;
  readonly markStudioDocumentChanged: () => boolean;
  readonly pages: PageState[];
  readonly pagesHiRef: MutableRefObject<number>;
  readonly pagesHistoryRef: MutableRefObject<PageState[][]>;
  readonly publishStudioCrdtSceneTransitionRef: MutableRefObject<(
    previousPages: readonly PageState[],
    nextPages: readonly PageState[],
    registerNewDraws?: boolean
  ) => boolean>;
  readonly rebaseStudioHistoryJournal: (
    resultingPages: readonly PageState[],
    resultingHistoryIndex: number,
    reason: string
  ) => void;
  readonly setError: (message: string | null) => void;
  readonly setPagesHistoryState: Dispatch<SetStateAction<PageState[][]>>;
  readonly setStudioCrdtAuthoritativeBarrierGeneration: Dispatch<SetStateAction<number>>;
  readonly setStudioCrdtDocument: Dispatch<SetStateAction<StudioCrdtDocument | null>>;
  readonly setStudioCrdtReconciledDocument: Dispatch<SetStateAction<StudioCrdtDocument | null>>;
  readonly setStudioLiveEditsDurablyProtected: Dispatch<SetStateAction<boolean>>;
  readonly sharedDocument: StudioSharedDocument | null;
  readonly studioAuthUserId: string | null;
  readonly studioCrdtAuthoritativeSaveBarrierRef:
    MutableRefObject<StudioCrdtAuthoritativeSaveBarrier | null>;
  readonly studioCrdtDocument: StudioCrdtDocument | null;
  readonly studioCrdtDocumentRef: MutableRefObject<StudioCrdtDocument | null>;
  readonly studioCrdtOperationSyncReady: boolean;
  readonly studioCrdtSceneRuntimeRef: MutableRefObject<StudioCrdtSceneGraphRuntime | null>;
  readonly studioLiveCommentEventHandlerRef: MutableRefObject<(
    change: StudioTeamCommentLiveEvent
  ) => void>;
  readonly studioLiveCommentRoomUnsubscribeRef: MutableRefObject<(() => void) | null>;
  readonly studioLiveGesturePreviewAdapter: StudioLiveGesturePreviewRoomAdapter;
  readonly studioLiveGesturePreviewLifecycleGenerationRef:
    MutableRefObject<{ generation: number }>;
  readonly studioLiveHeldResourcesRef: MutableRefObject<string[]>;
  readonly studioLiveMutationGenerationRef: MutableRefObject<number>;
  readonly studioLivePendingMutationRef: MutableRefObject<{
    room: StudioLiveRoom;
    key: string;
    promise: Promise<boolean>;
  } | null>;
  readonly studioLiveRoomRef: MutableRefObject<StudioLiveRoom | null>;
  readonly studioWorkAssetAdmissionCoordinator: StudioWorkAssetAdmissionCoordinator;
}

export interface StudioCollaborationWiringResult {
  readonly autosaveDocumentLeadership:
    ReturnType<typeof useStudioAutosaveDocumentRuntime>["autosaveDocumentLeadership"];
  readonly autosaveDocumentLeaseRef:
    ReturnType<typeof useStudioAutosaveDocumentRuntime>["autosaveDocumentLeaseRef"];
  readonly autosaveLeadershipGuardRef:
    ReturnType<typeof useStudioAutosaveDocumentRuntime>["autosaveLeadershipGuardRef"];
  readonly autosaveOpfsSessionRef:
    ReturnType<typeof useStudioAutosaveDocumentRuntime>["autosaveOpfsSessionRef"];
  readonly autosaveSqliteStoreRef:
    ReturnType<typeof useStudioAutosaveDocumentRuntime>["autosaveSqliteStoreRef"];
  readonly handleStudioCrdtAuthoritativeSaveBarrierChange: (
    barrier: StudioCrdtAuthoritativeSaveBarrier | null
  ) => void;
  readonly handleStudioCrdtDocumentChange: (
    document: StudioCrdtDocument | null,
    runtime: StudioCrdtSceneGraphRuntime | null
  ) => void;
  readonly handleStudioLiveEditSafetyChange: (editsDurablyProtected: boolean) => void;
  readonly handleStudioLiveRoomChange: (room: StudioLiveRoom | null) => void;
}

export function useStudioCollaborationWiring(
  context: StudioCollaborationWiringContext
): StudioCollaborationWiringResult {
  const {
    authorizedWorkAssetScopeId,
    autosaveKey,
    cancelStudioLiveGesturePreviewRef,
    collaborationAccessRef,
    collaborationDocumentLocked,
    editorMountedRef,
    markStudioDocumentChanged,
    pages,
    pagesHiRef,
    pagesHistoryRef,
    publishStudioCrdtSceneTransitionRef,
    rebaseStudioHistoryJournal,
    setError,
    setPagesHistoryState,
    setStudioCrdtAuthoritativeBarrierGeneration,
    setStudioCrdtDocument,
    setStudioCrdtReconciledDocument,
    setStudioLiveEditsDurablyProtected,
    sharedDocument,
    studioAuthUserId,
    studioCrdtAuthoritativeSaveBarrierRef,
    studioCrdtDocument,
    studioCrdtDocumentRef,
    studioCrdtOperationSyncReady,
    studioCrdtSceneRuntimeRef,
    studioLiveCommentEventHandlerRef,
    studioLiveCommentRoomUnsubscribeRef,
    studioLiveGesturePreviewAdapter,
    studioLiveGesturePreviewLifecycleGenerationRef,
    studioLiveHeldResourcesRef,
    studioLiveMutationGenerationRef,
    studioLivePendingMutationRef,
    studioLiveRoomRef,
    studioWorkAssetAdmissionCoordinator,
  } = context;
  const handleStudioLiveRoomChange = useCallback((room: StudioLiveRoom | null) => {
    rotateStudioLiveCollaborationRoom({
      cancelStudioLiveGesturePreviewRef,
      studioLiveCommentEventHandlerRef,
      studioLiveCommentRoomUnsubscribeRef,
      studioLiveGesturePreviewAdapter,
      studioLiveHeldResourcesRef,
      studioLiveMutationGenerationRef,
      studioLivePendingMutationRef,
      studioLiveRoomRef,
    }, room);
  }, [
    cancelStudioLiveGesturePreviewRef,
    studioLiveCommentEventHandlerRef,
    studioLiveCommentRoomUnsubscribeRef,
    studioLiveGesturePreviewAdapter,
    studioLiveHeldResourcesRef,
    studioLiveMutationGenerationRef,
    studioLivePendingMutationRef,
    studioLiveRoomRef,
  ]);
  useLayoutEffect(() => {
    const lifecycle = studioLiveGesturePreviewLifecycleGenerationRef.current;
    // react-compiler는 훅 인자에서 파생된 별칭의 직접 변이를 거부한다 — 같은 공유 객체를 컴파일
    // 경계 밖 헬퍼로 증가시킨다(StudioPage 추출 전과 의미 동일).
    const lifecycleGeneration = advanceStudioLiveGesturePreviewLifecycle(lifecycle);
    return () => {
      resetStudioLiveCommentRoomWiring(
        studioLiveCommentRoomUnsubscribeRef,
        studioLiveCommentEventHandlerRef
      );
      // React StrictMode replays setup→cleanup→setup on the same state object. Defer terminal
      // disposal by one microtask so that replay can reacquire this adapter. Compare setup generation
      // to ensure that only the final unmount performs hard disposal.
      globalThis.queueMicrotask(() => {
        if (lifecycle.generation !== lifecycleGeneration) return;
        studioLiveGesturePreviewAdapter.dispose();
      });
    };
  }, [
    studioLiveCommentEventHandlerRef,
    studioLiveCommentRoomUnsubscribeRef,
    studioLiveGesturePreviewAdapter,
    studioLiveGesturePreviewLifecycleGenerationRef,
  ]);
  const handleStudioCrdtAuthoritativeSaveBarrierChange = useCallback((
    barrier: StudioCrdtAuthoritativeSaveBarrier | null
  ) => {
    publishStudioCrdtAuthoritativeSaveBarrier(studioCrdtAuthoritativeSaveBarrierRef, barrier);
    // The command is ref-backed to avoid subscription churn, while this rare generation change
    // restarts fail-closed raster authority after reconnect, revocation or room replacement.
    setStudioCrdtAuthoritativeBarrierGeneration((generation) => generation + 1);
  }, [setStudioCrdtAuthoritativeBarrierGeneration, studioCrdtAuthoritativeSaveBarrierRef]);
  const handleStudioCrdtDocumentChange = useCallback((
    document: StudioCrdtDocument | null,
    runtime: StudioCrdtSceneGraphRuntime | null
  ) => {
    // document와 동적 scene runtime은 반드시 같은 room 세대의 한 쌍으로만 공개한다. 둘 중
    // 하나라도 없으면 즉시 fail-closed 상태로 되돌려 지연 로딩/room 교체 틈의 로컬 편집을 막는다.
    const readyDocument = document && runtime ? document : null;
    pairStudioCrdtDocumentRuntime(
      studioCrdtDocumentRef,
      studioCrdtSceneRuntimeRef,
      readyDocument,
      runtime
    );
    // 새 pair가 도착해도 initial frontier를 React history에 합치기 전에는 편집을 열지 않는다.
    setStudioCrdtReconciledDocument(null);
    setStudioCrdtDocument(readyDocument);
  }, [
    setStudioCrdtDocument,
    setStudioCrdtReconciledDocument,
    studioCrdtDocumentRef,
    studioCrdtSceneRuntimeRef,
  ]);
  const handleStudioLiveEditSafetyChange = useCallback((editsDurablyProtected: boolean) => {
    setStudioLiveEditsDurablyProtected(editsDurablyProtected);
  }, [setStudioLiveEditsDurablyProtected]);
  const {
    autosaveDocumentLeadership,
    autosaveDocumentLeaseRef,
    autosaveLeadershipGuardRef,
    autosaveOpfsSessionRef,
    autosaveSqliteStoreRef,
  } = useStudioAutosaveDocumentRuntime({
    autosaveKey,
  });
  const studioWorkAssetAdmissionEnabled = Boolean(
    authorizedWorkAssetScopeId &&
    studioAuthUserId &&
    sharedDocument?.access === "edit" &&
    sharedDocument.capabilities.edit &&
    studioCrdtOperationSyncReady &&
    !collaborationDocumentLocked
  );
  useLayoutEffect(() => {
    studioWorkAssetAdmissionCoordinator.sync({
      workId: authorizedWorkAssetScopeId,
      authUserId: studioAuthUserId,
      editable: studioWorkAssetAdmissionEnabled,
      pages,
      onAdmitted: (receipt) => {
        const access = collaborationAccessRef.current;
        if (
          !editorMountedRef.current ||
          access.authScopeKey !== studioAuthUserId ||
          access.workId !== authorizedWorkAssetScopeId ||
          access.locked ||
          studioCrdtDocumentRef.current !== studioCrdtDocument
        ) {
          return false;
        }
        const history = pagesHistoryRef.current;
        const currentIndex = Math.max(0, Math.min(pagesHiRef.current, history.length - 1));
        const currentSnapshot = history[currentIndex] ?? [];
        const stillOwnsSource = currentSnapshot.some((page) =>
          page.elements.some((element) =>
            element.id === receipt.assetId &&
            element.type === "image" &&
            element.src === receipt.source
          )
        );
        // A source edit wins over a late upload. Do not rewrite older undo snapshots with a receipt
        // that no longer belongs to the visible current element.
        if (!stillOwnsSource) return false;
        const admitted = replaceStudioWorkAssetSourceAcrossHistory({
          history,
          currentIndex,
          assetId: receipt.assetId,
          expectedSource: receipt.source,
          canonicalSource: receipt.canonicalSource,
        });
        if (!admitted.changed) return false;
        if (!markStudioDocumentChanged()) {
          throw new Error("저장 중이라 승인된 이미지 참조 전환을 잠시 미뤘습니다.");
        }
        if (!publishStudioCrdtSceneTransitionRef.current(
          admitted.previousCurrentPages,
          admitted.nextCurrentPages
        )) {
          throw new Error("승인된 이미지 참조를 실시간 팀 문서에 반영하지 못했습니다.");
        }
        // Every undo snapshot switches source identity in one React update. Placement/filter edits
        // remain snapshot-specific; only the exact local source is replaced by the opaque URI.
        commitStudioWorkAssetAdmittedHistory(pagesHistoryRef, admitted.history);
        rebaseStudioHistoryJournal(
          admitted.nextCurrentPages,
          currentIndex,
          "work asset canonicalization"
        );
        setPagesHistoryState(admitted.history);
        return true;
      },
      onError: (message) => {
        const access = collaborationAccessRef.current;
        if (
          !editorMountedRef.current ||
          access.authScopeKey !== studioAuthUserId ||
          access.workId !== authorizedWorkAssetScopeId
        ) return;
        setError(`공동 작업 이미지 업로드: ${message} 로컬 이미지는 캔버스에 그대로 유지됩니다.`);
      },
    });
    // 주입된 commit-엔진 핸들(markStudioDocumentChanged 등)은 StudioPage 안에서는 안정 캡처만 담아
    // dep 에서 면제됐지만, 훅 인자로는 불투명해 배열에 포함한다. 컴파일된 빌드에서는 모두 안정
    // identity 라 재실행 빈도는 추출 전과 동일하고, sync 는 키 기반 reconcile 이라 여분 호출도
    // 중복 업로드를 만들지 않는다.
  }, [
    authorizedWorkAssetScopeId,
    collaborationAccessRef,
    editorMountedRef,
    markStudioDocumentChanged,
    pages,
    pagesHiRef,
    pagesHistoryRef,
    publishStudioCrdtSceneTransitionRef,
    rebaseStudioHistoryJournal,
    setError,
    setPagesHistoryState,
    studioAuthUserId,
    studioCrdtDocument,
    studioCrdtDocumentRef,
    studioWorkAssetAdmissionCoordinator,
    studioWorkAssetAdmissionEnabled,
  ]);
  return {
    autosaveDocumentLeadership,
    autosaveDocumentLeaseRef,
    autosaveLeadershipGuardRef,
    autosaveOpfsSessionRef,
    autosaveSqliteStoreRef,
    handleStudioCrdtAuthoritativeSaveBarrierChange,
    handleStudioCrdtDocumentChange,
    handleStudioLiveEditSafetyChange,
    handleStudioLiveRoomChange,
  };
}
