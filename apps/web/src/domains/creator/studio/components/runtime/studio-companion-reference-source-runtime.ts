/**
 * Demand-owned source runtime for the detached Studio reference companion.
 *
 * The primary editor dynamically imports this module only after a companion asks for reference
 * pixels. This module then dynamically imports the local asset/board decoders, resolves content by
 * canonical SHA-256 before considering the device-local asset id hint, and owns every resulting
 * canvas and RGBA buffer until demand ends. Nothing in this file serializes an asset id, data URL,
 * editable reference record, or source pixel buffer to the companion window.
 */

import type { StudioAsset } from "@/src/domains/creator/studio-asset-library";
import type {
  StudioCompanionReferencePreviewInput,
  StudioCompanionReferencePreviewItem,
  StudioCompanionReferencePreviewSource,
} from "@/src/domains/creator/studio-companion-reference-preview";
import type {
  StudioReferenceBoardDocument,
  StudioReferenceBoardItem,
  StudioReferenceBoardSha256,
} from "@/src/domains/creator/studio-reference-board";
import type { StudioReferenceImageRaster } from "@/src/domains/creator/studio-reference-color-sampler";

export const STUDIO_COMPANION_REFERENCE_SOURCE_WIDTH = 1_280;
export const STUDIO_COMPANION_REFERENCE_SOURCE_HEIGHT = 720;
export const STUDIO_COMPANION_REFERENCE_SOURCE_MAX_RGBA_BYTES = 32 * 1024 * 1024;
export const STUDIO_COMPANION_REFERENCE_SOURCE_MAX_DECODED_PIXELS = 16_777_216;
export const STUDIO_COMPANION_REFERENCE_SOURCE_MAX_DATA_URL_CHARS = 32 * 1024 * 1024;

export interface StudioCompanionReferencePrivateCanvasContext {
  createImageData(width: number, height: number): ImageData;
  putImageData(imageData: ImageData, dx: number, dy: number): void;
}

export interface StudioCompanionReferencePrivateCanvas {
  width: number;
  height: number;
  getContext(
    contextId: "2d",
    options?: { alpha?: boolean; willReadFrequently?: boolean }
  ): StudioCompanionReferencePrivateCanvasContext | null;
}

export type StudioCompanionReferencePrivateCanvasFactory = (
  width: number,
  height: number
) => StudioCompanionReferencePrivateCanvas;

export interface StudioCompanionReferenceDecodedSource {
  /** Private primary-owned drawable. It is never included in a BroadcastChannel message. */
  drawable: object;
  width: number;
  height: number;
  /** Fresh tightly-packed RGBA owned by this runtime. */
  pixels: Uint8ClampedArray;
  /** Releases decoder-specific resources such as ImageBitmap or an object URL. */
  release?: () => void;
}

export interface StudioCompanionReferenceDecodeRequest {
  signal: AbortSignal;
  maximumDecodedPixels: number;
  maximumOutputPixels: number;
  maximumWidth: number;
  maximumHeight: number;
}

export interface StudioCompanionReferenceSourceDependencies {
  parseDocument(value: unknown): StudioReferenceBoardDocument | null;
  findAssetCandidates(
    descriptors: readonly StudioReferenceBoardItem["asset"][],
    signal: AbortSignal
  ): Promise<ReadonlyMap<string, readonly StudioAsset[]>>;
  canonicalizeContentHash(value: unknown): string | null;
  hashDataUrl(dataUrl: string, signal: AbortSignal): Promise<string>;
  decodeAsset(
    asset: StudioAsset,
    request: StudioCompanionReferenceDecodeRequest
  ): Promise<StudioCompanionReferenceDecodedSource | null>;
  release?: () => void;
}

export type StudioCompanionReferenceSourceDependencyLoader =
  () => Promise<StudioCompanionReferenceSourceDependencies>;

export interface StudioCompanionReferenceSamplingInput {
  boardWidth: number;
  boardHeight: number;
  items: readonly StudioCompanionReferencePreviewItem[];
}

export interface StudioCompanionReferenceSourceSnapshot {
  boardWidth: typeof STUDIO_COMPANION_REFERENCE_SOURCE_WIDTH;
  boardHeight: typeof STUDIO_COMPANION_REFERENCE_SOURCE_HEIGHT;
  itemCount: number;
  resolvedItemCount: number;
  canPickColor: boolean;
  /** Input for createStudioCompanionReferencePreviewFrame(). */
  previewInput: Readonly<StudioCompanionReferencePreviewInput>;
  /** Input for sampleStudioCompanionReferenceColor(). */
  colorSamplingInput: Readonly<StudioCompanionReferenceSamplingInput>;
}

export type StudioCompanionReferenceSourceDemandResult =
  | { status: "ready"; snapshot: StudioCompanionReferenceSourceSnapshot }
  | { status: "inactive" | "stale" | "unavailable"; snapshot: null };

export interface StudioCompanionReferenceSourceDemand {
  active: boolean;
  document: unknown;
  signal?: AbortSignal;
}

export interface StudioCompanionReferenceSourceRuntime {
  setDemand(
    demand: StudioCompanionReferenceSourceDemand
  ): Promise<StudioCompanionReferenceSourceDemandResult>;
  current(): StudioCompanionReferenceSourceSnapshot | null;
  release(): void;
}

export interface StudioCompanionReferenceSourceRuntimeOptions {
  loadDependencies?: StudioCompanionReferenceSourceDependencyLoader;
}

type AssetCandidate = Readonly<{
  source: StudioAsset;
  id: string;
  dataUrl: string;
  contentHash?: string;
}>;

type OwnedSnapshot = {
  publicSnapshot: StudioCompanionReferenceSourceSnapshot;
  release: () => void;
};

type OwnedDependencyScope = {
  epoch: number;
  release: (() => void) | null;
  released: boolean;
};

type OwnedCallerAbortScope = {
  epoch: number;
  release: () => void;
  released: boolean;
};

const ABORTED_AWAIT = Symbol("studio-companion-reference-aborted-await");

function awaitWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  releaseLateValue?: (value: T) => void
): Promise<T | typeof ABORTED_AWAIT> {
  return new Promise<T | typeof ABORTED_AWAIT>((resolve, reject) => {
    let accepting = true;
    const removeAbortListener = () => {
      try {
        signal.removeEventListener("abort", onAbort);
      } catch {
        // The internal signal is normally native; cleanup remains fail-closed in injected hosts.
      }
    };
    const onAbort = () => {
      if (!accepting) return;
      accepting = false;
      removeAbortListener();
      resolve(ABORTED_AWAIT);
    };
    try {
      signal.addEventListener("abort", onAbort, { once: true });
    } catch {
      onAbort();
    }
    if (signal.aborted) onAbort();
    promise.then(
      (value) => {
        if (!accepting) {
          try {
            releaseLateValue?.(value);
          } catch {
            // A late adapter value is never allowed to revive the retired demand.
          }
          return;
        }
        accepting = false;
        removeAbortListener();
        resolve(value);
      },
      (error: unknown) => {
        if (!accepting) return;
        accepting = false;
        removeAbortListener();
        reject(error);
      }
    );
  });
}

function safeFillZero(pixels: Uint8ClampedArray): void {
  try {
    Reflect.apply(Uint8ClampedArray.prototype.fill, pixels, [0]);
  } catch {
    // A detached or already released backing store contains no reusable source pixels.
  }
}

function releaseCanvas(canvas: object): void {
  try {
    const close = (canvas as { close?: unknown }).close;
    if (typeof close === "function") Reflect.apply(close, canvas, []);
  } catch {
    // ImageBitmap.close() and injected release hooks are best effort and idempotent.
  }
  try {
    const candidate = canvas as { width?: number; height?: number };
    if (typeof candidate.width === "number") candidate.width = 1;
    if (typeof candidate.height === "number") candidate.height = 1;
  } catch {
    // Read-only CanvasImageSource dimensions need no backing-store shrink.
  }
}

function releaseDecodedSource(source: StudioCompanionReferenceDecodedSource): void {
  try {
    source.release?.();
  } catch {
    // Continue clearing primary-owned memory even when an adapter cleanup hook fails.
  }
  safeFillZero(source.pixels);
  releaseCanvas(source.drawable);
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function arrayBufferBackedPixels(
  value: unknown,
  expectedLength: number
): value is Uint8ClampedArray {
  try {
    if (!(value instanceof Uint8ClampedArray)) return false;
    const typedArrayPrototype = Object.getPrototypeOf(Uint8ClampedArray.prototype) as object;
    const lengthGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "length")?.get;
    const bufferGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")?.get;
    const byteOffsetGetter = Object.getOwnPropertyDescriptor(
      typedArrayPrototype,
      "byteOffset"
    )?.get;
    const byteLengthGetter = Object.getOwnPropertyDescriptor(
      typedArrayPrototype,
      "byteLength"
    )?.get;
    if (!lengthGetter || !bufferGetter || !byteOffsetGetter || !byteLengthGetter) return false;
    const length = Reflect.apply(lengthGetter, value, []) as unknown;
    const buffer = Reflect.apply(bufferGetter, value, []) as unknown;
    const byteOffset = Reflect.apply(byteOffsetGetter, value, []) as unknown;
    const byteLength = Reflect.apply(byteLengthGetter, value, []) as unknown;
    return length === expectedLength
      && byteOffset === 0
      && byteLength === expectedLength
      && buffer instanceof ArrayBuffer
      && buffer.byteLength === expectedLength;
  } catch {
    return false;
  }
}

/** Fits one decoded source inside the 1280×720 envelope and its aggregate RGBA share. */
export function fitStudioCompanionReferenceSourceDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maximumOutputPixels: number
): { width: number; height: number } | null {
  if (
    !positiveSafeInteger(sourceWidth)
    || !positiveSafeInteger(sourceHeight)
    || !positiveSafeInteger(maximumOutputPixels)
  ) return null;
  const sourcePixels = sourceWidth * sourceHeight;
  if (!Number.isSafeInteger(sourcePixels)) return null;
  const scale = Math.min(
    1,
    STUDIO_COMPANION_REFERENCE_SOURCE_WIDTH / sourceWidth,
    STUDIO_COMPANION_REFERENCE_SOURCE_HEIGHT / sourceHeight,
    Math.sqrt(maximumOutputPixels / sourcePixels)
  );
  if (!finitePositive(scale)) return null;
  let width = Math.max(1, Math.floor(sourceWidth * scale));
  let height = Math.max(1, Math.floor(sourceHeight * scale));
  while (width * height > maximumOutputPixels) {
    if (width >= height && width > 1) width -= 1;
    else if (height > 1) height -= 1;
    else return null;
  }
  return { width, height };
}

function bilinearRgba(
  source: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
): Uint8ClampedArray {
  if (sourceWidth === targetWidth && sourceHeight === targetHeight) {
    return new Uint8ClampedArray(source);
  }
  const output = new Uint8ClampedArray(targetWidth * targetHeight * 4);
  const xScale = sourceWidth / targetWidth;
  const yScale = sourceHeight / targetHeight;
  for (let targetY = 0; targetY < targetHeight; targetY += 1) {
    const sourceY = Math.max(0, Math.min(sourceHeight - 1, (targetY + 0.5) * yScale - 0.5));
    const y0 = Math.floor(sourceY);
    const y1 = Math.min(sourceHeight - 1, y0 + 1);
    const yWeight = sourceY - y0;
    for (let targetX = 0; targetX < targetWidth; targetX += 1) {
      const sourceX = Math.max(0, Math.min(sourceWidth - 1, (targetX + 0.5) * xScale - 0.5));
      const x0 = Math.floor(sourceX);
      const x1 = Math.min(sourceWidth - 1, x0 + 1);
      const xWeight = sourceX - x0;
      const topLeft = (y0 * sourceWidth + x0) * 4;
      const topRight = (y0 * sourceWidth + x1) * 4;
      const bottomLeft = (y1 * sourceWidth + x0) * 4;
      const bottomRight = (y1 * sourceWidth + x1) * 4;
      const target = (targetY * targetWidth + targetX) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const top = (source[topLeft + channel] ?? 0) * (1 - xWeight)
          + (source[topRight + channel] ?? 0) * xWeight;
        const bottom = (source[bottomLeft + channel] ?? 0) * (1 - xWeight)
          + (source[bottomRight + channel] ?? 0) * xWeight;
        output[target + channel] = Math.round(top * (1 - yWeight) + bottom * yWeight);
      }
    }
  }
  return output;
}

function defaultPrivateCanvasFactory(
  width: number,
  height: number
): StudioCompanionReferencePrivateCanvas {
  if (typeof globalThis.OffscreenCanvas === "function") {
    return new globalThis.OffscreenCanvas(width, height) as StudioCompanionReferencePrivateCanvas;
  }
  if (!globalThis.document) throw new Error("Private reference canvas is unavailable");
  const canvas = globalThis.document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas as StudioCompanionReferencePrivateCanvas;
}

/**
 * Takes ownership of a freshly decoded raster, normalizes it into a private canvas, then clears the
 * original RGBA regardless of success. The returned source is released by the demand runtime.
 */
export function normalizeStudioCompanionReferenceRaster(
  raster: StudioReferenceImageRaster,
  maximumOutputPixels: number,
  createCanvas: StudioCompanionReferencePrivateCanvasFactory = defaultPrivateCanvasFactory
): StudioCompanionReferenceDecodedSource | null {
  const normalized = normalizeStudioCompanionReferenceRasterPixels(raster, maximumOutputPixels);
  return normalized ? materializeStudioCompanionReferenceRaster(normalized, createCanvas) : null;
}

function normalizeStudioCompanionReferenceRasterPixels(
  raster: StudioReferenceImageRaster,
  maximumOutputPixels: number
): StudioReferenceImageRaster | null {
  const pixelCount = raster.width * raster.height;
  if (
    !positiveSafeInteger(raster.width)
    || !positiveSafeInteger(raster.height)
    || !Number.isSafeInteger(pixelCount)
    || pixelCount > STUDIO_COMPANION_REFERENCE_SOURCE_MAX_DECODED_PIXELS
    || !arrayBufferBackedPixels(raster.data, pixelCount * 4)
  ) return null;

  try {
    const dimensions = fitStudioCompanionReferenceSourceDimensions(
      raster.width,
      raster.height,
      maximumOutputPixels
    );
    if (!dimensions) return null;
    const normalizedPixels = bilinearRgba(
      raster.data,
      raster.width,
      raster.height,
      dimensions.width,
      dimensions.height
    );
    return { width: dimensions.width, height: dimensions.height, data: normalizedPixels };
  } catch {
    return null;
  } finally {
    safeFillZero(raster.data);
  }
}

function materializeStudioCompanionReferenceRaster(
  raster: StudioReferenceImageRaster,
  createCanvas: StudioCompanionReferencePrivateCanvasFactory = defaultPrivateCanvasFactory
): StudioCompanionReferenceDecodedSource | null {
  let canvas: StudioCompanionReferencePrivateCanvas | null = null;
  let succeeded = false;
  try {
    canvas = createCanvas(raster.width, raster.height);
    if (!canvas || typeof canvas !== "object") return null;
    canvas.width = raster.width;
    canvas.height = raster.height;
    const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
    if (!context) return null;
    const imageData = context.createImageData(raster.width, raster.height);
    imageData.data.set(raster.data);
    context.putImageData(imageData, 0, 0);

    let released = false;
    const ownedCanvas = canvas;
    const ownedPixels = raster.data;
    succeeded = true;
    return {
      drawable: ownedCanvas,
      width: raster.width,
      height: raster.height,
      pixels: ownedPixels,
      release: () => {
        if (released) return;
        released = true;
        safeFillZero(ownedPixels);
        releaseCanvas(ownedCanvas);
      },
    };
  } catch {
    return null;
  } finally {
    if (!succeeded) {
      safeFillZero(raster.data);
      if (canvas) releaseCanvas(canvas);
    }
  }
}

async function loadDefaultDependencies(): Promise<StudioCompanionReferenceSourceDependencies> {
  const [assetLibrary, referenceBoard, colorSampler, rasterWorker] = await Promise.all([
    import("@/src/domains/creator/studio-asset-library"),
    import("@/src/domains/creator/studio-reference-board"),
    import("@/src/domains/creator/studio-reference-color-sampler"),
    import("./studio-companion-reference-raster-worker-client"),
  ]);
  const processor = rasterWorker.createStudioCompanionReferenceRasterWorkerProcessor({
    fallbackHashDataUrl: assetLibrary.hashStudioAssetDataUrl,
    fallbackNormalizeRaster: (raster, maximumOutputPixels) => {
      const normalized = normalizeStudioCompanionReferenceRasterPixels({
        width: raster.width,
        height: raster.height,
        data: raster.pixels,
      }, maximumOutputPixels);
      return normalized
        ? { width: normalized.width, height: normalized.height, pixels: normalized.data }
        : null;
    },
  });
  return {
    parseDocument: referenceBoard.parseStudioReferenceBoardDocument,
    findAssetCandidates: (descriptors, signal) => (
      assetLibrary.findStudioAssetCandidatesByContentIdentities(
        descriptors.map((descriptor) => ({
          contentHash: descriptor.sha256,
          assetId: descriptor.assetId,
        })),
        signal
      )
    ),
    canonicalizeContentHash: assetLibrary.canonicalizeStudioAssetContentHash,
    hashDataUrl: processor.hashDataUrl,
    decodeAsset: async (asset, request) => {
      if (request.signal.aborted) return null;
      const raster = await colorSampler.loadStudioReferenceImageRaster(asset.dataUrl, {
        signal: request.signal,
        maximumPixels: request.maximumDecodedPixels,
      });
      const normalized = await processor.normalizeRaster({
        width: raster.width,
        height: raster.height,
        pixels: raster.data,
      }, request.maximumOutputPixels, request.signal);
      return normalized
        ? materializeStudioCompanionReferenceRaster({
            width: normalized.width,
            height: normalized.height,
            data: normalized.pixels,
          })
        : null;
    },
    release: processor.release,
  };
}

function snapshotAsset(value: unknown): AssetCandidate | null {
  if (!value || typeof value !== "object") return null;
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const id = descriptors.id?.value as unknown;
    const name = descriptors.name?.value as unknown;
    const dataUrl = descriptors.dataUrl?.value as unknown;
    const contentHash = descriptors.contentHash?.value as unknown;
    const width = descriptors.width?.value as unknown;
    const height = descriptors.height?.value as unknown;
    const createdAt = descriptors.createdAt?.value as unknown;
    const kind = descriptors.kind?.value as unknown;
    if (
      typeof id !== "string"
      || id.length < 1
      || id.length > 512
      || typeof name !== "string"
      || typeof dataUrl !== "string"
      || dataUrl.length < 1
      || dataUrl.length > STUDIO_COMPANION_REFERENCE_SOURCE_MAX_DATA_URL_CHARS
      || !/^data:image\/(?:gif|jpeg|png|webp)(?:;|,)/iu.test(dataUrl)
      || !finitePositive(width)
      || !finitePositive(height)
      || typeof createdAt !== "number"
      || !Number.isFinite(createdAt)
      || (kind !== undefined && typeof kind !== "string")
      || (contentHash !== undefined && typeof contentHash !== "string")
    ) return null;
    const source: StudioAsset = Object.freeze({
      id,
      name,
      dataUrl,
      width,
      height,
      createdAt,
      ...(typeof kind === "string" ? { kind } : {}),
      ...(typeof contentHash === "string"
        ? { contentHash: contentHash as `sha256:${string}` }
        : {}),
    });
    return Object.freeze({
      source,
      id,
      dataUrl,
      ...(typeof contentHash === "string" ? { contentHash } : {}),
    });
  } catch {
    return null;
  }
}

function orderedCandidates(
  assets: readonly AssetCandidate[],
  descriptor: StudioReferenceBoardItem["asset"],
  allowedAssetIds: ReadonlySet<string>,
  canonicalize: (value: unknown) => string | null
): AssetCandidate[] {
  const hashMatches: AssetCandidate[] = [];
  const idFallbacks: AssetCandidate[] = [];
  for (const asset of assets) {
    const canonicalHash = (() => {
      try {
        return canonicalize(asset.contentHash);
      } catch {
        return null;
      }
    })();
    if (canonicalHash === descriptor.sha256) hashMatches.push(asset);
    else if (allowedAssetIds.has(asset.id)) idFallbacks.push(asset);
  }
  return [...hashMatches, ...idFallbacks];
}

function validDecodedSource(
  value: StudioCompanionReferenceDecodedSource | null,
  maximumOutputPixels: number
): value is StudioCompanionReferenceDecodedSource {
  if (!value || typeof value !== "object") return false;
  try {
    const pixels = value.width * value.height;
    return Boolean(
      value.drawable
      && typeof value.drawable === "object"
      && positiveSafeInteger(value.width)
      && positiveSafeInteger(value.height)
      && value.width <= STUDIO_COMPANION_REFERENCE_SOURCE_WIDTH
      && value.height <= STUDIO_COMPANION_REFERENCE_SOURCE_HEIGHT
      && Number.isSafeInteger(pixels)
      && pixels <= maximumOutputPixels
      && arrayBufferBackedPixels(value.pixels, pixels * 4)
      && (value.release === undefined || typeof value.release === "function")
    );
  } catch {
    return false;
  }
}

async function resolveSource(
  descriptor: StudioReferenceBoardItem["asset"],
  foundAssets: readonly StudioAsset[],
  allowedAssetIds: ReadonlySet<string>,
  dependencies: StudioCompanionReferenceSourceDependencies,
  request: StudioCompanionReferenceDecodeRequest
): Promise<StudioCompanionReferenceDecodedSource | null> {
  if (request.signal.aborted) return null;
  const assets = foundAssets.flatMap((asset) => {
    const snapshot = snapshotAsset(asset);
    return snapshot ? [snapshot] : [];
  });
  if (request.signal.aborted) return null;
  const candidates = orderedCandidates(
    assets,
    descriptor,
    allowedAssetIds,
    dependencies.canonicalizeContentHash
  );
  for (const candidate of candidates) {
    if (request.signal.aborted) return null;
    const actualHash = await (async () => {
      try {
        const hashed = await awaitWithAbort(
          Promise.resolve().then(() => (
            dependencies.hashDataUrl(candidate.dataUrl, request.signal)
          )),
          request.signal
        );
        return hashed === ABORTED_AWAIT
          ? null
          : dependencies.canonicalizeContentHash(hashed);
      } catch {
        return null;
      }
    })();
    if (actualHash !== descriptor.sha256 || request.signal.aborted) continue;
    const decoded = await (async () => {
      try {
        const result = await awaitWithAbort(
          Promise.resolve().then(() => dependencies.decodeAsset(candidate.source, request)),
          request.signal,
          (lateSource) => {
            if (lateSource) releaseDecodedSource(lateSource);
          }
        );
        return result === ABORTED_AWAIT ? null : result;
      } catch {
        return null;
      }
    })();
    if (validDecodedSource(decoded, request.maximumOutputPixels)) return decoded;
    if (decoded) releaseDecodedSource(decoded);
  }
  return null;
}

function layoutDimensions(
  item: StudioReferenceBoardItem,
  source: StudioCompanionReferenceDecodedSource
): Pick<StudioCompanionReferencePreviewSource, "layoutWidth" | "layoutHeight"> {
  return item.asset.width !== undefined && item.asset.height !== undefined
    ? { layoutWidth: item.asset.width, layoutHeight: item.asset.height }
    : { layoutWidth: source.width, layoutHeight: source.height };
}

function createOwnedSnapshot(
  document: StudioReferenceBoardDocument,
  items: readonly StudioCompanionReferencePreviewItem[],
  sources: ReadonlySet<StudioCompanionReferenceDecodedSource>
): OwnedSnapshot {
  const samplingInput = Object.freeze({
    boardWidth: STUDIO_COMPANION_REFERENCE_SOURCE_WIDTH,
    boardHeight: STUDIO_COMPANION_REFERENCE_SOURCE_HEIGHT,
    items: Object.freeze([...items]),
  });
  const resolvedItemCount = items.reduce(
    (count, item) => count + (item.source === null ? 0 : 1),
    0
  );
  const publicSnapshot = Object.freeze({
    boardWidth: STUDIO_COMPANION_REFERENCE_SOURCE_WIDTH,
    boardHeight: STUDIO_COMPANION_REFERENCE_SOURCE_HEIGHT,
    itemCount: document.items.length,
    resolvedItemCount,
    canPickColor: resolvedItemCount > 0,
    previewInput: samplingInput,
    colorSamplingInput: samplingInput,
  }) satisfies StudioCompanionReferenceSourceSnapshot;
  let released = false;
  return {
    publicSnapshot,
    release: () => {
      if (released) return;
      released = true;
      for (const source of sources) releaseDecodedSource(source);
    },
  };
}

function emptyReadySnapshot(document: StudioReferenceBoardDocument): OwnedSnapshot {
  return createOwnedSnapshot(document, document.items.map((item) => Object.freeze({
    source: null,
    view: Object.freeze({ ...item.view }),
  })), new Set());
}

/** Creates one epoch-fenced runtime. A later demand call always invalidates earlier async work. */
export function createStudioCompanionReferenceSourceRuntime(
  options: StudioCompanionReferenceSourceRuntimeOptions = {}
): StudioCompanionReferenceSourceRuntime {
  const loadDependencies = options.loadDependencies ?? loadDefaultDependencies;
  let epoch = 0;
  let controller: AbortController | null = null;
  let ownedSnapshot: OwnedSnapshot | null = null;
  let ownedDependencyScope: OwnedDependencyScope | null = null;
  let ownedCallerAbortScope: OwnedCallerAbortScope | null = null;

  const releaseCallerAbortScope = (scope: OwnedCallerAbortScope | null) => {
    if (!scope || scope.released) return;
    scope.released = true;
    if (ownedCallerAbortScope === scope) ownedCallerAbortScope = null;
    scope.release();
  };

  const releaseDependencyScope = (scope: OwnedDependencyScope | null) => {
    if (!scope || scope.released) return;
    scope.released = true;
    if (ownedDependencyScope === scope) ownedDependencyScope = null;
    try {
      scope.release?.();
    } catch {
      // A dependency adapter cannot retain the demand even when its cleanup hook fails.
    }
  };

  const releaseCurrent = () => {
    ownedSnapshot?.release();
    ownedSnapshot = null;
  };

  const release = () => {
    epoch += 1;
    controller?.abort();
    controller = null;
    const callerAbortScope = ownedCallerAbortScope;
    ownedCallerAbortScope = null;
    releaseCallerAbortScope(callerAbortScope);
    const dependencyScope = ownedDependencyScope;
    ownedDependencyScope = null;
    releaseDependencyScope(dependencyScope);
    releaseCurrent();
  };

  const setDemand = async (
    demand: StudioCompanionReferenceSourceDemand
  ): Promise<StudioCompanionReferenceSourceDemandResult> => {
    release();
    if (demand.active !== true) return { status: "inactive", snapshot: null };

    const ownEpoch = epoch;
    const ownController = new AbortController();
    controller = ownController;
    const abortFromCaller = () => ownController.abort();
    const callerAbortScope: OwnedCallerAbortScope = {
      epoch: ownEpoch,
      released: false,
      release: () => {
        if (!demand.signal) return;
        try {
          demand.signal.removeEventListener("abort", abortFromCaller);
        } catch {
          // A detached WebView signal cannot retain ownership of this demand.
        }
      },
    };
    ownedCallerAbortScope = callerAbortScope;
    if (demand.signal) {
      try {
        demand.signal.addEventListener("abort", abortFromCaller, { once: true });
        if (demand.signal.aborted) ownController.abort();
      } catch {
        ownController.abort();
      }
    }
    if (ownController.signal.aborted) {
      releaseCallerAbortScope(callerAbortScope);
      if (epoch === ownEpoch) controller = null;
      return { status: "stale", snapshot: null };
    }

    let dependencies: StudioCompanionReferenceSourceDependencies;
    try {
      const loaded = await awaitWithAbort(
        Promise.resolve().then(loadDependencies),
        ownController.signal,
        (lateDependencies) => {
          const lateScope: OwnedDependencyScope = {
            epoch: ownEpoch,
            release: lateDependencies.release ?? null,
            released: false,
          };
          releaseDependencyScope(lateScope);
        }
      );
      if (loaded === ABORTED_AWAIT) {
        releaseCallerAbortScope(callerAbortScope);
        if (epoch === ownEpoch) controller = null;
        return { status: "stale", snapshot: null };
      }
      dependencies = loaded;
    } catch {
      releaseCallerAbortScope(callerAbortScope);
      if (epoch === ownEpoch) controller = null;
      return epoch === ownEpoch && !ownController.signal.aborted
        ? { status: "unavailable", snapshot: null }
        : { status: "stale", snapshot: null };
    }
    const dependencyScope: OwnedDependencyScope = {
      epoch: ownEpoch,
      release: dependencies.release ?? null,
      released: false,
    };
    if (epoch !== ownEpoch || ownController.signal.aborted) {
      releaseDependencyScope(dependencyScope);
      releaseCallerAbortScope(callerAbortScope);
      if (epoch === ownEpoch) controller = null;
      return { status: "stale", snapshot: null };
    }
    ownedDependencyScope = dependencyScope;

    const document = (() => {
      try {
        return dependencies.parseDocument(demand.document);
      } catch {
        return null;
      }
    })();
    if (!document) {
      releaseDependencyScope(dependencyScope);
      releaseCallerAbortScope(callerAbortScope);
      if (epoch === ownEpoch) controller = null;
      return epoch === ownEpoch && !ownController.signal.aborted
        ? { status: "unavailable", snapshot: null }
        : { status: "stale", snapshot: null };
    }
    if (document.items.length === 0) {
      const empty = emptyReadySnapshot(document);
      releaseCallerAbortScope(callerAbortScope);
      if (epoch !== ownEpoch || ownController.signal.aborted) {
        empty.release();
        if (epoch === ownEpoch) controller = null;
        return { status: "stale", snapshot: null };
      }
      controller = null;
      ownedSnapshot = empty;
      return { status: "ready", snapshot: empty.publicSnapshot };
    }

    // Extract the bounded canonical descriptors before any IndexedDB access. Equal hashes share
    // one lookup/decode; when duplicate items disagree on their local id hint, prefer a usable id.
    const lookupDescriptors = new Map<
      StudioReferenceBoardSha256,
      StudioReferenceBoardItem["asset"]
    >();
    const lookupAssetIds = new Map<StudioReferenceBoardSha256, Set<string>>();
    for (const item of document.items) {
      const current = lookupDescriptors.get(item.asset.sha256);
      if (!current || (!current.assetId && item.asset.assetId)) {
        lookupDescriptors.set(item.asset.sha256, item.asset);
      }
      if (item.asset.assetId) {
        const assetIds = lookupAssetIds.get(item.asset.sha256) ?? new Set<string>();
        assetIds.add(item.asset.assetId);
        lookupAssetIds.set(item.asset.sha256, assetIds);
      }
    }
    const batchLookupDescriptors = [...lookupDescriptors.entries()].flatMap(
      ([sha256, descriptor]) => {
        const assetIds = [...(lookupAssetIds.get(sha256) ?? [])];
        return assetIds.length > 0
          ? assetIds.map((assetId) => ({ ...descriptor, assetId }))
          : [descriptor];
      }
    );

    const candidateBatchResult = await (async () => {
      try {
        return await awaitWithAbort(
          Promise.resolve().then(() => dependencies.findAssetCandidates(
            batchLookupDescriptors,
            ownController.signal
          )),
          ownController.signal
        );
      } catch {
        return new Map<string, readonly StudioAsset[]>();
      }
    })();
    if (candidateBatchResult === ABORTED_AWAIT) {
      releaseDependencyScope(dependencyScope);
      releaseCallerAbortScope(callerAbortScope);
      if (epoch === ownEpoch) controller = null;
      return { status: "stale", snapshot: null };
    }
    const candidateBatch = candidateBatchResult;

    const maximumOutputPixels = Math.max(
      1,
      Math.floor(
        STUDIO_COMPANION_REFERENCE_SOURCE_MAX_RGBA_BYTES
          / 4
          / Math.max(1, document.items.length)
      )
    );
    const decodeRequest: StudioCompanionReferenceDecodeRequest = {
      signal: ownController.signal,
      maximumDecodedPixels: STUDIO_COMPANION_REFERENCE_SOURCE_MAX_DECODED_PIXELS,
      maximumOutputPixels,
      maximumWidth: STUDIO_COMPANION_REFERENCE_SOURCE_WIDTH,
      maximumHeight: STUDIO_COMPANION_REFERENCE_SOURCE_HEIGHT,
    };
    const sourcesByHash = new Map<
      StudioReferenceBoardSha256,
      StudioCompanionReferenceDecodedSource | null
    >();
    const ownedSources = new Set<StudioCompanionReferenceDecodedSource>();
    const previewItems: StudioCompanionReferencePreviewItem[] = [];

    for (const item of document.items) {
      if (epoch !== ownEpoch || ownController.signal.aborted) break;
      let decoded = sourcesByHash.get(item.asset.sha256);
      if (!sourcesByHash.has(item.asset.sha256)) {
        decoded = await resolveSource(
          lookupDescriptors.get(item.asset.sha256) ?? item.asset,
          candidateBatch.get(item.asset.sha256) ?? [],
          lookupAssetIds.get(item.asset.sha256) ?? new Set<string>(),
          dependencies,
          decodeRequest
        );
        sourcesByHash.set(item.asset.sha256, decoded ?? null);
        if (decoded) ownedSources.add(decoded);
      }
      const source: StudioCompanionReferencePreviewSource | null = decoded
        ? Object.freeze({
            drawable: decoded.drawable,
            width: decoded.width,
            height: decoded.height,
            pixels: decoded.pixels,
            ...layoutDimensions(item, decoded),
          })
        : null;
      previewItems.push(Object.freeze({
        source,
        view: Object.freeze({ ...item.view }),
      }));
    }

    releaseCallerAbortScope(callerAbortScope);
    if (
      epoch !== ownEpoch
      || ownController.signal.aborted
      || previewItems.length !== document.items.length
    ) {
      for (const source of ownedSources) releaseDecodedSource(source);
      releaseDependencyScope(dependencyScope);
      if (epoch === ownEpoch) controller = null;
      return { status: "stale", snapshot: null };
    }

    const nextSnapshot = createOwnedSnapshot(document, previewItems, ownedSources);
    if (epoch !== ownEpoch || ownController.signal.aborted) {
      nextSnapshot.release();
      releaseDependencyScope(dependencyScope);
      if (epoch === ownEpoch) controller = null;
      return { status: "stale", snapshot: null };
    }
    controller = null;
    ownedSnapshot = nextSnapshot;
    return { status: "ready", snapshot: nextSnapshot.publicSnapshot };
  };

  return Object.freeze({
    setDemand,
    current: () => ownedSnapshot?.publicSnapshot ?? null,
    release,
  });
}
