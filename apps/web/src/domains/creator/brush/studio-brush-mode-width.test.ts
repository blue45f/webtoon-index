import { describe, expect, it } from "vitest";

import {
  planStudioDrawModeChange,
  planStudioStrokeWidthChange,
  type StudioBrushModeWidthState,
} from "./studio-brush-mode-width";

const PEN_STATE: StudioBrushModeWidthState = {
  drawMode: "pen",
  strokeWidth: 7,
  lastNonPixelStrokeWidth: 7,
};

describe("Studio pixel-pencil width isolation", () => {
  it("restores the artist's non-pixel width after leaving the one-pixel tool", () => {
    const pixel = planStudioDrawModeChange(PEN_STATE, "pixel");
    expect(pixel).toEqual({
      drawMode: "pixel",
      strokeWidth: 1,
      lastNonPixelStrokeWidth: 7,
    });

    expect(planStudioDrawModeChange(pixel, "pen")).toEqual(PEN_STATE);
  });

  it("does not let pixel-only width requests overwrite the remembered brush width", () => {
    const pixel = planStudioDrawModeChange(PEN_STATE, "pixel");
    expect(planStudioStrokeWidthChange(pixel, 48)).toEqual(pixel);
  });

  it("keeps the active width across non-pixel tools and remembers later edits", () => {
    const marker = planStudioDrawModeChange(PEN_STATE, "eraser");
    expect(marker.strokeWidth).toBe(7);

    const resized = planStudioStrokeWidthChange(marker, 18);
    const pixel = planStudioDrawModeChange(resized, "pixel");
    expect(planStudioDrawModeChange(pixel, "shape")).toMatchObject({
      drawMode: "shape",
      strokeWidth: 18,
      lastNonPixelStrokeWidth: 18,
    });
  });
});
