/**
 * Product adapter for the deterministic advanced-blur CPU oracles.
 *
 * The pure kernels deliberately accept large bounded jobs for offline/Worker execution. Product
 * rendering has a tighter main-thread policy: expensive advanced blurs are rejected by the Konva
 * compatibility lane and the Worker client reports an explicit worker-required error instead of
 * freezing the editor. The module Worker opts into the full bounded kernel through
 * `advancedBlurExecution`.
 */

import {
  DEFAULT_STUDIO_FIELD_IRIS_BLUR_OPTIONS,
  DEFAULT_STUDIO_LENS_BLUR_OPTIONS,
  DEFAULT_STUDIO_SELECTIVE_GAUSSIAN_BLUR_OPTIONS,
  DEFAULT_STUDIO_TILT_SHIFT_BLUR_OPTIONS,
  applyStudioAdvancedBlurFilter,
  type StudioAdvancedBlurKernelId,
  type StudioFieldIrisBlurOptions,
  type StudioLensBlurOptions,
  type StudioSelectiveGaussianBlurOptions,
  type StudioTiltShiftBlurOptions,
} from "./studio-advanced-blur-filter-kernels";

import type { ImageFilterFields } from "./render/studio-konva-filter-fields";
import type { StudioImageDataLike } from "./studio-filters";

export type StudioAdvancedBlurExecution = "direct" | "worker";

/**
 * At most four million source-texel reads may run synchronously. A normal illustration therefore
 * uses the Worker, while tiny thumbnails and deterministic tests may preselect the direct lane.
 */
export const STUDIO_ADVANCED_BLUR_DIRECT_MAX_SOURCE_SAMPLES = 4_000_000;

export const STUDIO_ADVANCED_BLUR_ENGINE_IDS = [
  "lens-blur",
  "field-iris-blur",
  "tilt-shift-blur",
  "selective-gaussian-blur",
] as const satisfies readonly StudioAdvancedBlurKernelId[];

type NumberRecord = Record<string, number | string | number[] | undefined>;
type FilterThis = { attrs?: NumberRecord };

function clampFinite(raw: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof raw === "number" && Number.isFinite(raw)
    ? Math.min(maximum, Math.max(minimum, raw))
    : fallback;
}

function clampInteger(raw: unknown, minimum: number, maximum: number, fallback: number): number {
  return Math.round(clampFinite(raw, minimum, maximum, fallback));
}

function normalizeAngle(value: number): number {
  const twoPi = Math.PI * 2;
  let angle = value % twoPi;
  if (angle > Math.PI) angle -= twoPi;
  if (angle < -Math.PI) angle += twoPi;
  return angle;
}

export function normalizeStudioLensBlurOptions(
  value?: Partial<StudioLensBlurOptions> | null,
): StudioLensBlurOptions {
  return {
    radius: clampFinite(value?.radius, 0.25, 18, DEFAULT_STUDIO_LENS_BLUR_OPTIONS.radius),
    sampleCount: clampInteger(
      value?.sampleCount,
      5,
      64,
      DEFAULT_STUDIO_LENS_BLUR_OPTIONS.sampleCount,
    ),
    apertureBlades: clampInteger(
      value?.apertureBlades,
      3,
      12,
      DEFAULT_STUDIO_LENS_BLUR_OPTIONS.apertureBlades,
    ),
    apertureRotationRadians: normalizeAngle(clampFinite(
      value?.apertureRotationRadians,
      -1_000_000,
      1_000_000,
      DEFAULT_STUDIO_LENS_BLUR_OPTIONS.apertureRotationRadians,
    )),
  };
}

export function normalizeStudioFieldIrisBlurOptions(
  value?: Partial<StudioFieldIrisBlurOptions> | null,
): StudioFieldIrisBlurOptions {
  return {
    focusCenterX: clampFinite(
      value?.focusCenterX,
      0,
      1,
      DEFAULT_STUDIO_FIELD_IRIS_BLUR_OPTIONS.focusCenterX,
    ),
    focusCenterY: clampFinite(
      value?.focusCenterY,
      0,
      1,
      DEFAULT_STUDIO_FIELD_IRIS_BLUR_OPTIONS.focusCenterY,
    ),
    focusRadius: clampFinite(
      value?.focusRadius,
      0,
      Math.SQRT2,
      DEFAULT_STUDIO_FIELD_IRIS_BLUR_OPTIONS.focusRadius,
    ),
    feather: clampFinite(
      value?.feather,
      0.001,
      Math.SQRT2,
      DEFAULT_STUDIO_FIELD_IRIS_BLUR_OPTIONS.feather,
    ),
    maximumBlurRadius: clampFinite(
      value?.maximumBlurRadius,
      0.25,
      18,
      DEFAULT_STUDIO_FIELD_IRIS_BLUR_OPTIONS.maximumBlurRadius,
    ),
    sampleCount: clampInteger(
      value?.sampleCount,
      5,
      64,
      DEFAULT_STUDIO_FIELD_IRIS_BLUR_OPTIONS.sampleCount,
    ),
    apertureBlades: clampInteger(
      value?.apertureBlades,
      3,
      12,
      DEFAULT_STUDIO_FIELD_IRIS_BLUR_OPTIONS.apertureBlades,
    ),
  };
}

export function normalizeStudioTiltShiftBlurOptions(
  value?: Partial<StudioTiltShiftBlurOptions> | null,
): StudioTiltShiftBlurOptions {
  return {
    axisRadians: normalizeAngle(clampFinite(
      value?.axisRadians,
      -1_000_000,
      1_000_000,
      DEFAULT_STUDIO_TILT_SHIFT_BLUR_OPTIONS.axisRadians,
    )),
    focusWidth: clampFinite(
      value?.focusWidth,
      0,
      Math.SQRT2 * 2,
      DEFAULT_STUDIO_TILT_SHIFT_BLUR_OPTIONS.focusWidth,
    ),
    feather: clampFinite(
      value?.feather,
      0.001,
      Math.SQRT2,
      DEFAULT_STUDIO_TILT_SHIFT_BLUR_OPTIONS.feather,
    ),
    maximumBlurRadius: clampFinite(
      value?.maximumBlurRadius,
      0.25,
      18,
      DEFAULT_STUDIO_TILT_SHIFT_BLUR_OPTIONS.maximumBlurRadius,
    ),
    sampleCount: clampInteger(
      value?.sampleCount,
      5,
      64,
      DEFAULT_STUDIO_TILT_SHIFT_BLUR_OPTIONS.sampleCount,
    ),
  };
}

export function normalizeStudioSelectiveGaussianBlurOptions(
  value?: Partial<StudioSelectiveGaussianBlurOptions> | null,
): StudioSelectiveGaussianBlurOptions {
  return {
    radius: clampInteger(
      value?.radius,
      1,
      10,
      DEFAULT_STUDIO_SELECTIVE_GAUSSIAN_BLUR_OPTIONS.radius,
    ),
    spatialSigma: clampFinite(
      value?.spatialSigma,
      0.1,
      20,
      DEFAULT_STUDIO_SELECTIVE_GAUSSIAN_BLUR_OPTIONS.spatialSigma,
    ),
    edgeThreshold: clampFinite(
      value?.edgeThreshold,
      0,
      255,
      DEFAULT_STUDIO_SELECTIVE_GAUSSIAN_BLUR_OPTIONS.edgeThreshold,
    ),
    edgeSoftness: clampFinite(
      value?.edgeSoftness,
      0,
      2,
      DEFAULT_STUDIO_SELECTIVE_GAUSSIAN_BLUR_OPTIONS.edgeSoftness,
    ),
  };
}

function boundedProduct(left: number, right: number): number {
  if (left === 0 || right === 0) return 0;
  return left > Number.MAX_SAFE_INTEGER / right
    ? Number.MAX_SAFE_INTEGER
    : left * right;
}

function sourceSamplesPerPixel(
  kernel: StudioAdvancedBlurKernelId,
  options:
    | StudioLensBlurOptions
    | StudioFieldIrisBlurOptions
    | StudioTiltShiftBlurOptions
    | StudioSelectiveGaussianBlurOptions,
): number {
  if (kernel === "selective-gaussian-blur") {
    const radius = (options as StudioSelectiveGaussianBlurOptions).radius;
    return (radius * 2 + 1) ** 2;
  }
  return (options as StudioLensBlurOptions | StudioFieldIrisBlurOptions | StudioTiltShiftBlurOptions)
    .sampleCount * 4;
}

function optionsFromAttrs(
  kernel: StudioAdvancedBlurKernelId,
  attrs: NumberRecord,
):
  | StudioLensBlurOptions
  | StudioFieldIrisBlurOptions
  | StudioTiltShiftBlurOptions
  | StudioSelectiveGaussianBlurOptions {
  if (kernel === "lens-blur") {
    return normalizeStudioLensBlurOptions({
      radius: attrs.lensBlurRadius as number | undefined,
      sampleCount: attrs.lensBlurSampleCount as number | undefined,
      apertureBlades: attrs.lensBlurApertureBlades as number | undefined,
      apertureRotationRadians: attrs.lensBlurApertureRotation as number | undefined,
    });
  }
  if (kernel === "field-iris-blur") {
    return normalizeStudioFieldIrisBlurOptions({
      focusCenterX: attrs.fieldIrisFocusCenterX as number | undefined,
      focusCenterY: attrs.fieldIrisFocusCenterY as number | undefined,
      focusRadius: attrs.fieldIrisFocusRadius as number | undefined,
      feather: attrs.fieldIrisFeather as number | undefined,
      maximumBlurRadius: attrs.fieldIrisMaximumRadius as number | undefined,
      sampleCount: attrs.fieldIrisSampleCount as number | undefined,
      apertureBlades: attrs.fieldIrisApertureBlades as number | undefined,
    });
  }
  if (kernel === "tilt-shift-blur") {
    return normalizeStudioTiltShiftBlurOptions({
      axisRadians: attrs.tiltShiftAxis as number | undefined,
      focusWidth: attrs.tiltShiftFocusWidth as number | undefined,
      feather: attrs.tiltShiftFeather as number | undefined,
      maximumBlurRadius: attrs.tiltShiftMaximumRadius as number | undefined,
      sampleCount: attrs.tiltShiftSampleCount as number | undefined,
    });
  }
  return normalizeStudioSelectiveGaussianBlurOptions({
    radius: attrs.selectiveGaussianRadius as number | undefined,
    spatialSigma: attrs.selectiveGaussianSpatialSigma as number | undefined,
    edgeThreshold: attrs.selectiveGaussianEdgeThreshold as number | undefined,
    edgeSoftness: attrs.selectiveGaussianEdgeSoftness as number | undefined,
  });
}

function applyAdvancedBlur(
  kernel: StudioAdvancedBlurKernelId,
  imageData: StudioImageDataLike,
  filterThis: FilterThis,
): void {
  const attrs = filterThis.attrs ?? {};
  const options = optionsFromAttrs(kernel, attrs);
  const pixelCount = boundedProduct(imageData.width, imageData.height);
  const sourceSamples = boundedProduct(pixelCount, sourceSamplesPerPixel(kernel, options));
  if (
    attrs.advancedBlurExecution !== "worker"
    && sourceSamples > STUDIO_ADVANCED_BLUR_DIRECT_MAX_SOURCE_SAMPLES
  ) {
    return;
  }
  const result = kernel === "lens-blur"
    ? applyStudioAdvancedBlurFilter({
        kernel,
        source: imageData,
        options: options as StudioLensBlurOptions,
      })
    : kernel === "field-iris-blur"
      ? applyStudioAdvancedBlurFilter({
          kernel,
          source: imageData,
          options: options as StudioFieldIrisBlurOptions,
        })
      : kernel === "tilt-shift-blur"
        ? applyStudioAdvancedBlurFilter({
            kernel,
            source: imageData,
            options: options as StudioTiltShiftBlurOptions,
          })
        : applyStudioAdvancedBlurFilter({
            kernel,
            source: imageData,
            options: options as StudioSelectiveGaussianBlurOptions,
          });
  if (result.status === "applied") imageData.data.set(result.image.data);
}

export function lensBlurKonvaFilter(this: FilterThis, imageData: StudioImageDataLike): void {
  applyAdvancedBlur("lens-blur", imageData, this);
}

export function fieldIrisBlurKonvaFilter(this: FilterThis, imageData: StudioImageDataLike): void {
  applyAdvancedBlur("field-iris-blur", imageData, this);
}

export function tiltShiftBlurKonvaFilter(this: FilterThis, imageData: StudioImageDataLike): void {
  applyAdvancedBlur("tilt-shift-blur", imageData, this);
}

export function selectiveGaussianBlurKonvaFilter(
  this: FilterThis,
  imageData: StudioImageDataLike,
): void {
  applyAdvancedBlur("selective-gaussian-blur", imageData, this);
}

type AdvancedBlurCandidate = {
  readonly engine: StudioAdvancedBlurKernelId;
  readonly options:
    | StudioLensBlurOptions
    | StudioFieldIrisBlurOptions
    | StudioTiltShiftBlurOptions
    | StudioSelectiveGaussianBlurOptions;
};

function directCandidates(el: ImageFilterFields): AdvancedBlurCandidate[] {
  const candidates: AdvancedBlurCandidate[] = [];
  if (el.lensBlur) {
    candidates.push({ engine: "lens-blur", options: normalizeStudioLensBlurOptions(el.lensBlur) });
  }
  if (el.fieldIrisBlur) {
    candidates.push({
      engine: "field-iris-blur",
      options: normalizeStudioFieldIrisBlurOptions(el.fieldIrisBlur),
    });
  }
  if (el.tiltShiftBlur) {
    candidates.push({
      engine: "tilt-shift-blur",
      options: normalizeStudioTiltShiftBlurOptions(el.tiltShiftBlur),
    });
  }
  if (el.selectiveGaussianBlur) {
    candidates.push({
      engine: "selective-gaussian-blur",
      options: normalizeStudioSelectiveGaussianBlurOptions(el.selectiveGaussianBlur),
    });
  }
  return candidates;
}

function operationCandidates(el: ImageFilterFields): AdvancedBlurCandidate[] {
  const source = el.smartFilterOperations !== undefined
    ? el.smartFilterOperations
    : el.smartFilters?.entries ?? [];
  const candidates: AdvancedBlurCandidate[] = [];
  for (const entry of source) {
    if (!entry || entry.enabled === false) continue;
    const params = entry.params ?? {};
    if (entry.engine === "lens-blur") {
      candidates.push({ engine: entry.engine, options: normalizeStudioLensBlurOptions(params) });
    } else if (entry.engine === "field-iris-blur") {
      candidates.push({
        engine: entry.engine,
        options: normalizeStudioFieldIrisBlurOptions(params),
      });
    } else if (entry.engine === "tilt-shift-blur") {
      candidates.push({
        engine: entry.engine,
        options: normalizeStudioTiltShiftBlurOptions(params),
      });
    } else if (entry.engine === "selective-gaussian-blur") {
      candidates.push({
        engine: entry.engine,
        options: normalizeStudioSelectiveGaussianBlurOptions(params),
      });
    }
  }
  return candidates;
}

export function studioAdvancedBlurSourceSampleEstimate(
  el: ImageFilterFields,
  width: number,
  height: number,
): number {
  const pixels = boundedProduct(
    Number.isSafeInteger(width) && width > 0 ? width : Number.MAX_SAFE_INTEGER,
    Number.isSafeInteger(height) && height > 0 ? height : Number.MAX_SAFE_INTEGER,
  );
  let samples = 0;
  for (const candidate of [...directCandidates(el), ...operationCandidates(el)]) {
    const next = boundedProduct(
      pixels,
      sourceSamplesPerPixel(candidate.engine, candidate.options),
    );
    samples = samples > Number.MAX_SAFE_INTEGER - next
      ? Number.MAX_SAFE_INTEGER
      : samples + next;
  }
  return samples;
}

export function studioAdvancedBlurRequiresWorker(
  el: ImageFilterFields,
  width: number,
  height: number,
): boolean {
  return studioAdvancedBlurSourceSampleEstimate(el, width, height)
    > STUDIO_ADVANCED_BLUR_DIRECT_MAX_SOURCE_SAMPLES;
}

export class StudioAdvancedBlurWorkerRequiredError extends Error {
  readonly code = "STUDIO_ADVANCED_BLUR_WORKER_REQUIRED";

  constructor() {
    super("이 고급 블러는 큰 이미지에서 CPU Worker가 필요합니다.");
    this.name = "StudioAdvancedBlurWorkerRequiredError";
  }
}
