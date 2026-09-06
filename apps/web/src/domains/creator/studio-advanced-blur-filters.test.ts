import { describe, expect, it } from "vitest";

import {
  applyImageFilters,
  buildImageFilters,
  registerStudioKonvaFilters,
  type KonvaLike,
} from "./render/studio-konva-filters";
import {
  applyStudioAdvancedBlurFilter,
  type StudioAdvancedBlurKernelId,
} from "./studio-advanced-blur-filter-kernels";
import {
  STUDIO_ADVANCED_BLUR_DIRECT_MAX_SOURCE_SAMPLES,
  studioAdvancedBlurRequiresWorker,
} from "./studio-advanced-blur-filters";

import type { ImageFilterFields } from "./render/studio-konva-filter-fields";
import type { StudioImageDataLike } from "./studio-filters";

const registry: KonvaLike = { Filters: {} };
registerStudioKonvaFilters(registry);

function fixture(width = 17, height = 13): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = (x * 37 + y * 19) % 256;
      data[offset + 1] = (x * 11 + y * 43) % 256;
      data[offset + 2] = (x * 59 + y * 7) % 256;
      data[offset + 3] = (x + y) % 4 === 0 ? 72 : (x + y) % 4 === 1 ? 144 : 255;
    }
  }
  return { data, width, height };
}

function clone(image: StudioImageDataLike): StudioImageDataLike {
  return {
    data: new Uint8ClampedArray(image.data),
    width: image.width,
    height: image.height,
  };
}

const CASES: readonly {
  readonly kernel: StudioAdvancedBlurKernelId;
  readonly fields: ImageFilterFields;
  readonly options: Record<string, number>;
}[] = [
  {
    kernel: "lens-blur",
    fields: {
      lensBlur: {
        radius: 3.25,
        sampleCount: 17,
        apertureBlades: 7,
        apertureRotationRadians: 0.3,
      },
    },
    options: {
      radius: 3.25,
      sampleCount: 17,
      apertureBlades: 7,
      apertureRotationRadians: 0.3,
    },
  },
  {
    kernel: "field-iris-blur",
    fields: {
      fieldIrisBlur: {
        focusCenterX: 0.42,
        focusCenterY: 0.58,
        focusRadius: 0.12,
        feather: 0.31,
        maximumBlurRadius: 5.5,
        sampleCount: 15,
        apertureBlades: 8,
      },
    },
    options: {
      focusCenterX: 0.42,
      focusCenterY: 0.58,
      focusRadius: 0.12,
      feather: 0.31,
      maximumBlurRadius: 5.5,
      sampleCount: 15,
      apertureBlades: 8,
    },
  },
  {
    kernel: "tilt-shift-blur",
    fields: {
      tiltShiftBlur: {
        axisRadians: 0.6,
        focusWidth: 0.18,
        feather: 0.26,
        maximumBlurRadius: 5,
        sampleCount: 17,
      },
    },
    options: {
      axisRadians: 0.6,
      focusWidth: 0.18,
      feather: 0.26,
      maximumBlurRadius: 5,
      sampleCount: 17,
    },
  },
  {
    kernel: "selective-gaussian-blur",
    fields: {
      selectiveGaussianBlur: {
        radius: 2,
        spatialSigma: 1.6,
        edgeThreshold: 32,
        edgeSoftness: 0.45,
      },
    },
    options: {
      radius: 2,
      spatialSigma: 1.6,
      edgeThreshold: 32,
      edgeSoftness: 0.45,
    },
  },
];

describe("advanced blur product adapters", () => {
  it.each(CASES)(
    "keeps $kernel byte-identical to its pure CPU oracle and preserves alpha",
    ({ kernel, fields, options }) => {
      const source = fixture();
      const product = clone(source);
      const built = buildImageFilters(fields, registry, "worker");
      applyImageFilters(product, built.filters, built.attrs);
      const oracle = applyStudioAdvancedBlurFilter({
        kernel,
        source,
        options,
      } as Parameters<typeof applyStudioAdvancedBlurFilter>[0]);

      expect(oracle.status).toBe("applied");
      if (oracle.status !== "applied") return;
      expect(product.data).toEqual(oracle.image.data);
      for (let offset = 3; offset < product.data.length; offset += 4) {
        expect(product.data[offset]).toBe(source.data[offset]);
      }
    },
  );

  it("keeps duplicate smart filters in exact stored order", () => {
    const source = fixture(15, 11);
    const fields: ImageFilterFields = {
      smartFilterOperations: [
        {
          id: "lens-a",
          engine: "lens-blur",
          enabled: true,
          params: { radius: 2, sampleCount: 9, apertureBlades: 5, apertureRotationRadians: 0 },
        },
        {
          id: "selective",
          engine: "selective-gaussian-blur",
          enabled: true,
          params: { radius: 1, spatialSigma: 1, edgeThreshold: 24, edgeSoftness: 0.3 },
        },
        {
          id: "lens-b",
          engine: "lens-blur",
          enabled: true,
          params: { radius: 4, sampleCount: 11, apertureBlades: 8, apertureRotationRadians: 0.4 },
        },
      ],
    };
    const built = buildImageFilters(fields, registry, "worker");
    const output = clone(source);
    applyImageFilters(output, built.filters, built.attrs);

    let oracle = clone(source);
    for (const operation of fields.smartFilterOperations!) {
      const result = applyStudioAdvancedBlurFilter({
        kernel: operation.engine,
        source: oracle,
        options: operation.params,
      } as Parameters<typeof applyStudioAdvancedBlurFilter>[0]);
      expect(result.status).toBe("applied");
      if (result.status === "applied") oracle = result.image;
    }
    expect(built.filters).toHaveLength(3);
    expect(output.data).toEqual(oracle.data);
  });

  it("fails closed on an expensive direct fallback but permits the same bounded job in a Worker", () => {
    const width = Math.floor(STUDIO_ADVANCED_BLUR_DIRECT_MAX_SOURCE_SAMPLES / 84) + 1;
    const source = fixture(width, 1);
    const fields: ImageFilterFields = {
      lensBlur: {
        radius: 4,
        sampleCount: 21,
        apertureBlades: 6,
        apertureRotationRadians: 0,
      },
    };
    expect(studioAdvancedBlurRequiresWorker(fields, width, 1)).toBe(true);

    const direct = clone(source);
    const directBuild = buildImageFilters(fields, registry);
    applyImageFilters(direct, directBuild.filters, directBuild.attrs);
    expect(direct.data).toEqual(source.data);

    const worker = clone(source);
    const workerBuild = buildImageFilters(fields, registry, "worker");
    applyImageFilters(worker, workerBuild.filters, workerBuild.attrs);
    expect(worker.data).not.toEqual(source.data);
  });

  it("adds duplicate stack cost before deciding whether a Worker is required", () => {
    const one: ImageFilterFields = {
      smartFilterOperations: [{
        id: "one",
        engine: "lens-blur",
        enabled: true,
        params: { radius: 2, sampleCount: 5, apertureBlades: 6, apertureRotationRadians: 0 },
      }],
    };
    const duplicate: ImageFilterFields = {
      smartFilterOperations: [
        ...one.smartFilterOperations!,
        {
          id: "two",
          engine: "lens-blur",
          enabled: true,
          params: { radius: 3, sampleCount: 5, apertureBlades: 6, apertureRotationRadians: 0 },
        },
      ],
    };
    const width = 350;
    const height = 300;
    expect(studioAdvancedBlurRequiresWorker(one, width, height)).toBe(false);
    expect(studioAdvancedBlurRequiresWorker(duplicate, width, height)).toBe(true);
  });
});
