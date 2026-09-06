import { describe, expect, it } from "vitest";

import { resolveStudioRailMorePosition } from "./studio-left-tool-rail-position";

describe("resolveStudioRailMorePosition", () => {
  it("keeps a tall hidden-tools list visible when one rail tool leaves the trigger near the top", () => {
    const position = resolveStudioRailMorePosition({
      popoverHeight: 448,
      popoverWidth: 208,
      trigger: { bottom: 160, right: 52 },
      viewport: { width: 1_024, height: 844 },
    });

    expect(position).toEqual({ left: 56, top: 8 });
    expect(position.top + 448).toBeLessThanOrEqual(844 - 8);
  });

  it("clamps the measured popover into a short visual viewport on both axes", () => {
    const position = resolveStudioRailMorePosition({
      popoverHeight: 224,
      popoverWidth: 208,
      trigger: { bottom: 72, right: 1_180 },
      viewport: { left: 12, top: 30, width: 320, height: 240 },
    });

    expect(position).toEqual({ left: 116, top: 38 });
    expect(position.left + 208).toBeLessThanOrEqual(12 + 320 - 8);
    expect(position.top + 224).toBeLessThanOrEqual(30 + 240 - 8);
  });

  it("retains trigger-bottom alignment when the preferred position already fits", () => {
    expect(resolveStudioRailMorePosition({
      popoverHeight: 320,
      popoverWidth: 208,
      trigger: { bottom: 700, right: 52 },
      viewport: { width: 1_024, height: 844 },
    })).toEqual({ left: 56, top: 380 });
  });
});
