import { describe, expect, it } from "vitest";

import {
  advanceStudioWetMediaTwoWellContact,
  beginStudioWetMediaStroke,
  createStudioWetMediaTwoWellState,
  parseStudioWetMediaTwoWellSettings,
  parseStudioWetMediaTwoWellState,
  type StudioWetMediaTwoWellSettings,
  type StudioWetMediaTwoWellState,
} from "./studio-wet-media-two-well-model";

function settings(
  overrides: Partial<StudioWetMediaTwoWellSettings> = {},
): StudioWetMediaTwoWellSettings {
  return {
    kind: "studio-wet-media-two-well-settings",
    version: 1,
    model: "optical-density-pigment-v1",
    wetness: 0.8,
    load: 0.75,
    mix: 0,
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

function createState(
  overrides: Partial<StudioWetMediaTwoWellSettings> = {},
  color: readonly [number, number, number, number] = [0.8, 0.2, 0.1, 1],
): StudioWetMediaTwoWellState {
  const result = createStudioWetMediaTwoWellState(settings(overrides), color);
  if (!result.ok) throw new Error(`${result.reason}:${result.path}`);
  return result.value;
}

function contact(
  overrides: Partial<{
    sequence: number;
    contactMeasure: number;
    pressure: number;
    flow: number;
    canvas: {
      color: readonly [number, number, number, number];
      availablePigmentMass: number;
      availableWaterMass: number;
    };
  }> = {},
) {
  return {
    sequence: 0,
    contactMeasure: 1,
    pressure: 1,
    flow: 1,
    canvas: {
      color: [0.1, 0.3, 0.9, 1] as const,
      availablePigmentMass: 4,
      availableWaterMass: 3,
    },
    ...overrides,
  };
}

describe("studio wet-media two-well model", () => {
  it("strictly canonicalizes settings and freezes every returned state branch", () => {
    const parsed = parseStudioWetMediaTwoWellSettings(settings());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(Object.isFrozen(parsed.value)).toBe(true);

    const state = createState();
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.reservoir)).toBe(true);
    expect(Object.isFrozen(state.reservoir.color)).toBe(true);
    expect(state.reservoir.pigmentMass).toBe(7.5);
    expect(state.reservoir.waterMass).toBe(6.4);
  });

  it("never invokes accessors while rejecting hostile settings, state, and color input", () => {
    let getterCalls = 0;
    const hostile = { ...settings() };
    Object.defineProperty(hostile, "mix", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 0.5;
      },
    });
    expect(parseStudioWetMediaTwoWellSettings(hostile)).toEqual({
      ok: false,
      reason: "invalid-field",
      path: "$.mix",
    });

    const color: unknown[] = [0, 0, 0, 1];
    Object.defineProperty(color, "0", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 1;
      },
    });
    expect(createStudioWetMediaTwoWellState(settings(), color)).toEqual({
      ok: false,
      reason: "invalid-field",
      path: "$.loadedColor[0]",
    });
    expect(getterCalls).toBe(0);
  });

  it("auto reloads and cleans at the stroke boundary without mutating the prior state", () => {
    const baseSettings = settings({
      autoReloadAtStrokeStart: true,
      autoCleanAtStrokeStart: true,
      load: 0.4,
    });
    const state = createState({ load: 0.9 });
    const previousReservoir = state.reservoir.pigmentMass;
    const next = beginStudioWetMediaStroke(
      baseSettings,
      {
        ...state,
        pickup: {
          color: [0.1, 0.2, 0.9, 1],
          pigmentMass: 2,
          waterMass: 1,
        },
      },
      [0.2, 0.7, 0.3, 1],
    );
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.value.strokeSequence).toBe(1);
    expect(next.value.reservoir.pigmentMass).toBe(4);
    expect(next.value.reservoir.color).toEqual([0.2, 0.7, 0.3, 1]);
    expect(next.value.pickup.pigmentMass).toBe(0);
    expect(state.reservoir.pigmentMass).toBe(previousReservoir);
  });

  it("keeps no-pickup reservoir depletion invariant when one contact is subdivided", () => {
    const model = settings({ wetness: 0, pickupRate: 0, mix: 0 });
    const initial = createState({ wetness: 0, pickupRate: 0, mix: 0 });
    const one = advanceStudioWetMediaTwoWellContact(
      model,
      initial,
      contact({
        sequence: 1,
        contactMeasure: 1,
        canvas: {
          color: [0, 0, 0, 0],
          availablePigmentMass: 0,
          availableWaterMass: 0,
        },
      }),
    );
    const firstHalf = advanceStudioWetMediaTwoWellContact(
      model,
      initial,
      contact({
        contactMeasure: 0.5,
        canvas: {
          color: [0, 0, 0, 0],
          availablePigmentMass: 0,
          availableWaterMass: 0,
        },
      }),
    );
    expect(one.ok).toBe(true);
    expect(firstHalf.ok).toBe(true);
    if (!one.ok || !firstHalf.ok) return;
    const secondHalf = advanceStudioWetMediaTwoWellContact(
      model,
      firstHalf.value.state,
      contact({
        sequence: 1,
        contactMeasure: 0.5,
        canvas: {
          color: [0, 0, 0, 0],
          availablePigmentMass: 0,
          availableWaterMass: 0,
        },
      }),
    );
    expect(secondHalf.ok).toBe(true);
    if (!secondHalf.ok) return;
    expect(secondHalf.value.state.reservoir.pigmentMass)
      .toBeCloseTo(one.value.state.reservoir.pigmentMass, 12);
    const splitDeposit =
      firstHalf.value.depositionToCanvas.pigmentMass
      + secondHalf.value.depositionToCanvas.pigmentMass;
    expect(splitDeposit).toBeCloseTo(one.value.depositionToCanvas.pigmentMass, 12);
  });

  it("uses wetness to control canvas pickup and respects pickup capacities", () => {
    const drySettings = settings({ wetness: 0, depositionRate: 0 });
    const wetSettings = settings({
      wetness: 1,
      depositionRate: 0,
      pickupPigmentCapacity: 1,
      pickupWaterCapacity: 0.5,
    });
    const dry = advanceStudioWetMediaTwoWellContact(
      drySettings,
      createState({ wetness: 0, depositionRate: 0 }),
      contact(),
    );
    const wet = advanceStudioWetMediaTwoWellContact(
      wetSettings,
      createState({
        wetness: 1,
        depositionRate: 0,
        pickupPigmentCapacity: 1,
        pickupWaterCapacity: 0.5,
      }),
      contact(),
    );
    expect(dry.ok).toBe(true);
    expect(wet.ok).toBe(true);
    if (!dry.ok || !wet.ok) return;
    expect(dry.value.pickupFromCanvas.pigmentMass).toBe(0);
    expect(wet.value.pickupFromCanvas.pigmentMass).toBeGreaterThan(0);
    expect(wet.value.state.pickup.pigmentMass).toBeLessThanOrEqual(1);
    expect(wet.value.state.pickup.waterMass).toBeLessThanOrEqual(0.5);
  });

  it("switches continuously between reservoir and pickup wells with the mix control", () => {
    const initial = createState({ wetness: 1, depositionRate: 0 });
    const sampled = advanceStudioWetMediaTwoWellContact(
      settings({ wetness: 1, depositionRate: 0 }),
      initial,
      contact(),
    );
    expect(sampled.ok).toBe(true);
    if (!sampled.ok) return;

    const reservoirOnly = advanceStudioWetMediaTwoWellContact(
      settings({ wetness: 0, pickupRate: 0, mix: 0, depositionRate: 1 }),
      sampled.value.state,
      contact({
        sequence: 1,
        canvas: {
          color: [0, 0, 0, 0],
          availablePigmentMass: 0,
          availableWaterMass: 0,
        },
      }),
    );
    const pickupOnly = advanceStudioWetMediaTwoWellContact(
      settings({ wetness: 0, pickupRate: 0, mix: 1, depositionRate: 1 }),
      sampled.value.state,
      contact({
        sequence: 1,
        canvas: {
          color: [0, 0, 0, 0],
          availablePigmentMass: 0,
          availableWaterMass: 0,
        },
      }),
    );
    expect(reservoirOnly.ok).toBe(true);
    expect(pickupOnly.ok).toBe(true);
    if (!reservoirOnly.ok || !pickupOnly.ok) return;
    expect(reservoirOnly.value.depositionToCanvas.color[0]).toBeGreaterThan(
      reservoirOnly.value.depositionToCanvas.color[2],
    );
    expect(pickupOnly.value.depositionToCanvas.color[2]).toBeGreaterThan(
      pickupOnly.value.depositionToCanvas.color[0],
    );
  });

  it("mixes pigment reflectance in optical-density space rather than naïve RGB", () => {
    const model = settings({
      wetness: 0,
      pickupRate: 0,
      mix: 0.5,
      depositionRate: 10,
      reservoirPigmentCapacity: 1,
      reservoirWaterCapacity: 0,
      pickupPigmentCapacity: 1,
      pickupWaterCapacity: 0,
      load: 1,
    });
    const state: StudioWetMediaTwoWellState = {
      kind: "studio-wet-media-two-well-state",
      version: 1,
      strokeSequence: 0,
      lastContactSequence: null,
      reservoir: {
        color: [0.1, 0.1, 0.1, 1],
        pigmentMass: 1,
        waterMass: 0,
      },
      pickup: {
        color: [0.9, 0.9, 0.9, 1],
        pigmentMass: 1,
        waterMass: 0,
      },
    };
    const mixed = advanceStudioWetMediaTwoWellContact(
      model,
      state,
      contact({
        canvas: {
          color: [0, 0, 0, 0],
          availablePigmentMass: 0,
          availableWaterMass: 0,
        },
      }),
    );
    expect(mixed.ok).toBe(true);
    if (!mixed.ok) return;
    expect(mixed.value.depositionToCanvas.color[0]).toBeCloseTo(0.3, 12);
    expect(mixed.value.depositionToCanvas.color[0]).toBeLessThan(0.5);
  });

  it("reports mass conservation to floating-point precision", () => {
    const result = advanceStudioWetMediaTwoWellContact(
      settings({ mix: 0.45 }),
      createState({ mix: 0.45 }),
      contact(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Math.abs(result.value.receipt.pigmentConservationError)).toBeLessThan(1e-12);
    expect(Math.abs(result.value.receipt.waterConservationError)).toBeLessThan(1e-12);
  });

  it("rejects unknown fields, invalid mass, and regressing contact sequences", () => {
    expect(parseStudioWetMediaTwoWellSettings({
      ...settings(),
      vendorPreset: "forbidden",
    })).toEqual({
      ok: false,
      reason: "unknown-field",
      path: "$.vendorPreset",
    });

    const state = createState();
    expect(parseStudioWetMediaTwoWellState({
      ...state,
      reservoir: {
        ...state.reservoir,
        pigmentMass: 11,
      },
    }, settings())).toEqual({
      ok: false,
      reason: "invalid-field",
      path: "$.reservoir.pigmentMass",
    });

    const advancedState = {
      ...state,
      strokeSequence: 2,
      lastContactSequence: 2,
    };
    expect(advanceStudioWetMediaTwoWellContact(
      settings(),
      advancedState,
      contact({ sequence: 1 }),
    )).toEqual({
      ok: false,
      reason: "sequence-regression",
      path: "$.contact.sequence",
    });
  });
});
