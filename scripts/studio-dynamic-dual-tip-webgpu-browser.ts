/**
 * Actual Chromium WebGPU boundary for the provider-neutral dynamic dual-tip specialist.
 *
 * The production planner and runtime are used for GPU execution. The CPU reference below is
 * intentionally independent: it inverse-maps both affine R8 footprints, accumulates their
 * RGBA16F layers, evaluates all eight documented mask families, and applies Porter-Duff.
 */
import {
  parseStudioCanonicalBrushPlan,
  type StudioCanonicalBrushPlan,
} from "../apps/web/src/domains/creator/studio-canonical-brush-plan";
import {
  buildStudioDynamicDualTipPlan,
  type StudioDynamicDualTipBlendFamily,
  type StudioDynamicDualTipExtension,
  type StudioDynamicDualTipPlan,
} from "../apps/web/src/domains/creator/studio-dynamic-dual-tip-plan";
import {
  createStudioDynamicDualTipWebGpuRuntime,
  type StudioDynamicDualTipWebGpuReceipt,
  type StudioDynamicDualTipWebGpuRuntime,
} from "../apps/web/src/domains/creator/studio-dynamic-dual-tip-webgpu-runtime";
import {
  parseStudioProfessionalBrushDynamicsPlan,
  type StudioProfessionalBrushDynamicsPlan,
} from "../apps/web/src/domains/creator/studio-professional-brush-dynamics";
import { sha256HexPortable } from "../apps/web/src/domains/creator/studio-sha256";

const WIDTH = 64;
const HEIGHT = 48;
const INITIAL_DEVICE_EPOCH = 1;
const ROW_ALIGNMENT = 256;
const RGBA16_BYTES_PER_PIXEL = 8;
const MAP_READ = 0x0001;
const BUFFER_COPY_DST = 0x0008;
const DEVICE_LOSS_TIMEOUT_MS = 5_000;
const CPU_ABSOLUTE_TOLERANCE = 0.018;
const PRIMARY_BYTES = new Uint8Array([
  0, 96, 224, 255,
  64, 192, 255, 160,
  192, 255, 128, 32,
  255, 176, 80, 0,
]);
const SECONDARY_BYTES = new Uint8Array([
  255, 32, 196, 64,
  80, 240, 128, 224,
  16, 144, 255, 96,
]);
const PRIMARY_HASH = `sha256:${sha256HexPortable(PRIMARY_BYTES)}`;
const SECONDARY_HASH = `sha256:${sha256HexPortable(SECONDARY_BYTES)}`;
const BLEND_FAMILIES: readonly StudioDynamicDualTipBlendFamily[] = [
  "intersect",
  "darken",
  "lighten",
  "multiply",
  "screen",
  "add",
  "subtract",
  "difference",
];

interface BrowserCapabilities {
  readonly webgpu: boolean;
  readonly offscreenCanvas: boolean;
  readonly userAgent: string;
}

interface PixelMetrics {
  readonly comparedComponents: number;
  readonly violatingComponents: number;
  readonly outsideEdgeViolatingComponents: number;
  readonly edgeBandPixels: number;
  readonly exactHalfWordMismatches: number;
  readonly unaffectedExactHalfWordMismatches: number;
  readonly maxAbsoluteDelta: number;
  readonly outsideEdgeMaxAbsoluteDelta: number;
  readonly meanAbsoluteDelta: number;
}

interface PixelSample {
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly cpu: readonly [number, number, number, number];
  readonly gpu: readonly [number, number, number, number];
  readonly maxAbsoluteDelta: number;
}

interface CaseEvidence {
  readonly id: string;
  readonly blendFamilies: readonly StudioDynamicDualTipBlendFamily[];
  readonly porterDuffOrder: readonly ("source-over" | "destination-out")[];
  readonly receipts: readonly StudioDynamicDualTipWebGpuReceipt[];
  readonly primaryDabs: number;
  readonly secondaryStations: number;
  readonly secondaryInstances: number;
  readonly reflectedAffineInstances: number;
  readonly metrics: PixelMetrics;
  readonly samples: readonly PixelSample[];
  readonly cpuPng: string;
  readonly webgpuPng: string;
  readonly diffPng: string;
}

interface ObservedDevice {
  readonly device: GPUDevice;
  readonly authorityTextures: GPUTexture[];
  readonly shaderModules: GPUShaderModule[];
  readonly assetTextureLabels: string[];
}

interface RuntimeBoundary {
  readonly runtime: StudioDynamicDualTipWebGpuRuntime;
  readonly texture: GPUTexture;
}

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

type BrowserResult =
  | Readonly<{
      status: "ok";
      backend: "dynamic-dual-tip-rgba16float-webgpu";
      width: number;
      height: number;
      capabilities: BrowserCapabilities;
      provider: {
        readonly kind: "real-chromium-webgpu-device-boundary";
        readonly textureFormat: "rgba16float";
        readonly readback: "aligned-rgba16float-map-read";
        readonly bytesPerRow: number;
        readonly adapterInfo: {
          readonly vendor: string;
          readonly architecture: string;
          readonly device: string;
          readonly description: string;
          readonly isFallbackAdapter: boolean | null;
        };
      };
      tolerance: { readonly cpuAbsolute: number };
      cases: readonly CaseEvidence[];
      familyCenterAlpha: Readonly<Record<StudioDynamicDualTipBlendFamily, number>>;
      append: {
        readonly receiptModes: readonly ("append" | "rebuild")[];
        readonly cpuParityViolations: number;
        readonly outsideEdgeCpuParityViolations: number;
      };
      destinationOut: {
        readonly baseCenterAlpha: number;
        readonly erasedCenterAlpha: number;
        readonly cpuParityViolations: number;
        readonly outsideEdgeCpuParityViolations: number;
      };
      assetBoundary: {
        readonly firstTextureCreations: number;
        readonly cachedTextureCreations: number;
        readonly mutatedHashStatus: string;
        readonly mutatedHashReason: string | null;
        readonly budgetStatus: string;
        readonly budgetReason: string | null;
      };
      flow: {
        readonly cancelledStatus: string;
        readonly cancelledSequenceReusable: boolean;
        readonly busyStatus: string;
        readonly busyInFlight: number | null;
        readonly busySequenceReusable: boolean;
      };
      shaders: readonly {
        readonly available: boolean;
        readonly messages: readonly {
          readonly type: string;
          readonly message: string;
          readonly lineNum: number;
          readonly linePos: number;
        }[];
      }[];
      errorScopes: {
        readonly validation: string | null;
        readonly outOfMemory: string | null;
      };
      uncapturedGpuErrors: readonly string[];
      deviceLoss: {
        readonly trigger: "GPUDevice.destroy";
        readonly reason: string;
        readonly message: string;
        readonly callbackReason: string;
        readonly callbackMessage: string;
        readonly runtimeEpoch: number;
        readonly rejectedStatus: string;
        readonly rejectedEpoch: number | null;
      };
    }>
  | Readonly<{
      status: "unsupported";
      reason: string;
      message: string;
      capabilities: BrowserCapabilities;
    }>
  | Readonly<{
      status: "error";
      message: string;
      stack: string | null;
      capabilities: BrowserCapabilities;
    }>;

declare global {
  interface Window {
    __studioDynamicDualTipWebGpuResult?: BrowserResult;
  }
}

const float32Scratch = new Float32Array(1);
const uint32Scratch = new Uint32Array(float32Scratch.buffer);

function capabilities(): BrowserCapabilities {
  return {
    webgpu: typeof navigator !== "undefined" && navigator.gpu !== undefined,
    offscreenCanvas: typeof OffscreenCanvas !== "undefined",
    userAgent: navigator.userAgent,
  };
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function nextAligned(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function deepFreeze<Value>(value: Value): Value {
  if (
    typeof value !== "object"
    || value === null
    || Object.isFrozen(value)
    || ArrayBuffer.isView(value)
  ) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function float32ToFloat16(value: number): number {
  float32Scratch[0] = value;
  const bits = uint32Scratch[0]!;
  const sign = (bits >>> 16) & 0x8000;
  let exponent = ((bits >>> 23) & 0xff) - 127 + 15;
  let mantissa = bits & 0x7f_ffff;
  if (exponent <= 0) {
    if (exponent < -10) return sign;
    mantissa = (mantissa | 0x80_0000) >>> (1 - exponent);
    return sign | ((mantissa + 0x1000) >>> 13);
  }
  if (exponent >= 31) return sign | 0x7c00;
  mantissa += 0x1000;
  if ((mantissa & 0x80_0000) !== 0) {
    mantissa = 0;
    exponent += 1;
  }
  if (exponent >= 31) return sign | 0x7c00;
  return sign | (exponent << 10) | (mantissa >>> 13);
}

function float16ToFloat32(value: number): number {
  const sign = (value & 0x8000) << 16;
  let exponent = (value >>> 10) & 0x1f;
  let mantissa = value & 0x03ff;
  let bits: number;
  if (exponent === 0) {
    if (mantissa === 0) {
      bits = sign;
    } else {
      exponent = 1;
      while ((mantissa & 0x0400) === 0) {
        mantissa <<= 1;
        exponent -= 1;
      }
      mantissa &= 0x03ff;
      bits = sign | ((exponent + 112) << 23) | (mantissa << 13);
    }
  } else if (exponent === 31) {
    bits = sign | 0x7f80_0000 | (mantissa << 13);
  } else {
    bits = sign | ((exponent + 112) << 23) | (mantissa << 13);
  }
  uint32Scratch[0] = bits >>> 0;
  return float32Scratch[0]!;
}

function quantizeHalf(value: number): number {
  return float16ToFloat32(float32ToFloat16(value));
}

function zeroBorderTexel(
  bytes: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  if (x < 0 || y < 0 || x >= width || y >= height) return 0;
  return bytes[y * width + x]! / 255;
}

function sampleZeroBorder(
  bytes: Uint8Array,
  width: number,
  height: number,
  u: number,
  v: number,
): number {
  const x = u * width - 0.5;
  const y = v * height - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const amountX = x - x0;
  const amountY = y - y0;
  const top = zeroBorderTexel(bytes, width, height, x0, y0) * (1 - amountX)
    + zeroBorderTexel(bytes, width, height, x0 + 1, y0) * amountX;
  const bottom = zeroBorderTexel(bytes, width, height, x0, y0 + 1) * (1 - amountX)
    + zeroBorderTexel(bytes, width, height, x0 + 1, y0 + 1) * amountX;
  return top * (1 - amountY) + bottom * amountY;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const amount = clamp01((value - edge0) / (edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
}

function insideAffine(
  documentX: number,
  documentY: number,
  centerX: number,
  centerY: number,
  basis: readonly [number, number, number, number],
): readonly [number, number] | null {
  const [xx, xy, yx, yy] = basis;
  const determinant = xx * yy - xy * yx;
  const deltaX = documentX - centerX;
  const deltaY = documentY - centerY;
  const localX = (yy * deltaX - yx * deltaY) / determinant;
  const localY = (-xy * deltaX + xx * deltaY) / determinant;
  return Math.abs(localX) <= 1 && Math.abs(localY) <= 1
    ? [localX, localY]
    : null;
}

function localAffine(
  documentX: number,
  documentY: number,
  centerX: number,
  centerY: number,
  basis: readonly [number, number, number, number],
): readonly [number, number, number, number] {
  const [xx, xy, yx, yy] = basis;
  const determinant = xx * yy - xy * yx;
  const deltaX = documentX - centerX;
  const deltaY = documentY - centerY;
  return [
    (yy * deltaX - yx * deltaY) / determinant,
    (-xy * deltaX + xx * deltaY) / determinant,
    Math.hypot(yy, yx) / Math.abs(determinant),
    Math.hypot(xy, xx) / Math.abs(determinant),
  ];
}

function nearRasterFootprintEdge(
  plans: readonly StudioDynamicDualTipPlan[],
  x: number,
  y: number,
): boolean {
  const documentX = x + 0.5;
  const documentY = y + 0.5;
  const footprints = plans.flatMap((plan) => [
    ...plan.primary.dabs.map((dab) => ({
      x: dab.x,
      y: dab.y,
      basis: dab.tip.localToDocument,
    })),
    ...plan.secondaryInstances.map((instance) => ({
      x: instance.x,
      y: instance.y,
      basis: instance.localToDocument,
    })),
  ]);
  return footprints.some((footprint) => {
    const [localX, localY, inverseX, inverseY] = localAffine(
      documentX,
      documentY,
      footprint.x,
      footprint.y,
      footprint.basis,
    );
    const marginX = inverseX * 1.25;
    const marginY = inverseY * 1.25;
    return (
      Math.abs(Math.abs(localX) - 1) <= marginX
      && Math.abs(localY) <= 1 + marginY
    ) || (
      Math.abs(Math.abs(localY) - 1) <= marginY
      && Math.abs(localX) <= 1 + marginX
    );
  });
}

function sourceOver(
  target: Float32Array,
  offset: number,
  source: readonly [number, number, number, number],
): void {
  const inverse = 1 - source[3];
  target[offset] = quantizeHalf(source[0] + target[offset]! * inverse);
  target[offset + 1] = quantizeHalf(source[1] + target[offset + 1]! * inverse);
  target[offset + 2] = quantizeHalf(source[2] + target[offset + 2]! * inverse);
  target[offset + 3] = quantizeHalf(source[3] + target[offset + 3]! * inverse);
}

function combineMasks(
  family: StudioDynamicDualTipBlendFamily,
  primary: number,
  secondary: number,
): number {
  switch (family) {
    case "intersect":
    case "multiply":
      return primary * secondary;
    case "darken":
      return Math.min(primary, secondary);
    case "lighten":
      return Math.max(primary, secondary);
    case "screen":
      return 1 - (1 - primary) * (1 - secondary);
    case "add":
      return Math.min(1, primary + secondary);
    case "subtract":
      return Math.max(0, primary - secondary);
    case "difference":
      return Math.abs(primary - secondary);
  }
}

function rasterIndependentCpu(
  plans: readonly StudioDynamicDualTipPlan[],
): Uint16Array {
  const authority = new Float32Array(WIDTH * HEIGHT * 4);
  for (const plan of plans) {
    if (plan.mode === "rebuild") authority.fill(0);
    const primaryRawMaskLayer = new Float32Array(authority.length);
    const secondaryLayer = new Float32Array(authority.length);
    const primaryAsset = plan.primary.assets[plan.primary.tip.assetIndex]!;
    for (const dab of plan.primary.dabs) {
      for (let y = 0; y < HEIGHT; y += 1) {
        for (let x = 0; x < WIDTH; x += 1) {
          const local = insideAffine(
            x + 0.5,
            y + 0.5,
            dab.x,
            dab.y,
            dab.tip.localToDocument,
          );
          if (!local) continue;
          const sampled = sampleZeroBorder(
            primaryAsset.bytes,
            primaryAsset.width,
            primaryAsset.height,
            local[0] * 0.5 + 0.5,
            local[1] * 0.5 + 0.5,
          );
          const hardnessEdge = Math.max(1 / 65_535, 1 - dab.tip.hardness);
          const coverage = smoothstep(0, hardnessEdge, sampled);
          const offset = (y * WIDTH + x) * 4;
          sourceOver(primaryRawMaskLayer, offset, [
            coverage,
            coverage,
            coverage,
            coverage,
          ]);
        }
      }
    }
    for (const instance of plan.secondaryInstances) {
      for (let y = 0; y < HEIGHT; y += 1) {
        for (let x = 0; x < WIDTH; x += 1) {
          const local = insideAffine(
            x + 0.5,
            y + 0.5,
            instance.x,
            instance.y,
            instance.localToDocument,
          );
          if (!local) continue;
          const coverage = clamp01(sampleZeroBorder(
            plan.secondaryAsset.bytes,
            plan.secondaryAsset.width,
            plan.secondaryAsset.height,
            local[0] * 0.5 + 0.5,
            local[1] * 0.5 + 0.5,
          ) * instance.opacity);
          const offset = (y * WIDTH + x) * 4;
          sourceOver(secondaryLayer, offset, [
            coverage,
            coverage,
            coverage,
            coverage,
          ]);
        }
      }
    }
    const fallback = plan.primary.dabs[0]!.color.components;
    const porterDuff = plan.primary.batches[0]!.porterDuff;
    for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel += 1) {
      const offset = pixel * 4;
      const primaryRawMask = clamp01(primaryRawMaskLayer[offset + 3]!);
      const secondaryAlpha = clamp01(secondaryLayer[offset + 3]!);
      const combinedRawMask = clamp01(combineMasks(
        plan.extension.blendFamily,
        primaryRawMask,
        secondaryAlpha,
      ));
      const combined = combinedRawMask * fallback[3];
      const straight: readonly [number, number, number] = [
        fallback[0],
        fallback[1],
        fallback[2],
      ];
      if (porterDuff === "destination-out") {
        const inverse = 1 - combined;
        authority[offset] = quantizeHalf(authority[offset]! * inverse);
        authority[offset + 1] = quantizeHalf(authority[offset + 1]! * inverse);
        authority[offset + 2] = quantizeHalf(authority[offset + 2]! * inverse);
        authority[offset + 3] = quantizeHalf(authority[offset + 3]! * inverse);
      } else {
        sourceOver(authority, offset, [
          straight[0] * combined,
          straight[1] * combined,
          straight[2] * combined,
          combined,
        ]);
      }
    }
  }
  const words = new Uint16Array(authority.length);
  for (let index = 0; index < authority.length; index += 1) {
    words[index] = float32ToFloat16(authority[index]!);
  }
  return words;
}

function comparePixels(
  cpu: Uint16Array,
  gpu: Uint16Array,
  plans: readonly StudioDynamicDualTipPlan[],
): PixelMetrics {
  let violatingComponents = 0;
  let outsideEdgeViolatingComponents = 0;
  let edgeBandPixels = 0;
  let exactHalfWordMismatches = 0;
  let unaffectedExactHalfWordMismatches = 0;
  let maxAbsoluteDelta = 0;
  let outsideEdgeMaxAbsoluteDelta = 0;
  let totalDelta = 0;
  for (let pixelIndex = 0; pixelIndex < WIDTH * HEIGHT; pixelIndex += 1) {
    const x = pixelIndex % WIDTH;
    const y = Math.floor(pixelIndex / WIDTH);
    const edge = nearRasterFootprintEdge(plans, x, y);
    if (edge) edgeBandPixels += 1;
    for (let channel = 0; channel < 4; channel += 1) {
      const index = pixelIndex * 4 + channel;
      const cpuValue = float16ToFloat32(cpu[index]!);
      const gpuValue = float16ToFloat32(gpu[index]!);
      const delta = Math.abs(cpuValue - gpuValue);
      if (delta > CPU_ABSOLUTE_TOLERANCE) {
        violatingComponents += 1;
        if (!edge) outsideEdgeViolatingComponents += 1;
      }
      if (cpu[index] !== gpu[index]) exactHalfWordMismatches += 1;
      if (cpu[index] === 0 && gpu[index] !== 0) {
        unaffectedExactHalfWordMismatches += 1;
      }
      maxAbsoluteDelta = Math.max(maxAbsoluteDelta, delta);
      if (!edge) {
        outsideEdgeMaxAbsoluteDelta = Math.max(outsideEdgeMaxAbsoluteDelta, delta);
      }
      totalDelta += delta;
    }
  }
  return {
    comparedComponents: cpu.length,
    violatingComponents,
    outsideEdgeViolatingComponents,
    edgeBandPixels,
    exactHalfWordMismatches,
    unaffectedExactHalfWordMismatches,
    maxAbsoluteDelta,
    outsideEdgeMaxAbsoluteDelta,
    meanAbsoluteDelta: totalDelta / cpu.length,
  };
}

function pixel(
  words: Uint16Array,
  x: number,
  y: number,
): readonly [number, number, number, number] {
  const offset = (y * WIDTH + x) * 4;
  return [
    float16ToFloat32(words[offset]!),
    float16ToFloat32(words[offset + 1]!),
    float16ToFloat32(words[offset + 2]!),
    float16ToFloat32(words[offset + 3]!),
  ];
}

function samplePixel(
  label: string,
  x: number,
  y: number,
  cpu: Uint16Array,
  gpu: Uint16Array,
): PixelSample {
  const cpuPixel = pixel(cpu, x, y);
  const gpuPixel = pixel(gpu, x, y);
  return {
    label,
    x,
    y,
    cpu: cpuPixel,
    gpu: gpuPixel,
    maxAbsoluteDelta: Math.max(
      ...cpuPixel.map((value, index) => Math.abs(value - gpuPixel[index]!)),
    ),
  };
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(blob);
  });
}

async function wordsPng(words: Uint16Array): Promise<string> {
  const bytes = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let index = 0; index < words.length; index += 4) {
    const alpha = clamp01(float16ToFloat32(words[index + 3]!));
    bytes[index] = Math.round(clamp01(float16ToFloat32(words[index]!)) * 255);
    bytes[index + 1] = Math.round(clamp01(float16ToFloat32(words[index + 1]!)) * 255);
    bytes[index + 2] = Math.round(clamp01(float16ToFloat32(words[index + 2]!)) * 255);
    bytes[index + 3] = Math.round(alpha * 255);
  }
  const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D evidence context unavailable");
  context.putImageData(new ImageData(bytes, WIDTH, HEIGHT), 0, 0);
  return blobToDataUrl(await canvas.convertToBlob({ type: "image/png" }));
}

async function diffPng(cpu: Uint16Array, gpu: Uint16Array): Promise<string> {
  const bytes = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let pixelIndex = 0; pixelIndex < WIDTH * HEIGHT; pixelIndex += 1) {
    const offset = pixelIndex * 4;
    let maximum = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      maximum = Math.max(
        maximum,
        Math.abs(
          float16ToFloat32(cpu[offset + channel]!)
          - float16ToFloat32(gpu[offset + channel]!),
        ),
      );
    }
    const intensity = Math.round(clamp01(maximum / CPU_ABSOLUTE_TOLERANCE) * 255);
    bytes[offset] = intensity;
    bytes[offset + 1] = 0;
    bytes[offset + 2] = 255 - intensity;
    bytes[offset + 3] = 255;
  }
  const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D diff context unavailable");
  context.putImageData(new ImageData(bytes, WIDTH, HEIGHT), 0, 0);
  return blobToDataUrl(await canvas.convertToBlob({ type: "image/png" }));
}

function observeDevice(
  rawDevice: GPUDevice,
  shaderModules: GPUShaderModule[],
  fenceGate?: Promise<void>,
): ObservedDevice {
  const authorityTextures: GPUTexture[] = [];
  const assetTextureLabels: string[] = [];
  const queue = new Proxy(rawDevice.queue, {
    get(target, property) {
      if (property === "onSubmittedWorkDone" && fenceGate) {
        return async (): Promise<void> => {
          await target.onSubmittedWorkDone();
          await fenceGate;
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function"
        ? (value as (...arguments_: unknown[]) => unknown).bind(target)
        : value;
    },
  });
  const device = new Proxy(rawDevice, {
    get(target, property) {
      if (property === "queue") return queue;
      if (property === "createTexture") {
        return (descriptor: GPUTextureDescriptor): GPUTexture => {
          const texture = target.createTexture(descriptor);
          const label = String(descriptor.label ?? "");
          if (label === "Studio dynamic dual-tip rgba16float authority") {
            authorityTextures.push(texture);
          }
          if (
            label.startsWith("Studio dynamic dual-tip tip ")
            || label.startsWith("Studio dynamic dual-tip grain ")
          ) assetTextureLabels.push(label);
          return texture;
        };
      }
      if (property === "createShaderModule") {
        return (descriptor: GPUShaderModuleDescriptor): GPUShaderModule => {
          const module = target.createShaderModule(descriptor);
          shaderModules.push(module);
          return module;
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function"
        ? (value as (...arguments_: unknown[]) => unknown).bind(target)
        : value;
    },
  }) as unknown as GPUDevice;
  return { device, authorityTextures, shaderModules, assetTextureLabels };
}

function createRuntime(
  observed: ObservedDevice,
  options: Readonly<{
    maximumInFlightSubmissions?: number;
    maximumResidentAssetBytes?: number;
    onDeviceLost?: (info: GPUDeviceLostInfo) => void;
  }> = {},
): RuntimeBoundary {
  const before = observed.authorityTextures.length;
  const result = createStudioDynamicDualTipWebGpuRuntime({
    device: observed.device,
    width: WIDTH,
    height: HEIGHT,
    initialDeviceEpoch: INITIAL_DEVICE_EPOCH,
    ...options,
  });
  if (result.status !== "ready") {
    throw new Error(`dynamic dual-tip runtime failed: ${result.reason}`);
  }
  const texture = observed.authorityTextures[before];
  if (!texture) throw new Error("dynamic dual-tip authority texture was not observed");
  return { runtime: result.runtime, texture };
}

async function readRgba16Float(
  rawDevice: GPUDevice,
  texture: GPUTexture,
): Promise<Uint16Array> {
  const bytesPerRow = nextAligned(WIDTH * RGBA16_BYTES_PER_PIXEL, ROW_ALIGNMENT);
  const buffer = rawDevice.createBuffer({
    label: "Studio dynamic dual-tip aligned readback",
    size: bytesPerRow * HEIGHT,
    usage: MAP_READ | BUFFER_COPY_DST,
  });
  const encoder = rawDevice.createCommandEncoder();
  encoder.copyTextureToBuffer(
    { texture },
    { buffer, bytesPerRow, rowsPerImage: HEIGHT },
    { width: WIDTH, height: HEIGHT, depthOrArrayLayers: 1 },
  );
  rawDevice.queue.submit([encoder.finish()]);
  await rawDevice.queue.onSubmittedWorkDone();
  await buffer.mapAsync(MAP_READ, 0, bytesPerRow * HEIGHT);
  const mapped = new Uint8Array(buffer.getMappedRange());
  const words = new Uint16Array(WIDTH * HEIGHT * 4);
  for (let row = 0; row < HEIGHT; row += 1) {
    words.set(
      new Uint16Array(
        mapped.buffer,
        mapped.byteOffset + row * bytesPerRow,
        WIDTH * 4,
      ),
      row * WIDTH * 4,
    );
  }
  buffer.unmap();
  buffer.destroy();
  return words;
}

function canonicalCandidate(
  id: string,
  porterDuff: "source-over" | "destination-out",
) {
  const samples = [
    { sequence: 1, x: 0, y: 0, pressure: 0.45, timeMilliseconds: 0 },
    { sequence: 2, x: 12, y: 2, pressure: 0.75, timeMilliseconds: 12 },
    { sequence: 3, x: 24, y: 8, pressure: 1, timeMilliseconds: 24 },
  ];
  return {
    kind: "studio-canonical-brush-plan",
    version: 1,
    sessionEpoch: 1,
    strokeEpoch: 1,
    commandSequence: 1,
    strokeId: id,
    seed: 0x73ac_19ef,
    coordinateSpace: "document-css-px",
    transform: {
      encoding: "affine-f64-v1",
      m11: -1,
      m12: 0.22,
      m21: 0.18,
      m22: 0.9,
      translateX: 45,
      translateY: 14,
    },
    color: {
      space: "linear-srgb",
      alphaMode: "straight",
      components: [0.78, 0.24, 0.08, porterDuff === "destination-out" ? 0.45 : 0.72],
    },
    composite: {
      porterDuff,
      blendMode: "normal",
      opacity: 0.9,
    },
    recipe: {
      version: 1,
      brushId: `dual-browser-${id}`,
      engine: "dab-v1",
      material: porterDuff === "destination-out" ? "eraser" : "ink",
      tip: {
        kind: "texture",
        assetId: "dynamic-primary-r8",
        contentHash: PRIMARY_HASH,
        channel: "alpha",
        width: 4,
        height: 4,
      },
      size: 12,
      flow: 0.85,
      hardness: 0.35,
      spacingRatio: 0.5,
      scatter: { radiusRatio: 0, distribution: "uniform-disk" },
      angleRadians: 0.12,
      roundness: 0.72,
      pressure: {
        size: { minimum: 1, maximum: 1, exponent: 1 },
        opacity: { minimum: 1, maximum: 1, exponent: 1 },
        flow: { minimum: 1, maximum: 1, exponent: 1 },
      },
      grain: null,
      wetMedia: null,
    },
    source: {
      encoding: "accepted-authoritative-samples-v1",
      firstSequence: 1,
      lastSequence: 3,
      samples: samples.map((sample) => ({
        role: "authoritative",
        ...sample,
        tangentialPressure: 0,
        tiltX: 0,
        tiltY: 0,
        twist: 0,
        pointerId: 1,
        flags: 0,
      })),
    },
  };
}

function dynamicsCandidate(id: string) {
  const channel = (base: number, min: number, max: number) => ({
    base,
    min,
    max,
    mappings: [],
  });
  return {
    kind: "studio-professional-brush-dynamics",
    version: 1,
    planId: `dual-browser-${id}`,
    revision: 1,
    seed: 0x29bf_71ac,
    units: {
      size: "document-css-px",
      opacity: "unit-interval",
      flow: "unit-interval",
      spacing: "document-css-px",
      angle: "radians",
      roundness: "unit-interval",
      scatter: "document-css-px",
      textureDepth: "unit-interval",
    },
    clock: { timeUnit: "milliseconds", tickMilliseconds: 1 },
    budgets: {
      maxSamples: 64,
      maxEvents: 256,
      maxMappings: 16,
      maxCurvePoints: 16,
      maxStationaryEventsPerGap: 16,
    },
    velocity: {
      normalizationPixelsPerMillisecond: 1,
      smoothingTimeMilliseconds: 1,
      initialPixelsPerMillisecond: 0,
      maximumPixelsPerMillisecond: 100,
    },
    taper: {
      start: { mode: "stroke-percentage", value: 0 },
      end: { mode: "stroke-percentage", value: 0 },
      minimumSizeRatio: 0,
      minimumOpacityRatio: 0,
      speedInfluence: 0,
    },
    stationary: {
      mode: "disabled",
      intervalTicks: 1,
      movementEpsilonPixels: 0.01,
    },
    channels: {
      size: channel(12, 0.01, 512),
      opacity: channel(1, 0, 1),
      flow: channel(0.85, 0, 1),
      spacing: channel(6, 0.05, 512),
      angle: channel(0.12, -Math.PI * 2, Math.PI * 2),
      roundness: channel(0.72, 0.01, 1),
      scatter: channel(0, 0, 512),
      textureDepth: channel(0, 0, 1),
    },
  };
}

function acceptedPrefix(
  canonical: StudioCanonicalBrushPlan,
  dynamics: StudioProfessionalBrushDynamicsPlan,
) {
  return deepFreeze(canonical.source.samples.map((sample) => ({
    sequence: sample.sequence,
    timeTick: sample.timeMilliseconds / dynamics.clock.tickMilliseconds,
    x: sample.x,
    y: sample.y,
    pressure: sample.pressure,
    tiltXDegrees: sample.tiltX,
    tiltYDegrees: sample.tiltY,
    tangentialPressure: sample.tangentialPressure,
    twistDegrees: sample.twist,
  })));
}

async function buildPlan(
  id: string,
  blendFamily: StudioDynamicDualTipBlendFamily,
  options: Readonly<{
    mode?: "append" | "rebuild";
    porterDuff?: "source-over" | "destination-out";
  }> = {},
): Promise<StudioDynamicDualTipPlan> {
  const canonical = parseStudioCanonicalBrushPlan(
    canonicalCandidate(id, options.porterDuff ?? "source-over"),
    { sessionEpoch: 1, strokeEpoch: 1, lastAcceptedCommandSequence: 0 },
  );
  if (!canonical.ok) {
    throw new Error(`dynamic canonical ${id}: ${canonical.reason} ${canonical.path}`);
  }
  const dynamics = parseStudioProfessionalBrushDynamicsPlan(dynamicsCandidate(id));
  if (!dynamics.ok) {
    throw new Error(`dynamic dynamics ${id}: ${dynamics.reason} ${dynamics.path}`);
  }
  const extension: StudioDynamicDualTipExtension = deepFreeze({
    kind: "studio-dynamic-dual-tip-extension",
    version: 1,
    secondaryTip: {
      kind: "studio-dynamic-dual-tip-r8-reference",
      version: 1,
      assetId: "dynamic-secondary-r8",
      contentHash: SECONDARY_HASH,
      width: 4,
      height: 3,
      channel: "alpha",
    },
    units: {
      diameter: "canonical-local-css-px",
      spacing: "document-css-px",
      scatter: "document-css-px",
      angle: "radians-relative-to-stroke",
    },
    secondaryDiameter: 9,
    secondarySpacing: 7,
    scatterAxes: "both-axes",
    scatterDistance: 3.5,
    count: 2,
    countJitter: 1,
    angleRadians: -0.28,
    roundness: 0.58,
    seed: 0x9182_73ab,
    blendFamily,
    secondaryOpacity: 0.68,
  });
  const result = await buildStudioDynamicDualTipPlan(
    canonical.value.plan,
    dynamics.plan,
    acceptedPrefix(canonical.value.plan, dynamics.plan),
    extension,
    {
      async resolve(request) {
        const bytes = request.assetId === "dynamic-primary-r8"
          ? PRIMARY_BYTES
          : SECONDARY_BYTES;
        return {
          kind: "studio-textured-brush-r8-asset",
          version: 1,
          assetId: request.assetId,
          contentHash: request.contentHash,
          width: request.expectedWidth ?? 4,
          height: request.expectedHeight ?? (
            request.assetId === "dynamic-primary-r8" ? 4 : 3
          ),
          channel: request.expectedChannel ?? "alpha",
          format: "r8-unorm",
          byteLength: bytes.byteLength,
          bytes,
        };
      },
    },
    { mode: options.mode ?? "rebuild" },
  );
  if (result.status !== "ready") {
    throw new Error(
      `dynamic plan ${id}: ${result.status} ${"reason" in result ? result.reason : ""}`,
    );
  }
  return result.plan;
}

async function executeCompleted(
  runtime: StudioDynamicDualTipWebGpuRuntime,
  plan: StudioDynamicDualTipPlan,
  requestSequence: number,
): Promise<StudioDynamicDualTipWebGpuReceipt> {
  const result = await runtime.execute({
    requestSequence,
    deviceEpoch: INITIAL_DEVICE_EPOCH,
    plan,
  });
  if (result.status !== "completed") {
    throw new Error(`dynamic request ${requestSequence}: ${result.status}`);
  }
  return result.receipt;
}

async function runCase(
  rawDevice: GPUDevice,
  modules: GPUShaderModule[],
  id: string,
  plans: readonly StudioDynamicDualTipPlan[],
): Promise<Readonly<{
  evidence: CaseEvidence;
  cpuWords: Uint16Array;
  gpuWords: Uint16Array;
}>> {
  const observed = observeDevice(rawDevice, modules);
  const target = createRuntime(observed);
  const receipts: StudioDynamicDualTipWebGpuReceipt[] = [];
  for (let index = 0; index < plans.length; index += 1) {
    receipts.push(await executeCompleted(target.runtime, plans[index]!, index + 1));
  }
  const gpuWords = await readRgba16Float(rawDevice, target.texture);
  const cpuWords = rasterIndependentCpu(plans);
  const metrics = comparePixels(cpuWords, gpuWords, plans);
  const first = plans[0]!;
  const evidence: CaseEvidence = {
    id,
    blendFamilies: plans.map((plan) => plan.extension.blendFamily),
    porterDuffOrder: plans.map((plan) => plan.primary.batches[0]!.porterDuff),
    receipts,
    primaryDabs: first.primary.dabs.length,
    secondaryStations: first.secondaryStations.length,
    secondaryInstances: first.secondaryInstances.length,
    reflectedAffineInstances: first.secondaryInstances.filter(
      (instance) =>
        instance.localToDocument[0] * instance.localToDocument[3]
        - instance.localToDocument[1] * instance.localToDocument[2] < 0,
    ).length,
    metrics,
    samples: [
      samplePixel("center-overlap", 33, 20, cpuWords, gpuWords),
      samplePixel("secondary-scatter", 41, 23, cpuWords, gpuWords),
      samplePixel("outside", 2, 2, cpuWords, gpuWords),
    ],
    cpuPng: await wordsPng(cpuWords),
    webgpuPng: await wordsPng(gpuWords),
    diffPng: await diffPng(cpuWords, gpuWords),
  };
  target.runtime.dispose();
  return { evidence, cpuWords, gpuWords };
}

async function assetBoundary(
  rawDevice: GPUDevice,
  modules: GPUShaderModule[],
  plan: StudioDynamicDualTipPlan,
) {
  const observed = observeDevice(rawDevice, modules);
  const target = createRuntime(observed, { maximumResidentAssetBytes: 28 });
  const beforeFirst = observed.assetTextureLabels.length;
  const first = await target.runtime.execute({
    requestSequence: 1,
    deviceEpoch: 1,
    plan,
  });
  const afterFirst = observed.assetTextureLabels.length;
  const cached = await target.runtime.execute({
    requestSequence: 2,
    deviceEpoch: 1,
    plan: { ...plan, mode: "append", primary: { ...plan.primary, mode: "append" } },
  });
  const afterCached = observed.assetTextureLabels.length;
  if (first.status !== "completed" || cached.status !== "completed") {
    throw new Error("dynamic asset cache setup did not complete");
  }

  const mutatedPlan: StudioDynamicDualTipPlan = {
    ...plan,
    secondaryAsset: {
      ...plan.secondaryAsset,
      bytes: new Uint8Array([254, ...plan.secondaryAsset.bytes.slice(1)]),
    },
  };
  const mutated = await target.runtime.execute({
    requestSequence: 3,
    deviceEpoch: 1,
    plan: mutatedPlan,
  });

  const budgetObserved = observeDevice(rawDevice, modules);
  const budgetTarget = createRuntime(budgetObserved, {
    maximumResidentAssetBytes: PRIMARY_BYTES.byteLength + SECONDARY_BYTES.byteLength - 1,
  });
  const budget = await budgetTarget.runtime.execute({
    requestSequence: 1,
    deviceEpoch: 1,
    plan,
  });
  target.runtime.dispose();
  budgetTarget.runtime.dispose();
  return {
    firstTextureCreations: afterFirst - beforeFirst,
    cachedTextureCreations: afterCached - afterFirst,
    mutatedHashStatus: mutated.status,
    mutatedHashReason: mutated.status === "rejected" ? mutated.reason : null,
    budgetStatus: budget.status,
    budgetReason: budget.status === "rejected" ? budget.reason : null,
  };
}

async function flowEvidence(
  rawDevice: GPUDevice,
  modules: GPUShaderModule[],
  plan: StudioDynamicDualTipPlan,
) {
  const cancelObserved = observeDevice(rawDevice, modules);
  const cancelTarget = createRuntime(cancelObserved);
  const controller = new AbortController();
  controller.abort();
  const cancelled = await cancelTarget.runtime.execute({
    requestSequence: 1,
    deviceEpoch: 1,
    plan,
  }, controller.signal);
  const reused = await cancelTarget.runtime.execute({
    requestSequence: 1,
    deviceEpoch: 1,
    plan,
  });
  cancelTarget.runtime.dispose();

  const gate = deferred();
  const busyObserved = observeDevice(rawDevice, modules, gate.promise);
  const busyTarget = createRuntime(busyObserved, { maximumInFlightSubmissions: 1 });
  const first = busyTarget.runtime.execute({
    requestSequence: 1,
    deviceEpoch: 1,
    plan,
  });
  const busy = await busyTarget.runtime.execute({
    requestSequence: 2,
    deviceEpoch: 1,
    plan: { ...plan, mode: "append", primary: { ...plan.primary, mode: "append" } },
  });
  gate.resolve();
  await first;
  const busyReused = await busyTarget.runtime.execute({
    requestSequence: 2,
    deviceEpoch: 1,
    plan: { ...plan, mode: "append", primary: { ...plan.primary, mode: "append" } },
  });
  busyTarget.runtime.dispose();
  return {
    cancelledStatus: cancelled.status,
    cancelledSequenceReusable: reused.status === "completed",
    busyStatus: busy.status,
    busyInFlight: busy.status === "busy" ? busy.inFlight : null,
    busySequenceReusable: busyReused.status === "completed",
  };
}

function withTimeout<Value>(
  promise: Promise<Value>,
  milliseconds: number,
  label: string,
): Promise<Value> {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      window.setTimeout(() => reject(new Error(`${label} timeout`)), milliseconds);
    }),
  ]);
}

async function run(): Promise<BrowserResult> {
  const browserCapabilities = capabilities();
  if (!browserCapabilities.webgpu) {
    return {
      status: "unsupported",
      reason: "webgpu-unavailable",
      message: "navigator.gpu is unavailable",
      capabilities: browserCapabilities,
    };
  }
  if (!browserCapabilities.offscreenCanvas) {
    return {
      status: "unsupported",
      reason: "offscreen-canvas-unavailable",
      message: "OffscreenCanvas is unavailable",
      capabilities: browserCapabilities,
    };
  }
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) {
    return {
      status: "unsupported",
      reason: "adapter-unavailable",
      message: "navigator.gpu.requestAdapter returned null",
      capabilities: browserCapabilities,
    };
  }
  let rawDevice: GPUDevice;
  try {
    rawDevice = await adapter.requestDevice();
  } catch (error) {
    return {
      status: "unsupported",
      reason: "device-request-failed",
      message: error instanceof Error ? error.message : String(error),
      capabilities: browserCapabilities,
    };
  }

  const modules: GPUShaderModule[] = [];
  const uncapturedGpuErrors: string[] = [];
  rawDevice.addEventListener("uncapturederror", (event) => {
    uncapturedGpuErrors.push(event.error.message);
  });
  rawDevice.pushErrorScope("out-of-memory");
  rawDevice.pushErrorScope("validation");

  const familyPlans = await Promise.all(
    BLEND_FAMILIES.map((family) => buildPlan(`family-${family}`, family)),
  );
  const familyCases = [];
  for (let index = 0; index < BLEND_FAMILIES.length; index += 1) {
    familyCases.push(await runCase(
      rawDevice,
      modules,
      `family-${BLEND_FAMILIES[index]}`,
      [familyPlans[index]!],
    ));
  }
  const appendFirst = await buildPlan("append-first", "screen");
  const appendSecond = await buildPlan("append-second", "difference", { mode: "append" });
  const appendCase = await runCase(
    rawDevice,
    modules,
    "append-sequence",
    [appendFirst, appendSecond],
  );
  const eraseBase = await buildPlan("erase-base", "add");
  const eraseTip = await buildPlan("erase-tip", "screen", {
    mode: "append",
    porterDuff: "destination-out",
  });
  const eraseCase = await runCase(
    rawDevice,
    modules,
    "destination-out",
    [eraseBase, eraseTip],
  );

  const familyCenterAlpha = Object.fromEntries(
    familyCases.map((caseRun, index) => [
      BLEND_FAMILIES[index]!,
      pixel(caseRun.gpuWords, 33, 20)[3],
    ]),
  ) as Record<StudioDynamicDualTipBlendFamily, number>;
  const asset = await assetBoundary(rawDevice, modules, familyPlans[0]!);
  const flow = await flowEvidence(rawDevice, modules, familyPlans[0]!);

  const shaders = await Promise.all(modules.map(async (module) => {
    if (typeof module.getCompilationInfo !== "function") {
      return { available: false, messages: [] };
    }
    const info = await module.getCompilationInfo();
    return {
      available: true,
      messages: [...info.messages].map((message) => ({
        type: message.type,
        message: message.message,
        lineNum: message.lineNum,
        linePos: message.linePos,
      })),
    };
  }));
  const validationError = await rawDevice.popErrorScope();
  const outOfMemoryError = await rawDevice.popErrorScope();

  let callbackInfo: GPUDeviceLostInfo | null = null;
  const lossObserved = observeDevice(rawDevice, modules);
  const lossTarget = createRuntime(lossObserved, {
    onDeviceLost(info) {
      callbackInfo = info;
    },
  });
  await executeCompleted(lossTarget.runtime, familyPlans[0]!, 1);
  rawDevice.destroy();
  const deviceInfo = await withTimeout(
    rawDevice.lost,
    DEVICE_LOSS_TIMEOUT_MS,
    "actual GPUDevice loss",
  );
  await Promise.resolve();
  await Promise.resolve();
  const rejected = await lossTarget.runtime.execute({
    requestSequence: 2,
    deviceEpoch: 1,
    plan: familyPlans[0]!,
  });
  const observedCallback = callbackInfo as GPUDeviceLostInfo | null;
  const info = adapter.info;
  return {
    status: "ok",
    backend: "dynamic-dual-tip-rgba16float-webgpu",
    width: WIDTH,
    height: HEIGHT,
    capabilities: browserCapabilities,
    provider: {
      kind: "real-chromium-webgpu-device-boundary",
      textureFormat: "rgba16float",
      readback: "aligned-rgba16float-map-read",
      bytesPerRow: nextAligned(WIDTH * RGBA16_BYTES_PER_PIXEL, ROW_ALIGNMENT),
      adapterInfo: {
        vendor: info.vendor,
        architecture: info.architecture,
        device: info.device,
        description: info.description,
        isFallbackAdapter:
          typeof (adapter as GPUAdapter & { isFallbackAdapter?: boolean }).isFallbackAdapter
            === "boolean"
            ? (adapter as GPUAdapter & { isFallbackAdapter: boolean }).isFallbackAdapter
            : null,
      },
    },
    tolerance: { cpuAbsolute: CPU_ABSOLUTE_TOLERANCE },
    cases: [
      ...familyCases.map((caseRun) => caseRun.evidence),
      appendCase.evidence,
      eraseCase.evidence,
    ],
    familyCenterAlpha,
    append: {
      receiptModes: appendCase.evidence.receipts.map((receipt) => receipt.mode),
      cpuParityViolations: appendCase.evidence.metrics.violatingComponents,
      outsideEdgeCpuParityViolations:
        appendCase.evidence.metrics.outsideEdgeViolatingComponents,
    },
    destinationOut: {
      baseCenterAlpha: pixel(
        rasterIndependentCpu([eraseBase]),
        33,
        20,
      )[3],
      erasedCenterAlpha: pixel(eraseCase.gpuWords, 33, 20)[3],
      cpuParityViolations: eraseCase.evidence.metrics.violatingComponents,
      outsideEdgeCpuParityViolations:
        eraseCase.evidence.metrics.outsideEdgeViolatingComponents,
    },
    assetBoundary: asset,
    flow,
    shaders,
    errorScopes: {
      validation: validationError?.message ?? null,
      outOfMemory: outOfMemoryError?.message ?? null,
    },
    uncapturedGpuErrors,
    deviceLoss: {
      trigger: "GPUDevice.destroy",
      reason: deviceInfo.reason,
      message: deviceInfo.message,
      callbackReason: observedCallback?.reason ?? "",
      callbackMessage: observedCallback?.message ?? "",
      runtimeEpoch: lossTarget.runtime.deviceEpoch,
      rejectedStatus: rejected.status,
      rejectedEpoch: rejected.status === "device-lost" ? rejected.deviceEpoch : null,
    },
  };
}

void run()
  .then((result) => {
    window.__studioDynamicDualTipWebGpuResult = result;
  })
  .catch((error: unknown) => {
    window.__studioDynamicDualTipWebGpuResult = {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack ?? null : null,
      capabilities: capabilities(),
    };
  });
