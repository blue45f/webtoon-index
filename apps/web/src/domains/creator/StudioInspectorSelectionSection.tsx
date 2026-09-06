import { Suspense } from "react";

import { hasCustomBubbleShape } from "./lettering/studio-bubble-custom-shape";
import { normalizeExtraTails } from "./lettering/studio-bubble-path";
import { localizeStudioRasterToolAvailability } from "./render/studio-raster-tool-reason-localization";
import { containingPanel } from "./studio-element-geometry";
import { elementLabel } from "./studio-element-label";
import { executeStudioInspectorArmedToggle } from "./studio-inspector-tool-transition";
import { groupOfItem } from "./studio-layers";
import {
  StudioBubbleTailControls,
  StudioBubbleAnchorPanel,
  StudioExtendedBlendPanel,
} from "./studio-page-lazy-ui";
import { normalizeSkewPatch } from "./studio-skew";
import { StudioInspectorBubbleAppearanceControls } from "./StudioInspectorBubbleAppearanceControls";
import { StudioInspectorBubbleShapeControls } from "./StudioInspectorBubbleShapeControls";
import { StudioInspectorFocusSpeedFrameControls } from "./StudioInspectorFocusSpeedFrameControls";
import { StudioInspectorSelectedImageTools } from "./StudioInspectorImageToolsSection";
import { StudioInspectorOrderAlignSection } from "./StudioInspectorOrderAlignSection";
import { StudioInspectorSection } from "./StudioInspectorSection";
import {
  StudioInspectorShapeSection,
  StudioInspectorTextFillSection,
} from "./StudioInspectorShapeSection";
import { StudioInspectorTypographySection } from "./StudioInspectorTypographySection";
import { StudioInspectorMutationLockNotice } from "./StudioInspectorUtilityPanels";
import { StudioPanelLoading } from "./StudioLazySurfaceFallback";
import { StudioRasterToolRecoveryPanel } from "./StudioRasterToolRecoveryPanel";
import { StudioSkewPanel } from "./StudioSkewPanel";

import type { El } from "./studio-element-model";
import type { StudioInspectorAsideModel } from "./useStudioInspectorAsideModel";
import type { StudioInspectorTabA11y } from "./studio-inspector-tab-a11y";


import { cn } from "@/shared/lib/utils";

export function StudioInspectorSelectionSection({
  model,
  tabA11y,
}: {
  model: StudioInspectorAsideModel;
  tabA11y: StudioInspectorTabA11y;
}) {
  const {
    activeImageInspectorTab,
    activeSurfaceReviewLocked,
    addBubbleShapePointFromInspector,
    addLayerGroup,
    alignSelected,
    announceDrawingShortcut,
    applyExtendedBlendMergeDown,
    applyPaperVectorRefinement,
    assignElementToGroup,
    webtoonTheme,
    bubbleAnchorPickActive,
    bubbleShapeArmed,
    bubbleShapeEditActive,
    bubbleShapeHandles,
    bubbleShapeSelectedPointIndex,
    cancelPaperVectorRefinement,
    canvasH,
    collaborationDocumentLocked,
    color,
    currentPageId,
    detachBubbleAnchor,
    disarmAllPixelTools,
    duplicateSelected,
    elementById,
    elements,
    ensureRecentColorsLoaded,
    extendedBlendBusy,
    extendedBlendMode,
    extendedBlendOpacity,
    extendedBlendUnavailableReason,
    fitBubbleToText,
    fitSelectedToFrame,
    groups,
    handleRasterRecovery,
    inspectorContentMode,
    inspectorInteractionPolicy,
    inspectorTransientOwners,
    masterEditMode,
    nodeEditHandles,
    nodeEditTool,
    nodeSmoothStrength,
    panelGutter,
    panelSplitActive,
    panelSplitHint,
    panelSplitRatio,
    paperVectorRefinementBusy,
    paperVectorRefinementUnavailableReason,
    patchEl,
    rasterAvailabilityForTab,
    recentColors,
    rememberColor,
    removeBubbleShapePointFromInspector,
    removeSelected,
    reorder,
    replaceDrawWithHokusaiNaturalMedia,
    selected,
    selectedBg3dEditSource,
    selectedBubbleTailGeometry,
    selectedContentMutationLocked,
    setBg3dInitialDataUrl,
    setBg3dInitialElementId,
    setBg3dInitialScene,
    setBg3dOpen,
    setBubbleShapeEditActive,
    setExtendedBlendMode,
    setExtendedBlendOpacity,
    setNodeEditTool,
    setNodeSmoothStrength,
    setPanelGutter,
    setPanelSplitActive,
    setPanelSplitHint,
    setPanelSplitRatio,
    setPoserInitialDataUrl,
    setPoserInitialElementId,
    setPoserVrmOpen,
    setSharedDocumentNotice,
    setTool,
    splitFrameSelected,
    studioFilterPreparationBusy,
    t,
    toggleBubbleAnchorPick,
  } = model;
  return (
    <>
          {inspectorContentMode === "selection" && selected && (
            <div
              data-testid="studio-inspector-context-selection"
              className="rounded-xl border border-line bg-panel/40 p-3"
            >
              <StudioInspectorMutationLockNotice
                gate={inspectorInteractionPolicy.selection}
                hasActiveSession={inspectorTransientOwners.length > 0}
                onExit={disarmAllPixelTools}
              />
              {inspectorInteractionPolicy.selection.disabled && activeImageInspectorTab ? (
                <div className="mb-3">
                  <StudioRasterToolRecoveryPanel
                    entries={rasterAvailabilityForTab(activeImageInspectorTab).map((entry) =>
                      localizeStudioRasterToolAvailability(entry, t),
                    )}
                    busy={studioFilterPreparationBusy}
                    onRecover={handleRasterRecovery}
                  />
                </div>
              ) : null}
              {paperVectorRefinementBusy && inspectorInteractionPolicy.selection.disabled ? (
                <button
                  type="button"
                  aria-label="잠긴 경로 정리 취소"
                  onClick={cancelPaperVectorRefinement}
                  className="mb-3 min-h-11 w-full rounded-lg border border-danger/35 bg-danger/10 px-3 py-2 text-xs font-semibold text-danger"
                >
                  경로 정리 취소
                </button>
              ) : null}
              <fieldset
                disabled={inspectorInteractionPolicy.selection.disabled}
                title={inspectorInteractionPolicy.selection.reason}
                className="m-0 min-w-0 border-0 p-0 disabled:[&_button]:cursor-not-allowed disabled:[&_button]:opacity-50 disabled:[&_input]:cursor-not-allowed disabled:[&_input]:opacity-55 disabled:[&_select]:cursor-not-allowed disabled:[&_select]:opacity-55 disabled:[&_textarea]:cursor-not-allowed disabled:[&_textarea]:opacity-55"
              >
                <legend className="sr-only">선택 요소 편집 설정</legend>
                <Suspense fallback={<StudioPanelLoading label="작업 패널을 여는 중..." />}>
                <p className="mb-2 text-xs font-semibold text-fg-3">선택한 요소</p>

              {selected.type === "draw" && (
                <StudioInspectorShapeSection
                  selected={selected}
                  patchEl={patchEl}
                  nodeEditTool={nodeEditTool}
                  nodeEditHandles={nodeEditHandles}
                  nodeSmoothStrength={nodeSmoothStrength}
                  paperVectorRefinementBusy={paperVectorRefinementBusy}
                  paperVectorRefinementUnavailableReason={paperVectorRefinementUnavailableReason}
                  color={color}
                  canvasH={canvasH}
                  currentPageId={currentPageId}
                  masterEditMode={masterEditMode}
                  collaborationDocumentLocked={collaborationDocumentLocked}
                  activeSurfaceReviewLocked={activeSurfaceReviewLocked}
                  selectedContentMutationLocked={selectedContentMutationLocked}
                  setNodeEditTool={setNodeEditTool}
                  setNodeSmoothStrength={setNodeSmoothStrength}
                  setTool={setTool}
                  disarmAllPixelTools={disarmAllPixelTools}
                  announceDrawingShortcut={announceDrawingShortcut}
                  applyPaperVectorRefinement={applyPaperVectorRefinement}
                  cancelPaperVectorRefinement={cancelPaperVectorRefinement}
                  replaceDrawWithHokusaiNaturalMedia={replaceDrawWithHokusaiNaturalMedia}
                />
              )}

              {(selected.type === "text" || selected.type === "bubble") && (
                <label className="flex items-center justify-between gap-2 text-sm text-fg-2">
                  글자색
                  <input
                    type="color"
                    value={(selected.type === "text" ? selected.fill : selected.textFill) || "#16100c"}
                    onChange={(e) => patchEl(selected.id, (selected.type === "text" ? { fill: e.target.value } : { textFill: e.target.value }) as Partial<El>)}
                    className="h-7 w-7 cursor-pointer rounded border border-line bg-transparent"
                  />
                </label>
              )}

              {selected.type === "text" && (
                <StudioInspectorTextFillSection
                  selected={selected}
                  patchEl={patchEl}
                />
              )}
              {selected.type === "bubble" && (
                <StudioInspectorSection sectionId="element.bubble" loadingLabel="말풍선 설정을 여는 중...">
              {selected.type === "bubble" && (
                <StudioInspectorBubbleAppearanceControls
                  recentColors={recentColors}
                  selected={selected}
                  webtoonTheme={webtoonTheme}
                  onEnsureRecentColorsLoaded={ensureRecentColorsLoaded}
                  onPatch={(patch) => patchEl(selected.id, patch as Partial<El>)}
                  onRememberColor={rememberColor}
                />
              )}
              {selected.type === "bubble" && (
                <StudioInspectorBubbleShapeControls
                  active={bubbleShapeArmed}
                  editActive={bubbleShapeEditActive}
                  mutationLocked={inspectorInteractionPolicy.selection.disabled}
                  onAddPoint={addBubbleShapePointFromInspector}
                  onDisarmPixelTools={disarmAllPixelTools}
                  onPatch={(patch) => patchEl(selected.id, patch as Partial<El>)}
                  onRemovePoint={removeBubbleShapePointFromInspector}
                  onSetEditActive={setBubbleShapeEditActive}
                  pointCount={bubbleShapeHandles.length}
                  selected={selected}
                  selectedPointIndex={bubbleShapeSelectedPointIndex}
                  webtoonTheme={webtoonTheme}
                />
              )}
              {selected.type === "bubble" &&
                selected.variant !== "shout" &&
                selected.variant !== "box" &&
                !hasCustomBubbleShape(selected.customShapePoints) && (
                <Suspense fallback={null}>
                  <StudioBubbleTailControls
                    tail={selected.tail ?? "left"}
                    direction={selected.tailDirection ?? "bottom"}
                    ratio={selected.tailXRatio ?? 0.35}
                    length={selected.tailHeight ?? 30}
                    base={selectedBubbleTailGeometry?.tailSpec?.base ?? selected.tailBase ?? 18}
                    bend={selected.tailBend ?? 0}
                    extraTails={normalizeExtraTails(selected.extraTails)}
                    anchored={Boolean(selected.tailAnchorId || selected.tailAnchorPoint)}
                    allowMultiple={selected.variant !== "double"}
                    onPatchPrimary={(patch) => patchEl(selected.id, patch as Partial<El>)}
                    onChangeExtraTails={(tails) =>
                      patchEl(selected.id, {
                        extraTails: tails.length > 0 ? [...tails] : undefined,
                      } as Partial<El>)
                    }
                  />
                </Suspense>
              )}
              {selected.type === "bubble" &&
                selected.variant !== "shout" &&
                selected.variant !== "box" &&
                !hasCustomBubbleShape(selected.customShapePoints) &&
                (selected.tail ?? "left") !== "none" && (
                <Suspense fallback={null}>
                  <StudioBubbleAnchorPanel
                    anchorId={selected.tailAnchorId ?? null}
                    anchorPoint={selected.tailAnchorPoint ?? null}
                    anchorTargetLabel={
                      selected.tailAnchorId
                        ? (() => {
                            const t = elementById.get(selected.tailAnchorId);
                            return t ? elementLabel(t) : null;
                          })()
                        : null
                    }
                    pickActive={bubbleAnchorPickActive}
                    onTogglePick={toggleBubbleAnchorPick}
                    onDetach={detachBubbleAnchor}
                  />
                </Suspense>
              )}
                </StudioInspectorSection>
              )}
              {(selected.type === "text" || selected.type === "bubble") && (
                <StudioInspectorTypographySection
                  selected={selected}
                  patchEl={patchEl}
                />
              )}
              {/* 안이 전부 비면 헤더만 남으므로, 하나라도 그려질 때만 섹션을 낸다. */}
              {selected.type !== "frame" &&
                (selected.type === "image" ||
                  selected.type === "bubble" ||
                  containingPanel(selected, elements)) && (
              <StudioInspectorSection sectionId="element.constraints" loadingLabel="배치 제약을 여는 중...">
              {containingPanel(selected, elements) && (
                <label className="flex items-center justify-between gap-2 text-sm text-fg-2">
                  패널 안에 가두기
                  <input
                    type="checkbox"
                    checked={!selected.noClip}
                    onChange={(e) => patchEl(selected.id, { noClip: !e.target.checked } as Partial<El>)}
                    className="size-4 accent-accent"
                  />
                </label>
              )}
              {selected.type === "image" && (
                <button
                  type="button"
                  onClick={() => void fitSelectedToFrame()}
                  className="mt-2 w-full rounded-lg border border-line bg-card py-1.5 text-xs font-semibold text-fg-2 transition-colors hover:bg-raised"
                  title="이미지를 패널(없으면 캔버스)에 비율 유지하며 꽉 채웁니다"
                >
                  {containingPanel(selected, elements) ? "패널에 꽉 채우기" : "캔버스에 꽉 채우기"}
                </button>
              )}
              {(selected.type === "image" || selected.type === "bubble") && (
                <label className="flex items-center justify-between gap-2 text-sm text-fg-2">
                  비율 잠금 (변형 시 종횡비 유지)
                  <input
                    type="checkbox"
                    checked={!!selected.lockAspect}
                    onChange={(e) => patchEl(selected.id, { lockAspect: e.target.checked } as Partial<El>)}
                    className="size-4 accent-accent cursor-pointer"
                  />
                </label>
              )}
              </StudioInspectorSection>
              )}
              {(selected.type === "text" || selected.type === "bubble") && (
                /* 문단 — 정렬·세로 쓰기·자간·행간·높이 맞춤. 정렬은 예전에 타이포그래피 섹션에도
                   한 번 더 있었다(같은 속성 두 번 노출, 감사 §5.4). 이제 여기 한 곳뿐이다. */
                <StudioInspectorSection sectionId="element.text-align" loadingLabel="문단 설정을 여는 중...">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 text-sm text-fg-2">
                    글자 정렬
                    <div className="flex gap-1">
                      {[
                        { label: "왼쪽", v: "left" },
                        { label: "가운데", v: "center" },
                        { label: "오른쪽", v: "right" },
                      ].map((a) => (
                        <button
                          key={a.v}
                          type="button"
                          onClick={() => patchEl(selected.id, { align: a.v } as Partial<El>)}
                          aria-pressed={(selected.align ?? "center") === a.v}
                          data-inspector-priority="advanced"
                          data-inspector-control-id={`paragraph.align.${a.v}`}
                          className={cn(
                            "rounded-md border px-2.5 py-0.5 text-xs",
                            (selected.align ?? "center") === a.v
                              ? "border-accent/60 bg-accent-soft/50 text-fg"
                              : "border-line text-fg-2 hover:bg-raised"
                          )}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="flex items-center justify-between gap-2 text-sm text-fg-2 cursor-pointer">
                    세로 쓰기 (세로 연출)
                    <input
                      type="checkbox"
                      checked={!!selected.vertical}
                      data-inspector-priority="advanced"
                      data-inspector-control-id="paragraph.vertical"
                      onChange={(e) => patchEl(selected.id, { vertical: e.target.checked } as Partial<El>)}
                      className="size-4 accent-accent"
                    />
                  </label>
                  {selected.type === "text" && (
                    <>
                      <label className="flex items-center justify-between gap-2 text-sm text-fg-2">
                        자간
                        <span className="flex items-center gap-2">
                          <input
                            type="range"
                            min={-2}
                            max={12}
                            step={0.5}
                            value={selected.letterSpacing ?? 0}
                            data-inspector-priority="advanced"
                            data-inspector-control-id="paragraph.letterSpacing"
                            onChange={(e) => patchEl(selected.id, { letterSpacing: Number(e.target.value) } as Partial<El>)}
                            className="w-24 accent-accent cursor-pointer sm:w-28 h-2"
                          />
                          <span className="w-7 text-right text-xs tabular-nums text-fg-3">{selected.letterSpacing ?? 0}</span>
                        </span>
                      </label>
                      <label className="flex items-center justify-between gap-2 text-sm text-fg-2">
                        행간
                        <span className="flex items-center gap-2">
                          <input
                            type="range"
                            min={0.8}
                            max={2}
                            step={0.1}
                            value={selected.lineHeight ?? 1}
                            data-inspector-priority="advanced"
                            data-inspector-control-id="paragraph.lineHeight"
                            onChange={(e) => patchEl(selected.id, { lineHeight: Number(e.target.value) } as Partial<El>)}
                            className="w-24 accent-accent cursor-pointer sm:w-28 h-2"
                          />
                          <span className="w-7 text-right text-xs tabular-nums text-fg-3">{(selected.lineHeight ?? 1).toFixed(1)}</span>
                        </span>
                      </label>
                    </>
                  )}
                  {selected.type === "bubble" && (
                    <button
                      type="button"
                      onClick={() => void fitBubbleToText()}
                      className="w-full rounded-lg border border-line bg-card py-1.5 text-xs font-semibold text-fg-2 transition-colors hover:bg-raised"
                      title="말풍선 높이를 대사 길이에 맞춥니다"
                    >
                      높이를 텍스트에 맞춤
                    </button>
                  )}
                </div>
                </StudioInspectorSection>
              )}

              <label className="mt-2 flex items-center justify-between gap-2 text-sm text-fg-2" title="바로 아래 레이어의 영역 안으로만 보이게 잘라냅니다(채색·톤 가두기).">
                아래 레이어에 클리핑
                <input
                  type="checkbox"
                  checked={!!selected.clipBelow}
                  onChange={(e) => patchEl(selected.id, { clipBelow: e.target.checked } as Partial<El>)}
                  className="size-4 accent-accent cursor-pointer"
                />
              </label>

              <label className="mt-2 flex items-center justify-between gap-2 text-sm text-fg-2">
                그룹
                <select
                  value={groupOfItem(selected, groups)?.id ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "__new__") addLayerGroup(selected.id);
                    else assignElementToGroup(selected.id, v || undefined);
                  }}
                  className="rounded border border-line bg-card px-2 py-1 text-xs text-fg focus-visible:outline focus-visible:outline-accent cursor-pointer max-w-[8.5rem] truncate"
                >
                  <option value="">그룹 없음</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                  <option value="__new__">+ 새 그룹</option>
                </select>
              </label>

              {selected.type !== "frame" && (
                <label className="mt-2 flex items-center justify-between gap-2 text-sm text-fg-2">
                  혼합 모드 (Blend)
                  <select
                    value={selected.blendMode || "source-over"}
                    onChange={(e) => patchEl(selected.id, { blendMode: e.target.value } as Partial<El>)}
                    className="rounded border border-line bg-card px-2 py-1 text-xs text-fg focus-visible:outline focus-visible:outline-accent cursor-pointer"
                  >
                    <option value="source-over">보통 (Normal)</option>
                    <option value="multiply">곱하기 (Multiply)</option>
                    <option value="screen">스크린 (Screen)</option>
                    <option value="overlay">오버레이 (Overlay)</option>
                    <option value="darken">어둡게 (Darken)</option>
                    <option value="lighten">밝게 (Lighten)</option>
                    <option value="color-dodge">색상 닷지 (Color Dodge)</option>
                    <option value="color-burn">색상 번 (Color Burn)</option>
                    <option value="hard-light">하드 라이트 (Hard Light)</option>
                    <option value="soft-light">소프트 라이트 (Soft Light)</option>
                    <option value="difference">차이 (Difference)</option>
                    <option value="exclusion">제외 (Exclusion)</option>
                    <option value="hue">색조 (Hue)</option>
                    <option value="saturation">채도 (Saturation)</option>
                    <option value="color">색상 (Color)</option>
                    <option value="luminosity">광도 (Luminosity)</option>
                  </select>
                </label>
              )}

              {selected.type === "image" && (
                <StudioInspectorSection sectionId="element.blend-extended" loadingLabel="확장 블렌드를 여는 중...">
                <Suspense fallback={null}>
                  <StudioExtendedBlendPanel
                    mode={extendedBlendMode}
                    opacity={extendedBlendOpacity}
                    busy={extendedBlendBusy}
                    unavailableReason={
                      inspectorInteractionPolicy.selection.reason ??
                      extendedBlendUnavailableReason
                    }
                    onModeChange={setExtendedBlendMode}
                    onOpacityChange={setExtendedBlendOpacity}
                    onApply={() => void applyExtendedBlendMergeDown()}
                  />
                </Suspense>
                </StudioInspectorSection>
              )}

              {/* 위치·크기·회전·불투명도는 StudioFigmaDesignPanel 한 곳에서
                  같은 커밋 규칙으로 다룬다. 여기에는 자유 변형의 별도 축인
                  기울이기만 남겨 서로 다른 최소값과 히스토리가 충돌하지 않게 한다. */}
              {(selected.type === "image" || selected.type === "text" || selected.type === "sticker") && (
                <StudioInspectorSection
                  sectionId="element.layout"
                  loadingLabel="기울이기를 여는 중..."
                >
                    <StudioSkewPanel
                      value={{ skewX: selected.skewX, skewY: selected.skewY }}
                      onPatch={(patch) => patchEl(selected.id, normalizeSkewPatch(patch) as Partial<El>)}
                      onReset={() => patchEl(selected.id, { skewX: undefined, skewY: undefined } as Partial<El>)}
                    />
                </StudioInspectorSection>
              )}

              {(selected.type === "focusLines"
                || selected.type === "speedLines"
                || selected.type === "frame") ? (
                <StudioInspectorSection sectionId="element.effect-lines" loadingLabel="집중선·속도선을 여는 중...">
                <StudioInspectorFocusSpeedFrameControls
                  selected={selected}
                  panelGutter={panelGutter}
                  panelSplitActive={panelSplitActive}
                  panelSplitHint={panelSplitHint}
                  panelSplitRatio={panelSplitRatio}
                  onPatch={(patch) => patchEl(selected.id, patch)}
                  onPanelSplitRatioChange={setPanelSplitRatio}
                  onSplitFrame={splitFrameSelected}
                  onTogglePanelSplit={() => {
                    setPanelSplitHint(null);
                    executeStudioInspectorArmedToggle(panelSplitActive, {
                      disarm: disarmAllPixelTools,
                      setActive: setPanelSplitActive,
                    });
                  }}
                  onPanelGutterChange={(value) => {
                    if (collaborationDocumentLocked) return;
                    setPanelGutter(value);
                    setSharedDocumentNotice(null);
                  }}
                />
                </StudioInspectorSection>
              ) : null}

              <StudioInspectorSelectedImageTools model={model} tabA11y={tabA11y} />

              <StudioInspectorOrderAlignSection
                selected={selected}
                selectedBg3dEditSource={selectedBg3dEditSource}
                patchEl={patchEl}
                reorder={reorder}
                alignSelected={alignSelected}
                duplicateSelected={duplicateSelected}
                removeSelected={removeSelected}
                setPoserInitialDataUrl={setPoserInitialDataUrl}
                setPoserInitialElementId={setPoserInitialElementId}
                setPoserVrmOpen={setPoserVrmOpen}
                setBg3dInitialScene={setBg3dInitialScene}
                setBg3dInitialDataUrl={setBg3dInitialDataUrl}
                setBg3dInitialElementId={setBg3dInitialElementId}
                setBg3dOpen={setBg3dOpen}
              />
                </Suspense>
              </fieldset>
            </div>
          )}
    </>
  );
}
