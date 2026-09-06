import type { StudioWebGpuSurfaceBounds } from "./studio-webgpu-viewport";
import type { StudioRasterImmutableTileFrame } from "../live/studio-crdt-raster-replay-runtime";

import {
  STUDIO_RASTER_MAX_ASSET_BYTES,
  STUDIO_RASTER_MAX_SURFACE_TILES,
  assertStudioRasterSurfaceSpec,
  type StudioRasterSurfaceSpec,
} from "@/shared/lib/studio-crdt-raster-ops";

export const STUDIO_RASTER_TILE_UPLOAD_ROW_ALIGNMENT = 256;
export const STUDIO_RASTER_TILE_PRESENTER_MAX_VISIBLE_TILES = 512;
export const STUDIO_RASTER_TILE_PRESENTER_MAX_VISIBLE_BYTES = 128 * 1_024 * 1_024;
export const STUDIO_RASTER_TILE_PRESENTER_MAX_BACKING_DIMENSION = 16_384;
export const STUDIO_RASTER_TILE_PRESENTER_MAX_BACKING_PIXELS = 64 * 1_024 * 1_024;
export const STUDIO_RASTER_TILE_PRESENTER_MAX_DEVICE_PIXEL_RATIO = 8;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const GPU_TEXTURE_USAGE = 0x04 | 0x02; // TEXTURE_BINDING | COPY_DST
const GPU_VERTEX_BUFFER_USAGE = 0x20; // VERTEX
const GPU_CANVAS_FORMAT = "rgba8unorm" as const;
const GPU_CACHE_MAX_ENTRIES = STUDIO_RASTER_TILE_PRESENTER_MAX_VISIBLE_TILES;
const GPU_CACHE_MAX_BYTES = STUDIO_RASTER_TILE_PRESENTER_MAX_VISIBLE_BYTES;
const GPU_RETRY_DELAYS_MS = Object.freeze([30_000, 120_000, 300_000] as const);
const VERTEX_FLOATS = 4;

const TILE_PRESENTATION_SHADER = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

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

@group(0) @binding(0) var tile_sampler: sampler;
@group(0) @binding(1) var tile_texture: texture_2d<f32>;

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  let straight = textureSample(tile_texture, tile_sampler, input.uv);
  return vec4f(straight.rgb * straight.a, straight.a);
}
`;

export type StudioRasterTilePresenterBackend = "webgpu" | "canvas2d" | "unavailable";

export interface StudioRasterTileViewport {
  /** Existing Studio WebGPU normalized document transform. */
  readonly scaleX: number;
  readonly scaleY: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly flipX: boolean;
  /** CSS bounds occupied by the viewport-sized presentation canvas. */
  readonly surfaceBounds: StudioWebGpuSurfaceBounds;
  readonly devicePixelRatio?: number;
}

export interface StudioRasterTileFrameRequest {
  readonly generation: number;
  readonly surface: StudioRasterSurfaceSpec;
  readonly tiles: readonly StudioRasterImmutableTileFrame[];
  readonly viewport: StudioRasterTileViewport;
  readonly signal?: AbortSignal;
}

export interface StudioRasterTileCssRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioRasterPlannedTile {
  readonly key: string;
  readonly surfaceId: string;
  readonly tileX: number;
  readonly tileY: number;
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
  readonly sha256: string;
  readonly documentX: number;
  readonly documentY: number;
  readonly cssRect: StudioRasterTileCssRect;
  readonly bytesPerRow: number;
  readonly uploadBytesPerRow: number;
  copyRgba(): Uint8ClampedArray;
}

export interface StudioRasterTilePresentationPlan {
  readonly status: "ready";
  readonly generation: number;
  readonly surface: StudioRasterSurfaceSpec;
  readonly viewport: StudioRasterTileViewport;
  readonly physicalWidth: number;
  readonly physicalHeight: number;
  readonly visibleBytes: number;
  readonly tiles: readonly StudioRasterPlannedTile[];
}

export type StudioRasterTilePlanFailureReason =
  | "invalid-generation"
  | "invalid-surface"
  | "invalid-viewport"
  | "backing-size-limit"
  | "tile-count-limit"
  | "invalid-tile"
  | "duplicate-tile"
  | "visible-tile-limit"
  | "visible-byte-limit";

export interface StudioRasterTileRejectedPlan {
  readonly status: "rejected";
  readonly reason: StudioRasterTilePlanFailureReason;
  readonly tileIndex?: number;
}

export type StudioRasterTilePlan =
  | StudioRasterTilePresentationPlan
  | StudioRasterTileRejectedPlan;

export interface StudioRasterTileHashVerificationSuccess {
  readonly status: "verified";
}

export interface StudioRasterTileHashVerificationFailure {
  readonly status: "rejected";
  readonly reason: "sha256-unavailable" | "sha256-mismatch" | "invalid-sha256-result";
  readonly tileKey?: string;
}

export type StudioRasterTileHashVerification =
  | StudioRasterTileHashVerificationSuccess
  | StudioRasterTileHashVerificationFailure;

export type StudioRasterTileSha256 = (
  bytes: Uint8Array,
  signal: AbortSignal
) => Promise<string>;

export interface StudioRasterPackedGpuUpload {
  readonly bytes: Uint8Array;
  readonly bytesPerRow: number;
  readonly rowsPerImage: number;
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function safeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function projectDocumentX(
  x: number,
  surface: StudioRasterSurfaceSpec,
  viewport: StudioRasterTileViewport
): number {
  const transformed = (
    viewport.flipX ? surface.width - x : x
  ) * viewport.scaleX + viewport.offsetX;
  return transformed / surface.width * viewport.surfaceBounds.width;
}

function projectDocumentY(
  y: number,
  surface: StudioRasterSurfaceSpec,
  viewport: StudioRasterTileViewport
): number {
  return (
    y * viewport.scaleY + viewport.offsetY
  ) / surface.height * viewport.surfaceBounds.height;
}

function projectedTileRect(
  documentX: number,
  documentY: number,
  width: number,
  height: number,
  surface: StudioRasterSurfaceSpec,
  viewport: StudioRasterTileViewport
): StudioRasterTileCssRect {
  const firstX = projectDocumentX(documentX, surface, viewport);
  const secondX = projectDocumentX(documentX + width, surface, viewport);
  const firstY = projectDocumentY(documentY, surface, viewport);
  const secondY = projectDocumentY(documentY + height, surface, viewport);
  return {
    left: Math.min(firstX, secondX),
    top: Math.min(firstY, secondY),
    width: Math.abs(secondX - firstX),
    height: Math.abs(secondY - firstY),
  };
}

function rectIntersectsSurface(
  rect: StudioRasterTileCssRect,
  surfaceBounds: StudioWebGpuSurfaceBounds
): boolean {
  return rect.width > 0 && rect.height > 0
    && rect.left < surfaceBounds.width
    && rect.top < surfaceBounds.height
    && rect.left + rect.width > 0
    && rect.top + rect.height > 0;
}

function validateViewport(viewport: StudioRasterTileViewport): boolean {
  const { surfaceBounds } = viewport;
  return finitePositive(viewport.scaleX)
    && finitePositive(viewport.scaleY)
    && finite(viewport.offsetX)
    && finite(viewport.offsetY)
    && typeof viewport.flipX === "boolean"
    && finite(surfaceBounds.left)
    && finite(surfaceBounds.top)
    && finitePositive(surfaceBounds.width)
    && finitePositive(surfaceBounds.height)
    && (
      viewport.devicePixelRatio === undefined
      || (
        finitePositive(viewport.devicePixelRatio)
        && viewport.devicePixelRatio <= STUDIO_RASTER_TILE_PRESENTER_MAX_DEVICE_PIXEL_RATIO
      )
    );
}

interface ValidatedTileDescriptor {
  readonly source: StudioRasterImmutableTileFrame;
  readonly index: number;
  readonly address: string;
  readonly documentX: number;
  readonly documentY: number;
  readonly cssRect: StudioRasterTileCssRect;
}

function validateTileDescriptor(
  tile: StudioRasterImmutableTileFrame,
  index: number,
  surface: StudioRasterSurfaceSpec,
  viewport: StudioRasterTileViewport
): ValidatedTileDescriptor | null {
  if (!tile || typeof tile !== "object") return null;
  if (
    tile.surfaceId !== surface.surfaceId
    || !safeInteger(tile.tileX)
    || !safeInteger(tile.tileY)
    || tile.tileX < 0
    || tile.tileY < 0
  ) {
    return null;
  }
  const documentX = tile.tileX * surface.tileSize;
  const documentY = tile.tileY * surface.tileSize;
  if (documentX >= surface.width || documentY >= surface.height) return null;
  const expectedWidth = Math.min(surface.tileSize, surface.width - documentX);
  const expectedHeight = Math.min(surface.tileSize, surface.height - documentY);
  const expectedBytes = expectedWidth * expectedHeight * 4;
  if (
    tile.width !== expectedWidth
    || tile.height !== expectedHeight
    || tile.byteLength !== expectedBytes
    || tile.byteLength < 1
    || tile.byteLength > STUDIO_RASTER_MAX_ASSET_BYTES
    || !SHA256_PATTERN.test(tile.sha256)
    || typeof tile.copyRgba !== "function"
  ) {
    return null;
  }
  return {
    source: tile,
    index,
    address: `${tile.tileX}:${tile.tileY}`,
    documentX,
    documentY,
    cssRect: projectedTileRect(
      documentX,
      documentY,
      expectedWidth,
      expectedHeight,
      surface,
      viewport
    ),
  };
}

function snapshotVisibleTile(
  descriptor: ValidatedTileDescriptor,
  surface: StudioRasterSurfaceSpec
): StudioRasterPlannedTile | null {
  let copied: Uint8ClampedArray;
  try {
    copied = descriptor.source.copyRgba();
  } catch {
    return null;
  }
  if (
    !(copied instanceof Uint8ClampedArray)
    || copied.byteLength !== descriptor.source.byteLength
  ) {
    return null;
  }
  const rgba = Uint8ClampedArray.from(copied);
  const bytesPerRow = descriptor.source.width * 4;
  const key = [
    descriptor.source.surfaceId,
    descriptor.source.tileX,
    descriptor.source.tileY,
    descriptor.source.width,
    descriptor.source.height,
    descriptor.source.sha256,
  ].join(":");
  return {
    key,
    surfaceId: surface.surfaceId,
    tileX: descriptor.source.tileX,
    tileY: descriptor.source.tileY,
    width: descriptor.source.width,
    height: descriptor.source.height,
    byteLength: descriptor.source.byteLength,
    sha256: descriptor.source.sha256,
    documentX: descriptor.documentX,
    documentY: descriptor.documentY,
    cssRect: descriptor.cssRect,
    bytesPerRow,
    uploadBytesPerRow: alignTo(bytesPerRow, STUDIO_RASTER_TILE_UPLOAD_ROW_ALIGNMENT),
    copyRgba: () => Uint8ClampedArray.from(rgba),
  };
}

/**
 * Pure fail-closed planner. Hidden tiles are descriptor-validated but their RGBA getter is never
 * touched; only visible tiles allocate immutable CPU snapshots.
 */
export function planStudioRasterTilePresentation(
  request: StudioRasterTileFrameRequest
): StudioRasterTilePlan {
  if (!safeInteger(request.generation) || request.generation < 0) {
    return { status: "rejected", reason: "invalid-generation" };
  }
  try {
    assertStudioRasterSurfaceSpec(request.surface, "request.surface");
  } catch {
    return { status: "rejected", reason: "invalid-surface" };
  }
  if (!validateViewport(request.viewport)) {
    return { status: "rejected", reason: "invalid-viewport" };
  }
  const dpr = request.viewport.devicePixelRatio ?? 1;
  const physicalWidth = Math.max(1, Math.ceil(request.viewport.surfaceBounds.width * dpr));
  const physicalHeight = Math.max(1, Math.ceil(request.viewport.surfaceBounds.height * dpr));
  if (
    physicalWidth > STUDIO_RASTER_TILE_PRESENTER_MAX_BACKING_DIMENSION
    || physicalHeight > STUDIO_RASTER_TILE_PRESENTER_MAX_BACKING_DIMENSION
    || physicalWidth * physicalHeight > STUDIO_RASTER_TILE_PRESENTER_MAX_BACKING_PIXELS
  ) {
    return { status: "rejected", reason: "backing-size-limit" };
  }
  if (!Array.isArray(request.tiles) || request.tiles.length > STUDIO_RASTER_MAX_SURFACE_TILES) {
    return { status: "rejected", reason: "tile-count-limit" };
  }

  const descriptors: ValidatedTileDescriptor[] = [];
  const addresses = new Set<string>();
  for (let index = 0; index < request.tiles.length; index += 1) {
    const descriptor = validateTileDescriptor(
      request.tiles[index]!,
      index,
      request.surface,
      request.viewport
    );
    if (!descriptor) return { status: "rejected", reason: "invalid-tile", tileIndex: index };
    if (addresses.has(descriptor.address)) {
      return { status: "rejected", reason: "duplicate-tile", tileIndex: index };
    }
    addresses.add(descriptor.address);
    descriptors.push(descriptor);
  }
  descriptors.sort((left, right) => (
    left.source.tileY - right.source.tileY
    || left.source.tileX - right.source.tileX
    || left.index - right.index
  ));

  const visible: StudioRasterPlannedTile[] = [];
  let visibleBytes = 0;
  for (const descriptor of descriptors) {
    if (!rectIntersectsSurface(descriptor.cssRect, request.viewport.surfaceBounds)) continue;
    if (visible.length >= STUDIO_RASTER_TILE_PRESENTER_MAX_VISIBLE_TILES) {
      return { status: "rejected", reason: "visible-tile-limit", tileIndex: descriptor.index };
    }
    const tile = snapshotVisibleTile(descriptor, request.surface);
    if (!tile) return { status: "rejected", reason: "invalid-tile", tileIndex: descriptor.index };
    visibleBytes += tile.byteLength;
    if (visibleBytes > STUDIO_RASTER_TILE_PRESENTER_MAX_VISIBLE_BYTES) {
      return { status: "rejected", reason: "visible-byte-limit", tileIndex: descriptor.index };
    }
    visible.push(tile);
  }

  return {
    status: "ready",
    generation: request.generation,
    surface: { ...request.surface },
    viewport: {
      ...request.viewport,
      surfaceBounds: { ...request.viewport.surfaceBounds },
      devicePixelRatio: dpr,
    },
    physicalWidth,
    physicalHeight,
    visibleBytes,
    tiles: visible,
  };
}

export function packStudioRasterGpuUpload(
  tile: StudioRasterPlannedTile
): StudioRasterPackedGpuUpload {
  const source = tile.copyRgba();
  if (
    !(source instanceof Uint8ClampedArray)
    || source.byteLength !== tile.byteLength
    || tile.bytesPerRow !== tile.width * 4
    || tile.uploadBytesPerRow < tile.bytesPerRow
    || tile.uploadBytesPerRow % STUDIO_RASTER_TILE_UPLOAD_ROW_ALIGNMENT !== 0
  ) {
    throw new Error("invalid_studio_raster_gpu_upload");
  }
  if (tile.uploadBytesPerRow === tile.bytesPerRow) {
    return {
      bytes: Uint8Array.from(source),
      bytesPerRow: tile.uploadBytesPerRow,
      rowsPerImage: tile.height,
    };
  }
  const bytes = new Uint8Array(tile.uploadBytesPerRow * tile.height);
  for (let row = 0; row < tile.height; row += 1) {
    const sourceOffset = row * tile.bytesPerRow;
    bytes.set(
      source.subarray(sourceOffset, sourceOffset + tile.bytesPerRow),
      row * tile.uploadBytesPerRow
    );
  }
  return { bytes, bytesPerRow: tile.uploadBytesPerRow, rowsPerImage: tile.height };
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  return new DOMException("래스터 타일 표시가 취소되었습니다.", "AbortError");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal);
}

async function browserSha256(bytes: Uint8Array, signal: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  if (!globalThis.crypto?.subtle) return "";
  const owned = Uint8Array.from(bytes);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", owned.buffer));
  throwIfAborted(signal);
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}

/** Verifies the actual visible straight-RGBA snapshots before either backend can display them. */
export async function verifyStudioRasterTilePlanHashes(
  plan: StudioRasterTilePresentationPlan,
  signal: AbortSignal,
  sha256: StudioRasterTileSha256 = browserSha256
): Promise<StudioRasterTileHashVerification> {
  for (const tile of plan.tiles) {
    throwIfAborted(signal);
    let actual: string;
    try {
      actual = await sha256(Uint8Array.from(tile.copyRgba()), signal);
    } catch (_error) {
      if (signal.aborted) throw abortError(signal);
      return {
        status: "rejected",
        reason: "sha256-unavailable",
        tileKey: tile.key,
      };
    }
    throwIfAborted(signal);
    if (!SHA256_PATTERN.test(actual)) {
      return {
        status: "rejected",
        reason: actual === "" ? "sha256-unavailable" : "invalid-sha256-result",
        tileKey: tile.key,
      };
    }
    if (actual !== tile.sha256) {
      return { status: "rejected", reason: "sha256-mismatch", tileKey: tile.key };
    }
  }
  return { status: "verified" };
}

function logicalPointToNdc(
  x: number,
  y: number,
  plan: StudioRasterTilePresentationPlan
): readonly [number, number] {
  const transformedX = (
    plan.viewport.flipX ? plan.surface.width - x : x
  ) * plan.viewport.scaleX + plan.viewport.offsetX;
  const transformedY = y * plan.viewport.scaleY + plan.viewport.offsetY;
  return [
    transformedX / plan.surface.width * 2 - 1,
    1 - transformedY / plan.surface.height * 2,
  ];
}

/** Six position/UV vertices per visible tile, in the same deterministic order as the plan. */
export function buildStudioRasterTileVertices(
  plan: StudioRasterTilePresentationPlan
): Float32Array {
  const vertices = new Float32Array(plan.tiles.length * 6 * VERTEX_FLOATS);
  const corners = [
    [0, 0], [1, 0], [0, 1],
    [0, 1], [1, 0], [1, 1],
  ] as const;
  for (let tileIndex = 0; tileIndex < plan.tiles.length; tileIndex += 1) {
    const tile = plan.tiles[tileIndex]!;
    for (let cornerIndex = 0; cornerIndex < corners.length; cornerIndex += 1) {
      const [horizontal, vertical] = corners[cornerIndex]!;
      const [x, y] = logicalPointToNdc(
        tile.documentX + tile.width * horizontal,
        tile.documentY + tile.height * vertical,
        plan
      );
      const offset = (tileIndex * 6 + cornerIndex) * VERTEX_FLOATS;
      vertices[offset] = x;
      vertices[offset + 1] = y;
      vertices[offset + 2] = horizontal;
      vertices[offset + 3] = vertical;
    }
  }
  return vertices;
}

export type StudioRasterTilePresentationFailureReason =
  | StudioRasterTilePlanFailureReason
  | StudioRasterTileHashVerificationFailure["reason"]
  | "aborted"
  | "disposed"
  | "stale"
  | "canvas2d-unavailable"
  | "presentation-failed"
  | "webgpu-unavailable";

export type StudioRasterTilePresentationResult =
  | {
      readonly status: "ready";
      readonly generation: number;
      readonly backend: Exclude<StudioRasterTilePresenterBackend, "unavailable">;
      readonly visibleTileCount: number;
    }
  | {
      readonly status: "rejected" | "stale";
      readonly generation: number;
      readonly reason: StudioRasterTilePresentationFailureReason;
    };

export interface StudioRasterTilePresenterCallbacks {
  readonly onBackendChange?: (backend: StudioRasterTilePresenterBackend) => void;
  readonly onFrameReady?: (generation: number) => void;
  readonly onFrameInvalid?: (
    generation: number,
    reason: StudioRasterTilePresentationFailureReason | "superseded" | "device-lost"
  ) => void;
  readonly onDeviceLost?: (info: GPUDeviceLostInfo) => void;
}

export interface StudioRasterTilePresenterOptions extends StudioRasterTilePresenterCallbacks {
  readonly gpuCanvas: HTMLCanvasElement;
  /** Used only when `gpu: null` explicitly selects Canvas2D; never used after WebGPU failure. */
  readonly canvas2dCanvas: HTMLCanvasElement;
  readonly gpu?: GPU | null;
  readonly sha256?: StudioRasterTileSha256;
  /** Monotonic clock override used only by deterministic recovery-policy tests. */
  readonly now?: () => number;
}

interface GpuTileCacheEntry {
  readonly texture: GPUTexture;
  readonly bindGroup: GPUBindGroup;
  readonly byteLength: number;
  lastUsed: number;
}

interface GpuState {
  readonly device: GPUDevice;
  readonly context: GPUCanvasContext;
  readonly pipeline: GPURenderPipeline;
  readonly sampler: GPUSampler;
  readonly cache: Map<string, GpuTileCacheEntry>;
  cacheBytes: number;
  sequence: number;
}

interface ActiveRequest {
  readonly generation: number;
  readonly controller: AbortController;
  readonly removeExternalAbort: () => void;
}

function safeDestroyTexture(texture: GPUTexture): void {
  try {
    texture.destroy();
  } catch {
    // A lost device may already have invalidated the texture.
  }
}

function safeDestroyBuffer(buffer: GPUBuffer | null): void {
  if (!buffer) return;
  try {
    buffer.destroy();
  } catch {
    // A lost device may already have invalidated the buffer.
  }
}

function safeDestroyDevice(device: GPUDevice | null): void {
  if (!device) return;
  try {
    device.destroy();
  } catch {
    // Device teardown is best effort.
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

function safeCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const context = canvas.getContext("2d", { alpha: true });
  return context && "putImageData" in context ? context as CanvasRenderingContext2D : null;
}

/**
 * Presents through one immutable backend selected at construction. `gpu: null` explicitly selects
 * Canvas2D; every other value selects WebGPU and fails closed if that provider is unavailable.
 */
export class StudioRasterTilePresenter {
  private readonly gpuCanvas: HTMLCanvasElement;
  private readonly canvas2dCanvas: HTMLCanvasElement;
  private readonly callbacks: StudioRasterTilePresenterCallbacks;
  private readonly gpuOverride: GPU | null | undefined;
  private readonly sha256: StudioRasterTileSha256;
  private readonly now: () => number;
  private readonly selectedBackend: Exclude<StudioRasterTilePresenterBackend, "unavailable">;
  private backend: StudioRasterTilePresenterBackend = "unavailable";
  private disposed = false;
  private activeRequest: ActiveRequest | null = null;
  private desiredGeneration = -1;
  private readyGeneration: number | null = null;
  private gpuState: GpuState | null = null;
  private gpuInitialization: Promise<GpuState | null> | null = null;
  private gpuRetryNotBefore = 0;
  private gpuFailureCount = 0;

  constructor(options: StudioRasterTilePresenterOptions) {
    this.gpuCanvas = options.gpuCanvas;
    this.canvas2dCanvas = options.canvas2dCanvas;
    this.callbacks = {
      onBackendChange: options.onBackendChange,
      onFrameReady: options.onFrameReady,
      onFrameInvalid: options.onFrameInvalid,
      onDeviceLost: options.onDeviceLost,
    };
    this.gpuOverride = options.gpu;
    this.selectedBackend = options.gpu === null ? "canvas2d" : "webgpu";
    this.sha256 = options.sha256 ?? browserSha256;
    this.now = options.now ?? (() => performance.now());
    this.hideBothCanvases();
  }

  getBackend(): StudioRasterTilePresenterBackend {
    return this.backend;
  }

  async present(request: StudioRasterTileFrameRequest): Promise<StudioRasterTilePresentationResult> {
    if (this.disposed) {
      return { status: "rejected", generation: request.generation, reason: "disposed" };
    }
    this.cancelActiveRequest("superseded");
    this.desiredGeneration = request.generation;
    this.invalidateVisibleFrame("superseded");
    const active = this.createActiveRequest(request);
    this.activeRequest = active;
    if (active.controller.signal.aborted) {
      this.rejectCurrentFrame(request.generation, "aborted");
      this.finishActiveRequest(active);
      return { status: "rejected", generation: request.generation, reason: "aborted" };
    }
    const plan = planStudioRasterTilePresentation({
      ...request,
      signal: active.controller.signal,
    });
    if (plan.status === "rejected") {
      this.rejectCurrentFrame(request.generation, plan.reason);
      this.finishActiveRequest(active);
      return { status: "rejected", generation: request.generation, reason: plan.reason };
    }

    try {
      const verification = await verifyStudioRasterTilePlanHashes(
        plan,
        active.controller.signal,
        this.sha256
      );
      if (!this.isCurrent(active)) {
        return { status: "stale", generation: request.generation, reason: "stale" };
      }
      if (verification.status === "rejected") {
        this.rejectCurrentFrame(request.generation, verification.reason);
        return { status: "rejected", generation: request.generation, reason: verification.reason };
      }
      if (this.selectedBackend === "canvas2d") {
        if (!this.renderCanvas2d(plan)) {
          this.rejectCurrentFrame(request.generation, "canvas2d-unavailable");
          return {
            status: "rejected",
            generation: request.generation,
            reason: "canvas2d-unavailable",
          };
        }
        this.publishReady(plan, "canvas2d");
        return {
          status: "ready",
          generation: plan.generation,
          backend: "canvas2d",
          visibleTileCount: plan.tiles.length,
        };
      }

      const gpuState = await this.ensureGpuState();
      if (!this.isCurrent(active)) {
        return { status: "stale", generation: request.generation, reason: "stale" };
      }
      if (!gpuState) {
        this.rejectCurrentFrame(request.generation, "webgpu-unavailable");
        return {
          status: "rejected",
          generation: request.generation,
          reason: "webgpu-unavailable",
        };
      }
      try {
        await this.renderWebGpu(plan, gpuState, active.controller.signal);
      } catch (error) {
        if (active.controller.signal.aborted) throw error;
        this.releaseGpuState(gpuState, true);
        this.deferGpuRetry();
        this.rejectCurrentFrame(request.generation, "presentation-failed");
        return {
          status: "rejected",
          generation: request.generation,
          reason: "presentation-failed",
        };
      }
      if (!this.isCurrent(active)) {
        return { status: "stale", generation: request.generation, reason: "stale" };
      }
      this.gpuFailureCount = 0;
      this.gpuRetryNotBefore = 0;
      this.publishReady(plan, "webgpu");
      return {
        status: "ready",
        generation: plan.generation,
        backend: "webgpu",
        visibleTileCount: plan.tiles.length,
      };
    } catch {
      if (!this.isCurrent(active)) {
        return { status: "stale", generation: request.generation, reason: "stale" };
      }
      const reason = active.controller.signal.aborted ? "aborted" : "presentation-failed";
      this.rejectCurrentFrame(request.generation, reason);
      return { status: "rejected", generation: request.generation, reason };
    } finally {
      this.finishActiveRequest(active);
    }
  }

  invalidate(reason: StudioRasterTilePresentationFailureReason | "superseded" = "superseded"): void {
    if (this.disposed) return;
    this.cancelActiveRequest(reason);
    this.invalidateVisibleFrame(reason);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelActiveRequest("disposed");
    this.invalidateVisibleFrame("disposed");
    this.releaseGpuState(this.gpuState, true);
    this.gpuState = null;
    this.gpuInitialization = null;
    if (this.selectedBackend === "canvas2d") this.clearCanvas2d();
    this.backend = "unavailable";
  }

  private createActiveRequest(request: StudioRasterTileFrameRequest): ActiveRequest {
    const controller = new AbortController();
    const externalSignal = request.signal;
    const onAbort = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) onAbort();
    else externalSignal?.addEventListener("abort", onAbort, { once: true });
    return {
      generation: request.generation,
      controller,
      removeExternalAbort: () => externalSignal?.removeEventListener("abort", onAbort),
    };
  }

  private finishActiveRequest(active: ActiveRequest): void {
    active.removeExternalAbort();
    if (this.activeRequest === active) this.activeRequest = null;
  }

  private cancelActiveRequest(
    reason: StudioRasterTilePresentationFailureReason | "superseded"
  ): void {
    const active = this.activeRequest;
    if (!active) return;
    active.removeExternalAbort();
    if (!active.controller.signal.aborted) {
      active.controller.abort(new DOMException(reason, "AbortError"));
    }
    this.activeRequest = null;
  }

  private isCurrent(active: ActiveRequest): boolean {
    return !this.disposed
      && this.activeRequest === active
      && this.desiredGeneration === active.generation
      && !active.controller.signal.aborted;
  }

  private rejectCurrentFrame(
    generation: number,
    reason: StudioRasterTilePresentationFailureReason
  ): void {
    if (this.disposed || generation !== this.desiredGeneration) return;
    this.hideBothCanvases();
    this.readyGeneration = null;
    this.setBackend("unavailable");
    this.callbacks.onFrameInvalid?.(generation, reason);
  }

  private invalidateVisibleFrame(
    reason: StudioRasterTilePresentationFailureReason | "superseded" | "device-lost"
  ): void {
    this.hideBothCanvases();
    const previous = this.readyGeneration;
    this.readyGeneration = null;
    this.setBackend("unavailable");
    if (previous !== null) this.callbacks.onFrameInvalid?.(previous, reason);
  }

  private hideBothCanvases(): void {
    for (const canvas of [this.gpuCanvas, this.canvas2dCanvas]) {
      canvas.style.visibility = "hidden";
      canvas.style.opacity = "0";
    }
  }

  private publishReady(
    plan: StudioRasterTilePresentationPlan,
    backend: Exclude<StudioRasterTilePresenterBackend, "unavailable">
  ): void {
    if (this.disposed || plan.generation !== this.desiredGeneration) return;
    const visible = backend === "webgpu" ? this.gpuCanvas : this.canvas2dCanvas;
    const hidden = backend === "webgpu" ? this.canvas2dCanvas : this.gpuCanvas;
    hidden.style.visibility = "hidden";
    hidden.style.opacity = "0";
    visible.style.visibility = "visible";
    visible.style.opacity = "1";
    this.setBackend(backend);
    if (this.readyGeneration === plan.generation) return;
    this.readyGeneration = plan.generation;
    this.callbacks.onFrameReady?.(plan.generation);
  }

  private setBackend(backend: StudioRasterTilePresenterBackend): void {
    if (this.backend === backend) return;
    this.backend = backend;
    this.callbacks.onBackendChange?.(backend);
  }

  private gpu(): GPU | null {
    if (this.gpuOverride !== undefined) return this.gpuOverride;
    if (typeof navigator === "undefined") return null;
    return navigator.gpu ?? null;
  }

  private async ensureGpuState(): Promise<GpuState | null> {
    if (this.disposed) return null;
    if (this.gpuState) return this.gpuState;
    if (this.gpuInitialization) return this.gpuInitialization;
    // A missing/unstable adapter must not turn every CRDT frame into another GPU allocation
    // attempt. WebGPU remains selected and unavailable during this bounded cooldown.
    if (this.now() < this.gpuRetryNotBefore) return null;
    const gpu = this.gpu();
    if (!gpu) return null;
    this.gpuInitialization = this.initializeGpu(gpu);
    try {
      return await this.gpuInitialization;
    } finally {
      this.gpuInitialization = null;
    }
  }

  private async initializeGpu(gpu: GPU): Promise<GpuState | null> {
    let device: GPUDevice | null = null;
    let context: GPUCanvasContext | null = null;
    let initialized = false;
    try {
      // Do not force the discrete GPU for a presentation-only surface. The browser/OS can select
      // the most appropriate adapter, which avoids unnecessary battery and thermal cost on mobile.
      const adapter = await gpu.requestAdapter();
      if (!adapter || this.disposed) return null;
      device = await adapter.requestDevice();
      if (this.disposed) {
        safeDestroyDevice(device);
        return null;
      }
      const candidate = this.gpuCanvas.getContext("webgpu");
      context = candidate && "configure" in candidate ? candidate as GPUCanvasContext : null;
      if (!context) {
        safeDestroyDevice(device);
        return null;
      }
      const module = device.createShaderModule({
        label: "Studio CRDT raster tile presentation shader",
        code: TILE_PRESENTATION_SHADER,
      });
      const pipeline = device.createRenderPipeline({
        label: "Studio CRDT raster tile presentation pipeline",
        layout: "auto",
        vertex: {
          module,
          entryPoint: "vs_main",
          buffers: [{
            arrayStride: VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT,
            stepMode: "vertex",
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x2" },
              { shaderLocation: 1, offset: 8, format: "float32x2" },
            ],
          }],
        },
        fragment: {
          module,
          entryPoint: "fs_main",
          targets: [{ format: GPU_CANVAS_FORMAT }],
        },
        primitive: { topology: "triangle-list" },
      });
      const sampler = device.createSampler({
        label: "Studio CRDT raster nearest sampler",
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
        magFilter: "nearest",
        minFilter: "nearest",
      });
      context.configure({
        device,
        format: GPU_CANVAS_FORMAT,
        alphaMode: "premultiplied",
      });
      const state: GpuState = {
        device,
        context,
        pipeline,
        sampler,
        cache: new Map(),
        cacheBytes: 0,
        sequence: 0,
      };
      this.gpuState = state;
      initialized = true;
      void device.lost.then((info) => this.handleDeviceLost(state, info));
      return state;
    } catch {
      safeUnconfigure(context);
      safeDestroyDevice(device);
      return null;
    } finally {
      if (!initialized && !this.disposed) this.deferGpuRetry();
    }
  }

  private deferGpuRetry(): void {
    const delay = GPU_RETRY_DELAYS_MS[
      Math.min(this.gpuFailureCount, GPU_RETRY_DELAYS_MS.length - 1)
    ]!;
    this.gpuFailureCount += 1;
    this.gpuRetryNotBefore = Math.max(this.gpuRetryNotBefore, this.now() + delay);
  }

  private resizeSelectedSurface(plan: StudioRasterTilePresentationPlan): void {
    const canvas = this.selectedBackend === "webgpu" ? this.gpuCanvas : this.canvas2dCanvas;
    if (canvas.width !== plan.physicalWidth) canvas.width = plan.physicalWidth;
    if (canvas.height !== plan.physicalHeight) canvas.height = plan.physicalHeight;
    canvas.style.width = `${plan.viewport.surfaceBounds.width}px`;
    canvas.style.height = `${plan.viewport.surfaceBounds.height}px`;
  }

  private ensureGpuCacheCapacity(
    state: GpuState,
    neededBytes: number,
    protectedKeys: ReadonlySet<string>
  ): boolean {
    const candidates = [...state.cache.entries()]
      .filter(([key]) => !protectedKeys.has(key))
      .sort((left, right) => left[1].lastUsed - right[1].lastUsed);
    while (
      state.cache.size + 1 > GPU_CACHE_MAX_ENTRIES
      || state.cacheBytes + neededBytes > GPU_CACHE_MAX_BYTES
    ) {
      const candidate = candidates.shift();
      if (!candidate) return false;
      const [key, entry] = candidate;
      state.cache.delete(key);
      state.cacheBytes -= entry.byteLength;
      safeDestroyTexture(entry.texture);
    }
    return true;
  }

  private gpuResourceForTile(
    state: GpuState,
    tile: StudioRasterPlannedTile,
    protectedKeys: ReadonlySet<string>
  ): GpuTileCacheEntry {
    const existing = state.cache.get(tile.key);
    if (existing) {
      existing.lastUsed = ++state.sequence;
      return existing;
    }
    if (!this.ensureGpuCacheCapacity(state, tile.byteLength, protectedKeys)) {
      throw new Error("studio_raster_gpu_cache_budget");
    }
    const texture = state.device.createTexture({
      label: `Studio CRDT raster ${tile.tileX}:${tile.tileY}`,
      size: { width: tile.width, height: tile.height, depthOrArrayLayers: 1 },
      format: "rgba8unorm",
      usage: GPU_TEXTURE_USAGE,
    });
    try {
      const upload = packStudioRasterGpuUpload(tile);
      state.device.queue.writeTexture(
        { texture },
        upload.bytes,
        {
          offset: 0,
          bytesPerRow: upload.bytesPerRow,
          rowsPerImage: upload.rowsPerImage,
        },
        { width: tile.width, height: tile.height, depthOrArrayLayers: 1 }
      );
      const bindGroup = state.device.createBindGroup({
        label: `Studio CRDT raster bindings ${tile.tileX}:${tile.tileY}`,
        layout: state.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: state.sampler },
          { binding: 1, resource: texture.createView() },
        ],
      });
      const entry: GpuTileCacheEntry = {
        texture,
        bindGroup,
        byteLength: tile.byteLength,
        lastUsed: ++state.sequence,
      };
      state.cache.set(tile.key, entry);
      state.cacheBytes += tile.byteLength;
      return entry;
    } catch (error) {
      safeDestroyTexture(texture);
      throw error;
    }
  }

  private async renderWebGpu(
    plan: StudioRasterTilePresentationPlan,
    state: GpuState,
    signal: AbortSignal
  ): Promise<void> {
    if (this.selectedBackend !== "webgpu") {
      throw new Error("studio_raster_webgpu_not_selected");
    }
    throwIfAborted(signal);
    if (this.gpuState !== state) throw new Error("studio_raster_gpu_state_stale");
    this.resizeSelectedSurface(plan);
    state.context.configure({
      device: state.device,
      format: GPU_CANVAS_FORMAT,
      alphaMode: "premultiplied",
    });
    const protectedKeys = new Set(plan.tiles.map(({ key }) => key));
    const resources = plan.tiles.map((tile) => this.gpuResourceForTile(state, tile, protectedKeys));
    throwIfAborted(signal);
    const vertices = buildStudioRasterTileVertices(plan);
    let vertexBuffer: GPUBuffer | null = null;
    try {
      if (vertices.byteLength > 0) {
        vertexBuffer = state.device.createBuffer({
          label: `Studio CRDT raster vertices ${plan.generation}`,
          size: vertices.byteLength,
          usage: GPU_VERTEX_BUFFER_USAGE,
          mappedAtCreation: true,
        });
        new Float32Array(vertexBuffer.getMappedRange()).set(vertices);
        vertexBuffer.unmap();
      }
      const encoder = state.device.createCommandEncoder({
        label: `Studio CRDT raster frame ${plan.generation}`,
      });
      const pass = encoder.beginRenderPass({
        label: `Studio CRDT raster pass ${plan.generation}`,
        colorAttachments: [{
          view: state.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      pass.setPipeline(state.pipeline);
      if (vertexBuffer) pass.setVertexBuffer(0, vertexBuffer);
      for (let index = 0; index < resources.length; index += 1) {
        pass.setBindGroup(0, resources[index]!.bindGroup);
        pass.draw(6, 1, index * 6, 0);
      }
      pass.end();
      state.device.queue.submit([encoder.finish()]);
      if (typeof state.device.queue.onSubmittedWorkDone === "function") {
        await state.device.queue.onSubmittedWorkDone();
      }
      throwIfAborted(signal);
      if (this.gpuState !== state) throw new Error("studio_raster_gpu_state_stale");
    } finally {
      safeDestroyBuffer(vertexBuffer);
    }
  }

  private clearCanvas2d(): void {
    const context = safeCanvasContext(this.canvas2dCanvas);
    if (!context) return;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, this.canvas2dCanvas.width, this.canvas2dCanvas.height);
    context.restore();
  }

  private renderCanvas2d(plan: StudioRasterTilePresentationPlan): boolean {
    if (this.selectedBackend !== "canvas2d") return false;
    this.resizeSelectedSurface(plan);
    const context = safeCanvasContext(this.canvas2dCanvas);
    const ownerDocument = this.canvas2dCanvas.ownerDocument;
    if (!context || !ownerDocument?.createElement) return false;
    const scratch = ownerDocument.createElement("canvas");
    const scratchContext = safeCanvasContext(scratch);
    if (!scratchContext) return false;

    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, plan.physicalWidth, plan.physicalHeight);
    context.restore();
    const pixelScaleX = plan.physicalWidth / plan.surface.width;
    const pixelScaleY = plan.physicalHeight / plan.surface.height;
    const transformA = pixelScaleX * plan.viewport.scaleX * (plan.viewport.flipX ? -1 : 1);
    const transformD = pixelScaleY * plan.viewport.scaleY;
    const transformE = pixelScaleX * (
      plan.viewport.offsetX + (
        plan.viewport.flipX ? plan.surface.width * plan.viewport.scaleX : 0
      )
    );
    const transformF = pixelScaleY * plan.viewport.offsetY;

    context.save();
    context.setTransform(transformA, 0, 0, transformD, transformE, transformF);
    context.imageSmoothingEnabled = false;
    context.globalCompositeOperation = "source-over";
    for (const tile of plan.tiles) {
      if (scratch.width !== tile.width) scratch.width = tile.width;
      if (scratch.height !== tile.height) scratch.height = tile.height;
      const pixels = scratchContext.createImageData(tile.width, tile.height);
      pixels.data.set(tile.copyRgba());
      scratchContext.putImageData(pixels, 0, 0);
      context.drawImage(
        scratch,
        tile.documentX,
        tile.documentY,
        tile.width,
        tile.height
      );
    }
    context.restore();
    return true;
  }

  private releaseGpuState(state: GpuState | null, destroyDevice: boolean): void {
    if (!state) return;
    if (this.gpuState === state) this.gpuState = null;
    for (const entry of state.cache.values()) safeDestroyTexture(entry.texture);
    state.cache.clear();
    state.cacheBytes = 0;
    safeUnconfigure(state.context);
    if (destroyDevice) safeDestroyDevice(state.device);
  }

  private handleDeviceLost(state: GpuState, info: GPUDeviceLostInfo): void {
    if (this.disposed || this.gpuState !== state) return;
    this.releaseGpuState(state, false);
    this.deferGpuRetry();
    this.callbacks.onDeviceLost?.(info);
    this.invalidateVisibleFrame("device-lost");
  }
}
