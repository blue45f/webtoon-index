import { describe, expect, it } from "vitest";

import {
  DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT,
  STUDIO_DRAWING_PALETTE_MAX_PERCENT,
  STUDIO_DRAWING_PALETTE_MIN_PERCENT,
  moveStudioDrawingPalette,
  normalizeStudioDrawingPaletteLayout,
  resizeStudioDrawingPalettes,
  setStudioDrawingPaletteLock,
  toggleStudioDrawingPalette,
  toggleStudioDrawingPaletteLock,
} from "./studio-drawing-palettes";

describe("Studio drawing palette layout", () => {
  it("provides a deeply frozen 36/64 default with both palettes expanded and unlocked", () => {
    expect(DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT).toEqual({
      order: ["sub-tools", "tool-properties"],
      collapsed: {
        "sub-tools": false,
        "tool-properties": false,
      },
      sizes: {
        "sub-tools": 36,
        "tool-properties": 64,
      },
      locks: {
        "sub-tools": {
          position: false,
          height: false,
        },
        "tool-properties": {
          position: false,
          height: false,
        },
      },
    });
    expect(Object.isFrozen(DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT)).toBe(true);
    expect(Object.isFrozen(DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT.order)).toBe(true);
    expect(Object.isFrozen(DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT.collapsed)).toBe(
      true,
    );
    expect(Object.isFrozen(DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT.sizes)).toBe(true);
    expect(Object.isFrozen(DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT.locks)).toBe(true);
    expect(
      Object.isFrozen(DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT.locks["sub-tools"]),
    ).toBe(true);
    expect(
      Object.isFrozen(
        DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT.locks["tool-properties"],
      ),
    ).toBe(true);
  });

  it("reuses owned canonical layouts and re-allowslists externally frozen values", () => {
    const normalized = normalizeStudioDrawingPaletteLayout({
      order: ["tool-properties", "sub-tools"],
      collapsed: {
        "sub-tools": true,
        "tool-properties": false,
      },
      sizes: {
        "sub-tools": 42,
        "tool-properties": 58,
      },
      locks: {
        "sub-tools": {
          position: true,
          height: false,
        },
        "tool-properties": {
          position: false,
          height: true,
        },
      },
    });
    const externallyRestored = Object.freeze({
      order: Object.freeze(["sub-tools", "tool-properties"] as const),
      collapsed: Object.freeze({
        "sub-tools": false,
        "tool-properties": true,
      }),
      sizes: Object.freeze({
        "sub-tools": 48,
        "tool-properties": 52,
      }),
      locks: Object.freeze({
        "sub-tools": Object.freeze({
          position: false,
          height: true,
        }),
        "tool-properties": Object.freeze({
          position: true,
          height: false,
        }),
      }),
    });

    expect(
      normalizeStudioDrawingPaletteLayout(
        DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT,
      ),
    ).toBe(DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT);
    expect(normalizeStudioDrawingPaletteLayout(normalized)).toBe(normalized);
    const sanitizedExternal =
      normalizeStudioDrawingPaletteLayout(externallyRestored);
    expect(sanitizedExternal).toEqual(externallyRestored);
    expect(sanitizedExternal).not.toBe(externallyRestored);

    const mutable = {
      order: [...normalized.order],
      collapsed: { ...normalized.collapsed },
      sizes: { ...normalized.sizes },
      locks: {
        "sub-tools": { ...normalized.locks["sub-tools"] },
        "tool-properties": { ...normalized.locks["tool-properties"] },
      },
    };
    const sanitizedMutable = normalizeStudioDrawingPaletteLayout(mutable);
    expect(sanitizedMutable).toEqual(normalized);
    expect(sanitizedMutable).not.toBe(mutable);
    expect(Object.isFrozen(sanitizedMutable)).toBe(true);

    const frozenWithUnknownField = Object.freeze({
      ...externallyRestored,
      documentPayload: Object.freeze({ mustNotPersist: true }),
    });
    const sanitizedUnknown = normalizeStudioDrawingPaletteLayout(
      frozenWithUnknownField,
    );
    expect(sanitizedUnknown).toEqual(externallyRestored);
    expect(sanitizedUnknown).not.toBe(frozenWithUnknownField);
    expect(JSON.stringify(sanitizedUnknown)).not.toContain("documentPayload");

    const hiddenRoot = Object.freeze(
      Object.defineProperties({}, {
        order: { enumerable: false, value: externallyRestored.order },
        collapsed: { enumerable: false, value: externallyRestored.collapsed },
        sizes: { enumerable: false, value: externallyRestored.sizes },
        locks: { enumerable: false, value: externallyRestored.locks },
      }),
    );
    const sanitizedHiddenRoot =
      normalizeStudioDrawingPaletteLayout(hiddenRoot);
    expect(sanitizedHiddenRoot).toEqual(externallyRestored);
    expect(sanitizedHiddenRoot).not.toBe(hiddenRoot);
    expect(Object.keys(sanitizedHiddenRoot)).toEqual([
      "order",
      "collapsed",
      "sizes",
      "locks",
    ]);
  });

  it("allowlists order and collapse state while appending a missing palette", () => {
    const normalized = normalizeStudioDrawingPaletteLayout({
      order: [
        "tool-properties",
        "unknown",
        "tool-properties",
      ],
      collapsed: {
        "sub-tools": true,
        "tool-properties": "yes",
        unknown: true,
      },
      sizes: {
        "sub-tools": 36,
        "tool-properties": 64,
        unknown: 100,
      },
      documentPayload: { mustNotPersist: true },
    });

    expect(normalized).toEqual({
      order: ["tool-properties", "sub-tools"],
      collapsed: {
        "sub-tools": true,
        "tool-properties": false,
      },
      sizes: {
        "sub-tools": 36,
        "tool-properties": 64,
      },
      locks: {
        "sub-tools": {
          position: false,
          height: false,
        },
        "tool-properties": {
          position: false,
          height: false,
        },
      },
    });
    expect(JSON.stringify(normalized)).not.toContain("unknown");
    expect(JSON.stringify(normalized)).not.toContain("documentPayload");
  });

  it("normalizes arbitrary finite shares, clamps both ends, and always sums to 100", () => {
    const equal = normalizeStudioDrawingPaletteLayout({
      sizes: { "sub-tools": 70, "tool-properties": 70 },
    });
    const minimum = normalizeStudioDrawingPaletteLayout({
      sizes: { "sub-tools": 0, "tool-properties": 100 },
    });
    const maximum = normalizeStudioDrawingPaletteLayout({
      sizes: { "sub-tools": 100, "tool-properties": 0 },
    });
    const malformed = normalizeStudioDrawingPaletteLayout({
      sizes: {
        "sub-tools": Number.NaN,
        "tool-properties": Number.POSITIVE_INFINITY,
      },
    });

    expect(equal.sizes).toEqual({
      "sub-tools": 50,
      "tool-properties": 50,
    });
    expect(minimum.sizes).toEqual({
      "sub-tools": STUDIO_DRAWING_PALETTE_MIN_PERCENT,
      "tool-properties": STUDIO_DRAWING_PALETTE_MAX_PERCENT,
    });
    expect(maximum.sizes).toEqual({
      "sub-tools": STUDIO_DRAWING_PALETTE_MAX_PERCENT,
      "tool-properties": STUDIO_DRAWING_PALETTE_MIN_PERCENT,
    });
    expect(malformed.sizes).toEqual(
      DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT.sizes,
    );

    for (const layout of [equal, minimum, maximum, malformed]) {
      expect(
        layout.sizes["sub-tools"] + layout.sizes["tool-properties"],
      ).toBe(100);
      expect(layout.sizes["sub-tools"]).toBeGreaterThanOrEqual(
        STUDIO_DRAWING_PALETTE_MIN_PERCENT,
      );
      expect(layout.sizes["sub-tools"]).toBeLessThanOrEqual(
        STUDIO_DRAWING_PALETTE_MAX_PERCENT,
      );
      expect(layout.sizes["tool-properties"]).toBeGreaterThanOrEqual(
        STUDIO_DRAWING_PALETTE_MIN_PERCENT,
      );
      expect(layout.sizes["tool-properties"]).toBeLessThanOrEqual(
        STUDIO_DRAWING_PALETTE_MAX_PERCENT,
      );
    }
  });

  it("toggles, moves, and absolutely resizes without mutating the source layout", () => {
    const source = normalizeStudioDrawingPaletteLayout(
      DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT,
    );
    const toggled = toggleStudioDrawingPalette(source, "tool-properties");
    const moved = moveStudioDrawingPalette(toggled, "tool-properties", "up");
    const resized = resizeStudioDrawingPalettes(moved, moved.order[0]!, 73.6);

    expect(source).toEqual(DEFAULT_STUDIO_DRAWING_PALETTE_LAYOUT);
    expect(toggled.collapsed["tool-properties"]).toBe(true);
    expect(moved.order).toEqual(["tool-properties", "sub-tools"]);
    expect(resized.sizes).toEqual({
      "sub-tools": 26,
      "tool-properties": 74,
    });
    expect(resized.order).toEqual(moved.order);
    expect(resized.collapsed).toEqual(moved.collapsed);
  });

  it("keeps boundary moves and invalid resize input safe and canonical", () => {
    const source = normalizeStudioDrawingPaletteLayout({
      order: ["sub-tools", "tool-properties"],
      sizes: { "sub-tools": 45, "tool-properties": 55 },
    });

    expect(moveStudioDrawingPalette(source, "sub-tools", "up")).toEqual(source);
    expect(
      resizeStudioDrawingPalettes(source, "sub-tools", Number.NaN),
    ).toEqual(source);
  });

  it("migrates legacy layouts to explicit false locks and strips unknown lock fields", () => {
    const migrated = normalizeStudioDrawingPaletteLayout({
      order: ["sub-tools", "tool-properties"],
      collapsed: {
        "sub-tools": false,
        "tool-properties": true,
      },
      sizes: {
        "sub-tools": 40,
        "tool-properties": 60,
      },
    });
    const sanitized = normalizeStudioDrawingPaletteLayout({
      ...migrated,
      locks: {
        "sub-tools": {
          position: true,
          height: "yes",
          documentPayload: true,
        },
        "tool-properties": {
          position: false,
          height: true,
        },
        unknown: {
          position: true,
          height: true,
        },
      },
    });

    expect(migrated.locks).toEqual({
      "sub-tools": { position: false, height: false },
      "tool-properties": { position: false, height: false },
    });
    expect(sanitized.locks).toEqual({
      "sub-tools": { position: true, height: false },
      "tool-properties": { position: false, height: true },
    });
    expect(JSON.stringify(sanitized)).not.toContain("documentPayload");
    expect(JSON.stringify(sanitized)).not.toContain("unknown");
    expect(Object.isFrozen(sanitized.locks)).toBe(true);
    expect(Object.isFrozen(sanitized.locks["sub-tools"])).toBe(true);
  });

  it("enforces immutable per-palette position and height locks", () => {
    const source = normalizeStudioDrawingPaletteLayout({
      order: ["sub-tools", "tool-properties"],
      sizes: { "sub-tools": 45, "tool-properties": 55 },
    });
    const positionLocked = setStudioDrawingPaletteLock(
      source,
      "sub-tools",
      "position",
      true,
    );
    const heightLocked = toggleStudioDrawingPaletteLock(
      positionLocked,
      "tool-properties",
      "height",
    );

    expect(source.locks["sub-tools"].position).toBe(false);
    expect(positionLocked.locks["sub-tools"].position).toBe(true);
    expect(heightLocked.locks["tool-properties"].height).toBe(true);
    expect(moveStudioDrawingPalette(positionLocked, "sub-tools", "down")).toBe(
      positionLocked,
    );
    expect(
      moveStudioDrawingPalette(
        positionLocked,
        "tool-properties",
        "up",
      ),
    ).toBe(positionLocked);
    expect(
      resizeStudioDrawingPalettes(heightLocked, "sub-tools", 70),
    ).toBe(heightLocked);

    const unlocked = setStudioDrawingPaletteLock(
      setStudioDrawingPaletteLock(
        heightLocked,
        "sub-tools",
        "position",
        false,
      ),
      "tool-properties",
      "height",
      false,
    );
    expect(moveStudioDrawingPalette(unlocked, "sub-tools", "down").order).toEqual(
      ["tool-properties", "sub-tools"],
    );
    expect(
      resizeStudioDrawingPalettes(unlocked, "sub-tools", 70).sizes,
    ).toEqual({
      "sub-tools": 70,
      "tool-properties": 30,
    });
  });
});
