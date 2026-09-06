import type { StudioGpuStroke } from "./studio-webgpu-stroke";

/**
 * A non-null pinned feed owns stroke presentation until the imperative pin is released. An empty
 * pinned list is still authoritative: it is a deliberate clear, not the same state as `null`.
 */
export function resolveStudioWebGpuCanvasStrokes(
  declarativeStrokes: readonly StudioGpuStroke[],
  pinnedStrokes: readonly StudioGpuStroke[] | null
): readonly StudioGpuStroke[] {
  return pinnedStrokes ?? declarativeStrokes;
}
