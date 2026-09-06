import { describe, expect, it } from "vitest";

import {
  applyStudioLivingInkOperation,
  createStudioLivingInkSession,
  createStudioLivingInkStrokeOperation,
  decodeStudioLivingInkSnapshot,
  encodeStudioLivingInkSnapshot,
  studioLivingInkBrushBleedBoost,
  studioLivingInkChromaBleedMultipliers,
  studioLivingInkDepositionPathLength,
  studioLivingInkDisplayReflectance,
  studioLivingInkMeanMarkRadius,
  studioLivingInkPigmentCoatFactor,
  studioLivingInkPigmentDiffusionRates,
  studioLivingInkPigmentOpticalDensity,
  STUDIO_LIVING_INK_BRUSH_BLEED,
  STUDIO_LIVING_INK_PIGMENT_COAT,
  STUDIO_LIVING_INK_CHROMA_COEFFS,
  STUDIO_LIVING_INK_FIELD_VERSION,
  STUDIO_LIVING_INK_WHITE_GOUACHE_EXTINCTION,
  undoStudioLivingInkOperation,
  type StudioLivingInkDepositOperation,
  type StudioLivingInkSelectionMask,
  type StudioLivingInkSession,
} from "./studio-living-ink-field";

import type {
  StudioWetMediaTileFieldPaper,
  StudioWetMediaTileFieldSettings,
} from "./brush/studio-wet-media-tile-field";

function settings(width = 12, height = 12): StudioWetMediaTileFieldSettings {
  return {
    kind: "studio-wet-media-tile-field-settings",
    version: 1,
    model: "fixed-step-anisotropic-paper-v1",
    width,
    height,
    waterDiffusionRate: 0.12,
    pigmentDiffusionRate: 0.1,
    anisotropy: 0.35,
    absorptionRate: 0.08,
    surfaceEvaporationRate: 0.02,
    paperEvaporationRate: 0.005,
    fixationRate: 0.16,
    edgePoolingRate: 0.04,
    rewetRate: 0.8,
    backrunRate: 0.04,
    rewetEnergyDecay: 0.2,
    dryThreshold: 1,
    maxCellWater: 100,
    maxCellPigment: 100,
  };
}

function paper(model: StudioWetMediaTileFieldSettings): StudioWetMediaTileFieldPaper {
  const cells = model.width * model.height;
  return {
    kind: "studio-wet-media-tile-field-paper",
    version: 1,
    absorption: new Array<number>(cells).fill(0.55),
    fiberDirectionRadians: new Array<number>(cells).fill(Math.PI / 8),
    activeMask: new Array<number>(cells).fill(1),
    cutBoundaryMask: new Array<number>(cells).fill(0),
  };
}

function session(width = 12, height = 12): StudioLivingInkSession {
  const model = settings(width, height);
  const created = createStudioLivingInkSession(model, paper(model));
  if (!created.ok) throw new Error(`${created.reason}:${created.path}`);
  return created.value;
}

function total(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

function ink(
  sequence: number,
  overrides: Partial<StudioLivingInkDepositOperation["marks"][number]> = {},
): StudioLivingInkDepositOperation {
  return {
    kind: "ink",
    version: STUDIO_LIVING_INK_FIELD_VERSION,
    sequence,
    tool: "brush",
    marks: [{
      x: 6,
      y: 6,
      radius: 2.4,
      pressure: 0.7,
      speed: 120,
      waterMass: 6,
      pigmentMass: 3,
      color: [0.12, 0.24, 0.55, 1],
      ...overrides,
    }],
    selection: null,
  };
}

async function applied(
  current: StudioLivingInkSession,
  operation: Parameters<typeof applyStudioLivingInkOperation>[1],
) {
  const result = await applyStudioLivingInkOperation(current, operation);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`${result.reason}:${result.path}`);
  return result.value;
}

describe("Studio Living Ink field", () => {
  it("keeps InkWash chromatography chemistry ordered: red-absorbing dye escapes fastest", () => {
    const zero = studioLivingInkChromaBleedMultipliers(0);
    expect(zero[0]).toBeCloseTo(1, 10);
    expect(zero[1]).toBeCloseTo(1, 10);
    expect(zero[2]).toBeCloseTo(1, 10);
    const full = studioLivingInkChromaBleedMultipliers(1);
    expect(full[0]).toBeGreaterThan(full[1]);
    expect(full[1]).toBeGreaterThan(full[2]);
    expect(full[0]).toBeCloseTo(1 + STUDIO_LIVING_INK_CHROMA_COEFFS.redGain, 10);
    expect(full[1]).toBeCloseTo(1 + STUDIO_LIVING_INK_CHROMA_COEFFS.greenGain, 10);
    expect(full[2]).toBeCloseTo(
      Math.max(
        STUDIO_LIVING_INK_CHROMA_COEFFS.blueFloor,
        1 - STUDIO_LIVING_INK_CHROMA_COEFFS.blueLoss,
      ),
      10,
    );
    expect(studioLivingInkBrushBleedBoost(0)).toBeCloseTo(STUDIO_LIVING_INK_BRUSH_BLEED.base, 10);
    expect(studioLivingInkBrushBleedBoost(1)).toBeCloseTo(
      STUDIO_LIVING_INK_BRUSH_BLEED.base + STUDIO_LIVING_INK_BRUSH_BLEED.gain,
      10,
    );
    expect(studioLivingInkBrushBleedBoost(1)).toBeGreaterThan(studioLivingInkBrushBleedBoost(0) * 5);
  });

  it("ships the same pigment diffusion rates the WebGL2 runtime uploads each step", () => {
    const quiet = studioLivingInkPigmentDiffusionRates({
      bleed: 0.56,
      mobility: 1,
      dt: 1 / 60,
      brushFootprint: 0,
      chromaticSeparation: 1,
    });
    const tip = studioLivingInkPigmentDiffusionRates({
      bleed: 0.56,
      mobility: 1,
      dt: 1 / 60,
      brushFootprint: 1,
      chromaticSeparation: 1,
    });
    // Red-absorbing channel bleeds faster than blue-absorbing when chroma is maxed.
    expect(quiet[0]).toBeGreaterThan(quiet[1]);
    expect(quiet[1]).toBeGreaterThan(quiet[2]);
    // Active tip scrub multiplies bleed vs quiet paper.
    expect(tip[0]).toBeGreaterThan(quiet[0] * 5);
    expect(tip[1]).toBeGreaterThan(quiet[1] * 5);
    expect(tip[2]).toBeGreaterThan(quiet[2] * 5);
    // Dry paper (mobility 0) freezes diffusion regardless of tip.
    const dry = studioLivingInkPigmentDiffusionRates({
      bleed: 1,
      mobility: 0,
      dt: 1 / 60,
      brushFootprint: 1,
      chromaticSeparation: 1,
    });
    expect(dry).toEqual([0, 0, 0, 0]);
    // Rates must be the exact values the runtime uploads (quiet/tip mix uniforms).
    expect(quiet.every((rate) => rate >= 0 && rate <= STUDIO_LIVING_INK_BRUSH_BLEED.channelCeiling))
      .toBe(true);
    expect(tip.every((rate) => rate >= 0 && rate <= STUDIO_LIVING_INK_BRUSH_BLEED.channelCeiling))
      .toBe(true);
  });

  it("runs a scripted ink→water→fix→second-layer sequence with fixed immutability", async () => {
    const initial = session(16, 16);
    const line = await applied(initial, ink(1, {
      x: 8,
      y: 8,
      radius: 2.2,
      pigmentMass: 4,
      waterMass: 2,
      color: [0.08, 0.1, 0.18, 1],
    }));
    const mobileAfterLine = total(line.session.state.mobilePigmentMass);
    expect(mobileAfterLine).toBeGreaterThan(0);

    const wash = await applied(line.session, {
      kind: "water",
      version: 1,
      sequence: 2,
      tool: "water-brush",
      marks: [
        { x: 6, y: 8, radius: 3, pressure: 0.9, speed: 30, waterMass: 6 },
        { x: 10, y: 8, radius: 3, pressure: 0.9, speed: 30, waterMass: 6 },
      ],
      selection: null,
    });
    expect(total(wash.session.state.surfaceWater)).toBeGreaterThan(total(line.session.state.surfaceWater));
    expect(total(wash.session.state.mobilePigmentMass)).toBeCloseTo(mobileAfterLine, 10);

    const settled = await applied(wash.session, {
      kind: "advance",
      version: 1,
      sequence: 3,
      fixedTicks: 6,
    });
    expect(total(settled.session.state.mobilePigmentMass)).toBeGreaterThan(0);

    const fixed = await applied(settled.session, {
      kind: "fix",
      version: 1,
      sequence: 4,
      scope: "all",
      selection: null,
    });
    const fixedMass = total(fixed.session.state.fixedPigmentMass);
    expect(total(fixed.session.state.mobilePigmentMass)).toBe(0);
    expect(fixedMass).toBeGreaterThan(0);
    expect(total(fixed.session.state.surfaceWater)).toBe(0);

    const secondLayer = await applied(fixed.session, ink(5, {
      x: 10,
      y: 10,
      radius: 1.8,
      pigmentMass: 2.5,
      waterMass: 1.5,
      color: [0.05, 0.06, 0.1, 1],
    }));
    expect(total(secondLayer.session.state.mobilePigmentMass)).toBeGreaterThan(0);
    expect(total(secondLayer.session.state.fixedPigmentMass)).toBeCloseTo(fixedMass, 10);

    const mobileBeforeRewet = total(secondLayer.session.state.mobilePigmentMass);
    const rewet = await applied(secondLayer.session, {
      kind: "water",
      version: 1,
      sequence: 6,
      tool: "water-brush",
      marks: [{ x: 8, y: 8, radius: 4, pressure: 1, speed: 0, waterMass: 10 }],
      selection: null,
    });
    // Water alone must not lift fixed pigment (rewet lift disabled, InkWash §07).
    expect(total(rewet.session.state.fixedPigmentMass)).toBeCloseTo(fixedMass, 10);
    expect(total(rewet.session.state.mobilePigmentMass)).toBeCloseTo(mobileBeforeRewet, 10);

    const afterRewet = await applied(rewet.session, {
      kind: "advance",
      version: 1,
      sequence: 7,
      fixedTicks: 8,
    });
    // Natural fixation may grow the fixed well; rewet must never shrink it.
    expect(total(afterRewet.session.state.fixedPigmentMass)).toBeGreaterThanOrEqual(fixedMass - 1e-9);
    const pigmentBefore = mobileBeforeRewet + fixedMass;
    const pigmentAfter = total(afterRewet.session.state.mobilePigmentMass)
      + total(afterRewet.session.state.fixedPigmentMass);
    expect(pigmentAfter).toBeCloseTo(pigmentBefore, 6);
  });

  it("keeps white gouache canonical through dark→fix→white→save→fix→dark layering", async () => {
    const initial = session();
    const dark = await applied(initial, ink(1, {
      x: 6,
      y: 6,
      radius: 3,
      pigmentMass: 5,
      waterMass: 2,
      color: [0.06, 0.09, 0.14, 1],
    }));
    const darkFixed = await applied(dark.session, {
      kind: "fix",
      version: 1,
      sequence: 2,
      scope: "all",
      selection: null,
    });
    const densityAfterDark = darkFixed.session.state.fixedPigmentOpticalDensity
      .flat()
      .reduce((sum, value) => sum + value, 0);

    const whiteMobile = await applied(darkFixed.session, {
      kind: "ink",
      version: 1,
      sequence: 3,
      tool: "white-gouache",
      marks: [{
        x: 6,
        y: 6,
        radius: 2.5,
        pressure: 1,
        speed: 0,
        waterMass: 1,
        pigmentMass: 4,
        color: [1, 1, 1, 1],
      }],
      selection: null,
    });
    expect(total(whiteMobile.session.mobileWhiteGouacheCoverage)).toBeGreaterThan(0);
    expect(total(whiteMobile.session.state.mobilePigmentMass)).toBe(0);

    const encodedWhite = encodeStudioLivingInkSnapshot(whiteMobile.session);
    expect(encodedWhite.ok).toBe(true);
    if (!encodedWhite.ok) return;
    const restoredWhite = decodeStudioLivingInkSnapshot(
      encodedWhite.value.bytes,
      encodedWhite.value.receipt.sha256,
    );
    expect(restoredWhite.ok).toBe(true);
    if (!restoredWhite.ok) return;
    expect(restoredWhite.value.mobileWhiteGouacheCoverage)
      .toEqual(whiteMobile.session.mobileWhiteGouacheCoverage);

    const whiteFixed = await applied(restoredWhite.value, {
      kind: "fix",
      version: 1,
      sequence: 4,
      scope: "all",
      selection: null,
    });
    const densityAfterWhite = whiteFixed.session.state.fixedPigmentOpticalDensity
      .flat()
      .reduce((sum, value) => sum + value, 0);
    expect(densityAfterWhite).toBeLessThan(densityAfterDark * 0.8);
    expect(total(whiteFixed.session.mobileWhiteGouacheCoverage)).toBe(0);

    const darkAgain = await applied(whiteFixed.session, ink(5, {
      x: 6,
      y: 6,
      radius: 1.5,
      pigmentMass: 2,
      waterMass: 0.5,
      color: [0.02, 0.02, 0.02, 1],
    }));
    const darkAgainFixed = await applied(darkAgain.session, {
      kind: "fix",
      version: 1,
      sequence: 6,
      scope: "all",
      selection: null,
    });
    const densityAfterDarkAgain = darkAgainFixed.session.state.fixedPigmentOpticalDensity
      .flat()
      .reduce((sum, value) => sum + value, 0);
    expect(densityAfterDarkAgain).toBeGreaterThan(densityAfterWhite);
    expect(STUDIO_LIVING_INK_WHITE_GOUACHE_EXTINCTION).toBe(2.35);

    const reopened = encodeStudioLivingInkSnapshot(darkAgainFixed.session);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    const decoded = decodeStudioLivingInkSnapshot(reopened.value.bytes, reopened.value.receipt.sha256);
    expect(decoded).toEqual({ ok: true, value: darkAgainFixed.session });
  });

  it("advects mobile white coverage conservatively without crossing selection or cut boundaries", async () => {
    const model = settings(8, 6);
    const customPaper = paper(model);
    const cuts = [...customPaper.cutBoundaryMask];
    for (let y = 0; y < model.height; y += 1) {
      cuts[y * model.width + 3] = 2;
      cuts[y * model.width + 4] = 8;
    }
    const created = createStudioLivingInkSession(model, { ...customPaper, cutBoundaryMask: cuts });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const selection: StudioLivingInkSelectionMask = {
      kind: "studio-living-ink-selection-mask",
      version: 1,
      bounds: { x: 0, y: 0, width: 4, height: 6 },
      coverage: new Array<number>(24).fill(1),
    };
    const white = await applied(created.value, {
      kind: "ink",
      version: 1,
      sequence: 1,
      tool: "white-gouache",
      marks: [{
        x: 2,
        y: 3,
        radius: 1.25,
        pressure: 1,
        speed: 0,
        waterMass: 12,
        pigmentMass: 3,
        color: [1, 1, 1, 1],
      }],
      selection,
    });
    const before = white.session.mobileWhiteGouacheCoverage;
    const advanced = await applied(white.session, {
      kind: "advance",
      version: 1,
      sequence: 2,
      fixedTicks: 12,
    });
    const after = advanced.session.mobileWhiteGouacheCoverage;
    expect(advanced.receipt.estimatedCellWork)
      .toBeGreaterThan(model.width * model.height * 12);
    expect(after).not.toEqual(before);
    expect(total(after)).toBeCloseTo(total(before), 10);
    for (let y = 0; y < model.height; y += 1) {
      for (let x = 4; x < model.width; x += 1) {
        expect(after[y * model.width + x]).toBe(0);
      }
    }
    expect(Object.isFrozen(after)).toBe(true);
  });

  it("keeps water, mobile pigment and fixed pigment as separate physical wells", async () => {
    const initial = session();
    const painted = await applied(initial, ink(1));
    const mobileAfterInk = total(painted.session.state.mobilePigmentMass);
    const fixedAfterInk = total(painted.session.state.fixedPigmentMass);
    const waterAfterInk = total(painted.session.state.surfaceWater);
    expect(mobileAfterInk).toBeGreaterThan(0);
    expect(fixedAfterInk).toBe(0);
    expect(waterAfterInk).toBeGreaterThan(0);

    const watered = await applied(painted.session, {
      kind: "water",
      version: 1,
      sequence: 2,
      tool: "water-brush",
      marks: [{ x: 6, y: 6, radius: 3, pressure: 0.8, speed: 40, waterMass: 4 }],
      selection: null,
    });
    expect(total(watered.session.state.surfaceWater)).toBeGreaterThan(waterAfterInk);
    expect(total(watered.session.state.mobilePigmentMass)).toBeCloseTo(mobileAfterInk, 12);
    expect(total(watered.session.state.fixedPigmentMass)).toBe(fixedAfterInk);

    const fixed = await applied(watered.session, {
      kind: "fix",
      version: 1,
      sequence: 3,
      scope: "all",
      selection: null,
    });
    expect(total(fixed.session.state.mobilePigmentMass)).toBe(0);
    expect(total(fixed.session.state.fixedPigmentMass)).toBeCloseTo(mobileAfterInk, 12);
    expect(total(fixed.session.state.surfaceWater)).toBe(0);
    expect(total(fixed.session.state.absorbedPaperWater)).toBe(0);

    const rewetted = await applied(fixed.session, {
      kind: "water",
      version: 1,
      sequence: 4,
      tool: "water-brush",
      marks: [{ x: 6, y: 6, radius: 3, pressure: 1, speed: 0, waterMass: 8 }],
      selection: null,
    });
    const evolved = await applied(rewetted.session, {
      kind: "advance",
      version: 1,
      sequence: 5,
      fixedTicks: 8,
    });
    expect(total(evolved.session.state.mobilePigmentMass)).toBe(0);
    expect(total(evolved.session.state.fixedPigmentMass)).toBeCloseTo(mobileAfterInk, 10);
  });

  it("clips deposition and destructive operations to an alpha selection mask", async () => {
    const initial = session(8, 8);
    const selection: StudioLivingInkSelectionMask = {
      kind: "studio-living-ink-selection-mask",
      version: 1,
      bounds: { x: 1, y: 1, width: 2, height: 2 },
      coverage: [1, 1, 1, 0.5],
    };
    const painted = await applied(initial, {
      ...ink(1, { x: 2, y: 2, radius: 4 }),
      selection,
    });
    const state = painted.session.state;
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const mass = state.mobilePigmentMass[y * 8 + x] ?? 0;
        if (x >= 1 && x < 3 && y >= 1 && y < 3) expect(mass).toBeGreaterThan(0);
        else expect(mass).toBe(0);
      }
    }
    expect(painted.receipt.dirtyBounds).toEqual({ x: 1, y: 1, width: 2, height: 2 });

    const cleared = await applied(painted.session, {
      kind: "clear",
      version: 1,
      sequence: 2,
      scope: "selection",
      selection: {
        kind: "studio-living-ink-selection-mask",
        version: 1,
        bounds: { x: 1, y: 1, width: 1, height: 1 },
        coverage: [1],
      },
    });
    expect(cleared.session.state.mobilePigmentMass[1 * 8 + 1]).toBe(0);
    expect(total(cleared.session.state.mobilePigmentMass)).toBeGreaterThan(0);
  });

  it("applies pressure, speed and tool dynamics instead of treating every mark alike", async () => {
    const slowStrong = await applied(session(), ink(1, { pressure: 1, speed: 0 }));
    const fastLight = await applied(session(), ink(1, { pressure: 0.1, speed: 8_000 }));
    expect(total(slowStrong.session.state.mobilePigmentMass))
      .toBeGreaterThan(total(fastLight.session.state.mobilePigmentMass) * 3);
    expect(total(slowStrong.session.state.surfaceWater))
      .toBeGreaterThan(total(fastLight.session.state.surfaceWater) * 3);
  });

  it("uses the same reviewed reflectance floor as GPU replay for near-black pigment", async () => {
    const belowFloor = await applied(session(), ink(1, { color: [0.001, 0.008, 0.014, 1] }));
    const atFloor = await applied(session(), ink(1, { color: [0.015, 0.015, 0.015, 1] }));
    const aboveFloor = await applied(session(), ink(1, { color: [0.02, 0.02, 0.02, 1] }));
    expect(belowFloor.session.state.mobilePigmentOpticalDensity)
      .toEqual(atFloor.session.state.mobilePigmentOpticalDensity);
    expect(total(aboveFloor.session.state.mobilePigmentOpticalDensity[0]))
      .toBeLessThan(total(atFloor.session.state.mobilePigmentOpticalDensity[0]));
  });

  it("keeps cancellation atomic and never exposes a partially deposited session", async () => {
    const initial = session(32, 32);
    const controller = new AbortController();
    const marks = Array.from({ length: 40 }, (_, index) => ({
      x: 2 + index * 0.5,
      y: 12,
      radius: 1.5,
      pressure: 0.6,
      speed: 100,
      waterMass: 1,
      pigmentMass: 0.5,
      color: [0.2, 0.3, 0.4, 1] as const,
    }));
    const result = await applyStudioLivingInkOperation(initial, {
      kind: "ink",
      version: 1,
      sequence: 1,
      tool: "pen",
      marks,
      selection: null,
    }, {
      signal: controller.signal,
      yieldControl: async () => {
        controller.abort();
      },
    });
    expect(result).toEqual({ ok: false, reason: "aborted", path: "$.operation" });
    expect(total(initial.state.surfaceWater)).toBe(0);
    expect(total(initial.state.mobilePigmentMass)).toBe(0);
    expect(initial.revision).toBe(0);
  });

  it("round-trips canonical save bytes and restores exact immutable undo state", async () => {
    const initial = session();
    const painted = await applied(initial, ink(1));
    const first = encodeStudioLivingInkSnapshot(painted.session);
    const second = encodeStudioLivingInkSnapshot(painted.session);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.bytes).toEqual(second.value.bytes);
    expect(first.value.receipt.sha256).toBe(second.value.receipt.sha256);

    const restored = decodeStudioLivingInkSnapshot(
      first.value.bytes,
      first.value.receipt.sha256,
    );
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.value).toEqual(painted.session);
    expect(Object.isFrozen(restored.value.state.mobilePigmentMass)).toBe(true);

    const undone = undoStudioLivingInkOperation(painted.session, painted.undo);
    expect(undone).toEqual({ ok: true, value: initial });
    expect(undoStudioLivingInkOperation(restored.value, painted.undo)).toEqual({
      ok: false,
      reason: "integrity-mismatch",
      path: "$.undo.expectedSession",
    });
  });

  it("interpolates current wet-brush samples densely enough to hide station gaps", () => {
    const operation = createStudioLivingInkStrokeOperation(1, {
      fieldScale: 4,
      baseWidth: 10,
      waterLoad: 0.4,
      pigmentLoad: 0.25,
      color: [0.1, 0.15, 0.2, 1],
      tool: "brush",
    }, [
      { x: 2, y: 4, pressure: 0.3, timeMs: 0 },
      { x: 92, y: 4, pressure: 0.9, timeMs: 20 },
    ]);
    expect(operation.marks.length).toBeGreaterThan(12);
    for (let index = 1; index < operation.marks.length; index += 1) {
      const previous = operation.marks[index - 1]!;
      const current = operation.marks[index]!;
      expect(Math.hypot(current.x - previous.x, current.y - previous.y)).toBeLessThanOrEqual(5.61);
    }
  });

  it("deposits the opening station exactly once instead of creating a dark round blob", () => {
    const operation = createStudioLivingInkStrokeOperation(1, {
      fieldScale: 1,
      baseWidth: 8,
      waterLoad: 0.4,
      pigmentLoad: 0.25,
      color: [0.1, 0.15, 0.2, 1],
      tool: "brush",
    }, [{ x: 4, y: 7, pressure: 0.6, timeMs: 0 }]);
    expect(operation.marks).toHaveLength(1);
    expect(operation.marks[0]).toMatchObject({ x: 4, y: 7, pressure: 0.6 });
  });

  it("rejects a 4097+ mark segment instead of silently truncating its tail", () => {
    expect(() => createStudioLivingInkStrokeOperation(1, {
      fieldScale: 1,
      baseWidth: 0.5,
      waterLoad: 0.4,
      pigmentLoad: 0.25,
      color: [0.1, 0.15, 0.2, 1],
      tool: "brush",
    }, [
      { x: 0, y: 0, pressure: 0.3, timeMs: 0 },
      { x: 2_048, y: 0, pressure: 0.9, timeMs: 20 },
    ])).toThrow(/requires 4097 marks; maximum is 4096/);
  });
});

describe("Studio Living Ink pigment coat", () => {
  const linearFromSrgb = (channel: number) =>
    channel <= 0.040_45 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

  it("re-encodes a linear channel back to the space the display resolve writes", () => {
    for (const srgb of [0, 0.05, 0.2, 0.584, 0.95, 1]) {
      expect(studioLivingInkDisplayReflectance(linearFromSrgb(srgb))).toBeCloseTo(srgb, 5);
    }
  });

  it("reproduces the picked colour at one coat instead of collapsing onto one channel", () => {
    // #ff9500 and #ff3b30 used to land on the same near-black red because their absorbances were
    // taken in linear light and then multiplied far past unit optical depth.
    const orange = [1, 0.584, 0].map(linearFromSrgb);
    const vermilion = [1, 0.231, 0.188].map(linearFromSrgb);
    const coat = (linear: number[]) =>
      linear.map((channel) => Math.exp(-studioLivingInkPigmentOpticalDensity(channel)));
    const [orangeR, orangeG, orangeB] = coat(orange);
    const [, vermilionG, vermilionB] = coat(vermilion);
    expect(orangeR!).toBeCloseTo(0.985, 2);
    expect(orangeG!).toBeCloseTo(0.584, 2);
    expect(orangeB!).toBeCloseTo(0.015, 2);
    expect(vermilionG!).toBeCloseTo(0.231, 2);
    expect(vermilionB!).toBeCloseTo(0.188, 2);
    // The two hues stay far apart in green, which is the channel that used to be crushed to zero.
    expect(orangeG! - vermilionG!).toBeGreaterThan(0.3);
  });

  it("lays one coat per pass no matter how the samples were batched", () => {
    const radius = 8;
    const reach = STUDIO_LIVING_INK_PIGMENT_COAT.profileReach * radius;
    // A pixel is reached by roughly reach/pathLength batches, so coat x batches must stay at 1.
    for (const pathLength of [reach / 4, reach / 2, reach]) {
      const batches = reach / pathLength;
      expect(studioLivingInkPigmentCoatFactor(pathLength, radius) * batches).toBeCloseTo(1, 6);
    }
  });

  it("caps a long batch at one coat and floors a dwell so a tap still lays pigment", () => {
    expect(studioLivingInkPigmentCoatFactor(1_000, 8)).toBe(1);
    expect(studioLivingInkPigmentCoatFactor(0, 8)).toBe(1);
    expect(studioLivingInkPigmentCoatFactor(1e-6, 8))
      .toBe(STUDIO_LIVING_INK_PIGMENT_COAT.minimumCoat);
  });

  it("measures a batch from the previous batch's last mark, not from its own first mark", () => {
    const marks = [
      { x: 10, y: 0, radius: 4 },
      { x: 13, y: 0, radius: 4 },
    ];
    expect(studioLivingInkDepositionPathLength(marks, null)).toBeCloseTo(3, 6);
    expect(studioLivingInkDepositionPathLength(marks, { x: 4, y: 0 })).toBeCloseTo(9, 6);
    expect(studioLivingInkMeanMarkRadius(marks)).toBeCloseTo(4, 6);
  });
});
