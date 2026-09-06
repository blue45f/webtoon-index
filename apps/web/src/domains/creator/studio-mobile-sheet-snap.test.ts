import { describe, expect, it } from "vitest";

import {
  collapseStudioMobileSheetSnap,
  expandStudioMobileSheetSnap,
  nextStudioMobileSheetSnap,
  STUDIO_MOBILE_DRAW_SHEET_COMPACT_MIN_HEIGHT,
  STUDIO_MOBILE_DRAW_SHEET_DEFAULT_SNAP,
  STUDIO_MOBILE_SHEET_DEFAULT_SNAP,
  studioMobileSheetSizeStyle,
  studioMobileSheetSnapLabel,
  studioMobileSheetSnapValue,
} from "./studio-mobile-sheet-snap";

describe("studio mobile sheet snap", () => {
  it("expands and collapses exactly one level, dismissing only below compact", () => {
    expect(expandStudioMobileSheetSnap("compact")).toBe("medium");
    expect(expandStudioMobileSheetSnap("medium")).toBe("full");
    expect(expandStudioMobileSheetSnap("full")).toBe("full");

    expect(collapseStudioMobileSheetSnap("full")).toBe("medium");
    expect(collapseStudioMobileSheetSnap("medium")).toBe("compact");
    expect(collapseStudioMobileSheetSnap("compact")).toBeNull();
  });

  it("cycles handle taps without conflating resize with close", () => {
    expect(nextStudioMobileSheetSnap("compact")).toBe("medium");
    expect(nextStudioMobileSheetSnap("medium")).toBe("full");
    expect(nextStudioMobileSheetSnap("full")).toBe("compact");
  });

  it("describes each snap in Korean and clamps unsafe keyboard insets", () => {
    expect(studioMobileSheetSnapLabel("compact")).toBe("작게");
    expect(studioMobileSheetSnapLabel("medium")).toBe("중간");
    expect(studioMobileSheetSnapLabel("full")).toBe("크게");
    expect(studioMobileSheetSnapValue("compact")).toBe(0);
    expect(studioMobileSheetSnapValue("medium")).toBe(1);
    expect(studioMobileSheetSnapValue("full")).toBe(2);

    expect(studioMobileSheetSizeStyle("medium", 181.6)).toEqual({
      height: "min(58dvh, calc(100dvh - env(safe-area-inset-top) - 0.75rem - 182px))",
      maxHeight: "min(58dvh, calc(100dvh - env(safe-area-inset-top) - 0.75rem - 182px))",
    });
    expect(studioMobileSheetSizeStyle("compact", -20).height).toContain("- 0px)");
    expect(studioMobileSheetSizeStyle("full", Number.NaN).height).toContain("88dvh");
  });

  it("floors an opt-in minimum height without touching the default snap sizes", () => {
    expect(studioMobileSheetSizeStyle("compact", 0, "16.5rem").height).toBe(
      "min(max(34dvh, 16.5rem), calc(100dvh - env(safe-area-inset-top) - 0.75rem - 0px))",
    );
    // 34dvh is 218px at 360×640 and clips the opacity slider by 36px; the floor is what keeps
    // both primary sliders reachable without scrolling on the smallest supported phone.
    expect(STUDIO_MOBILE_DRAW_SHEET_COMPACT_MIN_HEIGHT).toBe("16.5rem");
    expect(studioMobileSheetSizeStyle("compact", 0).height).not.toContain("max(");
  });

  it("opens the brush sheet smaller than a list sheet so the canvas under it stays judgeable", () => {
    // Measured on a 360×640 touch viewport: `medium` left 126 canvas rows (19.7%) once the brush
    // sheet was up, so the size slider could not be judged against the artwork it changes.
    expect(STUDIO_MOBILE_SHEET_DEFAULT_SNAP).toBe("medium");
    expect(STUDIO_MOBILE_DRAW_SHEET_DEFAULT_SNAP).toBe("compact");
    expect(studioMobileSheetSnapValue(STUDIO_MOBILE_DRAW_SHEET_DEFAULT_SNAP)).toBeLessThan(
      studioMobileSheetSnapValue(STUDIO_MOBILE_SHEET_DEFAULT_SNAP),
    );
  });
});
