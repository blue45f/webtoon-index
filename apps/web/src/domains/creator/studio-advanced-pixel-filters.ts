/**
 * Bounded, deterministic pixel filters shared by Konva and the module Worker.
 *
 * The parameter normalizers are the security/performance boundary: neighborhood filters keep
 * small kernels, generated clouds are seeded, and every operation preserves the input extent.
 */

import {
  withStudioFilterScratchBuffer,
  type StudioImageDataLike,
} from "./studio-filters";

export type StudioExposureAdjustment = {
  /** Exposure value in stops. */
  exposure: number;
  gamma: number;
  /** Linear normalized-channel offset, -1..1. */
  offset: number;
};

export type StudioUnsharpMask = {
  /** 0..3 multiplier applied to high-frequency detail. */
  amount: number;
  /** Separable box-blur radius, 1..5. */
  radius: number;
  /** Minimum per-channel difference before sharpening, 0..255. */
  threshold: number;
};

export type StudioMorphology = {
  mode: "dilate" | "erode";
  /** Separable max/min radius. Zero is the identity state. */
  radius: number;
};

export type StudioPixelOffset = {
  x: number;
  y: number;
  edge: "transparent" | "wrap" | "clamp";
};

export type StudioConvolution = {
  /** Row-major 3x3 matrix. Fixed size keeps Worker cost bounded. */
  kernel: readonly number[];
  divisor: number;
  bias: number;
};


export type StudioPosterize = {
  /** Number of color levels per channel, 2..256. */
  levels: number;
};

export type StudioEdgeDetect = {
  mode: "sobel" | "prewitt";
  /** 0..255 minimum edge magnitude. */
  threshold: number;
  invert: boolean;
};

export type StudioHistogramEqualize = {
  /** 0..1 blend with the original image. */
  strength: number;
};

export type StudioClouds = {
  amount: number;
  scale: number;
  seed: number;
  mode: "overlay" | "multiply" | "screen";
};

export const STUDIO_IDENTITY_CONVOLUTION_KERNEL = [
  0, 0, 0,
  0, 1, 0,
  0, 0, 0,
] as const;

const DEFAULT_EXPOSURE: StudioExposureAdjustment = { exposure: 0, gamma: 1, offset: 0 };
const DEFAULT_UNSHARP_MASK: StudioUnsharpMask = { amount: 0, radius: 1, threshold: 0 };
const DEFAULT_MORPHOLOGY: StudioMorphology = { mode: "dilate", radius: 0 };
const DEFAULT_PIXEL_OFFSET: StudioPixelOffset = { x: 0, y: 0, edge: "transparent" };
const DEFAULT_CONVOLUTION: StudioConvolution = {
  kernel: STUDIO_IDENTITY_CONVOLUTION_KERNEL,
  divisor: 1,
  bias: 0,
};

const DEFAULT_POSTERIZE: StudioPosterize = { levels: 256 };
const DEFAULT_EDGE_DETECT: StudioEdgeDetect = { mode: "sobel", threshold: 0, invert: false };
const DEFAULT_HISTOGRAM_EQUALIZE: StudioHistogramEqualize = { strength: 0 };

const DEFAULT_CLOUDS: StudioClouds = { amount: 0, scale: 96, seed: 1_337, mode: "overlay" };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  return Math.round(clamp(finite(value, fallback), min, max));
}

export function normalizeStudioExposureAdjustment(value?: unknown): StudioExposureAdjustment {
  const source = asRecord(value);
  return {
    exposure: clamp(finite(source.exposure, DEFAULT_EXPOSURE.exposure), -5, 5),
    gamma: clamp(finite(source.gamma, DEFAULT_EXPOSURE.gamma), 0.1, 3),
    offset: clamp(finite(source.offset, DEFAULT_EXPOSURE.offset), -1, 1),
  };
}

export function isIdentityStudioExposureAdjustment(value?: unknown): boolean {
  const normalized = normalizeStudioExposureAdjustment(value);
  return normalized.exposure === 0 && normalized.gamma === 1 && normalized.offset === 0;
}

export function normalizeStudioUnsharpMask(value?: unknown): StudioUnsharpMask {
  const source = asRecord(value);
  return {
    amount: clamp(finite(source.amount, DEFAULT_UNSHARP_MASK.amount), 0, 3),
    radius: clampInteger(source.radius, 1, 5, DEFAULT_UNSHARP_MASK.radius),
    threshold: clamp(finite(source.threshold, DEFAULT_UNSHARP_MASK.threshold), 0, 255),
  };
}

export function isIdentityStudioUnsharpMask(value?: unknown): boolean {
  return normalizeStudioUnsharpMask(value).amount === 0;
}

export function normalizeStudioMorphology(value?: unknown): StudioMorphology {
  const source = asRecord(value);
  return {
    mode: source.mode === "erode" ? "erode" : DEFAULT_MORPHOLOGY.mode,
    radius: clampInteger(source.radius, 0, 4, DEFAULT_MORPHOLOGY.radius),
  };
}

export function isIdentityStudioMorphology(value?: unknown): boolean {
  return normalizeStudioMorphology(value).radius === 0;
}

export function normalizeStudioPixelOffset(value?: unknown): StudioPixelOffset {
  const source = asRecord(value);
  const edge = source.edge === "wrap" || source.edge === "clamp"
    ? source.edge
    : DEFAULT_PIXEL_OFFSET.edge;
  return {
    x: clampInteger(source.x, -4_096, 4_096, DEFAULT_PIXEL_OFFSET.x),
    y: clampInteger(source.y, -4_096, 4_096, DEFAULT_PIXEL_OFFSET.y),
    edge,
  };
}

export function isIdentityStudioPixelOffset(value?: unknown): boolean {
  const normalized = normalizeStudioPixelOffset(value);
  return normalized.x === 0 && normalized.y === 0;
}

export function normalizeStudioConvolution(value?: unknown): StudioConvolution {
  const source = asRecord(value);
  const rawKernel = Array.isArray(source.kernel) ? source.kernel : STUDIO_IDENTITY_CONVOLUTION_KERNEL;
  const kernel = Array.from({ length: 9 }, (_, index) =>
    clamp(finite(rawKernel[index], STUDIO_IDENTITY_CONVOLUTION_KERNEL[index]!), -16, 16)
  );
  const rawDivisor = clamp(finite(source.divisor, DEFAULT_CONVOLUTION.divisor), -64, 64);
  return {
    kernel,
    divisor: Math.abs(rawDivisor) < 0.000_1 ? 1 : rawDivisor,
    bias: clamp(finite(source.bias, DEFAULT_CONVOLUTION.bias), -255, 255),
  };
}

export function isIdentityStudioConvolution(value?: unknown): boolean {
  const normalized = normalizeStudioConvolution(value);
  return normalized.divisor === 1
    && normalized.bias === 0
    && normalized.kernel.every((coefficient, index) =>
      coefficient === STUDIO_IDENTITY_CONVOLUTION_KERNEL[index]
    );
}


export function normalizeStudioPosterize(value?: unknown): StudioPosterize {
  const source = asRecord(value);
  return {
    levels: clampInteger(source.levels, 2, 256, DEFAULT_POSTERIZE.levels),
  };
}

export function isIdentityStudioPosterize(value?: unknown): boolean {
  return normalizeStudioPosterize(value).levels === 256;
}

export function normalizeStudioEdgeDetect(value?: unknown): StudioEdgeDetect {
  const source = asRecord(value);
  return {
    mode: source.mode === "prewitt" ? "prewitt" : DEFAULT_EDGE_DETECT.mode,
    threshold: clamp(finite(source.threshold, DEFAULT_EDGE_DETECT.threshold), 0, 255),
    invert: Boolean(source.invert ?? DEFAULT_EDGE_DETECT.invert),
  };
}

export function isIdentityStudioEdgeDetect(_value?: unknown): boolean {
  return false;
}

export function normalizeStudioHistogramEqualize(value?: unknown): StudioHistogramEqualize {
  const source = asRecord(value);
  return {
    strength: clamp(finite(source.strength, DEFAULT_HISTOGRAM_EQUALIZE.strength), 0, 1),
  };
}

export function isIdentityStudioHistogramEqualize(value?: unknown): boolean {
  return normalizeStudioHistogramEqualize(value).strength === 0;
}

export function normalizeStudioClouds(value?: unknown): StudioClouds {
  const source = asRecord(value);
  const mode = source.mode === "multiply" || source.mode === "screen"
    ? source.mode
    : DEFAULT_CLOUDS.mode;
  return {
    amount: clamp(finite(source.amount, DEFAULT_CLOUDS.amount), 0, 1),
    scale: clamp(finite(source.scale, DEFAULT_CLOUDS.scale), 8, 512),
    seed: clampInteger(source.seed, 0, 2_147_483_647, DEFAULT_CLOUDS.seed),
    mode,
  };
}

export function isIdentityStudioClouds(value?: unknown): boolean {
  return normalizeStudioClouds(value).amount === 0;
}

export function applyStudioExposureAdjustment(
  image: StudioImageDataLike,
  value: StudioExposureAdjustment,
): void {
  const normalized = normalizeStudioExposureAdjustment(value);
  if (isIdentityStudioExposureAdjustment(normalized)) return;
  const multiplier = 2 ** normalized.exposure;
  const inverseGamma = 1 / normalized.gamma;
  const data = image.data;
  for (let index = 0; index < data.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const linear = clamp((data[index + channel]! / 255) * multiplier + normalized.offset, 0, 1);
      data[index + channel] = 255 * linear ** inverseGamma;
    }
  }
}

function horizontalBoxBlur(
  source: Uint8ClampedArray,
  target: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): void {
  const diameter = radius * 2 + 1;
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * width * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      let sum = source[rowStart + channel]! * (radius + 1);
      for (let offset = 1; offset <= radius; offset += 1) {
        sum += source[rowStart + Math.min(offset, width - 1) * 4 + channel]!;
      }
      for (let x = 0; x < width; x += 1) {
        const targetIndex = rowStart + x * 4;
        target[targetIndex + channel] = sum / diameter;
        const outgoingX = clamp(x - radius, 0, width - 1);
        const incomingX = clamp(x + radius + 1, 0, width - 1);
        sum += source[rowStart + incomingX * 4 + channel]!
          - source[rowStart + outgoingX * 4 + channel]!;
      }
    }
    for (let x = 0; x < width; x += 1) {
      const targetIndex = rowStart + x * 4;
      target[targetIndex + 3] = source[targetIndex + 3]!;
    }
  }
}

// Soft threshold gate for unsharp masking. |delta| <= threshold contributes nothing and
// |delta| >= 2*threshold sharpens fully; the smoothstep ramp between them removes the
// hard on/off boundary that used to read as halo rings around near-threshold edges.
function unsharpGate(deltaAbs: number, threshold: number): number {
  if (threshold <= 0) return 1;
  const t = (deltaAbs - threshold) / threshold;
  const c = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

export function applyStudioUnsharpMask(image: StudioImageDataLike, value: StudioUnsharpMask): void {
  const normalized = normalizeStudioUnsharpMask(value);
  if (normalized.amount === 0 || image.width === 0 || image.height === 0) return;
  const { data, width, height } = image;
  withStudioFilterScratchBuffer(data.length, (horizontal) => {
    horizontalBoxBlur(data, horizontal, width, height, normalized.radius);
    const radius = normalized.radius;
    const diameter = radius * 2 + 1;
    for (let x = 0; x < width; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        let sum = horizontal[x * 4 + channel]! * (radius + 1);
        for (let offset = 1; offset <= radius; offset += 1) {
          sum += horizontal[(Math.min(offset, height - 1) * width + x) * 4 + channel]!;
        }
        for (let y = 0; y < height; y += 1) {
          const index = (y * width + x) * 4 + channel;
          const blurred = sum / diameter;
          const delta = data[index]! - blurred;
          const gate = unsharpGate(Math.abs(delta), normalized.threshold);
          if (gate > 0) {
            data[index] = data[index]! + delta * normalized.amount * gate;
          }
          const outgoingY = clamp(y - radius, 0, height - 1);
          const incomingY = clamp(y + radius + 1, 0, height - 1);
          sum += horizontal[(incomingY * width + x) * 4 + channel]!
            - horizontal[(outgoingY * width + x) * 4 + channel]!;
        }
      }
    }
  });
}

function morphologyInitial(mode: StudioMorphology["mode"]): number {
  return mode === "dilate" ? 0 : 255;
}

function morphologyNext(mode: StudioMorphology["mode"], current: number, sample: number): number {
  return mode === "dilate" ? Math.max(current, sample) : Math.min(current, sample);
}

export function applyStudioMorphology(image: StudioImageDataLike, value: StudioMorphology): void {
  const normalized = normalizeStudioMorphology(value);
  if (normalized.radius === 0 || image.width === 0 || image.height === 0) return;
  const { data, width, height } = image;
  withStudioFilterScratchBuffer(data.length, (horizontal) => {
    // Morphology changes the full RGBA support, not only colour. Expanding a semi-transparent
    // mask while preserving the old centre alpha leaves invisible RGB fringes; applying the same
    // extrema operation to alpha keeps line-art/mask edges spatially coherent.
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        for (let channel = 0; channel < 4; channel += 1) {
          let result = morphologyInitial(normalized.mode);
          for (let offset = -normalized.radius; offset <= normalized.radius; offset += 1) {
            const sampleX = clamp(x + offset, 0, width - 1);
            result = morphologyNext(
              normalized.mode,
              result,
              data[(y * width + sampleX) * 4 + channel]!,
            );
          }
          horizontal[index + channel] = result;
        }
      }
    }
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        for (let channel = 0; channel < 4; channel += 1) {
          let result = morphologyInitial(normalized.mode);
          for (let offset = -normalized.radius; offset <= normalized.radius; offset += 1) {
            const sampleY = clamp(y + offset, 0, height - 1);
            result = morphologyNext(
              normalized.mode,
              result,
              horizontal[(sampleY * width + x) * 4 + channel]!,
            );
          }
          data[index + channel] = result;
        }
      }
    }
  });
}

function wrappedCoordinate(value: number, size: number): number {
  return ((value % size) + size) % size;
}

export function applyStudioPixelOffset(image: StudioImageDataLike, value: StudioPixelOffset): void {
  const normalized = normalizeStudioPixelOffset(value);
  if (isIdentityStudioPixelOffset(normalized)) return;
  const { data, width, height } = image;
  withStudioFilterScratchBuffer(data.length, (source) => {
    source.set(data);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const targetIndex = (y * width + x) * 4;
        let sourceX = x - normalized.x;
        let sourceY = y - normalized.y;
        if (normalized.edge === "wrap") {
          sourceX = wrappedCoordinate(sourceX, width);
          sourceY = wrappedCoordinate(sourceY, height);
        } else if (normalized.edge === "clamp") {
          sourceX = clamp(sourceX, 0, width - 1);
          sourceY = clamp(sourceY, 0, height - 1);
        } else if (sourceX < 0 || sourceX >= width || sourceY < 0 || sourceY >= height) {
          data[targetIndex] = 0;
          data[targetIndex + 1] = 0;
          data[targetIndex + 2] = 0;
          data[targetIndex + 3] = 0;
          continue;
        }
        const sourceIndex = (sourceY * width + sourceX) * 4;
        data[targetIndex] = source[sourceIndex]!;
        data[targetIndex + 1] = source[sourceIndex + 1]!;
        data[targetIndex + 2] = source[sourceIndex + 2]!;
        data[targetIndex + 3] = source[sourceIndex + 3]!;
      }
    }
  });
}

export function applyStudioConvolution(image: StudioImageDataLike, value: StudioConvolution): void {
  const normalized = normalizeStudioConvolution(value);
  if (isIdentityStudioConvolution(normalized)) return;
  const { data, width, height } = image;
  withStudioFilterScratchBuffer(data.length, (source) => {
    source.set(data);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const targetIndex = (y * width + x) * 4;
        for (let channel = 0; channel < 3; channel += 1) {
          let sum = 0;
          for (let kernelY = 0; kernelY < 3; kernelY += 1) {
            const sourceY = clamp(y + kernelY - 1, 0, height - 1);
            for (let kernelX = 0; kernelX < 3; kernelX += 1) {
              const sourceX = clamp(x + kernelX - 1, 0, width - 1);
              const sourceIndex = (sourceY * width + sourceX) * 4 + channel;
              sum += source[sourceIndex]! * normalized.kernel[kernelY * 3 + kernelX]!;
            }
          }
          data[targetIndex + channel] = sum / normalized.divisor + normalized.bias;
        }
      }
    }
  });
}

function hashNoise(x: number, y: number, seed: number): number {
  let hash = Math.imul(x, 374_761_393) ^ Math.imul(y, 668_265_263) ^ seed;
  hash = Math.imul(hash ^ (hash >>> 13), 1_274_126_177);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4_294_967_295;
}

function smoothStep(value: number): number {
  return value * value * (3 - 2 * value);
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothStep(x - x0);
  const ty = smoothStep(y - y0);
  const top = hashNoise(x0, y0, seed) * (1 - tx) + hashNoise(x0 + 1, y0, seed) * tx;
  const bottom = hashNoise(x0, y0 + 1, seed) * (1 - tx) + hashNoise(x0 + 1, y0 + 1, seed) * tx;
  return top * (1 - ty) + bottom * ty;
}

function fractalNoise(x: number, y: number, seed: number): number {
  let total = 0;
  let amplitude = 0.57;
  let frequency = 1;
  let amplitudeSum = 0;
  for (let octave = 0; octave < 3; octave += 1) {
    total += valueNoise(x * frequency, y * frequency, seed + octave * 1_013) * amplitude;
    amplitudeSum += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return total / amplitudeSum;
}

function cloudBlend(channel: number, noise: number, mode: StudioClouds["mode"]): number {
  const base = channel / 255;
  if (mode === "multiply") return 255 * base * (0.5 + noise * 0.5);
  if (mode === "screen") return 255 * (1 - (1 - base) * (1 - noise));
  const overlay = base < 0.5
    ? 2 * base * noise
    : 1 - 2 * (1 - base) * (1 - noise);
  return 255 * overlay;
}

export function applyStudioClouds(image: StudioImageDataLike, value: StudioClouds): void {
  const normalized = normalizeStudioClouds(value);
  if (normalized.amount === 0) return;
  const { data, width, height } = image;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const noise = fractalNoise(x / normalized.scale, y / normalized.scale, normalized.seed);
      const index = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const original = data[index + channel]!;
        const blended = cloudBlend(original, noise, normalized.mode);
        data[index + channel] = original + (blended - original) * normalized.amount;
      }
    }
  }
}

type FilterThis = { attrs?: Record<string, unknown> };

export function exposureAdjustmentKonvaFilter(
  this: FilterThis,
  image: StudioImageDataLike,
): void {
  applyStudioExposureAdjustment(image, normalizeStudioExposureAdjustment({
    exposure: this.attrs?.exposureEv,
    gamma: this.attrs?.exposureGamma,
    offset: this.attrs?.exposureOffset,
  }));
}

export function unsharpMaskKonvaFilter(this: FilterThis, image: StudioImageDataLike): void {
  applyStudioUnsharpMask(image, normalizeStudioUnsharpMask({
    amount: this.attrs?.unsharpAmount,
    radius: this.attrs?.unsharpRadius,
    threshold: this.attrs?.unsharpThreshold,
  }));
}

export function morphologyKonvaFilter(this: FilterThis, image: StudioImageDataLike): void {
  applyStudioMorphology(image, normalizeStudioMorphology({
    mode: this.attrs?.morphMode,
    radius: this.attrs?.morphRadius,
  }));
}

export function pixelOffsetKonvaFilter(this: FilterThis, image: StudioImageDataLike): void {
  applyStudioPixelOffset(image, normalizeStudioPixelOffset({
    // `offsetX`/`offsetY` are reserved Konva transform-origin attributes. A pixel filter must
    // never reuse them or spreading filter attrs onto a node moves its geometry on screen.
    x: this.attrs?.pixelOffsetX,
    y: this.attrs?.pixelOffsetY,
    edge: this.attrs?.pixelOffsetEdge,
  }));
}

export function convolutionKonvaFilter(this: FilterThis, image: StudioImageDataLike): void {
  applyStudioConvolution(image, normalizeStudioConvolution({
    kernel: this.attrs?.convKernel,
    divisor: this.attrs?.convDivisor,
    bias: this.attrs?.convBias,
  }));
}

export function cloudsKonvaFilter(this: FilterThis, image: StudioImageDataLike): void {
  applyStudioClouds(image, normalizeStudioClouds({
    amount: this.attrs?.cloudAmount,
    scale: this.attrs?.cloudScale,
    seed: this.attrs?.cloudSeed,
    mode: this.attrs?.cloudMode,
  }));
}


export function applyStudioPosterize(image: StudioImageDataLike, value: StudioPosterize): void {
  const normalized = normalizeStudioPosterize(value);
  if (isIdentityStudioPosterize(normalized)) return;
  const levels = normalized.levels;
  const step = 255 / (levels - 1);
  const { data } = image;
  for (let index = 0; index < data.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      data[index + channel] = Math.round(data[index + channel]! / 255 * (levels - 1)) * step;
    }
  }
}

export function applyStudioEdgeDetect(image: StudioImageDataLike, value: StudioEdgeDetect): void {
  const normalized = normalizeStudioEdgeDetect(value);
  const { data, width, height } = image;
  const isSobel = normalized.mode === "sobel";
  
  const kx = isSobel ? [-1, 0, 1, -2, 0, 2, -1, 0, 1] : [-1, 0, 1, -1, 0, 1, -1, 0, 1];
  const ky = isSobel ? [-1, -2, -1, 0, 0, 0, 1, 2, 1] : [-1, -1, -1, 0, 0, 0, 1, 1, 1];

  withStudioFilterScratchBuffer(data.length, (source) => {
    source.set(data);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const targetIndex = (y * width + x) * 4;
        let sumX = 0;
        let sumY = 0;
        
        for (let kernelY = 0; kernelY < 3; kernelY += 1) {
          const sourceY = clamp(y + kernelY - 1, 0, height - 1);
          for (let kernelX = 0; kernelX < 3; kernelX += 1) {
            const sourceX = clamp(x + kernelX - 1, 0, width - 1);
            const sourceIndex = (sourceY * width + sourceX) * 4;
            const luminance = source[sourceIndex]! * 0.299 + source[sourceIndex + 1]! * 0.587 + source[sourceIndex + 2]! * 0.114;
            const weightIndex = kernelY * 3 + kernelX;
            sumX += luminance * kx[weightIndex]!;
            sumY += luminance * ky[weightIndex]!;
          }
        }
        
        const magnitude = Math.sqrt(sumX * sumX + sumY * sumY);
        let edgeValue = magnitude >= normalized.threshold ? magnitude : 0;
        if (normalized.invert) edgeValue = 255 - edgeValue;
        const finalValue = clamp(edgeValue, 0, 255);
        
        data[targetIndex] = finalValue;
        data[targetIndex + 1] = finalValue;
        data[targetIndex + 2] = finalValue;
      }
    }
  });
}

export function applyStudioHistogramEqualize(image: StudioImageDataLike, value: StudioHistogramEqualize): void {
  const normalized = normalizeStudioHistogramEqualize(value);
  if (isIdentityStudioHistogramEqualize(normalized)) return;
  const { data, width, height } = image;
  const pixelCount = width * height;
  
  const histogram = new Int32Array(256);
  const luminanceData = new Uint8Array(pixelCount);
  
  for (let i = 0; i < pixelCount; i++) {
    const idx = i * 4;
    const luminance = Math.round(data[idx]! * 0.299 + data[idx + 1]! * 0.587 + data[idx + 2]! * 0.114);
    luminanceData[i] = luminance;
    histogram[luminance]!++;
  }
  
  const cdf = new Int32Array(256);
  let cumulative = 0;
  for (let i = 0; i < 256; i++) {
    cumulative += histogram[i]!;
    cdf[i] = cumulative;
  }
  
  let cdfMin = 0;
  for (let i = 0; i < 256; i++) {
    if (cdf[i]! > 0) {
      cdfMin = cdf[i]!;
      break;
    }
  }
  
  const denom = pixelCount - cdfMin;
  const equalizedLuminance = new Uint8Array(256);
  if (denom > 0) {
    for (let i = 0; i < 256; i++) {
      equalizedLuminance[i] = Math.round(((cdf[i]! - cdfMin) / denom) * 255);
    }
  } else {
    for (let i = 0; i < 256; i++) {
      equalizedLuminance[i] = i;
    }
  }

  const strength = normalized.strength;
  for (let i = 0; i < pixelCount; i++) {
    const idx = i * 4;
    const oldLuminance = luminanceData[i]!;
    const newLuminance = equalizedLuminance[oldLuminance]!;
    const ratio = oldLuminance > 0 ? newLuminance / oldLuminance : 0;
    
    for (let channel = 0; channel < 3; channel += 1) {
      const v = data[idx + channel]!;
      data[idx + channel] = clamp(v + (v * ratio - v) * strength, 0, 255);
    }
  }
}

export function posterizeKonvaFilter(this: FilterThis, image: StudioImageDataLike): void {
  applyStudioPosterize(image, normalizeStudioPosterize({
    levels: this.attrs?.posterizeLevels,
  }));
}

export function edgeDetectKonvaFilter(this: FilterThis, image: StudioImageDataLike): void {
  applyStudioEdgeDetect(image, normalizeStudioEdgeDetect({
    mode: this.attrs?.edgeDetectMode,
    threshold: this.attrs?.edgeDetectThreshold,
    invert: this.attrs?.edgeDetectInvert,
  }));
}

export function histogramEqualizeKonvaFilter(this: FilterThis, image: StudioImageDataLike): void {
  applyStudioHistogramEqualize(image, normalizeStudioHistogramEqualize({
    strength: this.attrs?.histogramEqualizeStrength,
  }));
}

