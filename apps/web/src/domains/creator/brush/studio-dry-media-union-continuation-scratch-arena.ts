import {
  allocateMemory64CrossRealmWorkerLease,
  type Memory64CrossRealmWorkerAllocationOptions,
} from "../kernel/Memory64CrossRealmWorker";

import type {
  Memory64CrossRealmAllocationAck,
  Memory64CrossRealmReservationToken,
} from "../kernel/Memory64CrossRealmProtocol";
import type { StudioWasmLinearMemoryRuntime } from "../studio-wasm64-memory-governor";

export const STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_SLOT_BYTE_LENGTH =
  64 * 1024;
export const STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_SLOT_COUNT = 512;
export const STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_WINDOW_BYTE_LENGTH =
  STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_SLOT_BYTE_LENGTH
  * STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_SLOT_COUNT;
export const STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_MAX_TILE_EDGE = 128;

const RGBA_CHANNEL_COUNT = 4;
const ZERO = BigInt(0);

export interface StudioDryMediaUnionContinuationScratchArenaOptions {
  readonly reservationToken: Memory64CrossRealmReservationToken | unknown;
  readonly webAssembly?: typeof WebAssembly | null;
  readonly allocationPort?: Memory64CrossRealmWorkerAllocationOptions["allocationPort"];
}

export interface StudioDryMediaUnionContinuationScratchTileLease {
  readonly slotIndex: number;
  readonly slotGeneration: number;
  readonly residentByteOffset: bigint;
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
  /** Exact view over the arena's WebAssembly linear memory; it owns no backing store. */
  readonly rgba: Uint8ClampedArray;
  release(): boolean;
}

export type StudioDryMediaUnionContinuationScratchTileClaimResult =
  | {
      readonly ok: true;
      readonly tile: StudioDryMediaUnionContinuationScratchTileLease;
    }
  | {
      readonly ok: false;
      readonly reason:
        | "arena-released"
        | "invalid-tile-dimensions"
        | "runtime-view-unavailable"
        | "slot-backpressure";
    };

/**
 * Primitive-only ownership accounting. It deliberately excludes the runtime,
 * reservation token, memory buffer, and tile views so diagnostics cannot extend
 * the lifetime of scratch allocations.
 */
export interface StudioDryMediaUnionContinuationScratchAccounting {
  readonly kind: "studio-dry-media-union-continuation/scratch-accounting";
  readonly version: 1;
  readonly state: "active" | "released";
  readonly linearResidentBytes: number;
  readonly slotCapacity: number;
  readonly activeSlotCount: number;
  readonly availableSlotCount: number;
  readonly usedSlotBytes: number;
  readonly usedPayloadBytes: number;
  readonly acquisitionCount: number;
  readonly tileReleaseCount: number;
  readonly backpressureCount: number;
  readonly arenaReleaseCount: number;
}

export interface StudioDryMediaUnionContinuationScratchArena {
  readonly runtime: StudioWasmLinearMemoryRuntime;
  readonly reservationToken: Memory64CrossRealmReservationToken;
  readonly reservationAck: Memory64CrossRealmAllocationAck;
  readonly authority: "scratch-only";
  readonly durablePersistenceAuthority: "opfs-cas-paging";
  readonly residentByteLength: bigint;
  readonly windowByteLength: number;
  readonly slotByteLength: number;
  readonly slotCount: number;
  readonly activeSlotCount: number;
  readonly availableSlotCount: number;
  readonly released: boolean;
  claimTile(
    dimensions:
      | Readonly<{ readonly width: number; readonly height: number }>
      | unknown,
  ): StudioDryMediaUnionContinuationScratchTileClaimResult;
  accounting(): StudioDryMediaUnionContinuationScratchAccounting;
  release(): boolean;
}

interface ActiveSlot {
  readonly slotIndex: number;
  readonly slotGeneration: number;
  readonly rgba: Uint8ClampedArray;
}

interface SnapshottedArenaOptions {
  readonly reservationToken: unknown;
  readonly webAssembly: typeof WebAssembly | null | undefined;
  readonly allocationPort: Memory64CrossRealmWorkerAllocationOptions["allocationPort"];
}

interface SnapshottedTileDimensions {
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
}

function isRecord(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ownDataEntry(
  record: object,
  key: string,
): Readonly<{ readonly present: boolean; readonly value: unknown }> | null {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor) return { present: false, value: undefined };
    return "value" in descriptor
      ? { present: true, value: descriptor.value }
      : null;
  } catch {
    return null;
  }
}

function snapshotArenaOptions(value: unknown): SnapshottedArenaOptions | null {
  if (!isRecord(value)) return null;
  const reservationToken = ownDataEntry(value, "reservationToken");
  const webAssembly = ownDataEntry(value, "webAssembly");
  const allocationPort = ownDataEntry(value, "allocationPort");
  if (
    !reservationToken
    || !reservationToken.present
    || !webAssembly
    || !allocationPort
    || (
      webAssembly.present
      && webAssembly.value !== undefined
      && webAssembly.value !== null
      && typeof webAssembly.value !== "object"
    )
    || (
      allocationPort.present
      && allocationPort.value !== undefined
      && !isRecord(allocationPort.value)
    )
  ) return null;
  return {
    reservationToken: reservationToken.value,
    webAssembly: webAssembly.value as typeof WebAssembly | null | undefined,
    allocationPort: allocationPort.value as
      | Memory64CrossRealmWorkerAllocationOptions["allocationPort"]
      | undefined,
  };
}

function snapshotTileDimensions(
  dimensions: unknown,
): SnapshottedTileDimensions | null {
  if (!isRecord(dimensions)) return null;
  const widthEntry = ownDataEntry(dimensions, "width");
  const heightEntry = ownDataEntry(dimensions, "height");
  if (!widthEntry?.present || !heightEntry?.present) return null;
  const width = widthEntry.value;
  const height = heightEntry.value;
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || (width as number) <= 0
    || (height as number) <= 0
    || (width as number)
      > STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_MAX_TILE_EDGE
    || (height as number)
      > STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_MAX_TILE_EDGE
  ) return null;
  const byteLength = (width as number) * (height as number) * RGBA_CHANNEL_COUNT;
  return byteLength <= STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_SLOT_BYTE_LENGTH
    ? Object.freeze({
        width: width as number,
        height: height as number,
        byteLength,
      })
    : null;
}

function nextSlotGeneration(previous: number): number {
  return previous >= Number.MAX_SAFE_INTEGER ? 1 : previous + 1;
}

/**
 * Creates one inactive Worker scratch arena from a main-realm-authorized lease.
 * Canonical contours and persisted tiles remain OPFS/CAS authority; this fixed
 * linear-memory window is disposable RGBA working state only.
 */
export function createStudioDryMediaUnionContinuationScratchArena(
  options: StudioDryMediaUnionContinuationScratchArenaOptions | unknown,
): StudioDryMediaUnionContinuationScratchArena {
  const snapshottedOptions = snapshotArenaOptions(options);
  if (!snapshottedOptions) {
    throw new TypeError("Dry-media union scratch options are invalid");
  }
  const workerAllocation = allocateMemory64CrossRealmWorkerLease({
    token: snapshottedOptions.reservationToken,
    requiredResidentBytes: BigInt(
      STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_WINDOW_BYTE_LENGTH,
    ),
    webAssembly: snapshottedOptions.webAssembly,
    allocationPort: snapshottedOptions.allocationPort,
  });
  const expectedResidentByteLength = BigInt(
    STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_WINDOW_BYTE_LENGTH,
  );
  if (workerAllocation.runtime.currentByteLength !== expectedResidentByteLength) {
    workerAllocation.release();
    throw new RangeError(
      "Dry-media union scratch requires an exact fixed 32 MiB Worker window",
    );
  }

  const runtimeGeneration = workerAllocation.runtime.generation;
  const activeSlots = new Map<number, ActiveSlot>();
  const slotGenerations = new Array<number>(
    STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_SLOT_COUNT,
  ).fill(0);
  let released = false;
  let usedPayloadBytes = 0;
  let acquisitionCount = 0;
  let tileReleaseCount = 0;
  let backpressureCount = 0;
  let arenaReleaseCount = 0;

  const releaseSlot = (slot: ActiveSlot): boolean => {
    if (released || activeSlots.get(slot.slotIndex) !== slot) return false;
    activeSlots.delete(slot.slotIndex);
    usedPayloadBytes -= slot.rgba.byteLength;
    tileReleaseCount += 1;
    try {
      slot.rgba.fill(0);
    } catch {
      // A detached injected runtime cannot retain usable scratch bytes.
    }
    return true;
  };

  const arena: StudioDryMediaUnionContinuationScratchArena = {
    runtime: workerAllocation.runtime,
    reservationToken: workerAllocation.token,
    reservationAck: workerAllocation.acknowledgement,
    authority: "scratch-only",
    durablePersistenceAuthority: "opfs-cas-paging",
    residentByteLength: expectedResidentByteLength,
    windowByteLength:
      STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_WINDOW_BYTE_LENGTH,
    slotByteLength:
      STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_SLOT_BYTE_LENGTH,
    slotCount: STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_SLOT_COUNT,
    get activeSlotCount() {
      return activeSlots.size;
    },
    get availableSlotCount() {
      return released
        ? 0
        : STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_SLOT_COUNT
          - activeSlots.size;
    },
    get released() {
      return released;
    },
    claimTile(dimensions) {
      if (released) return { ok: false, reason: "arena-released" };
      const snapshottedDimensions = snapshotTileDimensions(dimensions);
      if (!snapshottedDimensions) {
        return { ok: false, reason: "invalid-tile-dimensions" };
      }
      const { byteLength } = snapshottedDimensions;

      let slotIndex = -1;
      for (
        let candidate = 0;
        candidate < STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_SLOT_COUNT;
        candidate += 1
      ) {
        if (!activeSlots.has(candidate)) {
          slotIndex = candidate;
          break;
        }
      }
      if (slotIndex < 0) {
        backpressureCount += 1;
        return { ok: false, reason: "slot-backpressure" };
      }

      const residentByteOffset = BigInt(
        slotIndex
        * STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_SLOT_BYTE_LENGTH,
      );
      if (workerAllocation.runtime.generation !== runtimeGeneration) {
        return { ok: false, reason: "runtime-view-unavailable" };
      }
      const byteView = workerAllocation.runtime.createByteView(
        residentByteOffset,
        byteLength,
      );
      if (
        !byteView.ok
        || byteView.generation !== runtimeGeneration
        || byteView.view.buffer !== workerAllocation.runtime.memory.buffer
        || byteView.view.byteOffset !== Number(residentByteOffset)
        || byteView.view.byteLength !== byteLength
      ) return { ok: false, reason: "runtime-view-unavailable" };

      let rgba: Uint8ClampedArray;
      try {
        rgba = new Uint8ClampedArray(
          byteView.view.buffer,
          byteView.view.byteOffset,
          byteView.view.byteLength,
        );
        rgba.fill(0);
      } catch {
        return { ok: false, reason: "runtime-view-unavailable" };
      }
      const slotGeneration = nextSlotGeneration(slotGenerations[slotIndex]!);
      slotGenerations[slotIndex] = slotGeneration;
      const activeSlot: ActiveSlot = {
        slotIndex,
        slotGeneration,
        rgba,
      };
      activeSlots.set(slotIndex, activeSlot);
      usedPayloadBytes += byteLength;
      acquisitionCount += 1;
      let tileReleased = false;
      const tile = Object.freeze({
        slotIndex,
        slotGeneration,
        residentByteOffset,
        width: snapshottedDimensions.width,
        height: snapshottedDimensions.height,
        byteLength,
        rgba,
        release: (): boolean => {
          if (tileReleased) return false;
          tileReleased = true;
          return releaseSlot(activeSlot);
        },
      });
      return { ok: true, tile };
    },
    accounting() {
      const activeSlotCount = released ? 0 : activeSlots.size;
      return Object.freeze({
        kind: "studio-dry-media-union-continuation/scratch-accounting" as const,
        version: 1 as const,
        state: released ? "released" as const : "active" as const,
        linearResidentBytes: released
          ? 0
          : STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_WINDOW_BYTE_LENGTH,
        slotCapacity: STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_SLOT_COUNT,
        activeSlotCount,
        availableSlotCount: released
          ? 0
          : STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_SLOT_COUNT
            - activeSlotCount,
        usedSlotBytes:
          activeSlotCount
          * STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_SLOT_BYTE_LENGTH,
        usedPayloadBytes: released ? 0 : usedPayloadBytes,
        acquisitionCount,
        tileReleaseCount,
        backpressureCount,
        arenaReleaseCount,
      });
    },
    release() {
      if (released) return false;
      released = true;
      arenaReleaseCount = 1;
      for (const slot of activeSlots.values()) {
        try {
          slot.rgba.fill(0);
        } catch {
          // Cleanup still relinquishes the Worker lease if a host detached it.
        }
      }
      activeSlots.clear();
      usedPayloadBytes = 0;
      workerAllocation.release();
      return true;
    },
  };
  if (arena.runtime.currentByteLength <= ZERO) {
    arena.release();
    throw new Error("Dry-media union scratch runtime is unavailable");
  }
  return Object.freeze(arena);
}
