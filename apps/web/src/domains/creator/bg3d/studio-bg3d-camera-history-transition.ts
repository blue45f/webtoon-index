import type { BgViewportApi } from "./studio-bg3d-camera-application";
import type { StudioBg3dCameraSettings } from "./studio-bg3d-scene-document";

export interface StudioBg3dPendingCameraTarget {
  current: StudioBg3dCameraSettings | null;
}

/**
 * A controlled range already owns the canonical value that produced its preview. On pointer/key
 * release R3F may still expose the previous frame, so the latest gesture value must win without
 * even consulting stale renderer state. Live readback remains the fallback for legacy callers.
 */
export function resolveStudioBg3dCameraGestureCommitView(
  latestGestureView: StudioBg3dCameraSettings | null,
  viewport: Pick<BgViewportApi, "readView"> | null,
  fallbackView: StudioBg3dCameraSettings,
): StudioBg3dCameraSettings {
  return latestGestureView ?? viewport?.readView() ?? fallbackView;
}

/**
 * Applies a history camera synchronously when the mounted projection matches. A perspective ↔
 * orthographic state change replaces the R3F camera, so the old controller must fail closed and
 * hand the complete immutable composition to the replacement controller instead.
 */
export function applyOrDeferStudioBg3dHistoryCamera(
  viewport: BgViewportApi | null,
  pendingTarget: StudioBg3dPendingCameraTarget,
  camera: StudioBg3dCameraSettings,
): "applied" | "deferred" {
  if (viewport?.applyView(camera) === true) {
    pendingTarget.current = null;
    return "applied";
  }
  pendingTarget.current = camera;
  return "deferred";
}
