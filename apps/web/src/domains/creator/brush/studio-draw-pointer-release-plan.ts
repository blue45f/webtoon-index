/**
 * Pure completed-stroke release planning.
 *
 * The Page remains responsible for reading the final hardware coordinate, draining stabilizers,
 * publishing CRDT samples, owning live surfaces, committing history, and cleaning pointer state.
 * This leaf starts only after those release samples are authoritative and decides the immutable
 * geometry stored by the commit path plus whether that path may use the deferred batch.
 */

import { smoothStrokePoints } from "../studio-brush";
import { isStudioPixelPencilRenderMode } from "../studio-pixel-pencil";
import {
  planStudioQuickShapeRelease,
  type StudioQuickShapeBrushEffectMode,
  type StudioQuickShapeBrushEffectStatus,
  type StudioQuickShapeReleaseTransition,
} from "../studio-quickshape-release-promotion";

import { isStudioImmediateFreehandCommit } from "./studio-draw-completion";

import type { DrawEl } from "../studio-element-model";
import type { StudioSmartShapeBrushEffectUnavailableReason } from "../studio-smart-shape-brush-effect";

export type StudioDrawReleaseShapeKind = Exclude<
  NonNullable<DrawEl["kind"]>,
  "freehand"
>;

export interface StudioDrawReleaseQuickShapeSnapshot {
  readonly active: boolean;
  readonly anchor: Readonly<{ x: number; y: number }> | null;
  readonly sourcePoints: readonly number[];
  readonly stableSourceLength: number;
  readonly elapsed: number;
  readonly locked: boolean;
  readonly converted: boolean;
  /** Plain is the backward-compatible default; selected-brush routes supported effects to outline ink. */
  readonly brushEffectMode?: StudioQuickShapeBrushEffectMode;
  /** Original freehand snapshot needed when live QuickShape already removed its brush fields. */
  readonly brushEffectSource?: DrawEl | null;
}

export interface StudioDrawPointerReleasePlanInput {
  /** A complete stroke whose release coordinate and stabilizer drain are already authoritative. */
  readonly stroke: DrawEl;
  readonly quickShape: StudioDrawReleaseQuickShapeSnapshot;
  readonly postCorrection: Readonly<{
    strength: number;
    preserveCorners: boolean;
    causalStateSealed: boolean;
  }>;
  readonly commit: Readonly<{
    masterEditMode: boolean;
    directLiveDraft: boolean;
    /** Whether Canvas/WebGPU can keep an opaque direct draft visible until the deferred commit. */
    directInkSurfaceAvailable: boolean;
  }>;
}

export type StudioDrawReleaseQuickShapeTransition = StudioQuickShapeReleaseTransition;

export interface StudioDrawPointerReleasePlan {
  readonly stroke: DrawEl;
  readonly quickShapeTransition: StudioDrawReleaseQuickShapeTransition;
  readonly quickShapeAnnouncementKind: StudioDrawReleaseShapeKind | null;
  readonly quickShapeBrushEffectStatus: StudioQuickShapeBrushEffectStatus;
  readonly quickShapeBrushEffectRejectionReason: StudioSmartShapeBrushEffectUnavailableReason | null;
  readonly postCorrectionApplied: boolean;
  readonly commitMode: "immediate" | "deferred";
}

/**
 * Finalizes geometry and classifies commit latency without reading refs or touching render state.
 * The caller must still execute and recover the selected commit path.
 */
export function planStudioDrawPointerRelease(
  input: StudioDrawPointerReleasePlanInput
): StudioDrawPointerReleasePlan {
  const quickShape = planStudioQuickShapeRelease(input.stroke, input.quickShape);
  let stroke = quickShape.stroke;

  let postCorrectionApplied = false;
  if (
    (stroke.kind ?? "freehand") === "freehand"
    && quickShape.brushEffectStatus !== "applied"
    && quickShape.brushEffectStatus !== "rejected"
    && !isStudioPixelPencilRenderMode(stroke.brush)
    && input.postCorrection.strength > 0
    && stroke.stampPipeline !== "causal-walker-v2"
    && stroke.watercolorPipeline !== "causal-walker-v2"
    && !input.postCorrection.causalStateSealed
  ) {
    stroke = {
      ...stroke,
      points: smoothStrokePoints(stroke.points, input.postCorrection.strength, {
        preserveCorners: input.postCorrection.preserveCorners,
      }),
    };
    postCorrectionApplied = true;
  }

  const eraserKeepsLivePreview = stroke.mode === "eraser" && input.commit.directLiveDraft;
  const canKeepDeferredInkVisible = input.commit.directLiveDraft
    ? input.commit.directInkSurfaceAvailable || eraserKeepsLivePreview
    : stroke.mode !== "eraser";
  const deferred =
    !input.commit.masterEditMode
    // Taps and short flicks must become undo/autosave-authoritative in the pointerup task.
    && !isStudioImmediateFreehandCommit(stroke)
    // The live direct surface still contains the pre-snap gesture/primitive, not the rebuilt
    // brush outline. Applied effects and rejected promotions both commit synchronously: the latter
    // restores the exact pre-promotion source instead of preserving a geometric substitute.
    && quickShape.brushEffectStatus !== "applied"
    && quickShape.brushEffectStatus !== "rejected"
    // Direct drafts may defer only while their Canvas/WebGPU pixels can survive the handoff.
    && canKeepDeferredInkVisible;

  return {
    stroke,
    quickShapeTransition: quickShape.transition,
    quickShapeAnnouncementKind: quickShape.announcementKind,
    quickShapeBrushEffectStatus: quickShape.brushEffectStatus,
    quickShapeBrushEffectRejectionReason: quickShape.brushEffectRejectionReason,
    postCorrectionApplied,
    commitMode: deferred ? "deferred" : "immediate",
  };
}
