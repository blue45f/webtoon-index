import { describe, expect, it } from "vitest";

import {
  applyImageFilters,
  buildImageFilters,
  registerStudioKonvaFilters,
  type KonvaLike,
} from "../render/studio-konva-filters";
import {
  studioAdjustmentDefaultParams,
  studioAdjustmentOperationToFilterFields,
  type StudioAdjustmentEngineId,
} from "../studio-adjustment-stack";

const COMPOSITE_ENGINES = [
  "surface-blur",
  "crystal-mosaic",
  "pencil-sketch",
  "crosshatch",
  "ordered-dither",
  "glowing-edges",
  "cutout",
  "retro-film",
  "watercolor",
  "diffuse-glow",
] as const satisfies readonly StudioAdjustmentEngineId[];

function fixture(width = 12, height = 10) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = (x * 31 + y * 7 + ((x + y) % 3) * 41) % 256;
      data[offset + 1] = (x * 13 + y * 29 + ((x * y) % 5) * 23) % 256;
      data[offset + 2] = (x * 5 + y * 37 + ((x + y) % 7) * 17) % 256;
      data[offset + 3] = 48 + ((x * 19 + y * 11) % 208);
    }
  }
  return { data, width, height };
}

function run(engine: (typeof COMPOSITE_ENGINES)[number]) {
  const input = fixture();
  const image = { ...input, data: new Uint8ClampedArray(input.data) };
  const registry: KonvaLike = { Filters: {} };
  registerStudioKonvaFilters(registry);
  const fields = studioAdjustmentOperationToFilterFields({
    id: `gallery-${engine}`,
    engine,
    enabled: true,
    params: studioAdjustmentDefaultParams(engine),
  });
  const build = buildImageFilters(fields, registry);
  applyImageFilters(image, build.filters, build.attrs);
  return { build, fields, image, input };
}

describe("bounded Filter Gallery composites", () => {
  it.each(COMPOSITE_ENGINES)("%s projects to a real pixel chain", (engine) => {
    const { build, image, input } = run(engine);
    expect(build.filters.length).toBeGreaterThan(0);
    expect(Array.from(image.data)).not.toEqual(Array.from(input.data));
  });

  it.each(COMPOSITE_ENGINES)("%s is deterministic and preserves alpha", (engine) => {
    const first = run(engine);
    const second = run(engine);
    expect(Array.from(first.image.data)).toEqual(Array.from(second.image.data));
    for (let offset = 3; offset < first.image.data.length; offset += 4) {
      expect(first.image.data[offset]).toBe(first.input.data[offset]);
    }
  });

  it("keeps neighborhood and texture parameters inside the shared runtime budgets", () => {
    const surface = studioAdjustmentOperationToFilterFields({
      id: "hostile-surface",
      engine: "surface-blur",
      enabled: true,
      params: { strength: 1e9, radius: 1e9 },
    });
    const watercolor = studioAdjustmentOperationToFilterFields({
      id: "hostile-watercolor",
      engine: "watercolor",
      enabled: true,
      params: { strength: 1e9, spread: 1e9, bleed: 1e9, granulation: 1e9, paper: 1e9 },
    });
    const registry: KonvaLike = { Filters: {} };
    registerStudioKonvaFilters(registry);
    expect(buildImageFilters(surface, registry).attrs).toMatchObject({
      dtAmount: 100,
      dtRadius: 10,
    });
    expect(buildImageFilters(watercolor, registry).attrs).toMatchObject({
      inkWashStrength: 100,
      inkWashSpread: 12,
      inkWashEdgeBleed: 100,
      inkWashGranulation: 100,
      inkWashPaper: 100,
    });
  });

  it.each(COMPOSITE_ENGINES)("%s exposes a zero-strength identity", (engine) => {
    const registry: KonvaLike = { Filters: {} };
    registerStudioKonvaFilters(registry);
    const fields = studioAdjustmentOperationToFilterFields({
      id: `identity-${engine}`,
      engine,
      enabled: true,
      params: { ...studioAdjustmentDefaultParams(engine), strength: 0 },
    });
    expect(buildImageFilters(fields, registry).filters).toHaveLength(0);
  });
});
