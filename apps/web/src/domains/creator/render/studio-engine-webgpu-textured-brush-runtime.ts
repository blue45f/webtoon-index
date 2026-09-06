import {
  normalizeStudioBrushR8TextureGrainSource,
  serializeStudioBrushR8TextureGrainSourceCanonical,
} from "../brush/studio-brush-r8-grain-asset-contract";
import { sha256HexPortable } from "../studio-sha256";

import {
  acquireStudioEngineWebGpuPresentationProducerWrite,
  fingerprintStudioEngineWebGpuPresentationContent,
  settleStudioEngineWebGpuPresentationProducerWrite,
  STUDIO_ENGINE_WEBGPU_PRESENTATION_COLOR_MODEL,
  STUDIO_ENGINE_WEBGPU_PRESENTATION_SURFACE_FORMAT,
  STUDIO_ENGINE_WEBGPU_PRESENTATION_SURFACE_REVISION,
  STUDIO_ENGINE_WEBGPU_PRESENTATION_WORK_SURFACE_USAGE,
  STUDIO_ENGINE_WEBGPU_PRESENTATION_WORKING_COLOR_SPACE,
  type StudioEngineWebGpuDocumentToSurfaceTransform,
  type StudioEngineWebGpuPresentationFrameLease,
  type StudioEngineWebGpuPresentationProducerWriteClaim,
} from "./studio-engine-webgpu-presentation-surface";
import {
  fingerprintStudioEngineWebGpuTexturedBrushPlanSemantics,
  STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_BUDGETS,
  STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_DUAL_TIP_CAPABILITY,
  STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_PLAN_VERSION,
  type StudioEngineWebGpuTexturedBrushBatch,
  type StudioEngineWebGpuTexturedBrushPlan,
  type StudioEngineWebGpuTexturedBrushResolvedAsset,
} from "./studio-engine-webgpu-textured-brush-plan";
import {
  StudioWebGpuR8GrainTextureCache,
  studioWebGpuR8GrainDabCenterUv,
  type StudioWebGpuR8GrainNativeInput,
  type StudioWebGpuR8GrainTextureLease,
} from "./studio-webgpu-r8-grain-native";

export const STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_RUNTIME_REVISION = 1 as const;
export const STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_TEXTURE_FORMAT = "rgba16float" as const;
export const STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_INSTANCE_FLOATS = 28;
export const STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_INSTANCE_BYTES =
  STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT;

const GPU_TEXTURE_COPY_DST = 0x02;
const GPU_TEXTURE_BINDING = 0x04;
const GPU_TEXTURE_COPY_SRC = 0x01;
const GPU_TEXTURE_RENDER_ATTACHMENT = 0x10;
const GPU_BUFFER_COPY_DST = 0x08;
const GPU_BUFFER_VERTEX = 0x20;
const GPU_BUFFER_UNIFORM = 0x40;
const ROW_ALIGNMENT = 256;
/**
 * Plans are lowered through f32 channels before reaching this runtime. Keep the admission
 * tolerance large enough for two f32 multiplications, but far below one 8-bit alpha step.
 */
const PAINT_CHANNEL_F32_EPSILON = 2e-6;

/**
 * R8 sampling semantics mirror the CPU oracle:
 * - tip assets are uploaded with a one-texel zero border and bilinear filtered;
 * - grain assets repeat bilinearly;
 * - procedural grain hashes signed integer cells with u32 arithmetic;
 * - straight scene-linear colour is premultiplied by the CPU packer exactly once.
 */
const TEXTURED_BRUSH_SHADER = /* wgsl */ `
struct Viewport {
  size: vec2f,
  inverse_size: vec2f,
  document_scale: vec2f,
  document_offset: vec2f,
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
  let document_offset = basis_x * local.x + basis_y * local.y;
  let document = center + document_offset;
  let surface = document * viewport.document_scale + viewport.document_offset;
  let clip = vec2f(
    surface.x * viewport.inverse_size.x * 2.0 - 1.0,
    1.0 - surface.y * viewport.inverse_size.y * 2.0,
  );
  var output: VertexOutput;
  output.position = vec4f(clip, 0.0, 1.0);
  output.local = local;
  output.document = document;
  output.color = color;
  output.dynamics = dynamics;
  output.grain_origin = grain_origin;
  output.flags = flags;
  let durable_r8 = (u32(flags.y + 0.5) & 4u) != 0u;
  let native_grain_uv = texture_info.zw + document_offset / dynamics.z;
  output.texture_info = vec4f(
    texture_info.xy,
    select(texture_info.zw, native_grain_uv, durable_r8),
  );
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

fn shaped_grain(value: f32, contrast: f32, invert: bool, durable_r8: bool) -> f32 {
  // The canonical specialist v1 contract retains its historical 3× contrast transfer. Durable
  // Studio R8 assets use the Canvas/SVG contract's 4× transfer and are marked explicitly below.
  let contrast_gain = select(3.0, 4.0, durable_r8);
  let contrasted = clamp(
    0.5 + (value - 0.5) * (1.0 + contrast * contrast_gain),
    0.0,
    1.0,
  );
  return select(contrasted, 1.0 - contrasted, invert);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
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
  let durable_r8 = (packed_grain_flags & 4u) != 0u;
  let grain_cell = vec2i(floor(grain_position / input.dynamics.z));
  let procedural_grain = integer_noise(grain_cell, seed);
  let asset_uv = select(
    grain_position / input.dynamics.z,
    input.texture_info.zw,
    durable_r8,
  );
  let asset_grain = textureSample(
    grain_texture,
    grain_sampler,
    asset_uv,
  ).r;
  var grain_value = select(1.0, procedural_grain, grain_kind == 1u);
  grain_value = select(grain_value, asset_grain, grain_kind == 2u);
  let grain_shaped = shaped_grain(
    grain_value,
    input.dynamics.w,
    grain_invert,
    durable_r8,
  );
  let grain_factor = mix(1.0, grain_shaped, input.dynamics.y);
  return input.color * (tip_coverage * grain_factor);
}
`;

export interface StudioEngineWebGpuTexturedBrushRuntimeOptions {
  readonly device: GPUDevice;
  /**
   * Legacy private-target dimensions. They remain required unless `presentationOnly` is enabled.
   */
  readonly width?: number;
  readonly height?: number;
  readonly initialDeviceEpoch?: number;
  readonly maximumDabs?: number;
  readonly maximumInFlightSubmissions?: number;
  readonly maximumResidentAssetBytes?: number;
  readonly ownsDevice?: boolean;
  /**
   * Strict shared-surface mode. No private RGBA16F authority is allocated and every execution
   * must carry a valid presentation lease from the same request/device/fingerprint authority.
   */
  readonly presentationOnly?: boolean;
  readonly onDeviceLost?: (info: GPUDeviceLostInfo) => void;
  /**
   * Optional shared durable-R8 cache. When omitted the runtime creates and owns a device-local
   * cache backed by the verified browser registry. Injecting one lets several specialist runtimes
   * share the same content-addressed GPU texture residency.
   */
  readonly nativeR8GrainTextureCache?: StudioWebGpuR8GrainTextureCache;
}

export interface StudioEngineWebGpuTexturedBrushFrame {
  readonly requestSequence: number;
  readonly deviceEpoch: number;
  readonly plan: StudioEngineWebGpuTexturedBrushPlan;
  /**
   * Optional shared linear presentation target. A supplied-but-invalid lease always fails closed;
   * the runtime never silently paints a private surface instead.
   */
  readonly presentationLease?: StudioEngineWebGpuPresentationFrameLease;
}

export interface StudioEngineWebGpuTexturedBrushReceipt {
  readonly kind: "studio-engine-webgpu-textured-brush-receipt";
  readonly revision: typeof STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_RUNTIME_REVISION;
  readonly backend: "webgpu";
  readonly textureFormat: typeof STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_TEXTURE_FORMAT;
  readonly colorModel: "scene-linear-premultiplied";
  readonly requestSequence: number;
  readonly deviceEpoch: number;
  readonly mode: "append" | "rebuild";
  readonly strokeId: string;
  readonly commandSequence: number;
  readonly dabCount: number;
  readonly batchCount: number;
  readonly assetCount: number;
  readonly assetBytes: number;
  readonly batchKeys: readonly string[];
  readonly planSemanticFingerprint: string | null;
  readonly grainSamplingSemantics:
    | "specialist-texture-v1"
    | "durable-r8-cpu-parity-v1";
  readonly nativeR8GrainSourceKey: string | null;
  readonly nativeR8GrainTextureBytes: number;
  readonly renderTarget: "private" | "presentation";
  readonly sourceFrameFingerprint: string;
  readonly workSurfaceEpoch: number | null;
  readonly baseContentGeneration: number | null;
  readonly baseContentFingerprint: `sha256:${string}` | null;
  readonly contentGeneration: number | null;
  readonly contentFingerprint: `sha256:${string}` | null;
  readonly queueState: "completed";
  readonly complete: true;
}

export type StudioEngineWebGpuTexturedBrushExecutionResult =
  | Readonly<{ status: "completed"; receipt: StudioEngineWebGpuTexturedBrushReceipt }>
  | Readonly<{
      status: "rejected";
      reason:
        | "invalid-frame"
        | "request-sequence"
        | "device-epoch"
        | "content-generation-exhausted"
        | "request-limit"
        | "resident-asset-budget"
        | "native-r8-grain-unavailable"
        | "content-uninitialized"
        | "presentation-lease-required"
        | "presentation-lease-invalid";
      detail?: string;
    }>
  | Readonly<{ status: "busy"; inFlight: number; maximum: number }>
  | Readonly<{ status: "cancelled" }>
  | Readonly<{ status: "device-lost"; deviceEpoch: number }>
  | Readonly<{ status: "disposed" }>
  | Readonly<{ status: "failed"; reason: "gpu-error" }>;

export type StudioEngineWebGpuTexturedBrushRuntimeCreationResult =
  | Readonly<{ status: "ready"; runtime: StudioEngineWebGpuTexturedBrushRuntime }>
  | Readonly<{ status: "rejected"; reason: "invalid-options" | "initialization-failed" }>;

interface AssetTexture {
  readonly key: string;
  readonly role: "tip" | "grain" | "dummy-grain";
  readonly byteLength: number;
  readonly texture: GPUTexture;
  readonly view: GPUTextureView;
  readonly width: number;
  readonly height: number;
}

interface CachedBindGroup {
  readonly bindGroup: GPUBindGroup;
  readonly assetKeys: readonly string[];
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function unitPaintChannel(value: unknown): value is number {
  return finite(value) && value >= 0 && value <= 1;
}

/**
 * A lowered dab stores final straight alpha, while opacity and flow remain as diagnostic channels.
 *
 * `alpha = sourceColorAlpha × opacity × flow`, where sourceColorAlpha is in [0, 1]. The source
 * alpha is not retained separately, so the strongest fail-closed invariant available here is that
 * final alpha cannot exceed the opacity×flow ceiling (apart from f32 lowering error), and a zero
 * ceiling must produce zero alpha.
 */
function dabAlphaMatchesPaintChannels(
  alpha: number,
  opacity: number,
  flow: number,
): boolean {
  if (
    !unitPaintChannel(alpha)
    || !unitPaintChannel(opacity)
    || !unitPaintChannel(flow)
  ) return false;
  const ceiling = opacity * flow;
  return ceiling <= PAINT_CHANNEL_F32_EPSILON
    ? alpha <= PAINT_CHANNEL_F32_EPSILON
    : alpha <= ceiling + PAINT_CHANNEL_F32_EPSILON;
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function finiteF32(value: unknown): value is number {
  return finite(value) && Number.isFinite(Math.fround(value));
}

const IDENTITY_DOCUMENT_TO_SURFACE_TRANSFORM:
  Readonly<StudioEngineWebGpuDocumentToSurfaceTransform> = Object.freeze({
    m11: 1,
    m12: 0,
    m21: 0,
    m22: 1,
    dx: 0,
    dy: 0,
  });

/**
 * Packs the exact document-to-physical-surface affine used by the textured-brush vertex stage.
 * Grain sampling deliberately remains in document space; only raster placement is transformed.
 */
export function packStudioEngineWebGpuTexturedBrushViewportUniform(
  width: number,
  height: number,
  documentToSurface: Readonly<StudioEngineWebGpuDocumentToSurfaceTransform> =
    IDENTITY_DOCUMENT_TO_SURFACE_TRANSFORM,
): Float32Array {
  if (
    !positiveSafeInteger(width)
    || !positiveSafeInteger(height)
    || !documentToSurface
    || documentToSurface.m12 !== 0
    || documentToSurface.m21 !== 0
    || ![
      documentToSurface.m11,
      documentToSurface.m22,
      documentToSurface.dx,
      documentToSurface.dy,
    ].every(finiteF32)
    || documentToSurface.m11 === 0
    || documentToSurface.m22 === 0
  ) {
    throw new RangeError("invalid-textured-brush-viewport");
  }
  return new Float32Array([
    width,
    height,
    1 / width,
    1 / height,
    documentToSurface.m11,
    documentToSurface.m22,
    documentToSurface.dx,
    documentToSurface.dy,
  ]);
}

function semanticFingerprint(
  plan: StudioEngineWebGpuTexturedBrushPlan,
): `sha256:${string}` | null {
  return fingerprintStudioEngineWebGpuTexturedBrushPlanSemantics(plan);
}

function validPresentationLease(
  lease: StudioEngineWebGpuPresentationFrameLease,
  frame: StudioEngineWebGpuTexturedBrushFrame,
  expectedFingerprint: string,
): boolean {
  try {
    const surface = lease?.workSurface;
    const configuration = lease?.configuration;
    return Boolean(
      lease
      && lease.kind === "studio-engine-webgpu-presentation-frame-lease"
      && lease.revision === STUDIO_ENGINE_WEBGPU_PRESENTATION_SURFACE_REVISION
      && lease.requestSequence === frame.requestSequence
      && lease.deviceEpoch === frame.deviceEpoch
      && lease.sourceFrameFingerprint === expectedFingerprint
      && positiveSafeInteger(lease.presentationEpoch)
      && positiveSafeInteger(lease.resizeEpoch)
      && positiveSafeInteger(lease.viewportEpoch)
      && positiveSafeInteger(lease.flipEpoch)
      && surface
      && surface.kind === "studio-engine-webgpu-shared-linear-work-surface"
      && surface.revision === STUDIO_ENGINE_WEBGPU_PRESENTATION_SURFACE_REVISION
      && surface.format === STUDIO_ENGINE_WEBGPU_PRESENTATION_SURFACE_FORMAT
      && surface.usage === STUDIO_ENGINE_WEBGPU_PRESENTATION_WORK_SURFACE_USAGE
      && surface.colorModel === STUDIO_ENGINE_WEBGPU_PRESENTATION_COLOR_MODEL
      && surface.workingColorSpace
        === STUDIO_ENGINE_WEBGPU_PRESENTATION_WORKING_COLOR_SPACE
      && positiveSafeInteger(surface.width)
      && positiveSafeInteger(surface.height)
      && positiveSafeInteger(surface.workSurfaceEpoch)
      && surface.byteLength === surface.width * surface.height * 8
      && surface.texture
      && surface.view
      && configuration
      && configuration.presentationEpoch === lease.presentationEpoch
      && configuration.resizeEpoch === lease.resizeEpoch
      && configuration.viewportEpoch === lease.viewportEpoch
      && configuration.flipEpoch === lease.flipEpoch
      && configuration.physicalWidth === surface.width
      && configuration.physicalHeight === surface.height
      && configuration.surfacePixels === surface.width * surface.height
      && configuration.surfaceBytes === surface.byteLength
      && packStudioEngineWebGpuTexturedBrushViewportUniform(
        surface.width,
        surface.height,
        configuration.documentToSurface,
      )
    );
  } catch {
    return false;
  }
}

function nextAligned(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function assetTextureIdentity(
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
    const targetY = y + (zeroBorder ? 1 : 0);
    const targetX = zeroBorder ? 1 : 0;
    bytes.set(
      asset.bytes.subarray(y * asset.width, (y + 1) * asset.width),
      targetY * bytesPerRow + targetX,
    );
  }
  return { bytes, bytesPerRow, width, height };
}

function durableR8InputForPlan(
  plan: StudioEngineWebGpuTexturedBrushPlan,
): StudioWebGpuR8GrainNativeInput | null {
  if (plan.durableR8GrainSource === undefined) return null;
  const source = normalizeStudioBrushR8TextureGrainSource(
    plan.durableR8GrainSource,
  );
  const sourceKey = source
    ? serializeStudioBrushR8TextureGrainSourceCanonical(source)
    : null;
  const grain = plan.grain;
  if (
    !source
    || !sourceKey
    || grain?.kind !== "asset-r8-repeat"
    || !Number.isSafeInteger(plan.grainPhaseStrokeSeed)
    || plan.grainPhaseStrokeSeed! < 0
    || plan.grainPhaseStrokeSeed! > 0xffff_ffff
  ) {
    return null;
  }
  const asset = plan.assets[grain.assetIndex];
  if (
    !asset
    || asset.role !== "grain"
    || source.asset.assetId !== asset.assetId
    || source.asset.decodedSha256 !== asset.contentHash
    || source.asset.width !== asset.width
    || source.asset.height !== asset.height
    || source.asset.channel !== asset.channel
    || source.asset.encoding !== asset.format
    || asset.byteLength !== source.asset.width * source.asset.height
    || plan.batches.some((batch) => batch.grainAssetIndex !== grain.assetIndex)
  ) {
    return null;
  }
  return {
    source,
    space: grain.space === "stroke" ? "stroke-fixed" : "canvas-fixed",
    scale: grain.scale,
    amount: grain.depth,
    contrast: grain.contrast,
    seed: grain.seed,
    strokeOriginX: grain.originX,
    strokeOriginY: grain.originY,
    strokeSeed: plan.grainPhaseStrokeSeed!,
  };
}

function planIsValid(plan: StudioEngineWebGpuTexturedBrushPlan, maximumDabs: number): boolean {
  try {
    if (
      plan.kind !== "studio-engine-webgpu-textured-brush-plan"
      || plan.version !== STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_PLAN_VERSION
      || (plan.mode !== "append" && plan.mode !== "rebuild")
      || plan.dualTip !== STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_DUAL_TIP_CAPABILITY
      || plan.textureFormat !== STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_TEXTURE_FORMAT
      || plan.colorModel !== "scene-linear-premultiplied"
      || !Array.isArray(plan.assets)
      || plan.assets.length < 1
      || plan.assets.length > STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_BUDGETS.maxAssets
      || !Array.isArray(plan.dabs)
      || plan.dabs.length > maximumDabs
      || !Array.isArray(plan.batches)
      || plan.tip.assetIndex !== 0
    ) return false;
    const durableR8Declared =
      plan.durableR8GrainSource !== undefined
      || plan.grainPhaseStrokeSeed !== undefined;
    if (
      durableR8Declared
      && (
        durableR8InputForPlan(plan) === null
        || plan.grainSamplingSemantics !== "durable-r8-cpu-parity-v1"
        || plan.semanticFingerprint === undefined
      )
    ) return false;
    if (
      !durableR8Declared
      && plan.grainSamplingSemantics === "durable-r8-cpu-parity-v1"
    ) return false;
    if (
      plan.semanticFingerprint !== undefined
      && fingerprintStudioEngineWebGpuTexturedBrushPlanSemantics(plan)
        !== plan.semanticFingerprint
    ) return false;
    for (let index = 0; index < plan.assets.length; index += 1) {
      const asset = plan.assets[index]!;
      if (
        asset.assetIndex !== index
        || !positiveSafeInteger(asset.width)
        || !positiveSafeInteger(asset.height)
        || asset.byteLength !== asset.width * asset.height
        || asset.bytes.byteLength !== asset.byteLength
        || asset.format !== "r8-unorm"
        || asset.contentHash !== `sha256:${sha256HexPortable(asset.bytes)}`
      ) return false;
    }
    for (let index = 0; index < plan.dabs.length; index += 1) {
      const dab = plan.dabs[index]!;
      const [red, green, blue, alpha] = dab.color.components;
      if (
        dab.index !== index
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
        || !unitPaintChannel(dab.pressure)
        || !unitPaintChannel(dab.opacity)
        || !unitPaintChannel(dab.flow)
        || !unitPaintChannel(dab.grainDepth)
        || !unitPaintChannel(red)
        || !unitPaintChannel(green)
        || !unitPaintChannel(blue)
        || !dabAlphaMatchesPaintChannels(alpha, dab.opacity, dab.flow)
        || !unitPaintChannel(dab.tip.hardness)
        || !unitPaintChannel(dab.tip.roundness)
        || dab.tip.roundness <= 0
        || dab.color.space !== "linear-srgb"
        || dab.color.alphaMode !== "straight"
        || dab.composite.blendMode !== "normal"
      ) return false;
    }
    let nextInstance = 0;
    for (const batch of plan.batches) {
      if (
        typeof batch.key !== "string"
        || batch.key.length === 0
        || batch.firstInstance !== nextInstance
        || !positiveSafeInteger(batch.instanceCount)
        || batch.firstInstance + batch.instanceCount > plan.dabs.length
        || !plan.assets[batch.tipAssetIndex]
        || (
          batch.grainAssetIndex !== null
          && !plan.assets[batch.grainAssetIndex]
        )
      ) return false;
      nextInstance += batch.instanceCount;
    }
    return nextInstance === plan.dabs.length;
  } catch {
    return false;
  }
}

/**
 * Packs scene-linear premultiplied colour and all textured/grain parameters into the single
 * interleaved vertex stream consumed by the WGSL shader.
 */
export function packStudioEngineWebGpuTexturedBrushDabs(
  plan: StudioEngineWebGpuTexturedBrushPlan,
  scratch?: Float32Array,
  nativeR8Grain?: Pick<
    StudioWebGpuR8GrainTextureLease,
    "parameters" | "source"
  >,
): Float32Array {
  const required = plan.dabs.length * STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_INSTANCE_FLOATS;
  const packed = scratch && scratch.length >= required
    ? scratch.subarray(0, required)
    : new Float32Array(required);
  const grain = plan.grain;
  const grainKind = nativeR8Grain
    ? 2
    : grain === null
    ? 0
    : grain.kind === "procedural-integer-noise"
      ? 1
      : 2;
  // Durable R8 computes a wrapped dab-centre UV in JS f64. The VS adds only each corner's small
  // local offset, avoiding the catastrophic fractional loss of `1e6 / 0.3` in fragment f32.
  const nativeParameters = nativeR8Grain?.parameters;
  const grainSpace = nativeParameters
    ? 1
    : grain?.space === "stroke"
      ? 1
      : 0;
  const grainScale = nativeParameters?.scale ?? grain?.scale ?? 1;
  const grainContrast = nativeParameters?.contrast ?? grain?.contrast ?? 0;
  const grainOriginX = nativeParameters?.anchorX ?? grain?.originX ?? 0;
  const grainOriginY = nativeParameters?.anchorY ?? grain?.originY ?? 0;
  const grainSeed = grain?.seed ?? 0;
  const tipAsset = plan.assets[plan.tip.assetIndex]!;
  const grainAsset = grain?.kind === "asset-r8-repeat"
    ? plan.assets[grain.assetIndex]!
    : null;
  for (let index = 0; index < plan.dabs.length; index += 1) {
    const dab = plan.dabs[index]!;
    const offset = index * STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_INSTANCE_FLOATS;
    packed[offset] = dab.x;
    packed[offset + 1] = dab.y;
    packed[offset + 2] = dab.tip.localToDocument[0];
    packed[offset + 3] = dab.tip.localToDocument[1];
    packed[offset + 4] = dab.tip.localToDocument[2];
    packed[offset + 5] = dab.tip.localToDocument[3];
    const alpha = dab.color.components[3];
    packed[offset + 6] = dab.color.components[0] * alpha;
    packed[offset + 7] = dab.color.components[1] * alpha;
    packed[offset + 8] = dab.color.components[2] * alpha;
    packed[offset + 9] = alpha;
    packed[offset + 10] = dab.tip.hardness;
    // Per-dab texture-depth dynamics remain authoritative; the durable source changes only how
    // that already-planned depth is sampled, never the plan's paint amount.
    packed[offset + 11] = dab.grainDepth;
    packed[offset + 12] = grainScale;
    packed[offset + 13] = grainContrast;
    packed[offset + 14] = grainOriginX;
    packed[offset + 15] = grainOriginY;
    packed[offset + 16] = dab.pressure;
    packed[offset + 17] = dab.diameter;
    packed[offset + 18] = dab.tip.roundness;
    packed[offset + 19] = dab.tip.angleRadians;
    packed[offset + 20] = grainKind;
    packed[offset + 21] = grainSpace
      | (grain?.invert ? 2 : 0)
      | (nativeParameters ? 4 : 0);
    packed[offset + 22] = grainSeed & 0xffff;
    packed[offset + 23] = grainSeed >>> 16;
    packed[offset + 24] = tipAsset.width;
    packed[offset + 25] = tipAsset.height;
    const nativeCenterUv = nativeParameters
      ? studioWebGpuR8GrainDabCenterUv(nativeParameters, dab.x, dab.y)
      : null;
    if (nativeParameters && !nativeCenterUv) {
      throw new RangeError("invalid-native-r8-coordinate");
    }
    packed[offset + 26] = nativeCenterUv?.[0] ?? grainAsset?.width ?? 1;
    packed[offset + 27] = nativeCenterUv?.[1] ?? grainAsset?.height ?? 1;
  }
  return packed;
}

function vertexBufferLayout(): GPUVertexBufferLayout {
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

function blendState(
  porterDuff: "source-over" | "destination-out",
): GPUBlendState {
  if (porterDuff === "destination-out") {
    return {
      color: { operation: "add", srcFactor: "zero", dstFactor: "one-minus-src-alpha" },
      alpha: { operation: "add", srcFactor: "zero", dstFactor: "one-minus-src-alpha" },
    };
  }
  return {
    color: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
    alpha: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
  };
}

function validPrivateSurfaceDimensions(
  options:
    | Pick<StudioEngineWebGpuTexturedBrushRuntimeOptions, "width" | "height">
    | null
    | undefined,
): boolean {
  return positiveSafeInteger(options?.width)
    && positiveSafeInteger(options?.height)
    && options.width <= STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_BUDGETS.maxAssetDimension
    && options.height <= STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_BUDGETS.maxAssetDimension;
}

export function createStudioEngineWebGpuTexturedBrushRuntime(
  options: StudioEngineWebGpuTexturedBrushRuntimeOptions,
): StudioEngineWebGpuTexturedBrushRuntimeCreationResult {
  try {
    const presentationOnly = options?.presentationOnly === true;
    const hasPrivateDimensions = validPrivateSurfaceDimensions(options);
    if (
      typeof options !== "object"
      || options === null
      || !options.device
      || typeof options.device.pushErrorScope !== "function"
      || typeof options.device.popErrorScope !== "function"
      || (
        options.presentationOnly !== undefined
        && typeof options.presentationOnly !== "boolean"
      )
      || (!presentationOnly && !hasPrivateDimensions)
      || (
        presentationOnly
        && (
          (options.width === undefined) !== (options.height === undefined)
          || (
            options.width !== undefined
            && !hasPrivateDimensions
          )
        )
      )
    ) return Object.freeze({ status: "rejected", reason: "invalid-options" });
    return Object.freeze({
      status: "ready",
      runtime: new StudioEngineWebGpuTexturedBrushRuntime(options),
    });
  } catch {
    return Object.freeze({ status: "rejected", reason: "initialization-failed" });
  }
}

export class StudioEngineWebGpuTexturedBrushRuntime {
  readonly #device: GPUDevice;
  readonly #width: number;
  readonly #height: number;
  readonly #presentationOnly: boolean;
  #deviceEpoch: number;
  readonly #maximumDabs: number;
  readonly #maximumInFlight: number;
  readonly #maximumResidentAssetBytes: number;
  readonly #ownsDevice: boolean;
  readonly #nativeR8GrainTextureCache: StudioWebGpuR8GrainTextureCache;
  readonly #ownsNativeR8GrainTextureCache: boolean;
  readonly #surfaceTexture: GPUTexture | null;
  readonly #surfaceView: GPUTextureView | null;
  readonly #uniformBuffer: GPUBuffer;
  readonly #tipSampler: GPUSampler;
  readonly #grainSampler: GPUSampler;
  readonly #pipelines: Readonly<Record<"source-over" | "destination-out", GPURenderPipeline>>;
  readonly #bindGroupLayout: GPUBindGroupLayout;
  readonly #assetTextures = new Map<string, AssetTexture>();
  readonly #bindGroups = new Map<string, CachedBindGroup>();
  #instanceBuffer: GPUBuffer | null = null;
  #instanceCapacity = 0;
  #instanceScratch: Float32Array | null = null;
  #residentAssetBytes = 0;
  #inFlight = 0;
  #lastRequestSequence = 0;
  #privateContentInitialized = false;
  #privateContentGeneration = 0;
  #privateContentFingerprint: `sha256:${string}` | null = null;
  #disposed = false;
  #lost = false;
  #failed = false;
  #submissionTail: Promise<void> = Promise.resolve();

  public constructor(options: StudioEngineWebGpuTexturedBrushRuntimeOptions) {
    this.#device = options.device;
    this.#width = options.width ?? 1;
    this.#height = options.height ?? 1;
    this.#presentationOnly = options.presentationOnly ?? false;
    this.#deviceEpoch = options.initialDeviceEpoch ?? 1;
    this.#maximumDabs = options.maximumDabs
      ?? STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_BUDGETS.maxDabs;
    this.#maximumInFlight = options.maximumInFlightSubmissions ?? 2;
    this.#maximumResidentAssetBytes = options.maximumResidentAssetBytes
      ?? STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_BUDGETS.maxTotalAssetBytes;
    this.#ownsDevice = options.ownsDevice ?? false;
    if (
      (
        !this.#presentationOnly
        && !validPrivateSurfaceDimensions(options)
      )
      || (
        this.#presentationOnly
        && (
          (options.width === undefined) !== (options.height === undefined)
          || (
            options.width !== undefined
            && !validPrivateSurfaceDimensions(options)
          )
        )
      )
      || !positiveSafeInteger(this.#deviceEpoch)
      || this.#deviceEpoch === Number.MAX_SAFE_INTEGER
      || !positiveSafeInteger(this.#maximumDabs)
      || this.#maximumDabs > STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_BUDGETS.maxDabs
      || !positiveSafeInteger(this.#maximumInFlight)
      || !positiveSafeInteger(this.#maximumResidentAssetBytes)
    ) throw new Error("invalid textured brush runtime options");
    this.#ownsNativeR8GrainTextureCache = options.nativeR8GrainTextureCache === undefined;
    this.#nativeR8GrainTextureCache = options.nativeR8GrainTextureCache
      ?? new StudioWebGpuR8GrainTextureCache({
        device: this.#device,
        maxResidentBytes: this.#maximumResidentAssetBytes,
      });

    this.#surfaceTexture = this.#presentationOnly
      ? null
      : this.#device.createTexture({
        label: "Studio textured brush rgba16float authority",
        size: { width: this.#width, height: this.#height, depthOrArrayLayers: 1 },
        format: STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_TEXTURE_FORMAT,
        usage: GPU_TEXTURE_RENDER_ATTACHMENT | GPU_TEXTURE_COPY_SRC | GPU_TEXTURE_BINDING,
      });
    this.#surfaceView = this.#surfaceTexture?.createView() ?? null;
    this.#uniformBuffer = this.#device.createBuffer({
      label: "Studio textured brush viewport uniform",
      size: 32,
      usage: GPU_BUFFER_UNIFORM | GPU_BUFFER_COPY_DST,
    });
    this.#device.queue.writeBuffer(
      this.#uniformBuffer,
      0,
      packStudioEngineWebGpuTexturedBrushViewportUniform(
        this.#width,
        this.#height,
      ),
    );
    this.#tipSampler = this.#device.createSampler({
      label: "Studio textured brush zero-border bilinear tip sampler",
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "nearest",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    this.#grainSampler = this.#device.createSampler({
      label: "Studio textured brush repeat bilinear grain sampler",
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "nearest",
      addressModeU: "repeat",
      addressModeV: "repeat",
    });
    const module = this.#device.createShaderModule({
      label: "Studio textured brush clean-room shader",
      code: TEXTURED_BRUSH_SHADER,
    });
    this.#bindGroupLayout = this.#device.createBindGroupLayout({
      label: "Studio textured brush asset bind layout",
      entries: [
        { binding: 0, visibility: 2, texture: { sampleType: "float" } },
        { binding: 1, visibility: 2, texture: { sampleType: "float" } },
        { binding: 2, visibility: 2, sampler: { type: "filtering" } },
        { binding: 3, visibility: 2, sampler: { type: "filtering" } },
        { binding: 4, visibility: 1, buffer: { type: "uniform" } },
      ],
    });
    const layout = this.#device.createPipelineLayout({
      label: "Studio textured brush pipeline layout",
      bindGroupLayouts: [this.#bindGroupLayout],
    });
    const makePipeline = (
      porterDuff: "source-over" | "destination-out",
    ): GPURenderPipeline => this.#device.createRenderPipeline({
      label: `Studio textured brush ${porterDuff} pipeline`,
      layout,
      vertex: {
        module,
        entryPoint: "vs_main",
        buffers: [vertexBufferLayout()],
      },
      fragment: {
        module,
        entryPoint: "fs_main",
        targets: [{
          format: STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_TEXTURE_FORMAT,
          blend: blendState(porterDuff),
          writeMask: 0xf,
        }],
      },
      primitive: { topology: "triangle-list" },
    });
    this.#pipelines = Object.freeze({
      "source-over": makePipeline("source-over"),
      "destination-out": makePipeline("destination-out"),
    });
    void this.#device.lost.then((info) => {
      if (this.#disposed) return;
      this.#deviceEpoch += 1;
      this.#lost = true;
      this.#privateContentInitialized = false;
      this.#privateContentFingerprint = null;
      options.onDeviceLost?.(info);
    });
  }

  public get deviceEpoch(): number {
    return this.#deviceEpoch;
  }

  public get inFlight(): number {
    return this.#inFlight;
  }

  async #acquireSubmissionSlot(): Promise<() => void> {
    const previous = this.#submissionTail;
    let release!: () => void;
    this.#submissionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    return release;
  }

  #ensureInstanceBuffer(dabCount: number): GPUBuffer {
    if (this.#instanceBuffer && this.#instanceCapacity >= dabCount) return this.#instanceBuffer;
    this.#instanceBuffer?.destroy();
    let capacity = Math.min(256, this.#maximumDabs);
    while (capacity < dabCount) capacity = Math.min(this.#maximumDabs, capacity * 2);
    this.#instanceBuffer = this.#device.createBuffer({
      label: "Studio textured brush instance buffer",
      size: Math.max(
        STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_INSTANCE_BYTES,
        capacity * STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_INSTANCE_BYTES,
      ),
      usage: GPU_BUFFER_VERTEX | GPU_BUFFER_COPY_DST,
    });
    this.#instanceCapacity = capacity;
    return this.#instanceBuffer;
  }

  #ensureInstanceScratch(dabCount: number): Float32Array {
    const requiredFloats =
      dabCount * STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_INSTANCE_FLOATS;
    if (
      this.#instanceScratch
      && this.#instanceScratch.length >= requiredFloats
    ) return this.#instanceScratch;
    let capacity = Math.min(256, this.#maximumDabs);
    while (capacity < dabCount) capacity = Math.min(this.#maximumDabs, capacity * 2);
    this.#instanceScratch = new Float32Array(
      capacity * STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_INSTANCE_FLOATS,
    );
    return this.#instanceScratch;
  }

  #touchAssetTexture(key: string, resource: AssetTexture): AssetTexture {
    this.#assetTextures.delete(key);
    this.#assetTextures.set(key, resource);
    return resource;
  }

  #dropBindGroupsReferencingAsset(assetKey: string): void {
    for (const [key, cached] of this.#bindGroups) {
      if (cached.assetKeys.includes(assetKey)) this.#bindGroups.delete(key);
    }
  }

  #reserveGenericAssetResidency(
    requiredAdditionalBytes: number,
    protectedKeys: ReadonlySet<string>,
  ): boolean {
    if (
      !Number.isSafeInteger(requiredAdditionalBytes)
      || requiredAdditionalBytes < 0
      || requiredAdditionalBytes > this.#maximumResidentAssetBytes
    ) return false;
    const fits = () => (
      this.#residentAssetBytes + requiredAdditionalBytes
      <= this.#maximumResidentAssetBytes
    );
    if (fits()) return true;
    /*
     * Bind groups capture texture views. Reclaim generic textures only while no execution can
     * still reference them; sequential long-session brush switches can then make progress without
     * invalidating submitted or queued GPU work.
     */
    if (this.#inFlight !== 0) return false;
    for (const [key, resource] of this.#assetTextures) {
      if (resource.role === "dummy-grain" || protectedKeys.has(key)) continue;
      this.#assetTextures.delete(key);
      this.#dropBindGroupsReferencingAsset(key);
      try {
        resource.texture.destroy();
      } catch {
        // Device loss may retire a resource concurrently; logical residency is still released.
      }
      this.#residentAssetBytes = Math.max(
        0,
        this.#residentAssetBytes - resource.byteLength,
      );
      if (fits()) return true;
    }
    return fits();
  }

  #uploadAsset(
    asset: StudioEngineWebGpuTexturedBrushResolvedAsset,
    role: "tip" | "grain",
  ): AssetTexture {
    const key = assetTextureIdentity(asset, role);
    const cached = this.#assetTextures.get(key);
    if (cached) return this.#touchAssetTexture(key, cached);
    if (this.#residentAssetBytes + asset.byteLength > this.#maximumResidentAssetBytes) {
      throw new RangeError("resident-asset-budget");
    }
    const upload = paddedUpload(asset, role === "tip");
    const texture = this.#device.createTexture({
      label: `Studio textured brush ${role} ${asset.contentHash}`,
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
    const resource: AssetTexture = {
      key,
      role,
      byteLength: asset.byteLength,
      texture,
      view: texture.createView(),
      width: upload.width,
      height: upload.height,
    };
    this.#assetTextures.set(key, resource);
    this.#residentAssetBytes += asset.byteLength;
    return resource;
  }

  #dummyGrainTexture(): AssetTexture {
    const cached = this.#assetTextures.get("dummy-grain");
    if (cached) return cached;
    const texture = this.#device.createTexture({
      label: "Studio textured brush dummy white grain",
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
    const resource: AssetTexture = {
      key: "dummy-grain",
      role: "dummy-grain",
      byteLength: 0,
      texture,
      view: texture.createView(),
      width: 1,
      height: 1,
    };
    this.#assetTextures.set(resource.key, resource);
    return resource;
  }

  #bindGroup(
    plan: StudioEngineWebGpuTexturedBrushPlan,
    batch: StudioEngineWebGpuTexturedBrushBatch,
    nativeR8Grain?: Readonly<StudioWebGpuR8GrainTextureLease>,
  ): GPUBindGroup {
    const tip = this.#uploadAsset(plan.assets[batch.tipAssetIndex]!, "tip");
    const grain = nativeR8Grain
      ? null
      : batch.grainAssetIndex === null
      ? this.#dummyGrainTexture()
      : this.#uploadAsset(plan.assets[batch.grainAssetIndex]!, "grain");
    const grainKey = nativeR8Grain
      ? `durable-r8:${nativeR8Grain.sourceKey}`
      : grain!.key;
    // Bind groups depend only on captured GPU resources. A plan-local diagnostic batch key or
    // Porter-Duff pipeline change must not duplicate an otherwise identical texture binding.
    const key = `${tip.key}|${grainKey}`;
    // A durable lease can be released and its LRU texture evicted immediately after the queue
    // fence. Never retain a bind group that could outlive that texture. Generic runtime-owned
    // textures share this runtime's lifetime and remain safe to cache.
    if (!nativeR8Grain) {
      const cached = this.#bindGroups.get(key);
      if (cached) return cached.bindGroup;
    }
    const bindGroup = this.#device.createBindGroup({
      label: `Studio textured brush batch ${batch.key}`,
      layout: this.#bindGroupLayout,
      entries: [
        { binding: 0, resource: tip.view },
        { binding: 1, resource: nativeR8Grain?.view ?? grain!.view },
        { binding: 2, resource: this.#tipSampler },
        { binding: 3, resource: nativeR8Grain?.sampler ?? this.#grainSampler },
        { binding: 4, resource: { buffer: this.#uniformBuffer } },
      ],
    });
    if (!nativeR8Grain) {
      this.#bindGroups.set(key, {
        bindGroup,
        assetKeys: [tip.key, grain!.key],
      });
    }
    return bindGroup;
  }

  public async execute(
    frame: StudioEngineWebGpuTexturedBrushFrame,
    signal?: AbortSignal,
  ): Promise<StudioEngineWebGpuTexturedBrushExecutionResult> {
    if (this.#disposed) return Object.freeze({ status: "disposed" });
    if (this.#lost) {
      return Object.freeze({ status: "device-lost", deviceEpoch: this.#deviceEpoch });
    }
    if (this.#failed) {
      return Object.freeze({ status: "failed", reason: "gpu-error" });
    }
    if (signal?.aborted) return Object.freeze({ status: "cancelled" });
    if (
      !frame
      || !positiveSafeInteger(frame.requestSequence)
      || !positiveSafeInteger(frame.deviceEpoch)
      || !planIsValid(frame.plan, this.#maximumDabs)
    ) return Object.freeze({ status: "rejected", reason: "invalid-frame" });
    const sourceFrameFingerprint = semanticFingerprint(frame.plan);
    if (!sourceFrameFingerprint) {
      return Object.freeze({ status: "rejected", reason: "invalid-frame" });
    }
    if (frame.deviceEpoch !== this.#deviceEpoch) {
      return Object.freeze({ status: "rejected", reason: "device-epoch" });
    }
    if (this.#presentationOnly && !frame.presentationLease) {
      return Object.freeze({
        status: "rejected",
        reason: "presentation-lease-required",
      });
    }
    if (
      frame.presentationLease
      && !validPresentationLease(
        frame.presentationLease,
        frame,
        sourceFrameFingerprint,
      )
    ) {
      return Object.freeze({
        status: "rejected",
        reason: "presentation-lease-invalid",
      });
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
    if (frame.plan.dabs.length > this.#maximumDabs) {
      return Object.freeze({ status: "rejected", reason: "request-limit" });
    }
    const nativeR8GrainInput = durableR8InputForPlan(frame.plan);
    const nativeR8AssetIndex = nativeR8GrainInput
      && frame.plan.grain?.kind === "asset-r8-repeat"
      ? frame.plan.grain.assetIndex
      : null;
    const protectedGenericAssetKeys = new Set<string>();
    const uncachedGenericAssets = new Map<string, number>();
    for (const asset of frame.plan.assets) {
      // A durable R8 asset is resident in the strict native cache, never duplicated in the
      // generic textured-asset cache.
      if (asset.assetIndex === nativeR8AssetIndex) continue;
      const key = assetTextureIdentity(asset, asset.role);
      protectedGenericAssetKeys.add(key);
      if (!this.#assetTextures.has(key) && !uncachedGenericAssets.has(key)) {
        uncachedGenericAssets.set(key, asset.byteLength);
      }
    }
    const uncachedBytes = Array.from(uncachedGenericAssets.values()).reduce(
      (total, byteLength) => total + byteLength,
      0,
    );
    if (!this.#reserveGenericAssetResidency(
      uncachedBytes,
      protectedGenericAssetKeys,
    )) {
      return Object.freeze({ status: "rejected", reason: "resident-asset-budget" });
    }
    const nativeResidentBudget = Math.max(
      0,
      this.#maximumResidentAssetBytes
        - this.#residentAssetBytes
        - uncachedBytes,
    );

    let nativeR8GrainLease: Readonly<StudioWebGpuR8GrainTextureLease> | null = null;
    if (nativeR8GrainInput) {
      const acquired = this.#nativeR8GrainTextureCache.acquire(
        nativeR8GrainInput,
        { maxResidentBytes: nativeResidentBudget },
      );
      if (acquired.status !== "ready") {
        return Object.freeze({
          status: "rejected",
          reason: "native-r8-grain-unavailable",
          detail: acquired.status === "rejected" ? acquired.reason : acquired.status,
        });
      }
      nativeR8GrainLease = acquired.lease;
    } else if (
      !this.#nativeR8GrainTextureCache.trimToResidentBytes(nativeResidentBudget)
    ) {
      return Object.freeze({ status: "rejected", reason: "resident-asset-budget" });
    }

    this.#inFlight += 1;
    this.#lastRequestSequence = frame.requestSequence;
    let errorScopeDepth = 0;
    const pendingScopes: Array<Promise<GPUError | null>> = [];
    let releaseSubmissionSlot: (() => void) | null = null;
    let producerClaim:
      StudioEngineWebGpuPresentationProducerWriteClaim | null = null;
    let producerClaimSettled = false;
    let privateWriteReserved = false;
    let privateWriteSettled = false;
    let baseContentGeneration: number | null;
    let baseContentFingerprint: `sha256:${string}` | null;
    let contentGeneration: number | null = null;
    let contentFingerprint: `sha256:${string}` | null;
    try {
      // WebGPU error scopes are device-global and LIFO. Serialize the push/submit/pop section even
      // when callers allow several queued executions, otherwise concurrent requests can consume
      // each other's validation result and certify the wrong work-surface generation.
      releaseSubmissionSlot = await this.#acquireSubmissionSlot();
      if (signal?.aborted) return Object.freeze({ status: "cancelled" });
      if (this.#disposed) return Object.freeze({ status: "disposed" });
      if (this.#lost) {
        return Object.freeze({ status: "device-lost", deviceEpoch: this.#deviceEpoch });
      }
      if (this.#failed) {
        return Object.freeze({ status: "failed", reason: "gpu-error" });
      }
      const presentationLease = frame.presentationLease;
      const targetView = presentationLease?.workSurface.view ?? this.#surfaceView;
      if (!targetView) {
        return Object.freeze({
          status: "rejected",
          reason: "presentation-lease-required",
        });
      }
      const targetWidth = presentationLease?.workSurface.width ?? this.#width;
      const targetHeight = presentationLease?.workSurface.height ?? this.#height;
      const documentToSurface = presentationLease
        ?.configuration.documentToSurface
        ?? IDENTITY_DOCUMENT_TO_SURFACE_TRANSFORM;
      if (presentationLease) {
        const acquired =
          acquireStudioEngineWebGpuPresentationProducerWrite(
            presentationLease,
            {
              mode: frame.plan.mode,
              sourceFrameFingerprint,
            },
          );
        if (acquired.status === "rejected") {
          return Object.freeze({
            status: "rejected",
            reason:
              acquired.reason === "content-uninitialized"
                ? "content-uninitialized"
                : acquired.reason === "content-generation-exhausted"
                  ? "content-generation-exhausted"
                  : "presentation-lease-invalid",
          });
        }
        producerClaim = acquired.claim;
        baseContentGeneration = producerClaim.baseContentGeneration;
        baseContentFingerprint = producerClaim.baseContentFingerprint;
        contentGeneration = producerClaim.contentGeneration;
        contentFingerprint = producerClaim.contentFingerprint;
      } else {
        if (
          frame.plan.mode === "append"
          && (
            !this.#privateContentInitialized
            || !this.#privateContentFingerprint
          )
        ) {
          return Object.freeze({
            status: "rejected",
            reason: "content-uninitialized",
          });
        }
        if (this.#privateContentGeneration === Number.MAX_SAFE_INTEGER) {
          return Object.freeze({
            status: "rejected",
            reason: "content-generation-exhausted",
          });
        }
        baseContentGeneration = this.#privateContentGeneration;
        baseContentFingerprint =
          frame.plan.mode === "append"
            ? this.#privateContentFingerprint
            : null;
        contentGeneration = this.#privateContentGeneration + 1;
        contentFingerprint =
          fingerprintStudioEngineWebGpuPresentationContent({
            mode: frame.plan.mode,
            baseContentFingerprint,
            sourceFrameFingerprint,
            width: targetWidth,
            height: targetHeight,
            documentToSurface,
          });
        if (!contentFingerprint) {
          return Object.freeze({ status: "rejected", reason: "invalid-frame" });
        }
        privateWriteReserved = true;
      }
      for (const filter of [
        "internal",
        "out-of-memory",
        "validation",
      ] as const satisfies readonly GPUErrorFilter[]) {
        this.#device.pushErrorScope(filter);
        errorScopeDepth += 1;
      }
      this.#device.queue.writeBuffer(
        this.#uniformBuffer,
        0,
        packStudioEngineWebGpuTexturedBrushViewportUniform(
          targetWidth,
          targetHeight,
          documentToSurface,
        ),
      );
      const instanceBuffer = this.#ensureInstanceBuffer(frame.plan.dabs.length);
      const packed = packStudioEngineWebGpuTexturedBrushDabs(
        frame.plan,
        this.#ensureInstanceScratch(frame.plan.dabs.length),
        nativeR8GrainLease ?? undefined,
      );
      this.#device.queue.writeBuffer(instanceBuffer, 0, packed);
      const encoder = this.#device.createCommandEncoder({
        label: `Studio textured brush request ${frame.requestSequence}`,
      });
      const pass = encoder.beginRenderPass({
        label: `Studio textured brush ${frame.plan.mode}`,
        colorAttachments: [{
          view: targetView,
          loadOp: frame.plan.mode === "rebuild" ? "clear" : "load",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      pass.setVertexBuffer(0, instanceBuffer);
      for (const batch of frame.plan.batches) {
        pass.setPipeline(this.#pipelines[batch.porterDuff]);
        pass.setBindGroup(
          0,
          this.#bindGroup(frame.plan, batch, nativeR8GrainLease ?? undefined),
        );
        pass.draw(6, batch.instanceCount, 0, batch.firstInstance);
      }
      pass.end();
      this.#device.queue.submit([encoder.finish()]);
      const queueCompletion = this.#device.queue.onSubmittedWorkDone();
      while (errorScopeDepth > 0) {
        pendingScopes.push(this.#device.popErrorScope());
        errorScopeDepth -= 1;
      }
      const [, scopedErrors] = await Promise.all([
        queueCompletion,
        Promise.all(pendingScopes),
      ]);
      if (this.#disposed) return Object.freeze({ status: "disposed" });
      if (this.#lost) {
        return Object.freeze({ status: "device-lost", deviceEpoch: this.#deviceEpoch });
      }
      if (scopedErrors.some((error) => error !== null)) {
        // A scoped validation/OOM/internal failure means the shared target cannot be certified.
        // Retire the runtime so partially-mutated GPU state can never yield a later receipt.
        this.#failed = true;
        return Object.freeze({ status: "failed", reason: "gpu-error" });
      }
      if (producerClaim) {
        const settled =
          settleStudioEngineWebGpuPresentationProducerWrite(
            producerClaim,
            "completed",
          );
        producerClaimSettled = true;
        if (settled.status !== "completed") {
          return Object.freeze({
            status: "rejected",
            reason: "presentation-lease-invalid",
          });
        }
        baseContentGeneration = producerClaim.baseContentGeneration;
        baseContentFingerprint = producerClaim.baseContentFingerprint;
        contentGeneration = settled.content.generation;
        contentFingerprint = settled.content.fingerprint;
      } else {
        this.#privateContentGeneration = contentGeneration!;
        this.#privateContentInitialized = true;
        this.#privateContentFingerprint = contentFingerprint;
        privateWriteSettled = true;
      }
      const receipt: StudioEngineWebGpuTexturedBrushReceipt = {
        kind: "studio-engine-webgpu-textured-brush-receipt",
        revision: STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_RUNTIME_REVISION,
        backend: "webgpu",
        textureFormat: STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_TEXTURE_FORMAT,
        colorModel: "scene-linear-premultiplied",
        requestSequence: frame.requestSequence,
        deviceEpoch: this.#deviceEpoch,
        mode: frame.plan.mode,
        strokeId: frame.plan.strokeId,
        commandSequence: frame.plan.commandSequence,
        dabCount: frame.plan.dabs.length,
        batchCount: frame.plan.batches.length,
        assetCount: frame.plan.assets.length,
        assetBytes: frame.plan.assets.reduce((total, asset) => total + asset.byteLength, 0),
        batchKeys: frame.plan.batches.map((batch) => batch.key),
        planSemanticFingerprint: frame.plan.semanticFingerprint ?? null,
        grainSamplingSemantics: frame.plan.grainSamplingSemantics
          ?? "specialist-texture-v1",
        nativeR8GrainSourceKey: nativeR8GrainLease?.sourceKey ?? null,
        nativeR8GrainTextureBytes: nativeR8GrainLease
          ? nativeR8GrainLease.width * nativeR8GrainLease.height
          : 0,
        renderTarget: presentationLease ? "presentation" : "private",
        sourceFrameFingerprint,
        workSurfaceEpoch:
          presentationLease?.workSurface.workSurfaceEpoch ?? null,
        baseContentGeneration,
        baseContentFingerprint,
        contentGeneration,
        contentFingerprint,
        queueState: "completed",
        complete: true,
      };
      return Object.freeze({ status: "completed", receipt: Object.freeze(receipt) });
    } catch (error) {
      while (errorScopeDepth > 0) {
        try {
          pendingScopes.push(this.#device.popErrorScope());
        } catch {
          // This execution fails closed below; an already-collapsed scope stack is harmless.
        }
        errorScopeDepth -= 1;
      }
      if (pendingScopes.length > 0) await Promise.allSettled(pendingScopes);
      if (error instanceof RangeError && error.message === "resident-asset-budget") {
        return Object.freeze({ status: "rejected", reason: "resident-asset-budget" });
      }
      this.#failed = true;
      return Object.freeze({ status: "failed", reason: "gpu-error" });
    } finally {
      if (producerClaim && !producerClaimSettled) {
        settleStudioEngineWebGpuPresentationProducerWrite(
          producerClaim,
          "failed",
        );
      }
      if (privateWriteReserved && !privateWriteSettled) {
        this.#privateContentGeneration = Math.max(
          this.#privateContentGeneration,
          contentGeneration ?? this.#privateContentGeneration,
        );
        this.#privateContentInitialized = false;
        this.#privateContentFingerprint = null;
      }
      releaseSubmissionSlot?.();
      nativeR8GrainLease?.release();
      this.#inFlight -= 1;
    }
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#privateContentInitialized = false;
    this.#privateContentFingerprint = null;
    this.#instanceBuffer?.destroy();
    this.#instanceScratch = null;
    this.#uniformBuffer.destroy();
    this.#surfaceTexture?.destroy();
    for (const resource of this.#assetTextures.values()) resource.texture.destroy();
    this.#assetTextures.clear();
    this.#bindGroups.clear();
    if (this.#ownsNativeR8GrainTextureCache) this.#nativeR8GrainTextureCache.dispose();
    if (this.#ownsDevice) this.#device.destroy();
  }
}
