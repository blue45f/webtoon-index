import type { StudioGpuRect } from "./studio-webgpu-tile-plan";

export const STUDIO_GPU_READBACK_BYTES_PER_PIXEL = 4;
export const STUDIO_GPU_READBACK_ROW_ALIGNMENT = 256;
export const STUDIO_GPU_MAX_READBACK_PIXELS = 16_777_216;

export type StudioGpuReadbackArea =
  | { readonly kind: "viewport" }
  | { readonly kind: "document"; readonly rect: StudioGpuRect };

export type StudioGpuReadbackFailureReason =
  | "busy"
  | "device-lost"
  | "disposed"
  | "frame-unavailable"
  | "invalid-area"
  | "outside-viewport"
  | "oversize"
  | "readback-failed"
  | "stale-frame"
  | "tainted"
  | "unsupported-format"
  | "zero-size";

export interface StudioGpuReadbackPixelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioGpuReadbackLayout extends StudioGpuReadbackPixelRect {
  /** WebGPU COPY_BYTES_PER_ROW_ALIGNMENT-compatible stride. */
  readonly bytesPerRow: number;
  readonly byteLength: number;
  readonly pixelCount: number;
}

export type StudioGpuReadbackLayoutResult =
  | { readonly status: "planned"; readonly layout: StudioGpuReadbackLayout }
  | { readonly status: "rejected"; readonly reason: StudioGpuReadbackFailureReason };

export interface StudioGpuReadbackViewport {
  readonly logicalWidth: number;
  readonly logicalHeight: number;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly flipX: boolean;
}

function rejected(reason: StudioGpuReadbackFailureReason): StudioGpuReadbackLayoutResult {
  return { status: "rejected", reason };
}

function safeAlignedBytes(value: number, alignment: number): number | null {
  if (!Number.isSafeInteger(value) || value <= 0 || !Number.isSafeInteger(alignment) || alignment <= 0) {
    return null;
  }
  const remainder = value % alignment;
  const aligned = remainder === 0 ? value : value + alignment - remainder;
  return Number.isSafeInteger(aligned) ? aligned : null;
}

function layoutForPixelRect(
  rect: StudioGpuReadbackPixelRect,
  maximumPixels: number
): StudioGpuReadbackLayoutResult {
  if (
    !Number.isSafeInteger(rect.x)
    || !Number.isSafeInteger(rect.y)
    || !Number.isSafeInteger(rect.width)
    || !Number.isSafeInteger(rect.height)
    || rect.x < 0
    || rect.y < 0
    || rect.width <= 0
    || rect.height <= 0
  ) {
    return rejected(rect.width === 0 || rect.height === 0 ? "zero-size" : "invalid-area");
  }
  const pixelCount = rect.width * rect.height;
  const effectiveMaximumPixels = Number.isSafeInteger(maximumPixels) && maximumPixels > 0
    ? Math.min(maximumPixels, STUDIO_GPU_MAX_READBACK_PIXELS)
    : 0;
  if (
    !Number.isSafeInteger(pixelCount)
    || effectiveMaximumPixels <= 0
    || pixelCount > effectiveMaximumPixels
  ) {
    return rejected("oversize");
  }
  const unalignedBytesPerRow = rect.width * STUDIO_GPU_READBACK_BYTES_PER_PIXEL;
  const bytesPerRow = safeAlignedBytes(
    unalignedBytesPerRow,
    STUDIO_GPU_READBACK_ROW_ALIGNMENT
  );
  if (bytesPerRow === null) return rejected("oversize");
  const byteLength = bytesPerRow * rect.height;
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0) return rejected("oversize");
  return {
    status: "planned",
    layout: { ...rect, bytesPerRow, byteLength, pixelCount },
  };
}

function finiteRect(rect: StudioGpuRect): boolean {
  return Number.isFinite(rect.x)
    && Number.isFinite(rect.y)
    && Number.isFinite(rect.width)
    && Number.isFinite(rect.height)
    && Number.isFinite(rect.x + rect.width)
    && Number.isFinite(rect.y + rect.height);
}

/**
 * Converts an explicit viewport/document capture request to the exact presentation-texture region.
 * Document rectangles are rejected when any transformed edge falls outside the retained viewport;
 * silently clipping would make a partial capture look authoritative.
 */
export function planStudioGpuReadbackLayout(
  area: StudioGpuReadbackArea,
  viewport: StudioGpuReadbackViewport,
  physicalWidth: number,
  physicalHeight: number,
  maximumPixels = STUDIO_GPU_MAX_READBACK_PIXELS
): StudioGpuReadbackLayoutResult {
  if (
    !Number.isSafeInteger(physicalWidth)
    || !Number.isSafeInteger(physicalHeight)
    || physicalWidth < 0
    || physicalHeight < 0
  ) {
    return rejected("invalid-area");
  }
  if (physicalWidth === 0 || physicalHeight === 0) return rejected("zero-size");
  if (!area || typeof area !== "object") return rejected("invalid-area");
  if (area.kind === "viewport") {
    return layoutForPixelRect(
      { x: 0, y: 0, width: physicalWidth, height: physicalHeight },
      maximumPixels
    );
  }
  if (
    area.kind !== "document"
    || !area.rect
    || typeof area.rect !== "object"
    || !viewport
    || typeof viewport !== "object"
    || !finiteRect(area.rect)
  ) {
    return rejected("invalid-area");
  }
  const { rect } = area;
  if (rect.width === 0 || rect.height === 0) return rejected("zero-size");
  if (
    rect.x < 0
    || rect.y < 0
    || rect.width < 0
    || rect.height < 0
    || rect.x + rect.width > viewport.logicalWidth
    || rect.y + rect.height > viewport.logicalHeight
    || !Number.isFinite(viewport.logicalWidth)
    || !Number.isFinite(viewport.logicalHeight)
    || !Number.isFinite(viewport.cssWidth)
    || !Number.isFinite(viewport.cssHeight)
    || !Number.isFinite(viewport.scaleX)
    || !Number.isFinite(viewport.scaleY)
    || !Number.isFinite(viewport.offsetX)
    || !Number.isFinite(viewport.offsetY)
    || viewport.logicalWidth <= 0
    || viewport.logicalHeight <= 0
    || viewport.cssWidth <= 0
    || viewport.cssHeight <= 0
    || viewport.scaleX <= 0
    || viewport.scaleY <= 0
  ) {
    return rejected("invalid-area");
  }

  // Keep both transforms explicit: normalized logical document -> CSS presentation -> physical
  // backing texture. `physical/css` includes DPR and any texture-limit fit clamp.
  const logicalToCssX = viewport.cssWidth / viewport.logicalWidth;
  const logicalToCssY = viewport.cssHeight / viewport.logicalHeight;
  const physicalPerCssX = physicalWidth / viewport.cssWidth;
  const physicalPerCssY = physicalHeight / viewport.cssHeight;
  const projectX = (x: number) => physicalPerCssX * logicalToCssX * (
    viewport.offsetX + viewport.scaleX * (viewport.flipX ? viewport.logicalWidth - x : x)
  );
  const projectY = (y: number) => physicalPerCssY * logicalToCssY * (
    viewport.offsetY + viewport.scaleY * y
  );
  const projectedX1 = projectX(rect.x);
  const projectedX2 = projectX(rect.x + rect.width);
  const projectedY1 = projectY(rect.y);
  const projectedY2 = projectY(rect.y + rect.height);
  if (![projectedX1, projectedX2, projectedY1, projectedY2].every(Number.isFinite)) {
    return rejected("invalid-area");
  }
  const rawLeft = Math.min(projectedX1, projectedX2);
  const rawTop = Math.min(projectedY1, projectedY2);
  const rawRight = Math.max(projectedX1, projectedX2);
  const rawBottom = Math.max(projectedY1, projectedY2);
  const epsilon = 1e-6;
  if (
    rawLeft < -epsilon
    || rawTop < -epsilon
    || rawRight > physicalWidth + epsilon
    || rawBottom > physicalHeight + epsilon
  ) {
    return rejected("outside-viewport");
  }
  const left = Math.max(0, Math.floor(rawLeft));
  const top = Math.max(0, Math.floor(rawTop));
  const right = Math.min(physicalWidth, Math.ceil(rawRight));
  const bottom = Math.min(physicalHeight, Math.ceil(rawBottom));
  return layoutForPixelRect({
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  }, maximumPixels);
}

export function copyStudioGpuReadbackRows(
  source: ArrayBuffer | ArrayBufferView,
  layout: StudioGpuReadbackLayout,
  sourceFormat: "bgra8unorm" | "rgba8unorm",
  premultipliedAlpha: boolean
): Uint8ClampedArray | null {
  const unpaddedBytesPerRow = layout.width * STUDIO_GPU_READBACK_BYTES_PER_PIXEL;
  const expectedByteLength = layout.bytesPerRow * layout.height;
  if (
    !Number.isSafeInteger(layout.width)
    || !Number.isSafeInteger(layout.height)
    || layout.width <= 0
    || layout.height <= 0
    || !Number.isSafeInteger(layout.pixelCount)
    || layout.pixelCount !== layout.width * layout.height
    || layout.pixelCount > STUDIO_GPU_MAX_READBACK_PIXELS
    || !Number.isSafeInteger(layout.bytesPerRow)
    || layout.bytesPerRow < unpaddedBytesPerRow
    || layout.bytesPerRow % STUDIO_GPU_READBACK_ROW_ALIGNMENT !== 0
    || !Number.isSafeInteger(layout.byteLength)
    || layout.byteLength !== expectedByteLength
    || (sourceFormat !== "bgra8unorm" && sourceFormat !== "rgba8unorm")
  ) {
    return null;
  }
  const bytes = ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    : new Uint8Array(source);
  if (bytes.byteLength < layout.byteLength) return null;
  const output = new Uint8ClampedArray(
    layout.width * layout.height * STUDIO_GPU_READBACK_BYTES_PER_PIXEL
  );
  const bgra = sourceFormat === "bgra8unorm";
  for (let row = 0; row < layout.height; row += 1) {
    const sourceRow = row * layout.bytesPerRow;
    const outputRow = row * layout.width * STUDIO_GPU_READBACK_BYTES_PER_PIXEL;
    for (let column = 0; column < layout.width; column += 1) {
      const sourceOffset = sourceRow + column * STUDIO_GPU_READBACK_BYTES_PER_PIXEL;
      const outputOffset = outputRow + column * STUDIO_GPU_READBACK_BYTES_PER_PIXEL;
      const alpha = bytes[sourceOffset + 3]!;
      let red = bytes[sourceOffset + (bgra ? 2 : 0)]!;
      let green = bytes[sourceOffset + 1]!;
      let blue = bytes[sourceOffset + (bgra ? 0 : 2)]!;
      if (premultipliedAlpha) {
        if (alpha === 0) {
          red = 0;
          green = 0;
          blue = 0;
        } else if (alpha < 255) {
          red = Math.min(255, Math.round(red * 255 / alpha));
          green = Math.min(255, Math.round(green * 255 / alpha));
          blue = Math.min(255, Math.round(blue * 255 / alpha));
        }
      }
      output[outputOffset] = red;
      output[outputOffset + 1] = green;
      output[outputOffset + 2] = blue;
      output[outputOffset + 3] = alpha;
    }
  }
  return output;
}
