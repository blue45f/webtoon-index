/* Extracted render tree from StudioCuttoonEditor.
 * Session props are an `any` bag matching the original editor closure. */
// @ts-nocheck
"use no memo";
// React Compiler 옵트아웃: 가변 호스트 백(h) 을 렌더마다 재대입해 공유하는 추출 패턴이라,
// 컴파일러가 h 참조 동일성만 보고 JSX/계산을 캐시하면 첫 렌더에서 UI 가 영구 동결된다
// (탭 전환 등 커밋된 상태 변경이 화면에 반영되지 않음).
import { Undo2 } from "lucide-react";
import { Suspense } from "react";
import { StudioHybridDccRouteGate } from "../hybrid-dcc/StudioHybridDccRouteGate";
import { STUDIO_ICON_SIZE, STUDIO_ICON_STROKE, studioChromeIconClass } from "../studio-chrome-ui";
import { STUDIO_INTERCHANGE_IMPORT_PLACEMENT_CHOICES, STUDIO_WILL_V1_IMPORT_PLACEMENT_CHOICES } from "../studio-page-editor-runtime-contracts";
import {
  LazyStudioAnimaticTimelineDialog,
  LazyStudioAssetRightsAuditDialog,
  LazyStudioHybridDccDialog,
  LazyStudioInterchangeLossPreviewDialog,
  LazyStudioProductionBibleWorkspace,
  LazyStudioQuickAccessSurface,
  LazyStudioQuickComicWizard,
  LazyStudioSceneSnapshotDialog,
} from "../studio-page-modal-lazy-boundaries";
import { STUDIO_PROJECT_MAX_PAGES } from "../studio-project-file";
import { StudioSurfaceErrorBoundary } from "../StudioSurfaceErrorBoundary";
import type { StudioCuttoonEditorViewSession } from "./StudioCuttoonEditorViewSession";

export function StudioCuttoonEditorDialogs(s: StudioCuttoonEditorViewSession) {
  const {
    activePage,
    animaticTimelineOpen,
    announceDrawingShortcut,
    appSettings,
    applyPendingInterchangeImport,
    applyQuickComicInput,
    applySceneSnapshot,
    assetRightsAuditOpen,
    bg3dDccShotMappingsRef,
    bg3dDccSourceRef,
    brushUndoButtonRef,
    brushUndoToastRef,
    changeStudioQuickAccessState,
    changeStudioSymmetryType,
    characterBible,

    dismissPendingInterchangeImport,
    document,
    effectiveWorkId,
    executeStudioQuickAccessCommand,
    hybridDccOpen,
    hybridDccPersistenceReceipt,
    hybridDccPersistenceStatus,
    hybridDccReturnFocusRef,
    hybridDccRouteAccess,
    hybridDccRouteRequested,
    hybridDccWorkspaceDocumentId,
    hybridDccWorkspaceScope,
    insertStudioStickyNote,
    interchangeImportBusy,
    interchangeImportChoice,
    isMobile,
    mobileKeyboardInset,
    openHybridDccWorkspace,
    pages,
    pendingBrushDelete,
    pendingBrushDeletes,
    pendingInterchangeImport,
    pixelArtMode,
    productionBibleAssetOptions,
    productionBibleOpen,
    quickAccessCatalog,
    quickAccessIntegration,
    quickAccessPaletteOpen,
    quickAccessState,
    quickComicOpen,
    sceneSnapshotOpen,
    scheduleHybridDccWorkspacePersistence,
    scopedHybridDccWorkspace,
    session,
    setAnimaticTimelineOpen,
    setAssetRightsAuditOpen,
    setBg3dInitialDataUrl,
    setBg3dInitialElementId,
    setBg3dInitialScene,
    setBg3dOpen,

    setHybridDccOpen,
    setHybridDccWorkbenchMode,
    setHybridDccWorkspaceState,
    setInterchangeImportChoice,
    setPausedBrushDeleteId,
    setPixelArtMode,
    setProductionBibleOpen,
    setQuickAccessPaletteOpen,
    setQuickComicOpen,
    setSceneSnapshotOpen,
    setSilkGenerativeSpec,
    setSymmetryRadialCount,
    setWillImportChoice,
    silkGenerativeSpec,
    studioAuthUserId,
    undoBrushDelete,
    webtoonTheme,
    willImportChoice,
    workId,
    studioRoute,
  } = s;
  return (
    <>
    {quickAccessPaletteOpen && quickAccessState && quickAccessIntegration ? (
      <Suspense
        fallback={(
          <div
            role="status"
            aria-live="polite"
            className="fixed right-3 top-16 z-[70] rounded-lg border border-line bg-panel px-3 py-2 text-xs font-semibold text-fg shadow-lg"
          >
            빠른 액세스를 여는 중…
          </div>
        )}
      >
        <LazyStudioQuickAccessSurface
          state={quickAccessState}
          catalog={quickAccessCatalog}
          isMobile={isMobile}
          onStateChange={changeStudioQuickAccessState}
          onExecute={executeStudioQuickAccessCommand}
          onClose={() => setQuickAccessPaletteOpen(false)}
        />
      </Suspense>
    ) : null}
    {quickComicOpen ? (
      <Suspense
        fallback={(
          <div
            className="fixed inset-0 z-[110] grid place-items-center bg-canvas/80 p-4 text-sm font-semibold text-fg"
            role="status"
            aria-live="polite"
          >
            빠른 웹툰 조립 화면을 여는 중…
          </div>
        )}
      >
        <LazyStudioQuickComicWizard
          onApply={(input) => void applyQuickComicInput(input)}
          onCancel={() => setQuickComicOpen(false)}
        />
      </Suspense>
    ) : null}
    {sceneSnapshotOpen ? (
      <Suspense
        fallback={(
          <div
            className="fixed inset-0 z-[110] grid place-items-center bg-canvas/80 p-4 text-sm font-semibold text-fg"
            role="status"
            aria-live="polite"
          >
            장면 스냅샷 라이브러리를 여는 중…
          </div>
        )}
      >
        <LazyStudioSceneSnapshotDialog
          sourcePage={activePage}
          sourceWorkId={workId}
          theme={webtoonTheme}
          onApply={applySceneSnapshot}
          onClose={() => setSceneSnapshotOpen(false)}
        />
      </Suspense>
    ) : null}
    {animaticTimelineOpen ? (
      <Suspense
        fallback={(
          <div
            className="fixed inset-0 z-[120] grid place-items-center bg-canvas/80 p-4 text-sm font-semibold text-fg"
            role="status"
            aria-live="polite"
          >
            애니매틱 타임라인을 여는 중…
          </div>
        )}
      >
        <LazyStudioAnimaticTimelineDialog
          open
          workScope={effectiveWorkId}
          pages={pages}
          reducedMotion={appSettings.other.reduceMotion}
          onClose={() => setAnimaticTimelineOpen(false)}
        />
      </Suspense>
    ) : null}
    {productionBibleOpen ? (
      <Suspense
        fallback={(
          <div
            className="fixed inset-0 z-[110] grid place-items-center bg-canvas/80 p-4 text-sm font-semibold text-fg"
            role="status"
            aria-live="polite"
          >
            제작 바이블을 여는 중…
          </div>
        )}
      >
        <LazyStudioProductionBibleWorkspace
          open
          onClose={() => setProductionBibleOpen(false)}
          userId={studioAuthUserId}
          workId={workId}
          characterOptions={characterBible.characters.map((character) => ({
            id: character.id,
            label: character.name.trim() || character.id,
          }))}
          assetOptions={productionBibleAssetOptions}
        />
      </Suspense>
    ) : null}

  {hybridDccRouteRequested && !hybridDccOpen ? (
    <StudioHybridDccRouteGate
      detail={hybridDccRouteAccess === "pending"
        ? "권한·원고·협업 경계를 확인한 뒤 같은 작품의 3D 작업을 엽니다. 기다리는 동안 캔버스와 로컬 3D 원본은 변경되지 않습니다."
        : "이 작품의 3D 원본을 편집할 수 없어 안전하게 캔버스로 돌아갑니다."}
      label={hybridDccRouteAccess === "pending"
        ? "3D 작업 권한을 확인하는 중입니다."
        : "3D 편집 권한을 확인하지 못했습니다."}
      onClose={() => setHybridDccOpen(false)}
      returnFocus={hybridDccReturnFocusRef.current}
    />
  ) : null}
  {hybridDccOpen ? (
    <StudioSurfaceErrorBoundary
      detail="3D 도구 화면만 안전하게 닫았습니다. 현재 캔버스, 문서 변경, 공동작업 연결과 실행 취소 기록은 그대로 보존되어 있습니다."
      onExit={() => setHybridDccOpen(false)}
      resetKey={JSON.stringify([
        hybridDccWorkspaceScope,
        studioRoute.dccMode ?? "model",
      ])}
      returnFocus={hybridDccReturnFocusRef.current}
      surfaceLabel="전문 3D 제작 도구"
    >
      <Suspense
        fallback={(
          <StudioHybridDccRouteGate
            detail="편집 권한과 로컬 복구 범위는 확인됐습니다. 무거운 3D 편집 모듈만 불러오는 중입니다."
            label="전문 3D 제작 도구를 여는 중입니다."
            onClose={() => setHybridDccOpen(false)}
            returnFocus={hybridDccReturnFocusRef.current}
          />
        )}
      >
        <LazyStudioHybridDccDialog
          key={hybridDccWorkspaceScope}
          loading={hybridDccPersistenceStatus === "checking"}
          open
          onClose={() => setHybridDccOpen(false)}
          initialWorkspace={scopedHybridDccWorkspace}
          onWorkbenchModeChange={setHybridDccWorkbenchMode}
          persistenceReceipt={hybridDccPersistenceReceipt}
          persistenceStatus={hybridDccPersistenceStatus}
          presentation="workspace"
          returnFocus={hybridDccReturnFocusRef.current}
          workbenchMode={studioRoute.dccMode ?? "model"}
          workspaceDocumentId={hybridDccWorkspaceDocumentId}
          onWorkspaceChange={(workspace) => {
            setHybridDccWorkspaceState((current) => (
              current?.scope === hybridDccWorkspaceScope && current?.workspace === workspace
                ? current
                : {
                    scope: hybridDccWorkspaceScope,
                    workspace,
                  }
            ));
            scheduleHybridDccWorkspacePersistence(workspace);
          }}
          onOpenInBackground3D={(result) => {
            announceDrawingShortcut(
              result.losses.length > 0
                ? `3D 장면을 열었습니다 · 파생 손실 ${result.losses.length}건은 DCC 원본에 보존됨`
                : `3D 장면을 열었습니다 · ${result.assets.length}개 메시, ${result.shots.length}개 Shot`,
            );
            bg3dDccSourceRef.current = {
              sourceDocumentId: result.sourceDocumentId,
              sourceStateHash: result.sourceStateHash,
              sourceWorkspaceHash: result.sourceWorkspaceHash,
              sourceBridgeSetHash: result.sourceBridgeSetHash,
              sourceCommandCount: result.sourceCommandCount,
              sourceBridgeCommandSequence: result.sourceBridgeCommandSequence,
            };
            bg3dDccShotMappingsRef.current = result.shots.map((shot) => ({
              sourceShotId: shot.sourceShotId,
              sceneShotId: shot.sceneShotId,
            }));
            setHybridDccOpen(false);
            setBg3dInitialDataUrl(undefined);
            setBg3dInitialElementId(undefined);
            setBg3dInitialScene(result.scene);
            setBg3dOpen(true);
          }}
        />
      </Suspense>
    </StudioSurfaceErrorBoundary>
    ) : null}
    {assetRightsAuditOpen ? (
      <Suspense
        fallback={(
          <div
            className="fixed inset-0 z-[110] grid place-items-center bg-canvas/80 p-4 text-sm font-semibold text-fg"
            role="status"
            aria-live="polite"
          >
            에셋 권리 대장을 만드는 중…
          </div>
        )}
      >
        <LazyStudioAssetRightsAuditDialog
          open
          onClose={() => setAssetRightsAuditOpen(false)}
          workId={workId}
          pages={pages}
        />
      </Suspense>
    ) : null}
    {pendingInterchangeImport ? (
      <Suspense fallback={null}>
        <LazyStudioInterchangeLossPreviewDialog
          open
          preview={pendingInterchangeImport.preview}
          busy={interchangeImportBusy}
          confirmLabel={
            pendingInterchangeImport.kind === "cbz"
              ? `${pendingInterchangeImport.result.pages.length}페이지 추가`
              : pendingInterchangeImport.kind === "will-v1"
                ? "선택한 위치에 WILL v1 추가"
              : "선택한 위치로 가져오기"
          }
          choices={
            pendingInterchangeImport.kind === "cbz"
              ? undefined
              : pendingInterchangeImport.kind === "will-v1"
                ? STUDIO_WILL_V1_IMPORT_PLACEMENT_CHOICES.map((choice) => {
                    const available = choice.id === "new-page"
                      ? pendingInterchangeImport.newPageAllowed
                        && pages.length < STUDIO_PROJECT_MAX_PAGES
                      : pendingInterchangeImport.currentPageAllowed;
                    return available
                      ? choice
                      : {
                          ...choice,
                          disabled: true,
                          description: choice.id === "new-page"
                            ? `프로젝트 저장 한도 ${STUDIO_PROJECT_MAX_PAGES}페이지 또는 페이지당 요소 한도에 도달했습니다.`
                            : "현재 페이지에 추가하면 페이지당 요소 저장 한도를 넘습니다.",
                        };
                  })
                : STUDIO_INTERCHANGE_IMPORT_PLACEMENT_CHOICES.map((choice) =>
                    choice.id === "new-page" && pages.length >= STUDIO_PROJECT_MAX_PAGES
                      ? {
                          ...choice,
                          disabled: true,
                          description: `프로젝트 저장 한도 ${STUDIO_PROJECT_MAX_PAGES}페이지에 도달해 현재 페이지 배치만 사용할 수 있습니다.`,
                        }
                      : choice
                  )
          }
          selectedChoiceId={
            pendingInterchangeImport.kind === "cbz"
              ? undefined
              : pendingInterchangeImport.kind === "will-v1"
                ? willImportChoice ?? undefined
                : interchangeImportChoice
          }
          onSelectedChoiceChange={(choiceId) => {
            if (pendingInterchangeImport.kind === "will-v1") {
              if (
                (choiceId === "current-page" && pendingInterchangeImport.currentPageAllowed) ||
                (
                  choiceId === "new-page" &&
                  pendingInterchangeImport.newPageAllowed &&
                  pages.length < STUDIO_PROJECT_MAX_PAGES
                )
              ) {
                setWillImportChoice(choiceId);
              }
              return;
            }
            if (
              choiceId === "current-page" ||
              (choiceId === "new-page" && pages.length < STUDIO_PROJECT_MAX_PAGES)
            ) {
              setInterchangeImportChoice(choiceId);
            }
          }}
          onConfirm={(choiceId) => void applyPendingInterchangeImport(choiceId)}
          onCancel={dismissPendingInterchangeImport}
        />
      </Suspense>
    ) : null}
    {pendingBrushDelete ? (
      <div
        ref={brushUndoToastRef}
        className="fixed left-1/2 z-[90] flex w-[min(calc(100vw-1.5rem),28rem)] -translate-x-1/2 items-center gap-2 rounded-2xl border border-warn/40 bg-panel/95 p-2 pl-3 text-xs text-fg shadow-2xl backdrop-blur"
        style={{
          bottom: isMobile
            ? `calc(7.5rem + env(safe-area-inset-bottom) + ${mobileKeyboardInset}px)`
            : "1.5rem",
        }}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        onPointerEnter={() => setPausedBrushDeleteId(pendingBrushDelete.id)}
        onPointerLeave={() => {
          if (!brushUndoToastRef.current?.contains(document.activeElement)) {
            setPausedBrushDeleteId(null);
          }
        }}
        onFocusCapture={() => setPausedBrushDeleteId(pendingBrushDelete.id)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setPausedBrushDeleteId(null);
          }
        }}
      >
        <span className="min-w-0 flex-1 leading-relaxed">
          <strong className="font-semibold">“{pendingBrushDelete.deleted.brush.name}” 삭제됨</strong>
          {pendingBrushDeletes.length > 1 ? ` · 복구 가능 ${pendingBrushDeletes.length}건` : ""}
        </span>
        <button
          ref={brushUndoButtonRef}
          type="button"
          onClick={() => void undoBrushDelete(pendingBrushDelete)}
          className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-warn/15 px-3 font-bold text-warn hover:bg-warn/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <Undo2
            size={STUDIO_ICON_SIZE.context}
            strokeWidth={STUDIO_ICON_STROKE}
            aria-hidden
            className={studioChromeIconClass({ tone: "warn" })}
          />
          삭제 취소
        </button>
      </div>
    ) : null}
    </>
  );
}
