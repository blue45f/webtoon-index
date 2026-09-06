import { describe, expect, it } from "vitest";

import {
  resolveStudioDrawTapRadius,
  studioLiveVisibleTapDocumentRadius,
} from "./studio-live-visible-tap";

describe("studioLiveVisibleTapDocumentRadius", () => {
  it("keeps a planned nib that already covers the live CSS floor", () => {
    expect(studioLiveVisibleTapDocumentRadius(2.5, 1)).toBeCloseTo(2.5);
    expect(studioLiveVisibleTapDocumentRadius(3.22875, 1)).toBeCloseTo(3.22875);
  });

  it("grows only when the document nib would downsample below the live CSS floor", () => {
    expect(studioLiveVisibleTapDocumentRadius(1.25, 1)).toBeCloseTo(2.5);
    expect(studioLiveVisibleTapDocumentRadius(1.25, 0.25)).toBeCloseTo(10);
    expect(studioLiveVisibleTapDocumentRadius(0.4, 0.2)).toBeCloseTo(12.5);
  });

  it("leaves committed taps on the planned radius", () => {
    expect(resolveStudioDrawTapRadius(false, 0.35)).toBe(0.35);
    expect(resolveStudioDrawTapRadius(true, 3.22875)).toBeCloseTo(3.22875);
  });
});
