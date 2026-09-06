import { studioHighBitSrgbToLinear } from "../studio-highbit-transfer";

import type {
  StudioCanonicalBrushSpecialistLoweringRequirement,
  StudioCanonicalBrushWebGpuLoweringRejectionReason,
  StudioCanonicalBrushWebGpuLoweringResult,
  StudioCanonicalWebGpuAnalyticBatch,
  StudioCanonicalWebGpuAnalyticDab,
  StudioCanonicalWebGpuAnalyticShape,
  StudioCanonicalWebGpuLinearColorSpace,
  StudioCanonicalWebGpuPorterDuff,
} from "../studio-canonical-brush-webgpu-lowering";
import type {
  StudioGpuDab,
  StudioGpuDabRenderUpdate,
} from "./studio-webgpu-dab-plan-contract";

/**
 * Worker-owned, future-first WebGPU brush execution kernel.
 *
 * The authoritative input is the engine-neutral canonical lowering result. Canvas2D, Konva,
 * encoded-sRGB legacy dabs and compatibility fallbacks are intentionally outside the production
 * boundary. Unsupported colour spaces, blend modes and specialist brush paths fail closed.
 */

export const STUDIO_ENGINE_WEBGPU_BRUSH_RECEIPT_REVISION = 2 as const;
export const STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT = "rgba16float" as const;
export const STUDIO_ENGINE_WEBGPU_BRUSH_COLOR_MODEL = "linear-premultiplied" as const;
export const STUDIO_ENGINE_WEBGPU_BRUSH_INPUT_COLOR_ENCODING = "scene-linear-straight" as const;
export const STUDIO_ENGINE_WEBGPU_BRUSH_WORKING_COLOR_SPACE = "linear-srgb" as const;
export const STUDIO_ENGINE_WEBGPU_BRUSH_PRESENTATION_COLOR_SPACE = "srgb" as const;
export const STUDIO_ENGINE_WEBGPU_BRUSH_INSTANCE_FLOATS = 16;
export const STUDIO_ENGINE_WEBGPU_BRUSH_INSTANCE_BYTES =
  STUDIO_ENGINE_WEBGPU_BRUSH_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
export const STUDIO_ENGINE_WEBGPU_BRUSH_DEFAULT_MAX_DABS = 65_536;
export const STUDIO_ENGINE_WEBGPU_BRUSH_DEFAULT_MAX_SURFACE_PIXELS = 16_777_216;
export const STUDIO_ENGINE_WEBGPU_BRUSH_DEFAULT_MAX_IN_FLIGHT_SUBMISSIONS = 3;

const GPU_TEXTURE_BINDING = 0x04;
const GPU_TEXTURE_COPY_SRC = 0x01;
const GPU_TEXTURE_RENDER_ATTACHMENT = 0x10;
const GPU_BUFFER_COPY_DST = 0x08;
const GPU_BUFFER_VERTEX = 0x20;
const DEFAULT_MAX_TEXTURE_DIMENSION = 8_192;
const INSTANCE_SHAPE_ROUND = 0;
const INSTANCE_SHAPE_ELLIPSE = 1;
const INSTANCE_SHAPE_SQUARE = 2;

const BRUSH_SHADER = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) color: vec4f,
  @location(2) @interpolate(flat) tip: vec4f,
  @location(3) @interpolate(flat) diagnostics: vec2f,
};

@vertex
fn vs_main(
  @builtin(vertex_index) vertex_index: u32,
  @location(0) center: vec2f,
  @location(1) basis_x: vec2f,
  @location(2) basis_y: vec2f,
  @location(3) color: vec4f,
  @location(4) tip: vec4f,
  @location(5) diagnostics: vec2f,
) -> VertexOutput {
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f( 1.0, -1.0),
    vec2f(-1.0,  1.0),
    vec2f(-1.0,  1.0),
    vec2f( 1.0, -1.0),
    vec2f( 1.0,  1.0),
  );
  let local = corners[vertex_index] * tip.w;
  var output: VertexOutput;
  output.position = vec4f(center + basis_x * local.x + basis_y * local.y, 0.0, 1.0);
  output.local = local;
  output.color = color;
  output.tip = tip;
  output.diagnostics = diagnostics;
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  // Round and ellipse share the analytic unit-circle metric; the full affine basis carries
  // ellipse scale, rotation, reflection and shear. Square uses the unit-box metric.
  let radial_metric = length(input.local);
  let square_metric = max(abs(input.local.x), abs(input.local.y));
  let metric = select(radial_metric, square_metric, input.tip.x > 1.5);
  let hardness = clamp(input.tip.y, 0.0, 1.0);
  let edge_softness = clamp(input.tip.z, 0.0, 1.0);
  // Edge softness remains meaningful across the full hardness range instead of being collapsed
  // by a max/min shortcut: hardness controls the firm core and softness expands its feather.
  let feather = clamp((1.0 - hardness) + edge_softness * hardness, 0.0, 1.0);
  let inner_edge = 1.0 - feather;
  let antialias = max(fwidth(metric) * 0.5, 0.00025);
  let coverage = 1.0 - smoothstep(
    inner_edge - antialias,
    1.0 + antialias,
    metric,
  );
  // Colour is already premultiplied scene-linear data. Coverage multiplies RGB and alpha once.
  return input.color * coverage;
}
`;

const PRESENTATION_SHADER = /* wgsl */ `
@group(0) @binding(0) var linear_surface: texture_2d<f32>;

struct VertexOutput {
  @builtin(position) position: vec4f,
};

fn linear_to_srgb_channel(value: f32) -> f32 {
  let safe = clamp(value, 0.0, 1.0);
  return select(
    1.055 * pow(safe, 1.0 / 2.4) - 0.055,
    12.92 * safe,
    safe <= 0.0031308,
  );
}

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
  let positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f( 3.0, -1.0),
    vec2f(-1.0,  3.0),
  );
  var output: VertexOutput;
  output.position = vec4f(positions[vertex_index], 0.0, 1.0);
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  let pixel = textureLoad(linear_surface, vec2i(input.position.xy), 0);
  let alpha = clamp(pixel.a, 0.0, 1.0);
  let straight_linear = select(
    vec3f(0.0),
    pixel.rgb / max(alpha, 0.000001),
    alpha > 0.0,
  );
  let encoded = vec3f(
    linear_to_srgb_channel(straight_linear.r),
    linear_to_srgb_channel(straight_linear.g),
    linear_to_srgb_channel(straight_linear.b),
  );
  return vec4f(encoded * alpha, alpha);
}
`;

export interface StudioEngineWebGpuBrushSurface {
  width: number;
  height: number;
  getContext(contextId: "webgpu"): GPUCanvasContext | null;
}

export interface StudioEngineWebGpuBrushDeviceBoundary {
  readonly device: GPUDevice;
  readonly context: GPUCanvasContext;
  readonly canvasFormat: GPUTextureFormat;
  readonly ownsDevice?: boolean;
}

export interface StudioEngineWebGpuBrushRuntimeOptions {
  readonly surface: StudioEngineWebGpuBrushSurface;
  readonly gpu?: GPU | null;
  readonly boundary?: StudioEngineWebGpuBrushDeviceBoundary | null;
  readonly initialResizeEpoch?: number;
  readonly maxDabs?: number;
  readonly maxSurfacePixels?: number;
  readonly maxInFlightSubmissions?: number;
  readonly onDeviceLost?: (info: GPUDeviceLostInfo) => void;
}

export interface StudioEngineWebGpuBrushRasterRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Production render plan. It can only be produced without loss by
 * `adaptLoweredStudioCanonicalBrushWebGpuDabs`.
 */
export interface StudioEngineWebGpuBrushPlan {
  readonly kind: "studio-engine-webgpu-canonical-plan";
  readonly mode: "append" | "rebuild";
  readonly loweringVersion: number;
  readonly strokeId: string;
  readonly dabs: readonly StudioCanonicalWebGpuAnalyticDab[];
  readonly batches: readonly StudioCanonicalWebGpuAnalyticBatch[];
}

export interface StudioEngineWebGpuBrushFrame {
  readonly requestSequence: number;
  readonly resizeEpoch: number;
  readonly rasterRect: StudioEngineWebGpuBrushRasterRect;
  readonly update: StudioEngineWebGpuBrushPlan;
}

export interface StudioEngineWebGpuBrushReceipt {
  readonly kind: "studio-engine-webgpu-brush-receipt";
  readonly revision: typeof STUDIO_ENGINE_WEBGPU_BRUSH_RECEIPT_REVISION;
  readonly backend: "webgpu";
  readonly requestSequence: number;
  readonly resizeEpoch: number;
  readonly deviceEpoch: number;
  readonly width: number;
  readonly height: number;
  readonly textureFormat: typeof STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT;
  readonly colorModel: typeof STUDIO_ENGINE_WEBGPU_BRUSH_COLOR_MODEL;
  readonly workingColorSpace: typeof STUDIO_ENGINE_WEBGPU_BRUSH_WORKING_COLOR_SPACE;
  readonly inputColorEncoding: typeof STUDIO_ENGINE_WEBGPU_BRUSH_INPUT_COLOR_ENCODING;
  readonly presentationColorSpace: typeof STUDIO_ENGINE_WEBGPU_BRUSH_PRESENTATION_COLOR_SPACE;
  readonly mode: "append" | "rebuild";
  readonly strokeId: string;
  readonly loweringVersion: number;
  readonly dabCount: number;
  readonly batchCount: number;
  readonly batchOrder: readonly StudioCanonicalWebGpuPorterDuff[];
  readonly planFingerprint: string;
  /** Submission was accepted by the ordered WebGPU queue; durability is a separate tile receipt. */
  readonly queueState: "submitted";
  readonly complete: true;
}

export type StudioEngineWebGpuBrushPlanAdaptationResult =
  | {
      readonly status: "ready";
      readonly plan: StudioEngineWebGpuBrushPlan;
    }
  | {
      readonly status: "lowering-required";
      readonly strokeId: string;
      readonly requirements: readonly StudioCanonicalBrushSpecialistLoweringRequirement[];
    }
  | {
      readonly status: "unsupported";
      readonly reason: "unsupported-blend-mode";
      readonly blendMode: string;
    }
  | {
      readonly status: "unsupported";
      readonly reason: "unsupported-color-space";
      readonly colorSpace: string;
    }
  | {
      readonly status: "rejected";
      readonly reason:
        | "canonical-lowering-rejected"
        | "dab-limit-exceeded"
        | "invalid-lowered-plan";
      readonly loweringReason?: StudioCanonicalBrushWebGpuLoweringRejectionReason;
    };

/**
 * Explicitly branded test/oracle bridge. It is intentionally not accepted by `execute`; callers
 * must opt into `.plan`, making legacy use visible in code review and dependency searches.
 */
export interface StudioEngineWebGpuLegacyDiagnosticOracle {
  readonly kind: "studio-engine-webgpu-legacy-diagnostic-oracle";
  readonly plan: StudioEngineWebGpuBrushPlan;
}

export type StudioEngineWebGpuBrushUnsupportedReason =
  | "adapter-unavailable"
  | "context-unavailable"
  | "device-unavailable"
  | "invalid-boundary"
  | "webgpu-unavailable";

export type StudioEngineWebGpuBrushCreationResult =
  | {
      readonly status: "ready";
      readonly runtime: StudioEngineWebGpuBrushRuntime;
    }
  | {
      readonly status: "unsupported";
      readonly reason: StudioEngineWebGpuBrushUnsupportedReason;
    }
  | {
      readonly status: "failed";
      readonly reason: "initialization-failed" | "invalid-configuration" | "invalid-surface";
    };

export type StudioEngineWebGpuBrushResizeResult =
  | {
      readonly status: "ready";
      readonly resizeEpoch: number;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly status: "rejected";
      readonly reason:
        | "device-lost"
        | "disposed"
        | "gpu-backpressure"
        | "invalid-resize"
        | "runtime-failed"
        | "stale-resize-epoch";
    };

export type StudioEngineWebGpuBrushExecutionRejection =
  | "append-without-base"
  | "device-lost"
  | "disposed"
  | "gpu-backpressure"
  | "invalid-plan"
  | "invalid-raster-rect"
  | "invalid-request-sequence"
  | "request-limit"
  | "resize-epoch-mismatch"
  | "runtime-failed"
  | "stale-request-sequence"
  | "submission-failed";

export type StudioEngineWebGpuBrushExecutionResult =
  | {
      readonly status: "presented";
      readonly receipt: StudioEngineWebGpuBrushReceipt;
    }
  | {
      readonly status: "rejected";
      readonly reason: StudioEngineWebGpuBrushExecutionRejection;
    };

export interface StudioEngineWebGpuBrushStats {
  readonly status: "ready" | "device-lost" | "failed" | "disposed";
  readonly deviceEpoch: number;
  readonly resizeEpoch: number;
  readonly lastPresentedRequestSequence: number;
  readonly width: number;
  readonly height: number;
  readonly surfaceBytes: number;
  readonly instanceCapacity: number;
  readonly instanceBufferAllocations: number;
  readonly surfaceTextureAllocations: number;
  readonly submissions: number;
  readonly completedSubmissionSequence: number;
  readonly inFlightSubmissions: number;
  readonly maxInFlightSubmissions: number;
}

interface RuntimeResources {
  readonly normalPipeline: GPURenderPipeline;
  readonly erasePipeline: GPURenderPipeline;
  readonly presentationPipeline: GPURenderPipeline;
  readonly presentationBindGroupLayout: GPUBindGroupLayout;
}

interface ValidPlan {
  readonly loweringVersion: number;
  readonly strokeId: string;
  readonly dabs: readonly StudioCanonicalWebGpuAnalyticDab[];
  readonly batches: readonly StudioCanonicalWebGpuAnalyticBatch[];
}

type FrameSnapshotResult =
  | {
      readonly status: "ready";
      readonly frame: StudioEngineWebGpuBrushFrame;
      readonly plan: ValidPlan;
    }
  | {
      readonly status: "rejected";
      readonly reason: "invalid-plan" | "invalid-raster-rect" | "request-limit";
    };

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isFinite(Math.fround(value));
}

function unit(value: unknown): value is number {
  return finite(value) && value >= 0 && value <= 1;
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validRasterRect(rect: StudioEngineWebGpuBrushRasterRect): boolean {
  return finite(rect.x)
    && finite(rect.y)
    && finite(rect.width)
    && finite(rect.height)
    && rect.width > 0
    && rect.height > 0;
}

function sameRasterRect(
  left: StudioEngineWebGpuBrushRasterRect | null,
  right: StudioEngineWebGpuBrushRasterRect,
): boolean {
  return left !== null
    && Object.is(left.x, right.x)
    && Object.is(left.y, right.y)
    && Object.is(left.width, right.width)
    && Object.is(left.height, right.height);
}

function validShape(value: unknown): value is StudioCanonicalWebGpuAnalyticShape {
  return value === "round" || value === "ellipse" || value === "square";
}

function validPorterDuff(value: unknown): value is StudioCanonicalWebGpuPorterDuff {
  return value === "source-over" || value === "destination-out";
}

function validColorSpace(value: unknown): value is StudioCanonicalWebGpuLinearColorSpace {
  return value === "linear-srgb" || value === "linear-display-p3";
}

function nonSingularGpuBasis(basis: readonly number[]): boolean {
  const [xx, xy, yx, yy] = basis.map(Math.fround);
  return [xx, xy, yx, yy].every((value) => Number.isFinite(value))
    && Math.fround(xx! * yy! - xy! * yx!) !== 0;
}

function validDab(dab: StudioCanonicalWebGpuAnalyticDab, expectedIndex: number): boolean {
  const components = dab.color.components;
  const basis = dab.tip.localToDocument;
  return nonNegativeSafeInteger(dab.index)
    && dab.index === expectedIndex
    && finite(dab.stationX)
    && finite(dab.stationY)
    && finite(dab.x)
    && finite(dab.y)
    && unit(dab.pressure)
    && finite(dab.diameter)
    && dab.diameter > 0
    && finite(dab.opacity)
    && finite(dab.flow)
    && dab.color.alphaMode === "straight"
    && validColorSpace(dab.color.space)
    && Array.isArray(components)
    && components.length === 4
    && components.every(unit)
    && validPorterDuff(dab.composite.porterDuff)
    && typeof dab.composite.blendMode === "string"
    && validShape(dab.tip.shape)
    && unit(dab.tip.hardness)
    && unit(dab.tip.edgeSoftness)
    && unit(dab.tip.roundness)
    && dab.tip.roundness > 0
    && finite(dab.tip.angleRadians)
    && Array.isArray(basis)
    && basis.length === 4
    && basis.every(finite)
    && nonSingularGpuBasis(basis);
}

function sameComposite(
  left: StudioCanonicalWebGpuAnalyticDab["composite"],
  right: StudioCanonicalWebGpuAnalyticBatch["composite"],
): boolean {
  return left.porterDuff === right.porterDuff && left.blendMode === right.blendMode;
}

function validatePlan(
  update: StudioEngineWebGpuBrushPlan,
  maxDabs: number,
): ValidPlan | null {
  try {
    if (
      update.kind !== "studio-engine-webgpu-canonical-plan"
      || (update.mode !== "append" && update.mode !== "rebuild")
      || !positiveSafeInteger(update.loweringVersion)
      || typeof update.strokeId !== "string"
      || update.strokeId.length === 0
      || !Array.isArray(update.dabs)
      || !Array.isArray(update.batches)
      || update.dabs.length > maxDabs
      || !update.dabs.every(validDab)
    ) return null;

    let nextInstance = 0;
    for (const batch of update.batches) {
      if (
        !batch
        || !validPorterDuff(batch.composite?.porterDuff)
        || typeof batch.composite?.blendMode !== "string"
        || !validColorSpace(batch.colorSpace)
        || !nonNegativeSafeInteger(batch.firstInstance)
        || !positiveSafeInteger(batch.instanceCount)
        || batch.firstInstance !== nextInstance
        || batch.firstInstance + batch.instanceCount > update.dabs.length
      ) return null;
      const end = batch.firstInstance + batch.instanceCount;
      for (let index = batch.firstInstance; index < end; index += 1) {
        const dab = update.dabs[index];
        if (
          !dab
          || !sameComposite(dab.composite, batch.composite)
          || dab.color.space !== batch.colorSpace
        ) return null;
      }
      nextInstance = end;
    }
    if (nextInstance !== update.dabs.length) return null;
    return {
      loweringVersion: update.loweringVersion,
      strokeId: update.strokeId,
      dabs: update.dabs,
      batches: update.batches,
    };
  } catch {
    return null;
  }
}

function copyDab(dab: StudioCanonicalWebGpuAnalyticDab): StudioCanonicalWebGpuAnalyticDab {
  return {
    index: dab.index,
    stationX: dab.stationX,
    stationY: dab.stationY,
    x: dab.x,
    y: dab.y,
    pressure: dab.pressure,
    diameter: dab.diameter,
    opacity: dab.opacity,
    flow: dab.flow,
    color: {
      space: dab.color.space,
      alphaMode: dab.color.alphaMode,
      components: [...dab.color.components],
    },
    composite: { ...dab.composite },
    tip: {
      shape: dab.tip.shape,
      hardness: dab.tip.hardness,
      edgeSoftness: dab.tip.edgeSoftness,
      roundness: dab.tip.roundness,
      angleRadians: dab.tip.angleRadians,
      localToDocument: [...dab.tip.localToDocument],
    },
  };
}

function copyBatch(batch: StudioCanonicalWebGpuAnalyticBatch): StudioCanonicalWebGpuAnalyticBatch {
  return {
    composite: { ...batch.composite },
    colorSpace: batch.colorSpace,
    firstInstance: batch.firstInstance,
    instanceCount: batch.instanceCount,
  };
}

function freezePlan(plan: StudioEngineWebGpuBrushPlan): StudioEngineWebGpuBrushPlan {
  for (const dab of plan.dabs) {
    Object.freeze(dab.color.components);
    Object.freeze(dab.color);
    Object.freeze(dab.composite);
    Object.freeze(dab.tip.localToDocument);
    Object.freeze(dab.tip);
    Object.freeze(dab);
  }
  for (const batch of plan.batches) {
    Object.freeze(batch.composite);
    Object.freeze(batch);
  }
  Object.freeze(plan.dabs);
  Object.freeze(plan.batches);
  return Object.freeze(plan);
}

/**
 * The only production adapter into this kernel. It preserves the complete analytic footprint and
 * explicitly exposes specialist, gamut and blend gaps instead of drawing an approximation.
 */
export function adaptLoweredStudioCanonicalBrushWebGpuDabs(
  mode: "append" | "rebuild",
  lowering: StudioCanonicalBrushWebGpuLoweringResult,
  maxDabs = STUDIO_ENGINE_WEBGPU_BRUSH_DEFAULT_MAX_DABS,
): StudioEngineWebGpuBrushPlanAdaptationResult {
  try {
    if (
      (mode !== "append" && mode !== "rebuild")
      || !positiveSafeInteger(maxDabs)
      || !lowering
    ) return { status: "rejected", reason: "invalid-lowered-plan" };
    if (lowering.status === "lowering-required") {
      return Object.freeze({
        status: "lowering-required",
        strokeId: lowering.strokeId,
        requirements: Object.freeze([...lowering.requirements]),
      });
    }
    if (lowering.status === "rejected") {
      return {
        status: "rejected",
        reason: "canonical-lowering-rejected",
        loweringReason: lowering.reason,
      };
    }
    if (lowering.status !== "lowered") {
      return { status: "rejected", reason: "invalid-lowered-plan" };
    }
    if (lowering.dabs.length > maxDabs) {
      return { status: "rejected", reason: "dab-limit-exceeded" };
    }
    const dabs = lowering.dabs.map(copyDab);
    const batches = lowering.batches.map(copyBatch);
    const plan: StudioEngineWebGpuBrushPlan = {
      kind: "studio-engine-webgpu-canonical-plan",
      mode,
      loweringVersion: lowering.version,
      strokeId: lowering.strokeId,
      dabs,
      batches,
    };
    if (!validatePlan(plan, maxDabs)) {
      return { status: "rejected", reason: "invalid-lowered-plan" };
    }
    const unsupportedColorSpace = dabs.find(
      (dab) => dab.color.space !== STUDIO_ENGINE_WEBGPU_BRUSH_WORKING_COLOR_SPACE,
    )?.color.space ?? batches.find(
      (batch) => batch.colorSpace !== STUDIO_ENGINE_WEBGPU_BRUSH_WORKING_COLOR_SPACE,
    )?.colorSpace;
    if (unsupportedColorSpace) {
      return {
        status: "unsupported",
        reason: "unsupported-color-space",
        colorSpace: unsupportedColorSpace,
      };
    }
    const unsupportedBlend = dabs.find(
      (dab) => dab.composite.blendMode !== "normal",
    )?.composite.blendMode ?? batches.find(
      (batch) => batch.composite.blendMode !== "normal",
    )?.composite.blendMode;
    if (unsupportedBlend) {
      return {
        status: "unsupported",
        reason: "unsupported-blend-mode",
        blendMode: unsupportedBlend,
      };
    }
    return { status: "ready", plan: freezePlan(plan) };
  } catch {
    return { status: "rejected", reason: "invalid-lowered-plan" };
  }
}

export function validateStudioEngineWebGpuBrushPlan(
  update: StudioEngineWebGpuBrushPlan,
  maxDabs: number,
): ValidPlan | null {
  return validatePlan(update, maxDabs);
}

function snapshotFrame(
  input: StudioEngineWebGpuBrushFrame,
  maxDabs: number,
): FrameSnapshotResult {
  try {
    const rasterRect = {
      x: input.rasterRect.x,
      y: input.rasterRect.y,
      width: input.rasterRect.width,
      height: input.rasterRect.height,
    };
    if (!validRasterRect(rasterRect)) {
      return { status: "rejected", reason: "invalid-raster-rect" };
    }
    if (input.update.dabs.length > maxDabs) {
      return { status: "rejected", reason: "request-limit" };
    }
    const update: StudioEngineWebGpuBrushPlan = {
      kind: input.update.kind,
      mode: input.update.mode,
      loweringVersion: input.update.loweringVersion,
      strokeId: input.update.strokeId,
      dabs: input.update.dabs.map(copyDab),
      batches: input.update.batches.map(copyBatch),
    };
    const plan = validatePlan(update, maxDabs);
    if (!plan) return { status: "rejected", reason: "invalid-plan" };
    for (const dab of plan.dabs) {
      if (
        dab.color.space !== STUDIO_ENGINE_WEBGPU_BRUSH_WORKING_COLOR_SPACE
        || dab.composite.blendMode !== "normal"
      ) return { status: "rejected", reason: "invalid-plan" };
    }
    return {
      status: "ready",
      frame: {
        requestSequence: input.requestSequence,
        resizeEpoch: input.resizeEpoch,
        rasterRect,
        update,
      },
      plan,
    };
  } catch {
    return { status: "rejected", reason: "invalid-plan" };
  }
}

function nextCapacity(required: number, maximum: number): number {
  if (required <= 0) return 0;
  let capacity = Math.min(256, maximum);
  while (capacity < required && capacity < maximum) {
    capacity = Math.min(maximum, capacity * 2);
  }
  return capacity;
}

function surfaceByteLength(width: number, height: number): number {
  return width * height * 8;
}

function hashNumber(hash: number, value: number, view: DataView): number {
  view.setFloat64(0, value, true);
  let next = hash;
  for (let index = 0; index < Float64Array.BYTES_PER_ELEMENT; index += 1) {
    next ^= view.getUint8(index);
    next = Math.imul(next, 0x01000193);
  }
  return next >>> 0;
}

function hashString(hash: number, value: string): number {
  let next = hash;
  for (let index = 0; index < value.length; index += 1) {
    next ^= value.charCodeAt(index);
    next = Math.imul(next, 0x01000193);
  }
  return next >>> 0;
}

/** Pure provider-free fingerprint over the full rich analytic contract. */
export function fingerprintStudioEngineWebGpuBrushPlan(
  frame: StudioEngineWebGpuBrushFrame,
): string {
  const numberView = new DataView(new ArrayBuffer(Float64Array.BYTES_PER_ELEMENT));
  let hash = 0x811c9dc5;
  hash = hashNumber(hash, frame.requestSequence, numberView);
  hash = hashNumber(hash, frame.resizeEpoch, numberView);
  hash = hashString(hash, frame.update.kind);
  hash = hashString(hash, frame.update.mode);
  hash = hashString(hash, frame.update.strokeId);
  hash = hashNumber(hash, frame.update.loweringVersion, numberView);
  for (const value of [
    frame.rasterRect.x,
    frame.rasterRect.y,
    frame.rasterRect.width,
    frame.rasterRect.height,
  ]) hash = hashNumber(hash, value, numberView);
  for (const dab of frame.update.dabs) {
    for (const value of [
      dab.index,
      dab.stationX,
      dab.stationY,
      dab.x,
      dab.y,
      dab.pressure,
      dab.diameter,
      dab.opacity,
      dab.flow,
      ...dab.color.components,
      dab.tip.hardness,
      dab.tip.edgeSoftness,
      dab.tip.roundness,
      dab.tip.angleRadians,
      ...dab.tip.localToDocument,
    ]) hash = hashNumber(hash, value, numberView);
    hash = hashString(hash, dab.color.space);
    hash = hashString(hash, dab.color.alphaMode);
    hash = hashString(hash, dab.composite.porterDuff);
    hash = hashString(hash, dab.composite.blendMode);
    hash = hashString(hash, dab.tip.shape);
  }
  for (const batch of frame.update.batches) {
    hash = hashString(hash, batch.composite.porterDuff);
    hash = hashString(hash, batch.composite.blendMode);
    hash = hashString(hash, batch.colorSpace);
    hash = hashNumber(hash, batch.firstInstance, numberView);
    hash = hashNumber(hash, batch.instanceCount, numberView);
  }
  return `${frame.update.dabs.length}:${frame.update.batches.length}:${hash
    .toString(16)
    .padStart(8, "0")}`;
}

function shapeCode(shape: StudioCanonicalWebGpuAnalyticShape): number {
  if (shape === "ellipse") return INSTANCE_SHAPE_ELLIPSE;
  if (shape === "square") return INSTANCE_SHAPE_SQUARE;
  return INSTANCE_SHAPE_ROUND;
}

function smallestSingularValue(basis: readonly [number, number, number, number]): number {
  const [xx, xy, yx, yy] = basis;
  const a = xx * xx + xy * xy;
  const b = xx * yx + xy * yy;
  const d = yx * yx + yy * yy;
  const discriminant = Math.hypot(a - d, 2 * b);
  return Math.sqrt(Math.max(0, (a + d - discriminant) / 2));
}

/**
 * Packs the full affine analytic tip into the GPU instance layout. RGB is premultiplied exactly
 * once. The two diagnostic floats retain canonical roundness and angle even though the affine
 * basis is the raster authority for those properties.
 */
export function packStudioEngineWebGpuBrushDabs(
  dabs: readonly StudioCanonicalWebGpuAnalyticDab[],
  rasterRect: StudioEngineWebGpuBrushRasterRect,
  physicalWidth: number,
  physicalHeight: number,
  scratch?: Float32Array,
): Float32Array {
  const required = dabs.length * STUDIO_ENGINE_WEBGPU_BRUSH_INSTANCE_FLOATS;
  const packed = scratch && scratch.length >= required
    ? scratch.subarray(0, required)
    : new Float32Array(required);
  const logicalPixel = Math.max(
    rasterRect.width / physicalWidth,
    rasterRect.height / physicalHeight,
  );

  for (let index = 0; index < dabs.length; index += 1) {
    const dab = dabs[index]!;
    const offset = index * STUDIO_ENGINE_WEBGPU_BRUSH_INSTANCE_FLOATS;
    const [xx, xy, yx, yy] = dab.tip.localToDocument;
    const minimumScale = smallestSingularValue(dab.tip.localToDocument);
    const quadScale = 1 + Math.min(4, logicalPixel / Math.max(minimumScale, 0.000001));
    const [red, green, blue, alpha] = dab.color.components;
    packed[offset] = ((dab.x - rasterRect.x) / rasterRect.width) * 2 - 1;
    packed[offset + 1] = 1 - ((dab.y - rasterRect.y) / rasterRect.height) * 2;
    packed[offset + 2] = (xx / rasterRect.width) * 2;
    packed[offset + 3] = (-xy / rasterRect.height) * 2;
    packed[offset + 4] = (yx / rasterRect.width) * 2;
    packed[offset + 5] = (-yy / rasterRect.height) * 2;
    packed[offset + 6] = red * alpha;
    packed[offset + 7] = green * alpha;
    packed[offset + 8] = blue * alpha;
    packed[offset + 9] = alpha;
    packed[offset + 10] = shapeCode(dab.tip.shape);
    packed[offset + 11] = dab.tip.hardness;
    packed[offset + 12] = dab.tip.edgeSoftness;
    packed[offset + 13] = quadScale;
    packed[offset + 14] = dab.tip.roundness;
    packed[offset + 15] = dab.tip.angleRadians;
  }
  return packed;
}

/**
 * Encoded-sRGB legacy bridge for pixel-oracle tests only. Production command paths must lower a
 * canonical plan and call `adaptLoweredStudioCanonicalBrushWebGpuDabs`.
 */
export function convertLegacyStudioGpuDabPlanToWebGpuDiagnosticOracle(
  legacy: StudioGpuDabRenderUpdate,
): StudioEngineWebGpuLegacyDiagnosticOracle {
  const dabs: StudioCanonicalWebGpuAnalyticDab[] = legacy.dabs.map(
    (dab: StudioGpuDab, index): StudioCanonicalWebGpuAnalyticDab => ({
      index,
      stationX: dab.x,
      stationY: dab.y,
      x: dab.x,
      y: dab.y,
      pressure: 1,
      diameter: dab.radius * 2,
      opacity: dab.alpha,
      flow: 1,
      color: {
        space: "linear-srgb",
        alphaMode: "straight",
        components: [
          studioHighBitSrgbToLinear(dab.red),
          studioHighBitSrgbToLinear(dab.green),
          studioHighBitSrgbToLinear(dab.blue),
          dab.alpha,
        ],
      },
      composite: {
        porterDuff: dab.composite === "erase" ? "destination-out" : "source-over",
        blendMode: "normal",
      },
      tip: {
        shape: "round",
        hardness: 1,
        edgeSoftness: 0,
        roundness: 1,
        angleRadians: 0,
        localToDocument: [dab.radius, 0, 0, dab.radius],
      },
    }),
  );
  const batches: StudioCanonicalWebGpuAnalyticBatch[] = legacy.batches.map((batch) => ({
    composite: {
      porterDuff: batch.composite === "erase" ? "destination-out" : "source-over",
      blendMode: "normal",
    },
    colorSpace: "linear-srgb",
    firstInstance: batch.firstInstance,
    instanceCount: batch.instanceCount,
  }));
  return Object.freeze({
    kind: "studio-engine-webgpu-legacy-diagnostic-oracle",
    plan: freezePlan({
      kind: "studio-engine-webgpu-canonical-plan",
      mode: legacy.mode,
      loweringVersion: 1,
      strokeId: "legacy-diagnostic-oracle",
      dabs,
      batches,
    }),
  });
}

function safeDestroyBuffer(buffer: GPUBuffer | null): void {
  if (!buffer) return;
  try {
    buffer.destroy();
  } catch {
    // A lost device has already retired the resource.
  }
}

function safeDestroyTexture(texture: GPUTexture | null): void {
  if (!texture) return;
  try {
    texture.destroy();
  } catch {
    // A lost device has already retired the resource.
  }
}

function safeDestroyDevice(device: GPUDevice, owned: boolean): void {
  if (!owned) return;
  try {
    device.destroy();
  } catch {
    // Best-effort release for a dedicated device.
  }
}

function safeUnconfigure(context: GPUCanvasContext): void {
  try {
    context.unconfigure();
  } catch {
    // Detached OffscreenCanvas and lost-device implementations may already be unconfigured.
  }
}

function createResources(
  device: GPUDevice,
  canvasFormat: GPUTextureFormat,
): RuntimeResources {
  const brushModule = device.createShaderModule({
    label: "Studio Engine Worker rich analytic dab shader",
    code: BRUSH_SHADER,
  });
  const vertex: GPUVertexState = {
    module: brushModule,
    entryPoint: "vs_main",
    buffers: [{
      arrayStride: STUDIO_ENGINE_WEBGPU_BRUSH_INSTANCE_BYTES,
      stepMode: "instance",
      attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x2" },
        { shaderLocation: 1, offset: 8, format: "float32x2" },
        { shaderLocation: 2, offset: 16, format: "float32x2" },
        { shaderLocation: 3, offset: 24, format: "float32x4" },
        { shaderLocation: 4, offset: 40, format: "float32x4" },
        { shaderLocation: 5, offset: 56, format: "float32x2" },
      ],
    }],
  };
  const normalPipeline = device.createRenderPipeline({
    label: "Studio Engine Worker source-over rich analytic dab pipeline",
    layout: "auto",
    vertex,
    fragment: {
      module: brushModule,
      entryPoint: "fs_main",
      targets: [{
        format: STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT,
        blend: {
          color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
          alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
        },
      }],
    },
    primitive: { topology: "triangle-list" },
  });
  const erasePipeline = device.createRenderPipeline({
    label: "Studio Engine Worker destination-out rich analytic dab pipeline",
    layout: "auto",
    vertex,
    fragment: {
      module: brushModule,
      entryPoint: "fs_main",
      targets: [{
        format: STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT,
        blend: {
          color: { srcFactor: "zero", dstFactor: "one-minus-src-alpha", operation: "add" },
          alpha: { srcFactor: "zero", dstFactor: "one-minus-src-alpha", operation: "add" },
        },
      }],
    },
    primitive: { topology: "triangle-list" },
  });
  const presentationBindGroupLayout = device.createBindGroupLayout({
    label: "Studio Engine Worker brush presentation bindings",
    entries: [{
      binding: 0,
      visibility: 0x02,
      texture: { sampleType: "unfilterable-float", viewDimension: "2d" },
    }],
  });
  const presentationModule = device.createShaderModule({
    label: "Studio Engine Worker linear-sRGB presentation shader",
    code: PRESENTATION_SHADER,
  });
  const presentationPipeline = device.createRenderPipeline({
    label: "Studio Engine Worker brush presentation pipeline",
    layout: device.createPipelineLayout({
      label: "Studio Engine Worker brush presentation layout",
      bindGroupLayouts: [presentationBindGroupLayout],
    }),
    vertex: { module: presentationModule, entryPoint: "vs_main" },
    fragment: {
      module: presentationModule,
      entryPoint: "fs_main",
      targets: [{ format: canvasFormat }],
    },
    primitive: { topology: "triangle-list" },
  });
  return {
    normalPipeline,
    erasePipeline,
    presentationPipeline,
    presentationBindGroupLayout,
  };
}

function ambientGpu(explicit: GPU | null | undefined, supplied: boolean): GPU | null {
  if (supplied) return explicit ?? null;
  if (typeof navigator === "undefined") return null;
  return navigator.gpu ?? null;
}

export async function createStudioEngineWebGpuBrushRuntime(
  options: StudioEngineWebGpuBrushRuntimeOptions,
): Promise<StudioEngineWebGpuBrushCreationResult> {
  const maxDabs = options.maxDabs ?? STUDIO_ENGINE_WEBGPU_BRUSH_DEFAULT_MAX_DABS;
  const maxSurfacePixels =
    options.maxSurfacePixels ?? STUDIO_ENGINE_WEBGPU_BRUSH_DEFAULT_MAX_SURFACE_PIXELS;
  const maxInFlightSubmissions = options.maxInFlightSubmissions
    ?? STUDIO_ENGINE_WEBGPU_BRUSH_DEFAULT_MAX_IN_FLIGHT_SUBMISSIONS;
  if (
    !positiveSafeInteger(maxDabs)
    || !positiveSafeInteger(maxSurfacePixels)
    || !positiveSafeInteger(maxInFlightSubmissions)
  ) return { status: "failed", reason: "invalid-configuration" };

  let device: GPUDevice;
  let context: GPUCanvasContext;
  let canvasFormat: GPUTextureFormat;
  let ownsDevice: boolean;
  if (options.boundary !== undefined) {
    if (!options.boundary) return { status: "unsupported", reason: "invalid-boundary" };
    device = options.boundary.device;
    context = options.boundary.context;
    canvasFormat = options.boundary.canvasFormat;
    ownsDevice = options.boundary.ownsDevice === true;
    if (!device || !context || !canvasFormat) {
      return { status: "unsupported", reason: "invalid-boundary" };
    }
  } else {
    const gpu = ambientGpu(options.gpu, Object.prototype.hasOwnProperty.call(options, "gpu"));
    if (!gpu) return { status: "unsupported", reason: "webgpu-unavailable" };
    let adapter: GPUAdapter | null;
    try {
      adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
    } catch {
      return { status: "unsupported", reason: "adapter-unavailable" };
    }
    if (!adapter) return { status: "unsupported", reason: "adapter-unavailable" };
    try {
      device = await adapter.requestDevice();
    } catch {
      return { status: "unsupported", reason: "device-unavailable" };
    }
    const acquiredContext = options.surface.getContext("webgpu");
    if (!acquiredContext) {
      safeDestroyDevice(device, true);
      return { status: "unsupported", reason: "context-unavailable" };
    }
    context = acquiredContext;
    canvasFormat = gpu.getPreferredCanvasFormat();
    ownsDevice = true;
  }

  try {
    const resources = createResources(device, canvasFormat);
    const runtime = new StudioEngineWebGpuBrushRuntime({
      surface: options.surface,
      device,
      context,
      canvasFormat,
      ownsDevice,
      resources,
      maxDabs,
      maxSurfacePixels,
      maxInFlightSubmissions,
      onDeviceLost: options.onDeviceLost,
    });
    const initialResize = runtime.resize({
      width: options.surface.width,
      height: options.surface.height,
      resizeEpoch: options.initialResizeEpoch ?? 1,
    });
    if (initialResize.status !== "ready") {
      runtime.dispose();
      return { status: "failed", reason: "invalid-surface" };
    }
    return { status: "ready", runtime };
  } catch {
    safeUnconfigure(context);
    safeDestroyDevice(device, ownsDevice);
    return { status: "failed", reason: "initialization-failed" };
  }
}

interface RuntimeConstructorOptions {
  readonly surface: StudioEngineWebGpuBrushSurface;
  readonly device: GPUDevice;
  readonly context: GPUCanvasContext;
  readonly canvasFormat: GPUTextureFormat;
  readonly ownsDevice: boolean;
  readonly resources: RuntimeResources;
  readonly maxDabs: number;
  readonly maxSurfacePixels: number;
  readonly maxInFlightSubmissions: number;
  readonly onDeviceLost?: (info: GPUDeviceLostInfo) => void;
}

export class StudioEngineWebGpuBrushRuntime {
  private readonly surface: StudioEngineWebGpuBrushSurface;
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly canvasFormat: GPUTextureFormat;
  private readonly ownsDevice: boolean;
  private readonly resources: RuntimeResources;
  private readonly maxDabs: number;
  private readonly maxSurfacePixels: number;
  private readonly maxInFlightSubmissions: number;
  private readonly onDeviceLost: ((info: GPUDeviceLostInfo) => void) | undefined;

  private status: StudioEngineWebGpuBrushStats["status"] = "ready";
  private targetTexture: GPUTexture | null = null;
  private presentationBindGroup: GPUBindGroup | null = null;
  private instanceBuffer: GPUBuffer | null = null;
  private staging: Float32Array | null = null;
  private resizeEpoch = 0;
  private deviceEpoch = 1;
  private width = 0;
  private height = 0;
  private instanceCapacity = 0;
  private instanceBufferAllocations = 0;
  private surfaceTextureAllocations = 0;
  private submissions = 0;
  private completedSubmissionSequence = 0;
  private lastPresentedRequestSequence = 0;
  private retainedRasterRect: StudioEngineWebGpuBrushRasterRect | null = null;
  private hasRetainedBase = false;
  private fencePending = false;

  public constructor(options: RuntimeConstructorOptions) {
    this.surface = options.surface;
    this.device = options.device;
    this.context = options.context;
    this.canvasFormat = options.canvasFormat;
    this.ownsDevice = options.ownsDevice;
    this.resources = options.resources;
    this.maxDabs = options.maxDabs;
    this.maxSurfacePixels = options.maxSurfacePixels;
    this.maxInFlightSubmissions = options.maxInFlightSubmissions;
    this.onDeviceLost = options.onDeviceLost;
    void this.device.lost.then((info) => this.handleDeviceLost(info));
  }

  public stats(): StudioEngineWebGpuBrushStats {
    return Object.freeze({
      status: this.status,
      deviceEpoch: this.deviceEpoch,
      resizeEpoch: this.resizeEpoch,
      lastPresentedRequestSequence: this.lastPresentedRequestSequence,
      width: this.width,
      height: this.height,
      surfaceBytes: surfaceByteLength(this.width, this.height),
      instanceCapacity: this.instanceCapacity,
      instanceBufferAllocations: this.instanceBufferAllocations,
      surfaceTextureAllocations: this.surfaceTextureAllocations,
      submissions: this.submissions,
      completedSubmissionSequence: this.completedSubmissionSequence,
      inFlightSubmissions: this.submissions - this.completedSubmissionSequence,
      maxInFlightSubmissions: this.maxInFlightSubmissions,
    });
  }

  public resize(input: {
    readonly width: number;
    readonly height: number;
    readonly resizeEpoch: number;
  }): StudioEngineWebGpuBrushResizeResult {
    if (this.status === "disposed") return { status: "rejected", reason: "disposed" };
    if (this.status === "device-lost") return { status: "rejected", reason: "device-lost" };
    if (this.status !== "ready") return { status: "rejected", reason: "runtime-failed" };
    if (
      !positiveSafeInteger(input.width)
      || !positiveSafeInteger(input.height)
      || !positiveSafeInteger(input.resizeEpoch)
      || input.width * input.height > this.maxSurfacePixels
      || input.width > Number(
        this.device.limits.maxTextureDimension2D ?? DEFAULT_MAX_TEXTURE_DIMENSION,
      )
      || input.height > Number(
        this.device.limits.maxTextureDimension2D ?? DEFAULT_MAX_TEXTURE_DIMENSION,
      )
    ) return { status: "rejected", reason: "invalid-resize" };
    if (input.resizeEpoch <= this.resizeEpoch) {
      return { status: "rejected", reason: "stale-resize-epoch" };
    }
    if (this.submissions !== this.completedSubmissionSequence) {
      return { status: "rejected", reason: "gpu-backpressure" };
    }

    let replacement: GPUTexture | null = null;
    try {
      replacement = this.device.createTexture({
        label: `Studio Engine Worker RGBA16F brush surface epoch ${input.resizeEpoch}`,
        size: {
          width: input.width,
          height: input.height,
          depthOrArrayLayers: 1,
        },
        format: STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT,
        usage:
          GPU_TEXTURE_RENDER_ATTACHMENT
          | GPU_TEXTURE_BINDING
          | GPU_TEXTURE_COPY_SRC,
      });
      const replacementBindGroup = this.device.createBindGroup({
        label: `Studio Engine Worker brush presentation bindings epoch ${input.resizeEpoch}`,
        layout: this.resources.presentationBindGroupLayout,
        entries: [{ binding: 0, resource: replacement.createView() }],
      });
      this.surface.width = input.width;
      this.surface.height = input.height;
      this.context.configure({
        device: this.device,
        format: this.canvasFormat,
        alphaMode: "premultiplied",
        colorSpace: STUDIO_ENGINE_WEBGPU_BRUSH_PRESENTATION_COLOR_SPACE,
        usage: GPU_TEXTURE_RENDER_ATTACHMENT,
      });
      safeDestroyTexture(this.targetTexture);
      this.targetTexture = replacement;
      replacement = null;
      this.presentationBindGroup = replacementBindGroup;
      this.width = input.width;
      this.height = input.height;
      this.resizeEpoch = input.resizeEpoch;
      this.surfaceTextureAllocations += 1;
      this.hasRetainedBase = false;
      this.retainedRasterRect = null;
      return {
        status: "ready",
        resizeEpoch: this.resizeEpoch,
        width: this.width,
        height: this.height,
      };
    } catch {
      safeDestroyTexture(replacement);
      this.failClosed();
      return { status: "rejected", reason: "runtime-failed" };
    }
  }

  public execute(input: StudioEngineWebGpuBrushFrame): Promise<StudioEngineWebGpuBrushExecutionResult> {
    if (this.status === "disposed") {
      return Promise.resolve({ status: "rejected", reason: "disposed" });
    }
    if (this.status === "device-lost") {
      return Promise.resolve({ status: "rejected", reason: "device-lost" });
    }
    if (this.status !== "ready") {
      return Promise.resolve({ status: "rejected", reason: "runtime-failed" });
    }
    if (this.submissions - this.completedSubmissionSequence >= this.maxInFlightSubmissions) {
      return Promise.resolve({ status: "rejected", reason: "gpu-backpressure" });
    }
    const snapshot = snapshotFrame(input, this.maxDabs);
    if (snapshot.status === "rejected") return Promise.resolve(snapshot);
    return Promise.resolve(this.executeSnapshot(snapshot.frame, snapshot.plan));
  }

  private executeSnapshot(
    frame: StudioEngineWebGpuBrushFrame,
    plan: ValidPlan,
  ): StudioEngineWebGpuBrushExecutionResult {
    if (!positiveSafeInteger(frame.requestSequence)) {
      return { status: "rejected", reason: "invalid-request-sequence" };
    }
    if (frame.requestSequence <= this.lastPresentedRequestSequence) {
      return { status: "rejected", reason: "stale-request-sequence" };
    }
    if (frame.resizeEpoch !== this.resizeEpoch) {
      return { status: "rejected", reason: "resize-epoch-mismatch" };
    }
    if (
      frame.update.mode === "append"
      && (!this.hasRetainedBase || !sameRasterRect(this.retainedRasterRect, frame.rasterRect))
    ) return { status: "rejected", reason: "append-without-base" };
    if (!this.targetTexture || !this.presentationBindGroup) {
      this.failClosed();
      return { status: "rejected", reason: "runtime-failed" };
    }

    try {
      const instanceBuffer = this.ensureInstanceBuffer(plan.dabs.length);
      if (plan.dabs.length > 0 && !instanceBuffer) {
        throw new Error("WebGPU brush instance allocation failed");
      }
      const packed = packStudioEngineWebGpuBrushDabs(
        plan.dabs,
        frame.rasterRect,
        this.width,
        this.height,
        this.staging ?? undefined,
      );
      if (!this.staging || packed.buffer !== this.staging.buffer) {
        this.staging = new Float32Array(packed.buffer);
      }
      if (instanceBuffer && packed.byteLength > 0) {
        this.device.queue.writeBuffer(
          instanceBuffer,
          0,
          packed.buffer,
          packed.byteOffset,
          packed.byteLength,
        );
      }

      const encoder = this.device.createCommandEncoder({
        label: `Studio Engine Worker brush request ${frame.requestSequence}`,
      });
      const brushPass = encoder.beginRenderPass({
        label: `Studio Engine Worker RGBA16F brush request ${frame.requestSequence}`,
        colorAttachments: [{
          view: this.targetTexture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: frame.update.mode === "rebuild" ? "clear" : "load",
          storeOp: "store",
        }],
      });
      if (instanceBuffer) {
        brushPass.setVertexBuffer(0, instanceBuffer);
        for (const batch of plan.batches) {
          brushPass.setPipeline(
            batch.composite.porterDuff === "destination-out"
              ? this.resources.erasePipeline
              : this.resources.normalPipeline,
          );
          brushPass.draw(6, batch.instanceCount, 0, batch.firstInstance);
        }
      }
      brushPass.end();

      const presentationPass = encoder.beginRenderPass({
        label: `Studio Engine Worker brush presentation ${frame.requestSequence}`,
        colorAttachments: [{
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      presentationPass.setPipeline(this.resources.presentationPipeline);
      presentationPass.setBindGroup(0, this.presentationBindGroup);
      presentationPass.draw(3, 1, 0, 0);
      presentationPass.end();

      this.device.queue.submit([encoder.finish()]);
      this.submissions += 1;
      this.scheduleFence();
      this.hasRetainedBase = true;
      this.retainedRasterRect = Object.freeze({ ...frame.rasterRect });
      this.lastPresentedRequestSequence = frame.requestSequence;
      const receipt: StudioEngineWebGpuBrushReceipt = Object.freeze({
        kind: "studio-engine-webgpu-brush-receipt",
        revision: STUDIO_ENGINE_WEBGPU_BRUSH_RECEIPT_REVISION,
        backend: "webgpu",
        requestSequence: frame.requestSequence,
        resizeEpoch: this.resizeEpoch,
        deviceEpoch: this.deviceEpoch,
        width: this.width,
        height: this.height,
        textureFormat: STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT,
        colorModel: STUDIO_ENGINE_WEBGPU_BRUSH_COLOR_MODEL,
        workingColorSpace: STUDIO_ENGINE_WEBGPU_BRUSH_WORKING_COLOR_SPACE,
        inputColorEncoding: STUDIO_ENGINE_WEBGPU_BRUSH_INPUT_COLOR_ENCODING,
        presentationColorSpace: STUDIO_ENGINE_WEBGPU_BRUSH_PRESENTATION_COLOR_SPACE,
        mode: frame.update.mode,
        strokeId: plan.strokeId,
        loweringVersion: plan.loweringVersion,
        dabCount: plan.dabs.length,
        batchCount: plan.batches.length,
        batchOrder: Object.freeze(
          plan.batches.map((batch) => batch.composite.porterDuff),
        ),
        planFingerprint: fingerprintStudioEngineWebGpuBrushPlan(frame),
        queueState: "submitted",
        complete: true,
      });
      return { status: "presented", receipt };
    } catch {
      this.failClosed();
      return { status: "rejected", reason: "submission-failed" };
    }
  }

  public dispose(): void {
    if (this.status === "disposed") return;
    this.status = "disposed";
    this.releaseResources();
    safeUnconfigure(this.context);
    safeDestroyDevice(this.device, this.ownsDevice);
  }

  private ensureInstanceBuffer(required: number): GPUBuffer | null {
    if (required === 0) return null;
    if (this.instanceBuffer && this.instanceCapacity >= required) return this.instanceBuffer;
    const capacity = nextCapacity(required, this.maxDabs);
    const replacement = this.device.createBuffer({
      label: `Studio Engine Worker rich brush instances ${capacity}`,
      size: capacity * STUDIO_ENGINE_WEBGPU_BRUSH_INSTANCE_BYTES,
      usage: GPU_BUFFER_VERTEX | GPU_BUFFER_COPY_DST,
    });
    safeDestroyBuffer(this.instanceBuffer);
    this.instanceBuffer = replacement;
    this.instanceCapacity = capacity;
    this.instanceBufferAllocations += 1;
    return replacement;
  }

  /**
   * One asynchronous fence covers a bounded generation of ordered submissions. Live append returns
   * after queue acceptance instead of paying a full GPU round trip. A rejected fence invalidates
   * the disposable GPU mirror; canonical commands remain the rebuild authority.
   */
  private scheduleFence(): void {
    if (this.fencePending || this.status !== "ready") return;
    this.fencePending = true;
    const targetSubmission = this.submissions;
    void this.device.queue.onSubmittedWorkDone().then(
      () => {
        this.fencePending = false;
        if (this.status !== "ready") return;
        this.completedSubmissionSequence = Math.max(
          this.completedSubmissionSequence,
          targetSubmission,
        );
        if (this.completedSubmissionSequence < this.submissions) this.scheduleFence();
      },
      () => {
        this.fencePending = false;
        this.failClosed();
      },
    );
  }

  private handleDeviceLost(info: GPUDeviceLostInfo): void {
    if (this.status === "disposed" || this.status === "device-lost") return;
    this.status = "device-lost";
    if (this.deviceEpoch < Number.MAX_SAFE_INTEGER) this.deviceEpoch += 1;
    this.releaseResources();
    safeUnconfigure(this.context);
    this.onDeviceLost?.(info);
  }

  private failClosed(): void {
    if (this.status !== "ready") return;
    this.status = "failed";
    this.releaseResources();
    safeUnconfigure(this.context);
  }

  private releaseResources(): void {
    safeDestroyBuffer(this.instanceBuffer);
    safeDestroyTexture(this.targetTexture);
    this.instanceBuffer = null;
    this.targetTexture = null;
    this.presentationBindGroup = null;
    this.staging = null;
    this.instanceCapacity = 0;
    this.hasRetainedBase = false;
    this.retainedRasterRect = null;
  }
}
