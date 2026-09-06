import { Suspense } from "react";

import { isStudioAiConfigured } from "./ai/studio-ai-client";
import { DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS } from "./studio-advanced-fill-settings";
import {
  isCropRectNoop,
  initialCropRect,
  cropAspectRatio,
  applyCropAspect,
} from "./studio-crop";
import { uid } from "./studio-id";
import {
  executeStudioInspectorArmedChange,
  executeStudioInspectorArmedToggle,
} from "./studio-inspector-tool-transition";
import {
  LIQUIFY_RADIUS_RANGE,
  LIQUIFY_STRENGTH_RANGE,
} from "./studio-liquify-contract";
import {
  StudioAiColorizePanel,
  StudioColorPalettePanel,
  StudioFloodFillPanel,
  StudioAutoColorHintsPanel,
  StudioLineCleanupPanel,
  StudioImageAdjustmentsPanel,
  StudioSelectionToolsPanel,
  StudioQuickMaskPanel,
  StudioSmudgePanel,
  StudioDodgeBurnPanel,
  StudioWetMixPanel,
  StudioLiquifyPanel,
  StudioHealClonePanel,
  StudioHistoryBrushPanel,
  StudioLayerMaskPanel,
  StudioFilterMaskPanel,
  StudioCropPanel,
  StudioPuppetWarpPanel,
} from "./studio-page-lazy-ui";
import {
  isPuppetWarpNoop,
  removePuppetPin,
  resetPuppetPinPositions,
} from "./studio-puppet-warp";
import {
  setSelectionFeather,
  toggleSelectionInvert,
  emptyPixelSelection,
  removeLastSubpath,
  selectAllPixels,
  expandContractSelection,
  rotateSelection,
  flipSelection,
  translateSelection,
  scaleSelection,
  isSelectionUsable,
} from "./studio-selection-tools";
import { StudioBgRemoveButton } from "./StudioBgRemoveButton";
import { StudioPanelLoading } from "./StudioLazySurfaceFallback";
import { StudioMagicWandPanel } from "./StudioMagicWandPanel";
import {
  StudioRasterToolRecoveryPanel,
  StudioInspectorFilterLauncher,
  StudioInspectorPixelSelectionLauncher,
} from "./StudioRasterToolRecoveryPanel";

import type { El } from "./studio-element-model";
import type { StudioInspectorAsideModel } from "./useStudioInspectorAsideModel";
import type { StudioInspectorTabA11y } from "./studio-inspector-tab-a11y";


export function StudioInspectorSelectedImageTools({
  model,
  tabA11y,
}: {
  model: StudioInspectorAsideModel;
  tabA11y: StudioInspectorTabA11y;
}) {
  const {
    activatePixelSelectionToolFromInspector,
    activeImageInspectorTab,
    activeInspectorPixelSelectionTool,
    addFilterMask,
    addLayerMask,
    advancedFillActive,
    advancedFillBusy,
    advancedFillPreview,
    advancedFillReferenceLayerCount,
    advancedFillSettings,
    advancedFillStatus,
    advancedFillUnsupportedReason,
    advancedFillVisibleRasterCount,
    aiColorizeBusy,
    aiColorizeError,
    aiColorizePrompt,
    aiSettings,
    applyContentAwareFill,
    applyCropToSelectedImage,
    applyPixelSelectionAdjust,
    applyPixelSelectionContentTransform,
    applyPuppetWarpToSelectedImage,
    autoColorCanvasSeedHit,
    autoColorCanvasSeedHits,
    autoColorScribbleCanvasArmed,
    clearHealCloneSource,
    clearPolyLassoDraft,
    color,
    colorRangeFuzziness,
    colorRangePickActive,
    colorRangePreviewEnabled,
    colorRangeSamples,
    commit,
    commitPixelSelectionState,
    commitQuickMask,
    createLayerMaskFromSelection,
    cropAspect,
    cropBusy,
    cropRect,
    deleteFilterMask,
    deleteLayerMask,
    disarmAllPixelTools,
    dodgeBurnActive,
    dodgeBurnBusy,
    dodgeBurnExposure,
    dodgeBurnHardness,
    dodgeBurnMode,
    dodgeBurnRadius,
    dodgeBurnRange,
    dodgeBurnSponge,
    effectFavoriteState,
    elements,
    enterQuickMask,
    exitQuickMask,
    extractPixelSelectionToLayer,
    filterClipboard,
    filterMaskBusy,
    filterMaskHardness,
    filterMaskPaintActive,
    filterMaskPaintMode,
    filterMaskRadius,
    filterMaskStrength,
    handleRasterRecovery,
    healCloneAligned,
    healCloneBusy,
    healCloneHardness,
    healCloneOpacity,
    healCloneRadius,
    healCloneSourceAnchor,
    healCloneTool,
    historyBrushActive,
    historyBrushBusy,
    historyBrushHardness,
    historyBrushOpacity,
    historyBrushRadius,
    historyBrushSourceSrc,
    historyPanelOpen,
    inspectorInteractionPolicy,
    inspectorLayout,
    invertFilterMask,
    invertLayerMask,
    invertQuickMask,
    layerMaskBusy,
    layerMaskHardness,
    layerMaskPaintActive,
    layerMaskPaintMode,
    layerMaskRadius,
    layerMaskStrength,
    liquifyActive,
    liquifyBusy,
    liquifyMode,
    liquifyRadius,
    liquifyStrength,
    onAutoColorPlanImageSize,
    onColorizeSelected,
    onQuickMaskTintColorChange,
    onQuickMaskTintOpacityChange,
    onTogglePixelMagneticLasso,
    openFeatureTutorial,
    openStudioFilter,
    openStudioLayerLift,
    patchEl,
    pixelBrushRadius,
    pixelBusy,
    pixelCombine,
    pixelMagneticLasso,
    pixelSel,
    pixelSelectionCanRedo,
    pixelSelectionCanUndo,
    pixelTool,
    polyLassoSession,
    puppetWarpActive,
    puppetWarpBusy,
    puppetWarpPins,
    quickMaskActive,
    quickMaskBrushMode,
    quickMaskHardness,
    quickMaskOpacity,
    quickMaskRadius,
    quickMaskTintColor,
    quickMaskTintOpacity,
    rasterAvailability,
    redoPixelSelectionState,
    rememberEffectRecent,
    resetPixelSelectionState,
    runColorRangeApply,
    selected,
    selectedImageHasActiveFilters,
    selectedReadableImageSource,
    selectedWorkAssetDestructiveEditReason,
    setAdvancedFillPreview,
    setAdvancedFillStatus,
    setAiColorizePrompt,
    setAutoColorCanvasSeedHit,
    setAutoColorCanvasSeedHits,
    setAutoColorScribbleCanvasArmed,
    setColor,
    setColorRangeFuzziness,
    setColorRangePreviewEnabled,
    setColorRangeSamples,
    setCropAspect,
    setCropRect,
    setDodgeBurnExposure,
    setDodgeBurnHardness,
    setDodgeBurnMode,
    setDodgeBurnRadius,
    setDodgeBurnRange,
    setDodgeBurnSponge,
    setFilterClipboard,
    setFilterMaskHardness,
    setFilterMaskPaintActive,
    setFilterMaskPaintMode,
    setFilterMaskRadius,
    setFilterMaskStrength,
    setHealCloneAligned,
    setHealCloneHardness,
    setHealCloneOpacity,
    setHealCloneRadius,
    setHealCloneTool,
    setHistoryBrushActive,
    setHistoryBrushHardness,
    setHistoryBrushOpacity,
    setHistoryBrushRadius,
    setHistoryBrushSourceIndex,
    setHistoryBrushSourceSrc,
    setHistoryPanelOpen,
    setLayerMaskHardness,
    setLayerMaskPaintActive,
    setLayerMaskPaintMode,
    setLayerMaskRadius,
    setLayerMaskStrength,
    setLiquifyMode,
    setLiquifyRadius,
    setLiquifyStrength,
    setPixelBrushRadius,
    setPixelCombine,
    setPuppetWarpActive,
    setPuppetWarpPins,
    setQuickMaskBrushMode,
    setQuickMaskHardness,
    setQuickMaskOpacity,
    setQuickMaskRadius,
    setSelectedId,
    setSmudgeRadius,
    setSmudgeStrength,
    setWandTolerance,
    setWetMixHardness,
    setWetMixPickup,
    setWetMixRadius,
    setWetMixStrength,
    setWetMixWetness,
    shouldMountImageInspectorTab,
    smudgeActive,
    smudgeBusy,
    smudgeRadius,
    smudgeStrength,
    studioFilterPreparationBusy,
    studioLayerLiftDisabledReason,
    toggleAdvancedFill,
    toggleDodgeBurnTool,
    toggleEffectFavorite,
    toggleFilterMaskEnabled,
    toggleLayerMaskEnabled,
    toggleLiquifyTool,
    toggleSmudgeTool,
    toggleWetMixTool,
    undoPixelSelectionState,
    updateAdvancedFillSettings,
    wandTolerance,
    wetMixActive,
    wetMixBusy,
    wetMixHardness,
    wetMixPickup,
    wetMixRadius,
    wetMixStrength,
    wetMixWetness,
  } = model;
  if (!selected) return null;
  return (
    <>
              {(selected.type === "image" || selected.type === "draw") && (
                <div
                  id={tabA11y.imagePanels.selected}
                  role="tabpanel"
                  aria-labelledby={tabA11y.imageTabs[inspectorLayout.image]}
                  hidden={activeImageInspectorTab === null}
                  className="space-y-3"
                >
                  {selected.type === "image" && (
                    <>
                      {selectedWorkAssetDestructiveEditReason ? (
                        <p
                          role="status"
                          className="rounded-lg border border-accent/35 bg-accent/10 px-3 py-2 text-xs leading-relaxed text-fg-2"
                        >
                          {selectedWorkAssetDestructiveEditReason} 원본을 바꾸지 않는 새 채색 레이어 생성은
                          계속 사용할 수 있어요.
                        </p>
                      ) : null}
                      {shouldMountImageInspectorTab("quick") ? (
                      <div className="space-y-3" hidden={activeImageInspectorTab !== "quick"}>
                        <Suspense fallback={<StudioPanelLoading label="빠른 이미지 도구를 여는 중..." />}>
                          {!selectedWorkAssetDestructiveEditReason ? (
                            <>
                              <StudioBgRemoveButton
                                src={selected.src}
                                onResult={(dataUrl) => patchEl(selected.id, { src: dataUrl })}
                                onOpenLayerLift={openStudioLayerLift}
                                layerLiftDisabledReason={studioLayerLiftDisabledReason}
                              />
                              <StudioAiColorizePanel
                                configured={isStudioAiConfigured(aiSettings)}
                                prompt={aiColorizePrompt}
                                onPromptChange={setAiColorizePrompt}
                                busy={aiColorizeBusy}
                                error={aiColorizeError}
                                onColorize={onColorizeSelected}
                              />
                            </>
                          ) : null}
                          {selected.stockImageCredit && (
                            <p className="rounded-md border border-line bg-card/50 px-2 py-1 text-[0.6rem] leading-relaxed text-fg-3">
                              출처:{" "}
                              <a
                                href={selected.stockImageCredit.photographerProfileUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline hover:text-fg-2"
                              >
                                {selected.stockImageCredit.photographerName}
                              </a>{" "}
                              ·{" "}
                              <a
                                href={selected.stockImageCredit.unsplashPhotoPageUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline hover:text-fg-2"
                              >
                                Unsplash
                              </a>
                            </p>
                          )}
                          {selectedReadableImageSource ? (
                            <StudioColorPalettePanel
                              src={selectedReadableImageSource}
                              onPickColor={(hex) => setColor(hex)}
                            />
                          ) : null}
                        </Suspense>
                      </div>
                      ) : null}
                    </>
                  )}
                  {shouldMountImageInspectorTab("fill") ? (
                  <div className="space-y-3" hidden={activeImageInspectorTab !== "fill"}>
                    <Suspense fallback={<StudioPanelLoading label="채우기·선화 도구를 여는 중..." />}>
                      <StudioFloodFillPanel
                        active={advancedFillActive}
                        busy={advancedFillBusy}
                        fillColor={color}
                        settings={advancedFillSettings}
                        referenceLayerCount={advancedFillReferenceLayerCount}
                        visibleRasterCount={advancedFillVisibleRasterCount}
                        selectedIsReference={selected?.type === "image" ? selected.fillReference === true : false}
                        targetUnsupportedReason={
                          inspectorInteractionPolicy.selection.reason ??
                          advancedFillUnsupportedReason ??
                          (!rasterAvailability("paint-bucket").entry.enabled
                            ? rasterAvailability("paint-bucket").entry.reason
                            : null)
                        }
                        statusMessage={advancedFillStatus}
                        diagnostics={advancedFillPreview?.diagnostics}
                        onToggleActive={toggleAdvancedFill}
                        onFillColorChange={setColor}
                        onSettingsChange={updateAdvancedFillSettings}
                        onToggleSelectedReference={() => {
                          if (selected?.type === "image") {
                            setAdvancedFillPreview(null);
                            patchEl(selected.id, { fillReference: !selected.fillReference } as Partial<El>);
                            setAdvancedFillStatus(
                              selected.fillReference
                                ? "채우기 참조 지정을 해제했습니다."
                                : "이 래스터를 채우기 참조 선화로 지정했습니다.",
                            );
                          }
                        }}
                        onResetSettings={() =>
                          updateAdvancedFillSettings({ ...DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS })
                        }
                      />
                      {rasterAvailability("paint-bucket").entry.mode !== "direct-raster" ? (
                        <StudioRasterToolRecoveryPanel
                          entries={[rasterAvailability("paint-bucket", advancedFillBusy)]}
                          onRecover={handleRasterRecovery}
                        />
                      ) : null}
                      {selected.type === "image" ? (
                        <>
                          {selectedReadableImageSource ? (
                          <StudioAutoColorHintsPanel
                            imageSrc={selectedReadableImageSource}
                            scribbleCanvasArmed={autoColorScribbleCanvasArmed}
                            onScribbleCanvasArmedChange={
                              setAutoColorScribbleCanvasArmed
                                ? (next) =>
                                    executeStudioInspectorArmedChange(next, {
                                      disarm: disarmAllPixelTools,
                                      setActive: setAutoColorScribbleCanvasArmed,
                                    })
                                : undefined
                            }
                            canvasSeedHit={autoColorCanvasSeedHit}
                            canvasSeedHits={autoColorCanvasSeedHits}
                            onCanvasSeedHitConsumed={() => {
                              setAutoColorCanvasSeedHit?.(null);
                              setAutoColorCanvasSeedHits?.(null);
                            }}
                            onPlanImageSize={onAutoColorPlanImageSize}
                            onRun={async (request) => {
                              const { runStudioAutoColorHintsWorker } = await import("./studio-auto-color-hints-worker-client"
                              );
                              return runStudioAutoColorHintsWorker(request);
                            }}
                            onApplyResult={
                              selectedWorkAssetDestructiveEditReason
                                ? undefined
                                : (dataUrl) => patchEl(selected.id, { src: dataUrl })
                            }
                            onApplyNewLayer={
                              ({ dataUrl, name }) => {
                                if (selected.type !== "image") return;
                                const paintEl = {
                                  id: uid(),
                                  type: "image" as const,
                                  src: dataUrl,
                                  x: selected.x,
                                  y: selected.y,
                                  width: selected.width,
                                  height: selected.height,
                                  rotation: selected.rotation ?? 0,
                                  opacity: 1,
                                  name: name || "채색",
                                  groupId: selected.groupId,
                                };
                                const index = elements.findIndex((el) => el.id === selected.id);
                                const insertAt = index >= 0 ? index + 1 : elements.length;
                                const next = [
                                  ...elements.slice(0, insertAt),
                                  paintEl,
                                  ...elements.slice(insertAt),
                                ];
                                if (!commit(next as typeof elements)) return;
                                setSelectedId(paintEl.id);
                              }
                            }
                          />
                          ) : (
                            <p
                              role="status"
                              className="rounded-lg border border-line bg-card/50 px-3 py-2 text-xs text-fg-3"
                            >
                              검증된 이미지 바이트를 준비하는 중입니다.
                            </p>
                          )}
                          {!selectedWorkAssetDestructiveEditReason ? (
                            <StudioLineCleanupPanel
                              src={selected.src}
                              onResult={(dataUrl) => patchEl(selected.id, { src: dataUrl })}
                            />
                          ) : null}
                        </>
                      ) : null}
                    </Suspense>
                  </div>
                  ) : null}
                  {shouldMountImageInspectorTab("quick") ? (
                  <div className="space-y-3" hidden={activeImageInspectorTab !== "quick"}>
                    <Suspense fallback={<StudioPanelLoading label="이미지 보정을 여는 중..." />}>
                      <StudioInspectorFilterLauncher
                        availability={rasterAvailability("filter", studioFilterPreparationBusy)}
                        busy={studioFilterPreparationBusy}
                        onRecover={handleRasterRecovery}
                        onSelect={openStudioFilter}
                      />
                      {selected.type === "image" &&
                      rasterAvailability("filter").entry.enabled ? (
                        <StudioImageAdjustmentsPanel
                          selected={selected}
                          filterClipboard={filterClipboard}
                          onSetFilterClipboard={setFilterClipboard}
                          onPatch={(patch) => patchEl(selected.id, patch)}
                          effectFavoriteState={effectFavoriteState}
                          onToggleEffectFavorite={toggleEffectFavorite}
                          onRememberEffectRecent={rememberEffectRecent}
                        />
                      ) : null}
                    </Suspense>
                  </div>
                  ) : null}
                  {shouldMountImageInspectorTab("retouch") ? (
                  <div className="space-y-3" hidden={activeImageInspectorTab !== "retouch"}>
                    <Suspense fallback={<StudioPanelLoading label="선택·리터치 도구를 여는 중..." />}>
                      {selected.type === "image" &&
                      rasterAvailability("pixel-marquee").entry.enabled ? (
                      <>
                        <StudioInspectorPixelSelectionLauncher
                          availability={rasterAvailability("pixel-marquee")}
                          activeTool={activeInspectorPixelSelectionTool}
                          busy={pixelBusy}
                          heading="정원 마퀴"
                          toolIds={["circle"]}
                          onPickTool={activatePixelSelectionToolFromInspector}
                          onRecover={handleRasterRecovery}
                        />
                        {/* 픽셀 선택 도구 — 사각/타원/자유·다각형 올가미/브러시 + 결합/페더/확장·축소. */}
                        <StudioSelectionToolsPanel
                          selection={pixelSel}
                          activeTool={pixelTool === "wand" ? null : pixelTool}
                          combineMode={pixelCombine}
                          busy={pixelBusy}
                          brushRadius={pixelBrushRadius}
                          polyLassoPointCount={polyLassoSession?.points.length ?? 0}
                          onBrushRadiusChange={setPixelBrushRadius}
                          onPickTool={(t) => {
                            clearPolyLassoDraft();
                            if (t) {
                              activatePixelSelectionToolFromInspector(t);
                              return;
                            }
                            disarmAllPixelTools();
                          }}
                          onCombineModeChange={setPixelCombine}
                          onFeatherChange={(px) => commitPixelSelectionState((selection) => selection ? setSelectionFeather(selection, px) : selection, "feather", "feather")}
                          onToggleInvert={() => commitPixelSelectionState((selection) => toggleSelectionInvert(selection ?? emptyPixelSelection()), "invert")}
                          magneticLasso={pixelMagneticLasso}
                          onToggleMagnetic={onTogglePixelMagneticLasso}
                          canUndoSelection={pixelSelectionCanUndo}
                          canRedoSelection={pixelSelectionCanRedo}
                          onUndoSelection={undoPixelSelectionState}
                          onRedoSelection={redoPixelSelectionState}
                          onUndoSubpath={() => commitPixelSelectionState((selection) => selection ? removeLastSubpath(selection) : selection, "remove-subpath")}
                          onClearSelection={() => {
                            clearPolyLassoDraft();
                            commitPixelSelectionState(null, "clear");
                          }}
                          onSelectAll={() => {
                            clearPolyLassoDraft();
                            commitPixelSelectionState((selection) => selectAllPixels(selection), "select-all");
                          }}
                          onExpand={(amount) => commitPixelSelectionState((selection) => expandContractSelection(selection, amount), "transform")}
                          onContract={(amount) => commitPixelSelectionState((selection) => expandContractSelection(selection, -amount), "transform")}
                          onRotate={(degrees) => {
                            const aspect = selected.width > 0
                              ? selected.height / selected.width
                              : 1;
                            commitPixelSelectionState((selection) => rotateSelection(selection, degrees, { aspect }) ?? selection, "transform");
                          }}
                          onFlip={(axis) => commitPixelSelectionState((selection) => flipSelection(selection, axis) ?? selection, "transform")}
                          onTranslate={(dx, dy) => commitPixelSelectionState((selection) => translateSelection(selection, dx, dy) ?? selection, "move")}
                          onScale={(factor) => {
                            const aspect = selected.width > 0
                              ? selected.height / selected.width
                              : 1;
                            commitPixelSelectionState((selection) => scaleSelection(selection, factor, { aspect }) ?? selection, "transform");
                          }}
                          onContentTransform={(t) => void applyPixelSelectionContentTransform(t)}
                          onApplyAdjust={(plan) => void applyPixelSelectionAdjust(plan)}
                          onContentAwareFill={() => void applyContentAwareFill()}
                          onCopyToNewLayer={() => void extractPixelSelectionToLayer("copy")}
                          onCutToNewLayer={() => void extractPixelSelectionToLayer("cut")}
                          colorRangeSamples={colorRangeSamples}
                          colorRangeFuzziness={colorRangeFuzziness}
                          colorRangePickArmed={colorRangePickActive}
                          colorRangePreviewEnabled={colorRangePreviewEnabled}
                          onColorRangeTogglePick={() => {
                            activatePixelSelectionToolFromInspector("color-range");
                          }}
                          onColorRangeFuzzinessChange={setColorRangeFuzziness}
                          onColorRangeFuzzinessCommit={(v) => {
                            setColorRangeFuzziness(v);
                            if (colorRangePreviewEnabled) void runColorRangeApply({ fuzziness: v, coalesceKey: "color-range-preview" });
                          }}
                          onColorRangeTogglePreview={() => {
                            const next = !colorRangePreviewEnabled;
                            setColorRangePreviewEnabled(next);
                            if (next) void runColorRangeApply({ coalesceKey: "color-range-preview" });
                          }}
                          onColorRangeRemoveSample={(i) => setColorRangeSamples((prev) => prev.filter((_, idx) => idx !== i))}
                          onColorRangeClearSamples={() => setColorRangeSamples([])}
                          onColorRangeApply={() => void runColorRangeApply()}
                        />
                        <StudioMagicWandPanel
                          active={pixelTool === "wand"}
                          tolerance={wandTolerance}
                          busy={pixelBusy}
                          onToggleActive={() => {
                            activatePixelSelectionToolFromInspector("wand");
                          }}
                          onToleranceChange={setWandTolerance}
                        />
                        <StudioQuickMaskPanel
                          active={quickMaskActive}
                          brushMode={quickMaskBrushMode}
                          radiusPx={quickMaskRadius}
                          hardness={quickMaskHardness}
                          opacity={quickMaskOpacity}
                          tintColor={quickMaskTintColor}
                          tintOpacity={quickMaskTintOpacity}
                          onEnter={enterQuickMask}
                          onCommit={commitQuickMask}
                          onCancel={exitQuickMask}
                          onBrushModeChange={setQuickMaskBrushMode}
                          onRadiusChange={setQuickMaskRadius}
                          onHardnessChange={setQuickMaskHardness}
                          onOpacityChange={setQuickMaskOpacity}
                          onInvert={invertQuickMask}
                          onTintColorChange={onQuickMaskTintColorChange}
                          onTintOpacityChange={onQuickMaskTintOpacityChange}
                        />
                        <StudioSmudgePanel
                          active={smudgeActive}
                          radius={smudgeRadius}
                          strength={smudgeStrength}
                          busy={smudgeBusy}
                          onToggleActive={toggleSmudgeTool}
                          onRadiusChange={setSmudgeRadius}
                          onStrengthChange={setSmudgeStrength}
                          onOpenTutorial={() => openFeatureTutorial("smudge")}
                        />
                        <StudioDodgeBurnPanel
                          active={dodgeBurnActive}
                          mode={dodgeBurnMode}
                          range={dodgeBurnRange}
                          sponge={dodgeBurnSponge}
                          radiusPx={dodgeBurnRadius}
                          hardness={dodgeBurnHardness}
                          exposure={dodgeBurnExposure}
                          busy={dodgeBurnBusy}
                          onToggleActive={toggleDodgeBurnTool}
                          onModeChange={setDodgeBurnMode}
                          onRangeChange={setDodgeBurnRange}
                          onSpongeChange={setDodgeBurnSponge}
                          onRadiusChange={setDodgeBurnRadius}
                          onHardnessChange={setDodgeBurnHardness}
                          onExposureChange={setDodgeBurnExposure}
                          onOpenTutorial={() => openFeatureTutorial("dodge-burn")}
                        />
                        <StudioWetMixPanel
                          active={wetMixActive}
                          radius={wetMixRadius}
                          strength={wetMixStrength}
                          wetness={wetMixWetness}
                          pickup={wetMixPickup}
                          hardness={wetMixHardness}
                          paintColor={color}
                          busy={wetMixBusy}
                          onToggleActive={toggleWetMixTool}
                          onRadiusChange={setWetMixRadius}
                          onStrengthChange={setWetMixStrength}
                          onWetnessChange={setWetMixWetness}
                          onPickupChange={setWetMixPickup}
                          onHardnessChange={setWetMixHardness}
                          onOpenTutorial={() => openFeatureTutorial("wet-mix")}
                        />
                        <StudioLiquifyPanel
                          active={liquifyActive}
                          mode={liquifyMode}
                          radius={Math.min(LIQUIFY_RADIUS_RANGE.max, Math.max(LIQUIFY_RADIUS_RANGE.min, liquifyRadius))}
                          strength={Math.min(LIQUIFY_STRENGTH_RANGE.max, Math.max(LIQUIFY_STRENGTH_RANGE.min, liquifyStrength))}
                          busy={liquifyBusy}
                          onToggleActive={toggleLiquifyTool}
                          onModeChange={setLiquifyMode}
                          onRadiusChange={setLiquifyRadius}
                          onStrengthChange={setLiquifyStrength}
                          onOpenTutorial={() => openFeatureTutorial("liquify")}
                        />
                        <StudioHealClonePanel
                          mode={healCloneTool}
                          radiusPx={healCloneRadius}
                          hardness={healCloneHardness}
                          opacity={healCloneOpacity}
                          aligned={healCloneAligned}
                          hasSource={healCloneSourceAnchor !== null}
                          busy={healCloneBusy}
                          onPickMode={(mode) => {
                            const next = healCloneTool === mode ? null : mode;
                            if (next) {
                              disarmAllPixelTools();
                              resetPixelSelectionState(null); // 픽셀 선택 영역이 남아있으면 heal/clone 오버레이와 시각적으로 겹쳐 헷갈린다.
                            }
                            setHealCloneTool(next);
                          }}
                          onRadiusChange={setHealCloneRadius}
                          onHardnessChange={setHealCloneHardness}
                          onOpacityChange={setHealCloneOpacity}
                          onAlignedChange={setHealCloneAligned}
                          onClearSource={clearHealCloneSource}
                        />
                        <StudioHistoryBrushPanel
                          active={historyBrushActive}
                          radiusPx={historyBrushRadius}
                          hardness={historyBrushHardness}
                          opacity={historyBrushOpacity}
                          hasSource={historyBrushSourceSrc !== null}
                          busy={historyBrushBusy}
                          onToggleActive={() => {
                            executeStudioInspectorArmedToggle(historyBrushActive, {
                              disarm: disarmAllPixelTools,
                              setActive: setHistoryBrushActive,
                            });
                          }}
                          onRadiusChange={setHistoryBrushRadius}
                          onHardnessChange={setHistoryBrushHardness}
                          onOpacityChange={setHistoryBrushOpacity}
                          onClearSource={() => {
                            setHistoryBrushSourceIndex(null);
                            setHistoryBrushSourceSrc(null);
                          }}
                          onOpenHistoryPanel={historyPanelOpen ? undefined : () => setHistoryPanelOpen(true)}
                        />
                      </>
                      ) : (
                        <>
                          <StudioInspectorPixelSelectionLauncher
                            availability={rasterAvailability("pixel-marquee")}
                            activeTool={activeInspectorPixelSelectionTool}
                            busy={pixelBusy}
                            onPickTool={activatePixelSelectionToolFromInspector}
                            onRecover={handleRasterRecovery}
                          />
                          <StudioRasterToolRecoveryPanel
                            entries={[
                              rasterAvailability("smudge", smudgeBusy),
                              rasterAvailability("dodge-burn", dodgeBurnBusy),
                              rasterAvailability("wet-mix", wetMixBusy),
                              rasterAvailability("liquify", liquifyBusy),
                              rasterAvailability("heal", healCloneBusy),
                            ]}
                            busy={studioFilterPreparationBusy}
                            onRecover={handleRasterRecovery}
                          />
                        </>
                      )}
                    </Suspense>
                  </div>
                  ) : null}
                  {shouldMountImageInspectorTab("mask") ? (
                  <div className="space-y-3" hidden={activeImageInspectorTab !== "mask"}>
                    <Suspense fallback={<StudioPanelLoading label="레이어 마스크를 여는 중..." />}>
                      {selected.type === "image" &&
                      rasterAvailability("layer-mask").entry.enabled ? (
                        <>
                          <StudioLayerMaskPanel
                            hasMask={!!selected.maskSrc}
                            enabled={selected.maskEnabled !== false}
                            paintActive={layerMaskPaintActive}
                            paintMode={layerMaskPaintMode}
                            radiusPx={layerMaskRadius}
                            hardness={layerMaskHardness}
                            strength={layerMaskStrength}
                            maskThumbnailSrc={selected.maskSrc ?? null}
                            busy={layerMaskBusy}
                            onAddMask={addLayerMask}
                            onCreateFromSelection={createLayerMaskFromSelection}
                            hasUsableSelection={isSelectionUsable(pixelSel)}
                            onDeleteMask={deleteLayerMask}
                            onToggleEnabled={toggleLayerMaskEnabled}
                            onInvert={invertLayerMask}
                            onTogglePaintActive={() => {
                              executeStudioInspectorArmedToggle(layerMaskPaintActive, {
                                disarm: disarmAllPixelTools,
                                setActive: setLayerMaskPaintActive,
                              });
                            }}
                            onPaintModeChange={setLayerMaskPaintMode}
                            onRadiusChange={setLayerMaskRadius}
                            onHardnessChange={setLayerMaskHardness}
                            onStrengthChange={setLayerMaskStrength}
                          />
                          <StudioFilterMaskPanel
                            hasMask={!!selected.filterMaskSrc}
                            enabled={selected.filterMaskEnabled !== false}
                            hasActiveFilters={selectedImageHasActiveFilters}
                            paintActive={filterMaskPaintActive}
                            paintMode={filterMaskPaintMode}
                            radiusPx={filterMaskRadius}
                            hardness={filterMaskHardness}
                            strength={filterMaskStrength}
                            maskThumbnailSrc={selected.filterMaskSrc ?? null}
                            busy={filterMaskBusy}
                            onAddMask={addFilterMask}
                            onDeleteMask={deleteFilterMask}
                            onToggleEnabled={toggleFilterMaskEnabled}
                            onInvert={invertFilterMask}
                            onTogglePaintActive={() => {
                              executeStudioInspectorArmedToggle(filterMaskPaintActive, {
                                disarm: disarmAllPixelTools,
                                setActive: setFilterMaskPaintActive,
                              });
                            }}
                            onPaintModeChange={setFilterMaskPaintMode}
                            onRadiusChange={setFilterMaskRadius}
                            onHardnessChange={setFilterMaskHardness}
                            onStrengthChange={setFilterMaskStrength}
                          />
                        </>
                      ) : (
                        <StudioRasterToolRecoveryPanel
                          entries={[
                            rasterAvailability("layer-mask", layerMaskBusy || filterMaskBusy),
                          ]}
                          onRecover={handleRasterRecovery}
                        />
                      )}
                    </Suspense>
                  </div>
                  ) : null}
                  {shouldMountImageInspectorTab("transform") ? (
                  <div className="space-y-3" hidden={activeImageInspectorTab !== "transform"}>
                    <Suspense fallback={<StudioPanelLoading label="이미지 변형 도구를 여는 중..." />}>
                      {selected.type === "image" &&
                      rasterAvailability("crop").entry.enabled ? (
                        <>
                          <StudioCropPanel
                            active={!!cropRect}
                            aspect={cropAspect}
                            busy={cropBusy}
                            canApply={!!cropRect && !isCropRectNoop(cropRect)}
                            onToggle={() => {
                              if (cropRect) {
                                setCropRect(null);
                                return;
                              }
                              disarmAllPixelTools();
                              resetPixelSelectionState(null);
                              setCropRect(initialCropRect());
                            }}
                            onAspectChange={(id) => {
                              setCropAspect(id);
                              const ratio = cropAspectRatio(id);
                              if (ratio !== null && selected.height > 0) {
                                setCropRect((r) => (r ? applyCropAspect(r, ratio, selected.width / selected.height) : r));
                              }
                            }}
                            onReset={() => setCropRect(initialCropRect())}
                            onApply={() => void applyCropToSelectedImage()}
                            onCancel={() => setCropRect(null)}
                          />
                          <StudioPuppetWarpPanel
                            active={puppetWarpActive}
                            pins={puppetWarpPins}
                            busy={puppetWarpBusy}
                            canApply={!isPuppetWarpNoop(puppetWarpPins)}
                            onToggle={() => {
                              if (puppetWarpActive) {
                                setPuppetWarpActive(false);
                                setPuppetWarpPins([]);
                                return;
                              }
                              disarmAllPixelTools();
                              setPuppetWarpActive(true);
                            }}
                            onRemovePin={(id) => setPuppetWarpPins((pins) => removePuppetPin(pins, id))}
                            onResetPositions={() => setPuppetWarpPins((pins) => resetPuppetPinPositions(pins))}
                            onApply={() => void applyPuppetWarpToSelectedImage()}
                            onCancel={() => {
                              setPuppetWarpActive(false);
                              setPuppetWarpPins([]);
                            }}
                          />
                        </>
                      ) : (
                        <StudioRasterToolRecoveryPanel
                          entries={[
                            rasterAvailability("crop", cropBusy),
                            rasterAvailability("pixel-transform", pixelBusy),
                            rasterAvailability("puppet-warp", puppetWarpBusy),
                          ]}
                          busy={studioFilterPreparationBusy}
                          onRecover={handleRasterRecovery}
                        />
                      )}
                    </Suspense>
                  </div>
                  ) : null}
                </div>
              )}
    </>
  );
}
