import type { StudioGpuComposite } from "./studio-webgpu-stroke";

/** Renderer-neutral analytic dab consumed by both full-frame and tiled backends. */
export interface StudioGpuDab {
  x: number;
  y: number;
  radius: number;
  red: number;
  green: number;
  blue: number;
  alpha: number;
  composite: StudioGpuComposite;
}

/** Contiguous draw range whose instances share one GPU/Canvas compositing operation. */
export interface StudioGpuBatch {
  composite: StudioGpuComposite;
  firstInstance: number;
  instanceCount: number;
}

export interface PlannedStudioGpuDabs {
  dabs: StudioGpuDab[];
  batches: StudioGpuBatch[];
  /** False means the safety cap stopped planning before every requested operation was covered. */
  complete: boolean;
}

export interface StudioGpuDabRenderUpdate extends PlannedStudioGpuDabs {
  /** `append` is safe to draw over the retained frame; `rebuild` must clear it first. */
  mode: "append" | "rebuild";
}
