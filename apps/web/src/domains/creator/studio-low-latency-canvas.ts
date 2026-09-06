export const STUDIO_LIVE_SURFACE_MAX_BACKING_PIXELS = 16_777_216;
const STUDIO_LIVE_SURFACE_DPR_STEP = 0.25;

export interface StudioLiveSurfaceResolutionInput {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly devicePixelRatio: number;
  readonly maximumBackingPixels?: number;
}

export type StudioNativeLiveSurfaceResolutionDecision =
  | {
      readonly ok: true;
      readonly mode: "native";
      readonly devicePixelRatio: number;
      readonly backingWidth: number;
      readonly backingHeight: number;
      readonly backingPixels: number;
      readonly maximumBackingPixels: number;
    }
  | {
      readonly ok: false;
      readonly mode: "retained-exact-fallback";
      readonly reason:
        | "invalid-surface"
        | "native-backing-size-overflow"
        | "native-backing-pixel-budget-exceeded";
    };

/**
 * Decides whether a transient surface can be allocated at the device's exact native density.
 *
 * This deliberately has no reduced-resolution success state. A live overlay is authoritative
 * only when its antialiasing coverage can match the committed renderer; otherwise the caller must
 * keep the exact retained renderer visible for the stroke.
 */
export function decideStudioNativeLiveSurfaceResolution(
  input: StudioLiveSurfaceResolutionInput
): StudioNativeLiveSurfaceResolutionDecision {
  const maximumBackingPixels = input.maximumBackingPixels
    ?? STUDIO_LIVE_SURFACE_MAX_BACKING_PIXELS;
  if (
    !Number.isFinite(input.cssWidth)
    || input.cssWidth <= 0
    || !Number.isFinite(input.cssHeight)
    || input.cssHeight <= 0
    || !Number.isFinite(input.devicePixelRatio)
    || input.devicePixelRatio <= 0
    || !Number.isFinite(maximumBackingPixels)
    || maximumBackingPixels <= 0
  ) {
    return {
      ok: false,
      mode: "retained-exact-fallback",
      reason: "invalid-surface",
    };
  }

  const backingWidth = Math.max(1, Math.round(input.cssWidth * input.devicePixelRatio));
  const backingHeight = Math.max(1, Math.round(input.cssHeight * input.devicePixelRatio));
  const backingPixels = backingWidth * backingHeight;
  if (
    !Number.isSafeInteger(backingWidth)
    || !Number.isSafeInteger(backingHeight)
    || !Number.isSafeInteger(backingPixels)
  ) {
    return {
      ok: false,
      mode: "retained-exact-fallback",
      reason: "native-backing-size-overflow",
    };
  }
  if (backingPixels > maximumBackingPixels) {
    return {
      ok: false,
      mode: "retained-exact-fallback",
      reason: "native-backing-pixel-budget-exceeded",
    };
  }
  return {
    ok: true,
    mode: "native",
    devicePixelRatio: input.devicePixelRatio,
    backingWidth,
    backingHeight,
    backingPixels,
    maximumBackingPixels,
  };
}

/**
 * Keeps the interaction surface at native density until a very large/high-DPI viewport would
 * allocate more than 16M pixels. Only the transient live Canvas/WebGPU surface is capped; the
 * document and export resolution remain untouched.
 */
export function resolveStudioLiveSurfaceDevicePixelRatio(
  input: StudioLiveSurfaceResolutionInput
): number {
  const width = Number.isFinite(input.cssWidth) ? Math.max(1, input.cssWidth) : 1;
  const height = Number.isFinite(input.cssHeight) ? Math.max(1, input.cssHeight) : 1;
  const device = Number.isFinite(input.devicePixelRatio)
    ? Math.min(4, Math.max(1, input.devicePixelRatio))
    : 1;
  const maximumBackingPixels = Number.isFinite(input.maximumBackingPixels)
    ? Math.max(1, input.maximumBackingPixels!)
    : STUDIO_LIVE_SURFACE_MAX_BACKING_PIXELS;
  const budgetDpr = Math.sqrt(maximumBackingPixels / (width * height));
  const resolved = Math.max(1, Math.min(device, budgetDpr));
  if (resolved >= device) return device;
  return Math.max(
    1,
    Math.floor(resolved / STUDIO_LIVE_SURFACE_DPR_STEP) * STUDIO_LIVE_SURFACE_DPR_STEP
  );
}

/**
 * Requests the browser's low-latency 2D presentation path where supported. Older WebViews have
 * thrown on unknown context attributes, so the ordinary 2D context remains a guarded fallback.
 */
export function acquireStudioLowLatencyCanvas2dContext(
  canvas: Pick<HTMLCanvasElement, "getContext">
): CanvasRenderingContext2D | null {
  try {
    return canvas.getContext("2d", {
      alpha: true,
      desynchronized: true,
    }) as CanvasRenderingContext2D | null;
  } catch {
    return canvas.getContext("2d") as CanvasRenderingContext2D | null;
  }
}
