import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canonicalStudioLivingInkDisplayRgba8,
  STUDIO_LIVING_INK_GRANULATION_MULTIPLIER_BOUNDS,
  STUDIO_LIVING_INK_MAXIMUM_OPTICAL_DENSITY,
} from "./studio-living-ink-execution-protocol";
import {
  createStudioLivingInkWebGlReadbackBitmap,
  STUDIO_LIVING_INK_WEBGL2_DILUTE_SEDIMENT_RESPONSE,
  STUDIO_LIVING_INK_WEBGL2_DISPLAY_GRANULATION_SEDIMENT_GAIN,
  studioLivingInkWebGlDiluteSedimentBoost,
  studioLivingInkWebGlGranulationMultiplier,
  studioLivingInkWebGlReadbackToTopDownRgba8,
} from "./studio-living-ink-webgl2-runtime";

class TestImageData {
  readonly colorSpace = "srgb";

  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {}
}

function installImageDataBoundary(): void {
  // Node has no ImageData. This boundary preserves the supplied array verbatim; the production
  // row transform remains the real implementation under test rather than being duplicated here.
  vi.stubGlobal("ImageData", TestImageData);
}

function bitmap(close = vi.fn()): ImageBitmap {
  return {
    close,
    height: 2,
    width: 2,
  } as unknown as ImageBitmap;
}

describe("Living Ink WebGL2 RGBA8 presentation authority", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reverses WebGL rows exactly once while preserving channels and receipt bytes", () => {
    const bottomUp = Uint8Array.of(
      // WebGL row 0: document bottom.
      1, 2, 3, 4, 5, 6, 7, 8,
      // WebGL row 1.
      21, 22, 23, 24, 25, 26, 27, 28,
      // WebGL row 2: document top.
      41, 42, 43, 44, 45, 46, 47, 48,
    );
    const receiptAuthority = bottomUp.slice();

    const topDown = studioLivingInkWebGlReadbackToTopDownRgba8(bottomUp, 2, 3);

    expect(Array.from(topDown)).toEqual([
      41, 42, 43, 44, 45, 46, 47, 48,
      21, 22, 23, 24, 25, 26, 27, 28,
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(bottomUp).toEqual(receiptAuthority);
    topDown[0] = 255;
    expect(bottomUp[16]).toBe(41);
  });

  it("keeps canonical receipt bytes bottom-up while the visual source is top-down", () => {
    const bottomUp = Uint8Array.of(
      200, 100, 50, 64, 40, 80, 120, 128,
      10, 20, 30, 255, 255, 255, 255, 0,
    );
    const canonicalBottomUp = canonicalStudioLivingInkDisplayRgba8(bottomUp);
    const canonicalTopDown = canonicalStudioLivingInkDisplayRgba8(
      studioLivingInkWebGlReadbackToTopDownRgba8(bottomUp, 2, 2),
    );

    expect(Array.from(studioLivingInkWebGlReadbackToTopDownRgba8(
      canonicalTopDown,
      2,
      2,
    ))).toEqual(Array.from(canonicalBottomUp));
    expect(Array.from(canonicalBottomUp.slice(0, 4))).toEqual([50, 25, 13, 64]);
    expect(Array.from(canonicalBottomUp.slice(12, 16))).toEqual([0, 0, 0, 0]);
  });

  it("keeps an untouched transparent-white surface lossless before browser premultiplication", async () => {
    installImageDataBoundary();
    const bottomUp = new Uint8Array(3 * 2 * 4);
    for (let offset = 0; offset < bottomUp.byteLength; offset += 4) {
      bottomUp.set([255, 255, 255, 0], offset);
    }
    let captured: TestImageData | undefined;
    let capturedOptions: ImageBitmapOptions | undefined;
    const close = vi.fn();
    const expected = bitmap(close);

    const presented = await createStudioLivingInkWebGlReadbackBitmap(bottomUp, 3, 2, {
      createImageBitmap: async (source, options) => {
        captured = source as unknown as TestImageData;
        capturedOptions = options;
        return expected;
      },
      stillOwnsFrame: () => true,
    });

    expect(presented).toBe(expected);
    expect(captured).toMatchObject({ width: 3, height: 2 });
    expect(Array.from(captured!.data)).toEqual(Array.from(bottomUp));
    expect(capturedOptions).toEqual({
      colorSpaceConversion: "none",
      imageOrientation: "none",
      premultiplyAlpha: "none",
    });
    expect(close).not.toHaveBeenCalled();
  });

  it("closes a bitmap whose runtime ownership was revoked during asynchronous creation", async () => {
    installImageDataBoundary();
    const close = vi.fn();
    const created = bitmap(close);
    let release: (() => void) | undefined;
    let ownsFrame = true;
    const creationGate = new Promise<void>((resolve) => { release = resolve; });

    const pending = createStudioLivingInkWebGlReadbackBitmap(
      Uint8Array.of(
        10, 20, 30, 40, 50, 60, 70, 80,
        90, 100, 110, 120, 130, 140, 150, 160,
      ),
      2,
      2,
      {
        createImageBitmap: async () => {
          await creationGate;
          return created;
        },
        stillOwnsFrame: () => ownsFrame,
      },
    );

    ownsFrame = false;
    release!();
    await expect(pending).rejects.toThrow(/invalidated before publication/i);
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects malformed readbacks before allocating a browser bitmap", async () => {
    installImageDataBoundary();
    const createImageBitmap = vi.fn(async () => bitmap());

    await expect(createStudioLivingInkWebGlReadbackBitmap(
      new Uint8Array(15),
      2,
      2,
      { createImageBitmap },
    )).rejects.toThrow(/dimensions are malformed/i);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it("boosts only dilute pigment and returns smoothly to baseline before dense ink", () => {
    expect(studioLivingInkWebGlDiluteSedimentBoost(0)).toBeCloseTo(5.6, 12);
    expect(studioLivingInkWebGlDiluteSedimentBoost(0.035)).toBeCloseTo(5.6, 12);
    expect(studioLivingInkWebGlDiluteSedimentBoost(0.1175)).toBeCloseTo(3.3, 12);
    expect(studioLivingInkWebGlDiluteSedimentBoost(0.2)).toBe(1);
    expect(studioLivingInkWebGlDiluteSedimentBoost(1)).toBe(1);

    const sampled = Array.from(
      { length: 65 },
      (_, index) => studioLivingInkWebGlDiluteSedimentBoost(index / 64),
    );
    for (let index = 1; index < sampled.length; index += 1) {
      expect(sampled[index]).toBeLessThanOrEqual(sampled[index - 1]!);
    }
    expect(() => studioLivingInkWebGlDiluteSedimentBoost(Number.NaN)).toThrow(RangeError);
  });

  it("keeps every valid dilute sediment extreme inside a finite physical density envelope", () => {
    let observedMinimum = Number.POSITIVE_INFINITY;
    let observedMaximum = Number.NEGATIVE_INFINITY;
    const densities = [0, 0.005, 0.035, 0.1175, 0.2, 0.38, 1.15, 2, 32];
    for (let grainIndex = 0; grainIndex <= 16; grainIndex += 1) {
      for (let toothIndex = 0; toothIndex <= 16; toothIndex += 1) {
        for (let amountIndex = 0; amountIndex <= 8; amountIndex += 1) {
          for (const centerDensity of densities) {
            const multiplier = studioLivingInkWebGlGranulationMultiplier({
              grain: grainIndex / 16,
              tooth: toothIndex / 16,
              granulationAmount: amountIndex / 8,
              centerDensity,
            });
            observedMinimum = Math.min(observedMinimum, multiplier);
            observedMaximum = Math.max(observedMaximum, multiplier);
            expect(Number.isFinite(multiplier)).toBe(true);
            expect(multiplier).toBeGreaterThanOrEqual(
              STUDIO_LIVING_INK_GRANULATION_MULTIPLIER_BOUNDS.minimum,
            );
            expect(multiplier).toBeLessThanOrEqual(
              STUDIO_LIVING_INK_GRANULATION_MULTIPLIER_BOUNDS.maximum,
            );
            const opticalDensity = Math.min(
              STUDIO_LIVING_INK_MAXIMUM_OPTICAL_DENSITY,
              Math.max(0, centerDensity * multiplier),
            );
            expect(Number.isFinite(opticalDensity)).toBe(true);
            expect(opticalDensity).toBeGreaterThanOrEqual(0);
            expect(opticalDensity).toBeLessThanOrEqual(
              STUDIO_LIVING_INK_MAXIMUM_OPTICAL_DENSITY,
            );
          }
        }
      }
    }
    expect(observedMinimum).toBe(STUDIO_LIVING_INK_GRANULATION_MULTIPLIER_BOUNDS.minimum);
    expect(observedMaximum).toBeGreaterThan(1);
    expect(observedMaximum).toBeLessThanOrEqual(
      STUDIO_LIVING_INK_GRANULATION_MULTIPLIER_BOUNDS.maximum,
    );
    expect(() => studioLivingInkWebGlGranulationMultiplier({
      grain: Number.NaN,
      tooth: 0,
      granulationAmount: 1,
      centerDensity: 0.1,
    })).toThrow(RangeError);
  });

  it("keeps the display FBO as the sole pixel authority and shares the measured sediment gain", () => {
    const source = readFileSync(
      new URL("./studio-living-ink-webgl2-runtime.ts", import.meta.url),
      "utf8",
    );
    const renderStart = source.indexOf("private render(displayMode");
    const readbackStart = source.indexOf("private displayPixels()", renderStart);
    const renderBody = source.slice(renderStart, readbackStart);

    expect(source).not.toContain("this.canvas.transferToImageBitmap()");
    expect(renderBody).not.toContain("this.draw(null)");
    expect(source).toContain("const pixels = this.displayPixels()");
    expect(source).toContain("await this.presentDisplayPixels(pixels)");
    expect(source.match(/displaySha256: sha256\(canonicalStudioLivingInkDisplayRgba8\(pixels\)\)/g))
      .toHaveLength(2);
    expect(source.match(/displayHashEncoding: "premultiplied-rgba8-v2"/g)).toHaveLength(2);

    expect(STUDIO_LIVING_INK_WEBGL2_DISPLAY_GRANULATION_SEDIMENT_GAIN).toBe(2.35);
    expect(STUDIO_LIVING_INK_WEBGL2_DILUTE_SEDIMENT_RESPONSE).toEqual({
      additionalGain: 4.6,
      fullStrengthDensity: 0.035,
      fadeOutDensity: 0.2,
    });
    expect(source).toContain("float diluteSedimentBoost = 1.0");
    expect(source).toContain("* diluteSedimentBoost");
    expect(source).toContain("float granulationMultiplier = clamp(");
    expect(source).toContain("fixedOpticalDensity *= granulationMultiplier");
    expect(source).toContain("mobileOpticalDensity *= granulationMultiplier");
    expect(source).toContain("vec3 opticalDensity = clamp(");
    expect(source).toContain("STUDIO_LIVING_INK_MAXIMUM_OPTICAL_DENSITY.toFixed(1)");
    expect(source).not.toContain("granulationAmount * 2.15");
  });
});
