import { afterEach, describe, expect, it, vi } from "vitest";

import { STUDIO_AUTO_COLOR_HINT_MAX_PIXELS } from "./studio-auto-color-hints";
import {
  fitStudioAutoColorHintRasterSize,
  loadStudioAutoColorHintImageFromSrc,
} from "./studio-auto-color-hints-image-source";


describe("fitStudioAutoColorHintRasterSize", () => {
  it("keeps small rasters unchanged", () => {
    expect(fitStudioAutoColorHintRasterSize(100, 50, 10_000)).toEqual({
      width: 100,
      height: 50,
      scale: 1,
    });
  });

  it("downscales so product stays within the pixel budget", () => {
    const fitted = fitStudioAutoColorHintRasterSize(4_000, 4_000, 1_000_000);
    expect(fitted.width * fitted.height).toBeLessThanOrEqual(1_000_000);
    expect(fitted.width).toBeGreaterThan(0);
    expect(fitted.height).toBeGreaterThan(0);
    expect(fitted.scale).toBeLessThan(1);
  });

  it("defaults to the exported auto-color max pixels budget", () => {
    const fitted = fitStudioAutoColorHintRasterSize(16_384, 16_384);
    expect(fitted.width * fitted.height).toBeLessThanOrEqual(STUDIO_AUTO_COLOR_HINT_MAX_PIXELS);
  });
});

describe("loadStudioAutoColorHintImageFromSrc", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects empty sources before touching the DOM", async () => {
    await expect(loadStudioAutoColorHintImageFromSrc("")).rejects.toThrow(/비어/);
  });

  it("decodes a drawn canvas data URL into planner-shaped pixels", async () => {
    if (typeof document === "undefined") return;
    const source = document.createElement("canvas");
    source.width = 4;
    source.height = 3;
    const ctx = source.getContext("2d");
    expect(ctx).toBeTruthy();
    if (!ctx) return;
    ctx.fillStyle = "#112233";
    ctx.fillRect(0, 0, 4, 3);
    const dataUrl = source.toDataURL("image/png");

    const image = await loadStudioAutoColorHintImageFromSrc(dataUrl);
    expect(image.width).toBe(4);
    expect(image.height).toBe(3);
    expect(image.data.length).toBe(4 * 3 * 4);
    // Opaque fill — alpha channel fully set.
    expect(image.data[3]).toBe(255);
  });
});
