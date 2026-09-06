import { beforeEach, describe, expect, it } from "vitest";

import {
  acquireStudioBrushTextureStampSurface,
  clearStudioBrushTextureStampCache,
  rasterizeStudioBrushTextureMaskRgba,
  rasterizeStudioBrushTextureStampRgba,
  studioBrushTextureStampCacheStats,
  STUDIO_BRUSH_TEXTURE_STAMP_TINT_ENTRY_LIMIT,
  type StudioBrushTextureStampSurface,
  type StudioBrushTextureStampSurfaceContext,
} from "./studio-brush-textured-stamp";
import { buildStudioBrushTipAlphaMap } from "./studio-brush-tip-stamp";

import type { StudioBrushTipAlphaMap } from "./studio-brush-tip-stamp";

class PixelSurfaceContext implements StudioBrushTextureStampSurfaceContext {
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = "source-over";
  fillStyle: string | CanvasGradient | CanvasPattern = "#000000";
  pixels = new Uint8ClampedArray();

  createImageData(width: number, height: number): ImageData {
    return {
      width,
      height,
      colorSpace: "srgb",
      data: new Uint8ClampedArray(width * height * 4),
    } as ImageData;
  }

  putImageData(imageData: ImageData): void {
    this.pixels = new Uint8ClampedArray(imageData.data);
  }

  drawImage(image: CanvasImageSource): void {
    if (this.globalCompositeOperation !== "copy") {
      throw new Error("test surface only supports deterministic copy");
    }
    const source = image as unknown as PixelSurface;
    this.pixels = new Uint8ClampedArray(source.context.pixels);
  }

  fillRect(): void {
    if (
      this.globalCompositeOperation !== "source-in"
      || typeof this.fillStyle !== "string"
    ) {
      throw new Error("test surface only supports exact source-in tint");
    }
    const source = this.fillStyle.slice(1);
    const expanded = source.length <= 4
      ? [...source].map((channel) => `${channel}${channel}`).join("")
      : source;
    const red = Number.parseInt(expanded.slice(0, 2), 16);
    const green = Number.parseInt(expanded.slice(2, 4), 16);
    const blue = Number.parseInt(expanded.slice(4, 6), 16);
    const sourceAlpha = expanded.length === 8
      ? Number.parseInt(expanded.slice(6, 8), 16)
      : 255;
    for (let offset = 0; offset < this.pixels.length; offset += 4) {
      this.pixels[offset] = red;
      this.pixels[offset + 1] = green;
      this.pixels[offset + 2] = blue;
      this.pixels[offset + 3] = Math.round(
        this.pixels[offset + 3]! * sourceAlpha / 255,
      );
    }
  }
}

class PixelSurface {
  readonly context = new PixelSurfaceContext();

  constructor(
    public width: number,
    public height: number,
  ) {}

  getContext(): StudioBrushTextureStampSurfaceContext {
    return this.context;
  }
}

function sparseCornerMap(
  revision: string | number | undefined = "sparse-corners-v1",
): StudioBrushTipAlphaMap {
  const size = 8;
  const alphas = new Float32Array(size * size);
  alphas[0] = 1;
  alphas[size - 1] = 0.75;
  alphas[(size - 1) * size] = 0.5;
  alphas[size * size - 1] = 0.25;
  alphas[3 * size + 3] = 0;
  alphas[4 * size + 4] = 0;
  return {
    size,
    alphas,
    shape: "hard",
    softness: 0,
    custom: true,
    revision,
  };
}

describe("studio full alpha-tip textured stamp", () => {
  beforeEach(() => {
    clearStudioBrushTextureStampCache();
  });

  it("preserves sparse opaque corners and a transparent centre in actual RGBA bytes", () => {
    const pixels = rasterizeStudioBrushTextureStampRgba(
      sparseCornerMap(),
      "#336699",
    );
    expect(pixels).not.toBeNull();
    if (!pixels) throw new Error("expected full RGBA stamp");

    const alphaAt = (x: number, y: number) => pixels[(y * 8 + x) * 4 + 3];
    expect(alphaAt(0, 0)).toBe(255);
    expect(alphaAt(7, 0)).toBe(191);
    expect(alphaAt(0, 7)).toBe(128);
    expect(alphaAt(7, 7)).toBe(64);
    expect(alphaAt(3, 3)).toBe(0);
    expect(alphaAt(4, 4)).toBe(0);
    expect([...pixels.slice(0, 4)]).toEqual([0x33, 0x66, 0x99, 0xff]);
  });

  it("promotes a repeated exact colour while sharing first-seen colour scratch", () => {
    const surfaces: PixelSurface[] = [];
    const factory = (width: number, height: number): StudioBrushTextureStampSurface => {
      const surface = new PixelSurface(width, height);
      surfaces.push(surface);
      return surface as unknown as StudioBrushTextureStampSurface;
    };
    const firstMap = sparseCornerMap("same-content");
    const replayMap = {
      ...sparseCornerMap("same-content"),
      alphas: new Float32Array(firstMap.alphas),
    };

    const first = acquireStudioBrushTextureStampSurface(
      firstMap,
      "#336699",
      factory,
    );
    expect((first as unknown as PixelSurface).context.pixels).toEqual(
      rasterizeStudioBrushTextureStampRgba(firstMap, "#336699"),
    );
    const replay = acquireStudioBrushTextureStampSurface(
      replayMap,
      "#336699",
      factory,
    );
    const cachedReplay = acquireStudioBrushTextureStampSurface(
      replayMap,
      "#336699",
      factory,
    );
    const recolored = acquireStudioBrushTextureStampSurface(
      replayMap,
      "#cc8844",
      factory,
    );

    expect(replay).not.toBe(first);
    expect(cachedReplay).toBe(replay);
    expect(recolored).toBe(first);
    expect(surfaces).toHaveLength(3);
    expect(studioBrushTextureStampCacheStats()).toEqual({
      entries: 2,
      maskEntries: 1,
      tintEntries: 1,
      scratchSurfaces: 1,
      bytes: 8 * 8 * 4 * 3,
      surfaceAllocations: 3,
      maskHits: 2,
      maskMisses: 1,
      tintHits: 1,
      tintPasses: 3,
    });
    expect((recolored as unknown as PixelSurface).context.pixels).toEqual(
      rasterizeStudioBrushTextureStampRgba(firstMap, "#cc8844"),
    );
  });

  it("invalidates the factory index when the cache is cleared", () => {
    const surfaces: PixelSurface[] = [];
    const factory = (width: number, height: number): StudioBrushTextureStampSurface => {
      const surface = new PixelSurface(width, height);
      surfaces.push(surface);
      return surface as unknown as StudioBrushTextureStampSurface;
    };
    const map = sparseCornerMap("clear-recreate");
    const first = acquireStudioBrushTextureStampSurface(map, "#336699", factory);
    if (!first) throw new Error("expected initial stamp surface");

    clearStudioBrushTextureStampCache();
    expect(first).toMatchObject({ width: 1, height: 1 });

    const recreated = acquireStudioBrushTextureStampSurface(
      map,
      "#336699",
      factory,
    );
    expect(recreated).not.toBe(first);
    expect(recreated).toMatchObject({ width: 8, height: 8 });
    expect(surfaces).toHaveLength(4);
    expect(studioBrushTextureStampCacheStats()).toEqual({
      entries: 1,
      maskEntries: 1,
      tintEntries: 0,
      scratchSurfaces: 1,
      bytes: 8 * 8 * 4 * 2,
      surfaceAllocations: 2,
      maskHits: 0,
      maskMisses: 1,
      tintHits: 0,
      tintPasses: 1,
    });
  });

  it("keeps materially different tip edge energy and occupancy in resulting RGBA", () => {
    const bristle = rasterizeStudioBrushTextureStampRgba(
      buildStudioBrushTipAlphaMap({
        shape: "bristle",
        softness: 0.2,
        alphaMapSize: 24,
      }),
      "#336699",
    );
    const halftone = rasterizeStudioBrushTextureStampRgba(
      buildStudioBrushTipAlphaMap({
        shape: "halftone",
        softness: 0.2,
        alphaMapSize: 24,
      }),
      "#336699",
    );
    if (!bristle || !halftone) throw new Error("expected RGBA material stamps");
    const fingerprint = (pixels: Uint8ClampedArray) => {
      let occupied = 0;
      let edgeEnergy = 0;
      const size = 24;
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const alpha = pixels[(y * size + x) * 4 + 3] ?? 0;
          if (alpha > 5) occupied += 1;
          if (x === 0 || y === 0 || x === size - 1 || y === size - 1) {
            edgeEnergy += alpha;
          }
        }
      }
      return { occupied, edgeEnergy };
    };

    expect(fingerprint(bristle)).not.toEqual(fingerprint(halftone));
    expect(fingerprint(bristle).occupied).toBeGreaterThan(0);
    expect(fingerprint(halftone).occupied).toBeGreaterThan(0);
  });

  it("keeps 10k distinct jitter colours at one mask and one tint scratch", () => {
    const surfaces: PixelSurface[] = [];
    const factory = (width: number, height: number): StudioBrushTextureStampSurface => {
      const surface = new PixelSurface(width, height);
      surfaces.push(surface);
      return surface as unknown as StudioBrushTextureStampSurface;
    };
    const map = sparseCornerMap();
    for (let index = 0; index < 10_000; index += 1) {
      const color = `#${(Math.imul(index + 1, 0x45d9f3b) >>> 0)
        .toString(16)
        .slice(-6)
        .padStart(6, "0")}`;
      expect(acquireStudioBrushTextureStampSurface(map, color, factory)).not.toBeNull();
    }

    expect(surfaces).toHaveLength(2);
    expect(studioBrushTextureStampCacheStats()).toMatchObject({
      entries: 1,
      maskEntries: 1,
      tintEntries: 0,
      scratchSurfaces: 1,
      surfaceAllocations: 2,
      tintPasses: 10_000,
    });
  });

  it("bounds promoted exact-colour surfaces with LRU eviction", () => {
    const surfaces: PixelSurface[] = [];
    const factory = (width: number, height: number): StudioBrushTextureStampSurface => {
      const surface = new PixelSurface(width, height);
      surfaces.push(surface);
      return surface as unknown as StudioBrushTextureStampSurface;
    };
    const map = sparseCornerMap();
    for (
      let index = 0;
      index <= STUDIO_BRUSH_TEXTURE_STAMP_TINT_ENTRY_LIMIT;
      index += 1
    ) {
      const color = `#${index.toString(16).padStart(6, "0")}`;
      expect(acquireStudioBrushTextureStampSurface(map, color, factory)).not.toBeNull();
      expect(acquireStudioBrushTextureStampSurface(map, color, factory)).not.toBeNull();
    }

    expect(studioBrushTextureStampCacheStats()).toMatchObject({
      maskEntries: 1,
      tintEntries: STUDIO_BRUSH_TEXTURE_STAMP_TINT_ENTRY_LIMIT,
      scratchSurfaces: 1,
    });
    expect(surfaces).toHaveLength(
      STUDIO_BRUSH_TEXTURE_STAMP_TINT_ENTRY_LIMIT + 3,
    );
    expect(surfaces[2]).toMatchObject({ width: 1, height: 1 });
  });

  it("fails closed for invalid alpha maps and unsupported colours", () => {
    const invalidAlphas = new Float32Array(8 * 8);
    invalidAlphas[17] = Number.NaN;
    const invalidMap = {
      ...sparseCornerMap(),
      alphas: invalidAlphas,
    };
    expect(rasterizeStudioBrushTextureStampRgba(invalidMap, "#336699")).toBeNull();
    expect(rasterizeStudioBrushTextureStampRgba(
      sparseCornerMap(),
      "not-a-canonical-stroke-colour",
    )).toBeNull();
    expect(rasterizeStudioBrushTextureMaskRgba(invalidMap)).toBeNull();
  });
});
