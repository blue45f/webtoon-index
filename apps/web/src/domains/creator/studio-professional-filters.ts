/**
 * Product boundary for the immutable professional-filter CPU oracles.
 *
 * Tiny jobs can preselect Konva's direct lane. Expensive jobs must use the module Worker;
 * direct execution fails closed before the kernel allocates. Ordered smart stacks are costed with
 * duplicates intact so a cheap individual filter cannot hide an expensive combined job.
 */

import { normalizeColorToAlpha, type ColorToAlpha } from "./studio-color-to-alpha";
import {
  applyStudioProfessionalFilter,
  normalizeStudioDifferenceOfGaussiansOptions,
  normalizeStudioDustScratchesOptions,
  normalizeStudioTileableBlurOptions,
  type StudioDifferenceOfGaussiansOptions,
  type StudioDustScratchesOptions,
  type StudioProfessionalFilterKernelId,
  type StudioTileableBlurOptions,
} from "./studio-professional-filter-kernels";

import type { ImageFilterFields } from "./render/studio-konva-filter-fields";
import type { StudioImageDataLike } from "./studio-filters";

export type StudioProfessionalFilterExecution = "direct" | "worker";

export const STUDIO_PROFESSIONAL_FILTER_ENGINE_IDS = [
  "color-to-alpha",
  "difference-of-gaussians",
  "dust-scratches",
  "tileable-blur",
] as const satisfies readonly StudioProfessionalFilterKernelId[];

export const STUDIO_PROFESSIONAL_FILTER_DIRECT_MAX_WORK_UNITS = 8_000_000;

type FilterThis = { attrs?: Record<string, unknown> };
type ProfessionalOptions =
  | ColorToAlpha
  | StudioDifferenceOfGaussiansOptions
  | StudioDustScratchesOptions
  | StudioTileableBlurOptions;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function boundedProduct(left: number, right: number): number {
  if (left === 0 || right === 0) return 0;
  return left > Number.MAX_SAFE_INTEGER / right ? Number.MAX_SAFE_INTEGER : left * right;
}

function workPerPixel(
  engine: StudioProfessionalFilterKernelId,
  options: ProfessionalOptions,
): number {
  if (engine === "color-to-alpha") return 1;
  if (engine === "difference-of-gaussians") {
    const normalized = options as StudioDifferenceOfGaussiansOptions;
    const small = Math.ceil(normalized.smallSigma * 3) * 2 + 1;
    const large = Math.ceil(normalized.largeSigma * 3) * 2 + 1;
    return 2 * (small + large);
  }
  if (engine === "dust-scratches") {
    const radius = (options as StudioDustScratchesOptions).radius;
    return ((radius * 2 + 1) ** 2) * 3;
  }
  return ((options as StudioTileableBlurOptions).radius * 2 + 1) * 6;
}

function optionsFromAttrs(
  engine: StudioProfessionalFilterKernelId,
  attrs: Record<string, unknown>,
): ProfessionalOptions {
  if (engine === "color-to-alpha") {
    return normalizeColorToAlpha({
      keyColor: typeof attrs.ctaColor === "string" ? attrs.ctaColor : undefined,
      strength: finite(attrs.ctaStrength) ? attrs.ctaStrength : undefined,
    });
  }
  if (engine === "difference-of-gaussians") {
    return normalizeStudioDifferenceOfGaussiansOptions({
      smallSigma: attrs.dogSmallSigma,
      largeSigma: attrs.dogLargeSigma,
      threshold: attrs.dogThreshold,
      strength: attrs.dogStrength,
    });
  }
  if (engine === "dust-scratches") {
    return normalizeStudioDustScratchesOptions({
      radius: attrs.dustScratchRadius,
      threshold: attrs.dustScratchThreshold,
      strength: attrs.dustScratchStrength,
    });
  }
  return normalizeStudioTileableBlurOptions({
    radius: attrs.tileableBlurRadius,
    sigma: attrs.tileableBlurSigma,
    strength: attrs.tileableBlurStrength,
  });
}

function applyProfessionalFilter(
  engine: StudioProfessionalFilterKernelId,
  image: StudioImageDataLike,
  filterThis: FilterThis,
): void {
  const attrs = filterThis.attrs ?? {};
  const options = optionsFromAttrs(engine, attrs);
  const work = boundedProduct(
    boundedProduct(image.width, image.height),
    workPerPixel(engine, options),
  );
  if (
    attrs.professionalFilterExecution !== "worker"
    && work > STUDIO_PROFESSIONAL_FILTER_DIRECT_MAX_WORK_UNITS
  ) {
    return;
  }
  const result = engine === "color-to-alpha"
    ? applyStudioProfessionalFilter({ kernel: engine, source: image, options })
    : engine === "difference-of-gaussians"
      ? applyStudioProfessionalFilter({ kernel: engine, source: image, options })
      : engine === "dust-scratches"
        ? applyStudioProfessionalFilter({ kernel: engine, source: image, options })
        : applyStudioProfessionalFilter({ kernel: engine, source: image, options });
  if (result.status === "applied") image.data.set(result.image.data);
}

export function professionalColorToAlphaKonvaFilter(
  this: FilterThis,
  image: StudioImageDataLike,
): void {
  applyProfessionalFilter("color-to-alpha", image, this);
}

export function differenceOfGaussiansKonvaFilter(
  this: FilterThis,
  image: StudioImageDataLike,
): void {
  applyProfessionalFilter("difference-of-gaussians", image, this);
}

export function dustScratchesKonvaFilter(
  this: FilterThis,
  image: StudioImageDataLike,
): void {
  applyProfessionalFilter("dust-scratches", image, this);
}

export function tileableBlurKonvaFilter(
  this: FilterThis,
  image: StudioImageDataLike,
): void {
  applyProfessionalFilter("tileable-blur", image, this);
}

type Candidate = {
  readonly engine: StudioProfessionalFilterKernelId;
  readonly options: ProfessionalOptions;
};

function directCandidates(el: ImageFilterFields): Candidate[] {
  const candidates: Candidate[] = [];
  const colorToAlpha = normalizeColorToAlpha(el.colorToAlpha);
  if (el.colorToAlpha && colorToAlpha.strength > 0) {
    candidates.push({ engine: "color-to-alpha", options: colorToAlpha });
  }
  if (el.differenceOfGaussians) {
    const options = normalizeStudioDifferenceOfGaussiansOptions(el.differenceOfGaussians);
    if (options.strength > 0) {
      candidates.push({ engine: "difference-of-gaussians", options });
    }
  }
  if (el.dustScratches) {
    const options = normalizeStudioDustScratchesOptions(el.dustScratches);
    if (options.strength > 0) candidates.push({ engine: "dust-scratches", options });
  }
  if (el.tileableBlur) {
    const options = normalizeStudioTileableBlurOptions(el.tileableBlur);
    if (options.strength > 0) candidates.push({ engine: "tileable-blur", options });
  }
  return candidates;
}

function operationCandidates(el: ImageFilterFields): Candidate[] {
  const source = el.smartFilterOperations !== undefined
    ? el.smartFilterOperations
    : el.smartFilters?.entries ?? [];
  const candidates: Candidate[] = [];
  for (const entry of source) {
    if (!entry || entry.enabled === false) continue;
    const params = entry.params ?? {};
    if (entry.engine === "color-to-alpha") {
      const options = normalizeColorToAlpha({
        keyColor: typeof params.keyColor === "string" ? params.keyColor : undefined,
        strength: finite(params.strength) ? params.strength : undefined,
      });
      if (options.strength > 0) candidates.push({ engine: entry.engine, options });
    } else if (entry.engine === "difference-of-gaussians") {
      const options = normalizeStudioDifferenceOfGaussiansOptions(params);
      if (options.strength > 0) candidates.push({ engine: entry.engine, options });
    } else if (entry.engine === "dust-scratches") {
      const options = normalizeStudioDustScratchesOptions(params);
      if (options.strength > 0) candidates.push({ engine: entry.engine, options });
    } else if (entry.engine === "tileable-blur") {
      const options = normalizeStudioTileableBlurOptions(params);
      if (options.strength > 0) candidates.push({ engine: entry.engine, options });
    }
  }
  return candidates;
}

export function studioProfessionalFilterWorkEstimate(
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
    const next = boundedProduct(pixels, workPerPixel(candidate.engine, candidate.options));
    total = total > Number.MAX_SAFE_INTEGER - next ? Number.MAX_SAFE_INTEGER : total + next;
  }
  return total;
}

export function studioProfessionalFilterRequiresWorker(
  el: ImageFilterFields,
  width: number,
  height: number,
): boolean {
  return studioProfessionalFilterWorkEstimate(el, width, height)
    > STUDIO_PROFESSIONAL_FILTER_DIRECT_MAX_WORK_UNITS;
}

export class StudioProfessionalFilterWorkerRequiredError extends Error {
  readonly code = "STUDIO_PROFESSIONAL_FILTER_WORKER_REQUIRED";

  constructor() {
    super("이 전문 필터는 큰 이미지에서 CPU Worker가 필요합니다.");
    this.name = "StudioProfessionalFilterWorkerRequiredError";
  }
}
