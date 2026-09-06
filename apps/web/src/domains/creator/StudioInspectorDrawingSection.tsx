import { PaintBucket } from "lucide-react";
import { Suspense } from "react";

import { STUDIO_DRAW_SHAPE_PICKER_KINDS } from "./brush/studio-draw-hud";
import {
  STUDIO_BRUSH_SIZE_RANGE,
  STUDIO_BRUSH_OPACITY_RANGE,
} from "./brush/studio-draw-ux";
import {
  studioSubToolPaletteCategoryById,
  studioSubToolPalettePresetById,
} from "./brush/studio-sub-tool-palette-data";
import { StudioLineWidthAdjustmentPanel } from "./brush/StudioLineWidthAdjustmentPanel";
import {
  adjustDrawStrokeWidth,
  calculateAdjustedStrokeWidth,
} from "./brush/studio-line-width-adjust";
import { StudioSubToolPalette } from "./brush/StudioSubToolPalette";
import { CANVAS_W } from "./studio-assets";
import {
  StudioDrawingPaletteStack,
  StudioBrushLibraryPanel,
  StudioShapePickerGrid,
  StudioQuickShapePanel,
  StudioBrushStudio,
} from "./studio-page-lazy-ui";
import { QUICKSHAPE_KIND_LABELS } from "./studio-quickshape-labels";
import { StudioBrushSizePresetGrid } from "./StudioBrushSizePresetGrid";
import { StudioHokusaiNaturalMediaInspectorMount } from "./StudioHokusaiNaturalMediaInspectorMount";
import { StudioInspectorDrawModeControls } from "./StudioInspectorDrawModeControls";
import {
  StudioInspectorSymmetrySection,
  StudioInspectorRulersSection,
} from "./StudioInspectorRulersSection";
import { StudioInspectorSection } from "./StudioInspectorSection";
import {
  StudioInspectorBrushCatalogButton,
  StudioInspectorCurrentBrushSummary,
  StudioInspectorDrawColorControls,
} from "./StudioInspectorUtilityPanels";
import { StudioPanelLoading } from "./StudioLazySurfaceFallback";
import { StudioLineCorrectionControls } from "./StudioLineCorrectionControls";
import { StudioProceduralArtisticBrushInspectorSection } from "./StudioProceduralArtisticBrushInspectorSection";

import type { DrawShapeKind } from "./studio-editor-tool-model";
import type { DrawEl, El } from "./studio-element-model";
import type { StudioInspectorAsideModel } from "./useStudioInspectorAsideModel";

import { cn } from "@/shared/lib/utils";

export function StudioInspectorDrawingSection({
  model,
}: {
  model: StudioInspectorAsideModel;
}) {
  const {
    activeInspectorBrushId,
    activeInspectorBrushName,
    activeSavedBrushId,
    activeSurfaceReviewLocked,
    addAdvancedRuler,
    addProceduralArtisticBrushRaster,
    addVanishingPointHandler,
    advancedRulers,
    alignPerspectiveToEyeLevel,
    announceDrawingShortcut,
    applyBrushDefaultRestoreTransaction,
    applyBuiltInBrushPreset,
    applyDynamicsPreset,
    applySavedBrush,
    brush,
    brushDynamics,
    brushOpacity,
    canvasH,
    changeDrawingPaletteLayout,
    collaborationDocumentLocked,
    color,
    commitBrushSizePreset,
    commitIsometricOrigin,
    currentBrushSnapshot,
    activateCanvasTool,
    setSubToolPaletteBrowsedCategory,
    currentPageId,
    disarmAllPixelTools,
    drawMode,
    drawShape,
    drawingAssistControlsDisabled,
    drawingAssistDisabledReason,
    drawingPaletteCancelEpoch,
    drawingPaletteLayout,
    eyedropperActive,
    groups,
    insertIsometricPrimitive,
    insertIsometricSolid,
    inspectorContentMode,
    inspectorLayout,
    isMobile,
    isometricAngleDeg,
    isometricCellSize,
    isometricGridActive,
    isometricOriginX,
    isometricOriginY,
    liveDraftShapeKind,
    masterEditMode,
    moveVanishingPointById,
    onBrushEngineProgramsChange,
    openBrushCatalog,
    openBrushLibraryRepository,
    openFeatureTutorial,
    patchAdvancedRuler,
    perspectiveEyeLevelY,
    perspectiveLockHorizon,
    perspectiveRulerActive,
    postCorrection,
    preserveCorners,
    pressureCurve,
    pressureMinSize,
    previewIsometricAngleDegClamped,
    previewIsometricCellSizeClamped,
    previewIsometricOrigin,
    previewPerspectiveEyeLevelY,
    previewVanishingPointById,
    queueBrushDelete,
    quickShapeActive,
    recentBrushSizes,
    rememberRecentBrushSize,
    removeAdvancedRuler,
    removeVanishingPointHandler,
    replaceDrawWithHokusaiNaturalMedia,
    resetIsometricOrigin,
    savedBrushes,
    selectAdvancedRuler,
    selected,
    selectedContentMutationLocked,
    setActiveAdvancedRuler,
    setBrushDynamics,
    setBrushOpacity,
    setColor,
    setDrawShape,
    setDrawingPaletteDragging,
    setEyedropperActive,
    setIsometricAngleDegClamped,
    setIsometricCellSizeClamped,
    setPerspectiveEyeLevelY,
    setPerspectiveLockHorizon,
    setPerspectiveRulerActive,
    setPostCorrection,
    setPreserveCorners,
    setPressureCurve,
    setPressureMinSize,
    setQuickShapeActive,
    setSavedBrushes,
    setShapeFill,
    setStabilizer,
    setStabilizerMode,
    setStampTuning,
    setStrokeWidth,
    setSymmetryCenterX,
    setSymmetryCenterY,
    setSymmetryRadialCount,
    setSymmetryType,
    setTiltEnabled,
    setTipAngle,
    setTipRoundness,
    setTool,
    setUseVelocityPressure,
    setVelocitySensitivity,
    shapeFill,
    stabilizer,
    stabilizerMode,
    stampTuning,
    strokeWidth,
    subToolPaletteCategory,
    symmetryCenterX,
    symmetryCenterY,
    symmetryRadialCount,
    symmetryType,
    tiltEnabled,
    tipAngle,
    tipRoundness,
    toggleIsometricGridActive,
    tool,
    useVelocityPressure,
    vanishingPoints,
    velocitySensitivity,
  } = model;
  return (
    <>
          {inspectorContentMode === "drawing" && (
            <div
              data-testid="studio-inspector-context-drawing-panel"
              className="min-h-0 lg:flex lg:flex-1 lg:flex-col"
            >
              <Suspense
                fallback={
                  <StudioPanelLoading label="서브 도구와 도구 속성을 여는 중..." />
                }
              >
                <StudioDrawingPaletteStack
                  cancelEpoch={drawingPaletteCancelEpoch}
                  layout={drawingPaletteLayout}
                  mobileHeaderAction={
                    isMobile ? (
                      <StudioInspectorBrushCatalogButton
                        onOpen={openBrushCatalog}
                      />
                    ) : undefined
                  }
                  mobilePrimaryPaletteId={
                    isMobile ? "tool-properties" : undefined
                  }
                  defaultPresentation={isMobile ? "full" : "icon-popup"}
                  onLayoutChange={changeDrawingPaletteLayout}
                  onDraggingChange={setDrawingPaletteDragging}
                  subTools={
                  <>
              <StudioInspectorDrawModeControls
                drawMode={drawMode}
                onDrawModeChange={(next) => {
                  activateCanvasTool("draw", next);
                }}
                onDrawShapeChange={setDrawShape}
                onStrokeWidthChange={setStrokeWidth}
                onSymmetryChange={setSymmetryType}
              />

              {/* CSP식 서브 도구 팔레트 — 코어 카탈로그의 선별 매핑(분류 탭 + 서브 도구
                  리스트)만 노출한다. 분류 탭 활성화는 DrawModeControls와 동일한 도구 전환
                  경로(activateCanvasTool)를 타고, 서브 도구 적용은 StudioPage의
                  applyBuiltInBrushPreset 트랜잭션 하나로 끝난다(핸들러 미배선 시 미노출). */}
              {applyBuiltInBrushPreset && (drawMode === "pen" || drawMode === "eraser") ? (
                <StudioSubToolPalette
                  activeCategory={subToolPaletteCategory}
                  activeSubToolId={activeInspectorBrushId}
                  onCategoryChange={(category) => {
                    setSubToolPaletteBrowsedCategory(category);
                    const nextDrawMode =
                      studioSubToolPaletteCategoryById(category)?.drawMode;
                    if (nextDrawMode) activateCanvasTool("draw", nextDrawMode);
                  }}
                  onSelectSubTool={(subToolId) => {
                    const preset = studioSubToolPalettePresetById(subToolId);
                    if (!preset) return;
                    applyBuiltInBrushPreset(preset);
                    setSubToolPaletteBrowsedCategory(null);
                  }}
                />
              ) : null}

              {/* 기본 프리셋 "전체" 탐색은 하단 도크 한 곳에만 둔다. 인스펙터의 서브 도구
                  팔레트는 선별 매핑만 다루고, 그 외에는 현재 상태와 사용자 저장 브러시·고급
                  동역학에 집중해 긴 중복 메뉴를 만들지 않는다. */}
              {drawMode === "pen" && inspectorLayout.primary === "properties" ? (
                <StudioInspectorCurrentBrushSummary
                  brushId={activeInspectorBrushId}
                  brushName={activeInspectorBrushName}
                  color={color}
                  opacity={brushOpacity}
                  stabilizer={stabilizer}
                  stabilizerMode={stabilizerMode}
                  strokeWidth={strokeWidth}
                  tipAngle={tipAngle}
                  tipRoundness={tipRoundness}
                  onOpenBrushCatalog={openBrushCatalog}
                />
              ) : null}

              {/* 저장된 브러시 라이브러리 — ibisPaint 브러시/머티리얼 라이브러리 대응.
                  펜 모드 전용(저장 대상이 펜 설정 스냅샷이므로 drawMode==="pen"일 때만 노출). */}
              {drawMode === "pen" && (
                <Suspense fallback={null}>
                  <StudioBrushLibraryPanel
                    currentSnapshot={currentBrushSnapshot}
                    brushes={savedBrushes}
                    activeBrushId={activeSavedBrushId}
                    onBrushesChange={setSavedBrushes}
                    onApplyBrush={applySavedBrush}
                    onBrushDeleted={queueBrushDelete}
                    {...(openBrushLibraryRepository
                      ? { repositoryFactory: openBrushLibraryRepository }
                      : {})}
                  />
                </Suspense>
              )}

              {/* 도형 모드 — Photopea/Canva visual shape picker */}
              {drawMode === "shape" && (
                <div className="space-y-1.5">
                  <p className="text-[0.66rem] font-semibold uppercase tracking-wider text-fg-3">
                    도형 종류
                  </p>
                  <Suspense fallback={<div className="h-20 rounded-xl bg-raised/40" aria-hidden />}>
                    <StudioShapePickerGrid
                      activeKind={drawShape}
                      filled={shapeFill}
                      onSelect={(kind) => setDrawShape(kind as DrawShapeKind)}
                      kinds={STUDIO_DRAW_SHAPE_PICKER_KINDS}
                    />
                  </Suspense>
                  <button
                    type="button"
                    aria-pressed={shapeFill}
                    disabled={drawShape === "line" || drawShape === "arrow"}
                    title="채우기"
                    aria-label="도형 채우기"
                    onClick={() => setShapeFill((v) => !v)}
                    className={cn(
                      "grid size-11 place-items-center rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:size-9",
                      drawShape === "line" || drawShape === "arrow"
                        ? "cursor-not-allowed border-line bg-card text-fg-3 opacity-50"
                        : shapeFill
                          ? "border-accent/60 bg-accent-soft/50 text-accent"
                          : "border-line bg-card text-fg-2 hover:bg-raised"
                    )}
                  >
                    <PaintBucket size={15} aria-hidden />
                  </button>
                </div>
              )}
                  </>
                }
                  toolProperties={
                  <>

              {drawMode !== "eraser" && (
                <StudioInspectorDrawColorControls
                  color={color}
                  eyedropperActive={eyedropperActive}
                  onColorChange={setColor}
                  onEyedropperToggle={() => {
                    const next = !eyedropperActive;
                    if (next) disarmAllPixelTools();
                    setEyedropperActive(next);
                  }}
                />
              )}

              {/* 크기 슬라이더 */}
              <div className="space-y-1.5 pt-1.5 border-t border-line/35">
                {drawMode !== "pixel" ? (
                  <div className="space-y-1.5">
                    <label className="flex items-center justify-between gap-2 text-sm text-fg-2">
                      <span>크기</span>
                      <span className="flex items-center gap-1.5">
                        <input
                          type="range"
                          min={STUDIO_BRUSH_SIZE_RANGE.min}
                          max={STUDIO_BRUSH_SIZE_RANGE.max}
                          value={strokeWidth}
                          onChange={(e) => setStrokeWidth(Number(e.target.value))}
                          onPointerUp={(e) => rememberRecentBrushSize(Number(e.currentTarget.value))}
                          className="w-24 accent-accent cursor-pointer"
                        />
                        <span className="w-8 text-right text-xs tabular-nums text-fg-3">{strokeWidth}px</span>
                      </span>
                    </label>
                    {/* CSP식 클릭 크기 프리셋 — 슬라이더와 같은 strokeWidth 하나만 갱신한다.
                        브러시 `[`·`]` 단축키(brush.size-decrease/increase)와 공존. */}
                    <StudioBrushSizePresetGrid
                      activeSize={strokeWidth}
                      recentSizes={recentBrushSizes}
                      onCommit={commitBrushSizePreset}
                    />
                  </div>
                ) : null}

                {/* 불투명도 슬라이더 — 요소 인스펙터와 같은 명칭을 쓴다(V5 §15 "모드가 달라도 동일 명칭"). */}
                <label className="flex items-center justify-between gap-2 text-sm text-fg-2">
                  <span>불투명도</span>
                  <span className="flex items-center gap-1.5">
                    <input
                      type="range"
                      min={STUDIO_BRUSH_OPACITY_RANGE.min * 100}
                      max={STUDIO_BRUSH_OPACITY_RANGE.max * 100}
                      step={1}
                      value={Math.round(brushOpacity * 100)}
                      onChange={(e) => setBrushOpacity(Number(e.target.value) / 100)}
                      className="w-24 accent-accent cursor-pointer"
                    />
                    <span className="w-8 text-right text-xs tabular-nums text-fg-3">{Math.round(brushOpacity * 100)}%</span>
                  </span>
                </label>

                {/* 스탬프 브러시 세부 조절(흐름·경도·최소 굵기) — 스탬프 계열 선택 시에만 노출 */}
                {drawMode !== "pixel" && stampTuning
                  ? (
                    [
                      { key: "flow", label: "흐름" },
                      { key: "hardness", label: "경도" },
                      { key: "minSize", label: "최소 굵기" },
                    ] as const
                  ).map((item) => (
                    <label
                      key={item.key}
                      className="flex items-center justify-between gap-2 text-sm text-fg-2"
                    >
                      <span>{item.label}</span>
                      <span className="flex items-center gap-1.5">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={Math.round(stampTuning[item.key] * 100)}
                          onChange={(e) =>
                            setStampTuning({
                              ...stampTuning,
                              [item.key]: Number(e.target.value) / 100,
                            })}
                          className="w-24 accent-accent cursor-pointer"
                        />
                        <span className="w-8 text-right text-xs tabular-nums text-fg-3">
                          {Math.round(stampTuning[item.key] * 100)}%
                        </span>
                      </span>
                    </label>
                  ))
                  : null}

                {drawMode === "pen" && (
                  <Suspense fallback={null}>
                    <StudioQuickShapePanel
                      active={quickShapeActive}
                      matchedKindLabel={
                        tool === "draw" && liveDraftShapeKind && liveDraftShapeKind !== "freehand"
                          ? (QUICKSHAPE_KIND_LABELS[liveDraftShapeKind] ?? null)
                          : null
                      }
                      onOpenTutorial={() => openFeatureTutorial("smart-shape")}
                      onToggleActive={() => {
                        const next = !quickShapeActive;
                        if (next) {
                          activateCanvasTool("draw", "pen");
                          setEyedropperActive(false);
                          announceDrawingShortcut("스마트 도형 켜짐 · 그려서 손을 떼면 다듬어요");
                        } else {
                          announceDrawingShortcut("스마트 도형 꺼짐");
                        }
                        setQuickShapeActive(next);
                      }}
                    />
                  </Suspense>
                )}

                {drawMode !== "pixel" ? (
                  <StudioInspectorSection sectionId="tool.line-correction" loadingLabel="선 보정을 여는 중...">
                    <div className="space-y-2">
                      <StudioLineCorrectionControls
                        stabilizer={stabilizer}
                        onStabilizerChange={setStabilizer}
                        mode={stabilizerMode}
                        onModeChange={setStabilizerMode}
                        postCorrection={postCorrection}
                        onPostCorrectionChange={setPostCorrection}
                        preserveCorners={preserveCorners}
                        onPreserveCornersChange={setPreserveCorners}
                      />
                      <StudioLineWidthAdjustmentPanel
                        currentWidth={strokeWidth}
                        disabled={drawingAssistControlsDisabled}
                        onApply={(options) => {
                          const nextWidth = calculateAdjustedStrokeWidth(strokeWidth, options);
                          setStrokeWidth(nextWidth);
                          if (selected?.type === "draw") {
                            model.patchEl(selected.id, adjustDrawStrokeWidth(selected as DrawEl, options) as Partial<El>);
                          }
                        }}
                      />
                    </div>
                  </StudioInspectorSection>
                ) : null}

                {drawMode !== "shape" && drawMode !== "pixel" ? (
                  <StudioInspectorSection sectionId="tool.brush-studio" loadingLabel="브러시 스튜디오를 여는 중...">
                  <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-raised/35 motion-reduce:animate-none" aria-hidden />}>
                    <StudioBrushStudio
                      brushId={brush}
                      strokeWidth={strokeWidth}
                      color={color}
                      currentSnapshot={currentBrushSnapshot}
                      savedBrushBaseline={
                        activeSavedBrushId
                          ? savedBrushes.find((candidate) => candidate.id === activeSavedBrushId)
                            ?? null
                          : null
                      }
                      settings={brushDynamics}
                      onSettingsChange={setBrushDynamics}
                      onSelectDynamicsPreset={applyDynamicsPreset}
                      useVelocityPressure={useVelocityPressure}
                      onUseVelocityPressureChange={setUseVelocityPressure}
                      velocitySensitivity={velocitySensitivity}
                      onVelocitySensitivityChange={setVelocitySensitivity}
                      pressureCurve={pressureCurve}
                      onPressureCurveChange={setPressureCurve}
                      pressureMinSize={pressureMinSize ?? 0}
                      onPressureMinSizeChange={setPressureMinSize ?? (() => undefined)}
                      tiltEnabled={tiltEnabled}
                      onTiltEnabledChange={setTiltEnabled}
                      tipAngle={tipAngle}
                      onTipAngleChange={setTipAngle}
                      tipRoundness={tipRoundness}
                      onTipRoundnessChange={setTipRoundness}
                      onRestoreDefaults={applyBrushDefaultRestoreTransaction}
                      onEngineProgramsChange={onBrushEngineProgramsChange}
                    />
                  </Suspense>
                  </StudioInspectorSection>
                ) : null}
                <StudioInspectorSection sectionId="tool.brush-engines" loadingLabel="브러시 엔진을 여는 중...">
                <StudioHokusaiNaturalMediaInspectorMount
                  visible={drawMode !== "shape" && drawMode !== "pixel"}
                  selected={selected} currentColor={color}
                  documentWidth={CANVAS_W} documentHeight={canvasH}
                  pageId={currentPageId} masterEditMode={masterEditMode}
                  locks={{ collaboration: collaborationDocumentLocked,
                    surfaceReview: activeSurfaceReviewLocked,
                    selectedContent: selectedContentMutationLocked }}
                  onRequestSelectStroke={() => {
                    disarmAllPixelTools();
                    setTool("select");
                    announceDrawingShortcut("캔버스에서 변환할 자유곡선 선화를 선택하세요");
                  }}
                  onReplace={replaceDrawWithHokusaiNaturalMedia}
                />
                {drawMode !== "shape" && drawMode !== "pixel" ? (
                  <StudioProceduralArtisticBrushInspectorSection key={`${currentPageId}:${masterEditMode ? "master" : "page"}`} currentColor={color} canvasHeight={canvasH} pageId={currentPageId} masterEditMode={masterEditMode} disabled={collaborationDocumentLocked || activeSurfaceReviewLocked} disabledReason={collaborationDocumentLocked ? "협업 문서 잠금을 해제한 뒤 절차적 질감을 만들 수 있어요." : activeSurfaceReviewLocked ? "표면 리뷰를 마친 뒤 절차적 질감을 만들 수 있어요." : null} onInsert={addProceduralArtisticBrushRaster} />
                ) : null}
                </StudioInspectorSection>
                {/* 대칭 그리기 자 (Symmetry Ruler) — RAW 픽셀 입력에는 적용하지 않는다. */}
                {drawMode !== "pixel" ? (
                  <StudioInspectorSymmetrySection
                    symmetryType={symmetryType}
                    symmetryRadialCount={symmetryRadialCount}
                    symmetryCenterX={symmetryCenterX}
                    symmetryCenterY={symmetryCenterY}
                    canvasH={canvasH}
                    setSymmetryType={setSymmetryType}
                    setSymmetryRadialCount={setSymmetryRadialCount}
                    setSymmetryCenterX={setSymmetryCenterX}
                    setSymmetryCenterY={setSymmetryCenterY}
                  />
                ) : null}
                <StudioInspectorRulersSection
                  perspectiveRulerActive={perspectiveRulerActive}
                  vanishingPoints={vanishingPoints}
                  perspectiveEyeLevelY={perspectiveEyeLevelY}
                  perspectiveLockHorizon={perspectiveLockHorizon}
                  canvasH={canvasH}
                  drawingAssistControlsDisabled={drawingAssistControlsDisabled}
                  drawingAssistDisabledReason={drawingAssistDisabledReason}
                  isometricGridActive={isometricGridActive}
                  isometricAngleDeg={isometricAngleDeg}
                  isometricCellSize={isometricCellSize}
                  isometricOriginX={isometricOriginX}
                  isometricOriginY={isometricOriginY}
                  advancedRulers={advancedRulers}
                  groups={groups}
                  setPerspectiveRulerActive={setPerspectiveRulerActive}
                  addVanishingPointHandler={addVanishingPointHandler}
                  removeVanishingPointHandler={removeVanishingPointHandler}
                  previewVanishingPointById={previewVanishingPointById}
                  moveVanishingPointById={moveVanishingPointById}
                  setPerspectiveLockHorizon={setPerspectiveLockHorizon}
                  setPerspectiveEyeLevelY={setPerspectiveEyeLevelY}
                  previewPerspectiveEyeLevelY={previewPerspectiveEyeLevelY}
                  alignPerspectiveToEyeLevel={alignPerspectiveToEyeLevel}
                  toggleIsometricGridActive={toggleIsometricGridActive}
                  previewIsometricAngleDegClamped={previewIsometricAngleDegClamped}
                  setIsometricAngleDegClamped={setIsometricAngleDegClamped}
                  previewIsometricCellSizeClamped={previewIsometricCellSizeClamped}
                  setIsometricCellSizeClamped={setIsometricCellSizeClamped}
                  previewIsometricOrigin={previewIsometricOrigin}
                  commitIsometricOrigin={commitIsometricOrigin}
                  resetIsometricOrigin={resetIsometricOrigin}
                  insertIsometricPrimitive={insertIsometricPrimitive}
                  insertIsometricSolid={insertIsometricSolid}
                  addAdvancedRuler={addAdvancedRuler}
                  patchAdvancedRuler={patchAdvancedRuler}
                  removeAdvancedRuler={removeAdvancedRuler}
                  selectAdvancedRuler={selectAdvancedRuler}
                  setActiveAdvancedRuler={setActiveAdvancedRuler}
                />
              </div>
                  </>
                }
                />
              </Suspense>
            </div>
          )}
    </>
  );
}
