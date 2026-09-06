import { describe, expect, it } from "vitest";

import {
  cycleStudioWorkspaceLandmark,
  studioWorkspaceLandmarkLabel,
  type StudioWorkspaceLandmarkId,
} from "./studio-workspace-landmarks";

const ids: StudioWorkspaceLandmarkId[] = [
  "studio-menubar",
  "studio-canvas-workspace",
  "studio-inspector",
];

describe("studio workspace landmarks", () => {
  it("enters from the first or last visible region depending on direction", () => {
    expect(cycleStudioWorkspaceLandmark(ids, null, 1)).toBe("studio-menubar");
    expect(cycleStudioWorkspaceLandmark(ids, null, -1)).toBe("studio-inspector");
  });

  it("wraps in both directions while preserving the visible order", () => {
    expect(cycleStudioWorkspaceLandmark(ids, "studio-inspector", 1)).toBe(
      "studio-menubar",
    );
    expect(cycleStudioWorkspaceLandmark(ids, "studio-menubar", -1)).toBe(
      "studio-inspector",
    );
  });

  it("returns no target when every region is hidden", () => {
    expect(cycleStudioWorkspaceLandmark([], null, 1)).toBeNull();
  });

  it("keeps a human-readable label for announcements", () => {
    expect(studioWorkspaceLandmarkLabel("studio-canvas-workspace")).toBe(
      "캔버스",
    );
  });
});
