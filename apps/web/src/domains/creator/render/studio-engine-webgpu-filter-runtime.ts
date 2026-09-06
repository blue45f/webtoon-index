import { announceStudioGpuDeviceLoss } from "../studio-safe-mode-runtime";

import {
  STUDIO_CANONICAL_FILTER_CURVE_LUT_SIZE,
  buildStudioCanonicalFilterCurveLut,
  buildStudioCanonicalGaussianKernel,
  hashStudioCanonicalFilterRecipe,
  parseStudioCanonicalFilterRecipe,
  planStudioCanonicalFilterExecution,
} from "./studio-engine-canonical-filter-plan";

import type {
  StudioCanonicalFilterExecutionPlan,
  StudioCanonicalFilterExecutionStage,
  StudioCanonicalFilterOperationNode,
  StudioCanonicalFilterRecipe,
  StudioCanonicalFilterTileDispatch,
} from "./studio-engine-canonical-filter-plan";

/**
 * Future-only WebGPU filter executor.
 *
 * There is intentionally no Canvas2D, WebGL or encoded-RGBA8 fallback. The caller retains the
 * canonical recipe and may retry on a new device epoch; a rejected execution never substitutes a
 * lower-quality algorithm.
 */

export const STUDIO_ENGINE_WEBGPU_FILTER_RUNTIME_VERSION = 1 as const;
export const STUDIO_ENGINE_WEBGPU_FILTER_TEXTURE_FORMAT = "rgba16float" as const;
export const STUDIO_ENGINE_WEBGPU_FILTER_WORKGROUP_SIZE = 8 as const;

const GPU_TEXTURE_COPY_SRC = 0x01;
const GPU_TEXTURE_COPY_DST = 0x02;
const GPU_TEXTURE_BINDING = 0x04;
const GPU_STORAGE_BINDING = 0x08;
const GPU_BUFFER_COPY_DST = 0x08;
const GPU_BUFFER_UNIFORM = 0x40;
const GPU_BUFFER_STORAGE = 0x80;
const RGBA16F_BYTES_PER_PIXEL = 8;

const BORDER_CLAMP = 0;
const BORDER_REFLECT = 1;
const BORDER_TRANSPARENT = 2;

const POINT_EXPOSURE_CONTRAST = 1;
const POINT_LEVELS = 2;
const POINT_THRESHOLD_LUMINANCE = 3;
const POINT_THRESHOLD_CHANNEL = 4;
const POINT_POSTERIZE = 5;

const MATRIX_COLOR = 1;
const MATRIX_CHANNEL_MIXER = 2;

const TILE_UNIFORM_BYTES = 144;

const WGSL_TILE_COMMON = /* wgsl */ `
struct TileParams {
  image_size: vec2u,
  tile_origin: vec2u,
  tile_extent: vec2u,
  direction: vec2i,
  radius: u32,
  border_mode: u32,
  operation: u32,
  _pad0: u32,
  values0: vec4f,
  values1: vec4f,
  values2: vec4f,
  values3: vec4f,
  values4: vec4f,
  values5: vec4f,
}

fn reflect_axis(value: i32, size: i32) -> i32 {
  if (size <= 1) { return 0; }
  let period = 2 * (size - 1);
  let wrapped = ((value % period) + period) % period;
  return select(period - wrapped, wrapped, wrapped < size);
}

fn resolve_axis(value: i32, size: i32, mode: u32) -> i32 {
  if (value >= 0 && value < size) { return value; }
  if (mode == ${BORDER_TRANSPARENT}u) { return -1; }
  if (mode == ${BORDER_CLAMP}u) { return clamp(value, 0, size - 1); }
  return reflect_axis(value, size);
}

fn load_border(source: texture_2d<f32>, coordinate: vec2i, params: TileParams) -> vec4f {
  let x = resolve_axis(coordinate.x, i32(params.image_size.x), params.border_mode);
  let y = resolve_axis(coordinate.y, i32(params.image_size.y), params.border_mode);
  if (x < 0 || y < 0) { return vec4f(0.0); }
  return textureLoad(source, vec2i(x, y), 0);
}

fn tile_pixel(gid: vec3u, params: TileParams) -> vec2u {
  return params.tile_origin + gid.xy;
}

fn outside_tile(gid: vec3u, params: TileParams) -> bool {
  return gid.x >= params.tile_extent.x || gid.y >= params.tile_extent.y;
}

fn unpremultiply(value: vec4f) -> vec4f {
  let alpha = clamp(value.a, 0.0, 1.0);
  if (alpha <= 0.00000001) { return vec4f(0.0); }
  return vec4f(value.rgb / alpha, alpha);
}

fn premultiply(value: vec4f) -> vec4f {
  let alpha = clamp(value.a, 0.0, 1.0);
  if (alpha <= 0.00000001) { return vec4f(0.0); }
  let premultiplied = clamp(
    value.rgb * alpha,
    vec3f(-65504.0),
    vec3f(65504.0),
  );
  return vec4f(premultiplied, alpha);
}
`;

export const STUDIO_ENGINE_WEBGPU_FILTER_GAUSSIAN_WGSL = /* wgsl */ `
${WGSL_TILE_COMMON}
@group(0) @binding(0) var source_texture: texture_2d<f32>;
@group(0) @binding(1) var target_texture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<storage, read> gaussian_weights: array<f32>;
@group(0) @binding(3) var<uniform> params: TileParams;

@compute @workgroup_size(${STUDIO_ENGINE_WEBGPU_FILTER_WORKGROUP_SIZE}, ${STUDIO_ENGINE_WEBGPU_FILTER_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (outside_tile(gid, params)) { return; }
  let pixel = tile_pixel(gid, params);
  var sum = vec4f(0.0);
  for (var offset = -i32(params.radius); offset <= i32(params.radius); offset += 1) {
    let coordinate = vec2i(pixel) + params.direction * offset;
    sum += load_border(source_texture, coordinate, params)
      * gaussian_weights[u32(offset + i32(params.radius))];
  }
  textureStore(target_texture, vec2i(pixel), sum);
}
`;

export const STUDIO_ENGINE_WEBGPU_FILTER_UNSHARP_WGSL = /* wgsl */ `
${WGSL_TILE_COMMON}
@group(0) @binding(0) var original_texture: texture_2d<f32>;
@group(0) @binding(1) var blurred_texture: texture_2d<f32>;
@group(0) @binding(2) var target_texture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> params: TileParams;

fn soft_threshold(value: f32, threshold: f32) -> f32 {
  if (threshold <= 0.0) { return 1.0; }
  let position = clamp((value - threshold) / threshold, 0.0, 1.0);
  return position * position * (3.0 - 2.0 * position);
}

@compute @workgroup_size(${STUDIO_ENGINE_WEBGPU_FILTER_WORKGROUP_SIZE}, ${STUDIO_ENGINE_WEBGPU_FILTER_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (outside_tile(gid, params)) { return; }
  let pixel = tile_pixel(gid, params);
  let original = unpremultiply(textureLoad(original_texture, vec2i(pixel), 0));
  let blurred = unpremultiply(textureLoad(blurred_texture, vec2i(pixel), 0));
  let delta = original.rgb - blurred.rgb;
  let gate = vec3f(
    soft_threshold(abs(delta.r), params.values0.y),
    soft_threshold(abs(delta.g), params.values0.y),
    soft_threshold(abs(delta.b), params.values0.y),
  );
  let sharpened = original.rgb + delta * params.values0.x * gate;
  textureStore(target_texture, vec2i(pixel), premultiply(vec4f(sharpened, original.a)));
}
`;

export const STUDIO_ENGINE_WEBGPU_FILTER_POINT_WGSL = /* wgsl */ `
${WGSL_TILE_COMMON}
@group(0) @binding(0) var source_texture: texture_2d<f32>;
@group(0) @binding(1) var target_texture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> params: TileParams;

fn apply_levels(value: vec3f) -> vec3f {
  let normalized = clamp(
    (value - params.values0.xyz) / (params.values1.xyz - params.values0.xyz),
    vec3f(0.0),
    vec3f(1.0),
  );
  let corrected = pow(normalized, vec3f(1.0) / params.values2.xyz);
  return params.values3.xyz + corrected * (params.values4.xyz - params.values3.xyz);
}

@compute @workgroup_size(${STUDIO_ENGINE_WEBGPU_FILTER_WORKGROUP_SIZE}, ${STUDIO_ENGINE_WEBGPU_FILTER_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (outside_tile(gid, params)) { return; }
  let pixel = tile_pixel(gid, params);
  let straight = unpremultiply(textureLoad(source_texture, vec2i(pixel), 0));
  var rgb = straight.rgb;
  if (params.operation == ${POINT_EXPOSURE_CONTRAST}u) {
    let exposed = rgb * exp2(params.values0.x);
    rgb = (exposed - vec3f(params.values0.z)) * params.values0.y + vec3f(params.values0.z);
  } else if (params.operation == ${POINT_LEVELS}u) {
    rgb = apply_levels(rgb);
  } else if (params.operation == ${POINT_THRESHOLD_LUMINANCE}u) {
    let luminance = dot(rgb, params.values0.xyz);
    rgb = vec3f(select(0.0, 1.0, luminance >= params.values0.w));
  } else if (params.operation == ${POINT_THRESHOLD_CHANNEL}u) {
    rgb = vec3f(
      select(0.0, 1.0, rgb.r >= params.values0.x),
      select(0.0, 1.0, rgb.g >= params.values0.x),
      select(0.0, 1.0, rgb.b >= params.values0.x),
    );
  } else if (params.operation == ${POINT_POSTERIZE}u) {
    let scale = params.values0.x - 1.0;
    // WGSL round() uses ties-to-even, while the canonical CPU oracle intentionally follows
    // JavaScript Math.round() for non-negative posterize bins (half ties toward +infinity).
    rgb = floor(clamp(rgb, vec3f(0.0), vec3f(1.0)) * scale + vec3f(0.5)) / scale;
  } else {
    // No default approximation: the CPU-side runtime never dispatches an unknown operation.
    return;
  }
  textureStore(target_texture, vec2i(pixel), premultiply(vec4f(rgb, straight.a)));
}
`;

export const STUDIO_ENGINE_WEBGPU_FILTER_MATRIX_WGSL = /* wgsl */ `
${WGSL_TILE_COMMON}
@group(0) @binding(0) var source_texture: texture_2d<f32>;
@group(0) @binding(1) var target_texture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<storage, read> coefficients: array<f32>;
@group(0) @binding(3) var<uniform> params: TileParams;

@compute @workgroup_size(${STUDIO_ENGINE_WEBGPU_FILTER_WORKGROUP_SIZE}, ${STUDIO_ENGINE_WEBGPU_FILTER_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (outside_tile(gid, params)) { return; }
  let pixel = tile_pixel(gid, params);
  let straight = unpremultiply(textureLoad(source_texture, vec2i(pixel), 0));
  if (params.operation == ${MATRIX_COLOR}u) {
    let input = array<f32, 5>(straight.r, straight.g, straight.b, straight.a, 1.0);
    var output = vec4f(0.0);
    for (var row = 0u; row < 4u; row += 1u) {
      var value = 0.0;
      for (var column = 0u; column < 5u; column += 1u) {
        value += coefficients[row * 5u + column] * input[column];
      }
      output[row] = value;
    }
    textureStore(target_texture, vec2i(pixel), premultiply(output));
    return;
  }
  if (params.operation == ${MATRIX_CHANNEL_MIXER}u) {
    let input = array<f32, 4>(straight.r, straight.g, straight.b, 1.0);
    var output = vec3f(0.0);
    for (var row = 0u; row < 3u; row += 1u) {
      var value = 0.0;
      for (var column = 0u; column < 4u; column += 1u) {
        value += coefficients[row * 4u + column] * input[column];
      }
      output[row] = value;
    }
    textureStore(target_texture, vec2i(pixel), premultiply(vec4f(output, straight.a)));
  }
}
`;

export const STUDIO_ENGINE_WEBGPU_FILTER_CURVES_WGSL = /* wgsl */ `
${WGSL_TILE_COMMON}
@group(0) @binding(0) var source_texture: texture_2d<f32>;
@group(0) @binding(1) var target_texture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<storage, read> curves: array<f32>;
@group(0) @binding(3) var<uniform> params: TileParams;

fn curve_sample(channel: u32, input: f32) -> f32 {
  let position = clamp(input, 0.0, 1.0) * f32(${STUDIO_CANONICAL_FILTER_CURVE_LUT_SIZE - 1});
  let lower = u32(floor(position));
  let upper = min(lower + 1u, ${STUDIO_CANONICAL_FILTER_CURVE_LUT_SIZE - 1}u);
  let fraction = position - f32(lower);
  let base = channel * ${STUDIO_CANONICAL_FILTER_CURVE_LUT_SIZE}u;
  return mix(curves[base + lower], curves[base + upper], fraction);
}

@compute @workgroup_size(${STUDIO_ENGINE_WEBGPU_FILTER_WORKGROUP_SIZE}, ${STUDIO_ENGINE_WEBGPU_FILTER_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (outside_tile(gid, params)) { return; }
  let pixel = tile_pixel(gid, params);
  let straight = unpremultiply(textureLoad(source_texture, vec2i(pixel), 0));
  let master = vec3f(
    curve_sample(0u, straight.r),
    curve_sample(0u, straight.g),
    curve_sample(0u, straight.b),
  );
  let corrected = vec3f(
    curve_sample(1u, master.r),
    curve_sample(2u, master.g),
    curve_sample(3u, master.b),
  );
  textureStore(target_texture, vec2i(pixel), premultiply(vec4f(corrected, straight.a)));
}
`;

export const STUDIO_ENGINE_WEBGPU_FILTER_MORPHOLOGY_WGSL = /* wgsl */ `
${WGSL_TILE_COMMON}
@group(0) @binding(0) var source_texture: texture_2d<f32>;
@group(0) @binding(1) var target_texture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> params: TileParams;

@compute @workgroup_size(${STUDIO_ENGINE_WEBGPU_FILTER_WORKGROUP_SIZE}, ${STUDIO_ENGINE_WEBGPU_FILTER_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (outside_tile(gid, params)) { return; }
  let pixel = tile_pixel(gid, params);
  let use_max = params.operation == 1u;
  var best_alpha = select(1e30, -1e30, use_max);
  var best = vec4f(0.0);
  for (var offset = -i32(params.radius); offset <= i32(params.radius); offset += 1) {
    let sample = load_border(
      source_texture,
      vec2i(pixel) + params.direction * offset,
      params,
    );
    // Parentheses keep the less-than comparison unambiguous inside select().
    let better = select((sample.a < best_alpha), (sample.a > best_alpha), use_max);
    if (better) {
      best_alpha = sample.a;
      best = sample;
    }
  }
  textureStore(target_texture, vec2i(pixel), best);
}
`;

export const STUDIO_ENGINE_WEBGPU_FILTER_KERNELS = Object.freeze({
  gaussian: {
    id: "gaussian",
    wgsl: STUDIO_ENGINE_WEBGPU_FILTER_GAUSSIAN_WGSL,
    entryPoint: "main",
  },
  unsharp: {
    id: "unsharp",
    wgsl: STUDIO_ENGINE_WEBGPU_FILTER_UNSHARP_WGSL,
    entryPoint: "main",
  },
  point: {
    id: "point",
    wgsl: STUDIO_ENGINE_WEBGPU_FILTER_POINT_WGSL,
    entryPoint: "main",
  },
  matrix: {
    id: "matrix",
    wgsl: STUDIO_ENGINE_WEBGPU_FILTER_MATRIX_WGSL,
    entryPoint: "main",
  },
  curves: {
    id: "curves",
    wgsl: STUDIO_ENGINE_WEBGPU_FILTER_CURVES_WGSL,
    entryPoint: "main",
  },
  morphology: {
    id: "morphology",
    wgsl: STUDIO_ENGINE_WEBGPU_FILTER_MORPHOLOGY_WGSL,
    entryPoint: "main",
  },
} as const);

export type StudioEngineWebGpuFilterKernelId = keyof typeof STUDIO_ENGINE_WEBGPU_FILTER_KERNELS;

export interface StudioEngineWebGpuFilterRuntimeBudgets {
  readonly maxPixels: number;
  readonly maxStages: number;
  readonly maxDispatches: number;
  readonly maxIntermediateTextures: number;
  readonly maxIntermediateBytes: number;
  readonly maxInFlightSubmissions: number;
}

export const STUDIO_ENGINE_WEBGPU_FILTER_DEFAULT_BUDGETS =
  Object.freeze<StudioEngineWebGpuFilterRuntimeBudgets>({
    maxPixels: 67_108_864,
    maxStages: 192,
    maxDispatches: 262_144,
    maxIntermediateTextures: 96,
    maxIntermediateBytes: 512 * 1024 * 1024,
    maxInFlightSubmissions: 2,
  });

export interface StudioEngineWebGpuFilterRuntimeOptions {
  readonly device: GPUDevice;
  readonly ownsDevice?: boolean;
  readonly initialDeviceEpoch?: number;
  readonly initialRequestEpoch?: number;
  readonly budgets?: Partial<StudioEngineWebGpuFilterRuntimeBudgets>;
  readonly onDeviceLost?: (info: GPUDeviceLostInfo) => void;
}

export interface StudioEngineWebGpuFilterExecutionRequest {
  readonly recipe: StudioCanonicalFilterRecipe;
  readonly plan: StudioCanonicalFilterExecutionPlan;
  readonly sourceTexture: GPUTexture;
  readonly targetTexture: GPUTexture;
  readonly requestSequence: number;
  readonly requestEpoch: number;
  readonly deviceEpoch: number;
  readonly signal?: AbortSignal;
}

export interface StudioEngineWebGpuFilterReceipt {
  readonly kind: "studio-engine-webgpu-filter-receipt";
  readonly version: typeof STUDIO_ENGINE_WEBGPU_FILTER_RUNTIME_VERSION;
  readonly backend: "webgpu";
  readonly requestSequence: number;
  readonly requestEpoch: number;
  readonly deviceEpoch: number;
  readonly recipeHash: string;
  readonly width: number;
  readonly height: number;
  readonly textureFormat: typeof STUDIO_ENGINE_WEBGPU_FILTER_TEXTURE_FORMAT;
  readonly workingSpace: StudioCanonicalFilterRecipe["color"]["workingSpace"];
  readonly storageAlphaMode: "premultiplied";
  readonly filterMathAlphaMode: "straight";
  readonly stageCount: number;
  readonly dispatchCount: number;
  readonly queueState: "completed";
  readonly complete: true;
}

export type StudioEngineWebGpuFilterRejectionReason =
  | "runtime-disposed"
  | "runtime-failed"
  | "device-lost"
  | "cancelled"
  | "request-epoch-mismatch"
  | "device-epoch-mismatch"
  | "invalid-request-sequence"
  | "stale-request-sequence"
  | "gpu-backpressure"
  | "invalid-recipe"
  | "recipe-plan-mismatch"
  | "invalid-plan"
  | "incompatible-texture"
  | "resource-budget-exceeded"
  | "device-limit-exceeded"
  | "unsupported-node"
  | "submission-failed"
  | "queue-failed";

export type StudioEngineWebGpuFilterExecutionResult =
  | { readonly status: "completed"; readonly receipt: StudioEngineWebGpuFilterReceipt }
  | { readonly status: "rejected"; readonly reason: StudioEngineWebGpuFilterRejectionReason };

export interface StudioEngineWebGpuFilterRuntimeStats {
  readonly status: "ready" | "failed" | "device-lost" | "disposed";
  readonly requestEpoch: number;
  readonly deviceEpoch: number;
  readonly lastSubmittedRequestSequence: number;
  readonly submitted: number;
  readonly completed: number;
  readonly inFlight: number;
  readonly pipelineCount: number;
}

interface SubmissionResources {
  readonly textures: GPUTexture[];
  readonly buffers: GPUBuffer[];
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function positiveBudget(value: number | undefined, fallback: number): number {
  return positiveSafeInteger(value) ? value : fallback;
}

function normalizeBudgets(
  value: Partial<StudioEngineWebGpuFilterRuntimeBudgets> | undefined,
): StudioEngineWebGpuFilterRuntimeBudgets {
  return Object.freeze({
    maxPixels: positiveBudget(value?.maxPixels, STUDIO_ENGINE_WEBGPU_FILTER_DEFAULT_BUDGETS.maxPixels),
    maxStages: positiveBudget(value?.maxStages, STUDIO_ENGINE_WEBGPU_FILTER_DEFAULT_BUDGETS.maxStages),
    maxDispatches: positiveBudget(
      value?.maxDispatches,
      STUDIO_ENGINE_WEBGPU_FILTER_DEFAULT_BUDGETS.maxDispatches,
    ),
    maxIntermediateTextures: positiveBudget(
      value?.maxIntermediateTextures,
      STUDIO_ENGINE_WEBGPU_FILTER_DEFAULT_BUDGETS.maxIntermediateTextures,
    ),
    maxIntermediateBytes: positiveBudget(
      value?.maxIntermediateBytes,
      STUDIO_ENGINE_WEBGPU_FILTER_DEFAULT_BUDGETS.maxIntermediateBytes,
    ),
    maxInFlightSubmissions: positiveBudget(
      value?.maxInFlightSubmissions,
      STUDIO_ENGINE_WEBGPU_FILTER_DEFAULT_BUDGETS.maxInFlightSubmissions,
    ),
  });
}

function safeDestroyBuffer(buffer: GPUBuffer | null | undefined): void {
  try {
    buffer?.destroy();
  } catch {
    // Device-loss cleanup is best-effort; the authoritative canonical recipe remains intact.
  }
}

function safeDestroyTexture(texture: GPUTexture | null | undefined): void {
  try {
    texture?.destroy();
  } catch {
    // Device-loss cleanup is best-effort.
  }
}

function safeDestroyDevice(device: GPUDevice, owned: boolean): void {
  if (!owned) return;
  try {
    device.destroy();
  } catch {
    // A lost device may reject explicit destruction.
  }
}

function destroyResources(resources: SubmissionResources): void {
  for (const buffer of resources.buffers) safeDestroyBuffer(buffer);
  for (const texture of resources.textures) safeDestroyTexture(texture);
}

function borderCode(mode: StudioCanonicalFilterExecutionStage["borderMode"]): number {
  if (mode === "transparent") return BORDER_TRANSPARENT;
  if (mode === "reflect") return BORDER_REFLECT;
  return BORDER_CLAMP;
}

function luminanceFor(
  primaries: StudioCanonicalFilterRecipe["color"]["primaries"],
): readonly [number, number, number] {
  if (primaries === "display-p3") return [0.228_974_56, 0.691_738_52, 0.079_286_91];
  if (primaries === "rec2020") return [0.2627, 0.678, 0.0593];
  return [0.2126, 0.7152, 0.0722];
}

interface TileUniformValues {
  readonly directionX?: number;
  readonly directionY?: number;
  readonly radius?: number;
  readonly borderMode?: number;
  readonly operation?: number;
  readonly values?: readonly (readonly number[])[];
}

function packTileUniform(
  plan: StudioCanonicalFilterExecutionPlan,
  tile: StudioCanonicalFilterTileDispatch,
  extra: TileUniformValues = {},
): ArrayBuffer {
  const buffer = new ArrayBuffer(TILE_UNIFORM_BYTES);
  const view = new DataView(buffer);
  view.setUint32(0, plan.width, true);
  view.setUint32(4, plan.height, true);
  view.setUint32(8, tile.core.x, true);
  view.setUint32(12, tile.core.y, true);
  view.setUint32(16, tile.core.width, true);
  view.setUint32(20, tile.core.height, true);
  view.setInt32(24, extra.directionX ?? 0, true);
  view.setInt32(28, extra.directionY ?? 0, true);
  view.setUint32(32, extra.radius ?? 0, true);
  view.setUint32(36, extra.borderMode ?? BORDER_CLAMP, true);
  view.setUint32(40, extra.operation ?? 0, true);
  for (let row = 0; row < Math.min(6, extra.values?.length ?? 0); row += 1) {
    const values = extra.values![row]!;
    for (let column = 0; column < Math.min(4, values.length); column += 1) {
      view.setFloat32(48 + row * 16 + column * 4, values[column]!, true);
    }
  }
  return buffer;
}

function nodeTextureCount(node: StudioCanonicalFilterOperationNode): number {
  if (node.kind === "unsharp-mask") return 3;
  if (node.kind === "gaussian-blur" || node.kind === "morphology") return 2;
  return 1;
}

function stageFor(
  plan: StudioCanonicalFilterExecutionPlan,
  nodeId: string,
  pass: StudioCanonicalFilterExecutionStage["pass"],
): StudioCanonicalFilterExecutionStage | null {
  return plan.stages.find((stage) => stage.nodeId === nodeId && stage.pass === pass) ?? null;
}

function pointUniform(
  recipe: StudioCanonicalFilterRecipe,
  node: StudioCanonicalFilterOperationNode,
): TileUniformValues | null {
  switch (node.kind) {
    case "exposure-contrast":
      return {
        operation: POINT_EXPOSURE_CONTRAST,
        values: [[node.exposureStops, node.contrast, node.pivot, 0]],
      };
    case "levels":
      return {
        operation: POINT_LEVELS,
        values: [
          node.inputBlack,
          node.inputWhite,
          node.gamma,
          node.outputBlack,
          node.outputWhite,
        ],
      };
    case "threshold": {
      if (node.mode === "per-channel") {
        return { operation: POINT_THRESHOLD_CHANNEL, values: [[node.threshold, 0, 0, 0]] };
      }
      const luminance = luminanceFor(recipe.color.primaries);
      return {
        operation: POINT_THRESHOLD_LUMINANCE,
        values: [[luminance[0], luminance[1], luminance[2], node.threshold]],
      };
    }
    case "posterize":
      return { operation: POINT_POSTERIZE, values: [[node.levels, 0, 0, 0]] };
    default:
      return null;
  }
}

function createFloatStorageBuffer(
  device: GPUDevice,
  values: Float32Array,
  label: string,
): GPUBuffer {
  const buffer = device.createBuffer({
    label,
    size: Math.max(16, Math.ceil(values.byteLength / 16) * 16),
    usage: GPU_BUFFER_STORAGE | GPU_BUFFER_COPY_DST,
  });
  device.queue.writeBuffer(buffer, 0, values.buffer, values.byteOffset, values.byteLength);
  return buffer;
}

function createUniformBuffer(device: GPUDevice, bytes: ArrayBuffer, label: string): GPUBuffer {
  const buffer = device.createBuffer({
    label,
    size: Math.ceil(bytes.byteLength / 16) * 16,
    usage: GPU_BUFFER_UNIFORM | GPU_BUFFER_COPY_DST,
  });
  device.queue.writeBuffer(buffer, 0, bytes);
  return buffer;
}

interface DispatchBindings {
  readonly kernel: StudioEngineWebGpuFilterKernelId;
  readonly entries: GPUBindGroupEntry[];
  readonly uniformBinding: number;
  readonly uniform: TileUniformValues;
}

export class StudioEngineWebGpuFilterRuntime {
  private readonly device: GPUDevice;
  private readonly ownsDevice: boolean;
  private readonly budgets: StudioEngineWebGpuFilterRuntimeBudgets;
  private readonly onDeviceLost: ((info: GPUDeviceLostInfo) => void) | undefined;
  private readonly modules = new Map<StudioEngineWebGpuFilterKernelId, GPUShaderModule>();
  private readonly pipelines = new Map<StudioEngineWebGpuFilterKernelId, GPUComputePipeline>();
  private status: StudioEngineWebGpuFilterRuntimeStats["status"] = "ready";
  private requestEpoch: number;
  private deviceEpoch: number;
  private lastSubmittedRequestSequence = 0;
  private submitted = 0;
  private completed = 0;
  private inFlight = 0;

  public constructor(options: StudioEngineWebGpuFilterRuntimeOptions) {
    this.device = options.device;
    this.ownsDevice = options.ownsDevice === true;
    this.budgets = normalizeBudgets(options.budgets);
    this.onDeviceLost = options.onDeviceLost;
    this.deviceEpoch = positiveSafeInteger(options.initialDeviceEpoch)
      ? options.initialDeviceEpoch
      : 1;
    this.requestEpoch = positiveSafeInteger(options.initialRequestEpoch)
      ? options.initialRequestEpoch
      : 1;
    void this.device.lost.then(
      (info) => this.handleDeviceLost(info),
      () => this.handleDeviceLost({ reason: "unknown", message: "device lost" } as GPUDeviceLostInfo),
    );
  }

  public getStats(): StudioEngineWebGpuFilterRuntimeStats {
    return Object.freeze({
      status: this.status,
      requestEpoch: this.requestEpoch,
      deviceEpoch: this.deviceEpoch,
      lastSubmittedRequestSequence: this.lastSubmittedRequestSequence,
      submitted: this.submitted,
      completed: this.completed,
      inFlight: this.inFlight,
      pipelineCount: this.pipelines.size,
    });
  }

  /** Invalidates queued caller work without pretending already submitted GPU commands disappeared. */
  public invalidateRequests(): number {
    if (this.requestEpoch < Number.MAX_SAFE_INTEGER) this.requestEpoch += 1;
    return this.requestEpoch;
  }

  private getPipeline(id: StudioEngineWebGpuFilterKernelId): GPUComputePipeline {
    const cached = this.pipelines.get(id);
    if (cached) return cached;
    const kernel = STUDIO_ENGINE_WEBGPU_FILTER_KERNELS[id];
    const module = this.device.createShaderModule({
      label: `Studio canonical filter ${kernel.id}`,
      code: kernel.wgsl,
    });
    const pipeline = this.device.createComputePipeline({
      label: `Studio canonical filter ${kernel.id}`,
      layout: "auto",
      compute: { module, entryPoint: kernel.entryPoint },
    });
    this.modules.set(id, module);
    this.pipelines.set(id, pipeline);
    return pipeline;
  }

  private validateRequest(
    request: StudioEngineWebGpuFilterExecutionRequest,
  ): StudioEngineWebGpuFilterRejectionReason | null {
    if (this.status === "disposed") return "runtime-disposed";
    if (this.status === "device-lost") return "device-lost";
    if (this.status !== "ready") return "runtime-failed";
    if (request.signal?.aborted) return "cancelled";
    if (request.requestEpoch !== this.requestEpoch) return "request-epoch-mismatch";
    if (request.deviceEpoch !== this.deviceEpoch) return "device-epoch-mismatch";
    if (!positiveSafeInteger(request.requestSequence)) return "invalid-request-sequence";
    if (request.requestSequence <= this.lastSubmittedRequestSequence) {
      return "stale-request-sequence";
    }
    if (this.inFlight >= this.budgets.maxInFlightSubmissions) return "gpu-backpressure";
    const parsed = parseStudioCanonicalFilterRecipe(request.recipe);
    if (!parsed.ok) return parsed.reason === "unsupported-node" ? "unsupported-node" : "invalid-recipe";
    const recipeHash = hashStudioCanonicalFilterRecipe(parsed.value);
    if (request.plan.recipeHash !== recipeHash) return "recipe-plan-mismatch";
    if (
      request.plan.kind !== "studio-canonical-filter-execution-plan"
      || request.plan.version !== 1
      || request.plan.textureFormat !== STUDIO_ENGINE_WEBGPU_FILTER_TEXTURE_FORMAT
      || request.plan.workingSpace !== parsed.value.color.workingSpace
      || request.plan.storageAlphaMode !== "premultiplied"
      || request.plan.filterMathAlphaMode !== "straight"
      || request.plan.width <= 0
      || request.plan.height <= 0
      || request.plan.width > Math.floor(this.budgets.maxPixels / request.plan.height)
      || request.plan.stages.length > this.budgets.maxStages
      || request.plan.dispatchCount > this.budgets.maxDispatches
      || request.plan.dispatchCount
        !== request.plan.stages.reduce((count, stage) => count + stage.tiles.length, 0)
    ) return "invalid-plan";
    if (
      request.sourceTexture.width !== request.plan.width
      || request.sourceTexture.height !== request.plan.height
      || request.sourceTexture.format !== STUDIO_ENGINE_WEBGPU_FILTER_TEXTURE_FORMAT
      || (request.sourceTexture.usage & GPU_TEXTURE_BINDING) === 0
      || (request.sourceTexture.usage & GPU_TEXTURE_COPY_SRC) === 0
      || request.targetTexture.width !== request.plan.width
      || request.targetTexture.height !== request.plan.height
      || request.targetTexture.format !== STUDIO_ENGINE_WEBGPU_FILTER_TEXTURE_FORMAT
      || (request.targetTexture.usage & GPU_TEXTURE_COPY_DST) === 0
    ) return "incompatible-texture";
    const expectedPlan = planStudioCanonicalFilterExecution(
      parsed.value,
      request.plan.width,
      request.plan.height,
      {
        tileSize: request.plan.tileSize,
        maxPixels: this.budgets.maxPixels,
        maxDispatches: this.budgets.maxDispatches,
      },
    );
    if (
      expectedPlan.status !== "ready"
      || JSON.stringify(expectedPlan.plan) !== JSON.stringify(request.plan)
    ) return "invalid-plan";
    const maxDimension = this.device.limits.maxTextureDimension2D ?? 8_192;
    if (request.plan.width > maxDimension || request.plan.height > maxDimension) {
      return "device-limit-exceeded";
    }
    for (const stage of request.plan.stages) {
      for (const tile of stage.tiles) {
        if (
          tile.workgroupsX > this.device.limits.maxComputeWorkgroupsPerDimension
          || tile.workgroupsY > this.device.limits.maxComputeWorkgroupsPerDimension
        ) return "device-limit-exceeded";
      }
    }
    const operations = parsed.value.nodes.filter(
      (node): node is StudioCanonicalFilterOperationNode => node.kind !== "input",
    );
    const textureCount = operations.reduce((count, node) => count + nodeTextureCount(node), 0);
    const textureBytes = textureCount
      * request.plan.width
      * request.plan.height
      * RGBA16F_BYTES_PER_PIXEL;
    if (
      textureCount > this.budgets.maxIntermediateTextures
      || !Number.isSafeInteger(textureBytes)
      || textureBytes > this.budgets.maxIntermediateBytes
    ) return "resource-budget-exceeded";
    if (Object.is(request.sourceTexture, request.targetTexture)) return "invalid-plan";
    return null;
  }

  public async execute(
    request: StudioEngineWebGpuFilterExecutionRequest,
  ): Promise<StudioEngineWebGpuFilterExecutionResult> {
    const rejection = this.validateRequest(request);
    if (rejection) return { status: "rejected", reason: rejection };
    const requestEpoch = this.requestEpoch;
    const deviceEpoch = this.deviceEpoch;
    const resources: SubmissionResources = { textures: [], buffers: [] };
    this.lastSubmittedRequestSequence = request.requestSequence;
    this.inFlight += 1;
    this.submitted += 1;

    try {
      const encoder = this.device.createCommandEncoder({
        label: `Studio canonical RGBA16F filter ${request.requestSequence}`,
      });
      this.encodeRecipe(encoder, request, resources);
      this.device.queue.submit([encoder.finish()]);
    } catch {
      destroyResources(resources);
      this.inFlight -= 1;
      this.failClosed();
      return { status: "rejected", reason: "submission-failed" };
    }

    try {
      await this.device.queue.onSubmittedWorkDone();
    } catch {
      destroyResources(resources);
      this.inFlight -= 1;
      this.failClosed();
      return { status: "rejected", reason: "queue-failed" };
    }
    destroyResources(resources);
    this.inFlight -= 1;
    this.completed += 1;
    if (this.status === "device-lost" || deviceEpoch !== this.deviceEpoch) {
      return { status: "rejected", reason: "device-lost" };
    }
    if (this.status !== "ready") return { status: "rejected", reason: "runtime-failed" };
    if (request.signal?.aborted) return { status: "rejected", reason: "cancelled" };
    if (requestEpoch !== this.requestEpoch) {
      return { status: "rejected", reason: "request-epoch-mismatch" };
    }
    return {
      status: "completed",
      receipt: Object.freeze({
        kind: "studio-engine-webgpu-filter-receipt",
        version: STUDIO_ENGINE_WEBGPU_FILTER_RUNTIME_VERSION,
        backend: "webgpu",
        requestSequence: request.requestSequence,
        requestEpoch,
        deviceEpoch,
        recipeHash: request.plan.recipeHash,
        width: request.plan.width,
        height: request.plan.height,
        textureFormat: STUDIO_ENGINE_WEBGPU_FILTER_TEXTURE_FORMAT,
        workingSpace: request.recipe.color.workingSpace,
        storageAlphaMode: "premultiplied",
        filterMathAlphaMode: "straight",
        stageCount: request.plan.stages.length,
        dispatchCount: request.plan.dispatchCount,
        queueState: "completed",
        complete: true,
      }),
    };
  }

  private createIntermediateTexture(
    plan: StudioCanonicalFilterExecutionPlan,
    label: string,
    resources: SubmissionResources,
  ): GPUTexture {
    const texture = this.device.createTexture({
      label,
      size: { width: plan.width, height: plan.height, depthOrArrayLayers: 1 },
      format: STUDIO_ENGINE_WEBGPU_FILTER_TEXTURE_FORMAT,
      usage:
        GPU_TEXTURE_BINDING
        | GPU_STORAGE_BINDING
        | GPU_TEXTURE_COPY_SRC
        | GPU_TEXTURE_COPY_DST,
    });
    resources.textures.push(texture);
    return texture;
  }

  private dispatchTiles(
    encoder: GPUCommandEncoder,
    stage: StudioCanonicalFilterExecutionStage,
    plan: StudioCanonicalFilterExecutionPlan,
    bindings: DispatchBindings,
    resources: SubmissionResources,
  ): void {
    const pipeline = this.getPipeline(bindings.kernel);
    const pass = encoder.beginComputePass({
      label: `Studio filter ${stage.nodeId}/${stage.pass}`,
    });
    pass.setPipeline(pipeline);
    for (const tile of stage.tiles) {
      const uniformBytes = packTileUniform(plan, tile, bindings.uniform);
      const uniform = createUniformBuffer(
        this.device,
        uniformBytes,
        `Studio filter tile ${stage.nodeId}/${stage.pass}/${tile.tileIndex}`,
      );
      resources.buffers.push(uniform);
      const bindGroup = this.device.createBindGroup({
        label: `Studio filter bind group ${stage.nodeId}/${stage.pass}/${tile.tileIndex}`,
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          ...bindings.entries,
          { binding: bindings.uniformBinding, resource: { buffer: uniform } },
        ],
      });
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(tile.workgroupsX, tile.workgroupsY, 1);
    }
    pass.end();
  }

  private gaussianPass(
    encoder: GPUCommandEncoder,
    stage: StudioCanonicalFilterExecutionStage,
    plan: StudioCanonicalFilterExecutionPlan,
    source: GPUTexture,
    target: GPUTexture,
    weights: GPUBuffer,
    resources: SubmissionResources,
  ): void {
    this.dispatchTiles(
      encoder,
      stage,
      plan,
      {
        kernel: "gaussian",
        uniformBinding: 3,
        entries: [
          { binding: 0, resource: source.createView() },
          { binding: 1, resource: target.createView() },
          { binding: 2, resource: { buffer: weights } },
        ],
        uniform: {
          directionX: stage.pass === "gaussian-horizontal" ? 1 : 0,
          directionY: stage.pass === "gaussian-vertical" ? 1 : 0,
          radius: stage.radius,
          borderMode: borderCode(stage.borderMode),
        },
      },
      resources,
    );
  }

  private encodeRecipe(
    encoder: GPUCommandEncoder,
    request: StudioEngineWebGpuFilterExecutionRequest,
    resources: SubmissionResources,
  ): void {
    const textures = new Map<string, GPUTexture>();
    const input = request.recipe.nodes[0]!;
    textures.set(input.id, request.sourceTexture);
    for (const node of request.recipe.nodes) {
      if (node.kind === "input") continue;
      const source = textures.get(node.input);
      if (!source) throw new Error(`Missing GPU filter source ${node.input}`);
      const output = this.createIntermediateTexture(
        request.plan,
        `Studio canonical filter ${node.id}`,
        resources,
      );
      if (node.kind === "gaussian-blur" || node.kind === "unsharp-mask") {
        const horizontalStage = stageFor(request.plan, node.id, "gaussian-horizontal");
        const verticalStage = stageFor(request.plan, node.id, "gaussian-vertical");
        if (!horizontalStage || !verticalStage) throw new Error("Missing Gaussian execution stage");
        const horizontal = this.createIntermediateTexture(
          request.plan,
          `Studio canonical filter ${node.id} horizontal`,
          resources,
        );
        const kernel = Float32Array.from(buildStudioCanonicalGaussianKernel(node.sigma, node.radius));
        const weights = createFloatStorageBuffer(
          this.device,
          kernel,
          `Studio canonical Gaussian weights ${node.id}`,
        );
        resources.buffers.push(weights);
        this.gaussianPass(
          encoder,
          horizontalStage,
          request.plan,
          source,
          horizontal,
          weights,
          resources,
        );
        if (node.kind === "gaussian-blur") {
          this.gaussianPass(
            encoder,
            verticalStage,
            request.plan,
            horizontal,
            output,
            weights,
            resources,
          );
        } else {
          const blurred = this.createIntermediateTexture(
            request.plan,
            `Studio canonical filter ${node.id} blurred`,
            resources,
          );
          this.gaussianPass(
            encoder,
            verticalStage,
            request.plan,
            horizontal,
            blurred,
            weights,
            resources,
          );
          const combine = stageFor(request.plan, node.id, "unsharp-combine");
          if (!combine) throw new Error("Missing unsharp combine stage");
          this.dispatchTiles(
            encoder,
            combine,
            request.plan,
            {
              kernel: "unsharp",
              uniformBinding: 3,
              entries: [
                { binding: 0, resource: source.createView() },
                { binding: 1, resource: blurred.createView() },
                { binding: 2, resource: output.createView() },
              ],
              uniform: { values: [[node.amount, node.threshold, 0, 0]] },
            },
            resources,
          );
        }
      } else if (node.kind === "morphology") {
        const horizontalStage = stageFor(request.plan, node.id, "morphology-horizontal");
        const verticalStage = stageFor(request.plan, node.id, "morphology-vertical");
        if (!horizontalStage || !verticalStage) throw new Error("Missing morphology stage");
        const horizontal = this.createIntermediateTexture(
          request.plan,
          `Studio canonical morphology ${node.id} horizontal`,
          resources,
        );
        this.morphologyPass(
          encoder,
          horizontalStage,
          request.plan,
          source,
          horizontal,
          node.operation,
          resources,
        );
        this.morphologyPass(
          encoder,
          verticalStage,
          request.plan,
          horizontal,
          output,
          node.operation,
          resources,
        );
      } else if (node.kind === "curves") {
        const stage = stageFor(request.plan, node.id, "point");
        if (!stage) throw new Error("Missing curves stage");
        const curves = new Float32Array(STUDIO_CANONICAL_FILTER_CURVE_LUT_SIZE * 4);
        curves.set(buildStudioCanonicalFilterCurveLut(node.rgb), 0);
        curves.set(buildStudioCanonicalFilterCurveLut(node.red), STUDIO_CANONICAL_FILTER_CURVE_LUT_SIZE);
        curves.set(
          buildStudioCanonicalFilterCurveLut(node.green),
          STUDIO_CANONICAL_FILTER_CURVE_LUT_SIZE * 2,
        );
        curves.set(
          buildStudioCanonicalFilterCurveLut(node.blue),
          STUDIO_CANONICAL_FILTER_CURVE_LUT_SIZE * 3,
        );
        const lut = createFloatStorageBuffer(
          this.device,
          curves,
          `Studio canonical curves ${node.id}`,
        );
        resources.buffers.push(lut);
        this.dispatchTiles(
          encoder,
          stage,
          request.plan,
          {
            kernel: "curves",
            uniformBinding: 3,
            entries: [
              { binding: 0, resource: source.createView() },
              { binding: 1, resource: output.createView() },
              { binding: 2, resource: { buffer: lut } },
            ],
            uniform: {},
          },
          resources,
        );
      } else if (node.kind === "color-matrix" || node.kind === "channel-mixer") {
        const stage = stageFor(request.plan, node.id, "point");
        if (!stage) throw new Error("Missing matrix stage");
        const coefficients = createFloatStorageBuffer(
          this.device,
          Float32Array.from(node.matrix),
          `Studio canonical matrix ${node.id}`,
        );
        resources.buffers.push(coefficients);
        this.dispatchTiles(
          encoder,
          stage,
          request.plan,
          {
            kernel: "matrix",
            uniformBinding: 3,
            entries: [
              { binding: 0, resource: source.createView() },
              { binding: 1, resource: output.createView() },
              { binding: 2, resource: { buffer: coefficients } },
            ],
            uniform: {
              operation: node.kind === "color-matrix" ? MATRIX_COLOR : MATRIX_CHANNEL_MIXER,
            },
          },
          resources,
        );
      } else {
        const stage = stageFor(request.plan, node.id, "point");
        const uniform = pointUniform(request.recipe, node);
        if (!stage || !uniform) throw new Error(`Unsupported canonical filter node ${node.kind}`);
        this.dispatchTiles(
          encoder,
          stage,
          request.plan,
          {
            kernel: "point",
            uniformBinding: 2,
            entries: [
              { binding: 0, resource: source.createView() },
              { binding: 1, resource: output.createView() },
            ],
            uniform,
          },
          resources,
        );
      }
      textures.set(node.id, output);
    }
    const finalTexture = textures.get(request.recipe.outputNodeId);
    if (!finalTexture) throw new Error("Missing canonical filter output texture");
    encoder.copyTextureToTexture(
      { texture: finalTexture },
      { texture: request.targetTexture },
      { width: request.plan.width, height: request.plan.height, depthOrArrayLayers: 1 },
    );
  }

  private morphologyPass(
    encoder: GPUCommandEncoder,
    stage: StudioCanonicalFilterExecutionStage,
    plan: StudioCanonicalFilterExecutionPlan,
    source: GPUTexture,
    target: GPUTexture,
    operation: "min" | "max",
    resources: SubmissionResources,
  ): void {
    this.dispatchTiles(
      encoder,
      stage,
      plan,
      {
        kernel: "morphology",
        uniformBinding: 2,
        entries: [
          { binding: 0, resource: source.createView() },
          { binding: 1, resource: target.createView() },
        ],
        uniform: {
          directionX: stage.pass === "morphology-horizontal" ? 1 : 0,
          directionY: stage.pass === "morphology-vertical" ? 1 : 0,
          radius: stage.radius,
          borderMode: borderCode(stage.borderMode),
          operation: operation === "max" ? 1 : 0,
        },
      },
      resources,
    );
  }

  private handleDeviceLost(info: GPUDeviceLostInfo): void {
    if (this.status === "disposed" || this.status === "device-lost") return;
    this.status = "device-lost";
    if (this.deviceEpoch < Number.MAX_SAFE_INTEGER) this.deviceEpoch += 1;
    this.modules.clear();
    this.pipelines.clear();
    // `onDeviceLost` is an optional caller hook, so a caller that omits it used to lose the device
    // in complete silence: filters simply stopped resolving. Reporting first makes the loss reach
    // the safe-mode recovery machine and the user-facing status rail no matter who constructed
    // this runtime. Reporting is idempotent per device epoch because of the status guard above.
    announceStudioGpuDeviceLoss(`filter-runtime-device-lost:${info.reason}`);
    this.onDeviceLost?.(info);
  }

  private failClosed(): void {
    if (this.status !== "ready") return;
    this.status = "failed";
    this.modules.clear();
    this.pipelines.clear();
  }

  public dispose(): void {
    if (this.status === "disposed") return;
    this.status = "disposed";
    this.invalidateRequests();
    this.modules.clear();
    this.pipelines.clear();
    safeDestroyDevice(this.device, this.ownsDevice);
  }
}
