import type { StudioHokusaiLiveFrame } from "./studio-hokusai-live-brush-runtime";

export interface StudioHokusaiLiveOverlayProjection {
  /** Document coordinate shown at the viewport's top-left corner. */
  readonly documentX: number;
  readonly documentY: number;
  /** CSS-pixel scale from one logical document pixel. */
  readonly scaleX: number;
  readonly scaleY: number;
  /** Backing pixels per CSS pixel. */
  readonly devicePixelRatio: number;
}

export interface StudioHokusaiLiveProjectedRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type StudioHokusaiLiveOverlayPresentResult =
  | Readonly<{
      status: "presented";
      sequence: number;
      transferredBytes: number;
      projectedRect: StudioHokusaiLiveProjectedRect;
    }>
  | Readonly<{
      status: "rejected";
      reason: "invalid-frame" | "invalid-projection" | "surface-unavailable";
    }>;

type ScratchCanvas = HTMLCanvasElement | OffscreenCanvas;
type ScratchContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface StudioHokusaiLiveOverlayRendererOptions {
  readonly createScratchCanvas?: (width: number, height: number) => ScratchCanvas;
  readonly createImageData?: (
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
  ) => ImageData;
}

function defaultScratchCanvas(width: number, height: number): ScratchCanvas {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error("No canvas factory is available for the Hokusai live overlay.");
}

function defaultImageData(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): ImageData {
  const imagePixels: Uint8ClampedArray<ArrayBuffer> = pixels.buffer instanceof ArrayBuffer
    ? new Uint8ClampedArray(
        pixels.buffer,
        pixels.byteOffset,
        pixels.byteLength,
      )
    : new Uint8ClampedArray(pixels);
  return new ImageData(imagePixels, width, height);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function projectStudioHokusaiLiveFrame(
  frame: Pick<StudioHokusaiLiveFrame, "logicalPlacement">,
  projection: StudioHokusaiLiveOverlayProjection,
): StudioHokusaiLiveProjectedRect | null {
  const placement = frame.logicalPlacement;
  if (
    ![
      placement.x,
      placement.y,
      placement.width,
      placement.height,
      projection.documentX,
      projection.documentY,
      projection.scaleX,
      projection.scaleY,
      projection.devicePixelRatio,
    ].every(finite)
    || placement.width <= 0
    || placement.height <= 0
    || projection.scaleX <= 0
    || projection.scaleY <= 0
    || projection.devicePixelRatio <= 0
  ) return null;
  const deviceScaleX = projection.scaleX * projection.devicePixelRatio;
  const deviceScaleY = projection.scaleY * projection.devicePixelRatio;
  return Object.freeze({
    x: (placement.x - projection.documentX) * deviceScaleX,
    y: (placement.y - projection.documentY) * deviceScaleY,
    width: placement.width * deviceScaleX,
    height: placement.height * deviceScaleY,
  });
}

/**
 * Dedicated raw-pixel host for Hokusai live frames. The only staging surface is
 * dirty-crop sized; no document-sized canvas or main-thread full-frame copy is created.
 */
export class StudioHokusaiLiveOverlayRenderer {
  readonly #context: CanvasRenderingContext2D | null;
  readonly #createScratchCanvas: (width: number, height: number) => ScratchCanvas;
  readonly #createImageData: StudioHokusaiLiveOverlayRendererOptions["createImageData"];
  #scratch: ScratchCanvas | null = null;
  #scratchContext: ScratchContext | null = null;
  #composedRect: StudioHokusaiLiveProjectedRect | null = null;
  #disposed = false;

  constructor(
    canvas: HTMLCanvasElement,
    options: StudioHokusaiLiveOverlayRendererOptions = {},
  ) {
    this.#context = canvas.getContext("2d", {
      alpha: true,
      desynchronized: true,
    });
    this.#createScratchCanvas = options.createScratchCanvas ?? defaultScratchCanvas;
    this.#createImageData = options.createImageData ?? defaultImageData;
  }

  get available(): boolean {
    return !this.#disposed && this.#context !== null;
  }

  present(
    frame: StudioHokusaiLiveFrame,
    projection: StudioHokusaiLiveOverlayProjection,
  ): StudioHokusaiLiveOverlayPresentResult {
    if (!this.available || !this.#context) {
      return { status: "rejected", reason: "surface-unavailable" };
    }
    const [dirtyX, dirtyY, dirtyWidth, dirtyHeight] = frame.dirtyBounds;
    if (
      !Number.isSafeInteger(dirtyX)
      || !Number.isSafeInteger(dirtyY)
      || !Number.isSafeInteger(dirtyWidth)
      || !Number.isSafeInteger(dirtyHeight)
      || dirtyX < 0
      || dirtyY < 0
      || dirtyWidth <= 0
      || dirtyHeight <= 0
      || frame.pixels.byteLength !== dirtyWidth * dirtyHeight * 4
      || frame.logicalPlacement.width !== dirtyWidth
      || frame.logicalPlacement.height !== dirtyHeight
    ) return { status: "rejected", reason: "invalid-frame" };
    const projectedRect = projectStudioHokusaiLiveFrame(frame, projection);
    if (!projectedRect) return { status: "rejected", reason: "invalid-projection" };

    let scratch = this.#scratch;
    if (!scratch || scratch.width !== dirtyWidth || scratch.height !== dirtyHeight) {
      try {
        scratch = this.#createScratchCanvas(dirtyWidth, dirtyHeight);
      } catch {
        return { status: "rejected", reason: "surface-unavailable" };
      }
      scratch.width = dirtyWidth;
      scratch.height = dirtyHeight;
      this.#scratch = scratch;
      this.#scratchContext = scratch.getContext("2d", {
        alpha: true,
        desynchronized: true,
      }) as ScratchContext | null;
    }
    if (!this.#scratchContext) {
      return { status: "rejected", reason: "surface-unavailable" };
    }

    const packedView = new Uint8ClampedArray(
      frame.pixels.buffer as ArrayBuffer,
      frame.pixels.byteOffset,
      frame.pixels.byteLength,
    );
    const imageData = this.#createImageData!(packedView, dirtyWidth, dirtyHeight);
    this.#scratchContext.putImageData(imageData, 0, 0);
    this.#context.save();
    this.#context.setTransform(1, 0, 0, 1, 0, 0);
    // Packed dirty frames are absolute replacement pixels, not alpha-over deltas. Clear only the
    // changed patch before drawing it; previously acknowledged patches remain composed.
    this.#context.clearRect(
      projectedRect.x,
      projectedRect.y,
      projectedRect.width,
      projectedRect.height,
    );
    this.#context.globalCompositeOperation = "source-over";
    this.#context.globalAlpha = 1;
    this.#context.imageSmoothingEnabled = true;
    this.#context.drawImage(
      scratch as CanvasImageSource,
      projectedRect.x,
      projectedRect.y,
      projectedRect.width,
      projectedRect.height,
    );
    this.#context.restore();
    this.#composedRect = this.#composedRect
      ? Object.freeze({
          x: Math.min(this.#composedRect.x, projectedRect.x),
          y: Math.min(this.#composedRect.y, projectedRect.y),
          width: Math.max(
            this.#composedRect.x + this.#composedRect.width,
            projectedRect.x + projectedRect.width,
          ) - Math.min(this.#composedRect.x, projectedRect.x),
          height: Math.max(
            this.#composedRect.y + this.#composedRect.height,
            projectedRect.y + projectedRect.height,
          ) - Math.min(this.#composedRect.y, projectedRect.y),
        })
      : projectedRect;
    return Object.freeze({
      status: "presented",
      sequence: frame.sequence,
      transferredBytes: frame.pixels.byteLength,
      projectedRect,
    });
  }

  clear(): void {
    if (!this.#context || !this.#composedRect) return;
    const { x, y, width, height } = this.#composedRect;
    const left = Math.floor(x) - 1;
    const top = Math.floor(y) - 1;
    const right = Math.ceil(x + width) + 1;
    const bottom = Math.ceil(y + height) + 1;
    this.#context.save();
    this.#context.setTransform(1, 0, 0, 1, 0, 0);
    this.#context.clearRect(left, top, right - left, bottom - top);
    this.#context.restore();
    this.#composedRect = null;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.clear();
    this.#scratch = null;
    this.#scratchContext = null;
    this.#disposed = true;
  }
}
