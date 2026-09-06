/**
 * Raster bake for layer merge plans — composites image sources into one PNG data URL.
 * Pure relative to document model; canvas is injected for tests without DOM.
 */

import { applyStudioLayerMergePlan } from "./studio-layer-merge";

import type { StudioLayerBounds, StudioLayerMergePlan } from "./studio-layer-merge";

export interface StudioMergeBakeImageSource {
  id: string;
  type: string;
  src?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity?: number;
  rotation?: number;
  flipped?: boolean;
  flippedY?: boolean;
}

export interface StudioMergeBakeComposite {
  id: string;
  type: "image";
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  name: string;
  opacity: number;
}

export type StudioMergeBakeResult =
  | { ok: true; mode: "raster"; composite: StudioMergeBakeComposite }
  | { ok: true; mode: "group"; reason: string }
  | { ok: false; reason: string };

export interface StudioMergeBakeCanvas {
  width: number;
  height: number;
  getContext(type: "2d"): {
    clearRect(x: number, y: number, w: number, h: number): void;
    save(): void;
    restore(): void;
    translate(x: number, y: number): void;
    rotate(rad: number): void;
    scale(x: number, y: number): void;
    globalAlpha: number;
    drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
  } | null;
  toDataURL(type?: string): string;
  /** Optional async encoder surface (HTMLCanvasElement.toBlob). */
  toBlob?: (
    callback: (blob: Blob | null) => void,
    type?: string,
    quality?: number,
  ) => void;
}

/** Optional PNG encoder for the async merge bake path (toBlob-first preferred). */
export type StudioMergeBakePngEncoder = (canvas: StudioMergeBakeCanvas) => Promise<string>;

export type StudioMergeBakeImageLoader = (src: string) => Promise<CanvasImageSource>;

/** True when every merge source is a drawable image with a usable src. */
export function studioMergeSourcesAreRasterizable(
  sources: readonly StudioMergeBakeImageSource[]
): boolean {
  if (sources.length < 2) return false;
  return sources.every(
    (source) =>
      source.type === "image"
      && typeof source.src === "string"
      && source.src.length > 0
      && Number.isFinite(source.width)
      && Number.isFinite(source.height)
      && source.width > 0
      && source.height > 0
  );
}

export function studioMergeBoundsFromSources(
  sources: readonly StudioMergeBakeImageSource[],
  planBounds: StudioLayerBounds | null
): StudioLayerBounds {
  if (planBounds) return planBounds;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const source of sources) {
    minX = Math.min(minX, source.x);
    minY = Math.min(minY, source.y);
    maxX = Math.max(maxX, source.x + source.width);
    maxY = Math.max(maxY, source.y + source.height);
  }
  if (!Number.isFinite(minX)) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

/**
 * Decide raster vs group mode without drawing. Used by product path before async bake.
 */
export function planStudioMergeBakeMode(
  sources: readonly StudioMergeBakeImageSource[]
): { mode: "raster" } | { mode: "group"; reason: string } {
  if (!studioMergeSourcesAreRasterizable(sources)) {
    return {
      mode: "group",
      reason: "이미지 외 요소가 포함되어 비파괴 그룹으로 묶습니다.",
    };
  }
  return { mode: "raster" };
}

type StudioMergeCompositeCanvasResult =
  | {
      ok: true;
      canvas: StudioMergeBakeCanvas;
      bounds: StudioLayerBounds;
      width: number;
      height: number;
      resultName: string;
    }
  | StudioMergeBakeResult;

function composeStudioMergeCanvas(input: {
  plan: StudioLayerMergePlan;
  sources: readonly StudioMergeBakeImageSource[];
  imagesById: ReadonlyMap<string, CanvasImageSource>;
  createCanvas: (width: number, height: number) => StudioMergeBakeCanvas;
}): StudioMergeCompositeCanvasResult {
  const mode = planStudioMergeBakeMode(input.sources);
  if (mode.mode === "group") return { ok: true, mode: "group", reason: mode.reason };

  const ordered = [...input.plan.sources]
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((entry) => input.sources.find((source) => source.id === entry.id))
    .filter((source): source is StudioMergeBakeImageSource => Boolean(source));

  if (ordered.length < 2) {
    return { ok: false, reason: "병합할 이미지 소스가 부족합니다." };
  }

  const bounds = studioMergeBoundsFromSources(ordered, input.plan.bounds);
  const width = Math.max(1, Math.ceil(bounds.width));
  const height = Math.max(1, Math.ceil(bounds.height));
  const canvas = input.createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return { ok: false, reason: "캔버스 컨텍스트를 만들 수 없습니다." };

  ctx.clearRect(0, 0, width, height);
  for (const source of ordered) {
    const image = input.imagesById.get(source.id);
    if (!image) return { ok: false, reason: "이미지 소스를 불러오지 못했습니다." };
    ctx.save();
    ctx.globalAlpha = Math.min(1, Math.max(0, source.opacity ?? 1));
    const cx = source.x - bounds.x + source.width / 2;
    const cy = source.y - bounds.y + source.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate(((source.rotation ?? 0) * Math.PI) / 180);
    ctx.scale(source.flipped ? -1 : 1, source.flippedY ? -1 : 1);
    ctx.drawImage(image, -source.width / 2, -source.height / 2, source.width, source.height);
    ctx.restore();
  }

  return {
    ok: true,
    canvas,
    bounds,
    width,
    height,
    resultName: input.plan.resultName,
  };
}

function compositeFromEncodedCanvas(
  input: {
    newId: string;
    canvas: StudioMergeBakeCanvas;
    bounds: StudioLayerBounds;
    width: number;
    height: number;
    resultName: string;
  },
  src: string,
): StudioMergeBakeResult {
  return {
    ok: true,
    mode: "raster",
    composite: {
      id: input.newId,
      type: "image",
      src,
      x: input.bounds.x,
      y: input.bounds.y,
      width: input.width,
      height: input.height,
      rotation: 0,
      name: input.resultName,
      opacity: 1,
    },
  };
}

/** Synchronous composite when images are already loaded CanvasImageSources. */
export function bakeStudioMergeCompositeSync(input: {
  plan: StudioLayerMergePlan;
  sources: readonly StudioMergeBakeImageSource[];
  imagesById: ReadonlyMap<string, CanvasImageSource>;
  newId: string;
  createCanvas: (width: number, height: number) => StudioMergeBakeCanvas;
}): StudioMergeBakeResult {
  const composed = composeStudioMergeCanvas(input);
  if (!("canvas" in composed)) return composed;

  let src: string;
  try {
    src = composed.canvas.toDataURL("image/png");
  } catch {
    return { ok: false, reason: "병합 이미지를 인코딩하지 못했습니다." };
  }

  return compositeFromEncodedCanvas({
    newId: input.newId,
    canvas: composed.canvas,
    bounds: composed.bounds,
    width: composed.width,
    height: composed.height,
    resultName: composed.resultName,
  }, src);
}

/** Async browser bake using HTMLImageElement loading. */
export async function bakeStudioMergeComposite(input: {
  plan: StudioLayerMergePlan;
  sources: readonly StudioMergeBakeImageSource[];
  newId: string;
  loadImage?: StudioMergeBakeImageLoader;
  createCanvas?: (width: number, height: number) => StudioMergeBakeCanvas;
  /**
   * Prefer async PNG encode (toBlob). Defaults to {@link encodeStudioPixelEditCanvasPng} when
   * the canvas looks like a real HTMLCanvasElement; otherwise falls back to toDataURL.
   */
  encodePng?: StudioMergeBakePngEncoder;
}): Promise<StudioMergeBakeResult> {
  const mode = planStudioMergeBakeMode(input.sources);
  if (mode.mode === "group") return { ok: true, mode: "group", reason: mode.reason };

  const loadImage = input.loadImage ?? defaultLoadImage;
  const createCanvas = input.createCanvas ?? defaultCreateCanvas;
  const imagesById = new Map<string, CanvasImageSource>();
  for (const source of input.sources) {
    if (typeof source.src !== "string") continue;
    try {
      imagesById.set(source.id, await loadImage(source.src));
    } catch {
      return { ok: false, reason: "이미지 소스를 불러오지 못했습니다." };
    }
  }

  const composed = composeStudioMergeCanvas({
    plan: input.plan,
    sources: input.sources,
    imagesById,
    createCanvas,
  });
  if (!("canvas" in composed)) return composed;

  try {
    const encode = input.encodePng ?? defaultEncodeMergePng;
    const src = await encode(composed.canvas);
    return compositeFromEncodedCanvas({
      newId: input.newId,
      canvas: composed.canvas,
      bounds: composed.bounds,
      width: composed.width,
      height: composed.height,
      resultName: composed.resultName,
    }, src);
  } catch {
    return { ok: false, reason: "병합 이미지를 인코딩하지 못했습니다." };
  }
}

async function defaultEncodeMergePng(canvas: StudioMergeBakeCanvas): Promise<string> {
  if (typeof canvas.toBlob === "function" || typeof (canvas as HTMLCanvasElement).toDataURL === "function") {
    try {
      const { encodeStudioPixelEditCanvasPng } = await import("../studio-pixel-edit-async");
      return encodeStudioPixelEditCanvasPng(canvas as HTMLCanvasElement);
    } catch {
      // Fall through to synchronous toDataURL for test fakes / restricted runtimes.
    }
  }
  return canvas.toDataURL("image/png");
}

export function applyStudioMergeBakeToElements<T extends { id: string }>(
  items: readonly T[],
  plan: StudioLayerMergePlan,
  composite: T
): T[] {
  return applyStudioLayerMergePlan(items, plan, composite);
}

function defaultCreateCanvas(width: number, height: number): StudioMergeBakeCanvas {
  if (typeof document === "undefined") {
    throw new Error("document is required for default merge bake canvas");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function defaultLoadImage(src: string): Promise<CanvasImageSource> {
  return new Promise((resolve, reject) => {
    if (typeof Image === "undefined") {
      reject(new Error("Image is not available"));
      return;
    }
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image load failed"));
    image.src = src;
  });
}
