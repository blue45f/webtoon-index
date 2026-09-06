import { describe, expect, it } from "vitest";

import {
  compositeFilterSplitComparison,
  compositePresetComparisonGrid,
  DEFAULT_FILTER_COMPARISON_CONFIG,
} from "./studio-filter-comparison-view";

describe("studio-filter-comparison-view", () => {
  const width = 10;
  const height = 10;
  const original = new Uint8ClampedArray(width * height * 4);
  const filtered = new Uint8ClampedArray(width * height * 4);

  // Fill original with black (0,0,0,255) and filtered with white (255,255,255,255)
  for (let i = 0; i < width * height; i++) {
    original[i * 4 + 3] = 255;
    filtered[i * 4] = 255;
    filtered[i * 4 + 1] = 255;
    filtered[i * 4 + 2] = 255;
    filtered[i * 4 + 3] = 255;
  }

  describe("Split Comparison", () => {
    it("composites horizontal Before/After split curtain", () => {
      const split = compositeFilterSplitComparison(original, filtered, width, height, {
        ...DEFAULT_FILTER_COMPARISON_CONFIG,
        splitRatio: 0.5,
        showSeparatorLine: true,
      });

      // Left side (x = 2, y = 5) should show original (0, 0, 0)
      const leftIdx = (5 * width + 2) * 4;
      expect(split[leftIdx]).toBe(0);

      // Right side (x = 8, y = 5) should show filtered (255, 255, 255)
      const rightIdx = (5 * width + 8) * 4;
      expect(split[rightIdx]).toBe(255);

      // Separator line (x = 5) should be white divider line
      const sepIdx = (5 * width + 5) * 4;
      expect(split[sepIdx]).toBe(255);
    });

    it("composites vertical Before/After split curtain", () => {
      const split = compositeFilterSplitComparison(original, filtered, width, height, {
        mode: "split-vertical",
        splitRatio: 0.5,
        showSeparatorLine: true,
        separatorColorHex: "#ffffff",
      });

      // Top side (x = 5, y = 2) should show original (0)
      const topIdx = (2 * width + 5) * 4;
      expect(split[topIdx]).toBe(0);

      // Bottom side (x = 5, y = 8) should show filtered (255)
      const bottomIdx = (8 * width + 5) * 4;
      expect(split[bottomIdx]).toBe(255);
    });
  });

  describe("Preset Comparison Grid (2x2)", () => {
    it("composites a 4-quadrant candidate comparison grid", () => {
      const candA = { id: "a", name: "A", description: "Original", data: original };
      const candB = { id: "b", name: "B", description: "Filtered", data: filtered };

      const grid = compositePresetComparisonGrid([candA, candB], width, height);
      expect(grid.length).toBe(width * height * 4);

      // Top-Left quadrant (x=2, y=2) has candidate A (original black = 0)
      const tlIdx = (2 * width + 2) * 4;
      expect(grid[tlIdx]).toBe(0);

      // Top-Right quadrant (x=8, y=2) has candidate B (filtered white = 255)
      const trIdx = (2 * width + 8) * 4;
      expect(grid[trIdx]).toBe(255);
    });
  });
});
