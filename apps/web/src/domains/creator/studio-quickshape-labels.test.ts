import { describe, expect, it } from "vitest";

import { QUICKSHAPE_KIND_LABELS } from "./studio-quickshape-labels";

describe("QUICKSHAPE_KIND_LABELS", () => {
  it("preserves the exact promotion labels and intentional fallback boundary", () => {
    expect(QUICKSHAPE_KIND_LABELS).toEqual({
      line: "선",
      rect: "사각형",
      ellipse: "타원",
      triangle: "삼각형",
      polygon: "다각형",
    });
    expect(
      ["freehand", "star", "arrow"].map(
        (kind) => QUICKSHAPE_KIND_LABELS[kind]
      )
    ).toEqual([undefined, undefined, undefined]);
  });
});
