import * as THREE from "three";

import {
  runStudioVrmTextureFillWorker,
  type StudioVrmTextureFillWorkerClientOptions,
  type StudioVrmTextureFillWorkerClientResult,
} from "./studio-vrm-texture-fill-worker-client";
import {
  getCachedStudioVrmTextureGeometryIndex,
  inspectStudioVrmTextureGeometryAdmission,
  precomputeStudioVrmTextureGeometryIndex,
  type StudioVrmTextureGeometryIndex,
  type StudioVrmTextureGeometryLike,
  type StudioVrmTextureGeometryPrecomputeOptions,
} from "./studio-vrm-texture-geometry-index";
import {
  STUDIO_VRM_TEXTURE_PAINT_MATERIAL_LOCATOR_USER_DATA_KEY,
  canonicalizeStudioVrmTexturePaintMaterialLocator as canonicalMaterialLocator,
  createStudioVrmTexturePaintBindingDescriptor as createBindingDescriptor,
  isCanonicalStudioVrmTexturePaintBindingDescriptor as isCanonicalBindingDescriptor,
  type StudioVrmTexturePaintBindingDescriptor,
} from "./studio-vrm-texture-paint-binding";
import {
  applyStudioVrmTexturePaintOp,
  EMPTY_STUDIO_VRM_TEXTURE_RECT,
  parseStudioVrmTextureColor,
  studioVrmTexturePaintOpRects,
  unionStudioVrmTextureRect,
  type StudioVrmTexturePaintApplyOptions,
  type StudioVrmTexturePaintOp,
} from "./studio-vrm-texture-paint-ops";
import {
  createStudioVrmTextureStrokeWalker,
  type StudioVrmTextureStrokeWalker,
} from "./studio-vrm-texture-stroke-walker";
import {
  applyStudioVrmTextureUndoEntry,
  createStudioVrmTextureUndoRecorder,
  studioVrmTextureUndoEntryBytes,
  type StudioVrmTextureUndoEntry,
  type StudioVrmTextureUndoRecorder,
} from "./studio-vrm-texture-undo";
import {
  isStudioVrmTextureSize,
  resolveStudioVrmTexelIndex,
  STUDIO_VRM_TEXTURE_MAX_DIMENSION,
  STUDIO_VRM_TEXTURE_MAX_TEXELS,
  type StudioVrmTextureSize,
  type StudioVrmTextureRect,
  type StudioVrmUvPoint,
  type StudioVrmTextureWrapMode,
  resolveStudioVrmTexelPoint,
} from "./studio-vrm-texture-uv";

import type {
  StudioVrmTextureFillRequest,
  StudioVrmTextureFillResult,
  StudioVrmTextureFillScope,
} from "./studio-vrm-texture-fill";
import type {
  StudioVrmTextureStrokePlanOptions,
  StudioVrmTextureStrokeSample,
  StudioVrmTextureStrokeStyle,
} from "./studio-vrm-texture-stroke";

const RGBA_CHANNELS = 4;
const DEFAULT_TARGET_RGBA_BYTES = STUDIO_VRM_TEXTURE_MAX_TEXELS * RGBA_CHANNELS;
export const STUDIO_VRM_TEXTURE_PAINT_TARGET_RESIDENT_RGBA_COPIES = 4;
export const STUDIO_VRM_TEXTURE_PAINT_STANDARD_GEOMETRY_MAX_TRIANGLES = 100_000;
const DEFAULT_HISTORY_BYTES = 32 * 1024 * 1024;
const DEFAULT_TARGET_RESIDENT_BYTES =
  DEFAULT_TARGET_RGBA_BYTES * STUDIO_VRM_TEXTURE_PAINT_TARGET_RESIDENT_RGBA_COPIES;
const SAMPLE_UV_EPSILON = 0.5 / STUDIO_VRM_TEXTURE_MAX_DIMENSION;
const SAMPLE_PRESSURE_EPSILON = 1 / 1024;

export const DEFAULT_STUDIO_VRM_TEXTURE_PAINT_RUNTIME_LIMITS = Object.freeze({
  maxTargetResidentBytes: DEFAULT_TARGET_RESIDENT_BYTES,
  maxAggregateResidentBytes: DEFAULT_TARGET_RESIDENT_BYTES * 2 + DEFAULT_HISTORY_BYTES,
  maxGeometryIndexTriangles: STUDIO_VRM_TEXTURE_PAINT_STANDARD_GEOMETRY_MAX_TRIANGLES,
  /** @deprecated Logical RGBA compatibility alias. Prefer maxTargetResidentBytes. */
  maxTargetRgbaBytes: DEFAULT_TARGET_RGBA_BYTES,
  /** @deprecated Logical RGBA compatibility alias. Prefer maxAggregateResidentBytes. */
  maxAggregateRgbaBytes: DEFAULT_TARGET_RGBA_BYTES * 2,
  maxConcurrentReads: 2,
  maxHistoryEntries: 32,
  maxHistoryBytes: DEFAULT_HISTORY_BYTES,
  maxStrokeSamples: 2048,
  undoTileSize: 64,
});

export type StudioVrmTexturePaintRuntimeStatus =
  | "idle"
  | "invalid"
  | "loading"
  | "ready"
  | "painting"
  | "disposed";

export type StudioVrmTexturePaintRuntimeErrorCode =
  | "aggregate-rgba-budget"
  | "binding-conflict"
  | "binding-missing"
  | "canvas-unavailable"
  | "disposed"
  | "fill-memory-budget"
  | "fill-worker-failed"
  | "fill-worker-unavailable"
  | "history-budget"
  | "hit-outside-scene"
  | "invalid-dimensions"
  | "invalid-pointer"
  | "invalid-style"
  | "map-missing"
  | "material-missing"
  | "mesh-missing"
  | "pointer-active"
  | "pointer-mismatch"
  | "read-concurrency-budget"
  | "source-changed"
  | "source-compressed"
  | "source-read-aborted"
  | "source-read-active"
  | "source-unreadable"
  | "stale-completion"
  | "stroke-sample-budget"
  | "surface-operation-invalid"
  | "surface-session-invalid"
  | "target-invalid"
  | "target-mismatch"
  | "target-rgba-budget"
  | "uv-missing";

export interface StudioVrmTexturePaintRuntimeError {
  readonly code: StudioVrmTexturePaintRuntimeErrorCode;
  readonly message: string;
}

export type StudioVrmTexturePaintRuntimeGuidanceCode = "geometry-triangle-budget";

export interface StudioVrmTexturePaintRuntimeGuidance {
  readonly code: StudioVrmTexturePaintRuntimeGuidanceCode;
  readonly message: string;
  readonly triangleCount: number;
  readonly maxTriangles: number;
}

export type StudioVrmTexturePaintRuntimeResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: StudioVrmTexturePaintRuntimeError }>;

export interface StudioVrmTexturePaintRayHit {
  readonly object: THREE.Object3D;
  readonly uv?: THREE.Vector2 | Readonly<{ x: number; y: number }>;
  readonly uv1?: THREE.Vector2 | Readonly<{ x: number; y: number }>;
  readonly face?: Readonly<{ materialIndex: number }> | null;
  /** Raycaster가 제공하는 geometry triangle index. */
  readonly faceIndex?: number | null;
  readonly point?: THREE.Vector3 | Readonly<{ x: number; y: number; z: number }>;
}

/**
 * Opaque lease for one externally planned surface-brush transaction.
 *
 * The runtime validates object identity, not only these diagnostic fields, so
 * callers cannot forge a lease and mutate an unrelated texture target.
 */
export interface StudioVrmTexturePaintSurfaceSession {
  readonly id: string;
  readonly targetId: string;
  readonly width: number;
  readonly height: number;
  readonly wrapU: StudioVrmTextureWrapMode;
  readonly wrapV: StudioVrmTextureWrapMode;
}

/** Ray/BVH evidence normalized by the runtime that owns the texture target. */
export interface StudioVrmTexturePaintSurfaceProjection {
  readonly u: number;
  readonly v: number;
  readonly uvWasWrapped: boolean;
  readonly sourcePressure?: number;
  readonly triangleId?: string;
  readonly islandId: string;
  readonly world?: Readonly<{ readonly x: number; readonly y: number; readonly z: number }>;
  readonly texelsPerWorldUnit?: number;
}

export interface StudioVrmTexturePaintSurfacePrepareInput {
  readonly hit: StudioVrmTexturePaintRayHit;
  readonly pressure?: number;
  readonly signal?: AbortSignal;
}

export interface StudioVrmTexturePaintPreparedSurface {
  readonly session: StudioVrmTexturePaintSurfaceSession;
  readonly projection: StudioVrmTexturePaintSurfaceProjection;
}

export interface StudioVrmTexturePaintSurfaceCommitInput {
  readonly operations: readonly StudioVrmTexturePaintOp[];
  readonly signal?: AbortSignal;
}

export interface StudioVrmTexturePaintSurfaceCommitReceipt {
  readonly appliedOperations: number;
  readonly changedTexels: number;
  readonly revision: number;
}

export interface StudioVrmTexturePaintStrokeBegin {
  readonly pointerId: number;
  readonly hit: StudioVrmTexturePaintRayHit;
  readonly pressure?: number;
  readonly style: StudioVrmTextureStrokeStyle;
  readonly planOptions?: Omit<
    StudioVrmTextureStrokePlanOptions,
    "flipV" | "wrapU" | "wrapV"
  >;
}

export interface StudioVrmTexturePaintStrokeMove {
  readonly pointerId: number;
  readonly hit: StudioVrmTexturePaintRayHit;
  readonly pressure?: number;
}

export interface StudioVrmTexturePaintColorSampleInput {
  readonly hit: StudioVrmTexturePaintRayHit;
  readonly signal?: AbortSignal;
}

export interface StudioVrmTexturePaintColorSample {
  /** Byte-exact baseColor RGB channel values encoded as a portable HEX field. */
  readonly color: string;
  readonly rgba: Readonly<{
    readonly r: number;
    readonly g: number;
    readonly b: number;
    readonly a: number;
  }>;
  readonly texel: Readonly<{ readonly x: number; readonly y: number }>;
  readonly sourceTextureUuid: string;
  readonly sourceName: string;
  /** Present when the sample came from the latest editable paint buffer. */
  readonly targetId: string | null;
}

export interface StudioVrmTexturePaintFillInput {
  readonly hit: StudioVrmTexturePaintRayHit;
  readonly color: string;
  readonly tolerance: number;
  readonly scope: StudioVrmTextureFillScope;
  readonly signal?: AbortSignal;
}

export interface StudioVrmTexturePaintReadableImage {
  readonly width: number;
  readonly height: number;
  /**
   * A tightly packed, straight-alpha RGBA8 buffer. Ownership is transferred to the runtime.
   */
  readonly data: Uint8ClampedArray;
}

export {
  STUDIO_VRM_TEXTURE_PAINT_BASE_COLOR_SLOT,
  STUDIO_VRM_TEXTURE_PAINT_MATERIAL_LOCATOR_USER_DATA_KEY,
  stampStudioVrmTexturePaintMaterialLocator,
} from "./studio-vrm-texture-paint-binding";
export type { StudioVrmTexturePaintBindingDescriptor } from "./studio-vrm-texture-paint-binding";

export interface StudioVrmTexturePaintExportTarget {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  /**
   * Caller-owned RGBA8 copy. The runtime never transfers or mutates this buffer after return.
   * Exporters should encode one target at a time and release the buffer promptly.
   */
  readonly pixels: Uint8ClampedArray;
  readonly bindings: readonly StudioVrmTexturePaintBindingDescriptor[];
}

export interface StudioVrmTexturePaintRehydrateTarget {
  readonly binding: StudioVrmTexturePaintBindingDescriptor;
  /** Ownership of the RGBA buffer is transferred for the duration of this call. */
  readonly image: StudioVrmTexturePaintReadableImage;
  readonly signal?: AbortSignal;
}

export type StudioVrmTexturePaintCanvasFactory = (
  width: number,
  height: number,
) => HTMLCanvasElement;

export type StudioVrmTexturePaintImageReader = (
  texture: THREE.Texture,
  signal: AbortSignal,
) => Promise<StudioVrmTexturePaintReadableImage> | StudioVrmTexturePaintReadableImage;

export type StudioVrmTexturePaintGeometryPrecomputer = (
  geometry: StudioVrmTextureGeometryLike,
  options: StudioVrmTextureGeometryPrecomputeOptions,
) => Promise<StudioVrmTextureGeometryIndex>;

export type StudioVrmTextureFillRunner = (
  request: StudioVrmTextureFillRequest,
  options?: StudioVrmTextureFillWorkerClientOptions,
) => Promise<StudioVrmTextureFillWorkerClientResult>;

export interface CreateStudioVrmTexturePaintRuntimeOptions {
  /**
   * Conservative resident footprint per target: original RGBA, editable ImageData,
   * Canvas backing store, and GPU texture backing.
   */
  readonly maxTargetResidentBytes?: number;
  /** Prepared target resident bytes plus the reserved undo-history budget. */
  readonly maxAggregateResidentBytes?: number;
  /**
   * Worker UV-island indexing hard cap. Pointer input consumes only a completed Worker cache and
   * otherwise keeps the face-local identity; it never rebuilds topology synchronously.
   */
  readonly maxGeometryIndexTriangles?: number;
  /** @deprecated Logical RGBA compatibility alias. Prefer maxTargetResidentBytes. */
  readonly maxTargetRgbaBytes?: number;
  /** @deprecated Logical RGBA compatibility alias. Prefer maxAggregateResidentBytes. */
  readonly maxAggregateRgbaBytes?: number;
  /** Hard cap for concurrently unsettled source-image reads. One read per source is always enforced. */
  readonly maxConcurrentReads?: number;
  readonly maxHistoryEntries?: number;
  readonly maxHistoryBytes?: number;
  /** Hard cap for samples retained by one pointer stroke after duplicate coalescing. */
  readonly maxStrokeSamples?: number;
  readonly undoTileSize?: number;
  readonly createCanvas?: StudioVrmTexturePaintCanvasFactory;
  readonly readTextureImage?: StudioVrmTexturePaintImageReader;
  /** Test/host integration seam. Production uses the fail-closed one-shot module Worker. */
  readonly runTextureFill?: StudioVrmTextureFillRunner;
  /** Test/host integration seam. The default uses the browser module Worker implementation. */
  readonly precomputeGeometryIndex?: StudioVrmTexturePaintGeometryPrecomputer;
}

export interface StudioVrmTexturePaintTargetSnapshot {
  readonly id: string;
  readonly sourceTextureUuid: string;
  readonly paintedTextureUuid: string;
  readonly sourceName: string;
  readonly width: number;
  readonly height: number;
  readonly rgbaBytes: number;
  readonly residentBytes: number;
  readonly bindingCount: number;
  readonly valid: boolean;
  readonly invalidReason: "canvas-unavailable" | null;
}

export interface StudioVrmTexturePaintHistorySnapshot {
  readonly undoCount: number;
  readonly redoCount: number;
  readonly retainedBytes: number;
  readonly maxEntries: number;
  readonly maxBytes: number;
}

export interface StudioVrmTexturePaintRuntimeSnapshot {
  readonly status: StudioVrmTexturePaintRuntimeStatus;
  readonly activeOperation:
    | "fill"
    | "sample"
    | "stroke"
    | "stroke-read"
    | "surface-brush"
    | "surface-read"
    | null;
  readonly activePointerId: number | null;
  readonly activeTargetId: string | null;
  readonly activeTarget: Readonly<Pick<
    StudioVrmTexturePaintTargetSnapshot,
    "bindingCount" | "height" | "id" | "invalidReason" | "sourceName" | "valid" | "width"
  >> | null;
  /** @deprecated Logical RGBA sum retained for telemetry compatibility. */
  readonly aggregateRgbaBytes: number;
  readonly aggregateTargetResidentBytes: number;
  /** Prepared target resident bytes plus currently retained history. */
  readonly residentBytes: number;
  readonly maxResidentBytes: number;
  readonly targets: readonly StudioVrmTexturePaintTargetSnapshot[];
  readonly history: StudioVrmTexturePaintHistorySnapshot;
  readonly error: StudioVrmTexturePaintRuntimeError | null;
  readonly guidance: StudioVrmTexturePaintRuntimeGuidance | null;
}

export type StudioVrmTexturePaintRuntimeListener = (
  snapshot: StudioVrmTexturePaintRuntimeSnapshot,
) => void;

interface BaseColorMaterial extends THREE.Material {
  map: THREE.Texture | null;
}

interface MaterialBinding {
  readonly material: BaseColorMaterial;
  readonly originalMap: THREE.Texture | null;
  readonly descriptor: StudioVrmTexturePaintBindingDescriptor;
}

interface PaintTarget {
  readonly id: string;
  readonly originalTexture: THREE.Texture;
  readonly paintedTexture: THREE.CanvasTexture;
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  readonly imageData: ImageData;
  readonly originalPixels: Uint8ClampedArray;
  readonly size: StudioVrmTextureSize;
  readonly rgbaBytes: number;
  readonly residentBytes: number;
  readonly bindings: Map<BaseColorMaterial, MaterialBinding>;
  valid: boolean;
  invalidReason: "canvas-unavailable" | null;
}

interface TextureSamplingSignature {
  readonly channel: number;
  readonly flipY: boolean;
  readonly format: THREE.AnyPixelFormat;
  readonly image: unknown;
  readonly matrixAutoUpdate: boolean;
  readonly matrixElements: readonly number[];
  readonly version: number;
  readonly type: THREE.TextureDataType;
  readonly wrapS: THREE.Wrapping;
  readonly wrapT: THREE.Wrapping;
}

interface ResolvedBaseColorHit {
  readonly material: BaseColorMaterial;
  readonly sourceTexture: THREE.Texture;
  readonly effectiveTexture: THREE.Texture;
  readonly target: PaintTarget | null;
  readonly uv: StudioVrmUvPoint;
  readonly wrapU: StudioVrmTextureWrapMode;
  readonly wrapV: StudioVrmTextureWrapMode;
  /** Captured only for asynchronous color sampling stale checks, never for hot brush moves. */
  readonly samplingSignature: TextureSamplingSignature | null;
}

interface ResolvedPaintHit extends ResolvedBaseColorHit {
  readonly sample: StudioVrmTextureStrokeSample;
  readonly paintWrap: StudioVrmTexturePaintApplyOptions;
}

interface PendingStroke {
  readonly pointerId: number;
  readonly originMaterial: BaseColorMaterial;
  readonly sourceTexture: THREE.Texture;
  readonly style: StudioVrmTextureStrokeStyle;
  readonly planOptions: Omit<
    StudioVrmTextureStrokePlanOptions,
    "flipV" | "wrapU" | "wrapV"
  >;
  readonly samples: StudioVrmTextureStrokeSample[];
  readonly wrapU: StudioVrmTextureWrapMode;
  readonly wrapV: StudioVrmTextureWrapMode;
  readonly paintWrap: StudioVrmTexturePaintApplyOptions;
  readonly readController: AbortController | null;
  target: PaintTarget | null;
  terminal: "commit" | null;
}

interface ActiveStroke {
  readonly pointerId: number;
  readonly target: PaintTarget;
  readonly paintWrap: StudioVrmTexturePaintApplyOptions;
  readonly recorder: StudioVrmTextureUndoRecorder;
  readonly walker: StudioVrmTextureStrokeWalker;
  lastSample: StudioVrmTextureStrokeSample | null;
  sampleCount: number;
  changedTexels: number;
}

interface SurfacePaintSessionState {
  readonly id: string;
  readonly originMaterial: BaseColorMaterial;
  readonly sourceTexture: THREE.Texture;
  readonly paintWrap: StudioVrmTexturePaintApplyOptions;
  readonly controller: AbortController | null;
  target: PaintTarget | null;
  token: StudioVrmTexturePaintSurfaceSession | null;
}

interface PendingColorSample {
  readonly controller: AbortController;
}

interface PendingFill {
  readonly controller: AbortController;
}

interface StrokeHistoryRecord {
  readonly kind: "stroke";
  readonly target: PaintTarget;
  readonly entry: StudioVrmTextureUndoEntry;
  readonly bytes: number;
}

interface FillHistoryRecord {
  readonly kind: "fill";
  readonly target: PaintTarget;
  /** LSB-first mask local to `rect`, not the full atlas. */
  readonly bitMask: Uint8Array;
  /** RGB before values in local-mask scan order. Alpha is intentionally preserved. */
  readonly beforeRgb: Uint8Array;
  readonly fillRgb: Readonly<{ readonly r: number; readonly g: number; readonly b: number }>;
  readonly rect: StudioVrmTextureRect;
  readonly bytes: number;
}

type HistoryRecord = StrokeHistoryRecord | FillHistoryRecord;

interface HistoryCheckpoint {
  readonly past: readonly HistoryRecord[];
  readonly future: readonly HistoryRecord[];
}

interface NormalizedRuntimeOptions {
  readonly maxTargetResidentBytes: number;
  readonly maxAggregateResidentBytes: number;
  readonly maxGeometryIndexTriangles: number;
  readonly maxConcurrentReads: number;
  readonly maxHistoryEntries: number;
  readonly maxHistoryBytes: number;
  readonly maxStrokeSamples: number;
  readonly undoTileSize: number;
  readonly createCanvas: StudioVrmTexturePaintCanvasFactory;
  readonly readTextureImage: StudioVrmTexturePaintImageReader;
  readonly runTextureFill: StudioVrmTextureFillRunner;
  readonly precomputeGeometryIndex: StudioVrmTexturePaintGeometryPrecomputer;
}

interface GeometryPrewarmJob {
  readonly geometry: StudioVrmTextureGeometryLike;
  readonly uvAttribute: "uv" | "uv1";
}

class StudioVrmTexturePaintFault extends Error {
  constructor(readonly code: StudioVrmTexturePaintRuntimeErrorCode) {
    super(code);
    this.name = "StudioVrmTexturePaintFault";
  }
}

const ERROR_MESSAGES: Readonly<Record<StudioVrmTexturePaintRuntimeErrorCode, string>> =
  Object.freeze({
    "aggregate-rgba-budget": "텍스처와 실행 취소 기록의 전체 상주 메모리 한도를 초과합니다.",
    "binding-conflict": "저장된 표면 텍스처와 현재 모델의 재질 결합이 서로 충돌합니다.",
    "binding-missing": "저장된 표면 텍스처가 가리키는 모델 재질을 찾지 못했습니다.",
    "canvas-unavailable": "페인팅 캔버스를 사용할 수 없습니다.",
    disposed: "텍스처 페인팅이 이미 종료되었습니다.",
    "fill-memory-budget": "이 텍스처는 안전한 ColorDrop 메모리 한도를 초과합니다.",
    "fill-worker-failed": "ColorDrop 영역 계산을 완료하지 못했습니다.",
    "fill-worker-unavailable": "이 브라우저에서는 안전한 ColorDrop Worker를 사용할 수 없습니다.",
    "history-budget": "이 획은 실행 취소 메모리 한도를 초과합니다.",
    "hit-outside-scene": "현재 캐릭터 밖의 지점입니다.",
    "invalid-dimensions": "텍스처 크기 또는 RGBA 데이터가 올바르지 않습니다.",
    "invalid-pointer": "포인터 정보가 올바르지 않습니다.",
    "invalid-style": "브러시 설정이 올바르지 않습니다.",
    "map-missing": "재질에 색상 텍스처가 없습니다.",
    "material-missing": "색상 재질을 찾을 수 없습니다.",
    "mesh-missing": "페인팅할 메시를 찾을 수 없습니다.",
    "pointer-active": "다른 페인팅 입력이 진행 중입니다.",
    "pointer-mismatch": "현재 획을 시작한 포인터가 아닙니다.",
    "read-concurrency-budget": "동시에 불러올 수 있는 텍스처 수를 초과했습니다.",
    "source-changed": "불러오는 동안 원본 텍스처가 변경되었습니다.",
    "source-compressed": "압축 GPU 텍스처에는 직접 칠할 수 없습니다.",
    "source-read-aborted": "텍스처 불러오기를 취소했습니다.",
    "source-read-active": "이 텍스처를 이미 불러오는 중입니다.",
    "source-unreadable": "텍스처를 읽을 수 없습니다. CORS 설정을 확인하세요.",
    "stale-completion": "이전 텍스처 준비 결과를 무시했습니다.",
    "stroke-sample-budget": "한 획의 입력 지점 한도를 초과했습니다.",
    "surface-operation-invalid": "표면 브러시 텍스처 연산이 올바르지 않습니다.",
    "surface-session-invalid": "표면 브러시 세션이 만료되었거나 다른 대상에 속합니다.",
    "target-invalid": "페인팅 대상을 더 이상 사용할 수 없습니다.",
    "target-mismatch": "한 획으로 서로 다른 텍스처를 칠할 수 없습니다.",
    "target-rgba-budget": "이 텍스처는 안전한 페인팅 상주 메모리 한도를 초과합니다.",
    "uv-missing": "이 지점의 UV 좌표를 사용할 수 없습니다.",
  });

function frozenError(code: StudioVrmTexturePaintRuntimeErrorCode): StudioVrmTexturePaintRuntimeError {
  return Object.freeze({ code, message: ERROR_MESSAGES[code] });
}

function frozenGeometryBudgetGuidance(
  triangleCount: number,
  maxTriangles: number,
): StudioVrmTexturePaintRuntimeGuidance {
  return Object.freeze({
    code: "geometry-triangle-budget",
    message:
      `고밀도 메시(${triangleCount}면)는 안전 한도 ${maxTriangles}면을 넘어 `
      + "UV 분석을 생략하고 면 단위 안전 모드로 칠합니다.",
    triangleCount,
    maxTriangles,
  });
}

function success<T>(value: T): StudioVrmTexturePaintRuntimeResult<T> {
  return Object.freeze({ ok: true as const, value });
}

function failure<T>(
  code: StudioVrmTexturePaintRuntimeErrorCode,
): StudioVrmTexturePaintRuntimeResult<T> {
  return Object.freeze({ ok: false as const, error: frozenError(code) });
}

/**
 * Canonical chart identity used at the package provider boundary. Type tags
 * prevent a numeric provider id (`1`) from colliding with a textual id
 * (`"1"`); non-finite and empty identities are rejected.
 */
export function canonicalizeStudioVrmSurfaceIslandId(value: unknown): string | null {
  if (typeof value === "string") return value.length > 0 ? `string:${value}` : null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return `number:${Object.is(value, -0) ? "-0" : String(value)}`;
}

function boundedInteger(value: unknown, fallback: number, minimum: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum
    ? Math.floor(value)
    : fallback;
}

function boundedByteBudget(value: unknown, fallback: number): number {
  return Math.min(
    Number.MAX_SAFE_INTEGER,
    boundedInteger(value, fallback, 1),
  );
}

function saturatedByteSum(...values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0) return Number.MAX_SAFE_INTEGER;
    if (total > Number.MAX_SAFE_INTEGER - value) return Number.MAX_SAFE_INTEGER;
    total += value;
  }
  return total;
}

function logicalRgbaToResidentBytes(rgbaBytes: number): number {
  if (!Number.isSafeInteger(rgbaBytes) || rgbaBytes < 0) return Number.MAX_SAFE_INTEGER;
  if (
    rgbaBytes
    > Math.floor(
      Number.MAX_SAFE_INTEGER / STUDIO_VRM_TEXTURE_PAINT_TARGET_RESIDENT_RGBA_COPIES,
    )
  ) {
    return Number.MAX_SAFE_INTEGER;
  }
  return rgbaBytes * STUDIO_VRM_TEXTURE_PAINT_TARGET_RESIDENT_RGBA_COPIES;
}

/**
 * 보수적으로 유지되는 네 개의 RGBA 사본(원본, ImageData, Canvas, GPU)을 계산한다.
 * 실제 버퍼를 만들지 않으므로 2K/4K 사전 입장 검사에도 안전하게 사용할 수 있다.
 */
export function estimateStudioVrmTexturePaintTargetResidentBytes(
  size: Readonly<{ width: number; height: number }>,
): number | null {
  if (!isStudioVrmTextureSize(size)) return null;
  return logicalRgbaToResidentBytes(size.width * size.height * RGBA_CHANNELS);
}

function defaultCanvasFactory(width: number, height: number): HTMLCanvasElement {
  if (typeof document !== "object" || typeof document.createElement !== "function") {
    throw new StudioVrmTexturePaintFault("canvas-unavailable");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function readableImageDimensions(image: unknown): StudioVrmTextureSize | null {
  if (typeof image !== "object" || image === null) return null;
  const source = image as Record<string, unknown>;
  const candidates = [
    [source.naturalWidth, source.naturalHeight],
    [source.videoWidth, source.videoHeight],
    [source.width, source.height],
  ] as const;
  for (const [width, height] of candidates) {
    const size = { width, height };
    if (isStudioVrmTextureSize(size)) return size;
  }
  return null;
}

function textureImageDimensions(texture: THREE.Texture): StudioVrmTextureSize | null {
  try {
    return readableImageDimensions(texture.image);
  } catch {
    return null;
  }
}

function isUsableFaceIndex(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function readTypedRgbaImage(
  texture: THREE.Texture,
  image: unknown,
): StudioVrmTexturePaintReadableImage | null {
  if (typeof image !== "object" || image === null) return null;
  const source = image as Record<string, unknown>;
  const size = { width: source.width, height: source.height };
  if (!isStudioVrmTextureSize(size)) return null;
  const data = source.data;
  if (!(data instanceof Uint8Array || data instanceof Uint8ClampedArray)) return null;
  if (texture.format !== THREE.RGBAFormat || texture.type !== THREE.UnsignedByteType) return null;
  if (data.byteLength !== size.width * size.height * RGBA_CHANNELS) return null;
  const rgba = new Uint8ClampedArray(data.byteLength);
  rgba.set(data);
  return { ...size, data: rgba };
}

function createDefaultImageReader(
  createCanvas: StudioVrmTexturePaintCanvasFactory,
): StudioVrmTexturePaintImageReader {
  return (texture, signal) => {
    if (signal.aborted) throw new StudioVrmTexturePaintFault("source-read-aborted");
    let image: unknown;
    try {
      image = texture.image;
    } catch {
      throw new StudioVrmTexturePaintFault("source-unreadable");
    }
    const typed = readTypedRgbaImage(texture, image);
    if (typed) return typed;
    const size = readableImageDimensions(image);
    if (!size) throw new StudioVrmTexturePaintFault("invalid-dimensions");
    if (signal.aborted) throw new StudioVrmTexturePaintFault("source-read-aborted");

    let canvas: HTMLCanvasElement | null = null;
    try {
      canvas = createCanvas(size.width, size.height);
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new StudioVrmTexturePaintFault("canvas-unavailable");
      context.drawImage(image as CanvasImageSource, 0, 0, size.width, size.height);
      const pixels = context.getImageData(0, 0, size.width, size.height);
      if (signal.aborted) throw new StudioVrmTexturePaintFault("source-read-aborted");
      const data = new Uint8ClampedArray(pixels.data.length);
      data.set(pixels.data);
      return { ...size, data };
    } catch (error) {
      if (error instanceof StudioVrmTexturePaintFault) throw error;
      throw new StudioVrmTexturePaintFault("source-unreadable");
    } finally {
      if (canvas) disposeCanvas(canvas);
    }
  };
}

function normalizeOptions(
  options: CreateStudioVrmTexturePaintRuntimeOptions,
): NormalizedRuntimeOptions {
  const createCanvas = options.createCanvas ?? defaultCanvasFactory;
  const maxHistoryBytes = boundedByteBudget(
    options.maxHistoryBytes,
    DEFAULT_STUDIO_VRM_TEXTURE_PAINT_RUNTIME_LIMITS.maxHistoryBytes,
  );
  const legacyTargetRgbaBytes = boundedByteBudget(
    options.maxTargetRgbaBytes,
    DEFAULT_STUDIO_VRM_TEXTURE_PAINT_RUNTIME_LIMITS.maxTargetRgbaBytes,
  );
  const maxTargetResidentBytes =
    options.maxTargetResidentBytes === undefined
      ? logicalRgbaToResidentBytes(legacyTargetRgbaBytes)
      : boundedByteBudget(
          options.maxTargetResidentBytes,
          DEFAULT_STUDIO_VRM_TEXTURE_PAINT_RUNTIME_LIMITS.maxTargetResidentBytes,
        );
  const legacyAggregateRgbaBytes = boundedByteBudget(
    options.maxAggregateRgbaBytes,
    DEFAULT_STUDIO_VRM_TEXTURE_PAINT_RUNTIME_LIMITS.maxAggregateRgbaBytes,
  );
  const aggregateResidentFallback = options.maxAggregateRgbaBytes === undefined
    ? saturatedByteSum(maxTargetResidentBytes, maxTargetResidentBytes, maxHistoryBytes)
    : saturatedByteSum(logicalRgbaToResidentBytes(legacyAggregateRgbaBytes), maxHistoryBytes);
  return Object.freeze({
    maxTargetResidentBytes,
    maxAggregateResidentBytes: boundedByteBudget(
      options.maxAggregateResidentBytes,
      aggregateResidentFallback,
    ),
    maxGeometryIndexTriangles: boundedInteger(
      options.maxGeometryIndexTriangles,
      DEFAULT_STUDIO_VRM_TEXTURE_PAINT_RUNTIME_LIMITS.maxGeometryIndexTriangles,
      0,
    ),
    maxConcurrentReads: boundedInteger(
      options.maxConcurrentReads,
      DEFAULT_STUDIO_VRM_TEXTURE_PAINT_RUNTIME_LIMITS.maxConcurrentReads,
      1,
    ),
    maxHistoryEntries: boundedInteger(
      options.maxHistoryEntries,
      DEFAULT_STUDIO_VRM_TEXTURE_PAINT_RUNTIME_LIMITS.maxHistoryEntries,
      1,
    ),
    maxHistoryBytes,
    maxStrokeSamples: boundedInteger(
      options.maxStrokeSamples,
      DEFAULT_STUDIO_VRM_TEXTURE_PAINT_RUNTIME_LIMITS.maxStrokeSamples,
      2,
    ),
    undoTileSize: boundedInteger(
      options.undoTileSize,
      DEFAULT_STUDIO_VRM_TEXTURE_PAINT_RUNTIME_LIMITS.undoTileSize,
      1,
    ),
    createCanvas,
    readTextureImage: options.readTextureImage ?? createDefaultImageReader(createCanvas),
    runTextureFill: options.runTextureFill ?? runStudioVrmTextureFillWorker,
    precomputeGeometryIndex:
      options.precomputeGeometryIndex ?? precomputeStudioVrmTextureGeometryIndex,
  });
}

function isCompressedTexture(texture: THREE.Texture): boolean {
  const candidate = texture as THREE.Texture & {
    readonly isCompressedTexture?: unknown;
    readonly isCompressedArrayTexture?: unknown;
    readonly isCompressedCubeTexture?: unknown;
  };
  return candidate.isCompressedTexture === true
    || candidate.isCompressedArrayTexture === true
    || candidate.isCompressedCubeTexture === true;
}

function isBaseColorMaterial(material: unknown): material is BaseColorMaterial {
  return typeof material === "object" && material !== null && "map" in material;
}

function stableScenePathHash(value: string): string {
  let hash = 0x811c_9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x0100_0193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function createScenePathMaterialLocator(
  objectPath: string,
  materialIndex: number,
): string {
  const candidate = `scene-path:${objectPath}/material-${materialIndex}`;
  return canonicalMaterialLocator(candidate)
    ? candidate
    : `scene-path:hashed-${stableScenePathHash(candidate)}`;
}

/**
 * Returns one deterministic locator per material. GLTFLoader integrations may stamp the stable
 * glTF material index in userData; hand-built/test scenes use a child-index path fallback.
 */
function collectSceneMaterialBindings(
  scene: THREE.Object3D,
): Map<BaseColorMaterial, StudioVrmTexturePaintBindingDescriptor> {
  const bindings = new Map<BaseColorMaterial, StudioVrmTexturePaintBindingDescriptor>();
  const stack: Array<Readonly<{ object: THREE.Object3D; path: string }>> = [
    { object: scene, path: "root" },
  ];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    const mesh = current.object as THREE.Object3D & {
      readonly isMesh?: unknown;
      readonly material?: THREE.Material | THREE.Material[];
    };
    if (mesh.isMesh === true && mesh.material) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((candidate, materialIndex) => {
        if (!isBaseColorMaterial(candidate)) return;
        const stamped = canonicalMaterialLocator(
          candidate.userData?.[STUDIO_VRM_TEXTURE_PAINT_MATERIAL_LOCATOR_USER_DATA_KEY],
        );
        const descriptor = createBindingDescriptor(
          stamped ?? createScenePathMaterialLocator(current.path, materialIndex),
        );
        if (!descriptor) return;
        const previous = bindings.get(candidate);
        if (!previous || descriptor.bindingKey < previous.bindingKey) {
          bindings.set(candidate, descriptor);
        }
      });
    }
    for (let childIndex = current.object.children.length - 1; childIndex >= 0; childIndex -= 1) {
      const child = current.object.children[childIndex];
      if (!child) continue;
      stack.push({ object: child, path: `${current.path}/child-${childIndex}` });
    }
  }
  return bindings;
}

function collectGeometryPrewarmJobs(
  scene: THREE.Object3D,
  maxTriangles: number,
): readonly GeometryPrewarmJob[] {
  const jobs: GeometryPrewarmJob[] = [];
  const seen = new WeakMap<StudioVrmTextureGeometryLike, Set<string>>();
  scene.traverse((object) => {
    const candidate = object as THREE.Object3D & {
      readonly isMesh?: unknown;
      readonly geometry?: StudioVrmTextureGeometryLike;
    };
    const geometry = candidate.isMesh === true ? candidate.geometry : undefined;
    if (!geometry || typeof geometry.getAttribute !== "function") return;
    for (const uvAttribute of ["uv", "uv1"] as const) {
      try {
        if (!geometry.getAttribute(uvAttribute)) continue;
      } catch {
        continue;
      }
      const admission = inspectStudioVrmTextureGeometryAdmission(geometry, {
        uvAttribute,
        maxTriangles,
      });
      if (!admission?.admitted) continue;
      let attributes = seen.get(geometry);
      if (!attributes) {
        attributes = new Set();
        seen.set(geometry, attributes);
      }
      if (attributes.has(uvAttribute)) continue;
      attributes.add(uvAttribute);
      jobs.push(Object.freeze({ geometry, uvAttribute }));
    }
  });
  return Object.freeze(jobs);
}

function pixelsEqual(left: Uint8ClampedArray, right: Uint8ClampedArray): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function materialAtHit(
  mesh: THREE.Mesh,
  hit: StudioVrmTexturePaintRayHit,
): BaseColorMaterial | null {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const candidate = hit.face?.materialIndex;
  let materialIndex: number;
  if (candidate !== undefined) {
    if (!Number.isSafeInteger(candidate) || candidate < 0 || candidate >= materials.length) {
      return null;
    }
    materialIndex = candidate;
  } else {
    if (materials.length > 1) return null;
    materialIndex = 0;
  }
  const material = materials[materialIndex];
  return material && isBaseColorMaterial(material) ? material : null;
}

function objectBelongsToScene(object: THREE.Object3D, scene: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current === scene) return true;
    current = current.parent;
  }
  return false;
}

function finiteUv(
  value: THREE.Vector2 | Readonly<{ x: number; y: number }> | undefined,
): THREE.Vector2 | null {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return null;
  return new THREE.Vector2(value.x, value.y);
}

function finiteWorld(
  value: THREE.Vector3 | Readonly<{ x: number; y: number; z: number }> | undefined,
): Readonly<{ x: number; y: number; z: number }> | undefined {
  if (
    !value
    || !Number.isFinite(value.x)
    || !Number.isFinite(value.y)
    || !Number.isFinite(value.z)
  ) {
    return undefined;
  }
  return { x: value.x, y: value.y, z: value.z };
}

function normalizedSamplePressure(sample: StudioVrmTextureStrokeSample): number {
  const pressure = sample.pressure;
  return typeof pressure === "number" && Number.isFinite(pressure)
    ? Math.min(1, Math.max(0, pressure))
    : 0.5;
}

function canCoalesceStrokeSample(
  previous: StudioVrmTextureStrokeSample | undefined,
  next: StudioVrmTextureStrokeSample,
): boolean {
  if (!previous || previous.islandId !== next.islandId) return false;
  if (Math.abs(previous.uv.u - next.uv.u) > SAMPLE_UV_EPSILON) return false;
  if (Math.abs(previous.uv.v - next.uv.v) > SAMPLE_UV_EPSILON) return false;
  return Math.abs(normalizedSamplePressure(previous) - normalizedSamplePressure(next))
    <= SAMPLE_PRESSURE_EPSILON;
}

function textureWrapMode(value: THREE.Wrapping): StudioVrmTextureWrapMode {
  if (value === THREE.RepeatWrapping) return "repeat";
  if (value === THREE.MirroredRepeatWrapping) return "mirror";
  return "clamp";
}

function paintWrapOptions(texture: THREE.Texture): StudioVrmTexturePaintApplyOptions {
  return Object.freeze({
    wrapU: textureWrapMode(texture.wrapS),
    wrapV: textureWrapMode(texture.wrapT),
  });
}

function textureSamplingSignature(texture: THREE.Texture): TextureSamplingSignature {
  return Object.freeze({
    channel: texture.channel,
    flipY: texture.flipY,
    format: texture.format,
    image: texture.image,
    matrixAutoUpdate: texture.matrixAutoUpdate,
    matrixElements: Object.freeze([...texture.matrix.elements]),
    version: texture.version,
    type: texture.type,
    wrapS: texture.wrapS,
    wrapT: texture.wrapT,
  });
}

function sameTextureSamplingSignature(
  left: TextureSamplingSignature,
  right: TextureSamplingSignature,
): boolean {
  if (
    left.channel !== right.channel
    || left.flipY !== right.flipY
    || left.format !== right.format
    || left.image !== right.image
    || left.matrixAutoUpdate !== right.matrixAutoUpdate
    || left.version !== right.version
    || left.type !== right.type
    || left.wrapS !== right.wrapS
    || left.wrapT !== right.wrapT
    || left.matrixElements.length !== right.matrixElements.length
  ) {
    return false;
  }
  return left.matrixElements.every((value, index) => value === right.matrixElements[index]);
}

function sameResolvedBaseColorHit(
  left: ResolvedBaseColorHit,
  right: ResolvedBaseColorHit,
): boolean {
  return (
    left.material === right.material
    && left.sourceTexture === right.sourceTexture
    && left.effectiveTexture === right.effectiveTexture
    && left.target === right.target
    && left.uv.u === right.uv.u
    && left.uv.v === right.uv.v
    && left.wrapU === right.wrapU
    && left.wrapV === right.wrapV
    && left.samplingSignature !== null
    && right.samplingSignature !== null
    && sameTextureSamplingSignature(left.samplingSignature, right.samplingSignature)
  );
}

function copyStrokeStyle(style: StudioVrmTextureStrokeStyle): StudioVrmTextureStrokeStyle {
  return Object.freeze({
    ...style,
    ...(style.tuning ? { tuning: Object.freeze({ ...style.tuning }) } : {}),
  });
}

function isValidStrokeStyle(style: StudioVrmTextureStrokeStyle): boolean {
  const kinds = new Set(["airbrush", "ink", "pencil", "watercolor"]);
  const blends = new Set(["erase", "multiply", "normal", "overlay", "screen"]);
  if (!kinds.has(style.kind) || !blends.has(style.blend)) return false;
  if (!Number.isFinite(style.sizeTexels) || style.sizeTexels <= 0) return false;
  if (!Number.isFinite(style.opacity) || style.opacity < 0 || style.opacity > 1) return false;
  return style.blend === "erase" || parseStudioVrmTextureColor(style.color) !== null;
}

function isValidSurfacePaintOperation(operation: StudioVrmTexturePaintOp): boolean {
  if (
    !Number.isFinite(operation.x)
    || !Number.isFinite(operation.y)
    || !Number.isFinite(operation.radius)
    || operation.radius <= 0
    || !Number.isFinite(operation.hardness)
    || operation.hardness < 0
    || operation.hardness > 1
    || !Number.isFinite(operation.opacity)
    || operation.opacity < 0
    || operation.opacity > 1
    || parseStudioVrmTextureColor(operation.color) === null
  ) {
    return false;
  }
  return operation.blend === "normal"
    || operation.blend === "multiply"
    || operation.blend === "screen"
    || operation.blend === "overlay"
    || operation.blend === "erase";
}

function markMaterialChanged(material: THREE.Material): void {
  try {
    material.needsUpdate = true;
  } catch {
    // A custom material may expose a throwing setter. The map ownership change still stands.
  }
}

function copyTextureSampling(source: THREE.Texture, target: THREE.CanvasTexture): void {
  if (source.matrixAutoUpdate) source.updateMatrix();
  target.mapping = source.mapping;
  target.channel = source.channel;
  target.wrapS = source.wrapS;
  target.wrapT = source.wrapT;
  target.magFilter = source.magFilter;
  target.minFilter = source.minFilter;
  target.anisotropy = source.anisotropy;
  target.colorSpace = source.colorSpace;
  target.offset.copy(source.offset);
  target.repeat.copy(source.repeat);
  target.center.copy(source.center);
  target.rotation = source.rotation;
  target.matrixAutoUpdate = source.matrixAutoUpdate;
  target.matrix.copy(source.matrix);
  target.generateMipmaps = source.generateMipmaps;
  target.premultiplyAlpha = source.premultiplyAlpha;
  target.unpackAlignment = source.unpackAlignment;
  target.flipY = false;
  target.name = source.name ? `${source.name} · Studio paint` : "Studio VRM texture paint";
  target.needsUpdate = true;
}

function disposeCanvas(canvas: HTMLCanvasElement): void {
  const close = (canvas as HTMLCanvasElement & { close?: () => void }).close;
  try {
    close?.call(canvas);
  } catch {
    // Width/height reset below remains the portable release path.
  }
  canvas.width = 0;
  canvas.height = 0;
}

function sourceTargetId(texture: THREE.Texture): string {
  return `vrm-texture:${texture.uuid}`;
}

function byteHex(value: number): string {
  return value.toString(16).padStart(2, "0");
}

function sampleResolvedTextureColor(
  resolved: ResolvedBaseColorHit,
  pixels: Uint8ClampedArray,
  size: StudioVrmTextureSize,
): StudioVrmTexturePaintRuntimeResult<StudioVrmTexturePaintColorSample> {
  if (pixels.byteLength !== size.width * size.height * RGBA_CHANNELS) {
    return failure("invalid-dimensions");
  }
  const texel = resolveStudioVrmTexelIndex(resolved.uv, size, {
    wrapU: resolved.wrapU,
    wrapV: resolved.wrapV,
    flipV: false,
  });
  if (!texel) return failure("uv-missing");
  const offset = texel.index * RGBA_CHANNELS;
  const r = pixels[offset];
  const g = pixels[offset + 1];
  const b = pixels[offset + 2];
  const a = pixels[offset + 3];
  if (r === undefined || g === undefined || b === undefined || a === undefined) {
    return failure("invalid-dimensions");
  }
  return success(Object.freeze({
    color: `#${byteHex(r)}${byteHex(g)}${byteHex(b)}`,
    rgba: Object.freeze({ r, g, b, a }),
    texel: Object.freeze({ x: texel.x, y: texel.y }),
    sourceTextureUuid: resolved.sourceTexture.uuid,
    sourceName: resolved.sourceTexture.name,
    targetId: resolved.target?.id ?? null,
  }));
}

interface PreparedFillSelection {
  readonly bitMask: Uint8Array;
  readonly changedCount: number;
  readonly rect: StudioVrmTextureRect;
}

function textureFillBitIsSet(mask: Uint8Array, position: number): boolean {
  return (mask[position >>> 3]! & (1 << (position & 7))) !== 0;
}

function setTextureFillBit(mask: Uint8Array, position: number): void {
  const byteIndex = position >>> 3;
  mask[byteIndex] = mask[byteIndex]! | (1 << (position & 7));
}

function countTextureFillBits(mask: Uint8Array): number {
  let count = 0;
  for (const byte of mask) {
    let value = byte;
    value -= (value >>> 1) & 0x55;
    value = (value & 0x33) + ((value >>> 2) & 0x33);
    count += (value + (value >>> 4)) & 0x0f;
  }
  return count;
}

function isValidTextureFillRect(
  rect: StudioVrmTextureRect,
  size: StudioVrmTextureSize,
): boolean {
  return Number.isSafeInteger(rect.x)
    && Number.isSafeInteger(rect.y)
    && Number.isSafeInteger(rect.width)
    && Number.isSafeInteger(rect.height)
    && rect.x >= 0
    && rect.y >= 0
    && rect.width > 0
    && rect.height > 0
    && rect.x + rect.width <= size.width
    && rect.y + rect.height <= size.height;
}

/**
 * Validates the Worker mask, removes pixels already equal to the requested RGB, and crops the
 * retained history mask to the actually changed rectangle. Alpha is intentionally not compared or
 * changed because VRM baseColor transparency usually controls cutout hair/clothes.
 */
function prepareTextureFillSelection(
  pixels: Uint8ClampedArray,
  size: StudioVrmTextureSize,
  result: StudioVrmTextureFillResult,
  color: Readonly<{ r: number; g: number; b: number }>,
): PreparedFillSelection | null {
  const pixelCount = size.width * size.height;
  if (
    !(result.bitMask instanceof Uint8Array)
    || result.bitMask.byteLength !== Math.ceil(pixelCount / 8)
    || !Number.isSafeInteger(result.matchedCount)
    || result.matchedCount <= 0
    || result.matchedCount > pixelCount
    || !result.bounds
    || !isValidTextureFillRect(result.bounds, size)
    // A Worker result is an untrusted transaction proposal. Its declared count must cover every
    // set bit, including bits outside the declared bounds and padding bits past the texture end.
    || countTextureFillBits(result.bitMask) !== result.matchedCount
  ) {
    return null;
  }

  let observedMatches = 0;
  let changedCount = 0;
  let minX = size.width;
  let minY = size.height;
  let maxX = -1;
  let maxY = -1;
  const right = result.bounds.x + result.bounds.width;
  const bottom = result.bounds.y + result.bounds.height;
  for (let y: number = result.bounds.y; y < bottom; y += 1) {
    for (let x: number = result.bounds.x; x < right; x += 1) {
      const atlasPosition: number = y * size.width + x;
      if (!textureFillBitIsSet(result.bitMask, atlasPosition)) continue;
      observedMatches += 1;
      const offset = atlasPosition * RGBA_CHANNELS;
      if (
        pixels[offset] === color.r
        && pixels[offset + 1] === color.g
        && pixels[offset + 2] === color.b
      ) {
        continue;
      }
      changedCount += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (observedMatches !== result.matchedCount) return null;
  if (changedCount === 0) {
    return {
      bitMask: new Uint8Array(0),
      changedCount: 0,
      rect: EMPTY_STUDIO_VRM_TEXTURE_RECT,
    };
  }

  const rect = {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
  const localMask = new Uint8Array(Math.ceil((rect.width * rect.height) / 8));
  const changedRight = rect.x + rect.width;
  const changedBottom = rect.y + rect.height;
  for (let y = rect.y; y < changedBottom; y += 1) {
    for (let x = rect.x; x < changedRight; x += 1) {
      const atlasPosition = y * size.width + x;
      if (!textureFillBitIsSet(result.bitMask, atlasPosition)) continue;
      const offset = atlasPosition * RGBA_CHANNELS;
      if (
        pixels[offset] === color.r
        && pixels[offset + 1] === color.g
        && pixels[offset + 2] === color.b
      ) {
        continue;
      }
      setTextureFillBit(localMask, (y - rect.y) * rect.width + x - rect.x);
    }
  }
  return { bitMask: localMask, changedCount, rect };
}

function textureFillHistoryBytes(
  selection: PreparedFillSelection,
): number | null {
  const beforeBytes = selection.changedCount * 3;
  if (!Number.isSafeInteger(beforeBytes) || beforeBytes < 0) return null;
  const bytes = saturatedByteSum(selection.bitMask.byteLength, beforeBytes, 32);
  return bytes === Number.MAX_SAFE_INTEGER ? null : bytes;
}

function textureFillResultMatchesSeed(
  pixels: Uint8ClampedArray,
  size: StudioVrmTextureSize,
  seed: Readonly<{ readonly x: number; readonly y: number; readonly index: number }>,
  result: StudioVrmTextureFillResult,
): boolean {
  const pixelCount = size.width * size.height;
  const seedRgba = result.seedRgba as unknown;
  if (
    !(result.bitMask instanceof Uint8Array)
    || result.bitMask.byteLength !== Math.ceil(pixelCount / 8)
    || !textureFillBitIsSet(result.bitMask, seed.index)
    || !result.bounds
    || seed.x < result.bounds.x
    || seed.y < result.bounds.y
    || seed.x >= result.bounds.x + result.bounds.width
    || seed.y >= result.bounds.y + result.bounds.height
    || !Array.isArray(seedRgba)
    || seedRgba.length !== RGBA_CHANNELS
    || seedRgba.some(
      (channel) =>
        typeof channel !== "number"
        || !Number.isSafeInteger(channel)
        || channel < 0
        || channel > 255,
    )
  ) {
    return false;
  }
  const seedOffset = seed.index * RGBA_CHANNELS;
  return seedRgba[0] === pixels[seedOffset]
    && seedRgba[1] === pixels[seedOffset + 1]
    && seedRgba[2] === pixels[seedOffset + 2]
    && seedRgba[3] === pixels[seedOffset + 3];
}

function applyTextureFillHistoryPixels(
  record: FillHistoryRecord,
  direction: "redo" | "undo",
): boolean {
  if (
    !record.target.valid
    || !isValidTextureFillRect(record.rect, record.target.size)
    || record.bitMask.byteLength !== Math.ceil(
      (record.rect.width * record.rect.height) / 8,
    )
  ) {
    return false;
  }
  let beforeOffset = 0;
  const right = record.rect.x + record.rect.width;
  const bottom = record.rect.y + record.rect.height;
  for (let y = record.rect.y; y < bottom; y += 1) {
    for (let x = record.rect.x; x < right; x += 1) {
      const localPosition = (y - record.rect.y) * record.rect.width + x - record.rect.x;
      if (!textureFillBitIsSet(record.bitMask, localPosition)) continue;
      const pixelOffset = (y * record.target.size.width + x) * RGBA_CHANNELS;
      if (direction === "undo") {
        const r = record.beforeRgb[beforeOffset];
        const g = record.beforeRgb[beforeOffset + 1];
        const b = record.beforeRgb[beforeOffset + 2];
        if (r === undefined || g === undefined || b === undefined) return false;
        record.target.imageData.data[pixelOffset] = r;
        record.target.imageData.data[pixelOffset + 1] = g;
        record.target.imageData.data[pixelOffset + 2] = b;
      } else {
        record.target.imageData.data[pixelOffset] = record.fillRgb.r;
        record.target.imageData.data[pixelOffset + 1] = record.fillRgb.g;
        record.target.imageData.data[pixelOffset + 2] = record.fillRgb.b;
      }
      beforeOffset += 3;
    }
  }
  return beforeOffset === record.beforeRgb.byteLength;
}

function flipRgbaRowsInPlace(
  data: Uint8ClampedArray,
  size: StudioVrmTextureSize,
): void {
  const rowBytes = size.width * RGBA_CHANNELS;
  const temporary = new Uint8ClampedArray(rowBytes);
  for (let top = 0; top < Math.floor(size.height / 2); top += 1) {
    const bottom = size.height - top - 1;
    const topOffset = top * rowBytes;
    const bottomOffset = bottom * rowBytes;
    temporary.set(data.subarray(topOffset, topOffset + rowBytes));
    data.copyWithin(topOffset, bottomOffset, bottomOffset + rowBytes);
    data.set(temporary, bottomOffset);
  }
}

export class StudioVrmTexturePaintRuntime {
  private readonly scene: THREE.Object3D;
  private readonly options: NormalizedRuntimeOptions;
  private readonly targetsByOriginal = new Map<THREE.Texture, PaintTarget>();
  private readonly targetsByPainted = new Map<THREE.Texture, PaintTarget>();
  private readonly targets: PaintTarget[] = [];
  private readonly listeners = new Set<StudioVrmTexturePaintRuntimeListener>();
  private readonly geometryPrewarmController = new AbortController();
  private readonly inFlightReadControllers = new Set<AbortController>();
  private readonly inFlightReadsBySource = new Map<THREE.Texture, number>();
  private inFlightReadCount = 0;
  private historyPast: HistoryRecord[] = [];
  private historyFuture: HistoryRecord[] = [];
  private historyBytes = 0;
  private aggregateRgbaBytes = 0;
  private aggregateTargetResidentBytes = 0;
  private selectedTarget: PaintTarget | null = null;
  private sampling: PendingColorSample | null = null;
  private filling: PendingFill | null = null;
  private pending: PendingStroke | null = null;
  private active: ActiveStroke | null = null;
  private surfaceSession: SurfacePaintSessionState | null = null;
  private surfaceSessionSequence = 0;
  private lastError: StudioVrmTexturePaintRuntimeError | null = null;
  private lastGuidance: StudioVrmTexturePaintRuntimeGuidance | null = null;
  private disposed = false;
  private contentRevision = 0;
  private snapshot: StudioVrmTexturePaintRuntimeSnapshot;

  constructor(
    scene: THREE.Object3D,
    options: CreateStudioVrmTexturePaintRuntimeOptions = {},
  ) {
    this.scene = scene;
    this.options = normalizeOptions(options);
    this.snapshot = this.createSnapshot();
    void this.prewarmSceneGeometry();
  }

  getSnapshot = (): StudioVrmTexturePaintRuntimeSnapshot => this.snapshot;

  /**
   * Monotonic revision of canvas-visible/export-observable RGBA content. Unlike React snapshots,
   * this advances for every successful incremental dirty-rect upload, including pointer moves that
   * intentionally avoid publishing UI state.
   */
  getContentRevision = (): number => this.contentRevision;

  subscribe = (listener: StudioVrmTexturePaintRuntimeListener): (() => void) => {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.listeners.delete(listener);
    };
  };

  clearError(): StudioVrmTexturePaintRuntimeSnapshot {
    if (this.lastError || this.lastGuidance) {
      this.lastError = null;
      this.lastGuidance = null;
      this.publish();
    }
    return this.snapshot;
  }

  exportPaintedTargets():
    StudioVrmTexturePaintRuntimeResult<readonly StudioVrmTexturePaintExportTarget[]> {
    if (this.disposed) return this.fail("disposed");
    if (this.sampling || this.filling || this.pending || this.active || this.surfaceSession) {
      return this.fail("pointer-active");
    }
    const exported: StudioVrmTexturePaintExportTarget[] = [];
    const bindingOwners = new Map<string, string>();
    for (const target of this.targets) {
      if (!target.valid) return this.fail("target-invalid");
      if (pixelsEqual(target.imageData.data, target.originalPixels)) continue;
      const bindingsByIdentity = new Map<string, StudioVrmTexturePaintBindingDescriptor>();
      for (const { descriptor } of target.bindings.values()) {
        const identity = `${descriptor.materialLocator}\u0000${descriptor.textureSlot}`;
        const owner = bindingOwners.get(identity);
        if (owner !== undefined && owner !== target.id) return this.fail("binding-conflict");
        bindingOwners.set(identity, target.id);
        bindingsByIdentity.set(identity, descriptor);
      }
      const bindings = [...bindingsByIdentity.values()]
        .sort((left, right) => left.bindingKey.localeCompare(right.bindingKey));
      if (bindings.length === 0) return this.fail("binding-missing");
      exported.push(Object.freeze({
        id: target.id,
        width: target.size.width,
        height: target.size.height,
        pixels: target.imageData.data.slice(),
        bindings: Object.freeze(bindings),
      }));
    }
    exported.sort((left, right) =>
      (left.bindings[0]?.bindingKey ?? "").localeCompare(
        right.bindings[0]?.bindingKey ?? "",
      ));
    return success(Object.freeze(exported));
  }

  async rehydrateTarget(
    input: StudioVrmTexturePaintRehydrateTarget,
  ): Promise<
    StudioVrmTexturePaintRuntimeResult<StudioVrmTexturePaintRuntimeSnapshot>
  > {
    if (this.disposed) return this.fail("disposed");
    if (this.sampling || this.filling || this.pending || this.active || this.surfaceSession) {
      return this.fail("pointer-active");
    }
    if (!isCanonicalBindingDescriptor(input.binding)) return this.fail("binding-missing");
    if (input.signal?.aborted) return this.fail("source-read-aborted");
    const size = {
      width: input.image?.width,
      height: input.image?.height,
    };
    if (
      !isStudioVrmTextureSize(size)
      || !(input.image?.data instanceof Uint8ClampedArray)
      || input.image.data.byteLength !== size.width * size.height * RGBA_CHANNELS
    ) {
      return this.fail("invalid-dimensions");
    }

    const materialEntries = [...collectSceneMaterialBindings(this.scene)]
      .filter(([, descriptor]) =>
        descriptor.materialLocator === input.binding.materialLocator
        && descriptor.textureSlot === input.binding.textureSlot
      );
    if (materialEntries.length > 1) return this.fail("binding-conflict");
    const materialEntry = materialEntries[0];
    const material = materialEntry?.[0];
    if (!material) return this.fail("binding-missing");
    let currentMap: THREE.Texture | null;
    try {
      currentMap = material.map;
    } catch {
      return this.fail("binding-missing");
    }
    if (!currentMap?.isTexture) return this.fail("map-missing");

    const existing =
      this.targetsByPainted.get(currentMap)
      ?? this.targetsByOriginal.get(currentMap)
      ?? null;
    if (existing) {
      const boundDescriptor = existing.bindings.get(material)?.descriptor;
      const ownsBinding =
        boundDescriptor?.materialLocator === input.binding.materialLocator
        && boundDescriptor.textureSlot === input.binding.textureSlot;
      if (
        !ownsBinding
        || existing.size.width !== size.width
        || existing.size.height !== size.height
        || !pixelsEqual(existing.imageData.data, input.image.data)
      ) {
        return this.fail("binding-conflict");
      }
      this.selectedTarget = existing;
      this.lastError = null;
      this.publish();
      return success(this.snapshot);
    }

    const controller = new AbortController();
    const handleAbort = () => controller.abort();
    input.signal?.addEventListener("abort", handleAbort, { once: true });
    try {
      const original = await this.readSourceTexture(currentMap, controller);
      if (!original.ok) return this.fail(original.error.code);
      if (input.signal?.aborted || this.disposed) {
        return this.fail(this.disposed ? "disposed" : "source-read-aborted");
      }
      if (
        original.value.width !== size.width
        || original.value.height !== size.height
      ) {
        return this.fail("binding-conflict");
      }
      const targetResult = this.createTarget(currentMap, original.value);
      if (!targetResult.ok) return this.fail(targetResult.error.code);
      const created = targetResult.value;
      const createdDescriptor = created.bindings.get(material)?.descriptor;
      if (
        createdDescriptor?.materialLocator !== input.binding.materialLocator
        || createdDescriptor.textureSlot !== input.binding.textureSlot
      ) {
        this.invalidateTarget(created);
        return this.fail("binding-missing");
      }
      if (input.signal?.aborted || this.disposed) {
        this.invalidateTarget(created);
        return this.fail(this.disposed ? "disposed" : "source-read-aborted");
      }
      created.imageData.data.set(input.image.data);
      if (!this.syncTarget(created)) {
        this.invalidateTarget(created);
        return this.fail("canvas-unavailable");
      }
      this.selectedTarget = created;
      this.lastError = null;
      this.publish();
      return success(this.snapshot);
    } finally {
      input.signal?.removeEventListener("abort", handleAbort);
    }
  }

  async sampleBaseColor(
    input: StudioVrmTexturePaintColorSampleInput,
  ): Promise<StudioVrmTexturePaintRuntimeResult<StudioVrmTexturePaintColorSample>> {
    if (this.disposed) return this.fail("disposed");
    if (this.sampling || this.filling || this.pending || this.active || this.surfaceSession) {
      return this.fail("pointer-active");
    }
    if (input.signal?.aborted) return this.fail("source-read-aborted");

    this.lastGuidance = null;
    const hitResult = this.resolveBaseColorHit(input.hit, true);
    if (!hitResult.ok) return this.fail(hitResult.error.code);
    const resolved = hitResult.value;
    if (resolved.target) {
      const sampled = sampleResolvedTextureColor(
        resolved,
        resolved.target.imageData.data,
        resolved.target.size,
      );
      if (!sampled.ok) return this.fail(sampled.error.code);
      this.lastError = null;
      this.lastGuidance = null;
      this.publish();
      return sampled;
    }

    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    input.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const request = Object.freeze({ controller });
    this.sampling = request;
    this.publish();
    try {
      const readable = await this.readSourceTexture(resolved.sourceTexture, controller);
      if (this.sampling !== request || this.disposed) {
        return failure(this.disposed ? "disposed" : "stale-completion");
      }
      if (!readable.ok) {
        this.sampling = null;
        return this.fail(readable.error.code);
      }
      const currentHit = this.resolveBaseColorHit(input.hit, true);
      if (!currentHit.ok || !sameResolvedBaseColorHit(resolved, currentHit.value)) {
        this.sampling = null;
        return this.fail("source-changed");
      }
      const sampled = sampleResolvedTextureColor(
        resolved,
        readable.value.data,
        readable.value,
      );
      this.sampling = null;
      if (!sampled.ok) return this.fail(sampled.error.code);
      this.lastError = null;
      this.lastGuidance = null;
      this.publish();
      return sampled;
    } finally {
      input.signal?.removeEventListener("abort", abortFromCaller);
      if (this.sampling === request) {
        this.sampling = null;
        this.publish();
      }
    }
  }

  async fillBaseColor(
    input: StudioVrmTexturePaintFillInput,
  ): Promise<StudioVrmTexturePaintRuntimeResult<boolean>> {
    if (this.disposed) return this.fail("disposed");
    if (this.sampling || this.filling || this.pending || this.active || this.surfaceSession) {
      return this.fail("pointer-active");
    }
    if (input.signal?.aborted) return this.fail("source-read-aborted");
    const color = parseStudioVrmTextureColor(input.color);
    if (
      !color
      || !Number.isSafeInteger(input.tolerance)
      || input.tolerance < 0
      || input.tolerance > 255
      || (input.scope !== "contiguous" && input.scope !== "whole-material")
    ) {
      return this.fail("invalid-style");
    }

    this.lastGuidance = null;
    const hitResult = this.resolveBaseColorHit(input.hit, true);
    if (!hitResult.ok) return this.fail(hitResult.error.code);
    const resolved = hitResult.value;
    const initialContentRevision = this.contentRevision;
    const knownSize = resolved.target?.size ?? textureImageDimensions(resolved.sourceTexture);
    if (
      knownSize
      && !this.admitTextureFillTransient(knownSize, resolved.target === null)
    ) {
      return this.fail("fill-memory-budget");
    }

    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    input.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const request = Object.freeze({ controller });
    this.filling = request;
    this.publish();
    try {
      let readable: StudioVrmTexturePaintReadableImage;
      if (resolved.target) {
        readable = {
          width: resolved.target.size.width,
          height: resolved.target.size.height,
          data: resolved.target.imageData.data,
        };
      } else {
        const readResult = await this.readSourceTexture(resolved.sourceTexture, controller);
        if (this.filling !== request || this.disposed) {
          return failure(this.disposed ? "disposed" : "stale-completion");
        }
        if (!readResult.ok) return this.fail(readResult.error.code);
        readable = readResult.value;
      }
      if (controller.signal.aborted) return this.fail("source-read-aborted");

      const size = { width: readable.width, height: readable.height };
      if (
        !isStudioVrmTextureSize(size)
        || !this.admitTextureFillTransient(size, resolved.target === null)
      ) {
        return this.fail("fill-memory-budget");
      }
      const currentBeforeWorker = this.resolveBaseColorHit(input.hit, true);
      if (
        !currentBeforeWorker.ok
        || !sameResolvedBaseColorHit(resolved, currentBeforeWorker.value)
        || this.contentRevision !== initialContentRevision
      ) {
        return this.fail("source-changed");
      }
      const seed = resolveStudioVrmTexelIndex(resolved.uv, size, {
        wrapU: resolved.wrapU,
        wrapV: resolved.wrapV,
        flipV: false,
      });
      if (!seed) return this.fail("uv-missing");

      let fillResult: StudioVrmTextureFillWorkerClientResult;
      try {
        let workerPixels: Uint8ClampedArray;
        try {
          workerPixels = readable.data.slice();
        } catch {
          return this.fail("fill-memory-budget");
        }
        fillResult = await this.options.runTextureFill({
          pixels: workerPixels,
          width: size.width,
          height: size.height,
          seed: { x: seed.x, y: seed.y },
          tolerance: input.tolerance,
          scope: input.scope,
        }, {
          signal: controller.signal,
        });
      } catch (error) {
        if (this.filling !== request || this.disposed) {
          return failure(this.disposed ? "disposed" : "stale-completion");
        }
        if (controller.signal.aborted) return this.fail("source-read-aborted");
        const name =
          typeof error === "object" && error !== null && "name" in error
            ? String((error as { readonly name?: unknown }).name)
            : "";
        return this.fail(
          name === "NotSupportedError"
            ? "fill-worker-unavailable"
            : "fill-worker-failed",
        );
      }
      if (this.filling !== request || this.disposed) {
        return failure(this.disposed ? "disposed" : "stale-completion");
      }
      if (controller.signal.aborted) return this.fail("source-read-aborted");

      const currentAfterWorker = this.resolveBaseColorHit(input.hit, true);
      if (
        !currentAfterWorker.ok
        || !sameResolvedBaseColorHit(resolved, currentAfterWorker.value)
        || this.contentRevision !== initialContentRevision
      ) {
        return this.fail("source-changed");
      }
      if (
        fillResult.execution !== "worker"
        || !textureFillResultMatchesSeed(readable.data, size, seed, fillResult.result)
      ) {
        return this.fail("fill-worker-failed");
      }
      const selection = prepareTextureFillSelection(
        readable.data,
        size,
        fillResult.result,
        color,
      );
      if (!selection) return this.fail("fill-worker-failed");
      if (selection.changedCount === 0) {
        this.selectedTarget = resolved.target;
        this.lastError = null;
        this.lastGuidance = null;
        this.publish();
        return success(false);
      }
      const historyBytes = textureFillHistoryBytes(selection);
      if (historyBytes === null) {
        return this.fail("history-budget");
      }

      const historyCheckpoint = this.captureHistoryCheckpoint();
      if (!this.admitHistoryPeak(historyBytes)) {
        this.restoreHistoryCheckpoint(historyCheckpoint);
        return this.fail("history-budget");
      }

      let target = resolved.target;
      let createdTarget: PaintTarget | null = null;
      if (!target) {
        const targetResult = this.createTarget(resolved.sourceTexture, readable);
        if (!targetResult.ok) {
          this.restoreHistoryCheckpoint(historyCheckpoint);
          return this.fail(targetResult.error.code);
        }
        target = targetResult.value;
        createdTarget = target;
      } else {
        const rebound = this.bindUnownedSourceMaterials(target);
        if (!rebound.ok) {
          this.restoreHistoryCheckpoint(historyCheckpoint);
          return this.fail(rebound.error.code);
        }
      }
      if (!target.valid) {
        this.restoreHistoryCheckpoint(historyCheckpoint);
        return this.fail("target-invalid");
      }

      const history = this.applyInitialTextureFill(
        target,
        selection,
        color,
        historyBytes,
      );
      if (!history.ok) {
        if (createdTarget?.valid) this.invalidateTarget(createdTarget);
        this.restoreHistoryCheckpoint(historyCheckpoint);
        return this.fail(history.error.code);
      }
      this.clearFutureHistory();
      this.historyPast.push(history.value);
      this.historyBytes += history.value.bytes;
      this.evictHistory();
      this.selectedTarget = target;
      this.lastError = null;
      this.lastGuidance = null;
      this.publish();
      return success(true);
    } finally {
      input.signal?.removeEventListener("abort", abortFromCaller);
      if (this.filling === request) {
        this.filling = null;
        this.publish();
      }
    }
  }

  /**
   * Prepare the runtime-owned atlas for a package-level surface brush.
   * Ray/triangle classification still runs through the same `resolveHit`
   * path as pointer painting; this seam only leases the resulting target.
   */
  async prepareSurfaceBrushSession(
    input: StudioVrmTexturePaintSurfacePrepareInput,
  ): Promise<
    StudioVrmTexturePaintRuntimeResult<StudioVrmTexturePaintPreparedSurface>
  > {
    if (this.disposed) return this.fail("disposed");
    if (this.sampling || this.filling || this.pending || this.active || this.surfaceSession) {
      return this.fail("pointer-active");
    }
    if (input.signal?.aborted) return this.fail("source-read-aborted");
    if (
      input.pressure !== undefined
      && (!Number.isFinite(input.pressure) || input.pressure < 0 || input.pressure > 1)
    ) {
      return this.fail("invalid-style");
    }

    this.lastGuidance = null;
    const initialHit = this.resolveHit(input.hit, input.pressure);
    if (!initialHit.ok) return this.fail(initialHit.error.code);
    const resolved = initialHit.value;
    this.surfaceSessionSequence = Math.min(
      Number.MAX_SAFE_INTEGER,
      this.surfaceSessionSequence + 1,
    );
    const controller = resolved.target ? null : new AbortController();
    const state: SurfacePaintSessionState = {
      id: `surface-${this.surfaceSessionSequence}`,
      originMaterial: resolved.material,
      sourceTexture: resolved.sourceTexture,
      paintWrap: resolved.paintWrap,
      controller,
      target: resolved.target,
      token: null,
    };
    this.surfaceSession = state;
    const abortFromCaller = () => controller?.abort();
    input.signal?.addEventListener("abort", abortFromCaller, { once: true });
    this.publish();

    const failSession = <T>(
      code: StudioVrmTexturePaintRuntimeErrorCode,
    ): StudioVrmTexturePaintRuntimeResult<T> => {
      if (this.surfaceSession === state) this.surfaceSession = null;
      return this.fail(code);
    };

    try {
      if (!state.target) {
        if (!controller) return failSession("source-unreadable");
        const readable = await this.readSourceTexture(state.sourceTexture, controller);
        if (this.surfaceSession !== state || this.disposed) {
          return failure(this.disposed ? "disposed" : "stale-completion");
        }
        if (!readable.ok) return failSession(readable.error.code);
        try {
          if (state.originMaterial.map !== state.sourceTexture) {
            return failSession("source-changed");
          }
        } catch {
          return failSession("source-changed");
        }
        const target = this.createTarget(state.sourceTexture, readable.value);
        if (!target.ok) return failSession(target.error.code);
        state.target = target.value;
      } else {
        const rebound = this.bindUnownedSourceMaterials(state.target);
        if (!rebound.ok) return failSession(rebound.error.code);
      }
      if (
        input.signal?.aborted
        || controller?.signal.aborted
        || this.surfaceSession !== state
        || this.disposed
        || !state.target
      ) {
        return failSession(this.disposed ? "disposed" : "source-read-aborted");
      }

      // Re-resolve after target creation so cached geometry density can use
      // the exact runtime-owned atlas dimensions.
      const currentHit = this.resolveHit(input.hit, input.pressure);
      if (
        !currentHit.ok
        || currentHit.value.sourceTexture !== state.sourceTexture
        || currentHit.value.target !== state.target
      ) {
        return failSession(currentHit.ok ? "target-mismatch" : currentHit.error.code);
      }
      const projection = this.surfaceProjectionFromResolved(currentHit.value, input.hit);
      if (!projection.ok) return failSession(projection.error.code);
      const token = Object.freeze({
        id: state.id,
        targetId: state.target.id,
        width: state.target.size.width,
        height: state.target.size.height,
        wrapU: currentHit.value.wrapU,
        wrapV: currentHit.value.wrapV,
      });
      state.token = token;
      this.selectedTarget = state.target;
      this.lastError = null;
      this.lastGuidance = null;
      this.publish();
      return success(Object.freeze({ session: token, projection: projection.value }));
    } finally {
      input.signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  /** Resolve another Three.js ray hit against an existing runtime-owned lease. */
  resolveSurfaceBrushHit(
    session: StudioVrmTexturePaintSurfaceSession,
    hit: StudioVrmTexturePaintRayHit,
    pressure?: number,
  ): StudioVrmTexturePaintRuntimeResult<StudioVrmTexturePaintSurfaceProjection> {
    if (this.disposed) return this.fail("disposed");
    const state = this.surfaceSession;
    if (!state?.token || state.token !== session || !state.target) {
      return this.fail("surface-session-invalid");
    }
    if (
      pressure !== undefined
      && (!Number.isFinite(pressure) || pressure < 0 || pressure > 1)
    ) {
      return this.fail("invalid-style");
    }
    const resolved = this.resolveHit(hit, pressure);
    if (!resolved.ok) return this.fail(resolved.error.code);
    if (
      resolved.value.sourceTexture !== state.sourceTexture
      || resolved.value.target !== state.target
    ) {
      return this.fail("target-mismatch");
    }
    const projection = this.surfaceProjectionFromResolved(resolved.value, hit);
    return projection.ok ? projection : this.fail(projection.error.code);
  }

  /**
   * Apply an exact package-generated operation list atomically to the primary
   * Canvas/ImageData owner. The only GPU action is the existing dirty upload;
   * no interactive GPU-to-CPU readback is introduced.
   */
  commitSurfaceBrushSession(
    session: StudioVrmTexturePaintSurfaceSession,
    input: StudioVrmTexturePaintSurfaceCommitInput,
  ): StudioVrmTexturePaintRuntimeResult<StudioVrmTexturePaintSurfaceCommitReceipt> {
    if (this.disposed) return this.fail("disposed");
    const state = this.surfaceSession;
    if (!state?.token || state.token !== session || !state.target) {
      return this.fail("surface-session-invalid");
    }
    const target = state.target;
    if (
      input.signal?.aborted
      || !Array.isArray(input.operations)
      || input.operations.length === 0
      || input.operations.length > 200_000
      || input.operations.some((operation) => !isValidSurfacePaintOperation(operation))
    ) {
      this.surfaceSession = null;
      return this.fail(input.signal?.aborted ? "source-read-aborted" : "surface-operation-invalid");
    }

    const checkpoint = this.captureHistoryCheckpoint();
    const recorder = createStudioVrmTextureUndoRecorder(
      target.imageData.data,
      target.size,
      this.options.undoTileSize,
      this.options.maxHistoryBytes,
      (requiredPeakBytes) => this.admitHistoryPeak(requiredPeakBytes),
    );
    if (!recorder) {
      this.surfaceSession = null;
      return this.fail("invalid-dimensions");
    }

    const rollbackBeforeFinish = (
      code: StudioVrmTexturePaintRuntimeErrorCode,
    ): StudioVrmTexturePaintRuntimeResult<StudioVrmTexturePaintSurfaceCommitReceipt> => {
      const restored = recorder.cancel();
      this.restoreHistoryCheckpoint(checkpoint);
      this.surfaceSession = null;
      if (restored > 0 && !this.syncTarget(target)) {
        this.invalidateTarget(target);
        return this.fail("target-invalid");
      }
      return this.fail(code);
    };

    let changedTexels = 0;
    let dirtyRect = EMPTY_STUDIO_VRM_TEXTURE_RECT;
    for (const operation of input.operations) {
      if (input.signal?.aborted) return rollbackBeforeFinish("source-read-aborted");
      const rects = studioVrmTexturePaintOpRects(operation, target.size, state.paintWrap);
      if (!recorder.recordAll(rects)) return rollbackBeforeFinish("history-budget");
      for (const rect of rects) dirtyRect = unionStudioVrmTextureRect(dirtyRect, rect);
      changedTexels += applyStudioVrmTexturePaintOp(
        target.imageData.data,
        target.size,
        operation,
        { ...state.paintWrap, originalPixels: target.originalPixels },
      );
    }
    if (changedTexels === 0) return rollbackBeforeFinish("surface-operation-invalid");

    const entry = recorder.finish();
    if (recorder.budgetExceeded || !entry) {
      const restored = recorder.cancel();
      this.restoreHistoryCheckpoint(checkpoint);
      this.surfaceSession = null;
      if (restored === 0) {
        this.invalidateTarget(target);
        return this.fail("target-invalid");
      }
      return this.fail("history-budget");
    }
    const bytes = studioVrmTextureUndoEntryBytes(entry);
    if (!this.admitHistoryPeak(bytes)) {
      const restored = applyStudioVrmTextureUndoEntry(
        target.imageData.data,
        target.size,
        entry,
        "undo",
      );
      this.restoreHistoryCheckpoint(checkpoint);
      this.surfaceSession = null;
      if (!restored) {
        this.invalidateTarget(target);
        return this.fail("target-invalid");
      }
      return this.fail("history-budget");
    }
    if (!this.syncTarget(target, dirtyRect)) {
      const restored = applyStudioVrmTextureUndoEntry(
        target.imageData.data,
        target.size,
        entry,
        "undo",
      );
      this.restoreHistoryCheckpoint(checkpoint);
      this.surfaceSession = null;
      if (!restored || !this.syncTarget(target)) {
        this.invalidateTarget(target);
        return this.fail("target-invalid");
      }
      return this.fail("canvas-unavailable");
    }

    this.clearFutureHistory();
    this.historyPast.push({ kind: "stroke", target, entry, bytes });
    this.historyBytes += bytes;
    this.evictHistory();
    this.selectedTarget = target;
    this.surfaceSession = null;
    this.lastError = null;
    this.lastGuidance = null;
    this.publish();
    return success(Object.freeze({
      appliedOperations: input.operations.length,
      changedTexels,
      revision: this.contentRevision,
    }));
  }

  cancelSurfaceBrushSession(
    session: StudioVrmTexturePaintSurfaceSession,
  ): StudioVrmTexturePaintRuntimeResult<boolean> {
    if (this.disposed) return this.fail("disposed");
    const state = this.surfaceSession;
    if (!state) return success(false);
    if (!state.token || state.token !== session) return this.fail("surface-session-invalid");
    state.controller?.abort();
    this.surfaceSession = null;
    this.publish();
    return success(true);
  }

  async beginStroke(
    input: StudioVrmTexturePaintStrokeBegin,
  ): Promise<StudioVrmTexturePaintRuntimeResult<StudioVrmTexturePaintRuntimeSnapshot>> {
    if (this.disposed) return this.fail("disposed");
    if (!this.isPointerId(input.pointerId)) return this.fail("invalid-pointer");
    if (!isValidStrokeStyle(input.style)) return this.fail("invalid-style");
    if (this.sampling || this.filling || this.pending || this.active || this.surfaceSession) {
      return this.fail("pointer-active");
    }

    this.lastGuidance = null;
    const hitResult = this.resolveHit(input.hit, input.pressure);
    if (!hitResult.ok) return this.fail(hitResult.error.code);
    const resolved = hitResult.value;
    const request: PendingStroke = {
      pointerId: input.pointerId,
      originMaterial: resolved.material,
      sourceTexture: resolved.sourceTexture,
      style: copyStrokeStyle(input.style),
      planOptions: Object.freeze({ ...input.planOptions }),
      samples: [{ ...resolved.sample }],
      wrapU: resolved.wrapU,
      wrapV: resolved.wrapV,
      paintWrap: resolved.paintWrap,
      readController: resolved.target ? null : new AbortController(),
      target: resolved.target,
      terminal: null,
    };
    this.pending = request;
    this.publish();

    if (!request.target) {
      const readController = request.readController;
      if (!readController) {
        this.pending = null;
        return this.fail("source-unreadable");
      }
      const readableResult = await this.readSourceTexture(
        request.sourceTexture,
        readController,
      );
      if (this.pending !== request || this.disposed) return failure("stale-completion");
      if (!readableResult.ok) {
        this.pending = null;
        return this.fail(readableResult.error.code);
      }
      try {
        if (request.originMaterial.map !== request.sourceTexture) {
          this.pending = null;
          return this.fail("source-changed");
        }
      } catch {
        this.pending = null;
        return this.fail("source-changed");
      }
      const targetResult = this.createTarget(request.sourceTexture, readableResult.value);
      if (!targetResult.ok) {
        this.pending = null;
        return this.fail(targetResult.error.code);
      }
      request.target = targetResult.value;
    } else {
      const rebound = this.bindUnownedSourceMaterials(request.target);
      if (!rebound.ok) {
        this.pending = null;
        return this.fail(rebound.error.code);
      }
    }

    if (this.pending !== request || this.disposed || !request.target) {
      return failure("stale-completion");
    }
    const recorder = createStudioVrmTextureUndoRecorder(
      request.target.imageData.data,
      request.target.size,
      this.options.undoTileSize,
      this.options.maxHistoryBytes,
      (requiredPeakBytes) => this.admitHistoryPeak(requiredPeakBytes),
    );
    if (!recorder) {
      this.pending = null;
      return this.fail("invalid-dimensions");
    }

    const stroke: ActiveStroke = {
      pointerId: request.pointerId,
      target: request.target,
      paintWrap: request.paintWrap,
      recorder,
      walker: createStudioVrmTextureStrokeWalker(
        request.style,
        request.target.size,
        {
          ...request.planOptions,
          wrapU: request.wrapU,
          wrapV: request.wrapV,
          flipV: false,
        },
      ),
      lastSample: null,
      sampleCount: 0,
      changedTexels: 0,
    };
    const terminal = request.terminal;
    this.pending = null;
    this.active = stroke;
    this.selectedTarget = stroke.target;
    for (const sample of request.samples) {
      stroke.lastSample = { ...sample };
      stroke.sampleCount += 1;
      const applyResult = this.applyIncrementalSample(stroke, sample);
      if (!applyResult.ok) return applyResult;
    }
    if (terminal === "commit") {
      const commitResult = this.finishActiveStroke(stroke);
      if (!commitResult.ok) return failure(commitResult.error.code);
    } else {
      this.publish();
    }
    return success(this.snapshot);
  }

  moveStroke(
    input: StudioVrmTexturePaintStrokeMove,
  ): StudioVrmTexturePaintRuntimeResult<boolean> {
    if (this.disposed) return this.fail("disposed");
    if (!this.isPointerId(input.pointerId)) return this.fail("invalid-pointer");
    if (this.surfaceSession) return this.fail("pointer-active");

    if (this.pending) {
      if (this.pending.pointerId !== input.pointerId) return this.fail("pointer-mismatch");
      if (this.pending.terminal) return success(false);
      const hitResult = this.resolveHit(input.hit, input.pressure);
      if (!hitResult.ok) return this.fail(hitResult.error.code);
      if (hitResult.value.sourceTexture !== this.pending.sourceTexture) {
        return this.fail("target-mismatch");
      }
      const appended = this.appendStrokeSample(this.pending.samples, hitResult.value.sample);
      if (appended === "coalesced") return success(false);
      if (appended === "budget") return this.fail("stroke-sample-budget");
      return success(true);
    }

    if (!this.active) return success(false);
    if (this.active.pointerId !== input.pointerId) return this.fail("pointer-mismatch");
    const hitResult = this.resolveHit(input.hit, input.pressure);
    if (!hitResult.ok) return this.fail(hitResult.error.code);
    if (hitResult.value.sourceTexture !== this.active.target.originalTexture) {
      return this.fail("target-mismatch");
    }
    const appended = this.appendActiveStrokeSample(this.active, hitResult.value.sample);
    if (appended === "coalesced") return success(false);
    if (appended === "budget") return this.fail("stroke-sample-budget");
    const result = this.applyIncrementalSample(this.active, hitResult.value.sample);
    return result.ok ? success(true) : failure(result.error.code);
  }

  commitStroke(pointerId: number): StudioVrmTexturePaintRuntimeResult<boolean> {
    if (this.disposed) return this.fail("disposed");
    if (!this.isPointerId(pointerId)) return this.fail("invalid-pointer");
    if (this.surfaceSession) return this.fail("pointer-active");
    if (this.pending) {
      if (this.pending.pointerId !== pointerId) return this.fail("pointer-mismatch");
      if (this.pending.terminal) return success(false);
      this.pending.terminal = "commit";
      return success(true);
    }
    if (!this.active) return success(false);
    if (this.active.pointerId !== pointerId) return this.fail("pointer-mismatch");
    return this.finishActiveStroke(this.active);
  }

  cancelStroke(pointerId: number): StudioVrmTexturePaintRuntimeResult<boolean> {
    if (this.disposed) return this.fail("disposed");
    if (!this.isPointerId(pointerId)) return this.fail("invalid-pointer");
    if (this.surfaceSession) return this.fail("pointer-active");
    if (this.pending) {
      if (this.pending.pointerId !== pointerId) return this.fail("pointer-mismatch");
      this.pending.readController?.abort();
      this.pending = null;
      this.publish();
      return success(true);
    }
    if (!this.active) return success(false);
    if (this.active.pointerId !== pointerId) return this.fail("pointer-mismatch");
    const stroke = this.active;
    this.active = null;
    const restored = stroke.recorder.cancel();
    if (restored > 0 && !this.syncTarget(stroke.target)) {
      this.invalidateTarget(stroke.target);
      return this.fail("target-invalid");
    }
    this.publish();
    return success(true);
  }

  undo(): StudioVrmTexturePaintRuntimeResult<boolean> {
    if (this.disposed) return this.fail("disposed");
    if (this.sampling || this.filling || this.pending || this.active || this.surfaceSession) {
      return this.fail("pointer-active");
    }
    const record = this.historyPast.at(-1);
    if (!record) return success(false);
    if (!record.target.valid) return this.fail("target-invalid");
    if (!this.applyHistoryRecord(record, "undo")) {
      return this.fail("invalid-dimensions");
    }
    const dirtyRect = this.historyRecordDirtyRect(record);
    if (!this.syncTarget(record.target, dirtyRect)) {
      const rolledBack =
        this.applyHistoryRecord(record, "redo")
        && this.syncTarget(record.target, dirtyRect);
      if (!rolledBack) {
        this.invalidateTarget(record.target);
        return this.fail("target-invalid");
      }
      return this.fail("canvas-unavailable");
    }
    this.historyPast.pop();
    this.historyFuture.push(record);
    this.selectedTarget = record.target;
    this.publish();
    return success(true);
  }

  redo(): StudioVrmTexturePaintRuntimeResult<boolean> {
    if (this.disposed) return this.fail("disposed");
    if (this.sampling || this.filling || this.pending || this.active || this.surfaceSession) {
      return this.fail("pointer-active");
    }
    const record = this.historyFuture.at(-1);
    if (!record) return success(false);
    if (!record.target.valid) return this.fail("target-invalid");
    if (!this.applyHistoryRecord(record, "redo")) {
      return this.fail("invalid-dimensions");
    }
    const dirtyRect = this.historyRecordDirtyRect(record);
    if (!this.syncTarget(record.target, dirtyRect)) {
      const rolledBack =
        this.applyHistoryRecord(record, "undo")
        && this.syncTarget(record.target, dirtyRect);
      if (!rolledBack) {
        this.invalidateTarget(record.target);
        return this.fail("target-invalid");
      }
      return this.fail("canvas-unavailable");
    }
    this.historyFuture.pop();
    this.historyPast.push(record);
    this.selectedTarget = record.target;
    this.publish();
    return success(true);
  }

  resetActiveTarget(): StudioVrmTexturePaintRuntimeResult<boolean> {
    if (this.disposed) return this.fail("disposed");
    if (this.sampling || this.filling || this.pending || this.active || this.surfaceSession) {
      return this.fail("pointer-active");
    }
    const target = this.selectedTarget;
    if (!target) return success(false);
    if (!target.valid) return this.fail("target-invalid");
    target.imageData.data.set(target.originalPixels);
    if (!this.syncTarget(target)) {
      this.invalidateTarget(target);
      return this.fail("target-invalid");
    }
    this.removeTargetHistory(target);
    this.publish();
    return success(true);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.geometryPrewarmController.abort();
    this.sampling?.controller.abort();
    this.filling?.controller.abort();
    this.surfaceSession?.controller?.abort();
    for (const controller of this.inFlightReadControllers) controller.abort();
    this.sampling = null;
    this.filling = null;
    this.pending = null;
    this.surfaceSession = null;
    if (this.active) {
      this.active.recorder.cancel();
      this.active = null;
    }

    for (const target of this.targets) {
      for (const binding of target.bindings.values()) {
        try {
          if (binding.material.map === target.paintedTexture) {
            binding.material.map = binding.originalMap;
            markMaterialChanged(binding.material);
          }
        } catch {
          // Do not let one custom material prevent the remaining owned bindings from restoring.
        }
      }
      try {
        target.paintedTexture.dispose();
      } catch {
        // Continue releasing the canvas and the remaining targets.
      }
      disposeCanvas(target.canvas);
      target.bindings.clear();
    }

    this.targetsByOriginal.clear();
    this.targetsByPainted.clear();
    this.targets.length = 0;
    this.historyPast = [];
    this.historyFuture = [];
    this.historyBytes = 0;
    this.aggregateRgbaBytes = 0;
    this.aggregateTargetResidentBytes = 0;
    this.selectedTarget = null;
    this.lastError = null;
    this.lastGuidance = null;
    this.publish();
    this.listeners.clear();
  }

  private isPointerId(value: number): boolean {
    return Number.isSafeInteger(value) && value >= 0;
  }

  private async prewarmSceneGeometry(): Promise<void> {
    // Construction stays deterministic and cheap; geometry snapshotting starts after the runtime
    // is returned. Jobs are deliberately sequential to cap transferable copies and Worker memory.
    await Promise.resolve();
    const signal = this.geometryPrewarmController.signal;
    if (this.disposed || signal.aborted) return;
    let jobs: readonly GeometryPrewarmJob[];
    try {
      jobs = collectGeometryPrewarmJobs(
        this.scene,
        this.options.maxGeometryIndexTriangles,
      );
    } catch {
      return;
    }
    for (const job of jobs) {
      if (this.disposed || signal.aborted) return;
      try {
        await this.options.precomputeGeometryIndex(job.geometry, {
          uvAttribute: job.uvAttribute,
          maxTriangles: this.options.maxGeometryIndexTriangles,
          signal,
          executionBackend: "worker",
        });
      } catch {
        // Worker availability, abort, timeout, stale geometry, and malformed custom geometry all
        // fail closed. Pointer input keeps face-local identity without rebuilding topology.
      }
    }
  }

  private admitTextureFillTransient(
    size: StudioVrmTextureSize,
    includeUnpreparedTarget: boolean,
  ): boolean {
    const pixelCount = size.width * size.height;
    const rgbaBytes = pixelCount * RGBA_CHANNELS;
    if (
      !Number.isSafeInteger(pixelCount)
      || !Number.isSafeInteger(rgbaBytes)
      || pixelCount <= 0
      || rgbaBytes <= 0
    ) {
      return false;
    }
    // Transient peak: transferred RGBA input + worker Uint32 queue + returned 1-bit mask.
    const transientBytes = saturatedByteSum(
      rgbaBytes,
      rgbaBytes,
      Math.ceil(pixelCount / 8),
    );
    const unpreparedTargetBytes = includeUnpreparedTarget
      ? estimateStudioVrmTexturePaintTargetResidentBytes(size)
      : 0;
    if (
      transientBytes === Number.MAX_SAFE_INTEGER
      || unpreparedTargetBytes === null
    ) {
      return false;
    }
    return saturatedByteSum(
      this.aggregateTargetResidentBytes,
      this.historyBytes,
      unpreparedTargetBytes,
      transientBytes,
    ) <= this.options.maxAggregateResidentBytes;
  }

  private applyInitialTextureFill(
    target: PaintTarget,
    selection: PreparedFillSelection,
    color: Readonly<{ r: number; g: number; b: number }>,
    bytes: number,
  ): StudioVrmTexturePaintRuntimeResult<FillHistoryRecord> {
    if (
      !target.valid
      || !isValidTextureFillRect(selection.rect, target.size)
      || selection.bitMask.byteLength !== Math.ceil(
        (selection.rect.width * selection.rect.height) / 8,
      )
      || !Number.isSafeInteger(selection.changedCount)
      || selection.changedCount <= 0
    ) {
      return failure("fill-worker-failed");
    }
    let beforeRgb: Uint8Array;
    try {
      beforeRgb = new Uint8Array(selection.changedCount * 3);
    } catch {
      return failure("fill-memory-budget");
    }
    const record: FillHistoryRecord = {
      kind: "fill",
      target,
      bitMask: selection.bitMask,
      beforeRgb,
      fillRgb: Object.freeze({ r: color.r, g: color.g, b: color.b }),
      rect: selection.rect,
      bytes,
    };

    // Snapshot and validate every addressed pixel before the first mutation. A malformed mask can
    // therefore never leave a partially recolored texture behind.
    let beforeOffset = 0;
    const right = selection.rect.x + selection.rect.width;
    const bottom = selection.rect.y + selection.rect.height;
    for (let y = selection.rect.y; y < bottom; y += 1) {
      for (let x = selection.rect.x; x < right; x += 1) {
        const localPosition =
          (y - selection.rect.y) * selection.rect.width + x - selection.rect.x;
        if (!textureFillBitIsSet(selection.bitMask, localPosition)) continue;
        const pixelOffset = (y * target.size.width + x) * RGBA_CHANNELS;
        const r = target.imageData.data[pixelOffset];
        const g = target.imageData.data[pixelOffset + 1];
        const b = target.imageData.data[pixelOffset + 2];
        if (r === undefined || g === undefined || b === undefined) {
          return failure("invalid-dimensions");
        }
        beforeRgb[beforeOffset] = r;
        beforeRgb[beforeOffset + 1] = g;
        beforeRgb[beforeOffset + 2] = b;
        beforeOffset += 3;
      }
    }
    if (beforeOffset !== beforeRgb.byteLength) return failure("fill-worker-failed");
    if (!applyTextureFillHistoryPixels(record, "redo")) {
      const rolledBack = applyTextureFillHistoryPixels(record, "undo");
      if (!rolledBack) {
        this.invalidateTarget(target);
        return failure("target-invalid");
      }
      return failure("fill-worker-failed");
    }
    if (this.syncTarget(target, selection.rect)) return success(record);
    const rolledBack =
      applyTextureFillHistoryPixels(record, "undo")
      && this.syncTarget(target, selection.rect);
    if (!rolledBack) {
      this.invalidateTarget(target);
      return failure("target-invalid");
    }
    return failure("canvas-unavailable");
  }

  private applyHistoryRecord(
    record: HistoryRecord,
    direction: "redo" | "undo",
  ): boolean {
    if (record.kind === "stroke") {
      return applyStudioVrmTextureUndoEntry(
        record.target.imageData.data,
        record.target.size,
        record.entry,
        direction,
      );
    }
    return applyTextureFillHistoryPixels(record, direction);
  }

  private historyRecordDirtyRect(record: HistoryRecord): StudioVrmTextureRect {
    return record.kind === "stroke" ? record.entry.rect : record.rect;
  }

  private appendStrokeSample(
    samples: StudioVrmTextureStrokeSample[],
    sample: StudioVrmTextureStrokeSample,
  ): "appended" | "budget" | "coalesced" {
    if (canCoalesceStrokeSample(samples.at(-1), sample)) return "coalesced";
    if (samples.length >= this.options.maxStrokeSamples) return "budget";
    samples.push({ ...sample });
    return "appended";
  }

  private appendActiveStrokeSample(
    stroke: ActiveStroke,
    sample: StudioVrmTextureStrokeSample,
  ): "appended" | "budget" | "coalesced" {
    if (canCoalesceStrokeSample(stroke.lastSample ?? undefined, sample)) return "coalesced";
    if (stroke.sampleCount >= this.options.maxStrokeSamples) return "budget";
    stroke.lastSample = { ...sample };
    stroke.sampleCount += 1;
    return "appended";
  }

  private resolveBaseColorHit(
    hit: StudioVrmTexturePaintRayHit,
    captureSamplingSignature = false,
  ): StudioVrmTexturePaintRuntimeResult<ResolvedBaseColorHit> {
    const object = hit.object as THREE.Object3D & { readonly isMesh?: unknown };
    if (object?.isMesh !== true) return failure("mesh-missing");
    if (!objectBelongsToScene(object, this.scene)) return failure("hit-outside-scene");
    const material = materialAtHit(object as THREE.Mesh, hit);
    if (!material) return failure("material-missing");

    let map: THREE.Texture | null;
    try {
      map = material.map;
    } catch {
      return failure("material-missing");
    }
    if (!map?.isTexture) return failure("map-missing");
    const target = this.targetsByPainted.get(map) ?? this.targetsByOriginal.get(map) ?? null;
    if (target && !target.valid) return failure("target-invalid");
    const sourceTexture = target?.originalTexture ?? map;
    const effectiveTexture = target?.paintedTexture ?? map;
    let textureChannel: number;
    try {
      textureChannel = effectiveTexture.channel;
    } catch {
      return failure("source-unreadable");
    }
    if (textureChannel !== 0 && textureChannel !== 1) {
      return failure("uv-missing");
    }
    const uv = finiteUv(textureChannel === 1 ? hit.uv1 : hit.uv);
    if (!uv) return failure("uv-missing");
    try {
      if (effectiveTexture.matrixAutoUpdate) effectiveTexture.updateMatrix();
      uv.applyMatrix3(effectiveTexture.matrix);
    } catch {
      return failure("uv-missing");
    }
    if (!Number.isFinite(uv.x) || !Number.isFinite(uv.y)) return failure("uv-missing");
    let samplingSignature: TextureSamplingSignature | null = null;
    let wrapS: THREE.Wrapping;
    let wrapT: THREE.Wrapping;
    try {
      if (captureSamplingSignature) {
        samplingSignature = textureSamplingSignature(effectiveTexture);
        wrapS = samplingSignature.wrapS;
        wrapT = samplingSignature.wrapT;
      } else {
        // A matrix-array signature is necessary only across an async sample read. Avoid allocating
        // it for every high-frequency brush pointermove.
        wrapS = effectiveTexture.wrapS;
        wrapT = effectiveTexture.wrapT;
      }
    } catch {
      return failure("source-unreadable");
    }
    return success({
      material,
      sourceTexture,
      effectiveTexture,
      target,
      uv: Object.freeze({ u: uv.x, v: uv.y }),
      wrapU: textureWrapMode(wrapS),
      wrapV: textureWrapMode(wrapT),
      samplingSignature,
    });
  }

  private resolveHit(
    hit: StudioVrmTexturePaintRayHit,
    pressure: number | undefined,
  ): StudioVrmTexturePaintRuntimeResult<ResolvedPaintHit> {
    const baseResult = this.resolveBaseColorHit(hit);
    if (!baseResult.ok) return baseResult;
    const base = baseResult.value;
    const object = hit.object as THREE.Mesh;
    const {
      effectiveTexture,
      material,
      sourceTexture,
      target,
      uv,
    } = base;
    const uvAttribute = effectiveTexture.channel === 1 ? "uv1" : "uv";

    const world = finiteWorld(hit.point);
    const faceIndexProvided = hit.faceIndex !== undefined && hit.faceIndex !== null;
    if (faceIndexProvided && !isUsableFaceIndex(hit.faceIndex)) {
      return failure("uv-missing");
    }
    let islandId = `${object.uuid}:${material.uuid}`;
    let texelsPerWorldUnit: number | undefined;
    if (isUsableFaceIndex(hit.faceIndex)) {
      const faceIndex = hit.faceIndex;
      let geometryIndex: StudioVrmTextureGeometryIndex | null = null;
      try {
        const geometry = (object as THREE.Mesh).geometry;
        const indexOptions = {
          uvAttribute,
          maxTriangles: this.options.maxGeometryIndexTriangles,
        } as const;
        const admission = inspectStudioVrmTextureGeometryAdmission(
          geometry,
          indexOptions,
        );
        if (admission && !admission.admitted) {
          this.lastGuidance = frozenGeometryBudgetGuidance(
            admission.triangleCount,
            admission.maxTriangles,
          );
        } else if (admission?.admitted) {
          geometryIndex = getCachedStudioVrmTextureGeometryIndex(
            geometry,
            indexOptions,
          );
        }
      } catch {
        // 손상된 custom geometry는 아래 face-specific identity로 격리한다.
      }
      const island = geometryIndex?.getIsland(faceIndex) ?? null;
      islandId = island
        ? `${object.uuid}:${material.uuid}:${island.key}`
        : `${object.uuid}:${material.uuid}:${uvAttribute}:face:${faceIndex}`;

      // 첫 beginStroke는 비동기 read보다 먼저 오므로 island는 크기와 무관하게 위에서 고정한다.
      // 밀도만 이미 준비된 target 또는 안전하게 읽힌 원본 이미지 크기가 있을 때 보강한다.
      const textureSize = target?.size ?? textureImageDimensions(sourceTexture);
      if (geometryIndex && textureSize) {
        try {
          object.updateWorldMatrix(true, false);
          const classification = geometryIndex.resolvePaintClassification(
            faceIndex,
            textureSize,
            {
              matrixWorld: object.matrixWorld,
              uvAreaScale: Math.abs(effectiveTexture.matrix.determinant()),
            },
          );
          if (classification) {
            islandId = `${object.uuid}:${material.uuid}:${classification.island.key}`;
            if (classification.texelsPerWorldUnit !== null) {
              texelsPerWorldUnit = classification.texelsPerWorldUnit;
            }
          }
        } catch {
          // island/face-local ID는 유지하고 밀도 보강만 생략한다.
        }
      }
    }
    return success({
      ...base,
      sample: {
        uv,
        ...(pressure === undefined ? {} : { pressure }),
        islandId,
        ...(world ? { world } : {}),
        ...(texelsPerWorldUnit === undefined ? {} : { texelsPerWorldUnit }),
      },
      paintWrap: paintWrapOptions(effectiveTexture),
    });
  }

  private surfaceProjectionFromResolved(
    resolved: ResolvedPaintHit,
    hit: StudioVrmTexturePaintRayHit,
  ): StudioVrmTexturePaintRuntimeResult<StudioVrmTexturePaintSurfaceProjection> {
    const target = resolved.target;
    if (!target) return failure("target-invalid");
    const point = resolveStudioVrmTexelPoint(resolved.sample.uv, target.size, {
      wrapU: resolved.wrapU,
      wrapV: resolved.wrapV,
      flipV: false,
    });
    if (!point) return failure("uv-missing");
    const u = point.x / target.size.width;
    const v = point.y / target.size.height;
    if (!Number.isFinite(u) || !Number.isFinite(v)) return failure("uv-missing");
    const faceIndex = isUsableFaceIndex(hit.faceIndex) ? hit.faceIndex : undefined;
    const object = hit.object as THREE.Mesh;
    const triangleId = faceIndex === undefined
      ? undefined
      : `${object.uuid}:${object.geometry.uuid}:face:${faceIndex}`;
    const islandId = canonicalizeStudioVrmSurfaceIslandId(
      resolved.sample.islandId,
    ) ?? `runtime:${object.uuid}:${resolved.material.uuid}`;
    return success(Object.freeze({
      u,
      v,
      uvWasWrapped:
        Math.abs(u - resolved.sample.uv.u) > Number.EPSILON
        || Math.abs(v - resolved.sample.uv.v) > Number.EPSILON,
      ...(resolved.sample.pressure === undefined
        ? {}
        : { sourcePressure: resolved.sample.pressure }),
      ...(triangleId === undefined ? {} : { triangleId }),
      islandId,
      ...(resolved.sample.world ? { world: Object.freeze({ ...resolved.sample.world }) } : {}),
      ...(resolved.sample.texelsPerWorldUnit === undefined
        ? {}
        : { texelsPerWorldUnit: resolved.sample.texelsPerWorldUnit }),
    }));
  }

  private async readSourceTexture(
    texture: THREE.Texture,
    controller: AbortController,
  ): Promise<StudioVrmTexturePaintRuntimeResult<StudioVrmTexturePaintReadableImage>> {
    if (isCompressedTexture(texture)) return failure("source-compressed");
    if (controller.signal.aborted) return failure("source-read-aborted");
    const knownSize = textureImageDimensions(texture);
    if (knownSize) {
      const admissionError = this.targetAdmissionError(knownSize);
      if (admissionError) return failure(admissionError);
    }
    if ((this.inFlightReadsBySource.get(texture) ?? 0) >= 1) {
      return failure("source-read-active");
    }
    if (this.inFlightReadCount >= this.options.maxConcurrentReads) {
      return failure("read-concurrency-budget");
    }
    this.inFlightReadCount += 1;
    this.inFlightReadsBySource.set(texture, 1);
    this.inFlightReadControllers.add(controller);
    try {
      const readable = await this.options.readTextureImage(texture, controller.signal);
      if (controller.signal.aborted) return failure("source-read-aborted");
      const size = { width: readable?.width, height: readable?.height };
      if (!isStudioVrmTextureSize(size)) return failure("invalid-dimensions");
      if (!(readable.data instanceof Uint8ClampedArray)) return failure("invalid-dimensions");
      const rgbaBytes = size.width * size.height * RGBA_CHANNELS;
      if (readable.data.byteLength !== rgbaBytes) return failure("invalid-dimensions");
      const admissionError = this.targetAdmissionError(size);
      if (admissionError) return failure(admissionError);
      if (controller.signal.aborted) return failure("source-read-aborted");
      if (texture.flipY) flipRgbaRowsInPlace(readable.data, size);
      return success({ ...size, data: readable.data });
    } catch (error) {
      if (controller.signal.aborted) return failure("source-read-aborted");
      if (error instanceof StudioVrmTexturePaintFault) return failure(error.code);
      return failure("source-unreadable");
    } finally {
      this.inFlightReadControllers.delete(controller);
      this.inFlightReadCount = Math.max(0, this.inFlightReadCount - 1);
      this.inFlightReadsBySource.delete(texture);
    }
  }

  private targetAdmissionError(
    size: StudioVrmTextureSize,
  ): "aggregate-rgba-budget" | "target-rgba-budget" | null {
    const residentBytes = estimateStudioVrmTexturePaintTargetResidentBytes(size);
    if (residentBytes === null || residentBytes > this.options.maxTargetResidentBytes) {
      return "target-rgba-budget";
    }
    const admittedTotal = saturatedByteSum(
      this.aggregateTargetResidentBytes,
      residentBytes,
      this.options.maxHistoryBytes,
    );
    return admittedTotal > this.options.maxAggregateResidentBytes
      ? "aggregate-rgba-budget"
      : null;
  }

  private createTarget(
    source: THREE.Texture,
    readable: StudioVrmTexturePaintReadableImage,
  ): StudioVrmTexturePaintRuntimeResult<PaintTarget> {
    const existing = this.targetsByOriginal.get(source);
    if (existing) return success(existing);
    const rgbaBytes = readable.width * readable.height * RGBA_CHANNELS;
    const size = { width: readable.width, height: readable.height };
    if (!isStudioVrmTextureSize(size)) return failure("invalid-dimensions");
    const residentBytes = estimateStudioVrmTexturePaintTargetResidentBytes(size);
    if (residentBytes === null) return failure("invalid-dimensions");
    const admissionError = this.targetAdmissionError(size);
    if (admissionError) return failure(admissionError);

    let canvas: HTMLCanvasElement | null = null;
    let context: CanvasRenderingContext2D;
    let imageData: ImageData;
    try {
      canvas = this.options.createCanvas(readable.width, readable.height);
      canvas.width = readable.width;
      canvas.height = readable.height;
      const candidate = canvas.getContext("2d", { willReadFrequently: true });
      if (!candidate) {
        disposeCanvas(canvas);
        return failure("canvas-unavailable");
      }
      context = candidate;
      imageData = context.createImageData(readable.width, readable.height);
      if (imageData.data.byteLength !== rgbaBytes) {
        disposeCanvas(canvas);
        return failure("invalid-dimensions");
      }
      imageData.data.set(readable.data);
      context.putImageData(imageData, 0, 0);
    } catch {
      if (canvas) disposeCanvas(canvas);
      return failure("canvas-unavailable");
    }
    if (!canvas) return failure("canvas-unavailable");

    const paintedTexture = new THREE.CanvasTexture(canvas);
    try {
      copyTextureSampling(source, paintedTexture);
    } catch {
      paintedTexture.dispose();
      disposeCanvas(canvas);
      return failure("source-unreadable");
    }
    const target: PaintTarget = {
      id: sourceTargetId(source),
      originalTexture: source,
      paintedTexture,
      canvas,
      context,
      imageData,
      originalPixels: readable.data,
      size: Object.freeze(size),
      rgbaBytes,
      residentBytes,
      bindings: new Map(),
      valid: true,
      invalidReason: null,
    };
    const bindingResult = this.bindUnownedSourceMaterials(target);
    if (!bindingResult.ok || target.bindings.size === 0) {
      paintedTexture.dispose();
      disposeCanvas(canvas);
      return failure(bindingResult.ok ? "source-changed" : bindingResult.error.code);
    }

    this.targetsByOriginal.set(source, target);
    this.targetsByPainted.set(paintedTexture, target);
    this.targets.push(target);
    this.aggregateRgbaBytes += rgbaBytes;
    this.aggregateTargetResidentBytes += residentBytes;
    return success(target);
  }

  private bindUnownedSourceMaterials(
    target: PaintTarget,
  ): StudioVrmTexturePaintRuntimeResult<boolean> {
    if (!target.valid) return failure("target-invalid");
    const candidates = new Map<
      BaseColorMaterial,
      StudioVrmTexturePaintBindingDescriptor
    >();
    for (const [material, descriptor] of collectSceneMaterialBindings(this.scene)) {
      if (target.bindings.has(material)) continue;
      try {
        if (material.map === target.originalTexture) candidates.set(material, descriptor);
      } catch {
        // A throwing custom material is not a safe binding candidate.
      }
    }

    const changed: MaterialBinding[] = [];
    try {
      for (const [material, descriptor] of candidates) {
        const binding = {
          material,
          originalMap: material.map,
          descriptor,
        } satisfies MaterialBinding;
        // Register rollback ownership before invoking a potentially hostile custom setter. A
        // setter may store the new map and then throw; recording afterwards would strand a
        // disposed CanvasTexture on the material.
        changed.push(binding);
        material.map = target.paintedTexture;
        markMaterialChanged(material);
        target.bindings.set(material, binding);
      }
      return success(changed.length > 0);
    } catch {
      for (const binding of changed) {
        try {
          if (binding.material.map === target.paintedTexture) {
            binding.material.map = binding.originalMap;
            markMaterialChanged(binding.material);
          }
        } catch {
          // Preserve the original binding failure.
        }
        target.bindings.delete(binding.material);
      }
      return failure("source-changed");
    }
  }

  private applyIncrementalSample(
    stroke: ActiveStroke,
    sample: StudioVrmTextureStrokeSample,
  ): StudioVrmTexturePaintRuntimeResult<boolean> {
    const append = stroke.walker.append(sample);
    let changed = 0;
    let dirtyRect = EMPTY_STUDIO_VRM_TEXTURE_RECT;
    for (const op of append.ops) {
      const opRects = studioVrmTexturePaintOpRects(
        op,
        stroke.target.size,
        stroke.paintWrap,
      );
      if (!stroke.recorder.recordAll(opRects)) {
        const rolledBack = this.rollbackActiveStroke(stroke);
        return this.fail(rolledBack ? "history-budget" : "target-invalid");
      }
      for (const rect of opRects) {
        dirtyRect = unionStudioVrmTextureRect(dirtyRect, rect);
      }
      changed += applyStudioVrmTexturePaintOp(
        stroke.target.imageData.data,
        stroke.target.size,
        op,
        {
          ...stroke.paintWrap,
          originalPixels: stroke.target.originalPixels,
        },
      );
    }
    stroke.changedTexels += changed;
    if (changed > 0 && !this.syncTarget(stroke.target, dirtyRect)) {
      const rolledBack = this.rollbackActiveStroke(stroke);
      return this.fail(rolledBack ? "canvas-unavailable" : "target-invalid");
    }
    return success(changed > 0);
  }

  private rollbackActiveStroke(stroke: ActiveStroke): boolean {
    if (this.active === stroke) this.active = null;
    const restored = stroke.recorder.cancel();
    if (restored > 0 && !this.syncTarget(stroke.target)) {
      this.invalidateTarget(stroke.target);
      return false;
    }
    return true;
  }

  private finishActiveStroke(
    stroke: ActiveStroke,
  ): StudioVrmTexturePaintRuntimeResult<boolean> {
    if (this.active !== stroke) return success(false);
    const entry = stroke.recorder.finish();
    if (stroke.recorder.budgetExceeded) {
      const rolledBack = this.rollbackActiveStroke(stroke);
      return this.fail(rolledBack ? "history-budget" : "target-invalid");
    }
    this.active = null;
    if (!entry || stroke.changedTexels === 0) {
      this.publish();
      return success(true);
    }
    const bytes = studioVrmTextureUndoEntryBytes(entry);
    if (!this.admitHistoryPeak(bytes)) {
      const restored = applyStudioVrmTextureUndoEntry(
        stroke.target.imageData.data,
        stroke.target.size,
        entry,
        "undo",
      );
      if (!restored || !this.syncTarget(stroke.target)) {
        this.invalidateTarget(stroke.target);
        return this.fail("target-invalid");
      }
      return this.fail("history-budget");
    }

    this.clearFutureHistory();
    const record: StrokeHistoryRecord = {
      kind: "stroke",
      target: stroke.target,
      entry,
      bytes,
    };
    this.historyPast.push(record);
    this.historyBytes += bytes;
    this.evictHistory();
    this.publish();
    return success(true);
  }

  private clearFutureHistory(): void {
    for (const record of this.historyFuture) this.historyBytes -= record.bytes;
    this.historyFuture = [];
  }

  private captureHistoryCheckpoint(): HistoryCheckpoint {
    return {
      past: this.historyPast.slice(),
      future: this.historyFuture.slice(),
    };
  }

  private restoreHistoryCheckpoint(checkpoint: HistoryCheckpoint): void {
    // A failed canvas upload can invalidate one target. Restore every still-valid record while
    // deliberately omitting records that can no longer be replayed safely.
    this.historyPast = checkpoint.past.filter((record) => record.target.valid);
    this.historyFuture = checkpoint.future.filter((record) => record.target.valid);
    this.historyBytes = 0;
    for (const record of this.historyPast) this.historyBytes += record.bytes;
    for (const record of this.historyFuture) this.historyBytes += record.bytes;
  }

  private admitHistoryPeak(requiredPeakBytes: number): boolean {
    if (
      !Number.isSafeInteger(requiredPeakBytes)
      || requiredPeakBytes < 0
      || requiredPeakBytes > this.options.maxHistoryBytes
    ) {
      return false;
    }
    const retainedHistoryLimit = this.options.maxHistoryBytes - requiredPeakBytes;
    while (this.historyBytes > retainedHistoryLimit) {
      // 새 획이 완료되면 redo branch는 어차피 무효화된다. 가장 가까운 redo를 최대한
      // 보존하도록 먼 redo부터, 그 다음 가장 오래된 undo부터 필요한 만큼만 제거한다.
      const record = this.historyFuture.shift() ?? this.historyPast.shift();
      if (!record) break;
      this.historyBytes -= record.bytes;
    }
    this.historyBytes = Math.max(0, this.historyBytes);
    return this.historyBytes <= retainedHistoryLimit;
  }

  private evictHistory(): void {
    while (this.historyPast.length + this.historyFuture.length > this.options.maxHistoryEntries) {
      const evicted = this.historyPast.shift() ?? this.historyFuture.shift();
      if (!evicted) break;
      this.historyBytes -= evicted.bytes;
    }
    while (this.historyBytes > this.options.maxHistoryBytes) {
      const evicted = this.historyPast.shift() ?? this.historyFuture.shift();
      if (!evicted) break;
      this.historyBytes -= evicted.bytes;
    }
    this.historyBytes = Math.max(0, this.historyBytes);
  }

  private removeTargetHistory(target: PaintTarget): void {
    this.historyPast = this.historyPast.filter((record) => record.target !== target);
    this.historyFuture = this.historyFuture.filter((record) => record.target !== target);
    this.historyBytes = 0;
    for (const record of this.historyPast) this.historyBytes += record.bytes;
    for (const record of this.historyFuture) this.historyBytes += record.bytes;
  }

  private invalidateTarget(target: PaintTarget): void {
    if (!target.valid) return;
    target.valid = false;
    target.invalidReason = "canvas-unavailable";
    if (this.active?.target === target) this.active = null;
    if (this.pending?.target === target) {
      this.pending.readController?.abort();
      this.pending = null;
    }
    if (this.surfaceSession?.target === target) {
      this.surfaceSession.controller?.abort();
      this.surfaceSession = null;
    }
    this.removeTargetHistory(target);
    for (const binding of target.bindings.values()) {
      try {
        if (binding.material.map === target.paintedTexture) {
          binding.material.map = binding.originalMap;
          markMaterialChanged(binding.material);
        }
      } catch {
        // Continue releasing the remaining runtime-owned bindings and raster resources.
      }
    }
    target.bindings.clear();
    if (this.targetsByOriginal.get(target.originalTexture) === target) {
      this.targetsByOriginal.delete(target.originalTexture);
    }
    if (this.targetsByPainted.get(target.paintedTexture) === target) {
      this.targetsByPainted.delete(target.paintedTexture);
    }
    const targetIndex = this.targets.indexOf(target);
    if (targetIndex >= 0) this.targets.splice(targetIndex, 1);
    this.aggregateRgbaBytes = Math.max(0, this.aggregateRgbaBytes - target.rgbaBytes);
    this.aggregateTargetResidentBytes = Math.max(
      0,
      this.aggregateTargetResidentBytes - target.residentBytes,
    );
    if (this.selectedTarget === target) this.selectedTarget = null;
    try {
      target.paintedTexture.dispose();
    } catch {
      // Canvas release below is still required when a custom renderer wrapper throws.
    }
    disposeCanvas(target.canvas);
  }

  private syncTarget(
    target: PaintTarget,
    dirtyRect = EMPTY_STUDIO_VRM_TEXTURE_RECT,
  ): boolean {
    if (!target.valid) return false;
    try {
      if (dirtyRect.width > 0 && dirtyRect.height > 0) {
        target.context.putImageData(
          target.imageData,
          0,
          0,
          dirtyRect.x,
          dirtyRect.y,
          dirtyRect.width,
          dirtyRect.height,
        );
      } else {
        target.context.putImageData(target.imageData, 0, 0);
      }
      target.paintedTexture.needsUpdate = true;
      this.contentRevision = Math.min(
        Number.MAX_SAFE_INTEGER,
        this.contentRevision + 1,
      );
      return true;
    } catch {
      return false;
    }
  }

  private fail<T>(
    code: StudioVrmTexturePaintRuntimeErrorCode,
  ): StudioVrmTexturePaintRuntimeResult<T> {
    this.lastError = frozenError(code);
    this.publish();
    return Object.freeze({ ok: false as const, error: this.lastError });
  }

  private publish(): void {
    this.snapshot = this.createSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(this.snapshot);
      } catch {
        // State transitions must not be interrupted by a consumer listener.
      }
    }
  }

  private createSnapshot(): StudioVrmTexturePaintRuntimeSnapshot {
    const targetSnapshots = this.targets.map((target) => Object.freeze({
      id: target.id,
      sourceTextureUuid: target.originalTexture.uuid,
      paintedTextureUuid: target.paintedTexture.uuid,
      sourceName: target.originalTexture.name,
      width: target.size.width,
      height: target.size.height,
      rgbaBytes: target.rgbaBytes,
      residentBytes: target.residentBytes,
      bindingCount: target.bindings.size,
      valid: target.valid,
      invalidReason: target.invalidReason,
    }));
    const status: StudioVrmTexturePaintRuntimeStatus = this.disposed
      ? "disposed"
      : this.sampling || this.filling || this.pending || (this.surfaceSession && !this.surfaceSession.token)
        ? "loading"
        : this.active || this.surfaceSession
          ? "painting"
          : this.selectedTarget && !this.selectedTarget.valid
            ? "invalid"
            : this.selectedTarget
              ? "ready"
              : "idle";
    const activeTarget = this.selectedTarget
      ? Object.freeze({
          id: this.selectedTarget.id,
          sourceName: this.selectedTarget.originalTexture.name,
          width: this.selectedTarget.size.width,
          height: this.selectedTarget.size.height,
          bindingCount: this.selectedTarget.bindings.size,
          valid: this.selectedTarget.valid,
          invalidReason: this.selectedTarget.invalidReason,
        })
      : null;
    const activeOperation = this.sampling
      ? "sample"
      : this.filling
        ? "fill"
        : this.pending
          ? "stroke-read"
          : this.active
            ? "stroke"
            : this.surfaceSession
              ? this.surfaceSession.token
                ? "surface-brush"
                : "surface-read"
            : null;
    return Object.freeze({
      status,
      activeOperation,
      activePointerId: this.pending?.pointerId ?? this.active?.pointerId ?? null,
      activeTargetId: this.selectedTarget?.id ?? null,
      activeTarget,
      aggregateRgbaBytes: this.aggregateRgbaBytes,
      aggregateTargetResidentBytes: this.aggregateTargetResidentBytes,
      residentBytes: saturatedByteSum(this.aggregateTargetResidentBytes, this.historyBytes),
      maxResidentBytes: this.options.maxAggregateResidentBytes,
      targets: Object.freeze(targetSnapshots),
      history: Object.freeze({
        undoCount: this.historyPast.length,
        redoCount: this.historyFuture.length,
        retainedBytes: this.historyBytes,
        maxEntries: this.options.maxHistoryEntries,
        maxBytes: this.options.maxHistoryBytes,
      }),
      error: this.lastError,
      guidance: this.lastGuidance,
    });
  }
}

export function createStudioVrmTexturePaintRuntime(
  scene: THREE.Object3D,
  options: CreateStudioVrmTexturePaintRuntimeOptions = {},
): StudioVrmTexturePaintRuntime {
  return new StudioVrmTexturePaintRuntime(scene, options);
}
