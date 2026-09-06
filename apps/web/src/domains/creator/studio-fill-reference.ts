/**
 * Advanced Fill reference-layer composition.
 *
 * The fill engine always writes to the selected raster layer, while its boundary source can be
 * the selected layer, every visible raster layer, or layers explicitly marked as fill references.
 * Reference layers are rendered into the target layer's *source-pixel* coordinate system so layers
 * keep lining up even when they have different page positions, scales, rotations, or flips.
 *
 * Matrix/selection helpers are pure and deterministic. Only composeStudioFillReferenceImage touches
 * Image/canvas APIs; callers can therefore unit-test all geometry without a DOM.
 */
import {
  currentStudioAdvancedFillBrowserMaxPixels,
  formatStudioAdvancedFillRasterSizeError,
  validateStudioAdvancedFillRasterDimensions,
} from "./studio-advanced-fill-raster-safety";
import { loadFloodFillSourceImage } from "./studio-flood-fill";

import type { StudioAdvancedFillReferenceScope } from "./studio-advanced-fill-settings";

export type StudioFillReferenceScope = StudioAdvancedFillReferenceScope;

export type StudioFillReferenceLayer = {
  id: string;
  name: string;
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  flipped?: boolean;
  flippedY?: boolean;
  opacity?: number;
  hidden?: boolean;
  fillReference?: boolean;
};

/**
 * A rasterized page-space boundary source, such as the exact PNG produced from visible DrawEl
 * line art. Unlike an authored ImageEl it always occupies the page coordinate system.
 */
export type StudioFillPageReference = {
  id: string;
  name: string;
  src: string;
  pageWidth: number;
  pageHeight: number;
  opacity?: number;
  fillReference?: boolean;
};

export type StudioFillNaturalSize = { width: number; height: number };

/** Canvas2D-compatible affine matrix: x' = a*x + c*y + e, y' = b*x + d*y + f. */
export type StudioFillAffine = { a: number; b: number; c: number; d: number; e: number; f: number };

export type StudioFillReferenceCanvas = {
  width: number;
  height: number;
  getContext(type: "2d"): CanvasRenderingContext2D | null;
  toDataURL(type?: string): string;
  toBlob?(callback: (blob: Blob | null) => void, type?: string): void;
};

export type StudioFillReferenceCanvasFactory = (
  width: number,
  height: number,
) => StudioFillReferenceCanvas | null;

const IDENTITY: StudioFillAffine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function translate(x: number, y: number): StudioFillAffine {
  return { a: 1, b: 0, c: 0, d: 1, e: finiteOr(x, 0), f: finiteOr(y, 0) };
}

function scale(x: number, y: number): StudioFillAffine {
  return { a: finiteOr(x, 1), b: 0, c: 0, d: finiteOr(y, 1), e: 0, f: 0 };
}

function rotate(degrees: number): StudioFillAffine {
  const radians = (finiteOr(degrees, 0) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

/** Returns left * right: right is applied first, then left. */
export function multiplyStudioFillAffine(
  left: StudioFillAffine,
  right: StudioFillAffine,
): StudioFillAffine {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

export function applyStudioFillAffine(
  matrix: StudioFillAffine,
  point: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

function compose(...matrices: StudioFillAffine[]): StudioFillAffine {
  return matrices.reduce((result, matrix) => multiplyStudioFillAffine(result, matrix), IDENTITY);
}

/** Source natural pixels -> page coordinates. Rotation follows the Studio/Konva top-left origin. */
export function studioFillLayerToPageMatrix(
  layer: StudioFillReferenceLayer,
  natural: StudioFillNaturalSize,
): StudioFillAffine {
  const naturalWidth = positiveOr(natural.width, 1);
  const naturalHeight = positiveOr(natural.height, 1);
  const displayWidth = positiveOr(layer.width, 1);
  const displayHeight = positiveOr(layer.height, 1);
  const flipTranslateX = layer.flipped ? displayWidth : 0;
  const flipTranslateY = layer.flippedY ? displayHeight : 0;
  const scaleX = (displayWidth / naturalWidth) * (layer.flipped ? -1 : 1);
  const scaleY = (displayHeight / naturalHeight) * (layer.flippedY ? -1 : 1);
  return compose(
    translate(layer.x, layer.y),
    rotate(layer.rotation ?? 0),
    translate(flipTranslateX, flipTranslateY),
    scale(scaleX, scaleY),
  );
}

/** Page coordinates -> target source pixels (the inverse of studioFillLayerToPageMatrix). */
export function studioFillPageToLayerMatrix(
  layer: StudioFillReferenceLayer,
  natural: StudioFillNaturalSize,
): StudioFillAffine {
  const naturalWidth = positiveOr(natural.width, 1);
  const naturalHeight = positiveOr(natural.height, 1);
  const displayWidth = positiveOr(layer.width, 1);
  const displayHeight = positiveOr(layer.height, 1);
  const scaleX = (naturalWidth / displayWidth) * (layer.flipped ? -1 : 1);
  const scaleY = (naturalHeight / displayHeight) * (layer.flippedY ? -1 : 1);
  return compose(
    translate(layer.flipped ? naturalWidth : 0, layer.flippedY ? naturalHeight : 0),
    scale(scaleX, scaleY),
    rotate(-(layer.rotation ?? 0)),
    translate(-layer.x, -layer.y),
  );
}

/** Source layer natural pixels -> target layer natural pixels. */
export function studioFillLayerToTargetMatrix(
  source: StudioFillReferenceLayer,
  sourceNatural: StudioFillNaturalSize,
  target: StudioFillReferenceLayer,
  targetNatural: StudioFillNaturalSize,
): StudioFillAffine {
  return multiplyStudioFillAffine(
    studioFillPageToLayerMatrix(target, targetNatural),
    studioFillLayerToPageMatrix(source, sourceNatural),
  );
}

export type StudioFillPageBounds = { x: number; y: number; width: number; height: number };

/** Axis-aligned page bounds of the displayed layer, including top-left-origin rotation. */
export function studioFillLayerPageBounds(layer: StudioFillReferenceLayer): StudioFillPageBounds {
  const width = positiveOr(layer.width, 1);
  const height = positiveOr(layer.height, 1);
  const matrix = studioFillLayerToPageMatrix(layer, { width, height });
  const points = [
    applyStudioFillAffine(matrix, { x: 0, y: 0 }),
    applyStudioFillAffine(matrix, { x: width, y: 0 }),
    applyStudioFillAffine(matrix, { x: width, y: height }),
    applyStudioFillAffine(matrix, { x: 0, y: height }),
  ];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minimumX = Math.min(...xs);
  const maximumX = Math.max(...xs);
  const minimumY = Math.min(...ys);
  const maximumY = Math.max(...ys);
  return { x: minimumX, y: minimumY, width: maximumX - minimumX, height: maximumY - minimumY };
}

export function studioFillPageBoundsIntersect(
  first: StudioFillPageBounds,
  second: StudioFillPageBounds,
): boolean {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

/** True when Canvas2D can draw without resampling an integer-aligned transform. */
export function studioFillAffineIsPixelAligned(matrix: StudioFillAffine, epsilon = 1e-9): boolean {
  const nearInteger = (value: number) => Math.abs(value - Math.round(value)) <= epsilon;
  return (
    Math.abs(matrix.b) <= epsilon &&
    Math.abs(matrix.c) <= epsilon &&
    nearInteger(matrix.a) &&
    nearInteger(matrix.d) &&
    nearInteger(matrix.e) &&
    nearInteger(matrix.f)
  );
}

/**
 * Keeps z-order, excludes hidden layers, and returns only the scope requested by the fill panel.
 * current intentionally returns the target even if it was accidentally marked hidden: the
 * selected editable target is still the local source the user explicitly asked to sample.
 */
export function collectStudioFillReferenceLayers(
  layers: readonly StudioFillReferenceLayer[],
  targetId: string,
  scope: StudioFillReferenceScope,
): StudioFillReferenceLayer[] {
  const target = layers.find((layer) => layer.id === targetId);
  if (!target) return [];
  if (scope === "current") {
    return [target];
  }
  // Keep the editable target out of multi-layer reference composites. Otherwise each committed
  // color becomes a new boundary for the next continuous fill, making the reference unstable.
  // Users who intentionally want the target pixels can choose current-layer explicitly.
  const visible = layers.filter((layer) => !layer.hidden && layer.id !== targetId);
  if (scope === "reference") return visible.filter((layer) => layer.fillReference === true);
  return visible.slice();
}

/** Scope selection plus conservative page-overlap culling, shared by UI counts and composition. */
export function collectOverlappingStudioFillReferenceLayers(
  layers: readonly StudioFillReferenceLayer[],
  targetId: string,
  scope: StudioFillReferenceScope,
): StudioFillReferenceLayer[] {
  const target = layers.find((layer) => layer.id === targetId);
  if (!target) return [];
  if (scope === "current") return [target];
  const targetBounds = studioFillLayerPageBounds(target);
  return collectStudioFillReferenceLayers(layers, targetId, scope).filter((layer) =>
    studioFillPageBoundsIntersect(studioFillLayerPageBounds(layer), targetBounds),
  );
}

/**
 * Adds transient page-space references without mutating the authored raster-layer array.
 *
 * The resulting layers can pass through the existing affine/overlap/composition pipeline, which
 * keeps vector reference PNGs aligned to a scaled, rotated, flipped, or high-DPR raster target.
 */
export function withStudioFillPageReferenceLayers(
  layers: readonly StudioFillReferenceLayer[],
  pageReferences: readonly StudioFillPageReference[],
): StudioFillReferenceLayer[] {
  const ids = new Set(layers.map((layer) => layer.id));
  const result = [...layers];
  for (const reference of pageReferences) {
    if (!reference.id.trim() || ids.has(reference.id)) {
      throw new Error("채우기 페이지 참조 id가 없거나 다른 레이어와 겹칩니다.");
    }
    if (
      !Number.isFinite(reference.pageWidth)
      || !Number.isFinite(reference.pageHeight)
      || reference.pageWidth <= 0
      || reference.pageHeight <= 0
    ) {
      throw new RangeError("채우기 페이지 참조 크기가 올바르지 않습니다.");
    }
    ids.add(reference.id);
    result.push({
      id: reference.id,
      name: reference.name,
      src: reference.src,
      x: 0,
      y: 0,
      width: reference.pageWidth,
      height: reference.pageHeight,
      rotation: 0,
      opacity: reference.opacity,
      fillReference: reference.fillReference,
    });
  }
  return result;
}

function defaultCanvasFactory(width: number, height: number): StudioFillReferenceCanvas | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function studioFillReferenceAbortError(): DOMException {
  return new DOMException("참조 레이어 합성을 취소했습니다.", "AbortError");
}

function throwIfStudioFillReferenceAborted(abort?: AbortSignal): void {
  if (abort?.aborted) throw studioFillReferenceAbortError();
}

function readStudioFillReferenceBlob(blob: Blob, abort?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    let settled = false;
    const cleanup = () => abort?.removeEventListener("abort", onAbort);
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => finish(() => {
      reader.abort();
      reject(studioFillReferenceAbortError());
    });
    reader.onerror = () => finish(() => reject(reader.error ?? new Error("참조 PNG를 읽지 못했습니다.")));
    reader.onload = () => finish(() => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("참조 PNG를 data URL로 만들지 못했습니다."));
    });
    abort?.addEventListener("abort", onAbort, { once: true });
    if (abort?.aborted) {
      onAbort();
      return;
    }
    reader.readAsDataURL(blob);
  });
}

export async function encodeStudioFillReferenceCanvas(
  canvas: StudioFillReferenceCanvas,
  abort?: AbortSignal,
): Promise<string> {
  throwIfStudioFillReferenceAborted(abort);
  if (typeof canvas.toBlob !== "function") {
    const dataUrl = canvas.toDataURL("image/png");
    throwIfStudioFillReferenceAborted(abort);
    return dataUrl;
  }
  const blob = await new Promise<Blob>((resolve, reject) => {
    let settled = false;
    const cleanup = () => abort?.removeEventListener("abort", onAbort);
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => finish(() => reject(studioFillReferenceAbortError()));
    abort?.addEventListener("abort", onAbort, { once: true });
    if (abort?.aborted) {
      onAbort();
      return;
    }
    canvas.toBlob!((value) => finish(() => {
      if (value) resolve(value);
      else reject(new Error("참조 PNG를 인코딩하지 못했습니다."));
    }), "image/png");
  });
  throwIfStudioFillReferenceAborted(abort);
  return readStudioFillReferenceBlob(blob, abort);
}

/**
 * Composes the requested raster references in the selected target layer's natural pixel space.
 * The target layer itself can be supplied with a newer `src` than the page snapshot (continuous
 * fill preview); callers should replace its src in `layers` before calling when desired.
 */
export async function composeStudioFillReferenceImage(
  layers: readonly StudioFillReferenceLayer[],
  targetId: string,
  scope: Exclude<StudioFillReferenceScope, "current">,
  canvasFactory: StudioFillReferenceCanvasFactory = defaultCanvasFactory,
  abort?: AbortSignal,
): Promise<{ dataUrl: string; layerCount: number }> {
  throwIfStudioFillReferenceAborted(abort);
  const target = layers.find((layer) => layer.id === targetId);
  if (!target) throw new Error("채우기 대상 레이어를 찾지 못했습니다.");
  // AABB culling occurs before image decoding. It deliberately allows a few false positives for
  // rotated layers, but never drops a layer that can actually overlap the target.
  const selectedLayers = collectOverlappingStudioFillReferenceLayers(layers, targetId, scope);
  if (selectedLayers.length === 0) {
    throw new Error(
      scope === "reference"
        ? "채우기 참조로 지정된 표시 레이어가 없습니다."
        : "참조할 표시 래스터 레이어가 없습니다.",
    );
  }

  const targetImage = await loadFloodFillSourceImage(target.src, abort);
  throwIfStudioFillReferenceAborted(abort);
  const targetNatural = {
    width: targetImage.naturalWidth || targetImage.width,
    height: targetImage.naturalHeight || targetImage.height,
  };
  if (!targetNatural.width || !targetNatural.height) {
    throw new Error("채우기 대상 이미지 크기를 확인할 수 없습니다.");
  }
  let safeTargetNatural: StudioFillNaturalSize;
  try {
    safeTargetNatural = validateStudioAdvancedFillRasterDimensions(
      targetNatural.width,
      targetNatural.height,
      currentStudioAdvancedFillBrowserMaxPixels(),
    );
  } catch (error) {
    throw new RangeError(formatStudioAdvancedFillRasterSizeError(error), { cause: error });
  }
  const output = canvasFactory(safeTargetNatural.width, safeTargetNatural.height);
  if (!output) throw new Error("참조 레이어 합성 캔버스를 만들 수 없습니다.");

  try {
    const context = output.getContext("2d");
    if (!context) throw new Error("참조 레이어 합성 캔버스를 만들 수 없습니다.");
    context.clearRect(0, 0, output.width, output.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    let drawnLayerCount = 0;
    // Decode and draw sequentially to avoid retaining every full-resolution source at once on
    // memory-constrained phones. Z-order remains the input array order.
    for (const layer of selectedLayers) {
      throwIfStudioFillReferenceAborted(abort);
      const image = layer.id === target.id && layer.src === target.src
        ? targetImage
        : await loadFloodFillSourceImage(layer.src, abort);
      throwIfStudioFillReferenceAborted(abort);
      const natural = {
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
      };
      if (!natural.width || !natural.height) continue;
      const matrix = studioFillLayerToTargetMatrix(layer, natural, target, targetNatural);
      context.save();
      try {
        context.globalAlpha = Math.max(0, Math.min(1, finiteOr(layer.opacity, 1)));
        context.imageSmoothingEnabled = !studioFillAffineIsPixelAligned(matrix);
        if (context.imageSmoothingEnabled) context.imageSmoothingQuality = "high";
        context.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
        context.drawImage(image, 0, 0, natural.width, natural.height);
        throwIfStudioFillReferenceAborted(abort);
        drawnLayerCount++;
      } finally {
        context.restore();
      }
    }

    const dataUrl = await encodeStudioFillReferenceCanvas(output, abort);
    return { dataUrl, layerCount: drawnLayerCount };
  } finally {
    // Large webtoon source canvases can hold tens of MiB. Resetting the backing store releases it
    // promptly on both success and every load/draw/encode failure path.
    output.width = 0;
    output.height = 0;
  }
}

/**
 * Raster + page-space vector boundary composition.
 *
 * Page references are transient and never materialized in the document. They are appended above
 * raster references so anti-aliased ink remains an authoritative boundary at the final composite.
 */
export async function composeStudioFillReferenceImageWithPageReferences(
  layers: readonly StudioFillReferenceLayer[],
  targetId: string,
  scope: Exclude<StudioFillReferenceScope, "current">,
  pageReferences: readonly StudioFillPageReference[],
  canvasFactory: StudioFillReferenceCanvasFactory = defaultCanvasFactory,
  abort?: AbortSignal,
): Promise<{ dataUrl: string; layerCount: number }> {
  return composeStudioFillReferenceImage(
    withStudioFillPageReferenceLayers(layers, pageReferences),
    targetId,
    scope,
    canvasFactory,
    abort,
  );
}
