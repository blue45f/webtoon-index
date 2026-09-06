import { lazyRetry } from "@/shared/lib/lazy-retry";

/**
 * The mobile editing dock is only needed below the Studio mobile breakpoint. Keeping its literal
 * import boundary here prevents desktop creators from paying for touch sheets and brush-dock UI,
 * while lazyRetry preserves the project's standard chunk-recovery behavior.
 */
export const StudioMobileEditingDock = lazyRetry(
  () =>
    import("./StudioMobileEditingDock").then((mod) => ({
      default: mod.StudioMobileEditingDock,
    })),
  "StudioMobileEditingDock",
);
