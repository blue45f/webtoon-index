// ToonStudio V12 게이트 매트릭스 Large image 행 — 초대형 이미지 최종 내보내기 provider.
//
// 근거(Quality Lab 실측, tests/benchmarks/results/quality-lab.json 2026-08-07):
//   downscale 2048→512에서 wasm-vips lanczos3가 PSNR 27.26dB / SSIM 0.9887로 1위
//   (canvaskit-linear-nomips 25.31dB/0.9834, canvaskit-cubic-mitchell 23.78dB/0.9768).
// 카탈로그: packages/studio-engine-registry/src/filter-providers.ts 의
//   wasm-vips-pipeline descriptor(capabilities: filter.op.resize/pyramid,
//   filter.phase.final 전용, license LGPL-2.1-or-later → isolated 게이트).
//
// 절대 규칙:
// - wasm-vips 는 반드시 dynamic import() 로만 로드한다(번들 게이트가 정적 import 를 잡는다).
// - final/export 레인 전용 — preview 경로에서 호출 금지(descriptor 와 동일).
// - 조용한 손실 금지: 크기 드리프트·버퍼 불일치·로드 실패는 전부 명시적 throw.
//   호출자도 같은 내보내기를 다른 provider로 재실행하지 않는다.

export const STUDIO_VIPS_EXPORT_REVISION = 1 as const;

/** 카탈로그 descriptor id — 테스트가 registry 와의 정합을 검증한다. */
export const STUDIO_VIPS_EXPORT_PROVIDER_ID = "wasm-vips-pipeline" as const;

/** Quality Lab 승자 설정 그대로: libvips resize 기본 커널(lanczos3), 단일 스레드. */
export const STUDIO_VIPS_EXPORT_KERNEL = "lanczos3" as const;
export const STUDIO_VIPS_EXPORT_CONCURRENCY = 1 as const;

/** descriptor 와 동일해야 하는 라이선스 표기 — LGPL 은 isolated 배포 모드 전용. */
export const STUDIO_VIPS_EXPORT_LICENSE = "LGPL-2.1-or-later" as const;
export const STUDIO_VIPS_EXPORT_ATTRIBUTION = "libvips / wasm-vips" as const;

/**
 * 단일 인코어 표면(Canvas2D 슬라이스 합성 레인)의 한 변 상한.
 * 근거: WebGL/WebGPU maxTextureDimension 보수 기준선 8192(이 레포의
 * studio-bg3d-glb-validation.ts 텍스처 상한과 동일)이며, out-of-core provider 의
 * 타일 렌더 예산 maxTileRenderPixels(67,108,864 = 8192²)와 같은 축.
 */
export const STUDIO_VIPS_EXPORT_SINGLE_SURFACE_EDGE_PX = 8192 as const;

/**
 * 단일 인코어 표면 픽셀 예산 — out-of-core 기본 예산 maxTileRenderPixels 와 동일값.
 * 사각형에서는 edge 규칙이 사실상 지배하지만, edge 상한을 기기별로 올려 쓰는 경우
 * (limits 파라미터) 면적 상한이 독립 방어선이 된다.
 */
export const STUDIO_VIPS_EXPORT_SINGLE_SURFACE_PIXELS = 67_108_864 as const;

/**
 * vips 레인이 한 번에 붙잡는 입력 픽셀 상한 = 16384²(1GiB RGBA).
 * 근거: 16384 는 studio-export.ts MAX_CANVAS_DIM(브라우저 캔버스 보수 상한)이고,
 * wasm 32-bit 힙(≈2GiB)에서 소스 사본 + 출력 + 파이프라인 스크래치가 공존하려면
 * 소스가 1GiB 를 넘을 수 없다. 초과분은 타일 기반
 * studio-out-of-core-export-provider 가 소유한다.
 */
export const STUDIO_VIPS_EXPORT_MAX_INPUT_PIXELS = 268_435_456 as const;

/** 피라미드 레벨 상한 — 2^32 를 넘는 축은 존재하지 않으므로 32면 전 범위를 덮는다. */
export const STUDIO_VIPS_EXPORT_MAX_PYRAMID_LEVELS = 32 as const;

/**
 * wasm-vips 로드/초기화 실패. 원인(cause)을 보존해 전달하며, 이 모듈과 호출자 모두
 * 같은 내보내기를 다른 provider로 조용히 대체하지 않는다.
 */
export class VipsUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "VipsUnavailableError";
  }
}

/** wasm-vips 인스턴스의 최소 구조 타입 — 정적 import 없이 호출면만 서술한다. */
interface VipsImageHandle {
  readonly width: number;
  readonly height: number;
  resize(hscale: number, options?: { vscale?: number }): VipsImageHandle;
  writeToMemory(): Uint8Array;
  delete(): void;
}

interface VipsModule {
  Image: {
    newFromMemory(
      data: Uint8Array,
      width: number,
      height: number,
      bands: number,
      format: string,
    ): VipsImageHandle;
  };
  concurrency(threads: number): void;
}

export interface StudioVipsExportRuntime {
  readonly vips: VipsModule;
}

export interface StudioVipsLoadOptions {
  /**
   * 테스트/격리 배포용 주입점. 기본은 dynamic import("wasm-vips").
   * 최초 성공 결과가 캐시되므로 이후 호출의 importVips 는 무시된다.
   */
  readonly importVips?: () => Promise<unknown>;
}

export interface StudioVipsRaster {
  readonly rgba: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface StudioVipsPyramidLevel extends StudioVipsRaster {
  /** 1 = 원본의 1/2, 2 = 1/4 … (원본 레벨 0 은 재표본이 아니므로 포함하지 않는다). */
  readonly level: number;
}

export interface StudioVipsResampleOptions {
  /** 이미 로드된 런타임 재사용(배치 내보내기). 없으면 공유 캐시를 로드한다. */
  readonly runtime?: StudioVipsExportRuntime;
}

export interface StudioVipsExportLimits {
  readonly singleSurfaceEdgePx: number;
  readonly singleSurfacePixels: number;
  readonly maxInputPixels: number;
}

export const STUDIO_VIPS_EXPORT_DEFAULT_LIMITS: StudioVipsExportLimits =
  Object.freeze({
    singleSurfaceEdgePx: STUDIO_VIPS_EXPORT_SINGLE_SURFACE_EDGE_PX,
    singleSurfacePixels: STUDIO_VIPS_EXPORT_SINGLE_SURFACE_PIXELS,
    maxInputPixels: STUDIO_VIPS_EXPORT_MAX_INPUT_PIXELS,
  });

export type StudioVipsExportRouteId = "canvas2d" | "vips" | "out-of-core";

export interface StudioVipsExportRoute {
  readonly route: StudioVipsExportRouteId;
  readonly reason: string;
}

const RGBA_BANDS = 4;
const VIPS_UCHAR_FORMAT = "uchar";

let runtimeCache: Promise<StudioVipsExportRuntime> | null = null;

function defaultImportVips(): Promise<unknown> {
  // 번들 게이트 계약: wasm-vips 는 이 dynamic import 한 곳에서만 등장해야 한다.
  return import("wasm-vips");
}

function isVipsModule(value: unknown): value is VipsModule {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { Image?: unknown; concurrency?: unknown };
  if (typeof candidate.concurrency !== "function") return false;
  // embind 는 Image 를 클래스(function)로 노출한다 — 정적 newFromMemory 만 계약.
  const image = candidate.Image;
  if (
    (typeof image !== "object" && typeof image !== "function")
    || image === null
  ) {
    return false;
  }
  return (
    typeof (image as { newFromMemory?: unknown }).newFromMemory === "function"
  );
}

async function initializeRuntime(
  importVips: () => Promise<unknown>,
): Promise<StudioVipsExportRuntime> {
  let moduleNamespace: unknown;
  try {
    moduleNamespace = await importVips();
  } catch (cause) {
    throw new VipsUnavailableError(
      "wasm-vips module could not be imported for the export lane.",
      { cause },
    );
  }
  const factory = (moduleNamespace as { default?: unknown } | null)?.default;
  if (typeof factory !== "function") {
    throw new VipsUnavailableError(
      "wasm-vips module did not expose a default factory function.",
    );
  }
  let vips: unknown;
  try {
    // Quality Lab 실사용과 동일: 동적 라이브러리(heif/jxl/resvg) 없이 코어만 초기화.
    vips = await (factory as (options?: Record<string, unknown>) => Promise<unknown>)(
      { dynamicLibraries: [] },
    );
  } catch (cause) {
    throw new VipsUnavailableError(
      "wasm-vips failed to initialize its WebAssembly runtime.",
      { cause },
    );
  }
  if (!isVipsModule(vips)) {
    throw new VipsUnavailableError(
      "wasm-vips initialized but its module shape is not the expected vips API.",
    );
  }
  // 결정성 기준선(Quality Lab 과 동일): 단일 스레드. SMP 는 COOP/COEP 워커 전제라
  // 이 레인에서는 켜지 않는다(descriptor limitations 참조).
  vips.concurrency(STUDIO_VIPS_EXPORT_CONCURRENCY);
  return Object.freeze({ vips });
}

/**
 * wasm-vips 를 dynamic import 로 1회 로드/초기화해 캐시한다.
 * 동시 호출은 같은 초기화 프로미스를 공유하고, 실패 시 캐시를 비워
 * 다음 호출이 재시도할 수 있게 한다(실패 자체는 VipsUnavailableError 로 전달).
 */
export function loadVipsForExport(
  options: StudioVipsLoadOptions = {},
): Promise<StudioVipsExportRuntime> {
  if (runtimeCache === null) {
    const pending = initializeRuntime(options.importVips ?? defaultImportVips)
      .catch((error: unknown) => {
        if (runtimeCache === pending) runtimeCache = null;
        throw error;
      });
    runtimeCache = pending;
  }
  return runtimeCache;
}

/** 테스트 전용 — 공유 런타임 캐시를 비운다(모듈 상태 격리). */
export function resetStudioVipsExportRuntimeForTests(): void {
  runtimeCache = null;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer.`);
  }
}

function assertSourceRaster(
  rgba: Uint8Array,
  width: number,
  height: number,
): void {
  if (!(rgba instanceof Uint8Array)) {
    throw new TypeError("rgba must be a Uint8Array of RGBA8 pixels.");
  }
  assertPositiveInteger(width, "width");
  assertPositiveInteger(height, "height");
  const expectedBytes = width * height * RGBA_BANDS;
  if (!Number.isSafeInteger(expectedBytes) || rgba.length !== expectedBytes) {
    throw new RangeError(
      `rgba byte length ${rgba.length} does not match ${width}x${height} RGBA8 `
      + `(expected ${expectedBytes}).`,
    );
  }
}

function assertDownscaleTarget(
  width: number,
  height: number,
  targetWidth: number,
  targetHeight: number,
): void {
  assertPositiveInteger(targetWidth, "targetWidth");
  assertPositiveInteger(targetHeight, "targetHeight");
  if (targetWidth > width || targetHeight > height) {
    throw new RangeError(
      "downscaleForExport is a downscale-only lane: "
      + `target ${targetWidth}x${targetHeight} exceeds source ${width}x${height}.`,
    );
  }
}

function resampleWithVips(
  source: VipsImageHandle,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): StudioVipsRaster {
  const resized = source.resize(targetWidth / sourceWidth, {
    vscale: targetHeight / sourceHeight,
  });
  try {
    // 조용한 손실 금지: libvips 의 목표 크기 반올림이 요청과 다르면 즉시 실패.
    if (resized.width !== targetWidth || resized.height !== targetHeight) {
      throw new Error(
        `wasm-vips resize drifted to ${resized.width}x${resized.height} `
        + `(requested ${targetWidth}x${targetHeight}); refusing silent size loss.`,
      );
    }
    const memory = resized.writeToMemory();
    const expectedBytes = targetWidth * targetHeight * RGBA_BANDS;
    if (memory.length !== expectedBytes) {
      throw new Error(
        `wasm-vips returned ${memory.length} bytes for `
        + `${targetWidth}x${targetHeight} RGBA8 (expected ${expectedBytes}).`,
      );
    }
    // wasm 힙 뷰와의 수명 결합을 끊기 위해 JS 힙으로 복사해 반환한다.
    return {
      rgba: new Uint8Array(memory),
      width: targetWidth,
      height: targetHeight,
    };
  } finally {
    resized.delete();
  }
}

/**
 * vips lanczos3(Quality Lab downscale 승자 설정 그대로)로 RGBA8 버퍼를
 * 정확히 targetWidth×targetHeight 로 축소한다. 결정적이며(단일 스레드,
 * 고정 커널), 동일 크기 요청은 재표본 없이 방어적 사본을 돌려준다.
 */
export async function downscaleForExport(
  rgba: Uint8Array,
  width: number,
  height: number,
  targetWidth: number,
  targetHeight: number,
  options: StudioVipsResampleOptions = {},
): Promise<StudioVipsRaster> {
  assertSourceRaster(rgba, width, height);
  assertDownscaleTarget(width, height, targetWidth, targetHeight);
  if (targetWidth === width && targetHeight === height) {
    // 항등 요청은 무손실 사본 — wasm 로드 자체를 요구하지 않는다.
    return { rgba: new Uint8Array(rgba), width, height };
  }
  const runtime = options.runtime ?? (await loadVipsForExport());
  const image = runtime.vips.Image.newFromMemory(
    rgba,
    width,
    height,
    RGBA_BANDS,
    VIPS_UCHAR_FORMAT,
  );
  try {
    return resampleWithVips(image, width, height, targetWidth, targetHeight);
  } finally {
    image.delete();
  }
}

/**
 * 웹툰 세로 스크롤용 mip 피라미드. 레벨 k 의 크기는
 * max(1, floor(width/2^k)) × max(1, floor(height/2^k)) — 각 축은 1 에서 클램프된다.
 * 누적 오차를 피하려고 모든 레벨을 원본에서 직접 lanczos3 로 재표본한다
 * (libvips resize 는 큰 축소도 내부 shrink+reduce 로 고품질 처리).
 * 양 축이 모두 1 에 도달한 다음 레벨부터는 정보가 늘지 않으므로 잘라낸다 —
 * 결과 길이는 요청 levels 보다 짧을 수 있다.
 */
export async function exportPyramid(
  rgba: Uint8Array,
  width: number,
  height: number,
  levels: number,
  options: StudioVipsResampleOptions = {},
): Promise<StudioVipsPyramidLevel[]> {
  assertSourceRaster(rgba, width, height);
  assertPositiveInteger(levels, "levels");
  if (levels > STUDIO_VIPS_EXPORT_MAX_PYRAMID_LEVELS) {
    throw new RangeError(
      `levels must be at most ${STUDIO_VIPS_EXPORT_MAX_PYRAMID_LEVELS}.`,
    );
  }
  if (width === 1 && height === 1) return [];
  const runtime = options.runtime ?? (await loadVipsForExport());
  const image = runtime.vips.Image.newFromMemory(
    rgba,
    width,
    height,
    RGBA_BANDS,
    VIPS_UCHAR_FORMAT,
  );
  try {
    const pyramid: StudioVipsPyramidLevel[] = [];
    let previousWidth = width;
    let previousHeight = height;
    for (let level = 1; level <= levels; level += 1) {
      const divisor = 2 ** level;
      const levelWidth = Math.max(1, Math.floor(width / divisor));
      const levelHeight = Math.max(1, Math.floor(height / divisor));
      if (levelWidth === previousWidth && levelHeight === previousHeight) break;
      const raster = resampleWithVips(
        image,
        width,
        height,
        levelWidth,
        levelHeight,
      );
      pyramid.push({ level, ...raster });
      previousWidth = levelWidth;
      previousHeight = levelHeight;
    }
    return pyramid;
  } finally {
    image.delete();
  }
}

/**
 * 최종 내보내기 라우팅 판정.
 * - "canvas2d": 단일 인코어 표면 예산(edge ≤ 8192, 면적 ≤ 8192²) 안 — vips 불필요.
 * - "vips": 인코어 표면 예산 초과 && 입력 ≤ 16384² px — 이 모듈이 소유.
 * - "out-of-core": 입력 > 16384² px(1GiB RGBA) — 타일 기반 provider 가 소유.
 */
export function planVipsExportRoute(
  width: number,
  height: number,
  limits: StudioVipsExportLimits = STUDIO_VIPS_EXPORT_DEFAULT_LIMITS,
): StudioVipsExportRoute {
  assertPositiveInteger(width, "width");
  assertPositiveInteger(height, "height");
  // 각 축이 safe integer 이고 임계 근방 곱은 2^53 미만이라 double 곱 비교는 정확하다.
  const pixels = width * height;
  if (pixels > limits.maxInputPixels) {
    return {
      route: "out-of-core",
      reason:
        `${width}x${height} = ${pixels}px exceeds the single-allocation input `
        + `budget ${limits.maxInputPixels}px (16384^2, 1GiB RGBA); the tiled `
        + "out-of-core export provider owns this document.",
    };
  }
  if (
    width > limits.singleSurfaceEdgePx
    || height > limits.singleSurfaceEdgePx
    || pixels > limits.singleSurfacePixels
  ) {
    return {
      route: "vips",
      reason:
        `${width}x${height} exceeds the single in-core surface budget `
        + `(edge ${limits.singleSurfaceEdgePx}px / area `
        + `${limits.singleSurfacePixels}px); the wasm-vips final lane owns it.`,
    };
  }
  return {
    route: "canvas2d",
    reason:
      `${width}x${height} fits the single in-core surface budget; the `
      + "Canvas2D slice-composition lane keeps ownership.",
  };
}

/** vips 레인이 이 캔버스 크기의 최종 내보내기를 소유해야 하는지 여부. */
export function canHandleExport(
  width: number,
  height: number,
  limits: StudioVipsExportLimits = STUDIO_VIPS_EXPORT_DEFAULT_LIMITS,
): boolean {
  return planVipsExportRoute(width, height, limits).route === "vips";
}
