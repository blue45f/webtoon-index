import { describe, expect, it } from "vitest";

import {
  nudgeStudioCommentPointAnchor,
  projectStudioCommentPointerToPointAnchor,
} from "./studio-comment-pin-reanchor";

const VIEWPORT = { left: 100, top: 50, width: 600, height: 300 };

describe("Studio comment pin re-anchor projection", () => {
  it.each([
    [0, false, { x: 0.25, y: 0.75 }],
    [0, true, { x: 0.75, y: 0.75 }],
    [90, false, { x: 0.75, y: 0.75 }],
    [90, true, { x: 0.75, y: 0.25 }],
    [180, false, { x: 0.75, y: 0.25 }],
    [180, true, { x: 0.25, y: 0.25 }],
    [270, false, { x: 0.25, y: 0.25 }],
    [270, true, { x: 0.25, y: 0.75 }],
  ] as const)(
    "maps the same viewport point through rotation=%s flip=%s",
    (canvasRotation, canvasFlipH, expected) => {
      const anchor = projectStudioCommentPointerToPointAnchor({
        pageId: "page-1",
        clientX: 250,
        clientY: 275,
        viewportRect: VIEWPORT,
        canvasWidth: 1_200,
        canvasHeight: 600,
        canvasFlipH,
        canvasRotation,
      });
      expect(anchor.x).toBeCloseTo(expected.x, 8);
      expect(anchor.y).toBeCloseTo(expected.y, 8);
    }
  );

  it("clamps pointer drops outside the visible canvas", () => {
    expect(projectStudioCommentPointerToPointAnchor({
      pageId: "page-1",
      clientX: -9_000,
      clientY: 9_000,
      viewportRect: VIEWPORT,
      canvasWidth: 1_200,
      canvasHeight: 600,
      canvasFlipH: false,
      canvasRotation: 0,
    })).toEqual({ type: "point", pageId: "page-1", x: 0, y: 1 });
  });

  it.each([0, 90, 180, 270] as const)(
    "keeps keyboard nudges screen-relative at %s degrees",
    (canvasRotation) => {
      const anchor = { type: "point" as const, pageId: "page-1", x: 0.5, y: 0.5 };
      const right = nudgeStudioCommentPointAnchor({
        anchor,
        directionX: 1,
        directionY: 0,
        viewFraction: 0.01,
        canvasWidth: 1_200,
        canvasHeight: 600,
        canvasFlipH: false,
        canvasRotation,
      });
      const restored = nudgeStudioCommentPointAnchor({
        anchor: right,
        directionX: -1,
        directionY: 0,
        viewFraction: 0.01,
        canvasWidth: 1_200,
        canvasHeight: 600,
        canvasFlipH: false,
        canvasRotation,
      });
      expect(restored.x).toBeCloseTo(anchor.x, 8);
      expect(restored.y).toBeCloseTo(anchor.y, 8);
    }
  );

  it("honors screen-relative horizontal flip and clamps edge nudges", () => {
    const leftEdge = { type: "point" as const, pageId: "page-1", x: 0, y: 0.5 };
    const visibleRight = nudgeStudioCommentPointAnchor({
      anchor: leftEdge,
      directionX: 1,
      directionY: 0,
      viewFraction: 0.05,
      canvasWidth: 1_000,
      canvasHeight: 2_000,
      canvasFlipH: true,
      canvasRotation: 0,
    });
    expect(visibleRight.x).toBe(0);
    expect(visibleRight.y).toBe(0.5);
  });
});
