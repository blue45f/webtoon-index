/* Extracted render tree from StudioCuttoonEditor.
 * Session props are an `any` bag matching the original editor closure. */
// @ts-nocheck
"use no memo";
// React Compiler 옵트아웃: 가변 호스트 백(h) 을 렌더마다 재대입해 공유하는 추출 패턴이라,
// 컴파일러가 h 참조 동일성만 보고 JSX/계산을 캐시하면 첫 렌더에서 UI 가 영구 동결된다
// (탭 전환 등 커밋된 상태 변경이 화면에 반영되지 않음).
import { Suspense } from "react";
import { isEffectivelyLocked } from "../studio-layers";
import { createStudioPixelEditCanvas, encodeStudioPixelEditResultPng, loadStudioPixelEditImage } from "../studio-legacy-editor-runtime-helpers";
import { StudioFilterDialog, StudioLayerLiftDialog } from "../studio-page-lazy-ui";
import { commitStudioSelectionFilterMaskTransaction } from "../studio-selection-filter-mask-transaction";
import type { El, ImageEl } from "../studio-element-model";
import type { StudioCuttoonEditorViewSession } from "./StudioCuttoonEditorViewSession";

export function StudioCuttoonEditorSessionDialogs(s: StudioCuttoonEditorViewSession) {
  const {
    activeSurfaceReviewLocked,
    announceDrawingShortcut,
    applyStudioLayerLift,
    canApplyStudioMutation,
    captureStudioMutationTicket,
    closeStudioFilterDialog,
    closeStudioLayerLift,
    commit,
    correctStudioLayerLift,
    currentPageIdRef,
    currentStudioFilterPageRasterContext,
    elementById,
    groups,
    isLatestLayerContentMutationLocked,
    pagesHiRef,
    patchEl,
    runStudioLayerLiftAnalysis,
    setError,
    setLastStudioFilterDraft,
    setMarqueeIds,
    setSelectedId,
    setStudioFilterApplying,
    setStudioFilterPreview,
    setStudioFilterSession,
    setStudioLayerLiftOptions,
    setTool,
    studioFilterApplyBusyRef,
    studioFilterApplying,
    studioFilterDialogImage,
    studioFilterDialogMutationLockReason,
    studioFilterDialogMutationLocked,
    studioFilterSession,
    studioFilterSessionIdRef,
    studioLayerLiftDisabledReason,
    studioLayerLiftOptions,
    studioLayerLiftUi,
    studioLayerLiftUiRef,
    studioRootRef,
  } = s;
  return (
    <>
      {studioFilterSession && studioFilterDialogImage?.type === "image" ? (
        <Suspense fallback={null}>
          <StudioFilterDialog
            key={studioFilterSession.id}
            activeKey={`filter:${studioFilterSession.id}`}
            kind={studioFilterSession.kind}
            image={studioFilterDialogImage}
            imageSrc={studioFilterDialogImage.src}
            targetKind={studioFilterSession.target}
            {...(studioFilterSession.initialDraft
              ? { initialDraft: studioFilterSession.initialDraft }
              : {})}
            rootRef={studioRootRef}
            mutationLocked={studioFilterDialogMutationLocked}
            {...(studioFilterDialogMutationLockReason
              ? { mutationLockReason: studioFilterDialogMutationLockReason }
              : {})}
            applying={studioFilterApplying}
            selectionAvailable={
              studioFilterSession.target === "image" && !!studioFilterSession.selection
            }
            selectionFeatherPx={
              studioFilterSession.target === "image"
                ? studioFilterSession.selection?.featherPx
                : undefined
            }
            selectionInverted={
              studioFilterSession.target === "image"
                ? studioFilterSession.selection?.invert
                : undefined
            }
            onPreview={(patch) => {
              setStudioFilterPreview(
                patch
                  ? { elementId: studioFilterSession.elementId, patch }
                  : null,
              );
            }}
            onApply={async (patch, draft, applicationScope) => {
              if (studioFilterApplyBusyRef.current) return;
              if (studioFilterSession.target === "image") {
                if (applicationScope === "whole") {
                  if (!patchEl(studioFilterSession.elementId, patch as Partial<El>)) return;
                  setStudioFilterPreview(null);
                  setLastStudioFilterDraft(draft);
                  setStudioFilterApplying(false);
                  setStudioFilterSession(null);
                  return;
                }
                const selection = studioFilterSession.selection;
                if (!selection) {
                  setError("필터를 적용할 픽셀 영역을 먼저 선택하세요.");
                  return;
                }
                const target = elementById.get(studioFilterSession.elementId);
                if (!target || target.type !== "image") {
                  setError("필터 대상 이미지가 현재 페이지에 없습니다. 다시 선택해 주세요.");
                  return;
                }
                const applySessionId = studioFilterSession.id;
                const mutationTicket = captureStudioMutationTicket();
                studioFilterApplyBusyRef.current = true;
                setStudioFilterApplying(true);
                try {
                  const source = await loadStudioPixelEditImage(target.src);
                  if (
                    applySessionId !== studioFilterSessionIdRef.current
                    || !canApplyStudioMutation(mutationTicket)
                    || isLatestLayerContentMutationLocked(target.id)
                  ) return;
                  const { createStudioSelectionFilterMaskTransactionAsync } = await import("../studio-selection-filter-mask-transaction"
                  );
                  const result = await createStudioSelectionFilterMaskTransactionAsync({
                    target,
                    selection,
                    scope: applicationScope,
                    imageWidth: source.naturalWidth || source.width,
                    imageHeight: source.naturalHeight || source.height,
                    filterPatch: patch,
                    createCanvas: createStudioPixelEditCanvas,
                    serializeMask: async (mask) =>
                      encodeStudioPixelEditResultPng(mask as HTMLCanvasElement),
                    mutationLocked:
                      activeSurfaceReviewLocked || isEffectivelyLocked(target, groups),
                  });
                  if (!result.ok) {
                    setError(result.message);
                    return;
                  }
                  const committed = commitStudioSelectionFilterMaskTransaction(
                    result.transaction,
                    (transaction) => patchEl(
                      transaction.targetId,
                      transaction.patch as Partial<El>,
                    ),
                  );
                  if (!committed) return;
                  setStudioFilterPreview(null);
                  setLastStudioFilterDraft(draft);
                  setError(null);
                  setStudioFilterSession(null);
                  announceDrawingShortcut(
                    applicationScope === "inside"
                      ? "필터를 선택 안에 적용하고 마스크로 저장했어요"
                      : "필터를 선택 밖에 적용하고 마스크로 저장했어요",
                  );
                } catch (selectionFilterError) {
                  setError(
                    selectionFilterError instanceof Error
                      ? selectionFilterError.message
                      : "선택 영역 필터 마스크를 만들지 못했습니다.",
                  );
                } finally {
                  if (applySessionId === studioFilterSessionIdRef.current) {
                    studioFilterApplyBusyRef.current = false;
                    setStudioFilterApplying(false);
                  }
                }
                return;
              }
              studioFilterApplyBusyRef.current = true;
              setStudioFilterApplying(true);
              const applySessionId = studioFilterSession.id;
              try {
                if (
                  applySessionId !== studioFilterSessionIdRef.current ||
                  studioFilterSession.pageId !== currentPageIdRef.current ||
                  studioFilterSession.historyIndex !== pagesHiRef.current ||
                  !canApplyStudioMutation(studioFilterSession.mutationTicket)
                ) {
                  closeStudioFilterDialog();
                  return;
                }
                const rasterRuntime = await import("../render/studio-raster-edit-preparation");
                if (applySessionId !== studioFilterSessionIdRef.current) return;
                const currentContext = currentStudioFilterPageRasterContext(
                  studioFilterSession.plan.name,
                  rasterRuntime,
                );
                const composite = {
                  ...studioFilterSession.image,
                  ...patch,
                  locked: false,
                  noClip: true,
                } as ImageEl & El;
                const applied = rasterRuntime.applyStudioEditableRasterCopy({
                  plan: studioFilterSession.plan,
                  current: currentContext.input,
                  composite,
                  destinationElements: currentContext.destinationElements,
                });
                if (!applied.ok) {
                  setError(applied.reason);
                  closeStudioFilterDialog();
                  return;
                }
                if (
                  applySessionId !== studioFilterSessionIdRef.current ||
                  studioFilterSession.pageId !== currentPageIdRef.current ||
                  studioFilterSession.historyIndex !== pagesHiRef.current ||
                  !canApplyStudioMutation(studioFilterSession.mutationTicket)
                ) {
                  closeStudioFilterDialog();
                  return;
                }
                if (!commit(applied.elements, undefined, studioFilterSession.pageId)) return;
                setMarqueeIds([]);
                setSelectedId(composite.id);
                setTool("select");
                setStudioFilterPreview(null);
                setLastStudioFilterDraft(draft);
                setStudioFilterSession(null);
                setError(null);
                announceDrawingShortcut("원본을 보존한 페이지 필터 레이어를 추가했어요");
              } catch (filterApplyError) {
                setError(
                  filterApplyError instanceof Error
                    ? filterApplyError.message
                    : "페이지 필터 레이어를 적용하지 못했습니다."
                );
              } finally {
                if (applySessionId === studioFilterSessionIdRef.current) {
                  studioFilterApplyBusyRef.current = false;
                  setStudioFilterApplying(false);
                }
              }
            }}
            onClose={closeStudioFilterDialog}
          />
        </Suspense>
      ) : null}

      {studioLayerLiftUi.open ? (
        <Suspense fallback={null}>
          <StudioLayerLiftDialog
            open
            activeKey={studioLayerLiftUi.activeKey}
            sourceName={studioLayerLiftUi.sourceName}
            sourceSrc={studioLayerLiftUi.sourceSrc}
            phase={studioLayerLiftUi.phase}
            progressLabel={studioLayerLiftUi.progressLabel}
            error={studioLayerLiftUi.error}
            preview={studioLayerLiftUi.preview}
            options={studioLayerLiftOptions}
            mutationLocked={studioLayerLiftDisabledReason !== null}
            mutationLockReason={studioLayerLiftDisabledReason}
            onOptionsChange={setStudioLayerLiftOptions}
            onAnalyze={() => {
              const sourceId = studioLayerLiftUiRef.current.sourceId;
              if (sourceId) {
                void runStudioLayerLiftAnalysis(
                  sourceId,
                  studioLayerLiftOptions,
                );
              }
            }}
            onCorrectionCommit={correctStudioLayerLift}
            onApply={() => void applyStudioLayerLift()}
            onCancel={closeStudioLayerLift}
          />
        </Suspense>
      ) : null}
    </>
  );
}
