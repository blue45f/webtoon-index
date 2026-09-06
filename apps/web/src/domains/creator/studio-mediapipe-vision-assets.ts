/**
 * MediaPipe Vision 0.10.35의 package-matched WASM 자산 권위.
 *
 * Studio의 프로덕션 CSP는 외부 script/WASM 실행을 허용하지 않는다. 모든 3D 추적·사진
 * 포즈·전경 분리가 동일한 Vite hashed same-origin 자산을 사용해야 화면별 성공/실패가
 * 갈리지 않는다. Task singleton은 각 기능이 독립 소유하고 이 모듈은 URL만 제공한다.
 */

export type StudioMediaPipeVisionWasmVariant = "simd" | "nosimd";
export type StudioMediaPipeVisionDelegate = "GPU" | "CPU";
export type StudioMediaPipeVisionProviderSelection =
  | "product-default-gpu"
  | "explicit-before-execution";

export interface StudioMediaPipeVisionWasmFileset {
  readonly wasmLoaderPath: string;
  readonly wasmBinaryPath: string;
}

export interface StudioMediaPipeVisionWasmSelection {
  readonly variant: StudioMediaPipeVisionWasmVariant;
  readonly fileset: StudioMediaPipeVisionWasmFileset;
  readonly selectionSource: "simd-capability-probe";
  /** The selected variant is loaded exactly once; a failed load never changes this tuple. */
  readonly attemptedVariants: readonly [StudioMediaPipeVisionWasmVariant];
}

export type StudioMediaPipeVisionFilesetLoader = () => Promise<
  StudioMediaPipeVisionWasmFileset
>;

export interface StudioMediaPipeVisionAssetResolverOptions {
  readonly isSimdSupported: () => Promise<boolean>;
  /** 테스트/호스트 주입 경계. 앱에서는 지정하지 않는다. */
  readonly loadSimd?: StudioMediaPipeVisionFilesetLoader;
  /** 테스트/호스트 주입 경계. 앱에서는 지정하지 않는다. */
  readonly loadNoSimd?: StudioMediaPipeVisionFilesetLoader;
}

function namedAssetError(message: string, causes: readonly unknown[]): Error {
  const error = new AggregateError(causes, message, { cause: causes.at(-1) });
  error.name = "StudioMediaPipeVisionWasmLoadError";
  return error;
}

function assertLocalFileset(
  fileset: StudioMediaPipeVisionWasmFileset,
): StudioMediaPipeVisionWasmFileset {
  if (
    !fileset
    || typeof fileset.wasmLoaderPath !== "string"
    || fileset.wasmLoaderPath.length === 0
    || typeof fileset.wasmBinaryPath !== "string"
    || fileset.wasmBinaryPath.length === 0
  ) {
    throw new TypeError("MediaPipe Vision WASM 자산 경로가 비어 있습니다.");
  }
  return Object.freeze({
    wasmLoaderPath: fileset.wasmLoaderPath,
    wasmBinaryPath: fileset.wasmBinaryPath,
  });
}

async function loadBundledSimdFileset(): Promise<StudioMediaPipeVisionWasmFileset> {
  const [loaderModule, binaryModule] = await Promise.all([
    import("@mediapipe/tasks-vision/vision_wasm_internal.js?url"),
    import("@mediapipe/tasks-vision/vision_wasm_internal.wasm?url"),
  ]);
  return assertLocalFileset({
    wasmLoaderPath: loaderModule.default,
    wasmBinaryPath: binaryModule.default,
  });
}

async function loadBundledNoSimdFileset(): Promise<StudioMediaPipeVisionWasmFileset> {
  const [loaderModule, binaryModule] = await Promise.all([
    import("@mediapipe/tasks-vision/vision_wasm_nosimd_internal.js?url"),
    import("@mediapipe/tasks-vision/vision_wasm_nosimd_internal.wasm?url"),
  ]);
  return assertLocalFileset({
    wasmLoaderPath: loaderModule.default,
    wasmBinaryPath: binaryModule.default,
  });
}

/** Probe once, select one variant before loading, and fail closed if either step fails. */
export async function resolveStudioMediaPipeVisionWasmFileset(
  options: StudioMediaPipeVisionAssetResolverOptions,
): Promise<StudioMediaPipeVisionWasmSelection> {
  const loadSimd = options.loadSimd ?? loadBundledSimdFileset;
  const loadNoSimd = options.loadNoSimd ?? loadBundledNoSimdFileset;
  let simdSupported: boolean;
  try {
    simdSupported = await options.isSimdSupported();
  } catch (cause) {
    throw namedAssetError(
      "Studio가 MediaPipe Vision SIMD 지원 여부를 확인하지 못했습니다.",
      [cause],
    );
  }
  if (typeof simdSupported !== "boolean") {
    throw namedAssetError(
      "Studio가 잘못된 MediaPipe Vision SIMD capability 결과를 받았습니다.",
      [new TypeError("MediaPipe Vision SIMD capability must be boolean.")],
    );
  }

  const variant: StudioMediaPipeVisionWasmVariant = simdSupported ? "simd" : "nosimd";
  const loadSelected = variant === "simd" ? loadSimd : loadNoSimd;
  try {
    return Object.freeze({
      variant,
      fileset: assertLocalFileset(await loadSelected()),
      selectionSource: "simd-capability-probe",
      attemptedVariants: Object.freeze([variant]) as readonly [
        StudioMediaPipeVisionWasmVariant,
      ],
    });
  } catch (cause) {
    throw namedAssetError(
      `Studio의 선택된 ${variant} MediaPipe Vision WASM 자산을 불러오지 못했습니다.`,
      [cause],
    );
  }
}
