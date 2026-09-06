import { afterEach, describe, expect, it } from "vitest";

import { useUi } from "./ui-store";

describe("ui-store immersive surface", () => {
  afterEach(() => {
    useUi.setState({ commandPaletteOpen: false, immersiveSurface: null });
  });

  it("acquires and releases the Studio app shell without persisting it", () => {
    useUi.getState().acquireImmersiveSurface("studio");
    expect(useUi.getState().immersiveSurface).toBe("studio");

    useUi.getState().releaseImmersiveSurface("studio");
    expect(useUi.getState().immersiveSurface).toBeNull();
  });

  it("does not change command palette state while switching surfaces", () => {
    useUi.getState().openCommandPalette();
    useUi.getState().acquireImmersiveSurface("studio");
    useUi.getState().releaseImmersiveSurface("studio");

    expect(useUi.getState().commandPaletteOpen).toBe(true);
  });
});
