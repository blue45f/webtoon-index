import { createStudioIntentLazyLoader } from "../studio-intent-lazy-loader";

/**
 * The one lazy boundary for the episode production director. The gateway mounts it through
 * `load`; launchers warm the chunk through `preload` on hover/focus/pointer intent.
 */
export const studioAiEpisodeProductionModalLoader = createStudioIntentLazyLoader(() =>
  import("./StudioAiEpisodeProductionModal").then((module) => ({
    default: module.StudioAiEpisodeProductionModal,
  }))
);

export const preloadStudioAiEpisodeProductionModal = studioAiEpisodeProductionModalLoader.preload;
