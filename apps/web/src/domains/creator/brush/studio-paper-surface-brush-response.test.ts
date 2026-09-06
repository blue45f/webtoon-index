import { describe, expect, it } from "vitest";

import { getStudioPaperBrushResponseSummaries } from "./studio-paper-surface-brush-response";

describe("studio paper surface brush response summaries", () => {
  it("explains reactive and paper-independent brush families", () => {
    const summaries = getStudioPaperBrushResponseSummaries("cold-press");
    expect(summaries.map((summary) => summary.id)).toEqual([
      "dry",
      "wet",
      "paint",
      "digital",
    ]);
    expect(summaries.every((summary) => summary.description.length > 20)).toBe(true);
    expect(summaries.at(-1)).toMatchObject({
      id: "digital",
      level: "영향 없음",
      value: 0,
    });
  });

  it("tracks the stronger dry and wet response of rough papers", () => {
    const bristol = getStudioPaperBrushResponseSummaries("bristol");
    const sanded = getStudioPaperBrushResponseSummaries("sanded-pastel");
    const hot = getStudioPaperBrushResponseSummaries("hot-press");
    const rough = getStudioPaperBrushResponseSummaries("rough");
    expect(sanded.find((summary) => summary.id === "dry")!.value).toBeGreaterThan(
      bristol.find((summary) => summary.id === "dry")!.value,
    );
    expect(rough.find((summary) => summary.id === "wet")!.value).toBeGreaterThan(
      hot.find((summary) => summary.id === "wet")!.value,
    );
  });

  it("calls out woven paint response and fibre-directed wet response", () => {
    expect(
      getStudioPaperBrushResponseSummaries("canvas")
        .find((summary) => summary.id === "paint")!
        .description,
    ).toContain("씨실·날실");
    expect(
      getStudioPaperBrushResponseSummaries("washi")
        .find((summary) => summary.id === "wet")!
        .description,
    ).toContain("섬유 방향");
  });
});
