/**
 * Durable vNext brush transaction coordinator.
 *
 * `StudioEngineFutureBrushController` deliberately stops at GPU queue acceptance plus atomic
 * in-memory RGBA16F tile authority. This actor inserts an exact persistence boundary between the
 * tile commit and the future controller's acknowledgement. A public success receipt is produced
 * only after the Storage Worker v2 bridge has returned a complete, identity-matched OPFS ACK.
 *
 * There is no Canvas2D, WebGL, RGBA8 or legacy-command fallback.
 */

import {
  StudioEngineFutureBrushController,
} from "./studio-engine-future-brush-controller";
import {
  STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
  STUDIO_ENGINE_TILE_ENCODING,
} from "./studio-engine-tile-authority";
import {
  StudioEngineTileStorageBridgeError,
  STUDIO_ENGINE_TILE_STORAGE_PROTOCOL_VERSION,
} from "./studio-engine-tile-storage-bridge";

import type {
  StudioEngineFutureBrushCancelResult,
  StudioEngineFutureBrushControllerOptions,
  StudioEngineFutureBrushGpuBoundary,
  StudioEngineFutureBrushReceipt,
  StudioEngineFutureBrushRejectionReason,
  StudioEngineFutureBrushSubmissionResult,
  StudioEngineFutureBrushTileRevision,
} from "./studio-engine-future-brush-controller";
import type {
  StudioEngineTileCommitReceipt,
  StudioEngineTileCommitResult,
} from "./studio-engine-tile-authority";
import type {
  StudioEngineTileStorageBridgeErrorCode,
  StudioEngineTileStorageDurableReceipt,
  StudioEngineTileStoragePersistOptions,
} from "./studio-engine-tile-storage-bridge";

export const STUDIO_ENGINE_DURABLE_BRUSH_CONTROLLER_VERSION = 1 as const;

type CommittedTileResult = Extract<
  StudioEngineTileCommitResult,
  { readonly status: "committed" }
>;

export interface StudioEngineDurableBrushAuthorityBoundary {
  commit(input: unknown): Promise<StudioEngineTileCommitResult> | StudioEngineTileCommitResult;
  journalRecord?(sequence: number): Uint8Array | null;
  dispose?(): Promise<void> | void;
}

export interface StudioEngineDurableBrushStorageBoundary {
  persist(
    committed: CommittedTileResult | unknown,
    options?: StudioEngineTileStoragePersistOptions,
  ): Promise<StudioEngineTileStorageDurableReceipt> | StudioEngineTileStorageDurableReceipt;
  dispose?(): Promise<void> | void;
}

export interface StudioEngineDurableBrushControllerOptions {
  readonly sessionEpoch: number;
  readonly strokeEpoch: number;
  readonly resizeEpoch: number;
  readonly deviceEpoch: number;
  readonly webGpu: StudioEngineFutureBrushGpuBoundary;
  readonly specialistGpu?: StudioEngineFutureBrushControllerOptions["specialistGpu"];
  readonly tileAuthority: StudioEngineDurableBrushAuthorityBoundary;
  readonly storage: StudioEngineDurableBrushStorageBoundary;
  readonly initialCommandSequence?: number;
  readonly initialGpuRequestSequence?: number;
  readonly maximumDabs?: number;
  readonly lower?: StudioEngineFutureBrushControllerOptions["lower"];
  readonly adapt?: StudioEngineFutureBrushControllerOptions["adapt"];
}

export interface StudioEngineDurableBrushReceipt {
  readonly kind: "studio-engine-durable-brush-receipt";
  readonly version: typeof STUDIO_ENGINE_DURABLE_BRUSH_CONTROLLER_VERSION;
  readonly canonicalPlanHash: string;
  readonly commandSequence: number;
  readonly strokeId: string;
  readonly sessionEpoch: number;
  readonly strokeEpoch: number;
  readonly gpu: StudioEngineFutureBrushReceipt["gpu"];
  readonly authority: Readonly<{
    state: "tile-authority-committed";
    authorityVersion: typeof STUDIO_ENGINE_TILE_AUTHORITY_VERSION;
    encoding: typeof STUDIO_ENGINE_TILE_ENCODING;
    documentId: string;
    commandIdentity: string;
    commandSequence: number;
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
  readonly storage: Readonly<{
    state: "opfs-v2-atomic-commit-acknowledged";
    protocolVersion: typeof STUDIO_ENGINE_TILE_STORAGE_PROTOCOL_VERSION;
    disposition: StudioEngineTileStorageDurableReceipt["disposition"];
    requestSequence: number;
    sessionEpoch: number;
    transactionSequence: number;
    transactionIdentity: string;
    durableRevision: number;
    documentId: string;
    commandIdentity: string;
    commandSequence: number;
    documentRevision: number;
    journalLogicalByteOffset: bigint;
    journalByteLength: number;
    journalPayloadChecksum: string;
    tileCount: number;
    totalPayloadBytes: bigint;
  }>;
  readonly storageDurability: "opfs-v2-durable";
}

export type StudioEngineDurableBrushRejectionReason =
  | StudioEngineFutureBrushRejectionReason
  | "durable-receipt-mismatch"
  | "storage-rejected";

export type StudioEngineDurableBrushSubmissionResult =
  | Readonly<{
      status: "committed" | "duplicate";
      receipt: StudioEngineDurableBrushReceipt;
    }>
  | Readonly<{
      status: "rejected";
      reason: StudioEngineDurableBrushRejectionReason;
      futureReason?: StudioEngineFutureBrushRejectionReason;
      storageCode?: StudioEngineTileStorageBridgeErrorCode | "unknown";
    }>;

export type StudioEngineDurableBrushJobStage =
  | "future"
  | "authority"
  | "storage"
  | "durable"
  | "done";

export interface StudioEngineDurableBrushControllerStats {
  readonly disposed: boolean;
  readonly activeSubmissions: number;
  readonly durableReceiptCount: number;
  readonly storageRetryBlocked: boolean;
  readonly activeStages: Readonly<Record<StudioEngineDurableBrushJobStage, number>>;
}

interface BoundaryFailure {
  readonly reason: "durable-receipt-mismatch" | "storage-rejected";
  readonly storageCode?: StudioEngineTileStorageBridgeErrorCode | "unknown";
}

interface DurableParts {
  readonly authority: StudioEngineTileCommitReceipt;
  readonly storage: StudioEngineTileStorageDurableReceipt;
}

interface PublicDurableReceipt {
  readonly canonicalPlanHash: string;
  readonly receipt: StudioEngineDurableBrushReceipt;
}

interface PendingJob {
  readonly commandSequence: number | null;
  stage: StudioEngineDurableBrushJobStage;
  failure: BoundaryFailure | null;
}

interface PersistingBoundaryOptions {
  readonly authority: StudioEngineDurableBrushAuthorityBoundary;
  readonly storage: StudioEngineDurableBrushStorageBoundary;
  readonly sessionEpoch: number;
  readonly onStage: (
    commandSequence: number,
    stage: "authority" | "storage" | "durable",
  ) => void;
  readonly onFailure: (commandSequence: number, failure: BoundaryFailure) => void;
  readonly onDurable: (commandSequence: number, parts: DurableParts) => void;
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function commandSequenceFromSubmission(input: unknown): number | null {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
    const brushDescriptor = Object.getOwnPropertyDescriptor(input, "brushPlan");
    if (!brushDescriptor || !Object.prototype.hasOwnProperty.call(brushDescriptor, "value")) {
      return null;
    }
    const brushPlan = brushDescriptor.value as unknown;
    if (typeof brushPlan !== "object" || brushPlan === null || Array.isArray(brushPlan)) return null;
    const sequenceDescriptor = Object.getOwnPropertyDescriptor(brushPlan, "commandSequence");
    const sequence = sequenceDescriptor
      && Object.prototype.hasOwnProperty.call(sequenceDescriptor, "value")
      ? sequenceDescriptor.value
      : null;
    return positiveSafeInteger(sequence) ? sequence : null;
  } catch {
    return null;
  }
}

function commandSequenceFromAuthorityInput(input: unknown): number | null {
  return commandSequenceFromSubmission({ brushPlan: (
    typeof input === "object" && input !== null
      ? Object.getOwnPropertyDescriptor(input, "brushPlan")?.value
      : null
  ) });
}

function sameTileReceipt(
  left: StudioEngineTileCommitReceipt["tiles"][number],
  right: StudioEngineTileCommitReceipt["tiles"][number],
): boolean {
  return left.tileId === right.tileId
    && left.column === right.column
    && left.row === right.row
    && left.layerId === right.layerId
    && left.layerIndex === right.layerIndex
    && left.logicalTileIndex === right.logicalTileIndex
    && left.logicalByteOffset === right.logicalByteOffset
    && left.shardIndex === right.shardIndex
    && left.shardByteOffset === right.shardByteOffset
    && left.baseTileRevision === right.baseTileRevision
    && left.tileRevision === right.tileRevision
    && left.contentDigest === right.contentDigest
    && left.byteLength === right.byteLength;
}

function sameAuthorityReceipt(
  left: StudioEngineTileCommitReceipt,
  right: StudioEngineTileCommitReceipt,
): boolean {
  return left.kind === right.kind
    && left.version === right.version
    && left.encoding === right.encoding
    && left.documentId === right.documentId
    && left.commandIdentity === right.commandIdentity
    && left.commandSequence === right.commandSequence
    && left.baseDocumentRevision === right.baseDocumentRevision
    && left.documentRevision === right.documentRevision
    && left.layerId === right.layerId
    && left.baseLayerRevision === right.baseLayerRevision
    && left.layerRevision === right.layerRevision
    && left.journalSequence === right.journalSequence
    && left.journalDigest === right.journalDigest
    && left.journalByteLength === right.journalByteLength
    && left.journalLogicalByteOffset === right.journalLogicalByteOffset
    && left.tiles.length === right.tiles.length
    && left.tiles.every((tile, index) => sameTileReceipt(tile, right.tiles[index]!));
}

function storageReceiptMatches(
  durable: StudioEngineTileStorageDurableReceipt,
  authority: StudioEngineTileCommitReceipt,
  sessionEpoch: number,
): boolean {
  try {
    const totalPayloadBytes = authority.tiles.reduce(
      (total, tile) => total + BigInt(tile.byteLength),
      BigInt(authority.journalByteLength),
    );
    return durable.kind === "studio-engine-tile-storage-durable-receipt"
      && durable.version === STUDIO_ENGINE_TILE_STORAGE_PROTOCOL_VERSION
      && (
        durable.disposition === "committed"
        || durable.disposition === "idempotent-replay"
      )
      && positiveSafeInteger(durable.requestSequence)
      && durable.sessionEpoch === sessionEpoch
      && durable.transactionSequence === authority.journalSequence
      && typeof durable.transactionIdentity === "string"
      && durable.transactionIdentity.length > 0
      && positiveSafeInteger(durable.durableRevision)
      && durable.documentId === authority.documentId
      && durable.commandIdentity === authority.commandIdentity
      && durable.commandSequence === authority.commandSequence
      && durable.documentRevision === authority.documentRevision
      && durable.journalLogicalByteOffset === authority.journalLogicalByteOffset
      && durable.journalByteLength === authority.journalByteLength
      && typeof durable.journalPayloadChecksum === "string"
      && durable.journalPayloadChecksum.length > 0
      && durable.tileCount === authority.tiles.length
      && durable.totalPayloadBytes === totalPayloadBytes;
  } catch {
    return false;
  }
}

function futureReceiptMatches(
  future: StudioEngineFutureBrushReceipt,
  authority: StudioEngineTileCommitReceipt,
  sessionEpoch: number,
  strokeEpoch: number,
): boolean {
  const futureAuthority = future.authority;
  return future.kind === "studio-engine-future-brush-receipt"
    && future.commandSequence === authority.commandSequence
    && future.sessionEpoch === sessionEpoch
    && future.strokeEpoch === strokeEpoch
    && future.storageDurability === "awaiting-opfs-ack"
    && futureAuthority.state === "tile-authority-committed"
    && futureAuthority.documentId === authority.documentId
    && futureAuthority.baseDocumentRevision === authority.baseDocumentRevision
    && futureAuthority.documentRevision === authority.documentRevision
    && futureAuthority.layerId === authority.layerId
    && futureAuthority.baseLayerRevision === authority.baseLayerRevision
    && futureAuthority.layerRevision === authority.layerRevision
    && futureAuthority.journalSequence === authority.journalSequence
    && futureAuthority.journalDigest === authority.journalDigest
    && futureAuthority.journalByteLength === authority.journalByteLength
    && futureAuthority.journalLogicalByteOffset === authority.journalLogicalByteOffset
    && futureAuthority.tileRevisions.length === authority.tiles.length
    && futureAuthority.tileRevisions.every((tile, index) => {
      const expected = authority.tiles[index]!;
      return tile.tileId === expected.tileId
        && tile.layerId === expected.layerId
        && tile.column === expected.column
        && tile.row === expected.row
        && tile.baseTileRevision === expected.baseTileRevision
        && tile.tileRevision === expected.tileRevision
        && tile.contentDigest === expected.contentDigest;
    });
}

function durableReceipt(
  future: StudioEngineFutureBrushReceipt,
  parts: DurableParts,
): StudioEngineDurableBrushReceipt {
  const authority = parts.authority;
  const storage = parts.storage;
  const tileRevisions = authority.tiles.map((tile) => Object.freeze({
    tileId: tile.tileId,
    layerId: tile.layerId,
    column: tile.column,
    row: tile.row,
    baseTileRevision: tile.baseTileRevision,
    tileRevision: tile.tileRevision,
    contentDigest: tile.contentDigest,
  }));
  return Object.freeze({
    kind: "studio-engine-durable-brush-receipt",
    version: STUDIO_ENGINE_DURABLE_BRUSH_CONTROLLER_VERSION,
    canonicalPlanHash: future.canonicalPlanHash,
    commandSequence: future.commandSequence,
    strokeId: future.strokeId,
    sessionEpoch: future.sessionEpoch,
    strokeEpoch: future.strokeEpoch,
    gpu: future.gpu,
    authority: Object.freeze({
      state: "tile-authority-committed",
      authorityVersion: STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
      encoding: STUDIO_ENGINE_TILE_ENCODING,
      documentId: authority.documentId,
      commandIdentity: authority.commandIdentity,
      commandSequence: authority.commandSequence,
      baseDocumentRevision: authority.baseDocumentRevision,
      documentRevision: authority.documentRevision,
      layerId: authority.layerId,
      baseLayerRevision: authority.baseLayerRevision,
      layerRevision: authority.layerRevision,
      tileRevisions: Object.freeze(tileRevisions),
      journalSequence: authority.journalSequence,
      journalDigest: authority.journalDigest,
      journalByteLength: authority.journalByteLength,
      journalLogicalByteOffset: authority.journalLogicalByteOffset,
    }),
    storage: Object.freeze({
      state: "opfs-v2-atomic-commit-acknowledged",
      protocolVersion: STUDIO_ENGINE_TILE_STORAGE_PROTOCOL_VERSION,
      disposition: storage.disposition,
      requestSequence: storage.requestSequence,
      sessionEpoch: storage.sessionEpoch,
      transactionSequence: storage.transactionSequence,
      transactionIdentity: storage.transactionIdentity,
      durableRevision: storage.durableRevision,
      documentId: storage.documentId,
      commandIdentity: storage.commandIdentity,
      commandSequence: storage.commandSequence,
      documentRevision: storage.documentRevision,
      journalLogicalByteOffset: storage.journalLogicalByteOffset,
      journalByteLength: storage.journalByteLength,
      journalPayloadChecksum: storage.journalPayloadChecksum,
      tileCount: storage.tileCount,
      totalPayloadBytes: storage.totalPayloadBytes,
    }),
    storageDurability: "opfs-v2-durable",
  });
}

function storageFailure(error: unknown): BoundaryFailure {
  if (error instanceof StudioEngineTileStorageBridgeError) {
    return Object.freeze({
      reason: "storage-rejected",
      storageCode: error.code,
    });
  }
  return Object.freeze({
    reason: "storage-rejected",
    storageCode: "unknown",
  });
}

class PersistingTileBoundary {
  private readonly authority: StudioEngineDurableBrushAuthorityBoundary;
  private readonly storage: StudioEngineDurableBrushStorageBoundary;
  private readonly sessionEpoch: number;
  private readonly onStage: PersistingBoundaryOptions["onStage"];
  private readonly onFailure: PersistingBoundaryOptions["onFailure"];
  private readonly onDurable: PersistingBoundaryOptions["onDurable"];
  private readonly committedBySequence = new Map<number, CommittedTileResult>();

  public constructor(options: PersistingBoundaryOptions) {
    this.authority = options.authority;
    this.storage = options.storage;
    this.sessionEpoch = options.sessionEpoch;
    this.onStage = options.onStage;
    this.onFailure = options.onFailure;
    this.onDurable = options.onDurable;
  }

  public async commit(input: unknown): Promise<StudioEngineTileCommitResult> {
    const commandSequence = commandSequenceFromAuthorityInput(input);
    if (!commandSequence) throw new TypeError("Durable tile command sequence is invalid.");
    this.onStage(commandSequence, "authority");
    const authorityResult = await this.authority.commit(input);
    if (authorityResult.status === "rejected") return authorityResult;

    let committed: CommittedTileResult;
    const cached = this.committedBySequence.get(commandSequence);
    if (authorityResult.status === "committed") {
      if (cached && !sameAuthorityReceipt(cached.receipt, authorityResult.receipt)) {
        const failure = Object.freeze<BoundaryFailure>({
          reason: "durable-receipt-mismatch",
        });
        this.onFailure(commandSequence, failure);
        throw new Error("Authority replay receipt changed.");
      }
      committed = authorityResult;
      this.committedBySequence.set(commandSequence, authorityResult);
    } else {
      if (cached) {
        if (!sameAuthorityReceipt(cached.receipt, authorityResult.receipt)) {
          const failure = Object.freeze<BoundaryFailure>({
            reason: "durable-receipt-mismatch",
          });
          this.onFailure(commandSequence, failure);
          throw new Error("Authority duplicate receipt does not match the committed result.");
        }
        committed = cached;
      } else {
        const journalBytes = this.authority.journalRecord?.(
          authorityResult.receipt.journalSequence,
        );
        if (
          !journalBytes
          || journalBytes.byteLength !== authorityResult.receipt.journalByteLength
        ) {
          const failure = Object.freeze<BoundaryFailure>({
            reason: "durable-receipt-mismatch",
          });
          this.onFailure(commandSequence, failure);
          throw new Error("Authority duplicate has no exact journal replay payload.");
        }
        committed = Object.freeze({
          status: "committed",
          receipt: authorityResult.receipt,
          journalBytes: new Uint8Array(journalBytes),
        });
        this.committedBySequence.set(commandSequence, committed);
      }
    }

    this.onStage(commandSequence, "storage");
    let storageReceipt: StudioEngineTileStorageDurableReceipt;
    try {
      storageReceipt = await this.storage.persist(committed);
    } catch (error) {
      const failure = storageFailure(error);
      this.onFailure(commandSequence, failure);
      throw error;
    }
    if (!storageReceiptMatches(storageReceipt, committed.receipt, this.sessionEpoch)) {
      const failure = Object.freeze<BoundaryFailure>({
        reason: "durable-receipt-mismatch",
      });
      this.onFailure(commandSequence, failure);
      throw new Error("Storage receipt does not match the tile authority commit.");
    }

    this.onDurable(commandSequence, Object.freeze({
      authority: committed.receipt,
      storage: storageReceipt,
    }));
    this.onStage(commandSequence, "durable");
    return authorityResult;
  }
}

function rejected(
  reason: StudioEngineDurableBrushRejectionReason,
  details: {
    readonly futureReason?: StudioEngineFutureBrushRejectionReason;
    readonly storageCode?: StudioEngineTileStorageBridgeErrorCode | "unknown";
  } = {},
): StudioEngineDurableBrushSubmissionResult {
  return Object.freeze({
    status: "rejected",
    reason,
    ...details,
  });
}

export class StudioEngineDurableBrushController {
  private readonly sessionEpoch: number;
  private readonly strokeEpoch: number;
  private readonly webGpu: StudioEngineFutureBrushGpuBoundary;
  private readonly specialistGpu:
    | NonNullable<StudioEngineFutureBrushControllerOptions["specialistGpu"]>
    | null;
  private readonly tileAuthority: StudioEngineDurableBrushAuthorityBoundary;
  private readonly storage: StudioEngineDurableBrushStorageBoundary;
  private readonly future: StudioEngineFutureBrushController;
  private readonly durableBySequence = new Map<number, DurableParts>();
  private readonly publicReceiptBySequence = new Map<number, PublicDurableReceipt>();
  private readonly pendingBySequence = new Map<number, Set<PendingJob>>();
  private readonly activePromises = new Set<Promise<unknown>>();

  private disposed = false;
  private disposePromise: Promise<void> | null = null;
  private storageRetryBlocked = false;

  public constructor(options: StudioEngineDurableBrushControllerOptions) {
    if (
      !positiveSafeInteger(options.sessionEpoch)
      || !positiveSafeInteger(options.strokeEpoch)
      || !positiveSafeInteger(options.resizeEpoch)
      || !positiveSafeInteger(options.deviceEpoch)
      || (
        options.initialCommandSequence !== undefined
        && !nonNegativeSafeInteger(options.initialCommandSequence)
      )
      || (
        options.initialGpuRequestSequence !== undefined
        && !nonNegativeSafeInteger(options.initialGpuRequestSequence)
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
      || !options.storage
      || typeof options.storage.persist !== "function"
    ) {
      throw new TypeError("Durable brush controller options are invalid.");
    }
    this.sessionEpoch = options.sessionEpoch;
    this.strokeEpoch = options.strokeEpoch;
    this.webGpu = options.webGpu;
    this.specialistGpu = options.specialistGpu ?? null;
    this.tileAuthority = options.tileAuthority;
    this.storage = options.storage;

    const boundary = new PersistingTileBoundary({
      authority: this.tileAuthority,
      storage: this.storage,
      sessionEpoch: this.sessionEpoch,
      onStage: (sequence, stage) => this.markStage(sequence, stage),
      onFailure: (sequence, failure) => this.recordFailure(sequence, failure),
      onDurable: (sequence, parts) => {
        this.durableBySequence.set(sequence, parts);
        this.storageRetryBlocked = false;
      },
    });
    this.future = new StudioEngineFutureBrushController({
      sessionEpoch: options.sessionEpoch,
      strokeEpoch: options.strokeEpoch,
      resizeEpoch: options.resizeEpoch,
      deviceEpoch: options.deviceEpoch,
      // Resource disposal is owned below so the async Storage Worker closes before authority/GPU.
      webGpu: {
        execute: (frame) => this.webGpu.execute(frame),
      },
      ...(this.specialistGpu
        ? {
          specialistGpu: {
            execute: (request, signal) => this.specialistGpu!.execute(
              request,
              signal,
            ),
            notifyDeviceLoss: (reason) => (
              this.specialistGpu!.notifyDeviceLoss?.(reason)
            ),
          },
        }
        : {}),
      tileAuthority: {
        commit: (input) => boundary.commit(input),
      },
      initialCommandSequence: options.initialCommandSequence,
      initialGpuRequestSequence: options.initialGpuRequestSequence,
      maximumDabs: options.maximumDabs,
      lower: options.lower,
      adapt: options.adapt,
    });
  }

  public stats(): StudioEngineDurableBrushControllerStats {
    const activeStages: Record<StudioEngineDurableBrushJobStage, number> = {
      future: 0,
      authority: 0,
      storage: 0,
      durable: 0,
      done: 0,
    };
    for (const jobs of this.pendingBySequence.values()) {
      for (const job of jobs) activeStages[job.stage] += 1;
    }
    return Object.freeze({
      disposed: this.disposed,
      activeSubmissions: this.activePromises.size,
      durableReceiptCount: this.publicReceiptBySequence.size,
      storageRetryBlocked: this.storageRetryBlocked,
      activeStages: Object.freeze(activeStages),
    });
  }

  public submit(input: unknown): Promise<StudioEngineDurableBrushSubmissionResult> {
    if (this.disposed) return Promise.resolve(rejected("disposed"));
    const commandSequence = commandSequenceFromSubmission(input);
    const job: PendingJob = {
      commandSequence,
      stage: "future",
      failure: null,
    };
    this.register(job);
    const run = this.future.submit(input).then(
      (result) => this.finalize(result, job),
      () => rejected("tile-authority-rejected"),
    ).finally(() => {
      job.stage = "done";
      this.unregister(job);
    });
    this.activePromises.add(run);
    void run.then(
      () => this.activePromises.delete(run),
      () => this.activePromises.delete(run),
    );
    return run;
  }

  public cancel(commandSequence: number): StudioEngineFutureBrushCancelResult {
    if (!positiveSafeInteger(commandSequence)) {
      return Object.freeze({ status: "not-found", commandSequence });
    }
    if (this.disposed) return Object.freeze({ status: "disposed", commandSequence });
    if (this.durableBySequence.has(commandSequence)) {
      return Object.freeze({ status: "already-committed", commandSequence });
    }
    const jobs = this.pendingBySequence.get(commandSequence);
    if (jobs && [...jobs].some((job) => (
      job.stage === "authority"
      || job.stage === "storage"
      || job.stage === "durable"
    ))) {
      return Object.freeze({ status: "too-late", commandSequence });
    }
    return this.future.cancel(commandSequence);
  }

  public notifyDeviceLost(): void {
    this.future.notifyDeviceLost();
  }

  /**
   * Explicit terminal order:
   * 1. stop/cancel the future transaction actor;
   * 2. abort and drain Storage Worker persistence;
   * 3. wait for public submissions to settle;
   * 4. dispose document authority;
   * 5. dispose the GPU mirror.
   */
  public dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    this.future.dispose();
    this.disposePromise = (async () => {
      try {
        await this.storage.dispose?.();
      } catch {
        // The durability boundary remains terminal even when transport teardown fails.
      }
      await Promise.allSettled([...this.activePromises]);
      try {
        await this.tileAuthority.dispose?.();
      } catch {
        // Authority ownership is terminal.
      }
      try {
        await this.specialistGpu?.dispose?.();
      } catch {
        // Specialist GPU ownership is terminal.
      }
      try {
        this.webGpu.dispose?.();
      } catch {
        // GPU ownership is terminal.
      }
      this.pendingBySequence.clear();
    })();
    return this.disposePromise;
  }

  private finalize(
    result: StudioEngineFutureBrushSubmissionResult,
    job: PendingJob,
  ): StudioEngineDurableBrushSubmissionResult {
    if (result.status === "rejected") {
      if (job.failure) {
        this.storageRetryBlocked = job.failure.reason === "storage-rejected";
        return rejected(job.failure.reason, {
          futureReason: result.reason,
          storageCode: job.failure.storageCode,
        });
      }
      return rejected(result.reason, { futureReason: result.reason });
    }
    const commandSequence = result.receipt.commandSequence;
    const parts = this.durableBySequence.get(commandSequence);
    if (
      !parts
      || !futureReceiptMatches(
        result.receipt,
        parts.authority,
        this.sessionEpoch,
        this.strokeEpoch,
      )
      || !storageReceiptMatches(parts.storage, parts.authority, this.sessionEpoch)
    ) {
      return rejected("durable-receipt-mismatch");
    }
    const cached = this.publicReceiptBySequence.get(commandSequence);
    if (cached) {
      if (cached.canonicalPlanHash !== result.receipt.canonicalPlanHash) {
        return rejected("durable-receipt-mismatch");
      }
      job.stage = "durable";
      return Object.freeze({
        status: result.status,
        receipt: cached.receipt,
      });
    }
    const receipt = durableReceipt(result.receipt, parts);
    this.publicReceiptBySequence.set(commandSequence, Object.freeze({
      canonicalPlanHash: result.receipt.canonicalPlanHash,
      receipt,
    }));
    job.stage = "durable";
    return Object.freeze({
      status: result.status,
      receipt,
    });
  }

  private register(job: PendingJob): void {
    if (job.commandSequence === null) return;
    const jobs = this.pendingBySequence.get(job.commandSequence) ?? new Set();
    jobs.add(job);
    this.pendingBySequence.set(job.commandSequence, jobs);
  }

  private unregister(job: PendingJob): void {
    if (job.commandSequence === null) return;
    const jobs = this.pendingBySequence.get(job.commandSequence);
    jobs?.delete(job);
    if (jobs?.size === 0) this.pendingBySequence.delete(job.commandSequence);
  }

  private activeJob(commandSequence: number): PendingJob | null {
    const jobs = this.pendingBySequence.get(commandSequence);
    if (!jobs) return null;
    return [...jobs].find((job) => job.stage !== "done") ?? null;
  }

  private markStage(
    commandSequence: number,
    stage: "authority" | "storage" | "durable",
  ): void {
    const job = this.activeJob(commandSequence);
    if (job) job.stage = stage;
  }

  private recordFailure(commandSequence: number, failure: BoundaryFailure): void {
    const job = this.activeJob(commandSequence);
    if (job) job.failure = failure;
    if (failure.reason === "storage-rejected") this.storageRetryBlocked = true;
  }
}
