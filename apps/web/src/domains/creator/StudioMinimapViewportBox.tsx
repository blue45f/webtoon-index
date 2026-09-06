/**
 * Minimap scroll-window box.
 *
 * Extracted from the inspector so a pan frame re-renders this one element
 * instead of the whole aside: it reads the canvas scroll offset from the live
 * scroll-viewport store rather than from a `StudioPage` state value, which is
 * what keeps a hand-tool drag off the React hot path.
 */

import { CANVAS_W } from "./studio-assets";
import { projectStudioViewRectToDocumentRect, type StudioViewRotation } from "./studio-view-controls";
import { useStudioScrollViewport } from "./use-studio-scroll-viewport";

import type { StudioScrollViewportStore } from "./studio-scroll-viewport-store";

export interface StudioMinimapViewportBoxProps {
  readonly store: StudioScrollViewportStore;
  readonly canvasHeight: number;
  readonly effScale: number;
  readonly canvasFlipH: boolean;
  readonly canvasRotation: StudioViewRotation;
}

export function StudioMinimapViewportBox({
  store,
  canvasHeight,
  effScale,
  canvasFlipH,
  canvasRotation,
}: StudioMinimapViewportBoxProps) {
  const viewport = useStudioScrollViewport(store);
  if (!(viewport.scrollWidth > 0) || !(effScale > 0) || !(canvasHeight > 0)) return null;
  const rect = projectStudioViewRectToDocumentRect({
    documentWidth: CANVAS_W,
    documentHeight: canvasHeight,
    canvasFlipH,
    canvasRotation,
    x: viewport.left / effScale,
    y: viewport.top / effScale,
    width: viewport.width / effScale,
    height: viewport.height / effScale,
  });
  return (
    <div
      className="pointer-events-none absolute rounded-[2px] border border-accent shadow-[0_0_0_240px_oklch(0.1_0.01_70/0.35)]"
      style={{
        left: `${(rect.x / CANVAS_W) * 100}%`,
        top: `${(rect.y / canvasHeight) * 100}%`,
        width: `${(rect.width / CANVAS_W) * 100}%`,
        height: `${(rect.height / canvasHeight) * 100}%`,
      }}
    />
  );
}
