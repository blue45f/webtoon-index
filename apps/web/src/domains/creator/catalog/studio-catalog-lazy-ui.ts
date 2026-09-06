import { lazyRetry } from "@/shared/lib/lazy-retry";

// Keep the optional catalog chunk behind user intent without making a
// ToolBelt body own its loader or importing the editor orchestration layer.
export const StudioSceneTemplateBrowser = lazyRetry(
  () =>
    import("./StudioSceneTemplateBrowser").then((module) => ({
      default: module.StudioSceneTemplateBrowser,
    })),
  "StudioSceneTemplateBrowser"
);
