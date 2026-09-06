/**
 * Semantic Layer Lift 세션 런타임 — 열기/분석 · 경계 보정 · 원자 적용의 3단계와 그
 * 취소(run-id + AbortController) · 미리보기 blob 자원 수명을 한곳에 모은다.
 *
 * StudioPage.tsx 에서 그대로 옮겨온 클로저다. 팩토리는 훅도 컴포넌트도 아니라
 * react-compiler 컴파일 경계 밖이며, 이 렌더의 값·ref·헬퍼를 주입받아 추출 전과 동일한
 * 클로저를 만든다. 늦게 선언되는 바인딩(`commit`)은 TDZ 를 피하려고 thunk 로 받는다.
 */

import { uid } from "../studio-id";
import { closedStudioLayerLiftUiState } from "../studio-page-shell-runtime";
import { resolveStudioWorkAssetReadableImageSource } from "../studio-work-asset-render-projection";

import { inspectStudioLayerLiftAvailability } from "./studio-layer-lift-availability";
import {
  applyStudioLayerLiftCorrectionWorkflow,
} from "./studio-layer-lift-correction-workflow";
import { createStudioLayerLiftReviewPreviewResource } from "./studio-layer-lift-review-preview";
import {
  analyzeStudioLayerLiftWorkflow,
  finalizeStudioLayerLiftWorkflow,
} from "./studio-layer-lift-workflow";

import type {
  StudioEditorMutationState,
  StudioEditorMutationTicket,
} from "../studio-editor-scope";
import type { El } from "../studio-element-model";
import type { GroupSelectionState } from "../studio-group-selection";
import type { LayerGroup } from "../studio-layers";
import type { StudioLayerLiftUiState } from "../studio-page-shell-runtime";
import type { PageState } from "../studio-page-state";
import type { StudioWorkAssetHydrator } from "../studio-work-asset-hydrator";
import type { StudioLayerLiftAvailabilityInput } from "./studio-layer-lift-availability";
import type { StudioLayerLiftComposeWorkerClient } from "./studio-layer-lift-compose-worker-client";
import type { StudioLayerLiftCorrectionStroke } from "./studio-layer-lift-correction";
import type { createStudioLayerLiftLocalForegroundProvider } from "./studio-layer-lift-local-provider";
import type {
  StudioLayerLiftOperationCurrentState,
  StudioLayerLiftOperationRegistry,
} from "./studio-layer-lift-operation-context";
import type { StudioLayerLiftReviewPreviewResource } from "./studio-layer-lift-review-preview";
import type { StudioLayerLiftReviewOptions } from "./StudioLayerLiftDialog";
import type { Dispatch, SetStateAction } from "react";

/** 렌더마다 계산되는 진입 차단 사유. 잠금·재생·저장 게이트가 가용성 검사보다 앞선다. */
export interface StudioLayerLiftDisabledReasonInput {
  readonly elements: readonly El[];
  readonly groups: readonly LayerGroup[];
  readonly selectedIds: readonly string[];
  readonly workId: string | null;
  readonly collaborationDocumentLocked: boolean;
  readonly collaborationLockMessage: () => string;
  readonly activeSurfaceReviewLocked: boolean;
  readonly pageEditLocked: boolean;
  readonly masterEditMode: boolean;
  readonly timelinePlaying: boolean;
  readonly timelapseCapturing: boolean;
  readonly saving: boolean;
}

export function resolveStudioLayerLiftDisabledReason(
  input: StudioLayerLiftDisabledReasonInput,
): string | null {
  const {
    elements,
    groups,
    selectedIds,
    workId,
    collaborationDocumentLocked,
    collaborationLockMessage,
    activeSurfaceReviewLocked,
    pageEditLocked,
    masterEditMode,
    timelinePlaying,
    timelapseCapturing,
    saving,
  } = input;
  const studioLayerLiftAvailability = inspectStudioLayerLiftAvailability({
    elements,
    groups,
    selectedIds,
  });
  return workId
    ? "저장된 팀 원고용 에셋 트랜잭션을 연결하는 중입니다. 현재 베타는 새 로컬 원고에서 사용할 수 있어요."
    : collaborationDocumentLocked
      ? collaborationLockMessage()
      : activeSurfaceReviewLocked || (pageEditLocked && !masterEditMode)
        ? "작업면 검토 잠금을 해제한 뒤 레이어를 복원하세요."
        : masterEditMode
          ? "현재 베타는 페이지 이미지 레이어에서만 사용할 수 있어요. 마스터 편집을 종료해 주세요."
          : timelinePlaying
            ? "타임라인 재생을 멈춘 뒤 레이어를 복원하세요."
            : timelapseCapturing
              ? "타임랩스 캡처가 끝난 뒤 레이어를 복원하세요."
              : saving
                ? "저장이 끝난 뒤 레이어를 복원하세요."
                : studioLayerLiftAvailability.available
                  ? null
                  : studioLayerLiftAvailability.message;
}

export interface StudioLayerLiftSessionContext {
  /** 읽기 전용 권위 ref — 비동기 단계마다 최신 문서/선택/마운트 상태를 다시 읽는다. */
  readonly activeElementsRef: { readonly current: readonly El[] };
  readonly activeGroupsRef: { readonly current: readonly LayerGroup[] };
  readonly collaborationAccessRef: {
    readonly current: Omit<StudioEditorMutationState, "mounted" | "aborted">;
  };
  readonly currentPageIdRef: { readonly current: string };
  readonly editorMountedRef: { readonly current: boolean };
  readonly masterEditModeRef: { readonly current: boolean };
  readonly selectedIdRef: { readonly current: string | null };
  readonly studioLayerLiftCompositorRef: {
    readonly current: StudioLayerLiftComposeWorkerClient | null;
  };
  readonly studioLayerLiftProviderRef: {
    readonly current:
      | ReturnType<typeof createStudioLayerLiftLocalForegroundProvider>
      | null;
  };
  readonly studioLayerLiftRegistryRef: {
    readonly current: StudioLayerLiftOperationRegistry | null;
  };
  readonly studioLayerLiftUiRef: { readonly current: StudioLayerLiftUiState };
  /** 세션이 직접 소유하는 취소/자원 ref — 여기서만 쓰기가 일어난다. */
  readonly studioLayerLiftAbortRef: { current: AbortController | null };
  readonly studioLayerLiftPreviewResourceRef: {
    current: StudioLayerLiftReviewPreviewResource | null;
  };
  readonly studioLayerLiftRunIdRef: { current: number };
  readonly announceDrawingShortcut: (message: string) => void;
  readonly applyGroupSelectionState: (next: GroupSelectionState) => void;
  readonly captureStudioMutationTicket: () => StudioEditorMutationTicket;
  /** 컴포넌트에서 늦게 선언되는 커밋 엔진 — TDZ 회피용 thunk. */
  readonly commit: (
    nextElements: El[],
    extraPatch?: Partial<Omit<PageState, "id" | "elements">>,
    targetPageId?: string,
  ) => boolean;
  readonly currentCanvasSelectionIds: () => string[];
  readonly setError: (message: string | null) => void;
  readonly setStudioLayerLiftUi: Dispatch<SetStateAction<StudioLayerLiftUiState>>;
  readonly studioLayerLiftDisabledReason: string | null;
  readonly studioLayerLiftOptions: StudioLayerLiftReviewOptions;
  readonly studioWorkAssetHydrator: StudioWorkAssetHydrator;
}

export interface StudioLayerLiftSession {
  readonly applyStudioLayerLift: () => Promise<void>;
  readonly closeStudioLayerLift: () => void;
  readonly correctStudioLayerLift: (
    stroke: StudioLayerLiftCorrectionStroke,
  ) => Promise<void>;
  readonly currentStudioLayerLiftAvailabilityInput: () => StudioLayerLiftAvailabilityInput;
  readonly openStudioLayerLift: () => void;
  readonly readCurrentStudioLayerLiftOperation: () => StudioLayerLiftOperationCurrentState;
  readonly replaceStudioLayerLiftPreviewResource: (
    next: StudioLayerLiftReviewPreviewResource | null,
  ) => void;
  readonly runStudioLayerLiftAnalysis: (
    sourceId: string,
    options: StudioLayerLiftReviewOptions,
  ) => Promise<void>;
}

export function createStudioLayerLiftSession(
  ctx: StudioLayerLiftSessionContext,
): StudioLayerLiftSession {
  const {
    activeElementsRef,
    activeGroupsRef,
    announceDrawingShortcut,
    applyGroupSelectionState,
    captureStudioMutationTicket,
    collaborationAccessRef,
    commit,
    currentCanvasSelectionIds,
    currentPageIdRef,
    editorMountedRef,
    masterEditModeRef,
    selectedIdRef,
    setError,
    setStudioLayerLiftUi,
    studioLayerLiftAbortRef,
    studioLayerLiftCompositorRef,
    studioLayerLiftDisabledReason,
    studioLayerLiftOptions,
    studioLayerLiftPreviewResourceRef,
    studioLayerLiftProviderRef,
    studioLayerLiftRegistryRef,
    studioLayerLiftRunIdRef,
    studioLayerLiftUiRef,
    studioWorkAssetHydrator,
  } = ctx;

  function currentStudioLayerLiftAvailabilityInput() {
    return {
      elements: activeElementsRef.current,
      groups: activeGroupsRef.current,
      selectedIds: currentCanvasSelectionIds(),
    };
  }
  function readCurrentStudioLayerLiftOperation():
    StudioLayerLiftOperationCurrentState {
    const collaboration = collaborationAccessRef.current;
    return {
      mutationState: {
        ...collaboration,
        mounted: editorMountedRef.current,
        aborted: false,
      },
      pageId: currentPageIdRef.current,
      masterEditMode: masterEditModeRef.current,
      selectedIds: currentCanvasSelectionIds(),
      elements: activeElementsRef.current,
      groups: activeGroupsRef.current,
    };
  }
  function replaceStudioLayerLiftPreviewResource(
    next: StudioLayerLiftReviewPreviewResource | null,
  ) {
    const previous = studioLayerLiftPreviewResourceRef.current;
    if (previous === next) return;
    studioLayerLiftPreviewResourceRef.current = next;
    previous?.revoke();
  }
  function closeStudioLayerLift() {
    studioLayerLiftRunIdRef.current += 1;
    studioLayerLiftAbortRef.current?.abort();
    studioLayerLiftAbortRef.current = null;
    studioLayerLiftRegistryRef.current?.invalidate();
    replaceStudioLayerLiftPreviewResource(null);
    setStudioLayerLiftUi(closedStudioLayerLiftUiState());
  }
  async function runStudioLayerLiftAnalysis(
    sourceId: string,
    options: StudioLayerLiftReviewOptions,
  ) {
    const source = activeElementsRef.current.find(
      (element) => element.id === sourceId,
    );
    if (!source || source.type !== "image") {
      setStudioLayerLiftUi((current) => ({
        ...current,
        phase: "error",
        progressLabel: null,
        error: "분리할 이미지가 현재 페이지에 없습니다.",
        session: null,
        preview: null,
      }));
      return;
    }
    const registry = studioLayerLiftRegistryRef.current;
    const provider = studioLayerLiftProviderRef.current;
    const compositor = studioLayerLiftCompositorRef.current;
    if (!registry || !provider || !compositor) {
      setStudioLayerLiftUi((current) => ({
        ...current,
        phase: "error",
        progressLabel: null,
        error: "로컬 레이어 분석 엔진을 준비하지 못했습니다.",
      }));
      return;
    }

    studioLayerLiftRunIdRef.current += 1;
    const runId = studioLayerLiftRunIdRef.current;
    studioLayerLiftAbortRef.current?.abort();
    registry.invalidate();
    replaceStudioLayerLiftPreviewResource(null);
    const controller = new AbortController();
    studioLayerLiftAbortRef.current = controller;
    const requestId = `layer-lift-${uid()}`;
    const sourceName = source.name?.trim() || "선택 이미지";
    const readableSource =
      resolveStudioWorkAssetReadableImageSource(
        source,
        (reference) => studioWorkAssetHydrator.get(reference),
      ) ?? source.src;
    setStudioLayerLiftUi({
      open: true,
      activeKey: requestId,
      sourceId,
      sourceName,
      sourceSrc: readableSource,
      phase: "analyzing",
      progressLabel: "원본 외형을 고정하고 로컬 인물 모델을 준비하고 있어요.",
      error: null,
      session: null,
      preview: null,
    });

    const result = await analyzeStudioLayerLiftWorkflow({
      registry,
      mutationTicket: captureStudioMutationTicket(),
      pageId: currentPageIdRef.current,
      masterEditMode: masterEditModeRef.current,
      availability: currentStudioLayerLiftAvailabilityInput(),
      readAvailability: currentStudioLayerLiftAvailabilityInput,
      readCurrent: readCurrentStudioLayerLiftOperation,
      requestId,
      backgroundOutputId: uid(),
      foregroundOutputId: uid(),
      provider,
      compositor,
      providerOptions: options,
      compositorTimeoutMs: 45_000,
      signal: controller.signal,
    });
    if (
      controller.signal.aborted
      || runId !== studioLayerLiftRunIdRef.current
      || !editorMountedRef.current
    ) {
      return;
    }
    if (!result.ok) {
      studioLayerLiftAbortRef.current = null;
      setStudioLayerLiftUi((current) => ({
        ...current,
        phase: "error",
        progressLabel: null,
        error: result.message,
        session: null,
        preview: null,
      }));
      return;
    }
    setStudioLayerLiftUi((current) => ({
      ...current,
      phase: "analyzing",
      progressLabel: "검증된 픽셀로 비교 미리보기를 만들고 있어요.",
      error: null,
      session: result.session,
      preview: null,
    }));
    let previewResource: StudioLayerLiftReviewPreviewResource;
    try {
      previewResource = await createStudioLayerLiftReviewPreviewResource(
        result.session,
        { signal: controller.signal },
      );
    } catch (previewError) {
      if (
        controller.signal.aborted
        || runId !== studioLayerLiftRunIdRef.current
        || !editorMountedRef.current
      ) {
        return;
      }
      studioLayerLiftAbortRef.current = null;
      registry.invalidate(result.session.ticket);
      setStudioLayerLiftUi((current) => ({
        ...current,
        phase: "error",
        progressLabel: null,
        error: previewError instanceof Error
          ? previewError.message
          : "레이어 분리 비교 미리보기를 만들지 못했습니다.",
        session: null,
        preview: null,
      }));
      return;
    }
    if (
      controller.signal.aborted
      || runId !== studioLayerLiftRunIdRef.current
      || !editorMountedRef.current
    ) {
      previewResource.revoke();
      return;
    }
    studioLayerLiftAbortRef.current = null;
    replaceStudioLayerLiftPreviewResource(previewResource);
    setStudioLayerLiftUi((current) => ({
      ...current,
      phase: "review",
      progressLabel: "경계와 복원 배경을 확인한 뒤 적용하세요.",
      error: null,
      session: result.session,
      preview: previewResource.preview,
    }));
  }
  function openStudioLayerLift() {
    if (studioLayerLiftDisabledReason) {
      setError(studioLayerLiftDisabledReason);
      return;
    }
    const source = activeElementsRef.current.find(
      (element) => element.id === selectedIdRef.current,
    );
    if (!source || source.type !== "image") {
      setError("분리할 이미지 레이어 하나를 선택해 주세요.");
      return;
    }
    void runStudioLayerLiftAnalysis(source.id, studioLayerLiftOptions);
  }
  async function correctStudioLayerLift(
    stroke: StudioLayerLiftCorrectionStroke,
  ) {
    const current = studioLayerLiftUiRef.current;
    const registry = studioLayerLiftRegistryRef.current;
    const compositor = studioLayerLiftCompositorRef.current;
    if (!current.session || !registry || !compositor) {
      setStudioLayerLiftUi((state) => ({
        ...state,
        phase: "error",
        progressLabel: null,
        error: "보정할 레이어 경계가 없습니다. 다시 분석해 주세요.",
      }));
      return;
    }
    const operationState = readCurrentStudioLayerLiftOperation();
    if (!registry.checkCurrent(current.session.ticket, operationState).ok) {
      setStudioLayerLiftUi((state) => ({
        ...state,
        phase: "error",
        progressLabel: null,
        error: "원고나 선택이 바뀌어 이전 경계를 보정하지 않았습니다. 다시 분석해 주세요.",
      }));
      return;
    }

    studioLayerLiftRunIdRef.current += 1;
    const runId = studioLayerLiftRunIdRef.current;
    studioLayerLiftAbortRef.current?.abort();
    const controller = new AbortController();
    studioLayerLiftAbortRef.current = controller;
    setStudioLayerLiftUi((state) => ({
      ...state,
      phase: "analyzing",
      progressLabel: "작가가 고친 경계로 배경·전경을 다시 합성하고 있어요.",
      error: null,
    }));

    const corrected = await applyStudioLayerLiftCorrectionWorkflow({
      session: current.session,
      stroke,
      compositor,
      signal: controller.signal,
      timeoutMs: 45_000,
    });
    if (
      controller.signal.aborted
      || runId !== studioLayerLiftRunIdRef.current
      || !editorMountedRef.current
    ) {
      return;
    }
    if (!corrected.ok) {
      studioLayerLiftAbortRef.current = null;
      setStudioLayerLiftUi((state) => ({
        ...state,
        phase: "error",
        progressLabel: null,
        error: corrected.message,
      }));
      return;
    }
    if (!registry.checkCurrent(corrected.session.ticket, readCurrentStudioLayerLiftOperation()).ok) {
      studioLayerLiftAbortRef.current = null;
      setStudioLayerLiftUi((state) => ({
        ...state,
        phase: "error",
        progressLabel: null,
        error: "재합성 중 원고나 선택이 바뀌어 보정 결과를 버렸습니다.",
      }));
      return;
    }
    if (!corrected.recomposed) {
      studioLayerLiftAbortRef.current = null;
      setStudioLayerLiftUi((state) => ({
        ...state,
        phase: "review",
        progressLabel: "경계가 바뀌지 않아 현재 미리보기를 유지했어요.",
        error: null,
      }));
      return;
    }

    let previewResource: StudioLayerLiftReviewPreviewResource;
    try {
      previewResource = await createStudioLayerLiftReviewPreviewResource(
        corrected.session,
        { signal: controller.signal },
      );
    } catch (previewError) {
      if (
        controller.signal.aborted
        || runId !== studioLayerLiftRunIdRef.current
        || !editorMountedRef.current
      ) {
        return;
      }
      studioLayerLiftAbortRef.current = null;
      setStudioLayerLiftUi((state) => ({
        ...state,
        phase: "error",
        progressLabel: null,
        error: previewError instanceof Error
          ? previewError.message
          : "보정된 레이어 미리보기를 만들지 못했습니다.",
      }));
      return;
    }
    if (
      controller.signal.aborted
      || runId !== studioLayerLiftRunIdRef.current
      || !editorMountedRef.current
      || !registry.checkCurrent(
        corrected.session.ticket,
        readCurrentStudioLayerLiftOperation(),
      ).ok
    ) {
      previewResource.revoke();
      return;
    }
    studioLayerLiftAbortRef.current = null;
    replaceStudioLayerLiftPreviewResource(previewResource);
    setStudioLayerLiftUi((state) => ({
      ...state,
      phase: "review",
      progressLabel: `${corrected.changedPixelCount.toLocaleString("ko-KR")}픽셀의 경계를 다시 합성했어요.`,
      error: null,
      session: corrected.session,
      preview: previewResource.preview,
    }));
  }
  async function applyStudioLayerLift() {
    const current = studioLayerLiftUiRef.current;
    const registry = studioLayerLiftRegistryRef.current;
    if (!current.session || !registry) {
      setStudioLayerLiftUi((state) => ({
        ...state,
        phase: "error",
        progressLabel: null,
        error: "적용할 레이어 복원 미리보기가 없습니다. 다시 분석해 주세요.",
      }));
      return;
    }
    studioLayerLiftRunIdRef.current += 1;
    const runId = studioLayerLiftRunIdRef.current;
    setStudioLayerLiftUi((state) => ({
      ...state,
      phase: "applying",
      progressLabel: "검증된 배경·전경을 한 번의 실행 취소 단계로 묶고 있어요.",
      error: null,
    }));

    const finalized = await finalizeStudioLayerLiftWorkflow({
      registry,
      session: current.session,
      readCurrent: readCurrentStudioLayerLiftOperation,
      groupId: uid(),
    });
    if (
      runId !== studioLayerLiftRunIdRef.current
      || !editorMountedRef.current
    ) {
      return;
    }
    if (!finalized.ok) {
      setStudioLayerLiftUi((state) => ({
        ...state,
        phase: "error",
        progressLabel: null,
        error: finalized.message,
      }));
      return;
    }
    const committed = commit(
      finalized.plan.nextElements,
      { groups: finalized.plan.nextGroups },
      currentPageIdRef.current,
    );
    if (!committed) {
      setStudioLayerLiftUi((state) => ({
        ...state,
        phase: "error",
        progressLabel: null,
        error: "원고 상태가 바뀌어 레이어 그룹을 적용하지 못했습니다. 다시 분석해 주세요.",
        session: null,
      }));
      return;
    }
    applyGroupSelectionState({
      selectedId: finalized.plan.selectedId,
      marqueeIds: [],
      activeGroupId: null,
    });
    closeStudioLayerLift();
    announceDrawingShortcut(
      "컷 레이어 복원 완료 · 원본 백업, 분리 배경, 분리 전경 · 실행 취소 1회"
    );
  }

  return {
    applyStudioLayerLift,
    closeStudioLayerLift,
    correctStudioLayerLift,
    currentStudioLayerLiftAvailabilityInput,
    openStudioLayerLift,
    readCurrentStudioLayerLiftOperation,
    replaceStudioLayerLiftPreviewResource,
    runStudioLayerLiftAnalysis,
  };
}
