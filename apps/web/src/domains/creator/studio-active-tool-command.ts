/**
 * Resolve the command catalog id for the input owner currently holding the canvas.
 *
 * This is deliberately isolated from `studio-current-tool-help`: StudioPage needs the id on every
 * render, while the full help module pulls in the unified search index and tutorial catalogue. The
 * prose/search view stays behind the Help Center's lazy boundary; this resolver remains a tiny pure
 * dependency of the drawing route.
 */

import type { DrawMode, Tool } from "./studio-editor-tool-model";
import type { SelectionToolKind } from "./studio-selection-tools";

export interface StudioActiveToolSignals {
  readonly tool: Tool;
  readonly drawMode: DrawMode;
  readonly commentPlacementActive?: boolean;
  readonly cropActive?: boolean;
  readonly transformActive?: boolean;
  readonly liquifyArmed?: boolean;
  readonly dodgeBurnArmed?: boolean;
  readonly wetMixArmed?: boolean;
  readonly smudgeArmed?: boolean;
  readonly quickMaskArmed?: boolean;
  readonly eyedropperArmed?: boolean;
  readonly quickShapeActive?: boolean;
  /** Armed pixel-selection surface, when one owns the pointer. */
  readonly pixelSelectionTool?: SelectionToolKind | "wand" | null;
}

const PIXEL_SELECTION_COMMANDS: Readonly<Record<string, string | null>> = Object.freeze({
  rect: "tool.marquee-rect",
  ellipse: "tool.marquee-ellipse",
  lasso: "tool.lasso",
  "poly-lasso": "tool.lasso",
  brush: null,
  wand: null,
});

const DRAW_MODE_COMMANDS: Readonly<Record<DrawMode, string>> = Object.freeze({
  pen: "tool.pen",
  eraser: "tool.eraser",
  shape: "tool.smart-shape",
  pixel: "tool.pixel-pen",
  "lasso-fill": "tool.fill",
});

export function resolveStudioActiveToolCommandId(
  signals: StudioActiveToolSignals,
): string | null {
  if (signals.commentPlacementActive) return "tool.comment";
  if (signals.cropActive) return "tool.crop";
  if (signals.transformActive) return "tool.transform";
  if (signals.liquifyArmed) return "tool.liquify";
  if (signals.dodgeBurnArmed) return "tool.dodge-burn";
  if (signals.wetMixArmed) return "tool.wet-mix";
  if (signals.smudgeArmed) return "tool.smudge";
  if (signals.quickMaskArmed) return "select.quick-mask";
  if (signals.eyedropperArmed) return "tool.eyedropper";
  const pixelSelection = signals.pixelSelectionTool;
  if (pixelSelection) return PIXEL_SELECTION_COMMANDS[pixelSelection] ?? null;
  if (signals.tool === "hand") return "tool.hand";
  if (signals.tool === "select") return "tool.select";
  if (signals.quickShapeActive) return "tool.smart-shape";
  return DRAW_MODE_COMMANDS[signals.drawMode] ?? "tool.pen";
}
