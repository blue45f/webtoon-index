import { describe, expect, it } from "vitest";

import { analyzeStudioMoireForProduct } from "./studio-moire-analysis";

function periodicImage(width = 16, height = 16) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const value = (x + y) % 2 === 0 ? 20 : 235;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 190;
    }
  }
  return { width, height, data };
}

describe("studio moiré product analysis", () => {
  it("returns a diagnostic heatmap without exposing a filter patch", () => {
    const source = periodicImage();
    const before = new Uint8ClampedArray(source.data);
    const report = analyzeStudioMoireForProduct(source);

    expect(report.status).toBe("complete");
    expect(report.destructive).toBe(false);
    expect(report).not.toHaveProperty("patch");
    expect(source.data).toEqual(before);
    if (report.status !== "complete") return;
    expect(report.severity).toBe("높음");
    expect(report.scorePercent).toBeGreaterThan(40);
    expect(report.hotAreaPercent).toBeGreaterThan(40);
    expect(report.dominantPeriodPx).toBe(2);
    expect(report.heatmap.data).not.toEqual(source.data);
  });

  it("maps invalid input to a bounded unavailable report", () => {
    const report = analyzeStudioMoireForProduct({
      width: 3,
      height: 2,
      data: new Uint8ClampedArray(4),
    });
    expect(report).toEqual(expect.objectContaining({
      status: "unavailable",
      destructive: false,
      reason: "invalid-image",
    }));
  });
});
