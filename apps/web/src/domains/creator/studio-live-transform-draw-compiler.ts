/**
 * Captures every DrawEl fact needed by a live transform at gesture start.
 *
 * Keeping this compiler out of the selection-decoration caller prevents UI wiring from knowing
 * StudioDrawNode's route thresholds, arrow semantics, or perfect-outline engine identities.
 */
import { mapStudioBrushAliasPressure } from "./brush/studio-brush-alias-profile";
import { resolveStudioBrushRuntimeContract } from "./brush/studio-brush-runtime-contract";
import { studioCalligraphyRibbonWorkUpperBound } from "./brush/studio-calligraphy-ribbon";
import { studioLiveBrushEffectiveDiameter } from "./brush/studio-draw-rendering";
import { studioInkPressureRadius } from "./brush/studio-ink-pressure-model";
import { studioAngledNibCoverageWorkUpperBound } from "./brush/studio-stroke-local-coverage";
import { studioLineDrawsArrowHead } from "./brush/studio-stroke-shapes";
import { studioCalligraphyMaximumNibRadius } from "./studio-brush";
import {
  STUDIO_LIVE_TRANSFORM_EXACT_MAX_ANGLED_RIBBON_SAMPLES,
  STUDIO_LIVE_TRANSFORM_EXACT_MAX_CALLIGRAPHY_SAMPLES,
  STUDIO_LIVE_TRANSFORM_EXACT_MAX_CAUSAL_SAMPLES,
  STUDIO_LIVE_TRANSFORM_EXACT_MAX_GENERIC_SAMPLES,
  STUDIO_LIVE_TRANSFORM_EXACT_MAX_PERFECT_SAMPLES,
  STUDIO_LIVE_TRANSFORM_EXACT_MAX_SCENE_ELEMENTS,
} from "./studio-live-transform-exact-draft-admission";
import { studioLiveTransformRouteOfPoints } from "./studio-live-transform-render-route";
import { STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1 } from "./studio-material-pressure-model";
import {
  STUDIO_OUTLINE_STROKE_ENGINE,
  resolveStudioOutlineStrokeContract,
} from "./studio-outline-stroke-contract";
import {
  studioPerfectFreehandMaximumPaintRadius,
  studioPerfectFreehandWorkUpperBound,
} from "./studio-perfect-freehand";
import {
  resolveStudioRetainedMediaPressureProfileId,
  studioRetainedMediaMaximumSizeScale,
} from "./studio-retained-media-pressure";

import type { DrawEl } from "./studio-element-model";
import type { StudioLiveTransformExactDraftComplexity } from "./studio-live-transform-exact-draft-admission";
import type { StudioLiveTransformRenderRoute } from "./studio-live-transform-render-route";

export interface StudioLiveTransformDrawSnapshot {
  readonly elementId: string;
  readonly element: DrawEl;
  readonly points: readonly number[];
  readonly noClip?: boolean;
  readonly renderRoute: StudioLiveTransformRenderRoute;
  /** O(1) per-frame work admission facts; every O(points) measurement is compiled only once. */
  readonly exactDraftComplexity: StudioLiveTransformExactDraftComplexity;
}

const STUDIO_LIVE_TRANSFORM_SAMPLE_CHANNELS = [
  "pressures",
  "tiltXs",
  "tiltYs",
  "twists",
  "speeds",
  "tangentialPressures",
  "altitudeAngles",
  "azimuthAngles",
  "contactWidths",
  "contactHeights",
  "sampleTimeOffsets",
] as const satisfies readonly (keyof DrawEl)[];

export type StudioLiveTransformDrawCompilationAdmission =
  | { readonly admitted: true; readonly maxSamples: number }
  | {
      readonly admitted: false;
      readonly reason: "invalid" | "scene-budget" | "sample-budget" | "channel-budget";
    };

/**
 * O(1) gate that runs before cloning or traversing a DrawEl.
 *
 * A rejected 100k-sample stroke is release-only, so transformstart must not first stringify it,
 * clone up to eleven sample arrays and calculate its full path length. Array `length` and the
 * renderer registry are enough to cap the compiler's one-time work before it begins.
 */
export function admitStudioLiveTransformDrawCompilation(
  element: DrawEl,
  sceneElementCount: number,
): StudioLiveTransformDrawCompilationAdmission {
  if (
    !Array.isArray(element.points)
    || element.points.length % 2 !== 0
    || !Number.isSafeInteger(sceneElementCount)
    || sceneElementCount < 0
  ) {
    return { admitted: false, reason: "invalid" };
  }
  if (sceneElementCount > STUDIO_LIVE_TRANSFORM_EXACT_MAX_SCENE_ELEMENTS) {
    return { admitted: false, reason: "scene-budget" };
  }
  const outlineContract = resolveStudioOutlineStrokeContract(element.outlineStroke);
  const engine = outlineContract.status === "ready"
    ? outlineContract.contract.engine === STUDIO_OUTLINE_STROKE_ENGINE
      ? "perfect-outline"
      : "capsule-outline"
    : resolveStudioBrushRuntimeContract(element.brush)?.engine;
  const maxSamples = engine === "causal-ink"
    ? STUDIO_LIVE_TRANSFORM_EXACT_MAX_CAUSAL_SAMPLES
    : engine === "calligraphy-segments"
      ? STUDIO_LIVE_TRANSFORM_EXACT_MAX_CALLIGRAPHY_SAMPLES
      : engine === "perfect-outline"
        ? STUDIO_LIVE_TRANSFORM_EXACT_MAX_PERFECT_SAMPLES
        : engine === "angled-ribbon"
          ? STUDIO_LIVE_TRANSFORM_EXACT_MAX_ANGLED_RIBBON_SAMPLES
          : STUDIO_LIVE_TRANSFORM_EXACT_MAX_GENERIC_SAMPLES;
  if (element.points.length / 2 > maxSamples) {
    return { admitted: false, reason: "sample-budget" };
  }
  for (const channel of STUDIO_LIVE_TRANSFORM_SAMPLE_CHANNELS) {
    const value = element[channel];
    if (Array.isArray(value) && value.length > maxSamples) {
      return { admitted: false, reason: "channel-budget" };
    }
  }
  return { admitted: true, maxSamples };
}

export function compileStudioLiveTransformDrawSnapshot(
  element: DrawEl,
): StudioLiveTransformDrawSnapshot {
  const runtimeContract = resolveStudioBrushRuntimeContract(element.brush);
  const outlineContract = resolveStudioOutlineStrokeContract(element.outlineStroke);
  const rendererEngine = outlineContract.status === "ready"
    ? outlineContract.contract.engine === STUDIO_OUTLINE_STROKE_ENGINE
      ? "perfect-outline"
      : "capsule-outline"
    : runtimeContract?.engine;
  const rendererNeedsExactDraft =
    // Causal ink uses absolute dab-spacing and radius floors in both legacy and versioned pressure
    // models. Scaling an already-planned dab field therefore changes its topology differently from
    // replanning the committed points/width.
    rendererEngine === "causal-ink"
    // Calligraphy clamps base width/segment width and ribbon coordinates in absolute units.
    || rendererEngine === "calligraphy-segments"
    // Perfect-freehand's planner contains topology decisions and absolute epsilon/radius floors
    // inside the dependency itself. This applies to legacy strokes as well as versioned G-pen
    // outline contracts, so no hand-maintained distance threshold can certify an affine subtree.
    || rendererEngine === "perfect-outline"
    // The angled nib fills stroke-local polygons whose winding normalization and tonal banding are
    // absolute-alpha decisions taken over the PLANNED geometry. Scaling an already-planned band
    // stack is not the same as replanning the transformed centre line, so this engine also takes
    // the isolated model draft rather than a retained affine.
    || rendererEngine === "angled-ribbon"
    || element.outlineStroke !== undefined;
  const snapshotElement: DrawEl = {
    ...element,
    points: [...element.points],
    ...(element.pressures ? { pressures: [...element.pressures] } : {}),
    ...(element.tiltXs ? { tiltXs: [...element.tiltXs] } : {}),
    ...(element.tiltYs ? { tiltYs: [...element.tiltYs] } : {}),
    ...(element.twists ? { twists: [...element.twists] } : {}),
    ...(element.speeds ? { speeds: [...element.speeds] } : {}),
    ...(element.tangentialPressures
      ? { tangentialPressures: [...element.tangentialPressures] }
      : {}),
    ...(element.altitudeAngles ? { altitudeAngles: [...element.altitudeAngles] } : {}),
    ...(element.azimuthAngles ? { azimuthAngles: [...element.azimuthAngles] } : {}),
    ...(element.contactWidths ? { contactWidths: [...element.contactWidths] } : {}),
    ...(element.contactHeights ? { contactHeights: [...element.contactHeights] } : {}),
    ...(element.sampleTimeOffsets
      ? { sampleTimeOffsets: [...element.sampleTimeOffsets] }
      : {}),
    ...(element.brushTip ? { brushTip: { ...element.brushTip } } : {}),
    ...(element.shapeParams ? { shapeParams: { ...element.shapeParams } } : {}),
    ...(element.strokeStyle ? { strokeStyle: { ...element.strokeStyle } } : {}),
    ...(element.symmetry ? { symmetry: { ...element.symmetry } } : {}),
  };
  const renderRoute = {
    ...studioLiveTransformRouteOfPoints(element.points, element.strokeWidth),
    retainedAffinePolicy: rendererNeedsExactDraft
      ? "model-draft-only" as const
      : "route-checked" as const,
    drawsArrowHead:
      element.kind === "arrow"
      || (element.kind === "line" && studioLineDrawsArrowHead(element.strokeStyle)),
    isPerfectFamily:
      rendererEngine === "perfect-outline",
    isPerfectInk: element.brush === "perfect-ink",
  };
  const calligraphyWork = rendererEngine === "calligraphy-segments"
    ? studioCalligraphyRibbonWorkUpperBound(renderRoute.pointCount)
    : null;
  const perfectWork = rendererEngine === "perfect-outline"
    ? studioPerfectFreehandWorkUpperBound(renderRoute.pointCount)
    : null;
  const angledNibWork = rendererEngine === "angled-ribbon"
    ? studioAngledNibCoverageWorkUpperBound(renderRoute.pointCount)
    : null;
  // `StudioDrawNode` supplies the retained-media pressure series only under the canonical material
  // model; without it every nib offset uses `sizeScale` 1. Mirrored here so the budget charges the
  // radius the branch will actually paint rather than a worst case no stroke can reach.
  const angledNibMaximumRadius = rendererEngine === "angled-ribbon"
    ? studioLiveBrushEffectiveDiameter(element) / 2
      * (
        element.materialPressureModel === STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1
          ? studioRetainedMediaMaximumSizeScale(
              resolveStudioRetainedMediaPressureProfileId(element.brush) ?? "brush",
            )
          : 1
      )
    : null;
  const perfectRendererDiameter = outlineContract.status === "ready"
    && outlineContract.contract.engine === STUDIO_OUTLINE_STROKE_ENGINE
    ? Math.min(
        8_192,
        Math.max(
          0.01,
          Math.min(8_192, Math.max(0.01, element.strokeWidth))
            * outlineContract.contract.profile.diameterScale,
        ),
      )
    : studioLiveBrushEffectiveDiameter(element);
  const calligraphyMaximumTapPressure = element.mode === "eraser"
    ? 1
    : mapStudioBrushAliasPressure(element.brush, 1, 0.5);
  return {
    elementId: element.id,
    element: snapshotElement,
    // A gesture snapshot is immutable even if a legacy caller mutates its DrawEl array in place.
    points: snapshotElement.points,
    ...(element.noClip !== undefined ? { noClip: element.noClip } : {}),
    renderRoute,
    exactDraftComplexity: {
      ...(rendererEngine !== undefined
        ? { rendererEngine }
        : {}),
      sampleCount: renderRoute.pointCount,
      pathLength: renderRoute.pathLength ?? Number.POSITIVE_INFINITY,
      strokeWidth: element.strokeWidth,
      ...(rendererEngine === "causal-ink"
        ? {
            // The causal renderer consumes alias-scaled diameter and its legacy pressure law can
            // reach 1.7x that diameter. Raw DrawEl.strokeWidth therefore is not a safe overdraw cap.
            causalMaxDabRadius: studioInkPressureRadius(
              studioLiveBrushEffectiveDiameter(element),
              1,
              element.pressureModel,
            ),
          }
        : {}),
      ...(rendererEngine === "calligraphy-segments"
        ? {
            rendererExpandedScalarWork:
              calligraphyWork?.outlineCoordinateScalars ?? Number.POSITIVE_INFINITY,
            rendererPathCommandUpperBound:
              calligraphyWork?.canvasPathCommands ?? Number.POSITIVE_INFINITY,
            rendererMaxPaintRadius: studioCalligraphyMaximumNibRadius(
              studioLiveBrushEffectiveDiameter(element),
              renderRoute.pointCount,
              calligraphyMaximumTapPressure,
            ),
          }
        : {}),
      ...(rendererEngine === "perfect-outline"
        ? {
            // The Q path serializes four numeric coordinate fields per expanded outline vertex.
            rendererExpandedScalarWork:
              perfectWork?.pathCoordinateScalars ?? Number.POSITIVE_INFINITY,
            rendererPathCommandUpperBound:
              perfectWork?.pathCommands ?? Number.POSITIVE_INFINITY,
            rendererMaxPaintRadius:
              studioPerfectFreehandMaximumPaintRadius(perfectRendererDiameter),
          }
        : {}),
      ...(rendererEngine === "angled-ribbon"
        ? {
            rendererExpandedScalarWork:
              angledNibWork?.canvasCoordinateScalars ?? Number.POSITIVE_INFINITY,
            rendererPathCommandUpperBound:
              angledNibWork?.canvasPathCommands ?? Number.POSITIVE_INFINITY,
            rendererMaxPaintRadius: angledNibMaximumRadius ?? Number.POSITIVE_INFINITY,
          }
        : {}),
    },
  };
}
