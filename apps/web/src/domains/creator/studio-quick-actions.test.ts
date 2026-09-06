import { describe, expect, it, vi } from "vitest";

import {
  clampStudioQuickActionsCenter,
  DEFAULT_STUDIO_QUICK_ACTIONS,
  loadStudioQuickActionsPreferences,
  normalizeStudioQuickActionsPreferences,
  QUICK_ACTION_IDS,
  QUICK_ACTION_SLOTS,
  quickActionSlotFromVector,
  saveStudioQuickActionsPreferences,
  STUDIO_QUICK_ACTIONS_STORAGE_KEY,
  updateStudioQuickActionSlot,
  type StudioQuickActionsStorage,
} from "./studio-quick-actions";

function memoryStorage(initial: Record<string, string> = {}): StudioQuickActionsStorage & {
  values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

/** 북쪽 0°, 시계 방향 양수인 각도를 화면 좌표계 벡터로 바꾼다. */
function vectorAt(clockwiseDegrees: number, radius = 100): { dx: number; dy: number } {
  const radians = (clockwiseDegrees * Math.PI) / 180;
  return {
    dx: Math.sin(radians) * radius,
    dy: -Math.cos(radians) * radius,
  };
}

describe("studio quick actions preferences", () => {
  it("exposes the stable clockwise slots and supported action ids", () => {
    expect(QUICK_ACTION_SLOTS).toEqual([
      "north",
      "northEast",
      "southEast",
      "south",
      "southWest",
      "northWest",
    ]);
    expect(QUICK_ACTION_IDS).toEqual([
      "undo",
      "redo",
      "select",
      "pen",
      "eraser",
      "eyedropper",
      "properties",
      "duplicate",
      "delete",
      "bring-front",
      "fit-width",
      "add-bubble",
      "advanced-fill",
      "quick-mask",
      "wet-mix",
      "dodge-burn",
    ]);
  });

  it.each([undefined, null, false, 1, [], {}, { version: 2, slots: {} }, { version: 1 }])(
    "falls back to defaults for an invalid root or version: %j",
    (raw) => {
      expect(normalizeStudioQuickActionsPreferences(raw)).toEqual(DEFAULT_STUDIO_QUICK_ACTIONS);
    }
  );

  it("falls back safely for empty, corrupt, or non-object JSON", () => {
    expect(normalizeStudioQuickActionsPreferences("")).toEqual(DEFAULT_STUDIO_QUICK_ACTIONS);
    expect(normalizeStudioQuickActionsPreferences("{bad json")).toEqual(DEFAULT_STUDIO_QUICK_ACTIONS);
    expect(normalizeStudioQuickActionsPreferences("null")).toEqual(DEFAULT_STUDIO_QUICK_ACTIONS);
    expect(normalizeStudioQuickActionsPreferences("[]")).toEqual(DEFAULT_STUDIO_QUICK_ACTIONS);
  });

  it("normalizes valid object and JSON inputs field-by-field", () => {
    const raw = {
      version: 1,
      slots: {
        north: "delete",
        northEast: "unknown-action",
        southEast: "add-bubble",
        south: null,
        southWest: "fit-width",
        northWest: "properties",
        unknownSlot: "undo",
      },
    };

    const expected = {
      version: 1,
      slots: {
        north: "delete",
        northEast: DEFAULT_STUDIO_QUICK_ACTIONS.slots.northEast,
        southEast: "add-bubble",
        south: DEFAULT_STUDIO_QUICK_ACTIONS.slots.south,
        southWest: "fit-width",
        northWest: "properties",
      },
    };

    expect(normalizeStudioQuickActionsPreferences(raw)).toEqual(expected);
    expect(normalizeStudioQuickActionsPreferences(JSON.stringify(raw))).toEqual(expected);
  });

  it("preserves duplicate actions across independent slots", () => {
    const normalized = normalizeStudioQuickActionsPreferences({
      version: 1,
      slots: Object.fromEntries(QUICK_ACTION_SLOTS.map((slot) => [slot, "undo"])),
    });

    expect(Object.values(normalized.slots)).toEqual(Array.from({ length: 6 }, () => "undo"));
  });

  it("returns fresh defaults so caller mutation cannot corrupt the exported default", () => {
    const first = normalizeStudioQuickActionsPreferences(null);
    const second = normalizeStudioQuickActionsPreferences(null);

    expect(first).not.toBe(DEFAULT_STUDIO_QUICK_ACTIONS);
    expect(first.slots).not.toBe(DEFAULT_STUDIO_QUICK_ACTIONS.slots);
    expect(first.slots).not.toBe(second.slots);
    first.slots.north = "delete";
    expect(DEFAULT_STUDIO_QUICK_ACTIONS.slots.north).toBe("undo");
    expect(second.slots.north).toBe("undo");
  });

  it("updates one slot immutably and still permits duplicates", () => {
    const source = normalizeStudioQuickActionsPreferences(DEFAULT_STUDIO_QUICK_ACTIONS);
    const updated = updateStudioQuickActionSlot(source, "south", "undo");

    expect(updated).not.toBe(source);
    expect(updated.slots).not.toBe(source.slots);
    expect(source.slots.south).toBe("pen");
    expect(updated.slots.south).toBe("undo");
    expect(updated.slots.north).toBe("undo");
    expect(updated.slots.northEast).toBe(source.slots.northEast);
  });
});

describe("quickActionSlotFromVector", () => {
  it.each([
    [0, "north"],
    [60, "northEast"],
    [120, "southEast"],
    [180, "south"],
    [240, "southWest"],
    [300, "northWest"],
    [360, "north"],
  ] as const)("maps the %d° sector center to %s", (degrees, expected) => {
    const { dx, dy } = vectorAt(degrees);
    expect(quickActionSlotFromVector(dx, dy)).toBe(expected);
  });

  it("maps cardinal screen vectors deterministically", () => {
    expect(quickActionSlotFromVector(0, -100)).toBe("north");
    expect(quickActionSlotFromVector(100, 0)).toBe("southEast");
    expect(quickActionSlotFromVector(0, 100)).toBe("south");
    expect(quickActionSlotFromVector(-100, 0)).toBe("northWest");
  });

  it.each([
    [30, "northEast"],
    [90, "southEast"],
    [150, "south"],
    [210, "southWest"],
    [270, "northWest"],
    [330, "north"],
  ] as const)("assigns the exact %d° boundary clockwise to %s", (degrees, expected) => {
    const { dx, dy } = vectorAt(degrees);
    expect(quickActionSlotFromVector(dx, dy)).toBe(expected);
  });

  it.each([
    [29.99, "north"],
    [30.01, "northEast"],
    [89.99, "northEast"],
    [90.01, "southEast"],
    [149.99, "southEast"],
    [150.01, "south"],
    [209.99, "south"],
    [210.01, "southWest"],
    [269.99, "southWest"],
    [270.01, "northWest"],
    [329.99, "northWest"],
    [330.01, "north"],
  ] as const)("keeps %.2f° on the expected side of a boundary", (degrees, expected) => {
    const { dx, dy } = vectorAt(degrees);
    expect(quickActionSlotFromVector(dx, dy)).toBe(expected);
  });

  it("returns null inside and exactly on the dead zone", () => {
    expect(quickActionSlotFromVector(0, 0)).toBeNull();
    expect(quickActionSlotFromVector(10, 0)).toBeNull();
    expect(quickActionSlotFromVector(24, 0)).toBeNull();
    expect(quickActionSlotFromVector(24.001, 0)).toBe("southEast");
    expect(quickActionSlotFromVector(1, 0, 0)).toBe("southEast");
  });

  it.each([
    [Number.NaN, 10, 24],
    [10, Number.NaN, 24],
    [Number.POSITIVE_INFINITY, 0, 24],
    [0, Number.NEGATIVE_INFINITY, 24],
    [100, 0, Number.NaN],
    [100, 0, Number.POSITIVE_INFINITY],
    [100, 0, -1],
  ])("returns null for invalid vector/dead-zone input", (dx, dy, deadZone) => {
    expect(quickActionSlotFromVector(dx, dy, deadZone)).toBeNull();
  });
});

describe("clampStudioQuickActionsCenter", () => {
  const viewport = { width: 400, height: 800 };
  const options = { radius: 80, margin: 10, bottomInset: 60 };

  it("leaves a center that already fits the normal viewport unchanged", () => {
    expect(clampStudioQuickActionsCenter({ x: 200, y: 300 }, viewport, options)).toEqual({
      x: 200,
      y: 300,
    });
  });

  it("keeps the full radius, margin, and bottom inset inside a normal viewport", () => {
    expect(clampStudioQuickActionsCenter({ x: -100, y: -100 }, viewport, options)).toEqual({
      x: 90,
      y: 90,
    });
    expect(clampStudioQuickActionsCenter({ x: 999, y: 999 }, viewport, options)).toEqual({
      x: 310,
      y: 650,
    });
  });

  it("collapses overlapping limits to a finite usable midpoint in a tiny viewport", () => {
    expect(
      clampStudioQuickActionsCenter(
        { x: 999, y: -999 },
        { width: 100, height: 120 },
        { radius: 80, margin: 10, bottomInset: 20 }
      )
    ).toEqual({ x: 50, y: 50 });
  });

  it("returns finite in-bounds coordinates for invalid anchors and viewport dimensions", () => {
    const normal = clampStudioQuickActionsCenter(
      { x: Number.NaN, y: Number.POSITIVE_INFINITY },
      viewport,
      options
    );
    expect(normal).toEqual({ x: 200, y: 370 });

    const invalidViewport = clampStudioQuickActionsCenter(
      { x: Number.NaN, y: Number.NEGATIVE_INFINITY },
      { width: Number.NaN, height: -20 },
      { radius: Number.NaN, margin: Number.POSITIVE_INFINITY, bottomInset: -10 }
    );
    expect(invalidViewport).toEqual({ x: 0, y: 0 });
    expect(Number.isFinite(invalidViewport.x)).toBe(true);
    expect(Number.isFinite(invalidViewport.y)).toBe(true);
  });

  it("uses bounded defaults when options are omitted", () => {
    expect(clampStudioQuickActionsCenter({ x: 0, y: 900 }, viewport)).toEqual({
      x: 116,
      y: 684,
    });
  });
});

describe("studio quick actions persistence", () => {
  it("round-trips normalized preferences under the versioned storage key", () => {
    const storage = memoryStorage();
    const preferences = updateStudioQuickActionSlot(DEFAULT_STUDIO_QUICK_ACTIONS, "north", "delete");

    saveStudioQuickActionsPreferences(storage, preferences);

    expect([...storage.values.keys()]).toEqual([STUDIO_QUICK_ACTIONS_STORAGE_KEY]);
    expect(loadStudioQuickActionsPreferences(storage)).toEqual(preferences);
  });

  it("returns defaults for absent and corrupt persisted values", () => {
    expect(loadStudioQuickActionsPreferences(null)).toEqual(DEFAULT_STUDIO_QUICK_ACTIONS);
    expect(loadStudioQuickActionsPreferences(memoryStorage())).toEqual(DEFAULT_STUDIO_QUICK_ACTIONS);
    expect(
      loadStudioQuickActionsPreferences(
        memoryStorage({ [STUDIO_QUICK_ACTIONS_STORAGE_KEY]: "{corrupt" })
      )
    ).toEqual(DEFAULT_STUDIO_QUICK_ACTIONS);
  });

  it("does not throw when storage reads or writes fail", () => {
    const readFailure: StudioQuickActionsStorage = {
      getItem: vi.fn(() => {
        throw new Error("storage blocked");
      }),
      setItem: vi.fn(),
    };
    const writeFailure: StudioQuickActionsStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new Error("quota exceeded");
      }),
    };

    expect(loadStudioQuickActionsPreferences(readFailure)).toEqual(DEFAULT_STUDIO_QUICK_ACTIONS);
    expect(() => saveStudioQuickActionsPreferences(writeFailure, DEFAULT_STUDIO_QUICK_ACTIONS)).not.toThrow();
    expect(() => saveStudioQuickActionsPreferences(undefined, DEFAULT_STUDIO_QUICK_ACTIONS)).not.toThrow();
  });
});
