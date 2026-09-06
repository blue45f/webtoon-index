import { describe, expect, it } from "vitest";

import { planNormalizedStudioDynamicBrushDabs } from "./brush/studio-brush-dynamics";
import { materializeStudioBrushPackSelection } from "./brush/studio-brush-pack-runtime";
import { bridgeStudioDynamicDabsToDryMediaV1 } from "./brush/studio-dry-media-dynamic-bridge";

const SEED = 0x13ad_beef;

function requireColoredPencil() {
  const selection = materializeStudioBrushPackSelection("pencil-colored-soft");
  if (!selection) throw new Error("pencil-colored-soft did not materialize");
  return selection;
}

describe("soft coloured-pencil endpoint visibility", () => {
  it("keeps a 14px mouse flick visible without turning wax pigment opaque", () => {
    const selection = requireColoredPencil();
    const dabs = planNormalizedStudioDynamicBrushDabs({
      baseWidth: selection.defaultWidth,
      baseOpacity: selection.defaultOpacity,
      points: [0, 0, 14, -2],
      pressures: [0.5, 0.5],
      speeds: [1.4, 1.4],
      seed: SEED,
      maxDabs: 512,
    }, selection.brushDynamics);

    expect(selection.brushDynamics.taper).toMatchObject({
      enabled: true,
      minSizeRatio: 0.36,
      minOpacityRatio: 0.92,
    });
    // continuous-carrier-quality-v3 densifies dry-media stations slightly on short flicks.
    expect(dabs).toHaveLength(13);
    expect(Math.min(...dabs.map(({ size }) => size))).toBeGreaterThan(
      selection.defaultWidth * 0.3,
    );
    expect(
      dabs.reduce((sum, { opacity }) => sum + opacity, 0) / dabs.length,
    ).toBeGreaterThan(0.48);

    const bridged = bridgeStudioDynamicDabsToDryMediaV1({
      brushId: selection.runtimeBrushId,
      brushCatalogId: selection.catalogId,
      seed: SEED,
      dabs,
    });
    expect(bridged.ok).toBe(true);
    if (!bridged.ok) return;

    expect(bridged.receipt.laneCount).toBe(5);
    expect(bridged.receipt.marks).toHaveLength(dabs.length * 5);
    const integratedPigment = bridged.receipt.marks.reduce(
      (sum, mark) => sum
        + Math.PI * mark.radiusX * mark.radiusY * mark.alpha * 0.78,
      0,
    );
    expect(integratedPigment).toBeGreaterThan(43.5);
    expect(Math.max(...bridged.receipt.marks.map(({ alpha }) => alpha))).toBeLessThan(0.3);
  });

  it("keeps the pressure-mapped grain body unchanged while retaining start-taper contact history", () => {
    const selection = requireColoredPencil();
    expect(selection.brushDynamics.flow).toMatchObject({
      base: 0.58,
      mappings: [{ source: "pressure", from: 0.5, to: 1 }],
    });
    expect(selection.brushDynamics.grain).toMatchObject({
      space: "canvas-fixed",
      amount: 0.3,
      scale: 2.6,
      contrast: 0.5,
      seed: 0x4b0a_1103,
    });

    const input = {
      baseWidth: selection.defaultWidth,
      baseOpacity: selection.defaultOpacity,
      points: [0, 0, 100, 6, 200, 0],
      pressures: [0.25, 0.85, 0.4],
      speeds: [0.35, 0.8, 0.45],
      seed: SEED,
      maxDabs: 1_024,
    } as const;
    const tapered = planNormalizedStudioDynamicBrushDabs(input, selection.brushDynamics);
    const withoutTaper = planNormalizedStudioDynamicBrushDabs(input, {
      ...selection.brushDynamics,
      taper: { ...selection.brushDynamics.taper, enabled: false },
    });

    const body = (dabs: typeof tapered) => dabs.filter(
      ({ progress }) => progress >= 0.2 && progress <= 0.8,
    );
    const taperedBody = body(tapered);
    const untaperedBody = body(withoutTaper);
    const withoutAccumulatedContactLoad = (
      dab: (typeof tapered)[number],
    ) => {
      const {
        contactLoadFromStrokeStart: _contactLoadFromStrokeStart,
        segmentStartFrame,
        ...renderReceipt
      } = dab;
      if (!segmentStartFrame) return renderReceipt;
      const {
        contactLoadFromStrokeStart: _segmentContactLoadFromStrokeStart,
        ...segmentRenderReceipt
      } = segmentStartFrame;
      return {
        ...renderReceipt,
        segmentStartFrame: segmentRenderReceipt,
      };
    };

    expect(taperedBody).not.toHaveLength(0);
    expect(taperedBody.map(withoutAccumulatedContactLoad)).toEqual(
      untaperedBody.map(withoutAccumulatedContactLoad),
    );

    // Contact load is an integral over the complete stroke, not a local rendering property.
    // The smaller start-taper contact therefore remains as one stable prefix-load difference
    // after both plans enter the identical untapered body.
    const prefixLoadDifference = (
      untaperedBody[0]!.contactLoadFromStrokeStart!
      - taperedBody[0]!.contactLoadFromStrokeStart!
    );
    expect(prefixLoadDifference).toBeGreaterThan(0);
    for (let index = 0; index < taperedBody.length; index += 1) {
      const taperedDab = taperedBody[index]!;
      const untaperedDab = untaperedBody[index]!;
      expect(untaperedDab.contactLoadFromStrokeStart!).toBeCloseTo(
        taperedDab.contactLoadFromStrokeStart! + prefixLoadDifference,
      );
      expect(untaperedDab.segmentStartFrame?.contactLoadFromStrokeStart).toBeCloseTo(
        taperedDab.segmentStartFrame!.contactLoadFromStrokeStart!
          + prefixLoadDifference,
      );
    }
  });
});
