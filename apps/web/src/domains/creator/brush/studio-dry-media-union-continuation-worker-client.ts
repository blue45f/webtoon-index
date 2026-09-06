import {
  snapshotMemory64CrossRealmAllocationAck,
  snapshotMemory64CrossRealmReservationToken,
  type Memory64CrossRealmReservationToken,
} from "../kernel/Memory64CrossRealmProtocol";

import {
  STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST,
  STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION,
} from "./studio-brush-dynamics";
import {
  STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_INFLIGHT_BYTES,
  STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_PAGE_COUNT,
  STUDIO_DRY_MEDIA_UNION_CONTINUATION_PROTOCOL_VERSION,
  createStudioDryMediaUnionContinuationPackCursor,
  packStudioDryMediaUnionContinuationPageBatch,
  studioDryMediaUnionContinuationPageTransferables,
  type StudioDryMediaUnionContinuationAppendRequest,
  type StudioDryMediaUnionContinuationFrameReceipt,
  type StudioDryMediaUnionContinuationPage,
  type StudioDryMediaUnionContinuationPackCursor,
  type StudioDryMediaUnionContinuationRequest,
  type StudioDryMediaUnionPagedRootReceipt,
} from "./studio-dry-media-union-continuation-protocol";
import {
  STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_MAX_TILE_EDGE,
  STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_SLOT_COUNT,
  STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_WINDOW_BYTE_LENGTH,
} from "./studio-dry-media-union-continuation-scratch-arena";

import type { Memory64WorkloadCoordinator } from "../kernel/Memory64WorkloadCoordinator";
import type { WasmScratchRuntimeBudget } from "../kernel/WasmMemory64Capability";
import type { StudioDynamicBrushCoverageMark } from "../studio-dynamic-brush-coverage-renderer";

interface MessageEventLike {
  readonly data: unknown;
}

interface ErrorEventLike {
  readonly message?: string;
  preventDefault?(): void;
}

type MessageListener = (event: MessageEventLike) => void;
type ErrorListener = (event: ErrorEventLike) => void;

export interface StudioDryMediaUnionContinuationWorkerLike {
  postMessage(message: StudioDryMediaUnionContinuationRequest, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: MessageListener): void;
  addEventListener(type: "error" | "messageerror", listener: ErrorListener): void;
  removeEventListener(type: "message", listener: MessageListener): void;
  removeEventListener(type: "error" | "messageerror", listener: ErrorListener): void;
  terminate(): void;
}

export type StudioDryMediaUnionContinuationMemory64Coordinator = Pick<
  Memory64WorkloadCoordinator,
  | "reserveCrossRealm"
  | "acknowledgeCrossRealmReservation"
  | "releaseCrossRealmReservation"
>;

export type StudioDryMediaUnionContinuationAppendAdmission =
  | Readonly<{
      ok: true;
      status: "accepted";
      sequence: number;
      firstGroupIndex: number;
      groupCount: number;
      pageCount: number;
      physicalPageByteLength: number;
      inputComplete: boolean;
      nextCursor: StudioDryMediaUnionContinuationPackCursor | null;
      completion: Promise<void>;
    }>
  | Readonly<{
      ok: false;
      status: "rejected" | "backpressure";
      reason:
        | "not-ready"
        | "queue-full"
        | "physical-page-budget"
        | "append-window-exceeded"
        | "invalid-cursor"
        | "invalid-program"
        | "invalid-group"
        | "group-too-large"
        | "pack-failed";
    }>;

export interface StudioDryMediaUnionContinuationPresentationAck {
  readonly contract: "studio-dry-media-union-presentation-ack-v1";
  readonly version: 1;
  readonly strokeId: string;
  readonly workerGeneration: number;
  readonly sequence: number;
  readonly presentationGeneration: number;
  readonly tileCount: number;
}

export interface StudioDryMediaUnionContinuationWorkerClient {
  readonly available: boolean;
  begin(input: Readonly<{
    strokeId: string;
    presentationGeneration: number;
    width: number;
    height: number;
    transform: readonly [number, number, number, number, number, number];
    color: string;
    scratchBudget: WasmScratchRuntimeBudget;
  }>): Promise<void>;
  /**
   * Synchronous ownership admission. A rejected call retains neither marks nor
   * packed pages and advances none of the four authority cursors.
   */
  tryAppend(
    marks: readonly StudioDynamicBrushCoverageMark[],
    cursor?: StudioDryMediaUnionContinuationPackCursor,
  ): StudioDryMediaUnionContinuationAppendAdmission;
  seal(): Promise<StudioDryMediaUnionPagedRootReceipt>;
  cancel(): Promise<void>;
  dispose(): void;
  stats(): Readonly<{
    generation: number;
    receivedSequence: number;
    plannedSequence: number;
    admittedSequence: number;
    presentedSequence: number;
    receivedGroupCount: number;
    plannedGroupCount: number;
    admittedGroupCount: number;
    presentedGroupCount: number;
    receivedPageCount: number;
    plannedPageCount: number;
    admittedPageCount: number;
    presentedPageCount: number;
    queueCount: number;
    queuePhysicalPageByteLength: number;
    inflightPhysicalPageByteLength: number;
    queuedPhysicalPageByteLength: number;
    maximumQueuePhysicalPageByteLength: number;
    transferCount: number;
    continuationPending: boolean;
    presentationPending: boolean;
    scratchReservationActive: boolean;
    scratchResidentByteLength: number;
    state:
      | "idle"
      | "beginning"
      | "ready"
      | "sealing"
      | "cancelling"
      | "sealed"
      | "cancelled"
      | "poisoned"
      | "disposed";
    disposed: boolean;
    terminalReason: string | null;
  }>;
}

export interface StudioDryMediaUnionContinuationWorkerClientOptions {
  readonly memory64Coordinator: StudioDryMediaUnionContinuationMemory64Coordinator;
  readonly workerFactory?: () => StudioDryMediaUnionContinuationWorkerLike | null;
  readonly timeoutMilliseconds?: number;
  /** Resolves only after every tile is uploaded/drawn; a valid ACK transfers bitmap ownership. */
  readonly onFrame: (
    frame: StudioDryMediaUnionContinuationFrameReceipt,
  ) => Promise<StudioDryMediaUnionContinuationPresentationAck>;
}

type ClientState = ReturnType<
  StudioDryMediaUnionContinuationWorkerClient["stats"]
>["state"];

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
  settled: boolean;
}

interface PendingControl<T> {
  readonly requestId: number;
  readonly deferred: Deferred<T>;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface AppendJob {
  readonly sequence: number;
  readonly firstGroupIndex: number;
  readonly firstPageIndex: number;
  readonly groupCount: number;
  readonly physicalPageByteLength: number;
  readonly logicalByteLength: number;
  readonly pageCount: number;
  readonly completion: Deferred<void>;
  pages: readonly StudioDryMediaUnionContinuationPage[] | null;
  timer: ReturnType<typeof setTimeout> | null;
  requestId: number | null;
}

interface PendingPresentation {
  readonly job: AppendJob;
  readonly frame: StudioDryMediaUnionContinuationFrameReceipt;
  readonly timer: ReturnType<typeof setTimeout>;
  abort: (error: Error) => void;
  frameOwned: boolean;
}

const MAX_OUTSTANDING_APPEND_REQUESTS = 2;
const MAX_FRAME_READBACK_PIXEL_AREA = 1024 * 1024;
const RESPONSE_ACK_KEYS = Object.freeze([
  "kind",
  "version",
  "reservationId",
  "nonce",
  "runtime",
  "addressType",
  "residentBytes",
  "residentPages",
] as const);

function defaultWorkerFactory(): StudioDryMediaUnionContinuationWorkerLike | null {
  if (typeof globalThis.Worker !== "function") return null;
  return new globalThis.Worker(
    new URL("./studio-dry-media-union-continuation.worker.ts", import.meta.url),
    { type: "module", name: "studio-dry-media-union-continuation" },
  );
}

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: Error) => void;
  const result: Deferred<T> = {
    promise: new Promise<T>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    }),
    resolve(value) {
      if (result.settled) return;
      result.settled = true;
      resolvePromise(value);
    },
    reject(error) {
      if (result.settled) return;
      result.settled = true;
      rejectPromise(error);
    },
    settled: false,
  };
  return result;
}

function nextSafe(value: number): number {
  return value >= Number.MAX_SAFE_INTEGER ? 1 : value + 1;
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
  const actualKeys = Object.keys(record);
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key))
    ? record
    : null;
}

function frozenOwnDataValue(value: unknown, key: PropertyKey): unknown {
  if (value === null || typeof value !== "object") return undefined;
  try {
    if (!Object.isFrozen(value)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A multi-request delivery must be immutable because earlier pages become
 * durable before a later suffix is packed. This walks only container objects;
 * scalar coordinates remain getter-free validated by the bounded packer.
 */
function snapshotImmutableContinuationDelivery(
  marks: readonly StudioDynamicBrushCoverageMark[],
): readonly StudioDynamicBrushCoverageMark[] | null {
  if (!Array.isArray(marks)) return null;
  const markCount = Object.getOwnPropertyDescriptor(marks, "length")?.value;
  if (!Number.isSafeInteger(markCount) || (markCount as number) < 0) return null;
  const authorityMarks: StudioDynamicBrushCoverageMark[] = [];
  let visitedContainers = 1;
  for (let markIndex = 0; markIndex < (markCount as number); markIndex += 1) {
    const markDescriptor = Object.getOwnPropertyDescriptor(marks, String(markIndex));
    const mark = markDescriptor && "value" in markDescriptor
      ? markDescriptor.value
      : undefined;
    const ribbon = frozenOwnDataValue(mark, "ribbon");
    const compositing = frozenOwnDataValue(ribbon, "compositing");
    const groups = frozenOwnDataValue(compositing, "groups");
    if (!Array.isArray(groups) || !Object.isFrozen(groups)) return null;
    const groupCount = frozenOwnDataValue(groups, "length");
    if (!Number.isSafeInteger(groupCount) || (groupCount as number) <= 0) return null;
    visitedContainers += 4;
    for (let groupIndex = 0; groupIndex < (groupCount as number); groupIndex += 1) {
      const group = frozenOwnDataValue(groups, String(groupIndex));
      const polygons = frozenOwnDataValue(group, "polygons");
      if (!Array.isArray(polygons) || !Object.isFrozen(polygons)) return null;
      const polygonCount = frozenOwnDataValue(polygons, "length");
      if (!Number.isSafeInteger(polygonCount) || (polygonCount as number) <= 0) return null;
      visitedContainers += 2 + (polygonCount as number);
      if (visitedContainers > 1_000_000) return null;
      for (let polygonIndex = 0; polygonIndex < (polygonCount as number); polygonIndex += 1) {
        const polygon = frozenOwnDataValue(polygons, String(polygonIndex));
        if (!Array.isArray(polygon) || !Object.isFrozen(polygon)) return null;
      }
    }
    authorityMarks.push(mark as StudioDynamicBrushCoverageMark);
  }
  return Object.freeze(authorityMarks);
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

function safeNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function safeBudgetByteCount(value: unknown): value is number | bigint {
  return typeof value === "bigint"
    ? value >= BigInt(0)
    : safeNonNegativeInteger(value);
}

function validTransferredBitmap(value: unknown, width: number, height: number): boolean {
  if (typeof globalThis.ImageBitmap === "function") {
    try {
      return value instanceof globalThis.ImageBitmap
        && value.width === width
        && value.height === height;
    } catch {
      return false;
    }
  }
  const record = dataRecord(value);
  return record?.width === width
    && record.height === height
    && typeof record.close === "function";
}

function snapshotFrame(
  value: unknown,
  expected: Readonly<{
    strokeId: string;
    workerGeneration: number;
    sequence: number;
    presentationGeneration: number;
    width: number;
    height: number;
    groupCount: number;
  }>,
): StudioDryMediaUnionContinuationFrameReceipt | null {
  const frame = exactDataRecord(value, [
    "contract",
    "version",
    "strokeId",
    "workerGeneration",
    "sequence",
    "presentationGeneration",
    "programDigest",
    "status",
    "coverage",
    "tiles",
  ]);
  if (
    !frame
    || frame.contract !== "studio-dry-media-union-frame-v1"
    || frame.version !== 1
    || frame.strokeId !== expected.strokeId
    || frame.workerGeneration !== expected.workerGeneration
    || frame.sequence !== expected.sequence
    || frame.presentationGeneration !== expected.presentationGeneration
    || frame.programDigest !== STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST
    || frame.status !== "rendered"
  ) return null;
  const rawTiles = denseDataArray(
    frame.tiles,
    STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_SLOT_COUNT,
  );
  if (!rawTiles) return null;
  const rawCoverage = exactDataRecord(frame.coverage, [
    "contract",
    "version",
    "admittedGroupCount",
    "visibleGroupCount",
    "contourVisitCount",
    "coordinateVisitCount",
    "tileCount",
    "tilePixelArea",
    "rasterPixelArea",
    "clearPixelArea",
    "readbackPixelArea",
  ]);
  if (
    !rawCoverage
    || rawCoverage.contract !== "studio-dry-media-union-frame-coverage-v1"
    || rawCoverage.version !== 1
    || !safeNonNegativeInteger(rawCoverage.admittedGroupCount)
    || !safeNonNegativeInteger(rawCoverage.visibleGroupCount)
    || !safeNonNegativeInteger(rawCoverage.contourVisitCount)
    || !safeNonNegativeInteger(rawCoverage.coordinateVisitCount)
    || !safeNonNegativeInteger(rawCoverage.tileCount)
    || !safeNonNegativeInteger(rawCoverage.tilePixelArea)
    || !safeNonNegativeInteger(rawCoverage.rasterPixelArea)
    || !safeNonNegativeInteger(rawCoverage.clearPixelArea)
    || !safeNonNegativeInteger(rawCoverage.readbackPixelArea)
    || rawCoverage.admittedGroupCount !== expected.groupCount
    || rawCoverage.visibleGroupCount > rawCoverage.admittedGroupCount
  ) return null;
  const tiles: StudioDryMediaUnionContinuationFrameReceipt["tiles"][number][] = [];
  const tileKeys = new Set<string>();
  let pixelCount = 0;
  for (const rawTile of rawTiles) {
    const tile = exactDataRecord(rawTile, [
      "tileX",
      "tileY",
      "x",
      "y",
      "width",
      "height",
      "bitmap",
    ]);
    if (
      !tile
      || !safeNonNegativeInteger(tile.tileX)
      || !safeNonNegativeInteger(tile.tileY)
      || !safeNonNegativeInteger(tile.x)
      || !safeNonNegativeInteger(tile.y)
      || !safeNonNegativeInteger(tile.width)
      || !safeNonNegativeInteger(tile.height)
      || tile.width <= 0
      || tile.height <= 0
      || tile.width > STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_MAX_TILE_EDGE
      || tile.height > STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_MAX_TILE_EDGE
      || !safeNonNegativeInteger(tile.x + tile.width)
      || !safeNonNegativeInteger(tile.y + tile.height)
      || tile.x >= expected.width
      || tile.y >= expected.height
      || tile.x + tile.width > expected.width
      || tile.y + tile.height > expected.height
      || !validTransferredBitmap(tile.bitmap, tile.width, tile.height)
    ) return null;
    const tileOriginX = tile.tileX
      * STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_MAX_TILE_EDGE;
    const tileOriginY = tile.tileY
      * STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_MAX_TILE_EDGE;
    if (
      tile.x < tileOriginX
      || tile.y < tileOriginY
      || tile.x + tile.width > Math.min(
        tileOriginX + STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_MAX_TILE_EDGE,
        expected.width,
      )
      || tile.y + tile.height > Math.min(
        tileOriginY + STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_MAX_TILE_EDGE,
        expected.height,
      )
    ) return null;
    const tileKey = `${tile.tileX}:${tile.tileY}`;
    if (tileKeys.has(tileKey)) return null;
    tileKeys.add(tileKey);
    pixelCount += tile.width * tile.height;
    if (
      !Number.isSafeInteger(pixelCount)
      || pixelCount * 4 > STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_WINDOW_BYTE_LENGTH
    ) return null;
    tiles.push(tile as unknown as StudioDryMediaUnionContinuationFrameReceipt["tiles"][number]);
  }
  if (
    rawCoverage.tileCount !== tiles.length
    || rawCoverage.tilePixelArea !== pixelCount
    || (
      rawCoverage.visibleGroupCount === 0
      && (
        rawCoverage.contourVisitCount !== 0
        || rawCoverage.coordinateVisitCount !== 0
        || rawCoverage.tileCount !== 0
        || rawCoverage.rasterPixelArea !== 0
        || rawCoverage.clearPixelArea !== 0
        || rawCoverage.readbackPixelArea !== 0
      )
    )
    || (
      rawCoverage.visibleGroupCount > 0
      && (
        rawCoverage.contourVisitCount <= 0
        || rawCoverage.coordinateVisitCount < rawCoverage.contourVisitCount * 6
        || rawCoverage.rasterPixelArea <= 0
        || rawCoverage.clearPixelArea !== rawCoverage.rasterPixelArea
        || rawCoverage.readbackPixelArea < rawCoverage.rasterPixelArea
        || rawCoverage.readbackPixelArea > MAX_FRAME_READBACK_PIXEL_AREA
      )
    )
  ) return null;
  return Object.freeze({
    contract: "studio-dry-media-union-frame-v1",
    version: 1,
    strokeId: expected.strokeId,
    workerGeneration: expected.workerGeneration,
    sequence: expected.sequence,
    presentationGeneration: frame.presentationGeneration,
    programDigest: STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST,
    status: "rendered",
    coverage: Object.freeze({
      contract: "studio-dry-media-union-frame-coverage-v1" as const,
      version: 1 as const,
      admittedGroupCount: rawCoverage.admittedGroupCount,
      visibleGroupCount: rawCoverage.visibleGroupCount,
      contourVisitCount: rawCoverage.contourVisitCount,
      coordinateVisitCount: rawCoverage.coordinateVisitCount,
      tileCount: rawCoverage.tileCount,
      tilePixelArea: rawCoverage.tilePixelArea,
      rasterPixelArea: rawCoverage.rasterPixelArea,
      clearPixelArea: rawCoverage.clearPixelArea,
      readbackPixelArea: rawCoverage.readbackPixelArea,
    }),
    tiles: Object.freeze(tiles),
  });
}

function closeFrame(frame: StudioDryMediaUnionContinuationFrameReceipt | null): void {
  if (!frame) return;
  for (const tile of frame.tiles) {
    try {
      tile.bitmap.close();
    } catch {
      // A rejected transferred bitmap has no remaining presentation authority.
    }
  }
}

function closeBitmapCandidate(value: unknown, seen: Set<object>): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  try {
    if (typeof globalThis.ImageBitmap === "function") {
      if (value instanceof globalThis.ImageBitmap) value.close();
      return;
    }
    const record = dataRecord(value);
    if (record && typeof record.close === "function") record.close.call(value);
  } catch {
    // A malformed or already-detached frame cannot retain presentation ownership.
  }
}

function closePotentialFrame(value: unknown): void {
  const response = dataRecord(value);
  const frame = response ? dataRecord(response.frame) : null;
  const rawTiles = frame
    ? denseDataArray(
        frame.tiles,
        STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_SLOT_COUNT,
      )
    : null;
  if (!rawTiles) return;
  const seen = new Set<object>();
  for (const rawTile of rawTiles) {
    const tile = dataRecord(rawTile);
    if (tile) closeBitmapCandidate(tile.bitmap, seen);
  }
}

function snapshotAllocationAck(value: unknown) {
  const record = exactDataRecord(value, RESPONSE_ACK_KEYS);
  return record ? snapshotMemory64CrossRealmAllocationAck(record) : null;
}

function snapshotPresentationAck(
  value: unknown,
  frame: StudioDryMediaUnionContinuationFrameReceipt,
): StudioDryMediaUnionContinuationPresentationAck | null {
  const ack = exactDataRecord(value, [
    "contract",
    "version",
    "strokeId",
    "workerGeneration",
    "sequence",
    "presentationGeneration",
    "tileCount",
  ]);
  if (
    !ack
    || ack.contract !== "studio-dry-media-union-presentation-ack-v1"
    || ack.version !== 1
    || ack.strokeId !== frame.strokeId
    || ack.workerGeneration !== frame.workerGeneration
    || ack.sequence !== frame.sequence
    || ack.presentationGeneration !== frame.presentationGeneration
    || ack.tileCount !== frame.tiles.length
  ) return null;
  return Object.freeze({
    contract: "studio-dry-media-union-presentation-ack-v1",
    version: 1,
    strokeId: frame.strokeId,
    workerGeneration: frame.workerGeneration,
    sequence: frame.sequence,
    presentationGeneration: frame.presentationGeneration,
    tileCount: frame.tiles.length,
  });
}

function snapshotRootReceipt(
  value: unknown,
  expected: Readonly<{
    strokeId: string;
    generation: number;
    sequence: number;
    groupCount: number;
    contourPageCount: number;
    presentationGeneration: number;
  }>,
): StudioDryMediaUnionPagedRootReceipt | null {
  const keys = [
    "contract",
    "version",
    "strokeId",
    "generation",
    "sequence",
    "programVersion",
    "programDigest",
    "rootDigest",
    "contentDigest",
    "metadataDigest",
    "pageCount",
    "indexPageCount",
    "bitmapPageCount",
    "groupCount",
    "contourCount",
    "coordinateCount",
    "logicalByteLength",
    "pagedByteLength",
    "residentByteLength",
    "hydratedByteLength",
    "inflightByteLength",
    "slabCapacityByteLength",
    "fragmentationByteLength",
    "presentationGeneration",
  ] as const;
  const receipt = exactDataRecord(value, keys);
  const sha256 = /^[a-f0-9]{64}$/u;
  if (
    !receipt
    || receipt.contract !== "studio-dry-media-union-paged-root-v1"
    || receipt.version !== 1
    || receipt.strokeId !== expected.strokeId
    || receipt.generation !== expected.generation
    || receipt.sequence !== expected.sequence
    || receipt.programVersion !== STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION
    || receipt.programDigest !== STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST
    || receipt.groupCount !== expected.groupCount
    || !safeNonNegativeInteger(receipt.pageCount)
    || !safeNonNegativeInteger(receipt.bitmapPageCount)
    || receipt.pageCount !== expected.contourPageCount + receipt.bitmapPageCount
    || receipt.presentationGeneration !== expected.presentationGeneration
    || typeof receipt.rootDigest !== "string"
    || !sha256.test(receipt.rootDigest)
    || typeof receipt.contentDigest !== "string"
    || !sha256.test(receipt.contentDigest)
    || typeof receipt.metadataDigest !== "string"
    || !sha256.test(receipt.metadataDigest)
    || !keys.slice(10).every((key) => safeNonNegativeInteger(receipt[key]))
  ) return null;
  return Object.freeze(receipt as unknown as StudioDryMediaUnionPagedRootReceipt);
}

function snapshotBeginInput(
  value: unknown,
): Parameters<StudioDryMediaUnionContinuationWorkerClient["begin"]>[0] | null {
  const input = exactDataRecord(value, [
    "strokeId",
    "presentationGeneration",
    "width",
    "height",
    "transform",
    "color",
    "scratchBudget",
  ]);
  const transform = input ? denseDataArray(input.transform, 6) : null;
  const budget = input ? dataRecord(input.scratchBudget) : null;
  if (
    !input
    || typeof input.strokeId !== "string"
    || !/^[a-zA-Z0-9._-]{1,192}$/u.test(input.strokeId)
    || !safeNonNegativeInteger(input.presentationGeneration)
    || typeof input.width !== "number"
    || !Number.isSafeInteger(input.width)
    || input.width <= 0
    || input.width > 32_768
    || typeof input.height !== "number"
    || !Number.isSafeInteger(input.height)
    || input.height <= 0
    || input.height > 32_768
    || !transform
    || transform.length !== 6
    || !transform.every((entry) => typeof entry === "number" && Number.isFinite(entry))
    || typeof input.color !== "string"
    || !/^#[0-9a-f]{6}$/u.test(input.color)
    || !budget
    || !["availableBytes", "availablePages", "reservedBytes"].every(
      (key) => budget[key] !== undefined || key === "reservedBytes",
    )
    || Object.keys(budget).some(
      (key) => !["availableBytes", "availablePages", "reservedBytes"].includes(key),
    )
    || !safeBudgetByteCount(budget.availableBytes)
    || !safeBudgetByteCount(budget.availablePages)
    || (budget.reservedBytes !== undefined && !safeBudgetByteCount(budget.reservedBytes))
  ) return null;
  return Object.freeze({
    strokeId: input.strokeId,
    presentationGeneration: input.presentationGeneration,
    width: input.width,
    height: input.height,
    transform: Object.freeze([...transform]) as unknown as readonly [
      number,
      number,
      number,
      number,
      number,
      number,
    ],
    color: input.color,
    scratchBudget: Object.freeze({
      availableBytes: budget.availableBytes,
      availablePages: budget.availablePages,
      ...(budget.reservedBytes === undefined
        ? {}
        : { reservedBytes: budget.reservedBytes }),
    }),
  });
}

export function createStudioDryMediaUnionContinuationWorkerClient(
  options: StudioDryMediaUnionContinuationWorkerClientOptions,
): StudioDryMediaUnionContinuationWorkerClient {
  const optionRecord = dataRecord(options);
  if (
    !optionRecord
    || Object.keys(optionRecord).some((key) => ![
      "memory64Coordinator",
      "workerFactory",
      "timeoutMilliseconds",
      "onFrame",
    ].includes(key))
    || optionRecord.memory64Coordinator === null
    || typeof optionRecord.memory64Coordinator !== "object"
    || (optionRecord.workerFactory !== undefined
      && typeof optionRecord.workerFactory !== "function")
    || typeof optionRecord.onFrame !== "function"
  ) throw new TypeError("Invalid dry-media continuation Worker client options.");
  const memory64Coordinator = optionRecord.memory64Coordinator as
    StudioDryMediaUnionContinuationMemory64Coordinator;
  const workerFactory = optionRecord.workerFactory as
    (() => StudioDryMediaUnionContinuationWorkerLike | null) | undefined;
  const onFrame = optionRecord.onFrame as
    StudioDryMediaUnionContinuationWorkerClientOptions["onFrame"];
  const timeoutMilliseconds = optionRecord.timeoutMilliseconds ?? 30_000;
  if (
    typeof timeoutMilliseconds !== "number"
    || !Number.isSafeInteger(timeoutMilliseconds)
    || timeoutMilliseconds < 100
    || timeoutMilliseconds > 120_000
  ) throw new TypeError("Invalid dry-media continuation Worker timeout.");
  const safeTimeoutMilliseconds = timeoutMilliseconds as number;

  let worker = (workerFactory ?? defaultWorkerFactory)();
  let state: ClientState = "idle";
  let generation = 1;
  let requestId = 0;
  let strokeId: string | null = null;
  let presentationGeneration = 0;
  let surfaceWidth = 0;
  let surfaceHeight = 0;
  let reservationToken: Memory64CrossRealmReservationToken | null = null;
  let reservationReleaseAttempted = false;
  let scratchResidentByteLength = 0;
  let terminalReason: string | null = null;
  let transportClosed = false;

  let receivedSequence = 0;
  let plannedSequence = 0;
  let admittedSequence = 0;
  let presentedSequence = 0;
  let receivedGroupCount = 0;
  let plannedGroupCount = 0;
  let admittedGroupCount = 0;
  let presentedGroupCount = 0;
  let receivedPageCount = 0;
  let plannedPageCount = 0;
  let admittedPageCount = 0;
  let presentedPageCount = 0;
  let queuePhysicalPageByteLength = 0;
  let maximumQueuePhysicalPageByteLength = 0;
  let transferCount = 0;
  let pendingContinuation: Readonly<{
    sourceMarks: WeakRef<readonly StudioDynamicBrushCoverageMark[]>;
    authorityMarks: readonly StudioDynamicBrushCoverageMark[];
    cursor: StudioDryMediaUnionContinuationPackCursor;
  }> | null = null;

  let beginning: PendingControl<void> | null = null;
  let sealing: PendingControl<StudioDryMediaUnionPagedRootReceipt> | null = null;
  let cancelling: PendingControl<void> | null = null;
  let inflight: AppendJob | null = null;
  let queued: AppendJob | null = null;
  let presenting: PendingPresentation | null = null;

  const releaseReservation = (): void => {
    if (!reservationToken || reservationReleaseAttempted) return;
    reservationReleaseAttempted = true;
    try {
      memory64Coordinator.releaseCrossRealmReservation(reservationToken);
    } finally {
      reservationToken = null;
      scratchResidentByteLength = 0;
    }
  };

  const markReservationReleasedByAcknowledgement = (): void => {
    reservationReleaseAttempted = true;
    reservationToken = null;
    scratchResidentByteLength = 0;
  };

  const detachTransport = (): void => {
    if (transportClosed) return;
    transportClosed = true;
    if (worker) {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      worker.removeEventListener("messageerror", onError);
      try {
        worker.terminate();
      } catch {
        // The Worker is still treated as terminal when host termination throws.
      }
    }
    worker = null;
    releaseReservation();
  };

  const rejectAppend = (job: AppendJob | null, error: Error): void => {
    if (!job) return;
    if (job.timer) clearTimeout(job.timer);
    job.timer = null;
    job.pages = null;
    job.completion.reject(error);
  };

  const releasePresentation = (aborted: boolean, abortError: Error | null = null): void => {
    const lease = presenting;
    if (!lease) return;
    clearTimeout(lease.timer);
    if (lease.frameOwned) {
      lease.frameOwned = false;
      closeFrame(lease.frame);
    }
    if (aborted && abortError) {
      lease.abort(abortError);
      lease.abort = () => undefined;
    }
    presenting = null;
  };

  const poison = (message: string): void => {
    if (["sealed", "cancelled", "poisoned", "disposed"].includes(state)) return;
    const error = new Error(message);
    terminalReason = message;
    state = "poisoned";
    if (beginning) {
      clearTimeout(beginning.timer);
      beginning.deferred.reject(error);
      beginning = null;
    }
    if (sealing) {
      clearTimeout(sealing.timer);
      sealing.deferred.reject(error);
      sealing = null;
    }
    if (cancelling) {
      clearTimeout(cancelling.timer);
      cancelling.deferred.reject(error);
      cancelling = null;
    }
    releasePresentation(true, error);
    rejectAppend(inflight, error);
    rejectAppend(queued, error);
    inflight = null;
    queued = null;
    pendingContinuation = null;
    queuePhysicalPageByteLength = 0;
    detachTransport();
  };

  const timeout = (message: string): ReturnType<typeof setTimeout> => setTimeout(() => {
    poison(message);
  }, safeTimeoutMilliseconds);

  const post = (
    request: StudioDryMediaUnionContinuationRequest,
    transfer: Transferable[] = [],
  ): boolean => {
    if (!worker || transportClosed) return false;
    try {
      worker.postMessage(request, transfer);
      return true;
    } catch (error) {
      poison(error instanceof Error
        ? error.message
        : "studio-dry-media-continuation-post-failed");
      return false;
    }
  };

  const pump = (): void => {
    if (state !== "ready" || inflight || !queued || !worker) return;
    const job = queued;
    queued = null;
    inflight = job;
    requestId = nextSafe(requestId);
    job.requestId = requestId;
    const pages = job.pages;
    if (!pages) {
      poison("studio-dry-media-continuation-missing-pages");
      return;
    }
    const request: StudioDryMediaUnionContinuationAppendRequest = {
      type: "studio-dry-media-union/append",
      version: STUDIO_DRY_MEDIA_UNION_CONTINUATION_PROTOCOL_VERSION,
      workerGeneration: generation,
      requestId,
      strokeId: strokeId!,
      sequence: job.sequence,
      pages,
    };
    const transfer = pages.flatMap((page) => [
      ...studioDryMediaUnionContinuationPageTransferables(page),
    ]);
    transferCount += transfer.length;
    job.timer = timeout("studio-dry-media-continuation-append-timeout");
    if (!post(request, transfer)) {
      poison("studio-dry-media-union-continuation-append-post-failed");
      return;
    }
    job.pages = null;
  };

  const handleReady = (response: Record<string, unknown>): void => {
    const pending = beginning;
    const exact = exactDataRecord(response, [
      "type",
      "version",
      "workerGeneration",
      "requestId",
      "strokeId",
      "scratchAllocationAck",
    ]);
    if (
      !pending
      || state !== "beginning"
      || !exact
      || exact.version !== STUDIO_DRY_MEDIA_UNION_CONTINUATION_PROTOCOL_VERSION
      || exact.workerGeneration !== generation
      || exact.requestId !== pending.requestId
      || exact.strokeId !== strokeId
    ) {
      poison("studio-dry-media-continuation-ready-mismatch");
      return;
    }
    const acknowledgement = snapshotAllocationAck(exact.scratchAllocationAck);
    if (!acknowledgement || !reservationToken) {
      poison("studio-dry-media-continuation-invalid-allocation-ack");
      return;
    }
    let acknowledgementReceipt;
    try {
      acknowledgementReceipt = memory64Coordinator
        .acknowledgeCrossRealmReservation(reservationToken, acknowledgement);
    } catch (error) {
      poison(error instanceof Error
        ? error.message
        : "studio-dry-media-continuation-allocation-ack-failed");
      return;
    }
    if (!acknowledgementReceipt.ok) {
      // The coordinator's rejection contract releases the pending reservation.
      markReservationReleasedByAcknowledgement();
      poison(`studio-dry-media-continuation-allocation-ack-${acknowledgementReceipt.reason}`);
      return;
    }
    scratchResidentByteLength = Number(acknowledgementReceipt.residentBytes);
    clearTimeout(pending.timer);
    beginning = null;
    state = "ready";
    pending.deferred.resolve(undefined);
  };

  const handleAppended = async (response: Record<string, unknown>): Promise<void> => {
    const job = inflight;
    const exact = exactDataRecord(response, [
      "type",
      "version",
      "workerGeneration",
      "requestId",
      "strokeId",
      "sequence",
      "logicalByteLength",
      "residentByteLength",
      "inflightByteLength",
      "frame",
    ]);
    if (
      !job
      || presenting !== null
      || state !== "ready"
      || !exact
      || exact.version !== STUDIO_DRY_MEDIA_UNION_CONTINUATION_PROTOCOL_VERSION
      || exact.workerGeneration !== generation
      || exact.requestId !== job.requestId
      || exact.strokeId !== strokeId
      || exact.sequence !== job.sequence
      || !safeNonNegativeInteger(exact.logicalByteLength)
      || exact.logicalByteLength !== job.logicalByteLength
      || !safeNonNegativeInteger(exact.residentByteLength)
      || exact.inflightByteLength !== 0
    ) {
      closePotentialFrame(response);
      poison("studio-dry-media-union-continuation-append-mismatch");
      return;
    }
    const frame = snapshotFrame(exact.frame, {
      strokeId: strokeId!,
      workerGeneration: generation,
      sequence: job.sequence,
      presentationGeneration,
      width: surfaceWidth,
      height: surfaceHeight,
      groupCount: job.groupCount,
    });
    if (!frame) {
      closePotentialFrame(response);
      poison("studio-dry-media-union-continuation-frame-mismatch");
      return;
    }
    if (job.timer) clearTimeout(job.timer);
    job.timer = null;
    admittedSequence = job.sequence;
    admittedGroupCount = job.firstGroupIndex + job.groupCount;
    admittedPageCount = job.firstPageIndex + job.pageCount;
    let rejectPresentation: (error: Error) => void = () => undefined;
    const timer = setTimeout(() => {
      rejectPresentation(new Error("studio-dry-media-union-continuation-presentation-timeout"));
    }, safeTimeoutMilliseconds);
    const presentationLease: PendingPresentation = {
      job,
      frame,
      frameOwned: true,
      timer,
      abort: (error) => {
        rejectPresentation(error);
      },
    };
    presenting = presentationLease;
    const presentation = new Promise<StudioDryMediaUnionContinuationPresentationAck>((resolve, reject) => {
      rejectPresentation = reject;
      onFrame(frame).then(
        (ack) => {
          clearTimeout(timer);
          resolve(ack);
        },
        (error) => {
          clearTimeout(timer);
          reject(error instanceof Error
            ? error
            : new Error("studio-dry-media-union-continuation-frame-observer-failed"));
        },
      );
    });
    let acknowledgementCandidate: unknown;
    try {
      acknowledgementCandidate = await presentation;
    } catch (error) {
      releasePresentation(true, error instanceof Error
        ? error
        : new Error("studio-dry-media-union-continuation-frame-observer-failed"));
      poison(error instanceof Error
        ? error.message
        : "studio-dry-media-union-continuation-frame-observer-failed");
      return;
    }
    if (state !== "ready" || inflight !== job || presenting?.job !== job) {
      const error = new Error("studio-dry-media-continuation-frame-state-race");
      queuePhysicalPageByteLength = Math.max(
        0,
        queuePhysicalPageByteLength - job.physicalPageByteLength,
      );
      releasePresentation(true, error);
      if (inflight === job) {
        inflight = null;
        rejectAppend(job, error);
      }
      pump();
      return;
    }
    const presentationAck = snapshotPresentationAck(acknowledgementCandidate, frame);
    if (!presentationAck) {
      releasePresentation(true, new Error("studio-dry-media-continuation-frame-not-presented"));
      poison("studio-dry-media-union-continuation-frame-not-presented");
      return;
    }
    presentedSequence = job.sequence;
    presentedGroupCount = admittedGroupCount;
    presentedPageCount = admittedPageCount;
    queuePhysicalPageByteLength = Math.max(
      0,
      queuePhysicalPageByteLength - job.physicalPageByteLength,
    );
    releasePresentation(false);
    inflight = null;
    job.completion.resolve(undefined);
    pump();
  };

  const handleSealed = (response: Record<string, unknown>): void => {
    const pending = sealing;
    const exact = exactDataRecord(response, [
      "type",
      "version",
      "workerGeneration",
      "requestId",
      "strokeId",
      "receipt",
    ]);
    const receipt = pending && exact
      ? snapshotRootReceipt(exact.receipt, {
          strokeId: strokeId!,
          generation,
          sequence: presentedSequence,
          groupCount: presentedGroupCount,
          contourPageCount: presentedPageCount,
          presentationGeneration,
        })
      : null;
    if (
      !pending
      || state !== "sealing"
      || !exact
      || exact.version !== STUDIO_DRY_MEDIA_UNION_CONTINUATION_PROTOCOL_VERSION
      || exact.workerGeneration !== generation
      || exact.requestId !== pending.requestId
      || exact.strokeId !== strokeId
      || !receipt
    ) {
      poison("studio-dry-media-continuation-seal-mismatch");
      return;
    }
    clearTimeout(pending.timer);
    sealing = null;
    state = "sealed";
    terminalReason = "studio-dry-media-continuation-sealed";
    detachTransport();
    pending.deferred.resolve(receipt);
  };

  const handleCancelled = (response: Record<string, unknown>): void => {
    const pending = cancelling;
    const exact = exactDataRecord(response, [
      "type",
      "version",
      "workerGeneration",
      "requestId",
      "strokeId",
    ]);
    if (
      !pending
      || state !== "cancelling"
      || !exact
      || exact.version !== STUDIO_DRY_MEDIA_UNION_CONTINUATION_PROTOCOL_VERSION
      || exact.workerGeneration !== generation
      || exact.requestId !== pending.requestId
      || exact.strokeId !== strokeId
    ) {
      poison("studio-dry-media-continuation-cancel-mismatch");
      return;
    }
    clearTimeout(pending.timer);
    cancelling = null;
    pendingContinuation = null;
    state = "cancelled";
    terminalReason = "studio-dry-media-continuation-cancelled";
    detachTransport();
    pending.deferred.resolve(undefined);
  };

  const handleFailure = (response: Record<string, unknown>): void => {
    const exact = exactDataRecord(response, [
      "type",
      "version",
      "workerGeneration",
      "requestId",
      "strokeId",
      "reason",
      "detail",
    ]);
    if (!exact || typeof exact.detail !== "string") {
      poison("studio-dry-media-continuation-invalid-failure");
      return;
    }
    poison(exact.detail.slice(0, 512) || "studio-dry-media-continuation-worker-failure");
  };

  function onMessage(event: MessageEventLike): void {
    if (["sealed", "cancelled", "poisoned", "disposed"].includes(state)) {
      closePotentialFrame(event.data);
      return;
    }
    const response = dataRecord(event.data);
    if (!response || typeof response.type !== "string") {
      closePotentialFrame(event.data);
      poison("studio-dry-media-continuation-invalid-response");
      return;
    }
    switch (response.type) {
      case "studio-dry-media-union/ready":
        handleReady(response);
        break;
      case "studio-dry-media-union/appended":
        void handleAppended(response).catch((error: unknown) => {
          poison(error instanceof Error
            ? error.message
            : "studio-dry-media-continuation-presentation-failed");
        });
        break;
      case "studio-dry-media-union/sealed":
        handleSealed(response);
        break;
      case "studio-dry-media-union/cancelled":
        handleCancelled(response);
        break;
      case "studio-dry-media-union/failure":
        handleFailure(response);
        break;
      default:
        closePotentialFrame(event.data);
        poison("studio-dry-media-continuation-unexpected-response");
    }
  }

  function onError(event: ErrorEventLike): void {
    event.preventDefault?.();
    poison(event.message?.slice(0, 512) || "studio-dry-media-continuation-worker-error");
  }

  worker?.addEventListener("message", onMessage);
  worker?.addEventListener("error", onError);
  worker?.addEventListener("messageerror", onError);

  const client: StudioDryMediaUnionContinuationWorkerClient = {
    get available() {
      return worker !== null && !transportClosed;
    },
    begin(inputCandidate) {
      if (state !== "idle" || !worker || transportClosed) {
        return Promise.reject(new Error("studio-dry-media-continuation-unavailable"));
      }
      const input = snapshotBeginInput(inputCandidate);
      if (!input) {
        poison("studio-dry-media-continuation-invalid-begin");
        return Promise.reject(new Error("studio-dry-media-continuation-invalid-begin"));
      }
      let reservation;
      try {
        reservation = memory64Coordinator.reserveCrossRealm({
          workload: "brush",
          logicalByteLength:
            STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_WINDOW_BYTE_LENGTH,
          preferredChunkBytes:
            STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_WINDOW_BYTE_LENGTH,
          minimumChunkBytes:
            STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_WINDOW_BYTE_LENGTH,
          budget: input.scratchBudget,
          source: {
            authority: "opfs-cas-paging",
            access: "paged-range-only",
          },
        });
      } catch (error) {
        poison(error instanceof Error
          ? error.message
          : "studio-dry-media-continuation-reservation-failed");
        return Promise.reject(error instanceof Error
          ? error
          : new Error("studio-dry-media-continuation-reservation-failed"));
      }
      if (!reservation.ok) {
        const error = new Error(
          `studio-dry-media-continuation-reservation-${reservation.terminal.reason}`,
        );
        poison(error.message);
        return Promise.reject(error);
      }
      const token = snapshotMemory64CrossRealmReservationToken(reservation.token);
      if (!token) {
        try {
          reservation.release();
        } finally {
          poison("studio-dry-media-continuation-invalid-reservation");
        }
        return Promise.reject(new Error("studio-dry-media-continuation-invalid-reservation"));
      }
      reservationToken = token;
      reservationReleaseAttempted = false;
      scratchResidentByteLength = Number(reservation.plan.workingSetBytes);
      generation = nextSafe(generation);
      requestId = nextSafe(requestId);
      strokeId = input.strokeId;
      presentationGeneration = input.presentationGeneration;
      surfaceWidth = input.width;
      surfaceHeight = input.height;
      state = "beginning";
      const pending = deferred<void>();
      beginning = {
        requestId,
        deferred: pending,
        timer: timeout("studio-dry-media-continuation-begin-timeout"),
      };
      const request: StudioDryMediaUnionContinuationRequest = {
        type: "studio-dry-media-union/begin",
        version: STUDIO_DRY_MEDIA_UNION_CONTINUATION_PROTOCOL_VERSION,
        workerGeneration: generation,
        requestId,
        strokeId: input.strokeId,
        presentationGeneration: input.presentationGeneration,
        programVersion: STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION,
        programDigest: STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST,
        width: input.width,
        height: input.height,
        transform: input.transform,
        color: input.color,
        scratchReservation: token,
      };
      if (!post(request)) {
        const error = new Error("studio-dry-media-union-continuation-begin-post-failed");
        poison(error.message);
        return pending.promise;
      }
      return pending.promise;
    },
    tryAppend(marks, cursorCandidate) {
      if (state !== "ready") {
        return Object.freeze({ ok: false, status: "rejected", reason: "not-ready" });
      }
      const outstandingCount = Number(inflight !== null) + Number(queued !== null);
      if (outstandingCount >= MAX_OUTSTANDING_APPEND_REQUESTS) {
        return Object.freeze({ ok: false, status: "backpressure", reason: "queue-full" });
      }
      if (
        (pendingContinuation !== null
          && (marks !== pendingContinuation.sourceMarks.deref()
            || cursorCandidate !== pendingContinuation.cursor))
        || (pendingContinuation === null && cursorCandidate !== undefined)
      ) {
        return Object.freeze({ ok: false, status: "rejected", reason: "invalid-cursor" });
      }
      const cursor = pendingContinuation?.cursor
        ?? createStudioDryMediaUnionContinuationPackCursor(
          plannedGroupCount,
          plannedPageCount,
        );
      if (
        !cursor
        || cursor.nextGlobalGroupIndex !== plannedGroupCount
        || cursor.nextPageIndex !== plannedPageCount
      ) {
        return Object.freeze({ ok: false, status: "rejected", reason: "invalid-cursor" });
      }
      let packed: ReturnType<typeof packStudioDryMediaUnionContinuationPageBatch>;
      try {
        packed = packStudioDryMediaUnionContinuationPageBatch(
          pendingContinuation?.authorityMarks ?? marks,
          cursor,
        );
      } catch {
        return Object.freeze({ ok: false, status: "rejected", reason: "pack-failed" });
      }
      if (packed.status !== "packed") {
        return Object.freeze({ ok: false, status: "rejected", reason: packed.reason });
      }
      const authorityMarks = pendingContinuation?.authorityMarks
        ?? (packed.inputComplete ? null : snapshotImmutableContinuationDelivery(marks));
      if (!packed.inputComplete && !authorityMarks) {
        return Object.freeze({ ok: false, status: "rejected", reason: "invalid-group" });
      }
      const physicalPageByteLength = packed.pages.reduce(
        (sum, page) => sum + page.buffer.byteLength,
        0,
      );
      if (
        !Number.isSafeInteger(physicalPageByteLength)
        || physicalPageByteLength <= 0
        || physicalPageByteLength !== packed.physicalBufferByteLength
        || packed.pages.length > STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_PAGE_COUNT
        || physicalPageByteLength > STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_INFLIGHT_BYTES
        || queuePhysicalPageByteLength + physicalPageByteLength
          > STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_INFLIGHT_BYTES
      ) {
        return Object.freeze({
          ok: false,
          status: "backpressure",
          reason: "physical-page-budget",
        });
      }
      const sequence = nextSafe(plannedSequence);
      const completion = deferred<void>();
      const job: AppendJob = {
        sequence,
        firstGroupIndex: plannedGroupCount,
        firstPageIndex: plannedPageCount,
        groupCount: packed.groupCount,
        physicalPageByteLength,
        logicalByteLength: packed.logicalByteLength,
        pageCount: packed.pages.length,
        completion,
        pages: packed.pages,
        timer: null,
        requestId: null,
      };
      receivedSequence = sequence;
      plannedSequence = sequence;
      receivedGroupCount += packed.groupCount;
      plannedGroupCount += packed.groupCount;
      receivedPageCount += packed.pages.length;
      plannedPageCount += packed.pages.length;
      queuePhysicalPageByteLength += physicalPageByteLength;
      maximumQueuePhysicalPageByteLength = Math.max(
        maximumQueuePhysicalPageByteLength,
        queuePhysicalPageByteLength,
      );
      queued = job;
      pendingContinuation = packed.inputComplete
        ? null
        : Object.freeze({
            sourceMarks: pendingContinuation?.sourceMarks ?? new WeakRef(marks),
            authorityMarks: authorityMarks!,
            cursor: packed.nextCursor!,
          });
      pump();
      return Object.freeze({
        ok: true,
        status: "accepted",
        sequence,
        firstGroupIndex: job.firstGroupIndex,
        groupCount: job.groupCount,
        pageCount: job.pageCount,
        physicalPageByteLength,
        inputComplete: packed.inputComplete,
        nextCursor: packed.nextCursor,
        completion: completion.promise,
      });
    },
    seal() {
      if (
        state !== "ready"
        || inflight !== null
        || queued !== null
        || queuePhysicalPageByteLength !== 0
        || receivedSequence !== plannedSequence
        || plannedSequence !== admittedSequence
        || admittedSequence !== presentedSequence
        || receivedGroupCount !== plannedGroupCount
        || plannedGroupCount !== admittedGroupCount
        || admittedGroupCount !== presentedGroupCount
        || receivedPageCount !== plannedPageCount
        || plannedPageCount !== admittedPageCount
        || admittedPageCount !== presentedPageCount
        || pendingContinuation !== null
      ) {
        return Promise.reject(new Error("studio-dry-media-continuation-not-quiescent"));
      }
      state = "sealing";
      requestId = nextSafe(requestId);
      const pending = deferred<StudioDryMediaUnionPagedRootReceipt>();
      sealing = {
        requestId,
        deferred: pending,
        timer: timeout("studio-dry-media-continuation-seal-timeout"),
      };
      if (!post({
        type: "studio-dry-media-union/seal",
        version: STUDIO_DRY_MEDIA_UNION_CONTINUATION_PROTOCOL_VERSION,
        workerGeneration: generation,
        requestId,
        strokeId: strokeId!,
        sequence: presentedSequence,
      })) {
        const error = new Error("studio-dry-media-union-continuation-seal-post-failed");
        poison(error.message);
        return pending.promise;
      }
      return pending.promise;
    },
    cancel() {
      if (["sealed", "cancelled", "disposed"].includes(state)) return Promise.resolve();
      if (state === "poisoned") {
        return Promise.reject(new Error(terminalReason ?? "studio-dry-media-continuation-poisoned"));
      }
      if (state === "beginning" || inflight || queued) {
        const result = Promise.resolve();
        terminalReason = "studio-dry-media-continuation-cancelled";
        if (beginning) {
          clearTimeout(beginning.timer);
          beginning.deferred.reject(new Error(terminalReason));
          beginning = null;
        }
        releasePresentation(
          true,
          new Error(terminalReason ?? "studio-dry-media-continuation-cancelled"),
        );
        rejectAppend(inflight, new Error(terminalReason));
        rejectAppend(queued, new Error(terminalReason));
        inflight = null;
        queued = null;
        pendingContinuation = null;
        queuePhysicalPageByteLength = 0;
        state = "cancelled";
        detachTransport();
        return result;
      }
      if (state === "idle") {
        terminalReason = "studio-dry-media-continuation-cancelled";
        pendingContinuation = null;
        state = "cancelled";
        detachTransport();
        return Promise.resolve();
      }
      if (state !== "ready") return Promise.resolve();
      pendingContinuation = null;
      state = "cancelling";
      requestId = nextSafe(requestId);
      const pending = deferred<void>();
      cancelling = {
        requestId,
        deferred: pending,
        timer: timeout("studio-dry-media-continuation-cancel-timeout"),
      };
      if (!post({
        type: "studio-dry-media-union/cancel",
        version: STUDIO_DRY_MEDIA_UNION_CONTINUATION_PROTOCOL_VERSION,
        workerGeneration: generation,
        requestId,
        strokeId: strokeId!,
      })) {
        const error = new Error("studio-dry-media-union-continuation-cancel-post-failed");
        poison(error.message);
        return pending.promise;
      }
      return pending.promise;
    },
    dispose() {
      if (["sealed", "cancelled", "disposed"].includes(state)) return;
      const error = new Error("studio-dry-media-continuation-disposed");
      terminalReason = error.message;
      if (beginning) {
        clearTimeout(beginning.timer);
        beginning.deferred.reject(error);
        beginning = null;
      }
      if (sealing) {
        clearTimeout(sealing.timer);
        sealing.deferred.reject(error);
        sealing = null;
      }
      if (cancelling) {
        clearTimeout(cancelling.timer);
        cancelling.deferred.reject(error);
        cancelling = null;
      }
      releasePresentation(true, new Error("studio-dry-media-continuation-disposed"));
      rejectAppend(inflight, error);
      rejectAppend(queued, error);
      inflight = null;
      queued = null;
      pendingContinuation = null;
      queuePhysicalPageByteLength = 0;
      state = "disposed";
      detachTransport();
    },
    stats() {
      const queueCount = Number(inflight !== null) + Number(queued !== null);
      return Object.freeze({
        generation,
        receivedSequence,
        plannedSequence,
        admittedSequence,
        presentedSequence,
        receivedGroupCount,
        plannedGroupCount,
        admittedGroupCount,
        presentedGroupCount,
        receivedPageCount,
        plannedPageCount,
        admittedPageCount,
        presentedPageCount,
        queueCount,
        queuePhysicalPageByteLength,
        inflightPhysicalPageByteLength: inflight?.physicalPageByteLength ?? 0,
        queuedPhysicalPageByteLength: queued?.physicalPageByteLength ?? 0,
        maximumQueuePhysicalPageByteLength,
        transferCount,
        continuationPending: pendingContinuation !== null,
        presentationPending: presenting !== null,
        scratchReservationActive:
          reservationToken !== null && !reservationReleaseAttempted,
        scratchResidentByteLength,
        state,
        disposed: ["sealed", "cancelled", "poisoned", "disposed"].includes(state),
        terminalReason,
      });
    },
  };
  return client;
}
