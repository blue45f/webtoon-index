/**
 * Production bridge from the strict Scene Layer Lift provider to the existing
 * on-device MediaPipe foreground segmenter. Source pixels stay inside the
 * browser; only the versioned model and WASM runtime are downloaded.
 */
import type {
  StudioLocalForegroundDelegate,
  StudioLocalForegroundSegmenterRuntime,
} from "../studio-bg-remove";
import type {
  StudioLayerLiftLocalForegroundInferenceEngine,
  StudioLayerLiftLocalForegroundInferenceInput,
  StudioLayerLiftLocalForegroundInferenceLoader,
} from "./studio-layer-lift-local-provider";

export interface StudioLayerLiftMediaPipeRaster {
  readonly source: TexImageSource;
  dispose?(): void;
}

export type StudioLayerLiftMediaPipeRasterFactory = (
  input: StudioLayerLiftLocalForegroundInferenceInput,
) => StudioLayerLiftMediaPipeRaster;

export interface CreateStudioLayerLiftMediaPipeInferenceLoaderOptions {
  /** Fixed before the Layer Lift request begins. Omission selects the GPU product provider. */
  readonly delegate?: StudioLocalForegroundDelegate;
  readonly loadRuntime?: () => Promise<StudioLocalForegroundSegmenterRuntime>;
  readonly createRaster?: StudioLayerLiftMediaPipeRasterFactory;
}

function createAbortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("레이어 분석을 취소했습니다.", "AbortError");
  }
  const error = new Error("레이어 분석을 취소했습니다.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw createAbortError();
}

function writeRgba(
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  input: StudioLayerLiftLocalForegroundInferenceInput,
): void {
  const imageData = context.createImageData(input.width, input.height);
  imageData.data.set(input.rgba);
  context.putImageData(imageData, 0, 0);
}

function createBrowserRaster(
  input: StudioLayerLiftLocalForegroundInferenceInput,
): StudioLayerLiftMediaPipeRaster {
  if (typeof globalThis.OffscreenCanvas === "function") {
    const canvas = new OffscreenCanvas(input.width, input.height);
    const context = canvas.getContext("2d", {
      alpha: true,
      colorSpace: "srgb",
      willReadFrequently: false,
    });
    if (!context) {
      throw new Error("OffscreenCanvas 2D 컨텍스트를 만들 수 없습니다.");
    }
    writeRgba(context, input);
    return Object.freeze({ source: canvas });
  }

  if (typeof document === "object") {
    const canvas = document.createElement("canvas");
    canvas.width = input.width;
    canvas.height = input.height;
    const context = canvas.getContext("2d", {
      alpha: true,
      colorSpace: "srgb",
      willReadFrequently: false,
    });
    if (!context) throw new Error("캔버스 2D 컨텍스트를 만들 수 없습니다.");
    writeRgba(context, input);
    return Object.freeze({ source: canvas });
  }

  throw new Error("로컬 전경 분석용 래스터 표면을 만들 수 없습니다.");
}

function modelIdentity(
  runtime: StudioLocalForegroundSegmenterRuntime,
): StudioLayerLiftLocalForegroundInferenceEngine["model"] {
  return Object.freeze({
    providerId: "mediapipe-image-segmenter",
    providerVersion: "0.10.35",
    modelId: "selfie-segmenter",
    modelVersion: "float16-latest",
    executionRoute: runtime.activeDelegate === "GPU" ? "gpu" : "cpu-explicit",
  });
}

function createInferenceEngine(
  runtime: StudioLocalForegroundSegmenterRuntime,
  createRaster: StudioLayerLiftMediaPipeRasterFactory,
  segmentRaster: typeof import("../studio-bg-remove")["segmentStudioLocalForegroundRasterSource"],
): StudioLayerLiftLocalForegroundInferenceEngine {
  return Object.freeze({
    model: modelIdentity(runtime),
    async infer(input: StudioLayerLiftLocalForegroundInferenceInput) {
      throwIfAborted(input.signal);
      const raster = createRaster(input);
      try {
        throwIfAborted(input.signal);
        const result = segmentRaster(
          raster.source,
          input.width,
          input.height,
          runtime,
          input.signal,
        );
        throwIfAborted(input.signal);
        return Object.freeze({
          width: result.width,
          height: result.height,
          confidence: result.confidence,
        });
      } finally {
        raster.dispose?.();
      }
    },
  });
}

/**
 * Create a lazy production loader whose delegate identity is fixed before inference begins.
 */
export function createStudioLayerLiftMediaPipeInferenceLoader(
  options: CreateStudioLayerLiftMediaPipeInferenceLoaderOptions = {},
): StudioLayerLiftLocalForegroundInferenceLoader {
  const selectedDelegate = options.delegate ?? "GPU";
  const expectedSelection = options.delegate === undefined
    ? "product-default-gpu"
    : "explicit-before-execution";
  const createRaster = options.createRaster ?? createBrowserRaster;

  return async (signal) => {
    throwIfAborted(signal);
    // Layer Lift is explicit user work. Importing the segmenter here keeps the MediaPipe
    // arbiter, WASM resolver, and foreground compositor outside the Studio startup graph.
    const foreground = await import("../studio-bg-remove");
    const loadRuntime = options.loadRuntime ?? (() => (
      options.delegate === undefined
        ? foreground.getStudioLocalForegroundSegmenterRuntime()
        : foreground.getStudioLocalForegroundSegmenterRuntime({
            delegate: selectedDelegate,
          })
    ));
    const runtime = await loadRuntime();
    throwIfAborted(signal);
    if (
      runtime.selectedDelegate !== selectedDelegate
      || runtime.activeDelegate !== selectedDelegate
      || runtime.providerSelection !== expectedSelection
      || runtime.attemptedDelegates.length !== 1
      || runtime.attemptedDelegates[0] !== selectedDelegate
    ) {
      throw new Error("Layer Lift MediaPipe delegate identity mismatch.");
    }
    return createInferenceEngine(
      runtime,
      createRaster,
      foreground.segmentStudioLocalForegroundRasterSource,
    );
  };
}

export const loadStudioLayerLiftMediaPipeInference =
  createStudioLayerLiftMediaPipeInferenceLoader();
