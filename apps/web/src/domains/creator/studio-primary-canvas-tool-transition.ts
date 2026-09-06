import { planStudioCanvasToolTransition } from "./canvas/studio-canvas-tool-state-machine";

import type { DrawMode } from "./studio-editor-tool-model";

export type StudioPrimaryCanvasTool =
  | { tool: "select" }
  | { tool: "draw"; drawMode: DrawMode };

export type StudioCanvasToolState =
  | StudioPrimaryCanvasTool
  | { tool: "hand" };

export function executeStudioPrimaryCanvasToolTransition(
  input: {
    current: StudioCanvasToolState;
    next: StudioPrimaryCanvasTool;
    activeStroke: boolean;
  },
  actions: {
    cancelActiveStroke: () => void;
    disarm: () => void;
    setTool: (tool: StudioPrimaryCanvasTool["tool"]) => void;
    setDrawMode: (mode: DrawMode) => void;
  },
) {
  const toolChanged = input.current.tool !== input.next.tool;
  const drawModeChanged =
    input.next.tool === "draw" &&
    (input.current.tool !== "draw" || input.current.drawMode !== input.next.drawMode);
  const currentDrawMode =
    input.current.tool === "draw"
      ? input.current.drawMode
      : input.next.tool === "draw"
        ? input.next.drawMode
        : "pen";
  const event =
    input.next.tool === "draw"
      ? { type: "primary.draw" as const, drawMode: input.next.drawMode }
      : { type: "primary.select" as const };
  const plan = planStudioCanvasToolTransition(
    {
      tool: input.current.tool,
      drawMode: currentDrawMode,
      auxiliary: null,
      unfinished: input.activeStroke ? ["drawing-stroke"] : [],
    },
    event,
  );
  const changed = toolChanged || drawModeChanged;
  const cancelledActiveStroke = plan.cancelledUnfinished.includes("drawing-stroke");

  if (cancelledActiveStroke) actions.cancelActiveStroke();
  // Repeating the current selection must still release a hidden owner such as fill or eyedropper.
  actions.disarm();
  if (toolChanged) actions.setTool(input.next.tool);
  if (drawModeChanged && input.next.tool === "draw") actions.setDrawMode(input.next.drawMode);

  return {
    changed,
    cancelledActiveStroke,
    next: input.next,
  };
}
