import { describe, expect, it } from "vitest";

import {
  applyStudioWetMediaTileFieldDepositions,
  createStudioWetMediaTileField,
  type StudioWetMediaTileFieldPaper,
  type StudioWetMediaTileFieldSettings,
  type StudioWetMediaTileFieldState,
} from "./studio-wet-media-tile-field";
import {
  advanceStudioWetMediaTwoWellFieldContact,
  sampleStudioWetMediaTileFieldCell,
} from "./studio-wet-media-two-well-field-bridge";
import {
  createStudioWetMediaTwoWellState,
  type StudioWetMediaTwoWellSettings,
} from "./studio-wet-media-two-well-model";

function fieldSettings(
  overrides: Partial<StudioWetMediaTileFieldSettings> = {},
): StudioWetMediaTileFieldSettings {
  return {
    kind: "studio-wet-media-tile-field-settings",
    version: 1,
    model: "fixed-step-anisotropic-paper-v1",
    width: 2,
    height: 1,
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
    dryThreshold: 0.1,
    maxCellWater: 100,
    maxCellPigment: 100,
    ...overrides,
  };
}

function paper(
  settings: StudioWetMediaTileFieldSettings,
  activeMask: readonly number[] = [1, 1],
): StudioWetMediaTileFieldPaper {
  const cells = settings.width * settings.height;
  return {
    kind: "studio-wet-media-tile-field-paper",
    version: 1,
    absorption: new Array<number>(cells).fill(0.5),
    fiberDirectionRadians: new Array<number>(cells).fill(0),
    activeMask,
    cutBoundaryMask: new Array<number>(cells).fill(0),
  };
}

function emptyField(
  settings = fieldSettings(),
  material = paper(settings),
): StudioWetMediaTileFieldState {
  const created = createStudioWetMediaTileField(settings, material);
  if (!created.ok) throw new Error(`${created.reason}:${created.path}`);
  return created.value;
}

function seededField(
  settings = fieldSettings(),
): StudioWetMediaTileFieldState {
  const empty = emptyField(settings);
  const seeded = applyStudioWetMediaTileFieldDepositions(settings, empty, [{
    cellIndex: 0,
    waterMassDelta: 3,
    pigmentMassDelta: 4,
    color: [0.1, 0.3, 0.9, 1],
  }]);
  if (!seeded.ok) throw new Error(`${seeded.reason}:${seeded.path}`);
  return seeded.value.state;
}

function twoWellSettings(
  overrides: Partial<StudioWetMediaTwoWellSettings> = {},
): StudioWetMediaTwoWellSettings {
  return {
    kind: "studio-wet-media-two-well-settings",
    version: 1,
    model: "optical-density-pigment-v1",
    wetness: 0.8,
    load: 0.75,
    mix: 0.5,
    pickupRate: 1.5,
    depositionRate: 0.8,
    reservoirPigmentCapacity: 10,
    reservoirWaterCapacity: 8,
    pickupPigmentCapacity: 6,
    pickupWaterCapacity: 6,
    autoReloadAtStrokeStart: false,
    autoCleanAtStrokeStart: false,
    ...overrides,
  };
}

function brushState(settings = twoWellSettings()) {
  const created = createStudioWetMediaTwoWellState(
    settings,
    [0.8, 0.2, 0.1, 1],
  );
  if (!created.ok) throw new Error(`${created.reason}:${created.path}`);
  return created.value;
}

describe("two-well wet-media tile-field bridge", () => {
  it("samples optical-density pigment, applies pickup and deposition atomically, and conserves mass", () => {
    const model = fieldSettings();
    const field = seededField(model);
    const mixer = twoWellSettings();
    const brush = brushState(mixer);
    const beforeFieldPigment = field.mobilePigmentMass[0]!;
    const beforeFieldWater = field.surfaceWater[0]!;

    const result = advanceStudioWetMediaTwoWellFieldContact({
      settings: mixer,
      brushState: brush,
      fieldSettings: model,
      fieldState: field,
      contact: {
        kind: "studio-wet-media-two-well-field-contact",
        version: 1,
        cellIndex: 0,
        sequence: 1,
        contactMeasure: 1,
        pressure: 0.9,
        flow: 0.85,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sample.color[0]).toBeCloseTo(0.1, 12);
    expect(result.value.sample.color[1]).toBeCloseTo(0.3, 12);
    expect(result.value.sample.color[2]).toBeCloseTo(0.9, 12);
    expect(result.value.receipt.pickedPigmentMass).toBeGreaterThan(0);
    expect(result.value.receipt.depositedPigmentMass).toBeGreaterThan(0);
    expect(result.value.brushState.lastContactSequence).toBe(1);
    expect(result.value.fieldState.mobilePigmentMass[0]).toBeCloseTo(
      beforeFieldPigment + result.value.receipt.canvasPigmentMassDelta,
      12,
    );
    expect(result.value.fieldState.surfaceWater[0]).toBeCloseTo(
      beforeFieldWater + result.value.receipt.canvasWaterMassDelta,
      12,
    );
    expect(result.value.receipt.closedSystemPigmentConservationError)
      .toBeCloseTo(0, 12);
    expect(result.value.receipt.closedSystemWaterConservationError)
      .toBeCloseTo(0, 12);
    expect(result.value.receipt.field.operationCount).toBe(2);

    expect(field.mobilePigmentMass[0]).toBe(beforeFieldPigment);
    expect(field.surfaceWater[0]).toBe(beforeFieldWater);
    expect(brush.lastContactSequence).toBeNull();
  });

  it("recovers a mass-weighted optical-density mixture from the field", () => {
    const model = fieldSettings();
    const empty = emptyField(model);
    const deposited = applyStudioWetMediaTileFieldDepositions(model, empty, [
      {
        cellIndex: 0,
        waterMassDelta: 0,
        pigmentMassDelta: 1,
        color: [0.25, 0.5, 0.75, 1],
      },
      {
        cellIndex: 0,
        waterMassDelta: 0,
        pigmentMassDelta: 3,
        color: [0.81, 0.36, 0.16, 1],
      },
    ]);
    expect(deposited.ok).toBe(true);
    if (!deposited.ok) return;

    const sample = sampleStudioWetMediaTileFieldCell(
      deposited.value.state,
      0,
    );
    expect(sample).not.toBeNull();
    const expected = (left: number, right: number) =>
      Math.exp(-((-Math.log(left)) * 0.25 + (-Math.log(right)) * 0.75));
    expect(sample!.color[0]).toBeCloseTo(expected(0.25, 0.81), 12);
    expect(sample!.color[1]).toBeCloseTo(expected(0.5, 0.36), 12);
    expect(sample!.color[2]).toBeCloseTo(expected(0.75, 0.16), 12);
    expect(sample!.availablePigmentMass).toBe(4);
  });

  it("fails without advancing either immutable state when the field cannot accept the deposit", () => {
    const model = fieldSettings({ maxCellPigment: 1, maxCellWater: 1 });
    const empty = emptyField(model);
    const seeded = applyStudioWetMediaTileFieldDepositions(model, empty, [{
      cellIndex: 0,
      waterMassDelta: 0,
      pigmentMassDelta: 0.8,
      color: [0.2, 0.4, 0.8, 1],
    }]);
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    const field = seeded.value.state;
    const mixer = twoWellSettings({
      wetness: 0,
      load: 0.1,
      mix: 0,
      pickupRate: 0,
      depositionRate: 0.1,
      reservoirPigmentCapacity: 10,
      reservoirWaterCapacity: 8,
    });
    const brush = brushState(mixer);

    const result = advanceStudioWetMediaTwoWellFieldContact({
      settings: mixer,
      brushState: brush,
      fieldSettings: model,
      fieldState: field,
      contact: {
        kind: "studio-wet-media-two-well-field-contact",
        version: 1,
        cellIndex: 0,
        sequence: 1,
        contactMeasure: 10,
        pressure: 1,
        flow: 1,
      },
    });

    expect(result).toMatchObject({
      ok: false,
      stage: "tile-field",
      reason: "mass-budget-exceeded",
    });
    expect(field.mobilePigmentMass[0]).toBeCloseTo(0.8, 12);
    expect(field.surfaceWater[0]).toBe(0);
    expect(brush.lastContactSequence).toBeNull();
    expect(brush.reservoir.pigmentMass).toBe(1);
  });

  it("rejects inactive cells before changing brush contact sequence", () => {
    const model = fieldSettings();
    const field = emptyField(model, paper(model, [1, 0]));
    const mixer = twoWellSettings();
    const brush = brushState(mixer);

    const result = advanceStudioWetMediaTwoWellFieldContact({
      settings: mixer,
      brushState: brush,
      fieldSettings: model,
      fieldState: field,
      contact: {
        kind: "studio-wet-media-two-well-field-contact",
        version: 1,
        cellIndex: 1,
        sequence: 1,
        contactMeasure: 1,
        pressure: 1,
        flow: 1,
      },
    });

    expect(result).toEqual({
      ok: false,
      stage: "bridge",
      reason: "inactive-cell",
      path: "$.contact.cellIndex",
    });
    expect(brush.lastContactSequence).toBeNull();
  });
});
