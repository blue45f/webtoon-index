import { describe, expect, it } from "vitest";

import {
  DEFAULT_STUDIO_DRAWING_PALETTE_FLOATING_LAYOUTS,
  loadStudioDrawingPaletteFloatingLayout,
  saveStudioDrawingPaletteFloatingLayout,
  studioDrawingPaletteFloatingLayoutKey,
} from "./studio-drawing-palette-floating-layout";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe("drawing palette floating placement", () => {
  it("keeps Sub Tool and Tool Property window layouts isolated", () => {
    const storage = memoryStorage();
    expect(saveStudioDrawingPaletteFloatingLayout("sub-tools", {
      ...DEFAULT_STUDIO_DRAWING_PALETTE_FLOATING_LAYOUTS["sub-tools"],
      dock: "right",
      xRatio: 1,
      positionLocked: true,
    }, storage)).toBe(true);

    expect(loadStudioDrawingPaletteFloatingLayout("sub-tools", storage))
      .toMatchObject({ dock: "right", xRatio: 1, positionLocked: true });
    expect(loadStudioDrawingPaletteFloatingLayout("tool-properties", storage))
      .toEqual(DEFAULT_STUDIO_DRAWING_PALETTE_FLOATING_LAYOUTS["tool-properties"]);
    expect(storage.values.has(
      studioDrawingPaletteFloatingLayoutKey("sub-tools"),
    )).toBe(true);
    expect(storage.values.has(
      studioDrawingPaletteFloatingLayoutKey("tool-properties"),
    )).toBe(false);
  });

  it("returns bounded defaults when browser storage is unavailable", () => {
    expect(loadStudioDrawingPaletteFloatingLayout("sub-tools", null))
      .toEqual(DEFAULT_STUDIO_DRAWING_PALETTE_FLOATING_LAYOUTS["sub-tools"]);
    expect(saveStudioDrawingPaletteFloatingLayout(
      "tool-properties",
      DEFAULT_STUDIO_DRAWING_PALETTE_FLOATING_LAYOUTS["tool-properties"],
      null,
    )).toBe(false);
  });
});
