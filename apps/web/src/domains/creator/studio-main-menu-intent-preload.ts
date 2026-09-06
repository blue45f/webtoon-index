/**
 * Warms the runtime a main-menu group is about to need, on hover or focus.
 *
 * Opening a filter boots a brand-new SVG-export Worker and waits for its handshake, then tears it
 * down again when the run ends — measured at roughly a third of a second of dead time on every
 * filter open, forever, because nothing is left warm for the next one. The retouch tools already
 * solved exactly this: StudioLeftToolRail warms the same modules on pointer intent. A filter open
 * needs that same set — the SVG export worker client, the vector-reference rasterizer, and the
 * raster-edit preparation module — so it can share the warmup rather than grow a second one.
 *
 * Intent-only, matching the retouch contract: this loads code and starts empty Worker handshakes.
 * It never reads, serializes, rasterizes, or mutates the document, so hovering a menu title cannot
 * change what the artist sees. Failures are swallowed because a warmup that did not happen only
 * costs the boot the click would have paid anyway.
 */
export function preloadStudioMainMenuGroupRuntime(groupId: string): void {
  if (groupId !== "filter") return;
  void import("./render/studio-raster-retouch-preload")
    .then((module) => module.preloadStudioRasterRetouchRuntime())
    .catch(() => undefined);
}
