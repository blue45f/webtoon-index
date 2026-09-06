// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  extractStudioReferencePalette,
  isStudioReferenceLocalRasterDataUrl,
  loadStudioReferenceImageRaster,
  mapStudioReferenceBoardPointToSourcePixel,
  sampleStudioReferenceColorAtBoardPoint,
  sampleStudioReferenceRasterPixel,
  studioReferenceItemFramePercent,
  studioReferenceRgbaToHex,
  type StudioReferenceColorSampleGeometry,
  type StudioReferenceImageRaster,
} from "./studio-reference-color-sampler";

const BASE_GEOMETRY: StudioReferenceColorSampleGeometry = {
  boardWidth: 400,
  boardHeight: 300,
  centerX: 0.5,
  centerY: 0.5,
  frameWidth: 200,
  frameHeight: 200,
  sourceWidth: 400,
  sourceHeight: 200,
  zoom: 1,
  rotationDeg: 0,
  flipX: false,
  flipY: false,
};

function raster(width: number, height: number, pixels: readonly number[]): StudioReferenceImageRaster {
  return { width, height, data: Uint8ClampedArray.from(pixels) };
}

function mockCanvas2dContext(context: CanvasRenderingContext2D | null) {
  return vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((
    ((contextId: string) => contextId === "2d" ? context : null) as
      typeof HTMLCanvasElement.prototype.getContext
  ));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("reference color sample geometry", () => {
  it("matches the panel's 54% intrinsic-aspect frame", () => {
    expect(studioReferenceItemFramePercent(400, 200)).toEqual({ width: 54, height: 27 });
    expect(studioReferenceItemFramePercent(200, 400)).toEqual({ width: 27, height: 54 });
    expect(studioReferenceItemFramePercent(0, Number.NaN)).toEqual({ width: 54, height: 54 });
    expect(studioReferenceItemFramePercent(400, 200, -1)).toEqual({ width: 54, height: 27 });
  });

  it("maps board coordinates through a centered object-contain rectangle", () => {
    expect(mapStudioReferenceBoardPointToSourcePixel({ x: 200, y: 150 }, BASE_GEOMETRY))
      .toEqual({ x: 200, y: 100 });
    expect(mapStudioReferenceBoardPointToSourcePixel({ x: 250, y: 150 }, BASE_GEOMETRY))
      .toEqual({ x: 300, y: 100 });

    // A 2:1 source inside the square frame occupies y=100…200. This point is in letterbox space.
    expect(mapStudioReferenceBoardPointToSourcePixel({ x: 200, y: 80 }, BASE_GEOMETRY)).toBeNull();
    expect(mapStudioReferenceBoardPointToSourcePixel({ x: 300, y: 150 }, BASE_GEOMETRY)).toBeNull();
  });

  it("inverts zoom, rotation, and horizontal/vertical flips in CSS transform order", () => {
    const transformed: StudioReferenceColorSampleGeometry = {
      ...BASE_GEOMETRY,
      frameHeight: 100,
      zoom: 2,
      rotationDeg: 90,
    };
    // Source-right is displayed board-down after a 90 degree rotation.
    expect(mapStudioReferenceBoardPointToSourcePixel({ x: 200, y: 250 }, transformed))
      .toEqual({ x: 300, y: 100 });
    expect(mapStudioReferenceBoardPointToSourcePixel(
      { x: 200, y: 250 },
      { ...transformed, flipX: true }
    )).toEqual({ x: 100, y: 100 });

    expect(mapStudioReferenceBoardPointToSourcePixel(
      { x: 200, y: 125 },
      { ...BASE_GEOMETRY, frameHeight: 100, flipY: true }
    )).toEqual({ x: 200, y: 150 });
  });

  it("uses normalized item centers and rejects non-finite or degenerate geometry", () => {
    expect(mapStudioReferenceBoardPointToSourcePixel(
      { x: 100, y: 225 },
      { ...BASE_GEOMETRY, centerX: 0.25, centerY: 0.75 }
    )).toEqual({ x: 200, y: 100 });
    expect(mapStudioReferenceBoardPointToSourcePixel(
      { x: Number.NaN, y: 150 },
      BASE_GEOMETRY
    )).toBeNull();
    expect(mapStudioReferenceBoardPointToSourcePixel(
      { x: 200, y: 150 },
      { ...BASE_GEOMETRY, zoom: 0 }
    )).toBeNull();
    expect(mapStudioReferenceBoardPointToSourcePixel(
      { x: 200, y: 150 },
      { ...BASE_GEOMETRY, sourceWidth: 1.5 }
    )).toBeNull();
  });
});

describe("reference RGBA sampling and palettes", () => {
  const colors = raster(2, 2, [
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 0,
    250, 10, 5, 128,
  ]);

  it("converts bounded RGBA values and rejects fully transparent pixels", () => {
    expect(studioReferenceRgbaToHex(255, 16, 0, 255)).toBe("#ff1000");
    expect(studioReferenceRgbaToHex(-10, 280, 15.6, 1)).toBe("#00ff10");
    expect(studioReferenceRgbaToHex(255, 255, 255, 0)).toBeNull();
    expect(studioReferenceRgbaToHex(255, 255, 255, Number.NaN)).toBeNull();
  });

  it("reads only in-range complete raster pixels", () => {
    expect(sampleStudioReferenceRasterPixel(colors, { x: 1, y: 0 })).toBe("#00ff00");
    expect(sampleStudioReferenceRasterPixel(colors, { x: 0, y: 1 })).toBeNull();
    expect(sampleStudioReferenceRasterPixel(colors, { x: 2, y: 0 })).toBeNull();
    expect(sampleStudioReferenceRasterPixel(raster(2, 2, [255, 0, 0, 255]), { x: 0, y: 0 }))
      .toBeNull();
  });

  it("maps and samples with the raster dimensions as the source authority", () => {
    expect(sampleStudioReferenceColorAtBoardPoint(colors, { x: 200, y: 150 }, {
      boardWidth: 400,
      boardHeight: 300,
      centerX: 0.5,
      centerY: 0.5,
      frameWidth: 200,
      frameHeight: 200,
      zoom: 1,
      rotationDeg: 0,
      flipX: false,
      flipY: false,
    })).toBe("#fa0a05");
  });

  it("extracts a bounded deterministic palette and skips transparent pixels", () => {
    const paletteRaster = raster(4, 1, [
      250, 5, 5, 255,
      252, 2, 2, 255,
      5, 250, 5, 255,
      5, 5, 250, 0,
    ]);
    expect(extractStudioReferencePalette(paletteRaster)).toEqual(["#ff0000", "#00ff00"]);
    expect(extractStudioReferencePalette(paletteRaster, { count: 1 })).toEqual(["#ff0000"]);
    expect(extractStudioReferencePalette(raster(1, 1, [1, 2, 3, 0]))).toEqual([]);
    expect(extractStudioReferencePalette(raster(2, 2, [1, 2, 3, 255]))).toEqual([]);
  });
});

describe("reference local raster decoder", () => {
  it("accepts only local supported raster data URLs", async () => {
    expect(isStudioReferenceLocalRasterDataUrl("data:image/png;base64,AA==")).toBe(true);
    expect(isStudioReferenceLocalRasterDataUrl("DATA:IMAGE/WEBP;BASE64,AA==")).toBe(true);
    expect(isStudioReferenceLocalRasterDataUrl("data:image/svg+xml;base64,AA==")).toBe(false);
    expect(isStudioReferenceLocalRasterDataUrl("https://example.com/pose.png")).toBe(false);
    await expect(loadStudioReferenceImageRaster("https://example.com/pose.png"))
      .rejects.toThrow(/로컬 PNG/);
  });

  it("decodes one local image into copied RGBA bytes and releases the canvas backing store", async () => {
    const images: Array<{
      decoding: string;
      height: number;
      naturalHeight: number;
      naturalWidth: number;
      onerror: (() => void) | null;
      onload: (() => void) | null;
      src: string;
      width: number;
    }> = [];
    class ImageMock {
      decoding = "auto";
      height = 1;
      naturalHeight = 1;
      naturalWidth = 2;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      src = "";
      width = 2;
      constructor() {
        images.push(this);
      }
    }
    vi.stubGlobal("Image", ImageMock);
    const drawImage = vi.fn();
    const getImageData = vi.fn(() => ({
      data: Uint8ClampedArray.from([255, 0, 0, 255, 0, 255, 0, 255]),
    }));
    mockCanvas2dContext({
      drawImage,
      getImageData,
    } as unknown as CanvasRenderingContext2D);

    const pending = loadStudioReferenceImageRaster("data:image/png;base64,AA==");
    expect(images).toHaveLength(1);
    images[0]?.onload?.();

    await expect(pending).resolves.toEqual({
      width: 2,
      height: 1,
      data: Uint8ClampedArray.from([255, 0, 0, 255, 0, 255, 0, 255]),
    });
    expect(drawImage).toHaveBeenCalledOnce();
    expect(getImageData).toHaveBeenCalledWith(0, 0, 2, 1);
  });

  it("rejects a pre-aborted decode and unsafe decoded pixel dimensions", async () => {
    const images: Array<{
      height: number;
      naturalHeight: number;
      naturalWidth: number;
      onerror: (() => void) | null;
      onload: (() => void) | null;
      src: string;
      width: number;
    }> = [];
    class ImageMock {
      decoding = "auto";
      height = 5_000;
      naturalHeight = 5_000;
      naturalWidth = 5_000;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      src = "";
      width = 5_000;
      constructor() {
        images.push(this);
      }
    }
    vi.stubGlobal("Image", ImageMock);

    const controller = new AbortController();
    controller.abort();
    await expect(loadStudioReferenceImageRaster("data:image/png;base64,AA==", {
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });

    const oversized = loadStudioReferenceImageRaster("data:image/png;base64,AA==");
    images.at(-1)?.onload?.();
    await expect(oversized).rejects.toThrow(/안전 한도/);
  });
});
