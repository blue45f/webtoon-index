import { describe, expect, it } from "vitest";

import {
  createStudioFiberBristleBrushProvider,
  createStudioFiberBristleBrushRecipe,
  renderStudioFiberBristleBrushCpuOracle,
  STUDIO_FIBER_BRISTLE_DEPOSITION_STRIDE,
  STUDIO_FIBER_BRISTLE_TOPOLOGY_STRIDE,
  StudioFiberBristleBrushError,
  type StudioFiberBristleBrushRecipe,
  type StudioFiberBristleBrushRecipeInput,
  type StudioFiberBristleSampleInput,
} from "./studio-fiber-bristle-brush-provider";

function recipeInput(
  overrides: Partial<StudioFiberBristleBrushRecipeInput> = {},
): StudioFiberBristleBrushRecipeInput {
  return {
    seed: 7,
    bundleShape: "elliptical",
    fiberCount: 8,
    diameter: 8,
    fiberLength: 2,
    stiffness: 0.62,
    stationSpacing: 1,
    baseWidth: 1.5,
    baseOpacity: 0.85,
    baseColor: [0.8, 0.15, 0.05],
    pressureWidth: 1.2,
    pressureSplay: 0.7,
    tiltSplay: 0.8,
    lagMilliseconds: 12,
    bendGain: 0.8,
    maximumBend: 8,
    initialLoad: 1,
    loadVariation: 0.15,
    depletionPerUnit: 0.015,
    velocityOpacity: 0.15,
    paper: {
      scale: 2,
      dropout: 0.1,
    },
    reload: {
      mode: "none",
      intervalDistance: 12,
      amount: 0.5,
    },
    pickup: {
      enabled: true,
      rate: 0.25,
    },
    dirty: {
      color: [0.05, 0.1, 0.8],
      mix: 0.1,
    },
    ...overrides,
  };
}

function readyRecipe(
  overrides: Partial<StudioFiberBristleBrushRecipeInput> = {},
): StudioFiberBristleBrushRecipe {
  const result = createStudioFiberBristleBrushRecipe(recipeInput(overrides));
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error(result.path);
  return result.recipe;
}

function samples(
  overrides: Partial<StudioFiberBristleSampleInput>[] = [],
): StudioFiberBristleSampleInput[] {
  const base: StudioFiberBristleSampleInput[] = [
    {
      x: 0,
      y: 0,
      timeMilliseconds: 0,
      pressure: 0.45,
      tiltRadians: 0,
      azimuthRadians: 0,
    },
    {
      x: 5,
      y: 0,
      timeMilliseconds: 10,
      pressure: 0.7,
      tiltRadians: 0.2,
      azimuthRadians: 0,
    },
    {
      x: 10,
      y: 0,
      timeMilliseconds: 20,
      pressure: 0.9,
      tiltRadians: 0.35,
      azimuthRadians: 0,
    },
  ];
  for (let index = 0; index < overrides.length; index += 1) {
    base[index] = { ...base[index], ...overrides[index] };
  }
  return base;
}

function depositionColumn(
  value: Float32Array,
  column: number,
): number[] {
  const result: number[] = [];
  for (
    let offset = column;
    offset < value.length;
    offset += STUDIO_FIBER_BRISTLE_DEPOSITION_STRIDE
  ) result.push(value[offset] ?? 0);
  return result;
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

describe("Studio individual-fiber bristle brush CPU oracle", () => {
  it("is deterministic for a seed and produces distinct stable bundles for different seeds", () => {
    const first = renderStudioFiberBristleBrushCpuOracle(
      readyRecipe({ seed: 21 }),
      samples(),
    );
    const second = renderStudioFiberBristleBrushCpuOracle(
      readyRecipe({ seed: 21 }),
      samples(),
    );
    const different = renderStudioFiberBristleBrushCpuOracle(
      readyRecipe({ seed: 22 }),
      samples(),
    );

    expect(first.receipt.artifactHash).toBe(second.receipt.artifactHash);
    expect(first.fiberTopology).toEqual(second.fiberTopology);
    expect(first.depositions).toEqual(second.depositions);
    expect(different.receipt.topologyHash).not.toBe(
      first.receipt.topologyHash,
    );
    expect(different.fiberTopology).not.toEqual(first.fiberTopology);
  });

  it("builds elliptical, flat and fan topology with the documented stride", () => {
    const elliptical = renderStudioFiberBristleBrushCpuOracle(
      readyRecipe({ bundleShape: "elliptical", fiberCount: 7 }),
      samples(),
    );
    const flat = renderStudioFiberBristleBrushCpuOracle(
      readyRecipe({ bundleShape: "flat", fiberCount: 7 }),
      samples(),
    );
    const fan = renderStudioFiberBristleBrushCpuOracle(
      readyRecipe({ bundleShape: "fan", fiberCount: 7 }),
      samples(),
    );
    expect(elliptical.fiberTopology).toHaveLength(
      7 * STUDIO_FIBER_BRISTLE_TOPOLOGY_STRIDE,
    );
    expect(flat.fiberTopology).toHaveLength(
      7 * STUDIO_FIBER_BRISTLE_TOPOLOGY_STRIDE,
    );
    expect(fan.fiberTopology).toHaveLength(
      7 * STUDIO_FIBER_BRISTLE_TOPOLOGY_STRIDE,
    );
    const fanAngles = Array.from(
      { length: 7 },
      (_, index) =>
        fan.fiberTopology[
          index * STUDIO_FIBER_BRISTLE_TOPOLOGY_STRIDE + 5
        ] ?? 0,
    );
    const flatAngles = Array.from(
      { length: 7 },
      (_, index) =>
        flat.fiberTopology[
          index * STUDIO_FIBER_BRISTLE_TOPOLOGY_STRIDE + 5
        ] ?? 0,
    );
    expect(Math.max(...fanAngles) - Math.min(...fanAngles)).toBeGreaterThan(
      0.5,
    );
    expect(flatAngles.every((angle) => angle === 0)).toBe(true);
    expect(elliptical.receipt.topologyHash).not.toBe(
      flat.receipt.topologyHash,
    );
  });

  it("responds to pressure, tilt and velocity without unbounded integration", () => {
    const lowPressure = renderStudioFiberBristleBrushCpuOracle(
      readyRecipe({ paper: { scale: 2, dropout: 0 } }),
      samples([
        { pressure: 0.15 },
        { pressure: 0.15 },
        { pressure: 0.15 },
      ]),
    );
    const highPressureTilt = renderStudioFiberBristleBrushCpuOracle(
      readyRecipe({ paper: { scale: 2, dropout: 0 } }),
      samples([
        { pressure: 1, tiltRadians: 1.1, azimuthRadians: Math.PI / 2 },
        { pressure: 1, tiltRadians: 1.1, azimuthRadians: Math.PI / 2 },
        { pressure: 1, tiltRadians: 1.1, azimuthRadians: Math.PI / 2 },
      ]),
    );
    const slow = renderStudioFiberBristleBrushCpuOracle(
      readyRecipe({
        paper: { scale: 2, dropout: 0 },
        velocityOpacity: 1,
      }),
      samples([
        { timeMilliseconds: 0 },
        { timeMilliseconds: 100 },
        { timeMilliseconds: 200 },
      ]),
    );
    const fast = renderStudioFiberBristleBrushCpuOracle(
      readyRecipe({
        paper: { scale: 2, dropout: 0 },
        velocityOpacity: 1,
      }),
      samples([
        { timeMilliseconds: 0 },
        { timeMilliseconds: 2 },
        { timeMilliseconds: 4 },
      ]),
    );
    expect(
      average(depositionColumn(highPressureTilt.depositions, 4)),
    ).toBeGreaterThan(average(depositionColumn(lowPressure.depositions, 4)));
    expect(
      average(depositionColumn(highPressureTilt.depositions, 10)),
    ).toBeGreaterThan(average(depositionColumn(lowPressure.depositions, 10)));
    expect(
      average(depositionColumn(slow.depositions, 5)),
    ).toBeGreaterThan(average(depositionColumn(fast.depositions, 5)));
    expect(
      depositionColumn(fast.depositions, 2).every(Number.isFinite),
    ).toBe(true);
    expect(
      depositionColumn(fast.depositions, 3).every(Number.isFinite),
    ).toBe(true);
  });

  it("depletes paint load and deterministically reloads at distance intervals", () => {
    const dry = renderStudioFiberBristleBrushCpuOracle(
      readyRecipe({
        fiberCount: 4,
        initialLoad: 0.4,
        loadVariation: 0,
        depletionPerUnit: 0.2,
        paper: { scale: 2, dropout: 0 },
        reload: {
          mode: "none",
          intervalDistance: 3,
          amount: 0.7,
        },
      }),
      samples(),
    );
    const reloaded = renderStudioFiberBristleBrushCpuOracle(
      readyRecipe({
        fiberCount: 4,
        initialLoad: 0.4,
        loadVariation: 0,
        depletionPerUnit: 0.2,
        paper: { scale: 2, dropout: 0 },
        reload: {
          mode: "periodic",
          intervalDistance: 3,
          amount: 0.7,
        },
      }),
      samples(),
    );
    expect(Math.max(...dry.finalLoads)).toBeLessThan(0.1);
    expect(average(Array.from(reloaded.finalLoads))).toBeGreaterThan(
      average(Array.from(dry.finalLoads)),
    );
    expect(
      Math.max(...depositionColumn(reloaded.depositions, 5)),
    ).toBeGreaterThan(
      Math.max(
        ...depositionColumn(dry.depositions, 5).slice(
          -dry.receipt.fiberCount * 2,
        ),
      ),
    );
  });

  it("applies deterministic paper-tooth dropout", () => {
    const continuous = renderStudioFiberBristleBrushCpuOracle(
      readyRecipe({ paper: { scale: 1, dropout: 0 } }),
      samples(),
    );
    const dropped = renderStudioFiberBristleBrushCpuOracle(
      readyRecipe({ paper: { scale: 1, dropout: 1 } }),
      samples(),
    );
    expect(continuous.receipt.contactDepositionCount).toBeGreaterThan(0);
    expect(dropped.receipt.contactDepositionCount).toBe(0);
    expect(dropped.receipt.droppedDepositionCount).toBeGreaterThan(0);
    expect(depositionColumn(dropped.depositions, 5).every((v) => v === 0))
      .toBe(true);
  });

  it("mixes caller-supplied pickup color into dirty fibers", () => {
    const noPickup = renderStudioFiberBristleBrushCpuOracle(
      readyRecipe({
        fiberCount: 3,
        dirty: { color: [0, 0, 1], mix: 0.5 },
        pickup: { enabled: false, rate: 1 },
        paper: { scale: 2, dropout: 0 },
      }),
      samples([
        { pickupColor: [0, 1, 0] },
        { pickupColor: [0, 1, 0] },
        { pickupColor: [0, 1, 0] },
      ]),
    );
    const pickup = renderStudioFiberBristleBrushCpuOracle(
      readyRecipe({
        fiberCount: 3,
        dirty: { color: [0, 0, 1], mix: 0.5 },
        pickup: { enabled: true, rate: 1 },
        paper: { scale: 2, dropout: 0 },
      }),
      samples([
        { pickupColor: [0, 1, 0] },
        { pickupColor: [0, 1, 0] },
        { pickupColor: [0, 1, 0] },
      ]),
    );
    const green = Array.from(
      { length: 3 },
      (_, index) => pickup.finalColors[index * 3 + 1] ?? 0,
    );
    const noPickupGreen = Array.from(
      { length: 3 },
      (_, index) => noPickup.finalColors[index * 3 + 1] ?? 0,
    );
    expect(average(green)).toBeGreaterThan(average(noPickupGreen));
    expect(average(green)).toBeGreaterThan(0.9);
  });

  it("preserves the release endpoint and is invariant to duplicate/coalesced events", () => {
    const recipe = readyRecipe({
      paper: { scale: 2, dropout: 0 },
      pickup: { enabled: false, rate: 0 },
    });
    const coalesced = [
      {
        x: 0,
        y: 0,
        timeMilliseconds: 0,
        pressure: 0.5,
        tiltRadians: 0,
        azimuthRadians: 0,
      },
      {
        x: 10,
        y: 0,
        timeMilliseconds: 20,
        pressure: 0.5,
        tiltRadians: 0,
        azimuthRadians: 0,
      },
    ] satisfies StudioFiberBristleSampleInput[];
    const dense = [
      coalesced[0],
      { ...coalesced[0] },
      {
        x: 5,
        y: 0,
        timeMilliseconds: 10,
        pressure: 0.5,
        tiltRadians: 0,
        azimuthRadians: 0,
      },
      coalesced[1],
    ];
    const first = renderStudioFiberBristleBrushCpuOracle(recipe, coalesced);
    const second = renderStudioFiberBristleBrushCpuOracle(recipe, dense);
    expect(first.receipt.endpoint).toEqual([10, 0]);
    expect(second.receipt.endpoint).toEqual([10, 0]);
    expect(second.receipt.stationCount).toBe(first.receipt.stationCount);
    expect(second.fiberTopology).toEqual(first.fiberTopology);
    expect(second.depositions).toEqual(first.depositions);
    expect(second.receipt.replayHash).toBe(first.receipt.replayHash);
    expect(second.receipt.artifactHash).toBe(first.receipt.artifactHash);
  });

  it("isolates recipe, sample and output arrays from caller mutation", () => {
    const baseColor: [number, number, number] = [0.9, 0.2, 0.1];
    const mutableSamples: Array<{
      x: number;
      y: number;
      timeMilliseconds: number;
      pressure: number;
      tiltRadians: number;
      azimuthRadians: number;
      pickupColor?: readonly [number, number, number];
    }> = samples().map((sample) => ({ ...sample }));
    const recipe = readyRecipe({ baseColor });
    baseColor[0] = 0;
    const artifact = renderStudioFiberBristleBrushCpuOracle(
      recipe,
      mutableSamples,
    );
    const originalHash = artifact.receipt.artifactHash;
    mutableSamples[1].x = 999;
    mutableSamples[1].pressure = 0;
    expect(recipe.baseColor[0]).toBe(0.9);
    expect(artifact.receipt.artifactHash).toBe(originalHash);
    expect(artifact.receipt.endpoint).toEqual([10, 0]);

    const repeated = renderStudioFiberBristleBrushCpuOracle(
      recipe,
      samples(),
    );
    artifact.depositions[0] = 999;
    expect(repeated.depositions[0]).not.toBe(999);
    expect(repeated.receipt.artifactHash).toBe(originalHash);
  });

  it("fails closed for malformed, nonfinite, aborted and over-budget requests", () => {
    const recipe = readyRecipe();
    expect(() =>
      renderStudioFiberBristleBrushCpuOracle(recipe, [
        { ...samples()[0], x: Number.NaN },
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<StudioFiberBristleBrushError>>({
        code: "invalid-samples",
      }),
    );
    expect(() =>
      renderStudioFiberBristleBrushCpuOracle(recipe, samples(), {
        maximumFibers: 2,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<StudioFiberBristleBrushError>>({
        code: "budget-exceeded",
      }),
    );
    expect(() =>
      renderStudioFiberBristleBrushCpuOracle(recipe, samples(), {
        maximumResidentBytes: 32,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<StudioFiberBristleBrushError>>({
        code: "budget-exceeded",
      }),
    );
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      renderStudioFiberBristleBrushCpuOracle(recipe, samples(), {
        signal: controller.signal,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<StudioFiberBristleBrushError>>({
        code: "aborted",
      }),
    );
    expect(
      createStudioFiberBristleBrushRecipe(
        recipeInput({ fiberCount: Number.NaN }),
      ),
    ).toEqual({
      status: "rejected",
      reason: "invalid-recipe",
      path: "$",
    });
  });
});

describe("Studio individual-fiber bristle brush provider lifecycle", () => {
  it("owns admission before request getters and rechecks disposal before commit", async () => {
    const creation = createStudioFiberBristleBrushProvider();
    if (creation.status !== "ready") throw new Error(creation.path);
    const provider = creation.provider;
    const recipe = readyRecipe();
    const hostile = {
      requestSequence: 1,
      engineEpoch: 1,
      strokeId: "hostile",
      operation: "replace" as const,
      get recipe() {
        provider.dispose();
        return recipe;
      },
      samples: samples(),
    };
    await expect(provider.render(hostile)).rejects.toMatchObject({
      code: "disposed",
    });
    expect(provider.snapshot()).toMatchObject({
      state: "disposed",
      lastRequestSequence: 0,
      activeStrokeCount: 0,
    });
  });

  it("makes append rendering exactly equal to a full rebuild", async () => {
    const recipe = readyRecipe({
      paper: { scale: 2, dropout: 0 },
    });
    const appendCreation = createStudioFiberBristleBrushProvider();
    const rebuildCreation = createStudioFiberBristleBrushProvider();
    expect(appendCreation.status).toBe("ready");
    expect(rebuildCreation.status).toBe("ready");
    if (
      appendCreation.status !== "ready"
      || rebuildCreation.status !== "ready"
    ) throw new Error("provider creation failed");

    await appendCreation.provider.render({
      requestSequence: 1,
      engineEpoch: 1,
      strokeId: "stroke",
      operation: "replace",
      recipe,
      samples: samples().slice(0, 2),
    });
    const appended = await appendCreation.provider.render({
      requestSequence: 2,
      engineEpoch: 1,
      strokeId: "stroke",
      operation: "append",
      recipe,
      samples: samples().slice(2),
    });
    const rebuilt = await rebuildCreation.provider.render({
      requestSequence: 1,
      engineEpoch: 1,
      strokeId: "stroke",
      operation: "replace",
      recipe,
      samples: samples(),
    });
    expect(appended.artifact.fiberTopology).toEqual(
      rebuilt.artifact.fiberTopology,
    );
    expect(appended.artifact.depositions).toEqual(
      rebuilt.artifact.depositions,
    );
    expect(appended.artifact.receipt.artifactHash).toBe(
      rebuilt.artifact.receipt.artifactHash,
    );
  });

  it("keeps append/rebuild parity when a boundary sample is replaced", async () => {
    const recipe = readyRecipe({ paper: { scale: 2, dropout: 0 } });
    const appendedCreation = createStudioFiberBristleBrushProvider();
    const rebuiltCreation = createStudioFiberBristleBrushProvider();
    if (
      appendedCreation.status !== "ready"
      || rebuiltCreation.status !== "ready"
    ) throw new Error("provider creation failed");
    const base = samples();
    const replacement = {
      ...base[1]!,
      timeMilliseconds: 11,
      pressure: 0.8,
    };
    await appendedCreation.provider.render({
      requestSequence: 1,
      engineEpoch: 1,
      strokeId: "boundary",
      operation: "replace",
      recipe,
      samples: base.slice(0, 2),
    });
    const appended = await appendedCreation.provider.render({
      requestSequence: 2,
      engineEpoch: 1,
      strokeId: "boundary",
      operation: "append",
      recipe,
      samples: [replacement, base[2]!],
    });
    const rebuilt = await rebuiltCreation.provider.render({
      requestSequence: 1,
      engineEpoch: 1,
      strokeId: "boundary",
      operation: "replace",
      recipe,
      samples: [base[0]!, base[1]!, replacement, base[2]!],
    });
    expect(appended.artifact.depositions).toEqual(
      rebuilt.artifact.depositions,
    );
    expect(appended.artifact.receipt.artifactHash).toBe(
      rebuilt.artifact.receipt.artifactHash,
    );
  });

  it("enforces sequence, epoch, missing-stroke, release and disposal boundaries", async () => {
    const creation = createStudioFiberBristleBrushProvider({
      maximumActiveStrokes: 1,
      maximumRetainedSamples: 8,
    });
    expect(creation.status).toBe("ready");
    if (creation.status !== "ready") throw new Error(creation.path);
    const provider = creation.provider;
    const recipe = readyRecipe();
    await expect(provider.render({
      requestSequence: 1,
      engineEpoch: 1,
      strokeId: "missing",
      operation: "append",
      recipe,
      samples: samples().slice(2),
    })).rejects.toMatchObject({ code: "missing-stroke" });
    await provider.render({
      requestSequence: 1,
      engineEpoch: 1,
      strokeId: "one",
      operation: "replace",
      recipe,
      samples: samples(),
    });
    await expect(provider.render({
      requestSequence: 1,
      engineEpoch: 1,
      strokeId: "one",
      operation: "replace",
      recipe,
      samples: samples(),
    })).rejects.toMatchObject({ code: "request-sequence" });
    await expect(provider.render({
      requestSequence: 2,
      engineEpoch: 2,
      strokeId: "one",
      operation: "replace",
      recipe,
      samples: samples(),
    })).rejects.toMatchObject({ code: "engine-epoch" });
    await expect(provider.render({
      requestSequence: 2,
      engineEpoch: 1,
      strokeId: "two",
      operation: "replace",
      recipe,
      samples: samples(),
    })).rejects.toMatchObject({ code: "budget-exceeded" });
    expect(provider.releaseStroke("one")).toBe(true);
    expect(provider.snapshot()).toMatchObject({
      state: "ready",
      activeStrokeCount: 0,
      retainedSampleCount: 0,
    });
    expect(provider.advanceEngineEpoch()).toBe(2);
    provider.dispose();
    expect(provider.snapshot().state).toBe("disposed");
    expect(provider.releaseStroke("one")).toBe(false);
    await expect(provider.render({
      requestSequence: 1,
      engineEpoch: 2,
      strokeId: "one",
      operation: "replace",
      recipe,
      samples: samples(),
    })).rejects.toMatchObject({ code: "disposed" });
  });

  it("rejects invalid provider options and recipe changes during append", async () => {
    expect(
      createStudioFiberBristleBrushProvider({ maximumFibers: 0 }),
    ).toEqual({
      status: "rejected",
      reason: "invalid-options",
      path: "$",
    });
    const creation = createStudioFiberBristleBrushProvider();
    expect(creation.status).toBe("ready");
    if (creation.status !== "ready") throw new Error(creation.path);
    await creation.provider.render({
      requestSequence: 1,
      engineEpoch: 1,
      strokeId: "recipe-lock",
      operation: "replace",
      recipe: readyRecipe({ seed: 1 }),
      samples: samples().slice(0, 2),
    });
    await expect(creation.provider.render({
      requestSequence: 2,
      engineEpoch: 1,
      strokeId: "recipe-lock",
      operation: "append",
      recipe: readyRecipe({ seed: 2 }),
      samples: samples().slice(2),
    })).rejects.toMatchObject({ code: "recipe-mismatch" });
  });
});
