// AI 배경 제거 — 이미지 픽셀은 브라우저 안에서만 MediaPipe에 전달한다.
// 모델은 지연 로드하고 WASM은 Studio와 같은 출처의 Vite hashed 자산을 사용한다.
import {
  resolveStudioMediaPipeVisionWasmFileset,
  type StudioMediaPipeVisionDelegate,
  type StudioMediaPipeVisionProviderSelection,
} from "./studio-mediapipe-vision-assets";
import {
  loadStudioMediaPipeVisionModule,
  runStudioMediaPipeVisionTaskCreation,
} from "./studio-mediapipe-vision-init-arbiter";

const SELFIE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";

export const STUDIO_BG_REMOVE_MAX_DECODED_AXIS = 8_192;
export const STUDIO_BG_REMOVE_MAX_DECODED_PIXELS = 16_777_216;

export type StudioLocalForegroundDelegate = StudioMediaPipeVisionDelegate;

export interface StudioLocalForegroundModelReceipt {
  readonly providerId: "mediapipe-image-segmenter";
  readonly providerVersion: "0.10.35";
  readonly model: Readonly<{
    readonly id: "selfie-segmenter";
    readonly format: "tflite-float16";
    readonly revision: "latest";
    readonly assetUrl: typeof SELFIE_MODEL_URL;
  }>;
  readonly execution: "local-device";
  readonly imageUpload: false;
  readonly selectedDelegate: StudioLocalForegroundDelegate;
  readonly providerSelection: StudioMediaPipeVisionProviderSelection;
  readonly attemptedDelegates: readonly [StudioLocalForegroundDelegate];
  readonly activeDelegate: StudioLocalForegroundDelegate;
}

export interface StudioForegroundConfidenceMask {
  readonly width: number;
  readonly height: number;
  readonly confidence: Float32Array;
}

export interface StudioLocalForegroundConfidenceMask
  extends StudioForegroundConfidenceMask {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly receipt: StudioLocalForegroundModelReceipt;
}

export interface StudioForegroundMaskResource {
  readonly width: number;
  readonly height: number;
  getAsFloat32Array(): Float32Array;
  close?(): void;
}

export interface StudioForegroundSegmentationResult {
  readonly confidenceMasks?: readonly StudioForegroundMaskResource[];
  readonly categoryMask?: StudioForegroundMaskResource;
  close?(): void;
}

export interface StudioLocalForegroundSegmenter {
  segment(image: TexImageSource): StudioForegroundSegmentationResult;
}

export interface StudioLocalForegroundSegmenterRuntime {
  readonly segmenter: StudioLocalForegroundSegmenter;
  readonly selectedDelegate: StudioLocalForegroundDelegate;
  readonly activeDelegate: StudioLocalForegroundDelegate;
  readonly providerSelection: StudioMediaPipeVisionProviderSelection;
  readonly attemptedDelegates: readonly [StudioLocalForegroundDelegate];
}

export type StudioLocalForegroundImageLoader = (
  src: string,
  signal?: AbortSignal,
) => Promise<HTMLImageElement>;

export type StudioLocalForegroundRuntimeLoader =
  () => Promise<StudioLocalForegroundSegmenterRuntime>;

export interface CreateStudioLocalForegroundConfidenceProviderOptions {
  /** Fixed before image/model work begins. CPU is available only through this explicit option. */
  readonly delegate?: StudioLocalForegroundDelegate;
  /** Dependency seam for decoded-image loading; production uses the DOM Image API. */
  readonly loadImage?: StudioLocalForegroundImageLoader;
  /** Dependency seam for inference; production dynamically imports MediaPipe. */
  readonly loadRuntime?: StudioLocalForegroundRuntimeLoader;
}

export interface StudioLocalForegroundConfidenceOptions {
  readonly signal?: AbortSignal;
}

export interface StudioLocalForegroundConfidenceProvider {
  getForegroundConfidenceMask(
    src: string,
    options?: StudioLocalForegroundConfidenceOptions,
  ): Promise<StudioLocalForegroundConfidenceMask>;
}

export interface StudioForegroundPixelAlphaInput {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly sourceRgba: Uint8Array | Uint8ClampedArray;
  readonly confidenceMask: StudioForegroundConfidenceMask;
  readonly threshold?: number;
}

export interface StudioForegroundPixelAlpha {
  readonly width: number;
  readonly height: number;
  readonly alpha: Uint8ClampedArray;
}

export interface RemoveBackgroundOptions {
  readonly threshold?: number;
  readonly signal?: AbortSignal;
  /** Fixed before decoding/model work. Omission selects the product-default GPU provider. */
  readonly delegate?: StudioLocalForegroundDelegate;
}

const SELFIE_MODEL_RECEIPT = Object.freeze({
  id: "selfie-segmenter",
  format: "tflite-float16",
  revision: "latest",
  assetUrl: SELFIE_MODEL_URL,
} as const);

const segmenterPromises = new Map<
  `${StudioMediaPipeVisionProviderSelection}:${StudioLocalForegroundDelegate}`,
  Promise<StudioLocalForegroundSegmenterRuntime>
>();

function createAbortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("배경 분리를 취소했습니다.", "AbortError");
  }
  const error = new Error("배경 분리를 취소했습니다.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError();
}

function assertImageSource(src: unknown): asserts src is string {
  if (typeof src !== "string" || src.length === 0) {
    throw new TypeError("이미지 주소가 비어 있습니다.");
  }
}

function assertThreshold(value: unknown): number {
  const threshold = value === undefined ? 0.5 : value;
  if (
    typeof threshold !== "number"
    || !Number.isFinite(threshold)
    || threshold < 0
    || threshold > 1
  ) {
    throw new RangeError("배경 분리 임계값은 0과 1 사이의 유한한 수여야 합니다.");
  }
  return threshold;
}

function assertRasterDimensions(
  width: unknown,
  height: unknown,
  label: string,
): number {
  if (
    typeof width !== "number"
    || typeof height !== "number"
    || !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width < 1
    || height < 1
  ) {
    throw new RangeError(`${label} 크기를 확인할 수 없습니다.`);
  }
  if (
    width > STUDIO_BG_REMOVE_MAX_DECODED_AXIS
    || height > STUDIO_BG_REMOVE_MAX_DECODED_AXIS
  ) {
    throw new RangeError(`${label} 한 축이 안전 한도를 초과합니다.`);
  }
  const pixels = width * height;
  if (
    !Number.isSafeInteger(pixels)
    || pixels > STUDIO_BG_REMOVE_MAX_DECODED_PIXELS
  ) {
    throw new RangeError(`${label} 픽셀 수가 안전 한도를 초과합니다.`);
  }
  return pixels;
}

function assertConfidenceBuffer(
  confidence: unknown,
  pixelCount: number,
): asserts confidence is Float32Array {
  if (!(confidence instanceof Float32Array)) {
    throw new TypeError("전경 신뢰도 마스크 형식이 올바르지 않습니다.");
  }
  if (confidence.length !== pixelCount) {
    throw new RangeError("전경 신뢰도 마스크 길이가 크기와 일치하지 않습니다.");
  }
  for (let index = 0; index < confidence.length; index += 1) {
    const value = confidence[index]!;
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError("전경 신뢰도에는 0과 1 사이의 유한한 값만 사용할 수 있습니다.");
    }
  }
}

function modelReceipt(
  runtime: StudioLocalForegroundSegmenterRuntime,
): StudioLocalForegroundModelReceipt {
  if (
    (runtime.selectedDelegate !== "GPU" && runtime.selectedDelegate !== "CPU")
    || runtime.selectedDelegate !== runtime.activeDelegate
    || (
      runtime.providerSelection !== "product-default-gpu"
      && runtime.providerSelection !== "explicit-before-execution"
    )
    || (
      runtime.providerSelection === "product-default-gpu"
      && runtime.activeDelegate !== "GPU"
    )
    || runtime.attemptedDelegates.length !== 1
    || runtime.attemptedDelegates[0] !== runtime.selectedDelegate
    || (
      runtime.activeDelegate === "CPU"
      && runtime.providerSelection !== "explicit-before-execution"
    )
  ) {
    throw new Error("전경 분리 실행 경로 영수증이 올바르지 않습니다.");
  }
  return Object.freeze({
    providerId: "mediapipe-image-segmenter",
    providerVersion: "0.10.35",
    model: SELFIE_MODEL_RECEIPT,
    execution: "local-device",
    imageUpload: false,
    selectedDelegate: runtime.selectedDelegate,
    providerSelection: runtime.providerSelection,
    attemptedDelegates: Object.freeze([
      runtime.attemptedDelegates[0],
    ]) as readonly [StudioLocalForegroundDelegate],
    activeDelegate: runtime.activeDelegate,
  });
}

async function loadMediaPipeRuntime(
  delegate: StudioLocalForegroundDelegate,
  providerSelection: StudioMediaPipeVisionProviderSelection,
): Promise<StudioLocalForegroundSegmenterRuntime> {
  const { FilesetResolver, ImageSegmenter } = await loadStudioMediaPipeVisionModule();
  const { fileset: vision } = await resolveStudioMediaPipeVisionWasmFileset({
    isSimdSupported: () => FilesetResolver.isSimdSupported(false),
  });
  const segmenter = await runStudioMediaPipeVisionTaskCreation({
    owner: "foreground-image-segmenter",
    create: () => ImageSegmenter.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: SELFIE_MODEL_URL,
        delegate,
      },
      runningMode: "IMAGE",
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    }),
  });
  return Object.freeze({
    segmenter,
    selectedDelegate: delegate,
    activeDelegate: delegate,
    providerSelection,
    attemptedDelegates: Object.freeze([delegate]) as readonly [
      StudioLocalForegroundDelegate,
    ],
  });
}

export interface StudioLocalForegroundRuntimeOptions {
  /** Omission is the product-default GPU provider; CPU must be explicit before execution. */
  readonly delegate?: StudioLocalForegroundDelegate;
}

export function getStudioLocalForegroundSegmenterRuntime(
  options: StudioLocalForegroundRuntimeOptions = {},
): Promise<
  StudioLocalForegroundSegmenterRuntime
> {
  const delegate = options.delegate ?? "GPU";
  const providerSelection: StudioMediaPipeVisionProviderSelection =
    options.delegate === undefined
      ? "product-default-gpu"
      : "explicit-before-execution";
  const key = `${providerSelection}:${delegate}` as const;
  const existing = segmenterPromises.get(key);
  if (existing) return existing;
  const pending = loadMediaPipeRuntime(delegate, providerSelection).catch((error: unknown) => {
    if (segmenterPromises.get(key) === pending) segmenterPromises.delete(key);
    throw error;
  });
  segmenterPromises.set(key, pending);
  return pending;
}

function loadImage(
  src: string,
  signal?: AbortSignal,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new globalThis.Image();
    let settled = false;

    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      image.src = "";
      reject(createAbortError());
    };

    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("이미지를 불러오지 못했습니다."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    image.src = src;
  });
}

function closeSegmentationResources(
  result: StudioForegroundSegmentationResult | undefined,
  masks: readonly StudioForegroundMaskResource[],
  categoryMask: StudioForegroundMaskResource | undefined,
): void {
  const uniqueMasks = new Set<StudioForegroundMaskResource>(masks);
  if (categoryMask) uniqueMasks.add(categoryMask);
  for (const mask of uniqueMasks) {
    try {
      mask.close?.();
    } catch {
      // Every remaining resource still gets a close attempt.
    }
  }
  try {
    result?.close?.();
  } catch {
    // Cleanup must not replace the inference/validation outcome.
  }
}

export function segmentStudioLocalForegroundRasterSource(
  image: TexImageSource,
  sourceWidth: number,
  sourceHeight: number,
  runtime: StudioLocalForegroundSegmenterRuntime,
  signal?: AbortSignal,
): StudioLocalForegroundConfidenceMask {
  throwIfAborted(signal);
  let result: StudioForegroundSegmentationResult | undefined;
  let masks: readonly StudioForegroundMaskResource[] = [];
  let categoryMask: StudioForegroundMaskResource | undefined;

  try {
    result = runtime.segmenter.segment(image);
    masks = Array.isArray(result.confidenceMasks)
      ? [...result.confidenceMasks]
      : [];
    categoryMask = result.categoryMask;
    throwIfAborted(signal);

    if (masks.length === 0) {
      throw new Error("배경을 분리하지 못했습니다.");
    }
    const foreground = masks[masks.length - 1]!;
    const pixelCount = assertRasterDimensions(
      foreground.width,
      foreground.height,
      "전경 신뢰도 마스크",
    );
    throwIfAborted(signal);
    const modelConfidence = foreground.getAsFloat32Array();
    assertConfidenceBuffer(modelConfidence, pixelCount);
    throwIfAborted(signal);

    const confidence = new Float32Array(modelConfidence);
    throwIfAborted(signal);
    return Object.freeze({
      width: foreground.width,
      height: foreground.height,
      confidence,
      sourceWidth,
      sourceHeight,
      receipt: modelReceipt(runtime),
    });
  } finally {
    closeSegmentationResources(result, masks, categoryMask);
  }
}

interface SegmentedSource {
  readonly image: HTMLImageElement;
  readonly width: number;
  readonly height: number;
  readonly mask: StudioLocalForegroundConfidenceMask;
}

async function loadAndSegmentSource(
  src: string,
  options: StudioLocalForegroundConfidenceOptions,
  imageLoader: StudioLocalForegroundImageLoader,
  runtimeLoader: StudioLocalForegroundRuntimeLoader,
): Promise<SegmentedSource> {
  assertImageSource(src);
  throwIfAborted(options.signal);
  const decodedImage = imageLoader(src, options.signal).then((image) => {
    throwIfAborted(options.signal);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    assertRasterDimensions(width, height, "디코드된 이미지");
    return Object.freeze({ image, width, height });
  });
  const [loaded, runtime] = await Promise.all([decodedImage, runtimeLoader()]);
  throwIfAborted(options.signal);
  const mask = segmentStudioLocalForegroundRasterSource(
    loaded.image,
    loaded.width,
    loaded.height,
    runtime,
    options.signal,
  );
  return Object.freeze({
    image: loaded.image,
    width: loaded.width,
    height: loaded.height,
    mask,
  });
}

/**
 * Create a reusable local confidence provider. The injectable loaders keep the
 * model/network out of unit tests and leave room for a future cut-layer caller.
 */
export function createStudioLocalForegroundConfidenceProvider(
  options: CreateStudioLocalForegroundConfidenceProviderOptions = {},
): StudioLocalForegroundConfidenceProvider {
  const selectedDelegate = options.delegate ?? "GPU";
  const providerSelection: StudioMediaPipeVisionProviderSelection =
    options.delegate === undefined
      ? "product-default-gpu"
      : "explicit-before-execution";
  const imageLoader = options.loadImage ?? loadImage;
  const loadSelectedRuntime = options.loadRuntime ?? (() => (
    options.delegate === undefined
      ? getStudioLocalForegroundSegmenterRuntime()
      : getStudioLocalForegroundSegmenterRuntime({ delegate: selectedDelegate })
  ));
  const runtimeLoader: StudioLocalForegroundRuntimeLoader = async () => {
    const runtime = await loadSelectedRuntime();
    if (
      runtime.selectedDelegate !== selectedDelegate
      || runtime.activeDelegate !== selectedDelegate
      || runtime.providerSelection !== providerSelection
      || runtime.attemptedDelegates.length !== 1
      || runtime.attemptedDelegates[0] !== selectedDelegate
    ) {
      throw new Error("선택한 전경 분리 delegate와 runtime identity가 일치하지 않습니다.");
    }
    return runtime;
  };
  return Object.freeze({
    async getForegroundConfidenceMask(
      src: string,
      requestOptions: StudioLocalForegroundConfidenceOptions = {},
    ) {
      const segmented = await loadAndSegmentSource(
        src,
        requestOptions,
        imageLoader,
        runtimeLoader,
      );
      return segmented.mask;
    },
  });
}

const defaultLocalForegroundProvider =
  createStudioLocalForegroundConfidenceProvider();

/**
 * Decode and segment an image entirely on-device. Only model/WASM assets may be
 * downloaded; the source pixels are never uploaded by this provider.
 */
export function getLocalForegroundConfidenceMask(
  src: string,
  options: StudioLocalForegroundConfidenceOptions = {},
): Promise<StudioLocalForegroundConfidenceMask> {
  return defaultLocalForegroundProvider.getForegroundConfidenceMask(src, options);
}

/**
 * Pure nearest-neighbour mask resampling and alpha composition.
 * The source's existing alpha is multiplied by model confidence, never replaced.
 */
export function composeForegroundPixelAlpha(
  input: StudioForegroundPixelAlphaInput,
): StudioForegroundPixelAlpha {
  if (input === null || typeof input !== "object") {
    throw new TypeError("전경 알파 합성 입력이 올바르지 않습니다.");
  }
  const threshold = assertThreshold(input.threshold);
  const sourcePixels = assertRasterDimensions(
    input.sourceWidth,
    input.sourceHeight,
    "원본 이미지",
  );
  const sourceRgba = input.sourceRgba;
  if (
    !(sourceRgba instanceof Uint8Array)
    && !(sourceRgba instanceof Uint8ClampedArray)
  ) {
    throw new TypeError("원본 RGBA 버퍼 형식이 올바르지 않습니다.");
  }
  if (sourceRgba.length !== sourcePixels * 4) {
    throw new RangeError("원본 RGBA 버퍼 길이가 이미지 크기와 일치하지 않습니다.");
  }

  const mask = input.confidenceMask;
  if (mask === null || typeof mask !== "object") {
    throw new TypeError("전경 신뢰도 마스크가 올바르지 않습니다.");
  }
  const maskPixels = assertRasterDimensions(
    mask.width,
    mask.height,
    "전경 신뢰도 마스크",
  );
  assertConfidenceBuffer(mask.confidence, maskPixels);

  const alpha = new Uint8ClampedArray(sourcePixels);
  for (let y = 0; y < input.sourceHeight; y += 1) {
    const maskY = Math.min(
      mask.height - 1,
      Math.floor(y * mask.height / input.sourceHeight),
    );
    for (let x = 0; x < input.sourceWidth; x += 1) {
      const sourceIndex = y * input.sourceWidth + x;
      const maskX = Math.min(
        mask.width - 1,
        Math.floor(x * mask.width / input.sourceWidth),
      );
      const confidence = mask.confidence[maskY * mask.width + maskX]!;
      alpha[sourceIndex] = confidence < threshold
        ? 0
        : Math.round(sourceRgba[sourceIndex * 4 + 3]! * confidence);
    }
  }
  return Object.freeze({
    width: input.sourceWidth,
    height: input.sourceHeight,
    alpha,
  });
}

/**
 * Legacy background-removal wrapper: foreground pixels are returned as a PNG
 * data URL. Existing `removeBackground(src, { threshold? })` calls remain valid.
 */
export async function removeBackground(
  src: string,
  options: RemoveBackgroundOptions = {},
): Promise<string> {
  const threshold = assertThreshold(options.threshold);
  const segmented = await loadAndSegmentSource(
    src,
    { signal: options.signal },
    loadImage,
    () => options.delegate === undefined
      ? getStudioLocalForegroundSegmenterRuntime()
      : getStudioLocalForegroundSegmenterRuntime({ delegate: options.delegate }),
  );
  throwIfAborted(options.signal);

  // Dimensions were admitted above, before either canvas or ImageData allocation.
  const canvas = document.createElement("canvas");
  canvas.width = segmented.width;
  canvas.height = segmented.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("캔버스를 만들 수 없습니다.");
  context.drawImage(
    segmented.image,
    0,
    0,
    segmented.width,
    segmented.height,
  );
  const imageData = context.getImageData(
    0,
    0,
    segmented.width,
    segmented.height,
  );
  const foreground = composeForegroundPixelAlpha({
    sourceWidth: segmented.width,
    sourceHeight: segmented.height,
    sourceRgba: imageData.data,
    confidenceMask: segmented.mask,
    threshold,
  });
  for (let index = 0; index < foreground.alpha.length; index += 1) {
    imageData.data[index * 4 + 3] = foreground.alpha[index]!;
  }
  throwIfAborted(options.signal);
  context.putImageData(imageData, 0, 0);
  throwIfAborted(options.signal);
  return canvas.toDataURL("image/png");
}
