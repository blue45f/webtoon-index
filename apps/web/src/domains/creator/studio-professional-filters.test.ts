import { describe, expect, it } from "vitest";

import {
  applyImageFilters,
  buildImageFilters,
  registerStudioKonvaFilters,
  type KonvaLike,
} from "./render/studio-konva-filters";
import {
  studioAdjustmentOperationToFilterFields,
  type StudioAdjustmentEntry,
} from "./studio-adjustment-stack";
import { applyStudioProfessionalFilter } from "./studio-professional-filter-kernels";
import {
  STUDIO_PROFESSIONAL_FILTER_DIRECT_MAX_WORK_UNITS,
  studioProfessionalFilterRequiresWorker,
} from "./studio-professional-filters";

import type { ImageFilterFields } from "./render/studio-konva-filter-fields";
import type { StudioImageDataLike } from "./studio-filters";

function patternedImage(width = 11, height = 9): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = (x * 29 + y * 7) % 256;
      data[offset + 1] = (x * 13 + y * 43) % 256;
      data[offset + 2] = (x * 31 + y * 19) % 256;
      data[offset + 3] = (x * 23 + y * 17) % 256;
    }
  }
  return { width, height, data };
}

function applyBuilt(
  el: ImageFilterFields,
  source: StudioImageDataLike,
  execution: "direct" | "worker" = "worker",
): StudioImageDataLike {
  const registry: KonvaLike = { Filters: {} };
  registerStudioKonvaFilters(registry);
  const image = {
    width: source.width,
    height: source.height,
    data: new Uint8ClampedArray(source.data),
  };
  const built = buildImageFilters(el, registry, execution);
  applyImageFilters(image, built.filters, built.attrs);
  return image;
}

describe("professional filter product adapters", () => {
  it.each([
    {
      engine: "color-to-alpha" as const,
      field: { colorToAlpha: { keyColor: "#ffffff", strength: 82 } },
      options: { keyColor: "#ffffff", strength: 82 },
    },
    {
      engine: "difference-of-gaussians" as const,
      field: {
        differenceOfGaussians: {
          smallSigma: 0.75,
          largeSigma: 1.8,
          threshold: 1,
          strength: 14,
        },
      },
      options: { smallSigma: 0.75, largeSigma: 1.8, threshold: 1, strength: 14 },
    },
    {
      engine: "dust-scratches" as const,
      field: { dustScratches: { radius: 1, threshold: 14, strength: 0.9 } },
      options: { radius: 1, threshold: 14, strength: 0.9 },
    },
    {
      engine: "tileable-blur" as const,
      field: { tileableBlur: { radius: 3, sigma: 1.4, strength: 0.8 } },
      options: { radius: 3, sigma: 1.4, strength: 0.8 },
    },
  ])("$engine matches the immutable byte oracle in Worker mode", ({ engine, field, options }) => {
    const source = patternedImage();
    const result = applyStudioProfessionalFilter({
      kernel: engine,
      source,
      options,
    } as Parameters<typeof applyStudioProfessionalFilter>[0]);
    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;
    expect(applyBuilt(field, source).data).toEqual(result.image.data);
  });

  it("retains duplicate operations and executes them in authored order", () => {
    const source = patternedImage();
    const operations: StudioAdjustmentEntry[] = [
      {
        id: "tile-a",
        engine: "tileable-blur" as const,
        enabled: true,
        params: { radius: 2, sigma: 1.2, strength: 0.7 },
      },
      {
        id: "tile-b",
        engine: "tileable-blur" as const,
        enabled: true,
        params: { radius: 3, sigma: 1.6, strength: 0.6 },
      },
      {
        id: "dog",
        engine: "difference-of-gaussians" as const,
        enabled: true,
        params: { smallSigma: 0.8, largeSigma: 2, threshold: 1.5, strength: 12 },
      },
    ];
    let oracle = patternedImage();
    for (const operation of operations) {
      oracle = applyBuilt(studioAdjustmentOperationToFilterFields(operation), oracle);
    }
    const stacked = applyBuilt({ smartFilterOperations: operations }, source);
    expect(stacked.data).toEqual(oracle.data);
  });

  it("requires a Worker for the combined cost of duplicate filters", () => {
    const operation = {
      id: "dust-a",
      engine: "dust-scratches" as const,
      enabled: true,
      params: { radius: 2, threshold: 24, strength: 1 },
    };
    const pixels = Math.floor(
      STUDIO_PROFESSIONAL_FILTER_DIRECT_MAX_WORK_UNITS / (25 * 3) / 1.5,
    );
    const width = Math.max(1, pixels);
    const one = { smartFilterOperations: [operation] };
    const duplicate = {
      smartFilterOperations: [operation, { ...operation, id: "dust-b" }],
    };
    expect(studioProfessionalFilterRequiresWorker(one, width, 1)).toBe(false);
    expect(studioProfessionalFilterRequiresWorker(duplicate, width, 1)).toBe(true);
  });

  it("large direct fallback is a no-op while Worker execution remains available", () => {
    const width = Math.floor(STUDIO_PROFESSIONAL_FILTER_DIRECT_MAX_WORK_UNITS / 75) + 1;
    const source = patternedImage(width, 1);
    const fields: ImageFilterFields = {
      dustScratches: { radius: 2, threshold: 0, strength: 1 },
    };
    expect(applyBuilt(fields, source, "direct").data).toEqual(source.data);
    expect(applyBuilt(fields, source, "worker").data).not.toEqual(source.data);
  });
});
