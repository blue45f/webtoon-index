import { describe, expect, it } from "vitest";

import {
  STUDIO_GPU_BRISTLE_COMPONENTS_PER_SPLAT,
  STUDIO_GPU_BRISTLE_TOLERANCES,
} from "./studio-gpu-bristle-contract";
import {
  STUDIO_GPU_BRISTLE_IMPASTO_REFERENCE_VERSION,
  StudioGpuBristleImpastoReferenceError,
  compareStudioGpuBristleImpastoLsb,
  computeStudioGpuBristleImpastoReference,
  createStudioGpuBristleRidgeHeightField,
  rasterizeStudioGpuBristleSplats,
  studioGpuBristleReliefContrast,
  type StudioGpuBristleRaster,
} from "./studio-gpu-bristle-impasto-reference";
import {
  advanceStudioGpuBristleReference,
  createStudioGpuBristleReference,
  type StudioGpuBristleStation,
} from "./studio-gpu-bristle-reference";

function oneSplat(options: {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  radius: number;
  weight: number;
  ryb?: readonly [number, number, number];
  height?: number;
}): Float64Array {
  const buffer = new Float64Array(STUDIO_GPU_BRISTLE_COMPONENTS_PER_SPLAT);
  const ryb = options.ryb ?? ([1, 1, 1] as const);
  buffer[0] = options.ax;
  buffer[1] = options.ay;
  buffer[2] = options.bx;
  buffer[3] = options.by;
  buffer[4] = ryb[0];
  buffer[5] = ryb[1];
  buffer[6] = ryb[2];
  buffer[7] = options.weight;
  buffer[8] = options.radius;
  buffer[9] = options.height ?? options.weight;
  return buffer;
}

function coverageAt(raster: StudioGpuBristleRaster, x: number, y: number): number {
  return raster.paint[(y * raster.width + x) * 4 + 3]!;
}

describe("studio-gpu-bristle-impasto-reference rasteriser", () => {
  it("stamps a capsule along the segment and nothing beyond its radius", () => {
    const raster = rasterizeStudioGpuBristleSplats(
      oneSplat({ ax: 8, ay: 16, bx: 24, by: 16, radius: 5, weight: 1 }),
      { width: 32, height: 32 },
    );
    // On the segment, at both ends and in the middle.
    expect(coverageAt(raster, 8, 16)).toBeGreaterThan(0.5);
    expect(coverageAt(raster, 16, 16)).toBeGreaterThan(0.5);
    expect(coverageAt(raster, 24, 16)).toBeGreaterThan(0.5);
    // Perpendicular falloff.
    expect(coverageAt(raster, 16, 19)).toBeGreaterThan(0);
    expect(coverageAt(raster, 16, 19)).toBeLessThan(coverageAt(raster, 16, 16));
    // Outside the capsule entirely.
    expect(coverageAt(raster, 16, 25)).toBe(0);
    expect(coverageAt(raster, 1, 16)).toBe(0);
  });

  it("skips zero-weight slots so unused capacity costs nothing", () => {
    const raster = rasterizeStudioGpuBristleSplats(
      oneSplat({ ax: 16, ay: 16, bx: 16, by: 16, radius: 6, weight: 0 }),
      { width: 32, height: 32 },
    );
    expect(raster.paint.every((value) => value === 0)).toBe(true);
    expect(raster.heightField.every((value) => value === 0)).toBe(true);
  });

  it("accumulates additively, mirroring blend {one, one}", () => {
    const single = rasterizeStudioGpuBristleSplats(
      oneSplat({ ax: 16, ay: 16, bx: 16, by: 16, radius: 6, weight: 0.4 }),
      { width: 32, height: 32 },
    );
    const record = oneSplat({ ax: 16, ay: 16, bx: 16, by: 16, radius: 6, weight: 0.4 });
    const doubled = new Float64Array(STUDIO_GPU_BRISTLE_COMPONENTS_PER_SPLAT * 2);
    doubled.set(record, 0);
    doubled.set(record, STUDIO_GPU_BRISTLE_COMPONENTS_PER_SPLAT);
    const stacked = rasterizeStudioGpuBristleSplats(doubled, { width: 32, height: 32 });
    expect(coverageAt(stacked, 16, 16)).toBeCloseTo(coverageAt(single, 16, 16) * 2, 6);
  });

  it("honours the raster origin", () => {
    const shifted = rasterizeStudioGpuBristleSplats(
      oneSplat({ ax: 116, ay: 116, bx: 116, by: 116, radius: 6, weight: 1 }),
      { width: 32, height: 32, originX: 100, originY: 100 },
    );
    expect(coverageAt(shifted, 16, 16)).toBeGreaterThan(0.5);
  });

  it("refuses malformed inputs", () => {
    expect(() =>
      rasterizeStudioGpuBristleSplats(new Float64Array(12), { width: 0, height: 8 }),
    ).toThrow(StudioGpuBristleImpastoReferenceError);
    expect(() =>
      rasterizeStudioGpuBristleSplats(new Float64Array(7), { width: 8, height: 8 }),
    ).toThrow(StudioGpuBristleImpastoReferenceError);
  });
});

describe("studio-gpu-bristle-impasto-reference resolve", () => {
  it("leaves flat paint at exactly the identity shading multiplier", () => {
    const width = 16;
    const height = 16;
    const raster: StudioGpuBristleRaster = {
      width,
      height,
      paint: new Float32Array(width * height * 4),
      heightField: new Float32Array(width * height).fill(0.5),
    };
    const resolve = computeStudioGpuBristleImpastoReference(raster);
    for (const value of resolve.shading) expect(value).toBeCloseTo(1, 6);
    expect(studioGpuBristleReliefContrast(resolve.shading)).toBeCloseTo(0, 6);
  });

  it("produces relief contrast across a ridge, which is gate G4's fourth threshold", () => {
    const width = 64;
    const height = 32;
    const raster: StudioGpuBristleRaster = {
      width,
      height,
      paint: new Float32Array(width * height * 4),
      heightField: createStudioGpuBristleRidgeHeightField(width, height, 1),
    };
    const lit = computeStudioGpuBristleImpastoReference(raster);
    expect(studioGpuBristleReliefContrast(lit.shading)).toBeGreaterThan(0.05);

    // NORMAL_SCALE collapsing is the failure every other admission threshold stays green through:
    // paper stddev, stroke darkness and untouched-region stddev are all unaffected while the
    // impasto reads flat.
    const flattened = computeStudioGpuBristleImpastoReference(raster, { normalScale: 4000 });
    expect(studioGpuBristleReliefContrast(flattened.shading)).toBeLessThan(
      studioGpuBristleReliefContrast(lit.shading) / 10,
    );
  });

  it("renders pigment over paper instead of returning a blank page", () => {
    const width = 48;
    const height = 24;
    const raster = rasterizeStudioGpuBristleSplats(
      oneSplat({ ax: 8, ay: 12, bx: 40, by: 12, radius: 5, weight: 1, ryb: [1, 0, 0] }),
      { width, height },
    );
    const resolve = computeStudioGpuBristleImpastoReference(raster, { paperRgb: [1, 1, 1] });
    const paperPixel = (0 * width + 0) * 4;
    const inkPixel = (12 * width + 24) * 4;
    expect(resolve.rgba[paperPixel]).toBe(255);
    expect(resolve.rgba[paperPixel + 1]).toBe(255);
    expect(resolve.rgba[paperPixel + 2]).toBe(255);
    // Pure RYB red resolves to RGB red: the green and blue channels must actually drop.
    expect(resolve.rgba[inkPixel]).toBeGreaterThan(200);
    expect(resolve.rgba[inkPixel + 1]).toBeLessThan(120);
    expect(resolve.rgba[inkPixel + 2]).toBeLessThan(120);
    expect(resolve.rgba[inkPixel + 3]).toBe(255);
  });

  it("applies an injected grain sampler without owning one", () => {
    const width = 16;
    const height = 16;
    const raster: StudioGpuBristleRaster = {
      width,
      height,
      paint: new Float32Array(width * height * 4),
      heightField: new Float32Array(width * height),
    };
    const plain = computeStudioGpuBristleImpastoReference(raster, { paperRgb: [1, 1, 1] });
    const grained = computeStudioGpuBristleImpastoReference(raster, {
      paperRgb: [1, 1, 1],
      grain: (x, y) => ((x + y) % 2 === 0 ? 1 : 0),
      grainAmount: 0.5,
    });
    expect(plain.rgba[0]).toBe(255);
    expect(grained.rgba[0]).toBe(255);
    expect(grained.rgba[4]).toBeLessThan(200);
  });

  it("is deterministic", () => {
    const raster = rasterizeStudioGpuBristleSplats(
      oneSplat({ ax: 4, ay: 8, bx: 20, by: 9, radius: 3.5, weight: 0.7, ryb: [0.9, 0.2, 0.1] }),
      { width: 24, height: 16 },
    );
    const first = computeStudioGpuBristleImpastoReference(raster);
    const second = computeStudioGpuBristleImpastoReference(raster);
    expect(Array.from(second.rgba)).toEqual(Array.from(first.rgba));
    expect(STUDIO_GPU_BRISTLE_IMPASTO_REFERENCE_VERSION).toBe(
      "studio-gpu-bristle-impasto-reference-v1",
    );
  });
});

describe("studio-gpu-bristle-impasto-reference LSB comparison", () => {
  it("passes identical buffers and fails a two-level drift", () => {
    const reference = Uint8ClampedArray.from([10, 20, 30, 255, 40, 50, 60, 255]);
    expect(compareStudioGpuBristleImpastoLsb(reference, reference)).toEqual({
      maxDelta: 0,
      mismatchCount: 0,
      threshold: STUDIO_GPU_BRISTLE_TOLERANCES.impastoChannelLsb,
      pass: true,
    });
    const nudged = Uint8ClampedArray.from(reference);
    nudged[1] = 21;
    expect(compareStudioGpuBristleImpastoLsb(nudged, reference).pass).toBe(true);
    const drifted = Uint8ClampedArray.from(reference);
    drifted[1] = 22;
    const judgement = compareStudioGpuBristleImpastoLsb(drifted, reference);
    expect(judgement.pass).toBe(false);
    expect(judgement.maxDelta).toBe(2);
  });

  it("catches a resolve that forgot to write opaque alpha", () => {
    const reference = new Uint8ClampedArray(16).fill(255);
    const transparent = Uint8ClampedArray.from(reference);
    transparent[3] = 0;
    expect(compareStudioGpuBristleImpastoLsb(transparent, reference).pass).toBe(false);
  });

  it("refuses mismatched buffer lengths", () => {
    expect(() =>
      compareStudioGpuBristleImpastoLsb(new Uint8ClampedArray(4), new Uint8ClampedArray(8)),
    ).toThrow(StudioGpuBristleImpastoReferenceError);
  });
});

describe("studio-gpu-bristle-impasto-reference end to end", () => {
  it("turns a solved stroke into visible relieved paint — the no-WebGPU fallback actually renders", () => {
    const reference = createStudioGpuBristleReference({
      baseRadiusPx: 9,
      bristleCount: 32,
      seed: 5,
      ink: [0.95, 0.15, 0.1],
    });
    const stations: StudioGpuBristleStation[] = [];
    for (let index = 0; index < 140; index += 1) {
      stations.push({ x: 20 + index, y: 40, pressure: 0.8, dtMs: 1000 / 120 });
    }
    const advance = advanceStudioGpuBristleReference(reference, stations);
    const raster = rasterizeStudioGpuBristleSplats(advance.splats, { width: 180, height: 80 });
    const resolve = computeStudioGpuBristleImpastoReference(raster, { paperRgb: [1, 1, 1] });

    let painted = 0;
    let relieved = 0;
    for (let pixel = 0; pixel < resolve.rgba.length; pixel += 4) {
      if (resolve.rgba[pixel + 1]! < 250) painted += 1;
      if (Math.abs(resolve.shading[pixel / 4]! - 1) > 0.01) relieved += 1;
    }
    // A stroke 140 stations long across a 180x80 tile must mark a real share of it, and the height
    // field it deposits must produce real GGX relief rather than a uniform multiplier.
    expect(painted).toBeGreaterThan(400);
    expect(relieved).toBeGreaterThan(400);
    expect(studioGpuBristleReliefContrast(resolve.shading)).toBeGreaterThan(0.02);
  });
});
