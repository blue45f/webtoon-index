import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_LIVE_SURFACE_MAX_BACKING_PIXELS,
  acquireStudioLowLatencyCanvas2dContext,
  decideStudioNativeLiveSurfaceResolution,
  resolveStudioLiveSurfaceDevicePixelRatio,
} from "./studio-low-latency-canvas";

describe("studio low latency canvas", () => {
  it("authorizes ordinary desktop and mobile surfaces only at their exact native density", () => {
    expect(decideStudioNativeLiveSurfaceResolution({
      cssWidth: 1_920,
      cssHeight: 1_080,
      devicePixelRatio: 2,
    })).toEqual({
      ok: true,
      mode: "native",
      devicePixelRatio: 2,
      backingWidth: 3_840,
      backingHeight: 2_160,
      backingPixels: 8_294_400,
      maximumBackingPixels: STUDIO_LIVE_SURFACE_MAX_BACKING_PIXELS,
    });
    expect(decideStudioNativeLiveSurfaceResolution({
      cssWidth: 430,
      cssHeight: 932,
      devicePixelRatio: 3,
    })).toMatchObject({
      ok: true,
      mode: "native",
      devicePixelRatio: 3,
      backingWidth: 1_290,
      backingHeight: 2_796,
    });
  });

  it("fails closed instead of reporting a reduced-resolution success for 4K DPR2", () => {
    expect(decideStudioNativeLiveSurfaceResolution({
      cssWidth: 3_840,
      cssHeight: 2_160,
      devicePixelRatio: 2,
    })).toEqual({
      ok: false,
      mode: "retained-exact-fallback",
      reason: "native-backing-pixel-budget-exceeded",
    });
  });

  it("keeps native density for ordinary desktop and mobile drawing surfaces", () => {
    expect(resolveStudioLiveSurfaceDevicePixelRatio({
      cssWidth: 1_920,
      cssHeight: 1_080,
      devicePixelRatio: 2,
    })).toBe(2);
    expect(resolveStudioLiveSurfaceDevicePixelRatio({
      cssWidth: 430,
      cssHeight: 932,
      devicePixelRatio: 3,
    })).toBe(3);
  });

  it("caps only oversized transient backing surfaces to a stable quarter-DPR step", () => {
    const dpr = resolveStudioLiveSurfaceDevicePixelRatio({
      cssWidth: 3_840,
      cssHeight: 2_160,
      devicePixelRatio: 2,
    });

    expect(dpr).toBe(1.25);
    expect(3_840 * 2_160 * dpr * dpr).toBeLessThanOrEqual(
      STUDIO_LIVE_SURFACE_MAX_BACKING_PIXELS
    );
  });

  it("requests a desynchronized context and falls back for older throwing WebViews", () => {
    const context = {} as CanvasRenderingContext2D;
    const getContext = vi.fn()
      .mockImplementationOnce(() => {
        throw new TypeError("unknown context option");
      })
      .mockReturnValueOnce(context);

    expect(acquireStudioLowLatencyCanvas2dContext({ getContext } as never)).toBe(context);
    expect(getContext).toHaveBeenNthCalledWith(1, "2d", {
      alpha: true,
      desynchronized: true,
    });
    expect(getContext).toHaveBeenNthCalledWith(2, "2d");
  });
});
