/* Extracted render tree from StudioCuttoonEditor.
 * Session props are an `any` bag matching the original editor closure. */
// @ts-nocheck
"use no memo";
// React Compiler 옵트아웃: 가변 호스트 백(h) 을 렌더마다 재대입해 공유하는 추출 패턴이라,
// 컴파일러가 h 참조 동일성만 보고 JSX/계산을 캐시하면 첫 렌더에서 UI 가 영구 동결된다
// (탭 전환 등 커밋된 상태 변경이 화면에 반영되지 않음).
import {
  Lock,
  MessageCircle,
  UsersRound,
  Undo2,
  X,
} from "lucide-react";
import { Suspense, useEffect, useRef } from "react";
import {
  STUDIO_ICON_SIZE,
  STUDIO_ICON_STROKE,
  StudioAppMenubar,
  StudioToolBelt,
  studioChromeIconClass,
} from "../studio-chrome-ui";
import { StudioBrushCatalogPortal, StudioPublishContextBanner } from "../studio-page-lazy-ui";
import { LazyStudioMenubarContent } from "../studio-page-modal-lazy-boundaries";
import { StudioOptionsBars } from "../StudioOptionsBars";
import { StudioToolBeltContent } from "../StudioToolBeltContent";
import { StudioToolHintTarget } from "../StudioToolHint";
import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";
import type { StudioCuttoonEditorViewSession } from "./StudioCuttoonEditorViewSession";

export function StudioCuttoonEditorChrome(s: StudioCuttoonEditorViewSession) {
  const {
    activeCatalogBrush,
    activePage,
    activeServerAiProviderLabel,
    activeSurfaceReviewLocked,
    activeToolbarGroup,
    admittedBg3dOpen,
    admittedMannequinPoserOpen,
    admittedCharacterShaperOpen,
    admittedPoserVrmOpen,
    advancedFillActive,
    advancedFillUnsupportedReason,
    aiAssistTool,
    aiBgBusy,
    aiBgError,
    aiBgPrompt,
    aiBgSize,
    aiCharacterBusy,
    aiCharacterError,
    aiCharacterPrompt,
    aiCompositionDraft,
    aiDialogueSuggestBusy,
    aiDialogueSuggestCandidates,
    aiDialogueSuggestError,
    aiDialogueSuggestIncludeContext,
    aiDialogueSuggestSituation,
    aiPaletteSuggestBusy,
    aiPaletteSuggestError,
    aiPaletteSuggestMood,
    aiPaletteSuggestSavedMsg,
    aiPaletteSuggestion,
    aiProvenance,
    aiRecentPrompts,
    aiSettings,
    applyStudioBrushCatalogSelection,
    assetFavoriteOnly,
    assetFavoriteState,
    assetGenerating,
    assetPrompt,
    assetPromptName,
    assetPromptQuality,
    assetPromptSize,
    assetSearchQuery,
    assetSortOrder,
    assetTab,
    assets,
    assetsLoading,
    bgGrad,
    bgSceneGenreFilter,
    bgSceneSearchQuery,
    bgSceneSectionsFiltered,
    brushCatalogSession,
    builtinRasterBusyId,
    canvasH,
    canvasOnlyMode,
    characterBible,
    clips,
    collaborationDocumentLocked,
    collaborationLockMessage,
    collaborationOperationSyncPending,
    collaborationReadOnly,
    collaborationRoleLabel,
    color,
    commentsOpen,
    configuredServerAiProviders,
    continuityOpen,
    currentStudioWorkspaceDeviceKind,
    currentWorkspaceOwnerScope,
    dialogueScript,
    displayLinkedTitleId,
    drawMode,
    elements,
    emeresCategoryFilter,
    emeresFlatCatalog,
    emeresSearchQuery,
    emeresSectionsFiltered,
    emeresSimilarAnchor,
    emeresSimilarSiblings,
    emeresTab,
    emeresUnderlayCount,
    error,
    expectsSharedDocument,
    exportFormat,
    exportMenuOpen,
    exportMenuRef,
    exportPresetId,
    exportScale,
    exportTransparent,
    frameAnimOpen,
    frameAnimTargetId,
    fxComicFiltered,
    fxCreatureFiltered,
    fxEmojisFiltered,
    fxLinePresetsFiltered,
    fxOverlaysFiltered,
    fxPanelLoading,
    fxPickerHasResults,
    fxPickerSection,
    fxPropFiltered,
    fxQuery,
    fxRasterFiltered,
    fxSearchQuery,
    fxSectionVisible,
    fxSfxFiltered,
    history,
    historyPanelOpen,
    interchangeImportBusy,
    interchangeImportInputRef,
    interchangeImportStatus,
    isExporting,
    isFullscreen,
    isMobile,
    layerMergeBusy,
    setStudioStatusNotice,
    studioMarketplaceCloudSyncRetry,
    studioMarketplaceCloudSyncRetryPending,
    retryStudioMarketplaceCloudSync,
    dismissStudioMarketplaceCloudSyncRetry,
    studioStatusNotice,
    liveWorkspaceLayout,
    loadedWork,
    macroSession,
    magicResizeStrategy,
    masterEditMode,
    maximized,
    menu,
    menuRef,
    mobileImmersive,
    mobileKeyboardInset,
    openStudioCommentCount,
    openStudioCommentInbox,
    pageEditLocked,
    pageReviewOpen,
    pages,
    panelLayoutPresets,
    panelLayoutsError,
    panelLayoutsLoading,
    projectActionsOpen,
    projectActionsRef,
    projectArchiveBusy,
    projectArchiveImportInputRef,
    projectArchiveStatus,
    projectImportInputRef,
    psdImportBusy,
    psdImportInputRef,
    psdImportStatus,
    publishContext,
    publishingId,
    rasterFavoriteOnly,
    recentColors,
    referencePanelOpen,
    renamingAssetId,
    renamingAssetName,
    saving,
    sceneSimilarAnchor,
    sceneSimilarSiblings,
    sceneTemplates,
    sceneTemplatesError,
    sceneTemplatesLoading,
    selectOptionsLaneReserved,
    selectOptionsStripArmed,
    selectedForInspector,
    serverAiProvider,
    serverAiStatus,
    setAiAssistTool,
    setAiBgPrompt,
    setAiBgSize,
    setAiCharacterPrompt,
    setAiCompositionDraft,
    setAiDialogueSuggestIncludeContext,
    setAiDialogueSuggestSituation,
    setAiPaletteSuggestMood,
    setAiProvenanceOpen,
    setAiRecentPrompts,
    setAnimaticTimelineOpen,
    setAssetFavoriteOnly,
    setAssetPrompt,
    setAssetPromptName,
    setAssetPromptQuality,
    setAssetPromptSize,
    setAssetRightsAuditOpen,
    setAssetSearchQuery,
    setAssetSortOrder,
    setAssetTab,
    setBg3dInitialDataUrl,
    setBg3dInitialElementId,
    setBg3dInitialScene,
    setBg3dOpen,
    setBgSceneGenreFilter,
    setBgSceneSearchQuery,
    setCharacterBibleOpen,
    setCheckpointPanelOpen,
    setColor,
    setCommentsOpen,
    setContinuityOpen,
    setDialogueBatchOpen,
    setDialogueScript,
    setDialogueTranslateOpen,
    setDrawMode,
    setEmeresCategoryFilter,
    setEmeresSearchQuery,
    setEmeresSimilarAnchorId,
    setEmeresTab,
    setError,
    setExportFormat,
    setExportMenuOpen,
    setExportPresetId,
    setExportScale,
    setExportTransparent,
    setFxPickerSection,
    setFxSearchQuery,
    setHistoryPanelOpen,
    setHybridDccOpen,
    setLeftPanelOpenWithOverride,
    setMagicResizeStrategy,
    setMannequinPoserOpen,
    setMenu,
    setPageReviewOpen,
    setCharacterShaperOpen,
    setPoserVrmOpen,
    setProductionBibleOpen,
    setProductionInsightsOpen,
    setProjectActionsOpen,
    setPublicationOperationsOpen,
    setPublishPackageOpen,
    setPublishPreflightOpen,
    setRasterFavoriteOnly,
    setReferencePanelOpen,
    setRenamingAssetId,
    setRenamingAssetName,
    setRightPanelOpenWithOverride,
    setScale,
    setScenarioOpen,
    setSceneSimilarAnchorId,
    setSceneSnapshotOpen,
    setScrollPreviewOpen,
    setStoryboardGridOpen,
    setTeamPanelOpen,
    setTimelapseOpen,
    setTimelineOpen,
    setToneSearchQuery,
    setTool,
    setWriterRoomOpen,
    setZoom,
    sfxError,
    sfxLoading,
    sfxPacks,
    shared,
    sharedDocument,
    sharedDocumentNotice,
    sharedError,
    sharedLoading,
    sharedLoadingMore,
    sharedNextOffset,
    studioBgSceneAssetsError,
    studioBgSceneAssetsLoaded,
    studioBgSceneAssetsLoading,
    studioBrushCatalogHandlers,
    studioEmeresAssetsError,
    studioEmeresAssetsLoaded,
    studioEmeresAssetsLoading,
    studioHistoryRetention,
    studioMainMenuGroups,
    studioMenubarActivePageLabel,
    studioMenubarContentHandlers,
    studioMenubarPageLabels,
    studioOptionalAssets,
    studioOptionsBarsDrawModel,
    studioOptionsBarsHandlers,
    studioOptionsBarsSelectionModel,
    studioSfx,
    studioStickerAssetsError,
    studioStickerAssetsLoaded,
    studioStickerAssetsLoading,
    studioToolBeltContentHandlers,
    teamPanelOpen,
    textAiConfigured,
    textAiTransport,
    timelineOpen,
    title,
    toggleCanvasWideMode,
    toneSearchQuery,
    tool,
    uiDensityMode,
    watermark,
    workHydrated,
    workId,
    workspaceMenuEpoch,
    workspacePersistence,
    workspaceState,
    workspaceSyncNotice,
    wrapRef,
    writerRoom,
    zoom,
    bg,
    densityShowsStatusRail,
    hi,
    menuEditRedoDisabled,
    menuEditUndoDisabled,
    presentationPanelsHidden,
    proDrawPrefs,
    visibleLeftPanelOpen,
    visibleRightPanelOpen,
  } = s;
  const marketplaceCloudSyncRetryButtonRef = useRef(null);
  const marketplaceCloudSyncStatusRef = useRef(null);
  const marketplaceCloudSyncFocusRestoreRef = useRef(null);
  useEffect(() => {
    const request = marketplaceCloudSyncFocusRestoreRef.current;
    if (!request || studioMarketplaceCloudSyncRetryPending) return;
    const target = studioMarketplaceCloudSyncRetry
      ? marketplaceCloudSyncRetryButtonRef.current
      : marketplaceCloudSyncStatusRef.current;
    if (!target?.isConnected || target.disabled) return;
    const active = document.activeElement;
    if (active !== target && (
      active === null
      || active === document.body
      || active === document.documentElement
      || active === request.origin
    )) {
      target.focus();
    }
    marketplaceCloudSyncFocusRestoreRef.current = null;
  }, [
    densityShowsStatusRail,
    error,
    studioMarketplaceCloudSyncRetry,
    studioMarketplaceCloudSyncRetryPending,
    studioStatusNotice,
  ]);
  return (
    <>
      <StudioAppMenubar
        aria-label="문서 메뉴"
        className={cn(
          canvasOnlyMode && "hidden",
          mobileImmersive &&
            "h-auto min-h-11 border-0 bg-transparent shadow-none"
        )}
      >
        <Suspense
          fallback={(
            <div
              aria-hidden
              data-studio-menubar-loading="true"
              className="h-9 min-w-0 flex-1 animate-pulse rounded-lg bg-raised/45 motion-reduce:animate-none"
            />
          )}
        >
          <LazyStudioMenubarContent
            activePageLabel={studioMenubarActivePageLabel}
          activeToolbarGroup={activeToolbarGroup}
          aiProvenance={aiProvenance}
          canvasH={canvasH}
          characterBible={characterBible}
          collaborationDocumentLocked={collaborationDocumentLocked}
          collaborationLockMessage={collaborationLockMessage}
          currentWorkspaceOwnerScope={currentWorkspaceOwnerScope}
          displayLinkedTitleId={displayLinkedTitleId}
          exportFormat={exportFormat}
          exportMenuOpen={exportMenuOpen}
          exportMenuRef={exportMenuRef}
          exportPresetId={exportPresetId}
          exportScale={exportScale}
          exportTransparent={exportTransparent}
          fxPanelLoading={fxPanelLoading}
          isExporting={isExporting}
          isMobile={isMobile}
          liveWorkspaceLayout={liveWorkspaceLayout}
          resolveWorkspaceDeviceKind={currentStudioWorkspaceDeviceKind}
          loadedWork={loadedWork}
          masterEditMode={masterEditMode}
          menu={menu}
          mobileImmersive={mobileImmersive}
          historyPanelOpen={historyPanelOpen}
          openStudioCommentCount={openStudioCommentCount}
          pageCount={studioMenubarPageLabels.length}
          pageEditLocked={pageEditLocked}
          pageLabels={studioMenubarPageLabels}
          dialoguePages={pages}
          projectActionsOpen={projectActionsOpen}
          projectActionsRef={projectActionsRef}
          projectArchiveBusy={projectArchiveBusy}
          projectArchiveImportInputRef={projectArchiveImportInputRef}
          projectArchiveStatus={projectArchiveStatus}
          projectImportInputRef={projectImportInputRef}
          interchangeImportBusy={interchangeImportBusy}
          interchangeImportInputRef={interchangeImportInputRef}
          interchangeImportStatus={interchangeImportStatus}
          psdImportBusy={psdImportBusy}
          psdImportInputRef={psdImportInputRef}
          psdImportStatus={psdImportStatus}
          redoDisabled={menuEditRedoDisabled}
          saving={saving}
          setAiProvenanceOpen={setAiProvenanceOpen}
          setAnimaticTimelineOpen={setAnimaticTimelineOpen}
          setAssetRightsAuditOpen={setAssetRightsAuditOpen}
          setCharacterBibleOpen={setCharacterBibleOpen}
          setCheckpointPanelOpen={setCheckpointPanelOpen}
          setProductionBibleOpen={setProductionBibleOpen}
          setHybridDccOpen={setHybridDccOpen}
          setSceneSnapshotOpen={setSceneSnapshotOpen}
          setExportFormat={setExportFormat}
          setExportMenuOpen={setExportMenuOpen}
          setExportPresetId={setExportPresetId}
          setExportScale={setExportScale}
          setExportTransparent={setExportTransparent}
          setMenu={setMenu}
          setProductionInsightsOpen={setProductionInsightsOpen}
          setProjectActionsOpen={setProjectActionsOpen}
          setPublicationOperationsOpen={setPublicationOperationsOpen}
          setPublishPackageOpen={setPublishPackageOpen}
          setPublishPreflightOpen={setPublishPreflightOpen}
          setWriterRoomOpen={setWriterRoomOpen}
          sharedDocument={sharedDocument}
          studioMainMenuGroups={studioMainMenuGroups}
          title={title}
          undoDisabled={menuEditUndoDisabled}
          pageSequenceOpen={s.pageSequenceOpen}
          watermark={watermark}
          workId={workId}
          workspaceMenuEpoch={workspaceMenuEpoch}
          workspacePersistence={workspacePersistence}
          workspaceState={workspaceState}
          workspaceSyncNotice={workspaceSyncNotice}
          writerRoom={writerRoom}
            stableHandlers={studioMenubarContentHandlers}
          />
        </Suspense>
        <StudioToolHintTarget
          preferredSide="bottom"
          className="hidden shrink-0 lg:inline-flex"
          disabled={collaborationDocumentLocked && !sharedDocument?.capabilities.view}
          unavailableReason={
            collaborationDocumentLocked && !sharedDocument?.capabilities.view
              ? collaborationLockMessage()
              : undefined
          }
          hint={{
            id: "menubar-comment-inbox",
            title: "댓글 검토함",
            description: "문서 댓글을 검색·필터링하고 읽음·해결 상태를 관리하며 연결된 캔버스 위치로 이동합니다.",
            preview: "comment-inbox",
            tip:
              openStudioCommentCount > 0
                ? `아직 해결되지 않은 댓글이 ${openStudioCommentCount}개 있어요.`
                : "댓글 핀을 남기면 검토자가 정확한 페이지·컷·요소 맥락을 바로 확인할 수 있어요.",
          }}
        >
          <button
            type="button"
            data-studio-comments-inbox="true"
            onClick={() => {
              if (commentsOpen) {
                setCommentsOpen(false);
                return;
              }
              openStudioCommentInbox();
            }}
            disabled={collaborationDocumentLocked && !sharedDocument?.capabilities.view}
            aria-expanded={commentsOpen}
            aria-haspopup="dialog"
            aria-controls="studio-comments-review-dialog"
            aria-label={`댓글 검토함${openStudioCommentCount > 0 ? `, 열린 댓글 ${openStudioCommentCount}개` : ""}`}
            className={cn(
              buttonClass({ size: "sm", variant: commentsOpen ? "solid" : "quiet" }),
              "relative min-h-9 shrink-0 gap-1.5 px-2.5 text-[0.72rem] disabled:cursor-not-allowed disabled:opacity-50"
            )}
            title={
              collaborationDocumentLocked && !sharedDocument?.capabilities.view
                ? collaborationLockMessage()
                : commentsOpen
                  ? "댓글 검토함 닫기"
                  : "댓글 검토함 열기 · 검색, 필터, 읽음 상태 관리"
            }
          >
            <MessageCircle
              size={STUDIO_ICON_SIZE.subtab}
              strokeWidth={STUDIO_ICON_STROKE}
              aria-hidden
              className={studioChromeIconClass({ tone: "default" })}
            />
            <span className="max-xl:sr-only">댓글</span>
            {openStudioCommentCount > 0 ? (
              <span
                aria-hidden
                className="inline-flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 py-0.5 text-[0.6rem] font-bold tabular-nums text-on-accent"
              >
                {openStudioCommentCount > 99 ? "99+" : openStudioCommentCount}
              </span>
            ) : null}
          </button>
        </StudioToolHintTarget>
      </StudioAppMenubar>

      <div
        data-studio-global-status-rail
        className={cn(
          "shrink-0 px-2",
          mobileImmersive
            ? "max-h-[min(24dvh,10rem)] overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
            : "empty:hidden"
        )}
      >
        {densityShowsStatusRail && error ? (
          <div role="alert" className="my-1 flex items-start justify-between gap-2 rounded-lg border border-bad/40 bg-bad/10 px-2.5 py-1.5 text-xs text-bad">
            <span className="min-w-0 break-words">{error}</span>
            <button
              type="button"
              data-studio-status-error-dismiss
              aria-label="오류 메시지 닫기"
              className="-mr-1 shrink-0 rounded p-0.5 transition hover:bg-bad/15"
              onClick={() => setError(null)}
            >
              <X size={12} strokeWidth={2.5} aria-hidden="true" />
            </button>
          </div>
        ) : null}
        {densityShowsStatusRail && studioStatusNotice ? (
          <div
            ref={marketplaceCloudSyncStatusRef}
            role="status"
            tabIndex={-1}
            className="my-1 flex items-start justify-between gap-2 rounded-lg border border-accent/35 bg-accent-soft/30 px-2.5 py-1.5 text-xs text-fg-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="min-w-0 break-words">{studioStatusNotice}</span>
            <button
              type="button"
              data-studio-status-notice-dismiss
              aria-label="알림 닫기"
              className="-mr-1 shrink-0 rounded p-0.5 transition hover:bg-accent-soft/60"
              onClick={() => setStudioStatusNotice(null)}
            >
              <X size={12} strokeWidth={2.5} aria-hidden="true" />
            </button>
          </div>
        ) : null}
        {densityShowsStatusRail && studioMarketplaceCloudSyncRetry ? (
          <div
            role="alert"
            className="my-1 flex flex-wrap items-center gap-2 rounded-lg border border-warn/40 bg-warn/10 px-2.5 py-1.5 text-xs text-warn"
          >
            <span className="min-w-0 flex-1 break-words">
              {studioMarketplaceCloudSyncRetry.record.name}의 로컬 설치는 유지됩니다. 계정 설치 확인만 다시 맞춰야 합니다: {studioMarketplaceCloudSyncRetry.issue}
            </span>
            <button
              ref={marketplaceCloudSyncRetryButtonRef}
              type="button"
              disabled={studioMarketplaceCloudSyncRetryPending}
              className="min-h-11 shrink-0 rounded-md border border-current/35 px-3 font-semibold transition hover:bg-warn/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warn disabled:cursor-not-allowed disabled:opacity-50"
              onClick={(event) => {
                marketplaceCloudSyncFocusRestoreRef.current =
                  document.activeElement === event.currentTarget
                    ? { origin: event.currentTarget }
                    : null;
                void retryStudioMarketplaceCloudSync();
              }}
            >
              {studioMarketplaceCloudSyncRetryPending
                ? "계정 설치 확인 중…"
                : "계정 설치 확인 다시 시도"}
            </button>
            <button
              type="button"
              aria-label="계정 설치 확인 재시도 닫기"
              className="grid size-11 shrink-0 place-items-center rounded transition hover:bg-warn/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warn"
              onClick={dismissStudioMarketplaceCloudSyncRetry}
            >
              <X size={12} strokeWidth={2.5} aria-hidden="true" />
            </button>
          </div>
        ) : null}
        {densityShowsStatusRail && layerMergeBusy ? (
          <div role="status" className="my-1 rounded-lg border border-accent/35 bg-accent-soft/30 px-2.5 py-1.5 text-xs text-fg-2">
            레이어를 병합하는 중…
          </div>
        ) : null}
        {densityShowsStatusRail && macroSession.recording ? (
          <div role="status" className="my-1 rounded-lg border border-bad/30 bg-bad/10 px-2.5 py-1.5 text-xs font-semibold text-bad">
            매크로 녹음 중 · {macroSession.commands.length}단계
          </div>
        ) : null}
        {densityShowsStatusRail && expectsSharedDocument && (!mobileImmersive || collaborationDocumentLocked) ? (
          <div
            role="status"
            aria-live="polite"
            aria-busy={!workHydrated || collaborationOperationSyncPending}
            className={cn(
              "my-1 flex min-h-9 items-start gap-2 rounded-lg border px-2.5 py-1.5 text-xs",
              collaborationDocumentLocked
                ? "border-warn/40 bg-warn/10 text-fg"
                : "border-good/35 bg-good/10 text-fg"
            )}
          >
            {collaborationDocumentLocked ? (
            <Lock
              size={STUDIO_ICON_SIZE.nav}
              strokeWidth={STUDIO_ICON_STROKE}
              aria-hidden
              className={cn(
                "mt-0.5 shrink-0",
                studioChromeIconClass({ tone: collaborationDocumentLocked ? "warn" : "good" })
              )}
            />
          ) : (
            <UsersRound
              size={STUDIO_ICON_SIZE.nav}
              strokeWidth={STUDIO_ICON_STROKE}
              aria-hidden
              className={cn("mt-0.5 shrink-0", studioChromeIconClass({ tone: "good" }))}
            />
          )}
            <span className="min-w-0 flex-1">
              <strong className="block text-sm font-semibold">
                {!sharedDocument
                  ? workHydrated
                    ? "공동 문서를 열지 못했어요"
                    : "공동 문서 권한을 확인하고 있어요"
                  : collaborationOperationSyncPending
                    ? "동시 편집 연산 동기화 중"
                    : collaborationReadOnly
                    ? `${collaborationRoleLabel()} · 읽기 전용`
                    : `${collaborationRoleLabel()} · 공동 편집 가능`}
              </strong>
              <span className="mt-0.5 block text-xs leading-relaxed text-fg-2">
                {collaborationDocumentLocked
                  ? collaborationLockMessage()
                  : sharedDocumentNotice ??
                    `서버 revision ${sharedDocument?.revision ?? "—"} 기준으로 안전하게 저장합니다.`}
              </span>
            </span>
            {sharedDocument ? (
              <span className="shrink-0 rounded-full border border-line bg-card px-2 py-1 text-[0.6875rem] font-semibold tabular-nums text-fg-2">
                r{sharedDocument.revision}
              </span>
            ) : workHydrated ? (
              <button
                type="button"
                onClick={() => globalThis.location.reload()}
                className="min-h-11 shrink-0 rounded-lg border border-line bg-card px-3 text-xs font-semibold text-fg-2 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                다시 시도
              </button>
            ) : null}
          </div>
        ) : null}
        {studioHistoryRetention.notice && !mobileImmersive && !canvasOnlyMode ? (
          <div
            key={studioHistoryRetention.notice.id}
            data-studio-history-budget-notice="true"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="my-1 flex min-h-9 items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 px-2.5 py-1.5 text-xs text-fg-2"
          >
            <Undo2
              size={STUDIO_ICON_SIZE.context}
              strokeWidth={STUDIO_ICON_STROKE}
              aria-hidden
              className={cn(
                "mt-0.5 shrink-0",
                studioChromeIconClass({ tone: "warn" })
              )}
            />
            <span className="min-w-0 flex-1 leading-relaxed">
              {studioHistoryRetention.notice.message}
            </span>
          </div>
        ) : null}
        {/* 게시·로그인 안내는 드로잉 크롬에 띄우지 않음 — 저장/게시 액션 시점에만 노출. */}
        {(publishContext.series || publishContext.challenge) && !mobileImmersive && !canvasOnlyMode ? (
          <Suspense fallback={null}>
            <StudioPublishContextBanner
              context={publishContext}
              className="my-1 mb-1 px-2.5 py-1.5 text-xs"
            />
          </Suspense>
        ) : null}
      </div>

      {/*
        선택 옵션 줄의 자리를 미리 확보한다 — 선택이 생겨도 스트립이 새로 flow 에
        끼어들지 않으므로 캔버스 원점이 0px 이동한다. 빈 줄로 두면 고장처럼 보여서
        같은 높이의 안내 줄을 세워 둔다(오버레이가 아니라 예약이라 캔버스를 가리지도
        않는다).
      */}
      {selectOptionsLaneReserved && !studioOptionsBarsSelectionModel.visible ? (
        <div
          data-studio-select-options-reserve="true"
          data-studio-select-options-armed={selectOptionsStripArmed ? "true" : "false"}
          data-studio-icon-first="true"
          className="relative z-[40] flex h-11 min-h-11 shrink-0 items-center gap-1.5 overflow-hidden border-b border-line bg-panel/70 px-2.5 text-[0.7rem] text-fg-3"
        >
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-line" />
          <span className="truncate">
            {selectOptionsStripArmed
              ? "요소를 클릭하면 선택 옵션이 여기에 표시됩니다 · 드래그로 여러 개 선택"
              : "선택 도구(V)로 요소를 고르면 복제·정렬·잠금 옵션이 여기에 표시됩니다"}
          </span>
        </div>
      ) : null}
      <StudioOptionsBars
        draw={studioOptionsBarsDrawModel}
        selection={studioOptionsBarsSelectionModel}
        stableHandlers={studioOptionsBarsHandlers}
      />

      {brushCatalogSession ? (
        <Suspense fallback={null}>
          <StudioBrushCatalogPortal
            open
            placement={brushCatalogSession.placement}
            triggerElement={brushCatalogSession.trigger}
            activeBrushId={activeCatalogBrush.id}
            operation={drawMode === "eraser" ? "erase" : "paint"}
            favoriteIds={proDrawPrefs.favoriteBrushIds}
            recentIds={proDrawPrefs.recentBrushIds}
            restoredView={
              proDrawPrefs.brushLibraryView[drawMode === "eraser" ? "erase" : "paint"]
            }
            onViewStateChange={studioBrushCatalogHandlers.rememberView}
            mobileKeyboardInset={mobileKeyboardInset}
            onClose={studioBrushCatalogHandlers.close}
            onSelect={applyStudioBrushCatalogSelection}
            onToggleFavorite={studioBrushCatalogHandlers.toggleFavorite}
          />
        </Suspense>
      ) : null}

      {/* Legacy tool belt: primary on mobile. Desktop menubar/rail own discovery. Keep the
          component mounted so its body portals can serve rail-triggered panels, but hide its DOM
          host completely on desktop; a zero-size overflow-visible host still painted children at
          y < 0 and widened the editor scroll geometry. */}
      <StudioToolBelt
        inert={!isMobile}
        aria-hidden={!isMobile}
        className={cn(
          canvasOnlyMode && "hidden",
          // Immersive mobile already exposes the same frequent actions in its 44px thumb dock.
          // Removing the 4.7x-wide belt restores canvas height and eliminates undiscoverable scroll.
          mobileImmersive && "max-lg:hidden",
          // Portalled popovers attach to body, so display:none on this host does not clip them.
          "lg:hidden",
          // 모바일은 정상 클릭.
          "max-lg:pointer-events-auto"
        )}
      >
        <StudioToolBeltContent
          activePage={activePage}
          activeServerAiProviderLabel={activeServerAiProviderLabel}
          activeSurfaceReviewLocked={activeSurfaceReviewLocked}
          activeToolbarGroup={activeToolbarGroup}
          advancedFillActive={advancedFillActive}
          advancedFillUnsupportedReason={advancedFillUnsupportedReason}
          aiAssistTool={aiAssistTool}
          aiBgBusy={aiBgBusy}
          aiBgError={aiBgError}
          aiBgPrompt={aiBgPrompt}
          aiBgSize={aiBgSize}
          aiCharacterBusy={aiCharacterBusy}
          aiCharacterError={aiCharacterError}
          aiCharacterPrompt={aiCharacterPrompt}
          aiCompositionDraft={aiCompositionDraft}
          aiDialogueSuggestBusy={aiDialogueSuggestBusy}
          aiDialogueSuggestCandidates={aiDialogueSuggestCandidates}
          aiDialogueSuggestError={aiDialogueSuggestError}
          aiDialogueSuggestIncludeContext={aiDialogueSuggestIncludeContext}
          aiDialogueSuggestSituation={aiDialogueSuggestSituation}
          aiPaletteSuggestBusy={aiPaletteSuggestBusy}
          aiPaletteSuggestError={aiPaletteSuggestError}
          aiPaletteSuggestion={aiPaletteSuggestion}
          aiPaletteSuggestMood={aiPaletteSuggestMood}
          aiPaletteSuggestSavedMsg={aiPaletteSuggestSavedMsg}
          aiRecentPrompts={aiRecentPrompts}
          aiSettings={aiSettings}
          assetFavoriteOnly={assetFavoriteOnly}
          assetFavoriteState={assetFavoriteState}
          assetGenerating={assetGenerating}
          assetPrompt={assetPrompt}
          assetPromptName={assetPromptName}
          assetPromptQuality={assetPromptQuality}
          assetPromptSize={assetPromptSize}
          assets={assets}
          assetSearchQuery={assetSearchQuery}
          assetsLoading={assetsLoading}
          assetSortOrder={assetSortOrder}
          assetTab={assetTab}
          bg={bg}
          bg3dOpen={admittedBg3dOpen}
          bgGrad={bgGrad}
          bgSceneGenreFilter={bgSceneGenreFilter}
          bgSceneSearchQuery={bgSceneSearchQuery}
          bgSceneSectionsFiltered={bgSceneSectionsFiltered}
          builtinRasterBusyId={builtinRasterBusyId}
          canvasH={canvasH}
          canvasOnlyMode={canvasOnlyMode}
          clips={clips}
          collaborationDocumentLocked={collaborationDocumentLocked}
          collaborationLockMessage={collaborationLockMessage}
          color={color}
          commentsOpen={commentsOpen}
          configuredServerAiProviders={configuredServerAiProviders}
          continuityOpen={continuityOpen}
          dialogueScript={dialogueScript}
          drawMode={drawMode}
          elements={elements}
          emeresCategoryFilter={emeresCategoryFilter}
          emeresFlatCatalog={emeresFlatCatalog}
          emeresSearchQuery={emeresSearchQuery}
          emeresSectionsFiltered={emeresSectionsFiltered}
          emeresSimilarAnchor={emeresSimilarAnchor}
          emeresSimilarSiblings={emeresSimilarSiblings}
          emeresTab={emeresTab}
          emeresUnderlayCount={emeresUnderlayCount}
          frameAnimOpen={frameAnimOpen}
          frameAnimTargetId={frameAnimTargetId}
          fxComicFiltered={fxComicFiltered}
          fxCreatureFiltered={fxCreatureFiltered}
          fxEmojisFiltered={fxEmojisFiltered}
          fxLinePresetsFiltered={fxLinePresetsFiltered}
          fxOverlaysFiltered={fxOverlaysFiltered}
          fxPickerHasResults={fxPickerHasResults}
          fxPickerSection={fxPickerSection}
          fxPropFiltered={fxPropFiltered}
          fxQuery={fxQuery}
          fxRasterFiltered={fxRasterFiltered}
          fxSearchQuery={fxSearchQuery}
          fxSectionVisible={fxSectionVisible}
          fxSfxFiltered={fxSfxFiltered}
          hi={hi}
          history={history}
          historyPanelOpen={historyPanelOpen}
          isFullscreen={isFullscreen}
          toggleWorkspaceWideMode={toggleCanvasWideMode}
          magicResizeStrategy={magicResizeStrategy}
          masterEditMode={masterEditMode}
          maximized={maximized}
          menu={menu}
          menuRef={menuRef}
          openStudioCommentCount={openStudioCommentCount}
          pageEditLocked={pageEditLocked}
          pageReviewOpen={pageReviewOpen}
          panelLayoutPresets={panelLayoutPresets}
          panelLayoutsError={panelLayoutsError}
          panelLayoutsLoading={panelLayoutsLoading}
          mannequinPoserOpen={admittedMannequinPoserOpen}
          setMannequinPoserOpen={setMannequinPoserOpen}
          poserVrmOpen={admittedPoserVrmOpen}
          characterShaperOpen={admittedCharacterShaperOpen}
          presentationPanelsHidden={presentationPanelsHidden}
          publishingId={publishingId}
          rasterFavoriteOnly={rasterFavoriteOnly}
          recentColors={recentColors}
          referencePanelOpen={referencePanelOpen}
          renamingAssetId={renamingAssetId}
          renamingAssetName={renamingAssetName}
          sceneSimilarAnchor={sceneSimilarAnchor}
          sceneSimilarSiblings={sceneSimilarSiblings}
          sceneTemplates={sceneTemplates}
          sceneTemplatesError={sceneTemplatesError}
          sceneTemplatesLoading={sceneTemplatesLoading}
          selected={selectedForInspector}
          serverAiProvider={serverAiProvider}
          serverAiStatus={serverAiStatus}
          setAiAssistTool={setAiAssistTool}
          setAiBgPrompt={setAiBgPrompt}
          setAiBgSize={setAiBgSize}
          setAiCharacterPrompt={setAiCharacterPrompt}
          setAiCompositionDraft={setAiCompositionDraft}
          setAiDialogueSuggestIncludeContext={setAiDialogueSuggestIncludeContext}
          setAiDialogueSuggestSituation={setAiDialogueSuggestSituation}
          setAiPaletteSuggestMood={setAiPaletteSuggestMood}
          setAiRecentPrompts={setAiRecentPrompts}
          setAssetFavoriteOnly={setAssetFavoriteOnly}
          setAssetPrompt={setAssetPrompt}
          setAssetPromptName={setAssetPromptName}
          setAssetPromptQuality={setAssetPromptQuality}
          setAssetPromptSize={setAssetPromptSize}
          setAssetSearchQuery={setAssetSearchQuery}
          setAssetSortOrder={setAssetSortOrder}
          setAssetTab={setAssetTab}
          setBg3dInitialDataUrl={setBg3dInitialDataUrl}
          setBg3dInitialElementId={setBg3dInitialElementId}
          setBg3dInitialScene={setBg3dInitialScene}
          setBg3dOpen={setBg3dOpen}
          setBgSceneGenreFilter={setBgSceneGenreFilter}
          setBgSceneSearchQuery={setBgSceneSearchQuery}
          setColor={setColor}
          setCommentsOpen={setCommentsOpen}
          setContinuityOpen={setContinuityOpen}
          setDialogueBatchOpen={setDialogueBatchOpen}
          setDialogueScript={setDialogueScript}
          setDialogueTranslateOpen={setDialogueTranslateOpen}
          setDrawMode={setDrawMode}
          setEmeresCategoryFilter={setEmeresCategoryFilter}
          setEmeresSearchQuery={setEmeresSearchQuery}
          setEmeresSimilarAnchorId={setEmeresSimilarAnchorId}
          setEmeresTab={setEmeresTab}
          setFxPickerSection={setFxPickerSection}
          setFxSearchQuery={setFxSearchQuery}
          setHistoryPanelOpen={setHistoryPanelOpen}
          setLeftPanelOpen={setLeftPanelOpenWithOverride}
          setMagicResizeStrategy={setMagicResizeStrategy}
          setMenu={setMenu}
          setPageReviewOpen={setPageReviewOpen}
          setPoserVrmOpen={setPoserVrmOpen}
          setCharacterShaperOpen={setCharacterShaperOpen}
          setRasterFavoriteOnly={setRasterFavoriteOnly}
          setReferencePanelOpen={setReferencePanelOpen}
          setRenamingAssetId={setRenamingAssetId}
          setRenamingAssetName={setRenamingAssetName}
          setRightPanelOpen={setRightPanelOpenWithOverride}
          setScale={setScale}
          setScenarioOpen={setScenarioOpen}
          setSceneSimilarAnchorId={setSceneSimilarAnchorId}
          setScrollPreviewOpen={setScrollPreviewOpen}
          setStoryboardGridOpen={setStoryboardGridOpen}
          setTeamPanelOpen={setTeamPanelOpen}
          setTimelapseOpen={setTimelapseOpen}
          setTimelineOpen={setTimelineOpen}
          setToneSearchQuery={setToneSearchQuery}
          setTool={setTool}
          setZoom={setZoom}
          sfxError={sfxError}
          sfxLoading={sfxLoading}
          sfxPacks={sfxPacks}
          shared={shared}
          sharedDocument={sharedDocument}
          sharedError={sharedError}
          sharedHasMore={sharedNextOffset !== null}
          sharedLoading={sharedLoading}
          sharedLoadingMore={sharedLoadingMore}
          studioBgSceneAssetsError={studioBgSceneAssetsError}
          studioBgSceneAssetsLoaded={studioBgSceneAssetsLoaded}
          studioBgSceneAssetsLoading={studioBgSceneAssetsLoading}
          studioEmeresAssetsError={studioEmeresAssetsError}
          studioEmeresAssetsLoaded={studioEmeresAssetsLoaded}
          studioEmeresAssetsLoading={studioEmeresAssetsLoading}
          studioOptionalAssets={studioOptionalAssets}
          studioSfx={studioSfx}
          studioStickerAssetsError={studioStickerAssetsError}
          studioStickerAssetsLoaded={studioStickerAssetsLoaded}
          studioStickerAssetsLoading={studioStickerAssetsLoading}
          teamPanelOpen={teamPanelOpen}
          textAiConfigured={textAiConfigured}
          textAiTransport={textAiTransport}
          timelineOpen={timelineOpen}
          toneSearchQuery={toneSearchQuery}
          tool={tool}
          uiDensityMode={uiDensityMode}
          visibleLeftPanelOpen={visibleLeftPanelOpen}
          visibleRightPanelOpen={visibleRightPanelOpen}
          wrapRef={wrapRef}
          zoom={zoom}
          stableHandlers={studioToolBeltContentHandlers}
        />
      </StudioToolBelt>

      {pageEditLocked && !masterEditMode ? (
        <div
          role="status"
          className={cn(
            "mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warning/35 bg-warning-soft/20 px-3 py-2 text-xs text-warning",
            mobileImmersive &&
              "max-h-[min(20dvh,7rem)] shrink-0 overflow-y-auto overscroll-contain"
          )}
        >
          <span className="inline-flex items-center gap-1.5 font-semibold">
            <Lock size={13} aria-hidden /> 현재 페이지는 검토 잠금 상태라 콘텐츠 변경이 차단됩니다.
          </span>
          <button
            type="button"
            onClick={() => setPageReviewOpen(true)}
            className="rounded-lg border border-warning/35 bg-panel/70 px-2.5 py-1 font-bold hover:bg-panel"
          >
            검토 설정 열기
          </button>
        </div>
      ) : null}
    </>
  );
}
