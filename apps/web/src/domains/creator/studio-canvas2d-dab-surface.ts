import type { StudioGpuDabRenderUpdate } from "./render/studio-webgpu-dab-plan-contract";
import type { StudioGpuViewport } from "./render/studio-webgpu-viewport-contract";

export type StudioCanvas2dDabViewport = Required<Pick<
  StudioGpuViewport,
  | "logicalWidth"
  | "logicalHeight"
  | "scaleX"
  | "scaleY"
  | "offsetX"
  | "offsetY"
  | "flipX"
>>;

export interface StudioCanvas2dDabSurfaceRenderInput {
  readonly context: CanvasRenderingContext2D;
  readonly surfaceWidth: number;
  readonly surfaceHeight: number;
  readonly viewport: StudioCanvas2dDabViewport;
  readonly update: StudioGpuDabRenderUpdate;
}

/** Clears in physical-pixel coordinates regardless of the caller's current document transform. */
export function clearStudioCanvas2dDabSurface(
  context: CanvasRenderingContext2D | null,
  surfaceWidth: number,
  surfaceHeight: number
): void {
  if (!context) return;
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, surfaceWidth, surfaceHeight);
  context.restore();
}

/** Paints one already-planned round-dab update without owning engine state or frame authority. */
export function renderStudioCanvas2dDabSurface(
  input: StudioCanvas2dDabSurfaceRenderInput
): void {
  const { context, surfaceWidth, surfaceHeight, update, viewport } = input;
  if (update.mode === "rebuild") {
    clearStudioCanvas2dDabSurface(context, surfaceWidth, surfaceHeight);
  }

  const pixelScaleX = surfaceWidth / viewport.logicalWidth;
  const pixelScaleY = surfaceHeight / viewport.logicalHeight;
  const transformA = pixelScaleX * viewport.scaleX * (viewport.flipX ? -1 : 1);
  const transformD = pixelScaleY * viewport.scaleY;
  const transformE = pixelScaleX * (
    viewport.offsetX + (viewport.flipX ? viewport.logicalWidth * viewport.scaleX : 0)
  );
  const transformF = pixelScaleY * viewport.offsetY;

  context.save();
  context.setTransform(transformA, 0, 0, transformD, transformE, transformF);
  for (const dab of update.dabs) {
    context.globalCompositeOperation = dab.composite === "erase"
      ? "destination-out"
      : "source-over";
    context.fillStyle = `rgba(${Math.round(dab.red * 255)}, ${Math.round(dab.green * 255)}, ${Math.round(dab.blue * 255)}, ${dab.alpha})`;
    context.beginPath();
    context.arc(dab.x, dab.y, dab.radius, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}
