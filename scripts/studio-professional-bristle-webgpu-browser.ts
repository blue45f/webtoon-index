/**
 * Real Chromium verification boundary for professional bristle lowering.
 *
 * The browser entry deliberately does not reuse a production raster helper for its oracle. It
 * lowers clean-room canonical bristle plans, executes the existing RGBA16F analytic runtime on an
 * actual GPUDevice, copies the private authority texture through aligned MAP_READ, and compares
 * those half-float words with an independent affine ellipse / Porter-Duff implementation.
 */
import {
  createStudioEngineWebGpuBrushRuntime,
  fingerprintStudioEngineWebGpuBrushPlan,
  STUDIO_ENGINE_WEBGPU_BRUSH_COLOR_MODEL,
  STUDIO_ENGINE_WEBGPU_BRUSH_INPUT_COLOR_ENCODING,
  STUDIO_ENGINE_WEBGPU_BRUSH_RECEIPT_REVISION,
  STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT,
  type StudioEngineWebGpuBrushFrame,
  type StudioEngineWebGpuBrushPlan,
  type StudioEngineWebGpuBrushReceipt,
  type StudioEngineWebGpuBrushRuntime,
  type StudioEngineWebGpuBrushSurface,
} from "../apps/web/src/domains/creator/render/studio-engine-webgpu-brush-runtime";
import {
  resolveStudioProfessionalBristleDynamics,
  type StudioProfessionalBristleResolveResult,
} from "../apps/web/src/domains/creator/studio-professional-bristle-dynamics";
import {
  lowerStudioProfessionalBristleToWebGpu,
  STUDIO_PROFESSIONAL_BRISTLE_WEBGPU_EXTENSION_V1,
  type StudioProfessionalBristleWebGpuCapabilityReceipt,
  type StudioProfessionalBristleWebGpuLoweringResult,
} from "../apps/web/src/domains/creator/studio-professional-bristle-webgpu-lowering";

const WIDTH = 128;
const HEIGHT = 96;
const RESIZE_EPOCH = 31;
const ROW_ALIGNMENT = 256;
const RGBA16_BYTES_PER_PIXEL = 8;
const MAP_READ = 0x0001;
const BUFFER_COPY_DST = 0x0008;
const CPU_ABSOLUTE_TOLERANCE = 0.065;
const OUTSIDE_EDGE_ABSOLUTE_TOLERANCE = 0.004;
const EDGE_MARGIN_PIXELS = 3;
const WAIT_TIMEOUT_MS = 10_000;
const DEVICE_LOSS_TIMEOUT_MS = 5_000;
const float32Scratch = new Float32Array(1);
const uint32Scratch = new Uint32Array(float32Scratch.buffer);

type Candidate = Record<string, unknown>;
type ReadyLowering = Extract<
  StudioProfessionalBristleWebGpuLoweringResult,
  { status: "ready" }
>;

interface BrowserCapabilities {
  readonly offscreenCanvas: boolean;
  readonly webgpu: boolean;
  readonly userAgent: string;
}

interface PixelMetrics {
  readonly comparedComponents: number;
  readonly violatingComponents: number;
  readonly exactHalfWordMismatches: number;
  readonly unaffectedExactHalfWordMismatches: number;
  readonly outsideEdgeViolatingComponents: number;
  readonly edgeBandPixels: number;
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

interface CaseEvidence {
  readonly id: string;
  readonly loweringReceipts: readonly StudioProfessionalBristleWebGpuCapabilityReceipt[];
  readonly runtimeReceipts: readonly StudioEngineWebGpuBrushReceipt[];
  readonly metrics: PixelMetrics;
  readonly samples: readonly PixelSample[];
  readonly dabCount: number;
  readonly batchOrder: readonly string[];
  readonly cpuPng: string;
  readonly webgpuPng: string;
  readonly diffPng: string;
}

interface RuntimeBoundary {
  readonly surface: OffscreenCanvas;
  readonly runtime: StudioEngineWebGpuBrushRuntime;
  readonly target: GPUTexture;
}

interface ObservedBoundary {
  readonly device: GPUDevice;
  readonly context: GPUCanvasContext;
  readonly textures: GPUTexture[];
}

interface FeatureEvidence {
  readonly straightRake: {
    readonly stationCount: number;
    readonly depositionCount: number;
    readonly activeBristles: readonly number[];
  };
  readonly curvedTurn: {
    readonly headingCount: number;
    readonly maximumLongitudinalDisplacement: number;
  };
  readonly contactAngle: {
    readonly fullDepositions: number;
    readonly partialDepositions: number;
  };
  readonly pressureTiltFan: {
    readonly neutralSpread: number;
    readonly expressiveSpread: number;
    readonly neutralMaximumRadius: number;
    readonly expressiveMaximumRadius: number;
  };
  readonly fixedFeatureScaling: {
    readonly firstStationDiameters: readonly number[];
    readonly lastStationDiameters: readonly number[];
    readonly maximumDiameterDelta: number;
  };
  readonly affineReflectionShearScatter: {
    readonly negativeDeterminants: number;
    readonly maximumInverseBasisScatterDelta: number;
    readonly maximumNormalizedScatterRadius: number;
  };
  readonly oklchVariation: {
    readonly distinctColors: number;
    readonly allGamutSafe: boolean;
  };
}

interface PreflightEvidence {
  readonly hostileCanonical: {
    readonly status: string;
    readonly reason: string | null;
    readonly getterReads: number;
  };
  readonly hostileExtension: {
    readonly status: string;
    readonly reason: string | null;
    readonly getterReads: number;
  };
  readonly unsupported: readonly {
    readonly id: string;
    readonly status: string;
    readonly reason: string | null;
    readonly path: string | null;
  }[];
  readonly preAborted: StudioProfessionalBristleWebGpuLoweringResult;
}

interface FlowEvidence {
  readonly appendWithoutBase: string;
  readonly invalidSequence: string;
  readonly staleSequence: string;
  readonly resizeEpochMismatch: string;
  readonly staleResizeEpoch: string;
  readonly backpressure: string;
  readonly completedAfterGate: number;
}

interface ShaderEvidence {
  readonly moduleCount: number;
  readonly messages: readonly {
    readonly type: string;
    readonly message: string;
    readonly lineNum: number;
    readonly linePos: number;
  }[];
}

type BrowserResult =
  | Readonly<{
      status: "ok";
      backend: "professional-bristle-rgba16float-webgpu";
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
        readonly maxTextureDimension2D: number;
      };
      tolerance: {
        readonly cpuAbsolute: number;
        readonly outsideEdgeAbsolute: number;
      };
      cases: readonly CaseEvidence[];
      appendRebuild: {
        readonly contentFingerprintEqual: boolean;
        readonly planFingerprintDifferent: boolean;
        readonly exactHalfWordMismatches: number;
        readonly appendRuntimeFingerprint: string;
        readonly rebuildRuntimeFingerprint: string;
        readonly diffPng: string;
      };
      features: FeatureEvidence;
      preflight: PreflightEvidence;
      flow: FlowEvidence;
      shaders: ShaderEvidence;
      errorScopes: {
        readonly validation: string | null;
        readonly outOfMemory: string | null;
      };
      uncapturedGpuErrors: readonly string[];
      deviceLoss: {
        readonly trigger: "GPUDevice.destroy";
        readonly deviceReason: string;
        readonly deviceMessage: string;
        readonly callbackReason: string;
        readonly callbackMessage: string;
        readonly runtimeStatus: string;
        readonly runtimeDeviceEpoch: number;
        readonly rejectedAfterLoss: string;
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
    __studioProfessionalBristleWebGpuResult?: BrowserResult;
  }
}

function capabilities(): BrowserCapabilities {
  return {
    offscreenCanvas: typeof OffscreenCanvas !== "undefined",
    webgpu: typeof navigator.gpu !== "undefined",
    userAgent: navigator.userAgent,
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(lower: number, upper: number, value: number): number {
  const amount = clamp01((value - lower) / Math.max(1e-9, upper - lower));
  return amount * amount * (3 - 2 * amount);
}

function nextAligned(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
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

function sample(
  sequence: number,
  x: number,
  y: number,
  pressure = 0.7,
  overrides: Candidate = {},
): Candidate {
  return {
    role: "authoritative",
    sequence,
    x,
    y,
    pressure,
    tangentialPressure: 0,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    timeMilliseconds: sequence * 8,
    pointerId: 1,
    flags: 0,
    ...overrides,
  };
}

function recipe(overrides: Candidate = {}): Candidate {
  return {
    version: 1,
    brushId: "browser-professional-bristle",
    engine: "dab-v1",
    material: "pigment",
    tip: {
      kind: "analytic",
      shape: "round",
      edgeSoftness: 0.24,
    },
    size: 18,
    flow: 0.72,
    hardness: 0.7,
    spacingRatio: 0.2,
    scatter: {
      radiusRatio: 0.18,
      distribution: "uniform-disk",
    },
    angleRadians: 0,
    roundness: 1,
    pressure: {
      size: { minimum: 0.45, maximum: 1, exponent: 1.05 },
      opacity: { minimum: 0.45, maximum: 1, exponent: 1 },
      flow: { minimum: 0.6, maximum: 1, exponent: 1 },
    },
    grain: null,
    wetMedia: null,
    ...overrides,
  };
}

interface CanonicalOptions {
  readonly id: string;
  readonly samples: readonly Candidate[];
  readonly transform?: Candidate;
  readonly color?: Candidate;
  readonly composite?: Candidate;
  readonly recipe?: Candidate;
}

function canonical(options: CanonicalOptions): Candidate {
  return {
    kind: "studio-canonical-brush-plan",
    version: 1,
    sessionEpoch: 1,
    strokeEpoch: 1,
    commandSequence: 1,
    strokeId: options.id,
    seed: 0x4a17_91e3,
    coordinateSpace: "document-css-px",
    transform: options.transform ?? {
      encoding: "affine-f64-v1",
      m11: 1,
      m12: 0,
      m21: 0,
      m22: 1,
      translateX: 0,
      translateY: 0,
    },
    color: options.color ?? {
      space: "linear-srgb",
      alphaMode: "straight",
      components: [0.7, 0.08, 0.03, 0.62],
    },
    composite: options.composite ?? {
      porterDuff: "source-over",
      blendMode: "normal",
      opacity: 0.78,
    },
    recipe: options.recipe ?? recipe(),
    source: {
      encoding: "accepted-authoritative-samples-v1",
      firstSequence: options.samples[0]!.sequence,
      lastSequence: options.samples.at(-1)!.sequence,
      samples: options.samples,
    },
  };
}

function dynamics(overrides: Candidate = {}): Candidate {
  return {
    kind: "studio-professional-bristle-dynamics",
    version: 1,
    brushId: "browser-clean-room-rake",
    seed: 0xffff_ffff,
    bristleCount: 7,
    bristleRadiusRatio: 0.11,
    featureReferenceDiameter: 18,
    spacingRatio: 0.48,
    spread: 0.78,
    fanning: 0.5,
    rigidity: 0.58,
    friction: 0.3,
    contactAngleRadians: Math.PI,
    turnAmount: 1.4,
    softenEdge: 0.38,
    pressureSpread: 0.48,
    tiltSpread: 0.7,
    lengthVariation: 0.35,
    colorVariation: 0.75,
    orientation: "hybrid",
    scaleFeatureWithBrushSize: true,
    ...overrides,
  };
}

function ready(
  canonicalInput: unknown,
  dynamicsInput: unknown,
  mode: "append" | "rebuild" = "rebuild",
): ReadyLowering {
  const result = lowerStudioProfessionalBristleToWebGpu(
    canonicalInput,
    dynamicsInput,
    STUDIO_PROFESSIONAL_BRISTLE_WEBGPU_EXTENSION_V1,
    { mode },
  );
  if (result.status !== "ready") {
    throw new Error(`bristle lowering failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function resolved(
  canonicalInput: unknown,
  dynamicsInput: unknown,
): Extract<StudioProfessionalBristleResolveResult, { status: "resolved" }> {
  const result = resolveStudioProfessionalBristleDynamics(
    canonicalInput,
    dynamicsInput,
  );
  if (result.status !== "resolved") {
    throw new Error(`bristle dynamics failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function evaluateMetric(
  dab: StudioEngineWebGpuBrushPlan["dabs"][number],
  pixelX: number,
  pixelY: number,
): {
  readonly metric: number;
  readonly fwidth: number;
  readonly antialias: number;
  readonly innerEdge: number;
  readonly coverage: number;
} {
  const [xx, xy, yx, yy] = dab.tip.localToDocument;
  const determinant = xx * yy - xy * yx;
  const deltaX = pixelX + 0.5 - dab.x;
  const deltaY = pixelY + 0.5 - dab.y;
  const localX = (yy * deltaX - yx * deltaY) / determinant;
  const localY = (-xy * deltaX + xx * deltaY) / determinant;
  const metric = Math.hypot(localX, localY);
  let gradientLocalX = 0;
  let gradientLocalY = 0;
  if (metric > 0) {
    gradientLocalX = localX / metric;
    gradientLocalY = localY / metric;
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

/**
 * Independent CPU authority: affine inverse mapping, analytic unit circle, derivative estimate,
 * premultiplied source-over/destination-out and half-float quantization after every deposition.
 */
function rasterIndependentCpu(
  plans: readonly StudioEngineWebGpuBrushPlan[],
): Uint16Array {
  const values = new Float32Array(WIDTH * HEIGHT * 4);
  for (const plan of plans) {
    if (plan.mode === "rebuild") values.fill(0);
    for (const dab of plan.dabs) {
      const [red, green, blue, baseAlpha] = dab.color.components;
      for (let y = 0; y < HEIGHT; y += 1) {
        for (let x = 0; x < WIDTH; x += 1) {
          const sourceAlpha = clamp01(
            baseAlpha * evaluateMetric(dab, x, y).coverage,
          );
          if (sourceAlpha <= 0) continue;
          const inverse = 1 - sourceAlpha;
          const offset = (y * WIDTH + x) * 4;
          if (dab.composite.porterDuff === "destination-out") {
            values[offset] = quantizeHalf(values[offset]! * inverse);
            values[offset + 1] = quantizeHalf(values[offset + 1]! * inverse);
            values[offset + 2] = quantizeHalf(values[offset + 2]! * inverse);
            values[offset + 3] = quantizeHalf(values[offset + 3]! * inverse);
          } else {
            values[offset] = quantizeHalf(
              red * sourceAlpha + values[offset]! * inverse,
            );
            values[offset + 1] = quantizeHalf(
              green * sourceAlpha + values[offset + 1]! * inverse,
            );
            values[offset + 2] = quantizeHalf(
              blue * sourceAlpha + values[offset + 2]! * inverse,
            );
            values[offset + 3] = quantizeHalf(
              sourceAlpha + values[offset + 3]! * inverse,
            );
          }
        }
      }
    }
  }
  return Uint16Array.from(values, float32ToFloat16);
}

function edgeBand(
  plans: readonly StudioEngineWebGpuBrushPlan[],
): {
  readonly mask: Uint8Array;
  readonly pixels: number;
} {
  const mask = new Uint8Array(WIDTH * HEIGHT);
  const dabs = plans.flatMap((plan) => plan.dabs);
  let pixels = 0;
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const isEdge = dabs.some((dab) => {
        const evaluation = evaluateMetric(dab, x, y);
        const margin = EDGE_MARGIN_PIXELS * Math.max(evaluation.fwidth, 0.0005);
        return evaluation.metric >= evaluation.innerEdge - evaluation.antialias - margin
          && evaluation.metric <= 1 + evaluation.antialias + margin;
      });
      if (isEdge) {
        mask[y * WIDTH + x] = 1;
        pixels += 1;
      }
    }
  }
  return { mask, pixels };
}

function comparePixels(
  cpu: Uint16Array,
  gpu: Uint16Array,
  plans: readonly StudioEngineWebGpuBrushPlan[],
): PixelMetrics {
  const band = edgeBand(plans);
  let violatingComponents = 0;
  let exactHalfWordMismatches = 0;
  let unaffectedExactHalfWordMismatches = 0;
  let outsideEdgeViolatingComponents = 0;
  let maxAbsoluteDelta = 0;
  let totalAbsoluteDelta = 0;
  for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel += 1) {
    const offset = pixel * 4;
    const unaffected =
      band.mask[pixel] === 0
      &&
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
      if (
        band.mask[pixel] === 0
        && delta > OUTSIDE_EDGE_ABSOLUTE_TOLERANCE
      ) outsideEdgeViolatingComponents += 1;
      maxAbsoluteDelta = Math.max(maxAbsoluteDelta, delta);
      totalAbsoluteDelta += delta;
    }
  }
  return {
    comparedComponents: cpu.length,
    violatingComponents,
    exactHalfWordMismatches,
    unaffectedExactHalfWordMismatches,
    outsideEdgeViolatingComponents,
    edgeBandPixels: band.pixels,
    maxAbsoluteDelta,
    meanAbsoluteDelta: totalAbsoluteDelta / cpu.length,
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

function evidenceSamples(
  cpu: Uint16Array,
  gpu: Uint16Array,
): readonly PixelSample[] {
  let maximumAlpha = -1;
  let maximumPixel = 0;
  for (let index = 0; index < WIDTH * HEIGHT; index += 1) {
    const alpha = float16ToFloat32(gpu[index * 4 + 3]!);
    if (alpha > maximumAlpha) {
      maximumAlpha = alpha;
      maximumPixel = index;
    }
  }
  return [
    { label: "maximum-alpha", x: maximumPixel % WIDTH, y: Math.floor(maximumPixel / WIDTH) },
    { label: "transparent-corner", x: 1, y: 1 },
  ].map(({ label, x, y }) => {
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
  });
}

function linearToSrgb(value: number): number {
  const safe = clamp01(value);
  return safe <= 0.0031308
    ? safe * 12.92
    : 1.055 * Math.pow(safe, 1 / 2.4) - 0.055;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(blob);
  });
}

async function canvasPng(words: Uint16Array): Promise<string> {
  const bytes = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let pixelIndex = 0; pixelIndex < WIDTH * HEIGHT; pixelIndex += 1) {
    const offset = pixelIndex * 4;
    const alpha = clamp01(float16ToFloat32(words[offset + 3]!));
    const inverseAlpha = alpha > 1e-6 ? 1 / alpha : 0;
    bytes[offset] = Math.round(
      linearToSrgb(float16ToFloat32(words[offset]!) * inverseAlpha) * 255,
    );
    bytes[offset + 1] = Math.round(
      linearToSrgb(float16ToFloat32(words[offset + 1]!) * inverseAlpha) * 255,
    );
    bytes[offset + 2] = Math.round(
      linearToSrgb(float16ToFloat32(words[offset + 2]!) * inverseAlpha) * 255,
    );
    bytes[offset + 3] = Math.round(alpha * 255);
  }
  const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D PNG evidence context unavailable");
  context.putImageData(new ImageData(bytes, WIDTH, HEIGHT), 0, 0);
  return blobToDataUrl(await canvas.convertToBlob({ type: "image/png" }));
}

async function diffPng(left: Uint16Array, right: Uint16Array): Promise<string> {
  const bytes = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let pixelIndex = 0; pixelIndex < WIDTH * HEIGHT; pixelIndex += 1) {
    const offset = pixelIndex * 4;
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
    const intensity = Math.round(clamp01(maximum * 32) * 255);
    bytes[offset] = intensity;
    bytes[offset + 1] = 0;
    bytes[offset + 2] = 255 - intensity;
    bytes[offset + 3] = 255;
  }
  const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D diff evidence context unavailable");
  context.putImageData(new ImageData(bytes, WIDTH, HEIGHT), 0, 0);
  return blobToDataUrl(await canvas.convertToBlob({ type: "image/png" }));
}

function observeBoundary(
  rawDevice: GPUDevice,
  rawContext: GPUCanvasContext,
  shaderModules: GPUShaderModule[],
  fenceGate?: Promise<void>,
): ObservedBoundary {
  const textures: GPUTexture[] = [];
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
          if (
            String(descriptor.label ?? "")
              .startsWith("Studio Engine Worker RGBA16F brush surface epoch ")
          ) textures.push(texture);
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
  const context = new Proxy(rawContext, {
    get(target, property) {
      if (property === "configure") {
        return (configuration: GPUCanvasConfiguration): void => {
          target.configure({ ...configuration, device: rawDevice });
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function"
        ? (value as (...arguments_: unknown[]) => unknown).bind(target)
        : value;
    },
  }) as unknown as GPUCanvasContext;
  return { device, context, textures };
}

async function createRuntimeBoundary(
  rawDevice: GPUDevice,
  canvasFormat: GPUTextureFormat,
  shaderModules: GPUShaderModule[],
  options: {
    readonly fenceGate?: Promise<void>;
    readonly maximumInFlightSubmissions?: number;
    readonly onDeviceLost?: (info: GPUDeviceLostInfo) => void;
  } = {},
): Promise<RuntimeBoundary> {
  const surface = new OffscreenCanvas(WIDTH, HEIGHT);
  const rawContext = surface.getContext("webgpu");
  if (!rawContext) throw new Error("OffscreenCanvas WebGPU context unavailable");
  const observed = observeBoundary(
    rawDevice,
    rawContext,
    shaderModules,
    options.fenceGate,
  );
  const created = await createStudioEngineWebGpuBrushRuntime({
    surface: surface as unknown as StudioEngineWebGpuBrushSurface,
    boundary: {
      device: observed.device,
      context: observed.context,
      canvasFormat,
      ownsDevice: false,
    },
    initialResizeEpoch: RESIZE_EPOCH,
    maxInFlightSubmissions: options.maximumInFlightSubmissions ?? 3,
    ...(options.onDeviceLost ? { onDeviceLost: options.onDeviceLost } : {}),
  });
  if (created.status !== "ready") {
    throw new Error(`analytic runtime initialization failed: ${created.reason}`);
  }
  const target = observed.textures[0];
  if (!target) throw new Error("private RGBA16F authority texture was not observed");
  return { surface, runtime: created.runtime, target };
}

async function waitForRuntime(
  runtime: StudioEngineWebGpuBrushRuntime,
  submission: number,
): Promise<void> {
  const start = performance.now();
  while (performance.now() - start < WAIT_TIMEOUT_MS) {
    if (runtime.stats().completedSubmissionSequence >= submission) return;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }
  throw new Error(`runtime submission ${submission} did not complete`);
}

async function readRgba16Float(
  rawDevice: GPUDevice,
  texture: GPUTexture,
): Promise<Uint16Array> {
  const bytesPerRow = nextAligned(WIDTH * RGBA16_BYTES_PER_PIXEL, ROW_ALIGNMENT);
  const buffer = rawDevice.createBuffer({
    label: "Professional bristle RGBA16F MAP_READ",
    size: bytesPerRow * HEIGHT,
    usage: MAP_READ | BUFFER_COPY_DST,
  });
  const encoder = rawDevice.createCommandEncoder({
    label: "Professional bristle RGBA16F readback encoder",
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

function frame(
  requestSequence: number,
  plan: StudioEngineWebGpuBrushPlan,
  resizeEpoch = RESIZE_EPOCH,
): StudioEngineWebGpuBrushFrame {
  return {
    requestSequence,
    resizeEpoch,
    rasterRect: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
    update: plan,
  };
}

async function executePlans(
  runtime: StudioEngineWebGpuBrushRuntime,
  plans: readonly StudioEngineWebGpuBrushPlan[],
): Promise<readonly StudioEngineWebGpuBrushReceipt[]> {
  const receipts: StudioEngineWebGpuBrushReceipt[] = [];
  for (let index = 0; index < plans.length; index += 1) {
    const nextFrame = frame(index + 1, plans[index]!);
    const execution = await runtime.execute(nextFrame);
    if (execution.status !== "presented") {
      throw new Error(`runtime rejected ${plans[index]!.strokeId}: ${execution.reason}`);
    }
    if (
      execution.receipt.kind !== "studio-engine-webgpu-brush-receipt"
      || execution.receipt.revision !== STUDIO_ENGINE_WEBGPU_BRUSH_RECEIPT_REVISION
      || execution.receipt.textureFormat !== STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT
      || execution.receipt.colorModel !== STUDIO_ENGINE_WEBGPU_BRUSH_COLOR_MODEL
      || execution.receipt.inputColorEncoding
        !== STUDIO_ENGINE_WEBGPU_BRUSH_INPUT_COLOR_ENCODING
      || execution.receipt.planFingerprint
        !== fingerprintStudioEngineWebGpuBrushPlan(nextFrame)
      || execution.receipt.queueState !== "submitted"
      || execution.receipt.complete !== true
    ) throw new Error(`runtime receipt contract drifted for ${plans[index]!.strokeId}`);
    receipts.push(execution.receipt);
    await waitForRuntime(runtime, runtime.stats().submissions);
  }
  return receipts;
}

async function runCase(
  rawDevice: GPUDevice,
  canvasFormat: GPUTextureFormat,
  shaderModules: GPUShaderModule[],
  id: string,
  lowerings: readonly ReadyLowering[],
): Promise<CaseEvidence> {
  const boundary = await createRuntimeBoundary(rawDevice, canvasFormat, shaderModules);
  try {
    const plans = lowerings.map((lowering) => lowering.plan);
    const runtimeReceipts = await executePlans(boundary.runtime, plans);
    const gpu = await readRgba16Float(rawDevice, boundary.target);
    const cpu = rasterIndependentCpu(plans);
    return {
      id,
      loweringReceipts: lowerings.map((lowering) => lowering.receipt),
      runtimeReceipts,
      metrics: comparePixels(cpu, gpu, plans),
      samples: evidenceSamples(cpu, gpu),
      dabCount: plans.reduce((sum, plan) => sum + plan.dabs.length, 0),
      batchOrder: plans.flatMap(
        (plan) => plan.batches.map((batch) => batch.composite.porterDuff),
      ),
      cpuPng: await canvasPng(cpu),
      webgpuPng: await canvasPng(gpu),
      diffPng: await diffPng(cpu, gpu),
    };
  } finally {
    boundary.runtime.dispose();
  }
}

function inverseBasisScatter(
  dab: StudioEngineWebGpuBrushPlan["dabs"][number],
): readonly [number, number] {
  const [xx, xy, yx, yy] = dab.tip.localToDocument;
  const determinant = xx * yy - xy * yx;
  const deltaX = dab.x - dab.stationX;
  const deltaY = dab.y - dab.stationY;
  return [
    (yy * deltaX - yx * deltaY) / determinant,
    (-xy * deltaX + xx * deltaY) / determinant,
  ];
}

function maxRadius(result: Extract<
  StudioProfessionalBristleResolveResult,
  { status: "resolved" }
>): number {
  return Math.max(...result.depositions.map((deposition) => deposition.radius));
}

function featureEvidence(inputs: {
  readonly straightCanonical: Candidate;
  readonly straightDynamics: Candidate;
  readonly curveCanonical: Candidate;
  readonly curveDynamics: Candidate;
  readonly neutralCanonical: Candidate;
  readonly expressiveCanonical: Candidate;
  readonly fanDynamics: Candidate;
  readonly fixedCanonical: Candidate;
  readonly fixedDynamics: Candidate;
  readonly affineCanonical: Candidate;
  readonly identityAffineCanonical: Candidate;
  readonly affineDynamics: Candidate;
  readonly affineLowering: ReadyLowering;
  readonly identityAffineLowering: ReadyLowering;
  readonly oklchLowering: ReadyLowering;
}): FeatureEvidence {
  const straight = resolved(inputs.straightCanonical, inputs.straightDynamics);
  const curve = resolved(inputs.curveCanonical, inputs.curveDynamics);
  const neutral = resolved(inputs.neutralCanonical, inputs.fanDynamics);
  const expressive = resolved(inputs.expressiveCanonical, inputs.fanDynamics);
  const fixed = resolved(inputs.fixedCanonical, inputs.fixedDynamics);
  const partial = ready(
    inputs.straightCanonical,
    { ...inputs.straightDynamics, contactAngleRadians: Math.PI * 0.18 },
  );
  const full = ready(inputs.straightCanonical, inputs.straightDynamics);
  const firstFixed = fixed.depositions.filter((deposition) => deposition.stationIndex === 0);
  const lastStationIndex = fixed.stations.at(-1)!.index;
  const lastFixed = fixed.depositions.filter(
    (deposition) => deposition.stationIndex === lastStationIndex,
  );
  const firstStationDiameters = firstFixed.map((deposition) => deposition.radius * 2);
  const lastStationDiameters = lastFixed.map((deposition) => deposition.radius * 2);
  const affineLocal = inputs.affineLowering.plan.dabs.map(inverseBasisScatter);
  const identityLocal = inputs.identityAffineLowering.plan.dabs.map(inverseBasisScatter);
  let maximumInverseBasisScatterDelta = 0;
  for (let index = 0; index < affineLocal.length; index += 1) {
    maximumInverseBasisScatterDelta = Math.max(
      maximumInverseBasisScatterDelta,
      Math.abs(affineLocal[index]![0] - identityLocal[index]![0]),
      Math.abs(affineLocal[index]![1] - identityLocal[index]![1]),
    );
  }
  return {
    straightRake: {
      stationCount: straight.stations.length,
      depositionCount: straight.depositions.length,
      activeBristles: straight.stations.map((station) => station.activeBristles),
    },
    curvedTurn: {
      headingCount: new Set(
        curve.depositions.map((deposition) => Math.fround(deposition.headingRadians)),
      ).size,
      maximumLongitudinalDisplacement: Math.max(
        ...curve.depositions.map(
          (deposition) => Math.abs(deposition.longitudinalOffset),
        ),
      ),
    },
    contactAngle: {
      fullDepositions: full.receipt.depositionCount,
      partialDepositions: partial.receipt.depositionCount,
    },
    pressureTiltFan: {
      neutralSpread: Math.max(
        ...neutral.depositions.map((deposition) => Math.abs(deposition.lateralOffset)),
      ),
      expressiveSpread: Math.max(
        ...expressive.depositions.map(
          (deposition) => Math.abs(deposition.lateralOffset),
        ),
      ),
      neutralMaximumRadius: maxRadius(neutral),
      expressiveMaximumRadius: maxRadius(expressive),
    },
    fixedFeatureScaling: {
      firstStationDiameters,
      lastStationDiameters,
      maximumDiameterDelta: Math.max(
        ...firstStationDiameters.map(
          (diameter, index) => Math.abs(diameter - lastStationDiameters[index]!),
        ),
      ),
    },
    affineReflectionShearScatter: {
      negativeDeterminants: inputs.affineLowering.plan.dabs.filter((dab) => (
        dab.tip.localToDocument[0] * dab.tip.localToDocument[3]
          - dab.tip.localToDocument[1] * dab.tip.localToDocument[2] < 0
      )).length,
      maximumInverseBasisScatterDelta,
      maximumNormalizedScatterRadius: Math.max(
        ...affineLocal.map((local) => Math.hypot(...local)),
      ),
    },
    oklchVariation: {
      distinctColors: new Set(
        inputs.oklchLowering.plan.dabs.map(
          (dab) => dab.color.components.slice(0, 3).join(":"),
        ),
      ).size,
      allGamutSafe: inputs.oklchLowering.plan.dabs.every(
        (dab) => dab.color.components.every(
          (component) => component >= 0 && component <= 1,
        ),
      ),
    },
  };
}

function resultReason(result: StudioProfessionalBristleWebGpuLoweringResult): string | null {
  return "reason" in result ? result.reason : null;
}

function resultPath(result: StudioProfessionalBristleWebGpuLoweringResult): string | null {
  return "path" in result ? result.path ?? null : null;
}

function preflightEvidence(baseCanonical: Candidate, baseDynamics: Candidate): PreflightEvidence {
  let canonicalGetterReads = 0;
  const hostileCanonical = { ...baseCanonical };
  Object.defineProperty(hostileCanonical, "color", {
    enumerable: true,
    get() {
      canonicalGetterReads += 1;
      return baseCanonical.color;
    },
  });
  const hostileCanonicalResult = lowerStudioProfessionalBristleToWebGpu(
    hostileCanonical,
    baseDynamics,
    STUDIO_PROFESSIONAL_BRISTLE_WEBGPU_EXTENSION_V1,
  );

  let extensionGetterReads = 0;
  const hostileExtension: Candidate = {
    ...STUDIO_PROFESSIONAL_BRISTLE_WEBGPU_EXTENSION_V1,
  };
  Object.defineProperty(hostileExtension, "colorVariation", {
    enumerable: true,
    get() {
      extensionGetterReads += 1;
      return "oklch-gamut-safe-v1";
    },
  });
  const hostileExtensionResult = lowerStudioProfessionalBristleToWebGpu(
    baseCanonical,
    baseDynamics,
    hostileExtension,
  );

  const baseRecipe = baseCanonical.recipe as Candidate;
  const unsupportedInputs: readonly [string, Candidate][] = [
    [
      "display-p3",
      {
        ...baseCanonical,
        color: {
          space: "linear-display-p3",
          alphaMode: "straight",
          components: [0.7, 0.1, 0.03, 0.7],
        },
      },
    ],
    [
      "non-normal-blend",
      {
        ...baseCanonical,
        composite: {
          porterDuff: "source-over",
          blendMode: "multiply",
          opacity: 1,
        },
      },
    ],
    [
      "texture-tip",
      {
        ...baseCanonical,
        recipe: {
          ...baseRecipe,
          tip: {
            kind: "texture",
            assetId: "hostile-tip",
            contentHash: "sha256:abcdef0123456789",
            channel: "alpha",
            width: 16,
            height: 16,
          },
        },
      },
    ],
    [
      "grain",
      {
        ...baseCanonical,
        recipe: {
          ...baseRecipe,
          grain: {
            kind: "procedural-noise",
            assetId: null,
            contentHash: null,
            space: "document",
            scale: 4,
            depth: 0.3,
            contrast: 0.5,
            seed: 9,
          },
        },
      },
    ],
    [
      "wet-media",
      {
        ...baseCanonical,
        recipe: {
          ...baseRecipe,
          engine: "wet-media-v1",
          wetMedia: {
            model: "pigment-water-v1",
            fieldScale: 2,
            fixedRateHz: 120,
            simulationSteps: 8,
            absorption: 0.2,
            bleed: 0.3,
            dryingRate: 0.4,
            edgeDarkening: 0.5,
            fixationRate: 0.2,
            granulation: 0.3,
            paperRoughness: 0.4,
            pigmentLoad: 0.8,
            waterLoad: 0.7,
            wetnessLoad: 0.9,
          },
        },
      },
    ],
    [
      "unsupported-tip-shape",
      {
        ...baseCanonical,
        recipe: {
          ...baseRecipe,
          tip: { kind: "analytic", shape: "square", edgeSoftness: 0.2 },
        },
      },
    ],
  ];
  const unsupported = unsupportedInputs.map(([id, input]) => {
    const result = lowerStudioProfessionalBristleToWebGpu(
      input,
      baseDynamics,
      STUDIO_PROFESSIONAL_BRISTLE_WEBGPU_EXTENSION_V1,
    );
    return {
      id,
      status: result.status,
      reason: resultReason(result),
      path: resultPath(result),
    };
  });
  const controller = new AbortController();
  controller.abort();
  const preAborted = lowerStudioProfessionalBristleToWebGpu(
    baseCanonical,
    baseDynamics,
    STUDIO_PROFESSIONAL_BRISTLE_WEBGPU_EXTENSION_V1,
    { signal: controller.signal },
  );
  return {
    hostileCanonical: {
      status: hostileCanonicalResult.status,
      reason: resultReason(hostileCanonicalResult),
      getterReads: canonicalGetterReads,
    },
    hostileExtension: {
      status: hostileExtensionResult.status,
      reason: resultReason(hostileExtensionResult),
      getterReads: extensionGetterReads,
    },
    unsupported,
    preAborted,
  };
}

function rejectionReason(
  result: Awaited<ReturnType<StudioEngineWebGpuBrushRuntime["execute"]>>,
): string {
  return result.status === "rejected" ? result.reason : "unexpected-presented";
}

async function flowEvidence(
  rawDevice: GPUDevice,
  canvasFormat: GPUTextureFormat,
  shaderModules: GPUShaderModule[],
  rebuildPlan: StudioEngineWebGpuBrushPlan,
  appendPlan: StudioEngineWebGpuBrushPlan,
): Promise<FlowEvidence> {
  const ordinary = await createRuntimeBoundary(rawDevice, canvasFormat, shaderModules);
  let appendWithoutBase: string;
  let invalidSequence: string;
  let staleSequence: string;
  let resizeEpochMismatch: string;
  let staleResizeEpoch: string;
  try {
    appendWithoutBase = rejectionReason(
      await ordinary.runtime.execute(frame(1, appendPlan)),
    );
    invalidSequence = rejectionReason(
      await ordinary.runtime.execute(frame(0, rebuildPlan)),
    );
    const accepted = await ordinary.runtime.execute(frame(1, rebuildPlan));
    if (accepted.status !== "presented") throw new Error("flow baseline was rejected");
    await waitForRuntime(ordinary.runtime, ordinary.runtime.stats().submissions);
    staleSequence = rejectionReason(
      await ordinary.runtime.execute(frame(1, rebuildPlan)),
    );
    resizeEpochMismatch = rejectionReason(
      await ordinary.runtime.execute(frame(2, rebuildPlan, RESIZE_EPOCH + 1)),
    );
    const staleResize = ordinary.runtime.resize({
      width: WIDTH,
      height: HEIGHT,
      resizeEpoch: RESIZE_EPOCH,
    });
    staleResizeEpoch = staleResize.status === "rejected"
      ? staleResize.reason
      : "unexpected-ready";
  } finally {
    ordinary.runtime.dispose();
  }

  let releaseGate!: () => void;
  const fenceGate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const gated = await createRuntimeBoundary(rawDevice, canvasFormat, shaderModules, {
    fenceGate,
    maximumInFlightSubmissions: 1,
  });
  let backpressure: string;
  let completedAfterGate: number;
  try {
    const first = await gated.runtime.execute(frame(1, rebuildPlan));
    if (first.status !== "presented") throw new Error("gated baseline was rejected");
    backpressure = rejectionReason(
      await gated.runtime.execute(frame(2, rebuildPlan)),
    );
    releaseGate();
    await waitForRuntime(gated.runtime, 1);
    completedAfterGate = gated.runtime.stats().completedSubmissionSequence;
  } finally {
    releaseGate();
    gated.runtime.dispose();
  }
  return {
    appendWithoutBase,
    invalidSequence,
    staleSequence,
    resizeEpochMismatch,
    staleResizeEpoch,
    backpressure,
    completedAfterGate,
  };
}

function emptyPlan(
  strokeId: string,
): StudioEngineWebGpuBrushPlan {
  return {
    kind: "studio-engine-webgpu-canonical-plan",
    mode: "rebuild",
    loweringVersion: 1,
    strokeId,
    dabs: [],
    batches: [],
  };
}

async function appendRebuildEvidence(
  rawDevice: GPUDevice,
  canvasFormat: GPUTextureFormat,
  shaderModules: GPUShaderModule[],
  append: ReadyLowering,
  rebuild: ReadyLowering,
): Promise<{
  readonly contentFingerprintEqual: boolean;
  readonly planFingerprintDifferent: boolean;
  readonly exactHalfWordMismatches: number;
  readonly appendRuntimeFingerprint: string;
  readonly rebuildRuntimeFingerprint: string;
  readonly diffPng: string;
}> {
  const appendBoundary = await createRuntimeBoundary(
    rawDevice,
    canvasFormat,
    shaderModules,
  );
  const rebuildBoundary = await createRuntimeBoundary(
    rawDevice,
    canvasFormat,
    shaderModules,
  );
  try {
    const appendFrames = [
      frame(1, emptyPlan(append.plan.strokeId)),
      frame(2, append.plan),
    ] as const;
    for (const nextFrame of appendFrames) {
      const result = await appendBoundary.runtime.execute(nextFrame);
      if (result.status !== "presented") {
        throw new Error(`append determinism runtime rejected: ${result.reason}`);
      }
      await waitForRuntime(
        appendBoundary.runtime,
        appendBoundary.runtime.stats().submissions,
      );
    }
    const rebuildFrame = frame(1, rebuild.plan);
    const rebuilt = await rebuildBoundary.runtime.execute(rebuildFrame);
    if (rebuilt.status !== "presented") {
      throw new Error(`rebuild determinism runtime rejected: ${rebuilt.reason}`);
    }
    await waitForRuntime(
      rebuildBoundary.runtime,
      rebuildBoundary.runtime.stats().submissions,
    );
    const appendWords = await readRgba16Float(rawDevice, appendBoundary.target);
    const rebuildWords = await readRgba16Float(rawDevice, rebuildBoundary.target);
    let exactHalfWordMismatches = 0;
    for (let index = 0; index < appendWords.length; index += 1) {
      if (appendWords[index] !== rebuildWords[index]) exactHalfWordMismatches += 1;
    }
    return {
      contentFingerprintEqual:
        append.receipt.contentFingerprint === rebuild.receipt.contentFingerprint,
      planFingerprintDifferent:
        append.receipt.planFingerprint !== rebuild.receipt.planFingerprint,
      exactHalfWordMismatches,
      appendRuntimeFingerprint: fingerprintStudioEngineWebGpuBrushPlan(
        appendFrames[1],
      ),
      rebuildRuntimeFingerprint: fingerprintStudioEngineWebGpuBrushPlan(
        rebuildFrame,
      ),
      diffPng: await diffPng(appendWords, rebuildWords),
    };
  } finally {
    appendBoundary.runtime.dispose();
    rebuildBoundary.runtime.dispose();
  }
}

async function compileShaders(
  modules: readonly GPUShaderModule[],
): Promise<ShaderEvidence> {
  const messages = (
    await Promise.all(modules.map((module) => module.getCompilationInfo()))
  ).flatMap((info) => Array.from(info.messages)).map((message) => ({
    type: String(message.type),
    message: message.message,
    lineNum: message.lineNum,
    linePos: message.linePos,
  }));
  return { moduleCount: modules.length, messages };
}

async function run(): Promise<BrowserResult> {
  const observedCapabilities = capabilities();
  if (!observedCapabilities.offscreenCanvas) {
    return {
      status: "unsupported",
      reason: "offscreen-canvas-unavailable",
      message: "OffscreenCanvas is unavailable",
      capabilities: observedCapabilities,
    };
  }
  if (!observedCapabilities.webgpu) {
    return {
      status: "unsupported",
      reason: "webgpu-unavailable",
      message: "navigator.gpu is unavailable",
      capabilities: observedCapabilities,
    };
  }
  let adapter: GPUAdapter | null;
  try {
    adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  } catch (error) {
    return {
      status: "unsupported",
      reason: "adapter-request-failed",
      message: error instanceof Error ? error.message : String(error),
      capabilities: observedCapabilities,
    };
  }
  if (!adapter) {
    return {
      status: "unsupported",
      reason: "adapter-unavailable",
      message: "navigator.gpu.requestAdapter returned null",
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

  const shaderModules: GPUShaderModule[] = [];
  const uncapturedGpuErrors: string[] = [];
  rawDevice.addEventListener("uncapturederror", (event) => {
    uncapturedGpuErrors.push(event.error.message);
  });
  rawDevice.pushErrorScope("validation");
  rawDevice.pushErrorScope("out-of-memory");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();

  const straightCanonical = canonical({
    id: "bristle-straight-rake",
    samples: [
      sample(1, 18, 24, 0.72),
      sample(2, 108, 24, 0.72),
    ],
  });
  const straightDynamics = dynamics({ orientation: "stroke-direction" });
  const curveCanonical = canonical({
    id: "bristle-curved-turn",
    samples: [
      sample(1, 22, 76, 0.55),
      sample(2, 55, 74, 0.7, { twist: 15 }),
      sample(3, 78, 55, 0.82, { twist: 42 }),
      sample(4, 102, 24, 0.95, { twist: 78 }),
    ],
  });
  const curveDynamics = dynamics({ turnAmount: 1.8, orientation: "hybrid" });
  const neutralCanonical = canonical({
    id: "bristle-neutral-fan",
    samples: [
      sample(1, 20, 45, 0.15),
      sample(2, 108, 45, 0.15),
    ],
  });
  const expressiveCanonical = canonical({
    id: "bristle-pressure-tilt-fan",
    samples: [
      sample(1, 20, 45, 1, { tiltX: 82 }),
      sample(2, 108, 45, 1, { tiltX: 82 }),
    ],
    color: {
      space: "linear-srgb",
      alphaMode: "straight",
      components: [0.08, 0.4, 0.9, 0.58],
    },
  });
  const fanDynamics = dynamics({
    orientation: "stroke-direction",
    pressureSpread: 0.8,
    tiltSpread: 0.95,
  });
  const fixedCanonical = canonical({
    id: "bristle-fixed-feature-scale",
    samples: [
      sample(1, 18, 64, 0.15),
      sample(2, 108, 64, 1),
    ],
    recipe: recipe({
      size: 25,
      pressure: {
        size: { minimum: 0.25, maximum: 1, exponent: 1 },
        opacity: { minimum: 0.55, maximum: 1, exponent: 1 },
        flow: { minimum: 0.6, maximum: 1, exponent: 1 },
      },
    }),
  });
  const fixedDynamics = dynamics({
    scaleFeatureWithBrushSize: false,
    featureReferenceDiameter: 20,
    orientation: "stroke-direction",
  });
  const affineTransform = {
    encoding: "affine-f64-v1",
    m11: -1.65,
    m12: 0.42,
    m21: 0.58,
    m22: 0.72,
    translateX: 136,
    translateY: -12.5,
  };
  const affineRecipe = recipe({
    scatter: { radiusRatio: 0.7, distribution: "uniform-disk" },
  });
  const affineCanonical = canonical({
    id: "bristle-affine-reflection-shear",
    samples: [sample(1, 62, 48, 0.85, { tiltX: 35, twist: 28 })],
    transform: affineTransform,
    recipe: affineRecipe,
    color: {
      space: "linear-srgb",
      alphaMode: "straight",
      components: [1, 0.012, 0.002, 0.68],
    },
  });
  const identityAffineCanonical = canonical({
    id: "bristle-affine-reflection-shear",
    samples: [sample(1, 62, 48, 0.85, { tiltX: 35, twist: 28 })],
    recipe: affineRecipe,
    color: {
      space: "linear-srgb",
      alphaMode: "straight",
      components: [1, 0.012, 0.002, 0.68],
    },
  });
  const affineDynamics = dynamics({
    orientation: "stroke-direction",
    pressureSpread: 0,
    tiltSpread: 0,
    lengthVariation: 0,
    colorVariation: 1,
  });
  const contactCanonical = canonical({
    id: "bristle-contact-angle",
    samples: [
      sample(1, 20, 48, 0.8),
      sample(2, 108, 48, 0.8),
    ],
    color: {
      space: "linear-srgb",
      alphaMode: "straight",
      components: [0.15, 0.75, 0.22, 0.58],
    },
  });
  const contactDynamics = dynamics({
    orientation: "stroke-direction",
    contactAngleRadians: Math.PI * 0.18,
  });
  const eraseBaseCanonical = canonical({
    id: "bristle-destination-out-base",
    samples: [
      sample(1, 18, 48, 0.95),
      sample(2, 110, 48, 0.95),
    ],
    color: {
      space: "linear-srgb",
      alphaMode: "straight",
      components: [0.08, 0.42, 0.9, 0.8],
    },
  });
  const eraseCanonical = canonical({
    id: "bristle-destination-out-eraser",
    samples: [
      sample(1, 64, 22, 1),
      sample(2, 64, 76, 1),
    ],
    composite: {
      porterDuff: "destination-out",
      blendMode: "normal",
      opacity: 0.72,
    },
    color: {
      space: "linear-srgb",
      alphaMode: "straight",
      components: [0, 0, 0, 0.72],
    },
  });

  const straightLowering = ready(straightCanonical, straightDynamics);
  const curveLowering = ready(curveCanonical, curveDynamics);
  const expressiveLowering = ready(expressiveCanonical, fanDynamics);
  const fixedLowering = ready(fixedCanonical, fixedDynamics);
  const affineLowering = ready(affineCanonical, affineDynamics);
  const identityAffineLowering = ready(identityAffineCanonical, affineDynamics);
  const contactLowering = ready(contactCanonical, contactDynamics);
  const eraseBaseLowering = ready(eraseBaseCanonical, straightDynamics);
  const eraseLowering = ready(eraseCanonical, straightDynamics, "append");
  const replayAppend = ready(curveCanonical, curveDynamics, "append");
  const replayRebuild = ready(curveCanonical, curveDynamics, "rebuild");

  const cases = await Promise.all([
    runCase(
      rawDevice,
      canvasFormat,
      shaderModules,
      "straight-rake",
      [straightLowering],
    ),
    runCase(
      rawDevice,
      canvasFormat,
      shaderModules,
      "curved-turn",
      [curveLowering],
    ),
    runCase(
      rawDevice,
      canvasFormat,
      shaderModules,
      "pressure-tilt-fan",
      [expressiveLowering],
    ),
    runCase(
      rawDevice,
      canvasFormat,
      shaderModules,
      "fixed-feature-scale",
      [fixedLowering],
    ),
    runCase(
      rawDevice,
      canvasFormat,
      shaderModules,
      "affine-reflection-shear-oklch",
      [affineLowering],
    ),
    runCase(
      rawDevice,
      canvasFormat,
      shaderModules,
      "contact-angle",
      [contactLowering],
    ),
    runCase(
      rawDevice,
      canvasFormat,
      shaderModules,
      "destination-out",
      [eraseBaseLowering, eraseLowering],
    ),
  ]);

  const appendRebuild = await appendRebuildEvidence(
    rawDevice,
    canvasFormat,
    shaderModules,
    replayAppend,
    replayRebuild,
  );
  const features = featureEvidence({
    straightCanonical,
    straightDynamics,
    curveCanonical,
    curveDynamics,
    neutralCanonical,
    expressiveCanonical,
    fanDynamics,
    fixedCanonical,
    fixedDynamics,
    affineCanonical,
    identityAffineCanonical,
    affineDynamics,
    affineLowering,
    identityAffineLowering,
    oklchLowering: affineLowering,
  });
  const preflight = preflightEvidence(straightCanonical, straightDynamics);
  const flow = await flowEvidence(
    rawDevice,
    canvasFormat,
    shaderModules,
    replayRebuild.plan,
    replayAppend.plan,
  );
  let resolveCallbackLoss!: (value: {
    readonly reason: string;
    readonly message: string;
  }) => void;
  const callbackLoss = new Promise<{
    readonly reason: string;
    readonly message: string;
  }>((resolve) => {
    resolveCallbackLoss = resolve;
  });
  const lossBoundary = await createRuntimeBoundary(
    rawDevice,
    canvasFormat,
    shaderModules,
    {
      onDeviceLost(info) {
        resolveCallbackLoss({
          reason: String(info.reason),
          message: info.message,
        });
      },
    },
  );
  const beforeLoss = await lossBoundary.runtime.execute(
    frame(1, replayRebuild.plan),
  );
  if (beforeLoss.status !== "presented") {
    throw new Error("device-loss baseline was rejected");
  }
  await waitForRuntime(lossBoundary.runtime, lossBoundary.runtime.stats().submissions);
  const shaders = await compileShaders(shaderModules);
  const outOfMemoryScope = await rawDevice.popErrorScope();
  const validationScope = await rawDevice.popErrorScope();
  const deviceLost = withTimeout(
    rawDevice.lost.then((info) => ({
      reason: String(info.reason),
      message: info.message,
    })),
    DEVICE_LOSS_TIMEOUT_MS,
    "GPUDevice.lost",
  );
  rawDevice.destroy();
  const [deviceInfo, callbackInfo] = await Promise.all([
    deviceLost,
    withTimeout(callbackLoss, DEVICE_LOSS_TIMEOUT_MS, "runtime onDeviceLost"),
  ]);
  await Promise.resolve();
  const rejectedAfterLoss = await lossBoundary.runtime.execute(
    frame(2, replayRebuild.plan),
  );
  const lossStats = lossBoundary.runtime.stats();
  const adapterInfo = adapter.info;

  return {
    status: "ok",
    backend: "professional-bristle-rgba16float-webgpu",
    width: WIDTH,
    height: HEIGHT,
    capabilities: observedCapabilities,
    provider: {
      kind: "real-chromium-webgpu-device-boundary",
      textureFormat: "rgba16float",
      readback: "aligned-rgba16float-map-read",
      bytesPerRow: nextAligned(WIDTH * RGBA16_BYTES_PER_PIXEL, ROW_ALIGNMENT),
      adapterInfo: {
        vendor: adapterInfo?.vendor ?? "",
        architecture: adapterInfo?.architecture ?? "",
        device: adapterInfo?.device ?? "",
        description: adapterInfo?.description ?? "",
        isFallbackAdapter:
          typeof adapterInfo?.isFallbackAdapter === "boolean"
            ? adapterInfo.isFallbackAdapter
            : null,
      },
      maxTextureDimension2D: Number(rawDevice.limits.maxTextureDimension2D),
    },
    tolerance: {
      cpuAbsolute: CPU_ABSOLUTE_TOLERANCE,
      outsideEdgeAbsolute: OUTSIDE_EDGE_ABSOLUTE_TOLERANCE,
    },
    cases,
    appendRebuild,
    features,
    preflight,
    flow,
    shaders,
    errorScopes: {
      validation: validationScope?.message ?? null,
      outOfMemory: outOfMemoryScope?.message ?? null,
    },
    uncapturedGpuErrors,
    deviceLoss: {
      trigger: "GPUDevice.destroy",
      deviceReason: deviceInfo.reason,
      deviceMessage: deviceInfo.message,
      callbackReason: callbackInfo.reason,
      callbackMessage: callbackInfo.message,
      runtimeStatus: lossStats.status,
      runtimeDeviceEpoch: lossStats.deviceEpoch,
      rejectedAfterLoss: rejectionReason(rejectedAfterLoss),
    },
  };
}

const observedCapabilities = capabilities();
void run().then(
  (result) => {
    window.__studioProfessionalBristleWebGpuResult = result;
  },
  (error: unknown) => {
    window.__studioProfessionalBristleWebGpuResult = {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack ?? null : null,
      capabilities: observedCapabilities,
    };
  },
);
