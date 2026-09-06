import { createStudioIntentLazyLoader } from "../studio-intent-lazy-loader";

/**
 * The one lazy boundary for the AI webtoon super suite. The gateway mounts it through
 * `load`; launchers warm the chunk through `preload` on hover/focus/pointer intent.
 */
export const studioAiSuperSuiteModalLoader = createStudioIntentLazyLoader(() =>
  import("./StudioAiSuperSuiteModal").then((module) => ({
    default: module.StudioAiSuperSuiteModal,
  }))
);

export const preloadStudioAiSuperSuiteModal = studioAiSuperSuiteModalLoader.preload;
