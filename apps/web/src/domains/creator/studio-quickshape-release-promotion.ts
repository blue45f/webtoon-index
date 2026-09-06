import { DEFAULT_SHAPE_PARAMS } from "./brush/studio-stroke-shapes";
import { isStudioPixelPencilRenderMode } from "./studio-pixel-pencil";
import {
  promoteFreehandQuickShapeOnRelease,
  trimQuickShapeDwellTail,
  QUICKSHAPE_LOCK_HOLD_MS,
} from "./studio-quickshape";
import {
  applyStudioSmartShapeBrushEffect,
  resolveStudioSmartShapeBrushEffectAvailability,
  type StudioSmartShapeBrushEffectUnavailableReason,
} from "./studio-smart-shape-brush-effect";

import type { DrawEl } from "./studio-element-model";
import type { QuickShapeKind } from "./studio-quickshape";

export type StudioQuickShapeBrushEffectMode = "plain" | "selected-brush";

export interface StudioQuickShapeReleaseSnapshot {
  readonly active: boolean;
  readonly anchor: Readonly<{ x: number; y: number }> | null;
  readonly sourcePoints: readonly number[];
  readonly stableSourceLength: number;
  readonly elapsed: number;
  readonly locked: boolean;
  readonly converted: boolean;
  /** Defaults to `plain`, preserving existing documents and gestures. */
  readonly brushEffectMode?: StudioQuickShapeBrushEffectMode;
  /** Required after the live hold path has already replaced the draft's brush fields. */
  readonly brushEffectSource?: DrawEl | null;
}

export type StudioQuickShapeReleaseTransition = "none" | "promoted" | "already-converted";
export type StudioQuickShapeBrushEffectStatus =
  | "not-requested"
  | "not-applicable"
  | "applied"
  | "rejected";

export interface StudioQuickShapeReleaseResult {
  readonly stroke: DrawEl;
  readonly transition: StudioQuickShapeReleaseTransition;
  readonly announcementKind: QuickShapeKind | null;
  readonly brushEffectStatus: StudioQuickShapeBrushEffectStatus;
  readonly brushEffectRejectionReason: StudioSmartShapeBrushEffectUnavailableReason | null;
}

function legacyPlainPromotion(
  stroke: DrawEl,
  promoted: NonNullable<ReturnType<typeof promoteFreehandQuickShapeOnRelease>>,
): DrawEl {
  return {
    ...stroke,
    kind: promoted.kind,
    brush: undefined,
    brushCatalogId: undefined,
    brushCatalogName: undefined,
    pressures: undefined,
    inkInput: undefined,
    pressureModel: undefined,
    outlineStroke: undefined,
    materialPressureModel: undefined,
    materialMinimumDiameterRatio: undefined,
    sampleSpacing: undefined,
    tiltXs: undefined,
    tiltYs: undefined,
    twists: undefined,
    speeds: undefined,
    tangentialPressures: undefined,
    altitudeAngles: undefined,
    azimuthAngles: undefined,
    contactWidths: undefined,
    contactHeights: undefined,
    sampleTimeOffsets: undefined,
    brushDynamics: undefined,
    brushTip: undefined,
    stamp: undefined,
    stampPipeline: undefined,
    watercolorPipeline: undefined,
    paintModel: undefined,
    fill: undefined,
    points: promoted.points,
    shapeParams: promoted.polygonSides === undefined
      ? undefined
      : { ...DEFAULT_SHAPE_PARAMS, polygonSides: promoted.polygonSides },
  };
}

function noChange(
  stroke: DrawEl,
  requested: boolean,
): StudioQuickShapeReleaseResult {
  return {
    stroke,
    transition: "none",
    announcementKind: null,
    brushEffectStatus: requested ? "not-applicable" : "not-requested",
    brushEffectRejectionReason: null,
  };
}

function rejected(
  stroke: DrawEl,
  reason: StudioSmartShapeBrushEffectUnavailableReason,
): StudioQuickShapeReleaseResult {
  return {
    stroke,
    transition: "none",
    announcementKind: null,
    brushEffectStatus: "rejected",
    brushEffectRejectionReason: reason,
  };
}

/** Pure recognition/promotion boundary shared by live-converted and release-recognized shapes. */
export function planStudioQuickShapeRelease(
  stroke: DrawEl,
  snapshot: StudioQuickShapeReleaseSnapshot,
): StudioQuickShapeReleaseResult {
  const effectRequested = snapshot.brushEffectMode === "selected-brush";
  if (
    snapshot.active
    && stroke.mode !== "eraser"
    && !isStudioPixelPencilRenderMode(stroke.brush)
    && (stroke.kind ?? "freehand") === "freehand"
  ) {
    const heldPoints = snapshot.elapsed > 0
      ? trimQuickShapeDwellTail(snapshot.sourcePoints, snapshot.stableSourceLength)
      : snapshot.sourcePoints;
    const promoted = promoteFreehandQuickShapeOnRelease(
      heldPoints.length >= 8 ? heldPoints : stroke.points,
      {
        anchor: snapshot.anchor,
        lockAspect: snapshot.locked || snapshot.elapsed >= QUICKSHAPE_LOCK_HOLD_MS,
      },
    );
    if (!promoted) return noChange(stroke, effectRequested);

    if (effectRequested) {
      const source = snapshot.brushEffectSource ?? stroke;
      const availability = resolveStudioSmartShapeBrushEffectAvailability(source);
      if (availability.status === "unavailable") {
        return rejected(stroke, availability.reason);
      }
      const effect = applyStudioSmartShapeBrushEffect(
        legacyPlainPromotion(stroke, promoted),
        source,
      );
      if (effect.status === "unavailable") return rejected(stroke, effect.reason);
      return {
        stroke: effect.stroke,
        transition: "promoted",
        announcementKind: promoted.kind,
        brushEffectStatus: "applied",
        brushEffectRejectionReason: null,
      };
    }

    return {
      stroke: legacyPlainPromotion(stroke, promoted),
      transition: "promoted",
      announcementKind: promoted.kind,
      brushEffectStatus: "not-requested",
      brushEffectRejectionReason: null,
    };
  }

  if (
    snapshot.active
    && stroke.mode !== "eraser"
    && stroke.kind
    && stroke.kind !== "freehand"
    && snapshot.converted
  ) {
    if (effectRequested) {
      const effect = applyStudioSmartShapeBrushEffect(stroke, snapshot.brushEffectSource);
      if (effect.status === "unavailable") {
        return rejected(snapshot.brushEffectSource ?? stroke, effect.reason);
      }
      return {
        stroke: effect.stroke,
        transition: "already-converted",
        announcementKind: stroke.kind as QuickShapeKind,
        brushEffectStatus: "applied",
        brushEffectRejectionReason: null,
      };
    }
    return {
      stroke,
      transition: "already-converted",
      announcementKind: stroke.kind as QuickShapeKind,
      brushEffectStatus: "not-requested",
      brushEffectRejectionReason: null,
    };
  }

  // A malformed future converted shape cannot start a different provider implicitly.
  if (effectRequested && snapshot.converted) {
    const source = snapshot.brushEffectSource;
    const availability = resolveStudioSmartShapeBrushEffectAvailability(source);
    return rejected(
      source ?? stroke,
      availability.status === "unavailable" ? availability.reason : "invalid-geometry",
    );
  }
  return noChange(stroke, effectRequested);
}
