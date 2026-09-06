import { describe, expect, it } from "vitest";

import {
  applyStudioArtHistoryRestoreBrush,
  applyStudioBlurBrush,
  applyStudioColorReplacementBrush,
  applyStudioEditingBrushKernel,
  applyStudioSharpenBrush,
  type StudioEditingBrushApplied,
  type StudioEditingBrushMask,
  type StudioEditingBrushRgbaImage,
  type StudioEditingBrushWorkBudget,
} from "./studio-editing-brush-kernels";

function image(
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number, number],
): StudioEditingBrushRgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data.set(pixel(x, y), (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

function mask(
  width: number,
  height: number,
  coverage: (x: number, y: number) => number,
): StudioEditingBrushMask {
  const data = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data[y * width + x] = coverage(x, y);
    }
  }
  return { width, height, data };
}

function applied(
  result: ReturnType<typeof applyStudioEditingBrushKernel>,
): StudioEditingBrushApplied {
  expect(result.status).toBe("applied");
  if (result.status !== "applied") throw new Error(result.detail);
  return result;
}

function rgbAt(source: StudioEditingBrushRgbaImage, x: number, y: number): number[] {
  const offset = (y * source.width + x) * 4;
  return Array.from(source.data.slice(offset, offset + 3));
}

function alphaBytes(source: StudioEditingBrushRgbaImage): number[] {
  const values = [];
  for (let offset = 3; offset < source.data.length; offset += 4) {
    values.push(source.data[offset]!);
  }
  return values;
}

describe("editing brush validation and bounded execution", () => {
  it("fails closed on invalid source and brush/selection extents", () => {
    const validSource = image(3, 2, () => [40, 50, 60, 255]);
    const validMask = mask(3, 2, () => 255);

    expect(applyStudioEditingBrushKernel({
      kernel: "blur-brush",
      source: { width: 3, height: 2, data: new Uint8ClampedArray(4) },
      brushMask: validMask,
    })).toMatchObject({
      status: "refused",
      reason: "invalid-source",
      allocationPerformed: false,
    });

    expect(applyStudioEditingBrushKernel({
      kernel: "blur-brush",
      source: validSource,
      brushMask: { width: 3, height: 2, data: new Uint8ClampedArray(5) },
    })).toMatchObject({
      status: "refused",
      reason: "invalid-mask",
      allocationPerformed: false,
    });

    expect(applyStudioEditingBrushKernel({
      kernel: "blur-brush",
      source: validSource,
      brushMask: validMask,
      selectionMask: mask(2, 2, () => 255),
    })).toMatchObject({
      status: "refused",
      reason: "invalid-selection-mask",
      allocationPerformed: false,
    });
  });

  it("rejects invalid parameters and a mismatched immutable history snapshot", () => {
    const source = image(3, 3, () => [40, 50, 60, 255]);
    const brushMask = mask(3, 3, () => 255);
    expect(applyStudioEditingBrushKernel({
      kernel: "sharpen-brush",
      source,
      brushMask,
      pressure: Number.NaN,
    })).toMatchObject({
      status: "refused",
      reason: "invalid-parameters",
    });
    expect(applyStudioEditingBrushKernel({
      kernel: "color-replacement-brush",
      source,
      brushMask,
      options: {
        target: [1, 2, 999],
        replacement: [1, 2, 3],
      },
    } as Parameters<typeof applyStudioEditingBrushKernel>[0])).toMatchObject({
      status: "refused",
      reason: "invalid-parameters",
    });
    expect(applyStudioEditingBrushKernel({
      kernel: "art-history-restore-brush",
      source,
      brushMask,
      snapshot: {
        id: "revision-1",
        image: image(2, 3, () => [0, 0, 0, 255]),
      },
    })).toMatchObject({
      status: "refused",
      reason: "invalid-snapshot",
    });
  });

  it("refuses invalid and exceeded budgets before output allocation", () => {
    const source = image(8, 8, () => [70, 80, 90, 255]);
    const brushMask = mask(8, 8, () => 255);
    const before = Array.from(source.data);
    const invalidBudget = {
      maxPixels: 0,
      maxNeighborhoodSamples: 1_000,
      maxWorkingBytes: 1_000,
    } satisfies StudioEditingBrushWorkBudget;
    expect(applyStudioBlurBrush({ source, brushMask }, invalidBudget)).toMatchObject({
      status: "refused",
      reason: "invalid-budget",
      allocationPerformed: false,
    });

    const tinySampleBudget = {
      maxPixels: 64,
      maxNeighborhoodSamples: 1_599,
      maxWorkingBytes: 256,
    } satisfies StudioEditingBrushWorkBudget;
    expect(applyStudioBlurBrush({
      source,
      brushMask,
      options: { radius: 2 },
    }, tinySampleBudget)).toMatchObject({
      status: "refused",
      reason: "budget-exceeded",
      allocationPerformed: false,
      work: {
        pixels: 64,
        neighborhoodSamples: 1_600,
        workingBytes: 256,
      },
    });
    expect(Array.from(source.data)).toEqual(before);
  });
});

describe("blur and sharpen editing brushes", () => {
  it("uses clamped edge sampling and alpha-weighted neighbors without changing alpha", () => {
    const source = image(3, 3, (x, y) => {
      if (x === 0 && y === 0) return [255, 0, 0, 255];
      if (x === 1 && y === 0) return [0, 255, 0, 0];
      return [0, 0, 255, 96 + x * 20 + y * 7];
    });
    const result = applied(applyStudioEditingBrushKernel({
      kernel: "blur-brush",
      source,
      brushMask: mask(3, 3, (x, y) => x === 0 && y === 0 ? 255 : 0),
      options: { radius: 1 },
    }));
    const corner = rgbAt(result.image, 0, 0);
    expect(corner[0]).toBeLessThan(255);
    expect(corner[2]).toBeGreaterThan(0);
    expect(corner[1]).toBe(0);
    expect(alphaBytes(result.image)).toEqual(alphaBytes(source));
    expect(result.transaction.changedBounds).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it("makes blur and sharpen materially distinct on the same high-frequency source", () => {
    const source = image(5, 5, (x, y) => {
      const value = x === 2 && y === 2 ? 190 : 80;
      return [value, value, value, 40 + x * 17 + y * 5];
    });
    const brushMask = mask(5, 5, () => 255);
    const blur = applied(applyStudioEditingBrushKernel({
      kernel: "blur-brush",
      source,
      brushMask,
      options: { radius: 1 },
    }));
    const sharpen = applied(applyStudioEditingBrushKernel({
      kernel: "sharpen-brush",
      source,
      brushMask,
      options: { radius: 1, amount: 1.5 },
    }));
    expect(rgbAt(blur.image, 2, 2)[0]).toBeLessThan(190);
    expect(rgbAt(sharpen.image, 2, 2)[0]).toBeGreaterThan(190);
    expect(Array.from(blur.image.data)).not.toEqual(Array.from(sharpen.image.data));
    expect(alphaBytes(blur.image)).toEqual(alphaBytes(source));
    expect(alphaBytes(sharpen.image)).toEqual(alphaBytes(source));
  });
});

describe("mask, selection, pressure, and flow", () => {
  it("multiplies all coverage axes and leaves pixels outside selection bit-identical", () => {
    const source = image(4, 1, (x) => [40 + x * 30, 20, 10, 50 + x * 40]);
    const snapshot = image(4, 1, () => [240, 220, 200, 255]);
    const full = applied(applyStudioArtHistoryRestoreBrush({
      source,
      brushMask: mask(4, 1, () => 255),
      selectionMask: mask(4, 1, (x) => x === 1 ? 128 : x === 2 ? 255 : 0),
      pressure: 0.5,
      flow: 0.5,
      snapshot: { id: "immutable-A", image: snapshot },
    }));

    expect(rgbAt(full.image, 0, 0)).toEqual(rgbAt(source, 0, 0));
    expect(rgbAt(full.image, 3, 0)).toEqual(rgbAt(source, 3, 0));
    expect(rgbAt(full.image, 1, 0)[0]).toBe(91);
    expect(rgbAt(full.image, 2, 0)[0]).toBe(135);
    expect(full.transaction.maskedPixelCount).toBe(2);
    expect(full.transaction.changedBounds).toEqual({ x: 1, y: 0, width: 2, height: 1 });
    expect(alphaBytes(full.image)).toEqual(alphaBytes(source));
  });

  it("makes zero pressure or zero flow a deterministic no-op", () => {
    const source = image(2, 2, (x, y) => [x * 100, y * 100, 80, 150]);
    const brushMask = mask(2, 2, () => 255);
    const zeroPressure = applied(applyStudioBlurBrush({
      source,
      brushMask,
      pressure: 0,
    }));
    const zeroFlow = applied(applyStudioSharpenBrush({
      source,
      brushMask,
      flow: 0,
    }));
    expect(Array.from(zeroPressure.image.data)).toEqual(Array.from(source.data));
    expect(Array.from(zeroFlow.image.data)).toEqual(Array.from(source.data));
    expect(zeroPressure.transaction.changedPixelCount).toBe(0);
    expect(zeroFlow.transaction.changedPixelCount).toBe(0);
  });
});

describe("color replacement and history restore", () => {
  it("replaces only colors within tolerance and can preserve source shading", () => {
    const source = image(3, 1, (x) => {
      if (x === 0) return [200, 30, 30, 31];
      if (x === 1) return [110, 20, 20, 127];
      return [30, 200, 30, 240];
    });
    const result = applied(applyStudioColorReplacementBrush({
      source,
      brushMask: mask(3, 1, () => 255),
      options: {
        target: [200, 30, 30],
        replacement: [25, 45, 220],
        tolerance: 130,
        softness: 0,
        preserveLuminance: true,
      },
    }));
    expect(rgbAt(result.image, 0, 0)[2]).toBeGreaterThan(rgbAt(result.image, 0, 0)[0]!);
    expect(rgbAt(result.image, 1, 0)[2]).toBeLessThan(rgbAt(result.image, 0, 0)[2]!);
    expect(rgbAt(result.image, 2, 0)).toEqual(rgbAt(source, 2, 0));
    expect(alphaBytes(result.image)).toEqual(alphaBytes(source));
  });

  it("restores RGB from an immutable snapshot while preserving current alpha and both inputs", () => {
    const source = image(2, 2, (x, y) => [10 + x, 20 + y, 30, 40 + x * 50 + y]);
    const snapshot = image(2, 2, (x, y) => [200 - x, 180 - y, 160, 255]);
    const sourceBefore = Array.from(source.data);
    const snapshotBefore = Array.from(snapshot.data);
    const result = applied(applyStudioEditingBrushKernel({
      kernel: "art-history-restore-brush",
      source,
      brushMask: mask(2, 2, () => 255),
      snapshot: { id: "history-revision-7", image: snapshot },
    }));
    expect(rgbAt(result.image, 1, 1)).toEqual(rgbAt(snapshot, 1, 1));
    expect(alphaBytes(result.image)).toEqual(alphaBytes(source));
    expect(Array.from(source.data)).toEqual(sourceBefore);
    expect(Array.from(snapshot.data)).toEqual(snapshotBefore);
    expect(result.transaction.snapshotFingerprint).not.toBeNull();
    expect(result.transaction.options).toEqual({
      kernel: "art-history-restore-brush",
      snapshotId: "history-revision-7",
    });
  });
});

describe("deterministic transaction receipts", () => {
  it("returns identical pixels and receipts for identical inputs", () => {
    const source = image(6, 4, (x, y) => [
      (x * 61 + y * 17) % 256,
      (x * 23 + y * 73) % 256,
      (x * 47 + y * 31) % 256,
      50 + ((x * 19 + y * 11) % 205),
    ]);
    const request = {
      kernel: "sharpen-brush" as const,
      source,
      brushMask: mask(6, 4, (x, y) => (x + y) % 2 === 0 ? 255 : 96),
      selectionMask: mask(6, 4, (x) => x < 5 ? 255 : 0),
      pressure: 0.73,
      flow: 0.81,
      options: { radius: 1, amount: 1.25 },
    };
    const first = applied(applyStudioEditingBrushKernel(request));
    const second = applied(applyStudioEditingBrushKernel(request));
    expect(first.image.data).toEqual(second.image.data);
    expect(first.transaction).toEqual(second.transaction);
    expect(first.transaction.schema).toBe("toonspectrum.editing-brush-operation/v1");
    expect(first.transaction.operationId).toMatch(/^editing-v1-[0-9a-f]{8}$/);
    expect(first.transaction.outputFingerprint).toMatch(/^[0-9a-f]{8}$/);
  });

  it("produces four materially distinct operation identities and outputs", () => {
    const source = image(5, 5, (x, y) => [
      30 + x * 35,
      20 + y * 40,
      (x * 53 + y * 29) % 256,
      90 + x * 20 + y,
    ]);
    const brushMask = mask(5, 5, () => 255);
    const snapshot = image(5, 5, (x, y) => [220 - x * 10, 200 - y * 8, 180, 255]);
    const results = [
      applied(applyStudioBlurBrush({ source, brushMask, options: { radius: 1 } })),
      applied(applyStudioSharpenBrush({
        source,
        brushMask,
        options: { radius: 1, amount: 1.4 },
      })),
      applied(applyStudioColorReplacementBrush({
        source,
        brushMask,
        options: {
          target: [100, 100, 100],
          replacement: [20, 210, 230],
          tolerance: 220,
          softness: 0.5,
          preserveLuminance: false,
        },
      })),
      applied(applyStudioArtHistoryRestoreBrush({
        source,
        brushMask,
        snapshot: { id: "history-B", image: snapshot },
      })),
    ];
    expect(new Set(results.map((result) => result.transaction.operationId)).size).toBe(4);
    expect(new Set(results.map((result) => result.transaction.outputFingerprint)).size).toBe(4);
    expect(results.every((result) => result.transaction.changedPixelCount > 0)).toBe(true);
  });
});
