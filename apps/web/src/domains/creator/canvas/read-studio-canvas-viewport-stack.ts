import { readFileSync } from "node:fs";

/** Production files that used to live in StudioCanvasViewport.tsx. */
export const STUDIO_CANVAS_VIEWPORT_STACK = [
  "StudioCanvasViewport.tsx",
  "StudioCanvasViewportTypes.ts",
  "studio-canvas-viewport-live-surfaces.ts",
  "studio-canvas-viewport-interaction.ts",
  "StudioCanvasViewportDocumentLayer.tsx",
  "StudioCanvasViewportToolLayers.tsx",
  "StudioCanvasViewportStageHost.tsx",
  "StudioCanvasViewportDomOverlays.tsx",
  "StudioCanvasViewportHudOverlays.tsx",
  "StudioCanvasModalsOverlay.tsx",
  "StudioCanvasInteractiveOverlays.tsx",
] as const;

/** Concatenate the split viewport sources for source-scan contracts. */
export function readStudioCanvasViewportStack(fromMetaUrl: string, relativeDir = "./"): string {
  return STUDIO_CANVAS_VIEWPORT_STACK.map((name) =>
    readFileSync(new URL(`${relativeDir}${name}`, fromMetaUrl), "utf8"),
  ).join("\n");
}
