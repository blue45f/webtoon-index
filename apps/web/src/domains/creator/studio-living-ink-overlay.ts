import { sha256HexPortable } from "./studio-sha256";

import type { StudioLivingInkExecutionFrame } from "./studio-living-ink-execution-protocol";

export interface StudioLivingInkOverlayProjection {
  readonly documentX: number;
  readonly documentY: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly devicePixelRatio: number;
  readonly documentWidth: number;
  readonly documentHeight: number;
}

export interface StudioLivingInkOverlayPresentationReceipt {
  readonly kind: "studio-living-ink/presentation-receipt";
  readonly routeKey: string;
  readonly revision: number;
  readonly displaySha256: `sha256:${string}`;
  readonly status: "presented";
}

export interface StudioLivingInkCanonicalPresentation {
  readonly src: `data:image/png;base64,${string}`;
  readonly pngSha256: `sha256:${string}`;
  readonly width: number;
  readonly height: number;
  /** Measured from the exact RGBA pixels encoded into `src`, never inferred from a GPU receipt. */
  readonly alphaCoverage: StudioLivingInkAlphaCoverage;
  readonly presentation: StudioLivingInkOverlayPresentationReceipt;
}

export interface StudioLivingInkAlphaCoverage {
  readonly pixelCount: number;
  readonly bounds: Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
  }> | null;
}

interface PendingFrame {
  readonly frame: StudioLivingInkExecutionFrame;
  readonly routeKey: string;
  readonly projection: StudioLivingInkOverlayProjection;
  readonly onPresented: (receipt: StudioLivingInkOverlayPresentationReceipt) => void;
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validProjection(projection: StudioLivingInkOverlayProjection): boolean {
  return finitePositive(projection.scaleX)
    && finitePositive(projection.scaleY)
    && finitePositive(projection.devicePixelRatio)
    && finitePositive(projection.documentWidth)
    && finitePositive(projection.documentHeight)
    && Number.isFinite(projection.documentX)
    && Number.isFinite(projection.documentY);
}

function canvasPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob?.type === "image/png") resolve(blob);
      else reject(new Error("Living Ink canonical PNG를 인코딩하지 못했습니다."));
    }, "image/png");
  });
}

function base64FromBytes(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const chunkSize = 24 * 1_024;
  for (let start = 0; start < bytes.byteLength; start += chunkSize) {
    let binary = "";
    const end = Math.min(bytes.byteLength, start + chunkSize);
    for (let index = start; index < end; index += 1) {
      binary += String.fromCharCode(bytes[index]!);
    }
    chunks.push(globalThis.btoa(binary));
  }
  // Encoding each chunk separately is safe only on a multiple-of-three boundary. chunkSize is.
  return chunks.join("");
}

/** Counts actual encoded ink coverage; a receipt/hash alone can also describe a blank frame. */
export function measureStudioLivingInkAlphaCoverage(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): StudioLivingInkAlphaCoverage {
  if (
    !Number.isInteger(width)
    || !Number.isInteger(height)
    || width <= 0
    || height <= 0
    || rgba.length !== width * height * 4
  ) {
    throw new RangeError("Living Ink RGBA coverage dimensions are invalid.");
  }
  let pixelCount = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let alphaOffset = 3; alphaOffset < rgba.length; alphaOffset += 4) {
    if (rgba[alphaOffset] === 0) continue;
    const pixelIndex = (alphaOffset - 3) / 4;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    pixelCount += 1;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return Object.freeze({
    pixelCount,
    bounds: pixelCount === 0
      ? null
      : Object.freeze({
          x: minX,
          y: minY,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
        }),
  });
}

/**
 * Ensures the encoded physical frame covers the authored document-space gesture before its exact
 * vector source may be hidden. This catches blank, vertically flipped and stale-page GPU frames.
 */
export function studioLivingInkCoverageIntersectsStroke(input: Readonly<{
  coverage: StudioLivingInkAlphaCoverage;
  outputWidth: number;
  outputHeight: number;
  documentWidth: number;
  documentHeight: number;
  points: readonly number[];
  diameter: number;
}>): boolean {
  const bounds = input.coverage.bounds;
  if (
    input.coverage.pixelCount <= 0
    || !bounds
    || !finitePositive(input.outputWidth)
    || !finitePositive(input.outputHeight)
    || !finitePositive(input.documentWidth)
    || !finitePositive(input.documentHeight)
  ) return false;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let index = 0; index + 1 < input.points.length; index += 2) {
    const x = input.points[index];
    const y = input.points[index + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x!);
    minY = Math.min(minY, y!);
    maxX = Math.max(maxX, x!);
    maxY = Math.max(maxY, y!);
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return false;
  const padding = Number.isFinite(input.diameter)
    ? Math.max(0.5, input.diameter / 2)
    : 0.5;
  const scaleX = input.outputWidth / input.documentWidth;
  const scaleY = input.outputHeight / input.documentHeight;
  const expectedLeft = (minX - padding) * scaleX;
  const expectedTop = (minY - padding) * scaleY;
  const expectedRight = (maxX + padding) * scaleX;
  const expectedBottom = (maxY + padding) * scaleY;
  const actualRight = bounds.x + bounds.width;
  const actualBottom = bounds.y + bounds.height;
  return bounds.x < expectedRight
    && actualRight > expectedLeft
    && bounds.y < expectedBottom
    && actualBottom > expectedTop;
}

/**
 * ImageBitmap host for the physical field. Interactive frames are latest-only at presentation,
 * while provider operations remain fully serialized: replacing a pending bitmap never drops
 * authoritative input or its operation journal.
 */
export class StudioLivingInkOverlayRenderer {
  readonly #canvas: HTMLCanvasElement;
  readonly #context: CanvasRenderingContext2D | null;
  #pending: PendingFrame | null = null;
  #raf = 0;
  #disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas;
    this.#context = canvas.getContext("2d", {
      alpha: true,
      desynchronized: true,
    });
  }

  get available(): boolean {
    return !this.#disposed && this.#context !== null;
  }

  offer(
    frame: StudioLivingInkExecutionFrame,
    routeKey: string,
    projection: StudioLivingInkOverlayProjection,
    onPresented: (receipt: StudioLivingInkOverlayPresentationReceipt) => void,
  ): boolean {
    if (!this.available || !routeKey || !validProjection(projection)) {
      frame.image.close();
      return false;
    }
    this.#pending?.frame.image.close();
    this.#pending = { frame, routeKey, projection, onPresented };
    if (!this.#raf) {
      this.#raf = globalThis.requestAnimationFrame(() => {
        this.#raf = 0;
        const pending = this.#pending;
        this.#pending = null;
        if (pending) this.#draw(pending);
      });
    }
    return true;
  }

  #draw(pending: PendingFrame): StudioLivingInkOverlayPresentationReceipt | null {
    const { frame, projection, routeKey } = pending;
    if (!this.available || !this.#context || !validProjection(projection)) {
      frame.image.close();
      return null;
    }
    const deviceScaleX = projection.scaleX * projection.devicePixelRatio;
    const deviceScaleY = projection.scaleY * projection.devicePixelRatio;
    const destinationX = -projection.documentX * deviceScaleX;
    const destinationY = -projection.documentY * deviceScaleY;
    const destinationWidth = projection.documentWidth * deviceScaleX;
    const destinationHeight = projection.documentHeight * deviceScaleY;
    const context = this.#context;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
    context.globalAlpha = 1;
    context.globalCompositeOperation = "copy";
    context.imageSmoothingEnabled = true;
    context.drawImage(
      frame.image,
      destinationX,
      destinationY,
      destinationWidth,
      destinationHeight,
    );
    context.restore();
    frame.image.close();
    const receipt: StudioLivingInkOverlayPresentationReceipt = Object.freeze({
      kind: "studio-living-ink/presentation-receipt",
      routeKey,
      revision: frame.receipt.revision,
      displaySha256: frame.receipt.displaySha256,
      status: "presented",
    });
    pending.onPresented(receipt);
    return receipt;
  }

  async presentCanonical(
    frame: StudioLivingInkExecutionFrame,
    routeKey: string,
    projection: StudioLivingInkOverlayProjection,
    onPresented: (receipt: StudioLivingInkOverlayPresentationReceipt) => void,
  ): Promise<StudioLivingInkCanonicalPresentation> {
    if (!this.available || !validProjection(projection)) {
      frame.image.close();
      throw new Error("Living Ink 라이브 표면을 사용할 수 없습니다.");
    }
    if (this.#raf) {
      globalThis.cancelAnimationFrame(this.#raf);
      this.#raf = 0;
    }
    this.#pending?.frame.image.close();
    this.#pending = null;

    const output = document.createElement("canvas");
    output.width = frame.image.width;
    output.height = frame.image.height;
    // Alpha must survive: the canonical PNG becomes a page-sized document layer, and the resolve
    // uses alpha to say where the wash actually is. `{ alpha: false }` here flattened the wash onto
    // an opaque paper sheet, so one stroke repainted the whole page in the exported PNG.
    const outputContext = output.getContext("2d", { alpha: true });
    if (!outputContext) {
      frame.image.close();
      throw new Error("Living Ink canonical 표면을 만들 수 없습니다.");
    }
    outputContext.drawImage(frame.image, 0, 0);
    const alphaCoverage = measureStudioLivingInkAlphaCoverage(
      outputContext.getImageData(0, 0, output.width, output.height).data,
      output.width,
      output.height,
    );
    const presentation = this.#draw({ frame, routeKey, projection, onPresented });
    if (!presentation) throw new Error("Living Ink 최종 프레임을 표시하지 못했습니다.");

    const blob = await canvasPngBlob(output);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const pngSha256 = `sha256:${sha256HexPortable(bytes)}` as const;
    return Object.freeze({
      src: `data:image/png;base64,${base64FromBytes(bytes)}`,
      pngSha256,
      width: output.width,
      height: output.height,
      alphaCoverage,
      presentation,
    });
  }

  clear(): void {
    if (this.#raf) {
      globalThis.cancelAnimationFrame(this.#raf);
      this.#raf = 0;
    }
    this.#pending?.frame.image.close();
    this.#pending = null;
    if (!this.#context) return;
    this.#context.save();
    this.#context.setTransform(1, 0, 0, 1, 0, 0);
    this.#context.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
    this.#context.restore();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.clear();
    this.#disposed = true;
  }
}
