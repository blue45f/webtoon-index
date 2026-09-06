import { describe, expect, it } from "vitest";

import {
  admitStudioPixelArtStrokeColor,
  enableStudioPixelArtMode,
  snapStudioPixelArtPoint,
  studioPixelArtModeHudLabel,
} from "./studio-pixel-art-mode";

describe("studio-pixel-art-mode", () => {
  it("enables Piskel/Lospec-class defaults", () => {
    const mode = enableStudioPixelArtMode("lospec-gameboy");
    expect(mode.enabled).toBe(true);
    expect(mode.pixelPencil).toBe(true);
    expect(mode.gridSnap).toBe(true);
    expect(mode.palette?.id).toBe("lospec-gameboy");
  });

  it("snaps stroke color through palette lock", () => {
    const mode = enableStudioPixelArtMode("lospec-1bit-monitor");
    expect(admitStudioPixelArtStrokeColor("#111111", mode)).toBe("#0f0f1b");
    expect(admitStudioPixelArtStrokeColor("#eeeeee", mode)).toBe("#f0f0f0");
  });

  it("snaps points to integer cells when enabled", () => {
    const mode = enableStudioPixelArtMode();
    expect(snapStudioPixelArtPoint(10.6, 3.2, mode)).toEqual({ x: 11, y: 3 });
  });

  it("builds a compact HUD label", () => {
    const mode = enableStudioPixelArtMode("lospec-pico8");
    expect(studioPixelArtModeHudLabel(mode)).toContain("PICO-8");
    expect(studioPixelArtModeHudLabel(mode)).toContain("팔레트 잠금");
  });
});
