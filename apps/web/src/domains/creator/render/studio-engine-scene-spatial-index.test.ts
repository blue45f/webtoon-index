import { describe, expect, it } from "vitest";

import {
  createStudioEngineSceneSpatialIndex,
  type StudioEngineSceneSpatialEntry,
  type StudioEngineSceneSpatialEntryCandidate,
  type StudioEngineSceneSpatialPointHitResult,
  type StudioEngineSceneSpatialSearchResult,
} from "./studio-engine-scene-spatial-index";

function entry(
  id: string,
  zOrder: number,
  bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  flags: Partial<Pick<
    StudioEngineSceneSpatialEntryCandidate,
    "locked" | "hidden" | "interactive"
  >> = {},
): StudioEngineSceneSpatialEntryCandidate {
  return { id, bounds, zOrder, ...flags };
}

function requireEntries(
  result: StudioEngineSceneSpatialSearchResult,
): readonly StudioEngineSceneSpatialEntry[] {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail}`);
  return result.entries;
}

function requireHit(
  result: StudioEngineSceneSpatialPointHitResult,
): StudioEngineSceneSpatialEntry | null {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail}`);
  return result.entry;
}

describe("StudioEngineSceneSpatialIndex", () => {
  it("bulk rebuilds and searches in deterministic topmost-first document order", () => {
    const index = createStudioEngineSceneSpatialIndex();
    const result = index.rebuild([
      entry("back", -1),
      entry("beta", 10),
      entry("front", 20),
      entry("alpha", 10),
      entry("outside", 100, { minX: 50, minY: 50, maxX: 60, maxY: 60 }),
    ]);

    expect(result).toEqual({ ok: true, entryCount: 5, size: 5 });
    const found = requireEntries(index.search({
      minX: -1,
      minY: -1,
      maxX: 11,
      maxY: 11,
    }));
    expect(found.map(({ id }) => id)).toEqual(["front", "alpha", "beta", "back"]);
    expect(Object.isFrozen(found)).toBe(true);
    expect(Object.isFrozen(found[0])).toBe(true);
    expect(Object.isFrozen(found[0]!.bounds)).toBe(true);
    expect(index.getSnapshot()).toEqual({
      kind: "studio-engine-scene-spatial-index",
      version: 1,
      phase: "ready",
      size: 5,
      mutationSequence: 1,
    });
  });

  it("resolves point hits deterministically while honoring hidden, locked, and interaction flags", () => {
    const index = createStudioEngineSceneSpatialIndex();
    index.rebuild([
      entry("selectable", 5),
      entry("non-interactive", 20, undefined, { interactive: false }),
      entry("locked", 30, undefined, { locked: true }),
      entry("hidden", 40, undefined, { hidden: true }),
      entry("alpha-tie", 5),
    ]);

    expect(requireHit(index.hitTestPoint({ x: 5, y: 5 }))?.id).toBe("alpha-tie");
    expect(requireHit(index.hitTestPoint(
      { x: 5, y: 5 },
      { includeLocked: true },
    ))?.id).toBe("locked");
    expect(requireHit(index.hitTestPoint(
      { x: 5, y: 5 },
      { includeHidden: true },
    ))?.id).toBe("hidden");
    expect(requireHit(index.hitTestPoint({ x: 100, y: 100 }))).toBeNull();

    // Bounding-box edges are document hits, including zero-area entries.
    index.upsert(entry("point", 50, { minX: 10, minY: 10, maxX: 10, maxY: 10 }));
    expect(requireHit(index.hitTestPoint({ x: 10, y: 10 }))?.id).toBe("point");
  });

  it("lets area queries opt into filtering without inheriting interaction hit semantics", () => {
    const index = createStudioEngineSceneSpatialIndex();
    index.rebuild([
      entry("normal", 1),
      entry("locked", 2, undefined, { locked: true }),
      entry("passive", 3, undefined, { interactive: false }),
      entry("hidden", 4, undefined, { hidden: true }),
    ]);
    const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

    expect(requireEntries(index.search(bounds)).map(({ id }) => id)).toEqual([
      "passive",
      "locked",
      "normal",
    ]);
    expect(requireEntries(index.search(bounds, {
      includeHidden: true,
      includeLocked: false,
      interactiveOnly: true,
    })).map(({ id }) => id)).toEqual(["hidden", "normal"]);
    expect(requireEntries(index.search(bounds, { limit: 2 })).map(({ id }) => id)).toEqual([
      "passive",
      "locked",
    ]);
  });

  it("upserts new bounds and z-order without leaving stale RBush entries", () => {
    const index = createStudioEngineSceneSpatialIndex();
    const original = entry(
      "moving",
      1,
      { minX: 0, minY: 0, maxX: 5, maxY: 5 },
    );
    expect(index.upsert(original)).toMatchObject({ ok: true, replaced: false, size: 1 });
    const updated = index.upsert(entry(
      "moving",
      99,
      { minX: 100, minY: 100, maxX: 120, maxY: 120 },
    ));

    expect(updated).toMatchObject({
      ok: true,
      replaced: true,
      size: 1,
      entry: {
        id: "moving",
        zOrder: 99,
        bounds: { minX: 100, minY: 100, maxX: 120, maxY: 120 },
      },
    });
    expect(requireEntries(index.search({
      minX: -10,
      minY: -10,
      maxX: 10,
      maxY: 10,
    }))).toEqual([]);
    expect(requireEntries(index.search({
      minX: 105,
      minY: 105,
      maxX: 106,
      maxY: 106,
    })).map(({ id }) => id)).toEqual(["moving"]);

    expect(index.remove("moving")).toEqual({ ok: true, removed: true, size: 0 });
    expect(index.remove("moving")).toEqual({ ok: true, removed: false, size: 0 });
    expect(requireHit(index.hitTestPoint({ x: 110, y: 110 }))).toBeNull();
  });

  it("rebuilds atomically and does not retain caller-owned mutable bounds", () => {
    const index = createStudioEngineSceneSpatialIndex();
    const mutableBounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    index.rebuild([entry("kept", 1, mutableBounds)]);
    mutableBounds.minX = 1_000;

    expect(requireHit(index.hitTestPoint({ x: 1, y: 1 }))?.id).toBe("kept");
    expect(index.rebuild([
      entry("duplicate", 1),
      entry("duplicate", 2),
    ])).toMatchObject({ ok: false, reason: "duplicate-id" });
    expect(index.rebuild([
      entry("replacement", 1),
      {
        id: "invalid",
        zOrder: 2,
        bounds: { minX: 10, minY: 0, maxX: 0, maxY: 10 },
      },
    ])).toMatchObject({ ok: false, reason: "invalid-input" });

    expect(index.size).toBe(1);
    expect(requireHit(index.hitTestPoint({ x: 1, y: 1 }))?.id).toBe("kept");
  });

  it("fails closed at entry, query-candidate, identifier, and coordinate budgets", () => {
    const capped = createStudioEngineSceneSpatialIndex({
      limits: {
        maxEntries: 2,
        maxSearchCandidates: 1,
        maxSearchResults: 2,
        maxIdentifierCodeUnits: 8,
        maxCoordinateAbsolute: 100,
      },
    });
    expect(capped.upsert(entry("one", 1))).toMatchObject({ ok: true });
    expect(capped.upsert(entry("two", 2))).toMatchObject({ ok: true });
    expect(capped.upsert(entry("three", 3))).toMatchObject({
      ok: false,
      reason: "budget-exceeded",
    });
    expect(capped.search({
      minX: 0,
      minY: 0,
      maxX: 10,
      maxY: 10,
    })).toMatchObject({ ok: false, reason: "budget-exceeded" });
    expect(capped.search(
      { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      { limit: 3 },
    )).toMatchObject({ ok: false, reason: "invalid-input" });
    expect(capped.remove("too-long-id")).toMatchObject({
      ok: false,
      reason: "invalid-input",
    });
    expect(capped.hitTestPoint({ x: Number.NaN, y: 0 })).toMatchObject({
      ok: false,
      reason: "invalid-input",
    });
    expect(capped.upsert(entry(
      "far",
      4,
      { minX: 101, minY: 0, maxX: 102, maxY: 1 },
    ))).toMatchObject({ ok: false, reason: "invalid-input" });
    expect(capped.size).toBe(2);

    const rebuildCapped = createStudioEngineSceneSpatialIndex({
      limits: { maxEntries: 1 },
    });
    expect(rebuildCapped.rebuild([entry("a", 1), entry("b", 2)])).toMatchObject({
      ok: false,
      reason: "budget-exceeded",
    });
    expect(rebuildCapped.size).toBe(0);
  });

  it("clears and disposes deterministically", () => {
    const index = createStudioEngineSceneSpatialIndex();
    index.rebuild([entry("a", 1), entry("b", 2)]);
    expect(index.clear()).toEqual({ ok: true, entryCount: 0, size: 0 });
    expect(index.getSnapshot().mutationSequence).toBe(2);

    index.upsert(entry("c", 3));
    index.dispose();
    expect(index.getSnapshot()).toMatchObject({
      phase: "disposed",
      size: 0,
      mutationSequence: 4,
    });
    expect(index.upsert(entry("d", 4))).toMatchObject({
      ok: false,
      reason: "disposed",
    });
    expect(index.search({ minX: 0, minY: 0, maxX: 1, maxY: 1 })).toMatchObject({
      ok: false,
      reason: "disposed",
    });
    expect(index.hitTestPoint({ x: 0, y: 0 })).toMatchObject({
      ok: false,
      reason: "disposed",
    });
  });
});
