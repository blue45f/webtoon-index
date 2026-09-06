import { CircleHelp } from "lucide-react";
import { Suspense } from "react";

import { BRUSH_PRESETS } from "../studio-brush";
import { QuickStartPanel } from "../studio-page-lazy-ui";

import { localizeText } from "./studio-canvas-viewport-primitives";
import { StudioCanvasControls } from "./StudioCanvasControls";
import { StudioCanvasModalsOverlay } from "./StudioCanvasModalsOverlay";
import { StudioDrawingShortcutNoticeLayer } from "./StudioDrawingShortcutNoticeLayer";

import type { StudioCanvasViewportInteraction } from "./studio-canvas-viewport-interaction";
import type { StudioCanvasViewportProps } from "./StudioCanvasViewportTypes";

import { cn } from "@/shared/lib/utils";

export function StudioCanvasViewportHudOverlays({
  viewport,
  interaction,
}: {
  viewport: StudioCanvasViewportProps;
  interaction: StudioCanvasViewportInteraction;
}) {
  const {
    activeDialogueLocale,
    activePage,
    activeServerAiProviderLabel,
    aiNoticeOpen,
    animTimeline,
    appSettings,
    appSettingsInitialTab,
    appSettingsOpen,
    appSettingsPersistenceState,
    authorizedWorkAssetScopeId,
    canvasOnlyMode,
    collaborationDocumentLocked,
    collaborationLockMessage,
    dialogueBatchOpen,
    dialogueTranslateOpen,
    drawMode,
    drawingShortcutNoticeStore,
    editing,
    effScale,
    elementById,
    elements,
    frameAnimEl,
    frameAnimOpen,
    groups,
    hasAutosave,
    historyBrushSourceIndex,
    historyPanelOpen,
    marqueeIds,
    master,
    masterEditMode,
    masterPanelOpen,
    mobileImmersive,
    mobileKeyboardInset,
    onionSkin,
    pageSequenceOpen,
    pages,
    pagesHi,
    pagesHistory,
    quickShapeActive,
    selected,
    selectedId,
    setAppSettingsInitialTab,
    setAppSettingsOpen,
    setBg3dOpen,
    setDialogueBatchOpen,
    setDialogueTranslateOpen,
    setError,
    setEyedropperActive,
    setFrameAnimOpen,
    setFrameAnimTargetId,
    setHistoryPanelOpen,
    setLeftPanelOpen,
    setMarqueeIds,
    setMasterEditMode,
    setMasterPanelOpen,
    setOnionSkin,
    setPageSequenceOpen,
    setPoserVrmOpen,
    setQuickShapeActive,
    setQuickStartOpen,
    setSelectedId,
    setSharedDocumentNotice,
    setShortcutsOpen,
    setTimelineFocusedTrackId,
    setTimelineOpen,
    setTimelinePlayhead,
    setTimelinePlaying,
    setTranslateDraft,
    setTranslateGlossary,
    setTranslateTargetLocale,
    setTutorialHubOpen,
    setZoom,
    setZoomLocked,
    shortcutsOpen,
    showQuickStart,
    textAiConfigured,
    timelineFocusedTrackId,
    timelineOpen,
    timelinePlayhead,
    timelinePlaying,
    title,
    tool,
    translateBusy,
    translateDraft,
    translateError,
    translateGlossary,
    translateProgress,
    translateTargetLocale,
    tutorialHubOpen,
    tutorialInitialId,
    viewTransformSuppressed,
    webtoonTheme,
    workId,
    zoomLocked,
    stableHandlers,
    setRightPanelOpen: _setRightPanelOpen,
  } = viewport;
  const {
    acknowledgeAiNotice,
    activateCanvasTool,
    addPage,
    applyBuiltInBrushPreset,
    applyDialogueReplacePlan,
    applyTranslationDraft,
    cancelAiNotice,
    cancelEditText,
    captureAnimFrame,
    captureTimelineKeyframe,
    commitAppSettings,
    commitCoalesced,
    commitEditText,
    commitPages,
    designateHistoryBrushSource,
    dismissQuickStart,
    executeGenerateTranslations,
    handleTutorialTry,
    importDialogueInterchange,
    jumpToHistoryIndex,
    openBrushCatalogFromHelp,
    openFeatureTutorial,
    openQuickComicWizard,
    openQuickStartMenu,
    patchDialogueText,
    patchElCoalesced,
    patchTranslateDraft,
    retryAppSettingsPersistence,
    selectDialogueElement,
    setActualPixelView,
    setCurrentPageId,
    setMaster,
    setStudioUiDensity,
    startFromExample,
    switchToDialogueLocale,
    updateActivePage,
  } = stableHandlers;
  const {
    applyDialogueMultiFormat,
    applyDialogueRuby,
    clearDialogueRuby,
    convertDialogueTextToBubble,
    convertDialogueTextsToBubbles,
    editingFallbackToModal,
    mergeDialogueTextWithNext,
    patchEl,
    splitDialogueText,
    t,
    toggleWheelCanvasMode,
    transferDialogueText,
    viewBusyReason,
    zoomInAtLimit,
    zoomInUnavailableReason,
    zoomLockedReason,
    zoomOutAtLimit,
    zoomOutUnavailableReason,
  } = interaction;

  return (
    <>
          {showQuickStart ? (
            <Suspense fallback={null}>
              <QuickStartPanel
              onDismiss={dismissQuickStart}
              onQuickComic={openQuickComicWizard}
              onExample={() => void startFromExample()}
              onOpenTemplate={() => openQuickStartMenu("template")}
              onOpenCharacter={() => {
                dismissQuickStart();
                setPoserVrmOpen(true);
              }}
              onOpenBackground3d={() => {
                dismissQuickStart();
                setBg3dOpen(true);
              }}
              onOpenBubble={() => openQuickStartMenu("bubble")}
              onSmartShape={() => {
                dismissQuickStart();
                setQuickShapeActive(true);
                activateCanvasTool("draw", "pen");
                setEyedropperActive(false);
              }}
              onStartDraw={() => {
                dismissQuickStart();
                applyBuiltInBrushPreset(BRUSH_PRESETS.find((p) => p.id === "pen") ?? BRUSH_PRESETS[0]);
                setEyedropperActive(false);
              }}
              onBrushKit={(trigger) => {
                dismissQuickStart();
                openBrushCatalogFromHelp(trigger);
              }}
              onCollabFocus={() => {
                dismissQuickStart();
                setStudioUiDensity("focus");
                setLeftPanelOpen(false);
                _setRightPanelOpen(false);
              }}
              onOpenTutorials={() => {
                dismissQuickStart();
                openFeatureTutorial(null);
              }}
              shortcuts={appSettings.shortcuts}
              />
            </Suspense>
          ) : null}

          <StudioDrawingShortcutNoticeLayer
            canvasOnlyMode={canvasOnlyMode}
            drawMode={drawMode}
            hasAutosave={hasAutosave}
            noticeStore={drawingShortcutNoticeStore}
            quickShapeActive={quickShapeActive}
            tool={tool}
          />

          <button
            type="button"
            onClick={() => setQuickStartOpen(true)}
            className={cn(
              "absolute bottom-3 right-3 z-30 hidden size-9 place-items-center rounded-lg border border-line bg-panel/90 text-xs font-bold text-fg-2 shadow-md backdrop-blur transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:grid",
              canvasOnlyMode && "!hidden"
            )}
            style={
              tool === "draw" && !canvasOnlyMode
                ? { bottom: "calc(var(--studio-draw-options-height, 3.75rem) + 1.25rem)" }
                : undefined
            }
            aria-label={localizeText(t, "도구 빠른 실행", "studio.canvas.openQuickStart")}
            aria-expanded={showQuickStart}
            title={localizeText(t, "도구 빠른 실행", "studio.canvas.openQuickStart")}
          >
            <CircleHelp size={16} aria-hidden />
          </button>

          <StudioCanvasModalsOverlay
            tutorialHubOpen={tutorialHubOpen}
            setTutorialHubOpen={setTutorialHubOpen}
            tutorialInitialId={tutorialInitialId}
            handleTutorialTry={handleTutorialTry}
            openFeatureTutorial={openFeatureTutorial}
            shortcutsOpen={shortcutsOpen}
            setShortcutsOpen={setShortcutsOpen}
            appSettingsOpen={appSettingsOpen}
            setAppSettingsOpen={setAppSettingsOpen}
            appSettings={appSettings}
            appSettingsInitialTab={appSettingsInitialTab}
            setAppSettingsInitialTab={setAppSettingsInitialTab}
            appSettingsPersistenceState={appSettingsPersistenceState}
            commitAppSettings={commitAppSettings}
            retryAppSettingsPersistence={retryAppSettingsPersistence}
            historyPanelOpen={historyPanelOpen}
            setHistoryPanelOpen={setHistoryPanelOpen}
            pagesHistory={pagesHistory}
            pagesHi={pagesHi}
            jumpToHistoryIndex={jumpToHistoryIndex}
            masterEditMode={masterEditMode}
            selected={selected}
            designateHistoryBrushSource={designateHistoryBrushSource}
            historyBrushSourceIndex={historyBrushSourceIndex}
            activePage={activePage}
            frameAnimOpen={frameAnimOpen}
            setFrameAnimOpen={setFrameAnimOpen}
            frameAnimEl={frameAnimEl}
            setFrameAnimTargetId={setFrameAnimTargetId}
            title={title}
            patchEl={patchEl}
            patchElCoalesced={patchElCoalesced}
            captureAnimFrame={captureAnimFrame}
            onionSkin={onionSkin}
            setOnionSkin={setOnionSkin}
            timelineOpen={timelineOpen}
            setTimelineOpen={setTimelineOpen}
            animTimeline={animTimeline}
            elements={elements}
            groups={groups}
            timelinePlayhead={timelinePlayhead}
            timelinePlaying={timelinePlaying}
            timelineFocusedTrackId={timelineFocusedTrackId}
            setTimelinePlayhead={setTimelinePlayhead}
            setTimelinePlaying={setTimelinePlaying}
            setTimelineFocusedTrackId={setTimelineFocusedTrackId}
            updateActivePage={updateActivePage}
            commitCoalesced={commitCoalesced}
            captureTimelineKeyframe={captureTimelineKeyframe}
            dialogueBatchOpen={dialogueBatchOpen}
            setDialogueBatchOpen={setDialogueBatchOpen}
            pages={pages}
            selectedId={selectedId}
            marqueeIds={marqueeIds}
            mobileKeyboardInset={mobileKeyboardInset}
            selectDialogueElement={selectDialogueElement}
            patchDialogueText={patchDialogueText}
            applyDialogueReplacePlan={applyDialogueReplacePlan}
            splitDialogueText={splitDialogueText}
            mergeDialogueTextWithNext={mergeDialogueTextWithNext}
            transferDialogueText={transferDialogueText}
            convertDialogueTextToBubble={convertDialogueTextToBubble}
            convertDialogueTextsToBubbles={convertDialogueTextsToBubbles}
            applyDialogueMultiFormat={applyDialogueMultiFormat}
            applyDialogueRuby={applyDialogueRuby}
            clearDialogueRuby={clearDialogueRuby}
            importDialogueInterchange={importDialogueInterchange}
            dialogueTranslateOpen={dialogueTranslateOpen}
            setDialogueTranslateOpen={setDialogueTranslateOpen}
            textAiConfigured={textAiConfigured}
            activeServerAiProviderLabel={activeServerAiProviderLabel}
            activeDialogueLocale={activeDialogueLocale}
            translateTargetLocale={translateTargetLocale}
            setTranslateTargetLocale={setTranslateTargetLocale}
            translateGlossary={translateGlossary}
            setTranslateGlossary={setTranslateGlossary}
            translateBusy={translateBusy}
            translateProgress={translateProgress}
            translateError={translateError}
            translateDraft={translateDraft}
            setTranslateDraft={setTranslateDraft}
            executeGenerateTranslations={executeGenerateTranslations}
            patchTranslateDraft={patchTranslateDraft}
            applyTranslationDraft={applyTranslationDraft}
            switchToDialogueLocale={switchToDialogueLocale}
            workId={workId}
            authorizedWorkAssetScopeId={authorizedWorkAssetScopeId}
            webtoonTheme={webtoonTheme}
            masterPanelOpen={masterPanelOpen}
            setMasterPanelOpen={setMasterPanelOpen}
            master={master}
            collaborationDocumentLocked={collaborationDocumentLocked}
            collaborationLockMessage={collaborationLockMessage}
            setError={setError}
            setMasterEditMode={setMasterEditMode}
            setSelectedId={setSelectedId}
            setMarqueeIds={setMarqueeIds}
            commitPages={commitPages}
            setMaster={setMaster}
            setSharedDocumentNotice={setSharedDocumentNotice}
            aiNoticeOpen={aiNoticeOpen}
            cancelAiNotice={cancelAiNotice}
            acknowledgeAiNotice={acknowledgeAiNotice}
            pageSequenceOpen={pageSequenceOpen}
            setPageSequenceOpen={setPageSequenceOpen}
            canvasOnlyMode={canvasOnlyMode}
            mobileImmersive={mobileImmersive}
            setCurrentPageId={setCurrentPageId}
            addPage={addPage}
            editingFallbackToModal={editingFallbackToModal}
            editing={editing}
            elementById={elementById}
            commitEditText={commitEditText}
            cancelEditText={cancelEditText}
            tool={tool}
          />

          <StudioCanvasControls
            canvasOnlyMode={canvasOnlyMode}
            wheelMode={appSettings.mouse.wheel}
            zoomLocked={zoomLocked}
            toggleWheelCanvasMode={toggleWheelCanvasMode}
            setZoomLocked={setZoomLocked}
            zoomOutUnavailableReason={zoomOutUnavailableReason}
            viewTransformSuppressed={viewTransformSuppressed}
            zoomOutAtLimit={zoomOutAtLimit}
            setZoom={setZoom}
            viewBusyReason={viewBusyReason}
            zoomLockedReason={zoomLockedReason}
            setActualPixelView={setActualPixelView}
            effScale={effScale}
            zoomInUnavailableReason={zoomInUnavailableReason}
            zoomInAtLimit={zoomInAtLimit}
          />
    </>
  );
}
