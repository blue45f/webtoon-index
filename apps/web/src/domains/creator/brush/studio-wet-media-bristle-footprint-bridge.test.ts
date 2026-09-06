import { describe, expect, it } from "vitest";

import {
  advanceStudioWetMediaBristleFootprint,
} from "./studio-wet-media-bristle-footprint-bridge";
import {
  applyStudioWetMediaTileFieldDepositions,
  createStudioWetMediaTileField,
  type StudioWetMediaTileFieldPaper,
  type StudioWetMediaTileFieldSettings,
  type StudioWetMediaTileFieldState,
} from "./studio-wet-media-tile-field";
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
    width: 3,
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
  activeMask: readonly number[] = [1, 1, 1],
): StudioWetMediaTileFieldPaper {
  return {
    kind: "studio-wet-media-tile-field-paper",
    version: 1,
    absorption: new Array<number>(settings.width * settings.height).fill(0.5),
    fiberDirectionRadians: new Array<number>(settings.width * settings.height).fill(0),
    activeMask,
    cutBoundaryMask: new Array<number>(settings.width * settings.height).fill(0),
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

function seededField(settings = fieldSettings()): StudioWetMediaTileFieldState {
  const created = emptyField(settings);
  const deposited = applyStudioWetMediaTileFieldDepositions(settings, created, [
    {
      cellIndex: 0,
      waterMassDelta: 3,
      pigmentMassDelta: 4,
      color: [0.1, 0.3, 0.9, 1],
    },
    {
      cellIndex: 1,
      waterMassDelta: 1,
      pigmentMassDelta: 2,
      color: [0.2, 0.8, 0.3, 1],
    },
  ]);
  if (!deposited.ok) throw new Error(`${deposited.reason}:${deposited.path}`);
  return deposited.value.state;
}

function mixerSettings(
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

function brushState(settings = mixerSettings()) {
  const created = createStudioWetMediaTwoWellState(
    settings,
    [0.8, 0.2, 0.1, 1],
  );
  if (!created.ok) throw new Error(`${created.reason}:${created.path}`);
  return created.value;
}

function contact(cells: readonly { cellIndex: number; coverage: number }[]) {
  return {
    kind: "studio-wet-media-bristle-footprint-contact" as const,
    version: 1 as const,
    firstSequence: 1,
    contactMeasure: 2,
    pressure: 0.9,
    flow: 0.85,
    cells,
  };
}

describe("wet-media bristle footprint bridge", () => {
  it("applies one deterministic batched field transaction for a multi-cell tuft", () => {
    const fieldModel = fieldSettings();
    const field = seededField(fieldModel);
    const mixer = mixerSettings();
    const brush = brushState(mixer);

    const result = advanceStudioWetMediaBristleFootprint({
      settings: mixer,
      brushState: brush,
      fieldSettings: fieldModel,
      fieldState: field,
      contact: contact([
        { cellIndex: 1, coverage: 1 },
        { cellIndex: 0, coverage: 3 },
      ]),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.receipt).toMatchObject({
      ordering: "cell-index-ascending-v1",
      firstSequence: 1,
      lastSequence: 2,
      cellCount: 2,
      totalCoverage: 4,
      requestedContactMeasure: 2,
      appliedContactMeasure: 2,
    });
    expect(result.value.receipt.cells.map((cell) => cell.cellIndex)).toEqual([0, 1]);
    expect(result.value.receipt.cells.map((cell) => cell.sequence)).toEqual([1, 2]);
    expect(result.value.receipt.cells.map((cell) => cell.normalizedCoverage)).toEqual([
      0.75,
      0.25,
    ]);
    expect(result.value.receipt.field.operationCount).toBe(4);
    expect(result.value.receipt.pickedPigmentMass).toBeGreaterThan(0);
    expect(result.value.receipt.depositedPigmentMass).toBeGreaterThan(0);
    expect(result.value.receipt.closedSystemPigmentConservationError).toBeCloseTo(0, 11);
    expect(result.value.receipt.closedSystemWaterConservationError).toBeCloseTo(0, 11);
    expect(result.value.brushState.lastContactSequence).toBe(2);

    expect(field.mobilePigmentMass).toEqual([4, 2, 0]);
    expect(field.surfaceWater).toEqual([3, 1, 0]);
    expect(brush.lastContactSequence).toBeNull();
  });

  it("canonicalizes input ordering so a permuted bristle footprint produces the same state", () => {
    const fieldModel = fieldSettings();
    const field = seededField(fieldModel);
    const mixer = mixerSettings();
    const brush = brushState(mixer);
    const run = (cells: readonly { cellIndex: number; coverage: number }[]) =>
      advanceStudioWetMediaBristleFootprint({
        settings: mixer,
        brushState: brush,
        fieldSettings: fieldModel,
        fieldState: field,
        contact: contact(cells),
      });

    const first = run([
      { cellIndex: 0, coverage: 3 },
      { cellIndex: 1, coverage: 1 },
    ]);
    const second = run([
      { cellIndex: 1, coverage: 1 },
      { cellIndex: 0, coverage: 3 },
    ]);
    expect(first).toEqual(second);
  });

  it("returns no advanced state when any cell is inactive", () => {
    const fieldModel = fieldSettings();
    const field = emptyField(fieldModel, paper(fieldModel, [1, 0, 1]));
    const mixer = mixerSettings();
    const brush = brushState(mixer);

    const result = advanceStudioWetMediaBristleFootprint({
      settings: mixer,
      brushState: brush,
      fieldSettings: fieldModel,
      fieldState: field,
      contact: contact([
        { cellIndex: 0, coverage: 1 },
        { cellIndex: 1, coverage: 1 },
      ]),
    });
    expect(result).toEqual({
      ok: false,
      stage: "bridge",
      reason: "inactive-cell",
      path: "$.contact.cells[1].cellIndex",
      contactIndex: 1,
    });
    expect(field.surfaceWater).toEqual([0, 0, 0]);
    expect(field.mobilePigmentMass).toEqual([0, 0, 0]);
    expect(brush.lastContactSequence).toBeNull();
  });

  it("rejects duplicate cells before advancing the brush", () => {
    const fieldModel = fieldSettings();
    const field = seededField(fieldModel);
    const mixer = mixerSettings();
    const brush = brushState(mixer);

    const result = advanceStudioWetMediaBristleFootprint({
      settings: mixer,
      brushState: brush,
      fieldSettings: fieldModel,
      fieldState: field,
      contact: contact([
        { cellIndex: 0, coverage: 0.5 },
        { cellIndex: 0, coverage: 0.5 },
      ]),
    });
    expect(result).toMatchObject({
      ok: false,
      stage: "bridge",
      reason: "duplicate-cell",
      contactIndex: 1,
    });
    expect(brush.lastContactSequence).toBeNull();
  });

  it("fails atomically when the final batched deposition exceeds field capacity", () => {
    const fieldModel = fieldSettings({ maxCellPigment: 1, maxCellWater: 1 });
    const empty = emptyField(fieldModel);
    const seeded = applyStudioWetMediaTileFieldDepositions(fieldModel, empty, [{
      cellIndex: 0,
      waterMassDelta: 0,
      pigmentMassDelta: 0.95,
      color: [0.2, 0.4, 0.8, 1],
    }]);
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    const field = seeded.value.state;
    const mixer = mixerSettings({
      wetness: 0,
      load: 1,
      mix: 0,
      pickupRate: 0,
      depositionRate: 0.1,
      reservoirPigmentCapacity: 1,
      reservoirWaterCapacity: 0,
    });
    const brush = brushState(mixer);

    const result = advanceStudioWetMediaBristleFootprint({
      settings: mixer,
      brushState: brush,
      fieldSettings: fieldModel,
      fieldState: field,
      contact: contact([{ cellIndex: 0, coverage: 1 }]),
    });
    expect(result).toMatchObject({
      ok: false,
      stage: "tile-field",
      reason: "mass-budget-exceeded",
    });
    expect(field.mobilePigmentMass[0]).toBeCloseTo(0.95, 12);
    expect(brush.lastContactSequence).toBeNull();
    expect(brush.reservoir.pigmentMass).toBe(1);
  });
});
