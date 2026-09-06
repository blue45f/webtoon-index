import {
  mapStudioBrushAliasPressureSamples,
  studioBrushAliasEffectiveDiameter,
} from "../brush/studio-brush-alias-profile";
import {
  studioInkFallbackPressure,
  resolveStudioInkPressureSamples,
  type StudioInkPressureModel,
} from "../brush/studio-ink-pressure-model";
import {
  processFreehandPoints,
  resampleStrokePressures,
  strokeRenderDistance,
} from "../studio-brush";
import { selectStudioCausalInkSamples } from "../studio-causal-ink";

import {
  planStudioWebGpuCommittedSuffix,
  type StudioWebGpuCommittedElementInput,
  type StudioWebGpuCommittedPlan,
  type StudioWebGpuCommittedPlanGates,
} from "./studio-webgpu-committed-plan";

import type { StudioGpuStroke } from "./studio-webgpu-stroke";

export interface StudioWebGpuCommittedHandoffElement extends StudioWebGpuCommittedElementInput {
  readonly sampleSpacing?: unknown;
}

export type StudioWebGpuCommittedHandoff<
  T extends StudioWebGpuCommittedHandoffElement,
> = StudioWebGpuCommittedPlan<T> & {
  /** Exact default-pen operations in the same back-to-front order as `elementIds`. */
  readonly strokes: readonly StudioGpuStroke[];
};

export interface StudioWebGpuCommittedHandoffInput<
  T extends StudioWebGpuCommittedHandoffElement,
> {
  readonly elements: readonly T[];
  readonly gates?: StudioWebGpuCommittedPlanGates;
}

function committedElementToGpuStroke(
  element: StudioWebGpuCommittedHandoffElement
): StudioGpuStroke {
  // The planner has already validated these fields. Re-running StudioDrawNode's exact point and
  // pressure pipeline here keeps the GPU handoff pixel-compatible with the source renderer.
  const sourcePoints = element.points as readonly number[];
  const sourcePressures = Array.isArray(element.pressures)
    ? element.pressures as readonly number[]
    : undefined;
  const pressureModel = element.pressureModel as StudioInkPressureModel | undefined;
  const causalSampleSpacing = typeof element.sampleSpacing === "number"
    && Number.isFinite(element.sampleSpacing)
    ? element.sampleSpacing
    : null;
  const usesCausalGeometry = causalSampleSpacing !== null || pressureModel !== undefined;
  const causalSamples = usesCausalGeometry
    ? selectStudioCausalInkSamples({
        points: sourcePoints,
        pressures: sourcePressures,
        pressureModel,
        minDistance: causalSampleSpacing ?? 0,
      })
    : null;
  const points = causalSamples
    ? causalSamples.flatMap(({ x, y }) => [x, y])
    : processFreehandPoints(
        [...sourcePoints],
        strokeRenderDistance(element.sampleSpacing)
      );
  const resolvedPressures = causalSamples
    ? causalSamples.map(({ pressure }) => pressure)
    : resampleStrokePressures(
        pressureModel === undefined
          ? sourcePressures
          : resolveStudioInkPressureSamples(
              sourcePressures,
              sourcePoints.length / 2,
              pressureModel
            ),
        points.length / 2,
        studioInkFallbackPressure(pressureModel)
      );
  const pressures = mapStudioBrushAliasPressureSamples(
    element.brush,
    resolvedPressures,
    points.length / 2,
    studioInkFallbackPressure(pressureModel)
  );

  return {
    id: element.id,
    points,
    pressures,
    color: element.stroke as string,
    // StudioDrawNode clamps legacy sub-pixel widths to one logical pixel before pressure scaling.
    size: studioBrushAliasEffectiveDiameter(
      element.brush,
      Math.max(1, element.strokeWidth as number)
    ),
    ...(pressureModel === undefined
      ? {}
      : { pressureModel }),
    opacity: element.opacity as number | undefined,
    composite: "normal",
  };
}

/**
 * Plans and converts the frontmost committed drawing suffix that a transparent GPU overlay may
 * own without changing scene z-order. Unsupported content remains an explicit barrier.
 */
export function createStudioWebGpuCommittedHandoff<
  T extends StudioWebGpuCommittedHandoffElement,
>(input: StudioWebGpuCommittedHandoffInput<T>): StudioWebGpuCommittedHandoff<T> {
  // This render handoff needs causal-only geometry: it feeds committedElementToGpuStroke, which
  // mirrors Konva's dab path exactly and has no equivalent for legacy segment strokes. The
  // raster-CRDT promotion path shares the same barrier function and opts in for the same reason.
  const plan = planStudioWebGpuCommittedSuffix({ ...input, barrierOptions: { requireCausalGeometry: true } });
  return {
    ...plan,
    strokes: plan.status === "ready"
      ? plan.elements.map(committedElementToGpuStroke)
      : [],
  };
}
