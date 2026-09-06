import { createStudioIntentLazyLoader } from "./studio-intent-lazy-loader";

import { lazyRetry } from "@/shared/lib/lazy-retry";

function warmStudioToolPopoverChunk(importer: () => Promise<unknown>): void {
  void importer().catch(() => undefined);
}

const studioAssetToolPopoverBodyLoader = createStudioIntentLazyLoader(() =>
  import("./StudioAssetToolPopoverBody")
);
const studioSceneToolPopoverBodyLoader = createStudioIntentLazyLoader(() => {
  // bgFill is the initial scene tab. Start its leaves alongside the body so the
  // second Suspense boundary does not create a body -> panel network waterfall.
  warmStudioToolPopoverChunk(() => import("./StudioBackgroundPanel"));
  warmStudioToolPopoverChunk(() => import("./canvas/StudioCanvasResizer"));
  return import("./StudioSceneToolPopoverBody");
});
const studioStyleToolPopoverBodyLoader = createStudioIntentLazyLoader(() => {
  // Palette is the initial style tab, including programmatic menu activations
  // which do not pass through the toolbar button's pointer/focus warm-up.
  warmStudioToolPopoverChunk(() => import("./StudioPaletteLibraryPanel"));
  return import("./StudioStyleToolPopoverBody");
});
const studioAiToolPopoverBodyLoader = createStudioIntentLazyLoader(() => {
  // The AI hub opens on the background tool by default. Warm both leaves in
  // parallel with the body while retaining their independent lazy chunks.
  warmStudioToolPopoverChunk(() => import("./ai/StudioAiAssistHub"));
  warmStudioToolPopoverChunk(() => import("./ai/StudioAiBackgroundPanel"));
  return import("./ai/StudioAiToolPopoverBody");
});
const studioBubbleToolPopoverBodyLoader = createStudioIntentLazyLoader(() =>
  import("./lettering/StudioBubbleToolPopoverBody")
);

export const LazyStudioAssetToolPopoverBody = lazyRetry(
  () => studioAssetToolPopoverBodyLoader.load().then((mod) => ({
    default: mod.StudioAssetToolPopoverBody,
  })),
  "StudioAssetToolPopoverBody"
);
export const LazyStudioSceneToolPopoverBody = lazyRetry(
  () => studioSceneToolPopoverBodyLoader.load().then((mod) => ({
    default: mod.StudioSceneToolPopoverBody,
  })),
  "StudioSceneToolPopoverBody"
);
export const LazyStudioStyleToolPopoverBody = lazyRetry(
  () => studioStyleToolPopoverBodyLoader.load().then((mod) => ({
    default: mod.StudioStyleToolPopoverBody,
  })),
  "StudioStyleToolPopoverBody"
);
export const LazyStudioAiToolPopoverBody = lazyRetry(
  () => studioAiToolPopoverBodyLoader.load().then((mod) => ({
    default: mod.StudioAiToolPopoverBody,
  })),
  "StudioAiToolPopoverBody"
);
export const LazyStudioBubbleToolPopoverBody = lazyRetry(
  () => studioBubbleToolPopoverBodyLoader.load().then((mod) => ({
    default: mod.StudioBubbleToolPopoverBody,
  })),
  "StudioBubbleToolPopoverBody"
);

export function preloadStudioAssetToolPopoverBody(): void {
  studioAssetToolPopoverBodyLoader.preload();
}

export function preloadStudioSceneToolPopoverBody(): void {
  studioSceneToolPopoverBodyLoader.preload();
}

export function preloadStudioStyleToolPopoverBody(): void {
  studioStyleToolPopoverBodyLoader.preload();
}

export function preloadStudioAiToolPopoverBody(): void {
  studioAiToolPopoverBodyLoader.preload();
}

export function preloadStudioBubbleToolPopoverBody(): void {
  studioBubbleToolPopoverBodyLoader.preload();
}
