import { memo, Suspense } from "react";

import { DRAW_COLOR_SWATCHES } from "./brush/studio-draw-color-swatches";
import {
  StudioDrawOptionsBar,
  StudioSelectOptionsBar,
} from "./studio-page-lazy-ui";

import type { StudioBrushStampTuning } from "./brush/studio-brush-library";
import type { StudioBrushSlot } from "./brush/studio-brush-slots";
import type {
  StudioDrawModeUi,
  StudioPressureCurveUi,
  StudioStabilizerModeUi,
  StudioSymmetryUi,
} from "./brush/StudioDrawOptionsBar";
import type { StudioBrushTrayItem } from "./studio-creative-ux";
import type { DrawShapeKind } from "./studio-editor-tool-model";
import type { StudioLivingInkMaterialControls } from "./studio-living-ink-gpu-protocol";
import type {
  StudioLivingInkStrokeMode,
  StudioLivingInkStudioState,
} from "./studio-living-ink-studio-coordinator";

import { useIsMobile } from "@/src/hooks/use-media-query";

export interface StudioOptionsBarsDrawModel {
  visible: boolean;
  /** Canonical renderer brush id. */
  brushId: string;
  /** Optional user-facing catalogue identity for procedural brushes. */
  activeCatalogBrushId?: string;
  activeCatalogBrushName?: string;
  brushCatalogItems?: readonly StudioBrushTrayItem[];
  brushCatalogOpen: boolean;
  brushDefaultRestore: Readonly<{
    sourceName: string;
    modifiedCount: number;
    loading: boolean;
    available: boolean;
    undoAvailable: boolean;
  }> | null;
  brushOpacity: number;
  brushSlots: readonly (StudioBrushSlot | null)[];
  canvasFlipH: boolean;
  color: string;
  dockInsets: Readonly<{
    left: number;
    right: number;
  }>;
  drawMode: StudioDrawModeUi;
  drawShape: DrawShapeKind;
  /** CSP vector eraser mode: click freehand to erase between intersections. */
  eraseToIntersection?: boolean;
  eyedropperActive?: boolean;
  favoriteBrushIds: readonly string[];
  opacityLocked: boolean;
  postCorrection: number;
  pressureCurveId: StudioPressureCurveUi;
  quickShapeActive: boolean;
  recentBrushIds: readonly string[];
  secondaryColor: string;
  shapeFill: boolean;
  sizeLocked: boolean;
  stabilizer: number;
  stabilizerMode: StudioStabilizerModeUi;
  stampTuning: StudioBrushStampTuning | null;
  strokeWidth: number;
  symmetryType: StudioSymmetryUi;
  livingInk: Readonly<{
    supported: boolean;
    physicalModeEnabled: boolean;
    state: StudioLivingInkStudioState;
    mode: StudioLivingInkStrokeMode;
    scope: "all" | "selection";
    selectionAvailable: boolean;
    busy: boolean;
    fixAvailable: boolean;
    fixUnavailableReason?: string;
    material: StudioLivingInkMaterialControls;
    materialLocked: boolean;
    materialLockedReason?: string;
  }>;
}

export interface StudioOptionsBarsSelectionModel {
  visible: boolean;
  count: number;
  label: string | null;
  locked: boolean;
  canToggleLock: boolean;
  textEditLabel: "대사 편집" | "글자 편집" | null;
  canFitBubble: boolean;
}

export interface StudioOptionsBarsHandlers {
  assignBrushSlot: (index: number) => void;
  cycleStabilizer: () => void;
  deleteSelection: () => void;
  duplicateSelection: () => void;
  editSelectionText: () => void;
  fitSelectionBubble: () => void;
  openBrushStudio: () => void;
  recallBrushSlot: (index: number) => void;
  reorderSelection: (direction: "front" | "back") => void;
  restoreBrushDefaults: () => void;
  selectBrushId: (brushId: string) => void;
  setBrushOpacity: (value: number) => void;
  setColor: (hex: string) => void;
  setDrawMode: (mode: StudioDrawModeUi) => void;
  setDrawShape: (kind: DrawShapeKind) => void;
  setPostCorrection: (value: number) => void;
  setPressureCurvePreset: (id: StudioPressureCurveUi) => void;
  setSecondaryColor: (hex: string) => void;
  setShapeFill: (filled: boolean) => void;
  setStabilizer: (value: number) => void;
  setStabilizerMode: (mode: StudioStabilizerModeUi) => void;
  setStampTuning: (tuning: StudioBrushStampTuning) => void;
  setStrokeWidth: (value: number) => void;
  setSymmetryType: (type: StudioSymmetryUi) => void;
  swapColors: () => void;
  toggleBrushCatalog: (trigger: HTMLButtonElement) => void;
  toggleCanvasFlip: () => void;
  toggleFavoriteBrush: (brushId: string) => void;
  toggleEraseToIntersection?: () => void;
  toggleEyedropper?: () => void;
  toggleOpacityLock: () => void;
  toggleQuickShape: () => void;
  toggleSelectedLock: () => void;
  toggleSizeLock: () => void;
  setLivingInkMode: (mode: StudioLivingInkStrokeMode) => void;
  setLivingInkPhysicalModeEnabled: (enabled: boolean) => void;
  setLivingInkScope: (scope: "all" | "selection") => void;
  applyLivingInkFix: () => void;
  applyLivingInkClear: () => void;
  patchLivingInkMaterial: (patch: Partial<StudioLivingInkMaterialControls>) => void;
}

export interface StudioOptionsBarsProps {
  draw: StudioOptionsBarsDrawModel;
  selection: StudioOptionsBarsSelectionModel;
  stableHandlers: StudioOptionsBarsHandlers;
}

export const StudioOptionsBars = memo(function StudioOptionsBars({
  draw,
  selection,
  stableHandlers,
}: StudioOptionsBarsProps) {
  const isMobile = useIsMobile();
  return (
    <>
      {draw.visible ? (
        // The dock is fixed and consumes no document flow. A non-null fallback shifts the canvas
        // when the lazy chunk resolves, which can make a just-finished stroke appear to jump.
        <Suspense fallback={null}>
          <StudioDrawOptionsBar
            key={draw.drawMode}
            docked
            brushCatalogOpen={draw.brushCatalogOpen}
            onToggleBrushCatalog={stableHandlers.toggleBrushCatalog}
            dockInsets={draw.dockInsets}
            drawMode={draw.drawMode}
            brushId={draw.brushId}
            activeCatalogBrushId={draw.activeCatalogBrushId}
            activeCatalogBrushName={draw.activeCatalogBrushName}
            brushCatalogItems={draw.brushCatalogItems}
            brushDefaultRestore={draw.brushDefaultRestore}
            strokeWidth={draw.strokeWidth}
            brushOpacity={draw.brushOpacity}
            stabilizer={draw.stabilizer}
            stabilizerMode={draw.stabilizerMode}
            onStabilizerModeChange={stableHandlers.setStabilizerMode}
            color={draw.color}
            recentSwatches={DRAW_COLOR_SWATCHES}
            brushSlots={draw.brushSlots}
            symmetryType={draw.symmetryType}
            quickShapeActive={draw.quickShapeActive}
            onSelectBrush={(item) => stableHandlers.selectBrushId(item.id)}
            onRestoreBrushDefaults={stableHandlers.restoreBrushDefaults}
            onStrokeWidthChange={stableHandlers.setStrokeWidth}
            onOpacityChange={stableHandlers.setBrushOpacity}
            onStabilizerChange={stableHandlers.setStabilizer}
            postCorrection={draw.postCorrection}
            onPostCorrectionChange={stableHandlers.setPostCorrection}
            pressureCurveId={draw.pressureCurveId}
            onPressureCurveChange={stableHandlers.setPressureCurvePreset}
            stampTuning={draw.stampTuning}
            onStampTuningChange={stableHandlers.setStampTuning}
            onColorChange={stableHandlers.setColor}
            secondaryColor={draw.secondaryColor}
            onSecondaryColorChange={stableHandlers.setSecondaryColor}
            onSwapColors={stableHandlers.swapColors}
            eyedropperActive={draw.eyedropperActive}
            onToggleEyedropper={stableHandlers.toggleEyedropper}
            eraseToIntersection={draw.eraseToIntersection}
            onToggleEraseToIntersection={stableHandlers.toggleEraseToIntersection}
            canvasFlipH={draw.canvasFlipH}
            onToggleCanvasFlipH={stableHandlers.toggleCanvasFlip}
            onOpenBrushStudio={stableHandlers.openBrushStudio}
            onToggleQuickShape={stableHandlers.toggleQuickShape}
            onSetDrawMode={stableHandlers.setDrawMode}
            shapeKind={draw.drawShape}
            onShapeKindChange={(kind) =>
              stableHandlers.setDrawShape(kind as DrawShapeKind)
            }
            shapeFill={draw.shapeFill}
            onShapeFillChange={stableHandlers.setShapeFill}
            onRecallBrushSlot={stableHandlers.recallBrushSlot}
            onAssignBrushSlot={stableHandlers.assignBrushSlot}
            onSymmetryTypeChange={stableHandlers.setSymmetryType}
            sizeLocked={draw.sizeLocked}
            opacityLocked={draw.opacityLocked}
            onToggleSizeLock={stableHandlers.toggleSizeLock}
            onToggleOpacityLock={stableHandlers.toggleOpacityLock}
            recentBrushIds={draw.recentBrushIds}
            favoriteBrushIds={draw.favoriteBrushIds}
            onToggleFavoriteBrush={stableHandlers.toggleFavoriteBrush}
            onCycleStabilizer={stableHandlers.cycleStabilizer}
            livingInk={isMobile
              ? undefined
              : {
                  ...draw.livingInk,
                  onPhysicalModeEnabledChange: stableHandlers.setLivingInkPhysicalModeEnabled,
                  onModeChange: stableHandlers.setLivingInkMode,
                  onScopeChange: stableHandlers.setLivingInkScope,
                  onFix: stableHandlers.applyLivingInkFix,
                  onClear: stableHandlers.applyLivingInkClear,
                  onMaterialChange: stableHandlers.patchLivingInkMaterial,
                }}
          />
        </Suspense>
      ) : null}

      {selection.visible ? (
        // `null` fallback would collapse the 44px bar lane for the one frame the lazy chunk
        // takes to resolve, so the canvas below drops and springs back — the second half of the
        // measured two-step selection shift. The placeholder holds the exact bar geometry.
        <Suspense
          fallback={
            <div
              aria-hidden="true"
              data-studio-select-options-pending="true"
              className="relative z-[40] h-11 min-h-11 shrink-0 border-b border-line"
            />
          }
        >
          <StudioSelectOptionsBar
            selectionCount={selection.count}
            selectionLabel={selection.label}
            locked={selection.locked}
            onDuplicate={stableHandlers.duplicateSelection}
            onDelete={stableHandlers.deleteSelection}
            onBringFront={() => stableHandlers.reorderSelection("front")}
            onSendBack={() => stableHandlers.reorderSelection("back")}
            textEditLabel={selection.textEditLabel}
            onEditText={
              selection.textEditLabel
                ? stableHandlers.editSelectionText
                : undefined
            }
            onFitBubble={
              selection.canFitBubble
                ? stableHandlers.fitSelectionBubble
                : undefined
            }
            onToggleLock={
              selection.canToggleLock
                ? stableHandlers.toggleSelectedLock
                : undefined
            }
          />
        </Suspense>
      ) : null}
    </>
  );
});
