/**
 * Future-only brush transaction coordinator.
 *
 * This boundary deliberately has no Canvas2D, WebGL, Konva or legacy-dab fallback. One complete
 * canonical command is lowered into the rich analytic WebGPU contract, submitted for presentation,
 * and only then offered to the RGBA16F tile authority. A WebGPU receipt proves queue submission,
 * not document authority or storage durability.
 */

import {
  hashStudioCanonicalBrushPlan,
  parseStudioCanonicalBrushPlan,
} from "../studio-canonical-brush-plan";
import {
  lowerStudioCanonicalBrushPlanToWebGpuDabs,
} from "../studio-canonical-brush-webgpu-lowering";

import {
  isStudioEngineVNextBrushProviderGpuPresentation,
  STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_GPU_BOUNDARY_VERSION,
} from "./studio-engine-vnext-brush-provider-gpu-boundary";
import {
  adaptLoweredStudioCanonicalBrushWebGpuDabs,
  fingerprintStudioEngineWebGpuBrushPlan,
  STUDIO_ENGINE_WEBGPU_BRUSH_COLOR_MODEL,
  STUDIO_ENGINE_WEBGPU_BRUSH_INPUT_COLOR_ENCODING,
  STUDIO_ENGINE_WEBGPU_BRUSH_PRESENTATION_COLOR_SPACE,
  STUDIO_ENGINE_WEBGPU_BRUSH_RECEIPT_REVISION,
  STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT,
  STUDIO_ENGINE_WEBGPU_BRUSH_WORKING_COLOR_SPACE,
} from "./studio-engine-webgpu-brush-runtime";

import type {
  StudioCanonicalBrushPlan,
  StudioCanonicalBrushPlanFailureReason,
} from "../studio-canonical-brush-plan";
import type {
  StudioCanonicalBrushSpecialistLoweringRequirement,
  StudioCanonicalBrushWebGpuLoweringResult,
} from "../studio-canonical-brush-webgpu-lowering";
import type {
  StudioEngineTileCommitFailureReason,
  StudioEngineTileCommitReceipt,
  StudioEngineTileCommitResult,
  StudioEngineTileDirtyRect,
} from "./studio-engine-tile-authority";
import type {
  StudioEngineVNextBrushProviderGpuBoundaryResult,
  StudioEngineVNextBrushProviderGpuExecutionBoundary,
  StudioEngineVNextBrushProviderGpuRequest,
} from "./studio-engine-vnext-brush-provider-gpu-boundary";
import type {
  StudioEngineWebGpuBrushExecutionRejection,
  StudioEngineWebGpuBrushExecutionResult,
  StudioEngineWebGpuBrushFrame,
  StudioEngineWebGpuBrushPlanAdaptationResult,
  StudioEngineWebGpuBrushRasterRect,
} from "./studio-engine-webgpu-brush-runtime";

export const STUDIO_ENGINE_FUTURE_BRUSH_CONTROLLER_VERSION = 1 as const;

const MAX_DIRTY_RECTS = 8_192;
const MAX_IDENTIFIER_CHARACTERS = 160;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$/u;

export interface StudioEngineFutureBrushGpuBoundary {
  execute(
    frame: StudioEngineWebGpuBrushFrame,
  ): Promise<StudioEngineWebGpuBrushExecutionResult> | StudioEngineWebGpuBrushExecutionResult;
  dispose?(): void;
}

export interface StudioEngineFutureBrushTileBoundary {
  commit(input: {
    readonly baseDocumentRevision: number;
    readonly baseLayerRevision: number;
    readonly layerId: string;
    readonly dirtyRects: readonly StudioEngineTileDirtyRect[];
    readonly brushPlan: unknown;
  }): Promise<StudioEngineTileCommitResult> | StudioEngineTileCommitResult;
  dispose?(): void;
}

export interface StudioEngineFutureBrushControllerOptions {
  readonly sessionEpoch: number;
  readonly strokeEpoch: number;
  readonly resizeEpoch: number;
  readonly deviceEpoch: number;
  readonly webGpu: StudioEngineFutureBrushGpuBoundary;
  /**
   * Optional exact specialist bridge. It is consulted only when the analytic lowerer explicitly
   * reports `lowering-required`; absence retains the original fail-closed rejection.
   */
  readonly specialistGpu?: StudioEngineVNextBrushProviderGpuExecutionBoundary;
  readonly tileAuthority: StudioEngineFutureBrushTileBoundary;
  readonly initialCommandSequence?: number;
  readonly initialGpuRequestSequence?: number;
  readonly maximumDabs?: number;
  readonly lower?: (
    plan: StudioCanonicalBrushPlan,
    options: { readonly maximumDabs?: number },
  ) => StudioCanonicalBrushWebGpuLoweringResult;
  readonly adapt?: (
    mode: "append" | "rebuild",
    lowering: StudioCanonicalBrushWebGpuLoweringResult,
    maximumDabs?: number,
  ) => StudioEngineWebGpuBrushPlanAdaptationResult;
}

export interface StudioEngineFutureBrushSubmission {
  readonly mode: "append" | "rebuild";
  readonly resizeEpoch: number;
  readonly deviceEpoch: number;
  readonly rasterRect: StudioEngineWebGpuBrushRasterRect;
  readonly layerId: string;
  readonly baseDocumentRevision: number;
  readonly baseLayerRevision: number;
  readonly dirtyRects: readonly StudioEngineTileDirtyRect[];
  /** Untrusted input. The canonical parser detaches and freezes it before either provider sees it. */
  readonly brushPlan: unknown;
}

export interface StudioEngineFutureBrushTileRevision {
  readonly tileId: string;
  readonly layerId: string;
  readonly column: number;
  readonly row: number;
  readonly baseTileRevision: number;
  readonly tileRevision: number;
  readonly contentDigest: string;
}

export interface StudioEngineFutureBrushReceipt {
  readonly kind: "studio-engine-future-brush-receipt";
  readonly version: typeof STUDIO_ENGINE_FUTURE_BRUSH_CONTROLLER_VERSION;
  readonly canonicalPlanHash: string;
  readonly commandSequence: number;
  readonly strokeId: string;
  readonly sessionEpoch: number;
  readonly strokeEpoch: number;
  readonly gpu: Readonly<{
    state: "submitted";
    requestSequence: number;
    resizeEpoch: number;
    deviceEpoch: number;
    planFingerprint: string;
    mode: "append" | "rebuild";
    loweringVersion: number;
    dabCount: number;
    batchCount: number;
  }>;
  readonly authority: Readonly<{
    state: "tile-authority-committed";
    documentId: string;
    baseDocumentRevision: number;
    documentRevision: number;
    layerId: string;
    baseLayerRevision: number;
    layerRevision: number;
    tileRevisions: readonly StudioEngineFutureBrushTileRevision[];
    journalSequence: number;
    journalDigest: string;
    journalByteLength: number;
    journalLogicalByteOffset: bigint;
  }>;
  /**
   * The Storage Worker has not acknowledged an OPFS append/checkpoint yet. This receipt must never
   * be interpreted as crash-durable storage.
   */
  readonly storageDurability: "awaiting-opfs-ack";
}

export type StudioEngineFutureBrushRejectionReason =
  | "canceled"
  | "command-sequence-conflict"
  | "command-sequence-gap"
  | "device-lost"
  | "disposed"
  | "gpu-receipt-mismatch"
  | "gpu-rejected"
  | "invalid-canonical-plan"
  | "invalid-request"
  | "lowering-rejected"
  | "request-sequence-exhausted"
  | "specialist-lowering-required"
  | "stale-command-sequence"
  | "stale-device-epoch"
  | "stale-resize-epoch"
  | "tile-authority-rejected"
  | "unsupported-webgpu-plan";

export type StudioEngineFutureBrushSubmissionResult =
  | Readonly<{
      status: "committed";
      receipt: StudioEngineFutureBrushReceipt;
    }>
  | Readonly<{
      status: "duplicate";
      receipt: StudioEngineFutureBrushReceipt;
    }>
  | Readonly<{
      status: "rejected";
      reason: StudioEngineFutureBrushRejectionReason;
      canonicalReason?: StudioCanonicalBrushPlanFailureReason;
      canonicalPath?: string;
      specialistRequirements?: readonly StudioCanonicalBrushSpecialistLoweringRequirement[];
      gpuReason?: StudioEngineWebGpuBrushExecutionRejection;
      tileReason?: StudioEngineTileCommitFailureReason;
    }>;

export type StudioEngineFutureBrushCancelResult =
  | Readonly<{ status: "canceled"; commandSequence: number }>
  | Readonly<{ status: "already-committed"; commandSequence: number }>
  | Readonly<{ status: "not-found"; commandSequence: number }>
  | Readonly<{ status: "too-late"; commandSequence: number }>
  | Readonly<{ status: "disposed"; commandSequence: number }>;

interface NormalizedSubmission {
  readonly mode: "append" | "rebuild";
  readonly resizeEpoch: number;
  readonly deviceEpoch: number;
  readonly rasterRect: StudioEngineWebGpuBrushRasterRect;
  readonly layerId: string;
  readonly baseDocumentRevision: number;
  readonly baseLayerRevision: number;
  readonly dirtyRects: readonly StudioEngineTileDirtyRect[];
  readonly plan: StudioCanonicalBrushPlan;
  /**
   * Current tile authority still validates the transport candidate form whose samples carry an
   * explicit authoritative role. This detached representation is derived only from `plan`.
   */
  readonly authorityCandidate: unknown;
  readonly canonicalPlanHash: string;
  readonly identity: string;
}

type JobStage = "queued" | "gpu" | "tile" | "done";

interface PendingJob {
  readonly commandSequence: number;
  canceled: boolean;
  stage: JobStage;
  specialistAbort: AbortController | null;
}

interface CachedReceipt {
  readonly identity: string;
  readonly receipt: StudioEngineFutureBrushReceipt;
}

interface InspectedRecord {
  readonly ok: true;
  readonly value: Record<string, unknown>;
}

interface InvalidRecord {
  readonly ok: false;
}

type RecordInspection = InspectedRecord | InvalidRecord;

type NormalizationResult =
  | Readonly<{ ok: true; value: NormalizedSubmission }>
  | Readonly<{
      ok: false;
      result: StudioEngineFutureBrushSubmissionResult;
      commandSequence: number | null;
    }>;

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function safeIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_IDENTIFIER_CHARACTERS
    && SAFE_IDENTIFIER.test(value);
}

function inspectExactRecord(input: unknown, fields: readonly string[]): RecordInspection {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false };
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return { ok: false };
  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== fields.length
    || keys.some((key) => typeof key !== "string" || !fields.includes(key))
  ) return { ok: false };
  const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(input, field);
    if (
      !descriptor
      || !Object.prototype.hasOwnProperty.call(descriptor, "value")
      || descriptor.enumerable !== true
    ) return { ok: false };
    values[field] = descriptor.value;
  }
  return { ok: true, value: values };
}

function inspectDenseArray(input: unknown, maximumLength: number): readonly unknown[] | null {
  if (!Array.isArray(input) || input.length > maximumLength) return null;
  const values: unknown[] = [];
  for (let index = 0; index < input.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(input, index)) return null;
    values.push(input[index]);
  }
  return values;
}

function finiteRect(input: unknown): StudioEngineTileDirtyRect | null {
  const inspected = inspectExactRecord(input, ["x", "y", "width", "height"]);
  if (!inspected.ok) return null;
  const { x, y, width, height } = inspected.value;
  if (
    typeof x !== "number"
    || typeof y !== "number"
    || typeof width !== "number"
    || typeof height !== "number"
    || !Number.isFinite(x)
    || !Number.isFinite(y)
    || !Number.isFinite(width)
    || !Number.isFinite(height)
    || width <= 0
    || height <= 0
  ) return null;
  return Object.freeze({ x, y, width, height });
}

function planCommandSequence(input: unknown): number | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptor = Object.getOwnPropertyDescriptor(input, "commandSequence");
  if (
    !descriptor
    || !Object.prototype.hasOwnProperty.call(descriptor, "value")
    || !positiveSafeInteger(descriptor.value)
  ) return null;
  return descriptor.value;
}

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    hash = Math.imul(hash ^ (code & 0xff), 0x01000193) >>> 0;
    hash = Math.imul(hash ^ (code >>> 8), 0x01000193) >>> 0;
  }
  return `fnv1a32-utf16:${hash.toString(16).padStart(8, "0")}`;
}

function submissionIdentity(input: Omit<NormalizedSubmission, "identity">): string {
  return hashText(JSON.stringify({
    canonicalPlanHash: input.canonicalPlanHash,
    mode: input.mode,
    resizeEpoch: input.resizeEpoch,
    deviceEpoch: input.deviceEpoch,
    rasterRect: input.rasterRect,
    layerId: input.layerId,
    baseDocumentRevision: input.baseDocumentRevision,
    baseLayerRevision: input.baseLayerRevision,
    dirtyRects: input.dirtyRects,
  }));
}

function tileAuthorityCandidate(plan: StudioCanonicalBrushPlan): unknown {
  return deepFreeze({
    ...plan,
    source: {
      ...plan.source,
      samples: plan.source.samples.map((sample) => ({
        role: "authoritative",
        ...sample,
      })),
    },
  });
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function reject(
  reason: StudioEngineFutureBrushRejectionReason,
  details: Omit<
  Extract<StudioEngineFutureBrushSubmissionResult, { status: "rejected" }>,
  "status" | "reason"
  > = {},
): StudioEngineFutureBrushSubmissionResult {
  return Object.freeze({ status: "rejected", reason, ...details });
}

function gpuReceiptMatches(
  result: Extract<StudioEngineWebGpuBrushExecutionResult, { status: "presented" }>,
  frame: StudioEngineWebGpuBrushFrame,
  expectedDeviceEpoch: number,
): boolean {
  const receipt = result.receipt;
  try {
    return receipt.kind === "studio-engine-webgpu-brush-receipt"
      && receipt.revision === STUDIO_ENGINE_WEBGPU_BRUSH_RECEIPT_REVISION
      && receipt.backend === "webgpu"
      && receipt.requestSequence === frame.requestSequence
      && receipt.resizeEpoch === frame.resizeEpoch
      && receipt.deviceEpoch === expectedDeviceEpoch
      && positiveSafeInteger(receipt.width)
      && positiveSafeInteger(receipt.height)
      && receipt.textureFormat === STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT
      && receipt.colorModel === STUDIO_ENGINE_WEBGPU_BRUSH_COLOR_MODEL
      && receipt.workingColorSpace === STUDIO_ENGINE_WEBGPU_BRUSH_WORKING_COLOR_SPACE
      && receipt.inputColorEncoding === STUDIO_ENGINE_WEBGPU_BRUSH_INPUT_COLOR_ENCODING
      && receipt.presentationColorSpace === STUDIO_ENGINE_WEBGPU_BRUSH_PRESENTATION_COLOR_SPACE
      && receipt.mode === frame.update.mode
      && receipt.strokeId === frame.update.strokeId
      && receipt.loweringVersion === frame.update.loweringVersion
      && receipt.dabCount === frame.update.dabs.length
      && receipt.batchCount === frame.update.batches.length
      && receipt.planFingerprint === fingerprintStudioEngineWebGpuBrushPlan(frame)
      && receipt.queueState === "submitted"
      && receipt.complete === true;
  } catch {
    return false;
  }
}

function combinedReceipt(
  input: NormalizedSubmission,
  gpuResult: Extract<StudioEngineWebGpuBrushExecutionResult, { status: "presented" }>,
  tileReceipt: StudioEngineTileCommitReceipt,
): StudioEngineFutureBrushReceipt {
  return deepFreeze({
    kind: "studio-engine-future-brush-receipt",
    version: STUDIO_ENGINE_FUTURE_BRUSH_CONTROLLER_VERSION,
    canonicalPlanHash: input.canonicalPlanHash,
    commandSequence: input.plan.commandSequence,
    strokeId: input.plan.strokeId,
    sessionEpoch: input.plan.sessionEpoch,
    strokeEpoch: input.plan.strokeEpoch,
    gpu: {
      state: "submitted",
      requestSequence: gpuResult.receipt.requestSequence,
      resizeEpoch: gpuResult.receipt.resizeEpoch,
      deviceEpoch: gpuResult.receipt.deviceEpoch,
      planFingerprint: gpuResult.receipt.planFingerprint,
      mode: gpuResult.receipt.mode,
      loweringVersion: gpuResult.receipt.loweringVersion,
      dabCount: gpuResult.receipt.dabCount,
      batchCount: gpuResult.receipt.batchCount,
    },
    authority: {
      state: "tile-authority-committed",
      documentId: tileReceipt.documentId,
      baseDocumentRevision: tileReceipt.baseDocumentRevision,
      documentRevision: tileReceipt.documentRevision,
      layerId: tileReceipt.layerId,
      baseLayerRevision: tileReceipt.baseLayerRevision,
      layerRevision: tileReceipt.layerRevision,
      tileRevisions: tileReceipt.tiles.map((tile) => ({
        tileId: tile.tileId,
        layerId: tile.layerId,
        column: tile.column,
        row: tile.row,
        baseTileRevision: tile.baseTileRevision,
        tileRevision: tile.tileRevision,
        contentDigest: tile.contentDigest,
      })),
      journalSequence: tileReceipt.journalSequence,
      journalDigest: tileReceipt.journalDigest,
      journalByteLength: tileReceipt.journalByteLength,
      journalLogicalByteOffset: tileReceipt.journalLogicalByteOffset,
    },
    storageDurability: "awaiting-opfs-ack",
  } satisfies StudioEngineFutureBrushReceipt);
}

/**
 * A single-lane transaction actor. GPU submission and tile commit for different commands can
 * never interleave, which gives command sequence, revision and cancellation checks one authority.
 */
export class StudioEngineFutureBrushController {
  private readonly sessionEpoch: number;
  private readonly strokeEpoch: number;
  private readonly resizeEpoch: number;
  private readonly deviceEpoch: number;
  private readonly webGpu: StudioEngineFutureBrushGpuBoundary;
  private readonly specialistGpu:
    | StudioEngineVNextBrushProviderGpuExecutionBoundary
    | null;
  private readonly tileAuthority: StudioEngineFutureBrushTileBoundary;
  private readonly maximumDabs: number | undefined;
  private readonly lower: NonNullable<StudioEngineFutureBrushControllerOptions["lower"]>;
  private readonly adapt: NonNullable<StudioEngineFutureBrushControllerOptions["adapt"]>;

  private lastCommittedCommandSequence: number;
  private lastGpuRequestSequence: number;
  private tail: Promise<void> = Promise.resolve();
  private receipts = new Map<number, CachedReceipt>();
  private pending = new Map<number, Set<PendingJob>>();
  private disposed = false;
  private deviceLost = false;

  public constructor(options: StudioEngineFutureBrushControllerOptions) {
    const initialCommandSequence = options.initialCommandSequence ?? 0;
    const initialGpuRequestSequence = options.initialGpuRequestSequence ?? 0;
    if (
      !positiveSafeInteger(options.sessionEpoch)
      || !positiveSafeInteger(options.strokeEpoch)
      || !positiveSafeInteger(options.resizeEpoch)
      || !positiveSafeInteger(options.deviceEpoch)
      || !nonNegativeSafeInteger(initialCommandSequence)
      || !nonNegativeSafeInteger(initialGpuRequestSequence)
      || (
        options.maximumDabs !== undefined
        && !positiveSafeInteger(options.maximumDabs)
      )
      || !options.webGpu
      || typeof options.webGpu.execute !== "function"
      || (
        options.specialistGpu !== undefined
        && (
          !options.specialistGpu
          || typeof options.specialistGpu.execute !== "function"
        )
      )
      || !options.tileAuthority
      || typeof options.tileAuthority.commit !== "function"
      || (options.lower !== undefined && typeof options.lower !== "function")
      || (options.adapt !== undefined && typeof options.adapt !== "function")
    ) {
      throw new TypeError("Future brush controller options are invalid.");
    }
    this.sessionEpoch = options.sessionEpoch;
    this.strokeEpoch = options.strokeEpoch;
    this.resizeEpoch = options.resizeEpoch;
    this.deviceEpoch = options.deviceEpoch;
    this.webGpu = options.webGpu;
    this.specialistGpu = options.specialistGpu ?? null;
    this.tileAuthority = options.tileAuthority;
    this.maximumDabs = options.maximumDabs;
    this.lower = options.lower ?? lowerStudioCanonicalBrushPlanToWebGpuDabs;
    this.adapt = options.adapt ?? adaptLoweredStudioCanonicalBrushWebGpuDabs;
    this.lastCommittedCommandSequence = initialCommandSequence;
    this.lastGpuRequestSequence = initialGpuRequestSequence;
  }

  public submit(input: unknown): Promise<StudioEngineFutureBrushSubmissionResult> {
    const normalized = this.normalize(input);
    if (!normalized.ok) return Promise.resolve(normalized.result);
    const job: PendingJob = {
      commandSequence: normalized.value.plan.commandSequence,
      canceled: false,
      stage: "queued",
      specialistAbort: null,
    };
    this.register(job);
    const run = this.tail.then(
      () => this.submitSerial(normalized.value, job),
      () => this.submitSerial(normalized.value, job),
    );
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run.finally(() => this.unregister(job));
  }

  public cancel(commandSequence: number): StudioEngineFutureBrushCancelResult {
    if (!positiveSafeInteger(commandSequence)) {
      return Object.freeze({ status: "not-found", commandSequence });
    }
    if (this.disposed) return Object.freeze({ status: "disposed", commandSequence });
    if (this.receipts.has(commandSequence)) {
      return Object.freeze({ status: "already-committed", commandSequence });
    }
    const jobs = this.pending.get(commandSequence);
    if (!jobs || jobs.size === 0) {
      return Object.freeze({ status: "not-found", commandSequence });
    }
    if ([...jobs].some((job) => job.stage === "tile")) {
      return Object.freeze({ status: "too-late", commandSequence });
    }
    for (const job of jobs) {
      job.canceled = true;
      job.specialistAbort?.abort(new Error("Specialist GPU request cancelled."));
    }
    return Object.freeze({ status: "canceled", commandSequence });
  }

  /** Marks this device generation terminal. Recovery creates a new controller/runtime generation. */
  public notifyDeviceLost(): void {
    if (this.disposed || this.deviceLost) return;
    this.deviceLost = true;
    for (const jobs of this.pending.values()) {
      for (const job of jobs) {
        if (job.stage !== "tile" && job.stage !== "done") {
          job.canceled = true;
          job.specialistAbort?.abort(new Error("Specialist GPU device lost."));
        }
      }
    }
    try {
      const notification = this.specialistGpu?.notifyDeviceLoss?.(
        "future-brush-controller-device-lost",
      );
      if (notification) void Promise.resolve(notification).catch(() => undefined);
    } catch {
      // The specialist provider is already terminal.
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const jobs of this.pending.values()) {
      for (const job of jobs) {
        if (job.stage !== "done") {
          job.canceled = true;
          job.specialistAbort?.abort(new Error("Specialist GPU boundary disposed."));
        }
      }
    }
    this.receipts = new Map();
    try {
      this.webGpu.dispose?.();
    } catch {
      // The provider boundary is already terminal.
    }
    try {
      const disposal = this.specialistGpu?.dispose?.();
      if (disposal) void Promise.resolve(disposal).catch(() => undefined);
    } catch {
      // The specialist provider boundary is already terminal.
    }
    try {
      this.tileAuthority.dispose?.();
    } catch {
      // The document authority is already terminal.
    }
  }

  private async submitSerial(
    input: NormalizedSubmission,
    job: PendingJob,
  ): Promise<StudioEngineFutureBrushSubmissionResult> {
    if (this.disposed) return reject("disposed");
    if (this.deviceLost) return reject("device-lost");
    if (job.canceled) return reject("canceled");

    const commandSequence = input.plan.commandSequence;
    const seen = this.receipts.get(commandSequence);
    if (seen) {
      return seen.identity === input.identity
        ? Object.freeze({ status: "duplicate", receipt: seen.receipt })
        : reject("command-sequence-conflict");
    }
    if (commandSequence <= this.lastCommittedCommandSequence) {
      return reject("stale-command-sequence");
    }
    if (commandSequence !== this.lastCommittedCommandSequence + 1) {
      return reject("command-sequence-gap");
    }
    if (input.resizeEpoch !== this.resizeEpoch) return reject("stale-resize-epoch");
    if (input.deviceEpoch !== this.deviceEpoch) return reject("stale-device-epoch");

    let lowering: StudioCanonicalBrushWebGpuLoweringResult;
    try {
      lowering = this.lower(input.plan, { maximumDabs: this.maximumDabs });
    } catch {
      return reject("lowering-rejected");
    }
    if (lowering.status === "rejected") return reject("lowering-rejected");

    let gpuResult: StudioEngineWebGpuBrushExecutionResult;
    if (lowering.status === "lowering-required") {
      if (!this.specialistGpu) {
        return reject("specialist-lowering-required", {
          specialistRequirements: Object.freeze([...lowering.requirements]),
        });
      }
      if (this.lastGpuRequestSequence >= Number.MAX_SAFE_INTEGER) {
        return reject("request-sequence-exhausted");
      }
      const requestSequence = this.lastGpuRequestSequence + 1;
      this.lastGpuRequestSequence = requestSequence;
      const specialistRequest = Object.freeze({
        kind: "studio-engine-vnext-brush-provider-gpu/request",
        version: STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_GPU_BOUNDARY_VERSION,
        requestSequence,
        sessionEpoch: input.plan.sessionEpoch,
        strokeEpoch: input.plan.strokeEpoch,
        deviceEpoch: input.deviceEpoch,
        resizeEpoch: input.resizeEpoch,
        mode: input.mode,
        rasterRect: input.rasterRect,
        strokeId: input.plan.strokeId,
        canonicalPlanHash: input.canonicalPlanHash,
        requirements: Object.freeze([...lowering.requirements]),
        canonicalPlan: input.plan,
      } satisfies StudioEngineVNextBrushProviderGpuRequest);
      const abortController = new AbortController();
      job.specialistAbort = abortController;
      job.stage = "gpu";
      let specialistResult: StudioEngineVNextBrushProviderGpuBoundaryResult;
      try {
        specialistResult = await this.specialistGpu.execute(
          specialistRequest,
          abortController.signal,
        );
      } catch {
        if (this.disposed) return reject("disposed");
        if (this.deviceLost) return reject("device-lost");
        if (job.canceled) return reject("canceled");
        return reject("gpu-rejected");
      } finally {
        job.specialistAbort = null;
      }
      if (this.disposed) return reject("disposed");
      if (this.deviceLost) return reject("device-lost");
      if (job.canceled) return reject("canceled");
      if (specialistResult.status === "rejected") {
        if (specialistResult.reason === "device-lost") {
          this.notifyDeviceLost();
          return reject("device-lost");
        }
        if (specialistResult.reason === "cancelled") return reject("canceled");
        if (
          specialistResult.reason === "provider-proof-mismatch"
          || specialistResult.reason === "invalid-provider-output"
        ) {
          return reject("gpu-receipt-mismatch");
        }
        return reject("gpu-rejected");
      }
      if (!isStudioEngineVNextBrushProviderGpuPresentation(
        specialistResult,
        specialistRequest,
      )) {
        return reject("gpu-receipt-mismatch");
      }
      gpuResult = Object.freeze({
        status: "presented",
        receipt: specialistResult.receipt,
      });
    } else {
      let adapted: StudioEngineWebGpuBrushPlanAdaptationResult;
      try {
        adapted = this.adapt(input.mode, lowering, this.maximumDabs);
      } catch {
        return reject("unsupported-webgpu-plan");
      }
      if (adapted.status === "lowering-required") {
        return reject("specialist-lowering-required", {
          specialistRequirements: Object.freeze([...adapted.requirements]),
        });
      }
      if (adapted.status !== "ready") return reject("unsupported-webgpu-plan");
      if (this.lastGpuRequestSequence >= Number.MAX_SAFE_INTEGER) {
        return reject("request-sequence-exhausted");
      }
      const requestSequence = this.lastGpuRequestSequence + 1;
      this.lastGpuRequestSequence = requestSequence;
      const frame: StudioEngineWebGpuBrushFrame = Object.freeze({
        requestSequence,
        resizeEpoch: input.resizeEpoch,
        rasterRect: input.rasterRect,
        update: adapted.plan,
      });

      job.stage = "gpu";
      try {
        gpuResult = await this.webGpu.execute(frame);
      } catch {
        return reject("gpu-rejected");
      }
      if (this.disposed) return reject("disposed");
      if (this.deviceLost) return reject("device-lost");
      if (job.canceled) return reject("canceled");
      if (gpuResult.status === "rejected") {
        if (gpuResult.reason === "device-lost") this.deviceLost = true;
        return reject(
          gpuResult.reason === "device-lost" ? "device-lost" : "gpu-rejected",
          { gpuReason: gpuResult.reason },
        );
      }
      if (!gpuReceiptMatches(gpuResult, frame, input.deviceEpoch)) {
        return reject("gpu-receipt-mismatch");
      }
    }

    job.stage = "tile";
    let tileResult: StudioEngineTileCommitResult;
    try {
      tileResult = await this.tileAuthority.commit({
        baseDocumentRevision: input.baseDocumentRevision,
        baseLayerRevision: input.baseLayerRevision,
        layerId: input.layerId,
        dirtyRects: input.dirtyRects,
        brushPlan: input.authorityCandidate,
      });
    } catch {
      return reject("tile-authority-rejected");
    }
    if (this.disposed) return reject("disposed");
    if (tileResult.status === "rejected") {
      return reject("tile-authority-rejected", { tileReason: tileResult.reason });
    }

    const receipt = combinedReceipt(input, gpuResult, tileResult.receipt);
    this.receipts.set(commandSequence, Object.freeze({
      identity: input.identity,
      receipt,
    }));
    this.lastCommittedCommandSequence = commandSequence;
    job.stage = "done";
    return Object.freeze({
      status: tileResult.status === "duplicate" ? "duplicate" : "committed",
      receipt,
    });
  }

  private normalize(input: unknown): NormalizationResult {
    const inspected = inspectExactRecord(input, [
      "mode",
      "resizeEpoch",
      "deviceEpoch",
      "rasterRect",
      "layerId",
      "baseDocumentRevision",
      "baseLayerRevision",
      "dirtyRects",
      "brushPlan",
    ]);
    if (!inspected.ok) {
      return { ok: false, result: reject("invalid-request"), commandSequence: null };
    }
    const value = inspected.value;
    const commandSequence = planCommandSequence(value.brushPlan);
    if (
      (value.mode !== "append" && value.mode !== "rebuild")
      || !positiveSafeInteger(value.resizeEpoch)
      || !positiveSafeInteger(value.deviceEpoch)
      || !safeIdentifier(value.layerId)
      || !nonNegativeSafeInteger(value.baseDocumentRevision)
      || !nonNegativeSafeInteger(value.baseLayerRevision)
      || commandSequence === null
    ) {
      return { ok: false, result: reject("invalid-request"), commandSequence };
    }
    const rasterRect = finiteRect(value.rasterRect);
    const rawDirtyRects = inspectDenseArray(value.dirtyRects, MAX_DIRTY_RECTS);
    if (!rasterRect || !rawDirtyRects || rawDirtyRects.length === 0) {
      return { ok: false, result: reject("invalid-request"), commandSequence };
    }
    const dirtyRects: StudioEngineTileDirtyRect[] = [];
    for (const raw of rawDirtyRects) {
      const rect = finiteRect(raw);
      if (!rect) return { ok: false, result: reject("invalid-request"), commandSequence };
      dirtyRects.push(rect);
    }
    const parsed = parseStudioCanonicalBrushPlan(value.brushPlan, {
      sessionEpoch: this.sessionEpoch,
      strokeEpoch: this.strokeEpoch,
      lastAcceptedCommandSequence: commandSequence - 1,
    });
    if (!parsed.ok) {
      return {
        ok: false,
        commandSequence,
        result: reject("invalid-canonical-plan", {
          canonicalReason: parsed.reason,
          canonicalPath: parsed.path,
        }),
      };
    }
    const partial = {
      mode: value.mode,
      resizeEpoch: value.resizeEpoch,
      deviceEpoch: value.deviceEpoch,
      rasterRect,
      layerId: value.layerId,
      baseDocumentRevision: value.baseDocumentRevision,
      baseLayerRevision: value.baseLayerRevision,
      dirtyRects: Object.freeze(dirtyRects),
      plan: parsed.value.plan,
      authorityCandidate: tileAuthorityCandidate(parsed.value.plan),
      canonicalPlanHash: hashStudioCanonicalBrushPlan(parsed.value.plan),
    } satisfies Omit<NormalizedSubmission, "identity">;
    return {
      ok: true,
      value: Object.freeze({
        ...partial,
        identity: submissionIdentity(partial),
      }),
    };
  }

  private register(job: PendingJob): void {
    const existing = this.pending.get(job.commandSequence);
    if (existing) {
      existing.add(job);
      return;
    }
    this.pending.set(job.commandSequence, new Set([job]));
  }

  private unregister(job: PendingJob): void {
    const existing = this.pending.get(job.commandSequence);
    if (!existing) return;
    existing.delete(job);
    if (existing.size === 0) this.pending.delete(job.commandSequence);
  }
}
