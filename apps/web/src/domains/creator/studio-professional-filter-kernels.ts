/**
 * Immutable CPU oracles for four professional filters missing from the executable catalog.
 *
 * The kernels have no DOM/Canvas/Worker dependency. They validate the exact RGBA extent and the
 * complete work estimate before allocating, keep the caller-owned source immutable, and expose
 * the same byte result to direct tests, Konva adapters, and the module Worker.
 */

import {
  applyColorToAlpha,
  normalizeColorToAlpha,
  type ColorToAlpha,
} from "./studio-color-to-alpha";

export interface StudioProfessionalRgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export type StudioProfessionalFilterKernelId =
  | "color-to-alpha"
  | "difference-of-gaussians"
  | "dust-scratches"
  | "tileable-blur";

export interface StudioDifferenceOfGaussiansOptions {
  readonly smallSigma: number;
  readonly largeSigma: number;
  readonly threshold: number;
  readonly strength: number;
}

export interface StudioDustScratchesOptions {
  readonly radius: number;
  readonly threshold: number;
  readonly strength: number;
}

export interface StudioTileableBlurOptions {
  readonly radius: number;
  readonly sigma: number;
  readonly strength: number;
}

export interface StudioProfessionalFilterWorkBudget {
  readonly maxPixels: number;
  readonly maxSamples: number;
  readonly maxWorkingBytes: number;
}

export interface StudioProfessionalFilterWorkReceipt {
  readonly pixels: number;
  readonly samples: number;
  readonly workingBytes: number;
  readonly budget: StudioProfessionalFilterWorkBudget;
}

export type StudioProfessionalFilterRequest =
  | {
      readonly kernel: "color-to-alpha";
      readonly source: StudioProfessionalRgbaImage;
      readonly options?: Partial<ColorToAlpha> | null;
    }
  | {
      readonly kernel: "difference-of-gaussians";
      readonly source: StudioProfessionalRgbaImage;
      readonly options?: Partial<StudioDifferenceOfGaussiansOptions> | null;
    }
  | {
      readonly kernel: "dust-scratches";
      readonly source: StudioProfessionalRgbaImage;
      readonly options?: Partial<StudioDustScratchesOptions> | null;
    }
  | {
      readonly kernel: "tileable-blur";
      readonly source: StudioProfessionalRgbaImage;
      readonly options?: Partial<StudioTileableBlurOptions> | null;
    };

export type StudioProfessionalFilterResult =
  | {
      readonly status: "applied";
      readonly kernel: StudioProfessionalFilterKernelId;
      readonly image: StudioProfessionalRgbaImage;
      readonly work: StudioProfessionalFilterWorkReceipt;
      readonly alphaPolicy: "preserved" | "derived";
      readonly changedPixelCount: number;
    }
  | {
      readonly status: "refused";
      readonly kernel: StudioProfessionalFilterKernelId;
      readonly reason: "invalid-image" | "invalid-budget" | "budget-exceeded";
      readonly detail: string;
      readonly work?: StudioProfessionalFilterWorkReceipt;
    };

export const DEFAULT_STUDIO_PROFESSIONAL_FILTER_WORK_BUDGET:
StudioProfessionalFilterWorkBudget = Object.freeze({
  maxPixels: 16_777_216,
  maxSamples: 600_000_000,
  maxWorkingBytes: 536_870_912,
});

export const DEFAULT_STUDIO_DIFFERENCE_OF_GAUSSIANS:
StudioDifferenceOfGaussiansOptions = Object.freeze({
  smallSigma: 0.8,
  largeSigma: 2,
  threshold: 1.5,
  strength: 12,
});

export const DEFAULT_STUDIO_DUST_SCRATCHES: StudioDustScratchesOptions =
  Object.freeze({ radius: 2, threshold: 24, strength: 1 });

export const DEFAULT_STUDIO_TILEABLE_BLUR: StudioTileableBlurOptions =
  Object.freeze({ radius: 5, sigma: 2.2, strength: 1 });

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function boundedProduct(left: number, right: number): number {
  if (left === 0 || right === 0) return 0;
  return left > Number.MAX_SAFE_INTEGER / right ? Number.MAX_SAFE_INTEGER : left * right;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function normalizeStudioDifferenceOfGaussiansOptions(
  value?: unknown,
): StudioDifferenceOfGaussiansOptions {
  const source = asRecord(value);
  const smallSigma = clamp(
    finite(source.smallSigma, DEFAULT_STUDIO_DIFFERENCE_OF_GAUSSIANS.smallSigma),
    0.25,
    6,
  );
  return {
    smallSigma,
    largeSigma: clamp(
      finite(source.largeSigma, DEFAULT_STUDIO_DIFFERENCE_OF_GAUSSIANS.largeSigma),
      smallSigma + 0.1,
      12,
    ),
    threshold: clamp(
      finite(source.threshold, DEFAULT_STUDIO_DIFFERENCE_OF_GAUSSIANS.threshold),
      0,
      64,
    ),
    strength: clamp(
      finite(source.strength, DEFAULT_STUDIO_DIFFERENCE_OF_GAUSSIANS.strength),
      0,
      32,
    ),
  };
}

export function normalizeStudioDustScratchesOptions(
  value?: unknown,
): StudioDustScratchesOptions {
  const source = asRecord(value);
  return {
    radius: Math.round(clamp(
      finite(source.radius, DEFAULT_STUDIO_DUST_SCRATCHES.radius),
      1,
      5,
    )),
    threshold: clamp(
      finite(source.threshold, DEFAULT_STUDIO_DUST_SCRATCHES.threshold),
      0,
      255,
    ),
    strength: clamp(
      finite(source.strength, DEFAULT_STUDIO_DUST_SCRATCHES.strength),
      0,
      1,
    ),
  };
}

export function normalizeStudioTileableBlurOptions(
  value?: unknown,
): StudioTileableBlurOptions {
  const source = asRecord(value);
  return {
    radius: Math.round(clamp(
      finite(source.radius, DEFAULT_STUDIO_TILEABLE_BLUR.radius),
      1,
      20,
    )),
    sigma: clamp(finite(source.sigma, DEFAULT_STUDIO_TILEABLE_BLUR.sigma), 0.1, 20),
    strength: clamp(
      finite(source.strength, DEFAULT_STUDIO_TILEABLE_BLUR.strength),
      0,
      1,
    ),
  };
}

type ValidImage = StudioProfessionalRgbaImage & {
  readonly pixels: number;
  readonly bytes: number;
};
type ProfessionalRefusal = Extract<
  StudioProfessionalFilterResult,
  { status: "refused" }
>;
type PreparedWork = {
  readonly image: ValidImage;
  readonly work: StudioProfessionalFilterWorkReceipt;
};

function inspectImage(source: StudioProfessionalRgbaImage): ValidImage | null {
  if (
    source === null
    || typeof source !== "object"
    || !Number.isSafeInteger(source.width)
    || !Number.isSafeInteger(source.height)
    || source.width <= 0
    || source.height <= 0
    || !(source.data instanceof Uint8ClampedArray)
  ) {
    return null;
  }
  const pixels = boundedProduct(source.width, source.height);
  const bytes = boundedProduct(pixels, 4);
  if (
    pixels === Number.MAX_SAFE_INTEGER
    || bytes === Number.MAX_SAFE_INTEGER
    || source.data.length !== bytes
  ) {
    return null;
  }
  return { ...source, pixels, bytes };
}

function inspectBudget(
  value: StudioProfessionalFilterWorkBudget,
): StudioProfessionalFilterWorkBudget | null {
  if (
    value === null
    || typeof value !== "object"
    || !Number.isSafeInteger(value.maxPixels)
    || !Number.isSafeInteger(value.maxSamples)
    || !Number.isSafeInteger(value.maxWorkingBytes)
    || value.maxPixels <= 0
    || value.maxSamples <= 0
    || value.maxWorkingBytes <= 0
  ) {
    return null;
  }
  return value;
}

function workFor(
  kernel: StudioProfessionalFilterKernelId,
  source: StudioProfessionalRgbaImage,
  samplesPerPixel: number,
  bytesPerPixel: number,
  budgetInput: StudioProfessionalFilterWorkBudget,
): PreparedWork | ProfessionalRefusal {
  const image = inspectImage(source);
  if (!image) {
    return {
      status: "refused",
      kernel,
      reason: "invalid-image",
      detail: "Expected positive safe dimensions and one exact Uint8ClampedArray RGBA extent.",
    };
  }
  const budget = inspectBudget(budgetInput);
  if (!budget) {
    return {
      status: "refused",
      kernel,
      reason: "invalid-budget",
      detail: "All work-budget limits must be positive safe integers.",
    };
  }
  const work: StudioProfessionalFilterWorkReceipt = {
    pixels: image.pixels,
    samples: boundedProduct(image.pixels, samplesPerPixel),
    workingBytes: boundedProduct(image.pixels, bytesPerPixel),
    budget,
  };
  if (
    work.pixels > budget.maxPixels
    || work.samples > budget.maxSamples
    || work.workingBytes > budget.maxWorkingBytes
  ) {
    return {
      status: "refused",
      kernel,
      reason: "budget-exceeded",
      detail: "The filter was refused before allocating output or scratch buffers.",
      work,
    };
  }
  return { image, work };
}

function isRefused(
  value: ReturnType<typeof workFor>,
): value is ProfessionalRefusal {
  return "status" in value;
}

function gaussianWeights(sigma: number, requestedRadius?: number): Float32Array {
  const radius = requestedRadius === undefined
    ? Math.max(1, Math.ceil(sigma * 3))
    : Math.max(1, Math.round(requestedRadius));
  const weights = new Float32Array(radius * 2 + 1);
  let total = 0;
  for (let index = -radius; index <= radius; index += 1) {
    const weight = Math.exp(-(index * index) / (2 * sigma * sigma));
    weights[index + radius] = weight;
    total += weight;
  }
  for (let index = 0; index < weights.length; index += 1) weights[index] /= total;
  return weights;
}

function blurLumaClamp(
  source: Float32Array,
  width: number,
  height: number,
  weights: Float32Array,
  scratch: Float32Array,
  output: Float32Array,
): void {
  const radius = (weights.length - 1) >> 1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sx = clamp(x + offset, 0, width - 1);
        sum += source[y * width + sx]! * weights[offset + radius]!;
      }
      scratch[y * width + x] = sum;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sy = clamp(y + offset, 0, height - 1);
        sum += scratch[sy * width + x]! * weights[offset + radius]!;
      }
      output[y * width + x] = sum;
    }
  }
}

function applyDifferenceOfGaussians(
  image: ValidImage,
  options: StudioDifferenceOfGaussiansOptions,
): { data: Uint8ClampedArray; changed: number } {
  const luma = new Float32Array(image.pixels);
  for (let pixel = 0; pixel < image.pixels; pixel += 1) {
    const offset = pixel * 4;
    luma[pixel] =
      image.data[offset]! * 0.299
      + image.data[offset + 1]! * 0.587
      + image.data[offset + 2]! * 0.114;
  }
  const scratch = new Float32Array(image.pixels);
  const small = new Float32Array(image.pixels);
  const large = new Float32Array(image.pixels);
  blurLumaClamp(luma, image.width, image.height, gaussianWeights(options.smallSigma), scratch, small);
  blurLumaClamp(luma, image.width, image.height, gaussianWeights(options.largeSigma), scratch, large);
  const data = new Uint8ClampedArray(image.bytes);
  let changed = 0;
  for (let pixel = 0; pixel < image.pixels; pixel += 1) {
    const offset = pixel * 4;
    const edge = Math.max(0, Math.abs(small[pixel]! - large[pixel]!) - options.threshold);
    const value = 255 - clamp(edge * options.strength, 0, 255);
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = image.data[offset + 3]!;
    if (
      data[offset] !== image.data[offset]
      || data[offset + 1] !== image.data[offset + 1]
      || data[offset + 2] !== image.data[offset + 2]
    ) changed += 1;
  }
  return { data, changed };
}

function median(values: number[]): number {
  values.sort((left, right) => left - right);
  return values[values.length >> 1]!;
}

function applyDustScratches(
  image: ValidImage,
  options: StudioDustScratchesOptions,
): { data: Uint8ClampedArray; changed: number } {
  const data = new Uint8ClampedArray(image.data);
  const red: number[] = [];
  const green: number[] = [];
  const blue: number[] = [];
  let changed = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      red.length = 0;
      green.length = 0;
      blue.length = 0;
      for (let oy = -options.radius; oy <= options.radius; oy += 1) {
        const sy = clamp(y + oy, 0, image.height - 1);
        for (let ox = -options.radius; ox <= options.radius; ox += 1) {
          const sx = clamp(x + ox, 0, image.width - 1);
          const sample = (sy * image.width + sx) * 4;
          red.push(image.data[sample]!);
          green.push(image.data[sample + 1]!);
          blue.push(image.data[sample + 2]!);
        }
      }
      const offset = (y * image.width + x) * 4;
      const mr = median(red);
      const mg = median(green);
      const mb = median(blue);
      const deviation = Math.max(
        Math.abs(image.data[offset]! - mr),
        Math.abs(image.data[offset + 1]! - mg),
        Math.abs(image.data[offset + 2]! - mb),
      );
      if (deviation < options.threshold) continue;
      data[offset] = image.data[offset]! + (mr - image.data[offset]!) * options.strength;
      data[offset + 1] =
        image.data[offset + 1]! + (mg - image.data[offset + 1]!) * options.strength;
      data[offset + 2] =
        image.data[offset + 2]! + (mb - image.data[offset + 2]!) * options.strength;
      if (
        data[offset] !== image.data[offset]
        || data[offset + 1] !== image.data[offset + 1]
        || data[offset + 2] !== image.data[offset + 2]
      ) changed += 1;
    }
  }
  return { data, changed };
}

function wrapped(value: number, extent: number): number {
  const result = value % extent;
  return result < 0 ? result + extent : result;
}

function applyTileableBlur(
  image: ValidImage,
  options: StudioTileableBlurOptions,
): { data: Uint8ClampedArray; changed: number } {
  const weights = gaussianWeights(options.sigma, options.radius);
  const radius = options.radius;
  const scratch = new Float32Array(image.bytes);
  const blurred = new Float32Array(image.bytes);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const target = (y * image.width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        let sum = 0;
        let weightTotal = 0;
        for (let offset = -radius; offset <= radius; offset += 1) {
          const weight = weights[offset + ((weights.length - 1) >> 1)]!;
          const sample = (y * image.width + wrapped(x + offset, image.width)) * 4;
          sum += image.data[sample + channel]! * weight;
          weightTotal += weight;
        }
        scratch[target + channel] = sum / weightTotal;
      }
    }
  }
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const target = (y * image.width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        let sum = 0;
        let weightTotal = 0;
        for (let offset = -radius; offset <= radius; offset += 1) {
          const weight = weights[offset + ((weights.length - 1) >> 1)]!;
          const sample = (wrapped(y + offset, image.height) * image.width + x) * 4;
          sum += scratch[sample + channel]! * weight;
          weightTotal += weight;
        }
        blurred[target + channel] = sum / weightTotal;
      }
    }
  }
  const data = new Uint8ClampedArray(image.bytes);
  let changed = 0;
  for (let offset = 0; offset < image.bytes; offset += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      data[offset + channel] =
        image.data[offset + channel]!
        + (blurred[offset + channel]! - image.data[offset + channel]!) * options.strength;
    }
    data[offset + 3] = image.data[offset + 3]!;
    if (
      data[offset] !== image.data[offset]
      || data[offset + 1] !== image.data[offset + 1]
      || data[offset + 2] !== image.data[offset + 2]
    ) changed += 1;
  }
  return { data, changed };
}

export function applyStudioProfessionalFilter(
  request: StudioProfessionalFilterRequest,
  budget: StudioProfessionalFilterWorkBudget =
    DEFAULT_STUDIO_PROFESSIONAL_FILTER_WORK_BUDGET,
): StudioProfessionalFilterResult {
  let samplesPerPixel = 1;
  let bytesPerPixel = 4;
  if (request.kernel === "difference-of-gaussians") {
    const options = normalizeStudioDifferenceOfGaussiansOptions(request.options);
    const small = Math.ceil(options.smallSigma * 3) * 2 + 1;
    const large = Math.ceil(options.largeSigma * 3) * 2 + 1;
    samplesPerPixel = 2 * (small + large);
    bytesPerPixel = 20;
  } else if (request.kernel === "dust-scratches") {
    const options = normalizeStudioDustScratchesOptions(request.options);
    samplesPerPixel = ((options.radius * 2 + 1) ** 2) * 3;
    bytesPerPixel = 4;
  } else if (request.kernel === "tileable-blur") {
    const options = normalizeStudioTileableBlurOptions(request.options);
    samplesPerPixel = (options.radius * 2 + 1) * 6;
    bytesPerPixel = 36;
  }
  const prepared = workFor(
    request.kernel,
    request.source,
    samplesPerPixel,
    bytesPerPixel,
    budget,
  );
  if (isRefused(prepared)) return prepared;

  let output: { data: Uint8ClampedArray; changed: number };
  let alphaPolicy: "preserved" | "derived" = "preserved";
  if (request.kernel === "color-to-alpha") {
    const data = new Uint8ClampedArray(prepared.image.data);
    applyColorToAlpha(
      { width: prepared.image.width, height: prepared.image.height, data },
      normalizeColorToAlpha(request.options),
    );
    let changed = 0;
    for (let offset = 0; offset < data.length; offset += 4) {
      if (
        data[offset] !== prepared.image.data[offset]
        || data[offset + 1] !== prepared.image.data[offset + 1]
        || data[offset + 2] !== prepared.image.data[offset + 2]
        || data[offset + 3] !== prepared.image.data[offset + 3]
      ) changed += 1;
    }
    output = { data, changed };
    alphaPolicy = "derived";
  } else if (request.kernel === "difference-of-gaussians") {
    output = applyDifferenceOfGaussians(
      prepared.image,
      normalizeStudioDifferenceOfGaussiansOptions(request.options),
    );
  } else if (request.kernel === "dust-scratches") {
    output = applyDustScratches(
      prepared.image,
      normalizeStudioDustScratchesOptions(request.options),
    );
  } else {
    output = applyTileableBlur(
      prepared.image,
      normalizeStudioTileableBlurOptions(request.options),
    );
  }

  return {
    status: "applied",
    kernel: request.kernel,
    image: {
      width: prepared.image.width,
      height: prepared.image.height,
      data: output.data,
    },
    work: prepared.work,
    alphaPolicy,
    changedPixelCount: output.changed,
  };
}
