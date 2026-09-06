import { describe, expect, it, vi } from "vitest";

import {
  MEMORY64_CROSS_REALM_PROTOCOL_VERSION,
  type Memory64CrossRealmAllocationAck,
  type Memory64CrossRealmReservationToken,
} from "../kernel/Memory64CrossRealmProtocol";
import {
  createStudioFreehandInputMemoryBinaryCasState,
  createStudioFreehandInputMemoryBinaryCasStore,
} from "../studio-freehand-input-binary-spool-opfs-store";
import {
  STUDIO_WASM_PAGE_BYTES,
  StudioWasmLinearMemoryRuntime,
} from "../studio-wasm64-memory-governor";

import {
  STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST,
  STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION,
} from "./studio-brush-dynamics";
import {
  createStudioDryMediaUnionContinuationPackCursor,
  packStudioDryMediaUnionContinuationPageBatch,
  STUDIO_DRY_MEDIA_UNION_CONTINUATION_PROTOCOL_VERSION,
  type StudioDryMediaUnionContinuationAppendRequest,
  type StudioDryMediaUnionContinuationBeginRequest,
  type StudioDryMediaUnionContinuationCancelRequest,
  type StudioDryMediaUnionContinuationResponse,
  type StudioDryMediaUnionContinuationSealRequest,
} from "./studio-dry-media-union-continuation-protocol";
import {
  createStudioDryMediaUnionContinuationScratchArena,
  STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_SLOT_BYTE_LENGTH,
  STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_WINDOW_BYTE_LENGTH,
  type StudioDryMediaUnionContinuationScratchArena,
  type StudioDryMediaUnionContinuationScratchTileLease,
} from "./studio-dry-media-union-continuation-scratch-arena";
import { createStudioDryMediaUnionContinuationStore } from "./studio-dry-media-union-continuation-store";
import {
  StudioDryMediaUnionContinuationWorkerRuntime,
  type StudioDryMediaUnionContinuationRasterSurface,
} from "./studio-dry-media-union-continuation-worker-runtime";
import { STUDIO_DRY_MEDIA_UNION_RIBBON_CARRIER_VERSION } from "./studio-dry-media-union-ribbon-carrier";

import type { StudioDynamicBrushCoverageMark } from "../studio-dynamic-brush-coverage-renderer";

const ATLAS_RESIDENT_BYTES = 1024 * 1024 * 4;
const SCRATCH_PAGE_COUNT = BigInt(
  STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_WINDOW_BYTE_LENGTH,
) / STUDIO_WASM_PAGE_BYTES;

function reservationToken(): Memory64CrossRealmReservationToken {
  return Object.freeze({
    kind: "epoch16-memory64/cross-realm-reservation",
    version: MEMORY64_CROSS_REALM_PROTOCOL_VERSION,
    reservationId: "epoch16-dry-worker-runtime-test",
    nonce: "e".repeat(64),
    workload: "brush",
    selectedRuntime: "memory32-requested",
    authorizedResidentBytes:
      STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_WINDOW_BYTE_LENGTH.toString(),
    authorizedResidentPages: SCRATCH_PAGE_COUNT.toString(),
    minimumResidentPages: SCRATCH_PAGE_COUNT.toString(),
    acknowledgementDeadlineMilliseconds: 4_000_000_000_000,
    source: Object.freeze({
      authority: "opfs-cas-paging" as const,
      access: "paged-range-only" as const,
    }),
    canonicalWritesAllowed: false,
    persistenceWritesAllowed: false,
  });
}

function allocationAck(
  token: Memory64CrossRealmReservationToken,
): Memory64CrossRealmAllocationAck {
  return Object.freeze({
    kind: "epoch16-memory64/cross-realm-allocation-ack",
    version: MEMORY64_CROSS_REALM_PROTOCOL_VERSION,
    reservationId: token.reservationId,
    nonce: token.nonce,
    runtime: "memory32-requested",
    addressType: "i32",
    residentBytes: token.authorizedResidentBytes,
    residentPages: token.authorizedResidentPages,
  });
}

function beginRequest(
  overrides: Partial<StudioDryMediaUnionContinuationBeginRequest> = {},
): StudioDryMediaUnionContinuationBeginRequest {
  return {
    type: "studio-dry-media-union/begin",
    version: STUDIO_DRY_MEDIA_UNION_CONTINUATION_PROTOCOL_VERSION,
    workerGeneration: 1,
    requestId: 1,
    strokeId: "dry-runtime-stroke",
    presentationGeneration: 7,
    programVersion: STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION,
    programDigest: STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST,
    width: 512,
    height: 256,
    transform: [1, 0, 0, 1, 0, 0],
    color: "#68462f",
    scratchReservation: reservationToken(),
    ...overrides,
  };
}

function dryMark(
  points: readonly Readonly<{ x: number; y: number; stationIndex: number }>[],
): StudioDynamicBrushCoverageMark {
  const groups = Object.freeze(points.map(({ x, y, stationIndex }) => Object.freeze({
    stationIndex,
    polygons: Object.freeze([Object.freeze([
      x, y,
      x + 4, y,
      x, y + 4,
    ])]),
  })));
  return {
    x: points[0]?.x ?? 0,
    y: points[0]?.y ?? 0,
    radiusX: 4,
    radiusY: 4,
    angleRadians: 0,
    alpha: 1,
    color: "#68462f",
    ribbon: {
      kind: "dry-media-union-ribbon-polygon",
      version: STUDIO_DRY_MEDIA_UNION_RIBBON_CARRIER_VERSION,
      role: "stroke-union",
      polygons: groups.flatMap((group) => group.polygons),
      compositing: {
        kind: "causal-group-alpha-max",
        version: STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION,
        programDigest: STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST,
        groups,
      },
    },
  };
}

function appendRequestForMarks(
  sequence: number,
  firstGroupIndex: number,
  firstPageIndex: number,
  marks: readonly StudioDynamicBrushCoverageMark[],
): StudioDryMediaUnionContinuationAppendRequest {
  const cursor = createStudioDryMediaUnionContinuationPackCursor(
    firstGroupIndex,
    firstPageIndex,
  );
  if (!cursor) throw new Error("Expected valid pack cursor.");
  const packed = packStudioDryMediaUnionContinuationPageBatch(
    marks,
    cursor,
  );
  if (packed.status !== "packed" || !packed.inputComplete) {
    throw new Error("Expected complete bounded append fixture.");
  }
  return {
    type: "studio-dry-media-union/append",
    version: STUDIO_DRY_MEDIA_UNION_CONTINUATION_PROTOCOL_VERSION,
    workerGeneration: 1,
    requestId: sequence + 1,
    strokeId: "dry-runtime-stroke",
    sequence,
    pages: packed.pages,
  };
}

function appendRequest(
  sequence: number,
  firstGroupIndex: number,
  firstPageIndex: number,
  points: readonly Readonly<{ x: number; y: number; stationIndex: number }>[],
): StudioDryMediaUnionContinuationAppendRequest {
  return appendRequestForMarks(
    sequence,
    firstGroupIndex,
    firstPageIndex,
    [dryMark(points)],
  );
}

function spanningMark(): StudioDynamicBrushCoverageMark {
  const polygon = Object.freeze([0, 0, 32_760, 0, 0, 370]);
  const groups = Object.freeze([Object.freeze({
    stationIndex: 0,
    polygons: Object.freeze([polygon]),
  })]);
  return {
    ...dryMark([{ x: 0, y: 0, stationIndex: 0 }]),
    ribbon: {
      kind: "dry-media-union-ribbon-polygon",
      version: STUDIO_DRY_MEDIA_UNION_RIBBON_CARRIER_VERSION,
      role: "stroke-union",
      polygons: Object.freeze([polygon]),
      compositing: {
        kind: "causal-group-alpha-max",
        version: STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION,
        programDigest: STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST,
        groups,
      },
    },
  };
}

function sealRequest(sequence: number): StudioDryMediaUnionContinuationSealRequest {
  return {
    type: "studio-dry-media-union/seal",
    version: STUDIO_DRY_MEDIA_UNION_CONTINUATION_PROTOCOL_VERSION,
    workerGeneration: 1,
    requestId: sequence + 10,
    strokeId: "dry-runtime-stroke",
    sequence,
  };
}

function cancelRequest(): StudioDryMediaUnionContinuationCancelRequest {
  return {
    type: "studio-dry-media-union/cancel",
    version: STUDIO_DRY_MEDIA_UNION_CONTINUATION_PROTOCOL_VERSION,
    workerGeneration: 1,
    requestId: 99,
    strokeId: "dry-runtime-stroke",
  };
}

type CapturedBitmap = ImageBitmap & Readonly<{
  readonly rgbaSnapshot: Uint8ClampedArray;
  readonly closeCallCount: () => number;
}>;

function fakeSurface(alphas: readonly number[]) {
  let readbackIndex = 0;
  let released = false;
  const context = {
    fillStyle: "#000000",
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    restore: vi.fn(),
    getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => {
      const data = new Uint8ClampedArray(width * height * 4);
      const alpha = alphas[Math.min(readbackIndex, alphas.length - 1)] ?? 255;
      readbackIndex += 1;
      for (let offset = 0; offset < data.length; offset += 4) {
        data[offset] = 82;
        data[offset + 1] = 51;
        data[offset + 2] = 31;
        data[offset + 3] = alpha;
      }
      return { data };
    }),
  } as unknown as OffscreenCanvasRenderingContext2D;
  const surface: StudioDryMediaUnionContinuationRasterSurface = {
    canvas: {} as OffscreenCanvas,
    context,
    residentByteLength: ATLAS_RESIDENT_BYTES,
    release: vi.fn(() => {
      if (released) return false;
      released = true;
      return true;
    }),
  };
  return { surface, context };
}

function fakeScratchArena(
  token: Memory64CrossRealmReservationToken,
  capacity: number,
): StudioDryMediaUnionContinuationScratchArena {
  const backing = new ArrayBuffer(
    capacity * STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_SLOT_BYTE_LENGTH,
  );
  const active = new Map<number, StudioDryMediaUnionContinuationScratchTileLease>();
  let released = false;
  let acquisitions = 0;
  let tileReleases = 0;
  let backpressure = 0;
  let arenaReleases = 0;
  const arena = {
    runtime: {} as StudioWasmLinearMemoryRuntime,
    reservationToken: token,
    reservationAck: allocationAck(token),
    authority: "scratch-only" as const,
    durablePersistenceAuthority: "opfs-cas-paging" as const,
    residentByteLength: BigInt(
      STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_WINDOW_BYTE_LENGTH,
    ),
    windowByteLength: STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_WINDOW_BYTE_LENGTH,
    slotByteLength: STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_SLOT_BYTE_LENGTH,
    slotCount: capacity,
    get activeSlotCount() {
      return active.size;
    },
    get availableSlotCount() {
      return released ? 0 : capacity - active.size;
    },
    get released() {
      return released;
    },
    claimTile(value: unknown) {
      if (released) return { ok: false as const, reason: "arena-released" as const };
      const dimensions = value as { readonly width?: unknown; readonly height?: unknown };
      if (
        !Number.isSafeInteger(dimensions.width)
        || !Number.isSafeInteger(dimensions.height)
        || (dimensions.width as number) <= 0
        || (dimensions.height as number) <= 0
        || (dimensions.width as number) > 128
        || (dimensions.height as number) > 128
      ) return { ok: false as const, reason: "invalid-tile-dimensions" as const };
      const slotIndex = Array.from({ length: capacity }, (_, index) => index)
        .find((index) => !active.has(index));
      if (slotIndex === undefined) {
        backpressure += 1;
        return { ok: false as const, reason: "slot-backpressure" as const };
      }
      const width = dimensions.width as number;
      const height = dimensions.height as number;
      const byteLength = width * height * 4;
      const rgba = new Uint8ClampedArray(
        backing,
        slotIndex * STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_SLOT_BYTE_LENGTH,
        byteLength,
      );
      rgba.fill(0);
      let tileReleased = false;
      const tile: StudioDryMediaUnionContinuationScratchTileLease = {
        slotIndex,
        slotGeneration: 1,
        residentByteOffset: BigInt(
          slotIndex * STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_SLOT_BYTE_LENGTH,
        ),
        width,
        height,
        byteLength,
        rgba,
        release() {
          if (tileReleased || active.get(slotIndex) !== tile) return false;
          tileReleased = true;
          rgba.fill(0);
          active.delete(slotIndex);
          tileReleases += 1;
          return true;
        },
      };
      active.set(slotIndex, tile);
      acquisitions += 1;
      return { ok: true as const, tile };
    },
    accounting() {
      const usedPayloadBytes = [...active.values()].reduce(
        (sum, tile) => sum + tile.byteLength,
        0,
      );
      return Object.freeze({
        kind: "studio-dry-media-union-continuation/scratch-accounting" as const,
        version: 1 as const,
        state: released ? "released" as const : "active" as const,
        linearResidentBytes: released
          ? 0
          : STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_WINDOW_BYTE_LENGTH,
        slotCapacity: capacity,
        activeSlotCount: active.size,
        availableSlotCount: released ? 0 : capacity - active.size,
        usedSlotBytes:
          active.size * STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_SLOT_BYTE_LENGTH,
        usedPayloadBytes,
        acquisitionCount: acquisitions,
        tileReleaseCount: tileReleases,
        backpressureCount: backpressure,
        arenaReleaseCount: arenaReleases,
      });
    },
    release() {
      if (released) return false;
      for (const tile of [...active.values()]) tile.release();
      released = true;
      arenaReleases += 1;
      return true;
    },
  } satisfies StudioDryMediaUnionContinuationScratchArena;
  return arena;
}

function transferFrame(
  runtime: StudioDryMediaUnionContinuationWorkerRuntime,
  response: StudioDryMediaUnionContinuationResponse,
): void {
  if (response.type !== "studio-dry-media-union/appended") return;
  expect(runtime.acknowledgeFrameTransfer(response)).toBe(true);
  for (const tile of response.frame.tiles) tile.bitmap.close();
}

function maximumAlpha(bytes: Uint8ClampedArray): number {
  let maximum = 0;
  for (let offset = 3; offset < bytes.length; offset += 4) {
    maximum = Math.max(maximum, bytes[offset]!);
  }
  return maximum;
}

function createHarness(options: Readonly<{
  alphas?: readonly number[];
  fakeScratchCapacity?: number;
  useRealScratch?: boolean;
  surfaceFactoryError?: Error;
  bitmapFactoryError?: Error;
}> = {}) {
  const state = createStudioFreehandInputMemoryBinaryCasState();
  const store = createStudioDryMediaUnionContinuationStore(
    createStudioFreehandInputMemoryBinaryCasStore(state),
  );
  const { surface, context } = fakeSurface(options.alphas ?? [180]);
  const bitmaps: CapturedBitmap[] = [];
  let arena: StudioDryMediaUnionContinuationScratchArena | null = null;
  const allocationRelease = vi.fn();
  const order: string[] = [];
  const runtime = new StudioDryMediaUnionContinuationWorkerRuntime({
    store,
    surfaceFactory: () => {
      order.push("surface");
      if (options.surfaceFactoryError) throw options.surfaceFactoryError;
      return surface;
    },
    scratchArenaFactory: (arenaOptions) => {
      order.push("scratch");
      arena = options.useRealScratch
        ? createStudioDryMediaUnionContinuationScratchArena({
            ...arenaOptions,
            allocationPort: {
              allocate: ({ pages }: Readonly<{ pages: bigint }>) => (
                new StudioWasmLinearMemoryRuntime({
                memory: new WebAssembly.Memory({
                  initial: Number(pages),
                  maximum: Number(pages),
                }),
                addressType: "i32",
                selection: "memory32-requested",
                maximumPages: pages,
                })
              ),
              release: allocationRelease,
            },
          })
        : fakeScratchArena(
            arenaOptions.reservationToken as Memory64CrossRealmReservationToken,
            options.fakeScratchCapacity ?? 4,
          );
      return arena;
    },
    bitmapFactory: async (rgba, width, height) => {
      if (options.bitmapFactoryError) throw options.bitmapFactoryError;
      let closeCount = 0;
      const bitmap = {
        width,
        height,
        rgbaSnapshot: rgba.slice(),
        close() {
          closeCount += 1;
        },
        closeCallCount() {
          return closeCount;
        },
      } as unknown as CapturedBitmap;
      bitmaps.push(bitmap);
      return bitmap;
    },
  });
  return {
    state,
    store,
    surface,
    context,
    bitmaps,
    runtime,
    allocationRelease,
    order,
    get arena() {
      return arena;
    },
  };
}

describe("dry-media continuation Worker runtime", () => {
  it("releases scratch exactly once when surface construction throws before activation", async () => {
    const harness = createHarness({ surfaceFactoryError: new Error("surface-crashed") });
    await expect(harness.runtime.handle(beginRequest())).resolves.toMatchObject({
      type: "studio-dry-media-union/failure",
      reason: "raster-failed",
      detail: "surface-crashed",
    });
    expect(harness.order).toEqual(["scratch", "surface"]);
    expect(harness.arena?.accounting()).toMatchObject({
      state: "released",
      linearResidentBytes: 0,
      arenaReleaseCount: 1,
    });
    expect(harness.runtime.stats()).toMatchObject({ state: "idle", releaseCount: 1 });
  });

  it("uses the authorized 32 MiB linear window as tile backing and releases it after seal", async () => {
    const harness = createHarness({ useRealScratch: true, alphas: [173] });
    const ready = await harness.runtime.handle(beginRequest());
    expect(ready.type).toBe("studio-dry-media-union/ready");
    expect(harness.order).toEqual(["scratch", "surface"]);

    const append = await harness.runtime.handle(appendRequest(1, 0, 0, [
      { x: 12, y: 14, stationIndex: 0 },
    ]));
    expect(append.type).toBe("studio-dry-media-union/appended");
    expect(harness.arena?.accounting()).toMatchObject({
      linearResidentBytes: 32 * 1024 * 1024,
      activeSlotCount: 1,
      usedSlotBytes: 64 * 1024,
    });
    expect(harness.runtime.stats()).toMatchObject({
      scratchLinearResidentBytes: 32 * 1024 * 1024,
      atlasResidentBytes: 4 * 1024 * 1024,
      mainThreadGetImageDataCallCount: 0,
      mainThreadPutImageDataCallCount: 0,
      groupVisitCount: 1,
      contourVisitCount: 1,
      clearPixelArea: 64,
      readbackPixelArea: 64,
      bitmapCasWriteCount: 0,
      bitmapFrameResidentBytes: 8 * 8 * 4,
      bitmapTransferPixelArea: 8 * 8,
    });
    expect(append).toMatchObject({
      type: "studio-dry-media-union/appended",
      frame: {
        coverage: { tilePixelArea: 8 * 8 },
        tiles: [{ x: 10, y: 12, width: 8, height: 8 }],
      },
    });
    expect(harness.context.clearRect).toHaveBeenCalledWith(0, 0, 8, 8);
    expect(harness.context.clearRect).not.toHaveBeenCalledWith(0, 0, 1024, 1024);
    transferFrame(harness.runtime, append);

    const sealed = await harness.runtime.handle(sealRequest(1));
    if (sealed.type !== "studio-dry-media-union/sealed") {
      throw new Error(JSON.stringify(sealed));
    }
    expect(sealed.receipt).toMatchObject({
      residentByteLength: 0,
      hydratedByteLength: 0,
      inflightByteLength: 0,
      groupCount: 1,
    });
    await expect(harness.store.verify(sealed.receipt.rootDigest))
      .resolves.toEqual(sealed.receipt);
    expect(harness.runtime.stats()).toMatchObject({
      state: "idle",
      scratchLinearResidentBytes: 0,
      scratchUsedPayloadBytes: 0,
      atlasResidentBytes: 0,
      releaseCount: 1,
      bitmapCasWriteCount: 1,
      bitmapFrameResidentBytes: 0,
    });
    expect(harness.allocationRelease).toHaveBeenCalledTimes(1);
    expect(harness.surface.release).toHaveBeenCalledTimes(1);
  });

  it("accepts globally continuous pages, visits suffix groups once, and preserves alpha-max", async () => {
    const harness = createHarness({ alphas: [201, 41] });
    await harness.runtime.handle(beginRequest());
    const first = await harness.runtime.handle(appendRequest(1, 0, 0, [
      { x: 12, y: 12, stationIndex: 0 },
    ]));
    transferFrame(harness.runtime, first);
    const second = await harness.runtime.handle(appendRequest(2, 1, 1, [
      { x: 16, y: 16, stationIndex: 1 },
    ]));
    expect(second.type).toBe("studio-dry-media-union/appended");
    expect(maximumAlpha(harness.bitmaps.at(-1)!.rgbaSnapshot)).toBe(201);
    expect(harness.runtime.stats()).toMatchObject({
      sequence: 2,
      admittedGroupCount: 2,
      persistedContourPageCount: 2,
      groupVisitCount: 2,
      contourVisitCount: 2,
      tileTaskCount: 2,
      getImageDataCallCount: 2,
      bitmapTransferCount: 2,
      bitmapCasWriteCount: 0,
    });
    transferFrame(harness.runtime, second);

    const sealed = await harness.runtime.handle(sealRequest(2));
    if (sealed.type !== "studio-dry-media-union/sealed") {
      throw new Error(JSON.stringify(sealed));
    }
    const opened = await harness.store.open(sealed.receipt.rootDigest);
    const bitmapPage = await harness.store.getBitmapPage(opened!.bitmapPages[0]!);
    expect(maximumAlpha(bitmapPage!.rgba)).toBe(201);
  });

  it("rejects a backward causal station before raster, CAS, or cursor mutation", async () => {
    const harness = createHarness();
    await harness.runtime.handle(beginRequest());
    const first = await harness.runtime.handle(appendRequest(1, 0, 0, [
      { x: 12, y: 12, stationIndex: 7 },
    ]));
    transferFrame(harness.runtime, first);
    const casSize = harness.state.cas.size;
    const failed = await harness.runtime.handle(appendRequest(2, 1, 1, [
      { x: 16, y: 16, stationIndex: 6 },
    ]));

    expect(failed).toMatchObject({
      type: "studio-dry-media-union/failure",
      reason: "invalid-state",
    });
    expect(harness.runtime.stats()).toMatchObject({
      state: "active",
      sequence: 1,
      admittedGroupCount: 1,
      groupVisitCount: 1,
      contourVisitCount: 1,
    });
    expect(harness.state.cas.size).toBe(casSize);
    await harness.runtime.handle(cancelRequest());
  });

  it("evicts and hydrates exact CAS tiles without retaining more scratch slots", async () => {
    const harness = createHarness({ fakeScratchCapacity: 2 });
    await harness.runtime.handle(beginRequest());
    const first = await harness.runtime.handle(appendRequest(1, 0, 0, [
      { x: 12, y: 12, stationIndex: 0 },
      { x: 140, y: 12, stationIndex: 1 },
    ]));
    transferFrame(harness.runtime, first);
    const second = await harness.runtime.handle(appendRequest(2, 2, 1, [
      { x: 268, y: 12, stationIndex: 2 },
    ]));
    transferFrame(harness.runtime, second);
    const third = await harness.runtime.handle(appendRequest(3, 3, 2, [
      { x: 12, y: 12, stationIndex: 3 },
    ]));
    transferFrame(harness.runtime, third);

    expect(harness.runtime.stats()).toMatchObject({
      sequence: 3,
      admittedGroupCount: 4,
      activeTileCount: 2,
      tileEvictionCount: 2,
      tileHydrationCount: 1,
    });
    expect(harness.arena?.accounting().activeSlotCount).toBe(2);
    await harness.runtime.handle(cancelRequest());
    expect(harness.runtime.stats()).toMatchObject({
      state: "idle",
      scratchLinearResidentBytes: 0,
      releaseCount: 1,
    });
  });

  it("poisons and releases all scratch before exposing a partial CAS append", async () => {
    const harness = createHarness();
    await harness.runtime.handle(beginRequest());
    harness.state.failNextOperation = "put";
    const failed = await harness.runtime.handle(appendRequest(1, 0, 0, [
      { x: 12, y: 12, stationIndex: 0 },
    ]));

    expect(failed).toMatchObject({
      type: "studio-dry-media-union/failure",
      reason: "store-failed",
    });
    expect(harness.runtime.stats()).toMatchObject({
      state: "idle",
      sequence: 0,
      admittedGroupCount: 0,
      activeTileCount: 0,
      scratchLinearResidentBytes: 0,
      releaseCount: 1,
    });
    expect(harness.state.rootWriteDigests).toEqual([]);
    expect(harness.bitmaps).toEqual([]);
  });

  it("keeps raster failures distinct from store failures and releases transient sources", async () => {
    const harness = createHarness({ bitmapFactoryError: new Error("bitmap-crashed") });
    await harness.runtime.handle(beginRequest());
    const failed = await harness.runtime.handle(appendRequest(1, 0, 0, [
      { x: 12, y: 12, stationIndex: 0 },
    ]));

    expect(failed).toMatchObject({
      type: "studio-dry-media-union/failure",
      reason: "raster-failed",
      detail: "bitmap-crashed",
    });
    expect(harness.runtime.stats()).toMatchObject({
      state: "idle",
      bitmapSourceTransientBytes: 0,
      bitmapFrameResidentBytes: 0,
      releaseCount: 1,
    });
  });

  it("classifies seal persistence failure and releases scratch and frame ownership once", async () => {
    const harness = createHarness();
    await harness.runtime.handle(beginRequest());
    const appended = await harness.runtime.handle(appendRequest(1, 0, 0, [
      { x: 12, y: 12, stationIndex: 0 },
    ]));
    transferFrame(harness.runtime, appended);
    harness.state.failNextOperation = "put";

    const failed = await harness.runtime.handle(sealRequest(1));
    expect(failed).toMatchObject({
      type: "studio-dry-media-union/failure",
      reason: "store-failed",
    });
    expect(harness.runtime.stats()).toMatchObject({
      state: "idle",
      scratchLinearResidentBytes: 0,
      bitmapFrameResidentBytes: 0,
      releaseCount: 1,
    });
    expect(harness.surface.release).toHaveBeenCalledTimes(1);
    expect(harness.state.rootWriteDigests).toEqual([]);
  });

  it("persists a fully off-surface canonical suffix with an exact empty-frame receipt", async () => {
    const harness = createHarness();
    await harness.runtime.handle(beginRequest());
    const appended = await harness.runtime.handle(appendRequest(1, 0, 0, [
      { x: 4_000, y: 4_000, stationIndex: 0 },
    ]));

    expect(appended).toMatchObject({
      type: "studio-dry-media-union/appended",
      frame: {
        status: "rendered",
        coverage: {
          admittedGroupCount: 1,
          visibleGroupCount: 0,
          contourVisitCount: 0,
          coordinateVisitCount: 0,
          tileCount: 0,
          tilePixelArea: 0,
          rasterPixelArea: 0,
        },
        tiles: [],
      },
    });
    expect(harness.runtime.stats()).toMatchObject({
      sequence: 1,
      admittedGroupCount: 1,
      activeTileCount: 0,
      getImageDataCallCount: 0,
      contourCasWriteCount: 1,
      bitmapCasWriteCount: 0,
    });

    transferFrame(harness.runtime, appended);

    const sealed = await harness.runtime.handle(sealRequest(1));
    if (sealed.type !== "studio-dry-media-union/sealed") {
      throw new Error(JSON.stringify(sealed));
    }
    expect(sealed.receipt).toMatchObject({ bitmapPageCount: 0, pageCount: 1 });
    await expect(harness.store.verify(sealed.receipt.rootDigest))
      .resolves.toEqual(sealed.receipt);
  });

  it("preflights a 513-tile append before scratch mutation or CAS writes", async () => {
    const harness = createHarness({ fakeScratchCapacity: 2 });
    await harness.runtime.handle(beginRequest({ width: 32_768, height: 384 }));
    const failed = await harness.runtime.handle(appendRequest(
      1,
      0,
      0,
      Array.from({ length: 513 }, (_, index) => ({
        x: (index % 256) * 128 + 12,
        y: Math.floor(index / 256) * 128 + 12,
        stationIndex: index,
      })),
    ));

    expect(failed).toMatchObject({
      type: "studio-dry-media-union/failure",
      reason: "invalid-state",
    });
    expect(harness.runtime.stats()).toMatchObject({
      state: "active",
      sequence: 0,
      admittedGroupCount: 0,
      activeTileCount: 0,
      contourCasWriteCount: 0,
      bitmapCasWriteCount: 0,
    });
    expect(harness.state.cas.size).toBe(0);
    await harness.runtime.handle(cancelRequest());
  });

  it("rejects one raster group wider than the fixed atlas without tile-prefix replay", async () => {
    const harness = createHarness({ fakeScratchCapacity: 2 });
    await harness.runtime.handle(beginRequest({ width: 32_768, height: 384 }));
    const failed = await harness.runtime.handle(appendRequestForMarks(
      1,
      0,
      0,
      [spanningMark()],
    ));

    expect(failed).toMatchObject({
      type: "studio-dry-media-union/failure",
      reason: "invalid-state",
    });
    expect(harness.runtime.stats()).toMatchObject({
      sequence: 0,
      groupVisitCount: 0,
      contourVisitCount: 0,
      coordinateVisitCount: 0,
      activeTileCount: 0,
    });
    await harness.runtime.handle(cancelRequest());
  });

  it("rejects accessor-bearing messages without executing application getters", async () => {
    const harness = createHarness();
    let getterCalls = 0;
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostile, "type", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "studio-dry-media-union/begin";
      },
    });

    await expect(harness.runtime.handle(hostile)).resolves.toMatchObject({
      type: "studio-dry-media-union/failure",
      reason: "invalid-message",
    });
    expect(getterCalls).toBe(0);
    expect(harness.runtime.stats().state).toBe("idle");
  });
});
