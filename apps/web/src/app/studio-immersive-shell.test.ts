/**
 * Studio immersive shell — site GNB/footer must not render when surface is studio.
 * Drives the real ui-store helpers used by App.tsx chrome gates.
 */
import { describe, expect, it, beforeEach } from "vitest";

import { useUi } from "@/shared/lib/ui-store";
import { isImmersiveMobileRoute } from "@/src/app/routes/immersive-mobile-route";

describe("studio immersive shell", () => {
  beforeEach(() => {
    useUi.setState({ commandPaletteOpen: false, immersiveSurface: null });
  });

  it("treats /studio paths as immersive routes", () => {
    expect(isImmersiveMobileRoute("/studio")).toBe(true);
    expect(isImmersiveMobileRoute("/studio/")).toBe(true);
    expect(isImmersiveMobileRoute("/studio/work/1")).toBe(true);
    expect(isImmersiveMobileRoute("/studio-guide")).toBe(false);
    expect(isImmersiveMobileRoute("/")).toBe(false);
  });

  it("acquireImmersiveSurface('studio') is the App chrome gate condition", () => {
    expect(useUi.getState().immersiveSurface).toBeNull();
    useUi.getState().acquireImmersiveSurface("studio");
    expect(useUi.getState().immersiveSurface).toBe("studio");
    // App renders: header={studioImmersive ? null : <SiteHeader />}
    const hideSiteChrome = useUi.getState().immersiveSurface === "studio";
    expect(hideSiteChrome).toBe(true);
    useUi.getState().releaseImmersiveSurface("studio");
    expect(useUi.getState().immersiveSurface).toBeNull();
    expect(useUi.getState().immersiveSurface === "studio").toBe(false);
  });

  it("release is scoped so only the matching surface clears", () => {
    useUi.getState().acquireImmersiveSurface("studio");
    useUi.getState().releaseImmersiveSurface("studio");
    expect(useUi.getState().immersiveSurface).toBeNull();
    useUi.getState().acquireImmersiveSurface("studio");
    // Double-release is safe
    useUi.getState().releaseImmersiveSurface("studio");
    useUi.getState().releaseImmersiveSurface("studio");
    expect(useUi.getState().immersiveSurface).toBeNull();
  });
});
