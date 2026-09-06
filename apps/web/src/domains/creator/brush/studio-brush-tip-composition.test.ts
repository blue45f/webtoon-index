import { describe, expect, it } from "vitest";

import {
  STUDIO_BRUSH_TIP_COMBINED_ALPHA_MAP_BASE64_MAX_CHARS,
  STUDIO_BRUSH_TIP_LAYER_MAX_COUNT,
  composeNormalizedStudioBrushTipLayerDab,
  composeStudioBrushDualTipAlphaMap,
  normalizeStudioBrushDualBrushSettings,
  normalizeStudioBrushTipLayers,
  planStudioBrushTipComposition,
  studioBrushDualBrushIsActive,
  studioBrushDualBrushSettingsAreIdentity,
  studioBrushDualTipUsesSolidEllipse,
} from "./studio-brush-tip-composition";
import {
  buildStudioBrushTipAlphaMap,
  DEFAULT_STUDIO_BRUSH_TIP_ALPHA_MAP_SIZE,
  encodeStudioBrushTipAlphaMapBase64,
  studioBrushTipAlphaMapToBase64,
} from "./studio-brush-tip-stamp";

function uniformTip(byte: number, size = 8) {
  return {
    shape: "round" as const,
    softness: 0,
    alphaMapBase64: encodeStudioBrushTipAlphaMapBase64(
      new Uint8Array(size * size).fill(byte)
    ),
    alphaMapSize: size,
  };
}

function alphaBytes(map: { alphas: Float32Array }): Uint8Array {
  return new Uint8Array(map.alphas.buffer, map.alphas.byteOffset, map.alphas.byteLength);
}

describe("studio brush tip composition", () => {
  it("bounds and canonicalizes a three-tip contract", () => {
    const layers = normalizeStudioBrushTipLayers([
      {
        tip: { shape: "star", softness: 2 },
        scale: 9,
        opacity: -1,
        offsetX: 9,
        offsetY: -9,
        angle: 540,
        roundness: 9,
      },
      { tip: { shape: "grain" }, scale: 0 },
      { tip: { shape: "sponge" } },
    ]);
    expect(layers).toHaveLength(STUDIO_BRUSH_TIP_LAYER_MAX_COUNT);
    expect(layers[0]).toMatchObject({
      tip: { shape: "star", softness: 1 },
      scale: 4,
      opacity: 0,
      offsetX: 2,
      offsetY: -2,
      angle: -180,
      roundness: 2,
    });
    expect(layers[1]?.scale).toBe(0.1);
  });

  it("rotates tip-local offsets with the base dab and preserves the primary", () => {
    const dab = { x: 10, y: 20, size: 8, angle: 90, roundness: 0.8, opacity: 0.75, flow: 0.6 };
    const rawLayer = {
      tip: { shape: "star" as const, softness: 0.2, alphaMapBase64: null, alphaMapSize: 24 },
      scale: 0.5,
      opacity: 0.4,
      offsetX: 1,
      offsetY: 0,
      angle: 30,
      roundness: 0.5,
    };
    const composed = planStudioBrushTipComposition(
      dab,
      { shape: "hard" },
      [rawLayer]
    );
    expect(composed).toHaveLength(2);
    expect(composed[0]).toMatchObject({ role: "primary", layerIndex: -1 });
    expect(composed[0]?.dab).toMatchObject({ x: 10, y: 20, size: 8, angle: 90 });
    expect(composed[1]).toMatchObject({
      role: "layer",
      layerIndex: 0,
      tip: { shape: "star" },
      dab: {
        x: 10,
        y: 24,
        size: 4,
        angle: 120,
        roundness: 0.4,
        flow: 0.6,
      },
    });
    expect(composed[1]?.dab.opacity).toBeCloseTo(0.3, 12);
    const normalizedLayer = normalizeStudioBrushTipLayers([rawLayer])[0]!;
    expect(composeNormalizedStudioBrushTipLayerDab(dab, normalizedLayer)).toEqual(
      composed[1]?.dab
    );
  });

  it("drops only alpha maps that exceed the aggregate CRDT-safe budget", () => {
    const primary = studioBrushTipAlphaMapToBase64("grain", 0, 64);
    const secondary = studioBrushTipAlphaMapToBase64("star", 0, 64);
    const layers = normalizeStudioBrushTipLayers([
      { tip: { shape: "star", ...secondary } },
      { tip: { shape: "sponge", ...secondary } },
    ], { shape: "grain", ...primary });
    const encodedCharacters = primary.alphaMapBase64.length
      + layers.reduce((sum, layer) => sum + (layer.tip.alphaMapBase64?.length ?? 0), 0);
    expect(encodedCharacters).toBeLessThanOrEqual(
      STUDIO_BRUSH_TIP_COMBINED_ALPHA_MAP_BASE64_MAX_CHARS
    );
    expect(layers.every((layer) => layer.tip.alphaMapBase64 === null)).toBe(true);
    expect(layers.map((layer) => layer.tip.shape)).toEqual(["star", "sponge"]);
  });

  it("returns the primary map byte-identically when the dual brush is disabled or absent", () => {
    const primary = { shape: "grain" as const, softness: 0.4 };
    const base = buildStudioBrushTipAlphaMap(primary);
    for (const dual of [
      undefined,
      null,
      {},
      { enabled: false, tip: { shape: "star" as const }, blendMode: "screen" as const, sizeRatio: 2 },
      { enabled: "yes" },
    ]) {
      const composed = composeStudioBrushDualTipAlphaMap(primary, dual);
      // Same cached instance: the disabled path allocates nothing and cannot drift.
      expect(composed.alphas).toBe(base.alphas);
      expect(alphaBytes(composed)).toEqual(alphaBytes(base));
      expect(composed).toMatchObject({ size: base.size, shape: "grain" });
    }
    expect(studioBrushDualBrushIsActive({ enabled: false })).toBe(false);
    expect(studioBrushDualBrushIsActive({ enabled: true })).toBe(true);
    expect(studioBrushDualTipUsesSolidEllipse({ shape: "round" }, { enabled: false })).toBe(true);
    expect(studioBrushDualTipUsesSolidEllipse({ shape: "round" }, { enabled: true })).toBe(false);
  });

  it("applies exact multiply and screen alpha math on known uniform tips", () => {
    const primaryTip = uniformTip(128);
    const secondaryTip = uniformTip(64);
    const p = 128 / 255;
    const s = 64 / 255;
    const multiplied = composeStudioBrushDualTipAlphaMap(primaryTip, {
      enabled: true,
      tip: secondaryTip,
      blendMode: "multiply",
      sizeRatio: 1,
    });
    const screened = composeStudioBrushDualTipAlphaMap(primaryTip, {
      enabled: true,
      tip: secondaryTip,
      blendMode: "screen",
      sizeRatio: 1,
    });
    expect(multiplied.size).toBe(8);
    for (const alpha of multiplied.alphas) expect(alpha).toBeCloseTo(p * s, 5);
    for (const alpha of screened.alphas) expect(alpha).toBeCloseTo(p + s - p * s, 5);
    expect(multiplied.custom).toBe(true);
  });

  it("resamples the secondary footprint by size ratio with transparent outside reads", () => {
    const primaryTip = uniformTip(128);
    const secondaryTip = uniformTip(255);
    const p = 128 / 255;
    const centreIndex = 3 * 8 + 3; // normalized (-1/7, -1/7): inside a 0.5x secondary
    const edgeIndex = 3 * 8; // normalized x = -1: outside a 0.5x secondary
    const multiplied = composeStudioBrushDualTipAlphaMap(primaryTip, {
      enabled: true,
      tip: secondaryTip,
      blendMode: "multiply",
      sizeRatio: 0.5,
    });
    expect(multiplied.alphas[centreIndex]).toBeCloseTo(p, 6);
    expect(multiplied.alphas[edgeIndex]).toBe(0);
    const screened = composeStudioBrushDualTipAlphaMap(primaryTip, {
      enabled: true,
      tip: secondaryTip,
      blendMode: "screen",
      sizeRatio: 0.5,
    });
    expect(screened.alphas[centreIndex]).toBeCloseTo(1, 6);
    // Screen leaves the primary untouched wherever the smaller secondary reads transparent.
    expect(screened.alphas[edgeIndex]).toBeCloseTo(p, 6);
  });

  it("composes dual tips deterministically across JSON roundtrips and repeat calls", () => {
    const primaryTip = { shape: "bristle" as const, softness: 0.3 };
    const dual = {
      enabled: true,
      tip: { shape: "halftone" as const, softness: 0.2 },
      blendMode: "screen" as const,
      sizeRatio: 1.35,
    };
    const first = composeStudioBrushDualTipAlphaMap(primaryTip, dual);
    const second = composeStudioBrushDualTipAlphaMap(
      JSON.parse(JSON.stringify(primaryTip)),
      JSON.parse(JSON.stringify(dual))
    );
    expect(alphaBytes(second)).toEqual(alphaBytes(first));
    // Identical raw inputs hit the once-per-settings LRU cache instead of re-rasterizing.
    expect(second).toBe(first);
  });

  it("normalizes dual settings to identity defaults and drops over-budget secondary payloads", () => {
    expect(normalizeStudioBrushDualBrushSettings()).toEqual({
      enabled: false,
      tip: {
        shape: "round",
        softness: 0.35,
        alphaMapBase64: null,
        alphaMapSize: DEFAULT_STUDIO_BRUSH_TIP_ALPHA_MAP_SIZE,
      },
      blendMode: "multiply",
      sizeRatio: 1,
    });
    expect(normalizeStudioBrushDualBrushSettings({
      enabled: true,
      blendMode: "overlay",
      sizeRatio: 99,
    })).toMatchObject({ enabled: true, blendMode: "multiply", sizeRatio: 2 });
    expect(normalizeStudioBrushDualBrushSettings({ sizeRatio: 0 }).sizeRatio).toBe(0.25);
    expect(studioBrushDualBrushSettingsAreIdentity(normalizeStudioBrushDualBrushSettings())).toBe(true);
    expect(studioBrushDualBrushSettingsAreIdentity(
      normalizeStudioBrushDualBrushSettings({ enabled: true })
    )).toBe(false);
    expect(studioBrushDualBrushSettingsAreIdentity(
      normalizeStudioBrushDualBrushSettings({ tip: { shape: "star" } })
    )).toBe(false);

    const primary = studioBrushTipAlphaMapToBase64("grain", 0, 64);
    const secondary = studioBrushTipAlphaMapToBase64("star", 0, 64);
    const bounded = normalizeStudioBrushDualBrushSettings(
      { enabled: true, tip: { shape: "star", ...secondary } },
      { shape: "grain", ...primary }
    );
    expect(bounded.tip.alphaMapBase64).toBeNull();
    expect(bounded.tip.shape).toBe("star");
    const withinBudget = normalizeStudioBrushDualBrushSettings(
      { enabled: true, tip: { shape: "star", ...secondary } },
      { shape: "grain" }
    );
    expect(withinBudget.tip.alphaMapBase64).toBe(secondary.alphaMapBase64);
  });

  it("replays composition identically after JSON roundtrip", () => {
    const input = [{
      tip: { shape: "bristle" as const, softness: 0.3 },
      scale: 0.72,
      opacity: 0.55,
      offsetX: -0.4,
      offsetY: 0.25,
      angle: -17,
      roundness: 0.6,
    }];
    const dab = { x: 3, y: 9, size: 12, angle: 33, roundness: 0.7, opacity: 0.8, flow: 0.9 };
    expect(planStudioBrushTipComposition(dab, { shape: "round" }, input)).toEqual(
      planStudioBrushTipComposition(
        JSON.parse(JSON.stringify(dab)),
        { shape: "round" },
        JSON.parse(JSON.stringify(input))
      )
    );
  });
});
