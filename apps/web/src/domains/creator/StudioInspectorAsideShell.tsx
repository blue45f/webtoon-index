import {
  ChevronRight,
  Loader2,
  Move,
  PanelRight,
} from "lucide-react";
import { Suspense, useState } from "react";

import { StudioLayerBorderEffectPanel } from "./layer/StudioLayerBorderEffectPanel";
import { StudioLayerCompsPanel } from "./layer/StudioLayerCompsPanel";
import { StudioLayerTonePanel } from "./layer/StudioLayerTonePanel";
import { StudioSubViewPanel } from "./subview/StudioSubViewPanel";
import { CANVAS_W } from "./studio-assets";
import { elBounds } from "./studio-element-geometry";
import { elementLabel } from "./studio-element-label";
import { openStudioHelpCenter } from "./studio-help-center-channel";
import { uid } from "./studio-id";
import { normalizeStudioInspectorLayout } from "./studio-inspector-layout";
import {
  requestStudioInspectorFocus,
  type StudioInspectorFocusTarget,
} from "./studio-inspector-focus";
import type { StudioInspectorTabA11y } from "./studio-inspector-tab-a11y";
import { executeStudioInspectorRouteTransition } from "./studio-inspector-tool-transition";
import { isEffectivelyHidden } from "./studio-layers";
import { studioMobileSheetSizeStyle } from "./studio-mobile-sheet-snap";
import { resolveStudioTemplateGutterCapability } from "./studio-template-gutter-layout";
import {
  DEFAULT_STUDIO_INSPECTOR_FLOATING_LAYOUT,
  loadStudioDetachablePanelState,
  saveStudioDetachablePanelState,
} from "./studio-detachable-panels";
import { StudioLayerNavigator } from "./studio-page-lazy-ui";
import { STUDIO_WORKSPACE_RIGHT_PANEL_WIDTH } from "./studio-workspaces";
import { STUDIO_INSPECTOR_LAYER_SPLIT_MIN_WIDTH } from "./studio-workspace-layout-metrics";
import { StudioCommandSearchHost } from "./StudioCommandSearchHost";
import { StudioDetachablePanelSlot } from "./StudioDetachablePanelSlot";
import { StudioInspectorCanvasControls } from "./StudioInspectorCanvasControls";
import { StudioInspectorNavigator } from "./StudioInspectorNavigator";
import {
  StudioInspectorDisabledReasons,
  StudioInspectorPageGradeSurface,
  StudioInspectorPublishPanel,
} from "./StudioInspectorUtilityPanels";
import { StudioMinimapViewportBox } from "./StudioMinimapViewportBox";
import { StudioMobileSheetHandle } from "./StudioMobileSheetHandle";

import type { El } from "./studio-element-model";
import type { StudioInspectorAsideModel } from "./useStudioInspectorAsideModel";
import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

function isDrawingInspectorFocusTarget(
  target: StudioInspectorFocusTarget,
): boolean {
  return target === "tool.brush-studio"
    || target === "tool.brush-engines"
    || target === "brush.saved-library";
}

export function StudioInspectorAsideShell({
  model,
  children,
  tabA11y,
}: {
  model: StudioInspectorAsideModel;
  children: ReactNode;
  tabA11y: StudioInspectorTabA11y;
}) {
  const {
    activeImageRasterPolicy,
    activateCanvasTool,
    applyBgPreset,
    applyMagicResizePreset,
    applyPageGrade,
    applyPaperTintBackground,
    bg,
    bgGrad,
    canvasControlsDisabled,
    canvasFlipH,
    canvasH,
    canvasRotation,
    changeInspectorLayout,
    commit,
    currentPageId,
    currentTemplate,
    description,
    disarmAllPixelTools,
    drawMode,
    effScale,
    elements,
    ensureWebtoonGuidesLoaded,
    gridSize,
    groups,
    handleLayerNavigatorAction,
    inspectorContentMode,
    inspectorDrawing,
    inspectorInteractionPolicy,
    inspectorLayout,
    inspectorTransientState,
    isMobile,
    layerNavigatorItems,
    localHiddenElementIds,
    magicResizeStrategy,
    marqueeIds,
    masterEditMode,
    mobileInspectorSnap,
    mobileSheet,
    onMinimapClick,
    onMinimapKeyDown,
    openFeatureTutorial,
    pageGrade,
    pageGradeActive,
    pageGradePanelOpen,
    panelGutter,
    paperGrainKind,
    paperGrainVisible,
    patchEl,
    patchPageGrade,
    propsSheetRef,
    regenerateTemplate,
    resetPageGrade,
    rightPanelDisabledReasons,
    rightResize,
    safeMobileKeyboardInset,
    saving,
    scrollViewportStore,
    selectLayersFromNavigator,
    selected,
    selectedSupportsImageInspectorTabs,
    selectedId,
    setBg,
    setBgGrad,
    setCanvasH,
    setColor,
    setDescription,
    setGridSize,
    setMagicResizeStrategy,
    setMenu,
    setMobileInspectorSnap,
    setMobileSheet,
    setPageGradePanelOpen,
    setPanelGutter,
    setPaperGrainKind,
    setPaperGrainVisible,
    setRightPanelOpen,
    setSharedDocumentNotice,
    setShowAlignmentGuides,
    setShowGrid,
    setShowWebtoonGuides,
    setSnapEnabled,
    setTagsText,
    setTitle,
    setUnselectedImageToolsVisible,
    unselectedImageToolsVisible,
    setUserGuides,
    setWebtoonTheme,
    showAlignmentGuides,
    showGrid,
    showWebtoonGuides,
    snapEnabled,
    soloLayerId,
    tagsText,
    title,
    titleInputRef,
    pendingSaveIntent,
    onContinuePendingSave,
    onClearWorkMetadataError,
    toggleLayerSolo,
    toggleLocalHidden,
    userGuides,
    visibleRightPanelOpen,
    webtoonGuides,
    webtoonTheme,
    withCanvasControlsGuard,
  } = model;
  const templateGutterCapability = resolveStudioTemplateGutterCapability(currentTemplate);
  /**
   * 넓은 패널(≥ 420px)에서는 대상 속성 아래에 레이어 목록을 함께 둔다(UX 감사 2026-09-02
   * §5.8 레이어). 웹툰 작업은 레이어 순서와 선택 속성을 반복해 오가는데, 두 탭이 상호 배타라
   * 왕복마다 탭 전환을 청구하고 있었다. 좁은 패널과 모바일 시트는 탭 모델을 그대로 쓴다.
   */
  const layersSplitWithProperties =
    !isMobile
    && inspectorLayout.primary === "properties"
    && rightResize.width >= STUDIO_INSPECTOR_LAYER_SPLIT_MIN_WIDTH;
  const layersPaneMounted = inspectorLayout.primary === "layers" || layersSplitWithProperties;
  const [detached, setDetached] = useState(() =>
    loadStudioDetachablePanelState("inspector")
  );
  const desktopDetached = !isMobile && detached;
  const setInspectorDetached = (next: boolean): void => {
    setDetached(next);
    saveStudioDetachablePanelState("inspector", next);
    if (next) setRightPanelOpen(true);
  };
  return (
    <StudioDetachablePanelSlot
      detached={desktopDetached && visibleRightPanelOpen}
      surfaceId="inspector"
      label="작업 패널"
      defaultLayout={DEFAULT_STUDIO_INSPECTOR_FLOATING_LAYOUT}
      minWidth={360}
      minHeight={480}
      maxWidth={920}
      maxHeight={1_100}
      allowedDockEdges={["left", "right"]}
      onClose={() => setRightPanelOpen(false)}
    >
        <aside
          id="studio-inspector"
          ref={propsSheetRef}
          role={isMobile ? "dialog" : "region"}
          aria-modal={isMobile && mobileSheet === "props" ? true : undefined}
          data-studio-sheet-id="props"
          data-studio-panel-detached={desktopDetached ? "true" : undefined}
          data-studio-mobile-sheet={isMobile && mobileSheet === "props" ? "true" : undefined}
          data-studio-sheet-snap={isMobile ? mobileInspectorSnap : undefined}
          data-popup-kind={isMobile && mobileSheet === "props" ? "sheet" : undefined}
          aria-label="작업 패널"
          tabIndex={-1}
          inert={isMobile && mobileSheet !== "props" ? true : undefined}
          className={cn(
            "flex min-h-0 flex-col gap-2 overscroll-contain [scrollbar-gutter:stable]",
            "fixed inset-x-0 bottom-0 z-[60] overflow-y-auto rounded-t-3xl border border-line bg-panel p-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl transition-[transform,height,max-height] duration-300 ease-out motion-reduce:transition-none",
            "lg:static lg:z-auto lg:max-h-none lg:min-h-0 lg:flex-none lg:self-stretch lg:overflow-y-auto lg:rounded-none lg:border lg:border-y-0 lg:border-r-0 lg:border-line lg:bg-panel/50 lg:p-2 lg:shadow-none lg:transition-none lg:translate-y-0",
            mobileSheet === "props" ? "translate-y-0" : "translate-y-full",
            desktopDetached && "lg:h-full lg:w-full lg:flex-1 lg:self-auto lg:border-0 lg:bg-transparent lg:p-0",
            !visibleRightPanelOpen && "lg:hidden",
            inspectorLayout.primary === "layers" && "overflow-hidden lg:overflow-hidden",
            inspectorDrawing &&
              inspectorLayout.primary === "properties" &&
              "lg:overflow-hidden"
          )}
          style={
            isMobile
              ? {
                  bottom: safeMobileKeyboardInset,
                  ...studioMobileSheetSizeStyle(
                    mobileInspectorSnap,
                    safeMobileKeyboardInset,
                  ),
                }
              : desktopDetached
                ? { width: "100%", minWidth: 0 }
                : { width: rightResize.width, minWidth: STUDIO_WORKSPACE_RIGHT_PANEL_WIDTH.minimum }
          }
        >
          <StudioCommandSearchHost
            hideTrigger={isMobile}
            onRequestOpen={() => setRightPanelOpen(true)}
            inspectorContext={{
              hasSelection: inspectorContentMode === "selection",
              selectedType:
                inspectorContentMode === "selection" ? selected?.type ?? null : null,
              drawing: inspectorDrawing,
              drawingToolPropertiesAvailable:
                drawMode !== "shape" && drawMode !== "pixel",
              imageToolsAvailable: true,
            }}
            trailing={
              isMobile ? null : (
                <div className="mr-1 hidden shrink-0 items-center gap-1 lg:flex">
                  <button
                    type="button"
                    onClick={() => setInspectorDetached(!detached)}
                    aria-label={detached
                      ? "작업 패널을 오른쪽 패널에 붙이기"
                      : "작업 패널을 창으로 분리"}
                    aria-pressed={desktopDetached}
                    className="inline-flex min-h-9 items-center gap-1 rounded px-2 text-[0.65rem] text-fg-3 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    title={detached ? "오른쪽 패널에 붙이기" : "자유 배치 창으로 분리"}
                  >
                    {detached ? <PanelRight size={12} aria-hidden /> : <Move size={12} aria-hidden />}
                    {detached ? "붙이기" : "분리"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRightPanelOpen(false)}
                    aria-label="작업 패널 접기"
                    className="inline-flex min-h-9 items-center gap-0.5 rounded px-1.5 text-[0.65rem] text-fg-3 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    title="작업 패널 접기"
                  >
                    접기 <ChevronRight size={12} aria-hidden />
                  </button>
                </div>
              )
            }
            onNavigateInspector={(route, focusTarget) => {
              setRightPanelOpen(true);
              const drawingFocusTarget = focusTarget
                ? isDrawingInspectorFocusTarget(focusTarget)
                : false;
              if (drawingFocusTarget) activateCanvasTool("draw", "pen");
              // Command Search and other deep links can request an image-tool route while a
              // text/frame (or no) layer is selected. Preserve that explicit intent so the
              // recovery surface mounts instead of advertising a route that appears to do nothing.
              const imageRouteRequested =
                route.primary === "properties" && route.image !== undefined;
              if (imageRouteRequested) {
                if (inspectorDrawing) activateCanvasTool("select");
                if (!selectedSupportsImageInspectorTabs) {
                  setUnselectedImageToolsVisible(true);
                }
              }
              changeInspectorLayout(
                normalizeStudioInspectorLayout({ ...inspectorLayout, ...route }),
              );
              const focusTargetAvailable = focusTarget && (
                drawingFocusTarget
                || focusTarget.startsWith("canvas.")
                || inspectorContentMode === "selection"
              );
              if (focusTargetAvailable) {
                globalThis.requestAnimationFrame?.(() => {
                  requestStudioInspectorFocus(focusTarget);
                });
              }
            }}
            onOpenTutorial={(tutorialId) => openFeatureTutorial(tutorialId)}
            onExpandPalette={(paletteId) => {
              setRightPanelOpen(true);
              activateCanvasTool("draw", "pen");
              changeInspectorLayout(
                normalizeStudioInspectorLayout({
                  ...inspectorLayout,
                  primary: "properties",
                }),
              );
              globalThis.requestAnimationFrame?.(() => {
                requestStudioInspectorFocus(
                  paletteId === "sub-tools"
                    ? "palette.sub-tools"
                    : "palette.tool-properties",
                );
              });
            }}
            onOpenHelp={(_helpNodeId, commandId) =>
              openStudioHelpCenter({
                section: "current-tool",
                toolCommandId: commandId,
              })
            }
          />
          <StudioInspectorNavigator
            layout={inspectorLayout}
            tabA11y={tabA11y}
            selectedType={
              inspectorContentMode === "selection" ? selected?.type ?? null : null
            }
            selectionLabel={
              inspectorContentMode === "selection" && selected
                ? elementLabel(selected)
                : null
            }
            selectionCount={
              inspectorContentMode === "selection"
                ? Math.max(1, marqueeIds.length)
                : 0
            }
            drawing={inspectorDrawing}
            drawingToolPropertiesAvailable={
              drawMode !== "shape" && drawMode !== "pixel"
            }
            imageToolsAvailable={
              marqueeIds.length <= 1 &&
              (selectedSupportsImageInspectorTabs || unselectedImageToolsVisible)
            }
            imageToolsStatusLabel={activeImageRasterPolicy?.statusLabel}
            imageToolsStatusDescription={activeImageRasterPolicy?.description}
            imageToolsStatusTone={
              activeImageRasterPolicy?.state === "ready"
                ? "good"
                : activeImageRasterPolicy?.selectable
                  ? "accent"
                  : activeImageRasterPolicy
                    ? "warn"
                    : undefined
            }
            layerCount={elements.length}
            mobileSheetHandle={
              <StudioMobileSheetHandle
                active={isMobile && mobileSheet === "props"}
                kind="props"
                label="작업 패널"
                onDismiss={() => setMobileSheet(null)}
                onSnapChange={setMobileInspectorSnap}
                sheetRef={propsSheetRef}
                snap={mobileInspectorSnap}
              />
            }
            onRequestClose={() => setMobileSheet(null)}
            onChange={(next) => {
              executeStudioInspectorRouteTransition(
                {
                  current: inspectorLayout,
                  next,
                  transient: inspectorTransientState,
                  drawing: inspectorDrawing,
                },
                {
                  disarm: disarmAllPixelTools,
                  navigate: changeInspectorLayout,
                },
              );
            }}
          />
          <StudioInspectorDisabledReasons reasons={rightPanelDisabledReasons} />
          <StudioInspectorCanvasControls
            background={bg}
            backgroundGradient={bgGrad}
            canvasHeight={canvasH}
            controlsDisabled={canvasControlsDisabled}
            controlsDisabledReason={inspectorInteractionPolicy.page.reason}
            gridSize={gridSize}
            hidden={
              inspectorLayout.primary !== "document" ||
              inspectorLayout.document !== "canvas"
            }
            panelId={tabA11y.document.canvas.panelId}
            panelLabelledBy={`${tabA11y.primary.document.tabId} ${tabA11y.document.canvas.tabId}`}
            magicResizeStrategy={magicResizeStrategy}
            masterEditMode={masterEditMode}
            panelGutter={panelGutter}
            paperGrainKind={paperGrainKind}
            paperGrainVisible={paperGrainVisible}
            showAlignmentGuides={showAlignmentGuides}
            showGrid={showGrid}
            showWebtoonGuides={showWebtoonGuides}
            snapEnabled={snapEnabled}
            templateGutterUnavailableReason={
              templateGutterCapability.supported ? null : templateGutterCapability.reason
            }
            userGuides={userGuides}
            webtoonGuides={webtoonGuides}
            webtoonTheme={webtoonTheme}
            onAddUserGuide={withCanvasControlsGuard((type, pos?: number) =>
              setUserGuides((current) => [
                ...current,
                {
                  id: uid(),
                  type,
                  pos: pos ?? (type === "v" ? CANVAS_W / 2 : canvasH / 2),
                },
              ])
            )}
            onApplyBackgroundPreset={withCanvasControlsGuard(applyBgPreset)}
            onApplyMagicResizePreset={withCanvasControlsGuard(applyMagicResizePreset)}
            onBackgroundChange={withCanvasControlsGuard(setBg)}
            onCanvasHeightDelta={withCanvasControlsGuard((delta: number) =>
              setCanvasH((height) => height + delta)
            )}
            onClearUserGuides={withCanvasControlsGuard(() => setUserGuides([]))}
            onDeleteUserGuide={withCanvasControlsGuard((nextId) =>
              setUserGuides((current) =>
                current.filter((guide) => guide.id !== nextId)
              )
            )}
            onGradientChange={withCanvasControlsGuard(setBgGrad)}
            onGridSizeChange={withCanvasControlsGuard(setGridSize)}
            onMagicResizeStrategyChange={withCanvasControlsGuard(setMagicResizeStrategy)}
            onMoveUserGuide={withCanvasControlsGuard((id, pos: number) =>
              setUserGuides((current) =>
                current.map((guide) =>
                  guide.id === id ? { ...guide, pos } : guide
                )
              )
            )}
            onOpenBackgroundEditor={withCanvasControlsGuard(() => setMenu("bgFill"))}
            onPaperGrainKindChange={withCanvasControlsGuard(setPaperGrainKind)}
            onPaperGrainVisibleChange={withCanvasControlsGuard(setPaperGrainVisible)}
            onApplyPaperTintBackground={withCanvasControlsGuard(applyPaperTintBackground)}
            onPanelGutterChange={withCanvasControlsGuard((nextGutter) => {
              if (!currentTemplate || !templateGutterCapability.supported) return;
              const nextElements = regenerateTemplate(currentTemplate, nextGutter);
              if (!nextElements) return;
              setPanelGutter(nextGutter);
              setSharedDocumentNotice(null);
              commit(nextElements);
            })}
            onShowAlignmentGuidesChange={withCanvasControlsGuard(setShowAlignmentGuides)}
            onShowGridChange={withCanvasControlsGuard(setShowGrid)}
            onShowWebtoonGuidesChange={withCanvasControlsGuard((visible: boolean) => {
              if (visible) ensureWebtoonGuidesLoaded();
              setShowWebtoonGuides(visible);
            })}
            onSnapEnabledChange={withCanvasControlsGuard(setSnapEnabled)}
            onWarmWebtoonGuides={withCanvasControlsGuard(() => ensureWebtoonGuidesLoaded())}
            onWebtoonThemeChange={withCanvasControlsGuard((theme) => {
              setWebtoonTheme(theme);
              setSharedDocumentNotice(null);
            })}
          />
          <StudioInspectorPageGradeSurface
            active={
              inspectorLayout.primary === "document" &&
              inspectorLayout.document === "grade"
            }
            expanded={pageGradePanelOpen}
            panelId={tabA11y.document.grade.panelId}
            panelLabelledBy={`${tabA11y.primary.document.tabId} ${tabA11y.document.grade.tabId}`}
            grade={pageGrade}
            gradeActive={pageGradeActive}
            gate={inspectorInteractionPolicy.page}
            onApplyPreset={applyPageGrade}
            onExpandedChange={setPageGradePanelOpen}
            onPatch={patchPageGrade}
            onReset={resetPageGrade}
          />
          {children}
          <div
            id={tabA11y.primary.layers.panelId}
            // 분할 모드에서는 탭패널이 아니라 대상 탭 아래 붙는 보조 영역이다 — 탭패널로 두면
            // 선택되지 않은 탭이 패널을 하나 더 가리키게 된다.
            role={layersSplitWithProperties ? "region" : "tabpanel"}
            aria-labelledby={layersSplitWithProperties ? undefined : tabA11y.primary.layers.tabId}
            aria-label={layersSplitWithProperties ? "레이어" : undefined}
            data-studio-inspector-layers-split={layersSplitWithProperties ? "true" : undefined}
            hidden={!layersPaneMounted}
            className={cn(
              "flex flex-col gap-2",
              layersSplitWithProperties
                ? "mt-1 h-[min(22rem,38dvh)] min-h-56 shrink-0 border-t border-line/60 pt-2"
                : "h-[min(31rem,54dvh)] min-h-72 lg:h-[calc(100dvh-28rem)] lg:min-h-72",
            )}
          >
            {layersPaneMounted ? (
              <>
                <div className="min-h-0 flex-1 [&>section]:h-full">
                  <Suspense
                    fallback={
                      <div
                        role="status"
                        aria-live="polite"
                        className="grid h-full min-h-72 place-items-center rounded-xl border border-line bg-panel/40 px-4 text-center"
                      >
                        <span className="inline-flex items-center gap-2 text-xs font-semibold text-fg-3">
                          <Loader2
                            size={15}
                            className="animate-spin motion-reduce:animate-none"
                            aria-hidden
                          />
                          레이어 탐색기 불러오는 중
                        </span>
                      </div>
                    }
                  >
                    <StudioLayerNavigator
                      items={layerNavigatorItems}
                      groups={masterEditMode ? [] : groups}
                      selectedIds={marqueeIds.length > 0 ? marqueeIds : selectedId ? [selectedId] : []}
                      pageKey={`${masterEditMode ? "master" : currentPageId}:${layersSplitWithProperties ? "split" : inspectorLayout.primary}`}
                      livePageId={masterEditMode ? null : currentPageId}
                      readOnly={inspectorInteractionPolicy.global.disabled}
                      groupingDisabled={masterEditMode}
                      localHiddenIds={localHiddenElementIds}
                      onToggleLocalHidden={toggleLocalHidden}
                      soloLayerId={soloLayerId}
                      onToggleLayerSolo={toggleLayerSolo}
                      onSelectionChange={selectLayersFromNavigator}
                      onAction={handleLayerNavigatorAction}
                    />
                  </Suspense>
                </div>
                {/* CSP 경계 효과(fuchi) — 선택 이미지 레이어의 비파괴 테두리. 문서 커밋은
                    다른 레이어 속성(불투명도 등)과 같은 patchEl 시임 하나만 쓴다(2026-08-20). */}
                {selected?.type === "image" ? (
                  <StudioLayerBorderEffectPanel
                    value={selected.borderEffect}
                    disabled={inspectorInteractionPolicy.global.disabled}
                    onChange={(next) => patchEl(selected.id, { borderEffect: next } as Partial<El>)}
                  />
                ) : null}
                {/* CSP 톤화 (Tone / Screentone) — 선택 이미지 레이어의 망점화. */}
                {selected?.type === "image" ? (
                  <StudioLayerTonePanel
                    value={selected.halftone}
                    disabled={inspectorInteractionPolicy.global.disabled}
                    onChange={(next) => patchEl(selected.id, { halftone: next } as Partial<El>)}
                  />
                ) : null}
                {/* CSP 3.0 / 4.0 Layer Comps (레이어 콤프) */}
                <StudioLayerCompsPanel
                  layers={layerNavigatorItems.map((item) => ({
                    id: item.id,
                    name: item.label,
                    visible: !item.hidden,
                    opacity: item.opacity ?? 1,
                  }))}
                  onApplyComp={(comp) => {
                    for (const [id, state] of Object.entries(comp.layerStates)) {
                      patchEl(id, {
                        visible: state.visible,
                        opacity: state.opacity,
                      } as Partial<El>);
                    }
                  }}
                />
              </>
            ) : null}
          </div>

          {/* 미니맵 / 네비게이터 */}
          <div
            id={tabA11y.document.navigator.panelId}
            role="tabpanel"
            aria-labelledby={`${tabA11y.primary.document.tabId} ${tabA11y.document.navigator.tabId}`}
            hidden={
              inspectorLayout.primary !== "document" ||
              inspectorLayout.document !== "navigator"
            }
            className="rounded-xl border border-line bg-panel/40 p-3"
          >
            <p className="mb-2 text-xs font-semibold text-fg-3 uppercase tracking-wider">미니맵 / 네비게이터</p>
            <div className="flex justify-center bg-canvas/30 rounded-xl p-2 border border-line/50">
              <div
                role="button"
                tabIndex={0}
                aria-label="미니맵: 클릭하거나 끌어서 캔버스 이동, 방향키로 스크롤"
                onClick={onMinimapClick}
                // Figma/Procreate식 드래그 스크럽: 포인터를 잡은 채 끌면 뷰포트가 연속으로 따라온다.
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  if (e.buttons !== 1) return;
                  onMinimapClick(e as unknown as React.MouseEvent<HTMLDivElement>);
                }}
                onKeyDown={onMinimapKeyDown}
                style={{
                  width: "120px",
                  height: `${Math.round(120 * (canvasH / CANVAS_W))}px`,
                  background: bgGrad ? `linear-gradient(${bgGrad[0]}, ${bgGrad[1]})` : bg,
                  position: "relative",
                  cursor: "pointer",
                  overflow: "hidden",
                }}
                className="rounded border border-line shadow-inner"
              >
                {/* Render panels/frames — hidden 탭패널일 땐 요소별 박스 생성을 건너뛴다
                    (요소 수에 비례하는 커밋당 jsxDEV 비용이 미니맵을 안 보는 동안에도 나가던 것). */}
                {inspectorLayout.primary === "document" && inspectorLayout.document === "navigator"
                  ? elements.map((el) => {
                  if (isEffectivelyHidden(el, groups) || localHiddenElementIds.has(el.id)) return null;
                  const bounds = elBounds(el);
                  const pctX = (bounds.x / CANVAS_W) * 100;
                  const pctY = (bounds.y / canvasH) * 100;
                  const pctW = (bounds.w / CANVAS_W) * 100;
                  const pctH = (bounds.h / canvasH) * 100;

                  // 디자인 토큰만 사용(스톡 Tailwind 팔레트 금지) — 레이어 패널의 색 의미와 정렬.
                  let colorClass = "bg-accent/40";
                  if (el.type === "frame") colorClass = "border border-bad/50 bg-bad/10";
                  else if (el.type === "text") colorClass = "bg-accent-2/50";
                  else if (el.type === "bubble") colorClass = "bg-warn/50";
                  else if (el.type === "draw") colorClass = "bg-good/30";

                  return (
                    <div
                      key={`mini-${el.id}`}
                      className={cn("absolute rounded-sm pointer-events-none", colorClass)}
                      style={{
                        left: `${pctX}%`,
                        top: `${pctY}%`,
                        width: `${pctW}%`,
                        height: `${pctH}%`,
                      }}
                    />
                  );
                })
                  : null}
                {/* Render scroll window box — 액센트 프레임 + 바깥 영역 딤(오버플로 히든 활용).
                    팬 중에도 프레임 정확도를 지켜야 하므로 살아 있는 스크롤 스토어를 구독하는
                    전용 리프로 분리했다(이 박스만 다시 그려지고 인스펙터 렌더는 없다). */}
                <StudioMinimapViewportBox
                  store={scrollViewportStore}
                  canvasHeight={canvasH}
                  effScale={effScale}
                  canvasFlipH={canvasFlipH}
                  canvasRotation={canvasRotation}
                />
              </div>
            </div>

            {/* CSP Sub View (서브 뷰 팔레트) */}
            <div className="mt-3">
              <StudioSubViewPanel onPickColor={(hex) => setColor(hex)} />
            </div>
          </div>
          <StudioInspectorPublishPanel
            active={inspectorLayout.primary === "publish"}
            panelId={tabA11y.primary.publish.panelId}
            panelLabelledBy={tabA11y.primary.publish.tabId}
            autoFocusTitle={
              isMobile && mobileSheet === "props" && pendingSaveIntent !== null
            }
            description={description}
            readOnly={inspectorInteractionPolicy.global.disabled}
            tags={tagsText}
            title={title}
            titleInputRef={titleInputRef}
            pendingSaveIntent={pendingSaveIntent}
            saving={saving}
            onContinuePendingSave={onContinuePendingSave}
            onDescriptionChange={(value) => {
              setDescription(value);
              onClearWorkMetadataError();
              setSharedDocumentNotice(null);
            }}
            onTagsChange={(value) => {
              setTagsText(value);
              onClearWorkMetadataError();
              setSharedDocumentNotice(null);
            }}
            onTitleChange={(value) => {
              setTitle(value);
              onClearWorkMetadataError();
              setSharedDocumentNotice(null);
            }}
          />
        </aside>
    </StudioDetachablePanelSlot>
  );
}
