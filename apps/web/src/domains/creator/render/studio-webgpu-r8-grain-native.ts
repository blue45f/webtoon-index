import {
  STUDIO_BRUSH_R8_GRAIN_ASSET_LIMITS,
  normalizeStudioBrushR8TextureGrainSource,
  serializeStudioBrushR8TextureGrainSourceCanonical,
  type StudioBrushR8TextureGrainSource,
} from "../brush/studio-brush-r8-grain-asset-contract";
import {
  snapshotStudioBrushR8GrainAssetForTransfer,
  type StudioBrushR8GrainTransferSnapshotEntry,
} from "../brush/studio-brush-r8-grain-runtime";
import { sha256HexPortable } from "../studio-sha256";

/**
 * Exact native WebGPU bridge for the durable R8 paper-grain contract.
 *
 * This module deliberately does not accept URLs, encoded images, callbacks, or an already-created
 * GPUTexture. Its only binary authority is a private snapshot from the verified decoded-R8
 * registry. A caller therefore cannot bypass the encoded/decoded asset identity by supplying a
 * convenient remote texture.
 */
export const STUDIO_WEBGPU_R8_GRAIN_NATIVE_REVISION = 1 as const;

export const STUDIO_WEBGPU_R8_GRAIN_NATIVE_LIMITS = Object.freeze({
  maxEntries: 32,
  maxTextureDimension2D: STUDIO_BRUSH_R8_GRAIN_ASSET_LIMITS.maxDimension,
  maxTextureByteLength: STUDIO_BRUSH_R8_GRAIN_ASSET_LIMITS.maxDecodedByteLength,
  maxResidentBytes: 96 * 1_024 * 1_024,
  maxStagingBytes: 96 * 1_024 * 1_024,
  maxCoordinateAbsolute: 1_000_000,
  rowAlignment: 256,
} as const);

const GPU_TEXTURE_COPY_DST = 0x02;
const GPU_TEXTURE_BINDING = 0x04;
const UINT32_RANGE = 0x1_0000_0000;
const INPUT_KEYS = [
  "source",
  "space",
  "scale",
  "amount",
  "contrast",
  "seed",
  "strokeOriginX",
  "strokeOriginY",
  "strokeSeed",
] as const;

export interface StudioWebGpuR8GrainNativeInput {
  readonly source: unknown;
  readonly space: "canvas-fixed" | "stroke-fixed";
  /** CSS pixels per complete texture repeat, matching the Canvas/SVG R8 sampler. */
  readonly scale: number;
  readonly amount: number;
  readonly contrast: number;
  readonly seed: number;
  readonly strokeOriginX: number;
  readonly strokeOriginY: number;
  readonly strokeSeed: number;
}

export interface StudioWebGpuR8GrainNativeParameters {
  readonly anchorX: number;
  readonly anchorY: number;
  readonly phaseX: number;
  readonly phaseY: number;
  readonly scale: number;
  readonly amount: number;
  readonly contrast: number;
  readonly enabled: 1;
}

export interface StudioWebGpuR8GrainNativePlan {
  readonly kind: "studio-webgpu-r8-grain-native-plan";
  readonly revision: typeof STUDIO_WEBGPU_R8_GRAIN_NATIVE_REVISION;
  readonly sourceKey: string;
  readonly source: Readonly<StudioBrushR8TextureGrainSource>;
  readonly textureFormat: "r8unorm";
  readonly sampler: "repeat-bilinear";
  readonly coordinateModel: "document-css-px-f64-center-f32-local";
  readonly parameters: Readonly<StudioWebGpuR8GrainNativeParameters>;
}

export type StudioWebGpuR8GrainNativePlanResult =
  | Readonly<{ status: "ready"; plan: Readonly<StudioWebGpuR8GrainNativePlan> }>
  | Readonly<{ status: "inactive" }>
  | Readonly<{
      status: "rejected";
      reason: "invalid-input" | "invalid-source" | "coordinate-budget";
    }>;

export interface StudioWebGpuR8GrainTextureLease {
  readonly kind: "studio-webgpu-r8-grain-texture-lease";
  readonly revision: typeof STUDIO_WEBGPU_R8_GRAIN_NATIVE_REVISION;
  readonly sourceKey: string;
  readonly source: Readonly<StudioBrushR8TextureGrainSource>;
  readonly texture: GPUTexture;
  readonly view: GPUTextureView;
  readonly sampler: GPUSampler;
  readonly width: number;
  readonly height: number;
  readonly channel: "alpha" | "luminance";
  readonly format: "r8unorm";
  readonly parameters: Readonly<StudioWebGpuR8GrainNativeParameters>;
  /** A fresh 32-byte uniform payload on every call; consumers may transfer or mutate it safely. */
  createUniformData(): Float32Array;
  /** Idempotent. An unreleased lease pins its texture against LRU eviction. */
  release(): void;
}

export interface StudioWebGpuR8GrainTextureCacheOptions {
  readonly device: GPUDevice;
  readonly maxEntries?: number;
  readonly maxTextureDimension2D?: number;
  readonly maxTextureByteLength?: number;
  readonly maxResidentBytes?: number;
  readonly maxStagingBytes?: number;
  readonly snapshotForTransfer?: (
    source: unknown,
  ) => Readonly<StudioBrushR8GrainTransferSnapshotEntry> | null;
  readonly onDeviceLost?: (info: GPUDeviceLostInfo) => void;
}

export interface StudioWebGpuR8GrainTextureCacheStats {
  readonly entries: number;
  readonly residentBytes: number;
  readonly maxEntries: number;
  readonly maxResidentBytes: number;
  readonly uploads: number;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  readonly activeLeases: number;
  readonly disposed: boolean;
  readonly deviceLost: boolean;
}

export type StudioWebGpuR8GrainTextureAcquireResult =
  | Readonly<{ status: "ready"; lease: Readonly<StudioWebGpuR8GrainTextureLease> }>
  | Readonly<{ status: "inactive" }>
  | Readonly<{
      status: "rejected";
      reason:
        | "invalid-input"
        | "invalid-source"
        | "coordinate-budget"
        | "asset-not-hydrated"
        | "snapshot-invalid"
        | "snapshot-identity-mismatch"
        | "decoded-byte-length-mismatch"
        | "decoded-hash-mismatch"
        | "texture-dimension-budget"
        | "texture-byte-budget"
        | "staging-budget"
        | "resident-budget"
        | "texture-upload-failed";
    }>
  | Readonly<{ status: "device-lost" }>
  | Readonly<{ status: "disposed" }>;

export interface StudioWebGpuR8GrainTextureAcquireOptions {
  /**
   * Request-scoped share of the cache's resident budget. A host runtime uses this to combine
   * generic tip assets and durable grain textures under one total ceiling.
   */
  readonly maxResidentBytes?: number;
}

interface CachedTexture {
  readonly sourceKey: string;
  readonly source: Readonly<StudioBrushR8TextureGrainSource>;
  readonly texture: GPUTexture;
  readonly view: GPUTextureView;
  readonly width: number;
  readonly height: number;
  readonly channel: "alpha" | "luminance";
  readonly residentBytes: number;
  activeLeases: number;
}

interface NormalizedCacheOptions {
  readonly maxEntries: number;
  readonly maxTextureDimension2D: number;
  readonly maxTextureByteLength: number;
  readonly maxResidentBytes: number;
  readonly maxStagingBytes: number;
}

type ExactRecord = Readonly<Record<string, unknown>>;

function exactDataRecord(value: unknown, keys: readonly string[]): ExactRecord | null {
  try {
    if (
      typeof value !== "object"
      || value === null
      || Array.isArray(value)
      || (
        Object.getPrototypeOf(value) !== Object.prototype
        && Object.getPrototypeOf(value) !== null
      )
      || Object.getOwnPropertySymbols(value).length !== 0
    ) {
      return null;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<
      string,
      PropertyDescriptor
    >;
    const actualKeys = Object.keys(descriptors);
    if (
      actualKeys.length !== keys.length
      || actualKeys.some((key) => !keys.includes(key))
      || keys.some((key) => !actualKeys.includes(key))
    ) {
      return null;
    }
    const record: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
      record[key] = descriptor.value;
    }
    return record;
  } catch {
    return null;
  }
}

function finiteFloat32(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && Number.isFinite(Math.fround(value));
}

function finiteCoordinate(value: unknown): value is number {
  return finiteFloat32(value)
    && Math.abs(value) <= STUDIO_WEBGPU_R8_GRAIN_NATIVE_LIMITS.maxCoordinateAbsolute;
}

function unitInterval(value: unknown): value is number {
  return finiteFloat32(value) && value >= 0 && value <= 1;
}

function uint32(value: unknown): value is number {
  return Number.isSafeInteger(value)
    && (value as number) >= 0
    && (value as number) <= 0xffff_ffff;
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (!positiveSafeInteger(value)) {
    throw new TypeError("Invalid positive WebGPU R8 cache budget");
  }
  return Math.min(value, maximum);
}

function boundedNonNegativeInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Invalid non-negative WebGPU R8 cache budget");
  }
  return Math.min(value, maximum);
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function mixedUnit(seed: number, salt: number): number {
  let value = ((Math.trunc(seed) >>> 0) ^ salt) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb_352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846c_a68b);
  value ^= value >>> 16;
  return (value >>> 0) / UINT32_RANGE;
}

function canonicalSourceKey(source: unknown): string | null {
  return serializeStudioBrushR8TextureGrainSourceCanonical(source);
}

function exactPrivateBytes(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array
    && Object.getPrototypeOf(value) === Uint8Array.prototype
    && !(
      typeof SharedArrayBuffer !== "undefined"
      && value.buffer instanceof SharedArrayBuffer
    );
}

function safeDestroy(texture: GPUTexture | null | undefined): void {
  try {
    texture?.destroy();
  } catch {
    // Device-loss and implementation-specific double-destroy errors are non-authoritative.
  }
}

function clonePlanSource(
  source: Readonly<StudioBrushR8TextureGrainSource>,
): Readonly<StudioBrushR8TextureGrainSource> {
  return Object.freeze({
    kind: "r8-texture-v1" as const,
    asset: Object.freeze({ ...source.asset }),
  });
}

function validateSnapshot(
  plan: Readonly<StudioWebGpuR8GrainNativePlan>,
  snapshot: Readonly<StudioBrushR8GrainTransferSnapshotEntry>,
): StudioWebGpuR8GrainTextureAcquireResult | Readonly<{
  status: "validated";
  decodedBytes: Uint8Array;
}> {
  if (
    typeof snapshot !== "object"
    || snapshot === null
    || typeof snapshot.sourceKey !== "string"
    || !exactPrivateBytes(snapshot.decodedBytes)
  ) {
    return Object.freeze({ status: "rejected", reason: "snapshot-invalid" });
  }
  const snapshotKey = canonicalSourceKey(snapshot.source);
  if (
    snapshot.sourceKey !== plan.sourceKey
    || snapshotKey !== plan.sourceKey
  ) {
    return Object.freeze({
      status: "rejected",
      reason: "snapshot-identity-mismatch",
    });
  }
  const expectedByteLength = plan.source.asset.width * plan.source.asset.height;
  if (
    !Number.isSafeInteger(expectedByteLength)
    || snapshot.decodedBytes.byteLength !== expectedByteLength
  ) {
    return Object.freeze({
      status: "rejected",
      reason: "decoded-byte-length-mismatch",
    });
  }
  const digest = `sha256:${sha256HexPortable(snapshot.decodedBytes)}`;
  if (digest !== plan.source.asset.decodedSha256) {
    return Object.freeze({ status: "rejected", reason: "decoded-hash-mismatch" });
  }
  return Object.freeze({ status: "validated", decodedBytes: snapshot.decodedBytes });
}

/**
 * Produces the immutable coordinate/identity portion of a native R8 binding. The plan contains no
 * decoded bytes; texture acquisition must still cross the verified registry snapshot boundary.
 */
export function planStudioWebGpuR8GrainNative(
  input: unknown,
): StudioWebGpuR8GrainNativePlanResult {
  const record = exactDataRecord(input, INPUT_KEYS);
  if (!record) return Object.freeze({ status: "rejected", reason: "invalid-input" });
  const source = normalizeStudioBrushR8TextureGrainSource(record.source);
  const sourceKey = source ? canonicalSourceKey(source) : null;
  if (!source || !sourceKey) {
    return Object.freeze({ status: "rejected", reason: "invalid-source" });
  }
  if (
    (record.space !== "canvas-fixed" && record.space !== "stroke-fixed")
    || !finiteFloat32(record.scale)
    || record.scale < 0.25
    || record.scale > 512
    || !unitInterval(record.amount)
    || !unitInterval(record.contrast)
    || !uint32(record.seed)
    || !finiteCoordinate(record.strokeOriginX)
    || !finiteCoordinate(record.strokeOriginY)
    || !uint32(record.strokeSeed)
  ) {
    return Object.freeze({ status: "rejected", reason: "invalid-input" });
  }
  if (record.amount === 0) return Object.freeze({ status: "inactive" });

  const phaseSeed = ((record.strokeSeed as number) ^ (record.seed as number)) >>> 0;
  const anchorX = record.space === "stroke-fixed" ? record.strokeOriginX as number : 0;
  const anchorY = record.space === "stroke-fixed" ? record.strokeOriginY as number : 0;
  const parameters: StudioWebGpuR8GrainNativeParameters = Object.freeze({
    // These values stay in JS f64 until each dab-centre UV is wrapped. Only the wrapped UV and
    // small vertex-local offset cross the f32 GPU boundary; rounding a fractional million-pixel
    // stroke origin here would reintroduce the precision failure this bridge exists to avoid.
    anchorX,
    anchorY,
    phaseX: mixedUnit(phaseSeed, 0x9e37_79b9),
    phaseY: mixedUnit(phaseSeed, 0x243f_6a88),
    scale: record.scale as number,
    amount: Math.fround(record.amount as number),
    contrast: Math.fround(record.contrast as number),
    enabled: 1,
  });
  if (
    !finiteCoordinate(parameters.anchorX)
    || !finiteCoordinate(parameters.anchorY)
    || !finiteFloat32(parameters.phaseX)
    || !finiteFloat32(parameters.phaseY)
  ) {
    return Object.freeze({ status: "rejected", reason: "coordinate-budget" });
  }
  return Object.freeze({
    status: "ready",
    plan: Object.freeze({
      kind: "studio-webgpu-r8-grain-native-plan",
      revision: STUDIO_WEBGPU_R8_GRAIN_NATIVE_REVISION,
      sourceKey,
      source: clonePlanSource(source),
      textureFormat: "r8unorm",
      sampler: "repeat-bilinear",
      coordinateModel: "document-css-px-f64-center-f32-local",
      parameters,
    }),
  });
}

/**
 * Packs the exact uniform layout consumed by `studioWebGpuR8GrainNativeWgsl`.
 *
 * `anchor_phase = [anchorX, anchorY, phaseX, phaseY]`
 * `scale_amount_contrast_enabled = [scale, amount, contrast, 1]`
 */
export function packStudioWebGpuR8GrainNativeUniform(
  parameters: Readonly<StudioWebGpuR8GrainNativeParameters>,
): Float32Array {
  return new Float32Array([
    parameters.anchorX,
    parameters.anchorY,
    parameters.phaseX,
    parameters.phaseY,
    parameters.scale,
    parameters.amount,
    parameters.contrast,
    parameters.enabled,
  ]);
}

/**
 * Computes a dab-centre UV in JavaScript's f64 domain before packing it to f32.
 *
 * The fragment shader must not evaluate `(document - anchor) / scale` at million-pixel document
 * coordinates: at a 0.3 px repeat, f32 has already lost most of the fractional UV. The host packs
 * this wrapped centre UV once per dab; the vertex shader then adds only the small local offset.
 */
export function studioWebGpuR8GrainDabCenterUv(
  parameters: Readonly<StudioWebGpuR8GrainNativeParameters>,
  documentCenterX: number,
  documentCenterY: number,
): readonly [number, number] | null {
  if (
    !finiteCoordinate(documentCenterX)
    || !finiteCoordinate(documentCenterY)
    || !finiteCoordinate(parameters.anchorX)
    || !finiteCoordinate(parameters.anchorY)
    || !finiteFloat32(parameters.phaseX)
    || !finiteFloat32(parameters.phaseY)
    || !finiteFloat32(parameters.scale)
    || parameters.scale <= 0
  ) {
    return null;
  }
  return Object.freeze([
    Math.fround(positiveModulo(
      (documentCenterX - parameters.anchorX) / parameters.scale
        + parameters.phaseX,
      1,
    )),
    Math.fround(positiveModulo(
      (documentCenterY - parameters.anchorY) / parameters.scale
        + parameters.phaseY,
      1,
    )),
  ]);
}

export interface StudioWebGpuR8GrainWgslBindings {
  readonly group: number;
  readonly textureBinding: number;
  readonly samplerBinding: number;
  readonly uniformBinding: number;
  readonly prefix?: string;
}

/**
 * Generates collision-free declarations for a host brush shader. The generated function accepts
 * the small document offset from the dab centre plus the f64-derived centre UV, and returns the
 * same alpha multiplier as the CPU R8 sampler. Native repeat+linear sampling performs the
 * `u * width - 0.5` texel-centre interpolation without allocating a per-dab Float32 alpha map.
 */
export function studioWebGpuR8GrainNativeWgsl(
  bindings: StudioWebGpuR8GrainWgslBindings,
): string | null {
  const { group, textureBinding, samplerBinding, uniformBinding } = bindings;
  const prefix = bindings.prefix ?? "studio_r8_grain";
  if (
    ![group, textureBinding, samplerBinding, uniformBinding].every(
      (value) => Number.isSafeInteger(value) && value >= 0 && value <= 255,
    )
    || new Set([textureBinding, samplerBinding, uniformBinding]).size !== 3
    || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(prefix)
  ) {
    return null;
  }
  return `
struct ${prefix}_uniform {
  anchor_phase: vec4f,
  scale_amount_contrast_enabled: vec4f,
};

@group(${group}) @binding(${textureBinding})
var ${prefix}_texture: texture_2d<f32>;
@group(${group}) @binding(${samplerBinding})
var ${prefix}_sampler: sampler;
@group(${group}) @binding(${uniformBinding})
var<uniform> ${prefix}_params: ${prefix}_uniform;

fn ${prefix}_alpha_multiplier(
  document_offset_from_dab_center: vec2f,
  dab_center_uv: vec2f,
) -> f32 {
  let scale = ${prefix}_params.scale_amount_contrast_enabled.x;
  let amount = ${prefix}_params.scale_amount_contrast_enabled.y;
  let contrast = ${prefix}_params.scale_amount_contrast_enabled.z;
  let enabled = ${prefix}_params.scale_amount_contrast_enabled.w;
  let uv = dab_center_uv + document_offset_from_dab_center / scale;
  let sampled = textureSample(${prefix}_texture, ${prefix}_sampler, uv).r;
  let contrasted = clamp((sampled - 0.5) * (1.0 + contrast * 4.0) + 0.5, 0.0, 1.0);
  return clamp(mix(1.0, 1.0 - amount * (1.0 - contrasted), enabled), 0.0, 1.0);
}
`.trim();
}

/**
 * CPU mirror of the generated WGSL, intended for deterministic parity tests and readback gates.
 * Bytes are interpreted as the exact tightly packed decoded R8 payload; alpha and luminance assets
 * deliberately share this sampler because channel extraction happened before registry hydration.
 */
export function sampleStudioWebGpuR8GrainNativeCpu(
  plan: Readonly<StudioWebGpuR8GrainNativePlan>,
  decodedBytes: Uint8Array,
  documentX: number,
  documentY: number,
): number {
  const { width, height } = plan.source.asset;
  if (
    plan.kind !== "studio-webgpu-r8-grain-native-plan"
    || plan.revision !== STUDIO_WEBGPU_R8_GRAIN_NATIVE_REVISION
    || plan.textureFormat !== "r8unorm"
    || plan.sampler !== "repeat-bilinear"
    || !exactPrivateBytes(decodedBytes)
    || decodedBytes.byteLength !== width * height
    || !finiteCoordinate(documentX)
    || !finiteCoordinate(documentY)
  ) {
    return 1;
  }
  const { anchorX, anchorY, phaseX, phaseY, scale, amount, contrast } = plan.parameters;
  const u = (documentX - anchorX) / scale + phaseX;
  const v = (documentY - anchorY) / scale + phaseY;
  const texelX = positiveModulo(u, 1) * width - 0.5;
  const texelY = positiveModulo(v, 1) * height - 0.5;
  const x0 = Math.floor(texelX);
  const y0 = Math.floor(texelY);
  const tx = texelX - x0;
  const ty = texelY - y0;
  const wrappedX0 = positiveModulo(x0, width);
  const wrappedY0 = positiveModulo(y0, height);
  const wrappedX1 = (wrappedX0 + 1) % width;
  const wrappedY1 = (wrappedY0 + 1) % height;
  const topLeft = decodedBytes[wrappedY0 * width + wrappedX0]! / 255;
  const topRight = decodedBytes[wrappedY0 * width + wrappedX1]! / 255;
  const bottomLeft = decodedBytes[wrappedY1 * width + wrappedX0]! / 255;
  const bottomRight = decodedBytes[wrappedY1 * width + wrappedX1]! / 255;
  const top = topLeft + (topRight - topLeft) * tx;
  const bottom = bottomLeft + (bottomRight - bottomLeft) * tx;
  const sampled = top + (bottom - top) * ty;
  const contrasted = Math.min(
    1,
    Math.max(0, (sampled - 0.5) * (1 + contrast * 4) + 0.5),
  );
  return Math.min(1, Math.max(0, 1 - amount * (1 - contrasted)));
}

/**
 * Device-local R8 texture cache. Resident resources are content-addressed by the complete durable
 * source JSON, not by assetId or URL. Active leases are pinned; if the budget cannot be met without
 * destroying an active texture, acquisition fails closed.
 */
export class StudioWebGpuR8GrainTextureCache {
  readonly #device: GPUDevice;
  readonly #sampler: GPUSampler;
  readonly #options: Readonly<NormalizedCacheOptions>;
  readonly #snapshotForTransfer: (
    source: unknown,
  ) => Readonly<StudioBrushR8GrainTransferSnapshotEntry> | null;
  readonly #entries = new Map<string, CachedTexture>();
  #residentBytes = 0;
  #uploads = 0;
  #hits = 0;
  #misses = 0;
  #evictions = 0;
  #disposed = false;
  #deviceLost = false;

  public constructor(options: StudioWebGpuR8GrainTextureCacheOptions) {
    if (!options || typeof options !== "object" || !options.device) {
      throw new TypeError("A GPUDevice is required");
    }
    this.#device = options.device;
    const reportedMaximum = Number(options.device.limits?.maxTextureDimension2D);
    const deviceMaximum = positiveSafeInteger(reportedMaximum)
      ? reportedMaximum
      : STUDIO_WEBGPU_R8_GRAIN_NATIVE_LIMITS.maxTextureDimension2D;
    this.#options = Object.freeze({
      maxEntries: boundedNonNegativeInteger(
        options.maxEntries,
        STUDIO_WEBGPU_R8_GRAIN_NATIVE_LIMITS.maxEntries,
        256,
      ),
      maxTextureDimension2D: boundedPositiveInteger(
        options.maxTextureDimension2D,
        Math.min(
          deviceMaximum,
          STUDIO_WEBGPU_R8_GRAIN_NATIVE_LIMITS.maxTextureDimension2D,
        ),
        Math.min(
          deviceMaximum,
          STUDIO_WEBGPU_R8_GRAIN_NATIVE_LIMITS.maxTextureDimension2D,
        ),
      ),
      maxTextureByteLength: boundedNonNegativeInteger(
        options.maxTextureByteLength,
        STUDIO_WEBGPU_R8_GRAIN_NATIVE_LIMITS.maxTextureByteLength,
        STUDIO_WEBGPU_R8_GRAIN_NATIVE_LIMITS.maxTextureByteLength,
      ),
      maxResidentBytes: boundedNonNegativeInteger(
        options.maxResidentBytes,
        STUDIO_WEBGPU_R8_GRAIN_NATIVE_LIMITS.maxResidentBytes,
        512 * 1_024 * 1_024,
      ),
      maxStagingBytes: boundedNonNegativeInteger(
        options.maxStagingBytes,
        STUDIO_WEBGPU_R8_GRAIN_NATIVE_LIMITS.maxStagingBytes,
        512 * 1_024 * 1_024,
      ),
    });
    this.#snapshotForTransfer =
      options.snapshotForTransfer ?? snapshotStudioBrushR8GrainAssetForTransfer;
    this.#sampler = this.#device.createSampler({
      label: "Studio verified R8 paper repeat-bilinear sampler",
      addressModeU: "repeat",
      addressModeV: "repeat",
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "nearest",
    });
    void this.#device.lost.then((info) => {
      if (this.#disposed) return;
      this.#deviceLost = true;
      this.#destroyAll();
      options.onDeviceLost?.(info);
    });
  }

  public acquire(
    input: unknown,
    options: StudioWebGpuR8GrainTextureAcquireOptions = {},
  ): StudioWebGpuR8GrainTextureAcquireResult {
    if (this.#disposed) return Object.freeze({ status: "disposed" });
    if (this.#deviceLost) return Object.freeze({ status: "device-lost" });
    const planned = planStudioWebGpuR8GrainNative(input);
    if (planned.status !== "ready") return planned;
    const { plan } = planned;
    if (
      options.maxResidentBytes !== undefined
      && (
        !Number.isSafeInteger(options.maxResidentBytes)
        || options.maxResidentBytes < 0
      )
    ) {
      return Object.freeze({ status: "rejected", reason: "resident-budget" });
    }
    const effectiveResidentBudget = options.maxResidentBytes === undefined
      ? this.#options.maxResidentBytes
      : Math.min(options.maxResidentBytes, this.#options.maxResidentBytes);
    const existing = this.#entries.get(plan.sourceKey);
    if (existing) {
      if (
        existing.residentBytes > effectiveResidentBudget
        || !this.#evictFor(0, effectiveResidentBudget, existing.sourceKey)
      ) {
        return Object.freeze({ status: "rejected", reason: "resident-budget" });
      }
      this.#hits += 1;
      this.#touch(existing);
      return Object.freeze({ status: "ready", lease: this.#lease(existing, plan) });
    }
    this.#misses += 1;

    let snapshot: Readonly<StudioBrushR8GrainTransferSnapshotEntry> | null;
    try {
      snapshot = this.#snapshotForTransfer(plan.source);
    } catch {
      snapshot = null;
    }
    if (!snapshot) {
      return Object.freeze({ status: "rejected", reason: "asset-not-hydrated" });
    }
    let decodedBytes: Uint8Array | null = exactPrivateBytes(snapshot.decodedBytes)
      ? snapshot.decodedBytes
      : null;
    let staging: Uint8Array | null = null;
    let texture: GPUTexture | null = null;
    try {
      const validated = validateSnapshot(plan, snapshot);
      if (validated.status !== "validated") return validated;
      decodedBytes = validated.decodedBytes;
      const { width, height } = plan.source.asset;
      if (
        width > this.#options.maxTextureDimension2D
        || height > this.#options.maxTextureDimension2D
      ) {
        return Object.freeze({
          status: "rejected",
          reason: "texture-dimension-budget",
        });
      }
      if (decodedBytes.byteLength > this.#options.maxTextureByteLength) {
        return Object.freeze({ status: "rejected", reason: "texture-byte-budget" });
      }
      const bytesPerRow = align(
        width,
        STUDIO_WEBGPU_R8_GRAIN_NATIVE_LIMITS.rowAlignment,
      );
      const stagingByteLength = bytesPerRow * height;
      if (
        !Number.isSafeInteger(stagingByteLength)
        || stagingByteLength > this.#options.maxStagingBytes
      ) {
        return Object.freeze({ status: "rejected", reason: "staging-budget" });
      }
      const residentBytes = Math.max(decodedBytes.byteLength, stagingByteLength);
      if (
        this.#options.maxEntries === 0
        || residentBytes > effectiveResidentBudget
        || !this.#evictFor(residentBytes, effectiveResidentBudget)
      ) {
        return Object.freeze({ status: "rejected", reason: "resident-budget" });
      }

      staging = new Uint8Array(stagingByteLength);
      for (let row = 0; row < height; row += 1) {
        staging.set(
          decodedBytes.subarray(row * width, (row + 1) * width),
          row * bytesPerRow,
        );
      }
      texture = this.#device.createTexture({
        label: `Studio verified R8 grain ${plan.source.asset.decodedSha256}`,
        size: { width, height, depthOrArrayLayers: 1 },
        format: "r8unorm",
        usage: GPU_TEXTURE_BINDING | GPU_TEXTURE_COPY_DST,
      });
      this.#device.queue.writeTexture(
        { texture },
        staging,
        { offset: 0, bytesPerRow, rowsPerImage: height },
        { width, height, depthOrArrayLayers: 1 },
      );
      const entry: CachedTexture = {
        sourceKey: plan.sourceKey,
        source: plan.source,
        texture,
        view: texture.createView(),
        width,
        height,
        channel: plan.source.asset.channel,
        residentBytes,
        activeLeases: 0,
      };
      this.#entries.set(entry.sourceKey, entry);
      this.#residentBytes += residentBytes;
      this.#uploads += 1;
      texture = null;
      return Object.freeze({ status: "ready", lease: this.#lease(entry, plan) });
    } catch {
      safeDestroy(texture);
      return Object.freeze({ status: "rejected", reason: "texture-upload-failed" });
    } finally {
      staging?.fill(0);
      decodedBytes?.fill(0);
    }
  }

  public stats(): Readonly<StudioWebGpuR8GrainTextureCacheStats> {
    let activeLeases = 0;
    for (const entry of this.#entries.values()) activeLeases += entry.activeLeases;
    return Object.freeze({
      entries: this.#entries.size,
      residentBytes: this.#residentBytes,
      maxEntries: this.#options.maxEntries,
      maxResidentBytes: this.#options.maxResidentBytes,
      uploads: this.#uploads,
      hits: this.#hits,
      misses: this.#misses,
      evictions: this.#evictions,
      activeLeases,
      disposed: this.#disposed,
      deviceLost: this.#deviceLost,
    });
  }

  /**
   * Evicts inactive LRU resources until the cache fits a host runtime's current budget share.
   * Active leases are never destroyed; `false` asks the host to fail the frame closed.
   */
  public trimToResidentBytes(maxResidentBytes: number): boolean {
    if (this.#disposed || this.#deviceLost) return false;
    if (!Number.isSafeInteger(maxResidentBytes) || maxResidentBytes < 0) return false;
    const budget = Math.min(maxResidentBytes, this.#options.maxResidentBytes);
    return this.#evictFor(0, budget);
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#destroyAll();
  }

  #lease(
    entry: CachedTexture,
    plan: Readonly<StudioWebGpuR8GrainNativePlan>,
  ): Readonly<StudioWebGpuR8GrainTextureLease> {
    entry.activeLeases += 1;
    let released = false;
    const lease: StudioWebGpuR8GrainTextureLease = {
      kind: "studio-webgpu-r8-grain-texture-lease",
      revision: STUDIO_WEBGPU_R8_GRAIN_NATIVE_REVISION,
      sourceKey: entry.sourceKey,
      source: entry.source,
      texture: entry.texture,
      view: entry.view,
      sampler: this.#sampler,
      width: entry.width,
      height: entry.height,
      channel: entry.channel,
      format: "r8unorm",
      parameters: plan.parameters,
      createUniformData: () => packStudioWebGpuR8GrainNativeUniform(plan.parameters),
      release: () => {
        if (released) return;
        released = true;
        entry.activeLeases = Math.max(0, entry.activeLeases - 1);
      },
    };
    return Object.freeze(lease);
  }

  #touch(entry: CachedTexture): void {
    this.#entries.delete(entry.sourceKey);
    this.#entries.set(entry.sourceKey, entry);
  }

  #evictFor(
    incomingBytes: number,
    residentBudget: number,
    protectedSourceKey?: string,
  ): boolean {
    while (
      this.#entries.size + (incomingBytes > 0 ? 1 : 0) > this.#options.maxEntries
      || this.#residentBytes + incomingBytes > residentBudget
    ) {
      let candidate: CachedTexture | null = null;
      for (const entry of this.#entries.values()) {
        if (
          entry.activeLeases === 0
          && entry.sourceKey !== protectedSourceKey
        ) {
          candidate = entry;
          break;
        }
      }
      if (!candidate) return false;
      this.#entries.delete(candidate.sourceKey);
      this.#residentBytes = Math.max(0, this.#residentBytes - candidate.residentBytes);
      safeDestroy(candidate.texture);
      this.#evictions += 1;
    }
    return true;
  }

  #destroyAll(): void {
    for (const entry of this.#entries.values()) safeDestroy(entry.texture);
    this.#entries.clear();
    this.#residentBytes = 0;
  }
}
