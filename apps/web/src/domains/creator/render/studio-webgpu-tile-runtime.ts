import {
  diffStudioGpuTileStates,
  type StudioGpuTile,
  type StudioGpuTileOperation,
  type StudioGpuTileState,
  type StudioGpuTileStrokeExtension,
  type StudioGpuTileUpdateMode,
} from "./studio-webgpu-tile-plan";

export const STUDIO_GPU_DEFAULT_TILE_CACHE_BYTES = 128 * 1024 * 1024;
export const STUDIO_GPU_DEFAULT_TILE_CACHE_ENTRIES = 256;
export const STUDIO_GPU_TILE_TEXTURE_BYTES_PER_PIXEL = 4;

// COPY_SRC | COPY_DST | TEXTURE_BINDING | RENDER_ATTACHMENT. Numeric flags keep node-side tests
// independent of whether the test runtime exposes GPUTextureUsage on globalThis.
export const STUDIO_GPU_TILE_TEXTURE_USAGE = 0x01 | 0x02 | 0x04 | 0x10;

export interface StudioGpuTileDocumentContract {
  readonly logicalWidth: number;
  readonly logicalHeight: number;
  readonly tileSize: number;
  readonly bleed: number;
}

export interface StudioGpuTileTextureDescriptor {
  readonly id: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly contentX: number;
  readonly contentY: number;
  readonly contentWidth: number;
  readonly contentHeight: number;
  readonly byteLength: number;
  /** Logical document rect rendered into the texture, including anti-aliasing bleed. */
  readonly renderX: number;
  readonly renderY: number;
  readonly renderWidth: number;
  readonly renderHeight: number;
}

export interface StudioGpuTileTextureLayoutOptions {
  readonly resolutionScale: number;
  readonly bytesPerPixel: number;
  readonly maxTextureDimension2D: number;
}

export interface StudioGpuTileResourceFactory<Resource> {
  /** Nominal texture payload cost; runtime budgets conservatively keep the larger factory/override. */
  readonly bytesPerPixel?: number;
  readonly create: (descriptor: StudioGpuTileTextureDescriptor) => Resource;
  readonly destroy: (resource: Resource) => void;
}

export type StudioGpuTileReleaseReason =
  | "abort"
  | "allocation-rollback"
  | "budget"
  | "contract-change"
  | "device-loss"
  | "device-reset"
  | "dispose";

export interface StudioGpuTileRuntimeOptions<Resource> {
  readonly resourceFactory: StudioGpuTileResourceFactory<Resource>;
  readonly maxBytes?: number;
  readonly maxEntries?: number;
  readonly resolutionScale?: number;
  readonly bytesPerPixel?: number;
  readonly maxTextureDimension2D?: number;
  readonly onRelease?: (tileId: string, reason: StudioGpuTileReleaseReason) => void;
}

export interface StudioGpuTileFrameInput {
  readonly contract: StudioGpuTileDocumentContract;
  /** Output from planVisibleStudioGpuTiles; only these tiles can become resident or presented. */
  readonly visibleTiles: readonly StudioGpuTile[];
  /** Full operation states may be supplied, but only visible non-empty states allocate resources. */
  readonly tileStates: readonly StudioGpuTileState[];
}

export interface StudioGpuTileRenderTask<Resource> {
  readonly id: string;
  readonly frameId: string;
  readonly deviceGeneration: number;
  readonly tile: StudioGpuTile;
  readonly descriptor: StudioGpuTileTextureDescriptor;
  readonly resource: Resource;
  readonly mode: Exclude<StudioGpuTileUpdateMode, "clean">;
  /** Full log for rebuild, immutable suffix for append. */
  readonly operations: readonly StudioGpuTileOperation[];
  readonly previousOperationCount: number;
  readonly nextOperationCount: number;
  readonly strokeExtension?: StudioGpuTileStrokeExtension;
}

export interface StudioGpuTilePreparedFrame<Resource> {
  readonly status: "prepared";
  readonly frameId: string;
  /** Opaque instance-bound lease; pass this exact object to completeFrame or abortFrame. */
  readonly token: StudioGpuTileFrameToken;
  readonly deviceGeneration: number;
  readonly tasks: readonly StudioGpuTileRenderTask<Resource>[];
  readonly residentBytes: number;
  readonly residentEntries: number;
}

export type StudioGpuTileFrameFailureReason =
  | "allocation-failed"
  | "budget-exceeded"
  | "busy"
  | "device-unavailable"
  | "disposed"
  | "invalid-input";

export interface StudioGpuTileRejectedFrame {
  readonly status: "rejected";
  readonly reason: StudioGpuTileFrameFailureReason;
  readonly activeFrameId?: string;
  readonly residentBytes: number;
  readonly residentEntries: number;
}

export type StudioGpuTileFramePreparation<Resource> =
  | StudioGpuTilePreparedFrame<Resource>
  | StudioGpuTileRejectedFrame;

export interface StudioGpuTileCompositeItem<Resource> {
  readonly tile: StudioGpuTile;
  /** Null means the tile is intentionally transparent and requires no texture. */
  readonly resource: Resource | null;
  readonly descriptor: StudioGpuTileTextureDescriptor | null;
}

/**
 * A resource-ready tile set after the caller confirms GPU submission completion. This deliberately
 * is not a StudioGpuFrameReceipt and must never hide the authoritative Canvas2D/Konva surface.
 * The compositor still has to sample every item, submit the presentation pass, await completion,
 * and issue the engine's normal request-scoped receipt.
 */
export interface StudioGpuTileCompositeFrame<Resource> {
  readonly kind: "tile-resource-frame";
  readonly frameId: string;
  /** Release only after the presentation pass has completed; resources stay pinned until then. */
  readonly token: StudioGpuTileFrameToken;
  readonly deviceGeneration: number;
  readonly items: readonly StudioGpuTileCompositeItem<Resource>[];
  readonly residentBytes: number;
  readonly residentEntries: number;
}

export interface StudioGpuTileRuntimeStats {
  readonly activeFrameId: string | null;
  readonly deviceAvailable: boolean;
  readonly deviceGeneration: number;
  readonly disposed: boolean;
  readonly residentBytes: number;
  readonly residentEntries: number;
}

const STUDIO_GPU_TILE_FRAME_TOKEN: unique symbol = Symbol("StudioGpuTileFrameToken");

export interface StudioGpuTileFrameToken {
  readonly frameId: string;
  readonly deviceGeneration: number;
  readonly [STUDIO_GPU_TILE_FRAME_TOKEN]: true;
}

interface TileEntry<Resource> {
  resource: Resource;
  descriptor: StudioGpuTileTextureDescriptor;
  renderedState: StudioGpuTileState | null;
  lastUsedSequence: number;
  createdSequence: number;
  taskRevision: number;
  tile: StudioGpuTile;
}

interface ActiveFrame<Resource> {
  frameId: string;
  token: StudioGpuTileFrameToken;
  phase: "prepared" | "presenting";
  deviceGeneration: number;
  visibleTiles: readonly StudioGpuTile[];
  targets: ReadonlyMap<string, StudioGpuTileState>;
  tasks: readonly StudioGpuTileRenderTask<Resource>[];
}

interface NormalizedRuntimeOptions extends StudioGpuTileTextureLayoutOptions {
  maxBytes: number;
  maxEntries: number;
}

interface ValidatedFrame {
  contract: StudioGpuTileDocumentContract;
  visibleTiles: readonly StudioGpuTile[];
  statesById: ReadonlyMap<string, StudioGpuTileState>;
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function finiteSafeMagnitude(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
}

function safeBudget(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!finiteNonNegative(value)) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value));
}

function safePositiveInteger(value: number | undefined, fallback: number): number {
  if (!finitePositive(value)) return fallback;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, Math.floor(value)));
}

function normalizeRuntimeOptions<Resource>(
  options: StudioGpuTileRuntimeOptions<Resource>
): NormalizedRuntimeOptions {
  const explicitBytesPerPixel = safePositiveInteger(
    options.bytesPerPixel,
    STUDIO_GPU_TILE_TEXTURE_BYTES_PER_PIXEL
  );
  const factoryBytesPerPixel = safePositiveInteger(
    options.resourceFactory.bytesPerPixel,
    STUDIO_GPU_TILE_TEXTURE_BYTES_PER_PIXEL
  );
  return {
    maxBytes: safeBudget(options.maxBytes, STUDIO_GPU_DEFAULT_TILE_CACHE_BYTES),
    maxEntries: safeBudget(options.maxEntries, STUDIO_GPU_DEFAULT_TILE_CACHE_ENTRIES),
    resolutionScale: finitePositive(options.resolutionScale) ? options.resolutionScale : 1,
    bytesPerPixel: Math.max(explicitBytesPerPixel, factoryBytesPerPixel),
    maxTextureDimension2D: safePositiveInteger(options.maxTextureDimension2D, 8_192),
  };
}

function compareTiles(left: StudioGpuTile, right: StudioGpuTile): number {
  return left.row - right.row || left.column - right.column || (
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  );
}

function sameTile(left: StudioGpuTile, right: StudioGpuTile): boolean {
  return left.id === right.id
    && left.column === right.column
    && left.row === right.row
    && Object.is(left.x, right.x)
    && Object.is(left.y, right.y)
    && Object.is(left.width, right.width)
    && Object.is(left.height, right.height);
}

function sameDescriptor(
  left: StudioGpuTileTextureDescriptor,
  right: StudioGpuTileTextureDescriptor
): boolean {
  return left.id === right.id
    && left.width === right.width
    && left.height === right.height
    && left.contentX === right.contentX
    && left.contentY === right.contentY
    && left.contentWidth === right.contentWidth
    && left.contentHeight === right.contentHeight
    && left.byteLength === right.byteLength
    && Object.is(left.renderX, right.renderX)
    && Object.is(left.renderY, right.renderY)
    && Object.is(left.renderWidth, right.renderWidth)
    && Object.is(left.renderHeight, right.renderHeight);
}

function sameOperation(
  left: StudioGpuTileOperation,
  right: StudioGpuTileOperation
): boolean {
  return left.id === right.id
    && left.fingerprint === right.fingerprint
    && left.signature === right.signature;
}

function sameState(left: StudioGpuTileState, right: StudioGpuTileState): boolean {
  return sameTile(left, right)
    && Object.is(left.logicalWidth, right.logicalWidth)
    && Object.is(left.logicalHeight, right.logicalHeight)
    && Object.is(left.tileSize, right.tileSize)
    && Object.is(left.bleed, right.bleed)
    && left.operations.length === right.operations.length
    && left.operations.every((operation, index) => sameOperation(operation, right.operations[index]!));
}

function snapshotTile(tile: StudioGpuTile): StudioGpuTile {
  return { ...tile };
}

function snapshotState(state: StudioGpuTileState): StudioGpuTileState {
  return {
    ...state,
    operations: state.operations.map((operation) => ({ ...operation })),
  };
}

function validateContract(
  contract: StudioGpuTileDocumentContract
): StudioGpuTileDocumentContract | null {
  if (
    !finitePositive(contract.logicalWidth)
    || !finitePositive(contract.logicalHeight)
    || !finitePositive(contract.tileSize)
    || !finiteNonNegative(contract.bleed)
    || !finiteSafeMagnitude(contract.logicalWidth)
    || !finiteSafeMagnitude(contract.logicalHeight)
    || !finiteSafeMagnitude(contract.tileSize)
    || !finiteSafeMagnitude(contract.bleed)
  ) {
    return null;
  }
  return { ...contract };
}

function validateTile(
  tile: StudioGpuTile,
  contract: StudioGpuTileDocumentContract
): boolean {
  if (
    !Number.isInteger(tile.column)
    || tile.column < 0
    || !Number.isInteger(tile.row)
    || tile.row < 0
    || tile.id !== `${tile.column}:${tile.row}`
  ) {
    return false;
  }
  const columnCount = Math.ceil(contract.logicalWidth / contract.tileSize);
  const rowCount = Math.ceil(contract.logicalHeight / contract.tileSize);
  if (tile.column >= columnCount || tile.row >= rowCount) return false;
  const x = tile.column * contract.tileSize;
  const y = tile.row * contract.tileSize;
  return Object.is(tile.x, x)
    && Object.is(tile.y, y)
    && Object.is(tile.width, Math.min(contract.tileSize, contract.logicalWidth - x))
    && Object.is(tile.height, Math.min(contract.tileSize, contract.logicalHeight - y));
}

function validateState(
  state: StudioGpuTileState,
  contract: StudioGpuTileDocumentContract
): boolean {
  return validateTile(state, contract)
    && Object.is(state.logicalWidth, contract.logicalWidth)
    && Object.is(state.logicalHeight, contract.logicalHeight)
    && Object.is(state.tileSize, contract.tileSize)
    && Object.is(state.bleed, contract.bleed)
    && Array.isArray(state.operations)
    && state.operations.every((operation) => {
      const extensionMetadata = [
        operation.strokeStyleSignature,
        operation.pointSamplesSignature,
        operation.pressureSamplesSignature,
        operation.pointCount,
      ];
      const hasExtensionMetadata = extensionMetadata.some((value) => value !== undefined);
      const hasFeedMetadata = operation.feedLineage !== undefined
        || operation.feedRevisionToken !== undefined;
      return typeof operation.id === "string"
        && typeof operation.fingerprint === "string"
        && typeof operation.signature === "string"
        && (!hasFeedMetadata || (
          typeof operation.feedLineage === "string"
          && operation.feedLineage.length > 0
          && typeof operation.feedRevisionToken === "string"
          && operation.feedRevisionToken.length > 0
        ))
        && (!hasExtensionMetadata || (
          typeof operation.strokeStyleSignature === "string"
          && typeof operation.pointSamplesSignature === "string"
          && typeof operation.pressureSamplesSignature === "string"
          && Number.isSafeInteger(operation.pointCount)
          && (operation.pointCount ?? 0) >= 1
        ));
    });
}

function validateFrame(input: StudioGpuTileFrameInput): ValidatedFrame | null {
  const contract = validateContract(input.contract);
  if (!contract || !Array.isArray(input.visibleTiles) || !Array.isArray(input.tileStates)) {
    return null;
  }
  const visibleById = new Map<string, StudioGpuTile>();
  for (const tile of input.visibleTiles) {
    if (!validateTile(tile, contract) || visibleById.has(tile.id)) return null;
    visibleById.set(tile.id, snapshotTile(tile));
  }
  const statesById = new Map<string, StudioGpuTileState>();
  for (const state of input.tileStates) {
    if (!validateState(state, contract) || statesById.has(state.id)) return null;
    statesById.set(state.id, snapshotState(state));
  }
  return {
    contract,
    visibleTiles: [...visibleById.values()].sort(compareTiles),
    statesById,
  };
}

export function describeStudioGpuTileTexture(
  tile: StudioGpuTile,
  contract: StudioGpuTileDocumentContract,
  options: StudioGpuTileTextureLayoutOptions
): StudioGpuTileTextureDescriptor | null {
  if (!validateContract(contract) || !validateTile(tile, contract)) return null;
  if (
    !finitePositive(options.resolutionScale)
    || !Number.isSafeInteger(options.bytesPerPixel)
    || options.bytesPerPixel <= 0
    || !Number.isSafeInteger(options.maxTextureDimension2D)
    || options.maxTextureDimension2D <= 0
  ) {
    return null;
  }
  // Content edges share one document-wide physical pixel grid. Independently rounding each tile's
  // width makes two neighbours disagree at fractional scales (for example 512 * 1.3), which then
  // crops a thin logical gap from both textures. Deriving width from the same rounded global edge
  // keeps the right edge of one tile byte-identical to the left edge of the next.
  const physicalLeft = Math.round(tile.x * options.resolutionScale);
  const physicalTop = Math.round(tile.y * options.resolutionScale);
  const physicalRight = Math.round((tile.x + tile.width) * options.resolutionScale);
  const physicalBottom = Math.round((tile.y + tile.height) * options.resolutionScale);
  if (![physicalLeft, physicalTop, physicalRight, physicalBottom].every(Number.isSafeInteger)) {
    return null;
  }
  const contentWidth = Math.max(1, physicalRight - physicalLeft);
  const contentHeight = Math.max(1, physicalBottom - physicalTop);
  const horizontalContentScale = contentWidth / tile.width;
  const verticalContentScale = contentHeight / tile.height;
  const contentX = Math.ceil(contract.bleed * horizontalContentScale);
  const contentY = Math.ceil(contract.bleed * verticalContentScale);
  const width = contentWidth + contentX * 2;
  const height = contentHeight + contentY * 2;
  const byteLength = width * height * options.bytesPerPixel;
  // The logical render rect is derived from those exact physical crop edges. This makes
  // `(tile.x - renderX) / renderWidth === contentX / width` (and the corresponding right/bottom
  // equations) even when the requested resolution scale is fractional.
  const renderX = tile.x - contentX / horizontalContentScale;
  const renderY = tile.y - contentY / verticalContentScale;
  const renderWidth = width / horizontalContentScale;
  const renderHeight = height / verticalContentScale;
  if (
    width > options.maxTextureDimension2D
    || height > options.maxTextureDimension2D
    || !Number.isSafeInteger(byteLength)
    || ![renderX, renderY, renderWidth, renderHeight].every(finiteSafeMagnitude)
    || renderWidth <= 0
    || renderHeight <= 0
  ) {
    return null;
  }
  return {
    id: tile.id,
    label: `Studio retained tile ${tile.id}`,
    width,
    height,
    contentX,
    contentY,
    contentWidth,
    contentHeight,
    byteLength,
    renderX,
    renderY,
    renderWidth,
    renderHeight,
  };
}

function createRejectedFrame<Resource>(
  runtime: StudioGpuTileRuntime<Resource>,
  reason: StudioGpuTileFrameFailureReason,
  activeFrameId?: string
): StudioGpuTileRejectedFrame {
  const stats = runtime.getStats();
  return {
    status: "rejected",
    reason,
    activeFrameId,
    residentBytes: stats.residentBytes,
    residentEntries: stats.residentEntries,
  };
}

/**
 * Viewport-bounded retained tile resource scheduler. It serializes writable frames so a late GPU
 * completion can never bless or append over a superseded texture. The caller must explicitly
 * abort an obsolete prepared frame before preparing its replacement.
 */
export class StudioGpuTileRuntime<Resource> {
  private resourceFactory: StudioGpuTileResourceFactory<Resource>;
  private options: NormalizedRuntimeOptions;
  private readonly configuredBytesPerPixel: number;
  private readonly onRelease: StudioGpuTileRuntimeOptions<Resource>["onRelease"];
  private readonly entries = new Map<string, TileEntry<Resource>>();

  private activeFrame: ActiveFrame<Resource> | null = null;
  private accessSequence = 0;
  private allocationSequence = 0;
  private frameSequence = 0;
  private deviceGeneration = 1;
  private residentBytes = 0;
  private deviceAvailable = true;
  private disposed = false;

  public constructor(options: StudioGpuTileRuntimeOptions<Resource>) {
    this.resourceFactory = options.resourceFactory;
    this.configuredBytesPerPixel = safePositiveInteger(
      options.bytesPerPixel,
      STUDIO_GPU_TILE_TEXTURE_BYTES_PER_PIXEL
    );
    this.options = normalizeRuntimeOptions(options);
    this.onRelease = options.onRelease;
  }

  public getStats(): StudioGpuTileRuntimeStats {
    return {
      activeFrameId: this.activeFrame?.frameId ?? null,
      deviceAvailable: this.deviceAvailable,
      deviceGeneration: this.deviceGeneration,
      disposed: this.disposed,
      residentBytes: this.residentBytes,
      residentEntries: this.entries.size,
    };
  }

  public prepareFrame(input: StudioGpuTileFrameInput): StudioGpuTileFramePreparation<Resource> {
    if (this.disposed) return createRejectedFrame(this, "disposed");
    if (!this.deviceAvailable) return createRejectedFrame(this, "device-unavailable");
    if (this.activeFrame) {
      return createRejectedFrame(this, "busy", this.activeFrame.frameId);
    }
    const validated = validateFrame(input);
    if (!validated) return createRejectedFrame(this, "invalid-input");

    const required = validated.visibleTiles.flatMap((tile) => {
      const state = validated.statesById.get(tile.id);
      if (!state || state.operations.length === 0) return [];
      const descriptor = describeStudioGpuTileTexture(tile, validated.contract, this.options);
      return descriptor ? [{ tile, state, descriptor }] : [];
    });
    const nonEmptyVisibleCount = validated.visibleTiles.filter((tile) => (
      (validated.statesById.get(tile.id)?.operations.length ?? 0) > 0
    )).length;
    if (required.length !== nonEmptyVisibleCount) {
      return createRejectedFrame(this, "invalid-input");
    }

    const requiredBytes = required.reduce((total, item) => total + item.descriptor.byteLength, 0);
    if (
      !Number.isSafeInteger(requiredBytes)
      || requiredBytes > this.options.maxBytes
      || required.length > this.options.maxEntries
    ) {
      return createRejectedFrame(this, "budget-exceeded");
    }

    const requiredIds = new Set(required.map(({ tile }) => tile.id));
    for (const { tile, descriptor } of required) {
      const entry = this.entries.get(tile.id);
      if (entry && !sameDescriptor(entry.descriptor, descriptor)) {
        this.releaseEntry(tile.id, "contract-change");
      }
    }

    const missing = required.filter(({ tile }) => !this.entries.has(tile.id));
    const additionalBytes = missing.reduce((total, item) => total + item.descriptor.byteLength, 0);
    this.evictUntilWithinBudget(requiredIds, additionalBytes, missing.length);
    if (
      this.residentBytes + additionalBytes > this.options.maxBytes
      || this.entries.size + missing.length > this.options.maxEntries
    ) {
      return createRejectedFrame(this, "budget-exceeded");
    }

    const createdIds: string[] = [];
    try {
      for (const { tile, descriptor } of missing) {
        const resource = this.resourceFactory.create(descriptor);
        this.allocationSequence += 1;
        this.entries.set(tile.id, {
          resource,
          descriptor,
          renderedState: null,
          lastUsedSequence: 0,
          createdSequence: this.allocationSequence,
          taskRevision: 0,
          tile,
        });
        this.residentBytes += descriptor.byteLength;
        createdIds.push(tile.id);
      }
    } catch {
      for (const id of createdIds.sort((left, right) => compareTiles(
        this.entries.get(left)!.tile,
        this.entries.get(right)!.tile
      ))) {
        this.releaseEntry(id, "allocation-rollback");
      }
      return createRejectedFrame(this, "allocation-failed");
    }

    this.accessSequence += 1;
    this.frameSequence += 1;
    const frameId = `tiles:${this.deviceGeneration}:${this.frameSequence}`;
    const token = Object.freeze<StudioGpuTileFrameToken>({
      frameId,
      deviceGeneration: this.deviceGeneration,
      [STUDIO_GPU_TILE_FRAME_TOKEN]: true,
    });
    const tasks: StudioGpuTileRenderTask<Resource>[] = [];
    const targets = new Map<string, StudioGpuTileState>();
    for (const { tile, state, descriptor } of required) {
      const entry = this.entries.get(tile.id)!;
      entry.lastUsedSequence = this.accessSequence;
      entry.tile = tile;
      const update = entry.renderedState
        ? diffStudioGpuTileStates([entry.renderedState], [state])[0]
        : null;
      if (entry.renderedState && update?.mode === "clean" && sameState(entry.renderedState, state)) {
        targets.set(tile.id, state);
        continue;
      }
      const mode = entry.renderedState && update?.mode === "append" ? "append" : "rebuild";
      entry.taskRevision += 1;
      tasks.push({
        id: `${frameId}:${tile.id}:${entry.taskRevision}`,
        frameId,
        deviceGeneration: this.deviceGeneration,
        tile,
        descriptor,
        resource: entry.resource,
        mode,
        operations: mode === "append" ? update?.operations ?? [] : state.operations,
        previousOperationCount: entry.renderedState?.operations.length ?? 0,
        nextOperationCount: state.operations.length,
        strokeExtension: mode === "append" ? update?.strokeExtension : undefined,
      });
      targets.set(tile.id, state);
    }

    this.activeFrame = {
      frameId,
      token,
      phase: "prepared",
      deviceGeneration: this.deviceGeneration,
      visibleTiles: validated.visibleTiles,
      targets,
      tasks,
    };
    return {
      status: "prepared",
      frameId,
      token,
      deviceGeneration: this.deviceGeneration,
      tasks,
      residentBytes: this.residentBytes,
      residentEntries: this.entries.size,
    };
  }

  /**
   * Call only after every operation was resolved to its exact stroke snapshot, every dab plan was
   * complete (including the frame-wide visible-task safety cap), and the render submission was
   * accepted by the GPU queue. WebGPU queue submissions execute in order, so a presentation
   * submission may sample these textures without a CPU-side `onSubmittedWorkDone()` fence between
   * the two submissions. Device loss still invalidates the entire cache generation synchronously.
   * Any missing/incomplete task must use abortFrame so partially-written textures cannot survive.
   */
  public completeFrame(token: StudioGpuTileFrameToken): StudioGpuTileCompositeFrame<Resource> | null {
    const frame = this.activeFrame;
    if (
      !frame
      || frame.token !== token
      || frame.phase !== "prepared"
      || frame.deviceGeneration !== this.deviceGeneration
      || !this.deviceAvailable
      || this.disposed
    ) {
      return null;
    }
    for (const task of frame.tasks) {
      const entry = this.entries.get(task.tile.id);
      const target = frame.targets.get(task.tile.id);
      if (
        !entry
        || !target
        || entry.resource !== task.resource
        || task.deviceGeneration !== this.deviceGeneration
      ) {
        this.abortFrame(token);
        return null;
      }
    }
    for (const task of frame.tasks) {
      this.entries.get(task.tile.id)!.renderedState = snapshotState(frame.targets.get(task.tile.id)!);
    }
    const items = frame.visibleTiles.map((tile): StudioGpuTileCompositeItem<Resource> => {
      const target = frame.targets.get(tile.id);
      if (!target || target.operations.length === 0) {
        return { tile, resource: null, descriptor: null };
      }
      const entry = this.entries.get(tile.id);
      if (!entry?.renderedState || !sameState(entry.renderedState, target)) {
        return { tile, resource: null, descriptor: null };
      }
      return { tile, resource: entry.resource, descriptor: entry.descriptor };
    });
    frame.phase = "presenting";
    return {
      kind: "tile-resource-frame",
      frameId: frame.frameId,
      token: frame.token,
      deviceGeneration: frame.deviceGeneration,
      items,
      residentBytes: this.residentBytes,
      residentEntries: this.entries.size,
    };
  }

  /** Releases compositor read pins after the presentation submission itself has completed. */
  public releaseFrame(token: StudioGpuTileFrameToken): boolean {
    const frame = this.activeFrame;
    if (!frame || frame.token !== token || frame.phase !== "presenting") return false;
    this.activeFrame = null;
    return true;
  }

  /** Drops every texture that a cancelled submission might have partially mutated. */
  public abortFrame(token: StudioGpuTileFrameToken): readonly string[] {
    const frame = this.activeFrame;
    if (!frame || frame.token !== token) return [];
    this.activeFrame = null;
    const dirtyIds = [...new Set(frame.tasks.map((task) => task.tile.id))]
      .sort((left, right) => compareTiles(
        this.entries.get(left)?.tile ?? frame.tasks.find((task) => task.tile.id === left)!.tile,
        this.entries.get(right)?.tile ?? frame.tasks.find((task) => task.tile.id === right)!.tile
      ));
    for (const id of dirtyIds) this.releaseEntry(id, "abort");
    return dirtyIds;
  }

  /** Synchronously invalidates all old-device resources and any in-flight frame. */
  public handleDeviceLost(expectedGeneration: number): readonly string[] {
    if (expectedGeneration !== this.deviceGeneration || this.disposed) return [];
    this.activeFrame = null;
    this.deviceAvailable = false;
    this.deviceGeneration += 1;
    return this.releaseAll("device-loss");
  }

  /** Installs a factory backed by the replacement GPUDevice and starts an empty cache generation. */
  public restoreDevice(resourceFactory: StudioGpuTileResourceFactory<Resource>): boolean {
    if (this.disposed) return false;
    this.activeFrame = null;
    this.releaseAll("device-reset");
    this.resourceFactory = resourceFactory;
    this.options = {
      ...this.options,
      bytesPerPixel: Math.max(
        this.configuredBytesPerPixel,
        safePositiveInteger(
          resourceFactory.bytesPerPixel,
          STUDIO_GPU_TILE_TEXTURE_BYTES_PER_PIXEL
        )
      ),
    };
    this.deviceAvailable = true;
    this.deviceGeneration += 1;
    return true;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.activeFrame = null;
    this.deviceAvailable = false;
    this.disposed = true;
    this.deviceGeneration += 1;
    this.releaseAll("dispose");
  }

  private evictUntilWithinBudget(
    requiredIds: ReadonlySet<string>,
    additionalBytes: number,
    additionalEntries: number
  ): void {
    const candidates = [...this.entries.values()]
      .filter((entry) => !requiredIds.has(entry.tile.id))
      .sort((left, right) => (
        left.lastUsedSequence - right.lastUsedSequence
        || left.createdSequence - right.createdSequence
        || compareTiles(left.tile, right.tile)
      ));
    for (const candidate of candidates) {
      if (
        this.residentBytes + additionalBytes <= this.options.maxBytes
        && this.entries.size + additionalEntries <= this.options.maxEntries
      ) {
        break;
      }
      this.releaseEntry(candidate.tile.id, "budget");
    }
  }

  private releaseEntry(tileId: string, reason: StudioGpuTileReleaseReason): void {
    const entry = this.entries.get(tileId);
    if (!entry) return;
    this.entries.delete(tileId);
    this.residentBytes = Math.max(0, this.residentBytes - entry.descriptor.byteLength);
    try {
      this.resourceFactory.destroy(entry.resource);
    } catch {
      // Lost-device resources may already be invalid. Bookkeeping cleanup must still complete.
    }
    try {
      this.onRelease?.(tileId, reason);
    } catch {
      // Diagnostics must not compromise deterministic resource cleanup.
    }
  }

  private releaseAll(reason: StudioGpuTileReleaseReason): readonly string[] {
    const ordered = [...this.entries.values()].sort((left, right) => compareTiles(
      left.tile,
      right.tile
    ));
    for (const entry of ordered) this.releaseEntry(entry.tile.id, reason);
    return ordered.map((entry) => entry.tile.id);
  }
}

export type StudioGpuTileTextureFormat = "bgra8unorm" | "rgba8unorm" | "rgba16float";

export interface StudioGpuTextureResourceFactoryOptions {
  readonly format?: StudioGpuTileTextureFormat;
  readonly usage?: GPUTextureUsageFlags;
}

/** Actual GPUTexture allocator for the scheduler; presentation sampling is a separate pass. */
export function createStudioGpuTileTextureFactory(
  device: GPUDevice,
  options: StudioGpuTextureResourceFactoryOptions = {}
): StudioGpuTileResourceFactory<GPUTexture> {
  const format = options.format ?? "rgba8unorm";
  const usage = options.usage ?? STUDIO_GPU_TILE_TEXTURE_USAGE;
  const bytesPerPixel = format === "rgba16float"
    ? 8
    : format === "rgba8unorm" || format === "bgra8unorm"
      ? 4
      : null;
  if (bytesPerPixel === null) throw new Error(`Unsupported Studio tile texture format: ${format}`);
  return {
    bytesPerPixel,
    create: (descriptor) => {
      if (descriptor.byteLength < descriptor.width * descriptor.height * bytesPerPixel) {
        throw new Error(`Tile ${descriptor.id} byte budget undercounts ${format}`);
      }
      return device.createTexture({
        label: descriptor.label,
        size: {
          width: descriptor.width,
          height: descriptor.height,
          depthOrArrayLayers: 1,
        },
        dimension: "2d",
        format,
        mipLevelCount: 1,
        sampleCount: 1,
        usage,
      });
    },
    destroy: (texture) => texture.destroy(),
  };
}
