import { describe, expect, it } from "vitest";

import { STUDIO_TILEDOC_TILE_BYTES } from "./studio-tiledoc-geometry";
import {
  STUDIO_TILEDOC_DEFAULT_BUDGET_BYTES,
  STUDIO_TILEDOC_MIN_BUDGET_BYTES,
  StudioTileDocAccessClock,
  planStudioTileDocEviction,
  planStudioTileDocSpillCandidates,
  studioTileDocRecommendedBudgetBytes,
  type StudioTileDocResidencyEntry,
} from "./studio-tiledoc-residency";
import { StudioTiledDocumentStore } from "./studio-tiledoc-store";

const MIB = 1024 * 1024;

function entry(
  bufferId: number,
  overrides: Partial<StudioTileDocResidencyEntry> = {}
): StudioTileDocResidencyEntry {
  return {
    bufferId,
    byteLength: MIB,
    resident: true,
    lastUsed: bufferId,
    pinned: false,
    historyOnly: false,
    persisted: true,
    ...overrides,
  };
}

describe("studio tiled document residency", () => {
  it("evicts least-recently-used first and stops exactly at the budget", () => {
    const plan = planStudioTileDocEviction(
      [entry(1, { lastUsed: 50 }), entry(2, { lastUsed: 10 }), entry(3, { lastUsed: 30 }),
        entry(4, { lastUsed: 20 }), entry(5, { lastUsed: 40 })],
      { budgetBytes: 3 * MIB }
    );
    expect(plan.residentBytesBefore).toBe(5 * MIB);
    // Two evictions bring 5 MiB to 3 MiB — the two oldest.
    expect(plan.evictBufferIds).toEqual([2, 4]);
    expect(plan.residentBytesAfter).toBe(3 * MIB);
    expect(plan.shortfallBytes).toBe(0);
  });

  it("evicts history-only tiles before offscreen current tiles", () => {
    const plan = planStudioTileDocEviction(
      [
        entry(1, { lastUsed: 1 }),
        entry(2, { lastUsed: 99, historyOnly: true }),
        entry(3, { lastUsed: 2 }),
        entry(4, { lastUsed: 98, historyOnly: true }),
      ],
      { budgetBytes: 2 * MIB }
    );
    // Both history tiles go first even though they were touched most recently.
    expect(plan.evictBufferIds).toEqual([4, 2]);
    expect(plan.residentBytesAfter).toBe(2 * MIB);
  });

  it("never evicts pinned tiles and reports what they cost", () => {
    const plan = planStudioTileDocEviction(
      [entry(1, { pinned: true }), entry(2, { pinned: true }), entry(3), entry(4)],
      { budgetBytes: 1 * MIB, pinnedBufferIds: [3] }
    );
    expect(plan.evictBufferIds).toEqual([4]);
    expect(plan.pinnedBytes).toBe(3 * MIB);
    // Pinned bytes alone exceed the budget, and the planner says so instead of over-evicting.
    expect(plan.residentBytesAfter).toBe(3 * MIB);
    expect(plan.shortfallBytes).toBe(2 * MIB);
  });

  it("refuses to evict undo data that is not durable yet", () => {
    const plan = planStudioTileDocEviction(
      [
        entry(1, { historyOnly: true, persisted: false }),
        entry(2, { historyOnly: true, persisted: false }),
        entry(3, { persisted: true }),
      ],
      { budgetBytes: 1 * MIB }
    );
    expect(plan.evictBufferIds).toEqual([3]);
    expect(plan.blockedUnpersistedBytes).toBe(2 * MIB);
    expect(plan.shortfallBytes).toBe(1 * MIB);

    // The recovery path is to spill them first, oldest history first.
    expect(planStudioTileDocSpillCandidates([
      entry(1, { historyOnly: true, persisted: false, lastUsed: 9 }),
      entry(2, { historyOnly: true, persisted: false, lastUsed: 4 }),
      entry(3, { persisted: false, lastUsed: 1 }),
      entry(4, { persisted: false, pinned: true }),
      entry(5, { persisted: true }),
    ])).toEqual([2, 1, 3]);
  });

  it("ignores non-resident entries and leaves an under-budget set alone", () => {
    const plan = planStudioTileDocEviction(
      [entry(1, { resident: false }), entry(2), entry(3)],
      { budgetBytes: 4 * MIB }
    );
    expect(plan.residentBytesBefore).toBe(2 * MIB);
    expect(plan.evictBufferIds).toEqual([]);
    expect(plan.shortfallBytes).toBe(0);
  });

  it("breaks ties by buffer id so the order never depends on input order", () => {
    const forward = planStudioTileDocEviction(
      [entry(7, { lastUsed: 5 }), entry(3, { lastUsed: 5 }), entry(5, { lastUsed: 5 })],
      { budgetBytes: 1 * MIB }
    );
    const reversed = planStudioTileDocEviction(
      [entry(5, { lastUsed: 5 }), entry(3, { lastUsed: 5 }), entry(7, { lastUsed: 5 })],
      { budgetBytes: 1 * MIB }
    );
    expect(forward.evictBufferIds).toEqual([3, 5]);
    expect(reversed.evictBufferIds).toEqual([3, 5]);
  });

  it("falls back to the default budget for nonsense inputs", () => {
    expect(planStudioTileDocEviction([], {}).budgetBytes)
      .toBe(STUDIO_TILEDOC_DEFAULT_BUDGET_BYTES);
    expect(planStudioTileDocEviction([], { budgetBytes: -1 }).budgetBytes)
      .toBe(STUDIO_TILEDOC_DEFAULT_BUDGET_BYTES);
    expect(STUDIO_TILEDOC_DEFAULT_BUDGET_BYTES / STUDIO_TILEDOC_TILE_BYTES).toBe(256);
  });

  it("derives a budget from the viewport working set, clamped by device memory", () => {
    // Phone: 720-wide document, 1600px tall viewport => 2x4 tiles per layer, 20 layers, 2x overscan.
    expect(studioTileDocRecommendedBudgetBytes({
      viewportTilesPerLayer: 8,
      visibleLayerCount: 20,
      tileBytes: STUDIO_TILEDOC_TILE_BYTES,
      deviceMemoryGiB: 4,
    })).toBe(320 * MIB);

    // Desktop fit-zoom over a 4000-wide page: 8x3 tiles, 20 layers => 960 MiB wanted, which fits
    // under a quarter of 8 GiB, so the working set wins.
    expect(studioTileDocRecommendedBudgetBytes({
      viewportTilesPerLayer: 24,
      visibleLayerCount: 20,
      tileBytes: STUDIO_TILEDOC_TILE_BYTES,
      deviceMemoryGiB: 8,
    })).toBe(960 * MIB);
    expect(studioTileDocRecommendedBudgetBytes({
      viewportTilesPerLayer: 24,
      visibleLayerCount: 20,
      tileBytes: STUDIO_TILEDOC_TILE_BYTES,
      deviceMemoryGiB: 2,
    })).toBe(512 * MIB);

    // Never below the floor, and no device hint means the conservative default cap.
    expect(studioTileDocRecommendedBudgetBytes({
      viewportTilesPerLayer: 1,
      visibleLayerCount: 1,
      tileBytes: STUDIO_TILEDOC_TILE_BYTES,
      deviceMemoryGiB: 1,
    })).toBe(STUDIO_TILEDOC_MIN_BUDGET_BYTES);
    expect(studioTileDocRecommendedBudgetBytes({
      viewportTilesPerLayer: 24,
      visibleLayerCount: 20,
      tileBytes: STUDIO_TILEDOC_TILE_BYTES,
    })).toBe(STUDIO_TILEDOC_DEFAULT_BUDGET_BYTES);
  });

  it("keeps a deterministic access clock without a wall clock", () => {
    const clock = new StudioTileDocAccessClock();
    expect(clock.current).toBe(0);
    expect(clock.touch()).toBe(1);
    expect(clock.touch()).toBe(2);
    expect(clock.current).toBe(2);
  });

  it("drives the store end to end: spill, then evict to budget", () => {
    const tileBytes = 64 * 64 * 4;
    const store = new StudioTiledDocumentStore({
      documentWidth: 256,
      documentHeight: 256,
      tileSize: 64,
    });
    for (let column = 0; column < 4; column += 1) {
      store.writeTile("layer-a", column, 0, (pixels) => pixels.fill(200));
    }
    const snapshot = store.snapshot("v1");
    store.writeTile("layer-a", 0, 0, (pixels) => pixels.fill(90));
    expect(store.stats().residentBytes).toBe(5 * tileBytes);

    const budgetBytes = 3 * tileBytes;
    // Nothing is durable yet, so no eviction is legal — history would be destroyed.
    const blocked = planStudioTileDocEviction(store.describeResidency(), { budgetBytes });
    expect(blocked.evictBufferIds).toEqual([]);
    expect(blocked.blockedUnpersistedBytes).toBe(5 * tileBytes);
    expect(blocked.shortfallBytes).toBe(2 * tileBytes);

    const spill = planStudioTileDocSpillCandidates(store.describeResidency());
    expect(spill).toEqual([1, 2, 3, 4, 5]);
    for (const bufferId of spill) {
      store.markPersisted(bufferId, `tiledoc/doc/tiles/${bufferId}.bin`);
    }
    // The tile under the cursor stays pinned; the history buffer goes first.
    const viewportBufferId = store.bufferIdAt("layer-a", 0, 0) as number;
    const plan = planStudioTileDocEviction(
      store.describeResidency([viewportBufferId]),
      { budgetBytes }
    );
    expect(plan.evictBufferIds).toEqual([1, 2]);
    const applied = store.evictBuffers(plan.evictBufferIds);
    expect(applied.evicted).toEqual([1, 2]);
    expect(store.stats().residentBytes).toBe(budgetBytes);
    expect(store.readSnapshotTilePixels(snapshot, "layer-a", 0, 0)).toBeNull();
    expect(store.readTilePixels("layer-a", 0, 0)?.[0]).toBe(90);
  });
});
