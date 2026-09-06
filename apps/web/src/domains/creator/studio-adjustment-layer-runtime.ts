import {
  applyGpuFilterChain,
} from "./render/studio-gpu-filter-apply";
import {
  applyImageFilters,
  buildImageFilters,
  registerStudioKonvaFilters,
  type KonvaLike,
} from "./render/studio-konva-filters";
import {
  studioAdjustmentOperationToFilterFields,
  type StudioAdjustmentFilterOperation,
} from "./studio-adjustment-stack";
import {
  runStudioImageFilterWorker,
  type StudioImageFilterWorkerClientOptions,
} from "./studio-image-filter-worker-client";

import type { StudioGpuFilterRuntimeOptions } from "./render/studio-gpu-filter-runtime";
import type {
  StudioAdjustmentLayerBlendMode,
  StudioAdjustmentLayerCompositorPlan,
  StudioAdjustmentLayerPass,
  StudioAdjustmentLayerPlanStatus,
  StudioAdjustmentLayerRenderKind,
} from "./studio-adjustment-layer-plan";
import type { StudioImageDataLike } from "./studio-filters";

/**
 * Pixel execution boundary for first-class adjustment layers.
 *
 * The layer planner deliberately stops at a renderer-independent recipe. This runtime consumes a
 * compositor-produced RGBA revision, executes each active pass in painter order, and returns a new
 * surface. It never mutates the source, the plan, masks, or its immutable recipe.
 */

export const STUDIO_ADJUSTMENT_LAYER_RUNTIME_VERSION = 1 as const;
export const STUDIO_ADJUSTMENT_LAYER_ADAPTER_CONTRACT_VERSION = 1 as const;

export const STUDIO_ADJUSTMENT_LAYER_RUNTIME_LIMITS = Object.freeze({
  maxPixels: 67_108_864,
  maxWorkingBytes: 768 * 1024 * 1024,
  maxPasses: 256,
  maxOperations: 2_048,
  maxMasks: 256,
});

export type StudioAdjustmentLayerRevision = string | number;

export interface StudioAdjustmentLayerPixelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioAdjustmentLayerCompositeDescriptor {
  readonly revision: StudioAdjustmentLayerRevision;
  readonly width: number;
  readonly height: number;
  /**
   * Semantic inputs already flattened into this revision. These are provenance, not a raster-only
   * gate: vector, text, shape, group, and 3D composites are first-class accepted sources.
   */
  readonly renderKinds: readonly StudioAdjustmentLayerRenderKind[];
}

export interface StudioAdjustmentLayerCompositeSource
  extends StudioAdjustmentLayerCompositeDescriptor {
  readonly imageData: StudioImageDataLike;
}

export interface StudioAdjustmentLayerMask {
  readonly id: string;
  readonly revision: StudioAdjustmentLayerRevision;
  readonly width: number;
  readonly height: number;
  /** One byte of coverage per canvas pixel: 0 is excluded and 255 is fully included. */
  readonly data: Uint8ClampedArray;
}

export interface StudioAdjustmentLayerMaskRevision {
  readonly id: string;
  readonly revision: StudioAdjustmentLayerRevision;
}

export interface StudioAdjustmentLayerRuntimeLimits {
  readonly maxPixels: number;
  readonly maxWorkingBytes: number;
  readonly maxPasses: number;
  readonly maxOperations: number;
  readonly maxMasks: number;
}

export interface StudioAdjustmentLayerRuntimePassRecipe {
  readonly adjustmentLayerId: string;
  readonly status: StudioAdjustmentLayerPlanStatus;
  readonly opacity: number;
  readonly blendMode: StudioAdjustmentLayerBlendMode;
  readonly maskId?: string;
  readonly sourceLayerIds: readonly string[];
  readonly sourceRenderKinds: readonly StudioAdjustmentLayerRenderKind[];
  readonly operations: readonly StudioAdjustmentFilterOperation[];
  readonly operationsFingerprint: string;
}

/**
 * Small, serializable history record. Pixel buffers are intentionally absent so undo/redo stores
 * only stable intent plus source/mask revision tokens.
 */
export interface StudioAdjustmentLayerRuntimeRecipe {
  readonly version: typeof STUDIO_ADJUSTMENT_LAYER_RUNTIME_VERSION;
  readonly planFingerprint: string;
  readonly source: StudioAdjustmentLayerCompositeDescriptor;
  readonly maskRevisions: readonly StudioAdjustmentLayerMaskRevision[];
  readonly selectionBounds: StudioAdjustmentLayerPixelRect | null;
  readonly dirtyRect: StudioAdjustmentLayerPixelRect;
  readonly readRect: StudioAdjustmentLayerPixelRect;
  readonly passes: readonly StudioAdjustmentLayerRuntimePassRecipe[];
  readonly fingerprint: string;
}

export interface CreateStudioAdjustmentLayerRuntimeRecipeInput {
  readonly plan: StudioAdjustmentLayerCompositorPlan;
  readonly source: StudioAdjustmentLayerCompositeDescriptor;
  readonly masks?: readonly StudioAdjustmentLayerMaskRevision[];
  readonly selectionBounds?: StudioAdjustmentLayerPixelRect | null;
  readonly dirtyRect?: StudioAdjustmentLayerPixelRect | null;
  readonly limits?: Partial<StudioAdjustmentLayerRuntimeLimits>;
}

export interface StudioAdjustmentLayerFilterAdapterInput {
  readonly imageData: StudioImageDataLike;
  readonly operations: readonly StudioAdjustmentFilterOperation[];
  readonly sourceRevision: StudioAdjustmentLayerRevision;
  readonly operationsFingerprint: string;
  readonly signal?: AbortSignal;
}

export interface StudioAdjustmentLayerFilterAdapterResult {
  readonly contractVersion: typeof STUDIO_ADJUSTMENT_LAYER_ADAPTER_CONTRACT_VERSION;
  readonly backend: string;
  readonly imageData: StudioImageDataLike;
  /** Echo tokens make stale/out-of-order asynchronous results impossible to accept silently. */
  readonly sourceRevision: StudioAdjustmentLayerRevision;
  readonly operationsFingerprint: string;
}

export interface StudioAdjustmentLayerFilterAdapter {
  readonly contractVersion: typeof STUDIO_ADJUSTMENT_LAYER_ADAPTER_CONTRACT_VERSION;
  readonly id: string;
  readonly preservesOperationOrder: true;
  readonly failClosed: true;
  run(
    input: StudioAdjustmentLayerFilterAdapterInput,
  ): Promise<StudioAdjustmentLayerFilterAdapterResult>;
}

export interface StudioAdjustmentLayerRuntimeTraceEntry {
  readonly adjustmentLayerId: string;
  readonly status: StudioAdjustmentLayerPlanStatus;
  readonly executed: boolean;
  readonly backend: string | null;
  readonly operationsFingerprint: string;
}

export interface StudioAdjustmentLayerRuntimeResult {
  readonly imageData: StudioImageDataLike;
  readonly sourceRevision: StudioAdjustmentLayerRevision;
  readonly recipeFingerprint: string;
  readonly dirtyRect: StudioAdjustmentLayerPixelRect;
  readonly readRect: StudioAdjustmentLayerPixelRect;
  readonly sourceRenderKinds: readonly StudioAdjustmentLayerRenderKind[];
  readonly trace: readonly StudioAdjustmentLayerRuntimeTraceEntry[];
}

export interface ExecuteStudioAdjustmentLayerRuntimeOptions {
  readonly adapter?: StudioAdjustmentLayerFilterAdapter;
  readonly masks?: readonly StudioAdjustmentLayerMask[];
  readonly signal?: AbortSignal;
  readonly limits?: Partial<StudioAdjustmentLayerRuntimeLimits>;
}

export interface StudioAdjustmentLayerAdapterParityOptions {
  /** Per-channel absolute byte tolerance. WebGPU defaults to one quantization step. */
  readonly maxChannelDelta?: number;
  /** Fraction of channels allowed to exceed maxChannelDelta. */
  readonly maxDifferentChannelRatio?: number;
}

export interface StudioAdjustmentLayerAdapterParityReport {
  readonly adapterId: string;
  readonly comparedChannels: number;
  readonly differentChannels: number;
  readonly maximumChannelDelta: number;
  readonly differentChannelRatio: number;
}

export type StudioAdjustmentLayerRuntimeErrorCode =
  | "INVALID_RECIPE"
  | "INVALID_SOURCE"
  | "STALE_SOURCE"
  | "LIMIT_EXCEEDED"
  | "MISSING_MASK"
  | "INVALID_MASK"
  | "STALE_MASK"
  | "ABORTED"
  | "ADAPTER_FAILURE"
  | "ADAPTER_MISMATCH";

export class StudioAdjustmentLayerRuntimeError extends Error {
  readonly code: StudioAdjustmentLayerRuntimeErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: StudioAdjustmentLayerRuntimeErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StudioAdjustmentLayerRuntimeError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

const TEXT_ENCODER = new TextEncoder();
const RENDER_KINDS = new Set<StudioAdjustmentLayerRenderKind>([
  "raster",
  "vector",
  "text",
  "shape",
  "group",
  "three-d",
  "other",
]);

const cpuFilterRegistry: KonvaLike = { Filters: {} };
registerStudioKonvaFilters(cpuFilterRegistry);

function fail(
  code: StudioAdjustmentLayerRuntimeErrorCode,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
  cause?: unknown,
): never {
  throw new StudioAdjustmentLayerRuntimeError(
    code,
    message,
    details,
    cause === undefined ? undefined : { cause },
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJson(value: CanonicalValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("INVALID_RECIPE", "Recipe contains a non-finite number.");
    return Object.is(value, -0) ? "0" : String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const record = value as Readonly<Record<string, CanonicalValue>>;
  return `{${Object.keys(record)
    .sort(compareText)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key]!)}`)
    .join(",")}}`;
}

function fingerprint(value: CanonicalValue): string {
  const bytes = TEXT_ENCODER.encode(canonicalJson(value));
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const byte of bytes) {
    first = Math.imul(first ^ byte, 0x01000193);
    second = Math.imul(second ^ byte, 0x85ebca6b);
    second ^= second >>> 13;
  }
  return `salr1-${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

function sameRevision(
  left: StudioAdjustmentLayerRevision,
  right: StudioAdjustmentLayerRevision,
): boolean {
  return typeof left === typeof right && Object.is(left, right);
}

function assertRevision(
  revision: StudioAdjustmentLayerRevision,
  field: string,
): void {
  if (
    (typeof revision === "string" && revision.length > 0 && revision.length <= 512)
    || (typeof revision === "number" && Number.isSafeInteger(revision))
  ) {
    return;
  }
  fail("INVALID_RECIPE", `${field} must be a non-empty string or safe integer.`, { field });
}

function normalizeLimit(
  value: number | undefined,
  fallback: number,
  field: keyof StudioAdjustmentLayerRuntimeLimits,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail("LIMIT_EXCEEDED", `${field} must be a positive safe integer.`, { field, value });
  }
  return value;
}

function normalizeLimits(
  overrides: Partial<StudioAdjustmentLayerRuntimeLimits> | undefined,
): StudioAdjustmentLayerRuntimeLimits {
  return {
    maxPixels: normalizeLimit(
      overrides?.maxPixels,
      STUDIO_ADJUSTMENT_LAYER_RUNTIME_LIMITS.maxPixels,
      "maxPixels",
    ),
    maxWorkingBytes: normalizeLimit(
      overrides?.maxWorkingBytes,
      STUDIO_ADJUSTMENT_LAYER_RUNTIME_LIMITS.maxWorkingBytes,
      "maxWorkingBytes",
    ),
    maxPasses: normalizeLimit(
      overrides?.maxPasses,
      STUDIO_ADJUSTMENT_LAYER_RUNTIME_LIMITS.maxPasses,
      "maxPasses",
    ),
    maxOperations: normalizeLimit(
      overrides?.maxOperations,
      STUDIO_ADJUSTMENT_LAYER_RUNTIME_LIMITS.maxOperations,
      "maxOperations",
    ),
    maxMasks: normalizeLimit(
      overrides?.maxMasks,
      STUDIO_ADJUSTMENT_LAYER_RUNTIME_LIMITS.maxMasks,
      "maxMasks",
    ),
  };
}

function assertDimensions(width: number, height: number): number {
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width <= 0
    || height <= 0
  ) {
    fail("INVALID_SOURCE", "Composite dimensions must be positive safe integers.", {
      width,
      height,
    });
  }
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels * 4 > 0xffff_ffff) {
    fail("LIMIT_EXCEEDED", "Composite byte length is not safely addressable.", {
      width,
      height,
    });
  }
  return pixels;
}

function assertImageData(
  imageData: StudioImageDataLike,
  expectedWidth: number,
  expectedHeight: number,
  field = "source.imageData",
): void {
  if (
    !imageData
    || imageData.width !== expectedWidth
    || imageData.height !== expectedHeight
    || !(imageData.data instanceof Uint8ClampedArray)
    || imageData.data.length !== expectedWidth * expectedHeight * 4
  ) {
    fail("INVALID_SOURCE", `${field} does not match the declared RGBA dimensions.`, {
      expectedWidth,
      expectedHeight,
      actualWidth: imageData?.width,
      actualHeight: imageData?.height,
      actualBytes: imageData?.data?.length,
    });
  }
}

function normalizeRenderKinds(
  value: readonly StudioAdjustmentLayerRenderKind[],
): readonly StudioAdjustmentLayerRenderKind[] {
  if (!Array.isArray(value)) {
    fail("INVALID_RECIPE", "source.renderKinds must be an array.");
  }
  const unique = new Set<StudioAdjustmentLayerRenderKind>();
  for (const kind of value) {
    if (!RENDER_KINDS.has(kind)) {
      fail("INVALID_RECIPE", "source.renderKinds contains an unknown render kind.", { kind });
    }
    unique.add(kind);
  }
  return Object.freeze([...unique].sort(compareText));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeRect(
  value: StudioAdjustmentLayerPixelRect | null | undefined,
  width: number,
  height: number,
  fallback: StudioAdjustmentLayerPixelRect,
): StudioAdjustmentLayerPixelRect {
  if (value === null || value === undefined) return Object.freeze({ ...fallback });
  if (
    !Number.isFinite(value.x)
    || !Number.isFinite(value.y)
    || !Number.isFinite(value.width)
    || !Number.isFinite(value.height)
    || value.width < 0
    || value.height < 0
  ) {
    fail("INVALID_RECIPE", "Pixel rectangle must contain finite non-negative dimensions.", {
      value,
    });
  }
  const left = clamp(Math.floor(value.x), 0, width);
  const top = clamp(Math.floor(value.y), 0, height);
  const right = clamp(Math.ceil(value.x + value.width), left, width);
  const bottom = clamp(Math.ceil(value.y + value.height), top, height);
  return Object.freeze({
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  });
}

function intersectRects(
  left: StudioAdjustmentLayerPixelRect,
  right: StudioAdjustmentLayerPixelRect,
): StudioAdjustmentLayerPixelRect {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const endX = Math.min(left.x + left.width, right.x + right.width);
  const endY = Math.min(left.y + left.height, right.y + right.height);
  return Object.freeze({
    x,
    y,
    width: Math.max(0, endX - x),
    height: Math.max(0, endY - y),
  });
}

function expandRect(
  rect: StudioAdjustmentLayerPixelRect,
  padding: number,
  width: number,
  height: number,
): StudioAdjustmentLayerPixelRect {
  const x = Math.max(0, rect.x - padding);
  const y = Math.max(0, rect.y - padding);
  const endX = Math.min(width, rect.x + rect.width + padding);
  const endY = Math.min(height, rect.y + rect.height + padding);
  return Object.freeze({ x, y, width: endX - x, height: endY - y });
}

function finiteParam(
  operation: StudioAdjustmentFilterOperation,
  key: string,
  fallback: number,
): number {
  const value = operation.params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

type DirtyPolicy = { readonly fullCanvas: boolean; readonly padding: number };

/**
 * A cropped execution is only used for origin-independent point/neighbourhood filters. Pattern,
 * seeded, displacement, and block-grid effects retain full-canvas coordinates by design.
 */
function dirtyPolicyForOperation(
  operation: StudioAdjustmentFilterOperation,
): DirtyPolicy {
  switch (operation.engine) {
    case "blur":
      return { fullCanvas: false, padding: Math.ceil(finiteParam(operation, "radius", 0) * 4) };
    case "gaussian-blur":
      return { fullCanvas: false, padding: Math.ceil(finiteParam(operation, "radius", 8) * 4) };
    case "motion-blur":
      return { fullCanvas: false, padding: Math.ceil(finiteParam(operation, "radius", 18) + 2) };
    case "sharpen":
    case "high-pass":
    case "custom-convolution":
      return { fullCanvas: false, padding: 2 };
    case "smart-sharpen":
    case "median-despeckle":
    case "surface-blur":
      return {
        fullCanvas: false,
        padding: Math.ceil(finiteParam(operation, "radius", 2) * 3 + 2),
      };
    case "unsharp-mask":
      return {
        fullCanvas: false,
        padding: Math.ceil(finiteParam(operation, "radius", 1) * 4 + 2),
      };
    case "morphology":
      return {
        fullCanvas: false,
        padding: Math.ceil(finiteParam(operation, "radius", 1) + 1),
      };
    case "brightness-contrast":
    case "hue-saturation":
    case "levels":
    case "curves":
    case "color-balance":
    case "channel-mixer":
    case "gradient-map":
    case "shadow-highlight":
    case "exposure":
    case "invert":
    case "grayscale":
    case "sepia":
    case "posterize":
    case "ink-threshold":
      return { fullCanvas: false, padding: 0 };
    default:
      return { fullCanvas: true, padding: 0 };
  }
}

function runtimeReadRect(
  dirtyRect: StudioAdjustmentLayerPixelRect,
  passes: readonly StudioAdjustmentLayerRuntimePassRecipe[],
  width: number,
  height: number,
): StudioAdjustmentLayerPixelRect {
  let padding = 0;
  for (const pass of passes) {
    if (pass.status !== "active") continue;
    for (const operation of pass.operations) {
      const policy = dirtyPolicyForOperation(operation);
      if (policy.fullCanvas) {
        return Object.freeze({ x: 0, y: 0, width, height });
      }
      padding += policy.padding;
    }
  }
  return expandRect(dirtyRect, padding, width, height);
}

function cloneOperation(
  operation: StudioAdjustmentFilterOperation,
): StudioAdjustmentFilterOperation {
  return Object.freeze({
    id: operation.id,
    engine: operation.engine,
    enabled: operation.enabled,
    params: Object.freeze({ ...operation.params }),
  });
}

function clonePass(pass: StudioAdjustmentLayerPass): StudioAdjustmentLayerRuntimePassRecipe {
  const operations = Object.freeze(pass.operations.map(cloneOperation));
  return Object.freeze({
    adjustmentLayerId: pass.adjustmentLayerId,
    status: pass.status,
    opacity: pass.opacity,
    blendMode: pass.blendMode,
    ...(pass.maskId === undefined ? {} : { maskId: pass.maskId }),
    sourceLayerIds: Object.freeze([...pass.sourceLayerIds]),
    sourceRenderKinds: Object.freeze([...pass.sourceRenderKinds]),
    operations,
    operationsFingerprint: fingerprint(operations as unknown as CanonicalValue),
  });
}

function canonicalRecipeCore(
  recipe: Omit<StudioAdjustmentLayerRuntimeRecipe, "fingerprint">,
): CanonicalValue {
  return recipe as unknown as CanonicalValue;
}

function assertRecipeBudgets(
  recipe: Pick<StudioAdjustmentLayerRuntimeRecipe, "source" | "passes" | "readRect">,
  limits: StudioAdjustmentLayerRuntimeLimits,
): void {
  const pixels = assertDimensions(recipe.source.width, recipe.source.height);
  if (pixels > limits.maxPixels) {
    fail("LIMIT_EXCEEDED", "Adjustment-layer pixel budget exceeded.", {
      pixels,
      maximum: limits.maxPixels,
    });
  }
  if (recipe.passes.length > limits.maxPasses) {
    fail("LIMIT_EXCEEDED", "Adjustment-layer pass budget exceeded.", {
      passes: recipe.passes.length,
      maximum: limits.maxPasses,
    });
  }
  const operations = recipe.passes.reduce((total, pass) => total + pass.operations.length, 0);
  if (operations > limits.maxOperations) {
    fail("LIMIT_EXCEEDED", "Adjustment-layer operation budget exceeded.", {
      operations,
      maximum: limits.maxOperations,
    });
  }
  // Full output + cropped working input/base/filtered buffers + one transient adapter buffer.
  const workingPixels = recipe.readRect.width * recipe.readRect.height;
  const workingBytes = pixels * 4 + workingPixels * 4 * 4;
  if (!Number.isSafeInteger(workingBytes) || workingBytes > limits.maxWorkingBytes) {
    fail("LIMIT_EXCEEDED", "Adjustment-layer working-memory budget exceeded.", {
      workingBytes,
      maximum: limits.maxWorkingBytes,
    });
  }
}

export function createStudioAdjustmentLayerRuntimeRecipe(
  input: CreateStudioAdjustmentLayerRuntimeRecipeInput,
): StudioAdjustmentLayerRuntimeRecipe {
  const limits = normalizeLimits(input.limits);
  assertRevision(input.source.revision, "source.revision");
  assertDimensions(input.source.width, input.source.height);
  if (
    !input.plan
    || input.plan.version !== STUDIO_ADJUSTMENT_LAYER_RUNTIME_VERSION
    || !Array.isArray(input.plan.passes)
    || typeof input.plan.fingerprint !== "string"
  ) {
    fail("INVALID_RECIPE", "A canonical adjustment-layer compositor plan is required.");
  }
  const canvasRect = Object.freeze({
    x: 0,
    y: 0,
    width: input.source.width,
    height: input.source.height,
  });
  const selectionBounds = input.selectionBounds === null || input.selectionBounds === undefined
    ? null
    : normalizeRect(input.selectionBounds, input.source.width, input.source.height, canvasRect);
  const requestedDirty = normalizeRect(
    input.dirtyRect,
    input.source.width,
    input.source.height,
    canvasRect,
  );
  const dirtyRect = selectionBounds
    ? intersectRects(requestedDirty, selectionBounds)
    : requestedDirty;
  const passes = Object.freeze(input.plan.passes.map(clonePass));
  const readRect = runtimeReadRect(
    dirtyRect,
    passes,
    input.source.width,
    input.source.height,
  );
  const maskRevisions = Object.freeze(
    [...(input.masks ?? [])]
      .map((mask) => {
        if (!mask || typeof mask.id !== "string" || mask.id.length === 0 || mask.id.length > 512) {
          fail("INVALID_RECIPE", "Mask revision has an invalid ID.");
        }
        assertRevision(mask.revision, `mask(${mask.id}).revision`);
        return Object.freeze({ id: mask.id, revision: mask.revision });
      })
      .sort((left, right) => compareText(left.id, right.id)),
  );
  if (maskRevisions.length > limits.maxMasks) {
    fail("LIMIT_EXCEEDED", "Adjustment-layer mask budget exceeded.", {
      masks: maskRevisions.length,
      maximum: limits.maxMasks,
    });
  }
  for (let index = 1; index < maskRevisions.length; index += 1) {
    if (maskRevisions[index - 1]!.id === maskRevisions[index]!.id) {
      fail("INVALID_RECIPE", "Mask revision IDs must be unique.", {
        id: maskRevisions[index]!.id,
      });
    }
  }
  const source = Object.freeze({
    revision: input.source.revision,
    width: input.source.width,
    height: input.source.height,
    renderKinds: normalizeRenderKinds(input.source.renderKinds),
  });
  const core = Object.freeze({
    version: STUDIO_ADJUSTMENT_LAYER_RUNTIME_VERSION,
    planFingerprint: input.plan.fingerprint,
    source,
    maskRevisions,
    selectionBounds,
    dirtyRect,
    readRect,
    passes,
  });
  assertRecipeBudgets(core, limits);
  return Object.freeze({
    ...core,
    fingerprint: fingerprint(canonicalRecipeCore(core)),
  });
}

export function serializeStudioAdjustmentLayerRuntimeRecipe(
  recipe: StudioAdjustmentLayerRuntimeRecipe,
): string {
  return canonicalJson(recipe as unknown as CanonicalValue);
}

function cloneImageData(imageData: StudioImageDataLike): StudioImageDataLike {
  return {
    data: new Uint8ClampedArray(imageData.data),
    width: imageData.width,
    height: imageData.height,
  };
}

function cropImageData(
  imageData: StudioImageDataLike,
  rect: StudioAdjustmentLayerPixelRect,
): StudioImageDataLike {
  const data = new Uint8ClampedArray(rect.width * rect.height * 4);
  for (let row = 0; row < rect.height; row += 1) {
    const sourceOffset = ((rect.y + row) * imageData.width + rect.x) * 4;
    const targetOffset = row * rect.width * 4;
    data.set(
      imageData.data.subarray(sourceOffset, sourceOffset + rect.width * 4),
      targetOffset,
    );
  }
  return { data, width: rect.width, height: rect.height };
}

function copyRectFromCrop(
  target: StudioImageDataLike,
  crop: StudioImageDataLike,
  cropRect: StudioAdjustmentLayerPixelRect,
  copyRect: StudioAdjustmentLayerPixelRect,
): void {
  if (copyRect.width === 0 || copyRect.height === 0) return;
  const localX = copyRect.x - cropRect.x;
  const localY = copyRect.y - cropRect.y;
  for (let row = 0; row < copyRect.height; row += 1) {
    const sourceOffset = ((localY + row) * crop.width + localX) * 4;
    const targetOffset = ((copyRect.y + row) * target.width + copyRect.x) * 4;
    target.data.set(
      crop.data.subarray(sourceOffset, sourceOffset + copyRect.width * 4),
      targetOffset,
    );
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    fail("ABORTED", "Adjustment-layer execution was aborted.");
  }
}

function runCpuFilterOperations(
  imageData: StudioImageDataLike,
  operations: readonly StudioAdjustmentFilterOperation[],
): StudioImageDataLike {
  const output = cloneImageData(imageData);
  const { filters, attrs } = buildImageFilters(
    { smartFilterOperations: operations },
    cpuFilterRegistry,
  );
  applyImageFilters(output, filters, attrs);
  return output;
}

export const studioAdjustmentLayerCpuAdapter: StudioAdjustmentLayerFilterAdapter =
  Object.freeze({
    contractVersion: STUDIO_ADJUSTMENT_LAYER_ADAPTER_CONTRACT_VERSION,
    id: "cpu-reference",
    preservesOperationOrder: true,
    failClosed: true,
    async run(input: StudioAdjustmentLayerFilterAdapterInput) {
      throwIfAborted(input.signal);
      const imageData = runCpuFilterOperations(input.imageData, input.operations);
      throwIfAborted(input.signal);
      return {
        contractVersion: STUDIO_ADJUSTMENT_LAYER_ADAPTER_CONTRACT_VERSION,
        backend: "cpu",
        imageData,
        sourceRevision: input.sourceRevision,
        operationsFingerprint: input.operationsFingerprint,
      };
    },
  });

export function createStudioAdjustmentLayerWorkerAdapter(
  options: Pick<
    StudioImageFilterWorkerClientOptions,
    "executionMode" | "workerFactory"
  > = {},
): StudioAdjustmentLayerFilterAdapter {
  return Object.freeze({
    contractVersion: STUDIO_ADJUSTMENT_LAYER_ADAPTER_CONTRACT_VERSION,
    id: "image-filter-worker",
    preservesOperationOrder: true,
    failClosed: true,
    async run(input: StudioAdjustmentLayerFilterAdapterInput) {
      throwIfAborted(input.signal);
      const result = await runStudioImageFilterWorker(
        {
          imageData: cloneImageData(input.imageData),
          el: { smartFilterOperations: input.operations },
        },
        { ...options, signal: input.signal },
      );
      throwIfAborted(input.signal);
      return {
        contractVersion: STUDIO_ADJUSTMENT_LAYER_ADAPTER_CONTRACT_VERSION,
        backend: result.execution,
        imageData: result.imageData,
        sourceRevision: input.sourceRevision,
        operationsFingerprint: input.operationsFingerprint,
      };
    },
  });
}

/**
 * Exact WebGPU adapter for the deterministic colour/LUT kernels it supports.
 *
 * Provider selection is immutable for the pass: an unavailable or unsupported kernel rejects the
 * pass before publication. Callers that need the CPU reference must select that adapter before
 * execution instead of changing providers after WebGPU has started.
 */
export function createStudioAdjustmentLayerGpuAdapter(
  options?: StudioGpuFilterRuntimeOptions,
): StudioAdjustmentLayerFilterAdapter {
  return Object.freeze({
    contractVersion: STUDIO_ADJUSTMENT_LAYER_ADAPTER_CONTRACT_VERSION,
    id: "webgpu",
    preservesOperationOrder: true,
    failClosed: true,
    async run(input: StudioAdjustmentLayerFilterAdapterInput) {
      throwIfAborted(input.signal);
      let current = cloneImageData(input.imageData);
      for (const operation of input.operations) {
        throwIfAborted(input.signal);
        const fields = studioAdjustmentOperationToFilterFields(operation);
        const gpuResult = await applyGpuFilterChain(current, fields, options);
        if (!gpuResult) {
          fail(
            "ADAPTER_FAILURE",
            "The selected WebGPU adjustment adapter could not execute the complete pass.",
            { adapterId: "webgpu", operationEngine: operation.engine },
          );
        }
        current = gpuResult;
      }
      throwIfAborted(input.signal);
      return {
        contractVersion: STUDIO_ADJUSTMENT_LAYER_ADAPTER_CONTRACT_VERSION,
        backend: "webgpu",
        imageData: current,
        sourceRevision: input.sourceRevision,
        operationsFingerprint: input.operationsFingerprint,
      };
    },
  });
}

function validateAdapter(
  adapter: StudioAdjustmentLayerFilterAdapter,
): void {
  if (
    !adapter
    || adapter.contractVersion !== STUDIO_ADJUSTMENT_LAYER_ADAPTER_CONTRACT_VERSION
    || adapter.preservesOperationOrder !== true
    || adapter.failClosed !== true
    || typeof adapter.id !== "string"
    || adapter.id.length === 0
    || typeof adapter.run !== "function"
  ) {
    fail("ADAPTER_MISMATCH", "Filter adapter does not satisfy the runtime contract.");
  }
}

function validateAdapterResult(
  result: StudioAdjustmentLayerFilterAdapterResult,
  input: StudioAdjustmentLayerFilterAdapterInput,
  adapter: StudioAdjustmentLayerFilterAdapter,
): void {
  if (
    !result
    || result.contractVersion !== STUDIO_ADJUSTMENT_LAYER_ADAPTER_CONTRACT_VERSION
    || typeof result.backend !== "string"
    || result.backend.length === 0
    || !sameRevision(result.sourceRevision, input.sourceRevision)
    || result.operationsFingerprint !== input.operationsFingerprint
  ) {
    fail("ADAPTER_MISMATCH", "Filter adapter returned stale or incompatible metadata.", {
      adapterId: adapter.id,
      expectedRevision: input.sourceRevision,
      actualRevision: result?.sourceRevision,
      expectedOperationsFingerprint: input.operationsFingerprint,
      actualOperationsFingerprint: result?.operationsFingerprint,
    });
  }
  if (
    !result.imageData
    || result.imageData.width !== input.imageData.width
    || result.imageData.height !== input.imageData.height
    || !(result.imageData.data instanceof Uint8ClampedArray)
    || result.imageData.data.length !== input.imageData.data.length
  ) {
    fail("ADAPTER_MISMATCH", "Filter adapter returned malformed RGBA pixels.", {
      adapterId: adapter.id,
      expectedWidth: input.imageData.width,
      expectedHeight: input.imageData.height,
      actualWidth: result.imageData?.width,
      actualHeight: result.imageData?.height,
      actualBytes: result.imageData?.data?.length,
    });
  }
}

async function runAdapter(
  adapter: StudioAdjustmentLayerFilterAdapter,
  input: StudioAdjustmentLayerFilterAdapterInput,
): Promise<StudioAdjustmentLayerFilterAdapterResult> {
  validateAdapter(adapter);
  try {
    throwIfAborted(input.signal);
    const result = await adapter.run(input);
    throwIfAborted(input.signal);
    validateAdapterResult(result, input, adapter);
    return result;
  } catch (error) {
    if (error instanceof StudioAdjustmentLayerRuntimeError) throw error;
    if (
      error instanceof Error
      && (error.name === "AbortError" || input.signal?.aborted === true)
    ) {
      fail("ABORTED", "Adjustment-layer execution was aborted.", {}, error);
    }
    fail(
      "ADAPTER_FAILURE",
      "Filter adapter failed without a valid result; no partial surface was committed.",
      { adapterId: adapter.id },
      error,
    );
  }
}

function luminance(red: number, green: number, blue: number): number {
  return 0.299 * red + 0.587 * green + 0.114 * blue;
}

function clipColor(red: number, green: number, blue: number): [number, number, number] {
  const lightness = luminance(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const maximum = Math.max(red, green, blue);
  if (minimum < 0) {
    const divisor = lightness - minimum;
    if (divisor !== 0) {
      red = lightness + ((red - lightness) * lightness) / divisor;
      green = lightness + ((green - lightness) * lightness) / divisor;
      blue = lightness + ((blue - lightness) * lightness) / divisor;
    }
  }
  if (maximum > 255) {
    const divisor = maximum - lightness;
    if (divisor !== 0) {
      red = lightness + ((red - lightness) * (255 - lightness)) / divisor;
      green = lightness + ((green - lightness) * (255 - lightness)) / divisor;
      blue = lightness + ((blue - lightness) * (255 - lightness)) / divisor;
    }
  }
  return [red, green, blue];
}

function setLuminance(
  color: readonly [number, number, number],
  nextLuminance: number,
): [number, number, number] {
  const delta = nextLuminance - luminance(color[0], color[1], color[2]);
  return clipColor(color[0] + delta, color[1] + delta, color[2] + delta);
}

function saturation(red: number, green: number, blue: number): number {
  return Math.max(red, green, blue) - Math.min(red, green, blue);
}

function setSaturation(
  color: readonly [number, number, number],
  nextSaturation: number,
): [number, number, number] {
  const entries = color.map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value);
  const output: [number, number, number] = [0, 0, 0];
  const minimum = entries[0]!;
  const middle = entries[1]!;
  const maximum = entries[2]!;
  if (maximum.value > minimum.value) {
    output[middle.index] =
      ((middle.value - minimum.value) * nextSaturation) / (maximum.value - minimum.value);
    output[maximum.index] = nextSaturation;
  }
  output[minimum.index] = 0;
  return output;
}

function blendChannel(
  mode: Exclude<StudioAdjustmentLayerBlendMode, "color" | "luminosity">,
  base: number,
  blend: number,
): number {
  switch (mode) {
    case "normal":
      return blend;
    case "multiply":
      return (base * blend) / 255;
    case "screen":
      return 255 - ((255 - base) * (255 - blend)) / 255;
    case "overlay":
      return base <= 127.5
        ? (2 * base * blend) / 255
        : 255 - (2 * (255 - base) * (255 - blend)) / 255;
    case "soft-light": {
      const source = blend / 255;
      const destination = base / 255;
      const value = source <= 0.5
        ? destination - (1 - 2 * source) * destination * (1 - destination)
        : destination + (2 * source - 1)
          * ((destination <= 0.25
            ? ((16 * destination - 12) * destination + 4) * destination
            : Math.sqrt(destination)) - destination);
      return value * 255;
    }
    case "hard-light":
      return blend <= 127.5
        ? (2 * base * blend) / 255
        : 255 - (2 * (255 - base) * (255 - blend)) / 255;
    case "darken":
      return Math.min(base, blend);
    case "lighten":
      return Math.max(base, blend);
  }
}

function blendRgb(
  mode: StudioAdjustmentLayerBlendMode,
  base: readonly [number, number, number],
  filtered: readonly [number, number, number],
): [number, number, number] {
  if (mode === "color") {
    return setLuminance(
      setSaturation(filtered, saturation(base[0], base[1], base[2])),
      luminance(base[0], base[1], base[2]),
    );
  }
  if (mode === "luminosity") {
    return setLuminance(base, luminance(filtered[0], filtered[1], filtered[2]));
  }
  return [
    blendChannel(mode, base[0], filtered[0]),
    blendChannel(mode, base[1], filtered[1]),
    blendChannel(mode, base[2], filtered[2]),
  ];
}

function compositeFilteredPass(
  before: StudioImageDataLike,
  filtered: StudioImageDataLike,
  pass: StudioAdjustmentLayerRuntimePassRecipe,
  readRect: StudioAdjustmentLayerPixelRect,
  selectionBounds: StudioAdjustmentLayerPixelRect | null,
  mask: StudioAdjustmentLayerMask | undefined,
): StudioImageDataLike {
  const output = cloneImageData(before);
  const selectionEndX = selectionBounds ? selectionBounds.x + selectionBounds.width : 0;
  const selectionEndY = selectionBounds ? selectionBounds.y + selectionBounds.height : 0;
  for (let localY = 0; localY < output.height; localY += 1) {
    const globalY = readRect.y + localY;
    for (let localX = 0; localX < output.width; localX += 1) {
      const globalX = readRect.x + localX;
      if (
        selectionBounds
        && (
          globalX < selectionBounds.x
          || globalX >= selectionEndX
          || globalY < selectionBounds.y
          || globalY >= selectionEndY
        )
      ) {
        continue;
      }
      let coverage = pass.opacity;
      if (mask) coverage *= mask.data[globalY * mask.width + globalX]! / 255;
      if (coverage <= 0) continue;
      const index = (localY * output.width + localX) * 4;
      const base: [number, number, number] = [
        before.data[index]!,
        before.data[index + 1]!,
        before.data[index + 2]!,
      ];
      const candidate: [number, number, number] = [
        filtered.data[index]!,
        filtered.data[index + 1]!,
        filtered.data[index + 2]!,
      ];
      const blended = blendRgb(pass.blendMode, base, candidate);
      output.data[index] = base[0] + (blended[0] - base[0]) * coverage;
      output.data[index + 1] = base[1] + (blended[1] - base[1]) * coverage;
      output.data[index + 2] = base[2] + (blended[2] - base[2]) * coverage;
      const baseAlpha = before.data[index + 3]!;
      const filteredAlpha = filtered.data[index + 3]!;
      output.data[index + 3] = baseAlpha + (filteredAlpha - baseAlpha) * coverage;
    }
  }
  return output;
}

function validateMaskSet(
  recipe: StudioAdjustmentLayerRuntimeRecipe,
  masks: readonly StudioAdjustmentLayerMask[],
  limits: StudioAdjustmentLayerRuntimeLimits,
): ReadonlyMap<string, StudioAdjustmentLayerMask> {
  if (masks.length > limits.maxMasks) {
    fail("LIMIT_EXCEEDED", "Adjustment-layer mask budget exceeded.", {
      masks: masks.length,
      maximum: limits.maxMasks,
    });
  }
  const byId = new Map<string, StudioAdjustmentLayerMask>();
  for (const mask of masks) {
    if (
      !mask
      || typeof mask.id !== "string"
      || mask.id.length === 0
      || byId.has(mask.id)
      || mask.width !== recipe.source.width
      || mask.height !== recipe.source.height
      || !(mask.data instanceof Uint8ClampedArray)
      || mask.data.length !== mask.width * mask.height
    ) {
      fail("INVALID_MASK", "Adjustment-layer mask is malformed or duplicated.", {
        maskId: mask?.id,
      });
    }
    byId.set(mask.id, mask);
  }
  for (const expected of recipe.maskRevisions) {
    const actual = byId.get(expected.id);
    if (!actual) {
      fail("MISSING_MASK", "A recipe mask revision is missing.", { maskId: expected.id });
    }
    if (!sameRevision(actual.revision, expected.revision)) {
      fail("STALE_MASK", "A stale mask revision cannot be applied.", {
        maskId: expected.id,
        expectedRevision: expected.revision,
        actualRevision: actual.revision,
      });
    }
  }
  for (const pass of recipe.passes) {
    if (pass.status === "active" && pass.maskId && !byId.has(pass.maskId)) {
      fail("MISSING_MASK", "An active adjustment pass references a missing mask.", {
        adjustmentLayerId: pass.adjustmentLayerId,
        maskId: pass.maskId,
      });
    }
  }
  return byId;
}

function validateRuntimeRecipe(
  recipe: StudioAdjustmentLayerRuntimeRecipe,
): void {
  if (
    !recipe
    || recipe.version !== STUDIO_ADJUSTMENT_LAYER_RUNTIME_VERSION
    || typeof recipe.planFingerprint !== "string"
    || typeof recipe.fingerprint !== "string"
    || !Array.isArray(recipe.passes)
    || !Array.isArray(recipe.maskRevisions)
  ) {
    fail("INVALID_RECIPE", "Adjustment-layer runtime recipe is malformed.");
  }
  const { fingerprint: ignored, ...core } = recipe;
  void ignored;
  const actualFingerprint = fingerprint(canonicalRecipeCore(
    core as Omit<StudioAdjustmentLayerRuntimeRecipe, "fingerprint">,
  ));
  if (actualFingerprint !== recipe.fingerprint) {
    fail("INVALID_RECIPE", "Adjustment-layer runtime recipe fingerprint is invalid.", {
      expected: recipe.fingerprint,
      actual: actualFingerprint,
    });
  }
}

export async function executeStudioAdjustmentLayerRuntime(
  recipe: StudioAdjustmentLayerRuntimeRecipe,
  source: StudioAdjustmentLayerCompositeSource,
  options: ExecuteStudioAdjustmentLayerRuntimeOptions = {},
): Promise<StudioAdjustmentLayerRuntimeResult> {
  validateRuntimeRecipe(recipe);
  const limits = normalizeLimits(options.limits);
  assertRecipeBudgets(recipe, limits);
  throwIfAborted(options.signal);
  assertRevision(source.revision, "source.revision");
  if (!sameRevision(source.revision, recipe.source.revision)) {
    fail("STALE_SOURCE", "A stale composited source revision cannot be filtered.", {
      expectedRevision: recipe.source.revision,
      actualRevision: source.revision,
    });
  }
  if (
    source.width !== recipe.source.width
    || source.height !== recipe.source.height
  ) {
    fail("STALE_SOURCE", "Composited source dimensions changed after recipe creation.", {
      expectedWidth: recipe.source.width,
      expectedHeight: recipe.source.height,
      actualWidth: source.width,
      actualHeight: source.height,
    });
  }
  const runtimeRenderKinds = normalizeRenderKinds(source.renderKinds);
  if (canonicalJson(runtimeRenderKinds) !== canonicalJson(recipe.source.renderKinds)) {
    fail("STALE_SOURCE", "Composited source render-kind provenance changed.", {
      expectedRenderKinds: recipe.source.renderKinds,
      actualRenderKinds: runtimeRenderKinds,
    });
  }
  assertImageData(source.imageData, source.width, source.height);
  const masks = validateMaskSet(recipe, options.masks ?? [], limits);
  const output = cloneImageData(source.imageData);
  const trace: StudioAdjustmentLayerRuntimeTraceEntry[] = [];
  if (recipe.dirtyRect.width === 0 || recipe.dirtyRect.height === 0) {
    return Object.freeze({
      imageData: output,
      sourceRevision: source.revision,
      recipeFingerprint: recipe.fingerprint,
      dirtyRect: recipe.dirtyRect,
      readRect: recipe.readRect,
      sourceRenderKinds: recipe.source.renderKinds,
      trace: Object.freeze(recipe.passes.map((pass) => Object.freeze({
        adjustmentLayerId: pass.adjustmentLayerId,
        status: pass.status,
        executed: false,
        backend: null,
        operationsFingerprint: pass.operationsFingerprint,
      }))),
    });
  }
  let working = cropImageData(source.imageData, recipe.readRect);
  const adapter = options.adapter ?? studioAdjustmentLayerCpuAdapter;
  validateAdapter(adapter);
  for (const pass of recipe.passes) {
    throwIfAborted(options.signal);
    if (pass.status !== "active") {
      trace.push(Object.freeze({
        adjustmentLayerId: pass.adjustmentLayerId,
        status: pass.status,
        executed: false,
        backend: null,
        operationsFingerprint: pass.operationsFingerprint,
      }));
      continue;
    }
    const before = cloneImageData(working);
    const adapterInput: StudioAdjustmentLayerFilterAdapterInput = {
      imageData: cloneImageData(working),
      operations: pass.operations,
      sourceRevision: source.revision,
      operationsFingerprint: pass.operationsFingerprint,
      signal: options.signal,
    };
    const result = await runAdapter(adapter, adapterInput);
    working = compositeFilteredPass(
      before,
      result.imageData,
      pass,
      recipe.readRect,
      recipe.selectionBounds,
      pass.maskId ? masks.get(pass.maskId) : undefined,
    );
    trace.push(Object.freeze({
      adjustmentLayerId: pass.adjustmentLayerId,
      status: pass.status,
      executed: true,
      backend: result.backend,
      operationsFingerprint: pass.operationsFingerprint,
    }));
  }
  throwIfAborted(options.signal);
  copyRectFromCrop(output, working, recipe.readRect, recipe.dirtyRect);
  return Object.freeze({
    imageData: output,
    sourceRevision: source.revision,
    recipeFingerprint: recipe.fingerprint,
    dirtyRect: recipe.dirtyRect,
    readRect: recipe.readRect,
    sourceRenderKinds: recipe.source.renderKinds,
    trace: Object.freeze(trace),
  });
}

export async function verifyStudioAdjustmentLayerAdapterParity(
  adapter: StudioAdjustmentLayerFilterAdapter,
  input: StudioAdjustmentLayerFilterAdapterInput,
  options: StudioAdjustmentLayerAdapterParityOptions = {},
): Promise<StudioAdjustmentLayerAdapterParityReport> {
  validateAdapter(adapter);
  const maxChannelDelta = clamp(
    Math.floor(options.maxChannelDelta ?? 1),
    0,
    255,
  );
  const maxDifferentChannelRatio = clamp(
    options.maxDifferentChannelRatio ?? 0,
    0,
    1,
  );
  const reference = await studioAdjustmentLayerCpuAdapter.run({
    ...input,
    imageData: cloneImageData(input.imageData),
  });
  const candidate = await runAdapter(adapter, {
    ...input,
    imageData: cloneImageData(input.imageData),
  });
  let differentChannels = 0;
  let maximumChannelDelta = 0;
  for (let index = 0; index < reference.imageData.data.length; index += 1) {
    const delta = Math.abs(
      reference.imageData.data[index]! - candidate.imageData.data[index]!,
    );
    maximumChannelDelta = Math.max(maximumChannelDelta, delta);
    if (delta > maxChannelDelta) differentChannels += 1;
  }
  const comparedChannels = reference.imageData.data.length;
  const differentChannelRatio = comparedChannels === 0
    ? 0
    : differentChannels / comparedChannels;
  const report = Object.freeze({
    adapterId: adapter.id,
    comparedChannels,
    differentChannels,
    maximumChannelDelta,
    differentChannelRatio,
  });
  if (differentChannelRatio > maxDifferentChannelRatio) {
    fail(
      "ADAPTER_MISMATCH",
      "Filter adapter exceeded the CPU reference parity tolerance.",
      {
        ...report,
        maxChannelDelta,
        maxDifferentChannelRatio,
      },
    );
  }
  return report;
}
