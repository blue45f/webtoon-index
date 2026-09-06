import { describe, expect, it } from "vitest";

import { planStudioPointCommentComposerPosition } from "./studio-point-comment-composer-model";

describe("planStudioPointCommentComposerPosition", () => {
  it("anchors a desktop popover beside the point and flips at the far edge", () => {
    expect(planStudioPointCommentComposerPosition({
      point: { x: 100, y: 100 },
      viewport: { left: 0, top: 0, width: 1_000, height: 800 },
    })).toEqual({
      mode: "popover",
      left: 116,
      top: 116,
      width: 336,
      maxHeight: 776,
    });

    expect(planStudioPointCommentComposerPosition({
      point: { x: 980, y: 780 },
      viewport: { left: 0, top: 0, width: 1_000, height: 800 },
      measuredCard: { width: 336, height: 260 },
    })).toEqual({
      mode: "popover",
      left: 628,
      top: 504,
      width: 336,
      maxHeight: 776,
    });
  });

  it("uses an edge-to-edge bottom sheet on a narrow viewport", () => {
    expect(planStudioPointCommentComposerPosition({
      point: { x: 40, y: 50 },
      viewport: { left: 0, top: 0, width: 390, height: 844 },
    })).toEqual({
      mode: "sheet",
      left: 0,
      top: 620,
      width: 390,
      maxHeight: 836,
    });
  });

  it("keeps a mobile sheet above a shifted, keyboard-reduced visual viewport", () => {
    expect(planStudioPointCommentComposerPosition({
      point: { x: 160, y: 190 },
      viewport: { left: 0, top: 120, width: 320, height: 260 },
      measuredCard: { width: 336, height: 400 },
    })).toEqual({
      mode: "sheet",
      left: 0,
      top: 128,
      width: 320,
      maxHeight: 252,
    });
  });

  it("uses a centered, bounded bottom sheet for a coarse desktop pointer", () => {
    expect(planStudioPointCommentComposerPosition({
      point: { x: 700, y: 300 },
      viewport: { left: 0, top: 0, width: 1_024, height: 768 },
      coarsePointer: true,
    })).toEqual({
      mode: "sheet",
      left: 272,
      top: 544,
      width: 480,
      maxHeight: 760,
    });
  });

  it("normalizes invalid desktop points and remains inside a tiny viewport", () => {
    expect(planStudioPointCommentComposerPosition({
      point: { x: Number.NaN, y: Number.POSITIVE_INFINITY },
      viewport: { left: 10, top: 20, width: 250, height: 180 },
    })).toEqual({
      mode: "sheet",
      left: 10,
      top: 28,
      width: 250,
      maxHeight: 172,
    });
  });
});
