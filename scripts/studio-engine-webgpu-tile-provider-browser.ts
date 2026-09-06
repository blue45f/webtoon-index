/**
 * Real Chromium WebGPU boundary harness for StudioEngineWebGpuTileProviderV1.
 *
 * Three full 512×512 RGBA16F authority tiles are uploaded/cleared, replayed through the canonical
 * analytic brush path, copied into a 256-byte-aligned MAP_READ buffer, and compared with an
 * independent CPU half-float oracle. No application shell or fake GPU object is involved.
 */

import {
  STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
  STUDIO_ENGINE_TILE_ENCODING,
  studioEngineRgba16FloatTileDigest,
  studioEngineTileProviderBatchDigest,
  type StudioEngineTileProviderBaseTile,
  type StudioEngineTileProviderDelta,
  type StudioEngineTileProviderInput,
} from "../apps/web/src/domains/creator/render/studio-engine-tile-authority";
import {
  STUDIO_ENGINE_WEBGPU_TILE_BYTE_LENGTH,
  STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_VERSION,
  STUDIO_ENGINE_WEBGPU_TILE_ROW_BYTES,
  STUDIO_ENGINE_WEBGPU_TILE_SIZE,
  createStudioEngineWebGpuTileProviderV1,
  type StudioEngineWebGpuTileProviderRequest,
  type StudioEngineWebGpuTileProviderResult,
  type StudioEngineWebGpuTileProviderV1,
} from "../apps/web/src/domains/creator/render/studio-engine-webgpu-tile-provider-v1";
import {
  lowerStudioCanonicalBrushPlanToWebGpuDabs,
  type StudioCanonicalWebGpuAnalyticDab,
} from "../apps/web/src/domains/creator/studio-canonical-brush-webgpu-lowering";

import type { StudioCanonicalBrushPlan } from "../apps/web/src/domains/creator/studio-canonical-brush-plan";

const REQUEST_EPOCH = 41;
const INITIAL_DEVICE_EPOCH = 1;
const DEVICE_LOSS_TIMEOUT_MS = 5_000;
const HALF_FLOAT_ABSOLUTE_TOLERANCE = 0.04;
const HALF_FLOAT_OUTSIDE_EDGE_TOLERANCE = 0.003;
const EDGE_BAND_PIXELS = 2.5;
const WEBGPU_BYTES_PER_ROW_ALIGNMENT = 256;
const TILE_WORD_LENGTH =
  STUDIO_ENGINE_WEBGPU_TILE_BYTE_LENGTH / Uint16Array.BYTES_PER_ELEMENT;

const TARGET_COORDINATES = [
  [0, 0],
  [1, 0],
  [0, 1],
] as const;
const EDGE_SAMPLE_POINTS = [
  [511, 500],
  [512, 500],
  [500, 511],
  [500, 512],
  [0, 0],
  [1_023, 0],
] as const;

interface BrowserCapabilities {
  readonly webgpu: boolean;
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

interface TileParityMetrics {
  readonly tileId: string;
  readonly comparedComponents: number;
  readonly violatingComponents: number;
  readonly outsideEdgeViolatingComponents: number;
  readonly exactHalfWordMismatches: number;
  readonly unaffectedExactHalfWordMismatches: number;
  readonly touchedPixels: number;
  readonly edgeBandPixels: number;
  readonly maxAbsoluteDelta: number;
  readonly maxOutsideEdgeAbsoluteDelta: number;
  readonly meanAbsoluteDelta: number;
}

interface EdgeSampleEvidence {
  readonly label: string;
  readonly globalX: number;
  readonly globalY: number;
  readonly tileId: string;
  readonly cpu: readonly [number, number, number, number];
  readonly gpu: readonly [number, number, number, number];
  readonly maxAbsoluteDelta: number;
}

interface ReceiptEvidence {
  readonly mode: "append" | "rebuild";
  readonly requestEpoch: number;
  readonly deviceEpoch: number;
  readonly requestSequence: number;
  readonly commandIdentity: string;
  readonly tileCount: number;
  readonly dabCount: number;
  readonly dispatchCount: number;
  readonly uploadedBaseBytes: number;
  readonly stagingBytes: number;
  readonly textureFormat: string;
  readonly encoding: string;
  readonly complete: boolean;
}

interface MainExecutionEvidence {
  readonly appendReceipt: ReceiptEvidence;
  readonly rebuildReceipt: ReceiptEvidence;
  readonly deltaOrder: readonly string[];
  readonly appendContentDigests: readonly string[];
  readonly rebuildContentDigests: readonly string[];
  readonly appendBatchDigest: string;
  readonly rebuildBatchDigest: string;
  readonly recalculatedAppendBatchDigest: string;
  readonly stableBatchDigest: boolean;
  readonly appendRebuildExactHalfWordMismatches: number;
  readonly rowBytes: number;
  readonly rowBytesAlignment: number;
  readonly rowPaddingBytes: number;
  readonly tileStride: number;
  readonly stagingOffsets: readonly number[];
  readonly deltaByteLengths: readonly number[];
  readonly parity: readonly TileParityMetrics[];
  readonly edgeSamples: readonly EdgeSampleEvidence[];
  readonly cpuPng: string;
  readonly appendGpuPng: string;
  readonly appendCpuDiffPng: string;
  readonly rebuildGpuPng: string;
  readonly appendRebuildDiffPng: string;
}

interface EpochEvidence {
  readonly staleRequestEpochReason: string | null;
  readonly staleDeviceEpochReason: string | null;
  readonly statsUnchangedBeforeValidExecution: boolean;
}

interface FlowControlEvidence {
  readonly preAbortedReason: string | null;
  readonly preAbortedSubmittedTileDelta: number;
  readonly inFlightCancelledReason: string | null;
  readonly inFlightActiveRequestsBeforeAbort: number;
  readonly inFlightActiveRequestsAfterAbort: number;
  readonly backpressureReason: string | null;
  readonly firstConcurrentStatus: string;
  readonly maxInFlightRequests: number;
}

interface DeviceLossEvidence {
  readonly trigger: "GPUDevice.destroy";
  readonly deviceReason: string;
  readonly deviceMessage: string;
  readonly callbackReason: string;
  readonly callbackMessage: string;
  readonly pendingStatus: string;
  readonly pendingReason: string | null;
  readonly providerStatus: string;
  readonly providerDeviceEpoch: number;
  readonly rejectedAfterLossReason: string | null;
}

type BrowserTileProviderResult =
  | {
      readonly status: "ok";
      readonly backend: "webgpu-rgba16float-tile-provider-v1";
      readonly capabilities: BrowserCapabilities;
      readonly provider: {
        readonly kind: "real-chromium-webgpu-device-boundary";
        readonly adapterInfo: SerializableAdapterInfo;
        readonly textureFormat: "rgba16float";
        readonly tileSize: 512;
        readonly readback: "full-tile-256-byte-aligned-map-read";
        readonly maxTextureDimension2D: number;
        readonly maxBufferSize: number;
      };
      readonly tolerance: {
        readonly absolute: number;
        readonly outsideEdgeAbsolute: number;
        readonly edgeBandPixels: number;
      };
      readonly main: MainExecutionEvidence;
      readonly epochs: EpochEvidence;
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
        | "webgpu-unavailable"
        | "adapter-unavailable"
        | "device-request-failed";
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
    __studioEngineWebGpuTileProviderResult?: BrowserTileProviderResult;
  }
}

interface CpuTileOracle {
  readonly tileId: string;
  readonly words: Uint16Array;
  readonly touched: Uint8Array;
  readonly edgeBand: Uint8Array;
}

interface ObservedGpuDevice {
  readonly device: GPUDevice;
  readonly shaderModules: GPUShaderModule[];
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

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(lower: number, upper: number, value: number): number {
  if (value <= lower) return 0;
  if (value >= upper) return 1;
  const unit = (value - lower) / (upper - lower);
  return unit * unit * (3 - 2 * unit);
}

function linearToSrgb(value: number): number {
  const safe = clamp01(value);
  return safe <= 0.0031308
    ? safe * 12.92
    : 1.055 * Math.pow(safe, 1 / 2.4) - 0.055;
}

function byte(value: number): number {
  return Math.round(clamp01(value) * 255);
}

function capabilities(): BrowserCapabilities {
  return {
    webgpu: typeof navigator !== "undefined" && navigator.gpu !== undefined,
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

function observeDevice(rawDevice: GPUDevice): ObservedGpuDevice {
  const shaderModules: GPUShaderModule[] = [];
  const device = new Proxy(rawDevice, {
    get(target, property) {
      if (property === "createShaderModule") {
        return (descriptor: GPUShaderModuleDescriptor): GPUShaderModule => {
          const module = target.createShaderModule(descriptor);
          shaderModules.push(module);
          return module;
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  }) as unknown as GPUDevice;
  return { device, shaderModules };
}

function plan(commandSequence: number): StudioCanonicalBrushPlan {
  return {
    kind: "studio-canonical-brush-plan",
    version: 1,
    sessionEpoch: REQUEST_EPOCH,
    strokeEpoch: 1,
    commandSequence,
    strokeId: `tile-boundary-${commandSequence}`,
    seed: 0x4a17,
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
      components: [0.82, 0.18, 0.05, 0.78],
    },
    composite: {
      porterDuff: "source-over",
      blendMode: "normal",
      opacity: 0.95,
    },
    recipe: {
      version: 1,
      brushId: "tile-boundary-analytic",
      engine: "dab-v1",
      material: "ink",
      tip: {
        kind: "analytic",
        shape: "round",
        edgeSoftness: 0.18,
      },
      size: 28,
      flow: 0.9,
      hardness: 0.72,
      spacingRatio: 1,
      scatter: {
        radiusRatio: 0,
        distribution: "uniform-disk",
      },
      angleRadians: 0,
      roundness: 1,
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
      samples: [
        {
          sequence: 1,
          x: 496,
          y: 496,
          pressure: 1,
          tangentialPressure: 0,
          tiltX: 0,
          tiltY: 0,
          twist: 0,
          timeMilliseconds: 1,
          pointerId: 1,
          flags: 0,
        },
        {
          sequence: 2,
          x: 528,
          y: 496,
          pressure: 1,
          tangentialPressure: 0,
          tiltX: 0,
          tiltY: 0,
          twist: 0,
          timeMilliseconds: 2,
          pointerId: 1,
          flags: 0,
        },
        {
          sequence: 3,
          x: 496,
          y: 528,
          pressure: 1,
          tangentialPressure: 0,
          tiltX: 0,
          tiltY: 0,
          twist: 0,
          timeMilliseconds: 3,
          pointerId: 1,
          flags: 0,
        },
      ],
    },
  };
}

function makeBase(kind: "warm" | "cool"): ArrayBuffer {
  const words = new Uint16Array(TILE_WORD_LENGTH);
  for (let y = 0; y < STUDIO_ENGINE_WEBGPU_TILE_SIZE; y += 1) {
    for (let x = 0; x < STUDIO_ENGINE_WEBGPU_TILE_SIZE; x += 1) {
      const unitX = x / (STUDIO_ENGINE_WEBGPU_TILE_SIZE - 1);
      const unitY = y / (STUDIO_ENGINE_WEBGPU_TILE_SIZE - 1);
      const alpha = kind === "warm"
        ? 0.14 + unitX * 0.08
        : 0.1 + unitY * 0.1;
      const straight = kind === "warm"
        ? [0.16 + unitY * 0.12, 0.08, 0.03]
        : [0.02, 0.12 + unitX * 0.1, 0.26];
      const offset = (y * STUDIO_ENGINE_WEBGPU_TILE_SIZE + x) * 4;
      words[offset] = float32ToFloat16(straight[0]! * alpha);
      words[offset + 1] = float32ToFloat16(straight[1]! * alpha);
      words[offset + 2] = float32ToFloat16(straight[2]! * alpha);
      words[offset + 3] = float32ToFloat16(alpha);
    }
  }
  return words.buffer;
}

function target(
  column: number,
  row: number,
  encoded: ArrayBuffer | null,
): StudioEngineTileProviderBaseTile {
  const logicalTileIndex = BigInt(row * 64 + column);
  const logicalByteOffset =
    logicalTileIndex * BigInt(STUDIO_ENGINE_WEBGPU_TILE_BYTE_LENGTH);
  return {
    address: {
      tileId: `${column}:${row}`,
      column,
      row,
      layerId: "line",
      layerIndex: 0,
      logicalTileIndex,
      logicalByteOffset,
      shardIndex: BigInt(0),
      shardByteOffset: logicalByteOffset,
    },
    tileRevision: encoded ? 1 : 0,
    contentDigest: encoded ? studioEngineRgba16FloatTileDigest(encoded) : null,
    encoded,
  };
}

function targets(): readonly StudioEngineTileProviderBaseTile[] {
  return [
    target(0, 0, makeBase("warm")),
    target(1, 0, makeBase("cool")),
    target(0, 1, null),
  ];
}

function input(
  commandSequence: number,
  baseTiles: readonly StudioEngineTileProviderBaseTile[],
): StudioEngineTileProviderInput {
  return {
    kind: "studio-engine-tile-provider-input",
    version: STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
    encoding: STUDIO_ENGINE_TILE_ENCODING,
    commandIdentity: `tile-command:${commandSequence}`,
    baseDocumentRevision: 0,
    baseLayerRevision: 0,
    layerId: "line",
    tileSize: STUDIO_ENGINE_WEBGPU_TILE_SIZE,
    brushPlan: plan(commandSequence),
    targets: baseTiles,
  };
}

function request(
  providerInput: StudioEngineTileProviderInput,
  mode: "append" | "rebuild",
  overrides: Partial<
    Pick<
      StudioEngineWebGpuTileProviderRequest,
      "requestEpoch" | "deviceEpoch" | "requestSequence"
    >
  > = {},
): StudioEngineWebGpuTileProviderRequest {
  return {
    kind: "studio-engine-webgpu-tile-provider-request",
    version: STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_VERSION,
    mode,
    requestEpoch: overrides.requestEpoch ?? REQUEST_EPOCH,
    deviceEpoch: overrides.deviceEpoch ?? INITIAL_DEVICE_EPOCH,
    requestSequence:
      overrides.requestSequence ?? providerInput.brushPlan.commandSequence,
    input: providerInput,
  };
}

function readyProvider(
  device: GPUDevice,
  onDeviceLost?: (info: GPUDeviceLostInfo) => void,
): StudioEngineWebGpuTileProviderV1 {
  const created = createStudioEngineWebGpuTileProviderV1({
    boundary: { device },
    requestEpoch: REQUEST_EPOCH,
    initialDeviceEpoch: INITIAL_DEVICE_EPOCH,
    limits: { maxInFlightRequests: 1 },
    onDeviceLost,
  });
  if (created.status !== "ready") {
    throw new Error(`real tile provider initialization failed: ${created.reason}`);
  }
  return created.provider;
}

interface MetricEvaluation {
  readonly metric: number;
  readonly fwidth: number;
  readonly antialias: number;
  readonly innerEdge: number;
  readonly coverage: number;
}

function evaluateMetric(
  dab: StudioCanonicalWebGpuAnalyticDab,
  pixelX: number,
  pixelY: number,
): MetricEvaluation {
  const [xx, xy, yx, yy] = dab.tip.localToDocument;
  const determinant = xx * yy - xy * yx;
  const deltaX = pixelX + 0.5 - dab.x;
  const deltaY = pixelY + 0.5 - dab.y;
  const localX = (yy * deltaX - yx * deltaY) / determinant;
  const localY = (-xy * deltaX + xx * deltaY) / determinant;

  let metric: number;
  let gradientLocalX: number;
  let gradientLocalY: number;
  if (dab.tip.shape === "square") {
    const absoluteX = Math.abs(localX);
    const absoluteY = Math.abs(localY);
    metric = Math.max(absoluteX, absoluteY);
    if (absoluteX >= absoluteY) {
      gradientLocalX = Math.sign(localX);
      gradientLocalY = 0;
    } else {
      gradientLocalX = 0;
      gradientLocalY = Math.sign(localY);
    }
  } else {
    metric = Math.hypot(localX, localY);
    if (metric > 0) {
      gradientLocalX = localX / metric;
      gradientLocalY = localY / metric;
    } else {
      gradientLocalX = 0;
      gradientLocalY = 0;
    }
  }
  const gradientDocumentX =
    gradientLocalX * (yy / determinant)
    + gradientLocalY * (-xy / determinant);
  const gradientDocumentY =
    gradientLocalX * (-yx / determinant)
    + gradientLocalY * (xx / determinant);
  const fwidth = Math.abs(gradientDocumentX) + Math.abs(gradientDocumentY);
  const antialias = Math.max(fwidth * 0.5, 0.00025);
  const feather = clamp01(
    (1 - dab.tip.hardness) + dab.tip.edgeSoftness * dab.tip.hardness,
  );
  const innerEdge = 1 - feather;
  return {
    metric,
    fwidth,
    antialias,
    innerEdge,
    coverage: 1 - smoothstep(
      innerEdge - antialias,
      1 + antialias,
      metric,
    ),
  };
}

function dabBounds(
  dab: StudioCanonicalWebGpuAnalyticDab,
): readonly [number, number, number, number] {
  const [xx, xy, yx, yy] = dab.tip.localToDocument;
  const margin = 5;
  return [
    Math.floor(dab.x - Math.abs(xx) - Math.abs(yx) - margin),
    Math.floor(dab.y - Math.abs(xy) - Math.abs(yy) - margin),
    Math.ceil(dab.x + Math.abs(xx) + Math.abs(yx) + margin),
    Math.ceil(dab.y + Math.abs(xy) + Math.abs(yy) + margin),
  ];
}

function rasterCpuTile(
  baseTile: StudioEngineTileProviderBaseTile,
  dabs: readonly StudioCanonicalWebGpuAnalyticDab[],
): CpuTileOracle {
  const baseWords = baseTile.encoded
    ? new Uint16Array(baseTile.encoded)
    : new Uint16Array(TILE_WORD_LENGTH);
  const words = new Uint16Array(baseWords);
  const values = new Float32Array(TILE_WORD_LENGTH);
  for (let index = 0; index < words.length; index += 1) {
    values[index] = float16ToFloat32(words[index]!);
  }
  const touched = new Uint8Array(
    STUDIO_ENGINE_WEBGPU_TILE_SIZE * STUDIO_ENGINE_WEBGPU_TILE_SIZE,
  );
  const edgeBand = new Uint8Array(touched.length);
  const originX = baseTile.address.column * STUDIO_ENGINE_WEBGPU_TILE_SIZE;
  const originY = baseTile.address.row * STUDIO_ENGINE_WEBGPU_TILE_SIZE;

  for (const dab of dabs) {
    const [globalMinX, globalMinY, globalMaxX, globalMaxY] = dabBounds(dab);
    const minimumX = Math.max(0, globalMinX - originX);
    const minimumY = Math.max(0, globalMinY - originY);
    const maximumX = Math.min(
      STUDIO_ENGINE_WEBGPU_TILE_SIZE - 1,
      globalMaxX - originX,
    );
    const maximumY = Math.min(
      STUDIO_ENGINE_WEBGPU_TILE_SIZE - 1,
      globalMaxY - originY,
    );
    if (minimumX > maximumX || minimumY > maximumY) continue;
    for (let y = minimumY; y <= maximumY; y += 1) {
      for (let x = minimumX; x <= maximumX; x += 1) {
        const globalX = originX + x;
        const globalY = originY + y;
        const evaluation = evaluateMetric(dab, globalX, globalY);
        const pixelIndex = y * STUDIO_ENGINE_WEBGPU_TILE_SIZE + x;
        const implementationMargin =
          EDGE_BAND_PIXELS * Math.max(evaluation.fwidth, 0.0005);
        if (
          evaluation.metric
            >= evaluation.innerEdge - evaluation.antialias - implementationMargin
          && evaluation.metric
            <= 1 + evaluation.antialias + implementationMargin
        ) {
          edgeBand[pixelIndex] = 1;
        }
        const coverage = clamp01(evaluation.coverage);
        if (coverage <= 0) continue;
        touched[pixelIndex] = 1;
        const offset = pixelIndex * 4;
        const [red, green, blue, baseAlpha] = dab.color.components;
        const sourceAlpha = clamp01(baseAlpha * coverage);
        const destinationFactor = 1 - sourceAlpha;
        const next = dab.composite.porterDuff === "destination-out"
          ? [
              values[offset]! * destinationFactor,
              values[offset + 1]! * destinationFactor,
              values[offset + 2]! * destinationFactor,
              values[offset + 3]! * destinationFactor,
            ]
          : [
              red * sourceAlpha + values[offset]! * destinationFactor,
              green * sourceAlpha + values[offset + 1]! * destinationFactor,
              blue * sourceAlpha + values[offset + 2]! * destinationFactor,
              sourceAlpha + values[offset + 3]! * destinationFactor,
            ];
        for (let channel = 0; channel < 4; channel += 1) {
          const word = float32ToFloat16(next[channel]!);
          words[offset + channel] = word;
          values[offset + channel] = float16ToFloat32(word);
        }
      }
    }
  }
  return {
    tileId: baseTile.address.tileId,
    words,
    touched,
    edgeBand,
  };
}

function deltaWords(delta: StudioEngineTileProviderDelta): Uint16Array {
  if (delta.encoded instanceof Uint16Array) {
    return new Uint16Array(
      delta.encoded.buffer.slice(
        delta.encoded.byteOffset,
        delta.encoded.byteOffset + delta.encoded.byteLength,
      ),
    );
  }
  return new Uint16Array(delta.encoded.slice(0));
}

function parityMetrics(
  cpu: CpuTileOracle,
  gpuWords: Uint16Array,
): TileParityMetrics {
  let violatingComponents = 0;
  let outsideEdgeViolatingComponents = 0;
  let exactHalfWordMismatches = 0;
  let unaffectedExactHalfWordMismatches = 0;
  let touchedPixels = 0;
  let edgeBandPixels = 0;
  let maxAbsoluteDelta = 0;
  let maxOutsideEdgeAbsoluteDelta = 0;
  let totalAbsoluteDelta = 0;
  for (let pixel = 0; pixel < cpu.touched.length; pixel += 1) {
    if (cpu.touched[pixel] === 1) touchedPixels += 1;
    if (cpu.edgeBand[pixel] === 1) edgeBandPixels += 1;
    for (let channel = 0; channel < 4; channel += 1) {
      const index = pixel * 4 + channel;
      const cpuWord = cpu.words[index]!;
      const gpuWord = gpuWords[index]!;
      if (cpuWord !== gpuWord) {
        exactHalfWordMismatches += 1;
        if (cpu.touched[pixel] === 0) unaffectedExactHalfWordMismatches += 1;
      }
      const delta = Math.abs(
        float16ToFloat32(cpuWord) - float16ToFloat32(gpuWord),
      );
      totalAbsoluteDelta += delta;
      maxAbsoluteDelta = Math.max(maxAbsoluteDelta, delta);
      if (delta > HALF_FLOAT_ABSOLUTE_TOLERANCE) violatingComponents += 1;
      if (cpu.edgeBand[pixel] === 0) {
        maxOutsideEdgeAbsoluteDelta = Math.max(maxOutsideEdgeAbsoluteDelta, delta);
        if (delta > HALF_FLOAT_OUTSIDE_EDGE_TOLERANCE) {
          outsideEdgeViolatingComponents += 1;
        }
      }
    }
  }
  return {
    tileId: cpu.tileId,
    comparedComponents: cpu.words.length,
    violatingComponents,
    outsideEdgeViolatingComponents,
    exactHalfWordMismatches,
    unaffectedExactHalfWordMismatches,
    touchedPixels,
    edgeBandPixels,
    maxAbsoluteDelta,
    maxOutsideEdgeAbsoluteDelta,
    meanAbsoluteDelta: totalAbsoluteDelta / cpu.words.length,
  };
}

function rgbaAt(
  words: Uint16Array,
  x: number,
  y: number,
): readonly [number, number, number, number] {
  const offset = (y * STUDIO_ENGINE_WEBGPU_TILE_SIZE + x) * 4;
  return [
    float16ToFloat32(words[offset]!),
    float16ToFloat32(words[offset + 1]!),
    float16ToFloat32(words[offset + 2]!),
    float16ToFloat32(words[offset + 3]!),
  ];
}

function edgeSamples(
  cpuTiles: readonly CpuTileOracle[],
  gpuTiles: readonly Uint16Array[],
): readonly EdgeSampleEvidence[] {
  return EDGE_SAMPLE_POINTS.map(([globalX, globalY], index) => {
    const column = Math.floor(globalX / STUDIO_ENGINE_WEBGPU_TILE_SIZE);
    const row = Math.floor(globalY / STUDIO_ENGINE_WEBGPU_TILE_SIZE);
    const tileId = `${column}:${row}`;
    const tileIndex = TARGET_COORDINATES.findIndex(
      ([targetColumn, targetRow]) =>
        targetColumn === column && targetRow === row,
    );
    if (tileIndex < 0) throw new Error(`edge sample ${tileId} has no target tile`);
    const localX = globalX % STUDIO_ENGINE_WEBGPU_TILE_SIZE;
    const localY = globalY % STUDIO_ENGINE_WEBGPU_TILE_SIZE;
    const cpu = rgbaAt(cpuTiles[tileIndex]!.words, localX, localY);
    const gpu = rgbaAt(gpuTiles[tileIndex]!, localX, localY);
    return {
      label: `edge-${index + 1}`,
      globalX,
      globalY,
      tileId,
      cpu,
      gpu,
      maxAbsoluteDelta: Math.max(
        ...cpu.map((value, channel) => Math.abs(value - gpu[channel]!)),
      ),
    };
  });
}

function linearPremultipliedWordsToRgba8(words: Uint16Array): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(words.length);
  for (let offset = 0; offset < words.length; offset += 4) {
    const alpha = clamp01(float16ToFloat32(words[offset + 3]!));
    if (alpha > 0) {
      pixels[offset] = byte(linearToSrgb(float16ToFloat32(words[offset]!) / alpha));
      pixels[offset + 1] = byte(
        linearToSrgb(float16ToFloat32(words[offset + 1]!) / alpha),
      );
      pixels[offset + 2] = byte(
        linearToSrgb(float16ToFloat32(words[offset + 2]!) / alpha),
      );
    }
    pixels[offset + 3] = byte(alpha);
  }
  return pixels;
}

function montagePngDataUrl(tiles: readonly Uint16Array[]): string {
  const size = STUDIO_ENGINE_WEBGPU_TILE_SIZE * 2;
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let tileIndex = 0; tileIndex < tiles.length; tileIndex += 1) {
    const [column, row] = TARGET_COORDINATES[tileIndex]!;
    const tilePixels = linearPremultipliedWordsToRgba8(tiles[tileIndex]!);
    for (let y = 0; y < STUDIO_ENGINE_WEBGPU_TILE_SIZE; y += 1) {
      const sourceStart = y * STUDIO_ENGINE_WEBGPU_TILE_SIZE * 4;
      const destinationStart =
        ((row * STUDIO_ENGINE_WEBGPU_TILE_SIZE + y) * size
          + column * STUDIO_ENGINE_WEBGPU_TILE_SIZE) * 4;
      pixels.set(
        tilePixels.subarray(
          sourceStart,
          sourceStart + STUDIO_ENGINE_WEBGPU_TILE_SIZE * 4,
        ),
        destinationStart,
      );
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas2D is unavailable for tile evidence encoding.");
  context.putImageData(new ImageData(pixels, size, size), 0, 0);
  return canvas.toDataURL("image/png");
}

function diffMontagePngDataUrl(
  first: readonly Uint16Array[],
  second: readonly Uint16Array[],
): string {
  const size = STUDIO_ENGINE_WEBGPU_TILE_SIZE * 2;
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let tileIndex = 0; tileIndex < first.length; tileIndex += 1) {
    const [column, row] = TARGET_COORDINATES[tileIndex]!;
    for (let y = 0; y < STUDIO_ENGINE_WEBGPU_TILE_SIZE; y += 1) {
      for (let x = 0; x < STUDIO_ENGINE_WEBGPU_TILE_SIZE; x += 1) {
        const sourceOffset = (y * STUDIO_ENGINE_WEBGPU_TILE_SIZE + x) * 4;
        let maximum = 0;
        for (let channel = 0; channel < 4; channel += 1) {
          maximum = Math.max(
            maximum,
            Math.abs(
              float16ToFloat32(first[tileIndex]![sourceOffset + channel]!)
              - float16ToFloat32(second[tileIndex]![sourceOffset + channel]!),
            ),
          );
        }
        const destinationOffset =
          ((row * STUDIO_ENGINE_WEBGPU_TILE_SIZE + y) * size
            + column * STUDIO_ENGINE_WEBGPU_TILE_SIZE + x) * 4;
        const intensity = Math.min(255, Math.round(maximum * 4_096));
        pixels[destinationOffset] = intensity;
        pixels[destinationOffset + 1] = Math.min(255, intensity * 0.35);
        pixels[destinationOffset + 2] = Math.min(255, intensity * 0.15);
        pixels[destinationOffset + 3] = intensity === 0 ? 0 : 255;
      }
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas2D is unavailable for diff evidence encoding.");
  context.putImageData(new ImageData(pixels, size, size), 0, 0);
  return canvas.toDataURL("image/png");
}

function completed(
  result: StudioEngineWebGpuTileProviderResult,
  label: string,
): Extract<StudioEngineWebGpuTileProviderResult, { status: "completed" }> {
  if (result.status !== "completed") {
    throw new Error(`${label} rejected real WebGPU work: ${result.reason}`);
  }
  return result;
}

function rejectedReason(result: StudioEngineWebGpuTileProviderResult): string | null {
  return result.status === "rejected" ? result.reason : null;
}

function receiptEvidence(
  result: Extract<StudioEngineWebGpuTileProviderResult, { status: "completed" }>,
): ReceiptEvidence {
  const receipt = result.receipt;
  return {
    mode: receipt.mode,
    requestEpoch: receipt.requestEpoch,
    deviceEpoch: receipt.deviceEpoch,
    requestSequence: receipt.requestSequence,
    commandIdentity: receipt.commandIdentity,
    tileCount: receipt.tileCount,
    dabCount: receipt.dabCount,
    dispatchCount: receipt.dispatchCount,
    uploadedBaseBytes: receipt.uploadedBaseBytes,
    stagingBytes: receipt.stagingBytes,
    textureFormat: receipt.textureFormat,
    encoding: receipt.encoding,
    complete: receipt.complete,
  };
}

function exactHalfWordMismatches(
  first: readonly Uint16Array[],
  second: readonly Uint16Array[],
): number {
  let mismatches = 0;
  for (let tileIndex = 0; tileIndex < first.length; tileIndex += 1) {
    for (let index = 0; index < first[tileIndex]!.length; index += 1) {
      if (first[tileIndex]![index] !== second[tileIndex]![index]) mismatches += 1;
    }
  }
  return mismatches;
}

async function shaderCompilationEvidence(
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
      messages: info.messages.map((message) => ({
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

function gpuErrorMessage(error: GPUError | null): string | null {
  return error?.message ?? null;
}

function timeout<Value>(
  promise: Promise<Value>,
  milliseconds: number,
  label: string,
): Promise<Value> {
  return new Promise((resolve, reject) => {
    const handle = window.setTimeout(
      () => reject(new Error(`${label} timed out after ${milliseconds}ms`)),
      milliseconds,
    );
    promise.then(
      (value) => {
        window.clearTimeout(handle);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(handle);
        reject(error);
      },
    );
  });
}

async function run(): Promise<BrowserTileProviderResult> {
  const observedCapabilities = capabilities();
  if (!navigator.gpu) {
    return {
      status: "unsupported",
      reason: "webgpu-unavailable",
      message: "navigator.gpu is unavailable.",
      capabilities: observedCapabilities,
    };
  }
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) {
    return {
      status: "unsupported",
      reason: "adapter-unavailable",
      message: "Chromium returned no WebGPU adapter.",
      capabilities: observedCapabilities,
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
      capabilities: observedCapabilities,
    };
  }

  const uncapturedGpuErrors: string[] = [];
  rawDevice.addEventListener("uncapturederror", (event) => {
    uncapturedGpuErrors.push(event.error.message);
  });
  rawDevice.pushErrorScope("validation");
  rawDevice.pushErrorScope("out-of-memory");
  const observed = observeDevice(rawDevice);
  const baseTiles = targets();
  const mainInput = input(1, baseTiles);
  const secondInput = input(2, baseTiles);
  const thirdInput = input(3, baseTiles);

  let appendProvider: StudioEngineWebGpuTileProviderV1 | null = null;
  let rebuildProvider: StudioEngineWebGpuTileProviderV1 | null = null;
  let lossProvider: StudioEngineWebGpuTileProviderV1 | null = null;
  try {
    appendProvider = readyProvider(observed.device);
    rebuildProvider = readyProvider(observed.device);
    let resolveLossCallback:
      ((value: { readonly reason: string; readonly message: string }) => void) | null = null;
    const lossCallback = new Promise<{
      readonly reason: string;
      readonly message: string;
    }>((resolve) => {
      resolveLossCallback = resolve;
    });
    lossProvider = readyProvider(observed.device, (info) => {
      resolveLossCallback?.({
        reason: String(info.reason),
        message: info.message,
      });
    });

    const statsBeforeEpochRejects = appendProvider.stats();
    const staleRequestEpoch = await appendProvider.execute(request(
      mainInput,
      "append",
      { requestEpoch: REQUEST_EPOCH + 1 },
    ));
    const staleDeviceEpoch = await appendProvider.execute(request(
      mainInput,
      "append",
      { deviceEpoch: INITIAL_DEVICE_EPOCH + 1 },
    ));
    const statsAfterEpochRejects = appendProvider.stats();

    const append = completed(
      await appendProvider.execute(request(mainInput, "append")),
      "append",
    );
    const rebuild = completed(
      await rebuildProvider.execute(request(mainInput, "rebuild")),
      "rebuild",
    );
    const appendWords = append.batch.deltas.map(deltaWords);
    const rebuildWords = rebuild.batch.deltas.map(deltaWords);
    const lowering = lowerStudioCanonicalBrushPlanToWebGpuDabs(mainInput.brushPlan);
    if (lowering.status !== "lowered") {
      throw new Error(`CPU oracle canonical lowering returned ${lowering.status}`);
    }
    const cpuTiles = baseTiles.map((base) => rasterCpuTile(base, lowering.dabs));
    const cpuWords = cpuTiles.map(({ words }) => words);
    const parity = cpuTiles.map((cpu, index) => parityMetrics(cpu, appendWords[index]!));
    const recalculatedAppendBatchDigest = studioEngineTileProviderBatchDigest({
      commandIdentity: append.batch.commandIdentity,
      baseDocumentRevision: append.batch.baseDocumentRevision,
      baseLayerRevision: append.batch.baseLayerRevision,
      complete: append.batch.complete,
      deltaCount: append.batch.deltaCount,
      deltas: append.batch.deltas,
    });

    const preAbort = new AbortController();
    preAbort.abort();
    const submittedBeforePreAbort = appendProvider.stats().submittedTiles;
    const preAborted = await appendProvider.execute(
      request(secondInput, "append"),
      preAbort.signal,
    );
    const submittedAfterPreAbort = appendProvider.stats().submittedTiles;

    const inFlightAbort = new AbortController();
    const inFlightPromise = appendProvider.execute(
      request(secondInput, "append"),
      inFlightAbort.signal,
    );
    const inFlightActiveRequestsBeforeAbort =
      appendProvider.stats().activeRequests;
    inFlightAbort.abort();
    const inFlightCancelled = await inFlightPromise;
    const inFlightActiveRequestsAfterAbort = appendProvider.stats().activeRequests;

    const firstConcurrentPromise = appendProvider.execute(
      request(secondInput, "append"),
    );
    const backpressure = await appendProvider.execute(
      request(thirdInput, "append"),
    );
    const firstConcurrent = await firstConcurrentPromise;

    const shaderCompilation = await shaderCompilationEvidence(
      observed.shaderModules,
    );
    const outOfMemoryError = await rawDevice.popErrorScope();
    const validationError = await rawDevice.popErrorScope();

    const deviceLost = timeout(
      rawDevice.lost.then((info) => ({
        reason: String(info.reason),
        message: info.message,
      })),
      DEVICE_LOSS_TIMEOUT_MS,
      "GPUDevice.lost",
    );
    const pendingAtLoss = lossProvider.execute(request(mainInput, "rebuild"));
    rawDevice.destroy();
    const [deviceLossInfo, callbackLossInfo, pendingLossResult] = await Promise.all([
      deviceLost,
      timeout(lossCallback, DEVICE_LOSS_TIMEOUT_MS, "tile provider loss callback"),
      pendingAtLoss,
    ]);
    const rejectedAfterLoss = await lossProvider.execute(request(mainInput, "rebuild"));
    const lossStats = lossProvider.stats();

    const mainEvidence: MainExecutionEvidence = {
      appendReceipt: receiptEvidence(append),
      rebuildReceipt: receiptEvidence(rebuild),
      deltaOrder: append.batch.deltas.map(({ tileId }) => tileId),
      appendContentDigests: append.batch.deltas.map(({ contentDigest }) => contentDigest),
      rebuildContentDigests: rebuild.batch.deltas.map(({ contentDigest }) => contentDigest),
      appendBatchDigest: append.batch.batchDigest,
      rebuildBatchDigest: rebuild.batch.batchDigest,
      recalculatedAppendBatchDigest,
      stableBatchDigest:
        append.batch.batchDigest === rebuild.batch.batchDigest,
      appendRebuildExactHalfWordMismatches:
        exactHalfWordMismatches(appendWords, rebuildWords),
      rowBytes: STUDIO_ENGINE_WEBGPU_TILE_ROW_BYTES,
      rowBytesAlignment: WEBGPU_BYTES_PER_ROW_ALIGNMENT,
      rowPaddingBytes:
        STUDIO_ENGINE_WEBGPU_TILE_ROW_BYTES % WEBGPU_BYTES_PER_ROW_ALIGNMENT,
      tileStride: STUDIO_ENGINE_WEBGPU_TILE_BYTE_LENGTH,
      stagingOffsets: TARGET_COORDINATES.map(
        (_, index) => index * STUDIO_ENGINE_WEBGPU_TILE_BYTE_LENGTH,
      ),
      deltaByteLengths: append.batch.deltas.map((delta) => delta.encoded.byteLength),
      parity,
      edgeSamples: edgeSamples(cpuTiles, appendWords),
      cpuPng: montagePngDataUrl(cpuWords),
      appendGpuPng: montagePngDataUrl(appendWords),
      appendCpuDiffPng: diffMontagePngDataUrl(cpuWords, appendWords),
      rebuildGpuPng: montagePngDataUrl(rebuildWords),
      appendRebuildDiffPng: diffMontagePngDataUrl(appendWords, rebuildWords),
    };

    return {
      status: "ok",
      backend: "webgpu-rgba16float-tile-provider-v1",
      capabilities: observedCapabilities,
      provider: {
        kind: "real-chromium-webgpu-device-boundary",
        adapterInfo: serializableAdapterInfo(adapter),
        textureFormat: "rgba16float",
        tileSize: STUDIO_ENGINE_WEBGPU_TILE_SIZE,
        readback: "full-tile-256-byte-aligned-map-read",
        maxTextureDimension2D: Number(rawDevice.limits.maxTextureDimension2D),
        maxBufferSize: Number(rawDevice.limits.maxBufferSize),
      },
      tolerance: {
        absolute: HALF_FLOAT_ABSOLUTE_TOLERANCE,
        outsideEdgeAbsolute: HALF_FLOAT_OUTSIDE_EDGE_TOLERANCE,
        edgeBandPixels: EDGE_BAND_PIXELS,
      },
      main: mainEvidence,
      epochs: {
        staleRequestEpochReason: rejectedReason(staleRequestEpoch),
        staleDeviceEpochReason: rejectedReason(staleDeviceEpoch),
        statsUnchangedBeforeValidExecution:
          statsBeforeEpochRejects.completedRequests
            === statsAfterEpochRejects.completedRequests
          && statsBeforeEpochRejects.submittedTiles
            === statsAfterEpochRejects.submittedTiles
          && statsBeforeEpochRejects.stagedBytes
            === statsAfterEpochRejects.stagedBytes,
      },
      flowControl: {
        preAbortedReason: rejectedReason(preAborted),
        preAbortedSubmittedTileDelta:
          submittedAfterPreAbort - submittedBeforePreAbort,
        inFlightCancelledReason: rejectedReason(inFlightCancelled),
        inFlightActiveRequestsBeforeAbort,
        inFlightActiveRequestsAfterAbort,
        backpressureReason: rejectedReason(backpressure),
        firstConcurrentStatus: firstConcurrent.status,
        maxInFlightRequests: appendProvider.stats().maxInFlightRequests,
      },
      shaderCompilation,
      errorScopes: {
        validation: gpuErrorMessage(validationError),
        outOfMemory: gpuErrorMessage(outOfMemoryError),
      },
      uncapturedGpuErrors,
      deviceLoss: {
        trigger: "GPUDevice.destroy",
        deviceReason: deviceLossInfo.reason,
        deviceMessage: deviceLossInfo.message,
        callbackReason: callbackLossInfo.reason,
        callbackMessage: callbackLossInfo.message,
        pendingStatus: pendingLossResult.status,
        pendingReason: rejectedReason(pendingLossResult),
        providerStatus: lossStats.status,
        providerDeviceEpoch: lossStats.deviceEpoch,
        rejectedAfterLossReason: rejectedReason(rejectedAfterLoss),
      },
    };
  } finally {
    appendProvider?.dispose();
    rebuildProvider?.dispose();
    lossProvider?.dispose();
    rawDevice.destroy();
  }
}

void run().then(
  (result) => {
    window.__studioEngineWebGpuTileProviderResult = result;
  },
  (error) => {
    window.__studioEngineWebGpuTileProviderResult = {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack ?? null : null,
      capabilities: capabilities(),
    };
  },
);
