import type { DrawMode } from "../studio-editor-tool-model";

export interface StudioBrushModeWidthState {
  readonly drawMode: DrawMode;
  readonly strokeWidth: number;
  readonly lastNonPixelStrokeWidth: number;
}

export function planStudioStrokeWidthChange(
  state: StudioBrushModeWidthState,
  requestedWidth: number,
): StudioBrushModeWidthState {
  if (state.drawMode === "pixel") {
    return {
      ...state,
      strokeWidth: 1,
    };
  }
  return {
    ...state,
    strokeWidth: requestedWidth,
    lastNonPixelStrokeWidth: requestedWidth,
  };
}

export function planStudioDrawModeChange(
  state: StudioBrushModeWidthState,
  nextMode: DrawMode,
): StudioBrushModeWidthState {
  if (nextMode === state.drawMode) {
    return state.drawMode === "pixel" && state.strokeWidth !== 1
      ? { ...state, strokeWidth: 1 }
      : state;
  }
  if (nextMode === "pixel") {
    return {
      drawMode: nextMode,
      strokeWidth: 1,
      lastNonPixelStrokeWidth:
        state.drawMode === "pixel"
          ? state.lastNonPixelStrokeWidth
          : state.strokeWidth,
    };
  }
  return {
    drawMode: nextMode,
    strokeWidth:
      state.drawMode === "pixel"
        ? state.lastNonPixelStrokeWidth
        : state.strokeWidth,
    lastNonPixelStrokeWidth:
      state.drawMode === "pixel"
        ? state.lastNonPixelStrokeWidth
        : state.strokeWidth,
  };
}
