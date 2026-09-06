import { describe, expect, it } from "vitest";

import {
  createStudioFloatingSurfaceLayout,
  loadStudioFloatingSurfaceLayout,
  moveStudioFloatingSurfaceRect,
  normalizeStudioFloatingSurfaceLayout,
  resizeStudioFloatingSurfaceRect,
  resizeStudioFloatingSurfaceRectFromEdge,
  resolveStudioFloatingSurfaceDock,
  resolveStudioFloatingSurfaceRect,
  saveStudioFloatingSurfaceLayout,
  setStudioFloatingSurfaceDock,
  setStudioFloatingSurfaceLock,
  studioFloatingSurfaceLayoutsEqual,
  STUDIO_FLOATING_SURFACE_MAX_SERIALIZED_LENGTH,
  type StudioFloatingSurfaceConstraints,
  type StudioFloatingSurfaceLayout,
  type StudioFloatingSurfaceStorage,
} from "./studio-floating-surface";

const VIEWPORT = {
  width: 1_000,
  height: 800,
  insetTop: 60,
  insetRight: 10,
  insetBottom: 10,
  insetLeft: 10,
} as const;

const CONSTRAINTS: StudioFloatingSurfaceConstraints = {
  minWidth: 240,
  minHeight: 200,
  maxWidth: 600,
  maxHeight: 700,
  snapDistance: 12,
};

const FALLBACK: StudioFloatingSurfaceLayout = Object.freeze({
  version: 2,
  xRatio: 1,
  yRatio: 0,
  width: 300,
  height: 400,
  dock: "free",
  positionLocked: false,
  sizeLocked: false,
});

function memoryStorage(initial: Record<string, string> = {}):
  StudioFloatingSurfaceStorage & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

describe("studio floating surface geometry", () => {
  it("rebuilds an exact bounded v2 allowlist from untrusted input", () => {
    const normalized = normalizeStudioFloatingSurfaceLayout({
      version: 2,
      xRatio: 7,
      yRatio: -3,
      width: 412.7,
      height: Number.POSITIVE_INFINITY,
      dock: "right",
      positionLocked: true,
      sizeLocked: "yes",
      providerToken: "must-drop",
    }, FALLBACK);

    expect(normalized).toEqual({
      version: 2,
      xRatio: 1,
      yRatio: 0,
      width: 413,
      height: 400,
      dock: "right",
      positionLocked: true,
      sizeLocked: false,
    });
    expect(Object.keys(normalized)).toEqual([
      "version",
      "xRatio",
      "yRatio",
      "width",
      "height",
      "dock",
      "positionLocked",
      "sizeLocked",
    ]);
    expect(Object.isFrozen(normalized)).toBe(true);
  });

  it("migrates the phase-one v1 rectangle without losing its coordinates", () => {
    expect(normalizeStudioFloatingSurfaceLayout({
      version: 1,
      xRatio: 0.375,
      yRatio: 0.625,
      width: 444,
      height: 555,
      dock: "left",
      positionLocked: true,
    }, FALLBACK)).toEqual({
      version: 2,
      xRatio: 0.375,
      yRatio: 0.625,
      width: 444,
      height: 555,
      dock: "free",
      positionLocked: false,
      sizeLocked: false,
    });
  });

  it("restores the default right-top placement inside viewport insets", () => {
    expect(resolveStudioFloatingSurfaceRect(
      FALLBACK,
      VIEWPORT,
      CONSTRAINTS,
      FALLBACK,
    )).toEqual({
      x: 690,
      y: 60,
      width: 300,
      height: 400,
    });
  });

  it("round-trips pixels through ratios and survives viewport changes", () => {
    const layout = createStudioFloatingSurfaceLayout({
      x: 350,
      y: 210,
      width: 320,
      height: 420,
    }, VIEWPORT, CONSTRAINTS);

    expect(resolveStudioFloatingSurfaceRect(
      layout,
      VIEWPORT,
      CONSTRAINTS,
      FALLBACK,
    )).toEqual({
      x: 350,
      y: 210,
      width: 320,
      height: 420,
    });

    const wider = resolveStudioFloatingSurfaceRect(
      layout,
      { ...VIEWPORT, width: 1_400 },
      CONSTRAINTS,
      FALLBACK,
    );
    expect(wider.x).toBeGreaterThan(350);
    expect(wider.y).toBe(210);
  });

  it("keeps explicit edge docks attached while preserving the free-axis ratio", () => {
    const source = createStudioFloatingSurfaceLayout({
      x: 350,
      y: 210,
      width: 320,
      height: 420,
    }, VIEWPORT, CONSTRAINTS, { dock: "right" });
    expect(source.dock).toBe("right");
    expect(resolveStudioFloatingSurfaceRect(
      source,
      VIEWPORT,
      CONSTRAINTS,
      FALLBACK,
    )).toEqual({
      x: 670,
      y: 210,
      width: 320,
      height: 420,
    });
    expect(resolveStudioFloatingSurfaceRect(
      source,
      { ...VIEWPORT, width: 1_400 },
      CONSTRAINTS,
      FALLBACK,
    ).x).toBe(1_070);
  });

  it("keeps moves visible, snaps near every safe edge, and reports the nearest dock", () => {
    const start = { x: 20, y: 70, width: 300, height: 400 };
    const leftTop = moveStudioFloatingSurfaceRect(
      start,
      -4,
      -5,
      VIEWPORT,
      CONSTRAINTS,
      true,
    );
    expect(leftTop).toEqual({ x: 10, y: 60, width: 300, height: 400 });
    expect(resolveStudioFloatingSurfaceDock(
      leftTop,
      VIEWPORT,
      CONSTRAINTS.snapDistance!,
    )).toBe("left");

    const rightBottom = moveStudioFloatingSurfaceRect(
      start,
      10_000,
      10_000,
      VIEWPORT,
      CONSTRAINTS,
      true,
    );
    expect(rightBottom).toEqual({ x: 690, y: 390, width: 300, height: 400 });
    expect(resolveStudioFloatingSurfaceDock(
      rightBottom,
      VIEWPORT,
      CONSTRAINTS.snapDistance!,
    )).toBe("right");
  });

  it("resizes from the bottom-right while enforcing panel and viewport bounds", () => {
    expect(resizeStudioFloatingSurfaceRect(
      { x: 650, y: 300, width: 300, height: 300 },
      500,
      500,
      VIEWPORT,
      CONSTRAINTS,
    )).toEqual({
      x: 650,
      y: 300,
      width: 340,
      height: 490,
    });

    expect(resizeStudioFloatingSurfaceRect(
      { x: 100, y: 100, width: 300, height: 300 },
      -500,
      -500,
      VIEWPORT,
      CONSTRAINTS,
    )).toEqual({
      x: 100,
      y: 100,
      width: 240,
      height: 200,
    });
  });

  it("resizes from west and north edges while keeping the opposite edges anchored", () => {
    expect(resizeStudioFloatingSurfaceRectFromEdge(
      { x: 690, y: 200, width: 300, height: 300 },
      -40,
      0,
      "w",
      VIEWPORT,
      CONSTRAINTS,
    )).toEqual({
      x: 650,
      y: 200,
      width: 340,
      height: 300,
    });
    expect(resizeStudioFloatingSurfaceRectFromEdge(
      { x: 300, y: 200, width: 300, height: 300 },
      0,
      -50,
      "n",
      VIEWPORT,
      CONSTRAINTS,
    )).toEqual({
      x: 300,
      y: 150,
      width: 300,
      height: 350,
    });
  });

  it("updates dock and lock fields immutably", () => {
    const docked = setStudioFloatingSurfaceDock(FALLBACK, "left");
    const positionLocked = setStudioFloatingSurfaceLock(docked, "position", true);
    const sizeLocked = setStudioFloatingSurfaceLock(positionLocked, "size", true);

    expect(sizeLocked).toMatchObject({
      dock: "left",
      positionLocked: true,
      sizeLocked: true,
    });
    expect(FALLBACK).toMatchObject({
      dock: "free",
      positionLocked: false,
      sizeLocked: false,
    });
  });

  it("compares normalized layout values without relying on identity", () => {
    const clone = { ...FALLBACK };
    expect(studioFloatingSurfaceLayoutsEqual(FALLBACK, clone)).toBe(true);
    expect(studioFloatingSurfaceLayoutsEqual(
      FALLBACK,
      { ...clone, xRatio: 0.5 },
    )).toBe(false);
    expect(studioFloatingSurfaceLayoutsEqual(
      FALLBACK,
      { ...clone, positionLocked: true },
    )).toBe(false);
    expect(studioFloatingSurfaceLayoutsEqual(undefined, undefined)).toBe(true);
  });
});

describe("studio floating surface bounded storage adapter", () => {
  it("writes and reads only the exact UI layout fields", () => {
    const storage = memoryStorage();
    expect(saveStudioFloatingSurfaceLayout(storage, "surface", {
      ...FALLBACK,
      xRatio: 0.432145,
      dock: "right",
      positionLocked: true,
    })).toBe(true);

    const encoded = storage.values.get("surface")!;
    expect(JSON.parse(encoded)).toEqual({
      version: 2,
      xRatio: 0.4321,
      yRatio: 0,
      width: 300,
      height: 400,
      dock: "right",
      positionLocked: true,
      sizeLocked: false,
    });
    expect(loadStudioFloatingSurfaceLayout(
      storage,
      "surface",
      FALLBACK,
    )).toEqual({
      version: 2,
      xRatio: 0.4321,
      yRatio: 0,
      width: 300,
      height: 400,
      dock: "right",
      positionLocked: true,
      sizeLocked: false,
    });
  });

  it("fails closed for malformed, oversized, and unavailable storage", () => {
    const storage = memoryStorage({
      malformed: "{bad-json",
      oversized: "x".repeat(STUDIO_FLOATING_SURFACE_MAX_SERIALIZED_LENGTH + 1),
    });
    expect(loadStudioFloatingSurfaceLayout(storage, "malformed", FALLBACK))
      .toEqual(FALLBACK);
    expect(loadStudioFloatingSurfaceLayout(storage, "oversized", FALLBACK))
      .toEqual(FALLBACK);
    expect(loadStudioFloatingSurfaceLayout(null, "surface", FALLBACK))
      .toEqual(FALLBACK);
    expect(saveStudioFloatingSurfaceLayout({
      getItem: () => null,
      setItem: () => {
        throw new Error("blocked");
      },
    }, "surface", FALLBACK)).toBe(false);
  });
});
