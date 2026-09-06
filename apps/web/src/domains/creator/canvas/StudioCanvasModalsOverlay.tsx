import { BookOpen, Keyboard } from "lucide-react";
import { Suspense, memo } from "react";

import { dialogueLocalesForPages, dialogueTranslationCoverage } from "../lettering/studio-dialogue-translate";
import { moveKeyframe, removeKeyframe, removeTrack, resolveTimelineComposite, type AnimationTimelineDoc } from "../studio-anim-tracks";
import { defaultStudioAppSettings, type StudioAppSettings, type StudioAppSettingsTab } from "../studio-app-settings";
import { elementLabel } from "../studio-element-label";
import { MAX_ANIM_FRAMES, type OnionSkinSettings } from "../studio-frame-animation";
import { computeHistoryBrushAvailability } from "../studio-history-brush";
import { isEffectivelyHidden, isEffectivelyLocked, type LayerGroup } from "../studio-layers";
import { createEmptyDocumentMaster, togglePageHideMaster, type DocumentMaster } from "../studio-master-page";
import {
  StudioAnimTimelinePanel,
  StudioAppSettingsPanel,
  StudioDialogueBatchPanel,
  StudioDialogueTranslatePanel,
  StudioFeatureTutorialHub,
  StudioFrameAnimationPanel,
  StudioHistoryPanel,
  StudioMasterPagePanel,
  StudioShortcutsHelp,
  StudioTextEditFallbackModal,
} from "../studio-page-lazy-ui";
import { pageDisplayName } from "../studio-page-meta";
import { StudioPageSequenceStrip } from "../StudioPageSequenceStrip";

import { localizeText } from "./studio-canvas-viewport-primitives";
import { AiAssetNotice } from "./StudioCanvasAiAssetNotice";
import type {
  StudioCanvasViewportHandlers,
  StudioCanvasViewportProps,
} from "./StudioCanvasViewportTypes";

import type { El, ImageEl } from "../studio-element-model";

import { useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";

export interface StudioCanvasModalsOverlayProps {
  tutorialHubOpen: boolean;
  setTutorialHubOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  tutorialInitialId: string | null;
  handleTutorialTry: StudioCanvasViewportHandlers["handleTutorialTry"];
  openFeatureTutorial: (tutorialId?: string | null) => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  appSettingsOpen: boolean;
  setAppSettingsOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  appSettings: StudioAppSettings;
  appSettingsInitialTab: StudioAppSettingsTab;
  setAppSettingsInitialTab: import("react").Dispatch<import("react").SetStateAction<StudioAppSettingsTab>>;
  appSettingsPersistenceState: "loading" | "saved" | "session-only";
  commitAppSettings: (next: StudioAppSettings) => void;
  retryAppSettingsPersistence: () => void;
  historyPanelOpen: boolean;
  setHistoryPanelOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  pagesHistory: StudioCanvasViewportProps["pagesHistory"];
  pagesHi: number;
  jumpToHistoryIndex: (index: number) => void;
  masterEditMode: boolean;
  selected: El | null;
  designateHistoryBrushSource: (index: number) => void;
  historyBrushSourceIndex: number | null;
  activePage: StudioCanvasViewportProps["activePage"];
  frameAnimOpen: boolean;
  setFrameAnimOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  frameAnimEl: ImageEl | null;
  setFrameAnimTargetId: import("react").Dispatch<import("react").SetStateAction<string | null>>;
  title: string;
  patchEl: StudioCanvasViewportHandlers["patchEl"];
  patchElCoalesced: StudioCanvasViewportHandlers["patchElCoalesced"];
  captureAnimFrame: StudioCanvasViewportHandlers["captureAnimFrame"];
  onionSkin: OnionSkinSettings;
  setOnionSkin: import("react").Dispatch<import("react").SetStateAction<OnionSkinSettings>>;
  timelineOpen: boolean;
  setTimelineOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  animTimeline: AnimationTimelineDoc;
  elements: El[];
  groups: LayerGroup[];
  timelinePlayhead: number;
  timelinePlaying: boolean;
  timelineFocusedTrackId: string | null;
  setTimelinePlayhead: import("react").Dispatch<import("react").SetStateAction<number>>;
  setTimelinePlaying: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setTimelineFocusedTrackId: import("react").Dispatch<import("react").SetStateAction<string | null>>;
  updateActivePage: StudioCanvasViewportHandlers["updateActivePage"];
  commitCoalesced: StudioCanvasViewportHandlers["commitCoalesced"];
  captureTimelineKeyframe: StudioCanvasViewportHandlers["captureTimelineKeyframe"];
  dialogueBatchOpen: boolean;
  setDialogueBatchOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  pages: StudioCanvasViewportProps["pages"];
  selectedId: string | null;
  marqueeIds: string[];
  mobileKeyboardInset: number;
  selectDialogueElement: StudioCanvasViewportHandlers["selectDialogueElement"];
  patchDialogueText: StudioCanvasViewportHandlers["patchDialogueText"];
  applyDialogueReplacePlan: StudioCanvasViewportHandlers["applyDialogueReplacePlan"];
  splitDialogueText: (pageId: string, elementId: string, text: string, offset: number) => void;
  mergeDialogueTextWithNext: (pageId: string, elementId: string, text: string) => void;
  transferDialogueText: (
    sourcePageId: string,
    elementId: string,
    targetPageId: string,
    mode: "move" | "copy",
    text: string
  ) => void;
  convertDialogueTextToBubble: (pageId: string, elementId: string) => void;
  convertDialogueTextsToBubbles: (requests: readonly { pageId: string; elementId: string }[]) => void;
  applyDialogueMultiFormat: (
    elementIds: readonly string[],
    patch: {
      fontSize?: number;
      fontStyle?: "normal" | "bold" | "italic" | "bold italic";
      textColor?: string;
      align?: "left" | "center" | "right";
    }
  ) => void;
  applyDialogueRuby: (
    pageId: string,
    elId: string,
    text: string,
    start: number,
    end: number,
    ruby: string
  ) => void;
  clearDialogueRuby: (
    pageId: string,
    elId: string,
    text: string,
    start: number,
    end: number
  ) => void;
  importDialogueInterchange: StudioCanvasViewportHandlers["importDialogueInterchange"];
  dialogueTranslateOpen: StudioCanvasViewportProps["dialogueTranslateOpen"];
  setDialogueTranslateOpen: StudioCanvasViewportProps["setDialogueTranslateOpen"];
  /** 말풍선 테마 — 현지화 QA 의 넘침 판정이 렌더와 같은 행간·자간 기본값을 쓰게 한다. */
  webtoonTheme: StudioCanvasViewportProps["webtoonTheme"];
  textAiConfigured: boolean;
  activeServerAiProviderLabel: string;
  activeDialogueLocale: string;
  translateTargetLocale: string;
  setTranslateTargetLocale: import("react").Dispatch<import("react").SetStateAction<string>>;
  translateGlossary: string;
  setTranslateGlossary: import("react").Dispatch<import("react").SetStateAction<string>>;
  translateBusy: boolean;
  translateProgress: { done: number; total: number; } | null;
  translateError: string | null;
  translateDraft: Map<string, string> | null;
  setTranslateDraft: import("react").Dispatch<import("react").SetStateAction<Map<string, string> | null>>;
  executeGenerateTranslations: () => Promise<void>;
  patchTranslateDraft: (id: string, text: string) => void;
  applyTranslationDraft: () => void;
  switchToDialogueLocale: (locale: string) => void;
  workId: string | null;
  authorizedWorkAssetScopeId: string | null;
  masterPanelOpen: boolean;
  setMasterPanelOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  master: DocumentMaster<El>;
  collaborationDocumentLocked: boolean;
  collaborationLockMessage: () => string;
  setError: import("react").Dispatch<import("react").SetStateAction<string | null>>;
  setMasterEditMode: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setSelectedId: import("react").Dispatch<import("react").SetStateAction<string | null>>;
  setMarqueeIds: import("react").Dispatch<import("react").SetStateAction<string[]>>;
  commitPages: StudioCanvasViewportHandlers["commitPages"];
  setMaster: StudioCanvasViewportHandlers["setMaster"];
  setSharedDocumentNotice: import("react").Dispatch<import("react").SetStateAction<string | null>>;
  aiNoticeOpen: boolean;
  cancelAiNotice: () => void;
  acknowledgeAiNotice: () => void;
  pageSequenceOpen: boolean;
  setPageSequenceOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  canvasOnlyMode: boolean;
  mobileImmersive: boolean;
  setCurrentPageId: (value: import("react").SetStateAction<string>) => boolean;
  addPage: () => void;
  editingFallbackToModal: boolean;
  editing: { id: string; } | null;
  elementById: Map<string, El>;
  commitEditText: (finalValue: string) => void;
  cancelEditText: () => void;
  tool: StudioCanvasViewportProps["tool"];
}

export const StudioCanvasModalsOverlay = memo(function StudioCanvasModalsOverlay({
  tutorialHubOpen,
  setTutorialHubOpen,
  tutorialInitialId,
  handleTutorialTry,
  openFeatureTutorial,
  shortcutsOpen,
  setShortcutsOpen,
  appSettingsOpen,
  setAppSettingsOpen,
  appSettings,
  appSettingsInitialTab,
  setAppSettingsInitialTab,
  appSettingsPersistenceState,
  commitAppSettings,
  retryAppSettingsPersistence,
  historyPanelOpen,
  setHistoryPanelOpen,
  pagesHistory,
  pagesHi,
  jumpToHistoryIndex,
  masterEditMode,
  selected,
  designateHistoryBrushSource,
  historyBrushSourceIndex,
  activePage,
  frameAnimOpen,
  setFrameAnimOpen,
  frameAnimEl,
  setFrameAnimTargetId,
  title,
  patchEl,
  patchElCoalesced,
  captureAnimFrame,
  onionSkin,
  setOnionSkin,
  timelineOpen,
  setTimelineOpen,
  animTimeline,
  elements,
  groups,
  timelinePlayhead,
  timelinePlaying,
  timelineFocusedTrackId,
  setTimelinePlayhead,
  setTimelinePlaying,
  setTimelineFocusedTrackId,
  updateActivePage,
  commitCoalesced,
  captureTimelineKeyframe,
  dialogueBatchOpen,
  setDialogueBatchOpen,
  pages,
  selectedId,
  marqueeIds,
  mobileKeyboardInset,
  selectDialogueElement,
  patchDialogueText,
  applyDialogueReplacePlan,
  splitDialogueText,
  mergeDialogueTextWithNext,
  transferDialogueText,
  convertDialogueTextToBubble,
  convertDialogueTextsToBubbles,
  applyDialogueMultiFormat,
  applyDialogueRuby,
  clearDialogueRuby,
  importDialogueInterchange,
  dialogueTranslateOpen,
  setDialogueTranslateOpen,
  webtoonTheme,
  textAiConfigured,
  activeServerAiProviderLabel,
  activeDialogueLocale,
  translateTargetLocale,
  setTranslateTargetLocale,
  translateGlossary,
  setTranslateGlossary,
  translateBusy,
  translateProgress,
  translateError,
  translateDraft,
  setTranslateDraft,
  executeGenerateTranslations,
  patchTranslateDraft,
  applyTranslationDraft,
  switchToDialogueLocale,
  workId,
  authorizedWorkAssetScopeId,
  masterPanelOpen,
  setMasterPanelOpen,
  master,
  collaborationDocumentLocked,
  collaborationLockMessage,
  setError,
  setMasterEditMode,
  setSelectedId,
  setMarqueeIds,
  commitPages,
  setMaster,
  setSharedDocumentNotice,
  aiNoticeOpen,
  cancelAiNotice,
  acknowledgeAiNotice,
  pageSequenceOpen,
  setPageSequenceOpen,
  canvasOnlyMode,
  mobileImmersive,
  setCurrentPageId,
  addPage,
  editingFallbackToModal,
  editing,
  elementById,
  commitEditText,
  cancelEditText,
  tool,
}: StudioCanvasModalsOverlayProps) {
  const t = useT();

  return (
    <>
      <button
        type="button"
        onClick={() => setShortcutsOpen(true)}
        className={cn(
          "absolute bottom-3 right-14 z-30 hidden size-9 place-items-center rounded-lg border border-line bg-panel/90 text-sm text-fg-2 shadow-md backdrop-blur transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:grid",
          canvasOnlyMode && "!hidden"
        )}
        style={
          tool === "draw" && !canvasOnlyMode
            ? { bottom: "calc(var(--studio-draw-options-height, 3.75rem) + 1.25rem)" }
            : undefined
        }
        aria-label={t("studio.shortcuts.row.view.help")}
        title={t("studio.shortcuts.row.view.help")}
      >
        <Keyboard size={16} aria-hidden />
      </button>

      <button
        type="button"
        onClick={() => openFeatureTutorial(null)}
        className={cn(
          "absolute bottom-3 right-[6.5rem] z-30 hidden size-9 place-items-center rounded-lg border border-line bg-panel/90 text-fg-2 shadow-md backdrop-blur transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:grid",
          canvasOnlyMode && "!hidden"
        )}
        style={
          tool === "draw" && !canvasOnlyMode
            ? { bottom: "calc(var(--studio-draw-options-height, 3.75rem) + 1.25rem)" }
            : undefined
        }
        aria-label={t("studio.mainMenu.item.view.feature-tutorials")}
        aria-expanded={tutorialHubOpen}
        title={t("studio.mainMenu.item.view.feature-tutorials")}
      >
        <BookOpen size={15} aria-hidden />
      </button>

      {tutorialHubOpen && (
        <Suspense fallback={null}>
          <StudioFeatureTutorialHub
            open={tutorialHubOpen}
            onClose={() => setTutorialHubOpen(false)}
            initialTutorialId={tutorialInitialId}
            onTryAction={handleTutorialTry}
          />
        </Suspense>
      )}

      {shortcutsOpen ? (
        <Suspense fallback={null}>
          <StudioShortcutsHelp open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} shortcuts={appSettings.shortcuts} />
        </Suspense>
      ) : null}
      {appSettingsOpen ? (
        <Suspense fallback={null}>
          <StudioAppSettingsPanel
            open={appSettingsOpen}
            settings={appSettings}
            initialTab={appSettingsInitialTab}
            persistenceState={appSettingsPersistenceState}
            onClose={() => {
              const restoreMoreToolsFocus = appSettingsInitialTab === "toolbar";
              setAppSettingsOpen(false);
              setAppSettingsInitialTab("general");
              if (restoreMoreToolsFocus) {
                requestAnimationFrame(() => {
                  document
                    .querySelector<HTMLElement>('[aria-label="더보기 · 툴바 설정"]')
                    ?.focus();
                });
              }
            }}
            onChange={commitAppSettings}
            onRetryPersistence={retryAppSettingsPersistence}
            onResetAll={() => {
              commitAppSettings(defaultStudioAppSettings());
            }}
          />
        </Suspense>
      ) : null}
      {historyPanelOpen && (
        <Suspense fallback={null}>
          <StudioHistoryPanel
            history={pagesHistory}
            currentIndex={pagesHi}
            onJumpTo={jumpToHistoryIndex}
            onClose={() => setHistoryPanelOpen(false)}
            onDesignateBrushSource={
              !masterEditMode && selected?.type === "image" ? designateHistoryBrushSource : undefined
            }
            brushSourceIndex={historyBrushSourceIndex}
            brushSourceAvailability={
              !masterEditMode && selected?.type === "image"
                ? computeHistoryBrushAvailability(pagesHistory, activePage.id, selected.id)
                : undefined
            }
          />
        </Suspense>
      )}
      {frameAnimOpen && frameAnimEl && (
        <Suspense fallback={null}>
          <StudioFrameAnimationPanel
            element={frameAnimEl}
            title={title}
            onClose={() => {
              setFrameAnimOpen(false);
              setFrameAnimTargetId(null);
            }}
            onFramesChange={(frames) => patchEl(frameAnimEl.id, { frames })}
            onSettingsChange={(patch) => patchEl(frameAnimEl.id, patch)}
            onActiveFrameChange={(frameId) => {
              const frame = frameAnimEl.frames?.find((f) => f.id === frameId);
              if (!frame) return;
              patchElCoalesced(frameAnimEl.id, { activeFrameId: frameId, src: frame.src }, `frame-nav-${frameAnimEl.id}`);
            }}
            onCaptureFrame={() => void captureAnimFrame(frameAnimEl.id)}
            captureDisabledReason={
              frameAnimEl.rotation
                ? localizeText(t, "회전이 0°인 셀만 프레임을 캡처할 수 있어요.", "studio.canvas.frameAnimationRotateOnly")
                : (frameAnimEl.frames?.length ?? 0) >= MAX_ANIM_FRAMES
                  ? localizeText(t, "프레임은 최대 60장까지 만들 수 있어요.", "studio.canvas.frameAnimationFrameLimit")
                  : null
            }
            onRemoveAnimation={() => {
              patchEl(frameAnimEl.id, { frames: undefined, frameFps: undefined, frameLoop: undefined, activeFrameId: undefined });
              setFrameAnimOpen(false);
              setFrameAnimTargetId(null);
            }}
            onionSkin={onionSkin}
            onOnionSkinChange={setOnionSkin}
          />
        </Suspense>
      )}
      {timelineOpen && (
        <Suspense fallback={null}>
          <StudioAnimTimelinePanel
            doc={animTimeline}
            rows={elements
              .slice()
              .reverse()
              .map((el) => ({
                id: el.id,
                label: elementLabel(el),
                eligible: el.type === "image" && !((el as ImageEl).frames && (el as ImageEl).frames!.length > 1),
                hidden: isEffectivelyHidden(el, groups),
                locked: isEffectivelyLocked(el, groups),
              }))}
            playhead={timelinePlayhead}
            playing={timelinePlaying}
            focusedTrackId={timelineFocusedTrackId}
            onionSkin={onionSkin}
            onOnionSkinChange={setOnionSkin}
            onClose={() => setTimelineOpen(false)}
            onDocChange={(next) => updateActivePage({ animTimeline: next })}
            onScrub={(frameIndex) => {
              setTimelinePlayhead(frameIndex);
              const composite = resolveTimelineComposite(
                animTimeline,
                elements.map((e) => e.id),
                frameIndex
              );
              if (composite.size === 0) return;
              commitCoalesced(
                elements.map((e) => (composite.has(e.id) ? ({ ...e, src: composite.get(e.id)!.src } as El) : e)),
                "timeline-scrub"
              );
            }}
            onTogglePlay={() => setTimelinePlaying((v) => !v)}
            onFocusTrack={setTimelineFocusedTrackId}
            onAddKeyframe={(trackId) => void captureTimelineKeyframe(trackId, timelinePlayhead)}
            onRemoveKeyframe={(trackId, frameIndex) =>
              updateActivePage({ animTimeline: removeKeyframe(animTimeline, trackId, frameIndex) })
            }
            onMoveKeyframe={(trackId, from, to) =>
              updateActivePage({ animTimeline: moveKeyframe(animTimeline, trackId, from, to) })
            }
            onRemoveTrack={(trackId) => updateActivePage({ animTimeline: removeTrack(animTimeline, trackId) })}
          />
        </Suspense>
      )}
      {dialogueBatchOpen && (
        <Suspense fallback={null}>
          <StudioDialogueBatchPanel
            pages={pages}
            currentPageId={activePage.id}
            selectedId={selectedId}
            selectedIds={marqueeIds.length > 0 ? marqueeIds : selectedId ? [selectedId] : []}
            mobileKeyboardInset={mobileKeyboardInset}
            onClose={() => setDialogueBatchOpen(false)}
            onSelectElement={selectDialogueElement}
            onPatchText={patchDialogueText}
            onApplyReplace={applyDialogueReplacePlan}
            onSplitText={splitDialogueText}
            onMergeWithNext={mergeDialogueTextWithNext}
            onTransferElement={transferDialogueText}
            onConvertTextToBubble={convertDialogueTextToBubble}
            onConvertTextsToBubbles={convertDialogueTextsToBubbles}
            onApplyFormat={applyDialogueMultiFormat}
            onApplyDialogueRuby={applyDialogueRuby}
            onClearDialogueRuby={clearDialogueRuby}
            onImportInterchange={importDialogueInterchange}
          />
        </Suspense>
      )}
      {dialogueTranslateOpen && (
        <Suspense fallback={null}>
          <StudioDialogueTranslatePanel
            pages={pages}
            configured={textAiConfigured}
            providerLabel={activeServerAiProviderLabel}
            activeLocale={activeDialogueLocale}
            availableLocales={dialogueLocalesForPages(pages)}
            coverageFor={(locale) => dialogueTranslationCoverage(pages, locale)}
            targetLocale={translateTargetLocale}
            onTargetLocaleChange={setTranslateTargetLocale}
            glossary={translateGlossary}
            onGlossaryChange={setTranslateGlossary}
            busy={translateBusy}
            progress={translateProgress}
            error={translateError}
            draft={translateDraft}
            onGenerate={() => void executeGenerateTranslations()}
            onDraftChange={patchTranslateDraft}
            onApplyDraft={applyTranslationDraft}
            onDiscardDraft={() => setTranslateDraft(null)}
            onSwitchLocale={switchToDialogueLocale}
            onClose={() => setDialogueTranslateOpen(false)}
            workScope={workId ?? authorizedWorkAssetScopeId ?? undefined}
            qaOpen={dialogueTranslateOpen === "qa"}
            onQaOpenChange={(open) => setDialogueTranslateOpen(open ? "qa" : "translate")}
            webtoonTheme={webtoonTheme}
            onRevealCue={selectDialogueElement}
          />
        </Suspense>
      )}
      {masterPanelOpen && (
        <Suspense fallback={null}>
          <StudioMasterPagePanel
            editMode={masterEditMode}
            masterCount={master.elements.length}
            pages={pages}
            currentPageId={activePage.id}
            onToggleEditMode={() => {
              if (collaborationDocumentLocked) {
                setError(collaborationLockMessage());
                return;
              }
              setMasterEditMode((v) => !v);
              setSelectedId(null);
              setMarqueeIds([]);
            }}
            onToggleHideMaster={(pageId) => commitPages(togglePageHideMaster(pages, pageId))}
            onClearMaster={() => {
              if (collaborationDocumentLocked) {
                setError(collaborationLockMessage());
                return;
              }
              setMaster(createEmptyDocumentMaster<El>());
              setSharedDocumentNotice(null);
              setSelectedId(null);
              setMarqueeIds([]);
            }}
            onClose={() => {
              setMasterPanelOpen(false);
              setMasterEditMode(false);
              setSelectedId(null);
              setMarqueeIds([]);
            }}
          />
        </Suspense>
      )}

      {aiNoticeOpen && (
        <AiAssetNotice onCancel={cancelAiNotice} onAcknowledge={acknowledgeAiNotice} />
      )}

      <StudioPageSequenceStrip
        open={pageSequenceOpen && !canvasOnlyMode && !mobileImmersive}
        pages={pages.map((page, index) => ({
          id: page.id,
          label: pageDisplayName(page, index),
          thumbnailUrl: null,
        }))}
        currentPageId={activePage.id}
        onSelectPage={(pageId) => {
          if (!setCurrentPageId(pageId)) return;
          setSelectedId(null);
          setMarqueeIds([]);
        }}
        onAddPage={collaborationDocumentLocked ? undefined : addPage}
        onClose={() => setPageSequenceOpen(false)}
      />

      {editingFallbackToModal ? (
        <Suspense fallback={null}>
          <StudioTextEditFallbackModal
            key={editing!.id}
            elementId={editing!.id}
            elementById={elementById}
            onCommit={commitEditText}
            onCancel={cancelEditText}
          />
        </Suspense>
      ) : null}
    </>
  );
});
