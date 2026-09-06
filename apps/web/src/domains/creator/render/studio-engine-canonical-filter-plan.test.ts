import { describe, expect, it } from "vitest";

import {
  STUDIO_CANONICAL_FILTER_CURVE_INTERPOLATION,
  STUDIO_CANONICAL_FILTER_CURVE_LUT_SIZE,
  STUDIO_CANONICAL_FILTER_DEFAULT_COLOR_METADATA,
  STUDIO_CANONICAL_FILTER_GAUSSIAN_TRUNCATE,
  appendStudioCanonicalFilterNode,
  applyStudioCanonicalFilterRecipeCpu,
  buildStudioCanonicalGaussianKernel,
  createStudioCanonicalFilterRecipe,
  encodeStudioCanonicalFilterRecipe,
  hashStudioCanonicalFilterRecipe,
  parseStudioCanonicalFilterRecipe,
  planStudioCanonicalFilterExecution,
  rebuildStudioCanonicalFilterRecipe,
  studioCanonicalFilterGaussianRadius,
} from "./studio-engine-canonical-filter-plan";

import type {
  StudioCanonicalFilterCurvesNode,
  StudioCanonicalFilterLinearImage,
  StudioCanonicalFilterOperationNode,
} from "./studio-engine-canonical-filter-plan";

const IDENTITY_POINTS = Object.freeze([
  Object.freeze({ x: 0, y: 0 }),
  Object.freeze({ x: 1, y: 1 }),
]);

function linearImage(
  width: number,
  height: number,
  data: readonly number[],
): StudioCanonicalFilterLinearImage {
  return {
    width,
    height,
    data: Float32Array.from(data),
    color: STUDIO_CANONICAL_FILTER_DEFAULT_COLOR_METADATA,
  };
}

function gaussian(
  id: string,
  input: string,
  sigma: number,
  borderMode: "clamp" | "reflect" | "transparent" = "reflect",
): StudioCanonicalFilterOperationNode {
  return {
    id,
    kind: "gaussian-blur",
    input,
    sigma,
    radius: studioCanonicalFilterGaussianRadius(sigma),
    truncate: STUDIO_CANONICAL_FILTER_GAUSSIAN_TRUNCATE,
    borderMode,
  };
}

function identityCurves(id: string, input: string): StudioCanonicalFilterCurvesNode {
  return {
    id,
    kind: "curves",
    input,
    interpolation: STUDIO_CANONICAL_FILTER_CURVE_INTERPOLATION,
    lutSize: STUDIO_CANONICAL_FILTER_CURVE_LUT_SIZE,
    rgb: IDENTITY_POINTS,
    red: IDENTITY_POINTS,
    green: IDENTITY_POINTS,
    blue: IDENTITY_POINTS,
  };
}

function expectArraysClose(
  actual: Float32Array,
  expected: Float32Array,
  precision = 6,
): void {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < actual.length; index += 1) {
    expect(actual[index], `component ${index}`).toBeCloseTo(expected[index]!, precision);
  }
}

describe("canonical filter recipe: immutable, versioned and deterministic", () => {
  it("detaches and deeply freezes accepted schema data while rejecting unknown nodes/fields", () => {
    const empty = createStudioCanonicalFilterRecipe({ recipeId: "quality-stack" });
    const exposure: StudioCanonicalFilterOperationNode = {
      id: "exposure",
      kind: "exposure-contrast",
      input: "source",
      exposureStops: 0.5,
      contrast: 1.1,
      pivot: 0.18,
    };
    const recipe = appendStudioCanonicalFilterNode(empty, exposure);

    expect(Object.isFrozen(recipe)).toBe(true);
    expect(Object.isFrozen(recipe.nodes)).toBe(true);
    expect(Object.isFrozen(recipe.nodes[1])).toBe(true);
    expect(recipe.color).toMatchObject({
      workingSpace: "linear-display-p3",
      primaries: "display-p3",
      transfer: "scene-linear",
      storageFormat: "rgba16float",
      storageAlphaMode: "premultiplied",
      filterMathAlphaMode: "straight",
    });

    const unknownNode = {
      ...JSON.parse(encodeStudioCanonicalFilterRecipe(recipe)),
      revision: 2,
      nodes: [
        ...JSON.parse(encodeStudioCanonicalFilterRecipe(recipe)).nodes,
        { id: "legacy", kind: "legacy-byte-filter", input: "exposure" },
      ],
      outputNodeId: "legacy",
    };
    expect(parseStudioCanonicalFilterRecipe(unknownNode)).toMatchObject({
      ok: false,
      reason: "unsupported-node",
    });

    const unknownField = {
      ...JSON.parse(encodeStudioCanonicalFilterRecipe(recipe)),
      compatibilityMode: "rgba8",
    };
    expect(parseStudioCanonicalFilterRecipe(unknownField)).toMatchObject({
      ok: false,
      reason: "unknown-field",
      path: "$.compatibilityMode",
    });
  });

  it("produces one SHA-256 identity for append, rebuild and durable JSON replay", () => {
    const operations: readonly StudioCanonicalFilterOperationNode[] = [
      {
        id: "exposure",
        kind: "exposure-contrast",
        input: "source",
        exposureStops: 0.75,
        contrast: 1.15,
        pivot: 0.18,
      },
      gaussian("blur", "exposure", 1.25),
      {
        id: "poster",
        kind: "posterize",
        input: "blur",
        levels: 12,
      },
    ];
    let appended = createStudioCanonicalFilterRecipe({ recipeId: "deterministic-stack" });
    for (const operation of operations) {
      appended = appendStudioCanonicalFilterNode(appended, operation);
    }
    const rebuilt = rebuildStudioCanonicalFilterRecipe(
      { recipeId: "deterministic-stack" },
      operations,
    );
    const replayed = parseStudioCanonicalFilterRecipe(
      JSON.parse(encodeStudioCanonicalFilterRecipe(appended)),
    );
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;

    const hashes = [
      hashStudioCanonicalFilterRecipe(appended),
      hashStudioCanonicalFilterRecipe(rebuilt),
      hashStudioCanonicalFilterRecipe(replayed.value),
    ];
    expect(new Set(hashes).size).toBe(1);
    expect(hashes[0]).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(encodeStudioCanonicalFilterRecipe(rebuilt)).toBe(
      encodeStudioCanonicalFilterRecipe(appended),
    );
  });

  it("makes filter order semantic in both hash and pixels", () => {
    const exposure: StudioCanonicalFilterOperationNode = {
      id: "exposure",
      kind: "exposure-contrast",
      input: "source",
      exposureStops: 0.7,
      contrast: 1,
      pivot: 0.18,
    };
    const posterAfter: StudioCanonicalFilterOperationNode = {
      id: "poster",
      kind: "posterize",
      input: "exposure",
      levels: 3,
    };
    const orderA = rebuildStudioCanonicalFilterRecipe(
      { recipeId: "order" },
      [exposure, posterAfter],
    );
    const posterFirst: StudioCanonicalFilterOperationNode = {
      ...posterAfter,
      input: "source",
    };
    const exposureAfter: StudioCanonicalFilterOperationNode = {
      ...exposure,
      input: "poster",
    };
    const orderB = rebuildStudioCanonicalFilterRecipe(
      { recipeId: "order" },
      [posterFirst, exposureAfter],
    );
    const source = linearImage(1, 1, [0.31, 0.17, 0.07, 1]);
    const outputA = applyStudioCanonicalFilterRecipeCpu(orderA, source);
    const outputB = applyStudioCanonicalFilterRecipeCpu(orderB, source);

    expect(hashStudioCanonicalFilterRecipe(orderA)).not.toBe(
      hashStudioCanonicalFilterRecipe(orderB),
    );
    expect([...outputA.data]).not.toEqual([...outputB.data]);
  });
});

describe("canonical filter planner: exact tiled halos and bounded dispatch", () => {
  it("derives a 4-sigma halo and emits seam-safe horizontal/vertical tile reads", () => {
    const sigma = 2;
    const recipe = rebuildStudioCanonicalFilterRecipe(
      { recipeId: "halo" },
      [gaussian("blur", "source", sigma, "transparent")],
    );
    const result = planStudioCanonicalFilterExecution(recipe, 9, 7, { tileSize: 4 });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    expect(studioCanonicalFilterGaussianRadius(sigma)).toBe(8);
    expect(result.plan).toMatchObject({
      textureFormat: "rgba16float",
      storageAlphaMode: "premultiplied",
      filterMathAlphaMode: "straight",
      tileCount: 6,
      dispatchCount: 12,
      maximumHalo: 8,
    });
    const horizontal = result.plan.stages[0]!;
    const vertical = result.plan.stages[1]!;
    expect(horizontal).toMatchObject({
      pass: "gaussian-horizontal",
      borderMode: "transparent",
      radius: 8,
    });
    expect(horizontal.tiles[0]).toMatchObject({
      core: { x: 0, y: 0, width: 4, height: 4 },
      read: { x: -8, y: 0, width: 20, height: 4 },
      clippedRead: { x: 0, y: 0, width: 9, height: 4 },
      halo: { left: 8, top: 0, right: 8, bottom: 0 },
    });
    expect(vertical.tiles[0]).toMatchObject({
      read: { x: 0, y: -8, width: 4, height: 20 },
      halo: { left: 0, top: 8, right: 0, bottom: 8 },
    });
  });

  it("fails closed before exceeding tile, dispatch or halo budgets", () => {
    const recipe = rebuildStudioCanonicalFilterRecipe(
      { recipeId: "bounded" },
      [gaussian("blur", "source", 2)],
    );
    expect(
      planStudioCanonicalFilterExecution(recipe, 512, 512, {
        tileSize: 64,
        maxTiles: 10,
      }),
    ).toEqual({ status: "rejected", reason: "tile-budget-exceeded" });
    expect(
      planStudioCanonicalFilterExecution(recipe, 512, 512, {
        tileSize: 64,
        maxDispatches: 100,
      }),
    ).toEqual({ status: "rejected", reason: "dispatch-budget-exceeded" });
    expect(
      planStudioCanonicalFilterExecution(recipe, 512, 512, {
        tileSize: 64,
        maxHalo: 7,
      }),
    ).toEqual({ status: "rejected", reason: "halo-budget-exceeded" });
  });
});

describe("canonical filter CPU oracle: linear premultiplied quality", () => {
  it("normalizes Gaussian energy and preserves transparent-edge colour without a dark fringe", () => {
    const weights = buildStudioCanonicalGaussianKernel(1);
    expect([...weights].reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 14);

    const pixels = new Array<number>(9 * 9 * 4).fill(0);
    const centre = (4 * 9 + 4) * 4;
    pixels[centre] = 0.5;
    pixels[centre + 3] = 0.5;
    const source = linearImage(9, 9, pixels);
    const recipe = rebuildStudioCanonicalFilterRecipe(
      { recipeId: "transparent-edge" },
      [gaussian("blur", "source", 1, "transparent")],
    );
    const output = applyStudioCanonicalFilterRecipeCpu(recipe, source, { tileSize: 3 });

    let redEnergy = 0;
    let alphaEnergy = 0;
    for (let index = 0; index < output.data.length; index += 4) {
      const alpha = output.data[index + 3]!;
      redEnergy += output.data[index]!;
      alphaEnergy += alpha;
      if (alpha > 1e-7) {
        expect(output.data[index]! / alpha).toBeCloseTo(1, 6);
        expect(output.data[index + 1]).toBe(0);
        expect(output.data[index + 2]).toBe(0);
      }
    }
    expect(redEnergy).toBeCloseTo(0.5, 6);
    expect(alphaEnergy).toBeCloseTo(0.5, 6);
  });

  it("matches full-frame and adversarial small-tile Gaussian evaluation without seams", () => {
    const width = 13;
    const height = 11;
    const pixels: number[] = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const alpha = ((x * 7 + y * 11) % 17) / 16;
        pixels.push(
          alpha * ((x + 1) / width),
          alpha * ((y + 1) / height),
          alpha * (((x + y) % 9) / 8),
          alpha,
        );
      }
    }
    const source = linearImage(width, height, pixels);
    const recipe = rebuildStudioCanonicalFilterRecipe(
      { recipeId: "seam-parity" },
      [gaussian("blur", "source", 1.3, "reflect")],
    );
    const full = applyStudioCanonicalFilterRecipeCpu(recipe, source, { tileSize: 1_024 });
    const tiled = applyStudioCanonicalFilterRecipeCpu(recipe, source, { tileSize: 3 });
    expectArraysClose(tiled.data, full.data, 7);
  });

  it("keeps a complete identity stack invariant across explicit straight/premultiplied boundaries", () => {
    const operations: readonly StudioCanonicalFilterOperationNode[] = [
      gaussian("zero-blur", "source", 0),
      {
        id: "zero-unsharp",
        kind: "unsharp-mask",
        input: "zero-blur",
        sigma: 1,
        radius: studioCanonicalFilterGaussianRadius(1),
        truncate: STUDIO_CANONICAL_FILTER_GAUSSIAN_TRUNCATE,
        amount: 0,
        threshold: 0,
        borderMode: "reflect",
      },
      {
        id: "exposure",
        kind: "exposure-contrast",
        input: "zero-unsharp",
        exposureStops: 0,
        contrast: 1,
        pivot: 0.18,
      },
      {
        id: "levels",
        kind: "levels",
        input: "exposure",
        inputBlack: [0, 0, 0],
        inputWhite: [1, 1, 1],
        gamma: [1, 1, 1],
        outputBlack: [0, 0, 0],
        outputWhite: [1, 1, 1],
      },
      identityCurves("curves", "levels"),
      {
        id: "matrix",
        kind: "color-matrix",
        input: "curves",
        matrix: [
          1, 0, 0, 0, 0,
          0, 1, 0, 0, 0,
          0, 0, 1, 0, 0,
          0, 0, 0, 1, 0,
        ],
      },
      {
        id: "mixer",
        kind: "channel-mixer",
        input: "matrix",
        matrix: [
          1, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, 1, 0,
        ],
      },
      {
        id: "morph",
        kind: "morphology",
        input: "mixer",
        operation: "max",
        metric: "alpha",
        radius: 0,
        borderMode: "transparent",
      },
    ];
    const recipe = rebuildStudioCanonicalFilterRecipe({ recipeId: "identity" }, operations);
    const source = linearImage(3, 2, [
      0, 0, 0, 0,
      0.1, 0.05, 0.02, 0.25,
      0.75, 0.5, 0.25, 1,
      0.02, 0.15, 0.03, 0.2,
      0.3, 0.3, 0.3, 0.5,
      0.8, 0.1, 0.4, 0.8,
    ]);
    const output = applyStudioCanonicalFilterRecipeCpu(recipe, source, { tileSize: 1 });
    expectArraysClose(output.data, source.data, 6);
    expect([...output.data.slice(0, 4)]).toEqual([0, 0, 0, 0]);
  });

  it("supports production point filters and alpha-coherent min/max morphology", () => {
    const operations: readonly StudioCanonicalFilterOperationNode[] = [
      {
        id: "threshold",
        kind: "threshold",
        input: "source",
        threshold: 0.2,
        mode: "luminance",
      },
      {
        id: "posterize",
        kind: "posterize",
        input: "threshold",
        levels: 4,
      },
      {
        id: "dilate",
        kind: "morphology",
        input: "posterize",
        operation: "max",
        metric: "alpha",
        radius: 1,
        borderMode: "transparent",
      },
    ];
    const recipe = rebuildStudioCanonicalFilterRecipe({ recipeId: "point-and-morph" }, operations);
    const source = linearImage(3, 1, [
      0, 0, 0, 0,
      0.3, 0.1, 0.05, 0.5,
      0, 0, 0, 0,
    ]);
    const output = applyStudioCanonicalFilterRecipeCpu(recipe, source, { tileSize: 1 });

    for (let index = 0; index < output.data.length; index += 4) {
      expect(output.data[index + 3]).toBeCloseTo(0.5, 6);
      expect(output.data[index]).toBeCloseTo(0.5, 6);
      expect(output.data[index + 1]).toBeCloseTo(0.5, 6);
      expect(output.data[index + 2]).toBeCloseTo(0.5, 6);
    }
  });
});
