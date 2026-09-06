import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createStudioProceduralMediaSurfaceProvider,
  createStudioProceduralMediaSurfaceRecipe,
  parseStudioProceduralMediaSurfaceRecipe,
  renderStudioProceduralMediaSurfaceCpuOracle,
  verifyStudioProceduralMediaSurfaceRenderReceiptIntegrity,
  type StudioProceduralMediaSurfaceArtifact,
  type StudioProceduralMediaSurfaceRecipe,
  type StudioProceduralMediaSurfaceRecipeInput,
  type StudioProceduralMediaSurfaceRegion,
} from "./studio-procedural-media-surface-provider";

afterEach(() => {
  vi.unstubAllGlobals();
});

function recipeInput(
  overrides: Partial<StudioProceduralMediaSurfaceRecipeInput> = {},
): StudioProceduralMediaSurfaceRecipeInput {
  return {
    seed: 31,
    worldScale: 24,
    rotationRadians: 0.17,
    offset: [3, -5],
    contrast: 1.2,
    seamlessPeriod: null,
    relief: {
      frequency: 1.1,
      octaves: 4,
      lacunarity: 2,
      gain: 0.5,
      amplitude: 0.55,
    },
    fibers: {
      frequency: 8,
      amplitude: 0.2,
      directionRadians: 0.3,
      irregularity: 0.35,
    },
    weave: {
      warpFrequency: 5,
      weftFrequency: 6,
      amplitude: 0.18,
      balance: 0.55,
    },
    pores: {
      frequency: 12,
      density: 0.18,
      amplitude: 0.22,
    },
    speckles: {
      frequency: 20,
      density: 0.1,
      amplitude: 0.12,
    },
    channels: {
      absorbencyBase: 0.42,
      reliefToAbsorbency: 0.18,
      poreToAbsorbency: 0.4,
      speckleToAbsorbency: 0.15,
      grainBase: 0.2,
      reliefToGrain: 0.25,
      fiberToGrain: 0.35,
      weaveToGrain: 0.25,
      speckleToGrain: 0.2,
    },
    flow: {
      gradientStep: 0.5,
      downhillWeight: 0.8,
      tangentWeight: 0.2,
      gravity: [0, 0.18],
      wind: [0.08, 0],
    },
    ...overrides,
  };
}

function readyRecipe(
  overrides: Partial<StudioProceduralMediaSurfaceRecipeInput> = {},
): StudioProceduralMediaSurfaceRecipe {
  const result = createStudioProceduralMediaSurfaceRecipe(
    recipeInput(overrides),
  );
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error(result.path);
  return result.recipe;
}

function region(
  overrides: Partial<StudioProceduralMediaSurfaceRegion> = {},
): StudioProceduralMediaSurfaceRegion {
  return {
    originX: 0,
    originY: 0,
    width: 12,
    height: 10,
    halo: 0,
    ...overrides,
  };
}

function channelValues(
  artifact: StudioProceduralMediaSurfaceArtifact,
  channel: "heightField" | "absorbency" | "grain" | "flow",
): Float32Array {
  return artifact[channel];
}

function stitchCoreChannel(
  tiles: readonly StudioProceduralMediaSurfaceArtifact[],
  regions: readonly StudioProceduralMediaSurfaceRegion[],
  fullWidth: number,
  fullHeight: number,
  channel: "heightField" | "absorbency" | "grain" | "flow",
): Float32Array {
  const stride = channel === "flow" ? 2 : 1;
  const output = new Float32Array(fullWidth * fullHeight * stride);
  for (let tileIndex = 0; tileIndex < tiles.length; tileIndex += 1) {
    const tile = tiles[tileIndex];
    const tileRegion = regions[tileIndex];
    for (let y = 0; y < tileRegion.height; y += 1) {
      for (let x = 0; x < tileRegion.width; x += 1) {
        const sourcePixel =
          (y + tileRegion.halo) * tile.width
          + x + tileRegion.halo;
        const targetPixel =
          (tileRegion.originY + y) * fullWidth
          + tileRegion.originX + x;
        for (let component = 0; component < stride; component += 1) {
          output[targetPixel * stride + component] =
            channelValues(tile, channel)[sourcePixel * stride + component]
            ?? 0;
        }
      }
    }
  }
  return output;
}

function maximumDelta(
  first: Float32Array,
  second: Float32Array,
): number {
  expect(first.length).toBe(second.length);
  let maximum = 0;
  for (let index = 0; index < first.length; index += 1) {
    maximum = Math.max(
      maximum,
      Math.abs((first[index] ?? 0) - (second[index] ?? 0)),
    );
  }
  return maximum;
}

describe("Studio procedural media surface CPU oracle", () => {
  it("is deterministic per seed and emits finite bounded channels with hashes", () => {
    const first = renderStudioProceduralMediaSurfaceCpuOracle(
      readyRecipe({ seed: 5 }),
      region(),
    );
    const repeated = renderStudioProceduralMediaSurfaceCpuOracle(
      readyRecipe({ seed: 5 }),
      region(),
    );
    const distinct = renderStudioProceduralMediaSurfaceCpuOracle(
      readyRecipe({ seed: 6 }),
      region(),
    );
    expect(first.receipt.artifactHash).toBe(repeated.receipt.artifactHash);
    expect(first.heightField).toEqual(repeated.heightField);
    expect(first.receipt.artifactHash).not.toBe(
      distinct.receipt.artifactHash,
    );
    expect(first.heightField.every(Number.isFinite)).toBe(true);
    expect(first.absorbency.every(
      (value) => value >= 0 && value <= 1,
    )).toBe(true);
    expect(first.grain.every(
      (value) => value >= 0 && value <= 1,
    )).toBe(true);
    for (let index = 0; index < first.flow.length; index += 2) {
      expect(Math.hypot(
        first.flow[index] ?? 0,
        first.flow[index + 1] ?? 0,
      )).toBeLessThanOrEqual(1.000_001);
    }
    expect(first.receipt).toMatchObject({
      backend: "cpu-f32-global-coordinate-oracle",
      samplingConvention: "integer-pixel-centers-plus-one-half",
      tileContract: "global-origin-with-symmetric-halo",
      periodicMode: "aperiodic",
      gradientModel: "global-central-difference-composite-height",
      complete: true,
    });
    expect(first.receipt.heightHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(first.receipt.absorbencyHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(first.receipt.grainHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(first.receipt.flowHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("combines relief, fibers, weave, pores and speckles as independent recipe controls", () => {
    const quiet = readyRecipe({
      relief: { ...recipeInput().relief, amplitude: 0 },
      fibers: { ...recipeInput().fibers, amplitude: 0 },
      weave: { ...recipeInput().weave, amplitude: 0 },
      pores: { ...recipeInput().pores, amplitude: 0, density: 0 },
      speckles: {
        ...recipeInput().speckles,
        amplitude: 0,
        density: 0,
      },
      channels: {
        absorbencyBase: 0.4,
        reliefToAbsorbency: 0,
        poreToAbsorbency: 0,
        speckleToAbsorbency: 0,
        grainBase: 0.2,
        reliefToGrain: 0,
        fiberToGrain: 0,
        weaveToGrain: 0,
        speckleToGrain: 0,
      },
    });
    const detailed = readyRecipe();
    const quietArtifact = renderStudioProceduralMediaSurfaceCpuOracle(
      quiet,
      region(),
    );
    const detailedArtifact = renderStudioProceduralMediaSurfaceCpuOracle(
      detailed,
      region(),
    );
    expect(new Set(quietArtifact.heightField).size).toBe(1);
    expect(new Set(quietArtifact.absorbency).size).toBe(1);
    expect(new Set(quietArtifact.grain).size).toBe(1);
    expect(new Set(detailedArtifact.heightField).size).toBeGreaterThan(10);
    expect(new Set(detailedArtifact.absorbency).size).toBeGreaterThan(10);
    expect(new Set(detailedArtifact.grain).size).toBeGreaterThan(10);
  });

  it("matches a full frame exactly when arbitrary halo tiles are stitched", () => {
    const recipe = readyRecipe();
    const full = renderStudioProceduralMediaSurfaceCpuOracle(
      recipe,
      region({ width: 12, height: 10 }),
    );
    const tileRegions = [
      region({ originX: 0, originY: 0, width: 5, height: 4, halo: 2 }),
      region({ originX: 5, originY: 0, width: 7, height: 4, halo: 1 }),
      region({ originX: 0, originY: 4, width: 8, height: 6, halo: 3 }),
      region({ originX: 8, originY: 4, width: 4, height: 6, halo: 2 }),
    ];
    const tiles = tileRegions.map((tileRegion) =>
      renderStudioProceduralMediaSurfaceCpuOracle(recipe, tileRegion),
    );
    for (
      const channel of [
        "heightField",
        "absorbency",
        "grain",
        "flow",
      ] as const
    ) {
      const stitched = stitchCoreChannel(
        tiles,
        tileRegions,
        full.width,
        full.height,
        channel,
      );
      expect(stitched).toEqual(channelValues(full, channel));
    }
    expect(tiles[0]?.receipt.origin).toEqual([-2, -2]);
    expect(tiles[0]?.receipt.coreOrigin).toEqual([0, 0]);
    expect(tiles[0]?.receipt.outputSize).toEqual([9, 8]);
  });

  it("produces identical values in overlapping halos from global coordinates", () => {
    const recipe = readyRecipe();
    const left = renderStudioProceduralMediaSurfaceCpuOracle(
      recipe,
      region({ originX: 0, originY: 0, width: 6, height: 6, halo: 2 }),
    );
    const right = renderStudioProceduralMediaSurfaceCpuOracle(
      recipe,
      region({ originX: 6, originY: 0, width: 6, height: 6, halo: 3 }),
    );
    for (let worldY = -2; worldY < 8; worldY += 1) {
      for (let worldX = 3; worldX < 8; worldX += 1) {
        const leftIndex =
          (worldY - left.originY) * left.width
          + worldX - left.originX;
        const rightIndex =
          (worldY - right.originY) * right.width
          + worldX - right.originX;
        if (
          leftIndex < 0
          || rightIndex < 0
          || leftIndex >= left.heightField.length
          || rightIndex >= right.heightField.length
        ) continue;
        expect(left.heightField[leftIndex]).toBe(
          right.heightField[rightIndex],
        );
        expect(left.absorbency[leftIndex]).toBe(
          right.absorbency[rightIndex],
        );
        expect(left.grain[leftIndex]).toBe(right.grain[rightIndex]);
        expect(left.flow[leftIndex * 2]).toBe(right.flow[rightIndex * 2]);
        expect(left.flow[leftIndex * 2 + 1]).toBe(
          right.flow[rightIndex * 2 + 1],
        );
      }
    }
  });

  it("is seamless across both caller periods including flow gradients", () => {
    const recipe = readyRecipe({
      seamlessPeriod: [8, 6],
      worldScale: 3,
      rotationRadians: 0.61,
      offset: [1.25, -2.5],
    });
    const base = renderStudioProceduralMediaSurfaceCpuOracle(
      recipe,
      region({ originX: 0, originY: 0, width: 8, height: 6 }),
    );
    const translatedX = renderStudioProceduralMediaSurfaceCpuOracle(
      recipe,
      region({ originX: 8, originY: 0, width: 8, height: 6 }),
    );
    const translatedY = renderStudioProceduralMediaSurfaceCpuOracle(
      recipe,
      region({ originX: 0, originY: 6, width: 8, height: 6 }),
    );
    for (
      const channel of [
        "heightField",
        "absorbency",
        "grain",
        "flow",
      ] as const
    ) {
      expect(maximumDelta(
        channelValues(base, channel),
        channelValues(translatedX, channel),
      )).toBeLessThan(0.000_01);
      expect(maximumDelta(
        channelValues(base, channel),
        channelValues(translatedY, channel),
      )).toBeLessThan(0.000_01);
    }
    expect(base.receipt.periodicMode).toBe("integer-fourier-torus");
  });

  it("uses rotation and offset while defensively copying caller arrays", () => {
    const offset: [number, number] = [2, 4];
    const period: [number, number] = [16, 12];
    const gravity: [number, number] = [0, 0.2];
    const wind: [number, number] = [0.1, 0];
    const original = readyRecipe({
      offset,
      seamlessPeriod: period,
      flow: {
        ...recipeInput().flow,
        gravity,
        wind,
      },
    });
    offset[0] = 999;
    period[0] = 999;
    gravity[1] = 999;
    wind[0] = 999;
    expect(original.offset).toEqual([2, 4]);
    expect(original.seamlessPeriod).toEqual([16, 12]);
    expect(original.flow.gravity).toEqual([0, 0.2]);
    expect(original.flow.wind).toEqual([0.1, 0]);

    const rotated = readyRecipe({
      offset: [2, 4],
      seamlessPeriod: [16, 12],
      rotationRadians: original.rotationRadians + 0.7,
      flow: {
        ...recipeInput().flow,
        gravity: [0, 0.2],
        wind: [0.1, 0],
      },
    });
    const shifted = readyRecipe({
      offset: [7, 4],
      seamlessPeriod: [16, 12],
      flow: {
        ...recipeInput().flow,
        gravity: [0, 0.2],
        wind: [0.1, 0],
      },
    });
    expect(rotated.fingerprint).not.toBe(original.fingerprint);
    expect(shifted.fingerprint).not.toBe(original.fingerprint);
    const baseline = renderStudioProceduralMediaSurfaceCpuOracle(
      original,
      region(),
    );
    expect(
      renderStudioProceduralMediaSurfaceCpuOracle(
        rotated,
        region(),
      ).receipt.heightHash,
    ).not.toBe(baseline.receipt.heightHash);
    expect(
      renderStudioProceduralMediaSurfaceCpuOracle(
        shifted,
        region(),
      ).receipt.heightHash,
    ).not.toBe(baseline.receipt.heightHash);
  });

  it("documents and applies gravity/wind when the relief gradient is zero", () => {
    const flat = readyRecipe({
      relief: { ...recipeInput().relief, amplitude: 0 },
      fibers: { ...recipeInput().fibers, amplitude: 0 },
      weave: { ...recipeInput().weave, amplitude: 0 },
      pores: { ...recipeInput().pores, amplitude: 0, density: 0 },
      speckles: {
        ...recipeInput().speckles,
        amplitude: 0,
        density: 0,
      },
      flow: {
        gradientStep: 0.5,
        downhillWeight: 1,
        tangentWeight: 1,
        gravity: [2, 0],
        wind: [0, 0],
      },
    });
    const artifact = renderStudioProceduralMediaSurfaceCpuOracle(
      flat,
      region({ width: 3, height: 2 }),
    );
    for (let index = 0; index < artifact.flow.length; index += 2) {
      expect(artifact.flow[index]).toBe(1);
      expect(artifact.flow[index + 1]).toBe(0);
    }
    expect(artifact.receipt.flowModel).toBe(
      "unit-clamp(downhill*(-normalized-height-gradient)+tangent*perpendicular+gravity+wind)",
    );
  });

  it("isolates returned channel buffers and verifies recipe fingerprints", () => {
    const recipe = readyRecipe();
    const first = renderStudioProceduralMediaSurfaceCpuOracle(
      recipe,
      region(),
    );
    const repeated = renderStudioProceduralMediaSurfaceCpuOracle(
      recipe,
      region(),
    );
    first.heightField.fill(99);
    first.absorbency.fill(99);
    first.grain.fill(99);
    first.flow.fill(99);
    expect(repeated.heightField.every((value) => value !== 99)).toBe(true);
    expect(repeated.absorbency.every((value) => value !== 99)).toBe(true);
    expect(repeated.grain.every((value) => value !== 99)).toBe(true);
    expect(repeated.flow.every((value) => value !== 99)).toBe(true);
    expect(parseStudioProceduralMediaSurfaceRecipe({
      ...recipe,
      fingerprint: `sha256:${"0".repeat(64)}`,
    })).toBeNull();
  });

  it("fails closed for malformed, nonfinite, budget and aborted requests", () => {
    const recipe = readyRecipe();
    expect(() =>
      renderStudioProceduralMediaSurfaceCpuOracle(
        recipe,
        { ...region(), originX: Number.NaN },
      ),
    ).toThrowError(expect.objectContaining({ code: "invalid-region" }));
    expect(() =>
      renderStudioProceduralMediaSurfaceCpuOracle(recipe, region(), {
        maximumOutputPixels: 4,
      }),
    ).toThrowError(expect.objectContaining({ code: "budget-exceeded" }));
    expect(() =>
      renderStudioProceduralMediaSurfaceCpuOracle(recipe, region(), {
        maximumWorkUnits: 1,
      }),
    ).toThrowError(expect.objectContaining({ code: "budget-exceeded" }));
    expect(() =>
      renderStudioProceduralMediaSurfaceCpuOracle(recipe, region(), {
        maximumResidentBytes: 1,
      }),
    ).toThrowError(expect.objectContaining({ code: "budget-exceeded" }));
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      renderStudioProceduralMediaSurfaceCpuOracle(recipe, region(), {
        signal: controller.signal,
      }),
    ).toThrowError(expect.objectContaining({ code: "aborted" }));
    expect(createStudioProceduralMediaSurfaceRecipe(
      recipeInput({ worldScale: Number.POSITIVE_INFINITY }),
    )).toEqual({
      status: "rejected",
      reason: "invalid-recipe",
      path: "$",
    });
  });
});

describe("Studio procedural media surface provider lifecycle", () => {
  it("enforces one-operation backpressure and monotonic sequence/epoch", async () => {
    const creation = createStudioProceduralMediaSurfaceProvider();
    expect(creation.status).toBe("ready");
    if (creation.status !== "ready") throw new Error(creation.path);
    const provider = creation.provider;
    const first = provider.render({
      requestSequence: 1,
      engineEpoch: 1,
      recipe: readyRecipe(),
      region: region({ width: 4, height: 4 }),
    });
    await expect(provider.render({
      requestSequence: 2,
      engineEpoch: 1,
      recipe: readyRecipe(),
      region: region({ width: 4, height: 4 }),
    })).rejects.toMatchObject({ code: "backpressure" });
    await expect(first).resolves.toMatchObject({
      complete: true,
      requestSequence: 1,
    });
    await expect(provider.render({
      requestSequence: 1,
      engineEpoch: 1,
      recipe: readyRecipe(),
      region: region({ width: 4, height: 4 }),
    })).rejects.toMatchObject({ code: "request-sequence" });
    await expect(provider.render({
      requestSequence: 2,
      engineEpoch: 2,
      recipe: readyRecipe(),
      region: region({ width: 4, height: 4 }),
    })).rejects.toMatchObject({ code: "engine-epoch" });
    expect(provider.advanceEngineEpoch()).toBe(2);
    await expect(provider.render({
      requestSequence: 1,
      engineEpoch: 2,
      recipe: readyRecipe(),
      region: region({ width: 4, height: 4 }),
    })).resolves.toMatchObject({
      requestSequence: 1,
      engineEpoch: 2,
      complete: true,
    });
  });

  it("fails closed when aborted or disposed during a queued operation", async () => {
    const abortedCreation = createStudioProceduralMediaSurfaceProvider();
    expect(abortedCreation.status).toBe("ready");
    if (abortedCreation.status !== "ready") {
      throw new Error(abortedCreation.path);
    }
    const controller = new AbortController();
    controller.abort();
    await expect(abortedCreation.provider.render({
      requestSequence: 1,
      engineEpoch: 1,
      recipe: readyRecipe(),
      region: region(),
      signal: controller.signal,
    })).rejects.toMatchObject({ code: "aborted" });

    const creation = createStudioProceduralMediaSurfaceProvider();
    expect(creation.status).toBe("ready");
    if (creation.status !== "ready") throw new Error(creation.path);
    const pending = creation.provider.render({
      requestSequence: 1,
      engineEpoch: 1,
      recipe: readyRecipe(),
      region: region({ width: 4, height: 4 }),
    });
    expect(creation.provider.snapshot().state).toBe("active");
    creation.provider.dispose();
    await expect(pending).rejects.toMatchObject({ code: "disposed" });
    expect(creation.provider.snapshot().state).toBe("disposed");
    await expect(creation.provider.render({
      requestSequence: 2,
      engineEpoch: 1,
      recipe: readyRecipe(),
      region: region(),
    })).rejects.toMatchObject({ code: "disposed" });
    expect(() => creation.provider.advanceEngineEpoch()).toThrowError(
      expect.objectContaining({ code: "disposed" }),
    );
  });

  it("snapshots mutable request metadata before yielding", async () => {
    const creation = createStudioProceduralMediaSurfaceProvider();
    const baselineCreation =
      createStudioProceduralMediaSurfaceProvider();
    expect(creation.status).toBe("ready");
    expect(baselineCreation.status).toBe("ready");
    if (
      creation.status !== "ready"
      || baselineCreation.status !== "ready"
    ) throw new Error("provider");
    const originalRecipe = readyRecipe({ seed: 91 });
    const mutableRegion = {
      originX: 3,
      originY: -2,
      width: 4,
      height: 3,
      halo: 1,
    };
    const mutableRequest = {
      requestSequence: 1,
      engineEpoch: 1,
      recipe: originalRecipe,
      region: mutableRegion,
    };
    const pending = creation.provider.render(mutableRequest);
    mutableRequest.requestSequence = 999;
    mutableRequest.engineEpoch = 999;
    mutableRequest.recipe = readyRecipe({ seed: 92 });
    mutableRegion.originX = 999;
    mutableRegion.width = 99;
    mutableRequest.region = {
      originX: 100,
      originY: 100,
      width: 1,
      height: 1,
      halo: 0,
    };
    const [receipt, baseline] = await Promise.all([
      pending,
      baselineCreation.provider.render({
        requestSequence: 1,
        engineEpoch: 1,
        recipe: originalRecipe,
        region: {
          originX: 3,
          originY: -2,
          width: 4,
          height: 3,
          halo: 1,
        },
      }),
    ]);
    expect(receipt).toMatchObject({
      requestSequence: 1,
      engineEpoch: 1,
      receiptHash: baseline.receiptHash,
      artifact: {
        receipt: {
          recipeFingerprint: originalRecipe.fingerprint,
          coreOrigin: [3, -2],
          coreSize: [4, 3],
        },
      },
    });
    expect(receipt.artifact.heightField).toEqual(
      baseline.artifact.heightField,
    );
    expect(receipt.artifact.flow).toEqual(baseline.artifact.flow);
  });

  it("claims admission before hostile request getters can reenter", async () => {
    const creation = createStudioProceduralMediaSurfaceProvider();
    expect(creation.status).toBe("ready");
    if (creation.status !== "ready") throw new Error(creation.path);
    const provider = creation.provider;
    let nested:
      | ReturnType<typeof provider.render>
      | null = null;
    let stateDuringGetter = "";
    const hostileRequest = {
      get requestSequence(): number {
        stateDuringGetter = provider.snapshot().state;
        nested = provider.render({
          requestSequence: 99,
          engineEpoch: 1,
          recipe: readyRecipe({ seed: 100 }),
          region: region({ width: 1, height: 1 }),
        });
        return 1;
      },
      engineEpoch: 1,
      recipe: readyRecipe({ seed: 99 }),
      region: region({ width: 2, height: 2 }),
    };
    const completed = provider.render(hostileRequest);
    expect(stateDuringGetter).toBe("active");
    expect(nested).not.toBeNull();
    if (nested === null) throw new Error("nested render not attempted");
    await expect(nested).rejects.toMatchObject({ code: "backpressure" });
    await expect(completed).resolves.toMatchObject({
      requestSequence: 1,
      complete: true,
    });
    await expect(provider.render({
      requestSequence: 2,
      engineEpoch: 1,
      recipe: readyRecipe(),
      region: region({ width: 1, height: 1 }),
    })).resolves.toMatchObject({ requestSequence: 2, complete: true });
  });

  it("rolls provisional admission back after hostile request reflection", async () => {
    const creation = createStudioProceduralMediaSurfaceProvider();
    expect(creation.status).toBe("ready");
    if (creation.status !== "ready") throw new Error(creation.path);
    const provider = creation.provider;
    const hostile = new Proxy({}, {
      ownKeys(): never {
        throw new Error("hostile ownKeys");
      },
    }) as unknown as Parameters<typeof provider.render>[0];
    await expect(provider.render(hostile)).rejects.toMatchObject({
      code: "invalid-request",
    });
    expect(provider.snapshot()).toEqual({
      state: "ready",
      engineEpoch: 1,
      lastRequestSequence: 0,
    });
    await expect(provider.render({
      requestSequence: 1,
      engineEpoch: 1,
      recipe: readyRecipe(),
      region: region({ width: 1, height: 1 }),
    })).resolves.toMatchObject({ requestSequence: 1, complete: true });
  });

  it("rolls back hostile abort listener installation and safely ignores removal failure", async () => {
    const creation = createStudioProceduralMediaSurfaceProvider();
    expect(creation.status).toBe("ready");
    if (creation.status !== "ready") throw new Error(creation.path);
    const provider = creation.provider;
    let failedRemovalCalls = 0;
    const throwingInstallSignal = {
      aborted: false,
      addEventListener(): void {
        throw new Error("hostile add");
      },
      removeEventListener(): void {
        failedRemovalCalls += 1;
        throw new Error("hostile remove");
      },
    } as unknown as AbortSignal;
    await expect(provider.render({
      requestSequence: 1,
      engineEpoch: 1,
      recipe: readyRecipe(),
      region: region(),
      signal: throwingInstallSignal,
    })).rejects.toMatchObject({
      code: "invalid-request",
      path: "$.signal",
    });
    expect(failedRemovalCalls).toBe(1);
    expect(provider.snapshot()).toEqual({
      state: "ready",
      engineEpoch: 1,
      lastRequestSequence: 0,
    });

    let stateDuringRemoval = "";
    const throwingRemoveSignal = {
      aborted: false,
      addEventListener(): void {
        // The test signal never aborts.
      },
      removeEventListener(): void {
        stateDuringRemoval = provider.snapshot().state;
        throw new Error("hostile remove");
      },
    } as unknown as AbortSignal;
    await expect(provider.render({
      requestSequence: 1,
      engineEpoch: 1,
      recipe: readyRecipe(),
      region: region({ width: 2, height: 2 }),
      signal: throwingRemoveSignal,
    })).resolves.toMatchObject({
      requestSequence: 1,
      complete: true,
    });
    expect(stateDuringRemoval).toBe("ready");
    await expect(provider.render({
      requestSequence: 2,
      engineEpoch: 1,
      recipe: readyRecipe(),
      region: region({ width: 2, height: 2 }),
    })).resolves.toMatchObject({
      requestSequence: 2,
      complete: true,
    });
  });

  it("cooperatively aborts mid-computation and recovers for the next sequence", async () => {
    const creation = createStudioProceduralMediaSurfaceProvider();
    expect(creation.status).toBe("ready");
    if (creation.status !== "ready") throw new Error(creation.path);
    const provider = creation.provider;
    const controller = new AbortController();
    const pending = provider.render({
      requestSequence: 1,
      engineEpoch: 1,
      recipe: readyRecipe(),
      region: region({ width: 64, height: 64 }),
      signal: controller.signal,
    });
    expect(provider.snapshot().state).toBe("active");
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    expect(provider.snapshot()).toEqual({
      state: "ready",
      engineEpoch: 1,
      lastRequestSequence: 1,
    });
    await expect(provider.render({
      requestSequence: 2,
      engineEpoch: 1,
      recipe: readyRecipe(),
      region: region({ width: 2, height: 2 }),
    })).resolves.toMatchObject({
      requestSequence: 2,
      complete: true,
    });
  });

  it("observes dispose and epoch changes during cooperative computation", async () => {
    const disposableCreation =
      createStudioProceduralMediaSurfaceProvider();
    expect(disposableCreation.status).toBe("ready");
    if (disposableCreation.status !== "ready") {
      throw new Error(disposableCreation.path);
    }
    const disposable = disposableCreation.provider;
    const disposedPending = disposable.render({
      requestSequence: 1,
      engineEpoch: 1,
      recipe: readyRecipe(),
      region: region({ width: 64, height: 64 }),
    });
    expect(disposable.snapshot().state).toBe("active");
    disposable.dispose();
    await expect(disposedPending).rejects.toMatchObject({
      code: "disposed",
    });
    expect(disposable.snapshot().state).toBe("disposed");

    const epochCreation = createStudioProceduralMediaSurfaceProvider();
    expect(epochCreation.status).toBe("ready");
    if (epochCreation.status !== "ready") {
      throw new Error(epochCreation.path);
    }
    const epochProvider = epochCreation.provider;
    const stalePending = epochProvider.render({
      requestSequence: 1,
      engineEpoch: 1,
      recipe: readyRecipe(),
      region: region({ width: 64, height: 64 }),
    });
    expect(epochProvider.snapshot().state).toBe("active");
    expect(epochProvider.advanceEngineEpoch()).toBe(2);
    await expect(stalePending).rejects.toMatchObject({
      code: "engine-epoch",
    });
    expect(epochProvider.snapshot()).toEqual({
      state: "ready",
      engineEpoch: 2,
      lastRequestSequence: 0,
    });
    await expect(epochProvider.render({
      requestSequence: 1,
      engineEpoch: 2,
      recipe: readyRecipe(),
      region: region({ width: 2, height: 2 }),
    })).resolves.toMatchObject({
      requestSequence: 1,
      engineEpoch: 2,
      complete: true,
    });
  });

  it("keeps cooperative provider bytes equal to the synchronous oracle", async () => {
    const creation = createStudioProceduralMediaSurfaceProvider();
    expect(creation.status).toBe("ready");
    if (creation.status !== "ready") throw new Error(creation.path);
    const recipe = readyRecipe({ seed: 177 });
    const targetRegion = region({ width: 48, height: 48, halo: 1 });
    const expected = renderStudioProceduralMediaSurfaceCpuOracle(
      recipe,
      targetRegion,
    );
    const actual = await creation.provider.render({
      requestSequence: 1,
      engineEpoch: 1,
      recipe,
      region: targetRegion,
    });
    expect(actual.artifact.receipt.artifactHash).toBe(
      expected.receipt.artifactHash,
    );
    expect(actual.artifact.heightField).toEqual(expected.heightField);
    expect(actual.artifact.absorbency).toEqual(expected.absorbency);
    expect(actual.artifact.grain).toEqual(expected.grain);
    expect(actual.artifact.flow).toEqual(expected.flow);
  });

  it("recomputes receipt integrity against exact request coordinates", async () => {
    const creation = createStudioProceduralMediaSurfaceProvider();
    expect(creation.status).toBe("ready");
    if (creation.status !== "ready") throw new Error(creation.path);
    const expectedRequest = {
      requestSequence: 1,
      engineEpoch: 1,
      recipe: readyRecipe({ seed: 211 }),
      region: region({
        originX: 7,
        originY: -4,
        width: 4,
        height: 3,
        halo: 1,
      }),
    };
    const receipt = await creation.provider.render(expectedRequest);
    expect(
      verifyStudioProceduralMediaSurfaceRenderReceiptIntegrity(
        receipt,
        expectedRequest,
      ),
    ).toBe(true);
    expect(
      verifyStudioProceduralMediaSurfaceRenderReceiptIntegrity(
        receipt,
        {
          ...expectedRequest,
          region: { ...expectedRequest.region, originX: 8 },
        },
      ),
    ).toBe(false);
    receipt.artifact.heightField[0] = Math.fround(
      (receipt.artifact.heightField[0] ?? 0) + 0.25,
    );
    expect(
      verifyStudioProceduralMediaSurfaceRenderReceiptIntegrity(
        receipt,
        expectedRequest,
      ),
    ).toBe(false);
  });

  it("observes aborts that arrive during asynchronous final hashing", async () => {
    const nativeCrypto = globalThis.crypto;
    expect(nativeCrypto?.subtle).toBeDefined();
    if (!nativeCrypto?.subtle) return;
    const controller = new AbortController();
    let digestCalls = 0;
    vi.stubGlobal("crypto", {
      subtle: {
        async digest(
          algorithm: AlgorithmIdentifier,
          data: BufferSource,
        ): Promise<ArrayBuffer> {
          digestCalls += 1;
          if (digestCalls === 1) controller.abort();
          return nativeCrypto.subtle.digest(algorithm, data);
        },
      },
    });
    const creation = createStudioProceduralMediaSurfaceProvider();
    expect(creation.status).toBe("ready");
    if (creation.status !== "ready") throw new Error(creation.path);
    await expect(creation.provider.render({
      requestSequence: 1,
      engineEpoch: 1,
      recipe: readyRecipe(),
      region: region({ width: 2, height: 2 }),
      signal: controller.signal,
    })).rejects.toMatchObject({ code: "aborted" });
    expect(digestCalls).toBe(1);
    expect(creation.provider.snapshot()).toEqual({
      state: "ready",
      engineEpoch: 1,
      lastRequestSequence: 1,
    });
  });

  it("rejects invalid provider options", () => {
    expect(createStudioProceduralMediaSurfaceProvider({
      maximumOutputPixels: 0,
    })).toEqual({
      status: "rejected",
      reason: "invalid-options",
      path: "$",
    });
  });
});
