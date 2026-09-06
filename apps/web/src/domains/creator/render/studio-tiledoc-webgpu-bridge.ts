/**
 * Transactional sparse-tile document → WebGPU compositor boundary.
 *
 * The document store owns mutable/copy-on-write pixels; a GPU consumer is asynchronous. This
 * bridge turns the planner's dirty stacks into detached, revision-fenced snapshots and commits a
 * presentation revision only after the consumer echoes an exact receipt. Clean visible tiles are
 * still listed for presentation, but their pixels are never copied or uploaded again.
 *
 * The bridge retains no pixel frame. Memory is bounded by the configured dirty-frame budget plus
 * the planner's single descriptor frame. Any rejection after planning resets the planner so the
 * next attempt is a conservative full rebuild rather than silently treating unpresented work as
 * clean.
 */

import {
  StudioTileDocCompositePlanner,
  type StudioTileDocCompositeFramePlan,
  type StudioTileDocCompositeLayer,
  type StudioTileDocCompositeRejectionReason,
} from "./studio-tiledoc-composite-plan";
import { studioTileDocTileSpan, type StudioTileDocRect } from "./studio-tiledoc-geometry";
import { StudioTiledDocumentStore } from "./studio-tiledoc-store";

export const STUDIO_TILEDOC_WEBGPU_DEFAULT_MAX_LAYERS = 1_024;
export const STUDIO_TILEDOC_WEBGPU_DEFAULT_MAX_VIEWPORT_TILE_SLOTS = 4_096;
export const STUDIO_TILEDOC_WEBGPU_DEFAULT_MAX_INPUT_TILE_REFERENCES = 16_384;
export const STUDIO_TILEDOC_WEBGPU_DEFAULT_MAX_VISIBLE_TILES = 4_096;
export const STUDIO_TILEDOC_WEBGPU_DEFAULT_MAX_DIRTY_TILES = 512;
export const STUDIO_TILEDOC_WEBGPU_DEFAULT_MAX_STACK_ENTRIES = 16_384;
export const STUDIO_TILEDOC_WEBGPU_DEFAULT_MAX_SNAPSHOT_BYTES = 128 * 1_024 * 1_024;

export interface StudioTileDocWebGpuVisibleTile {
  readonly id: string;
  readonly column: number;
  readonly row: number;
  readonly rect: StudioTileDocRect;
  readonly stackDepth: number;
}

export interface StudioTileDocWebGpuSourceSnapshot {
  readonly layerId: string;
  readonly bufferId: number;
  readonly contentRevision: number;
  readonly opacity: number;
  readonly blendMode: string;
  /** Storage dimensions. Edge tiles use `tile.rect` as their clipped content extent. */
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly byteLength: number;
  /**
   * Detached `rgba8-premultiplied` store bytes. The consumer may transfer this array; it never
   * aliases store memory. Treat it as immutable until `present` settles.
   */
  readonly rgba: Uint8ClampedArray;
}

export interface StudioTileDocWebGpuDirtyTile {
  readonly id: string;
  readonly column: number;
  readonly row: number;
  readonly rect: StudioTileDocRect;
  readonly action: "clear" | "composite";
  /** Exact BACK→FRONT stack. Empty for a clear task. */
  readonly stack: readonly StudioTileDocWebGpuSourceSnapshot[];
}

export interface StudioTileDocWebGpuFrame {
  readonly kind: "studio-tiledoc-webgpu-frame";
  readonly requestSequence: number;
  readonly expectedPresentationRevision: number;
  readonly expectedContentRevision: number;
  readonly plannerFrameSequence: number;
  readonly plannerVisualRevision: number;
  readonly scopeId: string;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly tileSize: number;
  readonly viewport: StudioTileDocRect;
  /** Full visible set for drawing cached composite textures in deterministic row-major order. */
  readonly visibleTiles: readonly StudioTileDocWebGpuVisibleTile[];
  readonly visibleTileIds: readonly string[];
  /** Only these tiles may be re-composited or cleared during this frame. */
  readonly dirtyTiles: readonly StudioTileDocWebGpuDirtyTile[];
  readonly dirtyTileIds: readonly string[];
  /** Unique detached source bytes owned by this frame, not stack-reference bytes. */
  readonly snapshotBytes: number;
}

export interface StudioTileDocWebGpuPresentedReceipt {
  readonly status: "presented";
  readonly backend: "webgpu";
  readonly requestSequence: number;
  readonly presentationRevision: number;
  readonly contentRevision: number;
  readonly plannerFrameSequence: number;
  readonly plannerVisualRevision: number;
  readonly scopeId: string;
  readonly visibleTileIds: readonly string[];
  readonly processedDirtyTileIds: readonly string[];
  readonly deviceGeneration: number;
}

export interface StudioTileDocWebGpuConsumerRejection {
  readonly status: "rejected";
  readonly reason: string;
}

export type StudioTileDocWebGpuConsumerResult =
  | StudioTileDocWebGpuPresentedReceipt
  | StudioTileDocWebGpuConsumerRejection;

export interface StudioTileDocWebGpuConsumer {
  /** Explicit capability list. Unknown/undeclared blend modes fail before any pixels are copied. */
  readonly supportedBlendModes: readonly string[];
  present(
    frame: StudioTileDocWebGpuFrame,
    signal: AbortSignal
  ): Promise<StudioTileDocWebGpuConsumerResult>;
}

export interface StudioTileDocWebGpuBridgeOptions {
  readonly store: StudioTiledDocumentStore;
  readonly consumer: StudioTileDocWebGpuConsumer;
  readonly maxLayers?: number;
  readonly maxViewportTileSlots?: number;
  readonly maxInputTileReferences?: number;
  readonly maxVisibleTiles?: number;
  readonly maxDirtyTiles?: number;
  readonly maxStackEntries?: number;
  readonly maxSnapshotBytes?: number;
}

export interface StudioTileDocWebGpuPresentRequest {
  readonly viewport: StudioTileDocRect;
  /** BACK→FRONT; this order is also used for the store viewport feed. */
  readonly layers: readonly StudioTileDocCompositeLayer[];
  readonly signal?: AbortSignal;
}

export type StudioTileDocWebGpuBridgeFailureReason =
  | "aborted"
  | "busy"
  | "consumer-failed"
  | "consumer-receipt-mismatch"
  | "consumer-rejected"
  | "dirty-tile-limit"
  | "disposed"
  | "input-tile-reference-limit"
  | "invalid-configuration"
  | "invalid-request"
  | "layer-limit"
  | "non-resident"
  | "planner-rejected"
  | "revision-exhausted"
  | "snapshot-byte-limit"
  | "source-revision-mismatch"
  | "stack-entry-limit"
  | "unsupported-blend-mode"
  | "viewport-tile-limit"
  | "visible-tile-limit";

export interface StudioTileDocWebGpuReadyResult {
  readonly status: "ready";
  readonly requestSequence: number;
  readonly presentationRevision: number;
  /** Advances only after a successfully presented frame containing dirty tiles. */
  readonly contentRevision: number;
  readonly plannerFrameSequence: number;
  readonly plannerVisualRevision: number;
  readonly scopeId: string;
  readonly deviceGeneration: number;
  readonly visibleTileCount: number;
  readonly dirtyTileIds: readonly string[];
  readonly snapshotBytes: number;
}

export interface StudioTileDocWebGpuRejectedResult {
  readonly status: "rejected";
  readonly reason: StudioTileDocWebGpuBridgeFailureReason;
  readonly requestSequence: number;
  readonly plannerReason?: StudioTileDocCompositeRejectionReason;
  readonly consumerReason?: string;
  readonly tileId?: string;
  readonly layerId?: string;
}

export type StudioTileDocWebGpuPresentResult =
  | StudioTileDocWebGpuReadyResult
  | StudioTileDocWebGpuRejectedResult;

export interface StudioTileDocWebGpuBridgeStats {
  readonly active: boolean;
  readonly disposed: boolean;
  readonly requestSequence: number;
  readonly presentationRevision: number;
  readonly contentRevision: number;
}

interface NormalizedBudgets {
  readonly maxLayers: number;
  readonly maxViewportTileSlots: number;
  readonly maxInputTileReferences: number;
  readonly maxVisibleTiles: number;
  readonly maxDirtyTiles: number;
  readonly maxStackEntries: number;
  readonly maxSnapshotBytes: number;
}

interface FrameBuildSuccess {
  readonly status: "ready";
  readonly frame: StudioTileDocWebGpuFrame;
}

interface FrameBuildFailure {
  readonly status: "rejected";
  readonly reason: StudioTileDocWebGpuBridgeFailureReason;
  readonly tileId?: string;
  readonly layerId?: string;
}

type FrameBuildResult = FrameBuildSuccess | FrameBuildFailure;

const EMPTY_TILE_IDS = Object.freeze([]) as readonly string[];

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validRect(rect: StudioTileDocRect): boolean {
  return finiteNonNegative(rect.width)
    && finiteNonNegative(rect.height)
    && typeof rect.x === "number"
    && Number.isFinite(rect.x)
    && typeof rect.y === "number"
    && Number.isFinite(rect.y);
}

function explicitPositiveBudget(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) return 0;
  return value;
}

function nextRevision(value: number): number | null {
  return value < Number.MAX_SAFE_INTEGER ? value + 1 : null;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function safeConsumerReason(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1_024;
}

function cloneRect(rect: StudioTileDocRect): StudioTileDocRect {
  return Object.freeze({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
}

function rejected(
  reason: StudioTileDocWebGpuBridgeFailureReason,
  requestSequence: number,
  detail: Omit<StudioTileDocWebGpuRejectedResult, "status" | "reason" | "requestSequence"> = {}
): StudioTileDocWebGpuRejectedResult {
  return Object.freeze({ status: "rejected", reason, requestSequence, ...detail });
}

function validPresentedReceipt(
  value: StudioTileDocWebGpuConsumerResult,
  frame: StudioTileDocWebGpuFrame
): value is StudioTileDocWebGpuPresentedReceipt {
  return value.status === "presented"
    && value.backend === "webgpu"
    && value.requestSequence === frame.requestSequence
    && value.presentationRevision === frame.expectedPresentationRevision
    && value.contentRevision === frame.expectedContentRevision
    && value.plannerFrameSequence === frame.plannerFrameSequence
    && value.plannerVisualRevision === frame.plannerVisualRevision
    && value.scopeId === frame.scopeId
    && sameStrings(value.visibleTileIds, frame.visibleTileIds)
    && sameStrings(value.processedDirtyTileIds, frame.dirtyTileIds)
    && Number.isSafeInteger(value.deviceGeneration)
    && value.deviceGeneration >= 0;
}

function viewportTileSlotCount(
  store: StudioTiledDocumentStore,
  viewport: StudioTileDocRect
): number {
  const span = studioTileDocTileSpan(viewport, {
    tileSize: store.tileSize,
    bounds: { width: store.documentWidth, height: store.documentHeight },
  });
  if (!span) return 0;
  const columns = span.lastColumn - span.firstColumn + 1;
  const rows = span.lastRow - span.firstRow + 1;
  if (
    !Number.isSafeInteger(columns)
    || !Number.isSafeInteger(rows)
    || columns <= 0
    || rows <= 0
    || columns > Number.MAX_SAFE_INTEGER / rows
  ) {
    return Number.MAX_SAFE_INTEGER;
  }
  return columns * rows;
}

/**
 * Stateful transaction controller. One presentation may be active at a time; callers should
 * coalesce animation-frame invalidations before invoking it.
 */
export class StudioTileDocWebGpuBridge {
  private readonly store: StudioTiledDocumentStore;
  private readonly consumer: StudioTileDocWebGpuConsumer;
  private readonly planner = new StudioTileDocCompositePlanner();
  private readonly budgets: NormalizedBudgets;
  private readonly supportedBlendModes: ReadonlySet<string>;
  private readonly configurationValid: boolean;

  private requestSequence = 0;
  private presentationRevision = 0;
  private contentRevision = 0;
  private active = false;
  private disposed = false;
  private activeAbort: AbortController | null = null;

  public constructor(options: StudioTileDocWebGpuBridgeOptions) {
    this.store = options.store;
    this.consumer = options.consumer;
    this.budgets = Object.freeze({
      maxLayers: explicitPositiveBudget(
        options.maxLayers,
        STUDIO_TILEDOC_WEBGPU_DEFAULT_MAX_LAYERS
      ),
      maxViewportTileSlots: explicitPositiveBudget(
        options.maxViewportTileSlots,
        STUDIO_TILEDOC_WEBGPU_DEFAULT_MAX_VIEWPORT_TILE_SLOTS
      ),
      maxInputTileReferences: explicitPositiveBudget(
        options.maxInputTileReferences,
        STUDIO_TILEDOC_WEBGPU_DEFAULT_MAX_INPUT_TILE_REFERENCES
      ),
      maxVisibleTiles: explicitPositiveBudget(
        options.maxVisibleTiles,
        STUDIO_TILEDOC_WEBGPU_DEFAULT_MAX_VISIBLE_TILES
      ),
      maxDirtyTiles: explicitPositiveBudget(
        options.maxDirtyTiles,
        STUDIO_TILEDOC_WEBGPU_DEFAULT_MAX_DIRTY_TILES
      ),
      maxStackEntries: explicitPositiveBudget(
        options.maxStackEntries,
        STUDIO_TILEDOC_WEBGPU_DEFAULT_MAX_STACK_ENTRIES
      ),
      maxSnapshotBytes: explicitPositiveBudget(
        options.maxSnapshotBytes,
        STUDIO_TILEDOC_WEBGPU_DEFAULT_MAX_SNAPSHOT_BYTES
      ),
    });
    const modes = options.consumer.supportedBlendModes;
    const validModes = Array.isArray(modes)
      && modes.length > 0
      && modes.length <= 256
      && modes.every((mode) => (
        typeof mode === "string" && mode.length > 0 && mode.length <= 1_024
      ));
    this.supportedBlendModes = new Set(validModes ? modes : []);
    this.configurationValid = validModes
      && Object.values(this.budgets).every((budget) => budget > 0);
  }

  public stats(): StudioTileDocWebGpuBridgeStats {
    return Object.freeze({
      active: this.active,
      disposed: this.disposed,
      requestSequence: this.requestSequence,
      presentationRevision: this.presentationRevision,
      contentRevision: this.contentRevision,
    });
  }

  /**
   * Invalidates only retained comparison state. Successful revision identities remain monotonic;
   * the next request re-uploads its full visible set (for example after WebGPU device loss).
   */
  public invalidate(): void {
    if (this.disposed) return;
    this.planner.reset();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.planner.reset();
    this.activeAbort?.abort(new DOMException("Studio tiledoc bridge disposed", "AbortError"));
    this.activeAbort = null;
  }

  public async present(
    request: StudioTileDocWebGpuPresentRequest
  ): Promise<StudioTileDocWebGpuPresentResult> {
    if (this.disposed) return rejected("disposed", this.requestSequence);
    if (this.active) return rejected("busy", this.requestSequence);
    if (!this.configurationValid) {
      return rejected("invalid-configuration", this.requestSequence);
    }
    if (
      !validRect(request.viewport)
      || !Array.isArray(request.layers)
      || request.signal?.aborted
    ) {
      return rejected(
        request.signal?.aborted ? "aborted" : "invalid-request",
        this.requestSequence
      );
    }
    if (request.layers.length > this.budgets.maxLayers) {
      return rejected("layer-limit", this.requestSequence);
    }
    const nextRequestSequence = nextRevision(this.requestSequence);
    const nextPresentationRevision = nextRevision(this.presentationRevision);
    if (nextRequestSequence === null || nextPresentationRevision === null) {
      return rejected("revision-exhausted", this.requestSequence);
    }
    if (
      viewportTileSlotCount(this.store, request.viewport)
      > this.budgets.maxViewportTileSlots
    ) {
      return rejected("viewport-tile-limit", this.requestSequence);
    }

    this.requestSequence = nextRequestSequence;
    const currentRequestSequence = this.requestSequence;
    this.active = true;
    const controller = new AbortController();
    this.activeAbort = controller;
    const onExternalAbort = () => controller.abort(request.signal?.reason);
    if (request.signal?.aborted) onExternalAbort();
    else request.signal?.addEventListener("abort", onExternalAbort, { once: true });

    let planned = false;
    try {
      const layerIds = request.layers.map((layer) => layer.id);
      const viewportTiles = this.store.queryViewport(
        request.viewport,
        { layerIds }
      );
      if (viewportTiles.length > this.budgets.maxInputTileReferences) {
        return rejected("input-tile-reference-limit", currentRequestSequence);
      }
      const plan = this.planner.plan({
        scopeId: this.store.viewportScopeId(request.viewport),
        layers: request.layers,
        viewportTiles,
      });
      if (plan.status === "rejected") {
        return rejected("planner-rejected", currentRequestSequence, {
          plannerReason: plan.reason,
        });
      }
      planned = true;
      const nextContentRevision = plan.dirtyTileIds.length > 0
        ? nextRevision(this.contentRevision)
        : this.contentRevision;
      if (nextContentRevision === null) {
        this.planner.reset();
        return rejected("revision-exhausted", currentRequestSequence);
      }
      const built = this.buildFrame(
        plan,
        request.viewport,
        currentRequestSequence,
        nextPresentationRevision,
        nextContentRevision
      );
      if (built.status === "rejected") {
        this.planner.reset();
        return rejected(built.reason, currentRequestSequence, {
          tileId: built.tileId,
          layerId: built.layerId,
        });
      }
      if (controller.signal.aborted) {
        this.planner.reset();
        return rejected(this.disposed ? "disposed" : "aborted", currentRequestSequence);
      }

      let receipt: StudioTileDocWebGpuConsumerResult;
      try {
        receipt = await this.consumer.present(built.frame, controller.signal);
      } catch {
        this.planner.reset();
        return rejected(
          this.disposed ? "disposed" : controller.signal.aborted ? "aborted" : "consumer-failed",
          currentRequestSequence
        );
      }
      if (this.disposed || controller.signal.aborted) {
        this.planner.reset();
        return rejected(this.disposed ? "disposed" : "aborted", currentRequestSequence);
      }
      if (!receipt || typeof receipt !== "object") {
        this.planner.reset();
        return rejected("consumer-receipt-mismatch", currentRequestSequence);
      }
      if (receipt.status === "rejected") {
        this.planner.reset();
        return safeConsumerReason(receipt.reason)
          ? rejected("consumer-rejected", currentRequestSequence, {
              consumerReason: receipt.reason,
            })
          : rejected("consumer-receipt-mismatch", currentRequestSequence);
      }
      if (!validPresentedReceipt(receipt, built.frame)) {
        this.planner.reset();
        return rejected("consumer-receipt-mismatch", currentRequestSequence);
      }

      this.presentationRevision = nextPresentationRevision;
      this.contentRevision = nextContentRevision;
      return Object.freeze({
        status: "ready",
        requestSequence: currentRequestSequence,
        presentationRevision: this.presentationRevision,
        contentRevision: this.contentRevision,
        plannerFrameSequence: plan.frameSequence,
        plannerVisualRevision: plan.visualRevision,
        scopeId: plan.scopeId,
        deviceGeneration: receipt.deviceGeneration,
        visibleTileCount: built.frame.visibleTiles.length,
        dirtyTileIds: built.frame.dirtyTileIds,
        snapshotBytes: built.frame.snapshotBytes,
      });
    } catch {
      if (planned) this.planner.reset();
      return rejected(
        this.disposed ? "disposed" : controller.signal.aborted ? "aborted" : "consumer-failed",
        currentRequestSequence
      );
    } finally {
      request.signal?.removeEventListener("abort", onExternalAbort);
      if (this.activeAbort === controller) this.activeAbort = null;
      this.active = false;
    }
  }

  private buildFrame(
    plan: StudioTileDocCompositeFramePlan,
    viewport: StudioTileDocRect,
    requestSequence: number,
    expectedPresentationRevision: number,
    expectedContentRevision: number
  ): FrameBuildResult {
    const visibleTiles = plan.tiles
      .filter((tile) => tile.stack.length > 0)
      .map((tile): StudioTileDocWebGpuVisibleTile => Object.freeze({
        id: tile.id,
        column: tile.column,
        row: tile.row,
        rect: cloneRect(tile.rect),
        stackDepth: tile.stack.length,
      }));
    if (visibleTiles.length > this.budgets.maxVisibleTiles) {
      return { status: "rejected", reason: "visible-tile-limit" };
    }
    if (plan.dirtyTileIds.length > this.budgets.maxDirtyTiles) {
      return { status: "rejected", reason: "dirty-tile-limit" };
    }

    const tilesById = new Map(plan.tiles.map((tile) => [tile.id, tile]));
    let stackEntryCount = 0;
    for (const tileId of plan.dirtyTileIds) {
      const tile = tilesById.get(tileId);
      if (!tile) {
        return { status: "rejected", reason: "source-revision-mismatch", tileId };
      }
      stackEntryCount += tile.stack.length;
      if (stackEntryCount > this.budgets.maxStackEntries) {
        return { status: "rejected", reason: "stack-entry-limit", tileId };
      }
      for (const entry of tile.stack) {
        if (!this.supportedBlendModes.has(entry.blendMode)) {
          return {
            status: "rejected",
            reason: "unsupported-blend-mode",
            tileId,
            layerId: entry.layerId,
          };
        }
        if (!entry.resident) {
          return {
            status: "rejected",
            reason: "non-resident",
            tileId,
            layerId: entry.layerId,
          };
        }
      }
    }

    const snapshots = new Map<string, StudioTileDocWebGpuSourceSnapshot>();
    const dirtyTiles: StudioTileDocWebGpuDirtyTile[] = [];
    let snapshotBytes = 0;
    const storageTileBytes = this.store.tileSize * this.store.tileSize * 4;
    for (const tileId of plan.dirtyTileIds) {
      const tile = tilesById.get(tileId)!;
      const stack: StudioTileDocWebGpuSourceSnapshot[] = [];
      for (const entry of tile.stack) {
        const sourceKey = `${entry.bufferId}:${entry.contentRevision}`;
        let source = snapshots.get(sourceKey);
        if (!source) {
          if (
            !Number.isSafeInteger(storageTileBytes)
            || storageTileBytes <= 0
            || snapshotBytes > this.budgets.maxSnapshotBytes - storageTileBytes
          ) {
            return {
              status: "rejected",
              reason: "snapshot-byte-limit",
              tileId,
              layerId: entry.layerId,
            };
          }
          const detached = this.store.copyBufferSnapshot(
            entry.bufferId,
            entry.contentRevision
          );
          if (!detached || detached.byteLength !== storageTileBytes) {
            return {
              status: "rejected",
              reason: "source-revision-mismatch",
              tileId,
              layerId: entry.layerId,
            };
          }
          snapshotBytes += detached.byteLength;
          source = Object.freeze({
            layerId: entry.layerId,
            bufferId: entry.bufferId,
            contentRevision: entry.contentRevision,
            opacity: entry.opacity,
            blendMode: entry.blendMode,
            pixelWidth: this.store.tileSize,
            pixelHeight: this.store.tileSize,
            byteLength: detached.byteLength,
            rgba: detached.pixels,
          });
          snapshots.set(sourceKey, source);
        } else if (
          source.layerId !== entry.layerId
          || !Object.is(source.opacity, entry.opacity)
          || source.blendMode !== entry.blendMode
        ) {
          // A shared pixel buffer may appear under different layer composition properties. Reuse
          // its detached bytes but preserve each stack entry's exact visual metadata.
          source = Object.freeze({
            ...source,
            layerId: entry.layerId,
            opacity: entry.opacity,
            blendMode: entry.blendMode,
          });
        }
        stack.push(source);
      }
      dirtyTiles.push(Object.freeze({
        id: tile.id,
        column: tile.column,
        row: tile.row,
        rect: cloneRect(tile.rect),
        action: stack.length === 0 ? "clear" : "composite",
        stack: stack.length === 0 ? Object.freeze([]) : Object.freeze(stack),
      }));
    }

    const visibleTileIds = visibleTiles.length === 0
      ? EMPTY_TILE_IDS
      : Object.freeze(visibleTiles.map((tile) => tile.id));
    const dirtyTileIds = dirtyTiles.length === 0
      ? EMPTY_TILE_IDS
      : Object.freeze(dirtyTiles.map((tile) => tile.id));
    return {
      status: "ready",
      frame: Object.freeze({
        kind: "studio-tiledoc-webgpu-frame",
        requestSequence,
        expectedPresentationRevision,
        expectedContentRevision,
        plannerFrameSequence: plan.frameSequence,
        plannerVisualRevision: plan.visualRevision,
        scopeId: plan.scopeId,
        documentWidth: this.store.documentWidth,
        documentHeight: this.store.documentHeight,
        tileSize: this.store.tileSize,
        viewport: cloneRect(viewport),
        visibleTiles: Object.freeze(visibleTiles),
        visibleTileIds,
        dirtyTiles: Object.freeze(dirtyTiles),
        dirtyTileIds,
        snapshotBytes,
      }),
    };
  }
}
