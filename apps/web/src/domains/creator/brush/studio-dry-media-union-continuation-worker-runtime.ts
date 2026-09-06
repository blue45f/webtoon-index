import { snapshotMemory64CrossRealmReservationToken } from "../kernel/Memory64CrossRealmProtocol";

import {
  STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST,
  STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION,
} from "./studio-brush-dynamics";
import {
  STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_INFLIGHT_BYTES,
  STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_PAGE_COUNT,
  STUDIO_DRY_MEDIA_UNION_CONTINUATION_PROTOCOL_VERSION,
  STUDIO_DRY_MEDIA_UNION_CONTINUATION_TILE_SIZE,
  validateStudioDryMediaUnionContinuationPage,
  type StudioDryMediaUnionContinuationAppendRequest,
  type StudioDryMediaUnionContinuationBeginRequest,
  type StudioDryMediaUnionContinuationCancelRequest,
  type StudioDryMediaUnionContinuationRequest,
  type StudioDryMediaUnionContinuationResponse,
  type StudioDryMediaUnionContinuationSealRequest,
  type StudioDryMediaUnionContinuationTilePatch,
} from "./studio-dry-media-union-continuation-protocol";
import {
  createStudioDryMediaUnionContinuationScratchArena,
  STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_SLOT_COUNT,
  type StudioDryMediaUnionContinuationScratchArena,
  type StudioDryMediaUnionContinuationScratchArenaOptions,
  type StudioDryMediaUnionContinuationScratchTileLease,
} from "./studio-dry-media-union-continuation-scratch-arena";

import type {
  StudioDryMediaUnionContinuationStore,
  StudioDryMediaUnionContinuationStoredBitmapPage,
  StudioDryMediaUnionContinuationStoredPage,
} from "./studio-dry-media-union-continuation-store";

const TILE_BLEED = 2;
const ATLAS_EDGE = 1024;
const ATLAS_RESIDENT_BYTE_LENGTH = ATLAS_EDGE * ATLAS_EDGE * 4;
const MAX_TASK_COUNT_PER_APPEND = 32_768;
const MAX_RASTER_PIXEL_AREA_PER_APPEND = ATLAS_EDGE * ATLAS_EDGE;
const MAX_READBACK_PIXEL_AREA_PER_APPEND = ATLAS_EDGE * ATLAS_EDGE;
const MAX_BITMAP_PIXEL_AREA_PER_FRAME = ATLAS_EDGE * ATLAS_EDGE;

class StudioDryMediaUnionContinuationStoreOperationError extends Error {
  public constructor(cause: unknown) {
    super(cause instanceof Error
      ? cause.message.slice(0, 512)
      : "studio-dry-media-union-store-operation-failed");
    this.name = "StudioDryMediaUnionContinuationStoreOperationError";
  }
}

async function runStoreOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new StudioDryMediaUnionContinuationStoreOperationError(error);
  }
}

interface WorkerMessageEventLike {
  readonly data: unknown;
}

export interface StudioDryMediaUnionContinuationWorkerScope {
  postMessage(
    message: StudioDryMediaUnionContinuationResponse,
    transfer?: Transferable[],
  ): void;
  addEventListener(type: "message", listener: (event: WorkerMessageEventLike) => void): void;
  removeEventListener(type: "message", listener: (event: WorkerMessageEventLike) => void): void;
}

export interface StudioDryMediaUnionContinuationRasterSurface {
  readonly canvas: OffscreenCanvas;
  readonly context: OffscreenCanvasRenderingContext2D;
  readonly residentByteLength: number;
  release(): boolean;
}

export type StudioDryMediaUnionContinuationRasterSurfaceFactory = (
  width: number,
  height: number,
) => StudioDryMediaUnionContinuationRasterSurface | null;

export type StudioDryMediaUnionContinuationBitmapFactory = (
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
) => Promise<ImageBitmap>;

export type StudioDryMediaUnionContinuationScratchArenaFactory = (
  options: StudioDryMediaUnionContinuationScratchArenaOptions,
) => StudioDryMediaUnionContinuationScratchArena;

export interface StudioDryMediaUnionContinuationWorkerRuntimeOptions {
  readonly store: StudioDryMediaUnionContinuationStore;
  readonly surfaceFactory?: StudioDryMediaUnionContinuationRasterSurfaceFactory;
  readonly bitmapFactory?: StudioDryMediaUnionContinuationBitmapFactory;
  readonly scratchArenaFactory?: StudioDryMediaUnionContinuationScratchArenaFactory;
}

export interface StudioDryMediaUnionContinuationRuntimeStats {
  readonly state: "idle" | "active" | "closed";
  readonly sequence: number;
  readonly admittedGroupCount: number;
  readonly activeTileCount: number;
  readonly persistedContourPageCount: number;
  readonly persistedBitmapPageCount: number;
  readonly scratchLinearResidentBytes: number;
  readonly scratchUsedPayloadBytes: number;
  readonly atlasResidentBytes: number;
  readonly readbackTransientBytes: number;
  readonly maximumReadbackTransientBytes: number;
  readonly bitmapSourceTransientBytes: number;
  readonly maximumBitmapSourceTransientBytes: number;
  readonly bitmapFrameResidentBytes: number;
  readonly maximumBitmapFrameResidentBytes: number;
  readonly maximumResidentBytes: number;
  readonly groupVisitCount: number;
  readonly contourVisitCount: number;
  readonly coordinateVisitCount: number;
  readonly tileTaskCount: number;
  readonly getImageDataCallCount: number;
  readonly clearPixelArea: number;
  readonly readbackPixelArea: number;
  readonly maximumReadbackPixelArea: number;
  readonly mainThreadGetImageDataCallCount: 0;
  readonly mainThreadPutImageDataCallCount: 0;
  readonly bitmapTransferCount: number;
  readonly bitmapTransferPixelArea: number;
  readonly contourCasWriteCount: number;
  readonly bitmapCasWriteCount: number;
  readonly tileHydrationCount: number;
  readonly tileEvictionCount: number;
  readonly releaseCount: number;
}

interface SparseCoverageTile {
  readonly tileX: number;
  readonly tileY: number;
  readonly width: number;
  readonly height: number;
  readonly lease: StudioDryMediaUnionContinuationScratchTileLease;
  lastUsed: number;
  dirty: boolean;
  frameMinimumX: number;
  frameMinimumY: number;
  frameMaximumX: number;
  frameMaximumY: number;
}

interface DirtyTileRegion {
  readonly key: string;
  readonly tileX: number;
  readonly tileY: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface RasterTask {
  readonly page: StudioDryMediaUnionContinuationAppendRequest["pages"][number];
  readonly groupIndex: number;
  readonly globalX: number;
  readonly globalY: number;
  readonly width: number;
  readonly height: number;
  atlasX: number;
  atlasY: number;
}

interface PlannedTile {
  readonly key: string;
  readonly tileX: number;
  readonly tileY: number;
  readonly width: number;
  readonly height: number;
}

interface PlannedAppend {
  readonly pages: readonly StudioDryMediaUnionContinuationAppendRequest["pages"][number][];
  readonly tasks: readonly RasterTask[];
  readonly changedTiles: readonly PlannedTile[];
  readonly groupCount: number;
  readonly visibleGroupCount: number;
  readonly contourVisitCount: number;
  readonly coordinateVisitCount: number;
  readonly tilePixelArea: number;
  readonly rasterPixelArea: number;
  readonly readbackPixelArea: number;
  readonly logicalByteLength: number;
  readonly lastStationIndex: number;
}

interface RasterExecutionReceipt {
  readonly visibleGroupCount: number;
  readonly contourVisitCount: number;
  readonly coordinateVisitCount: number;
  readonly tileCount: number;
  readonly tilePixelArea: number;
  readonly rasterPixelArea: number;
  readonly clearPixelArea: number;
  readonly readbackPixelArea: number;
  readonly changedTiles: readonly DirtyTileRegion[];
}

interface ActiveContinuationStroke {
  readonly strokeId: string;
  readonly generation: number;
  readonly presentationGeneration: number;
  readonly width: number;
  readonly height: number;
  readonly transform: readonly [number, number, number, number, number, number];
  readonly color: string;
  readonly scratch: StudioDryMediaUnionContinuationScratchArena;
  readonly surface: StudioDryMediaUnionContinuationRasterSurface;
  readonly tiles: Map<string, SparseCoverageTile>;
  readonly tilePages: Map<string, StudioDryMediaUnionContinuationStoredBitmapPage>;
  contourPages: StudioDryMediaUnionContinuationStoredPage[];
  sequence: number;
  nextGroupIndex: number;
  logicalByteLength: number;
  slabCapacityByteLength: number;
  accessTick: number;
  lastStationIndex: number;
  scratchReleased: boolean;
}

interface MutableCounters {
  readbackTransientBytes: number;
  maximumReadbackTransientBytes: number;
  bitmapSourceTransientBytes: number;
  maximumBitmapSourceTransientBytes: number;
  bitmapFrameResidentBytes: number;
  maximumBitmapFrameResidentBytes: number;
  maximumResidentBytes: number;
  groupVisitCount: number;
  contourVisitCount: number;
  coordinateVisitCount: number;
  tileTaskCount: number;
  getImageDataCallCount: number;
  clearPixelArea: number;
  readbackPixelArea: number;
  maximumReadbackPixelArea: number;
  bitmapTransferCount: number;
  bitmapTransferPixelArea: number;
  contourCasWriteCount: number;
  bitmapCasWriteCount: number;
  tileHydrationCount: number;
  tileEvictionCount: number;
  releaseCount: number;
}

function defaultSurfaceFactory(
  width: number,
  height: number,
): StudioDryMediaUnionContinuationRasterSurface | null {
  if (typeof globalThis.OffscreenCanvas !== "function") return null;
  const canvas = new globalThis.OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    canvas.width = 0;
    canvas.height = 0;
    return null;
  }
  let released = false;
  return {
    canvas,
    context,
    residentByteLength: width * height * 4,
    release() {
      if (released) return false;
      released = true;
      canvas.width = 0;
      canvas.height = 0;
      return true;
    },
  };
}

async function defaultBitmapFactory(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<ImageBitmap> {
  if (typeof globalThis.createImageBitmap !== "function") {
    throw new Error("studio-dry-media-union-image-bitmap-unavailable");
  }
  if (!(rgba.buffer instanceof ArrayBuffer)) {
    throw new Error("studio-dry-media-union-image-data-buffer-unavailable");
  }
  return globalThis.createImageBitmap(new ImageData(
    rgba as Uint8ClampedArray<ArrayBuffer>,
    width,
    height,
  ));
}

function dataRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Object.getOwnPropertySymbols(value).length > 0
      || Object.values(descriptors).some((descriptor) => !("value" in descriptor))
    ) return null;
    return Object.fromEntries(
      Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]),
    );
  } catch {
    return null;
  }
}

function exactDataRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  const record = dataRecord(value);
  if (!record) return null;
  const actual = Object.keys(record);
  return actual.length === keys.length && actual.every((key) => keys.includes(key))
    ? record
    : null;
}

function denseDataArray(value: unknown, maximumLength: number): readonly unknown[] | null {
  if (!Array.isArray(value)) return null;
  let descriptors: Record<string, PropertyDescriptor>;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value) as Record<
      string,
      PropertyDescriptor
    >;
  } catch {
    return null;
  }
  const lengthDescriptor = descriptors.length;
  if (!lengthDescriptor || !("value" in lengthDescriptor)) return null;
  const length = lengthDescriptor.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximumLength) return null;
  if (Object.keys(descriptors).length !== length + 1) return null;
  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor)) return null;
    result.push(descriptor.value);
  }
  return result;
}

function safePositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function safeNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function snapshotTransform(
  value: unknown,
): readonly [number, number, number, number, number, number] | null {
  const transform = denseDataArray(value, 6);
  return transform?.length === 6
    && transform.every((part) => typeof part === "number" && Number.isFinite(part))
    ? Object.freeze([...transform]) as unknown as readonly [
        number,
        number,
        number,
        number,
        number,
        number,
      ]
    : null;
}

function snapshotRequest(value: unknown): StudioDryMediaUnionContinuationRequest | null {
  const request = dataRecord(value);
  if (
    !request
    || request.version !== STUDIO_DRY_MEDIA_UNION_CONTINUATION_PROTOCOL_VERSION
    || !safePositiveInteger(request.workerGeneration)
    || !safePositiveInteger(request.requestId)
    || typeof request.strokeId !== "string"
    || !/^[a-zA-Z0-9._-]{1,192}$/u.test(request.strokeId)
  ) return null;
  if (request.type === "studio-dry-media-union/begin") {
    const exact = exactDataRecord(value, [
      "type",
      "version",
      "workerGeneration",
      "requestId",
      "strokeId",
      "presentationGeneration",
      "programVersion",
      "programDigest",
      "width",
      "height",
      "transform",
      "color",
      "scratchReservation",
    ]);
    const transform = exact ? snapshotTransform(exact.transform) : null;
    const token = exact
      ? snapshotMemory64CrossRealmReservationToken(exact.scratchReservation)
      : null;
    if (
      !exact
      || !safeNonNegativeInteger(exact.presentationGeneration)
      || exact.programVersion !== STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION
      || exact.programDigest !== STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST
      || !safePositiveInteger(exact.width)
      || !safePositiveInteger(exact.height)
      || exact.width > 32_768
      || exact.height > 32_768
      || !transform
      || typeof exact.color !== "string"
      || !/^#[0-9a-f]{6}$/u.test(exact.color)
      || !token
    ) return null;
    return Object.freeze({
      ...exact,
      transform,
      scratchReservation: token,
    }) as unknown as StudioDryMediaUnionContinuationBeginRequest;
  }
  if (request.type === "studio-dry-media-union/append") {
    const exact = exactDataRecord(value, [
      "type",
      "version",
      "workerGeneration",
      "requestId",
      "strokeId",
      "sequence",
      "pages",
    ]);
    const pages = exact
      ? denseDataArray(exact.pages, STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_PAGE_COUNT)
      : null;
    if (!exact || !safePositiveInteger(exact.sequence) || !pages || pages.length === 0) {
      return null;
    }
    let byteLength = 0;
    const buffers = new Set<ArrayBuffer>();
    for (const page of pages) {
      if (!validateStudioDryMediaUnionContinuationPage(page)) return null;
      const typedPage = page as StudioDryMediaUnionContinuationAppendRequest["pages"][number];
      if (buffers.has(typedPage.buffer)) return null;
      buffers.add(typedPage.buffer);
      byteLength += typedPage.byteLength;
    }
    if (
      !Number.isSafeInteger(byteLength)
      || byteLength <= 0
      || byteLength > STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_INFLIGHT_BYTES
    ) return null;
    return Object.freeze({
      ...exact,
      pages: Object.freeze(pages),
    }) as unknown as StudioDryMediaUnionContinuationAppendRequest;
  }
  if (request.type === "studio-dry-media-union/seal") {
    const exact = exactDataRecord(value, [
      "type",
      "version",
      "workerGeneration",
      "requestId",
      "strokeId",
      "sequence",
    ]);
    return exact && safePositiveInteger(exact.sequence)
      ? exact as unknown as StudioDryMediaUnionContinuationSealRequest
      : null;
  }
  if (request.type === "studio-dry-media-union/cancel") {
    const exact = exactDataRecord(value, [
      "type",
      "version",
      "workerGeneration",
      "requestId",
      "strokeId",
    ]);
    return exact as unknown as StudioDryMediaUnionContinuationCancelRequest | null;
  }
  return null;
}

function tileKey(tileX: number, tileY: number): string {
  return `${tileX}:${tileY}`;
}

function transformedGroupPixelBounds(
  page: StudioDryMediaUnionContinuationAppendRequest["pages"][number],
  groupIndex: number,
  transform: readonly [number, number, number, number, number, number],
): Readonly<{
  minimumX: number;
  minimumY: number;
  maximumX: number;
  maximumY: number;
}> | null {
  const minimumX = page.groupBounds[groupIndex * 4]!;
  const minimumY = page.groupBounds[groupIndex * 4 + 1]!;
  const maximumX = page.groupBounds[groupIndex * 4 + 2]!;
  const maximumY = page.groupBounds[groupIndex * 4 + 3]!;
  const [a, b, c, d, e, f] = transform;
  const points = [
    [minimumX, minimumY],
    [maximumX, minimumY],
    [minimumX, maximumY],
    [maximumX, maximumY],
  ] as const;
  const xs = points.map(([x, y]) => a * x + c * y + e);
  const ys = points.map(([x, y]) => b * x + d * y + f);
  if (![...xs, ...ys].every(Number.isFinite)) return null;
  const result = {
    minimumX: Math.floor(Math.min(...xs) - TILE_BLEED),
    minimumY: Math.floor(Math.min(...ys) - TILE_BLEED),
    maximumX: Math.ceil(Math.max(...xs) + TILE_BLEED),
    maximumY: Math.ceil(Math.max(...ys) + TILE_BLEED),
  };
  return Object.values(result).every(Number.isSafeInteger) ? result : null;
}

function closeBitmaps(bitmaps: readonly ImageBitmap[]): void {
  for (const bitmap of bitmaps) {
    try {
      bitmap.close();
    } catch {
      // A failed append has no remaining presentation ownership.
    }
  }
}

function copyTileRegion(
  tile: SparseCoverageTile,
  region: DirtyTileRegion,
): Uint8ClampedArray {
  const byteLength = region.width * region.height * 4;
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0) {
    throw new Error("studio-dry-media-union-invalid-dirty-region");
  }
  const result = new Uint8ClampedArray(byteLength);
  for (let row = 0; row < region.height; row += 1) {
    const sourceStart = ((region.y + row) * tile.width + region.x) * 4;
    const sourceEnd = sourceStart + region.width * 4;
    result.set(
      tile.lease.rgba.subarray(sourceStart, sourceEnd),
      row * region.width * 4,
    );
  }
  return result;
}

function estimateAtlasReadbackPixelArea(tasks: readonly RasterTask[]): number | null {
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  let usedWidth = 0;
  let usedHeight = 0;
  let total = 0;
  const flush = (): boolean => {
    if (usedWidth === 0 || usedHeight === 0) return true;
    total += usedWidth * usedHeight;
    cursorX = 0;
    cursorY = 0;
    rowHeight = 0;
    usedWidth = 0;
    usedHeight = 0;
    return Number.isSafeInteger(total)
      && total <= MAX_READBACK_PIXEL_AREA_PER_APPEND;
  };
  for (const task of tasks) {
    if (cursorX + task.width > ATLAS_EDGE) {
      cursorX = 0;
      cursorY += rowHeight;
      rowHeight = 0;
    }
    if (cursorY + task.height > ATLAS_EDGE && !flush()) return null;
    usedWidth = Math.max(usedWidth, cursorX + task.width);
    usedHeight = Math.max(usedHeight, cursorY + task.height);
    cursorX += task.width;
    rowHeight = Math.max(rowHeight, task.height);
  }
  return flush() ? total : null;
}

export class StudioDryMediaUnionContinuationWorkerRuntime {
  readonly #store: StudioDryMediaUnionContinuationStore;
  readonly #surfaceFactory: StudioDryMediaUnionContinuationRasterSurfaceFactory;
  readonly #bitmapFactory: StudioDryMediaUnionContinuationBitmapFactory;
  readonly #scratchArenaFactory: StudioDryMediaUnionContinuationScratchArenaFactory;
  readonly #counters: MutableCounters = {
    readbackTransientBytes: 0,
    maximumReadbackTransientBytes: 0,
    bitmapSourceTransientBytes: 0,
    maximumBitmapSourceTransientBytes: 0,
    bitmapFrameResidentBytes: 0,
    maximumBitmapFrameResidentBytes: 0,
    maximumResidentBytes: 0,
    groupVisitCount: 0,
    contourVisitCount: 0,
    coordinateVisitCount: 0,
    tileTaskCount: 0,
    getImageDataCallCount: 0,
    clearPixelArea: 0,
    readbackPixelArea: 0,
    maximumReadbackPixelArea: 0,
    bitmapTransferCount: 0,
    bitmapTransferPixelArea: 0,
    contourCasWriteCount: 0,
    bitmapCasWriteCount: 0,
    tileHydrationCount: 0,
    tileEvictionCount: 0,
    releaseCount: 0,
  };
  #active: ActiveContinuationStroke | null = null;
  readonly #pendingFrameTransfers = new Map<
    StudioDryMediaUnionContinuationResponse,
    Readonly<{ bitmaps: readonly ImageBitmap[]; residentByteLength: number }>
  >();
  #closed = false;

  public constructor(options: StudioDryMediaUnionContinuationWorkerRuntimeOptions) {
    this.#store = options.store;
    this.#surfaceFactory = options.surfaceFactory ?? defaultSurfaceFactory;
    this.#bitmapFactory = options.bitmapFactory ?? defaultBitmapFactory;
    this.#scratchArenaFactory = options.scratchArenaFactory
      ?? createStudioDryMediaUnionContinuationScratchArena;
  }

  public async handle(value: unknown): Promise<StudioDryMediaUnionContinuationResponse> {
    const request = snapshotRequest(value);
    if (!request) return this.#failure(null, "invalid-message", "Invalid bounded request.");
    if (this.#closed) {
      return this.#failure(request, "invalid-state", "Continuation runtime is closed.");
    }
    try {
      if (request.type === "studio-dry-media-union/begin") return this.#begin(request);
      if (request.type === "studio-dry-media-union/append") return await this.#append(request);
      if (request.type === "studio-dry-media-union/seal") return await this.#seal(request);
      return this.#cancel(request);
    } catch (error) {
      this.#releaseActive();
      return this.#failure(
        request,
        error instanceof StudioDryMediaUnionContinuationStoreOperationError
          ? "store-failed"
          : "raster-failed",
        error instanceof Error ? error.message.slice(0, 512) : "Unknown runtime failure.",
      );
    }
  }

  public stats(): StudioDryMediaUnionContinuationRuntimeStats {
    const active = this.#active;
    const scratch = active?.scratch.accounting();
    return Object.freeze({
      state: this.#closed ? "closed" as const : active ? "active" as const : "idle" as const,
      sequence: active?.sequence ?? 0,
      admittedGroupCount: active?.nextGroupIndex ?? 0,
      activeTileCount: active?.tiles.size ?? 0,
      persistedContourPageCount: active?.contourPages.length ?? 0,
      persistedBitmapPageCount: active?.tilePages.size ?? 0,
      scratchLinearResidentBytes: scratch?.linearResidentBytes ?? 0,
      scratchUsedPayloadBytes: scratch?.usedPayloadBytes ?? 0,
      atlasResidentBytes: active && !active.scratchReleased
        ? active.surface.residentByteLength
        : 0,
      readbackTransientBytes: this.#counters.readbackTransientBytes,
      maximumReadbackTransientBytes: this.#counters.maximumReadbackTransientBytes,
      bitmapSourceTransientBytes: this.#counters.bitmapSourceTransientBytes,
      maximumBitmapSourceTransientBytes:
        this.#counters.maximumBitmapSourceTransientBytes,
      bitmapFrameResidentBytes: this.#counters.bitmapFrameResidentBytes,
      maximumBitmapFrameResidentBytes:
        this.#counters.maximumBitmapFrameResidentBytes,
      maximumResidentBytes: this.#counters.maximumResidentBytes,
      groupVisitCount: this.#counters.groupVisitCount,
      contourVisitCount: this.#counters.contourVisitCount,
      coordinateVisitCount: this.#counters.coordinateVisitCount,
      tileTaskCount: this.#counters.tileTaskCount,
      getImageDataCallCount: this.#counters.getImageDataCallCount,
      clearPixelArea: this.#counters.clearPixelArea,
      readbackPixelArea: this.#counters.readbackPixelArea,
      maximumReadbackPixelArea: this.#counters.maximumReadbackPixelArea,
      mainThreadGetImageDataCallCount: 0,
      mainThreadPutImageDataCallCount: 0,
      bitmapTransferCount: this.#counters.bitmapTransferCount,
      bitmapTransferPixelArea: this.#counters.bitmapTransferPixelArea,
      contourCasWriteCount: this.#counters.contourCasWriteCount,
      bitmapCasWriteCount: this.#counters.bitmapCasWriteCount,
      tileHydrationCount: this.#counters.tileHydrationCount,
      tileEvictionCount: this.#counters.tileEvictionCount,
      releaseCount: this.#counters.releaseCount,
    });
  }

  public async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    for (const response of [...this.#pendingFrameTransfers.keys()]) {
      this.discardFrameTransfer(response);
    }
    this.#releaseActive();
    await this.#store.close();
  }

  /** Transfers all frame-bitmap ownership after one successful Worker postMessage. */
  public acknowledgeFrameTransfer(
    response: StudioDryMediaUnionContinuationResponse,
  ): boolean {
    const pending = this.#pendingFrameTransfers.get(response);
    if (!pending) return false;
    this.#pendingFrameTransfers.delete(response);
    this.#counters.bitmapFrameResidentBytes = Math.max(
      0,
      this.#counters.bitmapFrameResidentBytes - pending.residentByteLength,
    );
    return true;
  }

  /** Closes every bitmap when transport did not accept the frame ownership. */
  public discardFrameTransfer(
    response: StudioDryMediaUnionContinuationResponse,
  ): boolean {
    const pending = this.#pendingFrameTransfers.get(response);
    if (!pending) return false;
    closeBitmaps(pending.bitmaps);
    return this.acknowledgeFrameTransfer(response);
  }

  #begin(
    request: StudioDryMediaUnionContinuationBeginRequest,
  ): StudioDryMediaUnionContinuationResponse {
    if (this.#active) {
      return this.#failure(request, "invalid-state", "A continuation stroke is already active.");
    }
    const scratch = this.#scratchArenaFactory({
      reservationToken: request.scratchReservation,
    });
    let surface: StudioDryMediaUnionContinuationRasterSurface | null;
    try {
      surface = this.#surfaceFactory(ATLAS_EDGE, ATLAS_EDGE);
    } catch (error) {
      if (scratch.release()) this.#counters.releaseCount += 1;
      throw error;
    }
    if (!surface || surface.residentByteLength !== ATLAS_RESIDENT_BYTE_LENGTH) {
      if (scratch.release()) this.#counters.releaseCount += 1;
      surface?.release();
      throw new Error("studio-dry-media-union-offscreen-surface-unavailable");
    }
    this.#active = {
      strokeId: request.strokeId,
      generation: request.workerGeneration,
      presentationGeneration: request.presentationGeneration,
      width: request.width,
      height: request.height,
      transform: request.transform,
      color: request.color,
      scratch,
      surface,
      tiles: new Map(),
      tilePages: new Map(),
      contourPages: [],
      sequence: 0,
      nextGroupIndex: 0,
      logicalByteLength: 0,
      slabCapacityByteLength: 0,
      accessTick: 0,
      lastStationIndex: -1,
      scratchReleased: false,
    };
    this.#updateMaximumResident(this.#active);
    return {
      type: "studio-dry-media-union/ready",
      version: STUDIO_DRY_MEDIA_UNION_CONTINUATION_PROTOCOL_VERSION,
      workerGeneration: request.workerGeneration,
      requestId: request.requestId,
      strokeId: request.strokeId,
      scratchAllocationAck: scratch.reservationAck,
    };
  }

  async #append(
    request: StudioDryMediaUnionContinuationAppendRequest,
  ): Promise<StudioDryMediaUnionContinuationResponse> {
    const active = this.#active;
    if (
      !active
      || active.strokeId !== request.strokeId
      || active.generation !== request.workerGeneration
      || request.sequence !== active.sequence + 1
    ) return this.#failure(request, "invalid-state", "Append identity or sequence is stale.");
    const planned = this.#planAppend(active, request);
    if (!planned) {
      return this.#failure(request, "invalid-state", "Append exceeds bounded tile work.");
    }
    const bitmaps: ImageBitmap[] = [];
    try {
      const executed = await this.#rasterTasks(
        active,
        planned.tasks,
        planned.changedTiles,
      );
      if (
        executed.visibleGroupCount !== planned.visibleGroupCount
        || executed.contourVisitCount !== planned.contourVisitCount
        || executed.coordinateVisitCount !== planned.coordinateVisitCount
        || executed.tileCount > planned.changedTiles.length
        || executed.tilePixelArea > planned.tilePixelArea
        || executed.rasterPixelArea !== planned.rasterPixelArea
        || executed.clearPixelArea !== planned.rasterPixelArea
        || executed.readbackPixelArea !== planned.readbackPixelArea
      ) throw new Error("studio-dry-media-union-raster-receipt-mismatch");
      const storedContourPages: StudioDryMediaUnionContinuationStoredPage[] = [];
      for (const page of planned.pages) {
        storedContourPages.push(await runStoreOperation(
          () => this.#store.putContourPage(page),
        ));
        this.#counters.contourCasWriteCount += 1;
      }
      const patches: StudioDryMediaUnionContinuationTilePatch[] = [];
      for (const dirtyRegion of [...executed.changedTiles].sort((left, right) => (
        left.tileY - right.tileY || left.tileX - right.tileX
      ))) {
        const tile = active.tiles.get(dirtyRegion.key);
        if (!tile) throw new Error("studio-dry-media-union-frame-tile-missing");
        const rgba = copyTileRegion(tile, dirtyRegion);
        this.#counters.bitmapSourceTransientBytes = rgba.byteLength;
        this.#counters.maximumBitmapSourceTransientBytes = Math.max(
          this.#counters.maximumBitmapSourceTransientBytes,
          rgba.byteLength,
        );
        let bitmap: ImageBitmap;
        try {
          bitmap = await this.#bitmapFactory(
            rgba,
            dirtyRegion.width,
            dirtyRegion.height,
          );
        } finally {
          this.#counters.bitmapSourceTransientBytes = 0;
        }
        bitmaps.push(bitmap);
        patches.push(Object.freeze({
          tileX: tile.tileX,
          tileY: tile.tileY,
          x: tile.tileX * STUDIO_DRY_MEDIA_UNION_CONTINUATION_TILE_SIZE
            + dirtyRegion.x,
          y: tile.tileY * STUDIO_DRY_MEDIA_UNION_CONTINUATION_TILE_SIZE
            + dirtyRegion.y,
          width: dirtyRegion.width,
          height: dirtyRegion.height,
          bitmap,
        }));
      }
      active.contourPages.push(...storedContourPages);
      active.sequence = request.sequence;
      active.nextGroupIndex += planned.groupCount;
      active.lastStationIndex = planned.lastStationIndex;
      active.logicalByteLength += planned.logicalByteLength;
      active.slabCapacityByteLength += planned.logicalByteLength;
      this.#counters.bitmapTransferCount += bitmaps.length;
      this.#counters.bitmapTransferPixelArea += executed.tilePixelArea;
      const bitmapResidentByteLength = executed.tilePixelArea * 4;
      this.#counters.bitmapFrameResidentBytes += bitmapResidentByteLength;
      this.#counters.maximumBitmapFrameResidentBytes = Math.max(
        this.#counters.maximumBitmapFrameResidentBytes,
        this.#counters.bitmapFrameResidentBytes,
      );
      this.#updateMaximumResident(active);
      const response: StudioDryMediaUnionContinuationResponse = {
        type: "studio-dry-media-union/appended",
        version: STUDIO_DRY_MEDIA_UNION_CONTINUATION_PROTOCOL_VERSION,
        workerGeneration: active.generation,
        requestId: request.requestId,
        strokeId: active.strokeId,
        sequence: active.sequence,
        logicalByteLength: planned.logicalByteLength,
        residentByteLength: this.#currentResidentBytes(active),
        inflightByteLength: 0,
        frame: Object.freeze({
          contract: "studio-dry-media-union-frame-v1" as const,
          version: 1 as const,
          status: "rendered" as const,
          strokeId: active.strokeId,
          workerGeneration: active.generation,
          sequence: active.sequence,
          presentationGeneration: active.presentationGeneration,
          programDigest: STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST,
          coverage: Object.freeze({
            contract: "studio-dry-media-union-frame-coverage-v1" as const,
            version: 1 as const,
            admittedGroupCount: planned.groupCount,
            visibleGroupCount: executed.visibleGroupCount,
            contourVisitCount: executed.contourVisitCount,
            coordinateVisitCount: executed.coordinateVisitCount,
            tileCount: executed.tileCount,
            tilePixelArea: executed.tilePixelArea,
            rasterPixelArea: executed.rasterPixelArea,
            clearPixelArea: executed.clearPixelArea,
            readbackPixelArea: executed.readbackPixelArea,
          }),
          tiles: Object.freeze(patches),
        }),
      };
      this.#pendingFrameTransfers.set(response, Object.freeze({
        bitmaps: Object.freeze([...bitmaps]),
        residentByteLength: bitmapResidentByteLength,
      }));
      return response;
    } catch (error) {
      closeBitmaps(bitmaps);
      this.#counters.bitmapSourceTransientBytes = 0;
      throw error;
    }
  }

  async #seal(
    request: StudioDryMediaUnionContinuationSealRequest,
  ): Promise<StudioDryMediaUnionContinuationResponse> {
    const active = this.#active;
    if (
      !active
      || active.strokeId !== request.strokeId
      || active.generation !== request.workerGeneration
      || request.sequence !== active.sequence
      || active.sequence <= 0
      || active.contourPages.length === 0
      || this.#pendingFrameTransfers.size > 0
    ) return this.#failure(request, "invalid-state", "Seal identity is stale or empty.");
    for (const [key, tile] of active.tiles) {
      if (tile.dirty) await this.#persistTile(active, key, tile);
    }
    const bitmapPages = [...active.tilePages.values()].sort((left, right) => (
      left.tileY - right.tileY || left.tileX - right.tileX
    ));
    const contourPages = active.contourPages;
    const sealInput = {
      strokeId: active.strokeId,
      generation: active.generation,
      sequence: active.sequence,
      presentationGeneration: active.presentationGeneration,
      contourPages,
      bitmapPages,
      logicalByteLength: active.logicalByteLength,
      slabCapacityByteLength: active.slabCapacityByteLength,
      residentByteLength: 0,
      metadata: {
        width: active.width,
        height: active.height,
        transform: active.transform,
        color: active.color,
      },
    } as const;
    this.#releaseScratch(active);
    const receipt = await runStoreOperation(() => this.#store.seal(sealInput));
    this.#active = null;
    return {
      type: "studio-dry-media-union/sealed",
      version: STUDIO_DRY_MEDIA_UNION_CONTINUATION_PROTOCOL_VERSION,
      workerGeneration: request.workerGeneration,
      requestId: request.requestId,
      strokeId: request.strokeId,
      receipt,
    };
  }

  #cancel(
    request: StudioDryMediaUnionContinuationCancelRequest,
  ): StudioDryMediaUnionContinuationResponse {
    if (
      this.#active?.strokeId === request.strokeId
      && this.#active.generation === request.workerGeneration
    ) this.#releaseActive();
    return {
      type: "studio-dry-media-union/cancelled",
      version: STUDIO_DRY_MEDIA_UNION_CONTINUATION_PROTOCOL_VERSION,
      workerGeneration: request.workerGeneration,
      requestId: request.requestId,
      strokeId: request.strokeId,
    };
  }

  #planAppend(
    active: ActiveContinuationStroke,
    request: StudioDryMediaUnionContinuationAppendRequest,
  ): PlannedAppend | null {
    const tasks: RasterTask[] = [];
    const changedTiles = new Map<string, PlannedTile>();
    let nextPageIndex = active.contourPages.length;
    let nextGroupIndex = active.nextGroupIndex;
    let groupCount = 0;
    let contourVisitCount = 0;
    let coordinateVisitCount = 0;
    let rasterPixelArea = 0;
    let logicalByteLength = 0;
    let lastStationIndex = active.lastStationIndex;
    for (const page of request.pages) {
      if (
        page.pageIndex !== nextPageIndex
        || page.firstGroupIndex !== nextGroupIndex
      ) return null;
      logicalByteLength += page.byteLength;
      if (!Number.isSafeInteger(logicalByteLength)) return null;
      for (let groupIndex = 0; groupIndex < page.stationIndexes.length; groupIndex += 1) {
        const stationIndex = page.stationIndexes[groupIndex]!;
        if (stationIndex < lastStationIndex) return null;
        lastStationIndex = stationIndex;
        const bounds = transformedGroupPixelBounds(page, groupIndex, active.transform);
        if (!bounds) return null;
        groupCount += 1;
        const globalX = Math.max(0, bounds.minimumX);
        const globalY = Math.max(0, bounds.minimumY);
        const maximumX = Math.min(active.width, bounds.maximumX);
        const maximumY = Math.min(active.height, bounds.maximumY);
        const width = maximumX - globalX;
        const height = maximumY - globalY;
        if (width <= 0 || height <= 0) continue;
        if (width > ATLAS_EDGE || height > ATLAS_EDGE) return null;
        const firstContour = page.groupContourOffsets[groupIndex]!;
        const endContour = page.groupContourOffsets[groupIndex + 1]!;
        let groupCoordinateCount = 0;
        for (let contour = firstContour; contour < endContour; contour += 1) {
          groupCoordinateCount += page.contourCoordinateOffsets[contour + 1]!
            - page.contourCoordinateOffsets[contour]!;
        }
        contourVisitCount += endContour - firstContour;
        coordinateVisitCount += groupCoordinateCount;
        rasterPixelArea += width * height;
        if (
          !Number.isSafeInteger(contourVisitCount)
          || !Number.isSafeInteger(coordinateVisitCount)
          || !Number.isSafeInteger(rasterPixelArea)
          || rasterPixelArea > MAX_RASTER_PIXEL_AREA_PER_APPEND
        ) return null;
        tasks.push({
          page,
          groupIndex,
          globalX,
          globalY,
          width,
          height,
          atlasX: 0,
          atlasY: 0,
        });
        if (tasks.length > MAX_TASK_COUNT_PER_APPEND) return null;
        const minimumTileX = Math.max(
          0,
          Math.floor(globalX / STUDIO_DRY_MEDIA_UNION_CONTINUATION_TILE_SIZE),
        );
        const minimumTileY = Math.max(
          0,
          Math.floor(globalY / STUDIO_DRY_MEDIA_UNION_CONTINUATION_TILE_SIZE),
        );
        const maximumTileX = Math.min(
          Math.ceil(active.width / STUDIO_DRY_MEDIA_UNION_CONTINUATION_TILE_SIZE) - 1,
          Math.floor(
            (maximumX - 1) / STUDIO_DRY_MEDIA_UNION_CONTINUATION_TILE_SIZE,
          ),
        );
        const maximumTileY = Math.min(
          Math.ceil(active.height / STUDIO_DRY_MEDIA_UNION_CONTINUATION_TILE_SIZE) - 1,
          Math.floor(
            (maximumY - 1) / STUDIO_DRY_MEDIA_UNION_CONTINUATION_TILE_SIZE,
          ),
        );
        for (let tileY = minimumTileY; tileY <= maximumTileY; tileY += 1) {
          for (let tileX = minimumTileX; tileX <= maximumTileX; tileX += 1) {
            const originX = tileX * STUDIO_DRY_MEDIA_UNION_CONTINUATION_TILE_SIZE;
            const originY = tileY * STUDIO_DRY_MEDIA_UNION_CONTINUATION_TILE_SIZE;
            const tileWidth = Math.min(
              STUDIO_DRY_MEDIA_UNION_CONTINUATION_TILE_SIZE,
              active.width - originX,
            );
            const tileHeight = Math.min(
              STUDIO_DRY_MEDIA_UNION_CONTINUATION_TILE_SIZE,
              active.height - originY,
            );
            const key = tileKey(tileX, tileY);
            changedTiles.set(key, Object.freeze({
              key,
              tileX,
              tileY,
              width: tileWidth,
              height: tileHeight,
            }));
            if (changedTiles.size
              > STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_SLOT_COUNT) return null;
          }
        }
      }
      nextPageIndex += 1;
      nextGroupIndex += page.stationIndexes.length;
    }
    if (groupCount <= 0) return null;
    const plannedTiles = Object.freeze([...changedTiles.values()]);
    const tilePixelArea = plannedTiles.reduce(
      (sum, tile) => sum + tile.width * tile.height,
      0,
    );
    const readbackPixelArea = estimateAtlasReadbackPixelArea(tasks);
    if (!Number.isSafeInteger(tilePixelArea) || readbackPixelArea === null) return null;
    return Object.freeze({
      pages: request.pages,
      tasks: Object.freeze(tasks),
      changedTiles: plannedTiles,
      groupCount,
      visibleGroupCount: tasks.length,
      contourVisitCount,
      coordinateVisitCount,
      tilePixelArea,
      rasterPixelArea,
      readbackPixelArea,
      logicalByteLength,
      lastStationIndex,
    });
  }

  async #rasterTasks(
    active: ActiveContinuationStroke,
    tasks: readonly RasterTask[],
    plannedTiles: readonly PlannedTile[],
  ): Promise<RasterExecutionReceipt> {
    const contourBefore = this.#counters.contourVisitCount;
    const coordinateBefore = this.#counters.coordinateVisitCount;
    const groupBefore = this.#counters.groupVisitCount;
    const clearBefore = this.#counters.clearPixelArea;
    const readbackBefore = this.#counters.readbackPixelArea;
    const pinned = new Set(plannedTiles.map((tile) => tile.key));
    for (const tile of plannedTiles) {
      const resident = await this.#ensureResidentTile(
        active,
        tile.key,
        tile.tileX,
        tile.tileY,
        tile.width,
        tile.height,
        pinned,
      );
      resident.frameMinimumX = resident.width;
      resident.frameMinimumY = resident.height;
      resident.frameMaximumX = 0;
      resident.frameMaximumY = 0;
    }
    this.#counters.tileTaskCount += plannedTiles.length;
    if (tasks.length === 0) {
      return Object.freeze({
        visibleGroupCount: 0,
        contourVisitCount: 0,
        coordinateVisitCount: 0,
        tileCount: 0,
        tilePixelArea: 0,
        rasterPixelArea: 0,
        clearPixelArea: 0,
        readbackPixelArea: 0,
        changedTiles: Object.freeze([]),
      });
    }
    const batches: RasterTask[][] = [];
    let batch: RasterTask[] = [];
    let cursorX = 0;
    let cursorY = 0;
    let rowHeight = 0;
    const flush = (): void => {
      if (batch.length === 0) return;
      batches.push(batch);
      batch = [];
      cursorX = 0;
      cursorY = 0;
      rowHeight = 0;
    };
    for (const task of tasks) {
      if (task.width > ATLAS_EDGE || task.height > ATLAS_EDGE) {
        throw new Error("studio-dry-media-union-atlas-task-oversize");
      }
      if (cursorX + task.width > ATLAS_EDGE) {
        cursorX = 0;
        cursorY += rowHeight;
        rowHeight = 0;
      }
      if (cursorY + task.height > ATLAS_EDGE) flush();
      task.atlasX = cursorX;
      task.atlasY = cursorY;
      batch.push(task);
      cursorX += task.width;
      rowHeight = Math.max(rowHeight, task.height);
    }
    flush();
    for (const atlasBatch of batches) {
      this.#rasterAtlasBatch(active, atlasBatch);
    }
    const changedTiles: DirtyTileRegion[] = [];
    let changedTilePixelArea = 0;
    for (const plannedTile of plannedTiles) {
      const tile = active.tiles.get(plannedTile.key);
      if (
        !tile
        || tile.frameMaximumX <= tile.frameMinimumX
        || tile.frameMaximumY <= tile.frameMinimumY
      ) continue;
      changedTiles.push(Object.freeze({
        key: plannedTile.key,
        tileX: tile.tileX,
        tileY: tile.tileY,
        x: tile.frameMinimumX,
        y: tile.frameMinimumY,
        width: tile.frameMaximumX - tile.frameMinimumX,
        height: tile.frameMaximumY - tile.frameMinimumY,
      }));
      changedTilePixelArea += (
        tile.frameMaximumX - tile.frameMinimumX
      ) * (
        tile.frameMaximumY - tile.frameMinimumY
      );
      if (
        !Number.isSafeInteger(changedTilePixelArea)
        || changedTilePixelArea > MAX_BITMAP_PIXEL_AREA_PER_FRAME
      ) throw new Error("studio-dry-media-union-frame-bitmap-budget");
    }
    return Object.freeze({
      visibleGroupCount: this.#counters.groupVisitCount - groupBefore,
      contourVisitCount: this.#counters.contourVisitCount - contourBefore,
      coordinateVisitCount: this.#counters.coordinateVisitCount - coordinateBefore,
      tileCount: changedTiles.length,
      tilePixelArea: changedTilePixelArea,
      rasterPixelArea: tasks.reduce(
        (sum, task) => sum + task.width * task.height,
        0,
      ),
      clearPixelArea: this.#counters.clearPixelArea - clearBefore,
      readbackPixelArea: this.#counters.readbackPixelArea - readbackBefore,
      changedTiles: Object.freeze(changedTiles),
    });
  }

  #rasterAtlasBatch(
    active: ActiveContinuationStroke,
    tasks: readonly RasterTask[],
  ): void {
    const context = active.surface.context;
    context.setTransform(1, 0, 0, 1, 0, 0);
    let usedWidth = 0;
    let usedHeight = 0;
    for (const task of tasks) {
      usedWidth = Math.max(usedWidth, task.atlasX + task.width);
      usedHeight = Math.max(usedHeight, task.atlasY + task.height);
      context.clearRect(task.atlasX, task.atlasY, task.width, task.height);
      this.#counters.clearPixelArea += task.width * task.height;
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.beginPath();
      context.rect(task.atlasX, task.atlasY, task.width, task.height);
      context.clip();
      const [a, b, c, d, e, f] = active.transform;
      context.setTransform(
        a,
        b,
        c,
        d,
        e - task.globalX + task.atlasX,
        f - task.globalY + task.atlasY,
      );
      context.fillStyle = active.color;
      context.globalAlpha = 1;
      context.globalCompositeOperation = "source-over";
      context.beginPath();
      const firstContour = task.page.groupContourOffsets[task.groupIndex]!;
      const endContour = task.page.groupContourOffsets[task.groupIndex + 1]!;
      for (let contour = firstContour; contour < endContour; contour += 1) {
        const firstCoordinate = task.page.contourCoordinateOffsets[contour]!;
        const endCoordinate = task.page.contourCoordinateOffsets[contour + 1]!;
        context.moveTo(
          task.page.coordinates[firstCoordinate]!,
          task.page.coordinates[firstCoordinate + 1]!,
        );
        for (
          let coordinate = firstCoordinate + 2;
          coordinate < endCoordinate;
          coordinate += 2
        ) {
          context.lineTo(
            task.page.coordinates[coordinate]!,
            task.page.coordinates[coordinate + 1]!,
          );
        }
        context.closePath();
        this.#counters.contourVisitCount += 1;
        this.#counters.coordinateVisitCount += endCoordinate - firstCoordinate;
      }
      context.fill("nonzero");
      context.restore();
      this.#counters.groupVisitCount += 1;
    }
    const readback = context.getImageData(0, 0, usedWidth, usedHeight).data;
    this.#counters.getImageDataCallCount += 1;
    const readbackPixelArea = usedWidth * usedHeight;
    this.#counters.readbackPixelArea += readbackPixelArea;
    this.#counters.maximumReadbackPixelArea = Math.max(
      this.#counters.maximumReadbackPixelArea,
      readbackPixelArea,
    );
    this.#counters.readbackTransientBytes = readback.byteLength;
    this.#counters.maximumReadbackTransientBytes = Math.max(
      this.#counters.maximumReadbackTransientBytes,
      readback.byteLength,
    );
    try {
      for (const task of tasks) {
        for (let y = 0; y < task.height; y += 1) {
          const globalY = task.globalY + y;
          const tileY = Math.floor(
            globalY / STUDIO_DRY_MEDIA_UNION_CONTINUATION_TILE_SIZE,
          );
          const destinationY = globalY
            - tileY * STUDIO_DRY_MEDIA_UNION_CONTINUATION_TILE_SIZE;
          let x = 0;
          while (x < task.width) {
            const globalX = task.globalX + x;
            const tileX = Math.floor(
              globalX / STUDIO_DRY_MEDIA_UNION_CONTINUATION_TILE_SIZE,
            );
            const tile = active.tiles.get(tileKey(tileX, tileY));
            if (!tile) throw new Error("studio-dry-media-union-resident-tile-missing");
            const destinationX = globalX
              - tileX * STUDIO_DRY_MEDIA_UNION_CONTINUATION_TILE_SIZE;
            const runLength = Math.min(task.width - x, tile.width - destinationX);
            let changed = false;
            for (let runX = 0; runX < runLength; runX += 1) {
              const sourceOffset = (
                (task.atlasY + y) * usedWidth + task.atlasX + x + runX
              ) * 4;
              const destinationOffset = (
                destinationY * tile.width + destinationX + runX
              ) * 4;
              if (readback[sourceOffset + 3]!
                <= tile.lease.rgba[destinationOffset + 3]!) continue;
              tile.lease.rgba[destinationOffset] = readback[sourceOffset]!;
              tile.lease.rgba[destinationOffset + 1] = readback[sourceOffset + 1]!;
              tile.lease.rgba[destinationOffset + 2] = readback[sourceOffset + 2]!;
              tile.lease.rgba[destinationOffset + 3] = readback[sourceOffset + 3]!;
              const changedX = destinationX + runX;
              tile.frameMinimumX = Math.min(tile.frameMinimumX, changedX);
              tile.frameMinimumY = Math.min(tile.frameMinimumY, destinationY);
              tile.frameMaximumX = Math.max(tile.frameMaximumX, changedX + 1);
              tile.frameMaximumY = Math.max(tile.frameMaximumY, destinationY + 1);
              changed = true;
            }
            if (changed) tile.dirty = true;
            tile.lastUsed = ++active.accessTick;
            x += runLength;
          }
        }
      }
    } finally {
      this.#counters.readbackTransientBytes = 0;
    }
    this.#updateMaximumResident(active);
  }

  async #ensureResidentTile(
    active: ActiveContinuationStroke,
    key: string,
    tileX: number,
    tileY: number,
    width: number,
    height: number,
    pinned: ReadonlySet<string>,
  ): Promise<SparseCoverageTile> {
    const existing = active.tiles.get(key);
    if (existing) {
      existing.lastUsed = ++active.accessTick;
      return existing;
    }
    let claim = active.scratch.claimTile({ width, height });
    while (!claim.ok && claim.reason === "slot-backpressure") {
      const candidate = [...active.tiles.entries()]
        .filter(([candidateKey]) => !pinned.has(candidateKey))
        .sort((left, right) => left[1].lastUsed - right[1].lastUsed)[0];
      if (!candidate) throw new Error("studio-dry-media-union-resident-backpressure");
      const [candidateKey, candidateTile] = candidate;
      if (candidateTile.dirty) await this.#persistTile(active, candidateKey, candidateTile);
      active.tiles.delete(candidateKey);
      candidateTile.lease.release();
      this.#counters.tileEvictionCount += 1;
      claim = active.scratch.claimTile({ width, height });
    }
    if (!claim.ok) throw new Error(`studio-dry-media-union-${claim.reason}`);
    const stored = active.tilePages.get(key);
    if (stored) {
      const hydrated = await runStoreOperation(() => this.#store.getBitmapPage(stored));
      if (
        !hydrated
        || hydrated.tileX !== tileX
        || hydrated.tileY !== tileY
        || hydrated.width !== width
        || hydrated.height !== height
      ) {
        claim.tile.release();
        throw new Error("studio-dry-media-union-bitmap-hydration-failed");
      }
      claim.tile.rgba.set(hydrated.rgba);
      this.#counters.tileHydrationCount += 1;
    }
    const tile: SparseCoverageTile = {
      tileX,
      tileY,
      width,
      height,
      lease: claim.tile,
      lastUsed: ++active.accessTick,
      dirty: false,
      frameMinimumX: width,
      frameMinimumY: height,
      frameMaximumX: 0,
      frameMaximumY: 0,
    };
    active.tiles.set(key, tile);
    this.#updateMaximumResident(active);
    return tile;
  }

  async #persistTile(
    active: ActiveContinuationStroke,
    key: string,
    tile: SparseCoverageTile,
  ): Promise<void> {
    const stored = await runStoreOperation(() => this.#store.putBitmapPage({
      tileX: tile.tileX,
      tileY: tile.tileY,
      width: tile.width,
      height: tile.height,
      rgba: tile.lease.rgba,
    }));
    active.tilePages.set(key, stored);
    tile.dirty = false;
    this.#counters.bitmapCasWriteCount += 1;
  }

  #currentResidentBytes(active: ActiveContinuationStroke): number {
    const activeResidentBytes = active.scratchReleased
      ? 0
      : active.scratch.accounting().linearResidentBytes
        + active.surface.residentByteLength;
    return activeResidentBytes
      + this.#counters.readbackTransientBytes
      + this.#counters.bitmapSourceTransientBytes
      + this.#counters.bitmapFrameResidentBytes;
  }

  #updateMaximumResident(active: ActiveContinuationStroke): void {
    this.#counters.maximumResidentBytes = Math.max(
      this.#counters.maximumResidentBytes,
      this.#currentResidentBytes(active),
    );
  }

  #releaseScratch(active: ActiveContinuationStroke): void {
    if (active.scratchReleased) return;
    active.scratchReleased = true;
    for (const tile of active.tiles.values()) tile.lease.release();
    active.tiles.clear();
    active.scratch.release();
    active.surface.release();
    this.#counters.readbackTransientBytes = 0;
    this.#counters.releaseCount += 1;
  }

  #releaseActive(): void {
    if (!this.#active) return;
    this.#releaseScratch(this.#active);
    this.#active.tilePages.clear();
    this.#active.contourPages = [];
    this.#active = null;
  }

  #failure(
    request: StudioDryMediaUnionContinuationRequest | null,
    reason: Extract<
      StudioDryMediaUnionContinuationResponse,
      { readonly type: "studio-dry-media-union/failure" }
    >["reason"],
    detail: string,
  ): StudioDryMediaUnionContinuationResponse {
    return {
      type: "studio-dry-media-union/failure",
      version: STUDIO_DRY_MEDIA_UNION_CONTINUATION_PROTOCOL_VERSION,
      workerGeneration: request?.workerGeneration ?? null,
      requestId: request?.requestId ?? null,
      strokeId: request?.strokeId ?? null,
      reason,
      detail: detail.slice(0, 512),
    };
  }
}

function closeResponseBitmaps(response: StudioDryMediaUnionContinuationResponse): void {
  if (response.type !== "studio-dry-media-union/appended") return;
  closeBitmaps(response.frame.tiles.map((tile) => tile.bitmap));
}

export function installStudioDryMediaUnionContinuationWorkerRuntime(
  scope: StudioDryMediaUnionContinuationWorkerScope,
  runtime: StudioDryMediaUnionContinuationWorkerRuntime,
): Readonly<{ close(): Promise<void>; stats(): Readonly<{ queuedMessageCount: number }> }> {
  let tail = Promise.resolve();
  let queuedMessageCount = 0;
  let closed = false;
  const onMessage = (event: WorkerMessageEventLike): void => {
    if (closed) return;
    if (queuedMessageCount >= 2) {
      scope.postMessage({
        type: "studio-dry-media-union/failure",
        version: STUDIO_DRY_MEDIA_UNION_CONTINUATION_PROTOCOL_VERSION,
        workerGeneration: null,
        requestId: null,
        strokeId: null,
        reason: "invalid-state",
        detail: "Dry-media continuation Worker queue is saturated.",
      });
      return;
    }
    queuedMessageCount += 1;
    const data = event.data;
    tail = tail.then(async () => {
      const response = await runtime.handle(data);
      const transfer = response.type === "studio-dry-media-union/appended"
        ? response.frame.tiles.map((tile) => tile.bitmap)
        : [];
      try {
        scope.postMessage(response, transfer);
        runtime.acknowledgeFrameTransfer(response);
      } catch (error) {
        if (!runtime.discardFrameTransfer(response)) closeResponseBitmaps(response);
        await runtime.close();
        throw error;
      }
    }).finally(() => {
      queuedMessageCount -= 1;
    }).catch(() => undefined);
  };
  scope.addEventListener("message", onMessage);
  return Object.freeze({
    async close() {
      if (closed) return;
      closed = true;
      scope.removeEventListener("message", onMessage);
      await tail;
      await runtime.close();
    },
    stats() {
      return Object.freeze({ queuedMessageCount });
    },
  });
}
