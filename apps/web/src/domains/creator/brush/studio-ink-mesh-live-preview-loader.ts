export type StudioInkMeshLivePreviewModule = typeof import("./studio-ink-mesh-live-preview");
export type StudioInkMeshLivePreviewRuntime =
  import("./studio-ink-mesh-live-preview").StudioInkMeshLivePreviewRuntime;

let studioInkMeshLivePreviewModulePromise: Promise<StudioInkMeshLivePreviewModule> | null = null;

/**
 * Loads the optional Google Ink/WebGPU predicted-tail island after the retained Canvas/Konva
 * surface has already become interactive. Chunk failures remain retryable on a later mount.
 */
export function loadStudioInkMeshLivePreviewModule(): Promise<StudioInkMeshLivePreviewModule> {
  studioInkMeshLivePreviewModulePromise ??= import("./studio-ink-mesh-live-preview").catch(
    (cause: unknown) => {
      studioInkMeshLivePreviewModulePromise = null;
      throw cause;
    }
  );
  return studioInkMeshLivePreviewModulePromise;
}
