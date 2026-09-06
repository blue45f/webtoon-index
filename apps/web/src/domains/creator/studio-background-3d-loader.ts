type StudioBackground3DModule = typeof import("./bg3d/StudioBackground3D");

let studioBackground3DModulePromise: Promise<StudioBackground3DModule> | null = null;

/** Literal, cached Vite boundary for the optional Three.js/WebGL background editor. */
export function loadStudioBackground3DModule(): Promise<StudioBackground3DModule> {
  studioBackground3DModulePromise ??= import("./bg3d/StudioBackground3D").catch((error: unknown) => {
    // A stale deployment chunk must remain retryable on the user's next explicit activation.
    studioBackground3DModulePromise = null;
    throw error;
  });
  return studioBackground3DModulePromise;
}

/** Best-effort intent preload; actual activation still owns error recovery through lazyRetry. */
export function preloadStudioBackground3D(): void {
  void loadStudioBackground3DModule().catch(() => undefined);
}
