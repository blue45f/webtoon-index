/**
 * High-precision WebGPU backend for `StudioTileDocWebGpuBridge`.
 *
 * Dirty layer stacks arrive in the document store's premultiplied sRGB RGBA8 format. Upload packing
 * restores straight sRGB while preserving alpha, the source texture decodes that colour to linear
 * light, and the shader composites into retained premultiplied RGBA16F ping-pong tile textures.
 * Clean camera frames submit only the final presentation pass. No document/history authority
 * lives here; device loss or any rejected frame is recovered by invalidating the bridge planner.
 */

import { acquireStudioGpuDevice } from "./studio-gpu-fabric";

import type { StudioGpuDeviceLease } from "./studio-gpu-fabric";
import type {
  StudioTileDocWebGpuConsumer,
  StudioTileDocWebGpuConsumerResult,
  StudioTileDocWebGpuFrame,
  StudioTileDocWebGpuPresentedReceipt,
  StudioTileDocWebGpuSourceSnapshot,
  StudioTileDocWebGpuVisibleTile,
} from "./studio-tiledoc-webgpu-bridge";

export const STUDIO_TILEDOC_WEBGPU_COMPOSITE_TEXTURE_FORMAT = "rgba16float" as const;
export const STUDIO_TILEDOC_WEBGPU_SOURCE_TEXTURE_FORMAT = "rgba8unorm-srgb" as const;
export const STUDIO_TILEDOC_WEBGPU_COMPOSITE_BYTES_PER_PIXEL = 8;
export const STUDIO_TILEDOC_WEBGPU_SOURCE_BYTES_PER_PIXEL = 4;
export const STUDIO_TILEDOC_WEBGPU_UPLOAD_ROW_ALIGNMENT = 256;
export const STUDIO_TILEDOC_WEBGPU_DEFAULT_MAX_RETAINED_ENTRIES = 256;
export const STUDIO_TILEDOC_WEBGPU_DEFAULT_MAX_RETAINED_BYTES = 512 * 1_024 * 1_024;
export const STUDIO_TILEDOC_WEBGPU_DEFAULT_MAX_FRAME_UPLOAD_BYTES = 128 * 1_024 * 1_024;
export const STUDIO_TILEDOC_WEBGPU_DEFAULT_MAX_UPLOAD_POOL_ENTRIES = 16;
export const STUDIO_TILEDOC_WEBGPU_DEFAULT_MAX_UPLOAD_POOL_BYTES = 64 * 1_024 * 1_024;
export const STUDIO_TILEDOC_WEBGPU_DEFAULT_MAX_SOURCE_CACHE_ENTRIES = 512;
export const STUDIO_TILEDOC_WEBGPU_DEFAULT_MAX_SOURCE_CACHE_BYTES = 512 * 1_024 * 1_024;
export const STUDIO_TILEDOC_WEBGPU_DEFAULT_MAX_STACK_ENTRIES = 16_384;

const GPU_TEXTURE_COPY_SRC = 0x01;
const GPU_TEXTURE_COPY_DST = 0x02;
const GPU_TEXTURE_BINDING = 0x04;
const GPU_TEXTURE_RENDER_ATTACHMENT = 0x10;
const GPU_BUFFER_MAP_READ = 0x01;
const GPU_BUFFER_COPY_DST = 0x08;
const GPU_BUFFER_VERTEX = 0x20;
const GPU_BUFFER_UNIFORM = 0x40;
const GPU_MAP_MODE_READ = 0x01;
const PRESENTATION_VERTEX_FLOATS = 4;
const COMPOSITE_PARAMETER_BYTES = 16;
const MIN_DYNAMIC_UNIFORM_ALIGNMENT = 256;

export const STUDIO_TILEDOC_WEBGPU_SUPPORTED_BLEND_MODES = Object.freeze([
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "add",
  "subtract",
  "difference",
  "exclusion",
  "hard-light",
] as const);

export type StudioTileDocWebGpuBlendMode =
  typeof STUDIO_TILEDOC_WEBGPU_SUPPORTED_BLEND_MODES[number];

const BLEND_MODE_CODES = new Map<StudioTileDocWebGpuBlendMode, number>([
  ["normal", 0],
  ["multiply", 1],
  ["screen", 2],
  ["overlay", 3],
  ["darken", 4],
  ["lighten", 5],
  ["add", 6],
  ["subtract", 7],
  ["difference", 8],
  ["exclusion", 9],
  ["hard-light", 10],
]);

const COMPOSITE_SHADER = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

struct CompositeParameters {
  opacity: f32,
  blend_mode: u32,
  _padding: vec2u,
};

@group(0) @binding(0) var previous_texture: texture_2d<f32>;
@group(0) @binding(1) var source_texture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> parameters: CompositeParameters;

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
  let positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0),
  );
  let position = positions[vertex_index];
  var output: VertexOutput;
  output.position = vec4f(position, 0.0, 1.0);
  output.uv = vec2f((position.x + 1.0) * 0.5, (1.0 - position.y) * 0.5);
  return output;
}

fn load_clamped(texture: texture_2d<f32>, uv: vec2f) -> vec4f {
  let dimensions = textureDimensions(texture);
  let maximum = vec2i(dimensions) - vec2i(1);
  let coordinate = clamp(vec2i(uv * vec2f(dimensions)), vec2i(0), maximum);
  return textureLoad(texture, coordinate, 0);
}

fn blend_color(backdrop: vec3f, source: vec3f, mode: u32) -> vec3f {
  switch mode {
    case 1u: {
      return backdrop * source;
    }
    case 2u: {
      return 1.0 - (1.0 - backdrop) * (1.0 - source);
    }
    case 3u: {
      let low = 2.0 * backdrop * source;
      let high = 1.0 - 2.0 * (1.0 - backdrop) * (1.0 - source);
      return select(low, high, backdrop >= vec3f(0.5));
    }
    case 4u: {
      return min(backdrop, source);
    }
    case 5u: {
      return max(backdrop, source);
    }
    case 6u: {
      return min(backdrop + source, vec3f(1.0));
    }
    case 7u: {
      return max(backdrop - source, vec3f(0.0));
    }
    case 8u: {
      return abs(backdrop - source);
    }
    case 9u: {
      return backdrop + source - 2.0 * backdrop * source;
    }
    case 10u: {
      let low = 2.0 * backdrop * source;
      let high = 1.0 - 2.0 * (1.0 - backdrop) * (1.0 - source);
      return select(low, high, source >= vec3f(0.5));
    }
    default: {
      return source;
    }
  }
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  let previous = load_clamped(previous_texture, input.uv);
  let sampled_source = load_clamped(source_texture, input.uv);
  let backdrop_alpha = clamp(previous.a, 0.0, 1.0);
  let source_alpha = clamp(sampled_source.a * parameters.opacity, 0.0, 1.0);
  let backdrop_straight = select(
    vec3f(0.0),
    previous.rgb / max(backdrop_alpha, 0.000001),
    backdrop_alpha > 0.0,
  );
  let source_straight = sampled_source.rgb;
  let blended = blend_color(backdrop_straight, source_straight, parameters.blend_mode);
  let output_alpha = source_alpha + backdrop_alpha * (1.0 - source_alpha);
  let output_rgb =
    previous.rgb * (1.0 - source_alpha)
    + source_alpha * (
      source_straight * (1.0 - backdrop_alpha)
      + blended * backdrop_alpha
    );
  return vec4f(output_rgb, output_alpha);
}
`;

const PRESENTATION_SHADER = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@group(0) @binding(0) var tile_texture: texture_2d<f32>;

@vertex
fn vs_main(
  @location(0) position: vec2f,
  @location(1) uv: vec2f,
) -> VertexOutput {
  var output: VertexOutput;
  output.position = vec4f(position, 0.0, 1.0);
  output.uv = uv;
  return output;
}

fn load_clamped(texture: texture_2d<f32>, coordinate: vec2i) -> vec4f {
  let dimensions = textureDimensions(texture);
  let maximum = vec2i(dimensions) - vec2i(1);
  return textureLoad(texture, clamp(coordinate, vec2i(0), maximum), 0);
}

fn sample_bilinear(texture: texture_2d<f32>, uv: vec2f) -> vec4f {
  let dimensions = vec2f(textureDimensions(texture));
  let coordinate = uv * dimensions - vec2f(0.5);
  let base = vec2i(floor(coordinate));
  let fraction = fract(coordinate);
  let top_left = load_clamped(texture, base);
  let top_right = load_clamped(texture, base + vec2i(1, 0));
  let bottom_left = load_clamped(texture, base + vec2i(0, 1));
  let bottom_right = load_clamped(texture, base + vec2i(1, 1));
  return mix(
    mix(top_left, top_right, fraction.x),
    mix(bottom_left, bottom_right, fraction.x),
    fraction.y,
  );
}

fn linear_to_srgb_channel(value: f32) -> f32 {
  let safe = max(value, 0.0);
  return select(
    1.055 * pow(safe, 1.0 / 2.4) - 0.055,
    12.92 * safe,
    safe <= 0.0031308,
  );
}

fn linear_to_srgb(value: vec3f) -> vec3f {
  return vec3f(
    linear_to_srgb_channel(value.r),
    linear_to_srgb_channel(value.g),
    linear_to_srgb_channel(value.b),
  );
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  let linear_premultiplied = sample_bilinear(tile_texture, input.uv);
  let alpha = clamp(linear_premultiplied.a, 0.0, 1.0);
  let straight_linear = select(
    vec3f(0.0),
    linear_premultiplied.rgb / max(alpha, 0.000001),
    alpha > 0.0,
  );
  let encoded = linear_to_srgb(straight_linear);
  return vec4f(encoded * alpha, alpha);
}
`;

export interface StudioTileDocWebGpuCompositeConsumerOptions {
  readonly canvas: HTMLCanvasElement;
  /** Explicit GPU override is an isolated test/diagnostic lane. Product callers use the fabric. */
  readonly gpu?: GPU | null;
  /** Test seam for the shared-device broker. Omit in product code. */
  readonly acquireDevice?: typeof acquireStudioGpuDevice;
  readonly maxRetainedEntries?: number;
  readonly maxRetainedBytes?: number;
  readonly maxFrameUploadBytes?: number;
  readonly maxUploadPoolEntries?: number;
  readonly maxUploadPoolBytes?: number;
  readonly maxSourceCacheEntries?: number;
  readonly maxSourceCacheBytes?: number;
  readonly maxStackEntries?: number;
  readonly onDeviceLost?: (info: GPUDeviceLostInfo) => void;
}

export interface StudioTileDocWebGpuCompositeConsumerStats {
  readonly active: boolean;
  readonly disposed: boolean;
  readonly deviceGeneration: number;
  readonly retainedEntries: number;
  readonly retainedBytes: number;
  readonly uploadPoolEntries: number;
  readonly uploadPoolBytes: number;
  readonly activeUploadBytes: number;
  readonly sourceCacheEntries: number;
  readonly sourceCacheBytes: number;
  readonly sourceCacheHits: number;
  readonly sourceCacheMisses: number;
  readonly sourceCacheEvictions: number;
  readonly retainedCacheHits: number;
  readonly retainedCacheMisses: number;
  readonly retainedCacheEvictions: number;
  readonly compositeCacheReuses: number;
  readonly sourceUploadCount: number;
  readonly sourcePayloadBytesUploaded: number;
  readonly physicalBytesUploaded: number;
  readonly presentedFrames: number;
  readonly presentationDraws: number;
  readonly hotPathReadbackCount: 0;
  readonly validationReadbackCount: number;
  readonly validationReadbackBytes: number;
  readonly trackedGpuBytes: number;
  readonly peakTrackedGpuBytes: number;
  readonly deviceOwnership: "none" | "isolated-override" | "studio-gpu-fabric";
  readonly deviceEpoch: number;
}

export interface StudioTileDocWebGpuValidationReadback {
  readonly tileId: string;
  readonly width: number;
  readonly height: number;
  readonly format: typeof STUDIO_TILEDOC_WEBGPU_COMPOSITE_TEXTURE_FORMAT;
  readonly bytesPerRow: number;
  readonly bytes: Uint8Array;
}

export type StudioTileDocWebGpuCompositePlanFailureReason =
  | "dirty-contract"
  | "duplicate-dirty-tile"
  | "duplicate-visible-tile"
  | "frame-upload-limit"
  | "invalid-frame"
  | "stack-entry-limit"
  | "unsupported-blend-mode"
  | "visible-contract";

export interface StudioTileDocWebGpuPresentationDraw {
  readonly tileId: string;
  readonly firstVertex: number;
  readonly vertexCount: 6;
}

export interface StudioTileDocWebGpuCompositePlan {
  readonly status: "ready";
  readonly frame: StudioTileDocWebGpuFrame;
  readonly uploadBytes: number;
  readonly stackEntryCount: number;
  readonly presentationVertices: Float32Array;
  readonly presentationDraws: readonly StudioTileDocWebGpuPresentationDraw[];
}

export interface StudioTileDocWebGpuCompositeRejectedPlan {
  readonly status: "rejected";
  readonly reason: StudioTileDocWebGpuCompositePlanFailureReason;
  readonly tileId?: string;
  readonly layerId?: string;
}

export type StudioTileDocWebGpuCompositePlanResult =
  | StudioTileDocWebGpuCompositePlan
  | StudioTileDocWebGpuCompositeRejectedPlan;

interface NormalizedOptions {
  readonly maxRetainedEntries: number;
  readonly maxRetainedBytes: number;
  readonly maxFrameUploadBytes: number;
  readonly maxUploadPoolEntries: number;
  readonly maxUploadPoolBytes: number;
  readonly maxSourceCacheEntries: number;
  readonly maxSourceCacheBytes: number;
  readonly maxStackEntries: number;
}

interface RetainedTile {
  readonly id: string;
  readonly textures: readonly [GPUTexture, GPUTexture];
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
  finalTextureIndex: 0 | 1;
  contentKey: string | null;
  lastUsed: number;
}

interface UploadPoolTexture {
  readonly texture: GPUTexture;
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
}

interface SourceCacheTexture extends UploadPoolTexture {
  readonly key: string;
  readonly bufferIdentity: string;
  lastUsed: number;
}

interface GpuState {
  readonly generation: number;
  readonly device: GPUDevice;
  readonly context: GPUCanvasContext;
  readonly canvasFormat: GPUTextureFormat;
  readonly compositePipeline: GPURenderPipeline;
  readonly presentationPipeline: GPURenderPipeline;
  readonly compositeBindGroupLayout: GPUBindGroupLayout;
  readonly presentationBindGroupLayout: GPUBindGroupLayout;
  readonly ownership: "isolated-override" | "studio-gpu-fabric";
  readonly lease: StudioGpuDeviceLease | null;
}

interface DocumentContract {
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly tileSize: number;
}

interface ActiveUpload {
  readonly key: string;
  readonly source: StudioTileDocWebGpuSourceSnapshot;
  readonly pooled: UploadPoolTexture;
  readonly retained: boolean;
}

function safePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) return 0;
  return value;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finiteSafeMagnitude(value: unknown): value is number {
  return finite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
}

function validRect(rect: StudioTileDocWebGpuVisibleTile["rect"]): boolean {
  return finiteSafeMagnitude(rect.x)
    && finiteSafeMagnitude(rect.y)
    && finiteSafeMagnitude(rect.width)
    && finiteSafeMagnitude(rect.height)
    && rect.width > 0
    && rect.height > 0;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function validTileIdentity(
  tile: Pick<StudioTileDocWebGpuVisibleTile, "id" | "column" | "row" | "rect">
): boolean {
  return typeof tile.id === "string"
    && tile.id === `${tile.column}:${tile.row}`
    && Number.isSafeInteger(tile.column)
    && Number.isSafeInteger(tile.row)
    && validRect(tile.rect);
}

function validTileGeometry(
  tile: Pick<StudioTileDocWebGpuVisibleTile, "id" | "column" | "row" | "rect">,
  frame: StudioTileDocWebGpuFrame
): boolean {
  if (!validTileIdentity(tile) || tile.column < 0 || tile.row < 0) return false;
  const x = tile.column * frame.tileSize;
  const y = tile.row * frame.tileSize;
  if (
    !Number.isSafeInteger(x)
    || !Number.isSafeInteger(y)
    || x >= frame.documentWidth
    || y >= frame.documentHeight
  ) {
    return false;
  }
  return Object.is(tile.rect.x, x)
    && Object.is(tile.rect.y, y)
    && Object.is(tile.rect.width, Math.min(frame.tileSize, frame.documentWidth - x))
    && Object.is(tile.rect.height, Math.min(frame.tileSize, frame.documentHeight - y));
}

function sameRect(
  left: StudioTileDocWebGpuVisibleTile["rect"],
  right: StudioTileDocWebGpuVisibleTile["rect"]
): boolean {
  return Object.is(left.x, right.x)
    && Object.is(left.y, right.y)
    && Object.is(left.width, right.width)
    && Object.is(left.height, right.height);
}

function sourceKey(source: StudioTileDocWebGpuSourceSnapshot): string {
  return `${source.bufferId}:${source.contentRevision}`;
}

function sourceBufferIdentity(source: StudioTileDocWebGpuSourceSnapshot): string {
  return String(source.bufferId);
}

function compositeContentKey(tile: StudioTileDocWebGpuFrame["dirtyTiles"][number]): string {
  return tile.action === "clear"
    ? "clear"
    : tile.stack.map((source) => [
        source.layerId,
        source.bufferId,
        source.contentRevision,
        source.opacity,
        source.blendMode,
      ].join("\u001f")).join("\u001e");
}

function blendModeCode(mode: string): number | null {
  return BLEND_MODE_CODES.get(mode as StudioTileDocWebGpuBlendMode) ?? null;
}

function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function exactFrameRevision(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function validSource(
  source: StudioTileDocWebGpuSourceSnapshot,
  tileSize: number
): boolean {
  const expectedBytes = tileSize * tileSize * STUDIO_TILEDOC_WEBGPU_SOURCE_BYTES_PER_PIXEL;
  return typeof source.layerId === "string"
    && source.layerId.length > 0
    && Number.isSafeInteger(source.bufferId)
    && source.bufferId > 0
    && Number.isSafeInteger(source.contentRevision)
    && source.contentRevision >= 0
    && finite(source.opacity)
    && source.opacity >= 0
    && source.opacity <= 1
    && blendModeCode(source.blendMode) !== null
    && source.pixelWidth === tileSize
    && source.pixelHeight === tileSize
    && source.byteLength === expectedBytes
    && source.rgba instanceof Uint8ClampedArray
    && source.rgba.byteLength === expectedBytes;
}

function validFrameHeader(frame: StudioTileDocWebGpuFrame): boolean {
  return frame.kind === "studio-tiledoc-webgpu-frame"
    && exactFrameRevision(frame.requestSequence)
    && exactFrameRevision(frame.expectedPresentationRevision)
    && exactFrameRevision(frame.expectedContentRevision)
    && exactFrameRevision(frame.plannerFrameSequence)
    && exactFrameRevision(frame.plannerVisualRevision)
    && typeof frame.scopeId === "string"
    && frame.scopeId.length > 0
    && frame.scopeId.length <= 1_024
    && Number.isSafeInteger(frame.documentWidth)
    && frame.documentWidth > 0
    && Number.isSafeInteger(frame.documentHeight)
    && frame.documentHeight > 0
    && Number.isSafeInteger(frame.tileSize)
    && frame.tileSize > 0
    && finiteSafeMagnitude(frame.viewport.x)
    && finiteSafeMagnitude(frame.viewport.y)
    && finiteSafeMagnitude(frame.viewport.width)
    && finiteSafeMagnitude(frame.viewport.height)
    && frame.viewport.width >= 0
    && frame.viewport.height >= 0
    && Array.isArray(frame.visibleTiles)
    && Array.isArray(frame.visibleTileIds)
    && Array.isArray(frame.dirtyTiles)
    && Array.isArray(frame.dirtyTileIds);
}

function logicalToNdcX(x: number, frame: StudioTileDocWebGpuFrame): number {
  return (x - frame.viewport.x) / frame.viewport.width * 2 - 1;
}

function logicalToNdcY(y: number, frame: StudioTileDocWebGpuFrame): number {
  return 1 - (y - frame.viewport.y) / frame.viewport.height * 2;
}

/** Builds a full visible draw plan while preserving dirty work as a separate frame contract. */
export function planStudioTileDocWebGpuCompositeFrame(
  frame: StudioTileDocWebGpuFrame,
  options: {
    readonly maxFrameUploadBytes?: number;
    readonly maxStackEntries?: number;
  } = {}
): StudioTileDocWebGpuCompositePlanResult {
  if (!frame || typeof frame !== "object" || !validFrameHeader(frame)) {
    return { status: "rejected", reason: "invalid-frame" };
  }
  const maxFrameUploadBytes = safePositiveInteger(
    options.maxFrameUploadBytes,
    STUDIO_TILEDOC_WEBGPU_DEFAULT_MAX_FRAME_UPLOAD_BYTES
  );
  const maxStackEntries = safePositiveInteger(
    options.maxStackEntries,
    STUDIO_TILEDOC_WEBGPU_DEFAULT_MAX_STACK_ENTRIES
  );
  if (maxFrameUploadBytes === 0 || maxStackEntries === 0) {
    return { status: "rejected", reason: "invalid-frame" };
  }

  const visibleIds = new Set<string>();
  const visibleById = new Map<string, StudioTileDocWebGpuVisibleTile>();
  for (const tile of frame.visibleTiles) {
    if (!validTileGeometry(tile, frame) || !Number.isSafeInteger(tile.stackDepth) || tile.stackDepth <= 0) {
      return { status: "rejected", reason: "visible-contract", tileId: tile.id };
    }
    if (visibleIds.has(tile.id)) {
      return { status: "rejected", reason: "duplicate-visible-tile", tileId: tile.id };
    }
    visibleIds.add(tile.id);
    visibleById.set(tile.id, tile);
  }
  if (!sameStrings(frame.visibleTileIds, frame.visibleTiles.map((tile) => tile.id))) {
    return { status: "rejected", reason: "visible-contract" };
  }

  const dirtyIds = new Set<string>();
  const uniqueSources = new Map<string, StudioTileDocWebGpuSourceSnapshot>();
  let stackEntryCount = 0;
  let uploadBytes = 0;
  for (const tile of frame.dirtyTiles) {
    if (!validTileGeometry(tile, frame)) {
      return { status: "rejected", reason: "dirty-contract", tileId: tile.id };
    }
    if (dirtyIds.has(tile.id)) {
      return { status: "rejected", reason: "duplicate-dirty-tile", tileId: tile.id };
    }
    dirtyIds.add(tile.id);
    if (
      (tile.action === "clear" && tile.stack.length !== 0)
      || (tile.action === "composite" && tile.stack.length === 0)
      || (tile.action !== "clear" && tile.action !== "composite")
    ) {
      return { status: "rejected", reason: "dirty-contract", tileId: tile.id };
    }
    const visible = visibleById.get(tile.id);
    if (
      (tile.action === "clear" && visible !== undefined)
      || (
        tile.action === "composite"
        && (
          !visible
          || visible.stackDepth !== tile.stack.length
          || !sameRect(visible.rect, tile.rect)
        )
      )
    ) {
      return { status: "rejected", reason: "dirty-contract", tileId: tile.id };
    }
    stackEntryCount += tile.stack.length;
    if (stackEntryCount > maxStackEntries) {
      return { status: "rejected", reason: "stack-entry-limit", tileId: tile.id };
    }
    for (const source of tile.stack) {
      if (!validSource(source, frame.tileSize)) {
        return {
          status: "rejected",
          reason: blendModeCode(source.blendMode) === null
            ? "unsupported-blend-mode"
            : "dirty-contract",
          tileId: tile.id,
          layerId: source.layerId,
        };
      }
      const key = sourceKey(source);
      const existing = uniqueSources.get(key);
      if (existing && existing.rgba !== source.rgba) {
        return {
          status: "rejected",
          reason: "dirty-contract",
          tileId: tile.id,
          layerId: source.layerId,
        };
      }
      if (!existing) {
        uniqueSources.set(key, source);
        uploadBytes += source.byteLength;
        if (uploadBytes > maxFrameUploadBytes) {
          return {
            status: "rejected",
            reason: "frame-upload-limit",
            tileId: tile.id,
            layerId: source.layerId,
          };
        }
      }
    }
  }
  if (!sameStrings(frame.dirtyTileIds, frame.dirtyTiles.map((tile) => tile.id))) {
    return { status: "rejected", reason: "dirty-contract" };
  }
  if (uploadBytes !== frame.snapshotBytes) {
    return { status: "rejected", reason: "dirty-contract" };
  }

  if (
    (frame.viewport.width === 0 || frame.viewport.height === 0)
    && frame.visibleTiles.length > 0
  ) {
    return { status: "rejected", reason: "visible-contract" };
  }
  const vertices = new Float32Array(
    frame.visibleTiles.length * 6 * PRESENTATION_VERTEX_FLOATS
  );
  const corners = [
    [0, 0], [1, 0], [0, 1],
    [0, 1], [1, 0], [1, 1],
  ] as const;
  const draws: StudioTileDocWebGpuPresentationDraw[] = [];
  for (let tileIndex = 0; tileIndex < frame.visibleTiles.length; tileIndex += 1) {
    const tile = frame.visibleTiles[tileIndex]!;
    const maximumU = tile.rect.width / frame.tileSize;
    const maximumV = tile.rect.height / frame.tileSize;
    for (let cornerIndex = 0; cornerIndex < corners.length; cornerIndex += 1) {
      const [horizontal, vertical] = corners[cornerIndex]!;
      const offset = (tileIndex * corners.length + cornerIndex) * PRESENTATION_VERTEX_FLOATS;
      vertices[offset] = logicalToNdcX(
        tile.rect.x + tile.rect.width * horizontal,
        frame
      );
      vertices[offset + 1] = logicalToNdcY(
        tile.rect.y + tile.rect.height * vertical,
        frame
      );
      vertices[offset + 2] = maximumU * horizontal;
      vertices[offset + 3] = maximumV * vertical;
    }
    draws.push(Object.freeze({
      tileId: tile.id,
      firstVertex: tileIndex * 6,
      vertexCount: 6,
    }));
  }

  return Object.freeze({
    status: "ready",
    frame,
    uploadBytes,
    stackEntryCount,
    presentationVertices: vertices,
    presentationDraws: Object.freeze(draws),
  });
}

export interface StudioTileDocPackedUpload {
  readonly bytes: Uint8Array;
  readonly bytesPerRow: number;
  readonly rowsPerImage: number;
}

function straightSrgbByte(premultiplied: number, alpha: number): number {
  if (alpha <= 0) return 0;
  if (alpha >= 255) return premultiplied;
  return Math.min(255, Math.round(premultiplied * 255 / alpha));
}

/**
 * Converts the store's premultiplied sRGB bytes to straight sRGB while packing aligned upload rows.
 *
 * `rgba8unorm-srgb` performs its transfer-function decode before the composite shader runs. Feeding
 * it premultiplied bytes would therefore make the shader multiply colour by coverage a second time:
 * a committed C·A pixel would become approximately C·A². Restoring straight colour before upload
 * keeps live RGBA16F strokes and committed tile snapshots on the same source-over contract. Alpha is
 * copied exactly, including destination-out results; fully erased pixels have hidden RGB cleared.
 */
export function packStudioTileDocWebGpuUpload(
  source: StudioTileDocWebGpuSourceSnapshot,
  scratch?: Uint8Array
): StudioTileDocPackedUpload {
  const bytesPerRow = source.pixelWidth * STUDIO_TILEDOC_WEBGPU_SOURCE_BYTES_PER_PIXEL;
  const uploadBytesPerRow = alignTo(bytesPerRow, STUDIO_TILEDOC_WEBGPU_UPLOAD_ROW_ALIGNMENT);
  const requiredBytes = uploadBytesPerRow * source.pixelHeight;
  const bytes = scratch && scratch.byteLength >= requiredBytes
    ? scratch.subarray(0, requiredBytes)
    : new Uint8Array(requiredBytes);
  bytes.fill(0);
  for (let row = 0; row < source.pixelHeight; row += 1) {
    const sourceOffset = row * bytesPerRow;
    const uploadOffset = row * uploadBytesPerRow;
    for (let column = 0; column < source.pixelWidth; column += 1) {
      const sourcePixel = sourceOffset + column * 4;
      const uploadPixel = uploadOffset + column * 4;
      const alpha = source.rgba[sourcePixel + 3]!;
      bytes[uploadPixel] = straightSrgbByte(source.rgba[sourcePixel]!, alpha);
      bytes[uploadPixel + 1] = straightSrgbByte(
        source.rgba[sourcePixel + 1]!,
        alpha
      );
      bytes[uploadPixel + 2] = straightSrgbByte(
        source.rgba[sourcePixel + 2]!,
        alpha
      );
      bytes[uploadPixel + 3] = alpha;
    }
  }
  return {
    bytes,
    bytesPerRow: uploadBytesPerRow,
    rowsPerImage: source.pixelHeight,
  };
}

function safeDestroyTexture(texture: GPUTexture): void {
  try {
    texture.destroy();
  } catch {
    // A lost device may have invalidated it already.
  }
}

function safeDestroyBuffer(buffer: GPUBuffer | null): void {
  if (!buffer) return;
  try {
    buffer.destroy();
  } catch {
    // A lost device may have invalidated it already.
  }
}

function safeDestroyDevice(device: GPUDevice | null): void {
  if (!device) return;
  try {
    device.destroy();
  } catch {
    // Best-effort teardown.
  }
}

function safeUnconfigure(context: GPUCanvasContext | null): void {
  if (!context || typeof context.unconfigure !== "function") return;
  try {
    context.unconfigure();
  } catch {
    // A detached canvas may already be unconfigured.
  }
}

function abortReason(signal: AbortSignal): StudioTileDocWebGpuConsumerResult {
  return {
    status: "rejected",
    reason: signal.aborted ? "aborted" : "presentation-failed",
  };
}

/**
 * Actual retained WebGPU consumer. The bridge serializes calls, but this class also rejects direct
 * concurrent use so queue submissions and upload-pool ownership remain deterministic.
 */
export class StudioTileDocWebGpuCompositeConsumer implements StudioTileDocWebGpuConsumer {
  public readonly supportedBlendModes = STUDIO_TILEDOC_WEBGPU_SUPPORTED_BLEND_MODES;

  private readonly canvas: HTMLCanvasElement;
  private readonly gpuOverride: GPU | null | undefined;
  private readonly acquireDevice: typeof acquireStudioGpuDevice;
  private readonly options: NormalizedOptions;
  private readonly onDeviceLost: ((info: GPUDeviceLostInfo) => void) | undefined;
  private readonly retainedTiles = new Map<string, RetainedTile>();
  private readonly uploadPool: UploadPoolTexture[] = [];
  private readonly sourceCache = new Map<string, SourceCacheTexture>();

  private state: GpuState | null = null;
  private initialization: Promise<GpuState | null> | null = null;
  private contract: DocumentContract | null = null;
  private uploadScratch: Uint8Array | null = null;
  private retainedBytes = 0;
  private uploadPoolBytes = 0;
  private activeUploadBytes = 0;
  private sourceCacheBytes = 0;
  private sequence = 0;
  private generation = 0;
  private active = false;
  private disposed = false;
  private sourceCacheHits = 0;
  private sourceCacheMisses = 0;
  private sourceCacheEvictions = 0;
  private retainedCacheHits = 0;
  private retainedCacheMisses = 0;
  private retainedCacheEvictions = 0;
  private compositeCacheReuses = 0;
  private sourceUploadCount = 0;
  private sourcePayloadBytesUploaded = 0;
  private physicalBytesUploaded = 0;
  private presentedFrames = 0;
  private presentationDraws = 0;
  private validationReadbackCount = 0;
  private validationReadbackBytes = 0;
  private peakTrackedGpuBytes = 0;

  public constructor(options: StudioTileDocWebGpuCompositeConsumerOptions) {
    this.canvas = options.canvas;
    this.gpuOverride = options.gpu;
    this.acquireDevice = options.acquireDevice ?? acquireStudioGpuDevice;
    this.onDeviceLost = options.onDeviceLost;
    this.options = Object.freeze({
      maxRetainedEntries: safePositiveInteger(
        options.maxRetainedEntries,
        STUDIO_TILEDOC_WEBGPU_DEFAULT_MAX_RETAINED_ENTRIES
      ),
      maxRetainedBytes: safePositiveInteger(
        options.maxRetainedBytes,
        STUDIO_TILEDOC_WEBGPU_DEFAULT_MAX_RETAINED_BYTES
      ),
      maxFrameUploadBytes: safePositiveInteger(
        options.maxFrameUploadBytes,
        STUDIO_TILEDOC_WEBGPU_DEFAULT_MAX_FRAME_UPLOAD_BYTES
      ),
      maxUploadPoolEntries: safePositiveInteger(
        options.maxUploadPoolEntries,
        STUDIO_TILEDOC_WEBGPU_DEFAULT_MAX_UPLOAD_POOL_ENTRIES
      ),
      maxUploadPoolBytes: safePositiveInteger(
        options.maxUploadPoolBytes,
        STUDIO_TILEDOC_WEBGPU_DEFAULT_MAX_UPLOAD_POOL_BYTES
      ),
      maxSourceCacheEntries: safePositiveInteger(
        options.maxSourceCacheEntries,
        STUDIO_TILEDOC_WEBGPU_DEFAULT_MAX_SOURCE_CACHE_ENTRIES
      ),
      maxSourceCacheBytes: safePositiveInteger(
        options.maxSourceCacheBytes,
        STUDIO_TILEDOC_WEBGPU_DEFAULT_MAX_SOURCE_CACHE_BYTES
      ),
      maxStackEntries: safePositiveInteger(
        options.maxStackEntries,
        STUDIO_TILEDOC_WEBGPU_DEFAULT_MAX_STACK_ENTRIES
      ),
    });
  }

  public stats(): StudioTileDocWebGpuCompositeConsumerStats {
    const state = this.state;
    return Object.freeze({
      active: this.active,
      disposed: this.disposed,
      deviceGeneration: state?.generation ?? this.generation,
      retainedEntries: this.retainedTiles.size,
      retainedBytes: this.retainedBytes,
      uploadPoolEntries: this.uploadPool.length,
      uploadPoolBytes: this.uploadPoolBytes,
      activeUploadBytes: this.activeUploadBytes,
      sourceCacheEntries: this.sourceCache.size,
      sourceCacheBytes: this.sourceCacheBytes,
      sourceCacheHits: this.sourceCacheHits,
      sourceCacheMisses: this.sourceCacheMisses,
      sourceCacheEvictions: this.sourceCacheEvictions,
      retainedCacheHits: this.retainedCacheHits,
      retainedCacheMisses: this.retainedCacheMisses,
      retainedCacheEvictions: this.retainedCacheEvictions,
      compositeCacheReuses: this.compositeCacheReuses,
      sourceUploadCount: this.sourceUploadCount,
      sourcePayloadBytesUploaded: this.sourcePayloadBytesUploaded,
      physicalBytesUploaded: this.physicalBytesUploaded,
      presentedFrames: this.presentedFrames,
      presentationDraws: this.presentationDraws,
      hotPathReadbackCount: 0,
      validationReadbackCount: this.validationReadbackCount,
      validationReadbackBytes: this.validationReadbackBytes,
      trackedGpuBytes: this.trackedGpuBytes(),
      peakTrackedGpuBytes: this.peakTrackedGpuBytes,
      deviceOwnership: state?.ownership ?? "none",
      deviceEpoch: state?.lease?.epoch ?? 0,
    });
  }

  /**
   * Explicit quality-lab seam. It is intentionally absent from `present()` and therefore cannot
   * enter pan/zoom/edit/reorder timing. Callers must wait for an idle completed frame.
   */
  public async readbackRetainedTileForValidation(
    tileId: string
  ): Promise<StudioTileDocWebGpuValidationReadback | null> {
    if (this.disposed || this.active || tileId.length === 0) return null;
    const state = this.state;
    const retained = this.retainedTiles.get(tileId);
    if (!state || !retained || typeof state.device.queue.onSubmittedWorkDone !== "function") {
      return null;
    }
    const bytesPerRow = alignTo(
      retained.width * STUDIO_TILEDOC_WEBGPU_COMPOSITE_BYTES_PER_PIXEL,
      STUDIO_TILEDOC_WEBGPU_UPLOAD_ROW_ALIGNMENT
    );
    const byteLength = bytesPerRow * retained.height;
    let buffer: GPUBuffer | null = null;
    try {
      buffer = state.device.createBuffer({
        label: `Studio tiledoc validation readback ${tileId}`,
        size: byteLength,
        usage: GPU_BUFFER_MAP_READ | GPU_BUFFER_COPY_DST,
      });
      const encoder = state.device.createCommandEncoder({
        label: `Studio tiledoc validation readback ${tileId}`,
      });
      encoder.copyTextureToBuffer(
        { texture: retained.textures[retained.finalTextureIndex] },
        { buffer, offset: 0, bytesPerRow, rowsPerImage: retained.height },
        { width: retained.width, height: retained.height, depthOrArrayLayers: 1 }
      );
      state.device.queue.submit([encoder.finish()]);
      await state.device.queue.onSubmittedWorkDone();
      if (this.state !== state || this.disposed) return null;
      await buffer.mapAsync(GPU_MAP_MODE_READ);
      const bytes = new Uint8Array(buffer.getMappedRange()).slice();
      buffer.unmap();
      this.validationReadbackCount += 1;
      this.validationReadbackBytes += bytes.byteLength;
      return Object.freeze({
        tileId,
        width: retained.width,
        height: retained.height,
        format: STUDIO_TILEDOC_WEBGPU_COMPOSITE_TEXTURE_FORMAT,
        bytesPerRow,
        bytes,
      });
    } catch {
      return null;
    } finally {
      safeDestroyBuffer(buffer);
    }
  }

  /** Clears retained tile textures but keeps the healthy device and pipelines. */
  public invalidate(): void {
    this.releaseRetainedTiles();
    this.releaseSourceCache();
    this.contract = null;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseRetainedTiles();
    this.releaseUploadPool();
    this.releaseSourceCache();
    this.uploadScratch = null;
    const state = this.state;
    this.state = null;
    this.initialization = null;
    safeUnconfigure(state?.context ?? null);
    this.releaseDeviceState(state);
  }

  public async present(
    frame: StudioTileDocWebGpuFrame,
    signal: AbortSignal
  ): Promise<StudioTileDocWebGpuConsumerResult> {
    if (this.disposed) return { status: "rejected", reason: "disposed" };
    if (this.active) return { status: "rejected", reason: "busy" };
    if (signal.aborted) return { status: "rejected", reason: "aborted" };
    if (Object.values(this.options).some((value) => value === 0)) {
      return { status: "rejected", reason: "invalid-configuration" };
    }
    const plan = planStudioTileDocWebGpuCompositeFrame(frame, {
      maxFrameUploadBytes: this.options.maxFrameUploadBytes,
      maxStackEntries: this.options.maxStackEntries,
    });
    if (plan.status === "rejected") {
      return { status: "rejected", reason: plan.reason };
    }
    if (!this.acceptDocumentContract(frame)) {
      return { status: "rejected", reason: "document-contract-changed" };
    }

    this.active = true;
    try {
      const state = await this.ensureState();
      if (!state || this.disposed || signal.aborted) {
        return signal.aborted
          ? { status: "rejected", reason: "aborted" }
          : { status: "rejected", reason: this.disposed ? "disposed" : "webgpu-unavailable" };
      }
      if (!this.validCanvas(state)) {
        return { status: "rejected", reason: "invalid-canvas" };
      }
      return await this.executePlan(plan, state, signal);
    } catch {
      return abortReason(signal);
    } finally {
      this.active = false;
    }
  }

  private acceptDocumentContract(frame: StudioTileDocWebGpuFrame): boolean {
    const next = {
      documentWidth: frame.documentWidth,
      documentHeight: frame.documentHeight,
      tileSize: frame.tileSize,
    };
    if (!this.contract) {
      this.contract = next;
      return true;
    }
    return Object.is(this.contract.documentWidth, next.documentWidth)
      && Object.is(this.contract.documentHeight, next.documentHeight)
      && this.contract.tileSize === next.tileSize;
  }

  private async ensureState(): Promise<GpuState | null> {
    if (this.state) return this.state;
    if (this.initialization) return this.initialization;
    this.initialization = this.initialize();
    try {
      return await this.initialization;
    } finally {
      this.initialization = null;
    }
  }

  private preferredCanvasFormat(): GPUTextureFormat {
    const gpu = this.gpuOverride ?? (
      typeof navigator === "undefined" ? null : navigator.gpu ?? null
    );
    try {
      return gpu?.getPreferredCanvasFormat() ?? "bgra8unorm";
    } catch {
      return "bgra8unorm";
    }
  }

  private async initialize(): Promise<GpuState | null> {
    let device: GPUDevice | null = null;
    let lease: StudioGpuDeviceLease | null = null;
    let ownership: GpuState["ownership"] = "isolated-override";
    let context: GPUCanvasContext | null = null;
    try {
      let generation: number;
      if (this.gpuOverride === undefined) {
        lease = await this.acquireDevice();
        if (!lease || lease.lost || this.disposed) {
          lease?.release();
          return null;
        }
        ownership = "studio-gpu-fabric";
        device = lease.device;
        generation = lease.epoch;
      } else {
        const gpu = this.gpuOverride;
        if (!gpu) return null;
        const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
        if (!adapter || this.disposed) return null;
        device = await adapter.requestDevice();
        if (this.generation >= Number.MAX_SAFE_INTEGER) {
          safeDestroyDevice(device);
          return null;
        }
        generation = this.generation + 1;
      }
      if (this.disposed) {
        if (lease) lease.release();
        else safeDestroyDevice(device);
        return null;
      }
      const candidate = this.canvas.getContext("webgpu");
      context = candidate && "configure" in candidate ? candidate as GPUCanvasContext : null;
      if (!context) {
        if (lease) lease.release();
        else safeDestroyDevice(device);
        return null;
      }
      const canvasFormat = this.preferredCanvasFormat();
      const compositeBindGroupLayout = device.createBindGroupLayout({
        label: "Studio tiledoc composite bindings",
        entries: [
          {
            binding: 0,
            visibility: 0x02,
            texture: { sampleType: "unfilterable-float", viewDimension: "2d" },
          },
          {
            binding: 1,
            visibility: 0x02,
            texture: { sampleType: "float", viewDimension: "2d" },
          },
          {
            binding: 2,
            visibility: 0x02,
            buffer: {
              type: "uniform",
              hasDynamicOffset: true,
              minBindingSize: COMPOSITE_PARAMETER_BYTES,
            },
          },
        ],
      });
      const presentationBindGroupLayout = device.createBindGroupLayout({
        label: "Studio tiledoc presentation bindings",
        entries: [{
          binding: 0,
          visibility: 0x02,
          texture: { sampleType: "unfilterable-float", viewDimension: "2d" },
        }],
      });
      const compositeModule = device.createShaderModule({
        label: "Studio tiledoc linear composite shader",
        code: COMPOSITE_SHADER,
      });
      const presentationModule = device.createShaderModule({
        label: "Studio tiledoc presentation shader",
        code: PRESENTATION_SHADER,
      });
      const compositePipeline = device.createRenderPipeline({
        label: "Studio tiledoc rgba16float composite pipeline",
        layout: device.createPipelineLayout({
          label: "Studio tiledoc composite pipeline layout",
          bindGroupLayouts: [compositeBindGroupLayout],
        }),
        vertex: { module: compositeModule, entryPoint: "vs_main" },
        fragment: {
          module: compositeModule,
          entryPoint: "fs_main",
          targets: [{ format: STUDIO_TILEDOC_WEBGPU_COMPOSITE_TEXTURE_FORMAT }],
        },
        primitive: { topology: "triangle-list" },
      });
      const presentationPipeline = device.createRenderPipeline({
        label: "Studio tiledoc presentation pipeline",
        layout: device.createPipelineLayout({
          label: "Studio tiledoc presentation pipeline layout",
          bindGroupLayouts: [presentationBindGroupLayout],
        }),
        vertex: {
          module: presentationModule,
          entryPoint: "vs_main",
          buffers: [{
            arrayStride: PRESENTATION_VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT,
            stepMode: "vertex",
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x2" },
              { shaderLocation: 1, offset: 8, format: "float32x2" },
            ],
          }],
        },
        fragment: {
          module: presentationModule,
          entryPoint: "fs_main",
          targets: [{ format: canvasFormat }],
        },
        primitive: { topology: "triangle-list" },
      });
      context.configure({
        device,
        format: canvasFormat,
        alphaMode: "premultiplied",
        colorSpace: "srgb",
      });
      const state: GpuState = {
        generation,
        device,
        context,
        canvasFormat,
        compositePipeline,
        presentationPipeline,
        compositeBindGroupLayout,
        presentationBindGroupLayout,
        ownership,
        lease,
      };
      this.generation = generation;
      this.state = state;
      void device.lost.then((info) => this.handleDeviceLost(state, info));
      return state;
    } catch {
      safeUnconfigure(context);
      if (lease) lease.release();
      else safeDestroyDevice(device);
      return null;
    }
  }

  private validCanvas(state: GpuState): boolean {
    const maxDimension = Number(state.device.limits.maxTextureDimension2D);
    return Number.isSafeInteger(this.canvas.width)
      && Number.isSafeInteger(this.canvas.height)
      && this.canvas.width > 0
      && this.canvas.height > 0
      && this.canvas.width <= maxDimension
      && this.canvas.height <= maxDimension;
  }

  private handleDeviceLost(state: GpuState, info: GPUDeviceLostInfo): void {
    if (this.state !== state) return;
    this.state = null;
    this.releaseRetainedTiles();
    this.releaseUploadPool();
    this.releaseSourceCache();
    this.uploadScratch = null;
    safeUnconfigure(state.context);
    state.lease?.release();
    this.onDeviceLost?.(info);
  }

  private async executePlan(
    plan: StudioTileDocWebGpuCompositePlan,
    state: GpuState,
    signal: AbortSignal
  ): Promise<StudioTileDocWebGpuConsumerResult> {
    const frame = plan.frame;
    for (const tileId of frame.visibleTileIds) {
      if (this.retainedTiles.has(tileId)) this.retainedCacheHits += 1;
      else this.retainedCacheMisses += 1;
    }
    const protectedIds = new Set([
      ...frame.visibleTileIds,
      ...frame.dirtyTiles
        .filter((tile) => tile.action === "composite")
        .map((tile) => tile.id),
    ]);
    for (const tile of frame.dirtyTiles) {
      if (tile.action === "clear") this.releaseRetainedTile(tile.id);
    }
    for (const tile of frame.dirtyTiles) {
      if (
        tile.action === "composite"
        && !this.ensureRetainedTile(state, tile.id, frame.tileSize, protectedIds)
      ) {
        return { status: "rejected", reason: "retained-texture-budget" };
      }
    }
    for (const tileId of frame.visibleTileIds) {
      if (!this.retainedTiles.has(tileId)) {
        return { status: "rejected", reason: "missing-visible-tile" };
      }
    }
    if (signal.aborted) return { status: "rejected", reason: "aborted" };

    const tilesToComposite = frame.dirtyTiles.filter((tile) => {
      if (tile.action !== "composite") return false;
      const retained = this.retainedTiles.get(tile.id);
      if (retained?.contentKey === compositeContentKey(tile)) {
        this.compositeCacheReuses += 1;
        return false;
      }
      return true;
    });
    const executionFrame: StudioTileDocWebGpuFrame = Object.freeze({
      ...frame,
      dirtyTiles: Object.freeze(tilesToComposite),
      dirtyTileIds: Object.freeze(tilesToComposite.map((tile) => tile.id)),
    });
    const uniqueSources = new Map<string, StudioTileDocWebGpuSourceSnapshot>();
    let stackEntryCount = 0;
    for (const tile of tilesToComposite) {
      stackEntryCount += tile.stack.length;
      for (const source of tile.stack) uniqueSources.set(sourceKey(source), source);
    }
    const executionPlan: StudioTileDocWebGpuCompositePlan = Object.freeze({
      ...plan,
      frame: executionFrame,
      uploadBytes: [...uniqueSources.values()]
        .reduce((total, source) => total + source.byteLength, 0),
      stackEntryCount,
    });

    const uploads = this.acquireAndUploadSources(executionPlan, state);
    if (!uploads) return { status: "rejected", reason: "upload-texture-failed" };
    const uniformAlignment = Math.max(
      MIN_DYNAMIC_UNIFORM_ALIGNMENT,
      Number(state.device.limits.minUniformBufferOffsetAlignment ?? 0)
    );
    let uniformBuffer: GPUBuffer | null = null;
    let vertexBuffer: GPUBuffer | null = null;
    try {
      uniformBuffer = this.createCompositeParameterBuffer(
        executionPlan,
        state.device,
        uniformAlignment
      );
      vertexBuffer = this.createPresentationVertexBuffer(plan, state.device);
    } catch {
      safeDestroyBuffer(uniformBuffer);
      safeDestroyBuffer(vertexBuffer);
      this.releaseActiveUploads(uploads, state);
      return { status: "rejected", reason: "buffer-allocation-failed" };
    }
    if ((executionPlan.stackEntryCount > 0 && !uniformBuffer) || (
      plan.presentationVertices.byteLength > 0 && !vertexBuffer
    )) {
      safeDestroyBuffer(uniformBuffer);
      safeDestroyBuffer(vertexBuffer);
      this.releaseActiveUploads(uploads, state);
      return { status: "rejected", reason: "buffer-allocation-failed" };
    }

    try {
      state.context.configure({
        device: state.device,
        format: state.canvasFormat,
        alphaMode: "premultiplied",
        colorSpace: "srgb",
      });
      const encoder = state.device.createCommandEncoder({
        label: `Studio tiledoc frame ${frame.requestSequence}`,
      });
      this.encodeDirtyComposites(
        executionPlan,
        state,
        uploads,
        uniformBuffer,
        uniformAlignment,
        encoder
      );
      this.encodePresentation(plan, state, vertexBuffer, encoder);
      if (signal.aborted) return { status: "rejected", reason: "aborted" };
      if (typeof state.device.queue.onSubmittedWorkDone !== "function") {
        return { status: "rejected", reason: "queue-fence-unavailable" };
      }
      state.device.queue.submit([encoder.finish()]);
      await state.device.queue.onSubmittedWorkDone();
      if (
        signal.aborted
        || this.disposed
        || this.state !== state
      ) {
        return {
          status: "rejected",
          reason: signal.aborted ? "aborted" : this.disposed ? "disposed" : "device-lost",
        };
      }
      for (const tile of tilesToComposite) {
        const retained = this.retainedTiles.get(tile.id);
        if (retained) retained.contentKey = compositeContentKey(tile);
      }
      this.presentedFrames += 1;
      this.presentationDraws += plan.presentationDraws.length;
      return this.receipt(frame, state.generation);
    } catch {
      return abortReason(signal);
    } finally {
      safeDestroyBuffer(uniformBuffer);
      safeDestroyBuffer(vertexBuffer);
      this.releaseActiveUploads(uploads, state);
    }
  }

  private ensureRetainedTile(
    state: GpuState,
    tileId: string,
    tileSize: number,
    protectedIds: ReadonlySet<string>
  ): RetainedTile | null {
    const existing = this.retainedTiles.get(tileId);
    if (existing) {
      existing.lastUsed = ++this.sequence;
      return existing;
    }
    const textureBytes = tileSize
      * tileSize
      * STUDIO_TILEDOC_WEBGPU_COMPOSITE_BYTES_PER_PIXEL
      * 2;
    if (
      !Number.isSafeInteger(textureBytes)
      || textureBytes <= 0
      || textureBytes > this.options.maxRetainedBytes
    ) {
      return null;
    }
    const candidates = [...this.retainedTiles.values()]
      .filter((entry) => !protectedIds.has(entry.id))
      .sort((left, right) => left.lastUsed - right.lastUsed);
    while (
      this.retainedTiles.size + 1 > this.options.maxRetainedEntries
      || this.retainedBytes + textureBytes > this.options.maxRetainedBytes
    ) {
      const candidate = candidates.shift();
      if (!candidate) return null;
      this.retainedCacheEvictions += 1;
      this.releaseRetainedTile(candidate.id);
    }
    const descriptor: GPUTextureDescriptor = {
      label: `Studio tiledoc retained ${tileId}`,
      size: { width: tileSize, height: tileSize, depthOrArrayLayers: 1 },
      format: STUDIO_TILEDOC_WEBGPU_COMPOSITE_TEXTURE_FORMAT,
      usage: GPU_TEXTURE_COPY_SRC | GPU_TEXTURE_BINDING | GPU_TEXTURE_RENDER_ATTACHMENT,
    };
    let first: GPUTexture | null = null;
    let second: GPUTexture | null = null;
    try {
      first = state.device.createTexture(descriptor);
      second = state.device.createTexture({
        ...descriptor,
        label: `Studio tiledoc retained ping-pong ${tileId}`,
      });
      const created: RetainedTile = {
        id: tileId,
        textures: [first, second],
        width: tileSize,
        height: tileSize,
        byteLength: textureBytes,
        finalTextureIndex: 0,
        contentKey: null,
        lastUsed: ++this.sequence,
      };
      this.retainedTiles.set(tileId, created);
      this.retainedBytes += textureBytes;
      this.updatePeakTrackedGpuBytes();
      return created;
    } catch {
      if (first) safeDestroyTexture(first);
      if (second) safeDestroyTexture(second);
      return null;
    }
  }

  private releaseRetainedTile(tileId: string): void {
    const entry = this.retainedTiles.get(tileId);
    if (!entry) return;
    this.retainedTiles.delete(tileId);
    this.retainedBytes -= entry.byteLength;
    safeDestroyTexture(entry.textures[0]);
    safeDestroyTexture(entry.textures[1]);
  }

  private releaseRetainedTiles(): void {
    for (const tileId of [...this.retainedTiles.keys()]) this.releaseRetainedTile(tileId);
    this.retainedBytes = 0;
  }

  private acquireAndUploadSources(
    plan: StudioTileDocWebGpuCompositePlan,
    state: GpuState
  ): Map<string, ActiveUpload> | null {
    const uploads = new Map<string, ActiveUpload>();
    const protectedKeys = new Set(
      plan.frame.dirtyTiles.flatMap((tile) => tile.stack.map(sourceKey))
    );
    try {
      for (const tile of plan.frame.dirtyTiles) {
        for (const source of tile.stack) {
          const key = sourceKey(source);
          if (uploads.has(key)) continue;
          const cached = this.sourceCache.get(key);
          if (cached) {
            cached.lastUsed = ++this.sequence;
            this.sourceCacheHits += 1;
            uploads.set(key, { key, source, pooled: cached, retained: true });
            continue;
          }
          this.sourceCacheMisses += 1;
          const retain = this.reserveSourceCache(source, protectedKeys);
          const pooled = this.acquireUploadTexture(
            state,
            source.pixelWidth,
            source.pixelHeight
          );
          try {
            const packed = packStudioTileDocWebGpuUpload(
              source,
              this.uploadScratch ?? undefined
            );
            if (!this.uploadScratch || this.uploadScratch.byteLength < packed.bytes.byteLength) {
              this.uploadScratch = new Uint8Array(packed.bytes.byteLength);
              this.uploadScratch.set(packed.bytes);
            }
            const uploadBytes = this.uploadScratch.subarray(0, packed.bytes.byteLength);
            if (packed.bytes.buffer !== uploadBytes.buffer) uploadBytes.set(packed.bytes);
            state.device.queue.writeTexture(
              { texture: pooled.texture },
              uploadBytes,
              {
                offset: 0,
                bytesPerRow: packed.bytesPerRow,
                rowsPerImage: packed.rowsPerImage,
              },
              {
                width: source.pixelWidth,
                height: source.pixelHeight,
                depthOrArrayLayers: 1,
              }
            );
            this.sourceUploadCount += 1;
            this.sourcePayloadBytesUploaded += source.byteLength;
            this.physicalBytesUploaded += uploadBytes.byteLength;
          } catch (cause) {
            this.activeUploadBytes -= pooled.byteLength;
            safeDestroyTexture(pooled.texture);
            throw cause;
          }
          if (retain) {
            const entry: SourceCacheTexture = {
              ...pooled,
              key,
              bufferIdentity: sourceBufferIdentity(source),
              lastUsed: ++this.sequence,
            };
            this.activeUploadBytes -= pooled.byteLength;
            this.sourceCache.set(key, entry);
            this.sourceCacheBytes += pooled.byteLength;
            uploads.set(key, { key, source, pooled: entry, retained: true });
          } else {
            uploads.set(key, { key, source, pooled, retained: false });
          }
          this.updatePeakTrackedGpuBytes();
        }
      }
      return uploads;
    } catch {
      this.releaseActiveUploads(uploads, state);
      return null;
    }
  }

  private reserveSourceCache(
    source: StudioTileDocWebGpuSourceSnapshot,
    protectedKeys: ReadonlySet<string>
  ): boolean {
    const byteLength = source.pixelWidth
      * source.pixelHeight
      * STUDIO_TILEDOC_WEBGPU_SOURCE_BYTES_PER_PIXEL;
    if (
      byteLength <= 0
      || byteLength > this.options.maxSourceCacheBytes
      || this.options.maxSourceCacheEntries <= 0
    ) {
      return false;
    }
    const identity = sourceBufferIdentity(source);
    for (const entry of [...this.sourceCache.values()]) {
      if (entry.bufferIdentity === identity && !protectedKeys.has(entry.key)) {
        this.releaseSourceCacheEntry(entry.key, true);
      }
    }
    const candidates = [...this.sourceCache.values()]
      .filter((entry) => !protectedKeys.has(entry.key))
      .sort((left, right) => left.lastUsed - right.lastUsed);
    while (
      this.sourceCache.size + 1 > this.options.maxSourceCacheEntries
      || this.sourceCacheBytes + byteLength > this.options.maxSourceCacheBytes
    ) {
      const candidate = candidates.shift();
      if (!candidate) return false;
      this.releaseSourceCacheEntry(candidate.key, true);
    }
    return true;
  }

  private acquireUploadTexture(
    state: GpuState,
    width: number,
    height: number
  ): UploadPoolTexture {
    const index = this.uploadPool.findIndex((entry) => (
      entry.width === width && entry.height === height
    ));
    if (index >= 0) {
      const [entry] = this.uploadPool.splice(index, 1);
      this.uploadPoolBytes -= entry!.byteLength;
      this.activeUploadBytes += entry!.byteLength;
      return entry!;
    }
    const byteLength = width * height * STUDIO_TILEDOC_WEBGPU_SOURCE_BYTES_PER_PIXEL;
    const created = {
      texture: state.device.createTexture({
        label: "Studio tiledoc source upload",
        size: { width, height, depthOrArrayLayers: 1 },
        format: STUDIO_TILEDOC_WEBGPU_SOURCE_TEXTURE_FORMAT,
        usage: GPU_TEXTURE_COPY_DST | GPU_TEXTURE_BINDING,
      }),
      width,
      height,
      byteLength,
    };
    this.activeUploadBytes += byteLength;
    this.updatePeakTrackedGpuBytes();
    return created;
  }

  private releaseActiveUploads(
    uploads: ReadonlyMap<string, ActiveUpload>,
    state: GpuState
  ): void {
    for (const { pooled, retained } of uploads.values()) {
      if (retained) continue;
      this.activeUploadBytes -= pooled.byteLength;
      if (
        this.state === state
        && !this.disposed
        && this.uploadPool.length < this.options.maxUploadPoolEntries
        && this.uploadPoolBytes <= this.options.maxUploadPoolBytes - pooled.byteLength
      ) {
        this.uploadPool.push(pooled);
        this.uploadPoolBytes += pooled.byteLength;
      } else {
        safeDestroyTexture(pooled.texture);
      }
    }
  }

  private releaseUploadPool(): void {
    for (const entry of this.uploadPool) safeDestroyTexture(entry.texture);
    this.uploadPool.length = 0;
    this.uploadPoolBytes = 0;
  }

  private releaseSourceCacheEntry(key: string, eviction: boolean): void {
    const entry = this.sourceCache.get(key);
    if (!entry) return;
    this.sourceCache.delete(key);
    this.sourceCacheBytes -= entry.byteLength;
    if (eviction) this.sourceCacheEvictions += 1;
    safeDestroyTexture(entry.texture);
  }

  private releaseSourceCache(): void {
    for (const key of [...this.sourceCache.keys()]) {
      this.releaseSourceCacheEntry(key, false);
    }
    this.sourceCacheBytes = 0;
  }

  private trackedGpuBytes(): number {
    return this.retainedBytes
      + this.sourceCacheBytes
      + this.uploadPoolBytes
      + this.activeUploadBytes;
  }

  private updatePeakTrackedGpuBytes(): void {
    this.peakTrackedGpuBytes = Math.max(this.peakTrackedGpuBytes, this.trackedGpuBytes());
  }

  private releaseDeviceState(state: GpuState | null): void {
    if (!state) return;
    if (state.lease) state.lease.release();
    else safeDestroyDevice(state.device);
  }

  private createCompositeParameterBuffer(
    plan: StudioTileDocWebGpuCompositePlan,
    device: GPUDevice,
    alignment: number
  ): GPUBuffer | null {
    if (plan.stackEntryCount === 0) return null;
    const size = plan.stackEntryCount * alignment;
    if (!Number.isSafeInteger(size) || size <= 0) return null;
    const buffer = device.createBuffer({
      label: `Studio tiledoc composite parameters ${plan.frame.requestSequence}`,
      size,
      usage: GPU_BUFFER_UNIFORM,
      mappedAtCreation: true,
    });
    const values = new DataView(buffer.getMappedRange());
    let index = 0;
    for (const tile of plan.frame.dirtyTiles) {
      for (const source of tile.stack) {
        const offset = index * alignment;
        values.setFloat32(offset, source.opacity, true);
        values.setUint32(offset + 4, blendModeCode(source.blendMode)!, true);
        index += 1;
      }
    }
    buffer.unmap();
    return buffer;
  }

  private createPresentationVertexBuffer(
    plan: StudioTileDocWebGpuCompositePlan,
    device: GPUDevice
  ): GPUBuffer | null {
    if (plan.presentationVertices.byteLength === 0) return null;
    const buffer = device.createBuffer({
      label: `Studio tiledoc presentation vertices ${plan.frame.requestSequence}`,
      size: plan.presentationVertices.byteLength,
      usage: GPU_BUFFER_VERTEX,
      mappedAtCreation: true,
    });
    new Float32Array(buffer.getMappedRange()).set(plan.presentationVertices);
    buffer.unmap();
    return buffer;
  }

  private encodeDirtyComposites(
    plan: StudioTileDocWebGpuCompositePlan,
    state: GpuState,
    uploads: ReadonlyMap<string, ActiveUpload>,
    uniformBuffer: GPUBuffer | null,
    uniformAlignment: number,
    encoder: GPUCommandEncoder
  ): void {
    let parameterIndex = 0;
    for (const tile of plan.frame.dirtyTiles) {
      if (tile.action === "clear") continue;
      const retained = this.retainedTiles.get(tile.id)!;
      const clearPass = encoder.beginRenderPass({
        label: `Studio tiledoc clear ${tile.id}`,
        colorAttachments: [{
          view: retained.textures[0].createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      clearPass.end();

      let previousIndex: 0 | 1 = 0;
      for (const source of tile.stack) {
        const targetIndex: 0 | 1 = previousIndex === 0 ? 1 : 0;
        const upload = uploads.get(sourceKey(source))!;
        const bindGroup = state.device.createBindGroup({
          label: `Studio tiledoc composite ${tile.id}/${source.layerId}`,
          layout: state.compositeBindGroupLayout,
          entries: [
            { binding: 0, resource: retained.textures[previousIndex].createView() },
            { binding: 1, resource: upload.pooled.texture.createView() },
            {
              binding: 2,
              resource: {
                buffer: uniformBuffer!,
                offset: 0,
                size: COMPOSITE_PARAMETER_BYTES,
              },
            },
          ],
        });
        const pass = encoder.beginRenderPass({
          label: `Studio tiledoc blend ${tile.id}/${source.layerId}`,
          colorAttachments: [{
            view: retained.textures[targetIndex].createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: "clear",
            storeOp: "store",
          }],
        });
        pass.setPipeline(state.compositePipeline);
        pass.setBindGroup(0, bindGroup, [parameterIndex * uniformAlignment]);
        pass.draw(3, 1, 0, 0);
        pass.end();
        previousIndex = targetIndex;
        parameterIndex += 1;
      }
      retained.finalTextureIndex = previousIndex;
      retained.lastUsed = ++this.sequence;
    }
  }

  private encodePresentation(
    plan: StudioTileDocWebGpuCompositePlan,
    state: GpuState,
    vertexBuffer: GPUBuffer | null,
    encoder: GPUCommandEncoder
  ): void {
    const pass = encoder.beginRenderPass({
      label: `Studio tiledoc presentation ${plan.frame.requestSequence}`,
      colorAttachments: [{
        view: state.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: "clear",
        storeOp: "store",
      }],
    });
    pass.setPipeline(state.presentationPipeline);
    if (vertexBuffer) pass.setVertexBuffer(0, vertexBuffer);
    for (const draw of plan.presentationDraws) {
      const retained = this.retainedTiles.get(draw.tileId)!;
      retained.lastUsed = ++this.sequence;
      const bindGroup = state.device.createBindGroup({
        label: `Studio tiledoc presentation ${draw.tileId}`,
        layout: state.presentationBindGroupLayout,
        entries: [{
          binding: 0,
          resource: retained.textures[retained.finalTextureIndex].createView(),
        }],
      });
      pass.setBindGroup(0, bindGroup);
      pass.draw(draw.vertexCount, 1, draw.firstVertex, 0);
    }
    pass.end();
  }

  private receipt(
    frame: StudioTileDocWebGpuFrame,
    deviceGeneration: number
  ): StudioTileDocWebGpuPresentedReceipt {
    return Object.freeze({
      status: "presented",
      backend: "webgpu",
      requestSequence: frame.requestSequence,
      presentationRevision: frame.expectedPresentationRevision,
      contentRevision: frame.expectedContentRevision,
      plannerFrameSequence: frame.plannerFrameSequence,
      plannerVisualRevision: frame.plannerVisualRevision,
      scopeId: frame.scopeId,
      visibleTileIds: frame.visibleTileIds,
      processedDirtyTileIds: frame.dirtyTileIds,
      deviceGeneration,
    });
  }
}
