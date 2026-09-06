import {
  STUDIO_EYEDROPPER_MAX_AVERAGE_RADIUS,
  normalizeStudioEyedropperSettings,
  sampleColorFromImageData,
} from "./studio-eyedropper";

import type {
  StudioEyedropperReferenceMode,
  StudioEyedropperSample,
  StudioEyedropperSettings,
} from "./studio-eyedropper";

/** 11 x 11 pixel neighborhood is large enough for a readable CSP-style loupe. */
export const STUDIO_EYEDROPPER_DEFAULT_LOUPE_RADIUS = 5;
export const STUDIO_EYEDROPPER_MAX_LOUPE_RADIUS = 8;

/**
 * The largest request is governed by the 32 px average radius, not the document size. Keeping this
 * public makes it possible to guard Stage adapters and performance tests against a full-canvas read.
 */
export const STUDIO_EYEDROPPER_MAX_CAPTURE_EDGE =
  STUDIO_EYEDROPPER_MAX_AVERAGE_RADIUS * 2 + 1;
export const STUDIO_EYEDROPPER_MAX_CAPTURE_PIXELS =
  STUDIO_EYEDROPPER_MAX_CAPTURE_EDGE * STUDIO_EYEDROPPER_MAX_CAPTURE_EDGE;

export type StudioEyedropperPoint = Readonly<{ x: number; y: number }>;
export type StudioEyedropperBounds = Readonly<{ width: number; height: number }>;

export interface StudioEyedropperCapturePlan {
  /** Cropped document-space rectangle. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Sample coordinate relative to the cropped rectangle. */
  sampleX: number;
  sampleY: number;
  averageRadius: number;
  loupeRadius: number;
  pixelCount: number;
}

export interface StudioEyedropperImageDataLike {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface StudioEyedropperCapture {
  imageData: StudioEyedropperImageDataLike;
  sampleX: number;
  sampleY: number;
  /** Radius in captured pixel coordinates (normally identical to the document radius). */
  averageRadius: number;
  plan: StudioEyedropperCapturePlan;
}

export interface StudioEyedropperCanvasSource {
  toCanvas(options: {
    x: number;
    y: number;
    width: number;
    height: number;
    pixelRatio: number;
  }): HTMLCanvasElement;
}

function finiteInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Plans one bounded Stage read around the pointer. Even at the maximum average radius this reads
 * only 4,225 pixels instead of allocating the full vertical webtoon canvas.
 */
export function planStudioEyedropperCapture(input: {
  point: StudioEyedropperPoint;
  bounds: StudioEyedropperBounds;
  averageRadius?: number;
  loupeRadius?: number;
}): StudioEyedropperCapturePlan | null {
  const boundsWidth = finiteInteger(input.bounds.width, 0);
  const boundsHeight = finiteInteger(input.bounds.height, 0);
  if (boundsWidth <= 0 || boundsHeight <= 0) return null;
  if (!Number.isFinite(input.point.x) || !Number.isFinite(input.point.y)) return null;

  const pointX = Math.floor(input.point.x);
  const pointY = Math.floor(input.point.y);
  if (pointX < 0 || pointY < 0 || pointX >= boundsWidth || pointY >= boundsHeight) return null;

  const averageRadius = clamp(
    finiteInteger(input.averageRadius, 0),
    0,
    STUDIO_EYEDROPPER_MAX_AVERAGE_RADIUS,
  );
  const loupeRadius = clamp(
    finiteInteger(input.loupeRadius, STUDIO_EYEDROPPER_DEFAULT_LOUPE_RADIUS),
    0,
    STUDIO_EYEDROPPER_MAX_LOUPE_RADIUS,
  );
  const extent = Math.max(averageRadius, loupeRadius);
  const left = Math.max(0, pointX - extent);
  const top = Math.max(0, pointY - extent);
  const right = Math.min(boundsWidth - 1, pointX + extent);
  const bottom = Math.min(boundsHeight - 1, pointY + extent);
  const width = right - left + 1;
  const height = bottom - top + 1;
  const pixelCount = width * height;

  // This should be impossible after clamping, but fail closed if future constants diverge.
  if (pixelCount <= 0 || pixelCount > STUDIO_EYEDROPPER_MAX_CAPTURE_PIXELS) return null;

  return {
    x: left,
    y: top,
    width,
    height,
    sampleX: pointX - left,
    sampleY: pointY - top,
    averageRadius,
    loupeRadius,
    pixelCount,
  };
}

/**
 * Executes a capture plan against a Konva-compatible source. documentScale is the Stage scale after
 * it has temporarily been restored to document view. The inverse pixelRatio keeps output 1:1 with
 * document pixels, so average sampling stays deterministic at every zoom level.
 */
export function captureStudioEyedropperCanvasRegion(
  source: StudioEyedropperCanvasSource,
  plan: StudioEyedropperCapturePlan,
  documentScale = 1,
): StudioEyedropperCapture | null {
  if (!Number.isFinite(documentScale) || documentScale <= 0) return null;
  if (plan.pixelCount <= 0 || plan.pixelCount > STUDIO_EYEDROPPER_MAX_CAPTURE_PIXELS) return null;

  try {
    const canvas = source.toCanvas({
      x: plan.x * documentScale,
      y: plan.y * documentScale,
      width: plan.width * documentScale,
      height: plan.height * documentScale,
      pixelRatio: 1 / documentScale,
    });
    if (canvas.width <= 0 || canvas.height <= 0) return null;
    // Do not accept an adapter that silently ignored the crop and returned a large frame.
    if (canvas.width * canvas.height > STUDIO_EYEDROPPER_MAX_CAPTURE_PIXELS) return null;

    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const scaleX = canvas.width / plan.width;
    const scaleY = canvas.height / plan.height;
    const sampleX = clamp(
      Math.floor((plan.sampleX + 0.5) * scaleX),
      0,
      canvas.width - 1,
    );
    const sampleY = clamp(
      Math.floor((plan.sampleY + 0.5) * scaleY),
      0,
      canvas.height - 1,
    );
    const capturedRadius = clamp(
      Math.round(plan.averageRadius * Math.min(scaleX, scaleY)),
      0,
      STUDIO_EYEDROPPER_MAX_AVERAGE_RADIUS,
    );

    return {
      imageData,
      sampleX,
      sampleY,
      averageRadius: capturedRadius,
      plan,
    };
  } catch {
    // Tainted cross-origin canvases and unsupported adapters must not break the pointer session.
    return null;
  }
}

export function sampleStudioEyedropperCapture(
  capture: StudioEyedropperCapture,
): StudioEyedropperSample | null {
  return sampleColorFromImageData(
    capture.imageData.data,
    capture.imageData.width,
    capture.imageData.height,
    capture.sampleX,
    capture.sampleY,
    { averageRadius: capture.averageRadius },
  );
}

export function studioEyedropperCaptureHasOpaqueCenter(
  capture: StudioEyedropperCapture,
): boolean {
  const { data, width, height } = capture.imageData;
  const x = Math.floor(capture.sampleX);
  const y = Math.floor(capture.sampleY);
  if (x < 0 || y < 0 || x >= width || y >= height || data.length < width * height * 4) {
    return false;
  }
  return (data[(y * width + x) * 4 + 3] ?? 0) > 0;
}

export interface StudioEyedropperLayerCandidate {
  id: string;
  /** Layers are passed bottom-to-top. */
  visible: boolean;
  locked: boolean;
  textual: boolean;
  background: boolean;
  draft: boolean;
  reference: boolean;
  /** Whether this layer owns a visible pixel/object under the current pointer. */
  hit: boolean;
}

export type StudioEyedropperReferencePlan =
  | { kind: "merged"; reference: "merged" }
  | { kind: "layer"; reference: "active-layer"; layerId: string }
  | { kind: "layer-stack"; reference: "top-layer"; layerIds: readonly string[] }
  | {
      kind: "unavailable";
      reference: Exclude<StudioEyedropperReferenceMode, "merged">;
      reason:
        | "no-active-layer"
        | "active-layer-hidden"
        | "active-layer-excluded"
        | "no-layer-at-point";
    };

function layerIsExcluded(
  layer: StudioEyedropperLayerCandidate,
  settings: StudioEyedropperSettings,
): boolean {
  return (
    (settings.excludeLocked && layer.locked)
    || (settings.excludeText && layer.textual)
    || (settings.excludeBackground && layer.background)
    || (settings.excludeDraft && layer.draft)
    || (settings.excludeReference && layer.reference)
  );
}

/**
 * Resolves the sampling source without touching React or Konva. Exclusion rules are intentionally
 * meaningful only for layer references; merged display color remains the exact authored composite.
 */
export function planStudioEyedropperReference(input: {
  settings: Partial<StudioEyedropperSettings> | StudioEyedropperSettings;
  layers: readonly StudioEyedropperLayerCandidate[];
  activeLayerId: string | null;
}): StudioEyedropperReferencePlan {
  const settings = normalizeStudioEyedropperSettings(input.settings);
  if (settings.reference === "merged") return { kind: "merged", reference: "merged" };

  if (settings.reference === "active-layer") {
    if (!input.activeLayerId) {
      return { kind: "unavailable", reference: "active-layer", reason: "no-active-layer" };
    }
    const active = input.layers.find((layer) => layer.id === input.activeLayerId);
    if (!active) {
      return { kind: "unavailable", reference: "active-layer", reason: "no-active-layer" };
    }
    if (!active.visible) {
      return { kind: "unavailable", reference: "active-layer", reason: "active-layer-hidden" };
    }
    if (layerIsExcluded(active, settings)) {
      return { kind: "unavailable", reference: "active-layer", reason: "active-layer-excluded" };
    }
    return { kind: "layer", reference: "active-layer", layerId: active.id };
  }

  const layerIds: string[] = [];
  for (let index = input.layers.length - 1; index >= 0; index -= 1) {
    const layer = input.layers[index];
    if (!layer || !layer.visible || !layer.hit || layerIsExcluded(layer, settings)) continue;
    layerIds.push(layer.id);
  }
  if (layerIds.length > 0) return { kind: "layer-stack", reference: "top-layer", layerIds };
  return { kind: "unavailable", reference: "top-layer", reason: "no-layer-at-point" };
}

export interface StudioEyedropperLayerSample {
  layerId: string;
  capture: StudioEyedropperCapture;
  sample: StudioEyedropperSample;
}

/**
 * Samples z-ordered top-layer candidates until one contains a non-transparent pixel. Bounding-box
 * and Konva hit results are only candidate filters; an empty alpha pixel deliberately falls through.
 */
export function sampleStudioEyedropperTopLayer(
  layerIds: readonly string[],
  captureLayer: (layerId: string) => StudioEyedropperCapture | null,
): StudioEyedropperLayerSample | null {
  for (const layerId of layerIds) {
    const capture = captureLayer(layerId);
    if (!capture || !studioEyedropperCaptureHasOpaqueCenter(capture)) continue;
    const sample = sampleStudioEyedropperCapture(capture);
    if (sample) return { layerId, capture, sample };
  }
  return null;
}

export interface StudioEyedropperVisibilityHandle {
  id: string;
  getVisible: () => boolean;
  setVisible: (visible: boolean) => void;
}

/**
 * Temporarily isolates one authored element group for a current/top-layer capture. Visibility is
 * restored in reverse order even if drawing or pixel reads throw. Pass only element-root groups;
 * page paper/background chrome should remain outside this transaction.
 */
export function withStudioEyedropperIsolatedLayer<T>(
  handles: readonly StudioEyedropperVisibilityHandle[],
  targetLayerId: string,
  read: () => T,
  flush?: () => void,
): T | null {
  if (!handles.some((handle) => handle.id === targetLayerId)) return null;
  const snapshot: Array<{ handle: StudioEyedropperVisibilityHandle; visible: boolean }> = [];
  try {
    for (const handle of handles) {
      const visible = handle.getVisible();
      snapshot.push({ handle, visible });
      handle.setVisible(handle.id === targetLayerId && visible);
    }
    flush?.();
    return read();
  } finally {
    for (let index = snapshot.length - 1; index >= 0; index -= 1) {
      const entry = snapshot[index];
      if (entry) entry.handle.setVisible(entry.visible);
    }
    flush?.();
  }
}
