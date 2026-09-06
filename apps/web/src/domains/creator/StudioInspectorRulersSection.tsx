import { Suspense } from "react";

import { CANVAS_W } from "./studio-assets";
import {
  StudioAdvancedRulerPanel,
  StudioIsometricGridPanel,
  StudioPerspectivePanel,
} from "./studio-page-lazy-ui";
import { StudioInspectorSection } from "./StudioInspectorSection";

import type {
  StudioAdvancedRuler,
  StudioAdvancedRulerDocument,
} from "./studio-advanced-ruler-document";
import type { StudioIsometricPrimitiveSpec } from "./studio-isometric-primitive-contract";
import type { LayerGroup } from "./studio-layers";
import type { VanishingPoint } from "./studio-perspective-guide";

import { cn } from "@/shared/lib/utils";

interface StudioInspectorSymmetrySectionProps {
  symmetryType: "none" | "vertical" | "horizontal" | "radial" | "kaleidoscope" | "silk";
  symmetryRadialCount: number;
  symmetryCenterX: number;
  symmetryCenterY: number;
  canvasH: number;
  setSymmetryType: (value: "none" | "vertical" | "horizontal" | "radial" | "kaleidoscope" | "silk") => void;
  setSymmetryRadialCount: import("react").Dispatch<import("react").SetStateAction<number>>;
  setSymmetryCenterX: import("react").Dispatch<import("react").SetStateAction<number>>;
  setSymmetryCenterY: import("react").Dispatch<import("react").SetStateAction<number>>;
}

export function StudioInspectorSymmetrySection({
  symmetryType,
  symmetryRadialCount,
  symmetryCenterX,
  symmetryCenterY,
  canvasH,
  setSymmetryType,
  setSymmetryRadialCount,
  setSymmetryCenterX,
  setSymmetryCenterY,
}: StudioInspectorSymmetrySectionProps) {
  return (
    <StudioInspectorSection sectionId="tool.symmetry" loadingLabel="대칭 자를 여는 중...">
      <div className="space-y-2">
        <div className="grid grid-cols-5 gap-1">
          {([
            { id: "none", label: "없음" },
            { id: "vertical", label: "세로" },
            { id: "horizontal", label: "가로" },
            { id: "radial", label: "방사" },
            { id: "kaleidoscope", label: "만화경" },
          ] as const).map((type) => (
            <button
              key={type.id}
              type="button"
              onClick={() => setSymmetryType(type.id)}
              className={cn(
                "rounded py-1 text-[0.68rem] font-semibold border transition-colors cursor-pointer",
                symmetryType === type.id
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-line text-fg-2 hover:bg-raised"
              )}
            >
              {type.label}
            </button>
          ))}
        </div>

        {symmetryType !== "none" && (
          <div className="space-y-2 pl-1.5 border-l border-line/50 ml-1 py-1 animate-fade-in">
            {(symmetryType === "radial" || symmetryType === "kaleidoscope") && (
              <label className="flex items-center justify-between gap-2 text-xs text-fg-3">
                <span>갈래 수</span>
                <select
                  value={symmetryRadialCount}
                  onChange={(e) => setSymmetryRadialCount(Number(e.target.value))}
                  className="rounded border border-line bg-card px-1 py-0.5 text-xs text-fg focus-visible:outline focus-visible:outline-accent"
                >
                  {[4, 6, 8, 12, 16].map((num) => (
                    <option key={num} value={num}>
                      {num}방향
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="flex gap-2">
              <label className="flex-1 flex flex-col gap-0.5 text-[0.68rem] text-fg-3">
                <span>중앙 X</span>
                <input
                  type="number"
                  value={Math.round(symmetryCenterX)}
                  onChange={(e) => setSymmetryCenterX(Number(e.target.value))}
                  className="w-full rounded border border-line bg-card px-1 py-0.5 text-[0.65rem] text-fg focus-visible:outline focus-visible:outline-accent"
                />
              </label>
              <label className="flex-1 flex flex-col gap-0.5 text-[0.68rem] text-fg-3">
                <span>중앙 Y</span>
                <input
                  type="number"
                  value={Math.round(symmetryCenterY)}
                  onChange={(e) => setSymmetryCenterY(Number(e.target.value))}
                  className="w-full rounded border border-line bg-card px-1 py-0.5 text-[0.65rem] text-fg focus-visible:outline focus-visible:outline-accent"
                />
              </label>
            </div>

            <button
              type="button"
              onClick={() => {
                setSymmetryCenterX(CANVAS_W / 2);
                setSymmetryCenterY(canvasH / 2);
              }}
              className="w-full rounded border border-line bg-card py-1 text-[0.68rem] font-semibold text-fg-2 hover:bg-raised transition-colors cursor-pointer"
            >
              대칭축 중앙 정렬
            </button>
          </div>
        )}
      </div>
    </StudioInspectorSection>
  );
}

interface StudioInspectorRulersSectionProps {
  perspectiveRulerActive: boolean;
  vanishingPoints: VanishingPoint[];
  perspectiveEyeLevelY: number | null;
  perspectiveLockHorizon: boolean;
  canvasH: number;
  drawingAssistControlsDisabled: boolean;
  drawingAssistDisabledReason?: string | null;
  isometricGridActive: boolean;
  isometricAngleDeg: number;
  isometricCellSize: number;
  isometricOriginX: number;
  isometricOriginY: number;
  advancedRulers: StudioAdvancedRulerDocument;
  groups: LayerGroup[];
  setPerspectiveRulerActive: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  addVanishingPointHandler: () => void;
  removeVanishingPointHandler: (id: string) => void;
  previewVanishingPointById: (id: string, x: number, y: number) => void;
  moveVanishingPointById: (id: string, x: number, y: number) => void;
  setPerspectiveLockHorizon: (next: boolean) => void;
  setPerspectiveEyeLevelY: (y: number) => void;
  previewPerspectiveEyeLevelY: (y: number) => void;
  alignPerspectiveToEyeLevel: () => void;
  toggleIsometricGridActive: () => void;
  previewIsometricAngleDegClamped: (next: number) => void;
  setIsometricAngleDegClamped: (next: number) => void;
  previewIsometricCellSizeClamped: (next: number) => void;
  setIsometricCellSizeClamped: (next: number) => void;
  previewIsometricOrigin: (x: number, y: number) => void;
  commitIsometricOrigin: (x: number, y: number) => void;
  resetIsometricOrigin: () => void;
  insertIsometricPrimitive: (spec: StudioIsometricPrimitiveSpec) => Promise<void>;
  insertIsometricSolid: () => void;
  addAdvancedRuler: (type: StudioAdvancedRuler["type"]) => void;
  patchAdvancedRuler: (id: string, patch: Partial<StudioAdvancedRuler>) => void;
  removeAdvancedRuler: (id: string) => void;
  selectAdvancedRuler: (id: string | null) => void;
  setActiveAdvancedRuler: (id: string | null) => void;
}

export function StudioInspectorRulersSection({
  perspectiveRulerActive,
  vanishingPoints,
  perspectiveEyeLevelY,
  perspectiveLockHorizon,
  canvasH,
  drawingAssistControlsDisabled,
  drawingAssistDisabledReason,
  isometricGridActive,
  isometricAngleDeg,
  isometricCellSize,
  isometricOriginX,
  isometricOriginY,
  advancedRulers,
  groups,
  setPerspectiveRulerActive,
  addVanishingPointHandler,
  removeVanishingPointHandler,
  previewVanishingPointById,
  moveVanishingPointById,
  setPerspectiveLockHorizon,
  setPerspectiveEyeLevelY,
  previewPerspectiveEyeLevelY,
  alignPerspectiveToEyeLevel,
  toggleIsometricGridActive,
  previewIsometricAngleDegClamped,
  setIsometricAngleDegClamped,
  previewIsometricCellSizeClamped,
  setIsometricCellSizeClamped,
  previewIsometricOrigin,
  commitIsometricOrigin,
  resetIsometricOrigin,
  insertIsometricPrimitive,
  insertIsometricSolid,
  addAdvancedRuler,
  patchAdvancedRuler,
  removeAdvancedRuler,
  selectAdvancedRuler,
  setActiveAdvancedRuler,
}: StudioInspectorRulersSectionProps) {
  return (
    <StudioInspectorSection sectionId="tool.rulers" loadingLabel="자·가이드를 여는 중...">
      <Suspense fallback={null}>
        <StudioPerspectivePanel
          active={perspectiveRulerActive}
          points={vanishingPoints}
          eyeLevelY={perspectiveEyeLevelY}
          lockHorizon={perspectiveLockHorizon}
          canvasHeight={canvasH}
          disabled={drawingAssistControlsDisabled}
          disabledReason={drawingAssistDisabledReason ?? undefined}
          onToggleActive={() => {
            setPerspectiveRulerActive((active) => !active);
          }}
          onAddPoint={addVanishingPointHandler}
          onRemovePoint={removeVanishingPointHandler}
          onPreviewPoint={previewVanishingPointById}
          onCommitPoint={moveVanishingPointById}
          onToggleLockHorizon={setPerspectiveLockHorizon}
          onCommitEyeLevelY={setPerspectiveEyeLevelY}
          onPreviewEyeLevelY={previewPerspectiveEyeLevelY}
          onAlignToEyeLevel={alignPerspectiveToEyeLevel}
        />
      </Suspense>
      <Suspense fallback={null}>
        <StudioIsometricGridPanel
          active={isometricGridActive}
          config={{
            angleDeg: isometricAngleDeg,
            cellSize: isometricCellSize,
            originX: isometricOriginX,
            originY: isometricOriginY,
          }}
          disabled={drawingAssistControlsDisabled}
          disabledReason={drawingAssistDisabledReason ?? undefined}
          onToggleActive={toggleIsometricGridActive}
          onPreviewAngle={previewIsometricAngleDegClamped}
          onCommitAngle={setIsometricAngleDegClamped}
          onPreviewCellSize={previewIsometricCellSizeClamped}
          onCommitCellSize={setIsometricCellSizeClamped}
          onPreviewOrigin={previewIsometricOrigin}
          onCommitOrigin={commitIsometricOrigin}
          onResetOrigin={resetIsometricOrigin}
          onInsertPrimitive={insertIsometricPrimitive}
          onInsertSolid={insertIsometricSolid}
        />
      </Suspense>
      <Suspense fallback={null}>
        <StudioAdvancedRulerPanel
          document={advancedRulers}
          groups={groups}
          canvasWidth={CANVAS_W}
          canvasHeight={canvasH}
          disabled={drawingAssistControlsDisabled}
          disabledReason={drawingAssistDisabledReason ?? undefined}
          onAdd={addAdvancedRuler}
          onPatch={patchAdvancedRuler}
          onRemove={removeAdvancedRuler}
          onSelect={selectAdvancedRuler}
          onSetActiveSnap={setActiveAdvancedRuler}
        />
      </Suspense>
    </StudioInspectorSection>
  );
}
