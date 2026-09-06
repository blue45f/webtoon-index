import {
  resolveStudioBrushAliasProfile,
} from "../brush/studio-brush-alias-profile";
import { resolveStudioBrushRenderFamily } from "../studio-brush";
import {
  planGlowBrushPasses,
  planNeonBrushPasses,
} from "../studio-fx-brush";

import type { StudioBrushCursorStyle } from "../studio-app-settings";
import type { DrawMode, Tool } from "../studio-editor-tool-model";

export type StudioCanvasCursorClassName =
  | "cursor-crosshair"
  | "cursor-default"
  | "cursor-grab"
  | "cursor-grabbing"
  | "cursor-none"
  | "cursor-not-allowed";

export type StudioBrushCursorMode = Extract<DrawMode, "pen" | "eraser">;
export type StudioBrushCursorShape = "round" | "ellipse" | "square";
export type StudioBrushCursorTexture = "solid" | "soft" | "scatter" | "rough" | "eraser";

export interface StudioBrushCursorVisualPlan {
  /** Exact document-space footprint radius. It intentionally changes size with canvas zoom. */
  radius: number;
  radiusX: number;
  radiusY: number;
  rotationDeg: number;
  shape: StudioBrushCursorShape;
  texture: StudioBrushCursorTexture;
  /** Document-space widths that resolve to stable CSS-pixel outlines after Stage scaling. */
  outerStrokeWidth: number;
  innerStrokeWidth: number;
  dash: readonly number[] | undefined;
  /** Small footprints keep their exact ring and add a screen-stable center sight. */
  centerRadius: number | null;
  centerStrokeWidth: number;
  innerBoundaryScale: number | null;
  showOutline: boolean;
}

export interface StudioCanvasCursorInput {
  tool: Tool;
  drawMode: DrawMode;
  isSpacePressed: boolean;
  isPanning: boolean;
  interactionBlocked: boolean;
  commentPinArmed: boolean;
  eyedropperActive: boolean;
  advancedFillArmed: boolean;
  cropArmed: boolean;
  pixelToolArmed: boolean;
  panelSplitArmed: boolean;
  nodeEditArmed: boolean;
  bubbleShapeArmed: boolean;
  puppetWarpArmed: boolean;
  perspectiveRulerActive: boolean;
  precisionBrushArmed: boolean;
}

export interface StudioCanvasInteractionBlockInput {
  activeSurfaceReviewLocked: boolean;
  commentPinArmed: boolean;
  canCreateStudioComment: boolean;
  saving: boolean;
  documentReloadRequired: boolean;
  sourceHydrationPending: boolean;
  workHydrationFailed: boolean;
  collaborationDocumentUnavailable: boolean;
}

export type StudioCanvasViewportCursorInput = Pick<
  StudioCanvasCursorInput,
  "tool" | "isSpacePressed" | "isPanning" | "interactionBlocked"
>;

export function isStudioBrushCursorMode(mode: DrawMode): mode is StudioBrushCursorMode {
  return mode === "pen" || mode === "eraser";
}

/** Touch has no hover cursor; mouse and pen retain an exact footprint before and during contact. */
export function shouldShowStudioBrushCursor(pointerType: string | null | undefined): boolean {
  return pointerType?.trim().toLowerCase() !== "touch";
}

export function planStudioBrushCursorVisual(input: {
  brushId?: string | null;
  diameter: number;
  effectiveScale: number;
  mode: StudioBrushCursorMode;
  style?: StudioBrushCursorStyle;
  tipAngleDeg?: number;
  tipRoundness?: number;
}): StudioBrushCursorVisualPlan {
  const diameter = Number.isFinite(input.diameter) ? Math.max(0.01, input.diameter) : 1;
  const effectiveScale = Number.isFinite(input.effectiveScale)
    ? Math.max(0.01, Math.abs(input.effectiveScale))
    : 1;
  const screenDiameter = diameter * effectiveScale;
  const style = input.style ?? "outline";
  const brushId = typeof input.brushId === "string" ? input.brushId : "pen";
  const family = resolveStudioBrushRenderFamily(brushId);
  const aliasProfile = resolveStudioBrushAliasProfile(brushId);
  const maxPassScale = (passes: readonly { widthScale: number }[]): number =>
    Math.max(1, ...passes.map((pass) => pass.widthScale));
  let extentScale = 1;
  if (input.mode === "pen") {
    if (brushId === "neon") extentScale = maxPassScale(planNeonBrushPasses(diameter));
    else if (brushId === "glow" || brushId === "soft-glow") {
      extentScale = maxPassScale(planGlowBrushPasses(diameter, brushId === "soft-glow"));
    } else if (brushId === "glitter") extentScale = 1.46;
    else if (brushId === "star-dust") extentScale = 2.3;
    else if (aliasProfile?.watercolor) {
      extentScale = Math.max(
        aliasProfile.watercolor.coreRadiusScale,
        aliasProfile.watercolor.diffuseRadiusScale
      );
    } else if (aliasProfile?.pencilPasses) {
      extentScale = Math.max(1, ...aliasProfile.pencilPasses.map((pass) => pass.widthScale));
    }
  }
  const radius = (diameter * extentScale) / 2;
  const tipRoundness = Number.isFinite(input.tipRoundness)
    ? Math.min(1, Math.max(0.08, input.tipRoundness!))
    : 0.28;
  const tipAngleDeg = Number.isFinite(input.tipAngleDeg) ? input.tipAngleDeg! : -30;
  let shape: StudioBrushCursorShape = "round";
  let radiusY = radius;
  let rotationDeg = 0;
  if (input.mode === "pen" && family === "calligraphy") {
    shape = "ellipse";
    radiusY = radius * tipRoundness;
    rotationDeg = tipAngleDeg;
  } else if (input.mode === "pen" && family === "brush") {
    shape = "ellipse";
    radiusY = radius * 0.2;
    rotationDeg = -30;
  } else if (input.mode === "pen" && family === "oil") {
    shape = "ellipse";
    radiusY = radius * 0.48;
    rotationDeg = -20;
  } else if (input.mode === "pen" && (family === "highlighter" || family === "pixel")) {
    shape = "square";
  }
  let texture: StudioBrushCursorTexture = "solid";
  if (input.mode === "eraser") texture = "eraser";
  else if (
    family === "watercolor"
    || family === "airbrush"
    || family === "glow"
    || family === "neon"
    || family === "pastel"
  ) texture = "soft";
  else if (family === "glitter" || family === "ink-particle" || family === "screentone") {
    texture = "scatter";
  } else if (family === "pencil" || family === "dry-media") texture = "rough";
  const innerBoundaryScale = texture === "soft"
    ? brushId === "soft-glow" || brushId === "neon"
      ? 0.2
      : brushId === "glow"
        ? 0.35
        : brushId === "ink-wash"
          ? 0.5
          : 0.42
    : null;
  const dash = texture === "eraser"
    ? [4 / effectiveScale, 3 / effectiveScale]
    : texture === "scatter"
      ? [2 / effectiveScale, 2 / effectiveScale]
      : texture === "rough"
        ? [5 / effectiveScale, 2 / effectiveScale, 1 / effectiveScale, 2 / effectiveScale]
        : undefined;

  return {
    radius,
    radiusX: radius,
    radiusY,
    rotationDeg,
    shape,
    texture,
    outerStrokeWidth: 3.25 / effectiveScale,
    innerStrokeWidth: 1.25 / effectiveScale,
    dash,
    centerRadius: style === "none"
      ? null
      : style === "dot"
        ? 2 / effectiveScale
        : screenDiameter * extentScale < 8
          ? 1.5 / effectiveScale
          : null,
    centerStrokeWidth: 0.75 / effectiveScale,
    innerBoundaryScale,
    showOutline: style === "outline",
  };
}

/**
 * Keeps read-only document mutation locks intact while admitting exactly one server-authorized
 * comment placement gesture. Hydration, scope, reload, and save barriers remain absolute because
 * they mean the canvas being shown is not a safe coordinate authority for a new point anchor.
 */
export function isStudioCanvasInteractionBlocked(
  input: StudioCanvasInteractionBlockInput
): boolean {
  if (
    input.saving
    || input.documentReloadRequired
    || input.sourceHydrationPending
    || input.workHydrationFailed
    || input.collaborationDocumentUnavailable
  ) {
    return true;
  }
  if (!input.activeSurfaceReviewLocked) return false;
  return !(input.commentPinArmed && input.canCreateStudioComment);
}

/** The scrollable workspace only advertises pan/lock actions that also work outside the paper. */
export function studioCanvasViewportCursorClassName(
  input: StudioCanvasViewportCursorInput
): StudioCanvasCursorClassName {
  if (input.interactionBlocked) return "cursor-not-allowed";
  if (input.isPanning) return "cursor-grabbing";
  if (input.isSpacePressed || input.tool === "hand") return "cursor-grab";
  return "cursor-default";
}

/**
 * Resolves one native cursor for the whole canvas viewport. Pen and eraser keep a crosshair under
 * their richer Konva footprint ring, so a lost/unmounted overlay can never leave the artist with
 * an invisible pointer. Other precision overlays still replace the system cursor completely.
 */
export function studioCanvasCursorClassName(
  input: StudioCanvasCursorInput
): StudioCanvasCursorClassName {
  const viewportCursor = studioCanvasViewportCursorClassName(input);
  if (viewportCursor !== "cursor-default") return viewportCursor;
  if (input.precisionBrushArmed) return "cursor-none";
  if (
    input.commentPinArmed
    || input.eyedropperActive
    || input.advancedFillArmed
    || input.cropArmed
    || input.pixelToolArmed
    || input.panelSplitArmed
    || input.nodeEditArmed
    || input.bubbleShapeArmed
    || input.puppetWarpArmed
    || input.perspectiveRulerActive
  ) {
    return "cursor-crosshair";
  }
  if (input.tool === "draw") {
    return input.drawMode === "shape"
      || input.drawMode === "lasso-fill"
      || input.drawMode === "pixel"
      || isStudioBrushCursorMode(input.drawMode)
      ? "cursor-crosshair"
      : "cursor-none";
  }
  return "cursor-default";
}
