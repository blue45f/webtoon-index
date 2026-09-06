import { describe, expect, it } from "vitest";

import {
  STUDIO_HOKUSAI_NATURAL_MEDIA_CONTRACT_VERSION,
  studioHokusaiDefaultMaterialProfileId,
  type StudioHokusaiMaterialProfileId,
  type StudioHokusaiNaturalMediaPresetId,
  type StudioHokusaiNaturalMediaRenderPlan,
} from "./studio-hokusai-natural-media-contract";
import {
  applyStudioHokusaiNaturalMediaTextureV2,
  STUDIO_HOKUSAI_LOCAL_DIRECTION_INDEX_LIMITS,
  STUDIO_HOKUSAI_NATURAL_MEDIA_TEXTURE_VERSION,
  studioHokusaiMaterialProfileNoiseEvaluationCount,
} from "./studio-hokusai-natural-media-texture-v2";

const WIDTH = 96;
const HEIGHT = 48;
const DIRTY = [4, 4, 88, 40] as const;
const MATERIAL_PROFILE_CARRIERS = new Map<
  StudioHokusaiMaterialProfileId,
  StudioHokusaiNaturalMediaPresetId
>([
  ["pencil", "pencil"],
  ["charcoal", "charcoal"],
  ["chalk", "charcoal"],
  ["crayon", "charcoal"],
  ["pastel", "charcoal"],
  ["oil-pastel", "charcoal"],
  ["oil", "oil"],
  ["acrylic", "oil"],
  ["gouache", "oil"],
  ["painterly", "oil"],
]);
const TEXTURED_MATERIAL_PROFILES = [...MATERIAL_PROFILE_CARRIERS.keys()];

function materialPlan(
  materialProfileId: StudioHokusaiMaterialProfileId,
  seed = 0x1234_5678,
): StudioHokusaiNaturalMediaRenderPlan {
  return plan(
    MATERIAL_PROFILE_CARRIERS.get(materialProfileId)!,
    seed,
    materialProfileId,
  );
}

function fullLayout(
  dirtyBounds: readonly [number, number, number, number] = DIRTY,
) {
  return {
    frameBounds: [0, 0, WIDTH, HEIGHT] as const,
    dirtyBounds,
  };
}

function plan(
  presetId: StudioHokusaiNaturalMediaPresetId,
  seed = 0x1234_5678,
  materialProfileId: StudioHokusaiMaterialProfileId =
    studioHokusaiDefaultMaterialProfileId(presetId),
): StudioHokusaiNaturalMediaRenderPlan {
  return {
    kind: "studio-hokusai-natural-media/render-plan",
    version: STUDIO_HOKUSAI_NATURAL_MEDIA_CONTRACT_VERSION,
    engine: {
      id: "reearth-hokusai",
      version: "0.3.0",
      brushFormat: "libmypaint-myb-v3",
      alpha: "transparent-straight-rgba8",
      execution: "dedicated-worker-wasm",
    },
    source: {
      elementId: "texture-fixture",
      brushId: "pencil",
      sourcePointCount: 3,
      revision: "hokusai-source-v1:0123456789abcdef",
    },
    presetId,
    materialProfileId,
    color: "#705848",
    opacity: 1,
    seed,
    logicalBounds: { x: 120, y: 240, width: WIDTH, height: HEIGHT },
    raster: {
      width: WIDTH,
      height: HEIGHT,
      scale: 1,
      radiusPixels: 12,
    },
    samples: [
      { x: 8, y: 24, pressure: 0.2, tiltX: 0, tiltY: 0, timeMilliseconds: 0 },
      { x: 48, y: 24, pressure: 0.8, tiltX: 0, tiltY: 0, timeMilliseconds: 16 },
      { x: 88, y: 24, pressure: 0.4, tiltX: 0, tiltY: 0, timeMilliseconds: 32 },
    ],
  };
}

function ribbon(alpha: number): Uint8Array {
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let y = 10; y < 38; y += 1) {
    for (let x = 4; x < 92; x += 1) {
      const index = (y * WIDTH + x) * 4;
      pixels[index] = 112;
      pixels[index + 1] = 88;
      pixels[index + 2] = 72;
      pixels[index + 3] = alpha;
    }
  }
  return pixels;
}

function periodicDabStroke(alpha: number): Uint8Array {
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
  const centers = Array.from({ length: 10 }, (_, index) => 8 + index * 8);
  const radius = 5.5;
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      let coverage = 0;
      for (const centerX of centers) {
        const distance = Math.hypot(x - centerX, y - 24);
        if (distance >= radius) continue;
        coverage = Math.max(coverage, Math.sqrt(1 - distance / radius));
      }
      if (coverage <= 0) continue;
      const index = (y * WIDTH + x) * 4;
      pixels[index] = 112;
      pixels[index + 1] = 88;
      pixels[index + 2] = 72;
      pixels[index + 3] = Math.round(alpha * coverage);
    }
  }
  return pixels;
}

function crossedStroke(alpha: number): Uint8Array {
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let y = 4; y < 44; y += 1) {
    for (let x = 16; x < 80; x += 1) {
      const station = (x - 16) / 64;
      const upperY = 8 + station * 32;
      const lowerY = 40 - station * 32;
      const distance = Math.min(Math.abs(y - upperY), Math.abs(y - lowerY));
      if (distance > 4) continue;
      const index = (y * WIDTH + x) * 4;
      pixels[index] = 112;
      pixels[index + 1] = 88;
      pixels[index + 2] = 72;
      pixels[index + 3] = Math.round(alpha * Math.sqrt(1 - distance / 4));
    }
  }
  return pixels;
}

function centrelineAlpha(pixels: Uint8Array): number[] {
  const values = [];
  for (let x = 8; x <= 80; x += 1) {
    values.push(pixels[(24 * WIDTH + x) * 4 + 3] ?? 0);
  }
  return values;
}

function packedFrame(
  source: Uint8Array,
  bounds: readonly [number, number, number, number],
): Uint8Array {
  const [x, y, width, height] = bounds;
  const packed = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const sourceStart = ((y + row) * WIDTH + x) * 4;
    packed.set(
      source.subarray(sourceStart, sourceStart + width * 4),
      row * width * 4,
    );
  }
  return packed;
}

function compositePackedFrame(
  destination: Uint8Array,
  packed: Uint8Array,
  bounds: readonly [number, number, number, number],
): void {
  const [x, y, width, height] = bounds;
  expect(packed.byteLength).toBe(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const sourceStart = row * width * 4;
    const destinationStart = ((y + row) * WIDTH + x) * 4;
    destination.set(
      packed.subarray(sourceStart, sourceStart + width * 4),
      destinationStart,
    );
  }
}

function channelValues(
  pixels: Uint8Array,
  channel: 0 | 1 | 2 | 3,
): number[] {
  const values = [];
  for (let y = 10; y < 38; y += 1) {
    for (let x = 4; x < 92; x += 1) {
      values.push(pixels[(y * WIDTH + x) * 4 + channel] ?? 0);
    }
  }
  return values;
}

function standardDeviation(values: readonly number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0)
      / values.length,
  );
}

function periodicSeamEnergy(
  pixels: Uint8Array,
  period: number,
): Readonly<{ seam: number; interior: number }> {
  let seam = 0;
  let seamCount = 0;
  let interior = 0;
  let interiorCount = 0;
  for (let y = 11; y < 37; y += 1) {
    for (let x = 5; x < 91; x += 1) {
      const alpha = pixels[(y * WIDTH + x) * 4 + 3] ?? 0;
      const previousX = pixels[(y * WIDTH + x - 1) * 4 + 3] ?? 0;
      const previousY = pixels[((y - 1) * WIDTH + x) * 4 + 3] ?? 0;
      const difference = (Math.abs(alpha - previousX) + Math.abs(alpha - previousY)) / 2;
      if (x % period === 0 || y % period === 0) {
        seam += difference;
        seamCount += 1;
      } else {
        interior += difference;
        interiorCount += 1;
      }
    }
  }
  return {
    seam: seam / seamCount,
    interior: interior / interiorCount,
  };
}

function meanNeighbourDifference(
  pixels: Uint8Array,
  deltaX: number,
  deltaY: number,
): number {
  let difference = 0;
  let count = 0;
  for (let y = 11; y < 37; y += 1) {
    for (let x = 5; x < 91; x += 1) {
      const current = (y * WIDTH + x) * 4;
      const neighbour = (
        (y + deltaY) * WIDTH + x + deltaX
      ) * 4;
      difference += Math.abs(
        (pixels[current] ?? 0) - (pixels[neighbour] ?? 0),
      );
      count += 1;
    }
  }
  return difference / count;
}

function rectangularRibbon(width: number, height: number, alpha: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 6; y < height - 6; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      pixels[index] = 112;
      pixels[index + 1] = 88;
      pixels[index + 2] = 72;
      pixels[index + 3] = alpha;
    }
  }
  return pixels;
}

function packedRectangularFrame(
  source: Uint8Array,
  surfaceWidth: number,
  bounds: readonly [number, number, number, number],
): Uint8Array {
  const [x, y, width, height] = bounds;
  const patch = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const sourceStart = ((y + row) * surfaceWidth + x) * 4;
    patch.set(source.subarray(sourceStart, sourceStart + width * 4), row * width * 4);
  }
  return patch;
}

function compositeRectangularFrame(
  destination: Uint8Array,
  surfaceWidth: number,
  patch: Uint8Array,
  bounds: readonly [number, number, number, number],
): void {
  const [x, y, width, height] = bounds;
  for (let row = 0; row < height; row += 1) {
    const sourceStart = row * width * 4;
    const destinationStart = ((y + row) * surfaceWidth + x) * 4;
    destination.set(
      patch.subarray(sourceStart, sourceStart + width * 4),
      destinationStart,
    );
  }
}

describe("Studio Hokusai natural-media texture v2", () => {
  it("keeps every profile inside a deterministic per-pixel noise budget", () => {
    const counts = new Map(TEXTURED_MATERIAL_PROFILES.map((profile) => [
      profile,
      studioHokusaiMaterialProfileNoiseEvaluationCount(profile),
    ]));
    expect(Object.fromEntries(counts)).toEqual({
      pencil: 5,
      charcoal: 4,
      chalk: 4,
      // Directional wax scrape (OSS kernel, three 2-D samples in stroke space) plus a two-sample
      // paper tooth. The scrape alone laid an even film; wax rides the sheet's peaks and skips
      // its valleys, and every sibling dry medium already carried a tooth term while crayon did
      // not. The two extra samples buy that texture back.
      crayon: 5,
      pastel: 4,
      "oil-pastel": 5,
      oil: 3,
      acrylic: 5,
      gouache: 4,
      painterly: 5,
    });
    expect(counts.get("acrylic"))
      .toBeLessThanOrEqual((counts.get("oil") ?? 0) * 2);
    expect(counts.get("painterly"))
      .toBeLessThanOrEqual((counts.get("oil") ?? 0) * 2);
  });

  it("keeps one carrier preset while producing distinct deterministic material profiles", () => {
    const hashes = new Set<string>();
    for (const materialProfileId of TEXTURED_MATERIAL_PROFILES) {
      const first = ribbon(220);
      const second = ribbon(220);
      const renderPlan = materialPlan(materialProfileId);
      const firstMetrics = applyStudioHokusaiNaturalMediaTextureV2(
        first,
        renderPlan,
        fullLayout(),
      );
      const secondMetrics = applyStudioHokusaiNaturalMediaTextureV2(
        second,
        renderPlan,
        fullLayout(),
      );
      expect(first).toEqual(second);
      expect(firstMetrics).toEqual(secondMetrics);
      expect(firstMetrics).toMatchObject({
        presetId: MATERIAL_PROFILE_CARRIERS.get(materialProfileId),
        materialProfileId,
        visiblePixels: 88 * 28,
      });
      hashes.add(Array.from(first).join(","));
    }
    expect(hashes.size).toBe(TEXTURED_MATERIAL_PROFILES.length);
    expect(MATERIAL_PROFILE_CARRIERS.get("charcoal")).toBe("charcoal");
    expect(MATERIAL_PROFILE_CARRIERS.get("chalk")).toBe("charcoal");
    expect(MATERIAL_PROFILE_CARRIERS.get("crayon")).toBe("charcoal");
    expect(MATERIAL_PROFILE_CARRIERS.get("pastel")).toBe("charcoal");
    expect(MATERIAL_PROFILE_CARRIERS.get("oil-pastel")).toBe("charcoal");
    expect(MATERIAL_PROFILE_CARRIERS.get("oil")).toBe("oil");
    expect(MATERIAL_PROFILE_CARRIERS.get("acrylic")).toBe("oil");
    expect(MATERIAL_PROFILE_CARRIERS.get("gouache")).toBe("oil");
    expect(MATERIAL_PROFILE_CARRIERS.get("painterly")).toBe("oil");
  });

  it("keeps every material continuous, retrace-monotonic and free of square lattice seams", () => {
    for (const materialProfileId of TEXTURED_MATERIAL_PROFILES) {
      const onePass = periodicDabStroke(104);
      const retraced = periodicDabStroke(216);
      const renderPlan = materialPlan(materialProfileId);
      applyStudioHokusaiNaturalMediaTextureV2(
        onePass,
        renderPlan,
        fullLayout([0, 0, WIDTH, HEIGHT]),
      );
      applyStudioHokusaiNaturalMediaTextureV2(
        retraced,
        renderPlan,
        fullLayout([0, 0, WIDTH, HEIGHT]),
      );
      const centreline = centrelineAlpha(onePass);
      expect(Math.min(...centreline), materialProfileId).toBeGreaterThan(0);
      expect(centreline.every((alpha) => alpha > 0), materialProfileId).toBe(true);
      for (let index = 3; index < onePass.length; index += 4) {
        if ((onePass[index] ?? 0) <= 0) continue;
        expect(retraced[index], `${materialProfileId}:${index}`)
          .toBeGreaterThanOrEqual(onePass[index] ?? 0);
      }

      const filled = ribbon(196);
      applyStudioHokusaiNaturalMediaTextureV2(
        filled,
        renderPlan,
        fullLayout(),
      );
      for (const period of [4, 8, 16]) {
        const energy = periodicSeamEnergy(filled, period);
        expect(energy.seam, `${materialProfileId}:${period}`)
          .toBeLessThan(energy.interior * 1.85 + 0.35);
      }
    }
  });

  it("is exact for the same seed and visibly separates the three media", () => {
    const hashes = new Set<string>();
    for (const presetId of ["pencil", "charcoal", "oil"] as const) {
      const first = ribbon(220);
      const second = ribbon(220);
      const firstMetrics = applyStudioHokusaiNaturalMediaTextureV2(
        first,
        plan(presetId),
        fullLayout(),
      );
      const secondMetrics = applyStudioHokusaiNaturalMediaTextureV2(
        second,
        plan(presetId),
        fullLayout(),
      );
      expect(first).toEqual(second);
      expect(firstMetrics).toEqual(secondMetrics);
      expect(firstMetrics).toMatchObject({
        version: STUDIO_HOKUSAI_NATURAL_MEDIA_TEXTURE_VERSION,
        presetId,
        visiblePixels: 88 * 28,
      });
      expect(firstMetrics.alphaChangedPixels).toBeGreaterThan(2_000);
      expect(standardDeviation(channelValues(first, 3))).toBeGreaterThan(5);
      hashes.add(Array.from(first).join(","));
    }
    expect(hashes.size).toBe(3);
  });

  it("preserves non-decreasing retrace alpha and cannot punch centreline gaps", () => {
    for (const presetId of ["pencil", "charcoal", "oil"] as const) {
      const onePass = ribbon(96);
      const retraced = ribbon(196);
      applyStudioHokusaiNaturalMediaTextureV2(
        onePass,
        plan(presetId),
        fullLayout(),
      );
      applyStudioHokusaiNaturalMediaTextureV2(
        retraced,
        plan(presetId),
        fullLayout(),
      );
      for (let y = 10; y < 38; y += 1) {
        for (let x = 4; x < 92; x += 1) {
          const alphaIndex = (y * WIDTH + x) * 4 + 3;
          expect(retraced[alphaIndex]).toBeGreaterThanOrEqual(
            onePass[alphaIndex] ?? 0,
          );
          expect(onePass[alphaIndex]).toBeGreaterThan(0);
        }
      }
    }
  });

  it("does not expose periodic dab joints across a long charcoal carrier", () => {
    const source = periodicDabStroke(210);
    const before = centrelineAlpha(source);
    const textured = source.slice();
    applyStudioHokusaiNaturalMediaTextureV2(
      textured,
      plan("charcoal"),
      {
        frameBounds: [0, 0, WIDTH, HEIGHT],
        dirtyBounds: [0, 0, WIDTH, HEIGHT],
      },
    );
    const after = centrelineAlpha(textured);

    expect(Math.min(...before)).toBeGreaterThan(0);
    expect(Math.min(...after)).toBeGreaterThanOrEqual(48);
    expect(standardDeviation(after)).toBeLessThan(
      standardDeviation(before) * 1.3,
    );
    expect(after.every((alpha) => alpha > 0)).toBe(true);
  });

  it("keeps crossed charcoal retraces monotonic without erasing pigment", () => {
    const firstPass = crossedStroke(112);
    const retraced = crossedStroke(224);
    applyStudioHokusaiNaturalMediaTextureV2(
      firstPass,
      plan("charcoal"),
      fullLayout([0, 0, WIDTH, HEIGHT]),
    );
    applyStudioHokusaiNaturalMediaTextureV2(
      retraced,
      plan("charcoal"),
      fullLayout([0, 0, WIDTH, HEIGHT]),
    );
    for (let index = 3; index < firstPass.length; index += 4) {
      if ((firstPass[index] ?? 0) <= 0) continue;
      expect(retraced[index]).toBeGreaterThanOrEqual(firstPass[index] ?? 0);
    }
    expect(retraced[(24 * WIDTH + 48) * 4 + 3]).toBeGreaterThan(96);
  });

  it("keeps antialiased small-radius graphite visibly legible", () => {
    const pixels = ribbon(24);
    const before = channelValues(pixels, 3);
    applyStudioHokusaiNaturalMediaTextureV2(
      pixels,
      {
        ...plan("pencil"),
        raster: {
          width: WIDTH,
          height: HEIGHT,
          scale: 1,
          radiusPixels: 1.25,
        },
      },
      fullLayout(),
    );
    const after = channelValues(pixels, 3);
    const mean = after.reduce((sum, value) => sum + value, 0) / after.length;
    expect(Math.min(...after)).toBeGreaterThan(0);
    expect(mean).toBeGreaterThan(40);
    expect(standardDeviation(after)).toBeGreaterThan(4.5);
    expect(after.every((value, index) => value >= (before[index] ?? 0))).toBe(true);
  });

  it("renders a packed dirty frame byte-identically to the same full-frame region", () => {
    for (const materialProfileId of TEXTURED_MATERIAL_PROFILES) {
      const full = ribbon(196);
      const packed = packedFrame(full, DIRTY);
      const fullMetrics = applyStudioHokusaiNaturalMediaTextureV2(
        full,
        materialPlan(materialProfileId),
        fullLayout(),
      );
      const packedMetrics = applyStudioHokusaiNaturalMediaTextureV2(
        packed,
        materialPlan(materialProfileId),
        {
          frameBounds: DIRTY,
          dirtyBounds: DIRTY,
        },
      );
      expect(packed).toEqual(packedFrame(full, DIRTY));
      expect(packedMetrics).toEqual(fullMetrics);
    }
  });

  it("matches a fresh irregular patch partition across the 64px tile boundary", () => {
    const partition = [
      [4, 4, 60, 16],
      [64, 4, 28, 16],
      [4, 20, 34, 24],
      [38, 20, 54, 24],
    ] as const;
    for (const materialProfileId of TEXTURED_MATERIAL_PROFILES) {
      const source = ribbon(196);
      const full = source.slice();
      const composed = source.slice();
      applyStudioHokusaiNaturalMediaTextureV2(
        full,
        materialPlan(materialProfileId),
        fullLayout(),
      );
      for (const bounds of partition) {
        const patch = packedFrame(source, bounds);
        applyStudioHokusaiNaturalMediaTextureV2(
          patch,
          materialPlan(materialProfileId),
          {
            frameBounds: bounds,
            dirtyBounds: bounds,
          },
        );
        compositePackedFrame(composed, patch, bounds);
      }
      expect(composed).toEqual(full);
    }
  });

  it("keeps every long dabbed material byte-identical across live dirty patches", () => {
    const partition = [
      [0, 0, 31, HEIGHT],
      [31, 0, 33, HEIGHT],
      [64, 0, WIDTH - 64, HEIGHT],
    ] as const;
    for (const materialProfileId of TEXTURED_MATERIAL_PROFILES) {
      const source = periodicDabStroke(210);
      const canonical = source.slice();
      const live = source.slice();
      applyStudioHokusaiNaturalMediaTextureV2(
        canonical,
        materialPlan(materialProfileId),
        fullLayout([0, 0, WIDTH, HEIGHT]),
      );
      for (const bounds of partition) {
        const patch = packedFrame(source, bounds);
        applyStudioHokusaiNaturalMediaTextureV2(
          patch,
          materialPlan(materialProfileId),
          { frameBounds: bounds, dirtyBounds: bounds },
        );
        compositePackedFrame(live, patch, bounds);
      }
      expect(live, materialProfileId).toEqual(canonical);
    }
  });

  it("keeps a large 512px dirty frame partition invariant for every material profile", () => {
    const width = 512;
    const height = 64;
    const whole = [0, 0, width, height] as const;
    const partition = [
      [0, 0, 127, 31],
      [127, 0, 193, 31],
      [320, 0, 192, 31],
      [0, 31, 211, 33],
      [211, 31, 301, 33],
    ] as const;
    for (const materialProfileId of TEXTURED_MATERIAL_PROFILES) {
      const source = rectangularRibbon(width, height, 196);
      const canonical = source.slice();
      const partitioned = source.slice();
      const renderPlan: StudioHokusaiNaturalMediaRenderPlan = {
        ...materialPlan(materialProfileId),
        logicalBounds: { x: 0, y: 0, width, height },
        raster: { width, height, scale: 1, radiusPixels: 14 },
        samples: [
          {
            x: 0,
            y: height / 2,
            pressure: 0.6,
            tiltX: 0,
            tiltY: 0,
            timeMilliseconds: 0,
          },
          {
            x: width - 1,
            y: height / 2,
            pressure: 0.6,
            tiltX: 0,
            tiltY: 0,
            timeMilliseconds: 100,
          },
        ],
      };
      const canonicalMetrics = applyStudioHokusaiNaturalMediaTextureV2(
        canonical,
        renderPlan,
        { frameBounds: whole, dirtyBounds: whole },
      );
      for (const bounds of partition) {
        const patch = packedRectangularFrame(source, width, bounds);
        applyStudioHokusaiNaturalMediaTextureV2(
          patch,
          renderPlan,
          { frameBounds: bounds, dirtyBounds: bounds },
        );
        compositeRectangularFrame(partitioned, width, patch, bounds);
      }
      expect(canonicalMetrics.visiblePixels, materialProfileId)
        .toBe(width * (height - 12));
      expect(partitioned, materialProfileId).toEqual(canonical);
    }
  });

  it("rejects malformed, overflowing and mismatched packed layouts", () => {
    const base = ribbon(196);
    const renderPlan = plan("pencil");
    const invalidLayouts = [
      {
        frameBounds: [4, 4, 88, 40] as const,
        dirtyBounds: [3, 4, 1, 1] as const,
      },
      {
        frameBounds: [4, 4, 88, 40] as const,
        dirtyBounds: [4, 4, 89, 40] as const,
      },
      {
        frameBounds: [95, 0, 2, 1] as const,
        dirtyBounds: [95, 0, 2, 1] as const,
      },
      {
        frameBounds: [4, 4, 0, 40] as const,
        dirtyBounds: [4, 4, 1, 1] as const,
      },
    ];
    for (const layout of invalidLayouts) {
      expect(() => applyStudioHokusaiNaturalMediaTextureV2(
        base,
        renderPlan,
        layout,
      )).toThrowError(RangeError);
    }
    expect(() => applyStudioHokusaiNaturalMediaTextureV2(
      new Uint8Array(DIRTY[2] * DIRTY[3] * 4 - 1),
      renderPlan,
      {
        frameBounds: DIRTY,
        dirtyBounds: DIRTY,
      },
    )).toThrowError(RangeError);
  });

  it("makes oil bristles vary across the dominant stroke more than along it", () => {
    const pixels = ribbon(220);
    const metrics = applyStudioHokusaiNaturalMediaTextureV2(
      pixels,
      plan("oil"),
      fullLayout(),
    );
    const along = meanNeighbourDifference(pixels, 1, 0);
    const across = meanNeighbourDifference(pixels, 0, 1);
    expect(metrics.dominantDirectionRadians).toBeCloseTo(0, 6);
    expect(metrics.directionIndexMode).toBe("local-grid");
    expect(metrics.directionIndexSegments).toBe(2);
    expect(metrics.directionIndexCellReferences)
      .toBeLessThanOrEqual(
        STUDIO_HOKUSAI_LOCAL_DIRECTION_INDEX_LIMITS.maxCellReferences,
      );
    expect(across).toBeGreaterThan(along * 2);
  });

  it("falls back to the bounded global direction for hostile zigzags and segment counts", () => {
    const base = plan("oil");
    const zigzagSamples = Array.from({ length: 64 }, (_, index) => ({
      x: index % 2 === 0 ? 0 : 2_047,
      y: index % 2 === 0 ? 0 : 2_047,
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      timeMilliseconds: index,
    }));
    const zigzagPlan: StudioHokusaiNaturalMediaRenderPlan = {
      ...base,
      raster: {
        width: 2_048,
        height: 2_048,
        scale: 1,
        radiusPixels: 1,
      },
      logicalBounds: { x: 0, y: 0, width: 2_048, height: 2_048 },
      samples: zigzagSamples,
    };
    const zigzagPixel = new Uint8Array([112, 88, 72, 220]);
    const zigzagMetrics = applyStudioHokusaiNaturalMediaTextureV2(
      zigzagPixel,
      zigzagPlan,
      {
        frameBounds: [0, 0, 1, 1],
        dirtyBounds: [0, 0, 1, 1],
      },
    );
    expect(zigzagMetrics.directionIndexMode)
      .toBe("global-budget-fallback");
    expect(zigzagMetrics.directionIndexSegments)
      .toBeLessThanOrEqual(
        STUDIO_HOKUSAI_LOCAL_DIRECTION_INDEX_LIMITS.maxSegments,
      );
    expect(zigzagMetrics.directionIndexCellReferences)
      .toBeLessThanOrEqual(
        STUDIO_HOKUSAI_LOCAL_DIRECTION_INDEX_LIMITS.maxCellReferences,
      );
    expect(zigzagPixel[3]).toBeGreaterThan(0);

    const overSegmentSamples = Array.from({
      length: STUDIO_HOKUSAI_LOCAL_DIRECTION_INDEX_LIMITS.maxSegments + 2,
    }, (_, index) => ({
      x: index % WIDTH,
      y: index % HEIGHT,
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      timeMilliseconds: index,
    }));
    const overSegmentPixel = new Uint8Array([112, 88, 72, 220]);
    const overSegmentMetrics = applyStudioHokusaiNaturalMediaTextureV2(
      overSegmentPixel,
      { ...base, samples: overSegmentSamples },
      {
        frameBounds: [0, 0, 1, 1],
        dirtyBounds: [0, 0, 1, 1],
      },
    );
    expect(overSegmentMetrics).toMatchObject({
      directionIndexMode: "global-budget-fallback",
      directionIndexSegments: 0,
      directionIndexCellReferences: 0,
    });
    expect(overSegmentPixel[3]).toBeGreaterThan(0);
  });

  it("does not alter transparent pixels, pixels outside dirty bounds or flat media", () => {
    const flat = ribbon(220);
    const before = flat.slice();
    const metrics = applyStudioHokusaiNaturalMediaTextureV2(
      flat,
      plan("calligraphy"),
      fullLayout(),
    );
    expect(flat).toEqual(before);
    expect(metrics).toMatchObject({
      presetId: "calligraphy",
      alphaChangedPixels: 0,
      colorChangedPixels: 0,
    });

    const pencil = ribbon(220);
    const outsideIndex = (2 * WIDTH + 2) * 4;
    pencil[outsideIndex] = 100;
    pencil[outsideIndex + 1] = 80;
    pencil[outsideIndex + 2] = 60;
    pencil[outsideIndex + 3] = 200;
    applyStudioHokusaiNaturalMediaTextureV2(
      pencil,
      plan("pencil"),
      fullLayout(),
    );
    expect(Array.from(pencil.slice(outsideIndex, outsideIndex + 4)))
      .toEqual([100, 80, 60, 200]);
  });
});
