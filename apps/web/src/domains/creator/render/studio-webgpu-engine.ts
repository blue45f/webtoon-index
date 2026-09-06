import { resolveStudioInkPressure } from "../brush/studio-ink-pressure-model";
import {
  clearStudioCanvas2dDabSurface,
  renderStudioCanvas2dDabSurface,
} from "../studio-canvas2d-dab-surface";

import {
  isValidStudioGpuStroke,
  planStudioGpuDabs,
  planStudioGpuDabsInRect,
  planStudioGpuDabUpdate,
  planStudioGpuStrokeExtensionInRect,
  STUDIO_GPU_MAX_DABS,
} from "./studio-webgpu-dab-planner";
import {
  copyStudioGpuReadbackRows,
  planStudioGpuReadbackLayout,
  STUDIO_GPU_MAX_READBACK_PIXELS,
  type StudioGpuReadbackArea,
  type StudioGpuReadbackFailureReason,
  type StudioGpuReadbackLayout,
} from "./studio-webgpu-readback";
import {
  STUDIO_GPU_STROKE_FEED_REVISION,
  orderStudioGpuStrokes,
  sameStudioGpuStroke,
  snapshotStudioGpuStrokes,
  type StudioGpuStroke,
} from "./studio-webgpu-stroke";
import {
  advanceStudioGpuStrokeFeedBatchCompact,
  advanceStudioGpuStrokeFeedCompact,
  appendStudioGpuStrokeFeedOperations,
  createStudioGpuStrokeFeedCompactBaseline,
  isTrustedStudioGpuStrokeFeedRevision,
  isTrustedStudioGpuStrokeFeedStroke,
  materializeStudioGpuStrokeFeedStroke,
  sameStudioGpuStrokeFeedStyle,
  studioGpuStrokeFeedPointCount,
  type StudioGpuStrokeCompactSuffixBatchPatch,
  type StudioGpuStrokeCompactSuffixPatch,
  type StudioGpuStrokeOperationsAppendPatch,
  type StudioGpuStrokeSuffixBatchPatch,
  type StudioGpuStrokeSuffixPatch,
} from "./studio-webgpu-stroke-feed";
import {
  packStudioGpuTileDabs,
  planStudioGpuTilePresentation,
  planStudioGpuVisibleTileFrame,
  resolveStudioGpuTileTasks,
  STUDIO_GPU_DAB_INSTANCE_FLOATS,
} from "./studio-webgpu-tile-compositor";
import {
  createStudioGpuTileTextureFactory,
  StudioGpuTileRuntime,
  type StudioGpuTileFrameToken,
} from "./studio-webgpu-tile-runtime";

import type { StudioGpuDabRenderUpdate } from "./studio-webgpu-dab-plan-contract";
import type {
  StudioGpuBackend,
  StudioGpuFrameReadbackRequest,
  StudioGpuFrameReadbackResult,
  StudioGpuFrameReceipt,
  StudioGpuPerformanceMetrics,
} from "./studio-webgpu-frame-contract";
import type { StudioGpuViewport } from "./studio-webgpu-viewport-contract";

export {
  orderStudioGpuStrokes,
  studioGpuPressureRadius,
  STUDIO_GPU_MAX_BRUSH_SIZE,
} from "./studio-webgpu-stroke";
export type { StudioGpuComposite, StudioGpuStroke } from "./studio-webgpu-stroke";
export type {
  PlannedStudioGpuDabs,
  StudioGpuBatch,
  StudioGpuDab,
  StudioGpuDabRenderUpdate,
} from "./studio-webgpu-dab-plan-contract";
export {
  isStudioWebGpuCanvasActive,
  isValidStudioGpuStroke,
  planStudioGpuDabs,
  planStudioGpuDabsInRect,
  planStudioGpuDabUpdate,
  planStudioGpuStrokeExtensionInRect,
  STUDIO_GPU_MAX_DABS,
} from "./studio-webgpu-dab-planner";
export type {
  StudioGpuBackend,
  StudioGpuFrameReadback,
  StudioGpuFrameReadbackRejection,
  StudioGpuFrameReadbackRequest,
  StudioGpuFrameReadbackResult,
  StudioGpuFrameReceipt,
  StudioGpuPerformanceMetrics,
} from "./studio-webgpu-frame-contract";
export type {
  StudioGpuViewport,
  StudioGpuViewTransform,
} from "./studio-webgpu-viewport-contract";
export {
  STUDIO_GPU_MAX_READBACK_PIXELS,
  STUDIO_GPU_READBACK_BYTES_PER_PIXEL,
  STUDIO_GPU_READBACK_ROW_ALIGNMENT,
  copyStudioGpuReadbackRows,
  planStudioGpuReadbackLayout,
} from "./studio-webgpu-readback";
export type {
  StudioGpuReadbackArea,
  StudioGpuReadbackFailureReason,
  StudioGpuReadbackLayout,
  StudioGpuReadbackLayoutResult,
  StudioGpuReadbackPixelRect,
} from "./studio-webgpu-readback";
export interface StudioWebGpuEngineOptions {
  /** WebGPU presentation surface. It remains hidden until WebGPU owns a valid frame receipt. */
  readonly canvas: HTMLCanvasElement;
  /** Canvas2D surface used only when `selectedBackend` explicitly selects Canvas2D. */
  readonly canvas2dCanvas: HTMLCanvasElement;
  /** Immutable provider selection. Omission deliberately selects WebGPU and never implies fallback. */
  readonly selectedBackend?: StudioGpuBackend;
  /** Test/embedding override. `null` explicitly disables WebGPU. */
  readonly gpu?: GPU | null;
  readonly autoRecover?: boolean;
  /**
   * Retains one immutable presentation texture so `captureFrame()` can read the exact receipt.
   * Defaults to true for backwards compatibility. Display-only/live-preview consumers should opt
   * out to avoid a full-surface texture allocation and texture-to-texture copy on every frame.
   */
  readonly retainReadbackSnapshot?: boolean;
  /** Reports the immutable selected backend once; availability is expressed by frame invalidation. */
  readonly onBackendChange?: (backend: StudioGpuBackend) => void;
  readonly onDeviceLost?: (info: GPUDeviceLostInfo) => void;
  /** Fired synchronously before pixels for an older request may no longer be trusted. */
  readonly onFrameInvalid?: () => void;
  /** Fired only after the latest request is fully covered and submitted by the active backend. */
  readonly onFrameReady?: (receipt: StudioGpuFrameReceipt) => void;
}

/**
 * A surface rewrite must belong to a fresh frame request. `onBeforeSurfaceMutation` runs
 * synchronously after a real viewport/physical-size change has been proven, but before either
 * canvas backing store or the engine viewport is mutated. Callers use that boundary to revoke the
 * currently visible compositor frame and publish `requestId` to their receipt coordinator.
 */
export interface StudioWebGpuResizeOptions {
  readonly requestId?: string;
  readonly render?: boolean;
  readonly onBeforeSurfaceMutation?: (requestId: string) => void;
}

export interface StudioWebGpuResizeOutcome {
  readonly status: "unchanged" | "resized";
  readonly requestId: string;
  readonly rerendered: boolean;
}

/** Suffix-only journal contract; the engine supplies the private revision token itself. */
export interface StudioGpuStrokeJournalSuffixPatch {
  readonly strokeIndex: number;
  readonly previousPointCount: number;
  readonly suffixPoints: readonly number[];
  readonly suffixPressures: readonly number[];
}

export interface StudioGpuStrokeJournalSuffixBatchPatch {
  readonly patches: readonly StudioGpuStrokeJournalSuffixPatch[];
}

interface NormalizedStudioGpuViewport {
  logicalWidth: number;
  logicalHeight: number;
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
  flipX: boolean;
}

const INSTANCE_BYTES = STUDIO_GPU_DAB_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
export const STUDIO_GPU_MAX_TILE_RESOLUTION_SCALE = 4;
/**
 * Tiles re-rasterize analytically at the presentation density, so the non-mipmapped bilinear
 * presentation sampler always reads them at ~1:1 and deep zoom-out cannot shimmer. This floor only
 * bounds degenerate viewport math (near-zero scales collapsing every tile to single texels); every
 * zoom reachable through the studio UI (view zoom ≥ 0.2 × fit-width scale, normalized dpr ≥ 0.25)
 * stays far above it. Below the floor the constant-scale minification of the old 0.25 floor
 * resumes, which is acceptable for such synthetic viewports.
 */
export const STUDIO_GPU_MIN_TILE_RESOLUTION_SCALE = 1 / 64;
export const STUDIO_GPU_MAX_CONCURRENT_READBACKS = 2;
export const STUDIO_GPU_READBACK_SNAPSHOT_POOL_SIZE = 2;
/** Includes the current authority texture, retired reader-held textures, and the reuse pool. */
export const STUDIO_GPU_MAX_READBACK_SNAPSHOT_BYTES = 128 * 1024 * 1024;
export const STUDIO_GPU_MAX_READBACK_SNAPSHOT_PIXELS = 2 * STUDIO_GPU_MAX_READBACK_PIXELS;
/** Two immutable surfaces are sufficient for one authority frame plus copy-on-write. */
export const STUDIO_GPU_MAX_READBACK_SNAPSHOTS = 2;
/** Overlap CPU pointer planning with one submitted GPU frame without allowing unbounded queue lag. */
export const STUDIO_GPU_MAX_PRESENTATIONS_IN_FLIGHT = 2;
const DEFAULT_MAX_TEXTURE_DIMENSION = 8_192;
/**
 * Keep live/retained brush accumulation in a high-precision linear-capable surface. Repeated
 * translucent dabs otherwise quantize at every blend into 8-bit storage, which produces visible
 * banding and density drift long before the final presentation/export conversion.
 */
const STUDIO_GPU_TILE_TEXTURE_FORMAT = "rgba16float" as const;
const PRESENTATION_VERTEX_FLOATS = 4;
const PRESENTATION_VERTEX_BYTES = PRESENTATION_VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT;
let studioGpuEngineInstanceSequence = 0;

const STUDIO_GPU_BRUSH_SHADER = /* wgsl */ `
  struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) local: vec2<f32>,
    @location(1) color: vec4<f32>,
    @location(2) @interpolate(flat) nominal_radius_ratio: f32,
  }

  @vertex
  fn vs_main(
    @builtin(vertex_index) vertex_index: u32,
    @location(0) center: vec2<f32>,
    @location(1) quad_radius: vec2<f32>,
    @location(2) color: vec4<f32>,
    @location(3) nominal_radius_ratio: f32,
  ) -> VertexOutput {
    let corners = array<vec2<f32>, 6>(
      vec2<f32>(-1.0, -1.0),
      vec2<f32>( 1.0, -1.0),
      vec2<f32>(-1.0,  1.0),
      vec2<f32>(-1.0,  1.0),
      vec2<f32>( 1.0, -1.0),
      vec2<f32>( 1.0,  1.0),
    );
    let corner = corners[vertex_index];
    var output: VertexOutput;
    output.position = vec4<f32>(center + corner * quad_radius, 0.0, 1.0);
    output.local = corner;
    output.color = color;
    output.nominal_radius_ratio = nominal_radius_ratio;
    return output;
  }

  @fragment
  fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    // The quad is rasterized one physical texel larger than the analytic dab radius (see
    // writePackedTileDab), so the coverage transition below has real geometry to feather into on
    // every side instead of only toward the instanced quad's unclipped corners. local==1.0 is now
    // the expanded quad edge; nominal_radius_ratio locates the true circle boundary inside it.
    let distance_from_center = length(input.local);
    // Keep the edge close to one physical pixel instead of feathering 10% of large brush tips.
    let edge_width = max(fwidth(distance_from_center), 0.0005);
    let half_edge_width = edge_width * 0.5;
    let coverage = 1.0 - smoothstep(
      input.nominal_radius_ratio - half_edge_width,
      input.nominal_radius_ratio + half_edge_width,
      distance_from_center
    );
    return input.color * coverage;
  }
`;

const STUDIO_GPU_TILE_PRESENTATION_SHADER = /* wgsl */ `
  struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
  }

  @group(0) @binding(0) var tile_sampler: sampler;
  @group(0) @binding(1) var tile_texture: texture_2d<f32>;

  fn linear_to_srgb_channel(value: f32) -> f32 {
    let channel = clamp(value, 0.0, 1.0);
    let nonlinear = 1.055 * pow(channel, 1.0 / 2.4) - 0.055;
    return select(nonlinear, channel * 12.92, channel <= 0.0031308);
  }

  fn linear_premultiplied_to_srgb(value: vec4<f32>) -> vec4<f32> {
    if (value.a <= 0.0) {
      return vec4<f32>(0.0);
    }
    let straight = clamp(value.rgb / value.a, vec3<f32>(0.0), vec3<f32>(1.0));
    let encoded = vec3<f32>(
      linear_to_srgb_channel(straight.r),
      linear_to_srgb_channel(straight.g),
      linear_to_srgb_channel(straight.b)
    );
    return vec4<f32>(encoded * value.a, value.a);
  }

  @vertex
  fn vs_main(
    @location(0) position: vec2<f32>,
    @location(1) uv: vec2<f32>,
  ) -> VertexOutput {
    var output: VertexOutput;
    output.position = vec4<f32>(position, 0.0, 1.0);
    output.uv = uv;
    return output;
  }

  @fragment
  fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    // Retained rgba16float tiles accumulate premultiplied *linear-light* RGB. Convert exactly once
    // at the presentation edge; unpremultiplying first avoids applying the nonlinear transfer
    // function to coverage/alpha and preserves correct antialiasing under bilinear tile sampling.
    return linear_premultiplied_to_srgb(
      textureSample(tile_texture, tile_sampler, input.uv)
    );
  }
`;

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveOr(value: unknown, fallback: number): number {
  const finite = finiteOr(value, fallback);
  return finite > 0 ? finite : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function incrementBoundedMetric(value: number): number {
  return value < Number.MAX_SAFE_INTEGER ? value + 1 : Number.MAX_SAFE_INTEGER;
}

function normalizeViewport(input: StudioGpuViewport): NormalizedStudioGpuViewport {
  const logicalWidth = positiveOr(input.logicalWidth, 1);
  const logicalHeight = positiveOr(input.logicalHeight, 1);
  return {
    logicalWidth,
    logicalHeight,
    cssWidth: positiveOr(input.cssWidth, logicalWidth),
    cssHeight: positiveOr(input.cssHeight, logicalHeight),
    dpr: clamp(positiveOr(input.dpr, 1), 0.25, 4),
    scaleX: positiveOr(input.scaleX, 1),
    scaleY: positiveOr(input.scaleY, 1),
    offsetX: finiteOr(input.offsetX, 0),
    offsetY: finiteOr(input.offsetY, 0),
    flipX: input.flipX === true,
  };
}

function stableFingerprintNumber(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (value === Number.POSITIVE_INFINITY) return "+Infinity";
  if (value === Number.NEGATIVE_INFINITY) return "-Infinity";
  if (Object.is(value, -0)) return "-0";
  return String(value);
}

function updateFingerprint(hash: number, value: string | number | boolean | undefined): number {
  const token = typeof value === "number" ? stableFingerprintNumber(value) : String(value);
  let next = hash >>> 0;
  for (let index = 0; index < token.length; index += 1) {
    next ^= token.charCodeAt(index);
    next = Math.imul(next, 0x01000193) >>> 0;
  }
  next ^= 0;
  return Math.imul(next, 0x01000193) >>> 0;
}

export function fingerprintStudioGpuFrame(
  strokes: readonly StudioGpuStroke[],
  viewport: StudioGpuViewport,
  physicalWidth: number,
  physicalHeight: number
): string {
  const normalized = normalizeViewport(viewport);
  let hash = 0x811c9dc5;
  for (const value of [
    normalized.logicalWidth,
    normalized.logicalHeight,
    normalized.cssWidth,
    normalized.cssHeight,
    normalized.dpr,
    normalized.scaleX,
    normalized.scaleY,
    normalized.offsetX,
    normalized.offsetY,
    normalized.flipX,
    physicalWidth,
    physicalHeight,
  ]) {
    hash = updateFingerprint(hash, value);
  }
  const ordered = orderStudioGpuStrokes(strokes);
  hash = updateFingerprint(hash, ordered.length);
  for (const stroke of ordered) {
    const feed = stroke[STUDIO_GPU_STROKE_FEED_REVISION];
    if (
      isTrustedStudioGpuStrokeFeedStroke(stroke)
      && isTrustedStudioGpuStrokeFeedRevision(feed)
    ) {
      hash = updateFingerprint(hash, `feed:${feed.token}`);
      continue;
    }
    for (const value of [
      stroke.id,
      stroke.color,
      stroke.size,
      stroke.opacity,
      stroke.composite,
      stroke.orderKey,
      stroke.points.length,
    ]) {
      hash = updateFingerprint(hash, value);
    }
    if (stroke.pressureModel !== undefined) {
      hash = updateFingerprint(hash, `pressure-model:${stroke.pressureModel}`);
    }
    for (const point of stroke.points) hash = updateFingerprint(hash, point);
    hash = updateFingerprint(hash, stroke.pressures?.length);
    for (const pressure of stroke.pressures ?? []) hash = updateFingerprint(hash, pressure);
  }
  return `${ordered.length}:${hash.toString(16).padStart(8, "0")}`;
}

function limitStudioGpuDabPlan(
  update: StudioGpuDabRenderUpdate,
  maximumDabs: number
): StudioGpuDabRenderUpdate {
  if (update.dabs.length <= maximumDabs) return update;
  const dabs = update.dabs.slice(0, Math.max(0, maximumDabs));
  const batches = update.batches.flatMap((batch) => {
    if (batch.firstInstance >= dabs.length) return [];
    return [{
      ...batch,
      instanceCount: Math.min(batch.instanceCount, dabs.length - batch.firstInstance),
    }];
  });
  return { mode: update.mode, dabs, batches, complete: false };
}

function bufferUsage(): number {
  // Stable WebGPU flags: VERTEX (0x20) | COPY_DST (0x08). Numeric flags also keep node-side
  // fake-device tests independent of whether TypeScript's DOM lib exposes GPUBufferUsage itself.
  return 0x20 | 0x08;
}

function presentationTextureUsage(retainReadbackSnapshot: boolean): number {
  // RENDER_ATTACHMENT (0x10) | COPY_DST (0x02). COPY_SRC (0x01) is requested only when the
  // consumer opted into immutable receipt readback; live draft presentation never needs it.
  return 0x10 | 0x02 | (retainReadbackSnapshot ? 0x01 : 0);
}

function readbackTextureUsage(): number {
  // COPY_SRC (0x01) | COPY_DST (0x02).
  return 0x01 | 0x02;
}

function readbackBufferUsage(): number {
  // MAP_READ (0x01) | COPY_DST (0x08).
  return 0x01 | 0x08;
}

function safeDestroyDevice(device: GPUDevice | null): void {
  if (!device) return;
  try {
    device.destroy();
  } catch {
    // A lost/already-destroyed device is already released.
  }
}

function safeUnconfigure(context: GPUCanvasContext | null): void {
  if (!context) return;
  try {
    context.unconfigure();
  } catch {
    // Some implementations throw after device loss; cleanup remains complete without this call.
  }
}

function safeDestroyTexture(texture: GPUTexture | null): void {
  if (!texture) return;
  try {
    texture.destroy();
  } catch {
    // Lost-device and already-retired snapshots are both fully released states.
  }
}

function sameStudioGpuFrameReceipt(
  left: StudioGpuFrameReceipt,
  right: StudioGpuFrameReceipt
): boolean {
  return left.requestId === right.requestId
    && left.fingerprint === right.fingerprint
    && left.backend === right.backend
    && left.complete === right.complete
    && left.strokeCount === right.strokeCount
    && left.dabCount === right.dabCount
    && left.physicalWidth === right.physicalWidth
    && left.physicalHeight === right.physicalHeight;
}

function snapshotStudioGpuReadbackArea(area: StudioGpuReadbackArea): StudioGpuReadbackArea | null {
  if (!area || typeof area !== "object") return null;
  if (area.kind === "viewport") return { kind: "viewport" };
  if (area.kind !== "document" || !area.rect || typeof area.rect !== "object") return null;
  return { kind: "document", rect: { ...area.rect } };
}

type StudioGpuReadbackTextureFormat =
  | "bgra8unorm"
  | "rgba8unorm";

function readbackTextureFormat(
  format: GPUTextureFormat | null | undefined
): StudioGpuReadbackTextureFormat | null {
  return format === "bgra8unorm"
    || format === "rgba8unorm"
    ? format
    : null;
}

function readbackSnapshotByteLength(width: number, height: number): number | null {
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width <= 0
    || height <= 0
  ) {
    return null;
  }
  const pixelCount = width * height;
  if (
    !Number.isSafeInteger(pixelCount)
    || pixelCount > STUDIO_GPU_MAX_READBACK_PIXELS
  ) {
    return null;
  }
  const byteLength = pixelCount * 4;
  return Number.isSafeInteger(byteLength) && byteLength <= STUDIO_GPU_MAX_READBACK_SNAPSHOT_BYTES
    ? byteLength
    : null;
}

function compactJournalSuffixPatch(
  strokes: readonly StudioGpuStroke[],
  patch: StudioGpuStrokeJournalSuffixPatch
): StudioGpuStrokeCompactSuffixPatch | null {
  const stroke = Number.isSafeInteger(patch.strokeIndex)
    ? strokes[patch.strokeIndex]
    : undefined;
  const revision = stroke?.[STUDIO_GPU_STROKE_FEED_REVISION];
  if (
    !stroke
    || !isTrustedStudioGpuStrokeFeedStroke(stroke)
    || !isTrustedStudioGpuStrokeFeedRevision(revision)
    || patch.previousPointCount !== revision.pointCount
  ) return null;
  return {
    strokeIndex: patch.strokeIndex,
    previousPointCount: revision.pointCount,
    previousRevisionToken: revision.token,
    suffixPoints: patch.suffixPoints,
    suffixPressures: patch.suffixPressures,
  };
}

function legacySuffixPatchMatchesCurrent(
  strokes: readonly StudioGpuStroke[],
  patch: StudioGpuStrokeSuffixPatch,
  fallbackStrokes: readonly StudioGpuStroke[]
): boolean {
  const current = strokes[patch.strokeIndex];
  if (
    !current
    || fallbackStrokes.length !== strokes.length
    || fallbackStrokes[patch.strokeIndex] !== patch.nextStroke
    || !sameStudioGpuStrokeFeedStyle(current, patch.nextStroke)
    || patch.previousPointCount !== studioGpuStrokeFeedPointCount(current)
    || patch.suffixPoints.length < 2
    || patch.suffixPoints.length % 2 !== 0
    || patch.suffixPressures.length !== patch.suffixPoints.length / 2
  ) return false;
  const nextPointCount = patch.nextStroke.points.length / 2;
  if (
    !Number.isSafeInteger(nextPointCount)
    || nextPointCount !== patch.previousPointCount + patch.suffixPressures.length
    || (patch.nextStroke.pressures !== undefined
      && patch.nextStroke.pressures.length !== nextPointCount)
  ) return false;
  const coordinateOffset = patch.previousPointCount * 2;
  for (let index = 0; index < patch.suffixPoints.length; index += 1) {
    if (!Object.is(patch.suffixPoints[index], patch.nextStroke.points[coordinateOffset + index])) {
      return false;
    }
  }
  for (let index = 0; index < patch.suffixPressures.length; index += 1) {
    const resolved = resolveStudioInkPressure(
      patch.nextStroke.pressures?.[patch.previousPointCount + index],
      patch.nextStroke.pressureModel
    );
    const supplied = Math.min(1, Math.max(0, patch.suffixPressures[index]!));
    if (!Object.is(resolved, supplied)) return false;
  }
  return true;
}

function legacySettledPrefixMatchesCurrent(
  strokes: readonly StudioGpuStroke[],
  fallbackStrokes: readonly StudioGpuStroke[],
  settledCount: number
): boolean {
  if (fallbackStrokes.length !== strokes.length) return false;
  for (let index = 0; index < settledCount; index += 1) {
    const current = strokes[index]!;
    const exact = isTrustedStudioGpuStrokeFeedStroke(current)
      ? materializeStudioGpuStrokeFeedStroke(current)
      : current;
    if (!exact || !sameStudioGpuStroke(exact, fallbackStrokes[index]!)) return false;
  }
  return true;
}

interface StudioGpuFrameSnapshot {
  readonly texture: GPUTexture;
  readonly device: GPUDevice;
  readonly format: GPUTextureFormat;
  readonly width: number;
  readonly height: number;
  readonly pixelCount: number;
  readonly byteLength: number;
  readonly alphaMode: "premultiplied";
  readers: number;
  retired: boolean;
}

interface StudioGpuAuthorityFrame {
  readonly receipt: StudioGpuFrameReceipt;
  readonly generation: number;
  readonly snapshot: StudioGpuFrameSnapshot | null;
}

export class StudioWebGpuEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly canvas2dCanvas: HTMLCanvasElement;
  private readonly options: StudioWebGpuEngineOptions;
  private readonly hasGpuOverride: boolean;
  private readonly retainReadbackSnapshot: boolean;
  private readonly strokeFeedEngineId = ++studioGpuEngineInstanceSequence;

  private readonly backend: StudioGpuBackend;
  private backendAvailable = false;
  private presentationAvailable = false;
  private canvas2dContext: CanvasRenderingContext2D | null = null;
  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private format: GPUTextureFormat | null = null;
  private normalPipeline: GPURenderPipeline | null = null;
  private erasePipeline: GPURenderPipeline | null = null;
  private presentationPipeline: GPURenderPipeline | null = null;
  private presentationSampler: GPUSampler | null = null;
  private presentationBindGroupLayout: GPUBindGroupLayout | null = null;
  private presentationBindGroups = new WeakMap<GPUTexture, GPUBindGroup>();
  private instanceBuffer: GPUBuffer | null = null;
  private instanceCapacity = 0;
  /**
   * Grow-only CPU staging array reused across frames by `packStudioGpuTileDabs`. One render is in
   * flight at a time and `GPUQueue.writeBuffer` copies synchronously, so reuse cannot alias a
   * previous frame's upload. Released on suspend/dispose with the other retained frame resources.
   */
  private instanceStagingScratch: Float32Array | null = null;
  private presentationBuffer: GPUBuffer | null = null;
  private presentationCapacity = 0;
  private instanceBufferAllocations = 0;
  private presentationBufferAllocations = 0;
  private presentationBindGroupAllocations = 0;
  private presentationBindGroupReuses = 0;
  private tileRuntime: StudioGpuTileRuntime<GPUTexture> | null = null;
  private tileRuntimeDevice: GPUDevice | null = null;
  private tileRuntimeResolutionScale = 0;
  private activeTileFrame: {
    readonly runtime: StudioGpuTileRuntime<GPUTexture>;
    readonly token: StudioGpuTileFrameToken;
    readonly device: GPUDevice;
  } | null = null;
  private webGpuRenderInFlight = false;
  private webGpuRenderFlightId = 0;
  /**
   * Track completion capacity per device: a hung lost-device queue must never block a recovered
   * adapter, and weak keys must not retain retired devices.
   */
  private readonly webGpuPresentationsInFlight = new WeakMap<GPUDevice, number>();
  private pendingWebGpuRender: {
    readonly strokes: readonly StudioGpuStroke[];
    readonly requestId: string;
    readonly frameGeneration: number;
  } | null = null;
  private initializationPromise: Promise<StudioGpuBackend> | null = null;
  /** Only the never-attempted startup may replay work queued while device acquisition is pending. */
  private initializationReplayAllowed = true;
  private pendingInitializationRender = false;
  private lifecycleGeneration = 0;
  private disposed = false;
  private suspended = false;
  private viewport = normalizeViewport({ logicalWidth: 1, logicalHeight: 1 });
  private lastStrokes: readonly StudioGpuStroke[] = [];
  private renderedStrokes: readonly StudioGpuStroke[] | null = null;
  private renderedBackend: StudioGpuBackend | null = null;
  private renderedDabCount = 0;
  private renderedFrameComplete = false;
  private renderedFrameInvalid = true;
  private frameGeneration = 0;
  private lastRequestId = "initial";
  /**
   * A resize may invalidate the current receipt before mutating the backing store while deferring
   * raster work to an immediately-following journal command. That command consumes this exact
   * generation so the old feed is never rendered once under the new request id.
   */
  private deferredResizeInvalidation: {
    readonly requestId: string;
    readonly frameGeneration: number;
  } | null = null;
  private strokeFeedSequence = 0;
  private authorityFrame: StudioGpuAuthorityFrame | null = null;
  private readonly readbackSnapshotPool: StudioGpuFrameSnapshot[] = [];
  private readonly readbackSnapshots = new Set<StudioGpuFrameSnapshot>();
  private activeWebGpuReadbacks = 0;

  constructor(options: StudioWebGpuEngineOptions) {
    this.options = options;
    this.canvas = options.canvas;
    this.canvas2dCanvas = options.canvas2dCanvas;
    this.backend = options.selectedBackend ?? "webgpu";
    this.hasGpuOverride = Object.prototype.hasOwnProperty.call(options, "gpu");
    this.retainReadbackSnapshot = options.retainReadbackSnapshot !== false;
    if (this.backend === "canvas2d") this.ensureSelectedCanvas2d();
    this.setSurfaceVisibility(null);
    this.options.onBackendChange?.(this.backend);
  }

  public getBackend(): StudioGpuBackend {
    return this.backend;
  }

  /** Whether the immutable selected provider can currently accept render work. */
  public isBackendAvailable(): boolean {
    return this.backendAvailable;
  }

  public getPerformanceMetrics(): StudioGpuPerformanceMetrics {
    return Object.freeze({
      instanceBufferAllocations: this.instanceBufferAllocations,
      presentationBufferAllocations: this.presentationBufferAllocations,
      presentationBindGroupAllocations: this.presentationBindGroupAllocations,
      presentationBindGroupReuses: this.presentationBindGroupReuses,
    });
  }

  public initialize(): Promise<StudioGpuBackend> {
    if (this.disposed) return Promise.resolve(this.backend);
    if (this.backend === "canvas2d") {
      this.ensureSelectedCanvas2d();
      return Promise.resolve(this.backend);
    }
    if (this.backendAvailable && this.device) return Promise.resolve(this.backend);
    // React remounts, eager feature warm-up and an explicit retry may all reach this boundary in
    // the same task. Adapter/device acquisition is not cancellable, so superseding an in-flight
    // request would allocate a second device only to destroy the first one when it resolves.
    if (this.initializationPromise) return this.initializationPromise;
    if (this.device) {
      const previousDevice = this.device;
      this.invalidateAuthorityFrame();
      this.destroyReadbackSnapshotPool();
      this.device = null;
      this.normalPipeline = null;
      this.erasePipeline = null;
      this.presentationPipeline = null;
      this.presentationSampler = null;
      this.presentationBindGroupLayout = null;
      this.presentationBindGroups = new WeakMap();
      this.format = null;
      this.instanceBuffer?.destroy();
      this.instanceBuffer = null;
      this.instanceCapacity = 0;
      this.instanceStagingScratch = null;
      this.presentationBuffer?.destroy();
      this.presentationBuffer = null;
      this.presentationCapacity = 0;
      this.destroyTileRuntime();
      safeUnconfigure(this.context);
      this.context = null;
      safeDestroyDevice(previousDevice);
    }
    const generation = ++this.lifecycleGeneration;
    const initialization = this.initializeWebGpu(generation)
      .then((ready) => {
        if (!ready && !this.disposed && generation === this.lifecycleGeneration) {
          this.markSelectedBackendUnavailable();
        }
        const replayInitialRequest = ready
          && this.initializationReplayAllowed
          && (this.pendingInitializationRender || this.lastStrokes.length === 0);
        this.pendingInitializationRender = false;
        this.initializationReplayAllowed = false;
        if (
          replayInitialRequest
          && !this.disposed
          && !this.suspended
          && generation === this.lifecycleGeneration
        ) {
          this.render(this.lastStrokes);
        }
        return this.backend;
      })
      .finally(() => {
        this.initializationPromise = null;
      });
    this.initializationPromise = initialization;
    return initialization;
  }

  public resize(
    input: StudioGpuViewport,
    options: StudioWebGpuResizeOptions = {}
  ): StudioWebGpuResizeOutcome {
    const requestId = options.requestId ?? this.lastRequestId;
    if (this.disposed) {
      return { status: "unchanged", requestId, rerendered: false };
    }
    const nextViewport = normalizeViewport(input);
    const textureLimit = Math.max(
      1,
      Number(this.device?.limits.maxTextureDimension2D ?? DEFAULT_MAX_TEXTURE_DIMENSION)
    );
    const requestedWidth = Math.max(1, Math.round(nextViewport.cssWidth * nextViewport.dpr));
    const requestedHeight = Math.max(1, Math.round(nextViewport.cssHeight * nextViewport.dpr));
    const fit = Math.min(1, textureLimit / requestedWidth, textureLimit / requestedHeight);
    const physicalWidth = Math.max(1, Math.floor(requestedWidth * fit));
    const physicalHeight = Math.max(1, Math.floor(requestedHeight * fit));
    const viewportChanged = Object.keys(nextViewport).some((key) => {
      const viewportKey = key as keyof NormalizedStudioGpuViewport;
      return !Object.is(nextViewport[viewportKey], this.viewport[viewportKey]);
    });
    const physicalSizeChanged = this.canvas.width !== physicalWidth ||
      this.canvas.height !== physicalHeight ||
      this.canvas2dCanvas.width !== physicalWidth ||
      this.canvas2dCanvas.height !== physicalHeight;
    if (!viewportChanged && !physicalSizeChanged) {
      return { status: "unchanged", requestId, rerendered: false };
    }

    // This is deliberately before `this.viewport = ...` and canvas width/height writes. Reassigning
    // either canvas backing size synchronously discards its pixels, so the owner must be able to
    // hide/revoke the old presentation first and know the exact receipt id that can reopen it.
    options.onBeforeSurfaceMutation?.(requestId);
    this.lastRequestId = requestId;
    const frameGeneration = this.invalidateFrameReceipt();
    this.deferredResizeInvalidation = null;
    this.viewport = nextViewport;
    for (const surface of new Set([this.canvas, this.canvas2dCanvas])) {
      if (surface.width !== physicalWidth) surface.width = physicalWidth;
      if (surface.height !== physicalHeight) surface.height = physicalHeight;
    }
    this.evictIncompatibleReadbackSnapshots(
      this.device,
      this.format,
      physicalWidth,
      physicalHeight
    );
    // Resizing discards presentation pixels; transforms also change visible-tile selection/quads.
    this.invalidateRenderedFrame();
    const contextReady = this.configureContext();
    if (this.backend === "webgpu" && !contextReady) {
      return { status: "resized", requestId, rerendered: false };
    }
    if (!this.suspended && options.render !== false) {
      this.renderPreparedStrokes(this.lastStrokes, requestId, frameGeneration);
      return { status: "resized", requestId, rerendered: true };
    }
    if (options.render === false) {
      this.deferredResizeInvalidation = { requestId, frameGeneration };
    }
    return { status: "resized", requestId, rerendered: false };
  }

  public render(strokes: readonly StudioGpuStroke[], requestId = this.lastRequestId): void {
    if (this.disposed) return;
    this.renderPreparedStrokes(snapshotStudioGpuStrokes(strokes), requestId);
  }

  /**
   * Starts/replaces an imperative feed. This is the sole full-array baseline cost; subsequent
   * accepted suffixes use `appendStrokeFeedSuffix` and retain this immutable revision lineage.
   */
  public replaceStrokeFeed(
    strokes: readonly StudioGpuStroke[],
    requestId = this.lastRequestId
  ): void {
    if (this.disposed) return;
    this.strokeFeedSequence += 1;
    if (!strokes.every(isValidStudioGpuStroke)) {
      this.render(strokes, requestId);
      return;
    }
    const baseline = createStudioGpuStrokeFeedCompactBaseline(
      strokes,
      `engine:${this.strokeFeedEngineId}:feed:${this.strokeFeedSequence}`
    );
    if (!baseline) {
      this.render(strokes, requestId);
      return;
    }
    this.renderPreparedStrokes(baseline, requestId);
  }

  /** Starts a compact journal epoch and rolls back intact if validation or snapshotting fails. */
  public replaceStrokeFeedJournalBaseline(
    strokes: readonly StudioGpuStroke[],
    requestId = this.lastRequestId
  ): "replaced" | "rejected" {
    if (this.disposed) return "rejected";
    try {
      if (strokes.length < 1 || !strokes.every(isValidStudioGpuStroke)) {
        this.retainStrokeFeed(requestId);
        return "rejected";
      }
      this.strokeFeedSequence += 1;
      const baseline = createStudioGpuStrokeFeedCompactBaseline(
        strokes,
        `engine:${this.strokeFeedEngineId}:feed:${this.strokeFeedSequence}`
      );
      if (!baseline) {
        this.retainStrokeFeed(requestId);
        return "rejected";
      }
      this.renderPreparedStrokes(baseline, requestId);
      return "replaced";
    } catch {
      this.retainStrokeFeed(requestId);
      return "rejected";
    }
  }

  /**
   * Appends only new point pairs. A stale index/count, style change, malformed suffix, or missing
   * lineage uses the authoritative full replacement carried by the patch within the same backend.
   */
  public appendStrokeFeedSuffix(
    patch: StudioGpuStrokeSuffixPatch,
    requestId = this.lastRequestId
  ): "appended" | "rebuilt" {
    if (this.disposed) return "rebuilt";
    let fallbackStrokes: readonly StudioGpuStroke[];
    try {
      fallbackStrokes = patch.fallbackStrokes;
    } catch {
      this.retainStrokeFeed(requestId);
      return "rebuilt";
    }
    try {
      if (!legacySuffixPatchMatchesCurrent(this.lastStrokes, patch, fallbackStrokes)) {
        this.replaceStrokeFeed(fallbackStrokes, requestId);
        return "rebuilt";
      }
      const compact = compactJournalSuffixPatch(this.lastStrokes, {
        strokeIndex: patch.strokeIndex,
        previousPointCount: patch.previousPointCount,
        suffixPoints: patch.suffixPoints,
        suffixPressures: patch.suffixPressures,
      });
      const advanced = compact
        ? advanceStudioGpuStrokeFeedCompact(this.lastStrokes, compact)
        : null;
      if (!advanced || advanced.status === "rejected") {
        this.replaceStrokeFeed(fallbackStrokes, requestId);
        return "rebuilt";
      }
      this.renderPreparedStrokes(advanced.strokes, requestId);
      return "appended";
    } catch {
      this.replaceStrokeFeed(fallbackStrokes, requestId);
      return "rebuilt";
    }
  }

  /**
   * Advances every suffix in one terminal symmetry group before rendering. This avoids N full
   * frame submissions and never re-reads the retained point prefix of any variation.
   */
  public appendStrokeFeedSuffixBatch(
    patch: StudioGpuStrokeSuffixBatchPatch,
    requestId = this.lastRequestId
  ): "appended" | "rebuilt" {
    if (this.disposed) return "rebuilt";
    let fallbackStrokes: readonly StudioGpuStroke[];
    try {
      fallbackStrokes = patch.fallbackStrokes;
    } catch {
      this.retainStrokeFeed(requestId);
      return "rebuilt";
    }
    try {
      if (
        patch.patches.length < 1
        || !legacySettledPrefixMatchesCurrent(
          this.lastStrokes,
          fallbackStrokes,
          this.lastStrokes.length - patch.patches.length
        )
        || patch.patches.some((candidate) => (
          !legacySuffixPatchMatchesCurrent(this.lastStrokes, candidate, fallbackStrokes)
          || candidate.fallbackStrokes !== fallbackStrokes
        ))
      ) {
        this.replaceStrokeFeed(fallbackStrokes, requestId);
        return "rebuilt";
      }
      const compactPatches = patch.patches.map((candidate) => compactJournalSuffixPatch(
        this.lastStrokes,
        {
          strokeIndex: candidate.strokeIndex,
          previousPointCount: candidate.previousPointCount,
          suffixPoints: candidate.suffixPoints,
          suffixPressures: candidate.suffixPressures,
        }
      ));
      if (compactPatches.some((candidate) => candidate === null)) {
        this.replaceStrokeFeed(fallbackStrokes, requestId);
        return "rebuilt";
      }
      const advanced = advanceStudioGpuStrokeFeedBatchCompact(this.lastStrokes, {
        patches: compactPatches as StudioGpuStrokeCompactSuffixPatch[],
      });
      if (advanced.status === "rejected") {
        this.replaceStrokeFeed(fallbackStrokes, requestId);
        return "rebuilt";
      }
      this.renderPreparedStrokes(advanced.strokes, requestId);
      return "appended";
    } catch {
      this.replaceStrokeFeed(fallbackStrokes, requestId);
      return "rebuilt";
    }
  }

  /**
   * Appends a journal suffix using the engine's current trusted revision receipt. Rejection keeps
   * the previous pixels authoritative and issues a fresh receipt for the caller's request id.
   */
  public appendStrokeFeedJournalSuffix(
    patch: StudioGpuStrokeJournalSuffixPatch,
    requestId = this.lastRequestId
  ): "appended" | "rejected" {
    if (this.disposed) return "rejected";
    try {
      const compact = compactJournalSuffixPatch(this.lastStrokes, patch);
      if (!compact) {
        this.retainStrokeFeed(requestId);
        return "rejected";
      }
      const advanced = advanceStudioGpuStrokeFeedCompact(this.lastStrokes, compact);
      if (advanced.status === "rejected") {
        this.retainStrokeFeed(requestId);
        return "rejected";
      }
      this.renderPreparedStrokes(advanced.strokes, requestId);
      return "appended";
    } catch {
      this.retainStrokeFeed(requestId);
      return "rejected";
    }
  }

  /** Atomically appends one terminal journal symmetry group without a full replacement snapshot. */
  public appendStrokeFeedJournalSuffixBatch(
    patch: StudioGpuStrokeJournalSuffixBatchPatch,
    requestId = this.lastRequestId
  ): "appended" | "rejected" {
    if (this.disposed) return "rejected";
    try {
      const compactPatches: StudioGpuStrokeCompactSuffixPatch[] = [];
      for (const candidate of patch.patches) {
        const compact = compactJournalSuffixPatch(this.lastStrokes, candidate);
        if (!compact) {
          this.retainStrokeFeed(requestId);
          return "rejected";
        }
        compactPatches.push(compact);
      }
      const compactBatch: StudioGpuStrokeCompactSuffixBatchPatch = {
        patches: compactPatches,
      };
      const advanced = advanceStudioGpuStrokeFeedBatchCompact(this.lastStrokes, compactBatch);
      if (advanced.status === "rejected") {
        this.retainStrokeFeed(requestId);
        return "rejected";
      }
      this.renderPreparedStrokes(advanced.strokes, requestId);
      return "appended";
    } catch {
      this.retainStrokeFeed(requestId);
      return "rejected";
    }
  }

  /** Adds newly-started normal/erase operations without replaying retained operation history. */
  public appendStrokeFeedOperations(
    patch: StudioGpuStrokeOperationsAppendPatch,
    requestId = this.lastRequestId
  ): "appended" | "rebuilt" {
    if (this.disposed) return "rebuilt";
    if (!patch.suffixStrokes.every(isValidStudioGpuStroke)) {
      this.replaceStrokeFeed(patch.fallbackStrokes, requestId);
      return "rebuilt";
    }
    this.strokeFeedSequence += 1;
    const advanced = appendStudioGpuStrokeFeedOperations(
      this.lastStrokes,
      patch,
      `engine:${this.strokeFeedEngineId}:feed:${this.strokeFeedSequence}`
    );
    if (!advanced) {
      this.replaceStrokeFeed(patch.fallbackStrokes, requestId);
      return "rebuilt";
    }
    this.renderPreparedStrokes(advanced, requestId);
    return "appended";
  }

  /** Issues a new request/receipt for unchanged pinned pixels without inspecting point history. */
  public retainStrokeFeed(requestId = this.lastRequestId): void {
    if (this.disposed) return;
    this.renderPreparedStrokes(this.lastStrokes, requestId);
  }

  /** Clears pinned feed authority without allocating or submitting an empty replacement frame. */
  public resetStrokeFeed(requestId = this.lastRequestId): void {
    this.suspend(requestId);
  }

  private renderPreparedStrokes(
    strokeSnapshot: readonly StudioGpuStroke[],
    requestId: string,
    preInvalidatedGeneration?: number
  ): void {
    if (this.suspended) {
      this.suspended = false;
      this.setSurfaceVisibility(this.presentationAvailable ? this.backend : null);
    }
    this.lastStrokes = strokeSnapshot;
    this.lastRequestId = requestId;
    const deferred = this.deferredResizeInvalidation;
    this.deferredResizeInvalidation = null;
    const frameGeneration = preInvalidatedGeneration
      ?? (
        deferred?.requestId === requestId
          ? deferred.frameGeneration
          : this.invalidateFrameReceipt()
      );
    if (this.backend === "canvas2d") {
      this.renderCanvas2d(strokeSnapshot, requestId, frameGeneration);
      return;
    }
    if (
      this.device &&
      this.context &&
      this.normalPipeline &&
      this.erasePipeline &&
      this.presentationPipeline &&
      this.presentationSampler
    ) {
      const request = { strokes: strokeSnapshot, requestId, frameGeneration };
      if (
        this.webGpuRenderInFlight
        || this.currentWebGpuPresentationsInFlight() >= STUDIO_GPU_MAX_PRESENTATIONS_IN_FLIGHT
      ) {
        // Pointer input can outrun GPU completion. Keep only the newest request while allowing the
        // bounded submitted prefix to finish into retained textures; cancelling here would destroy
        // those textures and restart allocation on every pointermove.
        this.pendingWebGpuRender = request;
      } else {
        this.startWebGpuRender(request);
      }
      return;
    }
    this.pendingWebGpuRender = null;
    this.cancelActiveTileFrame();
    // A WebGPU request made while its selected provider is unavailable stays rejected. The
    // operation remains queued only as immutable input for the initial same-provider startup;
    // it is never replayed by Canvas2D or another renderer.
    if (this.initializationReplayAllowed) this.pendingInitializationRender = true;
    this.markSelectedBackendUnavailable({
      invalidateFrame: false,
      revokeInitializationReplay: false,
    });
  }

  public clear(): void {
    this.render([]);
  }

  /**
   * Revokes the current presentation without rendering an empty replacement frame. Retained tile
   * and readback resources are released, while a successfully-created GPU device stays warm for
   * the next supported stroke. A later `render()` resumes the engine automatically.
   */
  public suspend(requestId = this.lastRequestId): void {
    if (this.disposed) return;
    const requestChanged = requestId !== this.lastRequestId;
    const hadPresentation = this.lastStrokes.length > 0
      || this.renderedStrokes !== null
      || this.authorityFrame !== null;
    this.lastStrokes = [];
    this.lastRequestId = requestId;
    this.deferredResizeInvalidation = null;
    if (this.suspended && !requestChanged) return;

    this.suspended = true;
    this.presentationAvailable = false;
    this.supersedeWebGpuRenderFlight();
    this.destroyTileRuntime();
    this.invalidateRenderedFrame();
    this.invalidateFrameReceipt();
    // `invalidateFrameReceipt` retires the authority snapshot into this pool when there are no
    // readers. Destroy it immediately so an inactive live canvas retains no full-surface copy.
    this.destroyReadbackSnapshotPool();
    this.instanceStagingScratch = null;
    if (hadPresentation && this.backend === "canvas2d") {
      clearStudioCanvas2dDabSurface(
        this.canvas2dContext,
        this.canvas2dCanvas.width,
        this.canvas2dCanvas.height
      );
    }
    this.setSurfaceVisibility(null);
  }

  /**
   * Releases only the display backing stores after `suspend()` has revoked frame authority. The GPU
   * device and pipelines stay warm; a later component-owned `resize()` restores exact viewport
   * dimensions before the first resumed stroke is rendered.
   */
  public releaseSuspendedSurfaceBackingStores(): boolean {
    if (this.disposed || !this.suspended) return false;
    safeUnconfigure(this.context);
    let released = false;
    for (const surface of new Set([this.canvas, this.canvas2dCanvas])) {
      if (surface.width !== 1) {
        surface.width = 1;
        released = true;
      }
      if (surface.height !== 1) {
        surface.height = 1;
        released = true;
      }
    }
    return released;
  }

  /**
   * Reads only a receipt-authorized immutable frame. Any render, resize, backend switch, device
   * loss, or disposal that happens before completion turns the result into a stale rejection.
   */
  public async captureFrame(
    request: StudioGpuFrameReadbackRequest
  ): Promise<StudioGpuFrameReadbackResult> {
    if (this.disposed) return { status: "rejected", reason: "disposed" };
    if (!request || typeof request !== "object") {
      return { status: "rejected", reason: "invalid-area" };
    }
    const area = snapshotStudioGpuReadbackArea(request.area);
    if (!area) return { status: "rejected", reason: "invalid-area" };
    if (!request.receipt || typeof request.receipt !== "object") {
      return { status: "rejected", reason: "invalid-area" };
    }
    const frame = this.authorityFrame;
    if (
      !frame
      || frame.receipt !== request.receipt
      || !sameStudioGpuFrameReceipt(frame.receipt, request.receipt)
    ) {
      return { status: "rejected", reason: "stale-frame" };
    }
    const planned = planStudioGpuReadbackLayout(
      area,
      this.viewport,
      frame.receipt.physicalWidth,
      frame.receipt.physicalHeight
    );
    if (planned.status === "rejected") return planned;
    if (!this.isAuthorityFrameCurrent(frame)) {
      return { status: "rejected", reason: "stale-frame" };
    }
    return frame.receipt.backend === "webgpu"
      ? this.captureWebGpuFrame(frame, area, planned.layout)
      : this.captureCanvas2dFrame(frame, area, planned.layout);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.lifecycleGeneration += 1;
    this.pendingWebGpuRender = null;
    this.invalidateFrameReceipt();
    const device = this.device;
    this.device = null;
    this.normalPipeline = null;
    this.erasePipeline = null;
    this.presentationPipeline = null;
    this.presentationSampler = null;
    this.presentationBindGroupLayout = null;
    this.presentationBindGroups = new WeakMap();
    this.format = null;
    this.instanceBuffer?.destroy();
    this.instanceBuffer = null;
    this.instanceCapacity = 0;
    this.instanceStagingScratch = null;
    this.presentationBuffer?.destroy();
    this.presentationBuffer = null;
    this.presentationCapacity = 0;
    this.destroyTileRuntime();
    this.invalidateRenderedFrame();
    this.invalidateAuthorityFrame();
    if (device) this.destroyReadbackSnapshotsForDevice(device);
    else this.destroyReadbackSnapshotPool();
    safeUnconfigure(this.context);
    this.context = null;
    safeDestroyDevice(device);
    clearStudioCanvas2dDabSurface(
      this.canvas2dContext,
      this.canvas2dCanvas.width,
      this.canvas2dCanvas.height
    );
    this.backendAvailable = false;
    this.presentationAvailable = false;
    this.setSurfaceVisibility(null);
  }

  private isAuthorityFrameCurrent(frame: StudioGpuAuthorityFrame): boolean {
    return this.authorityFrame === frame
      && frame.generation === this.frameGeneration
      && frame.receipt.backend === this.backend
      && this.backendAvailable
      && this.presentationAvailable
      && frame.receipt.physicalWidth === this.canvas.width
      && frame.receipt.physicalHeight === this.canvas.height;
  }

  private retireFrameSnapshot(snapshot: StudioGpuFrameSnapshot | null): void {
    if (!snapshot || snapshot.retired) return;
    snapshot.retired = true;
    if (snapshot.readers === 0) this.poolFrameSnapshot(snapshot);
  }

  private releaseFrameSnapshotReader(snapshot: StudioGpuFrameSnapshot): void {
    snapshot.readers = Math.max(0, snapshot.readers - 1);
    if (snapshot.retired && snapshot.readers === 0) this.poolFrameSnapshot(snapshot);
  }

  private destroyFrameSnapshot(snapshot: StudioGpuFrameSnapshot): void {
    const pooledIndex = this.readbackSnapshotPool.indexOf(snapshot);
    if (pooledIndex >= 0) this.readbackSnapshotPool.splice(pooledIndex, 1);
    if (!this.readbackSnapshots.delete(snapshot)) return;
    safeDestroyTexture(snapshot.texture);
  }

  private allocatedReadbackSnapshotBytes(): number {
    let total = 0;
    for (const snapshot of this.readbackSnapshots) total += snapshot.byteLength;
    return total;
  }

  private allocatedReadbackSnapshotPixels(): number {
    let total = 0;
    for (const snapshot of this.readbackSnapshots) total += snapshot.pixelCount;
    return total;
  }

  private isSnapshotCompatible(
    snapshot: StudioGpuFrameSnapshot,
    device: GPUDevice | null,
    format: GPUTextureFormat | null,
    width: number,
    height: number
  ): boolean {
    const expectedByteLength = readbackSnapshotByteLength(width, height);
    return expectedByteLength !== null
      && readbackTextureFormat(format) !== null
      && snapshot.device === device
      && snapshot.format === format
      && snapshot.width === width
      && snapshot.height === height
      && snapshot.pixelCount === width * height
      && snapshot.byteLength === expectedByteLength
      && snapshot.readers === 0;
  }

  private evictIncompatibleReadbackSnapshots(
    device: GPUDevice | null,
    format: GPUTextureFormat | null,
    width: number,
    height: number
  ): void {
    for (const snapshot of [...this.readbackSnapshotPool]) {
      if (!this.isSnapshotCompatible(snapshot, device, format, width, height)) {
        this.destroyFrameSnapshot(snapshot);
      }
    }
  }

  private poolFrameSnapshot(snapshot: StudioGpuFrameSnapshot): void {
    if (this.readbackSnapshotPool.includes(snapshot)) return;
    if (
      this.disposed
      || this.suspended
      || !this.isSnapshotCompatible(
        snapshot,
        this.device,
        this.format,
        this.canvas.width,
        this.canvas.height
      )
    ) {
      this.destroyFrameSnapshot(snapshot);
      return;
    }
    if (this.readbackSnapshotPool.length >= STUDIO_GPU_READBACK_SNAPSHOT_POOL_SIZE) {
      const evicted = this.readbackSnapshotPool.shift();
      if (evicted) this.destroyFrameSnapshot(evicted);
    }
    this.readbackSnapshotPool.push(snapshot);
  }

  private acquireFrameSnapshot(
    device: GPUDevice,
    format: GPUTextureFormat,
    width: number,
    height: number
  ): StudioGpuFrameSnapshot | null {
    const byteLength = readbackSnapshotByteLength(width, height);
    if (byteLength === null || readbackTextureFormat(format) === null) return null;
    const pixelCount = width * height;
    this.evictIncompatibleReadbackSnapshots(device, format, width, height);
    const reusableIndex = this.readbackSnapshotPool.findIndex((snapshot) => (
      this.isSnapshotCompatible(snapshot, device, format, width, height)
    ));
    if (reusableIndex >= 0) {
      const snapshot = this.readbackSnapshotPool.splice(reusableIndex, 1)[0]!;
      snapshot.retired = false;
      return snapshot;
    }
    if (
      this.readbackSnapshots.size >= STUDIO_GPU_MAX_READBACK_SNAPSHOTS
      || this.allocatedReadbackSnapshotPixels() + pixelCount
        > STUDIO_GPU_MAX_READBACK_SNAPSHOT_PIXELS
      || this.allocatedReadbackSnapshotBytes() + byteLength
        > STUDIO_GPU_MAX_READBACK_SNAPSHOT_BYTES
    ) {
      return null;
    }
    const snapshot: StudioGpuFrameSnapshot = {
      texture: device.createTexture({
        label: "Studio authoritative frame readback snapshot",
        size: { width, height, depthOrArrayLayers: 1 },
        format,
        usage: readbackTextureUsage(),
      }),
      device,
      format,
      width,
      height,
      pixelCount,
      byteLength,
      alphaMode: "premultiplied",
      readers: 0,
      retired: false,
    };
    this.readbackSnapshots.add(snapshot);
    return snapshot;
  }

  private destroyReadbackSnapshotPool(): void {
    for (const snapshot of this.readbackSnapshotPool.splice(0)) {
      this.destroyFrameSnapshot(snapshot);
    }
  }

  private destroyReadbackSnapshotsForDevice(device: GPUDevice): void {
    // An unpublished presentation snapshot lives only in renderWebGpu's async flight, so it is
    // neither the authority frame nor reusable pool state while submitted work is pending. Device
    // loss can leave that promise unresolved indefinitely; release every texture owned by the
    // lost device now so the recovered device receives the full copy-on-write snapshot budget.
    for (const snapshot of [...this.readbackSnapshots]) {
      if (snapshot.device === device) this.destroyFrameSnapshot(snapshot);
    }
  }

  private invalidateAuthorityFrame(): void {
    const previous = this.authorityFrame;
    this.authorityFrame = null;
    this.retireFrameSnapshot(previous?.snapshot ?? null);
  }

  private publishAuthorityFrame(
    receipt: StudioGpuFrameReceipt,
    snapshot: StudioGpuFrameSnapshot | null
  ): StudioGpuAuthorityFrame | null {
    if (
      this.disposed
      || receipt.requestId !== this.lastRequestId
      || receipt.backend !== this.backend
      || receipt.physicalWidth !== this.canvas.width
      || receipt.physicalHeight !== this.canvas.height
    ) {
      this.retireFrameSnapshot(snapshot);
      return null;
    }
    this.invalidateAuthorityFrame();
    const frame: StudioGpuAuthorityFrame = {
      receipt,
      generation: this.frameGeneration,
      snapshot,
    };
    this.authorityFrame = frame;
    return frame;
  }

  private capturedReadback(
    frame: StudioGpuAuthorityFrame,
    area: StudioGpuReadbackArea,
    layout: StudioGpuReadbackLayout,
    pixels: Uint8ClampedArray
  ): StudioGpuFrameReadbackResult {
    if (!this.isAuthorityFrameCurrent(frame)) {
      return { status: "rejected", reason: "stale-frame" };
    }
    return {
      status: "captured",
      receipt: frame.receipt,
      area,
      pixelRect: {
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
      },
      width: layout.width,
      height: layout.height,
      pixels,
      format: "rgba8unorm",
      alphaMode: "unpremultiplied",
    };
  }

  private async captureCanvas2dFrame(
    frame: StudioGpuAuthorityFrame,
    area: StudioGpuReadbackArea,
    layout: StudioGpuReadbackLayout
  ): Promise<StudioGpuFrameReadbackResult> {
    const context = this.canvas2dContext;
    if (
      !context
      || frame.snapshot !== null
      || this.canvas2dCanvas.width !== frame.receipt.physicalWidth
      || this.canvas2dCanvas.height !== frame.receipt.physicalHeight
    ) {
      return { status: "rejected", reason: "frame-unavailable" };
    }
    try {
      // getImageData snapshots synchronously. JavaScript cannot interleave a render between this
      // call and the generation check below, so no partially-mutated Canvas2D frame can escape.
      const image = context.getImageData(layout.x, layout.y, layout.width, layout.height);
      const expectedBytes = layout.width * layout.height * 4;
      if (image.data.byteLength !== expectedBytes) {
        return { status: "rejected", reason: "readback-failed" };
      }
      return this.capturedReadback(
        frame,
        area,
        layout,
        new Uint8ClampedArray(image.data)
      );
    } catch (error) {
      const name = typeof error === "object" && error !== null && "name" in error
        ? String(error.name)
        : "";
      return {
        status: "rejected",
        reason: name === "SecurityError" ? "tainted" : "readback-failed",
      };
    }
  }

  private readbackRaceReason(
    frame: StudioGpuAuthorityFrame,
    snapshot: StudioGpuFrameSnapshot
  ): StudioGpuReadbackFailureReason {
    if (this.disposed) return "disposed";
    if (this.device !== snapshot.device) return "device-lost";
    return this.isAuthorityFrameCurrent(frame) ? "readback-failed" : "stale-frame";
  }

  private async captureWebGpuFrame(
    frame: StudioGpuAuthorityFrame,
    area: StudioGpuReadbackArea,
    layout: StudioGpuReadbackLayout
  ): Promise<StudioGpuFrameReadbackResult> {
    const snapshot = frame.snapshot;
    if (!snapshot) {
      if (readbackSnapshotByteLength(
        frame.receipt.physicalWidth,
        frame.receipt.physicalHeight
      ) === null) {
        return { status: "rejected", reason: "oversize" };
      }
      if (readbackTextureFormat(this.format) === null) {
        return { status: "rejected", reason: "unsupported-format" };
      }
      return { status: "rejected", reason: "frame-unavailable" };
    }
    const device = snapshot.device;
    if (snapshot.retired || this.device !== device) {
      return { status: "rejected", reason: "frame-unavailable" };
    }
    const format = readbackTextureFormat(snapshot.format);
    if (!format) return { status: "rejected", reason: "unsupported-format" };
    if (
      snapshot.width !== frame.receipt.physicalWidth
      || snapshot.height !== frame.receipt.physicalHeight
    ) {
      return { status: "rejected", reason: "frame-unavailable" };
    }
    if (this.activeWebGpuReadbacks >= STUDIO_GPU_MAX_CONCURRENT_READBACKS) {
      return { status: "rejected", reason: "busy" };
    }
    const maximumBufferSize = Number(
      device.limits.maxBufferSize ?? 256 * 1024 * 1024
    );
    if (
      !Number.isSafeInteger(layout.byteLength)
      || !Number.isFinite(maximumBufferSize)
      || maximumBufferSize <= 0
      || layout.byteLength > maximumBufferSize
    ) {
      return { status: "rejected", reason: "oversize" };
    }

    snapshot.readers += 1;
    this.activeWebGpuReadbacks += 1;
    let buffer: GPUBuffer | null = null;
    let mapped = false;
    try {
      if (!this.isAuthorityFrameCurrent(frame)) {
        return { status: "rejected", reason: "stale-frame" };
      }
      buffer = device.createBuffer({
        label: `Studio frame readback ${frame.receipt.requestId}`,
        size: layout.byteLength,
        usage: readbackBufferUsage(),
      });
      const encoder = device.createCommandEncoder({ label: "Studio frame readback" });
      encoder.copyTextureToBuffer(
        {
          texture: snapshot.texture,
          origin: { x: layout.x, y: layout.y, z: 0 },
        },
        {
          buffer,
          offset: 0,
          bytesPerRow: layout.bytesPerRow,
          rowsPerImage: layout.height,
        },
        { width: layout.width, height: layout.height, depthOrArrayLayers: 1 }
      );
      device.queue.submit([encoder.finish()]);
      await this.submittedWork(device);
      if (!this.isAuthorityFrameCurrent(frame)) {
        return { status: "rejected", reason: this.readbackRaceReason(frame, snapshot) };
      }
      await buffer.mapAsync(0x01, 0, layout.byteLength);
      mapped = true;
      if (!this.isAuthorityFrameCurrent(frame)) {
        return { status: "rejected", reason: this.readbackRaceReason(frame, snapshot) };
      }
      const pixels = copyStudioGpuReadbackRows(
        buffer.getMappedRange(0, layout.byteLength),
        layout,
        format,
        snapshot.alphaMode === "premultiplied"
      );
      if (!pixels) return { status: "rejected", reason: "readback-failed" };
      return this.capturedReadback(frame, area, layout, pixels);
    } catch {
      return {
        status: "rejected",
        reason: this.readbackRaceReason(frame, snapshot),
      };
    } finally {
      if (mapped && buffer) {
        try {
          buffer.unmap();
        } catch {
          // A lost device may already have invalidated the mapping.
        }
      }
      try {
        buffer?.destroy();
      } catch {
        // A failed/lost staging buffer has no remaining ownership.
      }
      this.releaseFrameSnapshotReader(snapshot);
      this.activeWebGpuReadbacks = Math.max(0, this.activeWebGpuReadbacks - 1);
    }
  }

  private gpu(): GPU | null {
    if (this.hasGpuOverride) return this.options.gpu ?? null;
    if (typeof navigator === "undefined") return null;
    return navigator.gpu ?? null;
  }

  private async initializeWebGpu(generation: number): Promise<boolean> {
    if (this.backend !== "webgpu") return false;
    const gpu = this.gpu();
    if (!gpu || this.disposed || generation !== this.lifecycleGeneration) return false;

    let device: GPUDevice | null = null;
    let context: GPUCanvasContext | null = null;
    try {
      // Studio's quality-first mode prefers the highest-performance adapter. Browsers retain final
      // authority over the choice and can ignore this hint. A rejected/disappearing adapter marks
      // this selected provider unavailable; it never changes the renderer selection.
      const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter || this.disposed || generation !== this.lifecycleGeneration) return false;
      device = await adapter.requestDevice();
      if (this.disposed || generation !== this.lifecycleGeneration) {
        safeDestroyDevice(device);
        return false;
      }

      const candidate = this.context ?? this.canvas.getContext("webgpu");
      context = candidate && "configure" in candidate
        ? candidate as GPUCanvasContext
        : null;
      if (!context) {
        safeDestroyDevice(device);
        return false;
      }
      const format = gpu.getPreferredCanvasFormat();
      const shaderModule = device.createShaderModule({
        label: "Studio round-dab brush shader",
        code: STUDIO_GPU_BRUSH_SHADER,
      });
      const vertex: GPUVertexState = {
        module: shaderModule,
        entryPoint: "vs_main",
        buffers: [
          {
            arrayStride: INSTANCE_BYTES,
            stepMode: "instance",
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x2" },
              { shaderLocation: 1, offset: 8, format: "float32x2" },
              { shaderLocation: 2, offset: 16, format: "float32x4" },
              { shaderLocation: 3, offset: 32, format: "float32" },
            ],
          },
        ],
      };
      const basePipeline: Omit<GPURenderPipelineDescriptor, "fragment"> = {
        label: "Studio round-dab brush pipeline",
        layout: "auto",
        vertex,
        primitive: { topology: "triangle-list" },
      };
      const normalPipeline = device.createRenderPipeline({
        ...basePipeline,
        fragment: {
          module: shaderModule,
          entryPoint: "fs_main",
          targets: [
            {
              format: STUDIO_GPU_TILE_TEXTURE_FORMAT,
              blend: {
                color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
                alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
              },
            },
          ],
        },
      });
      const erasePipeline = device.createRenderPipeline({
        ...basePipeline,
        label: "Studio destination-out round-dab pipeline",
        fragment: {
          module: shaderModule,
          entryPoint: "fs_main",
          targets: [
            {
              format: STUDIO_GPU_TILE_TEXTURE_FORMAT,
              blend: {
                color: { srcFactor: "zero", dstFactor: "one-minus-src-alpha", operation: "add" },
                alpha: { srcFactor: "zero", dstFactor: "one-minus-src-alpha", operation: "add" },
              },
            },
          ],
        },
      });
      const presentationModule = device.createShaderModule({
        label: "Studio retained tile presentation shader",
        code: STUDIO_GPU_TILE_PRESENTATION_SHADER,
      });
      const presentationPipeline = device.createRenderPipeline({
        label: "Studio retained tile presentation pipeline",
        layout: "auto",
        vertex: {
          module: presentationModule,
          entryPoint: "vs_main",
          buffers: [{
            arrayStride: PRESENTATION_VERTEX_BYTES,
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
          targets: [{ format }],
        },
        primitive: { topology: "triangle-list" },
      });
      const presentationSampler = device.createSampler({
        label: "Studio retained tile linear sampler",
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
        magFilter: "linear",
        minFilter: "linear",
      });
      const presentationBindGroupLayout = presentationPipeline.getBindGroupLayout(0);
      context.configure({
        device,
        format,
        alphaMode: "premultiplied",
        usage: presentationTextureUsage(this.retainReadbackSnapshot),
      });
      if (this.disposed || generation !== this.lifecycleGeneration) {
        safeUnconfigure(context);
        safeDestroyDevice(device);
        return false;
      }

      this.device = device;
      this.context = context;
      this.format = format;
      this.normalPipeline = normalPipeline;
      this.erasePipeline = erasePipeline;
      this.presentationPipeline = presentationPipeline;
      this.presentationSampler = presentationSampler;
      this.presentationBindGroupLayout = presentationBindGroupLayout;
      this.presentationBindGroups = new WeakMap();
      this.instanceBuffer?.destroy();
      this.instanceBuffer = null;
      this.instanceCapacity = 0;
      this.presentationBuffer?.destroy();
      this.presentationBuffer = null;
      this.presentationCapacity = 0;
      this.destroyTileRuntime();
      this.markSelectedBackendAvailable();
      void device.lost.then((info) => this.handleDeviceLost(device!, info));
      return true;
    } catch {
      safeUnconfigure(context);
      safeDestroyDevice(device);
      return false;
    }
  }

  private handleDeviceLost(lostDevice: GPUDevice, info: GPUDeviceLostInfo): void {
    if (this.disposed || this.device !== lostDevice) return;
    const recoveryGeneration = ++this.lifecycleGeneration;
    // `GPUQueue.onSubmittedWorkDone()` is allowed to stay pending while a device transitions to
    // lost. Detach that obsolete async flight now so a successfully recovered device can submit
    // immediately; its eventual completion is fenced by `webGpuRenderFlightId` below.
    this.supersedeWebGpuRenderFlight();
    this.invalidateAuthorityFrame();
    this.destroyReadbackSnapshotsForDevice(lostDevice);
    this.device = null;
    this.normalPipeline = null;
    this.erasePipeline = null;
    this.presentationPipeline = null;
    this.presentationSampler = null;
    this.presentationBindGroupLayout = null;
    this.presentationBindGroups = new WeakMap();
    this.format = null;
    this.instanceBuffer?.destroy();
    this.instanceBuffer = null;
    this.instanceCapacity = 0;
    this.instanceStagingScratch = null;
    this.presentationBuffer?.destroy();
    this.presentationBuffer = null;
    this.presentationCapacity = 0;
    this.destroyTileRuntime();
    safeUnconfigure(this.context);
    this.markSelectedBackendUnavailable();
    this.options.onDeviceLost?.(info);

    if (this.options.autoRecover === false) return;
    // Recovery may reacquire the same selected provider, but it deliberately does not replay the
    // failed operation. A later explicit request is required to produce a new authoritative frame.
    void this.initializeWebGpu(recoveryGeneration).then((ready) => {
      if (!ready && !this.disposed && recoveryGeneration === this.lifecycleGeneration) {
        this.markSelectedBackendUnavailable();
      }
    });
  }

  private ensureSelectedCanvas2d(): CanvasRenderingContext2D | null {
    if (this.backend !== "canvas2d") return null;
    if (!this.canvas2dContext) {
      this.canvas2dContext = this.canvas2dCanvas.getContext("2d");
    }
    this.backendAvailable = this.canvas2dContext !== null;
    if (!this.backendAvailable) this.setSurfaceVisibility(null);
    return this.canvas2dContext;
  }

  private markSelectedBackendAvailable(): void {
    this.backendAvailable = true;
    this.presentationAvailable = false;
    this.setSurfaceVisibility(null);
  }

  private markSelectedBackendUnavailable(
    options: {
      readonly invalidateFrame?: boolean;
      readonly revokeInitializationReplay?: boolean;
    } = {}
  ): void {
    if (options.revokeInitializationReplay !== false) {
      this.initializationReplayAllowed = false;
      this.pendingInitializationRender = false;
    }
    this.backendAvailable = false;
    this.presentationAvailable = false;
    this.pendingWebGpuRender = null;
    this.cancelActiveTileFrame();
    this.invalidateRenderedFrame();
    if (options.invalidateFrame !== false) this.invalidateFrameReceipt();
    else this.invalidateAuthorityFrame();
    this.setSurfaceVisibility(null);
  }

  private setSurfaceVisibility(backend: StudioGpuBackend | null): void {
    if (this.canvas === this.canvas2dCanvas) {
      this.canvas.style.visibility = this.suspended || backend === null ? "hidden" : "visible";
      return;
    }
    if (this.suspended || backend === null) {
      this.canvas.style.visibility = "hidden";
      this.canvas2dCanvas.style.visibility = "hidden";
      return;
    }
    this.canvas.style.visibility = backend === "webgpu" ? "visible" : "hidden";
    this.canvas2dCanvas.style.visibility = backend === "canvas2d" ? "visible" : "hidden";
  }

  private configureContext(): boolean {
    if (this.backend === "canvas2d") return this.ensureSelectedCanvas2d() !== null;
    if (!this.context || !this.device || !this.format) return false;
    try {
      this.context.configure({
        device: this.device,
        format: this.format,
        alphaMode: "premultiplied",
        usage: presentationTextureUsage(this.retainReadbackSnapshot),
      });
      return true;
    } catch {
      // A context failure invalidates this selected provider until an explicit same-provider retry.
      this.markSelectedBackendUnavailable({ invalidateFrame: false });
      return false;
    }
  }

  private ensureInstanceBuffer(instanceCount: number): GPUBuffer | null {
    if (!this.device || instanceCount <= 0) return null;
    if (this.instanceBuffer && this.instanceCapacity >= instanceCount) return this.instanceBuffer;
    let capacity = 256;
    while (capacity < instanceCount) capacity *= 2;
    const replacement = this.device.createBuffer({
      label: "Studio brush dab instances",
      size: capacity * INSTANCE_BYTES,
      usage: bufferUsage(),
    });
    this.instanceBuffer?.destroy();
    this.instanceBuffer = replacement;
    this.instanceCapacity = capacity;
    this.instanceBufferAllocations = incrementBoundedMetric(this.instanceBufferAllocations);
    return replacement;
  }

  private ensurePresentationBuffer(vertexCount: number): GPUBuffer | null {
    if (!this.device || vertexCount <= 0) return null;
    if (this.presentationBuffer && this.presentationCapacity >= vertexCount) {
      return this.presentationBuffer;
    }
    let capacity = 256;
    while (capacity < vertexCount) capacity *= 2;
    const replacement = this.device.createBuffer({
      label: "Studio retained tile presentation vertices",
      size: capacity * PRESENTATION_VERTEX_BYTES,
      usage: bufferUsage(),
    });
    this.presentationBuffer?.destroy();
    this.presentationBuffer = replacement;
    this.presentationCapacity = capacity;
    this.presentationBufferAllocations = incrementBoundedMetric(
      this.presentationBufferAllocations
    );
    return replacement;
  }

  private presentationBindGroupFor(texture: GPUTexture, tileId: string): GPUBindGroup | null {
    const cached = this.presentationBindGroups.get(texture);
    if (cached) {
      this.presentationBindGroupReuses = incrementBoundedMetric(
        this.presentationBindGroupReuses
      );
      return cached;
    }
    if (
      !this.device ||
      !this.presentationSampler ||
      !this.presentationBindGroupLayout
    ) {
      return null;
    }
    const created = this.device.createBindGroup({
      label: `Studio retained tile ${tileId} presentation bindings`,
      layout: this.presentationBindGroupLayout,
      entries: [
        { binding: 0, resource: this.presentationSampler },
        { binding: 1, resource: texture.createView() },
      ],
    });
    this.presentationBindGroups.set(texture, created);
    this.presentationBindGroupAllocations = incrementBoundedMetric(
      this.presentationBindGroupAllocations
    );
    return created;
  }

  private requiredTileResolutionScale(): number {
    const horizontal = this.viewport.cssWidth * this.viewport.dpr
      / this.viewport.logicalWidth * this.viewport.scaleX;
    const vertical = this.viewport.cssHeight * this.viewport.dpr
      / this.viewport.logicalHeight * this.viewport.scaleY;
    return Math.max(horizontal, vertical);
  }

  private tileResolutionScale(): number {
    const horizontal = this.canvas.width / this.viewport.logicalWidth * this.viewport.scaleX;
    const vertical = this.canvas.height / this.viewport.logicalHeight * this.viewport.scaleY;
    // The presentation sampler is bilinear without mip levels, so any raster density above the
    // presented density undersamples on zoom-out and shimmers. Following the exact presentation
    // scale keeps sampling ~1:1 (and shrinks tile textures); visible-tile count is scale-free, so
    // the existing tile budget still bounds the work. See STUDIO_GPU_MIN_TILE_RESOLUTION_SCALE.
    return clamp(
      Math.max(horizontal, vertical),
      STUDIO_GPU_MIN_TILE_RESOLUTION_SCALE,
      STUDIO_GPU_MAX_TILE_RESOLUTION_SCALE
    );
  }

  private ensureTileRuntime(device: GPUDevice): StudioGpuTileRuntime<GPUTexture> {
    const resolutionScale = this.tileResolutionScale();
    if (
      this.tileRuntime
      && this.tileRuntimeDevice === device
      && Object.is(this.tileRuntimeResolutionScale, resolutionScale)
    ) {
      return this.tileRuntime;
    }
    this.destroyTileRuntime();
    this.tileRuntime = new StudioGpuTileRuntime({
      resourceFactory: createStudioGpuTileTextureFactory(device, {
        format: STUDIO_GPU_TILE_TEXTURE_FORMAT,
      }),
      resolutionScale,
      maxTextureDimension2D: Math.max(
        1,
        Number(device.limits.maxTextureDimension2D ?? DEFAULT_MAX_TEXTURE_DIMENSION)
      ),
    });
    this.tileRuntimeDevice = device;
    this.tileRuntimeResolutionScale = resolutionScale;
    return this.tileRuntime;
  }

  private cancelActiveTileFrame(): void {
    const active = this.activeTileFrame;
    this.activeTileFrame = null;
    if (active) active.runtime.abortFrame(active.token);
  }

  private destroyTileRuntime(): void {
    this.cancelActiveTileFrame();
    this.tileRuntime?.dispose();
    this.tileRuntime = null;
    this.tileRuntimeDevice = null;
    this.tileRuntimeResolutionScale = 0;
    // Bind groups retain views into tile textures. Drop the weak index whenever those textures are
    // retired so a future runtime can never reuse a binding for a destroyed resource.
    this.presentationBindGroups = new WeakMap();
  }

  private invalidateRenderedFrame(): void {
    this.renderedStrokes = null;
    this.renderedBackend = null;
    this.renderedDabCount = 0;
    this.renderedFrameComplete = false;
    this.renderedFrameInvalid = true;
  }

  private invalidateFrameReceipt(): number {
    this.deferredResizeInvalidation = null;
    this.invalidateAuthorityFrame();
    this.frameGeneration += 1;
    this.options.onFrameInvalid?.();
    return this.frameGeneration;
  }

  private planRenderUpdate(strokes: readonly StudioGpuStroke[]): StudioGpuDabRenderUpdate {
    if (
      this.renderedFrameInvalid ||
      this.renderedBackend !== this.backend ||
      !this.renderedStrokes ||
      !this.renderedFrameComplete
    ) {
      return { mode: "rebuild", ...planStudioGpuDabs(strokes) };
    }
    const update = planStudioGpuDabUpdate(this.renderedStrokes, strokes);
    if (update.mode === "rebuild") return update;
    return limitStudioGpuDabPlan(
      update,
      Math.max(0, STUDIO_GPU_MAX_DABS - this.renderedDabCount)
    );
  }

  private recordRenderedFrame(
    strokes: readonly StudioGpuStroke[],
    update: StudioGpuDabRenderUpdate
  ): boolean {
    const previousComplete = this.renderedFrameComplete;
    // Callers usually provide immutable React data, but pointer hot paths may reuse an object.
    // Retained-frame diffing must compare against pixels that were actually submitted, not an
    // array that can later mutate in place and make an undrawn tail appear equal.
    this.renderedStrokes = snapshotStudioGpuStrokes(strokes);
    this.renderedBackend = this.backend;
    this.renderedDabCount = update.mode === "append"
      ? this.renderedDabCount + update.dabs.length
      : update.dabs.length;
    this.renderedFrameComplete = update.mode === "rebuild"
      ? update.complete
      : previousComplete && update.complete;
    this.renderedFrameInvalid = false;
    return this.renderedFrameComplete;
  }

  private recordRenderedTileFrame(
    strokes: readonly StudioGpuStroke[],
    submittedDabCount: number
  ): void {
    // A tiled WebGPU frame is complete once every dirty visible-tile task and the presentation
    // pass have finished. Re-planning the whole (potentially very tall) document here would make
    // offscreen ink consume the visible frame's safety budget and defeat viewport-bounded work.
    this.renderedStrokes = snapshotStudioGpuStrokes(strokes);
    this.renderedBackend = this.backend;
    this.renderedDabCount = submittedDabCount;
    this.renderedFrameComplete = true;
    this.renderedFrameInvalid = false;
  }

  private startWebGpuRender(request: {
    readonly strokes: readonly StudioGpuStroke[];
    readonly requestId: string;
    readonly frameGeneration: number;
  }): void {
    const flightId = ++this.webGpuRenderFlightId;
    this.webGpuRenderInFlight = true;
    const finish = () => {
      // A lost device may complete or reject its submitted-work promise after a recovered device
      // has already started rendering. Only the current flight owns the shared pending slot/lock.
      if (flightId !== this.webGpuRenderFlightId) return;
      this.webGpuRenderInFlight = false;
      this.drainPendingWebGpuRender();
    };
    void this.renderWebGpu(
      request.strokes,
      request.requestId,
      request.frameGeneration
    ).then(finish, finish);
  }

  private supersedeWebGpuRenderFlight(): void {
    this.webGpuRenderFlightId += 1;
    this.webGpuRenderInFlight = false;
    this.pendingWebGpuRender = null;
  }

  private currentWebGpuPresentationsInFlight(): number {
    const device = this.device;
    return device ? this.webGpuPresentationsInFlight.get(device) ?? 0 : 0;
  }

  private incrementWebGpuPresentation(device: GPUDevice): void {
    this.webGpuPresentationsInFlight.set(
      device,
      (this.webGpuPresentationsInFlight.get(device) ?? 0) + 1
    );
  }

  private decrementWebGpuPresentation(device: GPUDevice): void {
    const next = Math.max(0, (this.webGpuPresentationsInFlight.get(device) ?? 0) - 1);
    this.webGpuPresentationsInFlight.set(device, next);
    if (this.device === device) this.drainPendingWebGpuRender();
  }

  private drainPendingWebGpuRender(): void {
    if (
      this.disposed
      || this.webGpuRenderInFlight
      || this.currentWebGpuPresentationsInFlight() >= STUDIO_GPU_MAX_PRESENTATIONS_IN_FLIGHT
    ) {
      return;
    }
    const pending = this.pendingWebGpuRender;
    this.pendingWebGpuRender = null;
    if (!pending) return;
    if (
      pending.frameGeneration !== this.frameGeneration
      || pending.requestId !== this.lastRequestId
    ) {
      return;
    }
    if (
      this.backend === "webgpu"
      && this.device
      && this.context
      && this.normalPipeline
      && this.erasePipeline
      && this.presentationPipeline
      && this.presentationSampler
    ) {
      this.startWebGpuRender(pending);
      return;
    }
    this.cancelActiveTileFrame();
    this.markSelectedBackendUnavailable();
  }

  private async renderWebGpu(
    strokes: readonly StudioGpuStroke[],
    requestId: string,
    frameGeneration: number
  ): Promise<void> {
    const {
      device,
      context,
      normalPipeline,
      erasePipeline,
      presentationPipeline,
      presentationSampler,
      format,
    } = this;
    if (
      !device
      || !context
      || !normalPipeline
      || !erasePipeline
      || !presentationPipeline
      || !presentationSampler
      || !format
    ) {
      return;
    }
    let runtime: StudioGpuTileRuntime<GPUTexture> | null = null;
    let token: StudioGpuTileFrameToken | null = null;
    let presentationSnapshot: StudioGpuFrameSnapshot | null = null;
    try {
      // A capped tile enlarged beyond its native physical density is visibly softer than Konva.
      // Do not bless that degraded surface: the invalidation already makes the authoritative
      // preview visible, and a later resize below the cap can request a fresh GPU handoff.
      if (this.requiredTileResolutionScale() > STUDIO_GPU_MAX_TILE_RESOLUTION_SCALE) return;
      // Tile bounds intentionally omit non-painting entries. Validate the source operations first
      // so a malformed/empty stroke cannot disappear from every tile and receive a complete blank
      // frame receipt that would hide the authoritative Konva preview.
      if (!strokes.every(isValidStudioGpuStroke)) {
        throw new Error("Studio WebGPU frame contains an invalid stroke");
      }
      const tileFrame = planStudioGpuVisibleTileFrame(strokes, this.viewport);
      runtime = this.ensureTileRuntime(device);
      const preparation = runtime.prepareFrame(tileFrame);
      if (preparation.status !== "prepared") {
        throw new Error(`Studio WebGPU tile frame rejected: ${preparation.reason}`);
      }
      token = preparation.token;
      this.activeTileFrame = { runtime, token, device };

      const resolved = resolveStudioGpuTileTasks(
        preparation.tasks,
        strokes,
        planStudioGpuDabsInRect,
        STUDIO_GPU_MAX_DABS,
        planStudioGpuStrokeExtensionInRect
      );
      if (!resolved) throw new Error("Studio WebGPU tile operation resolution failed");
      const packed = packStudioGpuTileDabs(
        resolved,
        this.instanceStagingScratch ?? undefined
      );
      // Retain a freshly grown staging array so later pointer frames pack without reallocating.
      if (this.instanceStagingScratch === null
        || packed.buffer !== this.instanceStagingScratch.buffer) {
        this.instanceStagingScratch = new Float32Array(packed.buffer);
      }
      const instanceBuffer = this.ensureInstanceBuffer(resolved.dabCount);
      if (instanceBuffer && packed.byteLength > 0) {
        device.queue.writeBuffer(
          instanceBuffer,
          0,
          packed.buffer,
          packed.byteOffset,
          packed.byteLength
        );
      }

      if (preparation.tasks.length > 0) {
        const encoder = device.createCommandEncoder({ label: "Studio retained tile render frame" });
        for (const resolvedTask of resolved.tasks) {
          const pass = encoder.beginRenderPass({
            label: `Studio retained tile ${resolvedTask.task.tile.id}`,
            colorAttachments: [{
              view: resolvedTask.task.resource.createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              loadOp: resolvedTask.task.mode === "append" ? "load" : "clear",
              storeOp: "store",
            }],
          });
          if (instanceBuffer) {
            pass.setVertexBuffer(0, instanceBuffer);
            for (const batch of resolvedTask.plan.batches) {
              pass.setPipeline(batch.composite === "erase" ? erasePipeline : normalPipeline);
              pass.draw(
                6,
                batch.instanceCount,
                0,
                resolvedTask.firstInstance + batch.firstInstance
              );
            }
          }
          pass.end();
        }
        device.queue.submit([encoder.finish()]);
      }

      // WebGPU guarantees queue submission order. Committing the CPU-side tile revision after the
      // render submission is accepted lets the following presentation submission sample those
      // textures without an intermediate `onSubmittedWorkDone()` round-trip. The single fence after
      // presentation still gates the frame receipt; device loss destroys this runtime generation.
      if (!this.isUsableWebGpuFrame(device, runtime, token)) {
        runtime.abortFrame(token);
        return;
      }
      const compositeFrame = runtime.completeFrame(token);
      if (!compositeFrame) throw new Error("Studio WebGPU tile frame completion failed");
      if (!this.isCurrentWebGpuFrame(device, runtime, token, requestId, frameGeneration)) {
        // A newer pointer request arrived while this submitted prefix was running. The texture is
        // fully written and therefore a safe retained base, but its pixels must never be presented
        // or authorized. Commit/release it, then the one-slot pending queue renders only the latest
        // suffix over that exact state.
        runtime.releaseFrame(token);
        if (this.activeTileFrame?.token === token) this.activeTileFrame = null;
        return;
      }
      const presentation = planStudioGpuTilePresentation(compositeFrame, this.viewport);
      const presentationBuffer = this.ensurePresentationBuffer(presentation.vertices.length / 4);
      if (presentationBuffer && presentation.vertices.byteLength > 0) {
        device.queue.writeBuffer(
          presentationBuffer,
          0,
          presentation.vertices.buffer,
          presentation.vertices.byteOffset,
          presentation.vertices.byteLength
        );
      }

      const encoder = device.createCommandEncoder({ label: "Studio retained tile presentation" });
      const presentationTexture = context.getCurrentTexture();
      presentationSnapshot = this.retainReadbackSnapshot
        ? this.acquireFrameSnapshot(
            device,
            format,
            this.canvas.width,
            this.canvas.height
          )
        : null;
      const pass = encoder.beginRenderPass({
        label: "Studio retained tile presentation",
        colorAttachments: [{
          view: presentationTexture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      if (presentationBuffer && presentation.draws.length > 0) {
        pass.setPipeline(presentationPipeline);
        pass.setVertexBuffer(0, presentationBuffer);
        for (const draw of presentation.draws) {
          const bindGroup = this.presentationBindGroupFor(draw.resource, draw.tileId);
          if (!bindGroup) throw new Error("Studio WebGPU tile presentation binding unavailable");
          pass.setBindGroup(0, bindGroup);
          pass.draw(draw.vertexCount, 1, draw.firstVertex, 0);
        }
      }
      pass.end();
      if (presentationSnapshot) {
        encoder.copyTextureToTexture(
          { texture: presentationTexture },
          { texture: presentationSnapshot.texture },
          {
            width: presentationSnapshot.width,
            height: presentationSnapshot.height,
            depthOrArrayLayers: 1,
          }
        );
      }
      device.queue.submit([encoder.finish()]);
      const completion = this.submittedWork(device);
      const released = runtime.releaseFrame(token);
      if (this.activeTileFrame?.token === token) this.activeTileFrame = null;
      if (!released) throw new Error("Studio WebGPU tile frame release failed");

      // The queue owns immutable copies of both staging buffers at this point and submissions are
      // strictly ordered. Release the CPU tile pin immediately, then let one newer pointer frame
      // overlap this fence. Authority is still published only after `completion` resolves.
      const submittedSnapshot = presentationSnapshot;
      presentationSnapshot = null;
      this.incrementWebGpuPresentation(device);
      void this.settleSubmittedWebGpuFrame({
        completion,
        device,
        runtime,
        token,
        strokes,
        requestId,
        frameGeneration,
        submittedDabCount: resolved.dabCount,
        snapshot: submittedSnapshot,
      });
    } catch {
      if (runtime && token) runtime.abortFrame(token);
      if (this.activeTileFrame?.token === token) this.activeTileFrame = null;
      // Validation/context errors do not always resolve `device.lost`. Revoke this selected
      // provider's presentation; never continue the same operation through Canvas2D.
      if (
        !this.disposed
        && frameGeneration === this.frameGeneration
        && requestId === this.lastRequestId
        && this.device === device
        && this.backend === "webgpu"
      ) {
        this.markSelectedBackendUnavailable();
      }
    } finally {
      if (presentationSnapshot) this.retireFrameSnapshot(presentationSnapshot);
    }
  }

  private async settleSubmittedWebGpuFrame(input: {
    readonly completion: Promise<void>;
    readonly device: GPUDevice;
    readonly runtime: StudioGpuTileRuntime<GPUTexture>;
    readonly token: StudioGpuTileFrameToken;
    readonly strokes: readonly StudioGpuStroke[];
    readonly requestId: string;
    readonly frameGeneration: number;
    readonly submittedDabCount: number;
    readonly snapshot: StudioGpuFrameSnapshot | null;
  }): Promise<void> {
    let snapshotHandled = false;
    try {
      await input.completion;
      if (!this.isCurrentWebGpuFrame(
        input.device,
        input.runtime,
        input.token,
        input.requestId,
        input.frameGeneration,
        false
      )) {
        return;
      }
      this.recordRenderedTileFrame(input.strokes, input.submittedDabCount);
      const receipt = this.createFrameReceipt(input.strokes, input.requestId);
      const frame = this.publishAuthorityFrame(receipt, input.snapshot);
      snapshotHandled = input.snapshot !== null;
      if (frame) {
        this.backendAvailable = true;
        this.presentationAvailable = true;
        this.setSurfaceVisibility("webgpu");
        this.options.onFrameReady?.(receipt);
      }
    } catch {
      // A rejected completion fence has the same fail-closed policy as a synchronous
      // validation/context failure, but only while this exact request and device still own output.
      if (
        !this.disposed
        && input.frameGeneration === this.frameGeneration
        && input.requestId === this.lastRequestId
        && this.device === input.device
        && this.backend === "webgpu"
      ) {
        this.markSelectedBackendUnavailable();
      }
    } finally {
      if (input.snapshot && !snapshotHandled) this.retireFrameSnapshot(input.snapshot);
      this.decrementWebGpuPresentation(input.device);
    }
  }

  private submittedWork(device: GPUDevice): Promise<void> {
    return typeof device.queue.onSubmittedWorkDone === "function"
      ? device.queue.onSubmittedWorkDone()
      : Promise.resolve();
  }

  private isCurrentWebGpuFrame(
    device: GPUDevice,
    runtime: StudioGpuTileRuntime<GPUTexture>,
    token: StudioGpuTileFrameToken,
    requestId: string,
    frameGeneration: number,
    requireActiveToken = true
  ): boolean {
    return this.isUsableWebGpuFrame(device, runtime, token, requireActiveToken)
      && frameGeneration === this.frameGeneration
      && requestId === this.lastRequestId;
  }

  private isUsableWebGpuFrame(
    device: GPUDevice,
    runtime: StudioGpuTileRuntime<GPUTexture>,
    token: StudioGpuTileFrameToken,
    requireActiveToken = true
  ): boolean {
    return !this.disposed
      && this.device === device
      && this.tileRuntime === runtime
      && (!requireActiveToken || this.activeTileFrame?.token === token)
      && this.backend === "webgpu";
  }

  private renderCanvas2d(
    strokes: readonly StudioGpuStroke[],
    requestId: string,
    frameGeneration: number
  ): void {
    const context = this.ensureSelectedCanvas2d();
    if (!context) {
      this.markSelectedBackendUnavailable({ invalidateFrame: false });
      return;
    }
    const update = this.planRenderUpdate(strokes);
    renderStudioCanvas2dDabSurface({
      context,
      surfaceWidth: this.canvas2dCanvas.width,
      surfaceHeight: this.canvas2dCanvas.height,
      viewport: this.viewport,
      update,
    });
    const complete = this.recordRenderedFrame(strokes, update);
    if (
      complete
      && !this.disposed
      && frameGeneration === this.frameGeneration
      && requestId === this.lastRequestId
      && this.backend === "canvas2d"
    ) {
      const receipt = this.createFrameReceipt(strokes, requestId);
      if (this.publishAuthorityFrame(receipt, null)) {
        this.presentationAvailable = true;
        this.setSurfaceVisibility("canvas2d");
        this.options.onFrameReady?.(receipt);
      }
    }
  }

  private createFrameReceipt(
    strokes: readonly StudioGpuStroke[],
    requestId: string
  ): StudioGpuFrameReceipt {
    return Object.freeze({
      requestId,
      fingerprint: fingerprintStudioGpuFrame(
        strokes,
        this.viewport,
        this.canvas.width,
        this.canvas.height
      ),
      backend: this.backend,
      complete: true,
      strokeCount: strokes.length,
      dabCount: this.renderedDabCount,
      physicalWidth: this.canvas.width,
      physicalHeight: this.canvas.height,
    });
  }
}
