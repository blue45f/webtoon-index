export type StudioBg3dFrameLoop = "always" | "demand";

export interface StudioBg3dRenderActivity {
  readonly modelAnimationPlaying: boolean;
  readonly physicsPlaying: boolean;
  /** An event-driven gesture, not an animation clock. Drei invalidates on every control change. */
  readonly transforming: boolean;
  readonly capturing: boolean;
  readonly batchRendering: boolean;
}

/**
 * Static composition, including a held gizmo, is event-driven. A change event requests the next
 * frame; repeatedly rendering an unchanged pose only backs up slow WebGPU queues. Time-varying
 * work still receives continuous frames, even when a transform gesture is active alongside it.
 */
export function resolveStudioBg3dFrameLoop(
  activity: StudioBg3dRenderActivity,
): StudioBg3dFrameLoop {
  return activity.modelAnimationPlaying || activity.physicsPlaying
    || activity.capturing || activity.batchRendering ? "always" : "demand";
}
