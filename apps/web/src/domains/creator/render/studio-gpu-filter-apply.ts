/**
 * Studio GPU Filter Apply (엔진 로드맵 M1)
 * 이미지 보정 필드 → GPU 커널 체인 계획(plan) → 단일 커맨드 인코더 안에서 storage buffer
 * ping-pong 으로 커널을 연쇄 실행(중간 readback 없음) → 마지막에 한 번만 readback.
 *
 * 계약:
 *  - applyGpuFilterChain(...) === null 은 선택한 GPU 작업이 결과를 만들지 못했다는 뜻이다 —
 *    미지원 환경, 지원 외 필터 활성, 디바이스 손실, 검증/OOM 오류 전부. 호출부는 마지막
 *    정상 화면을 유지하고 unavailable 로 끝내야 하며, 같은 작업에서 Worker/Konva를 시작하면
 *    안 된다. GPU 경로가 틀린 픽셀을 돌려주는 일은 없어야 하므로 검증 오류는 error scope 로
 *    감지해 null 로 닫는다(fail-closed).
 *  - 체인 순서는 buildImageFilters(studio-konva-filters.ts)가 같은 필드를 적용하는 순서와
 *    동일하다: Gaussian → Morphology → Convolution → Brighten→Contrast → HSL → Levels
 *    → Curve → ColorBalance
 *    (계약 테스트가 buildImageFilters 실물과 대조한다). 인접한 LUT 스텝(밝기대비/레벨/커브)
 *    은 LUT 합성으로 한 lut3 디스패치에 융합된다 — 합성은 순차 실행과 비트 동일하므로
 *    체인 순서 의미가 보존된다.
 *  - 지원 필드 외의 보정이 하나라도 활성이면 GPU 후보가 아니다. 호출부는 작업 시작 전에
 *    별도 Worker provider를 선택해야 한다(부분 GPU 실행 금지 — 중간 순서에 끼어드는
 *    미지원 필터와 결과가 달라질 수 있기 때문).
 *
 * 이 모듈은 konva 를 import 하지 않는다 — 게이트는 경량 studio-konva-filter-fields 의
 * 후보 판정(보수적: 애매하면 GPU 후보에서 제외)을 쓴다.
 */

import {
  isIdentityStudioConvolution,
  isIdentityStudioMorphology,
  normalizeStudioConvolution,
  normalizeStudioMorphology,
} from "../studio-advanced-pixel-filters";
import { isIdentityBlurFx, normalizeBlurFx } from "../studio-blur";
import { isIdentityColorBalance, normalizeColorBalance } from "../studio-color-balance";
import { isIdentityCurve, isIdentityCurveChannels, normalizeCurve } from "../studio-curves";
import { isIdentityLevels, isIdentityLevelsChannels, normalizeLevels } from "../studio-levels";

import {
  acquireStudioGpuDevice,
  acquireStudioGpuFilterRuntimeOnFabric,
} from "./studio-gpu-fabric";
import {
  STUDIO_GPU_FILTER_BINDINGS,
  STUDIO_GPU_FILTER_DISPATCH_ROW_THREADS,
  STUDIO_GPU_FILTER_KERNELS,
  STUDIO_GPU_FILTER_WORKGROUP_SIZE,
  composeStudioGpuLut3,
  packStudioGpuBrightnessContrastLut,
  packStudioGpuColorBalanceParams,
  packStudioGpuCurvesLut,
  packStudioGpuHslParams,
  packStudioGpuLevelsLut,
  packStudioGpuLut3Uniform,
  patchStudioGpuFilterPixelCount,
} from "./studio-gpu-filter-kernels";
import { createStudioGpuFilterPresentationSurface } from "./studio-gpu-filter-presentation";
import { acquireStudioGpuFilterRuntime } from "./studio-gpu-filter-runtime";
import {
  STUDIO_GPU_GAUSSIAN_FLOAT_BYTES_PER_PIXEL,
  STUDIO_GPU_SPATIAL_FILTER_KERNELS,
  packStudioGpuConvolutionParams,
  packStudioGpuGaussianResolveParams,
  packStudioGpuMorphologyParams,
  packStudioGpuSpatialParams,
  studioGpuGaussianBoxRadii,
} from "./studio-gpu-filter-spatial-kernels";
import { hasActiveImageFilters } from "./studio-konva-filter-fields";

import type { StudioImageDataLike } from "../studio-filters";
import type { StudioGpuFilterKernelId } from "./studio-gpu-filter-kernels";
import type {
  StudioGpuFilterPresentationCanvas,
  StudioGpuFilterPresentationSurface,
} from "./studio-gpu-filter-presentation";
import type { StudioGpuFilterRuntimeOptions } from "./studio-gpu-filter-runtime";
import type {
  StudioGpuSpatialFilterKernelId,
  StudioGpuSpatialFilterKernelSpec,
} from "./studio-gpu-filter-spatial-kernels";
import type { ImageFilterFields } from "./studio-konva-filter-fields";

export { createStudioGpuFilterPresentationSurface };

/** GPU 경로가 담당하는 보정 필드(이 외의 활성 필드가 있으면 작업 전에 다른 provider 선택). */
export const STUDIO_GPU_FILTER_SUPPORTED_FIELDS = [
  "brightness",
  "contrast",
  "saturation",
  "hue",
  "levelsBlack",
  "levelsWhite",
  "levelsGamma",
  "levelsOutBlack",
  "levelsOutWhite",
  "levelsCh",
  "curve",
  "curveCh",
  "colorBalance",
  "blurFx",
  "morphology",
  "convolution",
] as const satisfies readonly (keyof ImageFilterFields)[];

export type StudioGpuFilterPlanKernelId =
  | StudioGpuFilterKernelId
  | StudioGpuSpatialFilterKernelId;

export interface StudioGpuFilterPlanStep {
  readonly kernelId: StudioGpuFilterPlanKernelId;
  /** offset 0 은 pixelCount 자리표시자 — apply 가 이미지별로 패치한다. */
  readonly uniform: ArrayBuffer;
  readonly lut?: Uint32Array;
  /**
   * "lut-fused" 스텝에만 존재 — 이 스텝으로 합성된 원본 LUT 커널들의 체인 순서.
   * 순차 실행과의 동치는 LUT 합성(composeStudioGpuLut3)이 보장한다.
   */
  readonly fusedKernelIds?: readonly StudioGpuFilterPlanKernelId[];
}

export type StudioGpuFilterPlan = readonly StudioGpuFilterPlanStep[];

export interface StudioGpuFilterApplyOptions extends StudioGpuFilterRuntimeOptions {
  /** Aborted work is discarded; only a newer independently selected request may take over. */
  readonly signal?: AbortSignal;
  /** Optional editor revision captured when the request starts. */
  readonly sourceRevision?: string | number;
  /** False means a newer edit superseded this request; stale pixels are never published. */
  readonly isSourceRevisionCurrent?: (revision: string | number) => boolean;
}

export interface StudioGpuFilterPreviewFailure {
  readonly phase: "compute" | "presentation" | "final-readback";
  readonly message: string;
}

export interface StudioGpuFilterPreviewOptions extends StudioGpuFilterApplyOptions {
  /** Reused by the image node so slider ticks retain one browser-owned GPU canvas. */
  readonly surface?: StudioGpuFilterPresentationSurface;
  /** Presentation failure is observable so the caller can retain the last good frame. */
  readonly onFailure?: (failure: StudioGpuFilterPreviewFailure) => void;
}

export interface StudioGpuFilterPreviewFrame {
  readonly canvas: StudioGpuFilterPresentationCanvas;
  readonly width: number;
  readonly height: number;
  readonly revision: number;
  readonly sourceRevision?: string | number;
  /** The only GPU→CPU transition. Call after interaction settles or for canonical export. */
  readbackFinal(): Promise<StudioImageDataLike | null>;
  /** Releases the retained GPU buffer without reading it back. Idempotent. */
  dispose(): void;
}

// buildImageFilters 의 isActiveNumber 복제(비공개 함수).
function isActiveNumber(value: number | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value !== 0;
}

// buildImageFilters 의 levelsParamsOf / hasActiveLevels 와 동일한 판정.
function hasActiveLevelsFields(el: ImageFilterFields): boolean {
  const master = normalizeLevels({
    blackPoint: el.levelsBlack,
    whitePoint: el.levelsWhite,
    gamma: el.levelsGamma,
    outBlack: el.levelsOutBlack,
    outWhite: el.levelsOutWhite,
  });
  if (!isIdentityLevels(master)) return true;
  return !!el.levelsCh && !isIdentityLevelsChannels(el.levelsCh);
}

// buildImageFilters 의 hasActiveCurve 와 동일한 판정.
function hasActiveCurveFields(el: ImageFilterFields): boolean {
  if (el.curve && !isIdentityCurve(normalizeCurve(el.curve))) return true;
  return !!el.curveCh && !isIdentityCurveChannels(el.curveCh);
}

// buildImageFilters 의 hasActiveColorBalance 와 동일한 판정.
function hasActiveColorBalanceFields(el: ImageFilterFields): boolean {
  return !!el.colorBalance && !isIdentityColorBalance(normalizeColorBalance(el.colorBalance));
}

function activeGaussianBlurFx(el: ImageFilterFields) {
  if (!el.blurFx) return null;
  const normalized = normalizeBlurFx(el.blurFx);
  return !isIdentityBlurFx(normalized) && normalized.type === "gaussian" ? normalized : null;
}

function hasUnsupportedActiveBlurFx(el: ImageFilterFields): boolean {
  if (!el.blurFx) return false;
  const normalized = normalizeBlurFx(el.blurFx);
  return !isIdentityBlurFx(normalized) && normalized.type !== "gaussian";
}

function activeMorphology(el: ImageFilterFields) {
  if (!el.morphology) return null;
  const normalized = normalizeStudioMorphology(el.morphology);
  return isIdentityStudioMorphology(normalized) ? null : normalized;
}

function activeConvolution(el: ImageFilterFields) {
  if (!el.convolution) return null;
  const normalized = normalizeStudioConvolution(el.convolution);
  return isIdentityStudioConvolution(normalized) ? null : normalized;
}

/**
 * 지원 필드를 제거한 사본에 활성 보정이 남아 있으면 true — 즉 GPU 체인이 감당 못 하는
 * 필터가 켜져 있다. 경량 후보 판정(hasActiveImageFilters)은 엔진 판정보다 넓어서, 애매한
 * 값(정규화하면 항등인 객체 등)도 "활성"으로 보고 GPU 후보에서 제외한다 — 안전한 방향의
 * 오탐이며, 다른 provider 선택은 작업 시작 전에만 이루어진다.
 */
function hasUnsupportedActiveFilters(el: ImageFilterFields): boolean {
  // blurFx is a tagged union: only its premultiplied Gaussian variant has a GPU kernel.
  // Delete the field below only after rejecting the other active variants.
  if (hasUnsupportedActiveBlurFx(el)) return true;
  const rest: ImageFilterFields = { ...el };
  for (const field of STUDIO_GPU_FILTER_SUPPORTED_FIELDS) {
    delete rest[field];
  }
  return hasActiveImageFilters(rest);
}

/**
 * 인접한 lut3 스텝들을 한 디스패치로 융합한다 — 바이트→바이트 LUT 사상의 합성은 순차
 * 실행과 비트 동일하다(각 LUT 출력이 이미 스테이지 경계 양자화를 거친 바이트이므로 추가
 * 반올림이 없다). 사이에 수식 커널(HSL/컬러밸런스)이 끼면 체인 순서 보존을 위해 융합하지
 * 않는다.
 */
function fuseAdjacentLutSteps(steps: readonly StudioGpuFilterPlanStep[]): StudioGpuFilterPlanStep[] {
  const fused: StudioGpuFilterPlanStep[] = [];
  for (const step of steps) {
    const previous = fused[fused.length - 1];
    if (previous?.lut && step.lut) {
      fused[fused.length - 1] = {
        kernelId: "lut-fused",
        uniform: packStudioGpuLut3Uniform(),
        lut: composeStudioGpuLut3(previous.lut, step.lut),
        fusedKernelIds: [
          ...(previous.fusedKernelIds ?? [previous.kernelId]),
          ...(step.fusedKernelIds ?? [step.kernelId]),
        ],
      };
      continue;
    }
    fused.push(step);
  }
  return fused;
}

/**
 * 보정 필드 → GPU 커널 체인 계획. buildImageFilters 가 같은 필드를 태우는 순서와 동일한
 * 순서로 스텝을 만들고, 인접한 LUT 스텝(밝기대비/레벨/커브)은 한 lut3 디스패치로 융합해
 * 돌려준다(fusedKernelIds 가 원본 순서를 보존). 다음의 경우 null(호출부는 CPU 경로):
 *  - 지원 필드 중 활성이 하나도 없음
 *  - 지원 외 보정이 하나라도 활성
 */
export function planStudioGpuFilterChain(el: ImageFilterFields): StudioGpuFilterPlan | null {
  if (hasUnsupportedActiveFilters(el)) return null;

  const steps: StudioGpuFilterPlanStep[] = [];
  const gaussian = activeGaussianBlurFx(el);
  if (gaussian) {
    steps.push({
      kernelId: "gaussian-decode",
      uniform: new ArrayBuffer(16),
    });
    for (const radius of studioGpuGaussianBoxRadii(gaussian.radius)) {
      if (radius <= 0) continue;
      steps.push({
        kernelId: "gaussian-box-horizontal",
        uniform: packStudioGpuSpatialParams({
          width: 0,
          height: 0,
          radius,
          direction: "horizontal",
        }),
      });
      steps.push({
        kernelId: "gaussian-box-vertical",
        uniform: packStudioGpuSpatialParams({
          width: 0,
          height: 0,
          radius,
          direction: "vertical",
        }),
      });
    }
    steps.push({
      kernelId: "gaussian-resolve",
      uniform: packStudioGpuGaussianResolveParams(gaussian.strength),
    });
  }
  const morphology = activeMorphology(el);
  if (morphology) {
    steps.push({
      kernelId: "morphology-horizontal",
      uniform: packStudioGpuMorphologyParams(0, 0, morphology, "horizontal"),
    });
    steps.push({
      kernelId: "morphology-vertical",
      uniform: packStudioGpuMorphologyParams(0, 0, morphology, "vertical"),
    });
  }
  const convolution = activeConvolution(el);
  if (convolution) {
    steps.push({
      kernelId: "convolution-3x3",
      uniform: packStudioGpuConvolutionParams(0, 0, convolution),
    });
  }
  if (isActiveNumber(el.brightness) || isActiveNumber(el.contrast)) {
    steps.push({
      kernelId: "brightness-contrast",
      uniform: packStudioGpuLut3Uniform(),
      lut: packStudioGpuBrightnessContrastLut({
        brightness: el.brightness,
        contrast: el.contrast,
      }),
    });
  }
  if (isActiveNumber(el.saturation) || isActiveNumber(el.hue)) {
    steps.push({
      kernelId: "hsl",
      uniform: packStudioGpuHslParams({ saturation: el.saturation, hue: el.hue }),
    });
  }
  if (hasActiveLevelsFields(el)) {
    steps.push({
      kernelId: "levels",
      uniform: packStudioGpuLut3Uniform(),
      lut: packStudioGpuLevelsLut({
        master: {
          blackPoint: el.levelsBlack,
          whitePoint: el.levelsWhite,
          gamma: el.levelsGamma,
          outBlack: el.levelsOutBlack,
          outWhite: el.levelsOutWhite,
        },
        channels: el.levelsCh,
      }),
    });
  }
  if (hasActiveCurveFields(el)) {
    steps.push({
      kernelId: "curves",
      uniform: packStudioGpuLut3Uniform(),
      lut: packStudioGpuCurvesLut({ master: el.curve, channels: el.curveCh }),
    });
  }
  if (hasActiveColorBalanceFields(el)) {
    steps.push({
      kernelId: "color-balance",
      uniform: packStudioGpuColorBalanceParams(el.colorBalance),
    });
  }
  return steps.length > 0 ? fuseAdjacentLutSteps(steps) : null;
}

/** 통합 게이트용 — 이 보정 프로그램을 GPU 체인이 통째로 담당할 수 있는지. */
export function isStudioGpuFilterChainEligible(el: ImageFilterFields): boolean {
  // Eligibility is queried immediately before apply by the interactive image node. Building the
  // full plan here used to generate every 768-entry LUT twice per slider tick (once for this gate,
  // once again inside applyGpuFilterChain). Keep the gate allocation-light and leave LUT packing
  // to the actual execution path.
  if (hasUnsupportedActiveFilters(el)) return false;
  return (
    isActiveNumber(el.brightness)
    || isActiveNumber(el.contrast)
    || isActiveNumber(el.saturation)
    || isActiveNumber(el.hue)
    || hasActiveLevelsFields(el)
    || hasActiveCurveFields(el)
    || hasActiveColorBalanceFields(el)
    || activeGaussianBlurFx(el) !== null
    || activeMorphology(el) !== null
    || activeConvolution(el) !== null
  );
}

function isValidImageData(imageData: StudioImageDataLike): boolean {
  return (
    !!imageData
    && imageData.data instanceof Uint8ClampedArray
    && Number.isSafeInteger(imageData.width)
    && Number.isSafeInteger(imageData.height)
    && imageData.width > 0
    && imageData.height > 0
    && imageData.data.length === imageData.width * imageData.height * 4
  );
}

function isSpatialKernelId(
  id: StudioGpuFilterPlanKernelId,
): id is StudioGpuSpatialFilterKernelId {
  return Object.prototype.hasOwnProperty.call(STUDIO_GPU_SPATIAL_FILTER_KERNELS, id);
}

function executableKernel(
  id: StudioGpuFilterPlanKernelId,
): (typeof STUDIO_GPU_FILTER_KERNELS)[StudioGpuFilterKernelId] | StudioGpuSpatialFilterKernelSpec {
  return isSpatialKernelId(id)
    ? STUDIO_GPU_SPATIAL_FILTER_KERNELS[id]
    : STUDIO_GPU_FILTER_KERNELS[id];
}

function patchSpatialDimensions(
  kernelId: StudioGpuFilterPlanKernelId,
  uniform: ArrayBuffer,
  width: number,
  height: number,
): void {
  if (
    kernelId !== "gaussian-box-horizontal"
    && kernelId !== "gaussian-box-vertical"
    && kernelId !== "morphology-horizontal"
    && kernelId !== "morphology-vertical"
    && kernelId !== "convolution-3x3"
  ) {
    return;
  }
  const view = new DataView(uniform);
  view.setUint32(4, width >>> 0, true);
  view.setUint32(8, height >>> 0, true);
}

function requestSuperseded(options?: StudioGpuFilterApplyOptions): boolean {
  if (options?.signal?.aborted) return true;
  if (
    options?.sourceRevision !== undefined
    && options.isSourceRevisionCurrent
    && !options.isSourceRevisionCurrent(options.sourceRevision)
  ) {
    return true;
  }
  return false;
}

interface StudioGpuFilterExecutionLease {
  readonly buffer: GPUBuffer;
  readonly byteLength: number;
  readonly height: number;
  readonly runtime: Awaited<ReturnType<typeof acquireStudioGpuFilterRuntime>> & object;
  readonly width: number;
  readback(): Promise<Uint8ClampedArray | null>;
  release(): void;
}

function safeDestroyGpuBuffer(buffer: GPUBuffer): void {
  try {
    buffer.destroy();
  } catch {
    // A lost device may already have destroyed every lease.
  }
}

/**
 * Executes the compute chain and retains its final packed buffer. This function never maps a
 * staging buffer. The caller must choose either direct GPU presentation or an explicit final
 * readback, then release the lease.
 */
async function executeGpuFilterChain(
  imageData: StudioImageDataLike,
  el: ImageFilterFields,
  options?: StudioGpuFilterApplyOptions,
): Promise<StudioGpuFilterExecutionLease | null> {
  if (!isValidImageData(imageData) || requestSuperseded(options)) return null;
  const plan = planStudioGpuFilterChain(el);
  if (!plan) return null;

  // Explicit gpu overrides remain isolated harness/embed runtimes owned by this apply call.
  // Production calls share the StudioGpuFabric device/runtime so per-apply cleanup cannot destroy
  // the shared device and repeated previews reuse adapter, pipeline, and buffer-pool state.
  const ownsRuntime = options !== undefined && "gpu" in options;
  const runtime = ownsRuntime
    ? await acquireStudioGpuFilterRuntime(options)
    : await acquireStudioGpuFilterRuntimeOnFabric();
  if (!runtime) return null;
  if (runtime.lost || requestSuperseded(options)) {
    if (ownsRuntime) runtime.dispose();
    return null;
  }

  const pixelCount = imageData.width * imageData.height;
  const byteLength = pixelCount * 4;
  const needsGaussianScratch = plan.some((step) => (
    step.kernelId === "gaussian-decode"
    || step.kernelId === "gaussian-box-horizontal"
    || step.kernelId === "gaussian-box-vertical"
    || step.kernelId === "gaussian-resolve"
  ));
  const gaussianByteLength = pixelCount * STUDIO_GPU_GAUSSIAN_FLOAT_BYTES_PER_PIXEL;
  const workgroupsX = STUDIO_GPU_FILTER_DISPATCH_ROW_THREADS / STUDIO_GPU_FILTER_WORKGROUP_SIZE;
  const workgroupsY = Math.ceil(pixelCount / STUDIO_GPU_FILTER_DISPATCH_ROW_THREADS);
  const limits = runtime.device.limits;
  if (
    byteLength > limits.maxStorageBufferBindingSize
    || byteLength > limits.maxBufferSize
    || (
      needsGaussianScratch
      && (
        gaussianByteLength > limits.maxStorageBufferBindingSize
        || gaussianByteLength > limits.maxBufferSize
      )
    )
    || workgroupsX > limits.maxComputeWorkgroupsPerDimension
    || workgroupsY > limits.maxComputeWorkgroupsPerDimension
    || STUDIO_GPU_FILTER_WORKGROUP_SIZE > (limits.maxComputeInvocationsPerWorkgroup ?? Number.POSITIVE_INFINITY)
    || STUDIO_GPU_FILTER_WORKGROUP_SIZE > (limits.maxComputeWorkgroupSizeX ?? Number.POSITIVE_INFINITY)
  ) {
    if (ownsRuntime) runtime.dispose();
    return null;
  }

  const transientBuffers: GPUBuffer[] = [];
  const leasedBuffers: { buffer: GPUBuffer; byteLength: number }[] = [];
  let recycleLeasedBuffers = false;
  let retainedBuffer: GPUBuffer | null = null;
  let pushedErrorScopes = 0;
  try {
    // 검증/OOM 오류는 예외를 던지지 않는다 — error scope 로 잡아 fail-closed(null) 한다.
    // (검증 오류를 놓치면 컴퓨트가 통째로 무시된 "무필터" 픽셀을 성공으로 돌려줄 수 있다.)
    runtime.device.pushErrorScope("out-of-memory");
    pushedErrorScopes += 1;
    runtime.device.pushErrorScope("validation");
    pushedErrorScopes += 1;

    let current = runtime.acquirePixelBuffer(byteLength, "studio-gpu-filter/ping");
    leasedBuffers.push({ buffer: current, byteLength });
    let other = runtime.acquirePixelBuffer(byteLength, "studio-gpu-filter/pong");
    leasedBuffers.push({ buffer: other, byteLength });
    let gaussianCurrent: GPUBuffer | null = null;
    let gaussianOther: GPUBuffer | null = null;
    if (needsGaussianScratch) {
      gaussianCurrent = runtime.acquirePixelBuffer(
        gaussianByteLength,
        "studio-gpu-filter/gaussian-float-ping",
      );
      leasedBuffers.push({ buffer: gaussianCurrent, byteLength: gaussianByteLength });
      gaussianOther = runtime.acquirePixelBuffer(
        gaussianByteLength,
        "studio-gpu-filter/gaussian-float-pong",
      );
      leasedBuffers.push({ buffer: gaussianOther, byteLength: gaussianByteLength });
    }
    runtime.uploadPixels(current, imageData.data);

    const encoder = runtime.device.createCommandEncoder({ label: "studio-gpu-filter/chain" });
    for (const step of plan) {
      if (runtime.lost || requestSuperseded(options)) return null;
      const kernel = executableKernel(step.kernelId);
      // Plans and their LUTs are immutable/reusable. Only the image-size word is request-specific;
      // patch a tiny uniform copy instead of contaminating a cached/shared plan.
      const requestUniform = step.uniform.slice(0);
      patchStudioGpuFilterPixelCount(requestUniform, pixelCount);
      patchSpatialDimensions(
        step.kernelId,
        requestUniform,
        imageData.width,
        imageData.height,
      );
      const uniformBuffer = runtime.createUniformBuffer(
        requestUniform,
        `studio-gpu-filter/${step.kernelId}/params`,
      );
      transientBuffers.push(uniformBuffer);
      const layout = isSpatialKernelId(step.kernelId)
        ? STUDIO_GPU_SPATIAL_FILTER_KERNELS[step.kernelId].bufferLayout
        : "packed";
      let sourceBuffer = current;
      let destinationBuffer = other;
      if (layout === "gaussian-decode") {
        if (!gaussianCurrent) return null;
        destinationBuffer = gaussianCurrent;
      } else if (layout === "gaussian-box") {
        if (!gaussianCurrent || !gaussianOther) return null;
        sourceBuffer = gaussianCurrent;
        destinationBuffer = gaussianOther;
      }
      const entries: GPUBindGroupEntry[] = [
        { binding: STUDIO_GPU_FILTER_BINDINGS.src, resource: { buffer: sourceBuffer } },
        { binding: STUDIO_GPU_FILTER_BINDINGS.dst, resource: { buffer: destinationBuffer } },
        { binding: STUDIO_GPU_FILTER_BINDINGS.params, resource: { buffer: uniformBuffer } },
      ];
      if (kernel.usesLut) {
        if (!step.lut) return null;
        const lutBuffer = runtime.createLutBuffer(
          step.lut,
          `studio-gpu-filter/${step.kernelId}/lut`,
        );
        transientBuffers.push(lutBuffer);
        entries.push({ binding: STUDIO_GPU_FILTER_BINDINGS.lut, resource: { buffer: lutBuffer } });
      } else if (layout === "gaussian-resolve") {
        if (!gaussianCurrent) return null;
        entries.push({
          binding: STUDIO_GPU_FILTER_BINDINGS.lut,
          resource: { buffer: gaussianCurrent },
        });
      }
      const pipeline = runtime.getComputePipeline(kernel);
      const bindGroup = runtime.device.createBindGroup({
        label: `studio-gpu-filter/${step.kernelId}`,
        layout: pipeline.getBindGroupLayout(0),
        entries,
      });
      const pass = encoder.beginComputePass({ label: `studio-gpu-filter/${step.kernelId}` });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(workgroupsX, workgroupsY);
      pass.end();
      if (layout === "gaussian-box") {
        const written = gaussianOther;
        gaussianOther = gaussianCurrent;
        gaussianCurrent = written;
      } else if (layout === "packed" || layout === "gaussian-resolve") {
        const written = other;
        other = current;
        current = written;
      }
    }
    runtime.device.queue.submit([encoder.finish()]);

    const validationError = await runtime.device.popErrorScope();
    pushedErrorScopes -= 1;
    const oomError = await runtime.device.popErrorScope();
    pushedErrorScopes -= 1;
    if (validationError || oomError || runtime.lost || requestSuperseded(options)) return null;

    retainedBuffer = current;
    recycleLeasedBuffers = true;
    let released = false;
    let readbackPromise: Promise<Uint8ClampedArray | null> | null = null;
    const release = (): void => {
      if (released) return;
      released = true;
      if (!runtime.lost) runtime.releasePixelBuffer(current, byteLength);
      else safeDestroyGpuBuffer(current);
      if (ownsRuntime) runtime.dispose();
    };
    return {
      buffer: current,
      byteLength,
      height: imageData.height,
      runtime,
      width: imageData.width,
      readback: () => {
        if (released) return Promise.resolve(null);
        if (readbackPromise) return readbackPromise;
        readbackPromise = (async () => {
          try {
            if (runtime.lost || requestSuperseded(options)) return null;
            const bytes = await runtime.readbackPixels(current, byteLength);
            if (
              bytes.length !== byteLength
              || runtime.lost
              || requestSuperseded(options)
            ) return null;
            return bytes;
          } catch {
            return null;
          } finally {
            release();
          }
        })();
        return readbackPromise;
      },
      release,
    };
  } catch {
    return null;
  } finally {
    // 예외 경로에서도 error scope 스택을 균형 맞춰 공유 디바이스를 오염시키지 않는다.
    while (pushedErrorScopes > 0) {
      pushedErrorScopes -= 1;
      try {
        void runtime.device.popErrorScope().catch(() => undefined);
      } catch {
        // lost 디바이스 — 스택도 함께 사라졌다.
      }
    }
    for (const buffer of transientBuffers) {
      try {
        buffer.destroy();
      } catch {
        // destroy 는 제출된 작업이 끝난 뒤 내부적으로 해제된다 — 폐기 실패는 무시.
      }
    }
    for (const lease of leasedBuffers) {
      if (lease.buffer === retainedBuffer) continue;
      if (recycleLeasedBuffers) runtime.releasePixelBuffer(lease.buffer, lease.byteLength);
      else {
        // 검증/OOM/lost 경로에서는 오염 가능성이 있는 lease를 절대 풀에 되돌리지 않는다.
        safeDestroyGpuBuffer(lease.buffer);
      }
    }
    if (ownsRuntime && !retainedBuffer) runtime.dispose();
  }
}

/**
 * Canonical/final WebGPU filter execution. This API intentionally performs one explicit readback;
 * interactive callers must use presentGpuFilterChain and defer readbackFinal until settle/export.
 */
export async function applyGpuFilterChain(
  imageData: StudioImageDataLike,
  el: ImageFilterFields,
  options?: StudioGpuFilterApplyOptions,
): Promise<StudioImageDataLike | null> {
  const execution = await executeGpuFilterChain(imageData, el, options);
  if (!execution) return null;
  const bytes = await execution.readback();
  if (!bytes) return null;
  return { data: bytes, width: execution.width, height: execution.height };
}

/**
 * Interactive WebGPU filter execution. The returned canvas is updated directly from the final GPU
 * storage buffer. No GPU→CPU readback occurs until the caller invokes readbackFinal().
 */
export async function presentGpuFilterChain(
  imageData: StudioImageDataLike,
  el: ImageFilterFields,
  options?: StudioGpuFilterPreviewOptions,
): Promise<StudioGpuFilterPreviewFrame | null> {
  const execution = await executeGpuFilterChain(imageData, el, options);
  if (!execution) {
    options?.onFailure?.({
      phase: "compute",
      message: "The WebGPU filter compute chain was unavailable.",
    });
    return null;
  }

  const ownsSurface = !options?.surface;
  const surface = options?.surface ?? createStudioGpuFilterPresentationSurface();
  // The shared filter runtime intentionally exposes a Proxy device whose destroy() releases its
  // fabric lease. WebGPU methods bind correctly through that facade, but WebIDL dictionary brand
  // checks (GPUCanvasContext.configure({ device })) require the native GPUDevice object itself.
  // Acquire a short-lived lease from the same fabric epoch solely for presentation. The compute
  // buffer and canvas pipeline therefore stay on one physical device with no copy/readback.
  const isolatedRuntime = options !== undefined && "gpu" in options;
  const presentationLease = isolatedRuntime ? null : await acquireStudioGpuDevice();
  if (!isolatedRuntime && !presentationLease) {
    execution.release();
    if (ownsSurface) surface.dispose();
    options?.onFailure?.({
      phase: "presentation",
      message: "The native Studio GPU presentation device was unavailable.",
    });
    return null;
  }
  const presented = await surface.present({
    device: presentationLease?.device ?? execution.runtime.device,
    pixels: execution.buffer,
    width: execution.width,
    height: execution.height,
  }).finally(() => presentationLease?.release());
  if (presented.status !== "presented") {
    execution.release();
    if (ownsSurface) surface.dispose();
    options?.onFailure?.({ phase: "presentation", message: presented.reason });
    return null;
  }

  let disposed = false;
  let finalPromise: Promise<StudioImageDataLike | null> | null = null;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (!finalPromise) execution.release();
    if (ownsSurface) surface.dispose();
  };
  return {
    canvas: surface.canvas,
    height: execution.height,
    revision: presented.revision,
    sourceRevision: options?.sourceRevision,
    width: execution.width,
    readbackFinal: () => {
      if (finalPromise) return finalPromise;
      if (disposed) return Promise.resolve(null);
      finalPromise = (async () => {
        const bytes = await execution.readback();
        disposed = true;
        if (ownsSurface) surface.dispose();
        if (!bytes) {
          options?.onFailure?.({
            phase: "final-readback",
            message: "The settled WebGPU filter frame could not be read back.",
          });
          return null;
        }
        return { data: bytes, width: execution.width, height: execution.height };
      })();
      return finalPromise;
    },
    dispose,
  };
}
