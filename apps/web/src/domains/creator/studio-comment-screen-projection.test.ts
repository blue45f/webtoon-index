import { describe, expect, it } from "vitest";

import { projectStudioPointCommentToScreen } from "./studio-comment-screen-projection";

const RECT = { left: 100, top: 40, width: 600, height: 300 };

describe("projectStudioPointCommentToScreen", () => {
  it.each([
    [0, false, { x: 250, y: 265 }],
    [0, true, { x: 550, y: 265 }],
    [90, false, { x: 250, y: 115 }],
    [90, true, { x: 550, y: 115 }],
    [180, false, { x: 550, y: 115 }],
    [180, true, { x: 250, y: 115 }],
    [270, false, { x: 550, y: 265 }],
    [270, true, { x: 250, y: 265 }],
  ] as const)(
    "projects rotation %s and flip=%s into the visible host",
    (canvasRotation, canvasFlipH, expected) => {
      expect(projectStudioPointCommentToScreen({
        anchor: { type: "point", pageId: "page-1", x: 0.25, y: 0.75 },
        canvasWidth: 1_200,
        canvasHeight: 600,
        canvasFlipH,
        canvasRotation,
        viewportRect: RECT,
      })).toEqual(expected);
    }
  );

  it("tracks a resized and translated live canvas host without changing the anchor", () => {
    const anchor = { type: "point" as const, pageId: "page-1", x: 0.5, y: 0.5 };
    expect(projectStudioPointCommentToScreen({
      anchor,
      canvasWidth: 800,
      canvasHeight: 1_600,
      canvasFlipH: false,
      canvasRotation: 0,
      viewportRect: { left: 12, top: 24, width: 400, height: 800 },
    })).toEqual({ x: 212, y: 424 });
    expect(projectStudioPointCommentToScreen({
      anchor,
      canvasWidth: 800,
      canvasHeight: 1_600,
      canvasFlipH: false,
      canvasRotation: 0,
      viewportRect: { left: -80, top: 60, width: 800, height: 1_600 },
    })).toEqual({ x: 320, y: 860 });
  });

  it("fails closed to finite coordinates for a temporarily collapsed host", () => {
    expect(projectStudioPointCommentToScreen({
      anchor: { type: "point", pageId: "page-1", x: 0.5, y: 0.5 },
      canvasWidth: Number.NaN,
      canvasHeight: Number.POSITIVE_INFINITY,
      canvasFlipH: false,
      canvasRotation: 0,
      viewportRect: {
        left: Number.NaN,
        top: Number.POSITIVE_INFINITY,
        width: -100,
        height: Number.NaN,
      },
    })).toEqual({ x: 0, y: 0 });
  });
});
