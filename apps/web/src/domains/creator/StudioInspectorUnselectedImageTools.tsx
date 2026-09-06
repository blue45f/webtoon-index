import { Suspense, useEffect, useRef } from "react";

import { DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS } from "./studio-advanced-fill-settings";
import { StudioFloodFillPanel } from "./studio-page-lazy-ui";
import { StudioPanelLoading } from "./StudioLazySurfaceFallback";
import {
  StudioRasterToolRecoveryPanel,
  StudioInspectorFilterLauncher,
  StudioInspectorPixelSelectionLauncher,
} from "./StudioRasterToolRecoveryPanel";

import type { StudioInspectorTabA11y } from "./studio-inspector-tab-a11y";
import type { StudioInspectorAsideModel } from "./useStudioInspectorAsideModel";


export function StudioInspectorUnselectedImageTools({
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
    advancedFillActive,
    advancedFillBusy,
    advancedFillPreview,
    advancedFillReferenceLayerCount,
    advancedFillSettings,
    advancedFillStatus,
    advancedFillUnsupportedReason,
    advancedFillVisibleRasterCount,
    color,
    cropBusy,
    dodgeBurnBusy,
    filterMaskBusy,
    handleRasterRecovery,
    healCloneBusy,
    imageInspectorRouteWithoutImageSelection,
    inspectorInteractionPolicy,
    inspectorLayout,
    layerMaskBusy,
    liquifyBusy,
    openStudioFilter,
    pixelBusy,
    puppetWarpBusy,
    rasterAvailability,
    setColor,
    setUnselectedImageToolsVisible,
    shouldMountImageInspectorTab,
    smudgeBusy,
    studioFilterPreparationBusy,
    toggleAdvancedFill,
    updateAdvancedFillSettings,
    wetMixBusy,
  } = model;
  const preparationHeadingRef = useRef<HTMLParagraphElement>(null);
  const previousRouteVisibleRef = useRef(imageInspectorRouteWithoutImageSelection);

  useEffect(() => {
    const wasVisible = previousRouteVisibleRef.current;
    previousRouteVisibleRef.current = imageInspectorRouteWithoutImageSelection;
    if (imageInspectorRouteWithoutImageSelection && !wasVisible) {
      preparationHeadingRef.current?.focus({ preventScroll: true });
    }
  }, [imageInspectorRouteWithoutImageSelection]);

  return (
    <>
          {imageInspectorRouteWithoutImageSelection ? (
            <div
              id={tabA11y.imagePanels.unselected}
              role="tabpanel"
              aria-label="전문 픽셀 도구"
              aria-labelledby={tabA11y.imageTabs[inspectorLayout.image]}
              className="space-y-3 rounded-xl border border-line bg-panel/40 p-3"
            >
              <div className="flex items-start justify-between gap-2 rounded-lg bg-canvas/45 px-2.5 py-2">
                <div className="min-w-0">
                  <p
                    ref={preparationHeadingRef}
                    tabIndex={-1}
                    className="rounded-sm text-xs font-bold text-fg focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-accent"
                  >
                    이미지 편집 대상 준비
                  </p>
                  <p className="mt-0.5 text-[0.68rem] leading-snug text-fg-3">
                    이미지 레이어를 선택하거나 페이지 합성본을 만든 뒤 도구를 실행하세요.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setUnselectedImageToolsVisible(false)}
                  className="min-h-9 shrink-0 rounded-lg border border-line bg-card px-2 text-[0.68rem] font-semibold text-fg-2 transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent pointer-coarse:min-h-11"
                >
                  시작 안내
                </button>
              </div>
              {shouldMountImageInspectorTab("quick") ? (
                <div className="space-y-3" hidden={activeImageInspectorTab !== "quick"}>
                  <StudioInspectorFilterLauncher
                    availability={rasterAvailability("filter", studioFilterPreparationBusy)}
                    busy={studioFilterPreparationBusy}
                    onRecover={handleRasterRecovery}
                    onSelect={openStudioFilter}
                  />
                </div>
              ) : null}
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
                      selectedIsReference={false}
                      canToggleSelectedReference={false}
                      targetUnsupportedReason={
                        inspectorInteractionPolicy.page.reason ??
                        advancedFillUnsupportedReason ??
                        (!rasterAvailability("paint-bucket", advancedFillBusy).entry.enabled
                          ? rasterAvailability("paint-bucket", advancedFillBusy).entry.reason
                          : null)
                      }
                      statusMessage={advancedFillStatus}
                      diagnostics={advancedFillPreview?.diagnostics}
                      onToggleActive={toggleAdvancedFill}
                      onFillColorChange={setColor}
                      onSettingsChange={updateAdvancedFillSettings}
                      onToggleSelectedReference={() => undefined}
                      onResetSettings={() =>
                        updateAdvancedFillSettings({ ...DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS })
                      }
                    />
                    {rasterAvailability("paint-bucket", advancedFillBusy).entry.mode !==
                    "direct-raster" ? (
                      <StudioRasterToolRecoveryPanel
                        entries={[rasterAvailability("paint-bucket", advancedFillBusy)]}
                        onRecover={handleRasterRecovery}
                      />
                    ) : null}
                  </Suspense>
                </div>
              ) : null}
              {shouldMountImageInspectorTab("retouch") ? (
                <div className="space-y-3" hidden={activeImageInspectorTab !== "retouch"}>
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
                </div>
              ) : null}
              {shouldMountImageInspectorTab("mask") ? (
                <div className="space-y-3" hidden={activeImageInspectorTab !== "mask"}>
                  <StudioRasterToolRecoveryPanel
                    entries={[
                      rasterAvailability("layer-mask", layerMaskBusy || filterMaskBusy),
                    ]}
                    onRecover={handleRasterRecovery}
                  />
                </div>
              ) : null}
              {shouldMountImageInspectorTab("transform") ? (
                <div className="space-y-3" hidden={activeImageInspectorTab !== "transform"}>
                  <StudioRasterToolRecoveryPanel
                    entries={[
                      rasterAvailability("crop", cropBusy),
                      rasterAvailability("pixel-transform", pixelBusy),
                      rasterAvailability("puppet-warp", puppetWarpBusy),
                    ]}
                    busy={studioFilterPreparationBusy}
                    onRecover={handleRasterRecovery}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
    </>
  );
}
