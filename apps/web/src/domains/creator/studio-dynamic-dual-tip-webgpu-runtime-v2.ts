import {
  STUDIO_DUAL_TIP_PACKED_LAYOUT,
  STUDIO_DUAL_TIP_PACKED_STRIDE,
} from "./studio-dual-brush-tip-engine";
import { sha256HexPortable } from "./studio-sha256";

import type {
  StudioDualTipExactBlendFamily,
  StudioDualTipExactPorterDuff,
  StudioDualTipPackedCommands,
} from "./studio-dual-brush-tip-engine";
import type {
  StudioDynamicDualTipBlendFamily,
} from "./studio-dynamic-dual-tip-plan";

/**
 * Exact dynamic dual-tip WebGPU contract.
 *
 * Unlike the legacy aggregate-mask preview, every record is one logical deposition containing
 * both transformed tips, resolved paint alpha/color, blend family and Porter-Duff operation. The
 * fragment shader samples and combines both tips before hardware blending writes the authority.
 */
export const STUDIO_DYNAMIC_DUAL_TIP_EXACT_PLAN_VERSION = 2 as const;
export const STUDIO_DYNAMIC_DUAL_TIP_EXACT_WEBGPU_RUNTIME_REVISION = 2 as const;
export const STUDIO_DYNAMIC_DUAL_TIP_EXACT_WEBGPU_INSTANCE_FLOATS = 28 as const;
export const STUDIO_DYNAMIC_DUAL_TIP_EXACT_WEBGPU_INSTANCE_BYTES =
  STUDIO_DYNAMIC_DUAL_TIP_EXACT_WEBGPU_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
export const STUDIO_DYNAMIC_DUAL_TIP_EXACT_WEBGPU_TEXTURE_FORMAT = "rgba16float" as const;
export const STUDIO_DYNAMIC_DUAL_TIP_EXACT_PROVIDER_CAPABILITY =
  "dynamic-dual-tip-deposition-r8-v2" as const;
export const STUDIO_DYNAMIC_DUAL_TIP_EXACT_EXECUTION_ROUTE =
  "webgpu-exact-packed-deposition-v2" as const;

const GPU_TEXTURE_COPY_SRC = 0x01;
const GPU_TEXTURE_COPY_DST = 0x02;
const GPU_TEXTURE_BINDING = 0x04;
const GPU_TEXTURE_RENDER_ATTACHMENT = 0x10;
const GPU_BUFFER_COPY_DST = 0x08;
const GPU_BUFFER_UNIFORM = 0x40;
const GPU_BUFFER_STORAGE = 0x80;
const ROW_ALIGNMENT = 256;
const MAX_ASSET_EDGE = 8_192;
const MAX_DEPOSITIONS = 65_536;
const MAX_COORDINATE_ABSOLUTE = 16_777_216;
const MAX_IDENTIFIER_CHARACTERS = 256;
const DEFAULT_RESIDENT_ASSET_BYTES = 64 * 1024 * 1024;
const MAX_RGBA16F_VALUE = 65_504;

const EXACT_BLEND_FAMILIES: readonly StudioDualTipExactBlendFamily[] = Object.freeze([
  "intersect",
  "darken",
  "lighten",
  "multiply",
  "screen",
  "add",
  "subtract",
  "difference",
  "soft-intersect",
]);

const DYNAMIC_BLEND_FAMILIES: readonly StudioDynamicDualTipBlendFamily[] = Object.freeze([
  "intersect",
  "darken",
  "lighten",
  "multiply",
  "screen",
  "add",
  "subtract",
  "difference",
]);

const BLEND_FAMILY_CODE: Readonly<Record<StudioDualTipExactBlendFamily, number>> =
  Object.freeze({
    intersect: 0,
    darken: 1,
    lighten: 2,
    multiply: 3,
    screen: 4,
    add: 5,
    subtract: 6,
    difference: 7,
    "soft-intersect": 8,
  });

const LEGACY_PACKED_BLEND_FAMILY: readonly StudioDualTipExactBlendFamily[] = Object.freeze([
  "multiply",
  "darken",
  "lighten",
  "add",
  "subtract",
  "soft-intersect",
]);

const EXACT_DEPOSITION_SHADER = /* wgsl */ `
struct RuntimeUniforms {
  viewport: vec4f,
  tip_sizes: vec4f,
};

struct Deposition {
  bounds: vec4f,
  primary_center_mask: vec4f,
  primary_inverse: vec4f,
  secondary_center_mask: vec4f,
  secondary_inverse: vec4f,
  straight_color_paint_alpha: vec4f,
  controls: vec4f,
};

@group(0) @binding(0) var primary_tip: texture_2d<f32>;
@group(0) @binding(1) var secondary_tip: texture_2d<f32>;
@group(0) @binding(2) var zero_border_sampler: sampler;
@group(0) @binding(3) var<uniform> runtime: RuntimeUniforms;
@group(0) @binding(4) var<storage, read> depositions: array<Deposition>;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) document: vec2f,
  @location(1) @interpolate(flat) deposition_index: u32,
};

@vertex
fn vs_main(
  @builtin(vertex_index) vertex_index: u32,
  @builtin(instance_index) instance_index: u32,
) -> VertexOutput {
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f( 1.0, -1.0),
    vec2f(-1.0,  1.0),
    vec2f(-1.0,  1.0),
    vec2f( 1.0, -1.0),
    vec2f( 1.0,  1.0),
  );
  let deposition = depositions[instance_index];
  let document = deposition.bounds.xy + deposition.bounds.zw * corners[vertex_index];
  let clip = vec2f(
    document.x * runtime.viewport.z * 2.0 - 1.0,
    1.0 - document.y * runtime.viewport.w * 2.0,
  );
  var output: VertexOutput;
  output.position = vec4f(clip, 0.0, 1.0);
  output.document = document;
  output.deposition_index = instance_index;
  return output;
}

fn sample_primary(document: vec2f, deposition: Deposition) -> f32 {
  let delta = document - deposition.primary_center_mask.xy;
  let local = vec2f(
    dot(deposition.primary_inverse.xy, delta),
    dot(deposition.primary_inverse.zw, delta),
  );
  if (any(abs(local) > vec2f(1.0))) {
    return 0.0;
  }
  let uv = local * 0.5 + 0.5;
  let padded_uv = (uv * runtime.tip_sizes.xy + vec2f(1.0))
    / (runtime.tip_sizes.xy + vec2f(2.0));
  // The deposition index and footprint test are intentionally per-fragment non-uniform.
  // Explicit LOD avoids the derivative-uniformity restriction of textureSample in this branch.
  let raw = textureSampleLevel(primary_tip, zero_border_sampler, padded_uv, 0.0).r;
  let hardness = deposition.primary_center_mask.w;
  let transferred = select(
    raw,
    smoothstep(0.0, max(1.0 / 65535.0, 1.0 - hardness), raw),
    hardness >= 0.0,
  );
  return clamp(transferred * deposition.primary_center_mask.z, 0.0, 1.0);
}

fn sample_secondary(document: vec2f, deposition: Deposition) -> f32 {
  let delta = document - deposition.secondary_center_mask.xy;
  let local = vec2f(
    dot(deposition.secondary_inverse.xy, delta),
    dot(deposition.secondary_inverse.zw, delta),
  );
  if (any(abs(local) > vec2f(1.0))) {
    return 0.0;
  }
  let uv = local * 0.5 + 0.5;
  let padded_uv = (uv * runtime.tip_sizes.zw + vec2f(1.0))
    / (runtime.tip_sizes.zw + vec2f(2.0));
  let raw = textureSampleLevel(secondary_tip, zero_border_sampler, padded_uv, 0.0).r;
  let hardness = deposition.secondary_center_mask.w;
  let transferred = select(
    raw,
    smoothstep(0.0, max(1.0 / 65535.0, 1.0 - hardness), raw),
    hardness >= 0.0,
  );
  return clamp(transferred * deposition.secondary_center_mask.z, 0.0, 1.0);
}

fn combine_same_deposition(primary: f32, secondary: f32, family: u32) -> f32 {
  switch family {
    case 0u: { return primary * secondary; }
    case 1u: { return min(primary, secondary); }
    case 2u: { return max(primary, secondary); }
    case 3u: { return primary * secondary; }
    case 4u: { return 1.0 - (1.0 - primary) * (1.0 - secondary); }
    case 5u: { return min(1.0, primary + secondary); }
    case 6u: { return max(0.0, primary - secondary); }
    case 7u: { return abs(primary - secondary); }
    default: { return max(0.0, primary + secondary - 1.0); }
  }
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  let deposition = depositions[input.deposition_index];
  let primary_coverage = sample_primary(input.document, deposition);
  let secondary_coverage = sample_secondary(input.document, deposition);
  let combined_coverage = clamp(
    combine_same_deposition(
      primary_coverage,
      secondary_coverage,
      u32(deposition.controls.x + 0.5),
    ),
    0.0,
    1.0,
  );
  let source_alpha = combined_coverage
    * clamp(deposition.straight_color_paint_alpha.a, 0.0, 1.0);
  return vec4f(
    deposition.straight_color_paint_alpha.rgb * source_alpha,
    source_alpha,
  );
}
`;

export interface StudioDynamicDualTipExactR8AssetInputV2 {
  readonly assetId: string;
  readonly width: number;
  readonly height: number;
  readonly channel: "alpha" | "luminance";
  readonly bytes: Uint8Array;
}

export interface StudioDynamicDualTipExactR8AssetV2
  extends StudioDynamicDualTipExactR8AssetInputV2 {
  readonly contentHash: `sha256:${string}`;
  readonly byteLength: number;
}

export interface StudioDynamicDualTipExactAffineTipV2 {
  readonly center: readonly [x: number, y: number];
  /**
   * Column-major half-extent basis: document = center + columnX * local.x
   * + columnY * local.y, where local is in [-1, 1].
   */
  readonly localToDocument: readonly [xx: number, xy: number, yx: number, yy: number];
  readonly maskOpacity: number;
  /** -1 means a linear R8 coverage transfer; [0, 1] enables smooth hardness transfer. */
  readonly hardness: number;
}

export interface StudioDynamicDualTipExactDepositionInputV2 {
  readonly primary: StudioDynamicDualTipExactAffineTipV2;
  readonly secondary: StudioDynamicDualTipExactAffineTipV2;
  readonly paintAlpha: number;
  readonly linearColor: readonly [red: number, green: number, blue: number];
  readonly blendFamily: StudioDualTipExactBlendFamily;
  readonly porterDuff: StudioDualTipExactPorterDuff;
}

export interface StudioDynamicDualTipExactDepositionV2
  extends StudioDynamicDualTipExactDepositionInputV2 {
  readonly index: number;
  readonly bounds: readonly [
    centerX: number,
    centerY: number,
    halfWidth: number,
    halfHeight: number,
  ];
}

export interface StudioDynamicDualTipExactPlanV2 {
  readonly kind: "studio-dynamic-dual-tip-exact-plan";
  readonly version: typeof STUDIO_DYNAMIC_DUAL_TIP_EXACT_PLAN_VERSION;
  readonly providerCapability: typeof STUDIO_DYNAMIC_DUAL_TIP_EXACT_PROVIDER_CAPABILITY;
  readonly executionRoute: typeof STUDIO_DYNAMIC_DUAL_TIP_EXACT_EXECUTION_ROUTE;
  readonly compositionOrder: "combine-same-deposition-then-premultiplied-authority";
  readonly mode: "append" | "rebuild";
  readonly strokeId: string;
  readonly commandSequence: number;
  readonly primaryAsset: StudioDynamicDualTipExactR8AssetV2;
  readonly secondaryAsset: StudioDynamicDualTipExactR8AssetV2;
  readonly depositions: readonly StudioDynamicDualTipExactDepositionV2[];
  readonly fingerprint: `sha256:${string}`;
}

export interface StudioDynamicDualTipExactPlanInputV2 {
  readonly mode: "append" | "rebuild";
  readonly strokeId: string;
  readonly commandSequence: number;
  readonly primaryAsset: StudioDynamicDualTipExactR8AssetInputV2;
  readonly secondaryAsset: StudioDynamicDualTipExactR8AssetInputV2;
  readonly depositions: readonly StudioDynamicDualTipExactDepositionInputV2[];
}

export interface StudioDynamicDualTipExactPackedPlanInputV2 {
  readonly mode: "append" | "rebuild";
  readonly strokeId: string;
  readonly commandSequence: number;
  readonly primaryAsset: StudioDynamicDualTipExactR8AssetInputV2;
  readonly secondaryAsset: StudioDynamicDualTipExactR8AssetInputV2;
  readonly commands: StudioDualTipPackedCommands;
  readonly porterDuff?:
    | StudioDualTipExactPorterDuff
    | readonly StudioDualTipExactPorterDuff[];
}

export type StudioDynamicDualTipExactPlanResultV2 =
  | Readonly<{ status: "ready"; plan: StudioDynamicDualTipExactPlanV2 }>
  | Readonly<{
      status: "rejected";
      reason:
        | "invalid-plan"
        | "invalid-asset"
        | "invalid-deposition"
        | "deposition-budget";
      path?: string;
    }>;

export interface StudioDynamicDualTipExactWebGpuRuntimeOptionsV2 {
  readonly device: GPUDevice;
  readonly width: number;
  readonly height: number;
  readonly initialDeviceEpoch?: number;
  readonly maximumDepositions?: number;
  readonly maximumInFlightSubmissions?: number;
  readonly maximumResidentAssetBytes?: number;
  readonly ownsDevice?: boolean;
  readonly onDeviceLost?: (info: GPUDeviceLostInfo) => void;
}

export interface StudioDynamicDualTipExactWebGpuFrameV2 {
  readonly requestSequence: number;
  readonly deviceEpoch: number;
  readonly plan: StudioDynamicDualTipExactPlanV2;
}

export interface StudioDynamicDualTipExactWebGpuReceiptV2 {
  readonly kind: "studio-dynamic-dual-tip-exact-webgpu-receipt";
  readonly revision: typeof STUDIO_DYNAMIC_DUAL_TIP_EXACT_WEBGPU_RUNTIME_REVISION;
  readonly backend: "webgpu";
  readonly providerCapability: typeof STUDIO_DYNAMIC_DUAL_TIP_EXACT_PROVIDER_CAPABILITY;
  readonly executionRoute: typeof STUDIO_DYNAMIC_DUAL_TIP_EXACT_EXECUTION_ROUTE;
  readonly textureFormat: typeof STUDIO_DYNAMIC_DUAL_TIP_EXACT_WEBGPU_TEXTURE_FORMAT;
  readonly colorModel: "scene-linear-premultiplied";
  readonly compositionOrder: "combine-same-deposition-then-premultiplied-authority";
  readonly numericalAuthority: "ordered-rgba16float-webgpu";
  readonly exactness: "algorithmically-exact-deposition-order";
  readonly requestSequence: number;
  readonly deviceEpoch: number;
  readonly mode: "append" | "rebuild";
  readonly strokeId: string;
  readonly commandSequence: number;
  readonly depositionCount: number;
  readonly blendFamilies: readonly StudioDualTipExactBlendFamily[];
  readonly porterDuffOperations: readonly StudioDualTipExactPorterDuff[];
  readonly assetBytes: number;
  readonly planFingerprint: `sha256:${string}`;
  readonly queueState: "completed";
  readonly complete: true;
}

export type StudioDynamicDualTipExactWebGpuExecutionResultV2 =
  | Readonly<{
      status: "completed";
      receipt: StudioDynamicDualTipExactWebGpuReceiptV2;
    }>
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

export type StudioDynamicDualTipExactWebGpuRuntimeCreationResultV2 =
  | Readonly<{ status: "ready"; runtime: StudioDynamicDualTipExactWebGpuRuntimeV2 }>
  | Readonly<{ status: "rejected"; reason: "invalid-options" | "initialization-failed" }>;

interface CachedAsset {
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

function f32(value: number): number {
  return Math.fround(value);
}

function nextAligned(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_IDENTIFIER_CHARACTERS;
}

function copyAsset(
  input: StudioDynamicDualTipExactR8AssetInputV2,
): StudioDynamicDualTipExactR8AssetV2 | null {
  if (
    !input
    || !validIdentifier(input.assetId)
    || !positiveSafeInteger(input.width)
    || !positiveSafeInteger(input.height)
    || input.width > MAX_ASSET_EDGE
    || input.height > MAX_ASSET_EDGE
    || (input.channel !== "alpha" && input.channel !== "luminance")
    || !(input.bytes instanceof Uint8Array)
    || input.bytes.byteLength !== input.width * input.height
  ) return null;
  const bytes = new Uint8Array(input.bytes);
  return Object.freeze({
    assetId: input.assetId,
    width: input.width,
    height: input.height,
    channel: input.channel,
    bytes,
    byteLength: bytes.byteLength,
    contentHash: `sha256:${sha256HexPortable(bytes)}`,
  });
}

function validAsset(asset: StudioDynamicDualTipExactR8AssetV2): boolean {
  try {
    return Boolean(
      asset
      && validIdentifier(asset.assetId)
      && positiveSafeInteger(asset.width)
      && positiveSafeInteger(asset.height)
      && asset.width <= MAX_ASSET_EDGE
      && asset.height <= MAX_ASSET_EDGE
      && (asset.channel === "alpha" || asset.channel === "luminance")
      && asset.bytes instanceof Uint8Array
      && asset.byteLength === asset.width * asset.height
      && asset.byteLength === asset.bytes.byteLength
      && asset.contentHash === `sha256:${sha256HexPortable(asset.bytes)}`,
    );
  } catch {
    return false;
  }
}

function normalizeTip(
  input: StudioDynamicDualTipExactAffineTipV2,
): StudioDynamicDualTipExactAffineTipV2 | null {
  if (
    !input
    || !Array.isArray(input.center)
    || input.center.length !== 2
    || !Array.isArray(input.localToDocument)
    || input.localToDocument.length !== 4
    || ![
      ...input.center,
      ...input.localToDocument,
      input.maskOpacity,
      input.hardness,
    ].every(finite)
    || input.center.some((value) => Math.abs(value) > MAX_COORDINATE_ABSOLUTE)
    || input.localToDocument.some(
      (value) => Math.abs(value) > MAX_COORDINATE_ABSOLUTE,
    )
    || input.maskOpacity < 0
    || input.maskOpacity > 1
    || input.hardness < -1
    || input.hardness > 1
  ) return null;
  const center = Object.freeze([
    f32(input.center[0]),
    f32(input.center[1]),
  ] as const);
  const basis = Object.freeze(input.localToDocument.map(f32) as unknown as [
    number,
    number,
    number,
    number,
  ]);
  const determinant = f32(basis[0] * basis[3] - basis[1] * basis[2]);
  if (!finite(determinant) || determinant === 0) return null;
  return Object.freeze({
    center,
    localToDocument: basis,
    maskOpacity: f32(input.maskOpacity),
    hardness: f32(input.hardness),
  });
}

function depositionBounds(
  primary: StudioDynamicDualTipExactAffineTipV2,
  secondary: StudioDynamicDualTipExactAffineTipV2,
): StudioDynamicDualTipExactDepositionV2["bounds"] | null {
  const primaryHalfX = Math.abs(primary.localToDocument[0])
    + Math.abs(primary.localToDocument[2]);
  const primaryHalfY = Math.abs(primary.localToDocument[1])
    + Math.abs(primary.localToDocument[3]);
  const secondaryHalfX = Math.abs(secondary.localToDocument[0])
    + Math.abs(secondary.localToDocument[2]);
  const secondaryHalfY = Math.abs(secondary.localToDocument[1])
    + Math.abs(secondary.localToDocument[3]);
  const minimumX = Math.min(
    primary.center[0] - primaryHalfX,
    secondary.center[0] - secondaryHalfX,
  );
  const maximumX = Math.max(
    primary.center[0] + primaryHalfX,
    secondary.center[0] + secondaryHalfX,
  );
  const minimumY = Math.min(
    primary.center[1] - primaryHalfY,
    secondary.center[1] - secondaryHalfY,
  );
  const maximumY = Math.max(
    primary.center[1] + primaryHalfY,
    secondary.center[1] + secondaryHalfY,
  );
  const bounds = [
    f32((minimumX + maximumX) / 2),
    f32((minimumY + maximumY) / 2),
    f32((maximumX - minimumX) / 2),
    f32((maximumY - minimumY) / 2),
  ] as const;
  if (
    !bounds.every(finite)
    || bounds[2] <= 0
    || bounds[3] <= 0
    || bounds.some((value) => Math.abs(value) > MAX_COORDINATE_ABSOLUTE * 2)
  ) return null;
  return Object.freeze(bounds);
}

function normalizeDeposition(
  input: StudioDynamicDualTipExactDepositionInputV2,
  index: number,
): StudioDynamicDualTipExactDepositionV2 | null {
  const primary = normalizeTip(input?.primary);
  const secondary = normalizeTip(input?.secondary);
  if (
    !primary
    || !secondary
    || !finite(input.paintAlpha)
    || input.paintAlpha < 0
    || input.paintAlpha > 1
    || !Array.isArray(input.linearColor)
    || input.linearColor.length !== 3
    || !input.linearColor.every(finite)
    || input.linearColor.some((value) => value < 0 || value > MAX_RGBA16F_VALUE)
    || !EXACT_BLEND_FAMILIES.includes(input.blendFamily)
    || (input.porterDuff !== "source-over" && input.porterDuff !== "destination-out")
  ) return null;
  const bounds = depositionBounds(primary, secondary);
  if (!bounds) return null;
  return Object.freeze({
    index,
    primary,
    secondary,
    paintAlpha: f32(input.paintAlpha),
    linearColor: Object.freeze(input.linearColor.map(f32) as unknown as [
      number,
      number,
      number,
    ]),
    blendFamily: input.blendFamily,
    porterDuff: input.porterDuff,
    bounds,
  });
}

function depositionIdentity(deposition: StudioDynamicDualTipExactDepositionV2) {
  return [
    deposition.index,
    ...deposition.bounds,
    ...deposition.primary.center,
    ...deposition.primary.localToDocument,
    deposition.primary.maskOpacity,
    deposition.primary.hardness,
    ...deposition.secondary.center,
    ...deposition.secondary.localToDocument,
    deposition.secondary.maskOpacity,
    deposition.secondary.hardness,
    deposition.paintAlpha,
    ...deposition.linearColor,
    deposition.blendFamily,
    deposition.porterDuff,
  ];
}

export function fingerprintStudioDynamicDualTipExactPlanV2(
  plan: Omit<StudioDynamicDualTipExactPlanV2, "fingerprint">,
): `sha256:${string}` {
  const payload = JSON.stringify({
    contract: "studio-dynamic-dual-tip-exact-deposition-v2",
    mode: plan.mode,
    strokeId: plan.strokeId,
    commandSequence: plan.commandSequence,
    primary: [
      plan.primaryAsset.assetId,
      plan.primaryAsset.contentHash,
      plan.primaryAsset.width,
      plan.primaryAsset.height,
      plan.primaryAsset.channel,
      plan.primaryAsset.byteLength,
    ],
    secondary: [
      plan.secondaryAsset.assetId,
      plan.secondaryAsset.contentHash,
      plan.secondaryAsset.width,
      plan.secondaryAsset.height,
      plan.secondaryAsset.channel,
      plan.secondaryAsset.byteLength,
    ],
    depositions: plan.depositions.map(depositionIdentity),
  });
  return `sha256:${sha256HexPortable(new TextEncoder().encode(payload))}`;
}

export function buildStudioDynamicDualTipExactPlanV2(
  input: StudioDynamicDualTipExactPlanInputV2,
): StudioDynamicDualTipExactPlanResultV2 {
  if (
    !input
    || (input.mode !== "append" && input.mode !== "rebuild")
    || !validIdentifier(input.strokeId)
    || !positiveSafeInteger(input.commandSequence)
    || !Array.isArray(input.depositions)
    || input.depositions.length < 1
  ) return Object.freeze({ status: "rejected", reason: "invalid-plan" });
  if (input.depositions.length > MAX_DEPOSITIONS) {
    return Object.freeze({ status: "rejected", reason: "deposition-budget" });
  }
  const primaryAsset = copyAsset(input.primaryAsset);
  const secondaryAsset = copyAsset(input.secondaryAsset);
  if (!primaryAsset || !secondaryAsset) {
    return Object.freeze({ status: "rejected", reason: "invalid-asset" });
  }
  const depositions: StudioDynamicDualTipExactDepositionV2[] = [];
  for (let index = 0; index < input.depositions.length; index += 1) {
    const deposition = normalizeDeposition(input.depositions[index]!, index);
    if (!deposition) {
      return Object.freeze({
        status: "rejected",
        reason: "invalid-deposition",
        path: `depositions[${index}]`,
      });
    }
    depositions.push(deposition);
  }
  const withoutFingerprint = Object.freeze({
    kind: "studio-dynamic-dual-tip-exact-plan" as const,
    version: STUDIO_DYNAMIC_DUAL_TIP_EXACT_PLAN_VERSION,
    providerCapability: STUDIO_DYNAMIC_DUAL_TIP_EXACT_PROVIDER_CAPABILITY,
    executionRoute: STUDIO_DYNAMIC_DUAL_TIP_EXACT_EXECUTION_ROUTE,
    compositionOrder: "combine-same-deposition-then-premultiplied-authority" as const,
    mode: input.mode,
    strokeId: input.strokeId,
    commandSequence: input.commandSequence,
    primaryAsset,
    secondaryAsset,
    depositions: Object.freeze(depositions),
  });
  const plan: StudioDynamicDualTipExactPlanV2 = Object.freeze({
    ...withoutFingerprint,
    fingerprint: fingerprintStudioDynamicDualTipExactPlanV2(withoutFingerprint),
  });
  return Object.freeze({ status: "ready", plan });
}

function packedCommandsValid(commands: StudioDualTipPackedCommands): boolean {
  try {
    return Boolean(
      commands
      && commands.kind === "studio-dual-tip-packed-f32"
      && commands.layoutVersion === 1
      && commands.scalar === "float32"
      && commands.byteOrder === "little-endian"
      && commands.stride === STUDIO_DUAL_TIP_PACKED_STRIDE
      && commands.layout.length === STUDIO_DUAL_TIP_PACKED_LAYOUT.length
      && commands.layout.every(
        (field, index) => field === STUDIO_DUAL_TIP_PACKED_LAYOUT[index],
      )
      && positiveSafeInteger(commands.count)
      && commands.count <= MAX_DEPOSITIONS
      && Array.isArray(commands.values)
      && commands.values.length === commands.count * commands.stride
      && commands.values.every(finite),
    );
  } catch {
    return false;
  }
}

function affineBasis(
  diameter: number,
  rotation: number,
  scaleX: number,
  scaleY: number,
): readonly [number, number, number, number] {
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const halfX = diameter * scaleX * 0.5;
  const halfY = diameter * scaleY * 0.5;
  return [
    cosine * halfX,
    sine * halfX,
    -sine * halfY,
    cosine * halfY,
  ];
}

/**
 * Converts the existing authoritative CPU packed command stream into the explicit v2 deposition
 * stream. All stochastic choices, pressure/flow opacity and per-deposition colors are already
 * resolved by the CPU planner, so WebGPU only samples/composes them in the same order.
 */
export function buildStudioDynamicDualTipExactPlanV2FromPackedCommands(
  input: StudioDynamicDualTipExactPackedPlanInputV2,
): StudioDynamicDualTipExactPlanResultV2 {
  if (!input || !packedCommandsValid(input.commands)) {
    return Object.freeze({ status: "rejected", reason: "invalid-plan" });
  }
  const porterDuff = input.porterDuff ?? "source-over";
  if (
    Array.isArray(porterDuff)
    && porterDuff.length !== input.commands.count
  ) return Object.freeze({ status: "rejected", reason: "invalid-plan" });
  const depositions: StudioDynamicDualTipExactDepositionInputV2[] = [];
  for (let index = 0; index < input.commands.count; index += 1) {
    const offset = index * STUDIO_DUAL_TIP_PACKED_STRIDE;
    const value = (field: (typeof STUDIO_DUAL_TIP_PACKED_LAYOUT)[number]) => (
      input.commands.values[
        offset + STUDIO_DUAL_TIP_PACKED_LAYOUT.indexOf(field)
      ]!
    );
    const centerX = value("centerX");
    const centerY = value("centerY");
    const diameter = value("diameter");
    const primaryScaleX = value("primaryScaleX");
    const primaryScaleY = value("primaryScaleY");
    const secondaryScaleX = value("secondaryScaleX");
    const secondaryScaleY = value("secondaryScaleY");
    const familyCode = value("combineModeCode");
    if (
      !positiveSafeInteger(Math.round(diameter * 1_000_000))
      || diameter <= 0
      || primaryScaleX <= 0
      || primaryScaleY <= 0
      || secondaryScaleX <= 0
      || secondaryScaleY <= 0
      || !Number.isInteger(familyCode)
      || !LEGACY_PACKED_BLEND_FAMILY[familyCode]
    ) {
      return Object.freeze({
        status: "rejected",
        reason: "invalid-deposition",
        path: `commands[${index}]`,
      });
    }
    const operation = Array.isArray(porterDuff)
      ? porterDuff[index]
      : porterDuff;
    if (operation !== "source-over" && operation !== "destination-out") {
      return Object.freeze({
        status: "rejected",
        reason: "invalid-deposition",
        path: `commands[${index}].porterDuff`,
      });
    }
    depositions.push({
      primary: {
        center: [centerX, centerY],
        localToDocument: affineBasis(
          diameter,
          value("primaryRotationRadians"),
          primaryScaleX,
          primaryScaleY,
        ),
        maskOpacity: 1,
        hardness: -1,
      },
      secondary: {
        center: [
          centerX + value("secondaryOffsetX"),
          centerY + value("secondaryOffsetY"),
        ],
        localToDocument: affineBasis(
          diameter,
          value("secondaryRotationRadians"),
          secondaryScaleX,
          secondaryScaleY,
        ),
        maskOpacity: 1,
        hardness: -1,
      },
      paintAlpha: value("opacity"),
      linearColor: [
        value("linearRed"),
        value("linearGreen"),
        value("linearBlue"),
      ],
      blendFamily: LEGACY_PACKED_BLEND_FAMILY[familyCode]!,
      porterDuff: operation,
    });
  }
  return buildStudioDynamicDualTipExactPlanV2({
    mode: input.mode,
    strokeId: input.strokeId,
    commandSequence: input.commandSequence,
    primaryAsset: input.primaryAsset,
    secondaryAsset: input.secondaryAsset,
    depositions,
  });
}

function inverseBasis(
  basis: StudioDynamicDualTipExactAffineTipV2["localToDocument"],
): readonly [number, number, number, number] {
  const determinant = basis[0] * basis[3] - basis[1] * basis[2];
  return [
    f32(basis[3] / determinant),
    f32(-basis[2] / determinant),
    f32(-basis[1] / determinant),
    f32(basis[0] / determinant),
  ];
}

export function packStudioDynamicDualTipExactDepositionsV2(
  plan: StudioDynamicDualTipExactPlanV2,
  scratch?: Float32Array,
): Float32Array {
  const required = plan.depositions.length
    * STUDIO_DYNAMIC_DUAL_TIP_EXACT_WEBGPU_INSTANCE_FLOATS;
  const packed = scratch && scratch.length >= required
    ? scratch.subarray(0, required)
    : new Float32Array(required);
  for (const deposition of plan.depositions) {
    const offset = deposition.index * STUDIO_DYNAMIC_DUAL_TIP_EXACT_WEBGPU_INSTANCE_FLOATS;
    const primaryInverse = inverseBasis(deposition.primary.localToDocument);
    const secondaryInverse = inverseBasis(deposition.secondary.localToDocument);
    packed.set(deposition.bounds, offset);
    packed.set([
      deposition.primary.center[0],
      deposition.primary.center[1],
      deposition.primary.maskOpacity,
      deposition.primary.hardness,
    ], offset + 4);
    packed.set(primaryInverse, offset + 8);
    packed.set([
      deposition.secondary.center[0],
      deposition.secondary.center[1],
      deposition.secondary.maskOpacity,
      deposition.secondary.hardness,
    ], offset + 12);
    packed.set(secondaryInverse, offset + 16);
    packed.set([
      deposition.linearColor[0],
      deposition.linearColor[1],
      deposition.linearColor[2],
      deposition.paintAlpha,
    ], offset + 20);
    packed[offset + 24] = BLEND_FAMILY_CODE[deposition.blendFamily];
    packed[offset + 25] = deposition.porterDuff === "source-over" ? 0 : 1;
    packed[offset + 26] = 0;
    packed[offset + 27] = 0;
  }
  return packed;
}

function planValid(
  plan: StudioDynamicDualTipExactPlanV2,
  maximumDepositions: number,
): boolean {
  try {
    if (
      !plan
      || plan.kind !== "studio-dynamic-dual-tip-exact-plan"
      || plan.version !== STUDIO_DYNAMIC_DUAL_TIP_EXACT_PLAN_VERSION
      || plan.providerCapability !== STUDIO_DYNAMIC_DUAL_TIP_EXACT_PROVIDER_CAPABILITY
      || plan.executionRoute !== STUDIO_DYNAMIC_DUAL_TIP_EXACT_EXECUTION_ROUTE
      || plan.compositionOrder
        !== "combine-same-deposition-then-premultiplied-authority"
      || (plan.mode !== "append" && plan.mode !== "rebuild")
      || !validIdentifier(plan.strokeId)
      || !positiveSafeInteger(plan.commandSequence)
      || !validAsset(plan.primaryAsset)
      || !validAsset(plan.secondaryAsset)
      || !Array.isArray(plan.depositions)
      || plan.depositions.length < 1
      || plan.depositions.length > maximumDepositions
      || !/^sha256:[0-9a-f]{64}$/u.test(plan.fingerprint)
    ) return false;
    for (let index = 0; index < plan.depositions.length; index += 1) {
      const deposition = plan.depositions[index]!;
      const normalized = normalizeDeposition(deposition, index);
      if (
        !normalized
        || deposition.index !== index
        || JSON.stringify(depositionIdentity(normalized))
          !== JSON.stringify(depositionIdentity(deposition))
      ) return false;
    }
    const withoutFingerprint = {
      kind: plan.kind,
      version: plan.version,
      providerCapability: plan.providerCapability,
      executionRoute: plan.executionRoute,
      compositionOrder: plan.compositionOrder,
      mode: plan.mode,
      strokeId: plan.strokeId,
      commandSequence: plan.commandSequence,
      primaryAsset: plan.primaryAsset,
      secondaryAsset: plan.secondaryAsset,
      depositions: plan.depositions,
    } satisfies Omit<StudioDynamicDualTipExactPlanV2, "fingerprint">;
    return plan.fingerprint
      === fingerprintStudioDynamicDualTipExactPlanV2(withoutFingerprint);
  } catch {
    return false;
  }
}

function paddedUpload(asset: StudioDynamicDualTipExactR8AssetV2): Readonly<{
  bytes: Uint8Array;
  bytesPerRow: number;
  width: number;
  height: number;
}> {
  const width = asset.width + 2;
  const height = asset.height + 2;
  const bytesPerRow = nextAligned(width, ROW_ALIGNMENT);
  const bytes = new Uint8Array(bytesPerRow * height);
  for (let row = 0; row < asset.height; row += 1) {
    bytes.set(
      asset.bytes.subarray(row * asset.width, (row + 1) * asset.width),
      (row + 1) * bytesPerRow + 1,
    );
  }
  return Object.freeze({ bytes, bytesPerRow, width, height });
}

function assetKey(asset: StudioDynamicDualTipExactR8AssetV2): string {
  return [
    asset.contentHash,
    `${asset.width}x${asset.height}`,
    asset.channel,
  ].join(":");
}

function authorityBlend(porterDuff: StudioDualTipExactPorterDuff): GPUBlendState {
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

export function createStudioDynamicDualTipExactWebGpuRuntimeV2(
  options: StudioDynamicDualTipExactWebGpuRuntimeOptionsV2,
): StudioDynamicDualTipExactWebGpuRuntimeCreationResultV2 {
  try {
    if (
      !options
      || !options.device
      || !positiveSafeInteger(options.width)
      || !positiveSafeInteger(options.height)
      || options.width > MAX_ASSET_EDGE
      || options.height > MAX_ASSET_EDGE
    ) return Object.freeze({ status: "rejected", reason: "invalid-options" });
    return Object.freeze({
      status: "ready",
      runtime: new StudioDynamicDualTipExactWebGpuRuntimeV2(options),
    });
  } catch {
    return Object.freeze({ status: "rejected", reason: "initialization-failed" });
  }
}

export class StudioDynamicDualTipExactWebGpuRuntimeV2 {
  readonly #device: GPUDevice;
  readonly #width: number;
  readonly #height: number;
  #deviceEpoch: number;
  readonly #maximumDepositions: number;
  readonly #maximumInFlight: number;
  readonly #maximumResidentAssetBytes: number;
  readonly #ownsDevice: boolean;
  readonly #authorityTexture: GPUTexture;
  readonly #authorityView: GPUTextureView;
  readonly #uniformBuffer: GPUBuffer;
  readonly #sampler: GPUSampler;
  readonly #layout: GPUBindGroupLayout;
  readonly #pipelines: Readonly<Record<StudioDualTipExactPorterDuff, GPURenderPipeline>>;
  readonly #assetTextures = new Map<string, CachedAsset>();
  #depositionBuffer: GPUBuffer | null = null;
  #depositionCapacity = 0;
  #residentAssetBytes = 0;
  #inFlight = 0;
  #lastRequestSequence = 0;
  #initialized = false;
  #disposed = false;
  #lost = false;
  #failed = false;

  public constructor(options: StudioDynamicDualTipExactWebGpuRuntimeOptionsV2) {
    this.#device = options.device;
    this.#width = options.width;
    this.#height = options.height;
    this.#deviceEpoch = options.initialDeviceEpoch ?? 1;
    this.#maximumDepositions = options.maximumDepositions ?? MAX_DEPOSITIONS;
    this.#maximumInFlight = options.maximumInFlightSubmissions ?? 1;
    this.#maximumResidentAssetBytes = options.maximumResidentAssetBytes
      ?? DEFAULT_RESIDENT_ASSET_BYTES;
    this.#ownsDevice = options.ownsDevice ?? false;
    if (
      !positiveSafeInteger(this.#deviceEpoch)
      || this.#deviceEpoch >= Number.MAX_SAFE_INTEGER
      || !positiveSafeInteger(this.#maximumDepositions)
      || this.#maximumDepositions > MAX_DEPOSITIONS
      || this.#maximumInFlight !== 1
      || !positiveSafeInteger(this.#maximumResidentAssetBytes)
    ) throw new Error("invalid exact dual-tip runtime options");
    const storageLimit = Number(this.#device.limits?.maxStorageBufferBindingSize ?? Infinity);
    if (
      Number.isFinite(storageLimit)
      && this.#maximumDepositions
        * STUDIO_DYNAMIC_DUAL_TIP_EXACT_WEBGPU_INSTANCE_BYTES > storageLimit
    ) throw new Error("exact dual-tip storage limit");

    this.#authorityTexture = this.#device.createTexture({
      label: "Studio exact dual-tip v2 rgba16float authority",
      size: { width: this.#width, height: this.#height, depthOrArrayLayers: 1 },
      format: STUDIO_DYNAMIC_DUAL_TIP_EXACT_WEBGPU_TEXTURE_FORMAT,
      usage: GPU_TEXTURE_RENDER_ATTACHMENT | GPU_TEXTURE_COPY_SRC,
    });
    this.#authorityView = this.#authorityTexture.createView();
    this.#uniformBuffer = this.#device.createBuffer({
      label: "Studio exact dual-tip v2 runtime uniforms",
      size: 32,
      usage: GPU_BUFFER_UNIFORM | GPU_BUFFER_COPY_DST,
    });
    this.#sampler = this.#device.createSampler({
      label: "Studio exact dual-tip v2 zero-border bilinear sampler",
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "nearest",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    const module = this.#device.createShaderModule({
      label: "Studio exact dual-tip v2 same-deposition shader",
      code: EXACT_DEPOSITION_SHADER,
    });
    this.#layout = this.#device.createBindGroupLayout({
      label: "Studio exact dual-tip v2 bind layout",
      entries: [
        { binding: 0, visibility: 2, texture: { sampleType: "float" } },
        { binding: 1, visibility: 2, texture: { sampleType: "float" } },
        { binding: 2, visibility: 2, sampler: { type: "filtering" } },
        { binding: 3, visibility: 3, buffer: { type: "uniform" } },
        { binding: 4, visibility: 3, buffer: { type: "read-only-storage" } },
      ],
    });
    const pipelineLayout = this.#device.createPipelineLayout({
      label: "Studio exact dual-tip v2 pipeline layout",
      bindGroupLayouts: [this.#layout],
    });
    const makePipeline = (
      porterDuff: StudioDualTipExactPorterDuff,
    ): GPURenderPipeline => this.#device.createRenderPipeline({
      label: `Studio exact dual-tip v2 ${porterDuff} pipeline`,
      layout: pipelineLayout,
      vertex: { module, entryPoint: "vs_main" },
      fragment: {
        module,
        entryPoint: "fs_main",
        targets: [{
          format: STUDIO_DYNAMIC_DUAL_TIP_EXACT_WEBGPU_TEXTURE_FORMAT,
          blend: authorityBlend(porterDuff),
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
      options.onDeviceLost?.(info);
    });
  }

  public get deviceEpoch(): number {
    return this.#deviceEpoch;
  }

  public get inFlight(): number {
    return this.#inFlight;
  }

  #ensureDepositionBuffer(count: number): GPUBuffer {
    if (this.#depositionBuffer && this.#depositionCapacity >= count) {
      return this.#depositionBuffer;
    }
    this.#depositionBuffer?.destroy();
    let capacity = Math.min(256, this.#maximumDepositions);
    while (capacity < count) {
      capacity = Math.min(this.#maximumDepositions, capacity * 2);
    }
    this.#depositionBuffer = this.#device.createBuffer({
      label: "Studio exact dual-tip v2 deposition storage",
      size: Math.max(
        STUDIO_DYNAMIC_DUAL_TIP_EXACT_WEBGPU_INSTANCE_BYTES,
        capacity * STUDIO_DYNAMIC_DUAL_TIP_EXACT_WEBGPU_INSTANCE_BYTES,
      ),
      usage: GPU_BUFFER_STORAGE | GPU_BUFFER_COPY_DST,
    });
    this.#depositionCapacity = capacity;
    return this.#depositionBuffer;
  }

  #uploadAsset(asset: StudioDynamicDualTipExactR8AssetV2): CachedAsset {
    const key = assetKey(asset);
    const cached = this.#assetTextures.get(key);
    if (cached) return cached;
    if (this.#residentAssetBytes + asset.byteLength > this.#maximumResidentAssetBytes) {
      throw new RangeError("resident-asset-budget");
    }
    const upload = paddedUpload(asset);
    const texture = this.#device.createTexture({
      label: `Studio exact dual-tip v2 R8 ${asset.contentHash}`,
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
    const cachedAsset = Object.freeze({
      key,
      byteLength: asset.byteLength,
      texture,
      view: texture.createView(),
    });
    this.#assetTextures.set(key, cachedAsset);
    this.#residentAssetBytes += asset.byteLength;
    return cachedAsset;
  }

  #uncachedAssetBytes(plan: StudioDynamicDualTipExactPlanV2): number {
    const keys = new Set<string>();
    let total = 0;
    for (const asset of [plan.primaryAsset, plan.secondaryAsset]) {
      const key = assetKey(asset);
      if (keys.has(key) || this.#assetTextures.has(key)) continue;
      keys.add(key);
      total += asset.byteLength;
    }
    return total;
  }

  public async execute(
    frame: StudioDynamicDualTipExactWebGpuFrameV2,
    signal?: AbortSignal,
  ): Promise<StudioDynamicDualTipExactWebGpuExecutionResultV2> {
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
      || !planValid(frame.plan, this.#maximumDepositions)
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
    if (frame.plan.depositions.length > this.#maximumDepositions) {
      return Object.freeze({ status: "rejected", reason: "request-limit" });
    }
    if (
      this.#residentAssetBytes + this.#uncachedAssetBytes(frame.plan)
      > this.#maximumResidentAssetBytes
    ) return Object.freeze({ status: "rejected", reason: "resident-asset-budget" });

    this.#inFlight += 1;
    try {
      const depositionBuffer = this.#ensureDepositionBuffer(
        frame.plan.depositions.length,
      );
      this.#device.queue.writeBuffer(
        depositionBuffer,
        0,
        packStudioDynamicDualTipExactDepositionsV2(frame.plan),
      );
      this.#device.queue.writeBuffer(
        this.#uniformBuffer,
        0,
        new Float32Array([
          this.#width,
          this.#height,
          1 / this.#width,
          1 / this.#height,
          frame.plan.primaryAsset.width,
          frame.plan.primaryAsset.height,
          frame.plan.secondaryAsset.width,
          frame.plan.secondaryAsset.height,
        ]),
      );
      const primary = this.#uploadAsset(frame.plan.primaryAsset);
      const secondary = this.#uploadAsset(frame.plan.secondaryAsset);
      const bindGroup = this.#device.createBindGroup({
        label: `Studio exact dual-tip v2 ${frame.plan.fingerprint}`,
        layout: this.#layout,
        entries: [
          { binding: 0, resource: primary.view },
          { binding: 1, resource: secondary.view },
          { binding: 2, resource: this.#sampler },
          { binding: 3, resource: { buffer: this.#uniformBuffer } },
          { binding: 4, resource: { buffer: depositionBuffer } },
        ],
      });
      if (signal?.aborted) return Object.freeze({ status: "cancelled" });
      this.#lastRequestSequence = frame.requestSequence;

      const encoder = this.#device.createCommandEncoder({
        label: `Studio exact dual-tip v2 request ${frame.requestSequence}`,
      });
      const pass = encoder.beginRenderPass({
        label: `Studio exact dual-tip v2 ${frame.plan.mode} authority`,
        colorAttachments: [{
          view: this.#authorityView,
          loadOp: frame.plan.mode === "rebuild" || !this.#initialized ? "clear" : "load",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      pass.setBindGroup(0, bindGroup);
      let runStart = 0;
      let runOperation = frame.plan.depositions[0]!.porterDuff;
      for (let index = 1; index <= frame.plan.depositions.length; index += 1) {
        const nextOperation = frame.plan.depositions[index]?.porterDuff;
        if (nextOperation === runOperation) continue;
        pass.setPipeline(this.#pipelines[runOperation]);
        pass.draw(6, index - runStart, 0, runStart);
        runStart = index;
        if (nextOperation) runOperation = nextOperation;
      }
      pass.end();
      this.#device.queue.submit([encoder.finish()]);
      this.#initialized = true;
      await this.#device.queue.onSubmittedWorkDone();
      if (this.#disposed) return Object.freeze({ status: "disposed" });
      if (this.#lost) {
        return Object.freeze({ status: "device-lost", deviceEpoch: this.#deviceEpoch });
      }
      const blendFamilies = Object.freeze([
        ...new Set(frame.plan.depositions.map((item) => item.blendFamily)),
      ]);
      const porterDuffOperations = Object.freeze([
        ...new Set(frame.plan.depositions.map((item) => item.porterDuff)),
      ]);
      const receipt: StudioDynamicDualTipExactWebGpuReceiptV2 = Object.freeze({
        kind: "studio-dynamic-dual-tip-exact-webgpu-receipt",
        revision: STUDIO_DYNAMIC_DUAL_TIP_EXACT_WEBGPU_RUNTIME_REVISION,
        backend: "webgpu",
        providerCapability: STUDIO_DYNAMIC_DUAL_TIP_EXACT_PROVIDER_CAPABILITY,
        executionRoute: STUDIO_DYNAMIC_DUAL_TIP_EXACT_EXECUTION_ROUTE,
        textureFormat: STUDIO_DYNAMIC_DUAL_TIP_EXACT_WEBGPU_TEXTURE_FORMAT,
        colorModel: "scene-linear-premultiplied",
        compositionOrder: "combine-same-deposition-then-premultiplied-authority",
        numericalAuthority: "ordered-rgba16float-webgpu",
        exactness: "algorithmically-exact-deposition-order",
        requestSequence: frame.requestSequence,
        deviceEpoch: this.#deviceEpoch,
        mode: frame.plan.mode,
        strokeId: frame.plan.strokeId,
        commandSequence: frame.plan.commandSequence,
        depositionCount: frame.plan.depositions.length,
        blendFamilies,
        porterDuffOperations,
        assetBytes: frame.plan.primaryAsset.byteLength
          + frame.plan.secondaryAsset.byteLength,
        planFingerprint: frame.plan.fingerprint,
        queueState: "completed",
        complete: true,
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
    this.#depositionBuffer?.destroy();
    this.#uniformBuffer.destroy();
    this.#authorityTexture.destroy();
    for (const asset of this.#assetTextures.values()) asset.texture.destroy();
    this.#assetTextures.clear();
    if (this.#ownsDevice) this.#device.destroy();
  }
}

/**
 * Product routing boundary: v1 independent-mask plans are previews only. Exact product work must
 * supply a v2 deposition stream (or remain on the CPU f32 oracle).
 */
export function selectStudioDynamicDualTipExactExecutionRoute(
  plan: unknown,
  webGpuAvailable: boolean,
): typeof STUDIO_DYNAMIC_DUAL_TIP_EXACT_EXECUTION_ROUTE | "cpu-f32-oracle" {
  if (
    webGpuAvailable
    && plan
    && typeof plan === "object"
    && (plan as { kind?: unknown }).kind === "studio-dynamic-dual-tip-exact-plan"
    && (plan as { version?: unknown }).version === STUDIO_DYNAMIC_DUAL_TIP_EXACT_PLAN_VERSION
  ) return STUDIO_DYNAMIC_DUAL_TIP_EXACT_EXECUTION_ROUTE;
  return "cpu-f32-oracle";
}

export function isStudioDynamicDualTipDynamicFamilyV2(
  family: StudioDualTipExactBlendFamily,
): family is StudioDynamicDualTipBlendFamily {
  return DYNAMIC_BLEND_FAMILIES.includes(family as StudioDynamicDualTipBlendFamily);
}
