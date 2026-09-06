export type StudioVrmFrameLoop = "always" | "demand";

export interface StudioVrmRenderActivity {
  readonly webcamActive: boolean;
  readonly idleAnimation: boolean;
  readonly physicsPreview: boolean;
  readonly turntable: boolean;
  readonly viewportHandIkDragging: boolean;
  readonly jointHandleInteracting: boolean;
  readonly persistentIkReconciling: boolean;
  readonly capturing: boolean;
  readonly sharingPose: boolean;
  readonly thumbnailCapturing: boolean;
}

/**
 * Keeps a static posing scene event-driven. React Three Fiber invalidates demand frames for scene,
 * camera and control changes; only genuinely time-varying work needs an uninterrupted GPU loop.
 */
export function resolveStudioVrmFrameLoop(
  activity: StudioVrmRenderActivity,
): StudioVrmFrameLoop {
  return Object.values(activity).some(Boolean) ? "always" : "demand";
}
