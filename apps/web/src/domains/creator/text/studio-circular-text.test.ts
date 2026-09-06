import { describe, expect, it } from "vitest";

import { layoutCircularText } from "./studio-circular-text";

describe("studio-circular-text", () => {
  it("returns empty glyph array for empty text", () => {
    const result = layoutCircularText("", { centerX: 100, centerY: 100, radius: 50 });
    expect(result.glyphs).toHaveLength(0);
    expect(result.totalSpanDeg).toBe(0);
  });

  it("lays out characters evenly along circle radius", () => {
    const result = layoutCircularText("TOON", {
      centerX: 200,
      centerY: 200,
      radius: 100,
      startAngleDeg: -90, // Top
      direction: "clockwise",
    });

    expect(result.glyphs).toHaveLength(4);
    // First character at top: angle = -90 -> cos(-90)=0, sin(-90)=-1 -> (200, 100)
    expect(result.glyphs[0].char).toBe("T");
    expect(result.glyphs[0].x).toBe(200);
    expect(result.glyphs[0].y).toBe(100);

    // Each subsequent character progresses clockwise (x increases to the right)
    expect(result.glyphs[1].x).toBeGreaterThan(200);
  });

  it("supports counter-clockwise text flow", () => {
    const result = layoutCircularText("SOUND", {
      centerX: 100,
      centerY: 100,
      radius: 50,
      startAngleDeg: -90,
      direction: "counter-clockwise",
    });

    expect(result.glyphs[1].x).toBeLessThan(100); // Progresses leftwards
  });
});
