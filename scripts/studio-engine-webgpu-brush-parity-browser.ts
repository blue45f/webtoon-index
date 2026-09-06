/**
 * Real-browser golden-pixel entry for the rich worker-compatible WebGPU brush runtime.
 *
 * Loaded only by verify-studio-engine-webgpu-brush-parity.mjs's synthetic Vite document. The
 * first three cases intentionally use the branded legacy round-dab diagnostic oracle; every
 * production-facing case starts from a canonical brush plan, lowers it, adapts the lowering, and
 * only then executes the rich WebGPU runtime.
 *
 * Runtime receipts acknowledge ordered queue submission, not GPU completion. Every
 * transferToImageBitmap readback therefore waits until `completedSubmissionSequence` reaches the
 * exact submission observed for that receipt.
 */
import {
  adaptLoweredStudioCanonicalBrushWebGpuDabs,
  convertLegacyStudioGpuDabPlanToWebGpuDiagnosticOracle,
  createStudioEngineWebGpuBrushRuntime,
  fingerprintStudioEngineWebGpuBrushPlan,
  STUDIO_ENGINE_WEBGPU_BRUSH_COLOR_MODEL,
  STUDIO_ENGINE_WEBGPU_BRUSH_INPUT_COLOR_ENCODING,
  STUDIO_ENGINE_WEBGPU_BRUSH_PRESENTATION_COLOR_SPACE,
  STUDIO_ENGINE_WEBGPU_BRUSH_RECEIPT_REVISION,
  STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT,
  STUDIO_ENGINE_WEBGPU_BRUSH_WORKING_COLOR_SPACE,
  type StudioEngineWebGpuBrushFrame,
  type StudioEngineWebGpuBrushPlan,
  type StudioEngineWebGpuBrushReceipt,
  type StudioEngineWebGpuBrushRuntime,
  type StudioEngineWebGpuBrushSurface,
} from "../apps/web/src/domains/creator/render/studio-engine-webgpu-brush-runtime";
import {
  parseStudioCanonicalBrushPlan,
  type StudioCanonicalBrushAffineTransform,
} from "../apps/web/src/domains/creator/studio-canonical-brush-plan";
import {
  lowerStudioCanonicalBrushPlanToWebGpuDabs,
  type StudioCanonicalWebGpuAnalyticDab,
  type StudioCanonicalWebGpuAnalyticShape,
  type StudioCanonicalWebGpuPorterDuff,
} from "../apps/web/src/domains/creator/studio-canonical-brush-webgpu-lowering";

import type {
  StudioGpuDab,
  StudioGpuDabRenderUpdate,
} from "../apps/web/src/domains/creator/render/studio-webgpu-dab-plan-contract";

const WIDTH = 96;
const HEIGHT = 72;
const INITIAL_RESIZE_EPOCH = 17;
const RESIZED_EPOCH = 18;
const QUEUE_FENCE_TIMEOUT_MS = 10_000;
const DEVICE_LOSS_TIMEOUT_MS = 5_000;
const EDGE_BAND_PIXELS = 2.5;

type UnsupportedReason =
  | "adapter-request-failed"
  | "adapter-unavailable"
  | "context-unavailable"
  | "device-request-failed"
  | "offscreen-canvas-unavailable"
  | "webgpu-unavailable";

type PlanSource =
  | "canonical-lowering-adapter"
  | "legacy-diagnostic-oracle";

interface SerializableAdapterInfo {
  readonly vendor: string;
  readonly architecture: string;
  readonly device: string;
  readonly description: string;
  readonly isFallbackAdapter: boolean | null;
}

interface BrowserCapabilities {
  readonly offscreenCanvas: boolean;
  readonly transferToImageBitmap: boolean;
  readonly webgpu: boolean;
  readonly userAgent: string;
}

interface ProviderEvidence {
  readonly kind: "real-chromium-webgpu-device-boundary";
  readonly canvasFormat: GPUTextureFormat;
  readonly adapterInfo: SerializableAdapterInfo;
  readonly maxTextureDimension2D: number;
  readonly surface: "OffscreenCanvas";
}

interface RawPixelDiff {
  readonly changedPixels: number;
  readonly totalPixels: number;
  readonly maxChannelDelta: number;
  readonly maxAlphaDelta: number;
  readonly maxPremultipliedChannelDelta: number;
  readonly totalAbsoluteDelta: number;
  readonly meanAbsoluteDelta: number;
  readonly meanPremultipliedAbsoluteDelta: number;
}

interface PixelParityMetrics {
  readonly exact: RawPixelDiff;
  readonly tolerance2: RawPixelDiff;
  readonly edgeBandPixels: number;
  readonly outsideEdgeBandTolerance2: RawPixelDiff;
}

interface QueueFenceEvidence {
  readonly submittedSubmissionSequence: number;
  readonly completedSubmissionSequence: number;
  readonly inFlightSubmissions: number;
  readonly maxInFlightSubmissions: number;
}

interface ReadbackEvidence extends QueueFenceEvidence {
  readonly kind: "offscreen-presentation-readback";
  readonly requestSequence: number;
  readonly resizeEpoch: number;
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
}

interface GoldenSampleResult {
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly expected: readonly [number, number, number, number];
  readonly cpu: readonly [number, number, number, number];
  readonly gpu: readonly [number, number, number, number];
  readonly maxCpuExpectedDelta: number;
  readonly maxGpuExpectedDelta: number;
}

interface PlanSummary {
  readonly strokeId: string;
  readonly loweringVersion: number;
  readonly shapes: readonly StudioCanonicalWebGpuAnalyticShape[];
  readonly hardness: readonly number[];
  readonly edgeSoftness: readonly number[];
  readonly bases: readonly (readonly [number, number, number, number])[];
  readonly porterDuffOrder: readonly StudioCanonicalWebGpuPorterDuff[];
}

interface BrowserParityCaseResult {
  readonly id: string;
  readonly planSource: PlanSource;
  readonly plan: PlanSummary;
  readonly receipt: StudioEngineWebGpuBrushReceipt;
  readonly readback: Omit<ReadbackEvidence, "pixels">;
  readonly metrics: PixelParityMetrics;
  readonly samples: readonly GoldenSampleResult[];
  readonly cpuPng: string;
  readonly webgpuPng: string;
  readonly diffPng: string;
}

interface AppendRebuildEvidence {
  readonly appendRequestSequence: number;
  readonly rebuildRequestSequence: number;
  readonly resizeEpoch: number;
  readonly exact: RawPixelDiff;
  readonly diffPng: string;
}

type DeviceLossEvidence =
  | {
      readonly status: "observed";
      readonly trigger: "GPUDevice.destroy";
      readonly deviceReason: string;
      readonly callbackReason: string;
      readonly callbackMessage: string;
      readonly runtimeStatus: "device-lost";
      readonly deviceEpoch: number;
      readonly rejectedExecutionReason: "device-lost";
    }
  | {
      readonly status: "not-probed";
      readonly reason: "GPUDevice.destroy is unavailable";
    };

type BrowserParityResult =
  | {
      readonly status: "ok";
      readonly backend: "webgpu";
      readonly width: number;
      readonly height: number;
      readonly capabilities: BrowserCapabilities;
      readonly provider: ProviderEvidence;
      readonly cases: readonly BrowserParityCaseResult[];
      readonly appendRebuild: AppendRebuildEvidence;
      readonly deviceLoss: DeviceLossEvidence;
      readonly uncapturedGpuErrors: readonly string[];
    }
  | {
      readonly status: "unsupported";
      readonly reason: UnsupportedReason;
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
    __studioEngineWebGpuBrushParityResult?: BrowserParityResult;
  }
}

interface RealWebGpuBoundary {
  readonly adapter: GPUAdapter;
  readonly device: GPUDevice;
  readonly context: GPUCanvasContext;
  readonly canvasFormat: GPUTextureFormat;
}

interface GoldenSample {
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly expected: readonly [number, number, number, number];
}

interface CanonicalPlanInput {
  readonly strokeId: string;
  readonly mode: "append" | "rebuild";
  readonly samples: readonly {
    readonly x: number;
    readonly y: number;
    readonly pressure?: number;
  }[];
  readonly color: readonly [number, number, number, number];
  readonly shape?: StudioCanonicalWebGpuAnalyticShape;
  readonly size?: number;
  readonly hardness?: number;
  readonly edgeSoftness?: number;
  readonly roundness?: number;
  readonly angleRadians?: number;
  readonly spacingRatio?: number;
  readonly flow?: number;
  readonly opacity?: number;
  readonly porterDuff?: StudioCanonicalWebGpuPorterDuff;
  readonly transform?: StudioCanonicalBrushAffineTransform;
}

interface MetricEvaluation {
  readonly metric: number;
  readonly fwidth: number;
  readonly antialias: number;
  readonly innerEdge: number;
  readonly coverage: number;
}

function capabilities(): BrowserCapabilities {
  return {
    offscreenCanvas: typeof OffscreenCanvas !== "undefined",
    transferToImageBitmap:
      typeof OffscreenCanvas !== "undefined"
      && typeof OffscreenCanvas.prototype.transferToImageBitmap === "function",
    webgpu: typeof navigator !== "undefined" && navigator.gpu !== undefined,
    userAgent: navigator.userAgent,
  };
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

/**
 * Rich CPU metric matching the shader's basis, shape, hardness, and edge-softness semantics.
 * fwidth is estimated analytically in document-pixel coordinates; implementation-specific raster
 * quad differences are isolated by the transition-band budget.
 */
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

function rasterCpuOracle(
  dabs: readonly StudioCanonicalWebGpuAnalyticDab[],
  width: number,
  height: number,
): Uint8ClampedArray {
  const linearPremultiplied = new Float64Array(width * height * 4);
  for (const dab of dabs) {
    const [sourceRed, sourceGreen, sourceBlue, sourceBaseAlpha] = dab.color.components;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const sourceAlpha = clamp01(
          sourceBaseAlpha * evaluateMetric(dab, x, y).coverage,
        );
        if (sourceAlpha <= 0) continue;
        const destinationFactor = 1 - sourceAlpha;
        const offset = (y * width + x) * 4;
        if (dab.composite.porterDuff === "destination-out") {
          linearPremultiplied[offset] *= destinationFactor;
          linearPremultiplied[offset + 1] *= destinationFactor;
          linearPremultiplied[offset + 2] *= destinationFactor;
          linearPremultiplied[offset + 3] *= destinationFactor;
        } else {
          linearPremultiplied[offset] =
            sourceRed * sourceAlpha + linearPremultiplied[offset] * destinationFactor;
          linearPremultiplied[offset + 1] =
            sourceGreen * sourceAlpha + linearPremultiplied[offset + 1] * destinationFactor;
          linearPremultiplied[offset + 2] =
            sourceBlue * sourceAlpha + linearPremultiplied[offset + 2] * destinationFactor;
          linearPremultiplied[offset + 3] =
            sourceAlpha + linearPremultiplied[offset + 3] * destinationFactor;
        }
      }
    }
  }

  const presented = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < linearPremultiplied.length; offset += 4) {
    const alpha = clamp01(linearPremultiplied[offset + 3]!);
    if (alpha > 0) {
      presented[offset] = byte(linearToSrgb(linearPremultiplied[offset]! / alpha));
      presented[offset + 1] = byte(linearToSrgb(linearPremultiplied[offset + 1]! / alpha));
      presented[offset + 2] = byte(linearToSrgb(linearPremultiplied[offset + 2]! / alpha));
    }
    presented[offset + 3] = byte(alpha);
  }
  return presented;
}

function goldenPixelForFullCoverage(
  dabs: readonly StudioCanonicalWebGpuAnalyticDab[],
): readonly [number, number, number, number] {
  let red = 0;
  let green = 0;
  let blue = 0;
  let alpha = 0;
  for (const dab of dabs) {
    const [sourceRed, sourceGreen, sourceBlue, sourceAlpha] = dab.color.components;
    const destinationFactor = 1 - sourceAlpha;
    if (dab.composite.porterDuff === "destination-out") {
      red *= destinationFactor;
      green *= destinationFactor;
      blue *= destinationFactor;
      alpha *= destinationFactor;
    } else {
      red = sourceRed * sourceAlpha + red * destinationFactor;
      green = sourceGreen * sourceAlpha + green * destinationFactor;
      blue = sourceBlue * sourceAlpha + blue * destinationFactor;
      alpha = sourceAlpha + alpha * destinationFactor;
    }
  }
  return alpha <= 0
    ? [0, 0, 0, 0]
    : [
        byte(linearToSrgb(red / alpha)),
        byte(linearToSrgb(green / alpha)),
        byte(linearToSrgb(blue / alpha)),
        byte(alpha),
      ];
}

function legacyUpdate(
  mode: "append" | "rebuild",
  dabs: readonly StudioGpuDab[],
): StudioGpuDabRenderUpdate {
  const batches: StudioGpuDabRenderUpdate["batches"] = [];
  for (let index = 0; index < dabs.length;) {
    const composite = dabs[index]!.composite;
    let end = index + 1;
    while (end < dabs.length && dabs[end]!.composite === composite) end += 1;
    batches.push({
      composite,
      firstInstance: index,
      instanceCount: end - index,
    });
    index = end;
  }
  return {
    mode,
    dabs: dabs.map((dab) => ({ ...dab })),
    batches,
    complete: true,
  };
}

function diagnosticPlan(
  mode: "append" | "rebuild",
  dabs: readonly StudioGpuDab[],
): StudioEngineWebGpuBrushPlan {
  return convertLegacyStudioGpuDabPlanToWebGpuDiagnosticOracle(
    legacyUpdate(mode, dabs),
  ).plan;
}

function constantCurve(): {
  readonly minimum: 1;
  readonly maximum: 1;
  readonly exponent: 1;
} {
  return { minimum: 1, maximum: 1, exponent: 1 };
}

function canonicalPlan(input: CanonicalPlanInput): StudioEngineWebGpuBrushPlan {
  const candidate = {
    kind: "studio-canonical-brush-plan",
    version: 1,
    sessionEpoch: 1,
    strokeEpoch: 1,
    commandSequence: 1,
    strokeId: input.strokeId,
    seed: 0x51f1_5e7,
    coordinateSpace: "document-css-px",
    transform: input.transform ?? {
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
      components: [...input.color],
    },
    composite: {
      porterDuff: input.porterDuff ?? "source-over",
      blendMode: "normal",
      opacity: input.opacity ?? 1,
    },
    recipe: {
      version: 1,
      brushId: input.strokeId,
      engine: "dab-v1",
      material: input.porterDuff === "destination-out" ? "eraser" : "ink",
      tip: {
        kind: "analytic",
        shape: input.shape ?? "round",
        edgeSoftness: input.edgeSoftness ?? 0,
      },
      size: input.size ?? 24,
      flow: input.flow ?? 1,
      hardness: input.hardness ?? 1,
      spacingRatio: input.spacingRatio ?? 0.5,
      scatter: {
        radiusRatio: 0,
        distribution: "uniform-disk",
      },
      angleRadians: input.angleRadians ?? 0,
      roundness: input.roundness ?? 1,
      pressure: {
        size: constantCurve(),
        opacity: constantCurve(),
        flow: constantCurve(),
      },
      grain: null,
      wetMedia: null,
    },
    source: {
      encoding: "accepted-authoritative-samples-v1",
      firstSequence: 1,
      lastSequence: input.samples.length,
      samples: input.samples.map((sample, index) => ({
        role: "authoritative",
        sequence: index + 1,
        x: sample.x,
        y: sample.y,
        pressure: sample.pressure ?? 1,
        tangentialPressure: 0,
        tiltX: 0,
        tiltY: 0,
        twist: 0,
        timeMilliseconds: index + 1,
        pointerId: 1,
        flags: 0,
      })),
    },
  };
  const parsed = parseStudioCanonicalBrushPlan(candidate, {
    sessionEpoch: 1,
    strokeEpoch: 1,
    lastAcceptedCommandSequence: 0,
  });
  if (!parsed.ok) {
    throw new Error(
      `[${input.strokeId}] canonical parse failed: ${parsed.reason}/${parsed.path}`,
    );
  }
  const lowering = lowerStudioCanonicalBrushPlanToWebGpuDabs(parsed.value.plan);
  if (lowering.status !== "lowered") {
    throw new Error(`[${input.strokeId}] canonical lowering returned ${lowering.status}`);
  }
  const adaptation = adaptLoweredStudioCanonicalBrushWebGpuDabs(input.mode, lowering);
  if (adaptation.status !== "ready") {
    throw new Error(`[${input.strokeId}] runtime adaptation returned ${adaptation.status}`);
  }
  return adaptation.plan;
}

function createFrame(
  requestSequence: number,
  resizeEpoch: number,
  update: StudioEngineWebGpuBrushPlan,
): StudioEngineWebGpuBrushFrame {
  return {
    requestSequence,
    resizeEpoch,
    rasterRect: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
    update,
  };
}

function compareRawRgba(
  first: Uint8ClampedArray,
  second: Uint8ClampedArray,
  tolerance = 0,
  included?: Uint8Array,
): RawPixelDiff {
  if (first.length !== second.length || first.length % 4 !== 0) {
    throw new Error("Pixel buffer dimensions do not match");
  }
  let changedPixels = 0;
  let totalPixels = 0;
  let maxChannelDelta = 0;
  let maxAlphaDelta = 0;
  let maxPremultipliedChannelDelta = 0;
  let totalAbsoluteDelta = 0;
  let totalPremultipliedAbsoluteDelta = 0;
  for (let offset = 0; offset < first.length; offset += 4) {
    const pixelIndex = offset / 4;
    if (included && included[pixelIndex] !== 1) continue;
    totalPixels += 1;
    let pixelDelta = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(first[offset + channel]! - second[offset + channel]!);
      pixelDelta = Math.max(pixelDelta, delta);
      maxChannelDelta = Math.max(maxChannelDelta, delta);
      totalAbsoluteDelta += delta;
      if (channel === 3) maxAlphaDelta = Math.max(maxAlphaDelta, delta);
    }
    for (let channel = 0; channel < 3; channel += 1) {
      const firstPremultiplied = Math.round(
        (first[offset + channel]! * first[offset + 3]!) / 255,
      );
      const secondPremultiplied = Math.round(
        (second[offset + channel]! * second[offset + 3]!) / 255,
      );
      const delta = Math.abs(firstPremultiplied - secondPremultiplied);
      maxPremultipliedChannelDelta = Math.max(
        maxPremultipliedChannelDelta,
        delta,
      );
      totalPremultipliedAbsoluteDelta += delta;
    }
    totalPremultipliedAbsoluteDelta += Math.abs(
      first[offset + 3]! - second[offset + 3]!,
    );
    if (pixelDelta > tolerance) changedPixels += 1;
  }
  return {
    changedPixels,
    totalPixels,
    maxChannelDelta,
    maxAlphaDelta,
    maxPremultipliedChannelDelta,
    totalAbsoluteDelta,
    meanAbsoluteDelta: totalPixels === 0 ? 0 : totalAbsoluteDelta / (totalPixels * 4),
    meanPremultipliedAbsoluteDelta:
      totalPixels === 0
        ? 0
        : totalPremultipliedAbsoluteDelta / (totalPixels * 4),
  };
}

function outsideEdgeBandMask(
  dabs: readonly StudioCanonicalWebGpuAnalyticDab[],
  width: number,
  height: number,
): { readonly mask: Uint8Array; readonly edgeBandPixels: number } {
  const mask = new Uint8Array(width * height);
  let edgeBandPixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      const inTransitionBand = dabs.some((dab) => {
        const evaluation = evaluateMetric(dab, x, y);
        const implementationMargin =
          EDGE_BAND_PIXELS * Math.max(evaluation.fwidth, 0.0005);
        return evaluation.metric
          >= evaluation.innerEdge - evaluation.antialias - implementationMargin
          && evaluation.metric
          <= 1 + evaluation.antialias + implementationMargin;
      });
      if (inTransitionBand) edgeBandPixels += 1;
      else mask[pixelIndex] = 1;
    }
  }
  return { mask, edgeBandPixels };
}

function parityMetrics(
  cpu: Uint8ClampedArray,
  gpu: Uint8ClampedArray,
  dabs: readonly StudioCanonicalWebGpuAnalyticDab[],
  width: number,
  height: number,
): PixelParityMetrics {
  const { mask, edgeBandPixels } = outsideEdgeBandMask(dabs, width, height);
  return {
    exact: compareRawRgba(cpu, gpu),
    tolerance2: compareRawRgba(cpu, gpu, 2),
    edgeBandPixels,
    outsideEdgeBandTolerance2: compareRawRgba(cpu, gpu, 2, mask),
  };
}

function pixelsToPngDataUrl(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas2D is unavailable for PNG encoding");
  const copy = new Uint8ClampedArray(pixels.length);
  copy.set(pixels);
  context.putImageData(new ImageData(copy, width, height), 0, 0);
  return canvas.toDataURL("image/png");
}

function diffPngDataUrl(
  first: Uint8ClampedArray,
  second: Uint8ClampedArray,
  width: number,
  height: number,
): string {
  const pixels = new Uint8ClampedArray(first.length);
  for (let offset = 0; offset < first.length; offset += 4) {
    const redDelta = Math.abs(first[offset]! - second[offset]!);
    const greenDelta = Math.abs(first[offset + 1]! - second[offset + 1]!);
    const blueDelta = Math.abs(first[offset + 2]! - second[offset + 2]!);
    const alphaDelta = Math.abs(first[offset + 3]! - second[offset + 3]!);
    pixels[offset] = Math.max(redDelta, alphaDelta);
    pixels[offset + 1] = greenDelta;
    pixels[offset + 2] = Math.max(blueDelta, alphaDelta);
    pixels[offset + 3] = Math.max(redDelta, greenDelta, blueDelta, alphaDelta);
  }
  return pixelsToPngDataUrl(pixels, width, height);
}

function pixelAt(
  pixels: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
): readonly [number, number, number, number] {
  const offset = (y * width + x) * 4;
  return [
    pixels[offset]!,
    pixels[offset + 1]!,
    pixels[offset + 2]!,
    pixels[offset + 3]!,
  ];
}

function maxTupleDelta(
  first: readonly number[],
  second: readonly number[],
): number {
  return Math.max(...first.map((value, index) => Math.abs(value - second[index]!)));
}

function goldenSamples(
  samples: readonly GoldenSample[],
  cpu: Uint8ClampedArray,
  gpu: Uint8ClampedArray,
  width: number,
): readonly GoldenSampleResult[] {
  return samples.map((sample) => {
    const cpuPixel = pixelAt(cpu, width, sample.x, sample.y);
    const gpuPixel = pixelAt(gpu, width, sample.x, sample.y);
    return {
      ...sample,
      cpu: cpuPixel,
      gpu: gpuPixel,
      maxCpuExpectedDelta: maxTupleDelta(cpuPixel, sample.expected),
      maxGpuExpectedDelta: maxTupleDelta(gpuPixel, sample.expected),
    };
  });
}

function summarizePlan(plan: StudioEngineWebGpuBrushPlan): PlanSummary {
  return {
    strokeId: plan.strokeId,
    loweringVersion: plan.loweringVersion,
    shapes: plan.dabs.map((dab) => dab.tip.shape),
    hardness: plan.dabs.map((dab) => dab.tip.hardness),
    edgeSoftness: plan.dabs.map((dab) => dab.tip.edgeSoftness),
    bases: plan.dabs.map((dab) => [...dab.tip.localToDocument]),
    porterDuffOrder: plan.batches.map((batch) => batch.composite.porterDuff),
  };
}

function serializableAdapterInfo(adapter: GPUAdapter): SerializableAdapterInfo {
  const info = adapter.info as unknown as Partial<SerializableAdapterInfo>;
  return {
    vendor: typeof info.vendor === "string" ? info.vendor : "",
    architecture: typeof info.architecture === "string" ? info.architecture : "",
    device: typeof info.device === "string" ? info.device : "",
    description: typeof info.description === "string" ? info.description : "",
    isFallbackAdapter:
      typeof info.isFallbackAdapter === "boolean" ? info.isFallbackAdapter : null,
  };
}

async function acquireRealWebGpuBoundary(
  surface: OffscreenCanvas,
): Promise<
  | { readonly status: "ready"; readonly boundary: RealWebGpuBoundary }
  | {
      readonly status: "unsupported";
      readonly reason: UnsupportedReason;
      readonly message: string;
    }
> {
  if (!navigator.gpu) {
    return {
      status: "unsupported",
      reason: "webgpu-unavailable",
      message: "navigator.gpu is unavailable in this Chromium context",
    };
  }
  let adapter: GPUAdapter | null;
  try {
    adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  } catch (error: unknown) {
    return {
      status: "unsupported",
      reason: "adapter-request-failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  if (!adapter) {
    return {
      status: "unsupported",
      reason: "adapter-unavailable",
      message: "navigator.gpu.requestAdapter returned null",
    };
  }
  let device: GPUDevice;
  try {
    device = await adapter.requestDevice();
  } catch (error: unknown) {
    return {
      status: "unsupported",
      reason: "device-request-failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const gpuSurface = surface as unknown as StudioEngineWebGpuBrushSurface;
  const context = gpuSurface.getContext("webgpu");
  if (!context) {
    device.destroy();
    return {
      status: "unsupported",
      reason: "context-unavailable",
      message: "OffscreenCanvas.getContext(\"webgpu\") returned null",
    };
  }
  return {
    status: "ready",
    boundary: {
      adapter,
      device,
      context,
      canvasFormat: navigator.gpu.getPreferredCanvasFormat(),
    },
  };
}

function validateProviderReceipt(
  frame: StudioEngineWebGpuBrushFrame,
  receipt: StudioEngineWebGpuBrushReceipt,
  width: number,
  height: number,
): void {
  const expectedBatchOrder = frame.update.batches.map(
    (batch) => batch.composite.porterDuff,
  );
  if (
    receipt.kind !== "studio-engine-webgpu-brush-receipt"
    || receipt.revision !== STUDIO_ENGINE_WEBGPU_BRUSH_RECEIPT_REVISION
    || receipt.backend !== "webgpu"
    || receipt.requestSequence !== frame.requestSequence
    || receipt.resizeEpoch !== frame.resizeEpoch
    || receipt.deviceEpoch !== 1
    || receipt.width !== width
    || receipt.height !== height
    || receipt.textureFormat !== STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT
    || receipt.colorModel !== STUDIO_ENGINE_WEBGPU_BRUSH_COLOR_MODEL
    || receipt.workingColorSpace !== STUDIO_ENGINE_WEBGPU_BRUSH_WORKING_COLOR_SPACE
    || receipt.inputColorEncoding !== STUDIO_ENGINE_WEBGPU_BRUSH_INPUT_COLOR_ENCODING
    || receipt.presentationColorSpace
      !== STUDIO_ENGINE_WEBGPU_BRUSH_PRESENTATION_COLOR_SPACE
    || receipt.mode !== frame.update.mode
    || receipt.strokeId !== frame.update.strokeId
    || receipt.loweringVersion !== frame.update.loweringVersion
    || receipt.dabCount !== frame.update.dabs.length
    || receipt.batchCount !== frame.update.batches.length
    || JSON.stringify(receipt.batchOrder) !== JSON.stringify(expectedBatchOrder)
    || receipt.planFingerprint !== fingerprintStudioEngineWebGpuBrushPlan(frame)
    || receipt.queueState !== "submitted"
    || receipt.complete !== true
  ) {
    throw new Error(
      `[request ${frame.requestSequence}] provider receipt does not echo the rich frame contract`,
    );
  }
  const serialized = JSON.parse(JSON.stringify(receipt)) as StudioEngineWebGpuBrushReceipt;
  if (JSON.stringify(serialized) !== JSON.stringify(receipt)) {
    throw new Error(`[request ${frame.requestSequence}] provider receipt is not pure JSON`);
  }
  if (
    Object.keys(receipt).includes("device")
    || Object.keys(receipt).includes("context")
  ) {
    throw new Error(`[request ${frame.requestSequence}] provider receipt leaked runtime handles`);
  }
}

async function waitForQueueFence(
  runtime: StudioEngineWebGpuBrushRuntime,
  submittedSubmissionSequence: number,
): Promise<QueueFenceEvidence> {
  const deadline = performance.now() + QUEUE_FENCE_TIMEOUT_MS;
  while (performance.now() <= deadline) {
    const stats = runtime.stats();
    if (stats.status !== "ready") {
      throw new Error(
        `runtime became ${stats.status} while fencing submission ${submittedSubmissionSequence}`,
      );
    }
    if (stats.completedSubmissionSequence >= submittedSubmissionSequence) {
      return {
        submittedSubmissionSequence,
        completedSubmissionSequence: stats.completedSubmissionSequence,
        inFlightSubmissions: stats.inFlightSubmissions,
        maxInFlightSubmissions: stats.maxInFlightSubmissions,
      };
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }
  throw new Error(
    `submission ${submittedSubmissionSequence} did not reach the runtime fence within `
    + `${QUEUE_FENCE_TIMEOUT_MS} ms`,
  );
}

async function readPresentedSurface(
  surface: OffscreenCanvas,
  receipt: StudioEngineWebGpuBrushReceipt,
  queueFence: QueueFenceEvidence,
): Promise<ReadbackEvidence> {
  if (
    queueFence.completedSubmissionSequence
      < queueFence.submittedSubmissionSequence
    || queueFence.inFlightSubmissions !== 0
  ) {
    throw new Error(
      `[request ${receipt.requestSequence}] attempted readback before its GPU queue fence`,
    );
  }
  const bitmap = surface.transferToImageBitmap();
  try {
    const canvas = document.createElement("canvas");
    canvas.width = receipt.width;
    canvas.height = receipt.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas2D is unavailable for OffscreenCanvas readback");
    context.clearRect(0, 0, receipt.width, receipt.height);
    context.drawImage(bitmap, 0, 0);
    return {
      kind: "offscreen-presentation-readback",
      requestSequence: receipt.requestSequence,
      resizeEpoch: receipt.resizeEpoch,
      width: receipt.width,
      height: receipt.height,
      ...queueFence,
      pixels: new Uint8ClampedArray(
        context.getImageData(0, 0, receipt.width, receipt.height).data,
      ),
    };
  } finally {
    bitmap.close();
  }
}

function validateReadbackEpochs(
  receipt: StudioEngineWebGpuBrushReceipt,
  readback: ReadbackEvidence,
): void {
  if (
    readback.requestSequence !== receipt.requestSequence
    || readback.resizeEpoch !== receipt.resizeEpoch
    || readback.width !== receipt.width
    || readback.height !== receipt.height
    || readback.completedSubmissionSequence
      < readback.submittedSubmissionSequence
    || readback.inFlightSubmissions !== 0
  ) {
    throw new Error(
      `[request ${receipt.requestSequence}] fenced readback does not match its provider receipt`,
    );
  }
}

async function executeCase(
  runtime: StudioEngineWebGpuBrushRuntime,
  surface: OffscreenCanvas,
  id: string,
  planSource: PlanSource,
  frame: StudioEngineWebGpuBrushFrame,
  oracleDabs: readonly StudioCanonicalWebGpuAnalyticDab[],
  samples: readonly GoldenSample[],
): Promise<{ readonly result: BrowserParityCaseResult; readonly pixels: Uint8ClampedArray }> {
  const submissionsBefore = runtime.stats().submissions;
  const execution = await runtime.execute(frame);
  if (execution.status !== "presented") {
    throw new Error(`[${id}] runtime rejected the real WebGPU frame: ${execution.reason}`);
  }
  validateProviderReceipt(frame, execution.receipt, WIDTH, HEIGHT);
  const submittedSubmissionSequence = runtime.stats().submissions;
  if (submittedSubmissionSequence !== submissionsBefore + 1) {
    throw new Error(`[${id}] runtime submission counter did not advance exactly once`);
  }
  const queueFence = await waitForQueueFence(runtime, submittedSubmissionSequence);
  const readback = await readPresentedSurface(surface, execution.receipt, queueFence);
  validateReadbackEpochs(execution.receipt, readback);
  const cpu = rasterCpuOracle(oracleDabs, WIDTH, HEIGHT);
  return {
    result: {
      id,
      planSource,
      plan: summarizePlan(frame.update),
      receipt: execution.receipt,
      readback: {
        kind: readback.kind,
        requestSequence: readback.requestSequence,
        resizeEpoch: readback.resizeEpoch,
        width: readback.width,
        height: readback.height,
        submittedSubmissionSequence: readback.submittedSubmissionSequence,
        completedSubmissionSequence: readback.completedSubmissionSequence,
        inFlightSubmissions: readback.inFlightSubmissions,
        maxInFlightSubmissions: readback.maxInFlightSubmissions,
      },
      metrics: parityMetrics(cpu, readback.pixels, oracleDabs, WIDTH, HEIGHT),
      samples: goldenSamples(samples, cpu, readback.pixels, WIDTH),
      cpuPng: pixelsToPngDataUrl(cpu, WIDTH, HEIGHT),
      webgpuPng: pixelsToPngDataUrl(readback.pixels, WIDTH, HEIGHT),
      diffPng: diffPngDataUrl(cpu, readback.pixels, WIDTH, HEIGHT),
    },
    pixels: readback.pixels,
  };
}

function timeout<Value>(
  promise: Promise<Value>,
  milliseconds: number,
  label: string,
): Promise<Value> {
  return new Promise<Value>((resolve, reject) => {
    const handle = window.setTimeout(
      () => reject(new Error(`${label} timed out after ${milliseconds} ms`)),
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

async function observeActualDeviceLoss(
  runtime: StudioEngineWebGpuBrushRuntime,
  device: GPUDevice,
  callbackLoss: Promise<{ readonly reason: string; readonly message: string }>,
  lastFrame: StudioEngineWebGpuBrushFrame,
): Promise<DeviceLossEvidence> {
  if (typeof device.destroy !== "function") {
    return { status: "not-probed", reason: "GPUDevice.destroy is unavailable" };
  }
  const deviceLoss = timeout(
    device.lost.then((info) => ({ reason: String(info.reason), message: info.message })),
    DEVICE_LOSS_TIMEOUT_MS,
    "GPUDevice.lost",
  );
  device.destroy();
  const [deviceInfo, callbackInfo] = await Promise.all([
    deviceLoss,
    timeout(callbackLoss, DEVICE_LOSS_TIMEOUT_MS, "runtime onDeviceLost callback"),
  ]);
  await Promise.resolve();
  const stats = runtime.stats();
  if (stats.status !== "device-lost" || stats.deviceEpoch !== 2) {
    throw new Error(
      `actual device loss did not invalidate runtime resources (status=${stats.status}, epoch=${stats.deviceEpoch})`,
    );
  }
  const rejected = await runtime.execute({
    ...lastFrame,
    requestSequence: lastFrame.requestSequence + 1,
  });
  if (rejected.status !== "rejected" || rejected.reason !== "device-lost") {
    throw new Error("runtime accepted work after actual GPUDevice loss");
  }
  return {
    status: "observed",
    trigger: "GPUDevice.destroy",
    deviceReason: deviceInfo.reason,
    callbackReason: callbackInfo.reason,
    callbackMessage: callbackInfo.message,
    runtimeStatus: stats.status,
    deviceEpoch: stats.deviceEpoch,
    rejectedExecutionReason: rejected.reason,
  };
}

function assertRichPlan(
  label: string,
  plan: StudioEngineWebGpuBrushPlan,
  expected: {
    readonly shape: StudioCanonicalWebGpuAnalyticShape;
    readonly hardness?: number;
    readonly edgeSoftness?: number;
    readonly affine?: boolean;
  },
): void {
  if (plan.dabs.length === 0) throw new Error(`[${label}] canonical lowering emitted no dabs`);
  for (const dab of plan.dabs) {
    if (dab.tip.shape !== expected.shape) {
      throw new Error(`[${label}] shape was not preserved through lowering`);
    }
    if (
      expected.hardness !== undefined
      && Math.abs(dab.tip.hardness - expected.hardness) > 1e-6
    ) throw new Error(`[${label}] hardness was not preserved through lowering`);
    if (
      expected.edgeSoftness !== undefined
      && Math.abs(dab.tip.edgeSoftness - expected.edgeSoftness) > 1e-6
    ) throw new Error(`[${label}] edgeSoftness was not preserved through lowering`);
    if (expected.affine) {
      const [xx, xy, yx, yy] = dab.tip.localToDocument;
      if (Math.abs(xy) < 0.01 && Math.abs(yx) < 0.01 && Math.abs(xx - yy) < 0.01) {
        throw new Error(`[${label}] affine footprint collapsed to an axis-aligned circle`);
      }
    }
  }
}

async function run(): Promise<BrowserParityResult> {
  const observedCapabilities = capabilities();
  if (!observedCapabilities.offscreenCanvas || !observedCapabilities.transferToImageBitmap) {
    return {
      status: "unsupported",
      reason: "offscreen-canvas-unavailable",
      message: "OffscreenCanvas.transferToImageBitmap is unavailable",
      capabilities: observedCapabilities,
    };
  }

  const surface = new OffscreenCanvas(WIDTH, HEIGHT);
  const gpuSurface = surface as unknown as StudioEngineWebGpuBrushSurface;
  const acquired = await acquireRealWebGpuBoundary(surface);
  if (acquired.status === "unsupported") {
    return {
      status: "unsupported",
      reason: acquired.reason,
      message: acquired.message,
      capabilities: observedCapabilities,
    };
  }

  const { adapter, device, context, canvasFormat } = acquired.boundary;
  const uncapturedGpuErrors: string[] = [];
  device.addEventListener("uncapturederror", (event) => {
    uncapturedGpuErrors.push(event.error.message);
  });
  let resolveCallbackLoss!: (value: { readonly reason: string; readonly message: string }) => void;
  const callbackLoss = new Promise<{ readonly reason: string; readonly message: string }>(
    (resolve) => {
      resolveCallbackLoss = resolve;
    },
  );
  const created = await createStudioEngineWebGpuBrushRuntime({
    surface: gpuSurface,
    boundary: {
      device,
      context,
      canvasFormat,
      ownsDevice: false,
    },
    initialResizeEpoch: INITIAL_RESIZE_EPOCH,
    maxInFlightSubmissions: 3,
    onDeviceLost(info) {
      resolveCallbackLoss({ reason: String(info.reason), message: info.message });
    },
  });
  if (created.status !== "ready") {
    device.destroy();
    throw new Error(
      `real WebGPU provider could not initialize brush runtime: ${created.status}/${created.reason}`,
    );
  }
  const { runtime } = created;

  try {
    const legacyNormal: StudioGpuDab = {
      x: 30.5,
      y: 36.5,
      radius: 12,
      red: linearToSrgb(0.25),
      green: linearToSrgb(0.5),
      blue: linearToSrgb(0.75),
      alpha: 0.75,
      composite: "normal",
    };
    const legacyOverlapFirst: StudioGpuDab = {
      x: 44.5,
      y: 36.5,
      radius: 14,
      red: linearToSrgb(1),
      green: linearToSrgb(0.04),
      blue: linearToSrgb(0.04),
      alpha: 0.5,
      composite: "normal",
    };
    const legacyOverlapSecond: StudioGpuDab = {
      x: 52.5,
      y: 36.5,
      radius: 14,
      red: linearToSrgb(0.04),
      green: linearToSrgb(0.04),
      blue: linearToSrgb(1),
      alpha: 0.5,
      composite: "normal",
    };
    const legacyEraseBase: StudioGpuDab = {
      x: 48.5,
      y: 36.5,
      radius: 16,
      red: linearToSrgb(0.12),
      green: linearToSrgb(0.65),
      blue: linearToSrgb(0.3),
      alpha: 0.8,
      composite: "normal",
    };
    const legacyEraser: StudioGpuDab = {
      x: 54.5,
      y: 36.5,
      radius: 8,
      red: 0,
      green: 0,
      blue: 0,
      alpha: 0.5,
      composite: "erase",
    };
    const diagnosticNormalPlan = diagnosticPlan("rebuild", [legacyNormal]);
    const diagnosticOverlapPlan = diagnosticPlan("rebuild", [
      legacyOverlapFirst,
      legacyOverlapSecond,
    ]);
    const diagnosticErasePlan = diagnosticPlan("rebuild", [
      legacyEraseBase,
      legacyEraser,
    ]);

    const appendCommon = {
      strokeId: "canonical-append-equivalence",
      color: [0.32, 0.62, 0.88, 0.55] as const,
      size: 24,
      shape: "round" as const,
      hardness: 1,
      edgeSoftness: 0,
      spacingRatio: 64,
    };
    const appendBasePlan = canonicalPlan({
      ...appendCommon,
      mode: "rebuild",
      samples: [{ x: 40.5, y: 36.5 }],
    });
    const appendDeltaPlan = canonicalPlan({
      ...appendCommon,
      mode: "append",
      samples: [{ x: 48.5, y: 36.5 }],
    });
    const appendRebuildPlan = canonicalPlan({
      ...appendCommon,
      mode: "rebuild",
      samples: [
        { x: 40.5, y: 36.5 },
        { x: 48.5, y: 36.5 },
      ],
    });
    if (
      appendBasePlan.dabs.length !== 1
      || appendDeltaPlan.dabs.length !== 1
      || appendRebuildPlan.dabs.length !== 2
    ) throw new Error("canonical append/rebuild lowering did not emit 1 + 1 = 2 dabs");

    const presentationPlan = canonicalPlan({
      strokeId: "canonical-linear-presentation",
      mode: "rebuild",
      samples: [{ x: 48.5, y: 36.5 }],
      color: [0.003, 0.18, 0.8, 0.375],
      size: 26,
    });
    const ellipsePlan = canonicalPlan({
      strokeId: "canonical-rotated-sheared-ellipse",
      mode: "rebuild",
      samples: [{ x: 0, y: 0 }],
      color: [0.78, 0.12, 0.24, 0.72],
      shape: "ellipse",
      size: 26,
      hardness: 0.82,
      edgeSoftness: 0.18,
      roundness: 0.48,
      angleRadians: 0.58,
      transform: {
        encoding: "affine-f64-v1",
        m11: 1.12,
        m12: 0.32,
        m21: 0.42,
        m22: 0.88,
        translateX: 28.5,
        translateY: 36.5,
      },
    });
    const squarePlan = canonicalPlan({
      strokeId: "canonical-square-tip",
      mode: "rebuild",
      samples: [{ x: 0, y: 0 }],
      color: [0.08, 0.7, 0.3, 0.78],
      shape: "square",
      size: 22,
      hardness: 0.9,
      edgeSoftness: 0.05,
      roundness: 0.72,
      angleRadians: -0.36,
      transform: {
        encoding: "affine-f64-v1",
        m11: 1,
        m12: 0,
        m21: 0,
        m22: 1,
        translateX: 70.5,
        translateY: 36.5,
      },
    });
    const softnessPlan = canonicalPlan({
      strokeId: "canonical-hardness-edge-softness",
      mode: "rebuild",
      samples: [{ x: 48.5, y: 36.5 }],
      color: [0.18, 0.34, 0.92, 0.68],
      shape: "round",
      size: 32,
      hardness: 0.45,
      edgeSoftness: 0.65,
    });
    const affinePlan = canonicalPlan({
      strokeId: "canonical-reflected-affine-footprint",
      mode: "rebuild",
      samples: [{ x: 0, y: 0 }],
      color: [0.88, 0.42, 0.06, 0.74],
      shape: "ellipse",
      size: 22,
      hardness: 0.76,
      edgeSoftness: 0.22,
      roundness: 0.64,
      angleRadians: -0.47,
      transform: {
        encoding: "affine-f64-v1",
        m11: -1.2,
        m12: 0.28,
        m21: 0.55,
        m22: 0.75,
        translateX: 48.5,
        translateY: 36.5,
      },
    });
    assertRichPlan("rotated/sheared ellipse", ellipsePlan, {
      shape: "ellipse",
      affine: true,
    });
    assertRichPlan("square", squarePlan, { shape: "square" });
    assertRichPlan("hardness/edgeSoftness", softnessPlan, {
      shape: "round",
      hardness: 0.45,
      edgeSoftness: 0.65,
    });
    assertRichPlan("affine footprint", affinePlan, {
      shape: "ellipse",
      affine: true,
    });

    const transparent = [0, 0, 0, 0] as const;
    const cases: BrowserParityCaseResult[] = [];
    const diagnosticNormal = await executeCase(
      runtime,
      surface,
      "diagnostic-round-normal",
      "legacy-diagnostic-oracle",
      createFrame(101, INITIAL_RESIZE_EPOCH, diagnosticNormalPlan),
      diagnosticNormalPlan.dabs,
      [
        {
          label: "full-coverage-interior",
          x: 30,
          y: 36,
          expected: goldenPixelForFullCoverage(diagnosticNormalPlan.dabs),
        },
        { label: "transparent-exterior", x: 2, y: 2, expected: transparent },
      ],
    );
    cases.push(diagnosticNormal.result);

    const diagnosticOverlap = await executeCase(
      runtime,
      surface,
      "diagnostic-translucent-linear-overlap",
      "legacy-diagnostic-oracle",
      createFrame(102, INITIAL_RESIZE_EPOCH, diagnosticOverlapPlan),
      diagnosticOverlapPlan.dabs,
      [{
        label: "linear-premultiplied-overlap-interior",
        x: 48,
        y: 36,
        expected: goldenPixelForFullCoverage(diagnosticOverlapPlan.dabs),
      }],
    );
    cases.push(diagnosticOverlap.result);

    const diagnosticErase = await executeCase(
      runtime,
      surface,
      "diagnostic-destination-out-erase",
      "legacy-diagnostic-oracle",
      createFrame(103, INITIAL_RESIZE_EPOCH, diagnosticErasePlan),
      diagnosticErasePlan.dabs,
      [
        {
          label: "destination-out-interior",
          x: 54,
          y: 36,
          expected: goldenPixelForFullCoverage(diagnosticErasePlan.dabs),
        },
        {
          label: "unerased-base-interior",
          x: 40,
          y: 36,
          expected: goldenPixelForFullCoverage([diagnosticErasePlan.dabs[0]!]),
        },
      ],
    );
    cases.push(diagnosticErase.result);

    const appendBase = await executeCase(
      runtime,
      surface,
      "canonical-append-base",
      "canonical-lowering-adapter",
      createFrame(104, INITIAL_RESIZE_EPOCH, appendBasePlan),
      appendBasePlan.dabs,
      [{
        label: "append-base-interior",
        x: 40,
        y: 36,
        expected: goldenPixelForFullCoverage(appendBasePlan.dabs),
      }],
    );
    cases.push(appendBase.result);

    const appendedDabs = [
      ...appendBasePlan.dabs,
      ...appendDeltaPlan.dabs,
    ];
    const appendResult = await executeCase(
      runtime,
      surface,
      "canonical-append-result",
      "canonical-lowering-adapter",
      createFrame(105, INITIAL_RESIZE_EPOCH, appendDeltaPlan),
      appendedDabs,
      [{
        label: "append-overlap-interior",
        x: 44,
        y: 36,
        expected: goldenPixelForFullCoverage(appendedDabs),
      }],
    );
    cases.push(appendResult.result);

    const rebuildResult = await executeCase(
      runtime,
      surface,
      "canonical-rebuild-equivalent",
      "canonical-lowering-adapter",
      createFrame(106, INITIAL_RESIZE_EPOCH, appendRebuildPlan),
      appendRebuildPlan.dabs,
      [{
        label: "rebuild-overlap-interior",
        x: 44,
        y: 36,
        expected: goldenPixelForFullCoverage(appendRebuildPlan.dabs),
      }],
    );
    cases.push(rebuildResult.result);
    const appendRebuildExact = compareRawRgba(
      appendResult.pixels,
      rebuildResult.pixels,
    );

    const resize = runtime.resize({
      width: WIDTH,
      height: HEIGHT,
      resizeEpoch: RESIZED_EPOCH,
    });
    if (
      resize.status !== "ready"
      || resize.resizeEpoch !== RESIZED_EPOCH
      || resize.width !== WIDTH
      || resize.height !== HEIGHT
    ) throw new Error("real WebGPU runtime rejected the fenced monotonic resize epoch");

    const presentationFrame = createFrame(107, RESIZED_EPOCH, presentationPlan);
    const presentation = await executeCase(
      runtime,
      surface,
      "canonical-linear-premultiplied-presentation",
      "canonical-lowering-adapter",
      presentationFrame,
      presentationPlan.dabs,
      [{
        label: "scene-linear-to-srgb-interior",
        x: 48,
        y: 36,
        expected: goldenPixelForFullCoverage(presentationPlan.dabs),
      }],
    );
    cases.push(presentation.result);

    const ellipseFrame = createFrame(108, RESIZED_EPOCH, ellipsePlan);
    const ellipse = await executeCase(
      runtime,
      surface,
      "canonical-rotated-sheared-ellipse",
      "canonical-lowering-adapter",
      ellipseFrame,
      ellipsePlan.dabs,
      [{
        label: "ellipse-centre",
        x: 28,
        y: 36,
        expected: goldenPixelForFullCoverage(ellipsePlan.dabs),
      }],
    );
    cases.push(ellipse.result);

    const squareFrame = createFrame(109, RESIZED_EPOCH, squarePlan);
    const square = await executeCase(
      runtime,
      surface,
      "canonical-square",
      "canonical-lowering-adapter",
      squareFrame,
      squarePlan.dabs,
      [{
        label: "square-centre",
        x: 70,
        y: 36,
        expected: goldenPixelForFullCoverage(squarePlan.dabs),
      }],
    );
    cases.push(square.result);

    const softnessFrame = createFrame(110, RESIZED_EPOCH, softnessPlan);
    const softness = await executeCase(
      runtime,
      surface,
      "canonical-hardness-edge-softness",
      "canonical-lowering-adapter",
      softnessFrame,
      softnessPlan.dabs,
      [{
        label: "soft-tip-firm-core",
        x: 48,
        y: 36,
        expected: goldenPixelForFullCoverage(softnessPlan.dabs),
      }],
    );
    cases.push(softness.result);

    const affineFrame = createFrame(111, RESIZED_EPOCH, affinePlan);
    const affine = await executeCase(
      runtime,
      surface,
      "canonical-affine-footprint",
      "canonical-lowering-adapter",
      affineFrame,
      affinePlan.dabs,
      [{
        label: "affine-centre",
        x: 48,
        y: 36,
        expected: goldenPixelForFullCoverage(affinePlan.dabs),
      }],
    );
    cases.push(affine.result);

    const deviceLoss = await observeActualDeviceLoss(
      runtime,
      device,
      callbackLoss,
      affineFrame,
    );
    if (uncapturedGpuErrors.length > 0) {
      throw new Error(`WebGPU uncaptured errors: ${uncapturedGpuErrors.join("; ")}`);
    }

    return {
      status: "ok",
      backend: "webgpu",
      width: WIDTH,
      height: HEIGHT,
      capabilities: observedCapabilities,
      provider: {
        kind: "real-chromium-webgpu-device-boundary",
        canvasFormat,
        adapterInfo: serializableAdapterInfo(adapter),
        maxTextureDimension2D: Number(device.limits.maxTextureDimension2D),
        surface: "OffscreenCanvas",
      },
      cases,
      appendRebuild: {
        appendRequestSequence: appendResult.result.receipt.requestSequence,
        rebuildRequestSequence: rebuildResult.result.receipt.requestSequence,
        resizeEpoch: appendResult.result.receipt.resizeEpoch,
        exact: appendRebuildExact,
        diffPng: diffPngDataUrl(
          appendResult.pixels,
          rebuildResult.pixels,
          WIDTH,
          HEIGHT,
        ),
      },
      deviceLoss,
      uncapturedGpuErrors,
    };
  } finally {
    runtime.dispose();
    device.destroy();
  }
}

run()
  .then((result) => {
    window.__studioEngineWebGpuBrushParityResult = result;
  })
  .catch((error: unknown) => {
    window.__studioEngineWebGpuBrushParityResult = {
      status: "error",
      message: error instanceof Error ? error.stack ?? error.message : String(error),
      capabilities: capabilities(),
    };
  });

export {};
