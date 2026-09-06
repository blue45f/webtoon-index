/**
 * Bounded Google Ink mesh island for the existing /studio live-stroke path.
 *
 * The retained Canvas2D/Konva stroke remains the one primary paint owner. This
 * island consumes the same authoritative coalesced DrawEl suffix into one
 * upstream InProgressStroke and keeps GPU buffers current, but presents only a
 * replaceable predicted tail. Predicted samples therefore never enter the
 * document, CRDT stream, or authoritative mesh session.
 */

import {
  INK_MESH_DELTA_PROTOCOL,
  InkMeshError,
  applyInkStrokeMeshDelta,
  createEmptyInkStrokeMeshReplica,
  inkMeshBrushParamsFromStudioBrushTip,
  inkMeshOrientationRadFromStudioLivePose,
  inkMeshTiltRadFromStudioLivePose,
  loadInkMeshGenerator,
  type InkMeshBrushParams,
  type InkMeshGenerator,
  type InkMeshInputPoint,
  type InkStrokeMesh,
  type InkStrokeMeshDelta,
  type InkStrokeMeshReplica,
  type InProgressInkStroke,
} from "@toonspectrum/studio-brush-platform";

import {
  acquireStudioGpuDevice,
  onStudioGpuDeviceLost,
  type StudioGpuDeviceLossEvent,
} from "../render/studio-gpu-fabric";

import type { StudioLiveInkSurface } from "../live/studio-live-ink-overlay";
import type { DrawEl } from "../studio-element-model";

export const STUDIO_INK_MESH_LIVE_PREVIEW_LIMITS = Object.freeze({
  maxPoints: 32_768,
  maxVertices: 524_288,
  maxTriangles: 1_048_576,
  maxGeometryBytes: 32 * 1024 * 1024,
  maxDeltaBytes: 16 * 1024 * 1024,
  maxBackingPixels: 16_777_216,
} as const);

const BUFFER_USAGE_COPY_DST = 0x0008;
const BUFFER_USAGE_INDEX = 0x0010;
const BUFFER_USAGE_VERTEX = 0x0020;
const BUFFER_USAGE_UNIFORM = 0x0040;
const FLOAT_BYTES = Float32Array.BYTES_PER_ELEMENT;
const INDEX_BYTES = Uint32Array.BYTES_PER_ELEMENT;

export type StudioInkMeshUnavailableCode =
  | "authoritative-prefix-rewritten"
  | "buffer-admission-rejected"
  | "device-lost"
  | "gpu-unavailable"
  | "invalid-input"
  | "predicted-prefix-mismatch"
  | "runtime-error"
  | "surface-unavailable";

export interface StudioInkMeshUnavailableReceipt {
  readonly status: "unavailable";
  readonly code: StudioInkMeshUnavailableCode;
  readonly detail: string;
  /** This renderer already owned the authoritative stroke before the optional mesh preview ran. */
  readonly retainedPixelAuthority: "canvas2d-perfect-freehand";
  readonly strokeId: string | null;
}

export interface StudioInkMeshGpuWriteReceipt {
  readonly kind: "indices" | "positions" | "tex-coords";
  readonly offsetBytes: number;
  readonly byteLength: number;
  readonly fullReplacement: boolean;
}

export interface StudioInkMeshGpuApplyReceipt {
  readonly status: "applied";
  readonly revision: number;
  readonly writes: readonly StudioInkMeshGpuWriteReceipt[];
  readonly drawFirstIndex: number;
  readonly drawIndexCount: number;
  readonly geometryBytes: number;
  readonly gpuReadbackCount: 0;
}

export interface StudioInkMeshPreviewReceipt {
  readonly status: "rendered";
  readonly strokeId: string;
  readonly authoritativePointCount: number;
  readonly predictedPointCount: number;
  readonly retainedTriangleCount: number;
  readonly revision: number;
  readonly gpu: StudioInkMeshGpuApplyReceipt;
}

export interface StudioInkMeshAuthoritativeReceipt {
  readonly status: "started" | "synchronized";
  readonly strokeId: string;
  readonly authoritativePointCount: number;
  readonly revision: number;
  readonly backend: "upstream-in-progress";
  readonly gpu: StudioInkMeshGpuApplyReceipt;
}

export interface StudioInkMeshFinishReceipt {
  readonly status: "finished";
  readonly strokeId: string;
  readonly authoritativePointCount: number;
  readonly finalMesh: InkStrokeMeshReplica;
  readonly backend: "upstream-in-progress";
  readonly gpuReadbackCount: 0;
}

export type StudioInkMeshLiveReceipt =
  | StudioInkMeshAuthoritativeReceipt
  | StudioInkMeshUnavailableReceipt
  | StudioInkMeshFinishReceipt
  | StudioInkMeshPreviewReceipt
  | Readonly<{ status: "inactive" }>;

export interface StudioInkMeshStrokeLike extends Pick<
  DrawEl,
  | "altitudeAngles"
  | "azimuthAngles"
  | "brushTip"
  | "id"
  | "mode"
  | "opacity"
  | "points"
  | "pressures"
  | "sampleTimeOffsets"
  | "stroke"
  | "strokeWidth"
  | "symmetry"
  | "tiltXs"
  | "tiltYs"
  | "twists"
> {
  readonly fill?: string;
  readonly kind?: DrawEl["kind"];
}

export interface StudioInkMeshPreviewSink {
  readonly replica: InkStrokeMeshReplica;
  setColor?(color: string, opacity: number): boolean;
  apply(
    delta: InkStrokeMeshDelta,
    drawFromTriangle: number,
  ): StudioInkMeshGpuApplyReceipt;
  setSurface(surface: StudioLiveInkSurface | null): void;
  reset(): void;
  dispose(): void;
}

export interface StudioInkMeshPreparedResources {
  readonly generator: InkMeshGenerator;
  readonly sink: StudioInkMeshPreviewSink;
  readonly deviceEpoch: number;
  release(): void;
}

export interface StudioInkMeshLivePreviewRuntimeOptions {
  readonly prepareResources?: (
    canvas: HTMLCanvasElement,
  ) => Promise<StudioInkMeshPreparedResources | null>;
  readonly subscribeDeviceLoss?: (
    listener: (event: StudioGpuDeviceLossEvent) => void,
  ) => () => void;
  readonly onUnavailable?: (receipt: StudioInkMeshUnavailableReceipt) => void;
}

/**
 * Rehydrates Studio's O(1) prediction draft (origin + authority endpoint +
 * predicted suffix) into the complete transient mesh input. The returned
 * object is private preview data; the authoritative DrawEl is never mutated.
 */
export function expandStudioInkMeshPredictedSuffix<T extends StudioInkMeshStrokeLike>(
  authoritative: T,
  compactDraft: T,
  compactPredictionStartSampleIndex: number,
): T {
  const authoritativeCount = pointCount(authoritative);
  const compactCount = pointCount(compactDraft);
  if (
    !Number.isSafeInteger(compactPredictionStartSampleIndex)
    || compactPredictionStartSampleIndex < 1
    || compactPredictionStartSampleIndex > compactCount
  ) {
    throw new StudioInkMeshPreviewError(
      "predicted-prefix-mismatch",
      "Studio compact prediction suffix has an invalid start index.",
    );
  }
  const appendChannel = (
    authority: readonly number[] | undefined,
    compact: readonly number[] | undefined,
  ): number[] | undefined => {
    if (!authority && !compact) return undefined;
    const prefix = Array.from(
      { length: authoritativeCount },
      (_, index) => authority?.[index] ?? 0,
    );
    return [
      ...prefix,
      ...(compact?.slice(compactPredictionStartSampleIndex) ?? []),
    ];
  };
  return {
    ...compactDraft,
    points: [
      ...authoritative.points,
      ...compactDraft.points.slice(compactPredictionStartSampleIndex * 2),
    ],
    pressures: appendChannel(authoritative.pressures, compactDraft.pressures),
    altitudeAngles: appendChannel(
      authoritative.altitudeAngles,
      compactDraft.altitudeAngles,
    ),
    azimuthAngles: appendChannel(
      authoritative.azimuthAngles,
      compactDraft.azimuthAngles,
    ),
    sampleTimeOffsets: appendChannel(
      authoritative.sampleTimeOffsets,
      compactDraft.sampleTimeOffsets,
    ),
    tiltXs: appendChannel(authoritative.tiltXs, compactDraft.tiltXs),
    tiltYs: appendChannel(authoritative.tiltYs, compactDraft.tiltYs),
    twists: appendChannel(authoritative.twists, compactDraft.twists),
  } as T;
}

export class StudioInkMeshPreviewError extends Error {
  readonly code: StudioInkMeshUnavailableCode;

  constructor(code: StudioInkMeshUnavailableCode, message: string) {
    super(message);
    this.name = "StudioInkMeshPreviewError";
    this.code = code;
  }
}

function geometryBytes(mesh: InkStrokeMesh): number {
  return mesh.vertices.byteLength + mesh.texCoords.byteLength + mesh.triangles.byteLength;
}

function validateMeshAdmission(mesh: InkStrokeMesh): void {
  if (
    !Number.isSafeInteger(mesh.vertexCount)
    || !Number.isSafeInteger(mesh.triangleCount)
    || mesh.vertexCount < 0
    || mesh.triangleCount < 0
    || mesh.vertices.length !== mesh.vertexCount * 2
    || mesh.texCoords.length !== mesh.vertexCount * 2
    || mesh.triangles.length !== mesh.triangleCount * 3
  ) {
    throw new StudioInkMeshPreviewError(
      "buffer-admission-rejected",
      "Google Ink mesh counts and typed-array lengths disagree.",
    );
  }
  if (
    mesh.vertexCount > STUDIO_INK_MESH_LIVE_PREVIEW_LIMITS.maxVertices
    || mesh.triangleCount > STUDIO_INK_MESH_LIVE_PREVIEW_LIMITS.maxTriangles
    || geometryBytes(mesh) > STUDIO_INK_MESH_LIVE_PREVIEW_LIMITS.maxGeometryBytes
  ) {
    throw new StudioInkMeshPreviewError(
      "buffer-admission-rejected",
      "Google Ink mesh exceeds the live-preview vertex, triangle, or byte budget.",
    );
  }
  for (const value of mesh.vertices) {
    if (!Number.isFinite(value)) {
      throw new StudioInkMeshPreviewError(
        "buffer-admission-rejected",
        "Google Ink mesh contains a non-finite or overflowing position.",
      );
    }
  }
  for (const value of mesh.texCoords) {
    if (!Number.isFinite(value)) {
      throw new StudioInkMeshPreviewError(
        "buffer-admission-rejected",
        "Google Ink mesh contains a non-finite or overflowing texture coordinate.",
      );
    }
  }
  for (const index of mesh.triangles) {
    if (index >= mesh.vertexCount) {
      throw new StudioInkMeshPreviewError(
        "buffer-admission-rejected",
        `Google Ink mesh index ${index} exceeds vertex count ${mesh.vertexCount}.`,
      );
    }
  }
}

function firstChangedVertex(left: InkStrokeMesh, right: InkStrokeMesh): number {
  const limit = Math.min(left.vertexCount, right.vertexCount);
  for (let index = 0; index < limit; index += 1) {
    const offset = index * 2;
    if (
      left.vertices[offset] !== right.vertices[offset]
      || left.vertices[offset + 1] !== right.vertices[offset + 1]
      || left.texCoords[offset] !== right.texCoords[offset]
      || left.texCoords[offset + 1] !== right.texCoords[offset + 1]
    ) return index;
  }
  return limit;
}

function firstChangedTriangle(left: InkStrokeMesh, right: InkStrokeMesh): number {
  const limit = Math.min(left.triangleCount, right.triangleCount);
  for (let index = 0; index < limit; index += 1) {
    const offset = index * 3;
    if (
      left.triangles[offset] !== right.triangles[offset]
      || left.triangles[offset + 1] !== right.triangles[offset + 1]
      || left.triangles[offset + 2] !== right.triangles[offset + 2]
    ) return index;
  }
  return limit;
}

/** Creates one protocol-valid retained-prefix/replacement-tail display delta. */
export function createStudioInkMeshReplacementDelta(
  replica: InkStrokeMeshReplica,
  target: InkStrokeMesh,
  inputCount: number,
  finished = false,
): InkStrokeMeshDelta {
  validateMeshAdmission(target);
  const retainedVertexCount = firstChangedVertex(replica, target);
  const retainedTriangleCount = firstChangedTriangle(replica, target);
  const vertices = target.vertices.slice(retainedVertexCount * 2);
  const texCoords = target.texCoords.slice(retainedVertexCount * 2);
  const triangles = target.triangles.slice(retainedTriangleCount * 3);
  const changed =
    replica.vertexCount !== target.vertexCount
    || replica.triangleCount !== target.triangleCount
    || vertices.length > 0
    || triangles.length > 0;
  const operation = !changed
    ? "noop" as const
    : retainedVertexCount === replica.vertexCount
      && retainedTriangleCount === replica.triangleCount
      ? "append" as const
      : "update" as const;
  const payloadBytes = vertices.byteLength + texCoords.byteLength + triangles.byteLength;
  if (payloadBytes > STUDIO_INK_MESH_LIVE_PREVIEW_LIMITS.maxDeltaBytes) {
    throw new StudioInkMeshPreviewError(
      "buffer-admission-rejected",
      `Google Ink replacement delta ${payloadBytes} bytes exceeds the live budget.`,
    );
  }
  return {
    protocol: INK_MESH_DELTA_PROTOCOL,
    baseRevision: replica.revision,
    revision: replica.revision + 1,
    operation,
    retainedVertexCount,
    retainedTriangleCount,
    vertices,
    texCoords,
    triangles,
    vertexCount: target.vertexCount,
    triangleCount: target.triangleCount,
    inputCount,
    finished,
    payloadBytes,
  };
}

function alignedCapacity(required: number, maximum: number): number {
  if (required <= 0) return 0;
  let capacity = 4_096;
  while (capacity < required && capacity < maximum) capacity *= 2;
  if (capacity < required || capacity > maximum) {
    throw new StudioInkMeshPreviewError(
      "buffer-admission-rejected",
      `GPU buffer request ${required} bytes exceeds the admitted ${maximum} byte range.`,
    );
  }
  return capacity;
}

interface OwnedGpuBuffer {
  readonly buffer: GPUBuffer;
  readonly capacity: number;
}

interface ParsedColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
}

function parseHexByte(value: string): number | null {
  const parsed = Number.parseInt(value, 16);
  return Number.isFinite(parsed) ? parsed / 255 : null;
}

export function parseStudioInkMeshColor(value: string, opacity: number): ParsedColor | null {
  const source = value.trim();
  const normalizedOpacity = Number.isFinite(opacity)
    ? Math.min(1, Math.max(0, opacity))
    : 1;
  if (/^#[0-9a-f]{3,4}$/iu.test(source)) {
    const red = parseHexByte(`${source[1]}${source[1]}`);
    const green = parseHexByte(`${source[2]}${source[2]}`);
    const blue = parseHexByte(`${source[3]}${source[3]}`);
    const alpha = source.length === 5 ? parseHexByte(`${source[4]}${source[4]}`) : 1;
    if (red === null || green === null || blue === null || alpha === null) return null;
    return { red, green, blue, alpha: alpha * normalizedOpacity };
  }
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/iu.test(source)) {
    const red = parseHexByte(source.slice(1, 3));
    const green = parseHexByte(source.slice(3, 5));
    const blue = parseHexByte(source.slice(5, 7));
    const alpha = source.length === 9 ? parseHexByte(source.slice(7, 9)) : 1;
    if (red === null || green === null || blue === null || alpha === null) return null;
    return { red, green, blue, alpha: alpha * normalizedOpacity };
  }
  return null;
}

const INK_MESH_SHADER = /* wgsl */ `
struct Params {
  surface: vec4f,
  document: vec4f,
  color: vec4f,
}

@group(0) @binding(0) var<uniform> params: Params;

struct VertexOutput {
  @builtin(position) position: vec4f,
}

@vertex fn vertex_main(@location(0) document_position: vec2f) -> VertexOutput {
  let scale = params.surface.x;
  let surface_left = params.surface.y;
  let surface_top = params.surface.z;
  let surface_width = params.surface.w;
  let surface_height = params.document.x;
  let document_width = params.document.y;
  let flip_x = params.document.z > 0.5;
  let document_x = select(document_position.x, document_width - document_position.x, flip_x);
  let pixel_x = document_x * scale - surface_left;
  let pixel_y = document_position.y * scale - surface_top;
  var output: VertexOutput;
  output.position = vec4f(
    pixel_x / surface_width * 2.0 - 1.0,
    1.0 - pixel_y / surface_height * 2.0,
    0.0,
    1.0,
  );
  return output;
}

@fragment fn fragment_main() -> @location(0) vec4f {
  return params.color;
}
`;

/** WebGPU replica that updates only the changed typed-array subranges. */
export class StudioInkMeshGpuBufferRuntime implements StudioInkMeshPreviewSink {
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly canvas: HTMLCanvasElement;
  private readonly format: GPUTextureFormat;
  private readonly pipeline: GPURenderPipeline;
  private readonly uniformBuffer: GPUBuffer;
  private readonly bindGroup: GPUBindGroup;
  private positions: OwnedGpuBuffer | null = null;
  private texCoords: OwnedGpuBuffer | null = null;
  private indices: OwnedGpuBuffer | null = null;
  private currentSurface: StudioLiveInkSurface | null = null;
  private currentColor: ParsedColor = { red: 0, green: 0, blue: 0, alpha: 1 };
  private currentReplica = createEmptyInkStrokeMeshReplica();
  private disposed = false;
  private writes = 0;
  private bytesWritten = 0;
  private reallocations = 0;

  constructor(input: Readonly<{
    canvas: HTMLCanvasElement;
    context: GPUCanvasContext;
    device: GPUDevice;
    format: GPUTextureFormat;
  }>) {
    this.canvas = input.canvas;
    this.context = input.context;
    this.device = input.device;
    this.format = input.format;
    const module = this.device.createShaderModule({
      label: "Studio Google Ink live-tail shader",
      code: INK_MESH_SHADER,
    });
    this.pipeline = this.device.createRenderPipeline({
      label: "Studio Google Ink live-tail pipeline",
      layout: "auto",
      vertex: {
        module,
        entryPoint: "vertex_main",
        buffers: [{
          arrayStride: 2 * FLOAT_BYTES,
          attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
        }],
      },
      fragment: {
        module,
        entryPoint: "fragment_main",
        targets: [{
          format: this.format,
          blend: {
            color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
          },
        }],
      },
      primitive: { topology: "triangle-list" },
    });
    this.uniformBuffer = this.device.createBuffer({
      label: "Studio Google Ink live-tail uniforms",
      size: 12 * FLOAT_BYTES,
      usage: BUFFER_USAGE_UNIFORM | BUFFER_USAGE_COPY_DST,
    });
    this.bindGroup = this.device.createBindGroup({
      label: "Studio Google Ink live-tail bind group",
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
  }

  get replica(): InkStrokeMeshReplica {
    return this.currentReplica;
  }

  setColor(color: string, opacity: number): boolean {
    const parsed = parseStudioInkMeshColor(color, opacity);
    if (!parsed) return false;
    this.currentColor = parsed;
    return true;
  }

  setSurface(surface: StudioLiveInkSurface | null): void {
    this.ensureUsable();
    this.currentSurface = surface;
    if (!surface) {
      this.canvas.style.visibility = "hidden";
      return;
    }
    const nativeDpr = Number(globalThis.devicePixelRatio);
    const dpr = Number.isFinite(nativeDpr) && nativeDpr > 0 ? nativeDpr : 1;
    const width = Math.max(1, Math.round(surface.width * dpr));
    const height = Math.max(1, Math.round(surface.height * dpr));
    if (
      !Number.isFinite(surface.left)
      || !Number.isFinite(surface.top)
      || !Number.isFinite(surface.width)
      || !Number.isFinite(surface.height)
      || !Number.isFinite(surface.documentScale)
      || !Number.isFinite(surface.documentWidth)
      || surface.width <= 0
      || surface.height <= 0
      || surface.documentScale <= 0
      || surface.documentWidth <= 0
      || width * height > STUDIO_INK_MESH_LIVE_PREVIEW_LIMITS.maxBackingPixels
    ) {
      throw new StudioInkMeshPreviewError(
        "surface-unavailable",
        "Google Ink live-tail surface exceeds the exact native-resolution budget.",
      );
    }
    this.canvas.width = width;
    this.canvas.height = height;
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: "premultiplied",
    });
    this.render(this.currentReplica.triangleCount);
  }

  apply(
    delta: InkStrokeMeshDelta,
    drawFromTriangle: number,
  ): StudioInkMeshGpuApplyReceipt {
    this.ensureUsable();
    if (
      !Number.isSafeInteger(drawFromTriangle)
      || drawFromTriangle < 0
      || delta.payloadBytes !== (
        delta.vertices.byteLength + delta.texCoords.byteLength + delta.triangles.byteLength
      )
    ) {
      throw new StudioInkMeshPreviewError(
        "buffer-admission-rejected",
        "Google Ink delta draw range or byte receipt is malformed.",
      );
    }
    const next = applyInkStrokeMeshDelta(this.currentReplica, delta);
    validateMeshAdmission(next);
    if (drawFromTriangle > next.triangleCount) {
      throw new StudioInkMeshPreviewError(
        "buffer-admission-rejected",
        "Google Ink predicted draw range exceeds the current triangle count.",
      );
    }
    const writeReceipts: StudioInkMeshGpuWriteReceipt[] = [];
    const maxBufferSizeValue = Number((this.device.limits as { maxBufferSize?: number }).maxBufferSize);
    const maximumBuffer = Number.isFinite(maxBufferSizeValue) && maxBufferSizeValue > 0
      ? Math.min(maxBufferSizeValue, STUDIO_INK_MESH_LIVE_PREVIEW_LIMITS.maxGeometryBytes)
      : STUDIO_INK_MESH_LIVE_PREVIEW_LIMITS.maxGeometryBytes;
    this.positions = this.writeGeometryBuffer({
      current: this.positions,
      requiredBytes: next.vertices.byteLength,
      maximumBuffer,
      label: "Studio Google Ink positions",
      usage: BUFFER_USAGE_VERTEX | BUFFER_USAGE_COPY_DST,
      full: next.vertices,
      tail: delta.vertices,
      retainedOffsetBytes: delta.retainedVertexCount * 2 * FLOAT_BYTES,
      kind: "positions",
      receipts: writeReceipts,
    });
    this.texCoords = this.writeGeometryBuffer({
      current: this.texCoords,
      requiredBytes: next.texCoords.byteLength,
      maximumBuffer,
      label: "Studio Google Ink texture coordinates",
      usage: BUFFER_USAGE_VERTEX | BUFFER_USAGE_COPY_DST,
      full: next.texCoords,
      tail: delta.texCoords,
      retainedOffsetBytes: delta.retainedVertexCount * 2 * FLOAT_BYTES,
      kind: "tex-coords",
      receipts: writeReceipts,
    });
    this.indices = this.writeGeometryBuffer({
      current: this.indices,
      requiredBytes: next.triangles.byteLength,
      maximumBuffer,
      label: "Studio Google Ink indices",
      usage: BUFFER_USAGE_INDEX | BUFFER_USAGE_COPY_DST,
      full: next.triangles,
      tail: delta.triangles,
      retainedOffsetBytes: delta.retainedTriangleCount * 3 * INDEX_BYTES,
      kind: "indices",
      receipts: writeReceipts,
    });
    this.currentReplica = next;
    this.render(drawFromTriangle);
    return {
      status: "applied",
      revision: next.revision,
      writes: writeReceipts,
      drawFirstIndex: drawFromTriangle * 3,
      drawIndexCount: (next.triangleCount - drawFromTriangle) * 3,
      geometryBytes: geometryBytes(next),
      gpuReadbackCount: 0,
    };
  }

  metrics(): Readonly<{
    writes: number;
    bytesWritten: number;
    reallocations: number;
    gpuReadbackCount: 0;
  }> {
    return {
      writes: this.writes,
      bytesWritten: this.bytesWritten,
      reallocations: this.reallocations,
      gpuReadbackCount: 0,
    };
  }

  reset(): void {
    if (this.disposed) return;
    this.destroyGeometryBuffers();
    this.currentReplica = createEmptyInkStrokeMeshReplica();
    this.render(0);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.destroyGeometryBuffers();
    this.uniformBuffer.destroy();
    try {
      this.context.unconfigure();
    } catch {
      // A lost canvas context can already be unconfigured.
    }
    this.canvas.style.visibility = "hidden";
  }

  private ensureUsable(): void {
    if (this.disposed) {
      throw new StudioInkMeshPreviewError(
        "runtime-error",
        "Google Ink GPU preview runtime is disposed.",
      );
    }
  }

  private writeGeometryBuffer(input: Readonly<{
    current: OwnedGpuBuffer | null;
    requiredBytes: number;
    maximumBuffer: number;
    label: string;
    usage: number;
    full: Float32Array | Uint32Array;
    tail: Float32Array | Uint32Array;
    retainedOffsetBytes: number;
    kind: StudioInkMeshGpuWriteReceipt["kind"];
    receipts: StudioInkMeshGpuWriteReceipt[];
  }>): OwnedGpuBuffer | null {
    if (input.requiredBytes === 0) {
      input.current?.buffer.destroy();
      return null;
    }
    let owned = input.current;
    let fullReplacement = false;
    if (!owned || owned.capacity < input.requiredBytes) {
      const capacity = alignedCapacity(input.requiredBytes, input.maximumBuffer);
      const buffer = this.device.createBuffer({
        label: input.label,
        size: capacity,
        usage: input.usage,
      });
      owned?.buffer.destroy();
      owned = { buffer, capacity };
      fullReplacement = true;
      this.reallocations += 1;
    }
    const source = fullReplacement ? input.full : input.tail;
    const offsetBytes = fullReplacement ? 0 : input.retainedOffsetBytes;
    if (source.byteLength > 0) {
      if (
        !Number.isSafeInteger(offsetBytes)
        || offsetBytes < 0
        || offsetBytes + source.byteLength > owned.capacity
      ) {
        owned.buffer.destroy();
        throw new StudioInkMeshPreviewError(
          "buffer-admission-rejected",
          `Google Ink ${input.kind} subrange exceeds its allocated GPU buffer.`,
        );
      }
      this.device.queue.writeBuffer(
        owned.buffer,
        offsetBytes,
        source.buffer,
        source.byteOffset,
        source.byteLength,
      );
      this.writes += 1;
      this.bytesWritten += source.byteLength;
      input.receipts.push({
        kind: input.kind,
        offsetBytes,
        byteLength: source.byteLength,
        fullReplacement,
      });
    }
    return owned;
  }

  private render(drawFromTriangle: number): void {
    const surface = this.currentSurface;
    if (!surface) {
      this.canvas.style.visibility = "hidden";
      return;
    }
    const uniform = new Float32Array([
      surface.documentScale,
      surface.left,
      surface.top,
      surface.width,
      surface.height,
      surface.documentWidth,
      surface.flipX ? 1 : 0,
      0,
      this.currentColor.red,
      this.currentColor.green,
      this.currentColor.blue,
      this.currentColor.alpha,
    ]);
    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      uniform.buffer,
      uniform.byteOffset,
      uniform.byteLength,
    );
    const encoder = this.device.createCommandEncoder({
      label: "Studio Google Ink live-tail encoder",
    });
    const pass = encoder.beginRenderPass({
      label: "Studio Google Ink live-tail pass",
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: "clear",
        storeOp: "store",
      }],
    });
    const drawIndexCount = (this.currentReplica.triangleCount - drawFromTriangle) * 3;
    if (drawIndexCount > 0 && this.positions && this.indices) {
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, this.bindGroup);
      pass.setVertexBuffer(0, this.positions.buffer);
      pass.setIndexBuffer(this.indices.buffer, "uint32");
      pass.drawIndexed(drawIndexCount, 1, drawFromTriangle * 3, 0, 0);
    }
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    this.canvas.style.visibility = drawIndexCount > 0 ? "visible" : "hidden";
  }

  private destroyGeometryBuffers(): void {
    this.positions?.buffer.destroy();
    this.texCoords?.buffer.destroy();
    this.indices?.buffer.destroy();
    this.positions = null;
    this.texCoords = null;
    this.indices = null;
  }
}

function preferredCanvasFormat(): GPUTextureFormat {
  if (typeof navigator !== "undefined") {
    const gpu = (navigator as { gpu?: GPU }).gpu;
    const preferred = gpu?.getPreferredCanvasFormat?.();
    if (preferred === "bgra8unorm" || preferred === "rgba8unorm") return preferred;
  }
  return "bgra8unorm";
}

async function prepareDefaultResources(
  canvas: HTMLCanvasElement,
): Promise<StudioInkMeshPreparedResources | null> {
  const [generator, lease] = await Promise.all([
    loadInkMeshGenerator(),
    acquireStudioGpuDevice(),
  ]);
  if (!lease) return null;
  const context = (() => {
    try {
      return canvas.getContext("webgpu") as GPUCanvasContext | null;
    } catch {
      return null;
    }
  })();
  if (!context) {
    lease.release();
    return null;
  }
  try {
    const sink = new StudioInkMeshGpuBufferRuntime({
      canvas,
      context,
      device: lease.device,
      format: preferredCanvasFormat(),
    });
    return {
      generator,
      sink,
      deviceEpoch: lease.epoch,
      release: () => lease.release(),
    };
  } catch {
    lease.release();
    return null;
  }
}

function pointCount(stroke: StudioInkMeshStrokeLike): number {
  if (stroke.points.length % 2 !== 0) {
    throw new StudioInkMeshPreviewError(
      "invalid-input",
      "Studio live stroke has an odd coordinate count.",
    );
  }
  const count = stroke.points.length / 2;
  if (count < 1 || count > STUDIO_INK_MESH_LIVE_PREVIEW_LIMITS.maxPoints) {
    throw new StudioInkMeshPreviewError(
      "invalid-input",
      `Studio live stroke point count ${count} is outside the admitted range.`,
    );
  }
  return count;
}

function finiteChannel(
  values: readonly number[] | undefined,
  index: number,
  fallback: number,
): number {
  const value = values?.[index];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * DrawEl channels → ink input points. The tilt/orientation mapping is the
 * canonical live-lane derivation exported by @toonspectrum/studio-brush-platform
 * (ink-mesh-derivation) — the same pure module `compileMeshBrush` delegates to —
 * so the preview cannot drift from the compiled mesh programs. This module only
 * keeps the admission validation.
 */
function strokeInputPoints(
  stroke: StudioInkMeshStrokeLike,
  pressures: readonly number[] | undefined,
  startIndex: number,
  endIndex: number,
): InkMeshInputPoint[] {
  const count = pointCount(stroke);
  if (
    !Number.isSafeInteger(startIndex)
    || !Number.isSafeInteger(endIndex)
    || startIndex < 0
    || endIndex < startIndex
    || endIndex > count
  ) {
    throw new StudioInkMeshPreviewError(
      "invalid-input",
      "Studio live stroke suffix range is invalid.",
    );
  }
  const result: InkMeshInputPoint[] = [];
  for (let index = startIndex; index < endIndex; index += 1) {
    const x = stroke.points[index * 2];
    const y = stroke.points[index * 2 + 1];
    const pressure = finiteChannel(pressures ?? stroke.pressures, index, 0.5);
    const pose = {
      altitudeRad: finiteChannel(stroke.altitudeAngles, index, Number.NaN),
      azimuthRad: finiteChannel(stroke.azimuthAngles, index, Number.NaN),
      tiltXDeg: finiteChannel(stroke.tiltXs, index, 0),
      tiltYDeg: finiteChannel(stroke.tiltYs, index, 0),
      twistDeg: finiteChannel(stroke.twists, index, 0),
    };
    const tMs = Math.max(0, finiteChannel(stroke.sampleTimeOffsets, index, index * 4));
    if (
      x === undefined
      || y === undefined
      || !Number.isFinite(x)
      || !Number.isFinite(y)
      || !Number.isFinite(pressure)
      || pressure < 0
      || pressure > 1
    ) {
      throw new StudioInkMeshPreviewError(
        "invalid-input",
        `Studio live stroke sample ${index} has invalid position or pressure.`,
      );
    }
    result.push({
      x,
      y,
      tMs,
      pressure,
      tiltRad: inkMeshTiltRadFromStudioLivePose(pose),
      orientationRad: inkMeshOrientationRadFromStudioLivePose(pose),
    });
  }
  return result;
}

/**
 * DrawEl brushTip snapshot → ink brush params via the canonical live-lane
 * derivation in @toonspectrum/studio-brush-platform; only the fail-closed
 * width validation lives here.
 */
function brushParams(stroke: StudioInkMeshStrokeLike): InkMeshBrushParams {
  const size = Number(stroke.strokeWidth);
  if (!Number.isFinite(size) || size <= 0) {
    throw new StudioInkMeshPreviewError(
      "invalid-input",
      "Studio live stroke width is not a positive finite number.",
    );
  }
  return inkMeshBrushParamsFromStudioBrushTip({
    sizePx: size,
    roundness: Number(stroke.brushTip?.roundness),
    angleDeg: Number(stroke.brushTip?.angleDeg),
    tiltEnabled: stroke.brushTip?.tiltEnabled === true,
  });
}

/**
 * Complete live-lane input derivation, exported for the shared-derivation
 * parity contract: exactly what `begin`/`synchronizeAuthoritative` feed the
 * ink session for a full stroke.
 */
export function deriveStudioInkMeshInputPoints(
  stroke: StudioInkMeshStrokeLike,
  pressures?: readonly number[],
): InkMeshInputPoint[] {
  return strokeInputPoints(stroke, pressures, 0, pointCount(stroke));
}

/** Live-lane brush-param derivation, exported for the same parity contract. */
export function deriveStudioInkMeshBrushParams(
  stroke: StudioInkMeshStrokeLike,
): InkMeshBrushParams {
  return brushParams(stroke);
}

function inputPointEqual(left: InkMeshInputPoint, right: InkMeshInputPoint): boolean {
  return left.x === right.x
    && left.y === right.y
    && left.tMs === right.tMs
    && left.pressure === right.pressure
    && left.tiltRad === right.tiltRad
    && left.orientationRad === right.orientationRad;
}

function unavailableReceipt(
  code: StudioInkMeshUnavailableCode,
  detail: string,
  strokeId: string | null,
): StudioInkMeshUnavailableReceipt {
  return {
    status: "unavailable",
    code,
    detail,
    retainedPixelAuthority: "canvas2d-perfect-freehand",
    strokeId,
  };
}

function errorCode(error: unknown): StudioInkMeshUnavailableCode {
  if (error instanceof StudioInkMeshPreviewError) return error.code;
  if (error instanceof InkMeshError) return "invalid-input";
  return "runtime-error";
}

/**
 * Product coordinator. Authoritative samples advance only `authoritativeSession`;
 * predicted meshes alter only `displayReplica` and are discarded on the next
 * real suffix, finish, cancellation, or device loss.
 */
export class StudioInkMeshLivePreviewRuntime {
  private readonly prepareResources: NonNullable<
    StudioInkMeshLivePreviewRuntimeOptions["prepareResources"]
  >;
  private readonly onUnavailable?: (receipt: StudioInkMeshUnavailableReceipt) => void;
  private readonly unsubscribeLoss: () => void;
  private canvas: HTMLCanvasElement | null = null;
  private surface: StudioLiveInkSurface | null = null;
  private prepared: StudioInkMeshPreparedResources | null = null;
  private preparing: Promise<boolean> | null = null;
  private generation = 0;
  private authoritativeSession: InProgressInkStroke | null = null;
  private authoritativeReplica = createEmptyInkStrokeMeshReplica();
  private authoritativeInputs: InkMeshInputPoint[] = [];
  private activeStrokeId: string | null = null;
  private activeParams: InkMeshBrushParams | null = null;
  private consumedAuthoritativePoints = 0;
  private predictedPointCount = 0;
  private lastUnavailableValue: StudioInkMeshUnavailableReceipt | null = null;

  constructor(options: StudioInkMeshLivePreviewRuntimeOptions = {}) {
    this.prepareResources = options.prepareResources ?? prepareDefaultResources;
    this.onUnavailable = options.onUnavailable;
    const subscribe = options.subscribeDeviceLoss ?? onStudioGpuDeviceLost;
    this.unsubscribeLoss = subscribe((event) => this.handleDeviceLoss(event));
  }

  get ready(): boolean {
    return this.prepared !== null && this.surface !== null;
  }

  get active(): boolean {
    return this.authoritativeSession !== null && this.activeStrokeId !== null;
  }

  get strokeId(): string | null {
    return this.activeStrokeId;
  }

  get lastUnavailable(): StudioInkMeshUnavailableReceipt | null {
    return this.lastUnavailableValue;
  }

  attach(canvas: HTMLCanvasElement | null): void {
    if (this.canvas === canvas) return;
    this.reset("surface-unavailable", false);
    this.releasePreparedResources();
    this.canvas = canvas;
    this.generation += 1;
    this.preparing = null;
    if (canvas) void this.prepare();
  }

  setSurface(surface: StudioLiveInkSurface | null): void {
    this.surface = surface;
    try {
      this.prepared?.sink.setSurface(surface);
    } catch (error) {
      this.fail(errorCode(error), error instanceof Error ? error.message : String(error));
    }
  }

  async prepare(): Promise<boolean> {
    if (this.prepared && this.surface) return true;
    if (this.preparing) return this.preparing;
    const canvas = this.canvas;
    if (!canvas) return false;
    const generation = this.generation;
    this.preparing = this.prepareResources(canvas).then((prepared) => {
      if (generation !== this.generation || this.canvas !== canvas) {
        prepared?.sink.dispose();
        prepared?.release();
        return false;
      }
      if (!prepared) return false;
      this.prepared = prepared;
      try {
        prepared.sink.setSurface(this.surface);
      } catch (error) {
        prepared.sink.dispose();
        prepared.release();
        this.prepared = null;
        this.lastUnavailableValue = unavailableReceipt(
          errorCode(error),
          error instanceof Error ? error.message : String(error),
          null,
        );
        return false;
      }
      return this.surface !== null;
    }).catch(() => false).finally(() => {
      if (generation === this.generation) this.preparing = null;
    });
    return this.preparing;
  }

  begin(
    stroke: StudioInkMeshStrokeLike,
    pressures?: readonly number[],
  ): StudioInkMeshLiveReceipt {
    if (!this.prepared || !this.surface) {
      return unavailableReceipt(
        this.canvas ? "gpu-unavailable" : "surface-unavailable",
        "Google Ink WebGPU live-tail resources are not ready; existing Canvas2D ink remains active.",
        stroke.id,
      );
    }
    if (
      stroke.mode === "eraser"
      || (stroke.kind ?? "freehand") !== "freehand"
      || stroke.fill !== undefined
      || (stroke.symmetry?.type ?? "none") !== "none"
      || (stroke.opacity ?? 1) !== 1
      || (
        this.prepared.sink.setColor !== undefined
        && !this.prepared.sink.setColor(stroke.stroke, stroke.opacity ?? 1)
      )
    ) {
      return unavailableReceipt(
        "invalid-input",
        "Google Ink live-tail admission accepts one opaque, unsymmetrical freehand pen stroke with a supported solid color.",
        stroke.id,
      );
    }
    this.reset("runtime-error", false);
    try {
      const count = pointCount(stroke);
      const params = brushParams(stroke);
      const session = this.prepared.generator.createInProgressStroke(params);
      if (session.backend !== "upstream-in-progress") {
        session.dispose();
        throw new StudioInkMeshPreviewError(
          "runtime-error",
          `Studio product live ink requires the upstream-in-progress backend; received ${session.backend}.`,
        );
      }
      this.authoritativeSession = session;
      this.activeStrokeId = stroke.id;
      this.activeParams = params;
      this.authoritativeInputs = [];
      this.authoritativeReplica = createEmptyInkStrokeMeshReplica();
      this.consumedAuthoritativePoints = 0;
      this.predictedPointCount = 0;
      this.prepared.sink.reset();
      this.appendAuthoritative(stroke, pressures, 0, count);
      const gpu = this.restoreAuthoritativeDisplay();
      return {
        status: "started",
        strokeId: stroke.id,
        authoritativePointCount: this.consumedAuthoritativePoints,
        revision: this.authoritativeReplica.revision,
        backend: "upstream-in-progress",
        gpu,
      };
    } catch (error) {
      return this.fail(errorCode(error), error instanceof Error ? error.message : String(error));
    }
  }

  synchronizeAuthoritative(
    stroke: StudioInkMeshStrokeLike,
    pressures?: readonly number[],
  ): StudioInkMeshLiveReceipt {
    if (!this.authoritativeSession || this.activeStrokeId !== stroke.id) {
      return { status: "inactive" };
    }
    try {
      const count = pointCount(stroke);
      if (count < this.consumedAuthoritativePoints) {
        return this.fail(
          "authoritative-prefix-rewritten",
          "The retained Studio stroke rewrote its authoritative prefix; Google Ink yielded to Perfect Freehand.",
        );
      }
      if (count > this.consumedAuthoritativePoints) {
        this.appendAuthoritative(
          stroke,
          pressures,
          this.consumedAuthoritativePoints,
          count,
        );
      }
      const gpu = this.restoreAuthoritativeDisplay();
      return {
        status: "synchronized",
        strokeId: stroke.id,
        authoritativePointCount: this.consumedAuthoritativePoints,
        revision: this.authoritativeReplica.revision,
        backend: "upstream-in-progress",
        gpu,
      };
    } catch (error) {
      return this.fail(errorCode(error), error instanceof Error ? error.message : String(error));
    }
  }

  previewPredicted(
    stroke: StudioInkMeshStrokeLike,
    authoritativePointCount: number,
    pressures?: readonly number[],
  ): StudioInkMeshLiveReceipt {
    const prepared = this.prepared;
    if (
      !prepared
      || !this.authoritativeSession
      || this.activeStrokeId !== stroke.id
    ) return { status: "inactive" };
    try {
      const count = pointCount(stroke);
      if (
        authoritativePointCount !== this.consumedAuthoritativePoints
        || count <= authoritativePointCount
      ) {
        throw new StudioInkMeshPreviewError(
          "predicted-prefix-mismatch",
          "Predicted Google Ink tail does not start at the current authoritative sample count.",
        );
      }
      const inputs = strokeInputPoints(stroke, pressures, 0, count);
      for (let index = 0; index < authoritativePointCount; index += 1) {
        const expected = this.authoritativeInputs[index];
        const actual = inputs[index];
        if (!expected || !actual || !inputPointEqual(expected, actual)) {
          throw new StudioInkMeshPreviewError(
            "predicted-prefix-mismatch",
            `Predicted Google Ink tail modified authoritative sample ${index}.`,
          );
        }
      }
      const predictedMesh = prepared.generator.generateInkStrokeMesh(
        inputs,
        this.activeParams ?? undefined,
      );
      validateMeshAdmission(predictedMesh);
      const retainedTriangleCount = firstChangedTriangle(
        this.authoritativeReplica,
        predictedMesh,
      );
      const delta = createStudioInkMeshReplacementDelta(
        prepared.sink.replica,
        predictedMesh,
        this.consumedAuthoritativePoints,
      );
      const gpu = prepared.sink.apply(delta, retainedTriangleCount);
      this.predictedPointCount = count - authoritativePointCount;
      return {
        status: "rendered",
        strokeId: stroke.id,
        authoritativePointCount,
        predictedPointCount: this.predictedPointCount,
        retainedTriangleCount,
        revision: gpu.revision,
        gpu,
      };
    } catch (error) {
      return this.fail(errorCode(error), error instanceof Error ? error.message : String(error));
    }
  }

  finish(
    stroke: StudioInkMeshStrokeLike,
    pressures?: readonly number[],
  ): StudioInkMeshLiveReceipt {
    const synchronized = this.synchronizeAuthoritative(stroke, pressures);
    if (synchronized.status === "unavailable" || synchronized.status === "inactive") {
      return synchronized;
    }
    const session = this.authoritativeSession;
    const prepared = this.prepared;
    if (!session || !prepared || !this.activeStrokeId) return { status: "inactive" };
    const strokeId = this.activeStrokeId;
    try {
      const delta = session.finish();
      this.authoritativeReplica = applyInkStrokeMeshDelta(this.authoritativeReplica, delta);
      validateMeshAdmission(this.authoritativeReplica);
      this.restoreAuthoritativeDisplay();
      const snapshot = session.snapshot();
      const finalMesh: InkStrokeMeshReplica = {
        vertices: snapshot.vertices.slice(),
        texCoords: snapshot.texCoords.slice(),
        triangles: snapshot.triangles.slice(),
        vertexCount: snapshot.vertexCount,
        triangleCount: snapshot.triangleCount,
        revision: snapshot.revision,
        finished: true,
      };
      const authoritativePointCount = this.consumedAuthoritativePoints;
      session.dispose();
      this.authoritativeSession = null;
      this.activeStrokeId = null;
      this.activeParams = null;
      this.authoritativeInputs = [];
      this.consumedAuthoritativePoints = 0;
      this.predictedPointCount = 0;
      prepared.sink.reset();
      this.authoritativeReplica = createEmptyInkStrokeMeshReplica();
      return {
        status: "finished",
        strokeId,
        authoritativePointCount,
        finalMesh,
        backend: "upstream-in-progress",
        gpuReadbackCount: 0,
      };
    } catch (error) {
      return this.fail(errorCode(error), error instanceof Error ? error.message : String(error));
    }
  }

  cancel(): void {
    this.reset("runtime-error", false);
  }

  dispose(): void {
    this.reset("runtime-error", false);
    this.unsubscribeLoss();
    this.releasePreparedResources();
    this.canvas = null;
    this.surface = null;
    this.generation += 1;
  }

  private appendAuthoritative(
    stroke: StudioInkMeshStrokeLike,
    pressures: readonly number[] | undefined,
    startIndex: number,
    endIndex: number,
  ): void {
    const session = this.authoritativeSession;
    if (!session) {
      throw new StudioInkMeshPreviewError(
        "runtime-error",
        "Google Ink authoritative session is missing.",
      );
    }
    const suffix = strokeInputPoints(stroke, pressures, startIndex, endIndex);
    const batchSize = 512;
    for (let offset = 0; offset < suffix.length; offset += batchSize) {
      const batch = suffix.slice(offset, offset + batchSize);
      const delta = session.append(batch);
      this.authoritativeReplica = applyInkStrokeMeshDelta(this.authoritativeReplica, delta);
      validateMeshAdmission(this.authoritativeReplica);
      this.authoritativeInputs.push(...batch);
    }
    this.consumedAuthoritativePoints = endIndex;
  }

  private restoreAuthoritativeDisplay(): StudioInkMeshGpuApplyReceipt {
    const prepared = this.prepared;
    if (!prepared) {
      throw new StudioInkMeshPreviewError(
        "gpu-unavailable",
        "Google Ink GPU resources disappeared during the stroke.",
      );
    }
    const delta = createStudioInkMeshReplacementDelta(
      prepared.sink.replica,
      this.authoritativeReplica,
      this.consumedAuthoritativePoints,
      this.authoritativeReplica.finished,
    );
    this.predictedPointCount = 0;
    return prepared.sink.apply(delta, this.authoritativeReplica.triangleCount);
  }

  private fail(
    code: StudioInkMeshUnavailableCode,
    detail: string,
  ): StudioInkMeshUnavailableReceipt {
    const receipt = unavailableReceipt(code, detail, this.activeStrokeId);
    this.lastUnavailableValue = receipt;
    this.reset(code, false);
    this.onUnavailable?.(receipt);
    return receipt;
  }

  private reset(
    _code: StudioInkMeshUnavailableCode,
    notify: boolean,
  ): void {
    const strokeId = this.activeStrokeId;
    try {
      this.authoritativeSession?.cancel();
    } catch {
      // Existing Canvas2D authority still owns pixels; cleanup must remain best-effort.
    }
    try {
      this.authoritativeSession?.dispose();
    } catch {
      // Session may already have destroyed its upstream handle.
    }
    this.authoritativeSession = null;
    this.authoritativeReplica = createEmptyInkStrokeMeshReplica();
    this.authoritativeInputs = [];
    this.activeStrokeId = null;
    this.activeParams = null;
    this.consumedAuthoritativePoints = 0;
    this.predictedPointCount = 0;
    try {
      this.prepared?.sink.reset();
    } catch {
      // Device loss can make the final transparent clear unavailable.
    }
    if (notify && strokeId) {
      const receipt = unavailableReceipt(_code, "Google Ink live-tail session reset.", strokeId);
      this.lastUnavailableValue = receipt;
      this.onUnavailable?.(receipt);
    }
  }

  private handleDeviceLoss(event: StudioGpuDeviceLossEvent): void {
    if (!this.prepared || this.prepared.deviceEpoch !== event.epoch) return;
    const strokeId = this.activeStrokeId;
    const receipt = unavailableReceipt(
      "device-lost",
      `Studio GPU fabric epoch ${event.epoch} was lost (${event.reason}); retained Perfect Freehand remains authoritative.`,
      strokeId,
    );
    this.lastUnavailableValue = receipt;
    this.reset("device-lost", false);
    this.releasePreparedResources();
    this.onUnavailable?.(receipt);
  }

  private releasePreparedResources(): void {
    const prepared = this.prepared;
    this.prepared = null;
    if (!prepared) return;
    prepared.sink.dispose();
    prepared.release();
  }
}

/** Default fabric-backed resource adapter exported for browser probes. */
export async function prepareStudioInkMeshLivePreviewResources(
  canvas: HTMLCanvasElement,
): Promise<StudioInkMeshPreparedResources | null> {
  return prepareDefaultResources(canvas);
}

/** Type guard kept explicit for product orchestration and source-contract tests. */
export function isStudioInkMeshRenderedReceipt(
  receipt: StudioInkMeshLiveReceipt,
): receipt is StudioInkMeshPreviewReceipt {
  return receipt.status === "rendered";
}
