import { lazyRetry } from "@/shared/lib/lazy-retry";

/**
 * The view HUD is opened only after an explicit zoom/rotate-tool action. Keep its keyboard,
 * focus-management, and motion-coach UI outside Studio's initial canvas graph.
 */
export const StudioViewToolsHud = lazyRetry(
  () =>
    import("./StudioViewToolsHud").then((module) => ({
      default: module.StudioViewToolsHud,
    })),
  "StudioViewToolsHud",
);
