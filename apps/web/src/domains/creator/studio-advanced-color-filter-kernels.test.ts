import { describe, expect, it } from "vitest";

import {
  applyStudioAdvancedColorFilter,
  applyStudioColorLookup,
  applyStudioPaletteNormalization,
  applyStudioReferenceImageColorMatch,
  applyStudioSelectiveColorBands,
  type StudioAdvancedColorApplied,
  type StudioAdvancedColorRgb,
  type StudioAdvancedColorRgbaImage,
  type StudioAdvancedColorWorkBudget,
  type StudioColorLookupCube,
} from "./studio-advanced-color-filter-kernels";
import { parseStudioCubeLut, applyStudio3dCubeLut } from "./studio-advanced-color-filter-kernels";

function image(
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number, number],
): StudioAdvancedColorRgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data.set(pixel(x, y), (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

function cube(
  size: number,
  transform: (red: number, green: number, blue: number) => StudioAdvancedColorRgb,
): StudioColorLookupCube {
  const data = new Uint8ClampedArray(size ** 3 * 3);
  const maximum = size - 1;
  for (let blue = 0; blue < size; blue += 1) {
    for (let green = 0; green < size; green += 1) {
      for (let red = 0; red < size; red += 1) {
        const offset = ((blue * size + green) * size + red) * 3;
        data.set(transform(
          red / maximum * 255,
          green / maximum * 255,
          blue / maximum * 255,
        ), offset);
      }
    }
  }
  return { size, data };
}

function applied(
  result: ReturnType<typeof applyStudioAdvancedColorFilter>,
): StudioAdvancedColorApplied {
  expect(result.status).toBe("applied");
  if (result.status !== "applied") throw new Error(result.detail);
  return result;
}

function rgbAt(source: StudioAdvancedColorRgbaImage, x: number, y: number): number[] {
  const offset = (y * source.width + x) * 4;
  return Array.from(source.data.slice(offset, offset + 3));
}

function alphaBytes(source: StudioAdvancedColorRgbaImage): number[] {
  const output = [];
  for (let offset = 3; offset < source.data.length; offset += 4) {
    output.push(source.data[offset]!);
  }
  return output;
}

describe("advanced color validation and budgets", () => {
  it("rejects malformed sources and invalid bounded auxiliaries", () => {
    const source = image(3, 2, () => [50, 60, 70, 255]);
    expect(applyStudioAdvancedColorFilter({
      kernel: "3d-lut-color-lookup",
      source: { width: 3, height: 2, data: new Uint8ClampedArray(4) },
      cube: cube(2, (red, green, blue) => [red, green, blue]),
    })).toMatchObject({
      status: "refused",
      reason: "invalid-source",
      allocationPerformed: false,
    });
    expect(applyStudioAdvancedColorFilter({
      kernel: "3d-lut-color-lookup",
      source,
      cube: { size: 2, data: new Uint8ClampedArray(23) },
    })).toMatchObject({
      status: "refused",
      reason: "invalid-auxiliary",
    });
    expect(applyStudioAdvancedColorFilter({
      kernel: "selective-color-bands",
      source,
      bands: [],
    })).toMatchObject({
      status: "refused",
      reason: "invalid-auxiliary",
    });
    expect(applyStudioAdvancedColorFilter({
      kernel: "palette-normalization",
      source,
      palette: [[0, 0, 999]],
    } as Parameters<typeof applyStudioAdvancedColorFilter>[0])).toMatchObject({
      status: "refused",
      reason: "invalid-auxiliary",
    });
  });

  it("refuses work/memory overflow before allocating an output", () => {
    const source = image(4, 4, () => [80, 90, 100, 255]);
    const before = Array.from(source.data);
    const budget = {
      maxPixels: 16,
      maxAuxiliaryEntries: 8,
      maxWorkUnits: 127,
      maxWorkingBytes: 64,
    } satisfies StudioAdvancedColorWorkBudget;
    expect(applyStudioColorLookup({
      source,
      cube: cube(2, (red, green, blue) => [red, green, blue]),
    }, budget)).toMatchObject({
      status: "refused",
      reason: "budget-exceeded",
      allocationPerformed: false,
      work: {
        pixels: 16,
        auxiliaryEntries: 8,
        workUnits: 128,
        workingBytes: 64,
      },
    });
    expect(Array.from(source.data)).toEqual(before);
  });
});

describe("3D LUT trilinear color lookup", () => {
  it("interpolates all eight cube corners and supports partial strength", () => {
    const source = image(2, 1, (x) => x === 0
      ? [128, 64, 192, 33]
      : [30, 170, 90, 210]);
    const invertRed = cube(2, (red, green, blue) => [255 - red, green, blue]);
    const full = applied(applyStudioColorLookup({ source, cube: invertRed }));
    expect(rgbAt(full.image, 0, 0)).toEqual([127, 64, 192]);
    expect(rgbAt(full.image, 1, 0)).toEqual([225, 170, 90]);

    const half = applied(applyStudioColorLookup({
      source,
      cube: invertRed,
      options: { strength: 0.5 },
    }));
    expect(rgbAt(half.image, 1, 0)[0]).toBe(127);
    expect(alphaBytes(full.image)).toEqual(alphaBytes(source));
  });
});

describe("selective color bands", () => {
  it("adjusts only pixels inside the requested circular hue and luma band", () => {
    const source = image(3, 1, (x) => {
      if (x === 0) return [220, 30, 30, 41];
      if (x === 1) return [80, 5, 5, 120];
      return [30, 40, 220, 240];
    });
    const result = applied(applyStudioSelectiveColorBands({
      source,
      bands: [{
        hueCenterDegrees: 0,
        hueHalfWidthDegrees: 24,
        hueFeatherDegrees: 8,
        lumaMinimum: 0.3,
        lumaMaximum: 0.7,
        lumaFeather: 0,
        hueShiftDegrees: 110,
        saturationScale: 0.8,
        lightnessDelta: 0.05,
      }],
    }));
    expect(rgbAt(result.image, 0, 0)).not.toEqual(rgbAt(source, 0, 0));
    expect(rgbAt(result.image, 1, 0)).toEqual(rgbAt(source, 1, 0));
    expect(rgbAt(result.image, 2, 0)).toEqual(rgbAt(source, 2, 0));
  });
});

describe("reference-image channel-statistics color match", () => {
  it("moves source channel statistics toward the reference without ML or alpha changes", () => {
    const source = image(4, 2, (x, y) => [
      30 + x * 15 + y * 4,
      60 + x * 8,
      90 + y * 12,
      20 + x * 40 + y,
    ]);
    const reference = image(3, 3, (x, y) => [
      150 + x * 20,
      120 + y * 15,
      70 + x * 5 + y * 8,
      80 + x * 30 + y * 4,
    ]);
    const sourceBefore = Array.from(source.data);
    const referenceBefore = Array.from(reference.data);
    const result = applied(applyStudioReferenceImageColorMatch({
      source,
      reference,
      options: { strength: 1, clipSigma: 3, minimumStandardDeviation: 1 },
    }));
    expect(rgbAt(result.image, 2, 1)[0]).toBeGreaterThan(rgbAt(source, 2, 1)[0]!);
    expect(rgbAt(result.image, 2, 1)).not.toEqual(rgbAt(source, 2, 1));
    expect(alphaBytes(result.image)).toEqual(alphaBytes(source));
    expect(Array.from(source.data)).toEqual(sourceBefore);
    expect(Array.from(reference.data)).toEqual(referenceBefore);
    expect(result.transaction.auxiliaryFingerprint).toMatch(/^[0-9a-f]{8}$/);
  });

  it("refuses a fully transparent reference before allocating output", () => {
    const source = image(2, 2, () => [40, 50, 60, 255]);
    const reference = image(2, 2, () => [200, 180, 160, 0]);
    expect(applyStudioReferenceImageColorMatch({ source, reference })).toMatchObject({
      status: "refused",
      reason: "empty-reference",
      allocationPerformed: false,
    });
  });
});

describe("palette normalization with line-art protection", () => {
  it("quantizes flat colors while keeping dark ink and high-contrast edges intact", () => {
    const source = image(7, 5, (x, y) => {
      if (x === 3) return [8, 8, 8, 40 + y * 40];
      if (x < 3) return [178 + x * 3, 128 + y * 2, 82, 100 + x * 20 + y];
      return [70, 164 + y * 2, 194 + x, 150 + y * 10];
    });
    const result = applied(applyStudioPaletteNormalization({
      source,
      palette: [
        [180, 120, 80],
        [70, 170, 200],
        [5, 5, 5],
      ],
      options: {
        strength: 1,
        lineLumaThreshold: 40,
        edgeContrastThreshold: 70,
        edgeProtection: 1,
      },
    }));
    expect(rgbAt(result.image, 3, 2)).toEqual(rgbAt(source, 3, 2));
    expect(rgbAt(result.image, 1, 2)).toEqual([180, 120, 80]);
    expect(rgbAt(result.image, 5, 2)).toEqual([70, 170, 200]);
    expect(alphaBytes(result.image)).toEqual(alphaBytes(source));
  });
});

describe("determinism, receipts, alpha, and material distinction", () => {
  it("returns identical pixels and receipts for identical requests", () => {
    const source = image(6, 5, (x, y) => [
      (x * 43 + y * 17) % 256,
      (x * 79 + y * 31) % 256,
      (x * 19 + y * 101) % 256,
      50 + ((x * 11 + y * 29) % 206),
    ]);
    const request = {
      source,
      bands: [{
        hueCenterDegrees: 350,
        hueHalfWidthDegrees: 55,
        hueFeatherDegrees: 20,
        lumaMinimum: 0.1,
        lumaMaximum: 0.9,
        lumaFeather: 0.1,
        hueShiftDegrees: 35,
        saturationScale: 1.2,
        lightnessDelta: -0.04,
      }],
    };
    const first = applied(applyStudioSelectiveColorBands(request));
    const second = applied(applyStudioSelectiveColorBands(request));
    expect(first.image.data).toEqual(second.image.data);
    expect(first.transaction).toEqual(second.transaction);
    expect(first.transaction.schema).toBe("toonspectrum.advanced-color-filter/v1");
    expect(first.transaction.operationId).toMatch(/^advanced-color-v1-[0-9a-f]{8}$/);
  });

  it("produces four materially distinct outputs while preserving source alpha", () => {
    const source = image(9, 7, (x, y) => [
      (x * 47 + y * 23) % 256,
      (x * 13 + y * 89) % 256,
      (x * 103 + y * 7) % 256,
      30 + ((x * 31 + y * 19) % 226),
    ]);
    const reference = image(5, 4, (x, y) => [
      130 + x * 20,
      90 + y * 25,
      60 + x * 7 + y * 11,
      100 + x * 20 + y,
    ]);
    const results = [
      applied(applyStudioColorLookup({
        source,
        cube: cube(2, (red, green, blue) => [255 - red, blue, green]),
      })),
      applied(applyStudioSelectiveColorBands({
        source,
        bands: [{
          hueCenterDegrees: 90,
          hueHalfWidthDegrees: 80,
          hueFeatherDegrees: 30,
          lumaMinimum: 0,
          lumaMaximum: 1,
          lumaFeather: 0,
          hueShiftDegrees: 70,
          saturationScale: 0.7,
          lightnessDelta: 0.08,
        }],
      })),
      applied(applyStudioReferenceImageColorMatch({ source, reference })),
      applied(applyStudioPaletteNormalization({
        source,
        palette: [[20, 30, 40], [120, 140, 160], [230, 210, 190]],
        options: {
          strength: 0.8,
          lineLumaThreshold: 15,
          edgeContrastThreshold: 255,
          edgeProtection: 0,
        },
      })),
    ];
    expect(new Set(results.map((result) => result.transaction.operationId)).size).toBe(4);
    expect(new Set(results.map((result) => result.transaction.outputFingerprint)).size).toBe(4);
    expect(results.every((result) => result.transaction.changedPixelCount > 0)).toBe(true);
    for (const result of results) {
      expect(alphaBytes(result.image)).toEqual(alphaBytes(source));
      expect(result.alphaSemantics).toBe("preserve-source-alpha");
    }
  });
});

describe("Adobe .CUBE 3D LUT parser", () => {
  it("parses valid 3D LUT files with comments and metadata", () => {
    const lutText = `
# Comment line
TITLE "Test LUT"
DOMAIN_MIN 0.0 0.0 0.0
DOMAIN_MAX 1.0 1.0 1.0
LUT_3D_SIZE 2
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
    `;
    const parsed = parseStudioCubeLut(lutText);
    expect(parsed).not.toBeNull();
    expect(parsed?.size).toBe(2);
    expect(parsed?.title).toBe("Test LUT");
    expect(parsed?.domainMin).toEqual([0, 0, 0]);
    expect(parsed?.domainMax).toEqual([1, 1, 1]);
    expect(parsed?.data.length).toBe(24);
    expect(parsed?.data[0]).toBe(0);
    expect(parsed?.data[21]).toBe(1);
  });

  it("handles 1D LUT size when 3D is not present", () => {
    const lutText = `
LUT_1D_SIZE 2
0 0 0
1 1 1
    `;
    const parsed = parseStudioCubeLut(lutText);
    expect(parsed).not.toBeNull();
    expect(parsed?.size).toBe(2);
    expect(parsed?.data.length).toBe(6);
  });

  it("gracefully handles out-of-range floats and negatives", () => {
    const lutText = `
LUT_3D_SIZE 2
DOMAIN_MIN -0.5 -0.5 -0.5
DOMAIN_MAX 1.5 1.5 1.5
-0.1 0 0
1.1 0 0
0 1.1 0
1 1 0
0 0 1.1
1 0 1
0 1 1
1 1 1
    `;
    const parsed = parseStudioCubeLut(lutText);
    expect(parsed).not.toBeNull();
    expect(parsed?.domainMin).toEqual([-0.5, -0.5, -0.5]);
    expect(parsed?.domainMax).toEqual([1.5, 1.5, 1.5]);
    expect(parsed?.data[0]).toBeCloseTo(-0.1, 5);
  });

  it("returns null for corrupt or empty files", () => {
    expect(parseStudioCubeLut("JUST SOME JUNK")).toBeNull();
    expect(parseStudioCubeLut("LUT_3D_SIZE 0")).toBeNull();
  });
});

describe("applyStudio3dCubeLut", () => {
  it("applies trilinear interpolation correctly", () => {
    const lutText = `
LUT_3D_SIZE 2
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
    `;
    const parsed = parseStudioCubeLut(lutText)!;
    // Identity LUT, so output should match input exactly
    
    // image function from the test file
    const src = new Uint8ClampedArray([128, 64, 192, 255]);
    const source = { width: 1, height: 1, data: src };
    applyStudio3dCubeLut(source, parsed);
    
    expect(source.data[0]).toBe(128);
    expect(source.data[1]).toBe(64);
    expect(source.data[2]).toBe(192);
    expect(source.data[3]).toBe(255); // preserve alpha
  });
  
  it("supports blendAmount and clamps bounds", () => {
    const lutText = `
LUT_3D_SIZE 2
0 0 0
0 0 0
0 0 0
0 0 0
0 0 0
0 0 0
0 0 0
0 0 0
    `; // all black
    const parsed = parseStudioCubeLut(lutText)!;
    
    const src = new Uint8ClampedArray([100, 100, 100, 255]);
    const source = { width: 1, height: 1, data: src };
    
    // With blend 0.5, it should be 50, 50, 50
    applyStudio3dCubeLut(source, parsed, 0.5);
    expect(source.data[0]).toBe(50);
    expect(source.data[1]).toBe(50);
    expect(source.data[2]).toBe(50);
  });
});
