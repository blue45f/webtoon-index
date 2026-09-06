import { describe, expect, it } from "vitest";

import {
  createStudioSpectralPigmentProvider,
  createStudioSpectralPigmentRecipe,
  mixStudioSpectralPigmentRecipe,
  parseStudioSpectralPigmentRecipe,
  serializeStudioSpectralPigmentRecipe,
  STUDIO_SPECTRAL_PIGMENT_SAMPLE_COUNT,
  StudioSpectralPigmentError,
  type StudioSpectralPigmentInput,
} from "./studio-spectral-pigment-mixing-provider";

function spectrum(
  sample: (wavelengthNm: number) => number,
): number[] {
  return Array.from(
    { length: STUDIO_SPECTRAL_PIGMENT_SAMPLE_COUNT },
    (_, index) => sample(400 + index * 10),
  );
}

const RED = spectrum((wavelength) => wavelength >= 590 ? 0.82 : 0.08);
const BLUE = spectrum((wavelength) => wavelength <= 500 ? 0.78 : 0.07);
const WHITE = spectrum(() => 1);
const GREY = spectrum(() => 0.42);

function recipe(
  pigments: readonly StudioSpectralPigmentInput[] = [
    { id: "red", reflectance: RED, weight: 1 },
    { id: "blue", reflectance: BLUE, weight: 1 },
  ],
  opticalThickness = 64,
) {
  const result = createStudioSpectralPigmentRecipe({
    pigments,
    opticalThickness,
  });
  if (result.status !== "ready") throw new Error(result.path);
  return result.recipe;
}

async function expectCode(
  promise: Promise<unknown>,
  code: StudioSpectralPigmentError["code"],
): Promise<void> {
  try {
    await promise;
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(StudioSpectralPigmentError);
    expect((error as StudioSpectralPigmentError).code).toBe(code);
  }
}

describe("Studio spectral pigment recipe", () => {
  it("copies, freezes, fingerprints and round-trips spectral data", () => {
    const input = [...RED];
    const created = createStudioSpectralPigmentRecipe({
      pigments: [{ id: "r", reflectance: input, weight: 2 }],
      substrateReflectance: GREY,
      opticalThickness: 3,
      illuminant: "equal-energy",
    });
    expect(created.status).toBe("ready");
    if (created.status !== "ready") return;
    input.fill(0);

    expect(created.recipe.pigments[0].reflectance).toEqual(RED);
    expect(Object.isFrozen(created.recipe)).toBe(true);
    expect(Object.isFrozen(created.recipe.pigments)).toBe(true);
    expect(Object.isFrozen(created.recipe.pigments[0].reflectance)).toBe(true);
    expect(created.recipe.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u);

    const serialized = serializeStudioSpectralPigmentRecipe(created.recipe);
    expect(serialized).not.toBeNull();
    expect(parseStudioSpectralPigmentRecipe(serialized))
      .toEqual(created.recipe);
  });

  it("rejects duplicate ids, unknown fields, malformed samples and drift", () => {
    expect(createStudioSpectralPigmentRecipe({
      pigments: [
        { id: "same", reflectance: RED, weight: 1 },
        { id: "same", reflectance: BLUE, weight: 1 },
      ],
    }).status).toBe("rejected");
    expect(createStudioSpectralPigmentRecipe({
      pigments: [{
        id: "bad",
        reflectance: [...RED.slice(0, -1), 2],
        weight: 1,
      }],
    }).status).toBe("rejected");
    expect(createStudioSpectralPigmentRecipe({
      pigments: [{ id: "bad", reflectance: RED, weight: 1, vendor: true }],
    } as never).status).toBe("rejected");

    const valid = recipe();
    expect(parseStudioSpectralPigmentRecipe({
      ...valid,
      fingerprint: `sha256:${"f".repeat(64)}`,
    })).toBeNull();
  });
});

describe("Studio spectral pigment clean-room oracle", () => {
  it("reconstructs a single opaque reflectance curve within f32 precision", () => {
    const value = recipe([
      { id: "grey", reflectance: GREY, weight: 1 },
    ]);
    const mixed = mixStudioSpectralPigmentRecipe(value);
    for (const sample of mixed.artifact.reflectance) {
      expect(sample).toBeCloseTo(0.42, 5);
    }
    expect(mixed.normalizedEffectiveWeights).toEqual([1]);
  });

  it("is order invariant and responds to concentration", () => {
    const first = mixStudioSpectralPigmentRecipe(recipe([
      { id: "red", reflectance: RED, weight: 1, concentration: 2 },
      { id: "blue", reflectance: BLUE, weight: 3 },
    ]));
    const second = mixStudioSpectralPigmentRecipe(recipe([
      { id: "blue", reflectance: BLUE, weight: 3 },
      { id: "red", reflectance: RED, weight: 1, concentration: 2 },
    ]));
    expect([...first.artifact.reflectance])
      .toEqual([...second.artifact.reflectance]);
    expect(first.normalizedEffectiveWeights).toEqual([0.4, 0.6]);
    expect(second.normalizedEffectiveWeights).toEqual([0.6, 0.4]);
  });

  it("produces subtractive darkening rather than an RGB arithmetic average", () => {
    const mixed = mixStudioSpectralPigmentRecipe(recipe()).artifact;
    const redOnly = mixStudioSpectralPigmentRecipe(recipe([
      { id: "red", reflectance: RED, weight: 1 },
    ])).artifact;
    const blueOnly = mixStudioSpectralPigmentRecipe(recipe([
      { id: "blue", reflectance: BLUE, weight: 1 },
    ])).artifact;

    expect(mixed.xyz[1]).toBeLessThan(redOnly.xyz[1]);
    expect(mixed.xyz[1]).toBeLessThan(blueOnly.xyz[1]);
    expect(mixed.reflectanceHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("moves continuously from the substrate toward the opaque mixture", () => {
    const zero = mixStudioSpectralPigmentRecipe(recipe([
      { id: "red", reflectance: RED, weight: 1 },
    ], 0)).artifact;
    const thin = mixStudioSpectralPigmentRecipe(recipe([
      { id: "red", reflectance: RED, weight: 1 },
    ], 0.25)).artifact;
    const opaque = mixStudioSpectralPigmentRecipe(recipe([
      { id: "red", reflectance: RED, weight: 1 },
    ], 64)).artifact;

    expect([...zero.reflectance]).toEqual(WHITE);
    expect(thin.reflectance[0]).toBeGreaterThan(opaque.reflectance[0]);
    expect(thin.reflectance[0]).toBeLessThan(1);
    expect(opaque.reflectance[0]).toBeCloseTo(RED[0], 5);
  });

  it("keeps subnormal optical thickness finite and substrate-continuous", () => {
    const nearlyZero = mixStudioSpectralPigmentRecipe(recipe([
      { id: "red", reflectance: RED, weight: 1 },
    ], 1e-300)).artifact;
    expect([...nearlyZero.reflectance].every(Number.isFinite)).toBe(true);
    expect([...nearlyZero.reflectance]).toEqual(WHITE);
    expect(nearlyZero.sceneLinearRgb.every(Number.isFinite)).toBe(true);
  });

  it("keeps unbounded scene-linear color and a separate clamped preview", () => {
    const mixed = mixStudioSpectralPigmentRecipe(recipe([
      { id: "white", reflectance: WHITE, weight: 1 },
    ])).artifact;
    expect(mixed.sceneLinearRgb.every(Number.isFinite)).toBe(true);
    expect(mixed.displayLinearRgbClamped).toEqual(
      mixed.sceneLinearRgb.map((value) => Math.min(1, Math.max(0, value))),
    );
    expect(mixed.displayLinearRgbClamped.every(
      (value) => value >= 0 && value <= 1,
    )).toBe(true);
  });
});

describe("Studio spectral pigment provider lifecycle", () => {
  it("returns deterministic, explicit clean-room receipts", async () => {
    const created = createStudioSpectralPigmentProvider({
      initialDeviceEpoch: 4,
      maximumPigments: 4,
    });
    expect(created.status).toBe("ready");
    if (created.status !== "ready") return;
    const value = recipe();
    const receipt = await created.provider.mix({
      requestSequence: 1,
      deviceEpoch: 4,
      recipe: value,
    });
    expect(receipt).toMatchObject({
      kind: "studio-spectral-pigment-mix-receipt",
      requestSequence: 1,
      deviceEpoch: 4,
      recipeFingerprint: value.fingerprint,
      model: "kubelka-munk-two-flux-spectral",
      opaqueMixture: "kubelka-munk-k-over-s",
      finiteThickness: "kubelka-munk-two-flux-unit-scattering",
      observer: "cie-1931-2deg-analytic-fit",
      complete: true,
    });
    expect(receipt.receiptHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("fail-closes stale, repeated, over-budget, aborted and disposed work", async () => {
    const created = createStudioSpectralPigmentProvider({
      initialDeviceEpoch: 2,
      maximumPigments: 1,
    });
    if (created.status !== "ready") throw new Error(created.path);
    const controller = new AbortController();
    controller.abort();
    await expectCode(created.provider.mix({
      requestSequence: 0,
      deviceEpoch: 2,
      recipe: recipe([{ id: "red", reflectance: RED, weight: 1 }]),
      signal: controller.signal,
    }), "aborted");
    await expectCode(created.provider.mix({
      requestSequence: 0,
      deviceEpoch: 1,
      recipe: recipe([{ id: "red", reflectance: RED, weight: 1 }]),
    }), "device-epoch");
    await expectCode(created.provider.mix({
      requestSequence: 0,
      deviceEpoch: 2,
      recipe: recipe(),
    }), "budget-exceeded");
    await created.provider.mix({
      requestSequence: 1,
      deviceEpoch: 2,
      recipe: recipe([{ id: "red", reflectance: RED, weight: 1 }]),
    });
    await expectCode(created.provider.mix({
      requestSequence: 1,
      deviceEpoch: 2,
      recipe: recipe([{ id: "red", reflectance: RED, weight: 1 }]),
    }), "request-sequence");
    created.provider.dispose();
    await expectCode(created.provider.mix({
      requestSequence: 2,
      deviceEpoch: 2,
      recipe: recipe([{ id: "red", reflectance: RED, weight: 1 }]),
    }), "disposed");
  });

  it("validates construction budgets and resets sequence on a new epoch", async () => {
    expect(createStudioSpectralPigmentProvider({
      maximumPigments: 0,
    })).toEqual({
      status: "rejected",
      reason: "invalid-options",
      path: "$.maximumPigments",
    });
    const created = createStudioSpectralPigmentProvider({
      initialDeviceEpoch: 0,
      maximumPigments: 2,
    });
    if (created.status !== "ready") throw new Error(created.path);
    const value = recipe();
    await created.provider.mix({
      requestSequence: 5,
      deviceEpoch: 0,
      recipe: value,
    });
    expect(created.provider.advanceDeviceEpoch()).toBe(1);
    await expect(created.provider.mix({
      requestSequence: 0,
      deviceEpoch: 1,
      recipe: value,
    })).resolves.toMatchObject({ requestSequence: 0, deviceEpoch: 1 });
  });
});
