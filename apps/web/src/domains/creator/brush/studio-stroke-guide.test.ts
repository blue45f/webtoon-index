import { describe, expect, it } from "vitest";

import {
  planStudioStrokeGuide,
  shouldShowStudioStrokeGuide,
} from "./studio-stroke-guide";

describe("studio stroke guide", () => {
  it("connects the authoritative ink endpoint to the latest pointer at document scale", () => {
    expect(
      planStudioStrokeGuide({
        enabled: true,
        drawing: true,
        stabilizer: 12,
        effectiveScale: 2,
        inkPoint: { x: 10, y: 20 },
        pointerPoint: { x: 18, y: 24 },
      }),
    ).toEqual({
      visible: true,
      points: [10, 20, 18, 24],
      strokeWidth: 0.575,
      dash: [2, 1.5],
    });
  });

  it.each([
    { enabled: false, drawing: true, stabilizer: 10 },
    { enabled: true, drawing: false, stabilizer: 10 },
    { enabled: true, drawing: true, stabilizer: 0 },
  ])("hides when the guide has no active stabilized stroke: %o", (state) => {
    expect(
      planStudioStrokeGuide({
        ...state,
        effectiveScale: 1,
        inkPoint: { x: 0, y: 0 },
        pointerPoint: { x: 20, y: 10 },
      }).visible,
    ).toBe(false);
  });

  it("hides sub-pixel drift and fails closed for invalid coordinates", () => {
    expect(
      planStudioStrokeGuide({
        enabled: true,
        drawing: true,
        stabilizer: 4,
        effectiveScale: 1,
        inkPoint: { x: 12, y: 12 },
        pointerPoint: { x: 12.4, y: 12.2 },
      }).visible,
    ).toBe(false);
    expect(
      planStudioStrokeGuide({
        enabled: true,
        drawing: true,
        stabilizer: 4,
        effectiveScale: Number.NaN,
        inkPoint: { x: Number.NaN, y: 0 },
        pointerPoint: { x: 4, y: 4 },
      }),
    ).toMatchObject({ visible: false, points: [0, 0, 0, 0] });
  });

  it("offers an allocation-free scalar visibility predicate for native pointer hot paths", () => {
    expect(shouldShowStudioStrokeGuide(true, true, 4, 2, 10, 20, 18, 24)).toBe(true);
    expect(shouldShowStudioStrokeGuide(true, true, 0, 2, 10, 20, 18, 24)).toBe(false);
    expect(shouldShowStudioStrokeGuide(true, true, 4, 1, 12, 12, 12.4, 12.2)).toBe(false);
    expect(
      shouldShowStudioStrokeGuide(true, true, 4, 1, Number.NaN, 12, 18, 24),
    ).toBe(false);
  });
});
