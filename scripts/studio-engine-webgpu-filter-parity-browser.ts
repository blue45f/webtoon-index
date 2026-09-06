/**
 * Real Chromium WebGPU golden/parity entry for the canonical RGBA16F filter runtime.
 *
 * This file is loaded by a synthetic Vite page from
 * verify-studio-engine-webgpu-filter-parity.mjs. It never imports the application shell or accepts a
 * fallback renderer: unsupported WebGPU is a structured skip, while every admitted case uses a
 * real GPUDevice, real rgba16float textures and an aligned MAP_READ copy.
 */

import {
  STUDIO_CANONICAL_FILTER_CURVE_INTERPOLATION,
  STUDIO_CANONICAL_FILTER_CURVE_LUT_SIZE,
  STUDIO_CANONICAL_FILTER_GAUSSIAN_TRUNCATE,
  applyStudioCanonicalFilterRecipeCpu,
  createStudioCanonicalFilterRecipe,
  planStudioCanonicalFilterExecution,
  rebuildStudioCanonicalFilterRecipe,
  studioCanonicalFilterGaussianRadius,
} from "../apps/web/src/domains/creator/render/studio-engine-canonical-filter-plan";
import {
  STUDIO_ENGINE_WEBGPU_FILTER_KERNELS,
  STUDIO_ENGINE_WEBGPU_FILTER_TEXTURE_FORMAT,
  StudioEngineWebGpuFilterRuntime,
} from "../apps/web/src/domains/creator/render/studio-engine-webgpu-filter-runtime";

import type {
  StudioCanonicalFilterLinearImage,
  StudioCanonicalFilterOperationNode,
  StudioCanonicalFilterRecipe,
} from "../apps/web/src/domains/creator/render/studio-engine-canonical-filter-plan";
import type {
  StudioEngineWebGpuFilterReceipt,
} from "../apps/web/src/domains/creator/render/studio-engine-webgpu-filter-runtime";

const WIDTH = 13;
const HEIGHT = 11;
const DEVICE_EPOCH = 7;
const REQUEST_EPOCH = 11;
const HALF_FLOAT_BYTES_PER_PIXEL = 8;
const COPY_BYTES_PER_ROW_ALIGNMENT = 256;
const ABSOLUTE_HALF_FLOAT_TOLERANCE = 0.008;
const RELATIVE_HALF_FLOAT_TOLERANCE = 0.006;
const ALPHA_HALF_FLOAT_TOLERANCE = 0.004;
const DEVICE_LOSS_TIMEOUT_MS = 5_000;

const GPU_TEXTURE_COPY_SRC = 0x01;
const GPU_TEXTURE_COPY_DST = 0x02;
const GPU_TEXTURE_BINDING = 0x04;
const GPU_BUFFER_MAP_READ = 0x01;
const GPU_BUFFER_COPY_DST = 0x08;
const GPU_MAP_READ = 0x01;

type SourceKind = "general" | "transparent-edge";

interface BrowserCapabilities {
  readonly webgpu: boolean;
  readonly rgba16float: boolean;
  readonly userAgent: string;
}

interface SerializableAdapterInfo {
  readonly vendor: string;
  readonly architecture: string;
  readonly device: string;
  readonly description: string;
  readonly isFallbackAdapter: boolean | null;
}

interface ShaderCompilationMessage {
  readonly type: string;
  readonly message: string;
  readonly lineNum: number;
  readonly linePos: number;
  readonly offset: number;
  readonly length: number;
}

interface ShaderCompilationEvidence {
  readonly kernel: keyof typeof STUDIO_ENGINE_WEBGPU_FILTER_KERNELS;
  readonly available: boolean;
  readonly messages: readonly ShaderCompilationMessage[];
}

interface HalfFloatParityMetrics {
  readonly comparedComponents: number;
  readonly violatingComponents: number;
  readonly changedComponents: number;
  readonly changedPixels: number;
  readonly exactHalfWordMismatches: number;
  readonly maxAbsoluteDelta: number;
  readonly maxRgbDelta: number;
  readonly maxAlphaDelta: number;
  readonly meanAbsoluteDelta: number;
  readonly maxToleranceRatio: number;
}

interface TransparentEdgeEvidence {
  readonly sampledPixels: number;
  readonly expectedStraightRgb: readonly [number, number, number];
  readonly cpuMaxStraightRgbDelta: number;
  readonly gpuMaxStraightRgbDelta: number;
}

interface FilterParityCaseResult {
  readonly id: string;
  readonly sourceKind: SourceKind;
  readonly tileSize: number;
  readonly nodeKinds: readonly string[];
  readonly receipt: StudioEngineWebGpuFilterReceipt;
  readonly plan: {
    readonly stageCount: number;
    readonly tileCount: number;
    readonly dispatchCount: number;
    readonly maximumHalo: number;
    readonly passes: readonly string[];
  };
  readonly metrics: HalfFloatParityMetrics;
  readonly transparentEdge: TransparentEdgeEvidence | null;
  readonly validationError: string | null;
  readonly outOfMemoryError: string | null;
  readonly cpuPng: string;
  readonly webgpuPng: string;
  readonly diffPng: string;
  readonly gpuPixels: readonly number[];
  readonly cpuPixels: readonly number[];
}

interface OrderDifferenceEvidence {
  readonly firstCaseId: "order-exposure-then-posterize";
  readonly secondCaseId: "order-posterize-then-exposure";
  readonly gpuChangedPixels: number;
  readonly gpuMaxAbsoluteDelta: number;
  readonly cpuChangedPixels: number;
  readonly cpuMaxAbsoluteDelta: number;
}

interface DeviceLossEvidence {
  readonly trigger: "GPUDevice.destroy";
  readonly deviceReason: string;
  readonly deviceMessage: string;
  readonly callbackReason: string;
  readonly callbackMessage: string;
  readonly runtimeStatus: string;
  readonly runtimeDeviceEpoch: number;
  readonly rejectedExecutionReason: string;
}

type BrowserFilterParityResult =
  | {
    readonly status: "ok";
    readonly backend: "webgpu";
    readonly width: number;
    readonly height: number;
    readonly capabilities: BrowserCapabilities;
    readonly provider: {
      readonly kind: "real-chromium-webgpu-rgba16float";
      readonly adapterInfo: SerializableAdapterInfo;
      readonly textureFormat: "rgba16float";
      readonly sourceEncoding: "scene-linear-premultiplied-f16";
      readonly readback: "aligned-copy-buffer-map-read";
      readonly maxTextureDimension2D: number;
    };
    readonly tolerance: {
      readonly absolute: number;
      readonly relative: number;
      readonly alpha: number;
    };
    readonly shaderCompilation: readonly ShaderCompilationEvidence[];
    readonly cases: readonly FilterParityCaseResult[];
    readonly orderDifference: OrderDifferenceEvidence;
    readonly deviceLoss: DeviceLossEvidence;
    readonly uncapturedGpuErrors: readonly string[];
  }
  | {
    readonly status: "unsupported";
    readonly reason: "webgpu-unavailable" | "adapter-unavailable" | "device-request-failed";
    readonly message: string;
    readonly capabilities: BrowserCapabilities;
  }
  | {
    readonly status: "error";
    readonly message: string;
    readonly capabilities: BrowserCapabilities;
  };

declare global {
  interface Window {
    __studioEngineWebGpuFilterParityResult?: BrowserFilterParityResult;
  }
}

interface FilterCaseDefinition {
  readonly id: string;
  readonly recipe: StudioCanonicalFilterRecipe;
  readonly tileSize: number;
  readonly sourceKind: SourceKind;
}

interface UploadedSource {
  readonly texture: GPUTexture;
  readonly image: StudioCanonicalFilterLinearImage;
  readonly halfWords: Uint16Array;
}

const float32Scratch = new Float32Array(1);
const uint32Scratch = new Uint32Array(float32Scratch.buffer);

function float32ToFloat16(value: number): number {
  float32Scratch[0] = value;
  const bits = uint32Scratch[0]!;
  const sign = (bits >>> 16) & 0x8000;
  const exponent = (bits >>> 23) & 0xff;
  let mantissa = (bits >>> 12) & 0x07ff;
  if (exponent < 103) return sign;
  if (exponent > 142) {
    if (exponent === 0xff && (bits & 0x007fffff) !== 0) {
      return sign | 0x7e00;
    }
    return sign | 0x7c00;
  }
  if (exponent < 113) {
    mantissa |= 0x0800;
    const shift = 114 - exponent;
    return sign | (mantissa >>> shift) | ((mantissa >>> (shift - 1)) & 1);
  }
  let result = sign | ((exponent - 112) << 10) | (mantissa >>> 1);
  result += mantissa & 1;
  return result & 0xffff;
}

function float16ToFloat32(word: number): number {
  const sign = (word & 0x8000) === 0 ? 1 : -1;
  const exponent = (word >>> 10) & 0x1f;
  const mantissa = word & 0x03ff;
  if (exponent === 0) {
    return sign * (mantissa === 0 ? 0 : 2 ** -14 * (mantissa / 1_024));
  }
  if (exponent === 0x1f) return mantissa === 0 ? sign * Infinity : Number.NaN;
  return sign * 2 ** (exponent - 15) * (1 + mantissa / 1_024);
}

function alignedBytesPerRow(width: number): number {
  const unaligned = width * HALF_FLOAT_BYTES_PER_PIXEL;
  return Math.ceil(unaligned / COPY_BYTES_PER_ROW_ALIGNMENT) * COPY_BYTES_PER_ROW_ALIGNMENT;
}

function capabilities(): BrowserCapabilities {
  return {
    webgpu: typeof navigator !== "undefined" && navigator.gpu !== undefined,
    rgba16float: typeof navigator !== "undefined" && navigator.gpu !== undefined,
    userAgent: navigator.userAgent,
  };
}

function serializableAdapterInfo(adapter: GPUAdapter): SerializableAdapterInfo {
  const info = adapter.info as GPUAdapterInfo | undefined;
  return {
    vendor: info?.vendor ?? "",
    architecture: info?.architecture ?? "",
    device: info?.device ?? "",
    description: info?.description ?? "",
    isFallbackAdapter:
      typeof (adapter as GPUAdapter & { isFallbackAdapter?: boolean }).isFallbackAdapter === "boolean"
        ? (adapter as GPUAdapter & { isFallbackAdapter: boolean }).isFallbackAdapter
        : null,
  };
}

function createGeneralSourceData(): Float32Array {
  const data = new Float32Array(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const index = (y * WIDTH + x) * 4;
      let alpha = ((x * 7 + y * 11 + 3) % 17) / 16;
      if ((x + y * 3) % 13 === 0) alpha = 0;
      const red = ((x * 5 + y * 2 + 1) % 19) / 18;
      const green = ((x * 3 + y * 7 + 4) % 23) / 22;
      const blue = ((x * 11 + y * 5 + 2) % 29) / 28;
      data[index] = red * alpha;
      data[index + 1] = green * alpha;
      data[index + 2] = blue * alpha;
      data[index + 3] = alpha;
    }
  }
  return data;
}

function createTransparentEdgeSourceData(): Float32Array {
  const data = new Float32Array(WIDTH * HEIGHT * 4);
  const straight = [0.82, 0.31, 0.08] as const;
  for (let y = 3; y <= 7; y += 1) {
    for (let x = 4; x <= 8; x += 1) {
      const index = (y * WIDTH + x) * 4;
      data[index] = straight[0];
      data[index + 1] = straight[1];
      data[index + 2] = straight[2];
      data[index + 3] = 1;
    }
  }
  return data;
}

function uploadHalfFloatSource(
  device: GPUDevice,
  recipe: StudioCanonicalFilterRecipe,
  sourceKind: SourceKind,
): UploadedSource {
  const source =
    sourceKind === "transparent-edge"
      ? createTransparentEdgeSourceData()
      : createGeneralSourceData();
  const rowBytes = alignedBytesPerRow(WIDTH);
  const upload = new ArrayBuffer(rowBytes * HEIGHT);
  const uploadView = new DataView(upload);
  const halfWords = new Uint16Array(WIDTH * HEIGHT * 4);
  const quantized = new Float32Array(source.length);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      for (let channel = 0; channel < 4; channel += 1) {
        const component = (y * WIDTH + x) * 4 + channel;
        const word = float32ToFloat16(source[component]!);
        halfWords[component] = word;
        quantized[component] = float16ToFloat32(word);
        uploadView.setUint16(y * rowBytes + (x * 4 + channel) * 2, word, true);
      }
    }
  }
  const texture = device.createTexture({
    label: `Studio filter parity ${sourceKind} source`,
    size: { width: WIDTH, height: HEIGHT, depthOrArrayLayers: 1 },
    format: STUDIO_ENGINE_WEBGPU_FILTER_TEXTURE_FORMAT,
    usage: GPU_TEXTURE_COPY_SRC | GPU_TEXTURE_COPY_DST | GPU_TEXTURE_BINDING,
  });
  device.queue.writeTexture(
    { texture },
    upload,
    { offset: 0, bytesPerRow: rowBytes, rowsPerImage: HEIGHT },
    { width: WIDTH, height: HEIGHT, depthOrArrayLayers: 1 },
  );
  return {
    texture,
    image: {
      width: WIDTH,
      height: HEIGHT,
      data: quantized,
      color: recipe.color,
    },
    halfWords,
  };
}

async function readHalfFloatTexture(
  device: GPUDevice,
  texture: GPUTexture,
): Promise<{ readonly data: Float32Array; readonly halfWords: Uint16Array }> {
  const rowBytes = alignedBytesPerRow(WIDTH);
  const buffer = device.createBuffer({
    label: "Studio filter parity aligned RGBA16F readback",
    size: rowBytes * HEIGHT,
    usage: GPU_BUFFER_COPY_DST | GPU_BUFFER_MAP_READ,
  });
  const encoder = device.createCommandEncoder({
    label: "Studio filter parity aligned texture copy",
  });
  encoder.copyTextureToBuffer(
    { texture },
    { buffer, offset: 0, bytesPerRow: rowBytes, rowsPerImage: HEIGHT },
    { width: WIDTH, height: HEIGHT, depthOrArrayLayers: 1 },
  );
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  await buffer.mapAsync(GPU_MAP_READ);
  const mapped = buffer.getMappedRange();
  const view = new DataView(mapped);
  const data = new Float32Array(WIDTH * HEIGHT * 4);
  const halfWords = new Uint16Array(data.length);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      for (let channel = 0; channel < 4; channel += 1) {
        const component = (y * WIDTH + x) * 4 + channel;
        const word = view.getUint16(y * rowBytes + (x * 4 + channel) * 2, true);
        halfWords[component] = word;
        data[component] = float16ToFloat32(word);
      }
    }
  }
  buffer.unmap();
  buffer.destroy();
  return { data, halfWords };
}

function comparisonTolerance(expected: number, channel: number): number {
  if (channel === 3) return ALPHA_HALF_FLOAT_TOLERANCE;
  return ABSOLUTE_HALF_FLOAT_TOLERANCE
    + Math.abs(expected) * RELATIVE_HALF_FLOAT_TOLERANCE;
}

function compareHalfFloatOutput(
  cpu: Float32Array,
  gpu: Float32Array,
  gpuHalfWords: Uint16Array,
): HalfFloatParityMetrics {
  let violatingComponents = 0;
  let changedComponents = 0;
  let changedPixels = 0;
  let exactHalfWordMismatches = 0;
  let maxAbsoluteDelta = 0;
  let maxRgbDelta = 0;
  let maxAlphaDelta = 0;
  let totalAbsoluteDelta = 0;
  let maxToleranceRatio = 0;
  for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel += 1) {
    let pixelChanged = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const index = pixel * 4 + channel;
      const delta = Math.abs(cpu[index]! - gpu[index]!);
      const tolerance = comparisonTolerance(cpu[index]!, channel);
      if (delta > 0) {
        changedComponents += 1;
        pixelChanged = true;
      }
      if (delta > tolerance) violatingComponents += 1;
      if (float32ToFloat16(cpu[index]!) !== gpuHalfWords[index]) {
        exactHalfWordMismatches += 1;
      }
      maxAbsoluteDelta = Math.max(maxAbsoluteDelta, delta);
      if (channel === 3) maxAlphaDelta = Math.max(maxAlphaDelta, delta);
      else maxRgbDelta = Math.max(maxRgbDelta, delta);
      totalAbsoluteDelta += delta;
      maxToleranceRatio = Math.max(maxToleranceRatio, delta / tolerance);
    }
    if (pixelChanged) changedPixels += 1;
  }
  return {
    comparedComponents: cpu.length,
    violatingComponents,
    changedComponents,
    changedPixels,
    exactHalfWordMismatches,
    maxAbsoluteDelta,
    maxRgbDelta,
    maxAlphaDelta,
    meanAbsoluteDelta: totalAbsoluteDelta / cpu.length,
    maxToleranceRatio,
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function linearToSrgb(value: number): number {
  const safe = clamp01(value);
  return safe <= 0.0031308
    ? safe * 12.92
    : 1.055 * safe ** (1 / 2.4) - 0.055;
}

function dataUrlFor(
  data: Float32Array,
  mode: "image" | "diff",
  comparison?: Float32Array,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D evidence canvas unavailable");
  const image = context.createImageData(WIDTH, HEIGHT);
  for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel += 1) {
    const source = pixel * 4;
    const target = pixel * 4;
    if (mode === "diff") {
      const maximum = Math.max(
        Math.abs(data[source]! - comparison![source]!),
        Math.abs(data[source + 1]! - comparison![source + 1]!),
        Math.abs(data[source + 2]! - comparison![source + 2]!),
        Math.abs(data[source + 3]! - comparison![source + 3]!),
      );
      const emphasized = Math.min(255, Math.round(maximum * 8_192));
      image.data[target] = emphasized;
      image.data[target + 1] = emphasized > 0 ? 24 : 0;
      image.data[target + 2] = emphasized > 0 ? 255 - emphasized : 0;
      image.data[target + 3] = 255;
      continue;
    }
    const alpha = clamp01(data[source + 3]!);
    const red = alpha <= 1e-8 ? 0 : data[source]! / alpha;
    const green = alpha <= 1e-8 ? 0 : data[source + 1]! / alpha;
    const blue = alpha <= 1e-8 ? 0 : data[source + 2]! / alpha;
    image.data[target] = Math.round(linearToSrgb(red) * 255);
    image.data[target + 1] = Math.round(linearToSrgb(green) * 255);
    image.data[target + 2] = Math.round(linearToSrgb(blue) * 255);
    image.data[target + 3] = Math.round(alpha * 255);
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

function transparentEdgeEvidence(
  cpu: Float32Array,
  gpu: Float32Array,
  source: StudioCanonicalFilterLinearImage,
): TransparentEdgeEvidence {
  const center = (5 * WIDTH + 6) * 4;
  const expected = [
    source.data[center]! / source.data[center + 3]!,
    source.data[center + 1]! / source.data[center + 3]!,
    source.data[center + 2]! / source.data[center + 3]!,
  ] as const;
  let sampledPixels = 0;
  let cpuMaxStraightRgbDelta = 0;
  let gpuMaxStraightRgbDelta = 0;
  for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel += 1) {
    const index = pixel * 4;
    if (cpu[index + 3]! <= 0.002 || gpu[index + 3]! <= 0.002) continue;
    sampledPixels += 1;
    for (let channel = 0; channel < 3; channel += 1) {
      cpuMaxStraightRgbDelta = Math.max(
        cpuMaxStraightRgbDelta,
        Math.abs(cpu[index + channel]! / cpu[index + 3]! - expected[channel]!),
      );
      gpuMaxStraightRgbDelta = Math.max(
        gpuMaxStraightRgbDelta,
        Math.abs(gpu[index + channel]! / gpu[index + 3]! - expected[channel]!),
      );
    }
  }
  return {
    sampledPixels,
    expectedStraightRgb: expected,
    cpuMaxStraightRgbDelta,
    gpuMaxStraightRgbDelta,
  };
}

function gaussianNode(
  id: string,
  input: string,
  sigma: number,
  borderMode: "clamp" | "reflect" | "transparent",
): StudioCanonicalFilterOperationNode {
  return {
    id,
    kind: "gaussian-blur",
    input,
    sigma,
    radius: studioCanonicalFilterGaussianRadius(sigma),
    truncate: STUDIO_CANONICAL_FILTER_GAUSSIAN_TRUNCATE,
    borderMode,
  };
}

function recipe(
  id: string,
  nodes: readonly StudioCanonicalFilterOperationNode[],
): StudioCanonicalFilterRecipe {
  return rebuildStudioCanonicalFilterRecipe({ recipeId: id }, nodes);
}

function caseDefinitions(): readonly FilterCaseDefinition[] {
  const identityCurve = [{ x: 0, y: 0 }, { x: 1, y: 1 }] as const;
  const exposure = {
    id: "exposure",
    kind: "exposure-contrast",
    input: "source",
    exposureStops: 0.45,
    contrast: 1.12,
    pivot: 0.18,
  } as const;
  const posterizeAfterExposure = {
    id: "posterize",
    kind: "posterize",
    input: "exposure",
    levels: 5,
  } as const;
  const posterizeFirst = {
    id: "posterize",
    kind: "posterize",
    input: "source",
    levels: 5,
  } as const;
  const exposureAfterPosterize = {
    ...exposure,
    input: "posterize",
  } as const;

  return Object.freeze([
    {
      id: "identity",
      recipe: createStudioCanonicalFilterRecipe({ recipeId: "identity" }),
      tileSize: 3,
      sourceKind: "general",
    },
    {
      id: "gaussian-reflect-small-tiles",
      recipe: recipe("gaussian-reflect", [gaussianNode("blur", "source", 1.25, "reflect")]),
      tileSize: 3,
      sourceKind: "general",
    },
    {
      id: "gaussian-clamp-radius-larger-than-tile",
      recipe: recipe("gaussian-clamp", [gaussianNode("blur", "source", 1.5, "clamp")]),
      tileSize: 2,
      sourceKind: "general",
    },
    {
      id: "gaussian-transparent-no-dark-fringe",
      recipe: recipe("gaussian-transparent", [
        gaussianNode("blur", "source", 1.25, "transparent"),
      ]),
      tileSize: 3,
      sourceKind: "transparent-edge",
    },
    {
      id: "unsharp-mask",
      recipe: recipe("unsharp", [{
        id: "unsharp",
        kind: "unsharp-mask",
        input: "source",
        sigma: 0.9,
        radius: studioCanonicalFilterGaussianRadius(0.9),
        truncate: STUDIO_CANONICAL_FILTER_GAUSSIAN_TRUNCATE,
        amount: 1.4,
        threshold: 0.025,
        borderMode: "reflect",
      }]),
      tileSize: 3,
      sourceKind: "general",
    },
    {
      id: "exposure-contrast-levels",
      recipe: recipe("exposure-levels", [
        exposure,
        {
          id: "levels",
          kind: "levels",
          input: "exposure",
          inputBlack: [0.03, 0.02, 0.04],
          inputWhite: [0.95, 0.9, 0.98],
          gamma: [1.15, 0.9, 1.05],
          outputBlack: [0.01, 0.02, 0],
          outputWhite: [0.98, 0.96, 1],
        },
      ]),
      tileSize: 4,
      sourceKind: "general",
    },
    {
      id: "monotone-curves",
      recipe: recipe("curves", [{
        id: "curves",
        kind: "curves",
        input: "source",
        interpolation: STUDIO_CANONICAL_FILTER_CURVE_INTERPOLATION,
        lutSize: STUDIO_CANONICAL_FILTER_CURVE_LUT_SIZE,
        rgb: [{ x: 0, y: 0 }, { x: 0.3, y: 0.22 }, { x: 0.68, y: 0.79 }, { x: 1, y: 1 }],
        red: [{ x: 0, y: 0.02 }, { x: 0.55, y: 0.62 }, { x: 1, y: 0.98 }],
        green: identityCurve,
        blue: [{ x: 0, y: 0 }, { x: 0.4, y: 0.32 }, { x: 1, y: 1 }],
      }]),
      tileSize: 3,
      sourceKind: "general",
    },
    {
      id: "color-matrix-channel-mixer",
      recipe: recipe("matrix-mixer", [
        {
          id: "matrix",
          kind: "color-matrix",
          input: "source",
          matrix: [
            0.88, 0.12, 0, 0, 0.015,
            0.05, 0.9, 0.05, 0, 0,
            0.08, 0, 0.92, 0, -0.01,
            0, 0, 0, 1, 0,
          ],
        },
        {
          id: "mixer",
          kind: "channel-mixer",
          input: "matrix",
          matrix: [
            1.02, -0.02, 0, 0,
            0.03, 0.94, 0.03, 0.01,
            -0.01, 0.06, 0.95, 0,
          ],
        },
      ]),
      tileSize: 3,
      sourceKind: "general",
    },
    {
      id: "posterize-threshold",
      recipe: recipe("posterize-threshold", [
        {
          id: "posterize",
          kind: "posterize",
          input: "source",
          levels: 6,
        },
        {
          id: "threshold",
          kind: "threshold",
          input: "posterize",
          threshold: 0.47,
          mode: "per-channel",
        },
      ]),
      tileSize: 3,
      sourceKind: "general",
    },
    {
      id: "morphology-min",
      recipe: recipe("morphology-min", [{
        id: "morphology",
        kind: "morphology",
        input: "source",
        operation: "min",
        metric: "alpha",
        radius: 2,
        borderMode: "transparent",
      }]),
      tileSize: 2,
      sourceKind: "general",
    },
    {
      id: "morphology-max",
      recipe: recipe("morphology-max", [{
        id: "morphology",
        kind: "morphology",
        input: "source",
        operation: "max",
        metric: "alpha",
        radius: 2,
        borderMode: "reflect",
      }]),
      tileSize: 2,
      sourceKind: "general",
    },
    {
      id: "order-exposure-then-posterize",
      recipe: recipe("order-a", [exposure, posterizeAfterExposure]),
      tileSize: 3,
      sourceKind: "general",
    },
    {
      id: "order-posterize-then-exposure",
      recipe: recipe("order-b", [posterizeFirst, exposureAfterPosterize]),
      tileSize: 3,
      sourceKind: "general",
    },
  ]);
}

async function shaderCompilationEvidence(
  device: GPUDevice,
): Promise<readonly ShaderCompilationEvidence[]> {
  const results: ShaderCompilationEvidence[] = [];
  for (const [kernel, descriptor] of Object.entries(STUDIO_ENGINE_WEBGPU_FILTER_KERNELS) as Array<
    [keyof typeof STUDIO_ENGINE_WEBGPU_FILTER_KERNELS, { readonly wgsl: string }]
  >) {
    const module = device.createShaderModule({
      label: `Studio filter parity compilation probe ${kernel}`,
      code: descriptor.wgsl,
    });
    const getCompilationInfo = (
      module as GPUShaderModule & {
        getCompilationInfo?: () => Promise<GPUCompilationInfo>;
      }
    ).getCompilationInfo;
    if (!getCompilationInfo) {
      results.push({ kernel, available: false, messages: [] });
      continue;
    }
    const info = await getCompilationInfo.call(module);
    results.push({
      kernel,
      available: true,
      messages: Array.from(info.messages, (message) => ({
        type: message.type,
        message: message.message,
        lineNum: message.lineNum,
        linePos: message.linePos,
        offset: message.offset,
        length: message.length,
      })),
    });
  }
  return results;
}

function gpuErrorMessage(error: GPUError | null): string | null {
  return error?.message ?? null;
}

async function runCase(
  device: GPUDevice,
  runtime: StudioEngineWebGpuFilterRuntime,
  definition: FilterCaseDefinition,
  requestSequence: number,
): Promise<{
  readonly result: FilterParityCaseResult;
  readonly sourceTexture: GPUTexture;
  readonly targetTexture: GPUTexture;
}> {
  const planned = planStudioCanonicalFilterExecution(
    definition.recipe,
    WIDTH,
    HEIGHT,
    { tileSize: definition.tileSize },
  );
  if (planned.status !== "ready") {
    throw new Error(`${definition.id}: plan rejected (${planned.reason})`);
  }
  const source = uploadHalfFloatSource(device, definition.recipe, definition.sourceKind);
  const target = device.createTexture({
    label: `Studio filter parity ${definition.id} target`,
    size: { width: WIDTH, height: HEIGHT, depthOrArrayLayers: 1 },
    format: STUDIO_ENGINE_WEBGPU_FILTER_TEXTURE_FORMAT,
    usage: GPU_TEXTURE_COPY_SRC | GPU_TEXTURE_COPY_DST,
  });

  device.pushErrorScope("out-of-memory");
  device.pushErrorScope("validation");
  const execution = await runtime.execute({
    recipe: definition.recipe,
    plan: planned.plan,
    sourceTexture: source.texture,
    targetTexture: target,
    requestSequence,
    requestEpoch: REQUEST_EPOCH,
    deviceEpoch: DEVICE_EPOCH,
  });
  const validationError = await device.popErrorScope();
  const outOfMemoryError = await device.popErrorScope();
  if (execution.status !== "completed") {
    throw new Error(`${definition.id}: runtime rejected (${execution.reason})`);
  }

  const gpu = await readHalfFloatTexture(device, target);
  const cpu = applyStudioCanonicalFilterRecipeCpu(definition.recipe, source.image, {
    tileSize: definition.tileSize,
  });
  const metrics = compareHalfFloatOutput(cpu.data, gpu.data, gpu.halfWords);
  const edge =
    definition.sourceKind === "transparent-edge"
      ? transparentEdgeEvidence(cpu.data, gpu.data, source.image)
      : null;
  return {
    result: {
      id: definition.id,
      sourceKind: definition.sourceKind,
      tileSize: definition.tileSize,
      nodeKinds: definition.recipe.nodes.map(({ kind }) => kind),
      receipt: execution.receipt,
      plan: {
        stageCount: planned.plan.stages.length,
        tileCount: planned.plan.tileCount,
        dispatchCount: planned.plan.dispatchCount,
        maximumHalo: planned.plan.maximumHalo,
        passes: planned.plan.stages.map(({ pass }) => pass),
      },
      metrics,
      transparentEdge: edge,
      validationError: gpuErrorMessage(validationError),
      outOfMemoryError: gpuErrorMessage(outOfMemoryError),
      cpuPng: dataUrlFor(cpu.data, "image"),
      webgpuPng: dataUrlFor(gpu.data, "image"),
      diffPng: dataUrlFor(gpu.data, "diff", cpu.data),
      gpuPixels: Array.from(gpu.data),
      cpuPixels: Array.from(cpu.data),
    },
    sourceTexture: source.texture,
    targetTexture: target,
  };
}

function compareOrderDifference(
  first: FilterParityCaseResult,
  second: FilterParityCaseResult,
): OrderDifferenceEvidence {
  let gpuChangedPixels = 0;
  let gpuMaxAbsoluteDelta = 0;
  let cpuChangedPixels = 0;
  let cpuMaxAbsoluteDelta = 0;
  for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel += 1) {
    let gpuChanged = false;
    let cpuChanged = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const index = pixel * 4 + channel;
      const gpuDelta = Math.abs(first.gpuPixels[index]! - second.gpuPixels[index]!);
      const cpuDelta = Math.abs(first.cpuPixels[index]! - second.cpuPixels[index]!);
      gpuMaxAbsoluteDelta = Math.max(gpuMaxAbsoluteDelta, gpuDelta);
      cpuMaxAbsoluteDelta = Math.max(cpuMaxAbsoluteDelta, cpuDelta);
      if (gpuDelta > 0.001) gpuChanged = true;
      if (cpuDelta > 0.001) cpuChanged = true;
    }
    if (gpuChanged) gpuChangedPixels += 1;
    if (cpuChanged) cpuChangedPixels += 1;
  }
  return {
    firstCaseId: "order-exposure-then-posterize",
    secondCaseId: "order-posterize-then-exposure",
    gpuChangedPixels,
    gpuMaxAbsoluteDelta,
    cpuChangedPixels,
    cpuMaxAbsoluteDelta,
  };
}

async function waitForDeviceLoss(
  device: GPUDevice,
  runtime: StudioEngineWebGpuFilterRuntime,
  callback: { value: GPUDeviceLostInfo | null },
  lastDefinition: FilterCaseDefinition,
  lastSource: GPUTexture,
  lastTarget: GPUTexture,
): Promise<DeviceLossEvidence> {
  const lostPromise = device.lost;
  device.destroy();
  const loss = await Promise.race([
    lostPromise,
    new Promise<never>((_, reject) => {
      window.setTimeout(
        () => reject(new Error("Timed out waiting for real GPUDevice.destroy loss")),
        DEVICE_LOSS_TIMEOUT_MS,
      );
    }),
  ]);
  for (let attempt = 0; attempt < 40 && runtime.getStats().status !== "device-lost"; attempt += 1) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }
  const planned = planStudioCanonicalFilterExecution(
    lastDefinition.recipe,
    WIDTH,
    HEIGHT,
    { tileSize: lastDefinition.tileSize },
  );
  if (planned.status !== "ready") throw new Error("Device-loss replay plan was rejected");
  const rejected = await runtime.execute({
    recipe: lastDefinition.recipe,
    plan: planned.plan,
    sourceTexture: lastSource,
    targetTexture: lastTarget,
    requestSequence: 10_000,
    requestEpoch: REQUEST_EPOCH,
    deviceEpoch: DEVICE_EPOCH,
  });
  if (rejected.status !== "rejected") {
    throw new Error("Runtime accepted work after real GPUDevice.destroy");
  }
  return {
    trigger: "GPUDevice.destroy",
    deviceReason: loss.reason,
    deviceMessage: loss.message,
    callbackReason: callback.value?.reason ?? "",
    callbackMessage: callback.value?.message ?? "",
    runtimeStatus: runtime.getStats().status,
    runtimeDeviceEpoch: runtime.getStats().deviceEpoch,
    rejectedExecutionReason: rejected.reason,
  };
}

async function run(): Promise<BrowserFilterParityResult> {
  const currentCapabilities = capabilities();
  if (!currentCapabilities.webgpu) {
    return {
      status: "unsupported",
      reason: "webgpu-unavailable",
      message: "navigator.gpu is unavailable",
      capabilities: currentCapabilities,
    };
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) {
    return {
      status: "unsupported",
      reason: "adapter-unavailable",
      message: "navigator.gpu.requestAdapter returned null",
      capabilities: currentCapabilities,
    };
  }

  let device: GPUDevice;
  try {
    device = await adapter.requestDevice();
  } catch (error) {
    return {
      status: "unsupported",
      reason: "device-request-failed",
      message: error instanceof Error ? error.message : String(error),
      capabilities: currentCapabilities,
    };
  }

  const uncapturedGpuErrors: string[] = [];
  device.addEventListener("uncapturederror", (event) => {
    uncapturedGpuErrors.push(event.error.message);
  });
  const callback = { value: null as GPUDeviceLostInfo | null };
  const runtime = new StudioEngineWebGpuFilterRuntime({
    device,
    initialDeviceEpoch: DEVICE_EPOCH,
    initialRequestEpoch: REQUEST_EPOCH,
    onDeviceLost: (info) => {
      callback.value = info;
    },
  });
  const compilation = await shaderCompilationEvidence(device);
  const definitions = caseDefinitions();
  const cases: FilterParityCaseResult[] = [];
  let lastSource: GPUTexture | null = null;
  let lastTarget: GPUTexture | null = null;
  for (let index = 0; index < definitions.length; index += 1) {
    const execution = await runCase(device, runtime, definitions[index]!, index + 1);
    if (lastSource) lastSource.destroy();
    if (lastTarget) lastTarget.destroy();
    lastSource = execution.sourceTexture;
    lastTarget = execution.targetTexture;
    cases.push(execution.result);
  }
  const firstOrder = cases.find(({ id }) => id === "order-exposure-then-posterize");
  const secondOrder = cases.find(({ id }) => id === "order-posterize-then-exposure");
  if (!firstOrder || !secondOrder || !lastSource || !lastTarget) {
    throw new Error("Order-difference or device-loss evidence case missing");
  }
  const orderDifference = compareOrderDifference(firstOrder, secondOrder);
  const deviceLoss = await waitForDeviceLoss(
    device,
    runtime,
    callback,
    definitions.at(-1)!,
    lastSource,
    lastTarget,
  );

  return {
    status: "ok",
    backend: "webgpu",
    width: WIDTH,
    height: HEIGHT,
    capabilities: currentCapabilities,
    provider: {
      kind: "real-chromium-webgpu-rgba16float",
      adapterInfo: serializableAdapterInfo(adapter),
      textureFormat: STUDIO_ENGINE_WEBGPU_FILTER_TEXTURE_FORMAT,
      sourceEncoding: "scene-linear-premultiplied-f16",
      readback: "aligned-copy-buffer-map-read",
      maxTextureDimension2D: device.limits.maxTextureDimension2D,
    },
    tolerance: {
      absolute: ABSOLUTE_HALF_FLOAT_TOLERANCE,
      relative: RELATIVE_HALF_FLOAT_TOLERANCE,
      alpha: ALPHA_HALF_FLOAT_TOLERANCE,
    },
    shaderCompilation: compilation,
    cases,
    orderDifference,
    deviceLoss,
    uncapturedGpuErrors,
  };
}

void run()
  .then((result) => {
    window.__studioEngineWebGpuFilterParityResult = result;
  })
  .catch((error: unknown) => {
    window.__studioEngineWebGpuFilterParityResult = {
      status: "error",
      message: error instanceof Error ? error.stack ?? error.message : String(error),
      capabilities: capabilities(),
    };
  });
