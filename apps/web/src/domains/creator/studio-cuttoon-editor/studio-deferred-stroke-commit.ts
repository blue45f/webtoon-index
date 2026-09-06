
import { requireStudioDrawingPointerTransport } from "../brush/studio-drawing-pointer-transport";
import {
  releaseStudioGpuPendingAuthorityPrefix,
  type StudioGpuPendingDrawAuthority,
} from "../render/studio-webgpu-pending-authority";
import {
  planStudioCommittedInkRetainedRetry,
  type StudioCommittedInkRetainedRetryState,
} from "../studio-committed-ink-release-retry";
import {
  detachStudioLinked3dCorrections,
  parseStudioLinked3dRenderDocument,
  reconcileStudioLinked3dRenderDocumentAfterElementMutation,
  validateStudioLinked3dRenderDocumentAgainstPage,
  validateStudioLinked3dReservedPageState,
} from "../studio-linked-3d-render-document";
import { withMasterElements, type DocumentMaster } from "../studio-master-page";
import { findChangedLockedPageId } from "../studio-page-review";
import {
  STUDIO_GPU_TERMINAL_RECEIPT_TIMEOUT_MS,
  applyBubbleAnchors,
} from "../studio-page-shell-runtime";
import {
  appendStudioPagesHistorySnapshot,
  projectStudioPendingStrokes,
  type StudioPagesHistoryAppendResult,
} from "../studio-pending-stroke-durability";
import {
  STUDIO_PROJECT_MAX_CANVAS_HEIGHT,
  STUDIO_PROJECT_MAX_PAGES,
} from "../studio-project-file";
import {
  reconcileStudioShared3dStageVisibilityReceiptsAfterElementMutation,
} from "../studio-shared-3d-stage-collection";
import {
  studioWorkAssetDocumentSourceTransitionReason,
  studioWorkAssetSourceTransitionReason,
} from "../studio-work-asset-edit-guard";

import type { StudioCollaborationWiringContext } from "../live/studio-collaboration-wiring";
import type { StudioLiveDynamicBrushOverlayRenderer } from "../live/studio-live-dynamic-brush-overlay";
import type { StudioLiveInkOverlayRenderer } from "../live/studio-live-ink-overlay";
import type { StudioLiveRetainedMediaOverlayRenderer } from "../live/studio-live-retained-media-overlay";
import type { StudioLiveStrokeGpuFailureReason } from "../live/studio-live-stroke-render-backend";
import type { StudioGpuLiveSourceJournalState } from "../render/studio-webgpu-live-source-journal";
import type { StudioGpuLiveStrokePlan } from "../render/studio-webgpu-live-stroke-plan";
import type { StudioGpuStroke } from "../render/studio-webgpu-stroke";
import type {
  StudioCommittedInkSurfaceCounts,
  StudioCommittedInkSurfaceHandoff,
} from "../studio-committed-ink-handoff-coordinator";
import type { StudioDraftPreviewStore } from "../studio-draft-preview-store";
import type { DrawEl, El } from "../studio-element-model";
import type { PageState } from "../studio-page-state";
import type {
  StudioHistoryJournalTransitionInput,
} from "../studio-pages-history-command-journal-client";
import type { StudioShared3dStageDccSource } from "../studio-shared-3d-stage-document";
import type { StudioWebGpuCanvasHandle } from "../StudioWebGpuCanvas";
import type { MutableRefObject, SetStateAction } from "react";

/**
 * 대기(지연) 획 커밋 배치 — StudioPage 의 pendingStrokeCommitsRef 가 들고 있는 배치에서
 * timer 를 제외한 운반 형태다(takePendingStrokeCommits 가 만드는 모양 그대로).
 */
export type PendingStrokeCommitBatch = {
  pageId: string;
  strokes: DrawEl[];
  retryCount: number;
};

/**
 * StudioPage 에서 추출한 지연 획 커밋 엔진(HOT PATH)의 배선 컨텍스트.
 *
 * 스냅샷 히스토리 authority seam(pagesHistoryRef/pagesHiRef 선행 기록, ref-앞·state-뒤 계약)은
 * live/studio-collaboration-wiring 의 StudioCollaborationWiringContext 가 이미 선언한 멤버를
 * Pick 으로 공유한다 — commit 엔진과 라이브 배선이 같은 ref 를 다른 모양으로 재정의하지 않는다.
 * 이 팩토리는 훅이 아니라서 react-compiler 컴파일 경계 밖이다. 반환 클로저의 ref 변이
 * (`pagesHistoryRef.current = …`)는 추출 전 StudioPage 본문과 동일한 텍스트·순서 그대로다.
 */
export interface StudioDeferredStrokeCommitEngineContext extends Pick<
  StudioCollaborationWiringContext,
  | "collaborationAccessRef"
  | "editorMountedRef"
  | "pages"
  | "pagesHiRef"
  | "pagesHistoryRef"
  | "setError"
  | "studioCrdtDocumentRef"
  | "studioCrdtSceneRuntimeRef"
> {
  readonly activeGpuLiveSourceJournalMatchesPlan: (
    el: DrawEl,
    plan: StudioGpuLiveStrokePlan,
    journal: StudioGpuLiveSourceJournalState
  ) => boolean;
  readonly activePage: PageState;
  readonly advancedFillApplyingRef: MutableRefObject<boolean>;
  readonly applyLiveStrokeBackendPresentationEffects: () => void;
  readonly armGpuPinnedRequestWatchdog: (requestId: string, timeoutMs?: number) => void;
  readonly bg3dDccSourceRef: MutableRefObject<StudioShared3dStageDccSource | null>;
  readonly buildGpuLiveStrokePlan: (
    el: DrawEl,
    options?: { sealEndpoint?: boolean; correctedEl?: DrawEl | null }
  ) => StudioGpuLiveStrokePlan | null;
  readonly coalesceKeyRef: MutableRefObject<string | null>;
  readonly collaborationLockMessage: () => string;
  readonly committedInkRetainedRetryRef:
    MutableRefObject<StudioCommittedInkRetainedRetryState | null>;
  readonly committedInkRetainedWarnedKeyRef: MutableRefObject<string | null>;
  readonly committedInkSurfaceHandoffRafRef: MutableRefObject<number>;
  readonly committedInkSurfaceHandoffsRef:
    MutableRefObject<StudioCommittedInkSurfaceHandoff[]>;
  readonly currentPageIdRef: MutableRefObject<string>;
  readonly documentSaveInFlightRef: MutableRefObject<boolean>;
  readonly draftPreviewStoreRef: MutableRefObject<StudioDraftPreviewStore>;
  readonly drawingPointerTransportRef:
    Parameters<typeof requireStudioDrawingPointerTransport>[0];
  readonly drawingRef: MutableRefObject<DrawEl | null>;
  readonly elements: El[];
  readonly flushPendingStrokeCommitsRef: MutableRefObject<() => boolean>;
  readonly gpuLingerRafRef: MutableRefObject<number>;
  readonly gpuLiveAcceptedRequestIdRef: MutableRefObject<string | null>;
  readonly gpuLiveInkPinnedRef: MutableRefObject<boolean>;
  readonly gpuLiveSourceJournalFirstStrokeIndexRef: MutableRefObject<number>;
  readonly gpuLiveSourceJournalRef:
    MutableRefObject<StudioGpuLiveSourceJournalState | null>;
  readonly invalidateAdvancedFillWork: (message: string) => boolean;
  readonly liveDynamicBrushOverlayRendererRef:
    MutableRefObject<StudioLiveDynamicBrushOverlayRenderer>;
  readonly liveInkOverlayRendererRef: MutableRefObject<StudioLiveInkOverlayRenderer>;
  readonly liveRetainedMediaOverlayRendererRef:
    MutableRefObject<StudioLiveRetainedMediaOverlayRenderer>;
  readonly masterEditMode: boolean;
  readonly noteStudioHistoryRetention: (
    appended: StudioPagesHistoryAppendResult<PageState>
  ) => void;
  readonly pageEditLocked: boolean;
  readonly pendingGpuDrawAuthoritiesRef:
    MutableRefObject<StudioGpuPendingDrawAuthority[]>;
  readonly pendingGpuStrokesRef: MutableRefObject<StudioGpuStroke[]>;
  readonly pendingStrokeCommitsRef: MutableRefObject<
    | (PendingStrokeCommitBatch & { timer: ReturnType<typeof setTimeout> | null })
    | null
  >;
  readonly onSelectedGpuLiveInkUnavailable: (
    reason: StudioLiveStrokeGpuFailureReason,
    strokeId: string,
  ) => void;
  readonly prepareLiveStrokeGpuSubmission: (strokeId: string) => boolean;
  readonly processCommittedInkSurfaceHandoffsRef: MutableRefObject<() => void>;
  /**
   * StudioPage 가 라이브 배선 seam(publishStudioCrdtSceneTransitionRef)에 발행하는 것과 같은
   * 렌더의 클로저를 직접 주입한다 — 추출 전 commit 이 캡처하던 identity 그대로다.
   */
  readonly publishStudioCrdtSceneTransition:
    StudioCollaborationWiringContext["publishStudioCrdtSceneTransitionRef"]["current"];
  readonly recordStudioHistoryJournalPages: (
    addedSteps: number,
    nextUndoDepth: number
  ) => void;
  readonly recordStudioHistoryTransition: (
    input: StudioHistoryJournalTransitionInput
  ) => void;
  readonly registerLiveStrokeGpuRequest: (strokeId: string, requestId: string) => boolean;
  readonly setMaster: (next: SetStateAction<DocumentMaster<El>>) => void;
  readonly setPagesHi: (next: SetStateAction<number>) => void;
  readonly setPagesHistory: (next: SetStateAction<PageState[][]>) => void;
  readonly setSharedDocumentNotice: (notice: string | null) => void;
  readonly studioRevisionProjectGenerationRef: MutableRefObject<number>;
  readonly webGpuCanvasHandleRef: MutableRefObject<StudioWebGpuCanvasHandle | null>;
}

export interface StudioDeferredStrokeCommitEngine {
  readonly commit: (
    nextElements: El[],
    extraPatch?: Partial<Omit<PageState, "id" | "elements">>,
    targetPageId?: string
  ) => boolean;
  readonly commitCoalesced: (nextElements: El[], key: string) => void;
  readonly commitPages: (
    nextPages: PageState[],
    options?: {
      bypassReviewLock?: boolean;
      pendingStrokePolicy?: "preserve" | "drop";
    }
  ) => boolean;
  readonly expandDeferredStrokeCommitHistory: (batch: PendingStrokeCommitBatch) => void;
  readonly releaseCommittedInkSurfaceCounts: (
    released: StudioCommittedInkSurfaceCounts,
    completeGpuElementIds: ReadonlySet<string>,
  ) =>
    | { readonly status: "released" }
    | { readonly status: "retained"; readonly reason: string };
  readonly scheduleCommittedInkRetainedRetry: (
    released: StudioCommittedInkSurfaceCounts,
    completeGpuElementIds: ReadonlySet<string>,
    reason: string
  ) => void;
  readonly scheduleCommittedInkSurfaceHandoffRetry: () => void;
}

/**
 * 렌더마다 StudioPage 본문에서 호출되는 순수 팩토리(훅 아님). 함수 본문들은 StudioPage 에서
 * 그대로 옮겨 왔고(ZERO behavior change), 경계 테스트가 소스 텍스트를 스캔하므로 본문
 * 들여쓰기·주석·문장 순서를 추출 전과 동일하게 유지한다.
 */
export function createStudioDeferredStrokeCommitEngine(
  context: StudioDeferredStrokeCommitEngineContext
): StudioDeferredStrokeCommitEngine {
  const {
    activeGpuLiveSourceJournalMatchesPlan,
    activePage,
    advancedFillApplyingRef,
    applyLiveStrokeBackendPresentationEffects,
    armGpuPinnedRequestWatchdog,
    bg3dDccSourceRef,
    buildGpuLiveStrokePlan,
    coalesceKeyRef,
    collaborationAccessRef,
    collaborationLockMessage,
    committedInkRetainedRetryRef,
    committedInkRetainedWarnedKeyRef,
    committedInkSurfaceHandoffRafRef,
    committedInkSurfaceHandoffsRef,
    currentPageIdRef,
    documentSaveInFlightRef,
    draftPreviewStoreRef,
    drawingPointerTransportRef,
    drawingRef,
    editorMountedRef,
    elements,
    flushPendingStrokeCommitsRef,
    gpuLingerRafRef,
    gpuLiveAcceptedRequestIdRef,
    gpuLiveInkPinnedRef,
    gpuLiveSourceJournalFirstStrokeIndexRef,
    gpuLiveSourceJournalRef,
    invalidateAdvancedFillWork,
    liveDynamicBrushOverlayRendererRef,
    liveInkOverlayRendererRef,
    liveRetainedMediaOverlayRendererRef,
    masterEditMode,
    noteStudioHistoryRetention,
    pageEditLocked,
    pages,
    pagesHiRef,
    pagesHistoryRef,
    pendingGpuDrawAuthoritiesRef,
    pendingGpuStrokesRef,
    pendingStrokeCommitsRef,
    onSelectedGpuLiveInkUnavailable,
    prepareLiveStrokeGpuSubmission,
    processCommittedInkSurfaceHandoffsRef,
    publishStudioCrdtSceneTransition,
    recordStudioHistoryJournalPages,
    recordStudioHistoryTransition,
    registerLiveStrokeGpuRequest,
    setError,
    setMaster,
    setPagesHi,
    setPagesHistory,
    setSharedDocumentNotice,
    studioCrdtDocumentRef,
    studioCrdtSceneRuntimeRef,
    studioRevisionProjectGenerationRef,
    webGpuCanvasHandleRef,
  } = context;

  function mergeStudioCrdtFrontier(nextPages: PageState[]): PageState[] {
    const document = studioCrdtDocumentRef.current;
    const runtime = studioCrdtSceneRuntimeRef.current;
    if (!document || !runtime) return nextPages;
    const reconciled = runtime.reconcilePages(
      nextPages,
      document.getStrokes({ includeDeleted: true }),
      document.getSceneElements({ includeDeleted: true }),
      document.getPages(true),
      document.getLayerGroups({ includeDeleted: true })
    );
    return reconciled.pages;
  }

  // 요소 변경을 히스토리에 커밋. (마스터 편집 모드에서는 문서 마스터로 커밋 — 히스토리 미포함, 패널에서 고지)
  // extraPatch — 레이어 삭제 시 elements 와 animTimeline(트랙 정리)을 원자적(단일 undo 스텝)으로
  // 함께 커밋하기 위한 옵셔널 2번째 파라미터(하위호환 — 기존 15곳 이상의 commit(nextElements)
  // 단일 인자 호출은 전부 그대로 동작한다). extraPatch 스프레드 뒤에 elements 를 마지막에 둬서
  // extraPatch 에 실수로 elements 가 섞여도 항상 nextElements 가 이긴다.
  function commit(
    nextElements: El[],
    extraPatch?: Partial<Omit<PageState, "id" | "elements">>,
    // 지연 커밋 배치가 큐잉 시점의 페이지로 정확히 동기화되도록, 활성 페이지가 아닌 대상도 허용.
    targetPageId?: string
  ): boolean {
    if (!editorMountedRef.current) return false;
    if (
      extraPatch?.canvasH !== undefined &&
      (
        !Number.isFinite(extraPatch.canvasH) ||
        extraPatch.canvasH <= 0 ||
        extraPatch.canvasH > STUDIO_PROJECT_MAX_CANVAS_HEIGHT
      )
    ) {
      setError(
        `페이지 높이는 1–${STUDIO_PROJECT_MAX_CANVAS_HEIGHT.toLocaleString("ko-KR")}px 범위여야 저장할 수 있어요.`,
      );
      return false;
    }
    if (documentSaveInFlightRef.current) {
      setError("저장 중에는 원고를 변경할 수 없어요. 저장이 끝난 뒤 다시 시도해 주세요.");
      return false;
    }
    if (collaborationAccessRef.current.locked) {
      setError(collaborationLockMessage());
      return false;
    }
    const commitPageId = targetPageId ?? activePage.id;
    // Multiple pointerup/flush commits can run before React renders. Read and advance the
    // ref-backed history, not this render's `pages`, so a cross-page deferred flush cannot be
    // replaced by the immediate stroke that follows it in the same browser task.
    const currentHistory = pagesHistoryRef.current;
    const currentHistoryIndex = Math.max(
      0,
      Math.min(pagesHiRef.current, Math.max(0, currentHistory.length - 1))
    );
    const commitBasePages = currentHistory[currentHistoryIndex] ?? pages;
    const commitTargetPage = commitBasePages.find((page) => page.id === commitPageId);
    const commitBaseElements = commitTargetPage?.elements ?? elements;
    const workAssetReason = studioWorkAssetSourceTransitionReason(commitBaseElements, nextElements);
    if (workAssetReason) {
      setError(workAssetReason);
      return false;
    }
    setSharedDocumentNotice(null);
    let resolved = applyBubbleAnchors(nextElements);
    if (masterEditMode) {
      if (bg3dDccSourceRef.current) {
        setError("DCC Shot 연결은 일반 페이지에서만 만들 수 있어요. 문서 마스터를 닫고 다시 추가해 주세요.");
        return false;
      }
      const reservedMasterState = validateStudioLinked3dReservedPageState({
        value: undefined,
        elements: resolved,
      });
      if (!reservedMasterState.ok) {
        setError("문서 마스터에는 연결형 3D pass locator나 correction을 둘 수 없어요.");
        return false;
      }
      setMaster((m) => withMasterElements(m, resolved)); // extraPatch는 마스터엔 개념 없음 — 무시
      return true;
    }
    if (pageEditLocked) {
      setError("이 페이지는 검토 잠금 상태예요. 페이지 검토에서 잠금을 해제한 뒤 편집해 주세요.");
      return false;
    }
    if (!advancedFillApplyingRef.current) {
      invalidateAdvancedFillWork("문서가 바뀌어 진행 중인 계산과 채우기 미리보기를 취소했습니다.");
    }
    // Generic mutations preserve Stage entries and missing/ambiguous tombstones. Revealing an
    // exact source does consume Studio's visibility receipt in the same undo step, so a later
    // user-authored hide can never be mistaken for visibility still owned by the Stage.
    const hasExplicitSharedStagePatch = Object.prototype.hasOwnProperty.call(
      extraPatch ?? {},
      "shared3dStage",
    );
    const visibilityReceiptReconciliation = !hasExplicitSharedStagePatch
      && commitTargetPage?.shared3dStage !== undefined
      ? reconcileStudioShared3dStageVisibilityReceiptsAfterElementMutation({
          value: commitTargetPage.shared3dStage,
          beforeElements: commitBaseElements,
          nextElements: resolved,
        })
      : null;
    const resolvedExtraPatch = visibilityReceiptReconciliation
      && visibilityReceiptReconciliation.consumedElementIds.length > 0
      ? {
          ...(extraPatch ?? {}),
          shared3dStage: visibilityReceiptReconciliation.nextState,
        }
      : extraPatch;
    const hasExplicitLinked3dRenderPatch = Object.prototype.hasOwnProperty.call(
      extraPatch ?? {},
      "linked3dRender",
    );
    const effectiveShared3dStage = Object.prototype.hasOwnProperty.call(
      resolvedExtraPatch ?? {},
      "shared3dStage",
    )
      ? resolvedExtraPatch?.shared3dStage
      : commitTargetPage?.shared3dStage;
    const linkedRenderReconciliation = !hasExplicitLinked3dRenderPatch
      && commitTargetPage?.linked3dRender !== undefined
      ? reconcileStudioLinked3dRenderDocumentAfterElementMutation({
          value: commitTargetPage.linked3dRender,
          elements: resolved,
          shared3dStage: effectiveShared3dStage,
        })
      : undefined;
    if (
      !hasExplicitLinked3dRenderPatch
      && commitTargetPage?.linked3dRender !== undefined
      && linkedRenderReconciliation === null
    ) {
      setError("연결된 3D Shot과 Canvas 레이어가 어긋나 변경을 적용하지 않았어요.");
      return false;
    }
    const reconciledLinked3dRender = linkedRenderReconciliation ?? undefined;
    if (!hasExplicitLinked3dRenderPatch && commitTargetPage?.linked3dRender !== undefined) {
      const previousLinkedDocument = parseStudioLinked3dRenderDocument(
        commitTargetPage.linked3dRender,
      );
      if (!previousLinkedDocument) {
        setError("연결된 3D render receipt가 손상되어 변경을 적용하지 않았어요.");
        return false;
      }
      const retainedBundleIds = new Set(
        reconciledLinked3dRender?.links.map(({ bundleId }) => bundleId) ?? [],
      );
      const retiredBundleIds = previousLinkedDocument.links
        .map(({ bundleId }) => bundleId)
        .filter((bundleId) => !retainedBundleIds.has(bundleId));
      if (retiredBundleIds.length > 0) {
        const detached = detachStudioLinked3dCorrections(resolved, retiredBundleIds);
        if (!detached) {
          setError("분리할 3D artist correction provenance가 손상되어 변경을 적용하지 않았어요.");
          return false;
        }
        resolved = detached;
      }
    }
    const finalExtraPatch = !hasExplicitLinked3dRenderPatch
      && commitTargetPage?.linked3dRender !== undefined
      ? {
          ...(resolvedExtraPatch ?? {}),
          linked3dRender: reconciledLinked3dRender,
        }
      : resolvedExtraPatch;
    const finalLinked3dRender = Object.prototype.hasOwnProperty.call(
      finalExtraPatch ?? {},
      "linked3dRender",
    )
      ? finalExtraPatch?.linked3dRender
      : commitTargetPage?.linked3dRender;
    const finalShared3dStage = Object.prototype.hasOwnProperty.call(
      finalExtraPatch ?? {},
      "shared3dStage",
    )
      ? finalExtraPatch?.shared3dStage
      : commitTargetPage?.shared3dStage;
    const reservedState = validateStudioLinked3dReservedPageState({
      value: finalLinked3dRender,
      elements: resolved,
    });
    if (!reservedState.ok) {
      setError("연결된 3D pass locator나 correction이 receipt와 달라 변경을 적용하지 않았어요.");
      return false;
    }
    if (finalLinked3dRender !== undefined) {
      const linkedValidation = validateStudioLinked3dRenderDocumentAgainstPage({
        value: finalLinked3dRender,
        elements: resolved,
        shared3dStage: finalShared3dStage,
      });
      if (!linkedValidation.ok) {
        setError("연결된 3D Stage·Shot·Canvas layer가 달라 변경을 적용하지 않았어요.");
        return false;
      }
    }
    coalesceKeyRef.current = null; // 일반 커밋은 합치기 체인을 끊는다.
    const localNextPages = commitBasePages.map((p) =>
      p.id === commitPageId ? { ...p, ...finalExtraPatch, elements: resolved } : p
    );
    if (!publishStudioCrdtSceneTransition(commitBasePages, localNextPages)) return false;
    const nextPages = mergeStudioCrdtFrontier(localNextPages);
    const appended = appendStudioPagesHistorySnapshot(
      currentHistory,
      currentHistoryIndex,
      nextPages
    );
    recordStudioHistoryTransition({
      mutationKind: "elements.commit",
      previousPages: commitBasePages,
      nextPages,
      previousHistoryIndex: currentHistoryIndex,
      nextHistoryIndex: appended.historyIndex,
    });
    // Advance refs before scheduling React state. A second synchronous commit observes this exact
    // first snapshot even though React Compiler batching has not rendered it yet.
    pagesHistoryRef.current = appended.history;
    pagesHiRef.current = appended.historyIndex;
    recordStudioHistoryJournalPages(1, appended.historyIndex);
    noteStudioHistoryRetention(appended);
    setPagesHistory(appended.history);
    setPagesHi(appended.historyIndex);
    return true;
  }
  // 같은 key의 연속 동작이면 새 히스토리 항목 대신 최상단을 교체(undo 1회로 합침).
  function commitCoalesced(nextElements: El[], key: string) {
    if (!editorMountedRef.current) return;
    if (documentSaveInFlightRef.current) {
      setError("저장 중에는 원고를 변경할 수 없어요. 저장이 끝난 뒤 다시 시도해 주세요.");
      return;
    }
    if (collaborationAccessRef.current.locked) {
      setError(collaborationLockMessage());
      return;
    }
    // A pointer stream may emit multiple coalesced samples before React commits a render. Always
    // branch from the synchronously advanced refs so those samples form one monotonic history
    // transition instead of repeatedly branching from the render closure.
    const currentHistory = pagesHistoryRef.current;
    const currentHistoryIndex = Math.max(
      0,
      Math.min(pagesHiRef.current, Math.max(0, currentHistory.length - 1))
    );
    const commitBasePages = currentHistory[currentHistoryIndex] ?? pages;
    const commitPageId = currentPageIdRef.current || activePage.id;
    const commitTargetPage = commitBasePages.find((page) => page.id === commitPageId);
    if (!commitTargetPage) {
      setError("현재 페이지를 찾지 못해 연속 편집을 적용하지 않았어요.");
      return;
    }
    const commitBaseElements = commitTargetPage.elements;
    const workAssetReason = studioWorkAssetSourceTransitionReason(
      commitBaseElements,
      nextElements
    );
    if (workAssetReason) {
      setError(workAssetReason);
      return;
    }
    setSharedDocumentNotice(null);
    const resolved = applyBubbleAnchors(nextElements);
    if (masterEditMode) {
      // 마스터 편집은 히스토리 밖이라 합치기(coalesce) 개념이 없다 — 마스터로 바로 커밋.
      setMaster((m) => withMasterElements(m, resolved));
      return;
    }
    if (pageEditLocked) {
      setError("이 페이지는 검토 잠금 상태예요. 페이지 검토에서 잠금을 해제한 뒤 편집해 주세요.");
      return;
    }
    if (!advancedFillApplyingRef.current) {
      invalidateAdvancedFillWork("문서가 바뀌어 진행 중인 계산과 채우기 미리보기를 취소했습니다.");
    }
    const localNextPages = commitBasePages.map((p) =>
      p.id === commitPageId ? { ...p, elements: resolved } : p
    );
    if (!publishStudioCrdtSceneTransition(commitBasePages, localNextPages)) return;
    const nextPages = mergeStudioCrdtFrontier(localNextPages);
    const replacesCurrentSnapshot =
      coalesceKeyRef.current === key &&
      currentHistoryIndex === currentHistory.length - 1;
    let nextHistory: PageState[][];
    let nextHistoryIndex: number;
    if (replacesCurrentSnapshot) {
      nextHistory = currentHistory.slice();
      nextHistory[currentHistoryIndex] = nextPages;
      nextHistoryIndex = currentHistoryIndex;
    } else {
      const appended = appendStudioPagesHistorySnapshot(
        currentHistory,
        currentHistoryIndex,
        nextPages
      );
      nextHistory = appended.history;
      nextHistoryIndex = appended.historyIndex;
      noteStudioHistoryRetention(appended);
    }
    recordStudioHistoryTransition({
      mutationKind: "elements.coalesced-commit",
      previousPages: commitBasePages,
      nextPages,
      previousHistoryIndex: currentHistoryIndex,
      nextHistoryIndex,
      coalesceKey: key,
    });
    // Advance refs before React setters so a second sample in this task sees this exact result.
    pagesHistoryRef.current = nextHistory;
    pagesHiRef.current = nextHistoryIndex;
    // 합치기 분기는 최상단 스냅샷만 갈아끼운다 — 새 단계가 없으므로 저널도 그대로 둔다.
    if (!replacesCurrentSnapshot) recordStudioHistoryJournalPages(1, nextHistoryIndex);
    setPagesHistory(nextHistory);
    if (!replacesCurrentSnapshot) setPagesHi(nextHistoryIndex);
    coalesceKeyRef.current = key;
  }
  /**
   * 지연 커밋 배치 하나를 **획 개수만큼의 히스토리 항목**으로 펼친다.
   *
   * 배칭은 렌더와 CRDT 발행을 아끼는 성능 장치지 undo 입도가 아니다. 한 배치를 한 항목으로
   * 두면 200ms 안에 그은 해칭 40획이 ⌘Z 한 번에 전멸한다 — CSP·Photoshop·Procreate 는 전부
   * 획당 1 undo 다. 그렇다고 획마다 `commit()` 을 부르면 같은 태스크에서 장면 발행이 여러 번
   * 겹쳐 "중복된 드로우 식별자"로 거절된다(실측). 그래서 발행·검증은 배치 단위로 한 번만 하고,
   * 여기서는 방금 만들어진 스냅샷에서 뒤쪽 획을 하나씩 걷어낸 **접두 스냅샷**을 되돌려 끼운다.
   * 히스토리 배열은 순수한 로컬 UI 상태이므로 이 재구성은 문서를 건드리지 않는다.
   */
  function expandDeferredStrokeCommitHistory(batch: PendingStrokeCommitBatch): void {
    if (batch.strokes.length < 2) return;
    const history = pagesHistoryRef.current;
    const finalIndex = Math.max(
      0,
      Math.min(pagesHiRef.current, Math.max(0, history.length - 1))
    );
    const finalPages = history[finalIndex];
    const basePages = history[finalIndex - 1];
    // 직전 스냅샷이 히스토리 상한에 밀려 없어졌다면 펼칠 기준이 없다. 배치 1항목으로 남긴다 —
    // 잘못된 기준으로 접두를 만들면 undo 가 엉뚱한 상태로 점프한다.
    if (!finalPages || !basePages) return;
    let accHistory = history;
    let accIndex = finalIndex - 1;
    let previousPages = basePages;
    for (let kept = 1; kept <= batch.strokes.length; kept += 1) {
      const dropped = new Set(batch.strokes.slice(kept).map((stroke) => stroke.id));
      const snapshot =
        dropped.size === 0
          ? finalPages
          : finalPages.map((page) =>
              page.id === batch.pageId
                ? {
                    ...page,
                    elements: page.elements.filter((element) => !dropped.has(element.id)),
                  }
                : page
            );
      const appended = appendStudioPagesHistorySnapshot(accHistory, accIndex, snapshot);
      recordStudioHistoryTransition({
        mutationKind: "elements.commit",
        previousPages,
        nextPages: snapshot,
        previousHistoryIndex: accIndex,
        nextHistoryIndex: appended.historyIndex,
      });
      accHistory = appended.history;
      accIndex = appended.historyIndex;
      previousPages = snapshot;
      // 한 배치를 N개 undo 단계로 펼치므로, 계량 관측도 각 append를 빠짐없이 본다.
      noteStudioHistoryRetention(appended);
    }
    pagesHistoryRef.current = accHistory;
    pagesHiRef.current = accIndex;
    // 배치 커밋은 `commit()` 에서 이미 저널에 1항목을 넣었다. 펼치기는 그 한 항목을 획 수만큼으로
    // 늘리는 일이므로 나머지 N-1 개만 더한다 — 저널의 `pages` 항목 수와 스냅샷 단계 수가 계속 같다.
    recordStudioHistoryJournalPages(batch.strokes.length - 1, accIndex);
    setPagesHistory(accHistory);
    setPagesHi(accIndex);
  }

  function releaseCommittedInkSurfaceCounts(
    released: StudioCommittedInkSurfaceCounts,
    completeGpuElementIds: ReadonlySet<string>,
  ):
    | { readonly status: "released" }
    | { readonly status: "retained"; readonly reason: string } {
    const hasCompleteGpuAuthority = pendingGpuDrawAuthoritiesRef.current.some((authority) => (
      completeGpuElementIds.has(authority.element.id)
    ));
    if (
      released.overlay === 0 && released.draft === 0 && released.gpu === 0
      && !hasCompleteGpuAuthority
    ) {
      return { status: "released" };
    }

    const overlayRenderer = liveInkOverlayRendererRef.current;
    const retainedMediaOverlayRenderer = liveRetainedMediaOverlayRendererRef.current;
    const dynamicBrushOverlayRenderer = liveDynamicBrushOverlayRendererRef.current;
    const draftPreviewStore = draftPreviewStoreRef.current;
    if (
      released.overlay > overlayRenderer.settledStrokeCount
        + retainedMediaOverlayRenderer.settledStrokeCount
        + dynamicBrushOverlayRenderer.settledStrokeCount
      || released.draft > draftPreviewStore.settledCount
    ) {
      // A ready handoff cannot consume a partial FIFO. Keep the original handoff queue and every
      // visible authority untouched until the surface graph changes or a bounded retry succeeds.
      return { status: "retained", reason: "surface-count-preflight" };
    }

    const shouldPlanGpuRelease = released.gpu > 0 || hasCompleteGpuAuthority;
    const releasedAuthorities = shouldPlanGpuRelease
      ? releaseStudioGpuPendingAuthorityPrefix({
          authorities: pendingGpuDrawAuthoritiesRef.current,
          requestedGpuStrokeCount: released.gpu,
          availableGpuStrokeCount: pendingGpuStrokesRef.current.length,
          completeElementIds: completeGpuElementIds,
        })
      : null;
    if (releasedAuthorities?.status === "rejected") {
      // Preserve the selected-provider queues and original handoffs. An accounting mismatch cannot
      // authorize migration to Konva; a later canonical retry or document edit may release them.
      return { status: "retained", reason: "gpu-authority-release-rejected" };
    }

    let nextPendingGpuStrokes = pendingGpuStrokesRef.current;
    let acceptedRebaselineRequestId: string | null = null;
    let postContactRemainderBlocksRelease = false;
    if (releasedAuthorities?.status === "released") {
      nextPendingGpuStrokes = pendingGpuStrokesRef.current.slice(
        releasedAuthorities.releasedGpuStrokeCount,
      );
      const handle = webGpuCanvasHandleRef.current;
      const activeGpuPlan = gpuLiveInkPinnedRef.current && drawingRef.current
        ? buildGpuLiveStrokePlan(drawingRef.current)
        : null;
      const nextGpuStrokes = activeGpuPlan
        ? [...nextPendingGpuStrokes, ...activeGpuPlan.strokes]
        : nextPendingGpuStrokes;
      const activeJournal = gpuLiveSourceJournalRef.current;
      const activeDrawing = gpuLiveInkPinnedRef.current ? drawingRef.current : null;
      if (
        activeGpuPlan
        && activeJournal
        && activeDrawing
        && activeGpuPlan.renderedPointCount === activeJournal.renderedPointCount
        && activeGpuLiveSourceJournalMatchesPlan(activeDrawing, activeGpuPlan, activeJournal)
      ) {
        // A settled-prefix release changes operation indices, so pay one bounded rebaseline while
        // preserving the source journal cursor. The next pointer frame remains suffix-only.
        if (!prepareLiveStrokeGpuSubmission(activeDrawing.id)) {
          onSelectedGpuLiveInkUnavailable("request-failed", activeDrawing.id);
          return { status: "retained", reason: "journal-rebaseline-not-prepared" };
        }
        const outcome = handle?.replacePinnedJournalBaseline(nextGpuStrokes);
        if (!outcome || outcome.status === "rejected") {
          onSelectedGpuLiveInkUnavailable("request-failed", activeDrawing.id);
          return { status: "retained", reason: "journal-rebaseline-rejected" };
        }
        acceptedRebaselineRequestId = outcome.requestId;
      } else if (gpuLiveInkPinnedRef.current && activeJournal) {
        // A non-prefix active projection cannot continue under the old operation indices. Cancel
        // that selected-provider operation and retain the original queues; do not switch renderer.
        onSelectedGpuLiveInkUnavailable("request-failed", activeDrawing?.id ?? "active-webgpu-stroke");
        return { status: "retained", reason: "journal-identity-mismatch" };
      } else {
        // Pointer-up sessions cannot issue a new GPU frame by coordinator contract. Keep the whole
        // selected-provider group installed until all of its canonical handoffs can release at once.
        postContactRemainderBlocksRelease = nextGpuStrokes.length > 0;
      }
    }

    if (postContactRemainderBlocksRelease) {
      return { status: "retained", reason: "post-contact-rebaseline-forbidden" };
    }

    // Mutate every visible FIFO only after the selected GPU has accepted its replacement.
    if (
      released.overlay > overlayRenderer.settledStrokeCount
        + retainedMediaOverlayRenderer.settledStrokeCount
        + dynamicBrushOverlayRenderer.settledStrokeCount
      || released.draft > draftPreviewStore.settledCount
    ) {
      // Imperative GPU adapters may synchronously publish receipts while accepting a baseline.
      // Revalidate both canonical FIFOs and retain the entire original graph on mismatch.
      return { status: "retained", reason: "surface-count-before-release" };
    }
    if (acceptedRebaselineRequestId !== null) {
      const activeStrokeId = drawingRef.current?.id;
      if (
        !activeStrokeId
        || !registerLiveStrokeGpuRequest(activeStrokeId, acceptedRebaselineRequestId)
      ) {
        onSelectedGpuLiveInkUnavailable(
          "surface-lost",
          activeStrokeId ?? "active-webgpu-stroke",
        );
        return { status: "retained", reason: "audit-rebaseline-rejected" };
      }
      gpuLiveSourceJournalFirstStrokeIndexRef.current = nextPendingGpuStrokes.length;
      gpuLiveAcceptedRequestIdRef.current = acceptedRebaselineRequestId;
      armGpuPinnedRequestWatchdog(
        acceptedRebaselineRequestId,
        STUDIO_GPU_TERMINAL_RECEIPT_TIMEOUT_MS,
      );
      applyLiveStrokeBackendPresentationEffects();
    }
    const retainedOverlayBudget = Math.max(
      0,
      released.overlay - overlayRenderer.settledStrokeCount,
    );
    const dynamicOverlayBudget = Math.max(
      0,
      retainedOverlayBudget - retainedMediaOverlayRenderer.settledStrokeCount,
    );
    const releasedOverlayCount = overlayRenderer.releaseSettledPrefix(released.overlay)
      + retainedMediaOverlayRenderer.releaseSettledPrefix(retainedOverlayBudget)
      + dynamicBrushOverlayRenderer.releaseSettledPrefix(dynamicOverlayBudget);
    const releasedDraftCount = draftPreviewStore.releaseSettledPrefix(released.draft);
    if (
      releasedOverlayCount !== released.overlay
      || releasedDraftCount !== released.draft
    ) {
      return { status: "retained", reason: "surface-release-mismatch" };
    }

    if (releasedAuthorities?.status === "released") {
      pendingGpuDrawAuthoritiesRef.current = [...releasedAuthorities.remaining];
      pendingGpuStrokesRef.current = nextPendingGpuStrokes;
      if (gpuLingerRafRef.current) globalThis.cancelAnimationFrame(gpuLingerRafRef.current);
      gpuLingerRafRef.current = 0;
      if (acceptedRebaselineRequestId === null) {
        webGpuCanvasHandleRef.current?.setPinnedVisible(false);
      }
    }
    return { status: "released" };
  }

  function scheduleCommittedInkSurfaceHandoffRetry(): void {
    if (committedInkSurfaceHandoffRafRef.current || !editorMountedRef.current) return;
    committedInkSurfaceHandoffRafRef.current = globalThis.requestAnimationFrame(() => {
      committedInkSurfaceHandoffRafRef.current = 0;
      processCommittedInkSurfaceHandoffsRef.current();
    });
  }

  function committedInkRetainedInvariantKey(
    released: StudioCommittedInkSurfaceCounts,
    completeGpuElementIds: ReadonlySet<string>,
    reason: string
  ): string {
    const journal = gpuLiveSourceJournalRef.current;
    return JSON.stringify([
      "studio-committed-ink-retained-v1",
      reason,
      studioRevisionProjectGenerationRef.current,
      committedInkSurfaceHandoffsRef.current[0] ?? null,
      released,
      [...completeGpuElementIds].sort(),
      liveInkOverlayRendererRef.current.settledStrokeCount,
      liveRetainedMediaOverlayRendererRef.current.settledStrokeCount,
      liveDynamicBrushOverlayRendererRef.current.settledStrokeCount,
      draftPreviewStoreRef.current.settledCount,
      pendingGpuStrokesRef.current.map((stroke) => stroke.id),
      pendingGpuDrawAuthoritiesRef.current.map((authority) => [
        authority.element.id,
        authority.gpuStrokeCount,
      ]),
      journal
        ? [journal.revision, journal.renderedPointCount, journal.identity]
        : null,
    ]);
  }

  function scheduleCommittedInkRetainedRetry(
    released: StudioCommittedInkSurfaceCounts,
    completeGpuElementIds: ReadonlySet<string>,
    reason: string
  ): void {
    if (committedInkSurfaceHandoffRafRef.current || !editorMountedRef.current) return;
    const revision = studioRevisionProjectGenerationRef.current;
    const invariantKey = committedInkRetainedInvariantKey(
      released,
      completeGpuElementIds,
      reason
    );
    const plan = planStudioCommittedInkRetainedRetry(
      committedInkRetainedRetryRef.current,
      { invariantKey, revision }
    );
    committedInkRetainedRetryRef.current = plan.state;
    if (plan.status === "schedule") {
      scheduleCommittedInkSurfaceHandoffRetry();
      return;
    }
    const warnedKey = JSON.stringify([invariantKey, revision]);
    if (committedInkRetainedWarnedKeyRef.current === warnedKey) return;
    committedInkRetainedWarnedKeyRef.current = warnedKey;
    console.warn(
      "[studio] committed-ink GPU release stayed retained after bounded recovery — original handoffs and visible authority remain installed until the invariant or scene revision changes.",
      { reason, revision, attempts: plan.state.attempts }
    );
  }

  // 전체 페이지 상태를 직접 커밋하는 헬퍼 (페이지 추가/삭제/이동용)
  function commitPages(
    nextPages: PageState[],
    options: {
      bypassReviewLock?: boolean;
      pendingStrokePolicy?: "preserve" | "drop";
    } = {}
  ): boolean {
    if (!editorMountedRef.current) return false;
    if (nextPages.length === 0 || nextPages.length > STUDIO_PROJECT_MAX_PAGES) {
      setError(`프로젝트는 1–${STUDIO_PROJECT_MAX_PAGES}페이지 범위에서 편집할 수 있어요.`);
      return false;
    }
    const invalidCanvasPage = nextPages.find((page) => (
      !Number.isFinite(page.canvasH) ||
      page.canvasH <= 0 ||
      page.canvasH > STUDIO_PROJECT_MAX_CANVAS_HEIGHT
    ));
    if (invalidCanvasPage) {
      setError(
        `페이지 높이는 1–${STUDIO_PROJECT_MAX_CANVAS_HEIGHT.toLocaleString("ko-KR")}px 범위여야 저장할 수 있어요.`,
      );
      return false;
    }
    if (documentSaveInFlightRef.current) {
      setError("저장 중에는 원고를 변경할 수 없어요. 저장이 끝난 뒤 다시 시도해 주세요.");
      return false;
    }
    if (collaborationAccessRef.current.locked) {
      setError(collaborationLockMessage());
      return false;
    }
    if (drawingRef.current || requireStudioDrawingPointerTransport(drawingPointerTransportRef).getSession()) {
      setError("현재 획을 마친 뒤 페이지 구성을 변경할 수 있어요.");
      return false;
    }
    // Page-level operations can run in the same task as a released deferred stroke. Flush first,
    // then project that exact batch into the caller's stale render-derived page set. Most page
    // operations must preserve the just-finished ink even when they intentionally create a new
    // elements array (dialogue edit, grouping, locale switch, auto action). Explicit clear/delete
    // flows opt out below instead of accidentally classifying every new array as a deletion.
    const pendingBatch = pendingStrokeCommitsRef.current;
    if (pendingBatch && !flushPendingStrokeCommitsRef.current()) {
      setError(
        "마지막 획을 원고에 확정하지 못해 페이지 작업을 실행하지 않았어요. 잠금·동기화 상태를 확인한 뒤 다시 시도해 주세요."
      );
      return false;
    }
    const currentHistory = pagesHistoryRef.current;
    const currentHistoryIndex = Math.max(
      0,
      Math.min(pagesHiRef.current, Math.max(0, currentHistory.length - 1))
    );
    const currentPages = currentHistory[currentHistoryIndex] ?? pages;
    let rebasedNextPages = nextPages;
    if (pendingBatch && options.pendingStrokePolicy !== "drop") {
      rebasedNextPages = projectStudioPendingStrokes(nextPages, {
        pageId: pendingBatch.pageId,
        strokes: pendingBatch.strokes,
      }).pagesList as PageState[];
    }
    const workAssetReason = studioWorkAssetDocumentSourceTransitionReason(
      currentPages,
      rebasedNextPages
    );
    if (workAssetReason) {
      setError(workAssetReason);
      return false;
    }
    setSharedDocumentNotice(null);
    if (!options.bypassReviewLock) {
      const changedLockedPageId = findChangedLockedPageId(currentPages, rebasedNextPages);
      if (changedLockedPageId) {
        setError("잠긴 페이지가 포함된 변경이에요. 페이지 검토에서 잠금을 해제한 뒤 다시 시도해 주세요.");
        return false;
      }
    }
    if (!advancedFillApplyingRef.current) {
      invalidateAdvancedFillWork("문서가 바뀌어 진행 중인 계산과 채우기 미리보기를 취소했습니다.");
    }
    const document = studioCrdtDocumentRef.current;
    let resolvedPages = rebasedNextPages;
    if (document) {
      if (!publishStudioCrdtSceneTransition(currentPages, rebasedNextPages)) return false;
      resolvedPages = mergeStudioCrdtFrontier(rebasedNextPages);
    }
    coalesceKeyRef.current = null;
    const appended = appendStudioPagesHistorySnapshot(
      currentHistory,
      currentHistoryIndex,
      resolvedPages
    );
    recordStudioHistoryTransition({
      mutationKind: "pages.commit",
      previousPages: currentPages,
      nextPages: resolvedPages,
      previousHistoryIndex: currentHistoryIndex,
      nextHistoryIndex: appended.historyIndex,
    });
    pagesHistoryRef.current = appended.history;
    pagesHiRef.current = appended.historyIndex;
    recordStudioHistoryJournalPages(1, appended.historyIndex);
    noteStudioHistoryRetention(appended);
    setPagesHistory(appended.history);
    setPagesHi(appended.historyIndex);
    return true;
  }
  return {
    commit,
    commitCoalesced,
    commitPages,
    expandDeferredStrokeCommitHistory,
    releaseCommittedInkSurfaceCounts,
    scheduleCommittedInkRetainedRetry,
    scheduleCommittedInkSurfaceHandoffRetry,
  };
}
