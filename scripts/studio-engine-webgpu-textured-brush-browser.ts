/**
 * Real Chromium WebGPU boundary harness for the clean-room textured-brush specialist.
 *
 * The production plan builder and runtime execute against a real GPUDevice. The harness observes
 * only shader modules and the runtime-created RGBA16F authority texture, then performs an aligned
 * MAP_READ. Its R8 sampling, integer noise, half-float and Porter-Duff oracle is independently
 * implemented here rather than imported from the production CPU helpers.
 */

import {
  hydrateStudioBrushR8GrainAsset,
  resetStudioBrushR8GrainRegistry,
} from "../apps/web/src/domains/creator/brush/studio-brush-r8-grain-runtime";
import {
  buildStudioEngineWebGpuTexturedBrushPlan,
  fingerprintStudioEngineWebGpuTexturedBrushPlanSemantics,
  type StudioEngineWebGpuTexturedBrushAssetRequest,
  type StudioEngineWebGpuTexturedBrushPlan,
} from "../apps/web/src/domains/creator/render/studio-engine-webgpu-textured-brush-plan";
import {
  createStudioEngineWebGpuTexturedBrushRuntime,
  packStudioEngineWebGpuTexturedBrushDabs,
  type StudioEngineWebGpuTexturedBrushReceipt,
  type StudioEngineWebGpuTexturedBrushRuntime,
} from "../apps/web/src/domains/creator/render/studio-engine-webgpu-textured-brush-runtime";
import {
  parseStudioCanonicalBrushPlan,
  type StudioCanonicalBrushGrain,
} from "../apps/web/src/domains/creator/studio-canonical-brush-plan";
import {
  parseStudioProfessionalBrushDynamicsPlan,
} from "../apps/web/src/domains/creator/studio-professional-brush-dynamics";
import { sha256HexPortable } from "../apps/web/src/domains/creator/studio-sha256";

import type { StudioBrushR8TextureGrainSource } from "../apps/web/src/domains/creator/brush/studio-brush-r8-grain-asset-contract";

const WIDTH = 64;
const HEIGHT = 48;
const INITIAL_DEVICE_EPOCH = 1;
const ROW_ALIGNMENT = 256;
const RGBA16_BYTES_PER_PIXEL = 8;
const MAP_READ = 0x0001;
const BUFFER_COPY_DST = 0x0008;
const DEVICE_LOSS_TIMEOUT_MS = 5_000;
const CPU_ABSOLUTE_TOLERANCE = 0.012;
const TIP_BYTES = new Uint8Array([
  255, 220, 180, 255,
  210, 255, 235, 190,
  160, 225, 255, 205,
  255, 175, 215, 255,
]);
const GRAIN_BYTES = new Uint8Array([
  255, 24, 196, 80,
  16, 224, 64, 248,
  188, 48, 236, 8,
  72, 208, 32, 168,
]);
const TIP_HASH = `sha256:${sha256HexPortable(TIP_BYTES)}`;
const GRAIN_HASH = `sha256:${sha256HexPortable(GRAIN_BYTES)}`;

function durableR8Source(
  assetId: string,
  channel: "alpha" | "luminance",
): Readonly<StudioBrushR8TextureGrainSource> {
  return {
    kind: "r8-texture-v1",
    asset: {
      assetId,
      encodedSha256:
        "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      decodedSha256: GRAIN_HASH as `sha256:${string}`,
      byteLength: 128,
      mediaType: "image/png",
      width: 4,
      height: 4,
      channel,
      encoding: "r8-unorm",
    },
  };
}

interface BrowserCapabilities {
  readonly webgpu: boolean;
  readonly offscreenCanvas: boolean;
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
  readonly index: number;
  readonly available: boolean;
  readonly messages: readonly ShaderCompilationMessage[];
}

interface PixelMetrics {
  readonly comparedComponents: number;
  readonly violatingComponents: number;
  readonly exactHalfWordMismatches: number;
  readonly unaffectedExactHalfWordMismatches: number;
  readonly maxAbsoluteDelta: number;
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

interface BrowserCaseEvidence {
  readonly id: string;
  readonly grainKind: "none" | "procedural-integer-noise" | "asset-r8-repeat";
  readonly grainSpace: "none" | "document" | "stroke";
  readonly grainSeed: number | null;
  readonly grainChannel: "none" | "alpha" | "luminance";
  readonly durableR8: boolean;
  readonly nativeR8TextureCreations: number;
  readonly repeatSeamDocumentX: number | null;
  readonly porterDuffOrder: readonly ("source-over" | "destination-out")[];
  readonly receipts: readonly StudioEngineWebGpuTexturedBrushReceipt[];
  readonly metrics: PixelMetrics;
  readonly samples: readonly PixelSample[];
  readonly cpuPng: string;
  readonly webgpuPng: string;
  readonly diffPng: string;
}

interface FlowControlEvidence {
  readonly cancelledStatus: string;
  readonly cancelledSequenceWasReusable: boolean;
  readonly busyStatus: string;
  readonly busyInFlight: number | null;
  readonly firstConcurrentStatus: string;
  readonly busySequenceWasReusable: boolean;
}

interface CacheBudgetEpochEvidence {
  readonly firstExecutionStatus: string;
  readonly secondExecutionStatus: string;
  readonly firstAssetTextureCreations: number;
  readonly secondAssetTextureCreations: number;
  readonly staleSequenceReason: string | null;
  readonly staleDeviceEpochReason: string | null;
  readonly budgetReason: string | null;
  readonly budgetAssetTextureCreations: number;
  readonly metadataAliasTextureCreations: number;
  readonly metadataAliasViolatingComponents: number;
  readonly metadataAliasMaxAbsoluteDelta: number;
  readonly mutatedHashStatus: string;
  readonly mutatedHashReason: string | null;
  readonly mutatedHashSubmittedTextures: number;
}

interface AppendRebuildEvidence {
  readonly appendReceipts: readonly StudioEngineWebGpuTexturedBrushReceipt[];
  readonly rebuildReceipt: StudioEngineWebGpuTexturedBrushReceipt;
  readonly exactHalfWordMismatches: number;
  readonly diffPng: string;
}

interface UninitializedAppendEvidence {
  readonly status: string;
  readonly reason: string | null;
  readonly assetTextureCreations: number;
  readonly nativeR8TextureCreations: number;
  readonly nonZeroHalfWords: number;
}

interface AnchorEvidence {
  readonly proceduralDocumentVsStrokeHalfWordMismatches: number;
  readonly assetDocumentVsStrokeHalfWordMismatches: number;
  readonly durableAlphaCanvasVsStrokeHalfWordMismatches: number;
  readonly durableLuminanceCanvasVsStrokeHalfWordMismatches: number;
}

interface DurableR8IdentityEvidence {
  readonly omittedSourceFingerprint: string;
  readonly boundSourceFingerprint: string;
  readonly fingerprintsDiffer: boolean;
}

interface DeviceLossEvidence {
  readonly trigger: "GPUDevice.destroy";
  readonly deviceReason: string;
  readonly deviceMessage: string;
  readonly callbackReason: string;
  readonly callbackMessage: string;
  readonly completedReceiptEpoch: number;
  readonly runtimeDeviceEpoch: number;
  readonly rejectedStatus: string;
  readonly rejectedDeviceEpoch: number | null;
}

type BrowserTexturedBrushResult =
  | {
      readonly status: "ok";
      readonly backend: "webgpu-textured-brush-rgba16float";
      readonly width: number;
      readonly height: number;
      readonly capabilities: BrowserCapabilities;
      readonly provider: {
        readonly kind: "real-chromium-webgpu-device-boundary";
        readonly adapterInfo: SerializableAdapterInfo;
        readonly textureFormat: "rgba16float";
        readonly readback: "aligned-rgba16float-map-read";
        readonly bytesPerRow: number;
        readonly maxTextureDimension2D: number;
      };
      readonly tolerance: {
        readonly cpuAbsolute: number;
      };
      readonly cases: readonly BrowserCaseEvidence[];
      readonly anchors: AnchorEvidence;
      readonly durableR8Identity: DurableR8IdentityEvidence;
      readonly uninitializedAppend: UninitializedAppendEvidence;
      readonly appendRebuild: AppendRebuildEvidence;
      readonly cacheBudgetEpochs: CacheBudgetEpochEvidence;
      readonly flowControl: FlowControlEvidence;
      readonly shaderCompilation: readonly ShaderCompilationEvidence[];
      readonly errorScopes: {
        readonly validation: string | null;
        readonly outOfMemory: string | null;
      };
      readonly uncapturedGpuErrors: readonly string[];
      readonly deviceLoss: DeviceLossEvidence;
    }
  | {
      readonly status: "unsupported";
      readonly reason:
        | "adapter-unavailable"
        | "device-request-failed"
        | "offscreen-canvas-unavailable"
        | "webgpu-unavailable";
      readonly message: string;
      readonly capabilities: BrowserCapabilities;
    }
  | {
      readonly status: "error";
      readonly message: string;
      readonly stack: string | null;
      readonly capabilities: BrowserCapabilities;
    };

declare global {
  interface Window {
    __studioEngineWebGpuTexturedBrushResult?: BrowserTexturedBrushResult;
  }
}

interface ObservedDevice {
  readonly device: GPUDevice;
  readonly authorityTextures: GPUTexture[];
  readonly assetTextureLabels: string[];
  readonly nativeR8TextureLabels: string[];
}

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

interface CaseRun {
  readonly evidence: BrowserCaseEvidence;
  readonly cpuWords: Uint16Array;
  readonly gpuWords: Uint16Array;
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

function serializableAdapterInfo(adapter: GPUAdapter): SerializableAdapterInfo {
  const info = adapter.info as GPUAdapterInfo | undefined;
  return {
    vendor: info?.vendor ?? "",
    architecture: info?.architecture ?? "",
    device: info?.device ?? "",
    description: info?.description ?? "",
    isFallbackAdapter:
      typeof (adapter as GPUAdapter & { isFallbackAdapter?: boolean }).isFallbackAdapter
        === "boolean"
        ? (adapter as GPUAdapter & { isFallbackAdapter: boolean }).isFallbackAdapter
        : null,
  };
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function withTimeout<Value>(
  promise: Promise<Value>,
  timeoutMilliseconds: number,
  label: string,
): Promise<Value> {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      window.setTimeout(
        () => reject(new Error(`${label} timed out after ${timeoutMilliseconds}ms`)),
        timeoutMilliseconds,
      );
    }),
  ]);
}

function nextAligned(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(lower: number, upper: number, value: number): number {
  const amount = clamp01((value - lower) / Math.max(1e-6, upper - lower));
  return amount * amount * (3 - 2 * amount);
}

function float32ToFloat16(value: number): number {
  float32Scratch[0] = value;
  const bits = uint32Scratch[0]!;
  const sign = (bits >>> 16) & 0x8000;
  const exponent = (bits >>> 23) & 0xff;
  let mantissa = (bits >>> 12) & 0x07ff;
  if (exponent < 103) return sign;
  if (exponent > 142) {
    if (exponent === 0xff && (bits & 0x007f_ffff) !== 0) return sign | 0x7e00;
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

function quantizeHalf(value: number): number {
  return float16ToFloat32(float32ToFloat16(value));
}

function mixUint32(input: number): number {
  let value = input >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb_352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846c_a68b);
  return (value ^ (value >>> 16)) >>> 0;
}

function integerNoise(cellX: number, cellY: number, seed: number): number {
  const mixed = seed
    ^ Math.imul(cellX | 0, 0x9e37_79b1)
    ^ Math.imul(cellY | 0, 0x85eb_ca77);
  return mixUint32(mixed) / 0x1_0000_0000;
}

function bilinear(
  x: number,
  y: number,
  texel: (texelX: number, texelY: number) => number,
): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const amountX = x - x0;
  const amountY = y - y0;
  const top = texel(x0, y0) * (1 - amountX) + texel(x0 + 1, y0) * amountX;
  const bottom =
    texel(x0, y0 + 1) * (1 - amountX)
    + texel(x0 + 1, y0 + 1) * amountX;
  return top * (1 - amountY) + bottom * amountY;
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

function repeatTexel(
  bytes: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const wrappedX = ((x % width) + width) % width;
  const wrappedY = ((y % height) + height) % height;
  return bytes[wrappedY * width + wrappedX]! / 255;
}

function independentTipCoverage(
  plan: StudioEngineWebGpuTexturedBrushPlan,
  u: number,
  v: number,
  hardness: number,
): number {
  const asset = plan.assets[plan.tip.assetIndex]!;
  const sampled = bilinear(
    u * asset.width - 0.5,
    v * asset.height - 0.5,
    (x, y) => zeroBorderTexel(asset.bytes, asset.width, asset.height, x, y),
  );
  return smoothstep(0, Math.max(1 / 65_535, 1 - hardness), sampled);
}

function independentGrainFactor(
  plan: StudioEngineWebGpuTexturedBrushPlan,
  documentX: number,
  documentY: number,
  depth: number,
): number {
  const grain = plan.grain;
  if (!grain) return 1;
  const durable = plan.durableR8GrainSource !== undefined;
  const phaseSeed = durable
    ? ((plan.grainPhaseStrokeSeed! ^ grain.seed) >>> 0)
    : 0;
  const phaseX = durable
    ? mixUint32(phaseSeed ^ 0x9e37_79b9) / 0x1_0000_0000
    : 0;
  const phaseY = durable
    ? mixUint32(phaseSeed ^ 0x243f_6a88) / 0x1_0000_0000
    : 0;
  const x = documentX - grain.originX;
  const y = documentY - grain.originY;
  let sampled: number;
  if (grain.kind === "asset-r8-repeat") {
    const asset = plan.assets[grain.assetIndex]!;
    sampled = bilinear(
      (x / grain.scale + phaseX) * asset.width - 0.5,
      (y / grain.scale + phaseY) * asset.height - 0.5,
      (texelX, texelY) =>
        repeatTexel(asset.bytes, asset.width, asset.height, texelX, texelY),
    );
  } else {
    sampled = integerNoise(
      Math.floor(x / grain.scale),
      Math.floor(y / grain.scale),
      grain.seed,
    );
  }
  const contrasted = clamp01(
    0.5 + (sampled - 0.5) * (
      1 + grain.contrast * (durable ? 4 : 3)
    ),
  );
  const shaped = grain.invert ? 1 - contrasted : contrasted;
  return 1 - depth + depth * shaped;
}

function rasterIndependentCpu(
  plans: readonly StudioEngineWebGpuTexturedBrushPlan[],
): Uint16Array {
  const values = new Float32Array(WIDTH * HEIGHT * 4);
  for (const plan of plans) {
    if (plan.mode === "rebuild") values.fill(0);
    for (const dab of plan.dabs) {
      const [xx, xy, yx, yy] = dab.tip.localToDocument;
      const determinant = xx * yy - xy * yx;
      for (let y = 0; y < HEIGHT; y += 1) {
        for (let x = 0; x < WIDTH; x += 1) {
          const documentX = x + 0.5;
          const documentY = y + 0.5;
          const deltaX = documentX - dab.x;
          const deltaY = documentY - dab.y;
          const localX = (yy * deltaX - yx * deltaY) / determinant;
          const localY = (-xy * deltaX + xx * deltaY) / determinant;
          if (Math.abs(localX) > 1 || Math.abs(localY) > 1) continue;
          const tipCoverage = independentTipCoverage(
            plan,
            localX * 0.5 + 0.5,
            localY * 0.5 + 0.5,
            dab.tip.hardness,
          );
          const grainFactor = independentGrainFactor(
            plan,
            documentX,
            documentY,
            dab.grainDepth,
          );
          const sourceAlpha = clamp01(
            dab.color.components[3] * tipCoverage * grainFactor,
          );
          const inverse = 1 - sourceAlpha;
          const offset = (y * WIDTH + x) * 4;
          if (dab.composite.porterDuff === "destination-out") {
            values[offset] = quantizeHalf(values[offset]! * inverse);
            values[offset + 1] = quantizeHalf(values[offset + 1]! * inverse);
            values[offset + 2] = quantizeHalf(values[offset + 2]! * inverse);
            values[offset + 3] = quantizeHalf(values[offset + 3]! * inverse);
          } else {
            values[offset] = quantizeHalf(
              dab.color.components[0] * sourceAlpha + values[offset]! * inverse,
            );
            values[offset + 1] = quantizeHalf(
              dab.color.components[1] * sourceAlpha + values[offset + 1]! * inverse,
            );
            values[offset + 2] = quantizeHalf(
              dab.color.components[2] * sourceAlpha + values[offset + 2]! * inverse,
            );
            values[offset + 3] = quantizeHalf(
              sourceAlpha + values[offset + 3]! * inverse,
            );
          }
        }
      }
    }
  }
  const words = new Uint16Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    words[index] = float32ToFloat16(values[index]!);
  }
  return words;
}

function comparePixels(cpu: Uint16Array, gpu: Uint16Array): PixelMetrics {
  let violatingComponents = 0;
  let exactHalfWordMismatches = 0;
  let unaffectedExactHalfWordMismatches = 0;
  let maxAbsoluteDelta = 0;
  let totalAbsoluteDelta = 0;
  for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel += 1) {
    const offset = pixel * 4;
    const unaffected =
      cpu[offset] === 0
      && cpu[offset + 1] === 0
      && cpu[offset + 2] === 0
      && cpu[offset + 3] === 0;
    for (let channel = 0; channel < 4; channel += 1) {
      const index = offset + channel;
      if (cpu[index] !== gpu[index]) {
        exactHalfWordMismatches += 1;
        if (unaffected) unaffectedExactHalfWordMismatches += 1;
      }
      const delta = Math.abs(
        float16ToFloat32(cpu[index]!) - float16ToFloat32(gpu[index]!),
      );
      if (delta > CPU_ABSOLUTE_TOLERANCE) violatingComponents += 1;
      maxAbsoluteDelta = Math.max(maxAbsoluteDelta, delta);
      totalAbsoluteDelta += delta;
    }
  }
  return {
    comparedComponents: cpu.length,
    violatingComponents,
    exactHalfWordMismatches,
    unaffectedExactHalfWordMismatches,
    maxAbsoluteDelta,
    meanAbsoluteDelta: totalAbsoluteDelta / cpu.length,
  };
}

function samplePixel(
  label: string,
  x: number,
  y: number,
  cpu: Uint16Array,
  gpu: Uint16Array,
): PixelSample {
  const offset = (y * WIDTH + x) * 4;
  const cpuPixel = [
    float16ToFloat32(cpu[offset]!),
    float16ToFloat32(cpu[offset + 1]!),
    float16ToFloat32(cpu[offset + 2]!),
    float16ToFloat32(cpu[offset + 3]!),
  ] as const;
  const gpuPixel = [
    float16ToFloat32(gpu[offset]!),
    float16ToFloat32(gpu[offset + 1]!),
    float16ToFloat32(gpu[offset + 2]!),
    float16ToFloat32(gpu[offset + 3]!),
  ] as const;
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

function linearToSrgb(value: number): number {
  const safe = clamp01(value);
  return safe <= 0.0031308
    ? safe * 12.92
    : 1.055 * Math.pow(safe, 1 / 2.4) - 0.055;
}

async function canvasPng(words: Uint16Array): Promise<string> {
  const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel += 1) {
    const offset = pixel * 4;
    const alpha = clamp01(float16ToFloat32(words[offset + 3]!));
    const inverseAlpha = alpha > 1e-6 ? 1 / alpha : 0;
    pixels[offset] = Math.round(
      linearToSrgb(float16ToFloat32(words[offset]!) * inverseAlpha) * 255,
    );
    pixels[offset + 1] = Math.round(
      linearToSrgb(float16ToFloat32(words[offset + 1]!) * inverseAlpha) * 255,
    );
    pixels[offset + 2] = Math.round(
      linearToSrgb(float16ToFloat32(words[offset + 2]!) * inverseAlpha) * 255,
    );
    pixels[offset + 3] = Math.round(alpha * 255);
  }
  const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D evidence canvas unavailable");
  context.putImageData(new ImageData(pixels, WIDTH, HEIGHT), 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return blobToDataUrl(blob);
}

async function diffPng(left: Uint16Array, right: Uint16Array): Promise<string> {
  const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel += 1) {
    const offset = pixel * 4;
    let maximum = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      maximum = Math.max(
        maximum,
        Math.abs(
          float16ToFloat32(left[offset + channel]!)
          - float16ToFloat32(right[offset + channel]!),
        ),
      );
    }
    const intensity = Math.round(clamp01(maximum * 64) * 255);
    pixels[offset] = intensity;
    pixels[offset + 1] = 0;
    pixels[offset + 2] = 255 - intensity;
    pixels[offset + 3] = 255;
  }
  const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D diff canvas unavailable");
  context.putImageData(new ImageData(pixels, WIDTH, HEIGHT), 0, 0);
  return blobToDataUrl(await canvas.convertToBlob({ type: "image/png" }));
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(blob);
  });
}

function observeDevice(
  rawDevice: GPUDevice,
  shaderModules: GPUShaderModule[],
  fenceGate?: Promise<void>,
): ObservedDevice {
  const authorityTextures: GPUTexture[] = [];
  const assetTextureLabels: string[] = [];
  const nativeR8TextureLabels: string[] = [];
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
          if (label === "Studio textured brush rgba16float authority") {
            authorityTextures.push(texture);
          } else if (label.startsWith("Studio verified R8 grain ")) {
            nativeR8TextureLabels.push(label);
          } else if (label.startsWith("Studio textured brush ")) {
            assetTextureLabels.push(label);
          }
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
  return {
    device,
    authorityTextures,
    assetTextureLabels,
    nativeR8TextureLabels,
  };
}

function createRuntime(
  observed: ObservedDevice,
  options: Readonly<{
    maximumInFlightSubmissions?: number;
    maximumResidentAssetBytes?: number;
    onDeviceLost?: (info: GPUDeviceLostInfo) => void;
  }> = {},
): Readonly<{
  runtime: StudioEngineWebGpuTexturedBrushRuntime;
  texture: GPUTexture;
}> {
  const before = observed.authorityTextures.length;
  const created = createStudioEngineWebGpuTexturedBrushRuntime({
    device: observed.device,
    width: WIDTH,
    height: HEIGHT,
    initialDeviceEpoch: INITIAL_DEVICE_EPOCH,
    ...options,
  });
  if (created.status !== "ready") {
    throw new Error(`textured runtime initialization failed: ${created.reason}`);
  }
  const texture = observed.authorityTextures[before];
  if (!texture) throw new Error("runtime authority texture was not observed");
  return { runtime: created.runtime, texture };
}

async function readRgba16Float(
  rawDevice: GPUDevice,
  texture: GPUTexture,
): Promise<Uint16Array> {
  const unpaddedBytesPerRow = WIDTH * RGBA16_BYTES_PER_PIXEL;
  const bytesPerRow = nextAligned(unpaddedBytesPerRow, ROW_ALIGNMENT);
  const buffer = rawDevice.createBuffer({
    label: "Studio textured brush browser readback",
    size: bytesPerRow * HEIGHT,
    usage: MAP_READ | BUFFER_COPY_DST,
  });
  const encoder = rawDevice.createCommandEncoder({
    label: "Studio textured brush browser readback encoder",
  });
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
    const source = new Uint16Array(
      mapped.buffer,
      mapped.byteOffset + row * bytesPerRow,
      WIDTH * 4,
    );
    words.set(source, row * WIDTH * 4);
  }
  buffer.unmap();
  buffer.destroy();
  return words;
}

function sourceCandidate(
  id: string,
  porterDuff: "source-over" | "destination-out",
  color: readonly [number, number, number, number],
  grain: StudioCanonicalBrushGrain | null,
) {
  return {
    kind: "studio-canonical-brush-plan",
    version: 1,
    sessionEpoch: 1,
    strokeEpoch: 1,
    commandSequence: 1,
    strokeId: id,
    seed: 0x45ab_19ef,
    coordinateSpace: "document-css-px",
    transform: {
      encoding: "affine-f64-v1",
      m11: 1,
      m12: 0,
      m21: 0,
      m22: 1,
      translateX: 0,
      translateY: 0,
    },
    color: {
      space: "linear-srgb",
      alphaMode: "straight",
      components: color,
    },
    composite: {
      porterDuff,
      blendMode: "normal",
      opacity: 1,
    },
    recipe: {
      version: 1,
      brushId: `browser-${id}`,
      engine: "dab-v1",
      material: porterDuff === "destination-out" ? "eraser" : "ink",
      tip: {
        kind: "texture",
        assetId: "browser-tip-r8",
        contentHash: TIP_HASH,
        channel: "alpha",
        width: 4,
        height: 4,
      },
      size: 24,
      flow: 1,
      hardness: 0,
      spacingRatio: 0.25,
      scatter: { radiusRatio: 0, distribution: "uniform-disk" },
      angleRadians: 0,
      roundness: 1,
      pressure: {
        size: { minimum: 1, maximum: 1, exponent: 1 },
        opacity: { minimum: 1, maximum: 1, exponent: 1 },
        flow: { minimum: 1, maximum: 1, exponent: 1 },
      },
      grain,
      wetMedia: null,
    },
    source: {
      encoding: "accepted-authoritative-samples-v1",
      firstSequence: 1,
      lastSequence: 1,
      samples: [{
        role: "authoritative",
        sequence: 1,
        x: 32,
        y: 24,
        pressure: 1,
        tangentialPressure: 0,
        tiltX: 0,
        tiltY: 0,
        twist: 0,
        timeMilliseconds: 0,
        pointerId: 1,
        flags: 0,
      }],
    },
  };
}

function dynamicsCandidate(id: string, textureDepth: number) {
  const channel = (base: number, min: number, max: number) => ({
    base,
    min,
    max,
    mappings: [],
  });
  return {
    kind: "studio-professional-brush-dynamics",
    version: 1,
    planId: `browser-${id}`,
    revision: 1,
    seed: 0x713a_4bc9,
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
      size: channel(24, 0.01, 512),
      opacity: channel(1, 0, 1),
      flow: channel(1, 0, 1),
      spacing: channel(6, 0.05, 512),
      angle: channel(0, -Math.PI * 2, Math.PI * 2),
      roundness: channel(1, 0.01, 1),
      scatter: channel(0, 0, 512),
      textureDepth: channel(textureDepth, 0, 1),
    },
  };
}

async function buildPlan(
  id: string,
  options: Readonly<{
    mode?: "append" | "rebuild";
    porterDuff?: "source-over" | "destination-out";
    color?: readonly [number, number, number, number];
    grain?: StudioCanonicalBrushGrain | null;
    grainChannel?: "alpha" | "luminance";
    durableR8GrainSource?: Readonly<StudioBrushR8TextureGrainSource>;
  }> = {},
): Promise<StudioEngineWebGpuTexturedBrushPlan> {
  const grain = options.grain ?? null;
  const canonical = parseStudioCanonicalBrushPlan(
    sourceCandidate(
      id,
      options.porterDuff ?? "source-over",
      options.color ?? [0.82, 0.18, 0.06, 0.8],
      grain,
    ),
    { sessionEpoch: 1, strokeEpoch: 1, lastAcceptedCommandSequence: 0 },
  );
  if (!canonical.ok) {
    throw new Error(`canonical ${id} failed: ${canonical.reason} ${canonical.path}`);
  }
  const dynamics = parseStudioProfessionalBrushDynamicsPlan(
    dynamicsCandidate(id, grain === null ? 0 : 1),
  );
  if (!dynamics.ok) {
    throw new Error(`dynamics ${id} failed: ${dynamics.reason} ${dynamics.path}`);
  }
  const result = await buildStudioEngineWebGpuTexturedBrushPlan(
    canonical.value.plan,
    dynamics.plan,
    {
      async resolve(request: StudioEngineWebGpuTexturedBrushAssetRequest) {
        const bytes = request.role === "tip" ? TIP_BYTES : GRAIN_BYTES;
        return {
          kind: "studio-textured-brush-r8-asset",
          version: 1,
          assetId: request.assetId,
          contentHash: request.contentHash,
          width: request.expectedWidth ?? 4,
          height: request.expectedHeight ?? 4,
          channel: request.expectedChannel ?? options.grainChannel ?? "luminance",
          format: "r8-unorm",
          byteLength: bytes.byteLength,
          bytes,
        };
      },
    },
    {
      mode: options.mode ?? "rebuild",
      ...(options.durableR8GrainSource
        ? { durableR8GrainSource: options.durableR8GrainSource }
        : {}),
    },
  );
  if (result.status !== "ready") {
    throw new Error(`textured plan ${id} failed: ${result.status} ${"reason" in result ? result.reason : ""}`);
  }
  if (result.plan.dabs.length !== 1) {
    throw new Error(`textured plan ${id} expected one dab, got ${result.plan.dabs.length}`);
  }
  return result.plan;
}

async function executeCompleted(
  runtime: StudioEngineWebGpuTexturedBrushRuntime,
  plan: StudioEngineWebGpuTexturedBrushPlan,
  requestSequence: number,
): Promise<StudioEngineWebGpuTexturedBrushReceipt> {
  const result = await runtime.execute({
    requestSequence,
    deviceEpoch: INITIAL_DEVICE_EPOCH,
    plan,
  });
  if (result.status !== "completed") {
    const firstDab = plan.dabs[0];
    const diagnostics = firstDab
      ? {
          status: result.status,
          reason: "reason" in result ? result.reason : null,
          planFingerprint: plan.semanticFingerprint ?? null,
          dab: {
            pressure: firstDab.pressure,
            opacity: firstDab.opacity,
            flow: firstDab.flow,
            grainDepth: firstDab.grainDepth,
            color: firstDab.color.components,
            hardness: firstDab.tip.hardness,
            roundness: firstDab.tip.roundness,
          },
        }
      : {
          status: result.status,
          reason: "reason" in result ? result.reason : null,
          planFingerprint: plan.semanticFingerprint ?? null,
          dab: null,
        };
    throw new Error(
      `request ${requestSequence} did not complete: ${JSON.stringify(diagnostics)}`,
    );
  }
  return result.receipt;
}

async function runCase(
  rawDevice: GPUDevice,
  shaderModules: GPUShaderModule[],
  id: string,
  plans: readonly StudioEngineWebGpuTexturedBrushPlan[],
): Promise<CaseRun> {
  const observed = observeDevice(rawDevice, shaderModules);
  const target = createRuntime(observed);
  const receipts: StudioEngineWebGpuTexturedBrushReceipt[] = [];
  for (let index = 0; index < plans.length; index += 1) {
    receipts.push(await executeCompleted(target.runtime, plans[index]!, index + 1));
  }
  const gpuWords = await readRgba16Float(rawDevice, target.texture);
  const cpuWords = rasterIndependentCpu(plans);
  const metrics = comparePixels(cpuWords, gpuWords);
  const first = plans[0]!;
  const grain = first.grain;
  const durableSource = first.durableR8GrainSource;
  const samples = [
    samplePixel("center", 32, 24, cpuWords, gpuWords),
    samplePixel("zero-border-edge", 20, 24, cpuWords, gpuWords),
    samplePixel("outside-footprint", 18, 24, cpuWords, gpuWords),
  ];
  let repeatSeamDocumentX: number | null = null;
  if (
    durableSource
    && grain?.kind === "asset-r8-repeat"
    && first.grainPhaseStrokeSeed !== undefined
  ) {
    const phaseSeed = (first.grainPhaseStrokeSeed ^ grain.seed) >>> 0;
    const phaseX =
      mixUint32(phaseSeed ^ 0x9e37_79b9) / 0x1_0000_0000;
    const nearestRepeat = Math.round(
      (first.dabs[0]!.x - grain.originX) / grain.scale + phaseX,
    );
    repeatSeamDocumentX =
      grain.originX + (nearestRepeat - phaseX) * grain.scale;
    const leftX = Math.max(
      0,
      Math.min(WIDTH - 2, Math.floor(repeatSeamDocumentX - 0.5)),
    );
    const sampleY = Math.max(
      0,
      Math.min(HEIGHT - 1, Math.floor(first.dabs[0]!.y)),
    );
    samples.push(
      samplePixel("native-repeat-seam-left", leftX, sampleY, cpuWords, gpuWords),
      samplePixel("native-repeat-seam-right", leftX + 1, sampleY, cpuWords, gpuWords),
    );
  }
  const evidence: BrowserCaseEvidence = {
    id,
    grainKind: grain?.kind ?? "none",
    grainSpace: grain?.space ?? "none",
    grainSeed: grain?.seed ?? null,
    grainChannel: durableSource?.asset.channel
      ?? (
        grain?.kind === "asset-r8-repeat"
          ? first.assets[grain.assetIndex]!.channel
          : "none"
    ),
    durableR8: durableSource !== undefined,
    nativeR8TextureCreations: observed.nativeR8TextureLabels.length,
    repeatSeamDocumentX,
    porterDuffOrder: plans.map(
      (plan) => plan.dabs[0]!.composite.porterDuff,
    ),
    receipts,
    metrics,
    samples,
    cpuPng: await canvasPng(cpuWords),
    webgpuPng: await canvasPng(gpuWords),
    diffPng: await diffPng(cpuWords, gpuWords),
  };
  target.runtime.dispose();
  return { evidence, cpuWords, gpuWords };
}

function withSemanticFingerprint(
  plan: StudioEngineWebGpuTexturedBrushPlan,
): StudioEngineWebGpuTexturedBrushPlan {
  const { semanticFingerprint: _staleFingerprint, ...semanticPlan } = plan;
  const semanticFingerprint =
    fingerprintStudioEngineWebGpuTexturedBrushPlanSemantics(semanticPlan);
  if (!semanticFingerprint) {
    throw new Error(`could not fingerprint browser plan ${plan.strokeId}`);
  }
  return { ...semanticPlan, semanticFingerprint };
}

function doublePlan(
  plan: StudioEngineWebGpuTexturedBrushPlan,
): StudioEngineWebGpuTexturedBrushPlan {
  return withSemanticFingerprint({
    ...plan,
    semanticFingerprint: undefined,
    mode: "rebuild",
    commandSequence: 2,
    dabs: [
      plan.dabs[0]!,
      { ...plan.dabs[0]!, index: 1 },
    ],
    batches: [{
      ...plan.batches[0]!,
      firstInstance: 0,
      instanceCount: 2,
    }],
  });
}

function countHalfWordMismatches(left: Uint16Array, right: Uint16Array): number {
  let mismatches = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) mismatches += 1;
  }
  return mismatches;
}

async function appendRebuildEvidence(
  rawDevice: GPUDevice,
  shaderModules: GPUShaderModule[],
  base: StudioEngineWebGpuTexturedBrushPlan,
): Promise<AppendRebuildEvidence> {
  const appendObserved = observeDevice(rawDevice, shaderModules);
  const appendTarget = createRuntime(appendObserved);
  const firstReceipt = await executeCompleted(appendTarget.runtime, base, 1);
  const secondReceipt = await executeCompleted(
    appendTarget.runtime,
    withSemanticFingerprint({ ...base, mode: "append" }),
    2,
  );
  const appendWords = await readRgba16Float(rawDevice, appendTarget.texture);

  const rebuildObserved = observeDevice(rawDevice, shaderModules);
  const rebuildTarget = createRuntime(rebuildObserved);
  const rebuildReceipt = await executeCompleted(
    rebuildTarget.runtime,
    doublePlan(base),
    1,
  );
  const rebuildWords = await readRgba16Float(rawDevice, rebuildTarget.texture);
  const evidence = {
    appendReceipts: [firstReceipt, secondReceipt],
    rebuildReceipt,
    exactHalfWordMismatches: countHalfWordMismatches(appendWords, rebuildWords),
    diffPng: await diffPng(appendWords, rebuildWords),
  };
  appendTarget.runtime.dispose();
  rebuildTarget.runtime.dispose();
  return evidence;
}

async function uninitializedAppendEvidence(
  rawDevice: GPUDevice,
  shaderModules: GPUShaderModule[],
  plan: StudioEngineWebGpuTexturedBrushPlan,
): Promise<UninitializedAppendEvidence> {
  const observed = observeDevice(rawDevice, shaderModules);
  const target = createRuntime(observed);
  const result = await target.runtime.execute({
    requestSequence: 1,
    deviceEpoch: INITIAL_DEVICE_EPOCH,
    plan: withSemanticFingerprint({ ...plan, mode: "append" }),
  });
  const words = await readRgba16Float(rawDevice, target.texture);
  const evidence = {
    status: result.status,
    reason: result.status === "rejected" ? result.reason : null,
    assetTextureCreations: observed.assetTextureLabels.length,
    nativeR8TextureCreations: observed.nativeR8TextureLabels.length,
    nonZeroHalfWords: words.reduce(
      (count, value) => count + (value === 0 ? 0 : 1),
      0,
    ),
  };
  target.runtime.dispose();
  return evidence;
}

async function cacheBudgetEpochEvidence(
  rawDevice: GPUDevice,
  shaderModules: GPUShaderModule[],
  plan: StudioEngineWebGpuTexturedBrushPlan,
): Promise<CacheBudgetEpochEvidence> {
  const observed = observeDevice(rawDevice, shaderModules);
  const target = createRuntime(observed, {
    maximumResidentAssetBytes: TIP_BYTES.byteLength * 2,
  });
  const beforeFirst = observed.assetTextureLabels.length;
  const first = await target.runtime.execute({
    requestSequence: 1,
    deviceEpoch: 1,
    plan,
  });
  const afterFirst = observed.assetTextureLabels.length;
  const second = await target.runtime.execute({
    requestSequence: 2,
    deviceEpoch: 1,
    plan: withSemanticFingerprint({ ...plan, mode: "append" }),
  });
  const afterSecond = observed.assetTextureLabels.length;
  const metadataAlias: StudioEngineWebGpuTexturedBrushPlan = withSemanticFingerprint({
    ...plan,
    mode: "rebuild",
    assets: [{
      ...plan.assets[0]!,
      width: 2,
      height: 8,
    }],
  });
  const beforeAlias = observed.assetTextureLabels.length;
  const alias = await target.runtime.execute({
    requestSequence: 3,
    deviceEpoch: 1,
    plan: metadataAlias,
  });
  const afterAlias = observed.assetTextureLabels.length;
  if (alias.status !== "completed") {
    throw new Error(`metadata alias execution failed: ${alias.status}`);
  }
  const aliasGpu = await readRgba16Float(rawDevice, target.texture);
  const aliasCpu = rasterIndependentCpu([metadataAlias]);
  const aliasMetrics = comparePixels(aliasCpu, aliasGpu);
  const staleSequence = await target.runtime.execute({
    requestSequence: 3,
    deviceEpoch: 1,
    plan,
  });
  const staleDevice = await target.runtime.execute({
    requestSequence: 4,
    deviceEpoch: 2,
    plan,
  });

  const budgetObserved = observeDevice(rawDevice, shaderModules);
  const budgetTarget = createRuntime(budgetObserved, {
    maximumResidentAssetBytes: TIP_BYTES.byteLength - 1,
  });
  const budgetBefore = budgetObserved.assetTextureLabels.length;
  const budget = await budgetTarget.runtime.execute({
    requestSequence: 1,
    deviceEpoch: 1,
    plan,
  });
  const mutatedObserved = observeDevice(rawDevice, shaderModules);
  const mutatedTarget = createRuntime(mutatedObserved);
  const mutated: StudioEngineWebGpuTexturedBrushPlan = {
    ...plan,
    assets: [{
      ...plan.assets[0]!,
      bytes: new Uint8Array([
        254,
        ...plan.assets[0]!.bytes.slice(1),
      ]),
    }],
  };
  const mutatedBefore = mutatedObserved.assetTextureLabels.length;
  const mutatedHash = await mutatedTarget.runtime.execute({
    requestSequence: 1,
    deviceEpoch: 1,
    plan: mutated,
  });
  const evidence = {
    firstExecutionStatus: first.status,
    secondExecutionStatus: second.status,
    firstAssetTextureCreations: afterFirst - beforeFirst,
    secondAssetTextureCreations: afterSecond - afterFirst,
    staleSequenceReason: staleSequence.status === "rejected" ? staleSequence.reason : null,
    staleDeviceEpochReason: staleDevice.status === "rejected" ? staleDevice.reason : null,
    budgetReason: budget.status === "rejected" ? budget.reason : null,
    budgetAssetTextureCreations:
      budgetObserved.assetTextureLabels.length - budgetBefore,
    metadataAliasTextureCreations: afterAlias - beforeAlias,
    metadataAliasViolatingComponents: aliasMetrics.violatingComponents,
    metadataAliasMaxAbsoluteDelta: aliasMetrics.maxAbsoluteDelta,
    mutatedHashStatus: mutatedHash.status,
    mutatedHashReason: mutatedHash.status === "rejected" ? mutatedHash.reason : null,
    mutatedHashSubmittedTextures:
      mutatedObserved.assetTextureLabels.length - mutatedBefore,
  };
  target.runtime.dispose();
  budgetTarget.runtime.dispose();
  mutatedTarget.runtime.dispose();
  return evidence;
}

async function flowControlEvidence(
  rawDevice: GPUDevice,
  shaderModules: GPUShaderModule[],
  plan: StudioEngineWebGpuTexturedBrushPlan,
): Promise<FlowControlEvidence> {
  const cancelObserved = observeDevice(rawDevice, shaderModules);
  const cancelTarget = createRuntime(cancelObserved);
  const controller = new AbortController();
  controller.abort("browser-preflight-cancel");
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
  const busyObserved = observeDevice(rawDevice, shaderModules, gate.promise);
  const busyTarget = createRuntime(busyObserved, {
    maximumInFlightSubmissions: 1,
  });
  const first = busyTarget.runtime.execute({
    requestSequence: 1,
    deviceEpoch: 1,
    plan,
  });
  const busy = await busyTarget.runtime.execute({
    requestSequence: 2,
    deviceEpoch: 1,
    plan: withSemanticFingerprint({ ...plan, mode: "append" }),
  });
  gate.resolve();
  const firstResult = await first;
  const reusedBusySequence = await busyTarget.runtime.execute({
    requestSequence: 2,
    deviceEpoch: 1,
    plan: withSemanticFingerprint({ ...plan, mode: "append" }),
  });
  busyTarget.runtime.dispose();
  return {
    cancelledStatus: cancelled.status,
    cancelledSequenceWasReusable: reused.status === "completed",
    busyStatus: busy.status,
    busyInFlight: busy.status === "busy" ? busy.inFlight : null,
    firstConcurrentStatus: firstResult.status,
    busySequenceWasReusable: reusedBusySequence.status === "completed",
  };
}

async function compilationEvidence(
  modules: readonly GPUShaderModule[],
): Promise<readonly ShaderCompilationEvidence[]> {
  return Promise.all(modules.map(async (module, index) => {
    if (typeof module.getCompilationInfo !== "function") {
      return { index, available: false, messages: [] };
    }
    const info = await module.getCompilationInfo();
    return {
      index,
      available: true,
      messages: [...info.messages].map((message) => ({
        type: message.type,
        message: message.message,
        lineNum: message.lineNum,
        linePos: message.linePos,
        offset: message.offset,
        length: message.length,
      })),
    };
  }));
}

async function run(): Promise<BrowserTexturedBrushResult> {
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
      message: "OffscreenCanvas evidence generation is unavailable",
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

  const shaderModules: GPUShaderModule[] = [];
  const uncapturedGpuErrors: string[] = [];
  rawDevice.addEventListener("uncapturederror", (event) => {
    uncapturedGpuErrors.push(event.error.message);
  });
  rawDevice.pushErrorScope("out-of-memory");
  rawDevice.pushErrorScope("validation");

  const noGrain = await buildPlan("zero-border-source-over");
  const proceduralDocument = await buildPlan("procedural-document", {
    grain: {
      kind: "procedural-noise",
      assetId: null,
      contentHash: null,
      space: "document",
      scale: 7,
      depth: 0.8,
      contrast: 0.55,
      seed: 0xffff_ffff,
    },
  });
  const proceduralStroke = await buildPlan("procedural-stroke", {
    grain: {
      kind: "procedural-noise",
      assetId: null,
      contentHash: null,
      space: "stroke",
      scale: 7,
      depth: 0.8,
      contrast: 0.55,
      seed: 0xffff_ffff,
    },
  });
  const assetDocument = await buildPlan("asset-document", {
    grain: {
      kind: "texture",
      assetId: "browser-grain-r8",
      contentHash: GRAIN_HASH,
      space: "document",
      scale: 13,
      depth: 0.75,
      contrast: 0.35,
      seed: 37,
    },
  });
  const assetStroke = await buildPlan("asset-stroke", {
    grain: {
      kind: "texture",
      assetId: "browser-grain-r8",
      contentHash: GRAIN_HASH,
      space: "stroke",
      scale: 13,
      depth: 0.75,
      contrast: 0.35,
      seed: 37,
    },
  });
  resetStudioBrushR8GrainRegistry();
  const durableCases: Array<Readonly<{
    id: string;
    channel: "alpha" | "luminance";
    canonicalSpace: "document" | "stroke";
  }>> = [
    { id: "durable-r8-alpha-canvas", channel: "alpha", canonicalSpace: "document" },
    { id: "durable-r8-alpha-stroke", channel: "alpha", canonicalSpace: "stroke" },
    {
      id: "durable-r8-luminance-canvas",
      channel: "luminance",
      canonicalSpace: "document",
    },
    {
      id: "durable-r8-luminance-stroke",
      channel: "luminance",
      canonicalSpace: "stroke",
    },
  ];
  const durablePlans: StudioEngineWebGpuTexturedBrushPlan[] = [];
  for (const descriptor of durableCases) {
    const source = durableR8Source(
      `browser-${descriptor.id}`,
      descriptor.channel,
    );
    const hydrated = hydrateStudioBrushR8GrainAsset(source, GRAIN_BYTES);
    if (hydrated.status !== "ready") {
      throw new Error(
        `durable R8 hydration ${descriptor.id} failed: ${hydrated.reason}`,
      );
    }
    durablePlans.push(await buildPlan(descriptor.id, {
      grain: {
        kind: "texture",
        assetId: source.asset.assetId,
        contentHash: source.asset.decodedSha256,
        space: descriptor.canonicalSpace,
        scale: 13,
        depth: 0.72,
        contrast: 0.61,
        seed: 37,
      },
      grainChannel: descriptor.channel,
      durableR8GrainSource: source,
    }));
  }
  const omittedSourcePeer = await buildPlan(durableCases[0]!.id, {
    grain: {
      kind: "texture",
      assetId: durablePlans[0]!.durableR8GrainSource!.asset.assetId,
      contentHash: durablePlans[0]!.durableR8GrainSource!.asset.decodedSha256,
      space: "document",
      scale: 13,
      depth: 0.72,
      contrast: 0.61,
      seed: 37,
    },
    grainChannel: "alpha",
  });
  const durableR8Identity: DurableR8IdentityEvidence = {
    omittedSourceFingerprint: omittedSourcePeer.semanticFingerprint ?? "",
    boundSourceFingerprint: durablePlans[0]!.semanticFingerprint ?? "",
    fingerprintsDiffer:
      omittedSourcePeer.semanticFingerprint !== durablePlans[0]!.semanticFingerprint,
  };
  const eraseBase = await buildPlan("erase-base", {
    color: [0.1, 0.35, 0.9, 0.8],
  });
  const erase = await buildPlan("destination-out", {
    mode: "append",
    porterDuff: "destination-out",
    color: [1, 1, 1, 0.5],
  });

  const caseRuns = [
    await runCase(rawDevice, shaderModules, "zero-border-source-over", [noGrain]),
    await runCase(rawDevice, shaderModules, "procedural-document", [proceduralDocument]),
    await runCase(rawDevice, shaderModules, "procedural-stroke", [proceduralStroke]),
    await runCase(rawDevice, shaderModules, "asset-document", [assetDocument]),
    await runCase(rawDevice, shaderModules, "asset-stroke", [assetStroke]),
    await runCase(
      rawDevice,
      shaderModules,
      durableCases[0]!.id,
      [durablePlans[0]!],
    ),
    await runCase(
      rawDevice,
      shaderModules,
      durableCases[1]!.id,
      [durablePlans[1]!],
    ),
    await runCase(
      rawDevice,
      shaderModules,
      durableCases[2]!.id,
      [durablePlans[2]!],
    ),
    await runCase(
      rawDevice,
      shaderModules,
      durableCases[3]!.id,
      [durablePlans[3]!],
    ),
    await runCase(rawDevice, shaderModules, "destination-out", [eraseBase, erase]),
  ];
  const anchors = {
    proceduralDocumentVsStrokeHalfWordMismatches: countHalfWordMismatches(
      caseRuns[1]!.gpuWords,
      caseRuns[2]!.gpuWords,
    ),
    assetDocumentVsStrokeHalfWordMismatches: countHalfWordMismatches(
      caseRuns[3]!.gpuWords,
      caseRuns[4]!.gpuWords,
    ),
    durableAlphaCanvasVsStrokeHalfWordMismatches: countHalfWordMismatches(
      caseRuns[5]!.gpuWords,
      caseRuns[6]!.gpuWords,
    ),
    durableLuminanceCanvasVsStrokeHalfWordMismatches: countHalfWordMismatches(
      caseRuns[7]!.gpuWords,
      caseRuns[8]!.gpuWords,
    ),
  };
  resetStudioBrushR8GrainRegistry();
  const uninitializedAppend = await uninitializedAppendEvidence(
    rawDevice,
    shaderModules,
    noGrain,
  );
  const appendRebuild = await appendRebuildEvidence(
    rawDevice,
    shaderModules,
    proceduralDocument,
  );
  const cacheBudgetEpochs = await cacheBudgetEpochEvidence(
    rawDevice,
    shaderModules,
    noGrain,
  );
  const flowControl = await flowControlEvidence(
    rawDevice,
    shaderModules,
    noGrain,
  );

  let callbackInfo: GPUDeviceLostInfo | null = null;
  const lossObserved = observeDevice(rawDevice, shaderModules);
  const lossTarget = createRuntime(lossObserved, {
    onDeviceLost(info) {
      callbackInfo = info;
    },
  });
  const completedBeforeLoss = await executeCompleted(lossTarget.runtime, noGrain, 1);

  const seedPacked = packStudioEngineWebGpuTexturedBrushDabs(proceduralDocument);
  const packedSeed = (
    ((seedPacked[23]! << 16) | seedPacked[22]!) >>> 0
  );
  if (packedSeed !== 0xffff_ffff) {
    throw new Error(`u32 maximum seed did not round-trip: ${packedSeed}`);
  }

  const shaderCompilation = await compilationEvidence(shaderModules);
  const validationError = await rawDevice.popErrorScope();
  const outOfMemoryError = await rawDevice.popErrorScope();

  rawDevice.destroy();
  const deviceInfo = await withTimeout(
    rawDevice.lost,
    DEVICE_LOSS_TIMEOUT_MS,
    "real GPUDevice loss",
  );
  await Promise.resolve();
  await Promise.resolve();
  const rejectedAfterLoss = await lossTarget.runtime.execute({
    requestSequence: 2,
    deviceEpoch: 1,
    plan: noGrain,
  });
  const observedCallback = callbackInfo as GPUDeviceLostInfo | null;
  const deviceLoss: DeviceLossEvidence = {
    trigger: "GPUDevice.destroy",
    deviceReason: deviceInfo.reason,
    deviceMessage: deviceInfo.message,
    callbackReason: observedCallback?.reason ?? "",
    callbackMessage: observedCallback?.message ?? "",
    completedReceiptEpoch: completedBeforeLoss.deviceEpoch,
    runtimeDeviceEpoch: lossTarget.runtime.deviceEpoch,
    rejectedStatus: rejectedAfterLoss.status,
    rejectedDeviceEpoch:
      rejectedAfterLoss.status === "device-lost"
        ? rejectedAfterLoss.deviceEpoch
        : null,
  };
  lossTarget.runtime.dispose();

  return {
    status: "ok",
    backend: "webgpu-textured-brush-rgba16float",
    width: WIDTH,
    height: HEIGHT,
    capabilities: browserCapabilities,
    provider: {
      kind: "real-chromium-webgpu-device-boundary",
      adapterInfo: serializableAdapterInfo(adapter),
      textureFormat: "rgba16float",
      readback: "aligned-rgba16float-map-read",
      bytesPerRow: nextAligned(WIDTH * RGBA16_BYTES_PER_PIXEL, ROW_ALIGNMENT),
      maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
    },
    tolerance: { cpuAbsolute: CPU_ABSOLUTE_TOLERANCE },
    cases: caseRuns.map((caseRun) => caseRun.evidence),
    anchors,
    durableR8Identity,
    uninitializedAppend,
    appendRebuild,
    cacheBudgetEpochs,
    flowControl,
    shaderCompilation,
    errorScopes: {
      validation: validationError?.message ?? null,
      outOfMemory: outOfMemoryError?.message ?? null,
    },
    uncapturedGpuErrors,
    deviceLoss,
  };
}

void run()
  .then((result) => {
    window.__studioEngineWebGpuTexturedBrushResult = result;
  })
  .catch((error: unknown) => {
    window.__studioEngineWebGpuTexturedBrushResult = {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack ?? null : null,
      capabilities: capabilities(),
    };
  });
