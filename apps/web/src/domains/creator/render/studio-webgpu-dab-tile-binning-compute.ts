import {
  STUDIO_GPU_DAB_TILE_BINNING_DEFAULT_TILE_SIZE,
  type StudioGpuDabTileBinningInput,
  type StudioGpuDabTileBinningPlan,
} from "./studio-webgpu-dab-tile-binning";

import type { StudioGpuDab } from "./studio-webgpu-dab-plan-contract";

/**
 * Bounded exact WebGPU count / scan / stable-scatter candidate.
 * WGSL identifiers deliberately avoid evolving reserved words (`meta`, `active`).
 *
 * The CPU prepares only four integer span bounds per dab. Tile counts, the exclusive prefix scan,
 * and stable CSR reference emission run on the leased GPU. The output order is byte-for-byte
 * compatible with `planStudioGpuDabTileBinning`.
 *
 * This candidate deliberately has a smaller admission envelope than the CPU oracle. Stable scatter
 * assigns one workgroup to each tile and scans dabs in original order, which is exact and race-free
 * but becomes wasteful for very large tile grids. Workloads outside the explicit operation budget
 * are rejected rather than silently routed to another backend.
 */
export const STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_REVISION = 1 as const;
export const STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_MAX_DABS = 16_384;
export const STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_MAX_TILES = 4_096;
export const STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_MAX_REFERENCES = 262_144;
export const STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_MAX_STABLE_TESTS = 16_777_216;
export const STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_WORKGROUP_SIZE = 128;
export const STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_SCAN_ELEMENTS = 4_096;
const OUTSIDE_DOCUMENT = 0xffff_ffff;

const GPU_BUFFER_MAP_READ = 0x0001;
const GPU_BUFFER_COPY_SRC = 0x0004;
const GPU_BUFFER_COPY_DST = 0x0008;
const GPU_BUFFER_UNIFORM = 0x0040;
const GPU_BUFFER_STORAGE = 0x0080;
const GPU_MAP_READ = 0x0001;

export interface StudioWebGpuDabTileSpanPlan {
  readonly kind: "studio-webgpu-dab-tile-span-plan";
  readonly revision: typeof STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_REVISION;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly tileSize: number;
  readonly columns: number;
  readonly rows: number;
  readonly tileCount: number;
  readonly dabCount: number;
  readonly referenceCount: number;
  /** minColumn, maxColumn, minRow, maxRow; OUTSIDE_DOCUMENT in lane 0 marks no coverage. */
  readonly spans: Readonly<Uint32Array>;
}

export type StudioWebGpuDabTileSpanPlanResult =
  | Readonly<{ status: "ready"; plan: Readonly<StudioWebGpuDabTileSpanPlan> }>
  | Readonly<{
      status: "rejected";
      reason:
        | "invalid-input"
        | "dab-limit"
        | "tile-grid-limit"
        | "reference-budget"
        | "stable-operation-budget"
        | "numeric-overflow";
    }>;

export interface StudioWebGpuDabTileBinningComputeRuntimeOptions {
  readonly device: GPUDevice;
  readonly ownsDevice?: boolean;
  readonly maximumDabs?: number;
  readonly maximumTiles?: number;
  readonly maximumReferences?: number;
  readonly maximumStableTests?: number;
  readonly initialDeviceEpoch?: number;
  readonly onDeviceLost?: (info: GPUDeviceLostInfo) => void;
}

export interface StudioWebGpuDabTileBinningComputeReadback {
  readonly tileOffsets: Readonly<Uint32Array>;
  readonly dabIndices: Readonly<Uint32Array>;
}

export interface StudioWebGpuDabTileBinningComputeReceipt {
  readonly kind: "studio-webgpu-dab-tile-binning-compute-receipt";
  readonly revision: typeof STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_REVISION;
  readonly requestSequence: number;
  readonly deviceEpoch: number;
  readonly tileCount: number;
  readonly dabCount: number;
  readonly referenceCount: number;
  readonly countDispatches: number;
  readonly scanDispatches: 1;
  readonly scatterDispatches: number;
  readonly queueState: "completed";
  readonly complete: true;
}

export interface StudioWebGpuDabTileBinningComputeOutput {
  /** Runtime-owned and valid until the next execute call or disposal. */
  readonly tileOffsetsBuffer: GPUBuffer;
  /** Runtime-owned and valid until the next execute call or disposal. */
  readonly dabIndicesBuffer: GPUBuffer;
  readonly tileCount: number;
  readonly referenceCount: number;
}

export type StudioWebGpuDabTileBinningComputeRejectionReason =
  | "request-sequence"
  | "invalid-input"
  | "dab-limit"
  | "tile-grid-limit"
  | "reference-budget"
  | "stable-operation-budget"
  | "numeric-overflow";

export type StudioWebGpuDabTileBinningComputeExecutionResult =
  | Readonly<{
      status: "completed";
      receipt: Readonly<StudioWebGpuDabTileBinningComputeReceipt>;
      output: Readonly<StudioWebGpuDabTileBinningComputeOutput>;
      readback: Readonly<StudioWebGpuDabTileBinningComputeReadback> | null;
    }>
  | Readonly<{
      status: "rejected";
      reason: StudioWebGpuDabTileBinningComputeRejectionReason;
    }>
  | Readonly<{ status: "busy" }>
  | Readonly<{ status: "cancelled" }>
  | Readonly<{ status: "device-lost"; deviceEpoch: number }>
  | Readonly<{ status: "failed"; reason: "gpu-error" }>
  | Readonly<{ status: "disposed" }>;

export interface StudioWebGpuDabTileBinningComputeRuntimeStats {
  readonly status: "ready" | "busy" | "device-lost" | "failed" | "disposed";
  readonly deviceEpoch: number;
  readonly executions: number;
  readonly spanCapacity: number;
  readonly tileCapacity: number;
  readonly referenceCapacity: number;
  readonly bufferAllocationEpoch: number;
}

export type StudioWebGpuDabTileBinningComputeCreationResult =
  | Readonly<{
      status: "ready";
      runtime: StudioWebGpuDabTileBinningComputeRuntime;
    }>
  | Readonly<{ status: "rejected"; reason: "invalid-options" | "initialization-failed" }>;

interface ValidatedLimits {
  readonly maximumDabs: number;
  readonly maximumTiles: number;
  readonly maximumReferences: number;
  readonly maximumStableTests: number;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finitePositive(value: unknown): value is number {
  return finite(value) && value > 0;
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function normalizeLimit(
  candidate: number | undefined,
  hardMaximum: number,
): number | null {
  if (candidate === undefined) return hardMaximum;
  return positiveSafeInteger(candidate) && candidate <= hardMaximum
    ? candidate
    : null;
}

function validateLimits(
  options: StudioWebGpuDabTileBinningComputeRuntimeOptions,
): ValidatedLimits | null {
  const maximumDabs = normalizeLimit(
    options.maximumDabs,
    STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_MAX_DABS,
  );
  const maximumTiles = normalizeLimit(
    options.maximumTiles,
    STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_MAX_TILES,
  );
  const maximumReferences = normalizeLimit(
    options.maximumReferences,
    STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_MAX_REFERENCES,
  );
  const maximumStableTests = normalizeLimit(
    options.maximumStableTests,
    STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_MAX_STABLE_TESTS,
  );
  return maximumDabs === null
    || maximumTiles === null
    || maximumReferences === null
    || maximumStableTests === null
    ? null
    : { maximumDabs, maximumTiles, maximumReferences, maximumStableTests };
}

function nextPowerOfTwoCapacity(required: number, maximum: number): number {
  let capacity = Math.min(256, maximum);
  while (capacity < required) capacity = Math.min(maximum, capacity * 2);
  return Math.max(1, capacity);
}

function spanForDab(
  dab: Pick<StudioGpuDab, "x" | "y" | "radius">,
  documentWidth: number,
  documentHeight: number,
  tileSize: number,
  columns: number,
  rows: number,
): readonly [number, number, number, number] | null | "numeric-overflow" {
  if (
    typeof dab !== "object"
    || dab === null
    || !finite(dab.x)
    || !finite(dab.y)
    || !finitePositive(dab.radius)
  ) return "numeric-overflow";
  const minimumX = dab.x - dab.radius;
  const minimumY = dab.y - dab.radius;
  const maximumX = dab.x + dab.radius;
  const maximumY = dab.y + dab.radius;
  if (![minimumX, minimumY, maximumX, maximumY].every(Number.isFinite)) {
    return "numeric-overflow";
  }
  if (
    maximumX <= 0
    || maximumY <= 0
    || minimumX >= documentWidth
    || minimumY >= documentHeight
  ) return null;
  const clippedMinimumX = Math.max(0, minimumX);
  const clippedMinimumY = Math.max(0, minimumY);
  const clippedMaximumX = Math.min(documentWidth, maximumX);
  const clippedMaximumY = Math.min(documentHeight, maximumY);
  const minimumColumn = Math.min(
    columns - 1,
    Math.max(0, Math.floor(clippedMinimumX / tileSize)),
  );
  const minimumRow = Math.min(
    rows - 1,
    Math.max(0, Math.floor(clippedMinimumY / tileSize)),
  );
  const maximumColumn = Math.min(
    columns - 1,
    Math.max(minimumColumn, Math.ceil(clippedMaximumX / tileSize) - 1),
  );
  const maximumRow = Math.min(
    rows - 1,
    Math.max(minimumRow, Math.ceil(clippedMaximumY / tileSize) - 1),
  );
  return [minimumColumn, maximumColumn, minimumRow, maximumRow];
}

/**
 * Generates the compact integer span stream consumed by the GPU. This planner independently
 * reproduces the CPU oracle's validation and half-open coverage semantics while avoiding the full
 * CSR materialisation cost that the compute candidate is intended to replace.
 */
export function planStudioWebGpuDabTileSpans(
  input: StudioGpuDabTileBinningInput,
  limits: Partial<ValidatedLimits> = {},
): StudioWebGpuDabTileSpanPlanResult {
  const maximumDabs = normalizeLimit(
    limits.maximumDabs,
    STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_MAX_DABS,
  );
  const maximumTiles = normalizeLimit(
    limits.maximumTiles,
    STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_MAX_TILES,
  );
  const maximumReferences = normalizeLimit(
    limits.maximumReferences,
    STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_MAX_REFERENCES,
  );
  const maximumStableTests = normalizeLimit(
    limits.maximumStableTests,
    STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_MAX_STABLE_TESTS,
  );
  if (
    !input
    || maximumDabs === null
    || maximumTiles === null
    || maximumReferences === null
    || maximumStableTests === null
  ) return Object.freeze({ status: "rejected", reason: "invalid-input" });
  if (!Array.isArray(input.dabs)) {
    return Object.freeze({ status: "rejected", reason: "invalid-input" });
  }
  if (input.dabs.length > maximumDabs) {
    return Object.freeze({ status: "rejected", reason: "dab-limit" });
  }
  const tileSize = input.tileSize
    ?? STUDIO_GPU_DAB_TILE_BINNING_DEFAULT_TILE_SIZE;
  if (
    !finitePositive(input.documentWidth)
    || !finitePositive(input.documentHeight)
    || !finitePositive(tileSize)
  ) return Object.freeze({ status: "rejected", reason: "invalid-input" });
  const columns = Math.ceil(input.documentWidth / tileSize);
  const rows = Math.ceil(input.documentHeight / tileSize);
  const tileCount = columns * rows;
  if (
    !Number.isSafeInteger(columns)
    || !Number.isSafeInteger(rows)
    || !Number.isSafeInteger(tileCount)
    || columns <= 0
    || rows <= 0
  ) return Object.freeze({ status: "rejected", reason: "numeric-overflow" });
  if (tileCount > maximumTiles) {
    return Object.freeze({ status: "rejected", reason: "tile-grid-limit" });
  }
  const stableTests = tileCount * input.dabs.length;
  if (!Number.isSafeInteger(stableTests)) {
    return Object.freeze({ status: "rejected", reason: "numeric-overflow" });
  }
  if (stableTests > maximumStableTests) {
    return Object.freeze({
      status: "rejected",
      reason: "stable-operation-budget",
    });
  }

  const spans = new Uint32Array(input.dabs.length * 4);
  let referenceCount = 0;
  for (let dabIndex = 0; dabIndex < input.dabs.length; dabIndex += 1) {
    const dab = input.dabs[dabIndex]!;
    if (
      typeof dab !== "object"
      || dab === null
      || !finite(dab.x)
      || !finite(dab.y)
      || !finitePositive(dab.radius)
    ) {
      return Object.freeze({ status: "rejected", reason: "invalid-input" });
    }
    const span = spanForDab(
      dab,
      input.documentWidth,
      input.documentHeight,
      tileSize,
      columns,
      rows,
    );
    if (span === "numeric-overflow") {
      return Object.freeze({ status: "rejected", reason: "numeric-overflow" });
    }
    const base = dabIndex * 4;
    if (span === null) {
      spans[base] = OUTSIDE_DOCUMENT;
      spans[base + 1] = OUTSIDE_DOCUMENT;
      spans[base + 2] = OUTSIDE_DOCUMENT;
      spans[base + 3] = OUTSIDE_DOCUMENT;
      continue;
    }
    const spanReferenceCount =
      (span[1] - span[0] + 1) * (span[3] - span[2] + 1);
    if (
      !Number.isSafeInteger(spanReferenceCount)
      || spanReferenceCount <= 0
      || !Number.isSafeInteger(referenceCount + spanReferenceCount)
    ) {
      return Object.freeze({ status: "rejected", reason: "numeric-overflow" });
    }
    referenceCount += spanReferenceCount;
    if (referenceCount > maximumReferences) {
      return Object.freeze({ status: "rejected", reason: "reference-budget" });
    }
    spans.set(span, base);
  }

  return Object.freeze({
    status: "ready",
    plan: Object.freeze({
      kind: "studio-webgpu-dab-tile-span-plan",
      revision: STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_REVISION,
      documentWidth: input.documentWidth,
      documentHeight: input.documentHeight,
      tileSize,
      columns,
      rows,
      tileCount,
      dabCount: input.dabs.length,
      referenceCount,
      spans,
    }),
  });
}

const COUNT_WGSL = /* wgsl */ `
struct Meta {
  dab_count: u32,
  columns: u32,
  tile_count: u32,
  reference_count: u32,
};

@group(0) @binding(0) var<storage, read> spans: array<vec4u>;
@group(0) @binding(1) var<storage, read_write> tile_counts: array<atomic<u32>>;
@group(0) @binding(2) var<uniform> config: Meta;

@compute @workgroup_size(${STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let dab_index = gid.x;
  if (dab_index >= config.dab_count) {
    return;
  }
  let span = spans[dab_index];
  if (span.x == ${OUTSIDE_DOCUMENT}u) {
    return;
  }
  var row = span.z;
  loop {
    var column = span.x;
    loop {
      let tile_index = row * config.columns + column;
      if (tile_index < config.tile_count) {
        atomicAdd(&tile_counts[tile_index], 1u);
      }
      if (column >= span.y) {
        break;
      }
      column += 1u;
    }
    if (row >= span.w) {
      break;
    }
    row += 1u;
  }
}
`;

const SCAN_WGSL = /* wgsl */ `
struct Meta {
  dab_count: u32,
  columns: u32,
  tile_count: u32,
  reference_count: u32,
};

@group(0) @binding(0) var<storage, read_write> tile_counts: array<atomic<u32>>;
@group(0) @binding(1) var<storage, read_write> tile_offsets: array<u32>;
@group(0) @binding(2) var<uniform> config: Meta;
var<workgroup> scratch: array<u32, ${STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_SCAN_ELEMENTS}>;

@compute @workgroup_size(${STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_WORKGROUP_SIZE})
fn main(@builtin(local_invocation_id) local_id: vec3u) {
  let lane = local_id.x;
  var index = lane;
  loop {
    if (index >= ${STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_SCAN_ELEMENTS}u) {
      break;
    }
    if (index < config.tile_count) {
      scratch[index] = atomicLoad(&tile_counts[index]);
    } else {
      scratch[index] = 0u;
    }
    index += ${STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_WORKGROUP_SIZE}u;
  }
  workgroupBarrier();

  var offset = 1u;
  var level_count = ${STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_SCAN_ELEMENTS / 2}u;
  loop {
    if (level_count == 0u) {
      break;
    }
    var operation = lane;
    loop {
      if (operation >= level_count) {
        break;
      }
      let left = offset * (2u * operation + 1u) - 1u;
      let right = offset * (2u * operation + 2u) - 1u;
      scratch[right] += scratch[left];
      operation += ${STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_WORKGROUP_SIZE}u;
    }
    offset *= 2u;
    level_count >>= 1u;
    workgroupBarrier();
  }

  if (lane == 0u) {
    scratch[${STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_SCAN_ELEMENTS - 1}u] = 0u;
  }
  workgroupBarrier();

  level_count = 1u;
  offset = ${STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_SCAN_ELEMENTS / 2}u;
  loop {
    if (level_count >= ${STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_SCAN_ELEMENTS}u) {
      break;
    }
    var operation = lane;
    loop {
      if (operation >= level_count) {
        break;
      }
      let left = offset * (2u * operation + 1u) - 1u;
      let right = offset * (2u * operation + 2u) - 1u;
      let temporary = scratch[left];
      scratch[left] = scratch[right];
      scratch[right] += temporary;
      operation += ${STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_WORKGROUP_SIZE}u;
    }
    level_count *= 2u;
    offset >>= 1u;
    workgroupBarrier();
  }

  index = lane;
  loop {
    if (index >= config.tile_count) {
      break;
    }
    tile_offsets[index] = scratch[index];
    index += ${STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_WORKGROUP_SIZE}u;
  }
  if (lane == 0u) {
    tile_offsets[config.tile_count] = config.reference_count;
  }
}
`;

const SCATTER_WGSL = /* wgsl */ `
struct Meta {
  dab_count: u32,
  columns: u32,
  tile_count: u32,
  reference_count: u32,
};

@group(0) @binding(0) var<storage, read> spans: array<vec4u>;
@group(0) @binding(1) var<storage, read> tile_offsets: array<u32>;
@group(0) @binding(2) var<storage, read_write> dab_indices: array<u32>;
@group(0) @binding(3) var<uniform> config: Meta;

var<workgroup> inclusive: array<u32, ${STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_WORKGROUP_SIZE}>;
var<workgroup> output_cursor: u32;

fn span_contains_tile(span: vec4u, tile_index: u32) -> bool {
  if (span.x == ${OUTSIDE_DOCUMENT}u) {
    return false;
  }
  let row = tile_index / config.columns;
  let column = tile_index - row * config.columns;
  return column >= span.x
    && column <= span.y
    && row >= span.z
    && row <= span.w;
}

@compute @workgroup_size(${STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_WORKGROUP_SIZE})
fn main(
  @builtin(workgroup_id) group_id: vec3u,
  @builtin(local_invocation_id) local_id: vec3u,
) {
  let tile_index = group_id.x;
  let lane = local_id.x;
  if (tile_index >= config.tile_count) {
    return;
  }
  if (lane == 0u) {
    output_cursor = 0u;
  }
  workgroupBarrier();

  var chunk_start = 0u;
  loop {
    if (chunk_start >= config.dab_count) {
      break;
    }
    let dab_index = chunk_start + lane;
    var hit = false;
    if (dab_index < config.dab_count) {
      hit = span_contains_tile(spans[dab_index], tile_index);
    }
    inclusive[lane] = select(0u, 1u, hit);
    workgroupBarrier();

    var stride = 1u;
    loop {
      if (stride >= ${STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_WORKGROUP_SIZE}u) {
        break;
      }
      var addition = 0u;
      if (lane >= stride) {
        addition = inclusive[lane - stride];
      }
      workgroupBarrier();
      inclusive[lane] += addition;
      workgroupBarrier();
      stride *= 2u;
    }

    let chunk_count =
      inclusive[${STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_WORKGROUP_SIZE - 1}u];
    if (hit) {
      let local_offset = inclusive[lane] - 1u;
      let output_index =
        tile_offsets[tile_index] + output_cursor + local_offset;
      if (output_index < config.reference_count) {
        dab_indices[output_index] = dab_index;
      }
    }
    workgroupBarrier();
    if (lane == 0u) {
      output_cursor += chunk_count;
    }
    workgroupBarrier();
    chunk_start += ${STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_WORKGROUP_SIZE}u;
  }
}
`;

export const STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_WGSL = Object.freeze({
  count: COUNT_WGSL,
  scan: SCAN_WGSL,
  scatter: SCATTER_WGSL,
});

interface Buffers {
  readonly spans: GPUBuffer;
  readonly counts: GPUBuffer;
  readonly offsets: GPUBuffer;
  readonly indices: GPUBuffer;
  readonly uniform: GPUBuffer;
  readonly countBindGroup: GPUBindGroup;
  readonly scanBindGroup: GPUBindGroup;
  readonly scatterBindGroup: GPUBindGroup;
}

interface Capacities {
  readonly dabs: number;
  readonly tiles: number;
  readonly references: number;
}

function createStorageBuffer(
  device: GPUDevice,
  label: string,
  size: number,
  usage: number,
): GPUBuffer {
  return device.createBuffer({
    label,
    size: Math.max(4, size),
    usage,
  });
}

export function createStudioWebGpuDabTileBinningComputeRuntime(
  options: StudioWebGpuDabTileBinningComputeRuntimeOptions,
): StudioWebGpuDabTileBinningComputeCreationResult {
  try {
    if (
      typeof options !== "object"
      || options === null
      || !options.device
      || typeof options.device.createComputePipeline !== "function"
      || typeof options.device.pushErrorScope !== "function"
      || typeof options.device.popErrorScope !== "function"
      || !positiveSafeInteger(options.initialDeviceEpoch ?? 1)
      || !options.device.limits
      || options.device.limits.maxComputeInvocationsPerWorkgroup
        < STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_WORKGROUP_SIZE
      || options.device.limits.maxComputeWorkgroupSizeX
        < STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_WORKGROUP_SIZE
      || options.device.limits.maxComputeWorkgroupStorageSize
        < STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_SCAN_ELEMENTS
          * Uint32Array.BYTES_PER_ELEMENT
    ) return Object.freeze({ status: "rejected", reason: "invalid-options" });
    const limits = validateLimits(options);
    if (!limits) {
      return Object.freeze({ status: "rejected", reason: "invalid-options" });
    }
    return Object.freeze({
      status: "ready",
      runtime: new StudioWebGpuDabTileBinningComputeRuntime(options, limits),
    });
  } catch {
    return Object.freeze({
      status: "rejected",
      reason: "initialization-failed",
    });
  }
}

export class StudioWebGpuDabTileBinningComputeRuntime {
  readonly #device: GPUDevice;
  readonly #ownsDevice: boolean;
  readonly #limits: ValidatedLimits;
  readonly #countPipeline: GPUComputePipeline;
  readonly #scanPipeline: GPUComputePipeline;
  readonly #scatterPipeline: GPUComputePipeline;
  #deviceEpoch: number;
  #buffers: Buffers | null = null;
  #capacities: Capacities = { dabs: 0, tiles: 0, references: 0 };
  #bufferAllocationEpoch = 0;
  #executions = 0;
  #lastRequestSequence = 0;
  #busy = false;
  #disposed = false;
  #lost = false;
  #failed = false;
  readonly #metadataStaging = new Uint32Array(4);

  public constructor(
    options: StudioWebGpuDabTileBinningComputeRuntimeOptions,
    limits: ValidatedLimits,
  ) {
    this.#device = options.device;
    this.#ownsDevice = options.ownsDevice ?? false;
    this.#limits = limits;
    this.#deviceEpoch = options.initialDeviceEpoch ?? 1;
    const countModule = this.#device.createShaderModule({
      label: "Studio dab tile binning count",
      code: COUNT_WGSL,
    });
    const scanModule = this.#device.createShaderModule({
      label: "Studio dab tile binning exclusive scan",
      code: SCAN_WGSL,
    });
    const scatterModule = this.#device.createShaderModule({
      label: "Studio dab tile binning stable scatter",
      code: SCATTER_WGSL,
    });
    this.#countPipeline = this.#device.createComputePipeline({
      label: "Studio dab tile binning count pipeline",
      layout: "auto",
      compute: { module: countModule, entryPoint: "main" },
    });
    this.#scanPipeline = this.#device.createComputePipeline({
      label: "Studio dab tile binning scan pipeline",
      layout: "auto",
      compute: { module: scanModule, entryPoint: "main" },
    });
    this.#scatterPipeline = this.#device.createComputePipeline({
      label: "Studio dab tile binning stable scatter pipeline",
      layout: "auto",
      compute: { module: scatterModule, entryPoint: "main" },
    });
    void this.#device.lost.then((info) => {
      if (this.#disposed) return;
      this.#lost = true;
      this.#deviceEpoch += 1;
      options.onDeviceLost?.(info);
    });
  }

  public get deviceEpoch(): number {
    return this.#deviceEpoch;
  }

  public stats(): Readonly<StudioWebGpuDabTileBinningComputeRuntimeStats> {
    return Object.freeze({
      status: this.#disposed
        ? "disposed"
        : this.#lost
          ? "device-lost"
          : this.#failed
            ? "failed"
            : this.#busy
              ? "busy"
              : "ready",
      deviceEpoch: this.#deviceEpoch,
      executions: this.#executions,
      spanCapacity: this.#capacities.dabs,
      tileCapacity: this.#capacities.tiles,
      referenceCapacity: this.#capacities.references,
      bufferAllocationEpoch: this.#bufferAllocationEpoch,
    });
  }

  #destroyBuffers(): void {
    if (!this.#buffers) return;
    this.#buffers.spans.destroy();
    this.#buffers.counts.destroy();
    this.#buffers.offsets.destroy();
    this.#buffers.indices.destroy();
    this.#buffers.uniform.destroy();
    this.#buffers = null;
  }

  #ensureBuffers(plan: StudioWebGpuDabTileSpanPlan): Buffers {
    if (
      this.#buffers
      && this.#capacities.dabs >= plan.dabCount
      && this.#capacities.tiles >= plan.tileCount
      && this.#capacities.references >= plan.referenceCount
    ) return this.#buffers;
    this.#destroyBuffers();
    const capacities: Capacities = {
      dabs: nextPowerOfTwoCapacity(plan.dabCount, this.#limits.maximumDabs),
      tiles: nextPowerOfTwoCapacity(plan.tileCount, this.#limits.maximumTiles),
      references: nextPowerOfTwoCapacity(
        Math.max(1, plan.referenceCount),
        this.#limits.maximumReferences,
      ),
    };
    const spans = createStorageBuffer(
      this.#device,
      "Studio dab tile spans",
      capacities.dabs * 4 * Uint32Array.BYTES_PER_ELEMENT,
      GPU_BUFFER_STORAGE | GPU_BUFFER_COPY_DST,
    );
    const counts = createStorageBuffer(
      this.#device,
      "Studio dab tile counts",
      capacities.tiles * Uint32Array.BYTES_PER_ELEMENT,
      GPU_BUFFER_STORAGE | GPU_BUFFER_COPY_DST,
    );
    const offsets = createStorageBuffer(
      this.#device,
      "Studio dab tile offsets",
      (capacities.tiles + 1) * Uint32Array.BYTES_PER_ELEMENT,
      GPU_BUFFER_STORAGE | GPU_BUFFER_COPY_SRC | GPU_BUFFER_COPY_DST,
    );
    const indices = createStorageBuffer(
      this.#device,
      "Studio dab tile stable indices",
      capacities.references * Uint32Array.BYTES_PER_ELEMENT,
      GPU_BUFFER_STORAGE | GPU_BUFFER_COPY_SRC | GPU_BUFFER_COPY_DST,
    );
    const uniform = createStorageBuffer(
      this.#device,
      "Studio dab tile binning metadata",
      4 * Uint32Array.BYTES_PER_ELEMENT,
      GPU_BUFFER_UNIFORM | GPU_BUFFER_COPY_DST,
    );
    this.#buffers = {
      spans,
      counts,
      offsets,
      indices,
      uniform,
      countBindGroup: this.#device.createBindGroup({
        label: "Studio dab tile count bindings",
        layout: this.#countPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: spans } },
          { binding: 1, resource: { buffer: counts } },
          { binding: 2, resource: { buffer: uniform } },
        ],
      }),
      scanBindGroup: this.#device.createBindGroup({
        label: "Studio dab tile scan bindings",
        layout: this.#scanPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: counts } },
          { binding: 1, resource: { buffer: offsets } },
          { binding: 2, resource: { buffer: uniform } },
        ],
      }),
      scatterBindGroup: this.#device.createBindGroup({
        label: "Studio dab tile stable scatter bindings",
        layout: this.#scatterPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: spans } },
          { binding: 1, resource: { buffer: offsets } },
          { binding: 2, resource: { buffer: indices } },
          { binding: 3, resource: { buffer: uniform } },
        ],
      }),
    };
    this.#capacities = capacities;
    this.#bufferAllocationEpoch += 1;
    return this.#buffers;
  }

  async #readback(
    encoder: GPUCommandEncoder,
    buffers: Buffers,
    plan: StudioWebGpuDabTileSpanPlan,
  ): Promise<Readonly<StudioWebGpuDabTileBinningComputeReadback>> {
    const offsetBytes = (plan.tileCount + 1) * Uint32Array.BYTES_PER_ELEMENT;
    const indexBytes = Math.max(
      Uint32Array.BYTES_PER_ELEMENT,
      plan.referenceCount * Uint32Array.BYTES_PER_ELEMENT,
    );
    const offsetsReadback = this.#device.createBuffer({
      label: "Studio dab tile offsets readback",
      size: offsetBytes,
      usage: GPU_BUFFER_MAP_READ | GPU_BUFFER_COPY_DST,
    });
    const indicesReadback = this.#device.createBuffer({
      label: "Studio dab tile indices readback",
      size: indexBytes,
      usage: GPU_BUFFER_MAP_READ | GPU_BUFFER_COPY_DST,
    });
    encoder.copyBufferToBuffer(
      buffers.offsets,
      0,
      offsetsReadback,
      0,
      offsetBytes,
    );
    if (plan.referenceCount > 0) {
      encoder.copyBufferToBuffer(
        buffers.indices,
        0,
        indicesReadback,
        0,
        plan.referenceCount * Uint32Array.BYTES_PER_ELEMENT,
      );
    }
    this.#device.queue.submit([encoder.finish()]);
    try {
      await Promise.all([
        offsetsReadback.mapAsync(GPU_MAP_READ),
        indicesReadback.mapAsync(GPU_MAP_READ),
      ]);
      const tileOffsets = new Uint32Array(
        offsetsReadback.getMappedRange().slice(0),
      );
      const dabIndices = plan.referenceCount === 0
        ? new Uint32Array()
        : new Uint32Array(
            indicesReadback
              .getMappedRange()
              .slice(0, plan.referenceCount * Uint32Array.BYTES_PER_ELEMENT),
          );
      return Object.freeze({ tileOffsets, dabIndices });
    } finally {
      try {
        offsetsReadback.unmap();
      } catch {
        // A rejected map has no mapped range.
      }
      try {
        indicesReadback.unmap();
      } catch {
        // A rejected map has no mapped range.
      }
      offsetsReadback.destroy();
      indicesReadback.destroy();
    }
  }

  public async execute(
    requestSequence: number,
    input: StudioGpuDabTileBinningInput,
    options: Readonly<{ readback?: boolean; signal?: AbortSignal }> = {},
  ): Promise<StudioWebGpuDabTileBinningComputeExecutionResult> {
    if (this.#disposed) return Object.freeze({ status: "disposed" });
    if (this.#lost) {
      return Object.freeze({
        status: "device-lost",
        deviceEpoch: this.#deviceEpoch,
      });
    }
    if (this.#failed) {
      return Object.freeze({ status: "failed", reason: "gpu-error" });
    }
    if (options.signal?.aborted) return Object.freeze({ status: "cancelled" });
    if (
      !positiveSafeInteger(requestSequence)
      || requestSequence <= this.#lastRequestSequence
    ) {
      return Object.freeze({
        status: "rejected",
        reason: "request-sequence",
      });
    }
    if (this.#busy) return Object.freeze({ status: "busy" });

    const planned = planStudioWebGpuDabTileSpans(input, this.#limits);
    if (planned.status !== "ready") {
      return Object.freeze({ status: "rejected", reason: planned.reason });
    }
    const plan = planned.plan;
    this.#busy = true;
    this.#lastRequestSequence = requestSequence;
    let errorScopeDepth = 0;
    try {
      for (const filter of [
        "internal",
        "out-of-memory",
        "validation",
      ] as const satisfies readonly GPUErrorFilter[]) {
        this.#device.pushErrorScope(filter);
        errorScopeDepth += 1;
      }
      const buffers = this.#ensureBuffers(plan);
      this.#device.queue.writeBuffer(buffers.spans, 0, plan.spans);
      this.#metadataStaging[0] = plan.dabCount;
      this.#metadataStaging[1] = plan.columns;
      this.#metadataStaging[2] = plan.tileCount;
      this.#metadataStaging[3] = plan.referenceCount;
      this.#device.queue.writeBuffer(
        buffers.uniform,
        0,
        this.#metadataStaging,
      );

      const encoder = this.#device.createCommandEncoder({
        label: `Studio dab tile binning ${requestSequence}`,
      });
      encoder.clearBuffer(
        buffers.counts,
        0,
        plan.tileCount * Uint32Array.BYTES_PER_ELEMENT,
      );
      encoder.clearBuffer(
        buffers.offsets,
        0,
        (plan.tileCount + 1) * Uint32Array.BYTES_PER_ELEMENT,
      );
      if (plan.referenceCount > 0) {
        encoder.clearBuffer(
          buffers.indices,
          0,
          plan.referenceCount * Uint32Array.BYTES_PER_ELEMENT,
        );
      }

      if (plan.dabCount > 0) {
        const countPass = encoder.beginComputePass({
          label: "Studio dab tile count pass",
        });
        countPass.setPipeline(this.#countPipeline);
        countPass.setBindGroup(0, buffers.countBindGroup);
        countPass.dispatchWorkgroups(Math.ceil(
          plan.dabCount
            / STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_WORKGROUP_SIZE,
        ));
        countPass.end();
      }

      const scanPass = encoder.beginComputePass({
        label: "Studio dab tile exclusive scan pass",
      });
      scanPass.setPipeline(this.#scanPipeline);
      scanPass.setBindGroup(0, buffers.scanBindGroup);
      scanPass.dispatchWorkgroups(1);
      scanPass.end();

      if (plan.dabCount > 0 && plan.referenceCount > 0) {
        const scatterPass = encoder.beginComputePass({
          label: "Studio dab tile stable scatter pass",
        });
        scatterPass.setPipeline(this.#scatterPipeline);
        scatterPass.setBindGroup(0, buffers.scatterBindGroup);
        scatterPass.dispatchWorkgroups(plan.tileCount);
        scatterPass.end();
      }

      let readback: Readonly<StudioWebGpuDabTileBinningComputeReadback> | null;
      if (options.readback) {
        readback = await this.#readback(encoder, buffers, plan);
      } else {
        this.#device.queue.submit([encoder.finish()]);
        await this.#device.queue.onSubmittedWorkDone();
        readback = null;
      }
      const errors: Array<GPUError | null> = [];
      while (errorScopeDepth > 0) {
        errors.push(await this.#device.popErrorScope());
        errorScopeDepth -= 1;
      }
      if (errors.some((error) => error !== null)) {
        this.#failed = true;
        return Object.freeze({ status: "failed", reason: "gpu-error" });
      }
      if (this.#lost) {
        return Object.freeze({
          status: "device-lost",
          deviceEpoch: this.#deviceEpoch,
        });
      }
      this.#executions += 1;
      return Object.freeze({
        status: "completed",
        receipt: Object.freeze({
          kind: "studio-webgpu-dab-tile-binning-compute-receipt",
          revision: STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_REVISION,
          requestSequence,
          deviceEpoch: this.#deviceEpoch,
          tileCount: plan.tileCount,
          dabCount: plan.dabCount,
          referenceCount: plan.referenceCount,
          countDispatches: plan.dabCount > 0 ? 1 : 0,
          scanDispatches: 1,
          scatterDispatches:
            plan.dabCount > 0 && plan.referenceCount > 0 ? plan.tileCount : 0,
          queueState: "completed",
          complete: true,
        }),
        output: Object.freeze({
          tileOffsetsBuffer: buffers.offsets,
          dabIndicesBuffer: buffers.indices,
          tileCount: plan.tileCount,
          referenceCount: plan.referenceCount,
        }),
        readback,
      });
    } catch {
      while (errorScopeDepth > 0) {
        try {
          await this.#device.popErrorScope();
        } catch {
          // The runtime fails closed below.
        }
        errorScopeDepth -= 1;
      }
      this.#failed = true;
      return Object.freeze({ status: "failed", reason: "gpu-error" });
    } finally {
      this.#busy = false;
    }
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#destroyBuffers();
    this.#capacities = { dabs: 0, tiles: 0, references: 0 };
    if (this.#ownsDevice) this.#device.destroy();
  }
}

/** Exact parity helper for tests and promotion gates. */
export function studioWebGpuDabTileBinningMatchesCpuOracle(
  gpu: StudioWebGpuDabTileBinningComputeReadback,
  cpu: Readonly<StudioGpuDabTileBinningPlan>,
): boolean {
  if (
    gpu.tileOffsets.length !== cpu.tileOffsets.length
    || gpu.dabIndices.length !== cpu.dabIndices.length
  ) return false;
  for (let index = 0; index < gpu.tileOffsets.length; index += 1) {
    if (gpu.tileOffsets[index] !== cpu.tileOffsets[index]) return false;
  }
  for (let index = 0; index < gpu.dabIndices.length; index += 1) {
    if (gpu.dabIndices[index] !== cpu.dabIndices[index]) return false;
  }
  return true;
}
