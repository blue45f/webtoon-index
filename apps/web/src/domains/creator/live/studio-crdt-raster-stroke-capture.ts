import { planStudioGpuDabs } from "../render/studio-webgpu-dab-planner";

import type { StudioGpuDab } from "../render/studio-webgpu-dab-plan-contract";
import type { StudioGpuStroke } from "../render/studio-webgpu-stroke";

export const STUDIO_RASTER_STROKE_CAPTURE_MAX_PIXELS = 16_777_216;

export interface StudioRasterStrokeCaptureBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioRasterStrokeCapturePlan {
  readonly bounds: StudioRasterStrokeCaptureBounds;
  readonly dabs: readonly StudioGpuDab[];
  readonly intent: "paint" | "erase";
}

export interface StudioRasterStrokeCapture extends StudioRasterStrokeCapturePlan {
  /** Canvas ImageData-compatible, unpremultiplied row-major RGBA bytes. */
  readonly pixels: Uint8ClampedArray;
}

export type StudioRasterStrokeCaptureCanvas = HTMLCanvasElement | OffscreenCanvas;

export type StudioRasterStrokeCaptureCanvasFactory = (
  width: number,
  height: number
) => StudioRasterStrokeCaptureCanvas;

export class StudioRasterStrokeCaptureError extends Error {
  readonly code:
    | "invalid-document"
    | "invalid-stroke"
    | "empty-stroke"
    | "capture-too-large"
    | "canvas-unavailable"
    | "readback-failed";

  constructor(code: StudioRasterStrokeCaptureError["code"], message: string) {
    super(message);
    this.name = "StudioRasterStrokeCaptureError";
    this.code = code;
  }
}

function fail(
  code: StudioRasterStrokeCaptureError["code"],
  message: string
): never {
  throw new StudioRasterStrokeCaptureError(code, message);
}

function positiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function finiteDab(dab: StudioGpuDab): boolean {
  return Number.isFinite(dab.x)
    && Number.isFinite(dab.y)
    && Number.isFinite(dab.radius)
    && dab.radius >= 0
    && Number.isFinite(dab.red)
    && Number.isFinite(dab.green)
    && Number.isFinite(dab.blue)
    && Number.isFinite(dab.alpha);
}

/**
 * Finds the smallest document-aligned integer rectangle containing the exact dab plan used by the
 * retained WebGPU brush runtime. One physical-pixel guard band keeps Canvas2D edge antialiasing
 * inside the uploaded patch without publishing a full-canvas bitmap.
 */
export function planStudioRasterStrokeCapture(input: {
  readonly stroke: StudioGpuStroke;
  readonly documentWidth: number;
  readonly documentHeight: number;
}): StudioRasterStrokeCapturePlan {
  if (!positiveSafeInteger(input.documentWidth) || !positiveSafeInteger(input.documentHeight)) {
    fail("invalid-document", "래스터 획 문서 크기가 올바르지 않습니다.");
  }
  const planned = planStudioGpuDabs([input.stroke]);
  if (!planned.complete || planned.dabs.some((dab) => !finiteDab(dab))) {
    fail("invalid-stroke", "래스터 획이 WebGPU 브러시 안전 한도를 벗어났습니다.");
  }
  // A linear-full pressure-zero dab is a valid semantic sample with exactly zero coverage. It is
  // retained by the shared planner as an interpolation anchor but must not allocate a pixel patch.
  const coverageDabs = planned.dabs.filter((dab) => dab.radius > 0 && dab.alpha > 0);
  if (coverageDabs.length === 0) {
    fail("empty-stroke", "픽셀을 만드는 브러시 샘플이 없습니다.");
  }

  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const dab of coverageDabs) {
    left = Math.min(left, dab.x - dab.radius - 1);
    top = Math.min(top, dab.y - dab.radius - 1);
    right = Math.max(right, dab.x + dab.radius + 1);
    bottom = Math.max(bottom, dab.y + dab.radius + 1);
  }
  const x = Math.max(0, Math.floor(left));
  const y = Math.max(0, Math.floor(top));
  const maxX = Math.min(input.documentWidth, Math.ceil(right));
  const maxY = Math.min(input.documentHeight, Math.ceil(bottom));
  const width = maxX - x;
  const height = maxY - y;
  if (width <= 0 || height <= 0) {
    fail("empty-stroke", "획이 문서 경계와 교차하지 않습니다.");
  }
  if (
    !Number.isSafeInteger(width * height)
    || width * height > STUDIO_RASTER_STROKE_CAPTURE_MAX_PIXELS
  ) {
    fail("capture-too-large", "한 번의 래스터 획 캡처가 16MP 안전 한도를 초과했습니다.");
  }
  return {
    bounds: { x, y, width, height },
    dabs: coverageDabs,
    intent: input.stroke.composite === "erase" ? "erase" : "paint",
  };
}

export function createBrowserStudioRasterStrokeCanvas(
  width: number,
  height: number
): StudioRasterStrokeCaptureCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  if (typeof document === "undefined") {
    fail("canvas-unavailable", "이 브라우저에서는 래스터 획 캔버스를 만들 수 없습니다.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Rasterizes one completed round-dab stroke into an unpremultiplied transparent patch. Erasers are
 * deliberately captured as a white alpha mask; the CRDT operation carries destination-out as the
 * semantic blend mode, so an eraser payload never depends on pixels that happened to be local.
 */
export function captureStudioRasterStroke(
  input: {
    readonly stroke: StudioGpuStroke;
    readonly documentWidth: number;
    readonly documentHeight: number;
  },
  createCanvas: StudioRasterStrokeCaptureCanvasFactory =
    createBrowserStudioRasterStrokeCanvas
): StudioRasterStrokeCapture {
  const plan = planStudioRasterStrokeCapture(input);
  const canvas = createCanvas(plan.bounds.width, plan.bounds.height);
  if (canvas.width !== plan.bounds.width) canvas.width = plan.bounds.width;
  if (canvas.height !== plan.bounds.height) canvas.height = plan.bounds.height;
  const context = canvas.getContext("2d", { willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!context) fail("canvas-unavailable", "래스터 획 2D 컨텍스트를 만들 수 없습니다.");

  context.save();
  context.setTransform(1, 0, 0, 1, -plan.bounds.x, -plan.bounds.y);
  context.globalCompositeOperation = "source-over";
  for (const dab of plan.dabs) {
    const red = plan.intent === "erase" ? 255 : Math.round(dab.red * 255);
    const green = plan.intent === "erase" ? 255 : Math.round(dab.green * 255);
    const blue = plan.intent === "erase" ? 255 : Math.round(dab.blue * 255);
    context.fillStyle = `rgba(${red}, ${green}, ${blue}, ${Math.min(1, Math.max(0, dab.alpha))})`;
    context.beginPath();
    context.arc(dab.x, dab.y, dab.radius, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();

  try {
    const imageData = context.getImageData(
      0,
      0,
      plan.bounds.width,
      plan.bounds.height
    );
    if (imageData.data.byteLength !== plan.bounds.width * plan.bounds.height * 4) {
      fail("readback-failed", "래스터 획 픽셀 길이가 캡처 영역과 일치하지 않습니다.");
    }
    return { ...plan, pixels: Uint8ClampedArray.from(imageData.data) };
  } catch (error) {
    if (error instanceof StudioRasterStrokeCaptureError) throw error;
    fail("readback-failed", "래스터 획 픽셀을 읽지 못했습니다.");
  }
}
