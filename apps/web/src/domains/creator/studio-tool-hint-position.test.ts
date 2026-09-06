import { describe, expect, it } from "vitest";

import { planStudioToolHintPosition } from "./studio-tool-hint-position";

const anchor = (left: number, top: number, width = 40, height = 40) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
});

describe("planStudioToolHintPosition", () => {
  it("prefers the right side of a desktop tool rail", () => {
    expect(
      planStudioToolHintPosition({
        anchor: anchor(12, 200),
        viewportWidth: 1280,
        viewportHeight: 800,
        popupWidth: 304,
        popupHeight: 220,
      })
    ).toMatchObject({ left: 64, top: 110, side: "right", arrowOffset: 110 });
  });

  it("flips left when a control is close to the right edge", () => {
    const result = planStudioToolHintPosition({
      anchor: anchor(1210, 120),
      viewportWidth: 1280,
      viewportHeight: 800,
      popupWidth: 304,
      popupHeight: 220,
    });
    expect(result.side).toBe("left");
    expect(result.left).toBe(894);
  });

  it("uses a vertical side on a narrow mobile viewport", () => {
    const result = planStudioToolHintPosition({
      anchor: anchor(160, 80),
      viewportWidth: 360,
      viewportHeight: 740,
      popupWidth: 328,
      popupHeight: 210,
    });
    expect(result.side).toBe("bottom");
    expect(result.left).toBeGreaterThanOrEqual(8);
    expect(result.left + 328).toBeLessThanOrEqual(352);
  });

  it("clamps both axes for unusually small viewports", () => {
    const result = planStudioToolHintPosition({
      anchor: anchor(2, 2, 20, 20),
      viewportWidth: 260,
      viewportHeight: 180,
      popupWidth: 244,
      popupHeight: 164,
      preferredSide: "top",
    });
    expect(result.left).toBe(8);
    expect(result.top).toBe(8);
    expect(result.arrowOffset).toBeGreaterThanOrEqual(16);
  });
});
