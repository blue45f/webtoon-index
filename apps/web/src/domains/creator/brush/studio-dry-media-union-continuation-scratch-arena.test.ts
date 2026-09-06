import { describe, expect, it, vi } from "vitest";

import {
  MEMORY64_CROSS_REALM_PROTOCOL_VERSION,
  type Memory64CrossRealmReservationToken,
} from "../kernel/Memory64CrossRealmProtocol";
import {
  STUDIO_WASM_PAGE_BYTES,
  StudioWasmLinearMemoryRuntime,
} from "../studio-wasm64-memory-governor";

import {
  createStudioDryMediaUnionContinuationScratchArena,
  STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_MAX_TILE_EDGE,
  STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_SLOT_BYTE_LENGTH,
  STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_SLOT_COUNT,
  STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_WINDOW_BYTE_LENGTH,
  type StudioDryMediaUnionContinuationScratchArena,
} from "./studio-dry-media-union-continuation-scratch-arena";

const WINDOW_PAGES = BigInt(
  STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_WINDOW_BYTE_LENGTH,
) / STUDIO_WASM_PAGE_BYTES;

function reservationToken(): Memory64CrossRealmReservationToken {
  return Object.freeze({
    kind: "epoch16-memory64/cross-realm-reservation",
    version: MEMORY64_CROSS_REALM_PROTOCOL_VERSION,
    reservationId: "epoch16-xrealm-dry-media-scratch-test",
    nonce: "d".repeat(64),
    workload: "brush",
    selectedRuntime: "memory32-requested",
    authorizedResidentBytes: STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_WINDOW_BYTE_LENGTH
      .toString(),
    authorizedResidentPages: WINDOW_PAGES.toString(),
    minimumResidentPages: WINDOW_PAGES.toString(),
    acknowledgementDeadlineMilliseconds: 4_000_000_000_000,
    source: Object.freeze({
      authority: "opfs-cas-paging" as const,
      access: "paged-range-only" as const,
    }),
    canonicalWritesAllowed: false,
    persistenceWritesAllowed: false,
  });
}

function createArena(): Readonly<{
  arena: StudioDryMediaUnionContinuationScratchArena;
  releaseRuntime: ReturnType<typeof vi.fn>;
  allocateRuntime: ReturnType<typeof vi.fn>;
}> {
  const releaseRuntime = vi.fn();
  const allocateRuntime = vi.fn(({ pages }: Readonly<{ pages: bigint }>) => (
    new StudioWasmLinearMemoryRuntime({
      memory: new WebAssembly.Memory({
        initial: Number(pages),
        maximum: Number(pages),
      }),
      addressType: "i32",
      selection: "memory32-requested",
      maximumPages: pages,
    })
  ));
  const arena = createStudioDryMediaUnionContinuationScratchArena({
    reservationToken: reservationToken(),
    allocationPort: {
      allocate: allocateRuntime,
      release: releaseRuntime,
    },
  });
  return { arena, releaseRuntime, allocateRuntime };
}

function expectTile(
  result: ReturnType<StudioDryMediaUnionContinuationScratchArena["claimTile"]>,
) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Expected tile claim, received ${result.reason}`);
  return result.tile;
}

describe("Studio dry-media union continuation Memory64 scratch arena", () => {
  it("maps a fixed 32 MiB window into 512 exact 64 KiB slots sharing one runtime buffer", () => {
    const { arena, allocateRuntime } = createArena();
    const tile = expectTile(arena.claimTile({
      width: STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_MAX_TILE_EDGE,
      height: STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_MAX_TILE_EDGE,
    }));

    expect(STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_SLOT_BYTE_LENGTH)
      .toBe(64 * 1024);
    expect(STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_SLOT_COUNT).toBe(512);
    expect(arena.windowByteLength).toBe(32 * 1024 * 1024);
    expect(arena.residentByteLength).toBe(BigInt(32 * 1024 * 1024));
    expect(tile.slotIndex).toBe(0);
    expect(tile.residentByteOffset).toBe(BigInt(0));
    expect(tile.byteLength).toBe(64 * 1024);
    expect(tile.rgba.buffer).toBe(arena.runtime.memory.buffer);
    expect(tile.rgba.byteOffset).toBe(0);
    expect(tile.rgba.byteLength).toBe(64 * 1024);
    expect(allocateRuntime).toHaveBeenCalledTimes(1);
    expect(arena.accounting()).toMatchObject({
      linearResidentBytes: 32 * 1024 * 1024,
      activeSlotCount: 1,
      usedSlotBytes: 64 * 1024,
      usedPayloadBytes: 64 * 1024,
      acquisitionCount: 1,
    });

    tile.release();
    arena.release();
  });

  it("rejects malformed or oversized tile dimensions without consuming a slot", () => {
    const { arena } = createArena();
    const malformed = [
      { width: 0, height: 1 },
      { width: 1, height: 0 },
      { width: -1, height: 1 },
      { width: 1.5, height: 1 },
      { width: Number.NaN, height: 1 },
      { width: Number.POSITIVE_INFINITY, height: 1 },
      { width: Number.MAX_SAFE_INTEGER, height: 1 },
      {
        width: STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_MAX_TILE_EDGE + 1,
        height: 1,
      },
      {
        width: 1,
        height: STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_MAX_TILE_EDGE + 1,
      },
    ];

    for (const dimensions of malformed) {
      expect(arena.claimTile(dimensions)).toEqual({
        ok: false,
        reason: "invalid-tile-dimensions",
      });
    }
    let getterCalls = 0;
    expect(arena.claimTile({
      get width() {
        getterCalls += 1;
        throw new Error("must not run");
      },
      height: 1,
    })).toEqual({
      ok: false,
      reason: "invalid-tile-dimensions",
    });
    expect(getterCalls).toBe(0);
    expect(arena.activeSlotCount).toBe(0);
    expect(arena.availableSlotCount).toBe(512);
    arena.release();
  });

  it("reports bounded backpressure after all 512 slots are resident", () => {
    const { arena } = createArena();
    const tiles = Array.from(
      { length: STUDIO_DRY_MEDIA_UNION_CONTINUATION_SCRATCH_SLOT_COUNT },
      () => expectTile(arena.claimTile({ width: 128, height: 128 })),
    );

    expect(tiles.map((tile) => tile.slotIndex)).toEqual(
      Array.from({ length: 512 }, (_, index) => index),
    );
    expect(arena.activeSlotCount).toBe(512);
    expect(arena.availableSlotCount).toBe(0);
    expect(arena.claimTile({ width: 1, height: 1 })).toEqual({
      ok: false,
      reason: "slot-backpressure",
    });
    expect(arena.accounting()).toMatchObject({
      activeSlotCount: 512,
      availableSlotCount: 0,
      usedSlotBytes: 32 * 1024 * 1024,
      usedPayloadBytes: 32 * 1024 * 1024,
      acquisitionCount: 512,
      backpressureCount: 1,
    });

    arena.release();
  });

  it("zeroes and deterministically reuses the lowest released slot", () => {
    const { arena } = createArena();
    const first = expectTile(arena.claimTile({ width: 4, height: 4 }));
    const second = expectTile(arena.claimTile({ width: 4, height: 4 }));
    const third = expectTile(arena.claimTile({ width: 4, height: 4 }));
    second.rgba.fill(231);

    expect(second.release()).toBe(true);
    expect(second.release()).toBe(false);
    expect([...second.rgba]).toEqual(new Array<number>(64).fill(0));
    const reusedSecond = expectTile(arena.claimTile({ width: 4, height: 4 }));
    expect(reusedSecond.slotIndex).toBe(1);
    expect(reusedSecond.slotGeneration).toBe(second.slotGeneration + 1);
    expect([...reusedSecond.rgba]).toEqual(new Array<number>(64).fill(0));

    expect(first.release()).toBe(true);
    const reusedFirst = expectTile(arena.claimTile({ width: 1, height: 1 }));
    expect(reusedFirst.slotIndex).toBe(0);
    expect(third.slotIndex).toBe(2);
    arena.release();
  });

  it("returns an exact short RGBA view for a document-edge tile", () => {
    const { arena } = createArena();
    const edge = expectTile(arena.claimTile({ width: 17, height: 9 }));

    expect(edge.width).toBe(17);
    expect(edge.height).toBe(9);
    expect(edge.byteLength).toBe(17 * 9 * 4);
    expect(edge.rgba.byteLength).toBe(17 * 9 * 4);
    expect(edge.rgba.buffer).toBe(arena.runtime.memory.buffer);
    expect(edge.rgba.byteOffset).toBe(0);
    expect(edge.rgba.byteLength).toBeLessThan(arena.slotByteLength);
    const accounting = arena.accounting();
    expect(accounting.usedSlotBytes).toBe(64 * 1024);
    expect(accounting.usedPayloadBytes).toBe(17 * 9 * 4);
    expect(Object.values(accounting).every((value) => (
      typeof value === "string" || typeof value === "number"
    ))).toBe(true);

    arena.release();
  });

  it("zeroes live views and returns the Worker lease exactly once on release", () => {
    const { arena, releaseRuntime } = createArena();
    const first = expectTile(arena.claimTile({ width: 2, height: 2 }));
    const second = expectTile(arena.claimTile({ width: 3, height: 1 }));
    first.rgba.fill(71);
    second.rgba.fill(92);

    expect(arena.activeSlotCount).toBe(2);
    expect(arena.availableSlotCount).toBe(510);
    expect(arena.authority).toBe("scratch-only");
    expect(arena.durablePersistenceAuthority).toBe("opfs-cas-paging");
    expect(arena.release()).toBe(true);
    expect(arena.release()).toBe(false);
    expect(releaseRuntime).toHaveBeenCalledTimes(1);
    expect([...first.rgba]).toEqual(new Array<number>(16).fill(0));
    expect([...second.rgba]).toEqual(new Array<number>(12).fill(0));
    expect(arena.released).toBe(true);
    expect(arena.activeSlotCount).toBe(0);
    expect(arena.availableSlotCount).toBe(0);
    expect(first.release()).toBe(false);
    expect(arena.claimTile({ width: 1, height: 1 })).toEqual({
      ok: false,
      reason: "arena-released",
    });
    expect(arena.accounting()).toMatchObject({
      state: "released",
      linearResidentBytes: 0,
      activeSlotCount: 0,
      usedSlotBytes: 0,
      usedPayloadBytes: 0,
      arenaReleaseCount: 1,
    });
  });

  it("rejects accessor options before allocation and contains a hostile release hook", () => {
    let getterCalls = 0;
    const allocateRuntime = vi.fn();
    const hostileOptions = {
      get reservationToken() {
        getterCalls += 1;
        throw new Error("must not run");
      },
      allocationPort: { allocate: allocateRuntime },
    };
    expect(() => createStudioDryMediaUnionContinuationScratchArena(
      hostileOptions,
    )).toThrow(TypeError);
    expect(getterCalls).toBe(0);
    expect(allocateRuntime).not.toHaveBeenCalled();

    const hostileRelease = vi.fn(() => {
      throw new Error("release failed");
    });
    const arena = createStudioDryMediaUnionContinuationScratchArena({
      reservationToken: reservationToken(),
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
        release: hostileRelease,
      },
    });
    expect(arena.release()).toBe(true);
    expect(arena.release()).toBe(false);
    expect(hostileRelease).toHaveBeenCalledTimes(1);
    expect(arena.accounting()).toMatchObject({
      state: "released",
      linearResidentBytes: 0,
      arenaReleaseCount: 1,
    });
  });
});
