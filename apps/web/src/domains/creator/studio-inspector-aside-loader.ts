import { createStudioIntentLazyLoader } from "./studio-intent-lazy-loader";
import { preloadStudioDrawingPaletteStack } from "./studio-page-lazy-ui";

import { lazyRetry } from "@/shared/lib/lazy-retry";

const studioInspectorAsideLoader = createStudioIntentLazyLoader(() =>
  import("./StudioInspectorAside")
);

/**
 * The inspector is a large professional surface and is not required to paint the canvas itself.
 * Keeping it behind a retryable boundary lets mobile open the drawing surface first and splits its
 * parse/compile work from the latency-sensitive ink engine on desktop.
 */
export const LazyStudioInspectorAside = lazyRetry(
  () => studioInspectorAsideLoader.load().then((module) => ({
    default: module.StudioInspectorAside,
  })),
  "StudioInspectorAside"
);

/** Best-effort warm-up for a collapsed desktop rail or an unopened mobile properties sheet. */
export function preloadStudioInspectorAside(): void {
  studioInspectorAsideLoader.preload();
}

/**
 * Starts both mobile properties dependencies in the same interaction frame. The inspector can
 * render without the drawing palettes, but warming both avoids a second chunk waterfall when the
 * properties route reveals its workspace palette stack.
 */
export function preloadStudioInspectorDrawingSurface(): void {
  studioInspectorAsideLoader.preload();
  preloadStudioDrawingPaletteStack();
}
