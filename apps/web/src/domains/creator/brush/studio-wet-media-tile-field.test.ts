import { describe, expect, it } from "vitest";

import {
  advanceStudioWetMediaTileField,
  applyStudioWetMediaTileFieldDepositions,
  createStudioWetMediaTileField,
  parseStudioWetMediaTileFieldSettings,
  parseStudioWetMediaTileFieldState,
  STUDIO_WET_MEDIA_CUT,
  STUDIO_WET_MEDIA_TILE_FIELD_LIMITS,
  type StudioWetMediaTileFieldPaper,
  type StudioWetMediaTileFieldSettings,
  type StudioWetMediaTileFieldState,
} from "./studio-wet-media-tile-field";

function settings(
  overrides: Partial<StudioWetMediaTileFieldSettings> = {},
): StudioWetMediaTileFieldSettings {
  return {
    kind: "studio-wet-media-tile-field-settings",
    version: 1,
    model: "fixed-step-anisotropic-paper-v1",
    width: 3,
    height: 3,
    waterDiffusionRate: 0.2,
    pigmentDiffusionRate: 0.15,
    anisotropy: 0,
    absorptionRate: 0.1,
    surfaceEvaporationRate: 0.02,
    paperEvaporationRate: 0.005,
    fixationRate: 0.2,
    edgePoolingRate: 0,
    rewetRate: 0.35,
    backrunRate: 0,
    rewetEnergyDecay: 0.25,
    dryThreshold: 1,
    maxCellWater: 100,
    maxCellPigment: 100,
    ...overrides,
  };
}

function paper(
  model: StudioWetMediaTileFieldSettings,
  overrides: Partial<StudioWetMediaTileFieldPaper> = {},
): StudioWetMediaTileFieldPaper {
  const cells = model.width * model.height;
  return {
    kind: "studio-wet-media-tile-field-paper",
    version: 1,
    absorption: new Array<number>(cells).fill(0.5),
    fiberDirectionRadians: new Array<number>(cells).fill(0),
    activeMask: new Array<number>(cells).fill(1),
    cutBoundaryMask: new Array<number>(cells).fill(0),
    ...overrides,
  };
}

function create(
  model: StudioWetMediaTileFieldSettings = settings(),
  material: StudioWetMediaTileFieldPaper = paper(model),
): StudioWetMediaTileFieldState {
  const result = createStudioWetMediaTileField(model, material);
  if (!result.ok) throw new Error(`${result.reason}:${result.path}`);
  return result.value;
}

function deposit(
  model: StudioWetMediaTileFieldSettings,
  state: StudioWetMediaTileFieldState,
  cellIndex: number,
  waterMassDelta: number,
  pigmentMassDelta: number,
  color: readonly [number, number, number, number] = [0.2, 0.4, 0.8, 1],
) {
  return applyStudioWetMediaTileFieldDepositions(model, state, [{
    cellIndex,
    waterMassDelta,
    pigmentMassDelta,
    color,
  }]);
}

function advance(
  model: StudioWetMediaTileFieldSettings,
  state: StudioWetMediaTileFieldState,
  ticks: number,
): StudioWetMediaTileFieldState {
  const result = advanceStudioWetMediaTileField(model, state, ticks);
  if (!result.ok) throw new Error(`${result.reason}:${result.path}`);
  return result.value.state;
}

describe("studio wet-media tile field", () => {
  it("copies and freezes every public field while isolating later input mutations", () => {
    const model = settings();
    const material = paper(model);
    const originalAbsorption = material.absorption[0];
    const result = createStudioWetMediaTileField(model, material);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    (material.absorption as number[])[0] = 0;
    (material.activeMask as number[])[1] = 0;
    expect(result.value.absorption[0]).toBe(originalAbsorption);
    expect(result.value.activeMask[1]).toBe(1);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.surfaceWater)).toBe(true);
    expect(Object.isFrozen(result.value.mobilePigmentOpticalDensity)).toBe(true);
    expect(Object.isFrozen(result.value.mobilePigmentOpticalDensity[0])).toBe(true);

    const operations = [{
      cellIndex: 4,
      waterMassDelta: 2,
      pigmentMassDelta: 1,
      color: [0.1, 0.2, 0.3, 1],
    }];
    const deposited = applyStudioWetMediaTileFieldDepositions(
      model,
      result.value,
      operations,
    );
    expect(deposited.ok).toBe(true);
    if (!deposited.ok) return;
    operations[0]!.waterMassDelta = 99;
    operations[0]!.color[0] = 1;
    expect(deposited.value.state.surfaceWater[4]).toBe(2);
    expect(deposited.value.state.mobilePigmentOpticalDensity[0][4])
      .toBeCloseTo(-Math.log(0.1), 12);
  });

  it("never invokes accessors and rejects unknown or non-data fields", () => {
    let getterCalls = 0;
    const hostile = { ...settings() };
    Object.defineProperty(hostile, "anisotropy", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 0.5;
      },
    });
    expect(parseStudioWetMediaTileFieldSettings(hostile)).toEqual({
      ok: false,
      reason: "invalid-field",
      path: "$.anisotropy",
    });
    expect(parseStudioWetMediaTileFieldSettings({
      ...settings(),
      vendorPresetId: "not-part-of-the-model",
    })).toEqual({
      ok: false,
      reason: "unknown-field",
      path: "$.vendorPresetId",
    });
    expect(getterCalls).toBe(0);
  });

  it("is bit-for-bit deterministic for the same fixed-tick inputs", () => {
    const model = settings({
      anisotropy: 0.7,
      edgePoolingRate: 0.08,
      backrunRate: 0.12,
    });
    const initial = create(model);
    const seeded = applyStudioWetMediaTileFieldDepositions(model, initial, [
      {
        cellIndex: 4,
        waterMassDelta: 12,
        pigmentMassDelta: 5,
        color: [0.15, 0.45, 0.8, 1],
      },
      {
        cellIndex: 1,
        waterMassDelta: 3,
        pigmentMassDelta: 2,
        color: [0.8, 0.25, 0.1, 1],
      },
    ]);
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;

    const first = advanceStudioWetMediaTileField(model, seeded.value.state, 12);
    const second = advanceStudioWetMediaTileField(model, seeded.value.state, 12);
    expect(first).toEqual(second);
  });

  it("keeps water, pigment, and optical density isolated across a cut boundary", () => {
    const model = settings({
      width: 3,
      height: 1,
      absorptionRate: 0,
      surfaceEvaporationRate: 0,
      paperEvaporationRate: 0,
      fixationRate: 0,
      rewetRate: 0,
      rewetEnergyDecay: 1,
    });
    const material = paper(model, {
      cutBoundaryMask: [
        STUDIO_WET_MEDIA_CUT.east,
        STUDIO_WET_MEDIA_CUT.west,
        0,
      ],
    });
    const initial = create(model, material);
    const seeded = deposit(model, initial, 0, 10, 4);
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    const evolved = advance(model, seeded.value.state, 20);

    expect(evolved.surfaceWater[0]).toBe(10);
    expect(evolved.surfaceWater[1]).toBe(0);
    expect(evolved.surfaceWater[2]).toBe(0);
    expect(evolved.mobilePigmentMass[1]).toBe(0);
    expect(evolved.mobilePigmentOpticalDensity[0][1]).toBe(0);
  });

  it("reports external deposition and tick evaporation without internal mass leakage", () => {
    const model = settings({
      edgePoolingRate: 0.1,
      backrunRate: 0.1,
      anisotropy: 0.6,
    });
    const initial = create(model);
    const seeded = applyStudioWetMediaTileFieldDepositions(model, initial, [
      {
        cellIndex: 4,
        waterMassDelta: 8,
        pigmentMassDelta: 4,
        color: [0.12, 0.3, 0.75, 1],
      },
      {
        cellIndex: 4,
        waterMassDelta: -1,
        pigmentMassDelta: -0.5,
        color: [0, 0, 0, 0],
      },
    ]);
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    expect(Math.abs(seeded.value.receipt.waterConservationError)).toBeLessThan(1e-12);
    expect(Math.abs(seeded.value.receipt.pigmentConservationError)).toBeLessThan(1e-12);
    for (const error of seeded.value.receipt.opticalDensityConservationError) {
      expect(Math.abs(error)).toBeLessThan(1e-12);
    }

    const evolved = advanceStudioWetMediaTileField(model, seeded.value.state, 24);
    expect(evolved.ok).toBe(true);
    if (!evolved.ok) return;
    expect(evolved.value.receipt.waterEvaporated).toBeGreaterThan(0);
    expect(evolved.value.receipt.edgePooledWater).toBeGreaterThan(0);
    expect(evolved.value.receipt.edgePooledPigment).toBeGreaterThan(0);
    expect(Math.abs(evolved.value.receipt.waterConservationError)).toBeLessThan(1e-10);
    expect(Math.abs(evolved.value.receipt.pigmentConservationError)).toBeLessThan(1e-10);
    for (const error of evolved.value.receipt.opticalDensityConservationError) {
      expect(Math.abs(error)).toBeLessThan(1e-10);
    }
  });

  it("moves a wet mark farther along the fibre axis than across it", () => {
    const model = settings({
      waterDiffusionRate: 0.2,
      pigmentDiffusionRate: 0.2,
      anisotropy: 0.9,
      absorptionRate: 0,
      surfaceEvaporationRate: 0,
      paperEvaporationRate: 0,
      fixationRate: 0,
      rewetRate: 0,
      backrunRate: 0,
      rewetEnergyDecay: 1,
    });
    const initial = create(model, paper(model, {
      fiberDirectionRadians: new Array<number>(9).fill(0),
    }));
    const seeded = deposit(model, initial, 4, 10, 6);
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    const evolved = advance(model, seeded.value.state, 2);
    const horizontalWater = evolved.surfaceWater[3]! + evolved.surfaceWater[5]!;
    const verticalWater = evolved.surfaceWater[1]! + evolved.surfaceWater[7]!;
    const horizontalPigment =
      evolved.mobilePigmentMass[3]! + evolved.mobilePigmentMass[5]!;
    const verticalPigment =
      evolved.mobilePigmentMass[1]! + evolved.mobilePigmentMass[7]!;

    expect(horizontalWater).toBeGreaterThan(verticalWater);
    expect(horizontalPigment).toBeGreaterThan(verticalPigment);
  });

  it("absorbs water into paper and fixes pigment as the surface dries", () => {
    const model = settings({
      width: 1,
      height: 1,
      waterDiffusionRate: 0,
      pigmentDiffusionRate: 0,
      absorptionRate: 0.6,
      surfaceEvaporationRate: 0.5,
      paperEvaporationRate: 0.1,
      fixationRate: 0.8,
      rewetRate: 0,
      rewetEnergyDecay: 1,
      dryThreshold: 2,
    });
    const initial = create(model);
    const seeded = deposit(model, initial, 0, 2, 5);
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    const evolved = advanceStudioWetMediaTileField(model, seeded.value.state, 8);
    expect(evolved.ok).toBe(true);
    if (!evolved.ok) return;

    expect(evolved.value.state.absorbedPaperWater[0]).toBeGreaterThan(0);
    expect(evolved.value.state.surfaceWater[0]).toBeLessThan(0.01);
    expect(evolved.value.state.fixedPigmentMass[0]).toBeGreaterThan(4);
    expect(evolved.value.receipt.pigmentFixed).toBeGreaterThan(0);
  });

  it("rewets fixed pigment and produces a conservative outward backrun", () => {
    const model = settings({
      width: 3,
      height: 1,
      waterDiffusionRate: 0,
      pigmentDiffusionRate: 0,
      absorptionRate: 0,
      surfaceEvaporationRate: 0,
      paperEvaporationRate: 0,
      fixationRate: 1,
      rewetRate: 1,
      backrunRate: 0.2,
      rewetEnergyDecay: 0.1,
      dryThreshold: 1,
    });
    const initial = create(model);
    const dryPigment = deposit(model, initial, 1, 0, 6);
    expect(dryPigment.ok).toBe(true);
    if (!dryPigment.ok) return;
    const fixed = advance(model, dryPigment.value.state, 1);
    expect(fixed.fixedPigmentMass[1]).toBe(6);

    const rewetted = deposit(model, fixed, 1, 8, 0);
    expect(rewetted.ok).toBe(true);
    if (!rewetted.ok) return;
    const evolved = advanceStudioWetMediaTileField(model, rewetted.value.state, 2);
    expect(evolved.ok).toBe(true);
    if (!evolved.ok) return;

    expect(evolved.value.receipt.pigmentReactivated).toBeGreaterThan(0);
    expect(evolved.value.receipt.backrunWaterMoved).toBeGreaterThan(0);
    expect(evolved.value.state.surfaceWater[0]! + evolved.value.state.surfaceWater[2]!)
      .toBeGreaterThan(0);
    expect(Math.abs(evolved.value.receipt.waterConservationError)).toBeLessThan(1e-12);
    expect(Math.abs(evolved.value.receipt.pigmentConservationError)).toBeLessThan(1e-12);
  });

  it("defines subdivision by exact fixed ticks: two ticks equal two one-tick calls", () => {
    const model = settings({
      anisotropy: 0.5,
      edgePoolingRate: 0.05,
      backrunRate: 0.1,
    });
    const initial = create(model);
    const seeded = deposit(model, initial, 4, 9, 4);
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;

    const combined = advanceStudioWetMediaTileField(model, seeded.value.state, 2);
    const first = advanceStudioWetMediaTileField(model, seeded.value.state, 1);
    expect(combined.ok).toBe(true);
    expect(first.ok).toBe(true);
    if (!combined.ok || !first.ok) return;
    const second = advanceStudioWetMediaTileField(model, first.value.state, 1);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.state).toEqual(combined.value.state);
  });

  it("fails closed for inactive cells, unavailable pickup mass, and all public budgets", () => {
    const model = settings();
    const inactive = create(model, paper(model, {
      activeMask: [1, 1, 1, 1, 0, 1, 1, 1, 1],
    }));
    expect(deposit(model, inactive, 4, 1, 1)).toEqual({
      ok: false,
      reason: "invalid-field",
      path: "$.depositions[0].cellIndex",
    });

    const empty = create(model);
    expect(deposit(model, empty, 4, -1, 0)).toEqual({
      ok: false,
      reason: "insufficient-mobile-mass",
      path: "$.depositions[0].waterMassDelta",
    });
    expect(deposit(model, empty, 4, 0, -1)).toEqual({
      ok: false,
      reason: "insufficient-mobile-mass",
      path: "$.depositions[0].pigmentMassDelta",
    });
    expect(advanceStudioWetMediaTileField(
      model,
      empty,
      STUDIO_WET_MEDIA_TILE_FIELD_LIMITS.maxTicksPerAdvance + 1,
    )).toEqual({
      ok: false,
      reason: "tick-budget-exceeded",
      path: "$.fixedTicks",
    });
    expect(applyStudioWetMediaTileFieldDepositions(
      model,
      empty,
      new Array(STUDIO_WET_MEDIA_TILE_FIELD_LIMITS.maxDepositionOperations + 1),
    )).toEqual({
      ok: false,
      reason: "mass-budget-exceeded",
      path: "$.depositions.length",
    });
    expect(parseStudioWetMediaTileFieldSettings(settings({
      width: STUDIO_WET_MEDIA_TILE_FIELD_LIMITS.maxWidth,
      height: STUDIO_WET_MEDIA_TILE_FIELD_LIMITS.maxHeight,
    }))).toEqual({
      ok: false,
      reason: "cell-budget-exceeded",
      path: "$.width",
    });
  });

  it("rejects dimension drift and combined mobile/fixed pigment budget violations", () => {
    const model = settings();
    const state = create(model);
    expect(parseStudioWetMediaTileFieldState({
      ...state,
      width: 4,
    }, model)).toEqual({
      ok: false,
      reason: "dimension-mismatch",
      path: "$.width",
    });
    expect(parseStudioWetMediaTileFieldState({
      ...state,
      mobilePigmentMass: state.mobilePigmentMass.map((value, index) =>
        index === 0 ? model.maxCellPigment : value),
      fixedPigmentMass: state.fixedPigmentMass.map((value, index) =>
        index === 0 ? 1 : value),
    }, model)).toEqual({
      ok: false,
      reason: "mass-budget-exceeded",
      path: "$.mobilePigmentMass[0]",
    });
    expect(parseStudioWetMediaTileFieldState({
      ...state,
      mobilePigmentOpticalDensity: [
        state.mobilePigmentOpticalDensity[0].map((value, index) =>
          index === 0 ? 1 : value),
        state.mobilePigmentOpticalDensity[1],
        state.mobilePigmentOpticalDensity[2],
      ],
    }, model)).toEqual({
      ok: false,
      reason: "invalid-field",
      path: "$.mobilePigmentOpticalDensity[0][0]",
    });
  });

  it("keeps every transported cell below its configured water and pigment budgets", () => {
    const model = settings({
      maxCellWater: 4,
      maxCellPigment: 3,
      dryThreshold: 1,
      anisotropy: 0.95,
      edgePoolingRate: 0.25,
      backrunRate: 0.25,
      absorptionRate: 0,
      surfaceEvaporationRate: 0,
      paperEvaporationRate: 0,
      fixationRate: 0,
      rewetRate: 0,
      rewetEnergyDecay: 0,
    });
    let state = create(model);
    const seeded = applyStudioWetMediaTileFieldDepositions(model, state, [
      {
        cellIndex: 1,
        waterMassDelta: 4,
        pigmentMassDelta: 3,
        color: [0.1, 0.3, 0.8, 1],
      },
      {
        cellIndex: 3,
        waterMassDelta: 4,
        pigmentMassDelta: 3,
        color: [0.7, 0.2, 0.1, 1],
      },
      {
        cellIndex: 5,
        waterMassDelta: 4,
        pigmentMassDelta: 3,
        color: [0.2, 0.8, 0.25, 1],
      },
      {
        cellIndex: 7,
        waterMassDelta: 4,
        pigmentMassDelta: 3,
        color: [0.6, 0.2, 0.7, 1],
      },
    ]);
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    state = advance(model, seeded.value.state, 32);

    for (let index = 0; index < state.surfaceWater.length; index += 1) {
      expect(state.surfaceWater[index]).toBeLessThanOrEqual(model.maxCellWater);
      expect(
        state.mobilePigmentMass[index]! + state.fixedPigmentMass[index]!,
      ).toBeLessThanOrEqual(model.maxCellPigment);
      expect(state.rewetEnergy[index]).toBeLessThanOrEqual(model.maxCellWater);
    }
  });
});
