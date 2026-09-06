import { describe, expect, it } from "vitest";

import {
  studioLivePresenceAlwaysVisible,
  studioLivePresenceHudLabel,
  studioPresenceConnectionLabel,
  studioPresenceOverflowLabel,
  studioPresenceVisiblePeerCount,
  studioSelectionBadgeText,
  studioSelectionCountChip,
  studioSmartShapeMatchToGlyph,
} from "./studio-commercial-residuals";

describe("studio commercial residual helpers", () => {
  it("formats selection badge for single vs multi", () => {
    expect(studioSelectionBadgeText(0, null)).toBe("");
    expect(studioSelectionBadgeText(1, "말풍선")).toBe("말풍선");
    expect(studioSelectionBadgeText(1, "  ")).toBe("선택됨");
    expect(studioSelectionBadgeText(4, "ignore")).toBe("4");
    expect(studioSelectionCountChip(12)).toBe("9+");
    expect(studioSelectionCountChip(3)).toBe("3");
  });

  it("maps smart-shape Korean labels to glyph ids", () => {
    expect(studioSmartShapeMatchToGlyph(null)).toBeNull();
    expect(studioSmartShapeMatchToGlyph("사각형")).toBe("rect");
    expect(studioSmartShapeMatchToGlyph("원")).toBe("circle");
    expect(studioSmartShapeMatchToGlyph("선")).toBe("line");
    expect(studioSmartShapeMatchToGlyph("삼각형")).toBe("triangle");
    expect(studioSmartShapeMatchToGlyph("다각형")).toBe("poly");
    expect(studioSmartShapeMatchToGlyph("알 수 없음")).toBeNull();
  });

  it("formats presence connection and overflow chips", () => {
    expect(studioPresenceConnectionLabel(true)).toContain("연결됨");
    expect(studioPresenceConnectionLabel(false)).toContain("다시 연결");
    expect(studioPresenceOverflowLabel(0)).toBeNull();
    expect(studioPresenceOverflowLabel(3)).toBe("+3");
    expect(studioPresenceVisiblePeerCount(12)).toBe(5);
    expect(studioPresenceVisiblePeerCount(2)).toBe(2);
  });

  it("labels always-on live presence for status HUD", () => {
    expect(studioLivePresenceHudLabel("idle", 0)).toBeNull();
    expect(studioLivePresenceHudLabel("connecting", 0)).toBe("연결 중");
    expect(studioLivePresenceHudLabel("ready", 0)).toBe("라이브");
    expect(studioLivePresenceHudLabel("ready", 3)).toBe("라이브 · 3");
    expect(studioLivePresenceAlwaysVisible("idle", 0)).toBe(false);
    expect(studioLivePresenceAlwaysVisible("connecting", 0)).toBe(true);
    expect(studioLivePresenceAlwaysVisible("ready", 0)).toBe(true);
  });
});
