/**
 * Product adapters for the pure tone/artifact cleanup kernels.
 *
 * The kernel module returns an immutable result receipt. Konva and the module Worker expect
 * in-place ImageData filters, so this boundary copies an accepted output back into the caller's
 * exact RGBA extent. Refused work remains a deterministic no-op.
 */
import {
  denoiseStudioRgba,
  normalizeStudioEdgeAwareDenoiseOptions,
  normalizeStudioJpegArtifactReductionOptions,
  normalizeStudioScreentoneRemovalOptions,
  reduceStudioJpegArtifacts,
  removeStudioScreentoneArtifacts,
  type StudioEdgeAwareDenoiseOptions,
  type StudioJpegArtifactReductionOptions,
  type StudioScreentoneRemovalOptions,
  type StudioToneArtifactAppliedResult,
} from "./studio-tone-artifact-filter-kernels";

import type { ImageFilterFields } from "./render/studio-konva-filter-fields";
import type { StudioImageDataLike } from "./studio-filters";

type FilterThis = { attrs?: Record<string, unknown> };

export type StudioToneArtifactExecution = "direct" | "worker";

export const STUDIO_TONE_ARTIFACT_ENGINE_IDS = [
  "screentone-removal",
  "jpeg-artifact-reduction",
  "edge-aware-denoise",
] as const;

export type StudioToneArtifactEngineId = typeof STUDIO_TONE_ARTIFACT_ENGINE_IDS[number];

/** Interactive main-thread fallback budget; the Worker may use the larger immutable-kernel cap. */
export const STUDIO_TONE_ARTIFACT_DIRECT_MAX_NEIGHBORHOOD_SAMPLES = 8_000_000;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function boundedProduct(left: number, right: number): number {
  if (left === 0 || right === 0) return 0;
  return left > Number.MAX_SAFE_INTEGER / right ? Number.MAX_SAFE_INTEGER : left * right;
}

type ToneArtifactOptions =
  | StudioScreentoneRemovalOptions
  | StudioJpegArtifactReductionOptions
  | StudioEdgeAwareDenoiseOptions;

function samplesPerPixel(
  engine: StudioToneArtifactEngineId,
  options: ToneArtifactOptions,
): number {
  if (engine === "jpeg-artifact-reduction") return 18;
  const radius = (
    options as StudioScreentoneRemovalOptions | StudioEdgeAwareDenoiseOptions
  ).radius;
  return (radius * 2 + 1) ** 2;
}

function shouldRefuseDirect(
  engine: StudioToneArtifactEngineId,
  options: ToneArtifactOptions,
  image: StudioImageDataLike,
  attrs: Record<string, unknown>,
): boolean {
  return attrs.toneArtifactExecution !== "worker"
    && boundedProduct(
      boundedProduct(image.width, image.height),
      samplesPerPixel(engine, options),
    ) > STUDIO_TONE_ARTIFACT_DIRECT_MAX_NEIGHBORHOOD_SAMPLES;
}

export function isIdentityStudioScreentoneRemoval(value?: unknown): boolean {
  return normalizeStudioScreentoneRemovalOptions(value).strength <= 0;
}

export function isIdentityStudioJpegArtifactReduction(value?: unknown): boolean {
  const normalized = normalizeStudioJpegArtifactReductionOptions(value);
  return normalized.deblockStrength <= 0 && normalized.deringStrength <= 0;
}

export function isIdentityStudioEdgeAwareDenoise(value?: unknown): boolean {
  return normalizeStudioEdgeAwareDenoiseOptions(value).strength <= 0;
}

/** Copies only a valid applied receipt. Refusals and extent mismatches fail closed. */
export function applyStudioToneArtifactResultInPlace(
  image: StudioImageDataLike,
  result: StudioToneArtifactAppliedResult,
): boolean {
  if (
    result.status !== "applied"
    || result.image.width !== image.width
    || result.image.height !== image.height
    || result.image.data.length !== image.data.length
  ) {
    return false;
  }
  image.data.set(result.image.data);
  return true;
}

export function screentoneRemovalKonvaFilter(
  this: FilterThis,
  image: StudioImageDataLike,
): void {
  const attrs = this.attrs;
  if (!attrs || !finite(attrs.toneRemovalStrength)) return;
  const options: Partial<StudioScreentoneRemovalOptions> = {
    radius: finite(attrs.toneRemovalRadius) ? attrs.toneRemovalRadius : undefined,
    strength: attrs.toneRemovalStrength,
    inkLumaThreshold: finite(attrs.toneRemovalInkThreshold)
      ? attrs.toneRemovalInkThreshold
      : undefined,
  };
  const normalized = normalizeStudioScreentoneRemovalOptions(options);
  if (shouldRefuseDirect("screentone-removal", normalized, image, attrs)) return;
  applyStudioToneArtifactResultInPlace(
    image,
    removeStudioScreentoneArtifacts(image, normalized),
  );
}

export function jpegArtifactReductionKonvaFilter(
  this: FilterThis,
  image: StudioImageDataLike,
): void {
  const attrs = this.attrs;
  if (
    !attrs
    || (!finite(attrs.jpegDeblockStrength) && !finite(attrs.jpegDeringStrength))
  ) {
    return;
  }
  const options: Partial<StudioJpegArtifactReductionOptions> = {
    deblockStrength: finite(attrs.jpegDeblockStrength)
      ? attrs.jpegDeblockStrength
      : undefined,
    deringStrength: finite(attrs.jpegDeringStrength)
      ? attrs.jpegDeringStrength
      : undefined,
    boundaryThreshold: finite(attrs.jpegBoundaryThreshold)
      ? attrs.jpegBoundaryThreshold
      : undefined,
    protectedEdgeThreshold: finite(attrs.jpegProtectedEdgeThreshold)
      ? attrs.jpegProtectedEdgeThreshold
      : undefined,
    ringingThreshold: finite(attrs.jpegRingingThreshold)
      ? attrs.jpegRingingThreshold
      : undefined,
    inkLumaThreshold: finite(attrs.jpegInkThreshold)
      ? attrs.jpegInkThreshold
      : undefined,
  };
  const normalized = normalizeStudioJpegArtifactReductionOptions(options);
  if (shouldRefuseDirect("jpeg-artifact-reduction", normalized, image, attrs)) return;
  applyStudioToneArtifactResultInPlace(
    image,
    reduceStudioJpegArtifacts(image, normalized),
  );
}

export function edgeAwareDenoiseKonvaFilter(
  this: FilterThis,
  image: StudioImageDataLike,
): void {
  const attrs = this.attrs;
  if (!attrs || !finite(attrs.edgeDenoiseStrength)) return;
  const options: Partial<StudioEdgeAwareDenoiseOptions> = {
    radius: finite(attrs.edgeDenoiseRadius) ? attrs.edgeDenoiseRadius : undefined,
    strength: attrs.edgeDenoiseStrength,
    rangeThreshold: finite(attrs.edgeDenoiseRangeThreshold)
      ? attrs.edgeDenoiseRangeThreshold
      : undefined,
  };
  const normalized = normalizeStudioEdgeAwareDenoiseOptions(options);
  if (shouldRefuseDirect("edge-aware-denoise", normalized, image, attrs)) return;
  applyStudioToneArtifactResultInPlace(
    image,
    denoiseStudioRgba(image, normalized),
  );
}

type Candidate = {
  readonly engine: StudioToneArtifactEngineId;
  readonly options: ToneArtifactOptions;
};

function directCandidates(el: ImageFilterFields): Candidate[] {
  const candidates: Candidate[] = [];
  if (el.screentoneRemoval && !isIdentityStudioScreentoneRemoval(el.screentoneRemoval)) {
    candidates.push({
      engine: "screentone-removal",
      options: normalizeStudioScreentoneRemovalOptions(el.screentoneRemoval),
    });
  }
  if (
    el.jpegArtifactReduction
    && !isIdentityStudioJpegArtifactReduction(el.jpegArtifactReduction)
  ) {
    candidates.push({
      engine: "jpeg-artifact-reduction",
      options: normalizeStudioJpegArtifactReductionOptions(el.jpegArtifactReduction),
    });
  }
  if (el.edgeAwareDenoise && !isIdentityStudioEdgeAwareDenoise(el.edgeAwareDenoise)) {
    candidates.push({
      engine: "edge-aware-denoise",
      options: normalizeStudioEdgeAwareDenoiseOptions(el.edgeAwareDenoise),
    });
  }
  return candidates;
}

function operationCandidates(el: ImageFilterFields): Candidate[] {
  const operations = el.smartFilterOperations !== undefined
    ? el.smartFilterOperations
    : el.smartFilters?.entries ?? [];
  const candidates: Candidate[] = [];
  for (const operation of operations) {
    if (!operation || operation.enabled === false) continue;
    const params = operation.params ?? {};
    if (
      operation.engine === "screentone-removal"
      && !isIdentityStudioScreentoneRemoval(params)
    ) {
      candidates.push({
        engine: operation.engine,
        options: normalizeStudioScreentoneRemovalOptions(params),
      });
    } else if (
      operation.engine === "jpeg-artifact-reduction"
      && !isIdentityStudioJpegArtifactReduction(params)
    ) {
      candidates.push({
        engine: operation.engine,
        options: normalizeStudioJpegArtifactReductionOptions(params),
      });
    } else if (
      operation.engine === "edge-aware-denoise"
      && !isIdentityStudioEdgeAwareDenoise(params)
    ) {
      candidates.push({
        engine: operation.engine,
        options: normalizeStudioEdgeAwareDenoiseOptions(params),
      });
    }
  }
  return candidates;
}

export function studioToneArtifactNeighborhoodSampleEstimate(
  el: ImageFilterFields,
  width: number,
  height: number,
): number {
  const pixels = boundedProduct(
    Number.isSafeInteger(width) && width > 0 ? width : Number.MAX_SAFE_INTEGER,
    Number.isSafeInteger(height) && height > 0 ? height : Number.MAX_SAFE_INTEGER,
  );
  let total = 0;
  for (const candidate of [...directCandidates(el), ...operationCandidates(el)]) {
    const next = boundedProduct(
      pixels,
      samplesPerPixel(candidate.engine, candidate.options),
    );
    total = total > Number.MAX_SAFE_INTEGER - next
      ? Number.MAX_SAFE_INTEGER
      : total + next;
  }
  return total;
}

export function studioToneArtifactRequiresWorker(
  el: ImageFilterFields,
  width: number,
  height: number,
): boolean {
  return studioToneArtifactNeighborhoodSampleEstimate(el, width, height)
    > STUDIO_TONE_ARTIFACT_DIRECT_MAX_NEIGHBORHOOD_SAMPLES;
}

export class StudioToneArtifactWorkerRequiredError extends Error {
  readonly code = "STUDIO_TONE_ARTIFACT_WORKER_REQUIRED";

  constructor() {
    super("이 톤·압축 정리 필터는 큰 이미지에서 CPU Worker가 필요합니다.");
    this.name = "StudioToneArtifactWorkerRequiredError";
  }
}
