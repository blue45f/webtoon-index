import {
  STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_BUDGETS,
  STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_DUAL_TIP_CAPABILITY,
  STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_PLAN_VERSION,
} from "./render/studio-engine-webgpu-textured-brush-plan";
import {
  packStudioEngineWebGpuTexturedBrushDabs,
  STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_INSTANCE_BYTES,
} from "./render/studio-engine-webgpu-textured-brush-runtime";
import {
  STUDIO_DYNAMIC_DUAL_TIP_BUDGETS,
  STUDIO_DYNAMIC_DUAL_TIP_PLAN_VERSION,
} from "./studio-dynamic-dual-tip-plan";
import { sha256HexPortable } from "./studio-sha256";

import type {
  StudioEngineWebGpuTexturedBrushBatch,
  StudioEngineWebGpuTexturedBrushPlan,
  StudioEngineWebGpuTexturedBrushResolvedAsset,
} from "./render/studio-engine-webgpu-textured-brush-plan";
import type {
  StudioDynamicDualTipBlendFamily,
  StudioDynamicDualTipPlan,
  StudioDynamicDualTipSecondaryInstance,
} from "./studio-dynamic-dual-tip-plan";

export const STUDIO_DYNAMIC_DUAL_TIP_WEBGPU_RUNTIME_REVISION = 1 as const;
export const STUDIO_DYNAMIC_DUAL_TIP_WEBGPU_TEXTURE_FORMAT = "rgba16float" as const;
export const STUDIO_DYNAMIC_DUAL_TIP_WEBGPU_SECONDARY_INSTANCE_FLOATS = 12;
export const STUDIO_DYNAMIC_DUAL_TIP_WEBGPU_SECONDARY_INSTANCE_BYTES =
  STUDIO_DYNAMIC_DUAL_TIP_WEBGPU_SECONDARY_INSTANCE_FLOATS
  * Float32Array.BYTES_PER_ELEMENT;

const GPU_TEXTURE_COPY_SRC = 0x01;
const GPU_TEXTURE_COPY_DST = 0x02;
const GPU_TEXTURE_BINDING = 0x04;
const GPU_TEXTURE_RENDER_ATTACHMENT = 0x10;
const GPU_BUFFER_COPY_DST = 0x08;
const GPU_BUFFER_VERTEX = 0x20;
const GPU_BUFFER_UNIFORM = 0x40;
const ROW_ALIGNMENT = 256;

const BLEND_FAMILIES: readonly StudioDynamicDualTipBlendFamily[] = Object.freeze([
  "intersect",
  "darken",
  "lighten",
  "multiply",
  "screen",
  "add",
  "subtract",
  "difference",
]);

const PRIMARY_MASK_SHADER = /* wgsl */ `
struct Viewport {
  size: vec2f,
  inverse_size: vec2f,
};
@group(0) @binding(0) var tip_texture: texture_2d<f32>;
@group(0) @binding(1) var grain_texture: texture_2d<f32>;
@group(0) @binding(2) var tip_sampler: sampler;
@group(0) @binding(3) var grain_sampler: sampler;
@group(0) @binding(4) var<uniform> viewport: Viewport;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) document: vec2f,
  @location(2) color: vec4f,
  @location(3) dynamics: vec4f,
  @location(4) grain_origin: vec2f,
  @location(5) flags: vec4f,
  @location(6) texture_info: vec4f,
};

@vertex
fn vs_main(
  @builtin(vertex_index) vertex_index: u32,
  @location(0) center: vec2f,
  @location(1) basis_x: vec2f,
  @location(2) basis_y: vec2f,
  @location(3) color: vec4f,
  @location(4) dynamics: vec4f,
  @location(5) grain_origin: vec2f,
  @location(6) diagnostics: vec4f,
  @location(7) flags: vec4f,
  @location(8) texture_info: vec4f,
) -> VertexOutput {
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f( 1.0, -1.0),
    vec2f(-1.0,  1.0),
    vec2f(-1.0,  1.0),
    vec2f( 1.0, -1.0),
    vec2f( 1.0,  1.0),
  );
  let local = corners[vertex_index];
  let document = center + basis_x * local.x + basis_y * local.y;
  let clip = vec2f(
    document.x * viewport.inverse_size.x * 2.0 - 1.0,
    1.0 - document.y * viewport.inverse_size.y * 2.0,
  );
  var output: VertexOutput;
  output.position = vec4f(clip, 0.0, 1.0);
  output.local = local;
  output.document = document;
  output.color = color;
  output.dynamics = dynamics;
  output.grain_origin = grain_origin;
  output.flags = flags;
  output.texture_info = texture_info;
  return output;
}

fn hash_u32(input: u32) -> u32 {
  var value = input;
  value = value ^ (value >> 16u);
  value = value * 0x7feb352du;
  value = value ^ (value >> 15u);
  value = value * 0x846ca68bu;
  return value ^ (value >> 16u);
}

fn integer_noise(cell: vec2i, seed: u32) -> f32 {
  let mixed = seed
    ^ (bitcast<u32>(cell.x) * 0x9e3779b1u)
    ^ (bitcast<u32>(cell.y) * 0x85ebca77u);
  return f32(hash_u32(mixed)) / 4294967296.0;
}

fn shaped_grain(value: f32, contrast: f32, invert: bool) -> f32 {
  let contrasted = clamp(0.5 + (value - 0.5) * (1.0 + contrast * 3.0), 0.0, 1.0);
  return select(contrasted, 1.0 - contrasted, invert);
}

struct FragmentOutput {
  @location(0) effective_color: vec4f,
  @location(1) raw_mask: vec4f,
};

@fragment
fn fs_main(input: VertexOutput) -> FragmentOutput {
  let uv = input.local * 0.5 + 0.5;
  let tip_size = input.texture_info.xy;
  let padded_size = tip_size + vec2f(2.0);
  let padded_uv = (uv * tip_size + vec2f(1.0)) / padded_size;
  let tip_value = textureSample(tip_texture, tip_sampler, padded_uv).r;
  let hardness_edge = max(1.0 / 65535.0, 1.0 - input.dynamics.x);
  let tip_coverage = smoothstep(0.0, hardness_edge, tip_value);

  let grain_kind = u32(input.flags.x + 0.5);
  let packed_grain_flags = u32(input.flags.y + 0.5);
  let grain_space = packed_grain_flags & 1u;
  let seed = u32(input.flags.z + 0.5) | (u32(input.flags.w + 0.5) << 16u);
  let grain_position = select(
    input.document,
    input.document - input.grain_origin,
    grain_space == 1u,
  );
  let grain_invert = (packed_grain_flags & 2u) != 0u;
  let grain_cell = vec2i(floor(grain_position / input.dynamics.z));
  let procedural_grain = integer_noise(grain_cell, seed);
  let asset_grain = textureSample(
    grain_texture,
    grain_sampler,
    grain_position / input.dynamics.z,
  ).r;
  var grain_value = select(1.0, procedural_grain, grain_kind == 1u);
  grain_value = select(grain_value, asset_grain, grain_kind == 2u);
  let grain_shaped = shaped_grain(grain_value, input.dynamics.w, grain_invert);
  let grain_factor = mix(1.0, grain_shaped, input.dynamics.y);
  let raw_mask = tip_coverage * grain_factor;
  var output: FragmentOutput;
  output.effective_color = input.color * raw_mask;
  output.raw_mask = vec4f(raw_mask);
  return output;
}
`;

const SECONDARY_MASK_SHADER = /* wgsl */ `
struct Viewport {
  size: vec2f,
  inverse_size: vec2f,
};
@group(0) @binding(0) var secondary_texture: texture_2d<f32>;
@group(0) @binding(1) var zero_border_sampler: sampler;
@group(0) @binding(2) var<uniform> viewport: Viewport;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) opacity_and_size: vec4f,
};

@vertex
fn vs_main(
  @builtin(vertex_index) vertex_index: u32,
  @location(0) center: vec2f,
  @location(1) basis_x: vec2f,
  @location(2) basis_y: vec2f,
  @location(3) opacity_and_size: vec4f,
) -> VertexOutput {
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f( 1.0, -1.0),
    vec2f(-1.0,  1.0),
    vec2f(-1.0,  1.0),
    vec2f( 1.0, -1.0),
    vec2f( 1.0,  1.0),
  );
  let local = corners[vertex_index];
  let document = center + basis_x * local.x + basis_y * local.y;
  let clip = vec2f(
    document.x * viewport.inverse_size.x * 2.0 - 1.0,
    1.0 - document.y * viewport.inverse_size.y * 2.0,
  );
  var output: VertexOutput;
  output.position = vec4f(clip, 0.0, 1.0);
  output.local = local;
  output.opacity_and_size = opacity_and_size;
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.local * 0.5 + 0.5;
  let source_size = input.opacity_and_size.yz;
  let padded_size = source_size + vec2f(2.0);
  let padded_uv = (uv * source_size + vec2f(1.0)) / padded_size;
  let coverage = textureSample(
    secondary_texture,
    zero_border_sampler,
    padded_uv,
  ).r * input.opacity_and_size.x;
  return vec4f(coverage);
}
`;

const COMBINE_SHADER = /* wgsl */ `
struct CombineParameters {
  fallback_straight_color: vec4f,
  blend_family: u32,
  padding_0: u32,
  padding_1: u32,
  padding_2: u32,
};
@group(0) @binding(0) var primary_layer: texture_2d<f32>;
@group(0) @binding(1) var primary_raw_mask_layer: texture_2d<f32>;
@group(0) @binding(2) var secondary_layer: texture_2d<f32>;
@group(0) @binding(3) var<uniform> parameters: CombineParameters;

struct VertexOutput {
  @builtin(position) position: vec4f,
};

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

fn combine_masks(primary: f32, secondary: f32, family: u32) -> f32 {
  switch family {
    case 0u: { return primary * secondary; }
    case 1u: { return min(primary, secondary); }
    case 2u: { return max(primary, secondary); }
    case 3u: { return primary * secondary; }
    case 4u: { return 1.0 - (1.0 - primary) * (1.0 - secondary); }
    case 5u: { return min(1.0, primary + secondary); }
    case 6u: { return max(0.0, primary - secondary); }
    default: { return abs(primary - secondary); }
  }
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  let coordinate = vec2i(input.position.xy);
  let primary_raw_mask = textureLoad(primary_raw_mask_layer, coordinate, 0).a;
  let secondary = textureLoad(secondary_layer, coordinate, 0).a;
  let combined_raw_mask = clamp(
    combine_masks(
      clamp(primary_raw_mask, 0.0, 1.0),
      clamp(secondary, 0.0, 1.0),
      parameters.blend_family,
    ),
    0.0,
    1.0,
  );
  // Aggregate-mask v1 is preview-only. Do not infer paint alpha from already accumulated masks:
  // overlapping depositions make that ratio non-invertible. Exact work uses the v2 deposition
  // stream, which combines both tips before every authority blend.
  let preview_paint_alpha = clamp(parameters.fallback_straight_color.a, 0.0, 1.0);
  let combined = combined_raw_mask * preview_paint_alpha;
  return vec4f(parameters.fallback_straight_color.rgb * combined, combined);
}
`;

export interface StudioDynamicDualTipWebGpuRuntimeOptions {
  readonly device: GPUDevice;
  readonly width: number;
  readonly height: number;
  readonly initialDeviceEpoch?: number;
  readonly maximumPrimaryDabs?: number;
  readonly maximumSecondaryInstances?: number;
  readonly maximumInFlightSubmissions?: number;
  readonly maximumResidentAssetBytes?: number;
  readonly ownsDevice?: boolean;
  readonly onDeviceLost?: (info: GPUDeviceLostInfo) => void;
}

export interface StudioDynamicDualTipWebGpuFrame {
  readonly requestSequence: number;
  readonly deviceEpoch: number;
  readonly plan: StudioDynamicDualTipPlan;
}

export interface StudioDynamicDualTipWebGpuReceipt {
  readonly kind: "studio-dynamic-dual-tip-webgpu-receipt";
  readonly revision: typeof STUDIO_DYNAMIC_DUAL_TIP_WEBGPU_RUNTIME_REVISION;
  readonly backend: "webgpu";
  readonly providerCapability: "dynamic-dual-tip-r8-aggregate-preview-v1";
  readonly textureFormat: typeof STUDIO_DYNAMIC_DUAL_TIP_WEBGPU_TEXTURE_FORMAT;
  readonly colorModel: "scene-linear-premultiplied";
  readonly maskCombination: "independent-primary-secondary-aggregate-preview-v1";
  readonly fidelity: "aggregate-mask-preview-only";
  readonly exactExecutionRoute: "webgpu-exact-packed-deposition-v2";
  readonly requestSequence: number;
  readonly deviceEpoch: number;
  readonly mode: "append" | "rebuild";
  readonly strokeId: string;
  readonly commandSequence: number;
  readonly blendFamily: StudioDynamicDualTipBlendFamily;
  readonly primaryDabCount: number;
  readonly secondaryStationCount: number;
  readonly secondaryInstanceCount: number;
  readonly assetCount: number;
  readonly assetBytes: number;
  readonly planFingerprint: string;
  readonly queueState: "completed";
  readonly complete: false;
}

export type StudioDynamicDualTipWebGpuExecutionResult =
  | Readonly<{ status: "completed"; receipt: StudioDynamicDualTipWebGpuReceipt }>
  | Readonly<{
      status: "rejected";
      reason:
        | "invalid-frame"
        | "request-sequence"
        | "device-epoch"
        | "request-limit"
        | "resident-asset-budget";
    }>
  | Readonly<{ status: "busy"; inFlight: number; maximum: number }>
  | Readonly<{ status: "cancelled" }>
  | Readonly<{ status: "device-lost"; deviceEpoch: number }>
  | Readonly<{ status: "disposed" }>
  | Readonly<{ status: "failed"; reason: "gpu-error" }>;

export type StudioDynamicDualTipWebGpuRuntimeCreationResult =
  | Readonly<{ status: "ready"; runtime: StudioDynamicDualTipWebGpuRuntime }>
  | Readonly<{ status: "rejected"; reason: "invalid-options" | "initialization-failed" }>;

interface AssetTexture {
  readonly key: string;
  readonly byteLength: number;
  readonly texture: GPUTexture;
  readonly view: GPUTextureView;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function uint32(value: unknown): value is number {
  return Number.isSafeInteger(value)
    && (value as number) >= 0
    && (value as number) <= 0xffff_ffff;
}

function nextAligned(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function assetKey(
  asset: StudioEngineWebGpuTexturedBrushResolvedAsset,
  role: "tip" | "grain",
): string {
  return [
    role,
    asset.contentHash,
    `${asset.width}x${asset.height}`,
    asset.channel,
    asset.format,
  ].join(":");
}

function validAsset(
  asset: StudioEngineWebGpuTexturedBrushResolvedAsset,
  expectedIndex: number,
  expectedRole: "tip" | "grain",
): boolean {
  try {
    return (
      asset.assetIndex === expectedIndex
      && asset.role === expectedRole
      && typeof asset.assetId === "string"
      && asset.assetId.length > 0
      && positiveSafeInteger(asset.width)
      && positiveSafeInteger(asset.height)
      && asset.width <= STUDIO_DYNAMIC_DUAL_TIP_BUDGETS.maxAssetDimension
      && asset.height <= STUDIO_DYNAMIC_DUAL_TIP_BUDGETS.maxAssetDimension
      && asset.format === "r8-unorm"
      && (asset.channel === "alpha" || asset.channel === "luminance")
      && asset.byteLength === asset.width * asset.height
      && asset.bytes instanceof Uint8Array
      && asset.byteLength === asset.bytes.byteLength
      && asset.byteLength <= STUDIO_DYNAMIC_DUAL_TIP_BUDGETS.maxAssetBytes
      && asset.contentHash === `sha256:${sha256HexPortable(asset.bytes)}`
    );
  } catch {
    return false;
  }
}

function validPrimaryPlan(
  primary: StudioEngineWebGpuTexturedBrushPlan,
  maximumDabs: number,
): boolean {
  try {
    if (
      primary.kind !== "studio-engine-webgpu-textured-brush-plan"
      || primary.version !== STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_PLAN_VERSION
      || primary.dualTip !== STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_DUAL_TIP_CAPABILITY
      || primary.textureFormat !== STUDIO_DYNAMIC_DUAL_TIP_WEBGPU_TEXTURE_FORMAT
      || primary.colorModel !== "scene-linear-premultiplied"
      || !Array.isArray(primary.assets)
      || primary.assets.length < 1
      || primary.assets.length > STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_BUDGETS.maxAssets
      || !Array.isArray(primary.dabs)
      || primary.dabs.length < 1
      || primary.dabs.length > maximumDabs
      || !Array.isArray(primary.batches)
      || primary.batches.length < 1
      || primary.tip.assetIndex !== 0
    ) return false;
    for (let index = 0; index < primary.assets.length; index += 1) {
      const role = index === primary.tip.assetIndex
        ? "tip"
        : primary.grain?.kind === "asset-r8-repeat"
          && index === primary.grain.assetIndex
          ? "grain"
          : null;
      if (!role || !validAsset(primary.assets[index]!, index, role)) return false;
    }
    for (let index = 0; index < primary.dabs.length; index += 1) {
      const dab = primary.dabs[index]!;
      if (
        dab.index !== index
        || dab.color.space !== "linear-srgb"
        || dab.color.alphaMode !== "straight"
        || dab.composite.blendMode !== "normal"
        || ![
          dab.stationX,
          dab.stationY,
          dab.x,
          dab.y,
          dab.pressure,
          dab.diameter,
          dab.opacity,
          dab.flow,
          dab.grainDepth,
          ...dab.color.components,
          dab.tip.hardness,
          dab.tip.roundness,
          dab.tip.angleRadians,
          ...dab.tip.localToDocument,
        ].every(finite)
        || dab.diameter <= 0
        || dab.tip.localToDocument[0] * dab.tip.localToDocument[3]
          - dab.tip.localToDocument[1] * dab.tip.localToDocument[2] === 0
      ) return false;
    }
    let nextInstance = 0;
    let porterDuff: "source-over" | "destination-out" | null = null;
    for (const batch of primary.batches) {
      if (
        typeof batch.key !== "string"
        || batch.key.length === 0
        || batch.firstInstance !== nextInstance
        || !positiveSafeInteger(batch.instanceCount)
        || batch.firstInstance + batch.instanceCount > primary.dabs.length
        || !primary.assets[batch.tipAssetIndex]
        || (
          batch.grainAssetIndex !== null
          && !primary.assets[batch.grainAssetIndex]
        )
      ) return false;
      porterDuff ??= batch.porterDuff;
      if (porterDuff !== batch.porterDuff) return false;
      nextInstance += batch.instanceCount;
    }
    return nextInstance === primary.dabs.length;
  } catch {
    return false;
  }
}

function validSecondaryInstance(
  instance: StudioDynamicDualTipSecondaryInstance,
  index: number,
  assetIndex: number,
  stationCount: number,
): boolean {
  try {
    return (
      instance.index === index
      && Number.isSafeInteger(instance.stationIndex)
      && instance.stationIndex >= 0
      && instance.stationIndex < stationCount
      && Number.isSafeInteger(instance.countIndex)
      && instance.countIndex >= 0
      && uint32(instance.randomUint32)
      && instance.assetIndex === assetIndex
      && [
        instance.x,
        instance.y,
        instance.sourceDiameter,
        instance.opacity,
        instance.angleRadians,
        instance.roundness,
        ...instance.localToDocument,
      ].every(finite)
      && instance.sourceDiameter > 0
      && instance.opacity >= 0
      && instance.opacity <= 1
      && instance.roundness > 0
      && instance.roundness <= 1
      && instance.localToDocument[0] * instance.localToDocument[3]
        - instance.localToDocument[1] * instance.localToDocument[2] !== 0
    );
  } catch {
    return false;
  }
}

function validPlan(
  plan: StudioDynamicDualTipPlan,
  maximumPrimaryDabs: number,
  maximumSecondaryInstances: number,
): boolean {
  try {
    if (
      plan.kind !== "studio-dynamic-dual-tip-plan"
      || plan.version !== STUDIO_DYNAMIC_DUAL_TIP_PLAN_VERSION
      || (plan.mode !== "append" && plan.mode !== "rebuild")
      || plan.providerCapability !== "dynamic-dual-tip-r8-aggregate-preview-v1"
      || plan.executionRoute !== "experimental-webgpu-aggregate-preview-v1"
      || plan.exactExecutionRoute !== "webgpu-exact-packed-deposition-v2"
      || plan.fidelity !== "aggregate-mask-preview-only"
      || plan.singleTipFallback !== "forbidden"
      || plan.textureFormat !== STUDIO_DYNAMIC_DUAL_TIP_WEBGPU_TEXTURE_FORMAT
      || plan.maskFormat !== "r8-unorm"
      || !/^sha256:[0-9a-f]{64}$/u.test(plan.fingerprint)
      || !validPrimaryPlan(plan.primary, maximumPrimaryDabs)
      || plan.primary.mode !== plan.mode
      || plan.primary.strokeId !== plan.strokeId
      || plan.primary.commandSequence !== plan.commandSequence
      || plan.extension.kind !== "studio-dynamic-dual-tip-extension"
      || plan.extension.version !== 1
      || plan.extension.secondaryTip.kind
        !== "studio-dynamic-dual-tip-r8-reference"
      || plan.extension.secondaryTip.version !== 1
      || plan.extension.units.diameter !== "canonical-local-css-px"
      || plan.extension.units.spacing !== "document-css-px"
      || plan.extension.units.scatter !== "document-css-px"
      || plan.extension.units.angle !== "radians-relative-to-stroke"
      || !finite(plan.extension.secondaryDiameter)
      || plan.extension.secondaryDiameter <= 0
      || !finite(plan.extension.secondarySpacing)
      || plan.extension.secondarySpacing <= 0
      || (
        plan.extension.scatterAxes !== "perpendicular-axis"
        && plan.extension.scatterAxes !== "both-axes"
      )
      || !finite(plan.extension.scatterDistance)
      || plan.extension.scatterDistance < 0
      || !positiveSafeInteger(plan.extension.count)
      || !Number.isSafeInteger(plan.extension.countJitter)
      || plan.extension.countJitter < 0
      || plan.extension.countJitter >= plan.extension.count
      || !finite(plan.extension.angleRadians)
      || !finite(plan.extension.roundness)
      || plan.extension.roundness <= 0
      || plan.extension.roundness > 1
      || !uint32(plan.extension.seed)
      || !finite(plan.extension.secondaryOpacity)
      || plan.extension.secondaryOpacity < 0
      || plan.extension.secondaryOpacity > 1
      || !Array.isArray(plan.secondaryStations)
      || plan.secondaryStations.length < 1
      || plan.secondaryStations.length > STUDIO_DYNAMIC_DUAL_TIP_BUDGETS.maxSecondaryStations
      || !Array.isArray(plan.secondaryInstances)
      || plan.secondaryInstances.length < 1
      || plan.secondaryInstances.length > maximumSecondaryInstances
      || !BLEND_FAMILIES.includes(plan.extension.blendFamily)
      || plan.extension.secondaryTip.contentHash !== plan.secondaryAsset.contentHash
      || plan.extension.secondaryTip.assetId !== plan.secondaryAsset.assetId
      || plan.extension.secondaryTip.width !== plan.secondaryAsset.width
      || plan.extension.secondaryTip.height !== plan.secondaryAsset.height
      || plan.extension.secondaryTip.channel !== plan.secondaryAsset.channel
      || !validAsset(plan.secondaryAsset, plan.primary.assets.length, "tip")
    ) return false;
    for (let index = 0; index < plan.secondaryStations.length; index += 1) {
      const station = plan.secondaryStations[index]!;
      if (
        station.index !== index
        || !positiveSafeInteger(station.instanceCount)
        || ![
          station.arcLength,
          station.x,
          station.y,
          station.pressure,
          station.localTangentX,
          station.localTangentY,
          station.documentTangentX,
          station.documentTangentY,
          station.documentNormalX,
          station.documentNormalY,
        ].every(finite)
      ) return false;
    }
    let instanceIndex = 0;
    for (const station of plan.secondaryStations) {
      if (
        station.instanceCount
          < plan.extension.count - plan.extension.countJitter
        || station.instanceCount
          > plan.extension.count + plan.extension.countJitter
      ) return false;
      for (let countIndex = 0; countIndex < station.instanceCount; countIndex += 1) {
        const instance = plan.secondaryInstances[instanceIndex];
        if (
          !instance
          || !validSecondaryInstance(
            instance,
            instanceIndex,
            plan.secondaryAsset.assetIndex,
            plan.secondaryStations.length,
          )
          || instance.stationIndex !== station.index
          || instance.countIndex !== countIndex
          || instance.sourceDiameter
            !== Math.fround(plan.extension.secondaryDiameter)
          || instance.opacity !== Math.fround(plan.extension.secondaryOpacity)
          || instance.roundness !== Math.fround(plan.extension.roundness)
        ) return false;
        instanceIndex += 1;
      }
    }
    return instanceIndex === plan.secondaryInstances.length;
  } catch {
    return false;
  }
}

function paddedUpload(
  asset: StudioEngineWebGpuTexturedBrushResolvedAsset,
  zeroBorder: boolean,
): Readonly<{
  bytes: Uint8Array;
  bytesPerRow: number;
  width: number;
  height: number;
}> {
  const width = asset.width + (zeroBorder ? 2 : 0);
  const height = asset.height + (zeroBorder ? 2 : 0);
  const bytesPerRow = nextAligned(width, ROW_ALIGNMENT);
  const bytes = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < asset.height; y += 1) {
    bytes.set(
      asset.bytes.subarray(y * asset.width, (y + 1) * asset.width),
      (y + (zeroBorder ? 1 : 0)) * bytesPerRow + (zeroBorder ? 1 : 0),
    );
  }
  return { bytes, bytesPerRow, width, height };
}

export function packStudioDynamicDualTipSecondaryInstances(
  plan: StudioDynamicDualTipPlan,
  scratch?: Float32Array,
): Float32Array {
  const required = plan.secondaryInstances.length
    * STUDIO_DYNAMIC_DUAL_TIP_WEBGPU_SECONDARY_INSTANCE_FLOATS;
  const packed = scratch && scratch.length >= required
    ? scratch.subarray(0, required)
    : new Float32Array(required);
  for (let index = 0; index < plan.secondaryInstances.length; index += 1) {
    const instance = plan.secondaryInstances[index]!;
    const offset = index * STUDIO_DYNAMIC_DUAL_TIP_WEBGPU_SECONDARY_INSTANCE_FLOATS;
    packed[offset] = instance.x;
    packed[offset + 1] = instance.y;
    packed[offset + 2] = instance.localToDocument[0];
    packed[offset + 3] = instance.localToDocument[1];
    packed[offset + 4] = instance.localToDocument[2];
    packed[offset + 5] = instance.localToDocument[3];
    packed[offset + 6] = instance.opacity;
    packed[offset + 7] = plan.secondaryAsset.width;
    packed[offset + 8] = plan.secondaryAsset.height;
    packed[offset + 9] = instance.stationIndex;
    packed[offset + 10] = instance.countIndex;
    packed[offset + 11] = instance.randomUint32 & 0xffff;
  }
  return packed;
}

function sourceOverBlend(): GPUBlendState {
  return {
    color: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
    alpha: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
  };
}

function authorityBlend(
  porterDuff: "source-over" | "destination-out",
): GPUBlendState {
  return porterDuff === "destination-out"
    ? {
        color: { operation: "add", srcFactor: "zero", dstFactor: "one-minus-src-alpha" },
        alpha: { operation: "add", srcFactor: "zero", dstFactor: "one-minus-src-alpha" },
      }
    : sourceOverBlend();
}

function primaryVertexLayout(): GPUVertexBufferLayout {
  return {
    arrayStride: STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_INSTANCE_BYTES,
    stepMode: "instance",
    attributes: [
      { shaderLocation: 0, offset: 0, format: "float32x2" },
      { shaderLocation: 1, offset: 8, format: "float32x2" },
      { shaderLocation: 2, offset: 16, format: "float32x2" },
      { shaderLocation: 3, offset: 24, format: "float32x4" },
      { shaderLocation: 4, offset: 40, format: "float32x4" },
      { shaderLocation: 5, offset: 56, format: "float32x2" },
      { shaderLocation: 6, offset: 64, format: "float32x4" },
      { shaderLocation: 7, offset: 80, format: "float32x4" },
      { shaderLocation: 8, offset: 96, format: "float32x4" },
    ],
  };
}

function secondaryVertexLayout(): GPUVertexBufferLayout {
  return {
    arrayStride: STUDIO_DYNAMIC_DUAL_TIP_WEBGPU_SECONDARY_INSTANCE_BYTES,
    stepMode: "instance",
    attributes: [
      { shaderLocation: 0, offset: 0, format: "float32x2" },
      { shaderLocation: 1, offset: 8, format: "float32x2" },
      { shaderLocation: 2, offset: 16, format: "float32x2" },
      { shaderLocation: 3, offset: 24, format: "float32x4" },
    ],
  };
}

export function createStudioDynamicDualTipWebGpuRuntime(
  options: StudioDynamicDualTipWebGpuRuntimeOptions,
): StudioDynamicDualTipWebGpuRuntimeCreationResult {
  try {
    if (
      typeof options !== "object"
      || options === null
      || !options.device
      || !positiveSafeInteger(options.width)
      || !positiveSafeInteger(options.height)
      || options.width > STUDIO_DYNAMIC_DUAL_TIP_BUDGETS.maxAssetDimension
      || options.height > STUDIO_DYNAMIC_DUAL_TIP_BUDGETS.maxAssetDimension
    ) return Object.freeze({ status: "rejected", reason: "invalid-options" });
    return Object.freeze({
      status: "ready",
      runtime: new StudioDynamicDualTipWebGpuRuntime(options),
    });
  } catch {
    return Object.freeze({ status: "rejected", reason: "initialization-failed" });
  }
}

export class StudioDynamicDualTipWebGpuRuntime {
  readonly #device: GPUDevice;
  readonly #width: number;
  readonly #height: number;
  #deviceEpoch: number;
  readonly #maximumPrimaryDabs: number;
  readonly #maximumSecondaryInstances: number;
  readonly #maximumInFlight: number;
  readonly #maximumResidentAssetBytes: number;
  readonly #ownsDevice: boolean;
  readonly #authorityTexture: GPUTexture;
  readonly #authorityView: GPUTextureView;
  readonly #primaryTexture: GPUTexture;
  readonly #primaryView: GPUTextureView;
  readonly #primaryRawMaskTexture: GPUTexture;
  readonly #primaryRawMaskView: GPUTextureView;
  readonly #secondaryTexture: GPUTexture;
  readonly #secondaryView: GPUTextureView;
  readonly #viewportBuffer: GPUBuffer;
  readonly #combineBuffer: GPUBuffer;
  readonly #zeroBorderSampler: GPUSampler;
  readonly #repeatSampler: GPUSampler;
  readonly #primaryLayout: GPUBindGroupLayout;
  readonly #secondaryLayout: GPUBindGroupLayout;
  readonly #combineLayout: GPUBindGroupLayout;
  readonly #primaryPipeline: GPURenderPipeline;
  readonly #secondaryPipeline: GPURenderPipeline;
  readonly #combinePipelines: Readonly<
    Record<"source-over" | "destination-out", GPURenderPipeline>
  >;
  readonly #combineBindGroup: GPUBindGroup;
  readonly #assetTextures = new Map<string, AssetTexture>();
  readonly #primaryBindGroups = new Map<string, GPUBindGroup>();
  #primaryBuffer: GPUBuffer | null = null;
  #primaryCapacity = 0;
  #secondaryBuffer: GPUBuffer | null = null;
  #secondaryCapacity = 0;
  #residentAssetBytes = 0;
  #inFlight = 0;
  #lastRequestSequence = 0;
  #initialized = false;
  #disposed = false;
  #lost = false;
  #failed = false;

  public constructor(options: StudioDynamicDualTipWebGpuRuntimeOptions) {
    this.#device = options.device;
    this.#width = options.width;
    this.#height = options.height;
    this.#deviceEpoch = options.initialDeviceEpoch ?? 1;
    this.#maximumPrimaryDabs = options.maximumPrimaryDabs
      ?? STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_BUDGETS.maxDabs;
    this.#maximumSecondaryInstances = options.maximumSecondaryInstances
      ?? STUDIO_DYNAMIC_DUAL_TIP_BUDGETS.maxSecondaryInstances;
    this.#maximumInFlight = options.maximumInFlightSubmissions ?? 1;
    this.#maximumResidentAssetBytes = options.maximumResidentAssetBytes
      ?? STUDIO_DYNAMIC_DUAL_TIP_BUDGETS.maxTotalAssetBytes;
    this.#ownsDevice = options.ownsDevice ?? false;
    if (
      !positiveSafeInteger(this.#deviceEpoch)
      || this.#deviceEpoch >= Number.MAX_SAFE_INTEGER
      || !positiveSafeInteger(this.#maximumPrimaryDabs)
      || this.#maximumPrimaryDabs > STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_BUDGETS.maxDabs
      || !positiveSafeInteger(this.#maximumSecondaryInstances)
      || this.#maximumSecondaryInstances > STUDIO_DYNAMIC_DUAL_TIP_BUDGETS.maxSecondaryInstances
      || this.#maximumInFlight !== 1
      || !positiveSafeInteger(this.#maximumResidentAssetBytes)
    ) throw new Error("invalid dynamic dual-tip runtime options");

    const makeLayer = (label: string, authority = false): GPUTexture => (
      this.#device.createTexture({
        label,
        size: { width: this.#width, height: this.#height, depthOrArrayLayers: 1 },
        format: STUDIO_DYNAMIC_DUAL_TIP_WEBGPU_TEXTURE_FORMAT,
        usage: GPU_TEXTURE_RENDER_ATTACHMENT
          | GPU_TEXTURE_BINDING
          | (authority ? GPU_TEXTURE_COPY_SRC : 0),
      })
    );
    this.#authorityTexture = makeLayer(
      "Studio dynamic dual-tip rgba16float authority",
      true,
    );
    this.#authorityView = this.#authorityTexture.createView();
    this.#primaryTexture = makeLayer("Studio dynamic dual-tip primary mask layer");
    this.#primaryView = this.#primaryTexture.createView();
    this.#primaryRawMaskTexture = makeLayer(
      "Studio dynamic dual-tip primary raw mask layer",
    );
    this.#primaryRawMaskView = this.#primaryRawMaskTexture.createView();
    this.#secondaryTexture = makeLayer("Studio dynamic dual-tip secondary mask layer");
    this.#secondaryView = this.#secondaryTexture.createView();

    this.#viewportBuffer = this.#device.createBuffer({
      label: "Studio dynamic dual-tip viewport uniform",
      size: 16,
      usage: GPU_BUFFER_UNIFORM | GPU_BUFFER_COPY_DST,
    });
    this.#device.queue.writeBuffer(
      this.#viewportBuffer,
      0,
      new Float32Array([
        this.#width,
        this.#height,
        1 / this.#width,
        1 / this.#height,
      ]),
    );
    this.#combineBuffer = this.#device.createBuffer({
      label: "Studio dynamic dual-tip combine uniform",
      size: 32,
      usage: GPU_BUFFER_UNIFORM | GPU_BUFFER_COPY_DST,
    });
    this.#zeroBorderSampler = this.#device.createSampler({
      label: "Studio dynamic dual-tip zero-border bilinear sampler",
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "nearest",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    this.#repeatSampler = this.#device.createSampler({
      label: "Studio dynamic dual-tip repeat bilinear sampler",
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "nearest",
      addressModeU: "repeat",
      addressModeV: "repeat",
    });

    const primaryModule = this.#device.createShaderModule({
      label: "Studio dynamic dual-tip primary clean-room shader",
      code: PRIMARY_MASK_SHADER,
    });
    const secondaryModule = this.#device.createShaderModule({
      label: "Studio dynamic dual-tip secondary clean-room shader",
      code: SECONDARY_MASK_SHADER,
    });
    const combineModule = this.#device.createShaderModule({
      label: "Studio dynamic dual-tip 8-family combine shader",
      code: COMBINE_SHADER,
    });
    this.#primaryLayout = this.#device.createBindGroupLayout({
      label: "Studio dynamic dual-tip primary bind layout",
      entries: [
        { binding: 0, visibility: 2, texture: { sampleType: "float" } },
        { binding: 1, visibility: 2, texture: { sampleType: "float" } },
        { binding: 2, visibility: 2, sampler: { type: "filtering" } },
        { binding: 3, visibility: 2, sampler: { type: "filtering" } },
        { binding: 4, visibility: 1, buffer: { type: "uniform" } },
      ],
    });
    this.#secondaryLayout = this.#device.createBindGroupLayout({
      label: "Studio dynamic dual-tip secondary bind layout",
      entries: [
        { binding: 0, visibility: 2, texture: { sampleType: "float" } },
        { binding: 1, visibility: 2, sampler: { type: "filtering" } },
        { binding: 2, visibility: 1, buffer: { type: "uniform" } },
      ],
    });
    this.#combineLayout = this.#device.createBindGroupLayout({
      label: "Studio dynamic dual-tip combine bind layout",
      entries: [
        { binding: 0, visibility: 2, texture: { sampleType: "unfilterable-float" } },
        { binding: 1, visibility: 2, texture: { sampleType: "unfilterable-float" } },
        { binding: 2, visibility: 2, texture: { sampleType: "unfilterable-float" } },
        { binding: 3, visibility: 2, buffer: { type: "uniform" } },
      ],
    });
    this.#primaryPipeline = this.#device.createRenderPipeline({
      label: "Studio dynamic dual-tip primary mask pipeline",
      layout: this.#device.createPipelineLayout({
        bindGroupLayouts: [this.#primaryLayout],
      }),
      vertex: {
        module: primaryModule,
        entryPoint: "vs_main",
        buffers: [primaryVertexLayout()],
      },
      fragment: {
        module: primaryModule,
        entryPoint: "fs_main",
        targets: [{
          format: STUDIO_DYNAMIC_DUAL_TIP_WEBGPU_TEXTURE_FORMAT,
          blend: sourceOverBlend(),
          writeMask: 0xf,
        }, {
          format: STUDIO_DYNAMIC_DUAL_TIP_WEBGPU_TEXTURE_FORMAT,
          blend: sourceOverBlend(),
          writeMask: 0xf,
        }],
      },
      primitive: { topology: "triangle-list" },
    });
    this.#secondaryPipeline = this.#device.createRenderPipeline({
      label: "Studio dynamic dual-tip secondary mask pipeline",
      layout: this.#device.createPipelineLayout({
        bindGroupLayouts: [this.#secondaryLayout],
      }),
      vertex: {
        module: secondaryModule,
        entryPoint: "vs_main",
        buffers: [secondaryVertexLayout()],
      },
      fragment: {
        module: secondaryModule,
        entryPoint: "fs_main",
        targets: [{
          format: STUDIO_DYNAMIC_DUAL_TIP_WEBGPU_TEXTURE_FORMAT,
          blend: sourceOverBlend(),
          writeMask: 0xf,
        }],
      },
      primitive: { topology: "triangle-list" },
    });
    const combineLayout = this.#device.createPipelineLayout({
      bindGroupLayouts: [this.#combineLayout],
    });
    const makeCombinePipeline = (
      porterDuff: "source-over" | "destination-out",
    ): GPURenderPipeline => this.#device.createRenderPipeline({
      label: `Studio dynamic dual-tip ${porterDuff} combine pipeline`,
      layout: combineLayout,
      vertex: { module: combineModule, entryPoint: "vs_main" },
      fragment: {
        module: combineModule,
        entryPoint: "fs_main",
        targets: [{
          format: STUDIO_DYNAMIC_DUAL_TIP_WEBGPU_TEXTURE_FORMAT,
          blend: authorityBlend(porterDuff),
          writeMask: 0xf,
        }],
      },
      primitive: { topology: "triangle-list" },
    });
    this.#combinePipelines = Object.freeze({
      "source-over": makeCombinePipeline("source-over"),
      "destination-out": makeCombinePipeline("destination-out"),
    });
    this.#combineBindGroup = this.#device.createBindGroup({
      label: "Studio dynamic dual-tip combine bind group",
      layout: this.#combineLayout,
      entries: [
        { binding: 0, resource: this.#primaryView },
        { binding: 1, resource: this.#primaryRawMaskView },
        { binding: 2, resource: this.#secondaryView },
        { binding: 3, resource: { buffer: this.#combineBuffer } },
      ],
    });
    void this.#device.lost.then((info) => {
      if (this.#disposed) return;
      this.#deviceEpoch += 1;
      this.#lost = true;
      options.onDeviceLost?.(info);
    });
  }

  public get deviceEpoch(): number {
    return this.#deviceEpoch;
  }

  public get inFlight(): number {
    return this.#inFlight;
  }

  #ensurePrimaryBuffer(count: number): GPUBuffer {
    if (this.#primaryBuffer && this.#primaryCapacity >= count) return this.#primaryBuffer;
    this.#primaryBuffer?.destroy();
    let capacity = Math.min(256, this.#maximumPrimaryDabs);
    while (capacity < count) capacity = Math.min(this.#maximumPrimaryDabs, capacity * 2);
    this.#primaryBuffer = this.#device.createBuffer({
      label: "Studio dynamic dual-tip primary instance buffer",
      size: Math.max(
        STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_INSTANCE_BYTES,
        capacity * STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_INSTANCE_BYTES,
      ),
      usage: GPU_BUFFER_VERTEX | GPU_BUFFER_COPY_DST,
    });
    this.#primaryCapacity = capacity;
    return this.#primaryBuffer;
  }

  #ensureSecondaryBuffer(count: number): GPUBuffer {
    if (this.#secondaryBuffer && this.#secondaryCapacity >= count) {
      return this.#secondaryBuffer;
    }
    this.#secondaryBuffer?.destroy();
    let capacity = Math.min(256, this.#maximumSecondaryInstances);
    while (capacity < count) {
      capacity = Math.min(this.#maximumSecondaryInstances, capacity * 2);
    }
    this.#secondaryBuffer = this.#device.createBuffer({
      label: "Studio dynamic dual-tip secondary instance buffer",
      size: Math.max(
        STUDIO_DYNAMIC_DUAL_TIP_WEBGPU_SECONDARY_INSTANCE_BYTES,
        capacity * STUDIO_DYNAMIC_DUAL_TIP_WEBGPU_SECONDARY_INSTANCE_BYTES,
      ),
      usage: GPU_BUFFER_VERTEX | GPU_BUFFER_COPY_DST,
    });
    this.#secondaryCapacity = capacity;
    return this.#secondaryBuffer;
  }

  #uploadAsset(
    asset: StudioEngineWebGpuTexturedBrushResolvedAsset,
    role: "tip" | "grain",
  ): AssetTexture {
    const key = assetKey(asset, role);
    const cached = this.#assetTextures.get(key);
    if (cached) return cached;
    if (this.#residentAssetBytes + asset.byteLength > this.#maximumResidentAssetBytes) {
      throw new RangeError("resident-asset-budget");
    }
    const upload = paddedUpload(asset, role === "tip");
    const texture = this.#device.createTexture({
      label: `Studio dynamic dual-tip ${role} ${asset.contentHash}`,
      size: { width: upload.width, height: upload.height, depthOrArrayLayers: 1 },
      format: "r8unorm",
      usage: GPU_TEXTURE_BINDING | GPU_TEXTURE_COPY_DST,
    });
    this.#device.queue.writeTexture(
      { texture },
      upload.bytes,
      {
        offset: 0,
        bytesPerRow: upload.bytesPerRow,
        rowsPerImage: upload.height,
      },
      { width: upload.width, height: upload.height, depthOrArrayLayers: 1 },
    );
    const resource = {
      key,
      byteLength: asset.byteLength,
      texture,
      view: texture.createView(),
    };
    this.#assetTextures.set(key, resource);
    this.#residentAssetBytes += asset.byteLength;
    return resource;
  }

  #dummyGrainTexture(): AssetTexture {
    const cached = this.#assetTextures.get("dummy-grain");
    if (cached) return cached;
    const texture = this.#device.createTexture({
      label: "Studio dynamic dual-tip dummy white grain",
      size: { width: 1, height: 1, depthOrArrayLayers: 1 },
      format: "r8unorm",
      usage: GPU_TEXTURE_BINDING | GPU_TEXTURE_COPY_DST,
    });
    const bytes = new Uint8Array(ROW_ALIGNMENT);
    bytes[0] = 255;
    this.#device.queue.writeTexture(
      { texture },
      bytes,
      { bytesPerRow: ROW_ALIGNMENT, rowsPerImage: 1 },
      { width: 1, height: 1, depthOrArrayLayers: 1 },
    );
    const resource = {
      key: "dummy-grain",
      byteLength: 0,
      texture,
      view: texture.createView(),
    };
    this.#assetTextures.set(resource.key, resource);
    return resource;
  }

  #primaryBindGroup(
    plan: StudioEngineWebGpuTexturedBrushPlan,
    batch: StudioEngineWebGpuTexturedBrushBatch,
  ): GPUBindGroup {
    const tip = this.#uploadAsset(plan.assets[batch.tipAssetIndex]!, "tip");
    const grain = batch.grainAssetIndex === null
      ? this.#dummyGrainTexture()
      : this.#uploadAsset(plan.assets[batch.grainAssetIndex]!, "grain");
    const key = `${batch.key}|${tip.key}|${grain.key}`;
    const cached = this.#primaryBindGroups.get(key);
    if (cached) return cached;
    const bindGroup = this.#device.createBindGroup({
      label: `Studio dynamic dual-tip primary batch ${batch.key}`,
      layout: this.#primaryLayout,
      entries: [
        { binding: 0, resource: tip.view },
        { binding: 1, resource: grain.view },
        { binding: 2, resource: this.#zeroBorderSampler },
        { binding: 3, resource: this.#repeatSampler },
        { binding: 4, resource: { buffer: this.#viewportBuffer } },
      ],
    });
    this.#primaryBindGroups.set(key, bindGroup);
    return bindGroup;
  }

  #uncachedAssetBytes(plan: StudioDynamicDualTipPlan): number {
    const identities = new Set<string>();
    let total = 0;
    const add = (
      asset: StudioEngineWebGpuTexturedBrushResolvedAsset,
      role: "tip" | "grain",
    ) => {
      const key = assetKey(asset, role);
      if (identities.has(key) || this.#assetTextures.has(key)) return;
      identities.add(key);
      total += asset.byteLength;
    };
    for (const batch of plan.primary.batches) {
      add(plan.primary.assets[batch.tipAssetIndex]!, "tip");
      if (batch.grainAssetIndex !== null) {
        add(plan.primary.assets[batch.grainAssetIndex]!, "grain");
      }
    }
    add(plan.secondaryAsset, "tip");
    return total;
  }

  public async execute(
    frame: StudioDynamicDualTipWebGpuFrame,
    signal?: AbortSignal,
  ): Promise<StudioDynamicDualTipWebGpuExecutionResult> {
    if (this.#disposed) return Object.freeze({ status: "disposed" });
    if (this.#lost) {
      return Object.freeze({ status: "device-lost", deviceEpoch: this.#deviceEpoch });
    }
    if (this.#failed) return Object.freeze({ status: "failed", reason: "gpu-error" });
    if (signal?.aborted) return Object.freeze({ status: "cancelled" });
    if (
      !frame
      || !positiveSafeInteger(frame.requestSequence)
      || !positiveSafeInteger(frame.deviceEpoch)
      || !validPlan(
        frame.plan,
        this.#maximumPrimaryDabs,
        this.#maximumSecondaryInstances,
      )
    ) return Object.freeze({ status: "rejected", reason: "invalid-frame" });
    if (frame.deviceEpoch !== this.#deviceEpoch) {
      return Object.freeze({ status: "rejected", reason: "device-epoch" });
    }
    if (frame.requestSequence <= this.#lastRequestSequence) {
      return Object.freeze({ status: "rejected", reason: "request-sequence" });
    }
    if (this.#inFlight >= this.#maximumInFlight) {
      return Object.freeze({
        status: "busy",
        inFlight: this.#inFlight,
        maximum: this.#maximumInFlight,
      });
    }
    if (
      frame.plan.primary.dabs.length > this.#maximumPrimaryDabs
      || frame.plan.secondaryInstances.length > this.#maximumSecondaryInstances
    ) return Object.freeze({ status: "rejected", reason: "request-limit" });
    if (
      this.#residentAssetBytes + this.#uncachedAssetBytes(frame.plan)
      > this.#maximumResidentAssetBytes
    ) return Object.freeze({ status: "rejected", reason: "resident-asset-budget" });

    this.#inFlight += 1;
    try {
      const primaryBuffer = this.#ensurePrimaryBuffer(frame.plan.primary.dabs.length);
      const secondaryBuffer = this.#ensureSecondaryBuffer(
        frame.plan.secondaryInstances.length,
      );
      this.#device.queue.writeBuffer(
        primaryBuffer,
        0,
        packStudioEngineWebGpuTexturedBrushDabs(frame.plan.primary),
      );
      this.#device.queue.writeBuffer(
        secondaryBuffer,
        0,
        packStudioDynamicDualTipSecondaryInstances(frame.plan),
      );
      const secondaryTexture = this.#uploadAsset(frame.plan.secondaryAsset, "tip");
      const actualSecondaryBindGroup = this.#device.createBindGroup({
        label: `Studio dynamic dual-tip secondary ${secondaryTexture.key}`,
        layout: this.#secondaryLayout,
        entries: [
          { binding: 0, resource: secondaryTexture.view },
          { binding: 1, resource: this.#zeroBorderSampler },
          { binding: 2, resource: { buffer: this.#viewportBuffer } },
        ],
      });
      if (signal?.aborted) return Object.freeze({ status: "cancelled" });
      this.#lastRequestSequence = frame.requestSequence;

      const firstColor = frame.plan.primary.dabs[0]!.color.components;
      const combineFloats = new Float32Array(8);
      combineFloats[0] = firstColor[0];
      combineFloats[1] = firstColor[1];
      combineFloats[2] = firstColor[2];
      combineFloats[3] = firstColor[3];
      new Uint32Array(combineFloats.buffer)[4] = BLEND_FAMILIES.indexOf(
        frame.plan.extension.blendFamily,
      );
      this.#device.queue.writeBuffer(this.#combineBuffer, 0, combineFloats);

      const encoder = this.#device.createCommandEncoder({
        label: `Studio dynamic dual-tip request ${frame.requestSequence}`,
      });
      const primaryPass = encoder.beginRenderPass({
        label: "Studio dynamic dual-tip independent primary mask",
        colorAttachments: [{
          view: this.#primaryView,
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }, {
          view: this.#primaryRawMaskView,
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      primaryPass.setPipeline(this.#primaryPipeline);
      primaryPass.setVertexBuffer(0, primaryBuffer);
      for (const batch of frame.plan.primary.batches) {
        primaryPass.setBindGroup(0, this.#primaryBindGroup(frame.plan.primary, batch));
        primaryPass.draw(6, batch.instanceCount, 0, batch.firstInstance);
      }
      primaryPass.end();

      const secondaryPass = encoder.beginRenderPass({
        label: "Studio dynamic dual-tip independent secondary mask",
        colorAttachments: [{
          view: this.#secondaryView,
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      secondaryPass.setPipeline(this.#secondaryPipeline);
      secondaryPass.setVertexBuffer(0, secondaryBuffer);
      secondaryPass.setBindGroup(0, actualSecondaryBindGroup);
      secondaryPass.draw(6, frame.plan.secondaryInstances.length, 0, 0);
      secondaryPass.end();

      const porterDuff = frame.plan.primary.batches[0]!.porterDuff;
      const combinePass = encoder.beginRenderPass({
        label: `Studio dynamic dual-tip ${frame.plan.mode} authority combine`,
        colorAttachments: [{
          view: this.#authorityView,
          loadOp: frame.plan.mode === "rebuild" || !this.#initialized ? "clear" : "load",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      combinePass.setPipeline(this.#combinePipelines[porterDuff]);
      combinePass.setBindGroup(0, this.#combineBindGroup);
      combinePass.draw(3, 1, 0, 0);
      combinePass.end();
      this.#device.queue.submit([encoder.finish()]);
      this.#initialized = true;
      await this.#device.queue.onSubmittedWorkDone();
      if (this.#disposed) return Object.freeze({ status: "disposed" });
      if (this.#lost) {
        return Object.freeze({ status: "device-lost", deviceEpoch: this.#deviceEpoch });
      }
      const assets = [...frame.plan.primary.assets, frame.plan.secondaryAsset];
      const receipt: StudioDynamicDualTipWebGpuReceipt = Object.freeze({
        kind: "studio-dynamic-dual-tip-webgpu-receipt",
        revision: STUDIO_DYNAMIC_DUAL_TIP_WEBGPU_RUNTIME_REVISION,
        backend: "webgpu",
        providerCapability: "dynamic-dual-tip-r8-aggregate-preview-v1",
        textureFormat: STUDIO_DYNAMIC_DUAL_TIP_WEBGPU_TEXTURE_FORMAT,
        colorModel: "scene-linear-premultiplied",
        maskCombination: "independent-primary-secondary-aggregate-preview-v1",
        fidelity: "aggregate-mask-preview-only",
        exactExecutionRoute: "webgpu-exact-packed-deposition-v2",
        requestSequence: frame.requestSequence,
        deviceEpoch: this.#deviceEpoch,
        mode: frame.plan.mode,
        strokeId: frame.plan.strokeId,
        commandSequence: frame.plan.commandSequence,
        blendFamily: frame.plan.extension.blendFamily,
        primaryDabCount: frame.plan.primary.dabs.length,
        secondaryStationCount: frame.plan.secondaryStations.length,
        secondaryInstanceCount: frame.plan.secondaryInstances.length,
        assetCount: assets.length,
        assetBytes: assets.reduce((total, asset) => total + asset.byteLength, 0),
        planFingerprint: frame.plan.fingerprint,
        queueState: "completed",
        complete: false,
      });
      return Object.freeze({ status: "completed", receipt });
    } catch (error) {
      if (error instanceof RangeError && error.message === "resident-asset-budget") {
        return Object.freeze({ status: "rejected", reason: "resident-asset-budget" });
      }
      this.#failed = true;
      return Object.freeze({ status: "failed", reason: "gpu-error" });
    } finally {
      this.#inFlight -= 1;
    }
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#primaryBuffer?.destroy();
    this.#secondaryBuffer?.destroy();
    this.#viewportBuffer.destroy();
    this.#combineBuffer.destroy();
    this.#authorityTexture.destroy();
    this.#primaryTexture.destroy();
    this.#primaryRawMaskTexture.destroy();
    this.#secondaryTexture.destroy();
    for (const asset of this.#assetTextures.values()) asset.texture.destroy();
    this.#assetTextures.clear();
    this.#primaryBindGroups.clear();
    if (this.#ownsDevice) this.#device.destroy();
  }
}
