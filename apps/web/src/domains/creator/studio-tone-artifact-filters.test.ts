import { describe, expect, it } from "vitest";

import {
  denoiseStudioRgba,
  reduceStudioJpegArtifacts,
  removeStudioScreentoneArtifacts,
} from "./studio-tone-artifact-filter-kernels";
import {
  applyStudioToneArtifactResultInPlace,
  edgeAwareDenoiseKonvaFilter,
  isIdentityStudioEdgeAwareDenoise,
  isIdentityStudioJpegArtifactReduction,
  isIdentityStudioScreentoneRemoval,
  jpegArtifactReductionKonvaFilter,
  screentoneRemovalKonvaFilter,
  STUDIO_TONE_ARTIFACT_DIRECT_MAX_NEIGHBORHOOD_SAMPLES,
  studioToneArtifactNeighborhoodSampleEstimate,
  studioToneArtifactRequiresWorker,
} from "./studio-tone-artifact-filters";

import type { StudioImageDataLike } from "./studio-filters";

function fixture(width = 16, height = 16): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const block = x < 8 ? 106 : 127;
      const dot = x % 3 === 1 && y % 3 === 1 ? -65 : 0;
      const noise = ((x * 19 + y * 23) % 17) - 8;
      const value = Math.max(0, Math.min(255, block + dot + noise));
      data[offset] = value;
      data[offset + 1] = value + 2;
      data[offset + 2] = value - 2;
      data[offset + 3] = 80 + (x * 7 + y * 5) % 176;
    }
  }
  return { width, height, data };
}

function clone(image: StudioImageDataLike): StudioImageDataLike {
  return {
    width: image.width,
    height: image.height,
    data: new Uint8ClampedArray(image.data),
  };
}

function appliedPixels(
  result:
    | ReturnType<typeof removeStudioScreentoneArtifacts>
    | ReturnType<typeof reduceStudioJpegArtifacts>
    | ReturnType<typeof denoiseStudioRgba>,
): Uint8ClampedArray {
  expect(result.status).toBe("applied");
  if (result.status !== "applied") throw new Error(result.detail);
  return result.image.data;
}

describe("studio tone-artifact product adapters", () => {
  it("keeps the three identity contracts explicit", () => {
    expect(isIdentityStudioScreentoneRemoval({ strength: 0 })).toBe(true);
    expect(isIdentityStudioScreentoneRemoval({ strength: 0.01 })).toBe(false);
    expect(isIdentityStudioJpegArtifactReduction({
      deblockStrength: 0,
      deringStrength: 0,
    })).toBe(true);
    expect(isIdentityStudioJpegArtifactReduction({
      deblockStrength: 0,
      deringStrength: 0.01,
    })).toBe(false);
    expect(isIdentityStudioEdgeAwareDenoise({ strength: 0 })).toBe(true);
    expect(isIdentityStudioEdgeAwareDenoise({ strength: 0.01 })).toBe(false);
  });

  it("keeps every in-place adapter byte-identical to its immutable pure kernel", () => {
    const source = fixture();
    const tone = clone(source);
    const jpeg = clone(source);
    const denoise = clone(source);
    const toneOptions = { radius: 2, strength: 0.82, inkLumaThreshold: 76 };
    const jpegOptions = {
      deblockStrength: 0.74,
      deringStrength: 0.42,
      boundaryThreshold: 7,
      protectedEdgeThreshold: 92,
      ringingThreshold: 19,
      inkLumaThreshold: 66,
    };
    const denoiseOptions = { radius: 2, strength: 0.76, rangeThreshold: 84 };

    screentoneRemovalKonvaFilter.call({
      attrs: {
        toneRemovalRadius: toneOptions.radius,
        toneRemovalStrength: toneOptions.strength,
        toneRemovalInkThreshold: toneOptions.inkLumaThreshold,
      },
    }, tone);
    jpegArtifactReductionKonvaFilter.call({
      attrs: {
        jpegDeblockStrength: jpegOptions.deblockStrength,
        jpegDeringStrength: jpegOptions.deringStrength,
        jpegBoundaryThreshold: jpegOptions.boundaryThreshold,
        jpegProtectedEdgeThreshold: jpegOptions.protectedEdgeThreshold,
        jpegRingingThreshold: jpegOptions.ringingThreshold,
        jpegInkThreshold: jpegOptions.inkLumaThreshold,
      },
    }, jpeg);
    edgeAwareDenoiseKonvaFilter.call({
      attrs: {
        edgeDenoiseRadius: denoiseOptions.radius,
        edgeDenoiseStrength: denoiseOptions.strength,
        edgeDenoiseRangeThreshold: denoiseOptions.rangeThreshold,
      },
    }, denoise);

    expect(tone.data).toEqual(
      appliedPixels(removeStudioScreentoneArtifacts(source, toneOptions)),
    );
    expect(jpeg.data).toEqual(
      appliedPixels(reduceStudioJpegArtifacts(source, jpegOptions)),
    );
    expect(denoise.data).toEqual(
      appliedPixels(denoiseStudioRgba(source, denoiseOptions)),
    );
  });

  it("fails closed for missing attrs and refused or mismatched receipts", () => {
    const image = fixture(4, 4);
    const before = new Uint8ClampedArray(image.data);
    screentoneRemovalKonvaFilter.call({}, image);
    jpegArtifactReductionKonvaFilter.call({ attrs: {} }, image);
    edgeAwareDenoiseKonvaFilter.call({ attrs: {} }, image);
    expect(image.data).toEqual(before);

    const refused = denoiseStudioRgba(image, undefined, {
      maxPixels: 1,
      maxNeighborhoodSamples: 1,
      maxWorkingBytes: 1,
    });
    expect(applyStudioToneArtifactResultInPlace(image, refused)).toBe(false);
    expect(image.data).toEqual(before);

    const applied = removeStudioScreentoneArtifacts(image);
    expect(applied.status).toBe("applied");
    if (applied.status !== "applied") return;
    expect(applyStudioToneArtifactResultInPlace(
      { width: 2, height: 2, data: new Uint8ClampedArray(16) },
      applied,
    )).toBe(false);
  });

  it("counts direct and duplicate smart cleanup work before selecting the Worker", () => {
    const source = {
      screentoneRemoval: { radius: 1, strength: 1, inkLumaThreshold: 72 },
      smartFilters: {
        version: 1 as const,
        entries: [
          {
            id: "tone-a",
            engine: "screentone-removal" as const,
            enabled: true,
            params: { radius: 1, strength: 1 },
          },
          {
            id: "tone-b",
            engine: "screentone-removal" as const,
            enabled: true,
            params: { radius: 1, strength: 1 },
          },
        ],
      },
    };
    expect(studioToneArtifactNeighborhoodSampleEstimate(source, 100, 50)).toBe(
      100 * 50 * 9 * 3,
    );
    expect(studioToneArtifactRequiresWorker(source, 100, 50)).toBe(false);
    expect(studioToneArtifactRequiresWorker(
      source,
      Math.ceil(STUDIO_TONE_ARTIFACT_DIRECT_MAX_NEIGHBORHOOD_SAMPLES / 27) + 1,
      1,
    )).toBe(true);
  });

  it("fails closed before an oversized direct adapter allocates kernel buffers", () => {
    const width = Math.floor(
      STUDIO_TONE_ARTIFACT_DIRECT_MAX_NEIGHBORHOOD_SAMPLES / 9,
    ) + 1;
    let dataReads = 0;
    const source = {
      width,
      height: 1,
      get data(): Uint8ClampedArray {
        dataReads += 1;
        throw new Error("The direct preflight must refuse before reading RGBA data.");
      },
    } satisfies StudioImageDataLike;

    expect(() => edgeAwareDenoiseKonvaFilter.call({
      attrs: {
        edgeDenoiseRadius: 1,
        edgeDenoiseStrength: 1,
        edgeDenoiseRangeThreshold: 72,
        toneArtifactExecution: "direct",
      },
    }, source)).not.toThrow();
    expect(dataReads).toBe(0);
  });
});
