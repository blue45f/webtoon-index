import { describe, expect, it } from "vitest";

import { DRAW_COLOR_SWATCHES } from "./studio-draw-color-swatches";

describe("DRAW_COLOR_SWATCHES", () => {
  it("preserves the established palette colors and ordering", () => {
    expect(DRAW_COLOR_SWATCHES).toEqual([
      "#16100c",
      "#71717a",
      "#f8f2df",
      "#ff3b30",
      "#ff9500",
      "#ffcc00",
      "#4caf50",
      "#2196f3",
      "#9c27b0",
      "#ff6fb1",
      "#8a5a44",
      "#ffffff",
    ]);
  });
});
