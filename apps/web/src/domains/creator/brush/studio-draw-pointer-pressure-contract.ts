/**
 * Pure pressure-related capture policy for a new Studio draw element.
 *
 * The pointer-start planner owns when this snapshot is taken. This leaf keeps the family/material
 * lookup and dynamics normalization together so the planner remains a small orchestration boundary.
 */

import { resolveStudioHybridPressureProfile } from "../hybrid-dcc/studio-hybrid-pressure-profile";
import { isStudioFxPressureBrushId } from "../studio-fx-brush";
import {
  STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
  snapshotStudioMaterialMinimumDiameterRatio,
} from "../studio-material-pressure-model";
import { resolveStudioRetainedMediaPressureProfileId } from "../studio-retained-media-pressure";

import {
  normalizeStudioBrushDynamicsSettings,
} from "./studio-brush-dynamics";

export interface StudioDrawPointerPressureContractInput {
  readonly drawMode: string;
  readonly brush: string;
  readonly brushDynamics?: unknown;
  readonly pressureMinSize?: unknown;
  readonly strokeWidth: number;
}

/** Captures persisted material and dynamic geometry floors without altering pigment pressure. */
export function captureStudioDrawPointerPressureContract(
  input: StudioDrawPointerPressureContractInput,
  capturePointerDynamics: boolean,
) {
  const familyMinimum = resolveStudioHybridPressureProfile(input.brush)?.minimumWidthRatio;
  const materialPressureModel = input.drawMode === "pen"
    && (
      isStudioFxPressureBrushId(input.brush)
      || resolveStudioRetainedMediaPressureProfileId(input.brush) !== null
    )
    ? STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1
    : undefined;
  const materialMinimumDiameterRatio = materialPressureModel
    ? snapshotStudioMaterialMinimumDiameterRatio(input.pressureMinSize, familyMinimum)
    : undefined;
  const normalizedBrushDynamics = capturePointerDynamics
    ? normalizeStudioBrushDynamicsSettings(input.brushDynamics)
    : undefined;
  const brushDynamics = normalizedBrushDynamics
    ? normalizeStudioBrushDynamicsSettings({
        ...normalizedBrushDynamics,
        // Replay receives only this snapshot, so capture toolbar geometry at pointer start.
        width: { ...normalizedBrushDynamics.width, base: input.strokeWidth },
        minimumDiameterRatio: Math.max(
          normalizedBrushDynamics.minimumDiameterRatio ?? 0,
          snapshotStudioMaterialMinimumDiameterRatio(
            input.pressureMinSize,
            familyMinimum,
          ),
        ),
      })
    : undefined;

  return {
    materialPressureModel,
    materialMinimumDiameterRatio,
    brushDynamics,
  };
}
